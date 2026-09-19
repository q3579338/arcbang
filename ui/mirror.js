/*
 * ui/mirror.js —— 镜像浏览（宇宙网 → 星系 → 恒星系 → 行星 → 地表）
 * ------------------------------------------------------------
 * MirrorBrowser.create({ adapter, sim, container, reducedMotion, web:{positions,density,N}, onExit })
 *   .draw(ctx, W, H, dt, el)     每帧
 *   .pointer(type, ev, W, H)     'down' | 'dblclick' | 'wheel' | 'move'
 *   .key(ev)                     键盘
 *   .dispose()
 * 层级：宇宙网 → 星系 → 恒星系 → 行星 → 地表（滚轮 = 高度）；屏幕下方时间滚动条；零时标右侧为未来时段 → Stack overflow。
 * 一切由参数种子决定（决定论）。
 *
 * 分工：恒星系 / 星球 / 地表三层优先交给 window.MirrorPlanets（ui/planets.js，契约见 SPEC-planets.md）：
 *   generateSystem(seed, params, {mode, ours, solar}) → System；createView(planetCanvas) → view；
 *   view.showSystem / showGlobe / land / setTime / setAltitude / getState / on('select'|'enter'|'hover') / resize / dispose。
 *   时间约定：timeYr 为相对"现在（零时标）"的年数（≤0 为过去），同时附带 absoluteYr（宇宙年龄 + timeYr）。
 *   MirrorPlanets 缺席时退回本文件内置的简易星球视图（Canvas 2D）。
 */
