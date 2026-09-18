/*
 * 干预 —— 烧 BANG 把一个死宇宙推回可能诞生观察者的那一侧
 * ------------------------------------------------------------
 * 费用**必须在服务端算**：依据是每个参数的「生存半径」（其余参数不动、只推这一个，
 * 结局还能保持 OBSERVERS_POSSIBLE 的最远距离），这个表只有引擎有，链上算不了。
 * 让前端自报费用等于让他免费玩。
 *
 * 定价（specs/economy-v4.md §3）：
 *   单参数费用 = |Δ(unit)| / 该参数的生存半径 × UNIT_COST
 *   总费用 = Σ 单参数费用 × 难度系数（越死越贵）
 *
 * 实测（2026-08-19）：98% 的死宇宙死于维度不对，而把维度推到 3 需要同时动
 * 弦气那三个参数，中位总位移 0.220 unit；推到三维之后 58% 直接就活了。
 * 所以「调维度」是主消耗口，定价时它单独算一档。
 *
 * ------------------------------------------------------------
 * 两种入参（2026-08-19 加的 ops，见 specs/economy-v4.md §七「关于算法保密」）
 *
 *   deltas = { 参数名: 新的绝对值 }        —— 调用方自己算好推到哪
 *   ops    = [{ key, dir, steps }]         —— 调用方只说「往哪个方向推几格」
 *
 * 为什么要有 ops：一格的长度 = STEP × 该参数的生存半径，而生存半径表
 * （engine/archash.js 的 RADIUS）是这套推导里唯一藏得住的东西 —— 参数表和物理引擎
 * 本来就必须发到浏览器里跑。前端要是自己算「推一格到哪」，就得在包里带一份半径表，
 * 于是这张表原样发给了每个访客；给它开个 /api/steps 端点同样没用，因为
 * 步长 = 0.05 × 半径，把步长交出去就等于把半径交出去。
 * 唯一有效的做法是**让客户端根本不算这段距离**：它只表达意图（推谁、往哪、几格），
 * 距离和费用都在这里算。
 *
 * 两种入参二选一，同时给就报错 —— 猜"用户到底想要哪个"只会在两边算不一样时
 * 静悄悄地按错的那个收钱。
 */
'use strict';
const path = require('path');
const { keccak256, AbiCoder } = require('ethers');
const { sigV2, assertMinter } = require('./sign.js');
const B = require(path.join(__dirname, '..', 'engine/archash.js'));
const P = require(path.join(__dirname, '..', 'engine/params.js'));
const E = require(path.join(__dirname, '..', 'engine/engine.js'));
/* 提示（诊断 + 贪心爬山）也搬到了服务端，理由同上：爬山每试一步都要"推一格"，
   在浏览器里跑就得带半径表。这两个文件是 UMD，Node 下 require 进来只拿纯逻辑，
   一行 DOM 都不碰。直接复用而不是抄一份：26 道门那张表抄错一条，
   前端显示的"卡在哪"和服务端算的"下一格推谁"就会互相打架。 */
const HINT = require(path.join(__dirname, '..', 'web/hint.js'));
const SANDBOX = require(path.join(__dirname, '..', 'web/intervene.js'));
const { OUTCOME_ORDER, rarityOf, RARITY_NAME, DERIVATION_VERSION, CARD_SHAPE } = require('./card.js');

const coder = AbiCoder.defaultAbiCoder();
const E18 = 10n ** 18n;

/* 救援费重标（specs/economy-v5.md §5）：两个常数同比例缩小 6.25 倍。
   依据：v4 一次救援实测 75,002 BANG，而 v4 每枚铸造均发 18,437 —— 4 枚铸造换一次救援。
   v5 每枚均发 600（加权），要维持“20 枚铸造换一次救援”，救援费应为 12,000 左右，
   即 v4 的 1/6.25。200/6.25 = 32，100000/6.25 = 16000。 */
/** 推 1 个生存半径要多少 BANG。这是整个经济的主旋钮 */
const UNIT_COST = 32n;
/** 弦气三参数没有生存半径（它们决定维度，不是"离我们多远"），按固定尺度计价 */
const STRING_GAS_COST_PER_UNIT = 16000n;
const STRING_GAS = { stringGasT: 1, windingDensity: 1, compactStiffness: 1 };

