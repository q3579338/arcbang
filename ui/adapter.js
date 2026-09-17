/*
 * ui/adapter.js —— 引擎适配层
 * ------------------------------------------------------------
 * UI 只和 window.MirrorAdapter 打交道。适配器优先对接真实引擎
 * （window.MirrorEngine + window.MirrorParams，见 engine/engine.js、engine/params.js）；
 * 引擎缺席时使用内置 stub，让 UI 可以独立开发与调试。
 *
 * 只保留真实物理：18 个真实参数（普朗克单位）。旧引擎（0.4.x）仍分两套表时固定取 real 表；新引擎只有一套表。
 * 参数 origin 统一视为 'physics'（小说仅作界面/文案参考）。
 *
 * 归一化后的接口（UI 依赖的形状）：
 *   A.isReal / A.engineVersion / A.unitNote
 *   A.PARAMS   [{key,index,name,symbol,unit,min,max,step,default,scale,floor,si,group,desc,origin,ref}]
 *   A.defaults() / A.normalize(p) / A.randomParams() / A.seedOf(p) / A.seedHex(p) / A.isDefault(p)
 *   A.toUnit(key,v) / A.fromUnit(key,u) / A.formatValue(key,v) / A.distance(p,q)
 *   A.simulate(p, {register}) -> {
 *       seed, id, idLabel, runs, params, mode, isOurs, distance, enterTimeGyr,
 *       outcome:{type,title,description,severity,visual,reasons},
 *       findings:[{id,title,severity,text}], timeline:[{id,name,tGyr,tLabel,happens,note}],
 *       series:{t:[],a:[]}|null, constants:{items:[{key,name,text}],sentence},
 *       report:{radiusGly,dimension,timeDimension,particleCount,onePlusOne,habitability,fate,liquid} }
 *   A.createNBody(p,{N,mesh,mode}) -> {N, step(dt), positions(Float32Array 2N,[0,1)), density(Float32Array N), a, t, dir, ended, reason, era()}
 *   A.catalog  list(mode?)/save(entry)/remove(id)/removeMany(ids)/clearUsers()/get(id)/exportJSON()/importJSON(str)/nextId()/presets(mode?)
 *              id 一律按 String 比较后取条目自身的 id 再交给引擎（引擎侧是严格比较，字符串 id 会一条都删不掉）
 *              条目：{id, no, label, name, hint, params, mode, preset, ours}
 *   A.bangs.get()
 *   A.OUTCOME_META[type] -> {title, severity, visual}
 */
