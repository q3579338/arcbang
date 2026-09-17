/*
 * card —— 一个区块哈希对应的那份"参数证书"
 * ------------------------------------------------------------
 * 服务端唯一的计算入口：哈希 → 派生 → 引擎 → card + cardHash。
 * 浏览器不再做这件事（specs/server-side.md 的目标 1）。
 *
 * cardHash 只用**整数**作基：blockHash + derive() 出来的 22 个整数槽 + 结局序号。
 * 为什么不把浮点参数塞进去：22 个槽是 keccak 的直接产物，任何机器上逐位相同；
 * 而 params 里的浮点经过 Math.log/exp/cos/pow，这些函数的最后一个 ulp
 * 在不同 V8 版本/平台上并不保证一致。以整数为基，指纹才是真的可复现。
 *
 * 结局（outcome）本身是引擎跑浮点跑出来的，所以它带着上面那点不确定性。
 * 它被一起签进 cardHash 里 —— 这是有意的：签名就是"服务端在这个版本下算出的是这个结局"，
 * 而不是"全宇宙唯一真理"。版本号 DERIVATION_VERSION 用来区分。
 */
'use strict';
const path = require('path');
const { keccak256, AbiCoder } = require('ethers');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'engine/bnbhash.js'));
require(path.join(ROOT, 'engine/params.js'));
const E = require(path.join(ROOT, 'engine/engine.js'));

/** 结局顺序必须与合约 outcomeName() 一致（与 web/bnb-ui.js 的 OUTCOME_ORDER 同一份） */
const OUTCOME_ORDER = [
  'UNSTABLE_ORBITS', 'BIG_CRUNCH', 'BIG_RIP', 'HEAT_DEATH_NO_STRUCTURE',
  'BLACK_HOLE_DOMINATED', 'NO_ATOMS', 'NO_CHEMISTRY', 'NO_STARS',
  'STARS_NO_LIFE', 'OBSERVERS_POSSIBLE', 'NO_CARBON_CHEMISTRY', 'BEYOND_MODEL_DIM'
];

/* 改动任何影响数值的东西都必须把它 +1，否则新旧 card 会混在一起分不出来。
   v2：G/c/h/e 四个常数各自独立（原著第八、十五章是四个并列报出来的）。
       做法是给引擎补一个引力自由度 gNewton，再从两个"参照系自由度"反解出四个比值。
       原来那 22 个参数的哈希槽位**一位没动**，所以 v1 的档位/结局/救活率标定继续有效。 */
/* v3（2026-08-20）：弦气维度的「半开」判定从 ±0.25 收成 ±0.02 的临界窄带。
   原来那半个区间把 34% 的宇宙判成分数维，而《镜子》原文是「分数维的宇宙很少见」；
   收窄后实测 5.6%。**这改变了同一个区块哈希算出来的 D、结局与稀有度**，
   所以必须升版本 —— cardHash 里签着它，不升的话新旧两套卡会共用同一个指纹。
   代价是 v2 铸的 NFT 复算不出来（服务端按 CARD_MISMATCH 拒绝，元数据退到
   「盖了章、复算不出、不给图」）。测试网上共 5 枚，已与用户确认作废重铸。 */
const DERIVATION_VERSION = 3;
/* 干预/造物卡指纹的序列化版本（原生卡走 uInt，不经过这套）。
   2 = String(float)（跨平台 Math.pow 差 1 ulp 就会换指纹）
   3 = unit 空间 uint32（与 ops 同一 1e9 刻度，整数基） */
const CARD_SHAPE = 3;

/* CODATA 2018 基准值。四个常数按 frame 里的倍率乘上去，
   得到"在声明的外部参照系里，这个宇宙的常数是多少"。 */
const SI0 = {
  c: 299792458,               // m/s
  h: 6.62607015e-34,          // J·s（普朗克常数本体，不是 ħ；原著报的是 6.626）
  e: 1.602176634e-19,         // C
  G: 6.67430e-11              // m³kg⁻¹s⁻²
};

const coder = AbiCoder.defaultAbiCoder();

/* 稀有度 0..4 = S/A/B/C/D。合约按它定价和发币，所以它必须**被签进摘要**。
   链上算不出来 —— 要知道维度和结局，那是引擎的事。
   实测占比（N=6000，2026-08-19 的标定）：
     S 能诞生观察者      1.53%
     A 三维但没活        0.62%
     B 整数维（非三维）  46.25%
     C 半整数维         28.55%
     D 一维及以下       23.05%
   注意 A 比 S 还罕见 —— 三维宇宙里 71% 直接就活了，"三维却死了"反而少见。
   但稀有 ≠ 值钱，定价按价值排：S > A > B > C > D。 */