/** 越死越贵。索引 = OUTCOME_ORDER 的序号 */
const DIFFICULTY = [
  250, // UNSTABLE_ORBITS
  400, // BIG_CRUNCH
  400, // BIG_RIP
  160, // HEAT_DEATH_NO_STRUCTURE
  400, // BLACK_HOLE_DOMINATED
  160, // NO_ATOMS
  160, // NO_CHEMISTRY
  160, // NO_STARS
  100, // STARS_NO_LIFE
  100, // OBSERVERS_POSSIBLE（本来就活着，不该来干预）
  100, // NO_CARBON_CHEMISTRY
  250  // BEYOND_MODEL_DIM
];

const MOD = B.MODULES_ON;
const SPECS = {};
P.paramsFor(MOD).forEach((d) => { SPECS[d.key] = d; });

/* ============================================================ ops：把位移写进 calldata

   在这之前，一次干预在链上留下的只有 cardOf[id]（32 字节不可逆指纹）、新结局、
   新稀有度和销毁量 —— **「推了哪几个参数、各推到哪」一个字都不在链上**，
   它只存在这台服务器的 .store 里。存档一丢，那枚 NFT 的参数就永远算不回来；
   开源代码也救不了，因为缺的是**输入**不是代码。
   而整个项目的价值叙事是「这个宇宙我烧了 X 枚币救回来的」——
   那句话不能只有服务器一个人能作证。

   所以位移作为 calldata 塞进 intervene()。合约不解析它（链上没有参数表），
   只把 keccak256(ops) 签进摘要：上过链 = 永远在交易历史里，且改一个字节签名就废。

   编码（与合约注释、与下面的 decodeOps 三处必须同步）：
     每 5 字节一条：uint8 参数下标 ‖ uint32 干预后该参数在 unit 空间的位置 × 1e9（大端）
     下标 = 在 P.paramsFor(MODULES_ON) 里的位置；按下标升序拼接。

   为什么刻度取 1e9：派生本来就是 u = n / 1e9（合约里的 U_DEN），
   而 1e9 以内的整数 double 能精确表示，跨机器不会差一个 ulp。

   ------------------------------------------------------------
   **量化必须发生在计算之前**（这条是整件事的成败）：
   先算完新参数、模拟出结局、再回头把 unit 四舍五入写进 ops，
   链上记的就和服务端实际用的差一点点。绝大多数时候看不出来，
   但只要有一个参数落在某道门的临界点附近，重放的人就会算出**另一个结局**、
   另一个 cardHash，然后合理地认为服务端在撒谎。
   所以下面 evaluate() 里是：量化 → fromUnit → 模拟，顺序不许换。 */
const OPS_SCALE = 1e9;                 // 与合约 U_DEN 同一个刻度
const OPS_ITEM_BYTES = 5;              // uint8 + uint32
/** 参数下标表。ops 里只写下标不写名字：名字是变长的，而链上要的是定长可解析 */
const PARAM_KEYS = P.paramsFor(MOD).map((d) => d.key);
const PARAM_INDEX = {};
PARAM_KEYS.forEach((k, i) => { PARAM_INDEX[k] = i; });

/** unit → 整数刻度。夹在 [0, OPS_SCALE]，越界的值编不进 uint32 也没有意义 */
function quantizeUnit(u) {
  const n = Math.round(Math.min(1, Math.max(0, Number(u) || 0)) * OPS_SCALE);
  return Math.min(OPS_SCALE, Math.max(0, n));
}
/** 整数刻度 → unit。复算的人也走这一步，所以它必须是 quantizeUnit 的严格逆 */
function unquantize(n) { return n / OPS_SCALE; }

/**
 * [{key|index, unitInt}] → '0x…'。按下标升序，重复下标直接报错
 * （同一个参数出现两次的话，"最终位置"就有两个答案，复算的人只能猜）。
 */