(function (root) {
  'use strict';

  var LS_CATALOG = 'mirror.ui.catalog.v1';
  var LS_BANGS = 'mirror.ui.bangCount.v1';
  var LS_MODE = 'mirror.ui.mode.v1';
  var OURS_ID = 1207;
  var MODES = ['novel', 'real'];
  var MODE_NAMES = { novel: '小说模式', real: '真实模式' };

  /* ---------------------------------------------------------- 工具 */
  /* 中英双语：只在"显示"的地方套一层，词条见 web/i18n-mirror.js；没加载 i18n 时原样返回中文。
     stub（引擎缺席时的开发回退）里的文案不走这里 —— 那条路只在 engine.js 没加载时才出现。 */
  var TR = function (s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'mirror') : s); };
  function hashString(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  // 周期盒的正取模：(x+1)%1 对 x<−1 仍是负的，会让 CIC 取到负索引并把 NaN 扩散出去
  function wrap1(x) { x %= 1; return x < 0 ? x + 1 : x; }
  function safeLS() { try { return root.localStorage; } catch (e) { return null; } }
  function formatId(n) { return '#' + String(n).padStart(4, '0'); }
  function cnNum(n) { var s = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一']; if (Number.isInteger(n) && n >= 0 && n <= 11) return s[n]; return String(n).replace('.', '点').split('').map(function (ch) { return /\d/.test(ch) ? s[+ch] : ch; }).join(''); }
  // 三位有效数字，但不要 toPrecision 的科学计数（"5.50e+3 万年" 这种读不了）
  function trim3(x) { return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Number(Number(x).toPrecision(3))); }
  /* 显示层时间格式化：中文态逐字节不变；英文态直接按数值出规范单位
     （yr / kyr / Myr / Gyr，与 web/i18n-mirror.js 的时间串转换器同一口径）。
     只供界面显示，不进任何哈希/推导。 */
  function fmtTimeGyr(g) {
    if (g == null || !isFinite(g)) return '—';
    var yr = g * 1e9;
    var en = root.MirrorI18n && root.MirrorI18n.lang && root.MirrorI18n.lang() === 'en';
    if (en) {
      if (yr < 1) return (yr * 3.156e7).toPrecision(2) + ' s';
      if (yr < 1e4) return trim3(yr) + ' yr';
      if (yr < 1e7) return trim3(yr / 1e3) + ' kyr';
      if (yr < 1e10) return trim3(yr / 1e6) + ' Myr';
      if (yr < 1e13) return trim3(yr / 1e9) + ' Gyr';
      return '10^' + Math.round(Math.log(yr) / Math.LN10) + ' yr';
    }
    if (yr < 1) return (yr * 3.156e7).toPrecision(2) + ' 秒';
    if (yr < 1e4) return trim3(yr) + ' 年';
    if (yr < 1e8) return trim3(yr / 1e4) + ' 万年';
    if (yr < 1e13) return trim3(yr / 1e8) + ' 亿年';
    return '10^' + Math.round(Math.log(yr) / Math.LN10) + ' 年';
  }
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  /* ---------------------------------------------------------- 参数 schema（stub 副本，仅当 engine/params.js 缺席时使用） */
  var FALLBACK_SCHEMA = [
    { key: 'G', index: 1, canon: true, name: '万有引力常数', symbol: 'G', unit: 'rel', min: 0, max: 100, default: 1, step: 0.05, scale: 'log', floor: 1e-3, si: '6.674×10⁻¹¹ m³kg⁻¹s⁻²（CODATA 2018）', group: '基本常数', desc: '引力耦合强度（相对值）。' },
    { key: 'c', index: 2, canon: true, name: '真空光速', symbol: 'c', unit: 'rel', min: 0.01, max: 100, default: 1, step: 0.01, scale: 'log', si: '每秒三十万公里', group: '基本常数', desc: '因果传播的极限速度。' },
    { key: 'h', index: 3, canon: true, name: '普朗克常数', symbol: 'h', unit: 'rel', min: 0.01, max: 100, default: 1, step: 0.01, scale: 'log', si: '6.626×10⁻³⁴', group: '基本常数', desc: '量子性的尺度。' },
    { key: 'e', index: 4, canon: true, name: '电子电量', symbol: 'e', unit: 'rel', min: 0.01, max: 100, default: 1, step: 0.01, scale: 'log', si: '1.602×10⁻¹⁹ 库仑', group: '基本常数', desc: '电磁相互作用的电荷单位。' },
    { key: 'dimS', index: 5, canon: true, name: '宏观维数', symbol: 'D', unit: '维', min: 1, max: 11, default: 3, step: 0.1, scale: 'lin', si: '3', group: '几何', desc: '空间的宏观维数，允许非整数。' },
    { key: 'arith', index: 6, canon: true, name: '算术基底', symbol: '1+1=', unit: '', min: 1.5, max: 3, default: 2, step: 0.05, scale: 'lin', si: '2', group: '几何', desc: '加法基底 1+1 的取值（示意参数，仅在引擎缺席的回退模式下存在）。' },
    { key: 'efolds', index: 7, canon: false, name: '初始能量密度 / 暴胀强度', symbol: 'N', unit: 'e-folds', min: 0, max: 200, default: 60, step: 1, scale: 'lin', si: '≳60', group: '宇宙学', desc: '暴胀期间空间膨胀 e^N 倍。' },
    { key: 'sigma', index: 8, canon: false, name: '时空稳定性', symbol: 'σ', unit: '', min: 0, max: 1, default: 1, step: 0.01, scale: 'lin', si: '1', group: '几何', desc: '过低→空间很快湮灭，只剩时间。' },
    { key: 'logN', index: 9, canon: false, name: '总物质量 log₁₀N', symbol: 'log₁₀N', unit: '', min: 0, max: 90, default: 80, step: 0.5, scale: 'lin', si: '≈80', group: '宇宙学', desc: '基本粒子总数的对数。' },
    { key: 'liquid', index: 10, canon: false, name: '物态比例（液体分数）', symbol: 'φ_liq', unit: '', min: 0, max: 1, default: 0, step: 0.01, scale: 'lin', si: '0', group: '宇宙学', desc: '宇宙中液体所占比例。' },
    { key: 'omegaL', index: 11, canon: false, name: '宇宙学常数 / 暗能量密度', symbol: 'Ω_Λ', unit: 'ρ_crit', min: -2, max: 5, default: 0.69, step: 0.01, scale: 'lin', si: '0.69', group: '宇宙学', desc: '暗能量密度。' },
    { key: 'omegaM', index: 12, canon: false, name: '物质密度', symbol: 'Ω_m', unit: 'ρ_crit', min: 0, max: 5, default: 0.31, step: 0.01, scale: 'lin', si: '0.31', group: '宇宙学', desc: '物质密度。' },
    { key: 'delta', index: 13, canon: false, name: '原初涨落幅度', symbol: 'δ', unit: 'rel', min: 0, max: 10, default: 1, step: 0.05, scale: 'lin', si: '10⁻⁵', group: '宇宙学', desc: '暴胀留下的密度皱纹。' },
    { key: 'alphaS', index: 14, canon: false, name: '强耦合常数', symbol: 'αₛ', unit: 'rel', min: 0.01, max: 5, default: 1, step: 0.01, scale: 'log', si: '0.118', group: '基本常数', desc: '强相互作用强度。' },
    { key: 'alphaW', index: 15, canon: false, name: '弱耦合常数', symbol: 'α_w', unit: 'rel', min: 0.01, max: 100, default: 1, step: 0.01, scale: 'log', si: '1.166×10⁻⁵ GeV⁻²', group: '基本常数', desc: '弱相互作用强度。' },
    { key: 'massRatio', index: 16, canon: false, name: '电子/质子质量比', symbol: 'mₑ/mₚ', unit: 'rel', min: 0.01, max: 100, default: 1, step: 0.01, scale: 'log', si: '1/1836', group: '基本常数', desc: '相对 1/1836 的倍数。' },
    { key: 'cp', index: 17, canon: false, name: '重子不对称', symbol: 'η_B', unit: 'rel', min: 0, max: 10, default: 1, step: 0.05, scale: 'lin', si: '10⁻⁹', group: '宇宙学', desc: '物质-反物质不对称度。' },
    { key: 'dimT', index: 18, canon: false, name: '时间维数', symbol: 'T', unit: '维', min: 0.5, max: 3, default: 1, step: 0.05, scale: 'lin', si: '1', group: '几何', desc: 'T≠1 时演化方程失去适定性。' }
  ];

  /* 通用参数模块：由 schema 数组构造 normalize/toUnit/... （不依赖引擎，任何模式都可用） */
  function makePM(schema) {
    var SCHEMA = schema.map(function (d) {
      var o = copy(d);
      o.origin = 'physics';   // 只保留真实物理
      o.canon = false;
      return o;
    });
    var BY = {}; SCHEMA.forEach(function (d) { BY[d.key] = d; });
    function defaults() { var o = {}; SCHEMA.forEach(function (d) { o[d.key] = d.default; }); return o; }
    function normalize(p) { var o = {}; p = p || {}; SCHEMA.forEach(function (d) { var v = Number(p[d.key]); if (!isFinite(v)) v = d.default; o[d.key] = clamp(v, d.min, d.max); }); return o; }
    function toUnit(key, v) { var d = BY[key]; if (!d) return 0; if (d.scale === 'log') { var lo = d.min > 0 ? d.min : (d.floor || 1e-3); var x = Math.max(v, lo); return (Math.log10(x) - Math.log10(lo)) / (Math.log10(d.max) - Math.log10(lo)); } return (v - d.min) / (d.max - d.min); }
    function fromUnit(key, u) { var d = BY[key]; if (!d) return NaN; u = clamp(u, 0, 1); if (d.scale === 'log') { var lo = d.min > 0 ? d.min : (d.floor || 1e-3); var v = Math.pow(10, Math.log10(lo) + u * (Math.log10(d.max) - Math.log10(lo))); if (d.min === 0 && u === 0) v = 0; return v; } return d.min + u * (d.max - d.min); }
    function distance(p, q) { p = normalize(p); q = normalize(q || defaults()); var s = 0; SCHEMA.forEach(function (d) { var u = toUnit(d.key, p[d.key]) - toUnit(d.key, q[d.key]); s += u * u; }); return Math.round(100 * Math.min(1, Math.sqrt(s / 3)) * 10) / 10; }
    function isDefault(p, tol) { tol = tol == null ? 1e-6 : tol; var n = normalize(p); return SCHEMA.every(function (d) { return Math.abs(toUnit(d.key, n[d.key]) - toUnit(d.key, d.default)) <= tol; }); }
    function formatValue(key, v) {
      var d = BY[key]; if (!d || !isFinite(v)) return String(v);
      var MPf = root.MirrorParams && typeof root.MirrorParams.formatValue === 'function' ? root.MirrorParams.formatValue : null;
      if (MPf) { try { var r = MPf(key, v); if (r != null && r !== '') return String(r); } catch (e) { /* fall through */ } }
      if (Math.abs(v) < 1e-3 && v !== 0) { var ex = Math.floor(Math.log10(Math.abs(v))), m = v / Math.pow(10, ex); return Number(m.toPrecision(3)) + '×10' + String(ex).replace(/-/, '⁻').replace(/\d/g, function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]; }); }
      if (d.scale === 'log') return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toPrecision(3);
      if (Math.abs(v) >= 100) return v.toFixed(0); if (Math.abs(v) < 0.01 && v !== 0) return v.toPrecision(2); return v.toFixed(2);
    }
    return { SCHEMA: SCHEMA, byKey: BY, keys: SCHEMA.map(function (d) { return d.key; }), defaults: defaults, normalize: normalize, toUnit: toUnit, fromUnit: fromUnit, distance: distance, isDefault: isDefault, formatValue: formatValue };
  }

  /* ---------------------------------------------------------- 结局元数据（引擎缺席时的标题；引擎在场时以引擎 name 为准） */
  var OUTCOME_META = {
    SPACE_ANNIHILATED: { title: '空间湮灭，只剩时间', severity: 'void', visual: '蓝球迅速熄灭，只剩左下角计时数字在跳动' },
    NEAR_EMPTY: { title: '近空宇宙', severity: 'void', visual: '全黑' },
    HIGH_DIM_UNOBSERVABLE: { title: '高维宇宙（不可观察）', severity: 'weird', visual: '一堆极其混乱的色彩和形状，自动关闭' },
    FRACTAL_DIM: { title: '分数维宇宙', severity: 'weird', visual: '无际的黑色平面，无数银线与平面垂直相交' },
    UNSTABLE_ORBITS: { title: '无稳定轨道的宇宙', severity: 'weird', visual: '物质在坍缩与飞散之间摇摆' },
    LIQUID_OCEAN: { title: '液体大洋宇宙', severity: 'good', visual: '银色大膜上的多彩露珠' },
    ALIEN_LAWS: { title: '异质定律的宇宙', severity: 'weird', visual: '一切按另一套定律运转' },
    BLACK_HOLE_DOMINATED: { title: '黑洞宇宙', severity: 'bad', visual: '只有视界与霍金辐射' },
    BIG_CRUNCH: { title: '大挤压', severity: 'bad', visual: '一切被压回一个点' },
    BIG_RIP: { title: '大撕裂', severity: 'cold', visual: '结构依次被撕开' },
    HEAT_DEATH_NO_STRUCTURE: { title: '热寂——无结构的宇宙', severity: 'cold', visual: '一锅几乎均匀的气体' },
    PARTICLES_ONLY: { title: '基本粒子汤宇宙', severity: 'cold', visual: '从未组装出原子' },
    NO_STARS: { title: '黑暗的宇宙', severity: 'cold', visual: '没有一颗恒星点燃' },
    NO_CHEMISTRY: { title: '无化学的恒星宇宙', severity: 'cold', visual: '有光，没有分子' },
    STARS_NO_LIFE: { title: '有化学无生命', severity: 'cold', visual: '没有人抬头看星空' },
    OBSERVERS_POSSIBLE: { title: '可能诞生观察者', severity: 'good', visual: '恒星与星系的三维分布' }
  };

  var bangsLS = {
    get: function () { var ls = safeLS(); return ls ? (parseInt(ls.getItem(LS_BANGS) || '0', 10) || 0) : 0; },
    increment: function () { var n = bangsLS.get() + 1; var ls = safeLS(); if (ls) try { ls.setItem(LS_BANGS, String(n)); } catch (e) { /* ignore */ } return n; }
  };

  /* ---------------------------------------------------------- Stub 引擎（无 engine.js 时） */
  function makeStub(pmOf) {
    function seedOf(p, mode) { var PM = pmOf(mode); var n = PM.normalize(p); return hashString(PM.SCHEMA.map(function (d) { return d.key + '=' + Number(n[d.key]).toPrecision(10); }).join(';')); }
    function randomParams(mode, opts) {   // stub 没有抽样先验，spread 被忽略
      var PM = pmOf(mode), rnd = Math.random, o = {};
      PM.SCHEMA.forEach(function (d) {
        var v;
        if (d.key === 'dimS') { var u = rnd(); v = u < 3 / 11 ? 3 : u < 3 / 11 + 0.08 ? Math.round((1.5 + rnd() * 2) * 10) / 10 : u < 3 / 11 + 0.18 ? 1 : 5 + Math.floor(rnd() * 7); }
        else if (d.key === 'arith') v = rnd() < 0.7 ? 2 : Math.round((1.5 + rnd() * 1.5) * 20) / 20;
        else if (d.key === 'sigma') v = rnd() < 0.25 ? rnd() * 0.3 : 0.7 + rnd() * 0.3;
        else if (d.key === 'logN') v = rnd() < 0.08 ? rnd() * 3 : 55 + rnd() * 35;
        else if (d.key === 'liquid') v = rnd() < 0.08 ? 0.4 + rnd() * 0.4 : rnd() * 0.1;
        else if (d.key === 'dimT') v = rnd() < 0.85 ? 1 : PM.fromUnit('dimT', rnd());
        else { var u0 = PM.toUnit(d.key, d.default); v = PM.fromUnit(d.key, rnd() < 0.35 ? rnd() : clamp(u0 + (rnd() - 0.5) * 0.35, 0, 1)); }
        var st = d.step || 0.01; v = Math.round(v / st) * st;
        o[d.key] = clamp(Number(v.toFixed(6)), d.min, d.max);
      });
      return PM.normalize(o);
    }
    function simulate(params, options) {
      options = options || {};
      var mode = options.mode || 'novel', PM = pmOf(mode);
      var p = PM.normalize(params), seed = seedOf(p, mode), rnd = mulberry32(seed);
      var dist = PM.distance(p), ours = PM.isDefault(p);
      var g = function (k, d) { return p[k] != null ? p[k] : d; };
      var findings = [];
      function F(id, title, sev, text) { findings.push({ id: id, title: title, severity: sev, text: text }); }
      var D = g('dimS', 3), Dr = Math.round(D), frac = Math.abs(D - Dr), type;
      // 真实参数表 → 兜底规则所需的等价量（引擎缺席时的最小判定）
      var sigma = g('sigma', 1), dimT = g('dimT', 1), arith = g('arith', 2), liquid = g('liquid', 0), logN = g('logN', p.omegaB === 0 ? 0 : 80), cp = g('cp', p.ckmPhase != null ? (p.ckmPhase < 0.05 || (p.generations != null && p.generations < 3) ? 0 : 1) : 1), G = g('G', 1), c = g('c', 1), h = g('h', 1), e = g('e', 1);
      var delta = g('delta', p.Q != null ? p.Q / 2e-5 : 1), omegaL = g('omegaL', p.lambda != null ? 0.69 * Math.pow(10, p.lambda + 123) : 0.69), omegaM = g('omegaM', p.omegaB != null ? p.omegaB + (p.omegaC || 0) : 0.31), alphaS = g('alphaS', 1), massRatio = g('massRatio', p.meOverMp != null ? p.meOverMp : 1), efolds = g('efolds', 60);
      if (sigma < 0.3 || dimT < 0.75 || dimT > 1.5) { type = 'SPACE_ANNIHILATED'; F('R_SIGMA', '时空不稳定', 'fatal', 'σ=' + sigma.toFixed(2) + '，T=' + dimT.toFixed(2) + '：空间在暴胀后重新卷曲湮灭。'); }
      else if (frac > 0.049 && D < 4) { type = 'FRACTAL_DIM'; F('R_DIM', '分数维', 'severe', 'D=' + D.toFixed(2) + '：分数维的宇宙很少见。'); }
      else if (Dr >= 5) { type = 'HIGH_DIM_UNOBSERVABLE'; F('R_DIM', '高维', 'fatal', 'D=' + Dr + '：我们无法观察它。'); }
      else if (Dr === 4) { type = 'UNSTABLE_ORBITS'; F('R_DIM', '四维', 'fatal', '力按 1/r³ 衰减，圆轨道失稳。'); }
      else if (Dr <= 2) { type = 'FRACTAL_DIM'; F('R_DIM', '低维', 'severe', 'D=' + Dr + '：没有稳定的三维结构。'); }
      else if (Math.abs(arith - 2) > 0.02 && liquid < 0.35) { type = 'ALIEN_LAWS'; F('R_ARITH', '算术基底不为 2', 'fatal', '1+1=' + arith + '：这个宇宙的算术与我们不同。'); }
      else if (logN < 6 || cp < 0.03) { type = 'NEAR_EMPTY'; F('R_MATTER', '物质近乎为零', 'fatal', 'log₁₀N=' + logN + '，η_B=' + cp.toFixed(2)); }
      else if (liquid >= 0.35) { type = 'LIQUID_OCEAN'; F('R_LIQUID', '连续液相', 'warn', Math.round(liquid * 100) + '% 的宇宙是液体。'); }
      else if (G / (c * c) >= 20 || delta >= 6) { type = 'BLACK_HOLE_DOMINATED'; F('R_BH', '引力过强', 'fatal', 'G/c² 过大或涨落过大，聚集即视界。'); }
      else if (omegaL < -0.2 || (omegaM > 1.4 && omegaL < 0.6)) { type = 'BIG_CRUNCH'; F('R_FATE', '闭合宇宙', 'severe', 'Ω_m=' + omegaM.toFixed(2) + '，Ω_Λ=' + omegaL.toFixed(2)); }
      else if (omegaL > 2) { type = 'BIG_RIP'; F('R_FATE', '幻影暗能量', 'severe', 'Ω_Λ=' + omegaL.toFixed(2)); }
      else if (delta < 0.15 || G < 0.05) { type = 'HEAT_DEATH_NO_STRUCTURE'; F('R_STRUCTURE', '结构未形成', 'fatal', 'δ=' + delta.toFixed(2) + '，G=' + PM.formatValue('G', G)); }
      else if (alphaS < 0.6) { type = 'NO_STARS'; F('R_FUSION', '恒星无法点燃', 'fatal', 'αₛ=' + alphaS.toFixed(2) + '：氘核不束缚。'); }
      else if (alphaS > 1.4 || massRatio > 2.5) { type = 'NO_CHEMISTRY'; F('R_CHEM', '化学不可行', 'fatal', '氢被烧光或原子失稳。'); }
      else {
        var alphaRel = p.alpha != null ? p.alpha * 137.036 : e * e / (h * c);
        var ok = alphaRel > 0.5 && alphaRel < 2 && G < 4 && G > 0.25;
        type = ok ? 'OBSERVERS_POSSIBLE' : 'STARS_NO_LIFE';
        if (!ok) F('R_HAB', '可居住性不足', 'severe', 'α 或 G 偏离，恒星寿命或化学舞台不足。');
      }
      var enter = ours ? 19 : type === 'NEAR_EMPTY' ? 10 : type === 'LIQUID_OCEAN' ? 15 : type === 'SPACE_ANNIHILATED' ? 1e-6 * (0.5 + rnd()) : type === 'BIG_CRUNCH' ? 6 + rnd() * 6 : 10 + rnd() * 9;
      enter = enter < 1 ? enter : Math.round(enter * 10) / 10;
      var radiusGly = clamp(20 * Math.pow(c, 0.6) * Math.exp((efolds - 60) / 45), 0, 900);
      if (type === 'NEAR_EMPTY') radiusGly = 50; if (type === 'LIQUID_OCEAN') radiusGly = 40; if (type === 'FRACTAL_DIM') radiusGly = 25; if (type === 'SPACE_ANNIHILATED') radiusGly = 0; if (ours) radiusGly = 20;
      var N = Math.pow(10, logN);
      var Gv = 6.674 * G, cv = 30 * c, ev = 1.602 * e, hv = 6.626 * h;
      var arithOK = Math.abs(arith - 2) <= 0.02;
      var items = p.alpha != null ? [
        { key: 'alpha', name: '精细结构常数', text: '精细结构常数是 1/' + (1 / p.alpha).toFixed(1) },
        { key: 'meOverMp', name: '电子/质子质量比', text: '电子与质子的质量比是 ' + (1 / (1836.15 * massRatio)).toPrecision(3) },
        { key: 'quarks', name: '夸克质量', text: '上夸克 ' + (p.mUp != null ? p.mUp : 2.2) + ' MeV、下夸克 ' + (p.mDown != null ? p.mDown : 4.7) + ' MeV' },
        { key: 'omegaB', name: '重子密度', text: 'Ω_b=' + (p.omegaB != null ? p.omegaB : 0.049) + '，Ω_c=' + (p.omegaC != null ? p.omegaC : 0.26) },
        { key: 'dimS', name: '空间维数', text: '空间维数是' + cnNum(D) }
      ] : [
        { key: 'dimS', name: '宏观维数', text: '宏观维数是' + cnNum(D) },
        { key: 'G', name: '万有引力常数', text: '万有引力常数是 ' + Gv.toPrecision(3) + '×10⁻¹¹' },
        { key: 'c', name: '真空光速', text: '真空中的光速是每秒' + (c === 1 ? '三十' : cv.toPrecision(3)) + '万公里' },
        { key: 'e', name: '电子电量', text: '电子电量是 ' + ev.toPrecision(4) + '×10⁻¹⁹ 库仑' },
        { key: 'h', name: '普朗克常数', text: '普朗克常数是 ' + hv.toPrecision(4) + '×10⁻³⁴' },
        { key: 'arith', name: '算术基底', text: '1+1=' + (arithOK ? '2' : String(arith)) }
      ];
      var meta = OUTCOME_META[type], desc;
      switch (type) {
        case 'SPACE_ANNIHILATED': desc = '引爆之后蓝球只亮了 ' + fmtTimeGyr(enter) + '。空间撑不住，重新卷曲、湮灭。屏幕上只剩左下角那个红色的时间数字还在跳。相当多的宇宙都是这样：连空间都很快湮灭了，只剩时间。'; break;
        case 'NEAR_EMPTY': { var n = Math.round(N), pairs = Math.floor(n / 2), free = n - pairs * 2; desc = '进入这个宇宙的时候距大爆炸 ' + fmtTimeGyr(enter) + '，屏幕全黑。分析程序统计完物质总量：这个宇宙中只有 ' + n + ' 个基本粒子' + (pairs ? '，其中 ' + pairs * 2 + ' 个结成了 ' + pairs + ' 个粒子对，相互环绕对方运行，每对之间相距几千万光年，要上百万年才相对移动一毫米' : '') + (free ? '；还有 ' + free + ' 个粒子是自由的' : '') + '。但它有空间——直径近千亿光年的空间；还有时间。时空是最实在的存在。'; break; }
        case 'HIGH_DIM_UNOBSERVABLE': desc = '这是一个' + cnNum(Dr) + '维宇宙。进入其中之后，屏幕上只有一堆极其混乱的色彩和形状——我们无法观察它，只能立刻关掉。其实大多数情况都是这样：宇宙从高能冷却后，被释放到宏观的维数为三的概率只有三比十一。'; break;
        case 'FRACTAL_DIM': desc = '维数比我们的低，是个' + cnNum(D) + '维的宇宙。屏幕上是一个无际的黑色平面——那就是这个宇宙的太空，没有厚度，直径约 ' + Math.round(radiusGly * 20) + ' 亿光年；无数银光闪闪的直线与平面垂直相交，那些是恒星，几亿光年长，但无限细，只有一维。分数维的宇宙很少见，值得把这组创世参数记下来。'; break;
        case 'LIQUID_OCEAN': desc = '运气好，这是个丰富多彩的宇宙。广漠的黑色天空下，一张银色的大膜向各个方向伸至无穷远处，膜上点缀着各种色彩的小球体，像滚动在镜面上的多彩露珠。半径约 ' + Math.round(radiusGly * 10) + ' 亿光年，其中 ' + Math.round(liquid * 100) + '% 是液体，其余是空间。这里的算术基底 1+1=' + arith + '。'; break;
        case 'OBSERVERS_POSSIBLE': desc = '结构已形成：恒星与星系可以出现。' + items.map(function (i) { return i.text; }).join('；') + '。' + (ours ? '这是我们的宇宙。' : '按判据，这里可能诞生观察者。'); break;
        default: desc = meta.title + '。' + findings.map(function (f) { return f.text; }).join('');
      }
      var timeline = [
        { id: 'singularity', name: '奇点', tGyr: 0, tLabel: '0', happens: true, note: '没有大小，没有结构，时间从这里开始' },
        { id: 'inflation', name: '暴胀结束', tGyr: 3e-49, tLabel: '10⁻³² 秒', happens: efolds > 0, note: '空间膨胀 e^' + efolds + ' 倍' },
        { id: 'recombination', name: '复合 · 微波背景释放', tGyr: 3.8e-4, tLabel: '38 万年', happens: type !== 'SPACE_ANNIHILATED', note: '宇宙变得透明' },
        { id: 'first_stars', name: '第一代恒星', tGyr: 0.2, tLabel: '2 亿年', happens: /OBSERVERS|STARS_NO|NO_CHEM|BIG_/.test(type), note: '核聚变点燃' },
        { id: 'galaxies', name: '星系形成', tGyr: 1, tLabel: '10 亿年', happens: /OBSERVERS|STARS_NO|NO_CHEM|NO_STARS|BIG_/.test(type), note: '暗物质晕聚集气体' },
        { id: 'end', name: type === 'BIG_CRUNCH' ? '大挤压' : type === 'BIG_RIP' ? '大撕裂' : type === 'SPACE_ANNIHILATED' ? '空间湮灭' : '热寂', tGyr: type === 'SPACE_ANNIHILATED' ? enter : type === 'BIG_CRUNCH' ? enter * 1.3 : 1e91, tLabel: type === 'SPACE_ANNIHILATED' ? fmtTimeGyr(enter) : type === 'BIG_CRUNCH' ? fmtTimeGyr(enter * 1.3) : '10¹⁰⁰ 年', happens: true, note: '' }
      ];
      var series = { t: [], a: [] };
      for (var i = 0; i <= 80; i++) { var t = enter * i / 80; series.t.push(t); series.a.push(type === 'BIG_CRUNCH' ? Math.sin(Math.PI * i / 80 * 0.8) : type === 'BIG_RIP' ? Math.pow(i / 80, 0.66) * (1 + 5 * Math.pow(i / 80, 10)) : Math.pow(i / 80, 0.66)); }
      var runs = bangsLS.get(), id = null;
      if (options.register !== false) { runs = bangsLS.increment(); id = ours ? OURS_ID : (runs < OURS_ID ? runs : runs + 1); }
      return {
        seed: seed, id: id, idLabel: id == null ? null : formatId(id), runs: runs, params: p, mode: mode, isOurs: ours, distance: dist, enterTimeGyr: enter,
        outcome: { type: type, title: meta.title, description: desc, severity: meta.severity, visual: meta.visual, reasons: findings.map(function (f) { return f.title; }) },
        findings: findings, timeline: timeline, series: series,
        constants: { items: items, sentence: items.map(function (i) { return i.text; }).join('；') + '。' },
        report: { radiusGly: radiusGly, dimension: D, timeDimension: dimT, particleCount: N, onePlusOne: arithOK ? '2' : String(arith), habitability: type === 'OBSERVERS_POSSIBLE' ? 0.8 : 0.1, fate: { type: type === 'BIG_CRUNCH' ? 'crunch' : type === 'BIG_RIP' ? 'rip' : 'open' }, liquid: liquid }
      };
    }
    /* 二维 PM 引力（源自 prototype-v0） */
    function createNBody(params, opts) {
      opts = opts || {};
      var PM = pmOf(opts.mode);
      var p = PM.normalize(params);
      var N = clamp(opts.N || 6000, 100, 8000), G = clamp(opts.mesh || 56, 16, 96);
      var rnd = mulberry32(seedOf(p, opts.mode) ^ 0x9E3779B9);
      var px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
      var rho = new Float32Array(G * G), phi = new Float32Array(G * G), fx = new Float32Array(G * G), fy = new Float32Array(G * G);
      var positions = new Float32Array(2 * N), density = new Float32Array(N);
      var Om = Math.max(p.omegaM != null ? p.omegaM : 0.31, 0.001), Ol = p.omegaL != null ? p.omegaL : 0.69, Gs = Math.max(p.G != null ? p.G : 1, 0.02), dl = p.delta != null ? p.delta : 1;
      var self = { N: N, a: 0.02, t: 0, ended: false, reason: null, positions: positions, density: density, dir: 1 };
      function E2(a) { var k = 1 - Om - Ol; return Om / (a * a * a) + k / (a * a) + Ol; }
      var modes = [];
      for (var i = 0; i < 14; i++) { var k = 1 + Math.floor(rnd() * 5), ang = rnd() * 6.283; modes.push({ kx: Math.round(k * Math.cos(ang)), ky: Math.round(k * Math.sin(ang)), ph: rnd() * 6.283, amp: 1 / (k * k) }); }
      var amp = dl * 0.007, Hi = Math.sqrt(Math.max(E2(0.02), 0)) * 0.02;
      for (i = 0; i < N; i++) { var x = rnd(), y = rnd(), dx = 0, dy = 0; for (var m = 0; m < modes.length; m++) { var mo = modes[m]; var s = Math.sin(6.283 * (mo.kx * x + mo.ky * y) + mo.ph) * mo.amp; dx += mo.kx * s; dy += mo.ky * s; } px[i] = wrap1(x + amp * dx); py[i] = wrap1(y + amp * dy); vx[i] = amp * dx * Hi; vy[i] = amp * dy * Hi; }
      function gravity() {
        rho.fill(0);
        for (var i = 0; i < N; i++) { var gx = px[i] * G, gy = py[i] * G, x0 = gx | 0, y0 = gy | 0, tx = gx - x0, ty = gy - y0, x1 = (x0 + 1) % G, y1 = (y0 + 1) % G; rho[y0 * G + x0] += (1 - tx) * (1 - ty); rho[y0 * G + x1] += tx * (1 - ty); rho[y1 * G + x0] += (1 - tx) * ty; rho[y1 * G + x1] += tx * ty; }
        var mean = N / (G * G); for (i = 0; i < G * G; i++) rho[i] = rho[i] / mean - 1;
        var h2 = 1 / (G * G);
        for (var it = 0; it < 10; it++) for (var y = 0; y < G; y++) { var ym = ((y + G - 1) % G) * G, yp = ((y + 1) % G) * G, yy = y * G; for (var x = 0; x < G; x++) { var xm = (x + G - 1) % G, xp = (x + 1) % G; phi[yy + x] = 0.25 * (phi[yy + xm] + phi[yy + xp] + phi[ym + x] + phi[yp + x] - h2 * rho[yy + x]); } }
        for (y = 0; y < G; y++) { ym = ((y + G - 1) % G) * G; yp = ((y + 1) % G) * G; yy = y * G; for (x = 0; x < G; x++) { xm = (x + G - 1) % G; xp = (x + 1) % G; fx[yy + x] = -(phi[yy + xp] - phi[yy + xm]) * G * 0.5; fy[yy + x] = -(phi[yp + x] - phi[ym + x]) * G * 0.5; } }
      }
      function sync() { for (var i = 0; i < N; i++) { positions[2 * i] = px[i]; positions[2 * i + 1] = py[i]; density[i] = rho[((py[i] * G) | 0) * G + ((px[i] * G) | 0)]; } }
      self.step = function (dt) {
        if (self.ended) return;
        var e2 = E2(self.a); if (e2 <= 0) self.dir = -1;
        var Hh = self.dir * Math.sqrt(Math.max(e2, 1e-6));
        gravity();
        var gs = Gs * 1.5 * Om / (self.a * self.a * self.a);
        for (var i = 0; i < N; i++) {
          var gx = px[i] * G, gy = py[i] * G, x0 = gx | 0, y0 = gy | 0, tx = gx - x0, ty = gy - y0, x1 = (x0 + 1) % G, y1 = (y0 + 1) % G;
          var ax = fx[y0 * G + x0] * (1 - tx) * (1 - ty) + fx[y0 * G + x1] * tx * (1 - ty) + fx[y1 * G + x0] * (1 - tx) * ty + fx[y1 * G + x1] * tx * ty;
          var ay = fy[y0 * G + x0] * (1 - tx) * (1 - ty) + fy[y0 * G + x1] * tx * (1 - ty) + fy[y1 * G + x0] * (1 - tx) * ty + fy[y1 * G + x1] * tx * ty;
          vx[i] += (ax * gs - 2 * Hh * vx[i]) * dt; vy[i] += (ay * gs - 2 * Hh * vy[i]) * dt;
          var sp = Math.hypot(vx[i], vy[i]); if (sp > 4) { vx[i] *= 4 / sp; vy[i] *= 4 / sp; }
          px[i] = wrap1(px[i] + vx[i] * dt); py[i] = wrap1(py[i] + vy[i] * dt);
        }
        self.a += Hh * self.a * dt; self.t += dt;
        if (self.a <= 0.03 && self.dir < 0) { self.ended = true; self.reason = 'crunch'; }
        else if (self.a > 12) { self.ended = true; self.reason = 'rip'; }
        else if (self.t > 1.6 && self.dir > 0) { self.ended = true; self.reason = 'age'; }
        else if (self.t > 4) { self.ended = true; self.reason = 'crunch'; }
        sync();
      };
      self.suggestDt = function () { return 0.0006 * (1 + self.a * 0.6); };
      self.era = function () { var a = self.a; if (a < 0.03) return '暴胀'; if (a < 0.08) return '复合 · 微波背景释放'; if (a < 0.2) return '黑暗时代'; if (a < 0.45) return '第一批恒星'; if (self.dir < 0) return '收缩'; if (a > 8) return '撕裂'; return '星系纪元'; };
      gravity(); sync();
      return self;
    }
    var PRESETS = [
      { key: 'ours', name: '我们的宇宙', id: OURS_ID, params: {} },
      { key: 'eleven', name: '只有十一个基本粒子的宇宙', params: { logN: Math.log10(11) } },
      { key: 'ocean', name: '液体大洋宇宙', params: { liquid: 0.5, arith: 2.3, G: 0.2 } },
      { key: 'sixdim', name: '六维宇宙', params: { dimS: 6 } },
      { key: 'twopointfive', name: '二点五维宇宙', params: { dimS: 2.5 } },
      { key: 'annihilated', name: '空间湮灭宇宙', params: { sigma: 0.1 } },
      { key: 'crunch', name: '大挤压宇宙', params: { omegaM: 3, omegaL: 0 } },
      { key: 'rip', name: '大撕裂宇宙', params: { omegaL: 4 } },
      { key: 'blackhole', name: '黑洞宇宙', params: { G: 50 } },
      { key: 'fourdim', name: '四维宇宙', params: { dimS: 4 } },
      { key: 'nochem', name: '无化学宇宙', params: { alphaS: 1.6 } }
    ];
    function loadStore() { var ls = safeLS(); if (!ls) return { entries: [] }; try { var o = JSON.parse(ls.getItem(LS_CATALOG) || 'null'); if (o && Array.isArray(o.entries)) return o; } catch (e) { /* ignore */ } return { entries: [] }; }
    function saveStore(st) { var ls = safeLS(); if (ls) try { ls.setItem(LS_CATALOG, JSON.stringify(st)); } catch (e) { /* ignore */ } }
    var rawCatalog = {
      runs: bangsLS.get,
      list: function () { return loadStore().entries.slice().sort(function (a, b) { return a.id - b.id; }); },
      get: function (id) { var l = rawCatalog.list(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; },
      nextId: function () { var n = bangsLS.get() + 1; return n < OURS_ID ? n : n + 1; },
      save: function (item) { var st = loadStore(); var mode = item.mode || 'novel', PM = pmOf(mode); var params = PM.normalize(item.params); var id = item.id; if (id == null) id = PM.isDefault(params) ? OURS_ID : rawCatalog.nextId(); var entry = { id: id, label: formatId(id), name: item.name || (PM.isDefault(params) ? '我们的宇宙' : '宇宙 ' + formatId(id)), params: params, mode: mode, outcome: item.outcome && item.outcome.id || item.outcome || null, createdAt: item.createdAt || new Date().toISOString(), note: item.note || '' }; var idx = -1; for (var i = 0; i < st.entries.length; i++) if (st.entries[i].id === id) idx = i; if (idx >= 0) st.entries[idx] = entry; else st.entries.push(entry); saveStore(st); return entry; },
      remove: function (id) { var st = loadStore(); var b = st.entries.length; st.entries = st.entries.filter(function (e) { return e.id !== id; }); saveStore(st); return st.entries.length < b; },
      exportJSON: function () { return JSON.stringify({ format: 'mirror-universe-catalog', version: 'stub', runs: bangsLS.get(), entries: loadStore().entries }, null, 2); },
      importJSON: function (str) { var o = typeof str === 'string' ? JSON.parse(str) : str; if (!o || !Array.isArray(o.entries)) throw new Error('无效的目录 JSON'); var n = 0; o.entries.forEach(function (e) { if (e && e.params) { rawCatalog.save({ id: e.id, name: e.name, params: e.params, mode: e.mode, outcome: e.outcome, createdAt: e.createdAt, note: e.note }); n++; } }); return n; }
    };
    return { seedOf: seedOf, randomParams: randomParams, simulate: simulate, createNBody: createNBody, rawCatalog: rawCatalog, presetsFor: function () { return PRESETS; }, presets: function () { return PRESETS; }, bangs: bangsLS };
  }

  /* ---------------------------------------------------------- 真实引擎归一化（engine v2：20 个基础参数 + 可选模块） */
  function wrapReal(E, pmOf) {
    var stub = makeStub(pmOf);
    var hasModules = !!(E.MODULES && typeof E.PARAMS_FOR === 'function');
    function normMods(m) { if (E.normalizeModules) { try { return E.normalizeModules(m); } catch (e) { /* ignore */ } } var o = {}; (E.MODULES || []).forEach(function (mod) { o[mod.id] = !!(m && m[mod.id]); }); return o; }
    function seedOf(p, modules) { try { return (E.hashParams ? E.hashParams(pmOf(modules).normalize(p), normMods(modules)) : stub.seedOf(p)) >>> 0; } catch (e) { return stub.seedOf(p); } }
    function randomParams(modules, opts) { try { var r = E.randomParams(undefined, normMods(modules), opts || undefined); var out = pmOf(modules).normalize(r); if (r && r._prior) out._prior = r._prior; return out; } catch (e) { return stub.randomParams(modules); } }
    function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
    function simulate(params, options) {
      options = options || {};
      var ms = normMods(options.modules), PM = pmOf(ms);
      var p = PM.normalize(params);
      var r;
      try { r = E.simulate(p, { register: options.register !== false, series: true, modules: ms }); }
      catch (err) { console.warn('[adapter] engine.simulate 失败，回退 stub：', err); return stub.simulate(p, options); }
      var oc = r.outcome || {}, type = oc.id || 'HEAT_DEATH_NO_STRUCTURE', meta = OUTCOME_META[type] || {};
      var ev = (r.cosmology && r.cosmology.events) || {};
      var chiGly = ev.chiOne != null ? ev.chiOne * 14.51 : null;
      var enter = num(oc.viewTimeGyr, 13.8);
      var radiusGly = chiGly != null ? chiGly : enter;
      if (r.isOurUniverse) radiusGly = 20;
      var series = r.cosmology && r.cosmology.series && r.cosmology.series.a ? { t: r.cosmology.series.t, a: r.cosmology.series.a } : null;
      var cr = r.constantsReport || (r.constants && r.constants.items ? r.constants : null) || { items: [], sentence: '' };
      var dims = r.calc && r.calc.dims;
      return {
        seed: num(r.seed != null ? r.seed : r.hash, seedOf(p, ms)) >>> 0, id: r.id, idLabel: r.idLabel, runs: r.runs, params: r.params || p, modules: r.modules || ms,
        isOurs: !!r.isOurUniverse, distance: num(r.distance, PM.distance(p)), enterTimeGyr: enter,
        // 引擎说这个宇宙能不能进镜像（D≠3 时为 false）：直接透传，UI 不必去翻 sim.raw
        canEnterMirror: (r.canEnterMirror != null) ? !!r.canEnterMirror : null,
        /* 结局变体（引擎 calcOcean）：**不是新结局类型**，结局仍是 outcome.type。
           'ocean' = 冷液体宇宙（R_OCEAN 四条判据全过），画面与沙盘按它分流。 */
        variant: r.variant || null,
        outcome: { type: type, title: oc.name || meta.title || type, description: r.report || oc.description || '', severity: oc.cls || meta.severity || 'cold', visual: oc.visual || meta.visual || '', reasons: oc.reasons || [] },
        findings: Array.isArray(r.findings) ? r.findings : [],
        derived: r.derived || null, derivedOrder: r.derivedOrder || [], layer1: (r.constants && !r.constants.items) ? r.constants : null,
        timeline: Array.isArray(r.timeline) ? r.timeline : [],
        series: series,
        constants: cr,
        report: {
          radiusGly: radiusGly, dimension: (dims && dims.D != null) ? dims.D : (r.constants && r.constants.dimS != null ? r.constants.dimS : 3), timeDimension: 1,
          particleCount: 1e80,
          onePlusOne: '2', habitability: (r.habitability == null ? null : num(r.habitability, 0)), fate: r.fate || (r.cosmology && r.cosmology.fate) || null, liquid: 0,
          starLifeGyr: r.calc && r.calc.stars && r.calc.stars.tMSGyr
        },
        raw: r
      };
    }
    function createNBody(params, opts) {
      opts = opts || {};
      var nb, ms = normMods(opts.modules);
      try { nb = E.createNBody(pmOf(ms).normalize(params), { N: clamp(opts.N || 6000, 100, 8000), mesh: opts.mesh || 56, modules: ms }); }
      catch (err) { console.warn('[adapter] engine.createNBody 失败，回退 stub：', err); return stub.createNBody(params, opts); }
      var N = nb.N, M = nb.mesh || 56, dens = new Float32Array(N), grid = nb.density;
      function sync() { var P = nb.positions, px = nb.px, py = nb.py; if (px && py) { for (var i = 0; i < N; i++) { P[2 * i] = px[i]; P[2 * i + 1] = py[i]; } } if (grid && grid.length === M * M) for (i = 0; i < N; i++) dens[i] = grid[((P[2 * i + 1] * M) | 0) * M + ((P[2 * i] * M) | 0)]; }
      var w = {
        N: N, raw: nb,
        step: function (dt) { nb.step(dt == null && typeof nb.suggestDt === 'function' ? nb.suggestDt() : dt); sync(); },
        suggestDt: function () { return typeof nb.suggestDt === 'function' ? nb.suggestDt() : 0.0006 * (1 + nb.a * 0.6); },
        era: function () { return typeof nb.era === 'function' ? nb.era() : ''; },
        get positions() { return nb.positions; },
        get density() { return dens; },
        get a() { return nb.a; }, get t() { return nb.t; }, get dir() { return nb.dir == null ? 1 : nb.dir; },
        get ended() { return !!nb.ended; }, get reason() { return nb.endReason || nb.reason || null; }
      };
      sync();
      return w;
    }
    var Cat = E.Catalog || (E.createCatalog && E.createCatalog()) || stub.rawCatalog;
    var rawCatalog = {
      runs: function () { return Cat.runs ? Cat.runs() : bangsLS.get(); },
      list: function () { return Cat.list().map(copy); },
      get: function (id) { var e = Cat.get(id); return e ? copy(e) : null; },
      nextId: function () { return Cat.nextId(); },
      save: function (item) { var it = copy(item); return Cat.save(it); },
      remove: function (id) { return Cat.remove(id); },
      exportJSON: function () { return Cat.exportJSON(true); },
      importJSON: function (s) { return Cat.importJSON(s); }
    };
    return { seedOf: seedOf, randomParams: randomParams, simulate: simulate, createNBody: createNBody, rawCatalog: rawCatalog, presets: function () { return Array.isArray(E.presets) ? E.presets : stub.presetsFor(); }, bangs: { get: rawCatalog.runs }, hasModules: hasModules, normMods: normMods };
  }

  /* ---------------------------------------------------------- 目录（UI 视图：只列"我保存的"）
     内置示例参数组不进目录（编辑器里有折叠区可加载），#1207 也不再占末行——
     目录里的编号因此就是用户条目自己的引爆编号，从 #0001 起。 */
  function makeCatalog(impl, pmOf, normMods) {
    function presetEntries() {
      var list = impl.presets() || [];
      var out = list.map(function (d, i) {
        var ms = normMods(d.modules), PM = pmOf(ms);
        var p = PM.defaults(); Object.keys(d.params || {}).forEach(function (k) { if (PM.byKey[k]) p[k] = d.params[k]; });
        var ours = d.key === 'ours' || d.id === OURS_ID;
        var no = ours ? OURS_ID : (d.no != null ? d.no : 3 + i * 53);
        return { id: 'preset:' + (d.key || i), no: no, label: formatId(no), name: ours ? TR('我们的宇宙') : (d.name || ''), hint: (d.blurb || d.hint || '') + (d.expect ? TR('（预期：') + d.expect + TR('）') : ''), params: PM.normalize(p), modules: ms, preset: true, ours: ours };
      });
      if (!out.some(function (e) { return e.ours; })) out.unshift({ id: 'preset:ours', no: OURS_ID, label: formatId(OURS_ID), name: TR('我们的宇宙'), hint: '', params: pmOf(normMods()).defaults(), modules: normMods(), preset: true, ours: true });
      return out;
    }
    var cat = {
      presets: presetEntries,
      // #1207（我们的宇宙）：不再作为目录末行，只作为编辑器的"重置"目标与示例之一
      ours: function () {
        var pre = presetEntries();
        for (var i = 0; i < pre.length; i++) if (pre[i].ours) return pre[i];
        return null;
      },
      // 目录只列"我保存的"：内置示例挪进编辑器的折叠区，不占编号、不入目录
      list: function () {
        return (impl.rawCatalog.list() || [])
          .filter(function (e) { return e && e.params && e.id !== OURS_ID; })
          .map(function (e) {
            var ms = normMods(e.modules);
            return { id: e.id, no: e.id, label: e.label || formatId(e.id), name: e.name || '', hint: e.outcomeName || '', params: pmOf(ms).normalize(e.params), modules: ms, preset: false, ours: false, createdAt: e.createdAt, hash: e.hash, note: e.note || '', outcome: e.outcome || null, outcomeName: e.outcomeName || '' };
          })
          .sort(function (a, b) { return a.no - b.no; });
      },
      get: function (id) {
        var l = cat.list(), i;
        for (i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i];
        var pre = presetEntries();                       // 预设与 #1207 仍可按 id / 编号取到
        for (i = 0; i < pre.length; i++) if (String(pre[i].id) === String(id) || pre[i].label === id) return pre[i];
        return null;
      },
      nextId: function () { return impl.rawCatalog.nextId(); },
      save: function (entry) { var ms = normMods(entry.modules); var e = impl.rawCatalog.save({ id: (typeof entry.id === 'number') ? entry.id : undefined, name: entry.name, params: entry.params, modules: ms, outcome: entry.outcome, note: entry.note }); if (!e) return null; if (e.id === OURS_ID) return cat.ours(); return cat.get(e.id); },
      /* id 归一：UI 侧的 id 都是从 DOM（data-id 属性）或对象键里来的字符串，条目里存的是数字。
         一律先按 String(id) 找到真实条目，再拿"条目自身的 id"（保持原类型）去调引擎的 remove——
         引擎那边是严格比较（e.id !== id），类型错一点就一条都删不掉，而且静默返回 false。 */
      realId: function (id) {
        var raw = impl.rawCatalog.list() || [], s = String(id), i;
        for (i = 0; i < raw.length; i++) if (raw[i] && String(raw[i].id) === s) return raw[i].id;
        return undefined;                                  // 目录里没有这一条
      },
      remove: function (id) { var real = cat.realId(id); return real === undefined ? false : !!impl.rawCatalog.remove(real); },
      removeMany: function (ids) { var k = 0; (ids || []).forEach(function (id) { try { if (cat.remove(id)) k++; } catch (e) { /* 跳过删不掉的 */ } }); return k; },
      clearUsers: function () { return cat.removeMany(cat.list().map(function (e) { return e.id; })); },
      exportJSON: function () { return impl.rawCatalog.exportJSON(); },
      importJSON: function (str) { return impl.rawCatalog.importJSON(str); }
    };
    return cat;
  }

  /* ---------------------------------------------------------- 组装（只保留真实物理：20 个公认基础参数 + 默认关闭的推测性模块） */
  var E = root.MirrorEngine || null;
  var MP = root.MirrorParams || null;
  // v2：模块默认值随引擎 v2.2.0 变了（stringGas 默认开），换 key 让老用户也跟上新默认一次
  var LS_MODULES = 'mirror.ui.modules.v2';
  var MODULES = (E && Array.isArray(E.MODULES)) ? E.MODULES : ((MP && Array.isArray(MP.MODULES)) ? MP.MODULES : []);
  /* 模块默认值以引擎为准（v2.2.0 起 stringGas 默认开：维数由弦气模型生成而不是直接输入）。
     注意引擎语义：normalizeModules({}) = 默认值，不是"全关"；要显式关掉得传 {stringGas:false}。 */
  function normModsLocal(m) {
    if (E && typeof E.normalizeModules === 'function') {
      try { var r = E.normalizeModules(m); if (r && typeof r === 'object') return r; } catch (e) { /* 落回下面 */ }
    }
    var o = {}; MODULES.forEach(function (mod) { o[mod.id] = (m && mod.id in m && m[mod.id] != null) ? !!m[mod.id] : !!mod.defaultOn; }); return o;
  }
  function modsKey(m) { var n = normModsLocal(m); return MODULES.map(function (mod) { return n[mod.id] ? '1' : '0'; }).join(''); }
  function baseSchema() {
    if (E && Array.isArray(E.PARAMS)) return E.PARAMS;
    if (E && Array.isArray(E.SCHEMA)) return E.SCHEMA;
    if (MP && Array.isArray(MP.PARAMS)) return MP.PARAMS;
    if (MP && Array.isArray(MP.SCHEMA)) return MP.SCHEMA;
    return FALLBACK_SCHEMA;
  }
  function schemaFor(m) {
    if (E && typeof E.PARAMS_FOR === 'function') { try { var l = E.PARAMS_FOR(normModsLocal(m)); if (Array.isArray(l)) return l; } catch (e) { /* ignore */ } }
    if (MP && typeof MP.paramsFor === 'function') { try { var l2 = MP.paramsFor(normModsLocal(m)); if (Array.isArray(l2)) return l2; } catch (e) { /* ignore */ } }
    return baseSchema();
  }
  var PMS = {};
  function pmOf(m) { var k = (m && typeof m === 'object') ? modsKey(m) : modsKey(currentModules); if (!PMS[k]) PMS[k] = makePM(schemaFor(m && typeof m === 'object' ? m : currentModules)); return PMS[k]; }
  var allParams = baseSchema().slice(); MODULES.forEach(function (mod) { (mod.params || []).forEach(function (d) { allParams.push(d); }); });
  var pmAll = makePM(allParams);
  var currentModules = normModsLocal(null);
  try { var savedM = safeLS() && safeLS().getItem(LS_MODULES); if (savedM) currentModules = normModsLocal(JSON.parse(savedM)); } catch (e) { /* ignore */ }
  var impl = E ? wrapReal(E, pmOf) : makeStub(pmOf);
  var STATUS_META = {
    accepted: { label: '公认', cls: 'st-accepted' },
    'accepted-fact, no-mechanism': { label: '公认事实 · 无生成机制', cls: 'st-fact' },
    'mainstream-model': { label: '主流模型 · 未证实', cls: 'st-mainstream' },
    speculative: { label: '推测', cls: 'st-speculative' }
  };
  function statusMeta(st) { return STATUS_META[st] || (st ? { label: String(st), cls: 'st-other' } : STATUS_META.accepted); }
  var A = {
    isReal: !!E,
    engineVersion: E ? (E.version || null) : null,
    unitNote: baseSchema().length + TR(' 个公认基础参数'),
    OUTCOME_META: OUTCOME_META,
    OURS_ID: OURS_ID,
    MODULES: MODULES,
    hasModules: MODULES.length > 0,
    statusMeta: statusMeta,
    getModules: function () { return normModsLocal(currentModules); },
    setModules: function (m) { currentModules = normModsLocal(m); try { safeLS() && safeLS().setItem(LS_MODULES, JSON.stringify(currentModules)); } catch (e) { /* ignore */ } return A.getModules(); },
    normalizeModules: normModsLocal,
    modulesKey: modsKey,
    get PARAMS() { return pmOf(currentModules).SCHEMA; },
    paramsFor: function (m) { return pmOf(m || currentModules).SCHEMA; },
    paramDef: function (key) { return pmAll.byKey[key] || null; },
    defaults: function (m) { return pmOf(m || currentModules).defaults(); },
    normalize: function (p, m) { return pmOf(m || currentModules).normalize(p); },
    toUnit: function (k, v) { return pmAll.toUnit(k, v); },
    fromUnit: function (k, u) { return pmAll.fromUnit(k, u); },
    formatValue: function (k, v) { return pmAll.formatValue(k, v); },
    distance: function (p, q, m) { return pmOf(m || currentModules).distance(p, q); },
    isDefault: function (p, m) { return pmOf(m || currentModules).isDefault(p); },
    seedOf: function (p, m) { return impl.seedOf(p, m && typeof m === 'object' ? m : currentModules); },
    seedHex: function (p, m) { return ('00000000' + (impl.seedOf(p, m && typeof m === 'object' ? m : currentModules) >>> 0).toString(16)).slice(-8).toUpperCase(); },
    randomParams: function (m, opts) { return impl.randomParams(m || currentModules, opts); },
    // 有量纲常数（随单位约定重算）：sim 传进来的是 UI 的 sim，引擎要的是原始 result
    UNIT_CONVENTIONS: (E && E.UNIT_CONVENTIONS) || null,
    dimensionfulConstants: function (sim, conv) {
      if (!E || typeof E.dimensionfulConstants !== 'function') return null;
      var raw = (sim && sim.raw) || sim;
      try { return E.dimensionfulConstants(raw, conv); } catch (e) { console.warn('[adapter] dimensionfulConstants', e); return null; }
    },
    SPREADS: (E && E.SPREADS) || null,
    spreadLabel: function (sp) { try { return (E && E.spreadLabel) ? E.spreadLabel(sp) : ''; } catch (e) { return ''; } },
    searchStatistics: function (N, seed, o) { try { return (E && E.searchStatistics) ? E.searchStatistics(N, seed, o) : null; } catch (e) { return null; } },
    simulate: function (p, o) { o = o || {}; if (!o.modules) o.modules = currentModules; return impl.simulate(p, o); },
    createNBody: function (p, o) { o = o || {}; if (!o.modules) o.modules = currentModules; return impl.createNBody(p, o); },
    catalog: makeCatalog(impl, pmOf, normModsLocal),
    bangs: impl.bangs,
    formatId: formatId,
    rng: mulberry32,
    cnNum: cnNum,
    fmtTimeGyr: fmtTimeGyr
  };
  root.MirrorAdapter = A;
})(typeof window !== 'undefined' ? window : this);
