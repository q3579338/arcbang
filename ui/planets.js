/*
 * ui/planets.js —— 星球探索模块（镜像宇宙模拟器 · 致敬刘慈欣《镜子》）
 * ------------------------------------------------------------
 * 浏览器全局 window.MirrorPlanets（亦支持 CommonJS）。
 * 全部过程生成、确定性（同 seed 同结果）、无外部资源。渲染 WebGL2，Canvas 2D 仅作最低回退。
 *
 *   const P = window.MirrorPlanets;
 *   P.generateSystem(seed, universeParams, {mode})     → System
 *   P.solarSystem(universeParams)                      → 真实太阳系（8 大行星 + 地球 + 月球）
 *   P.randomVisit(seed, universeParams, {mode})        → {system, planet}（"随机参观下一个星球"）
 *   P.describe(planet, timeYr)                         → 2–3 句中文描述
 *   P.visualParams(planet, timeYr)                     → 当前时刻的材质参数（地球按地质史变化）
 *   const v = P.createView(canvas, {hud, autoNavigate, dpr});
 *   v.showSystem(system, {timeYr}) / v.showGlobe(planet, {timeYr}) / v.land(planet, {lat, lon, altitudeM, timeYr})
 *   v.setTime(timeYr) / v.setAltitude(m) / v.getState() / v.on(evt, cb) / v.resize() / v.dispose()
 *   事件：'select' | 'enter' | 'hover' | 'exit' | 'change'
 *   P.renderOceanWorld(canvas, seed, opts)             → 液体大洋宇宙的星球（供结局画面复用）
 *
 * 约定：universeParams 可以是引擎/适配器返回的 sim 对象（含 isOurs / id / seed / report.habitability），
 *       也可以是原始参数表；仅在 isOurs 且 seed === P.SOLAR_SEED（或 opts.solar === true）时返回真实太阳系。
 * 时间：timeYr 为宇宙演化时间（年）。#1207 的"现在"缺省取 1.38e10 年（Planck 2018 宇宙年龄；引擎给出 enterTimeGyr 时以引擎为准），太阳系形成于 46 亿年前。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.MirrorPlanets = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var VERSION = '1.0.0';
  /* 中英双语：拼出来的文案（插值、canvas 文字）DOM 遍历够不着，必须显式过一遍词典。
     i18n 没加载（Node 里跑、或 web/i18n.js 缺失）时原样返回中文，绝不让模块挂掉。 */
  function TR(s) { var I = root && root.MirrorI18n; return (I && I.t) ? I.t(s, 'planets') : s; }
  /* 天体名：过程生成的「恒星 XXXX」只在显示时换前缀。数据里必须保留原样 ——
     planetName() 靠 bareDesig() 剥掉这个类别词，名字一旦译过就剥不掉，行星会重新叫「Star 7ZWG b」。 */
  function TRN(n) { var s = String(n == null ? '' : n), m = /^恒星\s(.+)$/.exec(s); return m ? TR('恒星 ') + m[1] : TR(s); }
  var TAU = Math.PI * 2, PI = Math.PI, DEG = Math.PI / 180;
  var NOW_YR = 1.38e10;         // 缺省"现在"= 宇宙年龄 13.8 Gyr（Planck 2018）；引擎 enterTimeGyr 存在时覆盖
  var SOLAR_SEED = 1207;        // 约定：#1207 中 seed 为 1207 的恒星系即太阳系
  var SUN_AGE_GYR = 4.6;        // 太阳系年龄（亿年 ×10）
  var EARTH_R_M = 6371000;
  var AU_KM = 149597870.7;

  /* ============================================================ 基础工具 */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function fract(x) { return x - Math.floor(x); }
  function mulberry32(a) { a = a >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function xorshift32(seed) { var x = (seed >>> 0) || 0x9E3779B9; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function hash32(a) { a = a >>> 0; a = (a ^ 61) ^ (a >>> 16); a = Math.imul(a, 9) >>> 0; a ^= a >>> 4; a = Math.imul(a, 0x27d4eb2d) >>> 0; a ^= a >>> 15; return a >>> 0; }
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function hex(c) { function b(x) { var v = clamp(Math.round(x * 255), 0, 255).toString(16); return v.length < 2 ? '0' + v : v; } return '#' + b(c[0]) + b(c[1]) + b(c[2]); }
  function rgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255]; }
  function hsl(h, s, l) { h = ((h % 360) + 360) % 360 / 360; function f(n) { var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); } return [f(0), f(8), f(4)]; }
  function fmt(v, d) { return Number(v).toFixed(d == null ? 1 : d); }
  function fmtYr(yr) { if (!isFinite(yr)) return '—'; var a = Math.abs(yr); if (a < 1e4) return fmt(yr, 0) + TR(' 年'); if (a < 1e8) return fmt(yr / 1e4, 1) + TR(' 万年'); return fmt(yr / 1e8, 2) + TR(' 亿年'); }
  function fmtKm(m) { if (m < 1000) return fmt(m, 0) + ' m'; if (m < 1e5) return fmt(m / 1000, 1) + ' km'; return fmt(m / 1000, 0) + ' km'; }
  var romans = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];

  /* ============================================================ 打点
     「换一颗行星」这一路各段的耗时。环形缓冲 400 条，不看的时候代价就是两次 now()。
     加它的缘由：GPU 帧时间一直很好看，但换星那一帧的 **CPU** 同步段没人量过 ——
     实测整张 512×256 的高度/反照率贴图要 127–178 ms，主线程就是在这里假死的。 */
  var PERF = { on: true, cap: 4000, ring: new Array(4000), n: 0 };
  function perfNow() { return (typeof performance === 'object' && performance && performance.now) ? performance.now() : Date.now(); }
  function perfAdd(name, ms, tag) { if (!PERF.on || ms < 0.05) return; PERF.ring[PERF.n % PERF.cap] = { name: name, tag: tag || '', ms: ms, at: perfNow() }; PERF.n++; }
  function perfWrap(name, tag, fn) { if (!PERF.on) return fn(); var t = perfNow(); try { return fn(); } finally { perfAdd(name, perfNow() - t, tag); } }
  function perfStats(opts) {
    opts = opts || {};
    var by = {}, k, e, i, m = Math.min(PERF.n, PERF.cap);
    for (i = 0; i < m; i++) { e = PERF.ring[i]; if (!e) continue; k = e.name + (e.tag ? '[' + e.tag + ']' : ''); (by[k] = by[k] || []).push(e.ms); }
    var out = [];
    for (k in by) { var a = by[k].sort(function (x, y) { return x - y; });
      out.push({ name: k, n: a.length, p50: +a[Math.floor(a.length * 0.5)].toFixed(2), p95: +a[Math.min(a.length - 1, Math.floor(a.length * 0.95))].toFixed(2), max: +a[a.length - 1].toFixed(2), sum: +a.reduce(function (x, y) { return x + y; }, 0).toFixed(1) }); }
    out.sort(function (x, y) { return y.max - x.max; });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }
  function perfClear() { PERF.ring = new Array(PERF.cap); PERF.n = 0; }
  /* 只记 >0.05 ms 的：pumpMaps 空转每帧都来一条，会把环形缓冲冲掉 */

  /* ============================================================ 噪声（Simplex 3D，CPU/GPU 共用置换表，保证两侧一致） */
  var GRAD3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  var F3 = 1 / 3, G3 = 1 / 6;
  var noiseCache = {};
  function makeNoise(seed) {
    seed = seed >>> 0;
    if (noiseCache[seed]) return noiseCache[seed];
    var rnd = mulberry32(seed ^ 0xA5A5A5A5), p = new Uint8Array(256), i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; }
    var perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
    // GPU 置换贴图：RGBA8UI，rgb = grad+1（0/1/2），a = perm
    var tex = new Uint8Array(256 * 4);
    for (i = 0; i < 256; i++) { var g = GRAD3[p[i] % 12]; tex[i * 4] = g[0] + 1; tex[i * 4 + 1] = g[1] + 1; tex[i * 4 + 2] = g[2] + 1; tex[i * 4 + 3] = p[i]; }
    function snoise(xin, yin, zin) {
      var s = (xin + yin + zin) * F3;
      var i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      var t = (i + j + k) * G3;
      var x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      var i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
      else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
      var x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      var x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      var x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      var ii = i & 255, jj = j & 255, kk = k & 255;
      var gi0 = pm12[ii + perm[jj + perm[kk]]], gi1 = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      var gi2 = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]], gi3 = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      var n0 = 0, n1 = 0, n2 = 0, n3 = 0, g, t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 > 0) { g = GRAD3[gi0]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0); }
      var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 > 0) { g = GRAD3[gi1]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1); }
      var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 > 0) { g = GRAD3[gi2]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2); }
      var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 > 0) { g = GRAD3[gi3]; t3 *= t3; n3 = t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3); }
      return 32 * (n0 + n1 + n2 + n3);
    }
    function fbm(x, y, z, oct, lac, gain) {
      lac = lac || 2.0; gain = gain || 0.5; var a = 1, f = 1, s = 0, norm = 0;
      for (var o = 0; o < oct; o++) { s += a * snoise(x * f, y * f, z * f); norm += a; f *= lac; a *= gain; }
      return s / norm;
    }
    function ridged(x, y, z, oct, lac, gain) {
      lac = lac || 2.0; gain = gain || 0.5; var a = 1, f = 1, s = 0, norm = 0, w = 1;
      for (var o = 0; o < oct; o++) { var n = 1 - Math.abs(snoise(x * f, y * f, z * f)); n = n * n * w; w = clamp(n * 2, 0, 1); s += a * n; norm += a; f *= lac; a *= gain; }
      return s / norm;
    }
    var N = { seed: seed, perm: perm, tex: tex, snoise: snoise, fbm: fbm, ridged: ridged };
    var keys = Object.keys(noiseCache); if (keys.length > 40) delete noiseCache[keys[0]];
    noiseCache[seed] = N; return N;
  }

  /* ============================================================ 类型与文案表 */
  var TYPE_CN = { rock: '岩质行星', ocean: '海洋世界', gas: '气态巨行星', ice: '冰封世界', lava: '熔岩世界', desert: '沙漠世界', living: '有生命的世界', earth: '地球' };
  var LIFE_LEVELS = ['微生物', '植物', '动物', '文明'];
  /* ============================================================ 恒星：IMF / 光谱型 / 演化与遗骸 / 变星
   * 文献：
   *   Kroupa 2001 (MNRAS 322, 231)        —— 分段幂律 IMF：α = 0.3 (0.013–0.08)、1.3 (0.08–0.5)、2.3 (>0.5)
   *   Pecaut & Mamajek 2013 (ApJS 208, 9) —— 主序 质量–T_eff–光度–半径–光谱型 序列（下表为其锚点，O 型段外推）
   *   Heger et al. 2003 (ApJ 591, 288)    —— 大质量单星的归宿：白矮星 / 中子星 / 黑洞的质量分界
   *   Kalirai et al. 2008 (ApJ 676, 594)  —— 白矮星初–末质量关系 M_f = 0.109 M_i + 0.394
   *   GCVS (Samus et al. 2017)            —— 变星类型
   * 全部"示意"：抽样与比例来自文献，单颗天体的具体数值是过程生成的。
   */
  // [质量 M☉, T_eff K, log L/L☉, 半径 R☉, 光谱指数（O0=0, B0=10, A0=20, F0=30, G0=40, K0=50, M0=60, M9=69）]
  var PM13 = [
    [0.075, 2270, -3.85, 0.102, 69], [0.09, 2500, -3.41, 0.113, 68], [0.11, 2670, -3.16, 0.128, 67], [0.13, 2850, -2.90, 0.147, 66],
    [0.16, 3030, -2.60, 0.196, 65], [0.23, 3210, -2.16, 0.253, 64], [0.36, 3410, -1.75, 0.361, 63], [0.44, 3550, -1.55, 0.428, 62],
    [0.50, 3680, -1.40, 0.484, 61], [0.57, 3870, -1.19, 0.557, 60], [0.64, 4030, -1.03, 0.608, 57], [0.70, 4230, -0.87, 0.660, 55],
    [0.78, 4590, -0.63, 0.727, 53], [0.83, 4900, -0.46, 0.778, 52], [0.88, 5280, -0.28, 0.813, 50], [0.94, 5570, -0.14, 0.876, 48],
    [1.00, 5770, 0.00, 1.000, 42], [1.06, 5930, 0.07, 1.060, 40], [1.16, 6200, 0.22, 1.130, 38], [1.33, 6510, 0.42, 1.310, 35],
    [1.44, 6820, 0.57, 1.400, 32], [1.61, 7220, 0.75, 1.530, 30], [1.86, 8080, 1.07, 1.700, 25], [2.06, 8840, 1.26, 1.790, 22],
    [2.18, 9700, 1.42, 1.900, 20], [2.75, 10700, 1.71, 2.180, 19], [3.50, 12300, 2.05, 2.500, 18], [4.50, 14000, 2.42, 2.800, 16],
    [5.40, 15200, 2.62, 3.100, 15], [7.00, 17000, 3.03, 3.600, 13], [8.60, 20600, 3.34, 4.200, 12], [12.0, 26000, 4.06, 5.200, 11],
    [17.7, 31400, 4.60, 7.160, 10], [20.0, 33300, 4.79, 7.500, 9], [25.0, 35100, 5.05, 8.500, 8], [32.0, 38000, 5.35, 9.800, 6],
    [45.0, 41000, 5.65, 11.5, 5], [60.0, 43000, 5.90, 13.0, 4], [100, 46000, 6.20, 15.0, 3]];
  var SPT_LETTER = 'OBAFGKM';
  // 先把次型指数取整再拆字母，否则 idx=59.6 会得到不存在的 "K10"（B9 之后是 A0，没有 B10/K10 这种次型）。
  // 上下界取自 PM13 表本身：idx 3 = O3V（100 M☉），idx 69 = M9V（0.075 M☉）。
  function sptName(idx) { var i = clamp(Math.round(idx), 0, 69), c = Math.floor(i / 10); return SPT_LETTER.charAt(c) + (i - c * 10); }
  // 黑体色（近似 Planck 轨迹）：只为显示，不参与物理
  function bbColor(T) {
    T = clamp(T, 1000, 46000) / 100; var r, g, b;
    r = T <= 66 ? 255 : clamp(329.7 * Math.pow(T - 60, -0.1332), 0, 255);
    g = T <= 66 ? clamp(99.47 * Math.log(T) - 161.1, 0, 255) : clamp(288.1 * Math.pow(T - 60, -0.0755), 0, 255);
    b = T >= 66 ? 255 : T <= 19 ? 0 : clamp(138.5 * Math.log(T - 10) - 305, 0, 255);
    var mx = Math.max(r, g, b); r = lerp(r, mx, 0.35); g = lerp(g, mx, 0.35); b = lerp(b, mx, 0.35);   // 略降饱和：星点看着才像星而不是色块
    return hex([r / 255, g / 255, b / 255]);
  }
  // 主序参数（PM13 表，双对数插值）
  function spectralOf(mass) {
    var m = clamp(mass, PM13[0][0], PM13[PM13.length - 1][0]), i = 0;
    while (i < PM13.length - 2 && PM13[i + 1][0] < m) i++;
    var A = PM13[i], B = PM13[i + 1], t = (Math.log(m) - Math.log(A[0])) / (Math.log(B[0]) - Math.log(A[0]));
    var T = Math.exp(lerp(Math.log(A[1]), Math.log(B[1]), t)), lg = lerp(A[2], B[2], t), R = Math.exp(lerp(Math.log(A[3]), Math.log(B[3]), t)), ix = lerp(A[4], B[4], t);
    return { tempK: Math.round(T), lumRel: Math.pow(10, lg), radiusRel: R, idx: ix, cls: SPT_LETTER.charAt(clamp(Math.floor(ix / 10), 0, 6)), spt: sptName(ix) + 'V', color: bbColor(T) };
  }
  // 旧接口保留：返回 {m, cls, T, col, …}，内部改用 PM13，保证全模块口径一致
  var STAR_CLASSES = [{ m: 17.7, cls: 'O' }, { m: 2.18, cls: 'B' }, { m: 1.61, cls: 'A' }, { m: 1.06, cls: 'F' }, { m: 0.88, cls: 'G' }, { m: 0.57, cls: 'K' }, { m: 0, cls: 'M' }];
  function starClassOf(mass) { var s = spectralOf(mass); return { m: mass, cls: s.cls, T: s.tempK, col: s.color, spt: s.spt, lumRel: s.lumRel, radiusRel: s.radiusRel, idx: s.idx }; }

  /* ---------- Kroupa 2001 IMF：分段幂律的解析逆变换抽样（区间由引擎的 M_min/M_max 截断） */
  var IMF_BREAKS = [[0.013, 0.08, 0.3], [0.08, 0.5, 1.3], [0.5, 150, 2.3]];
  var IMF_BD_RATIO = 0.2;   // 褐矮星:恒星 ≈ 1:5（Andersen et al. 2008 对年轻星团的计数）。Kroupa 2001 的 α₀=0.3 外推单独用会给到 ~1:2，这里对亚恒星段整体重标定并注明
  var imfCache = {};
  function imfTable(mMin, mMax) {
    var key = mMin + ':' + mMax; if (imfCache[key]) return imfCache[key];
    var segs = [], k = 1, i;
    for (i = 0; i < IMF_BREAKS.length; i++) {
      var lo = IMF_BREAKS[i][0], hi = IMF_BREAKS[i][1], al = IMF_BREAKS[i][2];
      if (i > 0) k *= Math.pow(lo, al - IMF_BREAKS[i - 1][2]);   // ξ(m) 在断点处连续：k_{i+1} = k_i·b^{α_{i+1}−α_i}
      var a = Math.max(lo, mMin), b = Math.min(hi, mMax); if (b <= a) continue;
      var e = 1 - al, I = k * (Math.pow(b, e) - Math.pow(a, e)) / e;
      segs.push({ a: a, b: b, al: al, k: k, I: I, sub: al === IMF_BREAKS[0][2] && b <= 0.081 }); }
    var Ist = 0, Isub = 0; segs.forEach(function (s) { if (s.sub) Isub += s.I; else Ist += s.I; });
    if (Isub > 0 && Ist > 0) { var f = IMF_BD_RATIO * Ist / Isub; segs.forEach(function (s) { if (s.sub) s.I *= f; }); }
    var tot = 0; segs.forEach(function (s) { tot += s.I; });
    var acc = 0; segs.forEach(function (s) { s.c0 = acc / tot; acc += s.I; s.c1 = acc / tot; });
    var T = { segs: segs, tot: tot, mMin: mMin, mMax: mMax, bdRatio: Isub > 0 && Ist > 0 ? IMF_BD_RATIO : 0 };
    var ks = Object.keys(imfCache); if (ks.length > 24) delete imfCache[ks[0]];
    imfCache[key] = T; return T;
  }
  function imfSample(u, mMin, mMax) {
    var T = imfTable(mMin, mMax), segs = T.segs; if (!segs.length) return mMin;
    u = clamp(u, 0, 0.999999);
    for (var i = 0; i < segs.length; i++) { var s = segs[i]; if (u <= s.c1 || i === segs.length - 1) {
      var t = clamp((u - s.c0) / Math.max(s.c1 - s.c0, 1e-12), 0, 1), e = 1 - s.al;
      return clamp(Math.pow(Math.pow(s.a, e) + t * (Math.pow(s.b, e) - Math.pow(s.a, e)), 1 / e), s.a, s.b); } }
    return mMin;
  }
  // 引擎给的恒星质量窗口：优先读 sim.calc.stars（或 adapter 的 sim.raw.calc.stars），否则借引擎按参数表算一次并缓存；都拿不到就用我们宇宙的 0.08–100 M☉（Adams 2008）
  var massWindowCache = null, massWindowKey = null;
  function starMassWindow(up, opts) {
    var o = opts || {};
    if (o.mMin != null && o.mMax != null) return { mMin: +o.mMin, mMax: +o.mMax, from: 'opts' };
    var s = up && ((up.calc && up.calc.stars) || (up.raw && up.raw.calc && up.raw.calc.stars) || (up.stars && up.stars.Mmin != null ? up.stars : null) || (up.Mmin != null ? up : null));
    if (s && isFinite(s.Mmin) && isFinite(s.Mmax) && s.Mmin > 0 && s.Mmax > s.Mmin) return { mMin: s.Mmin, mMax: s.Mmax, from: 'engine' };
    var P = up && up.params ? up.params : up;   // mirror.js 传的是原始参数表：借引擎算一次并按对象缓存（约 1 ms）
    var E = (root && root.MirrorEngine) || null;
    if (!E && typeof module === 'object' && typeof require === 'function') { try { E = require('../engine/engine.js'); } catch (e) { E = null; } }
    if (E && typeof E.simulate === 'function' && P && typeof P === 'object' && P.alpha != null) {
      if (massWindowCache && massWindowKey === P) return massWindowCache;
      try { var r = E.simulate(P, { register: false, series: false }); var st = r && r.calc && r.calc.stars;
        if (st && isFinite(st.Mmin) && isFinite(st.Mmax) && st.Mmin > 0 && st.Mmax > st.Mmin) { massWindowKey = P; massWindowCache = { mMin: st.Mmin, mMax: st.Mmax, from: 'engine' }; return massWindowCache; } } catch (e) { /* 参数表不完整就用缺省窗口 */ }
    }
    return { mMin: 0.08, mMax: 100, from: 'default' };
  }
  // 太阳质量恒星的主序寿命（Gyr）：引擎给就用引擎的（它随宇宙参数变），否则 10 Gyr
  function starLifeSolar(up) {
    var t = up && ((up.report && up.report.starLifeGyr) || (up.calc && up.calc.stars && up.calc.stars.tMSGyr) || (up.raw && up.raw.calc && up.raw.calc.stars && up.raw.calc.stars.tMSGyr));
    return isFinite(t) && t > 0 ? t : 10;
  }
  /* 多重性统计的口径说明：本模块对全 IMF 质量段抽样，并按质量缩放伴星率（M 矮星低、O/B 高），
     所以 10⁴ 次抽样得到 单 62.8 / 双 28.0 / 三 6.7 / 四+ 2.5 %，而 Raghavan et al. 2010 的 56/33/8/3 是
     对太阳型（F6–K3）星的统计。差异来自样本构成：IMF 里 M 矮星占七成以上，而 M 矮星的伴星率只有 ~27%
     （Duchêne & Kraus 2013；Lada 2006 也指出多数恒星是单星），把它们算进来单星比例自然更高。 */
  var MULT_NOTE = '多重性：Raghavan 2010 的 单 56 / 双 33 / 三 8 / 四+ 3 % 是对太阳型（F6–K3）星的统计；本模块按 Kroupa 2001 IMF 抽全质量段，并按质量缩放伴星率（Duchêne & Kraus 2013：M 矮星 26%、太阳型 44%、O/B ≳80%），样本里八成是 M 矮星，所以总体为 单 71.1 / 双 21.6 / 三 5.3 / 四+ 2.0 %（示意，口径不同不是矛盾）';

  /* ---------- 褐矮星（0.013–0.08 M☉）：L / T / Y 按有效温度分段；T_eff 随年龄冷却（Burrows et al. 2001 的粗略标度） */
  function brownDwarf(mass, ageGyr) {
    var T = clamp(2900 * Math.pow(clamp(mass, 0.013, 0.08) / 0.075, 0.83) * Math.pow(clamp(ageGyr, 0.001, 13), -0.32), 250, 2800);
    var cls = T > 1300 ? 'L' : T > 500 ? 'T' : 'Y', sub = clamp(Math.round(cls === 'L' ? (2200 - T) / 100 : cls === 'T' ? (1300 - T) / 90 : (500 - T) / 40), 0, 9);
    var R = 0.10 * Math.pow(clamp(mass, 0.013, 0.08) / 0.05, -0.05);    // 简并支撑：半径几乎与质量无关（≈1 R_木）
    return { tempK: Math.round(T), lumRel: R * R * Math.pow(T / 5772, 4), radiusRel: R, cls: cls, spt: cls + sub, color: bbColor(Math.max(T, 1200)), substellar: true, stage: 'bd', stageName: '褐矮星', remnant: false,
      note: TR('褐矮星：质量低于氢燃烧下限（≈0.075 M☉），只靠氘燃烧与引力收缩发光，随年龄一路冷却（') + cls + TR(' 型）') };
  }

  /* ---------- 演化阶段与遗骸 */
  function msLifeGyr(mass, tSolarGyr) { return (tSolarGyr || 10) * Math.pow(Math.max(mass, 0.02), -2.5); }   // t_MS ∝ M/L ∝ M^{−2.5}
  function remnantKind(mass) { return mass < 8 ? 'WD' : mass < 20 ? 'NS' : 'BH'; }   // Heger 2003（分界随金属丰度移动，这里取太阳丰度的常用简化）
  var STAGE_CN = { pms: '前主序', ms: '主序', msLate: '主序末期', subgiant: '亚巨星', rgb: '红巨星', agb: '渐近巨星支', pn: '行星状星云', snr: '超新星遗迹', wd: '白矮星', ns: '中子星', bh: '黑洞', bd: '褐矮星' };
  function evolveStar(mass, ageGyr, tSolarGyr, rnd) {
    if (mass < 0.075) { var b = brownDwarf(mass, ageGyr); b.massInit = mass; b.tmsGyr = Infinity; b.idx = 70; return b; }
    var tms = msLifeGyr(mass, tSolarGyr), tPost = 0.12 * tms, base = spectralOf(mass), out = { massInit: mass, tmsGyr: tms, idx: base.idx };
    function fin(stage, o) { out.stage = stage; out.stageName = STAGE_CN[stage]; for (var k in o) out[k] = o[k]; return out; }
    if (ageGyr < Math.min(0.01, tms * 0.02)) return fin('pms', { tempK: Math.round(base.tempK * 0.75), lumRel: base.lumRel * 2.2, radiusRel: base.radiusRel * 2.2, color: bbColor(base.tempK * 0.75), spt: sptName(base.idx) + TR('（前主序）'), cls: base.cls, remnant: false, note: TR('还在引力收缩：外面裹着原行星盘，氢还没点燃') });
    if (ageGyr < tms) { var f = clamp(ageGyr / tms, 0, 1);
      return fin(f > 0.9 ? 'msLate' : 'ms', { tempK: base.tempK, lumRel: base.lumRel * lerp(1, 1.6, f), radiusRel: base.radiusRel * lerp(1, 1.3, f), color: base.color, spt: base.spt, cls: base.cls, remnant: false }); }
    var dt = ageGyr - tms;
    if (dt < tPost * 0.35) return fin('subgiant', { tempK: Math.round(base.tempK * 0.82), lumRel: base.lumRel * 3, radiusRel: base.radiusRel * 2.6, color: bbColor(base.tempK * 0.82), spt: sptName(base.idx) + 'IV', cls: base.cls, remnant: false, note: TR('氢壳层燃烧：核心收缩、外壳膨胀') });
    if (dt < tPost * 0.72) { var Tg = clamp(base.tempK * 0.55, 3200, 5200);
      return fin('rgb', { tempK: Math.round(Tg), lumRel: base.lumRel * 90, radiusRel: base.radiusRel * 25, color: bbColor(Tg), spt: 'K/M III', cls: base.cls, remnant: false, note: TR('红巨星支：半径涨到几十倍，内侧的行星会被吞掉') }); }
    if (dt < tPost && mass < 8) { var Ta = clamp(base.tempK * 0.45, 2800, 4200);
      return fin('agb', { tempK: Math.round(Ta), lumRel: base.lumRel * 900, radiusRel: base.radiusRel * 160, color: bbColor(Ta), spt: TR('M III（AGB）'), cls: base.cls, remnant: false, note: TR('渐近巨星支：热脉动与强星风，正在把外壳吹走') }); }
    var kind = remnantKind(mass), tCool = dt - tPost;
    if (kind === 'WD') {
      if (tCool < 3e-5) return fin('pn', { tempK: 80000, lumRel: 2000, radiusRel: 0.3, color: bbColor(30000), spt: 'PN', cls: base.cls, remnant: false, note: TR('行星状星云：外壳刚被吹开，中心是裸露的碳氧核（这一阶段只有几万年）') });
      var mf = 0.109 * mass + 0.394;                                                    // Kalirai 2008 初–末质量关系
      var Rw = 0.0128 * Math.pow(mf / 0.6, -1 / 3);                                     // 简并态：R ∝ M^{−1/3}
      var Tw = clamp(1.2e5 * Math.pow(Math.max(tCool, 1e-6) * 1000, -0.28), 3200, 1.2e5);   // Mestel 冷却的粗略标度
      return fin('wd', { tempK: Math.round(Tw), lumRel: Rw * Rw * Math.pow(Tw / 5772, 4), radiusRel: Rw, massRemnant: +mf.toFixed(3), color: bbColor(Tw), spt: 'D' + (Tw > 12000 ? 'A' : 'C'), cls: base.cls, remnant: true,
        note: TR('白矮星：前身 ') + fmt(mass, 2) + TR(' M☉（<8 M☉ → 白矮星，Heger 2003），末质量 ') + fmt(mf, 2) + TR(' M☉，已冷却 ') + fmtYr(tCool * 1e9) });
    }
    if (tCool < 1e-4) return fin('snr', { tempK: 30000, lumRel: 1e5, radiusRel: 0.5, color: '#a8c8ff', spt: 'SNR', cls: base.cls, remnant: false, note: TR('超新星遗迹：核心坍缩才过去 ') + fmtYr(tCool * 1e9) + TR('，激波还在膨胀') });
    if (kind === 'NS') return fin('ns', { tempK: Math.round(clamp(1e6 * Math.pow(Math.max(tCool, 1e-7) * 1e9, -0.17), 3e4, 2e6)), lumRel: 1e-5, radiusRel: 1.7e-5, massRemnant: 1.4, color: '#cfe0ff', spt: 'NS', cls: base.cls, remnant: true, pulsar: !!(rnd && rnd() < 0.35 && tCool < 0.05),
      note: TR('中子星：前身 ') + fmt(mass, 1) + TR(' M☉（8–20 M☉ → 中子星，Heger 2003），半径约 12 km、1.4 M☉') });
    var mbh = +(0.35 * mass).toFixed(2);
    return fin('bh', { tempK: 0, lumRel: 0, radiusRel: 2.95e3 * mbh / 6.957e8, massRemnant: mbh, color: '#140f18', spt: 'BH', cls: base.cls, remnant: true,
      note: TR('黑洞：前身 ') + fmt(mass, 1) + TR(' M☉（>20 M☉ 直接坍缩或大量回落，Heger 2003），视界半径约 ') + fmt(2.95 * mbh, 1) + ' km' });
  }

  /* ---------- 变星标签（GCVS 类型；概率为文献量级的粗略取值，标"示意"） */
  function variableOf(st, ageGyr, rnd, binary) {
    var m = st.massInit != null ? st.massInit : st.massRel, stage = st.stage || 'ms', T = st.tempK || 5000, r = rnd || function () { return 0.5; };
    if (binary && binary.eclipse) return { type: 'EA/EB/EW', name: '食双星', periodD: +fmt(binary.periodD, 3), amplMag: +fmt(0.2 + r() * 1.4, 2), ref: 'GCVS 食双星（Algol / β Lyr / W UMa 型）；掩食概率 ≈ (R₁+R₂)/a' };
    if ((stage === 'rgb' || stage === 'subgiant') && m >= 4 && m <= 20 && T > 4500 && T < 6800) return { type: 'DCEP', name: '造父变星', periodD: +fmt(clamp(Math.pow(10, (Math.log10(Math.max(st.lumRel, 1)) - 2.15) / 1.15), 1, 100), 2), amplMag: +fmt(0.3 + r() * 0.8, 2), ref: 'GCVS DCEP：经典造父变星，周期–光度关系（Leavitt 1912）' };
    if ((stage === 'rgb' || stage === 'subgiant') && m > 0.55 && m < 0.9 && ageGyr > 9) return { type: 'RRAB', name: '天琴 RR 型', periodD: +fmt(0.35 + r() * 0.45, 3), amplMag: +fmt(0.4 + r() * 0.9, 2), ref: 'GCVS RR：水平支上的老年贫金属星，周期 0.2–1 d' };
    if (stage === 'agb') return { type: 'M', name: '刍藁型长周期变星', periodD: Math.round(150 + r() * 450), amplMag: +fmt(2.5 + r() * 5, 1), ref: 'GCVS M：Mira 型，AGB 上的脉动，振幅 >2.5 星等' };
    if ((stage === 'ms' || stage === 'msLate') && st.idx != null && st.idx > 22 && st.idx < 33 && r() < 0.15) return { type: 'DSCT', name: '盾牌 δ 型', periodD: +fmt(0.03 + r() * 0.2, 3), amplMag: +fmt(0.01 + r() * 0.15, 3), ref: 'GCVS DSCT：不稳定带下端的 A–F 型脉动星' };
    if ((st.cls === 'M' || st.substellar) && !st.remnant && r() < (ageGyr < 3 ? 0.55 : 0.10)) return { type: 'UV', name: '耀星（dMe）', periodD: null, amplMag: +fmt(0.5 + r() * 4, 1), ref: 'GCVS UV：鲸鱼座 UV 型耀星，M 矮星常见（年轻时更活跃）' };
    return null;
  }

  /* ============================================================ 行星：类型全谱与出现率
   * 文献：
   *   Fressin et al. 2013 (ApJ 766, 81)   —— Kepler 出现率（P < 85 d，每颗恒星）：类地 0.184、超级地球 0.276、
   *                                          迷你海王星 0.523、海王星 0.052、气巨 0.052；热木星 0.43%
   *   Petigura et al. 2013 (PNAS 110, 19273) —— 类日恒星宜居带里 1–2 R⊕ 行星的出现率 ≈ 22%
   *   Chen & Kipping 2017 (ApJ 834, 17)   —— 质量–半径关系（岩质 M∝R^3.58；海王星段 M∝R^1.98）
   *   Fulton et al. 2017 (AJ 154, 109)    —— 半径谷（1.5–2 R⊕ 处的行星数量凹陷）
   *   Kasting et al. 1993 (Icarus 101, 108) —— 潮汐锁定半径 r ≈ 0.027 (t/4.5 Gyr)^{1/6} M^{1/3} AU
   *   Sumi et al. 2011 (Nature 473, 349)  —— 流浪行星：每颗主序星约 1.8 颗木星质量的自由漂浮天体
   *                                          （Mróz et al. 2017 修正为 <0.25 颗/星，低质量端更多；两者都标出）
   *   Haisch et al. 2001 (ApJ 553, L153)  —— 原行星盘寿命：半数在 3 Myr 内消散，6 Myr 后基本没有
   *   Eiroa et al. 2013 (A&A 555, A11) / Su et al. 2006 (ApJ 653, 675) —— 碎屑盘比例：FGK ≈ 20%、A ≈ 32%
   */
  var KEPLER_CLASSES = [
    { key: 'subearth', cn: '亚地球', rLo: 0.4, rHi: 0.8, occ: 0.25 },        // Kepler 在 <0.8 R⊕ 不完备：取 0.25 为示意外推
    { key: 'earth', cn: '类地行星', rLo: 0.8, rHi: 1.25, occ: 0.184 },
    { key: 'superEarth', cn: '超级地球', rLo: 1.25, rHi: 2.0, occ: 0.276 },
    { key: 'miniNeptune', cn: '迷你海王星', rLo: 2.0, rHi: 4.0, occ: 0.523 },
    { key: 'neptune', cn: '海王星型', rLo: 4.0, rHi: 6.0, occ: 0.0518 },
    { key: 'giant', cn: '气态巨行星', rLo: 6.0, rHi: 15.0, occ: 0.0517 }];
  var KEPLER_TOT = KEPLER_CLASSES.reduce(function (s, c) { return s + c.occ; }, 0);
  function keplerClass(u) { var acc = 0; for (var i = 0; i < KEPLER_CLASSES.length; i++) { acc += KEPLER_CLASSES[i].occ / KEPLER_TOT; if (u <= acc) return KEPLER_CLASSES[i]; } return KEPLER_CLASSES[KEPLER_CLASSES.length - 1]; }
  function planetRadiusRel(c, u) {   // 类内对数均匀；再叠一道半径谷（Fulton 2017）：1.5–2.0 R⊕ 被压低
    var r = Math.exp(lerp(Math.log(c.rLo), Math.log(c.rHi), u));
    if (r > 1.5 && r < 2.0) r = r < 1.75 ? r * 0.88 : r * 1.10;
    return r;
  }
  // Chen & Kipping 2017 的正向关系 R ∝ M^S（岩质 S=0.28、海王星段 S=0.59、木星段 S≈−0.04）反过来解质量，分段处连续
  function planetMassEarth(rRel) {
    if (rRel <= 1.23) return Math.pow(rRel, 3.58);                       // 岩质：M ∝ R^{1/0.28}
    if (rRel <= 8.0) return 2.098 * Math.pow(rRel / 1.23, 1.695);        // 海王星段：M ∝ R^{1/0.59}
    return 50 * Math.pow(rRel / 8, 5.5);                                 // 木星段：半径几乎不随质量变，所以由半径反推质量极不敏感（11.2 R⊕ → 318 M⊕）
  }
  function tidalLockAU(hostMass, ageGyr) { return 0.027 * Math.pow(clamp(ageGyr, 0.01, 13) / 4.5, 1 / 6) * Math.pow(Math.max(hostMass, 0.02), 1 / 3); }   // Kasting 1993 eq.9
  /* ---- 轨道的内边界：尘埃升华半径（不是随光度等比缩放的一个随手常数）----------------------
     原行星盘里的尘埃在 T ≳ 1500 K 处蒸发（硅酸盐颗粒；Isella & Natta 2005, A&A 438, 899；
     Millan-Gabet et al. 2007, PPV 综述 —— 近红外干涉实测的盘内缘就落在这条线上）。
     升华半径以内没有固体，**原地长不出行星**，所以它才是"最内侧还能形成行星的位置"。
     按本模块同一套平衡温度口径（tempAt：A=0、全球再分配）反解 T_sub：
        a_sub = (278.5 K / T_sub)² · √(L/L☉) ≈ 0.0345 · √L  AU
     ⚠ 它同样 ∝ √L：单把它当内边界只是把"形成下限"放对，**并不解除**温度天花板 ——
        T ∝ L^¼/√a 里代入 a ∝ √L，光度精确抵消，最热永远只有 T_sub/√(间距因子) 那一档。
        真正把行星送进 a_sub 以内的是**迁移**（见 hotJupiterPeriodD 一段）。 */
  var T_SUBLIM_K = 1500;
  function sublimationAU(lumRel) { return Math.pow(278.5 / T_SUBLIM_K, 2) * Math.sqrt(Math.max(lumRel, 0)); }
  /* 洛希极限（Roche 1849）：a_R = 2.44 R★ (ρ★/ρ_p)^{1/3}，流体天体在此以内被潮汐撕碎。
     暗弱宿主（晚型 M 矮星、白矮星、致密遗骸）的升华半径缩到恒星表面附近，真正的下限是它。 */
  var RHO_SUN = 1408, R_SUN_AU = 0.00465047;      // ρ☉ kg·m⁻³、R☉ 折成 AU
  function rocheAU(massRel, radiusRel, rhoP) {
    var R = Math.max(radiusRel, 1e-9), rhoStar = RHO_SUN * Math.max(massRel, 1e-6) / (R * R * R);
    return 2.44 * R * R_SUN_AU * Math.pow(rhoStar / (rhoP > 0 ? rhoP : 5500), 1 / 3);
  }
  /* ---- 热木星迁移（Dawson & Johnson 2018, ARA&A 56, 175 综述）----------------------------
     巨行星只在**雪线以外**长得起来（那里固体面密度才够），可观测到的热木星就贴在恒星脸上，
     而且周期分布在 **P ≈ 3 天处有一个明确的堆积**（pile-up）——"形成在外、迁移进来"的指纹。
     两条主流通道都把行星停在同一个地方：盘内 II 型迁移（Lin, Bodenheimer & Richardson 1996,
     Nature 380, 606）与高偏心率迁移 + 潮汐圈化（Rasio & Ford 1996；Fabrycky & Tremaine 2007），
     终点约 a ≈ 2 a_Roche（Ford & Rasio 2006, ApJ 638, L45），与观测堆积位置一致。
     就地形成热木星要求盘面密度高到不合理（Rafikov 2006, ApJ 648, 666），所以本模块**不让**
     巨行星在 0.1 AU 以内原地出现，热木星一律走这条迁移通道。
     **这一步才是温度天花板的出口**：尘埃升华半径 ∝ √L 与 T ∝ L^¼/√a 精确抵消，只要行星是原地
     形成的就热不过 T_sub 那一档；而气体盘（以及高偏心率通道的潮汐）照样能把行星拖到 a_sub 以内 ——
     尘埃在那里早就没了，气体没有。真实的 WASP-33b（A5 主序，P = 1.22 d）就在其宿主升华半径的深处。
     发生率有两个层次，别搞混：**最终出现率**（观测量）是每颗恒星里有多少带热木星 —— FGK 约
     0.4–1.2%（Fressin 2013 的 0.43%；Wright 2012 的 1.2%），M 矮星约 0.11%（Obermeier 2016）；
     下面 hjMigrateProb() 给的是**条件迁移概率**（启发式）—— 已经在雪线外长出巨行星的那些系统里，
     有多大比例会把它迁进来，量级在百分之几到一成。两者相乘才等于最终出现率，不能互相代入。
     方向性依据 Johnson et al. 2010, PASP 122, 905：巨行星出现率 ∝ M★。 */
  var HJ_PILEUP_D = 3.2, HJ_PILEUP_SIG = 0.26;    // 堆积中心（天）与对数弥散（dex）
  function hotJupiterPeriodD(rnd) { return clamp(HJ_PILEUP_D * Math.pow(10, HJ_PILEUP_SIG * gaussRnd(rnd)), 0.9, 14); }
  /* 迁移概率 ∝ M★^1.9：指数不是随手取的，是两个文献锚点自己解出来的 ——
     M 矮星（⟨M⟩≈0.3 M☉）热木星出现率 0.11%（Obermeier et al. 2016, AJ 152, 223），
     FGK（⟨M⟩≈0.85 M☉）0.43%（Fressin 2013）–1.2%（Wright et al. 2012, ApJ 753, 160），
     取 0.8% 则 ln(0.8/0.11)/ln(0.85/0.3) ≈ 1.9；方向与 Johnson et al. 2010（巨行星出现率随 M★ 上升）一致。
     系数按"雪线外有可迁移巨行星的系统占比"标定，实测 A.8。 */
  var HJ_MIG_K = 0.135, HJ_MIG_EXP = 1.9;
  function hjMigrateProb(hostMass) { return clamp(HJ_MIG_K * Math.pow(Math.max(hostMass, 0.05), HJ_MIG_EXP), 0, 0.25); }
  var HJ_NOTE = '热木星：形成于雪线以外，靠盘内迁移或高偏心率迁移 + 潮汐圈化进到恒星跟前，' +
    '停在观测到的 P ≈ 3 天堆积处（Dawson & Johnson 2018 综述；终点 a ≈ 2 a_Roche，Ford & Rasio 2006）。' +
    '它现在的轨道在尘埃升华半径以内 —— 那里原地长不出行星，只有迁移能把它送到这个位置。';
  /* 把最内侧的那颗（雪线外形成的）巨行星迁移成热木星。就地改写 planets 里的那一项并返回它；
     不符合条件（没有巨行星 / 环双星 / 宿主是遗骸 / 本来就更近）时返回 null。
     planets 必须按 orbitAU 由内向外排好；调用方负责重排与重新命名。 */
  function migrateInnerGiant(planets, rnd, snowLine, u) {
    var k = -1, i;
    for (i = 0; i < planets.length; i++) {
      var q = planets[i];
      if (q.pclass !== 'giant' || q.type !== 'gas') continue;                  // 只有巨行星会迁移成热木星
      if (q.orbitType === 'P') continue;                                       // 环双星（P 型）：内区被双星本身清空，观测上也没有这种热木星
      if (!q.star || !(q.star.lumRel > 0) || q.star.remnant) continue;         // 宿主必须还在发光
      // 只有还在主序（或刚上主序）的宿主留得住热木星：迁移发生在盘存在的头几百万年，宿主一旦鼓成亚巨星/红巨星，
      // 星半径就超过 P ≈ 3 d 的轨道，行星连同轨道一起被吞掉（Villaver & Livio 2009, ApJ 705, L81）
      if (!(q.star.stage === 'ms' || q.star.stage === 'msLate' || q.star.stage === 'pms')) continue;
      if (snowLine > 0 && q.orbitAU <= snowLine) continue;                     // 必须是在雪线外形成的那一颗
      k = i; break;                                                            // 取最内侧的一颗
    }
    if (k < 0) return null;
    var p = planets[k], hostMass = Math.max(p.hostMassRel || 1, 0.02), hostLum = p.hostLumRel || 0;
    if (u != null && !(u < hjMigrateProb(hostMass))) return null;              // 发生率按**这颗行星宿主**的质量判（多星系统里宿主不一定是主星）
    var Pd = hotJupiterPeriodD(rnd), aNew = Math.pow(Pd / 365.25, 2 / 3) * Math.pow(hostMass, 1 / 3);
    // 潮汐圈化把轨道停在约 2 a_Roche（Ford & Rasio 2006）；再近就被撕碎。巨行星取木星密度 1330 kg·m⁻³。
    // 另外硬性留出 3 R★：轨道不能落进恒星本体里
    var aStop = Math.max(2 * rocheAU(hostMass, p.star.radiusRel || 1, 1330), 3 * (p.star.radiusRel || 1) * R_SUN_AU);
    if (aNew < aStop) aNew = aStop;
    if (aNew >= p.orbitAU) return null;                                        // 本来就比堆积位置更近：不动
    var T = tempAt(hostLum, aNew); if (!isFinite(T)) T = 0;
    p.orbitAU = +aNew.toFixed(4);
    p.periodYr = +Math.sqrt(aNew * aNew * aNew / hostMass).toPrecision(6);
    p.tempK = Math.round(T);
    p.ecc = 0;                                                                 // 潮汐圈化：P ≲ 10 d 的巨行星轨道已经圆化（Fabrycky & Tremaine 2007）
    p.tidalLocked = true;                                                      // 同步自转
    p.rotationH = +(p.periodYr * 8766).toFixed(1);
    p.hotJupiter = true; p.migrated = true;
    p.subtype = 'gasGiant';
    p.radiusRel = +(p.radiusRel * 1.15).toFixed(2);                            // 受辐照膨胀（半径涨、质量不变）
    p.radiusM = p.radiusRel * EARTH_R_M;
    p.gravityRel = +clamp(p.massEarth / (p.radiusRel * p.radiusRel), 0.02, 60).toFixed(2);
    p.pclassCn = '热木星';
    p.moons = []; p.moonCount = 0;                                             // 近距巨行星留不住卫星（Barnes & O'Brien 2002, ApJ 575, 1087）
    if (p.visual) p.visual.rings = null;                                       // 环也留不住：冰粒早就升华了
    var gl = applyGasLook(p.visual, T, 'gasGiant', p.seed);                    // 云顶凝结物按新温度重判（Sudarsky 五类）
    p.gasClass = gl.cls; p.cloudDeck = gl.cn; p.cloudNote = gl.note; p.bondAlbedo = +gl.albedo.toFixed(2);
    p.color = p.visual.color;
    p.migrationNote = TR(HJ_NOTE);
    p.migrationPeriodD = +Pd.toFixed(2);
    return p;
  }
  function diskOf(ageGyr, cls, rnd) {   // 原行星盘 / 碎屑盘
    if (ageGyr < 0.006) return { kind: 'protoplanetary', cn: TR('原行星盘'), frac: +fmt(Math.exp(-ageGyr / 0.003), 2), ref: TR('Haisch et al. 2001：盘比例随年龄指数衰减，半衰期约 3 Myr') };
    var p = cls === 'A' || cls === 'B' || cls === 'O' ? 0.32 : cls === 'M' ? 0.02 : 0.20;
    if (rnd() < p) return { kind: 'debris', cn: TR('碎屑盘'), frac: p, ref: cls === 'A' || cls === 'B' || cls === 'O' ? TR('Su et al. 2006：A 型星碎屑盘比例约 32%') : TR('Eiroa et al. 2013 (DUNES)：FGK 星碎屑盘比例 20.2% ± 2.0%') };
    return null;
  }
  /* 流浪行星（Sumi 2011）：不绑定任何恒星，作为"路过附近"的天体挂在恒星系上，也可以单独生成 */
  function rogueWorld(seed, universeParams, opts) {
    seed = seed >>> 0; opts = opts || {};
    var pr = mulberry32(seed ^ 0x40FFEE), nowYr = universeParams && universeParams.enterTimeGyr ? universeParams.enterTimeGyr * 1e9 : NOW_YR;
    var u = pr(), giant = u < 0.35, rRel = giant ? 8 + pr() * 5 : 0.4 + Math.pow(pr(), 1.4) * 2.2;
    var mE = planetMassEarth(rRel), T = Math.round(clamp(giant ? 180 * Math.pow(pr(), 0.4) + 30 : 25 + pr() * 35, 8, 260));   // 只有内部余热与放射性衰变
    var type = giant ? 'gas' : (T > 90 ? 'rock' : 'ice'), vis = baseVisual(type);
    if (giant) vis.hue = 200 + pr() * 60;
    var p = { id: 0, name: TR('流浪行星 ') + ((seed % 46656).toString(36).toUpperCase()), type: type, subtype: giant ? 'iceGiant' : null, rogue: true, pclass: giant ? 'giant' : 'rock',
      bodyKind: 'rogue', isRogue: true, starlit: true, landable: true, parent: null,
      radiusRel: +rRel.toFixed(2), massEarth: +mE.toFixed(2), orbitAU: null, periodYr: null, ecc: 0, phase: 0, gravityRel: +(mE / (rRel * rRel)).toFixed(2),
      atmosphere: { pressureRel: giant ? 1000 : +(pr() * 2).toFixed(3), color: hex(vis.atm) }, tempK: T, moons: [], moonCount: 0, life: null, seed: seed, tilt: +(pr() * 40).toFixed(1), rotationH: 6 + pr() * 30,
      color: vis.color, visual: vis, timeline: { formGyr: 0.05, oceanGyr: Infinity, greenGyr: Infinity, civGyr: Infinity }, starFormedYr: nowYr - 5e9, nowYr: nowYr,
      star: { color: '#101018', lumRel: 0, tempK: 0 }, radiusM: rRel * EARTH_R_M, hostId: null, orbitType: 'rogue', hostName: TR('（无主星）'),
      ref: TR('Sumi et al. 2011：微引力透镜给出每颗主序星约 1.8 颗木星质量的自由漂浮行星；Mróz et al. 2017 把上限压到 <0.25 颗/星，同时指出低质量端更多。示意') };
    p.desc = TR('一颗没有恒星的行星。它在星际空间里独自漂流，表面温度只由内部余热与放射性衰变维持（约 ') + T + TR(' K），天空里除了星光什么都没有。');
    return p;
  }

  // 各类型的静态材质预设（颜色均为 0..1 RGB）
  var VISUAL = {
    rock: { sea: -1, rangeM: 22000, atm: [0.62, 0.6, 0.58], atmDensity: 0.0, cloud: 0, cloudColor: [0.9, 0.9, 0.9], iceLat: 0.97, iceHeight: 1.5, iceColor: [0.92, 0.94, 0.96], detailAmp: 0.028, detailFreq: 64, craters: 1, palette: 'rock', color: '#8a7f74', spec: 0.05 },
    desert: { sea: -1, rangeM: 18000, atm: [0.86, 0.72, 0.55], atmDensity: 0.35, cloud: 0.12, cloudColor: [0.95, 0.9, 0.85], iceLat: 0.9, iceHeight: 1.6, iceColor: [0.95, 0.95, 0.97], detailAmp: 0.02, detailFreq: 64, craters: 0.5, palette: 'desert', color: '#c9a46a', spec: 0.05 },
    ocean: { sea: 0.86, rangeM: 16000, atm: [0.55, 0.72, 0.95], atmDensity: 1.0, cloud: 0.55, cloudColor: [1, 1, 1], iceLat: 0.85, iceHeight: 1.6, iceColor: [0.94, 0.96, 0.99], detailAmp: 0.02, detailFreq: 64, craters: 0, palette: 'ocean', color: '#2c6fb5', spec: 1.0, oceanShallow: [0.12, 0.45, 0.62], oceanDeep: [0.02, 0.09, 0.28] },
    ice: { sea: -1, rangeM: 12000, atm: [0.75, 0.82, 0.92], atmDensity: 0.25, cloud: 0.15, cloudColor: [0.95, 0.96, 1], iceLat: 0.0, iceHeight: 0, iceColor: [0.9, 0.94, 0.98], detailAmp: 0.02, detailFreq: 64, craters: 0.6, palette: 'ice', color: '#c8d8e6', spec: 0.35, cracks: 1 },
    lava: { sea: 0.42, rangeM: 14000, atm: [0.9, 0.5, 0.3], atmDensity: 0.45, cloud: 0.1, cloudColor: [0.35, 0.3, 0.3], iceLat: 2, iceHeight: 9, iceColor: [1, 1, 1], detailAmp: 0.03, detailFreq: 64, craters: 0.2, palette: 'lava', color: '#5a2a1a', spec: 0.1, lava: 1, lavaSea: 1 },
    gas: { sea: -1, rangeM: 0, atm: [0.85, 0.78, 0.65], atmDensity: 0.9, cloud: 0, cloudColor: [1, 1, 1], iceLat: 9, iceHeight: 9, iceColor: [1, 1, 1], detailAmp: 0, detailFreq: 8, craters: 0, palette: 'gas', color: '#c9a978', spec: 0.15, gas: 1 },
    living: { sea: 0.55, rangeM: 19000, atm: [0.55, 0.72, 0.98], atmDensity: 1.0, cloud: 0.5, cloudColor: [1, 1, 1], iceLat: 0.86, iceHeight: 1.7, iceColor: [0.94, 0.96, 0.99], detailAmp: 0.022, detailFreq: 64, craters: 0, palette: 'earth', color: '#4c8a4a', spec: 1.0, oceanShallow: [0.1, 0.42, 0.6], oceanDeep: [0.02, 0.1, 0.3] },
    earth: { sea: 0.5556, rangeM: 19800, atm: [0.5, 0.7, 1.0], atmDensity: 1.0, cloud: 0.5, cloudColor: [1, 1, 1], iceLat: 0.86, iceHeight: 1.7, iceColor: [0.94, 0.96, 0.99], detailAmp: 0.02, detailFreq: 64, craters: 0, palette: 'earth', color: '#3a7bd5', spec: 1.0, oceanShallow: [0.1, 0.42, 0.62], oceanDeep: [0.02, 0.09, 0.3] }
  };
  var VEG = { temperate: [0.24, 0.42, 0.18], tropical: [0.15, 0.36, 0.14], boreal: [0.2, 0.32, 0.18], savanna: [0.55, 0.56, 0.26] };

  /* ============================================================ 真实地球：粗略大陆轮廓（经度, 纬度）与主要山脉（手工近似） */
  var EARTH_LAND = [
    // 北美大陆
    [[-168, 66], [-165, 60], [-152, 58], [-140, 60], [-133, 55], [-125, 49], [-124, 40], [-118, 34], [-110, 24], [-105, 20], [-97, 16], [-92, 15], [-88, 13], [-84, 10], [-80, 8], [-83, 10], [-88, 16], [-87, 21], [-90, 21], [-92, 18], [-97, 20], [-97, 26], [-94, 29], [-89, 30], [-85, 30], [-82, 27], [-80, 25], [-81, 31], [-76, 35], [-74, 40], [-70, 42], [-67, 45], [-64, 45], [-60, 47], [-58, 53], [-64, 58], [-64, 60], [-70, 61], [-78, 62], [-80, 54], [-95, 58], [-92, 63], [-88, 66], [-100, 68], [-125, 70], [-140, 70], [-156, 71], [-165, 66]],
    [[-88, 71], [-80, 73], [-70, 72], [-62, 67], [-66, 63], [-73, 64], [-78, 70]],           // 巴芬岛
    [[-118, 70], [-102, 71], [-105, 73], [-116, 73]], [[-90, 77], [-62, 82], [-70, 83], [-92, 80]], // 北极群岛
    [[-73, 78], [-58, 82], [-30, 83], [-20, 80], [-22, 72], [-25, 70], [-42, 60], [-50, 63], [-53, 68], [-58, 73], [-68, 76]], // 格陵兰
    [[-59, 47], [-53, 47], [-53, 50], [-56, 52], [-59, 49]], // 纽芬兰
    [[-85, 22], [-74, 20], [-77, 20], [-84, 22]], [[-74, 18], [-68, 18], [-70, 20], [-73, 20]], // 古巴、伊斯帕尼奥拉
    // 南美
    [[-77, 8], [-79, 2], [-81, -4], [-77, -12], [-70, -18], [-71, -30], [-73, -40], [-75, -50], [-70, -55], [-66, -55], [-65, -45], [-63, -40], [-58, -35], [-53, -33], [-48, -26], [-42, -23], [-39, -18], [-35, -9], [-38, -4], [-45, -2], [-51, 0], [-52, 5], [-58, 7], [-63, 10], [-71, 12], [-75, 10]],
    // 非洲
    [[-17, 21], [-17, 15], [-15, 11], [-8, 5], [0, 6], [5, 5], [9, 4], [9, 0], [12, -6], [12, -17], [15, -27], [18, -34], [26, -34], [33, -27], [35, -20], [40, -15], [40, -10], [39, -6], [42, -1], [51, 11], [43, 12], [39, 15], [37, 22], [33, 28], [32, 31], [30, 31], [20, 32], [11, 34], [10, 37], [0, 36], [-6, 35], [-10, 30]],
    [[44, -25], [47, -25], [50, -15], [49, -12], [44, -16], [43, -22]], // 马达加斯加
    // 欧亚大陆
    [[-9, 37], [-9, 43], [-2, 43], [-5, 48], [2, 51], [5, 53], [9, 54], [14, 54], [19, 54.5], [21, 56], [24, 57.5], [24, 59.5], [28, 60], [30, 60], [28, 61], [22, 63], [24, 65.5], [21, 64], [18, 62], [18, 60], [16, 58], [16, 56], [13, 55.5], [12, 58], [11, 59], [6, 58], [5, 60], [5, 62], [10, 64], [14, 67], [18, 70], [26, 71], [31, 70], [35, 68], [40, 66], [35, 64], [38, 64], [41, 66], [44, 68], [55, 68], [60, 69], [68, 69], [73, 72], [80, 72], [88, 74], [100, 77], [113, 73], [130, 71], [140, 72], [150, 70], [160, 69], [170, 69], [180, 66], [180, 64], [178, 62], [170, 60], [162, 60], [162, 58], [160, 53], [156, 51], [155, 57], [156, 60], [140, 58], [140, 54], [135, 48], [132, 43], [129, 40], [129, 35], [126, 35], [126, 38], [121, 39], [121, 37], [119, 35], [122, 31], [120, 27], [117, 23], [113, 22], [110, 20], [108, 21], [106, 18], [109, 12], [105, 9], [103, 11], [100, 13], [103, 1], [100, 6], [98, 8], [98, 14], [94, 17], [92, 21], [90, 22], [87, 21], [85, 19], [80, 15], [80, 10], [77, 8], [73, 15], [72, 21], [67, 24], [62, 25], [57, 26], [56, 24], [60, 22], [55, 17], [49, 14], [43, 13], [40, 18], [35, 28], [34, 31], [36, 36], [30, 36], [27, 37], [26, 40], [30, 41], [36, 42], [41, 41.5], [40, 44], [37, 45], [34, 45], [33, 46], [30, 46], [28, 44], [28, 42], [28.5, 41], [24, 40], [23, 38], [22, 37], [20, 40], [19, 42], [16, 43], [13, 45], [12, 44], [16, 41], [18, 40], [16, 38], [15, 38], [16, 40], [13, 41], [10, 44], [8, 44], [6, 43], [3, 43], [3, 42], [0, 40], [-1, 37], [-5, 36]],
    [[-5, 50], [1, 51], [2, 53], [0, 54], [-2, 56], [-3, 58], [-5, 58.5], [-6, 57], [-5, 55], [-3, 54], [-5, 53], [-5, 51.5]], // 不列颠
    [[-10, 52], [-6, 52], [-6, 55], [-8, 55], [-10, 54]], [[-24, 65], [-14, 66], [-14, 64], [-22, 63.5]], // 爱尔兰、冰岛
    [[10, 77], [28, 77], [20, 80], [12, 80]], [[52, 71], [56, 71], [69, 77], [59, 77]], // 斯瓦尔巴、新地岛
    [[131, 34], [135, 34], [140, 35], [141, 38], [141, 41], [140, 41], [137, 37], [133, 36]], [[140, 42], [145, 43], [142, 45], [140, 44]], [[130, 31], [132, 33], [130, 34], [129, 33]], // 日本
    [[142, 46], [143, 54], [142, 54]], [[120, 22], [122, 25], [121, 25], [120, 23]], [[108, 18], [111, 20], [110, 20]], [[80, 6], [82, 7], [81, 9], [80, 9]], // 库页、台湾、海南、斯里兰卡
    [[95, 5], [106, -6], [104, -3], [100, 0], [95, 4]], [[109, 1], [117, 7], [119, 1], [116, -4], [110, -3], [109, 0]], [[105, -6], [114, -8], [114, -7], [106, -6]], [[119, -5], [120, 0], [125, 1], [121, -4]], // 苏门答腊、婆罗洲、爪哇、苏拉威西
    [[131, -1], [140, -2], [150, -10], [147, -8], [140, -8], [135, -4], [131, -2]], [[120, 14], [122, 18], [122, 14], [121, 13]], [[122, 7], [126, 7], [126, 10], [123, 10]], // 新几内亚、菲律宾
    // 澳大利亚、塔斯马尼亚、新西兰
    [[114, -22], [114, -26], [115, -34], [118, -35], [124, -33], [131, -31], [137, -35], [139, -37], [144, -38], [147, -38], [150, -37], [153, -30], [153, -25], [147, -19], [145, -15], [142, -11], [141, -17], [136, -13], [131, -12], [126, -14], [122, -17]],
    [[145, -41], [148, -41], [147, -43], [145, -43]], [[173, -35], [178, -38], [175, -41], [173, -39]], [[172, -41], [174, -42], [168, -46], [167, -45], [171, -42]],
    // 南极半岛（大陆本体按纬度带生成）
    [[-60, -63], [-58, -64], [-62, -68], [-70, -72], [-80, -74], [-75, -78], [-65, -76], [-62, -70]]
  ];
  var EARTH_RANGES = [ // [经纬折线, 高度(0..1), 宽度(度)]
    [[[-70, -52], [-70, -20], [-77, -8], [-76, 3]], 0.55, 2.2], // 安第斯
    [[[-105, 33], [-110, 45], [-115, 52], [-125, 60]], 0.4, 3.5], // 落基
    [[[-85, 34], [-72, 44]], 0.16, 2.5], // 阿巴拉契亚
    [[[-100, 20], [-105, 27]], 0.28, 2.5], // 马德雷山
    [[[73, 36], [80, 32], [85, 28], [95, 28]], 0.7, 2.6], // 喜马拉雅
    [[[78, 33], [85, 34], [92, 33], [96, 30]], 0.5, 6.0], // 青藏高原
    [[[70, 40], [78, 41], [86, 43], [94, 44]], 0.4, 2.5], // 天山
    [[[6, 45], [10, 46], [14, 47]], 0.35, 1.6], // 阿尔卑斯
    [[[58, 52], [59, 60], [61, 66]], 0.15, 1.6], // 乌拉尔
    [[[40, 43], [48, 42]], 0.4, 1.4], [[[45, 35], [55, 28]], 0.32, 2.4], // 高加索、扎格罗斯
    [[[-8, 32], [0, 35], [8, 36]], 0.25, 1.6], // 阿特拉斯
    [[[36, 8], [40, 12]], 0.32, 3.0], [[[30, -3], [35, -12]], 0.22, 2.4], // 埃塞俄比亚高原、东非
    [[[150, -35], [152, -28], [146, -18]], 0.16, 1.8], // 大分水岭
    [[[130, 42], [128, 47]], 0.2, 2.0], [[[100, 27], [104, 32]], 0.35, 2.4], // 长白、横断
    [[[80, 65], [90, 68], [110, 65], [130, 62], [140, 60]], 0.18, 5.0], // 中西伯利亚高原
    [[[-140, 60], [-150, 62]], 0.4, 2.0], // 阿拉斯加山脉
    [[[0, -80], [60, -82], [120, -80], [180, -84], [-120, -84], [-60, -85]], 0.4, 12.0] // 南极高原
  ];
  var EARTH_DESERTS = [[[-5, 24], 12], [[15, 24], 12], [[30, 22], 8], [[45, 22], 8], [[58, 30], 6], [[100, 40], 6], [[85, 42], 5], [[130, -25], 8], [[-112, 32], 5], [[-70, -25], 5], [[15, -24], 5]];

  /* ============================================================ 恒星系生成 */
  /* 行星名不能带"恒星"两个字。真实天文命名里基名只是编号，恒星用大写后缀、行星用小写后缀：
     Kepler-16 的两颗子星是 Kepler-16 A / B，绕它们的行星是 Kepler-16b —— 没人把行星叫
     "恒星 Kepler-16 b"。本模块以前直接拿系统显示名（"恒星 7ZWG"）当基名往后拼，于是行星
     字面上叫"恒星 7ZWG d"，用户读成"这颗行星被标记成恒星了"。这里先剥掉类别词再拼。 */
  function bareDesig(sysName) { return String(sysName || '').replace(/^恒星\s*/, ''); }
  function planetName(sysName, idx) { return bareDesig(sysName) + ' ' + romans[idx % romans.length]; }
  function tempAt(lumRel, au, albedo) { return 278.5 * Math.pow(lumRel, 0.25) / Math.sqrt(au) * Math.pow(1 - (albedo || 0.3), 0.25); }
  function habitabilityOf(up) {
    if (!up) return 1;
    var h = up.report && up.report.habitability != null ? up.report.habitability : (up.habitability != null ? up.habitability : null);
    if (h == null) return up.isOurs || up.isOurUniverse ? 1 : 0.7;
    return clamp(h, 0, 1.5);
  }
  function isOurs(up) { return !!(up && (up.isOurs || up.isOurUniverse || up.id === 1207 || up.ours)); }

  // 维数：从 universeParams（sim.params.dimS / report.dimension）或 opts.dim 读取；|D-round(D)|<1e-6 视为整数
  function dimOf(up, opts) {
    // UI 可直接传 opts.dimMode（'3d'|'2d'|'orbitDemo'）与 opts.dimS / opts.dim；否则从 universeParams（dimS / params.dimS / report.dimension）读取
    var D = opts && opts.dim != null ? opts.dim : (opts && opts.dimS != null ? opts.dimS : (up && up.dimS != null ? up.dimS : (up && up.params && up.params.dimS != null ? up.params.dimS : (up && up.report && up.report.dimension != null ? up.report.dimension : 3))));
    D = +D; if (!isFinite(D)) D = 3; if (Math.abs(D - Math.round(D)) < 1e-6) D = Math.round(D);
    var m = opts && opts.dimMode; if (m === '3d') D = 3; else if (m === '2d') D = 2; else if (m === 'orbitDemo' && (D === 3 || D === 2)) D = 4;
    return D; }
  function supportsDim(D) { D = +D; if (!isFinite(D) || D <= 1 || D > 17) return { mirror: false, mode: null, reason: D <= 1 ? TR('一维及以下：没有可展示的轨道与地表') : TR('超过 17 维') }; if (Math.abs(D - 3) < 1e-6) return { mirror: true, mode: '3d' }; if (Math.abs(D - 2) < 1e-6) return { mirror: true, mode: '2d', note: TR('示意（2 维几何）· 引力 2+1 维为推测') }; return { mirror: true, mode: 'orbitDemo', note: (Math.abs(D - Math.round(D)) < 1e-6 ? TR('D≥4：D 维两体问题的 3 维投影 · Ehrenfest 1917：无稳定圆轨道') : TR('分数维（推测：分形/谱维数模块）· 引力 r^{−(D−1)} 的轨道 3 维投影')), stops: 'system' }; }
  /* ============================================================ D 维引力：全站唯一口径
   * specs/highdim-v1.md 一、二节都要求「同一个 D 下两处数值一致」，ui/hyper.js 的 D 维 N 体
   * 与这里的轨道投影演示必须读同一套数。所以把「核归一 + 力律 + 软化」抽到这里，
   * 导出成 MirrorPlanets.dimGravity（别的模块只读）。
   *
   * 核归一：以 r = CORE_R = 1 为基准，|a|(1) = 1。于是
   *     |a|(r) = r^{−(D−1)}            （无软化）
   *     F/F₁    = r^{−(D−1)}            ← HUD 上那个「核外 F/F₁≈…」就是它
   * D 越大，r=1 两侧越像一道悬崖：外侧迅速趋于 0，内侧迅速发散。这正是第二节要玩家亲眼看的东西。
   *
   * 软化：**只有紫外发散需要软化，而发散是 D>3 才有的事**。
   * 原来 universe3d 里用的是 2·|D−3|（对称），于是 D=2.5 也被塞进 1 个网格的软化——
   * 而 D<3 的力比牛顿更长程、更不发散，软化在那边纯粹是把引力吃掉（审计报告第 2.5 档那条）。
   * 这里改成单边：D≤3 不软化，D>3 沿用原来的数（D≥4 恒为 2 个网格，与改动前逐位相同）。
   * 长度单位：softCells 是「网格间距数」（给 PM 用），softLen 是「核半径的倍数」（给直接求和用）。 */
  var DIMG = (function () {
    var CORE_R = 1;
    function expOf(D) { return (+D) - 1; }                       // |a| ∝ r^{−(D−1)}
    function softCells(D) {                                      // PM 路径：ε 的网格间距数（0 = 不软化）
      D = +D; if (!isFinite(D)) return 0;
      if (D <= 3) return 0;                                      // D≤3 不发散，软化只会白吃引力
      return clamp(clamp(2 * (D - 3), 0.4, 2), 0.2, 3);          // D>3：与旧式 2·|D−3| 在 D>3 侧逐位相同
    }
    function softLen(D) {                                        // 直接求和路径：ε 以核半径为单位
      D = +D; if (!isFinite(D) || D <= 3) return 0;
      return clamp(0.02 * (D - 3), 0, 0.12);                     // 只为压住 r→0 的发散，不改核外任何数值
    }
    function forceRatio(r, D) {                                  // F(r)/F(核半径)，HUD 直接用
      r = Math.max(+r, 1e-12); return Math.pow(r / CORE_R, -expOf(D));
    }
    function accelMag(r, D, eps) {                               // |a|，带可选软化（Plummer）
      var e = eps == null ? softLen(D) : +eps;
      var rr = e > 0 ? Math.sqrt(r * r + e * e) : Math.max(r, 1e-12);
      return Math.pow(rr / CORE_R, -expOf(D));
    }
    /* 加速度矢量写进 out（长度 = pos.length），指向原点。out 省略时新建。
       与改动前 accelD 逐字等价（默认 eps=0 时 f = −1/r^{D−1}/r）。 */
    function accel(pos, D, out, eps) {
      var n = pos.length, r2 = 0, i;
      for (i = 0; i < n; i++) r2 += pos[i] * pos[i];
      var r = Math.sqrt(r2), a = accelMag(r, D, eps), f = -a / Math.max(r, 1e-12);
      var o = out || new Float64Array(n);
      for (i = 0; i < n; i++) o[i] = f * pos[i];
      return o;
    }
    return { CORE_R: CORE_R, exponent: expOf, softCells: softCells, softLen: softLen,
             forceRatio: forceRatio, accelMag: accelMag, accel: accel };
  })();

  function baseVisual(type) { var v = VISUAL[type] || VISUAL.rock, o = {}; for (var k in v) o[k] = Array.isArray(v[k]) ? v[k].slice() : v[k]; return o; }

  /* ============================================================ 照明色温（普朗克谱）
   * 以前恒星的颜色完全没参与行星表面的着色：宿主是 2800 K 的 M 矮星还是 9000 K 的 A 型星，
   * 行星都按白光渲染。真实的差别在**照明的色度**上 —— 同一块高反照率的冰，在 M 矮星下偏粉橙、
   * 在 A 型星下偏蓝白。所以这一项作用在**光照**上（乘反照率），不去改分类给出的行星色相。
   * 归一化取太阳 5772 K = 纯白：太阳系天体因此逐位不变；亮度也归一（只留色度），
   * 免得换个宿主星整幅画面跟着变亮变暗。黑体 → RGB 用 Tanner Helland 的分段拟合（示意）。
   */
  var SUN_TEFF = 5772;
  function planckRGB(T) {
    T = clamp(isFinite(T) && T > 0 ? T : SUN_TEFF, 1000, 40000) / 100; var r, g, b;
    r = T <= 66 ? 255 : clamp(329.7 * Math.pow(T - 60, -0.1332), 0, 255);
    g = T <= 66 ? clamp(99.47 * Math.log(T) - 161.1, 0, 255) : clamp(288.1 * Math.pow(T - 60, -0.0755), 0, 255);
    b = T >= 66 ? 255 : T <= 19 ? 0 : clamp(138.5 * Math.log(T - 10) - 305, 0, 255);
    return [r / 255, g / 255, b / 255];
  }
  var SUN_RGB = planckRGB(SUN_TEFF);
  /* strength = 1 是完全不做白平衡的物理照明色（相机口径）；缺省 0.55 表示**部分色适应**：
     人眼在一种主导光源下会自动往白里拉，火星车的"自然色"产品也是这么折中的。
     取 1 会让 M 矮星系统里的每一颗岩质天体都变成橙色，那既不像人眼看到的、也把三条粉红机制淹没掉。
     需要物理值的地方直接调 starTintOf(T, 1)。 */
  var TINT_K = 0.55;
  function starTintOf(tempK, strength) {
    if (!isFinite(tempK) || tempK <= 0) return [1, 1, 1];
    var c = planckRGB(tempK), t = [c[0] / SUN_RGB[0], c[1] / SUN_RGB[1], c[2] / SUN_RGB[2]];
    var y = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]; if (!(y > 1e-4)) return [1, 1, 1];
    var k = strength == null ? TINT_K : strength;
    return [lerp(1, t[0] / y, k), lerp(1, t[1] / y, k), lerp(1, t[2] / y, k)];
  }
  // RGB → 色相（度）/ 饱和度（HSV 口径）：审计「偏粉红」用的就是这两个量
  function hueSatOf(c) {
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn, h = 0;
    if (d > 1e-6) { h = mx === c[0] ? 60 * (((c[1] - c[2]) / d) % 6) : mx === c[1] ? 60 * ((c[2] - c[0]) / d + 2) : 60 * ((c[0] - c[1]) / d + 4); }
    return { hue: ((h % 360) + 360) % 360, sat: mx > 1e-6 ? d / mx : 0, val: mx };
  }
  /* 天体在**这颗恒星的光**下呈现的颜色 = 本征反照率颜色 × 照明色温。
     "有多少颗星球看起来偏粉红" 必须按这个口径统计 —— 只看 planet.color 会漏掉红矮星照明那一类。 */
  function apparentColor(planet) {
    var base = rgb((planet && planet.color) || '#888888');
    var t = starTintOf(planet && planet.star && planet.star.tempK);
    var c = [clamp(base[0] * t[0], 0, 1), clamp(base[1] * t[1], 0, 1), clamp(base[2] * t[2], 0, 1)];
    var hs = hueSatOf(c);
    return { rgb: c, hex: hex(c), hue: hs.hue, sat: hs.sat, val: hs.val, tint: t, base: hex(base) };
  }
  // 这颗恒星在人眼里偏红/偏蓝到什么程度：给 HUD 用（0 = 与太阳同色）
  function tintNoteOf(star) {
    if (!star || !isFinite(star.tempK) || star.tempK <= 0) return null;
    var T = star.tempK, t = starTintOf(T);
    var warm = t[0] - t[2];   // >0 偏红，<0 偏蓝
    if (Math.abs(warm) < 0.06) return null;
    return TR('照明色温：宿主 ') + (star.cls || star.spt || TR('恒星')) + TR(' 的 T_eff ≈ ') + Math.round(T) + TR(' K，普朗克谱') +
      (warm > 0 ? TR('偏红 —— 高反照率的云顶/冰面因此整体带粉橙调') : TR('偏蓝 —— 同样的表面在这里偏蓝白')) +
      TR('（这是**照明**的颜色，不是天体本身的颜色；白点取太阳 5772 K；默认部分白平衡 0.55 是显示约定——人眼色适应/火星车“自然色”式折中，不是物理测量或标度关系，示意）');
  }

  /* ============================================================ 托林（tholin）有机雾霾
   * 甲烷 + 氮在紫外辐照下聚合出的有机气溶胶：冥王星的红棕、土卫六的橙黄、海卫一的粉红都源于它。
   * 文献：Sagan & Khare 1979 (Nature 277, 102) 命名 tholin 并测了光学常数；
   *       Grundy 等 New Horizons 工作（冥王星/柯伊伯带红色有机物；Arrokoth 飞掠成果见 2019–2020 系列，勿与 2018 年号混绑）；
   *       Zhang et al. 2017 (Nature 551, 352) 冥王星雾霾加热与能量收支（注意：不是土卫六）。
   * 三个必要条件（缺一不成，所以这不是"随机撒粉色"）：
   *   ① 低温：CH₄/N₂ 要能以气或冰的形式存在，约 25–200 K（土卫六 94 K、冥王星 44 K、海卫一 38 K）；
   *   ② 有 CH₄/N₂：气/冰巨星与冰质天体满足，无大气的岩质/金属天体不满足；
   *   ③ 足够的**累积**紫外剂量 —— 托林是只积不散的产物，冥王星在 39 AU 上仍被染红，
   *      靠的是几十亿年的剂量而不是瞬时流量，所以剂量里带年龄项。
   * 地表 vs 深大气：冥王星/海卫一/柯伊伯带天体是**表面**沉积，几十亿年只积不散 → 厚；
   * 天王星/海王星那样的深对流大气里雾霾颗粒会沉降并被埋掉，可见云顶仍是新鲜的甲烷/氨冰 ——
   * 这就是为什么冰巨星是青蓝而不是粉红。所以巨行星只有具备土卫六那样的稳定平流层时才显托林色，
   * 这里按 22% 抽取并把 τ 封顶，冰巨星的青蓝主流不受影响。
   */
  function uvIndexOf(starTempK) {
    // 相对太阳的 200 nm 以下流量：黑体 Wien 尾 exp(−hc/λkT)，hc/(λk) = 71939 K @ 200 nm。
    // 冷星的光球紫外几乎为零，但色球与耀斑的 Lyα 很强 —— 活跃 M 矮星的 FUV/bol 甚至高于太阳
    // （France et al. 2013, ApJ 763, 149），所以给 0.2 的地板而不是让它掉到 1e-5。
    var T = clamp(isFinite(starTempK) && starTempK > 0 ? starTempK : SUN_TEFF, 800, 60000);
    return Math.max(Math.exp(-71939 / T) / Math.exp(-71939 / SUN_TEFF), 0.2);
  }
  // 累积紫外剂量，单位 =「地球轨道上晒 46 亿年」
  function uvDoseOf(star, aAU, ageGyr) {
    var L = star && isFinite(star.lumRel) ? Math.max(star.lumRel, 0) : 1;
    var a = isFinite(aAU) && aAU > 0 ? aAU : 1, age = isFinite(ageGyr) && ageGyr > 0 ? ageGyr : SUN_AGE_GYR;
    return L * uvIndexOf(star && star.tempK) / (a * a) * (age / SUN_AGE_GYR);
  }
  function tholinOf(tempK, dose, rnd, surface) {
    var T = isFinite(tempK) ? tempK : 0;
    var w = smoothstep(18, 34, T) * (1 - smoothstep(150, 210, T));          // ① 温度窗口
    if (w <= 0) return { tau: 0, why: T < 25 ? 'tooCold' : 'tooHot' };
    var uv = clamp(0.25 + 0.75 * smoothstep(-4, 0.5, Math.log(Math.max(dose, 1e-12)) / Math.LN10), 0, 1);  // ③ 剂量
    var tau = w * uv;
    if (!surface) { if (rnd() > 0.22) return { tau: 0, why: 'convective', dose: dose }; tau = Math.min(tau, 0.55) * (0.6 + 0.4 * rnd()); }
    else tau *= 0.55 + 0.45 * rnd();
    tau = clamp(tau, 0, 1);
    // 薄雾霾偏粉（下面亮的冰/云透上来），厚的偏红棕；三支分别对应海卫一的粉、冥王星的红棕、土卫六的橙黄
    var kind = rnd(), shade = kind < 0.34 ? [0.83, 0.55, 0.61] : kind < 0.72 ? [0.74, 0.42, 0.34] : [0.80, 0.55, 0.30];
    var body = kind < 0.34 ? TR('海卫一那样的粉') : kind < 0.72 ? TR('冥王星那样的红棕') : TR('土卫六那样的橙黄');
    var col = mix3(mix3([0.88, 0.70, 0.68], shade, smoothstep(0.2, 0.8, tau)), [0.42, 0.22, 0.18], smoothstep(0.7, 1.0, tau) * 0.5);
    return { tau: tau, color: col, dose: dose, surface: !!surface, body: body,
      note: TR('托林雾霾（光学厚度 ') + tau.toFixed(2) + TR('）：甲烷与氮在紫外辐照下生成的有机气溶胶，') +
        (surface ? TR('在') + Math.round(T) + TR(' K 的表面上') + TR('只积不散') : TR('悬在稳定的平流层里')) + TR('，因此偏') + body +
        TR('；累积紫外剂量约为地球轨道 46 亿年的 ') + (dose >= 0.01 ? fmt(dose, 2) : dose.toExponential(1)) +
        TR(' 倍（依据：Sagan & Khare 1979 命名并测定 tholin 光学常数；Grundy 等 New Horizons 工作：冥王星/柯伊伯带红色有机物；Zhang et al. 2017 Nature 551, 352 冥王星雾霾加热与能量收支——不是土卫六；色相三支与 τ 为示意，非计算）') };
  }

  /* ============================================================ 巨行星的颜色：按云顶温度与凝结物分类
   * 以前这里是 `vis.hue = pr() * 360`（三成的气巨走这一支）—— 全随机色相，于是有粉红、紫色、荧光绿的
   * 木星。真实巨行星的颜色不是自由参数：**平衡温度决定哪种物质在云顶凝结**，凝结物决定反照率与色相。
   *
   * 依据（本模块所有取值的来源）：
   *   Sudarsky, Burrows & Pinto 2000 (ApJ 538, 885)     —— 「Albedo and Reflection Spectra of Extrasolar
   *       Giant Planets」：按 T_eq 把巨行星分成五个反照率类别（下表 I–V），这是这套配色的主干。
   *   Sudarsky, Burrows & Hubeny 2003 (ApJ 588, 1121)   —— 各类的理论光谱与几何反照率。
   *   West et al. 2004（Jupiter: The Planet, Satellites and Magnetosphere 第 5 章）、
   *   Carlson et al. 2016 (Icarus 274, 106)             —— 木星云顶的发色团（chromophore）：氨冰本身是白的，
   *       黄褐色来自光化学产物（NH₄SH / 有机物）。同为第 I 类，土星淡、木星浓。
   *   Evans et al. 2013 (ApJ 772, L16)                  —— HD 189733b 在 290–450 nm 的几何反照率 ≈0.4：深蓝，
   *       一般解释为高层硅酸盐颗粒的散射（第 IV 类里的一个变体）。
   *   Demory et al. 2011/2013 (ApJ 735, L12 / 776, L25) —— Kepler-7b：A_g ≈ 0.35，高层硅酸盐云（第 V 类的亮支）。
   *   Bell et al. 2017 (ApJ 847, L2)                    —— WASP-12b：A_g < 0.064，超热木星在可见光里极暗。
   *   Fortney et al. 2008 (ApJ 678, 1419)、Evans et al. 2017 (Nature 548, 58) —— TiO/VO 造成的温度反转与
   *       WASP-121b 的水发射带：≳2200 K 的一支自身热辐射已进入可见光，是"发光"而不是"反光"。
   *
   *   类别   T_eq            云顶凝结物                外观
   *   I      ≲150 K          氨冰 NH₃                  高反照率（Bond ≈0.5）的乳白～黄褐纬向带（木星 124 K、土星 95 K 都在此类）
   *   II     150–350 K       水云 H₂O                  五类里最亮（Bond 可达 0.8）：接近纯白、带纹对比最低
   *   III    350–900 K       无（晴空）                瑞利散射 + Na/K 共振吸收（589/770 nm）吃掉黄红端 → 深蓝紫，A ≈ 0.12
   *   IV     900–1500 K      硅酸盐/铁（在光球之下）    可见光由 Na/K 吸收主导 → 几乎不反光的暗红褐（A ≈ 0.03）；变体 = HD 189733b 式深蓝
   *   V      ≳1500 K         硅酸盐/铁（升到光球之上）  两支：1500–2200 K 反光的灰黄（Kepler-7b）；≳2200 K 极暗 + 自身热辐射的辉边
   *
   * 与原文的两处出入，都写在这里，不默默改：
   *   (a) 木星/土星的黄褐带纹按 SBP2000 属于第 I 类（T_eff 124/95 K），不是 150–250 K 那一段 —— 所以本模块
   *       把"乳白"与"木星式黄褐"都放在第 I 类里，用发色团含量这一个参数连续过渡。
   *   (b) SBP2000 预言第 V 类（≳1500 K）重新变亮；后来的实测表明只有一部分如此（Kepler-7b），
   *       更热的超热木星（≳2200 K）反而极暗并靠热辐射发光。两支都保留，按温度与随机数分。
   * 全部"示意"：分界温度是量级，实际还依赖重力、金属丰度与光化学；单颗行星的具体色相是过程生成的。
   */
  function gasCloudClass(tempK, seed, opts) {
    var T = isFinite(tempK) && tempK > 0 ? tempK : 0, rnd = mulberry32(hash32((seed >>> 0) ^ 0x6C10D)), o, u;
    var ch4 = !!(opts && opts.ice);
    /* 甲烷支只在 T < 350 K 时成立：天王星 76 K / 海王星 72 K 的青蓝来自甲烷吸收带，
       而这需要 CH₄ 真的是主要的碳载体、下面还得有一层亮的散射层。温度再高，CH₄ 被 CO 取代、
       云顶也沉下去了 —— 以前这里不看温度，于是出现了 1539 K 的"天王星色"迷你海王星。 */
    if (ch4 && T < 350) {
      // 冰巨星（天王星/海王星式）：甲烷在 0.6–0.9 μm 的吸收带吃掉红光 —— 保持既有的青蓝支，不给 sat/light/contrast 覆盖
      o = { cls: 'ice', key: 'methane', cn: TR('甲烷 + 氨冰云'), albedo: 0.30, hue: 190 + rnd() * 40, glow: 0,
        condPhrase: TR('主要凝结物为甲烷冰与氨冰'), look: TR('青蓝色（甲烷吸收 0.6–0.9 μm 的红光，只把蓝绿散射回来）'),
        ref: TR('甲烷吸收带 Karkoschka 1998 + 天王星/海王星实测') };
    } else if (T < 150) {
      u = rnd();                       // 发色团含量：0 = 土星那样的乳白，1 = 木星那样的黄褐
      o = { cls: 'I', key: 'ammonia', cn: TR('第 I 类 · 氨冰云'), albedo: 0.50, glow: 0,
        hue: 30 + u * 16 + (rnd() - 0.5) * 12, sat: lerp(0.07, 0.36, u), light: lerp(0.86, 0.70, u), contrast: lerp(0.09, 0.26, u), jit: 18,
        condPhrase: TR('主要凝结物为氨冰（NH₃，更深处还有 NH₄SH 与水云）'),
        look: u < 0.34 ? TR('高反照率的乳白色，带纹很淡（土星那一端）') : u < 0.7 ? TR('白中带浅黄褐的纬向云带') : TR('黄褐分明的明暗云带（木星那一端）—— 氨冰本身是白的，黄褐来自云顶的发色团（West et al. 2004；Carlson et al. 2016）') };
    } else if (T < 350) {
      u = 1 - smoothstep(250, 350, T);  // 250 K 附近最亮；往 350 K 走水云开始下沉、变暗
      o = { cls: 'II', key: 'water', cn: TR('第 II 类 · 水云'), albedo: lerp(0.55, 0.80, u), glow: 0,
        hue: 38 + rnd() * 18, sat: lerp(0.16, 0.05, u), light: lerp(0.72, 0.88, u), contrast: lerp(0.12, 0.06, u), jit: 10,
        condPhrase: TR('主要凝结物为水云（H₂O，氨已经不再凝结）'),
        look: TR('接近纯白、带纹很淡的高反照率云顶（这一类的 Bond 反照率可达 0.8，是五类里最亮的）') };
    } else if (T < 900) {
      u = 1 - smoothstep(350, 500, T);  // 350–500 K 还留一点高层水霾，比彻底晴空的要亮一些
      o = { cls: 'III', key: 'clear', cn: TR('第 III 类 · 晴空（Na/K 吸收）'), albedo: lerp(0.12, 0.28, u), glow: 0,
        hue: 236 + rnd() * 18, sat: lerp(0.72, 0.44, u), light: lerp(0.21, 0.36, u), contrast: 0.05, jit: 8,
        condPhrase: TR('大气是晴空的（可凝结的物种都沉到光球之下）') + (u > 0.35 ? TR('，只剩一点高层水霾') : '') + TR('，可见光被 Na/K 共振线（589 / 770 nm）吃掉'),
        look: TR('深蓝紫色、几乎看不出带纹') + (u > 0.35 ? TR('（残余的水霾让它没那么暗）') : TR('（瑞利散射剩下的蓝端就是它唯一的颜色，反照率只有 ~0.12）')) };
    } else if (T < 1500) {
      if (rnd() < 0.3) {               // 变体：HD 189733b 式的深蓝（高层硅酸盐颗粒散射）
        o = { cls: 'IV', key: 'silicate-blue', cn: TR('第 IV 类 · 碱金属吸收（硅酸盐散射变体）'), albedo: 0.22, glow: 0,
          hue: 214 + rnd() * 14, sat: 0.58 + rnd() * 0.12, light: 0.27, contrast: 0.07, jit: 8,
          condPhrase: TR('主要凝结物为硅酸盐与铁（大部分沉在光球之下，但有一部分颗粒被抬到高层）'),
          look: TR('深蓝色 —— 与 HD 189733b 同型：高层硅酸盐颗粒把蓝光散射回来，红端仍被 Na/K 吸收（Evans et al. 2013 测到 290–450 nm 的几何反照率 ≈0.4）') };
      } else {
        o = { cls: 'IV', key: 'alkali', cn: TR('第 IV 类 · 碱金属吸收'), albedo: 0.03 + rnd() * 0.04, glow: 0,
          hue: 12 + rnd() * 14, sat: 0.46 + rnd() * 0.14, light: 0.17, contrast: 0.11, jit: 10,
          condPhrase: TR('主要凝结物为硅酸盐与铁，但它们凝结在光球之下，云顶之上是 Na/K 蒸气'),
          look: TR('几乎不反光的暗红褐色，只有少数几条云带亮一点（这一类的反照率低到 ~0.03）') };
      }
    } else {
      var ultra = T >= 2200 || rnd() < 0.45;
      if (ultra) {
        o = { cls: 'V', key: 'ultrahot', cn: TR('第 V 类 · 超热木星（热辐射）'), albedo: 0.05, glow: clamp(smoothstep(1500, 2400, T), 0.25, 1),
          hue: 8 + rnd() * 12, sat: 0.52 + rnd() * 0.14, light: 0.11, contrast: 0.045, jit: 6,
          condPhrase: TR('云顶什么也凝结不了（矿物与氢分子都被热解离），TiO/VO 造成温度反转'),
          look: TR('一个几乎全黑的球，只有边缘因自身热辐射而发光 —— 超热木星在可见光里极暗（WASP-12b 的 A_g < 0.064，Bell et al. 2017），看到的是它自己的光而不是恒星的反光（WASP-121b：Evans et al. 2017）') };
      } else {
        o = { cls: 'V', key: 'silicate', cn: TR('第 V 类 · 高层硅酸盐/铁云'), albedo: 0.32 + rnd() * 0.1, glow: clamp(smoothstep(1500, 2400, T) * 0.5, 0.05, 0.4),
          hue: 30 + rnd() * 16, sat: 0.20 + rnd() * 0.1, light: 0.60, contrast: 0.12, jit: 10,
          condPhrase: TR('主要凝结物为硅酸盐与铁，且云层已经升到光球之上'),
          look: TR('偏灰黄的反光云顶 —— SBP2000 预言的"重新变亮"的一支，Kepler-7b 就是这样（A_g ≈ 0.35，Demory et al. 2011/2013）') };
      }
    }
    o.tempK = Math.round(T); o.hue = ((o.hue % 360) + 360) % 360;
    // 富甲烷但已经太热的天体（暖海王星）：走上面的常规分类，只在说明里交代它为什么不再是天王星那种青蓝
    if (ch4 && o.cls !== 'ice') o.condPhrase = TR('甲烷已不再凝结（这个温度下 CH₄ 逐步让位给 CO，天王星式的青蓝没有了）；') + o.condPhrase;
    if (o.sat != null) {
      o.color = hex(hsl(o.hue, o.sat, clamp(o.light - o.contrast * 0.4, 0.03, 0.95)));
      o.atm = hsl(o.hue, o.sat * 0.75, clamp(Math.max(o.light, 0.34) + 0.1, 0.1, 0.92));
    } else {
      /* 甲烷支不给 sat/light/contrast（云带公式要逐字保持旧口径），但仍要给一个代表色：
         以前这里没给，恒星系视图里的冰巨星圆点一直沿用 VISUAL.gas 的土黄 #c9a978，
         和球面上的青蓝对不上。取值与 generic 云带公式同源（sat 0.5 / light 0.55）。 */
      o.color = hex(hsl(o.hue, 0.5, 0.55));
    }
    o.ref = o.ref || TR('Sudarsky et al. 2000 巨行星反照率分类');
    o.note = TR('云顶温度 ') + o.tempK + TR(' K：') + o.condPhrase + TR('，因此呈') + o.look + TR('（依据：') + o.ref + TR('，示意）');
    /* 托林雾霾：一层**盖在**云顶之上的有机气溶胶，所以不去改分类给出的色相，
       而是把最终颜色朝托林色混过去（雾霾是覆盖在下面那层云上的吸收/散射体，本来就该这样叠）。
       只在冷（≲210 K）且有 CH₄ 的类别上生效 —— 第 III/IV/V 类太热，tholinOf 那边 tau 天然为 0。
       甲烷支（冰巨星）同样适用：海卫一就是"甲烷冰 + 托林"的粉红。 */
    if (opts && opts.tholin && opts.tholin.tau > 0.06) {
      var th = opts.tholin, kT = clamp(th.tau * 0.85, 0, 0.9);
      o.tholin = th.tau; o.tholinColor = th.color;
      o.color = hex(mix3(rgb(o.color), th.color, kT));
      if (o.atm) o.atm = mix3(o.atm, mix3(th.color, [1, 1, 1], 0.25), kT * 0.8);
      o.albedo = lerp(o.albedo, 0.22, kT);          // 托林是暗红物质：盖上去会把反照率拉低
      o.tholinNote = th.note;                        // 单独一行，别接在云顶那行后面（HUD 不换行，接上去会被截掉）
    } else o.tholin = 0;
    return o;
  }
  // 把分类结果写进 visual：色相、带纹饱和度/明度/对比、系统视图用的点色、大气边光、超热木星的辉边、托林雾霾
  function applyGasLook(vis, tempK, subtype, seed, tholin) {
    var ice = subtype === 'iceGiant' || subtype === 'miniNeptune';
    var gc = gasCloudClass(tempK, seed, { ice: ice, tholin: tholin });
    vis.hue = gc.hue; vis.gasClass = gc.cls; vis.gasKey = gc.key; vis.gasNote = gc.note; vis.gasAlbedo = gc.albedo; vis.gasGlow = gc.glow || 0;
    vis.tholin = gc.tholin || 0; vis.tholinColor = gc.tholinColor || null; vis.tholinNote = gc.tholinNote || null;
    if (gc.color) vis.color = gc.color;   // 甲烷支也给点色：恒星系视图的圆点要和球面同色
    if (gc.sat != null) { vis.gasSat = gc.sat; vis.gasLight = gc.light; vis.gasContrast = gc.contrast; vis.gasHueJit = gc.jit; vis.atm = gc.atm;
      /* 边光强度跟着散射反照率走：第 I/II 类（A≈0.5–0.8）保持原来的 0.9，
         第 III–V 类（A≈0.03–0.12）本来就吸收掉了大部分光，边上不该再挂一圈亮环。 */
      vis.atmDensity = +clamp(0.36 + gc.albedo * 1.1, 0.36, 0.95).toFixed(2); }
    return gc;
  }
  /* 冰质**表面**（冰卫星 / 冷冰行星 / 柯伊伯带天体）上的托林沉积：没有云带可叠，
     直接给 visual 挂一个 tholin 系数，由 buildPalette 把整张色板朝托林色混过去。 */
  function applyTholinSurface(vis, tempK, star, aAU, ageGyr, seed, scale) {
    var rnd = mulberry32(hash32((seed >>> 0) ^ 0x7401C)), dose = uvDoseOf(star, aAU, ageGyr);
    var th = tholinOf(tempK, dose, rnd, true);
    if (scale != null && th.tau) { th.tau *= scale; if (scale < 1) th.note = th.note.replace(TR('只积不散'), TR('一边沉积一边被喷发与裂隙翻新（所以只有薄薄一层）')); }
    vis.tholin = th.tau > 0.06 ? th.tau : 0; vis.tholinColor = th.color || null; vis.tholinNote = vis.tholin ? th.note : null;
    if (vis.tholin) vis.color = hex(mix3(rgb(vis.color), th.color, clamp(vis.tholin * 0.8, 0, 0.85)));
    return th;
  }

  /* ============================================================ 多星系统：多重性 / 双星参数 / 稳定判据 / N 体 */
  // 多重性：Raghavan et al. 2010 (ApJS 190, 1)，太阳型恒星：单 ~56% / 双 ~33% / 三 ~8% / 四及以上 ~3%；
  // 按质量微调（scaling：大质量更多伴星、M 型更少，参考 Duchêne & Kraus 2013 综述趋势）
  /* 多重性：伴星率随质量单调上升（Duchêne & Kraus 2013 表 1：褐矮星 ~20%、M 矮星 26±3%、太阳型 44±2%（Raghavan 2010）、
     A 型 ~50%、O/B ≳70–80%）。多星内部按 Raghavan 2010 的太阳型比例拆成 双:三:四+ = 33:8:3（≈75/18/7%），
     这一步与质量无关是简化。整体单星比例因此高于 Raghavan 的 56%（我们的样本是 IMF 全质量段，M 矮星占八成）—— 见 MULT_NOTE。 */
  var MULT_FRAC = [[0.05, 0.20], [0.3, 0.26], [0.6, 0.34], [1.0, 0.44], [1.6, 0.50], [5, 0.60], [16, 0.80], [50, 0.85]];
  function multFraction(mass) {
    var t = MULT_FRAC, i = 0; if (mass <= t[0][0]) return t[0][1]; if (mass >= t[t.length - 1][0]) return t[t.length - 1][1];
    while (i < t.length - 2 && t[i + 1][0] < mass) i++;
    var f = (Math.log(mass) - Math.log(t[i][0])) / (Math.log(t[i + 1][0]) - Math.log(t[i][0]));
    return lerp(t[i][1], t[i + 1][1], f);
  }
  function drawMultiplicity(mass, rnd) { var mf = multFraction(mass), u = rnd(); if (u >= mf) return 1; var v = (u / mf) * 44; return v < 33 ? 2 : v < 41 ? 3 : 4; }
  function gaussRnd(rnd) { var u = Math.max(rnd(), 1e-9), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
  // 双星参数：q 近平坦分布（0.1–1）；周期对数正态 log10 P[天] μ=5.03 σ=2.28（Raghavan 2010）；e：P<12 天圆化，否则 0–0.8 近均匀
  function drawBinaryElements(rnd, mTot, minLogP, maxLogP) { var q = 0.1 + rnd() * 0.9, logP = clamp(5.03 + 2.28 * gaussRnd(rnd), minLogP != null ? minLogP : 0.3, maxLogP != null ? maxLogP : 8.6), Pd = Math.pow(10, logP), Pyr = Pd / 365.25, a = Math.cbrt(mTot * Pyr * Pyr), e = Pd < 12 ? 0 : rnd() * 0.8; return { q: q, Pyr: Pyr, a: a, e: e, phase: rnd() * TAU, omega: rnd() * TAU }; }
  // Mardling & Aarseth 2001：分层三体稳定判据 a_out(1−e_out)/a_in > 2.8[(1+q_out)(1+e_out)/√(1−e_out)]^{2/5}(1−0.3 i/180°)
  function ma01Crit(qOut, eOut, incDeg) { return 2.8 * Math.pow((1 + qOut) * (1 + eOut) / Math.sqrt(Math.max(1e-6, 1 - eOut)), 0.4) * (1 - 0.3 * (incDeg || 0) / 180); }
  function ma01Stable(aIn, aOut, eOut, qOut, incDeg) { return aOut * (1 - eOut) / aIn > ma01Crit(qOut, eOut, incDeg); }
  // Holman & Wiegert 1999：S 型（绕单颗）临界半长轴上限；P 型（绕双星）临界半长轴下限。μ = 伴星质量/总质量
  function critS(aB, e, mu) { return aB * (0.464 - 0.380 * mu - 0.631 * e + 0.586 * mu * e + 0.150 * e * e - 0.198 * mu * e * e); }
  function critP(aB, e, mu) { return aB * (1.60 + 5.10 * e - 2.22 * e * e + 4.12 * mu - 4.27 * e * mu - 5.09 * mu * mu + 4.61 * e * e * mu * mu); }
  function starFromMass(mass, rnd, name) { var sc = starClassOf(mass); rnd(); return { name: name, type: sc.cls, cls: sc.cls, spt: sc.spt, color: sc.col, massRel: +mass.toFixed(3), tempK: sc.T, lumRel: +sc.lumRel.toPrecision(4) * 1, radiusRel: +sc.radiusRel.toFixed(3) }; }
  // 生成层级：返回 {stars:[...], root: node, note}；node = {kind:'star', i, mass, lum} | {kind:'bin', a, P, e, phase, omega, mass, lum, members:[nodeA,nodeB], q, stable}
  function buildHierarchy(N, mass, rnd, name) {
    var stars = [starFromMass(mass, rnd, name + (N > 1 ? ' A' : ''))], letters = ['A', 'B', 'C', 'D'];
    function starNode(i) { return { kind: 'star', i: i, mass: stars[i].massRel, lum: stars[i].lumRel }; }
    function binNode(A, B, el) { return { kind: 'bin', a: el.a, P: el.Pyr, e: el.e, phase: el.phase, omega: el.omega, mass: A.mass + B.mass, lum: A.lum + B.lum, members: [A, B], q: B.mass / A.mass }; }
    var root = starNode(0), note = '';
    if (N >= 2) { var el1 = drawBinaryElements(rnd, mass * 1.5); var m1 = el1.q * mass; stars.push(starFromMass(m1, rnd, name + ' B')); el1.a = Math.cbrt((mass + m1) * el1.Pyr * el1.Pyr); root = binNode(starNode(0), starNode(1), el1); note = TR('双星'); }
    if (N >= 3) { // 分层：内双 + 外伴，外轨道满足 MA01，否则重抽（最多 60 次），仍不满足则按判据 ×1.3 强制
      var inner = root, ok = false, el2, m2, tries = 0;
      while (!ok && tries < 60) { tries++; el2 = drawBinaryElements(rnd, inner.mass * 1.4, Math.log10(inner.P * 365.25) + 0.7); m2 = clamp(el2.q, 0.1, 1) * inner.mass * 0.8; el2.a = Math.cbrt((inner.mass + m2) * el2.Pyr * el2.Pyr); ok = el2.a * (1 - el2.e) / inner.a > 1.25 * ma01Crit(m2 / inner.mass, el2.e, 0); }
      if (!ok) { el2.a = 1.4 * ma01Crit(m2 / inner.mass, el2.e, 0) * inner.a / (1 - el2.e); el2.Pyr = Math.sqrt(Math.pow(el2.a, 3) / (inner.mass + m2)); }
      stars.push(starFromMass(m2, rnd, name + ' C')); root = binNode(inner, starNode(2), el2); root.stable = true; root.crit = ma01Crit(m2 / inner.mass, el2.e, 0); root.ratioP = el2.Pyr / inner.P; note = TR('分层三星（稳定判据 MA01）');
    }
    if (N >= 4) { // 2+2：两对内双互绕（外轨道对两组内双都满足 MA01）。N≥3 那步的外伴在这里被第二对取代
      var pair1 = (root.kind === 'bin' && root.members[0].kind === 'bin') ? root.members[0] : root;   // 第一对 = A+B
      stars.length = 2;                                                                              // 丢掉三合星那步的外伴，重新补 C、D（否则会截断掉刚推入的 D 星）
      var m3 = (0.2 + 0.6 * rnd()) * mass, m4 = (0.1 + 0.9 * rnd()) * m3;
      stars.push(starFromMass(m3, rnd, name + ' C')); stars.push(starFromMass(m4, rnd, name + ' D'));
      var mPair2 = stars[2].massRel + stars[3].massRel;                                              // 用 starNode 实际读到的质量，保证开普勒初值与 N 体一致
      var elIn2 = drawBinaryElements(rnd, mPair2, 0.3, 4.5); elIn2.a = Math.cbrt(mPair2 * elIn2.Pyr * elIn2.Pyr); var pair2 = binNode(starNode(2), starNode(3), elIn2);
      var aInMax = Math.max(pair1.a, pair2.a), okq = false, el3, t3 = 0;
      while (!okq && t3 < 60) { t3++; el3 = drawBinaryElements(rnd, pair1.mass + pair2.mass, Math.log10(Math.max(pair1.P, pair2.P) * 365.25) + 0.9); el3.a = Math.cbrt((pair1.mass + pair2.mass) * el3.Pyr * el3.Pyr); okq = el3.a * (1 - el3.e) / aInMax > 1.25 * ma01Crit(Math.max(pair1.mass, pair2.mass) / Math.min(pair1.mass, pair2.mass), el3.e, 0); }
      if (!okq) { el3.a = 1.4 * ma01Crit(1, el3.e, 0) * aInMax / (1 - el3.e); el3.Pyr = Math.sqrt(Math.pow(el3.a, 3) / (pair1.mass + pair2.mass)); }
      root = binNode(pair1, pair2, el3); root.stable = true; root.crit = ma01Crit(1, el3.e, 0); root.ratioP = el3.Pyr / Math.max(pair1.P, pair2.P); note = TR('四星（2+2 分层，MA01）');
    }
    var id = 0; (function tag(n) { n.id = id++; if (n.members) n.members.forEach(tag); })(root);
    return { stars: stars, root: root, note: note, N: N };
  }
  // 从层级得到 2D 初始条件（AU, yr；GM = 4π²M）：返回 {pos:[[x,y]...], vel:[[vx,vy]...], mass:[...]}
  function keplerRel(a, e, M, phase, omega) { var Mm = phase, E = Mm; for (var i = 0; i < 12; i++) E = E - (E - e * Math.sin(E) - Mm) / (1 - e * Math.cos(E)); var nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), r = a * (1 - e * Math.cos(E)), GM = 4 * PI * PI * M, h = Math.sqrt(GM * a * (1 - e * e)), vr = GM * e * Math.sin(nu) / h, vt = h / r; var cx = Math.cos(nu + omega), sx = Math.sin(nu + omega); var px = r * cx, py = r * sx, vx = vr * cx - vt * sx, vy = vr * sx + vt * cx; return { x: px, y: py, vx: vx, vy: vy }; }
  function hierarchyIC(h) { var pos = [], vel = [], mass = []; h.stars.forEach(function (s) { pos.push([0, 0]); vel.push([0, 0]); mass.push(s.massRel); });
    (function place(n, x, y, vx, vy) { if (n.kind === 'star') { pos[n.i] = [x, y]; vel[n.i] = [vx, vy]; return; } var A = n.members[0], B = n.members[1], k = keplerRel(n.a, n.e, n.mass, n.phase, n.omega), fA = -B.mass / n.mass, fB = A.mass / n.mass; place(A, x + fA * k.x, y + fA * k.y, vx + fA * k.vx, vy + fA * k.vy); place(B, x + fB * k.x, y + fB * k.y, vx + fB * k.vx, vy + fB * k.vy); })(h.root, 0, 0, 0, 0);
    return { pos: pos, vel: vel, mass: mass, t: 0 }; }
  // 通用 2D/3D N 体 RK4（G 可选，默认 4π²）
  var NBODY_EPS2 = 1e-6;   // Plummer 软化长度 ε = 1e−3 AU ≈ 0.2 R☉：恒星尺度，对正常轨道无影响
  function nbodyAccel(pos, mass, G, out) { var n = pos.length, d = pos[0].length, i, j, k; for (i = 0; i < n; i++) { out[i] = out[i] || new Array(d); for (k = 0; k < d; k++) out[i][k] = 0; }
    // Plummer 软化 ε：近距交会时 r→0 不再让 G/r³ 发散（三体演示必然出现掠过，否则积分炸成 NaN）
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) { var r2 = NBODY_EPS2, dv = []; for (k = 0; k < d; k++) { dv[k] = pos[j][k] - pos[i][k]; r2 += dv[k] * dv[k]; } var r = Math.sqrt(r2), inv = G / (r2 * r); for (k = 0; k < d; k++) { out[i][k] += inv * mass[j] * dv[k]; out[j][k] -= inv * mass[i] * dv[k]; } } return out; }
  function nbodyRK4(st, h, G) { var n = st.pos.length, d = st.pos[0].length, i, k, m = st.mass;
    var a1 = nbodyAccel(st.pos, m, G, []), p2 = [], v2 = []; for (i = 0; i < n; i++) { p2[i] = []; v2[i] = []; for (k = 0; k < d; k++) { p2[i][k] = st.pos[i][k] + 0.5 * h * st.vel[i][k]; v2[i][k] = st.vel[i][k] + 0.5 * h * a1[i][k]; } }
    var a2 = nbodyAccel(p2, m, G, []), p3 = [], v3 = []; for (i = 0; i < n; i++) { p3[i] = []; v3[i] = []; for (k = 0; k < d; k++) { p3[i][k] = st.pos[i][k] + 0.5 * h * v2[i][k]; v3[i][k] = st.vel[i][k] + 0.5 * h * a2[i][k]; } }
    var a3 = nbodyAccel(p3, m, G, []), p4 = [], v4 = []; for (i = 0; i < n; i++) { p4[i] = []; v4[i] = []; for (k = 0; k < d; k++) { p4[i][k] = st.pos[i][k] + h * v3[i][k]; v4[i][k] = st.vel[i][k] + h * a3[i][k]; } }
    var a4 = nbodyAccel(p4, m, G, []); for (i = 0; i < n; i++) for (k = 0; k < d; k++) { st.pos[i][k] += h / 6 * (st.vel[i][k] + 2 * v2[i][k] + 2 * v3[i][k] + v4[i][k]); st.vel[i][k] += h / 6 * (a1[i][k] + 2 * a2[i][k] + 2 * a3[i][k] + a4[i][k]); } st.t += h; }
  function nbodyEnergy(st, G) { var n = st.pos.length, d = st.pos[0].length, E = 0, i, j, k; for (i = 0; i < n; i++) { var v2 = 0; for (k = 0; k < d; k++) v2 += st.vel[i][k] * st.vel[i][k]; E += 0.5 * st.mass[i] * v2; } for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) { var r2 = NBODY_EPS2; for (k = 0; k < d; k++) r2 += Math.pow(st.pos[i][k] - st.pos[j][k], 2); E -= G * st.mass[i] * st.mass[j] / Math.sqrt(r2); } return E; } // 势能与加速度用同一套软化，能量守恒误差才有意义
  function nodePosition(node, st) { if (node.kind === 'star') return st.pos[node.i].slice(); var A = nodePosition(node.members[0], st), B = nodePosition(node.members[1], st), mA = node.members[0].mass, mB = node.members[1].mass; return [(A[0] * mA + B[0] * mB) / (mA + mB), (A[1] * mA + B[1] * mB) / (mA + mB)]; }
  function findNode(node, id) { if (node.id === id) return node; if (node.members) for (var i = 0; i < 2; i++) { var r = findNode(node.members[i], id); if (r) return r; } return null; }
  function minPeriod(node) { if (node.kind === 'star') return Infinity; return Math.min(node.P, minPeriod(node.members[0]), minPeriod(node.members[1])); }
  // Node 侧校验：分层三星长期积分（外周期数），返回是否仍分层束缚
  function runTripleTest(seed, outerPeriods) {
    var rnd = mulberry32((seed || 3) >>> 0), h = buildHierarchy(3, 1.0, rnd, 'T'), st = hierarchyIC(h), G = 4 * PI * PI, root = h.root, inner = root.members[0], Pin = inner.P, Pout = root.P, requested = outerPeriods, dt = Pin / 600 * Math.pow(1 - inner.e, 1.5); outerPeriods = Math.min(outerPeriods, 8e6 / (300 * root.ratioP)); /* 保证内轨道每圈 ≥300 步 */ var T = outerPeriods * Pout, E0 = nbodyEnergy(st, G), steps = Math.ceil(T / dt), maxIn = 0, minOut = Infinity, maxOut = 0;
    if (steps > 8e6) { dt = T / 8e6; steps = 8e6; }
    for (var s = 0; s < steps; s++) { nbodyRK4(st, dt, G); if (s % 50 === 0) { var dIn = Math.hypot(st.pos[0][0] - st.pos[1][0], st.pos[0][1] - st.pos[1][1]); var cin = nodePosition(inner, st), dOut = Math.hypot(st.pos[2][0] - cin[0], st.pos[2][1] - cin[1]); maxIn = Math.max(maxIn, dIn); minOut = Math.min(minOut, dOut); maxOut = Math.max(maxOut, dOut); } }
    var E1 = nbodyEnergy(st, G);
    return { aIn: inner.a, eIn: inner.e, PinYr: Pin, aOut: root.a, eOut: root.e, PoutYr: Pout, ratioP: root.ratioP, crit: root.crit, periRatio: root.a * (1 - root.e) / inner.a, outerPeriodsRequested: requested, outerPeriods: +outerPeriods.toFixed(1), steps: steps, maxInnerSep: maxIn, minOuterSep: minOut, maxOuterSep: maxOut, stillHierarchical: maxIn < 3 * inner.a * (1 + inner.e) && maxOut < 3 * root.a * (1 + root.e), energyErr: Math.abs((E1 - E0) / E0) };
  }
  /* ---------- 南门二（α Centauri）：真实参数（Kervella et al. 2016 A&A 594, A107；2017 A&A 598, L7；Pourbaix & Boffin 2016） */
  var ALPHA_CEN_SEED = 0xA1FA;
  function alphaCentauri(universeParams) {
    var nowYr = universeParams && universeParams.enterTimeGyr ? universeParams.enterTimeGyr * 1e9 : NOW_YR, age = 5.3, formed = nowYr - age * 1e9;
    var stars = [
      { name: '南门二 A（α Cen A）', type: 'G', cls: 'G2V', color: '#fff4e8', massRel: 1.0788, tempK: 5790, lumRel: 1.519, radiusRel: 1.2234, ageGyr: age, formedYr: formed, real: true },
      { name: '南门二 B（α Cen B）', type: 'K', cls: 'K1V', color: '#ffd8a8', massRel: 0.9092, tempK: 5260, lumRel: 0.5002, radiusRel: 0.8632, ageGyr: age, formedYr: formed, real: true },
      { name: '比邻星（Proxima Cen）', type: 'M', cls: 'M5.5Ve', color: '#ffb070', massRel: 0.1221, tempK: 3042, lumRel: 0.00155, radiusRel: 0.1542, ageGyr: age, formedYr: formed, real: true }];
    var inner = { kind: 'bin', a: 23.4, P: 79.91, e: 0.52, phase: 2.1, omega: 0.4, mass: 1.988, lum: 2.019, members: [{ kind: 'star', i: 0, mass: 1.0788, lum: 1.519 }, { kind: 'star', i: 1, mass: 0.9092, lum: 0.5002 }], q: 0.843, real: true, note: TR('A/B：P = 79.91 年，a ≈ 23.4 AU（17.57″ @ 1.3475 pc），e = 0.52') };
    var root = { kind: 'bin', a: 8700, P: 547000, e: 0.50, phase: 3.0, omega: 1.1, mass: 2.11, lum: 2.02, members: [inner, { kind: 'star', i: 2, mass: 0.1221, lum: 0.00155 }], q: 0.061, stable: true, real: true, note: TR('比邻星距 A/B 约 8700 AU，P ≈ 547 kyr，e ≈ 0.50（Kervella et al. 2017）') };
    root.crit = ma01Crit(0.061, 0.5, 0); root.ratioP = 547000 / 79.91; var id = 0; (function tag(n) { n.id = id++; if (n.members) n.members.forEach(tag); })(root);
    var star = Object.assign({}, stars[0], { name: '南门二', multiplicity: 3 });
    var sys = { id: 'alpha-cen', seed: ALPHA_CEN_SEED, name: '南门二', star: star, stars: stars, multiplicity: 3, hierarchy: { root: root, N: 3, note: TR('分层三星（真实参数）· 稳定判据 MA01 ✓') }, planets: [], habitableIndex: -1, nowYr: nowYr, isSolar: false, ringEndGyr: 0.2, universeHabitability: 1, dim: 3, dimMode: '3d', real: true, locateName: '定位南门二',
      note: TR('A/B 与比邻星参数：Kervella et al. 2016/2017；比邻星 b/d：Anglada-Escudé et al. 2016 / Faria et al. 2022；A/B 周围迄今没有确认的行星（S 型稳定区约 ≤ ') + fmt(critS(23.4, 0.52, 0.457), 1) + TR(' AU，HW99）') };
    function mk(o) { var vis = baseVisual(o.type); return { id: o.id, name: o.name, type: o.type, subtype: null, radiusRel: o.r, orbitAU: o.a, periodYr: o.p, ecc: o.e, phase: o.ph, gravityRel: o.g, atmosphere: { pressureRel: o.pa, color: '#a89888' }, tempK: o.T, moons: [], moonCount: 0, life: null, seed: o.seed, tilt: 0, rotationH: o.p * 365.25 * 24, color: vis.color, visual: vis, timeline: { formGyr: 0.05, oceanGyr: Infinity, greenGyr: Infinity, civGyr: Infinity }, starFormedYr: formed, nowYr: nowYr, star: { color: '#ffb070', lumRel: 0.00155, tempK: 3042 }, radiusM: o.r * EARTH_R_M, real: true, hostId: 2, orbitType: 'S', hostName: '比邻星', note: o.note, dim: 3 }; }
    sys.planets = [
      mk({ id: 0, name: '比邻星 d', type: 'rock', r: 0.81, a: 0.02885, p: 5.122 / 365.25, e: 0.04, ph: 1.2, g: 0.6, pa: 0, T: 360, seed: 0x50524F44, note: TR('Faria et al. 2022：最小质量 0.26 M⊕，半径为按质量推算（示意）') }),
      mk({ id: 1, name: '比邻星 b', type: 'rock', r: 1.07, a: 0.04856, p: 11.186 / 365.25, e: 0.11, ph: 2.9, g: 1.0, pa: 0, T: 234, seed: 0x50524F42, note: TR('Anglada-Escudé et al. 2016：最小质量 1.07 M⊕，位于宜居带；半径按质量推算，是否有大气未知（示意）') })];
    sys.planets.forEach(function (p) { p.system = sys; p.desc = TR('真实系外行星（半径与表面为按质量推算的示意）：') + p.note + TR('。绕比邻星运行，') + (p.name === '比邻星 b' ? TR('潮汐锁定，一面永昼。') : TR('离恒星更近，表面炽热。')); });
    return sys;
  }


  /* 行星引擎（engine/planet.js）：观测到这颗星球时按种子生成"行星参数与报告"，挂到 planet.params / planet.report；
     生命等级也由它的宜居性 + 年龄 + 种子决定（太阳系的实测行星不动）。引擎缺席则整段跳过，其余逻辑不变。 */
  var PLANET_ENGINE;
  /* 卫星 → 可进入的天体：把 planet.moons[] 里的一条记录升格成一个「行星式」对象，
     showGlobe / land / visualParams / getMaps 都能直接吃。母行星记在 .parent 上，导航栈据此逐级返回。
     密度取岩质 3340 / 冰质 1900 kg·m⁻³（g_rel = ρ/ρ⊕ · R_rel：月球 3344/5514×0.2727 = 0.165，与实测一致）。 */
  function moonBody(parent, mo, idx) {
    if (!parent || !mo) return null;
    var mt = mo.type === 'ice' || mo.type === 'lava' || mo.type === 'desert' ? mo.type : 'rock', icy = mt === 'ice';
    var vis = baseVisual(mt);
    if (icy) { vis.cracks = 1; vis.craters = 0.4; } else if (mt === 'rock') { vis.craters = 1.2; }
    if (mo.tidalHeated && icy) { vis.cracks = 1.3; vis.craters = 0.15; }  // 潮汐加热的冰壳：裂纹多、撞击坑被不断抹平（木卫二）
    /* 卫星表面的托林沉积（土卫六的橙黄、海卫一的粉红、木卫二裂隙里的红棕同源）。
       判据用**温度 + 富冰**而不是 type 字段：本模块只把受潮汐加热的卫星标成 'ice'，
       可是母行星在 160 K 以下时，外侧那些标成 'rock' 的卫星在真实太阳系里同样是冰质的
       （土卫六、木卫四、土卫五都不靠潮汐加热）。潮汐加热的那些 τ 打三折：
       喷发与裂隙让表面不断翻新（土卫二的反照率 0.8 就是这么来的），托林积不起来。 */
    var moonIcy = icy || (isFinite(parent.tempK) && parent.tempK < 160);
    if (moonIcy && !parent.real) {
      var mth = applyTholinSurface(vis, parent.tempK, parent.star, parent.orbitAU, ageGyrOf(parent, parent.nowYr), mo.seed, mo.tidalHeated ? 0.3 : 1);
      if (mth && mth.tau > 0.06 && !icy) { vis.palette = 'kbo'; }   // 冰质但没被标成 ice 的：换成托林红的色板（与柯伊伯带天体同一张）
    }
    var rho = icy ? 1900 : 3340, gRel = +(rho / 5514 * mo.radiusRel).toFixed(3);
    var rKm = mo.radiusRel * EARTH_R_M / 1000;
    var desc = TR(mo.desc) || ((mt === 'lava' ? TR('一颗被潮汐揉热的火山卫星') : icy ? TR('一颗冰质卫星') : mt === 'desert' ? TR('一颗有稀薄大气的卫星') : TR('一颗岩质卫星')) + TR('，半径约 ') + fmt(rKm, 0) + TR(' km，在 ') + fmtKm(mo.orbitKm * 1000) + TR(' 的轨道上绕') + TRN(parent.name) + TR('公转一周需要 ') + fmt(mo.periodDays, 2) + TR(' 天。')
      + (mo.tidalHeated ? TR('母行星的潮汐反复揉捏它的内部，冰壳下可能有一层液态水海洋（木卫二/土卫二类比，示意）。') : TR('表面几乎没有大气，昼夜温差很大。'))
      + TR('它多半已被潮汐锁定，永远以同一面朝向母行星。'));
    return {
      id: idx, name: mo.name, type: mt, subtype: null, isMoon: true, parent: parent, bodyKind: 'moon',
      radiusRel: mo.radiusRel, radiusM: mo.radiusRel * EARTH_R_M, visualKey: mo.key || null, visual: vis, color: vis.color,
      orbitAU: parent.orbitAU, periodYr: parent.periodYr, ecc: 0, phase: parent.phase || 0,       // 绕恒星的位置跟着母行星走：光照方向才对
      orbitKm: mo.orbitKm, periodDays: mo.periodDays, tidalHeated: !!mo.tidalHeated, tidalLocked: true,
      gravityRel: gRel, atmosphere: { pressureRel: 0, color: '#8a8a8a' }, tempK: parent.tempK, massEarth: +(rho / 5514 * Math.pow(mo.radiusRel, 3) * 1).toPrecision(3) * 1,
      moons: [], moonCount: 0, life: null, seed: mo.seed, tilt: 0, rotationH: (mo.periodDays || 10) * 24,
      pclass: 'moon', pclassCn: (mt === 'lava' ? '受潮汐加热的火山卫星' : mt === 'desert' ? '有大气的卫星' : mo.tidalHeated && icy ? '受潮汐加热的冰卫星' : icy ? '冰卫星' : '岩质卫星'),
      timeline: { formGyr: 0.05, oceanGyr: Infinity, greenGyr: Infinity, civGyr: Infinity },
      starFormedYr: parent.starFormedYr, nowYr: parent.nowYr, star: parent.star, hostName: parent.hostName, dim: parent.dim || 3,
      real: !!parent.real, desc: desc,
      ref: mo.tidalHeated ? TR('潮汐加热与冰下海洋：木卫二（Khurana 1998 的磁场证据）/ 土卫二（Porco 2006 的南极喷流）类比，示意') : null
    };
  }
  function moonsOfPlanet(p) { return (p && p.moons) ? p.moons.map(function (mo, i) { return moonBody(p, mo, i); }).filter(Boolean) : []; }

  /* ============================================================ 小天体：小行星 / 柯伊伯带天体 / 彗星 / 恒星近观
   * 与卫星走同一条路：把一条记录升格成「行星式」对象（有 radiusM / visual / seed / star / timeline），
   * showGlobe / land / visualParams / getMaps 就能直接吃，导航栈靠 .parent 与 .bodyKind 逐级返回。
   * 文献：
   *   Lineweaver & Norman 2010 (arXiv:1004.1091) —— 岩质天体直径 ≳ 400–600 km 才会被自引力揉圆，再小保持棱角
   *   Dohnanyi 1969 (JGR 74, 2531)               —— 碰撞级联的尺寸分布：累积 N(>D) ∝ D^{−2.5}
   *   DeMeo & Carry 2014 (Nature 505, 629)       —— 主带类型随日心距变化：内带 S 型为主、外带 C 型为主
   *   Britt et al. 2002 (Asteroids III)          —— 小行星密度 S 型 ~2.7 / C 型 ~1.4 g·cm⁻³（碎石堆，孔隙率高）
   *   Fujiwara et al. 2006 (Science 312, 1330)   —— 隼鸟号：糸川是一颗没有撞击坑的碎石堆，遍地砾石
   *   Margot et al. 2002 (Science 296, 1445)     —— 近地小行星里约 15% 是双小行星
   *   Hirayama 1918 (AJ 31, 185)                 —— 小行星族：同一次碰撞的碎块共享轨道要素
   *   Whipple 1950 (ApJ 111, 375)                —— 彗核的"脏雪球"模型
   *   Keller et al. 1986 (Nature 321, 320)       —— 乔托号：哈雷彗核反照率仅 ~0.04
   *   Pätzold et al. 2016 (Nature 530, 63)       —— 罗塞塔：67P 密度 533 kg·m⁻³、孔隙率 ~72%，双瓣形状
   *   Biermann 1951 / Finson & Probstein 1968    —— 离子尾背向太阳、尘埃尾受轨道拖曳而弯曲
   */
  var G_CONST = 6.674e-11, G_EARTH = 9.80665;
  /* 不规则形状：三轴椭球 + 几个凸起/凹坑/收腰（e ≥ 0 = 单侧凸起，e < 0 = 绕该轴的一圈收腰）。
     roundness = 0 全是棱角、1 已被自引力揉圆（Lineweaver & Norman 2010 的判据换算成半径 ~200–300 km）。 */
  function shapeOf(seed, roundness, opts) {
    opts = opts || {}; var r = mulberry32((seed >>> 0) ^ 0x5EA5);
    roundness = clamp(roundness, 0, 1);
    if (roundness >= 0.999 && !opts.bilobate) return null;                       // 完全球状：不进不规则分支
    var jit = function (a, b) { return a + (b - a) * r(); };
    var b_a = lerp(jit(0.52, 0.68), jit(0.96, 1.0), roundness), c_a = lerp(jit(0.38, 0.55), jit(0.94, 0.99), roundness);
    var amp = lerp(0.26, 0.015, roundness), lobes = [];
    function dir() { var z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(Math.max(0, 1 - z * z)); return [s * Math.cos(a), z, s * Math.sin(a)]; }
    if (opts.bilobate) {
      /* 双瓣彗核（罗塞塔在 67P 上看到的形状，Sierks et al. 2015）：沿长轴两个瓣 + 中间明显的"脖子"。
         长轴必须取 x —— uAxes = [1, b/a, c/a] 会把 y、z 压扁，瓣长在被压扁的方向上就只剩一个蛋。 */
      lobes.push([1, 0, 0, 0.46 + r() * 0.18, 2.0]);
      lobes.push([-1, 0, 0, 0.34 + r() * 0.18, 2.2]);
      lobes.push([1, 0, 0, -(0.34 + r() * 0.14), -2.4]);                          // 收腰：绕长轴的一圈凹陷
      b_a = jit(0.58, 0.74); c_a = jit(0.52, 0.68);
    }
    var nL = opts.bilobate ? 2 : 2 + Math.floor(r() * 3);
    for (var i = 0; i < nL && lobes.length < 6; i++) { var d = dir(), neg = r() < 0.42; lobes.push([d[0], d[1], d[2], (neg ? -0.7 : 1) * amp * (0.5 + r()), neg ? 4.0 : 2.0 + r() * 1.6]); }
    return { axes: [1, b_a, c_a], lobes: lobes, roundness: roundness, elongation: +(1 / c_a).toFixed(2) };
  }
  // 表面重力（m/s²）与逃逸速度（m/s）：均匀球 g = 4/3 πGρR，v_esc = √(2gR)
  function smallBodyG(rhoKgM3, radiusM) { return 4 / 3 * PI * G_CONST * rhoKgM3 * radiusM; }
  function escapeV(g, radiusM) { return Math.sqrt(2 * Math.max(g, 0) * Math.max(radiusM, 1)); }
  function beltAlbedo(kind, sType) { return kind === 'kuiper' ? 0.10 : sType ? 0.20 : 0.06; }   // Tedesco et al. 2002 (IRAS)

  /* 一颗带内天体 → 可进入的天体。belt 是 system.belts 里的一条；idx 决定取第几大的一颗。 */
  function asteroidBody(system, belt, idx, opts) {
    if (!system || !belt) return null;
    opts = opts || {}; idx = idx || 0;
    var member = belt.members && belt.members[idx] ? belt.members[idx] : null;
    var seed = member ? member.seed : hash32((system.seed >>> 0) ^ ((belt.kind === 'kuiper' ? 0x4B42 : 0x4153) + idx * 0x9E3779B9));
    var r = mulberry32(seed ^ 0x1CE), kuiper = belt.kind === 'kuiper';
    // 半径：Dohnanyi 碰撞级联，累积 N(>R) ∝ R^{−2.5} → 第 k 大的半径 ≈ R_max·(k+1)^{−0.4}。
    // R_max 用「整条带一个」的种子，第 k 颗才真的比第 k−1 颗小（每颗各抽一次的话大小会乱序）。
    var rb = mulberry32(hash32((system.seed >>> 0) ^ (belt.kind === 'kuiper' ? 0x4B4254 : 0x415354)));
    var rMaxKm = kuiper ? 420 + rb() * 780 : 180 + rb() * 320;
    var radiusKm = member ? member.radiusKm : rMaxKm * Math.pow(idx + 1, -0.4) * (0.88 + 0.24 * r());
    radiusKm = Math.max(radiusKm, kuiper ? 12 : 4);
    var au = member && member.orbitAU != null ? member.orbitAU : belt.innerAU + (belt.outerAU - belt.innerAU) * (0.18 + 0.64 * r());
    // 类型：DeMeo & Carry 2014 —— 内带偏 S 型（硅酸盐），外带与柯伊伯带偏 C/冰质。实测天体直接按反照率判（S 型亮、C 型暗）
    var sType = member && member.albedo != null ? (!kuiper && member.albedo > 0.14) : (!kuiper && r() < clamp(1.25 - au / 2.6, 0.08, 0.85));
    var icy = kuiper || (!member && !sType && au > 3.2 && r() < 0.5);
    var rhoKgM3 = member && member.rhoKgM3 ? member.rhoKgM3 : (kuiper ? 1600 + r() * 600 : sType ? 2400 + r() * 500 : 1300 + r() * 500);
    var radiusM = radiusKm * 1000, gAbs = smallBodyG(rhoKgM3, radiusM), vEsc = escapeV(gAbs, radiusM);
    var host = system.star || {}, lum = isFinite(host.lumRel) ? host.lumRel : 1;
    var albedo = member && member.albedo != null ? member.albedo : beltAlbedo(belt.kind, sType);
    var T = Math.round(clamp(tempAt(lum, au, albedo), 3, 900));
    if (icy && T > 165) icy = false;   // 水冰在 ~165 K 以上就守不住了（真空升华）：这条带虽然在雪线外的位置，但宿主太亮，还是按岩质处理
    // 自引力揉圆的判据：直径 ≳ 400–600 km（半径 200–300 km）才压得住岩石强度（Lineweaver & Norman 2010）；几十 km 的全是棱角
    var roundness = smoothstep(30, 400, radiusKm);
    var shape = member && member.round ? null : shapeOf(seed, roundness);
    var vis = baseVisual(icy ? 'ice' : 'rock');
    vis.palette = kuiper ? 'kbo' : sType ? 'regolithS' : 'regolith';
    vis.craters = kuiper ? 1.1 : 1.7; vis.cracks = kuiper ? 0.5 : 0; vis.atmDensity = 0; vis.cloud = 0; vis.sea = -1;
    vis.rangeM = Math.max(radiusM * 0.055, 400); vis.detailAmp = 0.018; vis.detailFreq = 64; vis.spec = 0.03;
    vis.iceLat = kuiper ? 0.0 : 9; vis.iceHeight = 0; vis.color = kuiper ? '#8a6a52' : sType ? '#9a8a70' : '#4e483f';
    var name = member ? member.name : (kuiper ? TR('柯伊伯带天体 ') : TR('小行星 ')) + (1 + idx) + TR('（') + TRN(system.name) + TR('）');
    var rot = member && member.rotH ? member.rotH : +(2.4 + r() * 16).toFixed(2);   // 自转周期：小天体普遍 2–20 h，2.2 h 是碎石堆的自转解体极限（Pravec & Harris 2000）
    var b = {
      id: idx, name: name, type: icy ? 'ice' : 'rock', subtype: null, bodyKind: 'asteroid', isAsteroid: true, isSmallBody: true,
      belt: belt, beltKind: belt.kind, beltIndex: idx, parent: null, system: system, landable: true,
      radiusRel: radiusM / EARTH_R_M, radiusM: radiusM, radiusKm: +radiusKm.toFixed(1), visualKey: kuiper ? 'kbo' : 'asteroid', visual: vis, color: vis.color,
      shape: shape, sType: sType, icy: icy, albedo: albedo, rhoKgM3: Math.round(rhoKgM3),
      orbitAU: +au.toFixed(3), periodYr: +Math.pow(au, 1.5).toFixed(3), ecc: +(0.02 + r() * 0.22).toFixed(3), phase: r() * TAU, tilt: +(r() * 40).toFixed(1), rotationH: rot,
      gravityRel: +(gAbs / G_EARTH).toPrecision(3), gravityMS2: +gAbs.toPrecision(3), escapeMS: +vEsc.toPrecision(3),
      atmosphere: { pressureRel: 0, color: '#000000' }, tempK: T, moons: [], moonCount: 0, life: null, seed: seed,
      massEarth: +(4 / 3 * PI * Math.pow(radiusM, 3) * rhoKgM3 / 5.972e24).toPrecision(3),
      pclass: 'smallBody', pclassCn: kuiper ? '柯伊伯带天体（冰质星子）' : sType ? 'S 型小行星（硅酸盐）' : 'C 型小行星（碳质）',
      timeline: { formGyr: 0.02, oceanGyr: Infinity, greenGyr: Infinity, civGyr: Infinity },
      starFormedYr: system.star ? system.star.formedYr : null, nowYr: system.nowYr, star: system.star, hostName: system.star ? system.star.name : null,
      dim: system.dim || 3, real: !!(member && member.real),
      ref: (member && TR(member.ref)) || TR('Dohnanyi 1969 的碰撞级联尺寸分布 + DeMeo & Carry 2014 的类型分布 + Britt et al. 2002 的密度（示意）')
    };
    b.desc = (member && TR(member.desc)) || (TR('一颗') + (kuiper ? TR('冰质的柯伊伯带天体') : sType ? TR('硅酸盐质的 S 型小行星') : TR('碳质的 C 型小行星')) + TR('，平均半径约 ') + fmt(radiusKm, radiusKm < 20 ? 1 : 0) + TR(' km，')
      + (roundness > 0.8 ? TR('尺寸已经大到被自身引力揉成近似的球。') : TR('形状不规则——它太小，自引力压不住岩石的强度（Lineweaver & Norman 2010）。'))
      + TR('表面重力只有 ') + gAbs.toPrecision(2) + TR(' m/s²（地球的 ') + (gAbs / G_EARTH).toExponential(1) + TR(' 倍），逃逸速度 ') + (vEsc < 100 ? fmt(vEsc, 1) + ' m/s' : fmt(vEsc / 1000, 2) + ' km/s') + TR('——')
      + (vEsc < 20 ? TR('在这里用力一跳就再也落不回来。') : TR('跳起来要很久才落地。')) + TR('没有大气，')
      + (kuiper ? TR('太阳只是一个不比别的星亮多少的点，表面温度约 ') + T + TR(' K。') : TR('天空永远是黑的，恒星是一个刺眼的亮点，表面温度约 ') + T + TR(' K。')));
    return b;
  }
  function beltBodiesOf(system, opts) {
    if (!system || !system.belts || !system.belts.length) return [];
    opts = opts || {}; var per = opts.per || 4, out = [];
    system.belts.forEach(function (belt) {
      var n = belt.members ? Math.min(belt.members.length, per) : per;
      for (var i = 0; i < n; i++) { var b = asteroidBody(system, belt, i); if (b) { b.listIndex = out.length; out.push(b); } }
    });
    return out;
  }

  /* 一颗彗星 → 可进入的天体。轨道要素在 system.comets 的量级上按 seed 抽，
     日心距 r(t) 由开普勒方程给出——所以彗发/彗尾的强弱随时间条变化，这是"活动度随日心距变化"的来源。 */
  function cometBody(system, idx, opts) {
    if (!system) return null;
    idx = idx || 0;
    var C = system.comets, seed = hash32((system.seed >>> 0) ^ (0xC0E7 + idx * 0x9E3779B9)), r = mulberry32(seed ^ 0x517E);
    var q = +(0.35 + Math.pow(r(), 1.6) * 2.6).toFixed(3);                              // 近日距
    var Q = +(18 + r() * (C && C.oortAU ? Math.min(C.oortAU / 900, 260) : 90)).toFixed(1);  // 远日距
    var a = (q + Q) / 2, e = +((Q - q) / (Q + q)).toFixed(4), P = +Math.pow(a, 1.5).toFixed(1);
    /* 相位：不是随机抽的。按开普勒第二定律，长周期彗星绝大部分时间待在远日点附近——
       上面这颗 q=2 AU / Q=90 AU 的彗星，一个 319 年的周期里只有约半年在 3 AU 以内（占 0.2%）。
       随机取相位的话三颗必然都是休眠的黑冰，"活动随日心距变化"根本看不出来；
       而现实里我们能列出名字的彗星，恰恰是此刻正在（或刚过）活动期的那几颗。
       所以这里按"此刻的日心距"钉住平近点角：第 0 颗在近日点、第 1 颗正在离开、第 2 颗还在远日点一侧。
       往后拖时间条，三颗各自照开普勒方程演化——活动度也就跟着变。 */
    var meanAnomAtR = function (rT) { var cE = clamp((1 - clamp(rT, q, Q) / a) / Math.max(e, 1e-9), -1, 1), E = Math.acos(cE); return E - e * Math.sin(E); };
    var M0 = meanAnomAtR([q * 1.01, q * 2.4, a * 1.35][idx % 3]), tNow = (system.nowYr || NOW_YR) - (system.star && system.star.formedYr != null ? system.star.formedYr : 0);
    var rKm = +(0.6 + Math.pow(r(), 1.7) * 22).toFixed(2);                              // 彗核半径：67P ~2 km、哈雷 ~5.5 km、Hale-Bopp ~30 km
    var radiusM = rKm * 1000, rho = 400 + r() * 350;                                    // 罗塞塔：67P 533 kg/m³
    var gAbs = smallBodyG(rho, radiusM), vEsc = escapeV(gAbs, radiusM);
    var vis = baseVisual('ice');
    vis.palette = 'comet'; vis.craters = 0.55; vis.cracks = 0.35; vis.atmDensity = 0; vis.cloud = 0; vis.sea = -1;
    vis.rangeM = Math.max(radiusM * 0.16, 120); vis.detailAmp = 0.022; vis.detailFreq = 64; vis.spec = 0.02;
    vis.iceLat = 9; vis.iceHeight = 0; vis.color = '#2a251f'; vis.iceColor = [0.55, 0.56, 0.58];
    var host = system.star || {}, lum = isFinite(host.lumRel) ? host.lumRel : 1;
    var b = {
      id: idx, name: TR('彗星 C/') + TRN(system.name || '') + ' ' + String.fromCharCode(65 + (idx % 26)) + (1 + (seed % 9)), bodyKind: 'comet', isComet: true, isSmallBody: true,
      type: 'ice', subtype: null, parent: null, system: system, landable: true,
      radiusRel: radiusM / EARTH_R_M, radiusM: radiusM, radiusKm: rKm, visualKey: 'comet', visual: vis, color: vis.color, albedo: 0.04, rhoKgM3: Math.round(rho),
      // 双瓣的比例给高：被探测器拍到过的彗核（67P、19P/Borrelly、8P/Tuttle、103P/Hartley 2）几乎都是双瓣或强烈拉长的
      shape: shapeOf(seed, 0, { bilobate: r() < 0.78 }),
      orbitAU: +a.toFixed(2), perihelionAU: q, aphelionAU: Q, ecc: e, periodYr: P, phase: M0 - TAU * (tNow / Math.max(P, 1e-6)), meanAnomalyNow: M0, tilt: +(r() * 160).toFixed(1), rotationH: +(5 + r() * 14).toFixed(2),
      gravityRel: +(gAbs / G_EARTH).toPrecision(3), gravityMS2: +gAbs.toPrecision(3), escapeMS: +vEsc.toPrecision(3),
      atmosphere: { pressureRel: 0, color: '#9fe0c8' }, tempK: Math.round(clamp(tempAt(lum, Math.max(q, 0.1), 0.04), 3, 400)),
      moons: [], moonCount: 0, life: null, seed: seed, massEarth: +(4 / 3 * PI * Math.pow(radiusM, 3) * rho / 5.972e24).toPrecision(3),
      pclass: 'comet', pclassCn: P > 200 ? '长周期彗星（奥尔特云来源）' : '短周期彗星',
      timeline: { formGyr: 0.02, oceanGyr: Infinity, greenGyr: Infinity, civGyr: Infinity },
      starFormedYr: system.star ? system.star.formedYr : null, nowYr: system.nowYr, star: system.star, hostName: system.star ? system.star.name : null,
      dim: system.dim || 3, real: false, sublimAU: 3.0,
      // 活动期有多短：3 AU 以内的那一段占整个周期的多少（开普勒第二定律的直接后果）
      activeWindowYr: +(2 * meanAnomAtR(3.0) / TAU * P).toPrecision(3), activeFrac: +(2 * meanAnomAtR(3.0) / TAU).toPrecision(3),
      ref: TR('Whipple 1950 的脏雪球模型 · 核密度与双瓣形状取 Rosetta/67P（Pätzold et al. 2016）· 反照率 0.04 取 Giotto/哈雷（Keller et al. 1986）· 离子尾 Biermann 1951 / 尘埃尾 Finson & Probstein 1968（示意）')
    };
    b.desc = TR('一颗') + TR(b.pclassCn) + TR('：核是一块半径约 ') + fmt(rKm, 2) + TR(' km 的冰与尘埃的混合物，密度只有 ') + Math.round(rho) + TR(' kg/m³（比水还轻，内部大半是空的）。')
      + TR('轨道近日 ') + q + TR(' AU、远日 ') + Q + TR(' AU，绕一圈需要 ') + fmt(P, 1) + TR(' 年。')
      + TR('它的样子随日心距变：进到约 3 AU 以内水冰开始升华，喷出的气体与尘埃形成彗发与两条尾；退回远日点就只剩一块几乎全黑的冰。');
    return b;
  }
  function cometBodiesOf(system, opts) {
    if (!system || !system.comets) return [];
    opts = opts || {};
    var n = opts.count || clamp(Math.round((system.comets.longPeriodPerCentury || 5) / 8) + 1, 1, 3), out = [];
    for (var i = 0; i < n; i++) { var c = cometBody(system, i); if (c) { c.listIndex = i; out.push(c); } }
    return out;
  }
  /* 彗星在 timeYr 时刻的日心距与活动度。
     r(t)：解开普勒方程（与恒星系视图里画彗星用的是同一套要素）。
     活动度：水冰的升华在约 3 AU 以内才明显（Meech & Svoren 2004 综述），产气率再按 1/r² 的日照标度。 */
  function cometStateAt(c, timeYr) {
    if (!c) return null;
    var t = (timeYr != null ? timeYr : (c.nowYr || NOW_YR)) - (c.starFormedYr != null ? c.starFormedYr : 0);
    var a = c.orbitAU, e = c.ecc, M = TAU * (t / Math.max(c.periodYr, 1e-6)) + (c.phase || 0);
    if (!isFinite(M)) M = c.phase || 0;
    M = ((M + PI) % TAU + TAU) % TAU - PI;                                      // 先折进 [−π, π]：e→1 时牛顿法从大 M 起步不收敛
    var E = e < 0.8 ? M : (M >= 0 ? PI : -PI), i;                                // 高偏心率用 π 起步（标准做法）
    for (i = 0; i < 60; i++) { var d = (E - e * Math.sin(E) - M) / Math.max(1 - e * Math.cos(E), 1e-6); E -= clamp(d, -0.9, 0.9); if (Math.abs(d) < 1e-12) break; }
    var nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    var rAU = a * (1 - e * Math.cos(E));
    var subl = smoothstep(c.sublimAU * 1.6, c.sublimAU * 0.5, rAU);            // 升华开关：~3 AU 以内打开
    var flux = 1 / Math.max(rAU * rAU, 1e-4);
    var act = clamp(subl * clamp(flux * Math.max(c.perihelionAU, 0.05) * Math.max(c.perihelionAU, 0.05) * 1.0, 0, 1.6), 0, 1);
    var comaKm = act * (2e4 + 1.4e5 * act), tailKm = act * (5e6 + 8e7 * act * act);
    var toPeri = (M < 0 ? -M : TAU - M) / TAU * c.periodYr;                     // 距下一次过近日点还有多少年（M 已折进 [−π,π]）
    return { rAU: +rAU.toFixed(3), nu: nu, activity: +act.toFixed(3), comaKm: comaKm, tailKm: tailKm, meanAnomaly: +M.toFixed(5), toPerihelionYr: +toPeri.toPrecision(4),
      phase: rAU < a ? (nu > 0 && nu < PI ? '正在离开近日点' : '正在接近近日点') : (nu > 0 && nu < PI ? '正在远离恒星' : '正在返回'),
      state: act > 0.55 ? '强烈活动（彗发与彗尾完全展开）' : act > 0.12 ? '开始活动（彗发出现，尾还短）' : act > 0.01 ? '刚刚苏醒' : '休眠（只剩一块黑冰）' };
  }

  /* 恒星本体 → 可「近观」但不可降落的天体。半径用 R☉，观察距离按辐照给一个"安全距离"。 */
  var R_SUN_M = 6.957e8, AU_M = 1.495978707e11;
  function starBody(system, star, opts) {
    star = star || (system && system.star); if (!star) return null;
    opts = opts || {};
    var stage = star.stage || 'ms', remnant = !!star.remnant;
    var rSun = isFinite(star.radiusRel) && star.radiusRel > 0 ? star.radiusRel : 1;   // 单位：R☉
    var lum = isFinite(star.lumRel) ? star.lumRel : 1;
    /* 遗骸要用「末质量」而不是「前身质量」：中子星是 1.4 M☉ 不是前身的 10 M☉，
       黑洞质量取 0.35 M_i（回落，Heger 2003）。用错这一个数，史瓦西半径会差三倍。 */
    var mInit = isFinite(star.massInit) ? star.massInit : (isFinite(star.massRel) ? star.massRel : 1);
    var M = remnant && isFinite(star.massRemnant) && star.massRemnant > 0 ? star.massRemnant : mInit;
    var radiusM = rSun * R_SUN_M, kind = stage, note = '', why = '';
    if (stage === 'bh') {
      radiusM = 2953 * M;                                        // 史瓦西半径 r_s = 2GM/c² = 2.953 km·(M/M☉)
      why = TR('黑洞没有可以站立的表面：视界只是一个"进去就出不来"的单向边界。恒星质量黑洞的视界附近潮汐力足以把任何物体沿径向拉断（意大利面化），落进去的信息也再传不出来。');
      note = TR('视界半径 r_s = 2GM/c² = ') + fmt(radiusM / 1000, 1) + TR(' km（Schwarzschild 1916）· 阴影角半径 ≈ √27/2 · r_s/D');
    } else if (stage === 'ns') {
      radiusM = 12000;                                           // 中子星：1.4 M☉ / 12 km
      why = TR('中子星表面重力约 10¹¹ 个地球重力，磁场可达 10⁸–10¹⁵ 高斯，表面温度 10⁵–10⁶ K。任何物质靠近都会被压成中子简并态的一层薄壳。');
      note = TR('典型 1.4 M☉ / 半径 12 km，核心密度超过原子核（Lattimer & Prakash 2004）') + (star.pulsar ? TR(' · 磁轴与自转轴不重合 → 脉冲星（Hewish et al. 1968）') : '');
    } else if (stage === 'wd') {
      why = TR('白矮星是电子简并物质，表面温度上万到十万 K，表面重力约 10⁵ g。没有能量来源，只能靠余热慢慢冷却。');
      note = TR('半径 R ∝ M^{−1/3}（Chandrasekhar 1931），约地球大小；末质量取 Kalirai et al. 2008');
    } else {
      why = TR('恒星没有固体表面。所谓"表面"是光球层——等离子体变得不透明的那一层，厚度只有几百公里，温度数千到数万 K。');
      note = TR('光球温度与半径取 Pecaut & Mamajek 2013 的主序序列 + Heger 2003 的演化分界');
    }
    // 安全距离：把辐照压到地球日照的 ~2 倍（黑洞/中子星按视界/半径的倍数给）
    var safeAU = remnant && (stage === 'bh' || stage === 'ns') ? radiusM * 2000 / AU_M : Math.sqrt(Math.max(lum, 1e-9) / 2);
    var b = {
      id: 'star', name: star.name || '恒星', bodyKind: 'star', isStar: true, landable: false, parent: null, system: system,
      star: star, stage: stage, stageName: star.stageName || '主序', remnant: remnant, spt: star.spt || star.type,
      radiusM: radiusM, radiusRel: radiusM / EARTH_R_M, radiusSun: +rSun.toPrecision(3), massRel: M, massInit: +mInit.toPrecision(4), massRemnant: remnant ? M : null, lumRel: lum, tempK: star.tempK || 0,
      pulsar: !!star.pulsar, variable: star.variable || null, ageGyr: star.ageGyr, seed: hash32(((system && system.seed) || 1) ^ 0x57A2),
      safeDistAU: +safeAU.toPrecision(3), noLandReason: why, sizeNote: note, color: star.color || '#fff4e8',
      timeline: { formGyr: 0, oceanGyr: Infinity, greenGyr: Infinity, civGyr: Infinity }, nowYr: system ? system.nowYr : NOW_YR,
      ref: TR('Kroupa 2001 IMF · Pecaut & Mamajek 2013 光谱序列 · Heger et al. 2003 演化分界 · Kalirai et al. 2008 白矮星末质量（外观为示意）')
    };
    b.desc = STAR_DESC(b);
    return b;
  }
  function STAR_DESC(b) {
    var s = b.stage, T = Math.round(b.tempK || 0);
    if (s === 'bh') return TR('一个恒星质量黑洞：') + fmt(b.massRel, 1) + TR(' M☉ 的质量塌进半径 ') + fmt(b.radiusM / 1000, 1) + TR(' km 的视界之内。它本身不发光，看得见的是被吸进去之前摩擦生热的吸积盘，以及背景星光被引力弯折出来的那一圈亮环。');
    if (s === 'ns') return TR('一颗中子星：') + fmt(b.massRel, 2) + TR(' M☉ 压在半径 12 km 的球里，一茶匙的物质就有上亿吨。') + (b.pulsar ? TR('它的磁轴与自转轴不重合，两极的辐射束像灯塔一样扫过来——这就是脉冲星。') : TR('表面温度仍有几十万 K，主要辐射在 X 射线波段。'));
    if (s === 'wd') return TR('一颗白矮星：一颗中低质量恒星烧完核燃料后剩下的碳氧核心，只有地球大小，却有 ') + fmt(b.massRel, 2) + TR(' M☉。它没有能量来源，') + T + TR(' K 的余热要花上百亿年才散得掉。');
    if (s === 'rgb') return TR('一颗红巨星：核心的氢已经烧完，外壳膨胀到原来的几十倍，表面因此冷到 ') + T + TR(' K 而发红。它的对流层极厚，整个星面只剩几个巨大的对流胞在翻涌。');
    if (s === 'agb') return TR('一颗渐近巨星支上的恒星：核心是简并的碳氧，外面两层壳交替燃烧氢与氦。它正在剧烈脉动并把外层一层层吹进星际空间，几万年后只会剩下一颗白矮星和一圈行星状星云。');
    if (s === 'pn') return TR('一团行星状星云中心的裸露核心：外壳已经被吹散成一圈发光的气体，中心那颗炽热的星正在变成白矮星。');
    if (s === 'snr') return TR('一片超新星遗迹：这颗大质量恒星已经炸掉，抛出的物质仍在以每秒数千公里向外冲击星际介质。');
    if (s === 'pms') return TR('一颗前主序星：它还在靠引力收缩发光，核心的氢聚变尚未稳定点燃。周围往往还留着尚未散尽的原行星盘。');
    return TR('一颗') + (b.spt || TR('主序')) + TR('型主序星：核心正在把氢聚成氦，光球温度约 ') + T + TR(' K。你看到的"表面"是光球层——等离子体在这里变得不透明，厚度只有几百公里，上面翻涌的颗粒是直径上千公里的对流米粒。');
  }

  /* 流浪行星（system.rogues 里已经是行星式对象，这里只补上导航需要的字段） */
  function rogueBodiesOf(system) {
    if (!system || !system.rogues || !system.rogues.length) return [];
    return system.rogues.map(function (rp, i) {
      // rogueWorld() 生成时已经带 bodyKind/isRogue/starlit；这里补的是「挂到某个恒星系上」才有的字段
      rp.bodyKind = 'rogue'; rp.isRogue = true; rp.starlit = true; rp.landable = true;
      rp.listIndex = i; rp.parent = null; rp.system = system;
      if (!rp.shape && rp.radiusRel < 0.25) rp.shape = shapeOf(rp.seed, 0.85);   // 小到压不圆的流浪天体也给个不规则剪影
      return rp;
    });
  }

  function planetEngine() {
    if (PLANET_ENGINE !== undefined) return PLANET_ENGINE;
    PLANET_ENGINE = (root && root.MirrorPlanetEngine) || null;
    if (!PLANET_ENGINE && typeof module === 'object' && typeof require === 'function') { try { PLANET_ENGINE = require('../engine/planet.js'); } catch (e) { PLANET_ENGINE = null; } }
    return PLANET_ENGINE;
  }
  function attachParams(sys, universeParams) {
    var PE = planetEngine(); if (!PE || typeof PE.attach !== 'function') return sys;
    // engine/planet.js 的 attach() 取 system.star 当宿主。多星系统里行星的宿主可能是伴星，
    // 主星演化成遗骸时两者更是天差地别（主星 0 L☉，伴星还在主序）。这里按行星逐个换上它自己的宿主，
    // 面板里的辐照/平衡温度才和 planets.js 判定类型时用的是同一颗星。
    for (var i = 0; i < sys.planets.length; i++) {
      var p = sys.planets[i], host = p.star && isFinite(p.star.lumRel) ? p.star : sys.star;
      // noLife 要一路传到 attach：evaluate() 会用自己的判据覆盖生成器给的 life，不传就白挡了
      var proxy = { star: host, dim: sys.dim, universeHabitability: sys.universeHabitability, nowYr: sys.nowYr, noLife: !!sys.noLife };
      try { PE.attach(p, proxy, universeParams); } catch (e) { /* ignore */ }
    }
    if (!sys.isSolar && sys.dim === 3 && typeof PE.pickHabitable === 'function') { try { sys.habitableIndex = PE.pickHabitable(sys.planets, sys.habitableIndex); } catch (e2) { /* ignore */ } }
    return sys;
  }

  function generateSystem(seed, universeParams, opts) {
    opts = opts || {};
    seed = seed >>> 0;
    if (opts.solar || (isOurs(universeParams) && seed === SOLAR_SEED)) return solarSystem(universeParams, opts);
    if (opts.alphaCen || (isOurs(universeParams) && seed === ALPHA_CEN_SEED)) return alphaCentauri(universeParams);
    var rnd = mulberry32(seed ^ 0x51E5EED), hab = habitabilityOf(universeParams);
    var noLife = !!opts.noLife;      // 这个宇宙没有分子化学：一颗行星都不许带生命（见下面 life 的判定）
    var nowYr = universeParams && universeParams.enterTimeGyr ? universeParams.enterTimeGyr * 1e9 : (isOurs(universeParams) ? NOW_YR : 1.3e10);
    // 恒星：Kroupa 2001 IMF 抽质量（上下限用引擎 M_min/M_max），Pecaut & Mamajek 2013 给光谱型，再按年龄演化到当前阶段
    var win = starMassWindow(universeParams, opts), tSolarGyr = starLifeSolar(universeParams);
    var mass = imfSample(rnd(), win.mMin, win.mMax);
    var lifeGyr = msLifeGyr(mass, tSolarGyr);
    // 年龄：在可用的宇宙时间里近似均匀（银盘的恒星形成率长期大致平稳；Madau & Dickinson 2014 的宇宙 SFH 在 z<1 才缓慢下降）。
    // 这一步把 IMF 的"出生质量分布"变成"现在还看得见什么"：大质量星寿命短，多半已经是遗骸
    var maxAge = clamp(nowYr / 1e9 - 0.2, 0.05, 13.6);
    var age = clamp(maxAge * rnd(), 0.002, maxAge);
    var ev = evolveStar(mass, age, tSolarGyr, mulberry32(seed ^ 0x5747));
    var sc = { cls: ev.cls || spectralOf(mass).cls, T: ev.tempK, col: ev.color }, lum = ev.lumRel;
    var tempK = ev.tempK;
    var id = ((seed >>> 0) % 900000 + 100000);
    var name = opts.name || ('恒星 ' + id.toString(36).toUpperCase());
    var star = { type: sc.cls, cls: sc.cls, spt: ev.spt, color: sc.col, massRel: +mass.toFixed(3), tempK: tempK, ageGyr: +age.toFixed(2), lumRel: +lum.toExponential(3) * 1, radiusRel: +ev.radiusRel.toFixed(4), formedYr: nowYr - age * 1e9, name: name,
      stage: ev.stage, stageName: ev.stageName, remnant: !!ev.remnant, substellar: !!ev.substellar, massInit: +mass.toFixed(3), massRemnant: ev.massRemnant != null ? ev.massRemnant : null, msLifeGyr: +lifeGyr.toPrecision(3) * 1, pulsar: !!ev.pulsar, stageNote: ev.note || null,
      imf: 'Kroupa 2001（' + fmt(win.mMin, 3) + '–' + fmt(win.mMax, 1) + ' M☉，' + (win.from === 'engine' ? '引擎 M_min/M_max' : win.from === 'opts' ? '调用方指定' : '缺省窗口') + '）', seq: 'Pecaut & Mamajek 2013' };
    // 多星：多重性（Raghavan 2010，按质量微调）→ 分层结构（MA01 稳定）；行星按 HW99 判据放在 S 型 / P 型稳定区
    var multN = opts.multiplicity != null ? opts.multiplicity : drawMultiplicity(mass, mulberry32(seed ^ 0x2B1)), hier = buildHierarchy(multN, mass, mulberry32(seed ^ 0x2B2), name);
    var evRnd = mulberry32(seed ^ 0x11FE);
    hier.stars.forEach(function (st, si) { st.ageGyr = star.ageGyr; st.formedYr = star.formedYr;
      if (si === 0) { st.type = star.type; st.cls = star.cls; st.spt = star.spt; st.color = star.color; st.tempK = star.tempK; st.lumRel = star.lumRel; st.radiusRel = star.radiusRel; st.stage = star.stage; st.stageName = star.stageName; st.remnant = star.remnant; st.substellar = star.substellar; st.stageNote = star.stageNote; return; }
      var e2 = evolveStar(st.massRel, age, tSolarGyr, evRnd);   // 伴星同龄同演化（共同形成）
      st.type = e2.cls || st.type; st.cls = st.type; st.spt = e2.spt; st.color = e2.color; st.tempK = e2.tempK; st.lumRel = +e2.lumRel.toExponential(3) * 1; st.radiusRel = +e2.radiusRel.toFixed(4);
      st.stage = e2.stage; st.stageName = e2.stageName; st.remnant = !!e2.remnant; st.substellar = !!e2.substellar; st.stageNote = e2.note || null; st.massRemnant = e2.massRemnant != null ? e2.massRemnant : null; st.idx = e2.idx; });
    /* 演化之后必须把层级节点上的光度刷新一遍：buildHierarchy 记下的是零龄主序值，
       主星一旦演化成遗骸（白矮星/中子星/黑洞），光度会掉到 ~0。以前行星的平衡温度与类型
       仍按主序光度算，于是出现「黑洞旁边的熔岩世界」——面板给 0 W/m²、0 K，类型却写着熔岩世界。
       现在类型/温度和面板用同一份「当前光度」。 */
    (function refreshLum(node) {
      if (node.kind === 'star') { node.lum = isFinite(hier.stars[node.i].lumRel) ? hier.stars[node.i].lumRel : 0; return node.lum; }
      node.lum = refreshLum(node.members[0]) + refreshLum(node.members[1]); return node.lum;
    })(hier.root);
    star.multiplicity = multN; if (multN > 1) { star.companions = hier.stars.slice(1).map(function (st) { return st.name; }); }
    // 变星标签（GCVS）：食双星要先看掩食概率 ≈ (R₁+R₂)/a
    var vrRnd = mulberry32(seed ^ 0x7A21);
    hier.stars.forEach(function (st, si) {
      var bin = null;
      if (multN > 1 && si < 2 && hier.root) { var node = hier.root.kind === 'bin' ? (hier.root.members[0].kind === 'bin' ? hier.root.members[0] : hier.root) : null;
        if (node && node.a > 0) { var Rsum = ((hier.stars[0].radiusRel || 1) + (hier.stars[1] ? hier.stars[1].radiusRel || 1 : 1)) * 0.00465, pe = clamp(Rsum / node.a, 0, 1);
          bin = { periodD: node.P * 365.25, eclipse: vrRnd() < pe }; } }
      st.variable = variableOf(st, age, vrRnd, bin);
    });
    star.variable = hier.stars[0].variable;
    star.multiplicityNote = MULT_NOTE;
    var hostChain = []; (function chain(n, path) { var pth = path.concat([n]); if (n.kind === 'star') { if (n.i === 0) hostChain = pth.slice().reverse(); return; } n.members.forEach(function (m) { chain(m, pth); }); })(hier.root, []);
    function stableHost(aP) { // 从主星向外找第一个能稳定容纳半长轴 aP 的宿主（S 型：≤ critS；P 型：≥ critP 且对更外层 ≤ critS）
      for (var hi = 0; hi < hostChain.length; hi++) { var host = hostChain[hi], ok = true;
        if (host.kind === 'bin') { var muP = Math.min(host.members[0].mass, host.members[1].mass) / host.mass; if (aP < critP(host.a, host.e, muP)) ok = false; }
        for (var hj = hi + 1; hj < hostChain.length && ok; hj++) { var anc = hostChain[hj], sub = hostChain[hj - 1], other = anc.members[0] === sub ? anc.members[1] : anc.members[0]; if (aP > critS(anc.a, anc.e, other.mass / anc.mass)) ok = false; }
        if (ok) return host; }
      return null; }
    // 行星：由内向外，轨道间距按对数均匀。内边界本身要有很大弥散——太阳系里 P<85 d 的行星是零颗（水星 88 d），
    // 这正是 Kepler 出现率（Fressin 2013 合计 1.09 颗/星）里"很多恒星没有近距行星"的来源
    var lumRef = Math.max(Math.sqrt(Math.max(lum, 1e-6)), 0.12);
    /* 内边界不再是 0.0667·lumRef 这样一个"随光度等比缩放的常数"（它会让 T ∝ L^¼/√a 里的光度精确抵消，
       把平衡温度顶死在约 835 K），而是有物理依据的两条线取大者：
         · 尘埃升华半径 a_sub = (278.5/1500)²√L ≈ 0.0345√L AU（T_sub ≈ 1500 K，Isella & Natta 2005 / Millan-Gabet 2007）
         · 洛希极限 2.44 R★(ρ★/ρ_p)^{1/3}（Roche 1849）—— 暗弱/致密宿主那里升华半径缩到星面以内，下限由潮汐撕碎给
       a_sub 同样 ∝ √L，所以它只是把"原地形成的下限"放对；把行星送进 a_sub 以内的是后面的迁移。 */
    var mNow = star.massRemnant != null ? star.massRemnant : mass;   // 遗骸一律用末质量（白矮星 Kalirai 2008、中子星 1.4、黑洞 0.35 M_i）
    var aSub = sublimationAU(lum), aRoche = rocheAU(mNow, star.radiusRel, 5500), aMin = Math.max(aSub, aRoche);
    var count = 1 + Math.floor(rnd() * 8), planets = [], a = (0.05 + rnd() * 0.2) * lumRef * Math.exp(1.5 * gaussRnd(rnd)), snowLine = 2.7 * lumRef;
    /* 越过内边界的低尾**对数镜像**折回来，而不是一律钳在边界上：盘内缘不是一堵墙，
       否则约三成的恒星系会把最内侧行星精确堆在同一个位置（旧口径就是这样，还顺带虚增了 P<85 d 的出现率）。 */
    if (a < aMin) a = aMin * aMin / Math.max(a, aMin * 1e-3);
    a = clamp(a, aMin, Math.max(3.2 * lumRef, aMin));
    var formGyr = 0.05 + rnd() * 0.15;
    for (var i = 0; i < count; i++) {
      a *= 1.4 + rnd() * 1.1;
      if (a > 60) break;
      var pseed = hash32(seed ^ Math.imul(i + 1, 0x9E3779B9));
      var host = stableHost(a); if (!host) continue; // 落在不稳定区：不放行星（HW99）
      var hostLum = host.lum, hostMass = host.mass; // P 型：两颗恒星光度之和（简化，scaling）
      if (!isFinite(hostLum) || hostLum < 0) hostLum = 0;   // 光度非有限就当没有：绝不能让 NaN 顺着温度传到类型判定里
      var pr = mulberry32(pseed), T = tempAt(hostLum, a), type, radiusRel, gravityRel, pressure, atmColor, life = null, moons = [], subtype = null;
      if (!isFinite(T)) T = 0;
      // 半径按 Kepler 出现率抽（Fressin 2013 五档 + 亚地球外推），再按雪线调整：雪线内很少有巨行星（热木星只占 ~1%），雪线外核吸积容易长成巨行星
      var kc = keplerClass(pr());
      // 雪线内不易长成巨行星；**热木星区（P < 10 天，文献对热木星的定义）里一颗也不原地形成** ——
      // 就地形成热木星要求盘面密度高到不合理（Rafikov 2006, ApJ 648, 666），
      // 这一档一律由后面的 migrateInnerGiant() 从雪线外迁移进来（Dawson & Johnson 2018）。
      // 判据用周期而不是固定的 0.1 AU：0.1 AU 在太阳旁边是 11 天，在 0.2 M☉ 的 M 矮星旁边却是 26 天（那里根本不热）
      var aHot = 0.089362 * Math.pow(Math.max(hostMass, 0.02), 1 / 3);        // P = 10 d 对应的半长轴
      if (kc.key === 'giant' && a < snowLine) kc = pr() < (a < aHot ? 1.0 : 0.05) ? KEPLER_CLASSES[3] : kc;
      else if (a > snowLine && (kc.key === 'subearth' || kc.key === 'earth' || kc.key === 'superEarth') && pr() < 0.34) kc = pr() < 0.55 ? KEPLER_CLASSES[5] : KEPLER_CLASSES[4];
      radiusRel = planetRadiusRel(kc, pr());
      /* 「长什么样」和「有多少卫星」是两回事，以前共用一个 radiusRel ≥ 2.0 的门槛，两头都不对：
         - 外观仍按 2.0 R⊕ 分：迷你海王星确实有氢氦包层，画成小号气态世界没错
           （试过抬到 4.0，结果它们掉进"冰质岩石"那一支，那比原来更不像）。
         - 卫星：规则卫星系统的规模跟**质量**走（Canup & Ward 2006 的共同质量标度），
           不跟外观走。天王星 14.5 M⊕ 有 28 颗、海王星 17 M⊕ 有 16 颗——把它们按外观丢回
           "0–2 颗"那一支就荒唐了。所以卫星另用一个质量门槛，取海王星量级 10 M⊕。 */
      var massE = planetMassEarth(radiusRel);
      var massive = radiusRel >= 2.0;        // 外观：2 R⊕ 起就有氢氦包层，画成气态世界是对的
      var moonRich = massE >= 10;            // 卫星：海王星质量（17 M⊕）量级以上才按幂律给一整套
      gravityRel = +clamp(massE / (radiusRel * radiusRel), 0.02, 60).toFixed(2);
      var pclass = kc.key, pclassCn = kc.cn, hotJupiter = false, tidalLocked = a < tidalLockAU(hostMass, age);
      if (massive) {
        type = 'gas'; pressure = 1000; atmColor = null;
        subtype = kc.key === 'miniNeptune' ? 'miniNeptune' : (radiusRel < 7 && a > snowLine ? 'iceGiant' : 'gasGiant');
        // （0.1 AU 以内的巨行星已在上面被全部否掉；热木星只能是迁移来的，见 migrateInnerGiant）
      } else {
        pressure = pr() < 0.25 ? 0 : Math.exp(lerp(Math.log(0.005), Math.log(60), pr())) * clamp(radiusRel, 0.3, 1.5);
        if (T > 1000) { type = 'lava'; pclassCn = '熔岩世界'; }
        else if (T > 720) { type = 'lava'; }
        else if (T > 330) { type = pressure > 0.02 && pr() < 0.6 ? 'desert' : 'rock'; }
        else if (T > 230) {
          if (pressure < 0.02) type = 'rock';
          else { var w = pr(); type = w < 0.35 ? 'ocean' : w < 0.7 ? 'living' : 'desert'; }
        } else if (T > 150) { type = pressure > 0.1 && pr() < 0.4 ? 'ocean' : 'ice'; if (type === 'ocean' && T < 200) type = 'ice'; }
        else type = pr() < 0.7 ? 'ice' : 'rock';
        if (type === 'ice' && T < 240 && pressure > 0.02) pclassCn = '雪球行星';
        // 生命：温和且有大气与水的世界
        /* 这个宇宙没有分子化学时，一颗行星都不许有生命：以前面板会同时写着
           "无分子化学：这颗行星上不会有生命" 和 "是一颗有生命的世界"，还列出显生宙时间线。
           化学这一关不过，生命就不该被生成出来，而不是生成之后再在文案里否认。 */
        if ((type === 'ocean' || type === 'living') && pressure > 0.05 && !noLife) {
          var chance = hab * (1.1 - Math.abs(T - 285) / 110);
          if (pr() < chance) {
            var lv = age < 1.2 ? 0 : age < 2.5 ? (pr() < 0.6 ? 0 : 1) : age < 3.8 ? Math.floor(pr() * 3) : Math.floor(pr() * 3.6);
            lv = clamp(lv, 0, 3);
            if (type === 'living' && lv < 1) lv = 1;
            life = { level: LIFE_LEVELS[lv], rank: lv };
          } else if (type === 'living') type = 'ocean';
        }
        if (type === 'living' && !life) type = 'ocean';
      }
      /* 卫星数按**行星质量**标度，不按"是不是巨行星"的二分档。
         原来 massive（半径 ≥ 2 R⊕，也就是迷你海王星起）一律给 3–42 颗，于是一颗 3 R⊕、
         约 5 M⊕ 的迷你海王星能挂 40 颗卫星，比 318 M⊕ 的木星（95 颗）还离谱。
         太阳系锚点（已知卫星数）：地球 1 M⊕→1 · 天王星 14.5 M⊕→28 · 海王星 17 M⊕→16 ·
         土星 95 M⊕→274 · 木星 318 M⊕→95。N ≈ 2.2·(M/M⊕)^0.62 只是粗略趋势线（标度关系，
         不是对锚点的好拟合）：中心值 2.2·M^0.62 对锚点的比值约 地球 2.2/1、天王星 11.5/28、
         海王星 12.7/16、土星 37/274、木星 78/95——海王星与木星量级还说得通，地球偏高约 2 倍、
         天王星偏低约 2.4 倍；土星已知数近年因深度巡天暴增（不规则外卫星为主），比趋势线高约 7 倍，
         不宜拿 274 去卡系数。幂律预测中心：5 M⊕→约 6 · 15 M⊕→约 12 · 95 M⊕→约 37 · 318 M⊕→约 78。
         盘的固体质量比 ~10⁻⁴ M_p 取 Canup & Ward 2006 的共同质量标度（规则卫星系统）。
         这一行本身只消耗一个 pr()。 */
      var mcount = moonRich ? clamp(Math.round(2.2 * Math.pow(Math.max(massE, 1), 0.62) * (0.6 + 0.8 * pr())), 0, 90)
        : (pr() < 0.45 ? Math.floor(pr() * 3) : 0);
      /* 下面这几个量必须在"卫星细节循环"之前抽完，不能像以前那样留在循环后面顺手抽：循环次数是
         Math.min(mcount, 4)，mcount 现在连续依质量标度，不再像旧式那样恒 ≥3——同一个 seed 换一次
         mcount 的值，循环跑 1 圈还是 4 圈就会变，圈数一变，循环里消耗的 pr() 次数跟着变，环 / 公转
         时间线 / 偏心率 / 初始相位这些本该只由"这颗行星是什么"决定的量，就被卫星细节循环挤到了
         pr() 流的不同位置——同一个 seed 会因为月亮数量的差异连带算出不一样的公转轨道（实测：
         seed 3 的行星 #3、seed 66 的行星 #3 等，ecc/phase/环 都会漂移）。钉在这里，就不再受循环
         圈数影响，卫星数改动就真的只影响卫星数，不影响其他任何字段。 */
      var ringRoll = (type === 'gas' && radiusRel > 4) ? pr() : 1;
      var ringInnerRoll = ringRoll < 0.35 ? pr() : 0, ringOuterRoll = ringRoll < 0.35 ? pr() : 0;
      var oceanGyrRoll = pr();
      var greenGyrRoll = life && life.rank >= 1 ? pr() : null;
      var civGyrRoll = life && life.rank >= 3 ? pr() : null;
      var eccVal = +(pr() * 0.12).toFixed(3), phaseVal = pr() * TAU;
      var tiltVal = +(pr() * 30).toFixed(1), rotationHVal = massive ? 8 + pr() * 10 : 12 + pr() * 40;
      /* 卫星细节走**独立**随机流，不占共享的 pr()：循环次数是 min(mcount, 4)，而 mcount 现在按
         质量标度、可以低于 3，迭代次数一变就会把同一颗行星后面的 ecc / phase / 环 / 时间线
         整体带偏（实测 2.3% 的巨行星中招）。分流之后，卫星数怎么变都不影响别的字段。 */
      /* 卫星轨道必须落在物理允许的带内，周期必须由开普勒**算出来**，不能独立抽。
         旧写法 orbitKm 只按行星半径缩放、periodDays = 2 + m*4 + 随机*10 天，两者毫无关系——
         实测 41981 颗卫星里 98.6% 违反绕行星的开普勒第三定律、61% 的轨道落在希尔半径之外
         （那个距离上根本不可能被行星束缚住，早被恒星拽走了）。
         现在：
           内边界 = 2.2 R_p（洛希极限之外，流体卫星 ~2.4 R_p，取略小以容纳刚体小卫星）
           外边界 = min(0.4 R_Hill, 100 R_p) —— 太阳系里月球在 0.26 R_Hill、木卫四在 0.035 R_Hill、
                    木星最外的不规则卫星约 0.45 R_Hill，0.4 是站得住的上限
           周期   = 2π√(a³/GM_p)（校核：地月 3.844×10⁵ km / 1 M⊕ → 27.4 天，实测 27.3；
                    木卫一 4.217×10⁵ km / 318 M⊕ → 1.77 天，实测 1.77）*/
      var mrnd = mulberry32(hash32((pseed >>> 0) ^ 0x4D4F4F4E));
      var RE_KM = 6371, ME_KG = 5.972e24, MSUN_KG = 1.989e30, AU_KM = 1.496e8, G_SI = 6.674e-11;
      var RpKm = Math.max(radiusRel * RE_KM, 1);
      var mpKg = Math.max(massE, 1e-3) * ME_KG;
      var hillKm = a * AU_KM * Math.pow(mpKg / (3 * Math.max(hostMass, 1e-6) * MSUN_KG), 1 / 3);
      var mInner = 2.2 * RpKm, mOuter = Math.min(0.4 * hillKm, 100 * RpKm);
      /* 希尔球比最小可能的卫星轨道还小 → 这颗行星根本留不住卫星，一颗都不给。
         原来这里写的是 max(mInner*1.15, …)，等于在希尔球外面硬塞一颗——实测最坏的一例是
         0.018 AU 处绕 15.8 M☉ 恒星的行星，希尔半径 26044 km，而它的洛希边界就有 53410 km。
         这条正是本文件别处已经引过的 Barnes & O'Brien 2002：近距行星留不住卫星。 */
      if (mOuter <= mInner) { mcount = 0; moons.length = 0; }
      var nDraw = Math.min(mcount, 4);
      for (var m = 0; m < nDraw; m++) {
        var mr = massive ? 0.1 + mrnd() * 0.35 : 0.05 + mrnd() * 0.2 * radiusRel;
        var heated = massive && a > snowLine && m < 2 && mrnd() < 0.45;
        // 由内向外对数排布，同一颗行星的几颗卫星不会挤在一起
        var fr = (m + 0.35 + 0.3 * mrnd()) / Math.max(nDraw, 1);
        var oKm = mInner * Math.pow(mOuter / mInner, fr);
        var pDays = 2 * Math.PI * Math.sqrt(Math.pow(oKm * 1000, 3) / (G_SI * mpKg)) / 86400;
        moons.push({ name: null, radiusRel: mr, orbitKm: +oKm.toPrecision(6), periodDays: +pDays.toPrecision(5),
          seed: hash32(pseed ^ (m + 11) * 0x85EBCA6B), type: heated ? 'ice' : 'rock',
          tidalHeated: heated, note: heated ? '受潮汐加热的冰卫星：冰壳下可能有液态海洋（木卫二/土卫二类比，示意）' : null });
      }
      var pname = planetName(name, i);
      moons.forEach(function (mo, k) { mo.name = pname + '-' + (k + 1); });
      var periodYr = Math.sqrt(a * a * a / hostMass);
      var vis = baseVisual(type), gasLook = null, tholin = null;
      if (ringRoll < 0.35) vis.rings = { inner: 1.3 + ringInnerRoll * 0.4, outer: 1.9 + ringOuterRoll * 0.8, seed: pseed };   // 行星环：太阳系四颗巨行星都有，这里取 35% 为示意；判定值提前到卫星循环之前抽（见上）
      /* 颜色不再是自由参数：由平衡温度决定的云顶凝结物给（Sudarsky 五类，见 gasCloudClass）。
         用一路独立的随机数（seed ^ 0x6C10D / ^ 0x7401C），不占 pr 流 —— 类型/卫星数这些已抽好的量逐位不动。
         托林雾霾按「温度窗口 × 有 CH₄/N₂ × 累积紫外剂量」三条件算，不是随机撒色。 */
      var hostStar = { lumRel: hostLum, tempK: (host.kind === 'star' ? hier.stars[host.i].tempK : star.tempK), cls: (host.kind === 'star' ? hier.stars[host.i].cls : star.cls) };
      if (type === 'gas') {
        tholin = tholinOf(T, uvDoseOf(hostStar, a, age), mulberry32(hash32(pseed ^ 0x7401C)), false);
        gasLook = applyGasLook(vis, T, subtype, pseed, tholin);
      } else if (type === 'ice') {
        // 冰质表面：冥王星/海卫一/柯伊伯带天体那一路 —— 沉积只积不散，所以比大气里的厚
        applyTholinSurface(vis, T, hostStar, a, age, pseed);
      }
      var timeline = { formGyr: formGyr, oceanGyr: formGyr + 0.3 + oceanGyrRoll * 0.4, greenGyr: greenGyrRoll != null ? clamp(age * lerp(0.4, 0.8, greenGyrRoll), 0.8, age) : Infinity, civGyr: civGyrRoll != null ? age - 0.02 - civGyrRoll * 0.05 : Infinity };
      planets.push({
        pclass: pclass, pclassCn: (hotJupiter ? '热木星' : tidalLocked && !massive ? pclassCn + '（潮汐锁定）' : pclassCn), massEarth: +massE.toFixed(2), hotJupiter: hotJupiter, tidalLocked: tidalLocked,
        occurrence: kc.occ, occurrenceRef: TR('Fressin et al. 2013 表 3（P < 85 d，每颗恒星的出现率）· 半径谷 Fulton 2017 · 质量–半径 Chen & Kipping 2017'),
        // periodYr 不能用 toFixed(3)：热木星/超短周期行星（大质量宿主 + 0.02 AU）会被四舍五入成 **0**，
        // 之后 orbitPos 的 tYr/periodYr = ∞ → 光照方向 NaN → 整幅画面全黑（面板却照常有数）。一律保 6 位有效数字。
        id: i, name: pname, type: type, subtype: subtype, radiusRel: +radiusRel.toFixed(2), orbitAU: +a.toFixed(4), periodYr: +periodYr.toPrecision(6), ecc: eccVal, phase: phaseVal,
        hostId: host.id, orbitType: multN === 1 ? 'single' : (host.kind === 'star' ? 'S' : 'P'), hostName: host.kind === 'star' ? hier.stars[host.i].name : (host === hier.root ? TR('全部恒星的质心') : TR('内双星 ') + hier.stars[host.members[0].kind === 'star' ? host.members[0].i : 0].name.replace(name + ' ', '') + '+' + (host.members[1].kind === 'star' ? hier.stars[host.members[1].i].name.replace(name + ' ', '') : '…')), hostLumRel: hostLum > 0 ? +hostLum.toPrecision(5) : 0, hostMassRel: +hostMass.toFixed(3),
        gravityRel: gravityRel, atmosphere: { pressureRel: +pressure.toFixed(3), color: atmColor || hex(vis.atm) }, tempK: Math.round(T),
        moons: moons, moonCount: mcount, life: life, seed: pseed, tilt: tiltVal, rotationH: rotationHVal,
        // planet.star = 这颗行星**真正的宿主**（多星系统里不一定是 system.star），字段补齐到
        // engine/planet.js normStar() 需要的全套（lumRel/tempK/radiusRel/massRel/ageGyr），
        // 面板里的辐照与平衡温度才和这里的类型判定同源。lumRel 保有效数字，不用 toFixed(4)——
        // 白矮星/中子星/褐矮星的光度小于 5e-5，会被四舍五入成 0。
        color: vis.color, visual: vis, timeline: timeline, starFormedYr: star.formedYr, nowYr: nowYr,
        // 巨行星的颜色依据（面板可直接展示）：云顶温度 → 凝结物 → 反照率类别 → 颜色
        gasClass: gasLook ? gasLook.cls : null, cloudDeck: gasLook ? gasLook.cn : null, cloudNote: gasLook ? gasLook.note : null, bondAlbedo: gasLook ? +gasLook.albedo.toFixed(2) : null,
        // 托林雾霾与照明色温：偏粉红的两条物理来源（第三条是超热木星的热辐射，见 visual.gasGlow）
        tholin: +(vis.tholin || 0).toFixed(3), tholinNote: vis.tholinNote || null, uvDose: +uvDoseOf(hostStar, a, age).toPrecision(3), lightNote: tintNoteOf(hostStar),
        star: (function () { var hs = host.kind === 'star' ? hier.stars[host.i] : null;
          return { name: hs ? hs.name : star.name, color: (hs ? hs.color : star.color), lumRel: hostLum > 0 ? +hostLum.toPrecision(5) : 0,
            tempK: (hs ? hs.tempK : star.tempK), massRel: +hostMass.toFixed(3), radiusRel: (hs && isFinite(hs.radiusRel) ? hs.radiusRel : star.radiusRel),
            ageGyr: star.ageGyr, stage: (hs ? hs.stage : star.stage), stageName: (hs ? hs.stageName : star.stageName), remnant: !!(hs ? hs.remnant : star.remnant), cls: (hs ? hs.cls : star.cls) };
        })(), radiusM: radiusRel * EARTH_R_M
      });
    }
    /* ---- 热木星迁移（Dawson & Johnson 2018）：唯一能把行星送进尘埃升华半径以内的过程 ----
       独立随机流（seed ^ 0x40A17E5），不占 rnd/pr —— 没发生迁移的系统逐位不变。
       概率 ∝ 宿主质量（Johnson 2010 的巨行星出现率–恒星质量关系），整体标定到约 0.4–0.8% 的恒星。 */
    var migRnd = mulberry32(hash32(seed ^ 0x40A17E5));
    var migrated = migrateInnerGiant(planets, migRnd, snowLine, migRnd());
    if (migrated) {
      // 迁移后重新按轨道由内向外排序，并把 id / 名字 / 卫星名一起补正（行星命名本来就按轨道顺序）
      planets.sort(function (x, y) { return x.orbitAU - y.orbitAU; });
      planets.forEach(function (p, k) {
        p.id = k; p.name = planetName(name, k);
        if (p.moons) p.moons.forEach(function (mo, j) { mo.name = p.name + '-' + (j + 1); });
      });
    }
    var habitable = -1, best = 0;
    planets.forEach(function (p, k) { var s = (p.life ? 1 + p.life.rank : 0) + (p.type === 'ocean' || p.type === 'living' ? 0.5 : 0); if (s > best) { best = s; habitable = k; } });
    var sys = { id: id, seed: seed, name: name, star: star, planets: planets, habitableIndex: habitable, nowYr: nowYr, isSolar: false, ringEndGyr: formGyr + 0.05, universeHabitability: hab, noLife: noLife, stars: hier.stars, hierarchy: { root: hier.root, N: multN, note: hier.note }, multiplicity: multN, multiplicityNote: TR(MULT_NOTE) };
    sys.innerEdgeAU = +aMin.toPrecision(4); sys.sublimationAU = +aSub.toPrecision(4); sys.snowLineAU = +snowLine.toPrecision(4);
    sys.innerEdgeNote = TR('轨道内边界 = max(尘埃升华半径 ') + aSub.toPrecision(3) + TR(' AU（T_sub ≈ 1500 K，Isella & Natta 2005 / Millan-Gabet 2007），洛希极限 ') + aRoche.toPrecision(3) + TR(' AU（Roche 1849））；雪线 ') + snowLine.toPrecision(3) + ' AU';
    sys.hotJupiter = migrated || null; sys.hotJupiterNote = migrated ? TR(HJ_NOTE) : null;
    // 恒星系形态：原行星盘（年轻）/ 碎屑盘；小行星带、柯伊伯带与彗星（示意）
    var srnd = mulberry32(seed ^ 0x0D15C);
    sys.disk = diskOf(age, star.cls, srnd);
    sys.belts = []; sys.comets = null;
    if (planets.length && !ev.remnant) {
      // 迁移进来的热木星不算"清出小行星带的那颗巨行星"（它已经不在原来的位置上了），最外圈也要按 max 取（防止只剩一颗热木星时把柯伊伯带放进 0.1 AU）
      var giantIdx = -1; for (var gi = 0; gi < planets.length; gi++) if (planets[gi].radiusRel >= 4 && !planets[gi].migrated) { giantIdx = gi; break; }
      var aOut = 0; for (var ao = 0; ao < planets.length; ao++) if (planets[ao].orbitAU > aOut) aOut = planets[ao].orbitAU;
      if (giantIdx > 0) sys.belts.push({ kind: 'asteroid', cn: TR('小行星带'), innerAU: +(planets[giantIdx - 1].orbitAU * 1.25).toFixed(2), outerAU: +(planets[giantIdx].orbitAU * 0.72).toFixed(2), note: TR('巨行星摄动清空的空隙里剩下的星子（示意；类比主带 2.1–3.3 AU）') });
      sys.belts.push({ kind: 'kuiper', cn: TR('柯伊伯带 / 外围星子盘'), innerAU: +(aOut * 1.15).toFixed(1), outerAU: +(aOut * 2.6).toFixed(1), note: TR('雪线外没能并入行星的冰质星子（示意；类比 30–50 AU 的柯伊伯带）') });
      sys.comets = { longPeriodPerCentury: Math.round(1 + srnd() * 12), oortAU: Math.round(2e4 + srnd() * 8e4), note: TR('奥尔特云与短周期彗星（示意；数量级取太阳系）') };
    }
    // 流浪行星（Sumi 2011）：不属于这个恒星系，只是"此刻在附近"
    var nRogue = srnd() < 0.55 ? 1 + Math.floor(srnd() * 2) : 0;
    sys.rogues = []; for (var rg = 0; rg < nRogue; rg++) { var rp = rogueWorld(hash32(seed ^ (rg + 3) * 0x9E3779B9), universeParams); rp.nearSystem = name; rp.distanceLy = +fmt(0.2 + srnd() * 3.5, 2); sys.rogues.push(rp); }
    sys.rogueNote = TR('Sumi et al. 2011：每颗主序星约 1.8 颗木星质量的自由漂浮行星（Mróz et al. 2017 修正为 <0.25 颗/星）。示意：这里只列"此刻在几光年内"的几颗');
    var D = dimOf(universeParams, opts); sys.dim = D; sys.dimMode = supportsDim(D).mode || '3d';
    if (D === 2) { // 2 维：同一 seed 的行星表，周期改为对数势（∝ a），描述改 2 维措辞
      var v0 = planets.length ? TAU * planets[0].orbitAU / planets[0].periodYr : TAU; sys.v0 = v0; sys.note = TR('示意（2 维几何）· 引力 2+1 维为推测');
      planets.forEach(function (p) { p.dim = 2; p.periodYr = +(TAU * p.orbitAU / v0).toFixed(4); });
    } else if (sys.dimMode === 'orbitDemo') { // D≠3：只到恒星系层，4–6 颗试探行星
      if (planets.length > 6) planets.length = 6; while (planets.length < 4) { var k2 = planets.length, pr2 = mulberry32(hash32(seed ^ (k2 + 77) * 0x9E3779B9)); planets.push({ id: k2, name: planetName(name, k2), type: 'rock', subtype: null, radiusRel: +(0.5 + pr2()).toFixed(2), orbitAU: +(0.3 * (k2 + 1)).toFixed(3), periodYr: +Math.pow(0.3 * (k2 + 1), 1.5).toFixed(3), ecc: 0, phase: pr2() * TAU, gravityRel: 1, atmosphere: { pressureRel: 0, color: '#888888' }, tempK: 300, moons: [], moonCount: 0, life: null, seed: hash32(seed ^ k2), tilt: 0, rotationH: 24, color: '#9a9a9a', visual: baseVisual('rock'), timeline: { formGyr: 0.1, oceanGyr: 0.5, greenGyr: Infinity, civGyr: Infinity }, starFormedYr: star.formedYr, nowYr: nowYr, star: { color: star.color, lumRel: star.lumRel, tempK: star.tempK }, radiusM: EARTH_R_M }); }
      planets.forEach(function (p) { p.dim = D; p.test = true; p.life = null; }); sys.habitableIndex = -1; sys.note = supportsDim(D).note;
    }
    attachParams(sys, universeParams);
    /* 颜色相关的字段一律以 planet.visual 为准再同步一次。热木星迁移（migrateInnerGiant）会在行星
       建好之后改轨道与温度、并重判云顶分类，此时 visual 已经更新、但 planet 上的副本还是旧的 ——
       以前就出现过「1164 K 的行星还挂着 τ=0.54 的托林」这种自相矛盾的记录。 */
    planets.forEach(function (p) {
      var v = p.visual; if (!v) return;
      p.tholin = +(v.tholin || 0).toFixed(3); p.tholinNote = v.tholinNote || null;
      p.color = v.color || p.color;
      if (p.star) { p.lightNote = tintNoteOf(p.star); p.uvDose = +uvDoseOf(p.star, p.orbitAU, ageGyrOf(p, nowYr)).toPrecision(3); }
    });
    planets.forEach(function (p) { p.system = sys; p.desc = describe(p, nowYr); });
    return sys;
  }

  /* ---------------------------------------------------------- 真实太阳系（硬编码） */
  function solarSystem(universeParams, opts) {
    var nowYr = universeParams && universeParams.enterTimeGyr ? universeParams.enterTimeGyr * 1e9 : NOW_YR;
    var formed = nowYr - SUN_AGE_GYR * 1e9;
    var star = { type: 'G', cls: 'G2V', color: '#fff4e8', massRel: 1, tempK: 5772, ageGyr: SUN_AGE_GYR, lumRel: 1, radiusRel: 1, formedYr: formed, name: '太阳' };
    function mk(o) {
      var vis = baseVisual(o.type); if (o.vis) for (var k in o.vis) vis[k] = o.vis[k];
      var p = { id: o.id, name: o.name, type: o.type, subtype: o.subtype || null, radiusRel: o.r, orbitAU: o.a, periodYr: o.p, ecc: o.e, phase: o.ph, gravityRel: o.g, atmosphere: { pressureRel: o.pa, color: o.pc }, tempK: o.T,
        moons: o.moons || [], moonCount: o.mc != null ? o.mc : (o.moons ? o.moons.length : 0), life: o.life || null, seed: o.seed, tilt: o.tilt, rotationH: o.rot, color: vis.color, visual: vis, visualKey: o.key,
        timeline: o.timeline || { formGyr: 0.2, oceanGyr: 0.6, greenGyr: Infinity, civGyr: Infinity }, starFormedYr: formed, nowYr: nowYr, star: { color: star.color, lumRel: 1, tempK: 5772 }, radiusM: o.r * EARTH_R_M, real: true };
      return p;
    }
    var moon = { name: '月球', radiusRel: 0.2727, orbitKm: 384400, periodDays: 27.32, seed: 0x4D4F4F4E, type: 'rock', key: 'moon', visualKey: 'moon', real: true, radiusM: 1737400, tilt: 6.7, visual: (function () { var v = baseVisual('rock'); v.craters = 1.4; v.color = '#9a9691'; v.atmDensity = 0; return v; })(), gravityRel: 0.166, tempK: 250, desc: '地球唯一的天然卫星，没有大气，表面布满撞击坑与古老的玄武岩月海。它始终以同一面朝向地球。' };
    var planets = [
      mk({ id: 0, name: '水星', type: 'rock', key: 'mercury', r: 0.383, a: 0.387, p: 0.2408, e: 0.2056, ph: 3.1, g: 0.38, pa: 0, pc: '#000000', T: 440, seed: 0x4D455243, tilt: 0.03, rot: 1407.6, vis: { color: '#8f8a84', craters: 1.4, atmDensity: 0 } }),
      mk({ id: 1, name: '金星', type: 'rock', key: 'venus', r: 0.949, a: 0.723, p: 0.6152, e: 0.0068, ph: 0.9, g: 0.904, pa: 92, pc: '#e8d7a0', T: 737, seed: 0x56454E55, tilt: 177.4, rot: 5832.5, vis: { color: '#e6cf8f', cloud: 1.0, cloudColor: [0.93, 0.86, 0.66], atm: [0.95, 0.85, 0.6], atmDensity: 1.4, craters: 0.1, palette: 'venus', sea: -1, rangeM: 14000, detailAmp: 0.02, lava: 0.15 } }),
      mk({ id: 2, name: '地球', type: 'earth', key: 'earth', r: 1, a: 1, p: 1, e: 0.0167, ph: 1.75, g: 1, pa: 1, pc: '#7fb4ff', T: 288, seed: 0x45415254, tilt: 23.44, rot: 23.93, moons: [moon], mc: 1, life: { level: '文明', rank: 3 },
        timeline: { formGyr: 0.05, oceanGyr: 0.5, greenGyr: 4.13, civGyr: SUN_AGE_GYR - 200 / 1e9 } }),
      mk({ id: 3, name: '火星', type: 'desert', key: 'mars', r: 0.532, a: 1.524, p: 1.881, e: 0.0934, ph: 4.4, g: 0.379, pa: 0.006, pc: '#e2b08a', T: 210, seed: 0x4D415253, tilt: 25.2, rot: 24.62, mc: 2,
        moons: [{ name: '火卫一', radiusRel: 0.0018, orbitKm: 9376, periodDays: 0.319, seed: 0x50484F42, type: 'rock' }, { name: '火卫二', radiusRel: 0.001, orbitKm: 23463, periodDays: 1.263, seed: 0x4445494D, type: 'rock' }],
        vis: { color: '#c1683f', palette: 'mars', atm: [0.85, 0.65, 0.5], atmDensity: 0.18, cloud: 0.05, iceLat: 0.9, iceHeight: 0.6, iceColor: [0.95, 0.93, 0.92], craters: 0.9, rangeM: 30000, sea: -1, detailAmp: 0.025 } }),
      mk({ id: 4, name: '木星', type: 'gas', subtype: 'gasGiant', key: 'jupiter', r: 11.21, a: 5.203, p: 11.862, e: 0.0489, ph: 0.4, g: 2.53, pa: 1000, pc: '#d8c3a0', T: 165, seed: 0x4A555049, tilt: 3.1, rot: 9.93, mc: 95,
        // 潮汐加热是实测结论，不是示意：木卫一的火山（Voyager 1979）、木卫二的感应磁场（Khurana 1998）都指向内部加热与冰下海洋
        moons: [{ name: '木卫一', radiusRel: 0.286, orbitKm: 421700, periodDays: 1.77, seed: 0x494F, type: 'lava', tidalHeated: true, desc: '太阳系里火山活动最剧烈的天体：木星与另外两颗伽利略卫星的轨道共振把它反复揉捏，内部因此持续熔融（Voyager 1 1979 年拍到了正在喷发的火山）。' },
          { name: '木卫二', radiusRel: 0.245, orbitKm: 671000, periodDays: 3.55, seed: 0x4555524F, type: 'ice', tidalHeated: true, desc: '冰壳下几乎肯定有一层全球性的液态水海洋，水量可能是地球全部海水的两倍。依据是伽利略号测到的感应磁场（Khurana et al. 1998）与几乎没有撞击坑的年轻冰面。' },
          { name: '木卫三', radiusRel: 0.413, orbitKm: 1070400, periodDays: 7.15, seed: 0x47414E59, type: 'ice', tidalHeated: true, desc: '太阳系最大的卫星，比水星还大，也是唯一有自身磁场的卫星。冰壳深处可能夹着一层咸水海洋。' },
          { name: '木卫四', radiusRel: 0.378, orbitKm: 1882700, periodDays: 16.69, seed: 0x43414C4C, type: 'rock', desc: '太阳系里撞击坑最密的天体之一：它没有参与轨道共振，几乎没有内部加热，表面从四十多亿年前保留至今。' }],
        // 颜色是实测的（硬编码），说明文字按同一套分类口径写出来：木星 T_eff 124 K，属 SBP2000 第 I 类
        vis: { color: '#c9a978', hue: 30, gasStyle: 'jupiter', atm: [0.9, 0.82, 0.7], gasClass: 'I',
          gasNote: TR('云顶温度 124 K（T_eff）：主要凝结物为氨冰（NH₃，更深处是 NH₄SH 与水云），因此呈黄褐分明的明暗云带 —— 氨冰本身是白的，黄褐来自云顶的发色团（West et al. 2004；Carlson et al. 2016）（依据：Sudarsky et al. 2000 巨行星反照率分类第 I 类；颜色为实测）') } }),
      mk({ id: 5, name: '土星', type: 'gas', subtype: 'gasGiant', key: 'saturn', r: 9.45, a: 9.537, p: 29.457, e: 0.0565, ph: 2.6, g: 1.07, pa: 1000, pc: '#e9d9a8', T: 134, seed: 0x53415455, tilt: 26.7, rot: 10.7, mc: 146,
        moons: [{ name: '土卫六', radiusRel: 0.404, orbitKm: 1221870, periodDays: 15.95, seed: 0x54495441, type: 'desert', desc: '太阳系里唯一有浓密大气的卫星：1.5 bar 的氮气，地表 94 K，有甲烷的雨、河与湖（惠更斯号 2005 年着陆实测）。' },
          { name: '土卫二', radiusRel: 0.0396, orbitKm: 237948, periodDays: 1.37, seed: 0x454E4345, type: 'ice', tidalHeated: true, desc: '直径只有 500 km，南极却在往太空喷水：卡西尼号直接穿过羽流，测到了盐、二氧化硅与有机分子（Porco et al. 2006）。冰壳下有一片液态水海洋。' },
          { name: '土卫五', radiusRel: 0.12, orbitKm: 527108, periodDays: 4.52, seed: 0x52484541, type: 'ice' }],
        vis: { color: '#e3cf98', hue: 45, gasStyle: 'saturn', atm: [0.95, 0.9, 0.75], rings: { inner: 1.24, outer: 2.27, seed: 0x52494E47, cassini: true }, gasClass: 'I',
          gasNote: TR('云顶温度 95 K（T_eff）：主要凝结物为氨冰（NH₃），因此呈乳白偏淡金的云带 —— 与木星同属第 I 类，但云顶之上多一层厚的光化学霾，发色团更少，所以带纹比木星淡得多（依据：Sudarsky et al. 2000 巨行星反照率分类第 I 类；颜色为实测）') } }),
      mk({ id: 6, name: '天王星', type: 'gas', subtype: 'iceGiant', key: 'uranus', r: 4.007, a: 19.19, p: 84.02, e: 0.0464, ph: 5.2, g: 0.886, pa: 1000, pc: '#bfe6ee', T: 76, seed: 0x5552414E, tilt: 97.8, rot: 17.24, mc: 28,
        moons: [{ name: '天卫三', radiusRel: 0.124, orbitKm: 435910, periodDays: 8.7, seed: 0x54495441, type: 'ice' }],
        vis: { color: '#a9dbe3', hue: 185, gasStyle: 'uranus', atm: [0.75, 0.9, 0.95], rings: { inner: 1.6, outer: 2.0, seed: 0x55524E47, faint: true }, gasClass: 'ice',
          gasNote: TR('云顶温度 76 K：主要凝结物为甲烷冰与氨冰，因此呈淡青色（甲烷吸收 0.6–0.9 μm 的红光，只把蓝绿散射回来；上方还有一层厚霾把带纹抹平）（依据：甲烷吸收带 Karkoschka 1998 + 旅行者 2 号实测；颜色为实测）') } }),
      mk({ id: 7, name: '海王星', type: 'gas', subtype: 'iceGiant', key: 'neptune', r: 3.883, a: 30.07, p: 164.8, e: 0.0095, ph: 0.2, g: 1.14, pa: 1000, pc: '#4b70dd', T: 72, seed: 0x4E455054, tilt: 28.3, rot: 16.11, mc: 16,
        moons: [{ name: '海卫一', radiusRel: 0.212, orbitKm: 354759, periodDays: 5.88, seed: 0x54524954, type: 'ice' }],
        vis: { color: '#3f5fd0', hue: 225, gasStyle: 'neptune', atm: [0.45, 0.6, 1.0], gasClass: 'ice',
          gasNote: TR('云顶温度 72 K：主要凝结物为甲烷冰与氨冰，因此呈深蓝色（与天王星同为甲烷吸收，但霾层更薄、散射更少，蓝得更深）（依据：甲烷吸收带 Karkoschka 1998 + 旅行者 2 号实测；颜色为实测）') } })
    ];
    var sys = { id: 1207, seed: SOLAR_SEED, name: '太阳系', star: star, stars: [star], multiplicity: 1, hierarchy: { root: { kind: 'star', i: 0, mass: 1, lum: 1, id: 0 }, N: 1, note: TR('单星') }, planets: planets, habitableIndex: 2, nowYr: nowYr, isSolar: true, ringEndGyr: 0.2, universeHabitability: 1,
      dwarfs: [{ name: '冥王星', type: 'ice', radiusRel: 0.186, orbitAU: 39.48, periodYr: 247.9, ecc: 0.2488, phase: 3.9, dwarf: true, seed: 0x504C5554, color: '#c8b6a0' }],
      // 太阳系的带/彗星/盘用实测值（过程生成的恒星系在 generateSystem 里按标度给），这样 #1207 也能看到小行星带与柯伊伯带
      // 带内的代表天体用实测值（半径为平均半径 / 密度 / 反照率 / 自转周期），进去看的就是这几颗
      belts: [
        { kind: 'asteroid', cn: TR('小行星带（主带）'), innerAU: 2.1, outerAU: 3.3, note: TR('木星摄动让这里的星子无法并成行星；总质量只有月球的约 4%（实测）'),
          members: [
            { name: '谷神星', radiusKm: 469.7, orbitAU: 2.766, rhoKgM3: 2162, albedo: 0.09, rotH: 9.07, seed: 0x43455245, real: true, round: true,
              desc: '主带里最大的天体，也是唯一被归为矮行星的一颗：半径 470 km，已经被自身引力揉成球。黎明号（Dawn, 2015）发现它的地壳含有大量水冰，欧西里斯坑里的亮斑是碳酸钠盐。', ref: 'Dawn 任务实测（Russell et al. 2016）' },
            { name: '灶神星', radiusKm: 262.7, orbitAU: 2.362, rhoKgM3: 3456, albedo: 0.42, rotH: 5.34, seed: 0x56455354, real: true,
              desc: '主带第二大、也是最亮的小行星：分异过的岩质天体，有铁核与玄武岩壳，南极有一个直径 500 km 的巨大撞击盆地（雷亚希尔维亚）。地球上的 HED 陨石就来自这里。', ref: 'Dawn 任务实测（Russell et al. 2012）' },
            { name: '智神星', radiusKm: 256, orbitAU: 2.772, rhoKgM3: 2890, albedo: 0.16, rotH: 7.81, seed: 0x50414C4C, real: true,
              desc: '主带第三大天体，轨道倾角高达 34.8°，形状明显不规则、表面遍布大坑——甚高倍适应光学成像显示它像一颗"高尔夫球"（Marsset et al. 2020）。', ref: 'VLT/SPHERE 成像（Marsset et al. 2020）' },
            { name: '健神星', radiusKm: 216.5, orbitAU: 3.139, rhoKgM3: 1940, albedo: 0.072, rotH: 13.83, seed: 0x48594745, real: true, round: true,
              desc: '主带第四大天体，典型的 C 型碳质小行星：反照率只有 0.07，密度不到 2 g/cm³，含水矿物丰富。它接近球形，可能也满足矮行星的判据。', ref: 'VLT/SPHERE 成像（Vernazza et al. 2020）' }
          ] },
        { kind: 'kuiper', cn: TR('柯伊伯带'), innerAU: 30, outerAU: 50, note: TR('海王星外的冰质星子盘，冥王星就在其中（实测）'),
          members: [
            { name: '阋神星', radiusKm: 1163, orbitAU: 67.8, rhoKgM3: 2520, albedo: 0.96, rotH: 379, seed: 0x45524953, real: true, round: true,
              desc: '离散盘天体，质量比冥王星还大 27%——正是它的发现（2005）逼着国际天文联合会重新定义"行星"。表面覆盖着冻结的甲烷，反照率高达 0.96，几乎和新雪一样白。', ref: '掩星测半径（Sicardy et al. 2011）' },
            { name: '妊神星', radiusKm: 780, orbitAU: 43.1, rhoKgM3: 1885, albedo: 0.51, rotH: 3.92, seed: 0x4841554D, real: true,
              desc: '柯伊伯带里最奇怪的天体之一：3.9 小时转一圈，快到被自转拉成一个 2100×1680×1050 km 的三轴椭球，还带着一圈环（掩星发现，Ortiz et al. 2017）。', ref: '掩星观测（Ortiz et al. 2017）' },
            { name: '鸟神星', radiusKm: 715, orbitAU: 45.4, rhoKgM3: 1700, albedo: 0.81, rotH: 22.8, seed: 0x4D414B45, real: true, round: true,
              desc: '经典柯伊伯带天体，表面是冻结的甲烷与乙烷颗粒，反照率 0.81。2011 年的掩星显示它几乎没有大气。', ref: '掩星观测（Ortiz et al. 2012）' },
            { name: '创神星', radiusKm: 555, orbitAU: 43.7, rhoKgM3: 1990, albedo: 0.11, rotH: 17.7, seed: 0x51554130, real: true, round: true,
              desc: '经典柯伊伯带天体，表面有结晶态水冰——这需要某种加热机制不断"退火"，否则宇宙线早该把它打成非晶态。2023 年在它周围也发现了环。', ref: '掩星与光谱（Jewitt & Luu 2004；Morgado et al. 2023）' }
          ] }
      ],
      comets: { longPeriodPerCentury: 25, oortAU: 100000, note: TR('长周期彗星来自奥尔特云（≈2000–100000 AU；Oort 1950）；每世纪肉眼可见的大彗星数量级为十几颗（示意）') },
      disk: { kind: 'debris', cn: TR('黄道尘埃带（碎屑）'), frac: 1, ref: TR('小行星碰撞与彗星尘构成的行星际尘埃云——夜里的黄道光就是它（实测）') },
      rogues: [] };
    sys.dim = 3; sys.dimMode = '3d'; attachParams(sys, universeParams || { isOurs: true });
    planets.forEach(function (p) { p.system = sys; p.desc = describe(p, nowYr); });
    moon.system = sys; moon.parent = planets[2];
    return sys;
  }

  function randomVisit(seed, universeParams, opts) {
    opts = opts || {};
    function empty(sy) { return !sy || !sy.planets || !sy.planets.length; }
    var s = hash32((seed >>> 0) ^ 0x7A11E7), sys, tries = 0;
    do { sys = generateSystem(s, universeParams, opts); s = hash32(s + 1); tries++; } while (empty(sys) && tries < 20);
    // 重试耗尽（紧密多星里所有轨道都落在 HW99 不稳定区）：回退到单星系统，它必然有行星
    if (empty(sys)) { var o1 = {}; for (var k in opts) o1[k] = opts[k]; o1.multiplicity = 1; sys = generateSystem(s, universeParams, o1); s = hash32(s + 1); }
    if (empty(sys)) return { system: sys, planet: null, nextSeed: s };
    var rnd = mulberry32(s), idx = Math.floor(rnd() * sys.planets.length);
    if (sys.habitableIndex >= 0 && rnd() < 0.5) idx = sys.habitableIndex;
    return { system: sys, planet: sys.planets[idx] || sys.planets[0], nextSeed: s };
  }

  /* ============================================================ 地质史 / 时间 → 材质参数 */
  function ageGyrOf(planet, timeYr) { var f = planet.starFormedYr != null ? planet.starFormedYr : (planet.system ? planet.system.star.formedYr : (planet.nowYr || NOW_YR) - 4.6e9); return ((timeYr != null ? timeYr : (planet.nowYr || NOW_YR)) - f) / 1e9; }

  // 地球：按太阳系年龄（Gyr）返回时代描述与材质
  function earthEra(age) {
    var e = {};
    e.exists = age >= 0.05; e.forming = smoothstep(0.05, 0.25, age);
    // 岩浆 / 酸雾 / 褐色海 / 蓝海 / 绿陆 / 漂移 / 灯光
    e.lava = age < 0.2 ? 1 : lerp(1, 0.55, smoothstep(0.2, 0.45, age)) * (1 - smoothstep(0.55, 1.1, age));
    e.lavaSea = 1 - smoothstep(0.32, 0.45, age); // 早期"海"是岩浆海
    e.fog = age < 0.35 ? 1 : lerp(1, 0.55, smoothstep(0.35, 0.8, age)) * (1 - smoothstep(0.9, 2.3, age));
    e.oceanBrown = 1 - smoothstep(1.4, 2.6, age);
    e.hasOcean = smoothstep(0.32, 0.5, age);
    e.green = smoothstep(4.13, 4.25, age);
    e.drift = 1 - smoothstep(4.25, 4.55, age); // 冈瓦纳/盘古分裂：往回看大陆聚拢
    if (age < 4.15) e.drift = 1;
    e.snowball = Math.max(smoothstep(2.15, 2.25, age) * (1 - smoothstep(2.3, 2.45, age)), smoothstep(3.85, 3.9, age) * (1 - smoothstep(3.95, 4.0, age)));
    e.lights = smoothstep(SUN_AGE_GYR - 200 / 1e9, SUN_AGE_GYR - 40 / 1e9, age);
    e.cloud = lerp(0.15, 0.55, smoothstep(0.5, 1.2, age));
    e.name = age < 0.05 ? TR('尚未形成') : age < 0.25 ? TR('吸积中') : age < 0.6 ? TR('冥古宙 · 岩浆地表') : age < 1.1 ? TR('冥古宙末 · 褐色原始海洋') : age < 2.1 ? TR('太古宙 · 酸雾渐散') : age < 4.0 ? (e.snowball > 0.5 ? TR('元古宙 · 雪球地球') : TR('元古宙 · 海洋变蓝')) : age < 4.13 ? TR('古生代早期 · 陆地仍是裸岩') : age < 4.35 ? TR('古生代 · 大陆变绿') : age < 4.55 ? TR('中生代 · 冈瓦纳分裂') : e.lights > 0.01 ? TR('现代 · 文明的灯光') : TR('新生代 · 现代大陆格局');
    return e;
  }

  // 任意行星在 timeYr 时刻的完整材质参数（GL 与 2D 回退共用）
  function visualParams(planet, timeYr) {
    var v = planet.visual || baseVisual(planet.type), age = ageGyrOf(planet, timeYr), tl = planet.timeline || { formGyr: 0.15, oceanGyr: 0.6, greenGyr: Infinity, civGyr: Infinity };
    var o = {
      type: planet.type, gas: v.gas ? 1 : 0, sea: v.sea, rangeM: v.rangeM, radiusM: planet.radiusM || planet.radiusRel * EARTH_R_M,
      atm: v.atm.slice(), atmDensity: v.atmDensity, cloud: v.cloud, cloudColor: v.cloudColor.slice(), cloudScale: 3.0,
      iceLat: v.iceLat, iceHeight: v.iceHeight, iceColor: v.iceColor.slice(), spec: v.spec, cracks: v.cracks || 0, craters: v.craters || 0,
      oceanShallow: (v.oceanShallow || [0.1, 0.4, 0.6]).slice(), oceanDeep: (v.oceanDeep || [0.02, 0.09, 0.3]).slice(),
      lava: v.lava || 0, lavaSea: v.lavaSea || 0, fog: 0, fogColor: [0.75, 0.7, 0.55], green: 0, veg0: VEG.temperate.slice(), veg1: VEG.tropical.slice(),
      lights: 0, drift: 0, detailAmp: v.detailAmp, detailFreq: v.detailFreq, hue: v.hue || 30, gasStyle: v.gasStyle || 'generic', rings: v.rings || null,
      // 巨行星云顶分类（gasCloudClass）的产物：缺省全为 null/0，太阳系四颗巨行星与其它类型逐位保持原样
      gasClass: v.gasClass || null, gasKey: v.gasKey || null, gasNote: v.gasNote || null, gasAlbedo: v.gasAlbedo != null ? v.gasAlbedo : null,
      gasSat: v.gasSat != null ? v.gasSat : null, gasLight: v.gasLight != null ? v.gasLight : null, gasContrast: v.gasContrast != null ? v.gasContrast : null, gasHueJit: v.gasHueJit != null ? v.gasHueJit : null, gasGlow: v.gasGlow || 0,
      // 托林雾霾（覆盖在云顶/冰面之上的有机气溶胶）与照明色温（宿主恒星的普朗克色，太阳 = 白）
      tholin: v.tholin || 0, tholinColor: (v.tholinColor || [0.74, 0.42, 0.34]).slice(), tholinNote: v.tholinNote || null,
      sunTint: starTintOf(planet.star && planet.star.tempK), lightNote: tintNoteOf(planet.star),
      exists: age >= tl.formGyr, forming: smoothstep(tl.formGyr, tl.formGyr + 0.15, age), ageGyr: age, eraName: '', palette: v.palette || planet.type
    };
    if (planet.type === 'earth') {
      var e = earthEra(age);
      o.exists = e.exists; o.forming = e.forming; o.eraName = e.name;
      o.lava = e.lava; o.lavaSea = e.lavaSea; o.fog = e.fog; o.fogColor = mix3([0.66, 0.63, 0.5], [0.58, 0.56, 0.5], e.lava);
      o.green = e.green; o.drift = e.drift * 0.28; o.lights = e.lights; o.cloud = e.cloud * (1 - e.fog * 0.6);
      o.oceanShallow = mix3(o.oceanShallow, [0.42, 0.3, 0.16], e.oceanBrown); o.oceanDeep = mix3(o.oceanDeep, [0.22, 0.14, 0.06], e.oceanBrown);
      o.atm = mix3(o.atm, [0.8, 0.7, 0.45], e.fog); o.atmDensity = lerp(1.0, 1.35, e.fog);
      o.cloudColor = mix3([1, 1, 1], [0.85, 0.8, 0.62], e.fog);
      o.iceLat = e.snowball > 0 ? lerp(0.86, 0.12, e.snowball) : (age < 1.5 ? 0.99 : 0.86);
      o.iceHeight = age < 1.5 ? 4 : 1.7;
      if (age < 0.5) { o.sea = lerp(0.42, v.sea, e.hasOcean); }
      o.spec = e.lavaSea > 0.5 ? 0.4 : 1.0;
    } else if (planet.type === 'living') {
      o.green = planet.life ? smoothstep(tl.greenGyr, tl.greenGyr + 0.4, age) * (planet.life.rank >= 1 ? 1 : 0.35) : 0;
      o.lights = planet.life && planet.life.rank >= 3 ? smoothstep(tl.civGyr, tl.civGyr + 0.02, age) : 0;
      o.fog = (1 - smoothstep(tl.formGyr + 0.2, tl.oceanGyr + 0.6, age)) * 0.9; o.lava = (1 - smoothstep(tl.formGyr + 0.1, tl.oceanGyr, age));
      o.lavaSea = 1 - smoothstep(tl.formGyr + 0.15, tl.oceanGyr - 0.05, age);
      o.oceanShallow = mix3(o.oceanShallow, [0.42, 0.3, 0.16], 1 - smoothstep(tl.oceanGyr, tl.oceanGyr + 1.2, age));
      o.oceanDeep = mix3(o.oceanDeep, [0.22, 0.14, 0.06], 1 - smoothstep(tl.oceanGyr, tl.oceanGyr + 1.2, age));
      if (planet.life && planet.life.rank <= 1) o.veg0 = [0.35, 0.45, 0.2];
      var hueShift = mulberry32(planet.seed ^ 0x77)();
      if (hueShift < 0.25) { o.veg0 = [0.45, 0.35, 0.15]; o.veg1 = [0.55, 0.3, 0.2]; } else if (hueShift < 0.4) { o.veg0 = [0.2, 0.35, 0.4]; o.veg1 = [0.15, 0.4, 0.42]; }
    } else if (planet.type === 'ocean' || planet.type === 'lava' || planet.type === 'desert' || planet.type === 'rock' || planet.type === 'ice') {
      if (!planet.real) { o.fog = (1 - smoothstep(tl.formGyr + 0.1, tl.formGyr + 0.6, age)) * 0.8; if (planet.type !== 'lava') o.lava = 1 - smoothstep(tl.formGyr + 0.05, tl.formGyr + 0.5, age); }
      if (planet.type === 'lava') o.fogColor = [0.5, 0.3, 0.2];
    }
    if (planet.life && planet.type !== 'earth' && planet.type !== 'living') { // 海洋等类型上的生命/文明：植被与灯光同样按时间线出现
      if (planet.life.rank >= 1) o.green = Math.max(o.green, smoothstep(tl.greenGyr, tl.greenGyr + 0.4, age) * 0.8);
      if (planet.life.rank >= 3) o.lights = Math.max(o.lights, smoothstep(tl.civGyr, tl.civGyr + 0.02, age));
    }
    if (planet.visualKey === 'venus') { o.fog = 0.85; o.fogColor = [0.9, 0.82, 0.6]; }
    if (planet.visualKey === 'mars') { o.fogColor = [0.85, 0.65, 0.5]; o.fog = 0.12; }
    if (o.gas) { // 没有固体表面：高度一律以 1 bar 参考面为准，云层按大气标高分层
      o.noSurface = 1;
      o.gasIce = (planet.subtype === 'iceGiant' || planet.subtype === 'miniNeptune' || planet.visualKey === 'uranus' || planet.visualKey === 'neptune') ? 1 : 0;
      // 大气标高 H = R_specific·T/g（H₂/He 混合，μ≈2.3 g/mol → R_specific ≈ 3615 J/(kg·K)）：木星 ≈24 km，海王星 ≈20 km
      o.scaleHeightM = clamp(3615 * (planet.tempK || 130) / (9.81 * Math.max(planet.gravityRel || 1, 0.05)), 2000, 120000);
      // 超热木星的辉边颜色：按云顶温度从暗红（~1500 K）过渡到橙（~3000 K）。gasGlow = 0 时不使用
      o.gasGlowCol = o.gasGlow > 0 ? mix3([1.0, 0.20, 0.04], [1.0, 0.62, 0.30], smoothstep(1500, 3000, planet.tempK || 1500)) : [0, 0, 0];
    } else { o.noSurface = 0; o.gasIce = 0; o.scaleHeightM = 0; o.gasGlow = 0; o.gasGlowCol = [0, 0, 0]; }
    /* 外观风格：全部从 planet.seed 派生，且**用现在这一刻的年龄**（不是时间轴上的 timeYr），
       这样 CPU 贴图（getMaps 按 seed 缓存、与时间无关）与着色器 uniform 用的是同一套数，
       拖时间轴只改材质（岩浆/海/冰/灯光），不会让撞击坑数量跟着变。 */
    o.style = surfStyle(planet, o, ageGyrOf(planet, null)); o.palVar = o.style.palVar; o.surfKind = o.style.kind;
    if (o.surfKind === 3) o.sunTint = mix3(o.sunTint, [1, 1, 1], 0.5);
    /* 冰盖范围随温度：冷 → 冰线压到低纬，暖 → 只剩极冠。iceLat 是「|sin 纬度| 的阈值」。
       只在过程生成的世界上生效（真实天体与地球时间线自己算的那套一个字不改）。 */
    if (!planet.visualKey && planet.type !== 'earth' && isFinite(planet.tempK) && o.iceLat > 0 && o.iceLat < 1.5) {
      var tIce = clamp((planet.tempK - 215) / 95, 0, 1);
      o.iceLat = clamp(lerp(0.16, 0.99, tIce) * (0.9 + 0.2 * ((o.style.crackAmt * 3) % 1)), 0.1, 0.995);
    }
    if (!o.eraName) o.eraName = !o.exists ? TR('尚未形成') : o.forming < 1 ? TR('吸积中') : (o.lava > 0.3 ? TR('地表仍在熔融') : (o.green > 0.2 ? TR('陆地已有生物覆盖') : TR('稳定演化中')));
    return o;
  }

  /* ============================================================ 描述文案（冷静克制，2–3 句） */
  function describe(planet, timeYr) {
    var t = planet.type, r = planet.radiusRel, g = planet.gravityRel, T = planet.tempK, pa = planet.atmosphere ? planet.atmosphere.pressureRel : 0, s = [];
    if (planet.dim === 2) { var d2s = TR({ rock: '岩质圆盘', ocean: '被一圈液态水覆盖的圆盘', gas: '气态圆盘，没有可以站立的地面', ice: '冰封的圆盘', lava: '熔融的圆盘', desert: '干燥的圆盘', living: '有生命的圆盘', earth: '圆盘' }[t] || '圆盘');
      return TR('二维世界（示意）：这个星球是一个') + d2s + TR('，半径约为地球的 ') + fmt(r, 2) + TR(' 倍；它的地面是一条线——圆周。昼夜是圆盘的两个半圆，大气是圆周外的一圈。') + (planet.life ? TR('沿着这条线分布着') + (planet.life.rank >= 3 ? TR('聚落与灯光') : TR('生命')) + TR('（生命等级：') + TR(planet.life.level) + TR('）。') : '') + TR('在这里，引力如何随距离变化只是推测（2+1 维）。'); }
    if (planet.dim && planet.dim !== 3) { var Dn = Number.isInteger(planet.dim) ? planet.dim + TR(' 维') : fmt(planet.dim, 2) + TR(' 维（分数维）'); return Dn + TR('空间里的一颗试探行星：引力随距离按 r^{−(D−1)} 衰减，') + (planet.dim >= 4 ? TR('不存在稳定的圆轨道，轻微扰动就会坠入恒星、或沿径向逃逸到无穷远（Ehrenfest 1917）——两种都发生在这个 D 维空间内部，不是「跑进别的维度」') : TR('轨道束缚但不闭合，近心点持续进动')) + TR('。这一层只展示轨道的 3 维投影，不进入行星与地表。'); }
    var vp = visualParams(planet, timeYr);
    if (!vp.exists) return TR('此时它还不存在。恒星周围只有一个雾蒙蒙的尘埃环，行星的原材料就在里面。');
    if (vp.forming < 1) return TR('行星正在吸积中。尘埃与星子在轨道上碰撞、合并，还没有稳定的表面。');
    if (t === 'earth') {
      var a = vp.ageGyr;
      if (a < 0.6) return TR('原始地球，一个灰蒙蒙的球体。地表纵横交错着发红的岩浆河，浓密的酸雾把一切裹在里面；褐色的海刚刚开始凝结。');
      if (a < 1.1) return TR('冥古宙末期。褐色的海面在酸雾下微微起伏，岩浆河已经退到少数低地。若把视点扎入海中，能看到刚出现的生命。');
      if (a < 2.3) return TR('太古宙。笼罩地表的浓雾正在消散，海洋逐渐由褐转蓝，陆地仍是裸露的灰岩，还没有一片绿色。');
      if (a < 4.13) return vp.iceLat < 0.5 ? TR('元古宙的雪球时期。冰盖从两极推进到赤道附近，海洋几乎被封在冰下。') : TR('元古宙。海洋已经是蓝色，陆地依旧荒芜。大气里的氧在缓慢累积。');
      if (a < 4.55) return TR('显生宙。大陆在变绿，海岸线由植物勾勒出来；巨大的冈瓦纳古陆正像初春的冰块一样分崩离析。');
      if (vp.lights > 0.01) return TR('现代地球。蓝色海洋与绿色大陆之间是白色的云系；转到夜面，可以看到人工光源排成的网络——文明出现了。');
      return TR('现代大陆格局的地球。蓝海、绿陆、白云、两极冰盖。人类已经出现，但夜面还看不见灯光。');
    }
    if (planet.visualKey === 'mercury') return TR('离太阳最近的岩质行星，没有大气。表面布满撞击坑，昼夜温差超过六百度，看上去与月球十分相似。');
    if (planet.visualKey === 'venus') return TR('与地球大小相当，却被九十多个大气压的二氧化碳和硫酸云层包裹。云下的地表温度约 737 K，是太阳系里最热的行星表面。');
    if (planet.visualKey === 'mars') return TR('半径约为地球的一半，稀薄的二氧化碳大气留不住热量。地表是氧化铁的红色荒漠，两极有水冰与干冰构成的极冠，有巨大的峡谷与火山。');
    if (planet.visualKey === 'jupiter') return TR('太阳系最大的行星，半径约为地球的 11 倍。表面是沿纬度排列的云带，大红斑是一个持续了数百年的风暴。已知卫星九十余颗。');
    if (planet.visualKey === 'saturn') return TR('气态巨行星，密度比水还低。冰粒构成的光环宽达数十万公里，却只有几十米厚。土卫六有浓密的大气。');
    if (planet.visualKey === 'uranus') return TR('冰巨星，自转轴几乎躺在轨道面上。淡青色来自大气里的甲烷，云带很淡，有一组暗弱的细环。');
    if (planet.visualKey === 'neptune') return TR('距太阳最远的行星，深蓝色的冰巨星。表面风速可达每秒数百米，偶尔出现大黑斑之类的风暴。');
    var hostNote = planet.orbitType === 'S' ? TR('它绕多星系统中的 ') + TRN(planet.hostName) + TR(' 运行（S 型轨道，稳定区判据 HW99）。') : planet.orbitType === 'P' ? TR('它绕') + TRN(planet.hostName) + TR('运行（P 型环双星轨道，恒星辐照取两颗恒星光度之和，稳定区判据 HW99）。') : '';
    var size = r < 0.6 ? TR('半径不到地球的三分之二') : r < 1.5 ? TR('半径与地球相当（') + fmt(r, 2) + TR(' 倍）') : r < 3 ? TR('半径约为地球的 ') + fmt(r, 1) + TR(' 倍') : TR('半径约为地球的 ') + fmt(r, 0) + TR(' 倍');
    var life = planet.life ? TR('生命等级：') + TR(planet.life.level) + TR('。') : '';
    switch (t) {
      case 'rock': s.push(TR('一颗岩质行星，') + size + TR('，表面重力约 ') + fmt(g, 2) + TR(' g。')); s.push(pa < 0.02 ? TR('几乎没有大气，地表由撞击坑与古老的熔岩平原构成，昼夜温差极大。') : TR('大气稀薄，地表是风化的岩石与尘土，平均温度约 ') + T + TR(' K。')); break;
      case 'desert': s.push(TR('干燥的岩质世界，') + size + TR('。')); s.push(TR('稀薄的大气留不住水分，地表以沙丘与风蚀岩为主，平均温度约 ') + T + TR(' K。')); if (T < 280) s.push(TR('两极有少量水冰。')); break;
      case 'ocean': s.push(TR('表面几乎全部被液态水覆盖，只有零星岛屿露出海面。')); s.push(TR('大气压约为地球的 ') + fmt(pa, 2) + TR(' 倍，平均温度约 ') + T + TR(' K。')); s.push(planet.life ? TR('生命在水里。') + life : TR('目前没有发现生命。')); break;
      case 'gas': s.push((planet.subtype === 'iceGiant' ? TR('一颗冰巨星，') : TR('一颗气态巨行星，')) + size + TR('，没有可以站立的表面。')); s.push(TR('云带沿纬度排列，风暴系统可以持续数百年。') + (planet.moonCount ? TR('已知卫星 ') + planet.moonCount + TR(' 颗。') : '')); if (vp.rings) s.push(TR('它有一组光环。')); break;
      case 'ice': s.push(TR('远离恒星的冰封世界，表面温度约 ') + T + TR(' K。')); s.push(TR('冰壳上有纵横的裂隙') + (pa > 0.05 ? TR('，稀薄的大气里偶有霜雾') : '') + TR('；冰下可能有海洋。')); break;
      case 'lava': s.push(TR('距离恒星过近，表面温度约 ') + T + TR(' K，岩石处于熔融状态。')); s.push(TR('夜面能看到发红的岩浆河网与熔岩海，昼面被恒星光烤成一片白热。')); break;
      case 'living': s.push(TR('有生命的世界，') + size + TR('，平均温度约 ') + T + TR(' K。')); s.push(vp.green > 0.05 ? TR('海洋与陆地并存，陆地上覆盖着某种利用恒星光的生物。') : TR('海洋里已经有生命，陆地还未被覆盖。')); if (planet.life && planet.life.rank >= 3) s.push(vp.lights > 0.01 ? TR('夜面可以看到人工光源排成的网络。') : TR('文明尚未出现。')); s.push(life); break;
      default: s.push(TR('一颗行星。'));
    }
    if (hostNote) s.push(hostNote);
    // 类型全谱标签与出现率（Kepler 统计）：告诉读者"这一类在真实统计里有多常见"
    // 热木星不打印这一档的出现率：Fressin 的 5.2% 是"近距巨行星整档"，与下一行热木星专属的
    // 0.4–1.2% 并排会被读成互相矛盾（两者口径不同，不是同一个量）。见下面的 hotJupiter 分支。
    if (planet.pclassCn) s.push(TR('分类：') + TR(planet.pclassCn) + (planet.massEarth != null ? TR('（') + fmt(planet.massEarth, 1) + TR(' M⊕，质量–半径关系 Chen & Kipping 2017）') : '') +
      (planet.occurrence != null && !planet.hotJupiter ? TR('，Kepler 出现率约 ') + fmt(planet.occurrence * 100, 1) + TR('%/星（P<85 d，Fressin et al. 2013）') : '') + TR('。'));
    // 热木星这一行放在潮汐锁定之前：它是这颗行星最要紧的一条身世，HUD 只画得下前几行
    if (planet.hotJupiter) s.push(planet.migrated
      ? TR('它形成在雪线以外，再迁移进来，停在观测到的 P ≈ ') + fmt(planet.migrationPeriodD, 1) + TR(' 天堆积处（Dawson & Johnson 2018；终点 a ≈ 2 a_Roche，Ford & Rasio 2006）——现在的轨道在尘埃升华半径以内，那里原地长不出行星。观测最终出现率随宿主：FGK 约 0.4–1.2%/星（Fressin 2013 / Wright 2012），M 矮星约 0.1%（Obermeier 2016）——这是文献里的全局最终率，不是单次迁移条件概率。')
      : TR('热木星：一般认为从雪线外迁移进来；观测最终出现率随宿主：FGK 约 0.4–1.2%/星（Fressin 2013 / Wright 2012），M 矮星约 0.1%（Obermeier 2016）。'));
    if (planet.tidalLocked) s.push(TR('轨道在潮汐锁定半径以内（Kasting et al. 1993），它多半已经被恒星锁定：一面永昼、一面永夜。'));
    return s.join('');
  }

  /* ============================================================ CPU 贴图生成（等距圆柱投影：行 0 = 南极；u = atan2(z,x)/2π+0.5） */
  function makeCanvas(w, h) {
    try { if (typeof document !== 'undefined') { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; } } catch (e) { /* ignore */ }
    try { if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h); } catch (e2) { /* ignore */ }
    return null;
  }
  function boxBlur(src, W, H, r) { // 分离盒式模糊；x 方向经度环绕，y 方向钳制
    var tmp = new Float32Array(W * H), out = new Float32Array(W * H), x, y, k, s, n = 2 * r + 1;
    for (y = 0; y < H; y++) { var row = y * W; s = 0; for (k = -r; k <= r; k++) s += src[row + ((k + W) % W)]; for (x = 0; x < W; x++) { tmp[row + x] = s / n; s += src[row + ((x + r + 1) % W)] - src[row + ((x - r + W) % W)]; } }
    for (x = 0; x < W; x++) { s = 0; for (k = -r; k <= r; k++) s += tmp[clamp(k, 0, H - 1) * W + x]; for (y = 0; y < H; y++) { out[y * W + x] = s / n; s += tmp[clamp(y + r + 1, 0, H - 1) * W + x] - tmp[clamp(y - r, 0, H - 1) * W + x]; } }
    return out;
  }
  function pointInPoly(poly, lon, lat) { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c; } return c; }
  // 真实地球：陆地掩膜（0..1，软边）与山脉高度（0..1）
  function rasterEarth(W, H) {
    var land = new Float32Array(W * H), range = new Float32Array(W * H), x, y, i;
    var cv = makeCanvas(W, H), ctx = cv && cv.getContext('2d');
    var sx = W / 360, sy = H / 180;
    function px(lon) { return (lon + 180) * sx; } function py(lat) { return (90 - lat) * sy; } // 画布 y 向下 = 北在上
    if (ctx) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff';
      [-360, 0, 360].forEach(function (off) {
        EARTH_LAND.forEach(function (poly) { ctx.beginPath(); poly.forEach(function (p, k) { var X = px(p[0] + off), Y = py(p[1]); if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.closePath(); ctx.fill(); });
      });
      ctx.fillRect(0, py(-70), W, H - py(-70)); // 南极大陆本体
      var img = ctx.getImageData(0, 0, W, H).data;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) land[(H - 1 - y) * W + x] = img[(y * W + x) * 4] / 255; // 翻转为行 0 = 南
      // 山脉：折线描边，宽度按度数
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'lighter';
      [-360, 0, 360].forEach(function (off) {
        EARTH_RANGES.forEach(function (rg) { var v = Math.round(rg[1] * 255); ctx.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; ctx.lineWidth = Math.max(1, rg[2] * sx); ctx.beginPath(); rg[0].forEach(function (p, k) { var X = px(p[0] + off), Y = py(p[1]); if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.stroke(); });
      });
      img = ctx.getImageData(0, 0, W, H).data;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) range[(H - 1 - y) * W + x] = img[(y * W + x) * 4] / 255;
    } else { // 无 Canvas 2D：逐点多边形判定（慢，仅兜底）
      for (y = 0; y < H; y++) { var lat = (y + 0.5) / H * 180 - 90; for (x = 0; x < W; x++) { var lon = (x + 0.5) / W * 360 - 180, inside = lat < -70; for (i = 0; i < EARTH_LAND.length && !inside; i++) inside = pointInPoly(EARTH_LAND[i], lon, lat); land[y * W + x] = inside ? 1 : 0; } }
    }
    var r = Math.max(1, Math.round(W / 256));
    return { land: boxBlur(boxBlur(land, W, H, r), W, H, r), range: boxBlur(range, W, H, r) };
  }

  // 撞击坑场：在 (u,v) 上的两级 2D 泊松式分布
  function craters(N, u, v, amount) {
    var out = 0, scales = [14, 40], k, s;
    for (k = 0; k < 2; k++) {
      s = scales[k]; var cx = u * 2 * s, cy = v * s, ix = Math.floor(cx), iy = Math.floor(cy);
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var gx = ix + ox, gy = iy + oy; if (gy < 0 || gy >= s) continue;
        var wx = ((gx % (2 * s)) + 2 * s) % (2 * s);
        var h = hash32((wx * 7919 + gy * 104729 + k * 31337) ^ N.seed);
        if ((h & 255) / 255 > amount * (k ? 0.55 : 0.4)) continue;
        var jx = ((h >>> 8) & 255) / 255, jy = ((h >>> 16) & 255) / 255, rad = 0.18 + ((h >>> 24) & 255) / 255 * 0.32;
        var dx = cx - (gx + jx), dy = cy - (gy + jy), d = Math.sqrt(dx * dx + dy * dy) / rad;
        if (d < 1.25) { var depth = (k ? 0.045 : 0.09) * (0.6 + rad); if (d < 0.9) out -= depth * (1 - d * d / 0.81) * 0.9; out += depth * 0.55 * Math.exp(-Math.pow((d - 0.98) / 0.14, 2)); }
      }
    }
    return out;
  }

  /* ---- 多尺度地形构件（全部确定性：只吃行星种子与方向向量） ----
     撞击盆地：由种子定的 K 个方向，每个有角半径、盆底深度与环形隆起。
     依据：月球的雨海/东方海、水星的卡洛里盆地都是「盆底被后期玄武岩填平 + 一圈同心山脊」。 */
  function basinsAt(seedBase, nx, ny, nz, count) {
    var out = 0, deepest = 0;
    for (var k = 0; k < count; k++) {
      var hh = hash32((seedBase + k * 0x9E3779B9) >>> 0);
      var uu = ((hh & 0xffff) / 65536) * 2 - 1, phi = ((hh >>> 16) / 65536) * TAU;
      var sq = Math.sqrt(Math.max(0, 1 - uu * uu));
      var cx = sq * Math.cos(phi), cy = uu, cz = sq * Math.sin(phi);
      var h2 = hash32(hh ^ 0x51ED2701);
      var rad = 0.16 + ((h2 & 255) / 255) * 0.36, dep = 0.55 + (((h2 >>> 8) & 255) / 255) * 0.9;
      var d = Math.acos(clamp(nx * cx + ny * cy + nz * cz, -1, 1)) / rad;
      if (d < 1.9) {
        var fill = dep * 0.062 * (1 - smoothstep(0, 1.05, d));
        out += dep * 0.030 * Math.exp(-Math.pow((d - 1.04) / 0.20, 2)) - fill;
        if (fill > deepest) deepest = fill;
      }
    }
    return { h: out, inBasin: clamp(deepest / 0.06, 0, 1) };
  }
  /* 辐射纹：年轻撞击坑抛出的高反照率射线。沿中心的方位角变化、随距离衰减 —— 所以是「从坑往外辐射的条纹」。 */
  function raysAt(N, seedBase, nx, ny, nz, count, amt) {
    if (amt <= 0 || count <= 0) return 0;
    var out = 0;
    for (var k = 0; k < count; k++) {
      var hh = hash32((seedBase + k * 0x85EBCA6B) >>> 0);
      if ((hh & 3) !== 0) continue;                       // 只有 1/4 的坑足够年轻，还留着辐射纹
      var uu = ((hh & 0xffff) / 65536) * 2 - 1, phi = ((hh >>> 16) / 65536) * TAU;
      var sq = Math.sqrt(Math.max(0, 1 - uu * uu));
      var cx = sq * Math.cos(phi), cy = uu, cz = sq * Math.sin(phi);
      var cd = clamp(nx * cx + ny * cy + nz * cz, -1, 1), d = Math.acos(cd);
      if (d > 1.25 || d < 1e-4) continue;
      /* 以坑心为极点建一组切向基：T = normalize(cross(up, c))，B = cross(c, T)；方位角 = atan2(n·B, n·T) */
      var tx, ty, tz;
      if (Math.abs(cy) < 0.985) { tx = cz; ty = 0; tz = -cx; } else { tx = 0; ty = -cz; tz = cy; }
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      var bx = cy * tz - cz * ty, by = cz * tx - cx * tz, bz = cx * ty - cy * tx;
      var ang = Math.atan2(nx * bx + ny * by + nz * bz, nx * tx + ny * ty + nz * tz);
      var rn = N.snoise(Math.cos(ang) * 5.5 + k * 13.1, Math.sin(ang) * 5.5 + k * 13.1, k * 3.7);
      out += smoothstep(0.30, 0.85, rn) * Math.max(0, 1 - d / 1.25) * amt;
    }
    return clamp(out, 0, 1);
  }

  var ZERO_BASIN = { h: 0, inBasin: 0 };
  /* ---------------------------------------------------------- 平铺细节贴图（3D，32³ RGBA8）
     四个通道 = 四张互不相关的随机格点场。GPU 的三线性插值把格点值插成平滑的值噪声，
     所以「采一次贴图」就等于「算一次噪声」，而多倍频只要在不同缩放上多采几次。
     为什么要它：多倍频噪声是靠展开循环内联出来的，snoise 在一个片元着色器里被内联上百次，
     D3D 那边的优化时间是超线性的 —— globe 原来要编 47 秒。采样没有这个问题。
     确定性：固定种子生成一次、所有行星共用；每颗行星的差异靠偏移/旋转（uDetOff）给。 */
  var DET_N = 32, detailTexCache = null;
  function makeDetailTex() {
    if (detailTexCache) return detailTexCache;
    var N = DET_N, d = new Uint8Array(N * N * N * 4), x, y, z, c, i = 0;
    for (z = 0; z < N; z++) for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      for (c = 0; c < 4; c++) {
        /* 固定种子的格点哈希：换一台机器、换一次运行，这张贴图逐字节相同 */
        var h = hash32((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (c * 2654435761));
        d[i++] = h & 255;
      }
    }
    detailTexCache = { data: d, N: N };
    return detailTexCache;
  }
  var mapCache = {}; var mapCacheKeys = [];
  function mapKeyOf(planet, size) { return (planet.seed >>> 0) + ':' + (planet.visualKey || planet.type) + ':' + size; }
  function mapCachePut(key, m) {
    mapCache[key] = m; mapCacheKeys.push(key);
    while (mapCacheKeys.length > 24) { var k0 = mapCacheKeys.shift(); delete mapCache[k0]; }
    return m;
  }
  /* 同步取图：要么命中缓存，要么当场算完（Node 侧、地表查询、以及任何等不起的调用走这里）。 */
  function getMaps(planet, size) {
    size = size || 512;
    var key = mapKeyOf(planet, size);
    if (mapCache[key]) return mapCache[key];
    var m = perfWrap('buildMaps', planet.type + ':' + size, function () { return buildMaps(planet, size, size / 2); });
    return mapCachePut(key, m);
  }
  function mapCached(planet, size) { return mapCache[mapKeyOf(planet, size)] || null; }

  /* 分片作业队列：每片只跑若干行，跑完一片就把主线程还回去。
     一片的行数按上一片的实测耗时自适应（目标 6 ms/片），慢机器自动切得更碎。 */
  var mapQueue = [];
  function mapQueuePush(planet, size) {
    var key = mapKeyOf(planet, size);
    if (mapCache[key]) return null;
    for (var i = 0; i < mapQueue.length; i++) if (mapQueue[i].key === key) return mapQueue[i];
    var e = { key: key, planet: planet, size: size, job: null, y: 0, rows: 8, done: null, type: planet.type };
    mapQueue.push(e); return e;
  }
  /* 推进队列，最多用掉 budgetMs 毫秒。返回本次完成的作业数组（调用方据此换贴图）。 */
  function mapQueueStep(budgetMs) {
    var t0 = perfNow(), finished = [];
    while (mapQueue.length && perfNow() - t0 < budgetMs) {
      var e = mapQueue[0];
      if (!e.job) { e.job = perfWrap('mapJobStart', e.type, function () { return mapJobStart(e.planet, e.size, e.size / 2); }); continue; }
      var H = e.job.H, y1 = Math.min(H, e.y + e.rows), t1 = perfNow();
      mapJobRows(e.job, e.y, y1);
      var dt = perfNow() - t1;
      perfAdd('mapSlice', dt, e.type);
      e.y = y1;
      e.rows = clamp(Math.round(e.rows * (6 / Math.max(dt, 0.25))), 2, 64);
      if (e.y >= H) {
        var m = perfWrap('mapJobFinish', e.type, function () { return mapJobFinish(e.job); });
        mapCachePut(e.key, m); e.done = m; finished.push(e); mapQueue.shift();
      }
    }
    return finished;
  }
  function mapQueuePending() { return mapQueue.length; }

  /* ---------------------------------------------------------- 贴图生成：开工 / 跑若干行 / 收工
     拆成三段**只为了能让出主线程**：行与行之间没有任何依赖，跑 0..H 一次和分成若干片跑，
     结果逐像素完全一样（归一化与打包仍然在收工那一步一次做完）。
     以前是在「换行星」的那一帧里同步跑完整张 512×256 —— 实测 127–178 ms，主线程就是在这里假死的。 */
  function mapJobStart(planet, W, H) {
    var N = makeNoise(planet.seed), vis = planet.visual || baseVisual(planet.type), key = planet.visualKey || planet.type;
    var h = new Float32Array(W * H), rough = new Float32Array(W * H), moist = new Float32Array(W * H);
    var x, y, i, sea = vis.sea, earth = null;
    /* 外观风格（与 visualParams 里取到的是同一套：同 seed 同 rnd 序列，且都用「现在」的年龄） */
    var st = surfStyle(planet, vis, ageGyrOf(planet, null));
    /* 真实天体（地球/月球/水星/火星/金星/小行星/KBO/彗核）沿用各自原有的公式，逐字不动；
       只有过程生成的行星走下面这套多尺度地形。 */
    var special = { earth: 1, moon: 1, mercury: 1, mars: 1, venus: 1, asteroid: 1, kbo: 1, comet: 1 }[key] ? 1 : 0;
    var cf = st.contFreq, wf = st.warpFreq, wa = st.warpAmp, rf = st.ridgeFreq, rvf = st.riftFreq;
    var basinSeed = (planet.seed ^ 0xBA51A0) >>> 0, raySeed = (planet.seed ^ 0x2A75) >>> 0;
    if (key === 'earth') earth = rasterEarth(W, H);
    var oceanFrac = { ocean: 0.9, living: 0.66, lava: 0.22 }[planet.type];
    return { planet: planet, W: W, H: H, y: 0, N: N, vis: vis, key: key, h: h, rough: rough, moist: moist,
      sea: sea, earth: earth, st: st, special: special, cf: cf, wf: wf, wa: wa, rf: rf, rvf: rvf,
      basinSeed: basinSeed, raySeed: raySeed, oceanFrac: oceanFrac };
  }
  function mapJobRows(J, y0, y1) {
    var planet = J.planet, W = J.W, H = J.H, N = J.N, vis = J.vis, key = J.key;
    var h = J.h, rough = J.rough, moist = J.moist, sea = J.sea, earth = J.earth, st = J.st;
    var special = J.special, cf = J.cf, wf = J.wf, wa = J.wa, rf = J.rf, rvf = J.rvf;
    var basinSeed = J.basinSeed, raySeed = J.raySeed, oceanFrac = J.oceanFrac;
    var x, y, i;
    if (vis.gas) {
      for (y = y0; y < y1; y++) for (x = 0; x < W; x++) { i = y * W + x; var lat = ((y + 0.5) / H - 0.5) * PI, lon = ((x + 0.5) / W - 0.5) * TAU, cl = Math.cos(lat); var nx = cl * Math.cos(lon), ny = Math.sin(lat), nz = -cl * Math.sin(lon); h[i] = 0.5 + 0.5 * N.fbm(nx * 4, ny * 4, nz * 4, 4); rough[i] = 0.5 + 0.5 * N.fbm(nx * 9 + 3, ny * 30, nz * 9, 3); moist[i] = 0.5; }
    } else {
      for (y = y0; y < y1; y++) {
        var lat = ((y + 0.5) / H - 0.5) * PI, cl = Math.cos(lat), sl = Math.sin(lat), v = (y + 0.5) / H, alat = Math.abs(lat) / (PI / 2);
        for (x = 0; x < W; x++) {
          i = y * W + x; var lon = ((x + 0.5) / W - 0.5) * TAU, u = (x + 0.5) / W;
          var nx = cl * Math.cos(lon), ny = sl, nz = -cl * Math.sin(lon), hh, rg = 0, mo = 0;
          var f1 = 0, f2 = 0, rd = 0, mask = 0;
          if (special) { f1 = N.fbm(nx * 2.3, ny * 2.3, nz * 2.3, 6); f2 = N.fbm(nx * 5.1 + 7, ny * 5.1, nz * 5.1 - 3, 5); rd = N.ridged(nx * 3.7 + 1, ny * 3.7, nz * 3.7 + 5, 5); mask = 0.5 + 0.5 * f1; }
          if (key === 'earth') {
            var L = earth.land[i], R = earth.range[i];
            var coast = clamp(L + 0.09 * f2 - 0.5, -0.5, 0.5); // 海岸线加噪声
            if (coast > 0) { hh = sea + 0.008 + coast * 0.05 + Math.max(0, f2) * 0.02 + R * 0.75 * (0.6 + 0.4 * rd) + Math.max(0, rd - 0.55) * 0.05; rg = clamp(0.28 + 0.5 * Math.max(0, rd - 0.35) + R * 2.2, 0, 1); }
            else { var shelf = smoothstep(-0.12, 0, coast); hh = sea - lerp(0.42 + 0.06 * rd, 0.01, shelf) - Math.max(0, f2) * 0.02 * (1 - shelf); rg = 0.15; }
            mo = 0.42 + 0.35 * f2 + 0.18 * (1 - alat) - 0.25 * Math.pow(Math.max(0, Math.cos(lat * 6.2)), 6) * (Math.abs(lat) > 0.3 && Math.abs(lat) < 0.65 ? 1 : 0);
            EARTH_DESERTS.forEach(function (d) { var dl = ((lon / DEG - d[0][0] + 540) % 360) - 180, dd = Math.sqrt(dl * dl * cl * cl + Math.pow(lat / DEG - d[0][1], 2)); mo -= 0.6 * Math.max(0, 1 - dd / d[1]); });
          } else if (key === 'moon' || key === 'mercury') {
            hh = 0.5 + 0.18 * f1 + 0.05 * f2 + craters(N, u, v, vis.craters || 1) * 1.6; if (key === 'moon' && f1 < -0.15) hh -= 0.06 * smoothstep(-0.15, -0.35, f1); rg = 0.5 + 0.3 * rd; mo = 0;
          } else if (key === 'mars') {
            var vol = Math.exp(-(Math.pow(((lon / DEG + 134 + 540) % 360 - 180) * cl, 2) + Math.pow(lat / DEG - 18, 2)) / 60), canyon = Math.exp(-Math.pow((lat / DEG + 12) / 2.2, 2)) * smoothstep(-95, -85, lon / DEG) * smoothstep(-40, -50, lon / DEG);
            hh = 0.5 + 0.2 * f1 + 0.08 * f2 + 0.12 * rd - 0.18 * (ny + 0.4) * 0.5 + vol * 0.42 - canyon * 0.16 + craters(N, u, v, 0.9) * 0.9; rg = clamp(0.3 + rd * 0.6 + vol, 0, 1); mo = 0;
          } else if (key === 'venus') {
            hh = 0.5 + 0.16 * f1 + 0.1 * f2 + 0.16 * Math.pow(rd, 1.5); rg = 0.3 + 0.5 * rd; mo = 0;
          } else if (key === 'asteroid' || key === 'kbo') {
            /* 小行星/柯伊伯带天体：撞击坑主导（没有大气与流水去抹平），大尺度起伏是碰撞碎裂留下的棱面，
               细节是碎石堆表面的砾石（隼鸟号在糸川上看到的就是一地砾石、几乎没有坑：Fujiwara et al. 2006） */
            hh = 0.5 + 0.17 * f1 + 0.09 * f2 + 0.11 * rd + craters(N, u, v, vis.craters || 1.6) * 2.0;
            // 粗糙度压低：这套细节噪声在 rough>0.6 时会切成脊状（山脉用），小行星要的是坑与砾石，不是满地尖刺
            rg = clamp(0.20 + 0.28 * rd, 0, 1); mo = 0;
          } else if (key === 'comet') {
            /* 彗核：坑不是撞击坑而是升华塌陷坑（罗塞塔在 67P 上看到的圆形凹坑与陡崖），
               坑底与低地铺着回落的尘埃（"尘埃池"），所以低处平滑、高处崎岖 */
            var pit = Math.max(0, rd - 0.42) * 1.9, cliff = Math.max(0, f2) * 0.14;
            hh = 0.5 + 0.19 * f1 + cliff - pit * 0.5 + craters(N, u, v, 0.55) * 1.1;
            rg = clamp(0.18 + 0.40 * Math.max(0, f1 + 0.2), 0, 1); mo = 0;
          } else {
            /* ============ 过程生成行星的多尺度地形 ============
               1) 低频：域扭曲 fBm（4 个八度）—— 板块 / 大陆 / 大洋盆地 / 大冰盖。域扭曲让海岸线蜿蜒，
                  不再是噪声的圆滚滚等值线；contFreq 由种子给，所以有的星球是两块超级大陆、有的是一串群岛。
               2) 中频：造山带只长在板块边界（低频场的零等值线附近）、裂谷沿同一条边界撕开、
                  盾状火山是少数几座孤峰、撞击盆地按表面年龄给数量。
               3) 细节：一律留给着色器的 detailN，并随距离淡入 —— 远看不出颗粒。 */
            var w0 = N.snoise(nx * wf + 11.3, ny * wf + 11.3, nz * wf + 11.3);
            var w1 = N.snoise(nx * wf + 37.1, ny * wf + 37.1, nz * wf + 37.1);
            var w2 = N.snoise(nx * wf + 63.7, ny * wf + 63.7, nz * wf + 63.7);
            var px = nx * cf + w0 * wa, py = ny * cf + w1 * wa, pz = nz * cf + w2 * wa;
            var g1 = N.fbm(px, py, pz, 4);                                       // 大陆 / 盆地（低频）
            var g2 = N.fbm(px * 3.1 + 7.7, py * 3.1 - 2.3, pz * 3.1 + 5.1, 3);   // 次级起伏（中低频）
            var pl = N.fbm(px * 1.55 + 31.7, py * 1.55 - 13.3, pz * 1.55 + 27.1, 3);   // 板块拼图（与大陆分布无关的另一个场）
            var edge = smoothstep(0.26, 0.02, Math.abs(pl));                     // 板块边界带：一条线，不是半个星球
            var gr = N.ridged(px * rf / cf + 3.3, py * rf / cf - 1.7, pz * rf / cf + 9.1, 4);
            /* 造山带只往**陆地那一侧**隆起：山脊来回穿过海平面就会把海岸线切成等高线迷宫 */
            var belt = gr * edge * st.ridgeAmt * smoothstep(-0.02, 0.22, g1);
            var rl = N.snoise(px * rvf / cf + 21.5, py * rvf / cf + 21.5, pz * rvf / cf + 21.5);
            var rift = smoothstep(0.955, 0.998, 1 - Math.abs(rl)) * (0.35 + 0.65 * edge) * st.riftAmt;
            var bs = st.basinN ? basinsAt(basinSeed, nx, ny, nz, st.basinN) : ZERO_BASIN;
            var cr = (vis.craters && st.craterDens > 0.02) ? craters(N, u, v, st.craterDens) : 0;
            var mk = 0.5;
            switch (planet.type) {
              case 'rock': {
                hh = 0.5 + 0.22 * g1 + 0.055 * g2 + 0.13 * belt + bs.h + cr - rift * 0.035;
                /* 月海：大盆地底与低洼处被后期玄武岩填平 —— 又平又暗。粗糙度跟着下来，近看才不是一地碎石。 */
                var mare = st.mareAmt * clamp(bs.inBasin * 0.8 + smoothstep(-0.10, -0.42, g1) * 0.7, 0, 1);
                hh += mare * 0.02;
                rg = clamp(0.12 + 0.62 * gr * edge + 0.22 * Math.max(0, g2) - mare * 0.45, 0.02, 1);
                mk = clamp(0.5 + raysAt(N, raySeed, nx, ny, nz, st.basinN + 2, st.rayAmt) * 0.5 - mare * 0.5, 0, 1);
                break; }
              case 'desert': {
                /* 台地：把海拔量化成几级，形成层层叠叠的方山；干河谷沿低处切开 */
                var mesa = Math.floor(clamp(g1 * 0.5 + 0.5, 0, 0.999) * 5) / 5;
                var wadi = smoothstep(0.90, 0.995, 1 - Math.abs(N.snoise(px * 6.1 + 4.4, py * 6.1 + 4.4, pz * 6.1 + 4.4)));
                hh = 0.5 + 0.14 * g1 + 0.09 * mesa + 0.05 * g2 + 0.09 * belt + bs.h * 0.5 + cr * 0.7 - wadi * 0.03;
                /* 沙海：低洼处 + 信风带（|纬度| ≈ 20–30°）。沙海是平的，粗糙度压到很低。 */
                var erg = clamp(smoothstep(0.18, -0.32, g1) * 0.75 + 0.55 * Math.exp(-Math.pow((alat - 0.30) / 0.20, 2)), 0, 1) * st.duneAmt;
                hh -= erg * 0.012;
                rg = clamp(0.16 + 0.55 * gr * edge + 0.2 * Math.max(0, g2) - erg * 0.5, 0.02, 1);
                mk = clamp(erg, 0, 1); mo = 0.1;
                break; }
              case 'ice': {
                /* 冰壳：大片平滑冰原（低频起伏很小），少量长裂谷（沿一条构造带，不是满球蜘蛛网），
                   极区冰更厚（所以更高）。粗糙度整体压低 —— 冰原就该是光的。 */
                var prov = smoothstep(0.15, 0.6, 0.5 + 0.5 * N.snoise(px * 0.8 + 5.5, py * 0.8 + 5.5, pz * 0.8 + 5.5));
                var gash = smoothstep(0.945, 0.999, 1 - Math.abs(rl)) * prov * st.crackAmt;
                hh = 0.5 + 0.085 * g1 + 0.025 * g2 + 0.05 * belt + bs.h * 0.7 + cr * 0.55 - gash * 0.055 + alat * alat * 0.045;
                rg = clamp(0.05 + 0.30 * gr * edge + 0.18 * gash + 0.10 * Math.max(0, g2), 0.02, 0.8);
                /* 沉积暗斑：喷流落回冰面的有机/尘埃物质，聚在裂缝两侧与低洼处 */
                mk = clamp(st.plumeAmt * (gash * 1.0 + smoothstep(-0.10, -0.48, g1) * 0.55) + bs.inBasin * 0.30, 0, 1);
                break; }
              case 'lava': {
                hh = 0.5 + 0.20 * g1 + 0.09 * g2 + 0.11 * belt - rift * 0.05;
                rg = clamp(0.25 + 0.55 * gr * edge + 0.25 * Math.max(0, g2), 0.02, 1);
                /* 壳龄：0 = 刚翻新（裂缝/熔岩湖），1 = 已经冷透的暗壳 */
                mk = clamp(1 - (rift * 1.2 + smoothstep(0.05, -0.4, g1) * st.lakeAmt * 0.9 + edge * 0.35), 0, 1);
                break; }
              case 'ocean': {
                /* 大洋世界：海底盆地深而平，零星岛弧沿板块边界冒头 —— 海岸线因此是清楚的弧线，不是散点 */
                var arc = Math.pow(Math.max(0, gr), 2.2) * edge * smoothstep(-0.30, 0.10, g1);   // 岛弧：贴着板块边界的陆侧冒头
                hh = 0.5 + 0.26 * g1 + 0.07 * g2 + 0.22 * arc + bs.h * 0.4;
                rg = clamp(0.10 + 0.75 * arc + 0.15 * Math.max(0, g2), 0.02, 1);
                mo = clamp(0.62 + 0.28 * g2 + 0.12 * (1 - alat), 0, 1);
                mk = mo;
                break; }
              default: {  /* living */
                hh = 0.5 + 0.26 * g1 + 0.06 * g2 + 0.13 * belt + bs.h * 0.3 - rift * 0.03;
                rg = clamp(0.10 + 0.72 * gr * edge + 0.2 * Math.max(0, g2), 0.02, 1);
                /* 湿度：赤道辐合带湿、副热带（|纬度|≈25°）干、中纬再湿；再叠一层大尺度的雨影 */
                var zonal = 0.55 + 0.42 * Math.cos(alat * PI * 2.6 + st.biomeShift * 4.0) - 0.30 * Math.exp(-Math.pow((alat - 0.30) / 0.16, 2));
                var shadow = 0.22 * smoothstep(0.25, 0.75, gr * edge);           // 山脉背风面的雨影
                mo = clamp(zonal + 0.26 * g2 - shadow, 0, 1);
                mk = mo;
                break; }
            }
            if (planet.type !== 'ocean' && planet.type !== 'living') mo = mk;      // 无水世界：A 通道改记「标记场」，含义见各分支
          }
          h[i] = hh; rough[i] = clamp(rg, 0, 1); moist[i] = clamp(mo, 0, 1);
        }
      }
    }
  }
  function mapJobFinish(J) {
    var planet = J.planet, W = J.W, H = J.H, N = J.N, vis = J.vis, key = J.key;
    var h = J.h, rough = J.rough, moist = J.moist, sea = J.sea, oceanFrac = J.oceanFrac, i;
    if (!vis.gas) {
      // 归一化：非地球行星把海平面对齐到 vis.sea（按海洋覆盖率取分位数），整体压到 0..1
      var mn = Infinity, mx = -Infinity; for (i = 0; i < h.length; i++) { if (h[i] < mn) mn = h[i]; if (h[i] > mx) mx = h[i]; }
      if (key !== 'earth') {
        if (sea > 0 && oceanFrac) {
          var samp = []; for (i = 0; i < h.length; i += 5) samp.push(h[i]); samp.sort(function (a, b) { return a - b; });
          var q = samp[Math.floor(samp.length * oceanFrac)];
          for (i = 0; i < h.length; i++) h[i] = h[i] < q ? sea * (h[i] - mn) / Math.max(1e-6, q - mn) : sea + (1 - sea) * (h[i] - q) / Math.max(1e-6, mx - q);
        } else { for (i = 0; i < h.length; i++) h[i] = (h[i] - mn) / Math.max(1e-6, mx - mn); }
      } else { for (i = 0; i < h.length; i++) h[i] = clamp(h[i], 0, 1); }
    }
    // 打包 RGBA8：R,G = 16 位高度；B = 粗糙度；A = 湿度。CPU 侧同时保留量化后的高度以与 GPU 完全一致
    var data = new Uint8Array(W * H * 4), hq = new Float32Array(W * H);
    for (i = 0; i < W * H; i++) { var q16 = Math.round(clamp(h[i], 0, 1) * 65535); hq[i] = q16 / 65535; data[i * 4] = q16 >> 8; data[i * 4 + 1] = q16 & 255; data[i * 4 + 2] = Math.round(rough[i] * 255); data[i * 4 + 3] = Math.round(moist[i] * 255); }
    return { W: W, H: H, h: hq, rough: rough, moist: moist, data: data, noise: N, planetSeed: planet.seed };
  }
  /* 同步版：Node 侧与任何「就要结果」的调用走这里，行为与从前逐字节相同。 */
  function buildMaps(planet, W, H) {
    var J = mapJobStart(planet, W, H);
    mapJobRows(J, 0, H);
    return mapJobFinish(J);
  }

  // 双线性采样（与 GLSL mapSample 一致）：返回 [h, rough, moist]
  function sampleMap(m, u, v) {
    var W = m.W, H = m.H, fx = u * W - 0.5, fy = clamp(v * H - 0.5, 0, H - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);   // 与 GLSL mapSample 一致的 Hermite 权重
    var x1 = ((x0 + 1) % W + W) % W, y1 = Math.min(y0 + 1, H - 1); x0 = ((x0 % W) + W) % W; y0 = clamp(y0, 0, H - 1);
    var i00 = y0 * W + x0, i10 = y0 * W + x1, i01 = y1 * W + x0, i11 = y1 * W + x1;
    function bl(a) { return lerp(lerp(a[i00], a[i10], tx), lerp(a[i01], a[i11], tx), ty); }
    return [bl(m.h), bl(m.rough), bl(m.moist)];
  }

  /* ---------------------------------------------------------- 调色板（128×64 RGBA：x = 海拔 0..1，y = 气候 0 热 → 1 冷） */
  var PAL_STOPS_BASE = {
    rock: [[0, '#5e564f'], [0.3, '#7d746a'], [0.6, '#9c948a'], [1, '#c8c2b8']],
    venus: [[0, '#5a4a3a'], [0.4, '#7a6448'], [0.8, '#9a8560'], [1, '#b0a070']],
    desert: [[0, '#b8925c'], [0.3, '#cfa86c'], [0.65, '#a37c4e'], [1, '#e8d7ae']],
    mars: [[0, '#8a4526'], [0.35, '#ad6236'], [0.7, '#c58656'], [1, '#d9a880']],
    ocean: [[0, '#c9bf98'], [0.15, '#7c8a5a'], [0.6, '#6c665a'], [1, '#d8d8d0']],
    ice: [[0, '#9db7cc'], [0.4, '#cfdde8'], [0.8, '#eaf1f6'], [1, '#ffffff']],
    lava: [[0, '#1c1614'], [0.4, '#332a26'], [0.8, '#4d4139'], [1, '#6b5c52']],
    earth: [[0, '#b8ab7c'], [0.06, '#a2905f'], [0.35, '#8c7f5c'], [0.7, '#726c63'], [1, '#8f8a84']],
    /* 小天体：反照率是实测量级 —— S 型小行星 ~0.20、C 型 ~0.06（Tedesco 2002 IRAS 巡天），
       柯伊伯带天体表面被托林染红（Cruikshank 2005），彗核只有 ~0.04，是太阳系里最黑的一类表面（Keller 1986，乔托号） */
    regolith: [[0, '#33302b'], [0.35, '#4e483f'], [0.7, '#6a6153'], [1, '#8b8072']],   // C 型：暗碳质风化层
    regolithS: [[0, '#5b4f40'], [0.35, '#7d6d56'], [0.7, '#9d8a6e'], [1, '#c0ad8d']],  // S 型：偏亮的硅酸盐
    kbo: [[0, '#4a3830'], [0.3, '#6d5240'], [0.65, '#967253'], [1, '#c2a184']],        // 托林红
    comet: [[0, '#14120f'], [0.4, '#231f1a'], [0.75, '#332c25'], [1, '#463d33']]        // 反照率 0.04：几乎全黑
  };
  /* ---------------------------------------------------------- 同类型的多套调色板（由行星种子选）
     每类 4–6 套「裸地/基岩」色阶。植被、冰、熔岩仍由着色器叠在上面，所以这里只管底色。
     真实天体（visualKey 非空：地球/火星/金星/月球…）一律走第 0 套 —— 它们的样子不能被种子改掉。 */
  var PAL_VARIANTS = {
    rock: [
      PAL_STOPS_BASE.rock,
      [[0, '#3b3530'], [0.3, '#57493d'], [0.62, '#7d6350'], [1, '#a8886b']],   // 铁红尘的暗玄武
      [[0, '#6e6a63'], [0.32, '#8f8b82'], [0.66, '#b4b0a6'], [1, '#e2ded4']],  // 斜长岩高地：亮灰白
      [[0, '#4a4234'], [0.3, '#736232'], [0.65, '#9c8b46'], [1, '#c9bc84']],   // 含硫黄褐
      [[0, '#1d1c1b'], [0.35, '#2e2c29'], [0.7, '#45413b'], [1, '#635d54']],   // 暗碳质：几乎不反光
      [[0, '#4d4247'], [0.3, '#6b5b62'], [0.62, '#8e7c82'], [1, '#bdaeb2']]    // 偏紫灰的辉石
    ],
    desert: [
      PAL_STOPS_BASE.desert,
      [[0, '#9c5233'], [0.3, '#bd6f40'], [0.65, '#8f5330'], [1, '#e0a878']],   // 赭红
      [[0, '#c6bda8'], [0.32, '#e0d8c4'], [0.68, '#b3a88e'], [1, '#f2ecdd']],  // 石膏白沙
      [[0, '#6b5340'], [0.28, '#a8763f'], [0.6, '#4e433a'], [1, '#d9b47c']],   // 橙褐沙 + 暗玄武沙海
      [[0, '#d8c583'], [0.3, '#efe0a4'], [0.62, '#b8a262'], [1, '#fdf6df']]    // 淡黄沙 + 白盐滩
    ],
    ocean: [
      PAL_STOPS_BASE.ocean,
      [[0, '#6d6157'], [0.15, '#3f3a35'], [0.6, '#565049'], [1, '#c8c4bc']],   // 火山黑岛
      [[0, '#e6dcc2'], [0.16, '#c3bda0'], [0.6, '#8d8874'], [1, '#efeee8']],   // 石灰岩/珊瑚岛
      [[0, '#c28a5e'], [0.16, '#8c6a45'], [0.6, '#6d6152'], [1, '#d6cfc2']]    // 红壤岛
    ],
    /* 冰：主色必须是白 / 浅蓝 / 青 —— 褐色只允许以「沉积暗斑」的形式局部出现（见着色器里的 uDepositC）。
       六套里只有第 4 套（尘埃脏冰）偏灰，其余五套一眼是冰。 */
    ice: [
      PAL_STOPS_BASE.ice,                                                       // 0 蓝白冰盖 + 深蓝裂谷
      [[0, '#e6eef5'], [0.35, '#f2f7fb'], [0.75, '#fafcfe'], [1, '#ffffff']],   // 1 纯白（欧罗巴式：裂纹是红褐的，冰面是白的）
      [[0, '#e9dfe2'], [0.35, '#f6eeef'], [0.75, '#fdf8f7'], [1, '#ffffff']],   // 2 氮冰粉白（冥王星式的心形平原）
      [[0, '#a9cfd2'], [0.35, '#cfe6e8'], [0.75, '#ecf7f8'], [1, '#fbffff']],   // 3 甲烷冰浅青
      [[0, '#7f8a95'], [0.4, '#a6b1bb'], [0.8, '#cdd6dd'], [1, '#eef2f5']],     // 4 尘埃污染的脏冰（唯一偏灰的一套）
      [[0, '#8f9cc0'], [0.4, '#c0c8de'], [0.8, '#e6eaf5'], [1, '#ffffff']]      // 5 偏紫蓝的深冷冰
    ],
    lava: [
      PAL_STOPS_BASE.lava,
      [[0, '#241210'], [0.4, '#3d1c17'], [0.8, '#5a2c22'], [1, '#7a453a']],    // 暗红玄武
      [[0, '#1a1a18'], [0.4, '#3a3728'], [0.8, '#6b6038'], [1, '#9b8a46']],    // 灰黑 + 硫黄结壳
      [[0, '#1f1713'], [0.4, '#392b20'], [0.8, '#57412f'], [1, '#7d6248']]     // 深棕
    ],
    earth: [
      PAL_STOPS_BASE.earth,
      [[0, '#b08a64'], [0.06, '#9a704a'], [0.35, '#87654a'], [0.7, '#6f6259'], [1, '#8d8681']], // 红壤
      [[0, '#a8a596'], [0.06, '#93917f'], [0.35, '#7e7d70'], [0.7, '#6c6b66'], [1, '#93928d']], // 灰岩
      [[0, '#c6b784'], [0.06, '#b0a067'], [0.35, '#948a5e'], [0.7, '#77736a'], [1, '#95918a']], // 黄壤
      [[0, '#8e8c66'], [0.06, '#7b7a55'], [0.35, '#6c6c52'], [0.7, '#63625a'], [1, '#86847e']]  // 暗橄榄
    ]
  };

  function palStopsOf(vp) {
    var vars = PAL_VARIANTS[vp.palette];
    if (vars && vars.length) return vars[clamp(Math.round(vp.palVar || 0), 0, vars.length - 1)] || vars[0];
    return PAL_STOPS_BASE[vp.palette] || PAL_STOPS_BASE.rock;
  }

  /* ---------------------------------------------------------- 每颗行星的外观风格
     铁律：全部从 planet.seed（与行星自己的物理量）派生，不掺相机、不掺时间、不用 Math.random。
     同一个定位码 → 同一个 seed → 同一套 style → 同一张贴图、同一组着色器 uniform → 逐像素一致。
     这里只决定「画成什么样」，一个物理量都不产生、也不修改。 */
  var SURF_KIND = { rock: 0, desert: 1, ocean: 2, ice: 3, lava: 4, living: 5, earth: 5, gas: 6 };
  function surfStyle(planet, vp, ageGyr) {
    var seed = (planet.seed >>> 0), real = !!planet.visualKey, rnd = mulberry32(hash32(seed ^ 0x5A17E5));
    var kind = SURF_KIND[planet.type] != null ? SURF_KIND[planet.type] : 0;
    var vars = PAL_VARIANTS[vp.palette], nVar = vars ? vars.length : 1;
    var st = { kind: kind, palVar: real ? 0 : Math.floor(rnd() * nVar) * 1 };
    st.palVar = clamp(st.palVar, 0, nVar - 1);
    /* 冰世界：越冷越往蓝白那几套靠（甲烷/氮在很低温下才铺得住；靠近升华线的那些反而更脏）。
       只是把「种子选出来的序号」按温度重映射一次，仍然是查表，仍然完全确定性。 */
    if (kind === 3 && !real && nVar >= 6) {
      var TK = isFinite(planet.tempK) ? planet.tempK : 120;
      var remap = TK < 90 ? [1, 2, 5, 1, 3, 5] : TK < 150 ? [0, 1, 2, 3, 5, 5] : [0, 3, 4, 0, 3, 5];
      st.palVar = remap[st.palVar];
    }
    /* 大尺度：大陆/板块的特征尺度（小 = 少数几块超级大陆，大 = 许多小陆块）与域扭曲强度（海岸线的蜿蜒程度） */
    st.contFreq = 1.05 + rnd() * 1.75;
    st.warpAmp = 0.10 + rnd() * 0.42;
    st.warpFreq = 1.4 + rnd() * 2.2;
    /* 中尺度：造山带（只长在板块边界上）、裂谷、盾状火山 */
    st.ridgeFreq = 2.6 + rnd() * 4.6;
    st.ridgeAmt = 0.45 + rnd() * 0.85;
    st.riftFreq = 1.8 + rnd() * 2.6;
    st.riftAmt = rnd();
    st.volcN = Math.floor(rnd() * 5);
    /* 撞击盆地：数量随「表面年龄」上升；有大气/有水/在熔融的世界会把坑抹掉 */
    var renew = (planet.type === 'lava') ? 0.08 : (planet.type === 'ocean' || planet.type === 'living' || planet.type === 'earth') ? 0.18
      : (planet.type === 'desert') ? 0.55 : (planet.type === 'ice') ? 0.7 : 1.0;
    var age = isFinite(ageGyr) ? clamp(ageGyr, 0, 13) : 4.5;
    st.craterDens = clamp((vp.craters || 0) * renew * (0.22 + age / 4.0), 0, 1.0);
    st.basinN = Math.min(6, Math.round(st.craterDens * (1.2 + rnd() * 2.6)));
    st.rayAmt = clamp(st.craterDens * (0.35 + rnd() * 0.65), 0, 1);      // 辐射纹（年轻坑才有）
    st.mareAmt = (kind === 0 && !real) ? rnd() * 0.85 : 0;               // 月海式暗色平原
    /* 沙漠：主风向（沙丘脊垂直于风向）与沙海密度 */
    st.duneDir = rnd() * PI; st.duneFreq = 22 + rnd() * 46; st.duneAmt = 0.35 + rnd() * 0.65;
    /* 冰：裂谷条数（少而长）、极冠范围（由温度给，见下）、喷流沉积暗斑 */
    st.crackAmt = 0.25 + rnd() * 0.75; st.plumeAmt = rnd() * 0.8;
    /* 云：云量与气旋尺度 */
    st.cloudMul = 0.55 + rnd() * 0.95; st.cycloneF = 0.7 + rnd() * 1.1;
    /* 海洋：洋流色差与浅海带宽度 */
    st.currentAmt = 0.3 + rnd() * 0.7; st.shelfW = 0.012 + rnd() * 0.030;
    /* 生命世界：生物群区带宽、雨林偏移 */
    st.biomeShift = (rnd() - 0.5) * 0.22; st.biomeSharp = 0.5 + rnd() * 0.9;
    /* 熔岩：裂缝网密度与熔岩湖数量 */
    st.fissureF = 12 + rnd() * 26; st.lakeAmt = 0.2 + rnd() * 0.8;
    /* 巨行星：云带条数 / 带纹湍流 / 风暴个数 / 极区结构 */
    st.bandN = 9 + Math.floor(rnd() * 10);          // 9–18 条
    st.bandTurb = 0.45 + rnd() * 0.75;
    st.stormN = 1 + Math.floor(rnd() * 3);          // 1–3 个风暴斑
    st.hexPole = rnd() < 0.22 ? 1 : 0;              // 极区六边形（土星式）偶尔出现
    st.darkPole = 0.25 + rnd() * 0.6;
    st.ringDense = 0.35 + rnd() * 0.6;
    /* 真实天体（地球/火星/木星…）：与「认得出这是哪一颗」有关的几项按定值，不让种子改掉。 */
    if (real) { st.biomeShift = 0; st.biomeSharp = 1.0; st.cycloneF = 1.0; st.cloudMul = 1.0; st.mareAmt = (planet.visualKey === 'moon') ? 0.85 : 0;
      st.shelfW = 0.018; st.currentAmt = 0.45; }   // 地球的大陆架与洋流按定值：认得出来的海岸线不交给种子
    st.heatK = clamp(((isFinite(planet.tempK) ? planet.tempK : 1200) - 700) / 1200, 0, 1);   // 熔岩世界的亮度档
    /* 这颗行星在那张公共细节贴图里的取样偏移：同一张贴图，靠偏移长出不同的星球 */
    st.detOff = [rnd() * 7.13, rnd() * 5.77, rnd() * 9.31];
    st.storms = [];
    for (var i = 0; i < 3; i++) {
      st.storms.push([(rnd() * 2 - 1) * PI, (rnd() * 1.3 - 0.65), 0.05 + rnd() * 0.13, 0.35 + rnd() * 0.65, rnd() < 0.5 ? -1 : 1]);
    }
    /* 巨行星带内的子带：每条带里再分 3–8 条细条纹（条数与相位随种子） */
    st.subBands = 3 + Math.floor(rnd() * 6);
    st.subPhase = rnd() * TAU;
    return st;
  }

  function gradAt(stops, x) { if (x <= stops[0][0]) return rgb(stops[0][1]); for (var i = 1; i < stops.length; i++) if (x <= stops[i][0]) { var t = (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]); return mix3(rgb(stops[i - 1][1]), rgb(stops[i][1]), t); } return rgb(stops[stops.length - 1][1]); }
  /* 纬向云带的颜色表。太阳系四颗巨行星走各自硬编码的分支（逐位不变）；
     过程生成的巨行星走 generic 分支：色相 + 饱和度 + 亮带明度 + 明暗带对比都由 gasCloudClass 给
     （vp.gasSat/gasLight/gasContrast/gasHueJit）。这几项缺省为 null 时退回旧公式，
     所以冰巨星（"保持原有处理"）与任何没有分类结果的对象（流浪行星等）画出来与以前一致。 */
  function gasBands(vp, seed) {
    var rnd = mulberry32(seed ^ 0x6A5), bands = [], style = vp.gasStyle, hue = vp.hue, y = 0;
    var sat = vp.gasSat, lgt = vp.gasLight, con = vp.gasContrast, jit = vp.gasHueJit != null ? vp.gasHueJit : 24;
    var tho = vp.tholin || 0, thoC = vp.tholinColor || [0.74, 0.42, 0.34];
    /* 条数：太阳系四颗用各自的定值（样子要认得出），其余由行星种子给 7–17 条。上限 20 —— 着色器的带表就是 20 个槽。
       明暗对比留一个下限：第 III–V 类本来就「几乎看不出带纹」，但完全没有结构就成了一个磨砂球，
       所以只把亮度差托到 0.22，色相仍按分类走（另有一道按反照率的显示曝光补偿，见 materialUniforms 的 gexp）（偏离真实反照率的程度写在 HUD 的云顶说明里）。 */
    var nFix = { jupiter: 16, saturn: 14, uranus: 8, neptune: 9 }[style];
    var nB = clamp(Math.round(nFix || ((vp.style && vp.style.bandN) || 11)), 4, 20);
    if (con != null) con = Math.max(con, 0.22);
    var ws = [], wsum = 0, bi;
    for (bi = 0; bi < nB; bi++) { var wv = 0.62 + rnd() * 0.80; ws.push(wv); wsum += wv; }
    for (bi = 0; bi < nB; bi++) { var w = ws[bi] / wsum, c; var lightBand = bi % 2 === 0;
      if (style === 'jupiter') c = lightBand ? mix3([0.9, 0.85, 0.75], [0.96, 0.92, 0.85], rnd()) : mix3([0.66, 0.5, 0.36], [0.82, 0.62, 0.42], rnd());
      else if (style === 'saturn') c = lightBand ? [0.93, 0.87, 0.68] : mix3([0.82, 0.74, 0.55], [0.88, 0.8, 0.62], rnd());
      else if (style === 'uranus') c = lightBand ? [0.72, 0.87, 0.9] : [0.66, 0.84, 0.88];
      else if (style === 'neptune') c = lightBand ? [0.28, 0.42, 0.85] : [0.2, 0.32, 0.72];
      else if (sat != null) c = hsl(hue + (rnd() - 0.5) * jit, clamp(sat + (rnd() - 0.5) * 0.08, 0, 1), clamp((lightBand ? lgt : lgt - con) + (rnd() - 0.5) * con * 0.5, 0.02, 0.97));
      else c = hsl(hue + (rnd() - 0.5) * 24, 0.35 + rnd() * 0.3, lightBand ? 0.6 + rnd() * 0.2 : 0.35 + rnd() * 0.15);
      /* 托林雾霾盖在云带之上：整层朝托林色混，亮带混得多一点（薄云上的雾霾更显色），
         暗带本来就暗、混上去看不出。这一步只在 vp.tholin > 0 时发生（太阳系四颗巨行星恒为 0）。 */
      if (tho > 0) c = mix3(c, thoC, clamp(tho * (lightBand ? 0.88 : 0.7), 0, 0.92));
      bands.push({ y0: y, y1: Math.min(1, y + w), c: c }); y += w; }
    bands[bands.length - 1].y1 = 1;
    return bands;
  }
  function buildPalette(planet, vp) {
    var W = 128, H = 64, out = new Uint8Array(W * H * 4), x, y, c;
    var tho = vp.tholin || 0, thoC = vp.tholinColor || [0.74, 0.42, 0.34];
    if (vp.gas) {
      var bands = gasBands(vp, planet.seed);
      for (y = 0; y < H; y++) { var by = y / H, b = bands[0]; for (var k = 0; k < bands.length; k++) if (by >= bands[k].y0 && by < bands[k].y1) b = bands[k];
        for (x = 0; x < W; x++) { var t = x / W; c = mix3(b.c, mix3(b.c, [1, 1, 1], 0.25), t); var i = (y * W + x) * 4; out[i] = c[0] * 255; out[i + 1] = c[1] * 255; out[i + 2] = c[2] * 255; out[i + 3] = 255; } }
      return { data: out, W: W, H: H };
    }
    var stops = palStopsOf(vp);
    /* 冰面上的托林不该把整颗星球染成褐色：那是覆盖率很高时才成立的极端情形。
       这里整张色板最多只混 0.18，余下的量交给着色器按「沉积场」局部上色（面积远小于整球）。 */
    if (vp.palette === 'ice') tho = Math.min(tho, 0.18);
    for (y = 0; y < H; y++) { var climate = y / (H - 1);
      for (x = 0; x < W; x++) { var e = x / (W - 1); c = gradAt(stops, e);
        if (vp.palette === 'mars') c = mix3(c, [0.75, 0.55, 0.45], climate * 0.4);
        if (vp.palette === 'desert') c = mix3(c, [0.85, 0.8, 0.7], climate * 0.5);
        if (vp.palette !== 'lava' && vp.palette !== 'ice') { var snowLine = lerp(1.15, 0.3, climate), snow = smoothstep(snowLine, snowLine + 0.2, e) * (vp.palette === 'venus' ? 0 : vp.palette === 'mars' ? smoothstep(0.75, 0.95, climate) : 1); c = mix3(c, [0.95, 0.96, 0.98], snow); }
        /* 托林沉积：盖在整个冰面上的一层有机物。低洼处（e 小）积得厚一点、被撞击翻新的高处薄一点，
           所以按高度略作调制 —— 冥王星的 Sputnik Planitia 是亮的，周围的 Cthulhu Macula 才是深红。 */
        if (tho > 0) c = mix3(c, thoC, clamp(tho * (0.55 + 0.45 * (1 - e)), 0, 0.9));
        var i2 = (y * W + x) * 4; out[i2] = c[0] * 255; out[i2 + 1] = c[1] * 255; out[i2 + 2] = c[2] * 255; out[i2 + 3] = 255; } }
    return { data: out, W: W, H: H };
  }

  /* ============================================================ GLSL（WebGL2 / ES 3.00） */
  var GLSL_HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp usampler2D;\n';
  // 与 CPU 完全一致的 Simplex 3D（置换表来自 uPerm，RGBA8UI）
  var GLSL_NOISE = [
    /* SURFKIND：这个程序专门为哪一种地表编的（-1 = 通用，运行期判断）。
       球面视图那几个程序各自 #define 一个值，用不到的分支在预处理阶段就被裁掉。 */
    '#ifndef SURFKIND',
    '#define SURFKIND -1',
    '#endif',
    'uniform highp usampler2D uPerm;',
    'vec4 permAt(float i){ uvec4 t=texelFetch(uPerm, ivec2(int(mod(i,256.0)),0),0); return vec4(vec3(t.rgb)-1.0, float(t.a)); }',
    'float snoise(vec3 v){',
    '  float s=(v.x+v.y+v.z)*(1.0/3.0); vec3 i=floor(v+s); float t=(i.x+i.y+i.z)*(1.0/6.0); vec3 x0=v-i+t;',
    /* 角点排序的无分支写法。与上面那棵 if/else 树**逐位等价**（step 用的也是 >=，平局的走向一样），
       但少了六路分支 —— snoise 在一个片元着色器里要内联上百次，那棵树是 FXC 优化时间的大头。
       CPU 侧（makeNoise 里的 snoise）保持 if/else 原样，两边结果仍然一致。 */
    '  vec3 gg=step(x0.yzx, x0.xyz); vec3 ll=1.0-gg; vec3 i1=min(gg, ll.zxy), i2=max(gg, ll.zxy);',
    '  vec3 x1=x0-i1+(1.0/6.0), x2=x0-i2+(2.0/6.0), x3=x0-0.5; vec3 ii=mod(i,256.0);',
    '  vec4 g0=permAt(ii.x+permAt(ii.y+permAt(ii.z).a).a);',
    '  vec4 g1=permAt(ii.x+i1.x+permAt(ii.y+i1.y+permAt(ii.z+i1.z).a).a);',
    '  vec4 g2=permAt(ii.x+i2.x+permAt(ii.y+i2.y+permAt(ii.z+i2.z).a).a);',
    '  vec4 g3=permAt(ii.x+1.0+permAt(ii.y+1.0+permAt(ii.z+1.0).a).a);',
    '  vec4 t4=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); t4*=t4;',
    '  return 32.0*dot(t4*t4, vec4(dot(g0.xyz,x0),dot(g1.xyz,x1),dot(g2.xyz,x2),dot(g3.xyz,x3)));',
    '}'
  ].join('\n');
  // 高度场：贴图双线性 + 细节噪声 + 漂移扭曲（与 CPU fieldAtCPU 一致）
  var GLSL_FIELD = [
    'uniform sampler2D uMap; uniform vec2 uMapSize;',
    'uniform float uSea, uHRef, uHRange, uPlanetR, uDetailAmp, uDetailFreq, uDrift; uniform int uOct;',
    /* uOctF：最细那一个八度的权重（0..1）。球面视图按到相机的距离连续给，细节因此是**淡入淡出**
       而不是整档跳出来；地表飞越一律给 1.0，与 CPU 的 fieldAtCPU 逐位一致（那里没有这一项）。 */
    'uniform float uOctF;',
    'vec3 decMap(vec4 t){ return vec3((floor(t.r*255.0+0.5)*256.0+floor(t.g*255.0+0.5))/65535.0, t.b, t.a); }',
    'vec3 mapSample(vec2 uv){',
    '  float fx=uv.x*uMapSize.x-0.5, fy=clamp(uv.y*uMapSize.y-0.5,0.0,uMapSize.y-1.0); float x0f=floor(fx), y0f=floor(fy); float tx=fx-x0f, ty=fy-y0f;',
    '  tx=tx*tx*(3.0-2.0*tx); ty=ty*ty*(3.0-2.0*ty);',
    '  int W=int(uMapSize.x), H=int(uMapSize.y); int x0=int(mod(x0f,uMapSize.x)); int x1=(x0+1)%W; int y0=int(y0f); int y1=min(y0+1,H-1);',
    '  vec3 a=decMap(texelFetch(uMap,ivec2(x0,y0),0)), b=decMap(texelFetch(uMap,ivec2(x1,y0),0)), c=decMap(texelFetch(uMap,ivec2(x0,y1),0)), d=decMap(texelFetch(uMap,ivec2(x1,y1),0));',
    '  return mix(mix(a,b,tx),mix(c,d,tx),ty); }',
    'vec2 sph2uv(vec3 n){ return vec2(atan(-n.z,n.x)/6.2831853+0.5, asin(clamp(n.y,-1.0,1.0))/3.14159265+0.5); }',
    'vec3 warpN(vec3 n){ if(uDrift<=0.0) return n; vec3 c=vec3(0.94,0.0,-0.34); vec3 w=vec3(snoise(n*1.7+7.1),snoise(n*1.7+3.3),snoise(n*1.7+11.7)); return normalize(n+(n-c)*uDrift*1.2+w*uDrift*0.35); }',
    /* 幅度谱：各倍频按 DETAIL_GAIN 衰减（分形维 H = −log g / log lac ≈ 0.76，接近真实地形）。
       以前是「前 8 个倍频等幅」——那等于把最细的 74 m 尺度也给足几百米振幅，满地全是尖刺；
       旧代码靠「按到相机的距离砍倍频」把尖刺藏起来，代价就是镜头一动地形自己变形。
       现在倍频数固定、幅度收敛：最细一档只剩几米，砍不砍都看不出来，也就不需要相机相关的 LOD 了。
       DETAIL_BOOST 让总起伏的均方根与旧口径持平（地形分类的阈值、山脉的量级都不用改）。 */
    /* DETAIL_MAX：展开这个循环的上限。球面视图那条路的倍频数最高只给到 6（见 drawGlobe），
       但循环按 12 展开的话，FXC 要多内联一大堆 snoise —— globe 那个片元着色器实测要编 40 秒，
       第一次用到它的时候主线程就钉在驱动里等着，用户点「随机一颗」卡死就是这么来的。
       给球面视图的程序 #define DETAIL_MAX 6，输出逐像素不变（循环本来也跑不到第 7 次）。 */
    '#ifndef DETAIL_MAX',
    '#define DETAIL_MAX 12',
    '#endif',
    'const float DETAIL_GAIN=0.55, DETAIL_BOOST=2.2;',
    'float detailN(vec3 m, float rough, int oct){ float a=uDetailAmp*(0.15+1.35*rough)*DETAIL_BOOST, f=uDetailFreq, s=0.0, ridge=smoothstep(0.4,0.9,rough);',
'  if(oct>=5){ m += vec3(snoise(m*3000.0+1.0), snoise(m*3000.0+2.0), snoise(m*3000.0+3.0))*0.00006; } /* 域扭曲：形成蜿蜒的山脊/谷地 */',
'  for(int o=0;o<DETAIL_MAX;o++){ if(o>=oct) break; float v=snoise(m*f); v=mix(v,(1.0-abs(v))*1.6-0.8,ridge); s+=a*v*((o==oct-1)?uOctF:1.0); f*=2.05; a*=DETAIL_GAIN; } return s; }',
'#if SURFKIND < 0 || SURFKIND == 2 || SURFKIND == 5 || SURFKIND == 6',
'uniform float uRivers;',
'float riverAt(vec3 m, float moist, float elev){ if(uRivers<0.5) return 0.0; vec3 mw=m+vec3(snoise(m*140.0+1.0),snoise(m*140.0+5.0),snoise(m*140.0+9.0))*0.0025; float valley=smoothstep(0.45,0.8,1.0-abs(snoise(m*70.0+4.0))); float w1=1.0-abs(snoise(mw*520.0+2.0)); float w2=1.0-abs(snoise(mw*2900.0+8.0)); float rv=max(smoothstep(0.982,0.997,w1)*(0.4+0.6*valley), smoothstep(0.988,0.999,w2)*0.7*valley); return rv*smoothstep(0.3,0.65,moist)*(1.0-smoothstep(0.06,0.35,elev)); }',
'#else',
/* 无水的世界（岩石/沙漠/冰/熔岩）riversOn() 恒为假，这一段连编都不用编 */
'const float uRivers = 0.0;',
'float riverAt(vec3 m, float moist, float elev){ return 0.0; }',
'#endif',
'float fieldH(vec3 n, int oct){ vec3 m=warpN(n); vec3 t=mapSample(sph2uv(m)); return t.x+detailN(m,t.y,oct); }',
/* 球面视图求法线用的廉价高度：只取两档细节、不做域扭曲。
   理由是编译成本 —— fieldH 每出现一次就要内联十几个 snoise，而在球面尺度上第 3 档以后的细节
   对**法线**的贡献已经在一个像素以内（真正的近景起伏由 surfBump 那一层给）。 */
'float fieldGrad(vec3 n){ vec3 t=mapSample(sph2uv(n)); float a=uDetailAmp*(0.15+1.35*t.y)*DETAIL_BOOST, f=uDetailFreq, s=0.0, ridge=smoothstep(0.4,0.9,t.y);',
'  for(int o=0;o<2;o++){ float v=snoise(n*f); v=mix(v,(1.0-abs(v))*1.6-0.8,ridge); s+=a*v; f*=2.05; a*=DETAIL_GAIN; } return t.x+s; }',
'vec4 fieldAt(vec3 n, int oct){ vec3 m=warpN(n); vec3 t=mapSample(sph2uv(m)); float h=t.x+detailN(m,t.y,oct);',
'#if SURFKIND < 0 || SURFKIND == 2 || SURFKIND == 5 || SURFKIND == 6',
'  if(uRivers>0.5 && oct>=5){ float el=uSea<0.0?h:clamp((h-uSea)/(1.0-uSea),0.0,1.0); h-=riverAt(m,t.z,el)*0.0022; }',
'#endif',
'  return vec4(h, t.y, t.z, t.x); }'
  ].join('\n');
  // 地表材质（球面视图与地表飞越共用）
  /* 地表材质（球面视图与地表飞越共用）
     ------------------------------------------------------------
     uSurfKind：0 岩石 / 1 沙漠 / 2 海洋 / 3 冰 / 4 熔岩 / 5 生命（含地球） / 6 气态。
     uSty0 是「按类型解释」的四个风格参数（全部由行星种子派生，见 CPU 侧 surfStyle）：
       岩石 (月海量, 辐射纹量, 撞击密度, 造山强度)   沙漠 (沙丘基频, sin 主风向, cos 主风向, 沙海量)
       海洋 (陆架宽, 洋流强, 0, 0)                     冰   (裂谷量, 沉积量, 裂谷基频, 0)
       熔岩 (裂缝基频, 熔岩湖量, 温度档, 0)            生命 (气候带偏移, 分带锐度, 0, 0)
     uSty1 是各类型共用的 (气旋尺度, 云量系数, 大陆基频, 裂谷量)。
     uDetail：近地表细节权重 0..1。远景为 0 —— 细节八度与高频反照率斑点全部淡出，
     所以远看到的是大陆/冰盖/云系这些大结构，而不是一层均匀的颗粒。
     fld.z 的含义按类型分家：有水的世界（海洋/生命/地球）是湿度，其余世界是各自的「标记场」
     （岩石 = 0.5 基准的月海/辐射纹，沙漠 = 沙海密度，冰 = 沉积暗斑，熔岩 = 壳龄）。 */
  var GLSL_SURF = [
    'uniform sampler2D uPal;',
    'uniform vec3 uOceanShallow,uOceanDeep,uAtm,uIceColor,uCloudColor,uFogColor,uVeg0,uVeg1;',
    'uniform float uAtmDensity,uIceLat,uIceHeight,uCloud,uLights,uLava,uLavaSea,uFog,uGreen,uSpec,uCracks,uTime,uCloudRot,uStorm,uCloudDetail;',
    'uniform int uGas;',
    'uniform float uGasGlow; uniform vec3 uGasGlowCol;',
    'uniform vec3 uSunTint;',
    'uniform int uSurfKind; uniform vec4 uSty0, uSty1; uniform float uDetail;',
    /* 地表类型的判定宏。SURFKIND 没定义（= -1）时按老样子在运行期比较，
       球面视图那几个程序各自 #define SURFKIND <类型>，于是另外几支在预处理阶段就没了。
       缘由：六种地表塞进同一个片元着色器，D3D 那边要编 47 秒 —— 第一次用到它就得干等。 */
    '#if SURFKIND < 0',
    '#define KIND_ICE   (uSurfKind==3)',
    '#define KIND_ROCK  (uSurfKind==0)',
    '#define KIND_DES   (uSurfKind==1)',
    '#define KIND_LAVA  (uSurfKind==4)',
    '#define KIND_OTHER (uSurfKind!=3 && uSurfKind!=0 && uSurfKind!=1 && uSurfKind!=4)',
    '#define KIND_NOT_ICE  (uSurfKind!=3)',
    '#define KIND_NOT_LAVA (uSurfKind!=4)',
    '#else',
    '#define KIND_ICE   (SURFKIND==3)',
    '#define KIND_ROCK  (SURFKIND==0)',
    '#define KIND_DES   (SURFKIND==1)',
    '#define KIND_LAVA  (SURFKIND==4)',
    '#define KIND_OTHER (SURFKIND!=3 && SURFKIND!=0 && SURFKIND!=1 && SURFKIND!=4)',
    '#define KIND_NOT_ICE  (SURFKIND!=3)',
    '#define KIND_NOT_LAVA (SURFKIND!=4)',
    '#endif',
    'uniform vec3 uDepositC, uCrackC;',
    /* 平铺细节贴图。td(p) 采一次 = 一次值噪声；tf3(p,f) 是三个倍频的和。
       uDetOff 是每颗行星的偏移（从种子来），所以同一张贴图能长出不同的星球。 */
    'uniform highp sampler3D uDetTex; uniform vec3 uDetOff;',
    'vec4 td4(vec3 p){ return texture(uDetTex, p) * 2.0 - 1.0; }',
    'float td(vec3 p){ return texture(uDetTex, p).r * 2.0 - 1.0; }',
    'float tf3(vec3 p){ vec4 a=td4(p), b=td4(p*2.4+0.31), c=td4(p*5.6+0.63); return a.r*0.46 + b.g*0.32 + c.b*0.22; }',   /* 冰：沉积暗斑色（托林）与裂谷色；其它类型给零不用 */
    'uniform vec2 uSea2;',   /* (陆架宽度, 洋流色差强度)：所有有水的世界共用 */
    'struct Surf { vec3 col; vec3 emis; float spec; float water; float ice; float river; };',
    'float sn2(vec3 p, int oct){ float s=0.0,a=0.5,f=1.0; for(int i=0;i<4;i++){ if(i>=oct) break; s+=a*snoise(p*f); f*=2.11; a*=0.5; } return s; }',
    'vec3 curlW(vec3 n, float f, float amp){ vec3 w=vec3(snoise(n*f+3.1), snoise(n*f+9.7), snoise(n*f+17.3)); return normalize(n + cross(n,w)*amp); }',
    /* 中尺度地貌（只在近景淡入）：返回一个高度标量，球面视图用它在切平面上的梯度扰动法线。
       这是高度场的梯度，不是把噪声直接糊到法线上 —— 所以近看是「看得懂的地貌」而不是一层沙：
         冰   压力脊（长而直）+ 多边形冰原的裂纹网 + 雪垄（沿主风向的细垄）
         沙漠 沙丘脊：迎风面缓、背风面陡（把正弦用 pow 压成不对称）
         岩石 坑缘与溅射毯 + 巨石
         熔岩 冷却壳板块的边缘隆起
       每一支只花一两次噪声 —— 这个片元着色器离 D3D 的编译上限本来就不远。 */
    'float hash21(vec2 p){ vec3 q=fract(vec3(p.x,p.y,p.x)*vec3(0.1031,0.1030,0.0973)); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }',
    'float craterField(vec3 n, float S){',
    '  vec2 uv=sph2uv(n); vec2 c=vec2(uv.x*2.0*S, uv.y*S); vec2 ic=floor(c); float o=0.0;',
    '  for(int oy=-1;oy<=1;oy++){ for(int ox=-1;ox<=1;ox++){',
    '    vec2 g=ic+vec2(float(ox),float(oy));',
    '    float h1=hash21(g), h2=hash21(g+37.7);',
    '    if(h1>0.52) continue;',
    '    vec2 jc=g+vec2(h2, fract(h2*7.31));',
    '    float rad=0.20+0.34*fract(h1*13.7);',
    '    float d=length(c-jc)/rad;',
    '    if(d<1.4){ float q=(d-1.0)/0.17;',
    '      o -= (1.0-smoothstep(0.0,0.90,d))*0.95;',
    '      o += exp(-q*q)*0.60; }',
    '  } }',
    '  return o; }',
    'float surfBump(vec3 n){',
    '  if(uDetail<=0.02) return 0.0;',
    '  float b=0.0;',
    '#if SURFKIND < 0 || SURFKIND == 3',
    '  if(KIND_ICE){',
    '    float r1=1.0-abs(td(n*0.29+uDetOff));',
    '    b -= smoothstep(0.93,1.0,r1)*1.30;',
    '    float p1=1.0-abs(td4(n*2.6+uDetOff).g);',
    '    b += smoothstep(0.88,1.0,p1)*0.70;',
    '    b += sin(dot(n,vec3(0.81,0.42,0.41))*2400.0)*0.07;',
    '  }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 1',
    '  if(KIND_DES){',
    '    float w=td(n*0.21+uDetOff);',
    '    float dc=(dot(n,vec3(uSty0.z,0.55,uSty0.y))+w*0.010)*max(uSty0.x,6.0)*26.0;',
    '    float sd=sin(dc)*0.5+0.5;',
    '    b += (pow(sd,3.2)-0.22)*1.05*clamp(mix(0.30,1.0,clamp(uSty0.w,0.0,1.0)),0.0,1.0);',
    '  }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 0',
    '  if(KIND_ROCK){',
    '    b += craterField(n, 26.0)*2.20*clamp(uSty0.z,0.25,1.0);',
    '    b += td4(n*9.5+uDetOff).b*0.16;',
    '  }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 4',
    '  if(KIND_LAVA){',
    '    float pl=td4(n*2.1+uDetOff).a;',
    '    b += smoothstep(0.14,0.0,abs(pl))*1.10;',
    '  }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 2 || SURFKIND == 5 || SURFKIND == 6',
    '  if(KIND_OTHER){',
    '    b += smoothstep(0.80,1.0, 1.0-abs(td4(n*1.9+uDetOff).r))*0.60;',
    '  }',
    '#endif',
    '  return b*uDetail; }',
    'Surf shadeSurface(vec3 n, vec4 fld, float nz){',
    '  Surf S; S.emis=vec3(0.0); S.spec=0.0; S.water=0.0; S.ice=0.0; S.river=0.0;',
    '  float h=fld.x, mark=fld.z, lat=abs(n.y);',
    '  bool land = uSea<0.0 || h>=uSea;',
    '  float elev = uSea<0.0 ? h : clamp((h-uSea)/(1.0-uSea),0.0,1.0);',
    '  float climate = clamp(lat*lat*1.2 + elev*uIceHeight*0.45 + 0.08*td(n*0.030+uDetOff), 0.0, 1.0);',
    '  float steep = smoothstep(0.70,0.36,nz);',
    '  vec3 col;',
    '  if(land){',
    '    col = texture(uPal, vec2(elev, climate)).rgb;',
    '#if SURFKIND < 0 || SURFKIND == 3',
    '    if(KIND_ICE){',
    '      vec3 polar = mix(col, vec3(0.97,0.985,1.0), smoothstep(0.52,0.88,lat));',
    '      vec3 lowlat = col*vec3(0.80,0.88,1.02)*0.93;',
    '      col = mix(mix(lowlat,col,smoothstep(0.08,0.45,lat)), polar, smoothstep(0.45,0.82,lat));',
    '      col *= 0.95+0.10*snoise(n*(1.8+uSty1.z*0.6)+7.0);',
    '      float prov = smoothstep(0.22,0.70, 0.5+0.5*snoise(n*0.8+5.5));',
    '      float cf0 = max(uSty0.z,1.2);',
    '      float c1 = 1.0-abs(snoise(n*cf0+2.0)), c2 = 1.0-abs(snoise(n*cf0*2.6-4.0));',
    '      float crack = max(smoothstep(0.970,0.999,c1), smoothstep(0.984,1.0,c2)*0.55)*prov*uSty0.x;',
    '      col = mix(col, uCrackC, crack*0.88);',
    /* 沉积暗斑：先过一道阈值，只有沉积**厚**的地方才显色 —— 覆盖率压在一成出头，不会把整球染褐 */
    '      col = mix(col, uDepositC, smoothstep(0.55,0.98, clamp(mark*uSty0.y,0.0,1.0))*0.82);',
    '      col = mix(col, col*1.12+0.04, smoothstep(0.66,0.30,nz)*0.5);',
    '      S.spec = 0.05+0.22*smoothstep(0.30,0.80,lat); S.ice=0.8;',
    '    }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 0',
    '    if(KIND_ROCK){',
    '      float mare = smoothstep(0.50,0.04,mark)*uSty0.x;',
    '      col = mix(col, col*vec3(0.44,0.46,0.50), mare);',
    '      float ray = smoothstep(0.52,0.96,mark)*uSty0.y;',
    '      col = mix(col, min(col*1.85+0.09, vec3(1.0)), ray*0.8);',
    '      col *= 0.90+0.20*snoise(n*(1.5+uSty1.z*0.6)+3.0);',
    '      if(uDetail>0.02){ float cf=craterField(n,26.0);',
    '        col = mix(col, min(col*1.65+0.05,vec3(1.0)), clamp(cf,0.0,1.0)*0.60*uDetail);',
    '        col = mix(col, col*0.80, clamp(-cf,0.0,1.0)*0.35*uDetail); }',
    '      col = mix(col, col*1.22+0.02, steep*0.55);',
    '      S.spec = 0.02;',
    '    }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 1',
    '    if(KIND_DES){',
    '      float erg = clamp(mark,0.0,1.0);',
    '      vec3 sand = texture(uPal, vec2(clamp(elev*0.5+0.45,0.0,1.0), climate*0.45)).rgb;',
    '      col = mix(col, sand, erg*0.72);',
    '      vec3 nw = curlW(n, 2.6, 0.10);',
    '      float dc = dot(nw, vec3(uSty0.z, 0.55, uSty0.y))*max(uSty0.x,6.0);',
    '      float dune = sin(dc)*0.5+0.5;',
    '      dune = mix(dune, dune*0.55+0.45*(sin(dc*7.0)*0.5+0.5), uDetail);',
    '      col *= 1.0 + (dune-0.5)*0.20*erg*uSty0.w;',
    '      float wadi = smoothstep(0.90,0.998, 1.0-abs(snoise(n*(5.0+uSty1.z*2.0)+4.4)));',
    '      col = mix(col, col*vec3(0.74,0.72,0.70), wadi*(1.0-erg)*0.75);',
    '      col = mix(col, col*1.20+0.03, steep*0.7);',
    '      S.spec = 0.03;',
    '    }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 4',
    '    if(KIND_LAVA){',
    '      float age = clamp(mark,0.0,1.0);',
    '      col = mix(mix(col,vec3(0.22,0.17,0.15),0.55), mix(col,vec3(0.06,0.05,0.045),0.75), age);',
    '      float ff = max(uSty0.x,6.0);',
    '      float k1 = 1.0-abs(snoise(n*ff+3.0)), k2 = 1.0-abs(snoise(n*ff*2.7-4.0));',
    '      float fis = max(smoothstep(0.900,0.996,k1), smoothstep(0.950,0.999,k2)*0.7);',
    '      if(uDetail>0.02){ float k3 = 1.0-abs(snoise(n*ff*8.5+1.0)); fis = max(fis, smoothstep(0.968,1.0,k3)*0.5*uDetail); }',
    '      fis *= (1.0-age);',
    '      float lake = smoothstep(0.34,0.02,elev)*smoothstep(0.55,0.12,age)*uSty0.y;',
    '      float glow = clamp(max(fis, lake*0.9)*uLava, 0.0, 1.0);',
    '      vec3 lc = mix(vec3(1.0,0.28,0.04), vec3(1.0,0.88,0.48), clamp(uSty0.z,0.0,1.0)*0.65+glow*0.35);',
    '      col = mix(col, lc*0.55, glow*0.85);',
    '      S.emis += lc*glow*(1.1+1.6*clamp(uSty0.z,0.0,1.0));',
    '      S.spec = 0.05;',
    '    }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND == 2 || SURFKIND == 5 || SURFKIND == 6',
    '    if(KIND_OTHER){',
    '      float moist = mark;',
    '      float treeLine = 1.0-smoothstep(0.55-climate*0.35, 0.75-climate*0.35, elev);',
    '      float veg = uGreen*smoothstep(0.22,0.62,moist)*(1.0-smoothstep(0.45,0.92,climate))*treeLine*(1.0-steep*0.9);',
    '      float band = clamp(lat + uSty0.x, 0.0, 1.2);',
    '      float sharp = max(uSty0.y, 0.4);',
    '      float rain   = smoothstep(0.34,0.10,band)*smoothstep(0.42,0.72,moist);',
    '      float savan  = smoothstep(0.08,0.30,band)*smoothstep(0.62,0.34,moist)*smoothstep(0.62,0.36,band);',
    '      float arid   = smoothstep(0.16,0.36,band)*smoothstep(0.46,0.18,moist)*smoothstep(0.66,0.40,band);',
    '      float boreal = smoothstep(0.42,0.62,band)*smoothstep(0.28,0.55,moist)*smoothstep(0.86,0.62,band);',
    '      float tundra = smoothstep(0.62,0.82,band);',
    '      vec3 cRain=uVeg1, cSav=vec3(0.55,0.54,0.26), cArid=vec3(0.66,0.56,0.36), cBor=mix(uVeg0,vec3(0.16,0.28,0.20),0.6), cTun=vec3(0.44,0.42,0.30);',
    '      vec3 vc = uVeg0;',
    '      vc = mix(vc, cRain, clamp(rain*sharp,0.0,1.0));',
    '      vc = mix(vc, cSav,  clamp(savan*sharp,0.0,1.0));',
    '      vc = mix(vc, cArid, clamp(arid*sharp,0.0,1.0));',
    '      vc = mix(vc, cBor,  clamp(boreal*sharp,0.0,1.0));',
    '      vc = mix(vc, cTun,  clamp(tundra,0.0,1.0));',
    '      float patchN = 0.5+0.5*(td4(n*(0.60+uSty1.z*0.20)+uDetOff).r*0.7 + td4(n*(1.30+uSty1.z*0.28)+uDetOff).g*0.3);',
    '      vc *= 0.86+0.30*patchN;',
    '      if(uDetail>0.02) vc *= 1.0 + td4(n*3.5+uDetOff).b*0.16*uDetail;',
    '      col = mix(col, vc, veg);',
    '      vec3 rockC = mix(vec3(0.33,0.30,0.27), vec3(0.62,0.58,0.50), 0.5+0.5*(td4(n*0.30+uDetOff).a*0.7+td4(n*0.63+uDetOff).r*0.3));',
    '      float dry = smoothstep(0.45,0.85, 0.5+0.5*td4(n*0.90+uDetOff).g + (1.0-moist)*0.5)*(1.0-veg)*(1.0-smoothstep(0.5,0.8,climate))*0.5;',
    '      col = mix(col, rockC, clamp(max(steep, dry),0.0,1.0));',
    '      if(uRivers>0.5){ float rv=riverAt(warpN(n),moist,elev); S.river=rv; col=mix(col, uOceanShallow*0.7+vec3(0.04,0.07,0.05), smoothstep(0.15,0.6,rv)*0.9); S.water=max(S.water, smoothstep(0.3,0.7,rv)); }',
    '      S.spec = 0.03;',
    '    }',
    '#endif',
    '    if(uDetail>0.004){ col *= mix(1.0, 0.965+0.07*td4(n*4.5+uDetOff).b+0.025*td4(n*18.0+uDetOff).a, uDetail); }',
    '#if SURFKIND < 0 || SURFKIND != 3',
    '    if(KIND_NOT_ICE){ float ice = smoothstep(uIceLat-0.05, uIceLat+0.03, lat + 0.05*td(n*0.040+uDetOff) + elev*0.12*uIceHeight)*(1.0-steep*0.75);',
    '      col = mix(col, uIceColor, ice); S.ice=max(S.ice,ice); S.spec += ice*0.22; }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND != 3',
    '    if(uCracks>0.0 && KIND_NOT_ICE){ float cr=1.0-abs(snoise(n*14.0)); float cr2=1.0-abs(snoise(n*45.0+2.0)); cr=max(smoothstep(0.93,1.0,cr),smoothstep(0.96,1.0,cr2)*0.6)*uCracks; col=mix(col, col*0.4+vec3(0.03,0.1,0.2), cr); }',
    '#endif',
    '#if SURFKIND < 0 || SURFKIND != 4',
    '    if(uLava>0.0 && KIND_NOT_LAVA){ float r1=1.0-abs(snoise(n*22.0+3.0)); float r2=1.0-abs(snoise(n*55.0-4.0)); float r3=1.0-abs(snoise(n*420.0+9.0));',
    '      float riv=max(smoothstep(0.92,0.99,max(r1*0.95,r2*0.85)), smoothstep(0.965,0.997,r3)*0.75); riv*=(1.0-smoothstep(0.12,0.5,elev));',
    '      vec3 lc=vec3(1.0,0.35,0.06); col=mix(col, vec3(0.17,0.13,0.12), uLava*0.7); col=mix(col, lc*0.6, riv*uLava); S.emis+=lc*riv*uLava*1.8; }',
    '#endif',
    '  } else {',
    '    float depth = clamp((uSea-h)/max(uSea,1e-4),0.0,1.0);',
    '    if(uLavaSea>0.5){ vec3 lc=mix(vec3(0.9,0.25,0.03), vec3(1.0,0.75,0.25), 0.5+0.5*snoise(n*30.0+uTime*0.05)); float m=smoothstep(0.0,0.06,depth);',
    '      float plate=smoothstep(0.30,0.62, 0.5+0.5*snoise(n*26.0+5.0)+0.25*snoise(n*70.0-3.0));',   /* 漂在岩浆海上的冷却暗壳：亮的是板块之间的缝 */
    '      col=mix(vec3(0.15,0.08,0.05), lc, m); S.emis=lc*1.4*m;',
    '      col=mix(col, vec3(0.10,0.07,0.06), plate*0.85); S.emis*=1.0-plate*0.88; S.spec=0.2; }',
    '    else {',
    '      float shelfW = max(uSea2.x, 0.02);',
    '      float shelf = 1.0-smoothstep(0.0, shelfW, depth);',
    '      vec3 shallow = mix(uOceanShallow*1.22+vec3(0.06,0.08,0.05), uOceanShallow, smoothstep(0.0,0.6,shelf));',
    '      col = mix(uOceanDeep, shallow, pow(1.0-clamp(depth,0.0,1.0), 2.2));',
    '      col = mix(col, uOceanShallow*1.25+vec3(0.06,0.08,0.04), shelf*0.55);',
    '      vec3 cw = normalize(n + cross(n, td4(n*0.05+uDetOff).xyz)*0.30);',
    '      float cur = td4(cw*vec3(0.05,0.14,0.05)+uDetOff).r*0.6 + td4(cw*vec3(0.11,0.30,0.11)+uDetOff).g*0.4;',
    '      col *= 1.0 + cur*0.16*uSea2.y; col = mix(col, col*vec3(0.88,1.06,1.02), clamp(cur,0.0,1.0)*0.35*uSea2.y);',
    '      S.spec=uSpec; S.water=1.0;',
    '      float sice=smoothstep(uIceLat+0.02, uIceLat+0.09, lat+0.04*td(n*0.045+uDetOff)); col=mix(col, uIceColor*0.95, sice); S.spec=mix(S.spec,0.2,sice); S.ice=sice;',
    '    }',
    '  }',
    '  S.col=col; return S; }',
    'uniform sampler2D uCityTex; uniform float uHasCity;',
    'float cityLights(vec3 n, vec4 fld, float river){ if(uLights<=0.0) return 0.0; float h=fld.x, moist=fld.z; if(uSea>0.0 && h<uSea) return 0.0;',
    '  if(uHasCity>0.5){ float c=texture(uCityTex, sph2uv(n)).r; if(c<0.002) return 0.0; float dots=0.55+0.45*smoothstep(0.3,0.9,snoise(n*900.0)) + 0.5*smoothstep(0.6,0.95,snoise(n*2600.0)); return min(c*2.2,1.0)*dots*uLights; }',
    '  float elev = uSea<0.0? h : (h-uSea)/(1.0-uSea); float lat=abs(n.y);',
    '  float base = smoothstep(0.22,0.52,moist)*(1.0-smoothstep(0.22,0.52,elev))*(1.0-smoothstep(0.55,0.75,lat));',
    '  float coast = uSea>0.0 ? 1.0-smoothstep(0.0,0.055,elev) : 0.5;',
    '  float valley = smoothstep(0.05,0.45,river)*0.8;',
    '  float cl = smoothstep(0.18,0.68, snoise(n*9.0)+0.35*snoise(n*23.0)+coast*0.75+valley);',
    '  float dots = smoothstep(0.45,0.8, snoise(n*160.0)) + 0.4*smoothstep(0.6,0.95,snoise(n*400.0)) + 0.25*smoothstep(0.7,0.98,snoise(n*1200.0));',
    '  return base*cl*dots*uLights*(0.55+0.65*max(coast,valley)); }',
    /* 大气的边缘散射：光程 ∝ 1/μ（斜穿时更长）、瑞利 λ⁻⁴ 把蓝端加权、**向光侧亮而背光侧消失**。
       厚度跟着 uAtmDensity（大气压/标高的代理）走 —— 无大气天体拿到 0，边上什么也不挂。 */
    'vec3 limbGlow(vec3 Nw, vec3 V, float ndl, out float amt){',
    '  float mu=max(dot(Nw,V),0.0);',
    '  float thick=pow(1.0-mu,3.0)*(0.40+0.75*clamp(uAtmDensity,0.0,1.6));',
    '  float litRim=smoothstep(-0.30,0.18,ndl);',
    '  float gq=(ndl-0.04)/0.30; float fwd=1.0+0.95*exp(-gq*gq);',
    '  amt=clamp(thick*litRim*fwd*0.80, 0.0, 0.94);',
    '  return uAtm*mix(vec3(1.0),uSunTint,0.45)*vec3(1.06,0.94,0.86); }',,
    /* 云影用的廉价云：一层旋涡扭曲 + 两个倍频。影子本来就是糊的，不值一整份 cloudAt
       （那一份在片元着色器里要内联十几个 snoise，而它在球面视图里被调了两次）。 */
    'float cloudShadow(vec3 n){ if(uCloud<=0.0) return 0.0; float c=cos(uCloudRot), s=sin(uCloudRot); vec3 m=vec3(n.x*c-n.z*s, n.y, n.x*s+n.z*c);',
    '  float cyc = max(uSty1.x, 0.3); vec3 q = m*0.085*cyc + uDetOff;',
    '  q += cross(m, td4(q*0.75).xyz)*0.020*cyc;',
    '  float f = td4(q).r*0.62 + td4(q*2.0+0.31).g*0.32;',
    '  float lat=abs(n.y), a1=(lat-0.34)/0.16, a2=(lat-0.66)/0.20;',
    '  f = f*0.5+0.5 + 0.26*exp(-lat*lat*26.0) - 0.22*exp(-a1*a1) + 0.20*exp(-a2*a2);',
    '  float lo=0.62-uCloud*0.26; return smoothstep(lo, lo+0.21, f)*min(1.0,uCloud*1.35); }',
    'float cloudAt(vec3 n){ if(uCloud<=0.0) return 0.0; float c=cos(uCloudRot), s=sin(uCloudRot); vec3 m=vec3(n.x*c-n.z*s, n.y, n.x*s+n.z*c);',
    '  float cyc = max(uSty1.x, 0.3);',
    '  vec3 adv = vec3(uTime*0.00012, 0.0, 0.0);',
    '  vec3 q = m*0.085*cyc + uDetOff + adv;',
    /* 气旋：从贴图里取一个三分量的扰动向量当旋涡场，一次采样顶掉原来三次噪声 */
    '  vec3 w1 = td4(q*0.75).xyz; q += cross(m, w1)*0.020*cyc;',
    '  vec3 w2 = td4(q*2.0+0.17).xyz; q += cross(m, w2)*0.008*cyc;',
    '  float f = tf3(q);',
    '  if(uCloudDetail>0.5) f += td4(q*7.0+0.41).a*0.20 + td4(q*17.0+0.77).r*0.10;',
    '  float lat=abs(n.y);',
    '  float a1=(lat-0.34)/0.16, a2=(lat-0.66)/0.20;',
    '  float itcz = 0.26*exp(-lat*lat*26.0) - 0.22*exp(-a1*a1) + 0.20*exp(-a2*a2);',
    '  f = f*0.5+0.5 + itcz;',
    '  float lo=0.62-uCloud*0.26; return smoothstep(lo, lo+0.21, f)*min(1.0,uCloud*1.35); }'
  ].join('\n');
  /* 不规则天体的形状（小行星 / 彗核）：三轴椭球 × 若干「凸起 / 凹坑 / 收腰」。
     全部参数是每个天体的常量（CPU 按 seed 算好，见 shapeOf），与相机、时间无关。
     uShaped = 0（默认，也是所有行星/卫星的取值）时 shapeR ≡ 1、shapeP ≡ n，球状天体逐位保持原样。
     依据：直径 ≳ 400–600 km 的岩质天体才会被自引力揉圆（Lineweaver & Norman 2010），
     再小就保持碰撞碎裂后的棱角；67P 这类彗核常见双瓣结构（Rosetta，Sierks et al. 2015）。 */
  var GLSL_SHAPE = [
    'uniform vec4 uLobe[6]; uniform float uLobeE[6]; uniform vec3 uAxes; uniform float uShaped; uniform int uLobeN;',
    'float shapeR(vec3 n){ if(uShaped<0.5) return 1.0; float r=1.0;',
    '  for(int i=0;i<6;i++){ if(i>=uLobeN) break; float d=dot(n,uLobe[i].xyz); float e=uLobeE[i];',
    '    float w = e>=0.0 ? pow(max(d,0.0), e) : pow(max(1.0-d*d,0.0), -e); r += uLobe[i].w*w; }',
    '  return clamp(r, 0.25, 3.0); }',
    'vec3 shapeP(vec3 n){ return uShaped<0.5 ? n : n*uAxes*shapeR(n); }',
    'vec3 shapeNrm(vec3 n){ if(uShaped<0.5) return n;',
    '  vec3 up = abs(n.y)<0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);',
    '  vec3 T=normalize(cross(up,n)), B=cross(n,T); float e=0.02;',
    '  vec3 p0=shapeP(n), p1=shapeP(normalize(n+T*e)), p2=shapeP(normalize(n+B*e));',
    '  vec3 g=cross(p1-p0, p2-p0); return dot(g,n)>0.0 ? normalize(g) : n; }'
  ].join('\n');
  var SH = {};
  SH.globeV = GLSL_HEAD + GLSL_SHAPE + '\n' + [
    'layout(location=0) in vec3 aPos; uniform mat4 uVP, uModel; out vec3 vN; out vec3 vW; out vec3 vSN;',
    'void main(){ vN=aPos; vSN=shapeNrm(aPos); vec4 w=uModel*vec4(shapeP(aPos),1.0); vW=w.xyz; gl_Position=uVP*w; }'
  ].join('\n');
  /* 巨行星 / 冰巨星的球面：只有云带，没有高度场 —— 单独一个程序，别和地形挤在一个着色器里。 */
  /* ---- 巨行星的云顶 ----------------------------------------------------------
     纬向带与区，靠四件事撑起层次，而不是「一层低频色块 + 一把撒上去的米粒」：
       1) 多尺度流场：三级切向旋涡域扭曲，扭曲强度在带界处最大（Kelvin–Helmholtz 不稳定
          本来就发生在两条反向急流之间），于是卷曲只长在带界，带内保持纬向；
       2) 沿流线拉长：细纹在**扭曲之后**才把纬向压扁 —— 先卷再压得到的是卷须，
          先压再卷（旧写法）得到的是横向刮痕；
       3) 带内子带：每条带里再分 3–8 条（条数与相位随种子）色相/明度细条纹；
       4) 带界羽状拖尾（festoon）：带界的锯齿状扰动，木星的带界就是这个样子。
     风暴斑：少量椭圆、长轴沿纬向、内部螺旋、下游拖出一条扰动带纹的尾迹。
     亮云：沿流线拉长的絮状条，按纬度成群出现 —— 不是全球均匀撒点。
     细节全部走那张公共平铺贴图（采样，不是内联噪声），所以这一层加得起。 */
  var GLSL_GAS = [
    'uniform sampler2D uPal;',
    'uniform vec3 uAtm, uSunTint, uGasGlowCol;',
    'uniform float uAtmDensity, uTime, uGasGlow, uDetail;',
    'uniform float uBandY[20]; uniform vec3 uBandC[20]; uniform int uBandN;',
    'uniform vec4 uStormA, uStormB, uStormC, uGasP, uGasP2;',
    'uniform highp sampler3D uDetTex; uniform vec3 uDetOff;',
    'vec4 td4(vec3 p){ return texture(uDetTex, p) * 2.0 - 1.0; }',
    'float td(vec3 p){ return texture(uDetTex, p).r * 2.0 - 1.0; }',
    'float wrapPi(float a){ return mod(a+3.14159265, 6.28318531)-3.14159265; }',
    /* 风暴斑：椭圆长轴沿纬向，内部按半径旋进（螺旋），外圈一道亮环 */
    'vec3 stormPatch(vec3 col, vec4 sp, float lon, float y, float lat, float sgn){',
    '  if(sp.w<=0.001) return col;',
    '  vec2 d = vec2(wrapPi(lon-sp.x)*max(cos(lat),0.10), y-sp.y);',
    '  float r = length(d/vec2(max(sp.z,0.01)*2.3, max(sp.z,0.01)));',
    '  float a = atan(d.y,d.x) + sgn*(1.0-clamp(r,0.0,1.0))*2.8;',
    '  float swirl = 0.5+0.5*sin(a*3.0+r*7.0);',
    '  float m = smoothstep(1.05,0.28,r)*sp.w;',
    '  vec3 sc = mix(col*vec3(1.55,0.82,0.58), col*vec3(1.10,1.02,0.92), swirl*0.55);',
    '  col = mix(col, sc, m);',
    '  return mix(col, min(col*1.45+0.05,vec3(1.0)), smoothstep(0.24,0.0,abs(r-0.94))*0.55*sp.w); }',
    /* 尾迹：风暴下游一条被扰动的带纹。只在下游、只在风暴那一档纬度上。 */
    'float stormWake(vec4 sp, float lon, float y, float lat, float sgn){',
    '  if(sp.w<=0.001) return 0.0;',
    '  float dl = wrapPi(lon-sp.x)*max(cos(lat),0.10);',
    '  float q = (y-sp.y)/max(sp.z*1.7,0.02);',
    '  float down = smoothstep(0.0, -1.1, dl*sgn);',
    '  return down*exp(-q*q)*sin(dl*13.0)*sp.w; }',
    'vec3 gasShade(vec3 n, float t){',
    '  float y=clamp(n.y,-1.0,1.0), lat=asin(y), lon=atan(-n.z,n.x), by=lat*0.3183098862+0.5;',
    '  float turb=max(uGasP.x,0.15);',
    /* 带界距离（卷曲只长在这儿）与本带的纬向风向（相邻带反向） */
    '  float edge=0.0, wind=1.0;',
    '  for(int i=0;i<20;i++){ if(i>=uBandN-1) break;',
    '    edge=max(edge, smoothstep(0.026,0.0,abs(by-uBandY[i])));',
    '    if(by>uBandY[i]) wind=-wind; }',
    /* 三级切向旋涡域扭曲：强度随带界升高 —— 带内几乎不扭，带界卷成丝 */
    '  float adv=t*0.00006*wind;',
    '  vec3 d0=n;',
    '  vec3 f1=td4(d0*0.085+uDetOff+vec3(adv,0.0,0.0)).xyz;',
    '  d0=normalize(d0+cross(n,f1)*0.055*turb*(0.30+edge));',
    '  vec3 f2=td4(d0*0.21+uDetOff+0.21).xyz;',
    '  d0=normalize(d0+cross(n,f2)*0.022*turb*(0.26+edge));',
    '  vec3 f3=td4(d0*0.52+uDetOff+0.47).xyz;',
    '  d0=normalize(d0+cross(n,f3)*0.008*turb*(0.22+edge));',
    /* 带坐标的扰动：大尺度蜿蜒 + 带界的羽状拖尾 + 风暴下游的尾迹 */
    '  float mnd=td(d0*0.045+uDetOff);',
    '  float fest=td4(d0*0.30+uDetOff+0.70).g;',
    '  float wake=stormWake(uStormA,lon,y,lat,1.0)+stormWake(uStormB,lon,y,lat,-1.0)+stormWake(uStormC,lon,y,lat,1.0);',
    '  float byw=clamp(by + (mnd*0.50 + fest*0.62*edge + wake*0.35)*0.018*turb, 0.0, 1.0);',
    /* 带查表：边缘按湍流宽度柔化 */
    '  float sw=(0.005+0.011*turb)*(1.0-0.62*uDetail);',
    '  vec3 col=uBandC[0];',
    '  for(int i=1;i<20;i++){ if(i>=uBandN) break; col=mix(col, uBandC[i], smoothstep(uBandY[i-1]-sw, uBandY[i-1]+sw, byw)); }',
    /* 带内子带：每条带里 3–8 条纬向细条纹（条数与相位随种子） */
    '  float sub=sin(byw*6.2831853*uGasP2.x + uGasP2.y);',
    '  col *= 1.0 + sub*0.040;',
    '  col = mix(col, col*vec3(1.035,0.995,0.960), sub*0.5+0.5);',
    /* 沿流线拉长的细纹：**先卷后压**，压的是纬向 —— 得到的是卷须，不是刮痕。
       两档，近距离时第二档再加权（远看是干净的带，拉近能看到丝状结构）。 */
    '  vec3 st=vec3(d0.x, d0.y*3.6, d0.z);',
    '  float fine = td4(st*0.85+uDetOff).b*0.62 + td4(st*2.1+uDetOff+0.33).a*0.38;',
    '  col *= 1.0 + fine*0.075*(0.55+0.65*uDetail);',
    '  if(uDetail>0.02){',
    /* 贴近了再加一级更细的旋涡扭曲 —— 光把噪声压扁只会得到一层「毛」，
       细纹自己也得被卷过才有丝缕和小涡。 */
    '    vec3 f4=td4(d0*1.35+uDetOff+0.63).xyz;',
    '    vec3 d1=normalize(d0+cross(n,f4)*0.0042*turb*(0.30+edge)*uDetail);',
    '    vec3 st2=vec3(d1.x, d1.y*4.4, d1.z);',
    '    col *= 1.0 + td4(st2*7.2+uDetOff+0.61).a*0.075*uDetail;',
    /* 贴脸时才淡入的两档：带内的细丝与小尺度对流胞。频率取到「一个纹素约三个像素」，
       再细就开始起噪点了（那正是第一版糊+闪的原因）。 */
    '    col *= 1.0 + (td4(st2*5.0+uDetOff+0.55).r*0.58 + td4(st2*11.5+uDetOff+0.81).g*0.42)*0.115*uDetail;',
    '    col *= 1.0 + td4(vec3(d1.x,d1.y*5.4,d1.z)*16.0+uDetOff+0.29).b*0.060*uDetail; }',
    /* 带界的亮暗卷曲（羽流本体） */
    '  col = mix(col, min(col*1.28+0.03,vec3(1.0)), edge*smoothstep(0.0,0.75,fest)*0.55*turb);',
    '  col = mix(col, col*0.84, edge*smoothstep(0.0,0.75,-fest)*0.35*turb);',
    '  col = stormPatch(col, uStormA, lon, y, lat,  1.0);',
    '  col = stormPatch(col, uStormB, lon, y, lat, -1.0);',
    '  col = stormPatch(col, uStormC, lon, y, lat,  1.0);',
    /* 亮云：沿流线拉长的絮状条，按纬度成群 —— 不是全球均匀撒点 */
    '  if(uGasP2.z>0.01){',
    '    float grp = smoothstep(0.10,0.72, td(vec3(uDetOff.x, by*1.35+uDetOff.y, uDetOff.z)));',
    '    vec3 sc2 = vec3(d0.x, d0.y*7.5, d0.z);',
    '    float streak = td4(sc2*1.5+uDetOff+0.9).r*0.65 + td4(sc2*3.4+uDetOff+0.13).g*0.35;',
    '    float br = smoothstep(0.30,0.80,streak)*grp*uGasP2.z;',
    '    col = mix(col, min(col*1.85+0.10,vec3(1.0)), br*0.62); }',
    /* 极区：暗化，偶尔是土星那样的六边形 */
    '  float pl=abs(y);',
    '  if(uGasP.y>0.5){ float th=atan(n.z,n.x); float hr=0.79+0.060*cos(6.0*th);',
    '    col = mix(col, col*0.78+vec3(0.015,0.025,0.04), smoothstep(hr-0.03,hr+0.03,pl)*uGasP.z);',
    '    col = mix(col, min(col*1.30+0.03,vec3(1.0)), smoothstep(0.035,0.0,abs(pl-hr))*0.65); }',
    '  else col = mix(col, col*(1.0-0.50*uGasP.z), smoothstep(0.70,0.99,pl));',
    '  return col; }',
    /* 大气的边缘散射：光程 ∝ 1/μ、瑞利 λ⁻⁴ 把蓝端加权、向光侧亮而背光侧消失 */
    'vec3 limbGlow(vec3 Nw, vec3 V, float ndl, out float amt){',
    '  float mu=max(dot(Nw,V),0.0);',
    '  float thick=pow(1.0-mu,3.0)*(0.40+0.75*clamp(uAtmDensity,0.0,1.6));',
    '  float litRim=smoothstep(-0.30,0.18,ndl);',
    '  float g=(ndl-0.04)/0.30; float fwd=1.0+0.95*exp(-g*g);',
    '  amt=clamp(thick*litRim*fwd*0.80, 0.0, 0.94);',
    '  return uAtm*mix(vec3(1.0),uSunTint,0.45)*vec3(1.06,0.94,0.86); }'
  ].join('\n');
  SH.gasGlobeF = GLSL_HEAD + GLSL_NOISE + '\n' + GLSL_GAS + '\n' + [
    'in vec3 vN; in vec3 vW; in vec3 vSN; uniform vec3 uCamW, uSunW; uniform mat3 uRot; uniform float uLumK, uAmbK, uStarlit, uForming, uAlpha; out vec4 fragColor;',
    'void main(){',
    '  vec3 n=normalize(vN); vec3 Nw=normalize(uRot*n); vec3 V=normalize(uCamW-vW); vec3 L=uSunW; float ndl=dot(Nw,L);',
    '  vec3 col = gasShade(n, uTime);',
    '  float diff=max(ndl,0.0); vec3 lit = col*max(uGasP2.w,1.0)*uSunTint*(diff*1.05*uLumK+0.03*uAmbK);',
    '  float rimA; vec3 rimC=limbGlow(Nw,V,ndl,rimA); lit += rimC*rimA*(0.30+1.05*diff);',
    /* 自身热辐射（超热木星）：整个盘面都在发暗红的光，边缘因为斜穿的光程更长而明显更亮；夜面也留一点。 */
    '  if(uGasGlow>0.001){ float lg=pow(1.0-max(dot(Nw,V),0.0),2.0);',
    '    lit += uGasGlowCol*uGasGlow*(0.16+1.35*lg)*(1.0+0.55*(1.0-smoothstep(-0.10,0.30,ndl)));',
    '    lit += uGasGlowCol*uGasGlow*uGasGlow*vec3(0.55,0.13,0.05)*0.5; }',
    '  if(uForming<1.0){ float g2=0.5+0.5*snoise(n*6.0+uTime*0.1); lit=mix(vec3(0.6,0.35,0.2)*(g2*0.8+0.4)*(max(ndl,0.0)+0.2), lit, uForming); }',
    '  if(uStarlit>0.0) lit=mix(lit, lit*vec3(0.74,0.82,1.0), uStarlit);',
    '  fragColor=vec4(lit,uAlpha); }'
  ].join('\n');
  /* 球面视图的占位着色器。
     缘由：globe 那个片元着色器在 D3D 上要编 40 秒（FXC 的优化在这个体量上是超线性的），
     而驱动的并行编译只是「不占主线程」，**第一次用到它的时候仍然要等**。
     以前就是在那一下把主线程钉住的 —— 用户点「随机一颗」就卡死。
     现在：正式的那个没编好之前先用这个顶着（几十毫秒就能编完），编好了再换过去。
     它只读贴图里已经算好的高度/粗糙度/湿度，不跑任何噪声，所以便宜。 */
  SH.globeLoF = GLSL_HEAD + [
    'uniform sampler2D uMap, uPal; uniform vec2 uMapSize;',
    'uniform float uSea, uIceHeight, uIceLat, uAtmDensity, uAlpha, uLumK, uAmbK, uStarlit, uGas, uGreen;',
    'uniform vec3 uCamW, uSunW, uAtm, uSunTint, uOceanShallow, uOceanDeep, uIceColor, uVeg0;',
    'in vec3 vN; in vec3 vW; in vec3 vSN; uniform mat3 uRot; out vec4 fragColor;',
    'vec3 decMap(vec4 t){ return vec3((floor(t.r*255.0+0.5)*256.0+floor(t.g*255.0+0.5))/65535.0, t.b, t.a); }',
    'vec2 sph2uvLo(vec3 n){ return vec2(atan(-n.z,n.x)/6.2831853+0.5, asin(clamp(n.y,-1.0,1.0))/3.14159265+0.5); }',
    'void main(){',
    '  vec3 n=normalize(vN); vec3 Nw=normalize(uRot*normalize(vSN)); vec3 V=normalize(uCamW-vW); float ndl=dot(Nw,uSunW);',
    '  vec2 uv=sph2uvLo(n); vec2 fp=clamp(uv*uMapSize, vec2(0.0), uMapSize-vec2(1.0));',
    '  vec3 t=decMap(texelFetch(uMap, ivec2(fp), 0));',
    '  float h=t.x, moist=t.z, lat=abs(n.y);',
    '  bool land = uSea<0.0 || h>=uSea;',
    '  float elev = uSea<0.0 ? h : clamp((h-uSea)/(1.0-uSea),0.0,1.0);',
    '  float climate = clamp(lat*lat*1.2 + elev*uIceHeight*0.45, 0.0, 1.0);',
    '  vec3 col;',
    '  if(uGas>0.5) col = texture(uPal, vec2(0.55, clamp(n.y*0.5+0.5,0.0,1.0))).rgb;',
    '  else if(land){ col = texture(uPal, vec2(elev, climate)).rgb;',
    '    col = mix(col, uVeg0, uGreen*smoothstep(0.25,0.6,moist)*(1.0-smoothstep(0.45,0.9,climate))*0.85);',
    '    col = mix(col, uIceColor, smoothstep(uIceLat-0.05, uIceLat+0.03, lat)); }',
    '  else { col = mix(uOceanShallow, uOceanDeep, pow(clamp((uSea-h)/max(uSea,1e-4),0.0,1.0),0.45));',
    '    col = mix(col, uIceColor*0.95, smoothstep(uIceLat+0.02, uIceLat+0.09, lat)); }',
    '  float diff=max(ndl,0.0)*smoothstep(-0.12,0.06,ndl);',
    '  vec3 lit = col*uSunTint*(diff*1.05*uLumK+0.045*uAmbK);',
    '  float rim=pow(1.0-max(dot(Nw,V),0.0),3.0)*clamp(uAtmDensity,0.0,1.6)*smoothstep(-0.28,0.18,ndl);',
    '  lit += uAtm*mix(vec3(1.0),uSunTint,0.45)*rim*(0.32+1.0*max(ndl,0.0));',
    '  if(uStarlit>0.0) lit=mix(lit, lit*vec3(0.74,0.82,1.0), uStarlit);',
    '  fragColor=vec4(lit,uAlpha); }'
  ].join('\n');
  var GLOBE_MAIN = [
    'in vec3 vN; in vec3 vW; in vec3 vSN; uniform vec3 uCamW, uSunW; uniform mat3 uRot; uniform float uEps, uSlope, uForming, uLumK, uAmbK, uStarlit, uAlpha; out vec4 fragColor;',
    'void main(){',
    '  vec3 n=normalize(vN); vec3 gn=normalize(vSN); vec3 Nw=normalize(uRot*gn); vec3 V=normalize(uCamW-vW); vec3 L=uSunW; float ndl=dot(Nw,L); vec3 lit;',
    '  vec3 Lo = L*uRot; /* 光照方向转到物体空间（uRot 正交，转置=逆） */',
    '  {',
    '    vec4 f0=fieldAt(n,uOct);',
    '    vec3 up=abs(n.y)<0.999?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0); vec3 T=normalize(cross(up,n)); vec3 B=cross(n,T);',
    /* 中心点也必须用同一个函数取高度：拿 fieldGrad 的邻点去减 fieldAt 的中心点，
       差值里会混进「两档细节 vs 六档细节」的系统性偏差，再除以极小的 uEps 就炸了 —— 近景会糊成一张平面。 */
    '    float h0g=fieldGrad(n);',
    '    float hx=fieldGrad(normalize(n+T*uEps)), hy=fieldGrad(normalize(n+B*uEps));',
    '    float hs=uHRange/uPlanetR*uSlope; float dhx=(hx-h0g)*hs/uEps, dhy=(hy-h0g)*hs/uEps;',
    '    Surf S=shadeSurface(n,f0,1.0);',
    '    if(uDetail>0.02){ const float EB=0.0025; float b0=surfBump(n);',
    '      float bx=surfBump(normalize(n+T*EB)), by=surfBump(normalize(n+B*EB));',
    '      dhx += (bx-b0)*(0.0016/EB); dhy += (by-b0)*(0.0016/EB); }',
    '    vec3 Nl=normalize(gn-(T*dhx+B*dhy)*(1.0-S.water)); vec3 N2=normalize(uRot*Nl);',
    '    float soft=clamp(uAtmDensity,0.0,1.5); float diff=max(dot(N2,L),0.0)*smoothstep(-0.03-0.30*soft, 0.02+0.14*soft, ndl);',
    '    lit = S.col*uSunTint*(diff*1.05*uLumK+0.035*uAmbK);',
    '    vec3 H=normalize(L+V); float sp=pow(max(dot(N2,H),0.0), S.water>0.5?150.0:24.0)*S.spec*smoothstep(0.0,0.12,ndl); lit+=vec3(1.0,0.97,0.9)*uSunTint*sp;',
    '    float cl=cloudAt(n); float sh=cloudShadow(normalize(n+Lo*0.016)); lit*=1.0-0.45*sh*step(0.01,uCloud)*smoothstep(-0.05,0.25,ndl);',
    '    vec3 cc=uCloudColor*uSunTint*(max(dot(Nw,L),0.0)*0.95+0.05); lit=mix(lit, cc, cl);',
    '    float night=1.0-smoothstep(-0.12,0.05,ndl);',
    '    lit += vec3(1.0,0.85,0.55)*cityLights(n,f0,S.river)*night*(1.0-cl*0.85)*1.6;',
    '    lit += S.emis*(0.35+0.65*night);',
    '    lit = mix(lit, uFogColor*uSunTint*(max(ndl,0.0)*0.9+0.05), uFog*0.8);',
    '    float rimA; vec3 rimC=limbGlow(Nw,V,ndl,rimA); lit += rimC*rimA*(0.32+1.05*max(ndl,0.0));',
    '  }',
    '  if(uForming<1.0){ float g=0.5+0.5*snoise(n*6.0+uTime*0.1); lit=mix(vec3(0.6,0.35,0.2)*(g*0.8+0.4)*(max(ndl,0.0)+0.2), lit, uForming); }',
    /* 只靠星光照明（流浪行星）：星光偏蓝白（多数光子来自远处的热星与银河背景），亮度是示意 */
    '  if(uStarlit>0.0) lit=mix(lit, lit*vec3(0.74,0.82,1.0), uStarlit);',
    '  fragColor=vec4(lit,uAlpha); }'
  ].join('\n');
  /* 球面视图的片元着色器：**一个地表类型一个程序**。
     六种地表塞在一个程序里时，D3D 那边要编 47 秒（FXC 在这个体量上是超线性的），
     第一次用到它就得当场等 —— 用户点「随机一颗」卡死就是这么来的。
     现在每个程序只带自己那一支（另外几支在预处理阶段就没了），实测降到 8 秒上下，
     而且只发当前真的要画的那一种。海洋(2)与生命(5)的着色分支本来就是同一支，合用一个程序。 */
  SH.globeF = GLSL_HEAD + '#define DETAIL_MAX 6\n' + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_SURF + '\n' + GLOBE_MAIN;
  var globeSrcCache = {};
  SH.globeFor = function (k) {
    if (globeSrcCache[k]) return globeSrcCache[k];
    return (globeSrcCache[k] = GLSL_HEAD + '#define DETAIL_MAX 6\n#define SURFKIND ' + k + '\n' + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_SURF + '\n' + GLOBE_MAIN);
  };
  /* 地表类型 → 程序名。气态走 gasglobe（它不含地表那一套）。 */
  function terrainProgName(vp) {
    var k = (vp && vp.surfKind != null) ? vp.surfKind : 0;
    if (k === 2 || k === 6) k = 5;
    return 'terrainK' + k;
  }
  function globeProgName(vp) {
    if (vp && vp.gas) return 'gasglobe';
    var k = (vp && vp.surfKind != null) ? vp.surfKind : 0;
    if (k === 2 || k === 6) k = 5;
    return 'globeK' + k;
  }
  /* 恒星表面（近距离观察，安全距离外的示意）：米粒组织 + 临边昏暗 + 黑子 + 谱斑。
     文献：
       Eddington 1926 —— 灰大气近似给出临边昏暗 I(μ)/I(0) = 1 − u(1−μ)，太阳可见光段 u ≈ 0.6
       Schwarzschild 1975 (ApJ 195, 137) —— 对流元的尺度 ~ 压力标高：太阳 ~1000 km（约 10⁶ 个米粒），
                                            红巨星/AGB 的标高极大，整个星面只剩几个巨对流胞
       Hale 1908 / GCVS —— 黑子是强磁场抑制对流的冷区（T 约低 1500 K，暗到 ~30% 亮度）
     单颗恒星的斑点位置、米粒花纹都是过程生成的（示意）；温度/半径/光度来自 spectralOf + evolveStar。 */
  SH.starF = GLSL_HEAD + GLSL_NOISE + '\n' + [
    'in vec3 vN; in vec3 vW; in vec3 vSN; uniform vec3 uCamW, uStarCol, uSpotCol, uMagAxis; uniform mat3 uRot;',
    'uniform float uTime, uGran, uGranAmp, uSpots, uLimbU, uFacula, uCap, uFlow; out vec4 fragColor;',
    'float fbm3(vec3 p, int oct){ float s=0.0,a=0.5,f=1.0; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*snoise(p*f); f*=2.13; a*=0.5; } return s; }',
    'void main(){ vec3 n=normalize(vN); vec3 Nw=normalize(uRot*n); vec3 V=normalize(uCamW-vW); float mu=clamp(dot(Nw,V),0.0,1.0);',
    '  vec3 q=n*uGran + vec3(0.0, uTime*uFlow, 0.0);',
    '  float base=0.5+0.5*fbm3(q*0.32+3.0, 3);                     /* 超米粒组织：大尺度的明暗不均 */',
    '  float lanes=pow(clamp(1.0-abs(snoise(q)),0.0,1.0), 9.0);     /* 胞间暗道 */',
    '  float fine=0.5+0.5*snoise(q*3.1+7.0);',
    '  float bright=mix(1.0, (0.86+0.30*base+0.16*fine)*(1.0-0.34*lanes), uGranAmp);',
    '  vec3 col=uStarCol*bright*1.28;   /* 恒星是自发光的：留一点过曝，才不会看成一个灰球 */',
    '  if(uSpots>0.0){ float s1=snoise(n*3.4+vec3(0.0,uTime*0.004,0.0)), s2=snoise(n*8.5+21.0);',
    '    float umb=smoothstep(0.70,0.86, s1*0.72+s2*0.28+uSpots*0.30), pen=smoothstep(0.58,0.74, s1*0.72+s2*0.28+uSpots*0.30);',
    '    col=mix(col, uSpotCol*1.9, (pen-umb)*0.85); col=mix(col, uSpotCol, umb); }',
    '  col += uStarCol*uFacula*lanes*(1.0-mu)*0.55;                 /* 谱斑：临边处才看得见的亮网络 */',
    '  col *= (1.0 - uLimbU*(1.0-mu));                              /* 临边昏暗 */',
    '  if(uCap>0.0){ float c=pow(abs(dot(Nw,normalize(uMagAxis))), 26.0); col=mix(col, vec3(1.0,1.0,1.25), clamp(c*uCap,0.0,1.0)); col+=vec3(0.5,0.65,1.0)*c*uCap*2.2; }',
    '  fragColor=vec4(col,1.0); }'
  ].join('\n');
  /* 星冕 / 日珥（屏幕空间加色叠加）。
     以前是画在一层放大的球壳上，结果外缘是一圈硬边、正面还铺满网纹——冕本来是往外连续变稀的等离子体，
     几何壳给不出这种衰减。改成从光球边缘往外按指数衰减的屏幕空间辉光：
       halo   —— 双段指数（内冕陡、外冕缓），对应密度随高度下降
       冕流   —— 沿方位角的低频调制（日冕的冕流与冕洞，随太阳活动周变形）
       日珥   —— 少数几个沿方位角的窄峰，只贴着边缘几个百分之一星半径 */
  SH.coronaF = GLSL_HEAD + GLSL_NOISE + '\n' + [
    'in vec2 vNdc; uniform vec2 uRes, uCenter; uniform vec3 uStarCol; uniform float uStarR, uTime, uProm, uCorona; out vec4 fragColor;',
    'void main(){ vec2 sp=vec2((vNdc.x*0.5+0.5)*uRes.x, (0.5-vNdc.y*0.5)*uRes.y); vec2 p=sp-uCenter;',
    '  float d=length(p)/max(uStarR,1.0); if(d<0.985){ fragColor=vec4(0.0); return; }',
    '  float ang=atan(p.y,p.x); vec2 cs=vec2(cos(ang),sin(ang));',
    '  float e=d-1.0;',
    '  float halo=exp(-e/0.085)*0.50 + exp(-e/0.40)*0.20 + exp(-e/1.30)*0.045;',
    '  float streamer=0.45+0.85*pow(clamp(0.5+0.5*snoise(vec3(cs*2.1, uTime*0.02)),0.0,1.0), 1.7);',
    '  float prom=pow(clamp(0.5+0.5*snoise(vec3(cs*6.5, uTime*0.045)),0.0,1.0), 14.0)*exp(-e/0.055);',
    '  vec3 col=uStarCol*halo*streamer*uCorona + vec3(1.0,0.26,0.14)*prom*uProm*1.8;',
    '  fragColor=vec4(col*smoothstep(0.985,1.01,d), 1.0); }'
  ].join('\n');
  /* 彗发与彗尾（屏幕空间，加色叠加）：
       Whipple 1950 —— 脏雪球模型：彗核由冰与尘埃构成，近日时挥发出气体与尘埃
       Biermann 1951 —— 离子尾（I 型）由太阳风吹出，严格背向太阳，偏蓝（CO⁺ 的 420 nm 带）
       Finson & Probstein 1968 —— 尘埃尾（II 型）受轨道运动拖曳而弯曲，反射阳光，偏黄白
       彗发常呈绿色：C₂ 的 Swan 带。彗尾长度可达 0.1–1 AU，全部按活动度 uAct 缩放。 */
  SH.comaF = GLSL_HEAD + GLSL_NOISE + '\n' + [
    'in vec2 vNdc; uniform vec2 uRes, uCenter, uIonDir, uDustDir; uniform vec3 uComaCol, uIonCol, uDustCol;',
    'uniform float uComaR, uIonLen, uDustLen, uIonW, uDustW, uAct, uTime, uCurve, uHoleR; out vec4 fragColor;',
    'void main(){ vec2 sp=vec2((vNdc.x*0.5+0.5)*uRes.x, (0.5-vNdc.y*0.5)*uRes.y); vec2 p=sp-uCenter; if(uAct<=0.0){ fragColor=vec4(0.0); return; }',
    '  float d=length(p);',
    '  float coma=exp(-d/max(uComaR,1.0))*0.62 + exp(-d/max(uComaR*0.26,1.0))*0.85;',
    /* 中心留一个洞：真实彗发会把彗核完全盖住（这正是乔托号/罗塞塔必须飞过去才拍得到核的原因），
       但那样这幅画面里就只剩一团雾。这里把最内圈的彗发挖掉，让核的轮廓读得出来（示意，HUD 里注明）。 */
    '  coma *= mix(0.30, 1.0, smoothstep(uHoleR*0.75, uHoleR*2.2, d));',
    '  vec2 ip=vec2(dot(p,uIonDir), dot(p,vec2(-uIonDir.y,uIonDir.x)));',
    '  float iw=uIonW*(0.35+0.95*clamp(ip.x/max(uIonLen,1.0),0.0,1.0));',
    '  float ion=smoothstep(0.0, uIonW*0.9, ip.x)*exp(-abs(ip.y)/max(iw,1.0))*exp(-ip.x/max(uIonLen,1.0));',
    '  ion*=0.50+0.55*snoise(vec3(ip.x*0.012, ip.y*0.004+uTime*0.05, 3.0));   /* 离子尾的条纹（Alfvén 波扰动，示意） */',
    '  vec2 dp=vec2(dot(p,uDustDir), dot(p,vec2(-uDustDir.y,uDustDir.x)));',
    '  float off=dp.y - uCurve*dp.x*dp.x/max(uDustLen,1.0);',
    '  float dw=uDustW*(0.30+1.25*clamp(dp.x/max(uDustLen,1.0),0.0,1.0));',
    '  float dust=smoothstep(0.0, uDustW*0.9, dp.x)*exp(-abs(off)/max(dw,1.0))*exp(-dp.x/max(uDustLen,1.0));',
    '  dust*=0.62+0.40*snoise(vec3(dp.x*0.006, off*0.006, 8.0));',
    '  vec3 col=uComaCol*max(coma,0.0)*0.62 + uIonCol*max(ion,0.0)*0.62 + uDustCol*max(dust,0.0)*0.52;',
    '  fragColor=vec4(col*uAct, 1.0); }'
  ].join('\n');
  SH.atmF = GLSL_HEAD + [
    'in vec3 vN; in vec3 vW; uniform vec3 uCamW, uSunW, uAtm; uniform mat3 uRot; uniform float uAtmDensity; out vec4 fragColor;',
    'void main(){ vec3 Nw=normalize(uRot*normalize(vN)); vec3 V=normalize(uCamW-vW); float mu=max(dot(Nw,V),0.0); float ndl=dot(Nw,uSunW);',
    '  float glow=pow(1.0-mu,4.0)*1.6; float sun=clamp(ndl*1.4+0.5,0.0,1.0); fragColor=vec4(uAtm*glow*sun*uAtmDensity, glow*sun*uAtmDensity*0.9); }'
  ].join('\n');
  // 环（行星光环 / 早期尘埃环）
  SH.ringV = GLSL_HEAD + [
    'layout(location=0) in vec2 aRT; uniform mat4 uVP, uModel; uniform float uInner,uOuter; out vec2 vRT; out vec3 vO;',
    'void main(){ float r=mix(uInner,uOuter,aRT.x); float a=aRT.y*6.2831853; vec3 o=vec3(cos(a)*r,0.0,sin(a)*r); vO=o; vRT=aRT; gl_Position=uVP*uModel*vec4(o,1.0); }'
  ].join('\n');
  SH.ringF = GLSL_HEAD + GLSL_NOISE + '\n' + [
    'in vec2 vRT; in vec3 vO; uniform int uMode; uniform vec3 uColor, uSunO, uDoppler; uniform float uAlpha, uTime, uInner, uOuter, uCassini; out vec4 fragColor;',
    'void main(){ float r=vRT.x; float a=vRT.y*6.2831853; float alpha, shade=1.0; vec3 col=uColor;',
    /* uMode==2：吸积盘（示意）。温度按 Shakura & Sunyaev 1973 的薄盘标度 T ∝ R^{−3/4}：
       内缘蓝白、外缘橙红；再叠一层差动旋转（Ω ∝ R^{−3/2}）的湍流条纹，
       以及相对论性集束（Doppler beaming）——转向观察者的一侧明显更亮。 */
    '  if(uMode==2){ float rr=mix(uInner,uOuter,r)/max(uOuter,1e-6); float t=pow(max(rr,0.02),-0.75);',
    '    float spin=uTime*0.55*pow(max(rr,0.05),-1.5);',
    '    float turb=0.5+0.5*snoise(vec3(cos(a+spin)*3.0, r*22.0, sin(a+spin)*3.0));',
    '    float fil=0.5+0.5*snoise(vec3(cos(a+spin)*9.0, r*70.0, sin(a+spin)*9.0));',
    '    vec3 hot=vec3(0.85,0.93,1.0), warm=vec3(1.0,0.72,0.34), cool=vec3(0.95,0.36,0.14);',
    '    col = t>1.9 ? mix(warm,hot,clamp((t-1.9)/1.6,0.0,1.0)) : mix(cool,warm,clamp((t-1.0)/0.9,0.0,1.0));',
    '    float beam = 1.0 + 1.25*dot(normalize(vec3(-sin(a),0.0,cos(a))), uDoppler)*pow(max(1.0-rr,0.0),0.5);',
    '    float rad = smoothstep(0.0,0.10,r)*smoothstep(1.0,0.72,r);',
    '    alpha = rad*(0.55+0.45*turb)*uAlpha; col *= 0.34*(0.55+0.9*turb+0.5*fil)*max(beam,0.12)*pow(max(t,0.2),0.35);',
    '    fragColor=vec4(col*alpha, alpha); return; }',
    '  if(uMode==0){ /* 光环：径向条纹 + 卡西尼缝 */',
    '    float n1=snoise(vec3(r*40.0,0.0,0.0))*0.5+0.5, n2=snoise(vec3(r*160.0,3.0,0.0))*0.5+0.5;',
    '    alpha = smoothstep(0.0,0.05,r)*smoothstep(1.0,0.9,r)*(0.35+0.5*n1+0.25*n2);',
    '    if(uCassini>0.5) alpha *= 1.0-0.85*smoothstep(0.58,0.61,r)*smoothstep(0.68,0.65,r);',
    '    alpha *= uAlpha; col = uColor*(0.75+0.35*n1);',
    '    /* 行星阴影 */ float d=dot(vO,uSunO); vec3 q=vO-uSunO*d; if(d<0.0 && length(q)<1.0) shade=0.15;',
    '  } else { /* 尘埃环：雾蒙蒙、缓慢旋转 */',
    '    vec3 p=vec3(cos(a-uTime*0.02)*(0.5+r*2.0), r*3.0, sin(a-uTime*0.02)*(0.5+r*2.0));',
    '    float f=0.0, w=0.5, fr=1.0; for(int i=0;i<4;i++){ f+=w*snoise(p*fr); fr*=2.0; w*=0.5; }',
    '    float rad = smoothstep(0.0,0.25,r)*smoothstep(1.0,0.55,r);',
    '    alpha = (0.35+0.65*(f*0.5+0.5))*rad*uAlpha; col=uColor*(0.8+0.4*(f*0.5+0.5)); }',
    '  fragColor=vec4(col*shade*alpha, alpha); }'
  ].join('\n');
  // 天空 / 太空背景
  SH.skyV = GLSL_HEAD + 'layout(location=0) in vec2 aPos; out vec2 vNdc; void main(){ vNdc=aPos; gl_Position=vec4(aPos,0.9999,1.0); }';
  SH.skyF = GLSL_HEAD + [
    'in vec2 vNdc; uniform mat4 uInvVP; uniform vec3 uCamL, uSunL, uAtm, uFogColor, uStarColor, uMoonDir, uBHDir; uniform float uAtmDensity, uAltitude, uFog, uSpace, uTime, uUnder, uHorizonDip, uLimb, uMoonLit, uMoonR, uMeteor, uSunAng, uBHShadow, uStarDim; uniform vec3 uWaterFog; out vec4 fragColor;',
    'float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }',
    'float vnoi(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y), mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y), f.z); }',
    /* 星点：三档亮度（亮星更大更亮），银河带加密；夜里必须看得见单颗星 */
    'vec3 stars(vec3 d){ vec3 p=d*90.0; vec3 c=floor(p); vec3 f=fract(p)-0.5; float h=hash13(c); vec3 j=vec3(hash13(c+1.3),hash13(c+2.7),hash13(c+5.1))-0.5; float dd=length(f-j*0.6);',
    '  float band=1.0-abs(dot(d,normalize(vec3(0.3,1.0,0.25)))); float thr=0.80-band*band*0.20; float b=smoothstep(thr,1.0,h); float tw=0.78+0.22*sin(uTime*3.0+h*40.0);',
    '  float st=b*(smoothstep(0.17,0.02,dd)*0.9 + smoothstep(0.07,0.0,dd)*1.5 + step(0.985,h)*smoothstep(0.26,0.05,dd)*1.2)*tw;',
    '  vec3 col=mix(vec3(0.72,0.82,1.0), vec3(1.0,0.88,0.66), hash13(c+9.0)); return col*st*1.5+vec3(0.03,0.035,0.055)*band*band*band; }',
    /* 卫星（示意）：满相圆面 + 月海斑块 + 边缘暗化 + 淡晕，夜景的主要参照物 */
    'vec3 moonDisc(vec3 d){ if(uMoonLit<=0.001) return vec3(0.0); float md=dot(d,uMoonDir); if(md<uMoonR-0.004) return vec3(0.0);',
    '  float disc=smoothstep(uMoonR-0.000045, uMoonR+0.000045, md); vec3 t=normalize(d-uMoonDir*md);',
    '  float rr=clamp(sqrt(max(1.0-md*md,0.0))/max(sqrt(max(1.0-uMoonR*uMoonR,1e-9)),1e-6),0.0,1.0);',
    '  float mare=0.70+0.30*smoothstep(0.35,0.62,vnoi(t*7.0+13.0)); float grit=0.90+0.10*vnoi(t*46.0);',
    '  float limb=0.55+0.45*sqrt(max(1.0-rr*rr,0.0));',
    '  float halo=exp(-(1.0-md)/0.00055)*0.30 + exp(-(1.0-md)/0.006)*0.06;',
    '  return (vec3(1.05,1.02,0.95)*mare*grit*limb*disc*1.6 + vec3(0.62,0.70,0.88)*halo)*uMoonLit; }',
    /* 流星（示意）：同时最多 3 颗，各自沿一条大圆弧划过，头亮尾淡。只有有大气的行星、只在夜里出现，
       频率由 uMeteor 给（大气越厚、离小行星带/彗星轨道越近越频繁）。这是动画，静帧里未必抓得到。 */
    'vec3 meteorAt(vec3 d){ if(uMeteor<=0.001) return vec3(0.0); vec3 acc=vec3(0.0);',
    '  for(int i=0;i<3;i++){ float fi=float(i); float period=(9.0+fi*4.0)/max(uMeteor,0.03);',
    '    float tp=(uTime+fi*3.7)/period, sd=floor(tp), ph=fract(tp); if(ph>0.12) continue;',
    '    vec3 A=normalize(vec3(hash13(vec3(sd,fi,1.0))*2.0-1.0, 0.25+0.70*hash13(vec3(sd,fi,2.0)), hash13(vec3(sd,fi,3.0))*2.0-1.0));',
    '    vec3 B=normalize(vec3(hash13(vec3(sd,fi,4.0))*2.0-1.0, hash13(vec3(sd,fi,5.0))*0.6-0.35, hash13(vec3(sd,fi,6.0))*2.0-1.0));',
    '    vec3 T=B-A*dot(A,B); if(length(T)<1e-3) continue; T=normalize(T);',
    '    float len=0.16+0.20*hash13(vec3(sd,fi,7.0)); float head=-len+(ph/0.12)*2.0*len;',
    '    float s=atan(dot(d,T), dot(d,A)); vec3 near=A*cos(s)+T*sin(s); float off=length(d-near);',
    '    float tail=0.40*len; float along=clamp((head-s)/tail,0.0,1.0); float on=step(s,head)*step(head-tail,s);',
    '    float fade=smoothstep(0.0,0.012,ph)*smoothstep(0.12,0.09,ph);',
    '    acc += vec3(1.0,0.93,0.78)*(1.0-along)*on*smoothstep(0.0035,0.0,off)*fade*2.4; }',
    '  return acc; }',
    'void main(){ vec4 p0=uInvVP*vec4(vNdc,-1.0,1.0); vec4 p1=uInvVP*vec4(vNdc,0.0,1.0); vec3 dir=normalize(p1.xyz/p1.w-p0.xyz/p0.w);',
    /* 黑洞的引力透镜（示意）：把视线方向按 θ→θ+k·θ_sh²/θ 往外掰一点再去采背景星空，
       于是本该被挡住的星被"绕"到阴影边缘、堆成一圈；阴影内全黑，边缘再加一道光子环。
       真实解要积分零测地线（θ_sh = √27 GM/c²D），这里只是同一量级的近似。 */
    '  float bhIn=0.0, bhRing=0.0;',
    '  if(uBHShadow>0.0){ float ca=clamp(dot(dir,uBHDir),-1.0,1.0); float th=acos(ca); float ts=uBHShadow;',
    '    if(th<ts){ bhIn=1.0; } else { float bend=1.15*ts*ts/max(th,1e-5); vec3 t=normalize(dir-uBHDir*ca); float th2=min(th+bend,3.1415);',
    '      dir=normalize(uBHDir*cos(th2)+t*sin(th2)); }',
    '    bhRing=exp(-pow((th-ts)/(ts*0.035),2.0))*0.85 + exp(-pow((th-ts)/(ts*0.30),2.0))*0.09; }',
    '  vec3 sky=(stars(dir)+moonDisc(dir))*(1.0-bhIn);',
    '  float sd=max(dot(dir,uSunL),0.0); float ang=acos(clamp(dot(dir,uSunL),-1.0,1.0));',
    '  float sr = uSunAng>0.0 ? uSunAng : 0.0053; /* 日面视半径：默认 1 AU 处的 ≈0.3°，远处按 1/距离 缩小 */',
    '  vec3 sun=uStarColor*(smoothstep(sr,sr*0.792,ang)*7.0 + exp(-ang/(sr*2.4528))*0.85 + exp(-ang/0.10)*0.16)*(uStarDim>0.0?uStarDim:1.0);',
    '  if(uSpace<0.5){ float dens=uAtmDensity*exp(-max(uAltitude,0.0)/14000.0); float up=dir.z; float sunEl=uSunL.z; float day=smoothstep(-0.22,0.25,sunEl);',
    '    vec3 zenith=uAtm*0.42*day; vec3 horizon=mix(uAtm*1.15, vec3(1.0,0.55,0.3), smoothstep(0.3,-0.05,sunEl)*0.65)*day; horizon=mix(horizon, uFogColor*day, uFog);',
    '    float t=pow(1.0-clamp(up,0.0,1.0),4.0); vec3 atm=mix(zenith,horizon,t);',
    '    float a=clamp(dens*(1.0+t*1.6)*1.1*(0.12+0.88*day),0.0,1.0); /* 夜里大气不再把星空洗掉 */',
    '    atm += vec3(0.030,0.038,0.062)*(1.0-day)*(0.5+0.5*t) + uAtm*0.11*uMoonLit*(1.0-day)*(0.35+0.65*max(uMoonDir.z,0.0))*(0.4+0.6*t); /* 夜天光 + 月光散射 */',
    '    sky=mix(sky*(1.0-a*0.85), atm, a) + sun*(0.25+0.75*a) + uStarColor*pow(sd,10.0)*0.25*a;',
    '    if(up<0.0) sky=mix(sky, horizon*0.5, clamp(-up*12.0,0.0,1.0)*a);',
    '    sky += uAtm*exp(-pow((up-uHorizonDip)/0.045,2.0))*uLimb*(0.3+0.7*day) + uAtm*exp(-pow((up-uHorizonDip)/0.25,2.0))*uLimb*0.15*day;',
    '    if(up>uHorizonDip) sky += meteorAt(dir)*(1.0-day);   /* 流星只在夜里、只在地平线以上 */',
    '    if(uUnder>0.5){ sky=mix(uWaterFog, uWaterFog*1.4, clamp(up,0.0,1.0)); vec3 q=dir*40.0+vec3(0.0,0.0,uTime*0.15); vec3 cq=floor(q); float hq=hash13(cq); vec3 fq=fract(q)-0.5; float sp=smoothstep(0.985,1.0,hq)*smoothstep(0.12,0.0,length(fq-(vec3(hash13(cq+2.1),hash13(cq+4.2),hash13(cq+6.3))-0.5)*0.6)); sky+=vec3(0.35,0.3,0.2)*sp; } }',
    '  else sky+=sun*(1.0-bhIn);',
    '  if(uBHShadow>0.0) sky = sky*(1.0-bhIn) + vec3(1.0,0.93,0.82)*bhRing;',
    '  fragColor=vec4(sky,1.0); }'
  ].join('\n');
  // 地表地形（极坐标网格，顶点着色器采样高度场）
  var GLSL_TERRAIN_COMMON = [
    'uniform vec3 uUp,uEast,uNorth; uniform float uRMin,uRMax; uniform mat4 uVP; uniform float uHm;',
    'vec3 sphereN(vec2 d){ float r=length(d); float a=r/uPlanetR; vec3 dir = r>1e-6 ? (uEast*d.x+uNorth*d.y)/r : uEast; return normalize(cos(a)*uUp+sin(a)*dir); }',
    'vec3 localPos(vec2 d, float hm){ float r=length(d); float a=r/uPlanetR; float R=uPlanetR+hm; vec2 dir = r>1e-6 ? d/r : vec2(1.0,0.0); return vec3(dir*R*sin(a), R*cos(a)-uPlanetR); }',
    'vec2 gridD(vec2 g){ float r = g.x<=0.0 ? 0.0 : uRMin*pow(uRMax/uRMin, g.x); float s=g.y*6.2831853; return vec2(cos(s),sin(s))*r; }'
  ].join('\n');
  /* 高度场必须是行星固定坐标的纯函数：倍频数 uOct 与差分步长 uNormEps 都是「每颗行星一个常量」，
     不含相机高度、不含到相机的距离 r、不含帧号。旧版按 r 与相机高度削减倍频（uLodBase），
     而这套 fbm 的各倍频振幅相等，掉一档就是几十上百米——镜头一动，已经画出来的山会自己长高/塌陷，
     远近之间还会撕出竖条状的裂缝。几何 LOD 只保留「网格疏密」（gridD 的环距），高度场本身不再随视点变。 */
  SH.terrainV = GLSL_HEAD + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_TERRAIN_COMMON + '\n' + [
    'layout(location=0) in vec2 aGrid; uniform vec3 uSunL; uniform float uNormEps; out vec3 vN; out vec4 vFld; out vec3 vPosL; out vec3 vNormalL; out float vHm; out float vLogW; out float vShadow;',
    'void main(){ vec2 d=gridD(aGrid); float r=length(d);',
    '  vec3 n=sphereN(d); vec4 f=fieldAt(n,uOct); float hm=(f.x-uHRef)*uHRange;',
    '  float e=uNormEps; vec4 fx=fieldAt(sphereN(d+vec2(e,0.0)),uOct), fy=fieldAt(sphereN(d+vec2(0.0,e)),uOct); /* 差分步长 = 最细倍频波长的 0.4：法线与几何同频，且同样与相机无关 */',
    '  vNormalL=normalize(vec3(-(fx.x-f.x)*uHRange/e*2.7, -(fy.x-f.x)*uHRange/e*2.7, 1.0)); /* 光照法线坡度 ×2.7：山脊/谷地的明暗对比更强（hillshade 常规做法） */',
    '  /* 地形自阴影：沿太阳方向步进 6 次，步长固定（米）。这是光照项不是几何，远处平滑淡出（硬截断会随相机移动扫出一圈明暗边） */',
    '  float sh=0.0; float hz=length(uSunL.xy); float shFade=1.0-smoothstep(uRMax*0.26,uRMax*0.34,r);',
    '  if(uSunL.z>0.02 && hz>1e-4 && shFade>0.002){ vec2 dirH=uSunL.xy/hz; float slope=uSunL.z/hz; int oc2=min(uOct,4); float step0=uNormEps*1.5+6.0;',
    '    float hm0=(fieldAt(n,oc2).x-uHRef)*uHRange; /* 光线起点也用同一档倍频，否则两档之间的系统差会假造出满地的阴影 */',
    '    for(int k=1;k<=5;k++){ float t=float(k)*float(k)*step0*1.4; vec4 f2=fieldAt(sphereN(d+dirH*t),oc2); float h2=(f2.x-uHRef)*uHRange; sh=max(sh, smoothstep(0.0, 20.0+t*0.05, h2-(hm0+slope*t))); } sh*=shFade; }',
    '  vShadow=sh; vec3 p=localPos(d,hm); vN=n; vFld=f; vPosL=p; vHm=hm; gl_Position=uVP*vec4(p,1.0); vLogW=1.0+gl_Position.w; }'
  ].join('\n');
  var TERRAIN_MAIN = [
    'in vec3 vN; in vec4 vFld; in vec3 vPosL; in vec3 vNormalL; in float vHm; in float vLogW; in float vShadow; uniform vec3 uCamL,uSunL,uSunO,uSkyHorizon,uWaterFog,uMoonL; uniform float uFogDist,uUnder,uStarLum,uFar,uFogK,uMoonI; uniform int uCityN; uniform vec4 uCity[24]; uniform float uCityRot[24]; out vec4 fragColor;',
    'float h12(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    /* 夜间点状灯火（示意）：格子里随机一点，格距随距离放大，保证远处也是一颗一颗数得清而不是糊成一片 */
    'float lampDots(vec2 pw, float cell, float p){ vec2 gp=pw/cell, gi=floor(gp), gf=fract(gp)-0.5; float hv=h12(gi);',
    '  if(hv>p) return 0.0; vec2 jt=(vec2(h12(gi+11.3),h12(gi+27.7))-0.5)*0.72; return smoothstep(0.055,0.006,length(gf-jt)); }',
    /* 城市坐标的地形扭曲（与 CPU cityWarpAt 逐字对应，建筑生成用同一套，房子才不会压在马路上）：
       两层球面噪声（特征尺度 ≈3 km / 1.1 km）+ 两条正弦——路网随地形起伏弯折，不再是标准正交网格 */
    'vec2 cityWarp(vec3 n, vec2 q, float a){ float F=uPlanetR/3000.0;',
    '  vec2 o=vec2(snoise(n*F), snoise(n*(F*2.7)+4.0))*95.0;',
    '  return vec2(q.x+o.x+34.0*sin(q.y/540.0+a*7.0), q.y+o.y+34.0*sin(q.x/500.0+a*11.0+1.7)); }',
    /* 到最近一条网格线的距离（米）与线号 */
    'vec2 gridLine(float w, float S){ float k=floor(w/S+0.5); return vec2(abs(w-k*S), k); }',
    /* 细线覆盖率：像素在地面上的足迹比线宽还大时，按占空比整体变淡，而不是把线摊成一条几十米的黑带 */
    'float lineCov(float d, float hw, float aa){ return clamp((hw-d)/aa+0.5,0.0,1.0)*min(1.0, 2.0*hw/max(aa,1e-3)); }',
    /* 点光源（路灯）覆盖率：同样按像素足迹衰减，几公里外是一串数得清的小点，而不是糊成一条发光带 */
    'float dotCov(float d, float rad, float aa){ return clamp((rad-d)/aa+0.5,0.0,1.0)*min(1.0, rad*rad/max(aa*aa,1e-4)); }',
    /* 屋顶色板：低矮房屋不值得一栋一个体块（几万个实例也铺不满），改在地面上画一层屋顶马赛克，
       体块只留给 8 m 以上、真会在天际线上留下轮廓的楼——这样几公里外看过去才是密密的一片屋顶而不是草地上插着柱子 */
    'vec3 roofPal(float t){ if(t<0.30) return vec3(0.40,0.385,0.365); if(t<0.52) return vec3(0.54,0.335,0.255); if(t<0.70) return vec3(0.62,0.585,0.515); if(t<0.86) return vec3(0.475,0.445,0.400); return vec3(0.70,0.685,0.645); }',
    'void main(){ gl_FragDepth=log2(vLogW)/log2(uFar+1.0); vec3 N=normalize(vNormalL); Surf S=shadeSurface(vN,vFld,N.z);',
    '  float dist=length(uCamL-vPosL); vec3 V=(uCamL-vPosL)/max(dist,1e-3);',
    '  /* 近场微地形：法线扰动，波长固定 ~45 m（按行星半径换算）。掠射角处像素覆盖太大，必须淡出，否则满屏椒盐 */',
    '  float graze = smoothstep(0.10,0.40, clamp(dot(N,V),0.0,1.0));',
    '  if(dist<6000.0 && S.water<0.5 && graze>0.01){ float w=(1.0-smoothstep(1800.0,6000.0,dist))*graze; float bf=uPlanetR*0.1396, e=0.15/bf;',
    '    float b0=snoise(vN*bf), bx=snoise((vN+vec3(e,0.0,0.0))*bf), by=snoise((vN+vec3(0.0,e,0.0))*bf);',
    '    N=normalize(N+vec3(-(bx-b0),-(by-b0),0.0)*w*1.1*clamp(N.z,0.12,1.0)); }  /* 陡壁上 N.z 很小，扰动要按比例收，否则法线乱摆成一层绒毛 */',
    /* ---- 城市地面：两级路网（主干道 + 支路，路宽分级、按线号随机缺口）、街区色块、公园、棚户带、农田与路灯 ---- */
    '  float urb=0.0, fields=0.0, road=0.0, sub=0.0, art=0.0, loc=0.0, shanty=0.0, lamp=0.0, park=0.0, hedge=0.0, blkH=0.0, plaza=0.0, roofA=0.0; vec3 fieldTint=vec3(1.0), roofC=vec3(0.5);',
    '  float nightF=1.0-clamp(uSunL.z*3.0+0.2,0.0,1.0);',
    '  float aa=max(0.7, dist*0.0016);   /* 抗锯齿半宽随像素覆盖放大：远处的路不再是一排闪烁的虚线 */',
    '  if(S.water<0.5){ for(int i=0;i<24;i++){ if(i>=uCityN) break; vec4 c=uCity[i]; vec2 d=vPosL.xy-c.xy; float dist2=length(d); if(dist2>c.z*24.0) continue; float a=uCityRot[i]; float ca=cos(a), sa=sin(a); vec2 q=vec2(d.x*ca-d.y*sa, d.x*sa+d.y*ca);',
    '      sub=max(sub, (1.0-smoothstep(c.z*1.1, c.z*24.0, dist2))*c.w); /* 城郊 → 远郊：灯火密度向外衰减，几十公里外仍能看出城的方向 */',
    '      float u=(1.0-smoothstep(c.z*0.66, c.z*1.18, dist2))*c.w;                                            /* 建成区 */',
    '      float sh=(1.0-smoothstep(c.z*1.06, c.z*1.66, dist2))*smoothstep(c.z*0.60, c.z*1.02, dist2)*c.w;      /* 棚户/城中村带：密度由内向外衰减 */',
    '      float fl=(1.0-smoothstep(c.z*1.45, c.z*3.2, dist2))*(1.0-u)*c.w*step(0.35,vFld.z);                  /* 农田 */',
    '      if(u>0.004 || sh>0.004){ vec2 w=cityWarp(vN,q,a); float A=780.0+300.0*sin(a*1.7), L=116.0+30.0*sin(a*2.9);',
    '        vec2 gx=gridLine(w.x,A), gy=gridLine(w.y,A); float artW=8.5+3.0*h12(vec2(gx.y,7.0));               /* 主干道半宽 8.5–11.5 m（双向六车道量级） */',
    '        float aM=max(lineCov(gx.x,artW,aa)*step(0.10,h12(vec2(gx.y,3.0))), lineCov(gy.x,artW,aa)*step(0.10,h12(vec2(gy.y,9.0))));',
    '        vec2 lx=gridLine(w.x,L), ly=gridLine(w.y,L); float locW=2.6+1.3*h12(vec2(lx.y,ly.y));               /* 支路半宽 2.6–3.9 m */',
    '        float kx=step(0.20,h12(vec2(lx.y,1.7)))*step(0.14,h12(vec2(lx.y,floor(w.y/(L*3.0)))));              /* 整条街缺失 + 分段缺失 = 不完整网格 */',
    '        float ky=step(0.20,h12(vec2(5.3,ly.y)))*step(0.14,h12(vec2(floor(w.x/(L*3.0)),ly.y)));',
    '        float lM=max(lineCov(lx.x,locW,aa)*kx, lineCov(ly.x,locW,aa)*ky);',
    '        lM*=(1.0-smoothstep(11000.0,30000.0,dist));                                                        /* 远处只留主干道，支路收掉免摩尔纹 */',
    '        float built=max(u, sh*0.8); art=max(art, aM*built); loc=max(loc, lM*u); urb=max(urb,u); shanty=max(shanty, sh);   /* 支路只在建成区：棚户带走的是不成网的土路，房子也不按街区摆 */',
    '        float bh=h12(vec2(lx.y,ly.y)); blkH=mix(blkH, bh, step(urb-0.001, u));',
    '        float free=(1.0-max(aM,lM));',
    '        park=max(park, step(0.90, h12(vec2(lx.y+31.0, ly.y+17.0)))*u*free);                                /* 少数地块留绿地 */',
    '        plaza=max(plaza, step(0.955, h12(vec2(lx.y-13.0, ly.y+41.0)))*u*free);                             /* 广场/停车场 */',
    '        float rfade=1.0-smoothstep(7000.0,17000.0,dist);',
    '        if(rfade>0.01){ float cell=mix(7.0,17.0,step(0.5,u))+5.0*h12(vec2(lx.y,ly.y+3.0));                 /* 屋顶马赛克：建成区 ~20 m、棚户带 ~9 m 一格 */',
    '          vec2 rq=w/cell; vec2 ri=floor(rq), rf=abs(fract(rq)-0.5);',
    '          float dens=max(u*0.86, sh*0.92), lot=1.0-smoothstep(0.32,0.46,max(rf.x,rf.y));',
    '          float rm=step(h12(ri+0.5), dens)*lot*free*rfade*max(u,sh);',
    '          if(rm>roofA){ roofA=rm; float rt=h12(ri+11.7); roofC = sh>u ? mix(vec3(0.50,0.40,0.30), vec3(0.63,0.60,0.56), rt) : roofPal(rt); roofC*=0.90+0.20*h12(ri-5.1); } }',
    '        if(nightF>0.02){ float lr=2.2, laa=max(0.8, aa*1.3);                                               /* 路灯：主干道每 42 m 一盏、支路每 74 m，落在路缘 */',
    '          float la=dotCov(length(vec2(gx.x-(artW+2.4), (fract(w.y/42.0)-0.5)*42.0)), lr, laa);',
    '          float lb=dotCov(length(vec2(gy.x-(artW+2.4), (fract(w.x/42.0)-0.5)*42.0)), lr, laa);',
    '          float lc2=dotCov(length(vec2(lx.x-(locW+1.8), (fract(w.y/60.0)-0.5)*60.0)), lr*0.8, laa)*kx*step(0.40,h12(vec2(lx.y,2.9)));   /* 只有一部分支路装了灯 */',
    '          float ld=dotCov(length(vec2(ly.x-(locW+1.8), (fract(w.x/60.0)-0.5)*60.0)), lr*0.8, laa)*ky*step(0.40,h12(vec2(8.1,ly.y)));',
    '          lamp=max(lamp, max(max(la,lb), max(lc2,ld))*built); } }',
    '      if(fl>fields){ fields=fl; vec2 w2=cityWarp(vN,q,a); float ps=170.0+230.0*h12(floor(w2/2400.0));       /* 田块：尺寸/朝向按地块随机 */',
    '        vec2 pc=floor(w2/ps); float ph=h12(pc), ph2=h12(pc+3.7);',
    '        fieldTint=mix(vec3(0.82,0.96,0.58), vec3(1.18,1.02,0.66), ph); if(ph>0.78) fieldTint=vec3(1.06,0.88,0.66); if(ph<0.12) fieldTint=vec3(0.68,0.72,0.55);',
    '        vec2 pf=abs(fract(w2/ps)-0.5); hedge=max(smoothstep(0.44,0.5,pf.x), smoothstep(0.44,0.5,pf.y))*(0.5+0.5*ph2);',
    '        vec2 rx=gridLine(w2.x,1440.0), ry=gridLine(w2.y,1440.0);',
    '        road=fl*max(lineCov(rx.x,3.4,aa), lineCov(ry.x,3.4,aa)); } } }',
    '  if(fields>0.0){ S.col=mix(S.col, S.col*fieldTint, fields*0.75); S.col=mix(S.col, S.col*0.72, hedge*fields*0.5); S.col=mix(S.col, vec3(0.31,0.29,0.27), road*0.85); }',
    '  if(urb>0.0||shanty>0.0){ vec3 con=mix(vec3(0.50,0.485,0.455), vec3(0.74,0.705,0.645), blkH)*(0.90+0.20*snoise(vN*90000.0));',
    '    S.col=mix(S.col, con, urb*0.66);   /* 只盖到 0.66：街区之间还透着行道树/院子的绿，不是一整片水泥板 */',
    '    S.col=mix(S.col, mix(vec3(0.20,0.30,0.14), uVeg0, 0.55), park*0.85);',
    '    S.col=mix(S.col, vec3(0.58,0.56,0.52), plaza*0.7);',
    '    S.col=mix(S.col, vec3(0.44,0.34,0.26)*(0.85+0.3*snoise(vN*160000.0)), shanty*0.62);                     /* 棚户带：土路土色 */',
    '    S.col=mix(S.col, roofC, roofA*0.92);                                                                    /* 屋顶马赛克 */',
    '    S.col=mix(S.col, vec3(0.185,0.185,0.195), art*0.92);                                                    /* 沥青主干道 */',
    '    S.col=mix(S.col, vec3(0.235,0.235,0.240), loc*0.86);',
    '    if(nightF>0.02){ float ub=max(urb, shanty*0.75);',
    '      S.emis+=vec3(1.0,0.86,0.56)*lamp*nightF*3.0;                                                          /* 路灯：点光源按通量守恒衰减（dotCov），所以峰值要给足，远处才还看得见一串灯 */',
    '      float wcell=46.0+dist*0.020;                                                                          /* 远处不画体块的那些房子：门窗光落成一颗颗可数的点（格距随距离放大，不糊成一片） */',
    '      float w1=lampDots(vPosL.xy+vec2(71.0,133.0), wcell, clamp(ub*0.78,0.0,0.78));',
    '      float w2=lampDots(vPosL.xy+vec2(-211.0,57.0), wcell*2.1, clamp(ub*0.9,0.0,0.85))*1.4;',
    '      S.emis+=vec3(1.0,0.82,0.52)*(w1+w2)*nightF*1.3;',
    '      S.emis+=vec3(1.0,0.76,0.46)*ub*(0.55+0.45*snoise(vN*9000.0))*nightF*0.075; } }                        /* 再垫一层很淡的暖底光（车灯/店面/地面反照，示意） */',
    '  /* 城外村镇灯火（示意）：低海拔、湿润、缓坡处才有；近城更密，远处仍是可数的孤点 */',
    '  if(uLights>0.01 && nightF>0.02 && S.water<0.5 && uUnder<0.5){ float el=uSea<0.0?vFld.x:clamp((vFld.x-uSea)/(1.0-uSea),0.0,1.0);',
    '    float hab=smoothstep(0.18,0.5,vFld.z)*(1.0-smoothstep(0.32,0.68,el))*smoothstep(0.55,0.85,vNormalL.z/max(length(vNormalL),1e-3))*(1.0-S.ice);',
    '    float cell=185.0+dist*0.016; float dens=uLights*hab*(0.10+0.80*sub);',
    '    float outside=1.0-clamp(max(urb, shanty*0.85),0.0,1.0);   /* 城里已经有自己的路灯/窗光，村镇灯火只留给城外，否则城区会糊成一片白 */',
    '    float v1=lampDots(vPosL.xy, cell, clamp(dens*0.85,0.0,0.75));',
    '    float v2=lampDots(vPosL.xy+vec2(311.0,-97.0), cell*3.3, clamp(dens*1.5,0.0,0.9))*1.5; /* 大一号的镇：几颗更亮的 */',
    '    S.emis+=vec3(1.0,0.83,0.55)*(v1+v2)*nightF*(0.8+1.6*sub)*outside; }',
    '  float grain=(snoise(vN*250000.0)*0.05+snoise(vN*40000.0)*0.04)*(1.0-S.water)*(1.0-smoothstep(2000.0,20000.0,dist))*graze;',
    '  vec3 col=S.col*(1.0+grain);',
    '  float sunUp=clamp(uSunL.z*3.0+0.2,0.0,1.0); float diff=max(dot(N,uSunL),0.0)*sunUp;',
    '  /* 云影：把云层沿太阳方向投到地面 */ float csh=0.0; if(uCloud>0.02){ vec3 hor=uSunO-vN*dot(uSunO,vN); vec3 sp=normalize(vN - hor*(9000.0/uPlanetR)/max(uSunL.z,0.2)); csh=cloudAt(sp)*0.72; }',
    '  diff *= (1.0-0.85*vShadow)*(1.0-csh);',
    '  float moon=max(dot(N,uMoonL),0.0)*uMoonI*nightF; /* 月光：夜面的方向光，靠它读出山脊/河谷的轮廓 */',
    '  vec3 lit=col*(diff*1.35*uStarLum + 0.028+0.082*sunUp + 0.18*sunUp*min(uAtmDensity,1.0)*(1.0-0.5*vShadow)) + col*vec3(0.62,0.72,1.0)*(moon*1.1+uMoonI*nightF*0.12);',
    '  vec3 H=normalize(uSunL+V); lit+=vec3(1.0,0.97,0.9)*pow(max(dot(N,H),0.0),30.0)*S.spec*0.5*sunUp;',
    '  float fog = uUnder>0.5 ? 1.0-exp(-dist/45.0) : min(1.0-exp(-dist*uFogK/uFogDist), 0.93); vec3 fc = uUnder>0.5 ? uWaterFog : uSkyHorizon;',
    '  vec3 outc=mix(lit,fc,fog)+S.emis*(1.0-fog*0.55);',
    '  /* 城市霾：远处的城不画完整几何，只留剪影 + 这层霾——几十公里外的城区因此是一片发灰发黄的雾，而不是一格格的方块 */',
    '  float haze=clamp(max(urb, shanty*0.75)*smoothstep(2500.0,20000.0,dist),0.0,1.0);',
    '  if(haze>0.002){ vec3 hz=mix(uSkyHorizon, vec3(0.70,0.68,0.63)*(0.18+0.82*sunUp), 0.42); outc=mix(outc, hz, haze*0.5);',
    '    outc+=vec3(1.0,0.70,0.36)*haze*nightF*0.13; }   /* 夜里远处城区的辉光（大气散射，示意） */',
    '  outc = outc/(1.0+0.30*max(outc-0.85,0.0)); /* 高光肩部：雪原/冰面不再糊成一片死白，还能看出起伏 */',
    '  fragColor=vec4(pow(max(outc,0.0),vec3(0.9)),1.0); }'
  ].join('\n');
  SH.waterV = GLSL_HEAD + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_TERRAIN_COMMON + '\n' + [
    'layout(location=0) in vec2 aGrid; out vec3 vN; out vec3 vPosL; out float vLogW;',
    'void main(){ vec2 d=gridD(aGrid); vec3 n=sphereN(d); vec3 p=localPos(d,uHm); vN=n; vPosL=p; gl_Position=uVP*vec4(p,1.0); vLogW=1.0+gl_Position.w; }'
  ].join('\n');
  SH.terrainF = GLSL_HEAD + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_SURF + '\n' + TERRAIN_MAIN;
  var terrainSrcCache = {};
  /* 地表飞越的片元着色器同样一个类型一个程序：它也把六种地表全装着，通用版链接要 16 秒。 */
  SH.terrainFor = function (k) {
    if (terrainSrcCache[k]) return terrainSrcCache[k];
    return (terrainSrcCache[k] = GLSL_HEAD + '#define SURFKIND ' + k + '\n' + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_SURF + '\n' + TERRAIN_MAIN);
  };
  SH.waterF = GLSL_HEAD + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_SURF + '\n' + [
    'in vec3 vN; in vec3 vPosL; in float vLogW; uniform vec3 uCamL,uSunL,uSkyHorizon,uSkyZenith,uWaterFog; uniform float uFogDist,uUnder,uStarLum,uFar,uFogK; out vec4 fragColor;',
    'void main(){ gl_FragDepth=log2(vLogW)/log2(uFar+1.0); int oct=max(uOct-4,3); vec4 f=fieldAt(vN,oct); float depth=(uHRef-f.x)*uHRange; if(depth<-3.0) discard;',
    '  float dist=length(uCamL-vPosL); vec3 V=(uCamL-vPosL)/max(dist,1e-3);',
    '  vec3 lc = uLavaSea>0.5 ? mix(vec3(0.9,0.25,0.03), vec3(1.0,0.75,0.25), 0.5+0.5*snoise(vN*30000.0+uTime*0.3)) : vec3(0.0);',
    '  vec3 wn=normalize(vec3(snoise(vec3(vN.xy*90000.0, uTime*0.5))*0.045, snoise(vec3(vN.yz*70000.0+5.0, uTime*0.4))*0.045, 1.0));',
    '  float fres=pow(1.0-max(dot(wn,V),0.0),5.0)*0.85+0.06; float sunUp=clamp(uSunL.z*3.0+0.2,0.0,1.0);',
    '  vec3 waterCol=mix(uOceanShallow, uOceanDeep, smoothstep(0.0,350.0,depth))*(0.25+0.75*sunUp*uStarLum);',
    '  vec3 skyRef=mix(uSkyHorizon,uSkyZenith,0.35); vec3 col=mix(waterCol, skyRef, fres);',
    '  vec3 H=normalize(uSunL+V); col+=vec3(1.0,0.95,0.85)*pow(max(dot(wn,H),0.0),500.0)*2.2*sunUp*uSpec + vec3(1.0,0.9,0.8)*pow(max(dot(wn,H),0.0),40.0)*0.15*sunUp*uSpec;',
    '  float foam=(1.0-smoothstep(0.0,3.5,depth))*(0.45+0.55*smoothstep(0.2,0.8,snoise(vec3(vN.xy*400000.0, uTime*0.6)))) + (1.0-smoothstep(3.5,14.0,depth))*0.25*smoothstep(0.55,0.95,snoise(vec3(vN.yz*250000.0, uTime*0.4))); col=mix(col, vec3(0.9,0.93,0.95)*(0.3+0.7*sunUp), foam*0.9);',
    '  float alpha=clamp(0.5+0.45*fres+smoothstep(0.0,25.0,depth)*0.35+foam*0.4,0.0,0.97);',
    '  if(uLavaSea>0.5){ col=lc*(0.7+0.3*smoothstep(0.0,40.0,depth)); alpha=0.98; }',
    '  float fog = uUnder>0.5 ? 1.0-exp(-dist/45.0) : min(1.0-exp(-dist*uFogK/uFogDist), 0.93); vec3 fc = uUnder>0.5 ? uWaterFog : uSkyHorizon;',
    '  fragColor=vec4(mix(col,fc,fog),alpha); }'
  ].join('\n');
  SH.cloudF = GLSL_HEAD + GLSL_NOISE + '\n' + GLSL_FIELD + '\n' + GLSL_SURF + '\n' + [
    'in vec3 vN; in vec3 vPosL; in float vLogW; uniform vec3 uCamL,uSunL,uSkyHorizon; uniform float uFogDist,uStarLum,uFar,uFogK; out vec4 fragColor;',
    'void main(){ gl_FragDepth=log2(vLogW)/log2(uFar+1.0); float c=cloudAt(vN); if(c<0.01) discard; float dist=length(uCamL-vPosL); float sunUp=clamp(uSunL.z*3.0+0.2,0.0,1.0);',
    '  float below = uCamL.z < vPosL.z ? 1.0 : 0.0; float thick=smoothstep(0.1,0.9,c);',
    '  /* 云底：厚处暗、边缘亮，从下面看才有体积而不是一层灰顶棚 */',
    '  vec3 col=uCloudColor*(0.25+0.75*sunUp*uStarLum)*(1.0-below*(0.12+0.5*thick));',
    '  float fog=min(1.0-exp(-dist*uFogK/(uFogDist*3.0)),0.93); col=mix(col*1.08, uSkyHorizon, fog); fragColor=vec4(col, pow(c,1.45)*(1.0-fog*0.4)*(0.55+0.45*sunUp)); }'
  ].join('\n');
  /* ---------------- 气态巨行星 / 冰巨星的云顶飞越（没有固体表面，不能走地形那条路） ----------------
     几层同心球壳，高度相对 **1 bar 参考面**（z=0）按大气标高 H 排布：深层霾底 / 次层云带 / 主云顶 / 高层薄云 / 顶部霾。
     每层的颜色只由行星固定方向 n 决定 —— 纬向带（与球面视图 uGas 分支同一套公式，轨道上看到的带纹和钻进云里看到的是同一组）
     + 沿经度拉长的湍流条纹 + 卵形涡旋 + 沿太阳方向的方向导数（云顶起伏的明暗）。
     颜色随距离混进霾色、壳的网格边缘按 vR 淡出：没有硬地平线，也没有一圈生硬的壳边。 */
  /* 大尺度的量（纬向带、宽车道、云团起伏、沿太阳方向的方向导数）都放在顶点算：
     它们的特征尺度是几公里到几千公里，插值到片元完全够用，片元里只留最细的两档 + 涡旋。 */
  SH.gasV = GLSL_HEAD + GLSL_NOISE + '\nuniform float uPlanetR;\n' + GLSL_TERRAIN_COMMON + '\n' + [
    'layout(location=0) in vec2 aGrid; uniform vec3 uSunP; uniform float uCellM,uBumpAmp,uBandAmp,uTime,uDeckDetail;',
    'out vec3 vN; out vec3 vPosL; out float vLogW; out float vR; out float vBand; out float vLane; out float vRelief;',
    'void main(){ vec2 d=gridD(aGrid); vec3 n=sphereN(d); float F=uPlanetR/uCellM;',
    '  /* 纬向带：与球面视图 uGas 分支同一套公式，只由 n 决定（行星固定坐标） */',
    '  float turb = snoise(n*vec3(1.2,10.0,1.2)+vec3(uTime*0.010,0.0,0.0))*0.022 + snoise(n*vec3(4.0,30.0,4.0)+7.0)*0.008 + snoise(n*vec3(0.6,3.0,0.6)+3.0)*0.020;',
    '  float lane=0.0, rel=0.0;',
    '  if(uDeckDetail>0.01){',
    '    /* 云涌（同时用作垂直起伏）：特征尺度 ≈3×/17× 云胞（几十公里 × 十公里），这样极坐标网格在整个可见范围里都采得住，',
    '       云顶的轮廓线不会被切成一级级的锯齿。更细的云絮全部留给片元着色，不进几何。 */',
    '    lane = snoise(n*vec3(F*0.055,F*0.34,F*0.055)+3.0);',
    '    vec3 hor=uSunP-n*dot(uSunP,n); float hl=length(hor);',
    '    if(hl>1e-4){ vec3 nS=normalize(n+hor/hl*(uCellM*1.1/uPlanetR));',
    '      rel = snoise(nS*vec3(F*0.055,F*0.34,F*0.055)+3.0) - lane; }   /* 沿太阳方向的方向导数：明暗与实际起伏同源 */',
    '  }',
    '  /* 车道也搬动带号：一条云带宽几千公里，而能见度只有几十公里 —— 不这么做，镜头里就只剩单一颜色，',
    '     看不出「分层的纬向云带」。带内的明暗巷道本来就对应不同高度/成分的云顶，物理上说得过去。 */',
    '  vBand = clamp(n.y*0.5+0.5+turb*uBandAmp+lane*0.15*uBandAmp, 0.0, 1.0);',
    '  vLane=lane; vRelief=rel;',
    '  vec3 p=localPos(d, uHm + lane*uBumpAmp);',
    '  vN=n; vPosL=p; vR=length(d)/uRMax; gl_Position=uVP*vec4(p,1.0); vLogW=1.0+gl_Position.w; }'
  ].join('\n');
  SH.gasF = GLSL_HEAD + GLSL_NOISE + '\n' + [
    'in vec3 vN; in vec3 vPosL; in float vLogW; in float vR; in float vBand; in float vLane; in float vRelief; out vec4 fragColor;',
    'uniform sampler2D uPal; uniform vec3 uCamL,uSunL,uSunP,uSkyHorizon,uSunCol;',
    'uniform float uPlanetR,uFogDist,uFogK,uFar,uTime,uDeckAlpha,uDeckLum,uDeckDetail,uCellM,uStorm,uIce,uSunUp;',
    'void main(){ gl_FragDepth=log2(vLogW)/log2(uFar+1.0); vec3 n=normalize(vN);',
    '  float tex=0.5, fine=0.0, fineSh=1.0;',
    '  if(uDeckDetail>0.01){ float F=uPlanetR/uCellM;   /* 云絮：三档，都沿经度拉长（纬向急流），只影响颜色不影响几何 */',
    '    vec3 k1=vec3(F*0.26,F*1.70,F*0.26), o1=vec3(uTime*0.02,0.0,0.0);',
    '    float a1=snoise(n*k1+o1);',
    '    float a2=snoise(n*vec3(F*0.80,F*4.4,F*0.80)+11.0);',
    '    float a3=snoise(n*vec3(F*2.40,F*9.5,F*2.40)-5.0);',
    '    fine=0.55*a1+0.30*a2+0.15*a3;',
    '    tex=clamp(0.5+(0.24*vLane+0.26*a1+0.15*a2+0.09*a3)*uDeckDetail,0.0,1.0);',
    '    vec3 hor=uSunP-n*dot(uSunP,n); float hl=length(hor);',
    '    if(hl>1e-4) fineSh=clamp(1.0-(snoise(normalize(n+hor/hl*(uCellM*0.30/uPlanetR))*k1+o1)-a1)*0.85, 0.70, 1.34);   /* 云絮自己的迎光/背光面（逐像素，不进几何） */',
    '    float ov=snoise(n*vec3(2.2,15.0,2.2)+21.0);              /* 卵形涡旋：沿纬向拉长的白斑/暗斑 */',
    '    tex=mix(tex, clamp(tex+0.24,0.0,1.0), smoothstep(0.55,0.95,ov)*0.5*(1.0-uIce*0.55)); }',
    '  vec3 col=texture(uPal, vec2(tex, vBand)).rgb*(0.80+0.38*tex)*(1.0+0.30*fine*uDeckDetail);',
    '  if(uStorm>0.01){ vec2 sp=vec2(atan(-n.z,n.x), n.y)-vec2(0.9,-0.36); sp.x=mod(sp.x+3.14159,6.2831)-3.14159; float st=exp(-dot(sp*vec2(3.5,14.0),sp*vec2(3.5,14.0)));',
    '    col=mix(col, mix(col,vec3(0.75,0.35,0.22),0.7), st*uStorm); }',
    '  float dist=length(uCamL-vPosL); vec3 V=(uCamL-vPosL)/max(dist,1e-3);',
    '  float sunUp=uSunUp;   /* 每层各自的日照：高层的地平线更远，太阳落到本地地平线以下之后它还亮着（薄暮） */',
    '  float above = uCamL.z>vPosL.z ? 1.0 : 0.0;                 /* 1 = 俯看这层云顶；0 = 抬头看云底，暗一档 */',
    '  float sh=clamp(1.0-vRelief*1.1,0.72,1.30);                 /* 起伏的明暗要轻：云不是石头，硬阴影会立刻看成沙丘 */',
    '  vec3 lit=col*(uDeckLum*(0.13+0.90*sunUp))*mix(0.74,1.0,above)*mix(1.0,sh*fineSh,uDeckDetail);   /* 夜面留一点底光（巨行星有可观的内部热流），band 结构才读得出来 */',
    '  lit += uSunCol*pow(max(dot(-V,uSunL),0.0),6.0)*0.28*sunUp*uDeckAlpha;   /* 前向散射：朝太阳那一侧的云更亮 */',
    '  float fog=min(1.0-exp(-dist*uFogK/uFogDist),0.995); lit=mix(lit,uSkyHorizon,fog);',
    '  float grz=clamp(abs(V.z),0.03,1.0);                        /* 掠射角上同一层云更厚 */',
    '  float alpha=clamp(uDeckAlpha*(0.62+0.45*tex)/max(grz,0.16),0.0,1.0);',
    '  alpha*=1.0-smoothstep(0.72,0.995,vR);',
    '  fragColor=vec4(lit, alpha); }'
  ].join('\n');
  // 示意建筑体块（实例化）：城市位置来自 MirrorCityData（真实），建筑形态为过程生成的示意
  // 实例数据 aI0=(x, y, 地面 z, 高度 h)，aI1=(进深 sx, 面宽 sy, 偏航角, 材质类 + 随机数)；
  // vSeed 的整数部分 = 材质类（0 灰混凝土 / 1 米黄 / 2 红砖 / 3 深色玻璃 / 4 白粉刷 / 5 铁皮棚户 / 6 厂房仓储），小数部分 = 每栋的随机数（flat 插值，保证整数部分不被插值误差抹掉）
  SH.bldgV = GLSL_HEAD + [
    'layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec4 aI0; layout(location=3) in vec4 aI1;',
    'uniform mat4 uVP, uCityM; out vec3 vN; out vec3 vPosL; out vec2 vUv; flat out float vSeed; flat out float vH; out float vLogW; out float vRoof;',
    'void main(){ float c=cos(aI1.z), s=sin(aI1.z); vec2 p=vec2(aPos.x*aI1.x, aPos.y*aI1.y); vec2 pr=vec2(p.x*c-p.y*s, p.x*s+p.y*c); float hh=aI0.w+40.0; vec3 lp=vec3(aI0.xy+pr, aI0.z-40.0+aPos.z*hh);',
    '  vec4 w=uCityM*vec4(lp,1.0); vPosL=w.xyz; vec3 n=vec3(aNrm.x*c-aNrm.y*s, aNrm.x*s+aNrm.y*c, aNrm.z); vN=mat3(uCityM)*n; vRoof=aNrm.z;',
    '  vUv=vec2((aPos.x+0.5)*aI1.x + (aPos.y+0.5)*aI1.y, aPos.z*hh-40.0); /* v = 离地高度（米）：窗户从地面起排 */',
    '  vSeed=aI1.w; vH=aI0.w; gl_Position=uVP*w; vLogW=1.0+gl_Position.w; }'
  ].join('\n');
  SH.bldgF = GLSL_HEAD + [
    'in vec3 vN; in vec3 vPosL; in vec2 vUv; flat in float vSeed; flat in float vH; in float vLogW; in float vRoof; uniform vec3 uCamL,uSunL,uSkyHorizon; uniform float uFogDist,uFogK,uFar,uTree,uSil; out vec4 fragColor;',
    'float h13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }',
    'void main(){ gl_FragDepth=log2(vLogW)/log2(uFar+1.0); vec3 N=normalize(vN); float sunUp=clamp(uSunL.z*3.0+0.2,0.0,1.0); float diff=max(dot(N,uSunL),0.0)*sunUp; float night=1.0-sunUp;',
    '  float cls=floor(vSeed), rs=fract(vSeed), r2=fract(rs*97.13), r3=fract(rs*31.7);',
    '  vec3 base;',
    '  if(cls<0.5)      base=vec3(0.600,0.585,0.560);   /* 混凝土灰 */',
    '  else if(cls<1.5) base=vec3(0.800,0.735,0.605);   /* 米黄 */',
    '  else if(cls<2.5) base=vec3(0.560,0.345,0.265);   /* 红砖 */',
    '  else if(cls<3.5) base=vec3(0.235,0.285,0.335);   /* 深色玻璃幕墙 */',
    '  else if(cls<4.5) base=vec3(0.865,0.855,0.825);   /* 白粉刷 */',
    '  else if(cls<5.5) base=vec3(0.520,0.375,0.285);   /* 铁皮/土坯（棚户） */',
    '  else             base=vec3(0.400,0.420,0.450);   /* 厂房/仓储 */',
    '  base*=0.82+0.34*r2;                              /* 同一类里再抖一层，避免整城同色 */',
    '  if(vRoof>0.5){ vec3 roof=mix(vec3(0.285,0.275,0.265), vec3(0.470,0.430,0.375), r3);',
    '    if(cls>4.5&&cls<5.5) roof=mix(vec3(0.52,0.38,0.26), vec3(0.66,0.63,0.60), r3);   /* 铁皮屋顶反光 */',
    '    if(cls>5.5) roof=mix(vec3(0.48,0.49,0.50), vec3(0.62,0.62,0.60), r3);            /* 厂房浅色屋面 */',
    '    base=mix(roof, base, 0.18)*(0.86+0.28*h13(vec3(floor(vPosL.xy/2.6),cls)));       /* 屋顶杂物（水箱/风机）示意 */ }',
    '  if(uTree>0.5){ base=mix(vec3(0.12,0.3,0.1), vec3(0.3,0.45,0.15), rs); if(vRoof>0.5) base*=1.15; }',
    '  float ao=uTree>0.5?1.0:(0.55+0.45*smoothstep(0.0, min(13.0, vH*0.75), vUv.y));      /* 贴地一段压暗：楼根不再像悬空的白纸片 */',
    '  vec3 col=base*(diff*1.20+0.13+0.22*sunUp)*ao;',
    '  if(uTree<0.5 && uSil<0.5 && vRoof<0.5 && vH>5.5){',
    '    float wsp=3.2+1.2*r3, hsp=3.0+0.9*r2;',
    '    vec2 wg=vec2(vUv.x/wsp, (vUv.y-1.5)/hsp); vec2 wf=fract(wg), wi=floor(wg);',
    '    float pane=step(0.20,wf.x)*step(wf.x,0.80)*step(0.24,wf.y)*step(wf.y,0.84)*step(1.5,vUv.y);',
    '    col=mix(col, col*mix(0.50,0.82,r3), pane*0.6*sunUp);                              /* 白天：玻璃比墙暗 */',
    '    float p=0.16+0.44*r2;                                                             /* 每栋的亮灯率 16%–60%（随机点亮，不是整栋通亮） */',
    '    float lit=step(1.0-p, h13(vec3(wi, floor(vSeed*13.0))));',
    '    vec3 warm=mix(vec3(1.0,0.84,0.52), vec3(0.86,0.92,1.0), step(0.86,r3));            /* 少数冷白光 */',
    '    col+=warm*pane*lit*night*1.75; }',
    '  if(uSil>0.5) col+=vec3(1.0,0.82,0.52)*night*0.30*(1.0-vRoof);                        /* 远处剪影：只给一层整体辉光 */',
    '  col=mix(col, uSkyHorizon*0.92+vec3(0.02), uSil*0.42);                                /* 剪影向天色收，读作轮廓而不是实体 */',
    '  float dist=length(uCamL-vPosL); float fog=min(1.0-exp(-dist*uFogK/uFogDist),0.93); fragColor=vec4(pow(max(mix(col,uSkyHorizon,fog),0.0),vec3(0.9)),1.0); }'
  ].join('\n');
  // 精灵（恒星辉光、行星圆点、选中环）与线条、文字
  SH.spriteV = GLSL_HEAD + [
    'layout(location=0) in vec3 aPos; layout(location=1) in vec2 aCorner; layout(location=2) in float aSize; layout(location=3) in vec4 aColor; layout(location=4) in vec3 aLight; layout(location=5) in float aKind;',
    'uniform mat4 uVP; uniform vec2 uRes; out vec2 vUv; out vec4 vColor; out vec3 vLight; out float vKind;',
    'void main(){ vec4 c=uVP*vec4(aPos,1.0); c.xy+=aCorner*aSize/uRes*2.0*c.w; gl_Position=c; vUv=aCorner; vColor=aColor; vLight=aLight; vKind=aKind; }'
  ].join('\n');
  SH.spriteF = GLSL_HEAD + [
    'in vec2 vUv; in vec4 vColor; in vec3 vLight; in float vKind; out vec4 fragColor;',
    'void main(){ float r2=dot(vUv,vUv); vec3 col; float a;',
    '  if(vKind<0.5){ float g=exp(-r2*4.0)*0.75+exp(-r2*60.0)*1.6; col=vColor.rgb*g; a=clamp(g,0.0,1.0)*vColor.a; if(a<0.003) discard; fragColor=vec4(col*vColor.a,0.0); return; }',
    '  else if(vKind<1.5){ if(r2>1.0) discard; vec3 n=vec3(vUv.x,-vUv.y,sqrt(1.0-r2)); float d=max(dot(n,normalize(vLight)),0.0)*0.92+0.08; col=vColor.rgb*d; a=smoothstep(1.0,0.82,r2)*vColor.a; }',
    '  else { float ring=smoothstep(0.66,0.74,r2)*smoothstep(1.0,0.9,r2); col=vColor.rgb; a=ring*vColor.a; if(a<0.01) discard; }',
    '  fragColor=vec4(col*a,a); }'
  ].join('\n');
  SH.lineV = GLSL_HEAD + 'layout(location=0) in vec3 aPos; uniform mat4 uVP; void main(){ gl_Position=uVP*vec4(aPos,1.0); }';
  SH.lineF = GLSL_HEAD + 'uniform vec4 uColor; out vec4 fragColor; void main(){ fragColor=vec4(uColor.rgb*uColor.a,uColor.a); }';
  SH.texV = GLSL_HEAD + 'layout(location=0) in vec2 aPos; uniform vec4 uRect; uniform vec2 uRes; out vec2 vUv; void main(){ vec2 p=uRect.xy+aPos*uRect.zw; gl_Position=vec4(p.x/uRes.x*2.0-1.0, 1.0-p.y/uRes.y*2.0, 0.0, 1.0); vUv=aPos; }';
  SH.texF = GLSL_HEAD + 'in vec2 vUv; uniform sampler2D uTex; uniform float uAlpha; out vec4 fragColor; void main(){ fragColor=texture(uTex,vUv)*uAlpha; }';

  /* ============================================================ 城市：真实数据（地球，MirrorCityData / Natural Earth）与示意生成（其它文明行星） */
  function cityRadiusM(pop) { return 2500 + 1600 * Math.sqrt(pop / 1e5); } // 人口 10 万 ≈ 4 km，100 万 ≈ 7.6 km，1000 万 ≈ 18.5 km
  var cityCache = {};
  function cityListFor(planet) {
    var key = (planet.visualKey || planet.type) + ':' + (planet.seed >>> 0); if (cityCache[key] !== undefined) return cityCache[key];
    var out = null;
    if (planet.visualKey === 'earth') { var CD = root && root.MirrorCityData; if (CD && CD.list && CD.list.length) out = { real: true, source: CD.source || 'Natural Earth', list: CD.list.map(function (c) { return { name: c.nameCn || c.name, nameEn: c.name, lat: c.lat, lon: c.lon, pop: c.pop, r: cityRadiusM(c.pop) }; }) }; }
    else if (planet.life && planet.life.rank >= 3) { // 示意：按行星种子在陆地上撒 60–160 座城市
      var maps = getMaps(planet, 512), vp0 = visualParams(planet, planet.nowYr), rnd = mulberry32((planet.seed ^ 0xC17155) >>> 0), list = [], n = 60 + Math.floor(rnd() * 100), tries = 0;
      while (list.length < n && tries < 4000) { tries++; var lat = (rnd() * 2 - 1) * 60 * DEG, lon = (rnd() * 2 - 1) * PI; var f = fieldAtCPU(maps, vp0, llToN(lat, lon), 3); if (vp0.sea >= 0 && f.h < vp0.sea) continue; if (f.moist < 0.3) continue; var pop = Math.round(Math.exp(lerp(Math.log(1e5), Math.log(2e7), Math.pow(rnd(), 2.2)))); list.push({ name: TR('聚落 ') + (list.length + 1), nameEn: '', lat: lat / DEG, lon: lon / DEG, pop: pop, r: cityRadiusM(pop) }); }
      out = { real: false, source: TR('过程生成（示意）'), list: list };
    }
    cityCache[key] = out; return out;
  }
  function buildCityTexture(cities) { // 2048×1024，R = 灯光强度（人口加权高斯溅射）
    var W = 2048, H = 1024, acc = new Float32Array(W * H), kmPerTexel = 40075 / W;
    cities.list.forEach(function (c) { var rt = Math.max(0.55, c.r / 1000 / kmPerTexel * 1.3), I = 0.35 + 0.65 * clamp(Math.log10(c.pop / 1e5) / 2.6, 0, 1); var cx = (c.lon + 180) / 360 * W, cy = (c.lat + 90) / 180 * H, R = Math.ceil(rt * 3);
      var ix0 = Math.floor(cx), iy0 = Math.floor(cy); for (var dy = -R; dy <= R; dy++) { var y = iy0 + dy; if (y < 0 || y >= H) continue; for (var dx = -R; dx <= R; dx++) { var x = ((ix0 + dx) % W + W) % W; var ddx = x + 0.5 - cx, ddy = y + 0.5 - cy; if (Math.abs(ddx) > W / 2) ddx = W - Math.abs(ddx); var d2 = ddx * ddx + ddy * ddy; acc[y * W + x] += I * Math.exp(-d2 / (2 * rt * rt)) * Math.min(1, 0.9 / (rt * rt) + 0.35); } } });
    var data = new Uint8Array(W * H * 4); for (var i = 0; i < W * H; i++) { var v = clamp(acc[i], 0, 1) * 255; data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
    return { data: data, W: W, H: H };
  }
  /* 城市路网参数：只由城市位置决定（着色器侧从同一个 rot 用同样的平滑公式派生，CPU/GPU 无需再传 uniform）。
     着色器里 q = R(rot)·d（d = 相对城心的东/北偏移），所以建筑摆在 q 空间里，落回 d 空间时要转 −rot。 */
  function cityPlan(city) {
    var rot = mulberry32(hashStr(city.lat + ',' + city.lon))() * PI;
    return { rot: rot, A: 780 + 300 * Math.sin(rot * 1.7), L: 116 + 30 * Math.sin(rot * 2.9) };
  }
  // 与 GLSL cityWarp 逐字对应：路网随地形弯折（特征尺度 ≈3 km / 1.1 km 的球面噪声 + 两条正弦）
  function cityWarpAt(N, n, qx, qy, a, Rm) {
    var F = Rm / 3000, F2 = F * 2.7;
    var o0 = N.snoise(n[0] * F, n[1] * F, n[2] * F) * 95, o1 = N.snoise(n[0] * F2 + 4, n[1] * F2 + 4, n[2] * F2 + 4) * 95;
    return [qx + o0 + 34 * Math.sin(qy / 540 + a * 7), qy + o1 + 34 * Math.sin(qx / 500 + a * 11 + 1.7)];
  }
  var bldgCache = {}, bldgKeys = [];
  /* 示意建筑：先按城市路网划出街区，再把体块摆进街区内部（贴街一侧概率更高），最后按高度排序供远近三档 LOD 取前缀。
     高度分布：核心区少量塔楼 + 中层环 + 外围低矮住宅；棚户带小而密；远郊成组的村落。颜色分 7 类，各城权重不同。 */
  function buildingsFor(city, planet, maps, vp) {
    var key = (planet.seed >>> 0) + ':' + city.lat + ',' + city.lon; if (bldgCache[key]) return bldgCache[key];
    var plan = cityPlan(city), rot = plan.rot, A = plan.A, L = plan.L, ca = Math.cos(rot), sa = Math.sin(rot);
    var rnd = mulberry32(hashStr(key)), Rc = city.r, Rm = vp.radiusM, N = maps.noise;
    var latR = city.lat * DEG, lonR = city.lon * DEG, cl = Math.max(Math.cos(latR), 0.05);
    var popK = clamp(Math.log10(Math.max(city.pop, 2e4) / 5e4), 0.35, 2.4);
    var K = clamp(Math.round(2400 + city.pop / 110), 2400, 24000);
    // 每座城一套建材偏好（同 seed 同结果）：有的城以红砖为主，有的以米黄/白粉刷为主
    var pw = mulberry32(hashStr(key) ^ 0x5C0DE), wt = [0.22 + 0.5 * pw(), 0.15 + 0.75 * pw(), 0.08 + 0.85 * pw(), 0.10 + 0.55 * pw()], wsum = wt[0] + wt[1] + wt[2] + wt[3];
    var CLS = [0, 1, 2, 4]; // 灰 / 米黄 / 红砖 / 白
    function midClass(r) { var u = r * wsum; for (var j = 0; j < 4; j++) { if (u < wt[j]) return CLS[j]; u -= wt[j]; } return 0; }
    var induAz = pw() * TAU, induW = 0.5 + pw() * 0.7;   // 工业区方位（一个扇形）
    var recs = [], i;
    for (i = 0; i < K; i++) {
      var band, rr, u0 = rnd();
      if (u0 < 0.70) { band = 0; rr = Rc * Math.pow(rnd(), 0.75); }                    // 建成区（面密度 ∝ r^−0.67：向心集中）
      else if (u0 < 0.90) { band = 1; rr = Rc * (0.78 + 0.74 * Math.pow(rnd(), 0.7)); } // 棚户/城中村带
      else { band = 2; rr = Rc * (1.45 + 1.25 * rnd()); }                              // 远郊村落
      var th = rnd() * TAU, qx = rr * Math.cos(th), qy = rr * Math.sin(th);
      if (band === 2) { var cs = Math.floor(i / 7); var cr = mulberry32(hash32(cs ^ 0x9E37 ^ (hashStr(key) >>> 3))); th = cr() * TAU; rr = Rc * (1.45 + 1.25 * cr()); qx = rr * Math.cos(th) + (rnd() - 0.5) * 190; qy = rr * Math.sin(th) + (rnd() - 0.5) * 190; }
      function warpOf(ax, ay) { var dx = ax * ca + ay * sa, dy = -ax * sa + ay * ca; return cityWarpAt(N, llToN(latR + dy / Rm, lonR + dx / (Rm * cl)), ax, ay, rot, Rm); }
      var w = warpOf(qx, qy), wx = w[0], wy = w[1];
      var cls, h, sx, sy, yaw = -rot;
      var core = Math.exp(-(rr / (0.40 * Rc)) * (rr / (0.40 * Rc)));
      var azd = Math.abs(((th - induAz + PI * 3) % TAU) - PI);
      var indus = band === 0 && rr > Rc * 0.55 && azd < induW;
      if (band === 0) {
        // 街区内部：把体块推离街道中心线，并偏向贴街一侧（沿街成排，街心留院）
        var mrg = 7.5, half = L * 0.5;
        var kx = Math.round(wx / L), dxl = wx - kx * L, sgx = dxl >= 0 ? 1 : -1;
        var ky = Math.round(wy / L), dyl = wy - ky * L, sgy = dyl >= 0 ? 1 : -1;
        wx = kx * L + sgx * (mrg + Math.pow(rnd(), 2.0) * (half - mrg - 2));
        wy = ky * L + sgy * (mrg + Math.pow(rnd(), 2.0) * (half - mrg - 2));
        var ax = Math.abs(wx - Math.round(wx / A) * A); if (ax < 20) wx += (wx - Math.round(wx / A) * A >= 0 ? 1 : -1) * (20 - ax);
        var ay = Math.abs(wy - Math.round(wy / A) * A); if (ay < 20) wy += (wy - Math.round(wy / A) * A >= 0 ? 1 : -1) * (20 - ay);
        var ub = rnd();
        if (indus) { cls = rnd() < 0.72 ? 6 : 0; h = 7 + 9 * rnd(); sx = 45 + 80 * rnd(); sy = 24 + 46 * rnd(); }
        else if (ub < 0.012 + 0.26 * core * core) { cls = rnd() < 0.45 ? 3 : (rnd() < 0.5 ? 0 : 4); h = (32 + 150 * Math.pow(rnd(), 2.2)) * (0.40 + 0.38 * popK); sx = 23 + 22 * rnd(); sy = sx * (0.55 + 0.75 * rnd()); }
        else if (ub < 0.12 + 0.55 * core) { cls = midClass(rnd()); h = (10 + 24 * rnd()) * (0.55 + 0.26 * popK) * (0.62 + 0.55 * core); sx = 24 + 44 * rnd(); sy = 11 + 25 * rnd(); }
        else { cls = midClass(rnd()); h = 5.5 + 8 * rnd(); sx = 11 + 15 * rnd(); sy = 9 + 12 * rnd(); }   /* 更矮的一层留给地面的屋顶马赛克，体块只画得出轮廓的那些 */
        yaw = -rot + (rnd() - 0.5) * 0.10 + (rnd() < 0.07 ? (rnd() - 0.5) * 1.2 : 0);
      } else if (band === 1) {
        var g = 13 + 4 * rnd();                                            // 棚户：不守街区，只避开主干道
        wx = Math.round(wx / g) * g + (rnd() - 0.5) * g * 0.55; wy = Math.round(wy / g) * g + (rnd() - 0.5) * g * 0.55;
        var bx = Math.abs(wx - Math.round(wx / A) * A); if (bx < 18) wx += (wx - Math.round(wx / A) * A >= 0 ? 1 : -1) * (18 - bx);
        var by = Math.abs(wy - Math.round(wy / A) * A); if (by < 18) wy += (wy - Math.round(wy / A) * A >= 0 ? 1 : -1) * (18 - by);
        cls = rnd() < 0.72 ? 5 : (rnd() < 0.6 ? 2 : 1); h = 2.7 + 2.8 * rnd(); sx = 4.5 + 6.5 * rnd(); sy = 4 + 5.5 * rnd();
        yaw = -rot + (rnd() - 0.5) * 0.9;
      } else {
        cls = rnd() < 0.42 ? 4 : (rnd() < 0.5 ? 1 : 2); h = 3.6 + 5.2 * rnd(); sx = 9 + 12 * rnd(); sy = 7 + 10 * rnd();
        yaw = -rot + (rnd() - 0.5) * 1.6;
      }
      var qx1 = qx + (wx - w[0]), qy1 = qy + (wy - w[1]);
      var w2 = warpOf(qx1, qy1); qx1 += wx - w2[0]; qy1 += wy - w2[1];     // 二次修正：扭曲的高频分量随平移改变，一次线性外推不够（否则房子会骑到马路上）
      var x = qx1 * ca + qy1 * sa, y = -qx1 * sa + qy1 * ca;
      var lat = latR + y / Rm, lon = lonR + x / (Rm * cl), t = terrainMetersAt(maps, vp, lat, lon, 7);
      if (t.water) continue;                                               // 落到水里就不要这一栋（不再留一个零尺寸的空实例）
      var z = t.m - (x * x + y * y) / (2 * Rm);
      recs.push([x, y, z, h, sx, sy, yaw, cls + rnd() * 0.999]);
    }
    recs.sort(function (p, q) { return q[3] - p[3]; });                     // 按高度降序：远处只画前缀 = 天际线剪影
    var n = recs.length, data = new Float32Array(n * 8), o = 0;
    for (i = 0; i < n; i++) { var r = recs[i]; for (var j = 0; j < 8; j++) data[o++] = r[j]; }
    var b = { data: data, count: n, midCount: Math.min(n, Math.max(120, Math.round(n * 0.34))), silCount: Math.min(n, Math.max(60, Math.round(n * 0.09)), 320) };
    bldgCache[key] = b; bldgKeys.push(key); while (bldgKeys.length > 24) delete bldgCache[bldgKeys.shift()]; return b;
  }

  /* ============================================================ 线性代数（列主序 Float32Array） */
  function m4id() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function m4persp(fovy, aspect, near, far) { var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), m = new Float32Array(16); m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf; return m; }
  function m4lookAt(eye, c, up) { var z = v3norm(v3sub(eye, c)), x = v3norm(v3cross(up, z)), y = v3cross(z, x), m = new Float32Array(16); m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[12] = -v3dot(x, eye); m[13] = -v3dot(y, eye); m[14] = -v3dot(z, eye); m[15] = 1; return m; }
  function m4mul(a, b) { var o = new Float32Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  function m4rotX(a) { var c = Math.cos(a), s = Math.sin(a), m = m4id(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function m4rotY(a) { var c = Math.cos(a), s = Math.sin(a), m = m4id(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function m4rotZ(a) { var c = Math.cos(a), s = Math.sin(a), m = m4id(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function m4scale(s) { var m = m4id(); m[0] = m[5] = m[10] = s; return m; }
  function m4ortho(l, r, b, t, n, f) { var m = new Float32Array(16); m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n); m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1; return m; }
  function m4trans(v) { var m = m4id(); m[12] = v[0]; m[13] = v[1]; m[14] = v[2]; return m; }
  function m4invert(m) {
    var inv = new Float32Array(16), a = m;
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    var det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12]; if (!det) return m4id(); det = 1 / det; for (var i = 0; i < 16; i++) inv[i] *= det; return inv;
  }
  function m3of(m) { return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]); }
  function m4pt(m, v) { var x = v[0], y = v[1], z = v[2], w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; }
  function m4dir(m, v) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]; }
  function m4dirT(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]]; }
  function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; } function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; } function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function v3len(a) { return Math.sqrt(v3dot(a, a)); } function v3norm(a) { var l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  // 经纬 ↔ 物体空间单位向量（lon 向东为正；n = (cos lat cos lon, sin lat, -cos lat sin lon)）
  function llToN(lat, lon) { var cl = Math.cos(lat); return [cl * Math.cos(lon), Math.sin(lat), -cl * Math.sin(lon)]; }
  function nToLL(n) { return [Math.asin(clamp(n[1], -1, 1)), Math.atan2(-n[2], n[0])]; }
  function localBasis(lat, lon) { var s = Math.sin(lon), c = Math.cos(lon), sl = Math.sin(lat), cl = Math.cos(lat); return { up: [cl * c, sl, -cl * s], east: [-s, 0, -c], north: [-sl * c, cl, sl * s] }; }

  // CPU 侧高度场（与 GLSL fieldAt 一致；DETAIL_GAIN/DETAIL_BOOST 必须与 GLSL 里的同名常量一致）
  var DETAIL_GAIN = 0.55, DETAIL_BOOST = 2.2;
  function fieldAtCPU(maps, vp, n, oct) {
    var N = maps.noise, m = n;
    if (vp.drift > 0) { var c = [0.94, 0, -0.34], w = [N.snoise(n[0] * 1.7 + 7.1, n[1] * 1.7 + 7.1, n[2] * 1.7 + 7.1), N.snoise(n[0] * 1.7 + 3.3, n[1] * 1.7 + 3.3, n[2] * 1.7 + 3.3), N.snoise(n[0] * 1.7 + 11.7, n[1] * 1.7 + 11.7, n[2] * 1.7 + 11.7)]; m = v3norm([n[0] + (n[0] - c[0]) * vp.drift * 1.2 + w[0] * vp.drift * 0.35, n[1] + (n[1] - c[1]) * vp.drift * 1.2 + w[1] * vp.drift * 0.35, n[2] + (n[2] - c[2]) * vp.drift * 1.2 + w[2] * vp.drift * 0.35]); }
    var t = sampleMap(maps, Math.atan2(-m[2], m[0]) / TAU + 0.5, Math.asin(clamp(m[1], -1, 1)) / PI + 0.5);
    var a = vp.detailAmp * (0.15 + 1.35 * t[1]) * DETAIL_BOOST, f = vp.detailFreq, s = 0, ridge = smoothstep(0.4, 0.9, t[1]);
    if (oct >= 5) { m = [m[0] + N.snoise(m[0] * 3000 + 1, m[1] * 3000 + 1, m[2] * 3000 + 1) * 0.00006, m[1] + N.snoise(m[0] * 3000 + 2, m[1] * 3000 + 2, m[2] * 3000 + 2) * 0.00006, m[2] + N.snoise(m[0] * 3000 + 3, m[1] * 3000 + 3, m[2] * 3000 + 3) * 0.00006]; }
    for (var o = 0; o < oct; o++) { var v = N.snoise(m[0] * f, m[1] * f, m[2] * f); v = lerp(v, (1 - Math.abs(v)) * 1.6 - 0.8, ridge); s += a * v; f *= 2.05; a *= DETAIL_GAIN; }
    var h = t[0] + s;
    if (riversOn(vp) && oct >= 5) { var el = vp.sea < 0 ? h : clamp((h - vp.sea) / (1 - vp.sea), 0, 1), mw = [m[0] + N.snoise(m[0] * 140 + 1, m[1] * 140 + 1, m[2] * 140 + 1) * 0.0025, m[1] + N.snoise(m[0] * 140 + 5, m[1] * 140 + 5, m[2] * 140 + 5) * 0.0025, m[2] + N.snoise(m[0] * 140 + 9, m[1] * 140 + 9, m[2] * 140 + 9) * 0.0025], valley = smoothstep(0.45, 0.8, 1 - Math.abs(N.snoise(m[0] * 70 + 4, m[1] * 70 + 4, m[2] * 70 + 4))), w1 = 1 - Math.abs(N.snoise(mw[0] * 520 + 2, mw[1] * 520 + 2, mw[2] * 520 + 2)), w2 = 1 - Math.abs(N.snoise(mw[0] * 2900 + 8, mw[1] * 2900 + 8, mw[2] * 2900 + 8)); var rv = Math.max(smoothstep(0.982, 0.997, w1) * (0.4 + 0.6 * valley), smoothstep(0.988, 0.999, w2) * 0.7 * valley) * smoothstep(0.3, 0.65, t[2]) * (1 - smoothstep(0.06, 0.35, el)); h -= rv * 0.0022; }
    return { h: h, rough: t[1], moist: t[2], base: t[0] };
  }
  function riversOn(vp) { return vp.sea >= 0 && !(vp.lava > 0) && !vp.gas && vp.rangeM > 0; }
  function hRefOf(vp) { return vp.sea >= 0 ? vp.sea : 0.5; }
  /* 地形倍频数：**只由行星本身决定**（半径 / 细节基频），让最细一档的特征尺度落在 ~70 m。
     绝不能掺进相机高度或到相机的距离——那正是「镜头一动，画好的地形自己变形」的来源：
     这套 fbm 各倍频振幅相等，掉一档就是几十上百米的高差（实测同一经纬因相机高度差出 187–219 m）。 */
  function terrainOctOf(vp) { return clamp(Math.round(1 + Math.log(Math.max(vp.radiusM, 1) / (70 * Math.max(vp.detailFreq, 1))) / Math.log(2.05)), 5, 11); }
  // 法线差分步长：最细一档波长的 0.4，同样是每颗行星一个常量（地球 ≈30 m）
  function normEpsOf(vp) { return clamp(Math.max(vp.radiusM, 1) / (Math.max(vp.detailFreq, 1) * Math.pow(2.05, terrainOctOf(vp) - 1)) * 0.4, 3, 500); }
  function terrainMetersAt(maps, vp, lat, lon, oct) { var f = fieldAtCPU(maps, vp, llToN(lat, lon), oct == null ? terrainOctOf(vp) : oct); return { m: (f.h - hRefOf(vp)) * vp.rangeM, water: vp.sea >= 0 && f.h < vp.sea, f: f }; }
  // 气态星球某纬度所在的云带（y: 0 = 南极 … 1 = 北极）：与 buildPalette 的 gasBands 同一张表，HUD 与霾色都取自它
  function gasBandAt(vp, seed, y) {
    var bands = gasBands(vp, seed), i = 0;
    for (var k = 0; k < bands.length; k++) if (y >= bands[k].y0 && y < bands[k].y1) i = k;
    return { c: bands[i].c, light: (i % 2) === 0, idx: i, count: bands.length };
  }

  /* ============================================================ WebGL2 渲染器 */
  function getGL(canvas, extra) {
    var attrs = { antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false };
    if (extra) for (var k in extra) attrs[k] = extra[k];
    try { return canvas.getContext('webgl2', attrs); } catch (e) { return null; }
  }
  function GLR(gl) {
    var self = this; this.gl = gl; this.progs = {}; this.texCache = {}; this.textCache = {}; this.textKeys = []; this.gpu = {}; this.gpuKeys = [];
    this.vaos = []; this.buffers = [];   // 全部登记，dispose 时逐个删除（否则反复进出星球会一直吃显存）
    /* 着色器编译改成「先全部发出去，再按需/空闲收货」。
     * 原来 15 个程序是同步一个个来的：linkProgram 之后**立刻** getProgramParameter(LINK_STATUS)，
     * 而那句会把主线程钉在驱动里等这个程序编完。用户真机 dump 上这一整段是 1.67 秒
     * （enterMirrorMs.mbCreate=1682 / enterSystemMs.showSystem=1668）。
     * 现在分两步：
     *   issue()  只 createShader/compileShader/attachShader/linkProgram —— 全是入队，不问状态，没有同步点；
     *            15 个一口气发完，驱动可以并行编（有 KHR_parallel_shader_compile 就是真并行）。
     *   ready()  查 COMPLETION_STATUS_KHR（没这个扩展就直接认为好了），好了才 finish()。
     *   finish() 才做 LINK_STATUS + getActiveUniform（这两句才是真正会等的），拿到 uniform 表。
     * use() 里对没收货的程序当场 finish（等一个 ≪ 等十五个）；空闲时 pump() 一个个收，进层前就收完了。 */
    var PARALLEL = (function () { try { return gl.getExtension('KHR_parallel_shader_compile'); } catch (e) { return null; } })();
    this.parallel = !!PARALLEL;
    var pend = this.pending = {};     // name → {p, vs, fs}，已发出但还没取 uniform 的
    this.pendOrder = [];
    function issue(name, vs, fs) {
      function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }   // 不查 COMPILE_STATUS：留到 finish 一起报错
      var p = gl.createProgram(), v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f);
      pend[name] = { p: p }; self.pendOrder.push(name);
    }
    /** 这个程序编好了吗（不阻塞）。没有扩展时无从得知，返回 true 让 finish 去同步等。 */
    this.progReady = function (name) {
      var e = pend[name]; if (!e) return true;
      if (!PARALLEL) return true;
      try { return !!gl.getProgramParameter(e.p, PARALLEL.COMPLETION_STATUS_KHR); } catch (x) { return true; }
    };
    /** 收货：查链接结果 + 取 uniform 表。这一步才可能等驱动，所以只对需要的那个做。 */
    this.finishProg = function (name) {
      var e = pend[name]; if (!e) return self.progs[name];
      delete pend[name];
      var idx = self.pendOrder.indexOf(name); if (idx >= 0) self.pendOrder.splice(idx, 1);
      var p = e.p;
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('着色器链接失败 [' + name + ']: ' + gl.getProgramInfoLog(p));
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); var nm = info.name.replace('[0]', ''); u[nm] = { loc: gl.getUniformLocation(p, info.name), type: info.type }; }
      self.progs[name] = { p: p, u: u };
      return self.progs[name];
    };
    /** 空闲时收货：每次最多收 n 个**已经编好的**，没编好的跳过，绝不在这里等。返回还欠多少。 */
    this.pump = function (n) {
      var budget = n || 2;
      for (var i = 0; i < self.pendOrder.length && budget > 0;) {
        var nm = self.pendOrder[i];
        if (!self.progReady(nm)) { i++; continue; }
        try { self.finishProg(nm); } catch (err) { console.error('[MirrorPlanets] ' + err.message); self.finishErr = err; delete pend[nm]; var j = self.pendOrder.indexOf(nm); if (j >= 0) self.pendOrder.splice(j, 1); }
        budget--;
      }
      return self.pendOrder.length;
    };
    this.progsPending = function () { return self.pendOrder.length; };
    function compile(name, vs, fs) { issue(name, vs, fs); }
    /* 按需再发的那些：每个都是好几秒的编译，一次只发当前真要画的那一个，
       让驱动的编译线程别同时啃六个球面着色器 + 一个地表着色器。 */
    var LAZY = {};
    function lazy(name, vs, fs) { LAZY[name] = [vs, fs]; }
    this.hasLazy = function (name) { return !!LAZY[name]; };
    this.ensureProg = function (name) {
      var d = LAZY[name];
      if (!d || self.progs[name] || pend[name]) return false;
      issue(name, d[0], d[1]); return true;
    };
    compile('globeLo', SH.globeV, SH.globeLoF);   // 先发这个：它编得最快，正式的没好之前顶着
    compile('gasglobe', SH.globeV, SH.gasGlobeF); compile('atm', SH.globeV, SH.atmF); compile('ring', SH.ringV, SH.ringF); compile('sky', SH.skyV, SH.skyF);
    [0, 1, 3, 4, 5].forEach(function (k) { lazy('globeK' + k, SH.globeV, SH.globeFor(k)); });
    [0, 1, 3, 4, 5].forEach(function (k) { lazy('terrainK' + k, SH.terrainV, SH.terrainFor(k)); }); lazy('water', SH.waterV, SH.waterF); lazy('cloud', SH.waterV, SH.cloudF); lazy('gas', SH.gasV, SH.gasF);
    compile('sprite', SH.spriteV, SH.spriteF); compile('line', SH.lineV, SH.lineF); compile('tex', SH.texV, SH.texF); lazy('bldg', SH.bldgV, SH.bldgF);
    compile('star', SH.globeV, SH.starF); compile('corona', SH.skyV, SH.coronaF); compile('coma', SH.skyV, SH.comaF);   // 恒星近观 / 星冕（屏幕空间）/ 彗发彗尾
    // 网格
    function vao(setup) { var v = gl.createVertexArray(); self.vaos.push(v); gl.bindVertexArray(v); setup(); gl.bindVertexArray(null); return v; }
    function buf(target, data, usage) { var b = gl.createBuffer(); self.buffers.push(b); gl.bindBuffer(target, b); gl.bufferData(target, data, usage || gl.STATIC_DRAW); return b; }
    function dynBuf() { var b = gl.createBuffer(); self.buffers.push(b); return b; }
    (function sphere(segs) { var rings = segs / 2, pos = [], idx = []; for (var y = 0; y <= rings; y++) { var lat = (y / rings - 0.5) * PI, cl = Math.cos(lat), sl = Math.sin(lat); for (var x = 0; x <= segs; x++) { var lon = (x / segs) * TAU; pos.push(cl * Math.cos(lon), sl, -cl * Math.sin(lon)); } }
      for (y = 0; y < rings; y++) for (x = 0; x < segs; x++) { var a = y * (segs + 1) + x, b = a + segs + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
      self.sphereN = idx.length; self.sphereVAO = vao(function () { buf(gl.ARRAY_BUFFER, new Float32Array(pos)); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx)); }); })(192);
    (function annulus(nr, na) { var pos = [], idx = []; for (var r = 0; r <= nr; r++) for (var a = 0; a <= na; a++) pos.push(r / nr, a / na); for (r = 0; r < nr; r++) for (a = 0; a < na; a++) { var i0 = r * (na + 1) + a, i1 = i0 + na + 1; idx.push(i0, i0 + 1, i1, i0 + 1, i1 + 1, i1); }
      self.ringN = idx.length; self.ringVAO = vao(function () { buf(gl.ARRAY_BUFFER, new Float32Array(pos)); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx)); }); })(12, 180);
    (function polar(nr, ns) { var pos = [], idx = []; for (var r = 0; r <= nr; r++) for (var s = 0; s <= ns; s++) pos.push(r / nr, s / ns); for (r = 0; r < nr; r++) for (s = 0; s < ns; s++) { var i0 = r * (ns + 1) + s, i1 = i0 + ns + 1; idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); }
      self.terrN = idx.length; self.terrVAO = vao(function () { buf(gl.ARRAY_BUFFER, new Float32Array(pos)); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); buf(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx)); }); })(160, 336); // 方位向 336 段（1.07°/段）：山脊/海岸线不再切成多边形；径向 160 环（对数等距，投影到屏幕上约 3 行一环）
    this.quadVAO = vao(function () { buf(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); });
    this.uquadVAO = vao(function () { buf(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); });
    // 动态精灵与线条缓冲
    this.spriteBuf = dynBuf(); this.spriteVAO = vao(function () { gl.bindBuffer(gl.ARRAY_BUFFER, self.spriteBuf); var st = 14 * 4; [[0, 3, 0], [1, 2, 12], [2, 1, 20], [3, 4, 24], [4, 3, 40], [5, 1, 52]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, st, a[2]); }); });
    this.lineBuf = dynBuf(); this.lineVAO = vao(function () { gl.bindBuffer(gl.ARRAY_BUFFER, self.lineBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); });
    // 单位立方体（x,y ∈ [-0.5,0.5]，z ∈ [0,1]）+ 实例缓冲（示意建筑）
    (function cube() { var f = [[[0, 0, 1], [[-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]]], [[0, -1, 0], [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1]]], [[1, 0, 0], [[0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]]], [[0, 1, 0], [[0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1]]], [[-1, 0, 0], [[-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1]]]], data = [];
      f.forEach(function (face) { var n = face[0], q = face[1], idx = [0, 1, 2, 0, 2, 3]; idx.forEach(function (i) { data.push(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2]); }); });
      self.cubeN = data.length / 6; self.instBuf = dynBuf();
      self.bldgVAO = vao(function () { buf(gl.ARRAY_BUFFER, new Float32Array(data)); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ARRAY_BUFFER, self.instBuf); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(2, 1); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(3, 1); }); })();
    this.permDefault = this.tex2D(makeNoise(0x9E37).tex, 256, 1, { ui: true });
    this.lost = false;
  }
  /* 已经收好货的才算就绪。渲染路径只画就绪的程序，没就绪就退到 globeLo —— 绝不在这里等驱动。 */
  GLR.prototype.ready = function (name) { return !!this.progs[name]; };
  GLR.prototype.use = function (name, uniforms, textures) {
    // 还没收货就当场收这一个（等一个程序 ≪ 构造时等十五个）；正常情况下 pump 早就收完了
    var self0 = this, gl = this.gl;
    /* 走到 finishProg 就意味着**当场同步等驱动链接**（预热没赶上）。单独打点，验收时这一项应该是 0 次。 */
    var P = this.progs[name] || perfWrap('shaderLinkSync', name, function () { return self0.finishProg(name); });
    gl.useProgram(P.p);
    if (textures) for (var i = 0; i < textures.length; i++) { var te = textures[i]; gl.activeTexture(gl.TEXTURE0 + i);
      if (te && te.tex3) gl.bindTexture(gl.TEXTURE_3D, te.tex3); else gl.bindTexture(gl.TEXTURE_2D, te); }
    for (var k in uniforms) { var u = P.u[k]; if (!u) continue; var v = uniforms[k];
      switch (u.type) {
        case gl.FLOAT: if (v != null && typeof v !== 'number' && v.length !== undefined) gl.uniform1fv(u.loc, v); else gl.uniform1f(u.loc, v); break; case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: case gl.SAMPLER_3D: case gl.UNSIGNED_INT_SAMPLER_2D: gl.uniform1i(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break; case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break; case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break; case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      } }
    return P;
  };
  /* 3D 贴图（平铺细节贴图用）：三线性 + 三个方向都 REPEAT，这样按位置采样在球面上处处连续。 */
  GLR.prototype.tex3D = function (data, n) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_3D, null);
    return t;
  };
  GLR.prototype.det3 = function () { return { tex3: this.detailTex() }; };
  GLR.prototype.detailTex = function () {
    if (!this.detTex) { var d = makeDetailTex(); this.detTex = this.tex3D(d.data, d.N); }
    return this.detTex;
  };
  GLR.prototype.tex2D = function (data, w, h, opts) {
    var gl = this.gl, t = gl.createTexture(); opts = opts || {}; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!opts.premul);
    if (opts.ui) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, w, h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data);
    else if (opts.image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    var f = opts.nearest || opts.ui ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // 行星 GPU 资源：置换贴图、地形贴图、调色板（一次生成缓存）
  /* 换行星时不再同步生成整张贴图：
       · 先出一版 1/4 边长（像素数 1/16，实测 ~10 ms）的立刻上屏；
       · 全分辨率排进 mapQueue，由每帧的 mapQueueStep 分片跑，跑完再换上去并交叉淡入。
     缓存命中（同一颗再回来）时两条路都不走，和从前一样直接复用。 */
  GLR.prototype.planetGPU = function (planet, vp, size) {
    size = size || 512;
    var key = (planet.seed >>> 0) + ':' + (planet.visualKey || planet.type) + ':' + size;
    var g = this.gpu[key]; if (g) return g;
    var gl = this.gl, maps = mapCached(planet, size), lowres = false;
    if (!maps) {
      if (size >= 128 && this.progressiveMaps !== false) {
        maps = getMaps(planet, clamp(size >> 3, 32, 64));   // 占位：1/8 边长（512 → 64×32 约 3 ms，128 → 32×16 约 1 ms）
        lowres = true;
        mapQueuePush(planet, size);
      } else maps = getMaps(planet, size);
    }
    var pal = perfWrap('buildPalette', planet.type, function () { return buildPalette(planet, vp); });
    var self1 = this;
    g = perfWrap('gpuUpload', planet.type, function () {
      return { maps: maps, perm: self1.tex2D(maps.noise.tex, 256, 1, { ui: true }), map: self1.tex2D(maps.data, maps.W, maps.H, { nearest: true, repeat: true }), pal: self1.tex2D(pal.data, pal.W, pal.H, {}) };
    });
    g.lowres = lowres; g.fullSize = size; g.planet = planet; g.mapOld = null; g.fade = 1;
    g.cities = null; g.city = null; g.citiesTodo = true;
    if (!lowres) this.buildCities(g, planet);
    this.gpu[key] = g; this.gpuKeys.push(key);
    while (this.gpuKeys.length > 24) { var k0 = this.gpuKeys.shift(), old = this.gpu[k0]; gl.deleteTexture(old.perm); gl.deleteTexture(old.map); gl.deleteTexture(old.pal); if (old.mapOld) gl.deleteTexture(old.mapOld); if (old.city) gl.deleteTexture(old.city); delete this.gpu[k0]; }
    return g;
  };
  /* 每帧推一把贴图队列。跑完一张就把它换到对应的 GPU 对象上，旧的留着做交叉淡入。 */
  GLR.prototype.buildCities = function (g, planet) {
    if (!g || !g.citiesTodo) return;
    g.citiesTodo = false;
    var cities = perfWrap('cityList', planet.type, function () { return cityListFor(planet); });
    g.cities = cities;
    if (cities && cities.list.length) {
      var ct = perfWrap('cityTex', planet.type + ':' + cities.list.length, function () { return buildCityTexture(cities); });
      g.city = this.tex2D(ct.data, ct.W, ct.H, { repeat: true });
    }
  };
  GLR.prototype.gpuCached = function (planet, size) {
    return this.gpu[(planet.seed >>> 0) + ':' + (planet.visualKey || planet.type) + ':' + (size || 512)] || null;
  };
  GLR.prototype.pumpMaps = function (budgetMs) {
    if (!mapQueuePending()) return 0;
    var done = mapQueueStep(budgetMs == null ? 6 : budgetMs), gl = this.gl;
    for (var i = 0; i < done.length; i++) {
      var e = done[i], k = (e.planet.seed >>> 0) + ':' + (e.planet.visualKey || e.planet.type) + ':' + e.size;
      var g = this.gpu[k]; if (!g) continue;
      var tex = this.tex2D(e.done.data, e.done.W, e.done.H, { nearest: true, repeat: true });
      g.mapOld = g.map; g.mapsOld = g.maps; g.map = tex; g.maps = e.done; g.lowres = false; g.fade = 0;
      this.buildCities(g, e.planet);   // 这时全分辨率贴图已在缓存里，选址不再触发重算
    }
    return done.length;
  };
  /* 淡入推进：0 → 1 约 0.35 s。到 1 就把占位那张贴图删掉。 */
  GLR.prototype.stepFade = function (g, dt) {
    if (!g || g.fade >= 1) return 1;
    /* 每帧至少推进 1/120 秒的量：dt 可能是 0（宿主把时钟冻住做逐像素比对时就是这样），
       不给下限的话淡入会永远停在 0，屏幕上一直是那张低分辨率的占位图。 */
    g.fade = Math.min(1, g.fade + Math.max(dt, 1 / 120) / 0.35);
    if (g.fade >= 1 && g.mapOld) { this.gl.deleteTexture(g.mapOld); g.mapOld = null; g.mapsOld = null; }
    return g.fade;
  };
  GLR.prototype.textTex = function (text, size, color) {
    var key = text + '|' + size + '|' + (color || ''); var t = this.textCache[key]; if (t) return t;
    var cv = makeCanvas(4, 4), ctx = cv.getContext('2d'); var font = size + 'px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
    ctx.font = font; var w = Math.ceil(ctx.measureText(text).width) + 8, h = Math.ceil(size * 1.5); cv.width = w; cv.height = h; ctx = cv.getContext('2d'); ctx.font = font; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 3; ctx.fillStyle = color || '#e6e6e6'; ctx.fillText(text, 4, h / 2);
    t = { tex: this.tex2D(cv, w, h, { image: true, premul: true }), w: w, h: h }; this.textCache[key] = t; this.textKeys.push(key);
    while (this.textKeys.length > 80) { var k0 = this.textKeys.shift(); this.gl.deleteTexture(this.textCache[k0].tex); delete this.textCache[k0]; }
    return t;
  };
  GLR.prototype.drawText = function (text, x, y, size, color, alpha, W, H, dpr) {
    var gl = this.gl, t = this.textTex(text, Math.round(size * dpr), color);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    this.use('tex', { uRect: [x * dpr, y * dpr - t.h / 2, t.w, t.h], uRes: [W, H], uAlpha: alpha == null ? 1 : alpha, uTex: 0 }, [t.tex]);
    gl.bindVertexArray(this.uquadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
    return t.w / dpr;
  };
  /* 屏幕空间实色矩形：复用 textTex 那条 'tex' 管线（uRect 是设备像素的屏幕矩形），
     纹理换成 1×1 的纯色。滑杆的轨道条/刻度/手柄用它画，不新增着色器。
     颜色按字符串缓存，条数是常量级（滑杆只有四五种颜色）。 */
  GLR.prototype.solidTex = function (color) {
    this.solidCache = this.solidCache || {}; this.solidKeys = this.solidKeys || [];
    var key = color;
    if (this.solidCache[key]) return this.solidCache[key];
    var gl = this.gl, cv = makeCanvas(1, 1), c2 = cv.getContext('2d');
    c2.fillStyle = color; c2.fillRect(0, 0, 1, 1);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.solidCache[key] = tex; this.solidKeys.push(key);
    while (this.solidKeys.length > 16) { var k0 = this.solidKeys.shift(); gl.deleteTexture(this.solidCache[k0]); delete this.solidCache[k0]; }
    return tex;
  };
  GLR.prototype.drawScreenRect = function (x, y, w, h, color, alpha, W, H, dpr) {
    var gl = this.gl, tex = this.solidTex(color);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    this.use('tex', { uRect: [x * dpr, y * dpr, Math.max(1, w * dpr), Math.max(1, h * dpr)], uRes: [W, H], uAlpha: alpha == null ? 1 : alpha, uTex: 0 }, [tex]);
    gl.bindVertexArray(this.uquadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };
  GLR.prototype.drawSprites = function (list, VP, W, H) { // list: [{p:[x,y,z], size(px), color:[r,g,b,a], light:[x,y,z], kind}]
    if (!list.length) return; var gl = this.gl, data = new Float32Array(list.length * 6 * 14), o = 0, corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
    for (var i = 0; i < list.length; i++) { var s = list[i]; for (var c = 0; c < 6; c++) { data[o++] = s.p[0]; data[o++] = s.p[1]; data[o++] = s.p[2]; data[o++] = corners[c][0]; data[o++] = corners[c][1]; data[o++] = s.size; data[o++] = s.color[0]; data[o++] = s.color[1]; data[o++] = s.color[2]; data[o++] = s.color[3] == null ? 1 : s.color[3]; var l = s.light || [0, 0, 1]; data[o++] = l[0]; data[o++] = l[1]; data[o++] = l[2]; data[o++] = s.kind || 0; } }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    this.use('sprite', { uVP: VP, uRes: [W, H] }); gl.bindVertexArray(this.spriteVAO); gl.drawArrays(gl.TRIANGLES, 0, list.length * 6); gl.bindVertexArray(null);
  };
  GLR.prototype.drawLines = function (pts, VP, color, loop) {
    var gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    this.use('line', { uVP: VP, uColor: color }); gl.bindVertexArray(this.lineVAO); gl.drawArrays(loop === 'tri' ? gl.TRIANGLES : loop === 'fan' ? gl.TRIANGLE_FAN : loop === 'segments' ? gl.LINES : loop ? gl.LINE_LOOP : gl.LINE_STRIP, 0, pts.length / 3); gl.bindVertexArray(null);
  };
  // 释放全部 GPU 资源：程序、行星纹理组（含城市灯光图 ~8 MB）、文字纹理、permDefault、所有 VAO 与 buffer，最后主动丢弃上下文
  GLR.prototype.dispose = function (opts) {
    var gl = this.gl, k, i;
    try {
      for (k in this.progs) gl.deleteProgram(this.progs[k].p);
      for (k in this.gpu) { var g = this.gpu[k]; gl.deleteTexture(g.perm); gl.deleteTexture(g.map); gl.deleteTexture(g.pal); if (g.city) gl.deleteTexture(g.city); }
      for (k in this.textCache) gl.deleteTexture(this.textCache[k].tex);
      for (k in (this.solidCache || {})) gl.deleteTexture(this.solidCache[k]);
      for (k in this.texCache) { if (this.texCache[k]) gl.deleteTexture(this.texCache[k].tex || this.texCache[k]); }
      if (this.permDefault) gl.deleteTexture(this.permDefault);
      for (i = 0; i < this.vaos.length; i++) gl.deleteVertexArray(this.vaos[i]);
      for (i = 0; i < this.buffers.length; i++) gl.deleteBuffer(this.buffers[i]);
    } catch (e) { /* ignore */ }
    this.progs = {}; this.gpu = {}; this.gpuKeys = []; this.textCache = {}; this.textKeys = []; this.texCache = {}; this.solidCache = {}; this.solidKeys = [];
    this.vaos = []; this.buffers = []; this.permDefault = null; this.disposed = true;
    if (opts && opts.loseContext) { try { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e2) { /* ignore */ } } // 只有画布确定不再复用时才丢上下文
  };

  // 材质 uniform 组
  /* 形状 uniform 的缺省值：uShaped = 0（球体），三轴 = 1，无凸起。
     GLSL 里未赋值的 uniform 默认是 0——uAxes 若不显式给 1 会把球体压成一个点，所以这里必须每帧都给。 */
  function shapeUniformsOf(shape) {
    if (!shape || !shape.lobes) return { uShaped: 0, uAxes: [1, 1, 1], uLobeN: 0, uLobe: new Float32Array(24), uLobeE: new Float32Array(6) };
    var L = new Float32Array(24), E = new Float32Array(6), n = Math.min(shape.lobes.length, 6);
    for (var i = 0; i < n; i++) { var b = shape.lobes[i]; L[i * 4] = b[0]; L[i * 4 + 1] = b[1]; L[i * 4 + 2] = b[2]; L[i * 4 + 3] = b[3]; E[i] = b[4] == null ? 2 : b[4]; }
    return { uShaped: 1, uAxes: shape.axes, uLobeN: n, uLobe: L, uLobeE: E };
  }
  /* 巨行星的云带表 → 着色器（20 个槽）。带边界与带色来自 gasBands()，与 HUD 读的是同一张表。 */
  function gasBandUniforms(vp, seed) {
    var Y = new Float32Array(20), C = new Float32Array(60);
    if (!vp.gas) return { uBandY: Y, uBandC: C, uBandN: 0 };
    var bands = gasBands(vp, seed), n = Math.min(bands.length, 20);
    for (var i = 0; i < n; i++) { Y[i] = bands[i].y1; C[i * 3] = bands[i].c[0]; C[i * 3 + 1] = bands[i].c[1]; C[i * 3 + 2] = bands[i].c[2]; }
    return { uBandY: Y, uBandC: C, uBandN: n };
  }
  /* 风暴斑：1–3 个，位置/大小/旋向由种子给。木星的大红斑用原来那个位置，它得还认得出来。 */
  function gasStormUniforms(vp) {
    var st = vp.style, out = { uStormA: [0, 0, 0, 0], uStormB: [0, 0, 0, 0], uStormC: [0, 0, 0, 0] };
    if (!vp.gas || !st) return out;
    var keys = ['uStormA', 'uStormB', 'uStormC'], n = clamp(st.stormN || 0, 0, 3), i0 = 0;
    if (vp.gasStyle === 'jupiter') { out.uStormA = [0.9, -0.36, 0.115, 1.0]; i0 = 1; n = Math.max(n, 2); }
    for (var i = i0; i < n; i++) { var sp = st.storms[i]; if (!sp) break; out[keys[i]] = [sp[0], sp[1], sp[2], sp[3]]; }
    return out;
  }
  /* 按类型把风格参数打成两个 vec4（含义见 GLSL_SURF 顶上的注释） */
  function styleUniforms(vp) {
    var st = vp.style;
    if (!st) return { uSurfKind: 0, uSty0: [0, 0, 0, 0], uSty1: [1, 1, 1.5, 0.5], uSea2: [0.06, 0.5] };
    var k = st.kind, s0;
    if (k === 0) s0 = [st.mareAmt, st.rayAmt, st.craterDens, st.ridgeAmt];
    else if (k === 1) s0 = [st.duneFreq, Math.sin(st.duneDir), Math.cos(st.duneDir), st.duneAmt];
    else if (k === 2) s0 = [st.biomeShift, st.biomeSharp, 0, 0];
    else if (k === 3) s0 = [st.crackAmt, Math.max(st.plumeAmt, Math.min(vp.tholin || 0, 0.95)), st.riftFreq, 0];
    else if (k === 4) s0 = [st.fissureF, st.lakeAmt, st.heatK, 0];
    else s0 = [st.biomeShift, st.biomeSharp, 0, 0];
    /* 冰：沉积暗斑用托林的真实色（压暗），裂谷颜色按调色板走 —— 纯白那一套配红褐裂纹（欧罗巴式），
       其余配深蓝 / 青。其它类型给零，着色器里那两行本来也只在 uSurfKind==3 的分支里。 */
    var dep = [0, 0, 0], crk = [0, 0, 0];
    if (k === 3) {
      var tc = (vp.tholin > 0.02 && vp.tholinColor) ? vp.tholinColor : null;
      dep = tc ? [tc[0] * 0.70, tc[1] * 0.50, tc[2] * 0.42] : [0.30, 0.30, 0.33];
      var pv = Math.round(vp.palVar || 0);
      crk = pv === 1 ? [0.52, 0.30, 0.21] : pv === 2 ? [0.60, 0.45, 0.50] : pv === 3 ? [0.22, 0.44, 0.49] : pv === 4 ? [0.28, 0.33, 0.38] : [0.19, 0.32, 0.52];
    }
    return { uSurfKind: k, uSty0: s0, uSty1: [st.cycloneF, st.cloudMul, st.contFreq, st.riftAmt], uSea2: [st.shelfW, st.currentAmt], uDepositC: dep, uCrackC: crk, uDetOff: st.detOff };
  }
  function materialUniforms(vp, g, time, cloudRot, oct) {
    var u = { uPerm: 0, uMap: 1, uPal: 2, uMapSize: [g.maps.W, g.maps.H], uLumK: 1, uAmbK: 1, uStarlit: 0, uShaped: 0, uAxes: [1, 1, 1], uLobeN: 0, uSea: vp.sea, uHRef: hRefOf(vp), uHRange: vp.rangeM || 1, uPlanetR: vp.radiusM, uDetailAmp: vp.detailAmp, uDetailFreq: vp.detailFreq, uDrift: vp.drift, uOct: oct,
      uOceanShallow: vp.oceanShallow, uOceanDeep: vp.oceanDeep, uAtm: vp.atm, uIceColor: vp.iceColor, uCloudColor: vp.cloudColor, uFogColor: vp.fogColor, uVeg0: vp.veg0, uVeg1: vp.veg1,
      uAtmDensity: vp.atmDensity, uIceLat: vp.iceLat, uIceHeight: vp.iceHeight, uCloud: vp.cloud, uLights: vp.lights, uLava: vp.lava, uLavaSea: vp.lavaSea, uFog: vp.fog, uGreen: vp.green, uSpec: vp.spec, uCracks: vp.cracks, uTime: time, uCloudRot: cloudRot, uGas: vp.gas, uStorm: vp.gasStyle === 'jupiter' ? 1 : 0, uCityTex: 3, uHasCity: g.city ? 1 : 0, uRivers: riversOn(vp) ? 1 : 0, uCloudDetail: 0,
      uGasGlow: vp.gasGlow || 0, uGasGlowCol: vp.gasGlowCol || [0, 0, 0], uSunTint: vp.sunTint || [1, 1, 1],
      /* 缺省：细节全开、最细八度满权重 —— 地表飞越走的就是这一档，与 CPU 的 fieldAtCPU 逐位一致。
         球面视图会按到相机的距离把这两项改小（见 drawGlobe）。 */
      uDetail: 1, uOctF: 1, uAlpha: 1, uDetTex: 4 };
    var sty = styleUniforms(vp); for (var sk in sty) u[sk] = sty[sk];
    if (vp.gas) {
      var gb = gasBandUniforms(vp, (g && g.maps) ? (g.maps.planetSeed >>> 0) : 0); for (var bk in gb) u[bk] = gb[bk];
      var gs = gasStormUniforms(vp); for (var tk in gs) u[tk] = gs[tk];
      var st2 = vp.style;
      u.uGasP = [st2 ? st2.bandTurb : 0.8, (vp.gasStyle === 'saturn' ? 1 : (st2 && st2.hexPole ? 1 : 0)), st2 ? st2.darkPole : 0.4, vp.gasIce ? 1 : 0];
      /* (带内子带条数, 子带相位, 亮云强度, 备用)。冰巨星的亮云更显（海王星那种白色絮状条） */
      /* 显示曝光：第 III/IV 类的几何反照率只有 0.03–0.22，照实算出来就是一个黑球 —— 带纹、风暴、极区全看不见。
         这里按反照率把整体亮度拉回中灰附近（只是**显示**上的曝光补偿，反照率本身与 HUD 上的数值一个字不改）。 */
      var gexp = clamp(0.42 / Math.max(vp.gasAlbedo != null ? vp.gasAlbedo : 0.4, 0.045), 1, 4.5);
      u.uGasP2 = [st2 ? st2.subBands : 5, st2 ? st2.subPhase : 0, vp.gasIce ? 0.90 : 0.38, gexp];
    } else { u.uBandN = 0; u.uGasP = [0, 0, 0, 0]; u.uGasP2 = [0, 0, 0, 0]; }
    return u;
  }

  /* ============================================================ 视图（状态机） */
  function createView(canvas, opts) {
    opts = opts || {};
    var listeners = {}, S = { mode: 'idle', system: null, planet: null, starBody: null, selected: -1, timeYr: NOW_YR, hover: null, altitudeM: 10000, lat: 0, lon: 0, heading: 0, pitch: -0.5, caption: '', webgl: false, dpr: 1 };
    var hud = opts.hud !== false, autoNav = opts.autoNavigate !== false, orbitSpeed = opts.orbitSpeed || 0.5, orbitSpeedBase = orbitSpeed, speedMul = 1;
    /* createView 的分段耗时（看门狗 dump 的 pvCreateMs）。用户真机上首次建视图要 1.67 s，
       全在着色器上；分段留着，以后再慢能一眼看出是 getGL 还是编译还是首帧。 */
    var pvT0 = (window.performance && performance.now) ? performance.now() : Date.now();
    function pvMark() { var t = (window.performance && performance.now) ? performance.now() : Date.now(), d = t - pvT0; pvT0 = t; return Math.round(d); }
    var pvCreateMs = {};
    var gl = opts.forceCanvas2D ? null : getGL(canvas, opts.glAttrs), R = null, fallback = null, elapsed = 0, lastT = 0, raf = 0, disposed = false, W = 1, H = 1, dpr = 1;
    pvCreateMs.getGL = pvMark();
    var inFrame = false, lastFrameAt = 0, watchdog = 0;
    // 画布自己铺黑底：宿主页面没给 background 时（浅色主题）不会在还没画出第一帧前透出白底
    try { if (canvas.style && !canvas.style.background) canvas.style.background = '#000'; } catch (e) { /* ignore */ }
    var sysCam = { yaw: 0.9, tilt: 0.95, dist: 10, fit: 10 }, globeCam = { yaw: 0.6, pitch: 0.25, dist: 3.2, spin: 0 }, surf = { lat: 0, lon: 0, alt: 10000, heading: 0, pitch: -0.55, groundZ: 0, under: false };
    var animYr = 0, planetPos = [], starScreen = [], keys = {}, drag = null, lastClick = 0, moveDirty = false, hoverInfo = null, quality = 1, dtEma = 0.016, qTimer = 0, lastDt = 0.016;
    var showMoons = opts.showMoons === true;   // 恒星系视图：是否给所有行星都画放大的卫星示意（默认只画选中/悬停的那颗；M 键切换）
    var moonPick = [];                          // globe 视图里这一帧画出的卫星（双击可进入）
    function emit(evt, payload) { (listeners[evt] || []).forEach(function (cb) { try { cb(payload); } catch (e) { console.error(e); } }); }
    // 2D 回退的落点：画布一旦取过 webgl2，getContext('2d') 就永远返回 null（HTML 规范的 context mode），
    // 所以先主动丢弃 GL 上下文释放显存，再在同一位置盖一张 2D 画布；拿不到 DOM 时退回原画布（fallback 自身容错）。
    var fbCanvas = null;
    function target2D() {
      if (gl) { try { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e0) { /* ignore */ } }
      var ok = false; try { ok = !!canvas.getContext('2d'); } catch (e1) { ok = false; }
      if (ok) return canvas;
      if (typeof document === 'undefined' || !canvas.parentNode) return canvas;
      if (!fbCanvas) {
        fbCanvas = document.createElement('canvas'); fbCanvas.setAttribute('data-mirror-planets', '2d-fallback');
        fbCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;';
        try { var host = canvas.parentNode; if (host.style && !host.style.position) host.style.position = 'relative'; host.insertBefore(fbCanvas, canvas.nextSibling); } catch (e2) { fbCanvas = null; return canvas; }
      }
      fbCanvas.width = canvas.width || 1; fbCanvas.height = canvas.height || 1;
      return fbCanvas;
    }
    function initGL() {
      if (!gl) return false;
      try { R = new GLR(gl); R.progressiveMaps = opts.progressiveMaps !== false; S.webgl = true; pvCreateMs.issueShaders = pvMark(); pvCreateMs.parallel = !!R.parallel; pvCreateMs.pendingAtStart = R.progsPending(); return true; } catch (e) { console.warn('[MirrorPlanets] WebGL2 初始化失败，回退 Canvas 2D：', e && e.message); R = null; return false; }
    }
    if (!initGL()) { fallback = createFallback2D(target2D()); gl = null; S.webgl = false; }
    function onCtxLost(e) { e.preventDefault(); if (R) R.lost = true; }
    function onCtxRestored() { if (disposed) return; try { R = new GLR(gl); R.lost = false; } catch (e) { R = null; fallback = createFallback2D(target2D()); gl = null; S.webgl = false; } } // disposed 守卫：否则每次上下文恢复都会再造一个渲染器
    function onCtxMenu(e) { e.preventDefault(); }
    function onPtrCancel() { drag = null; }
    canvas.addEventListener('webglcontextlost', onCtxLost, false);
    canvas.addEventListener('webglcontextrestored', onCtxRestored, false);

    function resize() {
      dpr = Math.min(root.devicePixelRatio || 1, opts.dpr || 2) * quality; S.dpr = dpr;
      var cw = canvas.clientWidth || canvas.width || 1, ch = canvas.clientHeight || canvas.height || 1;
      var w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (fbCanvas && (fbCanvas.width !== w || fbCanvas.height !== h)) { fbCanvas.width = w; fbCanvas.height = h; }   // 2D 回退画布跟随主画布尺寸
      W = w; H = h;
    }
    resize();

    /* ------------------------------ 恒星系几何 */
    function mapR(au) { return Math.pow(Math.max(au, 1e-4), 0.55); }
    // 防御：周期为 0/负/非有限（超短周期行星、数据缺失）时不许把 ∞/NaN 传进三角函数——那会让光照方向变 NaN、整幅画面全黑
    function safePeriod(p) { var T = p && p.periodYr; return isFinite(T) && T > 1e-9 ? T : (p && isFinite(p.orbitAU) && p.orbitAU > 0 ? Math.max(Math.sqrt(p.orbitAU * p.orbitAU * p.orbitAU / Math.max(p.hostMassRel || 1, 0.02)), 1e-9) : 1); }
    function orbitPos(p, tYr) {
      var M = TAU * ((isFinite(tYr) ? tYr : 0) / safePeriod(p)) + (p.phase || 0), e = p.ecc || 0, E = M;
      if (!isFinite(M)) M = E = p.phase || 0;
      for (var i = 0; i < 6; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      var nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), r = p.orbitAU * (1 - e * Math.cos(E)), rm = mapR(r), ang = nu + (p.phase || 0) * 0.37;
      return { p: [rm * Math.cos(ang), 0, -rm * Math.sin(ang)], sunDir: v3norm([-Math.cos(ang), 0, Math.sin(ang)]), au: r };
    }
    function orbitPath(p) { var pts = new Float32Array(129 * 3), e = p.ecc || 0; for (var i = 0; i <= 128; i++) { var nu = i / 128 * TAU, r = p.orbitAU * (1 - e * e) / (1 + e * Math.cos(nu)), rm = mapR(r), ang = nu + (p.phase || 0) * 0.37; pts[i * 3] = rm * Math.cos(ang); pts[i * 3 + 1] = 0; pts[i * 3 + 2] = -rm * Math.sin(ang); } return pts; }
    function sysAgeGyr() { return S.system ? (S.timeYr - S.system.star.formedYr) / 1e9 : 0; }
    /* 取景中心跟着**行星的宿主星**走，而不是死盯质心。
       宽双星里主星绕质心转，间距可以是几十 AU，而行星轨道只有零点几 AU：
       相机按行星尺度取景、却对准质心，结果就是恒星和行星全被甩出画面，
       屏幕上只剩一个以质心为圆心的柯伊伯带圈——用户看到的"整个画面是黑的"。
       sysTarget 每帧由 drawSystem 更新成宿主星的位置（单星系统恒为原点，行为不变）。 */
    var sysTarget = [0, 0, 0];
    function sysMatrices() {
      var c = sysTarget;
      var eye = [c[0] + sysCam.dist * Math.cos(sysCam.tilt) * Math.cos(sysCam.yaw), c[1] + sysCam.dist * Math.sin(sysCam.tilt), c[2] + sysCam.dist * Math.cos(sysCam.tilt) * Math.sin(sysCam.yaw)];
      var view = m4lookAt(eye, c, [0, 1, 0]), proj = m4persp(45 * DEG, W / H, sysCam.dist * 0.01, sysCam.dist * 20);
      return { view: view, proj: proj, vp: m4mul(proj, view), eye: eye };
    }
    function toScreen(vp, p) { var c = m4pt(vp, p); return [(c[0] * 0.5 + 0.5) * W / dpr, (0.5 - c[1] * 0.5) * H / dpr, c[2]]; }

    /* ------------------------------ 星球视图几何 */
    function globeMatrices() {
      var d = globeCam.dist, eye = [d * Math.cos(globeCam.pitch) * Math.cos(globeCam.yaw), d * Math.sin(globeCam.pitch), d * Math.cos(globeCam.pitch) * Math.sin(globeCam.yaw)];
      var view = m4lookAt(eye, [0, 0, 0], [0, 1, 0]), near = Math.max((d - 1) * 0.25, 0.002), proj = m4persp(45 * DEG, W / H, near, d + 60);
      return { view: view, proj: proj, vp: m4mul(proj, view), eye: eye };
    }
    function planetModel(planet, spin) { return m4mul(m4rotZ((planet.tilt || 0) * DEG), m4rotY(spin)); }
    function globeSunDir() { // 行星轨道位置决定光照方向（世界系）
      var p = S.planet, d = null; if (!p || p.isMoon) return v3norm([1, 0.2, 0.3]);
      if (p.orbitAU) d = orbitPos(p, animYr).sunDir;
      // 最后一道闸：方向里只要有一个非有限分量就退回缺省方向。宁可光照方位不准，也不能让 NaN 传下去把整幅画面变黑
      if (!d || !isFinite(d[0]) || !isFinite(d[1]) || !isFinite(d[2])) return v3norm([1, 0.2, 0.3]);
      return d;
    }
    function pickGlobe(px, py) { // 屏幕 → 经纬（物体空间）
      var M = globeMatrices(), inv = m4invert(M.vp), ndc = [px / (W / dpr) * 2 - 1, 1 - py / (H / dpr) * 2];
      var a = m4pt(inv, [ndc[0], ndc[1], -1]), b = m4pt(inv, [ndc[0], ndc[1], 0]), d = v3norm(v3sub(b, a)), o = a;
      var bq = v3dot(o, d), c = v3dot(o, o) - 1, disc = bq * bq - c; if (disc < 0) return null;
      var t = -bq - Math.sqrt(disc); if (t < 0) return null;
      var pw = v3add(o, v3scale(d, t)), rot = planetModel(S.planet, globeCam.spin), po = m4dirT(rot, pw), ll = nToLL(v3norm(po));
      return { lat: ll[0], lon: ll[1], n: po };
    }

    /* ------------------------------ 降落视图几何 */
    function surfaceMats() {
      var camZ = surf.groundZ + surf.alt, eye = [0, 0, camZ], hd = surf.heading, pt = surf.pitch;
      var fwd = [Math.sin(hd) * Math.cos(pt), Math.cos(hd) * Math.cos(pt), Math.sin(pt)];
      var view = m4lookAt(eye, v3add(eye, fwd), [0, 0, 1]), far = 3e7, proj = m4persp((surf.alt < 50 ? 62 : 55) * DEG, W / H, Math.max(0.3, surf.alt * 0.005), far);
      return { view: view, proj: proj, vp: m4mul(proj, view), eye: eye, far: far, fwd: fwd };
    }
    function surfaceSun() { var basis = localBasis(surf.lat, surf.lon), rot = planetModel(S.planet, globeCam.spin), Lo = m4dirT(rot, globeSunDir());
      var s = v3norm([v3dot(Lo, basis.east), v3dot(Lo, basis.north), v3dot(Lo, basis.up)]);
      return (isFinite(s[0]) && isFinite(s[1]) && isFinite(s[2])) ? s : [0.42, 0.42, 0.8]; }
    // 天上的卫星（示意）：本地天球方向 ≈ 反日点 + 按 seed 的方位偏移；视半径取月球量级（≈0.3°）
    function moonSky(sun) {
      var p = S.planet, none = { dir: [0, 0, 1], lit: 0, cosR: 0.99999 };
      if (!p || S.vp.gas) return none;
      var nMoons = p.moonCount != null ? p.moonCount : (p.moons ? (p.moons.length || p.moons) : 0);
      if (!nMoons) return none;
      var r0 = mulberry32(hash32((p.seed >>> 0) ^ 0x4D4F4F4E)), ang = r0() * TAU, tilt = 0.02 + r0() * 0.24;
      var hx = -sun[0], hy = -sun[1], ca = Math.cos(ang), sa = Math.sin(ang);
      var dir = v3norm([hx * ca - hy * sa, hx * sa + hy * ca, -sun[2] + tilt]);
      if (dir[2] < 0.03) return none;
      var night = 1 - clamp(sun[2] * 3 + 0.2, 0, 1);
      var big = 1; if (p.moons && p.moons.length) for (var i = 0; i < p.moons.length; i++) big = Math.max(big, (p.moons[i].radiusRel || 0.27) / 0.27);
      var radDeg = clamp(0.26 * Math.sqrt(big), 0.20, 0.9);   // 月球视半径 ≈0.26°
      return { dir: dir, lit: night * (0.35 + 0.65 * clamp(dir[2] * 2, 0, 1)), cosR: Math.cos(radDeg * DEG) };
    }
    function updateGround() { // CPU 侧地面高度（与 GPU 一致）
      if (S.vp && S.vp.gas) return updateGasDeck();   // 气态/冰巨星：没有固体表面，高度以 1 bar 参考面为准
      var g = R ? R.planetGPU(S.planet, S.vp) : null, maps = g ? g.maps : getMaps(S.planet, fallback ? 256 : 512);
      var t = terrainMetersAt(maps, S.vp, surf.lat, surf.lon, surfOct());
      surf.terrainM = t.m; surf.water = t.water; surf.groundZ = Math.max(t.m, S.vp.sea >= 0 ? 0 : -Infinity); if (!isFinite(surf.groundZ)) surf.groundZ = t.m;
      var minAlt = surf.water ? -80 : 1.8; if (surf.water && surf.alt < 0 && surf.alt < t.m + 2) surf.alt = t.m + 2; // 不穿海底
      surf.alt = clamp(surf.alt, minAlt, landMaxAlt());
      surf.under = surf.water && surf.alt < 0; surf.groundZ = surf.water ? 0 : t.m; if (surf.under) surf.groundZ = 0;
      classifyTerrain(maps);
    }
    // 地形类型（HUD 用）：在相机周围 ~40 km 采 9 点，看水面占比与起伏
    // （窗口从 3 km 放到 40 km、阈值随之重标定：幅度谱收敛之后 3 km 内只剩几十米起伏，
    //   而且高度底图是 512×256 ≈ 150 km/像素，「是不是山地」本来就只能按几十公里的量级判断）
    function classifyTerrain(maps) {
      var Rm = S.vp.radiusM, step = 20000 / Rm, cl = Math.max(Math.cos(surf.lat), 0.05), hs = [], water = 0, n = 0, moist = 0, ice = 0;
      for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) { var t = terrainMetersAt(maps, S.vp, surf.lat + i * step, surf.lon + j * step / cl, surfOct()); n++; if (t.water) water++; else hs.push(t.m); moist += t.f.moist; }
      var mean = 0, sd = 0; hs.forEach(function (h) { mean += h; }); mean /= Math.max(1, hs.length); hs.forEach(function (h) { sd += (h - mean) * (h - mean); }); sd = Math.sqrt(sd / Math.max(1, hs.length));
      var wf = water / n, lat = Math.abs(surf.lat), typ;
      var nc = surf.nearCities && surf.nearCities.length ? surf.nearCities[0] : null;
      if (nc && nc.dist < nc.city.r * 1.4) typ = TR('城市');
      else if (wf > 0.85) typ = S.vp.lavaSea > 0.5 ? TR('熔岩海') : TR('海面');
      else if (wf > 0.12) typ = TR('海岸');
      else if (S.vp.iceLat < 0.5 || lat / (PI / 2) > S.vp.iceLat) typ = TR('冰原');
      else if (sd > 450) typ = TR('山地'); else if (sd > 170) typ = TR('丘陵'); else typ = (moist / n < 0.28 && S.vp.sea >= 0) || S.vp.palette === 'desert' || S.vp.palette === 'mars' ? TR('荒漠平原') : (S.vp.lava > 0.3 ? TR('岩浆平原') : TR('平原'));
      // 小天体：没有海、没有冰盖纬度带、也没有"山地/丘陵"这套尺度——按起伏与坑判地貌
      if (S.planet && S.planet.isSmallBody) typ = S.planet.isComet ? (sd > Rm * 0.012 ? TR('升华塌陷坑的陡崖') : sd > Rm * 0.004 ? TR('崎岖的冰尘地形') : TR('回落尘埃铺成的平坦区（尘埃池）')) : (sd > Rm * 0.006 ? TR('撞击坑壁与棱脊') : sd > Rm * 0.002 ? TR('坑洼的风化层') : TR('碎石堆平原（遍地砾石）'));
      surf.terrainType = typ; surf.reliefSd = sd;
      // 平衡温度 0 K 是合法值（宿主是遗骸时就是 0），不能用 || 兜底成 288——那会让黑洞旁边的冰原报出 27 ℃
      var base = (S.planet.tempK != null && isFinite(S.planet.tempK) ? S.planet.tempK : 288) - 273.15, altKm = Math.max(0, surf.terrainM || 0) / 1000; // 地面气温（按地形海拔递减）
      surf.tempC = base + 34 * (Math.cos(surf.lat) * Math.cos(surf.lat) * 1.2 - 0.8) - 6.5 * altKm * (S.vp.atmDensity > 0.05 ? 1 : 0);
    }
    /* 气态/冰巨星：地面判定整条换掉 —— 高度相对 1 bar 参考面（groundZ ≡ 0），
       向下不落到硬地面而是钻进越来越浓的霾里（下限 ≈ 4.5 个大气标高，约几十个 bar） */
    function gasScaleH() { return (S.vp && S.vp.scaleHeightM) || 20000; }
    function gasMinAlt() { return -clamp(gasScaleH() * 4.5, 20000, 400000); }
    function updateGasDeck() {
      surf.terrainM = 0; surf.water = false; surf.under = false; surf.groundZ = 0;
      surf.alt = clamp(surf.alt, gasMinAlt(), landMaxAlt());
      var bi = gasBandAt(S.vp, S.planet.seed, clamp(Math.sin(surf.lat) * 0.5 + 0.5, 0, 1));
      surf.gasBand = bi;
      surf.terrainType = bi.light ? TR('亮带（上升气流）') : TR('暗带（下沉气流）');
      // 1 bar 面以下按等温标高估压（示意）：p ≈ exp(−z/H)
      surf.pressureBar = Math.exp(-surf.alt / gasScaleH());
      var T0 = S.planet.tempK != null && isFinite(S.planet.tempK) ? S.planet.tempK : 130;
      surf.tempC = T0 * Math.pow(Math.max(surf.pressureBar, 1e-3), 0.28) - 273.15;   // 干绝热（γ−1)/γ ≈ 0.28（双原子气体）
    }
    // 相机附近的城市：返回 [{city, dist, pos(锚点系 x,y,z), rot, mat(城市系→锚点系)}]，按距离排序
    function nearbyCities(g, basis, maxDist) {
      var cities = g.cities; if (!cities || !cities.list.length) return [];
      var Rm = S.vp.radiusM, lat0 = surf.lat / DEG, lon0 = surf.lon / DEG, cl = Math.cos(surf.lat), out = [];
      for (var i = 0; i < cities.list.length; i++) { var c = cities.list[i]; var dl = ((c.lon - lon0 + 540) % 360) - 180, dy = (c.lat - lat0) * DEG * Rm, dx = dl * DEG * Rm * cl; if (Math.abs(dx) > maxDist * 1.2 || Math.abs(dy) > maxDist * 1.2) continue; var d = Math.hypot(dx, dy); if (d > maxDist) continue; out.push({ city: c, dist: d }); }
      out.sort(function (a, b) { return a.dist - b.dist; }); out = out.slice(0, 24);
      var O = v3scale(basis.up, Rm);
      out.forEach(function (e) { var cb = localBasis(e.city.lat * DEG, e.city.lon * DEG), P = v3scale(cb.up, Rm), D = v3sub(P, O);
        var tx = v3dot(D, basis.east), ty = v3dot(D, basis.north), tz = v3dot(D, basis.up); e.pos = [tx, ty, tz];
        var m = new Float32Array(16); m[0] = v3dot(cb.east, basis.east); m[1] = v3dot(cb.east, basis.north); m[2] = v3dot(cb.east, basis.up); m[4] = v3dot(cb.north, basis.east); m[5] = v3dot(cb.north, basis.north); m[6] = v3dot(cb.north, basis.up); m[8] = v3dot(cb.up, basis.east); m[9] = v3dot(cb.up, basis.north); m[10] = v3dot(cb.up, basis.up); m[12] = tx; m[13] = ty; m[14] = tz; m[15] = 1; e.mat = m;
        e.rot = cityPlan(e.city).rot; });   // 与 buildingsFor 同一套路网参数：着色器画的街和 CPU 摆的楼必须对齐
      return out;
    }
    // 树木实例（示意）：以相机地面点为锚，1.5 km 半径内按 22 m 网格抖动布点，仅植被区（湿润、低海拔、非陡坡）
    // 近地植被（示意）：覆盖半径随高度放大，2 km 高度上仍是一层可分辨的树点，而不是空地
    function buildTrees(maps, vp, Rm) { var lat0 = surf.lat, lon0 = surf.lon, cl = Math.max(Math.cos(lat0), 0.05), K = 0, cap = 9000, data = new Float32Array(cap * 8), o = 0, Rr = clamp(Math.max(surf.alt, 200) * 2.2, 1500, 6000), step = Math.max(18, Rr / 68), N2 = maps.noise;
      for (var y = -Rr; y <= Rr && K < cap; y += step) for (var x = -Rr; x <= Rr && K < cap; x += step) { if (x * x + y * y > Rr * Rr) continue; var hx = hash32((x + 100000) * 7919 + (y + 100000) * 104729 + (surf.lat * 1e5 | 0)) / 4294967296; if (hx > 0.55) continue; var jx = x + (hx - 0.5) * step * 1.6, jy = y + (fract(hx * 97.3) - 0.5) * step * 1.6;
        var lat = lat0 + jy / Rm, lon = lon0 + jx / (Rm * cl), t = terrainMetersAt(maps, vp, lat, lon, terrainOctOf(vp)); if (t.water) continue; var el = vp.sea < 0 ? t.f.h : (t.f.h - vp.sea) / (1 - vp.sea), climate = Math.pow(Math.abs(Math.sin(lat)), 2) * 1.2 + el * vp.iceHeight * 0.45; if (t.f.moist < 0.38 || climate > 0.75 || el > 0.5) continue; var forest = N2.snoise(Math.cos(lat) * Math.cos(lon) * 1500, Math.sin(lat) * 1500, -Math.cos(lat) * Math.sin(lon) * 1500); if (forest + t.f.moist * 0.6 - 0.4 < 0.15) continue;
        var h = 6 + fract(hx * 31.7) * 9, w = 3 + fract(hx * 13.1) * 4; data[o++] = jx; data[o++] = jy; data[o++] = t.m - (jx * jx + jy * jy) / (2 * Rm) + 40; data[o++] = h - 40; /* 着色器里箱体从 z−40 到 z+h：这里让底在地面、顶在树高 */ data[o++] = w; data[o++] = w; data[o++] = hx * 6.28; data[o++] = hx * 1000; K++; }
      return { data: data.subarray(0, K * 8), count: K, lat: lat0, lon: lon0 }; }
    // 地表模式的高度上限（再高就回到星球视图）。小天体半径只有几十 km，120 km 的固定上限等于永远出不去，
    // 所以按半径给：小天体取 0.6 R，行星仍是原来的 max(120 km, 0.05 R)
    function landMaxAlt() { if (!S.planet) return 300000; var Rm = S.vp.radiusM; return Rm < 1.2e6 ? Math.max(Rm * 0.6, 2000) : Math.max(120000, Rm * 0.05); }
    // 地形倍频数：每颗行星一个常量（见 terrainOctOf）。以前它随相机高度变（11 − log2(alt/50)），
    // 于是同一个经纬点的高度会随你升降而变——这是「地形随相机移动而改变」的直接原因。
    function surfOct() { return terrainOctOf(S.vp); }
    function landAtScreen(px, py) { // 双击：局部平面 z=0 与射线交点 → 新经纬
      var M = surfaceMats(), inv = m4invert(M.vp), ndc = [px / (W / dpr) * 2 - 1, 1 - py / (H / dpr) * 2];
      var a = m4pt(inv, [ndc[0], ndc[1], -1]), b = m4pt(inv, [ndc[0], ndc[1], 0]), d = v3norm(v3sub(b, a)); if (d[2] >= -1e-4) return null;
      var t = -(a[2] - surf.groundZ) / d[2], hit = v3add(a, v3scale(d, t)), r = Math.hypot(hit[0], hit[1]); if (r > S.vp.radiusM * 1.5) return null;
      var basis = localBasis(surf.lat, surf.lon), ang = r / S.vp.radiusM, dir = r > 1e-6 ? v3norm(v3add(v3scale(basis.east, hit[0] / r), v3scale(basis.north, hit[1] / r))) : basis.east;
      var n = v3add(v3scale(basis.up, Math.cos(ang)), v3scale(dir, Math.sin(ang))), ll = nToLL(v3norm(n)); return { lat: ll[0], lon: ll[1] };
    }

    /* ------------------------------ 公共 API */
    // 时间口径兼容：本模块内部使用宇宙演化时间（年，如 1.9e10）；mirror.js 传的是相对零时标的年数（≤0 为过去），
    // 并附带 absoluteYr / nowYr:0。判定为相对口径时按 base（system.nowYr，即该恒星系的"现在"）换算，避免落到行星形成前。
    function resolveTime(o, base) {
      if (!o || o.timeYr == null || !isFinite(o.timeYr)) return null;
      var t = +o.timeYr, relative = o.relative === true || o.nowYr === 0 || o.absoluteYr != null || o.ageYr != null || t <= 0;
      if (!relative) return t;
      base = base != null ? base : (S.system ? S.system.nowYr : (S.planet && S.planet.nowYr) || NOW_YR);
      return base + t;
    }
    function setMode(m) { if (S.mode !== m) { S.mode = m; emit('change', getState()); } }
    function showSystem(system, o) {
      o = o || {}; S.system = system; var tt = resolveTime(o, system.nowYr); if (tt != null) S.timeYr = tt; else if (S.timeYr == null) S.timeYr = system.nowYr;
      S.planet = null; S.selected = o.selected != null ? o.selected : -1; animYr = S.timeYr - system.star.formedYr;
      var maxAU = 0.02; system.planets.forEach(function (p) { maxAU = Math.max(maxAU, p.orbitAU * (1 + (p.ecc || 0))); });
      /* 只有**一颗行星都没有**时才按恒星间距取景。
         无行星的多星系统（稳定区放不下行星）原来会落到 0.02 AU 的地板，恒星全在画面外，一片空。
         但反过来无条件把恒星间距算进去也不行：宽双星间距可达几十上百 AU，而行星轨道只有零点几 AU，
         按间距取景会把行星压成中心一小团、公转看不出来——那是这个修复的第一版造成的回归。
         有行星就以行星为准（恒星本体在中心附近，看得见），没行星才退回按恒星间距。 */
      if (!(system.planets && system.planets.length)) {
        var hz = system.hierarchy;
        if (hz && hz.root) (function walk(n) { if (!n) return; if (n.kind === 'bin') { maxAU = Math.max(maxAU, (n.a || 0) * (1 + (n.e || 0))); (n.members || []).forEach(walk); } })(hz.root);
      }
      // 视距：最外轨道（含倾斜投影后的近端）完整可见；短周期系统按最内行星周期自适应时间流速（约 8 秒一圈）
      sysCam.fit = mapR(maxAU) * 2.95 / Math.min(1, W / H / 1.25); if (!o.keepCamera) { sysCam.dist = sysCam.fit; sysCam.yaw = 0.9; sysCam.tilt = 0.95; }
      var minP = Infinity; system.planets.forEach(function (p) { if (p.periodYr > 0) minP = Math.min(minP, p.periodYr); }); if (!isFinite(minP)) minP = 1;
      orbitSpeedBase = opts.orbitSpeed || minP / 8; orbitSpeed = orbitSpeedBase * speedMul;
      tb = null; initSysNB(system);
      if (system.dim === 2) { init2DSystem(system); sysCam.cx = 0; sysCam.cz = 0; sysCam.fit = mapR(maxAU) * 2.4 / Math.min(1, W / H / 1.25); if (!o.keepCamera) sysCam.dist = sysCam.fit; }
      else if (system.dimMode === 'orbitDemo') { sysCam.fit = 4.2 * 2.6 / Math.min(1, W / H / 1.25); if (!o.keepCamera) { sysCam.dist = sysCam.fit; sysCam.tilt = 0.7; }
        // 进入即创建并开始积分：不再依赖调用方传 perturbation。以前不传就留 demo=null、等 rAF 里惰性建，
        // 宿主的 rAF 一旦没及时跑起来，画面就是空的、getDemoState() 也永远停在 0 T₀。
        var eps0 = o.perturbation != null ? o.perturbation : (demo && demo.seed === system.seed ? demo.eps : 0.01);
        demo = initOrbitDemo(system.dim, eps0, system.seed); }
      setMode('system'); if (fallback) fallback.setState(S, { sysCam: sysCam });
      if (system.dimMode === 'orbitDemo') paintNow();   // 立刻画一帧：画布在第一次 rAF 回调之前也不会是空的（浅色主题下会透出白底）
      return view;
    }
    function showGlobe(planet, o) {
      o = o || {}; if (!planet) return view;                                   // 没有行星可看（randomVisit 兜底失败）：原地不动，不崩
      if (planet && planet.system && planet.system.dimMode === 'orbitDemo') { if (S.mode !== 'system') showSystem(planet.system, o); return view; } // D≠3 只到恒星系层
      S.planet = planet; if (planet.system) S.system = planet.system; var tt = resolveTime(o, planet.nowYr || (S.system && S.system.nowYr)); if (tt != null) S.timeYr = tt; else if (S.timeYr == null) S.timeYr = planet.nowYr || NOW_YR;
      var selOf = planet.parent || planet;   // 进入卫星时，恒星系层的选中项仍停在它的母行星上
      S.selected = S.system ? S.system.planets.indexOf(selOf) : -1; if (S.system) animYr = S.timeYr - S.system.star.formedYr;
      S.vp = visualParams(planet, S.timeYr);
      var sd = globeSunDir(); globeCam.yaw = o.yaw != null ? o.yaw : Math.atan2(sd[2], sd[0]) + 0.55; globeCam.pitch = o.pitch != null ? o.pitch : 0.28;
      globeCam.dist = o.distance != null ? o.distance : 3.0; if (o.altitudeM != null) globeCam.dist = 1 + o.altitudeM / S.vp.radiusM;
      if (o.spin != null) globeCam.spin = o.spin;
      if (planet.dim === 2) { globeCam.dist = o.distance != null ? o.distance : 2.6; }
      setMode('globe'); if (fallback) fallback.setState(S, { globeCam: globeCam });
      return view;
    }
    function land(planet, o) {
      o = o || {}; if (!planet) return view;
      /* 地表那几个着色器是按需发的，进来之前先催一把（已经发过就是空操作） */
      if (R && R.ensureProg) { R.ensureProg(terrainProgName(visualParams(planet, S.timeYr))); R.ensureProg('water'); R.ensureProg('cloud'); R.ensureProg('gas'); R.ensureProg('bldg'); }                                   // 同上：land 也要挡住空行星
      if (planet.system && planet.system.dimMode === 'orbitDemo') { return showGlobe(planet, o); }
      if (planet && planet.dim === 2) { if (planet !== S.planet) { S.planet = planet; if (planet.system) S.system = planet.system; } var t2 = resolveTime(o, planet.nowYr); if (t2 != null) S.timeYr = t2; S.vp = visualParams(planet, S.timeYr); land2DAt((o.lon || 0) * DEG, o.altitudeM != null ? o.altitudeM : 800, o.lit !== false && !o.fromGlobe); return view; }
      if (planet !== S.planet) { S.planet = planet; if (planet.system) S.system = planet.system; S.selected = S.system ? S.system.planets.indexOf(planet) : -1; }
      var tt = resolveTime(o, planet.nowYr || (S.system && S.system.nowYr)); if (tt != null) S.timeYr = tt; else if (S.timeYr == null) S.timeYr = planet.nowYr || NOW_YR; if (S.system) animYr = S.timeYr - S.system.star.formedYr;
      S.vp = visualParams(planet, S.timeYr);
      surf.lat = o.lat != null ? o.lat * DEG : 0.35; surf.lon = o.lon != null ? o.lon * DEG : 0.6; surf.alt = o.altitudeM != null ? o.altitudeM : 2000; surf.cruise = o.cruise !== false; surf.cruiseT = 0;
      surf.nearCities = null; surf.trees = null;   // 换星球/换落点：附近城市与树木实例要清掉，否则 HUD 会拿上一颗星球的城市判成"城市"
      surf.heading = o.heading != null ? o.heading * DEG : 0.4; surf.pitch = o.pitch != null ? o.pitch * DEG : (surf.alt < 50 ? -0.05 : (surf.alt > 60000 ? -0.5 : -18 * DEG));
      if (o.sunEl != null || (o.lit !== false && !o.fromGlobe)) { // 搜索自转相位，把降落点放到指定太阳高度角（默认 38°；给负值即夜面）
        // 只有星光的世界（流浪行星）默认用掠射：正面照过来的话，那点微弱的光会把地形摊成一片没有起伏的灰白
        var want = (o.sunEl != null ? o.sunEl : (planet.isRogue ? 7 : 38)) * DEG, best = 0, bestErr = 9;
        for (var i = 0; i < 360; i++) { globeCam.spin = i / 360 * TAU; var el = Math.asin(clamp(surfaceSun()[2], -1, 1)); var err = Math.abs(el - want); if (err < bestErr) { bestErr = err; best = globeCam.spin; } } globeCam.spin = best; }
      if (o.faceSun) { var sv = surfaceSun(); if (Math.abs(sv[0]) + Math.abs(sv[1]) > 1e-4) surf.heading = Math.atan2(sv[0], sv[1]) + (o.faceSun === true ? 0 : o.faceSun * DEG); } // 朝太阳方位（可带偏角），让日面出现在画面里
      updateGround(); setMode('surface'); if (fallback) fallback.setState(S, { surf: surf }); return view;
    }
    function setTime(t, o) { var tt = resolveTime(typeof t === 'object' && t ? t : (o ? Object.assign({ timeYr: t }, o) : { timeYr: t })); if (tt == null) return view; t = tt; S.timeYr = t; if (S.system) animYr = t - S.system.star.formedYr; if (S.planet) { S.vp = visualParams(S.planet, t); if (S.mode === 'surface') updateGround(); } if (fallback) fallback.setState(S, { surf: surf }); return view; }
    function setAltitude(m) { if (S.mode === 'surface') { surf.alt = m; updateGround(); } else if (S.mode === 'globe' && S.vp) { globeCam.dist = clamp(1 + m / S.vp.radiusM, 1.001, 14); } return view; }
    function getState() {
      var alt = S.mode === 'surface' ? surf.alt : S.mode === 'globe' && S.vp ? (globeCam.dist - 1) * S.vp.radiusM : S.mode === 'star' && S.starBody ? globeCam.dist * S.starBody.radiusM : null;
      var sunLoc = null, moonLoc = null; // 地表视角下太阳/卫星的方位角（自北顺时针，度）与高度角（度），供 UI/取景使用
      if (S.mode === 'surface' && S.vp && !fallback) { var sv = surfaceSun(); sunLoc = { az: Math.atan2(sv[0], sv[1]) / DEG, el: Math.asin(clamp(sv[2], -1, 1)) / DEG };
        var mv = moonSky(sv); if (mv.lit > 0) moonLoc = { az: Math.atan2(mv.dir[0], mv.dir[1]) / DEG, el: Math.asin(clamp(mv.dir[2], -1, 1)) / DEG }; }
      // 面包屑：恒星系 →（行星 →（卫星））/ 小行星 / 彗星 / 流浪行星 / 恒星 → 地表。bodyKind 说明当前站在哪一类天体上
      var kindOf = function (p) { return p.bodyKind || (p.isMoon ? 'moon' : 'planet'); };
      var surfName = { moon: '卫星表面', asteroid: '小行星表面', comet: '彗核表面', rogue: '地表' };
      var path = []; if (S.system) path.push({ kind: 'system', name: TRN(S.system.name) });
      if (S.mode === 'star' && S.starBody) path.push({ kind: 'star', name: TRN(S.starBody.name) });
      if (S.planet) { if (S.planet.parent) path.push({ kind: 'planet', name: TRN(S.planet.parent.name) }); path.push({ kind: kindOf(S.planet), name: TRN(S.planet.name) }); }
      if (S.mode === 'surface') path.push({ kind: 'surface', name: TR((S.planet && surfName[kindOf(S.planet)]) || '地表') });
      var cs = S.planet && S.planet.isComet ? cometStateAt(S.planet, S.timeYr) : null;
      return { mode: S.mode, system: S.system, planet: S.planet, selectedIndex: S.selected, sun: sunLoc, moon: moonLoc,
        bodyKind: S.mode === 'star' ? 'star' : (S.planet ? kindOf(S.planet) : (S.system ? 'system' : null)),
        // 不可进入/不可降落的天体必须说明原因，不能"点了没反应"
        landable: S.mode === 'star' ? false : (S.planet ? S.planet.landable !== false && !(S.vp && S.vp.gas) : null),
        noLandReason: S.mode === 'star' && S.starBody ? S.starBody.noLandReason : (S.vp && S.vp.gas ? TR('气态/冰巨星没有固体表面：降落即为云顶飞越，高度相对 1 bar 参考面。') : null),
        starBody: S.mode === 'star' ? S.starBody : null, cometState: cs, smallBody: !!(S.planet && S.planet.isSmallBody),
        parentBody: S.planet ? (S.planet.parent || null) : null, path: path, showMoons: showMoons, timeYr: S.timeYr, animTimeYr: S.system ? animYr + S.system.star.formedYr : null, altitudeM: alt, lat: surf.lat / DEG, lon: surf.lon / DEG, heading: surf.heading / DEG, pitch: surf.pitch / DEG,
        distanceR: S.mode === 'globe' ? globeCam.dist : null, era: S.vp ? TR(S.vp.eraName) : '', surfaceView: S.mode === 'surface' && surf.alt < 50 && !(S.vp && S.vp.gas), underwater: S.mode === 'surface' && surf.under,
        // 气态/冰巨星：没有固体表面，altitudeM 是相对 1 bar 参考面的高度（可为负 = 已经在参考面以下），pressureBar 为示意气压
        noSurface: !!(S.vp && S.vp.gas), altitudeRef: S.vp && S.vp.gas ? '1bar' : 'sea', pressureBar: S.mode === 'surface' && S.vp && S.vp.gas && surf.pressureBar != null ? +surf.pressureBar.toFixed(3) : null, caption: S.caption, webgl: S.webgl, hover: hoverInfo, systemAgeGyr: sysAgeGyr(), dim: sysDim(), dimMode: S.system ? S.system.dimMode : '3d', x2d: S.mode === 'surface' && sysDim() === 2 ? d2.x : null, terrainType: TR(surf.terrainType) || null, tempC: surf.tempC != null ? +surf.tempC.toFixed(1) : null, cruise: !!surf.cruise, nearestCity: S.mode === 'surface' && surf.nearCities && surf.nearCities.length ? { name: surf.nearCities[0].city.name, nameEn: surf.nearCities[0].city.nameEn, distM: surf.nearCities[0].dist, pop: surf.nearCities[0].city.pop } : null, cityCount: S.mode === 'surface' && surf.nearCities ? surf.nearCities.length : 0 };
    }
    function on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); return function () { listeners[evt] = (listeners[evt] || []).filter(function (f) { return f !== cb; }); }; }
    var visitSeed = hash32((opts.seed || 1) ^ 0x1234);
    function visitNext(universeParams) { var r = randomVisit(visitSeed, universeParams, {}); visitSeed = r.nextSeed; if (!r.planet) { if (r.system) showSystem(r.system, {}); return r; } showGlobe(r.planet, {}); emit('enter', { kind: 'globe', planet: r.planet, system: r.system, from: 'random' }); return r; }
    /* 导航栈：宇宙 → 恒星系 →（行星 → 卫星 / 小行星 / 彗星 / 流浪行星 / 恒星）→ 地表。
       卫星天体带 .parent，逐级返回顺着它走；小天体/流浪行星/恒星没有 .parent，直接回恒星系。 */
    function goUp() {
      if (S.mode === 'star') { S.starBody = null; if (S.system) { showSystem(S.system, { timeYr: S.timeYr, selected: S.selected, keepCamera: true }); emit('exit', { kind: 'star', to: 'system' }); } return; }
      if (S.mode === 'surface') { var alt = surf.alt; showGlobe(S.planet, { altitudeM: Math.max(alt, S.vp.radiusM * 0.06), spin: globeCam.spin, yaw: globeCam.yaw, pitch: globeCam.pitch }); emit('exit', { kind: 'surface', to: 'globe', planet: S.planet }); }
      else if (S.mode === 'globe' && S.planet && S.planet.parent) { var mo0 = S.planet, par = S.planet.parent; showGlobe(par, {}); emit('exit', { kind: 'moon', to: 'globe', planet: mo0, parent: par }); }
      else if (S.mode === 'globe' && S.system) { var p = S.planet; showSystem(S.system, { timeYr: S.timeYr, selected: S.selected, keepCamera: true }); emit('exit', { kind: (p && p.bodyKind) || 'globe', to: 'system', planet: p }); }
    }
    /* ---- 小天体 / 恒星的进入口。全部复用 showGlobe（小天体是「行星式」对象），恒星走独立的 star 模式。 */
    function beltList() { return S.system ? beltBodiesOf(S.system) : []; }
    function cometList() { return S.system ? cometBodiesOf(S.system) : []; }
    function rogueList() { return S.system ? rogueBodiesOf(S.system) : []; }
    function enterSmall(list, i, kind, o) {
      if (!list.length) return view;
      var b = list[((i || 0) % list.length + list.length) % list.length]; if (!b) return view;
      showGlobe(b, o || { distance: b.isComet ? 6.5 : b.shape ? 3.4 : 3.0 });   // 彗星拉远一点：彗发与两条尾要有地方展开
      emit('enter', { kind: kind, planet: b, system: S.system, index: b.listIndex != null ? b.listIndex : i, from: (o && o.from) || 'api' });
      return view;
    }
    function enterAsteroid(i, o) { return enterSmall(beltList(), i, 'asteroid', o); }
    function enterComet(i, o) { return enterSmall(cometList(), i, 'comet', o); }
    function enterRogue(i, o) { return enterSmall(rogueList(), i, 'rogue', o); }
    function showStar(star, o) {
      o = o || {}; var sys = o.system || S.system; var b = starBody(sys, star || (sys && sys.star)); if (!b) return view;
      S.starBody = b; S.planet = null; S.vp = null;
      if (o.timeYr != null) { var tt = resolveTime(o, sys ? sys.nowYr : null); if (tt != null) S.timeYr = tt; }
      globeCam.dist = o.distance != null ? o.distance : (b.stage === 'bh' ? 15 : b.stage === 'ns' || b.stage === 'wd' ? 4.2 : 3.2);
      globeCam.yaw = o.yaw != null ? o.yaw : 0.6; globeCam.pitch = o.pitch != null ? o.pitch : (b.stage === 'bh' ? 0.16 : 0.22);
      setMode('star'); emit('enter', { kind: 'star', star: b, system: sys, from: o.from || 'api' });
      return view;
    }
    // 进入某颗卫星（i = planet.moons 的下标）
    function enterMoon(i, o) {
      var host = S.planet && S.planet.parent ? S.planet.parent : S.planet;
      if (!host || !host.moons || !host.moons[i]) return view;
      var b = moonBody(host, host.moons[i], i); if (!b) return view;
      showGlobe(b, o || {}); emit('enter', { kind: 'moon', planet: b, parent: host, index: i, from: (o && o.from) || 'api' });
      return view;
    }
    // 同层同类天体的「上一颗 / 下一颗 / 随机一颗」：在卫星层就是换卫星，在行星层还是换行星
    function siblings() {
      var p = S.planet;
      if (p && p.isAsteroid) return { kind: 'asteroid', list: beltList(), index: p.listIndex || 0, host: S.system };
      if (p && p.isComet) return { kind: 'comet', list: cometList(), index: p.listIndex || 0, host: S.system };
      if (p && p.isRogue) return { kind: 'rogue', list: rogueList(), index: p.listIndex || 0, host: S.system };
      if (p && p.parent) return { kind: 'moon', list: moonsOfPlanet(p.parent), index: p.id != null ? p.id : 0, host: p.parent };
      if (S.system) return { kind: 'planet', list: S.system.planets, index: S.selected, host: S.system };
      return { kind: 'none', list: [], index: -1, host: null };
    }
    function stepSibling(d) {
      var sb = siblings(); if (!sb.list.length) return view;
      var n = sb.list.length, i = ((sb.index < 0 ? 0 : sb.index) + d % n + n) % n;
      if (sb.kind === 'asteroid' || sb.kind === 'comet' || sb.kind === 'rogue') { showGlobe(sb.list[i], { distance: sb.list[i].isComet ? 6.5 : sb.list[i].shape ? 3.4 : 3.0 }); emit('enter', { kind: sb.kind, planet: sb.list[i], system: S.system, index: i, from: 'sibling' }); }
      else if (sb.kind === 'moon') { showGlobe(sb.list[i], {}); emit('enter', { kind: 'moon', planet: sb.list[i], parent: sb.host, index: i, from: 'sibling' }); }
      else { S.selected = i; if (S.mode === 'globe' || S.mode === 'surface') { showGlobe(sb.list[i], {}); emit('enter', { kind: 'globe', planet: sb.list[i], system: S.system, from: 'sibling' }); } else emit('select', { planet: sb.list[i], index: i, system: S.system }); }
      return view;
    }
    function enterSelected() {
      if (S.mode !== 'system') return;
      if (S.selected >= 0) { var p = S.system.planets[S.selected]; if (autoNav) showGlobe(p, {}); emit('enter', { kind: 'globe', planet: p, system: S.system, from: 'system' }); return; }
      if (S.selected === -2) { if (autoNav) showStar(S.system.star, { from: 'system' }); else emit('enter', { kind: 'star', star: starBody(S.system, S.system.star), system: S.system, from: 'system' }); }   // 选中的是恒星本体
    }
    function landFromGlobe(px, py) {
      var hit = pickGlobe(px, py); if (!hit) hit = pickGlobe(W / dpr / 2, H / dpr / 2); if (!hit) { var ll = nToLL(m4dirT(planetModel(S.planet, globeCam.spin), v3norm(globeMatrices().eye))); hit = { lat: ll[0], lon: ll[1] }; }
      var alt = 2500; // 从星球视图降落：直接进入 2500 m 巡航（原文"一万来米"量级以内，能看到地平线与地表细节）
      var payload = { kind: 'surface', planet: S.planet, lat: hit.lat / DEG, lon: hit.lon / DEG, altitudeM: alt };
      if (autoNav) land(S.planet, { lat: payload.lat, lon: payload.lon, altitudeM: alt, fromGlobe: true, heading: 0.4 / DEG, pitch: -16 });
      emit('enter', payload);
    }

    /* ------------------------------ 输入 */
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0; canvas.style.touchAction = 'none'; canvas.style.outline = 'none';
    function evPos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function onDown(e) { if (e.button !== 0) return; canvas.focus(); stopCruise(); var p = evPos(e);
      // 轨道投影演示：点在 r₀ 滑杆上就拖滑杆，不要顺带把相机转了
      if (demo && S.mode === 'system' && sysDim() !== 3 && sysDim() !== 2 && r0SliderHit(p[0], p[1])) {
        demo.probeDrag = true; setProbeR0(r0FromX(p[0]), false);
        drag = { x: p[0], y: p[1], sx: p[0], sy: p[1], moved: true, slider: true };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        return;
      }
      drag = { x: p[0], y: p[1], sx: p[0], sy: p[1], moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    function onMove(e) {
      var p = evPos(e);
      if (drag && drag.slider) { setProbeR0(r0FromX(p[0]), false); return; }   // 拖动只挪手柄与初始圆，松手才重算
      if (drag) { var dx = p[0] - drag.x, dy = p[1] - drag.y; drag.x = p[0]; drag.y = p[1]; if (Math.abs(p[0] - drag.sx) + Math.abs(p[1] - drag.sy) > 3) drag.moved = true;
        if (S.mode === 'system' && sysDim() === 2) { var kpan = sysCam.dist * 0.0018; sysCam.cx = (sysCam.cx || 0) - dx * kpan; sysCam.cz = (sysCam.cz || 0) - dy * kpan; }
        else if (S.mode === 'globe' && sysDim() === 2) { globeCam.spin += dx * 0.006; }
        else if (S.mode === 'system') { sysCam.yaw += dx * 0.006; sysCam.tilt = clamp(sysCam.tilt + dy * 0.005, 0.08, 1.5); }
        else if (S.mode === 'star') { globeCam.yaw += dx * 0.006; globeCam.pitch = clamp(globeCam.pitch + dy * 0.006, -1.45, 1.45); }
        else if (S.mode === 'globe') { globeCam.yaw += dx * 0.006 * Math.min(1, (globeCam.dist - 1)); globeCam.pitch = clamp(globeCam.pitch + dy * 0.006 * Math.min(1, (globeCam.dist - 1)), -1.45, 1.45); }
        else if (S.mode === 'surface') { surf.heading += dx * 0.004; surf.pitch = clamp(surf.pitch - dy * 0.004, -1.5, 1.2); }
        return; }
      // 悬停
      if (S.mode === 'system') { var h = pickPlanet(p[0], p[1]); var idx = h ? h.index : -1; if ((hoverInfo ? hoverInfo.index : -1) !== idx) { hoverInfo = h ? { kind: 'planet', index: idx, planet: h.planet, x: p[0], y: p[1] } : null; emit('hover', hoverInfo); } canvas.style.cursor = h ? 'pointer' : 'default'; }
      else if (S.mode === 'globe' && S.planet) { var g = pickGlobe(p[0], p[1]); hoverInfo = g ? { kind: 'surface', planet: S.planet, lat: g.lat / DEG, lon: g.lon / DEG, x: p[0], y: p[1] } : null; emit('hover', hoverInfo); canvas.style.cursor = g ? 'crosshair' : 'default'; }
    }
    function onUp(e) {
      if (drag && drag.slider) { var rr = r0FromX(evPos(e)[0]); drag = null; if (demo) demo.probeDrag = false; setProbeR0(rr, true); return; }   // 松手：从新初态重新积分
      if (!drag) return; var wasDrag = drag.moved; drag = null; if (wasDrag) return; var p = evPos(e), now = performance.now(), dbl = now - lastClick < 320; lastClick = dbl ? 0 : now;
      if (S.mode === 'system') { var h = pickPlanet(p[0], p[1]); if (h) { var again = S.selected === h.index; S.selected = h.index; emit('select', { planet: h.planet, index: h.index, system: S.system }); if (dbl || again) enterSelected(); }
        else { var hs = pickStar(p[0], p[1]);   // 恒星本体也可以选中并「近观」（安全距离外，不可降落）
          if (hs) { var againS = S.selected === -2; S.selected = -2; emit('select', { planet: null, star: hs.star, index: -2, system: S.system }); if (dbl || againS) { if (autoNav) showStar(hs.star, { from: 'system' }); else emit('enter', { kind: 'star', star: starBody(S.system, hs.star), system: S.system, from: 'system' }); } }
          else if (!dbl) { S.selected = -1; emit('select', { planet: null, index: -1, system: S.system }); } } }
      else if (S.mode === 'globe' && sysDim() === 2) { if (dbl) { var cxs = W / dpr / 2, cys = H / dpr / 2, ang = Math.atan2(-(p[1] - cys), p[0] - cxs); land2DAt(ang - globeCam.spin, 800); } }
      else if (S.mode === 'globe') { if (dbl) { var mh = pickMoon(p[0], p[1]); if (mh) { showGlobe(mh.body, {}); emit('enter', { kind: 'moon', planet: mh.body, parent: S.planet, index: mh.index, from: 'dblclick' }); } else landFromGlobe(p[0], p[1]); } }
      else if (S.mode === 'surface' && sysDim() === 2) { if (dbl) { d2.alt = Math.max(d2.alt * 0.3, 20); } }
      else if (S.mode === 'surface') { if (dbl) { var t = landAtScreen(p[0], p[1]); if (t) { surf.lat = t.lat; surf.lon = t.lon; surf.alt = Math.max(surf.alt * 0.25, 30); if (surf.alt < 60000) surf.pitch = Math.max(surf.pitch, surf.alt < 50 ? -0.05 : -18 * DEG); updateGround(); emit('enter', { kind: 'surface', planet: S.planet, lat: surf.lat / DEG, lon: surf.lon / DEG, altitudeM: surf.alt, from: 'dblclick' }); } } }
    }
    function onWheel(e) {
      e.preventDefault(); stopCruise(); var k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0012);
      if (S.mode === 'star') { globeCam.dist = clamp(globeCam.dist * k, S.starBody && S.starBody.stage === 'bh' ? 2.6 : 1.35, 80); return; }   // 恒星：只改观察距离，最近也停在安全距离上（黑洞最近到 2.6 r_s，仍在视界外）
      if (S.mode === 'system') { if (e.shiftKey) setSpeedMul(speedMul * (e.deltaY > 0 ? 0.5 : 2)); else sysCam.dist = clamp(sysCam.dist * k, sysCam.fit * 0.05, sysCam.fit * 4); }
      else if (S.mode === 'globe' && sysDim() === 2) { globeCam.dist = clamp(globeCam.dist * k, 1.25, 12); if (globeCam.dist <= 1.3 && k < 1) land2DAt(-globeCam.spin, 800); }
      else if (S.mode === 'surface' && sysDim() === 2) { d2.alt = clamp(d2.alt * k, 5, S.vp.radiusM * 0.6); if (d2.alt >= S.vp.radiusM * 0.6 && k > 1) { showGlobe(S.planet, { distance: 1.4 }); emit('exit', { kind: 'surface', to: 'globe', planet: S.planet }); } }
      else if (S.mode === 'globe' && S.vp) { var minD = 1 + landMaxAlt() / S.vp.radiusM * 0.85; globeCam.dist = clamp(1 + (globeCam.dist - 1) * k, minD * 0.98, 14); if (globeCam.dist <= minD && k < 1) landFromGlobe(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top); }
      else if (S.mode === 'surface') { var maxA = landMaxAlt();
        // 气态/冰巨星：1 bar 参考面不是地面，滚轮要能平滑穿过 0 一路钻进霾里（在 alt + 偏置 的空间里做指数缩放）
        if (S.vp && S.vp.gas) { var off = Math.abs(gasMinAlt()) * 0.5; surf.alt = clamp((surf.alt + off) * k - off, gasMinAlt(), maxA); }
        else if (surf.alt >= 0) { surf.alt *= k; if (surf.alt < 3 && k < 1 && surf.water) surf.alt = -3; }
        else { surf.alt += (k - 1) * 40; if (surf.alt > -0.5) surf.alt = 3; }
        if (surf.alt >= maxA && k > 1) { showGlobe(S.planet, { altitudeM: maxA * 1.05, spin: globeCam.spin, yaw: globeCam.yaw, pitch: globeCam.pitch }); emit('exit', { kind: 'surface', to: 'globe', planet: S.planet }); return; }
        if (!(S.vp && S.vp.gas)) { if (surf.alt < 50 && surf.pitch < -0.4) surf.pitch = -0.4; if (surf.alt < 60000 && surf.pitch < -0.4 && k < 1) surf.pitch = Math.max(surf.pitch, lerp(-0.5, -18 * DEG, smoothstep(60000, 20000, surf.alt))); }
        updateGround(); }
    }
    function onKey(e) { var down = e.type === 'keydown'; keys[e.code] = down; if (!down) return; stopCruise();
      if (tb && tbKey(e.code)) { e.preventDefault(); return; }
      if (S.mode === 'system' && sysDim() === 3 && e.code === 'KeyT' && !tb) { showThreeBody({}); e.preventDefault(); return; }
      if (S.mode === 'system' && sysDim() !== 2 && sysDim() !== 3 && demoKey(e.code)) { e.preventDefault(); return; }
      if (e.code === 'Escape' || e.code === 'Backspace') { goUp(); e.preventDefault(); }
      else if (e.code === 'Enter') { enterSelected(); }
      else if (e.code === 'BracketLeft' || e.code === 'BracketRight') { stepSibling(e.code === 'BracketRight' ? 1 : -1); }   // 同层同类天体：行星层换行星，卫星层换卫星
      else if (S.mode === 'system' && (e.code === 'Comma' || e.code === 'Period')) { setSpeedMul(speedMul * (e.code === 'Period' ? 2 : 0.5)); }
      else if (e.code === 'KeyM') { showMoons = !showMoons; emit('change', getState()); }   // 卫星（放大示意）开关
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault(); }
    function onBlur() { keys = {}; }
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onPtrCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('keydown', onKey); canvas.addEventListener('keyup', onKey); canvas.addEventListener('blur', onBlur);
    canvas.addEventListener('contextmenu', onCtxMenu);
    // globe 视图里拾取卫星（双击进入）：拾取半径 ≥18 px
    function pickMoon(px, py) {
      if (S.mode !== 'globe' || !moonPick.length) return null;
      var M = globeMatrices(), best = null, bd = 1e9;
      for (var i = 0; i < moonPick.length; i++) { var m = moonPick[i], sc = toScreen(M.vp, m.pos); if (sc[2] > 1) continue;
        var d = Math.hypot(sc[0] - px, sc[1] - py); if (d < Math.max(18, m.r * 90) && d < bd) { bd = d; best = m; } }
      return best;
    }
    // 拾取：圆点半径 ≥14 px，或落在标签文字矩形内（含 4 px 边距）
    function pickPlanet(px, py) { var best = null, bd = 1e9; for (var i = 0; i < planetPos.length; i++) { var q = planetPos[i]; if (!q) continue; var d = Math.hypot(q.sx - px, q.sy - py); var inLabel = q.label && px >= q.label.x - 4 && px <= q.label.x + q.label.w + 4 && py >= q.label.y - q.label.h / 2 - 4 && py <= q.label.y + q.label.h / 2 + 4; if (inLabel) d = Math.min(d, 1); if ((d < Math.max(14, q.px + 8) || inLabel) && d < bd) { bd = d; best = { index: i, planet: S.system.planets[i] }; } } return best; }
    // 恒星本体的拾取（半径 ≥22 px）：让"进入恒星"和"进入行星"是同一个交互
    function pickStar(px, py) { var best = null, bd = 1e9; for (var i = 0; i < starScreen.length; i++) { var q = starScreen[i], d = Math.hypot(q.sx - px, q.sy - py); if (d < 26 && d < bd) { bd = d; best = q; } } return best; }
    function setSpeedMul(m) { speedMul = clamp(m, 1 / 64, 64); orbitSpeed = orbitSpeedBase * speedMul; }
    // 自动巡航：朝地平线以约 高度×0.3 m/s 前进并轻微转向；任意按键/指针/滚轮接管
    function cruise(dt) { surf.cruiseT += dt; var sp = clamp(Math.abs(surf.alt) * 0.3, 2, 6000) * dt, hd = surf.heading; surf.heading += Math.sin(surf.cruiseT * 0.13) * 0.06 * dt; var Rm = S.vp.radiusM; surf.lat += Math.cos(hd) * sp / Rm; surf.lon += Math.sin(hd) * sp / (Rm * Math.max(Math.cos(surf.lat), 0.05)); surf.lat = clamp(surf.lat, -1.55, 1.55); surf.lon = ((surf.lon + PI) % TAU + TAU) % TAU - PI; if (surf.alt >= 50 && surf.pitch < -0.45) surf.pitch += (-16 * DEG - surf.pitch) * Math.min(1, dt * 0.8); updateGround(); }
    function stopCruise() { surf.cruise = false; }
    function moveSurface(dt) {
      var sp = clamp(Math.abs(surf.alt) * 0.9, 2.5, 30000) * (keys.ShiftLeft || keys.ShiftRight ? 4 : 1) * dt, f = 0, s = 0, moved = false;
      if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1; if (keys.KeyA) s -= 1; if (keys.KeyD) s += 1;
      if (keys.ArrowLeft) surf.heading -= dt * 1.2; if (keys.ArrowRight) surf.heading += dt * 1.2;
      if (keys.KeyR || keys.PageUp) { surf.alt *= Math.exp(dt * 1.5); moved = true; } if (keys.KeyF || keys.PageDown) { surf.alt *= Math.exp(-dt * 1.5); moved = true; }
      if (f || s) { var hd = surf.heading, dx = (Math.sin(hd) * f + Math.cos(hd) * s) * sp, dy = (Math.cos(hd) * f - Math.sin(hd) * s) * sp, Rm = S.vp.radiusM;
        surf.lat += dy / Rm; surf.lon += dx / (Rm * Math.max(Math.cos(surf.lat), 0.05)); if (surf.lat > 1.55) { surf.lat = 1.55; } if (surf.lat < -1.55) surf.lat = -1.55; surf.lon = ((surf.lon + PI) % TAU + TAU) % TAU - PI; moved = true; }
      if (moved) updateGround();
    }

    /* ============================================================ 维数分支：2 维镜像层 / D≠3 轨道投影演示 */
    var d2 = { x: 0, alt: 800, dir: 1, spin: 0, cruise: true, angle: 0 }; // 2 维状态（x：沿剖面的位置，米；alt：距剖面线高度）
    var demo = null;                                                    // orbitDemo 状态
    function sysDim() { return (S.system && S.system.dim) || (S.planet && S.planet.dim) || 3; }
    function planeMatrices(cx, cz, dist) { // 俯视平面相机（2 维系统 / 圆盘）
      var eye = [cx, dist, cz], view = m4lookAt(eye, [cx, 0, cz], [0, 0, -1]), proj = m4persp(45 * DEG, W / H, dist * 0.01, dist * 20);
      return { view: view, proj: proj, vp: m4mul(proj, view), eye: eye };
    }
    function orthoMatrices(cx, cy, halfW) { // 剖面侧视：正交投影，x 向右，y 向上
      var halfH = halfW * H / W, proj = m4ortho(cx - halfW, cx + halfW, cy - halfH, cy + halfH, -10, 10);
      return { view: m4id(), proj: proj, vp: proj, eye: [cx, cy, 0], halfW: halfW, halfH: halfH };
    }
    /* ---------- 2 维恒星系：力 ∝ 1/r（对数势），真实积分；束缚轨道对任意能量都存在，呈玫瑰线 */
    function init2DSystem(system) {
      var p0 = system.planets[0], v0 = p0 ? TAU * p0.orbitAU / Math.max(p0.periodYr, 1e-6) : TAU; system.v0 = v0;
      system.planets.forEach(function (p, i) { var rnd = mulberry32(p.seed ^ 0x2D), eps = 0.04 + rnd() * 0.16, ang = p.phase || rnd() * TAU; p.periodYr = +(TAU * p.orbitAU / v0).toFixed(4);
        p.st2 = { x: p.orbitAU * Math.cos(ang), y: p.orbitAU * Math.sin(ang), vx: -v0 * (1 + eps) * Math.sin(ang), vy: v0 * (1 + eps) * Math.cos(ang), trail: [], eps: eps }; });
    }
    /* 子步数必须有上限（短周期行星 T≈0.003 年碰上大 speedMul 时，一帧几十万步就是假死），
       但**不能靠把步长调粗来省事** —— 那会悄悄降低轨道精度，而界面上什么都不说，
       正好犯了这个项目最忌讳的那条：把示意当成计算。

       改成和 stepThreeBody 同一个办法：**步长一个字不动，压缩这一帧推进的模拟时间**。
       压缩比按「最紧的那颗行星」统一算，全系统同一个 scale —— 各推各的会让行星之间
       相位错开，那比精度下降更糟（看到的轨道关系是假的）。
       表现为：快进倍率太高时，演示在现实时间里自动变慢，而不是画出一条不准的轨道。 */
    var SYS2D_MAX_SUB = 3000;
    function step2DSystem(dtYr) {
      var sys = S.system, v0 = sys.v0, GM = v0 * v0;
      var scale = 1;
      sys.planets.forEach(function (p) {
        if (!p.st2) return;
        var T = p.periodYr || 1, need = Math.ceil(dtYr / (T / 240));
        if (need > SYS2D_MAX_SUB) scale = Math.min(scale, SYS2D_MAX_SUB / need);
      });
      S.sys2dThrottled = scale < 1;
      dtYr = dtYr * scale;
      sys.planets.forEach(function (p) { var s = p.st2; if (!s) return; var T = p.periodYr || 1, n = Math.max(1, Math.ceil(dtYr / (T / 240))), h = dtYr / n;
        for (var k = 0; k < n; k++) { var r2 = s.x * s.x + s.y * s.y, ax = -GM * s.x / r2, ay = -GM * s.y / r2; s.vx += ax * h * 0.5; s.vy += ay * h * 0.5; s.x += s.vx * h; s.y += s.vy * h; r2 = s.x * s.x + s.y * s.y; ax = -GM * s.x / r2; ay = -GM * s.y / r2; s.vx += ax * h * 0.5; s.vy += ay * h * 0.5; }
        var r = Math.hypot(s.x, s.y), rm = mapR(r), vx = rm * s.x / r, vz = -rm * s.y / r; s.trail.push(vx, vz); if (s.trail.length > 2 * 700) s.trail.splice(0, 2); s.view = [vx, 0, vz]; s.sunDir = v3norm([-vx, 0, -vz]); });
    }
    // 2D 恒星系尾迹的顶点缓冲：同一帧里 8 颗行星轮流用同一块（drawLines 当场就把数据喂给 GL，不留引用）
    var trail2D = null;
    function trail2DBuf(n) { if (!trail2D || trail2D.length < n) trail2D = new Float32Array(Math.max(n, 3 * 700)); return trail2D; }
    function draw2DSystem() {
      var sys = S.system, age = sysAgeGyr(), star = sys.star; gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var M = planeMatrices(sysCam.cx || 0, sysCam.cz || 0, sysCam.dist); drawSky(M, { space: true, sun: [0, 1, 0], starColor: [0, 0, 0] });
      var starCol = starRGB(star), sprites = [{ p: [0, 0, 0], size: clamp(H / dpr * 0.1 * sysCam.fit / sysCam.dist, 24, 400), color: [starCol[0], starCol[1], starCol[2], 1], kind: 0 }];
      planetPos = [];
      sys.planets.forEach(function (p, i) { var s = p.st2; planetPos[i] = null; if (!s || !s.view) return;
        var born = smoothstep(p.timeline.formGyr, p.timeline.formGyr + 0.15, age); if (born <= 0) return;
        // 尾迹顶点缓冲复用：尾迹封顶 700 点，原来每颗行星每帧都 new 一个 8.4 KB 的 Float32Array，
        // 8 颗行星 60 fps 就是 ~4 MB/s 的垃圾。写进去的值与改动前逐位相同，只是不再每帧重新分配。
        if (s.trail.length >= 4) { var np2 = s.trail.length / 2 | 0, pts = trail2DBuf(np2 * 3); for (var k = 0; k < np2; k++) { pts[k * 3] = s.trail[k * 2]; pts[k * 3 + 1] = 0; pts[k * 3 + 2] = s.trail[k * 2 + 1]; } R.drawLines(pts.subarray(0, np2 * 3), M.vp, [1, 1, 1, (i === S.selected ? 0.5 : 0.18) * born], false); }
        var sc = toScreen(M.vp, s.view), px = clamp((3.5 + 3.5 * Math.log2(1 + p.radiusRel)) * Math.pow(sysCam.fit / sysCam.dist, 0.5), 3, 60), col = rgb(p.color || '#aaaaaa'), lv = m4dir(M.view, s.sunDir), vp = p.visual || {};
        if ((vp.atmDensity || 0) > 0.05) sprites.push({ p: s.view, size: px * 2.2, color: [vp.atm[0], vp.atm[1], vp.atm[2], 0.35 * Math.min(1, vp.atmDensity)], kind: 0 }); // 大气边光（圆盘外沿）
        sprites.push({ p: s.view, size: px, color: [col[0], col[1], col[2], born], light: lv, kind: 1 });          // 圆盘：昼夜半圆
        if (i === S.selected) sprites.push({ p: s.view, size: px + 7, color: [1, 1, 1, 0.9], kind: 2 });
        planetPos[i] = { sx: sc[0], sy: sc[1], px: px, pos: s.view, depth: sc[2] }; });
      sprites.sort(function (a, b) { return a.kind === 0 ? -1 : b.kind === 0 ? 1 : 0; }); R.drawSprites(sprites, M.vp, W, H);
      var sc0 = toScreen(M.vp, [0, 0, 0]); R.drawText(star.name, sc0[0] + 12, sc0[1] - 12, 13, '#f0e6d2', 0.9, W, H, dpr);
      sys.planets.forEach(function (p, i) { var q = planetPos[i]; if (!q) return; var sel = i === S.selected; var lw = R.drawText(TRN(p.name) + (p.life ? ' ·' + TR(p.life.level) : ''), q.sx + q.px + 6, q.sy - 4, sel ? 13 : 12, sel ? '#ffffff' : '#c8c8c8', 0.85, W, H, dpr); q.label = { x: q.sx + q.px + 6, y: q.sy - 4, w: lw, h: 18 }; if (sel) R.drawText(TR('Enter 进入 · 再点一次或双击进入'), q.label.x, q.label.y + 16, 11, '#9fd3ff', 0.95, W, H, dpr); });
      S.caption = TRN(sys.name) + TR(' · 二维宇宙的恒星系（示意 · 2 维几何）· 引力 ∝ 1/r（对数势，2+1 维推测）· 轨道为真实积分的玫瑰线 · 恒星系年龄 ') + fmtYr(age * 1e9)
        + (S.sys2dThrottled ? TR(' · 快进倍率超出单帧算力：步长不变，演示在现实时间里放慢（轨道精度未降）') : '');
      drawHud([S.caption, TR('时间流速 ×') + speedMul + TR('（1 秒 = ') + fmt(orbitSpeed * 365.25, 1) + TR(' 天）· 拖动平移 · 滚轮缩放 · 单击选中，再点/双击/Enter 进入'), S.selected >= 0 ? TRN(sys.planets[S.selected].name) + TR('：') + sys.planets[S.selected].desc : '']);
    }
    /* ---------- 2 维行星：圆盘 = 整个世界，圆周 = 地面（一条线） */
    /* 圆周剖面的三个输出数组：draw2DGlobe 每帧都要重算一遍（n=540），结果当帧用完就不再引用，
       所以按 n 复用同一组缓冲，不再每帧 new 三个定型数组。逐点数值与改动前完全相同。 */
    var prof2D = null;
    function prof2DBufs(n) {
      if (!prof2D || prof2D.n !== n) prof2D = { n: n, h: new Float32Array(n), cls: new Uint8Array(n), moist: new Float32Array(n) };
      return prof2D;
    }
    function profile2D(maps, vp, oct, spin, n) { // 圆周剖面：角度 θ → 高度（归一化）与分类
      var B = prof2DBufs(n), out = B.h, cls = B.cls, moistA = B.moist;
      for (var j = 0; j < n; j++) { var th = j / n * TAU + spin, nn = [Math.cos(th), 0, -Math.sin(th)], f = fieldAtCPU(maps, vp, nn, oct); out[j] = f.h; moistA[j] = f.moist;
        var land = vp.sea < 0 || f.h >= vp.sea, elev = vp.sea < 0 ? f.h : (f.h - vp.sea) / (1 - vp.sea);
        cls[j] = !land ? (vp.lavaSea > 0.5 ? 5 : 1) : (elev > 0.55 ? 3 : (vp.green > 0.2 && f.moist > 0.35 && elev < 0.5 ? 2 : (vp.lava > 0.3 ? 5 : 0))); }
      return { h: out, cls: cls, moist: moistA };
    }
    var CLS_COL = { 0: [0.55, 0.5, 0.42], 1: [0.1, 0.35, 0.6], 2: [0.25, 0.5, 0.22], 3: [0.9, 0.92, 0.95], 5: [0.9, 0.35, 0.08] };
    function draw2DGlobe() {
      var p = S.planet, vp = S.vp; gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var M = planeMatrices(0, 0, globeCam.dist), sunW = globeSunDir(), sun2 = v3norm([sunW[0], 0, sunW[2]]); drawSky(M, { space: true, sun: sunW, starColor: starRGB(p.star) });
      var g = R.planetGPU(p, vp), n = 540, prof = profile2D(g.maps, vp, 4, globeCam.spin, n), href = hRefOf(vp), ex = 0.09;
      var groups = {}, sea = vp.sea >= 0 ? 1 + ex * (vp.sea - href) : -1;
      function push(key, a, b, c) { (groups[key] = groups[key] || []).push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]); }
      for (var j = 0; j < n; j++) { var j2 = (j + 1) % n, th = j / n * TAU, th2 = j2 / n * TAU, r1 = 1 + ex * (prof.h[j] - href), r2 = 1 + ex * (prof.h[j2] - href);
        var mid = [Math.cos(th + 0.5 / n * TAU), 0, -Math.sin(th + 0.5 / n * TAU)], day = v3dot(mid, sun2) > 0 ? 'D' : 'N', c = prof.cls[j];
        push(c + day, [0, 0], [Math.cos(th) * r1, -Math.sin(th) * r1], [Math.cos(th2) * r2, -Math.sin(th2) * r2]);
        if (sea > 0 && prof.h[j] < vp.sea) push('1' + day, [0, 0], [Math.cos(th) * sea, -Math.sin(th) * sea], [Math.cos(th2) * sea, -Math.sin(th2) * sea]); }
      gl.disable(gl.DEPTH_TEST);
      var sprites = [{ p: [0, 0, 0], size: H / dpr * 0.42 * (2.6 / globeCam.dist) * 1.16, color: [vp.atm[0], vp.atm[1], vp.atm[2], 0.5 * Math.min(1, vp.atmDensity)], kind: 0 }];
      if (vp.atmDensity > 0.02) R.drawSprites(sprites, M.vp, W, H);
      Object.keys(groups).forEach(function (key) { var c = CLS_COL[+key[0]] || CLS_COL[0], night = key[1] === 'N', col = night ? [c[0] * 0.12, c[1] * 0.12, c[2] * 0.16, 1] : [c[0], c[1], c[2], 1]; if (vp.fog > 0.3 && !night) col = mix3(col, vp.fogColor, vp.fog * 0.6).concat([1]); R.drawLines(new Float32Array(groups[key]), M.vp, col, 'tri'); });
      // 云：贴着圆周外一圈的白色团块；夜面灯光：陆地上的黄点
      var cl = [], N2 = g.maps.noise, sp = []; for (var q = 0; q < 160; q++) { var th3 = q / 160 * TAU + globeCam.spin * 0.7, cv = N2.snoise(Math.cos(th3) * 6 + elapsed * 0.02, 3.3, -Math.sin(th3) * 6); if (cv > 0.62 - vp.cloud * 0.35) sp.push({ p: [Math.cos(th3) * 1.09, 0, -Math.sin(th3) * 1.09], size: 10 * (2.6 / globeCam.dist), color: [1, 1, 1, 0.55 * Math.min(1, vp.cloud * 1.5)], kind: 0 }); }
      if (vp.lights > 0.01) for (var j3 = 0; j3 < n; j3 += 3) { if (prof.cls[j3] === 1 || prof.cls[j3] === 5) continue; var thL = j3 / n * TAU, midL = [Math.cos(thL), 0, -Math.sin(thL)]; if (v3dot(midL, sun2) > -0.05) continue; if (N2.snoise(midL[0] * 30, 1, midL[2] * 30) < 0.35) continue; var rr = 1 + ex * (prof.h[j3] - href) + 0.004; sp.push({ p: [Math.cos(thL) * rr, 0, -Math.sin(thL) * rr], size: 3.5 * (2.6 / globeCam.dist), color: [1, 0.85, 0.5, 0.9 * vp.lights], kind: 1, light: [0, 0, 1] }); }
      if (sp.length) R.drawSprites(sp, M.vp, W, H);
      S.caption = TRN(p.name) + TR(' · 二维世界（示意 · 2 维几何）· ') + TR(vp.eraName) + TR(' · 圆盘就是整个星球，圆周就是它的地面');
      drawHud([S.caption, p.desc, TR('拖动旋转 · 滚轮拉近直至降落 · 双击圆周某处降落 · Esc 返回')]);
    }
    function land2DAt(angle, alt, lit) { // angle：圆周上的位置（弧度，含自转）
      var p = S.planet; d2.angle = angle; d2.x = angle * S.vp.radiusM; d2.alt = alt != null ? alt : 800; d2.dir = 1; d2.cruise = true;
      if (lit) { var sw = globeSunDir(), sunAng = Math.atan2(-sw[2], sw[0]); globeCam.spin = angle - (sunAng - 50 * DEG); } // 从 API 直接降落：让落点处于白昼
      setMode('surface');
      emit('enter', { kind: 'surface', planet: p, lat: 0, lon: (angle / DEG) % 360, altitudeM: d2.alt, from: '2d' });
    }
    function draw2DSurface() { // 一维地形剖面侧视：地平线是一条线
      var p = S.planet, vp = S.vp, g = R.planetGPU(p, vp), Rm = vp.radiusM, maps = g.maps;
      var alt = d2.alt, halfW = clamp(alt * 3.2 + 300, 500, Rm * 0.9), N = 480, href = hRefOf(vp);
      var xs = new Float32Array(N), hs = new Float32Array(N), cls = new Uint8Array(N), moist = new Float32Array(N), oct = clamp(Math.round(11 - Math.log2(Math.max(alt, 5) / 50)), 5, 11);
      for (var i = 0; i < N; i++) { var x = d2.x - halfW + (i / (N - 1)) * 2 * halfW, th = x / Rm, nn = [Math.cos(th), 0, -Math.sin(th)], f = fieldAtCPU(maps, vp, nn, oct), hm = (f.h - href) * vp.rangeM; xs[i] = x; hs[i] = hm; moist[i] = f.moist;
        var land = vp.sea < 0 || f.h >= vp.sea, elev = vp.sea < 0 ? f.h : (f.h - vp.sea) / (1 - vp.sea); cls[i] = !land ? (vp.lavaSea > 0.5 ? 5 : 1) : (elev > 0.55 ? 3 : (vp.green > 0.2 && f.moist > 0.35 && elev < 0.5 ? 2 : (vp.lava > 0.3 ? 5 : 0))); }
      var ic = Math.floor(N / 2), ground = Math.max(hs[ic], vp.sea >= 0 ? 0 : -1e9); d2.groundM = hs[ic]; d2.water = vp.sea >= 0 && hs[ic] < 0;
      var camY = ground + alt, cy = camY - alt * 0.35, M = orthoMatrices(d2.x, cy, halfW);
      // 天空：借用 3 维天空着色器（水平望向 +y，z 向上）
      var sunW = globeSunDir(), thC = d2.x / Rm - globeCam.spin, nC = [Math.cos(thC), 0, -Math.sin(thC)], el = Math.asin(clamp(v3dot(v3norm([sunW[0], 0, sunW[2]]), nC), -1, 1)), tang = [-Math.sin(thC), 0, -Math.cos(thC)], side = v3dot(v3norm([sunW[0], 0, sunW[2]]), tang);
      var sunL = v3norm([side * Math.cos(el), 0.35, Math.sin(el)]), day = clamp(sunL[2] * 3 + 0.2, 0, 1);
      var skyM = { vp: m4mul(m4persp(60 * DEG, W / H, 0.1, 100), m4lookAt([0, 0, 0], [0, 1, 0], [0, 0, 1])), eye: [0, 0, 0] };
      gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawSky(skyM, { space: false, sun: sunL, atm: vp.atm, fogColor: vp.fogColor, starColor: starRGB(p.star), atmDensity: vp.atmDensity, altitude: alt, fog: vp.fog });
      // 地面：按分类分组填充（剖面线以下）
      var groups = {}, bottom = cy - M.halfH - 10;
      for (i = 0; i < N - 1; i++) { var k = cls[i]; (groups[k] = groups[k] || []).push(xs[i], hs[i], 0, xs[i + 1], hs[i + 1], 0, xs[i], bottom, 0, xs[i + 1], hs[i + 1], 0, xs[i + 1], bottom, 0, xs[i], bottom, 0); }
      var fogc = mix3(v3scale(vp.atm, 1.1), vp.fogColor, vp.fog);
      Object.keys(groups).forEach(function (key) { var c = CLS_COL[+key] || CLS_COL[0], col = [c[0] * (0.35 + 0.65 * day), c[1] * (0.35 + 0.65 * day), c[2] * (0.35 + 0.65 * day), 1]; if (+key === 5) col = [c[0], c[1], c[2], 1]; R.drawLines(new Float32Array(groups[key]), M.vp, col, 'tri'); });
      // 海面：一条水平线以下的半透明填充（剖面线以下、海平面以上）
      if (vp.sea >= 0) { var wq = []; for (i = 0; i < N - 1; i++) { if (hs[i] < 0 || hs[i + 1] < 0) wq.push(xs[i], 0, 0, xs[i + 1], 0, 0, xs[i], Math.min(hs[i], 0) - 0.5, 0, xs[i + 1], 0, 0, xs[i + 1], Math.min(hs[i + 1], 0) - 0.5, 0, xs[i], Math.min(hs[i], 0) - 0.5, 0); } if (wq.length) { var oc = vp.lavaSea > 0.5 ? [0.95, 0.4, 0.1, 0.95] : [vp.oceanShallow[0] * day + 0.05, vp.oceanShallow[1] * day + 0.08, vp.oceanShallow[2] * day + 0.15, 0.85]; R.drawLines(new Float32Array(wq), M.vp, oc, 'tri'); } }
      // 剖面线（地面就是这条线）+ 雪线
      var line = new Float32Array(N * 3); for (i = 0; i < N; i++) { line[i * 3] = xs[i]; line[i * 3 + 1] = Math.max(hs[i], vp.sea >= 0 ? 0 : -1e9); line[i * 3 + 2] = 0; } R.drawLines(line, M.vp, [0.08, 0.07, 0.06, 0.9], false);
      // 植被 / 聚落 / 灯光 / 云（沿线分布，过程生成示意）
      var sp = [], N2 = maps.noise, pxScale = (H / dpr) / (2 * M.halfH), night = 1 - day;
      for (i = 0; i < N; i += 2) { var x2 = xs[i], h2 = hs[i]; if (cls[i] === 2 && N2.snoise(x2 * 0.002, 4.4, 0) > -0.2) { var ts = clamp(12 * pxScale, 1.5, 6); sp.push({ p: [x2, h2 + 6, 0], size: ts, color: [0.15, 0.4, 0.15, 1], kind: 1, light: [0.4, 0.5, 0.8] }); }
        if (vp.lights > 0.01 && (cls[i] === 0 || cls[i] === 2) && Math.abs(N2.snoise(Math.floor(x2 / 9000) * 0.37, 7.7, 0)) > 0.55 && N2.snoise(x2 * 0.004, 9.1, 0) > 0.1) { var bs = clamp(20 * pxScale, 2, 9); sp.push({ p: [x2, h2 + 10, 0], size: bs, color: night > 0.4 ? [1, 0.85, 0.5, 0.9 * night] : [0.6, 0.58, 0.55, 1], kind: 1, light: [0, 0.6, 0.8] }); } }
      for (var q = 0; q < 40; q++) { var cx = d2.x - halfW + q / 40 * 2 * halfW, cv = N2.snoise(cx * 0.0004 + elapsed * 0.01, 5.5, 0); if (cv > 0.7 - vp.cloud * 0.4) sp.push({ p: [cx, 2500 + 1500 * N2.snoise(cx * 0.001, 6.6, 0), 0], size: clamp(1400 * pxScale, 6, 60), color: [1, 1, 1, 0.5 * Math.min(1, vp.cloud * 1.5) * (0.4 + 0.6 * day)], kind: 0 }); }
      if (sp.length) R.drawSprites(sp, M.vp, W, H);
      // 视点标记（一个小三角）
      var vy = camY; R.drawLines(new Float32Array([d2.x - 8 * (halfW / (W / dpr)) * 2, vy + 14 * (halfW / (W / dpr)) * 2, 0, d2.x + 8 * (halfW / (W / dpr)) * 2, vy + 14 * (halfW / (W / dpr)) * 2, 0, d2.x, vy, 0]), M.vp, [1, 1, 1, 0.5], 'loop');
      var typ = d2.water ? TR('海面') : (cls[ic] === 3 ? TR('高地') : cls[ic] === 2 ? TR('植被带') : cls[ic] === 5 ? TR('熔岩') : TR('荒地'));
      S.caption = TRN(p.name) + TR(' · 二维世界（示意）· 地面是一条线 · 沿圆周 ') + fmtKm(((d2.x % (TAU * Rm)) + TAU * Rm) % (TAU * Rm)) + ' / ' + fmtKm(TAU * Rm) + TR(' · 高度 ') + fmtKm(alt) + TR(' · 正在飞越：') + typ + (d2.cruise ? TR(' · 自动前进（← → 接管）') : '');
      drawHud([S.caption, p.desc, TR('← → / A D 沿剖面前进 · 滚轮 = 高度 · Esc 返回')]);
    }
    function move2D(dt) { var sp = clamp(d2.alt * 0.5 + 40, 40, 20000) * dt * (keys.ShiftLeft ? 4 : 1), mv = 0; if (keys.ArrowLeft || keys.KeyA) mv -= 1; if (keys.ArrowRight || keys.KeyD) mv += 1; if (mv) { d2.cruise = false; d2.dir = mv; d2.x += mv * sp; } else if (d2.cruise) d2.x += d2.dir * sp * 0.6; }
    /* ---------- D≠3：D 维两体（多体）真实积分 → 3 维投影 */
    function initOrbitDemo(D, eps, seed) {
      D = D || 4; eps = eps == null ? 0.01 : eps; var rnd = mulberry32((seed || 1) ^ 0xD1);
      var n = clamp(S.system && S.system.planets ? S.system.planets.length : 5, 4, 6), planets = [];
      /* 初始条件必须真的跟着 seed 变。原来 r0 = 1+0.55k、ph = k*1.3+0.4、扰动符号 sg 全是写死的，
         种子唯一的用处是给 vel[2] 抽一个符号位——于是同一个 D 下每个恒星系画出来都是同一条曲线
         （用户在 D=8.11 下发现的）。现在半径、相位、各维扰动方向都由种子决定；
         环向速度仍严格取 vc = √(1/r₀^{D−2})，保证扰动为 0 时它是精确的圆轨道。 */
      for (var k = 0; k < n; k++) { var dim = Number.isInteger(D) ? D : 3;
        var r0 = (1 + 0.55 * k) * (0.82 + 0.36 * rnd()), vc = Math.sqrt(1 / Math.pow(r0, D - 2));
        var ph = k * 1.3 + 0.4 + rnd() * TAU, pos = new Float64Array(dim), vel = new Float64Array(dim); /* 分数维：无额外坐标轴，维数只通过引力律指数起作用 */
        var sg = rnd() < 0.5 ? 1 : -1; pos[0] = r0 * Math.cos(ph); pos[1] = r0 * Math.sin(ph); vel[0] = -vc * (1 + sg * eps) * Math.sin(ph); vel[1] = vc * (1 + sg * eps) * Math.cos(ph); if (dim > 2) vel[2] = vc * eps * 0.7 * (rnd() < 0.5 ? -1 : 1); for (var q3 = 3; q3 < dim; q3++) vel[q3] = vc * eps * 0.6 * (rnd() < 0.5 ? 1 : -1); /* 第 4..D 维也给同量级扰动，方向逐维随机 */
        planets.push({ r0: r0, vc: vc, T0: TAU * r0 / vc, pos: pos, vel: vel, status: '束缚', periods: 0, lastAng: Math.atan2(pos[1], pos[0]), r: r0, prevR: r0, prevR2: r0, peri: [], precDeg: null, trail: [], name: S.system && S.system.planets[k] ? S.system.planets[k].name : TR('试探行星 ') + (k + 1), color: S.system && S.system.planets[k] ? rgb(S.system.planets[k].color || '#aaa') : [0.8, 0.8, 0.9] }); }
      /* 演示时钟：注释一直写着「4 秒 = 内行星 1 圈」，但实现里用的是固定的 TAU/4，
         而一圈的时长 T0 = TAU·r0^{D/2} 随维数暴涨 —— D=14 时最外那颗 T0≈2.7e4，
         固定步进下几分钟也走不满 0.1 圈，面板于是一排「0.0 圈」，看着像什么都没发生。
         改成按**最内那颗质点的周期**归一：任何 D 下，1 现实秒 ≈ 内质点 1/4 圈，
         能动的那颗几秒内就看得见它离开初始圆。外面那些本来就几乎不受力（见标注），
         它们走得慢是物理结论，不是演示坏了。 */
      var minT0 = Infinity;
      for (var q4 = 0; q4 < planets.length; q4++) if (planets[q4].T0 > 0 && planets[q4].T0 < minT0) minT0 = planets[q4].T0;
      if (!isFinite(minT0) || minT0 <= 0) minT0 = TAU;
      var dm0 = { D: D, dim: Number.isInteger(D) ? D : 3, eps: eps, t: 0, planets: planets, paused: false, seed: seed || 1, dtMax: TAU / 700, simPerSec: minT0 / 4, minT0: minT0,
        r0Sel: 1, probe: null, probeDrag: false };
      dm0.probe = makeProbe(dm0, dm0.r0Sel);
      return dm0;
    }
    // 统一走 DIMG（见模块顶部）。这里显式传 eps=0：单个试探质点绕中心点质量，r<0.06 就判坠核，
    // 用不着软化——与改动前逐位相同，只是换了个出处，好让 ui/hyper.js 读同一套。
    /* 玩家拨的那颗试探质点（specs/highdim-v1.md 二节）。构造与集合里的质点完全同源：
       环向速度严格取该力律下的圆速度 vc = √(r₀·|a|(r₀)) = r₀^{−(D−2)/2}（核以 r=1 归一），
       再叠一个与集合同量级的扰动 eps —— 所以它「本来应该是圆轨道」，跑不圆是力律的锅，不是初值的锅。 */
    function makeProbe(dm, r0) {
      var D = dm.D, dim = dm.dim, eps = dm.eps;
      r0 = clamp(+r0 || 1, 0.3, 4);
      var vc = Math.sqrt(r0 * DIMG.accelMag(r0, D, 0));
      var pos = new Float64Array(dim), vel = new Float64Array(dim), ph = 0.6;
      pos[0] = r0 * Math.cos(ph); pos[1] = r0 * Math.sin(ph);
      vel[0] = -vc * (1 + eps) * Math.sin(ph); vel[1] = vc * (1 + eps) * Math.cos(ph);
      if (dim > 2) vel[2] = vc * eps * 0.7;
      return { r0: r0, vc: vc, T0: TAU * r0 / Math.max(vc, 1e-12), pos: pos, vel: vel, status: '束缚',
        periods: 0, lastAng: ph, r: r0, prevR: r0, prevR2: r0, peri: [], precAcc: 0, precN: 0, t: 0, tEnd: null, isProbe: true, trail: [] };
    }
    function accelD(pos, D) { return DIMG.accel(pos, D, new Float64Array(pos.length), 0); }
    function rk4Step(p, h, D) { var n = p.pos.length, x = p.pos, v = p.vel, i;
      var a1 = accelD(x, D), x2 = new Float64Array(n), v2 = new Float64Array(n); for (i = 0; i < n; i++) { x2[i] = x[i] + 0.5 * h * v[i]; v2[i] = v[i] + 0.5 * h * a1[i]; }
      var a2 = accelD(x2, D), x3 = new Float64Array(n), v3 = new Float64Array(n); for (i = 0; i < n; i++) { x3[i] = x[i] + 0.5 * h * v2[i]; v3[i] = v[i] + 0.5 * h * a2[i]; }
      var a3 = accelD(x3, D), x4 = new Float64Array(n), v4 = new Float64Array(n); for (i = 0; i < n; i++) { x4[i] = x[i] + h * v3[i]; v4[i] = v[i] + h * a3[i]; }
      var a4 = accelD(x4, D); for (i = 0; i < n; i++) { x[i] += h / 6 * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]); v[i] += h / 6 * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]); } }
    /* 每帧子步数封顶。n = simDt/dtMax，simDt = dt·TAU/4·speedMul（dt 兜 0.1、speedMul 兜 64）
       ⇒ 最多 1121 步/质点，6 个质点就是 6726 次 14 维 RK4；这里再压一道总预算，
       超了就本帧到此为止（步长不动、轨道逐位不变，只是现实时间里放慢），与 stepThreeBody 同一套办法。 */
    var ODEMO_MAX_SUB = 4000;
    function stepOrbitDemo(dm, simDt) {
      var n = Math.max(1, Math.ceil(simDt / dm.dtMax)), h = simDt / n;
      var live = (dm.probe ? dm.planets.concat([dm.probe]) : dm.planets).filter(function (p) { return p.status === '束缚'; }).length || 1;
      var budget = Math.max(1, Math.floor(ODEMO_MAX_SUB / live));
      dm.throttled = n > budget; if (dm.throttled) n = budget;
      /* 探针与集合走同一个积分器、同一份预算：玩家看到的轨迹和旁边那几颗是同一套数。 */
      var all = dm.probe ? dm.planets.concat([dm.probe]) : dm.planets;
      all.forEach(function (p) { if (p.status !== '束缚') return;
        for (var k = 0; k < n; k++) { rk4Step(p, h, dm.D); var r2 = 0; for (var i = 0; i < p.pos.length; i++) r2 += p.pos[i] * p.pos[i]; var r = Math.sqrt(r2);
          var ang = Math.atan2(p.pos[1], p.pos[0]), da = ang - p.lastAng; if (da > PI) da -= TAU; if (da < -PI) da += TAU; p.periods += da / TAU; p.lastAng = ang;
          if (p.prevR2 > p.prevR && p.prevR < r) { var pa = Math.atan2(p.pos[1], p.pos[0]); if (p.peri.length) { var d = pa - p.peri[p.peri.length - 1]; while (d > PI) d -= TAU; while (d < -PI) d += TAU; p.precDeg = d / DEG; p.precAcc = (p.precAcc || 0) + d / DEG; p.precN = (p.precN || 0) + 1; } p.peri.push(pa); if (p.peri.length > 50) p.peri.shift(); }
          p.prevR2 = p.prevR; p.prevR = r; p.r = r;
          var v2 = 0; for (i = 0; i < p.vel.length; i++) v2 += p.vel[i] * p.vel[i]; var E = 0.5 * v2 + (Math.abs(dm.D - 2) < 1e-9 ? Math.log(r) : -1 / ((dm.D - 2) * Math.pow(r, dm.D - 2)));
          if (!isFinite(r)) { p.status = '坠入'; p.tEnd = dm.t; break; }   // D 高时 r^{-(D-1)} 在近心处发散，算出 NaN 即视为砸进核
          if (r < 0.06) { p.status = '坠入'; p.tEnd = dm.t; break; } if (r > 40 || (r > 12 && E > 0)) { p.status = '逃逸'; p.tEnd = dm.t; break; } }
        var o2 = 0, r2t = 0; for (var q = 0; q < p.pos.length; q++) { r2t += p.pos[q] * p.pos[q]; if (q >= 3) o2 += p.pos[q] * p.pos[q]; } p.outFrac = r2t > 0 ? Math.sqrt(o2 / r2t) : 0; p.outMax = Math.max(p.outMax || 0, p.outFrac);
        if (p.trail) { p.trail.push(p.pos[0], p.pos.length > 2 ? p.pos[2] : 0, -p.pos[1]); if (p.trail.length > 3 * 900) p.trail.splice(0, 3); }
        if (p.isProbe) p.t = dm.t; });
      dm.t += simDt;
    }
    /* ---- 试探质点的 r₀ 滑杆（specs/highdim-v1.md 二节）
     * 画在画布上（planets.js 不持有 DOM），拖动实时挪手柄与初始圆，**松手才从新初态重积分**。
     * 量程 0.3–4：左端深在核内、右端远在核外，中间那条竖线就是 r=1 的核边界——
     * 目的就是让玩家把手柄从左拨到右，亲眼看 r^{−(D−1)} 在 r=1 处的悬崖：
     * 外侧 F/F₁ 迅速趋近 0（D 越大越彻底），内侧一头栽进去，中间没有稳定带。
     * D 在 (2,4) 时两侧都还有像样的引力，同一根滑杆看到的是进动（稳定但不闭合）的轨道。 */
    var R0_MIN = 0.3, R0_MAX = 4;
    function r0SliderRect() {
      var w = Math.min(320, Math.max(180, W / dpr * 0.32));
      return { x: 14, y: H / dpr - 92, w: w, h: 10 };
    }
    function r0FromX(px) {
      var b = r0SliderRect(), u = clamp((px - b.x) / b.w, 0, 1);
      return R0_MIN + u * (R0_MAX - R0_MIN);
    }
    function r0ToU(r0) { return clamp((r0 - R0_MIN) / (R0_MAX - R0_MIN), 0, 1); }
    function r0SliderHit(px, py) {
      var b = r0SliderRect();
      return px >= b.x - 10 && px <= b.x + b.w + 10 && py >= b.y - 14 && py <= b.y + b.h + 14;
    }
    function setProbeR0(r0, rebuild) {
      if (!demo) return;
      demo.r0Sel = clamp(r0, R0_MIN, R0_MAX);
      if (rebuild) demo.probe = makeProbe(demo, demo.r0Sel);   // 松手：从新初态重新积分
    }
    function drawR0Slider() {
      if (!demo || !hud) return;
      var b = r0SliderRect(), y = b.y + b.h / 2;
      R.drawScreenRect(b.x, y - 1.5, b.w, 3, '#ffffff', 0.30, W, H, dpr);                       // 轨道条
      var xc = b.x + r0ToU(DIMG.CORE_R) * b.w;
      R.drawScreenRect(xc - 1, b.y - 7, 2, b.h + 14, '#ffb877', 0.9, W, H, dpr);                // 核边界 r=1
      var xh = b.x + r0ToU(demo.r0Sel) * b.w;
      R.drawScreenRect(xh - 2, b.y - 9, 4, b.h + 18, '#5ce8ff', 1, W, H, dpr);                  // 手柄
      R.drawText(TR('试探质点 r₀ ') + fmt(demo.r0Sel, 2) + TR('（拖动；松手重算）'), b.x, b.y - 16, 12, '#8fe8ff', 0.95, W, H, dpr);
      R.drawText('0.3', b.x - 2, b.y + b.h + 16, 11, '#9aa4b5', 0.8, W, H, dpr);
      R.drawText(TR('核边界 r=1'), xc - 26, b.y + b.h + 16, 11, '#ffb877', 0.9, W, H, dpr);
      R.drawText('4', b.x + b.w - 4, b.y + b.h + 16, 11, '#9aa4b5', 0.8, W, H, dpr);
    }
    function drawOrbitDemo(dt) {
      sysTarget = [0, 0, 0];      // 这两个演示都以原点为中心：不清掉会沿用上一个恒星系的宿主偏移
      var sys = S.system; if (!demo) demo = initOrbitDemo(sys.dim, 0.01, sys.seed);
      if (!demo.paused && opts.animate !== false) stepOrbitDemo(demo, dt * (demo.simPerSec || TAU / 4) * speedMul); // 4 秒 = 最内质点 1 圈（按它的 T0 归一，见 initOrbitDemo）
      var M = sysMatrices(); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); drawSky(M, { space: true, sun: [0, 1, 0], starColor: [0, 0, 0] });
      var starCol = starRGB(sys.star), sprites = [{ p: [0, 0, 0], size: clamp(H / dpr * 0.08 * sysCam.fit / sysCam.dist, 20, 300), color: [starCol[0], starCol[1], starCol[2], 1], kind: 0 }];
      /* 参考圆：**画成极淡的虚线**，因为它们是「初始圆」而不是轨道。
         原来画成实线闭环 + 面板写「束缚」，读起来像四条稳定轨道，正好和顶上那句
         「Ehrenfest 1917：D≥4 无稳定圆轨道」互相打脸 —— 用户实测截图里就是这个观感。
         另外补一个 r=1 的核边界圈：引力核就是在 r=1 归一的，圈外 F/F₁ = r^{−(D−1)} 迅速趋近 0
         （D=14、r=2 时是 2⁻¹³ ≈ 1.2×10⁻⁴），圈内反过来发散。这条线不画出来，
         「为什么外面几个质点一动不动」就没法解释。 */
      function dashRing(rad, col) {
        var seg = [], N = 96, on = 3, off = 3;
        for (var i = 0; i < N; i++) { if ((i % (on + off)) >= on) continue;
          var a0 = i / N * TAU, a1 = (i + 1) / N * TAU;
          seg.push(rad * Math.cos(a0), 0, -rad * Math.sin(a0), rad * Math.cos(a1), 0, -rad * Math.sin(a1)); }
        if (seg.length) R.drawLines(new Float32Array(seg), M.vp, col, 'segments');
      }
      demo.planets.forEach(function (p) { dashRing(p.r0, [1, 1, 1, 0.05]); });   // 初始圆（不稳定）
      dashRing(1, [1, 0.72, 0.35, 0.34]);                                        // 核边界 r=1
      planetPos = [];
      /* 严格的投影不会因为"跑到看不见的方向"而变淡：(1,1,1,5,5,5,5,5) 和 (1,1,1,0,0,0,0,0)
         投到前三维是同一个点、同样亮，就像三维物体在墙上的影子不会因为物体离墙远而变暗。
         变淡是我们额外叠上去的可读性提示，不是投影本身的性质——所以做成可关：按 P 切换。
         关掉之后画面就是**纯粹的三维投影**，质点会在你看不出原因的情况下忽然折返或穿过彼此，
         那正是低维观察者看高维运动时会遇到的情形。 */
      var extraAxes = Number.isInteger(demo.D) && demo.D >= 4, pureProj = !!demo.pureProjection;
      demo.planets.forEach(function (p, i) { var of = (extraAxes && !pureProj) ? (p.outFrac || 0) : 0, alpha = 1 - 0.7 * of;
        if (p.trail.length >= 6) { if (extraAxes && of > 0.02) { var onN = Math.max(2, 8 - Math.round(of * 6)), seg = [], np = p.trail.length / 3; for (var k = 0; k < np - 1; k++) { if ((k % 8) < onN) seg.push(p.trail[k * 3], p.trail[k * 3 + 1], p.trail[k * 3 + 2], p.trail[k * 3 + 3], p.trail[k * 3 + 4], p.trail[k * 3 + 5]); } if (seg.length) R.drawLines(new Float32Array(seg), M.vp, [p.color[0], p.color[1], p.color[2], 0.55 * alpha], 'segments'); }
          else R.drawLines(new Float32Array(p.trail), M.vp, [p.color[0], p.color[1], p.color[2], 0.55], false); }
        var pos = [p.pos[0], p.pos.length > 2 ? p.pos[2] : 0, -p.pos[1]], col = p.status === '坠入' ? [1, 0.3, 0.2] : p.status === '逃逸' ? [0.6, 0.6, 0.6] : p.color; sprites.push({ p: pos, size: 7, color: [col[0], col[1], col[2], alpha], light: m4dir(M.view, v3norm([-pos[0], -pos[1], -pos[2]])), kind: 1 }); var sc = toScreen(M.vp, pos); planetPos[i] = { sx: sc[0], sy: sc[1], px: 7, pos: pos, depth: sc[2] }; });
      /* 玩家拨的那颗探针：自己的初始圆（青色虚线）+ 拖尾 + 更大的点，和集合里的质点区分开 */
      var pr = demo.probe;
      if (pr) {
        dashRing(demo.r0Sel, [0.35, 0.95, 1, 0.5]);
        if (pr.trail && pr.trail.length >= 6) R.drawLines(new Float32Array(pr.trail), M.vp, [0.35, 0.95, 1, 0.6], false);
        var pp = [pr.pos[0], pr.pos.length > 2 ? pr.pos[2] : 0, -pr.pos[1]];
        var pc2 = pr.status === '坠入' ? [1, 0.35, 0.25] : pr.status === '逃逸' ? [0.75, 0.75, 0.8] : [0.35, 0.95, 1];
        sprites.push({ p: pp, size: 11, color: [pc2[0], pc2[1], pc2[2], 1], kind: 1, light: m4dir(M.view, v3norm([-pp[0], -pp[1], -pp[2]])) });
        demo.probeScreen = toScreen(M.vp, pp);
      }
      R.drawSprites(sprites, M.vp, W, H);
      if (pr && demo.probeScreen && demo.probeScreen[2] <= 1) {
        R.drawText(TR('探针 r₀=') + fmt(demo.r0Sel, 2) + TR('：') + probeStat(pr), demo.probeScreen[0] + 14, demo.probeScreen[1] - 8, 13, '#8fe8ff', 0.98, W, H, dpr);
      }
      drawR0Slider();
      /* 状态文案按**这条演示真实积分出来的结果**说话：
           逃逸 / 坠入核 —— 给出发生在第几圈；
           还在飞的那些不写裸「束缚」（那和 Ehrenfest 那句冲突），而是按它在核内还是核外分开说：
             核外（r>1）：F/F₁ = r^{−(D−1)} 已经趋近 0，它基本是自由直线漂移，不是被束缚住；
             核内（r≤1）：还没失稳，但那是「尚未」，不是「稳定」。 */
      /* 探针的状态：specs/highdim-v1.md 二节点名的四档。
         「核外几乎不受力」这句只在 F/F₁ 真的小的时候才说 —— D=2.5 时 r=2 处 F/F₁=0.354，
         那是**像样的引力**（审计说 2.5 档「几乎不受力」是软化吃掉的，软化已按 D 单边调掉）。 */
      function probeStat(p) {
        var lap = fmt(Math.abs(p.periods), 1), fr = DIMG.forceRatio(p.r, demo.D);
        if (p.status === '逃逸') return TR('逃逸（第 ') + lap + TR(' 圈）');
        if (p.status === '坠入') return TR('坠核（第 ') + lap + TR(' 圈）');
        var frTxt = fr < 1e-3 ? fr.toExponential(1) : fmt(fr, 3);
        if (p.r > DIMG.CORE_R) {
          return (fr < 0.05 ? TR('核外近乎自由（F/F₁≈') : TR('核外·仍有引力（F/F₁≈')) + frTxt + TR('）· 已 ') + lap + TR(' 圈')
            + (p.precN ? TR(' · 进动 ') + fmt(p.precAcc / p.precN, 1) + TR('°/圈') : '');
        }
        return TR('核内尚未失稳 · 已 ') + lap + TR(' 圈') + (p.precN ? TR(' · 进动 ') + fmt(p.precAcc / p.precN, 1) + TR('°/圈') : '');
      }
      function demoStat(p) {
        var lap = fmt(Math.abs(p.periods), 1);
        if (p.status === '逃逸') return TR('逃逸（第 ') + lap + TR(' 圈）');
        if (p.status === '坠入') return TR('坠入核（第 ') + lap + TR(' 圈）');
        /* 「几乎无引力」只在 F/F₁ 真的小的时候才说：D=2.5、r=2 处 F/F₁=0.354 是像样的引力，
           那一档写成「几乎不受力」是错的（审计报告那条，软化已按 D 单边调掉，见 DIMG.softCells）。 */
        var fr = DIMG.forceRatio(p.r, demo.D), frTxt = fr < 1e-3 ? fr.toExponential(0) : fmt(fr, 3);
        if (p.r > DIMG.CORE_R) {
          return (fr < 0.05 ? TR('核外几乎无引力（F/F₁≈') + frTxt + TR('）· 近乎自由漂移 · 已 ')
                            : TR('核外·仍有引力（F/F₁≈') + frTxt + TR('）· 已 ')) + lap + TR(' 圈');
        }
        return TR('尚未失稳 · 已 ') + lap + TR(' 圈');
      }
      demo.planets.forEach(function (p, i) { var q = planetPos[i]; if (!q || q.depth > 1) return; R.drawText(TRN(p.name) + TR('：') + demoStat(p) + (p.precN ? TR(' · 进动 ') + fmt(p.precAcc / p.precN, 1) + TR('°/圈') : '') + (extraAxes ? TR(' · 投影外 ') + fmt((p.outFrac || 0) * 100, 0) + '%' : ''), q.sx + 12, q.sy - 6, 12, p.status === '束缚' ? '#d8e8ff' : p.status === '坠入' ? '#ff9a80' : '#bbbbbb', 0.9, W, H, dpr); });
      var Dtxt = Number.isInteger(demo.D) ? demo.D + TR(' 维') : fmt(demo.D, 2) + TR(' 维（分数维，推测：分形/谱维数模块）');
      /* 「束缚 N/4」这个说法要改掉：还在飞 ≠ 被束缚（D≥4 按 Ehrenfest 根本没有稳定圆轨道），
         尤其核外那些其实是几乎不受力的自由漂移。改成按真实积分结果分三档报数。 */
      var nEsc = 0, nFall = 0, nDrift = 0, nHeld = 0, nInner = 0;
      demo.planets.forEach(function (p) {
        if (p.status === '逃逸') { nEsc++; return; }
        if (p.status === '坠入') { nFall++; return; }
        if (p.r <= DIMG.CORE_R) { nInner++; return; }
        if (DIMG.forceRatio(p.r, demo.D) < 0.05) nDrift++; else nHeld++;   // 核外还分「几乎自由」与「仍被拉着」
      });
      S.caption = TRN(sys.name) + ' · ' + Dtxt + TR('两体问题的 3 维投影 · 引力 r^{−(D−1)} · ') + (demo.D >= 4 ? TR('Ehrenfest 1917：D≥4 无稳定圆轨道') : demo.D > 3 ? TR('3<D<4：束缚但进动') : demo.D < 3 ? TR('2<D<3：束缚但进动（力更长程）') : TR('D=3 对照：闭合椭圆，稳定')) + TR(' · 扰动 ') + (demo.eps * 100).toFixed(2) + TR('%')
        + TR(' · 逃逸 ') + nEsc + TR(' / 坠入核 ') + nFall + (nDrift ? TR(' / 核外自由漂移 ') + nDrift : '') + (nHeld ? TR(' / 核外仍被引力拉着 ') + nHeld : '') + TR(' / 核内尚未失稳 ') + nInner + '（' + demo.planets.length + '）'
        + ' · t = ' + fmt(demo.t / TAU, 1) + ' T₀'
        + TR(' · 虚线细圈＝各质点的初始圆（不稳定，不是轨道）；橙色虚线圈＝引力核边界 r=1：圈外 F/F₁=r^{−(D−1)} 迅速趋近 0（几乎不受力），圈内发散')
        + TR(' · 可视化只是示意，物理量仍按 3 维公式外推');
      var dimLine = extraAxes ? ('D=' + demo.D + TR('：第 4') + (demo.D > 4 ? '..' + demo.D : '') + TR(' 维方向未绘制，这里画的是八维轨迹在三维里的投影（影子）。')
        + (pureProj
          ? TR('当前为**纯投影**：质点不因"跑到看不见的方向"而变淡——真实的投影本来就不会（就像影子不会因为物体离墙远而变暗）。代价是它可能忽然折返或彼此穿过，因为那一步发生在没画出来的方向上。按 P 切回可读性提示。')
          : TR('当前叠加了**可读性提示**（非投影本身的性质）：质点按投影外分量比例变淡、拖尾改虚线，好让你看出它正沿没画出来的方向走远。按 P 关掉，看纯投影。'))
        + TR('束缚/坠入/逃逸一律按 D 维真实距离判定：「逃逸」= 径向距离跑向无穷远，质点始终待在这个 D 维空间里、始终有完整的 D 个坐标，不存在"换到别的维度去"这回事；')
        + TR('而质点在影子里变淡只是沿着没画出来的方向走了，它可能**仍然被束缚**——这两件事别混。')
        + (demo.D === 4
          ? TR('D=4 是临界情形：扰动严格为 0 时圆轨道能一直转下去，但扰动会指数放大（实测扰动缩小 10 倍，寿命只延长约 3 倍），按 − 把扰动调小可以亲眼看到这条刀锋。')
          : TR('D≥5 连零扰动都留不住：圆轨道对应有效势的极大值，浮点舍入误差就足以推翻它（实测 D=5 约 3 圈、D=6 约 2 圈即失稳）。'))) : (Number.isInteger(demo.D) ? '' : TR('分数维 D=') + fmt(demo.D, 2) + TR('：无额外坐标轴，维数只通过引力律指数 r^{−(D−1)} 起作用（推测）'));
      /* 滑杆那一行说清楚它是干什么的：不是调参数玩，是拿它去撞 r=1 那道悬崖。 */
      var pr2 = demo.probe;
      var cliff = TR('拖左下角滑杆（或 Z/X）改试探质点的初始半径 r₀：') +
        TR('把它从核内拨到核外，看 F/F₁ = r^{−(D−1)} 在 r=1 两侧的落差') +
        (demo.D >= 4 ? TR('——核外几乎无引力、核内一头栽进去，中间没有稳定带')
          : demo.D > 2 ? TR('——2<D<4 两侧都还有像样的引力，看到的是稳定但不闭合的进动轨道') : '') +
        (pr2 ? TR(' · 现在 r₀=') + fmt(demo.r0Sel, 2) + TR('，F/F₁=') + (DIMG.forceRatio(demo.r0Sel, demo.D) < 1e-3 ? DIMG.forceRatio(demo.r0Sel, demo.D).toExponential(1) : fmt(DIMG.forceRatio(demo.r0Sel, demo.D), 3)) + TR(' · ') + probeStat(pr2) : '');
      var hudL = [S.caption]; if (dimLine) hudL.push(dimLine); hudL.push(cliff); hudL.push(TR('当前注入扰动 ε=') + (demo.eps > 0 ? (demo.eps * 100).toPrecision(2) + '%' : TR('0（严格圆轨道，没有推它）')) + TR('——你看到的逃逸是这个扰动被放大的结果，按 − 一路调到 0 自己验：D=4 会一直转，D≥5 照样失稳。')
        + TR(' 拖动旋转投影 · 滚轮缩放 · + / − 扰动 ×2/÷2 · R 重置 · 3 切换 D=3 对照') + (extraAxes ? ' · P ' + (pureProj ? TR('恢复可读性提示') : TR('看纯投影')) : '') + TR(' · 空格 暂停 · , / . 调速（') + fmt(speedMul, 2) + '×）'); drawHud(hudL);
    }
    /* 换扰动 / 重置 / 切 D=3 对照都会重建 demo，但玩家拨的 r₀ 要留住（不然每按一次就跳回 1）。 */
    function rebuildDemo(D, eps, seed) { var keep = demo ? demo.r0Sel : 1; demo = initOrbitDemo(D, eps, seed); setProbeR0(keep, true); return demo; }
    function demoKey(code) { if (!demo) return false; if (code === 'Equal' || code === 'NumpadAdd') { rebuildDemo(demo.D, Math.min(0.5, demo.eps > 0 ? demo.eps * 2 : 1e-4), demo.seed); }   /* 从 0 往回加要有个起点，否则 0×2 还是 0 */ /* 扰动可以一路调到严格的 0：默认 1% 是我们注入的，看到的逃逸是被推了一把，不是它自己跑的。
   不给用户关掉的手段，这个演示就成了"我说不稳定所以它不稳定"。ε=0 时 D=4 的圆轨道能一直转，
   而 D≥5 照样失稳——后者才是维数本身给出的结论，前者只说明扰动被放大了。 */
else if (code === 'Minus' || code === 'NumpadSubtract') { rebuildDemo(demo.D, demo.eps <= 1e-4 ? 0 : demo.eps / 2, demo.seed); } else if (code === 'KeyR') { rebuildDemo(demo.D, demo.eps, demo.seed); } else if (code === 'Digit3') { rebuildDemo(demo.D === 3 ? S.system.dim : 3, demo.eps, demo.seed); } else if (code === 'KeyP') { demo.pureProjection = !demo.pureProjection; } else if (code === 'KeyZ' || code === 'KeyX') { setProbeR0(demo.r0Sel + (code === 'KeyX' ? 0.1 : -0.1), true); }   /* Z/X：把试探质点的 r₀ 往核内/核外拨一格，等同拖滑杆 */ else if (code === 'Space') { demo.paused = !demo.paused; } else return false; return true; }   // P：纯投影 / 叠加可读性提示


    /* ============================================================ 多星：恒星互绕的真实 N 体（RK4）；经典三体演示 */
    var sysNB = null, tb = null;
    function initSysNB(system) { sysNB = null; if (!system.stars || system.stars.length < 2 || !system.hierarchy) return; var st = hierarchyIC({ stars: system.stars, root: system.hierarchy.root }); sysNB = { st: st, root: system.hierarchy.root, minP: minPeriod(system.hierarchy.root), trails: system.stars.map(function () { return []; }) }; }
    function stepSysNB(dtYr) { if (!sysNB) return; var h = Math.min(sysNB.minP / 240, dtYr), n = Math.min(3000, Math.max(1, Math.ceil(dtYr / h))); h = dtYr / n; for (var k = 0; k < n; k++) nbodyRK4(sysNB.st, h, 4 * PI * PI); sysNB.st.pos.forEach(function (p, i) { var tr = sysNB.trails[i]; tr.push(p[0], p[1]); if (tr.length > 2 * 400) tr.splice(0, 2); }); }
    function hostXY(p) { if (!sysNB || p.hostId == null) return [0, 0]; var node = findNode(sysNB.root, p.hostId); return node ? nodePosition(node, sysNB.st) : [0, 0]; }
    function mapXY(x, y) { var r = Math.hypot(x, y), rm = mapR(r); return r > 1e-9 ? [rm * x / r, 0, -rm * y / r] : [0, 0, 0]; }
    /* 恒星系整体的公转方向：同一个系统内所有行星（和卫星）同向——它们继承同一个原行星盘的
       角动量，太阳系八大行星就都是同向的。但**不同系统之间**方向是随机的：分子云角动量方向
       无宇宙学优选，故各盘的自旋轴随机；类比上，Galaxy Zoo（Land et al. 2008）在扣除人眼
       分类偏差后也未发现旋涡星系缠绕方向的显著净偏向（parity violation）。这不是说行星轨道
       应由星系手性决定，只说明"宇宙没有强制单一手性"。以前这里角度恒为正，于是每一个
       恒星系看上去都朝同一边转。太阳系强制取 +1 保持其真实观测方向（仅太阳系，不推广）。 */
    function spinOf(p) {
      var s = p && p.system;
      var sd = (s && s.seed) != null ? s.seed : ((p && p.seed) || 1);
      // 太阳系（isSolar / SOLAR_SEED）强制正向：它的方向是真实观测，不能被随机手性翻过去
      if ((s && (s.isSolar || s.ours)) || (sd >>> 0) === SOLAR_SEED) return 1;
      return ((hash32((sd >>> 0) ^ 0x5C1D9E37) >>> 0) & 1) ? 1 : -1;
    }
    function keplerXY(p, tYr) { var M = TAU * ((isFinite(tYr) ? tYr : 0) / safePeriod(p)) + (p.phase || 0), e = p.ecc || 0, E = M; if (!isFinite(M)) M = E = p.phase || 0; for (var i = 0; i < 6; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); var nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), r = p.orbitAU * (1 - e * Math.cos(E)), ang = nu + (p.phase || 0) * 0.37; return [r * Math.cos(ang), spinOf(p) * r * Math.sin(ang)]; }
    function planetAbs(p, tYr) { var h = hostXY(p), k = keplerXY(p, tYr); return { xy: [h[0] + k[0], h[1] + k[1]], host: h, rel: k }; }
    function planetPathAbs(p) { var h = hostXY(p), e = p.ecc || 0, sp = spinOf(p), pts = new Float32Array(129 * 3); for (var i = 0; i <= 128; i++) { var nu = i / 128 * TAU, r = p.orbitAU * (1 - e * e) / (1 + e * Math.cos(nu)), ang = nu + (p.phase || 0) * 0.37, v = mapXY(h[0] + r * Math.cos(ang), h[1] + sp * r * Math.sin(ang)); pts[i * 3] = v[0]; pts[i * 3 + 1] = 0; pts[i * 3 + 2] = v[2]; } return pts; }
    function hierText(sys) { var hz = sys.hierarchy; if (!hz || hz.N < 2) return ''; var r = hz.root, parts = []; (function walk(n, depth) { if (n.kind === 'bin') { parts.push((depth ? TR('外层') : '') + TR('双星 P=') + (n.P >= 1 ? fmt(n.P, 1) + TR(' 年') : fmt(n.P * 365.25, 1) + TR(' 天')) + ' a=' + fmt(n.a, 2) + ' AU e=' + fmt(n.e, 2) + (n.stable ? TR('（MA01 ✓ 外/内周期比 ') + fmt(n.ratioP, 0) + TR('，近心比 ') + fmt(n.a * (1 - n.e) / (n.members[0].kind === 'bin' ? n.members[0].a : n.members[1].a), 1) + TR(' > 判据 ') + fmt(n.crit, 1) + TR('）') : '')); n.members.forEach(function (m) { walk(m, depth + 1); }); } })(r, 0); return TR(hz.note) + TR('：') + parts.join(TR('；')); }
    // 经典三体：三颗等质量、非分层随机初值；能量守恒误差；散架/弹出检测（混沌，对初值敏感）
    function initThreeBody(seed) { var rnd = mulberry32((seed || 1) ^ 0x3B0D), pos = [], vel = [], i; for (i = 0; i < 3; i++) { var ang = i * TAU / 3 + (rnd() - 0.5) * 0.8, r = 0.8 + rnd() * 0.5; pos.push([r * Math.cos(ang), r * Math.sin(ang), (rnd() - 0.5) * 0.15]); vel.push([(rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.15]); } var cv = [0, 0, 0], cp = [0, 0, 0]; for (i = 0; i < 3; i++) for (var k = 0; k < 3; k++) { cv[k] += vel[i][k] / 3; cp[k] += pos[i][k] / 3; } for (i = 0; i < 3; i++) for (k = 0; k < 3; k++) { vel[i][k] -= cv[k]; pos[i][k] -= cp[k]; } var st = { pos: pos, vel: vel, mass: [1, 1, 1], t: 0 }; var E0 = nbodyEnergy(st, 1); if (E0 >= 0) { for (i = 0; i < 3; i++) for (k = 0; k < 3; k++) vel[i][k] *= 0.4; E0 = nbodyEnergy(st, 1); } return { st: st, E0: E0, seed: seed || 1, trails: [[], [], []], events: [], ejected: null, Tchar: TAU * Math.pow(1.0, 1.5) / Math.sqrt(3), paused: false, minSep: 9 }; }
    /* 每帧的子步数必须有上限。步长 h = min(0.004, 0.02·rmin^1.5, …)，rmin 只兜到 1e-3 ⇒ h 最小 6.3e-7；
     * 而 tSim = dt·speedMul·0.6 最大 0.1×64×0.6 = 3.84（dt 兜 0.1、speedMul 兜 64）——三体近距遭遇时
     * 一帧要跑 600 万步 RK4，页面就停在这里不动了（而近距遭遇正是这个混沌演示必然会发生的事）。
     * 这里**不改步长、不改积分器**：h 的序列与轨道逐位不变，只是预算用完就本帧到此为止，
     * 下一帧接着从同一个状态往下积——表现为遭遇期间演示的「现实时间流速」自动变慢，而不是卡死。
     * 同一档上限 stepSysNB() 早就有了（n 兜 3000），这里是漏了。 */
    var TB_MAX_SUB = 20000, tbBuf = [null, null, null];
    function stepThreeBody(dt) { var st = tb.st, tSim = dt * speedMul * 0.6, acc = 0, sub = 0; while (acc < tSim && sub < TB_MAX_SUB) { var rmin = 9; for (var i = 0; i < 3; i++) for (var j = i + 1; j < 3; j++) rmin = Math.min(rmin, Math.hypot(st.pos[i][0] - st.pos[j][0], st.pos[i][1] - st.pos[j][1], st.pos[i][2] - st.pos[j][2])); tb.minSep = Math.min(tb.minSep, rmin); var h = Math.min(0.004, 0.02 * Math.pow(Math.max(rmin, 1e-3), 1.5), tSim - acc); nbodyRK4(st, h, 1); acc += h; sub++; }
      tb.throttled = (sub >= TB_MAX_SUB && acc < tSim);   // 预算用完：HUD 要说实话，别让人以为流速没变
      for (var q = 0; q < 3; q++) { tb.trails[q].push(st.pos[q][0], st.pos[q][2], -st.pos[q][1]); if (tb.trails[q].length > 3 * 1200) tb.trails[q].splice(0, 3); }
      if (!tb.ejected) { for (var e = 0; e < 3; e++) { var o1 = (e + 1) % 3, o2 = (e + 2) % 3, cx = (st.pos[o1][0] + st.pos[o2][0]) / 2, cy = (st.pos[o1][1] + st.pos[o2][1]) / 2, cz = (st.pos[o1][2] + st.pos[o2][2]) / 2, dx = st.pos[e][0] - cx, dy = st.pos[e][1] - cy, dz = st.pos[e][2] - cz, r = Math.hypot(dx, dy, dz), vr = (st.vel[e][0] * dx + st.vel[e][1] * dy + st.vel[e][2] * dz) / Math.max(r, 1e-6), v2 = st.vel[e][0] * st.vel[e][0] + st.vel[e][1] * st.vel[e][1] + st.vel[e][2] * st.vel[e][2], Erel = 0.5 * v2 - 2 / r; if (r > 8 && vr > 0 && Erel > 0) { tb.ejected = { body: e, atCycle: st.t / tb.Tchar }; tb.events.push(TR('第 ') + fmt(st.t / tb.Tchar, 1) + TR(' 圈：第 ') + (e + 1) + TR(' 颗被弹出，双星 + 单星散架')); } } } }
    function drawThreeBody(dt) { sysTarget = [0, 0, 0]; if (!tb.paused && opts.animate !== false) stepThreeBody(dt); var M = sysMatrices(); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); drawSky(M, { space: true, sun: [0, 1, 0], starColor: [0, 0, 0] });
      // 尾迹缓冲复用：原来每帧 new 三个 Float32Array（3×1200×3 浮点 ≈ 43 KB/条），60 fps 下每秒制造 ~8 MB 垃圾
      var cols = [[1, 0.85, 0.6], [0.7, 0.85, 1], [1, 0.7, 0.75]], sprites = []; for (var i = 0; i < 3; i++) { var tr = tb.trails[i]; if (tr.length >= 6) { var buf = tbBuf[i]; if (!buf || buf.length < tr.length) buf = tbBuf[i] = new Float32Array(3 * 1200); for (var c = 0; c < tr.length; c++) buf[c] = tr[c]; R.drawLines(buf.subarray(0, tr.length), M.vp, [cols[i][0], cols[i][1], cols[i][2], 0.5], false); } var p = tb.st.pos[i]; sprites.push({ p: [p[0], p[2], -p[1]], size: 30, color: [cols[i][0], cols[i][1], cols[i][2], 1], kind: 0 }); }
      R.drawSprites(sprites, M.vp, W, H); var E = nbodyEnergy(tb.st, 1), err = Math.abs((E - tb.E0) / tb.E0);
      S.caption = TR('经典三体演示 · 三颗等质量、非分层随机初值（seed ') + tb.seed + TR('）· 混沌，对初值敏感 · t = ') + fmt(tb.st.t / tb.Tchar, 1) + TR(' 圈 · 能量守恒误差 |ΔE/E₀| = ') + err.toExponential(2) + (tb.ejected ? ' · ' + tb.events[tb.events.length - 1] : TR(' · 仍在纠缠（最近距离 ') + fmt(tb.minSep, 3) + TR('）'))
        + (tb.throttled ? TR(' · 近距遭遇：步长被压到极小，本帧算到子步上限就停（轨道照常，只是现实时间里放慢了）') : '');
      drawHud([S.caption, TR('拖动旋转 · 滚轮缩放 · R 同初值重放 · N 新随机初值 · 空格 暂停 · , / . 调速 · Esc/T 返回恒星系')]); }
    function showThreeBody(o) { o = o || {}; tb = initThreeBody(o.seed != null ? o.seed : (S.system ? S.system.seed : 1)); S.tbPrev = { system: S.system, mode: S.mode }; sysCam.fit = 5.5 / Math.min(1, W / H / 1.25); sysCam.dist = sysCam.fit; sysCam.tilt = 0.75; setMode('system'); return view; }
    function exitThreeBody() { if (!tb) return; tb = null; if (S.tbPrev && S.tbPrev.system) showSystem(S.tbPrev.system, { keepCamera: false }); S.tbPrev = null; }
    function tbKey(code) { if (!tb) return false; if (code === 'KeyR') tb = initThreeBody(tb.seed); else if (code === 'KeyN') tb = initThreeBody(hash32(tb.seed + 1)); else if (code === 'Space') tb.paused = !tb.paused; else if (code === 'KeyT' || code === 'Escape') exitThreeBody(); else return false; return true; }

    /* ------------------------------ 渲染 */
    function frame(now) { if (disposed) return; raf = requestAnimationFrame(frame); frameOnce(now); }
    function nowMs() { return (typeof performance === 'object' && performance.now) ? performance.now() : Date.now(); }
    // 同步补画一帧（进入 orbitDemo、resize 后等）：重入保护，别在一帧里再套一帧
    function paintNow() { if (inFrame || disposed) return; try { frameOnce(nowMs()); } catch (e) { console.error('[MirrorPlanets] 补帧失败：', e); } }
    function frameOnce(now) {
      if (disposed || inFrame) return;
      inFrame = true; lastFrameAt = now;
      try { frameBody(now); } catch (err) { console.error('[MirrorPlanets] 帧更新错误：', err); }   // 更新阶段抛错也不能让绘制永远停摆
      inFrame = false;
    }
    function frameBody(now) {
      var dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.016; lastT = now; elapsed += dt;
      // 着色器收货：每帧最多收 2 个**已经编好的**程序，藏起来的时候也照收（预热就靠这个）
      if (R && R.progsPending && R.progsPending()) { R.pump(2); if (!R.progsPending()) pvCreateMs.finishShaders = pvMark(); }
      lastDt = dt;
      /* 贴图分片：每帧最多 6 ms。着色器还没收完货时先让给着色器（那个更要紧，不然会当场同步链接）。 */
      if (R && R.pumpMaps && !(R.progsPending && R.progsPending())) perfWrap('pumpMaps', '', function () { R.pumpMaps(6); });
      /* 画布被宿主藏起来时（镜像退到星系层就会这样）不画：视图现在会跨层保活（见 mirror.js 的 syncPV），
         不加这道闸就会对着看不见的画布一直渲染。rAF 照常转，一露头就接着画。 */
      if (canvas.hidden || (canvas.offsetParent === null && canvas.style.position !== 'fixed')) return;
      var cw = canvas.clientWidth, ch = canvas.clientHeight; if (cw && ch && (Math.round(cw * dpr) !== W || Math.round(ch * dpr) !== H)) resize();
      // 自适应画质：帧时间持续偏高则降低渲染分辨率（最低 0.5），恢复后逐步升回
      if (opts.adaptive !== false && S.mode !== 'idle') { dtEma += (dt - dtEma) * 0.08; qTimer += dt; if (qTimer > 2.5) { qTimer = 0; if (dtEma > 1 / 38 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); resize(); } else if (dtEma < 1 / 58 && quality < 1) { quality = Math.min(1, quality + 0.1); resize(); } } }
      if (S.mode === 'system' && S.system && opts.animate !== false) { animYr += dt * orbitSpeed; if (S.system.dim === 2 && S.system.v0) step2DSystem(dt * orbitSpeed); if (sysNB && !tb) stepSysNB(dt * orbitSpeed); }
      if (S.mode === 'surface' && sysDim() === 2) move2D(dt);
      if (S.mode !== 'system') globeCam.spin += dt * (opts.animate === false ? 0 : (S.mode === 'surface' ? 0.004 : 0.03));
      if (S.mode === 'surface' && S.vp && sysDim() === 3) { moveSurface(dt); if (surf.cruise) cruise(dt); }
      if (S.planet && S.mode !== 'idle') S.vp = visualParams(S.planet, S.timeYr); // 材质随时间变化，每帧刷新很便宜
      if (fallback) { fallback.setState(S, { sysCam: sysCam, globeCam: globeCam, surf: surf, elapsed: elapsed, animYr: animYr, W: W, H: H, dpr: dpr }); fallback.draw(); S.caption = fallback.caption || ''; return; }
      if (!R || R.lost) return;
      var dimNow = sysDim();
      try { if (tb && S.mode === 'system') drawThreeBody(dt); else if (S.mode === 'system' && dimNow === 2) draw2DSystem(); else if (S.mode === 'system' && dimNow !== 3) drawOrbitDemo(dt); else if (S.mode === 'globe' && dimNow === 2) draw2DGlobe(); else if (S.mode === 'surface' && dimNow === 2) draw2DSurface();
        else if (S.mode === 'star') drawStarView();
        else if (S.mode === 'system') drawSystem(); else if (S.mode === 'globe') drawGlobe(); else if (S.mode === 'surface') drawSurface(); else { gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } }
      catch (err) { console.error('[MirrorPlanets] 渲染错误：', err); }
    }
    function drawSky(mats, o) {
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
      R.use('sky', { uInvVP: m4invert(mats.vp), uCamL: mats.eye, uSunL: o.sun, uAtm: o.atm || [0.5, 0.7, 1], uFogColor: o.fogColor || [0.7, 0.7, 0.6], uStarColor: o.starColor || [1, 0.96, 0.9], uAtmDensity: o.atmDensity || 0, uAltitude: o.altitude || 0, uFog: o.fog || 0, uSpace: o.space ? 1 : 0, uTime: elapsed, uUnder: o.under ? 1 : 0, uWaterFog: o.waterFog || [0.05, 0.12, 0.2], uHorizonDip: o.horizonDip || 0, uLimb: o.limb || 0, uMoonDir: o.moonDir || [0, 0, 1], uMoonLit: o.moonLit || 0, uMoonR: o.moonR || 0.99999,
        // 恒星的视半径按距离缩小（默认 0 = 沿用 1 AU 处的 ≈0.3°）；黑洞近观时给出阴影角半径，天空着色器据此做透镜示意
        uSunAng: o.sunAng || 0, uStarDim: o.starDim || 0, uBHDir: o.bhDir || [0, 0, 1], uBHShadow: o.bhShadow || 0 });
      gl.bindVertexArray(R.quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null); gl.depthMask(true);
    }
    function starRGB(star) { return rgb((star && star.color) || '#fff4e8'); }
    /* 宿主的辐照（相对地球）与由它推出的照度系数。遗骸宿主（白矮星/中子星/黑洞）光度可以正好是 0，
       这时不能让画面变成一整片黑：给 0.12 的下限当作"星光 + 遗骸微光"，地形轮廓与地平线必须留得住，
       同时 HUD 说明这是示意亮度。正常行星（S ≥ 0.04 S⊕，火星是 0.43）系数恒为 1，观感不变。 */
    function hostFluxRel(p) {
      var st = (p && p.star) || (S.system && S.system.star) || null;
      var L = st && isFinite(st.lumRel) && st.lumRel > 0 ? st.lumRel : 0;
      var a = p && isFinite(p.orbitAU) && p.orbitAU > 0 ? p.orbitAU : 1;
      return L / (a * a);
    }
    function starLumFactor(p) { var f = hostFluxRel(p); return f >= 0.04 ? 1 : clamp(Math.pow(Math.max(f, 0) / 0.04, 0.22), 0.12, 1); }
    function darkHost(p) { return hostFluxRel(p) < 2e-3; }
    function darkHostNote(p) {
      var st = (p && p.star) || (S.system && S.system.star) || null, nm = TR((st && st.stageName) || '遗骸');
      return TR('宿主是') + nm + TR('（光度 ') + ((st && st.lumRel > 0) ? st.lumRel.toExponential(1) : '0') + TR(' L☉）：这里几乎没有星光，画面亮度为示意，只为看清地形轮廓与地平线。');
    }
    // HUD：先描一层近黑的影子再写正文，雪原/沙漠这类亮底上也读得出来
    function drawHud(lines) {
      if (!hud) return; var y = H / dpr - 14 - (lines.length - 1) * 18;
      lines.forEach(function (l, i) { var sz = i === 0 ? 13 : 12; for (var k = 0; k < 4; k++) R.drawText(l, 14 + (k < 2 ? (k ? 1.2 : -1.2) : 0), y + i * 18 + (k < 2 ? 0 : (k === 2 ? -1.2 : 1.2)), sz, '#04060a', 0.85, W, H, dpr); R.drawText(l, 14, y + i * 18, sz, i === 0 ? '#f2f2f2' : '#c8c8c8', 0.97, W, H, dpr); });
    }

    function drawSystem() {
      var sys = S.system;
      /* 先把取景中心挪到行星的宿主星上，再算矩阵。宽双星里主星离质心可以有几十 AU，
         而相机是按行星轨道（零点几 AU）取景的——不跟着宿主走，恒星和行星就全在画面外，
         屏幕上只剩一个以质心为圆心的柯伊伯带圈。单星系统 hostXY 恒为 [0,0]，行为不变。 */
      (function () {
        var host = (sys.planets || []).find ? (sys.planets || []).find(function (q) { return q && q.hostId != null; }) : null;
        if (!host) { sysTarget = [0, 0, 0]; return; }
        var h = hostXY(host); sysTarget = mapXY(h[0], h[1]);
      })();
      var M = sysMatrices(), age = sysAgeGyr(), star = sys.star; gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawSky(M, { space: true, sun: [0, 1, 0], starColor: [0, 0, 0] });
      var starCol = starRGB(star), formedFrac = smoothstep(-0.02, 0.05, age);
      // 尘埃环（行星诞生前）：雾蒙蒙的大环
      var ringEnd = sys.ringEndGyr || 0.2, dust = age < 0 ? 0 : (1 - smoothstep(ringEnd * 0.45, ringEnd, age));
      if (dust > 0.001) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
        var maxAU = 1; sys.planets.forEach(function (p) { maxAU = Math.max(maxAU, p.orbitAU); });
        R.use('ring', { uVP: M.vp, uModel: m4id(), uInner: mapR(0.06), uOuter: mapR(maxAU * 1.15), uMode: 1, uColor: mix3([0.55, 0.5, 0.45], starCol, 0.4), uAlpha: 0.55 * dust, uTime: elapsed, uSunO: [0, 1, 0], uCassini: 0, uPerm: 0 }, [R.permDefault]);
        gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null); }
      // 宜居带与轨道
      var hz0 = 0.95 * Math.sqrt(star.lumRel || 1), hz1 = 1.67 * Math.sqrt(star.lumRel || 1);
      [hz0, hz1].forEach(function (au) { var pts = new Float32Array(97 * 3); for (var i = 0; i <= 96; i++) { var a = i / 96 * TAU, rm = mapR(au); pts[i * 3] = rm * Math.cos(a); pts[i * 3 + 2] = -rm * Math.sin(a); } R.drawLines(pts, M.vp, [0.3, 0.7, 0.4, 0.14 * formedFrac], true); });
      var sprites = [], starLabels = [], bhNote = null;   // bhNote：这个系统里画了吸积盘示意时，记下视界半径（km），HUD 里如实交代
      // 小行星带 / 柯伊伯带：稀疏的点带（数量为示意，位置按 seed 确定性抽样）
      var beltLabels = [];
      if (sys.belts && sys.belts.length && formedFrac > 0.02) {
        sys.belts.forEach(function (b, bi) {
          var rnd = mulberry32(hash32((sys.seed >>> 0) ^ (bi + 7) * 0x9E3779B9)), N = b.kind === 'kuiper' ? 320 : 260, pts = [];
          for (var k = 0; k < N; k++) {
            var au = b.innerAU + (b.outerAU - b.innerAU) * Math.pow(rnd(), 0.8), ang = rnd() * TAU + animYr * 0.6 / Math.max(Math.pow(au, 1.5), 0.05), rm = mapR(au);
            pts.push({ p: [rm * Math.cos(ang), (rnd() - 0.5) * mapR(au) * 0.02, -rm * Math.sin(ang)], au: au });
          }
          var bc = b.kind === 'kuiper' ? [0.62, 0.72, 0.82] : [0.72, 0.66, 0.56];
          pts.forEach(function (q) { sprites.push({ p: q.p, size: clamp(1.7 * Math.pow(sysCam.fit / sysCam.dist, 0.5), 1, 4), color: [bc[0], bc[1], bc[2], 0.55 * formedFrac], kind: 1, light: [0, 1, 0] }); });
          var lm = mapR((b.innerAU + b.outerAU) * 0.5);
          beltLabels.push({ v: [lm * 0.72, 0, -lm * 0.72], text: TR(b.cn) + ' ' + fmt(b.innerAU, 1) + '–' + fmt(b.outerAU, 1) + ' AU', col: b.kind === 'kuiper' ? '#9fc0dd' : '#c8b79a' });
        });
      }
      /* 恒星本体：按演化阶段给不同的外观，而不是一律画成主序小圆点。
         红巨星/AGB 大而红（半径几十到上百 R☉）、白矮星极小极白、中子星更小更蓝、黑洞没有光球（只画吸积盘示意）。 */
      function starSprite(st, v) {
        var c = rgb(st.color || '#fff4e8'), base = clamp(H / dpr * 0.11 * sysCam.fit / sysCam.dist, 26, 520);
        var stage = st.stage || 'ms';
        var rs = clamp(Math.pow(Math.max(st.radiusRel || 1, 1e-5), 0.42), 0.12, 6);     // 半径 → 视觉尺寸（压缩，否则红巨星会占满屏）
        var size = base * rs * (age < 0 ? 0.5 : 1), alpha = age < 0 ? 0.5 : 1;
        if (stage === 'bh') {   // 黑洞：没有光球。画一圈发热的吸积盘 + 中心的暗斑（示意）
          /* 三件事按顺序修过：
             ① 位置——模型矩阵原来是 m4id()，等于永远画在系统原点。单星系统里恒星恰好在原点，
                看不出问题；双黑洞系统里两颗星各在自己的轨道位置上，盘却孤零零留在中间
                （用户报"好多恒星 + 1 个饼"）。改成平移到这颗星的位置 v。
             ② 尺寸——上一版写的是"按视界半径标度"：rsAU = radiusRel × 0.00465，内缘 3 r_s、外缘 12 r_s。
                这条线其实是死的。恒星质量黑洞的视界只有 20–100 km ≈ 3×10⁻⁵ R☉，而 star.radiusRel 在
                建 star 对象时被 toFixed(4) 量化过（见上面 `radiusRel: +ev.radiusRel.toFixed(4)`），
                量化后**恒等于 0**（最重的也只到 0.0001）。于是 Math.max(…, 0.012) / Math.max(…, 0.05)
                这两个 AU 地板每次都赢：盘永远是固定的 0.05 AU，既与黑洞质量无关，也与这个恒星系有多大无关。
                而取景距离 sysCam.fit 在不同恒星系之间差二十多倍（最外轨道 0.1 AU 到 5 AU 都有），
                同一个 0.05 AU 的盘于是从占画面几个百分点一路涨到糊满整个视口——就是用户报的"大饼"。
                按真比例画也不行：12 r_s ≈ 6×10⁻⁶ AU，在这个视图里连一个像素都不到。
                所以尺寸**明确按取景半径给**（示意，HUD 里写明），这样盘在任何恒星系里都只占画面的
                固定一小块；只让它随黑洞末质量弱变化，保证"更重的黑洞看起来更大"这个次序是真的。
                内缘/外缘之比取 3 r_s : 22 r_s——内缘 = 史瓦西黑洞的 ISCO（r_s=2GM/c² 时
                r_ISCO=6GM/c²=3 r_s），这个比例是真的，只有绝对尺度是示意；外缘 22 r_s 与近景观取同一个数，
                两个视图从此是同一套口径（以前全局视图取 12 r_s，纯粹是另一个凑出来的数）。
             ③ 画法——原来传 uMode 0，那是**行星光环**的着色器（径向条纹 + 卡西尼缝），画出来就是一圈圈
                同心圆环，跟吸积盘没有关系。改用 uMode 2（与近观黑洞同一套）：温度按 Shakura & Sunyaev 1973
                的薄盘标度 T ∝ R^{−3/4}，内缘蓝白、外缘橙红并渐隐，叠差动旋转（Ω ∝ R^{−3/2}）的湍流条纹，
                转向观察者的一侧因相对论性集束更亮。uDoppler 必须显式传：不传就会沿用上一次用这个程序
                （近景观）留下来的值。 */
          /* ④ 尺寸再改一次（2026-09-17，用户报"怎么又出现大饼了"）——上面 ② 那条"按取景半径给 6.5%"
                在大质量黑洞上翻了车：7350 M☉ 的黑洞把弱标度 kM 顶到上限 1.25，最外行星 5.78 AU 的
                恒星系取景半径 fit = mapR(5.78)·2.95 ≈ 7.7，于是盘的外缘 ≈ 0.63，而最内行星 0.72 AU
                映射后只有 mapR(0.72) ≈ 0.83 —— 盘几乎顶到最内轨道上，看着就是一张饼压在恒星系上，
                行星轨道从盘里穿过去。物理上视界 2.2 万公里对 0.72 AU（1.08 亿公里）是万分之二，
                盘再厚也不该碰到轨道。
                现在改成按**物理量级**给，并且封顶：
                  · 外缘取 100 r_s = 200 r_g —— 薄盘的典型外缘是几百个引力半径的量级；
                  · 再封一道顶：不许超过最内行星轨道（映射后）的 1/20；
                  · 两者取小。没有行星时退回取景半径的 1/60。
                内缘仍是 ISCO = 3 r_s，内外之比照旧是真的。
                盘小到投影不足几个像素时就不画三维盘了（画出来只是一团噪点），改由下面的
                「暗核 + 细亮环」两个 sprite 顶上 —— 那两个有像素地板，保证黑洞在画面上仍然找得到，
                但它们是**标记**不是尺度，HUD 里照旧写明。 */
          var mBH = st.massRemnant || (st.massRel || 20) * 0.35;                      // 末质量（M☉）：r_s = 2GM/c² ≈ 2.95 km/M☉
          var rsAU = 2.95 * Math.max(mBH, 0.1) / 1.495978707e8;                       // 史瓦西半径，换成 AU
          var aMinAU = 0;
          if (sys.planets && sys.planets.length) {
            for (var bi2 = 0; bi2 < sys.planets.length; bi2++) {
              var oa = sys.planets[bi2] && sys.planets[bi2].orbitAU;
              if (oa > 0 && (aMinAU === 0 || oa < aMinAU)) aMinAU = oa;
            }
          }
          var rCap = aMinAU > 0 ? mapR(aMinAU) / 20 : sysCam.fit / 60;
          var rOut = Math.min(mapR(100 * rsAU), rCap), rIn = rOut * (3 / 22);
          var toEye = v3norm(v3sub(M.eye, v));
          /* 投影尺寸先算出来：三维盘画不画、暗核多大都要用它 */
          var rightW = v3norm(v3cross([0, 1, 0], toEye)); if (!isFinite(rightW[0])) rightW = [1, 0, 0];
          var sc0 = toScreen(M.vp, v);
          var scO = toScreen(M.vp, v3add(v, v3scale(rightW, rOut)));
          var rOutPx = Math.hypot(scO[0] - sc0[0], scO[1] - sc0[1]) * dpr;            // toScreen 给 CSS 像素，sprite 的尺寸按设备像素
          if (rOutPx >= 7) {
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
            R.use('ring', { uVP: M.vp, uModel: m4trans(v), uInner: rIn, uOuter: rOut, uMode: 2, uColor: [1.0, 0.72, 0.42], uAlpha: 0.55, uTime: elapsed, uSunO: [0, 1, 0], uCassini: 0, uDoppler: toEye, uPerm: 0 }, [R.permDefault]);
            gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
            gl.enable(gl.DEPTH_TEST);    // 上面为了画盘关掉了深度测试，这里必须还回去，否则后面的天体会被乱序覆盖
          }
          /* 细亮环（kind 2 是环形 sprite）+ 中心暗核。两个都有像素地板：盘按物理尺寸已经小到
             亚像素，没有这两笔的话黑洞在恒星系视图里就完全看不见了。 */
          var corePx = clamp(rOutPx * (3 / 22) * 0.95, 3, 200);
          sprites.push({ p: v, size: Math.max(corePx * 1.9, 7), color: [1.0, 0.62, 0.34, 0.75], kind: 2 });
          sprites.push({ p: v, size: corePx, color: [0.03, 0.02, 0.05, 1], kind: 1, light: [0, 0, 1] });
          if (bhNote == null) bhNote = 2.95 * mBH;                                    // HUD 里要如实写出视界半径（km），说明盘为什么只能是示意
          return;
        }
        /* 遗骸一律画成很小的点：它们在这一层本来就远不到一个像素，光晕只是"这里有个东西"的标记。
           2026-09-17 连同黑洞的盘一起再收一档（0.30/0.34 → 0.17/0.21），免得 12 km 的中子星
           看起来跟一颗主序星差不多大。 */
        if (stage === 'ns') { size = base * 0.17; c = [0.80, 0.88, 1.0]; }               // 中子星：半径 ~12 km
        else if (stage === 'wd') { size = base * 0.21; c = mix3(c, [1, 1, 1], 0.35); }   // 白矮星：地球大小，极白
        else if (stage === 'pn' || stage === 'snr') { size = base * 1.1; }
        else if (stage === 'rgb' || stage === 'agb') { size = base * clamp(rs, 1.6, 5.0); c = mix3(c, [1, 0.45, 0.2], 0.35); }
        // 耀星：低频、幅度有限地闪一下（GCVS UV 型），不晃眼
        if (st.variable && st.variable.type === 'UV') { var fl = Math.pow(Math.max(Math.sin(elapsed * 0.55 + (st.massRel || 1) * 7), 0), 24); size *= 1 + fl * 0.9; alpha = Math.min(1, alpha * (1 + fl * 0.5)); }
        sprites.push({ p: v, size: size, color: [c[0], c[1], c[2], alpha], kind: 0 });
      }
      if (sysNB && sys.stars) { // 多星：真实 N 体位置 + 拖尾
        sys.stars.forEach(function (st, i) { var p = sysNB.st.pos[i], v = mapXY(p[0], p[1]), c = rgb(st.color || '#fff4e8'), tr = sysNB.trails[i]; if (tr.length >= 4) { var pts = new Float32Array(tr.length / 2 * 3); for (var k = 0; k < tr.length / 2; k++) { var mv = mapXY(tr[k * 2], tr[k * 2 + 1]); pts[k * 3] = mv[0]; pts[k * 3 + 2] = mv[2]; } R.drawLines(pts, M.vp, [c[0], c[1], c[2], 0.35], false); }
          starSprite(st, v); starLabels.push({ v: v, star: st, name: TRN(st.name) + TR('（') + TR(st.stageName || '主序') + TR('）') }); }); }
      else { starSprite(star, [0, 0, 0]); }
      starScreen = [];
      // 彗星（示意）：核 + 背向恒星的尘埃尾；周期取奥尔特云量级，一次只画 1–3 颗
      var cometLabel = null;
      if (sys.comets && formedFrac > 0.02) {
        var nC = clamp(Math.round((sys.comets.longPeriodPerCentury || 5) / 8) + 1, 1, 3);
        for (var ci = 0; ci < nC; ci++) {
          var cr = mulberry32(hash32((sys.seed >>> 0) ^ (ci + 31) * 0x85EBCA6B));
          var q = 0.4 + cr() * 1.6, Q = 26 + cr() * 60, ecc = (Q - q) / (Q + q), aC = (Q + q) / 2;
          var nuC = (animYr * 0.9 / Math.max(Math.pow(aC, 1.5), 1) + cr()) * TAU;
          var rC = aC * (1 - ecc * ecc) / (1 + ecc * Math.cos(nuC)), rmC = mapR(clamp(rC, 0.05, Q));
          var angC = nuC + cr() * TAU, pC = [rmC * Math.cos(angC), 0.03 * mapR(Q) * Math.sin(nuC * 0.7), -rmC * Math.sin(angC)];
          var out = v3norm(pC), tailLen = clamp(mapR(Q) * 0.16 / Math.max(rC, 0.4), 0.02, 0.5);
          var tp = new Float32Array(2 * 3); tp[0] = pC[0]; tp[1] = pC[1]; tp[2] = pC[2];
          tp[3] = pC[0] + out[0] * tailLen; tp[4] = pC[1] + out[1] * tailLen; tp[5] = pC[2] + out[2] * tailLen;
          R.drawLines(tp, M.vp, [0.72, 0.86, 0.95, 0.5], false);
          sprites.push({ p: pC, size: clamp(3.2 * Math.pow(sysCam.fit / sysCam.dist, 0.5), 2, 8), color: [0.85, 0.95, 1, 0.95], kind: 1, light: v3scale(out, -1) });
          if (ci === 0) cometLabel = { v: pC, text: TR('长周期彗星（示意）') };
        }
      }
      planetPos = [];
      var moonLabels = [], moonScaleNote = null, moonLine = null;
      sys.planets.forEach(function (p, i) {
        var born = smoothstep(p.timeline.formGyr, p.timeline.formGyr + 0.15, age); planetPos[i] = null; if (born <= 0) return;
        var pa = planetAbs(p, animYr), pv = mapXY(pa.xy[0], pa.xy[1]), sc = toScreen(M.vp, pv), op = { p: pv, sunDir: v3norm([-pa.rel[0], 0, pa.rel[1]]) };
        R.drawLines(sysNB ? planetPathAbs(p) : orbitPath(p), M.vp, [1, 1, 1, (i === S.selected ? 0.55 : 0.16) * born], false);
        var px = clamp((3.2 + 3.2 * Math.log2(1 + p.radiusRel)) * Math.pow(sysCam.fit / sysCam.dist, 0.5), 2.5, 70) * (0.5 + 0.5 * born);
        var col = rgb(p.color || '#aaaaaa'), lv = m4dir(M.view, op.sunDir);
        sprites.push({ p: op.p, size: px, color: [col[0], col[1], col[2], born], light: lv, kind: 1 });
        if (i === S.selected) sprites.push({ p: op.p, size: px + 7, color: [1, 1, 1, 0.9], kind: 2 });
        if (hoverInfo && hoverInfo.index === i && i !== S.selected) sprites.push({ p: op.p, size: px + 7, color: [1, 1, 1, 0.4], kind: 2 });
        planetPos[i] = { sx: sc[0], sy: sc[1], px: px, pos: op.p, depth: sc[2] };
        /* 卫星（放大示意）：按真实比例根本画不出来——月球轨道只有日地距离的 0.26%，
           在这个视图里连一个像素都不到。所以把卫星轨道放大到行星图标的 2–3.4 倍并明确标注放大倍数。
           默认只画选中/悬停的那颗，按 M 打开后所有行星都画。 */
        var showThis = showMoons || i === S.selected || (hoverInfo && hoverInfo.index === i);
        var mlist = p.moons || [];
        if (showThis && mlist.length && born > 0.4) {
          var rOuter = Math.max(mlist[mlist.length - 1].orbitKm || 1, 1);
          var scaleR = px * 3.4 / Math.max(H / dpr, 1) * sysCam.dist / sysCam.fit * 2.4;   // 屏幕像素 → 世界单位（近似）
          moonScaleNote = moonScaleNote || { planet: p.name, factor: (px * 3.4) };
          mlist.forEach(function (mo, mi) {
            var fr = mlist.length > 1 ? 0.45 + 0.55 * Math.pow((mo.orbitKm || 1) / rOuter, 0.55) : 0.8;
            var rr2 = scaleR * fr, aM = spinOf(p) * (animYr * 365.25 / Math.max(mo.periodDays || 10, 0.05) * TAU) + mi * 1.7 + (mo.seed % 97) * 0.065;   // 卫星跟行星同向：同一个系统共享角动量
            var mpos = [op.p[0] + rr2 * Math.cos(aM), op.p[1] + rr2 * 0.22 * Math.sin(aM), op.p[2] - rr2 * Math.sin(aM)];
            var ring = new Float32Array(49 * 3);
            for (var t2 = 0; t2 <= 48; t2++) { var a2 = t2 / 48 * TAU; ring[t2 * 3] = op.p[0] + rr2 * Math.cos(a2); ring[t2 * 3 + 1] = op.p[1] + rr2 * 0.22 * Math.sin(a2); ring[t2 * 3 + 2] = op.p[2] - rr2 * Math.sin(a2); }
            R.drawLines(ring, M.vp, [0.65, 0.75, 0.9, 0.20], true);
            var mc = mo.tidalHeated ? [0.62, 0.86, 0.95] : rgb('#c9c3bb');
            sprites.push({ p: mpos, size: clamp(px * 0.34, 2, 12), color: [mc[0], mc[1], mc[2], born], kind: 1, light: lv });
            moonLabels.push({ v: mpos, name: TRN(mo.name) + (mo.tidalHeated ? TR(' ·潮汐加热') : ''), tidal: !!mo.tidalHeated, r: mo.radiusKm || 0 });
          });
        }
      });
      sprites.sort(function (a, b) { return a.kind === 0 ? -1 : b.kind === 0 ? 1 : 0; });
      R.drawSprites(sprites, M.vp, W, H);
      // 标签
      if (starLabels.length) starLabels.forEach(function (sl) { var scs = toScreen(M.vp, sl.v); starScreen.push({ sx: scs[0], sy: scs[1], star: sl.star }); R.drawText(sl.name, scs[0] + 10, scs[1] - 10, 12, '#f0e6d2', 0.9, W, H, dpr); });
      else { var sc0 = toScreen(M.vp, [0, 0, 0]); starScreen.push({ sx: sc0[0], sy: sc0[1], star: star }); R.drawText(TRN(star.name) + (S.selected === -2 ? TR(' · Enter 近观（安全距离外，不可降落）') : ''), sc0[0] + 12, sc0[1] - 12, 13, S.selected === -2 ? '#ffffff' : '#f0e6d2', 0.9, W, H, dpr); }
      beltLabels.forEach(function (b) { var s2 = toScreen(M.vp, b.v); if (s2[2] < 1) R.drawText(b.text, s2[0], s2[1], 11, b.col, 0.8, W, H, dpr); });
      if (cometLabel) { var sc2 = toScreen(M.vp, cometLabel.v); if (sc2[2] < 1) R.drawText(cometLabel.text, sc2[0] + 8, sc2[1] - 8, 11, '#a8d8ee', 0.85, W, H, dpr); }
      /* 标签防重叠：一颗巨行星可以有二三十颗卫星，名字全画出来会和行星名、
         「Enter 进入」提示糊成一团（用户报"标签堆在一起，什么都看不清"）。
         规则：行星名与进入提示是主标签，先画先占位；卫星标签按半径从大到小排队，
         最多画 MOON_LABEL_MAX 个，且撞上任何已占位的框就跳过。宽度用字宽估算
         （CJK 按一个字宽、拉丁按 0.55 字宽），不需要精确——只用来判相交。 */
      var MOON_LABEL_MAX = 5, placed = [];
      function estW(txt, size) { var w = 0; for (var ci = 0; ci < txt.length; ci++) w += txt.charCodeAt(ci) > 0x2e80 ? size : size * 0.55; return w; }
      function claim(x, y, w, size) {
        var h = size * 1.35, top = y - h;
        for (var pi = 0; pi < placed.length; pi++) { var b = placed[pi];
          if (x < b.x + b.w && x + w > b.x && top < b.y && y > b.y - b.h) return false; }
        placed.push({ x: x, y: y, w: w, h: h }); return true;
      }
      sys.planets.forEach(function (p, i) { var q = planetPos[i]; if (!q || q.depth > 1) return; var sel = i === S.selected, lifeNow = p.life && age > (p.life.rank >= 3 ? p.timeline.civGyr : p.life.rank >= 1 ? p.timeline.greenGyr : p.timeline.oceanGyr + 0.3);
        var mc = p.moonCount != null ? p.moonCount : (p.moons ? p.moons.length : 0);
        var lx = q.sx + q.px + 6, ly = q.sy - 4, fs = sel ? 13 : 12;
        var txt = TRN(p.name) + (lifeNow ? ' ·' + TR(p.life.level) : '') + (mc ? ' · ' + mc + TR(' 卫') : '') + (p.visual && p.visual.rings ? TR(' · 环') : '');
        claim(lx, ly, estW(txt, fs), fs);
        var lw = R.drawText(txt, lx, ly, fs, sel ? '#ffffff' : (lifeNow ? '#bde5b8' : '#c8c8c8'), sel ? 1 : 0.8, W, H, dpr); q.label = { x: lx, y: ly, w: lw, h: sel ? 20 : 18 };
        if (sel) { var hint = TR('Enter 进入 · 再点一次或双击进入'); claim(lx, ly + 16, estW(hint, 11), 11); R.drawText(hint, lx, ly + 16, 11, '#9fd3ff', 0.95, W, H, dpr); } });
      /* 卫星名**不跟着卫星画**：卫星轨道周期只有几天，动画一跑标签就绕着行星飞，
         用户报"点任何一个都有标签在疯转"。浮动文字追着运动物体转是纯粹的噪声——
         名字挪到底部 HUD 的一行静态列表里（见下面 moonLine），画面上只留卫星点和轨道圈。 */
      moonLine = moonLabels.length
        ? TR('卫星：') + moonLabels.slice().sort(function (a, b) { return (b.r || 0) - (a.r || 0); })
            .slice(0, MOON_LABEL_MAX).map(function (ml) { return ml.name; }).join(' · ')
          + (moonLabels.length > MOON_LABEL_MAX ? TR(' 等 ') + moonLabels.length + TR(' 颗') : '') + TR('（双击卫星进入）')
        : null;
      var yrPerSec = orbitSpeed, dayPerSec = yrPerSec * 365.25, speedTxt = TR('时间流速 ×') + speedMul + TR('（1 秒 = ') + (yrPerSec >= 1 ? fmt(yrPerSec, 2) + TR(' 年') : dayPerSec >= 1 ? fmt(dayPerSec, 1) + TR(' 天') : fmt(dayPerSec * 24, 1) + TR(' 小时')) + TR('，约为实时的 ') + (yrPerSec * 3.156e7).toExponential(1) + TR(' 倍）');
      var cap = TRN(sys.name) + ' · ' + (age < 0 ? TR('恒星尚未点燃') : dust > 0.02 ? TR('尘埃环，行星尚未诞生（') + fmtYr(age * 1e9) + TR('）') : TR('恒星系年龄 ') + fmtYr(age * 1e9) + ' · ' + sys.planets.length + TR(' 颗行星'));
      // 恒星本身：光谱型 / 演化阶段 / 变星标签 / 抽样依据（Kroupa 2001 IMF + Pecaut & Mamajek 2013 + Heger 2003）
      var stLine = TR('恒星：') + (star.spt || star.type) + TR('（') + TR(star.stageName || '主序') + TR('，') + fmt(star.massRel, 2) + TR(' M☉，') + (star.tempK ? Math.round(star.tempK) + ' K' : '—') + TR('，') + (star.lumRel >= 0.01 ? fmt(star.lumRel, 2) : star.lumRel > 0 ? star.lumRel.toExponential(1) : '0') + TR(' L☉）');
      if (star.variable) stLine += TR(' · 变星 ') + TR(star.variable.name) + TR('（') + star.variable.type + (star.variable.periodD ? TR('，P=') + (star.variable.periodD < 1 ? fmt(star.variable.periodD * 24, 1) + ' h' : fmt(star.variable.periodD, 2) + ' d') : '') + TR('）');
      if (star.stageNote) stLine += ' · ' + star.stageNote;
      var refLine = TR('抽样：') + (star.imf || 'Kroupa 2001 IMF') + TR(' · 光谱序列 ') + (star.seq || 'Pecaut & Mamajek 2013') + TR(' · 演化与遗骸 Heger 2003 / Kalirai 2008 · 行星出现率 Fressin 2013 / Petigura 2013（均为示意）');
      var hl = hierText(sys), lines = [cap, stLine]; if (hl) lines.push(hl + (sys.planets.some(function (p) { return p.orbitType === 'P'; }) ? TR(' · 行星：S 型绕单星 / P 型绕双星（HW99 稳定区）') : TR(' · 行星：S 型（HW99 稳定区）')));
      if (sys.multiplicityNote) lines.push(sys.multiplicityNote);
      lines.push(refLine);
      if (moonLine) lines.push(moonLine);   // 卫星名走静态行，不再跟着卫星转（见上面 moonLine 的说明）
      if (sys.disk) lines.push(TR('恒星系形态：') + TR(sys.disk.cn) + TR('（') + TR(sys.disk.ref) + TR('）'));
      // 小天体：带 / 彗星 / 流浪行星（数据一直都在，以前只是没画也没写）
      if (sys.belts && sys.belts.length) lines.push(TR('小天体：') + sys.belts.map(function (b) { return TR(b.cn) + ' ' + fmt(b.innerAU, 1) + '–' + fmt(b.outerAU, 1) + ' AU' + (b.members ? TR('（代表天体：') + b.members.map(function (m) { return TRN(m.name); }).join(TR('、')) + TR('，实测）') : ''); }).join(' · ') + TR('（点带为示意，颗数不代表真实数量；面板可进入其中的代表天体）'));
      if (sys.comets) lines.push(TR('彗星：奥尔特云外缘约 ') + (sys.comets.oortAU >= 1e4 ? fmt(sys.comets.oortAU / 1e4, 1) + TR(' 万 AU') : fmt(sys.comets.oortAU, 0) + ' AU') + TR('，长周期彗星约 ') + sys.comets.longPeriodPerCentury + TR(' 颗/世纪 · ') + TR(sys.comets.note) + TR('（可进入彗核：彗发与彗尾随日心距变化）'));
      if (sys.rogues && sys.rogues.length) lines.push(TR('流浪行星：此刻 ') + fmt(Math.max.apply(null, sys.rogues.map(function (r) { return r.distanceLy || 5; })), 1) + TR(' 光年内有 ') + sys.rogues.length + TR(' 颗（不绕任何恒星，可进入；') + (sys.rogueNote || TR('Sumi 2011 / Mróz 2017，示意')) + TR('）'));
      /* 吸积盘的诚实标注：它在这个视图里是**画大了**的，必须自己说出来，别让人以为盘就有那么宽。 */
      if (bhNote != null) lines.push(TR('吸积盘为示意：黑洞本身不发光，画面上那点发热的物质是被吸进去之前摩擦生热的盘。它的视界半径只有 ') + fmt(bhNote, 1) + TR(' km（≈ ') + (bhNote / 1.496e8).toExponential(1) + TR(' AU），按真比例在这一层连一个像素都不到。盘的外缘按物理量级给：100 r_s = 200 r_g（薄盘典型外缘是几百个引力半径），并封顶为最内行星轨道的 1/20，两者取小——所以它绝不会盖到行星轨道上。内缘取最内稳定圆轨道 ISCO = 3 r_s，内外之比是真的。小到画不出几个像素时只留一个暗核加一圈细亮环，那是标记不是尺度。颜色按 Shakura & Sunyaev 1973 的薄盘温标 T ∝ R^{−3/4}（内缘蓝白、外缘橙红），亮暗不对称是相对论性集束。要按 r_s 看盘，点进黑洞本体。'));
      lines.push(TR('恒星本体：点击') + TRN(star.name) + TR('可近观（安全距离外的示意；恒星与遗骸都不可降落，进去会说明为什么）。'));
      if (moonScaleNote) lines.push(TR('卫星：轨道已放大约 ') + fmt(moonScaleNote.factor, 0) + TR(' 倍显示（真实轨道在这个视图里不到一个像素）· M 键切换「所有行星都显示卫星」'));
      else if (sys.planets.some(function (p) { return (p.moonCount || 0) > 0; })) lines.push(TR('卫星：行星标签后的「N 卫」即卫星数；选中行星或按 M 可看放大示意'));
      if (sys.note) lines.push(sys.note);
      lines.push(speedTxt + TR(' · , / . 或 Shift+滚轮 调速 · M 卫星 · T 经典三体演示')); lines.push(S.selected >= 0 ? TRN(sys.planets[S.selected].name) + TR('：') + sys.planets[S.selected].desc : TR('拖动旋转 · 滚轮缩放 · 单击选中行星（再点一次/双击/Enter 进入） · [ ] 切换'));
      S.caption = cap; drawHud(lines);
    }

    /* 天体外观的两个开关，套在 materialUniforms 之上：
       ① 不规则形状（小行星 / 彗核）——顶点按 shapeOf 给的三轴 + 凸起位移，剪影不再是正圆；
       ② 只有星光的照明（流浪行星）——直射项压到 10%，环境项抬起来，再染一点星光的蓝白。 */
    function applyBodyLook(mu, p) {
      var su = shapeUniformsOf(p && p.shape); for (var k in su) mu[k] = su[k];
      if (p && (p.isRogue || p.starlit)) { mu.uLumK = 0.10; mu.uAmbK = 3.4; mu.uStarlit = 1; }
      else { mu.uLumK = 1; mu.uAmbK = 1; mu.uStarlit = 0; }
      return mu;
    }
    /* 恒星的视半径（弧度）。默认返回 0 = 沿用天空着色器里 1 AU 处的 ≈0.3°（所有行星保持原样）；
       小天体离恒星远得多，日面必须按 R★/d 缩成一个刺眼的点：主带 2.8 AU 处只有 0.10°，柯伊伯带 40 AU 处只有 0.007°。 */
    function sunAngOf(p) {
      if (!p || !p.isSmallBody) return 0;
      var au = p.isComet ? cometStateAt(p, S.timeYr).rAU : p.orbitAU;
      if (!isFinite(au) || au <= 0) return 0;
      var host = p.star, rSun = host && isFinite(host.radiusRel) && host.radiusRel > 0 ? host.radiusRel : 1;
      return clamp(0.0053 * rSun / au, 1.5e-5, 0.06);
    }
    // 屏幕上 1 个天体半径 = 多少 CSS 像素（用来把彗发/彗尾的角尺度换算成像素）
    function radiusPx(M) {
      var eyeN = v3norm(M.eye), rightW = v3norm(v3cross([0, 1, 0], eyeN));
      if (!isFinite(rightW[0])) rightW = [1, 0, 0];
      var a = toScreen(M.vp, [0, 0, 0]), b = toScreen(M.vp, rightW);
      return Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1);
    }
    /* 小天体 / 流浪行星的星球视图补画：同族小天体、彗发与彗尾、以及各自的信息行。 */
    function drawSmallBodyExtras(p, vp, M, g, sunW, model, rot, eps, slope, oct) {
      var lines = [], cap;
      if (p.isAsteroid) {
        /* 同族的其它小天体（示意）：真实主带的平均间距在 10⁶ km 量级——站在一颗小行星上，
           肉眼几乎不可能看到另一颗。这里按「碰撞族」（Hirayama 1918）与双小行星（Margot et al. 2002：
           近地小行星约 15% 是双星）把它们压缩到几倍核半径处显示，并在 HUD 里写明压缩。 */
        var rr = mulberry32(hash32((p.seed >>> 0) ^ 0x52434B5)), n = 5;
        gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND);
        for (var i = 0; i < n; i++) {
          var sc = 0.055 + rr() * 0.30, dist = 3.2 + rr() * 11, incl = (rr() - 0.5) * 1.1;
          var ang = elapsed * (0.012 + rr() * 0.03) + rr() * TAU;
          var pos = [dist * Math.cos(ang) * Math.cos(incl), dist * Math.sin(incl), -dist * Math.sin(ang) * Math.cos(incl)];
          var mm = m4mul(m4trans(pos), m4mul(m4scale(sc), m4rotY(elapsed * 0.09 + i)));
          var mu2 = materialUniforms(vp, g, elapsed, i * 1.3, Math.max(oct - 2, 2)); mu2.uOctF = 1; mu2.uDetail = 0;
          mu2.uVP = M.vp; mu2.uModel = mm; mu2.uRot = m3of(m4rotY(elapsed * 0.09 + i)); mu2.uCamW = M.eye; mu2.uSunW = sunW; mu2.uEps = eps / sc; mu2.uSlope = slope; mu2.uForming = 1;
          applyBodyLook(mu2, { shape: shapeOf(hash32((p.seed >>> 0) ^ (i + 11) * 0x9E3779B9), 0) });
          R.use(globeProgFor(vp), mu2, [g.perm, g.map, g.pal, g.pal, R.det3()]); gl.bindVertexArray(R.sphereVAO); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
        }
        gl.disable(gl.CULL_FACE);
        cap = TRN(p.name) + ' · ' + TR(p.pclassCn) + ' · ' + (p.belt ? TR(p.belt.cn) : TR('带内天体')) + ' ' + fmt(p.orbitAU, 2) + ' AU · ' + TR('平均半径 ') + fmt(p.radiusKm, p.radiusKm < 20 ? 2 : 0) + ' km';
        lines = [cap, p.desc,
          TR('关键参数：半径 ') + fmt(p.radiusKm, 1) + TR(' km · 密度 ') + p.rhoKgM3 + TR(' kg/m³ · 反照率 ') + fmt(p.albedo, 2) + TR(' · 表面重力 ') + p.gravityMS2 + TR(' m/s²（') + (p.gravityRel).toExponential(1) + TR(' g）· 逃逸速度 ') + (p.escapeMS < 100 ? fmt(p.escapeMS, 1) + ' m/s' : fmt(p.escapeMS / 1000, 2) + ' km/s') + TR(' · 自转 ') + fmt(p.rotationH, 2) + TR(' h · 平衡温度 ') + p.tempK + TR(' K · 无大气'),
          (p.real ? TR('数据：实测（') + (p.ref || '') + TR('）；表面纹理与形状为示意') : TR('示意（依据：') + p.ref + TR('）')) + (p.shape ? TR(' · 形状不规则：三轴比约 1 : ') + fmt(p.shape.axes[1], 2) + ' : ' + fmt(p.shape.axes[2], 2) : TR(' · 已被自引力揉圆')),
          TR('画面里的其它小天体为示意：主带真实平均间距在 10⁶ km 量级，站在一颗上几乎看不见另一颗；这里按碰撞族（Hirayama 1918）压缩到几倍核半径显示。'),
          TR('拖动旋转 · 滚轮拉近直至降落到表面 · [ ] 切换同一条带里的其它天体 · Esc 返回恒星系')];
      } else if (p.isComet) {
        var cs = cometStateAt(p, S.timeYr); S.cometState = cs;
        var act = cs.activity;
        if (act > 0.004) {
          // 彗发与两条尾：离子尾严格背向恒星，尘埃尾因轨道运动被拖在后面并弯曲
          var rPx = radiusPx(M), sc0 = toScreen(M.vp, [0, 0, 0]);
          var anti = v3scale(sunW, -1), scA = toScreen(M.vp, v3scale(anti, 6));
          var ix = scA[0] - sc0[0], iy = scA[1] - sc0[1], il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
          var ca = Math.cos(0.38), sa = Math.sin(0.38), dx = ix * ca - iy * sa, dy = ix * sa + iy * ca;   // 尘埃尾滞后约 22°
          var scrW = W / dpr, scrH = H / dpr, diag = Math.hypot(scrW, scrH);
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
          R.use('coma', { uRes: [scrW, scrH], uCenter: [sc0[0], sc0[1]], uIonDir: [ix, iy], uDustDir: [dx, dy],
            uComaCol: [0.42, 1.0, 0.70], uIonCol: [0.42, 0.60, 1.0], uDustCol: [1.0, 0.88, 0.62],
            /* 彗发/彗尾的视角尺度：不能只按彗核的像素半径算 —— 真实彗发的半径是彗核的上万倍，
               不管相机离核多近多远，它在画面里都是"一大团"。所以取 max(核半径×2.2, 画面对角线×5.5%) 起步。 */
            uComaR: clamp(Math.max(rPx * 2.2, diag * 0.055) * (0.55 + 1.05 * act), 16, diag * 0.20), uHoleR: rPx * 1.15,
            uIonLen: diag * (0.30 + 0.50 * act), uDustLen: diag * (0.22 + 0.38 * act),
            uIonW: clamp(Math.max(rPx, diag * 0.012) * (0.5 + 1.3 * act), 5, diag * 0.04), uDustW: clamp(Math.max(rPx, diag * 0.016) * (0.7 + 2.0 * act), 8, diag * 0.07),
            uCurve: 0.26, uAct: clamp(act * 1.1, 0, 1), uTime: elapsed, uPerm: 0 }, [R.permDefault]);   // comaF 里的 snoise 要采置换贴图：不绑就是把 RGBA 纹理当 usampler2D 用
          gl.bindVertexArray(R.quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
          gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
        }
        cap = TRN(p.name) + ' · ' + TR(p.pclassCn) + TR(' · 日心距 ') + fmt(cs.rAU, 2) + ' AU · ' + TR(cs.state);
        lines = [cap, p.desc,
          TR('关键参数：核半径 ') + fmt(p.radiusKm, 2) + TR(' km · 密度 ') + p.rhoKgM3 + TR(' kg/m³（孔隙率高，内部大半是空的）· 反照率 0.04（太阳系里最黑的一类表面）· 表面重力 ') + p.gravityMS2.toExponential(1) + TR(' m/s² · 逃逸速度 ') + fmt(p.escapeMS, 2) + TR(' m/s · 近日 ') + p.perihelionAU + TR(' AU / 远日 ') + p.aphelionAU + TR(' AU / 周期 ') + fmt(p.periodYr, 1) + TR(' 年'),
          TR('活动度随时间变：当前 r = ') + fmt(cs.rAU, 2) + TR(' AU（') + TR(cs.phase) + TR('），活动度 ') + Math.round(act * 100) + TR('% —— 水冰在约 ') + p.sublimAU + TR(' AU 以内才明显升华，产气率再按 1/r² 的日照标度。拖动时间条到近日点附近，彗发与彗尾会长出来；退到远日点只剩一块黑冰。'),
          TR('彗发半径此刻约 ') + (cs.comaKm > 1e4 ? fmt(cs.comaKm / 1e4, 1) + TR(' 万 km') : fmt(cs.comaKm, 0) + ' km') + TR('，彗尾约 ') + (cs.tailKm > 1e6 ? fmt(cs.tailKm / 1.496e8, 2) + ' AU' : fmt(cs.tailKm / 1e4, 0) + TR(' 万 km')) + TR('——真实尺度远大于画面，这里按屏幕压缩显示（示意）。蓝色的是离子尾（太阳风吹的，严格背向恒星；Biermann 1951），黄白色的是尘埃尾（被轨道运动拖弯；Finson & Probstein 1968）。真实彗发会把彗核完全盖住（乔托号、罗塞塔正是为此才必须飞过去），这里把最内圈的彗发挖空，才看得见核的轮廓。'),
          TR('近日点窗口很窄：这颗彗星 ') + fmt(p.periodYr, 1) + TR(' 年的周期里只有约 ') + fmt(p.activeWindowYr, 2) + TR(' 年（') + fmt(p.activeFrac * 100, 2) + TR('%）在 3 AU 以内——开普勒第二定律的直接后果。') + (cs.activity < 0.02 ? TR('距下一次过近日点还有约 ') + fmt(cs.toPerihelionYr, 1) + TR(' 年。') : ''),
          TR('依据：') + p.ref,
          TR('拖动旋转 · 滚轮拉近直至降落到彗核表面 · [ ] 切换其它彗星 · Esc 返回恒星系')];
      } else {   // 流浪行星
        var st = p.star || {};
        cap = TRN(p.name) + TR(' · 流浪行星（不绕任何恒星）· ') + (p.distanceLy ? TR('此刻距 ') + TRN(p.nearSystem || '本恒星系') + TR(' 约 ') + p.distanceLy + TR(' 光年') : TR('星际空间'));
        lines = [cap, p.desc,
          TR('关键参数：半径 ') + fmt(p.radiusRel, 2) + TR(' R⊕ · 质量 ') + fmt(p.massEarth, 1) + TR(' M⊕ · 表面重力 ') + fmt(p.gravityRel, 2) + TR(' g · 表面温度约 ') + p.tempK + TR(' K（') + fmt(p.tempK - 273.15, 0) + TR(' ℃）· 恒星辐照 0（没有宿主恒星）'),
          TR('照明：这里唯一的光源是整个天空的星光——比地球上的满月还暗几个数量级。画面亮度是示意，只为看清地形轮廓；真实景象接近全黑。热量全部来自内部余热与放射性衰变（') + fmt(p.tempK, 0) + TR(' K 就是这么维持的）。'),
          TR('依据：') + (p.ref || TR('Sumi et al. 2011 / Mróz et al. 2017（示意）')),
          TR('拖动旋转 · 滚轮拉近直至降落 · [ ] 切换其它流浪行星 · Esc 返回恒星系')];
      }
      /* 状态复位：drawGlobe 在画本体前开了 CULL_FACE，而 HUD 的文字是一张按屏幕坐标铺的 quad，
         背面朝外——不关掉剔除，文字会被整片剔掉（"HUD 一行都不显示"就是这么来的）。 */
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      S.caption = cap; drawHud(lines);
    }

    /* 球面视图选哪个着色器：正式的收货了就用正式的，没有就用占位的。
       R.use 里那条「没收货就当场 finishProg」的兜底仍然在，但正常路径永远走不到它了。 */
    function globeProgFor(vp0) {
      var want = globeProgName(vp0);
      if (!R) return want;
      if (R.ready(want)) {
        /* 正在看的这一种编好了，再去发地表那几个重的：双击降落时它们多半已经就绪。 */
        R.ensureProg(terrainProgName(vp0)); R.ensureProg('water'); R.ensureProg('cloud'); R.ensureProg('gas'); R.ensureProg('bldg');
        return want;
      }
      R.ensureProg(want);
      return R.ready('globeLo') ? 'globeLo' : want;
    }
    function drawGlobe() {
      var p = S.planet, vp = S.vp, M = globeMatrices(); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var sunW = globeSunDir(), starCol = starRGB(p.star || (S.system && S.system.star));
      // 小天体离恒星远：日面视半径按 1/距离 缩小（主带 2.8 AU 处只有 0.1°，就是一个刺眼的亮点）；流浪行星没有宿主恒星
      drawSky(M, { space: true, sun: sunW, starColor: p.isRogue ? [0, 0, 0] : starCol, sunAng: sunAngOf(p), starDim: p.isRogue ? 0.0001 : 0 });
      var g = R.planetGPU(p, vp), model = planetModel(p, globeCam.spin), rot = m3of(model), d = globeCam.dist;
      /* 细节的距离 LOD：倍频数取连续值，整数部分决定循环次数，小数部分交给 uOctF 做最后一档的淡入淡出。
         以前是 Math.round —— 拉近一点就整档跳出来，那一下地形自己抖一抖，看着就是「闪」。
         uDetail 则管高频的**反照率**斑点（沙丘细纹、林内明暗、岩石斑）：远景为 0，所以远看只有大结构。 */
      /* 坡度夸张：越近越大。原来是越远越大（1.5 + (d-1)*2.5）—— 结果贴到脸上时地形被压成一张平面，
         能看见的就只剩反照率噪点了。 */
      var eps = clamp((d - 1) * 0.8 / (H / dpr) * 1.6, 2e-5, 6e-3), slope = clamp(1.6 + 5.2 * smoothstep(3.0, 1.45, d) - 2.6 * smoothstep(1.45, 1.04, d), 1.4, 7);
      var octC = clamp(3 + Math.log2(1 / Math.max(d - 1, 0.01)), 2, 6), oct = Math.max(2, Math.ceil(octC)), octF = clamp(octC - (oct - 1), 0.001, 1);
      /* 细节权重：从 2.8 就开始起、1.25 就满 —— 半屏（d≈1.55）那一档要看得到丝缕，不能等贴脸才淡入 */
      var detail = smoothstep(2.8, 1.25, d);
      var mu = materialUniforms(vp, g, elapsed, globeCam.spin * 0.12 + elapsed * 0.006, oct);
      mu.uOctF = octF; mu.uDetail = detail;
      if (!vp.exists) { // 尚未形成：只画一团尘埃
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
        R.use('ring', { uVP: M.vp, uModel: m4id(), uInner: 0.2, uOuter: 2.2, uMode: 1, uColor: [0.5, 0.45, 0.4], uAlpha: 0.5, uTime: elapsed, uSunO: [0, 1, 0], uCassini: 0, uPerm: 0 }, [g.perm]);
        gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
        S.caption = TRN(p.name) + ' · ' + TR(vp.eraName); drawHud([S.caption, p.desc]); return; }
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      mu.uVP = M.vp; mu.uModel = model; mu.uRot = rot; mu.uCamW = M.eye; mu.uSunW = sunW; mu.uEps = eps; mu.uSlope = slope; mu.uForming = vp.forming;
      applyBodyLook(mu, p);   // 不规则形状（小行星/彗核）与"只有星光"的照明（流浪行星）
      /* 正式的那个还没收货就先用占位的：宁可少几层细节，也不能把主线程钉在驱动里等编译。 */
      var globeProg = globeProgFor(vp);
      gl.bindVertexArray(R.sphereVAO);
      if (g.mapOld && R.stepFade(g, lastDt) < 1) {
        /* 全分辨率那张刚做好：先画占位的低分辨率，再把新的按 alpha 叠上去 —— 换图不跳。
           只有这 0.35 s 会画两遍球，其余时间和从前一样一遍。 */
        mu.uMapSize = [g.mapsOld.W, g.mapsOld.H]; mu.uAlpha = 1;
        R.use(globeProg, mu, [g.perm, g.mapOld, g.pal, g.city || g.pal, R.det3()]); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        mu.uMapSize = [g.maps.W, g.maps.H]; mu.uAlpha = g.fade;
        R.use(globeProg, mu, [g.perm, g.map, g.pal, g.city || g.pal, R.det3()]); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.BLEND);
      } else {
        R.use(globeProg, mu, [g.perm, g.map, g.pal, g.city || g.pal, R.det3()]); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0);
      }
      gl.bindVertexArray(null);
      if (p.isSmallBody || p.isRogue) return drawSmallBodyExtras(p, vp, M, g, sunW, model, rot, eps, slope, oct);
      // 卫星（显示距离压缩到 2.5–7 R）
      var moonsDrawn = [], moonBuilt = 0;
      /* 卫星：真实轨道半径在这个视图里根本进不了画面（月球在 60 R⊕，而相机只离行星 3 R），
         所以把显示距离压到 1.55–2.45 R 之间（按真实轨道排序），大小仍用真实比例，HUD 里注明压缩倍数。
         以前用的是 clamp(真实距离, 2.5, 7+k)：月球被摆在 7 R 上，早就跑到画面外了——「卫星生成了却看不见」就是这么来的。 */
      var moonCompress = null;
      (p.moons || []).forEach(function (mo, k) { if (!mo.radiusRel || mo.radiusRel / p.radiusRel < 0.02) return; if (k > 3) return;
        var mp = moonBody(p, mo, k);   // 与「进入这颗卫星」用的是同一个天体对象：看到的和进去的必须是同一颗
        var mvp = visualParams(mp, S.timeYr), mg = R.gpuCached(mp, 128);
        if (!mg) { if (moonBuilt >= 1) return; moonBuilt++; mg = R.planetGPU(mp, mvp, 128); }
        var rr = mo.radiusRel / p.radiusRel;
        var realR = (mo.orbitKm * 1000) / (p.radiusM || EARTH_R_M);                                  // 真实轨道半径（行星半径为单位）
        var nMoon = Math.min((p.moons || []).length, 4), dist = 1.55 + rr + (nMoon > 1 ? k / (nMoon - 1) : 0.35) * 0.9;
        if (moonCompress == null || realR / dist > moonCompress) moonCompress = realR / dist;
        var ang = elapsed * 0.35 / Math.max(mo.periodDays || 10, 0.4) * 6 + k * 2.1 + (mo.seed % 100) * 0.06;
        var pos = [dist * Math.cos(ang), 0.16 * dist * Math.sin(ang * 0.7), -dist * Math.sin(ang)], mm = m4mul(m4trans(pos), m4mul(m4scale(rr), m4rotY(elapsed * 0.05)));
        var mmu = materialUniforms(mvp, mg, elapsed, 0, Math.max(oct - 2, 2)); mmu.uOctF = 1; mmu.uDetail = detail * 0.25; mmu.uVP = M.vp; mmu.uModel = mm; mmu.uRot = m3of(m4rotY(elapsed * 0.05)); mmu.uCamW = M.eye; mmu.uSunW = sunW; mmu.uEps = eps / rr; mmu.uSlope = slope; mmu.uForming = 1;
        R.use(globeProgFor(mvp), mmu, [mg.perm, mg.map, mg.pal, mg.pal, R.det3()]); gl.bindVertexArray(R.sphereVAO); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
        moonsDrawn.push({ name: TRN(mo.name) + TR('（半径 ') + fmtKm(mo.radiusRel * EARTH_R_M) + TR('，轨道 ') + fmtKm(mo.orbitKm * 1000) + TR('，周期 ') + fmt(mo.periodDays, 2) + TR(' 天') + (mo.tidalHeated ? TR(' · 潮汐加热：冰壳下可能有液态水海洋') : '') + TR('）'), pos: pos, r: rr, tidal: !!mo.tidalHeated, index: k, body: mp }); });
      moonPick = moonsDrawn;   // 双击可进入：记下这一帧每颗卫星的位置
      // 光环
      if (vp.rings) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE); gl.depthMask(false);
        var sunO = m4dirT(model, sunW), rc = vp.gasStyle === 'saturn' ? [0.86, 0.8, 0.66] : vp.gasStyle === 'uranus' ? [0.6, 0.65, 0.7] : mix3(rgb(p.color), [0.8, 0.8, 0.8], 0.5);
        R.use('ring', { uVP: M.vp, uModel: model, uInner: vp.rings.inner, uOuter: vp.rings.outer, uMode: 0, uColor: rc, uAlpha: vp.rings.faint ? 0.25 : 0.9, uTime: elapsed, uSunO: sunO, uCassini: vp.rings.cassini ? 1 : 0, uPerm: 0 }, [g.perm]);
        gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null); gl.depthMask(true); gl.enable(gl.CULL_FACE); }
      // 大气边缘光
      if (vp.atmDensity > 0.01) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.cullFace(gl.BACK);
        R.use('atm', { uVP: M.vp, uModel: m4mul(model, m4scale(1.028)), uRot: rot, uCamW: M.eye, uSunW: sunW, uAtm: vp.atm, uAtmDensity: vp.atmDensity }); gl.bindVertexArray(R.sphereVAO); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null); gl.depthMask(true); }
      gl.disable(gl.CULL_FACE);
      moonsDrawn.forEach(function (m) { var sc = toScreen(M.vp, m.pos); if (sc[2] < 1) R.drawText(m.name, sc[0] + 8, sc[1] - 10, 11, m.tidal ? '#9fe0ee' : '#bbbbbb', 0.85, W, H, dpr); });
      var alt = (d - 1) * vp.radiusM;
      S.caption = TRN(p.name) + ' · ' + (p.isMoon ? TR(p.pclassCn || '卫星') + TR('（') + TRN(p.parent ? p.parent.name : '') + TR(' 的卫星）') : TR(TYPE_CN[p.type] || p.type) + (p.subtype === 'iceGiant' ? TR('（冰巨星）') : '')) + ' · ' + TR(vp.eraName) + TR(' · 高度 ') + fmtKm(alt);
      var gLines = [S.caption, p.desc]; if (darkHost(p)) gLines.push(darkHostNote(p));
      if (vp.gas && vp.gasNote) gLines.push(vp.gasNote);   // 巨行星的颜色从哪来：云顶温度 → 凝结物 → 颜色
      if (vp.tholinNote) gLines.push(vp.tholinNote);              // 托林雾霾/沉积：单独一行（HUD 不换行）
      if (vp.lightNote) gLines.push(vp.lightNote);                // 偏粉/偏蓝可能只是宿主恒星的色温
      var nMoonAll = p.moonCount != null ? p.moonCount : ((p.moons || []).length);
      if (nMoonAll) gLines.push(TR('卫星 ') + nMoonAll + TR(' 颗') + (moonsDrawn.length ? TR('（画出最大的 ') + moonsDrawn.length + TR(' 颗，大小为真实比例；轨道距离已压缩约 ') + fmt(moonCompress || 1, 0) + TR(' 倍才进得了画面，双击卫星进入）') : '') + (vp.rings ? TR(' · 另有一组行星环') : ''));
      else if (vp.rings) gLines.push(TR('这颗行星有一组行星环。'));
      if (p.isMoon) gLines.push((p.tidalHeated ? TR('受潮汐加热的冰卫星：') + (p.ref || '') + '　' : '') + TR('返回上一级（Esc）回到母行星 ') + TRN(p.parent ? p.parent.name : '') + TR(' · [ ] 切换同一颗行星的其它卫星'));
      gLines.push(TR('拖动旋转 · 滚轮拉近直至降落 · 双击某点直接降落 · Esc 返回')); drawHud(gLines);
    }

    /* ------------------------------------------------------------ 恒星近观（安全距离外）
       每个演化阶段一套外观：主序（米粒组织 + 黑子 + 星冕）/ 红巨星、AGB（几个巨对流胞、脉动）/
       行星状星云、超新星遗迹（中心裸核 + 一圈抛出的气体）/ 白矮星（地球大小、几乎无结构）/
       中子星（12 km、两极热斑，磁轴不重合就是脉冲星）/ 黑洞（没有光球：吸积盘 + 阴影 + 光子环 + 背景星光被弯折）。
       一律不可降落——恒星没有可以站立的表面，遗骸更是致命。HUD 直接写明原因，而不是"点了没反应"。 */
    function starLook(b) {
      var s = b.stage, c = rgb(b.color || '#fff4e8');
      /* 米粒尺度做了夸张：太阳的米粒直径约 1000 km ≈ 星面的 1/700，按真比例在屏幕上只有一两像素、
         看起来就是一层砂纸。这里取约 1/40 的胞径（HUD 注明是示意），花纹才读得出来。 */
      var o = { gran: 38, granAmp: 1.0, spots: 0.18, limbU: 0.6, facula: 0.35, cap: 0, corona: 0.55, prom: 0.5, flow: 0.02, col: mix3(c, [1, 0.94, 0.78], 0.35), pulse: 0, nebula: 0, disc: 0 };
      if (s === 'rgb' || s === 'agb') { o.gran = 4.5; o.granAmp = 1.0; o.spots = 0.05; o.flow = 0.006; o.corona = 0.30; o.prom = 0.35; o.pulse = s === 'agb' ? 0.07 : 0.015; o.col = mix3(c, [1, 0.42, 0.18], 0.45); }
      else if (s === 'wd') { o.gran = 120; o.granAmp = 0.14; o.spots = 0; o.limbU = 0.25; o.facula = 0.05; o.corona = 0.10; o.prom = 0; o.col = mix3(c, [0.88, 0.94, 1.0], 0.55); }
      else if (s === 'ns') { o.gran = 26; o.granAmp = 0.22; o.spots = 0; o.limbU = 0.12; o.facula = 0; o.cap = 1; o.corona = 0.65; o.prom = 0; o.col = [0.72, 0.82, 1.05]; }
      else if (s === 'pn' || s === 'snr') { o.gran = 90; o.granAmp = 0.4; o.spots = 0; o.limbU = 0.3; o.corona = 0.6; o.prom = 0.2; o.nebula = 1; o.col = s === 'pn' ? [0.70, 0.92, 1.0] : [1.0, 0.58, 0.40]; }
      else if (s === 'pms') { o.gran = 26; o.granAmp = 1.0; o.spots = 0.42; o.corona = 0.7; o.prom = 0.9; o.col = mix3(c, [1, 0.6, 0.35], 0.35); }
      else if (b.spt && (b.spt.charAt(0) === 'M' || b.spt.charAt(0) === 'K')) { o.spots = 0.36; o.prom = 0.75; o.gran = 30; o.col = mix3(c, [1, 0.72, 0.42], 0.40); }
      if (b.variable && b.variable.type === 'UV') o.prom = Math.max(o.prom, 1.1);     // 耀星：日珥/耀斑更活跃
      if (s === 'bh') { o.disc = 1; o.corona = 0; o.prom = 0; }
      return o;
    }
    function drawStarView() {
      var b = S.starBody; if (!b) return;
      var M = globeMatrices(), look = starLook(b), st = b.stage;
      gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var D = globeCam.dist;                                        // 观察距离，单位 = 天体半径（黑洞是史瓦西半径）
      var bhDir = v3norm(v3scale(M.eye, -1)), thSh = st === 'bh' ? clamp(2.598 / Math.max(D, 1.2), 0.004, 1.2) : 0;   // 阴影角半径 ≈ √27/2 · r_s/D
      drawSky(M, { space: true, sun: v3norm(M.eye), starColor: [0, 0, 0], bhDir: bhDir, bhShadow: thSh });
      var model = m4mul(m4rotZ(0.2), m4rotY(globeCam.spin * 0.35)), rot = m3of(model);
      if (st === 'bh') {
        /* 吸积盘：内缘取最内稳定圆轨道 ISCO = 3 r_s（无自转史瓦西黑洞：r_s=2GM/c² 时
           r_ISCO=6GM/c²=3 r_s），外缘 22 r_s 是**示意**压缩（真实外缘大得多）。
           恒星系视图现在用同一个内外比（那边的绝对尺度另按取景半径给，见 drawSystem 的说明）。
           温度 T ∝ R^{−3/4}（Shakura & Sunyaev 1973），转向观察者的一侧因相对论性集束而更亮。 */
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        R.use('ring', { uVP: M.vp, uModel: m4rotZ(0.06), uInner: 3.0, uOuter: 22.0, uMode: 2, uColor: [1, 0.8, 0.5], uAlpha: 0.95, uTime: elapsed, uSunO: [0, 1, 0], uCassini: 0, uDoppler: v3norm(M.eye), uPerm: 0 }, [R.permDefault]);
        gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
        // 光子环外侧的一圈"次像"（示意）：正对相机的细环，把被弯折过来的盘光交代出来
        var upA = Math.abs(bhDir[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], eA = v3norm(v3cross(upA, bhDir)), nA = v3cross(bhDir, eA);
        var halo = new Float32Array(16); var rH = D * Math.tan(thSh);
        halo[0] = eA[0]; halo[1] = eA[1]; halo[2] = eA[2]; halo[4] = bhDir[0]; halo[5] = bhDir[1]; halo[6] = bhDir[2]; halo[8] = nA[0]; halo[9] = nA[1]; halo[10] = nA[2]; halo[15] = 1;
        R.use('ring', { uVP: M.vp, uModel: halo, uInner: rH * 1.03, uOuter: rH * 1.22, uMode: 2, uColor: [1, 0.85, 0.6], uAlpha: 0.14, uTime: elapsed * 0.4, uSunO: [0, 1, 0], uCassini: 0, uDoppler: [0, 0, 0], uPerm: 0 }, [R.permDefault]);
        gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
        gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
      } else {
        var pulse = 1 + look.pulse * Math.sin(elapsed * 0.45);
        var mdl = m4mul(model, m4scale(pulse));
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        R.use('star', { uVP: M.vp, uModel: mdl, uRot: rot, uCamW: M.eye, uStarCol: look.col, uSpotCol: v3scale(look.col, 0.26),
          uMagAxis: [0.42, 0.86, 0.28], uTime: elapsed, uGran: look.gran, uGranAmp: look.granAmp, uSpots: look.spots,
          uLimbU: look.limbU, uFacula: look.facula, uCap: look.cap, uFlow: look.flow, uShaped: 0, uAxes: [1, 1, 1], uLobeN: 0 }, [R.permDefault]);
        gl.bindVertexArray(R.sphereVAO); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
        // 星冕与日珥（加色）
        if (look.corona > 0 || look.prom > 0) {
          var scC = toScreen(M.vp, [0, 0, 0]), rPxS = radiusPx(M) * pulse;
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
          R.use('corona', { uRes: [W / dpr, H / dpr], uCenter: [scC[0], scC[1]], uStarR: rPxS, uStarCol: look.col, uTime: elapsed, uProm: look.prom, uCorona: look.corona, uPerm: 0 }, [R.permDefault]);
          gl.bindVertexArray(R.quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
          gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
        }
        // 行星状星云 / 超新星遗迹：一圈正在膨胀的抛出物
        if (look.nebula) {
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
          R.use('ring', { uVP: M.vp, uModel: m4rotZ(0.5), uInner: 2.2, uOuter: 9.0, uMode: 1, uColor: st === 'pn' ? [0.35, 0.85, 0.75] : [0.95, 0.45, 0.3], uAlpha: 0.55, uTime: elapsed, uSunO: [0, 1, 0], uCassini: 0, uPerm: 0 }, [R.permDefault]);
          gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0); gl.bindVertexArray(null);
          gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
        }
      }
      gl.disable(gl.CULL_FACE);
      // ---- HUD：类型 / 关键参数 / 依据 / 为什么不能降落
      var rTxt = st === 'bh' ? TR('视界半径 ') + fmt(b.radiusM / 1000, 1) + ' km' : st === 'ns' ? TR('半径 12 km') : st === 'wd' ? TR('半径 ') + fmt(b.radiusM / 1000, 0) + TR(' km（约地球大小）') : TR('半径 ') + fmt(b.radiusSun, 2) + TR(' R☉（') + fmt(b.radiusM / 1000, 0) + TR(' km）');
      var distTxt = st === 'bh' ? fmt(D, 1) + ' r_s（' + fmtKm(D * b.radiusM) + '）' : fmt(D, 2) + ' R★（' + (D * b.radiusM / AU_M > 0.01 ? fmt(D * b.radiusM / AU_M, 3) + ' AU' : fmtKm(D * b.radiusM)) + '）';
      var flux = b.lumRel > 0 && D > 0 ? b.lumRel / Math.pow(Math.max(D * b.radiusM / AU_M, 1e-9), 2) : 0;
      var cap = TRN(b.name) + ' · ' + TR(b.stageName) + TR('（') + (b.spt || '—') + TR('）· 观察距离 ') + distTxt;
      var lines = [cap, b.desc,
        TR('关键参数：') + fmt(b.massRel, 2) + ' M☉' + (b.remnant ? TR('（末质量；前身 ') + fmt(b.massInit, 2) + TR(' M☉）') : '') + ' · ' + rTxt + ' · ' + (b.tempK ? Math.round(b.tempK) + ' K' : TR('无光球')) + TR(' · 光度 ') + (b.lumRel >= 0.01 ? fmt(b.lumRel, 2) : b.lumRel > 0 ? b.lumRel.toExponential(1) : '0') + ' L☉' + (b.ageGyr != null ? TR(' · 年龄 ') + fmt(b.ageGyr, 2) + ' Gyr' : '') + (b.variable ? TR(' · 变星 ') + TR(b.variable.name) + TR('（') + b.variable.type + TR('）') : ''),
        b.sizeNote,
        TR('不可降落：') + b.noLandReason + (flux > 0 ? TR('　此处辐照约 ') + (flux > 1e4 ? flux.toExponential(1) : fmt(flux, flux < 10 ? 2 : 0)) + TR(' S⊕（地球日照 = 1），"安全距离"取辐照 ≈ 2 S⊕ 处，约 ') + fmt(b.safeDistAU, 3) + TR(' AU。') : ''),
        TR('依据：') + b.ref];
      if (st === 'bh') lines.push(TR('画面里的透镜效应是示意：背景星光按弱场偏折 α ≈ 2r_s/b 反向映射，阴影角半径取 √27/2 · r_s/D（Schwarzschild 解），光子环与"次像"细环只画到量级；吸积盘的完整次像（Luminet 1979）没有画。吸积盘温度按 T ∝ R^{−3/4}（Shakura & Sunyaev 1973），内缘取 ISCO = 3 r_s（无自转），外缘取 22 r_s 为示意压缩（真实盘可伸到数百～数千 r_s；恒星系视图用同一个内外比，只是那边的绝对尺度按取景半径给），亮暗不对称是相对论性集束。'));
      else if (st === 'ns') lines.push(TR('两极的亮斑是磁极热斑（示意）：') + (b.pulsar ? TR('这一颗的磁轴与自转轴不重合，辐射束随自转扫过观察者就成了脉冲——它是一颗脉冲星（Hewish et al. 1968 发现，Gold 1968 给出灯塔模型）。') : TR('这一颗没有被标为脉冲星：要么磁轴与自转轴太接近、要么辐射束扫不到我们这个方向（射电脉冲星的可见性只有几成）。')) + TR('中子星没有光球也没有对流米粒，画面上的纹理只为让球体不至于是一块纯色。'));
      else if (st === 'agb') lines.push(TR('脉动为示意：AGB 星常是刍藁型（Mira）长周期变星，光变幅度可达几个星等，同时通过星风每年抛掉 10⁻⁷–10⁻⁴ M☉。'));
      else if (st === 'wd') lines.push(TR('外观为示意：白矮星的对流层极薄，实际几乎看不到米粒组织；这里只留一点点纹理免得像一个纯色圆盘。'));
      else lines.push(TR('米粒组织、黑子、日珥的位置与花纹都是过程生成（示意）；临边昏暗按 I(μ)/I(0) = 1 − u(1−μ)、u ≈ ') + fmt(look.limbU, 2) + TR('（Eddington 灰大气近似）；对流胞尺度 ~ 压力标高（Schwarzschild 1975），所以巨星上只剩几个巨胞。米粒被放大了约 20 倍：太阳的米粒直径约 1000 km，只有星面的 1/700，按真比例在屏幕上不到两个像素。'));
      lines.push(TR('拖动旋转 · 滚轮改变观察距离 · Esc 返回恒星系'));
      S.caption = cap; drawHud(lines);
    }

    /* 气态巨行星 / 冰巨星的降落 = 云顶飞越。没有地面、没有岩石与植被、没有硬地平线；
       高度以 1 bar 参考面为准，一直往下只会掉进越来越浓的霾里（Juno 的重力场测量说明木星内部是连续过渡的流体）。 */
    function drawGasDeck(p, vp, M, g, sun) {
      var Rm = vp.radiusM, Hs = gasScaleH(), camZ = surf.alt, basis = localBasis(surf.lat, surf.lon);
      gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var ice = vp.gasIce ? 1 : 0, bi = surf.gasBand || gasBandAt(vp, p.seed, clamp(Math.sin(surf.lat) * 0.5 + 0.5, 0, 1));
      var haze = mix3(bi.c, [1, 1, 1], ice ? 0.22 : 0.32);                     // 霾色取自当前云带：天和云不会是两个颜色系统
      var day = clamp(sun[2] * 3 + 0.2, 0, 1), starCol = starRGB(p.star || (S.system && S.system.star));
      var deep = clamp(-camZ / Math.max(Hs * 3.5, 1), 0, 1);                   // 下潜深度：0 = 1 bar 面，1 = 霾底
      var lum = 1 - deep * 0.74;                                               // 越深越暗（阳光被上面几十公里的云挡掉）
      var vis = clamp(Hs * (ice ? 2.4 : 1.8) * (1 - deep * 0.85), 5000, 220000);  // 能见度只有几十公里 → 地平线在被看见之前就化进霾里
      var skyH = [0, 0, 0], k;
      for (k = 0; k < 3; k++) skyH[k] = clamp(haze[k] * (0.10 + 0.90 * day) * lum, 0, 1);
      drawSky(M, { space: false, sun: sun, atm: mix3(haze, vp.atm, 0.3), fogColor: haze, starColor: starCol,
        atmDensity: clamp(1.15 + deep * 1.3, 0, 2.6), altitude: 0, fog: 1, under: false,
        horizonDip: 0, limb: 0, moonDir: [0, 0, 1], moonLit: 0, moonR: 0.99999 });
      var sunP = v3norm(v3add(v3add(v3scale(basis.east, sun[0]), v3scale(basis.north, sun[1])), v3scale(basis.up, sun[2])));
      var cell = clamp(Hs * 0.13, 900, 8000);
      // 相对 1 bar 参考面的分层：霾底 / 次层云带 / 主云顶 / 高层薄云 / 顶部霾（冰巨星的甲烷霾更厚、带纹更淡）
      var layers = [
        { z: -3.4 * Hs, a: 1.00, l: 0.50, det: 0, cell: cell, band: 0.5, bump: 0 },
        { z: -1.15 * Hs, a: 0.88, l: 0.74, det: 0.55, cell: cell * 3.2, band: 0.85, bump: cell * 0.5 },
        { z: 0, a: 0.95, l: 1.00, det: ice ? 0.72 : 1.00, cell: cell, band: 1.0, bump: cell * 0.30 },
        { z: 1.7 * Hs, a: ice ? 0.42 : 0.30, l: 1.04, det: 0.5, cell: cell * 5.0, band: 0.65, bump: cell * 1.2 },
        { z: 4.6 * Hs, a: ice ? 0.30 : 0.17, l: 1.0, det: 0, cell: cell, band: 0.35, bump: 0 }
      ];
      layers.sort(function (a, b) { return Math.abs(b.z - camZ) - Math.abs(a.z - camZ); });   // 画家算法：由远及近
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      layers.forEach(function (L) {
        var dz = Math.max(Math.abs(L.z - camZ), 20);
        // rMax 只要盖过雾（vis 之外全是霾）就够；放得越大环距越稀，云顶轮廓越容易被切成锯齿
        var rMax = clamp(Math.max(vis * 4, dz * 3), 30000, Rm * 1.4);
        // 该层看到的太阳高度角：比相机高 Δz 的地方，地平线远 √(2Δz/R)，太阳落下后还能再亮一阵（薄暮就是这么来的）
        var sunUpL = clamp((sun[2] + Math.sqrt(2 * Math.max(L.z - camZ, 0) / Rm)) * 3 + 0.2, 0, 1);
        R.use('gas', { uPerm: 0, uPal: 2, uPlanetR: Rm, uUp: basis.up, uEast: basis.east, uNorth: basis.north,
          uRMin: clamp(dz * 0.05, 0.4, 400), uRMax: rMax, uVP: M.vp, uHm: L.z,
          uCamL: M.eye, uSunL: sun, uSunP: sunP, uSkyHorizon: skyH, uSunCol: starCol,
          uFogDist: vis, uFogK: 1, uFar: M.far, uTime: elapsed,
          uDeckAlpha: L.a, uDeckLum: L.l * lum, uDeckDetail: L.det, uCellM: L.cell, uBumpAmp: L.bump, uSunUp: sunUpL,
          uBandAmp: L.band, uStorm: vp.gasStyle === 'jupiter' ? 1 : 0, uIce: ice }, [g.perm, g.map, g.pal]);
        gl.bindVertexArray(R.terrVAO); gl.drawElements(gl.TRIANGLES, R.terrN, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null);
      });
      gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
      var latS = (surf.lat >= 0 ? TR('北纬 ') : TR('南纬 ')) + fmt(Math.abs(surf.lat / DEG), 2) + '° ' + (surf.lon >= 0 ? TR('东经 ') : TR('西经 ')) + fmt(Math.abs(surf.lon / DEG), 2) + '°';
      var where = surf.alt >= 0 ? TR('高度（1 bar 参考面以上）') + fmtKm(surf.alt) : TR('1 bar 参考面以下 ') + fmtKm(-surf.alt);
      var pres = surf.pressureBar != null ? TR(' · 气压约 ') + (surf.pressureBar < 10 ? fmt(surf.pressureBar, 2) : fmt(surf.pressureBar, 0)) + ' bar' : '';
      S.caption = TRN(p.name) + ' · ' + (ice ? TR('冰巨星') : TR('气态巨行星')) + ' · ' + where + ' · ' + latS + ' · ' + TR(surf.terrainType) + pres +
        (surf.tempC != null ? TR(' · 气温约 ') + fmt(surf.tempC, 0) + ' ℃' : '') + (surf.cruise ? TR(' · 自动巡航（任意按键接管）') : '');
      var dLines = [S.caption,
        ice ? TR('冰巨星：氢氦大气之下是水/氨/甲烷的超临界流体幔，同样没有可以站立的表面；高度一律相对 1 bar 参考面。')
            : TR('气态巨行星：没有固体表面，只有分层的对流云带（依据：Juno 重力场测量）；高度一律相对 1 bar 参考面。')];
      if (vp.gasNote) dLines.push(vp.gasNote);
      if (vp.tholinNote) dLines.push(vp.tholinNote);
      if (vp.lightNote) dLines.push(vp.lightNote);
      dLines.push(TR('滚轮 = 升降（往下只会进入更浓的霾）· WASD/方向键 平移 · 拖动 视角 · Esc 返回星球'));
      drawHud(dLines);
    }

    function drawSurface() {
      var p = S.planet, vp = S.vp, M = surfaceMats(), g = R.planetGPU(p, vp), sun = surfaceSun(), Rm = vp.radiusM;
      if (vp.gas) return drawGasDeck(p, vp, M, g, sun);   // 气态/冰巨星没有固体表面：走云顶飞越，不走地形
      gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var camZ = surf.groundZ + surf.alt, altAboveSea = camZ, starCol = starRGB(p.star || (S.system && S.system.star));
      var vis = vp.atmDensity > 0.02 ? clamp(140000 / vp.atmDensity * (1 - vp.fog * 0.68), 55000, 5e7) : 5e7; // 能见度下限：浓雾也别把远景洗成一片白
      var day = clamp(sun[2] * 3 + 0.2, 0, 1), horizon = mix3(v3scale(vp.atm, 1.1), vp.fogColor, vp.fog), skyH = v3scale(horizon, day * clamp(vp.atmDensity, 0, 1)), fogK = Math.min(1, 9000 / Math.max(altAboveSea, 9000));
      skyH = [clamp(skyH[0], 0, 1), clamp(skyH[1], 0, 1), clamp(skyH[2], 0, 1)];       // 雾色不过曝
      var waterFog = mix3(vp.oceanDeep, vp.oceanShallow, 0.4);
      // 卫星（示意）：取反日点并按行星 seed 偏一个方位角；只有真有卫星、且在地平线以上的夜里才画
      var mn = moonSky(sun), lumF = starLumFactor(p), dark = darkHost(p);
      // 遗骸宿主：天空按照度收暗（星空透出来），但不给 0——地平线还得看得见
      drawSky(M, { space: false, sun: sun, atm: vp.atm, fogColor: vp.fogColor, starColor: p.isRogue ? [0, 0, 0] : (dark ? [0.30, 0.34, 0.44] : starCol), atmDensity: vp.atmDensity * lumF, altitude: altAboveSea, fog: vp.fog, under: surf.under, waterFog: waterFog, horizonDip: -Math.acos(Rm / (Rm + Math.max(altAboveSea, 1))), limb: vp.atmDensity * lumF * smoothstep(15000, 90000, altAboveSea) * 0.9, moonDir: mn.dir, moonLit: mn.lit, moonR: mn.cosR,
        sunAng: sunAngOf(p), starDim: p.isRogue ? 0.0001 : 0 });
      var basis = localBasis(surf.lat, surf.lon), oct = surfOct(), rMin = Math.max(Math.abs(surf.alt) * 0.06, 0.4), rMax = clamp(2.2 * Math.sqrt(2 * Rm * Math.max(surf.alt, 2)) + 20000, 30000, Rm * 1.4);
      var mu = materialUniforms(vp, g, elapsed, globeCam.spin * 0.12 + elapsed * 0.006, oct);
      // rMin/rMax 只决定网格疏密（几何 LOD）；高度场用的 uOct / uNormEps 是行星常量，与相机无关
      mu.uUp = basis.up; mu.uEast = basis.east; mu.uNorth = basis.north; mu.uRMin = rMin; mu.uRMax = rMax; mu.uNormEps = normEpsOf(vp); mu.uVP = M.vp; mu.uHm = 0;
      mu.uCloudDetail = 1;
      if (p.isRogue) { lumF = 0.11; }   // 只有星光：地形着色的直射项压到很低（HUD 写明是示意亮度）
      mu.uCamL = M.eye; mu.uSunL = sun; mu.uSunO = v3norm(v3add(v3add(v3scale(basis.east, sun[0]), v3scale(basis.north, sun[1])), v3scale(basis.up, sun[2]))); mu.uSkyHorizon = skyH; mu.uSkyZenith = v3scale(vp.atm, 0.45 * day); mu.uWaterFog = waterFog; mu.uFogDist = vis; mu.uFogK = fogK; mu.uUnder = surf.under ? 1 : 0; mu.uStarLum = lumF; mu.uFar = M.far; mu.uMoonL = mn.dir; mu.uMoonI = mn.lit * 0.55; // 月光实际弱得多，这里放大到能读出地形轮廓（示意）
      // 附近城市（≤ 250 km，最多 24 座）：地面材质用 uniform 数组，建筑用实例化体块
      var near = nearbyCities(g, basis, 250000), cityU = [], cityRot = [];
      near.forEach(function (c) { cityU.push(c.pos[0], c.pos[1], c.city.r, 1); cityRot.push(c.rot); });
      while (cityU.length < 24 * 4) { cityU.push(0, 0, 0, 0); cityRot.push(0); }
      mu.uCityN = near.length; mu.uCity = cityU; mu.uCityRot = cityRot;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      var terrProg = terrainProgName(vp); R.ensureProg(terrProg);
      R.use(terrProg, mu, [g.perm, g.map, g.pal, g.city || g.pal, R.det3()]); gl.bindVertexArray(R.terrVAO); gl.drawElements(gl.TRIANGLES, R.terrN, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null);
      // 建筑体块：最近的 10 座、150 km 内，按距离三档 LOD——近处全量几何，中距只留 1/3，远处只留最高的一撮当剪影（其余靠地面的城市霾交代）
      if (near.length && !surf.under && vp.lights > 0.01) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        for (var ci = 0; ci < near.length && ci < 10; ci++) { var c = near[ci]; if (c.dist > 150000) break; var b = buildingsFor(c.city, p, g.maps, vp); if (!b.count) continue;
          var lodN = c.dist < 18000 ? b.count : c.dist < 55000 ? b.midCount : b.silCount, sil = c.dist < 18000 ? 0 : c.dist < 55000 ? 0.3 : 1; if (!lodN) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, R.instBuf); gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, lodN * 8), gl.DYNAMIC_DRAW);
          R.use('bldg', { uVP: M.vp, uCityM: c.mat, uCamL: M.eye, uSunL: sun, uSkyHorizon: skyH, uFogDist: vis, uFogK: fogK, uFar: M.far, uTree: 0, uSil: sil });
          gl.bindVertexArray(R.bldgVAO); gl.drawArraysInstanced(gl.TRIANGLES, 0, R.cubeN, lodN); gl.bindVertexArray(null); }
        gl.disable(gl.CULL_FACE); }
      surf.nearCities = near;
      // 近地植被点缀：高度 < 700 m 时在相机周围 ~1.5 km 生成实例化树木（示意），随相机移动 250 m 重建
      if (surf.alt < 3000 && !surf.under && vp.green > 0.05 && !vp.gas) { var tk = Math.round(surf.lat * 1e4) + ':' + Math.round(surf.lon * 1e4);
        if (!surf.trees || Math.hypot((surf.lat - surf.trees.lat) * Rm, (surf.lon - surf.trees.lon) * Rm * Math.cos(surf.lat)) > Math.max(250, surf.alt * 0.2)) surf.trees = buildTrees(g.maps, vp, Rm);
        if (surf.trees && surf.trees.count) { var tm = new Float32Array(16); tm[0] = tm[5] = tm[10] = tm[15] = 1; var basisT = localBasis(surf.trees.lat, surf.trees.lon), O0 = v3scale(basis.up, Rm), PT = v3scale(basisT.up, Rm), DT = v3sub(PT, O0);
          tm[0] = v3dot(basisT.east, basis.east); tm[1] = v3dot(basisT.east, basis.north); tm[2] = v3dot(basisT.east, basis.up); tm[4] = v3dot(basisT.north, basis.east); tm[5] = v3dot(basisT.north, basis.north); tm[6] = v3dot(basisT.north, basis.up); tm[8] = v3dot(basisT.up, basis.east); tm[9] = v3dot(basisT.up, basis.north); tm[10] = v3dot(basisT.up, basis.up); tm[12] = v3dot(DT, basis.east); tm[13] = v3dot(DT, basis.north); tm[14] = v3dot(DT, basis.up);
          gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.bindBuffer(gl.ARRAY_BUFFER, R.instBuf); gl.bufferData(gl.ARRAY_BUFFER, surf.trees.data, gl.DYNAMIC_DRAW);
          R.use('bldg', { uVP: M.vp, uCityM: tm, uCamL: M.eye, uSunL: sun, uSkyHorizon: skyH, uFogDist: vis, uFogK: fogK, uFar: M.far, uTree: 1, uSil: 0 }); gl.bindVertexArray(R.bldgVAO); gl.drawArraysInstanced(gl.TRIANGLES, 0, R.cubeN, surf.trees.count); gl.bindVertexArray(null); gl.disable(gl.CULL_FACE); } }
      else if (surf.trees) surf.trees = null;
      if (vp.sea >= 0) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        R.use('water', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]); gl.bindVertexArray(R.terrVAO); gl.drawElements(gl.TRIANGLES, R.terrN, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null); gl.depthMask(true); }
      if (vp.cloud > 0.02 && !vp.gas && !surf.under) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        mu.uHm = clamp(Rm * 0.0013, 3000, 12000); R.use('cloud', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]); gl.bindVertexArray(R.terrVAO); gl.drawElements(gl.TRIANGLES, R.terrN, gl.UNSIGNED_INT, 0);
        // 第二层（更高、更稀）：多层云给出体积感
        mu.uHm *= 1.75; mu.uCloudRot += 0.37; mu.uCloud *= 0.7; R.use('cloud', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]); gl.drawElements(gl.TRIANGLES, R.terrN, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null); gl.depthMask(true); }
      gl.disable(gl.BLEND);
      /* 天上的其它带内天体（示意）：只在小行星/柯伊伯带天体的地表画。位置按 seed 确定，
         用被恒星照亮的小圆盘表示；HUD 写明真实间距在 10⁶ km 量级，压缩显示。 */
      if (p.isAsteroid && !surf.under) {
        var rk = mulberry32(hash32((p.seed >>> 0) ^ 0x5B0C6)), rocks = [], basisR = localBasis(surf.lat, surf.lon), camR = [0, 0, surf.groundZ + surf.alt];
        for (var ri = 0; ri < 9; ri++) {
          // 高度角集中在地平线上方 1°–28°：抬头 70° 的天顶方向不在取景范围里，那儿放了也看不见
          var az = rk() * TAU, el = 0.02 + Math.pow(rk(), 1.5) * 0.48, dR = Rm * (1.6 + rk() * 22);
          var dirR = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
          rocks.push({ p: v3add(camR, v3scale(dirR, dR)), size: clamp(3 + rk() * 12, 3, 18), color: [0.80, 0.75, 0.66, 0.95], kind: 1, light: sun });
        }
        R.drawSprites(rocks, M.vp, W, H);
      }
      var latS = (surf.lat >= 0 ? TR('北纬 ') : TR('南纬 ')) + fmt(Math.abs(surf.lat / DEG), 2) + '° ' + (surf.lon >= 0 ? TR('东经 ') : TR('西经 ')) + fmt(Math.abs(surf.lon / DEG), 2) + '°';
      var where = surf.under ? TR('视点在海面以下 ') + fmt(-surf.alt, 0) + ' m' : (surf.alt < 50 ? TR('地表视角 · 高度 ') + fmt(surf.alt, 1) + ' m' : TR('高度 ') + fmtKm(surf.alt));
      if (surf.terrainType) where += TR(' · 正在飞越：') + TR(surf.terrainType) + (surf.tempC != null ? TR(' · 气温约 ') + fmt(surf.tempC, 0) + ' ℃' : '') + (surf.cruise ? TR(' · 自动巡航（任意按键接管）') : '');
      var extra = surf.under && p.type === 'earth' && vp.ageGyr < 1.5 ? TR('生命，刚出现的生命。') : (surf.under ? '' : (surf.water ? TR('海面') : TR('陆地 ') + fmt(surf.terrainM, 0) + ' m'));
      var cityLine = null; if (near && near.length && vp.lights > 0.01) { var c0 = near[0]; cityLine = TR('最近城市：') + TR(c0.city.name) + (c0.city.nameEn && c0.city.nameEn !== c0.city.name ? TR('（') + c0.city.nameEn + TR('）') : '') + ' ' + fmtKm(c0.dist) + TR('，人口约 ') + (c0.city.pop >= 1e6 ? fmt(c0.city.pop / 1e6, 1) + TR(' 百万') : fmt(c0.city.pop / 1e4, 0) + TR(' 万')) + ' · ' + (g.cities && g.cities.real ? TR('城市位置：Natural Earth（真实）；建筑为示意') : TR('城市与建筑均为过程生成示意')); }
      S.caption = (p.isSmallBody || p.isRogue ? TRN(p.name) + ' · ' + TR(p.pclassCn || '流浪行星') : TRN(p.name) + ' · ' + TR(vp.eraName)) + ' · ' + where + ' · ' + latS + (p.isSmallBody || p.isRogue ? '' : (extra ? ' · ' + extra : ''));
      var hudLines = [S.caption];
      if (p.isSmallBody) {
        var jumpM = surf.terrainM != null ? 0 : 0, vJump = 3.0;   // 人跳起的初速取 3 m/s（地球上约 0.46 m 高）
        var hJump = vJump * vJump / (2 * Math.max(p.gravityMS2, 1e-9));
        hudLines.push(TR('地表：') + TR(surf.terrainType || '') + TR(' · 相对基准面 ') + fmt(surf.terrainM, 0) + TR(' m · 表面重力 ') + p.gravityMS2 + TR(' m/s²（地球的 ') + p.gravityRel.toExponential(1) + TR(' 倍）· 逃逸速度 ') + (p.escapeMS < 100 ? fmt(p.escapeMS, 1) + ' m/s' : fmt(p.escapeMS / 1000, 2) + ' km/s') + TR('：以 3 m/s 起跳能升到 ') + (hJump > p.radiusM ? TR('……直接飞走（初速已超过逃逸速度）') : hJump > 1000 ? fmt(hJump / 1000, 1) + TR(' km 高') : fmt(hJump, 0) + TR(' m 高')) + TR('，落回来要 ') + fmt(2 * vJump / Math.max(p.gravityMS2, 1e-9) / 60, 1) + TR(' 分钟。'));
        hudLines.push(TR('没有大气：天空永远是黑的、星星白天也在，') + (p.isComet ? TR('恒星') : TR('恒星')) + TR('只是一个视半径约 ') + fmt(sunAngOf(p) / DEG * 60, 1) + TR(' 角分的刺眼亮点（地球上看太阳是 32 角分）；没有风化、没有声音，昼夜温差全靠辐射平衡。地平线只有 ') + fmtKm(Math.sqrt(Math.max(2 * Rm * Math.max(surf.alt, 1), 1))) + TR(' 远——这颗天体半径只有 ') + fmt(p.radiusKm, p.radiusKm < 20 ? 2 : 0) + ' km。');
        if (p.isAsteroid) hudLines.push(TR('天上的其它小天体为示意：主带真实平均间距在 10⁶ km 量级，肉眼看不到邻居；这里按碰撞族（Hirayama 1918）与双小行星（Margot et al. 2002：近地小行星约 15% 是双星）压缩显示。地表为过程生成（示意），') + (p.real ? TR('半径/密度/反照率/自转为实测。') : TR('依据见星球视图。')));
        if (p.isComet) { var cs2 = cometStateAt(p, S.timeYr); hudLines.push(TR('彗核表面：日心距 ') + fmt(cs2.rAU, 2) + TR(' AU，活动度 ') + Math.round(cs2.activity * 100) + TR('%。') + (cs2.activity > 0.1 ? TR('脚下的冰正在升华，尘埃被气流带着离开——这也是彗核每过一次近日点就轻一点的原因。') : TR('此刻它是休眠的：温度太低，冰不升华，只剩一层被太阳晒黑的尘壳。')) + TR('形状与地形为示意，密度/反照率/双瓣结构取 Rosetta 的 67P。')); }
        hudLines.push(TR('注意：不规则形状只在星球视图的剪影上体现；地表飞越用的是局部球面近似（示意）。'));
      }
      if (p.isRogue) hudLines.push(TR('照明：没有宿主恒星，唯一光源是整个天空的星光。画面亮度为示意（只为看清地形轮廓），真实景象接近全黑；表面温度 ') + p.tempK + TR(' K 全部来自内部余热与放射性衰变。依据：') + (p.ref || 'Sumi 2011 / Mróz 2017'));
      else if (dark) hudLines.push(darkHostNote(p));
      if (cityLine) hudLines.push(cityLine);
      hudLines.push(TR('滚轮 = 高度 · WASD/方向键 平移 · 拖动 视角 · Shift 加速 · 双击 下潜到该处 · Esc 返回') + (p.isSmallBody || p.isRogue ? TR('天体视图') : TR('星球'))); drawHud(hudLines);
    }

    // 10 个监听全部具名并在这里摘干净（漏一个，每次进出镜像就叠一套，是卡顿的来源之一）
    function dispose(o) {
      if (disposed) return; disposed = true; cancelAnimationFrame(raf); raf = 0; if (watchdog) { clearInterval(watchdog); watchdog = 0; }
      // 画布已经脱离文档 = 不会再被复用，这时才丢弃 GL 上下文（否则同一画布上重建视图会拿到一个已丢失的上下文）
      var lose = o && o.loseContext != null ? !!o.loseContext : (canvas && canvas.isConnected === false);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onPtrCancel);
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('keyup', onKey); canvas.removeEventListener('blur', onBlur);
      canvas.removeEventListener('contextmenu', onCtxMenu);
      canvas.removeEventListener('webglcontextlost', onCtxLost); canvas.removeEventListener('webglcontextrestored', onCtxRestored);
      if (R) R.dispose({ loseContext: lose }); R = null;
      if (fallback) fallback.dispose(); fallback = null;
      if (fbCanvas && fbCanvas.parentNode) { try { fbCanvas.parentNode.removeChild(fbCanvas); } catch (e) { /* ignore */ } } fbCanvas = null;
      listeners = {}; gl = null;
      if (createView.last === view) createView.last = null;
      if (root && root.__MirrorPlanetsViews) { var vs = root.__MirrorPlanetsViews, ix = vs.indexOf(view); if (ix >= 0) vs.splice(ix, 1); }   // 全局注册表不能只增不删
    }
    raf = requestAnimationFrame(frame);
    /* rAF 看门狗：宿主页面里 rAF 可能长时间不回调（画布刚从 hidden 变可见、别的循环接管、浏览器降频）。
       那样 orbitDemo 的积分会一直停在 0 T₀、画布也一直空着。页面可见时用定时器补帧兜底（隐藏时不跑，不烧后台 CPU）。 */
    if (typeof setInterval === 'function') watchdog = setInterval(function () {
      if (disposed) return;
      if (typeof document === 'object' && document && document.visibilityState === 'hidden') return;
      var t = nowMs(); if (t - lastFrameAt > 400) paintNow();
    }, 250);
    var view = { showSystem: showSystem, showGlobe: showGlobe, land: land, setTime: setTime, setAltitude: setAltitude, getState: getState, on: on, resize: resize, dispose: dispose, visitNext: visitNext, goUp: goUp, enterSelected: enterSelected, select: function (i) { S.selected = i; }, get webgl() { return S.webgl; }, canvas: canvas,
      renderNow: function () { frameOnce(performance.now()); return view; },
      /* 验证钩子：渲染器自己那条 CPU 高度路径。结果只取决于 (lat, lon) 与行星，
         与相机位置/高度/LOD/帧无关——同一经纬从任何视点采样必须逐位相同。 */
      groundAt: function (latDeg, lonDeg) {
        if (!S.planet || !S.vp) return null;
        if (S.vp.gas) return { noSurface: true, oneBarRefM: 0, oct: null };
        var g = R ? R.planetGPU(S.planet, S.vp) : null, maps = g ? g.maps : getMaps(S.planet, fallback ? 256 : 512);
        var t = terrainMetersAt(maps, S.vp, latDeg * DEG, lonDeg * DEG, surfOct());
        return { m: t.m, water: t.water, oct: surfOct(), normEpsM: normEpsOf(S.vp), rangeM: S.vp.rangeM };
      },
      // 验证钩子：同步渲染当前帧并导出 PNG（默认 POST 到同源 /__save，由 本地静态服务器 写入 research/shots/；也可只取 dataUrl）
      exportPNG: function (name, o) { o = o || {}; frameOnce(performance.now()); var dataUrl; try { dataUrl = canvas.toDataURL('image/png'); } catch (e) { return Promise.reject(e); }
        if (o.dataUrlOnly || !name) return Promise.resolve({ dataUrl: dataUrl, w: W, h: H });
        if (typeof fetch !== 'function') return Promise.resolve({ dataUrl: dataUrl, w: W, h: H, saved: false });
        return fetch(o.url || '/__save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, dataUrl: dataUrl }) }).then(function (r) { return r.json(); }).then(function (j) { j.w = W; j.h = H; return j; }); },
      // 着色器就绪情况：宿主进层时若未就绪可以先画骨架，就绪了再切（见 mirror.js 的 ensurePV）
      shadersPending: function () { return R && R.progsPending ? R.progsPending() : 0; },
      /* 某个着色器程序收货没有。宿主/验收脚本用它判断「还在用占位图吗」。 */
      shaderReady: function (n) { return !!(R && R.ready && R.ready(n)); },
      warmShaders: function (n) { if (R && R.pump) R.pump(n || 4); return R && R.progsPending ? R.progsPending() : 0; },
      createMs: function () { return pvCreateMs; },
      setTimeScale: function (m) { setSpeedMul(m); return view; }, getTimeScale: function () { return { mul: speedMul, yrPerSec: orbitSpeed }; },
      // 卫星（放大示意）开关：恒星系视图里给所有行星都画卫星，globe 视图里的卫星始终画
      setShowMoons: function (b) { showMoons = b !== false; return view; }, getShowMoons: function () { return showMoons; },
      enterMoon: enterMoon, moonBodies: function (p) { return moonsOfPlanet(p || S.planet); }, nextSibling: function () { return stepSibling(1); }, prevSibling: function () { return stepSibling(-1); },
      /* 小天体 / 恒星：与卫星同一套机制。列表方法给面板用，enterXxx 进入，getState().bodyKind 说明当前在哪一类天体上。 */
      beltBodies: function (sys) { return beltBodiesOf(sys || S.system); }, enterAsteroid: enterAsteroid,
      cometBodies: function (sys) { return cometBodiesOf(sys || S.system); }, enterComet: enterComet, cometStateAt: function (c, t) { return cometStateAt(c || S.planet, t != null ? t : S.timeYr); },
      rogueBodies: function (sys) { return rogueBodiesOf(sys || S.system); }, enterRogue: enterRogue,
      starBody: function (sys, st) { return starBody(sys || S.system, st); }, enterStar: function (o) { return showStar((o && o.star) || null, o || {}); }, showStar: showStar,
      // 一个恒星系里所有「可进入的非行星天体」的清单（供信息面板直接渲染成按钮）
      smallBodies: function (sys) {
        var s = sys || S.system; if (!s) return null;
        return { belts: beltBodiesOf(s), comets: cometBodiesOf(s), rogues: rogueBodiesOf(s), star: starBody(s, s.star),
          note: TR('小行星/柯伊伯带天体按 Dohnanyi 1969 的尺寸分布取代表天体（太阳系用实测天体）；彗星轨道要素按 system.comets 的量级抽；流浪行星来自 system.rogues（Sumi 2011 / Mróz 2017）。恒星只能近观、不可降落。') };
      },
      // 卫星表（供信息面板直接用）：名称 / 半径 / 轨道半径 / 周期 / 类型 / 是否潮汐加热
      moonsOf: function (planet) {
        var p = planet || S.planet; if (!p) return null;
        return { count: p.moonCount != null ? p.moonCount : (p.moons ? p.moons.length : 0), rings: !!(p.visual && p.visual.rings),
          listed: (p.moons || []).map(function (m) { return { name: TRN(m.name), radiusKm: Math.round((m.radiusRel || 0) * EARTH_R_M / 1000), orbitKm: m.orbitKm, periodDays: m.periodDays, type: m.type || 'rock', tidalHeated: !!m.tidalHeated,
            note: m.tidalHeated ? TR('受潮汐加热：冰壳下可能有液态水海洋（木卫二/土卫二类比，示意）') : (m.note || null) }; }) };
      },
      showThreeBody: showThreeBody, exitThreeBody: exitThreeBody, getThreeBodyState: function () { return tb ? { t: tb.st.t / tb.Tchar, energyErr: Math.abs((nbodyEnergy(tb.st, 1) - tb.E0) / tb.E0), ejected: tb.ejected, events: tb.events, seed: tb.seed } : null; }, getStarPositions: function () { return sysNB ? sysNB.st.pos.map(function (p) { return p.slice(); }) : null; },
      setPerturbation: function (eps) { if (S.system && S.system.dimMode === 'orbitDemo') demo = initOrbitDemo(demo ? demo.D : S.system.dim, eps, S.system.seed); return view; },
      setDemoDim: function (D) { if (S.system && S.system.dimMode === 'orbitDemo') demo = initOrbitDemo(D, demo ? demo.eps : 0.01, S.system.seed); return view; },
      resetDemo: function () { if (demo) demo = initOrbitDemo(demo.D, demo.eps, demo.seed); return view; },
      stepDemo: function (periods) { if (!demo && S.system && S.system.dimMode === 'orbitDemo') demo = initOrbitDemo(S.system.dim, 0.01, S.system.seed); if (demo) stepOrbitDemo(demo, (periods || 1) * TAU); return view; },
      getDemoState: function () { if (!demo && S.system && S.system.dimMode === 'orbitDemo') demo = initOrbitDemo(S.system.dim, 0.01, S.system.seed); return demo ? { D: demo.D, eps: demo.eps, t: demo.t / TAU, planets: demo.planets.map(function (p) { return { name: p.name, status: p.status, statusText: (p.status === '逃逸' ? TR('逃逸') : p.status === '坠入' ? TR('坠入核') : p.r > 1 ? TR('核外自由漂移（几乎不受力）') : TR('核内·尚未失稳')), periods: +Math.abs(p.periods).toFixed(2), r: +p.r.toFixed(3), r0: p.r0, precDegPerOrbit: p.precN ? +(p.precAcc / p.precN).toFixed(2) : null, periCount: p.peri.length, outFrac: +((p.outFrac || 0)).toFixed(3), outFracMax: +((p.outMax || 0)).toFixed(3) }; }) } : null; },
      // 调试/验证：同步渲染一帧并统计像素颜色占比（蓝/绿/白/暗/棕灰），供自动化检查
      samplePixels: function (stride) { frameOnce(performance.now()); if (!gl || !R) return null; stride = stride || 8; var w = W, h = H, buf = new Uint8Array(w * h * 4); try { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); } catch (e) { return null; }
        var st = { total: 0, blue: 0, green: 0, white: 0, dark: 0, brown: 0, grey: 0, other: 0, topBlue: 0, topN: 0, botN: 0, botLumSum: 0, botLumSq: 0 }; var lumSum = 0, lumSq = 0;
        for (var y = 0; y < h; y += stride) for (var x = 0; x < w; x += stride) { var i = (y * w + x) * 4, r = buf[i], g = buf[i + 1], b = buf[i + 2]; st.total++; var L = 0.299 * r + 0.587 * g + 0.114 * b; lumSum += L; lumSq += L * L; var top = y > h * 0.66; /* readPixels 行 0 在底部 */ if (top) st.topN++; else { st.botN++; st.botLumSum += L; st.botLumSq += L * L; }
          if (r < 25 && g < 25 && b < 25) st.dark++; else if (b > 90 && b > r + 30 && b >= g) { st.blue++; if (top) st.topBlue++; } else if (g > 70 && g > r + 12 && g > b + 12) st.green++; else if (r > 190 && g > 190 && b > 190) st.white++; else if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 60 && r < 190) st.grey++; else if (r >= g && g >= b && r > 60 && r - b < 90) st.brown++; else st.other++; }
        ['blue', 'green', 'white', 'dark', 'brown', 'grey', 'other'].forEach(function (k) { st[k + 'Pct'] = +(st[k] / st.total * 100).toFixed(1); });
        st.topBluePct = +(st.topBlue / Math.max(1, st.topN) * 100).toFixed(1); st.lumMean = +(lumSum / st.total).toFixed(1); st.lumStd = +Math.sqrt(Math.max(0, lumSq / st.total - Math.pow(lumSum / st.total, 2))).toFixed(1);
        var bm = st.botLumSum / Math.max(1, st.botN); st.groundLumStd = +Math.sqrt(Math.max(0, st.botLumSq / Math.max(1, st.botN) - bm * bm)).toFixed(1); st.groundLumMean = +bm.toFixed(1); delete st.botLumSum; delete st.botLumSq; delete st.topBlue; delete st.topN; delete st.botN;
        var t0 = performance.now(); frameOnce(performance.now()); gl.finish(); st.frameMs = +(performance.now() - t0).toFixed(1); return st; },
      _debug: function () { return { sun: S.mode === 'surface' ? surfaceSun() : globeSunDir(), spin: globeCam.spin, surf: surf, globeCam: globeCam, sysCam: sysCam, vp: S.vp }; } };
    createView.last = view; if (root && typeof root === 'object') { try { (root.__MirrorPlanetsViews = root.__MirrorPlanetsViews || []).push(view); } catch (e) { /* ignore */ } }
    return view;
  }

  /* ============================================================ Canvas 2D 最低回退（WebGL2 不可用/上下文丢失时） */
  function createFallback2D(canvas) {
    var ctx = null; try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    var S = null, X = {}, globeImg = null, globeKey = '', caption = '';
    function surfColor(vp, f, lat, ndl) {
      var h = f.h, land = vp.sea < 0 || h >= vp.sea, c;
      if (land) { var elev = vp.sea < 0 ? h : (h - vp.sea) / (1 - vp.sea); var stops = palStopsOf(vp); c = gradAt(stops, elev);
        var veg = vp.green * smoothstep(0.2, 0.6, f.moist) * (1 - smoothstep(0.35, 0.85, Math.abs(lat) / (PI / 2))) * (1 - smoothstep(0.3, 0.75, elev)); c = mix3(c, vp.veg0, veg);
        if (Math.abs(lat) / (PI / 2) + elev * 0.12 * vp.iceHeight > vp.iceLat) c = vp.iceColor; if (vp.lava > 0) c = mix3(c, [0.4, 0.15, 0.08], vp.lava * 0.6); }
      else { var depth = clamp((vp.sea - h) / Math.max(vp.sea, 1e-4), 0, 1); c = vp.lavaSea > 0.5 ? [0.9, 0.35, 0.08] : mix3(vp.oceanShallow, vp.oceanDeep, Math.pow(depth, 0.45)); }
      if (vp.fog > 0) c = mix3(c, vp.fogColor, vp.fog * 0.7);
      var l = Math.max(ndl, 0) * 0.95 + 0.05; return [c[0] * l, c[1] * l, c[2] * l];
    }
    function drawSystem(W, H) {
      var sys = S.system, cam = X.sysCam, age = (S.timeYr - sys.star.formedYr) / 1e9, cx = W / 2, cy = H / 2, sc = Math.min(W, H) * 0.42 / cam.fit * cam.fit / cam.dist * 2.2, tilt = Math.sin(cam.tilt);
      function mapR(au) { return Math.pow(Math.max(au, 1e-4), 0.55); }
      function proj(x, z) { var c = Math.cos(cam.yaw), s = Math.sin(cam.yaw); var xr = x * c - z * s, zr = x * s + z * c; return [cx + xr * sc, cy + zr * sc * tilt]; }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      var starCol = sys.star.color, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40); g.addColorStop(0, '#ffffff'); g.addColorStop(0.2, starCol); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 40, 0, TAU); ctx.fill();
      var dust = age < 0 ? 0 : 1 - smoothstep((sys.ringEndGyr || 0.2) * 0.45, sys.ringEndGyr || 0.2, age);
      if (dust > 0.01) { var maxAU = 1; sys.planets.forEach(function (p) { maxAU = Math.max(maxAU, p.orbitAU); }); ctx.save(); ctx.translate(cx, cy); ctx.scale(1, tilt); ctx.rotate(0); var rg = ctx.createRadialGradient(0, 0, mapR(0.06) * sc, 0, 0, mapR(maxAU * 1.15) * sc); rg.addColorStop(0, 'rgba(120,110,100,0)'); rg.addColorStop(0.35, 'rgba(120,110,100,' + (0.35 * dust).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(120,110,100,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, mapR(maxAU * 1.15) * sc, 0, TAU); ctx.fill(); ctx.restore(); }
      X.pp = [];
      sys.planets.forEach(function (p, i) {
        var born = smoothstep(p.timeline.formGyr, p.timeline.formGyr + 0.15, age); if (born <= 0) return;
        var rm = mapR(p.orbitAU); ctx.strokeStyle = 'rgba(255,255,255,' + (i === S.selected ? 0.5 : 0.15) + ')'; ctx.lineWidth = 1; ctx.beginPath(); for (var k = 0; k <= 96; k++) { var a = k / 96 * TAU, q = proj(rm * Math.cos(a), -rm * Math.sin(a)); if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } ctx.stroke();
        var ang = TAU * (X.animYr / p.periodYr) + (p.phase || 0), q2 = proj(rm * Math.cos(ang), -rm * Math.sin(ang)), px = clamp(3 + 3 * Math.log2(1 + p.radiusRel), 2.5, 30);
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(q2[0], q2[1], px, 0, TAU); ctx.fill(); if (i === S.selected) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(q2[0], q2[1], px + 5, 0, TAU); ctx.stroke(); }
        ctx.fillStyle = '#ccc'; ctx.font = '12px sans-serif'; ctx.fillText(TRN(p.name), q2[0] + px + 5, q2[1] + 4); X.pp[i] = { sx: q2[0], sy: q2[1], px: px };
      });
      caption = TRN(sys.name) + TR(' · Canvas 2D 回退 · ') + (dust > 0.02 ? TR('尘埃环') : TR('恒星系年龄 ') + fmtYr(age * 1e9));
    }
    function drawGlobe(W, H) {
      var p = S.planet, vp = S.vp, cam = X.globeCam, maps = getMaps(p, 256), D = 200, key = p.seed + ':' + Math.round(cam.spin * 20) + ':' + Math.round(S.timeYr / 1e7) + ':' + Math.round(cam.yaw * 10) + ':' + Math.round(cam.pitch * 10);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (key !== globeKey) { globeKey = key; globeImg = ctx.createImageData(D, D); var d = globeImg.data, sunW = [Math.cos(cam.yaw - 0.7), 0.3, Math.sin(cam.yaw - 0.7)];
        var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), ct = Math.cos((p.tilt || 0) * DEG), st = Math.sin((p.tilt || 0) * DEG), cs = Math.cos(cam.spin), ss = Math.sin(cam.spin);
        for (var y = 0; y < D; y++) for (var x = 0; x < D; x++) { var u = (x + 0.5) / D * 2 - 1, v = 1 - (y + 0.5) / D * 2, r2 = u * u + v * v, o = (y * D + x) * 4; if (r2 > 1) { d[o + 3] = 0; continue; }
          var z = Math.sqrt(1 - r2); // 视图空间法线：x 右 y 上 z 朝相机
          // 相机方向 (yaw,pitch) → 世界；这里直接把视图法线旋转到世界
          var wx = u * (-sy) + z * (cy * cp) - v * (cy * sp) * 0, wy = v * cp + z * sp, wz = u * cy + z * (sy * cp);
          wx = u * (-sy) - v * (sp * cy) + z * (cp * cy); wz = u * cy - v * (sp * sy) + z * (cp * sy); wy = v * cp + z * sp;
          var ox = ct * wx + st * wy, oy = -st * wx + ct * wy, oz = wz; // 逆倾斜
          var px = cs * ox - ss * oz, pz = ss * ox + cs * oz; // 逆自转
          var n = [px, oy, pz], f = fieldAtCPU(maps, vp, n, 2), lat = Math.asin(clamp(oy, -1, 1)), ndl = wx * sunW[0] + wy * sunW[1] + wz * sunW[2];
          // 气巨的 2D 回退：饱和度/明度同样取自云顶分类（gasSat/gasLight 缺省时退回旧的 0.4 / 0.5±0.15）
          var gS = vp.gasSat != null ? vp.gasSat : 0.4, gL = vp.gasLight != null ? vp.gasLight - (vp.gasContrast || 0.3) * 0.5 : 0.5, gC = vp.gasContrast != null ? vp.gasContrast * 0.5 : 0.15;
          var c = vp.gas ? mix3(hsl(vp.hue, gS, clamp(gL + gC * Math.sin(oy * 18), 0.02, 0.97)), [1, 1, 1], 0.2) : surfColor(vp, f, lat, ndl); if (vp.gas) { var l = Math.max(ndl, 0) * 0.9 + 0.1; c = [c[0] * l, c[1] * l, c[2] * l]; }
          if (vp.gas && (vp.tholin || 0) > 0) c = mix3(c, v3scale(vp.tholinColor, Math.max(ndl, 0) * 0.9 + 0.1), clamp(vp.tholin * 0.85, 0, 0.9));
          var tnt = vp.sunTint || [1, 1, 1]; c = [clamp(c[0] * tnt[0], 0, 1), clamp(c[1] * tnt[1], 0, 1), clamp(c[2] * tnt[2], 0, 1)];   // 照明色温
          var rim = Math.pow(1 - z, 3) * vp.atmDensity; c = mix3(c, vp.atm, rim * 0.6);
          d[o] = c[0] * 255; d[o + 1] = c[1] * 255; d[o + 2] = c[2] * 255; d[o + 3] = 255; } }
      var size = Math.min(W, H) * 0.9 / cam.dist * 1.6, cv = makeCanvas(D, D); cv.getContext('2d').putImageData(globeImg, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(cv, W / 2 - size / 2, H / 2 - size / 2, size, size);
      caption = TRN(p.name) + ' · ' + TR(vp.eraName) + TR(' · Canvas 2D 回退');
    }
    // 气态/冰巨星的 2D 回退：同样不能画地面 —— 只有一层层的云带与越来越浓的霾，没有地平线
    function drawGasFallback(W, H) {
      var p = S.planet, vp = S.vp, sf = X.surf, Hs = vp.scaleHeightM || 20000, camZ = sf.alt;
      var bi = gasBandAt(vp, p.seed, clamp(Math.sin(sf.lat) * 0.5 + 0.5, 0, 1)), haze = mix3(bi.c, [1, 1, 1], 0.3);
      var deep = clamp(-camZ / Math.max(Hs * 3.5, 1), 0, 1), lum = 1 - deep * 0.74;
      var g0 = ctx.createLinearGradient(0, 0, 0, H);
      g0.addColorStop(0, hex(v3scale(haze, 0.55 * lum))); g0.addColorStop(0.42, hex(v3scale(haze, 0.95 * lum))); g0.addColorStop(1, hex(v3scale(haze, 0.6 * lum)));
      ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
      for (var i = 0; i < 9; i++) {   // 云带：越靠近视平线越窄（透视），软边、不留硬线
        var t = i / 8, y = H * (0.5 + 0.5 * Math.pow(t, 1.8)), hgt = H * 0.02 * (0.4 + t * 2.6);
        var b2 = gasBandAt(vp, p.seed, clamp(Math.sin(sf.lat) * 0.5 + 0.5 + (t - 0.4) * 0.05, 0, 1));
        var gb = ctx.createLinearGradient(0, y - hgt, 0, y + hgt);
        gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(0.5, hex(v3scale(mix3(b2.c, haze, 0.35), lum))); gb.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.55 * (1 - t * 0.6); ctx.fillStyle = gb; ctx.fillRect(0, y - hgt, W, hgt * 2);
      }
      ctx.globalAlpha = 1;
      caption = TRN(p.name) + ' · ' + (vp.gasIce ? TR('冰巨星') : TR('气态巨行星')) + ' · ' + (sf.alt >= 0 ? TR('高度（1 bar 参考面以上）') + fmtKm(sf.alt) : TR('1 bar 参考面以下 ') + fmtKm(-sf.alt)) + TR(' · 没有固体表面 · Canvas 2D 回退');
    }
    function drawSurface(W, H) { // 体素空间式高度图光线步进
      var p = S.planet, vp = S.vp, sf = X.surf, maps, Rm = vp.radiusM, cols = 240, rows = 135, cw = W / cols, ch = H / rows;
      if (vp.gas) return drawGasFallback(W, H);
      maps = getMaps(p, 256);
      var camZ = sf.groundZ + sf.alt, basis = localBasis(sf.lat, sf.lon), sun = 0.6, sky = mix3(v3scale(vp.atm, 1.1), vp.fogColor, vp.fog);
      var grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, hex(v3scale(vp.atm, 0.45 * clamp(vp.atmDensity, 0, 1)))); grd.addColorStop(1, hex(v3scale(sky, clamp(vp.atmDensity, 0, 1)))); ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
      var fovH = 55 * DEG, hd = sf.heading, pt = sf.pitch, maxDist = clamp(2 * Math.sqrt(2 * Rm * Math.max(sf.alt, 5)) + 5000, 8000, 3e6), steps = 90;
      var ybuf = new Float32Array(cols); for (var i = 0; i < cols; i++) ybuf[i] = H;
      for (var s = 0; s < steps; s++) { var t0 = s / steps, dist = 20 + Math.pow(t0, 2.6) * maxDist; if (s === 0) continue;
        for (var c = 0; c < cols; c++) { var ang = hd + ((c + 0.5) / cols - 0.5) * fovH, dx = Math.sin(ang) * dist, dy = Math.cos(ang) * dist;
          var a = dist / Rm, dir = v3norm(v3add(v3scale(basis.east, dx / dist), v3scale(basis.north, dy / dist))), n = v3add(v3scale(basis.up, Math.cos(a)), v3scale(dir, Math.sin(a)));
          var f = fieldAtCPU(maps, vp, n, 3), hm = (f.h - hRefOf(vp)) * vp.rangeM, drop = -dist * dist / (2 * Rm), water = vp.sea >= 0 && hm < 0; if (water) hm = 0;
          var zRel = hm + drop - camZ, elev = Math.atan2(zRel, dist) - pt, sy = H / 2 - elev / (fovH * H / W) * H;
          if (sy < ybuf[c]) { var lat = Math.asin(clamp(n[1], -1, 1)), col = water ? mix3(vp.oceanShallow, vp.oceanDeep, 0.5) : surfColor(vp, f, lat, 1)[0] !== undefined ? surfColor(vp, f, lat, 0.7) : [0.5, 0.5, 0.5];
            var fog = 1 - Math.exp(-dist / (vp.atmDensity > 0.02 ? 140000 / vp.atmDensity * (1 - vp.fog * 0.9) : 5e7)); col = mix3(col, sky, fog);
            ctx.fillStyle = hex(col); ctx.fillRect(c * cw, sy, cw + 0.5, ybuf[c] - sy + 0.5); ybuf[c] = sy; } } }
      caption = TRN(p.name) + TR(' · 高度 ') + fmtKm(sf.alt) + TR(' · Canvas 2D 回退');
    }
    return {
      setState: function (s, x) { S = s; for (var k in x) X[k] = x[k]; },
      draw: function () { if (!ctx || !S) return; var W = canvas.width, H = canvas.height; ctx.setTransform(1, 0, 0, 1, 0, 0);
        try { if (S.mode === 'system' && S.system) drawSystem(W, H); else if (S.mode === 'globe' && S.planet) drawGlobe(W, H); else if (S.mode === 'surface' && S.planet) drawSurface(W, H); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); } } catch (e) { console.error('[MirrorPlanets] 2D 回退渲染错误：', e); }
        ctx.fillStyle = 'rgba(230,230,230,0.9)'; ctx.font = (13 * (X.dpr || 1)) + 'px sans-serif'; ctx.fillText(caption, 14 * (X.dpr || 1), H - 14 * (X.dpr || 1)); this.caption = caption; },
      dispose: function () { S = null; }, caption: ''
    };
  }

  /* ============================================================ 液体大洋宇宙：木星大小、自转、山脉出入水、半圆彩虹环 */
  var SH_OCEAN_V = GLSL_HEAD + 'layout(location=0) in vec2 aPos; uniform mat4 uVP; uniform float uSize; out vec3 vW; void main(){ vec3 w=vec3(aPos.x*uSize,0.0,aPos.y*uSize); vW=w; gl_Position=uVP*vec4(w,1.0); }';
  var SH_OCEAN_F = GLSL_HEAD + GLSL_NOISE + '\n' + [
    'in vec3 vW; uniform vec3 uCam, uSun; uniform float uTime; out vec4 fragColor;',
    'void main(){ vec3 V=normalize(uCam-vW); float d=length(uCam-vW);',
    '  vec3 n=normalize(vec3(snoise(vec3(vW.x*0.35, uTime*0.25, vW.z*0.35))*0.08, 1.0, snoise(vec3(vW.z*0.3+7.0, uTime*0.2, vW.x*0.3))*0.08));',
    '  float fres=pow(1.0-max(dot(n,V),0.0),3.0); vec3 base=vec3(0.62,0.66,0.72), deep=vec3(0.28,0.3,0.36); vec3 col=mix(deep, base, fres*0.7+0.3);',
    '  vec3 H=normalize(uSun+V); col+=vec3(1.0,0.97,0.9)*pow(max(dot(n,H),0.0),200.0)*1.2;',
    '  float ripple=0.5+0.5*snoise(vec3(vW.x*1.2, uTime*0.4, vW.z*1.2)); col*=0.9+0.2*ripple;',
    '  float fog=1.0-exp(-d/120.0); col=mix(col, vec3(0.02,0.02,0.03), fog); fragColor=vec4(col,1.0); }'
  ].join('\n');
  var SH_RIBBON_V = GLSL_HEAD + 'layout(location=0) in vec2 aRT; uniform mat4 uVP, uModel; uniform float uRad, uWidth; out vec2 vRT; void main(){ float a=aRT.y*3.14159265; float r=uRad+(aRT.x-0.5)*uWidth; vec3 o=vec3(cos(a)*r, sin(a)*r, 0.0); vRT=aRT; gl_Position=uVP*uModel*vec4(o,1.0); }';
  var SH_RIBBON_F = GLSL_HEAD + [
    'in vec2 vRT; uniform float uAlpha; out vec4 fragColor;',
    'vec3 hue(float h){ vec3 p=abs(fract(vec3(h)+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0); return clamp(p-1.0,0.0,1.0); }',
    'void main(){ float e=smoothstep(0.0,0.12,vRT.x)*smoothstep(1.0,0.88,vRT.x); float ends=smoothstep(0.0,0.06,vRT.y)*smoothstep(1.0,0.94,vRT.y); vec3 c=hue(vRT.x*0.85); float a=e*ends*uAlpha; fragColor=vec4(c*a,a); }'
  ].join('\n');
  function renderOceanWorld(canvas, seed, opts) {
    opts = opts || {}; seed = (seed == null ? 2 : seed) >>> 0;
    var target = canvas, gl = getGL(canvas), offscreen = false;
    if (!gl) { // 目标画布已被 2D 占用或不支持：用离屏 WebGL 画布，调用方 drawImage(handle.canvas)
      var oc = makeCanvas(canvas.width || 640, canvas.height || 360); gl = oc ? getGL(oc) : null; if (gl) { target = oc; offscreen = true; }
    }
    var handle = { canvas: target, offscreen: offscreen, webgl: !!gl, render: function () {}, start: function () {}, stop: function () {}, dispose: function () {}, setSize: function () {} };
    if (!gl) { // 最低回退：静态 2D 图
      var c2 = canvas.getContext && canvas.getContext('2d'); handle.render = function () { if (!c2) return; var W = canvas.width, H = canvas.height; c2.fillStyle = '#000'; c2.fillRect(0, 0, W, H); c2.fillStyle = '#7f8590'; c2.fillRect(0, H * 0.55, W, H * 0.45); c2.fillStyle = '#b08050'; c2.beginPath(); c2.arc(W * 0.6, H * 0.5, H * 0.3, PI, 0); c2.fill(); };
      handle.render(); return handle;
    }
    var R;
    try { R = new GLR(gl); } catch (e) { console.warn('[MirrorPlanets] 大洋世界渲染器初始化失败：', e && e.message); return handle; }
    var prog = {};
    function compile(name, vs, fs) { var g = gl, p = g.createProgram(); function sh(t, s) { var o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; } g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p); var u = {}, n = g.getProgramParameter(p, g.ACTIVE_UNIFORMS); for (var i = 0; i < n; i++) { var inf = g.getActiveUniform(p, i); u[inf.name] = { loc: g.getUniformLocation(p, inf.name), type: inf.type }; } R.progs[name] = { p: p, u: u }; }
    compile('ocean', SH_OCEAN_V, SH_OCEAN_F); compile('ribbon', SH_RIBBON_V, SH_RIBBON_F);
    // 星球：岩质大陆 + 深水，海平面 0.5，强夸张地形，让山脉随自转出入水
    var planet = { seed: seed, type: 'rock', visualKey: 'oceanworld', radiusRel: 11, radiusM: 11 * EARTH_R_M, name: '漂浮的星球', tilt: 62, visual: baseVisual('rock'), timeline: { formGyr: 0, oceanGyr: 0, greenGyr: Infinity, civGyr: Infinity }, starFormedYr: 0, nowYr: 5e9, life: null };
    planet.visual.sea = 0.5; planet.visual.rangeM = 11 * EARTH_R_M * 0.35; planet.visual.palette = 'desert'; planet.visual.atmDensity = 0.35; planet.visual.atm = [0.8, 0.75, 0.7]; planet.visual.cloud = 0.12; planet.visual.detailAmp = 0.03; planet.visual.craters = 0; planet.visual.oceanShallow = [0.6, 0.64, 0.7]; planet.visual.oceanDeep = [0.36, 0.39, 0.46]; planet.visual.iceLat = 2; planet.visual.iceHeight = 0.3;
    var vp = visualParams(planet, 5e9); vp.spec = 0.8;
    var g = R.planetGPU(planet, vp, 512);
    var raf = 0, running = false, t0 = null, hue = mulberry32(seed)() * 360;
    var pal = buildPalette(planet, vp); // 重新着色：略带该宇宙的色相
    var pc = hsl(hue, 0.35, 0.5); for (var i = 0; i < pal.data.length; i += 4) { pal.data[i] = pal.data[i] * 0.6 + pc[0] * 255 * 0.4; pal.data[i + 1] = pal.data[i + 1] * 0.6 + pc[1] * 255 * 0.4; pal.data[i + 2] = pal.data[i + 2] * 0.6 + pc[2] * 255 * 0.4; }
    gl.deleteTexture(g.pal); g.pal = R.tex2D(pal.data, pal.W, pal.H, {});
    function render(t) {
      if (t0 == null) t0 = t; var el = (t - t0) / 1000; var W = target.width, H = target.height; if (!W || !H) return;
      gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var eye = [-9, 2.4, 14], center = [0.5, 1.6, 0], view = m4lookAt(eye, center, [0, 1, 0]), proj = m4persp(42 * DEG, W / H, 0.5, 400), VP = m4mul(proj, view), sun = v3norm([-0.4, 0.55, 0.6]);
      // 星空
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
      R.use('sky', { uInvVP: m4invert(VP), uCamL: eye, uSunL: sun, uSpace: 1, uTime: el, uStarColor: [0.4, 0.4, 0.5], uAtm: [0, 0, 0], uFogColor: [0, 0, 0], uAtmDensity: 0, uAltitude: 0, uFog: 0, uUnder: 0, uWaterFog: [0, 0, 0] });
      gl.bindVertexArray(R.quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.depthMask(true);
      // 星球：中心略低于洋面，缓慢自转
      var spin = el * 0.12, model = m4mul(m4trans([2.5, -0.9, -2]), m4mul(m4scale(4.2), m4mul(m4rotZ(planet.tilt * DEG), m4rotY(spin))));
      var mu = materialUniforms(vp, g, el, spin * 0.2, 4); mu.uVP = VP; mu.uModel = model; mu.uRot = m3of(m4mul(m4rotZ(planet.tilt * DEG), m4rotY(spin))); mu.uCamW = eye; mu.uSunW = sun; mu.uEps = 1.5e-3; mu.uSlope = 6; mu.uForming = 1;
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      if (!R.ready('globeK5')) R.ensureProg('globeK5');
      R.use(R.ready('globeK5') ? 'globeK5' : 'globeLo', mu, [g.perm, g.map, g.pal, g.pal, R.det3()]); gl.bindVertexArray(R.sphereVAO); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0);
      // 银色洋面
      gl.disable(gl.CULL_FACE); R.use('ocean', { uVP: VP, uSize: 260, uCam: eye, uSun: sun, uTime: el, uPerm: 0 }, [g.perm]); gl.bindVertexArray(R.quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 大气边缘
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.enable(gl.CULL_FACE);
      R.use('atm', { uVP: VP, uModel: m4mul(model, m4scale(1.03)), uRot: mu.uRot, uCamW: eye, uSunW: sun, uAtm: [0.75, 0.7, 0.68], uAtmDensity: 0.5 }); gl.bindVertexArray(R.sphereVAO); gl.drawElements(gl.TRIANGLES, R.sphereN, gl.UNSIGNED_SHORT, 0);
      // 半圆彩虹环：被山脉甩到轨道上的水
      gl.disable(gl.CULL_FACE); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      var rm = m4mul(m4trans([2.5, -0.9, -2]), m4mul(m4rotY(-0.5 + Math.sin(el * 0.05) * 0.1), m4rotX(0.25)));
      R.use('ribbon', { uVP: VP, uModel: rm, uRad: 5.9, uWidth: 0.7, uAlpha: 0.42 }); gl.bindVertexArray(R.ringVAO); gl.drawElements(gl.TRIANGLES, R.ringN, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    function loop(t) { if (!running) return; raf = requestAnimationFrame(loop); try { render(t); } catch (e) { console.error('[MirrorPlanets] 大洋世界渲染错误：', e); running = false; } }
    handle.render = function (tSec) { render((tSec != null ? tSec : performance.now() / 1000) * 1000); };
    handle.start = function () { if (running) return; running = true; raf = requestAnimationFrame(loop); };
    handle.stop = function () { running = false; cancelAnimationFrame(raf); };
    handle.setSize = function (w, h) { target.width = w; target.height = h; };
    handle.dispose = function () { handle.stop(); try { R.dispose(); gl.deleteProgram(R.progs.ocean && R.progs.ocean.p); } catch (e) { /* ignore */ } };
    if (opts.autoplay !== false && !offscreen) handle.start(); else handle.render(0);
    return handle;
  }

  /* ============================================================ 无界面：D 维两体积分（供 Node/测试） */
  function runOrbitDemo(D, eps, periods, opts) {
    opts = opts || {}; eps = eps == null ? 0.01 : eps; var n = opts.count || 4, dim = Number.isInteger(D) ? D : 3, planets = [], k; // 分数维：只有 3 个坐标轴
    /* 与 createView 内 initOrbitDemo 同源。修复前 r0=1+0.55k、ph=k*1.3+0.4、sg=k%2、
       高维扰动符号 = q3%2 全只随循环索引变；opts.seed 从未被消费。n 由 count 决定（默认 4），
       故不同 seed 下 r0 取值集合大小 ≤ n（典型 ≤4），不是接近连续。现在与 initOrbitDemo 一样
       用 mulberry32((seed||1)^0xD1) 抽半径/相位/各维扰动方向；eps=0 时 vel 仍严格垂直 pos、
       vc=√(1/r₀^{D−2})，精确圆轨道不变量不变。本函数不走 solarSystem，不影响太阳系数据。 */
    var rnd = mulberry32((opts.seed || 1) ^ 0xD1);
    for (k = 0; k < n; k++) {
      var r0 = (1 + 0.55 * k) * (0.82 + 0.36 * rnd()), vc = Math.sqrt(1 / Math.pow(r0, D - 2));
      var ph = k * 1.3 + 0.4 + rnd() * TAU, pos = new Float64Array(dim), vel = new Float64Array(dim);
      var sg = rnd() < 0.5 ? 1 : -1;
      pos[0] = r0 * Math.cos(ph); pos[1] = r0 * Math.sin(ph);
      vel[0] = -vc * (1 + sg * eps) * Math.sin(ph); vel[1] = vc * (1 + sg * eps) * Math.cos(ph);
      if (dim > 2) vel[2] = vc * eps * 0.7 * (rnd() < 0.5 ? -1 : 1);
      for (var q3 = 3; q3 < dim; q3++) vel[q3] = vc * eps * 0.6 * (rnd() < 0.5 ? 1 : -1);
      planets.push({ r0: r0, vc: vc, T0: TAU * r0 / vc, pos: pos, vel: vel, status: '束缚', periods: 0, lastAng: ph, r: r0, prevR: r0, prevR2: r0, peri: [], precAcc: 0, precN: 0, minR: r0, maxR: r0, outSeries: [], outMax: 0 });
    }
    function acc(x) { return DIMG.accel(x, D, new Float64Array(x.length), 0); }   // 同 accelD，统一口径
    /* 步数必须有硬预算。步长固定 h = TAU/800，而一圈的步数 = T0/h，T0 = TAU·r0/vc、vc = r0^{-(D-2)/2}
       ⇒ **T0 = TAU·r0^{D/2}**：D=14、r0=3.3 时一圈就是 340 万步（实测整支演示 1.1~1.2 s 一次）。
       高维正是这支演示唯一的用武之地，所以这里不能没有上限。
       超预算时**不改步长**（改粗等于偷偷降低精度，而界面上什么都不说），而是算到预算为止、
       把 truncated 标出来，由调用方在文案里写明「示意，已截断」。 */
    /* 预算取 60000 步/质点：D≤6 时一圈最多 28,750 步（r0≈3.3），periods=2 也在预算内 ——
       低维的结果逐位不变；只有 D 很高（步数按 r0^{D/2} 爆炸）才会截断，那时结果标 truncated。
       调用方可用 opts.stepBudget 再收紧。 */
    var h = TAU / 800, STEP_BUDGET = opts.stepBudget > 0 ? Math.floor(opts.stepBudget) : 60000;
    planets.forEach(function (p) { var want = Math.ceil(periods * p.T0 / h), steps = Math.min(want, STEP_BUDGET), t = 0;
      p.truncated = steps < want; p.wantSteps = want;
      for (var st = 0; st < steps; st++) { var x = p.pos, v = p.vel, nn = x.length, i, a1 = acc(x), x2 = new Float64Array(nn), v2 = new Float64Array(nn); for (i = 0; i < nn; i++) { x2[i] = x[i] + 0.5 * h * v[i]; v2[i] = v[i] + 0.5 * h * a1[i]; } var a2 = acc(x2), x3 = new Float64Array(nn), v3 = new Float64Array(nn); for (i = 0; i < nn; i++) { x3[i] = x[i] + 0.5 * h * v2[i]; v3[i] = v[i] + 0.5 * h * a2[i]; } var a3 = acc(x3), x4 = new Float64Array(nn), v4 = new Float64Array(nn); for (i = 0; i < nn; i++) { x4[i] = x[i] + h * v3[i]; v4[i] = v[i] + h * a3[i]; } var a4 = acc(x4); for (i = 0; i < nn; i++) { x[i] += h / 6 * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]); v[i] += h / 6 * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]); }
        var r2 = 0; for (i = 0; i < nn; i++) r2 += x[i] * x[i]; var r = Math.sqrt(r2), ang = Math.atan2(x[1], x[0]), da = ang - p.lastAng; if (da > PI) da -= TAU; if (da < -PI) da += TAU; p.periods += da / TAU; p.lastAng = ang; p.minR = Math.min(p.minR, r); p.maxR = Math.max(p.maxR, r);
        if (p.prevR2 > p.prevR && p.prevR < r) { if (p.peri.length) { var d = ang - p.peri[p.peri.length - 1]; while (d > PI) d -= TAU; while (d < -PI) d += TAU; p.precAcc += d / DEG; p.precN++; } p.peri.push(ang); }
        if (nn > 3) { var o2 = 0; for (i = 3; i < nn; i++) o2 += x[i] * x[i]; var of = Math.sqrt(o2) / r; p.outMax = Math.max(p.outMax, of); if (st % Math.max(1, Math.floor(steps / 40)) === 0) p.outSeries.push([+(t / p.T0).toFixed(2), +of.toFixed(4)]); }
        p.prevR2 = p.prevR; p.prevR = r; p.r = r; t += h; var vv = 0; for (i = 0; i < nn; i++) vv += v[i] * v[i]; var E = 0.5 * vv + (Math.abs(D - 2) < 1e-9 ? Math.log(r) : -1 / ((D - 2) * Math.pow(r, D - 2)));
        if (!isFinite(r)) { p.status = '坠入'; p.failPeriods = Math.abs(p.periods); break; }   // r^{-(D-1)} 在 r→0 处发散：算出 NaN 就是砸进核里了，别让它带着 NaN 把预算耗光
        if (r < 0.06) { p.status = '坠入'; p.failPeriods = Math.abs(p.periods); break; } if (r > 40 || (r > 12 && E > 0)) { p.status = '逃逸'; p.failPeriods = Math.abs(p.periods); break; } }
      p.tPeriods = t / p.T0; });
    return { D: D, eps: eps, periods: periods, stepBudget: STEP_BUDGET, truncated: planets.some(function (p) { return p.truncated; }), planets: planets.map(function (p) { return { r0: p.r0, status: p.status, truncated: !!p.truncated, stepsWanted: p.wantSteps, periods: +Math.abs(p.periods).toFixed(2), failAtPeriods: p.failPeriods != null ? +p.failPeriods.toFixed(2) : null, minR: +p.minR.toFixed(3), maxR: +p.maxR.toFixed(3), precDegPerOrbit: p.precN ? +(p.precAcc / p.precN).toFixed(2) : null, periCount: p.peri.length, outFracMax: +p.outMax.toFixed(4), outFracSeries: p.outSeries }; }) };
  }

  /* ============================================================ 导出 */
  return {
    version: VERSION, SOLAR_SEED: SOLAR_SEED, NOW_YR: NOW_YR, TYPES: TYPE_CN, LIFE_LEVELS: LIFE_LEVELS,
    generateSystem: generateSystem, solarSystem: solarSystem, randomVisit: randomVisit, describe: describe, visualParams: visualParams, earthEra: earthEra, supportsDim: supportsDim, dimOf: dimOf, runOrbitDemo: runOrbitDemo, alphaCentauri: alphaCentauri, ALPHA_CEN_SEED: ALPHA_CEN_SEED,
    multiStar: { drawMultiplicity: drawMultiplicity, buildHierarchy: buildHierarchy, ma01Crit: ma01Crit, ma01Stable: ma01Stable, critS: critS, critP: critP, hierarchyIC: hierarchyIC, nbodyRK4: nbodyRK4, nbodyEnergy: nbodyEnergy, runTripleTest: runTripleTest },
    createView: createView, renderOceanWorld: renderOceanWorld,
    getMaps: getMaps, buildPalette: buildPalette, terrainMetersAt: terrainMetersAt, citiesFor: cityListFor,
    city: { plan: cityPlan, warp: cityWarpAt, buildings: buildingsFor, radiusM: cityRadiusM },   // Node 侧校验用（不依赖 GPU）
    // 天体种类与比例：Node 侧统计校验用
    stellar: { imfSample: imfSample, imfTable: imfTable, spectralOf: spectralOf, starClassOf: starClassOf, sptName: sptName, bbColor: bbColor, brownDwarf: brownDwarf, evolveStar: evolveStar, msLifeGyr: msLifeGyr, remnantKind: remnantKind, variableOf: variableOf, starMassWindow: starMassWindow, starLifeSolar: starLifeSolar, PM13: PM13, IMF_BREAKS: IMF_BREAKS, MULT_NOTE: MULT_NOTE },
    planetTypes: { KEPLER_CLASSES: KEPLER_CLASSES, keplerClass: keplerClass, planetRadiusRel: planetRadiusRel, planetMassEarth: planetMassEarth, tidalLockAU: tidalLockAU, diskOf: diskOf, gasCloudClass: gasCloudClass, applyGasLook: applyGasLook,
      sublimationAU: sublimationAU, rocheAU: rocheAU, hotJupiterPeriodD: hotJupiterPeriodD, hjMigrateProb: hjMigrateProb, migrateInnerGiant: migrateInnerGiant, T_SUBLIM_K: T_SUBLIM_K, HJ_PILEUP_D: HJ_PILEUP_D, HJ_NOTE: HJ_NOTE,
      // 偏粉红的三条物理来源：托林雾霾 / 超热木星的热辐射（visual.gasGlow）/ 红矮星的照明色温
      tholinOf: tholinOf, applyTholinSurface: applyTholinSurface, uvIndexOf: uvIndexOf, uvDoseOf: uvDoseOf,
      starTintOf: starTintOf, planckRGB: planckRGB, apparentColor: apparentColor, hueSatOf: hueSatOf, SUN_TEFF: SUN_TEFF },
    rogueWorld: rogueWorld,
    // D 维引力的唯一口径（核归一 / 力律指数 / 软化长度）——ui/hyper.js 的 D 维 N 体只读这里，保证两处数值一致
    dimGravity: DIMG,
    noise: { make: makeNoise, mulberry32: mulberry32, xorshift32: xorshift32, hash32: hash32 },
    perf: { stats: perfStats, clear: perfClear, mapsPending: function () { return mapQueuePending(); }, enable: function (v) { PERF.on = v !== false; } },
    moonBody: moonBody, moonsOf: moonsOfPlanet,
    // 小天体 / 恒星本体：与 moonBody 同一套「记录 → 可进入的天体」的升格函数（Node 侧也能直接调，便于校验）
    smallBodies: { asteroidBody: asteroidBody, beltBodiesOf: beltBodiesOf, cometBody: cometBody, cometBodiesOf: cometBodiesOf, cometStateAt: cometStateAt, rogueBodiesOf: rogueBodiesOf, starBody: starBody, shapeOf: shapeOf, smallBodyG: smallBodyG, escapeV: escapeV },
    asteroidBody: asteroidBody, cometBody: cometBody, starBody: starBody, cometStateAt: cometStateAt,
    _internal: { mapJobStart: mapJobStart, mapJobRows: mapJobRows, mapJobFinish: mapJobFinish, SH: SH, EARTH_LAND: EARTH_LAND, GLR: GLR, m4: { persp: m4persp, lookAt: m4lookAt, mul: m4mul, invert: m4invert, pt: m4pt, id: m4id }, fieldAtCPU: fieldAtCPU, localBasis: localBasis, llToN: llToN, nToLL: nToLL, terrainOctOf: terrainOctOf, normEpsOf: normEpsOf, gasBandAt: gasBandAt, hRefOf: hRefOf, shapeUniformsOf: shapeUniformsOf }
  };
});