function encodeOps(entries) {
  const list = (entries || []).map((e) => {
    const idx = e.index != null ? Number(e.index) : PARAM_INDEX[e.key];
    if (!Number.isInteger(idx) || idx < 0 || idx > 255 || !PARAM_KEYS[idx]) {
      throw new Error('ops 下标越界：' + (e.key || e.index));
    }
    const n = Number(e.unitInt);
    if (!Number.isInteger(n) || n < 0 || n > OPS_SCALE) throw new Error('ops 的 unit 刻度越界：' + n);
    return { index: idx, unitInt: n };
  }).sort((a, b) => a.index - b.index);

  const buf = Buffer.alloc(list.length * OPS_ITEM_BYTES);
  list.forEach((e, i) => {
    if (i > 0 && list[i - 1].index === e.index) throw new Error('同一个参数在 ops 里出现了两次：' + PARAM_KEYS[e.index]);
    buf.writeUInt8(e.index, i * OPS_ITEM_BYTES);
    buf.writeUInt32BE(e.unitInt, i * OPS_ITEM_BYTES + 1);
  });
  return '0x' + buf.toString('hex');
}

/**
 * '0x…' → [{index, key, unitInt, unit}]。**这是复算的入口** ——
 * 任何人拿着链上的一笔 intervene 交易，只要有这个函数和开源引擎就能重放。
 * 校验从严：链上的字节改不了，读出一堆似是而非的东西比直接报错危险得多。
 */
