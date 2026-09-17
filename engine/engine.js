/*
 * 镜像宇宙模拟器 · 引擎（纯 JS，无 DOM 依赖）
 * ------------------------------------------------------------
 * 只做**真实计算**：输入 = 物理学界普遍接受的基本参数（PDG/Planck，见 params.js BASE），
 * 推测性模块（弦气维数 / 慢滚暴胀 / 弦论景观）默认关闭；deriveConstants() 先算公认的派生量
 * （Λ_QCD、m_p、α_G、m_n−m_p、Ω_r、η、Q……），再交给演化层。每一步给出公式、输入、数值、阈值与判定，
 * 并标注 basis：'computed'（直接计算）| 'scaling'（标度关系/量纲估计）| 'heuristic'（启发式判据）
 * 与 status：'accepted' | 'accepted-fact, no-mechanism' | 'mainstream-model' | 'speculative'。
 *
 * 模块：
 *   A. 膨胀史      Friedmann RK4（辐射/物质/曲率/Λ）→ 年龄、H0、z_eq、结局
 *   B. 复合        Saha 方程 → z_rec（依赖 α、mₑ、η）
 *   C. BBN         m_n−m_p（Gasser–Leutwyler）、n/p 冻结、τ_n、Y_p 拟合（Steigman）、氘/双质子束缚（Pochet）
 *   D. 结构形成    线性增长 D(a) 积分 + σ(M,z) 幂律近似 + Press–Schechter 坍缩红移；Weinberg 上界；Carr 原初黑洞
 *   E. 恒星        Adams 2008 标度：M_min、M_max、主序寿命 ∝ α_G⁻¹·f(α, mₑ/mₚ)
 *   F. 原子/化学   Bohr/Dirac（Zα<1）、核库仑极限 Z_max∝1/α、Born–Oppenheimer
 *   G. 行星/宜居   Weisskopf 行星质量标度、宜居带 ∝ √L、时间尺度
 *   H. 结局与报告  结局枚举 + 冷静的中文解说 + 参数空间距离
 *   I. N 体        PM 引力（CIC → Gauss-Seidel 泊松 → 梯度）+ 同一套 Friedmann 背景
 *   J. 目录        保存/加载/删除/导入导出、自动编号（#0001 递增；我们的宇宙 #1207）
 *
 * 决定论：同一参数组 → 同一哈希 → 同一随机种子 → 同一宇宙。
 * UMD：Node 下 module.exports = Engine；浏览器下 window.MirrorEngine = Engine（需先引入 params.js）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./params.js'));
  } else {
    root.MirrorEngine = factory(root.MirrorParams);
  }
})(typeof self !== 'undefined' ? self : this, function (Params) {
  'use strict';
  if (!Params) throw new Error('MirrorEngine 需要 params.js：浏览器中请在 engine.js 之前引入 <script src="params.js">');

  var VERSION = '2.5.0';

  // ============================================================
  // 常量（我们的宇宙）
  // 说明：有量纲常数（c、G、ħ、e）的**数值**取决于单位约定，跨宇宙不变的物理内容是无量纲量 α、α_G……
  // 演化层只用无量纲量；报告里的 SI 数值按 UNIT_CONVENTIONS 换算（默认约定 A，见 dimensionfulSI）。
  // ============================================================
  var H_LITTLE = 0.674;                 // h（Planck 2018；默认 H0）
  var T_H = 977.8 / (100 * H_LITTLE);   // 1/H0 = 14.51 Gyr（默认）
  var T_CMB_K = 2.7255, K_TO_EV = 8.617e-5;
  var NEFF0 = 3.044;                    // 标准 N_eff（Froustey, Pitrou & Volpe 2020；Bennett et al. 2021）
  var ALPHA0 = 1 / 137.035999084;       // CODATA 2018 / PDG 2022
  var ME0_MEV = 0.51099895, MP_MEV = 938.272, DELTA0_MEV = 1.29333;
  var TAU_N0 = 878.4;                   // 中子寿命 [s]（PDG 2022 平均；瓶法 878.4 vs 束法 888 存在张力）
  var MZ_GEV = 91.1876, B0_NF5 = 23 / 3;   // 一环 β 函数系数 b₀=11−2n_f/3，n_f=5
  var ALPHAS_MZ0 = 0.1179;
  var HBARC_EV_CM = 1.973e-5;
  var DELTA_C = 1.686;                  // 球坍缩临界过密度
  var ALPHA_G = 5.9e-39;                // G m_p²/ħc（我们的宇宙）
  // 我们的宇宙的 SI 数值（CODATA 2018；c、e、h 为定义值）
  var SI0 = { c: 299792458, hbar: 1.054571817e-34, G: 6.6743e-11, e: 1.602176634e-19, mp: 1.67262192369e-27, eps0: 8.8541878128e-12 };
  /**
   * 单位约定：α = e²/(4πε₀ħc) 与 α_G = G m_p²/(ħc) 是无量纲的物理内容；
   * 把 α 的变化"归给"哪个有量纲常数是**约定**（Duff 2002）。三种常见选择：
   *   A（默认，Albrecht–Magueijo 变光速表述）：固定 e、ħ、m_p ⇒ c = e²/(4πε₀ħα)，G = α_G ħc/m_p²
   *   B：固定 c、e、m_p ⇒ ħ = e²/(4πε₀cα)，G = α_G ħc/m_p²
   *   C：固定 c、ħ、m_p ⇒ e = √(4πε₀ħcα)，G = α_G ħc/m_p²
   */
  var UNIT_CONVENTIONS = {
    A: { id: 'A', name: '约定 A（固定 e、ħ、m_p；变光速表述）', fixed: ['e', 'hbar', 'm_p'], varies: ['c', 'G'], isDefault: true,
      definition: 'c = e²/(4πε₀ħα)（e、ħ、ε₀ 取我们的数值）；G = α_G·ħc/m_p²（m_p 取我们的数值）',
      ref: 'Albrecht & Magueijo 1999, PRD 59, 043516（变光速表述）；Duff 2002, hep-th/0208093（有量纲常数的"变化"只是单位约定）' },
    B: { id: 'B', name: '约定 B（固定 c、e、m_p）', fixed: ['c', 'e', 'm_p'], varies: ['hbar', 'G'],
      definition: 'ħ = e²/(4πε₀cα)（c、e、ε₀ 取我们的数值）；G = α_G·ħc/m_p²',
      ref: 'Duff 2002, hep-th/0208093；Uzan 2003, RMP 75, 403' },
    C: { id: 'C', name: '约定 C（固定 c、ħ、m_p）', fixed: ['c', 'hbar', 'm_p'], varies: ['e', 'G'],
      definition: 'e = √(4πε₀ħcα)（c、ħ、ε₀ 取我们的数值）；G = α_G·ħc/m_p²',
      ref: 'Duff 2002, hep-th/0208093；Bekenstein 1982（变电荷表述）' }
  };
  var OURS_ID = 1207;
  var YR_S = 3.15576e7;
  var T_MAX = 200;                      // 积分上限（H0⁻¹）
  var SIGMA_GAL_OURS = 1.9;             // 我们的宇宙 σ(M=10¹² M⊙, z=0) 线性值（ΛCDM）
  var Q_OURS = 0.4 * Math.sqrt(2.1e-9); // Q = (2/5)√A_s ≈ 1.83×10⁻⁵
  var M_GAL = 1e12, M_FIRST = 1e8;      // 星系尺度、第一批天体（Pop III 微晕）质量 [M⊙]

  // ============================================================
  // 工具
  // ============================================================
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function clamp01(x) { return clamp(x, 0, 1); }
  /** 周期盒的正取模：JS 的 % 对负数返回负值，直接用会让 CIC 拿到负索引 → NaN 扩散（#9） */
  function wrap1(x) { if (!isFinite(x)) return 0; x %= 1; if (x < 0) x += 1; return x >= 1 ? 0 : x; }
  function log10(x) { return Math.log(x) / Math.LN10; }
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '' };
  function sup(n) { return String(n).split('').map(function (ch) { return SUP[ch] == null ? ch : SUP[ch]; }).join(''); }
  function sci(x, digits) {
    if (x === 0) return '0';
    if (!isFinite(x)) return String(x);
    digits = digits == null ? 3 : digits;
    var ex = Math.floor(log10(Math.abs(x)));
    var m = x / Math.pow(10, ex);
    var ms = Number(m.toPrecision(digits));
    if (Math.abs(ms) >= 10) { ms /= 10; ex += 1; }
    return ms + '×10' + sup(ex);
  }
  function trimNum(x, prec) { if (!isFinite(x)) return String(x); return String(Number(x.toPrecision(prec == null ? 3 : prec))); }
  function num(x, prec) { return Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? sci(x, prec || 3) : trimNum(x, prec || 3); }

  /** 时间格式化：输入 Gyr，输出中文 */
  function formatTime(gyr) {
    if (gyr == null || !isFinite(gyr)) return '—';
    if (gyr === 0) return '0';
    var neg = gyr < 0; gyr = Math.abs(gyr);
    var yr = gyr * 1e9, s = yr * YR_S, out;
    if (s < 1e-3) out = sci(s, 2) + ' 秒';
    else if (s < 60) out = trimNum(s, 2) + ' 秒';
    else if (s < 3600) out = trimNum(s / 60, 2) + ' 分钟';
    else if (s < 86400) out = trimNum(s / 3600, 2) + ' 小时';
    else if (yr < 1) out = trimNum(s / 86400, 2) + ' 天';
    else if (yr < 1e4) out = trimNum(yr, 3) + ' 年';
    else if (yr < 1e8) out = trimNum(yr / 1e4, 3) + ' 万年';
    else if (yr < 1e13) out = trimNum(yr / 1e8, 3) + ' 亿年';
    else out = '10' + sup(Math.round(log10(yr))) + ' 年';
    return (neg ? '−' : '') + out;
  }
  var CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  function cnNumber(x) {
    var r = Math.round(x * 10) / 10;
    if (Number.isInteger(r) && r >= 0 && r <= 12) return CN_DIGITS[r];
    if (r > 0 && r < 13) { var i = Math.floor(r), f = Math.round((r - i) * 10); return CN_DIGITS[i] + '点' + CN_DIGITS[f]; }
    return String(r);
  }
  function cnInt(n) {
    n = Math.round(n);
    if (n < 0 || n > 9999) return String(n);
    if (n <= 12) return CN_DIGITS[n];
    var units = ['', '十', '百', '千'], str = '', digits = String(n).split('').map(Number), L = digits.length, zero = false;
    for (var i = 0; i < L; i++) {
      var dgt = digits[i], pos = L - 1 - i;
      if (dgt === 0) { zero = true; continue; }
      if (zero && str) str += '零';
      zero = false;
      if (!(dgt === 1 && pos === 1 && i === 0)) str += CN_DIGITS[dgt];
      str += units[pos];
    }
    return str;
  }
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function canonicalString(p, modules) {
    var ms = Params.normalizeModules(modules);
    p = Params.normalize(p, ms);
    var mods = Object.keys(ms).filter(function (k) { return ms[k]; }).sort().join(',');
    return 'modules=' + mods + '|' + Object.keys(p).sort().map(function (k) { return k + '=' + Number(p[k].toPrecision(10)); }).join(';');
  }
  function hashParams(p, modules) { return hashString(canonicalString(p, modules)); }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** 互补误差函数（Abramowitz–Stegun 7.1.26，误差 <1.5e-7） */
  function erfc(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function formatId(n) { return '#' + String(n).padStart(4, '0'); }

  // ============================================================
  // 结局枚举
  // ============================================================
  var OUTCOMES = {
    UNSTABLE_ORBITS:         { id: 'UNSTABLE_ORBITS',         name: '无稳定轨道 / 无稳定原子的宇宙', cls: 'weird', visual: 'D≠3：轨道与原子基态都不稳定，物质在坍缩与飞散之间摇摆' },
    BIG_CRUNCH:              { id: 'BIG_CRUNCH',              name: '大挤压',                     cls: 'bad',   visual: '膨胀停止，一切被压回一个点' },
    BIG_RIP:                 { id: 'BIG_RIP',                 name: '大撕裂',                     cls: 'cold',  visual: '（本参数集内不会出现：需要 w<−1 的幻影能量）' },
    HEAT_DEATH_NO_STRUCTURE: { id: 'HEAT_DEATH_NO_STRUCTURE', name: '热寂——无结构的宇宙',        cls: 'cold',  visual: '一锅几乎均匀的气体，永远稀释、变冷' },
    BLACK_HOLE_DOMINATED:    { id: 'BLACK_HOLE_DOMINATED',    name: '黑洞主导的宇宙',             cls: 'bad',   visual: '涨落太大：团块在冷却前坍缩为视界' },
    NO_ATOMS:                { id: 'NO_ATOMS',                name: '没有原子的宇宙',             cls: 'cold',  visual: '没有重子 / 质子衰变 / 电子壳层不稳定' },
    NO_CHEMISTRY:            { id: 'NO_CHEMISTRY',            name: '无化学的宇宙',               cls: 'cold',  visual: '有原子有光，没有碳、氢或刚性分子' },
    NO_STARS:                { id: 'NO_STARS',                name: '没有恒星的宇宙',             cls: 'cold',  visual: '星系形成了，但没有一颗恒星点燃' },
    STARS_NO_LIFE:           { id: 'STARS_NO_LIFE',           name: '有恒星无生命',               cls: 'cold',  visual: '恒星、行星、化学都在，但没有足够的时间或舞台' },
    OBSERVERS_POSSIBLE:      { id: 'OBSERVERS_POSSIBLE',      name: '可能诞生观察者',             cls: 'good',  visual: '星系、恒星、行星与化学都在，时间足够' },
    NO_CARBON_CHEMISTRY:     { id: 'NO_CARBON_CHEMISTRY',     name: '无碳-水型生物化学的宇宙',   cls: 'cold',  visual: '恒星与化学都在，但三氦过程产不出碳/氧，或没有液态水窗口' },
    BEYOND_MODEL_DIM:        { id: 'BEYOND_MODEL_DIM',        name: '超出模型适用范围（D≠3，按 3 维公式外推）', cls: 'weird', visual: 'D≠3：核合成/恒星/化学/宜居公式只对 3 维成立，下列数值仅为外推参考' }
  };
  var OUTCOME_LIST = Object.keys(OUTCOMES).map(function (k) { return OUTCOMES[k]; });

  // ============================================================
  // 发现（finding）构造
  // ============================================================
  var VERDICT_SEV = { ok: 'info', warn: 'warn', bad: 'severe', fail: 'fatal' };
  function makeFinding(o) {
    return {
      id: o.id, title: o.title,
      basis: o.basis,                       // 'computed' | 'scaling' | 'heuristic'
      formula: o.formula || '',
      inputs: o.inputs || {},
      value: o.value == null ? null : o.value,
      valueText: o.valueText || (o.value == null ? '' : num(o.value)),
      threshold: o.threshold || '',
      verdict: o.verdict || 'ok',            // 'ok' | 'warn' | 'bad' | 'fail'
      severity: VERDICT_SEV[o.verdict || 'ok'],
      text: o.text || '',
      ref: o.ref || ''
    };
  }

  // ============================================================
  // A. 膨胀史：Friedmann 背景 + 线性增长（RK4）
  // ============================================================
  /** 背景模型（H0=1 单位）：E²(a) = Ω_r/a⁴ + Ω_m/a³ + Ω_k/a² + Ω_Λ */
  function makeBackground(cfg) {
    var OmM = cfg.OmM, OmR = cfg.OmR, OmK = cfg.OmK || 0, cc = cfg.cc || 0;
    function E2(a) { var a2 = a * a; return OmR / (a2 * a2) + OmM / (a2 * a) + OmK / a2 + cc; }
    /** ä/a = −½ Σ Ω_i (1+3w_i) a^{-3(1+w_i)} */
    function Q(a) { var a2 = a * a; return -OmR / (a2 * a2) - 0.5 * OmM / (a2 * a) + cc; }
    return { OmM: OmM, OmR: OmR, OmK: OmK, cc: cc, ph: 0, E2: E2, Q: Q, aEq: OmM > 0 ? OmR / OmM : Infinity };
  }
  /** 由派生常数 c 构造背景（Ω_r 由 T_CMB、h、N_eff 推出） */
  function background(c) {
    var B = makeBackground({ OmM: c.omegaB + c.omegaC, OmR: c.omegaR, cc: c.omegaLambda, OmK: c.omegaK });
    B.TH = 977.8 / c.H0;      // 1/H0 [Gyr]
    B.tcmb = c.tcmb; B.H0 = c.H0;
    return B;
  }

  /**
   * 积分 (a, ȧ, δ, δ̇)。RK4，步长 Δln a ≈ 0.01，从 a=10⁻⁷ 到挤压 / a>10⁴ / t>200 H0⁻¹。
   * ȧ 每步按第一积分 ȧ²=a²E²(a) 投影（RK4 只决定转向方向），避免辐射时代的误差累积成等效曲率。
   * 线性增长：δ̈ + 2Hδ̇ = 1.5·Ω_m·δ/a³，从物质-辐射相等开始，初值 opts.d0（星系尺度幅度）；不封顶。
   * opts.thresholds = [{key, value}]：δ 首次 ≥ value 时记录 a/t。
   */
  function integrate(B, opts) {
    opts = opts || {};
    var wantSeries = opts.series !== false;
    var d0 = opts.d0 || 0;
    var TH = B.TH || T_H, tcmb = B.tcmb || T_CMB_K;
    var thresholds = opts.thresholds || [];
    var a = 1e-7, ad = a * Math.sqrt(Math.max(B.E2(a), 1e-30)), t = 0;
    var dl = 0, ddl = 0, growing = false;
    var ev = { aEq: null, tEq: null, tOne: null, aMax: null, tTurn: null, tCrunch: null, tEnd: null, chiOne: null, deltaMax: 0, deltaAtOne: null, deltaFinal: 0, hit: {} };
    var series = { t: [], a: [], H: [], delta: [], T: [], chi: [] };
    var chi = 0, lastLogA = -Infinity, lastT = -Infinity, fate = 'eternal', steps = 0, maxSteps = 400000;

    function deriv(y) {
      var A = y[0], AD = y[1], H = AD / A;
      var d1 = growing ? y[3] : 0;
      var d2 = growing ? (-2 * H * y[3] + 1.5 * B.OmM * y[2] / (A * A * A)) : 0;
      return [AD, A * B.Q(A), d1, d2];
    }
    function record(force) {
      var la = Math.log(a);
      if (!force && la - lastLogA < 0.05 && t - lastT < 0.1) return;
      lastLogA = la; lastT = t;
      if (!wantSeries) return;
      series.t.push(t * TH); series.a.push(a); series.H.push(ad / a);
      series.delta.push(growing ? dl : 0); series.T.push(tcmb / a); series.chi.push(chi);
    }
    if (a >= B.aEq && d0 > 0) { growing = true; dl = d0; ddl = (ad / a) * dl; ev.aEq = a; ev.tEq = 0; }
    record(true);

    while (steps++ < maxSteps) {
      var E = Math.abs(ad) / a;
      var dt = Math.min(0.01 / Math.max(E, 1e-12), 0.02);
      var y0 = [a, ad, dl, ddl];
      var k1 = deriv(y0);
      var y1 = [y0[0] + 0.5 * dt * k1[0], y0[1] + 0.5 * dt * k1[1], y0[2] + 0.5 * dt * k1[2], y0[3] + 0.5 * dt * k1[3]];
      if (y1[0] <= 0) { fate = 'crunch'; ev.tCrunch = t; break; }
      var k2 = deriv(y1);
      var y2 = [y0[0] + 0.5 * dt * k2[0], y0[1] + 0.5 * dt * k2[1], y0[2] + 0.5 * dt * k2[2], y0[3] + 0.5 * dt * k2[3]];
      if (y2[0] <= 0) { fate = 'crunch'; ev.tCrunch = t; break; }
      var k3 = deriv(y2);
      var y3 = [y0[0] + dt * k3[0], y0[1] + dt * k3[1], y0[2] + dt * k3[2], y0[3] + dt * k3[3]];
      if (y3[0] <= 0) { fate = 'crunch'; ev.tCrunch = t; break; }
      var k4 = deriv(y3);
      var na = a + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      var nad = ad + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      var ndl = dl + dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      var nddl = ddl + dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
      var e2n = B.E2(na);
      if (e2n > 0) nad = (nad >= 0 ? 1 : -1) * na * Math.sqrt(e2n);
      chi += dt * 0.5 * (1 / a + 1 / Math.max(na, 1e-12));

      if (ad > 0 && nad <= 0 && ev.aMax == null) { ev.aMax = a; ev.tTurn = t + dt; }
      if (a < 1 && na >= 1 && ev.tOne == null) { ev.tOne = t + dt; ev.chiOne = chi; ev.deltaAtOne = growing ? ndl : 0; }
      if (!growing && na >= B.aEq && ev.aEq == null) {
        ev.aEq = na; ev.tEq = t + dt;
        if (d0 > 0) { growing = true; ndl = d0; nddl = (nad / na) * d0; }
      }
      if (growing) {
        if (ndl > ev.deltaMax) ev.deltaMax = ndl;
        for (var q = 0; q < thresholds.length; q++) {
          var th = thresholds[q];
          if (!ev.hit[th.key] && ndl >= th.value) ev.hit[th.key] = { a: na, t: (t + dt) };
        }
      }
      a = na; ad = nad; dl = ndl; ddl = nddl; t += dt;
      record(false);
      if (a < 1e-6 && ad < 0) { fate = 'crunch'; ev.tCrunch = t; break; }
      if (a > 1e4 || t > T_MAX) { fate = 'eternal'; break; }
    }
    if (steps >= maxSteps) fate = 'eternal';
    record(true);
    ev.deltaFinal = growing ? dl : 0;
    ev.tEnd = fate === 'crunch' ? ev.tCrunch : null;

    function g(x) { return x == null ? null : x * TH; }
    var hits = {};
    Object.keys(ev.hit).forEach(function (k) { hits[k] = { a: ev.hit[k].a, tGyr: g(ev.hit[k].t), z: 1 / ev.hit[k].a - 1 }; });
    var out = {
      background: { omegaM: B.OmM, omegaR: B.OmR, omegaK: B.OmK, omegaLambda: B.cc, aEq: B.aEq },
      fate: { type: fate, tGyr: g(ev.tEnd), tLabel: ev.tEnd == null ? null : formatTime(g(ev.tEnd)) },
      events: {
        aEq: ev.aEq, tEqGyr: g(ev.tEq),
        tOneGyr: g(ev.tOne), chiOne: ev.chiOne, deltaAtOne: ev.deltaAtOne,
        aMax: ev.aMax, tTurnGyr: g(ev.tTurn), tCrunchGyr: g(ev.tCrunch),
        deltaMax: ev.deltaMax, deltaFinal: ev.deltaFinal, hits: hits
      },
      steps: steps,
      series: wantSeries ? series : null
    };
    out.tOfA = function (aq) {
      var early = function (x) { return x * x / (2 * Math.sqrt(B.OmR)) * TH; };
      if (aq <= 1e-7 || !wantSeries || series.a.length < 2) return early(aq);
      var A = series.a, Tt = series.t;
      if (aq <= A[0]) return early(aq);
      for (var i = 1; i < A.length; i++) {
        if (A[i] >= aq && A[i - 1] <= aq) {
          var f = (Math.log(aq) - Math.log(A[i - 1])) / Math.max(1e-12, Math.log(A[i]) - Math.log(A[i - 1]));
          return Tt[i - 1] + f * (Tt[i] - Tt[i - 1]);
        }
        if (A[i] < A[i - 1]) break;
      }
      return null;
    };
    out.temperatureAt = function (aq) { return tcmb / aq; };
    out.background.TH = TH; out.background.tcmb = tcmb;
    return out;
  }

  // ============================================================
  // 物理计算层：每个模块把 finding 推入 F，并把数值写入 calc
  // ============================================================

  // ---------- 维数（Ehrenfest 1917；Tegmark 1997） ----------
  /** 轨道/原子稳定：D<4 时圆轨道对径向微扰稳定、氢原子哈密顿量有下界（Ehrenfest 1917）；3<D<4 稳定但不闭合（进动），按 1−0.5(D−3) 给可居住性折扣；D≥4 → 0 */
  function orbitStability(D) { if (D <= 3) return 1; if (D >= 4) return 0; return 1 - 0.5 * (D - 3); }
  /** 引力聚集：D>2 有牛顿吸引；2<D<3 引力弱、拓扑受限（Tegmark 1997），按 D−2 折扣；D≤2 势为对数/排斥 → 0 */
  function gravityFactor(D) { if (D >= 3) return 1; if (D <= 2) return 0; return D - 2; }
  function classifyDims(D) {
    var nearest = Math.round(D), frac = Math.abs(D - nearest) > 1e-9;   // 精确非整数即分数维
    if (D < 1.5) return { kind: 'line', nearest: nearest, frac: frac };
    if (!frac && nearest === 3) return { kind: 'three', nearest: 3, frac: false };
    if (frac) return { kind: 'fractional', nearest: nearest, frac: true };
    if (nearest >= 5) return { kind: 'integer_high', nearest: nearest, frac: false };
    if (nearest === 4) return { kind: 'four', nearest: 4, frac: false };
    return { kind: 'low', nearest: nearest, frac: false };
  }
  // ---------- 涌现的空间维数：Brandenberger–Vafa 弦气宇宙学（玩具模型） ----------
  /* 维序惩罚阶梯：一维弦的世界面在 ≤3+1 维才一般性相交，所以靠前的维度容易解开，之后递减。
     结构是刻意的两段：**前三级把锚点钉死，之后等比细分**。

     锚点（不可动）：默认参数（T₀/T_H=0.98、n_w=1、κ=0.9）下必须**正好 3 个维度全开**。
     那组默认值是我们宇宙的实测真值，模型要是解出别的维数，就等于说我们自己的宇宙里
     没有稳定轨道 —— build.js 有一条自检专门守这个（simulate(defaults()) 必须是
     OBSERVERS_POSSIBLE）。前两级取 3.0 和 2.0（远大于 1，稳稳全开），第三级 1.06 刚过 1。

     之后按 e^-0.14 等比细分：P(D=3) 正比于第 3、4 级之间的坎宽，坎越窄三维越稀缺。
     旧值 [3, 2, 1.3, 0.78, …] 的坎宽是 ln(1.3/0.78)=0.51 → D 量化后 P(D=3)=9.7%，一点不稀缺；
     现在坎宽 0.14 → P(D=3)≈2.4%。级数给到 18 是为了让 D>3 的一侧有足够多的格子，
     不至于全堆在"满维"上。
     改这个数组必须同步重标 bnbhash.js 的抽样参数，并重跑 build.js 的自检。 */
  var SG_G = [3, 2, 1.06, 0.9215, 0.8011, 0.6965, 0.6055, 0.5264, 0.4576, 0.3978, 0.3459, 0.3007, 0.2614, 0.2272, 0.1976, 0.1717, 0.1493, 0.1298];
  var SG_W_MAX = 0.4;
  var SG_HALF_BAND = 0.02;   // 半开的临界带宽，理由见下面量化那段                                                 // 阈值带宽 w = 0.4(1−κ)
  function smoothstep(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  /**
   * emergentDimensions(p) → { D, epsilons[], open[](=s_i), w, nOpen, nPartial, fractional, amplitude }
   * ε_i = g_i · e^{6(T₀/T_H − 0.98)} / n_w；w = 0.4(1−κ)；s_i = smoothstep((ε_i − 1 + w)/(2w))，|ε_i−1|>w 时饱和为 0/1；D = Σ s_i（允许非整数）。
   * 默认（T₀/T_H=0.98, n_w=1, κ=0.5 → w=0.2）：ε=[3,2,1.3,0.78,…] → 3 维饱和解开、其余饱和蜷缩 → D=3.000。
   */
  function emergentDimensions(p) {
    var T = (p && isFinite(Number(p.stringGasT))) ? Number(p.stringGasT) : 0.98;
    var nw = (p && isFinite(Number(p.windingDensity)) && Number(p.windingDensity) > 0) ? Number(p.windingDensity) : 1;
    var kappa = (p && isFinite(Number(p.compactStiffness))) ? clamp01(Number(p.compactStiffness)) : 0.5;
    var w = SG_W_MAX * (1 - kappa);
    var A = Math.exp(6 * (T - 0.98)) / nw;
    var eps = [], open = [], D = 0, nOpen = 0, nPartial = 0;
    for (var i = 0; i < SG_G.length; i++) {
      var e = SG_G[i] * A;
      var sfrac = w > 0 ? smoothstep((e - 1 + w) / (2 * w)) : (e >= 1 ? 1 : 0);
      /* 每一维的解开程度量化成三档：关闭 0 / 半开 0.5 / 全开 1。
         于是 D = Σ s_i 只可能是整数或整数+0.5，不会出现 3.175185 这种数。
         这不是显示层的四舍五入 —— 量化发生在这里，引擎后面所有判据用的都是量化后的 D，
         "算出来的"和"印在 NFT 上的"是同一个数。
         物理读法：一维要么解开、要么蜷缩，"半开"是它**正卡在解开的临界上**。
         BV 机制本身也只讲"哪些维度被解开"，连续的部分解开度是本引擎的插值延伸。

         SG_HALF_BAND：判成"半开"的临界带宽。
         **这里原来写的是 `Math.round(sfrac * 2) / 2`**，等价于带宽 ±0.25 ——
         把 [0.25, 0.75) 整整一半的取值区间都算作"卡在临界上"。那和上面那句物理解释
         自相矛盾：临界是一条刀锋，不是一半的参数空间。后果是 18 个维度里只要有
         **奇数个**落进那半个区间 D 就是分数，实测 34% 的宇宙是分数维，
         而《镜子》第八章原文是「分数维的宇宙**很少见**」。
         收成 ±0.02 之后实测 5.6%，符合"很少见"，也让代码和它自己的解释对上。
         注意这个比例**不是单调**的：决定 D 是否为分数的是落进半开档的维度个数的
         **奇偶性**，不是个数多少 —— ±0.15 反而给出 43%。改这个数必须重新实测，
         不能凭直觉推。 */
      var half = Math.abs(sfrac - 0.5) < SG_HALF_BAND;
      sfrac = half ? 0.5 : (sfrac < 0.5 ? 0 : 1);
      eps.push(e); open.push(sfrac); D += sfrac;
      if (sfrac >= 1) nOpen++; else if (sfrac > 0) nPartial++;
    }
    D = Math.round(D * 1e6) / 1e6;
    return { D: D, amplitude: A, w: w, kappa: kappa, epsilons: eps, open: open, nOpen: nOpen, nPartial: nPartial, fractional: Math.abs(D - Math.round(D)) > 1e-9 };
  }
  function calcDimensions(p, F, calc) {
    var em = p.dims || null;                       // 弦气模块开启时的涌现细节
    var Draw = p.dimS, D = Math.max(Draw, 1);      // 判据下限取 1（0 维：空间没有展开）
    var dc = classifyDims(D), os = orbitStability(D), gf = gravityFactor(D);
    calc.dims = { D: D, Draw: Draw, kind: dc.kind, fractional: dc.frac, orbitStability: os, gravityFactor: gf, emergent: em };
    if (em) F.push(makeFinding({ id: 'R_DIM_EMERGE', title: '空间维数的涌现（弦气玩具模型）', basis: 'heuristic',
      formula: 'ε_i = g_i·e^{6(T₀/T_H−0.98)}/n_w，g 为 18 级维序阶梯（前三级 3.0/2.0/1.06 钉住"默认参数→D=3"的锚点，其后按 e^{−0.14} 等比细分）；w=0.4(1−κ)；s_i=smoothstep((ε_i−1+w)/2w) 后量化到 {0, 0.5, 1}；D=Σs_i，因此 D 只取整数或整数+0.5——引文只支持"一维弦世界面在 ≤3+1 维一般性相交"的定性机制，定量形式为本引擎玩具延伸',
      inputs: em.inputs, value: Draw,
      valueText: 'D=' + trimNum(Draw, 4) + '（' + em.nOpen + ' 维饱和解开' + (em.nPartial ? '、' + em.nPartial + ' 维部分解开' : '') + '，w=' + em.w.toFixed(3) + '）',
      threshold: 'ε>1+w 解开；<1−w 蜷缩；带内部分解开（分数维）', verdict: dc.kind === 'three' ? 'ok' : 'warn',
      text: '9 个空间维初始都蜷缩；缠绕弦与反缠绕弦相遇湮灭的维才能解开膨胀。' + (Draw < 1 ? '弦气太冷/缠绕太密，连一维都没有解开。' : Draw < 2.95 ? '只解开了 ' + trimNum(Draw, 3) + ' 维。' : Draw > 3.05 ? '弦气过热、缠绕模不足，解开了 ' + trimNum(Draw, 3) + ' 维。' : '恰好解开三维。') + '（真实物理没有公认机制，这是弦气图景的玩具实现。）',
      ref: 'Brandenberger & Vafa 1989, Nucl. Phys. B316, 391；Tseytlin & Vafa 1992' }));
    else F.push(makeFinding({ id: 'R_DIM_INPUT', title: '空间维数（直接输入）', basis: 'computed',
      formula: 'D 作为观测事实直接输入（无公认生成机制）', inputs: { dimS: Draw }, value: Draw, valueText: 'D=' + trimNum(Draw, 4),
      threshold: '—', verdict: 'ok', text: '空间维数 D=' + trimNum(Draw, 4) + '（status: accepted-fact, no-mechanism；开启弦气模块可由初始条件派生）。', ref: 'Tegmark 1997' }));
    // 判据（Ehrenfest 1917 / Tegmark 1997）：力 ∝ r^{−(D−1)}，势 ∝ r^{−(D−2)}
    //   D≥4：圆轨道对径向微扰不稳定，氢原子哈密顿量无下界（势比 r⁻² 更奇异）→ fail
    //   3<D<4：轨道稳定但不闭合（进动），原子能级与化学显著改变 → warn，继续演化链
    //   2<D<3：有牛顿吸引但引力弱、拓扑受限 → warn，继续演化链
    //   D≤2：势为对数/排斥，无牛顿吸引 → fail
    var orbitsOK = D < 4, gravityOK = D > 2;
    var verdict = dc.kind === 'three' ? 'ok' : (orbitsOK && gravityOK ? 'warn' : 'fail');
    var text;
    if (dc.kind === 'three') text = 'D=3：力 ∝ 1/r²，束缚轨道稳定且闭合（Bertrand 定理），氢原子有基态。';
    else if (D >= 4) text = 'D=' + trimNum(D, 3) + '：力 ∝ r^{−' + trimNum(D - 1, 3) + '}，D≥4 时圆轨道对径向微扰不稳定，氢原子哈密顿量无下界（势 r^{−' + trimNum(D - 2, 3) + '} 比 r⁻² 更奇异）——没有稳定轨道，也没有原子基态（Ehrenfest 1917）。';
    else if (D > 3) text = 'D=' + trimNum(D, 3) + '：力 ∝ r^{−' + trimNum(D - 1, 3) + '}，圆轨道对径向微扰仍稳定（D<4），但不再闭合（进动）；氢原子有基态，能级与化学显著改变。后续演化按 D=3 的标度计算，未做 D≠3 修正（basis: scaling）。';
    else if (D > 2) text = 'D=' + trimNum(D, 3) + '：有牛顿吸引，但势 ∝ r^{−' + trimNum(D - 2, 3) + '} 更平缓、引力聚集更弱；拓扑上复杂网络受限（Tegmark 1997）。后续演化按 D=3 的标度计算，未做 D≠3 修正。';
    else text = 'D=' + trimNum(D, 3) + '：D≤2 时引力势为对数/排斥，没有牛顿吸引，物质无法聚集（2+1 维引力无局域自由度）。';
    F.push(makeFinding({ id: 'R_DIM', title: '空间维数与轨道/原子稳定性', basis: dc.kind === 'three' || !orbitsOK || !gravityOK ? 'computed' : 'scaling',
      formula: '力 F ∝ r^{−(D−1)}；圆轨道径向稳定 ⇔ D<4；氢原子哈密顿量有下界 ⇔ D<4（势 r^{−(D−2)} 弱于 r⁻²）；牛顿吸引 ⇔ D>2；3<D<4 轨道稳定但不闭合（进动）',
      inputs: { D: D }, value: os, valueText: '轨道稳定 ' + (orbitsOK ? '是' : '否') + '，牛顿吸引 ' + (gravityOK ? '是' : '否') + '，可居住性因子 ' + (os * gf).toFixed(2),
      threshold: 'D<4 且 D>2；D=3 闭合轨道', verdict: verdict, text: text, ref: 'Ehrenfest 1917；Tegmark 1997' }));
    if (dc.kind !== 'three' && orbitsOK && gravityOK) F.push(makeFinding({ id: 'R_DIM_UNCORRECTED', title: 'D≠3 的演化未做维数修正', basis: 'scaling',
      formula: '结构增长、恒星与原子标度按 D=3 公式计算；可居住性乘 ' + (os * gf).toFixed(2), inputs: { D: D }, value: os * gf, valueText: '×' + (os * gf).toFixed(2),
      threshold: '—', verdict: 'warn', text: '本引擎的 Friedmann/Saha/BBN/Press–Schechter/Adams 标度都是 3+1 维公式；D=' + trimNum(D, 3) + ' 时只在可居住性上打折，未重推各步的 D 依赖。', ref: 'Tegmark 1997' }));
    if (dc.frac) F.push(makeFinding({ id: 'R_DIM_FRACTAL', title: '分数维（数学练习，推测）', basis: 'heuristic', formula: 'D 非整数（弦气模块：有维度处于阈值带 |ε−1|<w 内部分解开；直接输入非整数 D 亦然）：力律 r^{−(D−1)} 与判据按 D 连续插值', inputs: { D: Draw }, value: Draw, valueText: 'D=' + trimNum(Draw, 4),
      threshold: 'D 非整数', verdict: 'warn', text: 'D=' + cnNumber(D) + '：非整数维没有严格的物理定义（可视为一种数学练习，标推测），这里把力律 r^{−(D−1)} 与判据按 D 连续插值。', ref: 'Brandenberger & Vafa 1989（玩具延伸）' }));
    calc.dims.orbitsOK = orbitsOK; calc.dims.gravityOK = gravityOK;
  }

  // ---------- 重子生成（Sakharov 1967） ----------
  function calcBaryogenesis(p, F, calc) {
    var cpOK = p.ckmPhase >= 0.05 && p.generations >= 3;
    var hasBaryons = cpOK && p.omegaB > 0;
    calc.baryons = { cpViolation: cpOK, hasBaryons: hasBaryons };
    F.push(makeFinding({ id: 'R_CP', title: 'CP 破坏与重子生成', basis: 'heuristic',
      formula: 'Sakharov 条件之一：CP 破坏。标准模型内 CP 破坏 ∝ J = Im(V_ud V_cs V_us* V_cd*) ∝ sin δ_CKM，且需 N_gen ≥ 3',
      inputs: { deltaCKM: p.ckmPhase, generations: p.generations }, value: cpOK ? Math.sin(p.ckmPhase) : 0,
      valueText: cpOK ? 'sin δ=' + Math.sin(p.ckmPhase).toFixed(2) : '无 CP 破坏',
      threshold: 'δ_CKM ≥ 0.05 rad 且 N_gen ≥ 3', verdict: cpOK ? 'ok' : 'fail',
      text: cpOK ? '有 CP 破坏来源，重子生成可以进行（标准模型 CKM 相位本身不足以解释观测的 η，此处假定与之同比例的额外来源）。'
        : (p.generations < 3 ? 'N_gen=' + p.generations + '：CKM 矩阵没有不可消去的相位，' : 'δ_CKM≈0：') + '没有 CP 破坏（且假定无其它来源），物质与反物质对称湮灭，只剩光子与暗物质。',
      ref: 'Sakharov 1967；Kobayashi & Maskawa 1973' }));
    if (p.omegaB <= 0) F.push(makeFinding({ id: 'R_OMEGA_B', title: '重子密度为零', basis: 'computed', formula: 'Ω_b = 0', inputs: { omegaB: 0 }, value: 0, threshold: 'Ω_b > 0', verdict: 'fail', text: '没有重子物质，只有暗物质与辐射。', ref: 'Planck 2018' }));
  }

  // ---------- 膨胀史 ----------
  function calcExpansion(p, B, cos, F, calc) {
    var ev = cos.events;
    var zEq = B.OmM > 0 ? B.OmM / B.OmR - 1 : null;
    var closure = B.OmM + B.cc + B.OmK + B.OmR;
    var H0eff = B.H0 * Math.sqrt(Math.max(B.E2(1), 0));
    calc.expansion = { omegaR: B.OmR, omegaM: B.OmM, omegaLambda: B.cc, omegaK: B.OmK, zEq: zEq, ageGyr: ev.tOneGyr, H0eff: H0eff, closure: closure, fate: cos.fate };
    F.push(makeFinding({ id: 'R_FRIEDMANN', title: '膨胀史（Friedmann）', basis: 'computed',
      formula: 'H²/H0² = Ω_r a⁻⁴ + Ω_m a⁻³ + Ω_k a⁻² + Ω_Λ；Ω_r = Ω_γ(1+0.2271 N_eff)，Ω_γh² = 2.47×10⁻⁵(T_CMB/2.7255 K)⁴；RK4 积分 a(t)',
      inputs: { omegaM: B.OmM, omegaLambda: B.cc, omegaK: B.OmK, omegaR: B.OmR },
      value: ev.tOneGyr, valueText: ev.tOneGyr != null ? '年龄(a=1) ' + formatTime(ev.tOneGyr) + '，H(a=1)=' + H0eff.toFixed(1) + ' km/s/Mpc' : '从未膨胀到 a=1',
      threshold: '—', verdict: cos.fate.type === 'crunch' ? 'bad' : 'ok',
      text: (ev.tOneGyr != null ? 'a=1 时年龄 ' + formatTime(ev.tOneGyr) + '。' : '在到达 a=1 之前就转向坍缩。') +
        (cos.fate.type === 'crunch' ? '膨胀在 ' + formatTime(ev.tTurnGyr) + '（a_max=' + (ev.aMax != null ? ev.aMax.toFixed(2) : '?') + '）转向，' + formatTime(cos.fate.tGyr) + ' 后回到奇点。' : '永恒膨胀，' + (B.cc > 0 ? '最终进入德西特相。' : '渐近减速。')),
      ref: 'Friedmann 1922；Planck 2018' }));
    F.push(makeFinding({ id: 'R_ZEQ', title: '物质-辐射相等', basis: 'computed', formula: '1+z_eq = Ω_m/Ω_r',
      inputs: { omegaM: B.OmM, omegaR: B.OmR }, value: zEq, valueText: zEq != null ? 'z_eq=' + Math.round(zEq) + '，t_eq=' + formatTime(ev.tEqGyr) : '无物质',
      threshold: '—', verdict: zEq == null ? 'fail' : (zEq < 100 ? 'warn' : 'ok'),
      text: zEq != null ? '相等发生于 z≈' + Math.round(zEq) + '，之后涨落才开始线性增长（Meszaros 效应）。' : 'Ω_m=0：没有物质时代。', ref: 'Meszaros 1974' }));
    if (Math.abs(closure - 1) > 0.02) F.push(makeFinding({ id: 'R_CLOSURE', title: '几何自洽提示', basis: 'computed', formula: 'Ω_m+Ω_Λ+Ω_k+Ω_r = 1 ⇔ H(a=1)=H0',
      inputs: { sum: closure }, value: closure, threshold: '=1', verdict: 'warn',
      text: 'Ω 之和为 ' + closure.toFixed(2) + '：a=1 处 H=' + H0eff.toFixed(1) + ' km/s/Mpc（≠H₀=' + B.H0 + '）。若要几何自洽可令 Ω_k=1−Ω_m−Ω_Λ。', ref: '—' }));
  }

  // ---------- 复合（Saha） ----------
  function calcRecombination(p, B, cos, F, calc) {
    var eta10 = p.eta10;
    var eta = eta10 * 1e-10;
    var meEV = p.electronMassMeV * 1e6;
    var B_H = 13.6 * Math.pow(p.alpha / ALPHA0, 2) * (p.electronMassMeV / ME0_MEV);   // Rydberg ∝ α² mₑ
    var T_CMB_EV = p.tcmb * K_TO_EV;
    calc.eta10 = eta10;
    if (!(calc.baryons.hasBaryons) || eta <= 0) {
      calc.recombination = { zRec: null, TRecEV: null, tRecGyr: null, ionizationEnergyEV: B_H, eta10: eta10 };
      F.push(makeFinding({ id: 'R_RECOMB', title: '复合（Saha）', basis: 'computed', formula: 'Saha：x²/(1−x) = (mₑT/2π)^{3/2} e^{−B/T} / n_b', inputs: { eta10: eta10, B_eV: B_H }, value: null, valueText: '无重子，无复合', threshold: 'x_e=0.5', verdict: 'fail', text: '没有重子，谈不上复合。', ref: 'Saha 1920' }));
      return;
    }
    // 求 x_e=0.5 的温度：f(T) = RHS(T)/n_b − 0.5 = 0，T∈[0.02, 200] eV，对数二分
    function ngamma(T) { return 0.2436 * Math.pow(T / HBARC_EV_CM, 3); }   // cm⁻³（T 以 eV）
    function saha(T) {
      var nb = eta * ngamma(T);
      var pref = Math.pow(meEV * T / (2 * Math.PI), 1.5) / Math.pow(HBARC_EV_CM, 3);   // cm⁻³
      return pref * Math.exp(-B_H / T) / nb;   // = x²/(1−x)
    }
    function solveT(xe) {          // 求 x_e 给定值时的温度（对数二分）
      var target = xe * xe / (1 - xe), lo = Math.log(0.02), hi = Math.log(200);
      if (!(saha(Math.exp(lo)) < target && saha(Math.exp(hi)) > target)) return null;
      for (var i = 0; i < 80; i++) { var mid = 0.5 * (lo + hi); if (saha(Math.exp(mid)) > target) hi = mid; else lo = mid; }
      return Math.exp(0.5 * (lo + hi));
    }
    var TRec = solveT(0.5), TDec = solveT(0.01);
    var zRec = TRec != null ? TRec / T_CMB_EV - 1 : null;
    var zDec = TDec != null ? TDec / T_CMB_EV - 1 : null;
    var aRec = zRec != null ? 1 / (1 + zRec) : null;
    var tRec = aRec != null ? cos.tOfA(aRec) : null;
    var tDec = zDec != null ? cos.tOfA(1 / (1 + zDec)) : null;
    calc.recombination = { zRec: zRec, TRecEV: TRec, aRec: aRec, tRecGyr: tRec, zDec: zDec, tDecGyr: tDec, ionizationEnergyEV: B_H, eta10: eta10, sahaWindow: zRec != null };
    F.push(makeFinding({ id: 'R_RECOMB', title: '复合红移（Saha 近似）', basis: 'computed',
      formula: 'x_e²/(1−x_e) = (mₑT/2π)^{3/2} e^{−B/T} / n_b，B = 13.6 eV·(α/α₀)²·(mₑ/mₑ₀)，n_b = η n_γ，η₁₀ = 273.9 Ω_b h²(2.7255/T_CMB)³；复合取 x_e=0.5，去耦取 x_e=0.01（Saha 平衡近似；Peebles 非平衡解给 z*≈1090）',
      inputs: { alpha: p.alpha, electronMassMeV: p.electronMassMeV, eta10: eta10, B_eV: B_H, tcmb: p.tcmb },
      value: zRec, valueText: zRec != null ? 'z_rec≈' + Math.round(zRec) + '（T≈' + trimNum(TRec, 3) + ' eV，' + formatTime(tRec) + '）；去耦 z≈' + (zDec != null ? Math.round(zDec) : '?') : '在 0.02–200 eV 内无解',
      threshold: '我们：z_rec≈1380（Saha）、z*≈1090', verdict: zRec == null ? 'warn' : 'ok',
      text: zRec != null ? '电离能 ' + trimNum(B_H, 3) + ' eV；x_e=½ 于 z≈' + Math.round(zRec) + '，光子去耦（x_e≈0.01）于 z≈' + (zDec != null ? Math.round(zDec) : '?') + '、' + formatTime(tDec) + '，宇宙变得透明。' : '复合温度落在求解窗口之外。',
      ref: 'Saha 1920；Peebles 1968' }));
  }

  // ---------- 大爆炸核合成 ----------
  function calcBBN(p, B, F, calc) {
    var alphaR = p.alpha / ALPHA0;
    var dmq = p.mDown - p.mUp;
    var delta = p.mnMinusMp;                                    // m_n − m_p [MeV]（deriveConstants：Gasser–Leutwyler）
    var me = p.electronMassMeV;
    var v = p.higgsVev;
    var Bd = 2.22 * (1 + 10 * (p.alphaS - 1));                 // 氘核结合能 [MeV]：阈值量级引自 Pochet 1991 / Hogan 2000（核力弱 ~10% 解体），线性插值为本引擎近似
    var Bpp = 2.22 * (10 * (p.alphaS - 1) - 1);                // 双质子"结合能"（>0 束缚）：阈值量级引自 Barrow & Tipler / Bradford 2009（核力强 ~10%），线性插值为本引擎近似
    var neff = (p.generations < 3 ? NEFF0 * p.generations / 3 : NEFF0 + (p.generations - 3));
    var gstar = 10.75 * (1 + 0.2271 * (neff - NEFF0) / (1 + 0.2271 * NEFF0));   // 近似
    var Tf = 0.72 * Math.pow(v, 4 / 3) * Math.pow(gstar / 10.75, 1 / 6);      // 冻结温度 T_f ∝ (G_F² M_Pl)^{-1/3} g*^{1/6}
    var tauN = delta > me ? TAU_N0 * Math.pow(v, 4) * Math.pow(DELTA0_MEV / delta, 5) : Infinity;   // 中子寿命 ∝ G_F⁻² Δ⁻⁵（878.4 s，PDG 2022）
    var tBBN = 180 * Math.pow(10.75 / gstar, 0.5);                            // BBN 时刻 [s]
    var npF = Math.exp(-delta / Tf);
    var npBBN = npF * Math.exp(-tBBN / tauN);
    var eta10 = p.eta10;
    var Yfit = 0.2485 + 0.0016 * (eta10 - 6) + 0.013 * (neff - NEFF0);       // Steigman 2007
    // 以标准值为基准，用 n/p 的比值修正
    var np0 = Math.exp(-DELTA0_MEV / 0.72) * Math.exp(-180 / TAU_N0);
    var npStd = Yfit / (2 - Yfit);
    var npModel = npStd * (npBBN / np0);
    var Yp = clamp(2 * npModel / (1 + npModel), 0, 1);
    var hydrogenState = delta < -me ? 'proton_decay' : delta < me ? 'electron_capture' : 'stable';
    var deuteronBetaStable = delta < Bd + me;                    // 氘核内中子 β 衰变 d→ppeν 需 Δ > B_d + mₑ（Hogan 2000）
    var deuteronBound = Bd > 0 && deuteronBetaStable, diprotonBound = Bpp > 0;
    if (!deuteronBound) Yp = 0;                    // 无氘 → 无 ⁴He 之路（BBN 卡在氘瓶颈）
    if (diprotonBound) Yp = 1;                     // 双质子束缚 → 氢在 BBN 全烧成氦（启发式）
    if (hydrogenState !== 'stable') Yp = hydrogenState === 'proton_decay' ? 0 : Yp;
    /* eta10 = 0（omegaBh2 = 0，schema 允许的合法边界）时 Math.pow(0, -1.6) === Infinity，
       以前会把字面量 "Infinity" 原样格式化进 R_BBN_YP 的 valueText，而且 verdict 还标 ok。
       同一文件里的 calcRecombination() 早就有正确示范（无重子直接短路成"无重子，无复合"），
       calcBBN 漏抄了这一段。没有重子就没有核合成，D/H 应当是"给不出"，不是无穷大。 */
    var noBaryonBBN = !calc.baryons.hasBaryons || !(eta10 > 0);
    var DH = noBaryonBBN ? null : (deuteronBound && !diprotonBound ? 2.5e-5 * Math.pow(eta10 / 6, -1.6) : 0);
    calc.bbn = { deltaMeV: delta, meMeV: me, hydrogenState: hydrogenState, Bd: Bd, Bpp: Bpp, deuteronBound: deuteronBound, diprotonBound: diprotonBound,
      Tf: Tf, tauN: tauN, npFreeze: npF, npBBN: npBBN, Yp: Yp, Yfit: Yfit, DH: DH, eta10: eta10, neff: neff, deuteronBetaStable: deuteronBetaStable };

    F.push(makeFinding({ id: 'R_MNP', title: '中子-质子质量差', basis: 'scaling',
      formula: 'Δ = 1.293 + 2.52·[(m_d−m_u)/2.51 − 1] − 1.00·[α/α₀ − 1] MeV（BMW 2015 格点分解：QCD 项 2.52、QED 项 −1.00，线性化于观测值）',
      inputs: { mUp: p.mUp, mDown: p.mDown, alpha: p.alpha }, value: delta, valueText: 'Δ=' + trimNum(delta, 3) + ' MeV（mₑ=' + trimNum(me, 3) + ' MeV）',
      threshold: '氢稳定需 Δ > mₑ', verdict: hydrogenState === 'stable' ? 'ok' : 'fail',
      text: hydrogenState === 'stable' ? '中子比质子重 ' + trimNum(delta, 3) + ' MeV，超过电子质量：氢原子稳定，自由中子衰变。'
        : hydrogenState === 'proton_decay' ? 'Δ < −mₑ：质子比中子+电子还重，p→n e⁺ν 放能，质子衰变——没有氢，也没有任何原子核外的电子壳层。'
        : '−mₑ < Δ < mₑ：p+e→n+ν 放能，氢原子被电子俘获吃掉；重核内的中子反而稳定。没有氢。',
      ref: 'Borsanyi et al. (BMW) 2015；Hogan 2000；Damour & Donoghue 2008' }));
    F.push(makeFinding({ id: 'R_DEUTERON', title: '氘核束缚', basis: 'scaling',
      formula: 'B_d ≈ 2.22 MeV·[1+10(αₛ,nuc−1)]：阈值量级（核力弱 ~10% 解体）引自 Pochet 1991 / Hogan 2000，线性插值为本引擎近似；且需 m_n−m_p < B_d+mₑ，否则氘核内中子 β 衰变', inputs: { alphaS: p.alphaS, deltaMeV: delta }, value: Bd, valueText: 'B_d=' + trimNum(Bd, 3) + ' MeV，Δ=' + trimNum(delta, 3) + ' MeV',
      threshold: 'B_d > 0 且 Δ < B_d + mₑ', verdict: deuteronBound ? (Bd < 1 ? 'warn' : 'ok') : 'fail',
      text: deuteronBound ? '氘核束缚（结合能 ' + trimNum(Bd, 3) + ' MeV），pp 链第一步 p+p→d 可以走通。' : (Bd <= 0 ? '氘核不束缚：' : '中子太重（Δ=' + trimNum(delta, 3) + ' MeV > B_d+mₑ），氘核内的中子也会 β 衰变：') + '大爆炸核合成卡在氘瓶颈，恒星也无法通过 pp 链点燃。',
      ref: 'Pochet, Pearson, Beaudet & Reeves 1991；Barrow & Tipler 1986；Hogan 2000' }));
    F.push(makeFinding({ id: 'R_DIPROTON', title: '双质子束缚', basis: 'scaling',
      formula: 'B_pp ≈ 2.22 MeV·[10(αₛ,nuc−1)−1]：阈值量级（核力强 ~10% 束缚）引自 Barrow & Tipler 1986 / Bradford 2009，线性插值为本引擎近似', inputs: { alphaS: p.alphaS }, value: Bpp, valueText: 'B_pp=' + trimNum(Bpp, 3) + ' MeV',
      threshold: 'B_pp < 0（不束缚）', verdict: diprotonBound ? 'fail' : 'ok',
      text: diprotonBound ? '双质子束缚：p+p→²He 无需弱作用，大爆炸核合成把氢几乎全部烧成氦（Y_p→1），没有氢、没有水。' : '双质子不束缚，pp 链受弱作用限制，氢得以保留。',
      ref: 'Barrow & Tipler 1986；Bradford 2009（争议：MacDonald & Mullan 2009 认为部分氢可存留）' }));
    F.push(makeFinding({ id: 'R_BBN_YP', title: '原初氦丰度', basis: 'computed',
      formula: 'Y_p ≈ 0.2485 + 0.0016(η₁₀−6) + 0.013ΔN_eff（拟合，N_eff₀=3.044），再按 n/p = e^{−Δ/T_f}·e^{−t_BBN/τ_n} 相对标准值修正；T_f ∝ v^{4/3}，τ_n = 878.4 s·v⁴(1.293/Δ)⁵（瓶法/束法张力 ~10 s）',
      inputs: { eta10: eta10, Neff: neff, deltaMeV: delta, Tf: Tf, tauN: tauN }, value: noBaryonBBN ? null : Yp,
      valueText: noBaryonBBN ? '无重子，无核合成' : ('Y_p=' + Yp.toFixed(3) + '，D/H=' + sci(DH, 2)),
      threshold: '我们：0.245', verdict: noBaryonBBN ? 'fail' : (Yp > 0.6 ? 'fail' : (Yp > 0.4 || Yp < 0.1 ? 'warn' : 'ok')),
      text: 'n/p 冻结于 T_f≈' + trimNum(Tf, 3) + ' MeV，比值 ' + npF.toFixed(3) + '；中子寿命 ' + (isFinite(tauN) ? trimNum(tauN, 3) + ' s' : '∞') + '，到 BBN（' + Math.round(tBBN) + ' s）剩 ' + npBBN.toFixed(3) + '。氦质量分数 ' + Yp.toFixed(3) + (Yp > 0.6 ? '——氢几乎耗尽。' : '。'),
      ref: 'Steigman 2007；Kolb & Turner 1990' }));
  }

  // ---------- 结构形成 ----------
  var GROWTH_OURS = null;   // 我们的宇宙：δ_lin(a=1)/d0（模块初始化时校准）
  function structureSetup(p) {
    var omegaM = p.omegaB + p.omegaC;
    var fnu = omegaM > 0 ? (p.sumNu / 93.14 / (p.h * p.h)) / omegaM : 0;   // Ω_ν h² = Σm/93.14 eV
    var nuFactor = Math.sqrt(clamp01(1 - 8 * fnu));                                  // ΔP/P ≈ −8 f_ν → σ 乘 √
    var tilt = Math.exp(1.84 * (p.ns - 0.965));                                       // k_gal≈2 Mpc⁻¹ vs k_piv=0.05：(40)^{(n_s−0.965)/2}
    var nEff = p.ns - 2.965;                                                          // 星系尺度有效谱指数（n_s−4+传递函数斜率）
    var gamma = (nEff + 3) / 3;                                                       // σ(M) ∝ M^{−γ/2}
    var sigmaGal0 = SIGMA_GAL_OURS * (p.Q / Q_OURS) * tilt * nuFactor;                // 若增长与我们相同时的 σ(10¹² M⊙, z=0)
    var f8 = Math.pow(M_FIRST / M_GAL, -gamma / 2);                                   // σ(10⁸)/σ(10¹²)
    var silk = p.omegaC <= 0 ? 0.5 : 1;                                               // 无暗物质：只靠重子（Silk 阻尼，启发式）
    return { omegaM: omegaM, fnu: fnu, nuFactor: nuFactor, tilt: tilt, nEff: nEff, gamma: gamma, sigmaGal0: sigmaGal0 * silk, f8: f8, silk: silk };
  }
  function calcStructure(p, B, cos, S, F, calc) {
    var ev = cos.events, hits = ev.hits;
    var growthOne = ev.deltaAtOne != null && cos.d0 > 0 ? ev.deltaAtOne / cos.d0 : null;   // D(a=1)/D(a_eq)
    var sigmaGalNow = ev.deltaAtOne != null ? ev.deltaAtOne : null;                        // 线性 σ(10¹²) at a=1
    var sigma8 = sigmaGalNow != null ? 0.81 * sigmaGalNow / SIGMA_GAL_OURS : null;
    var first = hits.first || null, gal = hits.gal || null, typical = hits.typical || null;
    var deltaMax = ev.deltaMax;
    var structure = !!gal;
    var freezeReason = !structure ? (p.Q <= 0 ? '无涨落' : B.cc > B.OmM * 1e3 ? '暗能量过早主导' : ev.aMax != null ? '在坍缩前来不及' : '增长被冻结') : '';
    // Weinberg 上界：ρ_Λ ≲ ρ_m(a_col)，a_col ≈ δ_c/(2σ_gal(1)) 若无 Λ 与曲率（物质时代 D∝a）
    var aColEdS = S.sigmaGal0 > 0 ? DELTA_C / (2 * S.sigmaGal0) : Infinity;
    // OmM=0 时上界为 0：任何正 Λ 都越界；避免 0/0 → NaN 写进 finding
    var weinbergMax = B.OmM > 0 ? B.OmM / Math.pow(Math.min(aColEdS, 1), 3) : 0;
    var weinbergOK = B.cc <= weinbergMax;
    var weinbergRatio = weinbergMax > 0 ? B.cc / weinbergMax : (B.cc > 0 ? Infinity : 0);
    // Carr 原初黑洞：视界尺度 rms σ_hor = Q·(k_hor/k_piv)^{(n_s−1)/2}，k_hor~10¹⁰ Mpc⁻¹（ln 比≈26）
    var sigmaHor = p.Q * Math.exp(26 * (p.ns - 1) / 2);
    var betaPBH = erfc(0.45 / (Math.SQRT2 * sigmaHor));
    // Tegmark & Rees 1998 的 Q 窗口（星系密度/冷却）；有效 Q 含谱倾斜
    var Qeff = p.Q * S.tilt;
    calc.structure = { sigmaGalNow: sigmaGalNow, sigma8: sigma8, growthOne: growthOne, deltaMax: deltaMax, first: first, gal: gal, typical: typical,
      structureFormed: structure, weinbergMax: weinbergMax, weinbergOK: weinbergOK, weinbergRatio: weinbergRatio, sigmaHor: sigmaHor, betaPBH: betaPBH, Qeff: Qeff, fnu: S.fnu, nEff: S.nEff };

    F.push(makeFinding({ id: 'R_GROWTH', title: '线性增长因子与 σ₈ 等价量', basis: 'computed',
      formula: 'δ̈+2Hδ̇ = (3/2)H0²Ω_m δ/a³ 从 a_eq 积分；σ(M,a) = σ_gal(a)·(M/10¹²M⊙)^{−(n_eff+3)/6}，n_eff = n_s−2.965；σ_gal ∝ Q=(2/5)√A_s（k=0.05）并含谱倾斜 e^{1.84(n_s−0.965)} 与中微子 √(1−8f_ν)；校准使默认 σ(10¹²,z=0)=1.9',
      inputs: { Q: p.Q, ns: p.ns, omegaM: B.OmM, omegaLambda: B.cc, fnu: S.fnu }, value: sigma8,
      valueText: sigma8 != null ? 'σ₈≈' + sigma8.toFixed(2) + '（σ_gal(z=0)=' + sigmaGalNow.toFixed(2) + '，D(1)/D(a_eq)=' + (growthOne != null ? Math.round(growthOne) : '?') + '）' : 'a=1 前已坍缩',
      threshold: '我们：σ₈=0.81', verdict: sigma8 == null ? 'warn' : (sigma8 < 0.05 ? 'fail' : sigma8 > 20 ? 'bad' : 'ok'),
      text: sigma8 != null ? '今天（a=1）星系尺度线性涨落 ' + sigmaGalNow.toFixed(2) + '，等价 σ₈≈' + sigma8.toFixed(2) + '。' : '宇宙在到达 a=1 之前就已转向。', ref: 'Peebles 1980；BBKS 1986（传递函数斜率）' }));
    F.push(makeFinding({ id: 'R_COLLAPSE', title: '星系尺度坍缩红移（Press–Schechter）', basis: 'computed',
      formula: 'ν σ(M,a) ≥ δ_c=1.686；第一批天体取 3σ 峰、M=10⁸ M⊙；星系取 2σ、M=10¹² M⊙',
      inputs: { deltaC: DELTA_C, f8: S.f8 }, value: gal ? gal.z : null,
      valueText: (first ? '首批天体 z≈' + first.z.toFixed(1) + '（' + formatTime(first.tGyr) + '）；' : '首批天体：未坍缩；') + (gal ? '星系 z≈' + gal.z.toFixed(1) + '（' + formatTime(gal.tGyr) + '）' : '星系：未坍缩（δ_max=' + sci(deltaMax, 2) + '）'),
      threshold: 'δ_c=1.686', verdict: structure ? 'ok' : 'fail',
      text: structure ? '2σ 的 10¹² M⊙ 涨落在 z≈' + gal.z.toFixed(1) + ' 非线性坍缩，星系形成。' : '星系尺度涨落最大只长到 ' + sci(deltaMax, 2) + '（' + freezeReason + '），永远停留在线性阶段。',
      ref: 'Press & Schechter 1974；Gunn & Gott 1972' }));
    F.push(makeFinding({ id: 'R_WEINBERG', title: 'Weinberg 上界', basis: 'scaling',
      formula: 'ρ_Λ ≲ ρ_m(a_col)，a_col ≈ δ_c/(2σ_gal(z=0)) ⇒ Ω_Λ,max ≈ Ω_m (2σ_gal/δ_c)³',
      inputs: { omegaLambda: B.cc, sigmaGal0: S.sigmaGal0, omegaM: B.OmM }, value: weinbergRatio, valueText: 'Ω_Λ/Ω_Λ,max=' + sci(weinbergRatio, 2),
      threshold: '≤1', verdict: weinbergOK ? 'ok' : 'fail',
      text: weinbergOK ? '真空能小于结构形成期的物质密度（上界 Ω_Λ≈' + sci(weinbergMax, 2) + '），星系可以在 Λ 主导前形成。' : '真空能是上界的 ' + sci(weinbergRatio, 2) + ' 倍：Λ 在星系坍缩之前主导膨胀，增长冻结。',
      ref: 'Weinberg 1987；Martel, Shapiro & Weinberg 1998' }));
    F.push(makeFinding({ id: 'R_PBH', title: '原初黑洞（Carr 阈值）', basis: 'computed',
      formula: 'β = erfc(δ_c,PBH/(√2 σ_hor))，δ_c,PBH≈0.45，σ_hor = Q·(k_hor/k_piv)^{(n_s−1)/2}',
      inputs: { Q: p.Q, ns: p.ns, sigmaHor: sigmaHor }, value: betaPBH, valueText: 'β=' + sci(betaPBH, 2),
      threshold: 'β ≳ 10⁻⁸ 时黑洞占主导（形成后 ∝a 增长）', verdict: betaPBH > 1e-8 ? 'fail' : (betaPBH > 1e-20 ? 'warn' : 'ok'),
      text: betaPBH > 1e-8 ? '视界尺度涨落 σ_hor=' + sci(sigmaHor, 2) + '，坍缩为原初黑洞的质量比例 β=' + sci(betaPBH, 2) + '，辐射时代后黑洞主导。' : '视界尺度涨落 σ_hor=' + sci(sigmaHor, 2) + '，原初黑洞比例可忽略。',
      ref: 'Carr 1975；Carr, Kohri, Sendouda & Yokoyama 2021' }));
    F.push(makeFinding({ id: 'R_Q_WINDOW', title: 'Q 的宜居窗口', basis: 'heuristic',
      formula: 'Tegmark & Rees 1998：Q ≲ 10⁻⁶ 星系太稀无法冷却；Q ≳ 10⁻⁴ 星系太密、行星轨道被扰动；Q ≳ 10⁻³ 团块在冷却前坍缩为黑洞（束缚能 ~Q c²）',
      inputs: { Qeff: Qeff }, value: Qeff, valueText: 'Q_eff=' + sci(Qeff, 2),
      threshold: '10⁻⁶ ≲ Q ≲ 10⁻⁴', verdict: Qeff >= 1e-3 ? 'fail' : (Qeff > 1e-4 || Qeff < 1e-6 ? 'warn' : 'ok'),
      text: Qeff >= 1e-3 ? 'Q_eff≥10⁻³：坍缩团块的位力速度 ~√Q c≈' + sci(Math.sqrt(Qeff) * 3e5, 2) + ' km/s，气体在冷却成恒星前直接落入视界——黑洞主导。' : Qeff > 1e-4 ? '星系过密：恒星密近交会频繁，行星系统难以长期稳定。' : Qeff < 1e-6 ? '星系过稀：位力温度太低、气体难以冷却成恒星。' : '落在 Tegmark–Rees 窗口内。',
      ref: 'Tegmark & Rees 1998；Tegmark, Aguirre, Rees & Wilczek 2006' }));
    if (S.fnu > 0.02) F.push(makeFinding({ id: 'R_NEUTRINO', title: '中微子自由流动', basis: 'scaling', formula: 'f_ν = Ω_ν/Ω_m，Ω_ν h² = Σm_ν/93.14 eV；ΔP/P ≈ −8 f_ν', inputs: { sumNu: p.sumNu, fnu: S.fnu }, value: S.fnu, valueText: 'f_ν=' + S.fnu.toFixed(3),
      threshold: 'f_ν ≲ 0.05', verdict: S.fnu > 0.12 ? 'fail' : (S.fnu > 0.05 ? 'bad' : 'warn'), text: '小尺度功率被压低约 ' + Math.round(clamp01(8 * S.fnu) * 100) + '%。', ref: 'Tegmark, Vilenkin & Pogosian 2005' }));
    if (p.omegaC <= 0 && p.omegaB > 0) F.push(makeFinding({ id: 'R_NO_CDM', title: '没有冷暗物质', basis: 'heuristic', formula: '重子涨落受 Silk 阻尼与光子拖曳，复合后才增长', inputs: { omegaC: 0 }, value: 0.5, valueText: '幅度按 ½ 计', threshold: '—', verdict: 'warn', text: '结构只能靠重子自身，形成推迟。', ref: 'Silk 1968' }));
  }

  // ---------- 恒星（Adams 2008 标度） ----------
  function calcStars(p, F, calc) {
    var aR = p.alpha / ALPHA0, beta = p.meOverMp, aG = p.alphaG;
    var Mmin = 0.08 * Math.pow(aR, 1.5) * Math.pow(beta, -0.75) * Math.pow(aG, -1.5);   // 点火下限：T_ign ∝ α² m_p；简并上限 T_max ∝ M^{4/3} mₑ；质量尺度 ∝ α_G^{−3/2}
    var Mmax = 100 * Math.pow(aG, -1.5);                                                 // 辐射压不稳定 ∝ α_G^{−3/2} m_p（Adams 2008）
    // #7：α_G/α/mₑ 越出模型适用范围时质量标度可能发散或非有限——短路并说明，绝不把 NaN 传给下游
    if (!isFinite(Mmin) || !isFinite(Mmax) || Mmin <= 0 || Mmax <= 0) {
      calc.stars = { Mmin: Mmin, Mmax: Mmax, tMSGyr: 0, Lrel: 0, canIgnite: false, ZmaxNuc: 0, heavyElements: false,
        carbonOK: false, supernovaOK: false, alphaG: ALPHA_G * aG, alphaGRel: aG, degenerate: true };
      F.push(makeFinding({ id: 'R_STAR_MASS', title: '恒星质量窗口', basis: 'scaling',
        formula: 'Adams 2008：M_min、M_max ∝ M₀ = α_G^{−3/2}m_p（eq.1/35/39）',
        inputs: { alpha: p.alpha, meOverMp: beta, alphaGRel: aG }, value: null, valueText: '质量标度非有限（α_G=' + sci(aG, 2) + '×、α=' + sci(p.alpha, 2) + '、mₑ/mₚ=' + sci(beta, 2) + '）',
        threshold: 'M_min、M_max 需为有限正数', verdict: 'fail',
        text: '这组参数使恒星质量标度 M₀=α_G^{−3/2}m_p 发散或非有限（多为 αₛ(M_Z) 极小导致 Λ_QCD 下溢、α_G→0）：Adams 2008 的标度关系在此不再适用，引擎不做外推，恒星一栏留空。',
        ref: 'Adams 2008, JCAP 08, 010（arXiv:0807.3697）§3.1–3.2' }));
      return;
    }
    var tMS = 10 * Math.pow(aR, 2) * Math.pow(beta, -2) / aG;                            // t ∝ M/L ∝ α_G⁻¹·α²/mₑ²
    var Lrel = Math.pow(aR, -2) * Math.pow(beta, 2) * aG;                                // 典型恒星光度相对值
    var canIgnite = calc.bbn.deuteronBound && Mmin < Mmax && calc.baryons.hasBaryons && p.alpha < 0.5;
    // Adams 2008 适用范围：推导用牛顿简并压/辐射压（eq.35/39），不含广义相对论静力平衡上限、对不稳定性（pair-instability ~100–260 M⊙）或观测主序上限 ~150–300 M⊙。
    // M_min ≳ 300 M⊙ 时整段"主序窗口"已越出该标度的合理外推；数值仍有限故不短路，但 verdict/文案必须诚实。
    // 阈值取 300 M⊙：与观测最重主序星量级及对不稳定性上沿同量级，再高则"稳定燃烧恒星"表述不再可信。
    var ADAMS_MS_SCOPE_MSUN = 300;
    var outOfAdamsScope = Mmin >= ADAMS_MS_SCOPE_MSUN;
    var ZmaxNuc = 92 * ALPHA0 / p.alpha;                                // 核库仑极限（铀在我们这里勉强稳定）
    var heavyOK = ZmaxNuc >= 26;                                        // 能否造到铁
    var carbonOK = ZmaxNuc >= 6;
    var snOK = p.higgsVev <= 3;                                         // 超新星中微子机制（G_F ∝ v⁻²，v>3 中微子逃逸太快；启发式）
    calc.stars = { Mmin: Mmin, Mmax: Mmax, tMSGyr: tMS, Lrel: Lrel, canIgnite: canIgnite, ZmaxNuc: ZmaxNuc, heavyElements: heavyOK && canIgnite, carbonOK: carbonOK, supernovaOK: snOK, alphaG: ALPHA_G * aG, alphaGRel: aG, outOfAdamsScope: outOfAdamsScope };
    var massVerdict = Mmin >= Mmax ? 'fail' : (outOfAdamsScope ? 'bad' : (Mmin > 10 ? 'warn' : 'ok'));
    var massText;
    if (Mmin >= Mmax) {
      massText = '点火所需质量超过辐射压上限——没有稳定燃烧的恒星。';
    } else if (outOfAdamsScope) {
      massText = '标度给出 M_min=' + trimNum(Mmin, 3) + '–M_max=' + trimNum(Mmax, 3) + ' M⊙，但 M_min ≳ ' + ADAMS_MS_SCOPE_MSUN + ' M⊙ 已超出 Adams 2008 标度关系的合理适用范围（该标度基于牛顿简并压/辐射压论证，未包含大质量端的广义相对论不稳定性与对不稳定性修正；观测主序恒星也极少超过 ~150–300 M⊙）。这组参数下形成的致密天体更可能是直接坍缩黑洞而非稳定燃烧的主序恒星。若后续可居住性判断建立在此窗口上，结论仅供参考。';
    } else {
      massText = '主序恒星质量范围 ' + trimNum(Mmin, 3) + '–' + trimNum(Mmax, 3) + ' M⊙。' + (Mmin > 10 ? '点火下限已偏高（>10 M⊙），恒星稀少且寿命短。' : '');
    }
    massText += '窗口宽度 M_max/M_min ∝ α^{−3/2}(mₑ/mₚ)^{3/4}，与 α_G 无关；α_G 只整体缩放质量标度 M₀。';
    F.push(makeFinding({ id: 'R_STAR_MASS', title: '恒星质量窗口', basis: 'scaling',
      formula: 'Adams 2008：两端都 ∝ M₀ = α_G^{−3/2}m_p（eq. 1）。M_min = 6(3π)^{1/2}(4/5)^{3/4}(m_p/m_ion)²(kT_nuc/mₑc²)^{3/4}·M₀（eq. 35，简并 vs 点火）；M_max = (18√5/π^{3/2})((1−f_g)/f_g⁴)^{1/2}(m_p/⟨m⟩)²·M₀ ≈ 56M₀（eq. 39，辐射压 f_g=½）。取 T_nuc ∝ α²m_p（Gamow）⇒ M_min/M_max ∝ (α/α₀)^{3/2}(mₑ/mₚ)^{−3/4}：窗口宽度由 α 与质量比控制，α_G 只整体平移。适用范围：牛顿论证；M_min ≳ 300 M⊙ 时未纳入 GR/对不稳定性',
      inputs: { alpha: p.alpha, meOverMp: beta, alphaGRel: aG }, value: Mmin, valueText: 'M_min=' + trimNum(Mmin, 3) + ' M⊙，M_max=' + trimNum(Mmax, 3) + ' M⊙（M_max/M_min=' + trimNum(Mmax / Mmin, 3) + '）' + (outOfAdamsScope ? '·超出牛顿标度适用范围' : ''),
      threshold: 'M_min < M_max；且 M_min ≲ 300 M⊙ 时标度才可信为"主序恒星"', verdict: massVerdict,
      text: massText,
      ref: 'Adams 2008, JCAP 08, 010（arXiv:0807.3697）§3.1–3.2, eq. 1/35/39；Barrow & Tipler 1986' }));
    F.push(makeFinding({ id: 'R_STAR_IGNITE', title: '恒星能否点燃核燃烧', basis: 'scaling',
      formula: '需要：氘核束缚（pp 链）∧ M_min<M_max ∧ 有重子 ∧ Zα<1（库仑势垒可穿透）',
      inputs: { deuteronBound: calc.bbn.deuteronBound, Mmin: Mmin, outOfAdamsScope: outOfAdamsScope }, value: canIgnite ? 1 : 0, valueText: canIgnite ? (outOfAdamsScope ? '标度上可点燃（但已越出 Adams 适用范围）' : '可以点燃') : '无法点燃',
      threshold: '—', verdict: canIgnite ? (outOfAdamsScope ? 'bad' : 'ok') : 'fail',
      text: canIgnite
        ? (outOfAdamsScope
          ? '按 Adams 标度 M_min<M_max 且氘核束缚，形式上可通过 pp 链"点燃"，但点火质量已 ≳ ' + ADAMS_MS_SCOPE_MSUN + ' M⊙，越出该标度的合理适用范围：更可能直接坍缩为黑洞，而非稳定主序燃烧。'
          : '恒星可以通过 pp 链稳定燃烧。')
        : (!calc.bbn.deuteronBound ? '氘核不束缚，pp 链第一步走不通；' : '') + (Mmin >= Mmax ? '点火质量超过上限；' : '') + (!calc.baryons.hasBaryons ? '没有重子；' : '') + '恒星无法点燃。',
      ref: 'Adams 2008' }));
    F.push(makeFinding({ id: 'R_STAR_LIFE', title: '主序寿命', basis: 'scaling',
      formula: 't_MS ≈ 10 Gyr·α_G⁻¹·(α/α₀)²·(mₑ/mₚ)^{−2}（t ∝ M/L，L ∝ M³/κ，κ_es ∝ α²/mₑ²）',
      inputs: { alpha: p.alpha, meOverMp: beta, alphaGRel: aG }, value: tMS, valueText: 't_MS(1 M⊙)=' + formatTime(tMS) + '，L=' + trimNum(Lrel, 3) + ' L⊙',
      threshold: '生物演化需 ≳ 0.5 Gyr', verdict: tMS < 0.05 ? 'fail' : (tMS < 0.5 ? 'bad' : tMS < 2 ? 'warn' : 'ok'),
      text: '太阳质量恒星寿命 ' + formatTime(tMS) + '，光度 ' + trimNum(Lrel, 3) + ' L⊙。' + (tMS < 0.5 ? '短于生物演化所需的数亿年。' : ''), ref: 'Adams 2008；Carr & Rees 1979' }));
    F.push(makeFinding({ id: 'R_NUCLEI', title: '稳定原子核的上限', basis: 'scaling',
      formula: '库仑能 ∝ Z²α/A^{1/3} vs 核结合 ∝ A ⇒ Z_max ≈ 92·(α₀/α)', inputs: { alpha: p.alpha }, value: ZmaxNuc, valueText: 'Z_max≈' + Math.floor(ZmaxNuc),
      threshold: '碳 Z=6；铁 Z=26', verdict: !carbonOK ? 'fail' : (!heavyOK ? 'bad' : ZmaxNuc < 60 ? 'warn' : 'ok'),
      text: !carbonOK ? '碳以上的原子核因库仑排斥瓦解，没有碳。' : !heavyOK ? '铁以上的核不稳定，恒星核合成早早截止。' : '原子核最多到 Z≈' + Math.floor(ZmaxNuc) + '。', ref: 'Barrow & Tipler 1986' }));
    F.push(makeFinding({ id: 'R_SUPERNOVA', title: '重元素散布（超新星）', basis: 'heuristic',
      formula: '核坍缩超新星靠中微子加热；G_F ∝ v⁻²，v≳3 中微子截面过小、无法炸开', inputs: { higgsVev: p.higgsVev }, value: p.higgsVev, valueText: 'v/v₀=' + trimNum(p.higgsVev, 3),
      threshold: 'v ≲ 3', verdict: snOK ? 'ok' : 'bad', text: snOK ? '超新星可以把重元素散布到星际空间。' : '弱作用太弱，超新星哑火，重元素锁在恒星核心。', ref: 'Agrawal et al. 1998；Harnik, Kribs & Perez 2006（弱作用缺席宇宙）' }));
  }

  // ---------- 原子 / 化学 ----------
  function calcAtoms(p, F, calc) {
    var aR = p.alpha / ALPHA0, beta = p.meOverMp;
    var a0 = 1 / (aR * (p.electronMassMeV / ME0_MEV));      // Bohr 半径相对值 ∝ 1/(α mₑ)
    var Ry = 13.6 * aR * aR * (p.electronMassMeV / ME0_MEV); // eV
    var ZmaxAtom = Math.floor(1 / p.alpha);                // Dirac：Zα<1
    var boRatio = Math.pow(beta / 1836.15, 0.25);          // Born–Oppenheimer 参数 (mₑ/mₚ)^{1/4}
    var hydrogen = calc.bbn.hydrogenState === 'stable' && !calc.bbn.diprotonBound;
    var atoms = calc.baryons.hasBaryons && calc.bbn.hydrogenState !== 'proton_decay' && ZmaxAtom >= 2 && p.alpha < 0.5;
    var nElements = Math.min(ZmaxAtom, Math.floor(calc.stars.ZmaxNuc));
    var moleculesOK = boRatio < 0.45;
    var chemistry = atoms && hydrogen && nElements >= 6 && moleculesOK && calc.dims.orbitStability > 0.25;
    calc.atoms = { a0rel: a0, RyEV: Ry, ZmaxAtom: ZmaxAtom, nElements: nElements, boRatio: boRatio, hydrogen: hydrogen, atoms: atoms, molecules: moleculesOK, chemistry: chemistry };
    F.push(makeFinding({ id: 'R_ATOMS', title: '原子稳定性（Bohr / Dirac）', basis: 'computed',
      formula: 'a₀ ∝ 1/(α mₑ)；Ry = 13.6 eV·(α/α₀)²(mₑ/mₑ₀)；Dirac 基态要求 Zα<1 ⇒ Z_max,atom = ⌊1/α⌋',
      inputs: { alpha: p.alpha, electronMassMeV: p.electronMassMeV }, value: ZmaxAtom, valueText: 'a₀=' + trimNum(a0, 3) + ' a₀⁰，Ry=' + trimNum(Ry, 3) + ' eV，Z_max,atom=' + ZmaxAtom,
      threshold: 'Z_max ≥ 2（有多电子原子）', verdict: atoms ? (ZmaxAtom < 6 ? 'bad' : 'ok') : 'fail',
      text: !calc.baryons.hasBaryons ? '没有重子，没有原子。' : calc.bbn.hydrogenState === 'proton_decay' ? '质子衰变，没有原子核可供束缚电子。' : atoms ? '原子存在，电子壳层稳定到 Z=' + ZmaxAtom + '。' : 'α=' + trimNum(p.alpha, 3) + '：Zα 逼近 1，内层电子相对论性坠落、真空自发产生正负电子对——多电子原子不稳定。',
      ref: 'Bohr 1913；Dirac 1928；Greiner, Müller & Rafelski 1985（超临界场）' }));
    F.push(makeFinding({ id: 'R_MOLECULES', title: '分子刚性（Born–Oppenheimer）', basis: 'scaling',
      formula: '(mₑ/mₚ)^{1/4} 控制振动/电子能级分离；≳0.45 时分子失去固定形状',
      inputs: { meOverMp: beta }, value: boRatio, valueText: '(mₑ/mₚ)^{1/4}=' + boRatio.toFixed(3),
      threshold: '<0.45（我们 0.153）', verdict: moleculesOK ? (boRatio > 0.3 ? 'warn' : 'ok') : 'fail',
      text: moleculesOK ? (boRatio > 0.3 ? '分子结构开始模糊。' : '分子有确定的几何结构。') : '电子与原子核质量可比，分子没有固定形状，复杂化学不可能。', ref: 'Barrow & Tipler 1986' }));
    F.push(makeFinding({ id: 'R_CHEMISTRY', title: '化学是否可行', basis: 'scaling',
      formula: '需要：原子 ∧ 氢 ∧ 元素数 ≥ 6（碳）∧ 分子刚性 ∧ 轨道稳定', inputs: { nElements: nElements, hydrogen: hydrogen }, value: nElements, valueText: '可用元素 Z≤' + nElements + (hydrogen ? '，有氢' : '，无氢'),
      threshold: 'Z_max ≥ 6 且有氢', verdict: chemistry ? 'ok' : 'fail',
      text: chemistry ? '有氢有碳，分子刚性足够：化学可以复杂化。' : (!hydrogen ? '没有氢（' + (calc.bbn.diprotonBound ? '在 BBN 烧光' : '氢原子不稳定') + '），没有水。' : nElements < 6 ? '没有碳。' : !moleculesOK ? '分子没有刚性。' : '轨道不稳定。'),
      ref: 'Barrow & Tipler 1986；Hogan 2000' }));
  }

  // ---------- 行星与宜居 ----------
  function calcPlanets(p, cos, F, calc) {
    var aR = p.alpha / ALPHA0;
    var Mplanet = Math.pow(aR / calc.stars.alphaGRel, 1.5);        // Weisskopf：M_max,planet ∝ (α/α_G)^{3/2} mₚ → 相对值
    var dHZ = Math.sqrt(calc.stars.Lrel);                          // AU
    var tMS = calc.stars.tMSGyr;
    var tGal = calc.structure.gal ? calc.structure.gal.tGyr : null;
    var tEnd = cos.fate.tGyr;
    var windowGyr = tGal != null ? (tEnd != null ? tEnd - tGal : Infinity) : 0;
    var timeOK = tMS >= 0.5 && windowGyr >= 1;
    var qOK = calc.structure.Qeff <= 1e-4 && calc.structure.Qeff >= 1e-6;
    var planetsOK = calc.stars.heavyElements && calc.stars.supernovaOK && calc.atoms.chemistry;
    calc.planets = { MplanetRel: Mplanet, dHZ_AU: dHZ, windowGyr: windowGyr, timeOK: timeOK, qOK: qOK, planetsOK: planetsOK };
    F.push(makeFinding({ id: 'R_PLANETS', title: '行星与宜居带', basis: 'scaling',
      formula: '行星质量上限 ∝ (α/α_G)^{3/2} mₚ（Weisskopf 1975）；宜居带 d_HZ = 1 AU·√(L/L⊙)；需要重元素被造出并散布',
      inputs: { alpha: p.alpha, Lrel: calc.stars.Lrel }, value: dHZ, valueText: 'd_HZ=' + trimNum(dHZ, 3) + ' AU，行星质量尺度 ×' + trimNum(Mplanet, 3),
      threshold: '—', verdict: planetsOK ? 'ok' : 'bad',
      text: planetsOK ? '岩石行星可以形成，液态水区间在 ' + trimNum(dHZ, 3) + ' AU 附近。' : '缺少重元素或化学，难有岩石行星与海洋。', ref: 'Weisskopf 1975；Kasting, Whitmire & Reynolds 1993' }));
    F.push(makeFinding({ id: 'R_TIMESCALE', title: '时间尺度：恒星寿命 vs 生物演化', basis: 'heuristic',
      formula: 't_MS ≥ 0.5 Gyr 且 星系形成到终结的窗口 ≥ 1 Gyr（地球：生命 ~0.5 Gyr，复杂生命 ~4 Gyr）',
      inputs: { tMS: tMS, windowGyr: windowGyr }, value: Math.min(tMS, windowGyr), valueText: 't_MS=' + formatTime(tMS) + '，窗口=' + (isFinite(windowGyr) ? formatTime(windowGyr) : '∞'),
      threshold: '≥ 0.5 Gyr / ≥ 1 Gyr', verdict: timeOK ? 'ok' : 'bad',
      text: timeOK ? '有足够的时间让化学复杂化。' : (tMS < 0.5 ? '恒星寿命太短。' : '宇宙在星系形成后不久就终结。'), ref: 'Carter 1983；Adams 2008' }));
  }

  // ---------- BIOCHEM：生物化学基础（三氦过程 / 液态水 / 复杂化学 / 替代生化） ----------
  var ELEMENT_NAMES = { 1: 'H', 6: 'C', 7: 'N', 8: 'O', 14: 'Si', 15: 'P', 16: 'S', 26: 'Fe' };
  function calcBiochem(p, cos, F, calc, modules) {
    var st = calc.stars, at = calc.atoms, pl = calc.planets;
    // --- R_HOYLE：三氦过程 Hoyle 共振敏感性 ---
    // Oberhummer, Csótó & Schlattl 2000：核力 ±0.5% 或电磁 ±4% ⇒ ¹²C 或 ¹⁶O 产率骤降 30–1000 倍。
    // 线性化：ξ = Δs/0.005 − Δα/0.04（Hoyle 能级下移为正：核力增强 / 库仑减弱）；ξ<0 → 碳受抑，ξ>0 → 氧受抑；
    // log10 f_C = −2·max(0,−ξ)，log10 f_O = −2·max(0,ξ)（|ξ|=1 对应 100 倍，落在文献 30–1000 倍区间；仅在 |Δs|≲2%、|Δα|≲15% 内使用）。
    var ds = p.alphaS - 1, da = p.alpha / ALPHA0 - 1;
    var xi = ds / 0.005 - da / 0.04;
    var fC = Math.pow(10, -2 * Math.max(0, -xi)), fO = Math.pow(10, -2 * Math.max(0, xi));
    var hoyleOK = fC >= 0.05 && fO >= 0.05 && st.canIgnite && at.nElements >= 8;
    var hoyleVerdict = !st.canIgnite || at.nElements < 8 ? 'fail' : (hoyleOK ? (Math.abs(xi) > 0.3 ? 'warn' : 'ok') : 'fail');
    F.push(makeFinding({ id: 'R_HOYLE', title: '三氦过程与 Hoyle 共振（碳/氧产率）', basis: 'scaling',
      formula: 'ξ = (αₛ,nuc−1)/0.005 − (α/α₀−1)/0.04；f_C = 10^{−2·max(0,−ξ)}，f_O = 10^{−2·max(0,ξ)}——线性化自 Oberhummer et al. 2000（核力 ±0.5% / 电磁 ±4% ⇒ C 或 O 产率降 30–1000 倍）；Ekström et al. 2010 与 Epelbaum et al. 2013（夸克质量 ±2–3%）给出更宽区间；仅在 |Δαₛ|≲2%、|Δα|≲15% 内使用',
      inputs: { alphaSnuc: p.alphaS, alphaRel: p.alpha / ALPHA0, xi: xi }, value: Math.min(fC, fO), valueText: '碳产率 ×' + sci(fC, 2) + '，氧产率 ×' + sci(fO, 2),
      threshold: 'f_C ≥ 0.05 且 f_O ≥ 0.05', verdict: hoyleVerdict,
      text: !st.canIgnite ? '恒星无法点燃，谈不上三氦过程。' : at.nElements < 8 ? '原子核最多到 Z=' + at.nElements + '，没有稳定的氧。' : hoyleOK ? 'Hoyle 共振在容许区间内（ξ=' + trimNum(xi, 2) + '），恒星同时产出碳与氧。' : (xi < 0 ? '核力偏弱/库仑偏强使 Hoyle 能级上移，¹²C 产率降到 ×' + sci(fC, 2) + '——几乎没有碳。' : '核力偏强/库仑偏弱使 Hoyle 能级下移，¹²C 迅速烧成 ¹⁶O 之前的平衡被打破，¹⁶O 产率降到 ×' + sci(fO, 2) + '——几乎没有氧。'),
      ref: 'Oberhummer, Csótó & Schlattl 2000, Science 289, 88；Ekström et al. 2010, A&A 514, A62；Epelbaum et al. 2013, PRL 110, 112502；Hoyle 1954' }));
    // --- R_WATER：液态水温度窗口 ---
    // H₂O 键能 ∝ Ry ∝ α²mₑ ⇒ 液态温区 T_liq ∝ α²mₑ（相对）；行星平衡温度 T ∝ (L/d²)^{1/4} ⇒ 液态水轨道 d_w = √L·(α²mₑ)^{−2} AU
    var eScale = Math.pow(p.alpha / ALPHA0, 2) * (p.electronMassMeV / ME0_MEV);
    var dWater = Math.sqrt(st.Lrel) / (eScale * eScale);
    var waterOK = at.hydrogen && at.nElements >= 8 && at.molecules && st.canIgnite && fO >= 0.05 && isFinite(dWater) && dWater > 0;   // 溶剂窗口本身；行星供给归可居住性
    F.push(makeFinding({ id: 'R_WATER', title: '液态水温度窗口', basis: 'scaling',
      formula: 'H₂O 键能与液态温区 ∝ Ry ∝ α²mₑ；行星平衡温度 T ∝ (L/d²)^{1/4} ⇒ 存在液态水的轨道 d_w = 1 AU·√(L/L⊙)·(α²mₑ/α₀²mₑ₀)^{−2}；需要 H、O（三氦过程产氧）与刚性分子',
      inputs: { alpha: p.alpha, electronMassMeV: p.electronMassMeV, Lrel: st.Lrel, hydrogen: at.hydrogen, oxygen: at.nElements >= 8 && fO >= 0.05 }, value: dWater, valueText: waterOK ? '某轨道处可有液态水：是（d_w≈' + trimNum(dWater, 3) + ' AU）' : '某轨道处可有液态水：否',
      threshold: '有 H、有 O、分子刚性、恒星点燃', verdict: waterOK ? 'ok' : 'fail',
      text: waterOK ? '在 d≈' + trimNum(dWater, 3) + ' AU 处行星表面可维持液态水（键能标度 ×' + trimNum(eScale, 3) + '）。' : (!at.hydrogen ? '没有氢，没有水。' : at.nElements < 8 || fO < 0.05 ? '没有氧（核不稳定或三氦过程不产氧），没有水。' : !at.molecules ? '分子没有刚性，谈不上液态水。' : '没有恒星加热行星。'),
      ref: 'Barrow & Tipler 1986；Barnes 2012, PASA 29, 529（综述）；Kasting, Whitmire & Reynolds 1993' }));
    // --- R_COMPLEX_CHEM：复杂化学 ---
    var avail = [];
    Object.keys(ELEMENT_NAMES).map(Number).sort(function (a, b) { return a - b; }).forEach(function (Z) { if (at.nElements >= Z && at.atoms && (Z !== 1 || at.hydrogen)) avail.push(ELEMENT_NAMES[Z]); });
    var complexOK = p.alpha < 0.1 && at.molecules && at.atoms && at.nElements >= 16 && at.hydrogen;
    F.push(makeFinding({ id: 'R_COMPLEX_CHEM', title: '复杂化学的可能性', basis: 'scaling',
      formula: 'α<0.1（化学能标/相对论修正）∧ (mₑ/mₚ)^{1/4}<0.45（分子刚性）∧ Z_max ≥ 16（C、N、O、Si、P、S 可用）∧ 有氢',
      inputs: { alpha: p.alpha, boRatio: at.boRatio, Zmax: at.nElements }, value: at.nElements, valueText: '可用元素：' + (avail.length ? avail.join(' ') : '无') + '（Z≤' + at.nElements + '）',
      threshold: 'Z_max ≥ 16、α<0.1、分子刚性', verdict: complexOK ? 'ok' : (at.nElements >= 6 && at.molecules ? 'warn' : 'fail'),
      text: complexOK ? '碳、氮、氧、硅、磷、硫都可用，分子有刚性：复杂化学可行。' : (at.nElements < 16 ? '周期表在 Z=' + at.nElements + ' 截止：' + (at.nElements < 14 ? '没有硅' : at.nElements < 15 ? '没有磷' : '没有硫') + '，复杂化学受限。' : !at.molecules ? '分子无刚性。' : p.alpha >= 0.1 ? 'α≥0.1，化学能标与相对论修正过大。' : '没有氢。'),
      ref: 'Barrow & Tipler 1986；Barnes 2012' }));
    // --- R_BIOCHEM_CARBON：综合 ---
    var rawOK = hoyleOK, solventOK = waterOK, carbonWater = rawOK && solventOK && complexOK;
    // eScale 落库：R_OCEAN 的液态温区用的是同一条键能标度（∝ Ry ∝ α²mₑ），两处必须是同一个数
    calc.biochem = { xi: xi, fC: fC, fO: fO, eScale: eScale, hoyleOK: hoyleOK, dWater: dWater, waterOK: waterOK, complexOK: complexOK, elements: avail, carbonWater: carbonWater };
    F.push(makeFinding({ id: 'R_BIOCHEM_CARBON', title: '碳-水型生物化学', basis: 'scaling',
      formula: '原料（C、O 由三氦过程产出）∧ 溶剂窗口（液态水）∧ 复杂化学 ⇒ 可能',
      inputs: { rawOK: rawOK, solventOK: solventOK, complexOK: complexOK }, value: carbonWater ? 1 : 0,
      valueText: '原料（C、O）' + (rawOK ? '✓' : '✗') + ' · 溶剂窗口 ' + (solventOK ? '✓' : '✗') + ' · 复杂化学 ' + (complexOK ? '✓' : '✗') + ' → ' + (carbonWater ? '可能' : '不可能'),
      threshold: '三项皆 ✓', verdict: carbonWater ? 'ok' : 'fail',
      text: carbonWater ? '碳与氧由三氦过程产出（Hoyle 共振在容许区间内），液态水窗口存在，复杂化学可行 → 碳-水型生化可能。' : '碳-水型生化不可能：' + (!rawOK ? '三氦过程产不出足够的碳/氧' : !solventOK ? '没有液态水窗口' : '复杂化学受限') + '。',
      ref: 'Oberhummer et al. 2000；Barnes 2012；Barrow & Tipler 1986' }));
    // --- 模块：替代生化（heuristic） ---
    if (modules && modules.altBiochem) {
      var siOK = at.nElements >= 14 && at.molecules, carbonSuppressed = !rawOK;
      var hotOrbit = st.canIgnite && pl.planetsOK;                          // 恒星附近总存在 >400 K 的轨道
      var nh3ch4 = at.hydrogen && at.nElements >= 7 && at.molecules && st.canIgnite;   // 液态氨/甲烷窗口需 N/C 与冷轨道
      var score = (carbonSuppressed ? 1 : 0) + (siOK ? 1 : 0) + ((hotOrbit || nh3ch4) ? 1 : 0);
      var tend = !siOK && !nh3ch4 ? '低' : (score >= 3 ? '高' : score === 2 ? '中' : '低');
      calc.biochem.altTendency = tend;
      F.push(makeFinding({ id: 'R_ALT_BIOCHEM', title: '替代生化（硅基 / 非水溶剂）的推测倾向', basis: 'heuristic',
        formula: '碳受抑 + Si 可用 + （行星温度 >400 K 的轨道 或 液态氨/甲烷窗口）→ 倾向 低/中/高；无公认判据，仅为文献中的定性论证',
        inputs: { carbonSuppressed: carbonSuppressed, siliconAvailable: siOK, hotOrbit: hotOrbit, ammoniaMethaneWindow: nh3ch4 }, value: score, valueText: '倾向：' + tend,
        threshold: '—', verdict: 'warn',
        text: '硅基或非水溶剂生化的推测倾向：' + tend + '（碳受抑 ' + (carbonSuppressed ? '是' : '否') + '，Si 可用 ' + (siOK ? '是' : '否') + '，>400 K 轨道 ' + (hotOrbit ? '有' : '无') + '，氨/甲烷窗口 ' + (nh3ch4 ? '有' : '无') + '）。无公认判据，仅为文献中的定性论证：Bains 讨论硅化学在高温/非水溶剂中的可能，NRC 2007 指出液态氨、甲烷等溶剂的化学可行性未被排除。不改变主结局。',
        ref: 'Bains 2004, Astrobiology 4, 137；Schulze-Makuch & Irwin 2008《Life in the Universe》；NRC 2007《The Limits of Organic Life in Planetary Systems》' }));
    }
  }

  /* ---------- R_OCEAN：冷液体宇宙（依据等级 heuristic） ----------
   * 场景出处与文学来源只记在 research/ 笔记与本注释里，**不进用户可见文案与词典**。
   *
   * 要判的是一类物理状态：**引力弱到气体不塌缩、没有一颗恒星点燃，但分子还在、
   * 而且背景温度正好落在分子的液态温区** —— 物质既不聚成天体也不全是气体，
   * 以液滴/液膜的形态弥散。四条全部由引擎已有的量推出，一个新常数都不引入：
   *
   * (1) 塌缩时标 > 宇宙年龄。
   *     金斯/自由落体判据：t_ff = √(3π/(32Gρ))（Jeans 1902；Binney & Tremaine 2008）。
   *     取宇宙平均重子密度 ρ_b = Ω_b·ρ_crit,0·a⁻³，ρ_crit,0 = 3H₀²/(8πG₀)，代入得
   *         t_ff = (π/2)·H₀⁻¹·a^{3/2}·(G/G₀·Ω_b)^{−1/2}
   *     其中 G/G₀ = α_G/(m_p/m_p₀)²，正是 deriveConstants 里 α_G=(m_p/M_Pl)²×gNewton 的
   *     那个 gNewton。H₀⁻¹ 直接取积分器的 B.TH（Gyr）。
   *     **这里有一条必须写明的近似**：引擎的 Friedmann 层完全由 Ω 参数化，G 在 ρ_crit 里
   *     被约掉，膨胀史不随 α_G 变；本条让 α_G 只进入"自引力"那一侧，等价于沿用 params.js
   *     对 gNewton 的既定口径（"进入恒星点火质量窗口、主序寿命、行星最大质量"，不进宇宙学）。
   *     另一条近似：取的是宇宙平均密度，不计暗物质晕内的增密——这一侧偏向"不塌缩"。
   *     评点选在液态窗口的**起点**（气体最密、最有利于塌缩的那一刻），与 t(a=1) 相比。
   * (2) 没有恒星点燃：calc.stars.canIgnite === false（R_STAR_IGNITE）。这一条同时是本规则的
   *     前置——有恒星的宇宙不评估它，所以默认宇宙的 findings 一条不多、worstVerdict 不变。
   * (3) 化学完好：calc.atoms.atoms && calc.atoms.molecules（R_ATOMS / R_MOLECULES）。
   * (4) 温度落在分子液态窗口：液态温区 ∝ 键能 ∝ Ry ∝ α²mₑ —— 与 R_WATER 用的是同一条标度
   *     （calc.biochem.eScale），基准取 1 atm 下水的熔点/沸点 273.15 / 373.15 K。
   *     背景温度 T(a)=T_CMB/a（引擎 integrate 的 temperatureAt），于是液态窗口对应
   *         a ∈ [T_CMB/T_boil, T_CMB/T_melt]
   *     再要求这一段**在复合之后**（此前是等离子体，根本没有分子）且落在宇宙寿命之内。
   *
   * 这条规则只写 finding 与 calc.ocean，**不参与 decideOutcome**：这类宇宙的结局仍是
   * 现有的 NO_STARS（它本来就是"没有恒星的宇宙"），沙盘/画面另按 variant 分流。
   */
  var T_MELT_K = 273.15, T_BOIL_K = 373.15;    // 1 atm 下水的熔点/沸点（IUPAC/CODATA），液态温区的基准
  function calcOcean(p, B, cos, F, calc) {
    var st = calc.stars, at = calc.atoms, bc = calc.biochem || {};
    var starsOff = !st.canIgnite;
    calc.ocean = { evaluated: false, pass: false, noCollapse: false, starsOff: starsOff, chemistry: false, liquid: false,
      collapseRatio: null, tFFGyr: null, tAgeGyr: null, eScale: null, TliqLoK: null, TliqHiK: null,
      aLo: null, aHi: null, zLo: null, zHi: null, tLiqStartGyr: null, tLiqEndGyr: null, M0Msun: null, MbaryonMsun: null, gRel: null, why: '' };
    calc.ocean.evaluated = starsOff;   // evaluated = 这一条会不会出现在 findings 里（有恒星的宇宙不出）

    // --- (3) 化学：有原子、有刚性分子 ---
    var chemOK = !!(at && at.atoms && at.molecules);

    // --- (4) 液态温区与它对应的时间区间 ---
    var eScale = (bc.eScale != null && isFinite(bc.eScale)) ? bc.eScale
      : Math.pow(p.alpha / ALPHA0, 2) * (p.electronMassMeV / ME0_MEV);
    var TliqLo = T_MELT_K * eScale, TliqHi = T_BOIL_K * eScale;      // 这个宇宙的"液态温区"
    var tcmb = B.tcmb || p.tcmb;
    var aLo = (isFinite(TliqHi) && TliqHi > 0) ? tcmb / TliqHi : null;   // 温度较高 → a 较小（早）
    var aHi = (isFinite(TliqLo) && TliqLo > 0) ? tcmb / TliqLo : null;   // 温度较低 → a 较大（晚）
    var zHi = (aLo != null && aLo > 0) ? 1 / aLo - 1 : null;             // 窗口起点的红移（早）
    var zLo = (aHi != null && aHi > 0) ? 1 / aHi - 1 : null;             // 窗口终点的红移（晚）
    var zRec = calc.recombination ? calc.recombination.zRec : null;
    var afterRec = zRec != null && zHi != null && zHi < zRec;            // 整段都在复合之后才有分子
    var tEnd = cos.fate.tGyr;
    var tLiqStart = aLo != null ? cos.tOfA(aLo) : null;
    var tLiqEnd = aHi != null ? cos.tOfA(aHi) : null;
    var inLife = tLiqStart != null && isFinite(tLiqStart) && (tEnd == null || tLiqStart <= tEnd);
    var liquidOK = !!(afterRec && inLife);

    // --- (1) 塌缩时标 / 宇宙年龄 ---
    var mpRel = (p.protonMass || MP_MEV) / MP_MEV;
    var gRel = (mpRel > 0 && isFinite(mpRel)) ? st.alphaGRel / (mpRel * mpRel) : NaN;   // = gNewton
    var tAge = cos.events.tOneGyr != null ? cos.events.tOneGyr : tEnd;
    var aEval = aLo;                                                    // 窗口起点：气体最密的那一刻
    var tFF = (p.omegaB > 0)
      ? ((aEval != null && gRel > 0) ? (Math.PI / 2) * B.TH * Math.pow(aEval, 1.5) / Math.sqrt(gRel * p.omegaB) : null)
      : Infinity;
    var ratio = (tFF != null && tAge != null && tAge > 0) ? tFF / tAge : null;
    var noCollapse = ratio != null ? ratio > 1 : false;

    // --- 旁证（不参与阈值，只写进 valueText）：自引力天体的特征质量 vs 星系里的重子质量 ---
    // M₀ = α_G^{−3/2}m_p（Adams 2008 eq.1；引擎 calcStars 的 M_max=56M₀=100 M⊙·α_G^{−3/2}）
    var M0 = (isFinite(st.Mmax) && st.Mmax > 0) ? st.Mmax / 56 : null;
    var omegaM = p.omegaB + p.omegaC;
    var Mbar = omegaM > 0 ? (p.omegaB / omegaM) * M_GAL : null;         // 星系尺度（10¹² M⊙）里的重子质量

    var pass = !!(noCollapse && starsOff && chemOK && liquidOK);
    calc.ocean.pass = pass;
    calc.ocean.noCollapse = noCollapse; calc.ocean.chemistry = chemOK; calc.ocean.liquid = liquidOK;
    calc.ocean.collapseRatio = ratio; calc.ocean.tFFGyr = tFF; calc.ocean.tAgeGyr = tAge;
    calc.ocean.eScale = eScale; calc.ocean.TliqLoK = TliqLo; calc.ocean.TliqHiK = TliqHi;
    calc.ocean.aLo = aLo; calc.ocean.aHi = aHi; calc.ocean.zLo = zLo; calc.ocean.zHi = zHi;
    calc.ocean.tLiqStartGyr = tLiqStart; calc.ocean.tLiqEndGyr = tLiqEnd;
    calc.ocean.M0Msun = M0; calc.ocean.MbaryonMsun = Mbar; calc.ocean.gRel = gRel;
    calc.ocean.why = pass ? '' : (!starsOff ? 'stars' : !noCollapse ? 'collapse' : !chemOK ? 'chemistry' : 'liquid');
    // 连续余量：给沙盘的「推向冷液体宇宙」当梯度用（0..1，1 = 这一条已经成立）。结局判定不看它。
    calc.ocean.margin = {
      collapse: (ratio != null && isFinite(ratio) && ratio > 0) ? clamp01((Math.log10(ratio) + 4) / 4) : (ratio != null ? 1 : 0),
      stars: starsOff ? 1 : 0,
      chemistry: (at && at.atoms ? 0.5 : 0) + (at && at.molecules ? 0.5 : 0),
      liquid: liquidOK ? 1 : (afterRec ? 0.5 : (zRec != null && zHi != null && zHi > 0 ? clamp01(0.5 * zRec / zHi) : 0))
    };

    var windowText = liquidOK
      ? '液态温区 ' + trimNum(TliqLo, 3) + '–' + trimNum(TliqHi, 3) + ' K，背景温度在 '
        + formatTime(tLiqStart) + (tLiqEnd != null ? '–' + formatTime(tLiqEnd) : ' 之后')
        + '（z≈' + trimNum(zHi, 3) + '→' + (zLo != null ? trimNum(zLo, 3) : '?') + '）落在其中'
      : '液态窗口不成立';
    if (!starsOff) return;
    F.push(makeFinding({ id: 'R_OCEAN', title: '冷液体宇宙（弥散的液态物质）', basis: 'heuristic',
      formula: '四条同时成立：(1) 自由落体塌缩时标 t_ff=√(3π/(32Gρ_b))，取 ρ_b=Ω_b ρ_crit,0 a⁻³、ρ_crit,0=3H₀²/(8πG₀) ⇒ t_ff=(π/2)H₀⁻¹a^{3/2}(G/G₀·Ω_b)^{−1/2}，G/G₀=α_G/(m_p/m_p₀)²；在液态窗口起点的 a 上与宇宙年龄 t(a=1) 相比，比值>1 视为「不塌缩」；(2) 没有恒星点燃（R_STAR_IGNITE）；(3) 有原子且分子刚性（R_ATOMS / R_MOLECULES）；(4) 背景温度 T=T_CMB/a 落在分子液态温区 [273.15, 373.15] K×(α/α₀)²(mₑ/mₑ₀)（与 R_WATER 同一条键能标度 ∝ Ry ∝ α²mₑ），且该区间在复合之后、在宇宙寿命之内',
      inputs: { alphaGRel: st.alphaGRel, gOverG0: gRel, omegaB: p.omegaB, tcmb: tcmb, eScale: eScale,
        canIgnite: st.canIgnite, atoms: !!(at && at.atoms), molecules: !!(at && at.molecules), zRec: zRec },
      value: ratio,
      valueText: '塌缩时标/年龄=' + (ratio != null ? sci(ratio, 2) : '—')
        + '（t_ff=' + (tFF != null && isFinite(tFF) ? formatTime(tFF) : '∞') + '，年龄 ' + (tAge != null ? formatTime(tAge) : '—') + '）· '
        + windowText
        + ((M0 != null && Mbar != null) ? ' · 自引力特征质量 M₀=' + sci(M0, 2) + ' M⊙，星系重子 ' + sci(Mbar, 2) + ' M⊙' : ''),
      threshold: '四条全 ✓（塌缩时标/年龄 > 1、无恒星、有原子与分子、温度在液态窗口内）',
      verdict: pass ? 'ok' : 'warn',
      text: (pass
        ? '冷液体宇宙：引力太弱以致气体不塌缩、没有恒星，但分子在液态温区内——物质以液滴/液膜形态弥散（启发式；画面为示意，物理判定见本条）。'
        : '不是冷液体宇宙：' + (!noCollapse ? '气体在宇宙年龄内仍会塌缩（塌缩时标/年龄=' + (ratio != null ? sci(ratio, 2) : '—') + '）'
          : !chemOK ? (!(at && at.atoms) ? '没有稳定原子' : '分子没有刚性')
          : '背景温度没有一段落在分子的液态温区内（' + (afterRec ? '这一段不在宇宙寿命之内' : zRec == null ? '这个宇宙没有复合（Saha 在窗口内无解），气体始终是等离子体' : '液态窗口早于复合（z≈' + trimNum(zHi, 3) + ' > z_rec≈' + Math.round(zRec) + '），那时还是等离子体') + '）') + '。')
        + '三条近似写在这里：引擎的 Friedmann 层由 Ω 参数化，G 在 ρ_crit 里被约掉，膨胀史不随 α_G 变，本条只让 α_G 进入自引力一侧；塌缩时标取宇宙平均重子密度，不计暗物质晕内的增密；液态还需要足够的压强才能真正凝聚，本条不计算凝聚判据。结局判定不受本条影响。',
      ref: 'Jeans 1902, Phil. Trans. R. Soc. A 199, 1；Binney & Tremaine 2008《Galactic Dynamics》§5；Adams 2008, JCAP 08, 010（α_G^{−3/2}m_p 质量标度）；Carr & Rees 1979, Nature 278, 605；Barrow & Tipler 1986（键能与液态温区 ∝ α²mₑ）' }));
  }

  // ============================================================
  // H. 结局判定
  // ============================================================
  function decideOutcome(p, cos, calc, F) {
    var reasons = [], pick;
    function choose(id, why) { pick = OUTCOMES[id]; reasons.push(why); }
    var d = calc.dims, s = calc.structure, b = calc.bbn, at = calc.atoms, st = calc.stars, pl = calc.planets;
    var stellarEnd = s.gal ? s.gal.tGyr + 1e5 * Math.pow(p.alpha / ALPHA0, 2) : null;
    // 可居住性评分
    var hab = 1;
    hab *= d.orbitStability * d.gravityFactor;
    hab *= calc.baryons.hasBaryons ? 1 : 0;
    hab *= s.structureFormed ? 1 : 0;
    hab *= at.atoms ? 1 : 0; hab *= at.chemistry ? 1 : 0;
    hab *= st.canIgnite ? 1 : 0;
    hab *= st.heavyElements ? 1 : 0.2; hab *= st.supernovaOK ? 1 : 0.3;
    hab *= clamp01(st.tMSGyr / 2);
    hab *= isFinite(pl.windowGyr) ? clamp01(pl.windowGyr / 5) : 1;
    hab *= pl.qOK ? 1 : 0.4;
    hab *= s.betaPBH > 1e-8 || s.Qeff >= 1e-3 ? 0 : 1;
    var beyondModel = d.kind !== 'three';   // 任何 D≠3：3 维公式外推，不给可居住性
    if (!d.orbitsOK || !d.gravityOK) choose('UNSTABLE_ORBITS', 'D=' + trimNum(d.Draw, 4) + (d.emergent ? '（涌现）' : '') + (!d.orbitsOK ? '：D≥4 无稳定轨道/原子基态' : '：D≤2 无牛顿吸引'));
    else if (beyondModel) choose('BEYOND_MODEL_DIM', 'D=' + trimNum(d.Draw, 4) + (d.emergent ? '（涌现）' : '') + '≠3：核合成/恒星/化学/宜居公式只对 3 维成立，以下为 3 维公式外推，不构成观察者判断');
    else if (!calc.baryons.hasBaryons) choose('NO_ATOMS', '没有重子');
    else if (cos.fate.type === 'crunch' && (!s.gal || cos.fate.tGyr < stellarEnd)) choose('BIG_CRUNCH', '闭合几何转向坍缩');
    else if (s.betaPBH > 1e-8 || s.Qeff >= 1e-3) choose('BLACK_HOLE_DOMINATED', s.betaPBH > 1e-8 ? '原初黑洞比例 β=' + sci(s.betaPBH, 2) : 'Q_eff≥10⁻³ 团块在冷却前坍缩');
    else if (!s.structureFormed) choose('HEAT_DEATH_NO_STRUCTURE', s.weinbergOK ? '涨落在冻结前未能非线性化' : '超过 Weinberg 上界');
    else if (!at.atoms) choose('NO_ATOMS', b.hydrogenState === 'proton_decay' ? '质子衰变' : 'Zα→1 电子壳层不稳定');
    else if (!st.canIgnite) choose('NO_STARS', st.degenerate ? '恒星质量标度非有限（参数越出 Adams 2008 标度的适用范围）' : !b.deuteronBound ? '氘核不束缚' : '点火质量超过上限');
    else if (!at.chemistry) choose('NO_CHEMISTRY', !at.hydrogen ? '没有氢' : at.nElements < 6 ? '没有碳' : '分子无刚性');
    else if (calc.biochem && !calc.biochem.carbonWater) choose('NO_CARBON_CHEMISTRY', !calc.biochem.hoyleOK ? '三氦过程产不出足够的碳/氧（Hoyle 共振越出容许区间）' : !calc.biochem.waterOK ? '没有液态水窗口' : '复杂化学受限');
    else if (hab < 0.4) choose('STARS_NO_LIFE', '可居住性 ' + hab.toFixed(2) + ' < 0.4');
    else choose('OBSERVERS_POSSIBLE', '可居住性 ' + hab.toFixed(2));
    // D≠3：可居住性不给数（3 维公式外推无意义）；能否"进入镜像/星球"只在 D=3 且模型适用时为真
    var habOut = beyondModel ? null : clamp01(hab);
    return { outcome: pick, reasons: reasons, habitability: habOut, habitabilityRaw: clamp01(hab), stellarEndGyr: stellarEnd, beyondModel: beyondModel, canEnterMirror: !beyondModel };
  }

  // ============================================================
  // 时间线
  // ============================================================
  function buildTimeline(p, cos, calc, outcome) {
    var ev = cos.events, s = calc.structure, items = [], tEnd = cos.fate.tGyr;
    function item(id, name, tGyr, cond, note, noteIfNot) {
      var happens = !!cond && tGyr != null && (tEnd == null || tGyr <= tEnd);
      var note2 = happens ? note : (cond && tGyr != null && tEnd != null && tGyr > tEnd ? '宇宙已终结，不会发生' : (noteIfNot || note));
      items.push({ id: id, name: name, tGyr: tGyr, tLabel: happens ? formatTime(tGyr) : '—', happens: happens, note: note2 || '' });
    }
    var tRad = function (aq) { return aq * aq / (2 * Math.sqrt(cos.background.omegaR)) * cos.background.TH; };
    items.push({ id: 'singularity', name: '奇点', tGyr: 0, tLabel: '0', happens: true, note: '没有大小，没有结构，时间从这里开始' });
    item('inflation', '暴胀结束', 1e-32 / YR_S / 1e9, p.efolds > 0, '空间膨胀 e^' + p.efolds + ' 倍，量子涨落被拉成密度皱纹', '没有暴胀阶段');
    item('hadronization', '夸克禁闭为强子', tRad(1.4e-12), true, 'T≈2×10¹² K，质子与中子出现');
    var bbnOK = calc.baryons.hasBaryons && calc.bbn.deuteronBound && calc.bbn.hydrogenState !== 'proton_decay';
    item('bbn', '大爆炸核合成', tRad(2.7e-9), bbnOK, 'T≈10⁹ K，Y_p=' + calc.bbn.Yp.toFixed(3) + (calc.bbn.diprotonBound ? '（氢几乎耗尽）' : ''), !calc.baryons.hasBaryons ? '没有重子' : calc.bbn.hydrogenState === 'proton_decay' ? '质子衰变，只剩中子' : '氘核不束缚，核合成卡在氘瓶颈');
    item('equality', '物质-辐射相等', ev.tEqGyr, ev.aEq != null, 'z_eq≈' + (calc.expansion.zEq != null ? Math.round(calc.expansion.zEq) : '?') + '，引力开始放大密度涨落', '没有物质时代');
    var rec = calc.recombination;
    item('recombination', '复合 · 微波背景释放', rec.tRecGyr, calc.atoms.atoms && rec.zRec != null, 'z_rec≈' + (rec.zRec != null ? Math.round(rec.zRec) : '?') + '（去耦 z≈' + (rec.zDec != null ? Math.round(rec.zDec) : '?') + '），电子落入原子，宇宙变得透明', !calc.baryons.hasBaryons ? '没有重子' : '没有稳定原子，宇宙从未变得透明');
    item('dark_ages', '黑暗时代', rec.tRecGyr, calc.atoms.atoms && rec.zRec != null && (!s.first || s.first.tGyr > rec.tRecGyr), '没有任何光源，只有冷却的背景辐射', '没有黑暗时代');
    var starsOK = s.first && calc.stars.canIgnite && outcome.id !== 'BLACK_HOLE_DOMINATED' && outcome.id !== 'UNSTABLE_ORBITS';
    item('first_stars', '第一代恒星', s.first ? s.first.tGyr : null, starsOK, '3σ 峰（10⁸ M⊙）坍缩，z≈' + (s.first ? s.first.z.toFixed(1) : '?') + '，核聚变点燃', !s.first ? '结构从未形成' : outcome.id === 'BLACK_HOLE_DOMINATED' ? '团块直接坍缩为黑洞' : '恒星无法点燃');
    item('galaxies', '星系形成', s.gal ? s.gal.tGyr : null, !!s.gal, '2σ 的 10¹² M⊙ 涨落非线性化，z≈' + (s.gal ? s.gal.z.toFixed(1) : '?'), '涨落被冻结在线性阶段');
    item('reference', '参照点 a=1（我们的今天）', ev.tOneGyr, ev.tOneGyr != null, '尺度因子与我们的宇宙今天相同', '从未膨胀到这一尺度');
    var stellarEnd = s.gal ? s.gal.tGyr + 1e5 * Math.pow(p.alpha / ALPHA0, 2) : null;
    item('stellar_end', '恒星纪元结束', stellarEnd, starsOK && stellarEnd != null, '最小质量的恒星也烧尽（t ∝ α²·M^{−2.5}），只剩白矮星、中子星与黑洞', '没有恒星纪元');
    var endItem;
    if (cos.fate.type === 'crunch') endItem = { id: 'end', name: '大挤压', tGyr: tEnd, tLabel: formatTime(tEnd), happens: true, note: '转向于 ' + formatTime(ev.tTurnGyr) + '（a_max=' + (ev.aMax != null ? ev.aMax.toFixed(2) : '?') + '），随后坍缩回奇点' };
    else if (outcome.id === 'BLACK_HOLE_DOMINATED') endItem = { id: 'end', name: '黑洞蒸发', tGyr: 1e91, tLabel: '10¹⁰⁰ 年', happens: true, note: '霍金辐射带走最后一点信息' };
    else endItem = { id: 'end', name: '热寂', tGyr: 1e91, tLabel: '10¹⁰⁰ 年', happens: true, note: '永恒膨胀，温度趋于德西特温度' };
    items.push(endItem);
    return items;
  }

  // ---------- 有量纲常数（单位约定下的表述） ----------
  /** 数值展示：c 在等于我们的值时给整数（299792458），其余用 5 位科学计数 */
  function siText(key, v) { return (key === 'c' && Math.abs(v - SI0.c) < 0.5) ? '299792458' : sci(v, 5); }
  /**
   * dimensionfulSI(alphaRel, alphaGRel, conv) → { convention, definition, ref, ratios:{c,hbar,e,G}, si:{c,hbar,e,G,mp}, fixed:[…] }
   * alphaRel = α/α₀，alphaGRel = α_G/α_G₀（m_p 在所有约定下固定为我们的数值，α_G 的变化因此落到 G 上）。
   * A：c/c₀ = α₀/α；B：ħ/ħ₀ = α₀/α；C：e/e₀ = √(α/α₀)。三者 G/G₀ = (α_G/α_G₀)·(ħ/ħ₀)(c/c₀)。
   */
  function dimensionfulSI(alphaRel, alphaGRel, conv) {
    var id = UNIT_CONVENTIONS[conv] ? conv : 'A', U = UNIT_CONVENTIONS[id];
    alphaRel = isFinite(alphaRel) && alphaRel > 0 ? alphaRel : 1;
    alphaGRel = isFinite(alphaGRel) && alphaGRel > 0 ? alphaGRel : 1;
    var rc = 1, rh = 1, re = 1;
    if (id === 'A') rc = 1 / alphaRel;
    else if (id === 'B') rh = 1 / alphaRel;
    else re = Math.sqrt(alphaRel);
    var rG = alphaGRel * rh * rc;
    return { convention: id, name: U.name, definition: U.definition, ref: U.ref, fixed: U.fixed, varies: U.varies,
      ratios: { c: rc, hbar: rh, e: re, G: rG, mp: 1 },
      si: { c: SI0.c * rc, hbar: SI0.hbar * rh, e: SI0.e * re, G: SI0.G * rG, mp: SI0.mp } };
  }
  var SI_META = {
    cSI: { si: 'c', name: '光速', symbol: 'c', unit: 'm/s', word: '光速' },
    GSI: { si: 'G', name: '引力常数', symbol: 'G', unit: 'm³·kg⁻¹·s⁻²', word: '引力常数' },
    hbarSI: { si: 'hbar', name: '约化普朗克常数', symbol: 'ħ', unit: 'J·s', word: '普朗克常数' },
    eSI: { si: 'e', name: '基本电荷', symbol: 'e', unit: 'C', word: '基本电荷' }
  };
  /** 生成 derived 用的四条有量纲常数条目 */
  function dimensionfulEntries(alphaRel, alphaGRel, conv) {
    var d = dimensionfulSI(alphaRel, alphaGRel, conv), out = {};
    var fixedWord = { A: '固定 e、ħ、m_p 为我们的数值', B: '固定 c、e、m_p 为我们的数值', C: '固定 c、ħ、m_p 为我们的数值' }[d.convention];
    Object.keys(SI_META).forEach(function (key) {
      var m = SI_META[key], v = d.si[m.si], r = d.ratios[m.si];
      var isFixedHere = d.fixed.indexOf(m.si === 'hbar' ? 'hbar' : m.si) >= 0;
      var formula = m.si === 'G' ? 'G = α_G·ħc/m_p²（m_p 取我们的数值）'
        : isFixedHere ? m.symbol + ' 在本约定下固定为我们的数值'
        : (d.convention === 'A' ? 'c = e²/(4πε₀ħα)' : d.convention === 'B' ? 'ħ = e²/(4πε₀cα)' : 'e = √(4πε₀ħcα)');
      var text = '在约定 ' + d.convention + '（' + fixedWord + '）下，' +
        (isFixedHere ? m.word + '固定为我们的数值 ' + siText(m.si, v) + ' ' + m.unit + '。'
                     : '这个宇宙的' + m.word + '为 ' + siText(m.si, v) + ' ' + m.unit + '（我们的 ' + trimNum(r, 3) + ' 倍）。');
      out[key] = { key: key, value: v, unit: m.unit, name: m.name + '（' + d.convention + ' 约定）', symbol: m.symbol,
        basis: 'computed', status: 'accepted (convention-dependent)', convention: d.convention, fixedInConvention: isFixedHere,
        ratio: r, formula: formula, inputs: ['alpha', 'alphaSMZ'], ref: d.ref, text: text };
    });
    out._meta = d;
    return out;
  }
  /**
   * Engine.dimensionfulConstants(resultOrConstants, conv) → { convention, name, definition, ref, fixed, varies, ratios, si, entries, sentence }
   * 接受 simulate 结果、deriveConstants().c 或 {alpha, alphaG}；conv ∈ 'A'|'B'|'C'（默认 A）。
   */
  function dimensionfulConstants(src, conv) {
    var c = src && src.constants ? src.constants : (src || {});
    var alphaRel = (isFinite(c.alpha) && c.alpha > 0 ? c.alpha : ALPHA0) / ALPHA0;
    var alphaGRel = isFinite(c.alphaG) && c.alphaG > 0 ? c.alphaG : 1;
    var entries = dimensionfulEntries(alphaRel, alphaGRel, conv), meta = entries._meta;
    delete entries._meta;
    return { convention: meta.convention, name: meta.name, definition: meta.definition, ref: meta.ref,
      fixed: meta.fixed, varies: meta.varies, ratios: meta.ratios, si: meta.si, entries: entries,
      sentence: dimensionfulSentence(meta) };
  }
  /** "光速 X m/s，引力常数 Y m³kg⁻¹s⁻²，普朗克常数 Z J·s（单位约定 A）" */
  function dimensionfulSentence(meta) {
    return '光速 ' + siText('c', meta.si.c) + ' m/s，引力常数 ' + siText('G', meta.si.G) + ' m³·kg⁻¹·s⁻²，普朗克常数 ' +
      siText('hbar', meta.si.hbar) + ' J·s（单位约定 ' + meta.convention + '）';
  }

  // ============================================================
  // 报告文本（冷静、克制；数字来自计算，不引用小说）
  // ============================================================
  function constantsReport(c, conv) {
    var items = [
      { key: 'alpha', name: '精细结构常数', text: '精细结构常数是' + cnInt(1 / c.alpha) + '分之一' },
      { key: 'meOverMp', name: '电子/质子质量比', text: '电子与质子的质量比是' + cnInt(1836.15 / c.meOverMp) + '分之一' },
      { key: 'protonMass', name: '质子质量', text: '质子质量 ' + trimNum(c.protonMass, 4) + ' MeV（Λ_QCD=' + trimNum(c.lambdaQCD, 3) + ' MeV）' },
      { key: 'mUp', name: '轻夸克质量', text: '上夸克 ' + trimNum(c.mUp, 3) + ' MeV、下夸克 ' + trimNum(c.mDown, 3) + ' MeV' },
      { key: 'generations', name: '粒子代数', text: '费米子有' + cnInt(c.generations) + '代' },
      { key: 'omegaB', name: '密度', text: 'H₀=' + trimNum(c.H0, 3) + '，Ω_b=' + c.omegaB.toFixed(3) + '，Ω_c=' + c.omegaC.toFixed(3) + '，Ω_Λ=' + trimNum(c.omegaLambda, 3) },
      { key: 'Q', name: '原初涨落', text: 'A_s=' + sci(c.As, 2) + '（Q≈' + sci(c.Q, 2) + '），n_s=' + c.ns.toFixed(3) },
      { key: 'dimS', name: '空间维数', text: '空间维数是' + cnNumber(c.dimS) }
    ];
    var dim = dimensionfulSI((isFinite(c.alpha) && c.alpha > 0 ? c.alpha : ALPHA0) / ALPHA0, isFinite(c.alphaG) && c.alphaG > 0 ? c.alphaG : 1, conv);
    items.push({ key: 'dimensionful', name: '有量纲常数（单位约定）', text: dimensionfulSentence(dim) });
    return { items: items, sentence: items.map(function (i) { return i.text; }).join('；') + '。', convention: dim.convention };
  }

  function describe(p, cos, calc, outcome, hab) {
    var s = [], st = calc.structure, b = calc.bbn, ev = cos.events;
    var tFirst = st.first ? st.first.tGyr : null, tGal = st.gal ? st.gal.tGyr : null, tEnd = cos.fate.tGyr;
    switch (outcome.id) {
      case 'UNSTABLE_ORBITS': {
        var Dv = calc.dims.Draw, em = calc.dims.emergent;
        s.push(em ? '弦气冷却后解开了' + cnNumber(Dv) + '维（ε=' + em.epsilons.slice(0, 5).map(function (e) { return trimNum(e, 2); }).join('/') + '…），空间维数是' + cnNumber(Dv) + '。' : '空间维数是' + cnNumber(Dv) + '。');
        s.push(Dv >= 4 ? '力按 r^{−' + trimNum(Dv - 1, 3) + '} 衰减，D≥4 时圆轨道对径向微扰不稳定（Ehrenfest 1917），氢原子的哈密顿量没有下界：任何靠得近的两个东西要么坠向彼此，要么永远分开。' : Dv < 1 ? '几乎没有空间维展开。' : 'D≤2 时引力势为对数或排斥，没有牛顿吸引，物质无法聚集（Tegmark 1997）。');
        if (calc.dims.fractional) s.push('非整数维按连续插值处理。');
        s.push('没有行星系统，也没有化学，物质在坍缩与飞散之间摇摆。');
        s.push('演化链在这一步终止：后面的复合、核合成、结构、恒星都以 3+1 维公式为前提。');
        break;
      }
      case 'BEYOND_MODEL_DIM': {
        var Db = calc.dims.Draw;
        s.push('本引擎的核合成/恒星/化学/宜居公式只对 3 维空间成立；下列数值是把 3 维公式外推到 D=' + Db.toFixed(2) + ' 的结果，仅供参考，不构成"可能诞生观察者"的判断。');
        s.push(Db > 3 ? '力 ∝ r^{−' + trimNum(Db - 1, 3) + '}：圆轨道对径向微扰稳定（D<4）但不闭合（进动），氢原子有基态而能级与化学显著改变（Ehrenfest 1917；Tegmark 1997）。' : '力 ∝ r^{−' + trimNum(Db - 1, 3) + '}：有牛顿吸引但引力聚集更弱，拓扑上复杂网络受限（Tegmark 1997）。');
        if (calc.dims.fractional) s.push('非整数维没有严格的物理定义，判据按连续插值。');
        s.push('外推数值：复合 z≈' + (calc.recombination.zRec != null ? Math.round(calc.recombination.zRec) : '—') + '，' + (st.gal ? '星系尺度坍缩 z≈' + st.gal.z.toFixed(1) + '，' : '星系尺度未坍缩，') + '氦丰度 ' + b.Yp.toFixed(3) + '，太阳质量恒星寿命 ' + formatTime(calc.stars.tMSGyr) + '——均未做 D≠3 修正。');
        s.push('可居住性不给数；镜像与星球观测在此关闭。');
        break;
      }
      case 'BIG_CRUNCH':
        s.push('膨胀在 ' + formatTime(ev.tTurnGyr) + ' 后停止（a_max=' + (ev.aMax != null ? ev.aMax.toFixed(2) : '?') + '），引力赢了。');
        s.push('宇宙用 ' + formatTime(tEnd) + ' 走完从奇点到奇点的一个来回。');
        if (tGal != null && tEnd - tGal > 3) s.push('途中曾形成星系（z≈' + st.gal.z.toFixed(1) + '，' + formatTime(tGal) + '）' + (hab >= 0.4 ? '，甚至可能有过观察者，眼看着天空由红移转为蓝移' : '') + '，随后一同被压碎。');
        else s.push('结构还来不及形成就被压碎。');
        s.push('最后一刻，所有的光被压回一个点。');
        break;
      case 'HEAT_DEATH_NO_STRUCTURE':
        s.push(!st.weinbergOK ? '真空能 Ω_Λ≈' + sci(cos.background.omegaLambda, 2) + '，是 Weinberg 上界的 ' + sci(st.weinbergRatio != null ? st.weinbergRatio : (st.weinbergMax > 0 ? cos.background.omegaLambda / st.weinbergMax : Infinity), 2) + ' 倍：Λ 在星系坍缩前就主导了膨胀。' : '星系尺度的线性涨落最大只长到 ' + sci(st.deltaMax, 2) + '（临界 1.686），在增长冻结之前没有非线性化。');
        s.push('气体始终均匀地稀释，没有星系、没有恒星，也没有观察者。');
        s.push('温度随尺度因子单调下降，直到与德西特温度相当。');
        s.push('这个宇宙没有被谁看见过。');
        break;
      case 'BLACK_HOLE_DOMINATED':
        s.push(st.betaPBH > 1e-8 ? '视界尺度的涨落 σ_hor=' + sci(st.sigmaHor, 2) + '，按 Carr 阈值有 β=' + sci(st.betaPBH, 2) + ' 的质量在辐射时代就坍缩成原初黑洞。' : 'Q_eff=' + sci(st.Qeff, 2) + '：坍缩团块的位力速度约 ' + sci(Math.sqrt(st.Qeff) * 3e5, 2) + ' km/s，气体来不及冷却成恒星就落进视界（Tegmark & Rees 1998）。');
        s.push('星光从未点燃。');
        s.push('这是一个由视界与霍金辐射组成的宇宙，要到 10¹⁰⁰ 年之后才在蒸发中归于寂静。');
        break;
      case 'NO_ATOMS':
        s.push(!calc.baryons.hasBaryons ? (calc.baryons.cpViolation ? 'Ω_b=0：没有重子物质。' : '没有 CP 破坏，Sakharov 条件不满足：物质与反物质完全湮灭，只剩光子与暗物质。')
          : b.hydrogenState === 'proton_decay' ? 'm_n−m_p=' + trimNum(b.deltaMeV, 3) + ' MeV < −mₑ：质子衰变为中子，宇宙里没有氢，也没有任何原子——只有中子与中子星。'
          : 'α=' + trimNum(p.alpha, 3) + '：Zα 逼近 1，多电子原子的内层轨道坠入负能海，没有稳定的原子壳层。');
        s.push('物质停留在基本粒子或裸核层次，从未组装出原子。');
        s.push('它膨胀、冷却' + (st.structureFormed ? '，暗物质照常聚成团块，但团块里什么也不发光' : '') + '，然后什么也不发生。');
        break;
      case 'NO_STARS':
        s.push('引力照常工作，星系在 ' + formatTime(tGal) + '（z≈' + st.gal.z.toFixed(1) + '）形成，但' + (calc.stars.degenerate ? '恒星质量标度 M₀=α_G^{−3/2}m_p 在这组参数下非有限（Adams 2008 的标度关系不再适用），引擎不做外推' : !b.deuteronBound ? (b.Bd <= 0 ? '氘核结合能 ' + trimNum(b.Bd, 3) + ' MeV ≤ 0' : '中子太重（m_n−m_p=' + trimNum(b.deltaMeV, 3) + ' MeV），氘核内的中子也会衰变') + '，pp 链第一步走不通' : '点火质量 ' + trimNum(calc.stars.Mmin, 3) + ' M⊙ 超过辐射压上限') + '。');
        s.push('气体云只能缓慢冷却、坍缩成致密天体，从不发光。');
        s.push('这是一个黑暗的宇宙。');
        break;
      case 'NO_CHEMISTRY':
        s.push('恒星点燃了（第一代恒星 ' + formatTime(tFirst) + '），宇宙有光。');
        s.push('但' + (!calc.atoms.hydrogen ? (b.diprotonBound ? '双质子束缚，氢在大爆炸核合成里就烧光了（Y_p=' + b.Yp.toFixed(2) + '），剩下惰性的氦' : '氢原子被电子俘获吃掉了') : calc.atoms.nElements < 6 ? '原子核最多到 Z=' + calc.atoms.nElements + '，没有碳' : '电子与原子核质量可比，分子没有固定形状') + '，没有可以复杂化的化学。');
        s.push('恒星寿命约 ' + formatTime(calc.stars.tMSGyr) + '，然后是黑暗。');
        break;
      case 'STARS_NO_LIFE': {
        s.push('结构、恒星、化学都存在：第一代恒星 ' + formatTime(tFirst) + '，星系 ' + formatTime(tGal) + '。');
        var why = [];
        if (calc.stars.tMSGyr < 2) why.push('恒星寿命只有 ' + formatTime(calc.stars.tMSGyr));
        if (!calc.stars.heavyElements) why.push('造不出铁以上的元素');
        if (!calc.stars.supernovaOK) why.push('超新星哑火，重元素锁在恒星里');
        if (!calc.planets.qOK) why.push('Q 越出 Tegmark–Rees 窗口（星系过密/过稀）');
        if (calc.dims.orbitStability < 1) why.push('轨道不稳定');
        if (isFinite(calc.planets.windowGyr) && calc.planets.windowGyr < 5) why.push('距终结只有 ' + formatTime(calc.planets.windowGyr));
        s.push('但' + (why.length ? why.join('、') : '条件勉强') + '，复杂化学没有足够的时间或舞台（可居住性 ' + hab.toFixed(2) + '）。');
        s.push('有行星，也许有海洋，也许有一些分子在拼凑，但没有人抬头看星空。');
        break;
      }
      case 'NO_CARBON_CHEMISTRY': {
        var bc = calc.biochem;
        s.push('结构、恒星与化学都存在：第一代恒星 ' + formatTime(tFirst) + '，星系 ' + formatTime(tGal) + '，可用元素 ' + (bc.elements.length ? bc.elements.join(' ') : '无') + '。');
        s.push(!bc.hoyleOK ? '但 Hoyle 共振越出容许区间（ξ=' + trimNum(bc.xi, 2) + '）：三氦过程的碳产率 ×' + sci(bc.fC, 2) + '、氧产率 ×' + sci(bc.fO, 2) + '（Oberhummer et al. 2000：核力 ±0.5% 或电磁 ±4% 即骤降），碳-水型生化缺少原料。' : !bc.waterOK ? '但没有液态水窗口，碳-水型生化缺少溶剂。' : '但复杂化学受限（Z_max=' + calc.atoms.nElements + '），碳-水型生化难以搭建。');
        s.push('恒星寿命 ' + formatTime(calc.stars.tMSGyr) + '，行星在 ' + trimNum(calc.planets.dHZ_AU, 3) + ' AU 附近凝结，但没有碳-水型的生命化学。');
        if (bc.altTendency) s.push('替代生化模块（推测）：硅基/非水溶剂倾向 ' + bc.altTendency + '，无公认判据。');
        break;
      }
      case 'OBSERVERS_POSSIBLE':
      default:
        s.push('结构、恒星、化学与时间尺度都满足条件。');
        s.push('复合于 z≈' + (calc.recombination.zRec != null ? Math.round(calc.recombination.zRec) : '—') + '（去耦 z≈' + (calc.recombination.zDec != null ? Math.round(calc.recombination.zDec) : '—') + '），第一代恒星在 ' + formatTime(tFirst) + ' 点燃，星系形成于 ' + formatTime(tGal) + '，太阳质量恒星可以燃烧 ' + formatTime(calc.stars.tMSGyr) + '；原初氦丰度 ' + b.Yp.toFixed(3) + '，重元素被锻造并散布出去，行星凝结，化学在足够长的时间里展开。');
        s.push('生物化学基础：碳与氧由三氦过程产出（Hoyle 共振在容许区间内，ξ=' + trimNum(calc.biochem.xi, 2) + '），液态水窗口存在（d≈' + trimNum(calc.biochem.dWater, 3) + ' AU），复杂化学可行（' + calc.biochem.elements.join(' ') + '）→ 碳-水型生化可能。');
        if (calc.stars.outOfAdamsScope) s.push('注意：恒星质量标度 M_min=' + trimNum(calc.stars.Mmin, 3) + ' M⊙ 已超出 Adams 2008 牛顿标度的合理适用范围（≳300 M⊙）；可居住性判断建立在此外推之上，结论仅供参考——真实物理下这类致密天体更可能直接坍缩为黑洞。');
        s.push(constantsReport(p).sentence.replace(/。$/, '') + '。');
        if (calc.isOurs) s.push('这是我们的宇宙。');
        else s.push('它与我们的略有不同，但已经具备诞生观察者的全部前提。');
        break;
    }
    return s.join('');
  }

  // ============================================================
  // 第 1 层：deriveConstants —— 公认的派生 + 已开启模块的派生
  // ============================================================
  /**
   * Engine.deriveConstants(params, modules) → { c, derived, derivedOrder, modules, params }
   * c：演化层输入（alpha, alphaS(核力强度 rel), higgsVev(rel), electronMassMeV, meOverMp(rel), mUp, mDown, sumNu, ckmPhase,
   *    generations, H0, h, tcmb, omegaR, eta10, omegaB, omegaC, omegaLambda, As, Q, ns, omegaK, dimS, dims, alphaG(rel),
   *    lambdaQCD, protonMass, mnMinusMp, GF, lambdaH, efolds, thetaQCD, higgsMass）
   * derived[key] = {key, value, name, symbol, unit, basis, status, formula, inputs:[…], ref, text}
   */
  function deriveConstants(params, modules, opts) {
    var ms = Params.normalizeModules(modules);
    var p = Params.normalize(params, ms);
    var derived = {}, order = [];
    function D(key, o) { o.key = key; derived[key] = o; order.push(key); return o.value; }

    // ---- 直接输入（accepted） ----
    var alpha = p.alpha, alphaSMZ = p.alphaSMZ, me = p.electronMass, mu = p.mUp, md = p.mDown, omL = p.omegaLambda, As = p.As, ns = p.ns, omK = p.omegaK, dimS = p.dimS, dims = null, efolds = 60;

    // ---- 弦论景观模块（speculative） ----
    if (ms.landscape) {
      alpha = p.stringCoupling / p.compactVolume;
      D('alpha', { value: alpha, name: '精细结构常数', symbol: 'α', unit: '', basis: 'toy', status: 'speculative', formula: 'α = g_s/V（4 维规范耦合 1/g₄² ∝ V/g_s；引文只支持这一定性机制，刻度 α⁻¹=V/g_s 为本引擎玩具延伸）', inputs: ['stringCoupling', 'compactVolume'], ref: 'Polchinski 1998（机制）', text: '1/' + (1 / alpha).toFixed(1) });
      alphaSMZ = ALPHAS_MZ0 * (alpha / ALPHA0);
      D('alphaSMZ', { value: alphaSMZ, name: '强耦合 αₛ(M_Z)', symbol: 'αₛ(M_Z)', unit: '', basis: 'toy', status: 'speculative', formula: 'αₛ(M_Z) = 0.1179·(α/α₀)（同一模量因子）', inputs: ['stringCoupling', 'compactVolume'], ref: 'Polchinski 1998', text: trimNum(alphaSMZ, 4) });
      me = ME0_MEV * Math.exp(7.8 * (p.shape1 - 0.5)); mu = 2.16 * Math.exp(6 * (p.shape2 - 0.5)); md = 4.67 * Math.exp(6 * (p.shape3 - 0.5));
      D('electronMass', { value: me, name: '电子质量', symbol: 'mₑ', unit: 'MeV', basis: 'toy', status: 'speculative', formula: 'mₑ = 0.511 MeV·e^{7.8(φ₁−0.5)}（汤川由紧致几何决定为定性背景；指数形式为本引擎玩具延伸）', inputs: ['shape1'], ref: 'Candelas et al. 1985（背景）', text: trimNum(me, 4) + ' MeV' });
      D('mUp', { value: mu, name: '上夸克质量', symbol: 'm_u', unit: 'MeV', basis: 'toy', status: 'speculative', formula: 'm_u = 2.16 MeV·e^{6(φ₂−0.5)}（玩具延伸）', inputs: ['shape2'], ref: 'Candelas et al. 1985（背景）', text: trimNum(mu, 3) + ' MeV' });
      D('mDown', { value: md, name: '下夸克质量', symbol: 'm_d', unit: 'MeV', basis: 'toy', status: 'speculative', formula: 'm_d = 4.67 MeV·e^{6(φ₃−0.5)}（玩具延伸）', inputs: ['shape3'], ref: 'Candelas et al. 1985（背景）', text: trimNum(md, 3) + ' MeV' });
      var qscale = 1e-121 * p.stringCoupling * p.stringCoupling * 137.036 / p.compactVolume;
      var LambdaPl = -Math.pow(10, p.bareLambda) + 0.5 * (p.flux1 * p.flux1 * 1 + p.flux2 * p.flux2 * 2 + p.flux3 * p.flux3 * 3) * qscale;
      omL = 0.685 * LambdaPl / 1e-123;
      D('omegaLambda', { value: omL, name: '暗能量密度', symbol: 'Ω_Λ', unit: 'ρ_crit', basis: 'toy', status: 'speculative', formula: 'Λ = Λ₀ + ½Σnᵢ²qᵢ²，qᵢ² = 10⁻¹²¹(1,2,3)·g_s²·137/V；Ω_Λ = 0.685·Λ/10⁻¹²³（Bousso–Polchinski 机制，玩具刻度）', inputs: ['bareLambda', 'flux1', 'flux2', 'flux3', 'stringCoupling', 'compactVolume'], ref: 'Bousso & Polchinski 2000', text: 'Λ=' + sci(LambdaPl, 3) + ' M_Pl⁴，Ω_Λ=' + trimNum(omL, 3) });
    }
    // ---- 慢滚暴胀模块（mainstream-model） ----
    if (ms.slowRoll) {
      var eps = p.slowRollEpsilon, eta = p.slowRollEta, V14 = p.inflatonScale;
      As = Math.pow(V14, 4) / (24 * Math.PI * Math.PI * eps);
      ns = 1 - 6 * eps + 2 * eta;
      efolds = p.efolds;
      omK = clamp(p.initialCurvature * Math.exp(-2 * (p.efolds - 60)), -1, 1);
      D('As', { value: As, name: '原初标量功率谱幅度', symbol: 'A_s', unit: '', basis: 'computed', status: 'mainstream-model', formula: 'A_s = V₀/(24π²ε M_Pl⁴)（约化 M_Pl）', inputs: ['inflatonScale', 'slowRollEpsilon'], ref: 'Liddle & Lyth 2000', text: sci(As, 3) });
      D('ns', { value: ns, name: '谱指数', symbol: 'n_s', unit: '', basis: 'computed', status: 'mainstream-model', formula: 'n_s = 1 − 6ε + 2η；r = 16ε = ' + trimNum(16 * eps, 3), inputs: ['slowRollEpsilon', 'slowRollEta'], ref: 'Liddle & Lyth 2000', text: ns.toFixed(4) });
      D('omegaK', { value: omK, name: '曲率', symbol: 'Ω_k', unit: '', basis: 'computed', status: 'mainstream-model', formula: 'Ω_k = k₀·e^{−2(N−60)}（夹到 ±1）', inputs: ['initialCurvature', 'efolds'], ref: 'Guth 1981', text: trimNum(omK, 3) });
    }
    // ---- 弦气维数模块（speculative） ----
    if (ms.stringGas) {
      var em = emergentDimensions(p);
      dims = em; dims.inputs = { stringGasT: p.stringGasT, windingDensity: p.windingDensity, compactStiffness: p.compactStiffness };
      dimS = em.D;
      D('dimS', { value: dimS, name: '空间维数（涌现）', symbol: 'D', unit: '维', basis: 'toy', status: 'speculative', formula: 'D = Σ s_i，ε_i = g_i·e^{6(T₀/T_H−0.98)}/n_w，s_i = smoothstep((ε_i−1+w)/2w)，w=0.4(1−κ)（饱和为 0/1，带内分数）——引文只支持"三维一般性解开"的定性机制，定量形式为本引擎玩具延伸', inputs: ['stringGasT', 'windingDensity', 'compactStiffness'], ref: 'Brandenberger & Vafa 1989, Nucl. Phys. B316, 391；Tseytlin & Vafa 1992', text: cnNumber(dimS) + '维' + (em.fractional ? '（分数维）' : ''), epsilons: em.epsilons, s: em.open, open: em.open, w: em.w, nOpen: em.nOpen, nPartial: em.nPartial, fractional: em.fractional });
    } else {
      D('dimS', { value: dimS, name: '空间维数', symbol: 'D', unit: '维', basis: 'computed', status: 'accepted-fact, no-mechanism', formula: '直接输入', inputs: ['dimS'], ref: 'Tegmark 1997', text: cnNumber(dimS) + '维' });
    }

    // ---- 公认的派生（computed） ----
    var h = p.H0 / 100;
    var neff = (p.generations < 3 ? NEFF0 * p.generations / 3 : NEFF0 + (p.generations - 3));
    var omegaGamma = 2.47e-5 * Math.pow(p.tcmb / 2.7255, 4) / (h * h);
    var omegaR = omegaGamma * (1 + 0.2271 * neff);
    var omegaB = p.omegaBh2 / (h * h), omegaC = p.omegaCh2 / (h * h);
    var eta10 = 273.9 * p.omegaBh2 * Math.pow(2.7255 / p.tcmb, 3);   // η = n_b/n_γ ∝ Ω_b h²/T_CMB³
    var lambdaQCD = MZ_GEV * 1e3 * Math.exp(-2 * Math.PI / (B0_NF5 * alphaSMZ));      // MeV
    var lambdaQCD0 = MZ_GEV * 1e3 * Math.exp(-2 * Math.PI / (B0_NF5 * ALPHAS_MZ0));
    // 下溢/发散保护（#7）：αₛ(M_Z)→0（景观模块可达 ~10⁻⁴）时 Λ_QCD 会下溢为 0 → α_G=0 → 0^{−1.5}=∞ → Mmin=NaN 级联。
    // 这里把 Λ_QCD、m_p 夹在相对我们 10^±12 的范围内：默认参数为恒等操作，只在越出模型适用范围时兜底。
    if (!isFinite(lambdaQCD) || lambdaQCD <= 0) lambdaQCD = lambdaQCD0 * 1e-12;
    lambdaQCD = clamp(lambdaQCD, lambdaQCD0 * 1e-12, lambdaQCD0 * 1e12);
    var protonMass = MP_MEV * lambdaQCD / lambdaQCD0;                                    // m_p ∝ Λ_QCD（格点：手征极限 m_p≈常数×Λ）
    /* α_G = (m_p/M_Pl)² × gNewton。
       gNewton 是后加的引力自由度（params.js 有完整说明）：不传时为 1，
       此时这一行与旧版逐位相同，老的标定和已有结果不受影响。 */
    var gRel = (p.gNewton != null && isFinite(p.gNewton) && p.gNewton > 0) ? p.gNewton : 1;
    var alphaG = Math.pow(protonMass / MP_MEV, 2) * gRel;                                // α_G = (m_p/M_Pl)² 相对值（≥10⁻²⁴）
    var meOverMp = (me / ME0_MEV) / (protonMass / MP_MEV);
    if (!isFinite(meOverMp) || meOverMp <= 0) meOverMp = 1e-12;
    var mnMinusMp = DELTA0_MEV + 2.52 * ((md - mu) / 2.51 - 1) - 1.00 * (alpha / ALPHA0 - 1);   // BMW 2015：QCD 项 2.52、QED 项 −1.00 MeV，线性化于观测值 1.293
    var mpi2 = ((mu + md) / 6.83) * (lambdaQCD / lambdaQCD0);                             // m_π² ∝ (m_u+m_d)Λ_QCD（GMOR）
    // #6：m_u=m_d=0（或 Λ_QCD 下溢）时 log(0)=−∞ → αₛ,nuc=∞ 会污染整条 BBN 链，取下限并夹到有限区间
    var alphaSnuc = clamp(1 - 0.5 * Math.log(Math.max(mpi2, 1e-12)), 0.02, 20);           // 核力强度：π 越重射程越短
    var vRel = p.higgsVev / 246.22;
    var GF = 1 / (Math.SQRT2 * p.higgsVev * p.higgsVev);
    var lambdaH = p.higgsMass * p.higgsMass / (2 * p.higgsVev * p.higgsVev);
    var Q = 0.4 * Math.sqrt(As);
    D('omegaR', { value: omegaR, name: '辐射密度', symbol: 'Ω_r', unit: 'ρ_crit', basis: 'computed', status: 'accepted', formula: 'Ω_γh² = 2.47×10⁻⁵(T_CMB/2.7255)⁴；Ω_r = Ω_γ(1+0.2271N_eff)，N_eff=3.046+(N_gen−3)', inputs: ['tcmb', 'H0', 'generations'], ref: 'Fixsen 2009；Planck 2018', text: sci(omegaR, 3) });
    D('omegaB', { value: omegaB, name: '重子密度', symbol: 'Ω_b', unit: 'ρ_crit', basis: 'computed', status: 'accepted', formula: 'Ω_b = Ω_bh²/h²', inputs: ['omegaBh2', 'H0'], ref: 'Planck 2018', text: omegaB.toFixed(4) });
    D('omegaC', { value: omegaC, name: '暗物质密度', symbol: 'Ω_c', unit: 'ρ_crit', basis: 'computed', status: 'accepted', formula: 'Ω_c = Ω_ch²/h²', inputs: ['omegaCh2', 'H0'], ref: 'Planck 2018', text: omegaC.toFixed(4) });
    D('eta10', { value: eta10, name: '重子/光子比', symbol: 'η₁₀', unit: '10⁻¹⁰', basis: 'computed', status: 'accepted', formula: 'η = n_b/n_γ = 273.9×10⁻¹⁰·Ω_bh²·(2.7255 K/T_CMB)³', inputs: ['omegaBh2', 'tcmb'], ref: 'Steigman 2007', text: eta10.toFixed(2) });
    D('lambdaQCD', { value: lambdaQCD, name: 'QCD 标度（一环 n_f=5 口径）', symbol: 'Λ_QCD', unit: 'MeV', basis: 'computed', status: 'accepted (scheme-dependent)', formula: 'Λ = M_Z·e^{−2π/(b₀αₛ(M_Z))}，b₀=11−2n_f/3=23/3——固定 n_f=5 一环、无阈值匹配，非 PDG 的 Λ_MS-bar（≈210 MeV）；只用其比值 Λ/Λ₀', inputs: ['alphaSMZ'], ref: 'Gross & Wilczek 1973；Politzer 1973；PDG 2022 QCD review', text: trimNum(lambdaQCD, 3) + ' MeV（方案相关）' });
    D('protonMass', { value: protonMass, name: '质子质量', symbol: 'm_p', unit: 'MeV', basis: 'scaling', status: 'accepted', formula: 'm_p ≈ 938.27 MeV·(Λ_QCD/Λ_QCD₀)（手征极限 m_p ∝ Λ_QCD 的标度；忽略夸克质量修正 ~几 %）', inputs: ['alphaSMZ'], ref: 'Durr et al. 2008（BMW，格点强子谱）', text: trimNum(protonMass, 4) + ' MeV' });
    D('alphaG', { value: alphaG, name: '引力精细结构常数（相对）', symbol: 'α_G/α_G₀', unit: 'rel', basis: 'scaling', status: 'accepted', formula: 'α_G = G m_p²/ħc = (m_p/M_Pl)² = 5.9×10⁻³⁹·(m_p/938 MeV)²（m_p 由 Λ_QCD 标度）', inputs: ['alphaSMZ'], ref: 'Carr & Rees 1979', text: '×' + trimNum(alphaG, 3) });
    D('meOverMp', { value: meOverMp, name: '电子/质子质量比（相对）', symbol: 'mₑ/mₚ', unit: 'rel', basis: 'scaling', status: 'accepted', formula: '(mₑ/0.51099895)/(m_p/938.272)（m_p 由 Λ_QCD 标度）', inputs: ['electronMass', 'alphaSMZ'], ref: 'PDG 2022', text: '1/' + Math.round(1836.15 / meOverMp) });
    D('mnMinusMp', { value: mnMinusMp, name: '中子-质子质量差', symbol: 'm_n−m_p', unit: 'MeV', basis: 'scaling', status: 'accepted', formula: 'Δ = 1.293 + 2.52·[(m_d−m_u)/2.51 − 1] − 1.00·[α/α₀ − 1] MeV（BMW 2015 格点分解：QCD 项 2.52、QED 项 −1.00，线性化于观测值）', inputs: ['mUp', 'mDown', 'alpha'], ref: 'Borsanyi et al. (BMW) 2015, Science 347, 1452；Gasser & Leutwyler 1982', text: trimNum(mnMinusMp, 3) + ' MeV' });
    D('alphaS', { value: alphaSnuc, name: '核力强度（相对）', symbol: 'αₛ,nuc', unit: 'rel', basis: 'scaling', status: 'accepted', formula: 'm_π² ∝ (m_u+m_d)Λ_QCD（GMOR）；核力强度 ≈ 1 − ½ln(m_π²/m_π₀²)（π 越重射程越短；氘核在 +~10% 解体，双质子在 −~10% 束缚）', inputs: ['mUp', 'mDown', 'alphaSMZ'], ref: 'Gell-Mann, Oakes & Renner 1968；Beane & Savage 2003；Epelbaum et al. 2013；Pochet et al. 1991', text: '×' + trimNum(alphaSnuc, 3) });
    D('GF', { value: GF, name: '费米常数', symbol: 'G_F', unit: 'GeV⁻²', basis: 'computed', status: 'accepted', formula: 'G_F = 1/(√2 v²)', inputs: ['higgsVev'], ref: 'PDG 2022', text: sci(GF, 3) + ' GeV⁻²' });
    D('lambdaH', { value: lambdaH, name: '希格斯自耦合', symbol: 'λ_H', unit: '', basis: 'computed', status: 'accepted', formula: 'λ_H = m_H²/(2v²)', inputs: ['higgsMass', 'higgsVev'], ref: 'PDG 2022', text: lambdaH.toFixed(4) + (lambdaH < 0.033 ? '（m_H≲72 GeV：电弱相变可为一级）' : '（电弱相变为平滑过渡）') });
    D('Q', { value: Q, name: '视界尺度密度扰动', symbol: 'Q', unit: '', basis: 'computed', status: 'accepted', formula: 'Q ≈ (2/5)√A_s（物质时代 δ_H = 2R/5）', inputs: ['As'], ref: 'Liddle & Lyth 2000；Tegmark & Rees 1998', text: sci(Q, 3) });
    // 有量纲常数（默认约定 A；可用 Engine.dimensionfulConstants(result, 'B'|'C') 切换）
    var dimf = dimensionfulEntries(alpha / ALPHA0, alphaG, (opts && opts.convention) || 'A');
    delete dimf._meta;
    ['cSI', 'GSI', 'hbarSI', 'eSI'].forEach(function (k) { D(k, dimf[k]); });

    var c = {
      alpha: alpha, alphaSMZ: alphaSMZ, alphaS: alphaSnuc, higgsVev: vRel, higgsVevGeV: p.higgsVev, higgsMass: p.higgsMass, lambdaH: lambdaH, GF: GF,
      electronMassMeV: me, meOverMp: meOverMp, mUp: mu, mDown: md, mnMinusMp: mnMinusMp, thetaQCD: p.thetaQCD, sumNu: p.sumNu, ckmPhase: p.ckmPhase, generations: p.generations,
      H0: p.H0, h: h, tcmb: p.tcmb, omegaR: omegaR, eta10: eta10, omegaB: omegaB, omegaC: omegaC, omegaLambda: omL, As: As, Q: Q, ns: ns, omegaK: omK, efolds: efolds,
      dimS: dimS, dims: dims, lambdaQCD: lambdaQCD, protonMass: protonMass, alphaG: alphaG
    };
    return { c: c, derived: derived, derivedOrder: order, modules: ms, params: p };
  }

  // ============================================================
  // simulate
  // ============================================================
  /**
   * Engine.simulate(params, options)
   * options: { modules:{stringGas,slowRoll,landscape}, register:true 计入引爆次数并编号, series:true 输出 a(t) 序列, catalog, name }
   */
  function simulate(params, options) {
    options = options || {};
    var ms = Params.normalizeModules(options.modules);
    var DC = deriveConstants(params, ms);
    var p = DC.c, inputs = DC.params;                       // p = 演化层输入（派生常数）
    var t0 = Date.now();
    var F = [], calc = {};
    calc.isOurs = Params.isDefault(inputs, ms);
    calcDimensions(p, F, calc);
    calcBaryogenesis(p, F, calc);
    var B = background(p);
    var S = structureSetup(p);
    var d0 = GROWTH_OURS ? S.sigmaGal0 / GROWTH_OURS : 7.2e-4 * (p.Q / Q_OURS);
    if (!calc.baryons.hasBaryons && p.omegaC <= 0) d0 = 0;
    var thresholds = [
      { key: 'first', value: DELTA_C / (3 * S.f8) },   // 3σ 峰，M=10⁸
      { key: 'gal', value: DELTA_C / 2 },              // 2σ，M=10¹²
      { key: 'typical', value: DELTA_C }               // 1σ，M=10¹²
    ];
    var cos = integrate(B, { series: options.series !== false, d0: d0, thresholds: thresholds });
    cos.d0 = d0;
    calcExpansion(p, B, cos, F, calc);
    calcRecombination(p, B, cos, F, calc);
    calcBBN(p, B, F, calc);
    calcStructure(p, B, cos, S, F, calc);
    calcStars(p, F, calc);
    calcAtoms(p, F, calc);
    calcPlanets(p, cos, F, calc);
    calcBiochem(p, cos, F, calc, ms);
    calcOcean(p, B, cos, F, calc);
    var dec = decideOutcome(p, cos, calc, F);
    var timeline = buildTimeline(p, cos, calc, dec.outcome);
    var report = describe(p, cos, calc, dec.outcome, dec.habitability);
    var dist = Params.distance(inputs, null, ms);
    var hash = hashParams(inputs, ms);
    var ours = calc.isOurs;
    var cat = options.catalog || Engine.Catalog;
    var stamp = options.register === false ? { id: null, runs: cat.runs() } : cat.stamp(inputs, ms);
    var worst = 'ok', rank = { ok: 0, warn: 1, bad: 2, fail: 3 };
    F.forEach(function (f) { if (rank[f.verdict] > rank[worst]) worst = f.verdict; });
    var viewTime = dec.outcome.id === 'OBSERVERS_POSSIBLE' ? 19 : (cos.fate.tGyr != null ? Math.min(cos.fate.tGyr, 19) : 13.8);
    return {
      version: VERSION,
      mode: 'real',
      id: stamp.id, idLabel: stamp.id == null ? null : formatId(stamp.id), runs: stamp.runs,
      hash: hash, seed: hash, isOurUniverse: ours,
      name: options.name || (ours ? '我们的宇宙' : null),
      params: inputs,                  // 有效输入（基础参数 + 已开启模块的参数）
      modules: ms,
      constants: p,                    // 第 1 层：演化层实际使用的常数
      derived: DC.derived,             // 第 1 层派生量：{key: {value, name, symbol, unit, basis, status, formula, inputs, ref, text}}
      derivedOrder: DC.derivedOrder,
      findings: F,
      worstVerdict: worst,
      calc: calc,
      cosmology: {
        background: cos.background, fate: cos.fate, events: cos.events, structureFormed: calc.structure.structureFormed,
        series: cos.series, steps: cos.steps, tOfA: cos.tOfA, d0: d0
      },
      timeline: timeline,
      outcome: {
        id: dec.outcome.id, name: dec.outcome.name, cls: dec.outcome.cls, visual: dec.outcome.visual,
        reasons: dec.reasons, observers: dec.outcome.id === 'OBSERVERS_POSSIBLE', viewTimeGyr: viewTime, description: report,
        beyondModel: dec.beyondModel
      },
      fate: cos.fate,
      /* 结局变体：**不是新结局**。合约（ArcUniverse.sol / MirrorUniverse.sol）写死 outcome>11 即 revert，
         OUTCOME_ORDER 的 12 项在 ui/server/合约三处同步，这里一个都不能加。冷液体宇宙的结局仍是 NO_STARS，
         只在这里多挂一个标记，画面与沙盘按它分流（见 calcOcean 与 ui/scenes.js 的 create()）。 */
      variant: (dec.outcome.id === 'NO_STARS' && calc.ocean && calc.ocean.pass) ? 'ocean' : null,
      habitability: dec.habitability,          // D≠3 时为 null（3 维公式外推，不给数）
      habitabilityRaw: dec.habitabilityRaw,    // 内部连乘值（仅供调试，D≠3 时无物理意义）
      canEnterMirror: dec.canEnterMirror,      // false：UI 禁用镜像/星球观测（D≠3）
      distance: dist,
      constantsReport: constantsReport(p),
      dimensionful: dimensionfulConstants(p, 'A'),   // 默认约定 A；Engine.dimensionfulConstants(result, 'B'|'C') 可切换
      report: report,
      elapsedMs: Date.now() - t0
    };
  }

  // ============================================================
  // I. 结构形成粒子模拟（PM：CIC 沉积 → Gauss-Seidel 泊松 → 梯度）
  // ============================================================
  /**
   * Engine.createNBody(params, {N≈粒子数(取平方数), mesh, seed, aStart, tEnd(H0⁻¹), aRip})
   * 膨胀由 Friedmann（同 background）驱动，引力耦合 1.5·Ω_m/a³（普朗克单位下 G 进了 α_G，不再乘相对 G）。
   * 初始条件：格点 + Zel'dovich 位移，位移幅度 ∝ Q。
   */
  function createNBody(params, opts) {
    opts = opts || {};
    var ms = Params.normalizeModules(opts.modules);
    var DC = deriveConstants(params, ms);
    var c = DC.c, p = c;
    var B = background(c);
    var S = structureSetup(c);
    var side = Math.max(8, Math.floor(Math.sqrt(opts.N || 6000)));
    var N = side * side, M = opts.mesh || 56;
    var seed = opts.seed != null ? opts.seed : hashParams(DC.params, ms);
    var aStart = opts.aStart || 0.02, aRip = opts.aRip || 12;
    var quick = integrate(B, { series: false, d0: 0 });
    var fateType = quick.fate.type;
    var tEnd = opts.tEnd;
    if (tEnd == null) { tEnd = fateType === 'crunch' ? quick.fate.tGyr / B.TH * 1.05 : 1.6; tEnd = Math.max(0.5, tEnd); }
    var px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
    var positions = new Float32Array(2 * N);
    var rho = new Float32Array(M * M), phi = new Float32Array(M * M), fx = new Float32Array(M * M), fy = new Float32Array(M * M);
    var self = {
      params: DC.params, modules: ms, constants: c, N: N, mesh: M, seed: seed, px: px, py: py, vx: vx, vy: vy, positions: positions, density: rho,
      a: aStart, ad: 0, t: 0, tGyr: 0, H: 0, dir: 1, ended: false, endReason: null, frame: 0,
      background: B, gravityCoupling: 0, fate: quick.fate, tEnd: tEnd
    };
    function seedParticles() {
      var rnd = mulberry32(seed);
      self.a = aStart; self.ad = aStart * Math.sqrt(Math.max(B.E2(aStart), 1e-12)); self.t = 0; self.tGyr = 0;
      self.ended = false; self.endReason = null; self.frame = 0; self.dir = 1;
      var modes = [];
      for (var i = 0; i < 14; i++) {
        var k = 1 + Math.floor(rnd() * 5), ang = rnd() * 6.283185;
        modes.push({ kx: Math.round(k * Math.cos(ang)), ky: Math.round(k * Math.sin(ang)), ph: rnd() * 6.283185, amp: 1 / (k * k) });
      }
      var amp = 0.007 * (c.Q / Q_OURS) * S.tilt * S.nuFactor;
      var Hi = self.ad / self.a * 0.02;
      for (var j = 0; j < N; j++) {
        var x = ((j % side) + 0.5) / side, y = (Math.floor(j / side) + 0.5) / side, dx = 0, dy = 0;
        for (var mi = 0; mi < modes.length; mi++) {
          var mm = modes[mi];
          var s = Math.sin(6.283185 * (mm.kx * x + mm.ky * y) + mm.ph) * mm.amp;
          dx += mm.kx * s; dy += mm.ky * s;
        }
        px[j] = wrap1(x + amp * dx); py[j] = wrap1(y + amp * dy);
        if (px[j] >= 1) px[j] = 0; if (py[j] >= 1) py[j] = 0;
        vx[j] = amp * dx * Hi; vy[j] = amp * dy * Hi;
      }
      phi.fill(0);
      syncPositions();
      gravity();
    }
    function syncPositions() { for (var i = 0; i < N; i++) { positions[2 * i] = px[i]; positions[2 * i + 1] = py[i]; } }
    function gravity() {
      rho.fill(0);
      var i, x0, y0, x1, y1, tx, ty, gx, gy;
      for (i = 0; i < N; i++) {
        gx = px[i] * M; gy = py[i] * M; x0 = Math.min(gx | 0, M - 1); y0 = Math.min(gy | 0, M - 1); tx = gx - x0; ty = gy - y0;
        x1 = (x0 + 1) % M; y1 = (y0 + 1) % M;
        rho[y0 * M + x0] += (1 - tx) * (1 - ty); rho[y0 * M + x1] += tx * (1 - ty);
        rho[y1 * M + x0] += (1 - tx) * ty; rho[y1 * M + x1] += tx * ty;
      }
      var mean = N / (M * M);
      for (i = 0; i < M * M; i++) rho[i] = rho[i] / mean - 1;
      var h2 = 1 / (M * M);
      for (var it = 0; it < 12; it++) {
        for (var y = 0; y < M; y++) {
          var ym = ((y + M - 1) % M) * M, yp = ((y + 1) % M) * M, yy = y * M;
          for (var x = 0; x < M; x++) {
            var xm = (x + M - 1) % M, xp = (x + 1) % M;
            phi[yy + x] = 0.25 * (phi[yy + xm] + phi[yy + xp] + phi[ym + x] + phi[yp + x] - h2 * rho[yy + x]);
          }
        }
      }
      for (var y2 = 0; y2 < M; y2++) {
        var ym2 = ((y2 + M - 1) % M) * M, yp2 = ((y2 + 1) % M) * M, yy2 = y2 * M;
        for (var x2 = 0; x2 < M; x2++) {
          var xm2 = (x2 + M - 1) % M, xp2 = (x2 + 1) % M;
          fx[yy2 + x2] = -(phi[yy2 + xp2] - phi[yy2 + xm2]) * M * 0.5;
          fy[yy2 + x2] = -(phi[yp2 + x2] - phi[ym2 + x2]) * M * 0.5;
        }
      }
    }
    self.step = function (dt) {
      if (self.ended) return self;
      var a = self.a;
      self.ad += a * B.Q(a) * dt;
      var e2 = B.E2(a);
      if (e2 > 0) self.ad = (self.ad >= 0 ? 1 : -1) * a * Math.sqrt(e2);
      var Hh = self.ad / a;
      self.H = Hh; self.dir = Hh >= 0 ? 1 : -1;
      gravity();
      var gs = 1.5 * B.OmM / (a * a * a);
      self.gravityCoupling = gs;
      for (var i = 0; i < N; i++) {
        var gx = px[i] * M, gy = py[i] * M, x0 = Math.min(gx | 0, M - 1), y0 = Math.min(gy | 0, M - 1), tx = gx - x0, ty = gy - y0;
        var x1 = (x0 + 1) % M, y1 = (y0 + 1) % M;
        var ax = fx[y0 * M + x0] * (1 - tx) * (1 - ty) + fx[y0 * M + x1] * tx * (1 - ty) + fx[y1 * M + x0] * (1 - tx) * ty + fx[y1 * M + x1] * tx * ty;
        var ay = fy[y0 * M + x0] * (1 - tx) * (1 - ty) + fy[y0 * M + x1] * tx * (1 - ty) + fy[y1 * M + x0] * (1 - tx) * ty + fy[y1 * M + x1] * tx * ty;
        vx[i] += (ax * gs - 2 * Hh * vx[i]) * dt; vy[i] += (ay * gs - 2 * Hh * vy[i]) * dt;
        var sp = Math.hypot(vx[i], vy[i]); if (sp > 4) { vx[i] *= 4 / sp; vy[i] *= 4 / sp; }
        px[i] = wrap1(px[i] + vx[i] * dt); py[i] = wrap1(py[i] + vy[i] * dt);
        if (px[i] >= 1) px[i] = 0; if (py[i] >= 1) py[i] = 0;
      }
      self.a = a + self.ad * dt; self.t += dt; self.tGyr = self.t * B.TH; self.frame++;
      syncPositions();
      if (self.a <= aStart * 1.5 && self.ad < 0) finish('crunch');
      else if (self.a <= 0) finish('crunch');
      else if (self.a > aRip) finish('rip');
      else if (self.t > tEnd && self.ad > 0) finish('age');
      else if (self.t > tEnd * 1.5) finish(self.ad < 0 ? 'crunch' : 'age');
      return self;
    };
    function finish(why) { self.ended = true; self.endReason = why; }
    self.suggestDt = function () { return 0.0006 * (1 + self.a * 0.6); };
    self.clumpiness = function () { var v = 0, c = 0; for (var i = 0; i < M * M; i++) { v += rho[i] * rho[i]; if (rho[i] > 6) c++; } return { var: Math.sqrt(v / (M * M)), clusters: c }; };
    self.era = function () {
      var a = self.a;
      if (a < 0.03) return '暴胀'; if (a < 0.08) return '复合 · 微波背景释放'; if (a < 0.2) return '黑暗时代';
      if (a < 0.45) return '第一批恒星'; if (self.dir < 0) return '收缩'; if (a > 8) return '撕裂'; return '星系纪元';
    };
    self.temperature = function () { return B.tcmb / self.a; };
    self.reset = function () { seedParticles(); return self; };
    seedParticles();
    return self;
  }

  // ============================================================
  // J. 目录 Catalog（存储后端可插拔）
  // ============================================================
  var storage = {
    Memory: function () {
      var data = null;
      return { kind: 'memory', load: function () { return data ? JSON.parse(data) : null; }, save: function (obj) { data = JSON.stringify(obj); } };
    },
    LocalStorage: function (key) {
      key = key || 'mirror-universe-catalog';
      return {
        kind: 'localStorage',
        load: function () { try { var s = root_ls().getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
        save: function (obj) { try { root_ls().setItem(key, JSON.stringify(obj)); } catch (e) { /* 配额满/隐私模式：忽略 */ } }
      };
    },
    File: function (path) {
      var fs = require('fs');
      return {
        kind: 'file', path: path,
        load: function () { try { return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null; } catch (e) { return null; } },
        save: function (obj) { fs.writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8'); }
      };
    }
  };
  function root_ls() { return (typeof localStorage !== 'undefined') ? localStorage : (typeof window !== 'undefined' ? window.localStorage : null); }
  function detectStorage(key) {
    try { if (typeof localStorage !== 'undefined' && localStorage) return storage.LocalStorage(key); } catch (e) { /* 无 */ }
    return storage.Memory();
  }
  /**
   * Engine.createCatalog({storage, key})
   * 条目：{id, label, name, params, outcome, outcomeName, hash, createdAt, note}
   * 编号：每次 simulate（register≠false）计一次"引爆"，从 #0001 递增；"我们的宇宙"固定 #1207（普通序列跳过 1207）。
   */
  function createCatalog(options) {
    options = options || {};
    var st = options.storage || detectStorage(options.key);
    var state = st.load() || { runs: 0, entries: [] };
    if (!Array.isArray(state.entries)) state.entries = [];
    if (typeof state.runs !== 'number') state.runs = 0;
    function persist() { st.save(state); }
    function idForRun(n) { return n < OURS_ID ? n : n + 1; }
    var api = {
      OURS_ID: OURS_ID, storage: st, formatId: formatId,
      runs: function () { return state.runs; },
      stamp: function (params, modules) { state.runs += 1; var id = Params.isDefault(params, modules) ? OURS_ID : idForRun(state.runs); persist(); return { id: id, runs: state.runs }; },
      nextId: function () { return idForRun(state.runs + 1); },
      list: function () { return state.entries.slice().sort(function (a, b) { return a.id - b.id; }); },
      get: function (id) { for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) return state.entries[i]; return null; },
      save: function (item) {
        var ms = Params.normalizeModules(item.modules);
        var params = Params.normalize(item.params, ms);
        var outcome = item.outcome ? (typeof item.outcome === 'string' ? item.outcome : item.outcome.id) : null;
        var outcomeName = item.outcome && item.outcome.name ? item.outcome.name : (outcome && OUTCOMES[outcome] ? OUTCOMES[outcome].name : null);
        var id = item.id, ours = Params.isDefault(params, ms);
        if (id == null) id = ours ? OURS_ID : idForRun(++state.runs);
        var entry = {
          id: id, label: formatId(id), name: item.name || (ours ? '我们的宇宙' : '宇宙 ' + formatId(id)),
          params: params, modules: ms, outcome: outcome, outcomeName: outcomeName,
          hash: hashParams(params, ms), createdAt: item.createdAt || new Date().toISOString(), note: item.note || ''
        };
        var idx = -1;
        for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) { idx = i; break; }
        if (idx >= 0) state.entries[idx] = entry; else state.entries.push(entry);
        persist();
        return entry;
      },
      remove: function (id) { var before = state.entries.length; state.entries = state.entries.filter(function (e) { return e.id !== id; }); persist(); return state.entries.length < before; },
      clear: function () { state.entries = []; persist(); },
      resetRuns: function () { state.runs = 0; persist(); },
      exportJSON: function (pretty) { return JSON.stringify({ format: 'mirror-universe-catalog', version: VERSION, runs: state.runs, entries: state.entries }, null, pretty ? 2 : 0); },
      importJSON: function (json, opts) {
        opts = opts || {};
        var obj = typeof json === 'string' ? JSON.parse(json) : json;
        if (!obj || !Array.isArray(obj.entries)) throw new Error('无效的目录 JSON');
        if (opts.merge === false) state.entries = [];
        var count = 0;
        obj.entries.forEach(function (e) {
          if (!e || e.id == null || !e.params) return;
          api.save({ id: e.id, name: e.name, params: e.params, modules: e.modules, outcome: e.outcome, createdAt: e.createdAt, note: e.note });
          count++;
        });
        if (typeof obj.runs === 'number' && obj.runs > state.runs) state.runs = obj.runs;
        persist();
        return count;
      },
      preset: function (key) { return getPreset(key); }
    };
    return api;
  }

  // ============================================================
  // 预设（真实参数组，附依据）
  // ============================================================
  var PRESETS = [
    { key: 'ours', name: '我们的宇宙', id: OURS_ID, expect: 'OBSERVERS_POSSIBLE', params: {},
      blurb: '全部输入取 PDG 2022 / Planck 2018 公认值；三个推测性模块关闭。' },
    { key: 'crunch', name: '大挤压宇宙', expect: 'BIG_CRUNCH', params: { omegaCh2: 1.226, omegaK: -2, omegaLambda: 0 },
      blurb: 'Ω_m≈2.75、Ω_k=−2、Λ=0（几何自洽的闭合宇宙）：膨胀转向，一切被压回奇点。' },
    { key: 'adscrunch', name: '负真空能宇宙', expect: 'BIG_CRUNCH', params: { omegaLambda: -1 },
      blurb: 'Ω_Λ=−1：反德西特式负真空能，膨胀在百亿年量级逆转（Weinberg 1987 讨论的另一侧）。' },
    { key: 'lambda', name: 'Λ 超过 Weinberg 上界', expect: 'HEAT_DEATH_NO_STRUCTURE', params: { omegaLambda: 300 },
      blurb: '真空能大 ~400 倍：Λ 在星系坍缩前主导，增长冻结（Weinberg 1987）。' },
    { key: 'lowQ', name: '涨落太小的宇宙', expect: 'HEAT_DEATH_NO_STRUCTURE', params: { As: 1.6e-12 },
      blurb: 'A_s 小 1300 倍（Q≈5×10⁻⁷）：星系尺度涨落在 Λ 冻结前长不到 δ_c（Tegmark & Rees 1998 下界）。' },
    { key: 'highQ', name: '黑洞主导的宇宙', expect: 'BLACK_HOLE_DOMINATED', params: { As: 1e-4 },
      blurb: 'A_s=10⁻⁴（Q≈4×10⁻³）：坍缩团块的位力速度 ~√Q c，气体在冷却前落入视界。' },
    { key: 'nohydrogen', name: '没有氢的宇宙', expect: 'NO_ATOMS', params: { mDown: 2.16 },
      blurb: 'm_d=m_u：m_n−m_p=−0.76 MeV < −mₑ，质子衰变为中子；没有氢，也没有原子（Hogan 2000）。' },
    { key: 'strongalpha', name: '强电磁宇宙', expect: 'NO_ATOMS', params: { alpha: 0.4 },
      blurb: 'α=0.4：Zα→1 多电子原子失稳；质子的电磁自能也让它比中子重——没有稳定原子。' },
    { key: 'fourdim', name: '四维宇宙（直接输入）', expect: 'UNSTABLE_ORBITS', modules: { stringGas: false }, params: { dimS: 4 },
      blurb: 'D=4（直接输入）：力 ∝ 1/r³，圆轨道对径向微扰失稳（Ehrenfest 1917），氢原子没有基态（Tegmark 1997）。' },
    { key: 'dim37', name: '3.7 维宇宙（直接输入）', expect: 'BEYOND_MODEL_DIM', modules: { stringGas: false }, params: { dimS: 3.7 },
      blurb: 'D=3.7：力 ∝ r^{−2.7}，轨道稳定但不闭合（进动），原子能级与化学显著改变；后续演化按 3 维公式外推，仅供参考、不给可居住性。' },
    { key: 'strongqcd', name: '氘核不束缚的宇宙', expect: 'NO_STARS', params: { alphaSMZ: 0.125 },
      blurb: 'αₛ(M_Z)=0.125：Λ_QCD 大 48%，π 介子更重、核力射程更短，氘核解体；星系形成了但没有恒星点燃。' },
    { key: 'weakqcd', name: '双质子宇宙', expect: 'NO_CHEMISTRY', params: { alphaSMZ: 0.112 },
      blurb: 'αₛ(M_Z)=0.112：Λ_QCD 小 31%，π 介子更轻、核力更强，双质子束缚，氢在 BBN 烧光——有氦星，没有水。' },
    { key: 'hoyle', name: 'Hoyle 共振失谐的宇宙', expect: 'NO_CARBON_CHEMISTRY', params: { alpha: 1.05 / 137.035999084 },
      blurb: 'α +5%：库仑排斥抬高 Hoyle 能级，三氦过程的 ¹²C 产率降 ~300 倍（Oberhummer et al. 2000）——有恒星有化学，没有碳-水型生化。' },
    { key: 'nocp', name: '正反物质对称的宇宙', expect: 'NO_ATOMS', params: { ckmPhase: 0 },
      blurb: 'δ_CKM=0：没有 CP 破坏，Sakharov 条件不满足，物质与反物质对称湮灭。' },
    { key: 'bigvev', name: '弱作用极弱的宇宙', expect: 'STARS_NO_LIFE', params: { higgsVev: 2462 },
      blurb: 'v=10 v₀：G_F 小 100 倍，n/p 冻结更早（Y_p 大增）、超新星哑火、重元素锁在恒星里（Agrawal et al. 1998）。' },
    { key: 'sg_ours', name: '弦气模块 · 默认（D=3）', expect: 'OBSERVERS_POSSIBLE', modules: { stringGas: true }, params: {},
      blurb: '弦气维数模块（speculative，默认开）：T₀/T_H=0.98、n_w=1、κ=0.5 ⇒ 前三维饱和解开、其余饱和蜷缩，D=3.000。' },
    { key: 'sg_fourdim', name: '弦气模块 · 过热（D=4）', expect: 'UNSTABLE_ORBITS', modules: { stringGas: true }, params: { stringGasT: 1.0476, compactStiffness: 0.9 },
      blurb: '弦气过热、阈值较硬（κ=0.9）：第四维的缠绕弦也湮灭殆尽，恰好解开四维。' },
    /* T 从 0.9362 改成 0.97：0.9362 是按**旧的 9 级维序阶梯**标的，
         换成 18 级之后它给出的是 D=2，与"二点五维"这个名字对不上。
         预设的名字是承诺，对不上就得改数，不能改名糊弄过去。 */
    /* 半开带宽收成 ±0.02 之后（见 SG_HALF_BAND），T=0.97 不再有任何一维落进临界窄带，
       这个预设给出的是整数维，和"二点五维"这个名字对不上。重新标定：
       κ=0.1 时 T∈[0.9690, 0.9715] 都给 D=2.5，取中点 0.9703 留最大余量。
       **窄带的必然代价是这个预设变脆** —— 分数维本来就该是刀锋上的事（原文「很少见」），
       以后任何改动阶梯的操作都要重跑这一段标定，别指望它自己还在。 */
    { key: 'sg_fractal', name: '弦气模块 · 二点五维', expect: 'BEYOND_MODEL_DIM', modules: { stringGas: true }, params: { stringGasT: 0.9703, compactStiffness: 0.1 },
      blurb: '第三维落在阈值带内只解开一半（ε₃≈1），D≈2.5：非整数维是数学练习（推测）——有牛顿吸引但引力弱、拓扑受限；3 维公式外推，仅供参考。' },
    { key: 'sg_sixdim', name: '弦气模块 · 六维', expect: 'UNSTABLE_ORBITS', modules: { stringGas: true }, params: { stringGasT: 1.174, compactStiffness: 0.9 },
      blurb: '弦气很热：解开六维。力 ∝ r⁻⁵，圆轨道不稳定，原子没有基态。' },
    { key: 'sr_ours', name: '慢滚模块 · 默认', expect: 'OBSERVERS_POSSIBLE', modules: { slowRoll: true }, params: {},
      blurb: '开启慢滚暴胀模块（mainstream-model）：V₀^{1/4}=7.06×10⁻³ M_Pl、ε=0.005、η=−0.0025 复现 A_s=2.1×10⁻⁹、n_s=0.965。' },
    { key: 'sr_steep', name: '慢滚模块 · 高能标', expect: 'BLACK_HOLE_DOMINATED', modules: { slowRoll: true }, params: { inflatonScale: 0.06 },
      blurb: 'V₀^{1/4}=0.06 M_Pl：A_s ∝ V₀ 大 5000 倍，Q≈1.3×10⁻³，黑洞主导。' },
    { key: 'ls_ours', name: '景观模块 · 默认', expect: 'OBSERVERS_POSSIBLE', modules: { landscape: true }, params: {},
      blurb: '开启弦论景观模块（speculative）：g_s=1、V=137.036、φ=0.5、通量 (2,1,1) 与 Λ₀ 抵消到 10⁻¹²³，复现我们的常数。' },
    { key: 'ls_flux', name: '景观模块 · 多一个通量量子', expect: 'HEAT_DEATH_NO_STRUCTURE', modules: { landscape: true }, params: { flux3: 2 },
      blurb: 'n₃=1→2：Λ 跳到 +4.5×10⁻¹²¹（Ω_Λ≈310），星系永不形成——Bousso–Polchinski 景观里的人择刀锋。' },
    { key: 'ls_noflux', name: '景观模块 · 通量归零', expect: 'BIG_CRUNCH', modules: { landscape: true }, params: { flux1: 0, flux2: 0, flux3: 0 },
      blurb: '通量全为零：只剩负的裸真空能 Λ₀=−4.5×10⁻¹²¹，反德西特坍缩。' }
  ];
  function getPreset(key) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) {
      var ms = Params.normalizeModules(PRESETS[i].modules);
      var base = Params.defaults(ms);
      for (var k in PRESETS[i].params) base[k] = PRESETS[i].params[k];
      return Params.normalize(base, ms);
    }
    return null;
  }
  function presetModules(key) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) return Params.normalizeModules(PRESETS[i].modules);
    return null;
  }

  // ============================================================
  // 随机宇宙：各参数在刻度坐标上均匀；代数取整（D 由弦气参数涌现）
  // ============================================================
  /**
   * 抽样先验（探索用，不代表宇宙参数的真实分布）：
   *   full   —— 各有效参数在其刻度坐标上全范围均匀（现状）
   *   wide   —— 以我们的宇宙为中心：对数参数 ±1 dex 对数均匀；线性参数 ±30%×(max−min)；
   *             有符号/特殊量：Ω_k ±0.1、θ_QCD [0,0.3]、δ_CKM ±0.5、Ω_Λ 与 Σm_ν 按 ±1 dex、N_gen∈{2,3,4}
   *   narrow —— 全部参数以我们的值为中心 ±10%（相对；对数参数 ×10^{±0.041}）；Ω_k ±0.01、θ_QCD [0,0.05]、δ_CKM ±0.1、N_gen=3
   * 弦气模块参数不受 spread 影响（保持 P(D=3)≈1/30）。
   */
  var SPREADS = {
    full: null,
    wide: { dex: 1.0, linFrac: 0.30, signed: { omegaK: 0.1, thetaQCD: [0, 0.3], ckmPhase: 0.5 }, dexKeys: { omegaLambda: 1.0, sumNu: 1.0 }, generations: [2, 3, 4],
      label: '抽样先验 wide：以我们的宇宙为中心，对数参数 ±1 dex、线性参数 ±30% 范围（Ω_k ±0.1、θ_QCD≤0.3、δ_CKM ±0.5、N_gen 2–4）——这是探索用的先验，不代表宇宙参数的真实分布' },
    narrow: { dex: Math.log10(1.1), linFrac: 0, relFrac: 0.10, signed: { omegaK: 0.01, thetaQCD: [0, 0.05], ckmPhase: 0.1 }, dexKeys: { omegaLambda: Math.log10(1.1), sumNu: Math.log10(1.1) }, generations: [3],
      label: '抽样先验 narrow：以我们的宇宙为中心 ±10%（相对；对数参数 ×10^{±0.041}）（Ω_k ±0.01、θ_QCD≤0.05、δ_CKM ±0.1、N_gen=3）——这是探索用的先验，不代表宇宙参数的真实分布' }
  };
  // 注：曾按 "±0.5 dex / ±10% 范围" 定义 narrow，实测 20000 次命中为 0（Hoyle 共振要求 αₛ(M_Z) 在 ~0.1% 内、α 在 ~3% 内），故改为相对 ±10%。
  function spreadLabel(spread) { var sp = SPREADS[spread || 'full']; return sp ? sp.label : '抽样先验 full：各参数在允许范围内均匀——探索用，不代表宇宙参数的真实分布'; }
  /** Engine.randomParams(seed, modules, {spread:'full'|'wide'|'narrow'})：代数取整；弦气参数用校准分布 */
  function randomParams(seedOrRng, modules, opts) {
    if (typeof seedOrRng === 'string') seedOrRng = null;
    opts = opts || {};
    var ms = Params.normalizeModules(modules);
    var sp = SPREADS[opts.spread || 'full'] || null;
    var rnd = typeof seedOrRng === 'function' ? seedOrRng : mulberry32(seedOrRng == null ? (Math.random() * 4294967296) >>> 0 : seedOrRng);
    var p = Params.defaults(ms);
    var sgKeys = { stringGasT: 1, windingDensity: 1, compactStiffness: 1 };
    Params.paramsFor(ms).forEach(function (d) {
      if (sgKeys[d.key]) return;                                   // 弦气参数在下面单独抽
      if (!sp) { p[d.key] = Params.fromUnit(d.key, rnd()); return; }
      var u = 2 * rnd() - 1, v;
      if (d.key === 'generations') { var g = sp.generations; v = g[Math.floor(rnd() * g.length)]; }
      else if (sp.signed[d.key] != null) {
        var sg = sp.signed[d.key];
        v = Array.isArray(sg) ? sg[0] + rnd() * (sg[1] - sg[0]) : d.default + u * sg;
      }
      else if (sp.dexKeys[d.key] != null && d.default > 0) v = d.default * Math.pow(10, u * sp.dexKeys[d.key]);
      else if (d.scale === 'log' && d.default > 0) v = d.default * Math.pow(10, u * sp.dex);
      else if (sp.relFrac != null && d.default > 0) v = d.default * (1 + u * sp.relFrac);   // 相对宽度（线性参数）
      else v = d.default + u * sp.linFrac * (d.max - d.min);
      p[d.key] = clamp(v, d.min, d.max);
    });
    if (!ms.stringGas && !sp && rnd() < 0.5) p.dimS = 3;
    if (!ms.stringGas && sp) p.dimS = 3;                            // 直接输入 D 时以 3 为中心（探索先验）
    if (!sp) p.generations = 1 + Math.floor(rnd() * 6);
    if (ms.stringGas) {
      // 校准过的抽样分布（蒙特卡洛 20000 次：P(D=3)≈1/30，整数/非整数皆非零；见 README §4）：
      // T₀/T_H ~ N(0.98, 0.20) 夹到 [0.5,1.5]；ln n_w ~ N(0, 0.70)；κ = u^{1.5}（偏向宽阈值带）
      var gauss = function () { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      /* 与 engine/bnbhash.js 的 stringGasValue **必须同参数**：
         一个是引擎自己的随机宇宙，一个是区块哈希派生的宇宙，两者的维度分布
         不一致的话，dimensionStatistics 报的数就不是用户实际会遇到的分布。
         曾经不一致过：这里是 0.98，那边被单独调成了 1.02。
         标定值 (1.02, 0.15, 0.54)：P(D=3)=3.05%，D≤1 占 16.1%，满维 3.5%。
         均值取 1.02 而不是默认的 0.98 是**产品选择不是物理结论** ——
         我们的宇宙定义了振幅 A=1 这个点且它正好给 D=3，抽样若关于它对称，
         就有约一半的宇宙 D<3，而 D<3 只有 6 个格子装这一半，低维会堆得很挤。 */
      p.stringGasT = clamp(1.02 + 0.15 * gauss(), 0.5, 1.5);
      p.windingDensity = clamp(Math.exp(0.54 * gauss()), 0.1, 10);
      p.compactStiffness = Math.pow(rnd(), 1.5);
    }
    var out = Params.normalize(p, ms);
    Object.defineProperty(out, '_prior', { value: spreadLabel(opts.spread), enumerable: false });
    return out;
  }
  /**
   * Engine.searchStatistics(N, seed, {modules, spread}) → 各结局比例、P(OBSERVERS_POSSIBLE)、P(OBSERVERS_POSSIBLE ∧ D=3)、P(D=3)、prior 文案
   */
  function searchStatistics(N, seed, opts) {
    N = N || 2000; opts = opts || {};
    var ms = Params.normalizeModules(opts.modules), spread = opts.spread || 'full';
    var rnd = mulberry32(seed == null ? 424242 : seed);
    var counts = {}, obs = 0, obs3 = 0, d3 = 0;
    for (var i = 0; i < N; i++) {
      var p = randomParams(rnd, ms, { spread: spread });
      var r = simulate(p, { modules: ms, register: false, series: false });
      counts[r.outcome.id] = (counts[r.outcome.id] || 0) + 1;
      var is3 = r.constants.dimS === 3;
      if (is3) d3++;
      if (r.outcome.id === 'OBSERVERS_POSSIBLE') { obs++; if (is3) obs3++; }
    }
    var frac = {};
    Object.keys(counts).forEach(function (k) { frac[k] = counts[k] / N; });
    return { N: N, spread: spread, modules: ms, prior: spreadLabel(spread), outcomes: frac, counts: counts, pObservers: obs / N, pObserversAnd3D: obs3 / N, pD3: d3 / N };
  }
  /** 蒙特卡洛：随机弦气参数下 D 的分布（校准/测试用） */
  function dimensionStatistics(N, seed) {
    N = N || 20000;
    var rnd = mulberry32(seed == null ? 20240816 : seed), ms = Params.normalizeModules({ stringGas: true });
    var exact3 = 0, integer = 0, fractional = 0, lt3 = 0, b34 = 0, ge4 = 0, hist = {};
    for (var i = 0; i < N; i++) {
      var p = randomParams(rnd, ms), D = emergentDimensions(p).D;
      if (D === 3) exact3++;
      if (Math.abs(D - Math.round(D)) < 1e-9) integer++; else fractional++;
      if (D < 3) lt3++; else if (D < 4) b34++; else ge4++;
      var bin = Math.floor(D); hist[bin] = (hist[bin] || 0) + 1;
    }
    return { N: N, pExact3: exact3 / N, pInteger: integer / N, pFractional: fractional / N, pBelow3: lt3 / N, p3to4: b34 / N, pAtLeast4: ge4 / N, histogram: hist };
  }

  // ============================================================
  // 导出
  // ============================================================
  var Engine = {
    version: VERSION,
    Params: Params,
    SCHEMA: Params.SCHEMA,
    PARAMS: Params.BASE,
    BASE_PARAMS: Params.BASE,
    MODULES: Params.MODULES,
    PARAMS_FOR: Params.paramsFor,
    paramsFor: Params.paramsFor,
    normalizeModules: Params.normalizeModules,
    deriveConstants: deriveConstants,
    OUTCOMES: OUTCOMES,
    outcomes: OUTCOME_LIST,
    OURS_ID: OURS_ID,
    constants: { T_H: T_H, H_LITTLE: H_LITTLE, NEFF0: NEFF0, ALPHA0: ALPHA0, DELTA_C: DELTA_C, ALPHA_G: ALPHA_G, T_CMB_K: T_CMB_K, Q_OURS: Q_OURS, MZ_GEV: MZ_GEV, B0_NF5: B0_NF5 },
    simulate: simulate,
    background: background,
    makeBackground: makeBackground,
    integrate: integrate,
    structureSetup: structureSetup,
    calc: { dimensions: calcDimensions, baryogenesis: calcBaryogenesis, expansion: calcExpansion, recombination: calcRecombination, bbn: calcBBN, structure: calcStructure, stars: calcStars, atoms: calcAtoms, planets: calcPlanets, biochem: calcBiochem, ocean: calcOcean },
    decideOutcome: decideOutcome,
    buildTimeline: buildTimeline,
    describe: describe,
    constantsReport: constantsReport,
    createNBody: createNBody,
    createCatalog: createCatalog,
    storage: storage,
    Catalog: null,
    presets: PRESETS,
    getPreset: getPreset,
    presetModules: presetModules,
    randomParams: randomParams,
    dimensionStatistics: dimensionStatistics,
    UNIT_CONVENTIONS: UNIT_CONVENTIONS,
    SI_CONSTANTS: SI0,
    dimensionfulConstants: dimensionfulConstants,
    dimensionfulSI: dimensionfulSI,
    searchStatistics: searchStatistics,
    SPREADS: SPREADS,
    spreadLabel: spreadLabel,
    defaults: Params.defaults,
    normalize: Params.normalize,
    distance: Params.distance,
    isOurUniverse: Params.isDefault,
    hashParams: hashParams,
    hashString: hashString,
    mulberry32: mulberry32,
    wrap1: wrap1,
    erfc: erfc,
    formatTime: formatTime,
    formatId: formatId,
    cnNumber: cnNumber,
    cnInt: cnInt,
    sci: sci,
    orbitStability: orbitStability,
    gravityFactor: gravityFactor,
    classifyDims: classifyDims,
    emergentDimensions: emergentDimensions
  };
  Engine.Catalog = createCatalog();
  // 校准：我们的宇宙 δ_lin(a=1)/d0（星系尺度增长因子），使默认参数下 σ_gal(z=0)=1.9
  (function calibrate() {
    var B0 = background(deriveConstants(Params.defaults()).c);
    var r0 = integrate(B0, { series: false, d0: 1e-3 });
    GROWTH_OURS = r0.events.deltaAtOne / 1e-3;
  })();
  return Engine;
});
