/*
 * web/hint.js —— 诊断与提示（模块 C）
 * ------------------------------------------------------------
 * 把 半径表的离线标定脚本 的贪心爬山搬进浏览器，再加上「卡在哪、该动谁」的人话诊断。
 *
 * 为什么评分必须是连续的：12 个离散结局构成的是平台——玩家推一格，标签纹丝不动，
 * 爬山当场就停（实测救活率 33%）；26 道布尔门也只有 35%。把碳氧产率、Hoyle 偏移、
 * 水窗口、涨落余量这些**看不见的余量**喂进去，救活率才跳到 83%、中位 4 步。
 * 所以 score() 与命令行版逐项一致，一个都不许省——省掉哪一项就等于把玩法废掉。
 *
 * ------------------------------------------------------------
 * 「推一格有多远」不在这个文件里（2026-08-19 改）：
 * 一格 = 该参数「生存半径」的一小截，而那张半径表是整套推导里唯一藏得住的东西
 * —— 参数表和物理引擎本来就必须发到浏览器里跑，只有它能留在服务端。
 * 这个文件会被打进站点包，所以它一个数都不能带。
 *
 * 于是爬山这一半（suggest / autoSolve / step）改成**要调用方注入 stepFn**：
 *   stepFn(params, key, dir, modules) → 推一格之后的新参数
 * 服务端（server/intervene.js）注入真正的那个；浏览器里没人注入，这几个函数
 * 一律返回 null —— 界面改走 /api/intervene 拿提示。
 * 留在本地的是**不含秘密的那一半**：score() 和 diagnose() 只对着模拟结果查表，
 * 跟一格多远毫无关系，所以「卡在哪」照旧本地实时刷新，不用等网络。
 *
 * API：
 *   score(sim)                                   → number（越大越接近有生命）
 *   diagnose(sim)                                → [{gate, label, why, params[]}]
 *   suggest(params, modules, stepFn)             → {key, dir, gain, label, ...} | null
 *   autoSolve(params, modules, maxSteps[, opts]) → 同步返回结果；opts.step 必给，opts.onDone 则分片跑
 *   autoSolveSync(params, modules, maxSteps, stepFn) → 永远同步（Node 自测用）
 *   step(params, key, dir, modules, stepFn)      → 推一格后的新参数（不改原对象）
 *   gatesPassed(sim) / GATES / selfTest()
 *
 * 依赖：MirrorParams、MirrorEngine（浏览器全局；Node 下 require ../engine/*）。
 * 加载无副作用：只挂 window.MirrorHint / module.exports，不碰 DOM、不跑模拟。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../engine/params.js'), require('../engine/engine.js'));
  } else {
    root.MirrorHint = factory(root.MirrorParams, root.MirrorEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (Params, Engine) {
  'use strict';

  /* ============================================================ 常量 */

  // 哈希派生固定用「模块全关」的 20 个基础参数，干预也必须在同一张参数表上走，
  // 否则 stringGas 一开 dimS 就变成派生量，玩家推 D 会推了个寂寞。
  var MODULES_OFF = { stringGas: false, slowRoll: false, landscape: false, altBiochem: false };

  /* 这里原本有一张「生存半径」表（每个参数往下/往上还能推多远仍保持
     OBSERVERS_POSSIBLE）。它已经搬回 server/intervene.js，理由见文件头：
     半径是这套推导里唯一藏得住的东西，而这个文件是要发到浏览器里去的。
     一格的长度现在只由服务端的 stepFn 决定，本地一个数都不留。 */

  var DEFAULT_MAX_STEPS = 60;
  var ALIVE = 'OBSERVERS_POSSIBLE';

  /* ============================================================ 依赖（惰性取） */

  /* 浏览器里脚本顺序万一被别人改动，加载时就抛错会连累整页；
     等到真正调用时再取一次全局，取不到才抱怨。 */
  var P = Params || null, E = Engine || null;
  function deps() {
    if (!P || !E) {
      var g = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null);
      if (g) { P = P || g.MirrorParams; E = E || g.MirrorEngine; }
    }
    if (!P || !E) throw new Error('MirrorHint 需要 params.js 与 engine.js（浏览器里请先引入它们）');
  }
  var KEYS = null;
  function keys() {
    deps();
    // 20 个基础参数，顺序与 MirrorBnbHash.PARAM_KEYS 相同；直接读 Params 是为了不依赖 archash.js
    if (!KEYS) KEYS = P.BASE.map(function (d) { return d.key; });
    return KEYS;
  }

  /* ============================================================ 26 道门：定义 + 人话 + 该动谁 */

  /* params 列的选法：只列**直接进入该判据公式**的参数（见 engine/engine.js 对应段落），
     多列几个看似贴心，实则把玩家的注意力摊薄——提示的价值在于收窄搜索面。 */
  var GATES = [
    { gate: 'dims.orbitsOK', section: 'dims', key: 'orbitsOK', want: true, label: '稳定轨道',
      why: 'D≥4 时引力与库仑势按 r^−(D−1) 变化，行星轨道和电子基态都不再稳定——空间维数得推回 3。',
      params: ['dimS'] },
    { gate: 'dims.gravityOK', section: 'dims', key: 'gravityOK', want: true, label: '引力能聚物',
      why: 'D≤2 的牛顿引力不再是吸引势，物质永远聚不成团。',
      params: ['dimS'] },
    { gate: 'dims.fractional', section: 'dims', key: 'fractional', want: false, label: '维数是整数',
      why: '分数维没有严格的物理定义，引擎只能按 D 连续插值外推；把 D 推到整数 3.0。',
      params: ['dimS'] },
    { gate: 'baryons.cpViolation', section: 'baryons', key: 'cpViolation', want: true, label: 'CP 破坏',
      why: 'Sakharov 条件之一：δ_CKM 太接近 0 或代数少于 3，物质与反物质完全对消，什么都不剩。',
      params: ['ckmPhase', 'generations'] },
    { gate: 'baryons.hasBaryons', section: 'baryons', key: 'hasBaryons', want: true, label: '有重子',
      why: '没有 CP 破坏，或重子密度本身为 0：没有物质，后面每一步都无从谈起。',
      params: ['ckmPhase', 'generations', 'omegaBh2'] },
    { gate: 'recombination.sahaWindow', section: 'recombination', key: 'sahaWindow', want: true, label: '复合能发生',
      why: 'Saha 方程解不出复合红移：电子始终不被原子核抓住，宇宙对光不透明，也没有中性气体去造恒星。',
      params: ['alpha', 'electronMass', 'omegaBh2', 'tcmb'] },
    { gate: 'bbn.deuteronBound', section: 'bbn', key: 'deuteronBound', want: true, label: '氘核束缚',
      why: '氘核不束缚，大爆炸核合成卡在氘瓶颈，恒星连第一步燃料都没有。',
      params: ['alphaSMZ', 'mUp', 'mDown', 'alpha'] },
    { gate: 'bbn.diprotonBound', section: 'bbn', key: 'diprotonBound', want: false, label: '双质子不成键',
      why: '双质子一旦能结合，氢会在大爆炸的几分钟里烧光——恒星没有燃料，也没有水。',
      params: ['alphaSMZ', 'alpha', 'mUp', 'mDown'] },
    { gate: 'bbn.deuteronBetaStable', section: 'bbn', key: 'deuteronBetaStable', want: true, label: '氘核内中子不衰变',
      why: 'm_n−m_p 太大（Δ > B_d + mₑ），氘核里的中子直接 β 衰变掉；把上下夸克的质量差收窄。',
      params: ['mDown', 'mUp', 'alphaSMZ'] },
    { gate: 'structure.structureFormed', section: 'structure', key: 'structureFormed', want: true, label: '星系形成',
      why: '涨落在增长被冻结前没能非线性化：原初涨落太小、暗物质太少，或者膨胀把一切拉平了。',
      params: ['As', 'omegaCh2', 'ns'] },
    { gate: 'structure.weinbergOK', section: 'structure', key: 'weinbergOK', want: true, label: '涨落跑赢暗能量',
      why: '暗能量超过 Weinberg 上界 ρ_Λ ≲ ρ_m(a_col)：星系还没坍缩，宇宙已经被拉散。',
      params: ['omegaLambda', 'As', 'omegaCh2'] },
    { gate: 'stars.canIgnite', section: 'stars', key: 'canIgnite', want: true, label: '恒星能点燃',
      why: '点火下限质量顶到了辐射压上限（或氘核不束缚、α 过大）：没有一颗恒星能稳定燃烧。',
      params: ['alpha', 'electronMass', 'alphaSMZ'] },
    { gate: 'stars.heavyElements', section: 'stars', key: 'heavyElements', want: true, label: '能炼到铁',
      why: '核库仑极限 Z_max ∝ 1/α 卡在铁以下：恒星炼不出重元素，没有金属也没有岩石行星。',
      params: ['alpha', 'alphaSMZ'] },
    { gate: 'stars.carbonOK', section: 'stars', key: 'carbonOK', want: true, label: '碳核稳定',
      why: 'Z_max < 6：碳核被库仑排斥撑散，碳基化学从根上不成立——α 要调小。',
      params: ['alpha'] },
    { gate: 'stars.supernovaOK', section: 'stars', key: 'supernovaOK', want: true, label: '超新星能爆',
      why: 'G_F ∝ v⁻²：希格斯真空期望值太大时中微子逃得太快，超新星哑火，重元素锁死在恒星尸体里。',
      params: ['higgsVev'] },
    { gate: 'stars.outOfAdamsScope', section: 'stars', key: 'outOfAdamsScope', want: false, label: '恒星标度可信',
      why: '点火质量已越出 Adams 2008 牛顿标度的适用范围（≳300 M⊙），这类天体更可能直接坍缩成黑洞。',
      params: ['alphaSMZ', 'alpha', 'electronMass'] },
    { gate: 'atoms.hydrogen', section: 'atoms', key: 'hydrogen', want: true, label: '有氢',
      why: '质子衰变、氢被电子俘获，或双质子束缚把氢烧光了：没有氢就没有水，也没有恒星燃料。',
      params: ['mDown', 'mUp', 'electronMass', 'alphaSMZ'] },
    { gate: 'atoms.atoms', section: 'atoms', key: 'atoms', want: true, label: '原子稳定',
      why: 'Zα 逼近 1：内层电子相对论性坠落、真空自发产生正负电子对，多电子原子撑不住。',
      params: ['alpha', 'mDown', 'mUp'] },
    { gate: 'atoms.molecules', section: 'atoms', key: 'molecules', want: true, label: '分子有形状',
      why: 'Born–Oppenheimer 参数 (mₑ/mₚ)^{1/4} ≥ 0.45：电子与核质量可比，分子没有固定几何。',
      params: ['electronMass', 'alphaSMZ'] },
    { gate: 'atoms.chemistry', section: 'atoms', key: 'chemistry', want: true, label: '化学能复杂化',
      why: '缺氢、缺碳或分子不刚性——元素表撑不到能拼出有机分子的地步。',
      params: ['alpha', 'electronMass', 'alphaSMZ'] },
    { gate: 'planets.timeOK', section: 'planets', key: 'timeOK', want: true, label: '时间够用',
      why: '恒星主序寿命不足 5 亿年，或从星系形成到宇宙终结的窗口不到 10 亿年：来不及演化出任何东西。',
      params: ['alpha', 'alphaSMZ', 'omegaLambda', 'H0'] },
    { gate: 'planets.qOK', section: 'planets', key: 'qOK', want: true, label: '涨落幅度在窗口内',
      why: 'Q_eff 越出 10⁻⁶–10⁻⁴：太大则星系过密、恒星近距交会踢飞行星；太小则气体冷却不下来。',
      params: ['As', 'ns'] },
    { gate: 'planets.planetsOK', section: 'planets', key: 'planetsOK', want: true, label: '岩石行星能形成',
      why: '缺重元素、超新星哑火或化学不成立，尘埃与岩石无从谈起。',
      params: ['alpha', 'higgsVev', 'alphaSMZ'] },
    { gate: 'biochem.hoyleOK', section: 'biochem', key: 'hoyleOK', want: true, label: 'Hoyle 共振在容许区间',
      why: '三氦过程对核力 ±0.5%、电磁 ±4% 极敏感（Oberhummer 2000）：ξ 离 0 太远，碳或氧的产率掉两个数量级。',
      params: ['alpha', 'alphaSMZ', 'mUp', 'mDown'] },
    { gate: 'biochem.waterOK', section: 'biochem', key: 'waterOK', want: true, label: '有液态水窗口',
      why: '液态水轨道 d_w = √L·(α²mₑ)⁻²：没有氧、分子不刚性或恒星不亮，溶剂窗口就是关的。',
      params: ['alpha', 'electronMass', 'alphaSMZ'] },
    { gate: 'biochem.complexOK', section: 'biochem', key: 'complexOK', want: true, label: '复杂化学可行',
      why: '周期表在 Z<16 截止（没有硅、磷、硫），或 α≥0.1 让化学能标与相对论修正失控。',
      params: ['alpha', 'alphaSMZ'] }
  ];

  /* 有几种死法不在这 26 道门里：坍缩、撕裂、原初黑洞、以及门全过但可居住性 <0.4。
     只报「门全过」等于什么都没说，所以按结局再给一层兜底建议。 */
  var OUTCOME_FIX = {
    UNSTABLE_ORBITS: { label: '空间维数不是 3', why: 'D≥4 没有稳定轨道，D≤2 引力不吸引；先把维数推回 3。', params: ['dimS'] },
    BEYOND_MODEL_DIM: { label: '超出模型范围（D≠3）', why: '核合成/恒星/化学的公式只对 3 维成立；把 D 推回 3.0，其余判据才有意义。', params: ['dimS'] },
    BIG_CRUNCH: { label: '大挤压', why: '闭合几何在恒星时代结束前就转向坍缩：调曲率或加大暗能量/降低物质密度，把寿命拉长。', params: ['omegaK', 'omegaLambda', 'omegaCh2', 'H0'] },
    BIG_RIP: { label: '大撕裂', why: '暗能量把一切拉散得太快，结构留不住。', params: ['omegaLambda', 'omegaCh2'] },
    BLACK_HOLE_DOMINATED: { label: '黑洞主导', why: '原初涨落太大：视界尺度的团块在冷却成恒星前直接落入视界——调小 A_s 或压低谱指数。', params: ['As', 'ns'] },
    HEAT_DEATH_NO_STRUCTURE: { label: '热寂 · 无结构', why: '涨落在冻结前没能非线性化，或暗能量越过 Weinberg 上界。', params: ['As', 'omegaCh2', 'ns', 'omegaLambda'] },
    NO_ATOMS: { label: '没有原子', why: '没有重子、质子衰变，或 Zα→1 电子壳层不稳定。', params: ['alpha', 'mDown', 'ckmPhase'] },
    NO_STARS: { label: '没有恒星', why: '恒星质量窗口关闭或氘核不束缚：点火这一步过不去。', params: ['alpha', 'alphaSMZ', 'electronMass'] },
    NO_CHEMISTRY: { label: '无化学', why: '缺氢、缺碳，或分子没有刚性。', params: ['alpha', 'electronMass', 'alphaSMZ'] },
    NO_CARBON_CHEMISTRY: { label: '无碳-水型化学', why: '三氦过程产不出足够的碳/氧，或没有液态水窗口、复杂化学受限。', params: ['alpha', 'alphaSMZ', 'mUp', 'mDown'] },
    STARS_NO_LIFE: { label: '有恒星无生命', why: '每道门都过了，但可居住性 <0.4：多半是恒星寿命太短、宜居窗口太窄或涨落幅度偏离窗口。', params: ['alpha', 'As', 'ns', 'omegaLambda', 'higgsVev'] }
  };

  // 这几种结局即便门全过也要给建议——它们的死因本来就不在门里
  var NOT_GATED = { BIG_CRUNCH: 1, BIG_RIP: 1, BLACK_HOLE_DOMINATED: 1, STARS_NO_LIFE: 1, BEYOND_MODEL_DIM: 1 };

  var GATE_BY_ID = {};
  GATES.forEach(function (g) { GATE_BY_ID[g.gate] = g; });

  /* ============================================================ 评分 */

  function fin(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d || 0); }
  function outcomeId(sim) { return sim && sim.outcome ? sim.outcome.id : null; }
  function isAlive(sim) { return outcomeId(sim) === ALIVE; }

  /** 26 道门里过了几道；模拟失败或某段缺失都算没过 */
  function gatesPassed(sim) {
    if (!sim || !sim.calc) return 0;
    var n = 0;
    GATES.forEach(function (g) {
      var sec = sim.calc[g.section];
      if (sec && !!sec[g.key] === g.want) n++;
    });
    return n;
  }

  /**
   * 与 半径表的离线标定脚本 的连续版评分逐项一致（实测 83% 救活率、中位 4 步）。
   * 门数给粗粒度阶梯，后面几项是结局标签看不见的余量——正是它们让「推一格」有反馈。
   */
  function score(sim) {
    if (!sim) return -1;
    var c = sim.calc || {}, b = c.biochem || {}, st = c.structure || {}, sr = c.stars || {};
    var hab = (typeof sim.habitability === 'number' && isFinite(sim.habitability)) ? sim.habitability : 0;

    var s = 0;
    s += gatesPassed(sim) * 10;                                  // 粗粒度阶梯
    s += fin(b.fC) * 3 + fin(b.fO) * 3;                          // 碳氧产率
    s += 2 / (1 + Math.abs(fin(b.xi)));                          // Hoyle 共振偏移，越小越好
    var dw = fin(b.dWater, 1);
    if (dw > 0) s += 2 / (1 + Math.abs(Math.log10(dw)));         // 液态水窗口，越接近 1 AU 越好
    s += 2 / (1 + Math.abs(fin(st.weinbergRatio, 1)));           // 结构涨落余量
    s += Math.min(1, fin(sr.tMSGyr) / 10);                       // 恒星寿命
    s += hab * 5;
    if (isAlive(sim)) s += 50;
    return s;
  }

  /* ============================================================ 推一格 */

  function runSim(params, modules) {
    deps();
    // 引擎在极端参数下会抛（比如质量标度发散）；对爬山来说「抛了」就是「更差」，不该中断整轮
    // register:false —— 这是试探性模拟（suggest 一次 40 遍、autoSolve 最多 2400 遍），
    // 不加的话每一遍都会 cat.stamp() 写一次 localStorage，把"你已启动 N 次大爆炸"刷爆
    try { return E.simulate(params, { modules: modules || MODULES_OFF, register: false }); } catch (e) { return null; }
  }

  /**
   * 把 key 往 dir 方向推一格，返回**新**参数对象（原对象不动）。
   * 距离由调用方注入的 stepFn 决定 —— 这个文件不知道一格有多长，也不该知道。
   * 没注入就返回 null（而不是拿个瞎猜的步长顶上：爬山用错步长会给出
   * 看起来煞有介事、实际南辕北辙的建议，比明说"这儿算不了"糟得多）。
   */
  function stepParams(params, key, dir, modules, stepFn) {
    deps();
    var ms = modules || MODULES_OFF;
    if (typeof stepFn !== 'function') return null;
    var next = stepFn(params, key, dir < 0 ? -1 : 1, ms);
    return next ? P.normalize(next, ms) : null;
  }

  /* ============================================================ 爬山一步 */

  function paramLabel(key) {
    deps();
    var d = P.byKey[key];
    return d ? (d.symbol + '（' + d.name + '）') : key;
  }

  /** 这一步让哪些门从「没过」变成「过了」——提示里写清楚才叫提示 */
  function newlyPassed(before, after) {
    var out = [];
    GATES.forEach(function (g) {
      var a = before && before.calc && before.calc[g.section];
      var b = after && after.calc && after.calc[g.section];
      var wasOK = !!(a && !!a[g.key] === g.want), nowOK = !!(b && !!b[g.key] === g.want);
      if (!wasOK && nowOK) out.push(g.label);
    });
    return out;
  }

  /** 20 参数 × 2 方向全试一遍，取增益最大的那一步；与命令行版同判据（严格变好才算） */
  function bestMove(params, modules, sim, s, stepFn) {
    var ks = keys(), best = null, i, d;
    for (i = 0; i < ks.length; i++) {
      for (d = -1; d <= 1; d += 2) {
        var np = stepParams(params, ks[i], d, modules, stepFn);
        if (!np) continue;                             // 没注入 stepFn：这一格算不出来
        var nsim = runSim(np, modules);
        var sc = score(nsim);
        if (sc > s + 1e-9 && (!best || sc > best.score)) {
          best = { params: np, sim: nsim, score: sc, key: ks[i], dir: d, gain: sc - s };
        }
      }
    }
    return best;
  }

  /**
   * 下一步该推谁。约 40 次 simulate ≈ 80 ms，同步跑得起。
   * 返回 null 表示贪心爬不动了（局部最优）——界面上要老实说「提示也没辙」；
   * 没注入 stepFn 时同样返回 null（浏览器里就是这种情况，界面改问服务端）。
   */
  function suggest(params, modules, stepFn) {
    deps();
    if (typeof stepFn !== 'function') return null;
    var ms = modules || MODULES_OFF;
    var p0 = P.normalize(params, ms);
    var sim = runSim(p0, ms);
    var s = score(sim);
    var best = bestMove(p0, ms, sim, s, stepFn);
    if (!best) return null;
    var fixes = newlyPassed(sim, best.sim);
    return {
      key: best.key,
      dir: best.dir,
      gain: best.gain,
      label: (best.dir > 0 ? '调高 ' : '调低 ') + paramLabel(best.key) + ' 一格',
      fixes: fixes,                                  // 这一步会解锁哪几道门
      outcome: outcomeId(best.sim),                  // 推完之后的结局（可能还没变）
      score: best.score,
      params: best.params                            // 推完的参数，界面想直接用就用
    };
  }

  /* ============================================================ 一路爬到底 */

  function makeSolver(params, modules, maxSteps, stepFn) {
    deps();
    var ms = modules || MODULES_OFF;
    var st = {
      params: P.normalize(params, ms),
      modules: ms,
      step: typeof stepFn === 'function' ? stepFn : null,
      max: (typeof maxSteps === 'number' && maxSteps > 0) ? maxSteps : DEFAULT_MAX_STEPS,
      steps: 0, path: [], done: false, solved: false, stuck: false
    };
    st.sim = runSim(st.params, ms);
    st.score = score(st.sim);
    return st;
  }

  /** 走一步；返回 true 表示还得继续。先判活再判步数，与命令行版 revive() 同序 */
  function tick(st) {
    if (st.done) return false;
    if (!st.step) { st.done = true; st.stuck = true; return false; }   // 没注入步长，一步都走不了
    if (isAlive(st.sim)) { st.done = true; st.solved = true; return false; }
    if (st.steps >= st.max) { st.done = true; return false; }
    var best = bestMove(st.params, st.modules, st.sim, st.score, st.step);
    if (!best) { st.done = true; st.stuck = true; return false; }   // 局部最优，贪心救不了
    st.params = best.params; st.sim = best.sim; st.score = best.score;
    st.path.push({ key: best.key, dir: best.dir, gain: best.gain });
    st.steps++;
    return true;
  }

  function result(st) {
    return {
      solved: !!st.solved,
      steps: st.steps,
      path: st.path.slice(),
      finalOutcome: outcomeId(st.sim),
      finalScore: st.score,
      finalParams: st.params,
      stuck: !!st.stuck,
      done: !!st.done
    };
  }

  /** 同步版：60 步 = 2400 次 simulate ≈ 5 s，浏览器里会整页卡死，只给 Node 自测和小 maxSteps 用 */
  function autoSolveSync(params, modules, maxSteps, stepFn) {
    var st = makeSolver(params, modules, maxSteps, stepFn);
    while (tick(st)) { /* 一直爬 */ }
    return result(st);
  }

  /**
   * autoSolve(params, modules, maxSteps, {step})             → 同步跑完，返回结果对象
   * autoSolve(params, modules, maxSteps, {step, onDone})     → 分片跑，onDone(结果) 在跑完时回调
   * autoSolve(params, modules, maxSteps, {step, onDone, onStep, chunk}) → 同上，另给每步进度
   *
   * opts.step 就是那个「推一格」函数，必须给（见文件头）；没给的话它一步都走不动，
   * 返回的结果里 stuck=true。
   *
   * 分片版返回 {cancel:fn} 而不是结果：一步就要 80 ms，同步 60 步足够让页面失去响应，
   * 所以每片之间用 setTimeout 把主线程还给浏览器（关掉面板时记得 cancel）。
   */
  function autoSolve(params, modules, maxSteps, opts) {
    var o = (typeof opts === 'function') ? { onDone: opts } : (opts || {});
    if (typeof o.onDone !== 'function') return autoSolveSync(params, modules, maxSteps, o.step);

    var st = makeSolver(params, modules, maxSteps, o.step);
    var chunk = (typeof o.chunk === 'number' && o.chunk > 0) ? Math.floor(o.chunk) : 1;
    var cancelled = false;

    function slice() {
      if (cancelled) return;
      var i = 0, more = true;
      while (more && i < chunk) { more = tick(st); i++; }
      if (typeof o.onStep === 'function') o.onStep(result(st));
      if (!more) { o.onDone(result(st)); return; }
      setTimeout(slice, 0);
    }
    setTimeout(slice, 0);                     // 先返回句柄再开跑，调用方来得及存下 cancel
    return { cancel: function () { cancelled = true; }, isCancelled: function () { return cancelled; } };
  }

  /* ============================================================ 诊断 */

  /**
   * 卡在哪、该动哪些参数。纯查表，不跑模拟——界面每推一格都要刷新，跑模拟就卡了。
   * 返回顺序即因果顺序（维数 → 重子 → 复合 → 核合成 → 结构 → 恒星 → 原子 → 行星 → 生化）：
   * 前面的门不过，后面的门大多是连坐，玩家该先修最上面那条。
   */
  /* ---------- 维度类的门「该推谁」，取决于弦气模块开没开

     上面那几条 dims.* 的门、以及 UNSTABLE_ORBITS / BEYOND_MODEL_DIM 这两个结局，
     params 里写的都是 ['dimS']。**那只在弦气模块关掉的时候成立** ——
     那时 D 是直接输入的参数，界面上确实有一颗叫 D 的旋钮。

     可服务端固定跑 MODULES_ON（弦气开），那边 **dimS 根本不在参数表里**：
     D 是 stringGasT / windingDensity / compactStiffness 派生出来的。
     于是界面一边说「该推的是：D」，一边在 23 个参数里找不到任何叫 D 的东西 ——
     等于让玩家去拧一颗不存在的旋钮。这是"不够智能"里最实的一条。

     （旁证：web/intervene.js 的 narrowKeys 里那句"第一条是维数类的根因就到此为止"，
     防的正是这个 —— dimS 被 allKeys 过滤掉之后，收窄结果空了，只好跨门去凑数，
     凑出来的是一堆跟维度毫无关系的参数。根因在这儿，不在那儿。）

     判据用 sim 自己带的 dims.emergent：它非空 ⟺ 弦气模块开着、D 是涌现量。
     不去读 modules，因为 diagnose() 的调用方（服务端 suggestNext、面板每帧刷新）
     手里未必有那份 modules，而 sim 一定是现成的。 */
  var DIM_PARAMS_SG = ['stringGasT', 'windingDensity', 'compactStiffness'];
  function dimParamsOf(sim) {
    var d = sim && sim.calc && sim.calc.dims;
    return (d && d.emergent) ? DIM_PARAMS_SG.slice() : ['dimS'];
  }
  /** 表里写死的 ['dimS'] 在弦气开着时换成那三个真旋钮；其余的门原样放行 */
  function fixParams(ps, sim) {
    if (ps && ps.length === 1 && ps[0] === 'dimS') return dimParamsOf(sim);
    return ps.slice();
  }

  function diagnose(sim) {
    var list = [], i;
    if (!sim || !sim.calc) return list;
    for (i = 0; i < GATES.length; i++) {
      var g = GATES[i], sec = sim.calc[g.section];
      var ok = sec ? (!!sec[g.key] === g.want) : false;
      if (!ok) {
        list.push({
          gate: g.gate, label: g.label, why: g.why, params: fixParams(g.params, sim),
          section: g.section, key: g.key, want: g.want
        });
      }
    }
    var id = outcomeId(sim);
    if (id && id !== ALIVE && (list.length === 0 || NOT_GATED[id])) {
      var f = OUTCOME_FIX[id];
      if (f) {
        list.push({
          gate: 'outcome.' + id, label: f.label, why: f.why, params: fixParams(f.params, sim),
          section: 'outcome', key: id, want: null
        });
      }
    }
    return list;
  }

  /* ============================================================ 自检（要调用才跑） */

  /* 自检用的假步长：unit 空间上固定挪 2%。它和真正的一格没有任何关系
     （真的那个由服务端的生存半径决定），只是用来验证爬山这套机械还转得动。
     写死一个常数是有意的 —— 这个文件里不许出现任何跟半径沾边的数。 */
  function probeStep(params, key, dir, modules) {
    var u = Math.min(1, Math.max(0, P.toUnit(key, params[key]) + dir * 0.02));
    var next = {}, ks = keys(), i;
    for (i = 0; i < ks.length; i++) next[ks[i]] = params[ks[i]];
    next[key] = P.fromUnit(key, u);
    return P.normalize(next, modules);
  }

  /** node -e "console.log(require('./web/hint.js').selfTest())" */
  function selfTest() {
    deps();
    var fails = [];
    var ours = runSim(P.defaults(MODULES_OFF), MODULES_OFF);
    if (gatesPassed(ours) !== GATES.length) fails.push('我们的宇宙应当 26/26，实得 ' + gatesPassed(ours));
    if (!isAlive(ours)) fails.push('我们的宇宙应当是 OBSERVERS_POSSIBLE');
    var sOurs = score(ours);
    if (!(sOurs > 300)) fails.push('我们的宇宙评分应当 >300（门 260 + 成功 50 + 余量），实得 ' + sOurs);
    if (diagnose(ours).length !== 0) fails.push('我们的宇宙不该有诊断项');

    // 随手造一个死宇宙：α 拉大到碳核撑不住
    var dead = P.normalize({ alpha: 0.2 }, MODULES_OFF);
    var dsim = runSim(dead, MODULES_OFF);
    if (isAlive(dsim)) fails.push('α=0.2 不该还活着');
    if (score(dsim) >= sOurs) fails.push('死宇宙评分不该不低于我们的宇宙');
    if (diagnose(dsim).length === 0) fails.push('死宇宙的诊断不该是空的');
    if (!suggest(dead, MODULES_OFF, probeStep)) fails.push('死宇宙第一步就爬不动，不合理');
    // 没注入步长就必须老实说"算不了"，不许自己编一个顶上
    if (suggest(dead, MODULES_OFF) !== null) fails.push('没给 stepFn 时 suggest 应当返回 null');
    if (stepParams(dead, 'alpha', -1, MODULES_OFF) !== null) fails.push('没给 stepFn 时 step 应当返回 null');

    // 推一格不改原对象
    var before = dead.alpha;
    stepParams(dead, 'alpha', -1, MODULES_OFF, probeStep);
    if (dead.alpha !== before) fails.push('stepParams 改了传入的参数对象');

    return { ok: fails.length === 0, fails: fails };
  }

  return {
    GATES: GATES,
    GATE_BY_ID: GATE_BY_ID,
    OUTCOME_FIX: OUTCOME_FIX,
    MODULES_OFF: MODULES_OFF,
    gatesPassed: gatesPassed,
    score: score,
    diagnose: diagnose,
    suggest: suggest,
    autoSolve: autoSolve,
    autoSolveSync: autoSolveSync,
    step: stepParams,
    simulate: runSim,
    selfTest: selfTest
  };
});