function decodeOps(hex) {
  const h = String(hex || '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error('ops 不是十六进制');
  if (h.length === 0) throw new Error('ops 是空的');
  if (h.length % (OPS_ITEM_BYTES * 2) !== 0) throw new Error('ops 长度不是 ' + OPS_ITEM_BYTES + ' 字节的整数倍');
  const buf = Buffer.from(h, 'hex');
  const out = [];
  for (let i = 0; i < buf.length; i += OPS_ITEM_BYTES) {
    const index = buf.readUInt8(i);
    const key = PARAM_KEYS[index];
    if (!key) throw new Error('ops 里的参数下标不存在：' + index);
    if (out.length && out[out.length - 1].index >= index) throw new Error('ops 没有按下标升序（或有重复）');
    const unitInt = buf.readUInt32BE(i + 1);
    if (unitInt > OPS_SCALE) throw new Error('ops 的 unit 刻度超过 ' + OPS_SCALE + '：' + unitInt);
    out.push({ index, key, unitInt, unit: unquantize(unitInt) });
  }
  return out;
}

/**
 * 复算：把 ops 记的位置搬到一份基准参数上。
 * @param {object} baseParams 基准（**原生**参数，即 blockHash 派生出来的那份）
 * @param {string} hex        链上那段 ops
 * @returns {object} normalize 过的完整参数，可以直接喂给引擎
 *
 * ops 记的是**绝对位置**而不是位移量，所以这一步不需要知道中间推过几次、
 * 每次推了多远 —— 一枚被干预过 N 次的 NFT，最后那笔交易的 ops 就足以复原它。
 */
function applyOpsHex(baseParams, hex) {
  const out = P.normalize(baseParams, MOD);
  decodeOps(hex).forEach((e) => { out[e.key] = P.fromUnit(e.key, e.unit); });
  return P.normalize(out, MOD);
}

/* ============================================================ cardHash 指纹

   原生卡（card.js）本来就是整数基：keccak(blockHash, uInt[22], uG, uF1, uF2, …)。
   干预/造物卡没有 uInt 可盖 —— 参数是推过的浮点 —— 旧算法（cardShape=2）把
   每个值 `String(number)` 编进 abi.encode(string[], string[])。JS 的 Number 是
   IEEE754 binary64，跨平台 Math.pow/log10 差 1 ulp，ToString 就不一样，第三方
   用开源引擎复算会偶发对不上。

   cardShape=3：不再经过十进制 ToString。按参数名字典序，把每个值量化成
   ops 同一套 unit 空间的 uint32（×1e9，四舍五入夹到 [0, 1e9]），再
   abi.encode(string[], uint32[])。1e9 以内的整数 double 能精确表示，
   跨机器不会差一个 ulp。

   验卡按**卡上**的 cardShape 选算法：缺字段或 2 → 旧 String；3 → 整数基。
   新签发一律 3。外层 keccak 字段序两边相同，只换内层 fp 的值编码。

   ---- 字节级规格（给开源引擎仓，shape=3；abi.encode 是 Solidity ABI）----

   keys = Object.keys(params).sort()          // JS UTF-16 码位序 = 纯 ASCII 键的字典序
   for i, k in keys:
     unitInt[i] = uint32( min(1e9, max(0, round(toUnit(k, params[k]) * 1e9))) )
                  // toUnit：log 档 (log10(v)-log10(lo))/(log10(hi)-log10(lo))；
                  //         lin 档 (v-min)/(max-min)；未知键 → 0
   fp = keccak256(abi.encode(string[] keys, uint32[] unitInt))
   cardHash = keccak256(abi.encode(
     bytes32 blockHash, bytes32 fp, uint8 outcomeIdx, uint8 rarity, uint32 derivationVersion
   ))
   derivationVersion 现役 = 3。

   ---- shape=2（旧，仅验老卡）----

   fp = keccak256(abi.encode(string[] keys, string[] values))
   values[i] = ToString(params[keys[i]])     // ECMA-262 Number::ToString，禁止自己 sprintf
   外层与 shape=3 相同。
*/
function paramFingerprint(normalizedParams, shape) {
  const keys = Object.keys(normalizedParams).sort();
  const sh = shape == null ? CARD_SHAPE : Number(shape);
  if (sh <= 2) {
    return keccak256(coder.encode(
      ['string[]', 'string[]'],
      [keys, keys.map((k) => String(normalizedParams[k]))]
    ));
  }
  const units = keys.map((k) => {
    const n = P.toUnit(k, normalizedParams[k]);
    return quantizeUnit(typeof n === 'number' && isFinite(n) ? n : 0);
  });
  return keccak256(coder.encode(
    ['string[]', 'uint32[]'],
    [keys, units]
  ));
}

/** cardHash 的算式。shape 缺省 = 现役 CARD_SHAPE（3）。复算老卡必须传入卡上的 cardShape。 */
function cardHashOf(blockHash, normalizedParams, outcomeIdx, rarity, shape) {
  const fp = paramFingerprint(normalizedParams, shape);
  return keccak256(coder.encode(
    ['bytes32', 'bytes32', 'uint8', 'uint8', 'uint32'],
    [blockHash, fp, outcomeIdx, rarity, DERIVATION_VERSION]
  ));
}

/** 按卡上 cardShape 选算法。缺字段 = 老卡（shape 2）。 */
function cardHashFromCard(card) {
  const sh = card && card.cardShape != null ? Number(card.cardShape) : 2;
  return cardHashOf(card.blockHash, card.params, card.outcome.index, card.rarity.index, sh);
}

/* ============================================================ 相对档位：一格有多长

   一格 = 该参数生存半径的 5%（specs/playable-v1.md「一格 = 多少」）。
   不用统一的绝对步长：α_s 是指数敏感的、Ω_Λ 的半径只有 1e-4 量级，
   而 H₀ 能推得很远 —— 同一个绝对步长对它们一个是灭顶、一个是推一百格没反应。

   **STEP 和 RADIUS 都不许离开服务端**：两者中任何一个到了浏览器里，
   另一个就能被反算出来。 */
const STEP = 0.05;
/** 没有实测半径的参数（弦气那三个）按 0.01 走，与旧版前端的兜底值一致 */
const FALLBACK_RADIUS = 0.01;
/** 一次请求最多推的总格数。防的是 {steps: 1e9} 这种把 CPU 拖死的入参 */
const MAX_TOTAL_STEPS = 4096;
const MAX_OPS = 64;

function radiusOf(key, dir) {
  const r = B.RADIUS[key];
  if (!r) return FALLBACK_RADIUS;
  const v = dir < 0 ? r[0] : r[1];
  // 半径为 0（θ_QCD 往下就是 0）时这个方向本来就推不动，返回 0，让它自然地"没动"
  return typeof v === 'number' && isFinite(v) ? v : FALLBACK_RADIUS;
}

/**
 * 推一格：在 unit 空间上挪 STEP × 半径，回值域再 normalize。返回新对象，绝不改入参。
 *
 * **必须一格一格地 normalize**，不能把 N 格并成一次位移再 normalize：
 * normalize 会把 step=1 的整数参数（粒子代数）取整，一格的位移小到取整就被吃掉，
 * 于是那颗旋钮是真的推不动 —— 这正是界面上把按钮标灰的依据。
 * 并成一次算的话推 20 格就能把它挪一档，和玩家点 20 下看到的结果对不上。
 */
function stepOnce(params, key, dir, modules) {
  const ms = modules || MOD;
  const u = P.toUnit(key, params[key]) + (dir < 0 ? -1 : 1) * STEP * radiusOf(key, dir);
  const next = Object.assign({}, params);
  next[key] = P.fromUnit(key, Math.min(1, Math.max(0, u)));
  /* dimS 那条"按 0.1 一档取整"的特例这里用不上：服务端固定跑 MODULES_ON（弦气开），
     维度是弦气模型派生出来的，dimS 压根不在参数表里。 */
  return P.normalize(next, ms);
}

/**
 * 把「相对档位」摊成一串绝对值。
 * @param {object} baseParams 起点参数
 * @param {Array}  ops        [{key, dir, steps}]，按给定顺序依次施加
 * @returns {object} 推完之后的完整参数（已 normalize）
 */
function applyOps(baseParams, ops, modules) {
  const ms = modules || MOD;
  let cur = P.normalize(baseParams, ms);
  let total = 0;
  ops.forEach((op) => {
    if (!op || typeof op !== 'object') throw new Error('ops 每一项要是 {key, dir, steps}');
    const key = op.key;
    if (!SPECS[key]) throw new Error('没有这个参数：' + key);
    const dir = Number(op.dir);
    if (dir !== 1 && dir !== -1) throw new Error('dir 只能是 +1 或 -1：' + key);
    const steps = op.steps == null ? 1 : Number(op.steps);
    if (!Number.isInteger(steps) || steps < 1) throw new Error('steps 要是 ≥1 的整数：' + key);
    total += steps;
    if (total > MAX_TOTAL_STEPS) throw new Error('一次最多推 ' + MAX_TOTAL_STEPS + ' 格');
    for (let i = 0; i < steps; i++) cur = stepOnce(cur, key, dir, ms);
  });
  return cur;
}

/**
 * 算一次干预的费用与结果。
 * @param {object} baseCard 干预前的 card（含 params）
 * @param {object} deltas   { 参数名: 新值 }，只列要改的（绝对值口径）
 * @param {Array}  ops      [{key, dir, steps}]（相对档位口径）
 *
 * deltas 与 ops **二选一**。同时给就抛错：两者算出来的位移不一样时，
 * 挑哪个都是替用户瞎猜，而猜错的代价是按错的位移收钱、签错的名。
 */
function evaluate(baseCard, deltas, ops) {
  const hasDeltas = deltas != null && Object.keys(deltas).length > 0;
  const hasOps = ops != null && (!Array.isArray(ops) || ops.length > 0);
  if (hasDeltas && hasOps) throw new Error('绝对值 deltas 与相对档位 ops 只能给一个');
  if (hasOps) {
    if (!Array.isArray(ops)) throw new Error('ops 要是数组');
    if (ops.length > MAX_OPS) throw new Error('ops 最多 ' + MAX_OPS + ' 条');
    // 摊成绝对值之后走的就是下面同一条路：定价、模拟、签名全都只有一份实现
    const after = applyOps(baseCard.params, ops, MOD);
    deltas = {};
    Object.keys(after).forEach((k) => { if (after[k] !== baseCard.params[k]) deltas[k] = after[k]; });
    if (!Object.keys(deltas).length) {
      const e = new Error('一个参数都没动');
      e.code = 'NO_MOVE';                     // 界面要把它翻成"这一格推不动"，不是"出错了"
      throw e;
    }
  } else if (!hasDeltas) {
    throw new Error('要给 deltas 或 ops');
  }

  const params = Object.assign({}, baseCard.params);
  const moved = [];
  let cost = 0n;

  Object.keys(deltas).sort().forEach((key) => {
    const spec = SPECS[key];
    if (!spec) throw new Error('没有这个参数：' + key);
    const to = Number(deltas[key]);
    if (!isFinite(to)) throw new Error('参数值不是数字：' + key);

    const u0 = P.toUnit(key, params[key]);
    /* **先量化再算**，不是算完再量化（见上面 ops 那段）：
       链上记的是量化之后的位置，服务端必须拿同一个数去定价、去模拟、去签名。
       差那 1e-9 平时看不出来，但只要有参数落在某道门的临界点附近，
       重放的人就会算出另一个结局、另一个 cardHash，然后以为服务端撒了谎。 */
    const u1 = unquantize(quantizeUnit(P.toUnit(key, to)));
    const d = Math.abs(u1 - u0);
    if (d < 1e-12) return;                       // 没动就不收钱

    let c;
    if (STRING_GAS[key]) {
      c = BigInt(Math.ceil(d * Number(STRING_GAS_COST_PER_UNIT)));
    } else {
      const r = B.RADIUS[key];
      // 没有实测半径的参数按 0.1 保守估：宁可贵一点，也不能白送
      const rad = r ? (u1 < u0 ? r[0] : r[1]) || 0.1 : 0.1;
      c = BigInt(Math.ceil((d / rad) * Number(UNIT_COST)));
    }
    cost += c;
    params[key] = P.fromUnit(key, u1);
    moved.push({ key, from: baseCard.params[key], to: params[key], unitDelta: +d.toFixed(6), bang: c.toString() });
  });

  if (!moved.length) {
    const e = new Error('一个参数都没动');
    e.code = 'NO_MOVE';
    throw e;
  }

  const normalized = P.normalize(params, MOD);
  const r = E.simulate(normalized, { modules: MOD, register: false });
  const outcomeId = (r.outcome && r.outcome.id) || null;
  const outcomeIdx = OUTCOME_ORDER.indexOf(outcomeId);
  if (outcomeIdx < 0) throw new Error('引擎给出的结局不在合约的 OUTCOMES 里：' + outcomeId);

  const dims = (r.calc && r.calc.dims) || {};
  const D = dims.D == null ? null : dims.D;
  const rarity = rarityOf(outcomeId, D);

  // 难度按**干预前**的结局算：救一个大挤压本来就该比救一个"有恒星无生命"贵
  const beforeIdx = baseCard.outcome.index;
  cost = (cost * BigInt(DIFFICULTY[beforeIdx] || 100)) / 100n;

  const newCard = {
    blockHash: baseCard.blockHash,
    blockNumber: baseCard.blockNumber,
    derivationVersion: DERIVATION_VERSION,
    /* 新签发一律现役 CARD_SHAPE。请求体 / 基准卡上的 cardShape 不参与：
       客户端指定 2 会把指纹降回 String(float)，那是验老卡的退路，不是签发开关。 */
    cardShape: CARD_SHAPE,
    engineVersion: r.version || null,
    tier: baseCard.tier,
    outcome: { index: outcomeIdx, id: outcomeId, name: r.outcome.name, observers: !!r.outcome.observers },
    rarity: { index: rarity, name: RARITY_NAME[rarity] },
    dimension: D == null ? null : {
      D: D, kind: dims.kind || null,
      stringGas: dims.emergent && dims.emergent.inputs ? dims.emergent.inputs : null,
      nOpen: dims.emergent ? dims.emergent.nOpen : null
    },
    constants: baseCard.constants,     // 常数由 frame 决定，干预不动它们
    params: normalized,
    uInt: baseCard.uInt,
    modules: MOD,
    /* 干预痕迹。**这才是这枚 NFT 真正稀缺的部分** ——
       区块要多少有多少，烧掉的币不是。 */
    intervention: {
      from: { outcome: baseCard.outcome.id, D: baseCard.dimension ? baseCard.dimension.D : null },
      moved: moved,
      bang: (cost * E18).toString(),
      rescued: outcomeId === 'OBSERVERS_POSSIBLE' && baseCard.outcome.id !== 'OBSERVERS_POSSIBLE'
    }
  };

  /* cardHash 要盖住干预后的完整状态。
     不能再用 uInt（那是原始哈希派生的，干预后已经不能代表当前参数了），
     改成对**归一化后的参数**逐项取整数化指纹。
     算式抽在 cardHashOf 里：复算的人用的必须是同一份实现，抄一遍迟早会分叉。 */
  const cardHash = cardHashOf(baseCard.blockHash, normalized, outcomeIdx, rarity);

  /* ---- 上链用的位移记录 ----
     基准取**原生**参数（blockHash 直接派生出来的那份），不是 baseCard.params ——
     第二次干预的 baseCard 是第一次的结果，拿它当基准的话，ops 里就只有这一次动过的参数，
     复算的人还得先把前几笔交易翻出来。取原生基准，**最后那一笔 ops 就是完整答案**：
     一个 blockHash + 一段 ops，不需要任何历史。

     ops 记绝对位置正是为了这个：位置可以覆盖，位移量只能累加。 */
  const nativeParams = P.normalize(B.derive(baseCard.blockHash).params, MOD);
  const entries = [];
  PARAM_KEYS.forEach((key, index) => {
    if (normalized[key] === nativeParams[key]) return;      // 没离开原生位置就不用记
    entries.push({ index, key, unitInt: quantizeUnit(P.toUnit(key, normalized[key])) });
  });
  /* 合约要求 ops 非空（空的等于什么都没记）。这里 moved 非空却 entries 为空，
     只可能是「推了一格又推回来」这种净位移为零的路径 —— 那它确实和原生宇宙一模一样，
     没有任何值得上链的东西，当成"没动"处理，和 NO_MOVE 走同一条界面提示。 */
  if (!entries.length) {
    const e = new Error('推来推去回到了原点，没有位移可记');
    e.code = 'NO_MOVE';
    throw e;
  }
  const opsHex = encodeOps(entries);

  return { card: newCard, cardHash, costBang: rescueWei(cost).toString(), opsHex };
}

/* ---- ARCBANG 定价（specs/arcbang-v1.md §3.3）----
   上面整套 UNIT_COST / STRING_GAS / DIFFICULTY 算出来的 cost 是「BANG 枚数」（v5：一次救援 ≈ 12,000）。
   Arc 上没有代币，救援付的是 native USDC 并全额打进 0x…dEaD，合约要求 msg.value == cost，
   照旧返回 12,000e18 就是向用户要 12,000 美元。所以在 Arc 链上按比例换算：
     12,000 BANG ≈ 3 USDC（ARCBANG_RESCUE_SCALE=4000，可用环境变量改），
     再兜一个下限 0.5 USDC（ARCBANG_RESCUE_MIN_USDC），免得极小位移算出几分钱。
   相对难度表一个字不动 —— 越死越贵的比例关系在两条链上一样。字段名仍叫 costBang：
   前端与签名链路（index.js 里 BigInt(out.costBang) 进摘要）都认这个名字，值的单位随链走。 */
const ARC_CHAIN_IDS = new Set([5042, 5042002]);
function rescueWei(costUnits) {
  const wei = costUnits * E18;
  /* 直接读环境变量，**不 require('./chain.js')**：selftest 会先单独调 evaluate 再加载 index.js，
     那时 env 还没设链；这里若先把 chain.js 拉起来，它会以 NaN 的 chainId 被缓存，
     后面 index.js 再拿到的就是这份 NaN → 签名摘要 underflow。 */
  const chainId = Number(process.env.ARCBANG_CHAIN_ID);
  if (!ARC_CHAIN_IDS.has(chainId)) return wei;
  const scale = BigInt(Math.max(1, Math.floor(Number(process.env.ARCBANG_RESCUE_SCALE || 4000))));
  const minUsdc = Number(process.env.ARCBANG_RESCUE_MIN_USDC || 0.5);
  const minWei = BigInt(Math.round(minUsdc * 1e6)) * 10n ** 12n;
  const scaled = wei / scale;
  return scaled < minWei ? minWei : scaled;
}

/* ============================================================ 提示：下一格该推谁

   爬山要"试着推一格再看分数"，所以它离不开半径表 —— 于是它也只能在服务端跑。
   浏览器那边留下的是**不含秘密的那一半**：score() 和 diagnose() 都是对着模拟结果
   查表，推一格多远跟它们无关，所以「卡在哪」仍然是本地实时刷新的。

   返回值里**只有 key / dir 和几个标量**：绝不能把 fastSuggest 内部那份
   candidate params/sim 带出去 —— 那等于把"往这个方向一格有多长"直接送给客户端，
   40 次就能把整张半径表拼回来。 */
function suggestNext(card) {
  const params = P.normalize(card.params, MOD);
  const sim = E.simulate(params, { modules: MOD, register: false });
  const s = SANDBOX.fastSuggest(HINT, params, MOD, {
    sim: sim,
    allKeys: Object.keys(SPECS),
    step: stepOnce                        // ← 半径只从这里进去，不往外走
  });
  if (!s) return null;
  return {
    key: s.key,
    dir: s.dir < 0 ? -1 : 1,
    gain: typeof s.gain === 'number' ? +s.gain.toFixed(4) : null,
    tried: s.tried || 0,
    narrowed: !!s.narrowed,
    outcome: s.outcome || null,
    // 这一格会让哪几道门从"没过"变成"过了"。门的名字前端本来就有，不是秘密
    fixes: SANDBOX.fixedGates(HINT, sim, s.sim)
  };
}

/**
 * 干预签名的摘要，必须与合约 intervene() 里逐字段同序同类型。
 *
 * 倒数第二个 opsHash = keccak256(ops)。为什么是哈希不是 ops 本身：
 * abi.encode 一个变长 bytes 会插入偏移和长度，编码长度随 ops 变；
 * 换成定长的 bytes32，摘要永远是定长的字，两边对齐才对得死。
 *
 * 它进摘要的意义：ops 一旦被改一个字节，签名当场失效 ——
 * 于是链上那段位移记录是**服务端认过的那一份**，不是调用者随手编的。
 *
 * v2 再在末尾加 minter（address = 链上 msg.sender）：NFT 转手之后
 * 旧持有人拿到的签名不能被新持有人拿去烧币，也挡住别人抄走 mempool 里的拯救。
 * v1 不加这个字，编码与改前逐字节相同。
 */
function interveneDigest(chainId, contractAddr, tokenId, oldCardHash, newCardHash, outcome, rarity, cost, deadline, opsHash, minter) {
  const types = ['uint256', 'address', 'uint256', 'bytes32', 'bytes32', 'uint8', 'uint8', 'uint256', 'uint64', 'bytes32'];
  const values = [chainId, contractAddr, tokenId, oldCardHash, newCardHash, outcome, rarity, cost, deadline, opsHash];
  if (sigV2()) {
    assertMinter(minter);
    types.push('address');
    values.push(minter.toLowerCase());
  }
  return keccak256(coder.encode(types, values));
}

/** ops 的哈希。合约里是 keccak256(ops)，这里对同一段字节做同一件事 */
/* 造物系列（MirrorCrafted.mintCrafted）的摘要。字段序与类型照合约
   MirrorCrafted.sol mintCrafted 的 abi.encode **逐字对齐**：
   (chainid, 合约地址, originHash, originBlock, opsHash, cardHash, outcome, rarity, cost, deadline)
   v2 再在末尾加 minter（address = msg.sender）。
   originBlock 是 uint64 —— 用 uint256 编出来的摘要链上验不过，而报错只有一个 BadSig。 */
function craftDigest(chainId, craftedAddr, originHash, originBlock, opsHash, cardHash, outcome, rarity, cost, deadline, minter) {
  const types = ['uint256', 'address', 'bytes32', 'uint64', 'bytes32', 'bytes32', 'uint8', 'uint8', 'uint256', 'uint64'];
  const values = [chainId, craftedAddr, originHash, originBlock, opsHash, cardHash, outcome, rarity, cost, deadline];
  if (sigV2()) {
    assertMinter(minter);
    types.push('address');
    values.push(minter.toLowerCase());
  }
  return keccak256(coder.encode(types, values));
}

function opsHashOf(opsHex) {
  return keccak256(opsHex && String(opsHex).startsWith('0x') ? opsHex : '0x' + String(opsHex || ''));
}

module.exports = {
  evaluate, interveneDigest, craftDigest, opsHashOf, UNIT_COST, DIFFICULTY,
  applyOps, stepOnce, suggestNext, MAX_OPS, MAX_TOTAL_STEPS,
  /* 编解码与复算。导出它们不是为了内部调用，而是因为**任何人都该能重放一次干预**：
     链上有 ops、开源仓库里有引擎，缺的只是这三个函数。自检里那条"只用 blockHash 和
     opsHex 重算出同一个 cardHash"走的就是这条路。 */
  encodeOps, decodeOps, applyOpsHex, cardHashOf, cardHashFromCard, paramFingerprint, quantizeUnit, unquantize,
  OPS_SCALE, OPS_ITEM_BYTES, PARAM_KEYS, CARD_SHAPE
  /* STEP 故意不导出：它没有任何服务端之外的用途，而一旦有人图省事把它塞进
     某个 /health 之类的响应里，半径表就跟着漏了。 */
};
