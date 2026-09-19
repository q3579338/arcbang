/*
 * ui/app.js —— 状态机与页面逻辑
 * ------------------------------------------------------------
 * 状态：select（起爆参数页）→ confirm（乳白确认页）→ detonate（引爆动画）→ space（进入宇宙 / 结局画面）
 *       → mirror（镜像浏览，仅 OBSERVERS_POSSIBLE 且空间维数 D=3：见 canMirror）
 * 覆盖层：editor（参数编辑器抽屉）、analysis（分析界面，A/F2 或右键菜单第一项）、ctx-menu（右键上下文菜单）
 * 一个 rAF 主循环驱动当前 view.draw(ctx, W, H, dt, elapsed)；页面隐藏时暂停。
 */
(function () {
  'use strict';
  var A = window.MirrorAdapter, Scenes = window.MirrorScenes, MB = window.MirrorBrowser, MP = window.MirrorParticles;
  var U3D = window.MirrorUniverse3D;
  var HY = window.MirrorHyper;                      // ui/hyper.js：真 D 维 N 体 + 可换轴投影（specs/highdim-v1.md §一）
  var $ = function (id) { return document.getElementById(id); };
  /* 中英文案：词典在 web/i18n-app.js；i18n 没加载时静默退回中文 */
  var T = function (s) { return (window.MirrorI18n ? window.MirrorI18n.t(s, 'app') : s); };
  /* 引擎运行时叙事（时间线、结论、发现、常数核对）走模板翻译：MirrorI18n.tx()。
     引擎产出的实例串带数值，逐字词典命中不了；tx 在显示层按模板匹配（词条与模板
     都在 web/i18n-mirror.js 的「引擎运行时叙事」一册）。中文态与 i18n 缺席时原样返回。 */
  var TE = function (s) { var I = window.MirrorI18n; return (I && I.tx && s != null) ? I.tx(String(s)) : s; };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = $('stage'), ctx = stage.getContext('2d');
  var glCanvas = $('gl'), planetCanvas = $('planet'), gl3d = $('gl3d');
  var glR = MP ? MP.createGL(glCanvas) : { ok: false };
  var W = 0, H = 0, dpr = 1;
  // URL 开关：?mode=webgl2|webgpu 强制 3D 后端；?mode=2d 或 ?3d=off 关掉 3D（回到旧的 2D 粒子网）
  var QS = (function () { try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; } })();
  var Q_MODE = String(QS.get('mode') || '').toLowerCase();
  var FORCE_3D_BACKEND = (Q_MODE === 'webgl2' || Q_MODE === 'webgpu') ? Q_MODE : null;
  var ALLOW_3D = Q_MODE !== '2d' && String(QS.get('3d') || '').toLowerCase() !== 'off';
  // ?hyper=off 关掉 D 维 N 体（回到旧的 3 维 PM 外推网）；?hyper=cpu 强制 Worker CPU 档，用来对比帧耗时
  var Q_HYPER = String(QS.get('hyper') || '').toLowerCase();

  /* ---------------------------------------------------------- 状态 */
  var S = {
    state: 'select', view: null, sim: null, entry: null, scene: null, mirror: null, u3d: null, no3D: false,
    analysisOpen: false, editorOpen: false, editEntry: null, editParams: null, listOpen: false, activeRow: -1,
    lastTime: 0, elapsed: 0, running: true, hidden: !!document.hidden,
    aDownT: 0, mirrorDrive: null, starPick: null, tsync: null, ttoggle: null, sup3d: undefined, mirrorMode: '3d', aboutOpen: false, tlYears: 0
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth || window.innerWidth; H = stage.clientHeight || window.innerHeight;
    stage.width = Math.round(W * dpr); stage.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (glR.ok) glR.resize(W, H, dpr);
    if (S.u3d) { try { S.u3d.resize(); } catch (e) { console.warn('[app] u3d resize', e); } }
    if (S.mirror && S.mirror.usesPlanetCanvas && S.mirror.usesPlanetCanvas()) { /* MirrorPlanets 视图自行 resize */ }
  }
  window.addEventListener('resize', function () { resize(); tlReposition(); });
  resize();

  /* 提示条原来固定在 CSS 的 top:22px，而顶部中间还站着"免责说明"（top:10）和 3D 状态栏（top:34），
     于是提示一弹出来就把这两行盖住——用户报的"这里遮挡了"。改成每次显示前量一遍：
     落在所有可见的顶部条目下方 8px。量不到就退回 CSS 里的默认位置。 */
  /* 提示条可以拖：自动避让只能躲开"我知道的"那几个顶部条目，屏幕上还有 3D 覆盖层、
     小地图、各种浮层，总有躲不掉的时候。所以除了自动落位，再给用户一个手动出口：
     按住拖到任何地方，位置记住（本次会话内所有后续提示都用它）；单击直接关掉。
     TOAST_POS 一旦有值，自动避让就让位——用户已经明确表达过它该在哪。 */
  var TOAST_POS = null, toastWired = false;
  function toastTop(t) {
    if (TOAST_POS) { t.style.left = TOAST_POS.x + 'px'; t.style.top = TOAST_POS.y + 'px'; t.style.transform = 'none'; return; }
    try {
      var par = t.offsetParent || document.body, pr = par.getBoundingClientRect(), bot = 0;
      ['busy', 'disclaim', 'hudTop'].forEach(function (id) {
        var e = $(id); if (!e || e.hidden || !e.offsetParent) return;
        var r = e.getBoundingClientRect(); if (r.height > 0) bot = Math.max(bot, r.bottom - pr.top);
      });
      t.style.top = bot > 0 ? (bot + 8) + 'px' : '';
    } catch (e) { t.style.top = ''; }
  }
  function wireToastDrag(t) {
    if (toastWired) return; toastWired = true;
    t.title = T('按住拖动可以挪走 · 单击关闭');
    var drag = null;
    t.addEventListener('pointerdown', function (ev) {
      var par = t.offsetParent || document.body, pr = par.getBoundingClientRect(), r = t.getBoundingClientRect();
      // x0/y0 必须是 pointerdown 的视口坐标：dx/px 混了 toast 边缘与 offsetParent 两个参照系，
      // 居中定位时 (r.left - pr.left) 远超 3px，几乎每次 pointermove 都会被误判成拖动。
      drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top, px: pr.left, py: pr.top, x0: ev.clientX, y0: ev.clientY, moved: false };
      try { t.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault(); ev.stopPropagation();
    });
    t.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      if (Math.abs(ev.clientX - drag.x0) > 3 || Math.abs(ev.clientY - drag.y0) > 3) drag.moved = true;
      var x = ev.clientX - drag.dx - drag.px, y = ev.clientY - drag.dy - drag.py;
      t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.transform = 'none';
      ev.preventDefault(); ev.stopPropagation();
    });
    function end(ev) {
      if (!drag) return;
      try { t.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (drag.moved) { var r2 = t.getBoundingClientRect(), pr2 = (t.offsetParent || document.body).getBoundingClientRect();
        TOAST_POS = { x: r2.left - pr2.left, y: r2.top - pr2.top };                      // 记住用户放的位置
        clearTimeout(toast._h); toast._h = setTimeout(function () { t.hidden = true; }, 2400); }
      else { t.hidden = true; clearTimeout(toast._h); }                                    // 没拖动 = 单击 = 关掉
      drag = null; ev.preventDefault(); ev.stopPropagation();
    }
    t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
  }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false; wireToastDrag(t); toastTop(t);
    clearTimeout(toast._h); toast._h = setTimeout(function () { t.hidden = true; }, ms || 2400);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtInt(n) { return Math.floor(n).toLocaleString('en-US'); }
  /* ---------------------------------------------------------- 忙碌指示
   * 顶部 2px 进度条 + 一行状态文字。pct 省略 = 不确定进度（无限滑动条）。
   * 用户报"有时特别卡，别人会以为坏了"——凡是会卡住主线程或要等 worker 的步骤都要先亮这个。 */
  var BUSY = { on: false, txt: '', pct: null };
  function showBusy(label, pct) {
    var box = $('busy'); if (!box) return;
    BUSY.on = true; BUSY.txt = label || '';
    box.hidden = false;
    var indet = (pct == null || !isFinite(pct));
    box.classList.toggle('indet', indet);
    BUSY.pct = indet ? null : Math.max(0, Math.min(100, pct));
    if (!indet) $('busyFill').style.width = BUSY.pct.toFixed(0) + '%';
    $('busyTxt').textContent = label + (indet ? '' : '… ' + BUSY.pct.toFixed(0) + '%');
    $('busyTxt').hidden = !label;
  }
  function hideBusy() { var box = $('busy'); if (!box) return; BUSY.on = false; box.hidden = true; box.classList.remove('indet'); $('busyFill').style.width = '0%'; }
  /* 先让浏览器把进度条画出来，再开工。
     直接 showBusy() 后同步跑长任务，进度条本身也画不出来——主线程被占满，用户看到的还是"死机"。
     两帧 rAF：第一帧提交样式变更，第二帧确定已经上屏；没有 rAF（后台标签）时退回 setTimeout。 */
  function busyThen(label, fn, pct) {
    showBusy(label, pct);
    var run = function () { try { fn(); } catch (e) { console.error('[app] 忙碌任务出错', e); hideBusy(); throw e; } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(run); });
    else setTimeout(run, 32);
  }
  /* universe3d 的 IC worker 只报文字（'白噪声 → 傅里叶空间' / '位移场分量 2/3' / '放置 128³ 粒子'），
     没有百分比。按已知的阶段顺序折算成大致进度——宁可粗一点，也比一条不动的无限条让人安心。 */
  function icPct(text) {
    var t = String(text || '');
    if (/白噪声|傅里叶/.test(t)) return 15;
    var m = /位移场分量\s*(\d+)\s*\/\s*(\d+)/.exec(t);
    if (m) return 20 + 40 * (Number(m[1]) / Math.max(1, Number(m[2])));
    if (/放置/.test(t)) return 80;
    if (/重算/.test(t)) return null;
    return null;
  }
  /* 站内确认框，替代 window.confirm。
     必须自己实现：本页可能在没有 allow-modals 的 sandbox iframe 里跑，
     那里 window.confirm() 不弹窗、直接返回 false —— 所有"先确认再删"的路径于是全部静默失效
     （用户报的"删除功能没用"就是这个：勾 10 条点删除，confirm 返回 false，一条都删不掉）。
     cb 收到按钮的 value；Esc / 点遮罩 = 取消（第一个 value 为 false/null 的按钮）。 */
  function askConfirm(msg, opts, cb) {
    opts = opts || {};
    var btns = opts.buttons || [{ label: '确定', value: true, cls: 'danger' }, { label: '取消', value: false, cls: 'ghost' }];
    var box = document.createElement('div');
    box.className = 'export-box ask-box';
    box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', T(opts.title || '确认'));
    box.innerHTML = '<div class="export-panel ask-panel">' +
      '<div class="export-head"><b>' + esc(T(opts.title || '确认')) + '</b></div>' +
      '<p class="ask-msg">' + esc(msg).replace(/\n/g, '<br>') + '</p>' +
      '<div class="export-btns">' + btns.map(function (b, i) {
        return '<button type="button" class="btn ' + esc(b.cls || '') + '" data-i="' + i + '">' + esc(T(b.label)) + '</button>';
      }).join('') + '</div></div>';
    var done = false;
    function finish(v) { if (done) return; done = true; box.remove(); if (cb) cb(v); }
    function cancelValue() { for (var i = 0; i < btns.length; i++) if (btns[i].value === false || btns[i].value == null) return btns[i].value; return false; }
    Array.prototype.forEach.call(box.querySelectorAll('.btn'), function (b) {
      b.addEventListener('click', function () { finish(btns[+b.getAttribute('data-i')].value); });
    });
    box.addEventListener('click', function (ev) { if (ev.target === box) finish(cancelValue()); });
    box.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); finish(cancelValue()); }
    });
    document.body.appendChild(box);
    setTimeout(function () { var f = box.querySelector('.btn'); if (f) f.focus(); }, 0);
  }
  // 参数值显示：空间维数 D 一律两位小数（引擎的 formatValue 会给 3.7 / 6.512 之类的不定位数），其余交给适配器
  function pfmt(key, v) { return (key === 'dimS' && isFinite(v)) ? Number(v).toFixed(2) : A.formatValue(key, v); }
  function sci(x) { if (!isFinite(x)) return '—'; if (x === 0) return '0'; if (x < 1e6 && x >= 1) return fmtInt(x); var e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e); return m.toFixed(2) + '×10' + String(e).replace(/\d|-/g, function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c] || '⁻'; }); }
  var BASIS_TAG = { computed: '计算', scaling: '标度关系', heuristic: '启发式', toy: '玩具' };
  function statusTag(st) { var m = A.statusMeta(st); return '<span class="tag ' + m.cls + '" title="status: ' + esc(st || 'accepted') + '">' + esc(T(m.label)) + '</span>'; }
  function modsOn(m) { m = A.normalizeModules(m); return A.MODULES.filter(function (mod) { return m[mod.id]; }); }
  function modsLabel(m) { var on = modsOn(m); return on.length ? on.map(function (mod) { return T(mod.name.replace(/模块.*$/, '')); }).join('+') : ''; }
  // 带可信度后缀的模块名：默认开着的弦气是推测性模型，页脚/图例里要说清楚
  var STATUS_SHORT = { speculative: '推测', 'mainstream-model': '主流模型 · 未证实' };
  function modsLabelQ(m) {
    var on = modsOn(m);
    return on.length ? on.map(function (mod) {
      var s = STATUS_SHORT[mod.status];
      return T(mod.name.replace(/模块.*$/, '')) + (s ? T('（' + s + '）') : '');
    }).join('+') : '';
  }
  var DIM_NOTE = '维数默认由弦气模型（推测）生成，可在参数编辑器里关闭该模块，改为直接输入 D。';
  function refText(ref) { if (!ref) return ''; if (typeof ref === 'string') return ref; if (Array.isArray(ref)) return ref.map(refText).join('；'); return ref.title || ref.text || ref.cite || JSON.stringify(ref); }
  /* ---------------------------------------------------------- 应用版本号
   * 构建产物里 build.js 注入 window.MIRROR_APP_VERSION / MIRROR_BUILD_TIME；
   * 开发模式（直接开 index.html）没有这两个全局，就去 fetch 根目录的 VERSION，
   * 取不到（file:// 或无此文件）显示 dev。三处露出：页脚、关于面板副标题、document.title。 */
  var APP_VER = (typeof window.MIRROR_APP_VERSION === 'string' && window.MIRROR_APP_VERSION) || null;
  var BUILD_TIME = (typeof window.MIRROR_BUILD_TIME === 'string' && window.MIRROR_BUILD_TIME) || null;
  function verLabel() { return APP_VER ? 'v' + APP_VER : 'dev'; }
  function buildLabel() {
    var iso = BUILD_TIME || buildStampFromComment();
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m ? (m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]) : iso;
  }
  // 老构建（没注入全局）的兜底：从 build.js 写的 HTML 注释里捞时间
  function buildStampFromComment() {
    try {
      var w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT, null, false), n;
      while ((n = w.nextNode())) {
        var m = /单文件构建[^·]*·[^·]*·\s*([0-9T:.\-Z]{16,})/.exec(n.nodeValue || '') || /单文件构建\s*·\s*([0-9T:.\-Z]{16,})/.exec(n.nodeValue || '');
        if (m) return m[1];
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }
  function applyVersion() {
    document.title = T('镜像宇宙模拟器 ') + verLabel();
    refreshBangCount();
    if (!$('about').hidden && window.MirrorAbout && window.MirrorAbout.content) $('aboutSub').textContent = aboutSubtitle(window.MirrorAbout.content);
  }
  if (!APP_VER && typeof fetch === 'function' && /^https?:/.test(location.protocol)) {
    try {
      fetch('VERSION').then(function (r) { return r.ok ? r.text() : null; })
        .then(function (t) { if (t && t.trim()) { APP_VER = t.trim(); applyVersion(); } }, function () { /* 保持 dev */ });
    } catch (e) { /* 保持 dev */ }
  }

  var disclaimEl = $('disclaim');
  /* 诚实标注（顶部那条小字）。原来它把「这是什么 · 怎么算 · 怎么标注」整句 200 字铺在一行上，
     宽屏被截断、笔记本读不完。现在屏幕上只留第一段（layer 那句话本身就是标注），
     整句仍然原封不动挂在 title 上，并且在「ⓘ 详情」里逐行摊开——一个字都没丢。 */
  function setDisclaim(text, milk) {
    if (!text) { disclaimEl.hidden = true; return; }
    disclaimEl.hidden = false;
    var full = String(text), head = full.split(/\s*·\s*/)[0], more = head.length < full.length;
    disclaimEl.textContent = head;
    disclaimEl.title = more ? full : '';
    disclaimEl.className = 'disclaim' + (milk ? ' milk' : '') + (more ? ' has-more' : '');
  }

  /* ---------------------------------------------------------- 切语言后重刷「拼出来的」文案
   * 静态 DOM 由 i18n.js 的 applyStatic() 负责；但引爆之后 HUD / 时间轴说明 / 维度说明 / 进入按钮
   * 这些是当场用 T()/TX() 拼成字符串写进 DOM 的，字符串一旦落地就不再跟语言走。
   * 做法：谁写了这种一次性文案，谁就在这里登记一个「照原样再拼一遍」的闭包（复用原来那段表达式，
   * 不重跑物理、不重建场景、不重新绑事件）；切语言时挨个跑一遍。换视图时清空，避免对着已经拆掉的
   * DOM 写字。注册顺序即执行顺序。 */
  var RELANG = [];
  function relangAdd(fn) { if (typeof fn === 'function') RELANG.push(fn); }
  function relangClear() { RELANG.length = 0; }
  function relangRun() {
    for (var i = 0; i < RELANG.length; i++) {
      try { RELANG[i](); } catch (e) { console.warn('[app] 切语言重刷失败', e); }   // 一条挂了不能连累其它条
    }
  }

  /* ---------------------------------------------------------- 页面切换 */
  var pages = { select: $('pageSelect'), confirm: $('pageConfirm') };
  function showPage(name) { for (var k in pages) pages[k].hidden = (k !== name); }
  function setState(s) {
    S.state = s;
    relangClear();                     // 换视图：上一套 HUD 的重刷闭包连同它的 DOM 一起作废
    showPage(s === 'select' ? 'select' : s === 'confirm' ? 'confirm' : null);
    $('timer').hidden = !(s === 'detonate' || s === 'space');
    var inSpace = (s === 'space');
    $('hudTop').hidden = !inSpace; $('hudSide').hidden = !inSpace; $('hudBottom').hidden = !inSpace;
    // 操作层的两个浮层跟着走：离开太空就收掉 ⓘ 详情与左侧抽屉，免得它们挂在别的界面上
    if (!inSpace) {
      var ib = $('hudInfoBox'); if (ib) ib.hidden = true;
      S.infoOpen = false; S.drawerOpen = false;
      if ($('app') && $('app').classList) { $('app').classList.remove('drawer-on'); $('app').classList.remove('space-ui'); }
    }
    $('hud').hidden = true;
    $('enterHint').hidden = true;
    if (s === 'select' || s === 'confirm') { setDisclaim(''); tlStop(); }
    if (s !== 'mirror') { $('mirrorUI').hidden = true; if (S.mirror) { S.mirror.dispose(); S.mirror = null; } planetCanvas.hidden = true; stage.style.pointerEvents = ''; }
    if (s !== 'space' && s !== 'mirror') closeAnalysis();
    if (s !== 'select' && S.editorOpen) openEditor(false);   // 编辑器只属于起爆页；离开就收起并同步 panel-open
    if (s === 'select') { disposeScene(); S.view = null; glCanvas.hidden = true; ctx.clearRect(0, 0, W, H); refreshBangCount(); $('ddBtn').focus(); }
    if (s === 'confirm') { disposeScene(); S.view = null; glCanvas.hidden = true; setTimeout(function () { $('btnFire').focus(); }, 0); }
  }
  function disposeScene() { if (S.scene) { S.scene.dispose(); S.scene = null; } S.tsync = null; S.ttoggle = null; dispose3D(); }
  // 释放 3D 视图（GPU 资源、Worker、覆盖层、事件）；离开 space/mirror 或再次进入前都会调用，重复进入不泄漏
  function dispose3D() {
    if (S.u3d) { try { S.u3d.dispose(); } catch (e) { console.warn('[app] u3d dispose', e); } S.u3d = null; }
    S.u3dReady = false; hideBusy();
    var pt = $('perfTip'); if (pt) { pt.hidden = true; SLOW.t = 0; SLOW.shown = false; }
    if (gl3d) gl3d.hidden = true;
    stage.style.pointerEvents = '';

    S.aDownT = 0;
  }

  /* ---------------------------------------------------------- 起爆参数页：下拉目录 */
  var ddBtn = $('ddBtn'), ddList = $('ddList'), ddText = $('ddText');
  var rows = [];
  function rowText(e) {
    var lbl = modsLabel(e.modules);
    return (lbl ? '[' + lbl + '] ' : '') + A.paramsFor(e.modules).map(function (d) { return pfmt(d.key, e.params[d.key]); }).join('  ');
  }
  // 预设一句提示：预期结局 + 改动的参数（引擎 preset 的 name / blurb / expect 由适配器合成 e.hint）
  var EXPECT_CN = {
    OBSERVERS_POSSIBLE: '可能诞生观察者', UNSTABLE_ORBITS: '无稳定轨道／原子', NO_ATOMS: '没有原子',
    BIG_CRUNCH: '大挤压', BIG_RIP: '大撕裂', BLACK_HOLE_DOMINATED: '黑洞主导',
    HEAT_DEATH_NO_STRUCTURE: '热寂 · 无结构', NO_STARS: '没有恒星', NO_CHEMISTRY: '无化学', STARS_NO_LIFE: '有恒星无生命',
    BEYOND_MODEL_DIM: '超出模型适用范围（D≠3）'
  };
  function expectCN(e) {
    var m = /（预期：([A-Za-z_]+)）/.exec(e.hint || '');
    if (!m) return '';
    return T(EXPECT_CN[m[1]] || ((A.OUTCOME_META && A.OUTCOME_META[m[1]] && A.OUTCOME_META[m[1]].title) || ''));
  }
  function isDiff(d, v) { return isFinite(v) && Math.abs(v - d.default) > Math.max(1e-9, (d.step || 0.01) * 0.5); }
  function diffList(e, max) {
    var out = [];
    A.paramsFor(e.modules).forEach(function (d) { if (isDiff(d, e.params[d.key])) out.push((d.symbol || d.key) + '=' + pfmt(d.key, e.params[d.key])); });
    return out.slice(0, max || 3);
  }
  function presetHint(e) {
    var parts = [], oc = expectCN(e); if (oc) parts.push(oc);
    var df = diffList(e, 2); if (df.length) parts.push(df.join('，'));
    if (A.modulesKey(e.modules) !== A.modulesKey(A.getModules())) { var lbl = modsLabelQ(e.modules); parts.push(lbl ? T('模块：') + lbl : T('关闭全部模块（直接输入 D）')); }
    return parts.join(' · ');
  }
  // 每个数据项单独成格：悬停显示中文名与数值；与 #1207 默认值不同的标橙
  function rowCells(e) {
    return A.paramsFor(e.modules).map(function (d) {
      var v = e.params[d.key], txt = pfmt(d.key, v), diff = isDiff(d, v);
      var tip = TE(d.name) + T('（') + (d.symbol || d.key) + T('）') + '= ' + txt + (d.unit && d.unit !== 'rel' ? ' ' + d.unit : '') + (diff ? T('　｜ 我们的宇宙为 ') + pfmt(d.key, d.default) : '');
      return '<span class="dd-v' + (diff ? ' diff' : '') + '" title="' + esc(tip) + '">' + esc(txt) + '</span>';
    }).join('');
  }
  // 模块标签有自己的格子（无模块时留空），后面的数值列因此不会被挤歪
  function modCell(e) {
    var lbl = modsLabel(e.modules);
    return '<span class="dd-modc">' + (lbl ? '<span class="dd-mod" title="' + esc(T('已开启模块：')) + esc(lbl) + '">' + esc(lbl) + '</span>' : '') + '</span>';
  }
  function ddGroup(text) { var li = document.createElement('li'); li.className = 'dd-group'; li.setAttribute('aria-hidden', 'true'); li.innerHTML = '<span>' + esc(text) + '</span>'; return li; }
  function ddRow(e, i) {
    var li = document.createElement('li');
    var preset = !!e.preset && !e.ours;
    li.className = 'dd-row' + (e.ours ? ' ours last' : '') + (preset ? ' preset' : '');
    li.setAttribute('role', 'option'); li.id = 'ddopt-' + i; li.setAttribute('data-i', String(i));
    li.setAttribute('aria-selected', S.entry && String(S.entry.id) === String(e.id) ? 'true' : 'false');
    var hint = preset ? presetHint(e) : '';
    // 预设行不显示编号（编号只属于用户条目与 #1207）
    var name = preset ? '<b>' + esc(T(e.name || '预设')) + '</b>' + (hint ? ' <i class="dd-hint">' + esc(hint) + '</i>' : '')
      : (e.name ? '<b>' + esc(T(e.name)) + '</b>' : '');
    var canDel = !e.preset && !e.ours;
    li.innerHTML = '<span class="dd-id">' + (preset ? '' : esc(e.label)) + '</span><span class="dd-name">' + name + '</span>' + modCell(e) + '<span class="dd-vals">' + rowCells(e) + '</span>' +
      (canDel ? '<button type="button" class="dd-del" tabindex="-1" aria-label="' + esc(T('删除')) + ' ' + esc(e.label) + '" title="' + esc(T('删除这一条')) + esc(T('（')) + esc(e.label) + esc(T('）')) + '">✕</button>' : '');
    li.title = (preset ? (e.name || '') + (hint ? ' — ' + hint : '') : e.label + (e.name ? ' ' + e.name : '')) + (e.hint && !preset ? ' — ' + e.hint : '');
    li.addEventListener('click', function () { pickRow(i); });
    li.addEventListener('mousemove', function () { setActive(i); });
    var del = li.querySelector('.dd-del');
    if (del) {
      // ✕ 只删不选：click 与 pointer 系列一起挡住，否则会顺着冒泡把这一行选中、直接跳到引爆确认页
      ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick'].forEach(function (t) {
        del.addEventListener(t, function (ev) { ev.stopPropagation(); });
      });
      del.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        setActive(i); askDeleteRow(e);
      });
    }
    return li;
  }
  /* 下拉列表里就地删除：确认 → 删 → 原地重建列表并保持下拉打开（不要关掉重开，位置全丢了） */
  function askDeleteRow(e) {
    if (!e) return;
    askConfirm(T('删除') + ' ' + e.label + (e.name ? ' ' + e.name : '') + T('？此操作不可撤销。'), { title: '删除这一条' }, function (ok) {
      ddBtn.focus();                                  // 确认框一关，焦点回到列表（上下键还能接着用）
      if (!ok) return;
      var at = S.activeRow;
      if (!A.catalog.remove(e.id)) {
        console.warn('[app] 下拉删除失败：id =', e.id, '(' + typeof e.id + ')');
        toast(T('删除失败：未找到 ') + e.label + T('（详见控制台）'), 4200); return;
      }
      if (S.entry && String(S.entry.id) === String(e.id)) {   // 删掉的正是当前选中项：把选择清干净
        S.entry = null; ddText.textContent = T('（点击箭头，下拉出一行行数据组）'); ddText.classList.add('empty');
      }
      toast(T('已删除') + ' ' + e.label, 2600);
      if (S.listOpen) { buildList(); setActive(rows.length ? Math.max(0, Math.min(rows.length - 1, at)) : -1); }
      refreshBangCount(); if (CM.box) cmRender();
    });
  }
  function buildList() {
    rows = A.catalog.list();                     // 只有"我保存的"；内置示例在编辑器的折叠区里
    /* 站点版（MIRROR_LOCK_TO_BLOCKS）这个下拉也**只列来自 BNB 区块的宇宙** ——
       判据用管理目录弹窗那一套（cmIsBlock），别另写：两处口径分了家，
       就会出现"目录里看不见、下拉里还能选中引爆"的漏子（#0004 随机就是这么漏出去的）。
       **数据一条不删**：localStorage 是用户的，离线单文件版照常全量可见。 */
    if (window.MIRROR_LOCK_TO_BLOCKS) rows = rows.filter(cmIsBlock);
    ddList.innerHTML = '';
    // 表头：当前有效参数表的符号（开启模块后为 21 项），悬停看中文名
    var head = document.createElement('li');
    head.className = 'dd-row dd-head'; head.setAttribute('aria-hidden', 'true');
    head.innerHTML = '<span class="dd-id">' + esc(T('编号')) + '</span><span class="dd-name">' + esc(T('名称')) + '</span><span class="dd-modc">' + esc(T('模块')) + '</span><span class="dd-vals">' + A.PARAMS.map(function (d) {
      return '<span class="dd-v" title="' + esc(TE(d.name) + (d.unit ? T('（') + d.unit + T('）') : '')) + '">' + esc(d.symbol || d.key) + '</span>';
    }).join('') + '</span>';
    ddList.appendChild(head);
    var legend = document.createElement('li');
    legend.className = 'dd-legend'; legend.setAttribute('aria-hidden', 'true');
    var onNow = modsLabel(A.getModules());
    legend.innerHTML = T('每行一组创世参数（') + A.PARAMS.length + T(' 个基础参数') + (onNow ? T('，已开启模块：') + esc(modsLabelQ(A.getModules())) : '') + T('；鼠标悬停看名称）· <b>橙色</b> = 与我们的宇宙（观测值）不同 · 内置示例与"我们的宇宙"都在"参数编辑器 → 加载示例参数组"里<br>') + esc(T(DIM_NOTE));
    ddList.appendChild(legend);
    ddList.appendChild(ddGroup(T('我保存的')));
    /* 被过滤掉的条目要**说出来**（与管理目录弹窗同一句话术）：不说这一行，
       用户会以为保存的宇宙丢了。数量为 0 时（离线版恒为 0）整行不出现。 */
    var hiddenN = cmHiddenCount();
    if (hiddenN) {
      var hid = document.createElement('li'); hid.className = 'dd-empty'; hid.setAttribute('aria-hidden', 'true');
      hid.innerHTML = '<span>' + esc(T('{0} 条非区块宇宙已隐藏（离线版可见）').split('{0}').join(String(hiddenN))) + '</span>';
      ddList.appendChild(hid);
    }
    // 一条可见的都没有时才给新手引导语；有隐藏条目时上面那行已经解释过了，不再叠"还没有"
    if (!rows.length && !hiddenN) {
      var em = document.createElement('li'); em.className = 'dd-empty'; em.setAttribute('aria-hidden', 'true');
      em.innerHTML = '<span>' + esc(T('（还没有：引爆后在分析面板“把这组创世参数记下来”，或去参数编辑器加载一组示例再引爆）')) + '</span>';
      ddList.appendChild(em);
    }
    rows.forEach(function (e, i) { ddList.appendChild(ddRow(e, i)); });
    // 底部工具条：条数 + 直达管理面板（省得去页脚找）
    var foot = document.createElement('li');
    foot.className = 'dd-foot'; foot.setAttribute('aria-hidden', 'true');
    foot.innerHTML = '<span class="dd-foot-in">' + T('共 ') + rows.length + T(' 条 · ') +
      ((window.ARCBANG_SITE === 'arc') ? '' : '<button type="button" class="link" id="ddManage">' + esc(T('管理目录')) + '</button>') +
      '<span class="dd-foot-tip">' + esc(T('每行右端 ✕ 可直接删除；键盘 Delete 删除高亮行')) + '</span></span>';
    ddList.appendChild(foot);
    var mg = foot.querySelector('#ddManage');
    if (mg) mg.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openList(false); openCatalog(); });
    mg.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
  }
  function setActive(i) { S.activeRow = i; var opts = ddList.querySelectorAll('.dd-row[role="option"]'); Array.prototype.forEach.call(opts, function (li, j) { li.classList.toggle('active', j === i); }); if (i >= 0 && opts[i]) { ddBtn.setAttribute('aria-activedescendant', opts[i].id); opts[i].scrollIntoView({ block: 'nearest' }); } }
  function openList(open) {
    S.listOpen = open; ddList.hidden = !open; ddBtn.setAttribute('aria-expanded', String(open));
    if (open) { buildList(); var idx = S.entry ? rows.findIndex(function (e) { return String(e.id) === String(S.entry.id); }) : -1; setActive(idx >= 0 ? idx : 0); }
  }
  ddBtn.addEventListener('click', function () { openList(!S.listOpen); });
  ddBtn.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (!S.listOpen) openList(true); else setActive(Math.max(0, Math.min(rows.length - 1, S.activeRow + (ev.key === 'ArrowDown' ? 1 : -1)))); }
    else if (ev.key === 'End') { ev.preventDefault(); if (!S.listOpen) openList(true); setActive(rows.length - 1); }
    else if (ev.key === 'Home') { ev.preventDefault(); if (!S.listOpen) openList(true); setActive(0); }
    else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); if (S.listOpen && S.activeRow >= 0) pickRow(S.activeRow); else openList(true); }
    else if (ev.key === 'Escape') { if (S.listOpen) { ev.preventDefault(); openList(false); } }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { if (S.listOpen && S.activeRow >= 0 && rows[S.activeRow]) { ev.preventDefault(); ev.stopPropagation(); askDeleteRow(rows[S.activeRow]); } }
  });
  // 点列表外面收起下拉——但确认框/管理面板这类模态里的点击不算"外面"，
  // 否则点一下"确定"下拉就没了（删完还要接着删下一条）
  function inModalTree(t) { for (var n = t; n; n = n.parentNode) { if (n.classList && n.classList.contains('export-box')) return true; } return false; }
  document.addEventListener('click', function (ev) { if (S.listOpen && !$('dd').contains(ev.target) && !inModalTree(ev.target)) openList(false); });
  function pickRow(i) {
    var e = rows[i]; if (!e) return;
    selectEntry(e);
    openList(false);
    setState('confirm');
  }
  function selectEntry(e) {
    S.entry = e;
    if (e.modules) A.setModules(e.modules);
    var preset = !!e.preset && !e.ours;
    var hint = preset ? presetHint(e) : '';
    var head = preset ? T(e.name || '预设') + (hint ? T('（') + hint + T('）') : '') : e.label + (e.name ? '  ' + e.name : '');
    ddText.textContent = head + '  ' + rowText(e);
    ddText.classList.remove('empty');
  }
  function refreshBangCount() {
    syncSaved();
    var n = A.bangs.get();
    $('bangCount').textContent = T('你已启动 ') + n + T(' 次大爆炸') + (n >= 1207 ? T('（第一千二百零七号之后了）') : '');
    var onNow = modsLabel(A.getModules());
    var bt = buildLabel();
    $('engineInfo').textContent = verLabel() + ' · ' + (A.isReal ? 'engine ' + (A.engineVersion || '') : 'engine: stub') +
      (bt ? T(' · 构建 ') + bt : '') + ' · ' + (A.unitNoteText ? A.unitNoteText() : A.unitNote) + T('（PDG 2022 / Planck 2018）') +
      (onNow ? T(' · 已开启模块：') + modsLabelQ(A.getModules()) : '') + ' · ' + (glR.ok ? 'webgl2' : 'canvas2d');
  }
  /* ---------------------------------------------------------- WebGPU 开关（页脚）
   * 勾上＝优先 WebGPU，取消＝强制 WebGL2；URL 的 ?mode= 仍然最高优先。
   * 检测不可用时灰显，并把 universe3d 给出的 gpuLabel / gpuAdvice 原样显示——
   * 只说"不可用"没有用，得告诉用户该更新驱动还是该改 Windows 图形设置。 */
  var LS_WEBGPU = 'mirror.ui.webgpu.v1';
  function gpuSup() { if (S.gpuSup === undefined) { try { S.gpuSup = U3D ? U3D.isSupported() : null; } catch (e) { S.gpuSup = null; } } return S.gpuSup; }
  function wantWebGPU() {
    var sup = gpuSup(); if (!sup || !sup.webgpu) return false;          // 用不了就是用不了，记忆值不算数
    var v = null; try { v = window.localStorage.getItem(LS_WEBGPU); } catch (e) {}
    return v == null ? true : v === '1';                                 // 没记忆过：可用就默认开
  }
  /* 勾上＝优先 WebGPU：这里必须传 null 而不是 'webgpu'。
     universe3d 里 force:'webgpu' 是"只准用 WebGPU"，初始化失败会直接抛错、不再回退 WebGL2
     （见 create() 里的 `if (wantMode === 'webgpu') throw err`）——那会把"慢一点"变成"进不去"。
     null = 模块默认：能用 WebGPU 就用，用不了自动回退。取消勾选才是硬指定 'webgl2'。 */
  function forceBackend() { return FORCE_3D_BACKEND || (wantWebGPU() ? null : 'webgl2'); }
  (function wireGpuChk() {
    var chk = $('gpuChk'), note = $('gpuNote'); if (!chk) return;
    var sup = gpuSup();
    if (!U3D) { chk.disabled = true; chk.checked = false; note.hidden = false; note.textContent = T('3D 模块未加载'); return; }
    if (!sup || !sup.webgpu) {
      chk.disabled = true; chk.checked = false;
      note.hidden = false;
      note.textContent = (sup && sup.gpuLabel ? T(sup.gpuLabel) : T('WebGPU 不可用')) + (sup && sup.gpuAdvice ? T('。') + T(sup.gpuAdvice) : '');
      chk.parentNode.title = note.textContent;
      return;
    }
    chk.checked = wantWebGPU();
    if (FORCE_3D_BACKEND) { chk.disabled = true; note.hidden = false; note.textContent = T('地址栏里指定了 ?mode=') + FORCE_3D_BACKEND + T('，以它为准'); }
    chk.addEventListener('change', function () {
      try { window.localStorage.setItem(LS_WEBGPU, this.checked ? '1' : '0'); } catch (e) {}
      toast(this.checked ? T('下次引爆将优先使用 WebGPU') : T('下次引爆强制使用 WebGL2'), 3000);
    });
  })();
  /* 首页三个主行动：新用户三秒内知道点哪。功能与页脚旧链接完全一致，只是抬到了显眼位置。 */
  (function wireActs() {
    var r = $('actRandom'), s = $('actSearch'), e = $('actEdit');
    if (r) r.addEventListener('click', function () { selectEntry(randomEntry()); setState('confirm'); });
    if (s) s.addEventListener('click', function () { openSearch(); });
    if (e) e.addEventListener('click', function () { openEditor(true); });
  })();
  /* 「我保存的宇宙（N）」：空的时候整块收成一行，不占大片空间也不长篇说教 */
  function syncSaved() {
    var box = $('savedBox'), t = $('savedTitle'); if (!box || !t) return;
    var n = A.catalog.list().length;
    box.classList.toggle('empty', n === 0);
    t.textContent = n ? T('我保存的宇宙（') + n + T('）') : T('还没有保存的宇宙（引爆后在分析面板点「把这组创世参数记下来」）');
  }
  /* 首页说明块：折叠状态记住（默认展开，收起过一次就一直收着） */
  (function wireHelp() {
    var box = $('helpBox'); if (!box) return;
    var KEY = 'mirror.ui.help.v1', v = null;
    try { v = window.localStorage.getItem(KEY); } catch (e) {}
    box.open = (v == null) ? true : v === '1';
    box.addEventListener('toggle', function () { try { window.localStorage.setItem(KEY, box.open ? '1' : '0'); } catch (e) {} });
    var a = $('helpAbout');
    if (a) a.addEventListener('click', function (ev) { ev.preventDefault(); openAbout(); });
  })();
  // 粒子档位
  var tierSel = $('tierSel'); tierSel.value = MP ? MP.tier() : 'low';
  tierSel.addEventListener('change', function () { if (MP) MP.setTier(tierSel.value); toast(T('粒子档位：') + (MP ? T(MP.TIER_NAMES[tierSel.value]) + T('（') + MP.tierN(tierSel.value, A.isReal) + T(' 粒子）') : tierSel.value)); });
  // 随机宇宙：沿用当前模块状态。起爆页走"选中 → 乳白确认页"，分析界面的"随机引爆"直接进引爆流程
  function randomEntry() {
    var ms = A.getModules();
    return { id: 'random', label: '#' + String(A.catalog.nextId()).padStart(4, '0'), name: '随机', params: A.randomParams(ms), modules: ms, preset: false, ours: false, temp: true };
  }
  /* 宇宙来源钩子。站点版（web/arc-ui.js）把它换成"从 BNB 链上取真区块"，
     于是**分析面板底部的"随机引爆"和右键菜单里的同名项也只能来自 BNB 区块**——
     以前 lockToBlocks() 只收了起爆页的入口，这两条路是漏的，
     等于站点上仍有办法引爆一个不属于任何区块的宇宙。
     离线版 dist/mirror.html 不装这个钩子，行为不变。 */
  function blockSource() {
    var bs = window.MirrorBlockSource;
    return (bs && typeof bs.one === 'function') ? bs : null;
  }
  function randomDetonate() {
    var bs = blockSource();
    if (!bs) { closeAnalysis(); selectEntry(randomEntry()); detonate(); return; }
    closeAnalysis();
    toast(T('正在从 BNB 链上取一个区块…'));
    bs.one(function (entry, err) {
      if (!entry) { toast(T('取区块失败：') + ((err && err.message) || T('链上节点没响应'))); return; }
      selectEntry(entry); detonate();
    });
  }

  /* ---------------------------------------------------------- 连续随机引爆：搜索可观测的三维宇宙
   * 只判定不出动画：A.randomParams(modules) + A.simulate(p, {register:true})。
   * 每批 ≤50 次后让出主线程（优先 requestIdleCallback，退回 setTimeout），UI 不卡、随时可停。
   * 命中条件：outcome 为 OBSERVERS_POSSIBLE 且 |D−3|<1e-6。 */
  var SEARCH_BATCH = 50;
  var SR = { on: false, k: 0, t0: 0, limit: 5000, stats: null, order: null, timer: null, box: null, hitTimer: null, spread: 'narrow', target: 'structure', needD3: false, hit: null, hitEntry: null, hitSaved: null, queue: null, fetching: false, fetchErr: null, fetchFails: 0 };
  /* 抽样先验三档（引擎 Engine.SPREADS）。默认"窄"：全范围与"宽"下连"能诞生观察者"的实测命中都是 0。 */
  var SPREAD_OPTS = [
    { id: 'full', name: '全范围', short: '均匀抽样（最难命中）', note: '各有效参数在允许范围内均匀抽样（现状）' },
    { id: 'wide', name: '宽（±10 倍）', short: '对数参数 ±1 dex', note: '对数参数 ±1 dex 对数均匀、线性参数 ±30%×(max−min)；Ω_k ±0.1、θ_QCD≤0.3、δ_CKM ±0.5、N_gen∈{2,3,4}' },
    { id: 'narrow', name: '窄（±10%）', short: '以我们的宇宙为中心', note: '全部参数相对 ±10%（对数参数 ×10^{±0.041}）；Ω_k ±0.01、θ_QCD≤0.05、δ_CKM ±0.1、N_gen=3' }
  ];
  var SPREAD_PRIOR_NOTE = '以我们的宇宙为中心的探索先验，不代表参数的真实分布；维数仍由弦气模块独立生成（P(D=3)≈1/30）。';

  /* 搜索目标。"可观测"≠"能诞生观察者"：
     可观测 = 从模拟器外面看进去有东西可看；能诞生观察者 = 宇宙内部长得出生命。
     默认目标是前者——黑洞主导、没有原子、没有恒星、无化学都有画面可看，只是没有生命。 */
  /* 有没有恒星，只此一处定义。matter（3D 要不要生成星系）、搜索目标"有恒星"、能不能进镜像，
     三处以前各判各的：NO_CHEMISTRY 被算成"有恒星"却又不让进镜像，自相矛盾。 */
  var STAR_OUTCOMES = { OBSERVERS_POSSIBLE: 1, STARS_NO_LIFE: 1, NO_CHEMISTRY: 1, NO_CARBON_CHEMISTRY: 1 };
  function hasStars(sim) { return !!(sim && sim.outcome && STAR_OUTCOMES[sim.outcome.type]); }
  // 有恒星但长不出生命的结局：进得去，但要说清楚地表是无机世界
  var NO_LIFE_OUTCOMES = { STARS_NO_LIFE: 1, NO_CHEMISTRY: 1, NO_CARBON_CHEMISTRY: 1 };
  var NOTHING_TO_SEE = { SPACE_ANNIHILATED: 1, NEAR_EMPTY: 1 };
  function tgtStructure(sim) {
    // 引力结构形成了就算命中：σ₈（线性）≥0.1 或有晕/星系坍缩；排除维数塌掉、空间湮灭、没走到 a=1 就坍缩回去的
    if (!(dimOf(sim) >= 1)) return false;
    if (NOTHING_TO_SEE[sim.outcome.type]) return false;
    var raw = sim.raw || {}, cs = (raw.calc && raw.calc.structure) || {};
    var cos = raw.cosmology || {}, fate = raw.fate || cos.fate, ev = cos.events || {};
    if (fate && fate.type === 'crunch' && ev.tOneGyr == null) return false;   // 一开始就坍缩，没长出结构
    var s8 = cs.sigma8;
    return (s8 != null && isFinite(s8) && s8 >= 0.1) || !!(cs.gal || cs.first);
  }
  var TARGET_OPTS = [
    { id: 'structure', name: '有结构可看', short: '有引力结构（黑洞/无原子宇宙也算）', desc: '形成了引力结构就算命中（σ₈≥0.1 或有晕坍缩）——黑洞主导 / 没有原子 / 没有恒星 / 无化学都算，它们都有画面可看，只是没有生命', test: tgtStructure },
    { id: 'stars', name: '有恒星', short: '能看到发光天体与行星系', desc: '能看到发光天体与行星系', test: function (sim) { return !!STAR_OUTCOMES[sim.outcome.type]; } },
    { id: 'dim3', name: '三维宇宙', short: 'D=3（弦气模块决定）', desc: '|D−3|<1e-6', test: function (sim) { return Math.abs(dimOf(sim) - 3) < 1e-6; } },
    { id: 'observers', name: '能诞生观察者', short: '能长出生命（极稀有）', desc: '极稀有：建议配合"窄"抽样，否则可能跑很久也不出一个', test: function (sim) { return sim.outcome.type === 'OBSERVERS_POSSIBLE'; } }
  ];
  function spreadName(id) { for (var i = 0; i < SPREAD_OPTS.length; i++) if (SPREAD_OPTS[i].id === id) return SPREAD_OPTS[i].name; return id; }
  function targetInfo(id) { for (var i = 0; i < TARGET_OPTS.length; i++) if (TARGET_OPTS[i].id === id) return TARGET_OPTS[i]; return TARGET_OPTS[0]; }
  function srMatch(sim) {
    if (!targetInfo(SR.target).test(sim)) return false;
    // 目标已经是"三维宇宙"时不再叠加 D=3：同一条件判两遍没有意义（判据也不该重复计算）
    return (SR.needD3 && !d3Redundant()) ? Math.abs(dimOf(sim) - 3) < 1e-6 : true;
  }
  /* "且 D=3"对哪些目标是冗余的：
     - dim3：判据本身就是 D=3，同一条件判两遍没意义。
     - stars / observers：engine.js 的结局分支里 beyondModel = (D≠3) 会在所有后续判断之前
       短路成 BEYOND_MODEL_DIM，所以 OBSERVERS_POSSIBLE / STARS_NO_LIFE / NO_CHEMISTRY /
       NO_CARBON_CHEMISTRY 这四个"有恒星"类结局在 D≠3 时根本不可能出现——勾不勾结果一样。
       实测 3 万个随机宇宙：有恒星的结局 19 个，其中 D≠3 的 0 个。
     - structure：唯一保留的一个。引力结构不需要 D=3，D≠3 的宇宙照样有东西可看，
       这时叠加 D=3 是真的会改变命中集合。 */
  var D3_IMPLIED = { dim3: '判据本身就是 D=3', stars: 'D≠3 会先落到"超出模型"，出不了有恒星的结局', observers: 'D≠3 会先落到"超出模型"，出不了观察者' };
  function d3Redundant() { return !!D3_IMPLIED[SR.target]; }
  /* 目标切到上述几个时把复选框禁用（并显示为未勾选），切回"有结构可看"时恢复用户原来的选择。
     SR.d3Pref 记住用户自己的意愿，禁用期间不被覆盖。 */
  function syncD3() {
    if (!SR.box) return;
    var chk = SR.box.querySelector('#srD3'), row = SR.box.querySelector('#srD3Row');
    if (!chk || !row) return;
    var off = d3Redundant();
    if (SR.d3Pref == null) SR.d3Pref = !!SR.needD3;
    chk.disabled = off;
    chk.checked = off ? false : !!SR.d3Pref;
    SR.needD3 = chk.checked;
    row.classList.toggle('off', off);
    // 禁用时把"为什么用不上"直接写在标签里，别让人对着一个灰掉的勾选框猜
    var why = D3_IMPLIED[SR.target];
    row.title = off ? T('这个目标已经隐含 D=3：') + T(why) + T('，无需叠加') : T('在所选目标之外再要求 D=3');
    var lbl = row.querySelector('.sr-d3-why');
    if (lbl) lbl.textContent = off ? T('（该目标已隐含 D=3：') + T(why) + T('）') : '';
  }

  /* 不做命中率标定：面板打开时不跑任何采样，只有"开始搜索"才真的算宇宙。
     以前会在后台预跑三档 ×800 次采样来给出"实测约 x%"，那是没人要求的算力开销，
     而且把"打开面板"和"开始搜索"两件事混在了一起。定性说明写在选项的短说明里。 */
  // 分批调度一律用 setTimeout：requestIdleCallback 在后台/不合成的标签页里可能一次都不触发，
  // 搜索会永远停在"第 0 次"；setTimeout 在后台只是被钳到 ~1 s，仍然会把批次跑完。
  function srIdle(fn) { return setTimeout(fn, 0); }
  function srCancel(h) { if (h != null) clearTimeout(h); }
  function srSecs() { return ((((window.performance && performance.now()) || Date.now()) - SR.t0) / 1000).toFixed(1); }
  function openSearch() {
    stopSearch();                   // 防抖：重复点开不会叠出第二条批处理链
    closeAnalysis();
    if (SR.box) SR.box.remove();
    var box = document.createElement('div'); box.id = 'searchBox'; box.className = 'export-box';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', T('连续随机引爆'));
    box.innerHTML = '<div class="export-panel sr-panel">' +
      '<div class="export-head"><b>' + esc(T('连续随机引爆，直到命中目标')) + '</b>' +
      '<span class="export-note">' + esc(T('只判定不播放动画：每次抽一组随机参数交给引擎算完，命中后才进引爆流程。“可观测”＝从外面看进去有东西可看；“能诞生观察者”＝宇宙内部长得出生命——两者不是一回事。')) + '</span></div>' +
      '<div class="sr-body" id="srBody">' +
      '<div class="sr-sec">' + esc(T('目标')) + '<button type="button" class="sr-q" id="srQTarget" aria-label="' + esc(T('显示/隐藏目标说明')) + '">?</button></div>' +
      '<div class="sr-spread" id="srTarget">' + TARGET_OPTS.map(function (t) {
        return '<label class="sr-sp" title="' + esc(T(t.desc)) + '"><input type="radio" name="srTarget" value="' + t.id + '"' + (t.id === SR.target ? ' checked' : '') + '>' +
          '<b>' + esc(T(t.name)) + '</b><span class="sr-sp-short">' + esc(T(t.short || '')) + '</span>' +
          '<span class="sr-sp-note">' + esc(T(t.desc)) + '</span>' +
          '</label>';
      }).join('') + '</div>' +
      '<label class="sr-d3" id="srD3Row"><input type="checkbox" id="srD3"' + (SR.needD3 ? ' checked' : '') + '>' + esc(T(' 且 D=3（叠加条件）')) + '<span class="sr-d3-why"></span></label>' +
      '<div class="sr-sec">' + esc(T('抽样宽度')) + '<button type="button" class="sr-q" id="srQSpread" aria-label="' + esc(T('显示/隐藏抽样说明')) + '">?</button></div>' +
      '<div class="sr-spread" id="srSpread">' + SPREAD_OPTS.map(function (o) {
        return '<label class="sr-sp" title="' + esc(T(o.note)) + '"><input type="radio" name="srSpread" value="' + o.id + '"' + (o.id === SR.spread ? ' checked' : '') + '>' +
          '<b>' + esc(T(o.name)) + '</b><span class="sr-sp-short">' + esc(T(o.short || '')) + '</span>' +
          '<span class="sr-sp-note">' + esc(T(o.note)) + '</span>' +
          '</label>';
      }).join('') + '</div>' +
      '<details class="sr-prior"><summary>' + esc(T('抽样先验说明')) + '</summary><p>' + esc(T(SPREAD_PRIOR_NOTE)) + '</p></details>' +
      '<div class="sr-row"><label>' + esc(T('上限 ')) + '<input type="number" id="srLimit" min="1" max="200000" step="100" value="' + SR.limit + '">' + esc(T(' 次')) + '</label>' +
      '<span class="sr-prog" id="srProg">' + esc(T('准备中…')) + '</span></div>' +
      '<div class="sr-stats" id="srStats"></div>' +
      '</div>' +
      '<div class="export-btns"><button type="button" class="btn primary" id="srGo" hidden>' + esc(T('开始搜索')) + '</button>' +
      '<button type="button" class="btn primary" id="srKeep" hidden>' + esc(T('记下来')) + '</button>' +
      '<button type="button" class="btn primary" id="srFire" hidden>' + esc(T('引爆这个宇宙')) + '</button>' +
      '<button type="button" class="btn" id="srNext" hidden>' + esc(T('继续找下一个')) + '</button>' +
      '<button type="button" class="btn" id="srResume" hidden>' + esc(T('继续')) + '</button>' +
      '<button type="button" class="btn" id="srRestart" hidden>' + esc(T('重新开始')) + '</button>' +
      '<button type="button" class="btn" id="srStop">' + esc(T('停止')) + '</button>' +
      '<button type="button" class="btn ghost" id="srClose">' + esc(T('关闭')) + '</button></div></div>';
    document.body.appendChild(box);
    SR.box = box;
    box.querySelector('#srClose').addEventListener('click', function () { stopSearch(); box.remove(); SR.box = null; });
    box.querySelector('#srStop').addEventListener('click', function () { stopSearch(); srRender('已停止'); srButtons(false); });
    function wireQ(btnId, listId) {
      var b = box.querySelector('#' + btnId), l = box.querySelector('#' + listId);
      if (b && l) b.addEventListener('click', function () { l.className = 'sr-spread' + (l.className.indexOf('notes') < 0 ? ' notes' : ''); });
    }
    wireQ('srQTarget', 'srTarget'); wireQ('srQSpread', 'srSpread');
    box.querySelector('#srGo').addEventListener('click', function () { srStart(true); });
    box.querySelector('#srKeep').addEventListener('click', srKeepHit);
    box.querySelector('#srFire').addEventListener('click', srFireHit);
    box.querySelector('#srNext').addEventListener('click', function () { srClearHit(); srStart(false); });   // 保留计数，继续找下一个
    box.querySelector('#srResume').addEventListener('click', function () { srStart(false); });     // 保留计数与统计
    box.querySelector('#srRestart').addEventListener('click', function () { srStart(true); });     // 清零重来
    box.querySelector('#srLimit').addEventListener('change', function () { var v = parseInt(this.value, 10); if (v > 0) { SR.limit = v; srSettingsChanged(); } });
    Array.prototype.forEach.call(box.querySelectorAll('input[name="srTarget"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) { SR.target = r.value; syncD3(); srSettingsChanged(); } });
    });
    box.querySelector('#srD3').addEventListener('change', function () { SR.needD3 = this.checked; SR.d3Pref = this.checked; srSettingsChanged(); });
    Array.prototype.forEach.call(box.querySelectorAll('input[name="srSpread"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) { SR.spread = r.value; srSettingsChanged(); } });
    });
    box.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); stopSearch(); box.remove(); SR.box = null; } });
    SR.on = false; SR.k = 0; SR.stats = {}; SR.order = []; SR.hit = null; SR.hitEntry = null;
    SR.t0 = (window.performance && performance.now()) || Date.now();   // 计时从打开这一刻算
    syncD3();
    srButtons('idle');
    srRender('设置好目标与抽样宽度，点"开始搜索"');
  }
  // 改设置时若正在跑就先停：旧的计数与统计对新设置没有意义
  function srSettingsChanged() {
    var wasRunning = SR.on;
    stopSearch();
    SR.k = 0; SR.stats = {}; SR.order = [];
    srClearHit();
    if (SR.box) { var t = SR.box.querySelector('.sr-tip'); if (t) t.remove(); }
    srButtons('idle');
    srRender(wasRunning ? '设置已改变，已停止；点"开始搜索"重新搜索' : '设置好目标与抽样宽度，点"开始搜索"');
  }
  // 三态：running（跑着）/ hit（命中，等用户决定）/ stopped（停了）
  function srButtons(mode) {
    if (!SR.box) return;
    if (mode === true) mode = 'running'; else if (mode === false) mode = 'stopped';
    function set(id, on) { var b = SR.box.querySelector('#' + id); if (b) b.hidden = !on; }
    set('srGo', mode === 'idle');
    set('srStop', mode === 'running');
    set('srKeep', mode === 'hit' && !SR.hitSaved);
    set('srFire', mode === 'hit');
    set('srNext', mode === 'hit');
    set('srResume', mode === 'stopped' && SR.k < SR.limit);
    set('srRestart', mode === 'stopped' || mode === 'hit');
  }
  function srClearHit_keepData() { if (SR.box) { var h = SR.box.querySelector('.sr-hit'); if (h) h.remove(); } }
  function srClearHit() { SR.hit = null; SR.hitEntry = null; SR.hitSaved = null; srClearHit_keepData(); }
  // 把命中的这组参数存进目录（自动保存关着时由用户手动点）
  function srKeepHit() {
    if (!SR.hit || SR.hitSaved) return;
    var saved = catalogSave({ name: '搜索命中 #' + SR.k, params: SR.hit.params, modules: SR.hit.modules, outcome: SR.hit.outcome.type }, 'search');
    if (!saved) return;                       // 到上限了，catalogSave 已经 toast 过
    SR.hitSaved = saved; SR.hitEntry = saved;
    toast(T('已存入目录：') + saved.label + ' ' + (saved.name || ''), 3600);
    if (SR.box) {
      var h = SR.box.querySelector('.sr-hit');
      if (h) { var b = document.createElement('b'); b.className = 'sr-saved'; b.textContent = T('　已存入 ') + saved.label; h.appendChild(b); }
    }
    srButtons('hit');
  }
  // 只有点"引爆这个宇宙"才离开面板
  function srFireHit() {
    var hit = SR.hit, entry = SR.hitEntry;
    if (!hit || !entry) return;
    stopSearch();
    if (SR.box) { SR.box.remove(); SR.box = null; }
    selectEntry(entry); detonate();
    toast(T('第 ') + SR.k + T(' 次命中（') + T(targetInfo(SR.target).name) + (SR.needD3 ? T(' 且 D=3') : '') + T('）：') + hitSummary(hit) + T('（已记为 ') + (entry.label || '') + ' ' + T(entry.name) + T('）'), 6000);
  }
  function srStart(reset) {
    stopSearch();
    if (reset) { SR.k = 0; SR.stats = {}; SR.order = []; }
    SR.fetchErr = null; SR.fetchFails = 0;
    srClearHit();
    SR.on = true;
    SR.t0 = (window.performance && performance.now()) || Date.now();
    if (SR.box) { var t = SR.box.querySelector('.sr-tip'); if (t) t.remove(); }
    srButtons(true);
    srRender('搜索中…');
    SR.timer = srIdle(searchBatch);
  }
  function stopSearch() { SR.on = false; srCancel(SR.timer); SR.timer = null; if (SR.hitTimer) { clearTimeout(SR.hitTimer); SR.hitTimer = null; } }
  function srRender(note) {
    if (!SR.box) return;
    var p = SR.box.querySelector('#srProg'); if (p) p.textContent = T('第 ') + SR.k + T(' 次 · 已用 ') + srSecs() + T(' 秒') + (note ? ' · ' + T(note) : '');
    var s = SR.box.querySelector('#srStats'); if (!s) return;
    var max = 1; SR.order.forEach(function (k) { if (SR.stats[k] > max) max = SR.stats[k]; });
    var ord = SR.order.slice().sort(function (a, b) { return SR.stats[b] - SR.stats[a]; });   // 多的排前面
    var top = ord.slice(0, 5), restN = 0, restK = 0;
    ord.slice(5).forEach(function (k) { restN += SR.stats[k]; restK++; });
    s.innerHTML = top.map(function (k) {
      var n = SR.stats[k], pct = (n / Math.max(1, SR.k) * 100).toFixed(1);
      return '<div class="sr-bar"><span class="sr-name" title="' + esc(k) + '">' + esc(k) + '</span><i style="width:' + (n / max * 100).toFixed(1) + '%"></i>' +
        '<span class="sr-n">' + n + '（' + pct + '%）</span></div>';
    }).join('') + (restK ? '<div class="sr-rest">' + esc(T('其余 ')) + restK + esc(T(' 项，共 ')) + restN + esc(T(' 次（')) + (restN / Math.max(1, SR.k) * 100).toFixed(1) + '%）</div>' : '');
  }
  // 命中信息：D 与几个关键参数（从引擎结果里取，不另算）
  // 数值带一句判读：Y_p=1.000 是"全氦无氢"，σ₈=0.0000582 读不出量级，改科学计数
  function ypNote(y) {
    if (y >= 0.99) return '（全氦，无氢）';
    if (y >= 0.9) return '（几乎全氦）';
    if (y >= 0.35) return '（氦偏多）';
    if (y <= 0.01) return '（几乎无氦）';
    if (y <= 0.15) return '（氦偏少）';
    return '';
  }
  function num3(x) { return (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0)) ? sci(Math.abs(x)) : String(Number(Number(x).toPrecision(3))); }
  function hitSummary(sim) {
    var c = (sim.raw && sim.raw.constants) || {}, calc = (sim.raw && sim.raw.calc) || {};
    var bits = ['D=' + fmtD(dimOf(sim))];
    if (c.alpha != null) bits.push('α=1/' + (1 / c.alpha).toFixed(1));
    if (c.omegaLambda != null) bits.push('Ω_Λ=' + num3(c.omegaLambda));
    if (calc.bbn && calc.bbn.Yp != null) { var y = Number(calc.bbn.Yp); bits.push('Y_p=' + y.toFixed(3) + T(ypNote(y))); }
    if (calc.structure && calc.structure.sigma8 != null) bits.push('σ₈=' + num3(Number(calc.structure.sigma8)));
    return bits.join(' · ');
  }
  function searchBatch() {
    if (!SR.on) return;
    try { searchBatchInner(); }
    catch (err) {
      console.error('[app] 搜索批次出错', err);
      stopSearch(); srButtons('stopped');
      srRender(T('出错已停止：') + (err && err.message));   // 面板留着，不静默消失
    }
  }
  function searchBatchInner() {
    var ms = A.getModules(), hit = null, n = 0;
    var tb = (window.performance && performance.now()) || Date.now();
    /* 站点版：候选宇宙必须来自 BNB 区块，不能本地随机造。
       一次预取一批哈希放进队列，队列见底就再取；取块是网络操作，
       所以这里的节奏由 RPC 决定，不再是"每秒几万次本地抽样"。 */
    var bs = blockSource();
    if (bs) {
      if (!SR.queue) SR.queue = [];
      if (SR.queue.length < 12 && !SR.fetching) {
        SR.fetching = true;
        bs.many(48, function (list, err) {
          SR.fetching = false;
          if (list && list.length) { SR.queue = SR.queue.concat(list); SR.fetchErr = null; SR.fetchFails = 0; }
          else {
            /* 一次取不到不算事（可能只是抖动），连着三次取不到就必须说出来 ——
               否则限流 429 或者节点挂了，用户看到的都是同一句"搜索中…"。 */
            SR.fetchFails = (SR.fetchFails || 0) + 1;
            if (SR.fetchFails >= 3) SR.fetchErr = (err && err.message) || T('连续三批都没取到区块（多半是引爆额度用完了）');
          }
        });
      }
      if (!SR.queue.length) {
        /* **必须自己排下一拍。** 这里原来直接 return，注释写着"等下一拍"，
           但没有任何人排它 —— 而搜索刚启动时队列必然是空的（预取是异步的），
           于是循环在第一拍就断了，面板永远停在"第 0 次 · 搜索中…"。
           退避 150 ms：取块是网络操作，setTimeout(0) 只是空转烧 CPU。 */
        if (SR.fetchErr) {                                      // 取块一直失败就别装作还在搜
          stopSearch(); srButtons('stopped');
          srRender(T('取区块失败：') + SR.fetchErr);
          return;
        }
        srRender('正在从链上取区块…');
        SR.timer = setTimeout(searchBatch, 150);
        return;
      }
    }
    for (; n < SEARCH_BATCH && SR.k < SR.limit; n++) {
      if (n && (((window.performance && performance.now()) || Date.now()) - tb) > 120) break;   // 时间盒：让出主线程去刷新进度
      if (bs && !SR.queue.length) break;                        // 队列空了，让出去等预取

      SR.k++;
      var sim;
      try {
        var cand = bs ? SR.queue.shift() : null;
        sim = cand
          ? A.simulate(cand.params, { register: true, modules: cand.modules || ms })
          : A.simulate(A.randomParams(ms, { spread: SR.spread }), { register: true, modules: ms });
      }
      catch (e) { continue; }                                   // 个别参数组算不动就跳过，不打断搜索
      var key = sim.outcome.title || sim.outcome.type;
      if (SR.stats[key] == null) { SR.stats[key] = 0; SR.order.push(key); }
      SR.stats[key]++;
      if (srMatch(sim)) { hit = sim; break; }
    }
    if (hit) {
      // 命中后停在面板里，由用户决定引爆还是继续找。
      // 以前是 900 ms 自动关面板+引爆：默认目标"有结构可看"几乎第一次就命中，
      // 用户看到的就是"刚打开面板就自己消失了"。
      stopSearch();
      // 默认不入库：目录被搜索结果淹掉就是这么来的。自动保存打开时才写，否则等用户点"记下来"
      SR.hitSaved = null;
      SR.hitEntry = { id: 'srhit', label: '#----', name: '搜索命中 #' + SR.k, params: hit.params, modules: hit.modules, temp: true };
      if (autoSaveOn()) {
        try {
          var saved = catalogSave({ name: '搜索命中 #' + SR.k, params: hit.params, modules: hit.modules, outcome: hit.outcome.type }, 'search');
          if (saved) { SR.hitEntry = saved; SR.hitSaved = saved; }
        } catch (e2) { console.warn('[app] 命中条目保存失败，仍可直接引爆', e2); }
      }
      SR.hit = hit;
      refreshBangCount();
      srRender(T('第 ') + SR.k + T(' 次命中'));
      if (SR.box) {
        srClearHit_keepData();
        var hp = document.createElement('p'); hp.className = 'sr-hit';
        hp.textContent = T('第 ') + SR.k + T(' 次命中（目标：') + T(targetInfo(SR.target).name) + (SR.needD3 ? T(' 且 D=3') : '') + T('）· ') +
          hitSummary(hit) + T(' · 结局：') + T(hit.outcome.title || hit.outcome.type) +
          T('　→ 点"引爆这个宇宙"进入，或"继续找下一个"。');
        SR.box.querySelector('#srBody').appendChild(hp);
      }
      srButtons('hit');
      return;
    }
    refreshBangCount();
    if (SR.k >= SR.limit) {
      stopSearch();
      srRender(T('到达上限 ') + SR.limit + T(' 次，未命中'));
      srButtons('stopped');
      if (SR.box) {
        var tip = document.createElement('p'); tip.className = 'sr-tip';
        tip.textContent = T('目标"') + T(targetInfo(SR.target).name) + (SR.needD3 ? T(' 且 D=3') : '') + T('"在当前抽样宽度（') + T(spreadName(SR.spread)) + T('）下，') + SR.k + T(' 次里一次也没有出现（即 < 1/') + SR.k + T('）。可以换更窄的抽样宽度、换一个目标，或开/关推测性模块。');
        SR.box.querySelector('#srBody').appendChild(tip);
      }
      return;
    }
    srRender('搜索中…');
    SR.timer = srIdle(searchBatch);
  }
  $('btnRandom').addEventListener('click', function () { selectEntry(randomEntry()); setState('confirm'); });
  $('btnEditor').addEventListener('click', function () { openEditor(true); });
  $('btnSearch').addEventListener('click', openSearch);
  /* ARCBANG：宇宙只从区块哈希来，没有「自定义宇宙」可存，也就没有目录可管
     （2026-09-17 用户：「管理目录删除……因为这是用区块引爆，所以不支持自定义」）。三处入口一起收。 */
  var NO_CATALOG = (window.ARCBANG_SITE === 'arc');
  $('btnCatalog').addEventListener('click', openCatalog);
  if (NO_CATALOG) $('btnCatalog').hidden = true;

  /* ---------------------------------------------------------- 目录写入：来源标记 · 自动保存开关 · 条数上限
   * 来源存在条目的 note 字段（引擎 Catalog 原样保存），目录管理里据此批量筛选与删除。
   * 自动保存默认关：搜索命中不再自动入库——那正是目录被搜索结果淹掉的原因。 */
  var SRC = { manual: '手动保存', search: '搜索命中', example: '示例加载' };
  var CAT_MAX = 500, LS_AUTOSAVE = 'mirror.ui.autosave.v1';
  function autoSaveOn() { try { return window.localStorage.getItem(LS_AUTOSAVE) === '1'; } catch (e) { return false; } }
  function setAutoSave(on) { try { window.localStorage.setItem(LS_AUTOSAVE, on ? '1' : '0'); } catch (e) { /* 隐私模式 */ } }
  function srcOf(entry) { var v = entry && entry.note; return SRC[v] ? SRC[v] : (v ? String(v) : SRC.manual); }
  // 统一入口：越界拦下并说清楚，成功返回条目
  function catalogSave(o, source) {
    var list = A.catalog.list();
    var isUpdate = o.id != null && list.some(function (e) { return String(e.id) === String(o.id); });
    if (!isUpdate && list.length >= CAT_MAX) {
      toast(T('目录已满（') + CAT_MAX + T(' 条）：请先在"管理目录"里删掉一些再保存'), 5200);
      return null;
    }
    var saved = A.catalog.save({ id: o.id, name: o.name, params: o.params, modules: o.modules, outcome: o.outcome, note: source || 'manual' });
    if (saved) refreshBangCount();
    return saved;
  }

  /* ---------------------------------------------------------- 目录管理
   * 单条/批量删除、全选、清空、导出/导入（合并 or 替换 + 按 hash 去重）、自动保存开关。
   * 去重键：引擎给的 hash；老条目没有 hash 就退回 params+modules 摘要。 */
  var CM = { box: null, sel: {}, filter: 'all', namesOpen: false };
  /* 自定义天体名（镜像里给星系/恒星系/行星起的名字）：表由 ui/mirror.js 持有，
     存在 localStorage 的 mirror.ui.names.v1 下，键里带创世参数哈希——别的宇宙不会继承这些名字。
     这里只做管理（列出/改名/恢复原名/清空）与导出导入的携带。 */
  function namesStore() { return (window.MirrorBrowser && window.MirrorBrowser.names) || null; }
  // 改完名字要让正在看的镜像跟着变（面包屑、画布标签、行星列表都读同一张表）
  function namesChanged() { if (S.mirror && S.mirror.refreshNames) { try { S.mirror.refreshNames(); } catch (e) { console.warn('[app] 刷新自定义名失败', e); } } }
  /* 导出的 JSON 在目录条目之外再带一份 names: { 键: 名字 }；导入时同键以导入的为准并报覆盖数。 */
  function catalogJSON() {
    var json = A.catalog.exportJSON(), N = namesStore();
    if (!N) return json;
    try {
      var m = N.all(); if (!Object.keys(m).length) return json;
      var o = JSON.parse(json); o.names = m; return JSON.stringify(o, null, 2);
    } catch (e) { return json; }
  }
  function namesOf(data) { return (data && data.names && typeof data.names === 'object' && !Array.isArray(data.names)) ? data.names : null; }
  // 编辑器抽屉那条导入路径（没有合并/替换对话框）：名字表一律按"导入的为准"合并
  function mergeNamesFromJSON(text) {
    var N = namesStore(); if (!N) return '';
    var data = null; try { data = JSON.parse(text); } catch (e) { return ''; }
    var m = namesOf(data); if (!m) return '';
    var r = N.merge(m); namesChanged(); if (CM.box) cmNamesRender();
    return T('，自定义天体名新增 ') + r.added + (r.conflict ? T('、覆盖同名键 ') + r.conflict : '');
  }
  // params 摘要：先 normalize，导入残缺字段与目录里已归一化的同组参数才能对上
  /* 去重键必须只由条目自身决定，不能掺进当前 UI 的实时状态。
     先把模块集解析成一个确定的对象再用它归一化参数：缺 .modules 的旧格式导出会落到
     mod.defaultOn 这一组稳定默认值。如果这里把 modules 直接传 undefined 给 A.normalize，
     它内部会退到 currentModules（用户此刻开着的推测性模块），于是同一份 JSON 在不同模块
     开关下导入会算出不同的键，"合并导入"会把已有条目当成新条目重复入库。 */
  function entryParamsKey(e) {
    var ms = A.normalizeModules((e && e.modules) || null);
    var p = A.normalize((e && e.params) || {}, ms);
    var keys = Object.keys(p).sort();
    return 'p:' + A.modulesKey(ms) + '|' + keys.map(function (k) { return k + '=' + Number(p[k]).toPrecision(10); }).join(',');
  }
  // 同时登记 hash 与 params 键：一边有 hash、一边没有时仍判成同一条，避免合并导入重复入库
  function markEntrySeen(seen, e) {
    if (e && e.hash != null) seen['h:' + e.hash] = 1;
    seen[entryParamsKey(e)] = 1;
  }
  function isEntrySeen(seen, e) {
    if (e && e.hash != null && seen['h:' + e.hash]) return true;
    return !!seen[entryParamsKey(e)];
  }
  function entryKey(e) {
    if (e && e.hash != null) return 'h:' + e.hash;
    return entryParamsKey(e);
  }
  /* 站点版（MIRROR_LOCK_TO_BLOCKS）的管理目录**只显示来自 BNB 区块的宇宙**。
     判据：catalogSave 存的结构里没有区块哈希/高度字段（id/name/params/modules/outcome/note，
     见 ui/adapter.js 的 list() 映射——e.hash 是参数种子，不是区块哈希），
     所以只能认 name：区块宇宙的 name 一律以「BNB 」开头（bnb-ui 的 fire()/entryOf 写的
     'BNB 区块 N' / 'BNB 0x…'）。**数据一条不删**——localStorage 是用户的，
     离线单文件版照常全量可见；这里只是站点版的显示过滤。 */
  function cmIsBlock(e) { return /^BNB /.test(String((e && e.name) || '')); }
  function cmHiddenCount() {
    if (!window.MIRROR_LOCK_TO_BLOCKS) return 0;
    return A.catalog.list().filter(function (e) { return !cmIsBlock(e); }).length;
  }
  function cmRows() {
    var l = A.catalog.list();
    if (window.MIRROR_LOCK_TO_BLOCKS) l = l.filter(cmIsBlock);
    if (CM.filter === 'all') return l;
    return l.filter(function (e) { return (e.note || 'manual') === CM.filter; });
  }
  function cmSelectedIds() { return Object.keys(CM.sel).filter(function (k) { return CM.sel[k]; }); }
  function openCatalog() {
    if (CM.box) CM.box.remove();
    CM.sel = {};
    var box = document.createElement('div'); box.id = 'catBox'; box.className = 'export-box';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', T('管理目录'));
    box.innerHTML = '<div class="export-panel cm-panel">' +
      '<div class="export-head"><b>' + esc(T('管理目录')) + '</b><span class="export-note" id="cmCount"></span></div>' +
      '<div class="cm-tools">' +
      '<label class="cm-chk"><input type="checkbox" id="cmAll">' + esc(T(' 全选')) + '</label>' +
      '<label class="cm-flt">' + esc(T('来源 ')) + '<select id="cmFilter"><option value="all">' + esc(T('全部')) + '</option>' +
      '<option value="manual">' + esc(T('手动保存')) + '</option><option value="search">' + esc(T('搜索命中')) + '</option><option value="example">' + esc(T('示例加载')) + '</option></select></label>' +
      '<label class="cm-chk" title="' + esc(T('关掉后，搜索命中不会自动写进目录，改由命中面板上的“记下来”按钮决定')) + '">' +
      '<input type="checkbox" id="cmAuto">' + esc(T(' 搜索命中自动保存')) + '</label>' +
      '</div>' +
      '<div class="sr-body" id="cmBody"></div>' +
      '<details class="cm-names" id="cmNames"' + (CM.namesOpen ? ' open' : '') + '>' +
      '<summary>' + esc(T('已命名的天体（')) + '<span id="cmNamesN">0</span>' + esc(T('）')) + '</summary>' +
      '<div class="cm-names-body" id="cmNamesBody"></div></details>' +
      '<div class="export-btns">' +
      '<button type="button" class="btn danger" id="cmDel">' + esc(T('删除所选')) + '</button>' +
      '<button type="button" class="btn danger" id="cmClear">' + esc(T('清空全部')) + '</button>' +
      '<button type="button" class="btn" id="cmExport">' + esc(T('导出 JSON')) + '</button>' +
      '<button type="button" class="btn" id="cmImport">' + esc(T('导入 JSON')) + '</button>' +
      '<input type="file" id="cmFile" accept="application/json,.json" hidden>' +
      '<span class="foot-sp"></span><button type="button" class="btn ghost" id="cmClose">' + esc(T('关闭')) + '</button></div></div>';
    document.body.appendChild(box); CM.box = box;
    box.querySelector('#cmAuto').checked = autoSaveOn();
    box.querySelector('#cmAuto').addEventListener('change', function () { setAutoSave(this.checked); toast(this.checked ? T('搜索命中将自动存入目录') : T('搜索命中不再自动保存：在命中面板点"记下来"才入库'), 3600); });
    box.querySelector('#cmFilter').addEventListener('change', function () { CM.filter = this.value; cmRender(); });
    box.querySelector('#cmAll').addEventListener('change', function () {
      var on = this.checked; cmRows().forEach(function (e) { CM.sel[String(e.id)] = on; }); cmRender();
    });
    box.querySelector('#cmDel').addEventListener('click', function () {
      var ids = cmSelectedIds(); if (!ids.length) { toast(T('先勾选要删除的条目'), 2600); return; }
      askConfirm(T('删除选中的 ') + ids.length + T(' 条？此操作不可撤销。'), { title: '删除所选' }, function (ok) {
        if (!ok) return;
        var k = A.catalog.removeMany(ids); CM.sel = {};
        cmAfterDelete(k, ids, T('已删除 ') + k + T(' 条'));
      });
    });
    box.querySelector('#cmClear').addEventListener('click', function () {
      /* 站点版「清空全部」只清**看得见的**（区块宇宙）：被过滤隐藏的非区块条目
         是离线版还要用的数据，不能让用户在看不见它们的界面里把它们一并抹掉。 */
      var scope = window.MIRROR_LOCK_TO_BLOCKS
        ? A.catalog.list().filter(cmIsBlock) : A.catalog.list();
      var t = scope.length; if (!t) { toast(T('目录已经是空的'), 2400); return; }
      var allIds = scope.map(function (e) { return e.id; });
      askConfirm(T('清空目录里全部 ') + t + T(' 条？此操作不可撤销。'), { title: '清空全部' }, function (ok) {
        if (!ok) return;
        var k = window.MIRROR_LOCK_TO_BLOCKS ? A.catalog.removeMany(allIds) : A.catalog.clearUsers();
        CM.sel = {};
        cmAfterDelete(k, allIds, T('已清空 ') + k + T(' 条'));
      });
    });
    box.querySelector('#cmExport').addEventListener('click', function () { cmExport(); });
    box.querySelector('#cmImport').addEventListener('click', function () { box.querySelector('#cmFile').click(); });
    box.querySelector('#cmFile').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var r = new FileReader(); var self = this;
      r.onload = function () { cmImport(String(r.result)); self.value = ''; };
      r.readAsText(f);
    });
    box.querySelector('#cmNames').addEventListener('toggle', function () { CM.namesOpen = this.open; });
    box.querySelector('#cmClose').addEventListener('click', function () { box.remove(); CM.box = null; });
    // Esc 关面板；但正在改名字的输入框自己会吃掉 Esc（在里面按 Esc 只是放弃这次编辑）
    box.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); box.remove(); CM.box = null; } });
    cmRender();
  }
  /* 「已命名的天体」：列出所有自定义名，可以就地改名、恢复原名、一次清空。
     键里带创世参数哈希与各层种子，所以这里也顺带把它翻译成人话（原名只有本次会话见过的才有）。 */
  function cmNamesRender() {
    if (!CM.box) return;
    var N = namesStore(), body = CM.box.querySelector('#cmNamesBody'), cnt = CM.box.querySelector('#cmNamesN');
    if (!body) return;
    var keys = N ? N.keys() : [];
    if (cnt) cnt.textContent = String(keys.length);
    if (!N) { body.innerHTML = '<p class="an-empty">' + esc(T('（镜像模块未加载，无法读取自定义名）')) + '</p>'; return; }
    if (!keys.length) {
      body.innerHTML = '<p class="an-empty">' + esc(T('（还没有起过名字的天体：进镜像后点信息面板标题旁的 ✎、双击标题，或右键选「重命名（当前天体）」）')) + '</p>';
      return;
    }
    body.innerHTML = '<table class="cm-tbl cm-ntbl"><thead><tr><th>' + esc(T('名字')) + '</th><th>' + esc(T('天体')) + '</th><th></th></tr></thead><tbody>' +
      keys.map(function (k) {
        var orig = N.origOf(k);
        return '<tr data-k="' + esc(k) + '">' +
          '<td><input type="text" class="cm-nm" maxlength="' + (N.MAX || 24) + '" value="' + esc(N.get(k)) + '" aria-label="' + esc(T('自定义名（留空恢复原名）')) + '"></td>' +
          '<td class="cm-nk">' + esc(N.describe(k)) + (orig ? ' <span class="cm-norig">' + esc(T('（原名 ')) + esc(orig) + '）</span>' : '') + '</td>' +
          '<td><button type="button" class="btn ghost cm-nrev" title="' + esc(T('删掉自定义名，恢复生成器给的原名')) + '">' + esc(T('恢复原名')) + '</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="cm-nfoot"><span class="export-note">' + esc(T('名字存在这台浏览器里；导出 JSON 会带上这张表')) + '</span>' +
      '<button type="button" class="btn danger" id="cmNClear">' + esc(T('清空全部自定义名（')) + keys.length + '）</button></div>';
    Array.prototype.forEach.call(body.querySelectorAll('tr[data-k]'), function (tr) {
      var k = tr.getAttribute('data-k');
      tr.querySelector('.cm-nm').addEventListener('change', function () {
        var v = N.set(k, this.value);
        namesChanged();
        if (!v) { toast(T('已恢复原名'), 2400); cmNamesRender(); }        // 留空 = 删掉这一条，行也跟着没了
        else { this.value = v; toast(T('已改名为 ') + v, 2400); }
      });
      tr.querySelector('.cm-nrev').addEventListener('click', function () {
        N.remove(k); namesChanged(); cmNamesRender(); toast(T('已恢复原名'), 2400);
      });
    });
    var cl = body.querySelector('#cmNClear');
    if (cl) cl.addEventListener('click', function () {
      askConfirm(T('清空全部 ') + keys.length + T(' 个自定义天体名？此操作不可撤销：这些天体会恢复成生成器给的原名。'),
        { title: '清空自定义名' }, function (ok) {
          if (!ok) return;
          var n = N.clear(); namesChanged(); cmNamesRender(); toast(T('已清空 ') + n + T(' 个自定义名'), 3000);
        });
    });
  }
  function cmRender() {
    if (!CM.box) return;
    var rows = cmRows(), all = A.catalog.list();
    CM.box.querySelector('#cmCount').textContent = T('共 ') + all.length + ' / ' + CAT_MAX + T(' 条') +
      (CM.filter !== 'all' ? T('（当前筛选 ') + rows.length + T(' 条）') : '') + (all.length >= CAT_MAX ? T(' · 已满，新的保存会被拒绝') : '');
    var body = CM.box.querySelector('#cmBody');
    cmNamesRender();                    // 自定义天体名那一节与目录条目无关，空目录时也要渲染
    /* 站点版被过滤掉的条目要**说出来**：数据一条没删，只是这里不显示（离线版全量可见）。
       不说这一行，用户会以为保存的宇宙丢了。 */
    var hiddenN = cmHiddenCount();
    var hiddenNote = hiddenN
      ? '<p class="export-note" style="margin:0 0 8px">'
        + esc(T('{0} 条非区块宇宙已隐藏（离线版可见）').split('{0}').join(String(hiddenN))) + '</p>'
      : '';
    if (!rows.length) { body.innerHTML = hiddenNote + '<p class="an-empty">' + esc(T('（没有条目）')) + '</p>'; CM.box.querySelector('#cmAll').checked = false; return; }
    body.innerHTML = hiddenNote + '<table class="cm-tbl"><thead><tr><th></th><th>' + esc(T('编号')) + '</th><th>' + esc(T('名称')) + '</th><th>' + esc(T('来源')) + '</th><th>' + esc(T('结局')) + '</th><th>' + esc(T('时间')) + '</th><th></th></tr></thead><tbody>' +
      rows.map(function (e) {
        var d = e.createdAt ? String(e.createdAt).replace('T', ' ').slice(0, 16) : '—';
        return '<tr data-id="' + esc(String(e.id)) + '">' +
          '<td><input type="checkbox" class="cm-cb"' + (CM.sel[String(e.id)] ? ' checked' : '') + '></td>' +
          '<td class="cm-id">' + esc(e.label) + '</td>' +
          '<td class="cm-name" title="' + esc(e.name || '') + '">' + esc(T(e.name || '（未命名）')) + '</td>' +
          '<td><span class="cm-src cm-src-' + esc(e.note || 'manual') + '">' + esc(T(srcOf(e))) + '</span></td>' +
          '<td class="cm-out">' + esc(e.outcomeName || e.hint || e.outcome || '—') + '</td>' +
          '<td class="cm-t">' + esc(d) + '</td>' +
          '<td><button type="button" class="btn ghost cm-del1" title="' + esc(T('删除这一条')) + '">✕</button></td></tr>';
      }).join('') + '</tbody></table>';
    Array.prototype.forEach.call(body.querySelectorAll('tr[data-id]'), function (tr) {
      var id = tr.getAttribute('data-id');
      tr.querySelector('.cm-cb').addEventListener('change', function () { CM.sel[String(id)] = this.checked; cmSyncAll(); });
      tr.querySelector('.cm-del1').addEventListener('click', function () {
        askConfirm(T('删除') + ' ' + tr.querySelector('.cm-id').textContent + T('？'), { title: '删除这一条' }, function (ok) {
          if (!ok) return;
          var done = A.catalog.remove(id); delete CM.sel[String(id)];
          cmAfterDelete(done ? 1 : 0, [id], T('已删除'));
        });
      });
    });
    cmSyncAll();
  }
  /* 删除后的统一收尾：反馈要真实——真删掉了几条就报几条；一条都没删掉就说清楚，
     顺带把 ids 与目录里 id 的类型打到控制台，下次再出这种"点了没反应"能立刻定位 */
  function cmAfterDelete(k, ids, okMsg) {
    if (!k && ids && ids.length) {
      var have = A.catalog.list().slice(0, 5).map(function (e) { return e.id + '(' + typeof e.id + ')'; });
      console.warn('[app] 删除失败：没找到对应条目。请求删除 =', ids.map(function (i) { return i + '(' + typeof i + ')'; }), '目录里前几条 =', have);
      toast(T('删除失败：未找到对应条目（详见控制台）'), 4200);
    } else toast(okMsg, 3000);
    cmRender(); if (S.listOpen) buildList(); refreshBangCount();
  }
  function cmSyncAll() {
    if (!CM.box) return;
    var rows = cmRows(), on = rows.length > 0 && rows.every(function (e) { return CM.sel[String(e.id)]; });
    CM.box.querySelector('#cmAll').checked = on;
    var nSel = cmSelectedIds().length;
    CM.box.querySelector('#cmDel').textContent = nSel ? T('删除所选（') + nSel + T('）') : T('删除所选');
  }
  function cmExport() {
    var json = catalogJSON();       // 目录条目 + 自定义天体名
    try {
      var blob = new Blob([json], { type: 'application/json' }), url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'mirror-universe-catalog.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast(T('已导出目录 JSON')); return;
    } catch (e) { /* 落到复制框 */ }
    showExportBox(json);
  }
  function cmImport(text) {
    var data; try { data = JSON.parse(text); } catch (e) { toast(T('导入失败：不是合法 JSON'), 4000); return; }
    var incoming = (data && Array.isArray(data.entries)) ? data.entries : null;
    var names = namesOf(data), nN = names ? Object.keys(names).length : 0;
    if (!incoming) {
      if (!nN) { toast(T('导入失败：缺少 entries 数组'), 4000); return; }
      incoming = [];                                    // 只带自定义名的文件也收
    }
    askConfirm(T('导入 ') + incoming.length + T(' 条') + (nN ? T('，另带 ') + nN + T(' 个自定义天体名（同键以导入的为准）') : '') +
      T('。\n\n替换：先清空现有目录再导入\n合并：保留现有条目，跳过重复的'),
      { title: '导入 JSON', buttons: [
        { label: '替换导入', value: 'replace', cls: 'danger' },
        { label: '合并导入', value: 'merge', cls: 'primary' },
        { label: '取消', value: null, cls: 'ghost' }
      ] },
      function (mode) { if (mode) cmImportRun(incoming, mode === 'replace', names); });
  }
  function cmImportRun(incoming, replace, names) {
    var before = A.catalog.list();
    if (replace) { A.catalog.clearUsers(); before = []; }
    var seen = {}; before.forEach(function (e) { markEntrySeen(seen, e); });
    var added = 0, dup = 0, full = 0, ours = 0;
    for (var i = 0; i < incoming.length; i++) {
      var e = incoming[i];
      if (!e || !e.params) continue;
      if (isEntrySeen(seen, e)) { dup++; continue; }
      if (A.catalog.list().length >= CAT_MAX) { full++; continue; }
      var saved = A.catalog.save({ name: e.name, params: e.params, modules: e.modules, outcome: e.outcome, note: e.note || 'manual' });
      // 与 #1207 参数相同的条目会被引擎归到"我们的宇宙"（预设），不进用户目录：不算新增
      // 入库后的条目可能多了 hash：两边键都登记，后续导入才认得出
      if (saved && !saved.ours) { markEntrySeen(seen, e); markEntrySeen(seen, saved); added++; } else if (saved) ours++;
    }
    /* 自定义天体名：同键以导入的为准，覆盖了几个要报出来（不然本地被悄悄改掉了都不知道）。
       替换导入也只是合并这张表——名字是按创世参数哈希存的，与目录条目的增删无关。 */
    var nmsg = '', N = namesStore();
    if (names && N) {
      var r = N.merge(names);
      nmsg = T('；自定义天体名新增 ') + r.added +
        (r.conflict ? T('，覆盖同名键 ') + r.conflict + T(' 个（以导入的为准）') : '') +
        (r.same ? T('，') + r.same + T(' 个本来就一样') : '');
      namesChanged();
    }
    toast(T('导入完成：新增 ') + added + T(' 条') + (dup ? T('，跳过重复 ') + dup + T(' 条') : '') + (ours ? T('，') + ours + T(' 条与我们的宇宙相同（归入预设）') : '') + (full ? T('，因超出上限未导入 ') + full + T(' 条') : '') + nmsg, 5200);
    cmRender(); if (S.listOpen) buildList(); refreshBangCount();
  }

  /* ---------------------------------------------------------- 参数编辑器 */
  var edBody = $('edBody');
  // UI 侧补充说明（不动引擎的参数表）：把"默认值是什么性质的数"说清楚
  var PARAM_NOTE = {
    sumNu: '0.06 eV 为正常质量序下的下限（振荡实验），非测量值；宇宙学上界 < 0.12 eV（Planck 2018）。'
  };
  function openEditor(open) {
    S.editorOpen = open; $('editor').hidden = !open; syncPanelOpen();
    if (open) { loadEditor(S.entry && !S.entry.temp ? S.entry : (S.entry && S.entry.temp ? S.entry : null)); setTimeout(function () { $('edName').focus(); }, 0); }
    else $('btnEditor').focus();
  }
  function loadEditor(entry, keepModules) {
    S.editEntry = entry;
    if (entry && entry.modules && !keepModules) A.setModules(entry.modules);
    S.editModules = A.getModules();
    S.editParams = A.normalize(entry ? entry.params : A.defaults());
    $('edName').value = entry && !entry.preset ? (entry.name || '') : (entry && entry.preset ? entry.name : '');
    $('edMeta').textContent = (entry ? T(entry.label) + (entry.preset ? T('（预设）') : '') : T('新参数组')) + ' · ' + A.PARAMS.length + T(' 个参数') + (modsLabel(S.editModules) ? T(' · 已开启：') + modsLabel(S.editModules) : '');
    $('edDelete').disabled = !(entry && !entry.preset && !entry.temp);
    edBody.innerHTML = '';
    // 内置示例参数组：只在这里出现，加载即填进编辑器，不写进目录、不占编号
    var exBox = document.createElement('details'); exBox.className = 'ex-box';
    var pres = A.catalog.presets();
    exBox.innerHTML = '<summary>' + esc(T('加载示例参数组（不入目录）')) + '</summary>' +
      '<div class="ex-note">' + esc(T('引擎自带的 ')) + pres.length + esc(T(' 组示例：点一下把参数填进下面的编辑器，改完再"用这组参数引爆"。它们不会出现在起爆页的下拉目录里，也不占用编号。')) + '</div>' +
      '<div class="ex-list">' + pres.map(function (p, i) {
        return '<button type="button" class="btn ex-btn" data-i="' + i + '" title="' + esc(p.hint || '') + '">' + esc(p.name || p.label) + '</button>';
      }).join('') + '</div>';
    Array.prototype.forEach.call(exBox.querySelectorAll('.ex-btn'), function (b) {
      b.addEventListener('click', function () {
        var p = pres[+b.getAttribute('data-i')];
        if (!p) return;
        loadEditor({ id: p.id, label: p.label, name: p.name, params: p.params, modules: p.modules, preset: true, ours: p.ours, fromExample: true });
        S.lastExample = true;
        toast(T('已加载示例：') + T(p.name || p.label) + T('（改完点"用这组参数引爆"）'), 3200);
      });
    });
    edBody.appendChild(exBox);
    // 推测性模块开关区（默认全关；开启后其参数替换被派生的输入）
    if (A.MODULES.length) {
      var mbox = document.createElement('div'); mbox.className = 'mods';
      mbox.innerHTML = '<div class="pgroup">' + esc(T('推测性模块（默认关闭；开启后其参数替换被派生的输入）')) + '</div>';
      A.MODULES.forEach(function (mod) {
        var on = !!S.editModules[mod.id];
        var row = document.createElement('div'); row.className = 'mod-row' + (on ? ' on' : '');
        var refStr = refText(mod.ref);
        row.innerHTML = '<label class="mod-label"><input type="checkbox" ' + (on ? 'checked' : '') + ' aria-label="' + esc(T(mod.name)) + '"> <span class="mod-name">' + esc(T(mod.name)) + '</span> ' + statusTag(mod.status) + (mod.derives && mod.derives.length ? ' <span class="mod-derives">' + esc(T('派生：')) + esc(mod.derives.map(function (k) { var d = A.paramDef(k); return d ? (d.symbol || k) : k; }).join('、')) + '</span>' : '') + '</label>' +
          '<div class="pdesc">' + esc(T(mod.desc || '')) + '</div>' + (refStr ? '<div class="pref">' + esc(T('依据：')) + esc(refStr) + '</div>' : '');
        row.querySelector('input').addEventListener('change', function (ev) {
          var m = A.getModules(); m[mod.id] = ev.target.checked; A.setModules(m);
          var keep = { id: S.editEntry && S.editEntry.id, label: S.editEntry ? S.editEntry.label + T('（模块已改）') : T('新参数组'), name: $('edName').value, params: S.editParams, modules: m, temp: true, preset: false };
          loadEditor(keep, true);
          if (S.listOpen) buildList();
          refreshBangCount();
        });
        mbox.appendChild(row);
      });
      edBody.appendChild(mbox);
    }
    var lastGroup = null;
    A.PARAMS.forEach(function (d, i) {
      if (d.group && d.group !== lastGroup) { lastGroup = d.group; var g = document.createElement('div'); g.className = 'pgroup'; g.textContent = d.group; edBody.appendChild(g); }
      var row = document.createElement('div'); row.className = 'prow';
      var refStr = refText(d.ref);
      var refHtml = refStr ? ' <button type="button" class="tag tag-ref" aria-expanded="false" title="' + esc(refStr) + '">ref</button>' : '';
      row.innerHTML = '<div class="plabel"><span class="pidx">' + String(i + 1).padStart(2, '0') + '</span><span class="pname">' + esc(TE(d.name)) + '</span><span class="psym">' + esc(d.symbol || d.key) + '</span>' + statusTag(d.status || (d.module ? (A.MODULES.filter(function (m) { return m.id === d.module; })[0] || {}).status : 'accepted')) + (d.module ? '<span class="tag tag-module">' + esc(T((A.MODULES.filter(function (m) { return m.id === d.module; })[0] || { name: d.module }).name.replace(/模块.*$/, ''))) + '</span>' : '') + refHtml + '</div>' +
        '<div class="pctl"><input type="range" min="0" max="1000" step="1" aria-label="' + esc(d.name) + ' 滑块"><input type="number" aria-label="' + esc(d.name) + ' 数值" step="' + (d.step || 'any') + '" min="' + d.min + '" max="' + d.max + '"><span class="punit">' + esc(d.unit || '') + '</span><span class="pval" aria-hidden="true"></span></div>' +
        '<div class="pdesc">' + esc(TE(d.desc || '')) + (PARAM_NOTE[d.key] ? ' ' + esc(T(PARAM_NOTE[d.key])) : '') + (d.si ? ' <span class="pref">' + esc(T('（我们的宇宙：')) + esc(TE(d.si)) + '）</span>' : '') + '</div>' +
        (refStr ? '<div class="pref ref-full" hidden>' + esc(T('依据：')) + esc(refStr) + '</div>' : '');
      var refBtn = row.querySelector('.tag-ref');
      if (refBtn) refBtn.addEventListener('click', function () { var full = row.querySelector('.ref-full'); full.hidden = !full.hidden; refBtn.setAttribute('aria-expanded', String(!full.hidden)); });
      var rg = row.querySelector('input[type=range]'), nm = row.querySelector('input[type=number]'), dispEl = row.querySelector('.pval');
      function sync(fromRange) {
        var v;
        if (fromRange) { v = A.fromUnit(d.key, +rg.value / 1000); var st = d.step || 0.01; v = Math.round(v / st) * st; v = Number(v.toFixed(8)); }
        // 非法数字（清空 / 粘贴非数字）：早退前把框恢复成当前有效值，避免框里是 NaN、内存里却还是旧数
        else { v = +nm.value; if (!isFinite(v)) { nm.value = String(Number(S.editParams[d.key].toPrecision(8))); return; } }
        v = Math.min(d.max, Math.max(d.min, v));
        S.editParams[d.key] = v;
        // 数字框只放 schema 原始单位：以前拖完滑块后框里留的是 "137.04"（α 的倒数显示去掉了 1/），
        // 失焦触发 change 就被当成 α=137.04 再夹到 max —— 电磁强度会悄悄变成 68 倍
        nm.value = String(Number(v.toPrecision(8)));
        if (!fromRange) rg.value = String(Math.round(A.toUnit(d.key, v) * 1000));
        if (dispEl) dispEl.textContent = pfmt(d.key, v);
        $('edMeta').textContent = (S.editEntry ? T(S.editEntry.label) + T('（已修改）') : T('新参数组')) + T(' · 距观测值：') + A.distance(S.editParams).toFixed(1);
      }
      rg.addEventListener('input', function () { sync(true); });
      nm.addEventListener('change', function () { sync(false); });
      var v0 = S.editParams[d.key];
      rg.value = String(Math.round(A.toUnit(d.key, v0) * 1000)); nm.value = String(Number(v0.toPrecision(8)));
      if (dispEl) dispEl.textContent = pfmt(d.key, v0);
      edBody.appendChild(row);
    });
  }
  $('edClose').addEventListener('click', function () { openEditor(false); });
  $('edRandom').addEventListener('click', function () { var p = A.randomParams(); loadEditor({ id: 'random', label: '随机', name: '', params: p, modules: A.getModules(), temp: true }); });
  $('edSave').addEventListener('click', function () {
    var e = S.editEntry, name = $('edName').value.trim();
    var saved = catalogSave({ id: e && !e.preset && !e.temp ? e.id : undefined, name: name, params: S.editParams, modules: A.getModules() }, 'manual');
    if (saved) { toast(T('已保存 ') + saved.label + (saved.name ? ' ' + saved.name : '')); loadEditor(saved); selectEntry(saved); }
  });
  $('edSaveAs').addEventListener('click', function () { var saved = catalogSave({ name: $('edName').value.trim(), params: S.editParams, modules: A.getModules() }, S.lastExample ? 'example' : 'manual'); if (saved) { toast(T('已另存为 ') + saved.label); loadEditor(saved); selectEntry(saved); } });
  $('edDelete').addEventListener('click', function () {
    var e = S.editEntry; if (!e || e.preset) return;
    askConfirm(T('删除') + ' ' + e.label + (e.name ? ' ' + e.name : '') + T('？'), { title: '删除参数组' }, function (ok) {
      if (!ok) return;
      if (!A.catalog.remove(e.id)) { console.warn('[app] 编辑器删除失败：id =', e.id, '(' + typeof e.id + ')'); toast(T('删除失败：未找到 ') + e.label + T('（详见控制台）'), 4200); return; }
      toast(T('已删除') + ' ' + e.label);
      if (S.entry && String(S.entry.id) === String(e.id)) { S.entry = null; ddText.textContent = T('（点击箭头，下拉出一行行数据组）'); ddText.classList.add('empty'); }
      loadEditor(null); if (S.listOpen) buildList(); refreshBangCount(); if (CM.box) cmRender();
    });
  });
  $('edFire').addEventListener('click', function () {
    var e = S.editEntry, p = A.normalize(S.editParams), ms = A.getModules();
    var same = e && !e.temp && A.modulesKey(e.modules) === A.modulesKey(ms) && A.distance(p, e.params) === 0;
    selectEntry(same ? e : { id: 'temp', label: '#' + String(A.catalog.nextId()).padStart(4, '0'), name: $('edName').value.trim() || '未保存', params: p, modules: ms, temp: true });
    openEditor(false); setState('confirm');
  });
  $('edExport').addEventListener('click', function () {
    var json = catalogJSON();       // 目录条目 + 自定义天体名
    // 先试 <a download>；环境不允许下载（如受限 iframe）时弹出文本框供复制
    var fell = false;
    try {
      var blob = new Blob([json], { type: 'application/json' }), url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'mirror-universe-catalog.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast(T('已导出目录 JSON'));
    } catch (e) { fell = true; }
    if (fell) showExportBox(json);
  });
  // 复制式导出：沙箱内不能下载文件时，弹出文本框，全选复制即可保存
  function showExportBox(json) {
    var old = document.getElementById('exportBox'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'exportBox'; box.className = 'export-box';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', T('导出目录 JSON'));
    box.innerHTML = '<div class="export-panel">' +
      '<div class="export-head"><b>' + esc(T('导出目录 JSON')) + '</b><span class="export-note">' + esc(T('此环境不允许直接下载文件：复制下面的内容，保存为 .json；导入时选择该文件。')) + '</span></div>' +
      '<textarea id="exportTa" class="export-ta" readonly></textarea>' +
      '<div class="export-btns"><button type="button" id="exportCopy" class="btn">' + esc(T('复制到剪贴板')) + '</button><button type="button" id="exportClose" class="btn">' + esc(T('关闭')) + '</button></div></div>';
    document.body.appendChild(box);
    var ta = box.querySelector('#exportTa'); ta.value = json; ta.focus(); ta.select();
    box.querySelector('#exportCopy').addEventListener('click', function () {
      var done = function () { toast(T('已复制到剪贴板')); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, function () { ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast(T('复制失败，请手动全选复制'), 3000); } });
      else { ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast(T('复制失败，请手动全选复制'), 3000); } }
    });
    box.querySelector('#exportClose').addEventListener('click', function () { box.remove(); });
    box.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); box.remove(); } });
  }
  $('edImport').addEventListener('click', function () { $('edFile').click(); });
  $('edFile').addEventListener('change', function () {
    var f = $('edFile').files[0]; if (!f) return;
    var r = new FileReader(); r.onload = function () { try { var txt = String(r.result); var n = A.catalog.importJSON(txt); var nm = mergeNamesFromJSON(txt); toast(T('已导入 ') + n + T(' 组参数') + nm); if (S.listOpen) buildList(); } catch (e) { toast(T('导入失败：') + e.message, 4000); } $('edFile').value = ''; }; r.readAsText(f);
  });

  /* ---------------------------------------------------------- 关于与来源
   * 内容全部来自 ui/about-content.js（README.md / research/data/SOURCES.md / engine/README.md 摘录），
   * 这里只负责装配 DOM、开关与 Esc。?about=1 直接打开。 */
  var aboutBox = $('about'), aboutBody = $('aboutBody'), aboutBuilt = false;
  function aboutSubtitle(C) {
    var bits = [verLabel()];
    bits.push(A.isReal ? 'engine ' + (A.engineVersion || '?') : 'engine: stub');
    var bt = buildLabel(); if (bt) bits.push(T('构建 ') + bt);
    bits.push(T('内容摘录日期 ') + C.excerptDate);
    return bits.join(' · ');
  }
  function aboutHTML(C) {
    var h = '';
    // 一、这是什么
    h += '<div class="ab-sec"><h3>' + esc(T('这是什么、不是什么')) + '<span class="ab-from">' + esc(C.what.from) + '</span></h3><div class="ab-in">' +
      '<p class="ab-lede">' + esc(C.what.lede) + '</p><dl class="ab-dl">' +
      C.what.points.map(function (p) { return '<dt>' + esc(p.k) + '</dt><dd>' + esc(p.v) + '</dd>'; }).join('') +
      '</dl><p class="ab-note">' + esc(C.what.novel) + '</p>' +
      (C.what.units ? '<p class="ab-note units-note">' + esc(C.what.units) + '</p>' : '') + '</div></div>';
    // 二、标签图例
    C.legends.forEach(function (g) {
      h += '<div class="ab-sec"><h3>' + esc(g.group) + '<span class="ab-from">' + esc(g.from) + '</span></h3><div class="ab-in"><div class="ab-legend">' +
        g.items.map(function (it) {
          var cls = it.cls ? (it.cls.indexOf('rp-basis') === 0 ? it.cls : 'tag ' + it.cls) : 'tag';
          return '<span class="' + esc(cls) + '">' + esc(it.tag) + '</span><span>' + esc(it.v) + '</span>';
        }).join('') + '</div></div></div>';
    });
    // 三、数据来源
    h += '<div class="ab-sec"><h3>' + esc(T('数据来源')) + '<span class="ab-from">' + esc(C.sources.from) + '</span></h3><div class="ab-in">' +
      '<p class="ab-note">' + esc(C.sources.note) + '</p>' +
      '<table class="ab-tbl"><thead><tr><th>' + esc(T('名称')) + '</th><th>' + esc(T('用途')) + '</th><th>' + esc(T('许可证')) + '</th><th>' + esc(T('下载日期')) + '</th></tr></thead><tbody>' +
      C.sources.rows.map(function (r) {
        return '<tr><td data-l="' + esc(T('名称')) + '">' + esc(r.name) + '</td><td data-l="' + esc(T('用途')) + '">' + esc(r.use) +
          '<div class="ab-ref">' + esc(r.ref) + '</div></td><td data-l="' + esc(T('许可证')) + '">' + esc(r.license) + '</td><td data-l="' + esc(T('下载日期')) + '">' + esc(r.date) + '</td></tr>';
      }).join('') + '</tbody></table><p class="ab-note">' + esc(C.sources.cnNames) + '</p></div></div>';
    // 四、参数出处
    h += '<div class="ab-sec"><h3>' + esc(T('参数出处')) + '<span class="ab-from">' + esc(C.params.from) + '</span></h3><div class="ab-in"><dl class="ab-dl">' +
      C.params.rows.map(function (r) { return '<dt>' + esc(r.src) + '</dt><dd>' + esc(r.v) + '</dd>'; }).join('') + '</dl></div></div>';
    // 五、诚实清单
    h += '<div class="ab-sec"><h3>' + esc(T('什么没有被模拟')) + '<span class="ab-from">' + esc(C.notModeled.from) + '</span></h3><div class="ab-in"><ul class="ab-list">' +
      C.notModeled.rows.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div></div>';
    // 六、操作速查
    h += '<div class="ab-sec"><h3>' + esc(T('键盘 / 操作速查')) + '<span class="ab-from">' + esc(T('app.js 提示条与各层 hint 文案')) + '</span></h3><div class="ab-in">' +
      C.keys.map(function (g) {
        return '<div class="ab-scene">' + esc(g.scene) + '</div><dl class="ab-keys">' +
          g.items.map(function (kv) { return '<dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd>'; }).join('') + '</dl>';
      }).join('') + '</div></div>';
    return h;
  }
  function openAbout() {
    var C = window.MirrorAbout && window.MirrorAbout.content;
    if (!C) { toast(T('关于内容未加载（缺 ui/about-content.js）'), 3000); return; }
    if (!aboutBuilt) { aboutBody.innerHTML = aboutHTML(C); aboutBuilt = true; }
    $('aboutSub').textContent = aboutSubtitle(C);
    aboutBox.hidden = false; S.aboutOpen = true; syncPanelOpen();
    setTimeout(function () { $('aboutClose').focus(); }, 0);
  }
  function closeAbout() { if (aboutBox.hidden) return; aboutBox.hidden = true; S.aboutOpen = false; syncPanelOpen(); var l = $('aboutLink'); if (l) l.focus(); }
  $('aboutLink').addEventListener('click', openAbout);
  $('aboutClose').addEventListener('click', closeAbout);
  aboutBox.addEventListener('click', function (ev) { if (ev.target === aboutBox) closeAbout(); });   // 点遮罩关闭
  aboutBox.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); closeAbout(); } });
  window.MirrorAbout = window.MirrorAbout || {};
  window.MirrorAbout.open = openAbout;
  window.MirrorAbout.close = closeAbout;
  if (String(QS.get('about') || '') === '1') setTimeout(openAbout, 0);

  /* ---------------------------------------------------------- 乳白确认页 */
  $('btnFire').addEventListener('click', detonate);
  $('btnCancel').addEventListener('click', function () { setState('select'); });

  /* ---------------------------------------------------------- 引爆动画 */
  var timerEl = $('timer');
  function setTimer(years, small) { timerEl.className = 'timer' + (small ? ' small' : ''); timerEl.innerHTML = fmtInt(years) + '<span class="unit">' + T('年') + '</span>'; }
  function detonate() {
    var e = S.entry;
    S.no3D = false;                 // 上一次的 3D 失败不该永久锁死；每次引爆都重新试一次
    stopSearch();                   // 手动引爆时把还在跑的连续搜索停掉，免得它稍后又抢过去
    // 以前这里是静默 setState('select')：引爆点了没反应、直接弹回起爆页，什么线索都不留
    if (!e) { console.error('[app] detonate：没有选中的参数组（S.entry 为空）'); toast(T('还没有选中参数组：请先在下拉目录里选一行'), 3200); setState('select'); return; }
    var sim;
    try { sim = A.simulate(e.params, { register: true, modules: e.modules || A.getModules() }); }
    catch (err) { console.error('[app] 引擎错误', err); toast(T('引擎错误：') + (err && err.message), 5000); return; }
    try {
      S.sim = sim;
      disposeScene();
      // 不再放 15 秒过场：直接进宇宙，早期宇宙交给顶部的时间线条带（3 秒扫完）+ 随演化弹出的事件字幕。
      // 想看旧动画的话，分析报告里有"回放早期宇宙（示意动画）"。
      S.state = 'detonate';        // enterSpace 只在 detonate 状态下工作
      S.elapsed = 0;
      enterSpace();
      tlStart(sim);
    } catch (err2) { console.error('[app] 进入宇宙失败', err2); toast(T('引爆失败：') + (err2 && err2.message), 6000); }
  }
  // 回放旧的示意动画（从报告里手动触发）；放完照旧回到 space
  function replayDetonation() {
    var sim = S.sim; if (!sim) return;
    closeAnalysis();
    tlStop();
    disposeScene();
    S.view = makeDetonation(sim);
    setState('detonate');
    setDisclaim(T('回放 · 示意动画：颜色与节拍是示意，时间轴与事件来自引擎计算'), true);
    S.elapsed = 0;
  }
  /* 引爆字幕：不写文学句子，按动画时刻对应的宇宙时间取引擎 timeline 里的事件
     （sim.timeline === raw.timeline，条目 {id,name,tGyr,tLabel,happens,note}，数值由 calc 算出）*/
  function timelineEvents(sim) {
    var tl = (sim && sim.timeline && sim.timeline.length ? sim.timeline : (sim && sim.raw && sim.raw.timeline)) || [];
    return tl.filter(function (it) { return it && it.happens && it.tGyr != null && isFinite(it.tGyr); })
      .map(function (it) { return { yr: Math.max(0, it.tGyr * 1e9), name: TE(it.name || ''), note: TE(it.note || ''), tLabel: TE(it.tLabel || A.fmtTimeGyr(it.tGyr)) }; })
      .sort(function (a, b) { return a.yr - b.yr; });
  }
  /* 事件按顺序逐条过：动画进度均分给各事件。
     不按计时器的宇宙时刻取，是因为那条爬升曲线会在一帧里跨过 10⁻³² 秒的暴胀、10⁻⁶ 秒的夸克禁闭、
     以及同一时刻的复合与黑暗时代——那样等于没显示。每条字幕自带引擎给的 t=，动画节拍本身是示意。 */
  function eventCaption(evs, p) {
    if (!evs.length) return '';
    var cur = evs[Math.max(0, Math.min(evs.length - 1, Math.floor(p * evs.length)))];
    return 't=' + cur.tLabel + T('　') + cur.name + (cur.note ? T('：') + cur.note : '');
  }
  /* ---------------------------------------------------------- 早期宇宙时间线条带
   * 引爆后直接进宇宙，这条带子接手"早期宇宙"的叙事：
   *   1. 扫描阶段（3 秒）：把进入时刻之前的引擎事件依次点亮并弹字幕；
   *   2. 跟随阶段：模拟时间越过某个事件时点亮它、弹字幕（3D 与 2D 都由 tlSync 驱动）。
   * 事件与数值全部来自引擎 timeline，这里不写文学句子。 */
  var TL = { on: false, evs: [], entryYr: 0, sweep: 0, dur: 0, i: -1, capT: 0, live: false, lo: 1e-40 };
  function tlPos(yr) {
    var hi = Math.max(TL.entryYr, 1);
    var v = Math.max(TL.lo, yr || TL.lo);
    return Math.max(0, Math.min(1, Math.log(v / TL.lo) / Math.log(hi / TL.lo))) * 100;
  }
  function tlStop() { TL.on = false; var s = $('tlStrip'); if (s) s.hidden = true; }
  // 顶部状态行会按视口宽度折行（1024 下要三行），条带得贴着它的真实底边走，不能写死 top
  function tlReposition() {
    var s = $('tlStrip'), top = $('hudTop');
    if (!s || s.hidden) return;
    var y = 64;
    if (top && !top.hidden) { var r = top.getBoundingClientRect(); if (r.height > 0) y = Math.round(r.bottom) + 8; }
    s.style.top = y + 'px';
  }
  function tlStart(sim) {
    var strip = $('tlStrip'), track = $('tlTrack'), cap = $('tlCap');
    if (!strip || !track) return;
    TL.evs = timelineEvents(sim);
    /* 这条带子上的每个时刻都出自 3 维公式。D≠3 时每条字幕后面挂一句"· 3 维公式外推"，
       不然"复合 25 万年""星系形成 37 亿年"在一个 D=14 的宇宙里看着像实情。 */
    TL.dimNote = (Math.abs(dimOf(sim) - 3) > 1e-6) ? T('　· 3 维公式外推') : '';
    TL.entryYr = Math.max(1, (sim.enterTimeGyr || 13.8) * 1e9);
    TL.i = -1; TL.sweep = 0; TL.capT = 0; TL.live = false; TL.on = true;
    TL.dur = reduced ? 1.2 : 3;
    // 只有进入时刻之前的事件参与扫描；之后的留给"跟随"阶段
    TL.pre = TL.evs.filter(function (e) { return e.yr <= TL.entryYr * 1.000001; });
    var ticks = TL.evs.map(function (e, i) {
      return '<span class="tl-tick" id="tlTick' + i + '" style="left:' + tlPos(e.yr).toFixed(2) + '%" title="' + esc('t=' + e.tLabel + T('　') + e.name) + '"></span>';
    }).join('');
    track.innerHTML = '<i class="tl-fill" id="tlFill"></i>' + ticks;
    cap.textContent = ''; cap.className = 'tl-cap';
    strip.className = 'tl-strip'; strip.hidden = false; tlReposition();
  }
  /* 切语言：事件名与时刻标签重算一遍写回刻度的 title 与当前字幕。只改文字，不动扫描进度与位置。 */
  function tlRelabel() {
    if (!TL.on || !S.sim) return;
    TL.evs = timelineEvents(S.sim);
    TL.pre = TL.evs.filter(function (e) { return e.yr <= TL.entryYr * 1.000001; });
    for (var i = 0; i < TL.evs.length; i++) {
      var tick = $('tlTick' + i);
      if (tick) tick.title = 't=' + TL.evs[i].tLabel + T('　') + TL.evs[i].name;
    }
    var cap = $('tlCap'), cur = TL.evs[TL.i];
    if (cap && cur && cap.textContent) cap.textContent = cur.name;
  }
  function tlShow(i) {
    if (i < 0 || i >= TL.evs.length || i === TL.i) return;
    TL.i = i;
    var e = TL.evs[i], cap = $('tlCap'), fill = $('tlFill'), tick = $('tlTick' + i);
    if (tick) tick.className = 'tl-tick on';
    if (fill) fill.style.width = tlPos(e.yr).toFixed(2) + '%';
    if (cap) { cap.textContent = 't=' + e.tLabel + T('　') + e.name + (e.note ? T('：') + e.note : '') + (TL.dimNote || ''); cap.className = 'tl-cap show'; }
    TL.capT = 0;
  }
  // 每帧推进：扫描阶段按时间均分事件；跟随阶段按模拟时刻点亮
  function tlTick(dt, simYears) {
    if (!TL.on) return;
    var cap = $('tlCap');
    if (!TL.live) {
      TL.sweep += dt;
      var n = TL.pre.length;
      var idx = Math.min(n - 1, Math.floor(TL.sweep / TL.dur * n));
      if (idx > TL.i) tlShow(idx);
      if (TL.sweep >= TL.dur) { TL.live = true; var s = $('tlStrip'); if (s) s.className = 'tl-strip done'; }
      return;
    }
    // 跟随：模拟时间越过下一个事件就点亮
    if (simYears != null && isFinite(simYears)) {
      var j = TL.i;
      while (j + 1 < TL.evs.length && TL.evs[j + 1].yr <= simYears) j++;
      if (j > TL.i) tlShow(j);
    }
    TL.capT += dt;
    if (TL.capT > 6 && cap && cap.className.indexOf('show') >= 0) cap.className = 'tl-cap';   // 字幕停留 6 秒后淡出
  }
  function makeDetonation(sim) {
    var rnd = A.rng(sim.seed ^ 0xd37);
    var evs = timelineEvents(sim);
    var enterYears = Math.max(1, sim.enterTimeGyr * 1e9);
    var annihilated = sim.outcome.type === 'SPACE_ANNIHILATED';
    var total = reduced ? 9 : 15;      // 秒
    // 节拍：周期几何增长
    var beats = [], t = total * 0.11, per = reduced ? 0.7 : 0.32, k = 0;
    while (t < total * 0.62 && k < 60) { beats.push({ t0: t, t1: t + per }); t += per; per *= (reduced ? 1.22 : 1.13) * (0.94 + rnd() * 0.12); k++; }
    var beatEnd = t;
    var stage2 = { hold: 0, entered: false, done: false, annT: annihilated ? total * (0.2 + rnd() * 0.12) : -1, blackFade: 0 };
    var milk = [242, 238, 228];
    function colorAt(p) { // 蓝 → 黄 → 红 → 暗
      var c;
      if (p < 0.34) c = [46, 107, 255];
      else if (p < 0.5) { var u = (p - 0.34) / 0.16; c = [46 + (255 - 46) * u, 107 + (216 - 107) * u, 255 - (255 - 74) * u]; }
      else if (p < 0.62) { var u2 = (p - 0.5) / 0.12; c = [255 - (255 - 226) * u2, 216 - (216 - 58) * u2, 74 - (74 - 46) * u2]; }
      else { var u3 = Math.min(1, (p - 0.62) / 0.38); c = [226 - (226 - 18) * u3, 58 - (58 - 6) * u3, 46 - (46 - 8) * u3]; }
      return c;
    }
    return {
      name: 'detonate',
      draw: function (ctx, W, H, dt, el) {
        var p = Math.min(1, el / total);
        // 背景：乳白（虚无）
        var bf = stage2.blackFade;
        ctx.fillStyle = 'rgb(' + Math.round(milk[0] * (1 - bf)) + ',' + Math.round(milk[1] * (1 - bf)) + ',' + Math.round(milk[2] * (1 - bf)) + ')';
        ctx.fillRect(0, 0, W, H);
        // 计时器
        var years = 0;
        if (p < 0.06) { timerEl.hidden = true; }
        else {
          timerEl.hidden = false;
          var q = Math.max(0, (p - 0.1) / 0.9);
          years = enterYears * Math.pow(q, 2.6);
          if (annihilated && stage2.annT > 0 && el > stage2.annT) { years = Math.pow((el - stage2.annT) * 10, 4); S.annClock = el - stage2.annT; }   // 空间没了，时间照走（红色数字继续跳）
          setTimer(years, false);
        }
        // 球体
        var minD = Math.min(W, H), R = 0, col = colorAt(p), core = 1;
        var inBeats = p >= 0.11 && el < beatEnd;
        // 字幕 = 当前宇宙时刻落在引擎 timeline 的哪一个事件上（文本与数值全部来自引擎）
        if (p < 1) {
          var cap = eventCaption(evs, p);
          if (annihilated && stage2.annT > 0 && el > stage2.annT) cap = T('尺度因子归零：空间不再存在，引擎判定 ') + T(sim.outcome.title || sim.outcome.type);
          if (!cap) cap = T('示意动画：时间轴与事件来自引擎计算');
          $('enterHint').hidden = false;
          $('enterHint').textContent = cap + (el > 1.5 ? T('　（Enter 跳过）') : '');
        }
        if (annihilated && stage2.annT > 0 && el > stage2.annT) {
          var k2 = Math.min(1, (el - stage2.annT) / 0.5);
          R = Math.max(0, minD * 0.5 * (1 - k2)); col = [46, 107, 255]; core = 1 - k2;
          stage2.blackFade = Math.min(1, Math.max(0, (el - stage2.annT - 0.6) / 1.5));
          if (stage2.blackFade >= 1 && !stage2.entered && el - stage2.annT > 3.0) { stage2.entered = true; enterSpace(); relightStrip(); }
        } else if (inBeats) {
          var b = null; for (var i = 0; i < beats.length; i++) if (el >= beats[i].t0 && el < beats[i].t1) { b = beats[i]; break; }
          if (b) { var u = (el - b.t0) / (b.t1 - b.t0); var fill = reduced ? minD * 0.5 : Math.hypot(W, H) * 0.56; R = 3 + fill * Math.pow(u, 1.8); }
        } else if (p >= 0.11) {
          var u4 = Math.min(1, Math.max(0, (el - beatEnd) / (total - beatEnd)));
          R = minD * (0.10 + 0.26 * Math.pow(u4, 0.7));
          if (p >= 1) { // 稳定演化阶段：等待/自动进入
            stage2.hold += dt;
            $('enterHint').hidden = false; $('enterHint').textContent = T('稳定演化阶段 · 进去看看（Enter / 点击 · ') + Math.max(0, Math.ceil(2.5 - stage2.hold)) + T('）');
            if (stage2.hold > 2.5 && !stage2.entered) { stage2.entered = true; }
          }
          if (stage2.entered) { stage2.zoomT = (stage2.zoomT || 0) + dt; var z = Math.pow(stage2.zoomT / 0.8, 2); R = minD * 0.36 + Math.hypot(W, H) * z; if (stage2.zoomT > 0.9 && !stage2.done) { stage2.done = true; enterSpace(); relightStrip(); } }
        }
        if (R > 0.5) {
          var cx = W / 2, cy = H / 2;
          var glowR = R * (p < 0.62 ? 1.6 : 1.15);
          var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
          var c = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
          var hot = p < 0.62 ? core : 0;
          g.addColorStop(0, hot ? 'rgba(255,255,255,' + hot + ')' : c);
          g.addColorStop(Math.min(0.999, R / glowR * 0.55), c);
          g.addColorStop(Math.min(1, R / glowR), c);
          g.addColorStop(1, 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();
        }
      },
      // 鼠标点击不再跳过动画（双击"引爆"的第二下 / 随手点屏幕都会误跳）；只在稳定演化阶段点击=进入。跳过只用 Enter。
      pointer: function (type) { if (type === 'down' && S.state === 'detonate') { if (S.elapsed / total >= 1 && !stage2.entered) stage2.entered = true; } },
      key: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { if (S.elapsed / total >= 1) { stage2.entered = true; } else if (S.elapsed > 1.5) skipTo(); return true; } if (ev.key === 'Escape') { setState('select'); return true; } return false; },
      skip: skipTo
    };
    function skipTo() { S.elapsed = Math.max(S.elapsed, total * 0.999); }
  }

  /* ---------------------------------------------------------- 进入宇宙 */
  // 除了"全黑"（空间湮灭 / 近空）与"液体大洋"这两类本来就不是粒子画面的结局，其余结局一律走 3D 可观测宇宙：
  //   - 原来走 2D 粒子网（nbodyScene）的：OBSERVERS_POSSIBLE / 热寂 / 大挤压 / 大撕裂 / 黑洞主导 / 无恒星 / 无化学 / 异质定律…
  //   - 原来走"混乱色块"（chaosScene，D≥5）、"黑平面银线"（fractalScene，D<3）与居中提示框的：UNSTABLE_ORBITS / 高维 / 分数维
  //     —— 现在统一进 3D，引力按 r^{−(D−1)} 求解（见 universe3d 的 dimS 选项），画面自己说明"物理不对劲"。
  // 没有 WebGL2 时退回旧的 2D 粒子网（同样带 D 维引力核，见 ui/particles.js 的 makePM2D）。
  /* 「近空宇宙」（有空间有时间，却没有可发光的东西）的触发判据。
     两条都只用引擎自己的字段与阈值，不新增任何常数：
       A  calc.baryons.hasBaryons === false 且 calc.structure.structureFormed === false
          （engine.js calcBaryogenesis：Sakharov CP 破坏不足或 Ω_b=0；calcStructure：星系尺度涨落从未越过 δ_c=1.686）
       B  结局 HEAT_DEATH_NO_STRUCTURE 且 σ₈ 低于引擎 R_GROWTH 自己的 fail 线 0.05
          （engine.js 判 verdict 用的就是这个数：sigma8 < 0.05 → 'fail'；σ₈ 为 null = a=1 前已坍缩，同样算命中）
     实测 10000 个链上派生宇宙合计命中 1.72%（A 1.67% + B 0.05%）：既不是死代码，也不会淹掉别的画面。
     引擎不给「粒子总数」这种量，所以标注里一个具体粒子数都不写。 */
  /* 与 ui/scenes.js 的 isNearEmpty 同一份。 */
  function isNearEmpty(sim) {
    var c = sim && sim.raw && sim.raw.calc;
    if (!c || !c.baryons || !c.structure) return false;
    if (c.baryons.hasBaryons === false && c.structure.structureFormed === false) return true;
    var t = sim.outcome && sim.outcome.type, s8 = c.structure.sigma8;
    return t === 'HEAT_DEATH_NO_STRUCTURE' && (s8 == null || s8 < 0.05);
  }
  /* 冷液体宇宙的变体判据（与 ui/scenes.js 的 isOceanVariant 是同一份；两处各写一份，
     和 isNearEmpty / dimOf 一样——这两个文件之间没有共享工具模块）。
     sim.variant 由 ui/adapter.js 从引擎结果透传，引擎侧是 calc.ocean.pass（R_OCEAN 四条判据）。 */
  function isOceanVariant(sim) {
    if (!sim) return false;
    if (sim.variant === 'ocean') return true;
    var c = sim.raw && sim.raw.calc;
    return !!(c && c.ocean && c.ocean.pass);
  }
  function scene2DOnly(sim) {
    var t = sim.outcome.type;
    if (t === 'SPACE_ANNIHILATED' || t === 'NEAR_EMPTY') return true;          // blackScene
    if (sim.outcome.severity === 'void' && !/OBSERV/.test(t)) return true;     // blackScene
    if (isNearEmpty(sim)) return true;                                         // blackScene：近空宇宙（判据见上）
    if (t === 'LIQUID_OCEAN') return true;                                     // oceanScene
    /* 冷液体宇宙：结局是 NO_STARS（没有新增结局类型），变体标记由引擎的 R_OCEAN 给（engine.js calcOcean）。
       它和上面那两类一样本来就不是粒子画面——一张银色液膜加漂在上面的液滴，3D 的可观测宇宙
       （恒星/星系点云）在这里无话可说。所以 WebGL2 主路径也让给 ui/scenes.js 的 oceanScene。 */
    if (t === 'NO_STARS' && isOceanVariant(sim)) return true;                  // oceanScene
    return false;
  }
  function can3D(sim) {
    if (!ALLOW_3D || S.no3D || !U3D || !gl3d || !sim || !sim.outcome) return false;
    if (scene2DOnly(sim)) return false;
    // 能力探测只做一次并缓存：它内部要建一个 webgl2 上下文来试，每次引爆都问一遍会把
    // 浏览器的活动上下文配额耗光（Chrome 满了就回收最旧的，正在用的被吞掉 → CONTEXT_LOST）
    if (S.sup3d === undefined) { try { S.sup3d = U3D.isSupported(); } catch (e) { S.sup3d = null; } }
    var sup = S.sup3d;
    return !!(sup && sup.webgl2);   // WebGPU 优先由模块内部决定；没有 WebGL2 就退回旧 2D
  }
  // 宏观空间维数 D：引擎的 calc.dims.D（可能涌现/分数）→ report.dimension → 参数 dimS → 3
  function dimOf(sim) {
    var r = sim && sim.raw, d = r && r.calc && r.calc.dims && r.calc.dims.D;
    if (d == null && sim && sim.report && sim.report.dimension != null) d = sim.report.dimension;
    if (d == null && sim && sim.params && sim.params.dimS != null) d = sim.params.dimS;
    d = +d;
    return isFinite(d) && d > 0 ? d : 3;
  }
  function fmtD(v) { return isFinite(v) ? Number(v).toFixed(2) : '—'; }   // UI 里的 D 一律两位小数

  /* ---------------------------------------------------------- 能不能进镜像，以什么模式进
   * 镜像浏览（星系 → 恒星系 → 行星 → 地表）整条链原本只对 3 维几何成立。两级判断：
   *   1. 引擎 canEnterMirror（D≠3 时 false）——它管"物理上算不算数"；
   *   2. 引擎不放行时，再问星球模块 MirrorPlanets.supportsDim(D) → {mirror, mode}
   *      ——它管"这个维数画得出来什么"：D=2 给 2 维镜像层，D≥4 整数给只到恒星系层的轨道投影演示，
   *        非整数 / D≤1 不放行。模块没提供这个 API 时（老版本）行为不变：D≠3 一律挡住。
   * 返回 {ok, mode:'3d'|'2d'|'orbitDemo', label, limited, note}。 */
  var DIM_OUTCOMES = { BEYOND_MODEL_DIM: 1, UNSTABLE_ORBITS: 1 };   // 因维数被判出局的结局：可由 supportsDim 放行
  function dimSupport(D) {
    var P = window.MirrorPlanets;
    if (!P || typeof P.supportsDim !== 'function') return null;      // API 未落地 → 按老规矩办
    try {
      var s = P.supportsDim(D);
      if (!s || typeof s !== 'object') return null;
      // note / reason / stops 由 planets 给：UI 直接引用它自己的措辞，不另编
      return { mirror: !!s.mirror, mode: s.mode || '3d', note: s.note || '', reason: s.reason || '', stops: s.stops || '' };
    } catch (e) { console.warn('[app] supportsDim 失败', e); return null; }
  }
  var MODE_LABEL = { '2d': '观测 2 维世界（示意）', orbitDemo: '轨道投影演示' };
  function modeLabel(mode, D) {
    if (mode === '2d') return T(MODE_LABEL['2d']);
    // 整数 D≥4 是 Ehrenfest 的"无稳定圆轨道"；非整数是分数维投影——措辞跟着 planets 的两种 note 走
    if (mode === 'orbitDemo') return T('轨道投影演示（D=') + fmtD(D) + T('，') + (Math.abs(D - Math.round(D)) < 1e-6 ? T('无稳定轨道') : T('分数维')) + T('）');
    return T('进入镜像');
  }
  function mirrorPlan(sim) {
    if (!sim || !sim.outcome) return { ok: false, mode: null, label: T('进入镜像'), note: T('这个宇宙里没有可进入的镜像') };
    var t = sim.outcome.type, D = dimOf(sim);
    var flag = (sim.canEnterMirror != null) ? sim.canEnterMirror : (sim.raw ? sim.raw.canEnterMirror : null);
    var engineOK = (flag != null) ? (flag !== false) : (Math.abs(D - 3) <= 1e-6);
    if (engineOK && STAR_OUTCOMES[t]) {
      return { ok: true, mode: '3d', label: T('进入镜像'), limited: false, note: '', noLife: !!NO_LIFE_OUTCOMES[t], lifeNote: noLifeNote(sim) };
    }
    /* D<2（实测只出现 D=1 与 D=1.5）：r^{−(D−1)} 在这里是常力（D=1）或更弱的势，
       没有轨道、没有恒星系，星球模块那条 orbitDemo 路径是给 D≥4 的两体投影准备的，在这一档无话可说。
       specs/highdim-v1.md §一：「D=1/1.5 没有镜像可进，HUD 说明为什么」。
       这一条必须排在 dimSupport 之前：planets 的 supportsDim 只挡 D≤1，D=1.5 会被它放行成 orbitDemo。 */
    if (D < 2 - 1e-9 && Math.abs(D - 3) > 1e-6) {
      return { ok: false, mode: null, label: T('进入镜像'),
        note: T('空间有几个维度，我们的宇宙是 3。这个宇宙 D=') + fmtD(D) + T('：D<2 下引力是常力（D=1）或更弱的势，没有轨道、没有恒星系，也没有可进入的结构——屏幕上那张 D 维 N 体投影就是它的全部可看之物') };
    }
    // 引擎不放行：星球模块若能渲染这个维数，就以受限模式放行（结论区仍是中性的"超出模型适用范围"）
    var sup = dimSupport(D);
    if (sup && sup.mirror && (STAR_OUTCOMES[t] || DIM_OUTCOMES[t])) {
      return { ok: true, mode: sup.mode, label: modeLabel(sup.mode, D), limited: true,
        note: modeLabel(sup.mode, D) + T('：') + (sup.note ? T(sup.note) + T('；') : '') + 'D=' + fmtD(D) + T(' 的可视化只是示意，物理量仍按 3 维公式外推') +
          (sup.stops === 'system' ? T('，只画到恒星系这一层') : '') +
          // 用户会把画布上那几个亮点当成可点的行星：顶栏这一句一起说清楚
          (sup.mode === 'orbitDemo' ? T('；画面上的亮点是试探质点，不是行星，不能进入') : '') };
    }
    return { ok: false, mode: null, label: T('进入镜像'), note: mirrorBlockNote(sim, sup) };
  }
  function canMirror(sim) { return mirrorPlan(sim).ok; }
  /* 有恒星但没有生命：横幅文案取引擎 report 的原句（截到第一句），前面补一句总述。 */
  function noLifeNote(sim) {
    if (!sim || !NO_LIFE_OUTCOMES[sim.outcome.type]) return '';
    var d = String(sim.outcome.description || '').replace(/\s+/g, ' ').trim();   // 原来漏了反斜杠：/s+/ 匹配的是字母 s，会把描述里的 s 换成空格
    var dot = d.indexOf('。');
    var first = (dot > 0) ? d.slice(0, dot + 1) : d;
    if (first.length > 120) first = first.slice(0, 120) + '…';
    return T('这个宇宙有恒星与行星，但没有分子化学——行星上不会有生命，地表是无机世界。') + (first ? T('引擎报告：') + first : '');
  }
  function mirrorBlockNote(sim, sup) {
    if (!sim) return T('这个宇宙里没有可进入的镜像');
    var D = dimOf(sim);
    if (Math.abs(D - 3) > 1e-6 || (sup && !sup.mirror)) {
      return T('空间有几个维度，我们的宇宙是 3。这个宇宙 D=') + fmtD(D) + (sup && sup.reason ? T('（') + T(sup.reason) + T('）') : '') +
        T('，星系/恒星系/行星/地表可视化只对 3 维几何成立；只提供 3 维投影的 N 体盒观测');
    }
    // D=3 但结局里根本没有恒星：说清是"没有恒星"，别笼统说"没有可进入的镜像"
    return T('这个宇宙里没有恒星（结局：') + T(sim.outcome ? (sim.outcome.title || sim.outcome.type) : '') + T('），没有恒星系与行星可进；只能在 3 维投影的 N 体盒里看结构。');
  }
  /* 进不去时的说明：mirrorPlan 自己给了 note 就用它的
     （D<2 那一条说的是「没有轨道、没有恒星系」，比 planets 的 supportsDim 那句更准；
      原来这里无条件重新拼 mirrorBlockNote，把 plan 里写好的话丢掉了）。 */
  function mirrorNote(sim) { var pl = mirrorPlan(sim); return pl.note || (pl.ok ? '' : mirrorBlockNote(sim, dimSupport(dimOf(sim)))); }
  /* 结论区补一句：只在引擎报告没自己说清楚时补，且以实际可达性为准
     （D≠3 但星球模块能画 → 说"以受限模式进入"，而不是"关闭"） */
  function mirrorNoteForReport(sim, t) {
    if (!NEUTRAL_OUTCOMES[t] && Math.abs(dimOf(sim) - 3) <= 1e-6) return '';
    var pl = mirrorPlan(sim);
    if (pl.ok) return pl.note;
    return /镜像/.test(String(sim.outcome.description || '')) ? '' : pl.note;
  }
  // 超出模型适用维数的结局：不按"通过/好结局"上色，也不按"坏结局"，用中性样式
  var NEUTRAL_OUTCOMES = { BEYOND_MODEL_DIM: 1 };
  /* ---------------------------------------------------------- 有量纲常数（单位约定 A/B/C）
   * 引擎 v2.4.0 起给出 derived.cSI/GSI/hbarSI/eSI，数值取决于选哪套单位约定：
   * 固定哪三个量、让哪两个随 α/α_G 变，是约定问题，不是物理问题。
   * 跨宇宙真正不变的是无量纲量 α、α_G——这句要一直摆在旁边。 */
  var LS_UNITCONV = 'mirror.ui.unitConvention.v1';
  function unitConv() {
    var v; try { v = window.localStorage.getItem(LS_UNITCONV); } catch (e) { v = null; }
    var T = A.UNIT_CONVENTIONS;
    return (T && T[v]) ? v : 'A';
  }
  function setUnitConv(c) { try { window.localStorage.setItem(LS_UNITCONV, c); } catch (e) { /* 隐私模式 */ } }
  var DIM_KEYS = ['cSI', 'GSI', 'hbarSI', 'eSI'];
  /* exact=true 给全精度（我们的宇宙那几个是 SI 定义值：299792458、1.602176634×10⁻¹⁹…），
     否则 4 位有效数字——推导出来的值给 10 位纯属噪声 */
  function fmtSI(x, exact) {
    if (x == null || !isFinite(x)) return '—';
    if (x === Math.round(x) && Math.abs(x) < 1e15) return String(x);
    var e = Math.floor(Math.log10(Math.abs(x))), m = x / Math.pow(10, e);
    var ms = String(Number(m.toPrecision(exact ? 10 : 4))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return ms + '×10' + String(e).replace(/\d|-/g, function (ch) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+ch] || '⁻'; });
  }
  function isExactRatio(r) { return r != null && isFinite(r) && Math.abs(r - 1) < 1e-12; }
  function fmtRatio(r) {
    if (r == null || !isFinite(r)) return '';
    if (Math.abs(r - 1) < 1e-9) return T('与我们相同');
    return T('我们的 ') + (r >= 0.01 && r < 100 ? r.toFixed(2) : (r >= 100 && r < 1e4 ? String(Math.round(r)) : fmtSI(r))) + T(' 倍');
  }
  function unitsNote(sim) {
    var d = A.dimensionfulConstants(sim, unitConv());
    var base = T('有量纲常数（c、G、ħ、e）的数值取决于单位约定：固定哪三个量、让哪两个随 α 与 α_G 变，是约定不是物理。') +
      T('跨宇宙不变的物理内容是无量纲量 α=e²/(4πε₀ħc) 与 α_G=Gm_p²/(ħc)——见"零、常数由此而来"。');
    return d ? base + T('当前：') + T(d.name) + T('；') + T(d.definition) + T('。') : base;
  }
  function dimRowHTML(sim) {
    var conv = unitConv(), d = A.dimensionfulConstants(sim, conv), T = A.UNIT_CONVENTIONS || {};
    var opts = Object.keys(T).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === conv ? ' selected' : '') + '>' + esc(window.MirrorI18n ? window.MirrorI18n.t(T[k].name || k) : (T[k].name || k)) + '</option>';
    }).join('');
    var body = '';
    if (d && d.entries) {
      body = DIM_KEYS.map(function (k) {
        var e = d.entries[k]; if (!e) return '';
        return '<span class="dim-item" title="' + esc(TE(e.formula || '') + (e.ref ? (window.MirrorI18n ? window.MirrorI18n.t('　依据：') : '　依据：') + TE(e.ref) : '')) + '">' +
          '<b>' + esc(e.symbol || k) + '</b> = ' + esc(fmtSI(e.value, isExactRatio(e.ratio))) + ' ' + esc(e.unit || '') +
          '<i class="dim-ratio">（' + esc(fmtRatio(e.ratio)) + (e.fixedInConvention ? (window.MirrorI18n ? window.MirrorI18n.t(' · 本约定中固定') : ' · 本约定中固定') : '') + '）</i></span>';
      }).join('');
    } else body = '<span class="mb-dim">' + esc(window.MirrorI18n ? window.MirrorI18n.t('（引擎未提供有量纲常数）') : '（引擎未提供有量纲常数）') + '</span>';
    return '<div class="dim-row" id="anDimRow"><div class="dim-head"><span class="k">' + esc(window.MirrorI18n ? window.MirrorI18n.t('有量纲常数') : '有量纲常数') + '</span>' +
      '<select id="anUnitConv" aria-label="' + esc(window.MirrorI18n ? window.MirrorI18n.t('单位约定') : '单位约定') + '">' + opts + '</select></div>' +
      '<div class="dim-body" id="anDimBody">' + body + '</div></div>';
  }
  function rerenderDim() {
    var sim = S.sim; if (!sim) return;
    var row = $('anDimRow'); if (!row) return;
    var wrap = document.createElement('div'); wrap.innerHTML = dimRowHTML(sim);
    row.parentNode.replaceChild(wrap.firstChild, row);
    wireDimRow();
    var note = $('anUnitsNote'); if (note) note.textContent = unitsNote(sim);
    var z = $('anZeroDim'); if (z) z.innerHTML = zeroDimHTML(sim);     // 零章那四条同步
  }
  function wireDimRow() {
    var sel = $('anUnitConv');
    if (sel) sel.addEventListener('change', function () { setUnitConv(this.value); rerenderDim(); });
  }
  // 零章里的四条有量纲常数：basis 一律"计算"，并标出当前是哪套约定、本约定里它是固定还是随动
  function zeroDimHTML(sim) {
    var d = A.dimensionfulConstants(sim, unitConv());
    if (!d || !d.entries) return '';
    return DIM_KEYS.map(function (k) {
      var e = d.entries[k]; if (!e) return '';
      var val = fmtSI(e.value, isExactRatio(e.ratio)) + (e.unit ? ' ' + e.unit : '');
      return '<li class="rp-item"><div class="rp-head"><span class="rp-basis computed">' + T(BASIS_TAG.computed) + '</span>' +
        '<b>' + esc(e.symbol || k) + '</b><span class="rp-dname">' + esc(TE(e.name || '')) + '</span>' +
        '<span class="tag st-other" title="' + esc(e.status || '') + '">' + esc(T('单位约定 ')) + esc(e.convention || '') + (e.fixedInConvention ? T(' · 固定') : T(' · 随动')) + '</span>' +
        '<span class="rp-verdict val">' + esc(val) + '</span></div>' +
        '<div class="rp-grid"><span>' + esc(T('公式')) + '</span><span class="formula">' + esc(TE(e.formula || '')) + '</span>' +
        '<span>' + esc(T('相对我们')) + '</span><span>' + esc(fmtRatio(e.ratio)) + '</span></div>' +
        (e.ref ? '<p class="rp-ref">' + esc(TE(refText(e.ref))) + '</p>' : '') + '</li>';
    }).join('');
  }

  /* ---------------------------------------------------------- 操作层样式（specs/sim-ui-v1.md）
   * 写在 app.js 里而不是 index.html：三站共用同一份 app.js，样式跟着代码走，构建时不用再同步一遍。
   * 配色一律沿用既有的 --hud-*（那一族与页面主题无关，永远深底浅字）。
   * 只补一个「当前生效」的强调色 --hud-on，取的就是深色主题下的 --cyan —— 同一族里挑的，不是第二套：
   *   红（--hud-red）留给时间与能量（计时、播放），蓝紫（--hud-on）留给视图状态，两者从不混用。
   * 过渡一律 ≤200ms，并在 prefers-reduced-motion 下全部关掉。 */
  var SIM_CSS = [
    ':root{--hud-on:#8B99F5;--hud-on-bg:rgba(139,153,245,.17);--hud-on-line:rgba(139,153,245,.62)}',

    /* ---- 顶部状态行：6–7 个「标签 值」胶囊，之间是发丝竖线，不是中点串 ---- */
    '.hud-top.sim{top:32px;gap:0;padding:0 3px;align-items:stretch;font-family:var(--sans);font-size:11.5px;',
    '  border:1px solid var(--hud-line);border-radius:2px;max-width:min(1180px,94vw)}',
    '.hud-top.sim .hs{display:inline-flex;align-items:baseline;gap:6px;padding:4px 11px;',
    '  border-right:1px solid var(--hud-line);white-space:nowrap;flex:0 0 auto}',
    '.hud-top.sim .hs:last-of-type{border-right:0;padding-right:9px}',
    '.hud-top.sim .hs>i{font-style:normal;color:var(--hud-dim2);font-size:11px;letter-spacing:0}',
    '.hud-top.sim .hs>b{font-family:var(--mono);font-size:12px;font-weight:400;color:var(--hud-ink);',
    '  font-variant-numeric:tabular-nums;letter-spacing:.01em}',
    '.hud-top.sim .hs.run{flex:0 1 auto;min-width:0}',
    '.hud-top.sim .hs.run>b{color:var(--hud-red);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}',
    '.hud-i{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;margin:3px 0 3px 4px;padding:2px 9px;',
    '  border:1px solid var(--hud-line2);border-radius:2px;background:transparent;color:var(--hud-dim);',
    '  font-family:var(--sans);font-size:11.5px;line-height:1.5;cursor:pointer}',
    '.hud-i:hover{color:var(--hud-ink);border-color:var(--hud-on-line)}',
    '.hud-i[aria-expanded="true"]{color:#fff;border-color:var(--hud-on-line);background:var(--hud-on-bg)}',
    '.hud-i:focus-visible{outline:2px solid var(--hud-on);outline-offset:1px}',
    '.hi-mark{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;flex:0 0 13px;',
    '  border:1px solid currentColor;border-radius:50%;font-family:var(--mono);font-size:9px;line-height:1;font-style:italic}',
    /* 诚实标注：只剩第一段，整句在 title 与 ⓘ 里。有下文时给一个可点的小记号 */
    '.disclaim.has-more{pointer-events:auto;cursor:help}',
    '.disclaim.has-more::after{content:"…";margin-left:5px;color:var(--hud-dim2)}',

    /* ---- 右侧工具条：图标 / 短标签 / 键帽，三态分明 ---- */
    '.hud-side.rail{top:var(--rail-top,76px);bottom:auto;right:14px;display:block;',
    /* 下沿留 160px：底部时间条(52+66) 与右下角小地图(12+132) 都在那一带，工具条不许压到它们 */
    '  max-height:calc(100% - var(--rail-top,76px) - 160px);overflow-y:auto;overflow-x:hidden}',
    /* 宽度写死：不写死的话最长的那颗按钮（「轨道投影演示（D=14.00，无稳定轨道）」）会把整条拉到 290px 宽，
       一条工具条占掉五分之一屏。超出的标签省略号截断，全文在 title 上。 */
    '.rail-box{pointer-events:auto;display:flex;flex-direction:column;gap:1px;width:176px;padding:4px;',
    '  background:var(--hud-panel);border:1px solid var(--hud-line);border-radius:2px}',
    '.rail-b{display:flex;align-items:center;gap:9px;width:100%;padding:6px 7px;background:transparent;border:0;',
    '  border-radius:2px;color:var(--hud-ink);font-family:var(--sans);font-size:12px;line-height:1.25;',
    '  text-align:left;cursor:pointer;transition:background .12s}',
    '.rail-i{flex:0 0 14px;display:block;width:14px;height:14px;color:var(--hud-dim)}',
    '.rail-i svg{display:block;width:14px;height:14px}',
    '.rail-t{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.rail-k{flex:0 0 auto;min-width:16px;padding:1px 4px;border:1px solid var(--hud-line);border-radius:2px;',
    '  font-family:var(--mono);font-size:10px;line-height:1.3;color:var(--hud-dim2);text-align:center}',
    '.rail-k.blank{border-color:transparent;color:transparent}',
    /* 占位键帽在「当前生效」态下也必须继续隐形，否则按下的那几行右边会多出一条描边 */
    '.rail-b[aria-pressed="true"] .rail-k.blank{border-color:transparent;color:transparent}',
    '.rail-b:hover{background:var(--hud-panel2)}',
    '.rail-b:hover .rail-i{color:var(--hud-ink)}',
    '.rail-b[aria-pressed="true"]{background:var(--hud-on-bg);color:#FFFFFF;box-shadow:inset 2px 0 0 var(--hud-on)}',
    '.rail-b[aria-pressed="true"] .rail-i{color:var(--hud-on)}',
    '.rail-b[aria-pressed="true"] .rail-k{border-color:var(--hud-on-line);color:#DFE4FF}',
    '.rail-b:disabled{color:var(--hud-dim2);cursor:not-allowed;background:transparent}',
    '.rail-b:disabled .rail-i{color:var(--hud-line2)}',
    '.rail-b:disabled:hover{background:transparent}',
    '.rail-b:focus-visible{outline:2px solid var(--hud-on);outline-offset:-2px}',
    '.rail-sep{height:1px;margin:4px 2px;background:var(--hud-line)}',
    '.rail-b.go{margin-top:2px;border:1px solid var(--hud-line2);background:var(--hud-panel2)}',
    '.rail-b.go .rail-i{color:var(--hud-on)}',
    '.rail-b.go:hover{border-color:var(--hud-on-line)}',
    '.rail-b.go:disabled{border-color:var(--hud-line)}',

    /* ---- 底栏：播放 / 刻度 / 当前时刻 / 回到进入时刻，右端一句膨胀史 ---- */
    '.hud-bottom.sim{left:14px;right:162px;bottom:52px;gap:6px}',
    '.hud-bottom.sim .hud-time{margin:0;gap:10px;justify-content:flex-start;flex-wrap:nowrap;align-items:center;',
    '  padding:5px 8px;background:var(--hud-panel);border:1px solid var(--hud-line);border-radius:2px;pointer-events:auto}',
    '.hud-bottom.sim .hud-time input[type=range]{flex:1 1 auto;width:auto;min-width:110px}',
    '.hud-bottom.sim .hud-tval{flex:0 0 auto;min-width:7.2em;font-size:12px}',
    '.hud-bottom.sim .hud-btn{flex:0 0 auto}',
    '.hud-bottom.sim .hud-btn.play{min-width:4.4em;text-align:center}',
    '.hud-bottom.sim .hud-tnote{display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;margin-left:auto;',
    '  padding:2px 8px;border:1px solid transparent;border-radius:2px;background:transparent;color:var(--hud-dim);',
    '  font-family:var(--sans);font-size:11px;cursor:pointer;white-space:nowrap}',
    '.hud-bottom.sim .hud-tnote:hover{color:var(--hud-ink);border-color:var(--hud-line2)}',
    '.hud-bottom.sim .hud-tnote .tn-t{overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.hud-bottom.sim .hud-hints{justify-content:flex-end}',
    /* 年龄大数字缩一号：3D 里它和底栏离得很近，30px 会把时间条压住 */
    '#app.space-ui .timer{font-size:22px}',
    '#app.space-ui .timer .unit{font-size:10.5px}',

    /* ---- ⓘ 详情浮层 ---- */
    '.hud-info{position:absolute;left:0;top:0;right:0;bottom:0;z-index:58;display:flex;align-items:flex-start;',
    '  justify-content:center;padding:58px 16px 16px;background:rgba(4,5,10,.52)}',
    '.hud-info[hidden]{display:none}',
    '.hi-panel{width:min(680px,100%);max-height:100%;overflow:auto;background:var(--hud-panel2);',
    '  border:1px solid var(--hud-line2);border-radius:2px;box-shadow:0 18px 60px rgba(0,0,0,.5)}',
    '.hi-head{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:9px 12px;',
    '  background:var(--hud-panel2);border-bottom:1px solid var(--hud-line)}',
    '.hi-title{flex:1;font-family:var(--sans);font-size:13px;color:var(--hud-ink)}',
    '.hi-x{background:transparent;border:0;color:var(--hud-dim);font-size:18px;line-height:1;cursor:pointer;padding:0 4px}',
    '.hi-x:hover{color:var(--hud-ink)}',
    '.hi-body{padding:2px 12px 14px}',
    '.hi-row{display:grid;grid-template-columns:5.4em 1fr;gap:8px 14px;padding:9px 0;border-bottom:1px solid var(--hud-line)}',
    '.hi-row:last-child{border-bottom:0}',
    '.hi-k{font-family:var(--sans);font-size:11.5px;color:var(--hud-dim2);padding-top:2px}',
    '.hi-v p{margin:0 0 5px;font-family:var(--sans);font-size:12.5px;line-height:1.75;color:var(--hud-ink);max-width:64ch}',
    '.hi-v p:last-child{margin-bottom:0}',
    '.hi-row.num .hi-v p{font-family:var(--mono);font-size:11.5px;font-variant-numeric:tabular-nums}',

    /* ---- 左侧抽屉：装的是 ui/hyper.js 的 .hy-panel，这里只摆位置、开合与配色统一 ---- */
    '#app>.hy-panel{left:14px;top:var(--rail-top,76px);z-index:22;width:min(340px,calc(100vw - 28px));max-width:none;',
    '  padding:0 0 9px;background:var(--hud-panel);border:1px solid var(--hud-line);border-radius:2px;',
    '  font-family:var(--sans);color:var(--hud-ink);',
    '  transform:translateX(calc(-100% - 22px));opacity:0;pointer-events:none;',
    '  transition:transform .18s ease,opacity .18s ease}',
    '#app.drawer-on>.hy-panel{transform:none;opacity:1;pointer-events:auto}',
    '#app>.hy-panel .hy-head{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--hud-line)}',
    '#app>.hy-panel .hy-head-t{flex:1;font-family:var(--sans);font-size:12px;color:var(--hud-ink)}',
    '#app>.hy-panel .hy-head-x{background:transparent;border:0;color:var(--hud-dim);font-size:17px;line-height:1;cursor:pointer;padding:0 2px}',
    '#app>.hy-panel .hy-head-x:hover{color:var(--hud-ink)}',
    '#app>.hy-panel .hy-row{margin:0;padding:7px 10px 0}',
    '#app>.hy-panel .hy-row .hy-row{padding:0}',
    '#app>.hy-panel .hy-t{color:var(--hud-dim2);font-family:var(--sans);font-size:11px}',
    '#app>.hy-panel .hy-b{color:var(--hud-ink);background:transparent;border:1px solid var(--hud-line2);',
    '  border-radius:2px;padding:2px 7px;font-family:var(--mono);font-size:11px;min-width:24px}',
    '#app>.hy-panel .hy-b:hover{background:var(--hud-panel2);border-color:var(--hud-on-line)}',
    '#app>.hy-panel .hy-b[aria-pressed="true"],#app>.hy-panel .hy-b.slot{background:var(--hud-on-bg);',
    '  border-color:var(--hud-on-line);color:#FFFFFF}',
    '#app>.hy-panel .hy-note{margin:9px 0 0;padding:8px 10px 0;border-top:1px solid var(--hud-line);',
    '  color:var(--hud-dim);font-family:var(--sans);font-size:11px;line-height:1.7}',
    '#app>.hy-panel input[type=range]{width:96px;accent-color:var(--hud-on)}',

    /* ---- ≤900px：工具条变底部横向滚动条，抽屉从下面推上来，状态行只留区块 / D / fps ---- */
    '@media (max-width:900px){',
    /* 窄屏顶部三层各自占一条：标注 6–24 / 状态行 28–56 / 年龄 62–。
       标注在 index.html 的 820px 断点里会变成可换行，三行一铺就把状态行和年龄全糊住了，这里按回一行。 */
    '  #app .disclaim{top:6px;white-space:nowrap;max-width:calc(100vw - 16px)}',
    '  .hud-top.sim{top:28px;max-width:calc(100vw - 16px);font-size:11px}',
    '  .hud-top.sim .hs{padding:4px 8px}',
    '  .hud-top.sim .hs.hide-s{display:none}',
    /* 揭开之后那条常驻提示是 universe3d 画的，默认 max-width:44%，375px 上会被挤成六行 */
    '  #app .u3d-veil-tip{left:8px;right:8px;max-width:none;bottom:142px}',
    /* 小地图（universe3d 的 .u3d-mini）默认钉在右下 12,12，窄屏上正好压住横排工具条与时间条。
       抬到工具条上方去；它是只读的小图，挡一点画布没关系，挡住按钮不行。 */
    '  .u3d-ov .u3d-mini{right:8px;bottom:142px;width:96px;height:96px}',
    '  .hud-side.rail{left:8px;right:8px;top:auto;bottom:92px;max-height:none;overflow:visible}',
    '  .rail-box{flex-direction:row;width:auto;gap:2px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}',
    '  .rail-box::-webkit-scrollbar{display:none}',
    '  .rail-b{width:auto;flex:0 0 auto;padding:7px 9px;gap:6px}',
    '  .rail-b .rail-k{display:none}',
    '  .rail-b.go{margin-top:0}',
    '  .rail-sep{flex:0 0 1px;width:1px;height:auto;min-height:22px;margin:0 3px}',
    '  .hud-bottom.sim{left:8px;right:8px;bottom:8px}',
    '  .hud-bottom.sim .hud-time{flex-wrap:wrap;gap:8px}',
    '  .hud-bottom.sim .hud-tval{min-width:6em}',
    '  .hud-bottom.sim .hud-tnote{margin-left:0}',
    '  #app.space-ui .timer{left:10px;bottom:auto;top:62px;font-size:17px}',
    '  #app>.hy-panel{left:8px;right:8px;top:auto;bottom:0;width:auto;max-height:64vh;overflow:auto;',
    '    border-bottom:0;transform:translateY(calc(100% + 24px))}',
    '  #app.drawer-on>.hy-panel{transform:none}',
    '  .hud-info{padding:44px 8px 8px}',
    '  .hi-panel{width:100%}',
    '  .hi-row{grid-template-columns:1fr;gap:3px}',
    '}',
    '@media (max-width:640px){.hud-top.sim .hs.hide-xs{display:none}}',
    '@media (prefers-reduced-motion:reduce){#app>.hy-panel,.rail-b{transition:none}}'
  ].join('');
  var SIM_CSS_DONE = false;
  function simUICss() {
    if (SIM_CSS_DONE || !document.head) return;
    SIM_CSS_DONE = true;
    var st = document.createElement('style');
    st.id = 'simUICss';
    st.textContent = SIM_CSS;
    document.head.appendChild(st);
    // 标注被截短时它带 .has-more：点一下把整句摊开（title 里也有一份，鼠标悬停就能读）
    if (disclaimEl) disclaimEl.addEventListener('click', function () {
      if (disclaimEl.className.indexOf('has-more') >= 0 && S.state === 'space') setInfoOpen(true);
    });
  }

  /* ---------------------------------------------------------- 合并后的单一 HUD（specs/sim-ui-v1.md）
   * universe3d 用 hud:'minimal' 只留小地图与恒星标签，其余全部由这里画，避免两套控件并存。
   * 三条边各管一件事：顶中一行可扫读的量 · 右侧一条工具条 · 底部一条时间轴；
   * 投影相关的东西全部收进左侧抽屉——那块面板是 ui/hyper.js 自己画的 .hy-panel，
   * 这里只负责「摆在哪、怎么开合」，一行它的 JS 都不碰。
   * 顶部原来那条 200 字的说明一个字不删，搬进「ⓘ 详情」浮层分行显示（见 infoRows）。
   * 按钮按下态由 u.getState() 回读（overview / orbit / volume / exposureAuto / lowPower）。 */

  /* 工具条图标：14×14 线稿，stroke 走 currentColor，随三态变色。
     用 SVG 不用字形符号（▣ ◎ ✦ 这类），是因为它们在中文字体里宽度与基线各家不同，排成一列会歪。 */
  var RAIL_ICON = {
    analysis: '<path d="M1.8 2.4h12.4v11.2H1.8z"/><path d="M5 11.2V7.4M8 11.2V5M11 11.2V9.2"/>',
    proj: '<path d="M2.2 2.2h6.4v6.4H2.2z"/><path d="M7.4 7.4h6.4v6.4H7.4z"/>',
    overview: '<path d="M8 1.7 14.3 5 8 8.3 1.7 5z"/><path d="M1.7 8.3 8 11.6l6.3-3.3"/>',
    orbit: '<ellipse cx="8" cy="8" rx="6.5" ry="3"/><circle cx="8" cy="8" r="1.7"/>',
    fly: '<circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5"/>',
    halo: '<circle cx="8" cy="8" r="6.2"/><circle cx="6.4" cy="6.9" r=".85"/><circle cx="9.7" cy="6.2" r=".7"/><circle cx="8.8" cy="9.9" r=".8"/><circle cx="5.9" cy="10.1" r=".6"/>',
    star: '<path d="M8 1.5 9.5 6.5 14.5 8 9.5 9.5 8 14.5 6.5 9.5 1.5 8 6.5 6.5z"/>',
    volume: '<path d="M8 1.7 14.3 5v6L8 14.3 1.7 11V5z"/><path d="M4.7 8h6.6"/>',
    exposure: '<circle cx="8" cy="8" r="6.3"/><path d="M8 1.7v6.3h6.3"/>',
    power: '<path d="M8 1.7v5.5"/><path d="M4.4 4a5.1 5.1 0 1 0 7.2 0"/>',
    compare: '<circle cx="5.9" cy="8" r="4.5"/><circle cx="10.1" cy="8" r="4.5"/>',
    grid: '<path d="M2.2 2.2h11.6v11.6H2.2z"/><path d="M2.2 6.1h11.6M2.2 9.9h11.6M6.1 2.2v11.6M9.9 2.2v11.6"/>',
    enter: '<path d="M6.8 2.4h7v11.2h-7"/><path d="M2.2 8h6.6"/><path d="m6.2 5.3 2.8 2.7-2.8 2.7"/>'
  };
  function railIcon(k) {
    return '<span class="rail-i" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round">' + (RAIL_ICON[k] || '') + '</svg></span>';
  }
  /* 一行 = 图标 / 标签 / 键帽。三态：可用 / 当前生效（aria-pressed=true，强调色底）/ 不可用（disabled + title 说明为什么）。
     快捷键做成键帽，不再写在标签的括号里——括号里的字每一颗按钮都要读一遍，键帽扫一眼就过。 */
  function railHTML(items) {
    return '<div class="rail-box">' + items.map(function (it) {
      if (it === '-') return '<div class="rail-sep" aria-hidden="true"></div>';
      return '<button type="button" class="rail-b' + (it.cls ? ' ' + it.cls : '') + '" id="' + it.id + '"' +
        ' title="' + esc(T(it.label)) + (it.key ? T('（') + esc(it.key) + T('）') : '') + '">' +
        railIcon(it.icon) + '<span class="rail-t">' + esc(T(it.label)) + '</span>' +
        (it.key ? '<kbd class="rail-k">' + esc(it.key) + '</kbd>' : '<span class="rail-k blank" aria-hidden="true"></span>') +
        '</button>';
    }).join('') + '</div>';
  }
  // 只改标签文字，不动图标与键帽（对整颗按钮用 textContent 会把它们一起冲掉）
  function railText(id, label) {
    var b = $(id); if (!b) return;
    var t = b.querySelector('.rail-t');
    if (t) t.textContent = T(label);
    if (!b.disabled) b.title = T(label);          // 标签被省略号截掉时，全文还在 title 上
  }
  function railRelabel(items) { items.forEach(function (it) { if (it !== '-') railText(it.id, it.label); }); }

  /* 状态行：6–7 个「标签 + 值」的小胶囊，值等宽、标签正文，胶囊之间是一条发丝竖线。
     原来是一条中点串，全等宽、无层次，2000px 宽屏上还会被截断。
     #hTid / #hTrun / #hTback 三个 id 留着不改名：宿主别处（onStatus、切语言）按 id 找它们。 */
  function statCap(id, label, cls) {
    return '<span class="hs' + (cls ? ' ' + cls : '') + '">' +
      (label ? '<i>' + esc(T(label)) + '</i>' : '') + '<b id="' + id + '">—</b></span>';
  }
  /* 必须是函数不能是常量：脚本加载那一刻 i18n-app 分册还没装上（它在页尾），
     常量会把中文烙死，英文态里「粒子 / 后端 / 详情」就永远不翻（09-17 用户截图）。 */
  function hudTopHTML() {
    return '<span class="hs id"><b id="hTid"></b></span>' +
    // hide-s：≤900px 收起（粒子 / 后端 / 实时演化）；hide-xs：≤640px 再收 a，只剩区块 / D / fps
    statCap('hsD', 'D') + statCap('hsA', 'a', 'hide-xs') + statCap('hsN', '粒子', 'hide-s') +
    statCap('hTback', '后端', 'hide-s') + statCap('hsFps', 'fps') +
    '<span class="hs run hide-s"><b id="hTrun">—</b></span>' +
    '<button type="button" class="hud-i" id="hudInfo" aria-expanded="false" aria-controls="hudInfoBox">' +
    '<span class="hi-mark" aria-hidden="true">i</span><span class="hi-lab">' + esc(T('详情')) + '</span></button>';
  }
  function backendLabel(st) {
    var m = String((st && st.mode) || '?');
    return m === 'webgpu' ? 'WebGPU' : m === 'webgl2' ? 'WebGL2' : m === 'cpu' ? T('Worker CPU') : m;
  }

  /* ---------------------------------------------------------- ⓘ 详情
   * 顶部那条说明（u.getState().label）是一整句「这是什么 · 怎么算 · 怎么标注」混在一起的话。
   * 这里**一个字都不删**，只按 · 切开分到几行里；分不进已知分类的段落进「补充」，
   * 所以任何一句新写的说明都不会在搬家途中丢掉。另加一块「此刻」放从状态行挪下来的量。 */
  /* 分类的顺序就是判定的顺序，谁先命中算谁的。
     「初始扰动」必须排在「依据等级」前面：那句 δ_rms 里带着「D≥4 下引力不放大它」，
     两边的关键词都沾得上，但它讲的是初态，不是依据。
     第一段不参与分类——按 label() 的写法，它永远是「这是什么」。 */
  var INFO_BUCKETS = [
    ['初始扰动', /初始扰动|平面波|扰动模|δ_rms|涨落|格点|均匀的/],
    ['依据等级', /Ehrenfest|Tegmark|直接积分|不是外推|束缚结构|常力|对数势|进动|轨道稳定|不会聚成团|直接后果/],
    ['怎么算', /N 体|直接求和|WebGPU|Worker CPU|软化长度|步长|泊松核|显卡性能|单批预算|N=|PM/],
    ['投影', /投影|色相|颜色|亮度|切片|厚度|保留|整盒|预设|三根轴|折进/]
  ];
  var INFO_ORDER = ['这是什么', '此刻', '怎么算', '投影', '初始扰动', '时间轴', '依据等级', '补充'];
  function infoRows(sim, st) {
    var rows = {}, order = [];
    function put(k, line) {
      if (!line) return;
      if (!rows[k]) { rows[k] = []; order.push(k); }
      rows[k].push(line);
    }
    var segs = String((st && st.label) || '').split(/\s*·\s*/)
      .map(function (s) { return s.replace(/^[\s　]+|[\s　]+$/g, ''); }).filter(Boolean);
    segs.forEach(function (seg, idx) {
      if (idx === 0) { put('这是什么', seg); return; }
      for (var i = 0; i < INFO_BUCKETS.length; i++) if (INFO_BUCKETS[i][1].test(seg)) { put(INFO_BUCKETS[i][0], seg); return; }
      put('补充', seg);
    });
    if (st) {
      put('此刻', T('距大爆炸 ') + A.fmtTimeGyr(st.t) + (st.contracting ? T('（收缩中）') : ''));
      put('此刻', 'a=' + st.a.toFixed(3) + ' · z=' + (isFinite(st.z) ? st.z.toFixed(2) : '—'));
      put('此刻', T('盒长 ') + ((st.scale && st.scale.boxMpcOverH) || '?') + ' Mpc/h');
      var yps = st.yearsPerSecond;
      put('此刻', st.running
        ? T('▶ 实时演化 ≈ ') + (isFinite(yps) ? A.fmtTimeGyr(yps / 1e9) : '—') + T('/秒')
        : T('⏸ 已暂停'));
      put('此刻', (st.N || 0).toLocaleString('en-US') + T(' 粒子 · ') + backendLabel(st) + ' · ' + st.fps + ' fps');
    }
    if (sim) {
      var tOne = sim.raw && sim.raw.cosmology && sim.raw.cosmology.events && sim.raw.cosmology.events.tOneGyr;
      put('时间轴', fateEnd(sim).label + (tOne ? T(' · a=1（“今天”）在 ') + A.fmtTimeGyr(tOne) : '') + T(' · 拖动可推到未来，回拨则重算'));
      put('时间轴', pathHint(sim));
    }
    return INFO_ORDER.filter(function (k) { return rows[k]; }).map(function (k) { return [k, rows[k]]; })
      .concat(order.filter(function (k) { return INFO_ORDER.indexOf(k) < 0; }).map(function (k) { return [k, rows[k]]; }));
  }
  function ensureInfoBox() {
    var box = $('hudInfoBox');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'hudInfoBox'; box.className = 'hud-info'; box.hidden = true;
    box.innerHTML = '<div class="hi-panel" role="dialog" aria-modal="false" aria-label="' + esc(T('这一屏在算什么')) + '">' +
      '<div class="hi-head"><span class="hi-title" id="hiTitle">' + esc(T('这一屏在算什么')) + '</span>' +
      '<button type="button" class="hi-x" id="hiClose" aria-label="' + esc(T('关闭')) + '">×</button></div>' +
      '<div class="hi-body" id="hiBody"></div></div>';
    (document.getElementById('app') || document.body).appendChild(box);
    box.addEventListener('click', function (e) { if (e.target === box) setInfoOpen(false); });
    var x = box.querySelector('#hiClose'); if (x) x.addEventListener('click', function () { setInfoOpen(false); });
    return box;
  }
  var INFO = { sig: '' };
  function paintInfo(sim, st, force) {
    var box = $('hudInfoBox'); if (!box || box.hidden) return;
    var rows = infoRows(sim, st);
    var sig = rows.map(function (r) { return r[0] + '|' + r[1].join('|'); }).join('||');
    if (!force && sig === INFO.sig) return;
    INFO.sig = sig;
    var body = box.querySelector('#hiBody'); if (!body) return;
    body.innerHTML = rows.map(function (r) {
      return '<div class="hi-row' + (r[0] === '此刻' ? ' num' : '') + '"><span class="hi-k">' + esc(T(r[0])) + '</span><div class="hi-v">' +
        r[1].map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div></div>';
    }).join('');
  }
  function setInfoOpen(on) {
    var box = ensureInfoBox(), b = $('hudInfo');
    S.infoOpen = !!on;
    box.hidden = !on;
    if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) {
      var st = null; try { st = S.u3d && S.u3d.getState(); } catch (e) { /* 还没就绪 */ }
      INFO.sig = ''; paintInfo(S.sim, st, true);
    }
  }

  /* ---------------------------------------------------------- 左侧抽屉（投影）
   * 抽屉里装的就是 ui/hyper.js 自己画的 .hy-panel（轴按钮 / 切片 / 重置视角 / 可见模说明）。
   * 那块 DOM 归它管，这里只做三件事：摆位置、开合、在最上面补一条标题栏（补一次，不重建）。 */
  function drawerEl() {
    var a = $('app'); if (!a) return null;
    var kids = a.children, i;
    for (i = 0; i < kids.length; i++) if (String(kids[i].className || '').indexOf('hy-panel') >= 0) return kids[i];
    return null;
  }
  function drawerReady() { var p = drawerEl(); return !!(p && !p.hidden); }
  function decorateDrawer() {
    var p = drawerEl();
    if (!p || p.getAttribute('data-simui')) return p;
    p.setAttribute('data-simui', '1');
    var h = document.createElement('div'); h.className = 'hy-head';
    var t = document.createElement('span'); t.className = 'hy-head-t'; t.id = 'hyHeadT'; t.textContent = T('投影');
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'hy-head-x'; x.textContent = '×';
    x.setAttribute('aria-label', T('收起'));
    x.addEventListener('click', function (e) { e.stopPropagation(); setDrawer(false); });
    h.appendChild(t); h.appendChild(x);
    p.insertBefore(h, p.firstChild);
    return p;
  }
  function setDrawer(on) {
    var a = $('app'); if (!a) return;
    if (on) { decorateDrawer(); if (!drawerReady()) { toast(T('这一屏没有可换的投影轴'), 2600); return; } }
    if (a.classList) a.classList.toggle('drawer-on', !!on);
    S.drawerOpen = !!on;
    setPressed('hudProj', !!on);
  }

  /* 右上角那张宇宙卡（#bnbMintHud，arc-ui.js 画的）高度会变：工具条从它下面开始排，
     两边都别去抢右上角。量一次写进 --rail-top，状态行同步时顺手对一次就够。 */
  function railTop() {
    var a = $('app'); if (!a || !a.style) return;
    if (a.classList) a.classList.add('space-ui');       // 年龄大数字缩一号只在太空视图里生效
    var card = document.getElementById('bnbMintHud'), top = 76;
    if (card && !card.hidden && String(card.className || '').indexOf('hud-away') < 0) {
      try {
        var r = card.getBoundingClientRect(), ar = a.getBoundingClientRect();
        if (r.height > 0) top = Math.max(top, Math.round(r.bottom - ar.top) + 10);
      } catch (e) { /* 量不到就用默认值 */ }
    }
    if (S.railTop !== top) { S.railTop = top; a.style.setProperty('--rail-top', top + 'px'); }
  }

  /* 旧的 hudGroup（带组标题的分组按钮盒）已经没人用了：两条 HUD 路径都改走 railHTML。
     它那套样式（.hud-grp / .hud-grp-t）还留在 index.html 里，别的页面没引用，下次清理底稿时一起删。 */
  /* 底部那条折叠的快捷键提示：默认只露「？帮助」，展开才铺开整句。
     「重看新手引导」也放这里——规格要求 ? 帮助里能重看（web/tour.js 缺席时这颗按钮不出现）。 */
  function hudHintsHTML(txt) {
    var tour = (window.MirrorTour && window.MirrorTour.start)
      ? '<button type="button" class="hud-btn" id="hudTour">' + esc(T('重看新手引导')) + '</button>' : '';
    /* 卡顿报告不再自动弹（09-17 用户：「假死报告页面不要默认弹出」）：有记录时这里多一颗小按钮，点了才开那条。 */
    var stall = wdHasSnap() ? '<button type="button" class="hud-btn" id="hudStall">' + esc(T('卡顿报告')) + '</button>' : '';
    return '<div class="hud-hints" id="hudHints"><button type="button" class="hud-btn" id="hudHelp" aria-expanded="false">' + esc(T('？帮助')) + '</button>' +
      tour + stall + '<span class="hud-hint-txt" id="hudHintTxt">' + esc(txt) + '</span></div>';
  }
  function wdHasSnap() { try { return !!localStorage.getItem(WD.KEY); } catch (e) { return false; } }
  function wireHints() {
    var h = $('hudHelp'), box = $('hudHints'), tb = $('hudTour'), sb = $('hudStall');
    if (tb) tb.addEventListener('click', function () { try { window.MirrorTour.start(true); } catch (e) { /* 引导缺席 */ } });
    if (sb) sb.addEventListener('click', function () { try { var prev = localStorage.getItem(WD.KEY); if (prev) wdBar(JSON.parse(prev)); } catch (e) { /* ignore */ } });
    if (!h || !box) return;
    h.addEventListener('click', function () {
      var open = box.className.indexOf('open') < 0;
      box.className = 'hud-hints' + (open ? ' open' : '');
      h.setAttribute('aria-expanded', String(open));
      h.textContent = open ? T('收起帮助') : T('？帮助');
    });
  }
  function setPressed(id, on) { var b = $(id); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  // 状态行与按钮三态：3D 每 0.25 s 刷一次。挪进 ⓘ 的那几个量（距大爆炸 / z / 盒长）由 infoRows 负责
  function hudSync3D(sim, st) {
    var e;
    if ((e = $('hsD'))) e.textContent = fmtD(st.dimS != null ? st.dimS : dimOf(sim));
    if ((e = $('hsA'))) e.textContent = st.a.toFixed(3) + (st.contracting ? T('（收缩中）') : '');
    if ((e = $('hsN'))) e.textContent = (st.N || 0).toLocaleString('en-US');
    if ((e = $('hsFps'))) e.textContent = String(st.fps);
    if ((e = $('hTback'))) e.textContent = backendLabel(st);
    if ((e = $('hTrun'))) {
      var yps = st.yearsPerSecond;
      // 就绪前这颗胶囊被 onStatus 借去放进度串；就绪后只放一个短的演化速率，整句在 ⓘ 里
      e.textContent = st.running
        ? T('▶ ') + (isFinite(yps) ? A.fmtTimeGyr(yps / 1e9) : '—') + T('/秒')
        : T('⏸ 已暂停');
    }
    setPressed('hudOverview', st.overview); setPressed('hudOrbit', st.orbit);
    setPressed('hudVol', st.volume); setPressed('hudExp', st.exposureAuto); setPressed('hudLow', st.lowPower);
    /* 投影抽屉：遮罩盖着 / 标签关掉的时候 hyper.js 会把 .hy-panel 收起来，
       这一刻没有轴可换——入口按钮跟着变灰并说清为什么，已经拉开的也收回去。 */
    var pb = $('hudProj');
    if (pb) {
      var ok = drawerReady();
      pb.disabled = !ok;
      pb.title = ok ? T('投影') + T('（') + 'P' + T('）') : T('先揭开这一屏，才能挑投影轴');
      if (!ok && S.drawerOpen) setDrawer(false);
    }
    setPressed('hudProj', !!S.drawerOpen);
    // 分析面板：按下态与文案都跟着面板开合走（和右键菜单里那一项一致）
    setPressed('hudAnalysis', S.analysisOpen);
    railText('hudAnalysis', S.analysisOpen ? '关闭分析面板' : '分析面板');
    if (S.infoOpen) paintInfo(sim, st, false);
    railTop();
  }

  /* ---------------------------------------------------------- 宇宙时间控制（时间不止于 a=1）
   * HUD 里一条对数刻度的滑块 + 播放/暂停：a=1（"今天"）之后还能继续推到未来，也能回拨到过去。
   * 终点取引擎 fate：大挤压 → 坍缩时刻；永恒膨胀/热寂 → 10³ Gyr。
   * 3D 视图直接调 u.setTime(tGyr)；旧的 2D 粒子网靠多跑几步追时刻（回拨 = 按初始条件重算，粒子模拟不能倒放）。 */
  /* 底栏只留播放 / 刻度 / 当前时刻 / 回到进入时刻。膨胀史那一句原来铺在底栏第二行，
     现在收成右端一颗按钮（只留「膨胀史：永恒膨胀」这半句），整句在 ⓘ 详情的「时间轴」一行里。 */
  /* 同 hudTopHTML：分册在页尾才装，常量会把中文烙死，做成函数 */
  function timeHudHTML() { return '<div class="hud-time">' +
    '<button type="button" class="hud-btn play" id="hudPlay" aria-pressed="true">' + esc(T('暂停')) + '</button>' +
    '<input type="range" id="hudTime" min="0" max="1000" step="1" value="0" aria-label="' + esc(T('宇宙时间（对数刻度）')) + '">' +
    '<span class="hud-tval" id="hudTVal">—</span>' +
    '<button type="button" class="hud-btn" id="hudNow">' + esc(T('回到进入时刻')) + '</button>' +
    '<button type="button" class="hud-tnote" id="hudTNote" aria-controls="hudInfoBox"></button></div>'; }
  /* 时间轴末端说的是 **Friedmann 膨胀史的终点**（永恒膨胀 / 大挤压 / 大撕裂），
     不是这个宇宙的 outcome（无稳定轨道 / 没有原子 / 可能诞生观察者…）。
     这两件事原来都叫"引擎结局"：D=14 的宇宙时间轴上写着"引擎结局：永恒膨胀"，
     而同一屏的宇宙卡与分析面板写着"结局：无稳定轨道 / 无稳定原子"——同一个词指两件事，
     看上去就是自相矛盾。这里改口径：时间轴只说"膨胀史"，"结局"这个词留给 outcome。 */
  function fateEnd(sim) {
    var raw = sim.raw || {}, f = raw.fate || (raw.cosmology && raw.cosmology.fate) || null;
    if (f && f.type === 'crunch' && isFinite(f.tGyr) && f.tGyr > 0) return { t: f.tGyr, label: T('膨胀史：大挤压于 ') + A.fmtTimeGyr(f.tGyr) };
    return { t: 1e3, label: T('膨胀史：') + ((f && f.type === 'rip') ? T('大撕裂') : T('永恒膨胀')) + T(' · 刻度到 10³ Gyr') };
  }
  // a → 宇宙时间（Gyr）：优先用引擎积出来的 t(a)，没有就按辐射后的幂律兜底
  function tOfA(sim, a) {
    var f = sim && sim.raw && sim.raw.cosmology && sim.raw.cosmology.tOfA;
    if (typeof f === 'function') { try { var v = f(a); if (v != null && isFinite(v) && v > 0) return v; } catch (e) { /* 落回兜底 */ } }
    return (sim.enterTimeGyr || 13.8) * Math.pow(Math.max(1e-6, a), 1.5);
  }
  /* 播放/暂停只有一个状态源：按钮、空格键、模块内部的 running 三者走同一条路。
   * 关键坑：universe3d 的 worker 跑到 targetT / targetA 就发 idle 并把 running 置 false；
   * 此时再调 u.start() 只是把同一个"已经到达的目标"重新发一遍，worker 立刻又停——按钮看着没反应。
   * 所以"播放"必须先把目标推到当前时刻之前方（setTime 内部会 start），而不是裸调 start()。
   * 初始 targetA=1，所以每个宇宙走到 a=1 都会停在这个状态里，正是用户遇到的那次。 */
  function play3D(u, sliderT, tMax) {
    var st = null;
    try { st = u.getState(); } catch (e) { /* 还没就绪 */ }
    if (!st || !st.ready) { try { u.start(); } catch (e2) { console.warn('[app] u3d start', e2); } return; }
    var aStop = (u._S && u._S.aStop) || 8;
    if (st.a >= aStop * 0.999) { toast(T('已到 N 体盒的尺度上限（a=') + Math.round(aStop) + T('：共动盒长大 ') + Math.round(aStop) + T(' 倍），不能再往前推'), 3600); return; }
    var cur = st.t;
    // 滑块平时是跟着模拟时刻走的，所以"滑块值≈当前时刻"要当成"没有目标"：
    // 一格约 1.4%（1000 格跨 6 个数量级），只有超出 3% 才算用户真的指定了一个前方的时刻，
    // 否则按"继续跑"处理——把目标推到 fate 终点（滑块末端），不然点了播放只往前挪一格就又停。
    var want = (sliderT != null && sliderT > cur * 1.03) ? sliderT : Math.max(tMax || 0, cur * 1.5);
    try { u.setTime(Math.max(want, cur * 1.03)); } catch (e3) { console.warn('[app] u3d setTime', e3); }
  }
  function wireTimeHUD(sim, drv) {
    var rng = $('hudTime'), val = $('hudTVal'), play = $('hudPlay'), btnNow = $('hudNow'), note = $('hudTNote');
    if (!rng || !val || !play) return null;
    var end = fateEnd(sim), now = sim.enterTimeGyr || 13.8;
    var tMin = 1e-3, tMax = Math.max(end.t, now * 1.5), LG = Math.log(tMax / tMin), dragging = false;
    function tOf(v) { return tMin * Math.exp(LG * (Math.max(0, Math.min(1000, +v)) / 1000)); }
    function vOf(t) { return String(Math.round(1000 * Math.log(Math.max(tMin, Math.min(tMax, t)) / tMin) / LG)); }
    function paint(run) { play.textContent = run ? T('暂停') : T('播放'); play.setAttribute('aria-pressed', run ? 'true' : 'false'); }
    var tOne = sim.raw && sim.raw.cosmology && sim.raw.cosmology.events && sim.raw.cosmology.events.tOneGyr;
    // 说明行（「引擎结局：永恒膨胀 · 刻度到 10³ Gyr…」）：fateEnd() 是纯函数，切语言时照原样再拼一遍
    /* 底栏只留「膨胀史：永恒膨胀」这半句，整句（刻度上限 / a=1 在哪 / 回拨会重算）在 title 与 ⓘ 详情里，
       一个字都没少。fateEnd() 是纯函数，切语言时照原样再拼一遍。 */
    function paintNote() {
      if (!note) return;
      var full = fateEnd(sim).label + (tOne ? T(' · a=1（“今天”）在 ') + A.fmtTimeGyr(tOne) : '') + T(' · 拖动可推到未来，回拨则重算');
      if (!note.firstChild || !note.querySelector('.tn-t')) note.innerHTML = '<span class="tn-t"></span><span class="hi-mark" aria-hidden="true">i</span>';
      note.querySelector('.tn-t').textContent = String(fateEnd(sim).label).split(' · ')[0];
      note.title = full;
    }
    paintNote();
    if (note && note.tagName === 'BUTTON') note.addEventListener('click', function () { setInfoOpen(true); });
    relangAdd(function () { paintNote(); paint(drv.running()); if (btnNow) btnNow.textContent = T('回到进入时刻'); });
    rng.value = vOf(now); val.textContent = A.fmtTimeGyr(now);
    rng.addEventListener('input', function () { dragging = true; val.textContent = A.fmtTimeGyr(tOf(rng.value)); });
    rng.addEventListener('change', function () { dragging = false; var t = tOf(rng.value); val.textContent = A.fmtTimeGyr(t); try { drv.set(t); } catch (e) { console.warn('[app] setTime 失败', e); } paint(drv.running()); });
    rng.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    // 唯一的切换入口：按钮和空格键都走它（S.ttoggle），按钮文字随模块真实的 running 走
    function toggle() {
      if (drv.running()) drv.pause(); else drv.play(tOf(rng.value), tMax);
      paint(drv.running());
    }
    play.addEventListener('click', toggle);
    S.ttoggle = toggle;
    if (btnNow) btnNow.addEventListener('click', function () { rng.value = vOf(now); val.textContent = A.fmtTimeGyr(now); try { drv.set(now); } catch (e) { console.warn('[app] setTime 失败', e); } paint(drv.running()); });
    paint(drv.running());
    return function (t, run) {
      if (!dragging && isFinite(t)) { rng.value = vOf(t); val.textContent = A.fmtTimeGyr(t); }
      paint(!!run);
    };
  }
  function enterSpace() {
    if (S.state !== 'detonate') return;
    var sim = S.sim;
    disposeScene();
    try { if (can3D(sim) && enterSpace3D(sim)) return; }
    catch (err) { console.error('[app] 3D 进入失败，退回 2D 粒子网', err); S.no3D = true; dispose3D(); }
    try { enterSpace2D(sim); }
    catch (err2) { console.error('[app] 进入宇宙失败', err2); toast(T('进入宇宙失败：') + (err2 && err2.message), 6000); setState('select'); }
  }
  function enterSpace2D(sim) {
    showBusy(T('正在生成 2D 粒子网'), null);
    S.scene = Scenes.create(sim, { adapter: A, reducedMotion: reduced, gl: glR.ok ? glR : null });
    hideBusy();
    glCanvas.hidden = !S.scene.usesGL;
    var hasTime = !!(S.scene && S.scene.sim);          // 只有粒子网类画面能沿时间轴推
    var T2 = { target: null, paused: false, acc: 0.5 };
    function noop() {}
    function tNow2D() { var ps = S.scene && S.scene.sim; return (ps && isFinite(ps.a)) ? tOfA(sim, ps.a) : (sim.enterTimeGyr || 0); }
    var drv2D = {
      set: function (t) {
        if (t < tNow2D() - 1e-9) {                      // 回拨：粒子模拟不能倒放，按初始条件重算
          try { S.scene.dispose(); } catch (e) { /* ignore */ }
          S.scene = Scenes.create(sim, { adapter: A, reducedMotion: reduced, gl: glR.ok ? glR : null });
          glCanvas.hidden = !S.scene.usesGL;
          toast(T('回拨：粒子网不能倒放，已按初始条件重算，向前跑到 ') + A.fmtTimeGyr(t), 3000);
        } else toast(T('推进到 ') + A.fmtTimeGyr(t) + T('（跑到该时刻后自动暂停）'), 2400);
        T2.target = t; T2.paused = false;
      },
      play: function (sliderT) { T2.paused = false; T2.target = (sliderT != null && sliderT > tNow2D()) ? sliderT : null; },   // 无目标 = 自由跑
      pause: function () { T2.paused = true; },
      running: function () { return !T2.paused; }
    };
    S.view = {
      name: 'space',
      draw: function (ctx, W, H, dt, el) {
        // 高维/分数维不再自动关屏 + 弹居中提示框：D≠3 的宇宙照样让人待在里面看（3D 优先，这里是无 WebGL2 的回退）
        var ps = S.scene.sim;
        if (T2.target != null && ps && ps.ready && !T2.paused) {
          // 追时刻：主线程回退路径每帧最多补 40 步；Worker 路径 tick 在 pending 时自动空转，
          // 只能一帧一步——那就是"一直跑到该时刻再停"。到点后暂停，与 3D 的 setTime 行为一致。
          var n = 0;
          while (n < 40 && !ps.ended && tNow2D() < T2.target) { ps.tick(null); n++; }
          if (ps.ended || tNow2D() >= T2.target) { T2.target = null; T2.paused = true; }
        }
        if (T2.paused && ps && ps.tick) {                          // 暂停：这一帧不让场景推进物理，只重画
          var tk = ps.tick; ps.tick = noop;
          try { S.scene.draw(ctx, W, H, dt, el); } finally { ps.tick = tk; }
        } else S.scene.draw(ctx, W, H, dt, el);
        if (sim.outcome.type === 'SPACE_ANNIHILATED') setTimer(Math.pow(((S.annClock || 3) + el) * 10, 4), false);
        else if (hasTime) setTimer(Math.max(0, tNow2D() * 1e9), false);
        tlTick(dt, hasTime ? tNow2D() * 1e9 : (sim.enterTimeGyr || 0) * 1e9);
        T2.acc += dt;
        if (T2.acc >= 0.25) {
          T2.acc = 0;
          if (S.scene.status && hudStatus) hudStatus.textContent = S.scene.status();
          var e2 = $('hud2dTime'); if (e2 && hasTime) e2.textContent = T('距大爆炸 ') + A.fmtTimeGyr(tNow2D());
          var e3 = $('hud2dRun'); if (e3) e3.textContent = T2.paused ? T('⏸ 已暂停') : T('▶ 演化中');
          if (S.tsync) S.tsync(tNow2D(), !T2.paused);
        }
      },
      pointer: function () { /* 2D 结局画面不吃指针事件 */ },
      key: function (ev) { if (ev.key === ' ' || ev.key === 'Spacebar') { if (S.ttoggle) S.ttoggle(); return true; } if (ev.key === 'Escape') { if (S.analysisOpen) { closeAnalysis(); return true; } setState('select'); return true; } if (ev.key === 'a' || ev.key === 'A' || ev.key === 'F2') { toggleAnalysis(); return true; } if (ev.key === 'm' || ev.key === 'M') { var pl = mirrorPlan(sim); if (pl.ok) enterMirror({ mode: pl.mode }); else toast(pl.note, 5200); return true; } return false; }
    };
    setState('space');
    function disclaim2D() { setDisclaim(T(S.scene.label || (S.scene.kind === 'nbody' || S.scene.kind === 'starsea' ? 'PM N 体模拟（真实引力 + Friedmann 背景）' : '示意画面：不是模拟结果'))); }
    disclaim2D();
    S.elapsed = 0;
    setTimer(sim.enterTimeGyr * 1e9, false);
    // 2D 回退用同一套三段布局（状态胶囊 + 工具条 + 时间条），只是没有 3D 那组观测/显示按钮
    simUICss();
    $('hudTop').className = 'hud-top sim';
    $('hudTop').innerHTML = '<span class="hs id"><b id="hTid">' + esc(sim.idLabel || '') + '</b></span>' +
      '<span class="hs"><i>' + esc(T('距大爆炸')) + '</i><b id="hud2dTime">' + esc(A.fmtTimeGyr(sim.enterTimeGyr)) + '</b></span>' +
      '<span class="hs hide-s"><b id="hudStatus">' + esc(T('2D 粒子网')) + '</b></span>' +
      '<span class="hs run"><b id="hud2dRun">' + esc(T('▶ 演化中')) + '</b></span>';
    var rail2D = [{ id: 'hudEnter', icon: 'enter', label: mirrorPlan(sim).label, key: 'M', cls: 'go' }];
    $('hudSide').className = 'hud-side rail';
    $('hudSide').innerHTML = railHTML(rail2D);
    $('hudBottom').className = 'hud-bottom sim';
    railTop();
    // 切语言：这几处是拼出来的（时间/状态/演化中三段由 draw 每 0.25 s 自己重写，不用管）
    relangAdd(function () {
      disclaim2D();
      railText('hudEnter', mirrorPlan(sim).label);
      var idEl = $('hTid'); if (idEl) idEl.textContent = sim.idLabel || '';
    });
    var bEnter2 = $('hudEnter');
    if (bEnter2) {
      bEnter2.addEventListener('click', function () { var pl = mirrorPlan(sim); if (pl.ok) enterMirror({ mode: pl.mode }); else toast(pl.note, 5200); });
      if (!canMirror(sim)) { bEnter2.disabled = true; bEnter2.title = mirrorNote(sim); }
    }
    $('hudBottom').innerHTML = (hasTime ? timeHudHTML() : '') +
      hudHintsHTML(pathHint(sim) +
        T('　｜　右键 · 菜单　A/F2 · 分析面板　空格 · 播放/暂停　Esc · 退回引爆界面') + (canMirror(sim) ? T('　M · 进入镜像') : ''));
    wireHints();
    var hudStatus = $('hudStatus');
    S.tsync = hasTime ? wireTimeHUD(sim, drv2D) : null;
    if (sim.outcome.type === 'OBSERVERS_POSSIBLE') setTimeout(function () { if (S.state === 'space' && !S.analysisOpen) toast(T('结构已形成：恒星与星系可以出现。右键 · 弹出菜单（第一项就是分析面板）'), 3200); }, 800);
  }

  /* ---------------------------------------------------------- D≠3：真 D 维 N 体（ui/hyper.js）
   * specs/highdim-v1.md §一。现在这张 3 维 PM 粒子网在 D≠3 下**不是高维数据**——它是 3 维模拟
   * 把泊松核换成 k^{−(5−D)} 外推出来的，粒子只有 3 个坐标。ui/hyper.js 在真的 D 维空间里做直接求和。
   * 什么时候替换、什么时候保留原著画面（2026-09-17 用户追加的优先级）：
   *   D≥4        先给原著六维那一屏（混乱的色彩和形状，universe3d 画）；**揭开之后**换成 D 维 N 体
   *   2≤D<3      原著写过「无际的黑色平面 + 垂直相交的一维恒星」，那是主画面，不许被替换；
   *              D 维 N 体只作为「换一种看法」的开关，默认关
   *   D<2、3<D<4 原著没写过这两档，直接换成 D 维 N 体
   *   D=3        照旧
   * 「3 维外推对照」（S.compare3D）开着时一律回到旧的 PM 网，默认关。 */
  function dimViewOf(D) {
    if (Scenes && typeof Scenes.dimView === 'function') { try { return Scenes.dimView(D); } catch (e) { /* 退回本地实现 */ } }
    return D >= 4 - 1e-9 ? 'chaos' : (D >= 2 - 1e-9 && D < 3 - 1e-9 ? 'plane' : 'normal');
  }
  function hyperOK() {
    if (!HY || !ALLOW_3D || Q_HYPER === 'off') return false;
    if (S.supHy === undefined) { try { S.supHy = HY.isSupported(); } catch (e) { S.supHy = null; } }
    return !!(S.supHy && S.supHy.webgl2);
  }
  /* st 给得出来就用模块自己报的遮罩状态（每 0.25 s 一次，见 tick3D），
     给不出来（还没建）就问 universe3d 的跨宇宙会话记忆。 */
  function hyperWanted(sim, st) {
    if (!hyperOK() || !sim || !sim.outcome || S.compare3D) return false;
    var D = dimOf(sim);
    if (Math.abs(D - 3) <= 1e-6) return false;
    var dv = dimViewOf(D);
    if (dv === 'plane') return !!S.planeNbody;
    /* D≥4（chaos）**从一开始就交给 hyper**，不再等遮罩揭开才换。
       ui/hyper.js 自己会放「我们无法观察它」那一屏（用 universe3d 导出的 createDimChaos，同一份画面），
       揭开/重看只是它自己那一层的开关，不再触发任何视图对调。
       原来的做法是：遮罩期先建一整套 universe3d PM（只为放那一屏），揭开时再整个拆掉换成 N 体。
       代价有两条，真显卡上都踩到了：
         · 那套 PM 光生成初始条件就要几十秒（tiny 档 48³ 实测 20 秒才从 60% 走到 80%），
           而遮罩盖着的时候它一眼都看不到 —— 纯粹白烧；
         · 揭开那一拍要连着销毁一个 WebGPU 设备、再创建另一个，页面会整个冻住。
       现在 D≥4 只建一个视图，也就没有这两件事了。 */
    if (dv === 'chaos') return true;
    return true;                                   // D<2 与 3<D<4：原著没写过这两档，直接换成 D 维 N 体
  }
  // 两种视图之间就地对调（揭开遮罩 / 重看那一屏 / 点对照开关）：重走一遍 enterSpace，时间轴与 HUD 一起重建
  /* 两种视图就地对调（揭开遮罩 / 重看那一屏 / 点对照开关）。
     **必须隔一帧再建**：这一拍要拆掉的可能是一个 WebGPU 设备（universe3d 的 PM 盒或 hyper 的 N 体），
     而下一句就要再建一个。同一拍里一个正在销毁、一个正在创建，Dawn 那边要同步等命令流水排空，
     真机上表现为整页冻死几十秒。先 disposeScene() 把旧的交出去，rAF + setTimeout 让销毁的回调先跑完，
     再建新的。标志位一直押到新视图建完才放，中途 tick3D 再判一次也不会重入。 */
  function swapSpaceView() {
    if (S.swapPending || S.state !== 'space') return;
    S.swapPending = true;
    disposeScene();
    var ran = false;
    var go = function () {
      if (ran) return; ran = true;
      try { if (S.state === 'space' || S.state === 'detonate') { S.state = 'detonate'; enterSpace(); } }
      finally { S.swapPending = false; }
    };
    // 同上：rAF 与 setTimeout 两条都挂、谁先到算谁，别让视图对调卡在后台标签页里
    if (window.requestAnimationFrame) requestAnimationFrame(go);
    setTimeout(go, 60);
  }

  /* ---------------------------------------------------------- 进入宇宙（3D 可观测宇宙） */
  /* universe3d 的 matter 选项：这个结局里到底有没有会发光的物质。
     'stars' = 生成星系与恒星、可点选；'dark' = 没有恒星，不生成星系、点不了恒星。
     未列出的结局（如 LIQUID_OCEAN / 未知 id）按 'dark' 保守处理——宁可不画恒星，也不画不该存在的恒星。 */
  function matterOf(sim) { return hasStars(sim) ? 'stars' : 'dark'; }   // 与 canMirror 同源
  /* 进镜像时把 3D 识别出的晕表交给 mirror：星系目录以它为准（有质量、有盒内坐标、id 稳定）。
     2D 回退、晕还没识别出来、或这个宇宙压根没有结构时返回 null，mirror 自己退化成按种子生成并标注来源。 */
  function haloList() {
    if (!S.u3d) return null;
    try { var h = S.u3d.halos(); return (h && h.length) ? h : null; } catch (e) { return null; }
  }
  function boxMpcNow() {
    if (!S.u3d) return 0;
    try { var st = S.u3d.getState(); return (st && st.scale && st.scale.boxMpc) || 0; } catch (e) { return 0; }
  }
  var PATH_HINT = '路径：宇宙 → 晕/星系 → 恒星 → 行星 → 地表';
  /* 这条路径要跟这个宇宙**真的能走到哪一层**对得上：D≠3 走轨道投影演示时只到恒星系，
     继续印着"→ 行星 → 地表"就是许一个点不开的承诺（mirror.js 的 PATH_LINE 同此）。 */
  function pathHint(sim) {
    var pl = mirrorPlan(sim);
    if (!pl.ok) return T('路径：宇宙 → 晕/星系（仅观测，不能进入）');
    if (pl.mode === 'orbitDemo') return T('路径：宇宙 → 晕/星系 → 恒星系（D=') + fmtD(dimOf(sim)) + T(' 到此为止：没有可进入的行星与地表）');
    return T(PATH_HINT);
  }
  var HINT_3D_TAIL = '　｜　WASD/QE 移动 · 右键单击 = 弹出菜单（按住拖动 = 转向）· 滚轮速度 · Shift 加速 · F 飞到最密处 · H 飞入随机晕 · 点选恒星进入 · A/F2 分析面板 · Esc 退出';
  var HINT_3D = PATH_HINT + HINT_3D_TAIL;
  // D≠3：没有"点选恒星进入"这一步，路径到 N 体盒为止
  var HINT_3D_NODIM = '路径：宇宙 → 晕/星系（仅观测，不能进入）　｜　WASD/QE 移动 · 右键单击 = 弹出菜单（按住拖动 = 转向）· 滚轮速度 · Shift 加速 · F 飞到最密处 · H 飞入随机晕 · A/F2 分析面板 · Esc 退出';
  // D 维 N 体那一档：没有飞行、没有晕，能玩的是换轴（同一份数据换三根轴看，画面整个重排）
  var HINT_HYPER_TAIL = '　｜　P · 换一组投影轴　[ ] · 预设轴前后翻　左上角面板 · 手选三根轴 / 切片　拖拽 · 转视角　滚轮 · 远近　空格 · 播放/暂停　A/F2 · 分析面板　Esc · 退出';
  function enterSpace3D(sim) {
    var tier = ({ tiny: 'tiny', low: 'low', mid: 'mid', high: 'high' })[MP ? MP.tier() : ''] || 'auto';
    var mirrorOK = canMirror(sim);
    var u = null;
    var D0 = dimOf(sim), dv0 = dimViewOf(D0);
    var useHyper = hyperWanted(sim);      // 真 D 维 N 体，还是旧的 3 维 PM 外推网（见 hyperWanted 的注释）
    S.spaceIsHyper = useHyper;
    S.u3dReady = false; SLOW.t = 0; SLOW.shown = false; if ($('perfTip')) $('perfTip').hidden = true;
    showBusy(useHyper ? T('正在准备 ') + fmtD(D0) + T(' 维 N 体视图') : T('正在准备 3D 视图'), null);
    glCanvas.hidden = true;
    gl3d.hidden = useHyper;               // hyper 自己建一张画布；#gl3d 这条路这次不用
    if (useHyper) {
      try {
        u = HY.create(gl3d.parentNode, {
          cosmology: U3D.cosmologyFrom(sim.raw || sim),
          seed: sim.seed, dimS: D0, tier: tier === 'auto' ? null : tier,
          force: Q_HYPER === 'cpu' ? 'cpu' : null,
          veil: dv0 === 'chaos',          // D≥4：揭开后那行常驻提示与「重看那一屏」跟着一起过来
          reducedMotion: reduced,
          onStatus: function (msg) { var h = $('hTrun'); if (msg && h && !S.u3dReady) h.textContent = String(msg); if (msg && !S.u3dReady) showBusy(String(msg), null); }
        });
      } catch (err) {
        console.error('[app] hyper 创建失败，退回 3 维 PM 外推网：', err);
        S.compare3D = true; useHyper = false; S.spaceIsHyper = false; gl3d.hidden = false;
        toast(T('D 维 N 体视图不可用，已退回 3 维外推对照'), 4200);
      }
    }
    if (!u) { gl3d.hidden = false;
    try {
      u = U3D.create(gl3d, {
        cosmology: U3D.cosmologyFrom(sim.raw || sim),
        /* 「3 维外推对照」那一档只给 low：它是拿来看旧外推网长什么样的，不是跑高精度模拟。
           最高档在 WebGPU 上是 2M 粒子，建/拆一次就能把主线程占住一秒以上。 */
        seed: sim.seed, local: !!sim.isOurs,
        particles: (S.compare3D && Math.abs(D0 - 3) > 1e-6) ? 'low' : tier,
        force: forceBackend(),
        dimS: dimOf(sim),               // D≠3：泊松核换成 k^{−(5−D)}·exp(−k²ε²)，步长按最大加速度自适应
        matter: matterOf(sim),          // 'stars' | 'dark'：没有恒星的宇宙不生成星系、也点不了恒星
        hud: 'minimal',                 // 模块只留小地图/标签；状态行与按钮由合并 HUD 统一渲染
        onEnterStar: function (starSeed, info) { enterMirrorFromStar(starSeed, info); },
        onStatus: function (msg) {
          var h = $('hTrun'); if (msg && h && !S.u3dReady) h.textContent = String(msg);
          // 初始条件/重算的进度：接到顶部进度条上，别让人对着黑屏猜
          if (!msg || S.u3dReady) return;
          var t = String(msg);
          // 只有真·进度消息才动进度条；"俯瞰全盒…"这类普通状态别把标签顶掉
          if (/生成初始条件|重算/.test(t)) showBusy(t.replace(/^生成初始条件：/, '正在生成初始条件：'), icPct(t));
        }
      });
    } catch (err) {
      console.error('[app] universe3d 创建失败，退回 2D 粒子网：', err);
      S.no3D = true; dispose3D(); return false;
    }
    }
    S.u3d = u;
    /* 顶部说明在就绪那一刻就换掉。原来只有 tick3D（每 0.25 s）会改它，一旦那条路没跑到，
       屏幕上就会同时挂着「…已就绪」和「正在生成初始条件…」两句自相矛盾的话。 */
    try {
      if (u.ready && typeof u.ready.then === 'function') u.ready.then(function () {
        if (S.u3d !== u || S.state !== 'space') return;
        hud3dAcc = 999;                                  // 逼下一帧的 tick3D 立刻重算
        S.u3dReady = true; hideBusy();
        try { var st0 = u.getState(); if (st0 && st0.label) setDisclaim(T(st0.label)); } catch (e) { /* 还没就绪 */ }
      }, function () { /* 失败那条由下面的 then(null, …) 接 */ });
    } catch (e) { /* ignore */ }
    // ready 之外再挂一次空 catch：3D 模块内部的探测链在极端时序下（初始化没跑完就切走/重载）
    // 可能把同一个 rejection 再冒一次，没人接就会在用户控制台留一条红字
    try { if (u.ready && typeof u.ready.catch === 'function') u.ready.catch(function () { /* 下面的 then 已经处理过 */ }); } catch (e) { /* ignore */ }
    u.ready.then(null, function (err) {   // 初始化失败（无 WebGL2 / Worker 出错…）：退回旧 2D
      if (S.u3d !== u) return;
      console.warn('[app] universe3d 初始化失败，退回 2D 粒子网：', err && err.message || err);
      S.no3D = true; toast(T('3D 视图不可用，已退回 2D 粒子网'), 3000);
      if (S.state === 'space') { S.state = 'detonate'; enterSpace(); } else dispose3D();
    });
    S.view = {
      name: 'space3d', is3D: true,
      draw: function (c, w, h, dt) { c.clearRect(0, 0, w, h); tick3D(dt); tlTick(dt, S.tlYears); },   // 画面由 #gl3d 自己的 rAF 渲染
      pointer: function () { /* 指针事件由 #gl3d 直接处理 */ },
      key: function (ev) { return key3D(ev, sim); }
    };
    setState('space');
    stage.style.pointerEvents = 'none';   // 注意：要放在 setState 之后（setState 会把它清回默认）；滚轮/右键/点击都交给 #gl3d
    try { u.resize(); } catch (e) { /* ignore */ }
    setDisclaim(useHyper ? T('真 D 维 N 体（正在生成初始条件…）') : T('3D PM N 体模拟（正在初始化…）'));
    S.elapsed = 0;
    setTimer(sim.enterTimeGyr * 1e9, false);
    var dark = matterOf(sim) === 'dark';
    // ---- 合并 HUD：顶部状态 / 右侧分组按钮 / 底部时间条 + 折叠提示
    $('hudTop').innerHTML = hudTopHTML();
    $('hTid').textContent = sim.idLabel || '';
    // 分析面板排在最前面，和右键菜单的第一项对齐（那里它也是第一项，肌肉记忆一致）
    // 表抽出来：切语言时按同一张表把标题和按钮文字重写一遍（只改文字，不重建 DOM、不重绑事件）
    /* 按钮分组：D 维 N 体那一档没有晕、没有恒星、没有体渲染可言（那些都是 3 维 PM 网的概念），
       换成换轴/切片这一组——「同一个宇宙无限多张脸」就是靠这几颗按钮玩的。
       两处开关按维数出现：
         3 维外推对照（所有 D≠3）：把旧的 PM 外推网调回来做对照，默认关
         D 维 N 体视图（2≤D<3）：原著的黑平面银线是主画面，想看 N 体要自己开 */
    /* 右侧工具条：一列「图标 + 短标签 + 键帽」，分组靠发丝线，不再写组名。
       原先「换投影轴 (P)」在右边、轴的选择在左上角面板里，两处各自为政；
       现在投影的一切都在左侧抽屉，右边只留一个入口。
       抽屉只在真的有轴可挑时出现（n≥3，即 D>2）——D=1 / D=2 只有一两根空间轴，没什么可换。 */
    function projDrawerOK() { return useHyper && D0 > 2 + 1e-9; }
    function railItems() {
      var it = [{ id: 'hudAnalysis', icon: 'analysis', label: '分析面板', key: 'A' }];
      if (projDrawerOK()) it.push({ id: 'hudProj', icon: 'proj', label: '投影', key: 'P' });
      it.push('-');
      it.push({ id: 'hudOverview', icon: 'overview', label: '俯瞰', key: 'O' });
      it.push({ id: 'hudOrbit', icon: 'orbit', label: '环绕' });
      it.push({ id: 'hudFly', icon: 'fly', label: '最密处', key: 'F' });
      if (!useHyper) {
        it.push({ id: 'hudHalo', icon: 'halo', label: '随机晕', key: 'H' });
        it.push({ id: 'hudStar', icon: 'star', label: '随机恒星' });
      }
      it.push('-');
      if (!useHyper) it.push({ id: 'hudVol', icon: 'volume', label: '体渲染', key: 'V' });
      it.push({ id: 'hudExp', icon: 'exposure', label: '曝光 自动' });
      it.push({ id: 'hudLow', icon: 'power', label: '低功耗' });
      if (dv0 === 'plane' && hyperOK()) it.push({ id: 'hudPlaneNb', icon: 'grid', label: 'D 维 N 体视图' });
      if (Math.abs(D0 - 3) > 1e-6 && hyperOK()) it.push({ id: 'hudCompare', icon: 'compare', label: '3 维外推对照' });
      it.push('-');
      it.push({ id: 'hudEnter', icon: 'enter', label: mirrorPlan(sim).label, key: 'M', cls: 'go' });   // mirrorPlan 是纯函数，重算即得当前语言
      return it;
    }
    simUICss();
    $('hudTop').className = 'hud-top sim';
    $('hudSide').className = 'hud-side rail';
    $('hudSide').innerHTML = railHTML(railItems());
    $('hudBottom').className = 'hud-bottom sim';
    S.drawerOpen = false;
    if ($('app') && $('app').classList) $('app').classList.remove('drawer-on');
    railTop();
    // 路径那半句按这个宇宙真能走到哪一层来拼（D≠3 的轨道投影演示只到恒星系）
    $('hudBottom').innerHTML = timeHudHTML() + hudHintsHTML(
      useHyper ? (pathHint(sim) + T(HINT_HYPER_TAIL)) : (mirrorOK ? (pathHint(sim) + T(HINT_3D_TAIL)) : T(HINT_3D_NODIM)));
    wireHints();
    // 折叠提示那一段（hudHintsHTML）是整句原文、没走 T()，i18n 的 applyStatic() DOM 遍历本来就能命中，
    // 这里不碰它——重建 innerHTML 会把已经接好线的时间条一起冲掉。
    relangAdd(function () {
      railRelabel(railItems());
      var hh = $('hyHeadT'); if (hh) hh.textContent = T('投影');
      $('hTid').textContent = sim.idLabel || '';                       // 「宇宙 #N」/「区块 N」：bnb-ui 那边同步刷新后取新值
      var st = null; try { st = S.u3d && S.u3d.getState(); } catch (e) { /* 还没就绪 */ }
      if (st) hudSync3D(sim, st);                                      // 状态行 + 三态 + 分析面板按钮文案，一次到位
      INFO.sig = '';                                                   // ⓘ 开着就让它下一帧按新语言重画
      /* 「随机恒星」那颗按钮的 title 是拼出来的（当中夹着结局名）：
         railRelabel 只换按钮上的字，够不着 title —— 按原式重拼一遍。 */
      /* 「进入镜像」那颗按钮在画不出这个维数时会把原因写进 title，
         那句话里夹着 D 与结局名，整段命中同样够不着。 */
      var be = $('hudEnter');
      if (be && !mirrorOK) be.title = mirrorNote(sim);
      var bs = $('hudStar');
      if (bs) {
        if (dark) bs.title = T('这个宇宙里没有恒星（结局：') + T(sim.outcome.title || sim.outcome.type) + T('），3D 视图不生成星系，也没有恒星可选');
        else if (!mirrorOK) bs.title = mirrorNote(sim);
      }
      hud3dAcc = 999;                                                  // 逼 tick3D 下一帧立刻重算底部维度说明（setDisclaim）
      /* 跑完（或暂停）之后 tick3D 不再被调用，光把 hud3dAcc 顶上去是等不来下一帧的 ——
         底部那行维度说明会一直停在切语言之前的那种语言上（2026-09-20 实测）。这里补一拍。
         tick3D 只读 getState() 重写文字，不推物理、不动渲染。 */
      /* 放到下一拍再补：universe3d / hyper 自己的 mirror:lang 监听器是在它们被创建时
         才挂上的，排在本文件这一条**后面** —— 同一拍里读 getState().label 拿到的还是旧语言。 */
      setTimeout(function () { hud3dAcc = 999; try { tick3D(0); } catch (e) { /* 还没就绪：下一帧自会重算 */ } }, 0);
    });
    function act3(id, fn) { var b = $(id); if (b) b.addEventListener('click', fn); return b; }
    act3('hudAnalysis', function () { toggleAnalysis(); });
    act3('hudInfo', function () { setInfoOpen(!S.infoOpen); });
    act3('hudProj', function () { setDrawer(!S.drawerOpen); });
    act3('hudOverview', function () { if (S.u3d) S.u3d.toggleOverview(); });
    act3('hudOrbit', function () { if (S.u3d) S.u3d.toggleOrbit(); });
    act3('hudFly', function () { if (S.u3d) S.u3d.flyTo('densest'); });
    act3('hudHalo', function () { if (S.u3d) S.u3d.flyTo('randomHalo'); });
    act3('hudVol', function () { if (S.u3d) S.u3d.toggleVolume(); });
    /* —— 换投影轴 / 上一组 / 下一组 / 切片 现在全在左侧抽屉里（ui/hyper.js 的 .hy-panel 自带这几颗），
       右边只剩「投影」这个入口。快捷键 P / [ / ] 一个没动，还是 hyper.js 自己绑的。
       下面这几行留着是给「抽屉画不出来」的极端情形兜底：按钮不存在时 act3 自己就跳过了。 */
    act3('hudAxes', function () { if (S.u3d && S.u3d.randomAxes) S.u3d.randomAxes(); });
    act3('hudAxPrev', function () { if (S.u3d && S.u3d.stepAxes) S.u3d.stepAxes(-1); });
    act3('hudAxNext', function () { if (S.u3d && S.u3d.stepAxes) S.u3d.stepAxes(1); });
    act3('hudSlice', function () { if (S.u3d && S.u3d.toggleSlice) S.u3d.toggleSlice(); });
    act3('hudPlaneNb', function () { S.planeNbody = !S.planeNbody; swapSpaceView(); });
    /* 这颗按钮会整个换掉太空视图：拆掉 D 维 N 体、建一整套 universe3d PM。
       universe3d 的 create 是同步的，最高档（WebGPU mid = 2M 粒子）光分配与写初态就能把主线程
       占住一秒以上 —— 用户看门狗里那条「点了一下之后停 1.5 秒」就是它。两件事一起做：
         · 先把按钮改成「正在建立对照…」并禁用、亮出忙碌条 —— 这一帧就画得出来，用户知道在干活；
         · 对照网只用 low 档（见 enterSpace3D 的 particles）：它的用处是「看看旧的外推网长什么样」，
           不是跑一次高精度模拟，粒子给到十几万完全够看，而建/拆的代价低一个量级。 */
    act3('hudCompare', function () {
      var b = $('hudCompare');
      if (b) { b.disabled = true; railText('hudCompare', '正在建立对照…'); }
      S.compare3D = !S.compare3D;
      showBusy(S.compare3D ? T('正在建立 3 维外推对照') : T('正在切回真 D 维 N 体'), null);
      toast(S.compare3D ? T('已切到 3 维外推对照：这张网是 3 维 PM 模拟把泊松核换成 k^{−(5−D)} 外推出来的，粒子只有 3 个坐标') : T('已切回真 D 维 N 体'), 5200);
      swapSpaceView();
    });
    act3('hudLow', function () { if (S.u3d) { var st = null; try { st = S.u3d.getState(); } catch (e) {} S.u3d.setLowPower(!(st && st.lowPower)); } });
    act3('hudExp', function () {
      if (!S.u3d) return;
      var st = null; try { st = S.u3d.getState(); } catch (e) {}
      S.u3d.setExposure(st && st.exposureAuto ? 0 : 'auto');     // 自动 ↔ 手动 0 EV
    });
    var bEnter = act3('hudEnter', function () {
      var pl = mirrorPlan(sim);
      if (pl.ok) enterMirror({ mode: pl.mode }); else toast(pl.note, 5200);
    });
    if (!mirrorOK && bEnter) { bEnter.disabled = true; bEnter.title = mirrorNote(sim); }
    var bStar = $('hudStar');
    if (!bStar) { /* D 维 N 体那一档没有这颗按钮：没有恒星可选 */ }
    else if (dark) { bStar.disabled = true; bStar.title = T('这个宇宙里没有恒星（结局：') + T(sim.outcome.title || sim.outcome.type) + T('），3D 视图不生成星系，也没有恒星可选'); }
    else if (!mirrorOK) { bStar.disabled = true; bStar.title = mirrorNote(sim); }   // 星球模块也画不出这个维数：恒星入口整条关掉
    if (bStar) bStar.addEventListener('click', function () {
      if (!canMirror(sim)) { toast(mirrorNote(sim), 5200); return; }
      var r = A.rng(((sim.seed >>> 0) ^ (Date.now() & 0xffffff)) >>> 0);
      enterMirrorFromStar((r() * 4294967295) >>> 0, { name: '随机恒星' });
    });
    S.tsync = wireTimeHUD(sim, {
      set: function (t) { u.setTime(t); },
      play: function (sliderT, tMax) { play3D(u, sliderT, tMax); },
      pause: function () { u.pause(); },
      running: function () { var st = null; try { st = u.getState(); } catch (e) { /* 还没就绪 */ } return !!(st && st.running); }
    });
    if (useHyper) setTimeout(function () {
      if (S.state !== 'space' || !S.u3d || S.analysisOpen) return;
      var inf = null; try { inf = S.u3d.axisInfo(); } catch (e) { /* 还没就绪 */ }
      toast(inf && inf.presets > 1
        ? T('这是它真正的 ') + fmtD(D0) + T(' 维数据，屏幕上只是其中三根轴：按 P 换一组投影轴，同一个宇宙会变成完全不同的一张脸（共 ') + inf.presets + T(' 组）')
        : T('这是它真正的 ') + fmtD(D0) + T(' 维数据；这个维数下的空间轴不足 4 根，只有一组投影'), 6000);
    }, 1400);
    else if (mirrorOK) setTimeout(function () { if (S.state === 'space' && S.u3d && !S.analysisOpen) toast(T('结构已形成：F 飞到最密处 · 点选恒星进入镜像'), 3600); }, 1200);
    else setTimeout(function () { if (S.state === 'space' && S.u3d && !S.analysisOpen) toast(mirrorNote(sim), 6000); }, 1200);
    return true;
  }
  // 结构从未形成的宇宙：线性 σ₈ < 0.05（引擎 calc.structure.sigma8 / 模块的 sigma8Linear），
  // 或最初几帧网格实测值还没被格点噪声顶起来时也 < 0.05
  function lowSigma8(st) {
    var lin = st && st.sigma8Linear;
    if (lin == null || !isFinite(lin)) { var cs = S.sim && S.sim.raw && S.sim.raw.calc && S.sim.raw.calc.structure; lin = cs && cs.sigma8; }
    if (lin != null && isFinite(lin) && lin < 0.05) return true;
    return !!(st && st.sigma8 != null && isFinite(st.sigma8) && st.sigma8 < 0.05);
  }
  var hud3dAcc = 0;
  /* 慢帧提示：3D 里连续 2 秒 fps < 15 才提示（瞬时掉帧不吵），恢复到 20 fps 以上就撤掉。
     用户机器慢的时候至少知道"是慢不是坏"，并且知道该动哪两个开关。 */
  var SLOW = { t: 0, shown: false };
  function perfWatch(st, dt) {
    var tip = $('perfTip'); if (!tip) return;
    if (!st || !st.ready) { SLOW.t = 0; if (SLOW.shown) { tip.hidden = true; SLOW.shown = false; } return; }
    var fps = st.fps || 0;
    if (fps > 0 && fps < 15) SLOW.t += dt; else if (fps >= 20) SLOW.t = 0;
    if (SLOW.t >= 2 && !SLOW.shown) { SLOW.shown = true; tip.hidden = false; }
    if (SLOW.shown && fps >= 20) { SLOW.shown = false; tip.hidden = true; }
    if (SLOW.shown) {
      tip.textContent = T('当前每帧 ') + Math.round(1000 / Math.max(fps, 1)) + T(' ms（') + Math.round(fps) + T(' fps）：可把页脚的粒子档位调低，或在右侧按“低功耗”') +
        (st.cpuPhysics ? T('；现在走的是 CPU 物理（') + (st.gpuLabel || '') + T('）') : '');
    }
  }
  function tick3D(dt) {
    if (!S.u3d) return;
    hud3dAcc += dt; if (hud3dAcc < 0.25) return; hud3dAcc = 0;
    var st; try { st = S.u3d.getState(); } catch (e) { return; }
    if (!st) return;
    // 就绪前一直亮进度条：worker 报的文字进度由 onStatus 接管，这里兜住"没有任何消息"的空窗
    if (!S.u3dReady) {
      if (st.ready) { S.u3dReady = true; hideBusy(); }
      else if (!BUSY.on) showBusy(T('正在生成初始条件'), null);
    }
    S.u3dLast = { tier: st.tier, N: st.N, mode: st.mode, mesh: st.mesh };   // 拆掉 u3d 之后仍要知道当时是哪一档（看门狗分段用）
    perfWatch(st, hud3dAcc || 0.25);
    hudSync3D(S.sim, st); tlReposition();
    if (st.ready && isFinite(st.t)) { setTimer(Math.max(0, st.t * 1e9), false); S.tlYears = st.t * 1e9; }
    if (S.tsync && st.ready) S.tsync(st.t, st.running);
    // 顶部诚实标注随层切换：模拟 / 示意 / 数据
    var lab = st.layer === '模拟' ? T(st.label || '3D PM N 体模拟') : T(st.layer);
    // σ₈ 极小的宇宙里，屏幕上那片规则点阵是 N 体初始条件的格点，不是长出来的结构——必须说清楚。
    // 用线性 σ₈（= 引擎 calc.structure.sigma8，恒定）判据：网格实测的 σ₈ 会被粒子格点的散粒噪声顶上去
    // （实测 0.31 而线性只有 0.022），拿实测值当阈值只在最初几帧成立。
    // σ₈ 是 3 维线性理论的量：D 维直接求和那一档没有网格、也没有 σ₈ 可言，这句不适用
    if (st.layer === '模拟' && !st.hyper && lowSigma8(st)) lab += T('（涨落极小，格点为 N 体初始条件，非物理结构）');
    setDisclaim(lab);
    /* D≥4 的遮罩被揭开（universe3d → D 维 N 体）、或在 N 体里点了「重看那一屏」（反向），
       都在这里就地对调两个视图。判据只有一条 hyperWanted，两个方向共用，不会来回弹。 */
    var want = hyperWanted(S.sim, st);
    if (want !== !!S.spaceIsHyper) swapSpaceView();
  }
  function key3D(ev, sim) {
    var k = ev.key;
    // 空格：走和按钮同一个 toggle，并挡住 universe3d 自己绑在 window 上的空格处理（否则会被切两次，
    // 而且它裸调 start()，目标已到达时等于没反应）。document 的冒泡监听在 window 之前，stopPropagation 拦得住。
    if (k === ' ' || k === 'Spacebar') { ev.preventDefault(); ev.stopPropagation(); if (S.ttoggle) S.ttoggle(); return true; }
    // Esc 一层一层退：先关 ⓘ 详情，再关抽屉，再关分析面板，最后才退回引爆界面
    if (k === 'Escape') {
      if (S.infoOpen) { setInfoOpen(false); return true; }
      if (S.drawerOpen) { setDrawer(false); return true; }
      if (S.analysisOpen) { closeAnalysis(); return true; }
      setState('select'); return true;
    }
    if (k === 'F2') { toggleAnalysis(); return true; }
    if (k === 'a' || k === 'A') { if (!ev.repeat) S.aDownT = (window.performance && performance.now()) || Date.now(); return false; }   // 短按 = 分析界面（见 keyup）；按住 = 交给 3D 相机左平移
    if (k === 'f' || k === 'F') { if (S.u3d) S.u3d.flyTo('densest'); ev.stopPropagation(); return true; }
    if (k === 'h' || k === 'H') { if (S.u3d) S.u3d.flyTo('randomHalo'); ev.stopPropagation(); return true; }   // 拦下不让 universe3d 再按自己的 H（最密处）处理
    if (k === 'm' || k === 'M') { var plM = mirrorPlan(sim); if (plM.ok) enterMirror({ mode: plM.mode }); else toast(plM.note, 5200); return true; }
    return false;
  }
  // A 短按（<280 ms）= 开/关分析界面；按住则是 3D 相机的左平移，互不打架
  document.addEventListener('keyup', function (ev) {
    if (!S.u3d || S.state !== 'space' || (ev.key !== 'a' && ev.key !== 'A')) return;
    var now = (window.performance && performance.now()) || Date.now();
    if (S.aDownT && now - S.aDownT < 280) toggleAnalysis();
    S.aDownT = 0;
  });
  // 3D 里点选恒星 → 进入镜像。#1207 的太阳走"定位银河系 → 定位太阳 → 太阳系"这条原有路径。
  function enterMirrorFromStar(starSeed, info) {
    var sim = S.sim;
    var planS = mirrorPlan(sim);
    if (!planS.ok) { toast(planS.note, 5200); return; }
    if (S.state === 'mirror') return;
    S.starPick = { seed: starSeed >>> 0, info: info || null, isSun: !!(info && info.isSun) };
    var nm = T((info && info.name) || '恒星');
    // starSeed / isSun 透传给 mirror.js：以前只合成 Enter 逐级下潜，落到的是随机恒星系，
    // 点哪颗星都一样。现在 mirror 直接用这个种子 makeSystem，点谁进谁。
    enterMirror({ mode: planS.mode, starSeed: S.starPick.seed, isSun: S.starPick.isSun, starName: nm });
    if (S.state !== 'mirror') return;
    if (S.starPick.isSun) S.mirrorDrive = { acc: 0, tries: 0, target: 2 };   // 观测目录路径：定位银河系后还要再定位太阳
    if (S.starPick.isSun) toast(T('已选中') + nm + T('（观测目录）· 正在镜像里定位银河系与太阳…'), 3600);
    else toast(nm + ' · seed ' + S.starPick.seed + T(' → 已进入它的恒星系（过程生成示意；可"参观下一颗星球"）'), 4200);
  }
  function driveMirror(dt) {
    var D = S.mirrorDrive;
    if (!D || !S.mirror || S.state !== 'mirror') { S.mirrorDrive = null; return; }
    D.acc += dt; if (D.acc < 0.4) return; D.acc = 0;
    var st; try { st = S.mirror.state(); } catch (e) { S.mirrorDrive = null; return; }
    if (!st) { S.mirrorDrive = null; return; }
    if (st.trans || st.locating || st.locateSeq) return;          // 过渡动画 / 检索序列进行中：等
    if (st.level >= D.target || ++D.tries > 30) { S.mirrorDrive = null; return; }
    try { S.mirror.key({ key: 'Enter', preventDefault: function () {}, stopPropagation: function () {} }); } catch (e) { S.mirrorDrive = null; }
  }

  /* ---------------------------------------------------------- 分析界面 */
  var anBody = $('anBody'), anActions = $('anActions');
  function toggleAnalysis() { if (S.analysisOpen) closeAnalysis(); else openAnalysis(); }
  /* universe3d 的覆盖层（小地图 / HUD / 提示）挂在 body 上、z-index:20，而分析面板与编辑器抽屉在 #app 里
     （#app 是 position:fixed，自成层叠上下文），所以覆盖层会整个压在面板文字和按钮之上。
     面板打开时给 body 加 .panel-open，CSS 把覆盖层与主题按钮让开；关闭后自动恢复。 */
  function syncPanelOpen() { document.body.classList.toggle('panel-open', !!(S.analysisOpen || S.editorOpen || S.aboutOpen)); }
  function closeAnalysis() { S.analysisOpen = false; $('analysis').hidden = true; syncPanelOpen(); if (anTimer) { anTimer.forEach(clearTimeout); anTimer = null; } }
  var anTimer = null;
  /* ---- 计算报告：章节 → 每条 finding = 公式 + 输入 + 数值 + 阈值 + 判定 + 依据，basis 三种标签 */
  var RP_SECTIONS = [
    { id: 'geometry', title: '一、时空维度', match: /R_DIM|DIMENSION|EMERGE|FRACTAL/i },
    { id: 'expansion', title: '二、膨胀史', match: /LAMBDA|CURV|FATE|INFL|EXPAN|HUBBLE|AGE|OMEGA_K|DARK|FRIEDMANN|CRUNCH|RIP/i },
    { id: 'bbn', title: '三、原初核合成', match: /BBN|QUARK|NEUTRON|DEUT|HELIUM|THETA|WEAK|BARYON|^R_CP|GENER|OMEGA_B|NUCLEO|PION|ETA/i },
    { id: 'structure', title: '四、结构形成', match: /STRUCT|FLUCT|GROWTH|SIGMA|COLLAPSE|WEINBERG|_BH|BLACK|NEUTRINO|OMEGA_C|^R_NS|MATTER|SILK|JEANS|PBH/i },
    { id: 'stars', title: '五、恒星', match: /STAR|FUSION|GRAV|IGNIT|STELLAR|SUPERNOVA|MAIN_SEQ|LIFETIME/i },
    { id: 'atoms', title: '六、原子与化学', match: /ATOM|CHEM|ALPHA|MASS_RATIO|HIGGS|MOLEC|HYDROGEN|STRONG|PLANCK|LIGHT|DIM|BOHR|PERIODIC/i },
    { id: 'planets', title: '七、行星与宜居', match: /HAB|PLANET|LIFE|OBSERV|WATER|CARBON/i },
    { id: 'other', title: '其它判定', match: /./ }
  ];
  var RP_ID_SECTION = { R_DIM_INPUT: 'geometry', R_DIM_EMERGE: 'geometry', R_DIM: 'geometry', R_DIM_FRACTAL: 'geometry', R_FRIEDMANN: 'expansion', R_ZEQ: 'expansion', R_CLOSURE: 'expansion', R_RECOMB: 'expansion', R_CP: 'bbn', R_OMEGA_B: 'bbn', R_MNP: 'bbn', R_DEUTERON: 'bbn', R_DIPROTON: 'bbn', R_BBN_YP: 'bbn', R_GROWTH: 'structure', R_COLLAPSE: 'structure', R_WEINBERG: 'structure', R_PBH: 'structure', R_Q_WINDOW: 'structure', R_NEUTRINO: 'structure', R_NO_CDM: 'structure', R_OCEAN: 'structure', R_STAR_MASS: 'stars', R_STAR_IGNITE: 'stars', R_STAR_LIFE: 'stars', R_NUCLEI: 'stars', R_SUPERNOVA: 'stars', R_ATOMS: 'atoms', R_MOLECULES: 'atoms', R_CHEMISTRY: 'atoms', R_PLANETS: 'planets', R_TIMESCALE: 'planets' };
  var RP_SECTION_ALIAS = { expansion: 'expansion', cosmology: 'expansion', 'friedmann': 'expansion', '膨胀史': 'expansion', bbn: 'bbn', nucleosynthesis: 'bbn', '核合成': 'bbn', '原初核合成': 'bbn', structure: 'structure', '结构形成': 'structure', stars: 'stars', stellar: 'stars', '恒星': 'stars', atoms: 'atoms', chemistry: 'atoms', '原子': 'atoms', '化学': 'atoms', '原子与化学': 'atoms', planets: 'planets', habitability: 'planets', '行星': 'planets', '宜居': 'planets', '行星与宜居': 'planets' };
  // 章节小结候选键（引擎 README 定稿前按候选名兜底查找；找不到就不显示）
  var RP_SUMMARY = {
    expansion: [['年龄', ['ageGyr', 'tOneGyr', 'age', 't0Gyr'], 'gyr'], ['H₀', ['H0', 'h0', 'hubble0'], 'H0'], ['z_eq', ['zEq', 'z_eq'], 'num'], ['a_eq', ['aEq'], 'sci'], ['z_rec', ['zRec', 'z_rec'], 'num'], ['t_rec', ['tRecGyr'], 'gyr'], ['Ω_k', ['omegaK', 'Ok'], 'num'], ['结局', ['fateLabel', 'fateText'], 'str']],
    bbn: [['Y_p', ['Yp', 'yp', 'heliumFraction', 'Y_p'], 'num'], ['D/H', ['DH', 'deuterium', 'D_H', 'deuteriumRatio'], 'sci'], ['n/p', ['npRatio', 'n_p', 'neutronProtonRatio'], 'num'], ['m_n−m_p', ['mnMinusMp', 'deltaMnp', 'dmnp'], 'MeV'], ['η', ['eta', 'etaB', 'baryonToPhoton'], 'sci']],
    structure: [['增长因子 D', ['growthFactor', 'growth', 'D0'], 'num'], ['σ(M_gal)', ['sigmaM', 'sigmaGal', 'sigma8', 'sigma_M'], 'num'], ['坍缩红移', ['zCollapse', 'zCol', 'z_collapse'], 'num'], ['a_col', ['aCol'], 'sci'], ['Weinberg 上界 Ω_Λ', ['weinbergBound', 'lambdaBound', 'weinberg'], 'sci'], ['黑洞判据', ['bhFactor', 'bhCriterion', 'blackHoleFactor'], 'num'], ['δ_max', ['deltaMax'], 'sci']],
    stars: [['最小质量', ['starMassMin', 'mStarMin', 'minStarMass'], 'Msun'], ['最大质量', ['starMassMax', 'mStarMax', 'maxStarMass'], 'Msun'], ['寿命（太阳质量）', ['starLifeGyr', 'stellarLifeGyr', 'starLifetime'], 'gyr'], ['能否点火', ['ignition', 'canIgnite', 'fusion'], 'bool'], ['恒星纪元', ['stellarEraGyr'], 'gyr']],
    atoms: [['α', ['alpha', 'alphaEM'], 'alpha'], ['mₑ/mₚ', ['meOverMp', 'massRatio', 'me_mp'], 'sci'], ['原子稳定', ['atoms', 'atomsStable', 'stableAtoms'], 'bool'], ['化学', ['chemistry', 'chemistryOK'], 'bool'], ['周期表长度', ['zMax', 'periodicLength', 'maxZ'], 'num']],
    planets: [['可居住性', ['habitability'], 'num'], ['重元素', ['heavyElements', 'metals'], 'bool'], ['宜居带', ['habitableZone', 'hz'], 'str'], ['液态水窗口', ['waterWindowGyr', 'liquidWaterGyr'], 'gyr']]
  };
  function rpFmt(v, kind) {
    if (v == null || v === '') return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? T('是') : T('否');
    if (typeof v === 'object') return v.label || v.text || v.tLabel || (v.type ? String(v.type) + (v.tLabel ? '（' + v.tLabel + '）' : '') : null);
    if (!isFinite(v)) return String(v);
    switch (kind) {
      case 'gyr': return A.fmtTimeGyr(v);
      case 'H0': return v > 5 ? v.toFixed(1) + ' km/s/Mpc' : (v * 67.7).toFixed(1) + ' km/s/Mpc（×' + v.toFixed(2) + '）';
      case 'MeV': return v.toPrecision(3) + ' MeV';
      case 'Msun': return v.toPrecision(3) + ' M☉';
      case 'alpha': return v < 0.5 ? '1/' + (1 / v).toFixed(1) : String(v);
      case 'bool': return typeof v === 'number' ? (v >= 0.5 ? T('是（') + v.toFixed(2) + T('）') : T('否（') + v.toFixed(2) + T('）')) : String(v);
      case 'sci': return (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0)) ? sci(Math.abs(v)) : String(Number(v.toPrecision(4)));
      default: return (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0)) ? sci(Math.abs(v)) : String(Number(v.toPrecision(4)));
    }
  }
  function rpFind(pools, keys) { for (var i = 0; i < pools.length; i++) { var o = pools[i]; if (!o || typeof o !== 'object') continue; for (var k = 0; k < keys.length; k++) if (o[keys[k]] != null) return o[keys[k]]; } return undefined; }
  function rpSectionOf(f) {
    if (f.id && RP_ID_SECTION[f.id]) return RP_ID_SECTION[f.id];
    var sec = f.section || f.chapter || f.group;
    if (sec) { var key = String(sec).toLowerCase(); if (RP_SECTION_ALIAS[key]) return RP_SECTION_ALIAS[key]; if (RP_SECTION_ALIAS[String(sec)]) return RP_SECTION_ALIAS[String(sec)]; for (var i = 0; i < RP_SECTIONS.length; i++) if (RP_SECTIONS[i].id === key || RP_SECTIONS[i].title.indexOf(String(sec)) >= 0) return RP_SECTIONS[i].id; }
    var probe = String(f.id || '') + ' ' + String(f.title || '');
    for (i = 0; i < RP_SECTIONS.length; i++) if (RP_SECTIONS[i].match.test(probe)) return RP_SECTIONS[i].id;
    return 'other';
  }
  var RP_INPUT_NAME = { omegaM: 'Ω_m', omegaLambda: 'Ω_Λ', omegaR: 'Ω_r', omegaK: 'Ω_k', eta10: 'η₁₀', B_eV: 'B(eV)', deltaCKM: 'δ_CKM', fnu: 'f_ν', Lrel: 'L/L☉', beta: 'mₑ/mₚ', tauN: 'τ_n', Tf: 'T_f', neff: 'N_eff', Q: 'Q', ns: 'n_s' };
  function rpInputName(k) { if (RP_INPUT_NAME[k]) return RP_INPUT_NAME[k]; var d = A.PARAMS.filter(function (x) { return x.key === k; })[0]; return d ? (d.symbol || k) : k; }
  function rpInputs(inp) {
    if (inp == null) return '';
    if (typeof inp === 'string') return esc(inp);
    if (Array.isArray(inp)) return inp.map(function (x) { return typeof x === 'object' ? esc((x.name || x.key || '') + '=' + rpFmt(x.value != null ? x.value : x.v, 'sci') + (x.unit ? ' ' + x.unit : '')) : esc(String(x)); }).join('，');
    return Object.keys(inp).map(function (k) { var v = inp[k]; return esc(rpInputName(k) + '=' + (v != null && typeof v === 'object' ? rpFmt(v.value, 'sci') + (v.unit ? ' ' + v.unit : '') : rpFmt(v, 'sci'))); }).join('，');
  }
  /* extrap：这一条是"维数断链之后仍按 3 维公式跑出来的"。引擎照样给它判了 ok/fail，
     但那个判定在这个宇宙里不成立 —— 徽章降成中性的"外推"，并在条目里写明原因，
     免得 D=14 的报告里"能否点燃：通过"顶着一个绿标。数值与公式照旧全给（可复算）。 */
  function rpItem(f, extrap) {
    var basis = String(f.basis || '').toLowerCase(); if (!BASIS_TAG[basis]) basis = f.formula ? 'computed' : 'heuristic';
    var basisTitle = { computed: '数值计算得到', scaling: '标度关系（量级估计）', heuristic: '启发式判据', toy: '玩具模型（推测性）' };
    var sev = String(f.severity || 'info').toLowerCase();
    var verdict = f.verdict; if (typeof verdict === 'boolean') verdict = verdict ? T('通过') : T('不通过');
    var VERDICT_CN = { ok: '通过', warn: '告警', bad: '不利', fail: '致命' };
    var vkey = String(verdict || '').toLowerCase();
    var vcls = vkey === 'fail' ? 'fatal' : vkey === 'bad' ? 'severe' : vkey === 'warn' ? 'warn' : vkey === 'ok' ? 'ok' : (/fail|不通过|否|fatal|severe/i.test(String(verdict)) ? (sev === 'fatal' ? 'fatal' : sev === 'severe' ? 'severe' : 'warn') : (/pass|通过|是/i.test(String(verdict)) ? 'ok' : sev));
    if (VERDICT_CN[vkey]) verdict = T(VERDICT_CN[vkey]);
    if (extrap) { verdict = T('外推'); vcls = 'warn'; }
    var h = '<li class="rp-item"><div class="rp-head"><span class="rp-basis ' + basis + '" title="' + esc(T(basisTitle[basis])) + '">' + T(BASIS_TAG[basis]) + '</span><b>' + esc(TE(f.title || f.id || '')) + '</b>' + (verdict != null || f.severity ? '<span class="rp-verdict ' + vcls + '"' + (extrap ? ' title="' + esc(T('演化链已在维数判据处终止：这一条是按 3+1 维公式继续跑出来的，判定不成立')) + '"' : '') + '>' + esc(verdict != null ? String(verdict) : String(f.severity)) + '</span>' : '') + '</div>';
    if (extrap) h += '<p class="rp-text">' + esc(T('（这一条以 3+1 维为前提；该宇宙的维数判据已经断链，公式与数值可复算，但"通过/不通过"不成立。）')) + '</p>';
    var g = '';
    if (f.formula) g += '<span>' + esc(T('公式')) + '</span><span class="formula">' + esc(TE(f.formula)) + '</span>';
    var inputs = rpInputs(f.inputs); if (inputs) g += '<span>' + esc(T('输入')) + '</span><span>' + inputs + '</span>';
    var val = f.valueText ? String(f.valueText) : (f.value != null ? (typeof f.value === 'object' && !Array.isArray(f.value) ? rpFmt(f.value.value != null ? f.value.value : f.value, 'sci') + (f.value.unit ? ' ' + f.value.unit : '') : rpFmt(f.value, 'sci')) : null);
    if (val != null) g += '<span>' + esc(T('数值')) + '</span><span>' + esc(TE(val)) + (f.unit ? ' ' + esc(f.unit) : '') + '</span>';
    var thr = f.threshold != null ? (typeof f.threshold === 'object' ? (f.threshold.text || Object.keys(f.threshold).map(function (k) { return k + ' ' + rpFmt(f.threshold[k], 'sci'); }).join('，')) : String(f.threshold)) : null;
    if (thr != null && thr !== '' && thr !== '—') g += '<span>' + esc(T('阈值')) + '</span><span>' + esc(TE(thr)) + '</span>';
    if (g) h += '<div class="rp-grid">' + g + '</div>';
    if (f.text || f.explain) h += '<p class="rp-text">' + esc(TE(f.text || f.explain)) + '</p>';
    var ref = refText(f.ref || f.refs || f.reference); if (ref) h += '<p class="rp-ref">' + esc(TE(ref)) + '</p>';
    return h + '</li>';
  }
  /* ---------------------------------------------------------- D≠3 时报告里哪些数还算数
   * 引擎在 D≠3 时分两种情形（engine/README §5 的 R_DIM）：
   *   a) 2<D<4 且 D≠3 → BEYOND_MODEL_DIM：演化链继续跑，但后面每一条都是 **3+1 维公式的外推**
   *      （引擎自己在 outcome.description 里写了"外推数值……均未做 D≠3 修正"）。
   *   b) D≥4 或 D≤2 → UNSTABLE_ORBITS：引擎判 R_DIM=fail 并写下"演化链在这一步终止"。
   *      可它**照样把后面 20 多条 finding 跑完并标成"通过"**：D=14 的报告里
   *      "能否点火：能 / 主序寿命 91 亿年 / 碳-水型生物化学：可能" 全是绿的，
   *      而同一份报告的结论是"没有行星系统，也没有化学"。这是这次审计里最直白的一处说谎。
   * 本模块的显示规则（项目约定"超出适用范围就拒绝给数"）：
   *   情形 a → 报告顶部挂"外推"横幅，数值照给但不再当结论；
   *   情形 b → 恒星/原子化学/行星三章的**小结数字一律不给**，改成一句"不给数"；
   *            逐条 finding 仍列出（它们是可复算的中间量），但判定徽章一律降成中性的"外推"。
   * 判据只读引擎自己的量：calc.dims.orbitsOK / gravityOK，不另立标准。 */
  // 以 3+1 维为前提的判定：维数判据一断链，这些条目的"通过/不通过"就不成立了
  var DIM3_ONLY_FINDINGS = {
    R_RECOMB: 1, R_BBN_YP: 1, R_GROWTH: 1, R_COLLAPSE: 1, R_WEINBERG: 1, R_PBH: 1, R_Q_WINDOW: 1,
    R_NEUTRINO: 1, R_NO_CDM: 1, R_STAR_MASS: 1, R_STAR_IGNITE: 1, R_STAR_LIFE: 1, R_NUCLEI: 1,
    R_SUPERNOVA: 1, R_ATOMS: 1, R_MOLECULES: 1, R_CHEMISTRY: 1, R_PLANETS: 1, R_TIMESCALE: 1,
    R_HOYLE: 1, R_WATER: 1, R_COMPLEX_CHEM: 1, R_BIOCHEM_CARBON: 1, R_ALT_BIOCHEM: 1
  };
  function dimScope(sim) {
    var D = dimOf(sim), cd = (sim.raw && sim.raw.calc && sim.raw.calc.dims) || {};
    var off = !(Math.abs(D - 3) <= 1e-6);
    // 断链：引擎自己的两个开关（D≥4 轨道不稳 / D≤2 无牛顿吸引）；老引擎没这两个字段时按 D 兜底
    var broke = off && (cd.orbitsOK === false || cd.gravityOK === false ||
      (cd.orbitsOK == null && cd.gravityOK == null && (D >= 4 - 1e-6 || D <= 2 + 1e-6)));
    var why = !off ? '' : broke
      ? ((cd.gravityOK === false || D <= 2 + 1e-6)
        ? T('D≤2：引力势为对数或排斥，没有牛顿吸引（Tegmark 1997）')
        : T('D≥4：圆轨道对径向微扰不稳定，氢原子哈密顿量无下界（Ehrenfest 1917）'))
      : T('2<D<4 且 D≠3：轨道与原子还在，但核合成/恒星/化学/宜居的公式只对 3 维成立');
    return { D: D, off: off, broke: broke, why: why };
  }
  function dimBanner(ds) {
    if (!ds.off) return '';
    var head = 'D=' + fmtD(ds.D) + T('　·　') + ds.why;
    var body = ds.broke
      ? T('演化链在维数判据处终止：下面「三、原初核合成」到「七、行星与宜居」各章的公式都以 3+1 维为前提，在这个宇宙里不成立。恒星 / 原子与化学 / 行星三章的小结数字因此不给；逐条判定仍然列出（它们是可复算的中间量），但一律标「外推」，不要当成这个宇宙里真会发生的事。')
      : T('下面各章的数值都是把 3 维公式外推到这个 D 的结果，仅供参考，不构成判断；引擎已据此把可居住性置空、把结局判为「超出模型适用范围」。');
    return '<div class="rp-legend"><b>' + esc(head) + '</b>　' + esc(body) + '</div>';
  }
  /* 面板的正文是一整块 innerHTML（本机实测从点击到下一帧 160 ms，绝大部分花在布局与绘制上）。
     先把壳显出来让这一帧画得掉，正文挪到下一帧再拼 —— 点击的反馈立刻有，重活不压在同一帧里。 */
  function openAnalysis() {
    var sim = S.sim; if (!sim) return;
    S.analysisOpen = true; $('analysis').hidden = false; syncPanelOpen();
    if (!S.anDeferred) {
      S.anDeferred = true;
      var anb = $('anBody'); if (anb && !anb.innerHTML) anb.innerHTML = '<div class="rp-legend">' + esc(T('正在生成计算报告…')) + '</div>';
      (window.requestAnimationFrame || setTimeout)(function () {
        S.anDeferred = false;
        if (S.analysisOpen && S.sim === sim) openAnalysis();
      });
      return;
    }
    $('anSub').textContent = (sim.idLabel || '') + ' · seed ' + ('00000000' + sim.seed.toString(16)).slice(-8).toUpperCase() + T(' · 计算报告');
    var t = sim.outcome.type, R = sim.report, raw = sim.raw || {}, cos = raw.cosmology || {}, ev = cos.events || {};
    var pools = [raw.summary, raw.derived, raw.report && typeof raw.report === 'object' ? raw.report : null, raw.bbn, raw.structure, raw.stars, raw.atoms, raw.planets, raw.chemistry, raw.expansion, raw.phys, cos, ev, cos.background, cos.fate, raw.fate, R];
    var findings = Array.isArray(sim.findings) ? sim.findings : [];
    var engineSections = Array.isArray(raw.sections) ? raw.sections : (raw.report && Array.isArray(raw.report.sections) ? raw.report.sections : null);
    var h = '';
    var anyToy = (sim.derivedOrder || []).some(function (k) { return sim.derived && sim.derived[k] && sim.derived[k].basis === 'toy'; }) || findings.some(function (f) { return f.basis === 'toy'; });
    h += '<div class="rp-legend"><span class="rp-basis computed">' + esc(T('计算')) + '</span>' + esc(T('数值计算得到')) + '　<span class="rp-basis scaling">' + esc(T('标度关系')) + '</span>' + esc(T('量级估计')) + '　<span class="rp-basis heuristic">' + esc(T('启发式')) + '</span>' + esc(T('经验判据')) + (anyToy ? '　<span class="rp-basis toy">' + esc(T('玩具')) + '</span>' + esc(T('推测性模块')) : '') + esc(T('　· 结局：')) + '<b>' + esc(T(sim.outcome.title)) + '</b>' + (modsLabel(sim.modules) ? esc(T('　· 已开启模块：')) + esc(modsLabel(sim.modules)) : '') + '</div>';
    // 怎么走到别处去（3D 里点不到东西时最容易卡在这一步）
    h += '<div class="rp-legend">' + esc(pathHint(sim)) + esc(T(' · 右键单击 = 弹出菜单（3D 中按住右键拖动 = 转向）· A/F2 开关本面板 · F 最密处 · H 随机晕')) + esc(mirrorPlan(sim).mode === '3d' ? T(' · 点选恒星 → 行星 → 地表') : '') + '</div>';
    // D≠3：先把"下面这些数还算不算数"说在前头，再开始列数（见 dimScope 的说明）
    var dScope = dimScope(sim);
    h += dimBanner(dScope);
    // 结局与基本数据
    h += '<div class="an-sec"><h3>' + esc(T('结论摘要')) + '</h3><div class="an-in"><div class="kv">' +
      '<span>' + esc(T('结局')) + '</span><span class="' + (NEUTRAL_OUTCOMES[t] ? 'neutral' : esc(sim.outcome.severity)) + '">' + esc(T(sim.outcome.title)) + ' <span class="kv-id">[' + esc(t) + ']</span></span>' +
      '<span>' + esc(T('观察时刻')) + '</span><span>' + esc(T('距大爆炸 ')) + esc(TE(A.fmtTimeGyr(sim.enterTimeGyr))) + '</span>' +
      // 视界半径来自 3 维 FRW 积分：D≠3 时它同样是外推，别让它看着像实测
      (R.radiusGly > 0 ? '<span>' + esc(T('视界半径')) + '</span><span>' + esc(T('约 ')) + Math.round(R.radiusGly * 10) + esc(T(' 亿光年')) + (dScope.off ? esc(T('（3 维公式外推）')) : '') + '</span>' : '') +
      '<span>' + esc(T('距观测值')) + '</span><span>' + Number(sim.distance).toFixed(1) + ' / 100</span>' +
      (R.habitability != null ? '<span>' + esc(T('可居住性')) + '</span><span>' + Number(R.habitability).toFixed(2) + '</span>' : '') +
      '</div></div></div>';
    var calc = raw.calc || {};
    function sumRow(label, txt) { return txt == null || txt === '' ? '' : '<div><span>' + esc(T(label)) + '</span><b>' + esc(TE(String(txt))) + '</b></div>'; }
    /* 维数判据断链时（D≥4 / D≤2），恒星、原子与化学、行星三章的小结**不给数**。
       这些数是引擎把 3 维公式一路跑到底的产物：D=14 的宇宙里它会说"能否点火：能、
       主序寿命 91 亿年、岩石行星 可形成"，而同一份报告的结论是"没有行星系统，也没有化学"。
       给一行"不给数 + 为什么"，比给一串对不上的数字诚实。 */
    var DIM_BROKE_SECTIONS = { stars: 1, atoms: 1, planets: 1 };
    function dimNoNumberRow(id) {
      var what = id === 'stars' ? T('恒星质量窗口 / 点火 / 主序寿命') : id === 'atoms' ? T('原子与化学判据') : T('宜居带 / 行星质量 / 可居住性');
      return '<div><span>' + esc(T('不给数')) + '</span><b>' + esc(what + T('都以 3+1 维为前提；D=') + fmtD(dScope.D) + T(' 时演化链已在维数判据处终止，这些数不成立')) + '</b></div>';
    }
    function calcSummary(id) {
      var out = [], cx = calc.expansion, cr = calc.recombination, cb = calc.bbn, cs = calc.structure, ct = calc.stars, ca = calc.atoms, cp = calc.planets, cd = calc.dims;
      if (dScope.broke && DIM_BROKE_SECTIONS[id]) return [dimNoNumberRow(id)];
      // 2<D<4 且 D≠3：数照给，但每一章头上先说清它是外推（引擎 outcome.description 的同一句话）
      if (dScope.off && !dScope.broke && (id === 'bbn' || id === 'structure' || id === 'stars' || id === 'atoms' || id === 'planets')) {
        out.push('<div><span>' + esc(T('外推')) + '</span><b>' + esc(T('以下按 3 维公式计算，未做 D=') + fmtD(dScope.D) + T(' 的维数修正')) + '</b></div>');
      }
      if (id === 'expansion' && (cx || cr)) {
        if (cx) { out.push(sumRow('年龄 (a=1)', cx.ageGyr != null ? A.fmtTimeGyr(cx.ageGyr) : '从未到达 a=1')); out.push(sumRow('H(a=1)', cx.H0eff != null && isFinite(cx.H0eff) ? cx.H0eff.toFixed(1) + ' km/s/Mpc' : null)); out.push(sumRow('z_eq', cx.zEq != null && isFinite(cx.zEq) ? Math.round(cx.zEq) : null)); out.push(sumRow('Ω_m / Ω_Λ / Ω_k', [cx.omegaM, cx.omegaLambda, cx.omegaK].map(function (v) { return v == null ? '—' : rpFmt(v, 'sci'); }).join(' / '))); }
        if (cr) { out.push(sumRow('z_rec (Saha)', cr.zRec != null ? Math.round(cr.zRec) : '无解')); out.push(sumRow('t_rec', cr.tRecGyr != null ? A.fmtTimeGyr(cr.tRecGyr) : null)); }
      }
      if (id === 'bbn' && cb) { out.push(sumRow('Y_p', cb.Yp != null ? Number(cb.Yp).toFixed(3) : null)); out.push(sumRow('D/H', cb.DH != null ? rpFmt(cb.DH, 'sci') : null)); out.push(sumRow('n/p (BBN)', cb.npBBN != null ? Number(cb.npBBN).toFixed(3) : (cb.npFreeze != null ? Number(cb.npFreeze).toFixed(3) : null))); out.push(sumRow('m_n−m_p', cb.deltaMeV != null ? Number(cb.deltaMeV).toFixed(3) + ' MeV' : null)); out.push(sumRow('τ_n', cb.tauN != null ? rpFmt(cb.tauN, 'sci') + ' s' : null)); out.push(sumRow('η₁₀', cb.eta10 != null ? rpFmt(cb.eta10, 'sci') : null)); out.push(sumRow('氘核 / 双质子', (cb.deuteronBound ? '氘束缚' : '氘不束缚') + ' / ' + (cb.diprotonBound ? '双质子束缚' : '双质子不束缚'))); }
      if (id === 'structure' && cs) { out.push(sumRow('增长因子 D(1)/D(a_eq)', cs.growthOne != null ? Math.round(cs.growthOne) : '—')); out.push(sumRow('σ₈ 等价量', cs.sigma8 != null ? Number(cs.sigma8).toFixed(2) : null)); out.push(sumRow('σ(10¹²M☉, z=0)', cs.sigmaGalNow != null ? Number(cs.sigmaGalNow).toFixed(2) : null)); out.push(sumRow('星系坍缩红移', cs.gal ? 'z≈' + Number(cs.gal.z).toFixed(1) + '（' + A.fmtTimeGyr(cs.gal.tGyr) + '）' : '未坍缩')); out.push(sumRow('第一批天体', cs.first ? 'z≈' + Number(cs.first.z).toFixed(0) : '无')); out.push(sumRow('Weinberg 上界 Ω_Λ', cs.weinbergMax != null ? rpFmt(cs.weinbergMax, 'sci') + (cs.weinbergOK ? '（满足）' : '（超出）') : null)); out.push(sumRow('原初黑洞份额 β', cs.betaPBH != null ? rpFmt(cs.betaPBH, 'sci') : null)); }
      if (id === 'stars' && ct) { out.push(sumRow('M_min / M_max', (ct.Mmin != null ? rpFmt(ct.Mmin, 'sci') : '—') + ' / ' + (ct.Mmax != null ? rpFmt(ct.Mmax, 'sci') : '—') + ' M☉')); out.push(sumRow('主序寿命 (1 M☉)', ct.tMSGyr != null ? A.fmtTimeGyr(ct.tMSGyr) : null)); out.push(sumRow('能否点火', ct.canIgnite != null ? (ct.canIgnite ? '能' : '不能') : null)); out.push(sumRow('核合成 Z_max', ct.ZmaxNuc != null ? String(ct.ZmaxNuc) : null)); out.push(sumRow('重元素散布', ct.heavyElements != null ? (ct.heavyElements ? '是' : '否') + (ct.supernovaOK === false ? '（超新星哑火）' : '') : null)); }
      if (id === 'geometry' && cd) { out.push(sumRow('宏观空间维数 D', cd.D != null ? fmtD(cd.D) + (cd.fractional ? '（分数维）' : '') : null)); out.push(sumRow('轨道稳定度', cd.orbitStability != null ? Number(cd.orbitStability).toFixed(2) : null)); out.push(sumRow('引力聚集因子', cd.gravityFactor != null ? Number(cd.gravityFactor).toFixed(2) : null)); if (cd.emergent) out.push(sumRow('展开的维度', (cd.emergent.nOpen != null ? cd.emergent.nOpen + ' 个完全展开' : '') + (cd.emergent.nPartial ? '，' + cd.emergent.nPartial + ' 个部分展开' : ''))); }
      if (id === 'atoms' && ca) { out.push(sumRow('Z_max,atom', ca.ZmaxAtom != null ? String(ca.ZmaxAtom) : null)); out.push(sumRow('元素种数', ca.nElements != null ? String(ca.nElements) : null)); out.push(sumRow('Ry / a₀', (ca.RyEV != null ? rpFmt(ca.RyEV, 'sci') + ' eV' : '—') + ' / ' + (ca.a0rel != null ? rpFmt(ca.a0rel, 'sci') + ' a₀' : '—'))); out.push(sumRow('氢 / 分子 / 化学', (ca.hydrogen ? '有氢' : '无氢') + ' / ' + (ca.molecules ? '有分子' : '无分子') + ' / ' + (ca.chemistry ? '化学可行' : '化学不可行'))); }
      if (id === 'planets' && cp) { out.push(sumRow('宜居带', cp.dHZ_AU != null ? rpFmt(cp.dHZ_AU, 'sci') + ' AU' : null)); out.push(sumRow('时间窗口', cp.windowGyr != null ? (isFinite(cp.windowGyr) ? A.fmtTimeGyr(cp.windowGyr) : '不受限（永恒膨胀）') : null)); out.push(sumRow('行星质量尺度', cp.MplanetRel != null ? '×' + rpFmt(cp.MplanetRel, 'sci') : null)); out.push(sumRow('岩石行星', cp.planetsOK != null ? (cp.planetsOK ? '可形成' : '难以形成') : null)); if (R.habitability != null) out.push(sumRow('可居住性', Number(R.habitability).toFixed(2))); }
      return out.filter(Boolean);
    }
    // 零、常数由此而来（第 1 层派生量）
    function derivedHTML() {
      var order = sim.derivedOrder || [], D = sim.derived || {};
      if (!order.length) return '';
      var isDim = {}; DIM_KEYS.forEach(function (k) { isDim[k] = 1; });
      var lis = order.filter(function (k) { return !isDim[k]; }).map(function (k) {
        var d = D[k]; if (!d) return '';
        var basis = BASIS_TAG[d.basis] ? d.basis : 'computed';
        var inputs = (d.inputs || []).map(function (ik) { var pd = A.paramDef(ik); return pd ? (pd.symbol || ik) : ik; }).join(T('、'));
        var val = (k === 'dimS' && isFinite(d.value)) ? 'D=' + fmtD(d.value) + (d.text ? '（' + d.text + '）' : '') : (d.text || (d.value != null ? rpFmt(d.value, 'sci') + (d.unit ? ' ' + d.unit : '') : ''));
        var eps = '';
        // 维度条：画 9 根饱和度 s_i（0=蜷缩、1=完全展开、其间=部分展开，D=Σs_i）。
        // 老引擎只给 ε 时退回按 ε 的阈值着色，条高仍归一化到 0..1。
        if (k === 'dimS' && (Array.isArray(d.s) || Array.isArray(d.epsilons))) {
          var sArr = Array.isArray(d.s) ? d.s : null, eArr = Array.isArray(d.epsilons) ? d.epsilons : null;
          var nDim = (sArr || eArr).length;
          var cells = [];
          for (var di = 0; di < nDim; di++) {
            var sv = sArr ? Math.max(0, Math.min(1, +sArr[di])) : (eArr[di] > 1.1 ? 1 : eArr[di] < 0.9 ? 0 : (eArr[di] - 0.9) / 0.2);
            var stc = sv >= 0.999 ? 'open' : sv <= 0.001 ? 'closed' : 'partial';
            var tip = T('维 ') + (di + 1) + T('：') + 's=' + sv.toFixed(3) + (eArr ? T('（') + 'ε=' + Number(eArr[di]).toPrecision(3) + T('）') : '') +
              (stc === 'open' ? T(' 完全展开') : stc === 'closed' ? T(' 蜷缩') : T(' 部分展开'));
            cells.push('<div class="eps-bar ' + stc + '" style="height:' + (sv * 100).toFixed(1) + '%" title="' + esc(tip) + '"><span>' + (di + 1) + '</span></div>');
          }
          var nOpen = d.nOpen != null ? d.nOpen : null, nPart = d.nPartial != null ? d.nPartial : null;
          eps = '<div class="eps-bars s-bars" role="img" aria-label="' + esc(T('9 个空间维的饱和度 s')) + '"><div class="eps-th hi" style="bottom:100%"></div>' + cells.join('') + '</div>' +
            '<div class="eps-note">' + esc(T('s=1 完全展开 · s=0 蜷缩 · 其间部分展开 · D=Σs_i=')) + esc(fmtD(d.value)) +
            (nOpen != null ? T('（') + nOpen + T(' 个完全展开') + (nPart ? T('，') + nPart + T(' 个部分展开') : '') + T('）') : '') +
            (d.fractional ? T(' · 分数维') : '') + (d.w != null ? T(' · 过渡宽度 w=') + Number(d.w).toPrecision(3) : '') + '</div>';
        }
        return '<li class="rp-item"><div class="rp-head"><span class="rp-basis ' + basis + '">' + T(BASIS_TAG[basis]) + '</span><b>' + esc(d.symbol || k) + '</b><span class="rp-dname">' + esc(TE(d.name || '')) + '</span>' + statusTag(d.status) + '<span class="rp-verdict val">' + esc(TE(val)) + '</span></div>' +
          '<div class="rp-grid">' + (inputs ? '<span>' + esc(T('由谁决定')) + '</span><span>' + esc(inputs) + '</span>' : '<span>' + esc(T('由谁决定')) + '</span><span>' + esc(T('直接输入')) + '</span>') + (d.formula ? '<span>' + esc(T('公式')) + '</span><span class="formula">' + esc(TE(d.formula)) + '</span>' : '') + '</div>' + eps +
          (d.ref ? '<p class="rp-ref">' + esc(TE(refText(d.ref))) + '</p>' : '') + '</li>';
      }).join('');
      return '<div class="an-sec"><h3>' + esc(T('零、常数由此而来')) + ' <span class="mono">' + esc(T('第 1 层 · ')) + order.length + esc(T(' 项')) + '</span></h3><div class="an-in"><ul class="rp-list">' + lis +
        '</ul><ul class="rp-list" id="anZeroDim">' + zeroDimHTML(sim) + '</ul></div></div>';
    }
    h += derivedHTML();
    function sectionHTML(id, title, items, extraSummary) {
      var sums = calcSummary(id);
      if (!sums.length) (RP_SUMMARY[id] || []).forEach(function (row) { var v = rpFind(pools, row[1]); var txt = rpFmt(v, row[2]); if (txt != null) sums.push('<div><span>' + esc(row[0]) + '</span><b>' + esc(txt) + '</b></div>'); });
      if (id === 'expansion') { var fate = raw.fate || cos.fate || R.fate; if (fate && fate.type) sums.push('<div><span>' + esc(T('结局')) + '</span><b>' + esc(T(fate.type === 'crunch' ? '大挤压' : fate.type === 'rip' ? '大撕裂' : fate.type === 'eternal' || fate.type === 'open' ? '永恒膨胀' : String(fate.type))) + (fate.tLabel ? esc(T('（')) + esc(TE(fate.tLabel)) + esc(T('）')) : '') + '</b></div>'); }
      if (extraSummary) sums = sums.concat(extraSummary);
      var body = '';
      if (sums.length) body += '<div class="rp-sum">' + sums.join('') + '</div>';
      if (id === 'expansion' && sim.series && sim.series.a && sim.series.a.length > 2) body += '<canvas class="spark" id="anSpark" width="540" height="70" aria-label="' + esc(T('尺度因子 a(t) 曲线')) + '"></canvas>';
      if (items.length) body += '<ul class="rp-list">' + items.map(function (f) { return rpItem(f, dScope.broke && !!DIM3_ONLY_FINDINGS[f && f.id]); }).join('') + '</ul>';
      if (!body) return '';
      return '<div class="an-sec"><h3>' + esc(T(title)) + ' <span class="mono">' + items.length + esc(T(' 条')) + '</span></h3><div class="an-in">' + body + '</div></div>';
    }
    if (engineSections) {
      engineSections.forEach(function (sec, i) {
        var items = Array.isArray(sec.findings) ? sec.findings : (Array.isArray(sec.items) ? sec.items : []);
        var sums = Array.isArray(sec.summary) ? sec.summary.map(function (x) { return '<div><span>' + esc(x.label || x.name || '') + '</span><b>' + esc(rpFmt(x.value, x.kind || 'sci') || '') + (x.unit ? ' ' + esc(x.unit) : '') + '</b></div>'; }) : null;
        h += sectionHTML(RP_SECTION_ALIAS[String(sec.id || sec.title || '').toLowerCase()] || sec.id || 'other', sec.title || (T('章节 ') + (i + 1)), items, sums);
      });
    } else {
      var grouped = {}; RP_SECTIONS.forEach(function (sc) { grouped[sc.id] = []; });
      findings.forEach(function (f) { grouped[rpSectionOf(f)].push(f); });
      RP_SECTIONS.forEach(function (sc) { if (sc.id === 'other' && !grouped.other.length) return; h += sectionHTML(sc.id, sc.title, grouped[sc.id]); });
    }
    // 常数核对句
    var items = (sim.constants && sim.constants.items) || [];
    // 常数核对：无量纲那几条照旧；有量纲的四个单独一行，右侧带单位约定切换（A/B/C），切换即时重算
    if (items.length) {
      var plain = items.filter(function (it) { return it.key !== 'dimensionful'; });
      h += '<div class="an-sec"><h3>' + esc(T('常数核对')) + '</h3><div class="an-in"><ul class="const-list" id="anConst">' +
        plain.map(function (it) { return '<li><span class="k">' + esc(TE(it.name)) + '</span><span class="v">' + esc(TE(it.text)) + esc(T('。')) + '</span></li>'; }).join('') + '</ul>' +
        dimRowHTML(sim) +
        (sim.isOurs ? '<p class="ours-line" id="anOurs">' + esc(T('—— 这是我们的宇宙。')) + '</p>' : '') +
        '<p class="rp-text units-note" id="anUnitsNote">' + esc(unitsNote(sim)) + '</p></div></div>';
    }
    // 时间线
    /* 时间线的每一个时刻（复合、第一代恒星、星系形成…）都是 3 维公式给的。
       D≠3 时必须在表头说一句，否则"第一代恒星 2 亿年"看着像这个宇宙真会发生的事。 */
    if (sim.timeline && sim.timeline.length) h += '<div class="an-sec"><h3>' + esc(T('演化时间线')) + '</h3><div class="an-in">' +
      (dScope.off ? '<p class="rp-text">' + esc(T('表中时刻按 3+1 维公式计算，未做 D=') + fmtD(dScope.D) + T(' 的维数修正') + (dScope.broke ? T('；演化链已在维数判据处终止，这些时刻只是外推，不是这个宇宙的历史') : T('，仅供参考'))) + '</p>' : '') +
      '<table class="tl">' + sim.timeline.map(function (it) { return '<tr class="' + (it.happens ? '' : 'no') + '"><td>' + esc(TE(it.name)) + '</td><td>' + esc(TE(it.tLabel || '')) + '</td><td>' + esc(TE(it.note || '')) + '</td></tr>'; }).join('') + '</table></div></div>';
    // 结论
    // BEYOND_MODEL_DIM 这类"超出模型适用范围"的结局不是好也不是坏：中性样式，文案照抄引擎报告
    var conclCls = NEUTRAL_OUTCOMES[t] ? 'neutral' : (t === 'OBSERVERS_POSSIBLE' ? 'good' : (sim.outcome.severity === 'bad' ? 'bad' : ''));
    h += '<div class="an-sec"><h3>' + esc(T('八、结论')) + '</h3><div class="an-in"><p class="rp-conclusion"><span class="' + conclCls + '">' + esc(TE(sim.outcome.title)) + esc(T('。')) + '</span> ' + esc(TE(sim.outcome.description)) +
      (mirrorNoteForReport(sim, t) ? '<br><span class="neutral">' + esc(TE(mirrorNoteForReport(sim, t))) + esc(T('。')) + '</span>' : '') + '</p></div></div>';
    anBody.innerHTML = h;
    // 动作
    anActions.innerHTML = '';
    function act(label, fn, cls) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (cls || ''); b.textContent = label; b.addEventListener('click', fn); anActions.appendChild(b); return b; }
    // BEYOND_MODEL_DIM 也把按钮摆出来，但是禁用态 + title 说明为什么进不去（比按钮凭空消失清楚）
    // 按钮文案随模式走：3d=进入镜像，2d=观测 2 维世界（示意），orbitDemo=轨道投影演示（D=…，无稳定轨道）
    if (STAR_OUTCOMES[t] || NEUTRAL_OUTCOMES[t] || DIM_OUTCOMES[t]) {   // 有恒星的四种结局都要有入口
      var plan = mirrorPlan(sim);
      var bMirror = act(plan.label, function () { enterMirror({ mode: plan.mode }); }, plan.limited ? '' : 'primary');
      bMirror.title = plan.note || '';
      if (!plan.ok) { bMirror.disabled = true; bMirror.className = 'btn'; bMirror.title = plan.note; }
    }
    act(T('把这组创世参数记下来'), function () { var saved = catalogSave({ name: S.entry && S.entry.name && !S.entry.preset ? S.entry.name : (sim.isOurs ? '我们的宇宙' : sim.outcome.title), params: sim.params, modules: sim.modules, outcome: t }, 'manual'); if (saved) { toast(T('已记下：') + saved.label + ' ' + (saved.name || ''), 3600); if (S.entry && S.entry.temp) selectEntry(saved); } });
    act(T('再次引爆'), function () { closeAnalysis(); setState('confirm'); });
    act(T('回放早期宇宙（示意动画）'), replayDetonation);
    /* 站点版（MIRROR_LOCK_TO_BLOCKS）连这颗也收掉（2026-08-21 用户拍板，与下面
       「连续随机引爆」同一把闸）：站点上它虽然已走 MirrorBlockSource 取真区块，
       但每按一次都要打一次被限流的 /api/card，配额是给"人挑区块"的，不该给一颗
       手滑就连点的按钮。离线版照旧。快捷键 R 在 keydown 那头同闸（搜 randomDetonate）。 */
    if (!window.MIRROR_LOCK_TO_BLOCKS) act(T('随机引爆'), randomDetonate);          // 与起爆页"随机宇宙"同一套逻辑；不回起爆页，直接进引爆流程（快捷键 R）
    /* 站点版收掉这个入口（lockToBlocks 的隐藏名单只盖住了起爆页那些 id，
       这颗是分析面板里动态建的，当年漏了）：站点上每个候选都要打 /api/card，
       被限流掐死，5000 次上限纯属画饼。离线版 mirror.html 不设标志，照常有。 */
    if (!window.MIRROR_LOCK_TO_BLOCKS) act(T('连续随机引爆，直到出现可观测的三维宇宙'), openSearch);
    act(T('退回引爆界面'), function () { setState('select'); });
    act(T('关闭'), closeAnalysis, 'ghost');
    anTimer = [];
    var lis = anBody.querySelectorAll('#anConst li');
    Array.prototype.forEach.call(lis, function (li, i) { anTimer.push(setTimeout(function () { li.classList.add('show'); }, sim.isOurs ? (reduced ? 120 : 500) * (i + 1) : 60 * i)); });
    if (sim.isOurs) anTimer.push(setTimeout(function () { var o = $('anOurs'); if (o) o.classList.add('show'); }, (reduced ? 120 : 500) * (lis.length + 1)));
    var sp = $('anSpark'); if (sp) drawSpark(sp, sim.series);
    wireDimRow();                       // 单位约定切换
    setTimeout(function () { $('anClose').focus(); }, 0);
  }
  $('anClose').addEventListener('click', closeAnalysis);
  // 从元素上读 CSS 变量（canvas 的 fillStyle 不吃 var()，只能取计算值）；取不到时回退到给定色
  function cssVar(elm, name, fallback) {
    try { var v = getComputedStyle(elm).getPropertyValue(name); v = v && v.trim(); return v || fallback; } catch (e) { return fallback; }
  }
  var sparkSeries = null;
  function drawSpark(cv, series) {
    if (!cv || !series || !series.a) return;
    sparkSeries = series;
    var c = cv.getContext('2d'), w = cv.width, h = cv.height, a = series.a, tt = series.t;
    // 主题色：底、线、坐标字都从 .spark 上的 token 读，深浅主题各自成立
    c.fillStyle = cssVar(cv, '--spark-bg', '#0B0E1C'); c.fillRect(0, 0, w, h);
    var maxA = 0, maxT = 0; for (var i = 0; i < a.length; i++) { if (isFinite(a[i]) && a[i] > maxA) maxA = a[i]; if (tt && tt[i] > maxT) maxT = tt[i]; }
    maxA = Math.min(maxA, 20) || 1; maxT = maxT || a.length - 1;
    c.strokeStyle = cssVar(cv, '--spark-line', '#62D9FF'); c.lineWidth = 1.5; c.beginPath();
    for (i = 0; i < a.length; i++) { var x = (tt ? tt[i] / maxT : i / (a.length - 1)) * (w - 8) + 4, y = h - 6 - Math.min(a[i], maxA) / maxA * (h - 12); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke();
    c.fillStyle = cssVar(cv, '--spark-ink', '#5C6280'); c.font = '10px Consolas, monospace'; c.fillText('a', 6, 12); c.fillText('t → ' + (maxT ? A.fmtTimeGyr(maxT) : ''), w - 90, h - 8);
  }
  // 切换深/浅主题时重画曲线（canvas 里的像素不会自己跟着 token 变）
  if (window.MutationObserver) {
    new MutationObserver(function () { var sp = $('anSpark'); if (sp && sparkSeries) drawSpark(sp, sparkSeries); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ---------------------------------------------------------- 镜像浏览 */
  // opts.mode：'3d' | '2d' | 'orbitDemo'（来自 mirrorPlan / MirrorPlanets.supportsDim）。
  // 本函数也被当成点击回调用过，参数可能是 Event，所以只认"带字符串 mode 的对象"。
  /* 进镜像这一下在用户真机上量到过 2.0 秒的主线程阻塞（看门狗 dump：
     enterMirrorMs.mbCreate = 2042、enterSystemMs.showSystem = 2029 —— 两处计时包的是同一段）。
     真正的耗时在 MB.create() 里面：镜像带着 starSeed 进来时会当场开到恒星系层，
     于是 planets 的 createView（十几个着色器程序 + 星系/恒星系生成）同步跑在这一帧上，
     mirror.js 自己的 prewarmPV（rIC / 400 ms 兜底）根本还没轮到就被越过去了。
     那一段不在本文件里（ui/mirror.js → ui/planets.js），这里能做也该做的是**别让这一帧看起来像死机**：
     点击当帧先把按钮禁掉、亮出「正在建立镜像…」，让这一帧画得出来，重活挪到下一帧再做。
     阻塞本身还在（要真正消掉得在 mirror/planets 那边把 createView 异步化），但用户不再对着一个没反应的界面。 */
  function enterMirror(opts) {
    var sim = S.sim;
    var plan = mirrorPlan(sim);
    if (!plan.ok) { if (sim) toast(plan.note, 5200); return; }
    if (!(opts && opts.__deferred)) {
      if (S.mirrorPending) return;                 // 连点两下不许建两套
      S.mirrorPending = true;
      var o2 = {};
      if (opts && typeof opts === 'object' && !opts.preventDefault) { for (var k2 in opts) if (Object.prototype.hasOwnProperty.call(opts, k2)) o2[k2] = opts[k2]; }
      o2.__deferred = true;
      ['hudEnter', 'hudStar'].forEach(function (id) { var b = $(id); if (b && !b.disabled) { b.disabled = true; b.dataset.reenable = '1'; } });
      showBusy(T('正在建立镜像'), null);
      var ran = false;
      var go = function () {
        if (ran) return; ran = true;
        S.mirrorPending = false;
        ['hudEnter', 'hudStar'].forEach(function (id) { var b = $(id); if (b && b.dataset && b.dataset.reenable) { b.disabled = false; delete b.dataset.reenable; } });
        try { enterMirror(o2); } finally { hideBusy(); }
      };
      /* rAF 与 setTimeout **两条都挂，谁先到算谁**：rAF 在后台标签页/失焦时根本不触发，
         只挂 rAF 会让「进入镜像」永远停在忙碌条上（本机实测过）。rAF 负责「等这一帧画完再干活」，
         setTimeout 负责兜底。 */
      if (window.requestAnimationFrame) requestAnimationFrame(go);
      setTimeout(go, 60);
      return;
    }
    var mode = (opts && typeof opts === 'object' && typeof opts.mode === 'string') ? opts.mode : plan.mode;
    var pick = (opts && typeof opts === 'object' && opts.starSeed != null) ? opts : null;
    closeAnalysis(); tlStop();
    var web = S.scene && S.scene.sim && S.scene.sim.ready ? { positions: S.scene.sim.positions, density: S.scene.sim.density, N: S.scene.sim.N } : null;
    // 晕表必须在 disposeScene() 之前取：它会 dispose 掉 3D 视图并把 S.u3d 置空，
    // 之后再问就永远是 null，星系目录会白白退化成"按种子生成"
    var halos = haloList(), boxMpc = boxMpcNow();
    /* 进镜像这一帧做的事全部分段计时，结果挂进看门狗 dump（WD.enter）。
       最高粒子档（2M 粒子 / 128³ 网格）下拆 universe3d 要销毁的 GPU 资源与 Worker 都在这一步，
       用户那次 1832 ms 的卡顿正好发生在这里，没有分段就只能靠猜。计时本身是两次 performance.now()。 */
    var _eT = nowMs(), _enter = {};
    disposeScene(); glCanvas.hidden = true;
    _enter.dispose = Math.round(nowMs() - _eT); _eT = nowMs();
    var box = $('mirrorUI'); box.hidden = false;
    S.mirrorMode = mode;
    if (S.mirror) { try { S.mirror.dispose(); } catch (e) { console.warn('[app] 旧 mirror dispose', e); } S.mirror = null; }
    S.mirror = MB.create({ adapter: A, sim: sim, container: box, reducedMotion: reduced, web: web, planetCanvas: planetCanvas,
      dimMode: mode, dimS: dimOf(sim),          // 传给 mirror.js → 再传给 planets：D≠3 时按受限模式渲染
      noLife: !!plan.noLife, lifeNote: plan.lifeNote || '',   // 有恒星无生命：行星层不许自造生命，且要给说明
      starSeed: pick ? pick.starSeed : null, isSun: !!(pick && pick.isSun), starName: pick ? pick.starName : null,
      onExit: function () { exitMirror(); },
      halos: halos, boxMpc: boxMpc,                             // 3D 里识别出的晕 → 镜像的星系目录（拿不到时 mirror 自己退化成按种子生成）
      onNote: function (msg) { toast(msg, 6000); },             // 镜像里的一次性说明（如轨道演示的试探质点）走同一个 toast
      onBusy: function (label) { showBusy(T(label), null); },      // 星球/地表贴图是同步 CPU 活儿，得先有可见反馈
      onBusyDone: function () { hideBusy(); },
      onPlanetCanvas: function (visible) { stage.style.pointerEvents = visible ? 'none' : ''; }
    });
    S.view = {
      name: 'mirror',
      draw: function (ctx, W, H, dt, el) { S.mirror.draw(ctx, W, H, dt, el); driveMirror(dt); },
      // 指针/键盘出错也不能把人踢出镜像：记下来、给一句提示，导航照旧
      pointer: function (type, ev) {
        try { S.mirror.pointer(type, ev, W, H); }
        catch (e) { console.error('[app] 镜像指针事件出错', errContext(), '\n', e && e.stack || e); toast(T('这一下没能执行：') + String(e && e.message || e).slice(0, 80) + T('（详见控制台）'), 5000); }
      },
      key: function (ev) {
        try { if (S.mirror.key(ev)) return true; }
        catch (e) { console.error('[app] 镜像按键出错', errContext(), '\n', e && e.stack || e); toast(T('这一下没能执行：') + String(e && e.message || e).slice(0, 80) + T('（详见控制台）'), 5000); return true; }
        if (ev.key === 'Escape') { if (S.analysisOpen) { closeAnalysis(); return true; } exitMirror(); return true; }
        if (ev.key === 'a' || ev.key === 'A' || ev.key === 'F2') { toggleAnalysis(); return true; }
        return false;
      }
    };
    _enter.mbCreate = Math.round(nowMs() - _eT); _eT = nowMs();
    S.state = 'mirror'; showPage(null); $('timer').hidden = true; $('hudTop').hidden = true; $('hudSide').hidden = true; $('hudBottom').hidden = true; $('enterHint').hidden = true;
    setDisclaim(plan.limited ? plan.note : T('示意：星系 / 恒星系 / 行星 / 地表为过程生成的可视化，不是模拟结果'));
    S.elapsed = 0;
    syncNav();   // 这一支没走 setState（上面直接写的 S.state），顶栏的「选宇宙」要单独对一次
    /* D≠3 的受限模式（orbitDemo）：镜像不再从 3 维网里找晕 —— 那些晕是把牛顿力外推出来的假结构，
       D 维 N 体那一档 halos() 本来就返回 null。直接下潜到恒星系层的轨道投影演示
       （specs/highdim-v1.md §一「进入镜像直接落到恒星系层的轨道投影演示」）。
       pick 非空说明是点了某颗恒星进来的，那条路自己会驱动，不重复下潜。 */
    if (mode === 'orbitDemo' && !pick) S.mirrorDrive = { acc: 0, tries: 0, target: 2 };
    _enter.wireUI = Math.round(nowMs() - _eT);
    _enter.tier = null; _enter.N = null;
    try { var _st3 = S.u3dLast || null; if (_st3) { _enter.tier = _st3.tier; _enter.N = _st3.N; } } catch (e) { /* ignore */ }
    _enter.at = Math.round(nowMs());
    WD.enter = _enter;          // 看门狗 dump 里带上，下次用户贴 dump 直接看是哪一段
  }
  function exitMirror() { if (S.state !== 'mirror') return; S.state = 'detonate'; enterSpaceAgain(); }
  // 回放/退出镜像回到 space 后，把时间线条带重新挂上（否则本宇宙之后再没有事件字幕）
  function relightStrip() { if (S.sim && S.state === 'space') tlStart(S.sim); }
  function enterSpaceAgain() { // 回到太空画面（重建结局场景）
    S.state = 'detonate'; enterSpace();
  }

  /* ---------------------------------------------------------- 右键上下文菜单
   * 菜单项都来自下面的数据表 CTX_ITEMS，每项 { id, label, key, when(st), enabled(st), why(st), run() }：
   *   when     该状态下是否列出这一项（不列 = 完全不出现）
   *   enabled  是否可点；返回 false 时灰显，并把 why(st) 挂到 title 上说明原因（不让按钮凭空消失）
   *   label    字符串或 function(st)（要随状态改文案的用函数）
   *   checked  function(st) → true 时行首打 ✓（体渲染/曝光/低功耗这类开关）
   *   expand   function(st) → 数组，用来插入运行时才知道的项（镜像各层的导航来自 mirror.js）
   * 加新功能只要往表里加一行。 */
  function ctxState() {
    var sim = S.sim, u = S.u3d, us = null;
    if (u) { try { us = u.getState(); } catch (e) { /* 还没就绪 */ } }
    var mb = (S.state === 'mirror' && S.mirror) ? S.mirror : null;
    return {
      state: S.state, sim: sim, u3d: u, u: us, mirror: mb,
      listRow: (S.listOpen && S.activeRow >= 0) ? rows[S.activeRow] : null,   // 下拉打开且有高亮行时可以直接删这一条
      is3D: !!(S.view && S.view.is3D), analysisOpen: !!S.analysisOpen,
      theme: (window.MirrorTheme && window.MirrorTheme.get()) || 'light'
    };
  }
  var CTX_SEP = { sep: true };
  function ctxNo3D(st) { return st.is3D ? '' : (S.no3D ? T('这台机器/浏览器没能开起 3D 视图，当前是 2D 粒子网回退画面') : T('当前不是 3D 视图')); }
  function ctxSpace(st) { return st.state === 'space'; }
  function ctxMirror(st) { return st.state === 'mirror'; }
  function ctxSelect(st) { return st.state === 'select' || st.state === 'confirm'; }
  function ctx3dRun(fn) { return function () { if (S.u3d) { try { fn(S.u3d); } catch (e) { console.warn('[app] 菜单动作失败', e); } } }; }
  var CTX_ITEMS = [
    /* —— 第一项固定是分析面板：以前右键单击就是它，改成菜单后位置不变，肌肉记忆不断 —— */
    { id: 'analysis', key: 'A', label: function (st) { return st.analysisOpen ? '关闭分析面板' : '分析面板'; },
      when: function () { return true; },
      enabled: function (st) { return !!st.sim && (st.state === 'space' || st.state === 'mirror'); },
      why: function () { return '还没有引爆的宇宙：先在起爆界面选一组参数引爆'; },
      run: toggleAnalysis },
    CTX_SEP,
    /* —— space：3D 观测与显示 —— */
    { id: 'overview', key: 'O', label: '俯瞰全盒', when: ctxSpace, enabled: function (st) { return !!st.u3d; }, why: ctxNo3D,
      checked: function (st) { return !!(st.u && st.u.overview); }, run: ctx3dRun(function (u) { u.toggleOverview(); }) },
    { id: 'flyDense', key: 'F', label: '飞到最密处', when: ctxSpace, enabled: function (st) { return !!st.u3d; }, why: ctxNo3D,
      run: ctx3dRun(function (u) { u.flyTo('densest'); }) },
    { id: 'flyHalo', key: 'H', label: '飞入随机晕', when: ctxSpace, enabled: function (st) { return !!st.u3d; }, why: ctxNo3D,
      run: ctx3dRun(function (u) { u.flyTo('randomHalo'); }) },
    { id: 'randStar', label: '随机选一颗恒星', when: ctxSpace,
      enabled: function (st) { return !!st.u3d && matterOf(st.sim) === 'stars' && canMirror(st.sim); },
      why: function (st) {
        if (!st.u3d) return ctxNo3D(st);
        if (matterOf(st.sim) !== 'stars') return T('这个宇宙里没有恒星（结局：') + T((st.sim && st.sim.outcome && st.sim.outcome.title) || '') + T('），3D 视图不生成星系，也没有恒星可选');
        return mirrorNote(st.sim);
      },
      run: function () {
        var sim = S.sim; if (!sim) return;
        var r = A.rng(((sim.seed >>> 0) ^ (Date.now() & 0xffffff)) >>> 0);
        enterMirrorFromStar((r() * 4294967295) >>> 0, { name: '随机恒星' });
      } },
    { id: 'volume', key: 'V', label: '体渲染', when: ctxSpace, enabled: function (st) { return !!st.u3d; }, why: ctxNo3D,
      checked: function (st) { return !!(st.u && st.u.volume); }, run: ctx3dRun(function (u) { u.toggleVolume(); }) },
    { id: 'exposure', label: function (st) { return T('曝光 ') + (st.u && st.u.exposureAuto === false ? T('手动 0 EV') : T('自动')); },
      when: ctxSpace, enabled: function (st) { return !!st.u3d; }, why: ctxNo3D,
      checked: function (st) { return !!(st.u && st.u.exposureAuto); },
      run: ctx3dRun(function (u) { var s = null; try { s = u.getState(); } catch (e) {} u.setExposure(s && s.exposureAuto ? 0 : 'auto'); }) },
    { id: 'lowPower', label: '低功耗', when: ctxSpace, enabled: function (st) { return !!st.u3d; }, why: ctxNo3D,
      checked: function (st) { return !!(st.u && st.u.lowPower); },
      run: ctx3dRun(function (u) { var s = null; try { s = u.getState(); } catch (e) {} u.setLowPower(!(s && s.lowPower)); }) },
    { id: 'enterMirror', key: 'M', label: function (st) { return mirrorPlan(st.sim).label; }, when: ctxSpace,
      enabled: function (st) { return mirrorPlan(st.sim).ok; }, why: function (st) { return mirrorNote(st.sim); },
      run: function () { var pl = mirrorPlan(S.sim); if (pl.ok) enterMirror({ mode: pl.mode }); else toast(pl.note, 5200); } },
    { id: 'again', label: '再次引爆', when: ctxSpace, run: function () { closeAnalysis(); setState('confirm'); } },
    { id: 'randomBang', key: 'R', label: '随机引爆', when: function (st) { return ctxSpace(st) && !window.MIRROR_LOCK_TO_BLOCKS; }, run: randomDetonate },
    { id: 'backSelect', key: 'Esc', label: '退回起爆界面', when: ctxSpace, run: function () { setState('select'); } },
    /* —— mirror：各层导航由 mirror.js 现给（层级不同，能做的事也不同） —— */
    { id: 'mirrorNav', when: ctxMirror, expand: function (st) {
        var list = [];
        try { list = (st.mirror && st.mirror.menu && st.mirror.menu()) || []; } catch (e) { console.warn('[app] mirror.menu 失败', e); }
        return list.map(function (m) {
          var row = { id: 'mb_' + m.id, label: m.label, key: m.key || '',
            when: function () { return true; },
            enabled: function () { return m.enabled !== false; },
            why: function () { return m.note || ''; },
            run: m.run };
          // 二级菜单（mirror.js 的「寻找指定天体 ▸」）：原样带过来，渲染那一步认 sub / subNote
          if (m.sub && m.sub.length) {
            row.subNote = m.subNote || '';
            row.sub = m.sub.map(function (s) {
              return { id: 'mb_' + s.id, label: s.label, key: s.key || '',
                enabled: function () { return s.enabled !== false; },
                why: function () { return s.note || ''; },
                run: s.run };
            });
          }
          return row;
        });
      } },
    { id: 'exitMirror', key: 'Esc', label: '退出镜像', when: ctxMirror, run: function () { exitMirror(); } },
    /* —— 起爆界面 —— */
    /* 示例参数组开的是编辑器（非区块参数），站点版与编辑器同闸收掉 */
    { id: 'examples', label: '加载示例参数组', when: function (st) { return ctxSelect(st) && !window.MIRROR_LOCK_TO_BLOCKS; },
      enabled: function (st) { return st.state === 'select'; }, why: function () { return '先按 Esc 退回起爆界面'; },
      run: function () {
        openEditor(true);
        var ex = $('editor').querySelector('.ex-box');
        if (ex) { ex.open = true; setTimeout(function () { try { ex.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }, 0); }
      } },
    { id: 'delRow', when: function (st) { return st.state === 'select' && st.listRow; },
      label: function (st) { return T('删除这一条') + T('（') + (st.listRow.label || '') + T('）'); },
      run: function () { if (S.listOpen && rows[S.activeRow]) askDeleteRow(rows[S.activeRow]); } },
    /* 起爆页这条走的是 randomEntry()（纯随机参数，不经区块）——站点版必须收：
       这是"造出非区块宇宙"的正门之一，lockToBlocks 的隐藏名单只盖住了页面按钮。 */
    { id: 'bangRandom', label: '开始随机引爆', when: function (st) { return ctxSelect(st) && !window.MIRROR_LOCK_TO_BLOCKS; },
      enabled: function (st) { return st.state === 'select'; }, why: function () { return '已经在确认页了：按 Enter 引爆，或 Esc 退回起爆界面'; },
      run: function () { selectEntry(randomEntry()); setState('confirm'); } },
    CTX_SEP,
    /* —— 通用 —— */
    { id: 'catalog', label: '管理目录', when: function () { return window.ARCBANG_SITE !== 'arc'; }, run: openCatalog },
    /* 参数编辑器 = 手调非区块参数，站点版收掉（页面上的 btnEditor/actEdit 早被
       lockToBlocks 藏了，这条菜单是当年漏的最后一个入口） */
    { id: 'editor', label: '参数编辑器', when: function () { return !window.MIRROR_LOCK_TO_BLOCKS; },
      enabled: function (st) { return st.state === 'select'; },
      why: function () { return '参数编辑器只属于起爆界面：先退回起爆界面（Esc）再打开'; },
      run: function () { openEditor(true); } },
    /* 站点版把这条收掉：每个候选都要打一次被限流的 /api/card，
       搜索上限 5000 次在那道闸下根本走不完（见 web/arc-ui.js 的 lockToBlocks）。
       离线版没有这个限制，照常可用。 */
    { id: 'search', label: '连续随机引爆', when: function () { return !window.MIRROR_LOCK_TO_BLOCKS; }, run: openSearch },
    { id: 'about', label: '关于与来源', when: function () { return true; }, run: openAbout },
    { id: 'theme', label: function (st) { return st.theme === 'dark' ? T('主题切换：深色 → 浅色') : T('主题切换：浅色 → 深色'); },
      when: function () { return true; },
      enabled: function () { return !!window.MirrorTheme; }, why: function () { return '主题模块未加载（缺 ui/theme.js）'; },
      run: function () { if (window.MirrorTheme) window.MirrorTheme.toggle(); } }
  ];
  function ctxResolve(v, st, dflt) { return typeof v === 'function' ? v(st) : (v == null ? dflt : v); }
  // 把数据表摊平成这一刻真正要画的行（含 expand 出来的动态项），并把多余/连续的分隔线去掉
  function ctxBuild(st) {
    var out = [];
    CTX_ITEMS.forEach(function (it) {
      if (it.sep) { out.push(it); return; }
      if (!ctxResolve(it.when, st, true)) return;
      if (it.expand) { (it.expand(st) || []).forEach(function (sub) { out.push(sub); }); return; }
      out.push(it);
    });
    var rows = [], i;
    for (i = 0; i < out.length; i++) {
      if (out[i].sep) { if (!rows.length || rows[rows.length - 1].sep) continue; }
      rows.push(out[i]);
    }
    while (rows.length && rows[rows.length - 1].sep) rows.pop();
    return rows;
  }
  var CTX = { box: null, items: null, idx: -1, from: null };
  function ctxClose() {
    if (!CTX.box) return;
    CTX.box.remove(); CTX.box = null; CTX.items = null; CTX.idx = -1;
    var f = CTX.from; CTX.from = null;
    if (f && f.focus && document.body.contains(f)) { try { f.focus(); } catch (e) { /* ignore */ } }
  }

  /* ---------------------------------------------------------- 二级菜单
   * 「寻找指定天体 ▸」那一类：一级菜单里只占一行，展开才是那几类天体。
   * 宽屏是飞出式（position:fixed —— .ctx-menu 自己 overflow-y:auto，绝对定位的子层会被它裁掉）；
   * ≤900px 就地展开成缩进的一段，手机上没有"悬停"可言，飞出层也没地方飞。 */
  var CTX_CSS_DONE = false;
  function ctxCss() {
    if (CTX_CSS_DONE || !document.head) return;
    CTX_CSS_DONE = true;
    var s = document.createElement('style');
    s.id = 'ctxSubCss';
    s.textContent = [
      '.ctx-group{position:relative}',
      '.ctx-item.ctx-parent[aria-expanded="true"]{background:var(--hi-bg);color:var(--hi-ink)}',
      '.ctx-sub{position:fixed;z-index:9501;min-width:210px;max-width:min(320px,92vw);padding:4px 0;',
      '  background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-pop);',
      '  box-shadow:var(--shadow-pop);font-size:13px;color:var(--ink);max-height:70vh;overflow-y:auto}',
      '.ctx-sub[hidden]{display:none}',
      '.ctx-subnote{padding:3px 12px 5px;font-size:10px;line-height:1.55;color:var(--dim);white-space:normal}',
      '.ctx-sub .ctx-item{padding-left:12px}',
      '@media (max-width:900px){',
      '  .ctx-sub{position:static;min-width:0;max-width:none;max-height:none;padding:2px 0 4px;',
      '    background:none;border:0;border-left:2px solid var(--line);border-radius:0;box-shadow:none;margin:0 0 2px 18px}',
      '  .ctx-subnote{padding-left:10px}',
      '  .ctx-sub .ctx-item{padding-left:10px}',
      '}'
    ].join('');
    document.head.appendChild(s);
  }
  // 当前真正能按到的行：折叠着的二级项不算（键盘上下跳过它们）
  function ctxVisibleItems() {
    if (!CTX.box) return [];
    return Array.prototype.slice.call(CTX.box.querySelectorAll('.ctx-item')).filter(function (b) {
      var p = b.parentNode;
      return !(p && String(p.className || '').indexOf('ctx-sub') >= 0 && p.hidden);
    });
  }
  function ctxPlaceSub(parent, sub) {
    var VW = window.innerWidth || 0, VH = window.innerHeight || 0;
    if (!VW || VW <= 900) { sub.style.left = ''; sub.style.top = ''; return; }   // 窄屏就地展开，不定位
    var r = parent.getBoundingClientRect();
    sub.style.left = '0px'; sub.style.top = '0px';                                 // 先归零再量，免得沿用上一次的位置
    var w = sub.offsetWidth, h = sub.offsetHeight;
    var x = r.right + 2, y = r.top - 4;
    if (x + w > VW - 6) x = Math.max(6, r.left - w - 2);      // 右边放不下 → 翻到一级菜单左侧
    if (y + h > VH - 6) y = Math.max(navH() + 6, VH - h - 6);
    sub.style.left = Math.round(x) + 'px'; sub.style.top = Math.round(y) + 'px';
  }
  function ctxSubOpen(parent, on) {
    if (!CTX.box) return;
    var group = parent.parentNode, sub = group && group.querySelector('.ctx-sub');
    if (!sub) return;
    // 一次只开一个：开这条之前先把别的收回去
    Array.prototype.forEach.call(CTX.box.querySelectorAll('.ctx-sub'), function (s) {
      if (s === sub) return;
      s.hidden = true;
      var pb = s.parentNode.querySelector('.ctx-parent');
      if (pb) pb.setAttribute('aria-expanded', 'false');
    });
    sub.hidden = !on;
    parent.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) ctxPlaceSub(parent, sub);
    /* 窄屏就地展开：菜单当场变高，原来算好的位置可能把下半截顶出视口。
       往上挪回来（不越过顶栏），再把展开的那一段滚进可视区。 */
    if (on && (window.innerWidth || 0) <= 900) {
      var VH2 = window.innerHeight || 0, r2 = CTX.box.getBoundingClientRect();
      if (VH2 && r2.bottom > VH2 - 6) {
        var top2 = parseFloat(CTX.box.style.top);
        if (!isFinite(top2)) top2 = r2.top;
        CTX.box.style.top = Math.round(Math.max(navH() + 6, top2 - (r2.bottom - (VH2 - 6)))) + 'px';
      }
      try { sub.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }
    CTX.items = ctxVisibleItems();
    CTX.idx = CTX.items.indexOf(document.activeElement);
  }
  function ctxSubOf(btn) {   // 这个按钮属于哪个展开着的二级菜单（不在任何二级菜单里就返回 null）
    var p = btn && btn.parentNode;
    return (p && String(p.className || '').indexOf('ctx-sub') >= 0) ? p : null;
  }
  function ctxOpen(px, py) {
    ctxClose();
    var st = ctxState(), rows = ctxBuild(st);
    if (!rows.length) return;
    var box = document.createElement('div');
    box.className = 'ctx-menu'; box.setAttribute('role', 'menu'); box.setAttribute('aria-label', T('右键菜单'));
    ctxCss();
    var h = '', n = 0, acts = [];
    function rowHTML(it, cls, keyTxt) {
      var on = ctxResolve(it.enabled, st, true);
      var why = on ? '' : T(String(ctxResolve(it.why, st, '') || '当前状态下不可用'));
      var mark = ctxResolve(it.checked, st, false) ? '✓' : '';
      acts.push(it);
      return '<button type="button" role="menuitem" class="ctx-item' + (on ? '' : ' off') + (cls ? ' ' + cls : '') +
        '" data-i="' + (n++) + '"' + (on ? '' : ' disabled aria-disabled="true"') + (why ? ' title="' + esc(why) + '"' : '') +
        (it.sub ? ' aria-haspopup="true" aria-expanded="false"' : '') + '>' +
        '<span class="ctx-mark">' + mark + '</span><span class="ctx-label">' + esc(T(ctxResolve(it.label, st, it.id))) + '</span>' +
        '<span class="ctx-key">' + esc(keyTxt != null ? keyTxt : (it.key || '')) + '</span></button>';
    }
    rows.forEach(function (it) {
      if (it.sep) { h += '<div class="ctx-sep" role="separator"></div>'; return; }
      if (!it.sub || !it.sub.length) { h += rowHTML(it, '', null); return; }
      // 二级项：父行 + 一个默认收起的子层（子层顶上先说一句这组是干什么的）
      h += '<div class="ctx-group">' + rowHTML(it, 'ctx-parent', '▸') +
        '<div class="ctx-sub" role="menu" hidden>' +
        (it.subNote ? '<div class="ctx-subnote">' + esc(T(it.subNote)) + '</div>' : '') +
        it.sub.map(function (s) { return rowHTML(s, '', null); }).join('') +
        '</div></div>';
    });
    box.innerHTML = h;
    document.body.appendChild(box);
    CTX.box = box;
    CTX.from = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : null;
    CTX.items = ctxVisibleItems();
    Array.prototype.slice.call(box.querySelectorAll('.ctx-item')).forEach(function (b, i) {
      var it = acts[i];
      if (it && it.sub && it.sub.length) {
        // 父行：点一下开合，鼠标移上去就展开（宽屏的老习惯）；它自己不执行任何动作
        b.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var open = b.getAttribute('aria-expanded') !== 'true';
          ctxSubOpen(b, open);
          // 点开（含键盘 Enter）就把焦点送进子层第一条，不然按 ↓ 会跳到下一条一级项
          if (open) {
            var sub = b.parentNode.querySelector('.ctx-sub');
            var first = sub && sub.querySelector('.ctx-item:not([disabled])');
            if (first) { try { first.focus(); } catch (e) { /* ignore */ } CTX.idx = CTX.items.indexOf(first); }
          }
        });
        b.addEventListener('mouseenter', function () { if ((window.innerWidth || 0) > 900) ctxSubOpen(b, true); });
        return;
      }
      b.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        ctxClose();
        if (it && it.run) { try { it.run(); } catch (e) { console.error('[app] 菜单动作出错', e); toast(T('这一项没能执行：') + (e && e.message), 4000); } }
      });
    });
    // 鼠标移到别的一级项上：把展开着的子层收回去（否则它会一直挂在那儿挡住下面几行）
    Array.prototype.slice.call(box.children).forEach(function (el) {
      if (String(el.className || '').indexOf('ctx-item') < 0) return;
      el.addEventListener('mouseenter', function () {
        if ((window.innerWidth || 0) <= 900) return;
        var open = box.querySelector('.ctx-sub:not([hidden])');
        if (open) { open.hidden = true; var pb = open.parentNode.querySelector('.ctx-parent'); if (pb) pb.setAttribute('aria-expanded', 'false'); CTX.items = ctxVisibleItems(); }
      });
    });
    // 靠近视口边缘自动翻转；实在放不下就贴边 + 内部滚动（1024×640 也不出界）
    var VW = window.innerWidth || document.documentElement.clientWidth || 0;
    var VH = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!VW || !VH) { VW = 1e5; VH = 1e5; }   // 拿不到视口尺寸（无合成的隐藏窗口会报 0）：不翻转也不限高，按原位放
    var navTop = navH();                              // 顶栏占着最上面这一条，菜单只能从它下面开始
    box.style.maxHeight = Math.max(120, VH - navTop - 12) + 'px';
    var w = box.offsetWidth, hh = box.offsetHeight;
    var x = px + 2, y = py + 2;
    if (x + w > VW - 6) x = px - w - 2;                 // 右边放不下 → 翻到指针左侧
    if (x < 6) x = Math.max(6, VW - w - 6);
    if (y + hh > VH - 6) y = py - hh - 2;               // 下边放不下 → 翻到指针上方
    if (y < navTop + 6) y = navTop + 6;                 // 上边界是顶栏下沿，不是视口顶部
    box.style.left = Math.round(x) + 'px'; box.style.top = Math.round(y) + 'px';
    ctxFocus(0, 1);
    return true;
  }
  function ctxFocus(from, dir) {   // 键盘上下选择：跳过灰显项
    if (!CTX.items || !CTX.items.length) return;
    var n = CTX.items.length, i = from;
    for (var k = 0; k < n; k++) {
      var b = CTX.items[((i % n) + n) % n];
      if (!b.disabled) { CTX.idx = ((i % n) + n) % n; try { b.focus(); } catch (e) { /* ignore */ } return; }
      i += dir;
    }
  }
  document.addEventListener('keydown', function (ev) {
    if (!CTX.box) return;
    /* 二级菜单的进出：→ / Enter 进，← / Esc 退回父行。
       Esc 分两层：子层开着时先收子层，再按一次才关整个菜单（和「一路退出去」的直觉一致）。 */
    // 以真实焦点为准（鼠标悬停展开子层时 CTX.idx 可能还停在上一行）
    var ae = document.activeElement;
    var cur = (ae && CTX.box.contains(ae) && String(ae.className || '').indexOf('ctx-item') >= 0)
      ? ae : (CTX.items && CTX.idx >= 0 ? CTX.items[CTX.idx] : null);
    if (cur && CTX.items) { var ci = CTX.items.indexOf(cur); if (ci >= 0) CTX.idx = ci; }
    var inSub = ctxSubOf(cur);
    if (ev.key === 'ArrowRight' && cur && cur.getAttribute('aria-haspopup') === 'true') {
      ev.preventDefault(); ev.stopPropagation();
      ctxSubOpen(cur, true);
      var sub0 = cur.parentNode.querySelector('.ctx-sub');
      var f0 = sub0 && sub0.querySelector('.ctx-item:not([disabled])');
      if (f0) { try { f0.focus(); } catch (e) { /* ignore */ } CTX.idx = CTX.items.indexOf(f0); }
      return;
    }
    if ((ev.key === 'ArrowLeft' || ev.key === 'Escape') && inSub) {
      ev.preventDefault(); ev.stopPropagation();
      var pb = inSub.parentNode.querySelector('.ctx-parent');
      ctxSubOpen(pb, false);
      if (pb) { try { pb.focus(); } catch (e) { /* ignore */ } CTX.idx = CTX.items.indexOf(pb); }
      return;
    }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ctxClose(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); ctxFocus(CTX.idx + 1, 1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); ctxFocus(CTX.idx - 1, -1); return; }
    if (ev.key === 'Home') { ev.preventDefault(); ev.stopPropagation(); ctxFocus(0, 1); return; }
    if (ev.key === 'End') { ev.preventDefault(); ev.stopPropagation(); ctxFocus(CTX.items.length - 1, -1); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); ctxFocus(CTX.idx + (ev.shiftKey ? -1 : 1), ev.shiftKey ? -1 : 1); return; }
    // Enter / 空格由按钮自己处理（原生 click），别在这里再拦一次
    ev.stopPropagation();
  }, true);
  /* 3D 后端探测失败（WebGPU 拿不到适配器/设备）会在模块内部产生一个 promise rejection。
     正常路径上它已经被接住并回退到 WebGL2，用户什么也不用做；但在"初始化没跑完就切走/重载"
     这类时序下仍可能漏成 Uncaught (in promise)，在控制台留一条红字，看着像崩了。
     这里只降级这一类已知的探测失败（按消息匹配，且当前确实已经回退成功），其它 rejection 一律照旧抛红，不掩盖真问题。 */
  var GPU_PROBE_RE = /requestAdapter|requestDevice|navigator\.gpu|WebGPU/i;
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason, msg = String((r && r.message) || r || '');
    if (!GPU_PROBE_RE.test(msg)) return;                      // 不认识的错误：留给控制台，正常报红
    ev.preventDefault();
    console.warn('[app] 3D 后端探测失败，已回退（不影响使用）：' + msg);
  });
  window.addEventListener('resize', ctxClose);
  window.addEventListener('blur', ctxClose);
  document.addEventListener('wheel', function () { ctxClose(); }, true);
  document.addEventListener('scroll', function () { ctxClose(); }, true);

  /* ---------------------------------------------------------- 输入
   * 右键：3D 视图里按住拖动 = 相机转向（universe3d 自己处理），短单击（位移 < 5 px 且 < 400 ms）= 弹出菜单；
   * 其它画面（起爆页 / 2D / 镜像各层 / 星球地表）右键直接弹菜单。原生 contextmenu 一律吃掉，
   * 只有输入框/文本域例外——那里还得留着系统的复制粘贴。 */
  var rclick = null;
  function inField(t) { var tag = (t && t.tagName) || ''; return tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable); }
  function inMenu(t) { return !!(CTX.box && t && CTX.box.contains(t)); }
  // 模态对话框开着时不弹菜单：它盖在菜单上面，弹出来只会看不见还抢走焦点。
  // .export-box = 管理目录 / 连续随机引爆 / 导出 / 确认框（z-index 9999）；
  // .about-box = 关于与来源（z-index 90）——以前漏算，About 开着仍能右键开出更上层的 export-box
  function modalUp() { return !!document.querySelector('.export-box') || !!(aboutBox && !aboutBox.hidden); }
  function ctxAllowed(t) { return !inField(t) && !inMenu(t) && !modalUp(); }
  document.addEventListener('pointerdown', function (ev) {
    if (CTX.box && !inMenu(ev.target)) ctxClose();      // 点别处关菜单
    if (ev.button !== 2) return;
    rclick = ctxAllowed(ev.target) ? { x: ev.clientX, y: ev.clientY, t: (window.performance && performance.now()) || Date.now() } : null;
  }, true);
  document.addEventListener('pointerup', function (ev) {
    if (ev.button !== 2 || !rclick) return;
    var dt = ((window.performance && performance.now()) || Date.now()) - rclick.t;
    var d = Math.abs(ev.clientX - rclick.x) + Math.abs(ev.clientY - rclick.y);
    rclick = null;
    if (!ctxAllowed(ev.target)) return;
    // 3D 视图：只有"短单击"才弹菜单，按住拖动那一下留给相机转向
    if (S.view && S.view.is3D && !(dt < 400 && d < 5)) return;
    // 只 preventDefault，不 stopPropagation：universe3d / planets 的 pointerup 还要用来收尾拖拽状态
    // （吞掉它 cam.dragging 会一直是 true，之后不按键也会转视角）
    ev.preventDefault();
    ctxOpen(ev.clientX, ev.clientY);
  }, true);
  document.addEventListener('contextmenu', function (ev) { if (!inField(ev.target)) ev.preventDefault(); });
  stage.addEventListener('mousedown', function (ev) { if (ev.button !== 0) return; if (S.view && S.view.pointer) S.view.pointer('down', ev); });
  stage.addEventListener('dblclick', function (ev) { if (S.view && S.view.pointer) S.view.pointer('dblclick', ev); });
  stage.addEventListener('wheel', function (ev) { if (S.view && S.view.pointer) { S.view.pointer('wheel', ev); if (S.state === 'mirror') ev.preventDefault(); } }, { passive: false });
  document.addEventListener('keydown', function (ev) {
    if (ev.defaultPrevented) return;
    if (!aboutBox.hidden) { if (ev.key === 'Escape') { ev.preventDefault(); closeAbout(); } return; }   // 关于面板是模态
    var tag = (ev.target && ev.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (S.state === 'select') {
      if (ev.key === 'Escape') { if (S.editorOpen) { openEditor(false); ev.preventDefault(); } else if (S.listOpen) { openList(false); ev.preventDefault(); } }
      return;
    }
    if (S.state === 'confirm') { if (ev.key === 'Escape') { setState('select'); ev.preventDefault(); } else if (ev.key === 'Enter' && !typing && document.activeElement !== $('btnCancel')) { detonate(); ev.preventDefault(); } return; }
    if (typing && ev.key !== 'Escape') return;
    // R：分析界面打开时 = 随机引爆（与底部按钮同一动作）。放在 view.key 之前，免得被 3D 的 R（随机晕）吃掉
    if (S.analysisOpen && (ev.key === 'r' || ev.key === 'R')) {
      ev.preventDefault();                             // 站点版也要吞掉：不吞会漏给 3D 的 R（随机晕）
      if (!window.MIRROR_LOCK_TO_BLOCKS) randomDetonate();   // 站点版按 R 无反应（按钮已收，按键跟上）
      return;
    }
    if (S.view && S.view.key && S.view.key(ev)) ev.preventDefault();
  });

  /* ---------------------------------------------------------- 主循环 */
  // 一帧：主循环与调试用的 step() 都走这里，出错处理只有一份
  /* 出错时的现场：层级 / 维数模式 / 各层种子 / 结局 —— 用户报"点星系崩了"这类问题时，
     光有一行 stack 定位不到是哪一层的哪个天体。 */
  function errContext() {
    var c = { state: S.state, view: S.view && S.view.name };
    var sim = S.sim;
    if (sim) { c.outcome = sim.outcome && (sim.outcome.type || sim.outcome.id); c.idLabel = sim.idLabel; c.seed = sim.seed; c.dimS = dimOf(sim); }
    c.dimMode = S.mirrorMode || null;
    if (S.mirror) {
      var st = null; try { st = S.mirror.state(); } catch (e) { /* ignore */ }
      if (st) {
        c.level = st.level;
        c.galaxy = st.galaxy ? (st.galaxy.name + ' / seed ' + (st.galaxy.seed >>> 0)) : null;
        c.system = st.system ? (st.system.name + ' / seed ' + (st.system.seed >>> 0)) : null;
        c.planet = st.planet ? (st.planet.name + (st.planet._pv && st.planet._pv.bodyKind ? ' / ' + st.planet._pv.bodyKind : '')) : null;
        c.T = st.T; c.trans = !!st.trans; c.locating = !!(st.locating || st.locateSeq);
      }
    }
    return c;
  }
  /* 绘制出错的处理原则：**绝不把用户踢回起爆页**。
     以前这里把 S.view 换成一个只认 Esc→setState('select') 的替身，用户下意识按 Esc 就被弹回主页，
     看起来就是"崩溃了退回主页"。现在只是暂停绘制，视图/键盘/指针/面包屑/右键菜单全部保留，
     用户往上退一级（或换个天体）会自动清掉错误状态、恢复绘制。 */
  function noteDrawError(err) {
    var msg = String((err && err.message) || err || T('未知错误'));
    S.drawErr = { msg: msg, level: mirrorLevelNow() };
    console.error('[app] 绘制出错', errContext(), '\n', (err && err.stack) || err);
    toast(T('画面出错：') + msg.slice(0, 80) + T('（Esc 退回上一级 · 详见控制台）'), 6000);
  }
  function mirrorLevelNow() {
    if (!S.mirror) return -1;
    try { var st = S.mirror.state(); return st ? st.level : -1; } catch (e) { return -1; }
  }
  function drawFrame(dt) {
    if (!S.view) return;
    S.elapsed += dt;
    // 出错后：换一层（用户退回上一级 / 换个星系）就再试一次，别一直黑着
    if (S.drawErr) { if (mirrorLevelNow() !== S.drawErr.level) S.drawErr = null; else return; }
    try { S.view.draw(ctx, W, H, dt, S.elapsed); }
    catch (err) { noteDrawError(err); }
  }
  /* ------------------------------------------------------------------ 假死看门狗（纯诊断）
   * 目的：页面整个卡住时，把"卡住那一刻的现场"留下来——用户复现一次就能贴给我们，不用再猜。
   * 机制：内联 Worker（Blob URL，不新增文件）每 100 ms 通过 MessageChannel ping 主线程，
   *       主线程在 port.onmessage 里原样回一个 pong。Worker 侧看"上一次 pong 到现在"有多久：
   *       超过 1 s 就记下卡顿起点；等主线程活过来（pong 终于回到）再把这一段的时长报上来，
   *       主线程此时才 dump 现场（卡住的当下主线程什么都做不了，只能等它恢复）。
   * 约束：Worker / Blob / MessageChannel 任一不可用就静默跳过；全部逻辑包在 try 里，
   *       看门狗自己绝不能把 app 弄挂；不碰任何物理与渲染逻辑，只在 loop 里多记两个数。 */
  function nowMs() { return (window.performance && performance.now()) ? performance.now() : Date.now(); }
  var WD = {
    on: false, frames: [], fi: 0, lastInput: null, port: null, worker: null, enter: null,
    STALL_MS: 1000, KEY: 'mirror.watchdog.last',
    rec: function (gap, draw) {          // 最近 20 帧：[帧间隔 ms, drawFrame 耗时 ms]
      WD.frames[WD.fi] = [Math.round(gap), Math.round(draw * 100) / 100];
      WD.fi = (WD.fi + 1) % 20;
    },
    recent: function () {                // 环形缓冲按时间顺序摊平
      var out = [], i;
      for (i = 0; i < 20; i++) { var f = WD.frames[(WD.fi + i) % 20]; if (f) out.push(f); }
      return out;
    }
  };
  function wdSnapshot(stallMs) {
    var c = {};
    try { c = errContext(); } catch (e) { c = { errContext: 'failed: ' + String(e && e.message || e) }; }
    c.stallMs = Math.round(stallMs);
    c.at = new Date().toISOString();
    c.visibility = (typeof document !== 'undefined' && document.visibilityState) || null;
    c.lastInput = WD.lastInput;
    c.inputLagMs = WD.inputLagMs || 0;           // 本次会话里「点击 → 下一帧」的最大间隔
    c.inputLagOn = WD.inputLagOn || null;        // 以及那一下点在了什么上
    /* 3D 视图里「最近一次超过 120 ms 的那一段是谁」：universe3d 每帧分段计时的结果。
       用户那次「滚轮缩放卡 3.2 秒」只留下 stallMs，没有下文；有了这个字段下一份 dump 能直接指名。 */
    try { var hs = null; try { hs = S.u3d && S.u3d.getState && S.u3d.getState(); } catch (e3) { /* 还没就绪 */ }
      if (hs && hs.lastHeavy) { c.u3dHeavy = hs.lastHeavy; c.u3dHeavyLog = hs.heavyLog || null; }
    } catch (e) { /* ignore */ }
    /* 干预沙盒的现场（web/intervene.js 的 wdInfo）：卡住那一刻选的是哪个目标、
       哪件重活跑了多久、上一步推的是谁。用户报「选冷液体宇宙的时候卡死了」时，
       原来 dump 里一个字都没有，只能靠猜；有了这一段下一份 dump 直接指名。 */
    try {
      var sb = window.MirrorIntervene && window.MirrorIntervene.wdInfo && window.MirrorIntervene.wdInfo();
      if (sb) c.sandbox = sb;
    } catch (e) { /* 沙盒自己出问题也不许把这份现场弄丢 */ }
    c.frames = WD.recent();              // [[帧间隔, drawFrame 耗时] × ≤20]
    try {
      var pv = S.mirror && S.mirror.planetsView && S.mirror.planetsView();
      if (pv) {
        var ps = pv.getState ? pv.getState() : null;
        if (ps) { c.pvMode = ps.mode; c.sysDim = ps.dim; c.pvDimMode = ps.dimMode; }
        var ts = pv.getTimeScale ? pv.getTimeScale() : null;
        if (ts) { c.speedMul = ts.mul; c.yrPerSec = ts.yrPerSec; }
        /* 卡住那一刻在画哪颗行星、它的贴图做到哪一步。
           用户报「点随机一个星球卡死」时，dump 里只有 stallMs，看不出是贴图生成还是着色器链接；
           这一段把类型/种子/各段耗时/还有几张贴图在排队一起带出来。 */
        if (ps && ps.planet) {
          var pp = ps.planet, mp = window.MirrorPlanets;
          var ph = mp && mp.perf ? mp.perf.stats() : null;
          var slow = null;
          if (ph && ph.length) slow = ph.slice(0, 4).map(function (e) { return e.name + ' ' + e.p50 + '/' + e.max + 'ms×' + e.n; });
          c.planet = { type: pp.type || null, seed: (pp.seed >>> 0) || 0, key: pp.visualKey || null,
            phase: ps.mode, buildMs: slow, mapsPending: (mp && mp.perf) ? mp.perf.mapsPending() : null };
        }
      }
    } catch (e) { c.pv = 'failed: ' + String(e && e.message || e); }
    try {
      var st = S.mirror && S.mirror.state && S.mirror.state();
      var sys = st && st.system;
      if (sys) { c.systemSeed = (sys.seed >>> 0); c.planetCount = sys.planets ? sys.planets.length : 0; }
      if (st) c.pvPending = st.pvPending || 0;
    } catch (e) { /* ignore */ }
    c.enterMirrorMs = WD.enter || null;      // {dispose, mbCreate, wireUI, tier, N}：进镜像那一帧的分段耗时
    // 镜像内部 1→2 层（按 Enter 进恒星系）那一帧的分段耗时 —— 这条路不经过 enterMirror，要单独取
    try { if (S.mirror && S.mirror.lastEnterMs) c.enterSystemMs = S.mirror.lastEnterMs(); } catch (e) { /* ignore */ }
    // createView 的分段耗时（getGL / 发出着色器 / 收货 / 是否有并行编译扩展）——首次建视图慢就看它
    try { if (S.mirror && S.mirror.pvCreateMs) c.pvCreateMs = S.mirror.pvCreateMs(); } catch (e) { /* ignore */ }
    /* D 维 N 体（ui/hyper.js）那一档的现场：后端、粒子数、轴、切片、回读样本、WebGPU 出过的错。
       WebGPU 不抛异常，出问题只表现成「画面不动」，不把这些落进 dump 就只能靠猜。 */
    try {
      var hst = null; try { hst = S.u3d && S.u3d.getState && S.u3d.getState(); } catch (e2) { /* 还没就绪 */ }
      if (hst && hst.hyper) c.hyper = (S.u3d.diagnostics ? S.u3d.diagnostics() : { backend: hst.mode, N: hst.N, axes: hst.axesLabel });
    } catch (e) { c.hyper = 'failed: ' + String(e && e.message || e); }
    try { if (window.performance && performance.memory) c.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (e) { /* ignore */ }
    try { c.ua = navigator.userAgent; } catch (e) { /* ignore */ }
    try { c.version = window.MIRROR_APP_VERSION || null; } catch (e) { /* ignore */ }
    return c;
  }
  // 右下角小条：可关；点正文把 JSON 复制到剪贴板
  function wdBar(snap) {
    try {
      var old = document.getElementById('wdBar'); if (old && old.parentNode) old.parentNode.removeChild(old);
      var bar = document.createElement('div');
      bar.id = 'wdBar';
      bar.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;max-width:min(92vw,460px);' +
        'display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:10px 12px;border-radius:8px;' +
        'background:rgba(24,26,32,0.94);color:#e8ecf5;border:1px solid rgba(255,255,255,0.18);' +
        'font:12px/1.45 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.35)';
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px';
      var txt = document.createElement('button');
      txt.type = 'button';
      txt.style.cssText = 'all:unset;cursor:pointer;flex:1;text-align:left;text-decoration:underline dotted';
      txt.textContent = T('上次假死现场已记录（卡住 ') + (Math.round(snap.stallMs / 100) / 10) + T(' 秒）· 点此复制');
      txt.addEventListener('click', function () {
        var s = '';
        try { s = JSON.stringify(snap, null, 2); } catch (e) { s = String(snap); }
        var ok = function () { txt.textContent = T('已复制，粘贴给开发者即可'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(ok, function () { wdFallbackCopy(s, ok); });
        else wdFallbackCopy(s, ok);
      });
      var x = document.createElement('button');
      x.type = 'button'; x.setAttribute('aria-label', T('关闭'));
      x.style.cssText = 'all:unset;cursor:pointer;padding:0 4px;opacity:0.75;font-size:14px';
      x.textContent = '✕';
      x.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
      row.appendChild(txt); row.appendChild(x);
      bar.appendChild(row);
      /* 「发送报告」：把这份现场 POST 给我们，省掉用户手动复制粘贴那一步。
         后台标签页里记下的现场（visibility!=='visible'）不催发——那多半是我们自己压测出来的，
         对排查真实卡顿没用，只留复制。 */
      if (snap.visibility === 'visible') {
        var send = document.createElement('button');
        send.type = 'button';
        send.style.cssText = 'all:unset;cursor:pointer;align-self:flex-start;padding:4px 10px;border-radius:5px;' +
          'background:#2b6cff;color:#fff;font-weight:600';
        send.textContent = T('发送报告');
        var note = document.createElement('div');
        note.style.cssText = 'opacity:0.72;font-size:11px;line-height:1.4';
        note.textContent = T('发送内容：帧耗时、卡住时所在的层级与参数、显卡与浏览器型号、页面路径。不含钱包地址，也不含任何私钥或签名。');
        /* 两步：第一下只把按钮变成「确认发送」（旁边冒出「取消」），第二下才真的 POST。
           09-17 用户问「怎么点一下就发送报告了」——一条要发到开发者邮箱的东西，不该一下误触就出去。 */
        var armed = false, cancel = null;
        send.addEventListener('click', function () {
          if (send.disabled) return;
          if (!armed) {
            armed = true; send.textContent = T('确认发送？'); send.style.background = '#c8781f';
            cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.style.cssText = 'all:unset;cursor:pointer;margin-left:8px;padding:4px 10px;border-radius:5px;' +
              'border:1px solid rgba(255,255,255,0.25);color:#e8ecf5';
            cancel.textContent = T('取消');
            cancel.addEventListener('click', function () {
              armed = false; send.textContent = T('发送报告'); send.style.background = '#2b6cff';
              if (cancel.parentNode) cancel.parentNode.removeChild(cancel); cancel = null;
            });
            send.insertAdjacentElement('afterend', cancel);
            return;
          }
          if (cancel && cancel.parentNode) cancel.parentNode.removeChild(cancel);
          send.disabled = true; send.style.opacity = '0.6'; send.textContent = T('发送中…');
          wdSend(snap, function (ok, why) {
            if (ok) { send.textContent = T('已发送，谢谢'); send.style.background = '#2f7d4f'; }
            else { send.disabled = false; send.style.opacity = '1'; send.style.background = '#8a4b2b';
              send.textContent = T('发送失败，可复制后发到 admin@arcbang.xyz'); if (why) send.title = String(why).slice(0, 120); }
          });
        });
        var sendRow = document.createElement('div');
        sendRow.style.cssText = 'display:flex;align-items:center';
        sendRow.appendChild(send);
        bar.appendChild(sendRow); bar.appendChild(note);
      }
      document.body.appendChild(bar);
    } catch (e) { /* 诊断条自己出问题不许影响页面 */ }
  }
  /* 把现场 POST 给 /api/stall。同一份 dump 只发一次（按 stallMs + at 记在 localStorage 里），
     避免用户多点几下、或刷新后看到旧提示又发一遍。
     页面路径只带 pathname + 白名单 query（bang/n/hash/site/lang/D/dim）——
     其余 query 一律丢掉，别把地址、邀请码之类的东西顺手发出去（服务端还会再筛一道）。 */
  var WD_Q_OK = { bang: 1, n: 1, hash: 1, site: 1, lang: 1, D: 1, dim: 1 };
  function wdSafePage() {
    try {
      var kept = [], sp = location.search.replace(/^\?/, '').split('&');
      for (var i = 0; i < sp.length && kept.length < 4; i++) {
        var kv = sp[i], eq = kv.indexOf('='), k = eq < 0 ? kv : kv.slice(0, eq);
        if (!k || !WD_Q_OK[k]) continue;
        kept.push(eq < 0 ? k : k + '=' + kv.slice(eq + 1).slice(0, 80));
      }
      return location.pathname + (kept.length ? '?' + kept.join('&') : '');
    } catch (e) { return null; }
  }
  function wdSentKey(snap) { return 'sent:' + (snap && snap.stallMs) + '|' + (snap && snap.at); }
  function wdSend(snap, done) {
    var CFG = window.ARCBANG_CONFIG || {};
    var base = CFG.apiBase || '/api';
    var key = wdSentKey(snap);
    try { if (localStorage.getItem(WD.KEY + '.sent') === key) { done(true); return; } } catch (e) { /* ignore */ }
    var body;
    try {
      body = JSON.stringify({
        dump: snap,
        site: CFG.site || 'bnb',
        page: wdSafePage(),
        appVersion: window.MIRROR_APP_VERSION || null,
        sentAt: new Date().toISOString()
      });
    } catch (e) { done(false, e && e.message); return; }
    if (typeof fetch !== 'function') { done(false, 'no fetch'); return; }
    fetch(base.replace(/\/+$/, '') + '/stall', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
    }).then(function (r) {
      if (!r.ok) { done(false, 'HTTP ' + r.status); return; }
      try { localStorage.setItem(WD.KEY + '.sent', key); } catch (e) { /* ignore */ }
      done(true);
    }, function (e) { done(false, e && e.message); });
  }
  function wdFallbackCopy(s, ok) {
    try {
      var ta = document.createElement('textarea');
      ta.value = s; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta); ta.select();
      var done = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (done && ok) ok();
    } catch (e) { /* ignore */ }
  }
  function wdReport(stallMs) {
    var snap = wdSnapshot(stallMs);
    try { console.error('[watchdog] 主线程卡住 ' + Math.round(stallMs) + ' ms，现场：', snap); } catch (e) { /* ignore */ }
    try { localStorage.setItem(WD.KEY, JSON.stringify(snap)); } catch (e) { /* 隐私模式 / 配额满：不记就是了 */ }
    /* 不自动弹条（09-17 用户拍板）：只在帮助行补出「卡顿报告」按钮；?wd=1 时仍当场弹，排查用 */
    if (/[?&]wd=1/.test(location.search)) wdBar(snap);
    else if (!$('hudStall')) { var hb = $('hudHints'); if (hb) hb.insertAdjacentHTML('beforeend', '<button type="button" class="hud-btn" id="hudStall">' + esc(T('卡顿报告')) + '</button>'); var sb = $('hudStall'); if (sb) sb.addEventListener('click', function () { wdBar(snap); }); }
  }
  (function startWatchdog() {
    if (typeof Worker !== 'function' || typeof MessageChannel !== 'function') return;
    if (typeof Blob !== 'function' || !(window.URL && URL.createObjectURL)) return;
    var src = 'var p=null,last=0,stallAt=0,LIM=' + WD.STALL_MS + ';' +
      'self.onmessage=function(e){ if(e.data&&e.data.port){ p=e.data.port; last=Date.now();' +
      '  p.onmessage=function(){ var n=Date.now(); if(stallAt){ self.postMessage({stall:n-stallAt}); stallAt=0; } last=n; };' +
      '  setInterval(function(){ var n=Date.now(); if(!stallAt && n-last>LIM) stallAt=last; try{ p.postMessage(1); }catch(err){} },100); } };';
    var url = null, w = null;
    try {
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (e) { if (url) { try { URL.revokeObjectURL(url); } catch (e2) { /* ignore */ } } return; }
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    var ch = new MessageChannel();
    ch.port1.onmessage = function () { try { ch.port1.postMessage(1); } catch (e) { /* ignore */ } };   // pong：整个主线程侧开销就是这一行
    w.onmessage = function (ev) { var d = ev && ev.data; if (d && d.stall > 0) wdReport(d.stall); };
    w.onerror = function () { WD.on = false; try { w.terminate(); } catch (e) { /* ignore */ } };
    try { w.postMessage({ port: ch.port2 }, [ch.port2]); } catch (e) { try { w.terminate(); } catch (e2) { /* ignore */ } return; }
    WD.worker = w; WD.port = ch.port1; WD.on = true;
    // 记最近一次输入：捕获阶段、passive，不干预任何既有处理
    /* 记最近一次输入**点在了什么上**：只有 type/at 的话，dump 里看到「点了一下然后卡 1.5 秒」
       根本认不出点的是哪颗按钮。id / class / 前 20 个字足够定位，且都是我们自己的界面文字，
       不含用户输入（输入框一律只记 tag，不记 value）。 */
    var noteTarget = function (ev) {
      try {
        var t = ev && ev.target; if (!t || t.nodeType !== 1) return null;
        var tag = (t.tagName || '').toLowerCase();
        var txt = (tag === 'input' || tag === 'textarea' || t.isContentEditable) ? '' :
          String(t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20);
        return { tag: tag, id: t.id || null, cls: (typeof t.className === 'string' ? t.className : '').slice(0, 60) || null, txt: txt || null };
      } catch (e) { return null; }
    };
    var note = function (name) {
      return function (ev) {
        WD.lastInput = { type: name, key: (ev && ev.key) || null, at: Math.round(nowMs()), target: noteTarget(ev) };
        WD.inputAt = nowMs();                     // 下一帧到来时算「点击 → 下一帧」的间隔
      };
    };
    try {
      document.addEventListener('keydown', note('keydown'), { capture: true, passive: true });
      document.addEventListener('pointerdown', note('pointerdown'), { capture: true, passive: true });
      document.addEventListener('wheel', note('wheel'), { capture: true, passive: true });
    } catch (e) { /* ignore */ }
    // 上一次会话留下的现场：不再进来就弹（09-17），留在「？帮助」旁的「卡顿报告」里；?wd=1 才当场弹
    try { var prev = localStorage.getItem(WD.KEY); if (prev && /[?&]wd=1/.test(location.search)) wdBar(JSON.parse(prev)); } catch (e) { /* ignore */ }
  })();

  function loop(now) {
    requestAnimationFrame(loop);
    if (S.hidden) { S.lastTime = now; return; }
    var gap = now - (S.lastTime || now);
    var dt = Math.min(0.1, gap / 1000); S.lastTime = now;
    // 看门狗用的帧记录：只是两个数字进环形缓冲，不改任何绘制行为（WD.rec 在看门狗没启动时是空函数）
    var t0 = WD.on ? nowMs() : 0;
    drawFrame(dt);
    if (WD.on) {
      WD.rec(gap, nowMs() - t0);
      /* 「点击 → 下一帧」的间隔：主线程被同步重活占住时，这个数就是用户实际感受到的卡顿。
         只记最近一次输入之后的第一帧，并留下当时点的是什么。 */
      if (WD.inputAt) {
        var waited = Math.round(t0 - WD.inputAt); WD.inputAt = 0;
        if (waited > (WD.inputLagMs || 0)) { WD.inputLagMs = waited; WD.inputLagOn = WD.lastInput && WD.lastInput.target; }
        if (waited > 150) console.warn('[app] 这一下点击之后等了 ' + waited + ' ms 才画下一帧：', WD.lastInput && WD.lastInput.target);
      }
    }
  }
  document.addEventListener('visibilitychange', function () { S.hidden = document.hidden; });
  requestAnimationFrame(loop);

  /* ---------------------------------------------------------- 站点顶栏
     结构在 index.html 里（#siteNav），样式是那份「站点顶栏 · 共用块 v1」——
     同一段 CSS 逐字出现在 index.html 与 web/market.html 两处，
     三条栏因此长得一模一样。
     顶栏里的类名一律带 #siteNav 前缀：本页另有一个别的 .seg（参数分段控件），
     裸类名会互相打架。这里只管三件事：

       1. **「选宇宙」出口**（#navBack）。这是加顶栏的主要理由：进了 3D 之后，
          "退回选宇宙那一步"原本只有 Esc 和右键菜单里那一项，屏幕上一个字都没有，
          新手根本看不出自己能回去。现在它常驻顶栏右区，起爆页上自动收起。
          动作与 Esc 完全一致（setState('select')），不另开一套语义。
       2. **设置浮层**（齿轮）。主题三选一接 MirrorTheme.mode()/set()，
          语言二选一接 MirrorI18n.lang()/set()。两个模块都可能缺席（离线包里
          i18n 一定在，但 theme.js 是独立文件），缺席就把那一行收起来 ——
          摆一个按不动的开关比没有开关更糟。
       3. **顶栏里的按键不许漏给画面**。app.js 在 document 上挂着一大串单键快捷键
          （空格暂停、A 分析、M 镜像、O 俯瞰…）。焦点在顶栏按钮上按空格，
          既要激活按钮又会顺手把模拟暂停掉 —— 所以顶栏自己吃掉 keydown。

     文案全部写在 index.html 的静态标签里：MirrorI18n 的 DOM 遍历会整段替换，
     不需要在这里拼字符串。新词条见交付报告。 */

  function navH() {
    var n = $('siteNav');
    if (!n || n.hidden) return 0;
    try { return Math.round(n.getBoundingClientRect().height); } catch (e) { return 0; }
  }

  /* 「选宇宙」只在离开起爆页之后出现：已经站在那一页上还摆一个回去的按钮是噪音 */
  function syncNav() {
    var b = $('navBack');
    if (b) b.hidden = (S.state === 'select');
  }

  /* setState 是唯一的状态入口（镜像那一支单独补了一次 syncNav），包一层就够了。
     不改任何调用点：函数声明的绑定可写，所有 setState(...) 拿到的都是这个包装。 */
  (function () {
    var inner = setState;
    setState = function (s) { inner(s); syncNav(); };
  })();

  /* ---------- 设置浮层 ----------
     开关 / 点外部关 / Esc 关 **全部归 web/nav.js**（mount() 里 registerPop）。
     这里原来有一份一模一样的实现 —— 钱包 chip 统一那一轮把 economy.html 的副本删了，
     漏了这一份。后果不是"多绑一次"那么无害：两个监听各 toggle 一次，
     **开了立刻又关，按钮点下去毫无反应**，而且两边都没报错，从现象上根本看不出是重复绑定。
     只保留 syncThemeSeg / syncLangSeg —— 那两个是本页的状态同步，nav.js 通过
     mirror:lang 事件和自己的 syncTheme 调它们。

     捕获阶段那个 Esc 也一并删了：nav.js 的 Esc 处理在浮层开着时会 stopPropagation，
     app 自己的 Esc（退回起爆页）本来就够不着。 */

  /* ---------- 主题三选一：浅色 / 深色 / 跟随系统（§3.5） ---------- */
  function syncThemeSeg() {
    var seg = $('themeSeg');
    if (!seg || !window.MirrorTheme) return;
    /* 用 mode() 而不是 get()：选了「跟随系统」而系统恰好是浅色时，get() 会让高亮
       打在「浅色」上，用户下次打开会以为自己选的是固定浅色。theme.js 为此专门分了两个方法。 */
    var mode = window.MirrorTheme.mode ? window.MirrorTheme.mode() : 'system';
    var bs = seg.querySelectorAll('.segbtn'), i;
    for (i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-checked', bs[i].getAttribute('data-theme-mode') === mode ? 'true' : 'false');
    }
  }
  (function () {
    var seg = $('themeSeg');
    if (!seg) return;
    if (!window.MirrorTheme) { if (seg.parentNode) seg.parentNode.hidden = true; return; }
    seg.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('.segbtn') : null;
      if (!b) return;
      window.MirrorTheme.set(b.getAttribute('data-theme-mode'));   // 'system' 走 theme.js 的删 key 分支
      syncThemeSeg();
    });
    syncThemeSeg();
  })();

  /* 谁改了主题都跟着对一次。右键菜单、theme.js 自己那个按钮、以及"跟随系统"时
     系统主题的实时变化，走的都不是上面那个 click —— 盯住 <html data-theme>
     是唯一一个把它们全覆盖到的地方。没有 MutationObserver 的老浏览器就退回
     "打开浮层时重对"（见 toggleNavPop），不至于错，只是晚一步。 */
  (function () {
    if (!window.MutationObserver || !$('themeSeg')) return;
    try {
      new window.MutationObserver(syncThemeSeg).observe(document.documentElement,
        { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) { /* 老浏览器：靠 toggleNavPop 里那次重对兜住 */ }
  })();

  /* ---------- 语言二选一：中文 / English ---------- */
  function syncLangSeg() {
    var seg = $('langSeg');
    if (!seg) return;
    var cur = window.MirrorI18n ? window.MirrorI18n.lang() : 'zh';
    var bs = seg.querySelectorAll('.segbtn'), i;
    for (i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-checked', bs[i].getAttribute('data-lang') === cur ? 'true' : 'false');
    }
  }
  (function () {
    var seg = $('langSeg');
    if (!seg) return;
    if (!window.MirrorI18n) { if (seg.parentNode) seg.parentNode.hidden = true; return; }
    seg.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('.segbtn') : null;
      if (!b) return;
      window.MirrorI18n.set(b.getAttribute('data-lang'));
      syncLangSeg();   // set() 只在真换了语言时派事件，这里无条件对一次
    });
    syncLangSeg();
  })();
  /* 静态文字 MirrorI18n 自己翻过了；这里只把两组单选的高亮重新对一次 */
  document.addEventListener('mirror:lang', function () { syncLangSeg(); syncThemeSeg(); });
  /* 引爆之后再切语言：i18n 的 applyStatic() 只认整句命中的静态文本，HUD / 时间轴说明 / 维度说明 /
     进入按钮这些是当场拼出来的（带插值的数字），命中不了，得各自按原式重拼一遍。
     universe3d 的状态行由它自己监听 mirror:lang 重算，这里只负责宿主这一侧。 */
  document.addEventListener('mirror:lang', function () {
    relangRun();
    /* 起爆页那行「你已启动 N 次大爆炸」与页脚的引擎信息行都是当场拼出来的
       （中间夹着数字），i18n 的整段命中够不着它们 —— 按原式重拼一遍。 */
    try { refreshBangCount(); } catch (e) { /* 这一条挂了不该连累时间轴 */ }
    if (S.sim && TL.on) tlRelabel();                 // 时间轴刻度的 title（事件名 + 时刻）
  });

  /* ---------- 顶栏浮层的两个小助手 ----------
     下面三处（Esc / 「选宇宙」/ 「模拟器」）一直在调 closeNavPop() / navPopOpen()，
     但这两个函数从来没在本文件里定义过 —— 点「选宇宙」先抛 ReferenceError，setState('select')
     根本走不到，按钮看起来就是「没反应」（2026-09-17 用户实测撞到）。
     浮层归 web/nav.js 管（MirrorNav.pop.closeAll / anyOpen）；离线单文件包里没有 nav.js，
     所以都要能在它缺席时静默通过。 */
  function navPops() { var N = (typeof window !== 'undefined') ? window.MirrorNav : null; return N && N.pop ? N.pop : null; }
  function closeNavPop() { var P = navPops(); if (P && typeof P.closeAll === 'function') { try { P.closeAll(); } catch (e) { /* ignore */ } } }
  function navPopOpen() { var P = navPops(); if (P && typeof P.anyOpen === 'function') { try { return !!P.anyOpen(); } catch (e) { return false; } } return false; }

  /* ---------- 顶栏里的按键不外泄 ---------- */
  (function () {
    var n = $('siteNav');
    if (!n) return;
    n.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Escape' || ev.key === 'Esc') && navPopOpen()) {
        closeNavPop();
        var b = $('btnSettings');
        if (b) { try { b.focus(); } catch (e) { /* ignore */ } }
        ev.preventDefault();
      }
      /* 焦点在顶栏上时，空格 / A / M / O 这些单键只属于这个按钮，
         不该同时把模拟暂停、把分析面板拉出来。 */
      ev.stopPropagation();
    });
  })();

  /* ---------- 「选宇宙」与「模拟器」 ---------- */
  (function () {
    var b = $('navBack');
    if (!b) return;
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      closeNavPop();
      setState('select');     // 与 Esc、右键菜单里那一项完全同一个动作
    });
  })();
  (function () {
    var a = $('navSim');
    if (!a) return;
    a.addEventListener('click', function (ev) {
      /* 已经在模拟器这一页了。让它照常跳转 = 整页重载 = 2M 粒子的模拟从头再跑一遍，
         而用户想要的多半只是"回到能选宇宙的地方"。所以拦下来当 #navBack 用。
         中键 / Ctrl / Shift 是"在新标签页打开"，那是用户明确要的，放行。 */
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      closeNavPop();
      if (S.state !== 'select') setState('select');
    });
  })();

  /* ---------- 市场 / 经济模型：只在这两页真的存在时才摆出来 ----------
     站点版（web/dist-arc/app.html）里 market.html 就在同一个目录，
     web/config.arc.js 也是那一层注入的，所以 window.ARCBANG_CONFIG 正好是判据。
     离线单文件（dist/mirror.html）里那两页根本不存在 —— 死链接比没有链接更糟，
     整条页面切换收起来，顶栏只剩「选宇宙」和设置，仍然有用。
     config.js 在 app.js 之后才执行（构建把整层追加在 </script> 前），所以要等一拍。 */
  function syncNavPages() {
    var n = $('pageNav');
    if (n) n.hidden = !window.ARCBANG_CONFIG;
  }
  syncNavPages();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncNavPages);
  else window.setTimeout(syncNavPages, 0);

  /* ---------------------------------------------------------- 启动 */
  applyVersion();          // 标题后缀 + 页脚版本串（dev 模式下 fetch('VERSION') 回来后会再刷一次）
  setState('select');
  window.MirrorApp = { state: S, setState: setState, detonate: detonate, selectEntry: selectEntry, enterMirror: enterMirror, openAnalysis: openAnalysis, adapter: A, pickById: function (id) { var l = A.catalog.list(), i; for (i = 0; i < l.length; i++) if (String(l[i].id) === String(id) || l[i].label === id) { selectEntry(l[i]); return l[i]; } var e = A.catalog.get(id); if (e) { selectEntry(e); return e; } return null; }, skip: function () { if (S.view && S.view.skip) S.view.skip(); },
    // 调试/自检：手动推进一帧（页面隐藏、rAF 不跑时也能驱动状态机）
    step: function (dt, n) { dt = dt || 1 / 60; n = n || 1; for (var i = 0; i < n; i++) drawFrame(dt); return S.elapsed; } };
})();