function rarityOf(outcomeId, D) {
  if (outcomeId === 'OBSERVERS_POSSIBLE') return 0;              // S
  if (D != null && Math.abs(D - 3) < 1e-9) return 1;             // A
  if (D == null || D <= 1) return 4;                             // D
  if (Math.abs(D - Math.round(D)) < 1e-9) return 2;              // B
  return 3;                                                      // C
}
const RARITY_NAME = ['S', 'A', 'B', 'C', 'D'];

/**
 * @param {string} blockHash 0x 开头的 32 字节
 * @param {number|null} blockNumber 区块高度（不参与派生，只是记录）
 */
function buildCard(blockHash, blockNumber) {
  const hash = B.normHash(blockHash);
  const d = B.derive(hash);

  // register:false 不能少 —— 否则每次探索性 simulate 都会往目录里盖一次戳
  const r = E.simulate(d.params, { modules: d.modules, register: false });

  const outcomeId = (r.outcome && r.outcome.id) || null;
  const outcomeIdx = OUTCOME_ORDER.indexOf(outcomeId);
  if (outcomeIdx < 0) throw new Error('引擎给出的结局不在合约的 OUTCOMES 里：' + outcomeId);

  const dims = (r.calc && r.calc.dims) || {};
  const D = dims.D == null ? null : dims.D;
  const rarity = rarityOf(outcomeId, D);

  /* 指纹要盖住全部输入。v2 多了三个专用槽（引力 + 两个参照系自由度），
     它们不在 uInt 里，必须单独签进去，否则改这三个不改 cardHash。 */
  const f = d.frame;
  const cardHash = keccak256(coder.encode(
    ['bytes32', 'uint32[22]', 'uint32', 'uint32', 'uint32', 'uint8', 'uint8', 'uint32'],
    [hash, d.uInt, f.uG, f.uF1, f.uF2, outcomeIdx, rarity, DERIVATION_VERSION]
  ));

  return {
    cardHash,
    card: {
      blockHash: hash,
      blockNumber: blockNumber == null ? null : Number(blockNumber),
      derivationVersion: DERIVATION_VERSION,
      cardShape: CARD_SHAPE,
      engineVersion: r.version || null,
      // scale / p 也要带上：前端要显示"推离我们最远几倍生存半径"和"这一档占多少区块"
      tier: { id: d.tier.id, name: d.tier.name, scale: d.tier.scale, p: d.tier.p },
      outcome: { index: outcomeIdx, id: outcomeId, name: r.outcome.name, observers: !!r.outcome.observers },
      rarity: { index: rarity, name: RARITY_NAME[rarity] },
      dimension: D == null ? null : {
        D: D,
        kind: dims.kind || null,                       // 'integer' | 'fractional'
        // 维度是弦气体算出来的，不是掷骰子：把三个输入原样带出来，谁都能复算
        stringGas: dims.emergent && dims.emergent.inputs ? dims.emergent.inputs : null,
        nOpen: dims.emergent ? dims.emergent.nOpen : null
      },
      /* 四个基本常数。原著（《镜子》第八、十五章）是把 G、c、h、e 并列报出来的，
         所以四个都必须真的随宇宙变。以前做不到，是因为引擎只有 α 和 α_G 两个无量纲输入
         —— 四个有量纲的数从两个无量纲量里生不出来，缺两个自由度。v2 补齐了。

         必须说清楚的一点（不然就是在骗人）：物理内容仍然只有 α 和 α_G 两个。
         多出来的那两个自由度是**外部参照系的选择**，宇宙内部的观察者测不出来。
         我们是从外面看镜子里的宇宙，报的是外部参照系里的数 —— 这正是原著的设定。 */
      constants: (function () {
        const fr = d.frame;
        return {
          frame: 'external',       // 外部参照系；内部可观测的只有 alpha / alphaG
          c:    { si: SI0.c * fr.cRel,    ratio: fr.cRel,    unit: 'm/s' },
          h:    { si: SI0.h * fr.hbarRel, ratio: fr.hbarRel, unit: 'J·s' },
          e:    { si: SI0.e * fr.eRel,    ratio: fr.eRel,    unit: 'C' },
          G:    { si: SI0.G * fr.GRel,    ratio: fr.GRel,    unit: 'm³kg⁻¹s⁻²' },
          // 这两个才是内部可观测的
          alpha: r.constants ? r.constants.alpha : null,
          alphaInv: r.constants && r.constants.alpha ? 1 / r.constants.alpha : null,
          alphaGRel: (r.calc && r.calc.stars) ? r.calc.stars.alphaGRel : null
        };
      })(),
      params: d.params,
      uInt: d.uInt,                                    // 22 个整数槽：cardHash 的基，也是复算的入口
      modules: d.modules
    }
  };
}

module.exports = { buildCard, OUTCOME_ORDER, DERIVATION_VERSION, CARD_SHAPE, rarityOf, RARITY_NAME };
