/*
 * 镜像宇宙模拟器 · 行星引擎（纯 JS，无 DOM 依赖）
 * ------------------------------------------------------------
 * 观测到一颗星球时（进入恒星系 / 星球 / 地表），按种子确定性地生成它的**输入参数**，
 * 再对这些参数做一遍"能真算的真算"的推导：表面重力、逃逸速度、密度、希尔球、洛希极限、
 * 平衡温度、公转周期、潮汐锁定时标、Jeans 逃逸、灰大气温室、季节幅度、日长、
 * 放射性产热与地质活动、液态水/其它溶剂窗口、宜居带位置、宇宙常数对行星的影响。
 *
 * 与 engine.js 同一套记法：
 *   params[key]                       输入参数（数值）；params.meta[key] = {status, ref, note}
 *     status: 'accepted'（NASA 实测；太阳系）| 'given'（由恒星系生成器给定）| 'seeded'（种子抽样）
 *   derived[key] = {key,name,symbol,unit,value,text,basis,formula,inputs,ref}
 *     basis:  'computed'（直接计算）| 'scaling'（标度关系/定标经验式）| 'heuristic'（启发式判据）
 *   findings[] = {id,title,basis,formula,inputs,value,valueText,threshold,verdict,text,ref}
 *     verdict: 'ok' | 'warn' | 'bad' | 'fail'
 *
 * 原则：一个数都不编造。
 *   - 太阳系八大行星用 NASA Planetary Fact Sheet 的实测值（status:'accepted'，每项标出处）。
 *   - 每条公式写出形式与文献；只有量纲/标度关系的写 basis:'scaling'；判据性的写 'heuristic'。
 *   - 灰大气温室的系数是用金星/地球/火星三点定标的经验式（scaling），不是逐线辐射传输，已在公式里写明。
 *   - 系外行星的含水量、放射性丰度等没有观测约束，按种子抽样并标 'seeded'。
 *
 * 主要出处：
 *   NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov/planetary/factsheet/，公有领域）
 *   Catling & Kasting 2017《Atmospheric Evolution on Inhabited and Lifeless Worlds》
 *   Kopparapu et al. 2013, ApJ 765, 131（宜居带）；Gladman et al. 1996, Icarus 122, 166（潮汐锁定）
 *   Zahnle & Catling 2017, ApJ 843, 122（cosmic shoreline）；Chen & Kipping 2017, ApJ 834, 17（质量-半径）
 *   Weisskopf 1975, Science 187, 605（行星质量上限）；Zeng et al. 2016（岩质质量-半径）
 *   Schmidt et al. 2010, JGR 115, D20106（地球温室归因）；Haberle 2013, Icarus 223, 619（火星温室）
 *   IAPWS-95（水的三相点/临界点）；Turcotte & Schubert《Geodynamics》（放射性产热）
 *
 * UMD：Node 下 module.exports = PlanetEngine；浏览器下 window.MirrorPlanetEngine（不依赖其它文件）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.MirrorPlanetEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  // ============================================================
  // 物理常数（CODATA 2018 / SI 2019 定义值 / IAU 2012）
  // ============================================================
  var G_N = 6.67430e-11;              // 万有引力常数 [m³ kg⁻¹ s⁻²]（CODATA 2018）
  var KB = 1.380649e-23;              // 玻尔兹曼常数 [J/K]（SI 2019 定义值）
  var SIGMA_SB = 5.670374419e-8;      // Stefan–Boltzmann [W m⁻² K⁻⁴]（SI 2019 导出）
  var AMU = 1.66053906660e-27;        // 原子质量单位 [kg]（CODATA 2018）
  var R_GAS = 8.314462618;            // 摩尔气体常数 [J/(mol·K)]（SI 2019 导出）
  var AU_M = 1.495978707e11;          // 天文单位 [m]（IAU 2012 定义值）
  var YR_S = 3.15576e7;               // 儒略年 [s]
  var HOUR_S = 3600;

  var M_SUN = 1.9885e30;              // 太阳质量 [kg]（NASA Sun Fact Sheet）
  var R_SUN = 6.957e8;                // 太阳半径 [m]（IAU 2015 标称值）
  var L_SUN = 3.828e26;               // 太阳光度 [W]（IAU 2015 标称值）
  var T_SUN = 5772;                   // 太阳有效温度 [K]（IAU 2015 标称值）

  var M_E = 5.9724e24;                // 地球质量 [kg]（NASA Earth Fact Sheet）
  var R_E = 6371.0e3;                 // 地球体积平均半径 [m]（NASA）
  var G_E = G_N * M_E / (R_E * R_E);  // 9.82 m/s²（球对称牛顿值；NASA 表面重力 9.80 为赤道口径）
  var OCEAN_KG = 1.4e21;              // 地球海洋总质量 [kg]（约占地球质量 0.023%）

  // 水的相图（IAPWS-95）
  var H2O_TRIPLE_T = 273.16, H2O_TRIPLE_P = 611.657;      // 三相点 [K] / [Pa]
  var H2O_CRIT_T = 647.096, H2O_CRIT_P = 22.064e6;        // 临界点 [K] / [Pa]
  var H2O_LV_R = 5208.6;   // L_vap/R [K]：用三相点与常压沸点两点定标的等效潜热（L≈43.3 kJ/mol），CC 式在 0.006–1 bar 内误差 <1 K
  var H2O_LS_R = 6141.0;   // L_sub/R [K]：升华潜热 51.06 kJ/mol / R（T<273.16 K 分支）

  // 常压（1 bar）下其它溶剂的液相区间（NIST/CRC 手册的沸点与熔点）
  var SOLVENTS = [
    { key: 'H2O', name: '水', low: 273.15, high: 373.15, ref: 'IAPWS-95；1 atm 熔点 273.15 K / 沸点 373.15 K' },
    { key: 'NH3', name: '氨', low: 195.4, high: 239.8, ref: 'CRC Handbook：1 atm 熔点 195.4 K / 沸点 239.8 K' },
    { key: 'CH4', name: '甲烷', low: 90.7, high: 111.7, ref: 'CRC Handbook：1 atm 熔点 90.7 K / 沸点 111.7 K（土卫六表面 94 K）' },
    { key: 'C2H6', name: '乙烷', low: 90.4, high: 184.6, ref: 'CRC Handbook：1 atm 熔点 90.4 K / 沸点 184.6 K' },
    { key: 'N2', name: '氮', low: 63.2, high: 77.4, ref: 'CRC Handbook：1 atm 熔点 63.2 K / 沸点 77.4 K（海卫一表面 38 K）' }
  ];

  // 气体分子量 [u]（IUPAC 2021 标准原子量）
  var GASES = {
    H2: { name: '氢 H₂', mu: 2.01588 },
    He: { name: '氦 He', mu: 4.002602 },
    CH4: { name: '甲烷 CH₄', mu: 16.0425 },
    H2O: { name: '水蒸气 H₂O', mu: 18.01528 },
    N2: { name: '氮 N₂', mu: 28.0134 },
    O2: { name: '氧 O₂', mu: 31.9988 },
    Ar: { name: '氩 Ar', mu: 39.948 },
    CO2: { name: '二氧化碳 CO₂', mu: 44.0095 }
  };
  var GAS_ORDER = ['H2', 'He', 'CH4', 'H2O', 'N2', 'O2', 'Ar', 'CO2'];

  // 灰大气温室：τ = k·p̃^a·P̃^b（p̃ = 吸收气体分压、P̃ = 总压，均折算到地球重力下的柱量 ×(g⊕/g)，单位 bar）
  // 形式取自强线曲线生长律 τ ∝ √(u·γ)（柱量 u ∝ p/g，洛伦兹展宽 γ ∝ P_tot）；
  // 指数与系数用金星（737 K）/地球（288 K）/火星（温室 +5 K，Haberle 2013）三点定标 —— basis: scaling。
  var TAU_A = 0.384327;   // 分压指数
  var TAU_B = 0.425622;   // 总压（压致展宽）指数
  var TAU_K_CO2 = 3.4300;
  var TAU_K_H2O = 6.5222; // 地球定标：H₂O + 云占地球温室的 75%（Schmidt et al. 2010）
  var TAU_K_CH4 = 6.8218; // 地球定标：CH₄/O₃/N₂O 合并计 5%（Schmidt et al. 2010）
  var H2O_COL_F = 0.21463; // 可凝结水汽的等效柱量因子（地球定标：RH=0.7、T=288 K 时等效分压 2.45×10⁻³ bar）—— heuristic
  var RH_DEFAULT = 0.7;    // 近地表相对湿度（地球全球平均约 0.7）—— heuristic

  // 外逸层温度 / 平衡温度（观测定标：地球 ~1000 K、火星 ~200 K、金星 ~275 K、木星 ~900 K）—— heuristic
  var EXO_F_CO2 = 1.2, EXO_F_H2 = 8.0, EXO_F_N2 = 3.9;

  // Zahnle & Catling 2017 "cosmic shoreline"：I_XUV ∝ v_esc⁴。
  // 系数用太阳系六个天体定标（金星/地球/火星/土卫六 有大气；水星/月球 无），并以总辐照代替累计 XUV —— scaling。
  var SHORELINE_C = 4.0e-3;   // I_crit/I⊕ = C·(v_esc[km/s])⁴

  // 潮汐锁定（Gladman et al. 1996, Icarus 122, 166）：t_lock = ω a⁶ I Q /(3 G M★² k₂ R⁵)
  var TIDE_OMEGA_I = 2 * Math.PI / (13.5 * HOUR_S);   // 吸积末期的原始自转 ~13.5 h（Kokubo & Ida 2007）
  var TIDE_Q_ROCK = 100, TIDE_K2_ROCK = 0.3;          // 岩质：Q≈100、k₂≈0.3（地球 Q≈12 含海洋潮汐，固体地球 ≈100）
  var TIDE_Q_GAS = 3e4, TIDE_K2_GAS = 0.5;            // 巨行星：木星 Q≈(3–10)×10⁴、k₂≈0.59（Lainey et al. 2009）

  // 放射性产热（Turcotte & Schubert《Geodynamics》表 4-2 口径：地球现今 BSE 产热 ~20 TW）
  var RADIO = [
    { key: 'U238', now: 8.0, halfGyr: 4.468 },
    { key: 'U235', now: 0.4, halfGyr: 0.704 },
    { key: 'Th232', now: 8.0, halfGyr: 14.05 },
    { key: 'K40', now: 4.0, halfGyr: 1.248 }
  ];
  var EARTH_AGE_GYR = 4.54;           // 地球年龄 [Gyr]（Patterson 1956；Dalrymple 2001）
  var EARTH_HEATFLOW = 0.0865;        // 地球平均地表热流 [W/m²]（47 TW / 5.1×10¹⁴ m²；Davies & Davies 2010）

  // 宜居带（Kopparapu et al. 2013, ApJ 765, 131 + 2013 勘误）：S_eff = S⊙ + aT★ + bT★² + cT★³ + dT★⁴，T★ = T_eff − 5780 K
  var HZ_COEF = {
    recentVenus: [1.7753, 1.4316e-4, 2.9875e-9, -7.5702e-12, -1.1635e-15],
    moistGreenhouse: [1.0140, 8.1774e-5, 1.7063e-9, -4.3241e-12, -6.6462e-16],
    maxGreenhouse: [0.3438, 5.8942e-5, 1.6558e-9, -3.0045e-12, -5.2983e-16],
    earlyMars: [0.3179, 5.4513e-5, 1.5313e-9, -2.7786e-12, -4.8997e-16]
  };

  var LIFE_LEVELS = ['微生物', '植物', '动物', '文明'];

  // ============================================================
  // 太阳系实测表（NASA Planetary Fact Sheet；公有领域）
  // 质量/半径/轨道/自转/反照率/压强/温度全部为实测值，status:'accepted'
  // ============================================================
  var SOLAR = {
    mercury: {
      cn: '水星', massKg: 3.3011e23, radiusM: 2439.7e3, aAU: 0.38710, ecc: 0.20563, incDeg: 7.004,
      obliqDeg: 0.034, rotH: 1407.6, bond: 0.088, pBar: 0, tSurfK: 440, tBBK: 439.6, moons: 0, rings: false, dynamo: true,
      atm: {}, water: 0, kind: 'rock', note: '只有由太阳风与撞击溅射维持的外逸层（Na/K/O），没有稳定大气；有微弱的内禀磁场（≈1% 地球）'
    },
    venus: {
      cn: '金星', massKg: 4.8675e24, radiusM: 6051.8e3, aAU: 0.72333, ecc: 0.00677, incDeg: 3.395,
      obliqDeg: 177.36, rotH: -5832.5, bond: 0.77, pBar: 92, tSurfK: 737, tBBK: 226.6, moons: 0, rings: false, dynamo: false,
      atm: { CO2: 0.965, N2: 0.035, H2O: 2.0e-5 }, water: 0, kind: 'rock', note: '自转为逆行（转轴倾角 177.4°）；无内禀磁场'
    },
    earth: {
      cn: '地球', massKg: 5.9724e24, radiusM: 6371.0e3, aAU: 1.00000, ecc: 0.01671, incDeg: 0.0,
      obliqDeg: 23.44, rotH: 23.9345, bond: 0.306, pBar: 1.014, tSurfK: 288, tBBK: 254.3, moons: 1, rings: false, dynamo: true,
      atm: { N2: 0.7808, O2: 0.2095, Ar: 0.0093, CO2: 4.2e-4, H2O: 2.5e-3, CH4: 1.9e-6 }, water: 1, kind: 'rock',
      note: 'H₂O 取全球平均柱量的等效摩尔分数（实际 0–4% 强烈可变）；CO₂ 取 2023 年 420 ppm'
    },
    mars: {
      cn: '火星', massKg: 6.4171e23, radiusM: 3389.5e3, aAU: 1.52371, ecc: 0.09339, incDeg: 1.848,
      obliqDeg: 25.19, rotH: 24.6229, bond: 0.25, pBar: 0.00636, tSurfK: 208, tBBK: 209.8, moons: 2, rings: false, dynamo: false,
      atm: { CO2: 0.9532, N2: 0.027, Ar: 0.016, O2: 0.0013, H2O: 2.1e-4 }, water: 0.00002, kind: 'rock',
      note: '平均气压随季节在 4.0–8.7 mbar 之间变化（极冠 CO₂ 凝结/升华）；无全球磁场，只有地壳剩磁'
    },
    jupiter: {
      cn: '木星', massKg: 1.8982e27, radiusM: 69911e3, aAU: 5.2029, ecc: 0.0484, incDeg: 1.304,
      obliqDeg: 3.13, rotH: 9.925, bond: 0.343, pBar: 1, tSurfK: 163, tBBK: 109.9, moons: 95, rings: true, dynamo: true,
      atm: { H2: 0.898, He: 0.102, CH4: 0.003 }, water: 0, kind: 'gas',
      note: '没有固体表面；温度与压强取 1 bar 参考面。内部热流约为吸收太阳辐射的 1.67 倍（有效温度 124 K > 平衡温度 110 K）'
    },
    saturn: {
      cn: '土星', massKg: 5.6834e26, radiusM: 58232e3, aAU: 9.5367, ecc: 0.0539, incDeg: 2.486,
      obliqDeg: 26.73, rotH: 10.656, bond: 0.342, pBar: 1, tSurfK: 133, tBBK: 81.1, moons: 146, rings: true, dynamo: true,
      atm: { H2: 0.963, He: 0.0325, CH4: 0.0045 }, water: 0, kind: 'gas',
      note: '没有固体表面；1 bar 参考面。平均密度 687 kg/m³，低于水'
    },
    uranus: {
      cn: '天王星', massKg: 8.6810e25, radiusM: 25362e3, aAU: 19.189, ecc: 0.04726, incDeg: 0.773,
      obliqDeg: 97.77, rotH: -17.24, bond: 0.300, pBar: 1, tSurfK: 78, tBBK: 58.1, moons: 28, rings: true, dynamo: true,
      atm: { H2: 0.825, He: 0.152, CH4: 0.023 }, water: 0, kind: 'ice',
      note: '自转轴几乎躺在轨道面内（倾角 97.8°，自转为逆行）；1 bar 参考面'
    },
    neptune: {
      cn: '海王星', massKg: 1.02409e26, radiusM: 24622e3, aAU: 30.070, ecc: 0.00859, incDeg: 1.770,
      obliqDeg: 28.32, rotH: 16.11, bond: 0.290, pBar: 1, tSurfK: 73, tBBK: 46.6, moons: 16, rings: true, dynamo: true,
      atm: { H2: 0.80, He: 0.19, CH4: 0.015 }, water: 0, kind: 'ice',
      note: '1 bar 参考面；内部热流约为吸收太阳辐射的 2.6 倍'
    }
  };
  var SOLAR_BY_CN = {};
  Object.keys(SOLAR).forEach(function (k) { SOLAR[k].key = k; SOLAR_BY_CN[SOLAR[k].cn] = SOLAR[k]; });
  var FACTSHEET_REF = 'NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov/planetary/factsheet/）';

  // ============================================================
  // 工具
  // ============================================================
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function clamp01(x) { return clamp(x, 0, 1); }
  /** 年龄口径：params.ageGyr===0 是合法值（刚形成），只有 null/undefined/NaN 才回落到恒星年龄（#13） */
  function ageGyrOf(params, star) {
    if (params && params.ageGyr != null && isFinite(params.ageGyr)) return params.ageGyr;
    if (star && star.ageGyr != null && isFinite(star.ageGyr)) return star.ageGyr;
    return 0;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function log10(x) { return Math.log(x) / Math.LN10; }
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '' };
  function sup(n) { return String(n).split('').map(function (ch) { return SUP[ch] == null ? ch : SUP[ch]; }).join(''); }
  function sci(x, digits) {
    if (x === 0) return '0';
    if (!isFinite(x)) return String(x);
    digits = digits == null ? 3 : digits;
    var ex = Math.floor(log10(Math.abs(x))), m = x / Math.pow(10, ex);
    var ms = Number(m.toPrecision(digits));
    if (Math.abs(ms) >= 10) { ms /= 10; ex += 1; }
    return ms + '×10' + sup(ex);
  }
  function trimNum(x, prec) { if (!isFinite(x)) return String(x); return String(Number(x.toPrecision(prec == null ? 3 : prec))); }
  function num(x, prec) { return Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? sci(x, prec || 3) : trimNum(x, prec || 3); }
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash32(a) {
    a = a >>> 0; a = (a ^ 61) ^ (a >>> 16); a = Math.imul(a, 9) >>> 0;
    a ^= a >>> 4; a = Math.imul(a, 0x27d4eb2d) >>> 0; a ^= a >>> 15; return a >>> 0;
  }
  function fmtTimeYr(yr) {
    if (yr == null || !isFinite(yr)) return '—';
    var a = Math.abs(yr);
    if (a < 1) return trimNum(yr * 365.25, 3) + ' 天';
    if (a < 1e4) return trimNum(yr, 3) + ' 年';
    if (a < 1e8) return trimNum(yr / 1e4, 3) + ' 万年';
    if (a < 1e13) return trimNum(yr / 1e8, 3) + ' 亿年';
    return '10' + sup(Math.round(log10(a))) + ' 年';
  }

  var VERDICT_ORDER = { ok: 0, warn: 1, bad: 2, fail: 3 };
  function makeFinding(o) {
    return {
      id: o.id, title: o.title, basis: o.basis, formula: o.formula || '', inputs: o.inputs || {},
      value: o.value == null ? null : o.value, valueText: o.valueText || (o.value == null ? '' : num(o.value)),
      threshold: o.threshold || '', verdict: o.verdict || 'ok', text: o.text || '', ref: o.ref || ''
    };
  }

  // ============================================================
  // 输入参数表（SCHEMA）
  // ============================================================
  var SCHEMA = [
    { key: 'massEarth', index: 1, name: '质量', symbol: 'M', unit: 'M⊕', min: 0.001, max: 4000, group: '本体',
      ref: FACTSHEET_REF, desc: '决定表面重力、逃逸速度、大气保留、内部热与最大质量判据。太阳系为实测值。' },
    { key: 'radiusEarth', index: 2, name: '半径', symbol: 'R', unit: 'R⊕', min: 0.05, max: 20, group: '本体',
      ref: FACTSHEET_REF + '；Chen & Kipping 2017, ApJ 834, 17（系外行星质量-半径中位关系）', desc: '体积平均半径。与质量一起给出密度、重力与逃逸速度。' },
    { key: 'rockFrac', index: 3, name: '岩铁质量分数', symbol: 'f_rock', unit: '', min: 0, max: 1, group: '本体',
      ref: 'Zeng, Sasselov & Jacobsen 2016, ApJ 819, 127；太阳系密度（NASA）', desc: '硅酸盐 + 铁核占总质量的比例。与冰、气分数之和为 1。' },
    { key: 'iceFrac', index: 4, name: '冰质量分数', symbol: 'f_ice', unit: '', min: 0, max: 1, group: '本体',
      ref: 'Zeng et al. 2016；Hayashi 1981（雪线）', desc: 'H₂O/NH₃/CH₄ 冰占总质量的比例；雪线以外才可能显著。' },
    { key: 'gasFrac', index: 5, name: 'H/He 包层质量分数', symbol: 'f_gas', unit: '', min: 0, max: 1, group: '本体',
      ref: 'Lopez & Fortney 2014, ApJ 792, 1', desc: '氢氦包层占总质量的比例；>0.1 即为巨行星。' },
    { key: 'coreMassFrac', index: 6, name: '金属核质量分数', symbol: 'f_core', unit: '', min: 0, max: 0.7, group: '本体',
      ref: '地球 0.325（Dziewonski & Anderson 1981, PREM）', desc: '导电流体核的规模，进入发电机（磁场）判据。' },
    { key: 'orbitAU', index: 7, name: '轨道半长轴', symbol: 'a', unit: 'AU', min: 0.005, max: 2000, group: '轨道',
      ref: FACTSHEET_REF, desc: '决定辐照、平衡温度、公转周期、潮汐锁定时标与希尔球。' },
    { key: 'ecc', index: 8, name: '偏心率', symbol: 'e', unit: '', min: 0, max: 0.95, group: '轨道',
      ref: FACTSHEET_REF, desc: '近日/远日辐照比 = ((1+e)/(1−e))²；也进入潮汐加热。' },
    { key: 'incDeg', index: 9, name: '轨道倾角', symbol: 'i', unit: '°', min: 0, max: 90, group: '轨道',
      ref: FACTSHEET_REF + '（相对黄道）', desc: '相对系统不变平面的倾角；只作记录，不进入温度计算。' },
    { key: 'rotationHours', index: 10, name: '自转周期', symbol: 'P_rot', unit: 'h', min: -1e5, max: 1e5, group: '自转',
      ref: FACTSHEET_REF, desc: '负值为逆行。决定日长、科里奥利参数与发电机强度。' },
    { key: 'obliquityDeg', index: 11, name: '转轴倾角', symbol: 'ε', unit: '°', min: 0, max: 180, group: '自转',
      ref: FACTSHEET_REF, desc: '决定季节幅度；>90° 表示自转为逆行。' },
    { key: 'albedo', index: 12, name: '邦德反照率', symbol: 'A_B', unit: '', min: 0.02, max: 0.95, group: '大气',
      ref: FACTSHEET_REF, desc: '被反射掉的入射恒星辐射比例，直接进入平衡温度。' },
    { key: 'surfacePressureBar', index: 13, name: '表面气压', symbol: 'P₀', unit: 'bar', min: 0, max: 1e4, group: '大气',
      ref: FACTSHEET_REF + '（巨行星取 1 bar 参考面）', desc: '与成分一起决定温室光学厚度与液态窗口。' },
    { key: 'atmosphere', index: 14, name: '大气成分', symbol: 'x_i', unit: '摩尔分数', min: 0, max: 1, group: '大气',
      ref: FACTSHEET_REF + '；Catling & Kasting 2017', desc: 'H₂/He/CH₄/H₂O/N₂/O₂/Ar/CO₂ 的摩尔分数（归一化）。' },
    { key: 'waterOceans', index: 15, name: '含水量', symbol: 'W', unit: '地球海洋', min: 0, max: 500, group: '挥发分',
      ref: '地球海洋质量 1.4×10²¹ kg；系外行星含水量无观测约束（Tian & Ida 2015）', desc: '以地球海洋质量为单位的水总量；决定海洋、水汽储库与失控温室的上限。' },
    { key: 'radiogenicRel', index: 16, name: '放射性元素丰度（相对地球）', symbol: 'f_U,Th,K', unit: 'rel', min: 0.1, max: 3, group: '内部',
      ref: 'Turcotte & Schubert《Geodynamics》；恒星 Th/Eu 弥散（Unterborn et al. 2015）', desc: '按恒星金属丰度弥散抽样；决定放射性产热与板块活动。' },
    { key: 'magneticIndex', index: 17, name: '磁场指数', symbol: 'I_B', unit: '0–1', min: 0, max: 1, group: '内部',
      ref: 'Christensen 2010, Space Sci. Rev. 152, 565（发电机标度）—— 本引擎取启发式指数', desc: '导电核 + 自转 + 内部热的综合指数；0 表示没有全球磁场。' },
    { key: 'ageGyr', index: 18, name: '年龄', symbol: 't', unit: 'Gyr', min: 0, max: 13.8, group: '时间',
      ref: '太阳系 4.567 Gyr（CAI，Connelly et al. 2012）；其余取恒星年龄', desc: '行星年龄≈恒星年龄；决定放射性产热衰减、大气演化与生命等级。' }
  ];
  var SCHEMA_BY_KEY = {};
  SCHEMA.forEach(function (d) { SCHEMA_BY_KEY[d.key] = d; });

  // ============================================================
  // 归一化输入
  // ============================================================
  function normStar(star) {
    star = star || {};
    var massRel = star.massRel != null ? star.massRel : 1;
    var lumRel = star.lumRel != null ? star.lumRel : Math.pow(massRel, 3.5);   // 主序质光关系 L ∝ M^3.5（Salaris & Cassisi 2005）
    var tempK = star.tempK != null ? star.tempK : T_SUN * Math.pow(massRel, 0.5);
    var radiusRel = star.radiusRel != null ? star.radiusRel : Math.pow(massRel, 0.8);
    var ageGyr = star.ageGyr != null ? star.ageGyr : 4.6;
    return {
      massRel: massRel, massKg: massRel * M_SUN, lumRel: lumRel, lumW: lumRel * L_SUN,
      tempK: tempK, radiusRel: radiusRel, radiusM: radiusRel * R_SUN, ageGyr: ageGyr,
      cls: star.cls || star.type || null, name: star.name || null,
      /* 演化阶段必须原样带过来：以前这里只留主序参数，于是白矮星到了 describeStar 手里
         就变回"一颗 F 型主序星"（温度还在，聚变早停了）。spt 里存的是 DA/DB/DC 这类遗骸型号。 */
      spt: star.spt || null, stage: star.stage || null, stageName: star.stageName || null, stageNote: star.stageNote || null,
      remnant: !!star.remnant, massInit: star.massInit != null ? star.massInit : null,
      massRemnant: star.massRemnant != null ? star.massRemnant : null,
      msLifeGyr: star.msLifeGyr != null ? star.msLifeGyr : null,
      multiplicity: star.multiplicity != null ? star.multiplicity : null,
      tMSGyr: 10 / Math.pow(Math.max(massRel, 0.02), 2.5)   // 主序寿命 ≈10 Gyr·(M/M⊙)^−2.5
    };
  }
  function normUC(uc) {
    uc = uc || {};
    var c = uc.constants || uc.c || uc;
    function pick(a, b, d) { return a != null && isFinite(a) ? a : (b != null && isFinite(b) ? b : d); }
    return {
      alphaRel: pick(uc.alphaRel, c.alpha != null ? c.alpha * 137.035999084 : null, 1),
      alphaGRel: pick(uc.alphaGRel, c.alphaG, 1),
      meOverMpRel: pick(uc.meOverMpRel, c.meOverMp, 1),
      dimS: pick(uc.dimS, c.dimS, 3),
      universeHabitability: pick(uc.universeHabitability, uc.habitability, 1),
      isOurs: !!(uc.isOurs || uc.isOurUniverse || uc.id === 1207)
    };
  }

  // ============================================================
  // 水的饱和蒸气压（Clausius–Clapeyron，两点定标）
  // ============================================================
  function pSatH2O(T) {
    if (!(T > 0)) return 0;
    if (T >= H2O_CRIT_T) return H2O_CRIT_P;
    var LR = T >= H2O_TRIPLE_T ? H2O_LV_R : H2O_LS_R;
    var p = H2O_TRIPLE_P * Math.exp(LR * (1 / H2O_TRIPLE_T - 1 / T));
    return Math.min(p, H2O_CRIT_P);
  }
  /** 给定气压下的沸点（CC 反解），高于临界点则返回临界温度 */
  function boilingT(pPa) {
    if (!(pPa > H2O_TRIPLE_P)) return null;                 // 低于三相点：只有冰与汽
    if (pPa >= H2O_CRIT_P) return H2O_CRIT_T;
    var inv = 1 / H2O_TRIPLE_T - Math.log(pPa / H2O_TRIPLE_P) / H2O_LV_R;
    var T = 1 / inv;
    return Math.min(T, H2O_CRIT_T);
  }

  // ============================================================
  // 温室：灰大气 T_s = T_eq(1+¾τ)^{1/4}
  // ============================================================
  function tauTerm(k, pTilde, PTilde) {
    if (!(pTilde > 0) || !(PTilde > 0)) return 0;
    return k * Math.pow(pTilde, TAU_A) * Math.pow(PTilde, TAU_B);
  }
  /**
   * 迭代解表面温度：水汽随 T_s 变（Clausius–Clapeyron），构成正反馈；
   * 水汽分压上限 = 全部含水量蒸发后的分压。发散（T>1500 K 或水全部蒸发且仍在升温）判为失控温室。
   */
  function solveSurfaceT(Teq, params, gSurf) {
    var P0 = params.surfacePressureBar || 0, mix = params.atmosphere || {};
    if (!(P0 > 0)) return { Ts: Teq, tau: 0, tauParts: {}, pH2O: 0, runaway: false, iters: 0 };
    var gf = G_E / Math.max(gSurf, 1e-6);
    var PT = P0 * gf;
    var pCO2 = (mix.CO2 || 0) * P0 * gf, pCH4 = (mix.CH4 || 0) * P0 * gf;
    var pH2Ofixed = (mix.H2O || 0) * P0 * gf;
    // 含水量上限（把全部水蒸发成大气的等效分压 [bar]，已折算重力）
    // _areaM2 由 deriveFromSeed 写入；直接 evaluate 手填参数时常缺——用半径回推表面积，否则海洋永不进温室/失控判据
    var areaM2 = params._areaM2 > 0 ? params._areaM2
      : ((params.radiusEarth || 0) > 0 ? 4 * Math.PI * Math.pow(params.radiusEarth * R_E, 2) : 0);
    var waterCapBar = params.waterOceans > 0 && areaM2 > 0
      ? (params.waterOceans * OCEAN_KG / areaM2) * G_E / 1e5 : 0;
    var Ts = Math.max(Teq, 100), tau = 0, parts = {}, pH2O = pH2Ofixed, diverged = false, it = 0;
    for (it = 0; it < 80; it++) {
      var pCond = RH_DEFAULT * (pSatH2O(Ts) / 1e5) * H2O_COL_F * gf;     // Pa→bar，再折算柱量
      pH2O = Math.max(pH2Ofixed, Math.min(pCond, waterCapBar || pH2Ofixed));
      var PTot = PT + Math.max(0, pH2O - pH2Ofixed);
      parts = {
        CO2: tauTerm(TAU_K_CO2, pCO2, PTot),
        H2O: tauTerm(TAU_K_H2O, pH2O, PTot),
        CH4: tauTerm(TAU_K_CH4, pCH4, PTot)
      };
      tau = parts.CO2 + parts.H2O + parts.CH4;
      var Tn = Teq * Math.pow(1 + 0.75 * tau, 0.25);
      if (Tn > 1500) { diverged = true; Ts = Tn; break; }
      if (Math.abs(Tn - Ts) < 1e-4) { Ts = Tn; break; }
      Ts = Ts + 0.5 * (Tn - Ts);
    }
    // 失控温室专指"水汽正反馈自持"：必须是水汽项主导，且水已全部（或几乎全部）进入大气
    var waterDriven = tau > 0 && (parts.H2O || 0) > 0.5 * tau;
    var runaway = waterDriven && (diverged || (waterCapBar > 0 && pH2O >= waterCapBar * 0.999 && Ts > H2O_CRIT_T));
    return { Ts: Ts, tau: tau, tauParts: parts, pH2O: pH2O, runaway: runaway, diverged: diverged, iters: it };
  }

  // ============================================================
  // 宜居带（Kopparapu et al. 2013）
  // ============================================================
  function hzEdge(coef, Teff, lumRel) {
    var Ts = clamp(Teff, 2600, 7200) - 5780;
    var S = coef[0] + coef[1] * Ts + coef[2] * Ts * Ts + coef[3] * Ts * Ts * Ts + coef[4] * Ts * Ts * Ts * Ts;
    return { S: S, dAU: Math.sqrt(lumRel / S) };
  }

  // ============================================================
  // deriveFromSeed —— 观测时按种子确定性生成输入参数
  // ============================================================
  /**
   * PE.deriveFromSeed(seed, star, given, uc) → params
   *   given（可选）：恒星系生成器已经定下的量 {au, ecc, incDeg, radiusRel, gravityRel, rotationH,
   *                  tiltDeg, pressureRel, type, real, key, ageGyr}；给了就采用（status:'given'），没给就抽样（'seeded'）。
   *   given.real && SOLAR[given.key] → 全部改用 NASA 实测值（status:'accepted'）。
   */
  function deriveFromSeed(seed, star, given, uc) {
    star = normStar(star); uc = normUC(uc); given = given || {};
    var rnd = mulberry32(hash32((seed >>> 0) ^ 0x504C4E54));
    var P = { meta: {}, seed: seed >>> 0 };
    function set(key, value, status, ref, note) {
      P[key] = value;
      P.meta[key] = { status: status, ref: ref || (SCHEMA_BY_KEY[key] ? SCHEMA_BY_KEY[key].ref : ''), note: note || '' };
      return value;
    }
    // 只有显式标了 real 的太阳系天体才用 NASA 实测值（#10）：
    // 过程生成的行星可能借用太阳系天体的贴图 key（visualKey），不能因此被换成实测数据。
    var real = given.real && given.key && SOLAR[given.key] ? SOLAR[given.key] : null;
    if (!real && given.real && given.name && SOLAR_BY_CN[given.name]) real = SOLAR_BY_CN[given.name];

    // ---------- 太阳系：全部实测 ----------
    if (real) {
      set('massEarth', real.massKg / M_E, 'accepted', FACTSHEET_REF, real.cn + ' 质量 ' + sci(real.massKg, 5) + ' kg');
      set('radiusEarth', real.radiusM / R_E, 'accepted', FACTSHEET_REF, '体积平均半径 ' + trimNum(real.radiusM / 1000, 6) + ' km');
      var isGas = real.kind === 'gas' || real.kind === 'ice';
      set('rockFrac', isGas ? (real.kind === 'ice' ? 0.15 : 0.03) : (1 - (real.kind === 'rock' ? 0 : 0)), isGas ? 'seeded' : 'accepted',
        isGas ? 'Guillot 2005；Helled & Fortney 2020（巨行星内部模型仍有量级不确定）' : FACTSHEET_REF,
        isGas ? '巨行星的核质量至今没有定论，这里只给一个量级' : '按平均密度判为岩铁');
      set('iceFrac', real.kind === 'ice' ? 0.75 : 0, real.kind === 'ice' ? 'seeded' : 'accepted', 'Helled & Fortney 2020', real.kind === 'ice' ? '"冰"指 H₂O/NH₃/CH₄ 的高压相' : '');
      set('gasFrac', real.kind === 'gas' ? 0.97 : real.kind === 'ice' ? 0.10 : 0, real.kind === 'rock' ? 'accepted' : 'seeded', 'Guillot 2005', '');
      set('coreMassFrac', real.key === 'earth' ? 0.325 : real.key === 'mercury' ? 0.70 : real.kind === 'rock' ? 0.25 : 0.05,
        real.key === 'earth' ? 'accepted' : 'seeded',
        real.key === 'earth' ? 'Dziewonski & Anderson 1981（PREM）' : 'Hauck et al. 2013（水星）；行星内部模型', '');
      set('orbitAU', real.aAU, 'accepted', FACTSHEET_REF);
      set('ecc', real.ecc, 'accepted', FACTSHEET_REF);
      set('incDeg', real.incDeg, 'accepted', FACTSHEET_REF + '（相对黄道）');
      set('rotationHours', real.rotH, 'accepted', FACTSHEET_REF, real.rotH < 0 ? '逆行自转' : '');
      set('obliquityDeg', real.obliqDeg, 'accepted', FACTSHEET_REF);
      set('albedo', real.bond, 'accepted', FACTSHEET_REF + '（Bond albedo）');
      set('surfacePressureBar', real.pBar, 'accepted', FACTSHEET_REF, real.kind === 'rock' ? '' : '1 bar 参考面（没有固体表面）');
      set('atmosphere', normalizeMix(real.atm), 'accepted', FACTSHEET_REF, real.note);
      set('waterOceans', real.water, real.key === 'earth' ? 'accepted' : 'seeded',
        real.key === 'earth' ? '地球海洋 1.4×10²¹ kg' : '火星/金星的现存水量为估计值（Villanueva et al. 2015）', '');
      set('radiogenicRel', 1, real.key === 'earth' ? 'accepted' : 'seeded', 'Turcotte & Schubert《Geodynamics》', '');
      set('magneticIndex', real.dynamo ? (real.key === 'earth' ? 1 : real.key === 'mercury' ? 0.01 : 0.9) : 0, 'accepted',
        real.key === 'mercury' ? 'Anderson et al. 2011（MESSENGER：水星偶极矩约地球的 1%）' : FACTSHEET_REF + '（Global Magnetic Field）',
        real.dynamo ? '有全球内禀磁场' : '没有全球内禀磁场');
      set('ageGyr', 4.567, 'accepted', 'Connelly et al. 2012, Science 338, 651（CAI 铅-铅年龄 4.567 Gyr）');
      P.kind = real.kind; P.solarKey = real.key; P.name = real.cn; P.real = true;
      P._areaM2 = 4 * Math.PI * real.radiusM * real.radiusM;
      P.note = real.note;
      P.moonCount = real.moons; P.hasRings = !!real.rings;      // NASA 实测（Number of moons / Ring system?）
      P.moonNames = given.moonNames || null;
      return P;
    }

    // ---------- 过程生成 ----------
    var type = given.type || 'rock';
    var gasy = type === 'gas';
    var aAU = given.au != null ? given.au : 0.05 * Math.exp(rnd() * Math.log(1500));
    set('orbitAU', aAU, given.au != null ? 'given' : 'seeded', '轨道由恒星系生成器给定（对数间距，Hayashi 1981 的最小质量星云）');
    set('ecc', given.ecc != null ? given.ecc : +(rnd() * 0.12).toFixed(3), given.ecc != null ? 'given' : 'seeded',
      '太阳系八大行星 e = 0.007–0.206（NASA）；系外行星分布更宽（Kipping 2013）');
    set('incDeg', given.incDeg != null ? given.incDeg : +(rnd() * 4).toFixed(2), given.incDeg != null ? 'given' : 'seeded',
      '太阳系 i < 7.0°（NASA）；共面性来自原行星盘');

    // 半径与质量：优先采用生成器给的半径/重力（保证与画面一致），否则用 Chen & Kipping 2017 中位关系
    var radiusRel, massEarth, radiusSource;
    if (given.radiusRel != null && given.gravityRel != null) {
      radiusRel = given.radiusRel; massEarth = given.gravityRel * radiusRel * radiusRel; radiusSource = 'given';
    } else if (given.radiusRel != null) {
      radiusRel = given.radiusRel; massEarth = massFromRadius(radiusRel); radiusSource = 'given';
    } else {
      massEarth = gasy ? Math.exp(lerp(Math.log(15), Math.log(600), rnd())) : Math.exp(lerp(Math.log(0.05), Math.log(8), rnd()));
      radiusRel = radiusFromMass(massEarth); radiusSource = 'seeded';
    }
    set('radiusEarth', radiusRel, radiusSource, radiusSource === 'given' ? '半径由恒星系生成器给定' : 'Chen & Kipping 2017（Forecaster 中位质量-半径关系）');
    set('massEarth', massEarth, radiusSource === 'given' ? 'given' : 'seeded',
      radiusSource === 'given' ? 'M = gR²/G，g 与 R 由生成器给定' : 'Chen & Kipping 2017');

    // 成分：雪线（Hayashi 1981：太阳星云 2.7 AU）
    var snow = 2.7 * Math.sqrt(star.lumRel);
    var fGas = gasy ? clamp(0.55 + 0.4 * rnd(), 0, 0.98) : (massEarth > 6 ? clamp(0.01 + 0.05 * rnd(), 0, 0.2) : 0);
    var fIce = gasy ? clamp((1 - fGas) * (aAU > snow * 1.5 ? 0.85 : 0.4), 0, 1)
      : (aAU > snow ? clamp(0.15 + 0.4 * rnd(), 0, 0.6) : clamp(0.02 * rnd(), 0, 0.05));
    var fRock = clamp(1 - fGas - fIce, 0, 1);
    set('rockFrac', +fRock.toFixed(3), 'seeded', 'Zeng et al. 2016；雪线 2.7√(L/L⊙) AU（Hayashi 1981）');
    set('iceFrac', +fIce.toFixed(3), 'seeded', 'Hayashi 1981（雪线以外冰可参与吸积）');
    set('gasFrac', +fGas.toFixed(3), 'seeded', 'Lopez & Fortney 2014');
    set('coreMassFrac', +clamp(gasy ? 0.03 + 0.05 * rnd() : 0.2 + 0.25 * rnd(), 0, 0.7).toFixed(3), 'seeded',
      '地球 0.325（PREM）；水星 0.70（Hauck et al. 2013）——取两者之间抽样');

    // 自转与转轴倾角
    var rotH = given.rotationH != null ? given.rotationH : (gasy ? 8 + rnd() * 10 : 8 + rnd() * 60);
    set('rotationHours', rotH, given.rotationH != null ? 'given' : 'seeded',
      '太阳系巨行星 9.9–17.2 h、岩质行星 23.9–5832 h（NASA）');
    var tilt = given.tiltDeg != null ? given.tiltDeg : +(rnd() * rnd() * 120).toFixed(1);
    set('obliquityDeg', tilt, given.tiltDeg != null ? 'given' : 'seeded',
      '太阳系 0.03°–177.4°（NASA）；巨撞击可给出任意倾角（Kokubo & Ida 2007）');

    // 反照率：按类型在太阳系天体的实测区间内抽样
    var albRange = { gas: [0.29, 0.35], ice: [0.4, 0.7], ocean: [0.25, 0.35], living: [0.25, 0.35], earth: [0.3, 0.32],
      desert: [0.2, 0.35], rock: [0.08, 0.25], lava: [0.04, 0.12] }[type] || [0.1, 0.4];
    set('albedo', +lerp(albRange[0], albRange[1], rnd()).toFixed(3), 'seeded',
      '取值区间取自太阳系天体的 Bond 反照率（水星 0.088、月球 0.11、火星 0.25、地球 0.306、木星 0.343、金星 0.77；NASA）');

    // 大气：先按类型与质量给"出气量"，再由逃逸判据裁剪
    var pressure = gasy ? 1 : (given.pressureRel != null ? given.pressureRel : outgassedPressure(massEarth, radiusRel, type, rnd));
    var mix = atmosphereMix(type, aAU, snow, fGas, rnd);
    set('surfacePressureBar', +Number(pressure).toPrecision(4), gasy ? 'seeded' : (given.pressureRel != null ? 'given' : 'seeded'),
      gasy ? '巨行星没有固体表面：与 NASA 表一样取 1 bar 参考面'
        : '出气量按硅酸盐挥发分标度（Elkins-Tanton 2008）；随后由 Jeans 逃逸与 cosmic shoreline 判据裁剪',
      gasy ? '1 bar 参考面（没有固体表面）' : '');
    set('atmosphere', mix, 'seeded', 'Catling & Kasting 2017 第 6–11 章（岩质行星大气成分的可能路径）');

    var water = type === 'ocean' || type === 'living' ? Math.exp(lerp(Math.log(0.3), Math.log(60), rnd()))
      : type === 'earth' ? 1
        : type === 'ice' ? Math.exp(lerp(Math.log(1), Math.log(200), rnd()))
          : type === 'desert' ? Math.exp(lerp(Math.log(1e-4), Math.log(0.05), rnd()))
            : gasy ? 0 : Math.exp(lerp(Math.log(1e-6), Math.log(0.01), rnd()));
    set('waterOceans', +Number(water).toPrecision(3), 'seeded',
      '系外行星含水量没有直接观测约束；地球 1 单位 = 1.4×10²¹ kg（Tian & Ida 2015 的吸积模拟给出很宽的分布）');
    set('radiogenicRel', +lerp(0.4, 2.0, rnd()).toFixed(2), 'seeded',
      '恒星 Th/Eu、U/Si 弥散约 ±0.3 dex（Unterborn et al. 2015, ApJ 806, 139）');

    var ageGyr = given.ageGyr != null ? given.ageGyr : star.ageGyr;
    set('ageGyr', +Number(clamp(ageGyr, 0, 13.8)).toPrecision(3), given.ageGyr != null ? 'given' : 'seeded', '取恒星年龄');

    // 磁场指数（heuristic）：导电核 + 自转 + 尚未冷透
    var rotFac = clamp(30 / Math.max(Math.abs(rotH), 1), 0, 1);
    var coreFac = clamp(P.coreMassFrac / 0.325, 0, 1.5);
    var heatFac = clamp(radiogenicHeatFlux(massEarth, radiusRel, P.radiogenicRel, P.ageGyr) / EARTH_HEATFLOW, 0, 2);
    var mIdx = gasy ? clamp(0.8 + 0.2 * rnd(), 0, 1) : clamp01(0.9 * rotFac * Math.min(coreFac, 1) * Math.min(heatFac, 1.2) * lerp(0.7, 1.3, rnd()));
    set('magneticIndex', +mIdx.toFixed(3), 'seeded',
      'Christensen 2010 的发电机标度指出场强主要由核内热流决定；此处的 0–1 指数是本引擎的启发式合成（核质量分数 × 自转 × 内部热流）');

    P.kind = gasy ? 'gas' : type === 'ice' ? 'ice' : 'rock';
    P.type = type; P.real = false;
    P._areaM2 = 4 * Math.PI * Math.pow(radiusRel * R_E, 2);
    P.moonCount = given.moonCount != null ? given.moonCount : 0;
    P.hasRings = !!given.hasRings;
    P.moonNames = given.moonNames || null;
    return P;
  }

  function normalizeMix(mix) {
    var out = {}, s = 0, k;
    for (k in mix) if (mix[k] > 0) s += mix[k];
    if (!(s > 0)) return {};
    for (k in mix) if (mix[k] > 0) out[k] = mix[k] / s;
    return out;
  }
  /** Chen & Kipping 2017（Forecaster）中位关系：log10 R = C + S·log10 M（R⊕, M⊕） */
  function radiusFromMass(m) {
    if (m <= 0) return 0;
    if (m < 2.04) return Math.pow(10, 0.00346 + 0.2790 * log10(m));
    if (m < 131.6) return Math.pow(10, -0.0925 + 0.589 * log10(m));
    return Math.pow(10, 1.25 - 0.044 * log10(m));
  }
  function massFromRadius(r) {
    if (r <= 0) return 0;
    if (r < 1.2297) return Math.pow(10, (log10(r) - 0.00346) / 0.2790);
    if (r < 14.32) return Math.pow(10, (log10(r) + 0.0925) / 0.589);
    return 131.6;
  }
  /** 出气量：挥发分总量 ∝ 行星质量，摊到表面积上 → P ∝ M/R²（Elkins-Tanton 2008 的量级） */
  function outgassedPressure(m, r, type, rnd) {
    if (type === 'gas') return 1;
    var base = (m / (r * r)) * Math.exp(lerp(Math.log(0.01), Math.log(30), rnd()));
    return clamp(base, 0, 3000);
  }
  function atmosphereMix(type, aAU, snow, fGas, rnd) {
    if (type === 'gas') return normalizeMix({ H2: 0.86 + 0.06 * rnd(), He: 0.1 + 0.04 * rnd(), CH4: 0.003 + 0.02 * rnd() });
    if (type === 'ice') return normalizeMix({ N2: 0.6 + 0.3 * rnd(), CH4: 0.02 + 0.2 * rnd(), CO2: 0.05 * rnd(), Ar: 0.05 * rnd() });
    if (type === 'living' || type === 'earth') return normalizeMix({ N2: 0.6 + 0.25 * rnd(), O2: 0.05 + 0.2 * rnd(), CO2: 0.0005 + 0.02 * rnd(), Ar: 0.01 * rnd(), CH4: 1e-5 });
    if (type === 'ocean') return normalizeMix({ N2: 0.5 + 0.4 * rnd(), CO2: 0.02 + 0.3 * rnd(), Ar: 0.02 * rnd(), CH4: 1e-4 });
    if (type === 'lava') return normalizeMix({ CO2: 0.6 + 0.3 * rnd(), N2: 0.05 + 0.2 * rnd(), H2O: 0.05 * rnd() });
    return normalizeMix({ CO2: 0.5 + 0.45 * rnd(), N2: 0.03 + 0.3 * rnd(), Ar: 0.05 * rnd() });
  }
  /** 放射性产热的地表热流 [W/m²]：H(t) = ΣH_i·2^{(t⊕−t)/T_i}，按质量与表面积标度 */
  function radiogenicHeatFlux(mEarth, rEarth, fRadio, ageGyr) {
    var tw = 0;
    for (var i = 0; i < RADIO.length; i++) tw += RADIO[i].now * Math.pow(2, (EARTH_AGE_GYR - ageGyr) / RADIO[i].halfGyr);
    var earthNow = 0;
    for (i = 0; i < RADIO.length; i++) earthNow += RADIO[i].now;
    var relPower = (tw / earthNow) * (fRadio || 1) * mEarth;          // 产热 ∝ 幔质量
    return EARTH_HEATFLOW * relPower / Math.max(rEarth * rEarth, 1e-6);  // 摊到表面积
  }

  // ============================================================
  // evaluate —— 真算 + 判定 + 报告
  // ============================================================
  function evaluate(params, star, uc) {
    var t0 = (typeof process !== 'undefined' && process.hrtime) ? process.hrtime() : null;
    var tms0 = Date.now();
    star = normStar(star); uc = normUC(uc);
    var derived = {}, order = [], F = [];
    function D(key, o) { o.key = key; derived[key] = o; order.push(key); return o.value; }

    var M = (params.massEarth || 0) * M_E, R = (params.radiusEarth || 0) * R_E;
    var aAU = params.orbitAU || 1, a = aAU * AU_M, e = params.ecc || 0;
    var mix = params.atmosphere || {}, P0 = params.surfacePressureBar || 0;
    var kind = params.kind || (params.gasFrac > 0.1 ? 'gas' : 'rock');
    var safeR = Math.max(R, 1), safeM = Math.max(M, 1);

    // ---------- 本体：重力 / 逃逸速度 / 密度 ----------
    var g = G_N * safeM / (safeR * safeR);
    D('gravity', { name: '表面重力', symbol: 'g', unit: 'm/s²', value: g, text: trimNum(g, 4) + ' m/s²（' + trimNum(g / G_E, 3) + ' g⊕）',
      basis: 'computed', formula: 'g = GM/R²（球对称牛顿引力；G = 6.67430×10⁻¹¹ m³kg⁻¹s⁻²，CODATA 2018）',
      inputs: { M: M, R: R }, ref: 'CODATA 2018；' + FACTSHEET_REF + '（NASA 表列的是赤道口径且含自转离心项，快转天体会差几个百分点）' });
    var vesc = Math.sqrt(2 * G_N * safeM / safeR);
    D('escapeVelocity', { name: '逃逸速度', symbol: 'v_esc', unit: 'km/s', value: vesc / 1000, text: trimNum(vesc / 1000, 4) + ' km/s',
      basis: 'computed', formula: 'v_esc = √(2GM/R)', inputs: { M: M, R: R }, ref: 'CODATA 2018' });
    var rho = safeM / (4 / 3 * Math.PI * safeR * safeR * safeR);
    D('density', { name: '平均密度', symbol: 'ρ', unit: 'kg/m³', value: rho, text: Math.round(rho) + ' kg/m³',
      basis: 'computed', formula: 'ρ = M/(4πR³/3)', inputs: { M: M, R: R },
      ref: FACTSHEET_REF + '（对照：土星 687、木星 1326、天王星 1270、火星 3934、地球 5514 kg/m³）' });
    var compo = rho > 4500 ? '岩铁（富铁核）' : rho > 3000 ? '硅酸盐岩质' : rho > 1800 ? '岩石 + 冰' : rho > 900 ? '冰 / 含厚包层' : 'H/He 主导';
    D('composition', { name: '成分推断', symbol: '—', unit: '', value: rho, text: compo + '（岩铁 ' + Math.round((params.rockFrac || 0) * 100) + '% / 冰 ' + Math.round((params.iceFrac || 0) * 100) + '% / 气 ' + Math.round((params.gasFrac || 0) * 100) + '%）',
      basis: 'scaling', formula: '按平均密度与太阳系天体对照分档；质量分数取自输入参数',
      inputs: { rho: rho }, ref: 'Zeng, Sasselov & Jacobsen 2016, ApJ 819, 127' });

    // ---------- 轨道：开普勒周期 / 辐照 / 希尔球 / 洛希极限 ----------
    var periodS = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / (G_N * (star.massKg + M)));
    var periodYr = periodS / YR_S;
    D('period', { name: '公转周期', symbol: 'P', unit: '年', value: periodYr, text: fmtTimeYr(periodYr),
      basis: 'computed', formula: 'P = 2π√(a³/(G(M★+M_p)))（开普勒第三定律）', inputs: { a: a, Mstar: star.massKg }, ref: 'Newton 1687；IAU 2012（AU 定义值）' });
    var S_Wm2 = star.lumW / (4 * Math.PI * a * a);
    var S_rel = S_Wm2 / (L_SUN / (4 * Math.PI * AU_M * AU_M));
    D('insolation', { name: '辐照', symbol: 'S', unit: 'W/m²', value: S_Wm2, text: trimNum(S_Wm2, 4) + ' W/m²（' + trimNum(S_rel, 3) + ' S⊕）',
      basis: 'computed', formula: 'S = L★/(4πa²)；地球处 1361 W/m²（太阳常数）', inputs: { L: star.lumW, a: a }, ref: 'Kopp & Lean 2011（太阳常数 1360.8±0.5 W/m²）' });
    var rHill = a * (1 - e) * Math.pow(M / (3 * star.massKg), 1 / 3);
    D('hillRadius', { name: '希尔球半径', symbol: 'R_H', unit: 'km', value: rHill / 1000, text: sci(rHill / 1000, 3) + ' km（' + trimNum(rHill / safeR, 3) + ' R_p）',
      basis: 'computed', formula: 'R_H = a(1−e)·(M_p/3M★)^{1/3}；顺行卫星大致稳定在 0.5 R_H 以内',
      inputs: { a: a, e: e, M: M, Mstar: star.massKg }, ref: 'Hamilton & Burns 1992, Icarus 96, 43' });
    var rocheMoon = 2.44 * safeR * Math.pow(rho / 3000, 1 / 3);
    D('rocheLimit', { name: '洛希极限（流体卫星）', symbol: 'd_R', unit: 'km', value: rocheMoon / 1000, text: sci(rocheMoon / 1000, 3) + ' km（' + trimNum(rocheMoon / safeR, 3) + ' R_p）',
      basis: 'computed', formula: 'd = 2.44R(ρ_p/ρ_m)^{1/3}（流体卫星，ρ_m = 3000 kg/m³ 取岩质卫星；刚体式系数为 1.26）',
      inputs: { R: R, rho: rho }, ref: 'Roche 1849；Chandrasekhar 1969' });
    var rocheStar = 2.44 * star.radiusM * Math.pow((star.massKg / (4 / 3 * Math.PI * Math.pow(star.radiusM, 3))) / rho, 1 / 3);

    // ---------- 温度：平衡温度 → 灰大气温室 ----------
    var A = clamp(params.albedo != null ? params.albedo : 0.3, 0, 0.99);
    var Teq = star.tempK * Math.sqrt(star.radiusM / (2 * a)) * Math.pow(1 - A, 0.25);
    D('equilibriumTemp', { name: '平衡温度', symbol: 'T_eq', unit: 'K', value: Teq, text: trimNum(Teq, 4) + ' K',
      basis: 'computed', formula: 'T_eq = T★√(R★/2a)(1−A_B)^{1/4}（等价于 σT⁴ = S(1−A)/4，全球均匀再辐射）',
      inputs: { Tstar: star.tempK, Rstar: star.radiusM, a: a, A: A },
      ref: FACTSHEET_REF + '（Black-body temperature 一列；本式对八大行星复现到 1% 以内）' });
    var gh = solveSurfaceT(Teq, params, g);
    var Ts = gh.Ts;
    D('greenhouseTau', { name: '灰大气光学厚度', symbol: 'τ', unit: '', value: gh.tau, text: trimNum(gh.tau, 3) + (gh.tau > 0 ? '（CO₂ ' + trimNum(gh.tauParts.CO2 || 0, 3) + ' / H₂O ' + trimNum(gh.tauParts.H2O || 0, 3) + ' / CH₄ ' + trimNum(gh.tauParts.CH4 || 0, 3) + '）' : ''),
      basis: 'scaling', formula: 'τ_i = k_i·p̃_i^' + TAU_A.toFixed(3) + '·P̃^' + TAU_B.toFixed(3) + '（p̃、P̃ 为折算到地球重力的分压/总压，bar）——形式取自强线曲线生长律 τ ∝ √(u·γ)，u∝p/g、γ∝P；k 与指数用金星 737 K、地球 288 K、火星温室 +5 K 三点定标。地球 τ=0.87，其中 H₂O+云 75%、CO₂ 20%、CH₄/O₃/N₂O 5%',
      inputs: { P0: P0, mix: mix, g: g },
      ref: 'Schmidt et al. 2010, JGR 115, D20106（地球温室归因）；Haberle 2013, Icarus 223, 619（火星）；Pierrehumbert 2010《Principles of Planetary Climate》§4（曲线生长律）' });
    D('surfaceTemp', { name: '表面温度', symbol: 'T_s', unit: 'K', value: Ts, text: trimNum(Ts, 4) + ' K（' + trimNum(Ts - 273.15, 3) + ' ℃）' + (gh.runaway ? '，失控温室' : gh.diverged ? '，已越出灰大气模型的适用范围' : ''),
      basis: 'scaling', formula: 'T_s = T_eq(1+¾τ)^{1/4}（灰大气 Eddington 近似）；水汽分压由 Clausius–Clapeyron 与含水量自洽迭代（正反馈）',
      inputs: { Teq: Teq, tau: gh.tau }, ref: 'Catling & Kasting 2017 §13；Kasting 1988, Icarus 74, 472（失控温室）' });
    var Tobs = params.meta && params.meta.surfaceTempK ? null : null;
    var realT = params.solarKey && SOLAR[params.solarKey] ? SOLAR[params.solarKey].tSurfK : null;

    F.push(makeFinding({ id: 'PL_TEMP', title: '温度：平衡温度与温室增温', basis: 'scaling',
      formula: 'T_eq = T★√(R★/2a)(1−A)^{1/4}；T_s = T_eq(1+¾τ)^{1/4}',
      inputs: { Teq: Teq, tau: gh.tau, Ts: Ts }, value: Ts,
      valueText: 'T_eq=' + trimNum(Teq, 4) + ' K，τ=' + trimNum(gh.tau, 3) + '，T_s=' + trimNum(Ts, 4) + ' K（增温 ' + trimNum(Ts - Teq, 3) + ' K）',
      threshold: '失控温室：水汽项主导且水全部进入大气、T_s > 647 K（水的临界温度）',
      verdict: gh.runaway ? 'bad' : (Ts > 1200 ? 'bad' : 'ok'),
      text: (gh.runaway ? '水汽正反馈没有收敛：这是一次失控温室，海洋全部进入大气。'
        : gh.diverged ? '灰大气解越出了模型的适用范围（T_s > 1500 K）：这么厚的大气要用非灰、对流调整的模型才算得准，这里的数只标出量级。'
          : '灰大气模型给出的增温为 ' + trimNum(Ts - Teq, 3) + ' K。')
        + (realT != null ? '实测平均温度 ' + realT + ' K（NASA）' + (Math.abs(realT - Ts) > 15 ? '，与模型相差 ' + Math.round(Math.abs(realT - Ts)) + ' K' + (kind !== 'rock' ? '——巨行星的 1 bar 温度由内部热流与 H₂–H₂ 碰撞诱导吸收决定，本灰大气模型不含这两项' : '') : '') + '。' : ''),
      ref: 'Catling & Kasting 2017 §13；' + FACTSHEET_REF }));

    // ---------- 大气逃逸：Jeans 参数 ----------
    var exoF = P0 > 0 ? ((mix.H2 || 0) + (mix.He || 0) > 0.5 ? EXO_F_H2 : (mix.CO2 || 0) > 0.5 ? EXO_F_CO2 : EXO_F_N2) : 1;
    var Texo = Math.max(Teq * exoF, Ts);
    D('exobaseTemp', { name: '外逸层温度', symbol: 'T_exo', unit: 'K', value: Texo, text: Math.round(Texo) + ' K',
      basis: 'heuristic', formula: 'T_exo ≈ f·T_eq，f = 8.0（H₂/He 主导）/ 3.9（N₂/O₂）/ 1.2（CO₂ 主导，15 μm 带强烈致冷）——用地球 ~1000 K、火星 ~200 K、金星 ~275 K、木星 ~900 K 的实测外逸层温度定标',
      inputs: { Teq: Teq, dominant: dominantGas(mix) }, ref: 'Catling & Kasting 2017 §5.3；Bougher et al. 2002（金星/火星热层）' });
    var jeans = {}, retained = [], escaping = [];
    for (var gi = 0; gi < GAS_ORDER.length; gi++) {
      var gk = GAS_ORDER[gi], m_i = GASES[gk].mu * AMU;
      var lam = G_N * safeM * m_i / (KB * Texo * safeR);
      jeans[gk] = lam;
      if (lam >= 30) retained.push(GASES[gk].name); else escaping.push(GASES[gk].name);
    }
    D('jeans', { name: 'Jeans 逃逸参数', symbol: 'λ', unit: '', value: jeans.N2, text: GAS_ORDER.map(function (k) { return k + ' ' + trimNum(jeans[k], 3); }).join('，'),
      basis: 'computed', formula: 'λ = GMm/(kT_exo R)（分子热能与引力束缚之比）；λ≳30 → 10 Gyr 尺度上保留，λ≲15 → 快速逃逸',
      inputs: { M: M, R: R, Texo: Texo }, ref: 'Jeans 1925；Catling & Kasting 2017 §5.9（阈值 λ≈25–30 对应 Gyr 量级的逃逸时标）' });
    F.push(makeFinding({ id: 'PL_JEANS', title: '大气逃逸：哪些气体留得住', basis: 'computed',
      formula: 'λ = GMm/(kT_exo R)；判据 λ≥30 保留 / λ<15 快速逃逸（Catling & Kasting 2017 §5.9）',
      inputs: jeans, value: jeans.N2, valueText: '保留：' + (retained.join('、') || '无') + '；逃逸：' + (escaping.join('、') || '无'),
      threshold: 'λ ≥ 30', verdict: retained.length === 0 ? 'bad' : (jeans.N2 < 30 ? 'warn' : 'ok'),
      text: retained.length === 0 ? '任何常见气体都留不住，这是一颗裸露的星球。'
        : (jeans.N2 >= 30 ? '氮、氧一级的分子可以保留' + (jeans.H2 < 30 ? '，氢与氦会持续逃逸' : '，连氢也留得住') + '。' : '只有最重的分子勉强留住，大气会持续变薄。'),
      ref: 'Catling & Kasting 2017《Atmospheric Evolution on Inhabited and Lifeless Worlds》§5' }));

    // ---------- cosmic shoreline ----------
    var vescKms = vesc / 1000;
    var Icrit = SHORELINE_C * Math.pow(vescKms, 4);
    F.push(makeFinding({ id: 'PL_SHORELINE', title: 'Cosmic shoreline：辐照与逃逸速度的分界', basis: 'scaling',
      formula: 'I_crit/I⊕ = C·(v_esc[km/s])⁴（Zahnle & Catling 2017 的经验分界 I_XUV ∝ v_esc⁴）；C = 4×10⁻³ 用太阳系六个天体定标（金星/地球/火星/土卫六 有大气，水星/月球 无），并以总辐照代替累计 XUV',
      inputs: { S_rel: S_rel, vesc: vescKms }, value: S_rel / Math.max(Icrit, 1e-12),
      valueText: 'S=' + trimNum(S_rel, 3) + ' S⊕，分界 ' + trimNum(Icrit, 3) + ' S⊕',
      threshold: 'S < I_crit 才可能保住大气', verdict: S_rel > Icrit ? (P0 > 0.01 ? 'warn' : 'bad') : 'ok',
      text: S_rel > Icrit ? '位于分界线的"无大气"一侧：恒星风与 XUV 的累计剥蚀足以吹光原生大气。' : '位于分界线的"有大气"一侧：引力足以对抗累计的 XUV 剥蚀。',
      ref: 'Zahnle & Catling 2017, ApJ 843, 122' }));

    // ---------- 潮汐锁定 ----------
    var Q = kind === 'gas' ? TIDE_Q_GAS : TIDE_Q_ROCK, k2 = kind === 'gas' ? TIDE_K2_GAS : TIDE_K2_ROCK;
    var I = 0.4 * safeM * safeR * safeR;
    var tLockS = TIDE_OMEGA_I * Math.pow(a, 6) * I * Q / (3 * G_N * star.massKg * star.massKg * k2 * Math.pow(safeR, 5));
    var tLockYr = tLockS / YR_S, ageYr = ageGyrOf(params, star) * 1e9;   // #13：ageGyr===0 是合法值，不能被 || 当作缺失
    D('tidalLock', { name: '潮汐锁定时标', symbol: 't_lock', unit: '年', value: tLockYr, text: fmtTimeYr(tLockYr),
      basis: 'computed', formula: 't_lock = ω_i a⁶ I Q /(3 G M★² k₂ R⁵)，I = 0.4MR²，ω_i = 2π/13.5 h（吸积末期自转），Q/k₂ = ' + Q + '/' + k2 + (kind === 'gas' ? '（巨行星）' : '（岩质）'),
      inputs: { a: a, M: M, R: R, Mstar: star.massKg, Q: Q, k2: k2 },
      ref: 'Gladman et al. 1996, Icarus 122, 166；Q、k₂ 为假定值（地球固体 Q≈100、k₂≈0.3；木星 Q≈3×10⁴、k₂≈0.59，Lainey et al. 2009）' });
    F.push(makeFinding({ id: 'PL_TIDAL', title: '自转：潮汐锁定', basis: 'computed',
      formula: 't_lock = ω_i a⁶ I Q/(3G M★² k₂ R⁵)（Gladman et al. 1996）', inputs: { tLockYr: tLockYr, ageYr: ageYr },
      value: tLockYr, valueText: 't_lock=' + fmtTimeYr(tLockYr) + '，年龄=' + fmtTimeYr(ageYr),
      threshold: 't_lock < 年龄 → 已锁定', verdict: tLockYr < ageYr ? 'warn' : 'ok',
      text: tLockYr < ageYr ? '锁定时标远短于年龄，它多半已经被潮汐锁定：一面永昼、一面永夜（除非落入 3:2 之类的自旋轨道共振，如水星）。'
        : '锁定时标长于年龄，自转不会被恒星潮汐锁定。',
      ref: 'Gladman et al. 1996, Icarus 122, 166；Peale 1969（自旋轨道共振）' }));

    // ---------- 日长 ----------
    var rotS = (params.rotationHours != null && isFinite(params.rotationHours) ? params.rotationHours : 24) * HOUR_S;   // #13：0 = 不自转，不是缺失
    var solarDayS = Math.abs(rotS) < 1e-6 ? Infinity : 1 / (1 / rotS - 1 / periodS);
    if (tLockYr < ageYr && ageYr > 0) solarDayS = periodS;    // 已锁定 → 恒星日 = 公转周期
    D('solarDay', { name: '日长（太阳日）', symbol: 'T_syn', unit: 'h', value: Math.abs(solarDayS) / HOUR_S,
      text: isFinite(solarDayS) ? trimNum(Math.abs(solarDayS) / HOUR_S, 4) + ' h（自转周期 ' + trimNum(Math.abs(params.rotationHours || 0), 4) + ' h' + ((params.rotationHours || 0) < 0 ? '，逆行' : '') + '）' : '永昼/永夜',
      basis: 'computed', formula: '1/T_syn = 1/T_rot − 1/T_orb（会合周期；逆行自转取负 T_rot）；潮汐锁定后 T_syn = T_orb',
      inputs: { rotH: params.rotationHours, periodYr: periodYr }, ref: FACTSHEET_REF + '（Length of day 一列：金星 2802 h、水星 4222.6 h）' });

    // ---------- 季节 ----------
    var eps = (params.obliquityDeg || 0) * Math.PI / 180;
    var seas = seasonAmplitude(eps);
    D('season', { name: '季节幅度（45° 纬度）', symbol: 'ΔT_季', unit: '', value: seas.ratio,
      text: '夏至/冬至日均辐照比 ' + (isFinite(seas.ratio) ? trimNum(seas.ratio, 3) : '∞') + '，无热惯量时地表温度比 ' + trimNum(seas.tRatio, 3),
      basis: 'computed', formula: '日均辐照 Q̄ = (S/π)(h₀ sinφ sinδ + cosφ cosδ sin h₀)，h₀ = arccos(−tanφ tanδ)，φ=45°、δ=±ε；温度按 T ∝ Q̄^{1/4}',
      inputs: { obliquity: params.obliquityDeg }, ref: 'Berger 1978, J. Atmos. Sci. 35, 2362；海洋热惯量会把实际振幅压到这个上限的一半以下（地球中纬度实测约 25 K）' });
    var seasonHarsh = eps * 180 / Math.PI > 54 || seas.tRatio > 1.8;
    F.push(makeFinding({ id: 'PL_SEASON', title: '季节：转轴倾角', basis: 'computed',
      formula: 'Berger 1978 的日均辐照公式，φ=45°、δ=±ε', inputs: { eps: params.obliquityDeg },
      value: seas.tRatio, valueText: 'ε=' + trimNum(params.obliquityDeg || 0, 3) + '°，夏冬地表温度比 ' + trimNum(seas.tRatio, 3),
      threshold: 'ε > 54° 时极区年均辐照超过赤道', verdict: seasonHarsh ? 'warn' : 'ok',
      text: seasonHarsh ? '倾角很大，季节极端：高纬度在一年里既是最热也是最冷的地方（天王星的 97.8° 是极端例子）。'
        : (Math.abs(eps) < 0.05 ? '几乎没有转轴倾角，也就几乎没有季节。' : '倾角温和，季节变化在辐射平衡上限内约 ' + trimNum((seas.tRatio - 1) * 100, 2) + '%。'),
      ref: 'Berger 1978；Ward 1974（倾角混沌与卫星的稳定作用）' }));

    // ---------- 液态水与其它溶剂 ----------
    var pSurfPa = P0 * 1e5;
    var tBoil = boilingT(pSurfPa);
    var liquidWater = pSurfPa > H2O_TRIPLE_P && Ts > H2O_TRIPLE_T && tBoil != null && Ts < tBoil && Ts < H2O_CRIT_T && (params.waterOceans || 0) > 0;
    D('waterWindow', { name: '液态水窗口', symbol: '—', unit: '', value: liquidWater ? 1 : 0,
      text: pSurfPa <= H2O_TRIPLE_P ? '气压 ' + trimNum(pSurfPa, 3) + ' Pa 低于三相点 611.657 Pa：水只能在冰与汽之间转换'
        : (Ts <= H2O_TRIPLE_T ? '表面 ' + trimNum(Ts, 4) + ' K 低于 273.16 K：水以冰的形式存在'
          : (Ts >= (tBoil || H2O_CRIT_T) ? '表面 ' + trimNum(Ts, 4) + ' K 高于该气压下的沸点 ' + trimNum(tBoil || H2O_CRIT_T, 4) + ' K：水只能是蒸汽'
            : ((params.waterOceans || 0) > 0 ? '液态水稳定（沸点 ' + trimNum(tBoil, 4) + ' K）' : '温压落在液相区，但没有水可用'))),
      basis: 'computed', formula: '三相点 273.16 K / 611.657 Pa、临界点 647.096 K / 22.064 MPa（IAPWS-95）；沸点由 Clausius–Clapeyron 反解（三相点与常压沸点两点定标，0.006–1 bar 内误差 <1 K）',
      inputs: { P0: P0, Ts: Ts, water: params.waterOceans }, ref: 'IAPWS-95（Wagner & Pruß 2002）' });
    var solvents = [];
    for (var si = 0; si < SOLVENTS.length; si++) {
      var sv = SOLVENTS[si];
      if (Ts > sv.low && Ts < sv.high) solvents.push(sv.name);
    }
    D('solvents', { name: '常压下可能的液态溶剂', symbol: '—', unit: '', value: solvents.length,
      text: solvents.length ? solvents.join('、') + '（在 1 bar 下为液态）' : '在 1 bar 下没有常见溶剂能保持液态',
      basis: 'computed', formula: '把 T_s 与各溶剂在 1 atm 下的熔点/沸点区间比较：水 273–373 K、氨 195–240 K、乙烷 90–185 K、甲烷 91–112 K、氮 63–77 K',
      inputs: { Ts: Ts }, ref: 'CRC Handbook of Chemistry and Physics；土卫六表面 94 K 有甲烷/乙烷湖（Stofan et al. 2007）' });
    F.push(makeFinding({ id: 'PL_WATER', title: '液态水', basis: 'computed',
      formula: '水的相图（IAPWS-95）：P > 611.657 Pa 且 273.16 K < T_s < T_沸(P) < 647.096 K',
      inputs: { P0: P0, Ts: Ts }, value: liquidWater ? 1 : 0,
      valueText: liquidWater ? '有（沸点 ' + trimNum(tBoil, 4) + ' K）' : '无',
      threshold: '三相点 611.657 Pa / 273.16 K', verdict: liquidWater ? 'ok' : (solvents.length ? 'warn' : 'bad'),
      text: derived.waterWindow.text + (solvents.length && !liquidWater ? '；不过 ' + solvents.join('、') + ' 在这个温度下可以是液体。' : '。'),
      ref: 'IAPWS-95；Catling & Kasting 2017 §13' }));

    // ---------- 宜居带 ----------
    var hzIn = hzEdge(HZ_COEF.moistGreenhouse, star.tempK, star.lumRel);
    var hzOut = hzEdge(HZ_COEF.maxGreenhouse, star.tempK, star.lumRel);
    var hzInOpt = hzEdge(HZ_COEF.recentVenus, star.tempK, star.lumRel);
    var hzOutOpt = hzEdge(HZ_COEF.earlyMars, star.tempK, star.lumRel);
    var inHZ = aAU >= hzIn.dAU && aAU <= hzOut.dAU, inHZopt = aAU >= hzInOpt.dAU && aAU <= hzOutOpt.dAU;
    D('habitableZone', { name: '宜居带', symbol: 'd_HZ', unit: 'AU', value: hzIn.dAU,
      text: '保守 ' + trimNum(hzIn.dAU, 3) + '–' + trimNum(hzOut.dAU, 3) + ' AU，宽松 ' + trimNum(hzInOpt.dAU, 3) + '–' + trimNum(hzOutOpt.dAU, 3) + ' AU；本行星 ' + trimNum(aAU, 3) + ' AU',
      basis: 'computed', formula: 'S_eff = S⊙ + aT★ + bT★² + cT★³ + dT★⁴（T★ = T_eff − 5780 K），d = √(L/S_eff)；保守边界取湿温室（内）与最大温室（外），宽松边界取"近期金星"与"早期火星"。对太阳复现 0.99 / 1.70 / 0.75 / 1.77 AU',
      inputs: { Teff: star.tempK, L: star.lumRel, a: aAU }, ref: 'Kopparapu et al. 2013, ApJ 765, 131（含 2013 勘误）；适用范围 2600 K ≤ T_eff ≤ 7200 K' });
    F.push(makeFinding({ id: 'PL_HZ', title: '宜居带位置', basis: 'computed',
      formula: 'Kopparapu et al. 2013 的 S_eff(T_eff) 四次多项式', inputs: { a: aAU, inner: hzIn.dAU, outer: hzOut.dAU },
      value: aAU, valueText: trimNum(aAU, 3) + ' AU（保守带 ' + trimNum(hzIn.dAU, 3) + '–' + trimNum(hzOut.dAU, 3) + ' AU）',
      threshold: '保守带内为 ok，只在宽松带内为 warn', verdict: inHZ ? 'ok' : inHZopt ? 'warn' : 'bad',
      text: inHZ ? '落在保守宜居带内。' : inHZopt ? '落在宽松宜居带内、保守带之外（地球本身就只比湿温室内边界远 1%，Kopparapu 2013 指出过这一点）。'
        : (aAU < hzInOpt.dAU ? '比宜居带内边界更靠近恒星。' : '比宜居带外边界更远。'),
      ref: 'Kopparapu et al. 2013, ApJ 765, 131' }));

    // ---------- 内部热与地质活动 ----------
    var heatFlux = radiogenicHeatFlux(params.massEarth || 0, params.radiusEarth || 1, params.radiogenicRel || 1, ageGyrOf(params, star));   // #13
    var tectonic = clamp01(heatFlux / EARTH_HEATFLOW * clamp(Math.pow(params.massEarth || 1, 0.3), 0.3, 2) * (kind === 'rock' ? 1 : 0.2));
    D('heatFlux', { name: '放射性地表热流', symbol: 'q', unit: 'W/m²', value: heatFlux, text: trimNum(heatFlux, 3) + ' W/m²（地球现今 0.0865）',
      basis: 'computed', formula: 'H(t) = Σ H_i·2^{(4.54−t)/T_{1/2,i}}（²³⁸U 8.0 TW/4.468 Gyr、²³⁵U 0.4/0.704、²³²Th 8.0/14.05、⁴⁰K 4.0/1.248），产热 ∝ 幔质量、热流 = H/(4πR²)',
      inputs: { age: params.ageGyr, mass: params.massEarth, fRadio: params.radiogenicRel },
      ref: 'Turcotte & Schubert《Geodynamics》表 4-2；Davies & Davies 2010（地球总热流 47 TW）' });
    D('tectonics', { name: '地质活动指数', symbol: 'I_tec', unit: '0–1', value: tectonic, text: trimNum(tectonic, 3) + '（' + (tectonic > 0.7 ? '活跃' : tectonic > 0.3 ? '中等' : tectonic > 0.05 ? '微弱' : '已冷透') + '）',
      basis: 'heuristic', formula: '按热流相对地球值 × 质量的 0.3 次方合成的 0–1 指数：热流决定对流强度，质量决定散热路径长度。板块构造能否启动至今没有定论',
      inputs: { heatFlux: heatFlux }, ref: 'Korenaga 2010, ApJ 725, L43；Valencia et al. 2007（超级地球的板块构造仍有争议）' });

    // ---------- 磁场与大气保留 ----------
    var mIdx = params.magneticIndex || 0;
    F.push(makeFinding({ id: 'PL_MAGNET', title: '磁场与大气保留', basis: 'heuristic',
      formula: '磁场指数由导电核质量分数 × 自转 × 内部热流合成；对大气保留的作用按"有磁场则减少恒星风剥蚀"处理',
      inputs: { magneticIndex: mIdx, tectonics: tectonic }, value: mIdx, valueText: 'I_B=' + trimNum(mIdx, 3) + '，I_tec=' + trimNum(tectonic, 3),
      threshold: '—', verdict: mIdx > 0.3 ? 'ok' : (P0 > 0.01 ? 'warn' : 'ok'),
      text: (mIdx > 0.3 ? '有全球磁场，恒星风被挡在磁层之外。' : '没有全球磁场，大气直接暴露在恒星风中。')
        + (tectonic > 0.3 ? '地质活动仍在向大气补充气体（火山），并通过碳酸盐-硅酸盐循环调节 CO₂。' : '内部已经冷却，火山不再向大气补气。')
        + '注：磁场对大气保留的净作用有争议——磁层也会把极区的离子逃逸通道打开（Gunell et al. 2018）。',
      ref: 'Christensen 2010；Gunell et al. 2018, A&A 614, L3；Kasting & Catling 2003（碳酸盐-硅酸盐循环）' }));

    // ---------- 宇宙常数 ----------
    var mMaxRel = Math.pow(uc.alphaRel / Math.max(uc.alphaGRel, 1e-30), 1.5);
    var mMaxEarth = 385 * mMaxRel;    // 我们的宇宙：(α/α_G)^{3/2}m_p = 2.3×10²⁷ kg ≈ 385 M⊕ ≈ 1.2 M_木
    D('maxPlanetMass', { name: '行星质量上限', symbol: 'M_max', unit: 'M⊕', value: mMaxEarth, text: sci(mMaxEarth, 3) + ' M⊕（' + trimNum(mMaxEarth / 317.8, 3) + ' M_木）',
      basis: 'scaling', formula: 'M_max ≈ (α/α_G)^{3/2}·m_p（Weisskopf 1975：再重，中心压强就会压垮原子间的化学键，天体转由电子简并支撑）。我们的宇宙给出 2.3×10²⁷ kg ≈ 385 M⊕ ≈ 1.2 M_木',
      inputs: { alphaRel: uc.alphaRel, alphaGRel: uc.alphaGRel }, ref: 'Weisskopf 1975, Science 187, 605；Carr & Rees 1979, Nature 278, 605' });
    if (uc.alphaRel !== 1 || uc.alphaGRel !== 1) {
      F.push(makeFinding({ id: 'PL_CONSTANTS', title: '宇宙常数对这颗行星的影响', basis: 'scaling',
        formula: 'M_max ∝ (α/α_G)^{3/2}；分子键能与水的相图温度 ∝ Ry = ½α²mₑc²（化学的温度刻度整体缩放）',
        inputs: { alphaRel: uc.alphaRel, alphaGRel: uc.alphaGRel, meOverMpRel: uc.meOverMpRel },
        value: mMaxRel, valueText: '质量上限 ×' + trimNum(mMaxRel, 3) + '，化学温度刻度 ×' + trimNum(uc.alphaRel * uc.alphaRel * (uc.meOverMpRel || 1), 3),
        threshold: '—', verdict: (params.massEarth || 0) > mMaxEarth ? 'bad' : 'warn',
        text: '这个宇宙的 α 与 α_G 与我们的不同：行星质量上限变为 ' + sci(mMaxEarth, 3) + ' M⊕，键能与相变温度按 α²mₑ 整体缩放，因此上面所有以"K"为单位的判据在这个宇宙里都要跟着平移。',
        ref: 'Weisskopf 1975；Barrow & Tipler 1986《The Anthropic Cosmological Principle》' }));
    }
    if ((params.massEarth || 0) > mMaxEarth) {
      F.push(makeFinding({ id: 'PL_MASSMAX', title: '质量上限', basis: 'scaling',
        formula: 'M > (α/α_G)^{3/2}m_p：中心压强超过化学键的支撑能力', inputs: { mass: params.massEarth, max: mMaxEarth },
        value: params.massEarth, valueText: trimNum(params.massEarth, 4) + ' M⊕ > ' + trimNum(mMaxEarth, 4) + ' M⊕',
        threshold: 'M ≤ M_max', verdict: 'warn',
        text: '质量已经超过 Weisskopf 上限：这类天体由电子简并压支撑，再加质量半径反而会缩小（木星附近正是这个转折点）。',
        ref: 'Weisskopf 1975, Science 187, 605' }));
    }

    // ---------- 基础量的 findings ----------
    F.push(makeFinding({ id: 'PL_BODY', title: '本体：重力、逃逸速度、密度', basis: 'computed',
      formula: 'g = GM/R²；v_esc = √(2GM/R)；ρ = M/(4πR³/3)', inputs: { M: M, R: R },
      value: g, valueText: 'g=' + trimNum(g, 4) + ' m/s²，v_esc=' + trimNum(vesc / 1000, 4) + ' km/s，ρ=' + Math.round(rho) + ' kg/m³',
      threshold: '—', verdict: 'ok',
      text: '质量 ' + trimNum(params.massEarth, 4) + ' M⊕、半径 ' + trimNum(params.radiusEarth, 4) + ' R⊕，' + compo + '。',
      ref: FACTSHEET_REF + '；CODATA 2018' }));
    F.push(makeFinding({ id: 'PL_ORBIT', title: '轨道：周期、辐照、希尔球', basis: 'computed',
      formula: 'P = 2π√(a³/GM★)；S = L/(4πa²)；R_H = a(1−e)(M/3M★)^{1/3}',
      inputs: { a: aAU, e: e }, value: periodYr,
      valueText: 'a=' + trimNum(aAU, 4) + ' AU，P=' + fmtTimeYr(periodYr) + '，S=' + trimNum(S_rel, 3) + ' S⊕，R_H=' + trimNum(rHill / safeR, 3) + ' R_p',
      threshold: 'a > 洛希极限（' + trimNum(rocheStar / AU_M, 3) + ' AU）', verdict: a < rocheStar ? 'fail' : (e > 0.4 ? 'warn' : 'ok'),
      text: a < rocheStar ? '轨道在恒星的洛希极限之内：行星会被潮汐撕碎。'
        : (e > 0.4 ? '偏心率很大，近星点与远星点的辐照相差 ' + trimNum(Math.pow((1 + e) / (1 - e), 2), 3) + ' 倍。'
          : '轨道稳定，近星点与远星点的辐照相差 ' + trimNum(Math.pow((1 + e) / (1 - e), 2), 3) + ' 倍。'),
      ref: 'Newton 1687；Hamilton & Burns 1992；Roche 1849' }));

    // ---------- 宜居性 ----------
    var hab = habitability(params, star, uc, { Ts: Ts, Teq: Teq, liquidWater: liquidWater, jeans: jeans, inHZ: inHZ, inHZopt: inHZopt,
      tectonic: tectonic, magnet: mIdx, runaway: gh.runaway, tLockYr: tLockYr, ageYr: ageYr, kind: kind, P0: P0, S_rel: S_rel, Icrit: Icrit,
      solvents: solvents });   // #12：非水溶剂（氨/甲烷…）此前算了却没传进来，导致所有无水世界统一吃 0.02 惩罚
    // ---------- 生命 ----------
    var life = lifeLevel(params, star, hab.value, params.seed);
    if (hab.value != null) {
      F.push(makeFinding({ id: 'PL_LIFE', title: '生命等级', basis: 'heuristic',
        formula: '按宜居性 × 年龄的启发式门槛：地球的时间表是唯一样本（微生物 ≈0.5 Gyr、真核 ≈2 Gyr、陆生植物 ≈4.1 Gyr、动物 ≈4.0 Gyr、文明 ≈4.55 Gyr），n=1，因此这是启发式而不是统计',
        inputs: { habitability: hab.value, ageGyr: params.ageGyr }, value: life.rank,
        valueText: life.level ? life.level + '（等级 ' + life.rank + '）' : '无',
        threshold: '宜居性 ≥ 0.35 且年龄 ≥ 0.5 Gyr', verdict: life.level ? 'ok' : 'warn',
        text: life.text, ref: 'Nutman et al. 2016（37 亿年叠层石）；Knoll 2015；Carter 1983（时间尺度论证）' }));
    }

    var worst = 'ok';
    F.forEach(function (f) { if (VERDICT_ORDER[f.verdict] > VERDICT_ORDER[worst]) worst = f.verdict; });
    var report = buildReport(params, star, uc, derived, { Ts: Ts, Teq: Teq, tau: gh.tau, liquidWater: liquidWater, jeans: jeans,
      retained: retained, escaping: escaping, tLockYr: tLockYr, ageYr: ageYr, hab: hab, life: life, kind: kind, runaway: gh.runaway, diverged: gh.diverged,
      inHZ: inHZ, inHZopt: inHZopt, hzIn: hzIn.dAU, hzOut: hzOut.dAU, heatFlux: heatFlux, tectonic: tectonic, solvents: solvents, realT: realT });

    var out = {
      version: VERSION, derived: derived, derivedOrder: order, findings: F, worstVerdict: worst,
      report: report, habitability: hab.value, habitabilityDetail: hab, life: life, jeansMap: jeans,
      surfaceTempK: Ts, equilibriumTempK: Teq, tau: gh.tau, liquidWater: liquidWater, elapsedMs: 0
    };
    var lng = describeLong(params, out, star, uc);
    out.description = lng.text; out.descriptionSentences = lng.sentences; out.descriptionSource = lng.source;
    out.elapsedMs = t0 ? (function () { var d = process.hrtime(t0); return d[0] * 1000 + d[1] / 1e6; })() : (Date.now() - tms0);
    return out;
  }

  function dominantGas(mix) {
    var best = null, bv = 0;
    for (var k in mix) if (mix[k] > bv) { bv = mix[k]; best = k; }
    return best;
  }
  /** 45° 纬度处夏至/冬至的日均辐照比（Berger 1978） */
  function seasonAmplitude(eps) {
    var phi = Math.PI / 4;
    function daily(delta) {
      var x = -Math.tan(phi) * Math.tan(delta);
      var h0 = x <= -1 ? Math.PI : x >= 1 ? 0 : Math.acos(x);
      return (h0 * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(h0)) / Math.PI;
    }
    var d = Math.abs(eps) > Math.PI / 2 ? Math.PI - Math.abs(eps) : Math.abs(eps);
    var qs = daily(d), qw = daily(-d);
    var ratio = qw > 1e-9 ? qs / qw : Infinity;
    var tRatio = qw > 1e-9 ? Math.pow(qs / qw, 0.25) : Infinity;
    return { summer: qs, winter: qw, ratio: ratio, tRatio: isFinite(tRatio) ? tRatio : 99 };
  }

  // ============================================================
  // 宜居性（0–1，连乘；D≠3 时为 null）
  // ============================================================
  function habitability(params, star, uc, x) {
    if (uc.dimS !== 3) {
      return { value: null, factors: [], sentence: '空间维数 D=' + trimNum(uc.dimS, 3) + '≠3：上面所有公式都只对 3 维成立，宜居性不给数。' };
    }
    var f = [], h = 1;
    function mul(name, v, why) { f.push({ name: name, value: v, why: why }); h *= v; return v; }
    mul('液态水', x.liquidWater ? 1 : (x.solvents && x.solvents.length ? 0.05 : 0.02), x.liquidWater ? '表面温压落在水的液相区' : '表面没有液态水');
    mul('大气保留', x.jeans.N2 >= 30 ? (x.P0 > 0.01 ? 1 : 0.15) : 0.05, x.jeans.N2 >= 30 ? (x.P0 > 0.01 ? 'λ(N₂)≥30 且有可观气压' : 'λ 够大但几乎没有大气') : 'N₂ 都留不住');
    mul('温度窗口', x.Ts > 250 && x.Ts < 350 ? 1 : x.Ts > 220 && x.Ts < 400 ? 0.5 : 0.05, '表面 ' + trimNum(x.Ts, 4) + ' K');
    mul('气候未失控', x.runaway ? 0.02 : 1, x.runaway ? '水汽正反馈失控' : '气候未失控');
    mul('宜居带', x.inHZ ? 1 : x.inHZopt ? 0.7 : 0.15, x.inHZ ? '在保守宜居带内' : x.inHZopt ? '只在宽松宜居带内' : '在宜居带之外');
    mul('抗恒星风剥蚀', x.S_rel <= x.Icrit ? 1 : 0.3, x.S_rel <= x.Icrit ? '在 cosmic shoreline 的有大气一侧' : '在无大气一侧');
    mul('岩质表面', x.kind === 'rock' ? 1 : 0.05, x.kind === 'rock' ? '有固体表面' : '没有固体表面');
    mul('地质活动', clamp(0.4 + 0.6 * x.tectonic, 0.4, 1), '地质活动指数 ' + trimNum(x.tectonic, 3) + '（碳酸盐-硅酸盐循环需要火山与风化）');
    mul('自转未被锁定', x.tLockYr < x.ageYr ? 0.6 : 1, x.tLockYr < x.ageYr ? '多半已被潮汐锁定（昼夜半球温差极大，但厚大气可以输运热量，因此只打折不归零）' : '自转未被锁定');
    mul('演化时间', clamp01((params.ageGyr || 0) / 1.0), '年龄 ' + trimNum(params.ageGyr || 0, 3) + ' Gyr');
    mul('恒星寿命', clamp01(star.tMSGyr / 2), '主序寿命 ' + trimNum(star.tMSGyr, 3) + ' Gyr');
    mul('宇宙尺度的前提', clamp(uc.universeHabitability, 0, 1), '来自创世参数的宇宙可居住性 ' + trimNum(uc.universeHabitability, 3));
    var v = clamp01(h);
    var low = f.slice().sort(function (p, q) { return p.value - q.value; })[0];
    return { value: v, factors: f, basis: 'heuristic',
      sentence: '宜居性 ' + v.toFixed(2) + '：把液态水、大气保留、温度窗口、宜居带位置、地质活动、时间与恒星寿命等 ' + f.length + ' 项按 0–1 连乘（heuristic）' + (v < 0.5 ? '；压得最低的一项是「' + low.name + '」（' + low.why + '）' : '') + '。' };
  }

  // ============================================================
  // 生命等级（heuristic）
  // ============================================================
  function lifeLevel(params, star, hab, seed) {
    if (hab == null) return { rank: -1, level: null, text: '维数不为 3，不做生命判断。' };
    if (params.solarKey === 'earth') return { rank: 3, level: '文明', text: '地球：目前唯一已知有生物圈与文明的行星（实测，不是判据的输出）。' };
    if (params.real) return { rank: -1, level: null, text: (params.name || '这颗行星') + '：至今没有发现生命（实测，不是判据的输出）。' };
    var age = params.ageGyr || 0;
    var rnd = mulberry32(hash32((seed >>> 0) ^ 0x4C494645));
    var roll = rnd();
    if (hab < 0.35 || age < 0.5) {
      return { rank: -1, level: null, text: hab < 0.35 ? '宜居性 ' + hab.toFixed(2) + ' 低于 0.35 的门槛，没有生命。' : '年龄只有 ' + trimNum(age, 3) + ' Gyr，还不到地球出现最早生命的 0.5 Gyr。' };
    }
    if (roll > hab) return { rank: -1, level: null, text: '条件允许（宜居性 ' + hab.toFixed(2) + '），但这颗行星上没有出现生命——这一步按宜居性做一次确定性抽签（种子固定，结果可复现）。' };
    // 地球时间表：微生物 0.5 Gyr、真核/多细胞 2–4 Gyr、动物 4.0 Gyr、陆生植物 4.1 Gyr、文明 4.55 Gyr；按宜居性快慢缩放
    var pace = clamp(1.4 - hab, 0.5, 1.4);
    var rank = 0;
    if (age >= 4.0 * pace) rank = 3; else if (age >= 3.6 * pace) rank = 2; else if (age >= 2.0 * pace) rank = 1; else rank = 0;
    if (rank === 3 && roll > hab * 0.55) rank = 2;      // 文明比动物稀少：再过一道确定性的筛
    return { rank: rank, level: LIFE_LEVELS[rank],
      text: '年龄 ' + trimNum(age, 3) + ' Gyr、宜居性 ' + hab.toFixed(2) + '，按地球的时间表（微生物 0.5 Gyr、动物 4.0 Gyr、文明 4.55 Gyr）缩放后落在「' + LIFE_LEVELS[rank] + '」一档。地球是唯一的样本，这一步是启发式。' };
  }

  // ============================================================
  // 报告（3–6 句中文，冷静）
  // ============================================================
  function buildReport(params, star, uc, derived, x) {
    var s = [];
    var name = params.name || '这颗行星';
    s.push(name + '：质量 ' + trimNum(params.massEarth, 3) + ' M⊕、半径 ' + trimNum(params.radiusEarth * R_E / 1000, 4) + ' km，表面重力 '
      + trimNum(derived.gravity.value, 3) + ' m/s²，逃逸速度 ' + trimNum(derived.escapeVelocity.value, 3) + ' km/s，平均密度 '
      + Math.round(derived.density.value) + ' kg/m³。');
    s.push('轨道半长轴 ' + trimNum(params.orbitAU, 3) + ' AU、偏心率 ' + trimNum(params.ecc, 2) + '，公转周期 ' + fmtTimeYr(derived.period.value)
      + '；辐照 ' + trimNum(derived.insolation.value, 3) + ' W/m²，平衡温度 ' + trimNum(x.Teq, 4) + ' K。');
    if (params.surfacePressureBar > 0) {
      s.push('大气 ' + trimNum(params.surfacePressureBar, 3) + ' bar（' + mixText(params.atmosphere) + '），灰大气光学厚度 τ=' + trimNum(x.tau, 3)
        + '，表面温度 ' + trimNum(x.Ts, 4) + ' K' + (x.runaway ? '——水汽正反馈失控，这是一次失控温室' : x.diverged ? '——已越出灰大气模型的适用范围，只标量级' : '')
        + (x.realT != null && Math.abs(x.realT - x.Ts) > 15 ? '（实测 ' + x.realT + ' K，' + (x.kind === 'rock' ? '差值来自本模型未含的云与尘埃' : '差值来自内部热流与 H₂–H₂ 碰撞诱导吸收，本模型未含') + '）' : '') + '。');
    } else {
      s.push('没有可观的大气：表面温度即平衡温度 ' + trimNum(x.Ts, 4) + ' K，昼夜温差由自转与热惯量决定。');
    }
    s.push((x.liquidWater ? '表面温压落在水的液相区内，液态水稳定；' : '表面没有液态水（' + derived.waterWindow.text + '）；')
      + (x.retained.length ? 'Jeans 判据下留得住的气体：' + x.retained.join('、') + '。' : '任何常见气体都留不住。'));
    s.push('潮汐锁定时标 ' + fmtTimeYr(x.tLockYr) + '，' + (x.tLockYr < x.ageYr ? '短于年龄，自转多半已被锁定' : '长于年龄，自转未被锁定')
      + '；放射性地表热流 ' + trimNum(x.heatFlux, 3) + ' W/m²，地质活动指数 ' + trimNum(x.tectonic, 2) + '。');
    if (x.hab.value != null) s.push(x.hab.sentence.replace(/。$/, '') + (x.life && x.life.level ? '；生命等级：' + x.life.level + '（启发式）。' : '。'));
    else s.push(x.hab.sentence);
    return s.join('');
  }
  // ============================================================
  // 长描述（默认展开的正文：6–10 句，由 params + derived 组合）
  // 顺序：类型与体量 → 轨道 → 自转与季节 → 温度与大气 → 气体保留 → 水 → 地质与磁场 → 卫星与环 → 宜居性与生命 → 年龄与历史
  // ============================================================
  var KIND_CN = { rock: '岩质行星', gas: '气态巨行星', ice: '冰巨星' };
  var TYPE_CN2 = { rock: '岩质行星', desert: '沙漠世界', ocean: '海洋世界', living: '有生命的世界', earth: '岩质行星', ice: '冰封世界', lava: '熔岩世界', gas: '气态巨行星' };
  /** 名字以拉丁字母/数字结尾时补一个空格，免得和后面的汉字挤在一起 */
  function pad(x) { return /[0-9A-Za-z）)\]]$/.test(String(x)) ? x + ' ' : String(x); }
  /** 数据来源摘要（一行，放在正文末尾，正文内不再逐句标注） */
  function sourceLine(params, ev) {
    var st = { accepted: 0, given: 0, seeded: 0 }, b = { computed: 0, scaling: 0, heuristic: 0 };
    paramRows(params).forEach(function (r) { if (st[r.basis] != null) st[r.basis]++; });
    (ev.derivedOrder || []).forEach(function (k) { if (b[ev.derived[k].basis] != null) b[ev.derived[k].basis]++; });
    (ev.findings || []).forEach(function (f) { if (b[f.basis] != null) b[f.basis]++; });
    var parts = [];
    if (st.accepted) parts.push('NASA 实测 ' + st.accepted + ' 项');
    if (st.given) parts.push('生成器给定 ' + st.given);
    if (st.seeded) parts.push('种子抽样 ' + st.seeded);
    parts.push('真算 ' + b.computed, '标度 ' + b.scaling, '启发式 ' + b.heuristic);
    return '数据：' + parts.join(' · ');
  }
  function describeLong(params, ev, star, uc) {
    star = normStar(star); uc = normUC(uc);
    var d = ev.derived, s = [], name = pad(params.name || '这颗星球');
    var typeCN = TYPE_CN2[params.type] || KIND_CN[params.kind] || '行星';
    var M = params.massEarth, R = params.radiusEarth, real = !!params.real;
    var starName = pad(star.name || '母恒星');

    // 1 类型与体量
    s.push(name + '是一颗' + typeCN + '，质量 ' + trimNum(M, 3) + ' M⊕（' + sci(M * M_E, 3) + ' kg）、半径 '
      + trimNum(R * R_E / 1000, 4) + ' km（' + trimNum(R, 3) + ' R⊕），平均密度 ' + Math.round(d.density.value)
      + ' kg/m³，表面重力 ' + trimNum(d.gravity.value, 3) + ' m/s²（' + trimNum(d.gravity.value / G_E, 3) + ' g⊕），逃逸速度 '
      + trimNum(d.escapeVelocity.value, 4) + ' km/s' + (real ? '（质量、半径取 NASA Planetary Fact Sheet 的实测值）' : '') + '。');
    // 2 轨道
    var e = params.ecc || 0, insolSwing = Math.pow((1 + e) / (1 - e), 2);
    s.push('它在 ' + trimNum(params.orbitAU, 4) + ' AU 上绕' + starName + '公转一周需要 ' + fmtTimeYr(d.period.value)
      + '，偏心率 ' + trimNum(e, 2) + '，' + (e < 0.02 ? '轨道近乎正圆，一年里的辐照几乎不变' : '近星点与远星点的辐照相差 ' + trimNum(insolSwing, 3) + ' 倍')
      + '，接收到的辐照为 ' + trimNum(d.insolation.value, 4) + ' W/m²（地球的 ' + trimNum(d.insolation.value / 1361, 3) + ' 倍）。');
    // 3 自转与季节
    var locked = d.tidalLock.value < ageGyrOf(params, star) * 1e9;   // #13：与 PL_TIDAL 用同一口径
    var tilt = params.obliquityDeg || 0, seasonTxt;
    if (locked) seasonTxt = '不过潮汐锁定时标只有 ' + fmtTimeYr(d.tidalLock.value) + '，远短于它的年龄，它多半已经被锁定成一面永昼、一面永夜';
    else seasonTxt = '潮汐锁定时标 ' + fmtTimeYr(d.tidalLock.value) + '，长于它的年龄，自转不会被恒星潮汐锁定';
    s.push('自转周期 ' + trimNum(Math.abs(params.rotationHours), 4) + ' 小时' + (params.rotationHours < 0 ? '（逆行）' : '')
      + '，一个太阳日 ' + trimNum(d.solarDay.value, 4) + ' 小时；转轴倾角 ' + trimNum(tilt, 3) + '°，'
      + (tilt < 3 ? '几乎没有季节' : '45° 纬度上夏至与冬至的日均辐照相差 ' + trimNum(d.season.value, 3) + ' 倍'
        + (tilt > 54 ? '，高纬度在一年里既是最热也是最冷的地方' : '')) + '，' + seasonTxt + '。');
    // 4 温度与大气
    var P0 = params.surfacePressureBar || 0;
    s.push('平衡温度 ' + trimNum(ev.equilibriumTempK, 4) + ' K；'
      + (P0 > 0 ? (params.kind === 'rock' ? '表面气压 ' + trimNum(P0, 3) + ' bar，大气以 ' : '在 1 bar 参考面上，大气以 ')
        + mixText(params.atmosphere, 3) + ' 为主，灰大气模型给出的温室增温 '
        + trimNum(ev.surfaceTempK - ev.equilibriumTempK, 3) + ' K，表面温度 ' + trimNum(ev.surfaceTempK, 4) + ' K'
        + (ev.derived.surfaceTemp.text.indexOf('失控') > 0 ? '——水汽正反馈失控' : '')
        : '它几乎没有大气，表面温度就是平衡温度 ' + trimNum(ev.surfaceTempK, 4) + ' K，昼夜温差只由自转与热惯量决定') + '。');
    // 5 气体保留
    var ret = [], esc2 = [];
    GAS_ORDER.forEach(function (k) { (ev.jeansMap && ev.jeansMap[k] >= 30 ? ret : esc2).push(GASES[k].name.split(' ')[0]); });
    s.push('按 Jeans 判据（外逸层温度 ' + Math.round(d.exobaseTemp.value) + ' K），'
      + (!ret.length ? '任何常见气体都留不住，大气会被剥得精光'
        : !esc2.length ? '八种常见气体全部留得住，连最轻的氢也不例外'
          : ret.join('、') + '留得住，' + esc2.join('、') + '会持续逃逸') + '。');
    // 6 水
    var wo = params.waterOceans || 0;
    s.push(ev.liquidWater
      ? '表面温压落在水的液相区内（该气压下的沸点 ' + trimNum(boilingT(P0 * 1e5), 4) + ' K），液态水稳定，含水量约 ' + trimNum(wo, 3) + ' 个地球海洋'
        + (wo > 3 ? '——足够把整颗行星裹进一层深海' : '') + '。'
      : d.waterWindow.text + (d.solvents.value > 0 ? '；不过 ' + d.solvents.text : '') + '。');
    // 7 地质与磁场
    s.push('放射性地表热流 ' + trimNum(d.heatFlux.value, 3) + ' W/m²（地球现今 0.0865），地质活动指数 ' + trimNum(d.tectonics.value, 2)
      + '（' + d.tectonics.text.replace(/^[^（]*（/, '').replace(/）$/, '') + '），磁场指数 ' + trimNum(params.magneticIndex, 2)
      + '：' + (params.magneticIndex > 0.3 ? '有全球磁场，恒星风被挡在磁层之外' : '没有全球磁场，大气直接暴露在恒星风里') + '。');
    // 8 卫星与环
    var mc = params.moonCount || 0, mn = params.moonNames && params.moonNames.length ? '（' + params.moonNames.slice(0, 4).join('、') + (params.moonNames.length > 4 ? ' 等' : '') + '）' : '';
    s.push((mc > 0 ? '它有 ' + mc + ' 颗' + (real ? '已知' : '') + '卫星' + mn : '它没有卫星')
      + '，' + (params.hasRings ? '并有一组由碎屑与冰粒构成的环' : mc > 0 ? '但没有环系' : '也没有环系')
      + '；卫星的稳定区在希尔球半径 ' + sci(d.hillRadius.value, 3) + ' km 的一半以内，洛希极限 ' + sci(d.rocheLimit.value, 3) + ' km 以内的东西会被潮汐撕碎。');
    // 9 宜居性与生命
    if (ev.habitability == null) {
      s.push(ev.habitabilityDetail.sentence);
    } else {
      var fs2 = ev.habitabilityDetail.factors || [];
      var pass = fs2.filter(function (f) { return f.value >= 0.9; }).map(function (f) { return f.name; });
      var failed = fs2.filter(function (f) { return f.value <= 0.5; }).map(function (f) { return f.name; });
      s.push('宜居性 ' + ev.habitability.toFixed(2) + '：'
        + (pass.length ? pass.slice(0, 6).join('、') + '这几项通过' : '没有一项拿到满分')
        + (failed.length ? '，' + failed.slice(0, 4).join('、') + '没通过' : '，没有明显的短板')
        + '；' + (ev.life && ev.life.level ? '生命等级判为「' + ev.life.level + '」' : '没有出现生命') + '（宜居性与生命等级都是启发式判据）。');
    }
    // 10 年龄与历史
    var age = params.ageGyr || star.ageGyr || 0, rem = star.tMSGyr - star.ageGyr;
    s.push('它形成于 ' + trimNum(age * 10, 3) + ' 亿年前，' + starName + '已经走过主序寿命的 '
      + Math.round(clamp01(star.ageGyr / star.tMSGyr) * 100) + '%，'
      + (rem > 0 ? '还能再燃烧约 ' + fmtTimeYr(rem * 1e9) : '已经离开主序') + '。');
    return { text: s.join(''), sentences: s, source: sourceLine(params, ev) };
  }

  /**
   * 恒星描述（恒星系层）：光谱型、质量、温度、光度、年龄与寿命剩余、单星与否、宜居带范围、雪线。
   * opts = {planets:[planets.js 的 Planet]，nowYr}
   */
  function describeStar(star, uc, opts) {
    star = normStar(star); uc = normUC(uc); opts = opts || {};
    var s = [], name = star.name || '这颗恒星';
    /* 恒星已经演化成遗骸时，绝不能再按主序星来描述：
       用户看到过「DC 白矮星、末质量 0.70 M☉、已冷却 55 亿年」和「一颗 B 型主序星，质量 2.77 M☉」
       并排出现——前者是它现在的样子，后者是它前身的参数，两句都从同一个 star 对象里抽，只是这里
       从来没看过 star.remnant / star.stage。光谱型也一样：DA/DB/DC 这种白矮星型号在 star.spt 里
       已经算好，按温度硬推只会得到"B 型"这种错的答案。 */
    var isRemnant = !!star.remnant, stage = star.stageName || '';
    var cls = star.spt || star.cls || (star.tempK > 30000 ? 'O' : star.tempK > 10000 ? 'B' : star.tempK > 7500 ? 'A' : star.tempK > 6000 ? 'F' : star.tempK > 5200 ? 'G' : star.tempK > 3700 ? 'K' : 'M');
    var mNow = isRemnant && star.massRemnant != null ? star.massRemnant : star.massRel;
    /* 称呼要读得通：白矮星的 spt 是 DA/DB/DC，说"DA 型白矮星"没问题；黑洞和中子星的 spt 是
       BH/NS，说"BH 型黑洞"就成了废话。黑洞也没有光球，"有效温度/光度"写成 0 会误导——
       它不是一颗温度为零的星，而是根本没有这两个量。 */
    var lightless = star.stage === 'bh' || !(star.lumRel > 0);
    if (star.stage === 'bh') {
      s.push(name + '是一个黑洞，质量 ' + trimNum(mNow, 3) + ' M⊙、视界半径约 ' + trimNum(star.radiusRel, 3)
        + ' R⊙。它没有光球，也就没有有效温度和光度可言——你在画面上看到的橙色圆环是吸积盘示意，不是它本身在发光。');
    } else if (star.stage === 'ns') {
      s.push(name + '是一颗中子星，质量 ' + trimNum(mNow, 3) + ' M⊙、半径 ' + trimNum(star.radiusRel, 3)
        + ' R⊙（约十几公里）、表面温度约 ' + Math.round(star.tempK) + ' K、光度 ' + trimNum(star.lumRel, 3) + ' L⊙。');
    } else {
      s.push(name + '是一颗 ' + cls + (isRemnant ? ' 型' + (stage || '致密遗骸') : ' 型主序星')
        + '，质量 ' + trimNum(mNow, 3) + ' M⊙、有效温度 ' + Math.round(star.tempK)
        + ' K、光度 ' + trimNum(star.lumRel, 3) + ' L⊙、半径 ' + trimNum(star.radiusRel, 3) + ' R⊙。');
    }
    var msLife = star.msLifeGyr != null ? star.msLifeGyr : star.tMSGyr, rem = (msLife || 0) - star.ageGyr;
    /* t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 是主序寿命标度关系；本引擎的给出窗口与下方 msValid 一致
       （0.05–200 M⊙）。有些宇宙的恒星质量窗口能到 10⁸ M⊙，把这个式子外推过去会打印出
       "主序寿命 1.53e-8 天"这种数——它不是一个结论，只是把公式用到了它根本不适用的地方。
       越界就明说越界，不给数。
       下界取 0.075 M⊙ 而不是 0.05：氢聚变点火下限（主序星与褐矮星的分界）在 0.07–0.09 M⊙
       之间，0.05 已经落进褐矮星区间，那里根本没有"主序寿命"可言，本模块的 evolveStar()
       也是在 0.075 M⊙ 以下就转走褐矮星分支的——两处口径必须一致。 */
    var mInit = star.massInit != null ? star.massInit : star.massRel;
    var MS_LO = 0.075, MS_HI = 200;
    var msValid = mInit >= MS_LO && mInit <= MS_HI;
    var msRange = MS_LO + '–' + MS_HI + ' M⊙';
    var msTxt = msValid ? '主序寿命约 ' + fmtTimeYr((msLife || 0) * 1e9) + '，t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 是标度关系'
      : '主序寿命无法给出：t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 是按 ' + msRange + ' 给出的标度关系，这个质量已经远在它的适用范围之外';
    if (isRemnant) {
      s.push('它形成于 ' + trimNum(star.ageGyr * 10, 3) + ' 亿年前，前身是一颗 ' + trimNum(mInit, 3)
        + ' M⊙ 的恒星（' + msTxt + '）；'
        + '主序阶段早已结束，现在的温度与光度是余热冷却的结果，不再有核聚变供能'
        + (star.stageNote ? '。' + star.stageNote : '') + '。');
    } else {
      // 非遗骸分支同样要受 msValid 保护：以前只有遗骸那一支会拒绝越界外推，
      // 于是 10⁸ M⊙ 的"主序星"照样会打印出一个荒谬的寿命数字。
      s.push('它形成于 ' + trimNum(star.ageGyr * 10, 3) + ' 亿年前；'
        + (msValid
          ? '按 t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 估计，主序寿命约 ' + fmtTimeYr((msLife || 0) * 1e9) + '，'
            + (rem > 0 ? '还剩约 ' + fmtTimeYr(rem * 1e9) : '已经走到主序末端') + '（质光关系与主序寿命都是标度关系）'
          : msTxt) + '。');
    }
    var pl = opts.planets || [];
    /* 多重性也别再写死："本引擎不生成密近双星"这句话在多星模块（Raghavan 2010 / Duchêne & Kraus 2013
       / HW99 稳定区）做出来之后就不成立了，而 star.multiplicity 一直放在那儿没人读。 */
    var mult = opts.multiplicity != null ? opts.multiplicity : star.multiplicity;
    var multTxt = !(mult > 1) ? '这是一个单星系统'
      : '这是一个' + (mult === 2 ? '双星' : mult === 3 ? '三星' : mult + ' 合星') + '系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据）';
    s.push(multTxt + (pl.length ? '，已经凝出 ' + pl.length + ' 颗行星，最内一颗在 ' + trimNum(pl[0].orbitAU, 3) + ' AU、最外一颗在 ' + trimNum(pl[pl.length - 1].orbitAU, 3) + ' AU' : '') + '。');
    var hzIn = hzEdge(HZ_COEF.moistGreenhouse, star.tempK, star.lumRel), hzOut = hzEdge(HZ_COEF.maxGreenhouse, star.tempK, star.lumRel);
    var hzInO = hzEdge(HZ_COEF.recentVenus, star.tempK, star.lumRel), hzOutO = hzEdge(HZ_COEF.earlyMars, star.tempK, star.lumRel);
    var inHZ = pl.filter(function (p) { return p.orbitAU >= hzIn.dAU && p.orbitAU <= hzOut.dAU; });
    s.push('按 Kopparapu et al. 2013，保守宜居带在 ' + trimNum(hzIn.dAU, 3) + '–' + trimNum(hzOut.dAU, 3) + ' AU，宽松宜居带在 '
      + trimNum(hzInO.dAU, 3) + '–' + trimNum(hzOutO.dAU, 3) + ' AU；'
      + (inHZ.length ? '落在保守带内的有 ' + inHZ.length + ' 颗（' + inHZ.map(function (p) { return p.name; }).slice(0, 3).join('、') + '）' : '没有行星落在保守带内')
      + (star.tempK < 2600 || star.tempK > 7200 ? '——该多项式只在 2600–7200 K 内有效，这里是外推' : '') + '。');
    s.push('水冰可以凝结的雪线约在 ' + trimNum(2.7 * Math.sqrt(star.lumRel), 3) + ' AU（Hayashi 1981 的最小质量星云标度），雪线以内是岩质行星的地盘，以外才可能长出巨行星。');
    /* 遗骸宿主必须补这一句：上面的宜居带和雪线都是按**现在**的光度算的，而这颗星在成为遗骸之前
       经历过红巨星/渐近巨星支阶段，半径可以涨到 1 AU 量级，内侧行星多半已被吞没或轨道被彻底改写。
       本引擎不模拟那一段，所以这里列出的行星系统只是"按当前恒星参数生成的样子"，不是演化史的结果。 */
    if (isRemnant) s.push('注意：以上宜居带与雪线都按它**现在**的光度算。它在成为' + (stage || '遗骸')
      + '之前经历过巨星阶段，半径一度可达 1 AU 量级，那时轨道在这个尺度以内的行星多半已被吞没或轨道被改写——本引擎不模拟这段演化，所以这里的行星系统是按当前恒星参数生成的，不是演化史的推演结果（这一条是模型局限，不是这个宇宙的物理）。');
    return { text: s.join(''), sentences: s, source: '数据：恒星质量/温度/光度由恒星系生成器给定 · 主序寿命与质光关系为标度 · 宜居带为真算（Kopparapu et al. 2013）' + (isRemnant ? ' · 遗骸宿主：巨星阶段的吞没未模拟，已在正文注明' : '') };
  }

  function mixText(mix, n) {
    var ks = Object.keys(mix || {}).filter(function (k) { return mix[k] > 0; })
      .sort(function (a, b) { return mix[b] - mix[a]; }).slice(0, n || 4);
    if (!ks.length) return '成分未知';
    return ks.map(function (k) {
      var v = mix[k] * 100;
      return (GASES[k] ? GASES[k].name.split(' ')[1] || GASES[k].name : k) + ' ' + (v >= 0.1 ? trimNum(v, 3) + '%' : sci(mix[k] * 1e6, 2) + ' ppm');
    }).join('、');
  }

  // ============================================================
  // UI 辅助：参数表 / 派生表的行
  // ============================================================
  var STATUS_CN = { accepted: '实测', given: '给定', seeded: '种子抽样' };
  var BASIS_CN = { computed: '真算', scaling: '标度', heuristic: '启发式' };
  function paramRows(params) {
    if (!params) return [];
    var rows = [];
    SCHEMA.forEach(function (d) {
      if (!(d.key in params)) return;
      var v = params[d.key], meta = (params.meta && params.meta[d.key]) || {};
      var text;
      if (d.key === 'atmosphere') text = mixText(v);
      else if (typeof v === 'number') text = num(v, 4);
      else text = String(v);
      rows.push({ key: d.key, name: d.name, symbol: d.symbol, unit: d.key === 'atmosphere' ? '' : d.unit, value: text,
        basis: meta.status || 'seeded', basisLabel: STATUS_CN[meta.status] || '种子抽样',
        ref: meta.ref || d.ref, desc: meta.note || d.desc });
    });
    return rows;
  }
  function derivedRows(ev) {
    if (!ev || !ev.derived) return [];
    return (ev.derivedOrder || Object.keys(ev.derived)).map(function (k) {
      var d = ev.derived[k];
      return { key: k, name: d.name, symbol: d.symbol, unit: d.unit, value: d.text,
        basis: d.basis, basisLabel: BASIS_CN[d.basis] || d.basis, ref: d.ref, desc: d.formula };
    });
  }

  // ============================================================
  // 与 ui/planets.js 的对接
  // ============================================================
  function universeConstantsOf(up) {
    if (!up) return normUC(null);
    var c = up.constants || (up.report && up.report.constants) || null;
    var hab = up.report && up.report.habitability != null ? up.report.habitability
      : (up.habitability != null ? up.habitability : (up.universeHabitability != null ? up.universeHabitability : null));
    return normUC({
      alphaRel: c && c.alpha ? c.alpha * 137.035999084 : null,
      alphaGRel: c ? c.alphaG : null, meOverMpRel: c ? c.meOverMp : null,
      dimS: c ? c.dimS : (up.dimS != null ? up.dimS : null),
      universeHabitability: hab == null ? (up.isOurs || up.isOurUniverse || up.id === 1207 ? 1 : 0.7) : hab,
      isOurs: up.isOurs || up.isOurUniverse || up.id === 1207 || up.ours
    });
  }
  var SOLAR_KEY_BY_CN = SOLAR_BY_CN;
  /**
   * PE.attach(planet, system, universeParams) → evaluate 的结果
   * 把 params/report 挂到 planets.js 的 Planet 上；过程生成的行星另按 evaluate 的宜居性 + 年龄 + 种子定生命等级。
   */
  function attach(planet, system, universeParams) {
    if (!planet) return null;
    var star = (system && system.star) || planet.star || null;
    var uc = universeConstantsOf(universeParams || (system && system.universeParams) || null);
    if (uc.universeHabitability == null && system && system.universeHabitability != null) uc.universeHabitability = system.universeHabitability;
    var dim = planet.dim != null ? planet.dim : (system && system.dim != null ? system.dim : null);
    if (dim != null && isFinite(dim)) uc.dimS = dim;     // D≠3：宜居性与生命都不给（与 engine.js 一致）
    var key = planet.visualKey || (SOLAR_KEY_BY_CN[planet.name] ? SOLAR_KEY_BY_CN[planet.name].key : null);
    var given = {
      au: planet.orbitAU, ecc: planet.ecc, radiusRel: planet.radiusRel, gravityRel: planet.gravityRel,
      rotationH: planet.rotationH, tiltDeg: planet.tilt, type: planet.type,
      pressureRel: planet.atmosphere ? planet.atmosphere.pressureRel : null,
      real: !!planet.real, key: key, name: planet.name,   // #10：贴图 key 撞上太阳系天体不代表它就是那颗行星
      ageGyr: star && star.ageGyr != null ? star.ageGyr : null,
      moonCount: planet.moonCount != null ? planet.moonCount : (planet.moons ? planet.moons.length : 0),
      moonNames: (planet.moons || []).map(function (m) { return m.name; }).filter(Boolean),
      hasRings: !!(planet.visual && planet.visual.rings) || !!planet.ring
    };
    var params = deriveFromSeed(planet.seed != null ? planet.seed : hash32(planet.id || 0), star, given, uc);
    if (!params.name) params.name = planet.name;
    var ev = evaluate(params, star, uc);
    planet.params = params;
    planet.report = ev;
    /* 这个宇宙连分子化学都没有时，生命一律清空。以前只挡了生成器那一侧，evaluate() 在这里
       又按自己的判据把 life 写回去，于是面板同时出现"无分子化学：不会有生命"和"是一颗有生命
       的世界"。化学不过关就是不过关，不能在文案里否认、在数据里保留。 */
    if (system && system.noLife) { planet.life = null; if (planet.type === 'living') planet.type = 'ocean'; }
    // 生命等级由 evaluate 决定（太阳系的实测行星不动）
    else if (!params.real && ev.life) {
      // #11：D≠3 时宜居性不给数，生命也一律不给（与 engine.js 一致）——包括"类型已定为 living"的世界，
      // 生成器给过的 life 在这里被清掉，而不是被提升到微生物。
      var habOK = ev.habitability != null;
      var rank = habOK ? ev.life.rank : -1;
      if (habOK && planet.type === 'living' && rank < 0) rank = 0;        // 类型已定为"有生命的世界"：至少保留微生物
      var nl = rank >= 0 ? { level: LIFE_LEVELS[rank], rank: rank } : null;
      var changed = (planet.life ? planet.life.rank : -1) !== (nl ? nl.rank : -1);
      planet.life = nl;
      if (changed && planet.timeline) {
        var r = mulberry32(hash32((planet.seed >>> 0) ^ 0x54494D45));
        var age = params.ageGyr != null && isFinite(params.ageGyr) ? params.ageGyr : ((star && star.ageGyr != null && isFinite(star.ageGyr)) ? star.ageGyr : 4.6);   // #13
        planet.timeline.greenGyr = nl && nl.rank >= 1 ? clamp(age * lerp(0.4, 0.8, r()), 0.8, age) : Infinity;
        planet.timeline.civGyr = nl && nl.rank >= 3 ? age - 0.02 - r() * 0.05 : Infinity;
      }
    }
    return ev;
  }
  /** 恒星系里"最值得看"的行星：优先用引擎的宜居性，其次用生命等级 */
  function pickHabitable(planets, fallback) {
    var best = -1, bi = fallback == null ? -1 : fallback;
    (planets || []).forEach(function (p, k) {
      var h = p.report && p.report.habitability != null ? p.report.habitability : null;
      var s = (h != null ? h : 0) + (p.life ? 0.2 * (1 + p.life.rank) : 0);
      if (s > best && s > 0) { best = s; bi = k; }
    });
    return bi;
  }

  // ============================================================
  // 导出
  // ============================================================
  return {
    VERSION: VERSION, version: VERSION,
    SCHEMA: SCHEMA, SCHEMA_BY_KEY: SCHEMA_BY_KEY, GASES: GASES, GAS_ORDER: GAS_ORDER,
    SOLAR: SOLAR, SOLAR_BY_CN: SOLAR_BY_CN, SOLVENTS: SOLVENTS, LIFE_LEVELS: LIFE_LEVELS,
    HZ_COEF: HZ_COEF, STATUS_CN: STATUS_CN, BASIS_CN: BASIS_CN,
    CONST: { G: G_N, kB: KB, sigma: SIGMA_SB, amu: AMU, AU: AU_M, yr: YR_S, Msun: M_SUN, Rsun: R_SUN, Lsun: L_SUN, Tsun: T_SUN, Mearth: M_E, Rearth: R_E, gEarth: G_E, oceanKg: OCEAN_KG },
    deriveFromSeed: deriveFromSeed, evaluate: evaluate, attach: attach, pickHabitable: pickHabitable,
    describeLong: describeLong, describeStar: describeStar, sourceLine: sourceLine,
    universeConstantsOf: universeConstantsOf, paramRows: paramRows, derivedRows: derivedRows,
    habitability: habitability, lifeLevel: lifeLevel,
    pSatH2O: pSatH2O, boilingT: boilingT, hzEdge: hzEdge, radiusFromMass: radiusFromMass, massFromRadius: massFromRadius,
    radiogenicHeatFlux: radiogenicHeatFlux, seasonAmplitude: seasonAmplitude, solveSurfaceT: solveSurfaceT,
    normStar: normStar, normUC: normUC, mixText: mixText, fmtTimeYr: fmtTimeYr, sci: sci, num: num, trimNum: trimNum
  };
});