(function (root) {
  'use strict';
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* 中英双语：只在"显示"的地方套一层，词条见 web/i18n-mirror.js。
     i18n 没加载（或没这条译文）时原样返回中文——生成逻辑、比较与存盘一律用原文，不走 TR()。
     叫 TR 不叫 T：本文件里 T 是"时刻（年）"的局部变量名（fmtT(T)、var T = st.T），会把 T 遮住。 */
  var TR = function (s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'mirror') : s); };
  /* 引擎叙事（engine/planet.js 的 describeStar / describeLong / findings / 参数表）走模板翻译：
     那些句子里嵌着数值，整句当 key 永远命不中；模板表在 web/i18n-mirror.js 的 tx() 里。
     没有 tx（老版 i18n 或根本没加载）就原样返回中文，和 TR 一样绝不空手。 */
  var TX = function (s) { var I = root.MirrorI18n; return (I && I.tx && s != null) ? I.tx(String(s)) : s; };
  /* 过程生成的天体名：'恒星 K-1234' 里 '恒星 ' 是通名、后面那截是专名（种子抽的编号）。
     整串查词典永远查不到，所以只把前缀过一次词典，专名原样留着。与 ui/planets.js 的 TRN 同一口径。 */
  function TRN(n) { var s = String(n == null ? '' : n), m = /^恒星\s(.+)$/.exec(s); return m ? TR('恒星 ') + m[1] : TR(s); }

  /* ------------------------------------------------------------ 自定义天体名
   * 用户给天体起的名字：一张覆盖表存在 localStorage 的 mirror.ui.names.v1 下，形如
   *   { "<宇宙哈希>/g<星系种子>/s<恒星系种子>/p3/m1": "我的地球" }
   * 键必须与"生成器每次重建对象"无关——生成器给的 name 不稳定（fromPV 每次都造新对象），
   * 所以用创世参数哈希（引擎 hashParams，与目录去重同一个数）+ 各层种子 + 序号拼键。
   * 生成逻辑一个字都不改：只在"显示"的地方套一层 displayName()。 */
  var LS_NAMES = 'mirror.ui.names.v1', NAME_MAX = 24;
  function arr(v) { return Array.isArray(v) ? v : []; }
  function origNameOf(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    if (obj._origName != null) return String(obj._origName);
    return String(obj.name || obj.id || '');
  }
  /* 键 → 一句人话（管理面板里用；键本身是唯一可靠的信息，原名要靠会话内记下的 orig 表补） */
  function describeKey(key) {
    var seg = String(key || '').split('/'), out = [], i;
    if (!seg[0]) return String(key || '');
    out.push(TR('宇宙 ') + seg[0]);
    for (i = 1; i < seg.length; i++) {
      var s = seg[i], c = s.charAt(0), v = s.slice(1), n = Number(v);
      out.push(c === 'g' ? TR('星系 #') + v : c === 's' ? TR('恒星系 #') + v
        : c === 'p' ? TR('第 ') + (isFinite(n) ? n + 1 : v) + TR(' 颗行星')
        : c === 'm' ? TR('第 ') + (isFinite(n) ? n + 1 : v) + TR(' 颗卫星')
        : c === 'd' ? TR('第 ') + (isFinite(n) ? n + 1 : v) + TR(' 颗矮行星')
        : c === 'c' ? TR('第 ') + (isFinite(n) ? n + 1 : v) + TR(' 颗彗星')
        : c === 'b' ? TR('第 ') + (isFinite(n) ? n + 1 : v) + TR(' 条小行星带') : s);
    }
    return out.join(' · ');
  }
  var Names = (function () {
    var map = null, orig = {};   // orig：本次会话见过的原名，只为管理面板显示，不落盘
    function clean(s) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, NAME_MAX); }
    function load() {
      if (map) return map;
      map = {};
      var raw = null;
      try { raw = root.localStorage && root.localStorage.getItem(LS_NAMES); } catch (e) { raw = null; }
      if (raw) {
        try {
          var o = JSON.parse(raw);
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) { var v = clean(o[k]); if (k && v) map[String(k)] = v; }
          }
        } catch (e) { /* 坏数据当空表，不让它把镜像拖垮 */ }
      }
      return map;
    }
    function flush() { try { if (root.localStorage) root.localStorage.setItem(LS_NAMES, JSON.stringify(load())); } catch (e) { /* 隐私模式/配额满：内存里仍然生效 */ } }
    return {
      MAX: NAME_MAX, KEY: LS_NAMES, clean: clean, describe: describeKey,
      get: function (key) { return (key && load()[key]) || ''; },
      has: function (key) { return !!(key && load()[key]); },
      all: function () { var m = load(), o = {}, k; for (k in m) o[k] = m[k]; return o; },
      keys: function () { return Object.keys(load()).sort(); },
      count: function () { return Object.keys(load()).length; },
      // 空名 = 恢复原名（删除这一条）；返回真正存下的名字（'' 表示已恢复原名）
      set: function (key, name) { if (!key) return ''; var m = load(), v = clean(name); if (v) m[key] = v; else delete m[key]; flush(); return v; },
      remove: function (key) { var m = load(); if (!key || !m[key]) return false; delete m[key]; flush(); return true; },
      clear: function () { var m = load(), n = 0; Object.keys(m).forEach(function (k) { delete m[k]; n++; }); flush(); return n; },
      /* 合并导入：同键以导入的为准，并把覆盖数报出去（调用方要显示"覆盖了几条"） */
      merge: function (inc) {
        var m = load(), r = { added: 0, conflict: 0, same: 0, bad: 0, total: 0 };
        if (!inc || typeof inc !== 'object' || Array.isArray(inc)) return r;
        Object.keys(inc).forEach(function (k) {
          r.total++;
          var v = clean(inc[k]);
          if (!k || !v) { r.bad++; return; }
          if (m[k] == null) { m[k] = v; r.added++; }
          else if (m[k] === v) r.same++;
          else { m[k] = v; r.conflict++; }
        });
        flush(); return r;
      },
      note: function (key, name) { if (key && name) orig[key] = String(name); return name; },
      origOf: function (key) { return (key && orig[key]) || ''; }
    };
  })();
  /* 唯一的显示入口：面包屑、信息面板、画布标签、行星列表、管理面板全走它。
     有自定义名时，原名跟在后面的浅色括号里（我的地球（恒星 EJG2 b））。 */
  function displayName(obj, key, opts) {
    var o = origNameOf(obj), c = key ? Names.get(key) : '';
    if (key && o) Names.note(key, o);
    if (!c || c === o) return (opts && opts.html) ? esc(TRN(o)) : TRN(o);
    return (opts && opts.html)
      ? esc(c) + '<span class="mb-alias">（' + esc(TRN(o)) + '）</span>'
      : c + TR('（') + TRN(o) + TR('）');
  }

  /* ------------------------------------------------------------ 种子噪声 */
  function makeNoise(seed) {
    var perm = new Uint8Array(512), rnd = root.MirrorAdapter.rng(seed >>> 0);
    var p = []; for (var i = 0; i < 256; i++) p.push(i);
    for (i = 255; i > 0; i--) { var j = (rnd() * (i + 1)) | 0; var t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
    function h2(x, y) { return perm[(perm[x & 255] + y) & 255] / 255; }
    function h3(x, y, z) { return perm[(perm[(perm[x & 255] + y) & 255] + z) & 255] / 255; }
    function sm(t) { return t * t * (3 - 2 * t); }
    function n2(x, y) { var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = sm(xf), v = sm(yf); return lerp(lerp(h2(xi, yi), h2(xi + 1, yi), u), lerp(h2(xi, yi + 1), h2(xi + 1, yi + 1), u), v); }
    function n3(x, y, z) { var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi, u = sm(xf), v = sm(yf), w = sm(zf); var a = lerp(lerp(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), lerp(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v); var b = lerp(lerp(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), lerp(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v); return lerp(a, b, w); }
    function fbm2(x, y, oct) { var s = 0, a = 0.5, f = 1, n = 0; for (var i = 0; i < oct; i++) { s += a * n2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
    function fbm3(x, y, z, oct) { var s = 0, a = 0.5, f = 1, n = 0; for (var i = 0; i < oct; i++) { s += a * n3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
    return { n2: n2, n3: n3, fbm2: fbm2, fbm3: fbm3, rnd: rnd };
  }
  /* 行星纹理/地表噪声偏移：优先用行星自身 seed；否则对 name+au 做 FNV-1a。
     旧式 (name.length*131 + round(au*1000)) 在 genSystem 下 name 长度恒为 8，
     等价于只跟 au 毫秒位走，大量不同行星共享同一张噪声图案。 */
  function planetTexSeed(p) {
    if (p && p.seed != null && isFinite(+p.seed)) return (+p.seed) >>> 0;
    var s = String((p && p.name) || '') + '#' + String(Math.round(((p && p.au) || 0) * 1000));
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ------------------------------------------------------------ 世界生成 */
  var SOLAR = [
    { name: '水星', type: 'rock', au: 0.39, period: 0.24, radius: 2440, hue: 30, life: false, desc: '灰色的岩石球，昼夜温差极大' },
    { name: '金星', type: 'rock', au: 0.72, period: 0.62, radius: 6052, hue: 45, life: false, desc: '厚厚的云层下是滚烫的地面' },
    { name: '地球', type: 'earthlike', au: 1.0, period: 1.0, radius: 6371, hue: 210, life: true, desc: '目前已知唯一有液态水海洋与生物圈的行星' },
    { name: '火星', type: 'rock', au: 1.52, period: 1.88, radius: 3390, hue: 15, life: false, desc: '锈红色的沙漠，干涸的河床' },
    { name: '木星', type: 'gas', au: 5.2, period: 11.86, radius: 69911, hue: 30, life: false, desc: '条纹状的气体巨行星' },
    { name: '土星', type: 'gas', au: 9.54, period: 29.5, radius: 58232, hue: 45, life: false, desc: '带环的气体巨行星', ring: true },
    { name: '天王星', type: 'ice', au: 19.2, period: 84, radius: 25362, hue: 180, life: false, desc: '躺着自转的冰巨星' },
    { name: '海王星', type: 'ice', au: 30.1, period: 165, radius: 24622, hue: 220, life: false, desc: '深蓝色的冰巨星' },
    { name: '冥王星', type: 'ice', au: 39.5, period: 248, radius: 1188, hue: 200, life: false, desc: '柯伊伯带天体，2006 年起按 IAU 定义归为矮行星' }
  ];
  var TYPE_NAMES = { rock: '岩质行星', earthlike: '类地行星', gas: '气体巨行星', ice: '冰巨星', lava: '熔岩世界', ocean: '海洋世界' };

  function genGalaxy(seed, ours) {
    var rnd = root.MirrorAdapter.rng(seed);
    var kinds = ['旋涡星系 Sb', '棒旋星系 SBc', '旋涡星系 Sc', '椭圆星系 E3', '棒旋星系 SBb'];
    var k = ours ? 1 : (rnd() * kinds.length) | 0;
    return { name: ours ? TR('银河系') : TR('星系 G-') + String(1000 + ((rnd() * 9000) | 0)), kind: ours ? '棒旋星系 SBc' : kinds[k], arms: ours ? 4 : (kinds[k].indexOf('椭圆') >= 0 ? 0 : 2 + ((rnd() * 3) | 0)), diameterKly: ours ? 100 : 30 + Math.round(rnd() * 170), stars: ours ? TR('约 2000 亿') : TR('约 ') + (100 + Math.round(rnd() * 900)) + TR(' 亿'), tFormYr: -(ours ? 13.2e9 : 9e9 + rnd() * 4e9), seed: seed, ours: ours };
  }
  function genSystem(seed, ours, NO_LIFE_GEN) {
    var rnd = root.MirrorAdapter.rng(seed ^ 0x5151);
    if (ours) return { name: '太阳', cls: 'G2V 黄矮星', color: '#fff4d6', tFormYr: -4.6e9, tPlanetsYr: -4.4e9, planets: SOLAR.map(function (p, i) { var o = {}; for (var k in p) o[k] = p[k]; o.tFormYr = -4.55e9; o.phase = 0; o.seed = (0x501A5 ^ Math.imul(i + 1, 0x9E3779B9)) >>> 0; return o; }), seed: seed, ours: true };
    // 第三列是相对权重（示意 IMF）：旧式 clamp(3+round((rnd-0.5)*5)) 只会落到索引 1..5，O5V/M4V 永不出现，权重也被丢掉
    var classes = [['O5V 蓝巨星', '#9fb8ff', 0.005], ['B2V 蓝白星', '#b9ccff', 0.03], ['A0V 白星', '#e6ecff', 0.4], ['F5V 黄白星', '#fff6e0', 2], ['G2V 黄矮星', '#fff4d6', 10], ['K3V 橙矮星', '#ffd2a0', 30], ['M4V 红矮星', '#ffb08a', 200]];
    var wsum = 0, wi; for (wi = 0; wi < classes.length; wi++) wsum += classes[wi][2];
    var pick = rnd() * wsum, acc = 0, c = classes[classes.length - 1];
    for (wi = 0; wi < classes.length; wi++) { acc += classes[wi][2]; if (pick < acc) { c = classes[wi]; break; } }
    var tForm = -(1.5e9 + rnd() * 9e9);
    var n = 2 + ((rnd() * 8) | 0), planets = [], au = 0.2 + rnd() * 0.3;
    var sname = 'K-' + String(1000 + ((rnd() * 9000) | 0));
    var letters = 'bcdefghijk';
    for (var i = 0; i < n; i++) {
      var hz = au > 0.6 && au < 1.8;
      var type = hz ? (rnd() < 0.5 ? 'earthlike' : rnd() < 0.5 ? 'ocean' : 'rock') : au < 0.6 ? (rnd() < 0.3 ? 'lava' : 'rock') : (rnd() < 0.6 ? 'gas' : 'ice');
      var life = !NO_LIFE_GEN && (type === 'earthlike' || type === 'ocean') && hz && rnd() < 0.55 && tForm < -3.5e9;
      var pSeed = (seed ^ Math.imul(i + 1, 0x9E3779B9) ^ 0x504C4E54) >>> 0;
      planets.push({ name: sname + ' ' + letters[i], type: type, au: Math.round(au * 100) / 100, period: Math.round(Math.pow(au, 1.5) * 100) / 100, radius: type === 'gas' ? 40000 + rnd() * 40000 : type === 'ice' ? 15000 + rnd() * 15000 : 2000 + rnd() * 6000, hue: rnd() * 360, life: life, ring: type === 'gas' && rnd() < 0.4, tFormYr: tForm + 2e8 + rnd() * 1e8, phase: rnd() * TAU, seed: pSeed, desc: life ? '有液态海洋，大气中有氧——有生命的世界' : TYPE_NAMES[type] });
      au *= 1.5 + rnd() * 0.6;
    }
    return { name: '恒星 ' + sname, cls: c[0], color: c[1], tFormYr: tForm, tPlanetsYr: tForm + 2e8, planets: planets, seed: seed, ours: false };
  }

  /* ------------------------------------------------------------ 地表纪元 */
  function epochOf(planet, T) {
    var age = T - planet.tFormYr;   // 行星年龄（年）
    if (age < 0) return null;
    if (planet.type === 'earthlike' || planet.type === 'ocean') {
      var span = -planet.tFormYr; // 到"现在"的总寿命
      var f = age / span;          // 0..1（现在=1）
      if (f < 0.13) return 'magma';
      if (f < 0.33) return 'brownsea';
      if (f < 0.77) return 'bluesea';
      if (f < 0.9) return 'green';
      var toNow = -T;
      if (planet.life && toNow <= 1e4) return 'civil';
      if (planet.life && toNow <= 3e6) return 'human';
      return 'green';
    }
    if (planet.type === 'lava') return 'magma';
    if (planet.type === 'gas') return 'gas';
    if (planet.type === 'ice') return 'ice';
    return 'rock';
  }
  // 地表时代按地质年代表述（时间与依据写在文案里）；画面本身是过程生成的示意
  var EPOCH_TEXT = {
    magma: '冥古宙（约 46–40 亿年前）：地表尚未固结，岩浆洋与高频撞击（依据：月球撞击记录与地球早期热演化）。示意。',
    brownsea: '太古宙（约 40–25 亿年前）：还原性大气，海洋已存在，出现最早的微生物与叠层石（依据：Nutman 2016；Schopf 1993）。示意。',
    bluesea: '元古宙（约 25–5.4 亿年前）：大氧化事件后大气与海水含氧上升，陆核长大（依据：Lyons 2014）。示意。',
    green: '显生宙（约 5.4 亿年前至今）：植物登陆，超大陆裂解（依据：Kenrick & Crane 1997；板块重建）。示意。',
    human: '第四纪（约 30 万年前起）：解剖学意义上的现代人出现（依据：Hublin 2017，Jebel Irhoud）。示意。',
    civil: '全新世晚期（约 1 万年前起）：农业与城市出现，夜面可见人工光源（依据：DMSP/VIIRS 夜间灯光观测）。示意。',
    gas: '气态巨行星：没有固体表面，只有分层的对流云带（依据：Juno 重力场测量）。示意。',
    ice: '冰巨星：水／氨／甲烷冰幔外包氢氦大气，云顶约 50–70 K（依据：Voyager 2 掠过测量）。示意。',
    rock: '岩质表面：撞击坑与风化碎屑，没有稳定的液态水（依据：类地行星地质对比）。示意。'
  };

  /* ------------------------------------------------------------ 主体 */
  function create(o) {
    var A = o.adapter, sim = o.sim, box = o.container, rm = !!o.reducedMotion;
    var seed = sim.seed >>> 0, ours = !!sim.isOurs;
    /* 维数模式（app.js 按 MirrorPlanets.supportsDim(D) 定）：
     *   '3d'        D=3，全套 宇宙网 → 星系 → 恒星系 → 行星 → 地表
     *   '2d'        D=2，2 维镜像层（画面由 planets 负责，这里只管文案与提示）
     *   'orbitDemo' D≥4 整数，只到恒星系层的轨道投影演示：没有球面地形与地表可言，深度封顶在 2 */
    var dimMode = o.dimMode || '3d', dimS = (o.dimS != null && isFinite(o.dimS)) ? +o.dimS : 3;
    // 有恒星但没有分子化学的宇宙：行星层一律无生命（引擎已保证 life=null，这里再兜一道，
    // 因为 planets 缺席时本文件自带的 genSystem 会自己随机造生命）
    /* D≠3 也一律无生命：'2d' 模式（D=2）能一路下潜到地表，而这些宇宙的引擎结局是
       「无稳定轨道 / 无稳定原子」——引擎原话是"没有牛顿吸引，物质无法聚集"。
       在这样的宇宙里摆出生物圈（更别说"夜面出现人工光源"）是最不该有的一种暗示。
       o.noLife 走的是"有恒星但没有分子化学"那条理由，这里另记一条理由，别把话说串。 */
    var NO_LIFE = !!o.noLife || dimMode !== '3d', LIFE_NOTE = o.lifeNote || '';
    var NO_LIFE_WHY = o.noLife ? 'chem' : (dimMode !== '3d' ? 'dim' : '');
    var MAX_LEVEL = dimMode === 'orbitDemo' ? 2 : 4;
    // 引力指数 D−1：整数不带小数，分数维给两位
    function fmtExp(x) { return Math.abs(x - Math.round(x)) < 1e-6 ? String(Math.round(x)) : x.toFixed(2); }
    var FRACTIONAL = Math.abs(dimS - Math.round(dimS)) > 1e-6;
    /* 轨道稳不稳定这句话必须按 D 分开说，不能一句"没有稳定的圆轨道"打发所有 D≠3
       （engine/README §5 的 R_DIM，也是 calc.dims.orbitStability 的口径）：
         D≥4    圆轨道对径向微扰不稳定，氢原子哈密顿量无下界 → 引擎判 fail
         3<D<4  轨道**稳定**但不闭合（进动）→ 引擎只判 warn，结局 BEYOND_MODEL_DIM
         2<D<3  有牛顿吸引，轨道稳定，只是引力聚集更弱、拓扑受限 → warn
       这一档的宇宙（D=2.5 / 3.5）原来也被横幅告知"没有稳定的圆轨道（Ehrenfest 1917）"，
       和分析面板里引擎自己的结论正好相反。 */
    var ORBITS_UNSTABLE = dimS >= 4 - 1e-9;
    function orbitClause() {
      return ORBITS_UNSTABLE
        ? TR('没有稳定的圆轨道（Ehrenfest 1917）')
        : TR('圆轨道对径向微扰仍然稳定，但不再闭合——轨道会进动（Ehrenfest 1917：只有 D=3 给出闭合椭圆）');
    }
    /* 受限维数模式（2d / orbitDemo）= D≠3。这一段是这次审计里最要紧的一处：
       D=2 的宇宙走 '2d' 模式，MAX_LEVEL 仍是 4，于是可以一路下潜到地表，
       而每一层的面板照着 3 维的恒星/行星模型原样报数 —— 实测 D=2 的区块 9044032 会给出
         「状态：行星已经诞生。这是真实尺度的图象，不是天象演示」
         「M3V 型主序星……主序寿命约 1540 亿年……按 Kopparapu et al. 2013，保守宜居带在 0.136–0.26 AU」
         「气态圆盘 · 0.064 AU · 0.0282 年 · 9 卫」「柯伊伯带 / 奥尔特云 / 流浪行星」
       而同一个宇宙的卡片与分析面板写的是「无稳定轨道 / 无稳定原子」，引擎原话是
       「D≤2 时引力势为对数或排斥，没有牛顿吸引，物质无法聚集」。
       一个连引力都没有的宇宙里报出宜居带和卫星数，是这次要修掉的典型。
       处理：面板每一层顶上挂一条常驻说明（不是只在折叠横幅里说一次），
       「行星已经诞生」这类断言改成"按 3 维模型生成（示意）"，并且不再给生命。 */
    var DIM_LIMITED = dimMode !== '3d';
    function dimExtrapNote() {
      if (!DIM_LIMITED) return '';
      return '<p class="mb-p mb-dim">D=' + dimS.toFixed(2) + TR('：下面的光谱型、主序寿命、宜居带、轨道周期、卫星数全部由 3 维的恒星与行星模型生成（示意）；引擎对这个宇宙的结论是「') +
        TR(dimS <= 2 + 1e-9 ? '没有牛顿吸引，物质无法聚集' : ORBITS_UNSTABLE ? '无稳定轨道 / 无稳定原子' : '超出模型适用范围（D≠3）') +
        TR('」，这些数不是它真会长出来的东西。') + '</p>';
    }
    // 「行星已经诞生」在 D≠3 下不能当断言说
    function bornText() {
      return DIM_LIMITED ? TR('已按 3 维模型生成行星（示意，不是这个维数下的结论）') : TR('行星已经诞生。这是真实尺度的图象，不是天象演示');
    }
    // 2 维世界里没有"行星/巨行星"，用 planets 的圆盘措辞
    var TYPE_2D = { rock: '岩质圆盘', earthlike: '类地圆盘', ocean: '液态水覆盖的圆盘', gas: '气态圆盘（没有可以站立的地面）', ice: '冰封圆盘', lava: '熔融圆盘' };
    function typeName(p) { return TR((dimMode === '2d' ? (TYPE_2D[p.type] || '圆盘') : TYPE_NAMES[p.type]) || p.type); }
    // 进入受限模式时的说明横幅：先醒目，几秒后收成一行小字，点它再展开
    var BANNER_FULL = dimMode === 'orbitDemo'
      ? TR('这是 D=') + dimS.toFixed(2) + TR(' 的轨道投影演示：该维数下引力按 r^{−') + fmtExp(dimS - 1) + TR('} 衰减，') + orbitClause() +
        (ORBITS_UNSTABLE
          ? TR('——画面上那几个亮点是试探质点（不是行星，不能进入），在 1% 扰动下几圈内就会坠入中心、或沿径向逃逸到无穷远。两种下场都发生在这个 D 维空间内部：质点并没有「进入别的维度」，高维在这里只体现为引力衰减更快、有效势里不再有稳定极小值。')
          : TR('。画面上那几个亮点是试探质点（不是行星，不能进入）：本引擎不为 D≠3 生成行星，因为行星形成、恒星结构与地表那一整套公式都只对 3 维成立。这里只演示引力律本身的后果。')) +
        TR('R 重置 · 3 切换到 D=3 对照 · +/− 调扰动') + (FRACTIONAL ? TR('　｜　分数维（推测）') : '')
      : dimMode === '2d'
        /* D=2 的诚实话术：引擎这一档判的是 UNSTABLE_ORBITS，理由正是"D≤2 势为对数或排斥，
           没有牛顿吸引，物质无法聚集"（Tegmark 1997）。所以下面这些圆盘、轨道、周期
           全部建立在"把 r^{−(D−1)} 当牛顿力用"这个推测之上——必须把引擎的结论一起说出来，
           否则一屏绕着转的圆盘就等于替这个宇宙宣称了它并不具备的结构。 */
        ? TR('这是 D=') + dimS.toFixed(2) + TR(' 的 2 维世界（示意）：画面里的圆盘与轨道建立在"把引力写成 r^{−') + fmtExp(dimS - 1) + TR('}"这个推测之上；引擎自己的判据相反——D≤2 时引力势为对数或排斥，没有牛顿吸引，物质根本聚集不起来（Tegmark 1997），这个宇宙的结局因此是「无稳定轨道 / 无稳定原子」。行星是圆盘而不是球，没有球面地表；下面的画面与数值都只是示意。')
        : '';
    if (!BANNER_FULL && NO_LIFE && LIFE_NOTE) BANNER_FULL = LIFE_NOTE;
    var BANNER_SHORT = dimMode === 'orbitDemo' ? 'D=' + dimS.toFixed(2) + TR(' 轨道投影演示 · 点此看说明') : dimMode === '2d' ? 'D=' + dimS.toFixed(2) + TR(' 2 维世界（示意）· 点此看说明') : (NO_LIFE ? TR('有恒星，但没有分子化学 · 点此看说明') : '');
    var MODE_BANNER = dimMode === 'orbitDemo'
      ? TR('轨道投影演示（D=') + dimS.toFixed(2) + TR('）：力 ∝ r^{−(D−1)}，') +
        (ORBITS_UNSTABLE ? TR('没有稳定的闭合轨道') : TR('轨道稳定但不闭合（进动）')) +
        TR('，本引擎不为 D≠3 生成行星与球面地表——只画到恒星系这一层，画面上的亮点是试探质点而不是行星，不能进入。')
      : dimMode === '2d' ? TR('2 维世界（示意）：D=') + dimS.toFixed(2) + TR('，下面的画面是 2 维几何下的示意渲染，物理量仍按 3 维公式外推；引擎判据在 D≤2 没有牛顿吸引（物质无法聚集），这些圆盘与轨道是推测，不是结论。') : '';
    var noise = makeNoise(seed);
    var ageYr = Math.max(1e9, (sim.enterTimeGyr || 13.8) * 1e9);
    var st = {
      level: 0, T: 0, span: ageYr, wMin: -ageYr, wMax: 0, future: false,
      galaxy: null, system: null, planet: null, cam: { lat: 20, lon: 100, alt: 1e4 },
      bannerOpen: true, bannerT: 0, demoAcc: 1, trans: null, locateLog: [], locating: false, soOpen: false, soTrace: null, hover: null, planetTex: null, planetTexKey: '', surfTex: null, surfKey: '', flickerT: 0, planetRot: 0,
      /* sel：选中但还没进入的候选（结构见下面「选中与进入」一节）。它只影响动作条与信息面板，
         不参与 renderCrumb —— 面包屑读的是 galaxy/system/planet 这三个"当前对象"，所以层级只在进入时才变。 */
      sel: null,
      /* pvPending：已经排队、还没执行的 planets 视图切换（showGlobe / land 走 busy 异步）。
         >0 时 syncPV 不许用"还没切过去的旧状态"回写 st.planet，否则换星球会被自己回滚。 */
      pvPending: 0,
      peOpen: { in: false, dv: false, rp: true }   // 行星参数/派生量/报告 折叠区的开合（跨重绘保持）
    };
    var web = o.web || null;
    var P = root.MirrorPlanets || null, pcanvas = o.planetCanvas || null, pv = null;
    var usePV = !!(P && pcanvas && typeof P.createView === 'function' && typeof P.generateSystem === 'function');
    // 恒星系层的选项：orbitDemo 下带上初始扰动（1%），planets 据此立刻建好试探质点
    function sysOpts() { return timeOpts(dimMode === 'orbitDemo' ? { perturbation: 0.01 } : null); }
    function timeOpts(extra) { var t = { timeYr: st.T, absoluteYr: ageYr + st.T, nowYr: 0, ageYr: ageYr }; if (extra) for (var k in extra) t[k] = extra[k]; return t; }
    /* 长任务前先亮忙碌条、渲染一帧再开工（宿主 app.js 提供 onBusy/onBusyDone）。
       没有宿主回调时退化成直接执行，行为不变。 */
    function busy(label, fn) {
      if (!o.onBusy) { fn(); return; }
      o.onBusy(label);
      var done = false;
      var run = function () { if (done) return; done = true; try { fn(); } finally { if (o.onBusyDone) o.onBusyDone(); } };
      // 后台/不合成的标签页里 rAF 可能一直不触发，光靠它会让"点了没反应"。setTimeout 兜底。
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(function () { root.requestAnimationFrame(run); });
      setTimeout(run, 120);
    }
    /* 试探质点的一次性说明：同一次进入只提示一次（每次悬停都弹会很吵），
       但换一个恒星系（重建演示）后会再提示一次。 */
    function demoNote(ev) {
      var planet = ev && ev.planet !== undefined ? ev.planet : ev;
      if (!planet) return;                                     // 移开/点空白：不提示
      if (st.demoNoted) return;
      st.demoNoted = true;
      if (o.onNote) o.onNote('D=' + dimS.toFixed(2) + (ORBITS_UNSTABLE ? TR('：没有稳定轨道，') : TR('：轨道稳定但不闭合（进动），')) + TR('本引擎不为这个维数生成行星与球面地表，这里只演示引力律；这些是试探质点，不是行星，没有可进入的星球。'));
    }
    /* 预热：进镜像之后就在空闲时把 planets 视图建出来、着色器慢慢收货（画布一直藏着，不画）。
       用户真机 dump 显示首次 createView 要 1.67 s（着色器 15 个程序，原来是同步一个个等的）——
       那一下正好落在「按 Enter 进恒星系」那一帧上。现在提前到宇宙网/星系层的空闲时间里做完，
       进层时直接拿现成的。预热失败或没来得及，ensurePV() 照旧按需创建，行为不变。 */
    var warmed = false, warmMs = null, warmQueue = [];
    function flushWarm() {
      var q = warmQueue; warmQueue = [];
      for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) { console.warn('[mirror] 预热后的回调出错：', e); } }
    }
    /* prewarmPV(done?)：预热 planets 视图；done 在「预热真的做完 / 或确认不用预热」之后调一次。
       2026-09-17 用户真机 dump：进镜像那一帧 mbCreate=2042、showSystem=2029 —— 两处计时包的是同一段。
       原因是 create() 末尾带 starSeed 进来时**同步**调 enterSystemLevel()，
       而 ensurePV() → planets.createView（十几个着色器程序）就在那里面，
       于是这几行下面刚挂上的 prewarmPV 定时器根本轮不到就被越过去了 —— 预热不是没做，是被跳过了。
       现在带 starSeed 那条路改成「先建镜像但不开层 → 预热 → 预热完（或 400 ms 兜底）再开层」，
       这一段就从点击那一帧里挪出去了。 */
    function prewarmPV(done) {
      if (done) warmQueue.push(done);
      if (!usePV || pv || warmed) { flushWarm(); return; }
      /* rIC 与 setTimeout **两条都挂上，谁先到算谁**：requestIdleCallback 在后台标签页里
         根本不会触发（实测 hidden 时等多久都不来），只靠它就等于没预热；只靠 setTimeout 又会
         抢前台的空闲时间。两条一起挂、用 warmed 去重，前台走 rIC、后台走兜底。 */
      var go = function () {
        if (warmed || pv || st.level >= 2) { flushWarm(); return; }   // 已经建了 / 已经进层了（那条路自己会建）
        warmed = true;
        var t0 = nowMs2();
        try { ensurePV(); pvVisible(false); } catch (e) { /* 预热失败就算了，进层时再建 */ }
        warmMs = Math.round(nowMs2() - t0);
        flushWarm();
      };
      if (typeof root.requestIdleCallback === 'function') { try { root.requestIdleCallback(go, { timeout: 1500 }); } catch (e) { /* ignore */ } }
      root.setTimeout(go, 400);
    }
    function ensurePV() {
      if (!usePV) return null;
      if (pv) return pv;
      try { pv = P.createView(pcanvas, { dimMode: dimMode, dimS: dimS }); } catch (e) { console.warn('[mirror] MirrorPlanets.createView 失败，退回内置视图：', e); usePV = false; return null; }
      if (typeof pv.on === 'function') {
        // planets.js 事件载荷：enter {kind:'globe'|'surface', planet, lat, lon, altitudeM}；select {planet,index,system}
        if (dimMode === 'orbitDemo') {
          // 悬停/点击试探质点：给一次说明，别让人一直点一直没反应
          pv.on('hover', demoNote); pv.on('select', demoNote); pv.on('enter', demoNote);
        }
        pv.on('enter', function (ev) {
          /* 记下"planets 视图刚刚自己进入过"的时刻：同一次 Enter 会先被画布上的监听器处理，
             再冒泡到 app.js → mirror.key，那边靠这个时间戳认出"这一下已经用掉了"，不再进第二次。 */
          st.pvEnterT = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
          if (dimMode === 'orbitDemo') return;                 // 这个模式没有可进入的行星层
          var planet = ev && ev.planet ? ev.planet : ev; if (!planet || !planet.type) return;
          var loc = fromPV(planet);
          if (ev && ev.kind === 'surface') { if (MAX_LEVEL < 4) return; if (st.planet !== loc) { st.planet = loc; st.planetTex = null; st.planetTexKey = ''; } st.cam = st.cam || {}; st.cam.lat = ev.lat != null ? ev.lat : 10; st.cam.lon = ev.lon != null ? ev.lon : 60; st.cam.alt = ev.altitudeM != null ? ev.altitudeM : 1e4; st.surfKey = ''; st.level = 4; refreshUI(); }
          else selectPlanet(loc);
        });
        /* planets.js 自己的"单击选中 → 再点/双击/Enter 进入"：把它选中的那颗同步成 mirror 的 st.sel，
           两边看到的是同一个候选（画布上的白圈 = 面板上的信息卡），不会一个说 A 一个说 B。 */
        pv.on('select', function (ev) {
          var planet = ev && ev.planet ? ev.planet : ev;
          if (!planet || !planet.type) {           // 点空白/选中的是恒星本体：撤掉行星候选
            if (st.sel && st.sel.kind === 'planet') { st.sel = null; renderActions(); renderInfo(); }
            return;
          }
          var loc = fromPV(planet); st.hover = loc;
          var i = indexOfPlanet(loc);
          if (i < 0 && ev && ev.index != null) i = ev.index;
          if (i < 0) { renderInfo(); return; }
          st.sel = { kind: 'planet', idx: i, obj: planetList()[i] || loc, system: st.system };
          renderActions(); renderInfo();
        });
      }
      return pv;
    }
    function pvVisible(v) { if (!pcanvas) return; pcanvas.hidden = !v; if (o.onPlanetCanvas) o.onPlanetCanvas(v); if (v && pv && pv.resize) try { pv.resize(); } catch (e) { /* ignore */ } }
    var TYPE_MAP = { rock: 'rock', ocean: 'ocean', gas: 'gas', ice: 'ice', lava: 'lava', desert: 'rock', living: 'earthlike', earth: 'earthlike' };
    function fromPV(pl) {
      if (!pl) return null;
      if (pl._local) return pl._local;
      var t = TYPE_MAP[pl.type] || 'rock';
      var loc = { name: origNameOf(pl) || TR('行星'), type: t, au: pl.orbitAU != null ? Math.round(pl.orbitAU * 1000) / 1000 : 1, period: pl.periodYr != null ? Math.max(1e-4, Math.round(pl.periodYr * 10000) / 10000) : 1, radius: pl.radiusRel != null ? pl.radiusRel * 6371 : 6371, hue: 200, life: !NO_LIFE && !!pl.life, lifeLevel: (!NO_LIFE && pl.life && pl.life.level) || '', ring: !!pl.ring, tFormYr: pl.tFormYr != null ? pl.tFormYr : (pl.starFormedYr != null && pl.nowYr != null ? (pl.starFormedYr - pl.nowYr) + 2e8 : -4.55e9), phase: 0, desc: pl.description || pl.desc || TYPE_NAMES[t] || '', _pv: pl };
      try { pl._local = loc; } catch (e) { /* frozen */ }
      return loc;
    }
    function fromPVSystem(sys, ours) {
      var planets = (sys.planets || []).map(fromPV);
      var star = sys.star || {};
      // name 一律取原名：自定义名只在显示时套（displayName），本地对象里存的永远是生成器给的那个
      return { name: origNameOf(sys) || (ours ? '太阳' : '恒星'), cls: star.type || '', color: star.color || '#fff4d6', tFormYr: sys.tFormYr != null ? sys.tFormYr : (star.ageGyr != null ? -star.ageGyr * 1e9 : -4.6e9), tPlanetsYr: sys.tPlanetsYr != null ? sys.tPlanetsYr : ((star.ageGyr != null ? -star.ageGyr * 1e9 : -4.6e9) + 2e8), planets: planets, seed: sys.seed || 0, seedKey: (sys.seed || 0) >>> 0, ours: !!ours, _pv: sys };
    }

    /* ---------- 自定义天体名：键与写回
     * 键 = <创世参数哈希>/g<星系种子>/s<恒星系种子>/p<行星序号>/m<卫星序号>。
     * 生成器给的对象每次都是新的（fromPV 重建），名字也不稳定，所以键只用"种子 + 序号"这种可复现的东西。
     * 表在 localStorage（mirror.ui.names.v1），换一组创世参数 → 哈希不同 → 名字不会串到别的宇宙。 */
    var UHASH = (function () {
      var h = (sim && sim.hash != null) ? sim.hash : (sim && sim.raw && sim.raw.hash != null ? sim.raw.hash : sim.seed);
      var n = Number(h);
      return String((isFinite(n) ? n : seed) >>> 0);
    })();
    function kUniverse() { return UHASH; }
    function kGalaxy(g) { g = g || st.galaxy; return g ? UHASH + '/g' + (g.seed >>> 0) : ''; }
    function kSystem(s) {
      s = s || st.system; var gk = kGalaxy();
      if (!s || !gk) return '';
      return gk + '/s' + (((s.seedKey != null ? s.seedKey : s.seed) >>> 0));
    }
    function kPlanetAt(i, s) { var sk = kSystem(s); return (sk && i >= 0) ? sk + '/p' + i : ''; }
    function kPlanet(p) { return kPlanetAt(indexOfPlanet(p)); }
    function indexOfPlanet(p) {
      var ps = planetList(), i;
      if (!p || !ps.length) return -1;
      i = ps.indexOf(p); if (i >= 0) return i;
      if (p._pv) for (i = 0; i < ps.length; i++) if (ps[i] && ps[i]._pv === p._pv) return i;   // fromPV 每次造新对象
      for (i = 0; i < ps.length; i++) if (ps[i] && origNameOf(ps[i]) === origNameOf(p)) return i;
      return -1;
    }
    /* 画布上的标签由 planets.js 每帧直接读 system.planets[k].name（ui/planets.js 不归这里改），
       所以自定义名必须写回那个字段；原名收在 _origName 里，随时能还原，也不影响任何生成逻辑。 */
    function setPVName(obj, key) {
      if (!obj || !key) return;
      // 只改本来就有名字的对象：像 belts 那样只有 cn/kind 的，别给它凭空塞一个 name 字段
      if (obj._origName == null && typeof obj.name !== 'string') return;
      try {
        if (obj._origName == null) obj._origName = obj.name;
        var d = displayName(obj, key);
        if (obj.name !== d) obj.name = d;
      } catch (e) { /* 冻结对象：跳过 */ }
    }
    function applyNamesTo(sysLocal) {
      var s = sysLocal || st.system; if (!s) return;
      var sk = kSystem(s); if (!sk) return;
      Names.note(sk, origNameOf(s));
      var pvs = s._pv;
      if (pvs) {
        setPVName(pvs, sk);                                   // HUD 里的恒星系标题
        if (pvs.star) setPVName(pvs.star, sk);                // 画布上的恒星标签（与恒星系同一个标题）
        // 这些字段的形状由 planets.js 定（comets/belts 不一定是数组），一律先确认是数组再走
        arr(pvs.planets).forEach(function (p, i) {
          var pk = sk + '/p' + i;
          setPVName(p, pk);
          arr(p && p.moons).forEach(function (m, j) { setPVName(m, pk + '/m' + j); });
        });
        arr(pvs.dwarfs).forEach(function (d, i) { setPVName(d, sk + '/d' + i); });
        arr(pvs.comets).forEach(function (c, i) { setPVName(c, sk + '/c' + i); });
        arr(pvs.belts).forEach(function (b, i) { setPVName(b, sk + '/b' + i); });
      }
      arr(s.planets).forEach(function (p, i) { Names.note(sk + '/p' + i, origNameOf(p)); });
    }
    // 起名字这件事绝不能把镜像本身弄挂：包一层，出问题只留一条控制台警告
    function applyNames(sysLocal) { try { applyNamesTo(sysLocal); } catch (e) { console.warn('[mirror] 套用自定义天体名失败：', e); } }
    function universeLabel() { return TR('宇宙 ') + (sim.idLabel || '#' + A.seedHex(sim.params, sim.mode)); }
    // 当前层的标题对象与键：信息面板标题、重命名、右键菜单三处共用同一份判断
    function titleOf() {
      var lv = st.level;
      if (lv === 0) return { obj: universeLabel(), key: kUniverse() };
      if (lv === 1 && st.galaxy) return { obj: st.galaxy, key: kGalaxy() };
      if (lv === 2 && st.system) return { obj: dimMode === 'orbitDemo' ? TR('中心质点 ') + origNameOf(st.system) : st.system, key: kSystem() };
      if (lv >= 3 && st.planet) return { obj: st.planet, key: kPlanet(st.planet) };
      return { obj: '', key: '' };
    }
    /* 信息面板标题：常态是"名字 ✎"，重命名时换成一个内联输入框（Enter 存 / Esc 取消 / 留空恢复原名）。
       extra 挂在标题后面（行星层的两个徽标）。 */
    function titleHTML(extra) {
      var t = titleOf(), orig = origNameOf(t.obj);
      extra = extra || '';
      if (!t.key) return '<h3 class="mb-title">' + esc(orig) + '</h3>' + extra;
      if (st.renaming && st.renaming.key === t.key) {
        return '<h3 class="mb-title editing">' +
          '<input type="text" class="mb-ren-in" id="mbRenIn" maxlength="' + Names.MAX + '" aria-label="' + esc(TR('给这个天体起个名字')) + '" placeholder="' + esc(orig) + '">' +
          '<button type="button" class="mb-ren-btn" id="mbRenOK" title="' + esc(TR('保存（Enter）')) + '" aria-label="' + esc(TR('保存')) + '">✓</button>' +
          '<button type="button" class="mb-ren-btn" id="mbRenNo" title="' + esc(TR('取消（Esc）')) + '" aria-label="' + esc(TR('取消')) + '">✕</button></h3>' +
          '<p class="mb-dim mb-ren-note">' + TR('Enter 保存 · Esc 取消 · 留空恢复原名（原名：') + esc(orig) + TR('；最多 ') + Names.MAX + TR(' 字）') + '</p>' + extra;
      }
      return '<h3 class="mb-title"><span class="mb-title-txt" title="' + esc(TR('双击可以给它起个名字')) + '">' + displayName(t.obj, t.key, { html: true }) + '</span>' +
        '<button type="button" class="mb-ren-btn" id="mbRenBtn" title="' + esc(TR('重命名（当前天体）')) + '" aria-label="' + esc(TR('重命名')) + '">✎</button></h3>' + extra;
    }
    function startRename() {
      var t = titleOf();
      if (!t.key) { if (o.onNote) o.onNote(TR('这一层没有可以命名的天体')); return; }
      st.renaming = { key: t.key, orig: origNameOf(t.obj) };
      st.renameDraft = Names.get(t.key) || '';
      st.renameFocus = true;
      renderInfo();
    }
    function cancelRename() { if (!st.renaming) return; st.renaming = null; st.renameDraft = ''; renderInfo(); }
    function commitRename(v) {
      var r = st.renaming; if (!r) return;
      var saved = Names.set(r.key, v);
      st.renaming = null; st.renameDraft = '';
      refreshNames();
      if (o.onNote) o.onNote(saved ? TR('已命名：') + saved + TR('（原名 ') + r.orig + TR('）') : TR('已恢复原名：') + r.orig);
    }
    // 名字变了（面板里改的、管理目录里改的、导入进来的都算）：画布标签、面包屑、列表一起刷新
    function refreshNames() {
      applyNames();
      if (pv && typeof pv.renderNow === 'function') { try { pv.renderNow(); } catch (e) { /* ignore */ } }
      refreshUI();
    }
    var webPts = null, webN = 0;
    if (!web) { // 程序化宇宙网
      /* 拒绝采样要有抽样次数上限。接受条件是「fbm2 > 0.52，或 8% 的兜底」：噪声整体压在 0.52 以下时
       * 只剩那 8% 能过，期望要抽 ~44000 次；而这段是建面板时同步跑的，没有上限就可能在这里空转很久。
       * 抽满上限就用已经收到的这些点（webN 记实际数量，绘制按它截断），正常参数下 webN 仍然是 3500，
       * 逐点与改动前相同——上限只在本来就要空转的那种极端情形里才会碰到。 */
      webPts = new Float32Array(2 * 3500); var k = 0, r = A.rng(seed ^ 0x33), tries = 0;
      while (k < 3500 && tries < 40000) { tries++; var x = r(), y = r(); if (noise.fbm2(x * 6, y * 6, 3) > 0.52 || r() < 0.08) { webPts[2 * k] = x; webPts[2 * k + 1] = y; k++; } }
      webN = k;
    }
    var galPts = null;

    /* ---------- DOM */
    box.innerHTML = '';
    var crumb = el('nav', 'mb-crumb'); crumb.setAttribute('aria-label', TR('层级'));
    var info = el('aside', 'mb-info'); info.setAttribute('aria-live', 'polite');
    var actions = el('div', 'mb-actions');
    var hint = el('div', 'mb-hint');
    var alt = el('div', 'mb-alt');
    var timebar = el('div', 'mb-time');
    timebar.innerHTML =
      '<div class="mb-time-row">' +
      '<label class="mb-scale">' + TR('比例') + ' <select id="mbScale" aria-label="' + esc(TR('时间比例')) + '"></select></label>' +
      '<button type="button" id="mbExtend" class="mb-btn" aria-pressed="false">' + TR('拉出未来时段') + '</button>' +
      '<span class="mb-tlabel" id="mbTLabel"></span>' +
      '<span class="mb-tstep"><button type="button" class="mb-btn" id="mbBack" aria-label="' + esc(TR('时间后退')) + '">◀</button><button type="button" class="mb-btn" id="mbFwd" aria-label="' + esc(TR('时间前进')) + '">▶</button><button type="button" class="mb-btn" id="mbNow">' + TR('回到现在') + '</button><button type="button" class="mb-btn mb-egg" id="mbEgg" title="' + esc(TR('一个玩笑式的演示，不是计算结果')) + '">' + TR('彩蛋') + '</button></span>' +
      '</div>' +
      '<div class="mb-track"><div class="mb-future" id="mbFuture" hidden></div><div class="mb-zero" id="mbZero"><span>' + TR('零时标') + '</span></div><input type="range" id="mbRange" min="0" max="100000" step="1" value="100000" aria-label="' + esc(TR('时间滚动条')) + '"><div class="mb-endnote">' + TR('零时标之后：未来不可计算——混沌与量子随机') + '</div></div>';
    var soDlg = el('div', 'win-dialog'); soDlg.setAttribute('role', 'alertdialog'); soDlg.setAttribute('aria-modal', 'true'); soDlg.setAttribute('aria-labelledby', 'soTitle'); soDlg.hidden = true;
    soDlg.innerHTML = '<div class="win-title" id="soTitle"><span class="win-icon">!</span>' + TR('彩蛋 — Stack overflow') + '</div><div class="win-body"><div class="win-x">✕</div><div class="win-msg"><b>Stack overflow</b><br><span class="win-sub">' + TR('彩蛋：把“模拟宇宙里再模拟一个宇宙”一路递归下去，每一层都要把上一层的现场压入堆栈，没有终止条件，堆栈迟早耗尽——这是个玩笑式的演示，不是本程序的计算结果。限制在别处：未来不可计算——混沌系统对初始条件敏感（Lorenz 1963），量子测量结果本身随机。') + '</span></div><div class="win-btns"><button type="button" class="win-btn" id="soTrace">' + TR('看一眼递归') + '</button><button type="button" class="win-btn" id="soOK">' + TR('确定') + '</button></div></div>';
    var bannerEl = null;
    if (BANNER_FULL) {
      bannerEl = el('div', 'mb-banner');
      bannerEl.innerHTML = '<span class="mb-banner-txt"></span>';
      bannerEl.addEventListener('click', function () { st.bannerOpen = !st.bannerOpen; st.bannerT = 0; paintBanner(); });
      box.appendChild(bannerEl);
    }
    function paintBanner() {
      if (!bannerEl) return;
      bannerEl.className = 'mb-banner' + (st.bannerOpen ? '' : ' small');
      bannerEl.querySelector('.mb-banner-txt').textContent = st.bannerOpen ? BANNER_FULL : BANNER_SHORT;
      bannerEl.title = st.bannerOpen ? TR('点击收起') : TR('点击展开说明');
    }
    box.appendChild(crumb); box.appendChild(info); box.appendChild(actions); box.appendChild(alt); box.appendChild(hint); box.appendChild(timebar); box.appendChild(soDlg);
    var $ = function (id) { return box.querySelector('#' + id); };
    var range = $('mbRange'), scaleSel = $('mbScale'), extendBtn = $('mbExtend'), tLabel = $('mbTLabel'), zeroMark = $('mbZero'), futureBand = $('mbFuture');
    var SCALES = [['全程', ageYr], ['10 亿年', 1e9], ['1 亿年', 1e8], ['1000 万年', 1e7], ['100 万年', 1e6], ['10 万年', 1e5], ['1 万年', 1e4], ['1000 年', 1e3], ['100 年', 100], ['10 年', 10]];
    SCALES.forEach(function (s, i) { var op = document.createElement('option'); op.value = String(i); op.textContent = TR(s[0]); scaleSel.appendChild(op); });
    scaleSel.value = '0';
    scaleSel.addEventListener('change', function () { setSpan(SCALES[+scaleSel.value][1]); });
    extendBtn.addEventListener('click', function () { st.future = !st.future; extendBtn.setAttribute('aria-pressed', String(st.future)); extendBtn.classList.toggle('on', st.future); layoutWindow(); });
    range.addEventListener('input', function () { var u = +range.value / 100000; setT(st.wMin + u * (st.wMax - st.wMin), true); });
    $('mbBack').addEventListener('click', function () { setT(st.T - st.span * 0.02, false); });
    $('mbFwd').addEventListener('click', function () { setT(st.T + st.span * 0.02, false); });
    $('mbNow').addEventListener('click', function () { setT(0, false); });
    $('soOK').addEventListener('click', closeSO);
    $('soTrace').addEventListener('click', function () { st.soTrace = { t0: performance.now() / 1000, depth: 0 }; soDlg.hidden = true; });
    $('mbEgg').addEventListener('click', openSO);   // 彩蛋只在这里手动打开；拖过零时标不再弹窗

    function setSpan(span) {
      st.span = span;
      layoutWindow();
    }
    function layoutWindow() {
      var half = st.span / 2, fut = st.future ? st.span * 0.15 : 0;
      var maxT = st.future ? st.span * 0.15 : 0;
      var wMin = st.T - half, wMax = st.T + half;
      if (st.span >= ageYr) { wMin = -ageYr; wMax = fut; }
      if (wMax > maxT) { wMin -= (wMax - maxT); wMax = maxT; }
      if (wMin < -ageYr) { wMax += (-ageYr - wMin); wMin = -ageYr; wMax = Math.min(wMax, maxT); }
      st.wMin = wMin; st.wMax = wMax;
      var zu = (0 - wMin) / (wMax - wMin);
      zeroMark.style.left = (zu * 100) + '%';
      zeroMark.hidden = !(zu >= 0 && zu <= 1);
      futureBand.hidden = !st.future; futureBand.style.left = (zu * 100) + '%'; futureBand.style.width = ((1 - zu) * 100) + '%';
      syncRange();
    }
    function syncRange() { var u = (st.T - st.wMin) / (st.wMax - st.wMin); range.value = String(Math.round(clamp(u, 0, 1) * 100000)); tLabel.textContent = fmtT(st.T); }
    function fmtT(T) {
      if (T > 0) return TR('未来 +') + fmtDur(T);
      var y = -T;
      if (y === 0) return TR('现在（零时标）');
      if (y >= 1e8) return TR('距今 ') + (y / 1e8).toFixed(2) + TR(' 亿年');
      if (y >= 1e4) return TR('距今 ') + (y / 1e4).toFixed(1) + TR(' 万年');
      var year = 2004 - y;   // 故事所在的"现在"
      if (year > 0) return (y < 200 ? TR('公元 ') + Math.floor(year) + TR(' 年') : TR('公元 ') + Math.floor(year) + TR(' 年（距今 ') + Math.round(y) + TR(' 年）'));
      return TR('公元前 ') + Math.ceil(1 - year) + TR(' 年');
    }
    function fmtDur(y) { if (y >= 1e8) return (y / 1e8).toFixed(2) + TR(' 亿年'); if (y >= 1e4) return (y / 1e4).toFixed(1) + TR(' 万年'); return Math.round(y) + TR(' 年'); }
    function setT(T, fromSlider) {
      if (T > 0) { // 零时标之后没有可算的未来：混沌对初值敏感 + 量子测量随机（说明写在时间轴右端）
        st.T = 0; syncRange(); return;
      }
      st.T = clamp(T, -ageYr, 0);
      if (!fromSlider) layoutWindow(); else syncRange();
      if (pv && st.level >= 2 && pv.setTime) { try { pv.setTime(st.T, timeOpts()); } catch (e) { /* ignore */ } }
      renderInfo();
    }
    function openSO() { if (st.soOpen) return; st.soOpen = true; soDlg.hidden = false; setTimeout(function () { $('soOK').focus(); }, 0); }
    function closeSO() { st.soOpen = false; st.soTrace = null; soDlg.hidden = true; syncRange(); range.focus(); }   // 不再强制把时间拉回零时标

    /* ---------- 面包屑 / 动作 / 信息 */
    var LEVEL_NAMES = ['宇宙', '星系', '恒星系', '行星', '地表'];
    /* 两个控件语义不同，提示里必须分清，否则用户按了上下键看不动就当是坏的：
       「随机选一个…」= 只选中，看清楚再决定进不进；「← 上一个 / 下一个 →」= 步进，按一下就换过去。 */
    var SEL_HINT = TR('选中后按 Enter 或点“进入”才会下潜');
    var STEP_HINT = TR('“← 上一个 / 下一个 →”按一下就直接换过去');
    // 路径那句话要跟 MAX_LEVEL 对得上：轨道投影演示只到恒星系，别继续许诺「→ 行星 → 地表」
    var PATH_LINE = MAX_LEVEL < 3 ? TR('路径：宇宙网 → 星系 → 恒星系（这个维数到此为止）') : TR('路径：宇宙网 → 星系 → 恒星系 → 行星 → 地表');
    var HINTS = [
      PATH_LINE + TR('　｜　“随机选一个星系”= 直接进入（右键菜单里有「只选中」），点列表里的一行 = 只选中，') + SEL_HINT + TR(' · 双击任意处直接进入该处星系 · 拖动时间滚动条 · Esc 退出镜像'),
      TR('“随机选一个恒星系” = 直接进入（右键菜单里有「只选中」）；') + STEP_HINT + TR(' · 双击旋臂任意处直接进入 · PageUp / PageDown 在星系目录里选 · Backspace 返回 · [ ] 移动时间'),
      TR('点行星名 = 选中，双击行星 = 直接进入，') + SEL_HINT + TR('；') + STEP_HINT + TR(' · Backspace 返回 · [ ] 移动时间 · , . 调轨道流速'),
      TR('滚轮 = 高度（向下滚动降低） · 双击降到地表 · , . 或“← 上一颗 / 下一颗 →”直接换到本恒星系的另一颗 · Backspace 返回'),
      TR('滚轮 = 高度 · 双击急剧下降 · 方向键平移 · , . 或“← 上一颗 / 下一颗 →”直接换到另一颗（换过去仍留在地表）· Backspace 返回')
    ];
    // 面包屑一律走 displayName：有自定义名就显示「自定义（原名）」
    function crumbLabel(i) {
      if (i === 0) return displayName(universeLabel(), kUniverse());
      if (i === 1) return st.galaxy ? displayName(st.galaxy, kGalaxy()) : TR('星系');
      if (i === 2) {
        if (!st.system) return TR('恒星系');
        var k = kSystem();
        if (Names.get(k)) return displayName(st.system, k);   // 后面已经跟着原名了，不再补"系"字
        /* 中文在原名后缀一个「系」（'恒星 B6BG系'）；英文里那是个后置的词（'Star B6BG system'），
           所以专名走 TRN、后缀单独过词典，不要把整串（原名 + 系）拿去查——那条 key 永远不存在。 */
        var n = origNameOf(st.system);
        return /系$/.test(n) ? TRN(n) : TRN(n) + TR('系');
      }
      if (i === 3) return st.planet ? displayName(st.planet, kPlanet(st.planet)) : TR('行星');
      return TR('地表');
    }
    function renderCrumb() {
      crumb.innerHTML = '';
      for (var i = 0; i <= st.level; i++) {
        var b = el('button', 'mb-crumb-item' + (i === st.level ? ' cur' : ''), esc(crumbLabel(i)));
        b.type = 'button'; b.setAttribute('data-level', String(i));
        if (i === st.level) b.setAttribute('aria-current', 'page');
        (function (lv) { b.addEventListener('click', function () { goLevel(lv); }); })(i);
        crumb.appendChild(b);
        if (i < st.level) crumb.appendChild(el('span', 'mb-crumb-sep', '›'));
      }
      var back = el('button', 'mb-crumb-item mb-exit', TR('退出镜像')); back.type = 'button'; back.addEventListener('click', function () { if (o.onExit) o.onExit(); }); crumb.appendChild(back);
      renderAddrBar();
    }

    /* ---------- 地址栏
       星系目录是从 N 体盒子里识别出来的晕，换个粒子档位识别结果就不一样，所以"第几个星系"
       不是稳定的地址。真正稳定的是**种子**：星系由种子生成，恒星系种子由星系种子派生，
       行星是系统内的序号。于是一个位置可以写成 `M:星系种子/恒星系种子/行星序号`（36 进制）。
       显示名（如"星系 G-2037"）不能当地址——那四位数是从种子里抽的，会撞名，反推不回去。 */
    function addrOf() {
      if (!st.galaxy) return '';
      var parts = [(st.galaxy.seed >>> 0).toString(36)];
      if (st.system) {
        parts.push(((st.system.seedKey != null ? st.system.seedKey : st.system.seed) >>> 0).toString(36));
        if (st.planet) { var pi = planetIndex(); if (pi >= 0) parts.push(String(pi)); }
      }
      return 'M:' + parts.join('/');
    }
    function gotoAddr(txt) {
      var why = busyReason(); if (why) { note(why); return; }
      var t = String(txt || '').trim().replace(/^M[:：]/i, '').replace(/\s+/g, '');
      if (!t) { note(TR('地址是空的。格式：M:星系种子/恒星系种子/行星序号，例如 ') + (addrOf() || 'M:1a2b3c/4d5e6f/2')); return; }
      var seg = t.split(/[\/\|,]/).filter(function (x) { return x !== ''; });
      var gSeed = parseInt(seg[0], 36);
      if (!isFinite(gSeed)) { note(TR('看不懂这个地址：「') + txt + TR('」。格式：M:星系种子/恒星系种子/行星序号（36 进制）')); return; }
      var g;
      try { g = genGalaxy(gSeed >>> 0, false); } catch (e) { note(TR('这个星系种子生成失败：') + (e && e.message ? e.message : e)); return; }
      enterGalaxyObj(g, { idx: -1 });
      if (seg.length < 2) { note(TR('已跳到 ') + displayName(g)); return; }
      var sSeed = parseInt(seg[1], 36);
      if (!isFinite(sSeed)) { note(TR('恒星系种子读不出来，已停在星系层')); return; }
      var sys = makeSystemSafe(sSeed >>> 0); if (!sys) return;
      enterSystemObj(sys, { idx: -1 });
      if (seg.length < 3) { note(TR('已跳到 ') + displayName(sys)); return; }
      var pi = parseInt(seg[2], 10), ps = (sys.planets) || [];
      if (!(pi >= 0 && pi < ps.length)) { note(TR('这个恒星系只有 ') + ps.length + TR(' 颗行星，序号 ') + seg[2] + TR(' 越界，已停在恒星系层')); return; }
      enterPlanetSel({ kind: 'planet', obj: ps[pi], system: sys, idx: pi });
      note(TR('已跳到 ') + displayName(ps[pi]));
    }
    function renderAddrBar() {
      var bar = el('span', 'mb-addr');
      var inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'mb-addr-in'; inp.placeholder = TR('地址：M:星系种子/恒星系种子/行星序号');
      inp.value = addrOf();
      inp.setAttribute('aria-label', TR('位置地址：粘贴后回车跳转'));
      inp.title = TR('地址用**种子**表示，与粒子档位无关：换台机器、换个档位，同一个地址到的是同一个地方（星系目录会因档位而异，地址不会）。回车跳转。');
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); gotoAddr(inp.value); } ev.stopPropagation(); });
      bar.appendChild(inp);
      var go = el('button', 'mb-crumb-item', TR('跳转')); go.type = 'button';
      go.title = TR('跳到输入框里的地址'); go.addEventListener('click', function () { gotoAddr(inp.value); });
      bar.appendChild(go);
      var cp = el('button', 'mb-crumb-item', TR('复制')); cp.type = 'button';
      cp.title = TR('复制当前位置的地址，发给别人就能到同一个地方');
      cp.addEventListener('click', function () {
        var a = addrOf(); if (!a) { note(TR('还没进入任何星系，没有地址可复制')); return; }
        inp.value = a; inp.select();
        var ok = false;
        try { ok = document.execCommand && document.execCommand('copy'); } catch (e) { ok = false; }
        if (!ok && navigator.clipboard) { try { navigator.clipboard.writeText(a); ok = true; } catch (e) { /* ignore */ } }
        note(ok ? (TR('已复制地址：') + a) : (TR('复制不了，手动选中输入框里的地址：') + a));
      });
      bar.appendChild(cp);
      crumb.appendChild(bar);
    }
    /* 去别处的入口：每一层都给一个"随机选一个"的按钮，不依赖用户知道要双击。
       选中与进入是两步（见下面「选中与进入」一节）：随机/前后翻只挑候选，进入要再点一下「进入」或按 Enter。
       #1207 另有"定位银河系/太阳/地球"这条观测目录路径——那是确定的目标，不是随机挑，照旧点了就进。 */
    var visitTick = 0;
    function rnd2() { var r = A.rng((seed ^ 0x9e3779b9 ^ (++visitTick * 2654435761) ^ (Date.now() & 0xffff)) >>> 0); return [0.18 + r() * 0.64, 0.18 + r() * 0.64]; }
    /* 忙碌期（过渡动画 / 定位序列）不接受新动作——但绝不能"点了没反应、什么都不说"。
       用户报过一次"点随机进入一个恒星系完全没反应"，这类静默 return 是首要嫌疑，一律改成给反馈。 */
    function busyReason() {
      if (st.trans) return TR('正在放大进入上一次选中的目标，等这段动画放完（约 1 秒）再点');
      if (st.locating || st.locateSeq) return TR('正在按观测目录定位，等这段检索走完再点');
      return '';
    }
    function note(msg) { if (msg && o.onNote) o.onNote(msg); }

    /* ============================================================ 选中（selection）与进入（entry）
     * 用户的原话：「这里应该随机选一个，再决定进不进；下级菜单同样的逻辑」。
     * 所以每一层的「随机选一个…」与「← 上一个 / 下一个 →」一律只写 st.sel，**绝不动**
     * st.level / st.galaxy / st.system / st.planet；下潜只有一个出口 —— enterSelected()。
     * 面包屑因此天然"只在进入时才变"：renderCrumb 读的是那三个当前对象，选中根本碰不到它们
     * （setSel 只调 renderActions + renderInfo，refreshUI 才是三件一起重画的那个）。
     *
     *   st.sel = { kind, idx, obj, system, u, v, box, gi }
     *     kind    'galaxy' | 'system' | 'planet'
     *     idx     该层目录里的序号（-1 = 目录之外的自选）
     *     obj     候选对象（本地对象；信息面板照它渲染"完整信息"）
     *     system  行星候选所属的恒星系（跨恒星系随机时 ≠ st.system，进入时要先把恒星系换过去）
     *     u,v,box 画布上的高亮位置：box=true 用宇宙网那个居中方框的坐标，false 用视口比例
     *     gi      星系层高亮用的 galPts 下标（跟着旋臂一起转）
     */
    function selKindName(k) { return TR(k === 'galaxy' ? '星系' : k === 'system' ? '恒星系' : '星球'); }
    function selKey(s) {
      if (!s || !s.obj) return '';
      return s.kind === 'galaxy' ? kGalaxy(s.obj) : s.kind === 'system' ? kSystem(s.obj) : kPlanetAt(s.idx, s.system);
    }
    function selName(s) { return s && s.obj ? displayName(s.obj, selKey(s)) : ''; }
    function setSel(s) { st.sel = s || null; syncSelToPV(); renderActions(); renderInfo(); }
    function clearSel() { if (!st.sel) return; st.sel = null; syncSelToPV(); renderActions(); renderInfo(); }
    /* 恒星系视图（planets.js）自己按 S.selected 画高亮圈与"Enter 进入"的提示。
       把 mirror 这边的行星候选推过去，画布上的白圈与面板上的信息卡永远是同一颗。 */
    function syncSelToPV() {
      if (!pv || typeof pv.select !== 'function' || st.level !== 2) return;
      var s = st.sel, i = -1;
      if (s && s.kind === 'planet' && s.system === st.system) i = s.idx;
      try { pv.select(i); if (typeof pv.renderNow === 'function') pv.renderNow(); } catch (e) { /* ignore */ }
    }
    // 反复点"随机选一个"要能挨个换：避开当前这个（只有一个候选时照给，否则点了没反应）
    function pickIdx(n, avoid) {
      if (n <= 0) return -1;
      if (n === 1) return 0;
      var r = A.rng((seed ^ 0x51ed270b ^ (++visitTick * 2654435761) ^ (Date.now() & 0xffff)) >>> 0);
      var i = Math.floor(r() * n) % n, guard = 0;
      while (i === avoid && guard++ < 8) i = Math.floor(r() * n) % n;
      return i;
    }
    /* ---------- 星系候选 */
    function selGalaxyAt(i) {
      var l = galaxyCatalog(); if (!l.length) { note(TR('这个宇宙里没有可选的星系')); return; }
      i = ((i % l.length) + l.length) % l.length;
      var g = l[i];
      setSel({ kind: 'galaxy', idx: i, obj: g, u: g.bx != null ? g.bx : 0.5, v: g.by != null ? g.by : 0.5, box: true });
    }
    function selRandomGalaxy() {
      var why = busyReason(); if (why) { note(why); return; }
      var l = galaxyCatalog(); if (!l.length) { note(TR('这个宇宙里没有可选的星系')); return; }
      selGalaxyAt(pickIdx(l.length, (st.sel && st.sel.kind === 'galaxy') ? st.sel.idx : galIndex()));
      if (st.sel && st.sel.kind === 'galaxy') enterSelected();   /* 随机 = 直接进入（用户指定的默认行为）；想"先看再决定"走右键菜单里的「只选中」 */
    }
    // 目录之外：按宇宙网上一个随机位置派生种子（和"双击任意处"同一条路），同样只选不进
    function selRandomGalaxyOff() {
      var why = busyReason(); if (why) { note(why); return; }
      var uv = rnd2();
      setSel({ kind: 'galaxy', idx: -1, obj: genGalaxy(galSeedAt(uv[0], uv[1]), false), u: uv[0], v: uv[1], box: false });
      if (st.sel && st.sel.kind === 'galaxy') enterSelected();
    }
    // 到头循环；当前不在目录里（自选进来的）时，向后从第一个开始、向前从最后一个开始
    /* 「← 上一个 / 下一个 →」是**步进**控件：按一下就真的换过去，不留候选。
       只有「随机选一个…」才是"先选中、看清楚、再决定进不进"那两步式的——
       用户两次报"上下变化，星系/恒星系都不变"，就是因为这里以前只挑候选不换层：
       编号在动、画面不动，看起来就是坏的。两个控件语义不同，不该统一。
       步进必须先过 busy 关卡，不能只靠 enterSelected() 兜底：selXXXAt 会先往
       st.sel 里写候选，忙碌期进不去，动作条就会挂着一个不该出现的「进入：X」。 */
    function stepGalaxy(dir) {
      var why = busyReason(); if (why) { note(why); return; }
      var base = (st.sel && st.sel.kind === 'galaxy') ? st.sel.idx : anchorIdx('galaxy', galIndex());
      selGalaxyAt(base < 0 ? (dir > 0 ? 0 : -1) : base + dir);
      if (st.sel && st.sel.kind === 'galaxy') enterSelected();
    }
    /* ---------- 恒星系候选（要先把它生成出来，信息卡才有东西可显示） */
    function makeSystemSafe(sseed) {
      try { return makeSystem(sseed >>> 0, false); }
      catch (e) { console.error('[mirror] 生成恒星系失败：', e && e.stack || e); note(TR('这个恒星系没能生成：') + (e && e.message ? e.message : e) + TR('（详见控制台）')); return null; }
    }
    function selSystemAt(i) {
      var ss = systemSeeds(); if (!ss.length) { note(TR('还没有进入任何星系：先选一个星系进去')); return; }
      i = ((i % ss.length) + ss.length) % ss.length;
      var sys = makeSystemSafe(ss[i]); if (!sys) return;
      var pos = sysAnchor(ss[i]);
      setSel({ kind: 'system', idx: i, obj: sys, gi: pos.gi, u: pos.u, v: pos.v, box: false });
    }
    function selRandomSystem() {
      if (!st.galaxy) { note(TR('还没有进入任何星系：先在宇宙网层选一个星系')); return; }
      var why = busyReason(); if (why) { note(why); return; }
      var ss = systemSeeds(); if (!ss.length) return;
      selSystemAt(pickIdx(ss.length, (st.sel && st.sel.kind === 'system') ? st.sel.idx : sysIndex()));
      if (st.sel && st.sel.kind === 'system') enterSelected();
    }
    /* ---------- 按恒星演化阶段找一个恒星系
       白矮星 6.2%、中子星 0.46%、红巨星 0.14%、黑洞 0.11%——这些比例本身是对的
       （IMF 里八成是 M 矮星，主序寿命远超宇宙年龄，根本没机会演化；巨星阶段又只占主序寿命的
       百分之一量级）。但"稀少"不等于"没办法看"：随便点七百次才碰到一颗红巨星是劝退的。
       这里按种子扫描，直到找到目标阶段为止，扫不到就如实说扫了多少个。 */
    /* name 是提示语里用的说法（「找到了：…（红巨星 / 渐近巨星支，扫了 N 个恒星系）」），一个字都别动；
       sub 是二级菜单里那一行的写法——菜单里五条并排，重复的「找一个…系统」只会让人读五遍同样的词。 */
    var STAGE_FIND = [
      { id: 'wd', name: '白矮星', sub: '白矮星系统', match: function (st2) { return st2.stage === 'wd'; } },
      { id: 'rgb', name: '红巨星 / 渐近巨星支', sub: '红巨星·渐近巨星支系统', match: function (st2) { return st2.stage === 'rgb' || st2.stage === 'agb'; } },
      { id: 'ns', name: '中子星', sub: '中子星系统', match: function (st2) { return st2.stage === 'ns'; } },
      { id: 'bh', name: '黑洞', sub: '黑洞系统', match: function (st2) { return st2.stage === 'bh'; } },
      // 阈值取 2 M☉ 而不是 8：实测主序星里 ≥8 M☉ 的一颗都没有（最大 5.4 M☉）——大质量星寿命只有几百万到几千万年，
      // 而恒星系年龄是 Gyr 量级，早就演化成遗骸了。挂一个永远找不到的入口比没有这个入口更糟。
      { id: 'hotstar', name: '较大质量主序星（≥2 M☉，A/B 型）', sub: '大质量主序星（≥2 M☉，A/B 型）系统',
        match: function (st2) { return st2.stage === 'ms' && (st2.massRel || 0) >= 2; } }
    ];
    function findStage(defn, maxTry) {
      var why = busyReason(); if (why) { note(why); return; }
      if (!st.galaxy) { note(TR('先进入一个星系再找')); return; }
      maxTry = maxTry || 4000;
      var r = A.rng((seed ^ 0x5EEC ^ (++visitTick * 2654435761) ^ (Date.now() & 0xffff)) >>> 0);
      var ss = systemSeeds(), tried = 0, sys = null;
      for (; tried < maxTry; tried++) {
        var sseed = ss.length && tried < ss.length ? ss[tried] : sysSeedAt(0.1 + r() * 0.8, 0.1 + r() * 0.8);
        var cand = null; try { cand = makeSystem(sseed >>> 0, false); } catch (e) { continue; }
        if (cand && cand.star && defn.match(cand.star)) { sys = cand; break; }
      }
      if (!sys) { note(TR('扫了 ') + tried + TR(' 个恒星系也没找到') + TR(defn.name) + TR('——这个宇宙的参数下它可能根本不出现')); return; }
      enterSystemObj(sys, { idx: -1 });
      note(TR('找到了：') + displayName(sys) + TR('（') + TR(defn.name) + TR('，扫了 ') + (tried + 1) + TR(' 个恒星系）'));
    }
    function selRandomSystemOff() {
      if (!st.galaxy) { note(TR('还没有进入任何星系：先在宇宙网层选一个星系')); return; }
      var why = busyReason(); if (why) { note(why); return; }
      /* 位置要锚到旋臂上，不能均匀撒在画面里。恒星绝大多数集中在旋臂与核球，臂间是相对空的；
         原来这里直接拿 rnd2() 的均匀 (u,v) 当位置，于是"随机选一个（目录外）"经常把高亮圈
         放进虚空——用户看出来了。目录内的路径本来就走 sysAnchor（从旋臂点表里取点），
         这里改成同一条路：先按 (u,v) 派生种子（保持地址与种子的对应关系不变），
         再用这个种子去旋臂点表上取锚点。 */
      var uv = rnd2(), sseed = sysSeedAt(uv[0], uv[1]), sys = makeSystemSafe(sseed); if (!sys) return;
      var pos = sysAnchor(sseed);
      setSel({ kind: 'system', idx: -1, obj: sys, gi: pos.gi, u: pos.u != null ? pos.u : uv[0], v: pos.v != null ? pos.v : uv[1], box: false });
      if (st.sel && st.sel.kind === 'system') enterSelected();
    }
    function stepSystem(dir) {
      var why = busyReason(); if (why) { note(why); return; }
      var base = (st.sel && st.sel.kind === 'system') ? st.sel.idx : anchorIdx('system', sysIndex());
      selSystemAt(base < 0 ? (dir > 0 ? 0 : -1) : base + dir);
      if (st.sel && st.sel.kind === 'system') enterSelected();      // 步进即换，见 stepGalaxy 的说明
    }
    // 星系层的高亮位置：在旋臂点表里挑一个确定的点（跟着旋臂转）；拿不到点表就退回一个确定的比例位置
    function sysAnchor(sseed) {
      if (st.galaxy) { try { ensureGalPts(); } catch (e) { /* ignore */ } }
      var n = galPts ? galPts.length : 0;
      if (n) return { gi: (sseed >>> 0) % n, u: null, v: null };
      var r = A.rng(sseed >>> 0);
      return { gi: null, u: 0.3 + r() * 0.4, v: 0.3 + r() * 0.4 };
    }
    /* ---------- 行星候选
     * 索引一律按对象/`_pv`/`_origName` 比（indexOfPlanet），**绝不按显示名比**：
     * 起名字那个功能会把 name 改写成「自定义（原名）」，按显示名匹配一改名就全找不到，
     * 地表层的「← 上一颗 / 下一颗 →」当场失效。 */
    function planetList() { return (st.system && st.system.planets) || []; }
    function planetIndex() { return indexOfPlanet(st.planet); }
    function selPlanetAt(i, sys) {
      if (MAX_LEVEL < 3) { note(TR('这个维数没有可进入的行星层')); return; }
      sys = sys || st.system;
      var ps = (sys && sys.planets) || []; if (!ps.length) { note(TR('这个恒星系里没有行星')); return; }
      i = ((i % ps.length) + ps.length) % ps.length;
      setSel({ kind: 'planet', idx: i, obj: ps[i], system: sys });
    }
    function selRandomPlanet() {
      var why = busyReason(); if (why) { note(why); return; }
      var ps = planetList(); if (!ps.length) { note(TR('这个恒星系里没有行星')); return; }
      var cur = (st.sel && st.sel.kind === 'planet' && st.sel.system === st.system) ? st.sel.idx : planetIndex();
      selPlanetAt(pickIdx(ps.length, cur), st.system);
      if (st.sel && st.sel.kind === 'planet') enterSelected();
    }
    /* 跨恒星系随机选一颗：老的「随机换一颗」走的是 pv.visitNext，那个 API 自己就把视图切走了
       （= 又变成"点一下就掉下去"）。这里改成自己抽一个恒星系种子、生成、再抽一颗行星，全程不动视图。 */
    function selRandomPlanetElsewhere() {
      if (!st.galaxy) { note(TR('还没有进入任何星系：先在宇宙网层选一个星系')); return; }
      var why = busyReason(); if (why) { note(why); return; }
      if (MAX_LEVEL < 3) { selRandomSystem(); return; }     // 轨道投影演示：换恒星系而不是换星球
      var ss = systemSeeds(), sseed, idx = -1;
      if (ss.length) { idx = pickIdx(ss.length, sysIndex()); sseed = ss[idx]; }
      else { var uv = rnd2(); sseed = sysSeedAt(uv[0], uv[1]); }
      var sys = makeSystemSafe(sseed); if (!sys) return;
      var ps = (sys.planets) || [];
      if (!ps.length) { note(TR('随机到的恒星系里没有行星，再点一次换一个')); return; }
      selPlanetAt(pickIdx(ps.length, -1), sys);
      if (st.sel && st.sel.kind === 'planet') enterSelected();
    }
    // 到头循环（而不是灰显）：这一层的目的是"挨个看一遍"，走到尽头卡住只会让人以为坏了
    function stepPlanet(dir) {
      var why = busyReason(); if (why) { note(why); return; }
      var ps = planetList(); if (!ps.length) { note(TR('这个恒星系里没有行星')); return; }
      var same = st.sel && st.sel.kind === 'planet' && st.sel.system === st.system;
      var base = same ? st.sel.idx : anchorIdx('planet', planetIndex());
      selPlanetAt(base < 0 ? (dir > 0 ? 0 : -1) : base + dir, st.system);
      if (st.sel && st.sel.kind === 'planet') enterSelected();      // 步进即换，见 stepGalaxy 的说明
    }
    /* ---------- 进入：整个下潜/换层只有这一处出口 */
    /* 记住每一层最后一次待过的**目录位置**。
       「随机选一个…（目录外）」进去的对象不在目录里，此时 galIndex()/sysIndex()/planetIndex()
       返回 -1，步进就会从列表开头重来——用户报的"随机之后按上一个/下一个功能不对"就是这个：
       随机跳到目录外的恒星系，再按下一个直接弹回 1/12，原来的位置全丢。
       有了这个记忆，目录外的对象也能从"你上次在目录里的位置"继续往下走。 */
    var lastIdx = { galaxy: -1, system: -1, planet: -1 };
    function anchorIdx(kind, cur) { return cur >= 0 ? cur : (lastIdx[kind] != null ? lastIdx[kind] : -1); }
    /* ---------- 访问历史（像浏览器的后退）
       「← 上一个星系 / 下一个恒星系」是在**目录里**退一格 / 进一格，那不是"回到我刚才待过的地方"：
       随机跳走之后就回不去了。这里另开一条历史栈，记录你实际待过的位置，
       「← 返回上一处」按原路退回，跨层也管用（Alt+← 或 Backspace 之外的独立入口）。 */
    var visitHist = [], HIST_MAX = 60, histRestoring = false;
    function snapNow() {
      if (!st.galaxy && !st.system && !st.planet) return null;
      return { level: st.level, galaxy: st.galaxy, system: st.system, planet: st.planet, T: st.T };
    }
    function sameSpot(a, b) {
      if (!a || !b) return false;
      return a.level === b.level && a.galaxy === b.galaxy && a.system === b.system && a.planet === b.planet;
    }
    function pushHist() {
      if (histRestoring) return;                       // 后退过程本身不再记历史，否则会来回打转
      var cur = snapNow(); if (!cur) return;
      var top = visitHist[visitHist.length - 1];
      if (sameSpot(cur, top)) return;                  // 原地不动不记
      visitHist.push(cur);
      if (visitHist.length > HIST_MAX) visitHist.shift();
    }
    function goBackVisit() {
      var why = busyReason(); if (why) { note(why); return; }
      var cur = snapNow(), prev = null;
      while (visitHist.length) { var c = visitHist.pop(); if (!sameSpot(c, cur)) { prev = c; break; } }
      if (!prev) { note(TR('没有更早的位置了')); return; }
      histRestoring = true;
      try {
        if (prev.T != null) st.T = prev.T;
        if (prev.planet && prev.system) { st.galaxy = prev.galaxy; enterPlanetSel({ kind: 'planet', obj: prev.planet, system: prev.system, idx: -1 }); if (prev.level === 4 && st.level === 3) enterSurface(); }
        else if (prev.system) { st.galaxy = prev.galaxy; enterSystemObj(prev.system, { idx: -1 }); }
        else if (prev.galaxy) { enterGalaxyObj(prev.galaxy, { idx: -1 }); }
        else { goLevel(0); }
      } catch (e) { console.error('[mirror] 返回上一处失败：', e); note(TR('回不去了：') + (e && e.message ? e.message : e)); }
      histRestoring = false;
      refreshUI();
    }
    function enterSelected() {
      var s = st.sel;
      if (!s || !s.obj) { note(TR('还没有选中任何目标：先点「随机选一个…」，或用「← 上一个 / 下一个 →」挑一个')); return; }
      var why = busyReason(); if (why) { note(why); return; }
      if (s.idx >= 0 && lastIdx[s.kind] != null) lastIdx[s.kind] = s.idx;   // 只记目录内的位置
      st.sel = null; syncSelToPV(); renderActions();        // 选中已经被消费掉，动作条先收起「进入」
      if (s.kind === 'galaxy') enterGalaxyObj(s.obj, s);
      else if (s.kind === 'system') enterSystemObj(s.obj, s);
      else enterPlanetSel(s);
    }
    // 选中项在屏幕上的位置：缩放过渡的中心，也是高亮圈画在哪
    function selPoint(s, W, H) {
      if (s && s.gi != null && galPts && galPts[s.gi]) return galPtScreen(galPts[s.gi], W, H);
      if (s && s.box) { var S0 = Math.min(W, H) * 0.98, ox = (W - S0) / 2, oy = (H - S0) / 2; return [ox + s.u * S0, oy + s.v * S0]; }
      if (s && s.u != null) return [s.u * W, s.v * H];
      return [W / 2, H / 2];
    }
    function enterGalaxyObj(g, s, cx, cy) {
      if (!g) return;
      if (g !== st.galaxy) pushHist();          // 换星系之前先把当前位置记进历史
      cancelLocate();
      st.galaxy = g; galPts = null; st.system = null; st.planet = null;
      if (st.level >= 1) { st.level = 1; refreshUI(); return; }        // 已经在星系层：原地换，不做缩放过渡
      var W = box.clientWidth || 900, H = box.clientHeight || 600, pt = selPoint(s, W, H);
      startTrans(cx == null ? pt[0] : cx, cy == null ? pt[1] : cy, function () { st.level = 1; refreshUI(); });
    }
    function enterSystemObj(sys, s) {
      if (!sys) return;
      if (sys !== st.system) pushHist();
      cancelLocate();
      if (st.galaxy && st.T < st.galaxy.tFormYr) setT(0, false);       // 星系还没形成：先回到现在
      st.system = sys; st.planet = null;
      if (st.level >= 2) { enterSystemLevel(); return; }               // 原地换一个恒星系，不做缩放过渡
      var W = box.clientWidth || 900, H = box.clientHeight || 600, pt = selPoint(s, W, H);
      startTrans(pt[0], pt[1], function () { enterSystemLevel(); });
    }
    function enterPlanetSel(s) {
      if (MAX_LEVEL < 3) { note(TR('这个维数没有可进入的行星层')); return; }
      if (s && s.obj !== st.planet) pushHist();
      var wasSurface = st.level === 4 && MAX_LEVEL >= 4, cam = st.cam;
      if (s.system && s.system !== st.system) { st.system = s.system; applyNames(st.system); }   // 跨恒星系：先把恒星系换过去
      if (wasSurface) {
        /* 地表层换星球：**直接**换到新星球的同一经纬，不走"先回星球视图再降落"那条路。
           老写法是 selectPlanet(→ 星球层 + 一张新贴图) 紧跟 enterSurface(→ 地表)，两件事都是异步的：
             · pv 路径上白生成一张 512×256 的星球贴图；
             · 2D 回退路径上 selectPlanet 用的是 startTrans，回调半秒后才把 level 设成 3，
               正好盖掉 enterSurface 刚设好的 4 —— 人在地表按「下一颗」会被弹回星球层。 */
        st.planet = s.obj; st.planetTex = null; st.planetTexKey = ''; st.surfTex = null; st.surfKey = '';
        st.cam = { lat: cam.lat, lon: cam.lon, alt: cam.alt };
        enterSurface(cam.lat, cam.lon);
        return;
      }
      selectPlanet(s.obj);
    }
    /* ---------- 计数与提示文案：有选中时报"选中的那个"，没有就报"当前这个" */
    function selIdxOf(kind) { return (st.sel && st.sel.kind === kind) ? st.sel.idx : null; }
    function countText(sel, cur, n) {
      if (!n) return '';
      var i = sel == null ? cur : sel;
      return (sel == null ? '' : TR('选中 ')) + (i < 0 ? TR('自选') : i + 1) + ' / ' + n;
    }
    function planetCountText() {
      var sel = selIdxOf('planet'), ps = planetList();
      if (sel != null && st.sel.system !== st.system) return TR('选中 ') + (sel + 1) + ' / ' + ((st.sel.system.planets || []).length) + TR('（另一个恒星系）');
      return countText(sel, planetIndex() < 0 ? 0 : planetIndex(), ps.length);
    }
    function planetSwitchTitle() { return TR('直接换到本恒星系的另一颗（共 ') + planetList().length + TR(' 颗，到头循环）：按一下就换过去，不是只选中 · 快捷键 , / .'); }
    function galSwitchTitle() { return galSourceNote() + TR('，到头循环：按一下就直接换过去，不是只选中 · 快捷键 PageUp / PageDown'); }
    function sysSwitchTitle() { return TR('在本星系的恒星系目录里步进（共 ') + systemSeeds().length + TR(' 个，按星系种子派生，到头循环）：按一下就直接换过去，不是只选中 · 快捷键 PageUp / PageDown'); }
    function renderActions() {
      actions.innerHTML = '';
      /* 每个动作都套一层 try/catch：动作里任何一处抛错（比如某个字段形状变了），
         浏览器只会把异常吞进事件派发，用户看到的就是"点了没反应"。这里改成明确报错。 */
      function btn(label, fn, primary, title) {
        var b = el('button', 'mb-btn' + (primary ? ' primary' : ''), label); b.type = 'button'; if (title) b.title = title;
        b.addEventListener('click', function () {
          try { fn(); }
          catch (e) { console.error('[mirror] 动作「' + label + '」出错：', e); note(TR('这一步没能执行：') + (e && e.message ? e.message : e) + TR('（详见控制台）')); }
        });
        actions.appendChild(b); return b;
      }
      function counter(txt) { var s = el('span', 'mb-count', txt); actions.appendChild(s); return s; }
      var ourGal = !!(st.galaxy && st.galaxy.ours);
      var sel = st.sel, hasSel = !!(sel && sel.obj);
      /* 有选中项时，「进入」永远排在最前面并且是唯一的主按钮：
         用户要的是"先看清楚再决定进不进"，那个决定必须一眼就能找到。 */
      if (hasSel) {
        btn(TR('进入：') + selName(sel), enterSelected, true, TR('进入选中的') + selKindName(sel.kind) + TR('（快捷键 Enter；在画面上双击也是直接进入）'));
        btn(TR('取消选择'), clearSel, false, TR('放弃这次选中，留在当前这一层'));
      }
      if (st.level === 0) {
        // 定位银河系是"确定的目标"，不是随机挑，点了就按观测目录进去（与双击同一类：意图没有歧义）
        if (ours) btn(TR('定位银河系（观测目录）'), locateGalaxy, !hasSel, TR('按观测目录直接进入银河系（这一条是确定的目标，点了就进）'));
        btn(TR('随机选一个星系'), selRandomGalaxy, !ours && !hasSel, TR('在星系目录里随机挑一个：只选中并给出它的详细信息，不进入；再点一次换下一个'));
        if (galaxyCatalog().length > 1) {
          btn(TR('← 上一个'), function () { stepGalaxy(-1); }, false, galSwitchTitle());
          btn(TR('下一个 →'), function () { stepGalaxy(1); }, false, galSwitchTitle());
          // 宇宙网层没有"当前星系"可言：没选中就只报总数，别把上一次进过的那个说成"当前第 k 个"
          counter(selIdxOf('galaxy') == null ? TR('共 ') + galaxyCatalog().length + TR(' 个') : galCountText());
        }
      }
      if (st.level === 1) {
        if (ours && ourGal) btn(TR('定位太阳（观测目录）'), locateSun, !hasSel, TR('按观测目录直接进入太阳系（确定的目标，点了就进）'));
        btn(TR('随机选一个恒星系'), selRandomSystem, !(ours && ourGal) && !hasSel, TR('在本星系的恒星系目录里随机挑一个：只选中，不进入；再点一次换下一个'));
        btn(TR('← 上一个星系'), function () { stepGalaxy(-1); }, false, galSwitchTitle());
        btn(TR('下一个星系 →'), function () { stepGalaxy(1); }, false, galSwitchTitle());
        var gc = galCountText(); if (gc) counter(gc);
        btn(TR('随机选一个星系（目录外）'), selRandomGalaxyOff, false, TR('“目录”是这次 N 体模拟在盒子里识别出来的晕（按质量排序），数量由盒长/粒子数/这组参数决定，不是这个宇宙星系数量的上限。这个按钮不走目录，按种子另取一个并直接进入'));
      }
      if (st.level === 2 && MAX_LEVEL >= 3) {
        if (st.system && st.system.ours) btn(TR('定位地球（调出储存的坐标）'), function () { selectPlanet(st.system.planets[2]); }, !hasSel, TR('按储存的坐标直接进入地球（确定的目标，点了就进）'));
        btn(TR('随机选一颗星球'), selRandomPlanet, !(st.system && st.system.ours) && !hasSel, TR('在本恒星系里随机挑一颗行星并直接进入；再点一次换下一颗。想先看信息再决定，用右键菜单里的「只选中」'));
        btn(TR('← 上一个恒星系'), function () { stepSystem(-1); }, false, sysSwitchTitle());
        btn(TR('下一个恒星系 →'), function () { stepSystem(1); }, false, sysSwitchTitle());
        var sc = sysCountText(); if (sc) counter(sc);
        btn(TR('随机选一个恒星系（目录外）'), selRandomSystemOff, false, TR('“目录”是按星系种子派生出的恒星系列表，只是一份可枚举的清单，不是这个星系恒星数量的上限。这个按钮不走目录，另取一个并直接进入'));
      }
      if (st.level === 2 && MAX_LEVEL < 3) {   // 轨道投影演示到此为止：只能换恒星系
        btn(TR('随机选一个恒星系'), selRandomSystem, !hasSel, TR('随机挑一个恒星系：只选中，按 Enter / 点「进入」才换过去'));
        btn(TR('← 上一个恒星系'), function () { stepSystem(-1); }, false, sysSwitchTitle());
        btn(TR('下一个恒星系 →'), function () { stepSystem(1); }, false, sysSwitchTitle());
        var sc2 = sysCountText(); if (sc2) counter(sc2);
      }
      // 行星层/地表层：本系内前后选中 + 序号，跨恒星系的随机另算一个动作，三者的 title 各自说清楚
      if (st.level === 3 || st.level === 4) {
        if (st.level === 3) btn(TR('降低高度（滚轮）'), function () { enterSurface(st.cam.lat, st.cam.lon); }, !hasSel, TR('降到这颗星球的地表（当前这颗，不用先选）'));
        else { btn(TR('急剧下降（双击）'), function () { dive(); }); btn(TR('升高'), function () { changeAlt(1 / 1.3, 6); }); }
        btn(TR('← 上一颗'), function () { stepPlanet(-1); }, false, planetSwitchTitle());
        btn(TR('下一颗 →'), function () { stepPlanet(1); }, false, planetSwitchTitle());
        var ct = planetCountText(); if (ct) counter(ct);
        btn(TR('随机选一颗（换恒星系）'), selRandomPlanetElsewhere, false, TR('随机挑另一个恒星系的一颗星球：只选中，进入才会离开当前恒星系'));
      }
      if (st.level > 0) btn(TR('返回上一级'), function () { goLevel(st.level - 1); });
      // 「返回上一处」按访问历史原路退回，与「返回上一级」是两回事：后者是升一层，前者是回到刚才待过的地方
      if (visitHist.length) btn(TR('← 返回上一处'), goBackVisit, false, TR('按你实际走过的路线退回上一个位置（跨层也管用，共 ') + visitHist.length + TR(' 步可退）· 快捷键 Alt+←'));
    }
    /* 可点选的星系列表：默认收起（<details>），展开状态记在 st 上，重绘信息面板时不会自己合上。
       质量与距离只在有晕表时才是"算出来的"，示意来源那一档明确写清楚，不冒充结果。 */
    function fmtMass(m) {
      if (!isFinite(m)) return '—';
      var e = Math.floor(Math.log10(m));
      return (m / Math.pow(10, e)).toFixed(1) + '×10' + String(e).replace(/\d/g, function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]; }) + ' M☉';
    }
    function galListHTML() {
      var l = galaxyCatalog(); if (!l.length) return '';
      var cur = galIndex(), sim = GAL_SRC === 'sim', selI = selIdxOf('galaxy');
      var rows = l.map(function (g, i) {
        var cells = '<span class="gl-i">' + (i + 1) + '</span><span class="gl-n">' + displayName(g, kGalaxy(g), { html: true }) + '</span>' +
          '<span class="gl-k">' + esc(TR(g.kind)) + '</span>' +
          '<span class="gl-m">' + (sim && isFinite(g.mass) ? esc(fmtMass(g.mass)) : '—') + '</span>' +
          '<span class="gl-d">' + (sim && g.distMpc ? esc(g.distMpc.toFixed(1)) + ' Mpc' : '—') + '</span>';
        return '<li><button type="button" class="gl-row' + (i === cur ? ' cur' : '') + (i === selI ? ' sel' : '') + '" data-gi="' + i + '"' +
          ' title="' + esc(TR('单击选中（只看信息）· 双击直接进入')) + '"' +
          (i === cur ? ' aria-current="true"' : '') + (i === selI ? ' aria-selected="true"' : '') + '>' + cells + '</button></li>';
      }).join('');
      return '<details class="mb-gals"' + (st.galsOpen ? ' open' : '') + '>' +
        '<summary>' + esc(galSourceNote()) + (cur >= 0 ? TR(' · 当前第 ') + (cur + 1) + TR(' 个') : '') + (selI != null && selI >= 0 ? TR(' · 已选中第 ') + (selI + 1) + TR(' 个（未进入）') : '') + '</summary>' +
        '<div class="gl-head"><span class="gl-i">#</span><span class="gl-n">' + TR('名称') + '</span><span class="gl-k">' + TR('形态') + '</span><span class="gl-m">' + TR('质量') + '</span><span class="gl-d">' + TR('距盒心') + '</span></div>' +
        '<ul class="gl-list">' + rows + '</ul>' +
        (sim ? '' : '<p class="mb-src">' + TR('这一档没有 3D 晕表：列表由种子生成，质量与距离不适用。') + '</p>') +
        '</details>';
    }
    /* 列表是 innerHTML 重绘出来的，事件用委托绑一次（renderInfo 每帧可能重画）。
       单击 = 选中（和"随机选一个"一样，只给信息不换层）；双击 = 明确要进去，直接进。 */
    info.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.gl-row') : null;
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      var gi = Number(b.getAttribute('data-gi')) || 0;
      // 再点一次已经选中的那一行 = 进入（和 planets.js 画布上的约定一致，触屏上也用得了）
      var again = !!(st.sel && st.sel.kind === 'galaxy' && st.sel.idx === gi);
      // 和动作条按钮同样的保护：抛错要说出来，不能"点了没反应"，更不能把人踢出镜像
      try { if (again) enterSelected(); else selGalaxyAt(gi); }
      catch (e) { console.error('[mirror] ' + (again ? '进入' : '选中') + '星系 #' + (gi + 1) + ' 出错：', e && e.stack || e); note('这个星系没能' + (again ? '进入' : '选中') + '：' + (e && e.message ? e.message : e) + '（详见控制台）'); }
    });
    info.addEventListener('dblclick', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.gl-row') : null;
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      var gi = Number(b.getAttribute('data-gi')) || 0;
      try { st.sel = null; gotoGalaxy(gi); }
      catch (e) { console.error('[mirror] 进入星系 #' + (gi + 1) + ' 出错：', e && e.stack || e); note('进不去这个星系：' + (e && e.message ? e.message : e) + '（详见控制台）'); }
    });
    info.addEventListener('toggle', function (ev) {
      var d = ev.target; if (d && d.classList && d.classList.contains('mb-gals')) st.galsOpen = !!d.open;
    }, true);
    /* ---------- 选中项的信息卡
     * 钉在信息面板最上面，与"当前所在层"的信息分开：选中不改变层级，所以下面那一整块
     * （标题 / 重命名 / 目录列表）仍然属于当前层。卡片里给的是这个候选的完整信息，
     * 用的就是各层自己那套字段与依据标注，不另编一套说法。 */
    function selDLGalaxy(g) {
      var formed = st.T >= g.tFormYr, dl = '<dl><dt>' + TR('类型') + '</dt><dd>' + esc(TR(g.kind)) + '</dd>' +
        '<dt>' + TR('直径') + '</dt><dd>' + TR('约 ') + g.diameterKly + TR(' 千光年') + '</dd><dt>' + TR('恒星') + '</dt><dd>' + esc(g.stars) + '</dd>' +
        '<dt>' + TR('形成') + '</dt><dd>' + TR('距今 ') + (-g.tFormYr / 1e8).toFixed(1) + TR(' 亿年') + '</dd>' +
        (isFinite(g.mass) && GAL_SRC === 'sim' ? '<dt>' + TR('质量') + '</dt><dd>' + esc(fmtMass(g.mass)) + '</dd>' : '') +
        (GAL_SRC === 'sim' && g.distMpc ? '<dt>' + TR('距盒心') + '</dt><dd>' + g.distMpc.toFixed(1) + ' Mpc</dd>' : '') +
        '<dt>' + TR('此刻') + '</dt><dd>' + (formed ? TR('已经形成') : TR('尚未形成——只有正在坍缩的气体')) + '</dd></dl>';
      return dl + '<p class="mb-src">' + esc(galSourceNote()) + '</p>';
    }
    function selDLSystem(s) {
      var T = st.T, ring = T < s.tPlanetsYr, ps = s.planets || [];
      /* D≠3 的轨道投影演示：**选中卡也要说同一套话**。
         这块卡片原来没有 orbitDemo 分支，于是在 D=14 的宇宙里，屏幕上同时出现两段互相打脸的话：
           选中卡：「光谱型 G2V · 行星 5 颗 · 此刻：行星已经诞生 · 气态巨行星 · 5.2 AU · 11.8 年 · 14 卫」
           进去之后的面板：「该维数下无行星可言，仅演示引力律的后果」
         行星表、光谱型、恒星演化（主序寿命 / 演化阶段）全都出自 3 维的恒星与行星模型，
         在这个维数下不成立；照抄进入后那一层的口径，只留积分真正用得到的两件事。 */
      if (dimMode === 'orbitDemo') {
        var pvs0 = s && s._pv, mRel0 = pvs0 && pvs0.star && pvs0.star.massRel;
        return '<dl>' +
          '<dt>' + TR('质量') + '</dt><dd>' + (mRel0 != null ? esc(String(mRel0)) + ' M' : 'M') + '<span class="mb-dim">' + TR('（相对我们的太阳，仅作积分单位）') + '</span></dd>' +
          '<dt>' + TR('引力律') + '</dt><dd>F ∝ r^{−' + fmtExp(dimS - 1) + '}（D=' + dimS.toFixed(2) + '）</dd>' +
          '<dt>' + TR('行星') + '</dt><dd>' + TR('不给数') + '<span class="mb-dim">' + TR('（本引擎不为 D≠3 生成行星：行星形成、恒星结构与地表公式都只对 3 维成立）') + '</span></dd>' +
          '</dl><p class="mb-src">' + esc(MODE_BANNER) + '</p>';
      }
      var h = '<dl><dt>' + TR('光谱型') + '</dt><dd>' + esc(TR(s.cls)) + '</dd><dt>' + TR('形成') + '</dt><dd>' + TR('距今 ') + (-s.tFormYr / 1e8).toFixed(1) + TR(' 亿年') + '</dd>' +
        '<dt>' + TR('行星') + '</dt><dd>' + ps.length + TR(' 颗') + '</dd>' +
        '<dt>' + TR('此刻') + '</dt><dd>' + (T < s.tFormYr ? TR('尚未形成') : ring ? TR('还只有原行星盘（行星没有诞生）') : bornText()) + '</dd></dl>' + dimExtrapNote();
      if (!ring && T >= s.tFormYr && ps.length) {
        h += '<ul class="mb-planets">' + ps.map(function (p, i) {
          return '<li>' + displayName(p, kPlanetAt(i, s), { html: true }) + ' <span class="mb-dim">' + esc(typeName(p)) + ' · ' + p.au + ' AU · ' + p.period + TR(' 年') + moonTag(p) + '</span>' +
            (p.life && T > p.tFormYr + 1e9 ? ' <span class="mb-life">' + TR('有生命') + '</span>' : '') + '</li>';
        }).join('') + '</ul>';
      }
      return h + starEngineHTML(s) + starStageHTML(s);
    }
    function selDLPlanet(p, sys) {
      var T = st.T, ep = epochOf(p, T), pvp = p && p._pv;
      var h = '<dl><dt>' + TR('类型') + '</dt><dd>' + esc(typeName(p)) + '</dd><dt>' + TR('轨道') + '</dt><dd>' + p.au + TR(' AU · 周期 ') + p.period + TR(' 年') + '</dd>' +
        '<dt>' + TR('半径') + '</dt><dd>' + Math.round(p.radius) + ' km</dd>' +
        (sys && sys !== st.system ? '<dt>' + TR('所在') + '</dt><dd>' + displayName(sys, kSystem(sys), { html: true }) + '<span class="mb-dim">' + TR('（另一个恒星系）') + '</span></dd>' : '') +
        '<dt>' + TR('此刻') + '</dt><dd>' + (ep ? esc(TR(String(EPOCH_TEXT[ep] || '').split('：')[0])) : TR('尚未形成')) + '</dd></dl>';
      h += '<p class="mb-p">' + (ep ? esc(TR(String(EPOCH_TEXT[ep] || '').replace(/示意。$/, ''))) : TR('行星尚未形成——只有尘埃与碎块。')) + '</p>';
      if (pvp && (pvp.desc || pvp.description)) h += '<p class="mb-p">' + esc(pvp.description || pvp.desc) + '</p>';
      if (!NO_LIFE && p.life && ep && ep !== 'magma') h += '<p class="mb-p mb-life">' + TR('有生物圈') + '</p>';
      if (NO_LIFE) h += '<p class="mb-p mb-dim">' + (NO_LIFE_WHY === 'dim'
        ? 'D=' + dimS.toFixed(2) + TR('：本引擎不为 D≠3 判定生命，这颗天体上不会有生物圈。')
        : TR('无分子化学：这颗行星上不会有生命。')) + '</p>';
      return h + moonsHTML(p) + '<p class="mb-src">' + TR('进入之后还会给出行星参数、派生量与完整报告（engine/planet.js）。') + '</p>';
    }
    function selCardHTML() {
      var s = st.sel; if (!s || !s.obj) return '';
      var h = '<div class="mb-sel"><div class="mb-sel-top"><span class="mb-sel-tag">' + TR('已选中的') + esc(selKindName(s.kind)) + TR(' · 还没进入') + '</span>' +
        '<span class="mb-count">' + esc(selCountText(s)) + '</span></div>' +
        '<h3 class="mb-sel-name">' + displayName(s.obj, selKey(s), { html: true }) + '</h3>';
      try {
        h += s.kind === 'galaxy' ? selDLGalaxy(s.obj) : s.kind === 'system' ? selDLSystem(s.obj) : selDLPlanet(s.obj, s.system);
      } catch (e) { console.warn('[mirror] 选中项信息渲染失败：', e); h += '<p class="mb-src">' + TR('这个候选的详细信息没能渲染（详见控制台），但仍然可以进入。') + '</p>'; }
      return h + '<p class="mb-sel-hint">' + TR('按 Enter 或点「进入：') + esc(selName(s)) + TR('」才会') + (s.kind === 'planet' && st.level >= 3 ? TR('换过去') : TR('下潜')) +
        TR('；再点一次「随机选一个…」可以换一个候选。') + '</p></div>';
    }
    function selCountText(s) {
      if (!s) return '';
      if (s.kind === 'galaxy') return (s.idx < 0 ? TR('目录外自选') : TR('第 ') + (s.idx + 1) + ' / ' + galaxyCatalog().length + TR(' 个'));
      if (s.kind === 'system') return (s.idx < 0 ? TR('目录外自选') : TR('第 ') + (s.idx + 1) + ' / ' + systemSeeds().length + TR(' 个'));
      var n = ((s.system && s.system.planets) || []).length;
      return TR('第 ') + (s.idx + 1) + ' / ' + n + TR(' 颗') + (s.system && s.system !== st.system ? TR(' · 另一个恒星系') : '');
    }
    var RI_SEG = null;   // renderInfo 的内部分段（长文本各段 + DOM 写入），进层计时时一并带出去
    function renderInfo() {
      var _r0 = nowMs2(), _seg = {};
      var h = '';
      var T = st.T;
      // 重绘会把内联输入框冲掉：先把没提交的草稿收起来，重绘后再填回去
      var oldIn = info.querySelector('#mbRenIn'); if (oldIn) st.renameDraft = oldIn.value;
      if (st.locateLog.length) h +='<div class="mb-log">' + st.locateLog.map(function (l) { return '<div>' + esc(TR(l)) + '</div>'; }).join('') + '</div>';
      h += selCardHTML();
      if (st.level === 0) {
        h += titleHTML() + '<dl><dt>' + TR('半径') + '</dt><dd>' + TR('约 ') + Math.round(sim.report.radiusGly * 10) + TR(' 亿光年') + '</dd><dt>' + TR('宏观维数') + '</dt><dd>' + (isFinite(sim.report.dimension) ? Number(sim.report.dimension).toFixed(2) : esc(String(sim.report.dimension))) + '</dd><dt>' + TR('时刻') + '</dt><dd>' + esc(fmtT(T)) + '</dd></dl>';
        h += '<p class="mb-p">' + (ours ? TR('本星系群成员按 McConnachie 2012 目录放置（位置为观测值，形态为示意）。列表里单击一行 = 选中，双击 = 直接进入；画面上双击任意处也直接进入该处星系。') : TR('列表里单击一行 = 选中（只看信息），双击 = 直接进入；画面上双击任意处也直接进入该处星系。这个宇宙里的星系、恒星与行星都由创世参数决定。')) + '</p>';
        h += galListHTML();
      } else if (st.level === 1 && st.galaxy) {
        var g = st.galaxy, formed = T >= g.tFormYr;
        h += titleHTML() + '<dl><dt>' + TR('类型') + '</dt><dd>' + esc(TR(g.kind)) + '</dd><dt>' + TR('直径') + '</dt><dd>' + TR('约 ') + g.diameterKly + TR(' 千光年') + '</dd><dt>' + TR('恒星') + '</dt><dd>' + esc(g.stars) + '</dd><dt>' + TR('状态') + '</dt><dd>' + (formed ? TR('以漆黑的太空为背景，一个银色大旋涡') : TR('尚未形成——只有正在坍缩的气体')) + '</dd></dl>' + dimExtrapNote();
        h += '<p class="mb-p">' + (g.ours ? TR('银河系：S(B)bc，盘直径约 30 kpc；太阳距银心 8.178 kpc（GRAVITY 2019）。双击旋臂任意处直接进入该处恒星系，或用“随机选一个恒星系”先选中再决定。') : TR('双击旋臂任意处直接进入该处恒星系，或用“随机选一个恒星系”先选中再决定。')) + '</p>';
        var gi = galIndex();
        h += '<p class="mb-src">' + esc(galSourceNote()) + (gi >= 0 ? TR(' · 当前第 ') + (gi + 1) + TR(' 个') : TR(' · 当前这个不在目录里（双击自选）')) + '</p>';
        h += galListHTML();
      } else if (st.level === 2 && st.system && dimMode === 'orbitDemo') {
        // D≠3：这里没有"行星"可言，更没有岩质/气态之分——只有一组试探质点在演示引力律的后果。
        // 恒星那两项来自 3 维恒星模型，照实标注是外推。
        // 这个维数下没有"恒星"可言：恒星光谱型与形成时间都来自 3 维的恒星演化标度，在这里不适用。
        // 只留积分需要的两件事：中心质点的质量单位，和引力律。
        var so = st.system, pvs = so._pv, mRel = pvs && pvs.star && pvs.star.massRel;
        h += titleHTML() + '<dl>' +
          '<dt>' + TR('质量') + '</dt><dd>' + (mRel != null ? esc(String(mRel)) + ' M<span class="mb-dim">' + TR('（相对我们的太阳，仅作积分单位）') + '</span>' : 'M<span class="mb-dim">' + TR('（相对我们的太阳，仅作积分单位）') + '</span>') + '</dd>' +
          '<dt>' + TR('引力律') + '</dt><dd>F ∝ r^{−' + fmtExp(dimS - 1) + '}（D=' + dimS.toFixed(2) + '）</dd></dl>';
        /* 措辞按 D 分开：D≥4 轨道本身就不稳，说"无行星可言"是引擎判据；
           3<D<4 / 2<D<3 轨道其实稳定（只是进动），那就只能说"本引擎不为它生成行星"，
           不能替物理宣称行星不存在。 */
        h += '<div class="mb-demo-title">' + (ORBITS_UNSTABLE
          ? TR('试探质点（该维数下无稳定轨道，无行星可言，仅演示引力律的后果）')
          : TR('试探质点（本引擎不为 D≠3 生成行星，仅演示引力律的后果）')) + '</div>' +
          '<table class="mb-demo"><thead><tr><th>#</th><th>r₀</th><th>' + TR('状态') + '</th><th>' + TR('圈数') + '</th><th>' + TR('进动°/圈') + '</th></tr></thead><tbody id="mbDemoRows"></tbody></table>' +
          '<p class="mb-dim" id="mbDemoFoot"></p>';
      } else if (st.level === 2 && st.system) {
        var s = st.system, ring = T < s.tPlanetsYr;
        h += titleHTML() + '<dl><dt>' + TR('光谱型') + '</dt><dd>' + esc(TR(s.cls)) + '</dd><dt>' + TR('形成') + '</dt><dd>' + TR('距今 ') + (-s.tFormYr / 1e8).toFixed(1) + TR(' 亿年') + '</dd><dt>' + TR('状态') + '</dt><dd>' + (T < s.tFormYr ? TR('尚未形成') : ring ? TR('光球周围环绕着一个雾蒙蒙的大环：行星还没有诞生，这个星际尘埃构成的环就是它们的原材料') : bornText()) + '</dd></dl>' + dimExtrapNote();
        if (!ring && T >= s.tFormYr) {
          h += '<ul class="mb-planets">' + s.planets.map(function (p, i) { return '<li><button type="button" class="mb-plink" data-i="' + i + '">' + displayName(p, kPlanetAt(i), { html: true }) + '</button> <span class="mb-dim">' + esc(typeName(p)) + ' · ' + p.au + ' AU · ' + p.period + TR(' 年') + moonTag(p) + '</span>' + (p.life && T > p.tFormYr + 1e9 ? ' <span class="mb-life">' + TR('有生命') + '</span>' : '') + '</li>'; }).join('') + '</ul>';
        }
        var _a = nowMs2(); h += starEngineHTML(s); _seg.starEngine = Math.round(nowMs2() - _a);   // 恒星描述（光谱型/质量/温度/光度/寿命剩余/单星/宜居带/雪线）
        _a = nowMs2(); h += starStageHTML(s); _seg.starStage = Math.round(nowMs2() - _a);            // 演化阶段 / 遗迹 / 变星
        _a = nowMs2(); h += systemBodiesHTML(s); _seg.systemBodies = Math.round(nowMs2() - _a);      // 小行星带 · 柯伊伯带 · 彗星 · 盘 · 此刻路过的流浪行星
      } else if ((st.level === 3 || st.level === 4) && st.planet) {
        var p = st.planet, ep = epochOf(p, T);
        // 标题后面跟两个徽标：画面是过程生成的示意、数字是引擎算的
        // 2 维世界里恒星系那一层已经说"气态圆盘"，行星/地表层不能又改口叫"气态巨行星"：一律走 typeName()
        h += titleHTML(peBadges(p)) + '<dl><dt>' + TR('类型') + '</dt><dd>' + esc(typeName(p)) + '</dd><dt>' + TR('轨道') + '</dt><dd>' + p.au + TR(' AU · 周期 ') + p.period + TR(' 年') + '</dd><dt>' + TR('半径') + '</dt><dd>' + Math.round(p.radius) + ' km</dd>' + (st.level === 4 ? '<dt>' + TR('高度') + '</dt><dd>' + fmtAlt(st.cam.alt) + '</dd><dt>' + TR('坐标') + '</dt><dd>' + st.cam.lat.toFixed(2) + '°, ' + st.cam.lon.toFixed(2) + '°</dd>' : '') + '<dt>' + TR('时刻') + '</dt><dd>' + esc(fmtT(T)) + '</dd></dl>' + dimExtrapNote();
        h += '<p class="mb-p">' + (ep ? esc(TR(String(EPOCH_TEXT[ep] || '').replace(/示意。$/, ''))) : TR('行星尚未形成——只有尘埃与碎块。')) + '</p>';
        if (NO_LIFE) h += '<p class="mb-p mb-dim">' + (NO_LIFE_WHY === 'dim'
          ? 'D=' + dimS.toFixed(2) + TR('：本引擎不为 D≠3 判定生命，地表是无机世界。')
          : TR('无分子化学：这颗行星上不会有生命，地表是无机世界。')) + '</p>';
        if (!NO_LIFE && p.life && ep && ep !== 'magma') h += '<p class="mb-p mb-life">' + TR(ep === 'brownsea' ? '生物圈：原核生物与叠层石' : ep === 'civil' ? '生物圈：夜面出现人工光源' : ep === 'human' ? '生物圈：出现会制造工具的物种' : '生物圈：海洋中的光合生物') + '</p>';
        h += moonsHTML(p);          // 卫星表（名称/半径/轨道半径/周期/类型/潮汐加热）
        h += planetEngineHTML(p);   // 长描述 + 行星参数（折叠）+ 报告：来自 engine/planet.js
      }
      _seg.buildHTML = Math.round(nowMs2() - _r0); var _w = nowMs2();
      info.innerHTML = h;
      _seg.domWrite = Math.round(nowMs2() - _w); _w = nowMs2();
      if (dimMode === 'orbitDemo' && st.level === 2) updateDemoRows();
      _seg.demoRows = Math.round(nowMs2() - _w);
      _seg.total = Math.round(nowMs2() - _r0); _seg.htmlLen = h.length;
      RI_SEG = _seg;
      paintBanner();
      /* 行星名：单击 = 选中（信息卡里给完整信息），双击 = 直接进入。
         和星系列表、画布上的双击是同一套约定：单击只是"看看"，双击才是"我要进去"。 */
      Array.prototype.forEach.call(info.querySelectorAll('.mb-plink'), function (b) {
        b.title = TR('单击选中（只看信息）· 再点一次 / 双击直接进入');
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          var i = +b.getAttribute('data-i');
          // 再点一次已经选中的那一颗 = 进入
          if (st.sel && st.sel.kind === 'planet' && st.sel.system === st.system && st.sel.idx === i) enterSelected();
          else selPlanetAt(i, st.system);
        });
        b.addEventListener('dblclick', function (ev) { ev.preventDefault(); st.sel = null; selectPlanet(planetList()[+b.getAttribute('data-i')]); });
      });
      Array.prototype.forEach.call(info.querySelectorAll('details[data-pe]'), function (d) {
        d.addEventListener('toggle', function () { st.peOpen[d.getAttribute('data-pe')] = d.open; });
      });
      // 「数据：行星引擎计算（点开看每项依据）」——展开那两个折叠区并滚到第一个
      Array.prototype.forEach.call(info.querySelectorAll('.mb-tag-act'), function (t) {
        function openDetails() {
          var first = null;
          ['in', 'dv'].forEach(function (k) {
            var d = info.querySelector('details[data-pe="' + k + '"]');
            if (!d) return;
            d.open = true; st.peOpen[k] = true;
            if (!first) first = d;
          });
          if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
        }
        t.addEventListener('click', openDetails);
        t.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetails(); }
        });
      });
      bindRenameUI();
      alt.hidden = st.level !== 4;
      if (st.level === 4) alt.textContent = TR('高度 ') + fmtAlt(st.cam.alt);
      hint.textContent = (MAX_LEVEL < 3 && st.level >= 2)
        ? (TR('轨道投影演示：') + (ORBITS_UNSTABLE ? TR('这个维数没有稳定轨道') : TR('这个维数的轨道稳定但不闭合（进动）')) + TR('，本引擎也不为它生成球面地表，到恒星系为止 · 画面上的亮点是试探质点，不是行星，不能进入 · Backspace 返回 · [ ] 移动时间'))
        : (HINTS[st.level] || HINTS[0]);
    }
    /* 行星参数与报告：engine/planet.js 在观测到这颗星球时挂在 planet.params / planet.report 上。
       表格列 = 参数名（符号）/ 值 / 单位 / basis 标签；紧随一行给出依据（公式 + 出处）。引擎缺席则整段不出现。 */
    function peRows(rows, title, key) {
      if (!rows || !rows.length) return '';
      var body = rows.map(function (r) {
        /* 名称/单位/basis 是固定词（走词典），值与说明里嵌着数字（走模板）。 */
        return '<tr><td>' + esc(TR(r.name)) + (r.symbol && r.symbol !== '—' ? ' <span class="mb-dim">' + esc(TR(r.symbol)) + '</span>' : '')
          + '</td><td>' + esc(TX(String(r.value))) + '</td><td class="mb-dim">' + esc(TR(r.unit || '')) + '</td>'
          + '<td><span class="mb-bas ' + esc(r.basis) + '">' + esc(TR(r.basisLabel)) + '</span></td></tr>'
          + '<tr class="src"><td colspan="4">' + esc(TX(r.desc || '')) + (r.ref ? TR('　依据：') + esc(TX(r.ref)) : '') + '</td></tr>';
      }).join('');
      return '<details class="mb-params" data-pe="' + key + '"' + (st.peOpen[key] ? ' open' : '') + '><summary>' + esc(TR(title)) + TR('（') + rows.length + TR(' 项）') + '</summary>'
        + '<table class="mb-ptab"><thead><tr><th>' + TR('参数') + '</th><th>' + TR('值') + '</th><th>' + TR('单位') + '</th><th>basis</th></tr></thead><tbody>' + body + '</tbody></table></details>';
    }
    /* 顶部两个徽标：把"示意"一次说清楚——画面是过程生成的，数字是引擎算的 */
    function peBadges(p) {
      var pv = p && p._pv, has = !!(root.MirrorPlanetEngine && pv && pv.report);
      return '<div class="mb-tags">'
        + '<span class="mb-tag pic" title="' + esc(TR('地形、云、海面、灯光都是按种子过程生成的可视化，不是观测影像；只有太阳系的轨道与天体尺度用了真实数值。')) + '">' + TR('画面：过程生成的可视化（示意）') + '</span>'
        // 这个徽标写着"点开看每项依据"，那它就得真的能点：点一下把「行星参数」「派生量」
        // 两个折叠区展开并滚过去。原来它只是个带 title 的死标签，鼠标点上去毫无反应。
        + (has ? '<span class="mb-tag num mb-tag-act" role="button" tabindex="0" style="cursor:pointer"'
          + ' title="' + esc(TR('下面的每一个数字都由 engine/planet.js 从输入参数算出：真算给公式、标度给定标关系、启发式给判据。点这里展开「行星参数」「派生量」两个折叠区。')) + '">' + TR('数据：行星引擎计算（点开看每项依据）') + '</span>' : '')
        + '</div>';
    }
    /* 恒星系层：恒星的结构化描述 */
    /* ---------- 天体细节（数据来自 planets.js，这里只负责呈现）
     * 一律沿用既有风格：数值 + 依据 ref + 示意/数据标签；没有的字段就整块不出现，不编。 */
    function pvOf(x) { return x && x._pv ? x._pv : null; }
    // 行星列表每行的尾巴：卫星数 + 环
    function moonTag(p) {
      var v = pvOf(p); if (!v) return '';
      var n = v.moonCount != null ? v.moonCount : (v.moons ? v.moons.length : 0);
      var ring = !!(v.visual && v.visual.rings);
      return (n ? ' · ' + n + TR(' 卫') : '') + (ring ? TR(' · 环') : '');
    }
    function moonsData(p) {
      var v = pvOf(p); if (!v) return null;
      try { if (pv && typeof pv.moonsOf === 'function') return pv.moonsOf(v); } catch (e) { /* 退到模块级 */ }
      try { if (P && typeof P.moonsOf === 'function') { var l = P.moonsOf(v); return { count: l.length, rings: !!(v.visual && v.visual.rings), listed: l }; } } catch (e2) { /* ignore */ }
      return null;
    }
    function moonsHTML(p) {
      var m = moonsData(p); if (!m || (!m.count && !m.rings)) return '';
      var h = '<div class="mb-sub"><h4>' + TR('卫星与环') + ' <span class="mb-tag pic">' + TR('示意') + '</span></h4>';
      h += '<p class="mb-src">' + TR('共 ') + m.count + TR(' 颗卫星') + (m.rings ? TR(' · 有环系') : '') + '</p>';
      if (m.listed && m.listed.length) {
        h += '<table class="mb-moons"><thead><tr><th>' + TR('名称') + '</th><th>' + TR('半径') + '</th><th>' + TR('轨道半径') + '</th><th>' + TR('周期') + '</th><th>' + TR('类型') + '</th></tr></thead><tbody>' +
          m.listed.map(function (x) {
            return '<tr' + (x.tidalHeated ? ' class="tidal"' : '') + '><td>' + esc(x.name || '—') + '</td>' +
              '<td>' + (x.radiusKm != null ? esc(String(x.radiusKm)) + ' km' : '—') + '</td>' +
              '<td>' + (x.orbitKm != null ? esc(fmtKm(x.orbitKm)) : '—') + '</td>' +
              '<td>' + (x.periodDays != null ? esc(Number(x.periodDays).toFixed(2)) + TR(' 天') : '—') + '</td>' +
              '<td>' + esc(TR(MOON_TYPE_CN[x.type] || x.type || '—')) + (x.tidalHeated ? ' <span class="mb-hot">' + TR('潮汐加热') + '</span>' : '') + '</td></tr>';
          }).join('') + '</tbody></table>';
        var tidal = m.listed.filter(function (x) { return x.tidalHeated; });
        if (tidal.length) h += '<p class="mb-src">' + TR('潮汐加热的 ') + tidal.length + TR(' 颗：冰壳下可能有液态水海洋（木卫二/土卫二类比，示意）。') +
          esc(tidal[0].note && tidal[0].note.indexOf('木卫二') < 0 ? tidal[0].note : '') + '</p>';
      }
      return h + '</div>';
    }
    var MOON_TYPE_CN = { rock: '岩质', ice: '冰质', lava: '火山', desert: '有大气', ocean: '海洋' };
    function fmtKm(km) { return km >= 1e6 ? (km / 1e6).toFixed(2) + '×10⁶ km' : km >= 1e4 ? (km / 1e4).toFixed(1) + TR(' 万 km') : Math.round(km) + ' km'; }
    // 恒星演化阶段 + 变星：遗迹要写明前身质量与时间
    function starStageHTML(s) {
      var v = pvOf(s), star = v && v.star; if (!star) return '';
      var h = '', rows = [];
      if (star.stageName) rows.push([TR('演化阶段'), esc(TR(star.stageName)) + (star.spt ? TR('（') + esc(star.spt) + TR('）') : '')]);
      if (star.massInit != null) rows.push([TR('前身质量'), esc(String(star.massInit)) + ' M☉']);
      if (star.remnant && star.massRemnant != null) rows.push([TR('遗迹质量'), esc(String(star.massRemnant)) + ' M☉']);
      if (star.msLifeGyr != null) rows.push([TR('主序寿命'), esc(String(star.msLifeGyr)) + ' Gyr']);
      if (star.ageGyr != null) rows.push([TR('年龄'), Number(star.ageGyr).toFixed(2) + ' Gyr']);
      if (star.pulsar) rows.push([TR('脉冲星'), TR('是')]);
      if (!rows.length) return '';
      h += '<div class="mb-sub"><h4>' + TR('恒星演化') + ' <span class="mb-tag num">' + TR('数值') + '</span></h4><dl>' +
        rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>';
      if (star.stageNote) h += '<p class="mb-p">' + esc(star.stageNote) + '</p>';
      var vb = star.variable;
      if (vb) {
        h += '<p class="mb-p">' + TR('变星：') + esc(vb.name || '') + TR('（GCVS ') + esc(vb.type || '') + TR('）') +
          (vb.periodD != null ? TR(' · 周期 ') + esc(String(vb.periodD)) + TR(' 天') : TR(' · 无周期（爆发型）')) +
          (vb.amplMag != null ? TR(' · 振幅 ') + esc(String(vb.amplMag)) + TR(' 星等') : '') + '</p>';
        if (vb.ref) h += '<p class="mb-src">' + esc(vb.ref) + '</p>';
      }
      return h + '</div>';
    }
    // 恒星系里的"其它东西"：带 / 彗星 / 盘 / 此刻路过的流浪行星
    function systemBodiesHTML(s) {
      var v = pvOf(s); if (!v) return '';
      var h = '';
      if (v.belts && v.belts.length) {
        h += '<div class="mb-sub"><h4>' + TR('星子带') + ' <span class="mb-tag pic">' + TR('示意') + '</span></h4><ul class="mb-bodies">' +
          v.belts.map(function (b) {
            return '<li><b>' + esc(TR(b.cn || b.kind)) + '</b> <span class="mb-dim">' + esc(String(b.innerAU)) + ' – ' + esc(String(b.outerAU)) + ' AU</span>' +
              (b.note ? '<br><span class="mb-src">' + esc(b.note) + '</span>' : '') + '</li>';
          }).join('') + '</ul></div>';
      }
      if (v.comets) {
        h += '<div class="mb-sub"><h4>' + TR('彗星') + ' <span class="mb-tag pic">' + TR('示意') + '</span></h4><p class="mb-p">' + TR('长周期彗星约每世纪 ') +
          esc(String(v.comets.longPeriodPerCentury)) + TR(' 颗 · 奥尔特云约 ') + esc(fmtAU(v.comets.oortAU)) + '</p>' +
          (v.comets.note ? '<p class="mb-src">' + esc(v.comets.note) + '</p>' : '') + '</div>';
      }
      if (v.disk) {
        h += '<div class="mb-sub"><h4>' + TR('盘') + ' <span class="mb-tag pic">' + TR('示意') + '</span></h4><p class="mb-p">' + esc(v.disk.cn || '') + '</p>' +
          (v.disk.ref ? '<p class="mb-src">' + esc(v.disk.ref) + '</p>' : '') + '</div>';
      }
      if (v.rogues && v.rogues.length) {
        var far = v.rogues.reduce(function (a, r) { return Math.max(a, r.distanceLy || 0); }, 0);
        h += '<div class="mb-sub"><h4>' + TR('流浪行星') + ' <span class="mb-tag pic">' + TR('示意') + '</span></h4>' +
          '<p class="mb-p">' + TR('此刻在 ') + esc(far.toFixed(1)) + TR(' 光年内有 ') + v.rogues.length + TR(' 颗（不属于这个恒星系，只是路过）') + '</p><ul class="mb-bodies">' +
          v.rogues.map(function (r) {
            return '<li><b>' + esc(TR(r.name || '流浪行星')) + '</b> <span class="mb-dim">' + esc(String(r.distanceLy)) + TR(' 光年') +
              (r.radiusRel != null ? TR(' · 半径 ') + Number(r.radiusRel).toFixed(2) + ' R⊕' : '') + '</span></li>';
          }).join('') + '</ul>' + (v.rogueNote ? '<p class="mb-src">' + esc(v.rogueNote) + '</p>' : '') + '</div>';
      }
      return h;
    }
    function fmtAU(au) { return au >= 1e4 ? (au / 1e4).toFixed(1) + TR(' 万 AU') : Math.round(au) + ' AU'; }
    function starEngineHTML(s) {
      var PE = root.MirrorPlanetEngine, sv = s && s._pv;
      if (!PE || !sv || !sv.star || typeof PE.describeStar !== 'function') return '';
      var ds;
      try { ds = PE.describeStar(sv.star, PE.universeConstantsOf(sim), { planets: sv.planets || [] }); } catch (e) { return ''; }
      /* 引擎给的是中文原文（口径与 node 侧的自检一致，一个字都不改）；英文态在这里按句重组。 */
      return '<p class="mb-p">' + esc(TX(ds.text)) + '</p><p class="mb-src">' + esc(TX(ds.source)) + '</p>';
    }
    function planetEngineHTML(p) {
      var PE = root.MirrorPlanetEngine, pv = p && p._pv;
      if (!PE || !pv || !pv.params || !pv.report) return '';
      var ev = pv.report, h = '';
      /* 行星引擎的叙事同样是中文原文，显示层过 TX()（标题这种整句的走 TR()）。 */
      if (ev.description) h += '<p class="mb-p">' + esc(TX(ev.description)) + '</p><p class="mb-src">' + esc(TX(ev.descriptionSource)) + '</p>';
      h += peRows(PE.paramRows(pv.params), '行星参数（输入）', 'in');
      h += peRows(PE.derivedRows(ev), '派生量（真算 / 标度 / 启发式）', 'dv');
      var fin = (ev.findings || []).map(function (f) {
        return '<div class="mb-fi ' + esc(f.verdict) + '"><b>' + esc(TR(f.title)) + '</b> <span class="mb-bas ' + esc(f.basis) + '">' + esc(TR(PE.BASIS_CN[f.basis] || f.basis)) + '</span>'
          + '<div>' + esc(TX(f.valueText)) + '</div><div class="mb-dim">' + esc(TX(f.text)) + '</div>'
          + '<div class="mb-dim">' + esc(TX(f.formula)) + TR('　依据：') + esc(TX(f.ref)) + '</div></div>';
      }).join('');
      h += '<details class="mb-params" data-pe="rp"' + (st.peOpen.rp ? ' open' : '') + '><summary>' + TR('报告') + '</summary>'
        + '<p class="mb-p">' + esc(TX(ev.report)) + '</p>'
        + '<p class="mb-p mb-dim">' + TR('宜居性：') + (ev.habitability == null ? TR('不给数（') + esc(TX(ev.habitabilityDetail ? ev.habitabilityDetail.sentence : TR('维数不为 3'))) + TR('）') : ev.habitability.toFixed(2) + TR('（heuristic）')) + '</p>'
        + fin + '</details>';
      return h;
    }
    /* 试探质点的实时状态：全部读 planets 的 getDemoState()，这里不自己算物理。
       状态字串（束缚/坠入/逃逸）与圈数、进动都由该 API 给出。 */
    function updateDemoRows() {
      var tb = $('mbDemoRows'); if (!tb) return;
      var ds = null;
      if (pv && typeof pv.getDemoState === 'function') { try { ds = pv.getDemoState(); } catch (e) { ds = null; } }
      if (!ds || !ds.planets) { tb.innerHTML = '<tr><td colspan="5" class="mb-dim">' + TR('演示尚未开始') + '</td></tr>'; return; }
      var CLS = { '束缚': 'ok', '坠入': 'bad', '逃逸': 'bad' };
      tb.innerHTML = ds.planets.map(function (p, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + (p.r0 != null ? Number(p.r0).toFixed(2) : '—') + '</td>' +
          /* 状态列不写裸「束缚」：D≥4 按 Ehrenfest 根本没有稳定圆轨道，核外那些其实是几乎不受力的
             自由漂移。planets.js 的 getDemoState() 已经按真实积分结果给了 statusText，这里优先用它。 */
          '<td class="d-' + (CLS[p.status] || 'ok') + '">' + esc(p.statusText || TR(p.status || '—')) + '</td>' +
          '<td>' + (p.periods != null ? p.periods : '—') + '</td>' +
          '<td>' + (p.precDegPerOrbit != null ? p.precDegPerOrbit : '—') + '</td></tr>';
      }).join('');
      var foot = $('mbDemoFoot');
      if (foot) {
        var nb = ds.planets.filter(function (p) { return p.status !== '逃逸' && p.status !== '坠入'; }).length;
        foot.textContent = TR('扰动 ') + (ds.eps * 100).toFixed(2) + TR('% · 已演化 ') + Number(ds.t).toFixed(1) + TR(' T₀ · 仍在飞 ') + nb + '/' + ds.planets.length +
          TR('（D=') + Number(ds.D).toFixed(2) + TR('）· R 重置 · 3 切换 D=3 对照 · +/− 调扰动');
      }
    }
    /* 标题上的重命名入口：✎ 按钮、双击标题、内联输入框。每次重绘信息面板都要重新绑（innerHTML 换过了）。
       输入框里的按键一律 stopPropagation：Esc 冒到 app.js 会直接退出镜像，Enter 会被当成"进入下一层"。 */
    function bindRenameUI() {
      var rb = info.querySelector('#mbRenBtn');
      if (rb) rb.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); startRename(); });
      var tt = info.querySelector('.mb-title-txt');
      if (tt) tt.addEventListener('dblclick', function (ev) { ev.preventDefault(); ev.stopPropagation(); startRename(); });
      var ri = info.querySelector('#mbRenIn');
      if (!ri) return;
      ri.value = st.renameDraft || '';
      ri.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); commitRename(ri.value); }
        else if (ev.key === 'Escape') { ev.preventDefault(); cancelRename(); }
      });
      ri.addEventListener('input', function () { st.renameDraft = ri.value; });
      var keep = function (ev) { ev.preventDefault(); };     // 按下去不让输入框失焦，click 才收得到
      var ok = info.querySelector('#mbRenOK'), no = info.querySelector('#mbRenNo');
      if (ok) { ok.addEventListener('mousedown', keep); ok.addEventListener('click', function () { commitRename(ri.value); }); }
      if (no) { no.addEventListener('mousedown', keep); no.addEventListener('click', function () { cancelRename(); }); }
      if (st.renameFocus) { st.renameFocus = false; setTimeout(function () { try { ri.focus(); ri.select(); } catch (e) { /* ignore */ } }, 0); }
    }
    function fmtAlt(m) { if (m >= 1e6) return (m / 1e6).toFixed(2) + TR(' 万公里'.replace('万公里', '千公里')); if (m >= 1e4) return (m / 1e4).toFixed(1) + TR(' 万米'); return Math.round(m) + TR(' 米'); }
    /* 换层/换天体都算离开这次重命名：没提交的输入框跟着作废（下一层的标题不该顶着上一层的草稿）。
       选中项同理：refreshUI 只在"真的换了层/换了天体"时才调（选中只调 renderActions + renderInfo），
       所以进入之后那个候选就该消失，不该顶着上一层的选中项继续挂在动作条上。 */
    function refreshUI() { st.renaming = null; st.renameDraft = ''; st.sel = null; renderCrumb(); renderActions(); renderInfo(); }
    /* 切语言：面包屑、动作条、信息面板都是 innerHTML 现拼的（句子里嵌着数值），
       i18n 的 DOM 遍历只认"整段逐字命中"的文本节点，够不着它们 —— 不重画一遍，
       英文态下这三块会一直停在进来时那种语言。选中状态与重命名草稿不能动，所以不走 refreshUI()。 */
    function relangUI() { if (st.disposed) return; renderCrumb(); renderActions(); renderInfo(); }

    /* ---------- 层级切换与过渡 */
    function startTrans(cx, cy, then) { st.trans = { t: 0, cx: cx, cy: cy, then: then, done: false }; }
    // 定位序列必须能被打断：否则它 done() 时会把视图拽回银河系，或与新的 transition 抢同一个层级
    function cancelLocate() { st.locateSeq = null; st.locating = false; st.rect = null; st.locateLog = []; }
    function goLevel(lv) {
      if (lv >= st.level) return;
      cancelLocate();
      st.level = lv; st.locateLog = []; if (lv < 3) st.planetTex = null;
      if (pv) {
        /* 往上退到星系/宇宙网层时**只把画布藏起来，不再 dispose**。
           原来这里每次都把整个 planets 视图拆掉，ensurePV() 下次进恒星系时再 createView() 重建 ——
           而 createView 要重新编译十来个 GL 程序，实测**每进一次恒星系就是 362~370 ms**
           （分段计时里 showSystem 占 370ms、refreshUI 只有 1~5ms，长文本各段全是 0ms）。
           用户「按 Enter 进恒星系就卡住」正是这一下。视图留着不占额外上下文（同一块画布反复用），
           它自己的纹理/地图缓存本来就有淘汰上限；真正的释放在 api.dispose() 里。 */
        if (lv < 2) pvVisible(false);
        else if (lv === 2 && st.system && st.system._pv) { try { pv.showSystem(st.system._pv, sysOpts()); } catch (e) { /* ignore */ } pvVisible(true); }
        else if (lv === 3 && st.planet && st.planet._pv) { try { pv.showGlobe(st.planet._pv, timeOpts()); } catch (e) { /* ignore */ } pvVisible(true); }
      }
      refreshUI();
    }
    /* 轨道投影演示里画布上的标签直接取 system.planets[k].name，而生成器给的是行星命名法
       （"恒星 86F5 b/c/d"）——看着像可点的行星，其实是试探质点、进不去。
       planets.js 那边的标签取的就是这个字段，所以在这里把名字改掉，标签跟着变成
       "质点 1/2/3"，与右侧表格的 # 列对上。只在 orbitDemo 模式改，其它模式的行星名照旧。 */
    function renameDemoPoints(sys) {
      if (dimMode !== 'orbitDemo' || !sys || !sys.planets) return sys;
      sys.planets.forEach(function (p, k) { if (p) p.name = TR('质点 ') + (k + 1); });
      return sys;
    }
    function makeSystem(sseed, ours) {
      var out = null;
      if (usePV) {
        try {
          // noLife 必须传下去：这个宇宙没有分子化学时，生成器不能再给行星安生命
          var sys = P.generateSystem(ours ? (seed ^ 0x501) : sseed, sim.params, { mode: sim.mode, ours: !!sim.isOurs, solar: !!ours, seed: sseed, dimMode: dimMode, dimS: dimS, noLife: NO_LIFE });
          if (sys && sys.planets) out = fromPVSystem(renameDemoPoints(sys), ours);
        } catch (e) { console.warn('[mirror] MirrorPlanets.generateSystem 失败，退回内置生成：', e); }
      }
      if (!out) out = genSystem(sseed, ours, NO_LIFE);
      // 命名键认"我们是按哪个种子把它造出来的"，不认生成器自己填的 seed（太阳系会填成 SOLAR_SEED）
      out.seedKey = sseed >>> 0;
      applyNames(out);                    // 把自定义名写回 planets.js 读的 name 字段（画布标签）
      return out;
    }
    /* 进恒星系层（1→2）这一帧分段计时。用户的假死现场就落在这里（dump 里 level:2、trans:true、
       lastInput:Enter），而这条路**不经过 app.js 的 enterMirror**，所以那边的 enterMirrorMs 盖不到。
       结果挂在 api.lastEnterMs 上，由宿主写进看门狗 dump 的 enterSystemMs 字段。
       计时本身就是几次 performance.now()，不改任何渲染/物理行为。 */
    function nowMs2() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
    function enterSystemLevel() {
      var t0 = nowMs2(), seg = {};
      st.level = 2; st.demoNoted = false;                      // 换一个恒星系 = 新的一组质点，说明再给一次
      if (usePV && st.system && st.system._pv && ensurePV()) { try { pv.showSystem(st.system._pv, sysOpts()); } catch (e) { console.warn('[mirror] showSystem 失败：', e); } pvVisible(true); }
      seg.showSystem = Math.round(nowMs2() - t0); var t1 = nowMs2();
      refreshUI();
      seg.refreshUI = Math.round(nowMs2() - t1);
      seg.total = Math.round(nowMs2() - t0);
      /* 三个数分开看：
           prewarmMs  预热（ensurePV → planets.createView，着色器都在这里）真正花了多久；null = 没经过预热
           waitMs     从 create 决定「稍后开层」到真的开层，中间等了多久（rIC / 400 ms 兜底）
           showSystem 开层那一下自己花了多久 —— 预热生效时这个数应该很小
         假死那次是 prewarmMs 无、showSystem=2029；预热接上之后应该反过来。 */
      seg.prewarmMs = warmMs;
      seg.waitMs = st.warmAt ? Math.round(t0 - st.warmAt) : null;
      seg.deferred = !!st.warmAt;
      seg.sysSeed = st.system ? (st.system.seed >>> 0) : null;
      seg.planets = st.system && st.system.planets ? st.system.planets.length : 0;
      seg.dimMode = dimMode; seg.dimS = dimS;
      seg.renderInfo = RI_SEG;                                  // renderInfo 内部再分一层（见 renderInfo）
      st.lastEnterMs = seg;
    }
    /* ---------- 星系目录（可点选列表）
     * 优先用 universe3d 在 N 体盒里识别出的晕（app 通过 o.halos 传进来，含稳定的 id / 质量 / 盒内坐标）；
     * 2D 回退或还没识别到晕时，退化成按种子生成的一批星系，并在界面上标注来源——
     * 两者的可信度完全不同，不能混着说。
     * 顺序：质量从大到小，同质量按 id 稳定排序 —— 同一个宇宙每次进来的第 k 个都是同一个。 */
    var GAL_FALLBACK_N = 24;
    var GALS = null, GAL_SRC = 'seed';
    function galaxyCatalog() {
      if (GALS) return GALS;
      var list = [], i;
      var halos = (o.halos && o.halos.length) ? o.halos.slice() : null;
      if (halos) {
        GAL_SRC = 'sim';
        halos.sort(function (a, b) { return (b.mass - a.mass) || ((a.id >>> 0) - (b.id >>> 0)); });
        for (i = 0; i < halos.length; i++) {
          var h = halos[i], gs = (seed ^ ((h.id >>> 0) * 2654435761)) >>> 0;
          var g = genGalaxy(gs, false);
          g.haloId = h.id >>> 0; g.mass = h.mass; g.rMpc = h.rMpc;
          g.distMpc = boxDist(h) * (o.boxMpc || 0);
          g.source = 'sim';
          // bx/by：宇宙网那张图上的位置（盒坐标，与 web.positions 同一套 0–1）——选中时在这里画高亮圈，
          // 进入时也从这里开始放大，而不是永远从屏幕正中间放大
          g.bx = h.x; g.by = h.y;
          list.push(g);
        }
      } else {
        GAL_SRC = 'seed';
        var r = A.rng((seed ^ 0x6a09e667) >>> 0);
        for (i = 0; i < GAL_FALLBACK_N; i++) {
          var gs2 = ((seed ^ 0x9e3779b9) + i * 2654435761) >>> 0;
          var g2 = genGalaxy(gs2, false);
          g2.mass = 5e12 * Math.pow(0.86, i) * (0.8 + 0.4 * r());   // 只是排个序用的示意质量
          g2.distMpc = 0; g2.source = 'seed';
          var rp = A.rng(gs2);                                       // 没有晕表就按种子给一个确定的位置（同一个宇宙每次都一样）
          g2.bx = 0.14 + rp() * 0.72; g2.by = 0.14 + rp() * 0.72;
          list.push(g2);
        }
        list.sort(function (a, b) { return (b.mass - a.mass) || (a.seed - b.seed); });
      }
      // #1207：银河系永远排在第一个，观测目录那条路仍然通
      if (ours) { var mw = genGalaxy(seed ^ 0xa11e, true); mw.source = GAL_SRC; mw.mass = Infinity; mw.distMpc = 0; mw.bx = 0.62; mw.by = 0.38; list.unshift(mw); }
      GALS = list;
      return GALS;
    }
    function boxDist(h) { var dx = h.x - 0.5, dy = h.y - 0.5, dz = h.z - 0.5; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
    function galIndex() {
      var l = galaxyCatalog(); if (!st.galaxy) return -1;
      for (var i = 0; i < l.length; i++) if (l[i].seed === st.galaxy.seed) return i;
      return -1;
    }
    // 双击/随机进来的星系不在目录里：显示"自选"，不要假装它是第 1 个（和恒星系层一个写法）
    function galCountText() { return countText(selIdxOf('galaxy'), galIndex(), galaxyCatalog().length); }
    /* 计数要诚实：#1207 的银河系是从观测目录来的，不是 N 体盒里识别出来的晕，不能混进"已识别 N 个"里 */
    function galSourceNote() {
      var l = galaxyCatalog(), n = l.length - (ours ? 1 : 0);
      return GAL_SRC === 'sim'
        ? TR('本宇宙已识别 ') + n + TR(' 个星系（N 体盒里找到的晕，按质量排序）') + (ours ? TR('，另加观测目录里的银河系') : '')
        : TR('按种子生成的 ') + n + TR(' 个星系（示意：这一档没有 3D 模拟的晕表可用，不是识别结果）') + (ours ? TR('，另加观测目录里的银河系') : '');
    }
    /* 进入目录里的第 i 个星系：停在星系层，不跳级。
       只有"明确要进去"的那几处才调它（列表里双击一行、右键菜单的进入项）——
       随机与前后翻页现在都只改选中项，见 selGalaxyAt / stepGalaxy。 */
    function gotoGalaxy(i, cx, cy) {
      var l = galaxyCatalog(); if (!l.length) return;
      i = ((i % l.length) + l.length) % l.length;
      var g = l[i];
      enterGalaxyObj(g, { u: g.bx != null ? g.bx : 0.5, v: g.by != null ? g.by : 0.5, box: true }, cx, cy);
    }
    function galSeedAt(u, v) { return (seed ^ (Math.floor(u * 997) * 7919 + Math.floor(v * 991) * 104729)) >>> 0; }
    // 双击宇宙网任意处：这是毫无歧义的"我要进这里"，照旧直接进（不经过选中）
    function chooseGalaxy(u, v) { enterGalaxyObj(genGalaxy(galSeedAt(u, v), false), { u: u, v: v, box: false }); }
    function locateGalaxy() {
      if (st.locating) return; st.locating = true; st.locateLog = [];
      var lines = [
        '按 McConnachie 2012（AJ 144, 4）目录放置本星系群成员。',
        '仙女座星系 M31 距离 783 kpc；大麦哲伦云 51 kpc、小麦哲伦云 64 kpc（同目录）。',
        '银河系：S(B)bc，盘直径约 30 kpc（Bland-Hawthorn & Gerhard 2016）。',
        '赤经赤纬 → 银道坐标：位置为观测值，形态为示意渲染。',
        '已按目录定位银河系。'
      ];
      // 逐行显示由主循环按 elapsed 推进（不依赖 setTimeout，页面隐藏时同步暂停）
      st.locateSeq = { lines: lines, i: 0, wait: rm ? 0.25 : 0.65, acc: 0, done: function () { st.galaxy = genGalaxy(seed ^ 0xa11e, true); galPts = null; var W = box.clientWidth, H = box.clientHeight; startTrans(W * 0.62, H * 0.38, function () { st.level = 1; st.locating = false; st.locateLog = []; refreshUI(); }); } };
    }
    function advanceLocate(dt) {
      var q = st.locateSeq; if (!q) return;
      q.acc += dt;
      if (q.acc < q.wait) return;
      q.acc = 0;
      if (q.i < q.lines.length) { st.locateLog.push(q.lines[q.i++]); renderInfo(); }
      else { st.locateSeq = null; q.done(); }
    }
    function locateSun() {
      if (st.locating) return; st.locating = true;
      st.locateLog = ['太阳距银心 8.178 kpc（GRAVITY Collab. 2019, A&A 625, L10），位于猎户臂内缘。', '恒星位置取自 HYG v4.1 星表；旋臂形态为示意渲染。']; renderInfo();
      st.rect = { t: 0 };
      st.locateSeq = { lines: [], i: 0, wait: rm ? 0.4 : 1.4, acc: 0, done: function () { st.system = makeSystem(seed ^ 0x501, true); var W = box.clientWidth, H = box.clientHeight; startTrans(W * 0.5 + W * 0.21, H * 0.5 - H * 0.16, function () { st.locating = false; st.locateLog = []; st.rect = null; enterSystemLevel(); }); } };
    }
    /* ---------- 本星系内的恒星系目录
     * 星系是过程生成的，没有"识别出来的恒星系"这种东西——这里的列表是按星系种子派生的一组固定种子，
     * 保证同一个星系每次进来第 k 个是同一颗，仅此而已（不是模拟结果）。 */
    var SYS_N = 12, SYS_CACHE = { key: -1, seeds: null };
    function systemSeeds() {
      var g = st.galaxy; if (!g) return [];
      if (SYS_CACHE.key === g.seed && SYS_CACHE.seeds) return SYS_CACHE.seeds;
      var out = [];
      for (var i = 0; i < SYS_N; i++) out.push((((g.seed >>> 0) ^ 0x85ebca6b) + i * 0x9e3779b9) >>> 0);
      SYS_CACHE = { key: g.seed, seeds: out };
      return out;
    }
    function sysIndex() {
      var ss = systemSeeds(); if (!st.system) return -1;
      for (var i = 0; i < ss.length; i++) if (ss[i] === st.system.seed) return i;
      return -1;                                   // 双击自选进来的恒星系不在目录里
    }
    function sysCountText() { return countText(selIdxOf('system'), sysIndex(), systemSeeds().length); }
    function sysSeedAt(u, v) { return ((st.galaxy ? st.galaxy.seed : seed) ^ (Math.floor(u * 1013) * 31 + Math.floor(v * 1009) * 131)) >>> 0; }
    // 双击旋臂任意处：毫无歧义的"我要进这里"，照旧直接进（不经过选中）
    function chooseSystem(u, v) { var sys = makeSystemSafe(sysSeedAt(u, v)); if (sys) enterSystemObj(sys, { u: u, v: v, box: false }); }
    /* 与 planets 视图有关的异步活儿：排队期间 syncPV 不许用旧状态回写 st.planet。
       （老代码里换星球 = selectPlanet 排一个 showGlobe + enterSurface 排一个 land，两个都还没跑，
        中间夹着的那一帧 syncPV 读到的还是"上一颗星球"，直接把 st.planet 改了回去 ——
        表现就是地表层的「← 上一颗 / 下一颗 →」按了没反应。） */
    function pvBusy(label, fn) {
      st.pvPending = (st.pvPending || 0) + 1;
      busy(label, function () { try { fn(); } finally { st.pvPending = Math.max(0, (st.pvPending || 1) - 1); } });
    }
    function selectPlanet(p) {
      if (!p) return;
      if (MAX_LEVEL < 3) return;                    // 轨道投影演示：没有行星层可进
      st.planet = p; st.planetTex = null; st.planetTexKey = '';
      st.cam = { lat: origNameOf(p) === '地球' ? 35 : 10, lon: origNameOf(p) === '地球' ? 25 : 60, alt: 1e4 };
      if (pv && p._pv) {
        st.level = 3;
        // 星球贴图是同步 CPU 活儿（512×256，几十到上百毫秒），先把"正在生成"画出来再开工
        // 排队窗口内用户可能已 goLevel / 换目标 / 降到地表：过期回调绝不能再 showGlobe 把视图顶回去
        // （syncPV 的 st.pvPending 只挡住它自己，挡不住本回调里的写操作）
        var globeTarget = p._pv;
        pvBusy(TR('正在生成星球表面…'), function () {
          if (!pv || st.level !== 3 || !st.planet || st.planet._pv !== globeTarget) return;
          try { pv.showGlobe(globeTarget, timeOpts()); } catch (e) { console.warn('[mirror] showGlobe 失败：', e); }
          pvVisible(true); refreshUI();
        });
        return;
      }
      var W = box.clientWidth, H = box.clientHeight;
      startTrans(W / 2, H / 2, function () { st.level = 3; refreshUI(); });
    }
    function enterSurface(lat, lon) {
      if (MAX_LEVEL < 4) return;                   // 没有地表可降
      st.cam.lat = lat; st.cam.lon = lon; st.cam.alt = 1e4; st.surfKey = ''; st.level = 4;
      if (pv && st.planet && st.planet._pv) {
        var target = st.planet._pv;
        // 同 selectPlanet：排队期间若已返回上层或换了星球，过期 land 不得覆盖当前视图
        pvBusy(TR('正在生成地表…'), function () {
          if (!pv || st.level !== 4 || !st.planet || st.planet._pv !== target) return;
          try { pv.land(target, timeOpts({ lat: lat, lon: lon, altitudeM: 1e4 })); } catch (e) { console.warn('[mirror] land 失败：', e); }
        });
      }
      refreshUI();
    }
    function changeAlt(f, steps) {
      st.cam.alt = clamp(st.cam.alt * Math.pow(f, steps || 1), 10, 8e5);
      if (st.cam.alt >= 8e5) { st.level = 3; st.planetTex = null; if (pv && st.planet && st.planet._pv) { try { pv.showGlobe(st.planet._pv, timeOpts()); } catch (e) { /* ignore */ } } refreshUI(); return; }
      if (pv && pv.setAltitude) { try { pv.setAltitude(st.cam.alt); } catch (e) { /* ignore */ } }
      renderInfo();
    }
    /* 与 MirrorPlanets 视图状态同步（它自己处理拖动/滚轮时，把层级/高度同步回面包屑与信息栏） */
    function syncPV() {
      if (!pv || st.level < 2 || typeof pv.getState !== 'function') return;
      if (st.pvPending) return;   // 有排队中的 showGlobe / land：pv 里还是旧状态，这时候回写会把刚换的星球顶掉
      var s; try { s = pv.getState(); } catch (e) { return; }
      if (!s) return;
      var m = s.mode || s.view || s.state;
      var lv = m === 'system' ? 2 : m === 'globe' ? 3 : (m === 'land' || m === 'surface') ? 4 : st.level;
      if (lv > MAX_LEVEL) lv = MAX_LEVEL;
      var changed = false;
      if (s.planet && (!st.planet || st.planet._pv !== s.planet)) { st.planet = fromPV(s.planet); changed = true; }
      if (lv !== st.level && lv >= 2) { st.level = lv; changed = true; }
      if (s.altitudeM != null && Math.abs(s.altitudeM - st.cam.alt) > 1) { st.cam.alt = s.altitudeM; if (st.level === 4) alt.textContent = TR('高度 ') + fmtAlt(st.cam.alt); }
      if (s.lat != null) st.cam.lat = s.lat; if (s.lon != null) st.cam.lon = s.lon;
      if (changed) refreshUI();
    }
    function dive() { st.diveTo = clamp(st.cam.alt / 8, 10, 8e5); }

    /* ---------- 绘制：各层 */
    var webCache = null, webCacheKey = '';
    function renderWebCache(W, H) {
      var cv = document.createElement('canvas'); cv.width = Math.max(1, W); cv.height = Math.max(1, H);
      var c = cv.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      var S = Math.min(W, H) * 0.98, ox = (W - S) / 2, oy = (H - S) / 2;
      c.globalCompositeOperation = 'lighter';
      if (web && web.positions) {
        var P = web.positions, D = web.density, n = web.N;
        for (var i = 0; i < n; i++) { var d = D ? D[i] : 0; c.fillStyle = d > 4 ? 'rgba(255,240,200,0.7)' : d > 1 ? 'rgba(150,200,255,0.4)' : 'rgba(90,70,130,0.22)'; c.fillRect(ox + P[2 * i] * S, oy + P[2 * i + 1] * S, 1.4, 1.4); }
      } else {
        for (i = 0; i < webN; i++) { c.fillStyle = (i % 7 === 0) ? 'rgba(255,240,200,0.7)' : 'rgba(150,200,255,0.4)'; c.fillRect(ox + webPts[2 * i] * S, oy + webPts[2 * i + 1] * S, 1.4, 1.4); }
      }
      return cv;
    }
    /* 选中项的高亮：一个呼吸着的圆圈 + 名字。选中是"还没进去"的状态，必须在画面上看得见，
       否则用户只能靠右上角的信息面板猜自己选中了哪一个。 */
    function drawSelRing(ctx, x, y, el0, label, r0) {
      var k = 0.5 + 0.5 * Math.sin(el0 * (rm ? 1.2 : 3)), r = (r0 || 16) + (rm ? 2 : 4) * k;
      ctx.save();
      ctx.strokeStyle = 'rgba(120,220,255,' + (0.55 + 0.35 * k).toFixed(2) + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,220,255,0.28)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke();
      if (label) {
        ctx.font = '12px ' + SANS; ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        var tw = ctx.measureText(label).width;
        ctx.fillRect(x + r + 6, y - 18, tw + 8, 17);
        ctx.fillStyle = 'rgba(180,235,255,0.95)'; ctx.fillText(label, x + r + 10, y - 6);
      }
      ctx.restore();
    }
    function drawSelHere(ctx, W, H, el0, kind) {
      var s = st.sel; if (!s || s.kind !== kind) return;
      var pt = selPoint(s, W, H);
      drawSelRing(ctx, pt[0], pt[1], el0, TR('已选中：') + selName(s) + TR('（Enter 进入）'), kind === 'galaxy' ? 20 : 14);
    }
    function drawWeb(ctx, W, H, el0) {
      var key = W + 'x' + H;
      if (!webCache || webCacheKey !== key) { webCache = renderWebCache(W, H); webCacheKey = key; }   // 宇宙网是静态快照：只渲染一次
      ctx.drawImage(webCache, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      if (st.locating && st.level === 0) { // 检索框闪动
        var k = (el0 * 3) % 1, x = W * 0.62, y = H * 0.38, r = 60 - 40 * ease(Math.min(1, st.locateLog.length / 5));
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 + 0.5 * k) + ')'; ctx.lineWidth = 1; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
      }
      drawSelHere(ctx, W, H, el0, 'galaxy');
    }
    function ensureGalPts() {
      if (galPts) return;
      var g = st.galaxy, r = A.rng(g.seed ^ 0x77), pts = [], n = rm ? 2200 : 3200;
      /* 旋臂缠绕方向按星系种子取 ±1：以前系数恒正，于是每一个旋涡星系都朝同一边缠。
         真实宇宙没有优选手性——Galaxy Zoo 的 Land et al. 2008 专门统计过旋涡星系的
         缠绕方向，顺时针与逆时针没有显著差别。银河系强制取 +1，保持它真实的样子。 */
      var gspin = g.ours ? 1 : ((A.rng((g.seed >>> 0) ^ 0x9A17)() < 0.5) ? -1 : 1);
      g.spin = gspin;
      /* 缠绕角 / 径向跨度也随种子变：以前写死 wind=3.6、rad=0.04+t*0.46，
         同臂数+同手性的旋涡在轮廓上几乎只差点噪。真实旋臂俯仰角约 10–30°。
         银河系仍用旧常数，避免改观测示意。 */
      var wind = g.ours ? 3.6 : (2.0 + r() * 3.2);
      var rad0 = g.ours ? 0.04 : (0.02 + r() * 0.04);
      var radSpan = g.ours ? 0.46 : (0.32 + r() * 0.28);
      /* 盘 = 平滑指数盘 + 叠加的旋臂增强，不是"只有臂"。
         旋臂是密度波（Lin & Shu 1964）：气体经过时被压缩、触发恒星形成，所以**年轻亮星**
         集中在臂上；但恒星**质量**的大头是寿命长的老年 K/M 矮星，它们在盘里铺得相当均匀
         （指数盘，Freeman 1970：Σ ∝ e^{−r/h}）。太阳自己就在猎户支臂里，不在主旋臂上。
         原来这里 100% 的点都放在臂上，臂间是真空——用户问"虚空里不应该也有吗"，应该有。
         armFrac 取 0.55–0.75：老年盘的臂间对比度只有二三倍，不是无穷大。 */
      var armFrac = g.arms ? (g.ours ? 0.62 : 0.55 + r() * 0.20) : 0;
      var hScale = 0.16 + r() * 0.06;                 // 指数盘标长（归一化单位）
      /* 每条臂各有自己的缠绕度、起始相位与强度：真实星系里各条臂的长度/强度/缠绕并不相同，
         絮状型（Elmegreen & Elmegreen 1987）更是断续片段。原来所有臂是同一条曲线整体旋转
         TAU/arms，完全对称——用户问"悬臂都差不多造型合理吗"，不合理。银河系仍走对称老路。 */
      var nArm = Math.max(1, g.arms || 1), armPar = [];
      for (var ai = 0; ai < nArm; ai++) {
        armPar.push(g.ours
          ? { w: wind, ph: ai * TAU / nArm, amp: 1, frag: 0 }
          : { w: wind * (0.82 + r() * 0.36), ph: ai * TAU / nArm + (r() - 0.5) * 0.9,
              amp: 0.55 + r() * 0.9, frag: r() * 0.55 });      // frag：这条臂有多"断续"
      }
      var ampSum = 0; for (ai = 0; ai < nArm; ai++) ampSum += armPar[ai].amp;
      for (var i = 0; i < n; i++) {
        var t = Math.pow(r(), 0.7), rad, theta, sc, onArm = g.arms && r() < armFrac;
        if (!g.arms) {                                   // 椭圆星系：各向同性球状分布
          rad = Math.pow(r(), 1.5) * 0.45; theta = r() * TAU; sc = 0;
        } else if (onArm) {
          // 按 amp 加权挑一条臂，各臂参数不同
          var pick = r() * ampSum, acc = 0, a = armPar[0];
          for (ai = 0; ai < nArm; ai++) { acc += armPar[ai].amp; if (pick <= acc) { a = armPar[ai]; break; } }
          if (a.frag > 0 && r() < a.frag * 0.5) t = Math.pow(r(), 0.7);   // 断续：沿臂重抽一次，形成缺口
          theta = gspin * (t * a.w + a.ph); rad = rad0 + t * radSpan;
          sc = (0.02 + 0.06 * t) * (r() - 0.5);
        } else {
          /* 臂间的平滑指数盘：半径按 e^{−r/h} 抽（拒绝采样的解析近似：−h·ln(1−u) 截断到盘半径） */
          rad = Math.min(rad0 + (-hScale * Math.log(1 - 0.985 * r())), rad0 + radSpan * 1.05);
          theta = r() * TAU; sc = 0;
        }
        var x = Math.cos(theta) * rad + sc, y = Math.sin(theta) * rad + sc * 0.8;
        // 臂上是年轻亮星，臂间以老年星为主：亮度上给出对比，但不把臂间压到看不见
        pts.push({ x: x, y: y, b: onArm ? (0.45 + r() * 0.55) : (0.18 + r() * 0.34), s: onArm ? (0.7 + r() * 1.2) : (0.5 + r() * 0.7) });
      }
      galPts = pts;
    }
    /* 旋臂上某一点的屏幕坐标：drawGalaxy 每帧转一点点，选中圈要跟着一起转，
       所以把最后一帧的旋转角记下来，选中项与缩放中心都用它换算。 */
    var galRot = 0;
    function galPtScreen(p, W, H) {
      var R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2, cr = Math.cos(galRot), sr = Math.sin(galRot);
      var x = p.x * cr - p.y * sr, y = (p.x * sr + p.y * cr) * 0.55;
      return [cx + x * R * 2, cy + y * R * 2];
    }
    function drawGalaxy(ctx, W, H, el0) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      var g = st.galaxy; if (!g) return;
      var formed = st.T >= g.tFormYr, R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2;
      /* g.spin 是在 ensureGalPts() 里赋的，必须先叫它再算 rot：
         否则刚进入一个星系的第一帧会拿 `|| 1` 的默认正号，约一半（手性为 −1 的）星系
         会出现一帧转动方向跳变。ensureGalPts 自带缓存，重复调用无开销。 */
      ensureGalPts();
      var rot = (g.spin || 1) * (rm ? 0.3 : el0 * 0.02);   // 转动方向跟缠绕方向一致，否则旋臂会朝反方向
      galRot = rot;
      // 核心辉光
      var gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (formed ? 0.5 : 0.9));
      gg.addColorStop(0, formed ? 'rgba(255,245,225,0.95)' : 'rgba(120,110,150,0.6)'); gg.addColorStop(0.3, formed ? 'rgba(220,225,240,0.35)' : 'rgba(80,70,110,0.3)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(cx, cy, R * (formed ? 0.5 : 0.9), R * (formed ? 0.3 : 0.7), 0, 0, TAU); ctx.fill();
      if (!formed) {
        // 以前这里直接 return，画布上只剩一团很暗的辉光——看起来就是"全黑坏了"。
        // 明确画出"这个时刻它还没形成"，并告诉用户怎么办。
        ctx.fillStyle = 'rgba(233,230,245,0.72)';
        ctx.font = '14px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(TR(g.name) + TR(' 在这个时刻还没有形成'), cx, cy + R * 0.78);
        ctx.fillStyle = 'rgba(139,143,168,0.9)'; ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(TR('它形成于距今 ') + (-g.tFormYr / 1e8).toFixed(1) + TR(' 亿年；把时间轴拖到那之后，或点“时间轴回到现在”'), cx, cy + R * 0.78 + 22);
        ctx.textAlign = 'start';
        return;
      }
      ensureGalPts();
      ctx.globalCompositeOperation = 'lighter';
      var cr = Math.cos(rot), sr = Math.sin(rot);
      for (var i = 0; i < galPts.length; i++) {
        var p = galPts[i], x = p.x * cr - p.y * sr, y = (p.x * sr + p.y * cr) * 0.55;
        ctx.fillStyle = 'rgba(232,236,245,' + (p.b * 0.75).toFixed(2) + ')';
        ctx.fillRect(cx + x * R * 2, cy + y * R * 2, p.s, p.s);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (st.rect) { var k = (el0 * 3) % 1; ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * k) + ')'; ctx.lineWidth = 1; ctx.strokeRect(cx + W * 0.21 - 22, cy - H * 0.16 - 14, 44, 28); }
      drawSelHere(ctx, W, H, el0, 'system');   // 选中的恒星系：旋臂上的一个亮圈，跟着旋臂转
    }
    function drawSystem(ctx, W, H, el0) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      var s = st.system; if (!s) return;
      var T = st.T, cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46;
      // 背景星
      var r0 = A.rng(s.seed ^ 0x99);
      for (var i = 0; i < 160; i++) { ctx.fillStyle = 'rgba(200,210,235,' + (0.2 + r0() * 0.5).toFixed(2) + ')'; ctx.fillRect(r0() * W, r0() * H, 1, 1); }
      if (T < s.tFormYr) { var pg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.8); pg.addColorStop(0, 'rgba(120,100,140,0.5)'); pg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = pg; ctx.fillRect(0, 0, W, H); return; }
      var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.12, s.color); glow.addColorStop(0.35, 'rgba(255,220,160,0.25)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, TAU); ctx.fill();
      var ring = T < s.tPlanetsYr;
      var maxAu = s.planets[s.planets.length - 1].au;
      function orb(au) { return R * (0.12 + 0.86 * Math.log10(1 + au * 9) / Math.log10(1 + maxAu * 9)); }
      if (ring) {
        var k = clamp((T - s.tFormYr) / (s.tPlanetsYr - s.tFormYr), 0, 1);
        var rr = A.rng(s.seed ^ 0xd15);
        ctx.globalCompositeOperation = 'lighter';
        for (i = 0; i < 2600; i++) { var au = Math.pow(rr(), 0.7) * maxAu * 0.9 + 0.1, ang = rr() * TAU, ro = orb(au) * (0.96 + rr() * 0.08); ctx.fillStyle = 'rgba(200,190,170,' + (0.08 + 0.25 * (1 - k) * rr()).toFixed(3) + ')'; ctx.fillRect(cx + Math.cos(ang) * ro, cy + Math.sin(ang) * ro * 0.42, 1.5, 1.5); }
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      ctx.lineWidth = 1;
      for (i = 0; i < s.planets.length; i++) {
        var p = s.planets[i], ro = orb(p.au);
        ctx.strokeStyle = 'rgba(120,130,160,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy, ro, ro * 0.42, 0, 0, TAU); ctx.stroke();
        var ang = (T / p.period) * TAU + p.phase, x = cx + Math.cos(ang) * ro, y = cy + Math.sin(ang) * ro * 0.42;
        var pr = clamp(2 + Math.log10(p.radius / 1000) * 3, 2, 8);
        ctx.fillStyle = 'hsl(' + Math.round(p.hue) + ',' + (p.type === 'earthlike' ? '60%,55%' : '40%,60%') + ')';
        ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.fill();
        if (p.ring) { ctx.strokeStyle = 'rgba(220,210,180,0.7)'; ctx.beginPath(); ctx.ellipse(x, y, pr * 2, pr * 0.7, 0.3, 0, TAU); ctx.stroke(); }
        ctx.fillStyle = 'rgba(200,210,235,0.85)'; ctx.font = '11px ' + MONO; ctx.fillText(displayName(p, kPlanetAt(i)), x + pr + 4, y - 4);
        if (p.life && T > p.tFormYr + 1e9) { ctx.fillStyle = '#7ee787'; ctx.fillRect(x + pr + 4, y + 2, 4, 4); }
        p._sx = x; p._sy = y; p._sr = pr;
      }
      /* 2D 回退路径的选中高亮（planets 视图那边由 pv.select 自己画）：
         候选就在本恒星系时，把圈画在那颗行星身上 */
      var sel = st.sel;
      if (sel && sel.kind === 'planet' && sel.system === s && sel.obj && sel.obj._sx != null) {
        drawSelRing(ctx, sel.obj._sx, sel.obj._sy, el0, TR('已选中：') + selName(sel) + TR('（Enter 进入）'), (sel.obj._sr || 4) + 8);
      }
    }
    var MONO = 'Consolas, "Cascadia Code", "SF Mono", Menlo, monospace';

    /* 行星球体纹理（离屏，按纪元/旋转节流重绘） */
    function planetColor(ep, p, h, lat, life, night) {
      // 返回 [r,g,b]
      var r, g, b;
      switch (ep) {
        case 'magma': { var ridge = Math.abs(h - 0.5); if (ridge < 0.025) { var k = 1 - ridge / 0.025; r = 255; g = 60 + 90 * k; b = 20; } else { var v = 25 + h * 40; r = v; g = v * 0.9; b = v * 0.9; } break; }
        case 'brownsea': { if (h < 0.5) { r = 92 + h * 30; g = 62 + h * 20; b = 34; } else { var v2 = 55 + (h - 0.5) * 120; r = v2; g = v2 * 0.9; b = v2 * 0.8; } break; }
        case 'bluesea': { if (h < 0.5) { r = 30 + h * 30; g = 60 + h * 60; b = 120 + h * 90; } else { var v3 = 90 + (h - 0.5) * 140; r = v3; g = v3 * 0.92; b = v3 * 0.8; } break; }
        case 'green': case 'human': case 'civil': {
          if (h < 0.5) { r = 18 + h * 30; g = 60 + h * 90; b = 130 + h * 120; }
          else if (h < 0.53) { r = 200; g = 190; b = 140; }
          else if (h < 0.7) { r = 40 + (h - 0.53) * 300; g = 110 + (h - 0.53) * 250; b = 40; }
          else if (h < 0.8) { r = 120 + (h - 0.7) * 500; g = 100 + (h - 0.7) * 400; b = 70; }
          else { r = 235; g = 240; b = 245; }
          if (Math.abs(lat) > 72) { r = 235; g = 240; b = 245; }
          if (night && ep === 'civil' && h >= 0.53 && h < 0.75) { r = r * 0.15 + 255 * 0.5; g = g * 0.15 + 220 * 0.4; b = b * 0.15 + 120 * 0.2; }
          break;
        }
        case 'gas': { var band = 0.5 + 0.5 * Math.sin(lat * 0.35 + h * 3); r = 180 + band * 60; g = 150 + band * 50; b = 110 + band * 30; if (p && p.hue > 150) { r = 120 + band * 40; g = 160 + band * 40; b = 210 + band * 30; } break; }
        case 'ice': { r = 150 + h * 60; g = 200 + h * 40; b = 230 + h * 25; break; }
        default: { var v4 = 70 + h * 120; r = v4; g = v4 * 0.85; b = v4 * 0.7; }
      }
      return [r, g, b];
    }
    var texCanvas = document.createElement('canvas'), texCtx = texCanvas.getContext('2d');
    function renderPlanetTex(p, ep, rot, res) {
      texCanvas.width = res; texCanvas.height = res;
      var img = texCtx.createImageData(res, res), d = img.data;
      // 用完整 32-bit 行星种子作噪声域偏移（/1e6 压到 fbm 合理量级，避免只吃低位）
      var pseed = (planetTexSeed(p) >>> 0) / 1e6;
      var fog = ep === 'magma' ? 0.55 : ep === 'brownsea' ? 0.45 : ep === 'bluesea' ? 0.15 : 0;
      for (var y = 0; y < res; y++) for (var x = 0; x < res; x++) {
        var nx = (x + 0.5) / res * 2 - 1, ny = (y + 0.5) / res * 2 - 1, rr = nx * nx + ny * ny, idx = (y * res + x) * 4;
        if (rr > 1) { d[idx + 3] = 0; continue; }
        var nz = Math.sqrt(1 - rr);
        var cx = nx * Math.cos(rot) + nz * Math.sin(rot), cz = -nx * Math.sin(rot) + nz * Math.cos(rot);
        var h = noise.fbm3(cx * 2.2 + pseed, ny * 2.2, cz * 2.2, 4);
        var lat = Math.asin(-ny) * 57.3;
        var col = planetColor(ep, p, h, lat, p.life, false);
        var light = 0.28 + 0.72 * Math.max(0, (nx * -0.5 + ny * -0.4 + nz * 0.77));
        var f = fog * (0.5 + 0.5 * noise.fbm3(cx * 3 + 9, ny * 3, cz * 3 - 4, 3));
        var r = lerp(col[0], 150, f) * light, g = lerp(col[1], 148, f) * light, b = lerp(col[2], 145, f) * light;
        d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
      }
      texCtx.putImageData(img, 0, 0);
      return texCanvas;
    }
    var lastTexTime = 0;
    function drawPlanet(ctx, W, H, el0, dt) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      var p = st.planet; if (!p) return;
      var r0 = A.rng((st.system ? st.system.seed : seed) ^ 0x99);
      for (var i = 0; i < 160; i++) { ctx.fillStyle = 'rgba(200,210,235,' + (0.2 + r0() * 0.5).toFixed(2) + ')'; ctx.fillRect(r0() * W, r0() * H, 1, 1); }
      var ep = epochOf(p, st.T), R = Math.min(W, H) * 0.34, cx = W / 2, cy = H / 2;
      if (!ep) { var pg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4); pg.addColorStop(0, 'rgba(120,110,120,0.5)'); pg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = pg; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#8B8FA8'; ctx.font = '13px ' + SANS; ctx.textAlign = 'center'; ctx.fillText(TR('行星尚未形成'), cx, cy + R * 1.5); ctx.textAlign = 'left'; return; }
      if (!rm) st.planetRot += dt * 0.06;
      var key = ep + '|' + Math.round(st.planetRot / 0.06);
      var now = el0;
      if (!st.planetTex || (key !== st.planetTexKey && now - lastTexTime > 0.12)) { if (!st.planetTex && o.onBusy) { o.onBusy(TR('正在生成星球表面…')); o.onBusyDone && setTimeout(function () { o.onBusyDone(); }, 0); } st.planetTex = renderPlanetTex(p, ep, st.planetRot, 200); st.planetTexKey = key; lastTexTime = now; }
      // 大气辉光
      var atm = ep === 'gas' ? 'rgba(220,200,160,0.25)' : (ep === 'green' || ep === 'human' || ep === 'civil' || ep === 'bluesea') ? 'rgba(120,180,255,0.35)' : ep === 'brownsea' ? 'rgba(200,170,90,0.3)' : ep === 'magma' ? 'rgba(255,120,60,0.2)' : 'rgba(180,200,230,0.15)';
      var ag = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.12); ag.addColorStop(0, atm); ag.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, TAU); ctx.fill();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(st.planetTex, cx - R, cy - R, 2 * R, 2 * R);
      if (p.ring) { ctx.strokeStyle = 'rgba(220,210,180,0.55)'; ctx.lineWidth = R * 0.12; ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.7, R * 0.45, -0.25, 0.1, Math.PI - 0.1); ctx.stroke(); }
      // 云 / 夜半球灯火（文明纪元）
      // 文明灯火按行星种子抽，不再用宇宙 seed^0xc1（否则同一宇宙所有 civil 行星灯火图案完全一样）
      if (ep === 'civil') { ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip(); var rr = A.rng(planetTexSeed(p) ^ 0xc1); ctx.fillStyle = 'rgba(255,220,140,0.9)'; for (i = 0; i < 260; i++) { var ang = rr() * TAU, rad = Math.sqrt(rr()) * R; var x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad; if (x > cx + R * 0.35) ctx.fillRect(x, y, 1.2, 1.2); } ctx.restore(); }
    }
    var SANS = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

    /* 地表（离屏低分辨率栅格 → 放大） */
    var surfCanvas = document.createElement('canvas'), surfCtx = surfCanvas.getContext('2d');
    function renderSurface(p, ep, cam, W, H, dayK, res) {
      var rw = res, rh = Math.max(2, Math.round(res * H / W));
      surfCanvas.width = rw; surfCanvas.height = rh;
      var img = surfCtx.createImageData(rw, rh), d = img.data;
      var fovDeg = clamp(cam.alt / (p.radius * 1000) * 57.3 * 1.6, 0.0006, 140);
      var pseed = (planetTexSeed(p) >>> 0) / 1e6;
      var oct = 5;
      var fog = ep === 'magma' ? clamp(cam.alt / 1.5e4, 0.15, 0.6) : ep === 'brownsea' ? clamp(cam.alt / 2e4, 0.1, 0.5) : ep === 'bluesea' ? clamp(cam.alt / 4e5, 0, 0.12) : 0;
      var night = dayK < 0.5;
      for (var y = 0; y < rh; y++) for (var x = 0; x < rw; x++) {
        var u = cam.lon + ((x + 0.5) / rw - 0.5) * fovDeg, v = cam.lat + (0.5 - (y + 0.5) / rh) * fovDeg * rh / rw;
        var h = noise.fbm2(u * 0.9 + pseed, v * 0.9, oct);
        // 细节层：随高度加入更高频
        if (cam.alt < 5e4) h = h * 0.75 + 0.25 * noise.fbm2(u * 40 + pseed, v * 40, 3);
        if (cam.alt < 3e3) h = h * 0.85 + 0.15 * noise.fbm2(u * 900 + pseed, v * 900, 2);
        var col = planetColor(ep, p, h, v, p.life, night);
        var idx = (y * rw + x) * 4;
        var light = night ? 0.22 : 1;
        var r = lerp(col[0], ep === 'brownsea' ? 190 : 160, fog) * light, g = lerp(col[1], ep === 'brownsea' ? 170 : 158, fog) * light, b = lerp(col[2], ep === 'brownsea' ? 110 : 155, fog) * light;
        if (ep === 'civil' && night && h >= 0.53 && h < 0.75 && cam.alt < 3e5) { var lz = noise.n2(u * 300 + pseed, v * 300); if (lz > 0.62) { r = 255; g = 220; b = 140; } }
        if (ep === 'magma' && h > 0.475 && h < 0.525) { light = 1; }
        d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
      }
      surfCtx.putImageData(img, 0, 0);
      return surfCanvas;
    }
    function drawSurface(ctx, W, H, el0, dt) {
      var p = st.planet; if (!p) return;
      var ep = epochOf(p, st.T);
      if (!ep) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
      if (st.diveTo != null) { st.cam.alt = lerp(st.cam.alt, st.diveTo, 1 - Math.pow(0.001, dt)); if (Math.abs(st.cam.alt - st.diveTo) < st.diveTo * 0.02) { st.cam.alt = st.diveTo; st.diveTo = null; } alt.textContent = TR('高度 ') + fmtAlt(st.cam.alt); }
      // 昼夜：小时间比例下随时间滑动高频闪动（自转周期远小于滑块步长时的混叠）
      var dayK = 1; if (st.span <= 1e3) { var frac = ((-st.T * 365.25) % 1 + 1) % 1; dayK = frac < 0.55 ? 1 : 0.2; }
      var key = ep + '|' + Math.round(Math.log(st.cam.alt) * 40) + '|' + st.cam.lat.toFixed(4) + '|' + st.cam.lon.toFixed(4) + '|' + dayK + '|' + W + 'x' + H;
      if (key !== st.surfKey) { st.surfTex = renderSurface(p, ep, st.cam, W, H, dayK, 176); st.surfKey = key; }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(st.surfTex, 0, 0, W, H);
      // 雾 / 光晕
      if (ep === 'magma') { var f = clamp(st.cam.alt / 1.5e4, 0.05, 0.4); ctx.fillStyle = 'rgba(70,60,60,' + f.toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
      if (ep === 'brownsea') { var f2 = clamp(st.cam.alt / 2e4, 0.05, 0.35); ctx.fillStyle = 'rgba(190,160,90,' + f2.toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
      // 高度标尺
      ctx.fillStyle = 'rgba(233,230,245,0.8)'; ctx.font = '11px ' + MONO; ctx.fillText(TR('高度 ') + fmtAlt(st.cam.alt) + '   ' + st.cam.lat.toFixed(3) + '°, ' + st.cam.lon.toFixed(3) + '°', 16, H - 92);
    }

    /* 递归魔盒（错误跟踪 step by step） */
    function drawTrace(ctx, W, H, el0) {
      var tr = st.soTrace, t = el0 - tr.t0;
      ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, W, H);
      var levels = 9, k = (rm ? t * 0.35 : t * 0.9) % 1, base = Math.min(W, H) * 0.7;
      ctx.save(); ctx.translate(W / 2, H / 2);
      var scale = Math.pow(0.55, k); ctx.scale(scale, scale);
      for (var i = 0; i < levels; i++) {
        var s = base * Math.pow(0.55, i), a = clamp(1 - i * 0.1, 0.15, 1);
        ctx.strokeStyle = 'rgba(160,190,240,' + a + ')'; ctx.lineWidth = 1.5 / scale;
        ctx.strokeRect(-s / 2, -s / 2 * 0.62, s, s * 0.62);
        ctx.fillStyle = 'rgba(30,36,60,' + (a * 0.9) + ')'; ctx.fillRect(-s / 2, -s / 2 * 0.62, s, s * 0.62);
        // 屏幕里的滑块正滑过零点
        var y = s * 0.2; ctx.strokeStyle = 'rgba(200,205,225,' + a + ')'; ctx.beginPath(); ctx.moveTo(-s * 0.4, y); ctx.lineTo(s * 0.4, y); ctx.stroke();
        var zx = s * 0.15; ctx.strokeStyle = 'rgba(255,90,90,' + a + ')'; ctx.beginPath(); ctx.moveTo(zx, y - s * 0.03); ctx.lineTo(zx, y + s * 0.03); ctx.stroke();
        var sx = zx + s * 0.03 * ((t * 2 + i) % 1); ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(sx - s * 0.008, y - s * 0.02, s * 0.016, s * 0.04);
        ctx.fillStyle = 'rgba(232,236,245,' + a + ')'; ctx.font = (s * 0.05) + 'px ' + MONO; ctx.fillText(TR('第 ') + (Math.floor(t * (rm ? 0.35 : 0.9)) + i + 1) + TR(' 层 · Stack overflow'), -s * 0.4, -s * 0.22);
      }
      ctx.restore();
      ctx.fillStyle = '#E9E6F5'; ctx.font = '14px ' + SANS; ctx.textAlign = 'center';
      ctx.fillText(TR('彩蛋：每一层都在模拟下一层，每次调用都要把上层现场压入堆栈——没有终止条件，堆栈迟早耗尽。'), W / 2, H - 120);
      ctx.fillText(TR('限制在别处：未来不可计算——混沌对初始条件敏感（Lorenz 1963），量子测量结果本身随机。'), W / 2, H - 96);
      ctx.fillStyle = '#8B8FA8'; ctx.font = '12px ' + SANS; ctx.fillText(TR('按 Esc / 点击 结束跟踪'), W / 2, H - 72);
      ctx.textAlign = 'left';
    }

    /* ---------- 主绘制 */
    function drawLevel(ctx, W, H, el0, dt) {
      if (pv && st.level >= 2 && !pcanvas.hidden) { ctx.clearRect(0, 0, W, H); syncPV(); return; }
      switch (st.level) {
        case 0: drawWeb(ctx, W, H, el0); break;
        case 1: drawGalaxy(ctx, W, H, el0); break;
        case 2: drawSystem(ctx, W, H, el0); break;
        case 3: drawPlanet(ctx, W, H, el0, dt); break;
        case 4: drawSurface(ctx, W, H, el0, dt); break;
      }
    }
    var api = {
      draw: function (ctx, W, H, dt, el0) {
        advanceLocate(dt);
        if (bannerEl) { st.bannerT += dt; if (st.bannerOpen && st.bannerT > (rm ? 2.5 : 4)) { st.bannerOpen = false; paintBanner(); } }
        if (dimMode === 'orbitDemo' && st.level === 2) { st.demoAcc += dt; if (st.demoAcc >= 0.25) { st.demoAcc = 0; updateDemoRows(); } }
        if (st.trans) {
          var tr = st.trans; tr.t += dt / (rm ? 0.5 : 0.9);
          if (tr.t < 0.5) {
            var k = ease(tr.t / 0.5), z = 1 + 18 * k * k;
            ctx.save(); ctx.translate(tr.cx, tr.cy); ctx.scale(z, z); ctx.translate(-tr.cx, -tr.cy);
            drawLevel(ctx, W, H, el0, dt); ctx.restore();
            ctx.fillStyle = 'rgba(0,0,0,' + k.toFixed(2) + ')'; ctx.fillRect(0, 0, W, H);
          } else {
            if (!tr.done) { tr.done = true; tr.then(); }
            drawLevel(ctx, W, H, el0, dt);
            var k2 = 1 - ease((tr.t - 0.5) / 0.5); ctx.fillStyle = 'rgba(0,0,0,' + k2.toFixed(2) + ')'; ctx.fillRect(0, 0, W, H);
            if (tr.t >= 1) st.trans = null;
          }
        } else drawLevel(ctx, W, H, el0, dt);
        if (st.soTrace) drawTrace(ctx, W, H, el0);
      },
      pointer: function (type, ev, W, H) {
        if (st.soOpen && !st.soTrace) return;
        if (st.soTrace) { if (type === 'down') closeSO(); return; }
        if (st.trans) return;
        var u = ev.offsetX / W, v = ev.offsetY / H;
        if (type === 'wheel') {
          if (st.level === 3) { if (ev.deltaY > 0) enterSurface(st.cam.lat, st.cam.lon); }
          else if (st.level === 4) { changeAlt(ev.deltaY > 0 ? 1 / 1.3 : 1.3, 1); }
          return;
        }
        if (pv && st.level >= 2 && !pcanvas.hidden) return;   // 星球模块自行处理点击/双击
        /* 单击 = 选中这一处（和 planets.js 的"单击选中"一个约定），双击才进去。
           2D 回退路径上以前只有双击，用户没有"先看一眼再决定"的机会。 */
        if (type === 'down') {
          if (st.level === 0) setSel({ kind: 'galaxy', idx: -1, obj: genGalaxy(galSeedAt(u, v), false), u: u, v: v, box: false });
          else if (st.level === 1 && st.galaxy && st.T >= st.galaxy.tFormYr) {
            var sysHere = makeSystemSafe(sysSeedAt(u, v));
            if (sysHere) setSel({ kind: 'system', idx: -1, obj: sysHere, u: u, v: v, box: false });
          } else if (st.level === 2 && st.system && st.T >= st.system.tPlanetsYr) {
            var hit = null, hd = 1e9;
            st.system.planets.forEach(function (p) { if (p._sx == null) return; var d = Math.hypot(p._sx - ev.offsetX, p._sy - ev.offsetY); if (d < hd) { hd = d; hit = p; } });
            if (hit && hd < 40) selPlanetAt(indexOfPlanet(hit), st.system); else clearSel();
          }
          return;
        }
        /* 双击 = 毫无歧义的"我要进这里"：不经过选中，直接进（用户的要求是"随机选一个再决定进不进"，
           双击本来就是自己指定了目标，没有要决定的余地）。选中的候选顺手作废，免得进去以后还挂着。 */
        if (type === 'dblclick') {
          if (st.level === 0) { st.sel = null; chooseGalaxy(u, v); }
          else if (st.level === 1 && st.galaxy && st.T >= st.galaxy.tFormYr) { st.sel = null; chooseSystem(u, v); }
          else if (st.level === 2 && st.system && st.T >= st.system.tPlanetsYr) {
            var best = null, bd = 1e9; st.system.planets.forEach(function (p) { if (p._sx == null) return; var d = Math.hypot(p._sx - ev.offsetX, p._sy - ev.offsetY); if (d < bd) { bd = d; best = p; } });
            if (best && bd < 40) { st.sel = null; selectPlanet(best); }
          }
          else if (st.level === 3) { var dx = (u - 0.5) * 2, dy = (v - 0.5) * 2; enterSurface(clamp(st.cam.lat - dy * 60, -85, 85), st.cam.lon + dx * 90); }
          else if (st.level === 4) { var fov = clamp(st.cam.alt / (st.planet.radius * 1000) * 57.3 * 1.6, 0.0006, 140); st.cam.lon += (u - 0.5) * fov; st.cam.lat = clamp(st.cam.lat + (0.5 - v) * fov * H / W, -89, 89); dive(); renderInfo(); }
        }
      },
      key: function (ev) {
        if (st.trans || st.locating || st.locateSeq) return true;   // 过渡/定位进行中：吃掉按键，别跳级
        if (st.soTrace) { if (ev.key === 'Escape' || ev.key === 'Enter') { closeSO(); ev.preventDefault(); } return true; }
        if (st.soOpen) { if (ev.key === 'Escape' || ev.key === 'Enter') { closeSO(); ev.preventDefault(); } return true; }
        var tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
        switch (ev.key) {
          case 'ArrowLeft': if (ev.altKey) { goBackVisit(); ev.preventDefault(); return true; } return false;
          case 'Backspace': if (st.level > 0) { goLevel(st.level - 1); ev.preventDefault(); return true; } return false;
          case 'Escape': if (st.level > 0) { goLevel(st.level - 1); return true; } return false;   // 顶层 Esc 交给 app（退出镜像）
          case '[': setT(st.T - st.span * 0.02, false); return true;
          case ']': setT(st.T + st.span * 0.02, false); return true;
          /* , / . 只在行星层与地表层切换本恒星系的行星。
             恒星系层（level 2）不绑：planets.js 在 system 模式下用 Comma/Period 调轨道流速，抢了会打架；
             时间轴仍是 [ / ]，两组互不重叠。 */
          case ',': case '<': if (st.level === 3 || st.level === 4) { stepPlanet(-1); ev.preventDefault(); return true; } return false;
          case '.': case '>': if (st.level === 3 || st.level === 4) { stepPlanet(1); ev.preventDefault(); return true; } return false;
          /* PageUp / PageDown 在星系层换星系、恒星系层换恒星系。
             planets.js 里这两个键只在 surface 模式用来调高度（level 4），和这里的 level 1/2 不重叠；
             行星层的 , / . 也各管各的。 */
          case 'PageUp': if (st.level === 1) { stepGalaxy(-1); ev.preventDefault(); return true; }
            if (st.level === 2) { stepSystem(-1); ev.preventDefault(); return true; } return false;
          case 'PageDown': if (st.level === 1) { stepGalaxy(1); ev.preventDefault(); return true; }
            if (st.level === 2) { stepSystem(1); ev.preventDefault(); return true; } return false;
          case '+': case '=': if (st.level === 4) changeAlt(1 / 1.3, 1); else if (st.level === 3) enterSurface(st.cam.lat, st.cam.lon); return true;
          case '-': if (st.level === 4) changeAlt(1.3, 1); return true;
          case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
            if (st.level !== 4) return false;
            var fov = clamp(st.cam.alt / (st.planet.radius * 1000) * 57.3 * 1.6, 0.0006, 140) * 0.15;
            if (ev.key === 'ArrowLeft') st.cam.lon -= fov; if (ev.key === 'ArrowRight') st.cam.lon += fov; if (ev.key === 'ArrowUp') st.cam.lat = clamp(st.cam.lat + fov, -89, 89); if (ev.key === 'ArrowDown') st.cam.lat = clamp(st.cam.lat - fov, -89, 89);
            renderInfo(); ev.preventDefault(); return true;
          }
          /* ---------- Enter 归谁管（只此一处，别再加第二个处理器）
           * planets.js 自己在 pcanvas 上绑了 keydown，Enter → 它的 enterSelected()。那个监听器只有
           * **画布拿到焦点**时才会触发，而且是在目标阶段先跑，等事件冒到 document 才轮到 app.js → 这里。
           * 所以分工按"焦点在谁身上 + 它那边这一下有没有用"来定：
           *   1) **恒星系层（level 2）+ 画布在前台 + 画布有焦点** → 这一下已经被 planets.js 处理过
           *      （它的选中项和这里是同一个，靠 pv.select 同步），必须 return false 放行，
           *      否则同一次 Enter 会连下两级。
           *   2) 其它所有情况 → 由 mirror 管：有选中就进入选中项，没有就沿用老的就近进入。
           *      - 0/1 层与 2D 回退：planets.js 根本不在场；
           *      - 3/4 层：planets.js 的 enterSelected() 里第一句就是 `if (S.mode !== 'system') return`，
           *        它对这两层的 Enter 什么都不做，让给 mirror 才不会变成"按了没反应"；
           *      - "画布在前台但焦点在动作条按钮上"（用户刚点完「随机选一个…」正是这种）：
           *        planets.js 的监听器压根不会触发，以前一律 return false，结果就是按 Enter 没反应。 */
          case 'Enter': {
            var tNow = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
            // planets.js 已经在这一次按键里进去了（它的 'enter' 事件刚刚打过时间戳）：吃掉，别再进第二次
            if (st.pvEnterT != null && tNow - st.pvEnterT < 150) { ev.preventDefault(); return true; }
            /* 只有"这一下 planets 那边确实做得成"时才让给它：恒星系层 + 画布有焦点 +
               （没有候选 或 候选就是本恒星系的一颗行星，也就是 pv.select 同步过去的那个）。
               候选是恒星系/别的恒星系的行星时它的 enterSelected() 什么都不会做，必须由这里接手。 */
            // !st.sel 不能一律当“planets.js 那边这一下能处理”：st.sel 只有 kind 'planet' 这一种候选，
            // 表达不出“S.selected===-2（选中了恒星本体，它的 enterSelected() 真能处理）”与
            // “S.selected===-1（什么都没选，它的 enterSelected() 直接 return，什么也不做）”的区别——
            // 混为一谈就会在后一种情况下把 Enter 白白吞掉：两边都不动，是“点了没反应”的一个具体实例。
            // 直接问 pv 自己的选中状态，别再用 !st.sel 猜。
            var pvSelIdx = null;
            if (pv && typeof pv.getState === 'function') { try { pvSelIdx = pv.getState().selectedIndex; } catch (e) { /* ignore */ } }
            var selIsPVs = st.sel ? (st.sel.kind === 'planet' && st.sel.system === st.system) : (pvSelIdx === -2);
            var canvasOwnsEnter = !!(pv && st.level === 2 && pcanvas && !pcanvas.hidden && document.activeElement === pcanvas && selIsPVs);
            if (canvasOwnsEnter) return false;
            if (st.sel) { enterSelected(); ev.preventDefault(); return true; }
            var W = box.clientWidth, H = box.clientHeight;
            if (st.level === 0) { if (ours) locateGalaxy(); else chooseGalaxy(0.5, 0.5); }
            else if (st.level === 1) { if (st.galaxy.ours) locateSun(); else chooseSystem(0.7, 0.4); }
            else if (st.level === 2 && MAX_LEVEL >= 3 && st.system) { var lp = st.system.planets.filter(function (p) { return p.life; })[0] || st.system.planets[0]; if (st.T >= st.system.tPlanetsYr) selectPlanet(lp); }
            else if (st.level === 3) enterSurface(st.cam.lat, st.cam.lon);
            else if (st.level === 4) dive();
            return true;
          }
          case 'l': case 'L': if (st.level === 0 && ours) locateGalaxy(); else if (st.level === 1 && st.galaxy && st.galaxy.ours) locateSun(); else if (st.level === 2 && st.system && st.system.ours) selectPlanet(st.system.planets[2]); return true;
        }
        return false;
      },
      state: function () { return st; },
      /* 右键菜单要用的当前层导航项。和底部动作条 renderActions() 同一批动作、同一套可用性判断，
         措辞也一致：**「随机选一个…」「上一个 / 下一个」只选中**，进入单列一项（选中时才出现）。
         返回 [{ id, label, key, enabled, note, run }]；note 是灰显时的原因。 */
      menu: function () {
        var busy = !!(st.trans || st.locating || st.locateSeq);
        var busyNote = TR('正在过渡/定位，等这一段放完再操作');
        var out = [];
        // 选中项排在最前：这是"眼下要不要进去"的那个决定
        if (st.sel && st.sel.obj) {
          out.push({ id: 'enterSel', label: TR('进入：') + selName(st.sel), key: 'Enter', enabled: !busy,
            note: busy ? busyNote : (TR('进入选中的') + selKindName(st.sel.kind) + TR('（') + selCountText(st.sel) + TR('）')), run: enterSelected });
          out.push({ id: 'clearSel', label: TR('取消选择'), enabled: !busy, note: busy ? busyNote : TR('放弃这次选中，留在当前这一层'), run: clearSel });
        }
        if (st.level > 0) out.push({ id: 'up', label: TR('返回上一级（') + crumbLabel(st.level - 1) + TR('）'), key: 'Backspace',
          enabled: !busy, note: busy ? busyNote : '', run: function () { goLevel(st.level - 1); } });
        var selNote = TR('只选中并给出详细信息，按 Enter / 点「进入」才真的过去');
        var nx = null;
        if (st.level === 0) nx = { id: 'next', label: TR('随机选一个星系'), note: selNote, run: selRandomGalaxy };
        else if (st.level === 1) nx = { id: 'next', label: TR('随机选一个恒星系'), note: selNote, run: selRandomSystem };
        else if (st.level === 2) nx = (MAX_LEVEL >= 3)
          ? { id: 'next', label: TR('随机选一颗星球'), note: TR('在本恒星系里随机挑一颗行星：') + selNote, run: selRandomPlanet }
          : { id: 'next', label: TR('随机选一个恒星系'), note: selNote, run: selRandomSystem };   // 轨道投影演示：到恒星系为止
        if (nx) { nx.enabled = !busy; if (busy) nx.note = busyNote; out.push(nx); }
        // 宇宙网层：目录内前后选中（到头循环）
        if (st.level === 0) {
          var gl0 = galaxyCatalog(), gct0 = galCountText(), gone0 = gl0.length < 2;
          var gwhy0 = busy ? busyNote : (gone0 ? TR('目录里只有一个星系') : galSourceNote() + TR('，到头循环；') + selNote);
          out.push({ id: 'gprev', label: TR('上一个星系') + (gct0 ? TR('（') + gct0 + TR('）') : ''), enabled: !busy && !gone0, note: gwhy0, run: function () { stepGalaxy(-1); } });
          out.push({ id: 'gnext', label: TR('下一个星系') + (gct0 ? TR('（') + gct0 + TR('）') : ''), enabled: !busy && !gone0, note: gwhy0, run: function () { stepGalaxy(1); } });
        }
        // 星系层：目录内前后选中（PageUp/PageDown），到头循环
        if (st.level === 1) {
          var gl = galaxyCatalog(), gct = galCountText(), gone = gl.length < 2;
          var gwhy = busy ? busyNote : (gone ? TR('目录里只有一个星系') : galSourceNote() + TR('，到头循环；') + selNote);
          out.push({ id: 'gprev', label: TR('上一个星系') + (gct ? TR('（') + gct + TR('）') : ''), key: 'PageUp', enabled: !busy && !gone, note: gwhy, run: function () { stepGalaxy(-1); } });
          out.push({ id: 'gnext', label: TR('下一个星系') + (gct ? TR('（') + gct + TR('）') : ''), key: 'PageDown', enabled: !busy && !gone, note: gwhy, run: function () { stepGalaxy(1); } });
          out.push({ id: 'grand', label: TR('随机选一个星系（目录外）'), enabled: !busy, note: busy ? busyNote : TR('不走目录（目录 = N 体盒里识别出的晕，数量受分辨率限制，不是星系总数）；') + selNote, run: selRandomGalaxyOff });
        }
        // 恒星系层：本星系目录内前后选中
        if (st.level === 2) {
          var ss = systemSeeds(), sct = sysCountText(), sone = ss.length < 2;
          var swhy = busy ? busyNote : (sone ? TR('这个星系的目录里只有一个恒星系') : sysSwitchTitle());
          out.push({ id: 'sprev', label: TR('上一个恒星系') + (sct ? TR('（') + sct + TR('）') : ''), key: 'PageUp', enabled: !busy && !sone, note: swhy, run: function () { stepSystem(-1); } });
          out.push({ id: 'snext', label: TR('下一个恒星系') + (sct ? TR('（') + sct + TR('）') : ''), key: 'PageDown', enabled: !busy && !sone, note: swhy, run: function () { stepSystem(1); } });
          if (MAX_LEVEL >= 3) out.push({ id: 'srand', label: TR('随机选一个恒星系（目录外）'), enabled: !busy, note: busy ? busyNote : TR('不走目录（目录只是按种子派生的一份清单，不是恒星系总数）；') + selNote, run: selRandomSystemOff });
          /* 按恒星演化阶段找：这些天体真实存在但稀少（红巨星约 1/700），没有入口就等于看不见。
             五条平铺在一级菜单里，读起来是五遍「找一个…系统」，还把「返回上一级」「时间轴回到现在」
             这些常用项挤到很下面。收进一个二级项：一级只占一行，展开才是那五类。 */
          var findNote = TR('按种子扫描直到找到这一类宿主：它们真实存在但稀少（实测白矮星约 6.2%、红巨星约 0.14%、黑洞约 0.11%），随机点很难碰上');
          out.push({
            id: 'findStage', label: TR('寻找指定天体'), enabled: !busy,
            note: busy ? busyNote : TR('按恒星类型在本星系里搜，找到就飞过去'),
            subNote: TR('按恒星类型在本星系里搜，找到就飞过去'),
            sub: STAGE_FIND.map(function (d) {
              return { id: 'find_' + d.id, label: TR(d.sub), enabled: !busy,
                note: busy ? busyNote : findNote,
                run: function () { findStage(d); } };
            })
          });
        }
        // 行星层/地表层：本系内前后各一项（带序号与快捷键），跨恒星系的随机单列一项，措辞区分开
        if (st.level === 3 || st.level === 4) {
          var ps = planetList(), ct = planetCountText(), one = ps.length < 2;
          var inSys = TR('在本恒星系内选另一颗（共 ') + ps.length + TR(' 颗，到头循环）；') + selNote;
          var why = busy ? busyNote : (one ? TR('这个恒星系只有一颗行星，没有别的可选') : inSys);
          out.push({ id: 'prev', label: TR('上一颗星球') + (ct ? TR('（') + ct + TR('）') : ''), key: ',',
            enabled: !busy && !one, note: why, run: function () { stepPlanet(-1); } });
          out.push({ id: 'nextP', label: TR('下一颗星球') + (ct ? TR('（') + ct + TR('）') : ''), key: '.',
            enabled: !busy && !one, note: why, run: function () { stepPlanet(1); } });
          out.push({ id: 'randPlanet', label: TR('随机选一颗（换恒星系）'),
            enabled: !busy, note: busy ? busyNote : TR('随机挑另一个恒星系的一颗星球；进入才会离开当前恒星系'), run: selRandomPlanetElsewhere });
        }
        out.push({ id: 'now', label: TR('时间轴回到现在'), enabled: !busy && Math.abs(st.T) > 1,
          note: busy ? busyNote : (Math.abs(st.T) > 1 ? '' : TR('时间轴已经停在"现在"')),
          run: function () { setT(0, false); } });
        // 重命名放在最前：它针对的是"眼下这个天体"，与下面那些"去别处"的动作不是一类
        var tn = titleOf();
        if (tn.key) {
          var cur = Names.get(tn.key);
          out.unshift({ id: 'rename', label: TR('重命名（当前天体）'), enabled: !busy,
            note: busy ? busyNote : (cur ? TR('现在叫「') + cur + TR('」，原名 ') + origNameOf(tn.obj) + TR('；留空可恢复原名') : TR('给「') + origNameOf(tn.obj) + TR('」起个自己的名字（最多 ') + Names.MAX + TR(' 字）')),
            run: startRename });
        }
        return out;
      },
      /* 自定义天体名：给宿主（app.js 的管理目录）用。
         refreshNames() 在别处改完名字后把画布标签/面包屑/列表一起刷新。 */
      nameKey: function () { return titleOf().key; },
      renameCurrent: startRename,
      refreshNames: refreshNames,
      prewarm: function () { prewarmPV(); return api; },   // 宿主也可以主动催一次（app.js 在 3D 跑起来后调）
      pvCreateMs: function () { return pv && pv.createMs ? pv.createMs() : null; },
      shadersPending: function () { return pv && pv.shadersPending ? pv.shadersPending() : null; },
      lastEnterMs: function () { return st.lastEnterMs || null; },   // 进恒星系那一帧的分段耗时（看门狗 dump 的 enterSystemMs）
      planetsView: function () { return pv; },   // 调试/自检用：无头环境里 planets 的 rAF 不跑，靠它驱动 stepDemo
      usesPlanetCanvas: function () { return !!(pv && st.level >= 2 && pcanvas && !pcanvas.hidden); },
      // st.disposed：延后的开层回调（见 create 尾部的 prewarmPV(...)）靠它认出自己已经过期
      dispose: function () {
        st.disposed = true;
        /* 监听器要跟着摘：留着的话退出镜像后每次切语言都会往已经清空的 box 里重画一遍 */
        try { root.document.removeEventListener('mirror:lang', relangUI); } catch (e) { /* ignore */ }
        if (pv && pv.dispose) { try { pv.dispose(); } catch (e) { /* ignore */ } } pv = null; pvVisible(false); box.innerHTML = '';
      }
    };
    layoutWindow(); refreshUI();
    try { root.document.addEventListener('mirror:lang', relangUI); } catch (e) { /* 没有 document（自检环境）就算了 */ }
    /* 从 3D 点选恒星进来：直接用那颗星的种子建恒星系并落到第 2 层。
       以前 app.js 只是合成 Enter 逐级下潜，落到的是随机恒星系——点哪颗星进去的都不是它。
       太阳（isSun）仍走"定位银河系 → 定位太阳"这条观测目录路径，那条路本身就是确定的。

       **开层不在构造里同步做**（2026-09-17）：ensurePV() → planets.createView 是这条路上最贵的一步，
       同步做就等于把它压进用户点击的那一帧（真机实测 2.0 秒）。现在先把恒星系数据备好、
       镜像照常显示（星系层），把开层挂在预热之后 —— 预热完成或 400 ms 兜底到了才 showSystem。
       期间宿主的「正在建立镜像」忙碌条保持亮着（onBusy / onBusyDone 是 app.js 传进来的）。 */
    if (o.starSeed != null && !o.isSun) {
      st.galaxy = genGalaxy((seed ^ ((o.starSeed >>> 0) * 2654435761)) >>> 0, false);
      st.system = makeSystem(o.starSeed >>> 0, false);
      if (o.starName && st.system) st.system.name = o.starName;
      st.warmAt = nowMs2();
      /* onBusy 放进一个宏任务里再叫：宿主（app.js）在 create() 返回之后才会 hideBusy()，
         同一拍里直接叫会被它紧接着关掉。 */
      if (typeof o.onBusy === 'function') root.setTimeout(function () { if (!st.disposed && st.level < 2) o.onBusy('正在建立镜像'); }, 0);
      prewarmPV(function () {
        if (st.disposed || st.level >= 2) return;
        enterSystemLevel();
        if (typeof o.onBusyDone === 'function') { try { o.onBusyDone(); } catch (e) { /* ignore */ } }
      });
    } else if (o.starSeed != null && o.isSun && ours) {
      prewarmPV();
      locateGalaxy();                       // 观测目录路径：定位银河系 →（到了再定位太阳）
    } else {
      prewarmPV();   // 进镜像就开始预热 planets 视图（空闲时编着色器），进恒星系那一下才不卡
    }
    return api;
  }

  root.MirrorBrowser = { create: create, epochOf: epochOf, genSystem: genSystem, genGalaxy: genGalaxy, names: Names, displayName: displayName };
})(typeof window !== 'undefined' ? window : this);
