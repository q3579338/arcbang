/*
 * ui/universe3d.js —— 可飞进去观测的三维宇宙（镜像宇宙模拟器 · 致敬刘慈欣《镜子》）
 * ------------------------------------------------------------
 * 浏览器全局 window.MirrorUniverse3D。无外部依赖，不用 import；WGSL/GLSL 内嵌字符串；可被 build.js 内联。
 *
 *   const U = window.MirrorUniverse3D;
 *   U.isSupported()                       → {webgpu, webgl2}
 *   U.cosmologyFrom(engineResult)         → 从引擎 simulate() 结果抽取宇宙学量（Ω_m/Ω_b/Ω_Λ/Ω_k/h/n_s/σ₈/tOfA/fate）
 *   const u = U.create(canvas, {cosmology, seed, boxMpc, particles:'auto'|'low'|'mid'|'high'|'ultra', local:false,
 *                               force:'webgpu'|'webgl2'|null, overlay:true, onEnterStar(seed, starInfo), onStatus(msg, state)});
 *   u.ready (Promise) · u.start()/pause()/step(dtGyr?)/setTime(tGyr)/getState()
 *       state: {mode, tier, N, mesh, a, z, t(Gyr), running, fps, stepsPerSec, camera, scale, halosFound, lod, galaxy, label, layer, ...}
 *   u.flyTo('densest'|'randomHalo'|{x,y,z}) · u.flyIntoHalo(i) · u.setExposure(ev)/toggleVolume()/toggleLabels()/toggleTiling()
 *   u.toggleParticles()/setColorMode('density'|'speed')/setProperScale(bool)/setSpeed(boxPerSec)/setCamera({pos,yaw,pitch,fovDeg})/setAutoBrake()
 *   u.halos()/requestAnalysis()/pickStar(clientX, clientY) · u.resize()/dispose()
 *   u.diagnostics() → {Pk:[[k,P]], PkLinear, sigma8(测), sigma8Linear(×D(a)), sigma8LinearZ0, haloCount, halos, mode, a, N, mesh, boxMpc}
 *   键盘：WASD/QE 移动 · Shift 加速 · Ctrl 减速 · 空格 暂停/继续 · H 最密处 · R 随机晕 · V 体渲染 · L 标签；鼠标：左/右键拖拽转向、滚轮调速（Ctrl+滚轮 视场）、点击恒星
 *
 * 三层：
 *   模拟层（标"模拟"）：3D 高斯随机场 + Eisenstein–Hu(1998) 无振荡传递函数 → Zel'dovich 初始条件（a=0.02）
 *                       → PM 引力（CIC 沉积 → FFT 泊松 → 梯度 → KDK 蛙跳），Friedmann 背景（Ω_r/Ω_m/Ω_k/Ω_Λ，含转向坍缩）。
 *                       WebGPU：全部在 compute shader（粒子/网格常驻 GPU）；WebGL2 回退：Worker 里 CPU PM 64³ 网格。
 *   示意层（标"示意"）：飞进一个晕后过程生成的星系点云（旋涡/椭圆由晕质量与自旋种子决定），点选恒星回调 onEnterStar。
 *   数据层（标"数据"，opts.local）：本星系群成员、太阳在银河系中的位置、百光年内恒星——全部从
 *                                  window.MirrorLocalData（ui/localdata.js：HYG v4.1 + McConnachie 2012 等公开目录）读取。
 *                                  本文件不内置任何星表；MirrorLocalData 缺席时数据层直接不可用（不回退到任何内置表）。
 *
 * 单位约定：位置为共动盒坐标 [0,1)³（1 盒 = boxMpc Mpc/h），时间以 1/H0 为单位积分（显示换算 Gyr），
 *          速度变量 u = a²·dx/dt（正则动量，运动方程 du/dt = −∇φ，∇²φ = 1.5·Ω_m·δ/a）。
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var TAU = Math.PI * 2, PI = Math.PI;
  var MPC_LY = 3.2616e6;         // 1 Mpc = 3.2616×10⁶ 光年
  var RHO_CRIT = 2.775e11;       // ρ_crit = 2.775×10¹¹ h² M⊙/Mpc³
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash32(a) { a = a >>> 0; a = (a ^ 61) ^ (a >>> 16); a = Math.imul(a, 9) >>> 0; a ^= a >>> 4; a = Math.imul(a, 0x27d4eb2d) >>> 0; a ^= a >>> 15; return a >>> 0; }
  function hashMix(a, b) { return hash32((a >>> 0) ^ Math.imul(b >>> 0, 0x9E3779B1)); }
  function fmtNum(x, d) { return Number(x).toFixed(d == null ? 2 : d); }
  function sciTxt(x, d) { if (!isFinite(x)) return '—'; if (x === 0) return '0'; var e = Math.floor(Math.log10(Math.abs(x))), m = x / Math.pow(10, e); return m.toFixed(d == null ? 2 : d) + '×10' + String(e).replace(/[-\d]/g, function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c] || '⁻'; }); }
  function fmtGyr(t) { if (t == null || !isFinite(t)) return '—'; var a = Math.abs(t); if (a < 1e-3) return (t * 1e6).toFixed(1) + T(' 千年'); if (a < 1) return (t * 1000).toFixed(1) + T(' 百万年'); return t.toFixed(2) + ' Gyr'; }
  function fmtBig(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* 中英文案：词典在 web/i18n-app.js（与 ui/scenes.js 同一命名空间）；i18n 没加载时静默退回中文。
     本模块历史上没有做双语，这里只包新加的维数相关文案，旧文案原样不动。 */
  function T(s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'app') : s); }
  /* 动态拼接的串（星系名、进度、数据注脚）走模板翻译：web/i18n-mirror.js 的 MirrorI18n.tx() */
  function TX(s) { var I = root.MirrorI18n; return (I && I.tx && s != null) ? I.tx(String(s)) : s; }

  /* ---------- 维数分档：画面由宏观维数 D 决定，不由结局标签决定 ----------
   * 依据 research/mirror-notes.md §3.3 / §3.4（原著第八章）：
   *   六维宇宙  → 「一堆极其混乱的色彩和形状……我们无法观察它」
   *   二点五维  → 「无际的黑色平面 + 无数银光闪闪的、与平面垂直相交的直线（一维恒星）」
   * 只分原文写过的两档：D≥4 → 'chaos'；2≤D<3 → 'plane'；其余（含 3<D<4 与 D<2）→ 'normal'。
   * **分界从 3+1e-9 挪到 4**（2026-09-17）：引擎对 3<D<4 的结论是"圆轨道稳定但不闭合、
   * 氢原子有基态"（R_DIM 只判 warn，结局是 BEYOND_MODEL_DIM），给它盖一屏"我们无法观察它"
   * 与引擎自己的话直接打架；D≥4 才是 Ehrenfest 判据崩掉的那一侧，也是原著举例的六维所在。
   * 详细理由与实测占比见 ui/scenes.js 的同名注释。
   * 规则与 ui/scenes.js 的 dimView 必须一致：那边先加载不了（scenes.js 在本文件之后），
   * 所以调用时优先取 MirrorScenes.dimView，取不到再用这里这份同样的实现，两边不会漂。 */
  var DIM_EPS = 1e-9;
  var DIM_CHAOS_FROM = 4;         // 与 scenes.js 的 DIM_CHAOS_FROM 同一个数，改一处必须改两处
  var DIM_PLANE_Z = 0.5;          // 低维那档：平面在盒坐标里的位置；相机的 z 就是"离平面多高"
  var DIM_TILE = 2;               // 平面在 x/y 上按盒长平铺 ±2 格，营造"无际"
  var DIM_BANDS = 6;              // 按距离分 6 档批量描边：一档一次 stroke，避免上千次独立描边
  function dimViewLocal(D) {
    D = +D;
    if (!isFinite(D) || D <= 0) return 'normal';
    if (D >= DIM_CHAOS_FROM - DIM_EPS) return 'chaos';
    if (D >= 2 - DIM_EPS && D < 3 - DIM_EPS) return 'plane';
    return 'normal';
  }
  function dimViewOf(D) {
    var S2 = root.MirrorScenes;
    if (S2 && typeof S2.dimView === 'function') { try { return S2.dimView(D); } catch (e) { /* 退回本地实现 */ } }
    return dimViewLocal(D);
  }
  // 减少动态：混乱色块那一屏本来是每 45ms 换一次的强闪烁，勾了这个偏好就慢下来、压暗
  var _rmq = null, _rmqTried = false;
  function reducedMotion() {
    if (!_rmqTried) { _rmqTried = true; try { _rmq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { _rmq = null; } }
    return !!(_rmq && _rmq.matches);
  }

  /* ============================================================
   * §1.5 「我们无法观察它」那一屏 —— D>3 的遮罩与它的出口
   * ------------------------------------------------------------
   * 原著第八章（research/mirror-notes.md §3.3）：
   *   「进入其中后，屏幕上出现了一堆极其混乱的色彩和形状，白冰立刻将它关掉了。
   *     '这是一个六维宇宙，我们无法观察它……'」
   * 那一击（混乱的色彩和形状 + 我们无法观察它）必须照给。但白冰是**关掉**，
   * 这里给的是相反的出口：给一个明确的按钮，点了就揭开，露出底下一直在跑的投影
   * ——因为实测 4000 个链上派生宇宙里 56.9% 是 D>3，一直盖死等于一半以上的宇宙点进去没东西看。
   *
   * 会话记忆 dimVeilSeen：**跨宇宙有效，换宇宙不重置**。
   *   理由：这一屏说的是「高维宇宙这一类东西人看不了」，是对一类宇宙的陈述，不是这一个宇宙的属性；
   *   说过一次就够了。D>3 占一半以上，每换一个宇宙再拦一次就成了点击税。
   *   信息并没有丢：揭开后左上角常驻一行提示，旁边留着「重看那一屏」，随时能把那一击调回来
   *   （重看只影响当前这个宇宙的这一次，不会把"看过了"这件事抹掉）。
   *   只活在模块作用域里：刷新页面就是新的一次会话，那一屏会重新拦一次。
   *
   * 画面（混乱色块）由调用方各自画 —— 3D 走 dimCv，2D 回退画在 #stage 上；
   * 本部件只管**那块字 + 出口 + 揭开后的常驻提示 + 会话记忆**，ui/scenes.js 直接复用同一份，
   * 所以两条渲染路径长得一样、行为一样。
   * ============================================================ */
  var dimVeilSeen = false;
  function dimVeilRevealed() { return dimVeilSeen; }
  function createDimVeil(host, o) {
    o = o || {};
    if (!root.document || !host) return null;
    injectCSS();
    var D = +o.dim;
    /* 出口按钮与常驻提示的措辞由调用方给**整句**，不在这里拼 "…的" + "三维投影"：
       i18n 用中文原文当 key（web/i18n.js 开头写明了这个取舍），碎片越短越容易和别处撞车，
       而且 "仍然要看它的" 这种半句根本没法翻好。3D 给"三维投影"、2D 回退给"二维投影"。 */
    var exitText = o.exitText || T('仍然要看它的三维投影');
    var tipHead = o.tipHead || T('屏幕上是它的三维投影（D=');
    var onChange = typeof o.onChange === 'function' ? o.onChange : function () {};
    var revealed = dimVeilSeen, disposed = false;
    var el = document.createElement('div');
    el.className = 'u3d-veil';
    el.hidden = true;
    host.appendChild(el);
    function dtxt() { return isFinite(D) ? fmtNum(D, 2) : '—'; }
    function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
    function paint() {
      if (disposed) return;
      while (el.firstChild) el.removeChild(el.firstChild);
      if (!revealed) {
        el.className = 'u3d-veil';
        var card = mk('div', 'u3d-veil-card');
        card.setAttribute('aria-live', 'polite');
        card.appendChild(mk('div', 'u3d-veil-h', T('我们无法观察它')));
        card.appendChild(mk('div', 'u3d-veil-p', T('这是一个 D=') + dtxt() + T(' 的高维宇宙：屏幕上只有一堆极其混乱的色彩和形状。')));
        var b = mk('button', 'u3d-veil-b', exitText);
        b.type = 'button';
        card.appendChild(b);
        card.appendChild(mk('div', 'u3d-veil-k', T('点击画面任意处，或按 Enter')));
        el.appendChild(card);
      } else {
        el.className = 'u3d-veil done';
        var tip = mk('div', 'u3d-veil-tip');
        tip.appendChild(mk('span', null, tipHead + dtxt() + T('）· 这个宇宙本身我们无法直接观察')));
        var b2 = mk('button', 'u3d-veil-b sm', T('重看那一屏'));
        b2.type = 'button';
        tip.appendChild(b2);
        el.appendChild(tip);
      }
    }
    function set(v) {
      if (disposed || revealed === !!v) return;
      revealed = !!v;
      if (revealed) dimVeilSeen = true;      // 只记"揭开过"；「重看那一屏」不会把它抹掉
      paint();
      try { onChange(revealed); } catch (e) { console.warn('[universe3d] dimVeil onChange:', e); }
    }
    // 遮着的时候点画面任意处都算出口（按钮只是把出口说明白）；揭开之后整层 pointer-events:none，
    // 只有「重看那一屏」那个按钮吃点击，相机的拖拽/滚轮照旧落到画布上
    function onClick(e) {
      var b = e.target && e.target.closest ? e.target.closest('.u3d-veil-b') : null;
      if (revealed) { if (b) { e.preventDefault(); e.stopPropagation(); set(false); } return; }
      e.preventDefault(); e.stopPropagation();
      set(true);
    }
    el.addEventListener('click', onClick);
    /* 键盘出口只认 Enter：空格（播放/暂停）、Esc（退回引爆界面）、WASD/F/H/O/V/L 在宿主与本模块里
       都已经各有绑定，抢过来会把别的功能吃掉。capture 是为了在宿主之前拿到这一下并就地停住。 */
    function onKey(e) {
      if (disposed || revealed || el.hidden) return;
      if (e.key !== 'Enter') return;
      var a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
      e.preventDefault(); e.stopPropagation();
      set(true);
    }
    root.addEventListener('keydown', onKey, true);
    paint();
    return {
      el: el,
      revealed: function () { return revealed; },
      reveal: function () { set(true); },
      veilAgain: function () { set(false); },
      setVisible: function (v) { if (!disposed) el.hidden = !v; },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        try { el.removeEventListener('click', onClick); } catch (e) { /* ignore */ }
        try { root.removeEventListener('keydown', onKey, true); } catch (e) { /* ignore */ }
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }


  /* ============================================================
   * §1.6 「一堆极其混乱的色彩和形状」那一屏（D≥4 遮罩期的画面）
   * ------------------------------------------------------------
   * 2026-09-17 从 create() 的闭包里抽到模块作用域并导出：ui/hyper.js 的 D 维 N 体在遮罩期要画同一份画面。
   * 抽出来之前它只能由一个 universe3d 实例来画，于是 D≥4 的流程被迫是
   * 「先建一整套 PM 模拟只为了放这一屏 → 揭开再整个拆掉换成 N 体」——
   * 那次拆建在真显卡上会连着建/销毁两个 WebGPU 设备（实测整页冻死），而且遮罩期那套 PM
   * 光生成初始条件就要几十秒，屏幕上却一眼都看不到它。现在遮罩期不再需要任何 PM。
   *
   *   var ch = createDimChaos(seed, D);
   *   ch.draw(ctx2d, cssW, cssH, dtSeconds, { calm: 低功耗, drawText: 没有 DOM 卡片时把那句话画在画布上 });
   *   ch.reset();   // 画布尺寸变了：形状池按新尺寸重建
   *
   * 布局与配色只由 seed 决定（同一个宇宙每次进来同一幅）；运行期事件（隔几秒换掉几个形状）走另一条 rng。
   * ============================================================ */
  function createDimChaos(seed, dimSVal) {
    var rnd = K.mulberry32(hashMix(seed, 0x2d5c));
    var st = { shapes: [], t: 0, swapIn: 0, anchors: null,
               rndT: K.mulberry32(hashMix(seed, 0x2d5d)), glow: null, glowFail: false, vg: null, vgW: 0, vgH: 0 };
  /* 「极其混乱的色彩和形状」那一屏 —— 与 ui/scenes.js 的 chaosScene 同一套做法，
     3D 主路径和 2D 回退看到的东西一致（那边改了这边没改，等于大多数人根本看不到新画面）。
     09-17 用户说「这个彩色动得太快、也不够绚丽」之后重写过两轮：
     v0：hue = rnd()*360、饱和 95%，背景还按帧轮转全色相 —— 一块彩虹屏保，读着像渲染坏了。
     v1：收进 200–270° 冷蓝紫、饱和 12–34%，每 45 ms 整屏重抽 140 个块 —— 不刺眼了，
         但一是灰，二是"整屏高频重抽"只有闪没有动，眼睛读到的是噪点而不是形状。
     v2（现在）：色相放开到整个色轮但**锚在 4 个色上**、不随帧轮转（所以是混乱，不是彩虹），
         饱和 45–85%、明度按远近分层；远层 source-over 当色块、近层 'lighter' 烧出光；
         形状不再重抽，各自带相位地连续漂移 / 旋转 / 呼吸 / 明灭（周期几秒到几十秒），
         每 2–4 秒只换掉 3–6 个，还带淡入淡出 —— 永远在动、永远不闪。
     calm（低功耗开或系统"减少动态"）：慢时钟冻结、不换形状、隔一个画一个（约 70 个）。
         那一击照给，但画面近乎静止。calm 可以在运行期被切换，所以形状池一直按 140 个建，
         只在画的时候改步长，不重建池子。 */
  var DIM_GLOW_N = 24;
  // 形状池：一次性分配 140 个对象，之后**只改字段、不再 new**（每帧零分配）。
  // 位置与尺寸全按 0..1 归一化存，跟画布尺寸无关。
  function reseed(s, R, layFix) {
    var lay = layFix == null ? R() : layFix;            // 0 = 远（大、暗）… 1 = 近（小、亮）
    var hue = (st.anchors[(R() * 4) | 0] + (R() - 0.5) * 54 + 360) % 360;
    var sat = 45 + R() * 40;                            // 45–85%：够艳，又不到荧光
    var li = 22 + lay * 40 + R() * 12;                  // 远 22–34%（底色块），近 62–74%（发光）
    s.lay = lay; s.hue = hue;
    s.nx = R(); s.ny = R();
    s.ax = (0.04 + R() * 0.10) * (1.25 - lay);          // 漂移幅度：远的走得更远
    s.ay = (0.04 + R() * 0.10) * (1.25 - lay);
    s.wx = 0.10 + R() * 0.30; s.wy = 0.10 + R() * 0.30; // 漂移周期 21–63 s：读着是漂不是飞
    s.px = R() * TAU; s.py = R() * TAU;
    // 尺寸偏小（幂 2）：大块只是偶尔出现的底噪，满屏大块叠出来就是一团雾
    s.w = 0.05 + Math.pow(R(), 2) * (0.46 - 0.34 * lay);
    s.h = 0.05 + Math.pow(R(), 2) * (0.46 - 0.34 * lay);
    s.rot = R() * TAU; s.rs = (R() - 0.5) * 0.30;       // 自转 ≤0.15 rad/s：一圈 40 s 上下
    s.bs = 0.10 + R() * 0.26; s.wb = 0.45 + R() * 0.85; s.pb = R() * TAU;   // 呼吸 4.8–14 s
    s.wa = 0.35 + R() * 0.90; s.pa = R() * TAU;                             // 明灭 5.4–18 s
    // 远近两层的不透明度各算各的：远层 source-over 当色块，近层 lighter 当发光
    s.a = lay < 0.5 ? (0.09 + R() * 0.13) : (0.14 + (lay - 0.5) * 0.44 + R() * 0.10);
    var kr = R();
    s.k = kr < 0.20 ? 0 : kr < 0.38 ? 1 : kr < 0.58 ? 2 : kr < 0.74 ? 3 : kr < 0.90 ? 4 : 5;
    if (lay > 0.70 && R() < 0.45) s.k = 4;              // 最近一层多给光斑：亮核才是"绚丽"的来源
    s.n = 3 + ((R() * 7) | 0);
    s.a0 = R() * TAU; s.a1 = s.a0 + 0.6 + R() * 4.2;    // 弧段
    s.lw = 1 + R() * 2.2;
    // 颜色前缀预拼好：每帧只剩一次"前缀 + alpha + )"
    s.cf = 'hsla(' + hue.toFixed(0) + ',' + sat.toFixed(0) + '%,' + li.toFixed(0) + '%,';
    s.cs = 'hsla(' + ((hue + 14) % 360).toFixed(0) + ',' + Math.min(96, sat + 12).toFixed(0) + '%,' + Math.min(92, li + 28).toFixed(0) + '%,';
    s.dying = false; s.f = 1;
  }
  function pool() {
    // 四个锚点强制铺开整个色轮（90° 一档、±22° 抖动）：随机间隔容易四个色全挤在一边，
    // 整屏只剩一种色调（实测抽到过一片橄榄绿），那就既不混乱也不绚丽了。
    var h0 = rnd() * 360, i;
    st.anchors = [0, 0, 0, 0];
    for (i = 0; i < 4; i++) st.anchors[i] = (h0 + i * 90 + (rnd() - 0.5) * 44 + 360) % 360;
    st.shapes = new Array(140);
    for (i = 0; i < 140; i++) { st.shapes[i] = {}; reseed(st.shapes[i], rnd); }
    st.shapes.sort(function (a, b) { return a.lay - b.lay; });   // 远的先画、近的压上去；只排这一次
    st.swapIn = 2 + st.rndT() * 2;
  }
  /* 柔光斑：每帧现 createRadialGradient 上百次太贵，改成开场烤 24 张 96px 贴图（每 15° 色相一张），
     之后只 drawImage 缩放。拿不到 document 就退回实心椭圆，不让画面塌掉。 */
  function glowBake() {
    if (st.glow || st.glowFail) return st.glow;
    if (!root.document || !root.document.createElement) { st.glowFail = true; return null; }
    var arr = new Array(DIM_GLOW_N);
    for (var g = 0; g < DIM_GLOW_N; g++) {
      var cv = root.document.createElement('canvas'); cv.width = 96; cv.height = 96;
      var c2 = cv.getContext && cv.getContext('2d');
      if (!c2) { st.glowFail = true; return null; }
      var hu = (g + 0.5) * (360 / DIM_GLOW_N);
      var rg = c2.createRadialGradient(48, 48, 0, 48, 48, 48);
      rg.addColorStop(0, 'hsla(' + hu.toFixed(0) + ',92%,78%,1)');
      rg.addColorStop(0.28, 'hsla(' + hu.toFixed(0) + ',88%,58%,0.55)');
      rg.addColorStop(0.62, 'hsla(' + ((hu + 20) % 360).toFixed(0) + ',85%,44%,0.16)');
      rg.addColorStop(1, 'hsla(' + ((hu + 20) % 360).toFixed(0) + ',85%,40%,0)');
      c2.fillStyle = rg; c2.fillRect(0, 0, 96, 96);
      arr[g] = cv;
    }
    st.glow = arr; return arr;
  }
  function glowOf(hue) { var G = st.glow; return G ? G[((hue / (360 / DIM_GLOW_N)) | 0) % DIM_GLOW_N] : null; }
  function draw(c, cw, ch, dt, o) {
    var i;
    var calm = !!(o && o.calm) || reducedMotion();
    var d = dt > 0 ? (dt > 0.05 ? 0.05 : dt) : 0;      // dt 兜上限：切走再切回来别一帧跳过半分钟
    if (!st.shapes.length || !st.anchors) pool();
    glowBake();
    if (!calm) st.t += d;
    var t = st.t, step = calm ? 2 : 1;

    /* 底：深底不动摇，只让色相与明度非常慢地流（周期约 100 s / 57 s）——
       这是"缓慢流动的色调"，不是背景在闪。 */
    var bh = (st.anchors[0] + 30 * Math.sin(t * 0.062)) % 360;
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.fillStyle = 'hsl(' + bh.toFixed(1) + ',36%,' + (calm ? 6.5 : (6.2 + 1.8 * Math.sin(t * 0.11))).toFixed(2) + '%)';
    c.fillRect(0, 0, cw, ch);

    c.globalCompositeOperation = 'lighter';
    // 四团柔光在底上慢慢挪：给画面一层会呼吸的底色，代价只有 4 次 drawImage。
    // 半径与不透明度都压得很低——铺满整屏的高亮底噪会把画面糊成一片雾。
    if (st.glow) {
      var Rb = Math.max(cw, ch) * 0.42;
      for (var b = 0; b < 4; b++) {
        var sp = glowOf(st.anchors[b]); if (!sp) break;
        var bx = cw * (0.5 + 0.34 * Math.sin(t * (0.037 + b * 0.013) + b * 2.1));
        var by = ch * (0.5 + 0.30 * Math.cos(t * (0.031 + b * 0.017) + b * 1.3));
        c.globalAlpha = 0.05 + 0.035 * Math.sin(t * 0.09 + b);
        c.drawImage(sp, bx - Rb, by - Rb, Rb * 2, Rb * 2);
      }
      c.globalAlpha = 1;
    }

    // 隔 2–4 秒只换掉 3–6 个形状（淡出→重抽→淡入），其余的一直在原地连续地动
    if (!calm) {
      st.swapIn -= d;
      if (st.swapIn <= 0) {
        st.swapIn = 2 + st.rndT() * 2;
        var q = 3 + ((st.rndT() * 4) | 0);
        for (var m = 0; m < q; m++) st.shapes[(st.rndT() * st.shapes.length) | 0].dying = true;
      }
    }

    /* 两层不同的叠加模式（shapes 已按 lay 远→近排好，所以只切一次状态）：
       远层 source-over —— 大色块互相覆盖，颜色是**颜色**，画面才有实体感；
       近层 lighter    —— 小而亮的形状、线、光斑叠在上面自己烧出光。
       全用 lighter 试过：几十个大块一叠就加满，整屏变成一层均匀的彩雾。 */
    c.globalCompositeOperation = 'source-over';
    var lit = false;
    for (i = 0; i < st.shapes.length; i += step) {
      var s = st.shapes[i];
      if (!lit && s.lay >= 0.5) { lit = true; c.globalCompositeOperation = 'lighter'; }
      if (!calm) {
        if (s.dying) { s.f -= d * 0.9; if (s.f <= 0) { var lf = s.lay + (st.rndT() - 0.5) * 0.12; lf = lf < 0 ? 0 : lf > 1 ? 1 : lf; reseed(s, st.rndT, lf); s.f = 0; } }
        else if (s.f < 1) { s.f += d * 0.8; if (s.f > 1) s.f = 1; }
      }
      var al = s.a * (0.55 + 0.45 * Math.sin(t * s.wa + s.pa)) * s.f;
      if (al < 0.004) continue;
      var x = (s.nx + s.ax * Math.sin(t * s.wx + s.px)) * cw;
      var y = (s.ny + s.ay * Math.sin(t * s.wy + s.py)) * ch;
      var sc = 1 + s.bs * Math.sin(t * s.wb + s.pb);
      var pw = s.w * cw * sc, phh = s.h * ch * sc, j;
      if (s.k === 4) {                          // 柔光斑：不用旋转，直接贴图
        var g4 = glowOf(s.hue), R4 = (pw + phh) * 0.35;
        if (g4) { c.globalAlpha = al * 2.4 > 1 ? 1 : al * 2.4; c.drawImage(g4, x - R4, y - R4, R4 * 2, R4 * 2); c.globalAlpha = 1; }
        else { c.fillStyle = s.cf + al.toFixed(3) + ')'; c.beginPath(); c.ellipse(x, y, R4, R4, 0, 0, TAU); c.fill(); }
        continue;
      }
      c.save();
      c.translate(x, y); c.rotate(s.rot + t * s.rs);
      c.fillStyle = s.cf + al.toFixed(3) + ')';
      if (s.k === 0) c.fillRect(-pw / 2, -phh / 2, pw, phh);
      else if (s.k === 1) { c.beginPath(); c.ellipse(0, 0, pw / 2, phh / 2, 0, 0, TAU); c.fill(); }
      else if (s.k === 2) {
        c.beginPath();
        for (j = 0; j < s.n; j++) { var aa = j / s.n * TAU; c.lineTo(Math.cos(aa) * pw / 2, Math.sin(aa) * phh / 2); }
        c.closePath(); c.fill();
        c.strokeStyle = s.cs + (al * 0.95).toFixed(3) + ')'; c.lineWidth = s.lw; c.stroke();
      } else if (s.k === 3) {                   // 高亮细线：负责画面里的"结构"，只描边
        c.strokeStyle = s.cs + Math.min(1, al * 2.1).toFixed(3) + ')'; c.lineWidth = s.lw;
        c.beginPath(); c.moveTo(-pw, 0);
        for (j = 0; j < 12; j++) c.lineTo(-pw + j * pw / 6, Math.sin(j * 1.3 + s.pb + t * s.wb * 0.5) * phh / 2);
        c.stroke();
      } else {                                  // 弧段：像信号里残留的一截轨道
        c.strokeStyle = s.cs + Math.min(1, al * 1.8).toFixed(3) + ')'; c.lineWidth = s.lw * 1.6;
        c.beginPath(); c.arc(0, 0, (pw + phh) * 0.25, s.a0, s.a1); c.stroke();
      }
      c.restore();
    }

    // 暗角：把四周压回深色，画面才有"中间烧起来"的层次，而不是一整片均匀的光
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    if (!st.vg || st.vgW !== cw || st.vgH !== ch) {
      st.vgW = cw; st.vgH = ch;
      st.vg = c.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.22, cw / 2, ch / 2, Math.max(cw, ch) * 0.76);
      st.vg.addColorStop(0, 'rgba(0,0,0,0)'); st.vg.addColorStop(0.55, 'rgba(0,0,0,0.20)'); st.vg.addColorStop(1, 'rgba(0,0,0,0.78)');
    }
    c.fillStyle = st.vg; c.fillRect(0, 0, cw, ch);
    // 说清楚这不是渲染坏了：原著里高维宇宙本来就看不了。
    // 正常情况下这句话由 createDimVeil 那块 DOM 卡片来说（还带着出口按钮），这里就不再画一遍；
    // 只有部件建不出来（没有 document / 画布没有父节点）时才退回画在画布上。
    if (!o || !o.drawText) return;
    // 'D=' 不进词典：两种语言写法一样，而两个字符的 key 太容易和别处撞车（i18n 用原文当 key）
    var msg = 'D=' + fmtNum(dimSVal, 2) + T(' 维宇宙：我们无法观察它');
    c.font = '600 15px Consolas, "Microsoft YaHei", monospace';
    var tw = c.measureText(msg).width, bx = cw / 2 - tw / 2 - 14, by = ch / 2 - 17;
    c.fillStyle = 'rgba(0,0,0,0.72)'; c.fillRect(bx, by, tw + 28, 34);
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1; c.strokeRect(bx + 0.5, by + 0.5, tw + 27, 33);
    c.fillStyle = '#ffffff'; c.textBaseline = 'middle';
    c.fillText(msg, cw / 2 - tw / 2, ch / 2);
    c.textBaseline = 'alphabetic';
  }
    return { draw: draw, reset: function () { st.shapes.length = 0; }, state: st };
  }
  /* ---------- 色调映射（点云 HDR 累积 → 显示） ----------
   * 点云是加性混合：团块内部一个像素上叠几百上千个粒子，累积值可以到几十几百。以前直接累进 8 位帧缓冲，
   * 超过 1.0 的部分当场被削平——高密度区整片纯白，看不出内部梯度。现在先累进 RGBA16F，再过一条曲线：
   *   f(x) = x                                x ≤ k
   *   f(x) = k + s(x−k)/((x−k)+s)，s = 1−k    x > k        （Reinhard 肩部）
   * 逐通道施加：单调递增、在 k 处一阶连续（f′(k)=1）、f(+∞)=1（永远取不到，8 位量化到 255 需要 x≳46）。
   * k 以下恒等 ⇒ 绝大多数像素（含 D=3 的正常画面：整幅 p99 的线性值约 0.40，远在 k 以下）数值不变；
   * k 以上把 0.70…46 这 66 倍动态范围摊到显示 179…255 的 76 级灰阶里，团块核心因此有可分辨的梯度，
   * 且各通道先后进入肩部 ⇒ 核心自然发白、边缘保留密度色标的冷色（"越热越白"的密度色带）。
   * k 试过 0.55（肩部更长）：D=7.7 下自动曝光收敛到的增益几乎不变（0.0497 vs 0.0491，团块灰阶 99 vs 102，
   * 因为那里卡住曝光的是 p99 主控而不是削顶约束），而 #1207 的整幅 p99 会掉 10%——所以留在 0.70。 */
  var TONE_K = 0.70;
  function toneMap(x) { if (!(x > TONE_K)) return x > 0 ? x : 0; var s = 1 - TONE_K, u = x - TONE_K; return TONE_K + s * u / (u + s); }
  function toneInv(v) { if (!(v > TONE_K)) return v > 0 ? v : 0; var s = 1 - TONE_K, u = v - TONE_K; return u >= s ? Infinity : TONE_K + s * u / (s - u); }
  var TONE_KS = TONE_K.toFixed(4), TONE_SS = (1 - TONE_K).toFixed(4);
  var TONE_GLSL = 'float tone1(float x){ const float k=' + TONE_KS + ', s=' + TONE_SS + '; if (x<=k) return max(x,0.0); float u=x-k; return k+s*u/(u+s); }\n' +
    'vec3 tone3(vec3 c){ return vec3(tone1(c.r), tone1(c.g), tone1(c.b)); }\n';
  var TONE_WGSL = 'fn tone1(x: f32) -> f32 { let k = ' + TONE_KS + '; let s = ' + TONE_SS + '; if (x <= k) { return max(x, 0.0); } let u = x - k; return k + s * u / (u + s); }\n' +
    'fn tone3(c: vec3<f32>) -> vec3<f32> { return vec3<f32>(tone1(c.x), tone1(c.y), tone1(c.z)); }\n';
  /* 亮度直方图（256 桶，桶 i = 显示值 i/255 的像素数）→ 自动曝光要的统计量。
   * "亮像素"= 显示值 ≥ LIT_MIN（6/255）：纯黑背景不参与百分位，否则 D 高的宇宙里 99% 的像素是黑的，
   * 任何百分位都落在 0 上，直方图形状无从谈起。 */
  var LIT_MIN = 6, CLIP_MIN = 250;
  function histStats(hist, cnt) {
    if (!hist || !cnt) return null;
    var i, sum = 0, lit = 0, clip = 0;
    for (i = 0; i < 256; i++) { sum += i * hist[i]; if (i >= LIT_MIN) lit += hist[i]; if (i >= CLIP_MIN) clip += hist[i]; }
    // 全体像素的第 99 百分位（与旧版口径一致：从亮端往下累计 1%）
    var need = Math.max(1, Math.round(cnt * 0.01)), acc = 0, p99 = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= need) { p99 = i; break; } }
    // 亮像素的分位数：p50 / p99.9（形状判据用）
    function qLit(q) {
      if (!lit) return 0;
      var want = Math.max(1, Math.round(lit * (1 - q))), a = 0, j;
      for (j = 255; j >= LIT_MIN; j--) { a += hist[j]; if (a >= want) return j; }
      return LIT_MIN;
    }
    var p50L = qLit(0.5), p995L = qLit(0.995), p999L = qLit(0.999);
    // 形状：把显示值反变换回线性 HDR 再取比值（肩部压过的高光不这样还原就永远"看着不峰"）
    var lin50 = Math.max(toneInv(p50L / 255), 1 / 255), lin999 = toneInv(Math.min(p999L, 254) / 255);
    return {
      px: cnt, mean: sum / cnt / 255, p99: p99 / 255, sat: clip / cnt,
      litFrac: lit / cnt, clipLit: lit ? clip / lit : 0, p50Lit: p50L / 255, p995Lit: p995L / 255, p999Lit: p999L / 255,
      peak: lin999 / lin50
    };
  }
  function fmtLen(mpc) { // 共动/固有长度（Mpc）→ 合适单位
    if (!isFinite(mpc)) return '—';
    var ly = mpc * MPC_LY, s;
    if (mpc >= 1000) s = (mpc / 1000).toFixed(2) + ' Gpc';
    else if (mpc >= 1) s = mpc.toFixed(mpc >= 10 ? 1 : 2) + ' Mpc';
    else if (mpc >= 1e-3) s = (mpc * 1e3).toFixed(mpc >= 1e-2 ? 1 : 2) + ' kpc';
    else if (mpc >= 1e-6) s = (mpc * 1e6).toFixed(mpc >= 1e-5 ? 1 : 2) + ' pc';
    else s = (mpc * 1e6 * 206265).toFixed(0) + ' AU';
    if (ly >= 1e9) s += T('（') + (ly / 1e9).toFixed(2) + T(' 十亿光年') + T('）');
    else if (ly >= 1e6) s += T('（') + (ly / 1e6).toFixed(2) + T(' 百万光年') + T('）');
    else if (ly >= 1) s += T('（') + (ly >= 1000 ? (ly / 1000).toFixed(1) + T(' 千光年') : ly.toFixed(ly >= 10 ? 0 : 1) + T(' 光年')) + T('）');
    return s;
  }

  /* ============================================================
   * §1 数值内核（主线程与 Worker 共用：以 KERNEL.toString() 打包进 Worker）
   *    不得引用本函数之外的任何闭包变量。
   * ============================================================ */
  function KERNEL() {
    var TAU = 6.283185307179586, PI = Math.PI;
    var RHO_CRIT = 2.775e11;
    function mulberry32(seed) {
      var a = seed >>> 0;
      return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    function hash32(a) { a = a >>> 0; a = (a ^ 61) ^ (a >>> 16); a = Math.imul(a, 9) >>> 0; a ^= a >>> 4; a = Math.imul(a, 0x27d4eb2d) >>> 0; a ^= a >>> 15; return a >>> 0; }

    /* ---------- 宇宙学：背景 E²(a)、增长因子 D(a)、f(a)、t(a)、EH98 传递函数、σ₈ 归一 ---------- */
    function makeCosmo(c) {
      c = c || {};
      var h = c.h != null ? c.h : (c.H0 != null ? c.H0 / 100 : 0.674);
      var OmB = c.omegaB != null ? c.omegaB : 0.049, OmC = c.omegaC != null ? c.omegaC : 0.26;
      var OmM = c.omegaM != null ? c.omegaM : OmB + OmC;
      if (OmB > OmM) OmB = OmM;
      var OmL = c.omegaLambda != null ? c.omegaLambda : 0.69, OmK = c.omegaK != null ? c.omegaK : 0;
      var tcmb = c.tcmb != null ? c.tcmb : 2.7255;
      var OmR = c.omegaR != null ? c.omegaR : 2.47e-5 * Math.pow(tcmb / 2.7255, 4) / (h * h) * (1 + 0.2271 * 3.046);
      var ns = c.ns != null ? c.ns : 0.965;
      var TH = 977.8 / (100 * h);   // 1/H0 [Gyr]
      function E2(a) { var a2 = a * a; return OmR / (a2 * a2) + OmM / (a2 * a) + OmK / a2 + OmL; }
      function Qacc(a) { var a2 = a * a; return -OmR / (a2 * a2) - 0.5 * OmM / (a2 * a) + OmL; }   // ä/a
      // 增长因子：D'' + (2 + dlnE/dx) D' − 1.5 Ω_m(a) D = 0，x = ln a；Meszaros 初值
      var xs = [], Ds = [], fs = [], ts = [];
      var aEq = OmM > 0 ? OmR / OmM : 1e-3;
      var x = Math.log(1e-6), dx = 0.01, xEnd = Math.log(20);
      var D = 1 + 1.5 * Math.exp(x) / aEq, Dp = 1.5 * Math.exp(x) / aEq;
      var t = Math.exp(2 * x) / (2 * Math.sqrt(Math.max(OmR, 1e-30)));  // 早期辐射解 t = a²/(2√Ω_r)
      var aMax = null, ok = true;
      function rhs(x, D, Dp) {
        var a = Math.exp(x), e2 = E2(a); if (e2 <= 0) return null;
        var a2 = a * a, dlnE = (-4 * OmR / (a2 * a2) - 3 * OmM / (a2 * a) - 2 * OmK / a2) / (2 * e2);
        var Oma = OmM / (a2 * a) / e2;
        return [Dp, -(2 + dlnE) * Dp + 1.5 * Oma * D];
      }
      while (x < xEnd) {
        var a = Math.exp(x), e2 = E2(a);
        if (e2 <= 0) { aMax = Math.exp(x - dx); break; }
        xs.push(x); Ds.push(D); fs.push(D > 0 ? Dp / D : 0); ts.push(t);
        var k1 = rhs(x, D, Dp); if (!k1) { aMax = a; break; }
        var k2 = rhs(x + dx / 2, D + dx / 2 * k1[0], Dp + dx / 2 * k1[1]); if (!k2) { aMax = a; break; }
        var k3 = rhs(x + dx / 2, D + dx / 2 * k2[0], Dp + dx / 2 * k2[1]); if (!k3) { aMax = a; break; }
        var k4 = rhs(x + dx, D + dx * k3[0], Dp + dx * k3[1]); if (!k4) { aMax = a; break; }
        var Dn = D + dx / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
        var Dpn = Dp + dx / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
        // t(x) = ∫dx/E（梯形）
        var e2n = E2(Math.exp(x + dx));
        if (e2n > 0) t += dx * 0.5 * (1 / Math.sqrt(e2) + 1 / Math.sqrt(e2n));
        D = Dn; Dp = Dpn; x += dx;
      }
      if (aMax == null && x >= xEnd) aMax = null;
      function interp(arr, xq) {
        if (!xs.length) return 0;
        if (xq <= xs[0]) return arr[0];
        if (xq >= xs[xs.length - 1]) return arr[arr.length - 1];
        var i = Math.floor((xq - xs[0]) / dx); if (i >= xs.length - 1) i = xs.length - 2;
        var f = (xq - xs[i]) / dx; return arr[i] + (arr[i + 1] - arr[i]) * f;
      }
      var aTop = xs.length ? Math.exp(xs[xs.length - 1]) : 1;   // 增长表可达的最大 a
      var aNorm = aTop >= 1 ? 1 : aTop * 0.9;                    // 归一化时刻（正常宇宙 a=1；转向前坍缩者取 0.9 a_max）
      var Dnorm = interp(Ds, Math.log(aNorm)) || 1;
      function growth(a) { return interp(Ds, Math.log(Math.max(a, 1e-6))) / Dnorm; }
      function fgrow(a) { return interp(fs, Math.log(Math.max(a, 1e-6))); }
      function tOfA(a) { return interp(ts, Math.log(Math.max(a, 1e-6))); }   // [1/H0]
      // EH98 无重子振荡近似（Eisenstein & Hu 1998, ApJ 496, 605, eq. 26–31）；k 单位 h/Mpc
      var Th = tcmb / 2.7, omh2 = OmM * h * h, obh2 = OmB * h * h;
      var fb = OmM > 0 ? OmB / OmM : 0;
      var sh = omh2 > 0 ? 44.5 * Math.log(9.83 / omh2) / Math.sqrt(1 + 10 * Math.pow(Math.max(obh2, 1e-8), 0.75)) : 0;
      var aG = omh2 > 0 ? 1 - 0.328 * Math.log(431 * omh2) * fb + 0.38 * Math.log(22.3 * omh2) * fb * fb : 1;
      function transfer(k) {
        if (!(omh2 > 0)) return 1;
        var kMpc = k * h;
        var G = OmM * h * (aG + (1 - aG) / (1 + Math.pow(0.43 * kMpc * sh, 4)));
        var q = k * Th * Th / Math.max(G, 1e-12);
        var L0 = Math.log(2 * Math.E + 1.8 * q), C0 = 14.2 + 731 / (1 + 62.5 * q);
        return L0 / (L0 + C0 * q * q);
      }
      function W(x) { return x < 1e-3 ? 1 : 3 * (Math.sin(x) - x * Math.cos(x)) / (x * x * x); }
      // σ(R)² = ∫ k²dk/(2π²) P W²
      function sigmaR2(Pf, R) {
        var s = 0, lk0 = Math.log(1e-4), lk1 = Math.log(1e2), n = 500, dl = (lk1 - lk0) / n;
        for (var i = 0; i <= n; i++) { var lk = lk0 + i * dl, k = Math.exp(lk), w = (i === 0 || i === n) ? 0.5 : 1; var wk = W(k * R); s += w * k * k * k * Pf(k) * wk * wk; }
        return s * dl / (2 * PI * PI);
      }
      var s8 = c.sigma8 != null && isFinite(c.sigma8) && c.sigma8 > 0 ? c.sigma8 : 0.81;
      s8 = Math.min(Math.max(s8, 1e-4), 50);
      var A = 1, unnorm = sigmaR2(function (k) { var T = transfer(k); return Math.pow(k, ns) * T * T; }, 8);
      if (unnorm > 0) A = s8 * s8 / unnorm;
      function Pk(k) { var T = transfer(k); return A * Math.pow(k, ns) * T * T; }   // z=0（归一化时刻）线性谱 [(Mpc/h)³]
      return { h: h, OmM: OmM, OmB: OmB, OmL: OmL, OmK: OmK, OmR: OmR, ns: ns, sigma8: s8, TH: TH, tcmb: tcmb, aEq: aEq, aMax: aMax, aNorm: aNorm,
        E2: E2, Qacc: Qacc, growth: growth, f: fgrow, tOfA: tOfA, transfer: transfer, Pk: Pk, A: A, sigmaR2: sigmaR2 };
    }

    /* ---------- 背景推进（同引擎：ȧ 按 ä/a 推进后投影到第一积分 ȧ²=a²E²，自然处理转向） ---------- */
    function advanceBackground(cos, st, dt) {
      var a = st.a;
      st.ad += a * cos.Qacc(a) * dt;
      var e2 = cos.E2(a);
      if (e2 > 0) st.ad = (st.ad >= 0 ? 1 : -1) * a * Math.sqrt(e2);
      st.a = a + st.ad * dt; st.t += dt;
      if (st.a < 1e-4) st.a = 1e-4;
      st.H = st.ad / st.a;
      return st;
    }
    function suggestDt(cos, st, dlnaMax, dtMax) {
      var H = Math.abs(st.ad / st.a);
      return Math.min(dtMax, dlnaMax / Math.max(H, 1e-9));
    }

    /* ---------- FFT（复数，就地，radix-2；3D 逐轴） ---------- */
    var fftCache = {};
    function fftPlan(n) {
      if (fftCache[n]) return fftCache[n];
      var log = Math.round(Math.log2(n));
      if ((1 << log) !== n) throw new Error('FFT 长度须为 2 的幂：' + n);
      var rev = new Uint32Array(n);
      for (var i = 0; i < n; i++) { var r = 0, v = i; for (var b = 0; b < log; b++) { r = (r << 1) | (v & 1); v >>= 1; } rev[i] = r; }
      var cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
      for (i = 0; i < n / 2; i++) { cs[i] = Math.cos(TAU * i / n); sn[i] = Math.sin(TAU * i / n); }
      return (fftCache[n] = { n: n, log: log, rev: rev, cs: cs, sn: sn, tr: new Float64Array(n), ti: new Float64Array(n) });
    }
    // 对 tr/ti（长度 n）就地变换；sign=-1 正变换，+1 逆变换（不归一）
    function fft1(plan, tr, ti, sign) {
      var n = plan.n, rev = plan.rev, cs = plan.cs, sn = plan.sn, i, j, t;
      for (i = 0; i < n; i++) { j = rev[i]; if (j > i) { t = tr[i]; tr[i] = tr[j]; tr[j] = t; t = ti[i]; ti[i] = ti[j]; ti[j] = t; } }
      for (var len = 2; len <= n; len <<= 1) {
        var half = len >> 1, step = n / len;
        for (i = 0; i < n; i += len) {
          for (j = 0; j < half; j++) {
            var wr = cs[j * step], wi = sign * sn[j * step];
            var a = i + j, b = a + half;
            var xr = tr[b] * wr - ti[b] * wi, xi = tr[b] * wi + ti[b] * wr;
            tr[b] = tr[a] - xr; ti[b] = ti[a] - xi; tr[a] += xr; ti[a] += xi;
          }
        }
      }
    }
    // 3D：re/im 为 M³ Float32Array（索引 x + M(y + Mz)），sign 同上，不归一
    function fft3(re, im, M, sign) {
      var plan = fftPlan(M), tr = plan.tr, ti = plan.ti, M2 = M * M, i, l, base;
      // x 轴
      for (l = 0; l < M2; l++) { base = l * M; for (i = 0; i < M; i++) { tr[i] = re[base + i]; ti[i] = im[base + i]; } fft1(plan, tr, ti, sign); for (i = 0; i < M; i++) { re[base + i] = tr[i]; im[base + i] = ti[i]; } }
      // y 轴：线 (x, z)，步长 M
      for (var z = 0; z < M; z++) for (var x = 0; x < M; x++) { base = x + z * M2; for (i = 0; i < M; i++) { tr[i] = re[base + i * M]; ti[i] = im[base + i * M]; } fft1(plan, tr, ti, sign); for (i = 0; i < M; i++) { re[base + i * M] = tr[i]; im[base + i * M] = ti[i]; } }
      // z 轴：线 (x, y)，步长 M²
      for (l = 0; l < M2; l++) { base = l; for (i = 0; i < M; i++) { tr[i] = re[base + i * M2]; ti[i] = im[base + i * M2]; } fft1(plan, tr, ti, sign); for (i = 0; i < M; i++) { re[base + i * M2] = tr[i]; im[base + i * M2] = ti[i]; } }
    }

    /* ---------- 初始条件：白噪声 → k 空间乘 √P → Zel'dovich 位移场（M³ 网格）→ Np³ 粒子 ---------- */
    // 返回 {pos: Float32Array(4Np³) [x,y,z,dens], vel: Float32Array(4Np³) [ux,uy,uz,0]}（vec4 布局，直接可上 GPU）
    function generateIC(cfg, progress) {
      var M = cfg.mesh, Np = cfg.np, L = cfg.boxMpc, seed = cfg.seed >>> 0, aIc = cfg.aIc, cos = cfg.cos;
      var M3 = M * M * M, V = L * L * L;
      var g = cos.growth(aIc), fE = cos.f(aIc) * Math.sqrt(Math.max(cos.E2(aIc), 0));
      var rnd = mulberry32(seed ^ 0x3D3D3D3D);
      var re = new Float32Array(M3), im = new Float32Array(M3);
      // 白噪声（Box–Muller），逐格确定
      for (var i = 0; i < M3; i += 2) {
        var u1 = rnd() || 1e-12, u2 = rnd(), r = Math.sqrt(-2 * Math.log(u1));
        re[i] = r * Math.cos(TAU * u2); if (i + 1 < M3) re[i + 1] = r * Math.sin(TAU * u2);
      }
      if (progress) progress('白噪声 → 傅里叶空间');
      fft3(re, im, M, -1);
      // 乘 √(M³ P(k)/V)·g；k = 2π n / L
      var kf = TAU / L, half = M >> 1, dre = re, dim = im, sq = Math.sqrt(M3 / V) * g;
      var idx = 0;
      for (var z = 0; z < M; z++) { var nz = z > half ? z - M : z; for (var y = 0; y < M; y++) { var ny = y > half ? y - M : y; for (var x = 0; x < M; x++, idx++) {
        var nx = x > half ? x - M : x;
        var k = kf * Math.sqrt(nx * nx + ny * ny + nz * nz);
        var amp = k > 0 ? Math.sqrt(Math.max(cos.Pk(k), 0)) * sq : 0;
        dre[idx] *= amp; dim[idx] *= amp;
      } } }
      // 三个位移分量：ψ̂_c = i k_c/k² δ̂ → 逆变换 /M³ → Mpc/h → 盒单位
      var psi = [null, null, null], wr = new Float32Array(M3), wi = new Float32Array(M3);
      for (var comp = 0; comp < 3; comp++) {
        if (progress) progress('位移场分量 ' + (comp + 1) + '/3');
        idx = 0;
        for (z = 0; z < M; z++) { nz = z > half ? z - M : z; for (y = 0; y < M; y++) { ny = y > half ? y - M : y; for (x = 0; x < M; x++, idx++) {
          nx = x > half ? x - M : x;
          var k2 = kf * kf * (nx * nx + ny * ny + nz * nz);
          var kc = kf * (comp === 0 ? nx : comp === 1 ? ny : nz);
          // Nyquist 分量的奇函数部分置零（保证实数输出）
          if (k2 === 0 || (comp === 0 && x === half) || (comp === 1 && y === half) || (comp === 2 && z === half)) { wr[idx] = 0; wi[idx] = 0; continue; }
          var fac = kc / k2;
          wr[idx] = -fac * dim[idx]; wi[idx] = fac * dre[idx];
        } } }
        fft3(wr, wi, M, +1);
        var out = new Float32Array(M3), norm = 1 / (M3 * L);
        for (i = 0; i < M3; i++) out[i] = wr[i] * norm;
        psi[comp] = out;
      }
      re = im = wr = wi = null;
      if (progress) progress('放置 ' + Np + '³ 粒子');
      var N = Np * Np * Np, pos = new Float32Array(4 * N), vel = new Float32Array(4 * N);
      var a2fE = aIc * aIc * fE, px = psi[0], py = psi[1], pz = psi[2];
      var j = 0;
      for (var kz = 0; kz < Np; kz++) for (var ky = 0; ky < Np; ky++) for (var kx = 0; kx < Np; kx++, j++) {
        var qx = (kx + 0.5) / Np, qy = (ky + 0.5) / Np, qz = (kz + 0.5) / Np;
        // CIC 插值位移（网格值位于 j/M）
        var gx = qx * M, gy = qy * M, gz = qz * M;
        var x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz), tx = gx - x0, ty = gy - y0, tz = gz - z0;
        x0 %= M; y0 %= M; z0 %= M; var x1 = (x0 + 1) % M, y1 = (y0 + 1) % M, z1 = (z0 + 1) % M;
        var i000 = x0 + M * (y0 + M * z0), i100 = x1 + M * (y0 + M * z0), i010 = x0 + M * (y1 + M * z0), i110 = x1 + M * (y1 + M * z0);
        var i001 = x0 + M * (y0 + M * z1), i101 = x1 + M * (y0 + M * z1), i011 = x0 + M * (y1 + M * z1), i111 = x1 + M * (y1 + M * z1);
        var w000 = (1 - tx) * (1 - ty) * (1 - tz), w100 = tx * (1 - ty) * (1 - tz), w010 = (1 - tx) * ty * (1 - tz), w110 = tx * ty * (1 - tz);
        var w001 = (1 - tx) * (1 - ty) * tz, w101 = tx * (1 - ty) * tz, w011 = (1 - tx) * ty * tz, w111 = tx * ty * tz;
        var dx = px[i000] * w000 + px[i100] * w100 + px[i010] * w010 + px[i110] * w110 + px[i001] * w001 + px[i101] * w101 + px[i011] * w011 + px[i111] * w111;
        var dy = py[i000] * w000 + py[i100] * w100 + py[i010] * w010 + py[i110] * w110 + py[i001] * w001 + py[i101] * w101 + py[i011] * w011 + py[i111] * w111;
        var dz = pz[i000] * w000 + pz[i100] * w100 + pz[i010] * w010 + pz[i110] * w110 + pz[i001] * w001 + pz[i101] * w101 + pz[i011] * w011 + pz[i111] * w111;
        var X = qx + dx, Y = qy + dy, Z = qz + dz;
        X -= Math.floor(X); Y -= Math.floor(Y); Z -= Math.floor(Z);
        pos[4 * j] = X; pos[4 * j + 1] = Y; pos[4 * j + 2] = Z; pos[4 * j + 3] = 1;
        vel[4 * j] = dx * a2fE; vel[4 * j + 1] = dy * a2fE; vel[4 * j + 2] = dz * a2fE; vel[4 * j + 3] = 0;
      }
      return { pos: pos, vel: vel, N: N, growthIc: g };
    }

    /* ---------- CPU PM（WebGL2 回退路径，在 Worker 里跑） ----------
     * D 维引力：F ∝ r^{−(D−1)} → φ ∝ r^{−(D−2)} → 3 维嵌入下的傅里叶核 φ_k ∝ ρ_k · k^{−(5−D)}·exp(−k²ε²)
     *   D=3 → k^{−2}（标准泊松，且不加软化因子，数值与旧版逐位一致）
     *   D=3.7 → k^{−1.3}；D=6.51 → k^{+1.51}（核随 k 增长，靠软化长度 ε（1~2 个网格间距）压住紫外发散）
     * cfg.pexp = 5 − D（不截断）；cfg.softCells = ε 的网格间距数（0 = 不软化）。
     *
     * D>3 的限幅（CAP，PEXP<2 时启用；D<3 的核是紫外软的，不需要）：
     *   核随 k 增长 → 少数落进同一格的粒子会拿到极大的力，若让它们决定全局步长，整盘模拟会被拖到几乎不动
     *   （用户实测 D=3.6：a 卡在 0.0207，画面停在 Zel'dovich 初始格点）。因此：
     *   ① 步长用加速度的 99 百分位（而不是最大值）估计，且有下限 dtMin（见 Worker 的 loop）；
     *   ② 单粒子力限幅 |F| ≤ CAP_MULT × F₉₉；
     *   ③ 漂移前限速 |v| ≤ ε·a²/dt，即任何粒子一步位移不超过一个软化长度。
     *   这三条都只影响"极端个体"，不改变整体的引力标度关系；D=3 全部不启用，逐位与旧版一致。 */
    var CAP_MULT = 4;          // 力限幅 = 99 百分位的 4 倍
    var CAP_SAMPLES = 8192;    // 百分位采样上限
    function createCpuPM(cfg) {
      var M = cfg.mesh, M2 = M * M, M3 = M2 * M, cos = cfg.cos, L = cfg.boxMpc;
      var PEXP = cfg.pexp != null ? cfg.pexp : 2, SOFT = cfg.softCells > 0 ? cfg.softCells : 0;
      var CAP = PEXP < 2;      // D>3
      var ic = generateIC(cfg, cfg.progress);
      var N = ic.N, pos = ic.pos, vel = ic.vel;
      var rho = new Float32Array(M3), im = new Float32Array(M3), phi = rho;   // rho 复用为 φ 实部
      var fx = new Float32Array(M3), fy = new Float32Array(M3), fz = new Float32Array(M3);
      var dens8 = new Uint8Array(N), grid8 = new Uint8Array(M3);
      var st = { a: cfg.aIc, ad: 0, t: 0, H: 0, steps: 0 };
      st.ad = st.a * Math.sqrt(Math.max(cos.E2(st.a), 1e-30));
      var meanCell = N / M3, half = M >> 1, kf = TAU;   // 盒单位 k = 2π n
      var greenTab = null, accMax = 0;
      var fP99 = 0, fClamp = 0, capSamp = CAP ? new Float32Array(CAP_SAMPLES) : null, capStride = CAP ? Math.max(1, Math.ceil(N / CAP_SAMPLES)) : 1, capClamped = 0;
      function green() {
        if (greenTab) return greenTab;
        greenTab = new Float32Array(M3); var idx = 0, norm = 1 / M3;
        var eps = SOFT > 0 ? SOFT / M : 0, eps2 = eps * eps;   // 软化长度（盒单位）
        function sinc(x) { return x === 0 ? 1 : Math.sin(x) / x; }
        var kf2 = kf * kf;
        for (var z = 0; z < M; z++) { var nz = z > half ? z - M : z, wz = sinc(PI * nz / M); for (var y = 0; y < M; y++) { var ny = y > half ? y - M : y, wy = sinc(PI * ny / M); for (var x = 0; x < M; x++, idx++) { var nx = x > half ? x - M : x, wx = sinc(PI * nx / M); var n2 = nx * nx + ny * ny + nz * nz, k2 = kf2 * n2; var w = wx * wy * wz; w = w * w;
          // 反卷积一次 CIC 窗（sinc² 每轴，封顶）；PEXP=2 且不软化时保持旧式 1/k²，逐位不变
          // 归一：写成 (1/k_f²)·(k/k_f)^{−(5−D)} = (1/k_f²)·n^{−(5−D)}，即**以最大尺度（基频 k_f=2π）归一**——
          //   D 只改变各尺度之间的相对强度（D<3 小尺度更弱、D>3 小尺度更强），最大尺度的力与 D=3 相同。
          //   若不归一（直接 k^{−(5−D)}），因为盒单位下 k=2πn≥2π>1，D<3 会在所有尺度上都比 D=3 弱，这与
          //   F ∝ r^{−(D−1)} 在 D<3 时"衰减更慢、大尺度更强"矛盾。D=3 时该因子恒为 1，逐位不变。
          greenTab[idx] = k2 <= 0 ? 0 : (PEXP === 2 && !eps ? -norm / (k2 * Math.max(w, 0.15)) : -norm * Math.pow(n2, -PEXP / 2) / kf2 * (eps ? Math.exp(-k2 * eps2) : 1) / Math.max(w, 0.15));
        } } }
        return greenTab;
      }
      function deposit() {
        rho.fill(0);
        for (var i = 0; i < N; i++) {
          var gx = pos[4 * i] * M, gy = pos[4 * i + 1] * M, gz = pos[4 * i + 2] * M;
          var x0 = gx | 0, y0 = gy | 0, z0 = gz | 0, tx = gx - x0, ty = gy - y0, tz = gz - z0;
          if (x0 >= M) x0 = M - 1; if (y0 >= M) y0 = M - 1; if (z0 >= M) z0 = M - 1;
          var x1 = x0 + 1 === M ? 0 : x0 + 1, y1 = y0 + 1 === M ? 0 : y0 + 1, z1 = z0 + 1 === M ? 0 : z0 + 1;
          var b0 = M * (y0 + M * z0), b1 = M * (y1 + M * z0), b2 = M * (y0 + M * z1), b3 = M * (y1 + M * z1);
          var sx = 1 - tx, sy = 1 - ty, sz = 1 - tz;
          rho[b0 + x0] += sx * sy * sz; rho[b0 + x1] += tx * sy * sz; rho[b1 + x0] += sx * ty * sz; rho[b1 + x1] += tx * ty * sz;
          rho[b2 + x0] += sx * sy * tz; rho[b2 + x1] += tx * sy * tz; rho[b3 + x0] += sx * ty * tz; rho[b3 + x1] += tx * ty * tz;
        }
        var inv = 1 / meanCell;
        for (i = 0; i < M3; i++) { var d1 = rho[i] * inv; rho[i] = d1 - 1; var lv = Math.log2(1 + Math.max(0, d1)) * 15.9375; grid8[i] = lv > 255 ? 255 : lv < 0 ? 0 : lv; }
      }
      var lastPk = null;
      function solve(wantPk) {
        im.fill(0);
        fft3(rho, im, M, -1);
        if (wantPk) lastPk = measurePk(rho, im, M, L, N);
        var G = green();
        for (var i = 0; i < M3; i++) { rho[i] *= G[i]; im[i] *= G[i]; }
        fft3(rho, im, M, +1);   // φ = 实部（已在 green 里 /M³）
        var s = M / 12;   // 4 点差分：[8(φ₊₁−φ₋₁) − (φ₊₂−φ₋₂)]/(12Δ)
        for (var z = 0; z < M; z++) { var zm = (z + M - 1) % M, zp = (z + 1) % M, zm2 = (z + M - 2) % M, zp2 = (z + 2) % M; for (var y = 0; y < M; y++) { var ym = (y + M - 1) % M, yp = (y + 1) % M, ym2 = (y + M - 2) % M, yp2 = (y + 2) % M, row = M * (y + M * z); for (var x = 0; x < M; x++) {
          var xm = (x + M - 1) % M, xp = (x + 1) % M, xm2 = (x + M - 2) % M, xp2 = (x + 2) % M, i0 = row + x;
          fx[i0] = -(8 * (phi[row + xp] - phi[row + xm]) - (phi[row + xp2] - phi[row + xm2])) * s;
          fy[i0] = -(8 * (phi[M * (yp + M * z) + x] - phi[M * (ym + M * z) + x]) - (phi[M * (yp2 + M * z) + x] - phi[M * (ym2 + M * z) + x])) * s;
          fz[i0] = -(8 * (phi[M * (y + M * zp) + x] - phi[M * (y + M * zm) + x]) - (phi[M * (y + M * zp2) + x] - phi[M * (y + M * zm2) + x])) * s;
        } } }
      }
      function kick(dt, a, wantDens) {
        var gs = 1.5 * cos.OmM / a * dt, fMax = 0;
        var ns = 0, nClamp = 0;
        for (var i = 0; i < N; i++) {
          var gx = pos[4 * i] * M, gy = pos[4 * i + 1] * M, gz = pos[4 * i + 2] * M;
          var x0 = gx | 0, y0 = gy | 0, z0 = gz | 0, tx = gx - x0, ty = gy - y0, tz = gz - z0;
          if (x0 >= M) x0 = M - 1; if (y0 >= M) y0 = M - 1; if (z0 >= M) z0 = M - 1;
          var x1 = x0 + 1 === M ? 0 : x0 + 1, y1 = y0 + 1 === M ? 0 : y0 + 1, z1 = z0 + 1 === M ? 0 : z0 + 1;
          var b0 = M * (y0 + M * z0), b1 = M * (y1 + M * z0), b2 = M * (y0 + M * z1), b3 = M * (y1 + M * z1);
          var sx = 1 - tx, sy = 1 - ty, sz = 1 - tz;
          var w0 = sx * sy * sz, w1 = tx * sy * sz, w2 = sx * ty * sz, w3 = tx * ty * sz, w4 = sx * sy * tz, w5 = tx * sy * tz, w6 = sx * ty * tz, w7 = tx * ty * tz;
          var i0 = b0 + x0, i1 = b0 + x1, i2 = b1 + x0, i3 = b1 + x1, i4 = b2 + x0, i5 = b2 + x1, i6 = b3 + x0, i7 = b3 + x1;
          var Fx = fx[i0] * w0 + fx[i1] * w1 + fx[i2] * w2 + fx[i3] * w3 + fx[i4] * w4 + fx[i5] * w5 + fx[i6] * w6 + fx[i7] * w7;
          var Fy = fy[i0] * w0 + fy[i1] * w1 + fy[i2] * w2 + fy[i3] * w3 + fy[i4] * w4 + fy[i5] * w5 + fy[i6] * w6 + fy[i7] * w7;
          var Fz = fz[i0] * w0 + fz[i1] * w1 + fz[i2] * w2 + fz[i3] * w3 + fz[i4] * w4 + fz[i5] * w5 + fz[i6] * w6 + fz[i7] * w7;
          if (CAP) {
            var fm = Math.sqrt(Fx * Fx + Fy * Fy + Fz * Fz);
            if (fClamp > 0 && fm > fClamp) { var sc = fClamp / fm; Fx *= sc; Fy *= sc; Fz *= sc; fm = fClamp; nClamp++; }
            if (i % capStride === 0 && ns < CAP_SAMPLES) capSamp[ns++] = fm;
            if (fm > fMax) fMax = fm;
          }
          vel[4 * i] += gs * Fx;
          vel[4 * i + 1] += gs * Fy;
          vel[4 * i + 2] += gs * Fz;
          if (wantDens) { var d = grid8[i0] * w0 + grid8[i1] * w1 + grid8[i2] * w2 + grid8[i3] * w3 + grid8[i4] * w4 + grid8[i5] * w5 + grid8[i6] * w6 + grid8[i7] * w7; dens8[i] = d > 255 ? 255 : d; }
          if (!CAP) { var af = Math.abs(fx[i0]) + Math.abs(fy[i0]) + Math.abs(fz[i0]); if (af > fMax) fMax = af; }   // CFL 用：粒子处的最大力（估计）
        }
        if (CAP && ns > 0) {
          // 99 百分位（对采样排序）：步长按它估，力限幅按它的 CAP_MULT 倍
          var sub = capSamp.subarray(0, ns); Array.prototype.sort.call(sub, function (p, q) { return p - q; });
          fP99 = sub[Math.min(ns - 1, Math.floor(ns * 0.99))];
          fClamp = fP99 > 0 ? CAP_MULT * fP99 : 0;
          capClamped = nClamp;
          accMax = 1.5 * cos.OmM / a * Math.min(fMax, fClamp > 0 ? fClamp : fMax);
        } else {
          accMax = 1.5 * cos.OmM / a * fMax;   // 加速度量级 |du/dt|
        }
      }
      function drift(dt, a) {
        var f = dt / (a * a);
        // D>3 限速：一步位移不超过一个软化长度 ε（盒单位 SOFT/M）→ |v| ≤ ε·a²/dt
        var vmax = (CAP && dt > 0) ? (SOFT > 0 ? SOFT : 1) / M * a * a / dt : 0;
        for (var i = 0; i < N; i++) {
          if (vmax > 0) {
            var vx = vel[4 * i], vy = vel[4 * i + 1], vz = vel[4 * i + 2], sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (sp > vmax) { var s2 = vmax / sp; vel[4 * i] = vx * s2; vel[4 * i + 1] = vy * s2; vel[4 * i + 2] = vz * s2; }
          }
          var X = pos[4 * i] + vel[4 * i] * f, Y = pos[4 * i + 1] + vel[4 * i + 1] * f, Z = pos[4 * i + 2] + vel[4 * i + 2] * f;
          pos[4 * i] = X - Math.floor(X); pos[4 * i + 1] = Y - Math.floor(Y); pos[4 * i + 2] = Z - Math.floor(Z);
        }
      }
      // 初始力
      deposit(); solve(false); kick(0, st.a, true);
      var self = {
        N: N, mesh: M, pos: pos, vel: vel, dens8: dens8, grid8: grid8, delta: rho, st: st, growthIc: ic.growthIc,
        step: function (dt, wantPk) {
          var a0 = st.a;
          kick(dt * 0.5, a0, false);
          advanceBackground(cos, st, dt * 0.5);
          drift(dt, st.a);
          advanceBackground(cos, st, dt * 0.5);
          deposit(); solve(wantPk);
          kick(dt * 0.5, st.a, true);
          st.steps++;
          return st;
        },
        // CFL：一步之内的位移 Δx ≈ accel·dt²/a² 不超过 frac 个网格 → dt ≤ a·√(frac/(M·accel))
        cflDt: function (frac) {
          if (!(accMax > 0)) return Infinity;
          return st.a * Math.sqrt(Math.max(frac || 0.25, 1e-3) / (M * accMax));
        },
        maxAccel: function () { return accMax; },
        capInfo: function () { return { p99: fP99, clamp: fClamp, clamped: capClamped, on: CAP }; },
        lastPk: function () { return lastPk; }
      };
      return self;
    }

    /* ---------- 功率谱估计（已在 k 空间的 δ̂：re/im；盒长 L Mpc/h；扣除散粒噪声 V/N） ---------- */
    function measurePk(re, im, M, L, N) {
      var M3 = M * M * M, half = M >> 1, V = L * L * L, kf = TAU / L;
      var nb = half, sumP = new Float64Array(nb + 1), sumN = new Float64Array(nb + 1), cnt = new Uint32Array(nb + 1), idx = 0;
      var norm = V / (M3 * M3);   // P = V |δ̂/M³|²，并反卷积 CIC 沉积窗 W²=Π sinc⁴(πn/M)
      function sinc(x) { return x === 0 ? 1 : Math.sin(x) / x; }
      for (var z = 0; z < M; z++) { var nz = z > half ? z - M : z, wz = sinc(PI * nz / M); wz *= wz; for (var y = 0; y < M; y++) { var ny = y > half ? y - M : y, wy = sinc(PI * ny / M); wy *= wy; for (var x = 0; x < M; x++, idx++) {
        var nx = x > half ? x - M : x, n = Math.sqrt(nx * nx + ny * ny + nz * nz), b = Math.round(n);
        if (b === 0 || b > nb) continue;
        var wx = sinc(PI * nx / M); wx *= wx; var w2 = wx * wy * wz; w2 *= w2;
        sumP[b] += (re[idx] * re[idx] + im[idx] * im[idx]) * norm / Math.max(w2, 0.05); sumN[b] += n; cnt[b]++;
      } } }
      var out = [];   // 格点初始条件不扣散粒噪声（k<k_Nyq 无泊松噪声）
      for (var b2 = 1; b2 <= Math.floor(half * 0.8); b2++) if (cnt[b2]) out.push([kf * sumN[b2] / cnt[b2], sumP[b2] / cnt[b2]]);
      return out;
    }
    // 从分 bin 的 P(k) 估 σ₈：σ² = Σ P k² Δk W²(8k)/(2π²)
    function sigma8FromPk(pk) {
      if (!pk || pk.length < 2) return null;
      var s = 0;
      for (var i = 0; i < pk.length; i++) {
        var k = pk[i][0], P = pk[i][1], dk = i === 0 ? (pk[1][0] - pk[0][0]) : (pk[i][0] - pk[i - 1][0]);
        var x = 8 * k, w = x < 1e-3 ? 1 : 3 * (Math.sin(x) - x * Math.cos(x)) / (x * x * x);
        s += P * k * k * dk * w * w;
      }
      return Math.sqrt(s / (2 * PI * PI));
    }
    // 从实空间 δ 网格算 P(k)（WebGPU 回读用）
    function pkFromGrid(delta, M, L, N) {
      var re = new Float32Array(delta), im = new Float32Array(delta.length);
      fft3(re, im, M, -1);
      return measurePk(re, im, M, L, N);
    }

    /* ---------- 晕识别：密度峰（26 邻域局部极大 + 阈值）→ Top-N，质量=邻域内超密质量，半径=r_200 ---------- */
    // grid: Float32Array δ（或 Uint8 log 编码 + isU8）；返回 [{ix,iy,iz,x,y,z,delta,mass,r,id}]
    function findHalos(grid, M, opts) {
      opts = opts || {};
      var isU8 = grid instanceof Uint8Array, M2 = M * M, M3 = M2 * M;
      var thr = opts.threshold != null ? opts.threshold : 40, topN = opts.topN || 160;
      var cellMass = opts.cellMass || 1;   // M⊙/h
      var OmM = opts.omegaM || 0.31, L = opts.boxMpc || 200;
      function val(i) { return isU8 ? Math.pow(2, grid[i] / 15.9375) - 2 : grid[i]; }   // u8 编码为 log2(1+ρ/ρ̄) → δ
      var peaks = [];
      for (var z = 0; z < M; z++) { var zm = (z + M - 1) % M, zp = (z + 1) % M; for (var y = 0; y < M; y++) { var ym = (y + M - 1) % M, yp = (y + 1) % M; for (var x = 0; x < M; x++) {
        var i0 = x + M * (y + M * z), d0 = val(i0);
        if (d0 < thr) continue;
        var xm = (x + M - 1) % M, xp = (x + 1) % M, ok = true;
        var zs = [zm, z, zp], ys = [ym, y, yp], xs = [xm, x, xp];
        for (var a = 0; a < 3 && ok; a++) for (var b = 0; b < 3 && ok; b++) for (var c = 0; c < 3; c++) { var j = xs[c] + M * (ys[b] + M * zs[a]); if (j !== i0 && val(j) >= d0) { ok = false; break; } }
        if (ok) peaks.push({ i: i0, ix: x, iy: y, iz: z, delta: d0 });
      } } }
      peaks.sort(function (p, q) { return q.delta - p.delta; });
      var out = [];
      for (var p = 0; p < peaks.length && out.length < topN; p++) {
        var pk = peaks[p], too = false;
        for (var q = 0; q < out.length; q++) { var dx = Math.abs(out[q].ix - pk.ix), dy = Math.abs(out[q].iy - pk.iy), dz = Math.abs(out[q].iz - pk.iz); dx = Math.min(dx, M - dx); dy = Math.min(dy, M - dy); dz = Math.min(dz, M - dz); if (dx * dx + dy * dy + dz * dz < 6.25) { too = true; break; } }
        if (too) continue;
        // 质量：5³ 邻域内 max(0,δ)·cellMass（超密质量）+ 峰的质心修正
        var mass = 0, cx = 0, cy = 0, cz = 0, wsum = 0;
        for (var a2 = -2; a2 <= 2; a2++) for (var b2 = -2; b2 <= 2; b2++) for (var c2 = -2; c2 <= 2; c2++) {
          var xx = (pk.ix + c2 + M) % M, yy = (pk.iy + b2 + M) % M, zz = (pk.iz + a2 + M) % M;
          var v = Math.max(0, val(xx + M * (yy + M * zz)));
          mass += v; if (Math.abs(a2) <= 1 && Math.abs(b2) <= 1 && Math.abs(c2) <= 1) { cx += v * c2; cy += v * b2; cz += v * a2; wsum += v; }
        }
        mass *= cellMass;
        if (wsum > 0) { cx /= wsum; cy /= wsum; cz /= wsum; }
        var rMpc = Math.pow(3 * mass / (4 * PI * 200 * OmM * RHO_CRIT), 1 / 3);   // r_200 [Mpc/h]
        var X = ((pk.ix + 0.5 + cx) / M + 1) % 1, Y = ((pk.iy + 0.5 + cy) / M + 1) % 1, Z = ((pk.iz + 0.5 + cz) / M + 1) % 1;
        out.push({ id: hash32(pk.i ^ 0x51ED270B), cell: pk.i, ix: pk.ix, iy: pk.iy, iz: pk.iz, x: X, y: Y, z: Z, delta: pk.delta, mass: mass, rMpc: rMpc, r: rMpc / L });
      }
      return out;
    }
    // 小地图：沿 z 投影的 M×M 平均 log 密度（Float32 0..1）
    function minimapFromGrid(grid, M) {
      var isU8 = grid instanceof Uint8Array, img = new Float32Array(M * M), M2 = M * M;
      for (var z = 0; z < M; z++) for (var i = 0; i < M2; i++) { var v = isU8 ? grid[z * M2 + i] / 255 : Math.log2(1 + Math.max(0, 1 + grid[z * M2 + i])) / 16; img[i] += v; }
      var mx = 1e-6; for (i = 0; i < M2; i++) { img[i] /= M; if (img[i] > mx) mx = img[i]; }
      for (i = 0; i < M2; i++) img[i] = Math.min(1, img[i] / mx);
      return img;
    }

    return { mulberry32: mulberry32, hash32: hash32, makeCosmo: makeCosmo, advanceBackground: advanceBackground, suggestDt: suggestDt,
      fft3: fft3, generateIC: generateIC, createCpuPM: createCpuPM, measurePk: measurePk, sigma8FromPk: sigma8FromPk, pkFromGrid: pkFromGrid,
      findHalos: findHalos, minimapFromGrid: minimapFromGrid };
  }
  var K = KERNEL();

  /* ============================================================
   * §2 Worker（角色：ic 生成初始条件 / sim CPU PM / analysis 回读网格分析）
   * ============================================================ */
  function WORKER_MAIN() {
    var K = KERNEL();
    var pm = null, cos = null, cfg = null, running = false, target = { t: Infinity, a: Infinity }, timer = null, lastPost = 0, sendEvery = 0, dirty = false, lastDt = 0, lowPower = false;
    function post(msg, tr) { self.postMessage(msg, tr || []); }
    function analysis(grid, M, opts) {
      var halos = K.findHalos(grid, M, opts);
      var mini = K.minimapFromGrid(grid, M);
      return { halos: halos, minimap: mini };
    }
    function stateMsg(kind, withAnalysis) {
      var st = pm.st, N = pm.N;
      var pos = new Float32Array(3 * N), i;
      for (i = 0; i < N; i++) { pos[3 * i] = pm.pos[4 * i]; pos[3 * i + 1] = pm.pos[4 * i + 1]; pos[3 * i + 2] = pm.pos[4 * i + 2]; }
      var dens = new Uint8Array(pm.dens8), grid = new Uint8Array(pm.grid8);
      var m = { type: kind, pos: pos, dens: dens, grid: grid, a: st.a, ad: st.ad, t: st.t, steps: st.steps, N: N, mesh: pm.mesh, accMax: pm.maxAccel ? pm.maxAccel() : 0, cap: pm.capInfo ? pm.capInfo() : null, dt: lastDt };
      if (withAnalysis) {
        var an = analysis(pm.grid8, pm.mesh, cfg.haloOpts);
        m.halos = an.halos; m.minimap = an.minimap;
        var pk = pm.lastPk(); if (pk) { m.Pk = pk; m.sigma8 = K.sigma8FromPk(pk); }
      }
      return m;
    }
    function loop() {
      timer = null;
      if (!running || !pm) return;
      var burst = lowPower ? 22 : 60;
      var t0 = Date.now(), did = 0;
      while (running && Date.now() - t0 < burst) {
        var st = pm.st;
        if (st.t >= target.t || st.a >= target.a || (st.ad < 0 && st.a <= cfg.aIc * 1.05) || st.a >= cfg.aStop) { running = false; break; }
        var dt = K.suggestDt(cos, st, cfg.dlnaMax || 0.05, cfg.dtMax || 0.02);
        // D≠3：按加速度自适应缩小步长，但有下限 dtMin —— 否则极端粒子会把全局步长压到宇宙几乎不演化
        if (cfg.pexp != null && cfg.pexp !== 2) dt = Math.max(1e-7, Math.min(dt, Math.max(pm.cflDt(cfg.cfl || 0.25), cfg.dtMin || 0)));
        if (st.t + dt > target.t) dt = Math.max(1e-6, target.t - st.t);
        lastDt = dt;
        pm.step(dt, (st.steps % 8) === 0);
        did++;
      }
      var now = Date.now();
      if (did) dirty = true;
      if (!running) {   // 停下来：总是发一份带分析的最终状态
        var mf = stateMsg('state', true); post(mf, [mf.pos.buffer, mf.dens.buffer, mf.grid.buffer]); dirty = false; lastPost = now;
        post({ type: 'idle', a: pm.st.a, t: pm.st.t }); return;
      }
      if (dirty && now - lastPost > 70) { lastPost = now; sendEvery++; var m = stateMsg('state', (sendEvery % 6) === 0); post(m, [m.pos.buffer, m.dens.buffer, m.grid.buffer]); dirty = false; }
      timer = setTimeout(loop, lowPower ? 55 : 0);   // 低功耗：每轮之间让出 CPU
    }
    self.onmessage = function (ev) {
      var m = ev.data;
      try {
        if (m.type === 'ic') {
          cos = K.makeCosmo(m.cosmo);
          var ic = K.generateIC({ mesh: m.mesh, np: m.np, boxMpc: m.boxMpc, seed: m.seed, aIc: m.aIc, cos: cos }, function (s) { post({ type: 'progress', text: s }); });
          post({ type: 'ic', pos: ic.pos, vel: ic.vel, N: ic.N, growthIc: ic.growthIc }, [ic.pos.buffer, ic.vel.buffer]);
        } else if (m.type === 'sim') {
          cfg = m; cos = K.makeCosmo(m.cosmo); lowPower = !!m.lowPower;
          pm = K.createCpuPM({ mesh: m.mesh, np: m.np, boxMpc: m.boxMpc, seed: m.seed, aIc: m.aIc, cos: cos, pexp: m.pexp, softCells: m.softCells, progress: function (s) { post({ type: 'progress', text: s }); } });
          var s0 = stateMsg('ready', true); post(s0, [s0.pos.buffer, s0.dens.buffer, s0.grid.buffer]);
        } else if (m.type === 'run') {
          if (m.target) target = m.target;
          if (!running) { running = true; if (!timer) timer = setTimeout(loop, 0); }
        } else if (m.type === 'power') {
          lowPower = !!m.lowPower;
        } else if (m.type === 'pause') {
          running = false;
        } else if (m.type === 'step') {
          if (pm) { var dt = m.dt || K.suggestDt(cos, pm.st, cfg.dlnaMax || 0.05, cfg.dtMax || 0.02); pm.step(dt, true); var sm = stateMsg('state', true); post(sm, [sm.pos.buffer, sm.dens.buffer, sm.grid.buffer]); }
        } else if (m.type === 'reset') {
          // 重算：重新生成同种子初始条件
          running = false; if (cfg) { pm = K.createCpuPM({ mesh: cfg.mesh, np: cfg.np, boxMpc: cfg.boxMpc, seed: cfg.seed, aIc: cfg.aIc, cos: cos, pexp: cfg.pexp, softCells: cfg.softCells, progress: null }); var r0 = stateMsg('state', true); post(r0, [r0.pos.buffer, r0.dens.buffer, r0.grid.buffer]); }
          if (m.run) { target = m.run; running = true; if (!timer) timer = setTimeout(loop, 0); }
        } else if (m.type === 'analyze') {
          if (pm) { var am = stateMsg('state', true); post(am, [am.pos.buffer, am.dens.buffer, am.grid.buffer]); }
        } else if (m.type === 'analysis') {
          // WebGPU 回读的 δ 网格（Float32Array）→ 晕 + 小地图 + P(k)
          var g = m.grid, M = m.mesh, an = analysis(g, M, m.haloOpts), out = { type: 'analysis', halos: an.halos, minimap: an.minimap, a: m.a, tag: m.tag };
          if (m.wantPk) { out.Pk = K.pkFromGrid(g, M, m.boxMpc, m.N); out.sigma8 = K.sigma8FromPk(out.Pk); }
          post(out);
        }
      } catch (err) { post({ type: 'error', message: String(err && err.stack || err) }); }
    };
  }
  var workerURL = null;
  function makeWorker() {
    if (!workerURL) {
      var src = KERNEL.toString() + '\n;(' + WORKER_MAIN.toString() + ')();';
      workerURL = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    }
    return new Worker(workerURL);
  }

  /* ============================================================
   * §3 WebGPU 后端：粒子/网格常驻 GPU，compute 做 PM，render 做点精灵（三角形包围圆盘，加性混合）
   * ============================================================ */
  // CIC 定点尺度：deposit 与 invMean 共用。N_max·S < 2³²（ultra 8e6·256=2.048e9 < 4.29e9）。
  var CIC_FIXED_S = 256;
  var WGSL = {};
  WGSL.simU = 'struct SimU { a: f32, dt: f32, gs: f32, M: u32, N: u32, invMean: f32, wantDens: u32, vcap: f32 };\n';
  WGSL.deposit = WGSL.simU +
    '@group(0) @binding(0) var<uniform> U: SimU;\n' +
    '@group(0) @binding(1) var<storage, read> pos: array<vec4<f32>>;\n' +
    '@group(0) @binding(2) var<storage, read_write> rho: array<atomic<u32>>;\n' +
    'fn idx(x: u32, y: u32, z: u32) -> u32 { return x + U.M * (y + U.M * z); }\n' +
    '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; if (i >= U.N) { return; }\n' +
    '  let Mf = f32(U.M); let g = fract(pos[i].xyz) * Mf; let fl = floor(g); let f = g - fl;\n' +
    '  let i0 = vec3<u32>(fl) % vec3<u32>(U.M); let i1 = (i0 + vec3<u32>(1u)) % vec3<u32>(U.M);\n' +
  // CIC 权重定点化：S 必须满足 N_max·S < 2³²（u32 原子累加不溢出）。
    // 旧值 4096 在 mid/high 档（N≥2M）全粒子落入同一格时会绕回，δ 变垃圾并污染力场。
    // S=CIC_FIXED_S（256）：ultra N=8M 全堆叠仍 <2³²，量化误差 ≤1/S 粒/格。
    // 与 writeSim 的 invMean = M³/(CIC_FIXED_S·N) 必须用同一常量（改一处漏一处会让 δ 系统性错位）。
    '  let s = vec3<f32>(1.0) - f; let S = ' + CIC_FIXED_S.toFixed(1) + ';\n' +
    '  atomicAdd(&rho[idx(i0.x,i0.y,i0.z)], u32(s.x*s.y*s.z*S + 0.5));\n' +
    '  atomicAdd(&rho[idx(i1.x,i0.y,i0.z)], u32(f.x*s.y*s.z*S + 0.5));\n' +
    '  atomicAdd(&rho[idx(i0.x,i1.y,i0.z)], u32(s.x*f.y*s.z*S + 0.5));\n' +
    '  atomicAdd(&rho[idx(i1.x,i1.y,i0.z)], u32(f.x*f.y*s.z*S + 0.5));\n' +
    '  atomicAdd(&rho[idx(i0.x,i0.y,i1.z)], u32(s.x*s.y*f.z*S + 0.5));\n' +
    '  atomicAdd(&rho[idx(i1.x,i0.y,i1.z)], u32(f.x*s.y*f.z*S + 0.5));\n' +
    '  atomicAdd(&rho[idx(i0.x,i1.y,i1.z)], u32(s.x*f.y*f.z*S + 0.5));\n' +
    '  atomicAdd(&rho[idx(i1.x,i1.y,i1.z)], u32(f.x*f.y*f.z*S + 0.5));\n' +
    '}\n';
  // 原子计数 → δ（f32 网格，供着色/体渲染/回读）+ FFT 输入（复数），并清零计数
  WGSL.prepare = WGSL.simU +
    '@group(0) @binding(0) var<uniform> U: SimU;\n' +
    '@group(0) @binding(1) var<storage, read_write> rho: array<atomic<u32>>;\n' +
    '@group(0) @binding(2) var<storage, read_write> dens: array<f32>;\n' +
    '@group(0) @binding(3) var<storage, read_write> fft: array<vec2<f32>>;\n' +
    '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; let M3 = U.M * U.M * U.M; if (i >= M3) { return; }\n' +
    '  let v = atomicExchange(&rho[i], 0u);\n' +
    '  let d = f32(v) * U.invMean - 1.0;\n' +
    '  dens[i] = d; fft[i] = vec2<f32>(d, 0.0);\n' +
    '}\n';
  // 共享内存 FFT：每个工作组处理一条长度 M 的线（就地）
  WGSL.fft = function (M, axis, sign) {
    var LOGM = Math.round(Math.log2(M)), HALF = M / 2;
    var line = axis === 0 ? 'let base = M * (wg.x + M * wg.y); let stride = 1u;' : axis === 1 ? 'let base = wg.x + M * M * wg.y; let stride = M;' : 'let base = wg.x + M * wg.y; let stride = M * M;';
    return 'const M: u32 = ' + M + 'u; const LOGM: u32 = ' + LOGM + 'u; const HALF: u32 = ' + HALF + 'u;\n' +
      '@group(0) @binding(0) var<storage, read_write> data: array<vec2<f32>>;\n' +
      'var<workgroup> sh: array<vec2<f32>, ' + M + '>;\n' +
      'fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> { return vec2<f32>(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }\n' +
      '@compute @workgroup_size(' + HALF + ') fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {\n' +
      '  let t = lid.x; ' + line + '\n' +
      '  for (var e = t; e < M; e += HALF) { let j = reverseBits(e) >> (32u - LOGM); sh[j] = data[base + e * stride]; }\n' +
      '  workgroupBarrier();\n' +
      '  var len = 2u;\n' +
      '  for (var s = 0u; s < LOGM; s++) {\n' +
      '    let half = len >> 1u; let grp = t / half; let k = t % half;\n' +
      '    let i0 = grp * len + k; let i1 = i0 + half;\n' +
      '    let ang = ' + (sign < 0 ? '-' : '') + '6.283185307179586 * f32(k) / f32(len);\n' +
      '    let w = vec2<f32>(cos(ang), sin(ang));\n' +
      '    let a = sh[i0]; let b = cmul(sh[i1], w);\n' +
      '    sh[i0] = a + b; sh[i1] = a - b;\n' +
      '    workgroupBarrier();\n' +
      '    len = len << 1u;\n' +
      '  }\n' +
      '  for (var e2 = t; e2 < M; e2 += HALF) { data[base + e2 * stride] = sh[e2]; }\n' +
      '}\n';
  };
  // 格林函数：φ_k = −δ_k · k^{−(5−D)} · exp(−k²ε²)，k = 2π n（盒单位）；含 1/M³ 归一与一次 CIC 窗反卷积。
  // pexp = 5−D（D=3 → 2，走与旧版逐位相同的 −1/k² 分支）；softCells = 软化长度 ε 的网格间距数（0 = 不软化）。
  WGSL.green = function (pexp, softCells) {
    var plain = (pexp === 2 && !(softCells > 0));
    // 归一同 CPU 版：(1/k_f²)·n^{−(5−D)}，以最大尺度（基频 k_f=2π，即 n=1）归一；D=3 走 plain 分支逐位不变
    var kernel = plain ? '(-1.0 / (k2 * f32(M3) * max(w * w, 0.15)))'
      : '(-pow(n2, ' + (-pexp / 2).toFixed(6) + ') * 0.025330295910584444 * exp(-k2 * ' + (softCells > 0 ? Math.pow(softCells, 2).toFixed(8) + ' / f32(M * M)' : '0.0') + ') / (f32(M3) * max(w * w, 0.15)))';
    return WGSL.simU +
      '@group(0) @binding(0) var<uniform> U: SimU;\n' +
      '@group(0) @binding(1) var<storage, read_write> fft: array<vec2<f32>>;\n' +
      'fn sincf(x: f32) -> f32 { if (abs(x) < 1e-6) { return 1.0; } return sin(x) / x; }\n' +
      '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
      '  let i = gid.x; let M = U.M; let M3 = M * M * M; if (i >= M3) { return; }\n' +
      '  let x = i % M; let y = (i / M) % M; let z = i / (M * M); let h = i32(M / 2u);\n' +
      '  var nx = i32(x); var ny = i32(y); var nz = i32(z);\n' +
      '  if (nx > h) { nx -= i32(M); } if (ny > h) { ny -= i32(M); } if (nz > h) { nz -= i32(M); }\n' +
      '  let n2 = f32(nx*nx + ny*ny + nz*nz);\n' +
      '  if (n2 == 0.0) { fft[i] = vec2<f32>(0.0); return; }\n' +
      '  let k2 = 39.47841760435743 * n2;\n' +
      '  let w = sincf(3.14159265 * f32(nx) / f32(M)) * sincf(3.14159265 * f32(ny) / f32(M)) * sincf(3.14159265 * f32(nz) / f32(M));\n' +
      '  fft[i] = fft[i] * ' + kernel + ';\n' +
      '}\n';
  };
  // 最大力归约（只在 D≠3 时建管线）：每 256 格算一个 max(|fx|+|fy|+|fz|)，回读后给自适应步长用（与 CPU PM 的 accMax 同一估计式）
  WGSL.fmax =
    '@group(0) @binding(0) var<storage, read> force: array<vec4<f32>>;\n' +
    '@group(0) @binding(1) var<storage, read_write> out: array<f32>;\n' +
    'var<workgroup> sh: array<f32, 256>;\n' +
    '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wg: vec3<u32>) {\n' +
    '  let n = arrayLength(&force); let i = gid.x;\n' +
    '  var v = 0.0;\n' +
    '  if (i < n) { let f = force[i]; v = abs(f.x) + abs(f.y) + abs(f.z); }\n' +
    '  sh[lid.x] = v;\n' +
    '  workgroupBarrier();\n' +
    '  for (var s = 128u; s > 0u; s = s >> 1u) {\n' +
    '    if (lid.x < s) { sh[lid.x] = max(sh[lid.x], sh[lid.x + s]); }\n' +
    '    workgroupBarrier();\n' +
    '  }\n' +
    '  if (lid.x == 0u) { out[wg.x] = sh[0]; }\n' +
    '}\n';
  WGSL.gradient = WGSL.simU +
    '@group(0) @binding(0) var<uniform> U: SimU;\n' +
    '@group(0) @binding(1) var<storage, read> fft: array<vec2<f32>>;\n' +
    '@group(0) @binding(2) var<storage, read_write> force: array<vec4<f32>>;\n' +
    'fn idx(x: u32, y: u32, z: u32) -> u32 { return x + U.M * (y + U.M * z); }\n' +
    '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; let M = U.M; if (i >= M * M * M) { return; }\n' +
    '  let x = i % M; let y = (i / M) % M; let z = i / (M * M);\n' +
    '  let xm = (x + M - 1u) % M; let xp = (x + 1u) % M; let ym = (y + M - 1u) % M; let yp = (y + 1u) % M; let zm = (z + M - 1u) % M; let zp = (z + 1u) % M;\n' +
    '  let xm2 = (x + M - 2u) % M; let xp2 = (x + 2u) % M; let ym2 = (y + M - 2u) % M; let yp2 = (y + 2u) % M; let zm2 = (z + M - 2u) % M; let zp2 = (z + 2u) % M;\n' +
    '  let s = f32(M) / 12.0;\n' +
    '  let gx = 8.0 * (fft[idx(xp,y,z)].x - fft[idx(xm,y,z)].x) - (fft[idx(xp2,y,z)].x - fft[idx(xm2,y,z)].x);\n' +
    '  let gy = 8.0 * (fft[idx(x,yp,z)].x - fft[idx(x,ym,z)].x) - (fft[idx(x,yp2,z)].x - fft[idx(x,ym2,z)].x);\n' +
    '  let gz = 8.0 * (fft[idx(x,y,zp)].x - fft[idx(x,y,zm)].x) - (fft[idx(x,y,zp2)].x - fft[idx(x,y,zm2)].x);\n' +
    '  force[i] = vec4<f32>(-gx * s, -gy * s, -gz * s, 0.0);\n' +
    '}\n';
  WGSL.kick = WGSL.simU +
    '@group(0) @binding(0) var<uniform> U: SimU;\n' +
    '@group(0) @binding(1) var<storage, read_write> pos: array<vec4<f32>>;\n' +
    '@group(0) @binding(2) var<storage, read_write> vel: array<vec4<f32>>;\n' +
    '@group(0) @binding(3) var<storage, read> force: array<vec4<f32>>;\n' +
    '@group(0) @binding(4) var<storage, read> dens: array<f32>;\n' +
    'fn idx(x: u32, y: u32, z: u32) -> u32 { return x + U.M * (y + U.M * z); }\n' +
    '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; if (i >= U.N) { return; }\n' +
    '  let Mf = f32(U.M); let g = fract(pos[i].xyz) * Mf; let fl = floor(g); let f = g - fl; let s = vec3<f32>(1.0) - f;\n' +
    '  let i0 = vec3<u32>(fl) % vec3<u32>(U.M); let i1 = (i0 + vec3<u32>(1u)) % vec3<u32>(U.M);\n' +
    '  let j0 = idx(i0.x,i0.y,i0.z); let j1 = idx(i1.x,i0.y,i0.z); let j2 = idx(i0.x,i1.y,i0.z); let j3 = idx(i1.x,i1.y,i0.z);\n' +
    '  let j4 = idx(i0.x,i0.y,i1.z); let j5 = idx(i1.x,i0.y,i1.z); let j6 = idx(i0.x,i1.y,i1.z); let j7 = idx(i1.x,i1.y,i1.z);\n' +
    '  let w0 = s.x*s.y*s.z; let w1 = f.x*s.y*s.z; let w2 = s.x*f.y*s.z; let w3 = f.x*f.y*s.z; let w4 = s.x*s.y*f.z; let w5 = f.x*s.y*f.z; let w6 = s.x*f.y*f.z; let w7 = f.x*f.y*f.z;\n' +
    '  let F = force[j0].xyz*w0 + force[j1].xyz*w1 + force[j2].xyz*w2 + force[j3].xyz*w3 + force[j4].xyz*w4 + force[j5].xyz*w5 + force[j6].xyz*w6 + force[j7].xyz*w7;\n' +
    '  var v = vel[i]; v = vec4<f32>(v.xyz + F * (U.gs * U.dt), 0.0); vel[i] = v;\n' +
    '  if (U.wantDens == 1u) {\n' +
    '    let d = dens[j0]*w0 + dens[j1]*w1 + dens[j2]*w2 + dens[j3]*w3 + dens[j4]*w4 + dens[j5]*w5 + dens[j6]*w6 + dens[j7]*w7;\n' +
    '    var p = pos[i]; p.w = max(0.0, 1.0 + d); pos[i] = p;\n' +
    '  }\n' +
    '}\n';
  // U.vcap > 0（D>3）：漂移前限速，任何粒子一步位移不超过一个软化长度；U.vcap = 0（D≤3）时与旧版逐位一致
  WGSL.drift = WGSL.simU +
    '@group(0) @binding(0) var<uniform> U: SimU;\n' +
    '@group(0) @binding(1) var<storage, read_write> pos: array<vec4<f32>>;\n' +
    '@group(0) @binding(2) var<storage, read_write> vel: array<vec4<f32>>;\n' +
    '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; if (i >= U.N) { return; }\n' +
    '  var v = vel[i].xyz;\n' +
    '  if (U.vcap > 0.0) { let sp = length(v); if (sp > U.vcap) { v = v * (U.vcap / sp); vel[i] = vec4<f32>(v, 0.0); } }\n' +
    '  var p = pos[i]; let q = fract(p.xyz + v * (U.dt / (U.a * U.a)));\n' +
    '  pos[i] = vec4<f32>(q, p.w);\n' +
    '}\n';
  // ---- 渲染：通用相机 uniform（与 GLSL 版本一致）
  WGSL.camU = 'struct CamU { cam: vec4<f32>, right: vec4<f32>, up: vec4<f32>, fwd: vec4<f32>, ' +
    'fx: f32, fy: f32, aspect: f32, exposure: f32, sizeW: f32, minPx: f32, maxPx: f32, fogR: f32, ' +
    'mode: u32, tiles: u32, N: u32, colorMode: u32, viewH: f32, time: f32, a: f32, nearFade: f32 };\n';
  WGSL.colorFn =
    'fn palette(ld: f32, cm: u32) -> vec3<f32> {\n' +   // ld = log2(1+δ_plus) 0..~10
    '  let t = clamp(ld / 8.0, 0.0, 1.0);\n' +
    '  let c0 = vec3<f32>(0.16, 0.12, 0.42); let c1 = vec3<f32>(0.32, 0.36, 0.95); let c2 = vec3<f32>(0.75, 0.86, 1.0); let c3 = vec3<f32>(1.0, 0.93, 0.78); let c4 = vec3<f32>(1.0, 0.72, 0.42);\n' +
    '  var c: vec3<f32>;\n' +
    '  if (t < 0.25) { c = mix(c0, c1, t / 0.25); } else if (t < 0.5) { c = mix(c1, c2, (t - 0.25) / 0.25); } else if (t < 0.75) { c = mix(c2, c3, (t - 0.5) / 0.25); } else { c = mix(c3, c4, (t - 0.75) / 0.25); }\n' +
    '  if (cm == 1u) { c = mix(vec3<f32>(0.2, 0.5, 1.0), vec3<f32>(1.0, 0.35, 0.15), t); }\n' +
    '  return c;\n' +
    '}\n';
  // 粒子点精灵：每粒子 3 顶点三角形包围单位圆盘；vertex pulling
  WGSL.points = WGSL.camU + WGSL.colorFn +
    '@group(0) @binding(0) var<uniform> C: CamU;\n' +
    '@group(0) @binding(1) var<storage, read> pos: array<vec4<f32>>;\n' +
    '@group(0) @binding(2) var<storage, read> vel: array<vec4<f32>>;\n' +
    'struct VOut { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) col: vec4<f32> };\n' +
    '@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {\n' +
    '  var o: VOut;\n' +
    '  let tri = vi / 3u; let corner = vi % 3u;\n' +
    '  let pi = tri % C.N; let tile = tri / C.N;\n' +
    '  var off = vec3<f32>(0.0);\n' +
    '  if (C.tiles > 1u) { off = vec3<f32>(f32(tile % 3u) - 1.0, f32((tile / 3u) % 3u) - 1.0, f32(tile / 9u) - 1.0); }\n' +
    '  let P = pos[pi]; var w = P.xyz;\n' +
    // C.tiles == 0：俯瞰模式，按绝对坐标画（不做最近像包裹）；否则最近像 + 平铺偏移
    '  if (C.tiles != 0u) { w = w + floor(C.cam.xyz - w + 0.5) + off; }\n' +
    '  let rel = w - C.cam.xyz;\n' +
    '  let cheb = max(max(abs(rel.x), abs(rel.y)), abs(rel.z));\n' +
    '  let fog = 1.0 - smoothstep(C.fogR * 0.6, C.fogR, cheb);\n' +
    '  let vz = dot(rel, C.fwd.xyz);\n' +
    '  if (vz <= 1e-9 || fog <= 0.001) { o.p = vec4<f32>(0.0, 0.0, -2.0, 1.0); o.uv = vec2<f32>(0.0); o.col = vec4<f32>(0.0); return o; }\n' +
    '  let vx = dot(rel, C.right.xyz); let vy = dot(rel, C.up.xyz);\n' +
    '  var px = C.sizeW * C.fy * C.viewH * 0.5 / vz;\n' +   // 像素半径
    '  let pxc = clamp(px, C.minPx, C.maxPx);\n' +
    '  let ld = log2(max(P.w, 0.0) + 1.0);\n' +
    '  var lum = C.exposure * fog * (C.minPx * C.minPx) / (pxc * pxc);\n' +
    '  if (px < C.minPx) { lum = lum * (px * px) / (C.minPx * C.minPx); }\n' +
    '  if (C.nearFade > 0.0) { let q = clamp(vz / C.nearFade, 0.0, 1.0); lum = lum * q * q; }\n' +
    '  var speed = 0.0; if (C.colorMode == 1u) { speed = length(vel[pi].xyz) / (C.a * C.a); }\n' +
    '  var c = palette(ld, C.colorMode);\n' +
    '  if (C.colorMode == 1u) { c = palette(clamp(speed * 40.0, 0.0, 8.0), 1u); }\n' +
    '  var cornerUV = array<vec2<f32>, 3>(vec2<f32>(-1.7320508, -1.0), vec2<f32>(1.7320508, -1.0), vec2<f32>(0.0, 2.0));\n' +
    '  let uv = cornerUV[corner];\n' +
    '  let ndc = vec2<f32>((vx * C.fx / vz) + uv.x * pxc * 2.0 / (C.viewH * C.aspect), (vy * C.fy / vz) + uv.y * pxc * 2.0 / C.viewH);\n' +
    '  o.p = vec4<f32>(ndc, 0.5, 1.0); o.uv = uv; o.col = vec4<f32>(c, lum);\n' +
    '  return o;\n' +
    '}\n' +
    '@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {\n' +
    '  let r2 = dot(i.uv, i.uv); if (r2 > 1.0) { discard; }\n' +
    '  let g = exp(-r2 * 3.0) - exp(-3.0);\n' +
    '  return vec4<f32>(i.col.rgb * i.col.a * g, i.col.a * g);\n' +
    '}\n';
  // 星系恒星层 / 晕标记：数据 [pos(rel 盒单位) xyz, size][r,g,b,lum]，中心相对相机由 uniform 给出（双精度在 JS 里算）
  WGSL.stars = WGSL.camU +
    'struct StarU { center: vec4<f32>, scale: f32, minPx: f32, maxPx: f32, exposure: f32, count: u32, kind: u32, sel: u32, pad: u32 };\n' +
    '@group(0) @binding(0) var<uniform> C: CamU;\n' +
    '@group(0) @binding(1) var<uniform> S: StarU;\n' +
    '@group(0) @binding(2) var<storage, read> st: array<vec4<f32>>;\n' +   // 2 vec4 / 星
    'struct VOut { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) col: vec4<f32>, @location(2) @interpolate(flat) kind: u32 };\n' +
    '@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {\n' +
    '  var o: VOut; let si = vi / 3u; let corner = vi % 3u;\n' +
    '  let A = st[2u * si]; let B = st[2u * si + 1u];\n' +
    '  let rel = S.center.xyz + A.xyz * S.scale;\n' +
    '  let vz = dot(rel, C.fwd.xyz);\n' +
    '  if (si >= S.count || vz <= 1e-12) { o.p = vec4<f32>(0.0, 0.0, -2.0, 1.0); o.uv = vec2<f32>(0.0); o.col = vec4<f32>(0.0); o.kind = 0u; return o; }\n' +
    '  let vx = dot(rel, C.right.xyz); let vy = dot(rel, C.up.xyz);\n' +
    '  var px = A.w * S.scale * C.fy * C.viewH * 0.5 / vz;\n' +
    '  var pxc = clamp(px, S.minPx, S.maxPx);\n' +
    '  var lum = S.exposure * B.w * (S.minPx * S.minPx) / (pxc * pxc);\n' +
    '  if (px < S.minPx) { lum = lum * max(px * px / (S.minPx * S.minPx), 1e-5); }\n' +
    '  if (S.kind == 1u) { pxc = clamp(px, 5.0, 40.0); lum = 0.7; }\n' +          // 晕环：固定亮度
    '  if (S.kind == 1u && si == S.sel) { lum = 1.3; }\n' +
    '  var cornerUV = array<vec2<f32>, 3>(vec2<f32>(-1.7320508, -1.0), vec2<f32>(1.7320508, -1.0), vec2<f32>(0.0, 2.0));\n' +
    '  let uv = cornerUV[corner];\n' +
    '  let ndc = vec2<f32>((vx * C.fx / vz) + uv.x * pxc * 2.0 / (C.viewH * C.aspect), (vy * C.fy / vz) + uv.y * pxc * 2.0 / C.viewH);\n' +
    '  o.p = vec4<f32>(ndc, 0.5, 1.0); o.uv = uv; o.col = vec4<f32>(B.xyz, lum); o.kind = S.kind; return o;\n' +
    '}\n' +
    '@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {\n' +
    '  let r2 = dot(i.uv, i.uv); if (r2 > 1.0) { discard; }\n' +
    '  var g = exp(-r2 * 3.5) - exp(-3.5);\n' +
    '  if (i.kind == 1u) { let r = sqrt(r2); g = smoothstep(0.78, 0.86, r) * (1.0 - smoothstep(0.92, 1.0, r)) * 0.9 + exp(-r2 * 30.0) * 0.5; }\n' +
    '  return vec4<f32>(i.col.rgb * i.col.a * g, i.col.a * g);\n' +
    '}\n';
  // 密度体渲染：全屏三角形，沿视线在周期盒里 raymarch（读 δ 网格 storage）
  WGSL.volume = WGSL.camU + WGSL.colorFn +
    'struct VolU { M: u32, steps: u32, clip: u32, pad1: u32, gain: f32, dist: f32, pad2: f32, pad3: f32 };\n' +
    '@group(0) @binding(0) var<uniform> C: CamU;\n' +
    '@group(0) @binding(1) var<uniform> V: VolU;\n' +
    '@group(0) @binding(2) var<storage, read> dens: array<f32>;\n' +
    'struct VOut { @builtin(position) p: vec4<f32>, @location(0) ndc: vec2<f32> };\n' +
    '@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut { var o: VOut; var xy = array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0)); o.p = vec4<f32>(xy[vi], 0.5, 1.0); o.ndc = xy[vi]; return o; }\n' +
    'fn sampleD(p: vec3<f32>) -> f32 {\n' +
    '  let Mf = f32(V.M); let g = fract(p) * Mf; let fl = floor(g); let f = g - fl;\n' +
    '  let i0 = vec3<u32>(fl) % vec3<u32>(V.M); let i1 = (i0 + vec3<u32>(1u)) % vec3<u32>(V.M);\n' +
    '  let M = V.M;\n' +
    '  let d000 = dens[i0.x + M*(i0.y + M*i0.z)]; let d100 = dens[i1.x + M*(i0.y + M*i0.z)]; let d010 = dens[i0.x + M*(i1.y + M*i0.z)]; let d110 = dens[i1.x + M*(i1.y + M*i0.z)];\n' +
    '  let d001 = dens[i0.x + M*(i0.y + M*i1.z)]; let d101 = dens[i1.x + M*(i0.y + M*i1.z)]; let d011 = dens[i0.x + M*(i1.y + M*i1.z)]; let d111 = dens[i1.x + M*(i1.y + M*i1.z)];\n' +
    '  let dx0 = mix(mix(d000, d100, f.x), mix(d010, d110, f.x), f.y); let dx1 = mix(mix(d001, d101, f.x), mix(d011, d111, f.x), f.y);\n' +
    '  return mix(dx0, dx1, f.z);\n' +
    '}\n' +
    '@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {\n' +
    '  let dir = normalize(C.fwd.xyz + C.right.xyz * (i.ndc.x / C.fx) + C.up.xyz * (i.ndc.y / C.fy));\n' +
    '  let n = f32(V.steps); let ds = V.dist / n;\n' +
    '  var acc = vec3<f32>(0.0);\n' +
    '  let jitter = fract(sin(dot(i.p.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453);\n' +
    '  for (var s = 0u; s < V.steps; s++) {\n' +
    '    let tt = (f32(s) + jitter) * ds;\n' +
    '    let p = C.cam.xyz + dir * tt;\n' +
    // V.clip == 1（俯瞰）：只累积落在单位盒内的采样点
    '    if (V.clip == 1u && (any(p < vec3<f32>(0.0)) || any(p > vec3<f32>(1.0)))) { continue; }\n' +
    // dens 存的是 δ；与粒子/WebGL2 体渲染统一为 log2(1+ρ/ρ̄)=log2(1+max(1+δ,0))
    '    let rho = max(1.0 + sampleD(p), 0.0);\n' +
    '    let ld = log2(1.0 + rho);\n' +
    '    var fade = 1.0 - tt / V.dist; if (V.clip == 1u) { fade = 1.0; }\n' +
    '    acc += palette(ld, 0u) * (pow(max(ld - 0.8, 0.0), 1.5) * 0.6) * fade * ds * V.gain;\n' +
    '  }\n' +
    '  return vec4<f32>(acc, 0.0);\n' +
    '}\n';
  // 色调映射：把 rgba16float 的 HDR 累积贴到交换链（全屏三角形，逐像素 textureLoad，不需要采样器）
  WGSL.tonemap = TONE_WGSL +
    '@group(0) @binding(0) var src: texture_2d<f32>;\n' +
    'struct VOut { @builtin(position) p: vec4<f32> };\n' +
    '@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut { var o: VOut; var xy = array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0)); o.p = vec4<f32>(xy[vi], 0.5, 1.0); return o; }\n' +
    '@fragment fn fs(i: VOut) -> @location(0) vec4<f32> { let c = textureLoad(src, vec2<i32>(i.p.xy), 0).rgb; return vec4<f32>(tone3(c), 1.0); }\n';
  // 自动曝光：在 GPU 上对画面中央一块做色调映射后的亮度直方图（WebGPU 没有同步回读，结果异步取回）
  WGSL.histo = TONE_WGSL +
    'struct HistU { x0: u32, y0: u32, n: u32, pad: u32 };\n' +
    '@group(0) @binding(0) var<uniform> H: HistU;\n' +
    '@group(0) @binding(1) var src: texture_2d<f32>;\n' +
    '@group(0) @binding(2) var<storage, read_write> hist: array<atomic<u32>, 256>;\n' +
    '@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  if (gid.x >= H.n || gid.y >= H.n) { return; }\n' +
    '  let c = tone3(textureLoad(src, vec2<i32>(vec2<u32>(H.x0 + gid.x, H.y0 + gid.y)), 0).rgb);\n' +
    '  let m = clamp(max(max(c.x, c.y), c.z), 0.0, 1.0);\n' +
    '  atomicAdd(&hist[u32(m * 255.0 + 0.5)], 1u);\n' +
    '}\n';

  function createWebGPUBackend(canvas, cfg, hooks) {
    // cfg: {N, mesh, cosmo(K.makeCosmo), boxMpc, aIc, dlnaMax, dtMax, pexp(=5−D), softCells(ε/网格间距)}
    var device = cfg.device, ctx = null, format = null;
    var M = cfg.mesh, M3 = M * M * M, N = cfg.N;
    var st = { a: cfg.aIc, ad: 0, t: 0, H: 0, steps: 0 };
    st.ad = st.a * Math.sqrt(Math.max(cfg.cosmo.E2(st.a), 1e-30));
    var B = {};
    function buf(size, usage, label) { return device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage: usage, label: label }); }
    var ST = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC, UN = GPUBufferUsage.UNIFORM;
    B.pos = buf(16 * N, ST | CD | CS, 'pos'); B.vel = buf(16 * N, ST | CD, 'vel');
    B.rho = buf(4 * M3, ST | CD, 'rho'); B.dens = buf(4 * M3, ST | CS, 'dens'); B.fft = buf(8 * M3, ST, 'fft'); B.force = buf(16 * M3, ST, 'force');
    B.simU = buf(32, UN | CD, 'simU'); B.camU = buf(160, UN | CD, 'camU'); B.starU = buf(48, UN | CD, 'starU'); B.haloU = buf(48, UN | CD, 'haloU'); B.volU = buf(32, UN | CD, 'volU');
    B.stars = buf(32 * 4, ST | CD, 'stars'); B.halos = buf(32 * 512, ST | CD, 'halos');
    B.read = buf(4 * M3, GPUBufferUsage.MAP_READ | CD, 'read');
    B.histU = buf(16, UN | CD, 'histU'); B.hist = buf(4 * 256, ST | CS | CD, 'hist'); B.histRead = buf(4 * 256, GPUBufferUsage.MAP_READ | CD, 'histRead');
    device.queue.writeBuffer(B.rho, 0, new Uint32Array(M3));   // 清零计数
    function mod(code, label) { return device.createShaderModule({ code: code, label: label }); }
    function cpipe(code, label) { return device.createComputePipeline({ layout: 'auto', compute: { module: mod(code, label), entryPoint: 'main' }, label: label }); }
    var P = {};
    P.deposit = cpipe(WGSL.deposit, 'deposit'); P.prepare = cpipe(WGSL.prepare, 'prepare'); P.green = cpipe(WGSL.green(cfg.pexp != null ? cfg.pexp : 2, cfg.softCells || 0), 'green');
    P.gradient = cpipe(WGSL.gradient, 'gradient'); P.kick = cpipe(WGSL.kick, 'kick'); P.drift = cpipe(WGSL.drift, 'drift');
    P.fft = [];
    for (var ax = 0; ax < 3; ax++) { P.fft.push([cpipe(WGSL.fft(M, ax, -1), 'fft' + ax + 'f'), cpipe(WGSL.fft(M, ax, +1), 'fft' + ax + 'i')]); }
    function bg(pipe, entries) { return device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: entries.map(function (b, i) { return { binding: i, resource: { buffer: b } }; }) }); }
    var G = {};
    G.deposit = bg(P.deposit, [B.simU, B.pos, B.rho]); G.prepare = bg(P.prepare, [B.simU, B.rho, B.dens, B.fft]); G.green = bg(P.green, [B.simU, B.fft]);
    G.gradient = bg(P.gradient, [B.simU, B.fft, B.force]); G.kick = bg(P.kick, [B.simU, B.pos, B.vel, B.force, B.dens]); G.drift = bg(P.drift, [B.simU, B.pos, B.vel]);
    G.fft = P.fft.map(function (pair) { return [bg(pair[0], [B.fft]), bg(pair[1], [B.fft])]; });
    var simArr = new ArrayBuffer(32), simF = new Float32Array(simArr), simI = new Uint32Array(simArr);
    // invMean = M³/(S·N)：与 deposit 里定点化 S=CIC_FIXED_S 一致（δ = count/S / (N/M³) − 1）
    function writeSim(a, dt, gs, wantDens, vcap) { simF[0] = a; simF[1] = dt; simF[2] = gs; simI[3] = M; simI[4] = N; simF[5] = M3 / (CIC_FIXED_S * N); simI[6] = wantDens ? 1 : 0; simF[7] = vcap || 0; device.queue.writeBuffer(B.simU, 0, simArr); }
    var wgN = Math.ceil(N / 256), wgM = Math.ceil(M3 / 256);
    // D≠3 才建最大力归约管线/缓冲：D=3 时 GPU 资源与提交序列与旧版完全一致
    var dimGrav = (cfg.pexp != null && cfg.pexp !== 2) || cfg.softCells > 0;
    if (dimGrav) {
      B.fmax = buf(4 * wgM, ST | CS, 'fmax'); B.fmaxRead = buf(4 * wgM, GPUBufferUsage.MAP_READ | CD, 'fmaxRead');
      P.fmax = cpipe(WGSL.fmax, 'fmax'); G.fmax = bg(P.fmax, [B.force, B.fmax]);
    }
    function dispatch(pass, pipe, group, x, y) { pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.dispatchWorkgroups(x, y || 1); }
    function pmPass(enc) {
      var pass = enc.beginComputePass();
      dispatch(pass, P.deposit, G.deposit, wgN);
      dispatch(pass, P.prepare, G.prepare, wgM);
      for (var ax = 0; ax < 3; ax++) dispatch(pass, P.fft[ax][0], G.fft[ax][0], M, M);
      dispatch(pass, P.green, G.green, wgM);
      for (ax = 0; ax < 3; ax++) dispatch(pass, P.fft[ax][1], G.fft[ax][1], M, M);
      dispatch(pass, P.gradient, G.gradient, wgM);
      pass.end();
    }
    function submitKick(dt, a, wantDens) { writeSim(a, dt, 1.5 * cfg.cosmo.OmM / a, wantDens); var enc = device.createCommandEncoder(); var pass = enc.beginComputePass(); dispatch(pass, P.kick, G.kick, wgN); pass.end(); device.queue.submit([enc.finish()]); }
    // D>3：限速 |v| ≤ ε·a²/dt（ε = softCells 个网格间距，盒单位）——与 CPU PM 的 drift 同一条规则
    function driftVcap(dt, a) { return (cfg.softCells > 0 && cfg.pexp != null && cfg.pexp < 2 && dt > 0) ? cfg.softCells / M * a * a / dt : 0; }
    function submitDrift(dt, a) { writeSim(a, dt, 0, 0, driftVcap(dt, a)); var enc = device.createCommandEncoder(); var pass = enc.beginComputePass(); dispatch(pass, P.drift, G.drift, wgN); pass.end(); device.queue.submit([enc.finish()]); }
    function submitPM() { var enc = device.createCommandEncoder(); pmPass(enc); device.queue.submit([enc.finish()]); }
    // 上传初始条件后：算一次力 + 密度着色
    var api = {
      kind: 'webgpu', st: st, N: N, mesh: M, buffers: B, device: device,
      upload: function (pos, vel) {
        device.queue.writeBuffer(B.pos, 0, pos); device.queue.writeBuffer(B.vel, 0, vel);
        writeSim(st.a, 0, 0, 0); submitPM(); submitKick(0, st.a, 1);
      },
      reset: function (pos, vel) { st.a = cfg.aIc; st.ad = st.a * Math.sqrt(Math.max(cfg.cosmo.E2(st.a), 1e-30)); st.t = 0; st.steps = 0; api.upload(pos, vel); },
      step: function (dt) {
        // KDK：K(½dt, a_n) D(dt, a_{n+½}) [PM] K(½dt, a_{n+1})
        var a0 = st.a;
        submitKick(dt * 0.5, a0, 0);
        K.advanceBackground(cfg.cosmo, st, dt * 0.5);
        submitDrift(dt, st.a);
        K.advanceBackground(cfg.cosmo, st, dt * 0.5);
        submitPM();
        submitKick(dt * 0.5, st.a, 1);
        st.steps++;
        return st;
      },
      // 异步回读最大力 max(|fx|+|fy|+|fz|)（D≠3 的自适应步长用）；D=3 返回 null（不建管线也不提交）
      maxForce: function () {
        if (!P.fmax) return null;
        if (api._readingF) return api._readingF;
        var enc = device.createCommandEncoder();
        var pass = enc.beginComputePass(); dispatch(pass, P.fmax, G.fmax, wgM); pass.end();
        enc.copyBufferToBuffer(B.fmax, 0, B.fmaxRead, 0, 4 * wgM);
        device.queue.submit([enc.finish()]);
        api._readingF = B.fmaxRead.mapAsync(GPUMapMode.READ).then(function () {
          var arr = new Float32Array(B.fmaxRead.getMappedRange(0, 4 * wgM)), m = 0;
          for (var i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
          B.fmaxRead.unmap(); api._readingF = null; return m;
        }, function (e) { api._readingF = null; throw e; });
        return api._readingF;
      },
      // 异步回读 δ 网格（Float32Array M³）
      readDensity: function () {
        if (api._reading) return api._reading;
        var enc = device.createCommandEncoder(); enc.copyBufferToBuffer(B.dens, 0, B.read, 0, 4 * M3); device.queue.submit([enc.finish()]);
        api._reading = B.read.mapAsync(GPUMapMode.READ).then(function () { var out = new Float32Array(B.read.getMappedRange().slice(0)); B.read.unmap(); api._reading = null; return out; }, function (e) { api._reading = null; throw e; });
        return api._reading;
      },
      // 诊断：分段计时（各段单独提交并等待 GPU 完成）
      profile: function () {
        var q = device.queue, res = {}, names = [], fns = [];
        function part(name, fn) { names.push(name); fns.push(fn); }
        part('deposit', function (p) { dispatch(p, P.deposit, G.deposit, wgN); });
        part('prepare', function (p) { dispatch(p, P.prepare, G.prepare, wgM); });
        part('fft_fwd_x', function (p) { dispatch(p, P.fft[0][0], G.fft[0][0], M, M); });
        part('fft_fwd_y', function (p) { dispatch(p, P.fft[1][0], G.fft[1][0], M, M); });
        part('fft_fwd_z', function (p) { dispatch(p, P.fft[2][0], G.fft[2][0], M, M); });
        part('green', function (p) { dispatch(p, P.green, G.green, wgM); });
        part('fft_inv_xyz', function (p) { for (var ax = 0; ax < 3; ax++) dispatch(p, P.fft[ax][1], G.fft[ax][1], M, M); });
        part('gradient', function (p) { dispatch(p, P.gradient, G.gradient, wgM); });
        part('kick', function (p) { dispatch(p, P.kick, G.kick, wgN); });
        part('drift', function (p) { dispatch(p, P.drift, G.drift, wgN); });
        writeSim(st.a, 0, 0, 1);
        var i = 0;
        function next() {
          if (i >= names.length) return Promise.resolve(res);
          var name = names[i], fn = fns[i]; i++;
          var t0 = performance.now();
          var enc = device.createCommandEncoder(); var pass = enc.beginComputePass(); fn(pass); pass.end(); q.submit([enc.finish()]);
          return q.onSubmittedWorkDone().then(function () { res[name] = +(performance.now() - t0).toFixed(2); return next(); });
        }
        return q.onSubmittedWorkDone().then(next);
      },
      // 释放：buffer 只是其中一半。device 不 destroy 的话，每引爆一次就多留一个活着的 GPUDevice
      // （连同它的全部管线/着色器模块），几轮下来就撞上驱动的设备上限；画布也要 unconfigure，
      // 否则交换链一直挂在那个已经没人用的设备上。
      disposed: false,
      dispose: function () {
        if (api.disposed) return;
        api.disposed = true;
        /* 拆 WebGPU 的顺序很要紧，最高档（200³ ≈ 800 万粒子 / 128³ 网格）下这一步会落在
         * 「按 Enter 进镜像」那一帧里：
         *   ① 自动曝光与 maxForce 的回读是 mapAsync，dispose 时可能**正在飞**。先把两个句柄丢掉，
         *      它们的 .then 就不会再去碰已经 destroy 的 buffer（destroy 一个还挂着 mapAsync 的
         *      buffer 正是会把主线程堵在驱动里的那种操作）。
         *   ② 普通 buffer 先 destroy（纯释放，不等 GPU）。
         *   ③ **device.destroy() 挪到下一个任务**：它要等设备上所有在飞的活儿做完才返回，
         *      把它留在当前帧就等于把 GPU 队列的深度直接算进这一帧的耗时。此时 buffer 已经放掉、
         *      画布已经 unconfigure，设备对谁都没用了，晚一个 task 销毁不改变任何可见行为，
         *      也不会泄漏（这个 task 一定会跑到）。 */
        api._reading = null; api._readingF = null;
        var mappable = [B.read, B.fmaxRead, B.histRead];
        Object.keys(B).forEach(function (k) { if (mappable.indexOf(B[k]) >= 0) return; try { B[k].destroy(); } catch (e) { /* ignore */ } });
        if (ctx) { try { ctx.unconfigure(); } catch (e) { /* ignore */ } ctx = null; }
        var dev = device;
        setTimeout(function () {
          mappable.forEach(function (b) { if (!b) return; try { b.unmap(); } catch (e) { /* 没 map 就不用解 */ } try { b.destroy(); } catch (e) { /* ignore */ } });
          try { dev.destroy(); } catch (e) { /* ignore */ }
        }, 0);
      }
    };
    // ---- 渲染
    /* 这里**故意不碰画布**。HTML 画布的上下文类型是一次性的：canvas.getContext('webgpu') 一旦成功，
     * 这个 <canvas> 就永久锁在 webgpu 模式，之后 getContext('webgl2') 只会返回 null，
     * unconfigure() 也解不开（规范里 unconfigure 只拆交换链，不还原上下文类型）。
     * 而 WebGPU 初始化在 configure 之后还有会失败的步骤（渲染管线创建、初始条件 Worker 报错），
     * 那时再回退 WebGL2 就会拿到 null —— 宣称的回退路径形同虚设。
     * 所以取上下文 + configure 一律推迟到第一次 render()：那时 S.ready 已为真、初始化路径上不会再回退。 */
    format = navigator.gpu.getPreferredCanvasFormat();
    function ensureCtx() {
      if (ctx) return ctx;
      ctx = canvas.getContext('webgpu');
      if (!ctx) throw new Error('canvas.getContext("webgpu") 返回 null');
      canvas.__u3dGpuBound = true;   // 给 initWebGL2 一个明确的失败原因（这块画布已经归 WebGPU 了）
      ctx.configure({ device: device, format: format, alphaMode: 'opaque' });
      return ctx;
    }
    var addBlend = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    /* 场景全部画进一张 rgba16float 离屏纹理（HDR 累积），再由 tonemap 管线过曲线贴到交换链。
     * rgba16float 在 WebGPU 里保证可作为渲染目标且可混合，动态范围到 65504——团块内部累到几百也不削顶。 */
    var HDRFMT = 'rgba16float';
    function rpipe(code, label, fmt, blend) { var m = mod(code, label); return device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: fmt || HDRFMT, blend: blend === null ? undefined : (blend || addBlend) }] }, primitive: { topology: 'triangle-list' }, label: label }); }
    var RP = { points: rpipe(WGSL.points, 'points'), stars: rpipe(WGSL.stars, 'stars'), volume: rpipe(WGSL.volume, 'volume'), tone: rpipe(WGSL.tonemap, 'tonemap', format, null) };
    var RG = { points: bg(RP.points, [B.camU, B.pos, B.vel]), stars: null, halos: bg(RP.stars, [B.camU, B.haloU, B.halos]), volume: bg(RP.volume, [B.camU, B.volU, B.dens]) };
    P.histo = cpipe(WGSL.histo, 'histo');
    var hdrTex = null, hdrView = null, hdrW = 0, hdrH = 0;
    var histU = new Uint32Array(4), histZero = new Uint32Array(256), histBuf = new Uint32Array(256);
    var histState = 0;    // 0 空闲 · 1 已请求（下一帧编码）· 2 在飞（等 mapAsync）
    var histResult = null, histN = 0;
    function ensureHdr(w, h) {
      if (hdrTex && hdrW === w && hdrH === h) return;
      if (hdrTex) { try { hdrTex.destroy(); } catch (e) { /* ignore */ } }
      hdrW = w; hdrH = h;
      hdrTex = device.createTexture({ size: [w, h], format: HDRFMT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'hdr' });
      hdrView = hdrTex.createView();
      RG.tone = device.createBindGroup({ layout: RP.tone.getBindGroupLayout(0), entries: [{ binding: 0, resource: hdrView }] });
      RG.histo = device.createBindGroup({ layout: P.histo.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: B.histU } }, { binding: 1, resource: hdrView }, { binding: 2, resource: { buffer: B.hist } }] });
    }
    var starCap = 0, starCount = 0, haloCount = 0;
    var camArr = new ArrayBuffer(160), camF = new Float32Array(camArr), camI = new Uint32Array(camArr);
    var starArr = new ArrayBuffer(48), starF = new Float32Array(starArr), starI = new Uint32Array(starArr);
    var haloArr = new ArrayBuffer(48), haloF = new Float32Array(haloArr), haloI = new Uint32Array(haloArr);
    var volArr = new ArrayBuffer(32), volF = new Float32Array(volArr), volI = new Uint32Array(volArr);
    api.setStars = function (data, count) {   // Float32Array 8 floats/星
      starCount = count;
      if (!count) return;
      if (count > starCap) { if (B.stars) B.stars.destroy(); B.stars = buf(32 * count, ST | CD, 'stars'); starCap = count; RG.stars = bg(RP.stars, [B.camU, B.starU, B.stars]); }
      device.queue.writeBuffer(B.stars, 0, data, 0, count * 8);
    };
    api.setHalos = function (data, count) { haloCount = Math.min(count, 512); if (haloCount) device.queue.writeBuffer(B.halos, 0, data, 0, haloCount * 8); };
    api.render = function (view) {
      // view: {cam[3], right[3], up[3], fwd[3], fx, fy, aspect, exposure, sizeW, minPx, maxPx, fogR, tiles, colorMode, viewH, time, a,
      //        stars:{center[3], scale, exposure, minPx, maxPx, sel} | null, halosOn, selHalo, volume:{steps, gain, dist}|null}
      if (api.disposed) return;
      ensureCtx();                     // 第一次真正要出画面时才把画布交给 WebGPU（见上面的说明）
      ensureHdr(Math.max(1, canvas.width), Math.max(1, canvas.height));
      var c = view;
      camF.set(c.cam, 0); camF.set(c.right, 4); camF.set(c.up, 8); camF.set(c.fwd, 12);
      camF[16] = c.fx; camF[17] = c.fy; camF[18] = c.aspect; camF[19] = c.exposure; camF[20] = c.sizeW; camF[21] = c.minPx; camF[22] = c.maxPx; camF[23] = c.fogR;
      camI[24] = 0; camI[25] = c.tiles; camI[26] = N; camI[27] = c.colorMode; camF[28] = c.viewH; camF[29] = c.time; camF[30] = c.a; camF[31] = c.nearFade || 0;
      device.queue.writeBuffer(B.camU, 0, camArr);
      var enc = device.createCommandEncoder();
      var pass = enc.beginRenderPass({ colorAttachments: [{ view: hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      if (c.volume) {
        volI[0] = M; volI[1] = c.volume.steps; volI[2] = c.volume.clip ? 1 : 0; volF[4] = c.volume.gain; volF[5] = c.volume.dist;
        device.queue.writeBuffer(B.volU, 0, volArr);
        pass.setPipeline(RP.volume); pass.setBindGroup(0, RG.volume); pass.draw(3);
      }
      if (c.showParticles !== false) { pass.setPipeline(RP.points); pass.setBindGroup(0, RG.points); pass.draw(3 * N * (c.tiles > 1 ? 27 : 1)); }
      if (c.halosOn && haloCount) {
        haloF[0] = c.haloCenter[0]; haloF[1] = c.haloCenter[1]; haloF[2] = c.haloCenter[2]; haloF[3] = 0; haloF[4] = 1; haloF[5] = 6; haloF[6] = 90; haloF[7] = 1; haloI[8] = haloCount; haloI[9] = 1; haloI[10] = c.selHalo >>> 0; haloI[11] = 0;
        device.queue.writeBuffer(B.haloU, 0, haloArr);
        pass.setPipeline(RP.stars); pass.setBindGroup(0, RG.halos); pass.draw(3 * haloCount);
      }
      if (c.stars && starCount && RG.stars) {
        var s = c.stars, nDraw = Math.min(starCount, s.count || starCount);
        starF[0] = s.center[0]; starF[1] = s.center[1]; starF[2] = s.center[2]; starF[3] = 0; starF[4] = s.scale; starF[5] = s.minPx; starF[6] = s.maxPx; starF[7] = s.exposure; starI[8] = nDraw; starI[9] = 0; starI[10] = s.sel >>> 0; starI[11] = 0;
        device.queue.writeBuffer(B.starU, 0, starArr);
        pass.setPipeline(RP.stars); pass.setBindGroup(0, RG.stars); pass.draw(3 * nDraw);
      }
      pass.end();
      // HDR → 显示：逐通道色调映射（团块内部保留灰阶，不再整片削平成纯白）
      var tp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      tp.setPipeline(RP.tone); tp.setBindGroup(0, RG.tone); tp.draw(3);
      tp.end();
      // 自动曝光：本帧被请求过就顺带做一次直方图（画面中央 ≤160×160，色调映射后的显示亮度）
      var wantHist = histState === 1;
      if (wantHist) {
        histN = Math.min(160, hdrW, hdrH);
        histU[0] = Math.max(0, (hdrW - histN) >> 1); histU[1] = Math.max(0, (hdrH - histN) >> 1); histU[2] = histN; histU[3] = 0;
        device.queue.writeBuffer(B.histU, 0, histU);
        device.queue.writeBuffer(B.hist, 0, histZero);
        var hp = enc.beginComputePass();
        dispatch(hp, P.histo, RG.histo, Math.ceil(histN / 16), Math.ceil(histN / 16));
        hp.end();
        enc.copyBufferToBuffer(B.hist, 0, B.histRead, 0, 4 * 256);
        histState = 2;
      }
      device.queue.submit([enc.finish()]);
      if (wantHist) {
        B.histRead.mapAsync(GPUMapMode.READ).then(function () {
          if (api.disposed) { try { B.histRead.unmap(); } catch (e) { /* ignore */ } return; }
          histBuf.set(new Uint32Array(B.histRead.getMappedRange(0, 4 * 256)));
          B.histRead.unmap();
          histResult = { hist: histBuf, px: histN * histN };
          histState = 0;
        }, function () { histState = 0; });
      }
    };
    /* 自动曝光回读（异步）：调用一次 = 取走上一次的结果 + 排下一次。WebGPU 没有同步回读，
     * 拿到的直方图落后 1 帧左右，对 100+ ms 一次的曝光调节完全够用。 */
    api.sampleLuma = function () {
      if (api.disposed || !hdrTex) return null;
      var r = histResult; histResult = null;
      if (histState === 0) histState = 1;
      return r;
    };
    api.resize = function (w, h) { canvas.width = w; canvas.height = h; ensureHdr(Math.max(1, w), Math.max(1, h)); };
    var gpuDisposeInner = api.dispose;
    api.dispose = function () {
      if (api.disposed) return;
      if (hdrTex) { try { hdrTex.destroy(); } catch (e) { /* ignore */ } hdrTex = null; hdrView = null; }
      gpuDisposeInner();
    };
    return api;
  }

  /* ============================================================
   * §4 WebGL2 后端：物理在 Worker（CPU PM），这里只做渲染（点精灵 + 恒星层 + 晕环 + 3D 纹理体渲染）
   * ============================================================ */
  var GLSL = {};
  GLSL.common = '#version 300 es\nprecision highp float; precision highp int;\n' +
    'uniform vec3 u_cam, u_right, u_up, u_fwd; uniform float u_fx, u_fy, u_aspect, u_viewH;\n';
  GLSL.palette =
    'vec3 palette(float ld, int cm){ float t = clamp(ld / 8.0, 0.0, 1.0);\n' +
    '  vec3 c0 = vec3(0.16,0.12,0.42), c1 = vec3(0.32,0.36,0.95), c2 = vec3(0.75,0.86,1.0), c3 = vec3(1.0,0.93,0.78), c4 = vec3(1.0,0.72,0.42); vec3 c;\n' +
    '  if (t < 0.25) c = mix(c0, c1, t/0.25); else if (t < 0.5) c = mix(c1, c2, (t-0.25)/0.25); else if (t < 0.75) c = mix(c2, c3, (t-0.5)/0.25); else c = mix(c3, c4, (t-0.75)/0.25);\n' +
    '  if (cm == 1) c = mix(vec3(0.2,0.5,1.0), vec3(1.0,0.35,0.15), t); return c; }\n';
  GLSL.pointsVS = GLSL.common + GLSL.palette +
    'in vec3 a_pos; in float a_dens;\n' +
    'uniform float u_exposure, u_sizeW, u_minPx, u_maxPx, u_fogR, u_near; uniform int u_tiles, u_colorMode;\n' +
    'out vec4 v_col;\n' +
    'void main(){\n' +
    '  vec3 off = vec3(0.0);\n' +
    '  if (u_tiles > 1) { int t = gl_InstanceID; off = vec3(float(t % 3) - 1.0, float((t / 3) % 3) - 1.0, float(t / 9) - 1.0); }\n' +
    // u_tiles == 0：俯瞰模式——相机在盒外，粒子按绝对坐标画（不做最近像包裹，否则永远看不到盒子的"外面"）
    '  vec3 w = a_pos; if (u_tiles != 0) { w += floor(u_cam - w + 0.5) + off; }\n' +
    '  vec3 rel = w - u_cam; float cheb = max(max(abs(rel.x), abs(rel.y)), abs(rel.z));\n' +
    '  float fog = 1.0 - smoothstep(u_fogR * 0.6, u_fogR, cheb);\n' +
    '  float vz = dot(rel, u_fwd);\n' +
    '  if (vz <= 1e-9 || fog <= 0.001) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; v_col = vec4(0.0); return; }\n' +
    '  float vx = dot(rel, u_right), vy = dot(rel, u_up);\n' +
    '  float px = u_sizeW * u_fy * u_viewH * 0.5 / vz; float pxc = clamp(px, u_minPx, u_maxPx);\n' +
    '  float ld = a_dens * 16.0;\n' +   // u8 归一化 → log2(1+δ)
    '  float lum = u_exposure * fog * (u_minPx * u_minPx) / (pxc * pxc);\n' +
    '  if (px < u_minPx) lum *= (px * px) / (u_minPx * u_minPx);\n' +
    '  if (u_near > 0.0) { float qn = clamp(vz / u_near, 0.0, 1.0); lum *= qn * qn; }\n' +
    '  vec3 c = palette(ld, u_colorMode);\n' +
    '  gl_Position = vec4(vx * u_fx / vz, vy * u_fy / vz, 0.5, 1.0); gl_PointSize = pxc * 2.0; v_col = vec4(c, lum);\n' +
    '}\n';
  GLSL.pointsFS = '#version 300 es\nprecision mediump float;\nin vec4 v_col; out vec4 o;\n' +
    'void main(){ vec2 q = (gl_PointCoord - 0.5) * 2.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float g = exp(-r2 * 3.0) - exp(-3.0); o = vec4(v_col.rgb * v_col.a * g, v_col.a * g); }\n';
  GLSL.starsVS = GLSL.common +
    'in vec4 a_ps; in vec4 a_col;\n' +   // xyz 相对中心（星系单位）, w=size；rgb, w=lum
    'uniform vec3 u_center; uniform float u_scale, u_minPx, u_maxPx, u_exposure; uniform int u_kind, u_sel;\n' +
    'out vec4 v_col; out float v_kind;\n' +
    'void main(){\n' +
    '  vec3 rel = u_center + a_ps.xyz * u_scale; float vz = dot(rel, u_fwd);\n' +
    '  if (vz <= 1e-12) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; v_col = vec4(0.0); v_kind = 0.0; return; }\n' +
    '  float vx = dot(rel, u_right), vy = dot(rel, u_up);\n' +
    '  float px = a_ps.w * u_scale * u_fy * u_viewH * 0.5 / vz; float pxc = clamp(px, u_minPx, u_maxPx);\n' +
    '  float lum = u_exposure * a_col.w * (u_minPx * u_minPx) / (pxc * pxc);\n' +
    '  if (px < u_minPx) lum *= max(px * px / (u_minPx * u_minPx), 1e-5);\n' +
    '  if (u_kind == 1) { pxc = clamp(px, 5.0, 40.0); lum = 0.7; }\n' +
    '  gl_Position = vec4(vx * u_fx / vz, vy * u_fy / vz, 0.5, 1.0); gl_PointSize = pxc * 2.0; v_col = vec4(a_col.rgb, lum); v_kind = float(u_kind);\n' +
    '}\n';
  GLSL.starsFS = '#version 300 es\nprecision mediump float;\nin vec4 v_col; in float v_kind; out vec4 o;\n' +
    'void main(){ vec2 q = (gl_PointCoord - 0.5) * 2.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float g = exp(-r2 * 3.5) - exp(-3.5);\n' +
    '  if (v_kind > 0.5) { float r = sqrt(r2); g = smoothstep(0.78, 0.86, r) * (1.0 - smoothstep(0.92, 1.0, r)) * 0.9 + exp(-r2 * 30.0) * 0.5; }\n' +
    '  o = vec4(v_col.rgb * v_col.a * g, v_col.a * g); }\n';
  GLSL.volVS = '#version 300 es\nout vec2 v_ndc; void main(){ vec2 xy = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); v_ndc = xy; gl_Position = vec4(xy, 0.5, 1.0); }\n';
  // 色调映射：把 RGBA16F 的 HDR 累积贴回默认帧缓冲（全屏三角形 + texelFetch，1:1 像素，不需要过滤）
  GLSL.toneVS = '#version 300 es\nvoid main(){ vec2 xy = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(xy, 0.5, 1.0); }\n';
  GLSL.toneFS = '#version 300 es\nprecision highp float;\n' + TONE_GLSL +
    'uniform sampler2D u_hdr; out vec4 o;\n' +
    'void main(){ o = vec4(tone3(texelFetch(u_hdr, ivec2(gl_FragCoord.xy), 0).rgb), 1.0); }\n';
  GLSL.volFS = '#version 300 es\nprecision highp float; precision highp sampler3D;\n' + GLSL.palette +
    'uniform vec3 u_cam, u_right, u_up, u_fwd; uniform float u_fx, u_fy, u_gain, u_dist; uniform int u_steps, u_clip; uniform sampler3D u_tex; in vec2 v_ndc; out vec4 o;\n' +
    'void main(){ vec3 dir = normalize(u_fwd + u_right * (v_ndc.x / u_fx) + u_up * (v_ndc.y / u_fy)); float n = float(u_steps), ds = u_dist / n; vec3 acc = vec3(0.0);\n' +
    '  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);\n' +
    '  for (int s = 0; s < 256; s++) { if (s >= u_steps) break; float tt = (float(s) + jitter) * ds; vec3 p = u_cam + dir * tt;\n' +
    // u_clip == 1（俯瞰）：只累积落在单位盒内的采样点，盒外不画——否则周期性 fract 会把盒子的"复制品"糊到盒外
    '    if (u_clip == 1 && (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0))))) continue;\n' +
    '    float ld = texture(u_tex, fract(p)).r * 16.0; float fade = u_clip == 1 ? 1.0 : (1.0 - tt / u_dist); acc += palette(ld, 0) * (pow(max(ld - 0.8, 0.0), 1.5) * 0.6) * fade * ds * u_gain; }\n' +
    '  o = vec4(acc, 0.0); }\n';

  // createWebGL2Backend 失败时把原因记在这里：只返回 null 的话，调用方分不清是"取不到上下文"
  // 还是"上下文已丢失/着色器编译不过"，报给用户的错误就永远是那句没用的"WebGL2 不可用"。
  var gl2FailReason = '';
  function createWebGL2Backend(canvas, cfg) {
    var gl = null;
    gl2FailReason = '';
    try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; gl2FailReason = 'getContext 抛错：' + (e && e.message || e); }
    if (!gl) { if (!gl2FailReason) gl2FailReason = 'getContext("webgl2") 返回 null' + (canvas.__u3dGpuBound ? '：这块 <canvas> 已经被 WebGPU 占用，画布的上下文类型不可逆' : ''); return null; }
    if (gl.isContextLost && gl.isContextLost()) { gl2FailReason = '取到的 WebGL2 上下文已丢失（context lost）'; return null; }
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[universe3d/gl] shader:', gl.getShaderInfoLog(s)); return null; } return s; }
    // 链完就 deleteShader：着色器对象只是被标记删除，真正释放跟着 deleteProgram 走；
    // 不删的话每建一次后端就多留 6 个着色器对象，dispose 也回收不掉。
    function prog(vs, fs) { var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs); if (!v || !f) { if (v) gl.deleteShader(v); if (f) gl.deleteShader(f); return null; } var p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[universe3d/gl] link:', gl.getProgramInfoLog(p)); gl.deleteProgram(p); return null; } return p; }
    var pPts = prog(GLSL.pointsVS, GLSL.pointsFS), pStars = prog(GLSL.starsVS, GLSL.starsFS), pVol = prog(GLSL.volVS, GLSL.volFS);
    if (!pPts || !pStars || !pVol) { gl2FailReason = '着色器/程序创建失败（' + [!pPts && 'points', !pStars && 'stars', !pVol && 'volume'].filter(Boolean).join('、') + '）'; return null; }
    /* HDR 离屏累积：加性混合直接进 8 位帧缓冲时，超过 1.0 的部分当场被削平（团块整片纯白），
     * 而且单个粒子贡献 < 1/510 会被舍入成 0（暗处的细纹整段丢失）。改成先累进 RGBA16F 再过色调映射曲线。
     * 需要 EXT_color_buffer_float（或 half 变体）：拿不到就退回旧的直画路径，画面与旧版一致（只是仍会削顶）。 */
    var cbFloat = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    var pTone = cbFloat ? prog(GLSL.toneVS, GLSL.toneFS) : null;
    var LT = pTone ? locs(pTone, ['u_hdr']) : null;
    var hdrFbo = null, hdrTex = null, hdrOK = !!pTone;
    function locs(p, names) { var o = {}; names.forEach(function (n) { o[n] = gl.getUniformLocation(p, n); }); return o; }
    var CAMU = ['u_cam', 'u_right', 'u_up', 'u_fwd', 'u_fx', 'u_fy', 'u_aspect', 'u_viewH'];
    var LP = locs(pPts, CAMU.concat(['u_exposure', 'u_sizeW', 'u_minPx', 'u_maxPx', 'u_fogR', 'u_near', 'u_tiles', 'u_colorMode']));
    var LS = locs(pStars, CAMU.concat(['u_center', 'u_scale', 'u_minPx', 'u_maxPx', 'u_exposure', 'u_kind', 'u_sel']));
    var LV = locs(pVol, ['u_cam', 'u_right', 'u_up', 'u_fwd', 'u_fx', 'u_fy', 'u_gain', 'u_dist', 'u_steps', 'u_clip', 'u_tex']);
    // 粒子 VAO
    var vaoP = gl.createVertexArray(); gl.bindVertexArray(vaoP);
    var bPos = gl.createBuffer(), bDens = gl.createBuffer(), capN = 0, N = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bDens); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindVertexArray(null);
    // 恒星层 / 晕 VAO（交错 8 float）
    function makeStarVAO() { var vao = gl.createVertexArray(); gl.bindVertexArray(vao); var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.bindVertexArray(null); return { vao: vao, buf: b, cap: 0, n: 0 }; }
    var stars = makeStarVAO(), halos = makeStarVAO();
    var vaoV = gl.createVertexArray();
    var tex3 = gl.createTexture(), texM = 0;
    gl.bindTexture(gl.TEXTURE_3D, tex3);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    var W = 1, H = 1, lumaBuf = null, lumaHist = new Uint32Array(256);
    /* 自动曝光的回读：同步 readPixels 会把主线程堵在这里，直到 GPU 把已经排队的活全部画完——
     * 实测 512,000 粒子这一档单次 17～19 ms，占掉了 frame() 98% 的耗时（GPU 另有负载时更久）。
     * 改成 PBO + fenceSync 异步回读：第 N 帧发起（发起本身不等待），之后每帧用 clientWaitSync(timeout=0)
     * 轮询，signaled 了再 getBufferSubData 取回。读到的是**同一批像素**（发起那一刻的画面），
     * 只是晚一两帧拿到；曝光本来就是 450 ms 一次的反馈环，直方图统计与增益公式逐字未动，
     * 收敛到的画面亮度一致。拿不到 PBO/fence 时（理论上 WebGL2 必有）退回原来的同步路径。 */
    var lumaPbo = null, lumaSync = null, lumaPendN = 0, lumaAsyncOK = (typeof gl.fenceSync === 'function' && typeof gl.getBufferSubData === 'function');
    // 直方图统计：与改动前 sampleLuma 里那段逐字相同（max(r,g,b) 分桶），同步/异步两条路共用。
    function lumaHistOf(cnt) {
      var hist = lumaHist, i;
      for (i = 0; i < 256; i++) hist[i] = 0;
      for (i = 0; i < cnt; i++) {
        var o = 4 * i, r = lumaBuf[o], g2 = lumaBuf[o + 1], b = lumaBuf[o + 2];
        hist[r > g2 ? (r > b ? r : b) : (g2 > b ? g2 : b)]++;
      }
      return { hist: hist, px: cnt };
    }
    // HDR 目标：尺寸变了就重建；不完整（驱动不支持 RGBA16F 作为颜色附件）就永久关掉，退回直画
    function ensureHdr(w, h) {
      if (!hdrOK) return false;
      if (hdrTex && hdrFbo && hdrTex.__w === w && hdrTex.__h === h) return true;
      if (!hdrTex) {
        hdrTex = gl.createTexture(); hdrFbo = gl.createFramebuffer();
        gl.bindTexture(gl.TEXTURE_2D, hdrTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } else gl.bindTexture(gl.TEXTURE_2D, hdrTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      hdrTex.__w = w; hdrTex.__h = h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, hdrFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hdrTex, 0);
      var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
      if (!ok) {
        console.warn('[universe3d/gl] RGBA16F 帧缓冲不完整，退回 8 位直画（高密度区仍会削顶）');
        gl.deleteFramebuffer(hdrFbo); gl.deleteTexture(hdrTex); hdrFbo = null; hdrTex = null; hdrOK = false;
      }
      return hdrOK;
    }
    function setCam(L, c) { gl.uniform3fv(L.u_cam, c.cam); gl.uniform3fv(L.u_right, c.right); gl.uniform3fv(L.u_up, c.up); gl.uniform3fv(L.u_fwd, c.fwd); gl.uniform1f(L.u_fx, c.fx); gl.uniform1f(L.u_fy, c.fy); if (L.u_aspect) gl.uniform1f(L.u_aspect, c.aspect); if (L.u_viewH) gl.uniform1f(L.u_viewH, c.viewH); }
    function uploadStarLike(S, data, count) {
      S.n = count; if (!count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, S.buf);
      if (count > S.cap) { gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 8), gl.DYNAMIC_DRAW); S.cap = count; }
      else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 8);
    }
    var api = {
      kind: 'webgl2', gl: gl, N: 0,
      uploadState: function (pos, dens, n) {
        N = n; api.N = n;
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
        if (n > capN) gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW); else gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos, 0, 3 * n);
        gl.bindBuffer(gl.ARRAY_BUFFER, bDens);
        if (n > capN) { gl.bufferData(gl.ARRAY_BUFFER, dens, gl.DYNAMIC_DRAW); capN = n; } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, dens, 0, n);
      },
      uploadGrid: function (grid8, M) {
        gl.bindTexture(gl.TEXTURE_3D, tex3);
        if (M !== texM) { gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, M, M, M, 0, gl.RED, gl.UNSIGNED_BYTE, grid8); texM = M; }
        else gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, M, M, M, gl.RED, gl.UNSIGNED_BYTE, grid8);
      },
      setStars: function (data, count) { uploadStarLike(stars, data, count); },
      setHalos: function (data, count) { uploadStarLike(halos, data, count); },
      resize: function (w, h) { W = w; H = h; canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); ensureHdr(w, h); },
      render: function (c) {
        if (api.disposed) return;
        var hdr = ensureHdr(W, H);
        if (hdr) gl.bindFramebuffer(gl.FRAMEBUFFER, hdrFbo);
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        if (c.volume && texM) {
          gl.useProgram(pVol); setCam(LV, c); gl.uniform1f(LV.u_gain, c.volume.gain); gl.uniform1f(LV.u_dist, c.volume.dist); gl.uniform1i(LV.u_steps, Math.min(256, c.volume.steps)); gl.uniform1i(LV.u_clip, c.volume.clip ? 1 : 0);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex3); gl.uniform1i(LV.u_tex, 0);
          gl.bindVertexArray(vaoV); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
        }
        if (N && c.showParticles !== false) {
          gl.useProgram(pPts); setCam(LP, c);
          gl.uniform1f(LP.u_exposure, c.exposure); gl.uniform1f(LP.u_sizeW, c.sizeW); gl.uniform1f(LP.u_minPx, c.minPx); gl.uniform1f(LP.u_maxPx, c.maxPx); gl.uniform1f(LP.u_fogR, c.fogR); gl.uniform1f(LP.u_near, c.nearFade || 0);
          gl.uniform1i(LP.u_tiles, c.tiles); gl.uniform1i(LP.u_colorMode, c.colorMode);
          gl.bindVertexArray(vaoP);
          if (c.tiles > 1) gl.drawArraysInstanced(gl.POINTS, 0, N, 27); else gl.drawArrays(gl.POINTS, 0, N);
          gl.bindVertexArray(null);
        }
        if (c.halosOn && halos.n) {
          gl.useProgram(pStars); setCam(LS, c);
          gl.uniform3f(LS.u_center, 0, 0, 0); gl.uniform1f(LS.u_scale, 1); gl.uniform1f(LS.u_minPx, 6); gl.uniform1f(LS.u_maxPx, 90); gl.uniform1f(LS.u_exposure, 1); gl.uniform1i(LS.u_kind, 1); gl.uniform1i(LS.u_sel, c.selHalo);
          gl.bindVertexArray(halos.vao); gl.drawArrays(gl.POINTS, 0, halos.n); gl.bindVertexArray(null);
        }
        if (c.stars && stars.n) {
          var s = c.stars, nDraw = Math.min(stars.n, s.count || stars.n);
          gl.useProgram(pStars); setCam(LS, c);
          gl.uniform3fv(LS.u_center, s.center); gl.uniform1f(LS.u_scale, s.scale); gl.uniform1f(LS.u_minPx, s.minPx); gl.uniform1f(LS.u_maxPx, s.maxPx); gl.uniform1f(LS.u_exposure, s.exposure); gl.uniform1i(LS.u_kind, 0); gl.uniform1i(LS.u_sel, s.sel);
          gl.bindVertexArray(stars.vao); gl.drawArrays(gl.POINTS, 0, nDraw); gl.bindVertexArray(null);
        }
        // HDR → 显示：逐通道色调映射（团块内部保留灰阶，不再整片削平成纯白）
        if (hdr) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, W, H);
          gl.disable(gl.BLEND);
          gl.useProgram(pTone);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hdrTex); gl.uniform1i(LT.u_hdr, 0);
          gl.bindVertexArray(vaoV); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);
          gl.enable(gl.BLEND);
        }
      },
      // 自动曝光用：回读画面中央一小块（色调映射之后的显示值 max(r,g,b)），返回 256 桶亮度直方图。
      // 只读 ≤160×160 个像素（~100 KB），频率由调用方节流；统计量由 histStats() 统一算（两个后端同一口径）。
      sampleLuma: function () {
        var n = Math.min(160, W, H); if (n < 8) return null;
        var x0 = Math.max(0, (W - n) >> 1), y0 = Math.max(0, (H - n) >> 1);
        if (!lumaBuf || lumaBuf.length < n * n * 4) lumaBuf = new Uint8Array(n * n * 4);
        if (!lumaAsyncOK) {                                  // 退化路径：与改动前逐字相同的同步回读
          try { gl.readPixels(x0, y0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, lumaBuf); } catch (e) { return null; }
          return lumaHistOf(n * n);
        }
        // ① 先看上一次发起的回读好了没：只做一次「零超时」查询，没好就回 null（调用方按 raw==null 跳过，不改增益）
        var out = null;
        if (lumaSync) {
          var st;
          try { st = gl.clientWaitSync(lumaSync, 0, 0); } catch (e) { st = gl.WAIT_FAILED; }
          if (st === gl.TIMEOUT_EXPIRED) return null;         // GPU 还没画完：这一次不取，绝不阻塞
          try { gl.deleteSync(lumaSync); } catch (e) { /* ignore */ }
          lumaSync = null;
          var got = lumaPendN; lumaPendN = 0;
          if ((st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) && got) {
            try {
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, lumaPbo);
              gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, lumaBuf, 0, got * got * 4);
              gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
              out = lumaHistOf(got * got);
            } catch (e) { try { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); } catch (e2) { /* ignore */ } }
          }
        }
        // ② 紧接着把下一次发起掉（readPixels 的目标是 PBO，命令入队即返回，不等 GPU）。
        //    「取上一次 + 发起下一次」写在同一次调用里，调增益的节奏才与同步版一样是 450 ms 一次。
        try {
          if (!lumaPbo) lumaPbo = gl.createBuffer();
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, lumaPbo);
          if (lumaPbo.__n !== n) { gl.bufferData(gl.PIXEL_PACK_BUFFER, n * n * 4, gl.STREAM_READ); lumaPbo.__n = n; }
          gl.readPixels(x0, y0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, 0);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          lumaSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();                                        // 保证 fence 会被 GPU 走到，否则永远等不到 signaled
          if (!lumaSync) { lumaAsyncOK = false; lumaPendN = 0; } else lumaPendN = n;
        } catch (e) {
          try { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); } catch (e2) { /* ignore */ }
          lumaAsyncOK = false; lumaPendN = 0; lumaSync = null;   // 这块驱动不认异步回读：以后走同步路径
        }
        return out;                                          // 第一次调用必然是 null（只发起），之后每次都有值
      },
      /* 全量释放。原来只删了 2 个 buffer / 3 个 program / 1 个纹理，漏掉 4 个 VAO、恒星/晕的 2 个顶点
       * buffer 和 6 个着色器对象——这些才是每进出一次镜像就实打实累加的东西（画布是宿主的、一直复用，
       * 每次 create() 都在同一个上下文上再建一整套）。
       * 这里**故意不调 WEBGL_lose_context.loseContext()**：宿主（app.js 的 #gl3d）是同一个 <canvas>
       * 反复用的，实测把上下文弄丢之后再 getContext('webgl2') 拿回的仍是那个"已丢失"的上下文，
       * createShader/createProgram 全部返回 null，下一次引爆直接建不出后端（Error: WebGL2 不可用）。
       * 而复用同一块画布时 getContext 返回的本来就是同一个上下文，根本不会累积上下文数量——
       * 要收的只是上面这些 GL 对象。 */
      disposed: false,
      dispose: function () {
        if (api.disposed) return;
        api.disposed = true;
        try {
          gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null); gl.bindTexture(gl.TEXTURE_3D, null); gl.useProgram(null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
          if (hdrFbo) { gl.deleteFramebuffer(hdrFbo); hdrFbo = null; }
          if (hdrTex) { gl.deleteTexture(hdrTex); hdrTex = null; }
          if (pTone) { gl.deleteProgram(pTone); pTone = null; }
          gl.deleteBuffer(bPos); gl.deleteBuffer(bDens);
          gl.deleteVertexArray(vaoP); gl.deleteVertexArray(vaoV);
          [stars, halos].forEach(function (S2) { if (!S2) return; if (S2.vao) gl.deleteVertexArray(S2.vao); if (S2.buf) gl.deleteBuffer(S2.buf); S2.vao = null; S2.buf = null; S2.cap = 0; S2.n = 0; });
          gl.deleteProgram(pPts); gl.deleteProgram(pStars); gl.deleteProgram(pVol);
          gl.deleteTexture(tex3);
          // 自动曝光的异步回读：在飞的 fence 与 PBO 也要收（不收就是每次引爆多留一个 sync 对象 + 100 KB 显存）
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          if (lumaSync) { gl.deleteSync(lumaSync); lumaSync = null; }
          if (lumaPbo) { gl.deleteBuffer(lumaPbo); lumaPbo = null; }
          lumaPendN = 0;
        } catch (e) { /* ignore */ }
        lumaBuf = null;
      }
    };
    return api;
  }

  /* ============================================================
   * §5 过程生成星系（LOD 2，标"示意"）：由晕质量 + 自旋种子决定旋涡/椭圆；恒星点云（色温 → 颜色）
   *    数据格式：Float32Array 8/星 [x,y,z (kpc, 相对星系中心), size(kpc), r,g,b, lum]；meta：kind(0 恒星 1 星云 2 球状星团 3 数据层天体) / temp
   * ============================================================ */
  function bbColor(T) {   // 黑体色温近似（Tanner Helland 拟合），返回 [r,g,b] 0..1
    var t = T / 100, r, g, b;
    if (t <= 66) { r = 255; g = 99.4708 * Math.log(t) - 161.1196; b = t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448; }
    else { r = 329.6987 * Math.pow(t - 60, -0.1332); g = 288.1222 * Math.pow(t - 60, -0.0755); b = 255; }
    return [clamp(r / 255, 0, 1), clamp(g / 255, 0, 1), clamp(b / 255, 0, 1)];
  }
  function spectralClass(T) { return T >= 30000 ? 'O' : T >= 10000 ? 'B' : T >= 7500 ? 'A' : T >= 6000 ? 'F' : T >= 5200 ? 'G' : T >= 3700 ? 'K' : 'M'; }
  /* ---------- 形态 / 恒星质量 / 中央黑洞（比例与标度关系都给出处；点云本身仍是"示意"） ----------
   * 恒星质量–晕质量：Moster et al. 2013, MNRAS 428, 3121（z=0 参数）
   *   m★/M = 2N[(M/M₁)^{−β} + (M/M₁)^{γ}]^{−1}，N=0.0351，log M₁=11.59，β=1.376，γ=0.608
   * 形态–密度关系：Dressler 1980, ApJ 236, 351（高密度区 E/S0 占比升、旋涡降）
   * 棒旋比例：Eskridge et al. 2000 / Masters et al. 2011（近红外看 ~2/3 有棒）
   * 矮星系数量最多：Local Group 的成员计数即以矮椭球/矮不规则为主（McConnachie 2012）
   * 低表面亮度：Impey & Bothun 1997, ARA&A 35, 267
   * M_BH–M_bulge：Kormendy & Ho 2013, ARA&A 51, 511（M_BH ≈ 0.49×10⁹ (M_bulge/10¹¹)^{1.16}）
   * AGN 占比随质量升（~1–10%）：Kauffmann et al. 2003, MNRAS 346, 1055
   * 团内热气体（X 射线）：Sarazin 1986, Rev. Mod. Phys. 58, 1；cD 星系：Matthews et al. 1964 */
  var GAL_REF = {
    smhm: 'Moster et al. 2013, MNRAS 428, 3121',
    morph: 'Dressler 1980, ApJ 236, 351（形态–密度关系）',
    bar: 'Eskridge et al. 2000, AJ 119, 536；Masters et al. 2011, MNRAS 411, 2026',
    dwarf: 'McConnachie 2012, AJ 144, 4（矮星系数量占绝对多数）',
    lsb: 'Impey & Bothun 1997, ARA&A 35, 267',
    bh: 'Kormendy & Ho 2013, ARA&A 51, 511',
    agn: 'Kauffmann et al. 2003, MNRAS 346, 1055',
    icm: 'Sarazin 1986, Rev. Mod. Phys. 58, 1（团内介质 X 射线）',
    cd: 'Matthews, Morgan & Schmidt 1964, ApJ 140, 35（cD 星系）',
    gc: 'Harris 1996, AJ 112, 1487（银河系 ~150 个球状星团）'
  };
  function smhmMoster13(mHalo) {   // 晕质量 → 恒星质量（M⊙）
    var N = 0.0351, M1 = Math.pow(10, 11.59), b = 1.376, g = 0.608, x = mHalo / M1;
    return mHalo * 2 * N / (Math.pow(x, -b) + Math.pow(x, g));
  }
  function mBHFromBulge(mBulge) {  // Kormendy & Ho 2013
    return 0.49e9 * Math.pow(Math.max(mBulge, 1e6) / 1e11, 1.16);
  }
  // 形态：按恒星质量 + 环境密度（env 0=空旷 … 1=团核心）。返回类型、亚型与该型的判据出处。
  function pickMorphology(rnd, mHalo, mStar, env) {
    env = clamp(env == null ? 0.25 : env, 0, 1);
    if (mHalo >= 1e14) return { type: 'cluster', sub: 'cD', typeName: '星系团（含 cD 星系与热气体晕）', ref: GAL_REF.icm };
    if (mStar < 1e9) {   // 矮星系：数量上占绝对多数；密集环境更多矮椭球，空旷处更多矮不规则
        var dsph = rnd() < (0.25 + 0.6 * env);
        return dsph ? { type: 'dwarf', sub: 'dSph', typeName: '矮椭球星系', ref: GAL_REF.dwarf }
          : { type: 'dwarf', sub: 'dIrr', typeName: '矮不规则星系', ref: GAL_REF.dwarf };
    }
    // Dressler 1980：密度越高，E/S0 越多、旋涡越少
    var fE = clamp(0.10 + 0.45 * env + 0.35 * clamp((Math.log10(mStar) - 10.6) / 1.4, 0, 1), 0, 0.85);
    var fS0 = clamp(0.12 + 0.28 * env, 0, 0.4);
    var u = rnd();
    if (u < fE) {
      var e = Math.min(7, Math.floor(rnd() * rnd() * 8));   // E0–E7，偏圆的更多
      return { type: 'elliptical', sub: 'E' + e, typeName: '椭圆星系 E' + e, ellip: e / 10, ref: GAL_REF.morph };
    }
    if (u < fE + fS0) return { type: 's0', sub: 'S0', typeName: '透镜星系 S0', ref: GAL_REF.morph };
    if (mStar < 3e9 && rnd() < 0.35) return { type: 'irregular', sub: 'Irr', typeName: '不规则星系', ref: GAL_REF.morph };
    if (rnd() < 0.12 && env < 0.4) return { type: 'spiral', sub: 'LSB', typeName: '低表面亮度盘星系', lsb: true, bar: false, ref: GAL_REF.lsb };
    var bar = rnd() < 0.66;                                  // 约 2/3 有棒
    var late = clamp(0.75 - 0.5 * clamp((Math.log10(mStar) - 10) / 1.5, 0, 1), 0.15, 0.85);
    var sub = rnd() < late ? (rnd() < 0.5 ? 'Sc' : 'Sd') : (rnd() < 0.5 ? 'Sa' : 'Sb');
    return { type: 'spiral', sub: (bar ? 'S' + 'B' + sub.slice(1) : sub), typeName: (bar ? '棒旋星系 SB' + sub.slice(1) : '旋涡星系 ' + sub), bar: bar, ref: GAL_REF.bar };
  }
  function generateGalaxy(seed, halo, opts) {
    opts = opts || {};
    var rnd = K.mulberry32(seed >>> 0), i;
    // mass 必须有限正：晕表/合成晕偶发 NaN（例如旧版 CIC 定点溢出）时 Math.max(1e10,NaN)=NaN → log10/形态全链崩溃
    var mass = Math.max(1e10, (halo && isFinite(halo.mass) && halo.mass > 0) ? halo.mass : 1e12);           // M⊙/h（晕）
    var lm = Math.log10(mass);
    var spin = rnd();                                       // 自旋参数代理
    // 恒星质量（Moster 2013 标度）；opts.mStar / opts.RdKpc 由调用方给出观测值时优先（数据层的银河系：BHG 2016）
    var mStar = opts.mStar > 0 ? opts.mStar : smhmMoster13(mass);
    var morph = opts.morph || pickMorphology(rnd, mass, mStar, opts.env);
    if (opts.type) morph = { type: opts.type, sub: opts.type === 'spiral' ? 'Sb' : 'E3', typeName: opts.type === 'spiral' ? '旋涡星系' : '椭圆星系', bar: rnd() < 0.66, ref: GAL_REF.morph };
    var type = morph.type === 'cluster' ? 'elliptical' : morph.type === 'dwarf' ? (morph.sub === 'dIrr' ? 'irregular' : 'elliptical') : morph.type;
    var isDisk = type === 'spiral' || type === 's0';
    if (type === 's0' || type === 'irregular') type = type === 's0' ? 'spiral' : 'irregular';
    var nStars = opts.nStars || 150000;
    if (!isDisk) nStars = Math.round(nStars * 0.75);
    if (morph.type === 'dwarf') nStars = Math.round(nStars * 0.25);
    // 中央黑洞与 AGN：M_BH 由核球质量（Kormendy & Ho 2013），AGN 占比随质量升（Kauffmann 2003）
    var fBulgeMass = morph.type === 'elliptical' || morph.type === 'cluster' ? 0.9 : morph.type === 's0' ? 0.5 : morph.type === 'dwarf' ? 0.05 : 0.2;
    var mBH = mBHFromBulge(mStar * fBulgeMass);
    // AGN 占比：随恒星质量升（Kauffmann 2003）；团中心的 cD/BCG 常见射电 AGN（Best et al. 2007, MNRAS 379, 894）
    var pAGN = morph.type === 'cluster' ? 0.35 : morph.type === 'dwarf' ? 0.005 : clamp(0.01 + 0.09 * clamp((Math.log10(mStar) - 9.5) / 2, 0, 1), 0.005, 0.1);
    var agn = rnd() < pAGN, quasar = agn && mBH > 1e8 && rnd() < 0.25;
    var Rd = type === 'spiral' ? (opts.RdKpc > 0 ? opts.RdKpc : 2.5 * Math.pow(mStar / 4e10, 0.33)) * (morph.lsb ? 1.8 : 1) : 0;   // 盘标长 kpc
    var Re = type === 'elliptical' ? 4.5 * Math.pow(mStar / 6e10, 0.55) * (morph.type === 'cluster' ? 3 : 1) : Rd * 0.5;   // 有效半径 kpc
    if (morph.type === 'dwarf') Re = Math.max(Re, 0.6);
    if (type === 'irregular') Rd = Math.max(Rd, 1.2 * Math.pow(mStar / 1e9, 0.3));
    var arms = 2 + Math.floor(rnd() * 3), pitch = (12 + rnd() * 16) * Math.PI / 180, bar = !!morph.bar;
    var extent = (type === 'spiral' || type === 'irregular') ? Math.max(Rd, 0.5) * 5.5 : Re * 6;
    // 附加标记点：星云 / 球状星团 / 疏散星团 / 超新星遗迹 / AGN 核与喷流 / 团内热气体（都算"示意"的可参观标记）
    var nNeb = isDisk || type === 'irregular' ? 260 : 40, nGC = Math.round(clamp(150 * Math.pow(mStar / 5e10, 0.6), 8, 900));
    var nOC = isDisk || type === 'irregular' ? 160 : 10, nSNR = isDisk || type === 'irregular' ? 60 : 8;
    if (morph.type === 'dwarf') { nNeb = morph.sub === 'dIrr' ? 25 : 4; nGC = Math.max(2, Math.round(nGC * 0.2)); nOC = 12; nSNR = 4; }
    if (morph.lsb) { nNeb = Math.round(nNeb * 0.35); nOC = Math.round(nOC * 0.4); }
    if (morph.sub === 'S0') { nNeb = 20; nOC = 20; nSNR = 6; }
    var nAGN = agn ? (quasar ? 520 : 260) : 0;               // 核心亮点 + 双向喷流示意
    var nICM = morph.type === 'cluster' ? 900 : 0;           // 热气体晕（X 射线示意）
    var nCD = morph.type === 'cluster' ? 40 : 0;             // 成员星系示意点
    var extra = nNeb + nGC + nOC + nSNR + nAGN + nICM + nCD;
    var total = nStars + extra;
    var data = new Float32Array(8 * total), meta = new Uint8Array(total), temp = new Float32Array(total), n = 0;
    function gauss() { var u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
    function put(x, y, z, size, T, lum, kind, colOverride) {
      var c = colOverride || bbColor(T);
      var o = 8 * n; data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = size; data[o + 4] = c[0]; data[o + 5] = c[1]; data[o + 6] = c[2]; data[o + 7] = lum;
      meta[n] = kind; temp[n] = T; n++;
    }
    // 三轴/倾斜：椭圆星系随机取向；旋涡盘法向 = z（数据层要求银河系盘面即盒 xy 面）
    var ax = [1, 0.85 - 0.25 * rnd(), 0.6 - 0.2 * rnd()], rot = rnd() * TAU, tilt = (rnd() - 0.5) * 0.9;
    function orient(x, y, z) { // 只对椭圆用：绕 z 转 rot，再绕 x 倾 tilt
      var cx = Math.cos(rot), sx = Math.sin(rot), x1 = x * cx - y * sx, y1 = x * sx + y * cx;
      var ct = Math.cos(tilt), stt = Math.sin(tilt); return [x1, y1 * ct - z * stt, y1 * stt + z * ct];
    }
    if (type === 'spiral') {
      var fBulge = 0.12 + 0.18 * rnd(), Rb = Rd * 0.45, hz = Rd * 0.08;
      var nB = Math.round(nStars * fBulge), nD = nStars - nB;
      for (i = 0; i < nB; i++) {  // 核球（Hernquist）
        var u = rnd(), r = Rb * Math.sqrt(u) / (1 - Math.sqrt(u) + 1e-6); if (r > Rd * 2.5) r = Rd * 2.5 * rnd();
        var cth = 2 * rnd() - 1, sth = Math.sqrt(1 - cth * cth), ph = TAU * rnd();
        var T = 3600 + rnd() * 2200 - (rnd() < 0.05 ? 0 : 0);
        var lum = 0.25 + Math.pow(rnd(), 5) * 8;
        var x = r * sth * Math.cos(ph), y = r * sth * Math.sin(ph), z = r * cth * 0.65;
        if (bar) { var bl = Rd * 1.2; if (rnd() < 0.55) { x = (rnd() - 0.5) * 2 * bl; y = gauss() * bl * 0.22; z = gauss() * hz * 1.5; } }
        put(x, y, z, 0.006 + rnd() * 0.01, T, lum, 0);
      }
      var lnR0 = Math.log(Rd * 0.5), k = 1 / Math.tan(pitch);
      for (i = 0; i < nD; i++) {   // 盘（指数盘 Γ(2) 采样）+ 对数螺旋臂
        var rr = -Rd * (Math.log(rnd() || 1e-9) + Math.log(rnd() || 1e-9)); if (rr > extent) rr = extent * rnd();
        var th = TAU * rnd(), young = false;
        var smooth = rnd() < 0.38;
        if (!smooth && rr > Rd * 0.3) {
          var arm = Math.floor(rnd() * arms);
          var sig = 0.18 + 0.12 * Math.sqrt(Rd / Math.max(rr, 0.2));
          th = k * (Math.log(rr) - lnR0) + TAU * arm / arms + gauss() * sig;
          young = rnd() < 0.42;
        }
        var zz = gauss() * hz * (rnd() < 0.85 ? 1 : 3) * (1 + rr / (Rd * 8));
        var Ts, ls;
        if (young) { var q = rnd(); Ts = q < 0.6 ? 6500 + rnd() * 3500 : q < 0.9 ? 10000 + rnd() * 10000 : 20000 + rnd() * 20000; ls = 0.35 + Math.pow(rnd(), 3) * (Ts > 15000 ? 40 : 10); }
        else { Ts = 4200 + rnd() * 2600; ls = 0.2 + Math.pow(rnd(), 5) * 6; }
        put(rr * Math.cos(th), rr * Math.sin(th), zz, 0.006 + rnd() * 0.012, Ts, ls, 0);
      }
      for (i = 0; i < nNeb; i++) {   // 发射星云 / 尘埃辉光（大而暗的粉/蓝精灵）
        var rn = -Rd * (Math.log(rnd() || 1e-9) + Math.log(rnd() || 1e-9)); if (rn > extent) rn = extent * rnd(); if (rn < Rd * 0.3) rn += Rd * 0.3;
        var armn = Math.floor(rnd() * arms), thn = k * (Math.log(rn) - lnR0) + TAU * armn / arms + gauss() * 0.15;
        var pink = rnd() < 0.6;
        put(rn * Math.cos(thn), rn * Math.sin(thn), gauss() * hz, 0.15 + rnd() * 0.35, 8000, 0.05 + rnd() * 0.08, 1, pink ? [1.0, 0.45, 0.6] : [0.55, 0.7, 1.0]);
      }
      for (i = 0; i < nOC; i++) {    // 疏散星团（薄盘、年轻、蓝白）
        var ro = -Rd * (Math.log(rnd() || 1e-9) + Math.log(rnd() || 1e-9)); if (ro > extent) ro = extent * rnd();
        var tho = k * (Math.log(Math.max(ro, 0.2)) - lnR0) + TAU * Math.floor(rnd() * arms) / arms + gauss() * 0.2;
        put(ro * Math.cos(tho), ro * Math.sin(tho), gauss() * hz * 0.6, 0.02 + rnd() * 0.02, 9000, 0.5 + rnd() * 1.5, 5, [0.75, 0.85, 1.0]);
      }
      for (i = 0; i < nSNR; i++) {   // 超新星遗迹（壳层，偏青）
        var rs = -Rd * (Math.log(rnd() || 1e-9) + Math.log(rnd() || 1e-9)); if (rs > extent) rs = extent * rnd();
        var ths = TAU * rnd();
        put(rs * Math.cos(ths), rs * Math.sin(ths), gauss() * hz, 0.06 + rnd() * 0.1, 12000, 0.12 + rnd() * 0.2, 4, [0.55, 1.0, 0.85]);
      }
      for (i = 0; i < nGC; i++) {   // 球状星团（晕内）
        var ug = rnd(), rg = Rd * 3 * Math.sqrt(ug) / (1 - Math.sqrt(ug) + 1e-6); if (rg > extent * 1.3) rg = extent * rnd();
        var cg = 2 * rnd() - 1, sg = Math.sqrt(1 - cg * cg), pg = TAU * rnd();
        put(rg * sg * Math.cos(pg), rg * sg * Math.sin(pg), rg * cg, 0.03 + rnd() * 0.03, 5200, 1.5 + rnd() * 3, 2);
      }
    } else {
      var a = Re / 1.8153;   // Hernquist 标长（R_e ≈ 1.8153 a）
      for (i = 0; i < nStars; i++) {
        var ue = rnd(), re = a * Math.sqrt(ue) / (1 - Math.sqrt(ue) + 1e-6); if (re > extent) re = extent * rnd();
        var ce = 2 * rnd() - 1, se = Math.sqrt(1 - ce * ce), pe = TAU * rnd();
        var v = orient(re * se * Math.cos(pe) * ax[0], re * se * Math.sin(pe) * ax[1], re * ce * ax[2]);
        var Te = 3600 + rnd() * 2000 + (rnd() < 0.02 ? 3000 * rnd() : 0);
        put(v[0], v[1], v[2], 0.006 + rnd() * 0.012, Te, 0.25 + Math.pow(rnd(), 5) * 8, 0);
      }
      for (i = 0; i < nGC; i++) { var ug2 = rnd(), rg2 = a * 2.5 * Math.sqrt(ug2) / (1 - Math.sqrt(ug2) + 1e-6); if (rg2 > extent * 1.3) rg2 = extent * rnd(); var cg2 = 2 * rnd() - 1, sg2 = Math.sqrt(1 - cg2 * cg2), pg2 = TAU * rnd(); var v2 = orient(rg2 * sg2 * Math.cos(pg2), rg2 * sg2 * Math.sin(pg2), rg2 * cg2); put(v2[0], v2[1], v2[2], 0.03 + rnd() * 0.03, 5000, 1.5 + rnd() * 3, 2); }
      for (i = 0; i < nNeb; i++) {   // 椭圆/矮星系里也有少量星云（气体贫乏，数量少）
        var un = rnd(), rnn = a * Math.sqrt(un) / (1 - Math.sqrt(un) + 1e-6); if (rnn > extent) rnn = extent * rnd();
        var cn = 2 * rnd() - 1, sn = Math.sqrt(1 - cn * cn), pn = TAU * rnd(); var vn = orient(rnn * sn * Math.cos(pn), rnn * sn * Math.sin(pn), rnn * cn);
        put(vn[0], vn[1], vn[2], 0.1 + rnd() * 0.2, 8000, 0.04 + rnd() * 0.05, 1, [0.9, 0.55, 0.7]);
      }
      for (i = 0; i < nSNR; i++) { var us = rnd(), rss = a * Math.sqrt(us) / (1 - Math.sqrt(us) + 1e-6); if (rss > extent) rss = extent * rnd(); var cs2 = 2 * rnd() - 1, ss2 = Math.sqrt(1 - cs2 * cs2), ps2 = TAU * rnd(); var vs2 = orient(rss * ss2 * Math.cos(ps2), rss * ss2 * Math.sin(ps2), rss * cs2); put(vs2[0], vs2[1], vs2[2], 0.05 + rnd() * 0.08, 12000, 0.1 + rnd() * 0.15, 4, [0.55, 1.0, 0.85]); }
    }
    // 团内热气体（X 射线示意）+ 成员星系：晕 >10¹⁴ M⊙ 才有（Sarazin 1986；cD：Matthews 1964）
    if (nICM) {
      var Rvir = Re * 2.2;
      for (i = 0; i < nICM; i++) {   // β 模型式的弥散气体：中心密、外围稀
        var ui = rnd(), ri = Rvir * Math.pow(ui, 0.45), ci2 = 2 * rnd() - 1, si2 = Math.sqrt(1 - ci2 * ci2), pi2 = TAU * rnd();
        put(ri * si2 * Math.cos(pi2), ri * si2 * Math.sin(pi2), ri * ci2 * 0.85, 1.2 + rnd() * 3.5, 1e7, 0.02 + 0.05 * Math.pow(1 - ri / Rvir, 2), 7, [0.55, 0.75, 1.0]);
      }
      for (i = 0; i < nCD; i++) {    // 成员星系（示意点）
        var um = rnd(), rm = Rvir * Math.pow(um, 0.5), cm = 2 * rnd() - 1, sm = Math.sqrt(1 - cm * cm), pm = TAU * rnd();
        put(rm * sm * Math.cos(pm), rm * sm * Math.sin(pm), rm * cm, 0.25 + rnd() * 0.5, 5000, 2 + rnd() * 6, 8, [1.0, 0.93, 0.82]);
      }
    }
    // AGN / 类星体：核心亮点 + 双向喷流（M_BH 由 Kormendy & Ho 2013 的核球关系给出）
    if (nAGN) {
      var jetLen = (isDisk ? Rd : Re) * (quasar ? 6 : 3), jetDir = orient(0, 0, 1);
      put(0, 0, 0, quasar ? 0.5 : 0.28, 30000, quasar ? 220 : 60, 6, [0.85, 0.92, 1.0]);
      for (i = 1; i < nAGN; i++) {
        var t2 = Math.pow(rnd(), 0.7), sgn = rnd() < 0.5 ? 1 : -1, spread = 0.06 + 0.10 * t2;
        var jx = jetDir[0] * t2 * jetLen * sgn + gauss() * spread * jetLen * 0.25;
        var jy = jetDir[1] * t2 * jetLen * sgn + gauss() * spread * jetLen * 0.25;
        var jz = jetDir[2] * t2 * jetLen * sgn + gauss() * spread * jetLen * 0.25;
        put(jx, jy, jz, 0.06 + rnd() * 0.12, 22000, (quasar ? 0.5 : 0.22) * (1 - t2 * 0.8), 6, [0.7, 0.85, 1.0]);
      }
    }
    // 确定性洗牌：任何前缀都是均匀子样本（远处按角尺寸只画前 k 颗）
    for (i = n - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)); if (j === i) continue;
      var oi = 8 * i, oj = 8 * j;
      for (var q8 = 0; q8 < 8; q8++) { var tv = data[oi + q8]; data[oi + q8] = data[oj + q8]; data[oj + q8] = tv; }
      var tm = meta[i]; meta[i] = meta[j]; meta[j] = tm; var tt = temp[i]; temp[i] = temp[j]; temp[j] = tt;
    }
    return { seed: seed >>> 0, type: type, morph: morph.type, sub: morph.sub, typeName: morph.typeName, count: n, data: data, meta: meta, temp: temp,
      radiusKpc: extent, massMsun: mass, starMassMsun: mStar, arms: isDisk ? arms : 0, pitchDeg: isDisk ? Math.round(pitch * 180 / Math.PI) : 0, halo: halo, capacity: total,
      bar: !!bar, lsb: !!morph.lsb, isCluster: morph.type === 'cluster', isDwarf: morph.type === 'dwarf',
      agn: agn, quasar: quasar, mBHMsun: mBH, env: opts.env != null ? +opts.env : null,
      counts: { stars: nStars, nebula: nNeb, globular: nGC, openCluster: nOC, snr: nSNR, icm: nICM, members: nCD },
      refs: { morph: morph.ref, smhm: GAL_REF.smhm, bh: GAL_REF.bh, agn: GAL_REF.agn, gc: GAL_REF.gc, icm: GAL_REF.icm } };
  }
  // meta 里的类别码 → 英文键 / 中文名（0 恒星 1 星云 2 球状星团 3 数据层 4 超新星遗迹 5 疏散星团 6 AGN 7 团内热气体 8 成员星系）
  var KIND_NAME = { 0: 'star', 1: 'nebula', 2: 'globular', 3: 'data', 4: 'snr', 5: 'openCluster', 6: 'agn', 7: 'icm', 8: 'member' };
  var KIND_CN = { star: '恒星', nebula: '星云', globular: '球状星团', snr: '超新星遗迹', openCluster: '疏散星团', agn: '活动星系核', icm: '团内热气体', member: '成员星系' };
  var KIND_REF = { nebula: 'HII 区 / 反射星云（示意）', globular: GAL_REF.gc, openCluster: '疏散星团（示意）', snr: '超新星遗迹（示意）',
    agn: GAL_REF.bh + '；占比 ' + GAL_REF.agn, icm: GAL_REF.icm, member: GAL_REF.morph };
  function starInfoOf(gal, idx, universeSeed) {
    var o = 8 * idx, T = gal.temp[idx], kind = gal.meta[idx];
    var massSol = Math.pow(T / 5778, 2.0), lumSol = Math.pow(massSol, 3.5);
    var extra = gal.dataMeta && gal.dataMeta[idx];
    var info = {
      index: idx, kind: KIND_NAME[kind] || 'data',
      tempK: Math.round(T), spectral: spectralClass(T), massSol: +massSol.toFixed(2), lumSol: +lumSol.toPrecision(3),
      color: [gal.data[o + 4], gal.data[o + 5], gal.data[o + 6]], posKpc: [gal.data[o], gal.data[o + 1], gal.data[o + 2]],
      galaxy: { seed: gal.seed, type: gal.type, morph: gal.morph, sub: gal.sub, typeName: gal.typeName, radiusKpc: gal.radiusKpc,
        haloMassMsun: gal.massMsun, starMassMsun: gal.starMassMsun, bar: !!gal.bar, lsb: !!gal.lsb, isCluster: !!gal.isCluster, isDwarf: !!gal.isDwarf,
        agn: !!gal.agn, quasar: !!gal.quasar, mBHMsun: gal.mBHMsun, counts: gal.counts, refs: gal.refs },
      basis: extra ? DATA_LAYER_LABEL : '示意：过程生成，不是模拟结果'
    };
    // 非恒星类别不按恒星色温反推质量/光度（那是恒星的关系式），改挂各自的类型说明与出处
    if (info.kind !== 'star' && info.kind !== 'data') {
      info.massSol = null; info.lumSol = null; info.spectral = null;
      if (info.kind === 'icm' || info.kind === 'agn') info.tempK = info.kind === 'icm' ? 1e7 : null;
      info.typeRef = KIND_REF[info.kind] || null;
      if (info.kind === 'agn') { info.mBHMsun = gal.mBHMsun; info.quasar = !!gal.quasar; }
    }
    // 数据层天体：只报目录里真有的量（光谱型、B−V 推得的温度、视/绝对星等、距离），目录没有的（质量等）一律 null，不由温度反推
    if (extra) {
      info.name = extra.name; info.data = extra;
      info.spectral = extra.spect || null;
      info.tempK = extra.tempK != null ? Math.round(extra.tempK) : null;
      info.massSol = null;
      info.lumSol = extra.lumSol != null ? +Number(extra.lumSol).toPrecision(3) : null;
      if (extra.isSun) { info.isSun = true; info.name = '太阳'; }
    }
    info.seed = extra && extra.isSun ? 1207 : hashMix(hashMix(universeSeed >>> 0, gal.seed), idx);
    return info;
  }

  /* ============================================================
   * §6 数据层（opts.local，#1207）：真实观测目录（标"数据"）
   * ------------------------------------------------------------
   * 本文件不内置任何星表/星系表。所有数值从 window.MirrorLocalData（ui/localdata.js，由 tools/fetch-localdata.js
   * 从公开目录生成，逐条出处见 research/data/SOURCES.md）读取：
   *   L.STARS        HYG Database v4.1 —— 距太阳 100 光年内 636 颗（ra_deg/dec_deg/dist_pc/mag/absmag/spect/ci）
   *   L.LOCAL_GROUP  McConnachie 2012, AJ 144, 4 —— 本星系群 74 个成员（ra_deg/dec_deg/dist_kpc/type/M*）
   *   L.SUN          GRAVITY Collab. 2019（R₀ = 8.178 kpc）· Bennett & Bovy 2019（z☉ = 20.8 pc）· BHG 2016（Θ₀ = 238 km/s）
   *   L.MILKY_WAY    BHG 2016（M* = 5×10¹⁰ M⊙、薄盘标长 2.6 kpc、M_vir = 1.3×10¹² M⊙）
   *   L.VIRGO        SIMBAD（M 87 位置）+ Mei et al. 2007（16.5 Mpc）
   *   L.toGalactic / L.toXYZ  赤道 → 银道 → 直角坐标
   * MirrorLocalData 缺席 → localData() 返回 null，数据层直接不可用（不回退到任何内置表，也不编造任何数值）。
   * 坐标：银道直角坐标（kpc）。银心在原点，太阳在 (−R₀, 0, z☉)；+x = 从太阳指向银心，xy 面 = 银盘面（与 §5 旋涡盘一致），+z = 北银极。
   * ============================================================ */
  var DATA_LAYER_LABEL = '数据：观测目录（HYG v4.1 / McConnachie 2012）';
  // B−V 色指数 → 有效温度：Ballesteros 2012, EPL 97, 34008
  //   T_eff = 4600 K × [ 1/(0.92(B−V) + 1.7) + 1/(0.92(B−V) + 0.62) ]
  // 自检：HYG 给太阳 B−V = 0.656 → 5757 K（实测 T_eff ≈ 5772 K，差 0.3%）。目录里没有 ci 的恒星不猜温度（T = null，画成白点）。
  function tempFromCI(ci) {
    if (ci == null || !isFinite(ci)) return null;
    var b = 0.92 * ci, T = 4600 * (1 / (b + 1.7) + 1 / (b + 0.62));
    return isFinite(T) && T > 0 ? T : null;
  }
  // 下面两个是纯渲染参数（目录没有给出星系的半径与颜色）：按形态类型分档的显示尺寸/显示颜色，不是观测量。
  function lgDisplaySizeKpc(g) {
    var t = String(g.type || ''), base = /^(S|cE|E)/.test(t) ? 10 : /Irr/i.test(t) ? 3 : 1.2;
    if (g.massMsun > 0) base *= clamp(Math.pow(g.massMsun / 1e9, 1 / 6), 0.35, 2.2);
    return base;
  }
  function lgDisplayColor(g) {
    var t = String(g.type || '');
    if (/^(S|cE|E)/.test(t)) return [0.85, 0.87, 1.0];
    if (/Irr/i.test(t)) return [0.78, 0.86, 1.0];
    return [0.95, 0.90, 0.80];
  }
  var _localCache = null, _localTried = false;
  function localData() {
    if (_localTried) return _localCache;
    _localTried = true; _localCache = null;
    var L = root.MirrorLocalData;
    if (!L || !L.STARS || !L.LOCAL_GROUP || !L.SUN || typeof L.toGalactic !== 'function' || typeof L.toXYZ !== 'function') {
      console.warn('[universe3d] 没有 window.MirrorLocalData（ui/localdata.js）：数据层不可用。本模块不内置任何星表，故不作回退。');
      return null;
    }
    var R0 = L.SUN.galR_kpc, z0 = (L.SUN.z_pc || 0) / 1000;
    var sun = [-R0, 0, z0];
    function place(ra, dec, distKpc) {   // 赤道 (α, δ) + 距离 → 银道直角坐标（相对太阳，kpc）
      var g = L.toGalactic(ra, dec), p = L.toXYZ(g.l_deg, g.b_deg, distKpc);
      return { l: g.l_deg, b: g.b_deg, xyz: [p.x, p.y, p.z] };
    }
    // 太阳自身那一行（HYG 的 Sol）：绝对星等基准与色指数都取自同一目录，不引入外来常数
    var sol = null, i;
    for (i = 0; i < L.STARS.length; i++) if (L.STARS[i].name === 'Sol' || L.STARS[i].dist_pc === 0) { sol = L.STARS[i]; break; }
    var sunAbs = sol && sol.absmag != null ? sol.absmag : 4.85;
    var stars = [];
    L.STARS.forEach(function (s) {
      if (s.dist_pc == null || !(s.dist_pc > 0)) return;   // Sol（dist 0）单独放在银心坐标系里
      var distKpc = s.dist_pc / 1000, pl = place(s.ra_deg, s.dec_deg, distKpc);
      var nm = (typeof L.cnName === 'function' && L.cnName(s)) || s.name ||
        (s.bayer ? s.bayer + (s.con ? ' ' + s.con : '') : (s.hip ? 'HIP ' + s.hip : (s.con || '恒星')));
      stars.push({
        name: nm, catName: s.name || null, hip: s.hip, con: s.con, bayer: s.bayer, spect: s.spect || null, ci: s.ci,
        tempK: tempFromCI(s.ci), mag: s.mag, absmag: s.absmag,
        lumSol: s.absmag != null ? Math.pow(10, 0.4 * (sunAbs - s.absmag)) : null,   // V 波段光度（太阳 = 1）
        distPc: s.dist_pc, distLy: s.dist_pc * (L.LY_PER_PC || 3.26156377716), l: pl.l, b: pl.b, xyz: pl.xyz,
        source: 'HYG Database v4.1', basis: DATA_LAYER_LABEL
      });
    });
    var group = L.LOCAL_GROUP.map(function (g) {
      var pl = place(g.ra_deg, g.dec_deg, g.dist_kpc);
      return {
        name: g.nameCn || g.name, nameEn: g.nameEn, type: g.type, subgroup: g.subgroup,
        distKpc: g.dist_kpc, massMsun: g.mass_Msun, absMagV: g.absMagV, l: pl.l, b: pl.b, xyz: pl.xyz,
        isGalaxy: true, source: 'McConnachie 2012, AJ 144, 4', ref: g.ref, basis: DATA_LAYER_LABEL
      };
    });
    var virgo = null;
    if (L.VIRGO && L.VIRGO.dist_Mpc > 0) {
      var dK = L.VIRGO.dist_Mpc * 1000, pv = place(L.VIRGO.ra_deg, L.VIRGO.dec_deg, dK);
      virgo = { name: L.VIRGO.name || '室女座星系团（方向）', type: 'cluster', distKpc: dK, l: pv.l, b: pv.b, xyz: pv.xyz,
        isGalaxy: true, isCluster: true, source: 'SIMBAD (M 87) + Mei et al. 2007', ref: L.VIRGO.ref, basis: DATA_LAYER_LABEL };
    }
    var sunMeta = {
      name: '太阳', isSun: true, spect: sol && sol.spect || null, tempK: sol ? tempFromCI(sol.ci) : null,
      mag: sol && sol.mag, absmag: sunAbs, lumSol: 1, distKpc: R0, distPc: 0, galR_kpc: R0, z_pc: L.SUN.z_pc, vRot_kms: L.SUN.vRot_kms,
      note: '距银心 ' + R0 + ' kpc（GRAVITY 2019）· 银盘中平面之上 ' + L.SUN.z_pc + ' pc（Bennett & Bovy 2019）· Θ₀ = ' + L.SUN.vRot_kms + ' km/s（BHG 2016）· ' + (L.SUN.arm || ''),
      source: 'GRAVITY Collab. 2019 / Bennett & Bovy 2019 / BHG 2016', ref: L.SUN.ref, basis: DATA_LAYER_LABEL
    };
    return (_localCache = {
      label: DATA_LAYER_LABEL, version: L.version, generatedAt: L.generatedAt,
      sun: sun, sunMeta: sunMeta, sunInfo: L.SUN, mw: L.MILKY_WAY || null,
      stars: stars, group: group, virgo: virgo
    });
  }
  // 把数据层附加到（银河系）星系点云：返回新的 gal（data 扩容 + dataMeta）；没有观测目录就原样返回，不编造
  function attachLocalLayer(gal) {
    var LD = localData();
    if (!LD) return gal;
    var extras = [], i;
    extras.push({ xyz: [0, 0, 0], size: 0.004, col: LD.sunMeta.tempK ? bbColor(LD.sunMeta.tempK) : [1, 1, 1], lum: 3, T: LD.sunMeta.tempK || 0, dm: LD.sunMeta, atSun: true });
    LD.stars.forEach(function (s) {
      // 显示亮度/尺寸是渲染参数；由目录的绝对星等换算的 V 波段光度只用来定相对亮度，封顶避免糊屏
      var lum = clamp(s.lumSol != null ? s.lumSol : 1, 0.05, 40);
      extras.push({ xyz: s.xyz, size: 0.006 + Math.min(0.02, lum * 0.001), col: s.tempK != null ? bbColor(clamp(s.tempK, 1500, 40000)) : [1, 1, 1], lum: lum, T: s.tempK || 0, dm: s, atSun: true });
    });
    LD.group.forEach(function (g) {
      extras.push({ xyz: g.xyz, size: lgDisplaySizeKpc(g), col: lgDisplayColor(g), lum: 8, T: 0, dm: g, atSun: true });
    });
    if (LD.virgo) extras.push({ xyz: LD.virgo.xyz, size: 200, col: [0.92, 0.90, 0.72], lum: 0.6, T: 0, dm: LD.virgo, atSun: true });
    var extraN = extras.length, total = gal.count + extraN;
    var data = new Float32Array(8 * total), meta = new Uint8Array(total), temp = new Float32Array(total), dataMeta = {};
    // 数据层天体放在最前（远处按前缀绘制时不会被丢掉）
    data.set(gal.data.subarray(0, 8 * gal.count), 8 * extraN); meta.set(gal.meta.subarray(0, gal.count), extraN); temp.set(gal.temp.subarray(0, gal.count), extraN);
    var sun = LD.sun;
    for (i = 0; i < extraN; i++) {
      var e = extras[i], o = 8 * i;
      data[o] = sun[0] + e.xyz[0]; data[o + 1] = sun[1] + e.xyz[1]; data[o + 2] = sun[2] + e.xyz[2]; data[o + 3] = e.size;
      data[o + 4] = e.col[0]; data[o + 5] = e.col[1]; data[o + 6] = e.col[2]; data[o + 7] = e.lum;
      meta[i] = 3; temp[i] = e.T; dataMeta[i] = e.dm;
    }
    return { seed: gal.seed, type: gal.type, typeName: gal.typeName + '（银河系，含数据层）', count: total, data: data, meta: meta, temp: temp, radiusKpc: gal.radiusKpc, massMsun: gal.massMsun, starMassMsun: gal.starMassMsun,
      arms: gal.arms, pitchDeg: gal.pitchDeg, halo: gal.halo, capacity: total, dataMeta: dataMeta, isLocal: true, sunIndex: 0, dataCount: extraN, dataLabel: DATA_LAYER_LABEL };
  }

  /* ============================================================
   * §7 支持检测 / 宇宙学抽取 / 档位
   * ============================================================ */
  /* WebGPU 拿不到时的原因分类 + 一句可执行的建议。
   * 用户机器有独显却一直跑 "webgl2 · Worker CPU 物理"，光说"WebGPU 不可用"没有任何用；
   * 这里把六种可分辨的原因固化下来，暴露在 isSupported() 与 getState().gpuReason / gpuAdvice。 */
  var GPU_REASONS = {
    'ok': { label: 'WebGPU 可用', advice: '' },
    'insecure-context': { label: '页面不是安全上下文（file:// 或非 https）', advice: '用 https 链接打开（file:// 不提供 WebGPU）；本地调试用 http://localhost 也算安全上下文' },
    'no-navigator-gpu': { label: '浏览器没有暴露 navigator.gpu', advice: 'Chrome/Edge 113+ 才有 WebGPU；如果已是新版，在 chrome://flags 搜 WebGPU 确认没被禁用（Linux 上还要 enable-unsafe-webgpu）' },
    'no-adapter': { label: 'requestAdapter() 返回空：没有可用的显卡适配器', advice: '显卡驱动或浏览器没把适配器暴露出来：更新显卡驱动 / 关闭省电模式 / 在 Windows「图形设置」里把浏览器设为“高性能”（别让它只看到集显）' },
    'device-failed': { label: 'requestDevice() 失败：适配器在，设备建不出来', advice: '多半是驱动或显存问题：更新显卡驱动、重启浏览器后重试；仍不行就降低粒子档位' },
    'fallback-after-error': { label: 'WebGPU 初始化中途失败，已回退到 WebGL2', advice: '控制台里搜 [universe3d] 看具体报错（常见是着色器/显存限制）；更新显卡驱动或降低粒子档位后重试' },
    'disabled-by-option': { label: '调用方指定了 force:"webgl2"', advice: '去掉 force 选项（或地址栏里的 ?mode=webgl2）就会优先走 WebGPU' }
  };
  function gpuReasonOf(reason) { var r = GPU_REASONS[reason] || GPU_REASONS['no-navigator-gpu']; return { reason: reason, gpuLabel: r.label, gpuAdvice: r.advice }; }
  // navigator.gpu 缺席时区分"非安全上下文"与"浏览器/开关不支持"——两者的处理办法完全不同
  function probeGpuReason() {
    if (root.navigator && root.navigator.gpu) return 'ok';
    if (root.isSecureContext === false) return 'insecure-context';
    return 'no-navigator-gpu';
  }
  var _sup = null;
  function isSupported() {
    // 能力探测的结果在一次会话里不会变：只探一次，并且探完立刻把上下文丢掉。
    // 否则每进一次宇宙就新建一个 webgl2 上下文（本函数被 app 的 can3D 与下面的 create() 各调一次，
    // 一轮泄漏两个），Chrome 活动上下文一满就回收最旧的，正在用的那个被吞掉 → CONTEXT_LOST。
    if (!_sup) {
      var gl2 = false;
      try {
        var c = document.createElement('canvas'), g = c.getContext('webgl2');
        gl2 = !!g;
        if (g) { var ext = g.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
      } catch (e) { gl2 = false; }
      _sup = { webgpu: !!(root.navigator && root.navigator.gpu), webgl2: gl2 };
    }
    // 只有 WebGL2 探测值得缓存（它要真开一个上下文）；navigator.gpu 的存在性与原因分类每次现算，
    // 免得缓存下来的 webgpu 与刚算出来的 gpuReason 互相打架。
    _sup.webgpu = !!(root.navigator && root.navigator.gpu);
    var info = gpuReasonOf(probeGpuReason());
    _sup.gpuReason = info.reason; _sup.gpuLabel = info.gpuLabel; _sup.gpuAdvice = info.gpuAdvice;
    return _sup;
  }
  // 从引擎 simulate() 结果（或适配器 sim.raw）抽取宇宙学量；也接受已是平面对象的输入
  function cosmologyFrom(r) {
    if (!r) return {};
    if (!r.constants && !r.cosmology && !r.calc) return r;
    var c = r.constants || {}, bg = (r.cosmology && r.cosmology.background) || {}, st = (r.calc && r.calc.structure) || {};
    var out = {
      h: c.h != null ? c.h : (c.H0 != null ? c.H0 / 100 : undefined), H0: c.H0,
      omegaB: c.omegaB, omegaC: c.omegaC, omegaM: bg.omegaM != null ? bg.omegaM : (c.omegaB != null && c.omegaC != null ? c.omegaB + c.omegaC : undefined),
      omegaLambda: bg.omegaLambda != null ? bg.omegaLambda : c.omegaLambda, omegaK: bg.omegaK != null ? bg.omegaK : c.omegaK, omegaR: bg.omegaR != null ? bg.omegaR : c.omegaR,
      ns: c.ns, As: c.As, Q: c.Q, tcmb: c.tcmb, sigma8: st.sigma8 != null ? st.sigma8 : undefined,
      fate: r.fate || (r.cosmology && r.cosmology.fate) || null, tOfA: r.cosmology && typeof r.cosmology.tOfA === 'function' ? r.cosmology.tOfA : null,
      outcome: r.outcome && r.outcome.id, idLabel: r.idLabel, seed: r.seed != null ? r.seed : r.hash,
      // 空间维数：优先引擎算出的宏观维数（calc.dims.D，可能是涌现/分数维），否则取输入参数 dimS
      dimS: (r.calc && r.calc.dims && r.calc.dims.D != null) ? r.calc.dims.D : (c.dimS != null ? c.dimS : undefined)
    };
    // σ₈ 缺席（a=1 前转向）时按 Q 标度
    if (out.sigma8 == null && c.Q != null) out.sigma8 = 0.81 * (c.Q / 2e-5) * Math.exp(1.84 * ((c.ns || 0.965) - 0.965));
    Object.keys(out).forEach(function (k) { if (out[k] === undefined) delete out[k]; });
    return out;
  }
  // 粒子档位：WebGPU 与 WebGL2 分表；np = 粒子立方根，mesh = PM 网格
  var TIERS = {
    webgpu: { tiny: { np: 48, mesh: 32 }, low: { np: 64, mesh: 64 }, mid: { np: 128, mesh: 128 }, high: { np: 160, mesh: 128 }, ultra: { np: 200, mesh: 128 } },
    /* WebGL2 路径的引力求解跑在 CPU Worker 上，粒子数直接压在 CPU 上。
       原来的地板是 low（48³ = 110592 粒子），低配机连初始条件都要生成半天。
       tiny = 32³ = 32768 粒子、48³ 网格，约为 low 的三成负载。 */
    webgl2: { tiny: { np: 32, mesh: 32 }, low: { np: 48, mesh: 64 }, mid: { np: 64, mesh: 64 }, high: { np: 80, mesh: 64 }, ultra: { np: 80, mesh: 64 } }
  };
  function autoTier(mode) {
    var cores = (navigator.hardwareConcurrency || 4), mem = navigator.deviceMemory || 4;
    if (mode === 'webgpu') return (cores >= 8 && mem >= 8) ? 'mid' : 'low';
    /* 走到 WebGL2 说明这台机器没有可用的 WebGPU，而且引力求解要落到 CPU Worker 上。
       核心少或内存小的机器给 low 都嫌重（用户实测：48³ 粒子连初始条件都生成不完），
       这种情况直接从 tiny 起步，用户想加再自己往上调。 */
    if (cores <= 4 || mem <= 4) return 'tiny';
    return cores >= 8 ? 'mid' : 'low';
  }
  var CSS = '.u3d-ov{position:fixed;pointer-events:none;font:12px/1.5 Consolas,"Microsoft YaHei",monospace;color:#c9cde0;text-shadow:0 1px 2px #000;z-index:20;overflow:hidden}' +
    '.u3d-ov *{box-sizing:border-box}' +
    // 模块自身 HUD 默认放左下（宿主页面的顶部标注占着顶栏，叠在一起会互相盖住）；opts.hudPosition:'top-left' 可移回顶部
    '.u3d-hud{position:absolute;left:12px;bottom:58px;max-width:calc(100% - 168px);display:flex;flex-direction:column;gap:1px}' +
    '.u3d-ov.hud-tl .u3d-hud{top:10px;bottom:auto}' +
    '.u3d-lab{font-size:12px;color:#e8ebf5;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.u3d-lab b{font-weight:500;color:#fff}' +
    '.u3d-st{color:#9aa0b8;font-size:12px}.u3d-st .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.u3d-st .pz{color:#ffd28a}' +
    '.u3d-note{position:absolute;left:50%;top:10px;transform:translateX(-50%);padding:3px 10px;border:1px solid rgba(255,190,90,.55);border-radius:3px;background:rgba(20,14,4,.6);color:#ffd28a;font-size:12px}' +
    '.u3d-note.data{border-color:rgba(120,200,255,.55);color:#9fdcff;background:rgba(4,12,20,.6)}.u3d-hint{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);color:#7c8299;font-size:11px;white-space:nowrap}' +
    // CPU 物理告警条：明确、醒目、可操作（不是灰色小字）。有它时把 .u3d-note 往下让一行。
    '.u3d-warn{position:absolute;left:50%;top:8px;transform:translateX(-50%);max-width:calc(100% - 24px);display:flex;align-items:center;gap:10px;padding:5px 10px 5px 12px;border:1px solid #ffab35;border-radius:4px;background:rgba(56,30,2,.92);color:#ffdca6;font-size:12.5px;line-height:1.45;box-shadow:0 2px 12px rgba(0,0,0,.55);pointer-events:auto;z-index:22}' +
    '.u3d-warn .txt{white-space:normal}.u3d-warn b{color:#fff;font-weight:600}.u3d-warn .u3d-btn{flex:0 0 auto;border-color:#ffab35;color:#ffeccd;background:rgba(96,52,0,.75)}.u3d-warn .u3d-btn:hover:not([disabled]){background:rgba(140,78,0,.9);border-color:#ffd08a;color:#fff}' +
    '.u3d-ov.has-warn .u3d-note{top:46px}.u3d-ov.hud-none .u3d-warn{display:none}' +
    '.u3d-scale{position:absolute;left:12px;bottom:34px;color:#dfe3f2;font-size:11px}.u3d-scale .bar{height:2px;background:#dfe3f2;margin:3px 0 2px;box-shadow:0 0 4px #9ab}.u3d-scale .bar::before,.u3d-scale .bar::after{content:"";position:absolute;width:1px;height:8px;background:#dfe3f2;margin-top:-3px}.u3d-scale .bar::after{right:0}' +
    '.u3d-scale .barwrap{position:relative;width:120px}.u3d-mini{position:absolute;right:12px;bottom:12px;width:132px;height:132px;border:1px solid #2a3150;background:#04060c;border-radius:2px}' +
    '.u3d-hl{position:absolute;padding:1px 6px;border-left:1px solid rgba(140,200,255,.6);color:#bfe3ff;font-size:11px;white-space:nowrap;background:rgba(0,4,12,.45);border-radius:0 3px 3px 0}.u3d-hl.sel{color:#fff;border-color:#fff}' +
    // 盒子线框（俯瞰）用一张 2D canvas 画；按钮条在小地图上方，唯一可接收指针事件的部分
    '.u3d-wire{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}' +
    '.u3d-ov.hud-min .u3d-btns,.u3d-ov.hud-min .u3d-hint{display:none}' +
    '.u3d-ov.hud-none .u3d-btns,.u3d-ov.hud-none .u3d-hint,.u3d-ov.hud-none .u3d-hud,.u3d-ov.hud-none .u3d-scale,.u3d-ov.hud-none .u3d-mini,.u3d-ov.hud-none .u3d-labels{display:none}' +
    '.u3d-btns{position:absolute;right:12px;bottom:152px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;pointer-events:none}' +
    '.u3d-btn{pointer-events:auto;font:12px/1.4 Consolas,"Microsoft YaHei",monospace;color:#cfd6ea;background:rgba(6,10,20,.72);border:1px solid #38406a;border-radius:3px;padding:3px 9px;cursor:pointer;white-space:nowrap;text-shadow:none}' +
    '.u3d-btn:hover:not([disabled]){background:rgba(20,28,50,.92);border-color:#5a67a8;color:#fff}' +
    '.u3d-btn.on{border-color:#7fb2ff;color:#dbeaff;background:rgba(18,34,64,.88)}' +
    '.u3d-btn[disabled]{opacity:.5;color:#6b7189;border-color:#262c47;background:rgba(6,10,20,.5);cursor:not-allowed}' +
    '.u3d-prog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#dfe3f2;font-size:13px;text-align:center;background:rgba(0,0,0,.45);padding:8px 16px;border-radius:4px}' +
    '.u3d-star{position:absolute;padding:4px 8px;border:1px solid rgba(255,255,255,.35);border-radius:3px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;white-space:pre;pointer-events:none}' +
    /* 维数画面层（D>3 混乱 / 2≤D<3 黑平面银线）：铺在 3D 画布正上方，盖住粒子网。
       它是 canvas 的兄弟节点（宿主页里就是 #app 里的 #gl3d 旁边），z-index 5 —— 压过画布层（1~4），
       但低于界面页(.page 10)与宿主 HUD(12~14)，所以顶部标注、时间条、右侧按钮照常可见可点。
       pointer-events:none：WASD / 拖拽转向 / 滚轮仍然直接落到 3D 画布上，相机照常能动。 */
    '.u3d-dim{position:absolute;left:0;top:0;width:100%;height:100%;display:block;z-index:5;pointer-events:none;background:transparent}' +
    /* 高维**且还遮着**的时候：模块自己那些"看得见结构"的标注要收起来 —— 晕标签和小地图画在覆盖层(z=20)上，
       会浮在混乱色块之上，等于一边说"我们无法观察它"一边指着屏幕报晕的质量，自相矛盾。
       揭开之后这个类会被摘掉（看的就是投影，晕标签/小地图/比例尺当然该回来）。 */
    '.u3d-ov.dim-chaos .u3d-labels,.u3d-ov.dim-chaos .u3d-mini,.u3d-ov.dim-chaos .u3d-scale,.u3d-ov.dim-chaos .u3d-wire{display:none}' +
    /* 「我们无法观察它」那一屏的字与出口（createDimVeil）。与 .u3d-dim 同一个父节点、z-index 6：
       压过混乱色块层(5)，低于界面页(.page 10)与宿主 HUD(12~14)，所以顶部标注、时间条、右侧按钮照常可见可点。
       配色不跟主题走：它贴的是永远纯黑的画布（#app 深浅两个主题都是 #000），深底浅字两边都成立；
       颜色仍走 --hud-* token 并各自带回退值，demo 页没有这些 token 也不会变透明。 */
    '.u3d-veil{position:absolute;left:0;top:0;width:100%;height:100%;z-index:6;display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:auto;' +
    'font:13px/1.6 "PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.u3d-veil.done{display:block;pointer-events:none;padding:0}' +
    '.u3d-veil-card{max-width:min(520px,90%);padding:20px 22px 16px;text-align:center;border-radius:4px;' +
    'background:var(--hud-panel2,rgba(13,16,32,.92));border:1px solid var(--hud-line2,#3A4370);box-shadow:0 12px 44px rgba(0,0,0,.62);color:var(--hud-ink,#E9E6F5)}' +
    '.u3d-veil-h{font-size:19px;font-weight:600;letter-spacing:.06em;color:#fff;margin-bottom:8px}' +
    '.u3d-veil-p{font-size:13px;color:var(--hud-ink,#E9E6F5);opacity:.88;margin-bottom:15px}' +
    '.u3d-veil-b{pointer-events:auto;font:13px/1.5 inherit;font-weight:600;color:#0A0C14;background:#E8EBF5;border:1px solid #fff;border-radius:3px;padding:7px 16px;cursor:pointer;text-shadow:none}' +
    '.u3d-veil-b:hover{background:#fff}' +
    '.u3d-veil-b.sm{font-size:11px;font-weight:500;padding:1px 7px;white-space:nowrap;flex:0 0 auto;color:var(--hud-ink,#E9E6F5);background:transparent;border-color:var(--hud-line2,#3A4370)}' +
    '.u3d-veil-b.sm:hover{background:rgba(255,255,255,.10);border-color:#8FA0D8}' +
    '.u3d-veil-k{margin-top:10px;font-size:11.5px;color:var(--hud-dim,#8B8FA8)}' +
    /* 揭开之后的常驻提示：左下角、压在底部时间条之上的那一段空白里。
       量过宿主页在这个状态下的实际占位（1262×764）：顶部标注 y62–83 横跨整幅、顶栏状态 y90–108、
       右侧按钮列 x1042+、底部时间条 y631–708、小地图 x1118+ —— 左边 x12–175 / y130–620 是空的。
       放左上角试过：与顶部标注和 #0001 那行叠在一起，三层字糊成一团（截图见验证记录），所以贴到左下。 */
    '.u3d-veil-tip{position:absolute;left:12px;bottom:150px;max-width:min(320px,44%);display:flex;gap:8px;align-items:flex-start;pointer-events:auto;' +
    'padding:4px 8px;border-radius:3px;background:var(--hud-bg,rgba(4,5,10,.55));border:1px solid var(--hud-line,#262D4A);' +
    'color:var(--hud-dim,#8B8FA8);font-size:11.5px;line-height:1.55}';
  var cssInjected = false;
  function injectCSS() { if (cssInjected || !root.document) return; cssInjected = true; var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

  /* ============================================================
   * §8 create()：状态机 + 相机/输入 + 覆盖层 + LOD + 公共 API
   * ============================================================ */
  function create(canvas, opts) {
    opts = opts || {};
    injectCSS();
    var cosIn = cosmologyFrom(opts.cosmology || {});
    var cosmo = K.makeCosmo(cosIn);
    var seed = (opts.seed != null ? opts.seed : (cosIn.seed != null ? cosIn.seed : 1207)) >>> 0;
    var L = clamp(+opts.boxMpc || 200, 20, 1000);
    var aIc = opts.aIc || 0.02;
    var local = !!opts.local;
    // 空间维数（默认 3）：泊松核 φ_k ∝ ρ_k·k^{−(5−D)}·exp(−k²ε²)，ε = softCells 个网格间距（标准 N 体软化，压住紫外发散）
    var dimS = opts.dimS != null ? +opts.dimS : (cosIn.dimS != null ? +cosIn.dimS : 3);
    if (!isFinite(dimS) || dimS <= 0) dimS = 3;
    var pexp = 5 - dimS;                                              // 不截断：D>5 时核随 k 增长，由软化保证稳定
    // ε 随 |D−3| 连续增长（0.4 → 2 个网格，D≥4 取满 2）：D=3 不软化，离 3 越远紫外发散越凶就软化得越多。
    // 不能对所有 D≠3 都取满 2——D 只偏离一点点时，2 格软化会把小尺度结构整片抹掉，画面反而比 D=3 还空。
    /* 软化长度按 D 单边调（specs/highdim-v1.md 二节 / 审计 2.5 档那条）：
       紫外发散只在 D>3 才有，D<3 的力比牛顿更长程，原来的对称式 2·|D−3| 把 D=2.5 也塞进 1 个网格的
       软化，等于把那一档的引力吃掉，画面才「几乎不受力」。改用 MirrorPlanets.dimGravity.softCells(D)：
       D≤3 → 0；D>3 → clamp(2·(D−3), 0.4, 2)，**D≥4 恒为 2，与改动前逐位相同**。
       取不到 planets 模块（单独跑 demo 页）时退回本地同式。 */
    var softCells = (function () {
      if (+opts.softenCells > 0) return clamp(+opts.softenCells, 0.2, 3);
      var P0 = root.MirrorPlanets;
      if (P0 && P0.dimGravity && typeof P0.dimGravity.softCells === 'function') return P0.dimGravity.softCells(dimS);
      return dimS <= 3 ? 0 : clamp(clamp(2 * (dimS - 3), 0.4, 2), 0.2, 3);
    })();
    /* 维数画面：'chaos'（D>3，无法观察）/ 'plane'（2≤D<3，黑平面 + 垂直银线）/ 'normal'（照旧）。
       只改**怎么画**：D 维引力核、步长、晕识别、分析面板全部照跑不误，画面层只是盖在上面。
       opts.dimView:'off' 可以关掉（demo 页或想看底下粒子网时用）。 */
    var dimMode = opts.dimView === 'off' ? 'normal' : dimViewOf(dimS);
    /* D>3 那一档现在是**可以揭开的一屏**，不是一层永久遮罩：
       dimVeiled=true 时画混乱色块 + 那块字，点了出口就翻成 false，露出底下一直在跑的投影。
       会话内揭开过就直接是 false（记忆策略见 §1.5 dimVeilSeen 的注释）。
       2≤D<3 那一档**不进这套**：原著里黑平面 + 垂直银线就是"这个宇宙长什么样"本身，
       不是遮住什么的东西，给它加出口等于说那不是它的样子。 */
    var dimVeiled = (dimMode === 'chaos') && !dimVeilRevealed();
    // 物质形态：'stars'（默认，老行为：飞进晕里过程生成星系点云）/ 'dark'（该宇宙没有稳定原子、没有恒星
    // ——不生成任何星系，晕就按 PM 粒子本身的密度梯度显示为"引力聚集的物质团块"，也没有恒星可点选）。
    // 由宿主按结局传入：NO_ATOMS / UNSTABLE_ORBITS / NO_STARS / 黑洞主导… → 'dark'。
    var hasStars = !(opts.matter === 'dark' || opts.hasStars === false);
    var matterMode = hasStars ? 'stars' : 'dark';
    // 覆盖层：overlay:false 完全不渲染模块自己的 UI；hud:'full'(默认)/'minimal'(只留左下状态行+小地图)/'none'
    var hudMode = opts.hud === 'minimal' || opts.hud === 'none' ? opts.hud : 'full';
    var overlayOn = opts.overlay !== false;
    var onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    var onEnterStar = typeof opts.onEnterStar === 'function' ? opts.onEnterStar : null;
    var wantMode = opts.force || null;
    var tierReq = opts.particles || 'auto';
    var t0H0 = cosmo.tOfA(aIc);   // 初始时刻 [1/H0]
    var t0Gyr = (cosIn.tOfA ? (function () { try { var v = cosIn.tOfA(aIc); return isFinite(v) && v != null ? v : null; } catch (e) { return null; } })() : null);
    if (t0Gyr == null) t0Gyr = t0H0 * cosmo.TH;
    var boxToMpc = L / cosmo.h;   // 1 盒 = L Mpc/h = L/h Mpc（共动）
    var kpcToBox = 1e-3 * cosmo.h / L;
    // 步长下限：让 a: aIc→1 的全程在 maxSteps（默认 600）步内跑完，与 D=3 同量级（D=3 约 100 步）。
    // D≠3 的 CFL 只在这个下限之上起作用——否则少数极端加速度粒子会把 dt 压到 1e-5，宇宙几乎不演化。
    // 俯瞰参数：盒外 1.6 倍盒长、仰角 30°、环绕角速度（rad/s）；进入宇宙先俯瞰 introSec 秒再落进盒内
    var OV_DIST = clamp(+opts.overviewDist || 1.6, 0.8, 6), OV_ELEV = (opts.overviewElevDeg != null ? +opts.overviewElevDeg : 30) * Math.PI / 180;
    var OV_ORBIT = opts.overviewOrbitSpeed != null ? +opts.overviewOrbitSpeed : 0.09;
    var OV_INTRO = opts.introOverview === false ? 0 : clamp(+opts.introOverviewSec || 3, 0, 30);
    var dtMin = 0;
    if (dimS !== 3) {
      var tEndH0 = 1.0;
      try { var aT = cosmo.aMax != null ? Math.min(1, cosmo.aMax * 0.99) : 1; var t1 = cosmo.tOfA(aT); if (isFinite(t1) && t1 > t0H0) tEndH0 = t1 - t0H0; } catch (e) { /* 用默认 */ }
      dtMin = Math.max(1e-6, tEndH0 / clamp(+opts.maxSteps || 600, 100, 5000));
    }

    var S = {   // 运行状态
      mode: null, tier: null, N: 0, mesh: 0, np: 0, backend: null, worker: null, anWorker: null, icWorker: null,
      a: aIc, ad: 0, t: 0, steps: 0, running: false, ready: false, disposed: false, error: null,
      targetT: Infinity, targetA: 1, aStop: 8, defaultTargetA: 1,
      fps: 0, frameT: 0, lastFrame: 0, hidden: !!document.hidden,
      traceHeavy: true, lastHeavy: null, heavyLog: null,     // 每帧分段计时（见 frame() 的 heavy()）
      exposureEV: 0, volume: false, labels: true, tiling: false, colorMode: 0, properScale: false, showParticles: true,
      halos: [], haloRel: null, selHalo: -1, nearHalo: null, nearDist: Infinity, minimap: null, minimapM: 0, an: null, anPending: false, lastAn: 0,
      lod: 1, galaxy: null, galHalo: null, galAnchor: null, galAt: 0, starSel: -1, pick: null, lodNotice: '',
      Pk: null, sigma8: null, cpuGridF32: null, cpuGrid8: null, cpuGridM: 0, label: '', progressText: '初始化…', starsPerGalaxy: 150000,
      autoBrake: true, flyAnim: null, localHost: null, worldGyr: 0, accMax: 0,
      overview: false, ovOrbit: opts.overviewOrbit !== false, ovAz: 0, introTimer: 0, volAuto: false,
      autoExposure: opts.autoExposure !== false, autoGain: 1, lumaP99: null, lastLuma: 0,
      lumaClip: 0, lumaPeak: 0, lumaLit: 0, lumaMean: 0, lumaTarget: 0.8,
      blurred: false, lowPower: !!opts.lowPower,
      gpuReason: null, gpuDetail: '', gpuRetrying: false, gpuRetryMsg: ''
    };
    if (cosmo.aMax != null) { S.defaultTargetA = Infinity; }   // 转向宇宙：跑到坍缩为止
    S.targetA = S.defaultTargetA;

    /* ---------- 相机 ---------- */
    var cam = { pos: [0.5, 0.5, 0.5], yaw: 0.6, pitch: -0.15, fov: 60 * Math.PI / 180, speed: 0.06, keys: {}, dragging: false, lastX: 0, lastY: 0, moved: 0, right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
    var rndCam = K.mulberry32(seed ^ 0xC0FFEE); cam.pos = [rndCam(), rndCam(), rndCam()]; cam.yaw = rndCam() * TAU;
    /* 低维那档：把初始相机放在平面附近、略微俯看。理由是画面本身 ——
       随机 z 有一半概率把人扔在离平面半个盒长的地方，那时平面只是天边的一条缝，
       而原文的画面是「宇宙呈现一个无际的黑色平面，有无数银光闪闪的直线与黑的平面垂直相交」。
       只动初始位姿，不锁相机：WASD 照样能飞离平面（飞远了就该看到它变成天边一条缝，那是对的）。 */
    if (dimMode === 'plane') { cam.pos[2] = DIM_PLANE_Z + 0.055; cam.pitch = -0.20; }
    function basis() {
      var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      cam.fwd = [cp * cy, cp * sy, sp]; cam.right = [sy, -cy, 0]; cam.up = [-cy * sp, -sy * sp, cp];
    }
    basis();
    function wrapCam() { if (S.overview) return; for (var i = 0; i < 3; i++) { cam.pos[i] -= Math.floor(cam.pos[i]); } }
    // 俯瞰模式下相机在盒外：用绝对相对位置（与 tiles=0 的渲染一致），否则晕环/标签会被卷到相机周围
    function minImage(p) {
      if (S.overview) return [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]];
      return [p[0] - cam.pos[0] - Math.round(p[0] - cam.pos[0]), p[1] - cam.pos[1] - Math.round(p[1] - cam.pos[1]), p[2] - cam.pos[2] - Math.round(p[2] - cam.pos[2])];
    }
    function len3(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }

    /* ---------- 覆盖层 ---------- */
    var ov = null, els = {};
    if (overlayOn && root.document) {
      ov = document.createElement('div'); ov.className = 'u3d-ov' + (opts.hudPosition === 'top-left' ? ' hud-tl' : '') + (hudMode === 'minimal' ? ' hud-min' : '') + (hudMode === 'none' ? ' hud-none' : '') + (dimVeiled ? ' dim-chaos' : '');
      ov.innerHTML = '<canvas class="u3d-wire"></canvas>' +
        '<div class="u3d-hud"><div class="u3d-lab"></div><div class="u3d-st"><div class="ln ln1"></div><div class="ln ln2"></div></div></div>' +
        '<div class="u3d-warn" hidden><span class="txt"></span><button class="u3d-btn" data-act="retrygpu" type="button">' + T('重试 WebGPU') + '</button></div>' +
        '<div class="u3d-note" hidden></div><div class="u3d-hint">' + T('WASD/QE 移动 · 右键/左键拖拽转向 · 滚轮调速 · Shift 加速 · O 俯瞰全盒 · F 飞到最密处 · H 飞到随机晕 · ') + (hasStars ? T('点击恒星进入') : T('本宇宙无恒星可点选')) + T(' · V 体渲染 · L 标签') + '</div>' +
        '<div class="u3d-btns">' +
        '<button class="u3d-btn" data-act="overview" type="button">' + T('俯瞰全盒 (O)') + '</button>' +
        '<button class="u3d-btn" data-act="orbit" type="button">' + T('环绕 ') + T('开') + '</button>' +
        '<button class="u3d-btn" data-act="densest" type="button">' + T('飞到最密处 (F)') + '</button>' +
        '<button class="u3d-btn" data-act="halo" type="button">' + T('飞入随机晕 (H)') + '</button>' +
        '<button class="u3d-btn" data-act="showcase" type="button" hidden>' + T('参观示例星系（示意）') + '</button>' +
        '<button class="u3d-btn" data-act="volume" type="button">' + T('体渲染 (V)') + '</button>' +
        '<button class="u3d-btn" data-act="autoexp" type="button">' + T('曝光 ') + T('自动') + '</button>' +
        '<button class="u3d-btn" data-act="lowpower" type="button">' + T('低功耗 ') + T('关') + '</button>' +
        '</div>' +
        '<div class="u3d-scale"><div class="barwrap"><div class="bar"></div></div><span class="txt"></span></div><canvas class="u3d-mini" width="132" height="132"></canvas><div class="u3d-labels"></div><div class="u3d-prog"></div><div class="u3d-star" hidden></div>';
      document.body.appendChild(ov);
      ['lab', 'st', 'note', 'hint', 'scale', 'mini', 'labels', 'prog', 'star', 'wire', 'btns', 'warn'].forEach(function (k) { els[k] = ov.querySelector('.u3d-' + k); });
      els.warnTxt = ov.querySelector('.u3d-warn .txt'); els.warnBtn = ov.querySelector('.u3d-warn .u3d-btn');
      els.st1 = ov.querySelector('.u3d-st .ln1'); els.st2 = ov.querySelector('.u3d-st .ln2');
      els.scaleTxt = ov.querySelector('.u3d-scale .txt');
      els.miniCtx = els.mini.getContext('2d');
      els.wireCtx = els.wire.getContext('2d');
      els.btn = {};
      Array.prototype.forEach.call(ov.querySelectorAll('.u3d-btn'), function (b) { els.btn[b.getAttribute('data-act')] = b; });
      // 直接绑在覆盖层上；此处不能用下面的 on()（那时 listeners 变量还没初始化），
      // 所以把处理器留在 els 上，dispose 里显式摘掉——只靠"移除 ov 节点"解绑的话，
      // 监听器计数每引爆一次就多一个，看不出真正的泄漏。
      els.btnsClick = function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.u3d-btn') : null;
        if (!b || b.disabled) return;
        e.preventDefault(); e.stopPropagation();
        var act = b.getAttribute('data-act');
        if (act === 'overview') api.toggleOverview();
        else if (act === 'orbit') { S.ovOrbit = !S.ovOrbit; syncButtons(); }
        else if (act === 'densest') api.flyTo('densest');
        else if (act === 'halo') api.flyTo('randomHalo');
        else if (act === 'showcase') api.showcaseGalaxy();
        else if (act === 'volume') api.toggleVolume();
        else if (act === 'autoexp') api.setAutoExposure(!S.autoExposure);
        else if (act === 'lowpower') api.setLowPower(!S.lowPower);
        syncButtons();
      };
      els.btns.addEventListener('click', els.btnsClick);
      // 告警条在按钮列之外，单独绑一个监听（dispose 里显式摘掉）
      els.warnClick = function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.u3d-btn') : null;
        if (!b || b.disabled) return;
        e.preventDefault(); e.stopPropagation();
        if (b.getAttribute('data-act') === 'retrygpu') api.retryGpu();
      };
      els.warn.addEventListener('click', els.warnClick);
    }
    // 按钮状态：禁用态必须看得出来（灰 + title 说明原因），不能"看着能点却没反应"
    function syncButtons() {
      if (!els.btn) return;
      var noHalo = !S.halos.length, sig = S.sigma8 != null ? S.sigma8.toFixed(2) : '—';
      function set(k, on, dis, title, text) {
        var b = els.btn[k]; if (!b) return;
        b.disabled = !!dis; b.className = 'u3d-btn' + (on ? ' on' : '');
        b.title = title || ''; if (text != null) b.textContent = text;
      }
      set('overview', S.overview, !S.ready, S.ready ? T('把相机拉到盒外俯瞰整盒（快捷键 O）') : T('还在生成初始条件…'), T('俯瞰全盒 (O)'));
      set('orbit', S.ovOrbit, false, T('俯瞰时缓慢自动环绕'), T('环绕 ') + T(S.ovOrbit ? '开' : '关'));
      // 「飞到最密处」任何时候都可用：没有晕就飞到密度场最大的格点（总存在）
      set('densest', false, !S.ready, S.halos.length ? T('飞到最重的晕') : T('这个宇宙还没有识别到晕：飞到密度场最大处'), T('飞到最密处 (F)'));
      set('halo', false, !S.ready, noHalo ? T('这个宇宙没有形成晕（σ₈≈') + sig + ' · D=' + fmtNum(dimS, 2) + T('）：点一下看说明') : (hasStars ? T('随机飞进一个晕') : T('随机飞进一个物质团块（该宇宙无恒星，没有星系）')), T('飞入随机晕 (H)'));
      var sc = els.btn.showcase; if (sc) { sc.hidden = !(hasStars && noHalo && S.ready && S.showcaseOffer); sc.title = T('按最密处的种子过程生成一个星系，只作示意（不是这个宇宙的模拟结果）'); }
      set('volume', S.volume, !S.ready, T('密度体渲染：显示纤维与空洞（快捷键 V）'), T('体渲染 (V)'));
      set('lowpower', S.lowPower, false, S.lowPower ? T('低功耗开：渲染限 30 fps、物理降频（省电/降温）') : T('机器发烫或风扇狂转时打开：渲染限 30 fps、物理降频'), T('低功耗 ') + T(S.lowPower ? '开' : '关'));
      set('autoexp', S.autoExposure, false, S.autoExposure ? T('自动曝光：按屏幕亮度直方图归一（目标随分布形状自适应，削顶像素压在 0.5% 以内）。+ / − 手动调节会关掉它') : T('手动曝光：点一下恢复自动'), T('曝光 ') + T(S.autoExposure ? '自动' : '手动'));
    }
    function syncOverlay() {
      if (!ov) return;
      var r = canvas.getBoundingClientRect();
      ov.style.left = r.left + 'px'; ov.style.top = r.top + 'px'; ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
      ov.hidden = canvas.hidden || r.width < 2;
      if (els.wire) { var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); if (els.wire.width !== w || els.wire.height !== h) { els.wire.width = w; els.wire.height = h; } }
    }
    // 把盒坐标点投影到覆盖层像素（CSS 像素）；相机后方返回 null
    function projectPt(p) {
      var r = minImage(p), vz = r[0] * cam.fwd[0] + r[1] * cam.fwd[1] + r[2] * cam.fwd[2];
      if (vz <= 1e-6) return null;
      var fy = 1 / Math.tan(cam.fov / 2), fx = fy * H / W;
      var vx = r[0] * cam.right[0] + r[1] * cam.right[1] + r[2] * cam.right[2];
      var vy = r[0] * cam.up[0] + r[1] * cam.up[1] + r[2] * cam.up[2];
      return [(vx * fx / vz * 0.5 + 0.5) * (W / dpr), (0.5 - vy * fy / vz * 0.5) * (H / dpr)];
    }
    var BOX_EDGES = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
    function drawWire() {
      if (!els.wireCtx) return;
      var c = els.wireCtx, cw = els.wire.width, ch = els.wire.height;
      c.clearRect(0, 0, cw, ch);
      if (!S.overview) return;
      var corners = [];
      for (var i = 0; i < 8; i++) corners.push([(i & 1), (i >> 1) & 1, (i >> 2) & 1]);
      c.save(); c.lineWidth = 1; c.strokeStyle = 'rgba(130,170,255,.55)'; c.setLineDash([5, 4]);
      c.beginPath();
      for (var e = 0; e < BOX_EDGES.length; e++) {
        var A = corners[BOX_EDGES[e][0]], B = corners[BOX_EDGES[e][1]], prev = null;
        for (var s = 0; s <= 12; s++) {                  // 分段投影：跨过相机平面的部分自动断开
          var t = s / 12, p = projectPt([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
          if (p && prev) { c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); }
          prev = p;
        }
      }
      c.stroke();
      c.setLineDash([]); c.fillStyle = 'rgba(150,185,255,.85)'; c.font = '11px Consolas, "Microsoft YaHei", monospace';
      var lab = projectPt([0.5, 0.5, 1.02]);
      if (lab) c.fillText(T('模拟盒 ') + L + T(' Mpc/h（共动 ') + fmtLen(boxToMpc) + T('）'), lab[0] - 60, lab[1] - 6);
      c.restore();
    }
    /* ============================================================
     * 维数画面层：原著第八章对高维 / 低维的两种描写，画在 3D 画布正上方的一张 2D canvas 上。
     *   'chaos'（D>3）  ——「屏幕上出现了一堆极其混乱的色彩和形状……我们无法观察它」
     *                     ——现在**只在揭开之前**画：dimVeiled 翻成 false 就整层不画也不显示，
     *                       露出底下那张 WebGL 画布（它从头到尾都在渲染，见 §1.5）
     *   'plane'（2≤D<3）——「无际的黑色平面，有无数银光闪闪的直线与黑的平面垂直相交」
     *                     ——这一档没有出口、没有揭开：它就是这个宇宙的样子
     * 底下的 PM N 体模拟照常跑（D 维引力核、晕识别、σ₈、分析面板、时间轴都不受影响），
     * 这一层只决定"看到什么"。相机也照常能动：低维那档的银线是用真实相机投影的，WASD 能在平面上飞。
     * ============================================================ */
    var dimCv = null, dimCtx = null, dimRnd = null, dimSt = null, dimChaos = null;
    if (dimMode !== 'normal' && root.document && canvas.parentNode) {
      dimCv = document.createElement('canvas');
      dimCv.className = 'u3d-dim';
      dimCv.setAttribute('aria-hidden', 'true');
      dimCv.hidden = true;
      canvas.parentNode.insertBefore(dimCv, canvas.nextSibling);
      dimCtx = dimCv.getContext('2d');
      dimRnd = K.mulberry32(hashMix(seed, 0x2d5c));      // 由种子决定：同一个宇宙每次进来画面一致
      // dimRnd 只管布局与配色（同一 seed 永远同一幅）；rndT 管运行期事件（隔几秒换掉几个形状），
      // 两条流分开，免得帧率去搅第一条。t/swapIn/anchors/glow/vg 都是 chaos 那一屏的连续运动状态。
      dimSt = { acc: 0, tick: 0, shapes: [], lines: [], t: 0, swapIn: 0, anchors: null,
                rndT: K.mulberry32(hashMix(seed, 0x2d5d)), glow: null, glowFail: false, vg: null, vgW: 0, vgH: 0 };
      if (dimMode === 'chaos') dimChaos = createDimChaos(seed, dimS);
      if (dimMode === 'plane') {
        /* 平面内随机撒下"恒星"（垂直于平面的一维亮线）。长度取盒长的 1%~6%：
           原文里恒星"几亿光年长"，而平面直径 500 亿光年 —— 相对可见平面只有百分之几，照这个比例来。
           画面主体必须是**平面**：所以线与平面的交点画成亮点（那才是"银光闪闪"的恒星），
           线身压暗当尾迹。反过来（线身很亮）会糊成一片雨帘，看不出有个平面。 */
        for (var dli = 0; dli < 420; dli++) {
          dimSt.lines.push({ x: dimRnd(), y: dimRnd(), h: 0.010 + Math.pow(dimRnd(), 2) * 0.05, b: 0.45 + dimRnd() * 0.55 });
        }
      }
    }
    /* D>3 的那块字与出口（会话记忆也在它里面）。挂在画布的父节点上，与 dimCv 同级。
       只有 'chaos' 这一档有；'plane' 一档不建，它没有可揭开的东西。 */
    var dimVeil = null;
    if (dimMode === 'chaos' && root.document && canvas.parentNode) {
      dimVeil = createDimVeil(canvas.parentNode, {
        dim: dimS, exitText: T('仍然要看它的三维投影'), tipHead: T('屏幕上是它的三维投影（D='),
        onChange: function (rev) {
          dimVeiled = !rev;
          // 揭开 → 混乱色块层不再显示也不再画；晕标签/小地图/比例尺/线框跟着回来；顶部标注换成"这是投影"
          if (ov) { if (dimVeiled) ov.classList.add('dim-chaos'); else ov.classList.remove('dim-chaos'); }
          if (dimCv) dimCv.hidden = !dimVeiled || !!canvas.hidden || !S.ready;
          label();
        }
      });
    }
    // 相机坐标系下的相对向量 → 覆盖层 CSS 像素；相机后方返回 null（与 projectPt 同一套投影参数）
    function dimProject(rx, ry, rz, cw, ch, fx, fy) {
      var vz = rx * cam.fwd[0] + ry * cam.fwd[1] + rz * cam.fwd[2];
      if (vz <= 1e-5) return null;
      var vx = rx * cam.right[0] + ry * cam.right[1] + rz * cam.right[2];
      var vy = rx * cam.up[0] + ry * cam.up[1] + rz * cam.up[2];
      return [(vx * fx / vz * 0.5 + 0.5) * cw, (0.5 - vy * fy / vz * 0.5) * ch, vz];
    }
    function drawDimPlane(cw, ch) {
      var c = dimCtx, i, b;
      // 「这个黑色没有厚度的二维平面就是这个宇宙的太空」：平面本身不画，它就是黑的
      c.fillStyle = '#000000'; c.fillRect(0, 0, cw, ch);
      var fy = 1 / Math.tan(cam.fov / 2), fx = fy * ch / cw;
      var dz = DIM_PLANE_Z - cam.pos[2];      // 相机到平面的（有向）高度
      // 地平线：平面在无穷远处的消失线。只画极淡的一道，提示"平面在这儿"，不给它任何厚度或颜色
      c.save();
      c.beginPath();
      var started = false;
      for (i = 0; i <= 96; i++) {
        var th = i / 96 * TAU, p = dimProject(Math.cos(th) * 1e4, Math.sin(th) * 1e4, dz, cw, ch, fx, fy);
        if (!p) { started = false; continue; }
        if (started) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); started = true; }
      }
      c.strokeStyle = 'rgba(180,190,210,0.22)'; c.lineWidth = 1; c.stroke();
      c.restore();
      // 亮线：按距离分档收集，一档一次描边
      var bodies = [], cores = [], dots = [];
      for (b = 0; b < DIM_BANDS; b++) { bodies.push([]); cores.push([]); }
      var L2 = dimSt.lines, over = S.overview;
      for (i = 0; i < L2.length; i++) {
        var Ln = L2[i];
        for (var tx = -DIM_TILE; tx <= DIM_TILE; tx++) for (var ty = -DIM_TILE; ty <= DIM_TILE; ty++) {
          // 俯瞰模式下相机在盒外：用绝对相对位置（与线框/标签一致），否则平铺会绕到相机周围
          var rx = Ln.x + tx - cam.pos[0], ry = Ln.y + ty - cam.pos[1];
          var d2 = rx * rx + ry * ry + dz * dz;
          if (d2 > (over ? 36 : 9)) continue;                       // 远处不画：省下大半的描边
          var pA = dimProject(rx, ry, dz + Ln.h, cw, ch, fx, fy);
          var pB = dimProject(rx, ry, dz - Ln.h, cw, ch, fx, fy);
          var pM = dimProject(rx, ry, dz, cw, ch, fx, fy);
          if (!pM) continue;                                        // 交点在相机后面：整条线不画（近平面裁剪的简化）
          if (!pA || !pB) continue;
          if (pM[0] < -40 || pM[0] > cw + 40) continue;
          var dist = Math.sqrt(d2), a = clamp(Ln.b * (0.22 + 0.62 / Math.max(dist, 0.05)), 0.05, 1);
          b = clamp(Math.floor((1 - a) * DIM_BANDS), 0, DIM_BANDS - 1);
          bodies[b].push(pA[0], pA[1], pB[0], pB[1]);
          // 交点附近更亮的一小段：原文里线与平面"相交"，交点是画面里最亮的地方
          var kk = 0.28;
          cores[b].push(pM[0] + (pA[0] - pM[0]) * kk, pM[1] + (pA[1] - pM[1]) * kk,
                        pM[0] + (pB[0] - pM[0]) * kk, pM[1] + (pB[1] - pM[1]) * kk);
          dots.push(pM[0], pM[1], clamp(1.5 / Math.max(dist, 0.10), 0.7, 6), a);
        }
      }
      c.lineCap = 'butt';
      for (b = 0; b < DIM_BANDS; b++) {
        var aB = 1 - (b + 0.5) / DIM_BANDS, arr = bodies[b];
        if (arr.length) {
          c.strokeStyle = 'rgba(206,218,246,' + (aB * 0.20).toFixed(3) + ')';   // 线身只当尾迹，压暗
          c.lineWidth = clamp(aB * 1.2, 0.4, 1.4);
          c.beginPath();
          for (i = 0; i < arr.length; i += 4) { c.moveTo(arr[i], arr[i + 1]); c.lineTo(arr[i + 2], arr[i + 3]); }
          c.stroke();
        }
        arr = cores[b];
        if (arr.length) {
          c.strokeStyle = 'rgba(240,246,255,' + (aB * 0.62).toFixed(3) + ')';
          c.lineWidth = clamp(aB * 1.8, 0.5, 2.2);
          c.beginPath();
          for (i = 0; i < arr.length; i += 4) { c.moveTo(arr[i], arr[i + 1]); c.lineTo(arr[i + 2], arr[i + 3]); }
          c.stroke();
        }
      }
      // 「银光闪闪」：交点才是恒星本身，画成亮点 —— 一整面这样的亮点，平面才看得出来
      if (dots.length) {
        for (i = 0; i < dots.length; i += 4) {
          var dr2 = dots[i + 2], da = Math.min(1, dots[i + 3] * 1.35);
          if (dr2 > 2.2) {   // 近处的大星带一圈晕
            var gg = c.createRadialGradient(dots[i], dots[i + 1], 0, dots[i], dots[i + 1], dr2 * 2.6);
            gg.addColorStop(0, 'rgba(226,238,255,' + (da * 0.42).toFixed(3) + ')');
            gg.addColorStop(1, 'rgba(226,238,255,0)');
            c.fillStyle = gg; c.beginPath(); c.arc(dots[i], dots[i + 1], dr2 * 2.6, 0, TAU); c.fill();
          }
          c.fillStyle = 'rgba(255,255,255,' + da.toFixed(3) + ')';
          c.beginPath(); c.arc(dots[i], dots[i + 1], dr2 * 0.5, 0, TAU); c.fill();
        }
      }
    }
    function drawDimView(dt) {
      if (!dimCtx || !dimCv || dimCv.hidden) return;
      var cw = Math.max(1, W / dpr), ch = Math.max(1, H / dpr);
      dimCtx.setTransform(dpr, 0, 0, dpr, 0, 0);      // 画布按设备像素开，内容按 CSS 像素画
      // 那句话正常由 createDimVeil 那块 DOM 卡片来说（还带着出口按钮）；部件建不出来时才退回画在画布上
      if (dimMode === 'chaos') dimChaos.draw(dimCtx, cw, ch, dt, { calm: S.lowPower, drawText: !dimVeil });
      else drawDimPlane(cw, ch);
    }
    function setProgress(txt) { S.progressText = txt || ''; if (els.prog) { els.prog.textContent = S.progressText; els.prog.hidden = !S.progressText; } onStatus(txt, api ? api.getState() : null); }

    /* ---------- 尺寸 ---------- */
    var W = 1, H = 1, dpr = 1;
    function resize() {
      dpr = Math.min(root.devicePixelRatio || 1, opts.maxDpr || 1.5);
      var cw = canvas.clientWidth || canvas.width || 640, ch = canvas.clientHeight || canvas.height || 480;
      W = Math.max(1, Math.round(cw * dpr)); H = Math.max(1, Math.round(ch * dpr));
      if (S.backend) S.backend.resize(W, H); else { canvas.width = W; canvas.height = H; }
      // 维数画面层跟着一起变尺寸（它盖在 3D 画布上，尺寸必须逐像素对齐）
      if (dimCv && (dimCv.width !== W || dimCv.height !== H)) { dimCv.width = W; dimCv.height = H; if (dimChaos) dimChaos.reset(); }
      syncOverlay();
    }

    /* ---------- 输入 ---------- */
    var listeners = [];
    function on(t, ev, fn, o) { t.addEventListener(ev, fn, o); listeners.push([t, ev, fn, o]); }
    function isTyping() { var a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); }
    /* 切语言：状态行（「3D PM N 体模拟（… 512,000 粒子 …）」「高维宇宙（D=…）：屏幕上是它的三维投影…」）
       是 label() 当场用 T()/TX() 拼进 S.baseLabel 的，字符串一旦落地就不再跟语言走。这里按原式重拼一遍——
       label() 只读既有状态（S.mode / S.N / S.mesh / dimS / dimMode…）拼字符串，不重跑物理、不动渲染。
       宿主（app.js）每帧从 getState().label 取新值，底部维度说明随之更新。
       用 on() 登记，dispose 时会连同其它监听一起摘掉。 */
    on(document, 'mirror:lang', function () {
      try { label(); } catch (e) { /* ignore */ }
      try { syncButtons(); } catch (e) { /* ignore */ }
      try { if (S.ready) onStatus(currentLabel(), api.getState()); } catch (e) { /* ignore */ }
    });
    on(canvas, 'contextmenu', function (e) { e.preventDefault(); });
    on(canvas, 'pointerdown', function (e) { if (e.button !== 0 && e.button !== 2) return; cam.dragging = true; cam.dragBtn = e.button; cam.lastX = e.clientX; cam.lastY = e.clientY; cam.moved = 0; try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } canvas.focus && canvas.focus(); });
    on(canvas, 'pointermove', function (e) {
      if (!cam.dragging) return;
      var dx = e.clientX - cam.lastX, dy = e.clientY - cam.lastY; cam.lastX = e.clientX; cam.lastY = e.clientY; cam.moved += Math.abs(dx) + Math.abs(dy);
      var sens = 0.0032 * (cam.fov / (60 * Math.PI / 180));
      cam.yaw -= dx * sens; cam.pitch = clamp(cam.pitch - dy * sens, -1.55, 1.55); basis(); S.flyAnim = null;
    });
    on(canvas, 'pointerup', function (e) {
      if (!cam.dragging) return; cam.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      if (cam.moved < 4 && e.button === 0) handleClick(e.clientX, e.clientY);
    });
    // 滚轮：passive 监听 + 每帧合并。主线程忙（CPU 路径 33 fps）时，滚轮事件会挤成一串，
    // 逐个同步处理就会"卡"。这里只累加 deltaY，真正的调速/调视场在 applyWheel() 里每帧做一次；
    // 滚轮路径上不做任何重算、曝光采样或 readPixels。
    var wheelAcc = { d: 0, fov: 0 };
    on(canvas, 'wheel', function (e) {
      if (e.ctrlKey) wheelAcc.fov += e.deltaY; else wheelAcc.d += e.deltaY;
    }, { passive: true });
    function applyWheel() {
      if (wheelAcc.fov) { cam.fov = clamp(cam.fov * Math.pow(1.1, wheelAcc.fov / 100), 5 * PI / 180, 100 * PI / 180); wheelAcc.fov = 0; }
      if (wheelAcc.d) { cam.speed = clamp(cam.speed * Math.pow(1.18, -wheelAcc.d / 100), 1e-9, 2); wheelAcc.d = 0; }
    }
    on(root, 'keydown', function (e) {
      if (isTyping() || S.disposed) return;
      var k = e.key.toLowerCase();
      if ('wasdqe'.indexOf(k) >= 0 && k.length === 1) { cam.keys[k] = true; e.preventDefault(); return; }
      if (k === 'shift') cam.keys.shift = true; if (k === 'control') cam.keys.ctrl = true;
      // 键位与主应用一致（SPEC-3d §3）：F = 最密处，H/R = 随机晕，O = 俯瞰全盒
      if (k === 'f') api.flyTo('densest'); else if (k === 'h' || k === 'r') api.flyTo('randomHalo'); else if (k === 'v') api.toggleVolume(); else if (k === 'l') api.toggleLabels();
      else if (k === 'o') api.toggleOverview();
      else if (k === '+' || k === '=') { api.setExposure(S.exposureEV + 0.5); }   // 手动曝光 → 关掉自动
      else if (k === '-' || k === '_') { api.setExposure(S.exposureEV - 0.5); }
      else if (k === ' ') { if (S.running) api.pause(); else api.start(); e.preventDefault(); }
    });
    on(root, 'keyup', function (e) { var k = e.key.toLowerCase(); cam.keys[k] = false; if (k === 'shift') cam.keys.shift = false; if (k === 'control') cam.keys.ctrl = false; });
    on(root, 'blur', function () { cam.keys = {}; });
    // 页面隐藏 / 窗口失焦：物理与渲染一起停（WebGPU 路径由主循环自然停止，Worker 路径要显式 pause），
    // 回到前台再从原处继续——用户切走时不该继续烧 CPU/GPU
    function syncSuspend() {
      var sus = S.hidden || S.blurred;
      if (S.worker) {
        if (sus && S.running) { S.worker.postMessage({ type: 'pause' }); S.pausedByHide = true; }
        else if (!sus && S.pausedByHide) { S.pausedByHide = false; S.running = true; S.worker.postMessage({ type: 'run', target: { t: S.targetT / cosmo.TH - t0H0, a: S.targetA } }); }
      }
      if (!sus) S.lastFrame = 0;   // 恢复时别把停顿算进 dt
    }
    on(document, 'visibilitychange', function () { S.hidden = !!document.hidden; syncSuspend(); });
    on(root, 'blur', function () { S.blurred = true; syncSuspend(); });
    on(root, 'focus', function () { S.blurred = false; syncSuspend(); });
    on(root, 'resize', resize);
    // 触摸：单指拖拽转向，双指捏合调速/前进
    var touch = { n: 0, d0: 0 };
    on(canvas, 'touchstart', function (e) { touch.n = e.touches.length; if (touch.n === 1) { cam.dragging = true; cam.lastX = e.touches[0].clientX; cam.lastY = e.touches[0].clientY; } else if (touch.n === 2) { touch.d0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); } }, { passive: true });
    on(canvas, 'touchmove', function (e) { if (e.touches.length === 1 && cam.dragging) { var dx = e.touches[0].clientX - cam.lastX, dy = e.touches[0].clientY - cam.lastY; cam.lastX = e.touches[0].clientX; cam.lastY = e.touches[0].clientY; cam.yaw -= dx * 0.004; cam.pitch = clamp(cam.pitch - dy * 0.004, -1.55, 1.55); basis(); } else if (e.touches.length === 2) { var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); cam.keys.w = d > touch.d0 * 1.02; cam.keys.s = d < touch.d0 * 0.98; } e.preventDefault(); }, { passive: false });
    on(canvas, 'touchend', function () { cam.dragging = false; cam.keys.w = false; cam.keys.s = false; });

    /* ---------- 后端初始化 ---------- */
    var readyResolve, readyReject;
    var ready = new Promise(function (res, rej) { readyResolve = res; readyReject = rej; });
    ready.catch(function () { /* 由调用方处理 */ });
    // 档位：WebGPU 上默认最高只到 mid（2M 粒子）。high/ultra 会把整台机器跑满，必须显式 opts.allowHighTier 才启用。
    function chooseTier(mode) {
      var t = TIERS[mode][tierReq] ? tierReq : autoTier(mode);
      if (mode === 'webgpu' && !opts.allowHighTier && (t === 'high' || t === 'ultra')) t = 'mid';
      return t;
    }
    function label() {
      var s = T('3D PM N 体模拟（') + (S.mode === 'webgpu' ? 'WebGPU' : 'WebGL2 · Worker CPU') + ' · ' + fmtBig(S.N) + T(' 粒子 · ') + S.mesh + T('³ 网格 · 盒长 ') + L + ' Mpc/h' + T('）');
      // D≠3：画面仍是 3 维投影，但引力按 D 维定律 F ∝ r^{−(D−1)} 求解（软化长度 ε = softCells 个网格间距）
      if (dimS !== 3) s = T('3 维投影 · 引力按 r^{−(D−1)} 衰减（D=') + fmtNum(dimS, 2) + T('，核以最大尺度归一）· 软化长度 ε=') + fmtLen(softenMpc()) + ' · ' + s;
      /* D≤2：引擎判"势为对数或排斥，没有牛顿吸引，物质无法聚集"（Tegmark 1997），
         而这里的泊松核是把牛顿力按 r^{−(D−1)} 外推的结果，屏幕上照样结团。
         画面改不了（这一档占链上宇宙约 20%，换成一片静止点阵等于把它们全变空屏），
         标注必须说清楚，否则画面与结局互相打脸。与 ui/scenes.js 的 nbodyScene 用同一句话。 */
      if (dimS <= 2 + 1e-9) s += T('　·　注意：引擎判据在 D≤2 没有牛顿吸引（势为对数或排斥，物质无法聚集，Tegmark 1997），屏幕上的成团是把 r^{−(D−1)} 当牛顿力外推出来的，不是这个宇宙里会发生的事');
      // 维数画面层开着时，顶部标注先说人看到的是什么，再说底下还在算什么——不然屏幕和标注对不上
      if (dimMode === 'chaos') s = T('高维宇宙（D=') + fmtNum(dimS, 2) + (dimVeiled
        ? T('）：我们无法观察它 · 屏幕上只有一堆极其混乱的色彩和形状')
        : T('）：屏幕上是它的三维投影，这个宇宙本身我们无法直接观察')) + T(' · 底层仍在跑：') + s;
      else if (dimMode === 'plane') s = T('低维宇宙（D=') + fmtNum(dimS, 2) + T('）：黑色没有厚度的平面就是这个宇宙的太空，与平面垂直相交的亮线是只有一维的恒星') + T(' · 底层仍在跑：') + s;
      S.baseLabel = s;
      S.label = s = currentLabel();
      if (els.lab) els.lab.innerHTML = '<b>' + T('模拟') + '</b> ' + s;
      return s;
    }
    // 无恒星宇宙里飞近团块时的标注：说清楚"这不是星系"（画面仍然是模拟出来的粒子，不是示意图）
    var CLUMP_LABEL = '引力聚集的物质团块 · 该宇宙无稳定原子/无恒星，没有星系可言 · ';   // 显示处包 T()
    function currentLabel() {
      var base = S.baseLabel || S.label || '';
      return (!hasStars && S.inClump) ? T(CLUMP_LABEL) + base : base;
    }
    // 软化长度 ε（共动 Mpc）：softCells 个网格间距；网格未定（初始化前）按 64³ 估
    function softenMpc() { return softCells * (L / (S.mesh || 64)) / cosmo.h; }
    var icCache = null;   // {pos, vel}（WebGPU 重算用；仅 N ≤ 4.2M 时缓存）
    function haloOpts() {
      var M = S.mesh, cellMass = cosmo.OmM * RHO_CRIT * Math.pow(L, 3) / (M * M * M), cellMpc = L / M;
      // 峰阈值随网格分辨率缩放：1.56 Mpc/h 格取 δ>40，格越粗阈值越低（大格里的团块被摊薄）
      var thr = opts.haloThreshold || clamp(40 * 1.5625 / cellMpc, 8, 100);
      return { threshold: thr, topN: opts.haloTopN || 160, cellMass: cellMass, omegaM: cosmo.OmM, boxMpc: L };
    }
    function cosmoPlain() { return { h: cosmo.h, omegaB: cosmo.OmB, omegaC: cosmo.OmM - cosmo.OmB, omegaM: cosmo.OmM, omegaLambda: cosmo.OmL, omegaK: cosmo.OmK, omegaR: cosmo.OmR, ns: cosmo.ns, sigma8: cosmo.sigma8, tcmb: cosmo.tcmb }; }

    // WebGPU 走不通时把原因记下来（分类见 GPU_REASONS）：已有更具体的原因就不覆盖成笼统的那条
    function setGpuReason(reason, detail, force) {
      if (!force && S.gpuReason && S.gpuReason !== 'ok' && reason === 'fallback-after-error') return;
      S.gpuReason = reason; S.gpuDetail = detail || '';
    }
    function initWebGPU() {
      if (!navigator.gpu) { setGpuReason(probeGpuReason(), '', true); return Promise.reject(new Error('no navigator.gpu')); }
      return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (adapter) {
        // 续期检查：requestAdapter/requestDevice 都是异步的，中途用户可能已经再次引爆（旧实例 dispose）。
        // 不检查就会在一个死实例上继续建设备、configure 共享画布，把新实例的画面顶掉。
        if (S.disposed) return null;
        if (!adapter) { setGpuReason('no-adapter', '', true); throw new Error('requestAdapter 返回空'); }
        var lim = adapter.limits, req = {};
        ['maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX'].forEach(function (k) { if (lim && lim[k] != null) req[k] = lim[k]; });
        return adapter.requestDevice({ requiredLimits: req }).catch(function () { return adapter.requestDevice(); })
          .then(function (device) { return { adapter: adapter, device: device }; }, function (e) { setGpuReason('device-failed', e && e.message || String(e), true); throw e; });
      }).then(function (o) {
        if (!o) return;                                   // 已 dispose：连设备都不要建
        var device = o.device;
        if (S.disposed) { try { device.destroy(); } catch (e) { /* ignore */ } return; }   // 设备刚拿到就作废：还回去
        S.mode = 'webgpu'; S.tier = chooseTier('webgpu'); setGpuReason('ok', '', true);
        var tier = TIERS.webgpu[S.tier];
        // 显存/绑定上限保护：粒子 vec4 16B ×2 + 网格
        var maxBind = device.limits.maxStorageBufferBindingSize || 134217728, maxBuf = device.limits.maxBufferSize || 268435456;
        while (16 * Math.pow(tier.np, 3) > Math.min(maxBind, maxBuf) && tier.np > 64) tier = { np: tier.np - 16, mesh: tier.mesh };
        S.np = tier.np; S.mesh = tier.mesh; S.N = tier.np * tier.np * tier.np;
        device.lost.then(function (info) { if (!S.disposed) { console.warn('[universe3d] WebGPU device lost:', info && info.message); S.error = 'device lost'; setProgress('WebGPU 设备丢失：' + (info && info.message || '')); } });
        S.backend = createWebGPUBackend(canvas, { device: device, N: S.N, mesh: S.mesh, cosmo: cosmo, aIc: aIc, pexp: pexp, softCells: softCells });
        S.backend.resize(W, H);
        // 分析 worker + 初始条件 worker
        S.anWorker = makeWorker();
        S.anWorker.onmessage = function (ev) { var m = ev.data; if (m.type === 'analysis') onAnalysis(m); else if (m.type === 'error') console.warn('[universe3d/analysis]', m.message); };
        // 初始条件 Worker 挂到 S 上：它要为 np³（可达 200³ = 8M）粒子分配好几个大数组，
        // dispose 时不终止的话会继续跑到底，还会把陈旧的进度文字写进 HUD。
        return new Promise(function (res, rej) {
          var w = makeWorker(); S.icWorker = w;
          function done() { if (S.icWorker === w) S.icWorker = null; try { w.terminate(); } catch (e) { /* ignore */ } }
          w.onmessage = function (ev) {
            if (S.disposed) { done(); return; }
            var m = ev.data;
            if (m.type === 'progress') setProgress(T('生成初始条件：') + TX(m.text));
            else if (m.type === 'ic') { done(); res(m); }
            else if (m.type === 'error') { done(); rej(new Error(m.message)); }
          };
          w.onerror = function (e) { if (S.disposed) { done(); return; } done(); rej(new Error('IC worker: ' + (e.message || e))); };
          setProgress(T('生成初始条件（') + S.np + T('³ 粒子，') + S.mesh + T('³ 网格）…'));
          w.postMessage({ type: 'ic', cosmo: cosmoPlain(), mesh: S.mesh, np: S.np, boxMpc: L, seed: seed, aIc: aIc });
        }).then(function (ic) {
          if (S.disposed || !S.backend) return;
          S.backend.upload(ic.pos, ic.vel);
          if (S.N <= 4200000) icCache = { pos: ic.pos, vel: ic.vel };
          S.ready = true; setProgress(''); label();
          scheduleAnalysis(true);
        });
      });
    }
    function initWebGL2() {
      var be = createWebGL2Backend(canvas, {});
      if (!be) return Promise.reject(new Error(T('WebGL2 不可用（') + (gl2FailReason || T('未知原因')) + T('）')));
      S.mode = 'webgl2'; S.tier = chooseTier('webgl2');
      var tier = TIERS.webgl2[S.tier];
      S.np = tier.np; S.mesh = tier.mesh; S.N = tier.np * tier.np * tier.np;
      S.backend = be; be.resize(W, H);
      return new Promise(function (res, rej) {
        var w = makeWorker(); S.worker = w;
        w.onmessage = function (ev) {
          var m = ev.data;
          if (m.type === 'progress') setProgress(T('生成初始条件：') + TX(m.text));
          else if (m.type === 'ready' || m.type === 'state') {
            var nowS = performance.now();
            if (S._wk && m.steps > S._wk.steps && S.running) { S.stepsPerSec = (m.steps - S._wk.steps) / Math.max(1e-3, (nowS - S._wk.t) / 1000); S.stepMs = 1000 / S.stepsPerSec; }
            S._wk = { steps: m.steps, t: nowS };
            S.a = m.a; S.ad = m.ad; S.t = m.t; S.steps = m.steps; S.accMax = m.accMax || 0;
            S.capClamped = m.cap ? m.cap.clamped : 0; S.lastDt = m.dt || 0;
            be.uploadState(m.pos, m.dens, m.N); be.uploadGrid(m.grid, m.mesh);
            S.cpuGrid8 = m.grid; S.cpuGridM = m.mesh;
            if (m.halos) onAnalysis({ halos: m.halos, minimap: m.minimap, Pk: m.Pk, sigma8: m.sigma8, a: m.a });
            if (m.type === 'ready') { S.ready = true; setProgress(''); label(); res(); }
          } else if (m.type === 'idle') { S.running = false; S.a = m.a; S.t = m.t; }
          else if (m.type === 'error') { console.warn('[universe3d/worker]', m.message); if (!S.ready) rej(new Error(m.message)); }
        };
        w.onerror = function (e) { if (!S.ready) rej(new Error('worker: ' + (e.message || e))); };
        setProgress(T('生成初始条件（') + S.np + T('³ 粒子，') + S.mesh + T('³ 网格）…'));
        // pexp / softCells 必须一起送进 Worker：CPU PM 的格林函数与自适应步长都按它们走（D=3 时 pexp=2、softCells=0，逐位同旧版）
        w.postMessage({ type: 'sim', cosmo: cosmoPlain(), mesh: S.mesh, np: S.np, boxMpc: L, seed: seed, aIc: aIc, dlnaMax: 0.05, dtMax: 0.02, aStop: S.aStop, haloOpts: haloOpts(), pexp: pexp, softCells: softCells, cfl: opts.cfl || 0.25, dtMin: dtMin, lowPower: !!S.lowPower });
      });
    }
    // WebGPU 半途失败时，把已经建出来的东西先收干净再回退：设备不 destroy 会一直挂着，
    // IC/分析 Worker 不 terminate 会继续在后台算一份没人要的初始条件。
    function cleanupWebGPU() {
      if (S.icWorker) { try { S.icWorker.terminate(); } catch (e) { /* ignore */ } S.icWorker = null; }
      if (S.anWorker) { try { S.anWorker.terminate(); } catch (e) { /* ignore */ } S.anWorker = null; }
      if (S.backend) { try { S.backend.dispose(); } catch (e) { /* ignore */ } S.backend = null; }
      S.mode = null; S.ready = false;
    }
    resize();
    var sup = isSupported();
    var initP;
    if (wantMode === 'webgl2') { setGpuReason('disabled-by-option', '', true); initP = initWebGL2(); }
    else if (!sup.webgpu) { setGpuReason(sup.gpuReason, '', true); initP = initWebGL2(); }
    else initP = initWebGPU().catch(function (err) {
      console.warn('[universe3d] WebGPU 初始化失败，回退 WebGL2：', err && err.message || err);
      setGpuReason('fallback-after-error', err && err.message || String(err));
      cleanupWebGPU();
      if (wantMode === 'webgpu' || S.disposed) throw err;
      return initWebGL2();
    });
    initP.then(function () {
      if (S.disposed) return;
      if (opts.autoStart !== false) api.start();
      // 进入宇宙先俯瞰整盒几秒，再落进盒内自由飞行（opts.introOverview:false 关闭）
      if (OV_INTRO > 0) { enterOverview(); S.introTimer = OV_INTRO; }
      syncButtons();
      readyResolve(api);
    }, function (err) { S.error = String(err && err.message || err); setProgress(T('初始化失败：') + S.error); readyReject(err); });

    /* ---------- 分析（晕 / 小地图 / P(k)）---------- */
    function onAnalysis(m) {
      if (m.halos) { S.halos = m.halos; S.haloRel = new Float32Array(8 * Math.max(1, S.halos.length)); }
      if (m.minimap) { S.minimap = m.minimap; S.minimapM = Math.round(Math.sqrt(m.minimap.length)); drawMinimap(); }
      if (m.Pk) { S.Pk = m.Pk; S.sigma8 = m.sigma8; }
      S.anPending = false; S.lastAn = performance.now();
      if (local && S.halos.length) pickLocalHost();   // 每次分析后重绑（晕表是新对象，见 pickLocalHost）
      S.an = { a: m.a, halos: S.halos.length };
    }
    var anCounter = 0;
    function scheduleAnalysis(force) {
      if (S.mode !== 'webgpu' || !S.backend) return;
      if (S.anPending) { if (force) S.anWanted = true; return; }
      var now = performance.now();
      if (!force && now - S.lastAn < 1400) return;
      S.anPending = true; S.anWanted = false; anCounter++;
      var wantPk = force || (anCounter % 3 === 0);
      S.backend.readDensity().then(function (grid) {
        if (S.disposed) return;
        // 始终保留一份主线程副本：densestCell / largeScaleLabel / envOf 都要读它。
        // 旧逻辑在 !wantPk 时写成 null，会把上一份网格抹掉——WebGPU 路径上"飞到最密处"间歇失败。
        S.cpuGridF32 = new Float32Array(grid);
        S.anWorker.postMessage({ type: 'analysis', grid: grid, mesh: S.mesh, boxMpc: L, N: S.N, haloOpts: haloOpts(), wantPk: wantPk, a: S.a }, [grid.buffer]);
      }, function (e) { S.anPending = false; console.warn('[universe3d] readDensity:', e); });
    }
    // 密度场最大的格点（盒坐标 + δ）：WebGL2 用 Worker 传来的 grid8（log2(1+ρ/ρ̄)·15.9375），WebGPU 用回读的 δ 网格。
    // u8 解码与 findHalos 一致：2^{u/15.9375}−2 = ρ/ρ̄−1 = δ（不是 −1）。
    // "飞到最密处"在没有晕时退回到它——任何宇宙都至少有一个最大格。
    function densestCell() {
      var M = 0, bi = -1, bv = -Infinity, i, delta = 0;
      if (S.cpuGrid8 && S.cpuGridM) {
        M = S.cpuGridM;
        for (i = 0; i < S.cpuGrid8.length; i++) if (S.cpuGrid8[i] > bv) { bv = S.cpuGrid8[i]; bi = i; }
        delta = Math.pow(2, bv / 15.9375) - 2;
      } else if (S.cpuGridF32 && S.mesh) {
        M = S.mesh;
        for (i = 0; i < S.cpuGridF32.length; i++) if (S.cpuGridF32[i] > bv) { bv = S.cpuGridF32[i]; bi = i; }
        delta = bv;
      }
      if (bi < 0 || !M) return null;
      var x = bi % M, y = ((bi / M) | 0) % M, z = (bi / (M * M)) | 0;
      return { x: (x + 0.5) / M, y: (y + 0.5) / M, z: (z + 0.5) / M, delta: delta, mesh: M };
    }
    function drawMinimap() {
      if (!els.miniCtx || !S.minimap) return;
      var M = S.minimapM, c = els.miniCtx, img = c.createImageData(M, M), d = img.data;
      for (var y = 0; y < M; y++) for (var x = 0; x < M; x++) { var v = S.minimap[x + M * y], o = 4 * (x + M * (M - 1 - y)); var t = Math.pow(v, 1.4); d[o] = 30 + 225 * t; d[o + 1] = 40 + 200 * Math.pow(t, 1.3); d[o + 2] = 90 + 165 * Math.pow(t, 0.7); d[o + 3] = 255; }
      var tmp = document.createElement('canvas'); tmp.width = M; tmp.height = M; tmp.getContext('2d').putImageData(img, 0, 0);
      S.miniImg = tmp;
    }
    function paintMinimap() {
      if (!els.miniCtx) return;
      var c = els.miniCtx, Wm = 132;
      c.fillStyle = '#04060c'; c.fillRect(0, 0, Wm, Wm);
      if (S.miniImg) { c.imageSmoothingEnabled = true; c.drawImage(S.miniImg, 0, 0, Wm, Wm); }
      // 晕
      c.fillStyle = 'rgba(160,220,255,0.55)';
      for (var i = 0; i < Math.min(S.halos.length, 60); i++) { var h = S.halos[i]; c.fillRect(h.x * Wm - 1, (1 - h.y) * Wm - 1, 2, 2); }
      // 相机
      var px = cam.pos[0] * Wm, py = (1 - cam.pos[1]) * Wm;
      c.strokeStyle = '#ffd28a'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(cam.yaw) * 14, py - Math.sin(cam.yaw) * 14); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(px, py, 2.5, 0, TAU); c.fill();
      c.fillStyle = '#7c8299'; c.font = '9px Consolas,monospace'; c.fillText(T('俯视 xy · z=') + cam.pos[2].toFixed(2), 4, 10);
    }
    function pickLocalHost() {
      // 数据层：选离盒中心最近、质量与银河系位力质量同量级的晕作为宿主（M_vir = 1.3×10¹² M⊙，BHG 2016，取 ÷4 ~ ×4 窗口）；找不到就取最近的
      var LD = localData(), mwM = LD && LD.mw && LD.mw.mass_Msun > 0 ? LD.mw.mass_Msun : null;
      var mLo = mwM ? mwM / 4 : 2e11, mHi = mwM ? mwM * 4 : 8e12;
      // 每次分析都会重建晕表（id 由格点算出，会随晕移动而变）：先把宿主重新绑定到离上次位置最近的晕，别让"银河系宿主"跳走
      var prev = S.localHost;
      if (prev) {
        var keep = null, kd = Infinity;
        S.halos.forEach(function (h) { var d = minImageDist([h.x, h.y, h.z], [prev.x, prev.y, prev.z]); if (d < kd) { kd = d; keep = h; } });
        if (keep && kd < 3 / Math.max(1, S.mesh)) { S.localHost = keep; keep.isLocalHost = true; return; }
      }
      var best = null, bd = Infinity;
      S.halos.forEach(function (h) { var dx = h.x - 0.5, dy = h.y - 0.5, dz = h.z - 0.5, d = dx * dx + dy * dy + dz * dz; if (h.mass > mLo && h.mass < mHi && d < bd) { bd = d; best = h; } });
      if (!best) {   // 网格分辨不出银河系质量的晕：取离盒心最近的 12 个里最轻的
        var near = S.halos.map(function (h) { var dx = h.x - 0.5, dy = h.y - 0.5, dz = h.z - 0.5; return { h: h, d: dx * dx + dy * dy + dz * dz }; }).sort(function (p, q) { return p.d - q.d; }).slice(0, 12);
        near.sort(function (p, q) { return p.h.mass - q.h.mass; }); best = near.length ? near[0].h : null;
      }
      S.localHost = best;
      if (S.localHost) S.localHost.isLocalHost = true;
    }

    /* ---------- 时间推进（WebGPU 在主线程节流提交；WebGL2 由 Worker 自跑）---------- */
    var inflight = 0, batch = 2, stepClock = { t: 0, n: 0 };
    function simTargetsReached() {
      var st = S.backend && S.backend.st;
      if (!st) return true;
      if (st.t + t0H0 >= S.targetT / cosmo.TH) return true;
      if (st.a >= S.targetA) return true;
      if (st.a >= S.aStop) return true;
      if (st.ad < 0 && st.a <= aIc * 1.05) return true;   // 已坍缩回起点
      return false;
    }
    // 每帧提交一批步；批大小按帧时间自适应（GPU 饱和 → 帧变慢 → 减批），最多 3 批在飞（onSubmittedWorkDone 只作背压，不作节拍：
    // 某些环境里它的回调延迟 >100ms，与 GPU 实际耗时无关）
    // D≠3：按 GPU 上的最大力自适应缩小步长（异步回读，250 ms 一次；回读到之前先用保守的 dtMax/4）
    var gpuAcc = { at: 0, pending: false };
    function refreshAccelGPU() {
      if (S.disposed || pexp === 2 || !S.backend || !S.backend.maxForce) return;
      var now = performance.now();
      if (gpuAcc.pending || now - gpuAcc.at < 250) return;
      var p = S.backend.maxForce();
      if (!p) return;
      gpuAcc.pending = true; gpuAcc.at = now;
      // mapAsync 的回调可能在 dispose 之后才跑到：那时 S.backend 已经是 null，
      // 直接读 S.backend.st.a 会在 Promise 里抛 TypeError（未捕获的 rejection），这里先检查。
      p.then(function (fm) {
        gpuAcc.pending = false;
        if (S.disposed || !S.backend || !S.backend.st) return;
        S.accMax = 1.5 * cosmo.OmM / Math.max(S.backend.st.a, 1e-6) * fm;
      }, function () { gpuAcc.pending = false; });
    }
    function cflLimit(a) {   // Δx ≈ accel·dt²/a² ≤ frac 个网格 → dt ≤ a·√(frac/(M·accel))；不低于 dtMin
      if (!(S.accMax > 0)) return Math.max((opts.dtMax || 0.02) * 0.25, dtMin);
      return Math.max(a * Math.sqrt(Math.max(opts.cfl || 0.25, 1e-3) / (S.mesh * S.accMax)), dtMin);
    }
    function tickGPU(frameDt) {
      if (!S.running || !S.ready) return;
      if (simTargetsReached()) { S.running = false; scheduleAnalysis(true); return; }
      if (inflight >= 3) return;
      if (frameDt > 0.034 && batch > 1) batch--; else if (frameDt < 0.015 && batch < 24) batch++;
      if (S.lowPower && batch > 2) batch = 2;   // 低功耗：每帧最多提交 2 步
      if (pexp !== 2) refreshAccelGPU();
      var st = S.backend.st, n = 0;
      while (n < batch && !simTargetsReached()) {
        var dt = K.suggestDt(cosmo, st, opts.dlnaMax || 0.03, opts.dtMax || 0.02);
        if (pexp !== 2) dt = Math.max(1e-7, Math.min(dt, cflLimit(st.a)));
        var tTarget = S.targetT / cosmo.TH - t0H0; if (st.t + dt > tTarget) dt = Math.max(1e-7, tTarget - st.t);
        S.backend.step(dt); S.lastDt = dt; n++;   // HUD 的「≈N 年/秒」= lastDt·T_H·1e9·步/秒；不记就永远显示 0
      }
      S.a = st.a; S.ad = st.ad; S.t = st.t; S.steps = st.steps;
      var now = performance.now();
      if (!stepClock.t) { stepClock.t = now; stepClock.n = 0; }
      stepClock.n += n;
      if (now - stepClock.t > 1000) { S.stepsPerSec = stepClock.n / ((now - stepClock.t) / 1000); S.stepMs = 1000 / Math.max(S.stepsPerSec, 1e-6); stepClock.t = now; stepClock.n = 0; }
      inflight++;
      S.backend.device.queue.onSubmittedWorkDone().then(function () { inflight--; }, function () { inflight--; });
    }
    function tickWorker() { /* Worker 自行推进；状态在 onmessage 里更新 */ }

    /* ---------- LOD 2：晕接近 → 过程星系 ---------- */
    function ensureGalaxy(halo) {
      if (!hasStars) return;   // 无恒星的宇宙：不生成任何星系点云（画面里就是 PM 粒子聚成的物质团块）
      if (S.galaxy && S.galHalo && S.galHalo.id === halo.id) return;
      // 同一晕在网格里移动一格会换 id：若新晕离旧锚点 < 1.5 格，沿用旧星系（只挪锚点）
      if (S.galaxy && S.galAnchor) { var d = minImageDist(S.galAnchor, [halo.x, halo.y, halo.z]); if (d < 1.5 / S.mesh) { S.galHalo = halo; S.galAnchor = [halo.x, halo.y, halo.z]; return; } }
      /* 冷却：generateGalaxy(15 万星) 实测 47～77 ms（快机器），而它是在 updateLOD() → frame() 里**同步**跑的。
       * 在纤维/团核心里飞的时候最近晕一帧一换，不加闸就是每帧都卡这么久——这正是「飞起来就卡住」的来源。
       * 这里只限制「重新生成」的频率：没到点就沿用上一个星系点云（画面里是旧那团，下一次就换过来），
       * 不改任何生成结果——同一个 halo.id 生成出来的星系与改动前逐位相同。 */
      var tNow = (typeof performance === 'object' && performance.now) ? performance.now() : Date.now();
      if (S.galaxy && S.galAt && tNow - S.galAt < GAL_COOLDOWN_MS) return;
      var gseed = hashMix(seed, halo.id);
      var isHost = local && S.localHost && S.localHost.id === halo.id;
      var LD = isHost ? localData() : null, mw = LD && LD.mw;
      // 宿主（银河系）：盘标长与恒星质量用观测值（BHG 2016，经 MirrorLocalData），使太阳的 8.178 kpc 正好落在盘里；点云本身仍是示意
      var gal = generateGalaxy(isHost ? hashMix(seed, 0x4D57) : gseed, halo, { nStars: starBudget(), type: isHost ? 'spiral' : undefined, env: envOf(halo),
        RdKpc: mw && mw.diskScaleLength_kpc > 0 ? mw.diskScaleLength_kpc : 0, mStar: mw && mw.stellarMass_Msun > 0 ? mw.stellarMass_Msun : 0 });
      if (isHost) gal = attachLocalLayer(gal);
      S.galaxy = gal; S.galHalo = halo; S.galAnchor = [halo.x, halo.y, halo.z]; S.starSel = -1;
      S.galAt = (typeof performance === 'object' && performance.now) ? performance.now() : Date.now();
      S.backend.setStars(gal.data, gal.count);
      onStatus(T('进入晕：') + TX(gal.typeName) + T('（示意）'), api.getState());
    }
    /* 星系点云的点数预算。上限仍是原来的 S.starsPerGalaxy（15 万），能跑得动的机器逐位不变；
     * 只有「低功耗档 / 低粒子档 / 实测帧率确实掉下来了」时才往下降——点云本身标的就是「示意」，
     * 点数是渲染预算不是物理量，降它不改任何数值口径，只是团里的星点稀一些。 */
    var GAL_COOLDOWN_MS = 300;
    function starBudget() {
      var n = S.starsPerGalaxy;
      if (S.lowPower) n = Math.min(n, 30000);
      else if (S.tier === 'tiny') n = Math.min(n, 30000);
      else if (S.tier === 'low') n = Math.min(n, 60000);
      if (S.fps > 0 && S.fps < 30) n = Math.min(n, 30000);          // 已经卡了：别再往里灌
      else if (S.fps > 0 && S.fps < 45) n = Math.min(n, 60000);
      return Math.max(8000, Math.round(n));
    }
    function minImageDist(a, b) { var d = 0; for (var i = 0; i < 3; i++) { var x = a[i] - b[i]; x -= Math.round(x); d += x * x; } return Math.sqrt(d); }
    // 环境密度（0 空旷 … 1 团核心）：5 Mpc/h 内的晕数 + 该处的网格 δ —— 形态–密度关系（Dressler 1980）的输入
    function envOf(halo) {
      var R = 5 / Math.max(L, 1), nNear = 0, i;
      for (i = 0; i < S.halos.length; i++) { if (S.halos[i] === halo) continue; if (minImageDist([S.halos[i].x, S.halos[i].y, S.halos[i].z], [halo.x, halo.y, halo.z]) < R) nNear++; }
      var e = clamp(nNear / 8, 0, 1);
      if (S.cpuGrid8 && S.cpuGridM) {
        var M = S.cpuGridM, xi = clamp(Math.floor(halo.x * M), 0, M - 1), yi = clamp(Math.floor(halo.y * M), 0, M - 1), zi = clamp(Math.floor(halo.z * M), 0, M - 1);
        var d8 = S.cpuGrid8[xi + M * (yi + M * zi)], dlt = Math.pow(2, d8 / 15.9375) - 2;
        e = clamp(e * 0.6 + clamp(Math.log10(1 + Math.max(dlt, 0)) / 2.2, 0, 1) * 0.4, 0, 1);
      }
      return e;
    }
    // 大尺度环境标签（空洞 / 纤维 / 节点·超星系团）：按相机所在格的 δ 判定，示意性命名
    function largeScaleLabel() {
      var M = 0, g = null;
      if (S.cpuGrid8 && S.cpuGridM) { M = S.cpuGridM; g = S.cpuGrid8; }
      else if (S.cpuGridF32 && S.mesh) { M = S.mesh; g = S.cpuGridF32; }
      if (!g || !M) return '';
      var xi = clamp(Math.floor(cam.pos[0] * M), 0, M - 1), yi = clamp(Math.floor(cam.pos[1] * M), 0, M - 1), zi = clamp(Math.floor(cam.pos[2] * M), 0, M - 1);
      var v = g[xi + M * (yi + M * zi)], dlt = g === S.cpuGrid8 ? Math.pow(2, v / 15.9375) - 2 : v;
      var noun = hasStars ? '' : T('（物质分布）');
      if (dlt < -0.55) return T('空洞') + noun;
      if (dlt < 0.5) return T('低密度区') + noun;
      if (dlt < 6) return T('纤维/墙') + noun;
      return (hasStars ? T('节点：星系团/超星系团尺度') : T('节点：物质团块密集区'));
    }
    function updateLOD() {
      // 最近的晕
      var best = null, bd = Infinity;
      for (var i = 0; i < S.halos.length; i++) { var h = S.halos[i]; var d = minImageDist(cam.pos, [h.x, h.y, h.z]); if (d < bd) { bd = d; best = h; } }
      S.nearHalo = best; S.nearDist = bd;
      var cell = 1 / Math.max(1, S.mesh);
      // 滞回：已在某个晕的星系里时，只要还没离开它的 1.6×进入半径就不切换（避免相邻双峰来回跳）
      if (S.lod === 2 && S.galHalo && S.galAnchor) {
        var dCur = minImageDist(cam.pos, S.galAnchor), keepR = Math.max(3 * S.galHalo.r, 1.2 * cell) * 1.6;
        if (dCur < keepR) { S.nearHalo = S.galHalo; S.nearDist = dCur; best = null; }
      }
      if (best) {
        var enterR = Math.max(3 * best.r, 1.2 * cell);
        // 无恒星的宇宙：不进 LOD2（没有星系层），只记"是否已经在团块里"，画面仍是模拟出来的粒子
        if (!hasStars) { S.inClump = bd < enterR * 1.6; S.clumpHalo = S.inClump ? best : null; }
        else if (bd < enterR) { if (!S.flyAnim || S.flyAnim.halo === best) { ensureGalaxy(best); S.lod = 2; } }   // 飞行动画途中路过别的晕不生成星系
        else if (S.lod === 2 && bd > enterR * 1.6) { S.lod = 1; }
      } else if (!(S.lod === 2 && S.galHalo)) { S.lod = 1; if (!hasStars) { S.inClump = false; S.clumpHalo = null; } }
      // 星系尺度：相机是否在星系半径 4 倍内（决定提示文案）
      if (S.lod === 2 && S.galaxy) {
        var gr = S.galaxy.radiusKpc * kpcToBox, dg = minImageDist(cam.pos, S.galAnchor);
        S.inGalaxy = dg < gr * 6;
      } else S.inGalaxy = false;
    }

    /* ---------- 俯瞰全盒（O）----------
     * 相机拉到盒外 ovR 倍盒长、仰角 30° 俯视整盒，缓慢环绕；渲染时关掉"最近像包裹"（tiles=0），
     * 否则粒子永远被卷到相机周围，从盒外看到的还是"盒内"。盒子线框由覆盖层的 2D canvas 投影画出。 */
    var ovSaved = null;
    function overviewPose() {
      var el = OV_ELEV, R = OV_DIST, az = S.ovAz;
      var ce = Math.cos(el), se = Math.sin(el);
      cam.pos = [0.5 + R * ce * Math.cos(az), 0.5 + R * ce * Math.sin(az), 0.5 + R * se];
      cam.yaw = az + PI; cam.pitch = -el; basis();
    }
    function enterOverview() {
      if (S.overview) return;
      ovSaved = { pos: cam.pos.slice(), yaw: cam.yaw, pitch: cam.pitch, speed: cam.speed, fov: cam.fov, volume: S.volume, lod: S.lod };
      S.overview = true; S.flyAnim = null; S.introTimer = 0;
      S.ovAz = S.ovAz || (cam.yaw + PI);
      cam.fov = 55 * PI / 180; cam.speed = 0.05;
      overviewPose();
      if (!S.volume) { S.volume = true; S.volAuto = true; }   // 俯瞰默认开低强度体渲染，让纤维/空洞在全貌里可辨
      syncButtons();
      onStatus(T('俯瞰全盒：整盒 ') + L + T(' Mpc/h · 自动环绕') + T(S.ovOrbit ? '开' : '关') + T(' · 再按 O 或 WASD 回到自由飞行'), api.getState());
    }
    function exitOverview(keepPose) {
      if (!S.overview) return;
      S.overview = false; S.introTimer = 0;
      if (S.volAuto) { S.volume = false; S.volAuto = false; }
      if (ovSaved && !keepPose) { cam.pos = ovSaved.pos.slice(); cam.yaw = ovSaved.yaw; cam.pitch = ovSaved.pitch; cam.speed = ovSaved.speed; cam.fov = ovSaved.fov; basis(); }
      else { wrapCam(); }   // 从俯瞰直接"落进"盒子：位置取模回到盒内，朝向不变
      ovSaved = null;
      syncButtons();
    }
    /* ---------- 相机运动 ---------- */
    function moveCamera(dt) {
      applyWheel();   // 滚轮：每帧只应用一次累积量
      if (S.overview) {
        var moved = cam.keys.w || cam.keys.a || cam.keys.s || cam.keys.d || cam.keys.q || cam.keys.e;
        if (moved) { exitOverview(true); }          // 任意 WASD/QE：落回盒内自由飞行
        else {
          if (S.ovOrbit) { S.ovAz += dt * OV_ORBIT; if (S.ovAz > TAU) S.ovAz -= TAU; }
          overviewPose();
          S.effSpeed = 0;
          if (S.introTimer > 0) { S.introTimer -= dt; if (S.introTimer <= 0) exitOverview(false); }
          return;
        }
      }
      var sp = cam.speed * (cam.keys.shift ? 5 : 1) * (cam.keys.ctrl ? 0.2 : 1);
      // 自动刹车：靠近晕/星系时限速（用户仍可滚轮拉高）
      if (S.autoBrake && S.nearHalo) { var lim = Math.max(S.nearDist * 0.9, 1e-8); if (S.lod === 2 && S.galAnchor) { var dg = minImageDist(cam.pos, S.galAnchor); lim = Math.max(dg * 0.9, S.galaxy ? S.galaxy.radiusKpc * kpcToBox * 0.02 : 1e-8); } sp = Math.min(sp, Math.max(lim, cam.speed * 0.02)); }
      var v = [0, 0, 0], k = cam.keys;
      function add(vec, s) { v[0] += vec[0] * s; v[1] += vec[1] * s; v[2] += vec[2] * s; }
      if (k.w) add(cam.fwd, 1); if (k.s) add(cam.fwd, -1); if (k.d) add(cam.right, 1); if (k.a) add(cam.right, -1); if (k.e) add(cam.up, 1); if (k.q) add(cam.up, -1);
      var l = len3(v);
      if (l > 0) { S.flyAnim = null; for (var i = 0; i < 3; i++) cam.pos[i] += v[i] / l * sp * dt; }
      if (S.flyAnim) {
        var f = S.flyAnim, k2 = 1 - Math.exp(-dt * 2.2);
        for (i = 0; i < 3; i++) { var d = f.pos[i] - cam.pos[i]; d -= Math.round(d); cam.pos[i] += d * k2; }
        var dy = f.yaw - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); cam.yaw += dy * k2; cam.pitch += (f.pitch - cam.pitch) * k2; basis();
        if (minImageDist(cam.pos, f.pos) < 1e-6 + f.tol && Math.abs(dy) < 0.01) S.flyAnim = null;
      }
      wrapCam();
      S.effSpeed = sp;
    }

    /* ---------- 渲染视图参数 ---------- */
    function viewParams(now) {
      var fy = 1 / Math.tan(cam.fov / 2), aspect = W / H, fx = fy / aspect;
      var baseLum = 1.5 * Math.pow(2097152 / Math.max(S.N, 1), 0.6) * Math.pow(2, S.exposureEV);
      var sizeW = 0.22 / Math.max(1, S.np);
      var v = {
        cam: cam.pos, right: cam.right, up: cam.up, fwd: cam.fwd, fx: fx, fy: fy, aspect: aspect, viewH: H,
        exposure: baseLum, sizeW: sizeW, minPx: 0.8 * dpr, maxPx: dpr * clamp(9 * S.np / 128, 4.5, 9), fogR: S.tiling ? 1.45 : 0.49, tiles: S.tiling ? 27 : 1, colorMode: S.colorMode, time: now / 1000, a: S.a,
        showParticles: S.showParticles, halosOn: S.labels && S.halos.length > 0, haloCenter: [0, 0, 0], selHalo: -1, stars: null, volume: null, nearFade: 0
      };
      // 俯瞰：绝对坐标（tiles=0）、不按距离雾化、点略大一点，让整盒的密度起伏成形
      if (S.overview) { v.tiles = 0; v.fogR = 1e9; v.sizeW = sizeW * 1.6; v.minPx = 0.9 * dpr; }
      // 无恒星宇宙里贴近物质团块：把点稍微放大，密度梯度读得出来（颜色仍按密度，不用恒星色温）
      if (!hasStars && S.inClump && !S.overview) { v.sizeW = sizeW * 1.5; v.minPx = 1.0 * dpr; }
      // 初始条件渐入：a < 0.05 时点云还几乎停在 Zel'dovich 位移后的格点上（看着像一张直线网格），按 a 淡入
      var icF = clamp((S.a - aIc) / Math.max(0.05 - aIc, 1e-6), 0, 1);
      if (icF < 1) v.exposure *= 0.12 + 0.88 * icF * icF;
      if (S.autoExposure) v.exposure *= S.autoGain;   // 自动曝光（按屏幕亮度直方图归一，见 autoExpose()）
      // 星系尺度：把贴脸的 PM 粒子（~10¹⁰ M⊙ 的质量元）淡出，避免糊成大团
      if (S.lod === 2 && S.galaxy && S.inGalaxy) { var gR = S.galaxy.radiusKpc * kpcToBox, dgc = minImageDist(cam.pos, S.galAnchor); v.nearFade = gR * (20 + 120 * clamp(1 - dgc / (6 * gR), 0, 1)); var dimF = clamp(dgc / (6 * gR), 0.12, 1); v.exposure *= dimF * dimF; }   // 星系内：远处宇宙网整体压暗（面亮度远低于身边的恒星）
      // 体渲染：俯瞰时低强度 + 裁到盒内（射线从盒外进来，要跨过整盒），自由飞行时保持原来的近距离高增益
      if (S.volume) v.volume = S.overview
        // 注意：体渲染的增益要跟着自动曝光一路缩下去（不能设下限，否则自动曝光越压越暗、体渲染却卡在削顶，
        // 两层互相打架，整盒糊成一片白）
        ? { steps: S.mode === 'webgpu' ? 128 : 96, gain: 0.18 * Math.pow(2, S.exposureEV) * (S.autoExposure ? Math.min(S.autoGain, 8) : 1), dist: 2 * OV_DIST + 1.8, clip: 1 }
        : { steps: S.mode === 'webgpu' ? 112 : 72, gain: 4 * Math.pow(2, S.exposureEV), dist: 0.5, clip: 0 };
      // 晕环：相对位置（最近像）
      if (v.halosOn) {
        // 只给最近的 14 个晕画环（全画会糊满屏）；环半径 ≈ 1.6 r₂₀₀
        var cand = [];
        for (var i = 0; i < S.halos.length; i++) { var h = S.halos[i], r = minImage([h.x, h.y, h.z]); cand.push({ h: h, r: r, d: len3(r) }); }
        cand.sort(function (p, q) { return p.d - q.d; });
        var arr = S.haloRel, n = Math.min(cand.length, 14);
        for (i = 0; i < n; i++) { var it = cand[i], hh = it.h, rr = it.r, o = 8 * i; if (S.inGalaxy && hh === S.galHalo) { rr = [-cam.fwd[0], -cam.fwd[1], -cam.fwd[2]]; } arr[o] = rr[0]; arr[o + 1] = rr[1]; arr[o + 2] = rr[2]; arr[o + 3] = Math.max(hh.r * 1.6, 0.4 / S.mesh); arr[o + 4] = 0.55; arr[o + 5] = 0.85; arr[o + 6] = 1.0; arr[o + 7] = 1; if (hh === S.nearHalo) v.selHalo = i; }
        S.backend.setHalos(arr, n);
      }
      if (S.lod === 2 && S.galaxy) {
        var c = minImage(S.galAnchor), dist = Math.max(len3(c), 1e-9);
        // 按角尺寸决定绘制的恒星数（前缀 = 均匀子样本），亮度按比例补偿：远处几千颗即可，避免同一像素堆叠几十万次
        var rPx = S.galaxy.radiusKpc * kpcToBox * fy * (H / 2) / dist;
        var frac = clamp(rPx / 420, 0.02, 1); frac *= frac;
        var nDraw = clamp(Math.round(S.galaxy.count * frac), Math.min(4000 + (S.galaxy.dataCount || 0), S.galaxy.count), S.galaxy.count);
        v.stars = { center: c, scale: kpcToBox, minPx: 1.0 * dpr, maxPx: 24 * dpr, exposure: 22 * Math.pow(2, S.exposureEV) * (150000 / Math.max(S.galaxy.count, 1)) * (S.galaxy.count / nDraw), sel: S.starSel, count: nDraw };
        S.starsDrawn = nDraw;
      }
      return v;
    }

    /* ---------- 自动曝光 ----------
     * 渲染完一帧后回读画面中央一小块，按亮度直方图的第 99 百分位把点云曝光归一到 AE_TARGET。
     * 低 σ₈ / 低维宇宙的密度起伏本来就暗，固定曝光会看不见；这里让"最亮的那 1% 像素"的线性亮度接近 0.8。
     * 手动 +/−（或 setExposure）只关掉"调增益"，回读照做（过曝读数要说实话）。
     * 两个后端都能回读（WebGL2 = readPixels；WebGPU = compute 直方图 + 异步映射）。
     *
     * 旧版把第 99 百分位死盯到 0.8：在 σ₈≫1 / 高维（用户实测 D=7.70，引力 ∝ r^{−6.7}）的宇宙里，
     * 物质塌成几十个孤立超密团块，p99 本身就落在团块内部——每个团块整体削平成纯白，没有内部结构、
     * 没有边缘衰减。现在目标跟着直方图形状走：亮像素的 p99.9/p50（还原到线性 HDR 之后）越大 = 分布越尖，
     * 目标压得越低；再加一条硬约束——削顶（≥250）的亮像素必须 < 0.5%。
     * 两条规则的不动点是"刚好不削顶的最亮画面"。
     *
     * 硬约束写成"亮像素的第 99.5 百分位 ≤ AE_CLIP_Q"，而不是直接对削顶比例做开关：
     * 「p99.5(亮) ≤ 0.972 < 250/255」按定义就蕴含「≥250 的亮像素 < 0.5%」，而且它是增益的连续单调函数——
     * 与 p99 那条取 min 之后不动点唯一。开关式的比例反馈会在预算边界上来回跳（画面一亮一暗地抽）。
     *
     * 主控这条盯的是**色调映射之前**的线性累积值（把回读到的显示值用 toneInv 还原）：曝光的职责是把
     * 场景归一，曲线只是显示变换。这样 D=3 的正常画面里"p99 的线性亮度 = 0.8"与改动前逐字相同，
     * 不会因为加了一条肩部就整体被推亮几个百分点。 */
    var AE_TARGET = 0.8, AE_CLIP_BUDGET = 0.005, AE_CLIP_Q = 0.972, AE_PEAK0 = 30;
    function autoExpose(now) {
      // 手动曝光时也照常回读：过曝读数（"过曝 0.3%"）必须反映当前这一帧，否则手动调亮之后
      // 数字还停在最后一次自动曝光的值上——那正是最需要它说实话的时候。只是不再改增益。
      if (!S.ready || !S.backend || typeof S.backend.sampleLuma !== 'function') return;
      // WebGPU 的回读是异步的（不阻塞主线程），可以取得勤一些；WebGL2 的 readPixels 要同步等 GPU，维持 450ms
      if (now - S.lastLuma < (S.mode === 'webgpu' ? 120 : 450)) return;
      S.lastLuma = now;
      var raw = S.backend.sampleLuma();
      if (!raw) return;
      var s = raw.hist ? histStats(raw.hist, raw.px) : raw;
      if (!s) return;
      S.lumaP99 = s.p99; S.lumaClip = s.clipLit; S.lumaPeak = s.peak; S.lumaLit = s.litFrac; S.lumaMean = s.mean; S.lumaP995Lit = s.p995Lit;
      if (!S.autoExposure) return;                                    // 只测量、不调增益
      var T = AE_TARGET * clamp(Math.pow(AE_PEAK0 / Math.max(s.peak, AE_PEAK0), 0.22), 0.45, 1);
      S.lumaTarget = T;
      var pLin = toneInv(Math.min(s.p99, 254 / 255));                               // 还原成线性累积值
      var mul = (s.p99 <= 0.004 && !s.clipLit) ? 2.0 : T / Math.max(pLin, 1e-4);    // 几乎全黑时快速提亮
      mul = Math.min(mul, AE_CLIP_Q / Math.max(s.p995Lit, 1e-4));                   // 削顶约束（连续、单调）
      S.autoGain = clamp(S.autoGain * clamp(mul, 0.25, 1.9), 1 / 4096, 8192);
    }

    // 模拟推进速度：每现实秒推进多少年（状态行/宿主 UI 用来解释"左下角的计时为什么一直在涨"）
    function yearsPerSecond() {
      if (!S.running || !(S.stepsPerSec > 0) || !(S.lastDt > 0)) return 0;
      return S.lastDt * cosmo.TH * 1e9 * S.stepsPerSec;
    }
    function fmtYears(y) {
      if (!(y > 0)) return '0';
      if (y >= 1e8) return TX((y / 1e8).toFixed(1) + ' 亿年');
      if (y >= 1e4) return TX((y / 1e4).toFixed(0) + ' 万年');
      return TX(Math.round(y) + ' 年');
    }
    // CPU（WebGL2 + Worker）路径上主线程掉到 40 fps 以下：自动给 Worker 降频（缩短每轮 burst），
    // 让出主线程给渲染与交互；回到 50 fps 以上再恢复。滞回避免来回抖。
    function autoThrottle() {
      if (S.mode !== 'webgl2' || !S.worker || S.lowPower) return;
      var slow = S.slowMain ? S.fps < 50 : S.fps < 40;
      if (slow === !!S.slowMain) return;
      S.slowMain = slow;
      try { S.worker.postMessage({ type: 'power', lowPower: slow }); } catch (e) { /* ignore */ }
      // 建议要说对：走 CPU 的原因是分类过的（file:// / 没有适配器 / 被 force 关掉…），别一律甩"用 https 打开"
      if (slow) { var gi = gpuInfo(); onStatus(T('CPU 路径较慢：已自动给物理降频。') + T(gi.gpuLabel) + T('。') + T(gi.gpuAdvice || '也可以把粒子档位调低'), api.getState()); }
    }
    // 结构极弱：跑过一段时间了却还没有晕、σ₈(测) 也很小
    function weakStructure() { return S.ready && S.halos.length === 0 && S.a > 0.25 && (S.sigma8 == null || S.sigma8 < 0.35); }
    /* 过曝读数：削顶（各通道 ≥250）的亮像素占比。看得见地告诉用户"这块白是真的白，还是曝过了"——
     * 自动曝光把它压在 0.5% 以内，压不下去（手动曝光 / 直方图极端）时这行数字就是唯一的线索。 */
    /* ---------- CPU 物理告警 / WebGPU 诊断 ----------
     * 走 WebGL2 时物理在 Worker 里用 CPU 算（512,000 粒子只能到 ~30 fps）。用户机器有独显却掉到这条路上，
     * 必须把"为什么没用上 WebGPU"直说，并给一条能照着做的建议——而不是一句"WebGL2 模式"。 */
    function backendKind() { return S.mode === 'webgpu' ? 'webgpu' : (S.mode === 'webgl2' ? (S.worker ? 'webgl2-worker' : 'webgl2-main') : null); }
    function gpuInfo() {
      var r = S.gpuReason || (S.mode === 'webgpu' ? 'ok' : probeGpuReason());
      var o = gpuReasonOf(r);
      if (S.gpuDetail) o.gpuDetail = S.gpuDetail;
      return o;
    }
    // 画布的上下文类型是一次性的：这块 <canvas> 走过 getContext('webgl2') 之后就再也拿不到 'webgpu'，
    // 所以"重试"只能重新探一次适配器；真要切过去必须由宿主重建实例（onRetryGpu 回调 / 用户重新引爆）。
    function updateWarn() {
      if (!els.warn) return;
      var show = S.mode === 'webgl2' && !S.disposed;
      els.warn.hidden = !show;
      if (ov) ov.className = ov.className.replace(/\s*has-warn/, '') + (show ? ' has-warn' : '');
      if (!show) return;
      var g = gpuInfo();
      var head = T('⚠ 正在用 CPU 计算（') + fmtBig(S.N) + T(' 粒子 · ') + Math.round(S.fps) + T(' fps）：');
      var body = S.gpuRetryMsg || (T(g.gpuLabel) + (g.gpuDetail ? T('（') + g.gpuDetail + T('）') : '') + T('。') + T(g.gpuAdvice));
      if (els.warnTxt) els.warnTxt.innerHTML = '<b>' + head + '</b>' + body.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
      if (els.warnBtn) { els.warnBtn.disabled = !!S.gpuRetrying; els.warnBtn.textContent = S.gpuRetrying ? T('检测中…') : T('重试 WebGPU'); }
    }
    function clipTxt() {
      var c = S.lumaClip;
      if (!(c > 0.0005)) return '';
      return T(' · 过曝 ') + (c >= 0.1 ? (c * 100).toFixed(0) : (c * 100).toFixed(1)) + '%' + (c > AE_CLIP_BUDGET * 2 && !S.autoExposure ? T('（按 − 调暗，或点右侧"曝光 手动"按钮交回自动）') : '');
    }

    /* ---------- 覆盖层刷新 ---------- */
    var uiTick = 0;
    function updateOverlay(now) {
      if (!ov) return;
      uiTick++;
      if (uiTick % 6 === 0) {
        var st = api.getState();
        updateWarn();
        S.envLabel = largeScaleLabel();
        // 说清楚"左下角的年份为什么一直在涨"：这是实时演化，不是倒计时
        var yps = yearsPerSecond();
        var run = S.running ? (T('▶ 实时演化 · 每秒 ≈ ') + fmtYears(yps) + T('（空格暂停）')) : T('⏸ 已暂停 · 空格继续');
        els.st1.textContent = 'a=' + S.a.toFixed(4) + '  z=' + (1 / S.a - 1).toFixed(2) + '  t=' + fmtGyr(st.t) + (S.ad < 0 ? T('（收缩中）') : '') + '  ' + run + '  fps ' + S.fps.toFixed(0) + (S.stepMs ? '  step ' + S.stepMs.toFixed(1) + 'ms' : '');
        els.st1.className = 'ln ln1' + (S.running ? '' : ' pz');
        var expTot = (S.autoExposure ? S.autoGain : 1) * Math.pow(2, S.exposureEV);
        els.st2.textContent = (S.overview ? T('俯瞰全盒（O 退出 · 环绕 ') + T(S.ovOrbit ? '开' : '关') + T('）  ') : '') +
          T('曝光 ×') + (expTot >= 100 ? expTot.toFixed(0) : expTot.toFixed(2)) + T(S.autoExposure ? '（自动）' : '（手动）') + clipTxt() + '  ' +
          (S.slowMain ? T('CPU 物理已自动降频（原因见上方提示）  ') : '') +
          (!hasStars ? T('物质团块（无恒星）  ') : '') +
          T('晕 ') + S.halos.length + (S.a < 0.2 ? T('（结构尚未形成）') : '') +
          (S.a < 0.05 ? T('  初始条件：Zel’dovich 位移后的格点（随机相位已含，看着像网格是正常的）') : '') +
          (S.nearHalo ? T('  最近晕 ') + fmtLen(S.nearDist * boxToMpc) + ' · M≈' + sciTxt(S.nearHalo.mass, 1) + ' M⊙/h' : '') +
          T('  速度 ') + fmtLen((S.effSpeed || cam.speed) * boxToMpc) + '/s' +
          (dimS !== 3 ? T('  限速 |Δx|≤ε/步') + (S.capClamped ? T('（本步限幅 ') + S.capClamped + T(' 粒）') : '') : '') +
          (S.sigma8 != null ? T('  σ₈(测)=') + S.sigma8.toFixed(2) + T(' / 线性 ') + cosmo.sigma8.toFixed(2) : '');
        // 尺度尺：120px 在参考距离处的物理宽度
        var refD = clamp((S.effSpeed || cam.speed) * 2.5, 1e-9, 0.5), fy = 1 / Math.tan(cam.fov / 2);
        var widthBox = 120 / (fy * (H / dpr) / 2) * refD, mpc = widthBox * boxToMpc * (S.properScale ? S.a : 1);
        els.scaleTxt.textContent = fmtLen(mpc) + T(S.properScale ? '（固有）' : '（共动）') + T(' @ 参考距离 ') + fmtLen(refD * boxToMpc);
        // 提示 / 注记
        if (S.lod === 2 && S.galaxy) {
          els.note.hidden = false;
          if (S.galaxy.isLocal) { els.note.className = 'u3d-note data'; els.note.textContent = T(DATA_LAYER_LABEL) + T('：太阳位置 / 百光年内恒星 / 本星系群 · 星系点云本身为过程生成示意'); }
          else if (S.galaxy.synthetic) { els.note.className = 'u3d-note'; els.note.textContent = T('示意：这个宇宙没有形成晕，这是按最密处种子过程生成的示例星系——不是模拟结果'); }
          else { els.note.className = 'u3d-note';
            els.note.textContent = T('示意：') + TX(S.galaxy.typeName) + T('（') + 'M★≈' + sciTxt(S.galaxy.starMassMsun || 0, 1) + ' M⊙' + T('，晕 ') + sciTxt(S.galaxy.massMsun, 1) + ' M⊙/h' + T('，R≈') + S.galaxy.radiusKpc.toFixed(0) + ' kpc' + T('）')
              + (S.galaxy.agn ? T(' · 带') + (S.galaxy.quasar ? T('类星体级') : '') + T('活动星系核（M_BH≈') + sciTxt(S.galaxy.mBHMsun || 0, 1) + ' M⊙' + T('）') : '')
              + (S.galaxy.isCluster ? T(' · 含团内热气体与 cD 星系') : '') + T(' · 过程生成，不是模拟结果'); }
        } else if (!hasStars && S.inClump) {
          els.note.hidden = false; els.note.className = 'u3d-note';
          els.note.textContent = T('引力聚集的物质团块（模拟结果）：该宇宙没有稳定原子、也没有恒星，没有星系可言——这里没有可点选的天体');
        } else if (S.noteSticky && now - S.noteSticky < 9000) { /* flyTo 的说明先留着 */ }
        else if (weakStructure()) {
          // 结构极弱的宇宙：说清楚"你看到的是初始条件"，不要让人以为渲染坏了
          els.note.hidden = false; els.note.className = 'u3d-note';
          els.note.textContent = T('该宇宙结构极弱（σ₈≈') + (S.sigma8 != null ? S.sigma8.toFixed(2) : '—') + ' · D=' + fmtNum(dimS, 2) + T('）：看到的基本还是初始条件格点，没有形成晕');
        } else els.note.hidden = true;
        if (S.starPanel && now - S.starPanelT > 6000) { S.starPanel = null; els.star.hidden = true; }
        if (!S.halos.length && S.ready && S.a > 0.25) S.showcaseOffer = true;   // 没有晕：把"示例星系"这条路露出来
        syncButtons();
        paintMinimap();
      }
      // 晕标签（每帧投影，最多 8 个最近的）
      if (uiTick % 2 === 0) {
        var lab = els.labels; var html = '';
        if (S.labels && S.halos.length) {
          var fy2 = 1 / Math.tan(cam.fov / 2), fx2 = fy2 * H / W, cw = W / dpr, chh = H / dpr;
          var list = [];
          for (var i = 0; i < S.halos.length; i++) { var h = S.halos[i], r = minImage([h.x, h.y, h.z]); var vz = r[0] * cam.fwd[0] + r[1] * cam.fwd[1] + r[2] * cam.fwd[2]; if (vz <= 1e-6) continue; var d = len3(r); if (d > 0.35) continue; list.push({ h: h, r: r, vz: vz, d: d, i: i }); }
          list.sort(function (p, q) { return p.d - q.d; });
          for (var j = 0; j < Math.min(5, list.length); j++) {
            var it = list[j], vx = it.r[0] * cam.right[0] + it.r[1] * cam.right[1] + it.r[2] * cam.right[2], vy = it.r[0] * cam.up[0] + it.r[1] * cam.up[1] + it.r[2] * cam.up[2];
            var sx = (vx * fx2 / it.vz * 0.5 + 0.5) * cw, sy = (0.5 - vy * fy2 / it.vz * 0.5) * chh;
            if (sx < -50 || sx > cw + 50 || sy < -20 || sy > chh + 20) continue;
            var sel = it.h === S.nearHalo;
            html += '<div class="u3d-hl' + (sel ? ' sel' : '') + '" style="left:' + (sx + 8).toFixed(0) + 'px;top:' + (sy - 8).toFixed(0) + 'px">' + T('晕 #') + (it.i + 1) + (it.h.isLocalHost ? T(' · 银河系宿主') : '') + ' · M≈' + sciTxt(it.h.mass, 1) + ' M⊙/h · r₂₀₀≈' + fmtLen(it.h.rMpc / cosmo.h) + ' · ' + fmtLen(it.d * boxToMpc) + '</div>';
          }
        }
        lab.innerHTML = html;
      }
    }

    /* ---------- 点选恒星（LOD 3）---------- */
    // 信息面板文案：过程生成的恒星报"示意"量；数据层天体只报目录里真有的量（没有的就不写）
    function starPanelText(info) {
      var d = info.data;
      var kindTxt = T(KIND_CN[info.kind] ||
        (info.kind === 'data' ? (d && d.isCluster ? '星系团（观测目录）' : d && d.isGalaxy ? '星系（观测目录）' : '恒星（观测目录）') : '恒星'));
      var lines = [], seg = [kindTxt];
      if (info.name) lines.push(T(info.name));
      if (info.spectral) seg.push(TX(info.spectral) + (info.kind === 'data' ? '' : T(' 型')));
      if (info.tempK != null) seg.push('T≈' + info.tempK + ' K');
      if (info.massSol != null) seg.push(info.massSol + ' M⊙');
      if (info.kind === 'data' && info.lumSol != null) seg.push('L≈' + (info.lumSol >= 0.01 ? String(+info.lumSol.toPrecision(2)) : info.lumSol.toExponential(1)) + ' L⊙');
      lines.push(seg.join(' · '));
      if (d) {
        if (d.isSun) lines.push(TX(d.note || ('距银心 ' + fmtLen(d.distKpc / 1000))));
        else if (d.isGalaxy) lines.push(T('距太阳 ') + fmtLen(d.distKpc / 1000) + (d.type ? ' · ' + d.type : '') + (d.massMsun > 0 ? ' · M★≈' + sciTxt(d.massMsun, 1) + ' M⊙' : ''));
        else lines.push(T('距太阳 ') + fmtLen(d.distPc / 1e6) + (d.mag != null ? ' · V=' + d.mag : '') + (d.con ? ' · ' + d.con : ''));
      } else lines.push(T('距星系中心 ') + fmtLen(len3(info.posKpc) / 1000));
      if (info.kind === 'agn') lines.push('M_BH ≈ ' + sciTxt(info.mBHMsun || 0, 1) + ' M⊙' + (info.quasar ? T('（类星体级光度）') : '') + T(' · 喷流为示意'));
      if (info.kind === 'icm') lines.push(T('团内热气体 T ≈ 10⁷ K（X 射线示意）'));
      if (info.galaxy && !info.data) lines.push(TX(info.galaxy.typeName) + ' · M★≈' + sciTxt(info.galaxy.starMassMsun || 0, 1) + ' M⊙' + T(' · 晕 ') + sciTxt(info.galaxy.haloMassMsun || 0, 1) + ' M⊙/h');
      if (info.typeRef) lines.push(TX(info.typeRef));
      else if (info.galaxy && info.galaxy.refs && !info.data) lines.push(TX(info.galaxy.refs.morph + '；' + info.galaxy.refs.smhm));
      lines.push(TX(info.basis));
      if (onEnterStar && (info.kind === 'star' || (info.kind === 'data' && !(d && d.isGalaxy)))) lines.push(T('（点一下进入）'));
      return lines.join('\n');
    }
    function handleClick(cx, cy) {
      // 无恒星的宇宙：没有可点选的天体，说清楚原因，也绝不触发 onEnterStar
      if (!hasStars) {
        S.pick = null;
        onStatus(T('这个宇宙没有稳定原子，也没有恒星：画面里的亮点是引力聚集的物质团块，没有可进入的天体'), api.getState());
        if (els.note) { els.note.hidden = false; els.note.className = 'u3d-note'; els.note.textContent = T('没有可点选的天体：该宇宙无稳定原子/无恒星，亮点是引力聚集的物质团块'); S.noteSticky = performance.now(); }
        return;
      }
      if (S.lod !== 2 || !S.galaxy) return;
      var rect = canvas.getBoundingClientRect();
      var nx = ((cx - rect.left) / rect.width) * 2 - 1, ny = 1 - ((cy - rect.top) / rect.height) * 2;
      var fy = 1 / Math.tan(cam.fov / 2), fx = fy * H / W;
      var dir = [cam.fwd[0] + cam.right[0] * nx / fx + cam.up[0] * ny / fy, cam.fwd[1] + cam.right[1] * nx / fx + cam.up[1] * ny / fy, cam.fwd[2] + cam.right[2] * nx / fx + cam.up[2] * ny / fy];
      var dl = len3(dir); dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
      var c = minImage(S.galAnchor), g = S.galaxy, best = -1, bestScore = Infinity, thr = 0.02 * (cam.fov / (60 * Math.PI / 180));
      var nPick = Math.min(g.count, S.starsDrawn || g.count);
      for (var i = 0; i < nPick; i++) {
        var kind = g.meta[i]; if (kind === 7) continue;   // 团内弥散热气体不作为可点选天体
        var o = 8 * i, rx = c[0] + g.data[o] * kpcToBox, ry = c[1] + g.data[o + 1] * kpcToBox, rz = c[2] + g.data[o + 2] * kpcToBox;
        var vz = rx * dir[0] + ry * dir[1] + rz * dir[2]; if (vz <= 0) continue;
        var d2 = rx * rx + ry * ry + rz * rz, sin2 = Math.max(0, 1 - vz * vz / d2);   // sin²(角距)
        var ang = Math.sqrt(sin2);
        if (ang > thr) continue;
        var score = ang / (1 + Math.log(1 + g.data[o + 7]) * 0.15) * (kind === 3 ? 0.6 : 1);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) return;
      S.starSel = best;
      var info = starInfoOf(g, best, seed);
      info.universeSeed = seed; info.haloId = S.galHalo && S.galHalo.id; info.a = S.a; info.tGyr = api.getState().t;
      S.pick = info;
      if (els.star) {
        var o2 = 8 * best, rr = [c[0] + g.data[o2] * kpcToBox, c[1] + g.data[o2 + 1] * kpcToBox, c[2] + g.data[o2 + 2] * kpcToBox];
        var vz2 = rr[0] * cam.fwd[0] + rr[1] * cam.fwd[1] + rr[2] * cam.fwd[2], vx2 = rr[0] * cam.right[0] + rr[1] * cam.right[1] + rr[2] * cam.right[2], vy2 = rr[0] * cam.up[0] + rr[1] * cam.up[1] + rr[2] * cam.up[2];
        var sx = (vx2 * fx / vz2 * 0.5 + 0.5) * rect.width, sy = (0.5 - vy2 * fy / vz2 * 0.5) * rect.height;
        els.star.hidden = false; els.star.style.left = (sx + 12) + 'px'; els.star.style.top = (sy + 12) + 'px';
        els.star.textContent = starPanelText(info);
        S.starPanel = info; S.starPanelT = performance.now();
      }
      if (onEnterStar && (info.kind === 'star' || info.kind === 'data') && !(info.data && info.data.isGalaxy)) { try { onEnterStar(info.seed, info); } catch (e) { console.warn('[universe3d] onEnterStar:', e); } }
    }

    /* ---------- 主循环 ---------- */
    var raf = 0;
    /* 每帧分段计时。用户真机上出现过「滚轮缩放时连着两帧各 1.5 秒」（stallMs 3230，
       WebGPU / mid 档 / N=2,097,152 / heap 485 MB），而本机 WebGL2 + 512k 粒子滚 20 格
       实测基线最慢 133 ms、滚轮最慢 131 ms —— 复现不出来，只能把现场记下来等下一份 dump。
       heavy() 只是两次 performance.now()，不改任何渲染/物理行为：
       超过 120 ms 的那一段会被记进 S.lastHeavy（谁、多久、什么时候、当时的 N/LOD/相机速度），
       宿主的看门狗 dump 里以 u3dHeavy 字段带出去。 */
    var HEAVY_MS = 120;
    function heavy(name, fn) {
      if (!S.traceHeavy) return fn();
      var t0 = nowPerf(), r = fn(), ms = nowPerf() - t0;
      if (ms >= HEAVY_MS) {
        S.lastHeavy = { what: name, ms: Math.round(ms), at: Math.round(t0),
                        N: S.N, lod: S.lod, tiles: S.tiling ? 27 : 1, overview: !!S.overview,
                        speed: cam && cam.speed != null ? +cam.speed.toExponential(2) : null,
                        galAgeMs: S.galAt ? Math.round(t0 - S.galAt) : null, running: !!S.running };
        S.heavyLog = S.heavyLog || [];
        if (S.heavyLog.length < 12) S.heavyLog.push(S.lastHeavy);
        if (!S.heavyWarned || ms >= 400) { S.heavyWarned = true; console.warn('[universe3d] 这一帧的重活：' + name + ' ' + Math.round(ms) + ' ms', S.lastHeavy); }
      }
      return r;
    }
    function nowPerf() { return (typeof performance === 'object' && performance.now) ? performance.now() : Date.now(); }
    function frame(now) {
      raf = 0;
      if (S.disposed) return;
      // 维数画面层的显隐必须在 ready/hidden 判断**之外**同步：宿主把 #gl3d 藏起来去别的视图时，
      // 下面那个 if 整块跳过，这一层就会带着上一帧的画面留在屏幕上。
      // 混乱色块那一档揭开之后（dimVeiled=false）整层不再显示，露出下面的 WebGL 画布。
      var dimShow = !canvas.hidden && S.ready;
      if (dimCv) dimCv.hidden = !dimShow || (dimMode === 'chaos' && !dimVeiled);
      // 那块字与常驻提示跟着一起：初始条件还在生成时先别弹，等有东西看了再拦
      if (dimVeil) dimVeil.setVisible(dimShow);
      // 低功耗：渲染限到 ~30 fps（物理另在 Worker/批大小上降频），空转的那些帧直接跳过
      if (S.lowPower && S.lastFrame && now - S.lastFrame < 32) { raf = requestAnimationFrame(frame); return; }
      var dt = S.lastFrame ? Math.min(0.1, (now - S.lastFrame) / 1000) : 0.016; S.lastFrame = now;
      if (!S.hidden && !S.blurred && S.ready && !canvas.hidden) {
        S.fps = S.fps ? S.fps * 0.92 + (1 / Math.max(dt, 1e-3)) * 0.08 : 1 / Math.max(dt, 1e-3);
        var tFrame = S.traceHeavy ? nowPerf() : 0;
        autoThrottle();
        heavy('moveCamera', function () { moveCamera(dt); });
        if (S.mode === 'webgpu') heavy('tickGPU', function () { tickGPU(dt); if (S.running) scheduleAnalysis(false); else if (S.anWanted && !S.anPending) scheduleAnalysis(true); });
        heavy('updateLOD', function () { updateLOD(); });     // ensureGalaxy → generateGalaxy + setStars 都在这条路上
        heavy('render', function () { try { S.backend.render(viewParams(now)); } catch (e) { if (!S.renderErr) { S.renderErr = true; console.error('[universe3d] render:', e); } } });
        heavy('autoExpose', function () { autoExpose(now); });   // 必须在 render 之后：回读的是刚画完的这一帧
        heavy('drawWire', function () { drawWire(); });
        heavy('drawDimView', function () { drawDimView(dt); });   // D≠3：把那两种画面盖在粒子网之上（D=3 时 dimCv 根本没建，这行直接返回）
        heavy('updateOverlay', function () { updateOverlay(now); });
        /* 整帧超了、可是没有任何一段单独超 —— 那就不是这里面某一段的事（多半是 GC 或浏览器合成），
           照样记一条，别让下一份 dump 又只剩一个「卡了 1.5 秒」没有下文。 */
        if (S.traceHeavy) {
          var fms = nowPerf() - tFrame;
          if (fms >= HEAVY_MS && (!S.lastHeavy || S.lastHeavy.at < tFrame)) {
            S.lastHeavy = { what: 'frame-other（各段都不超，疑似 GC / 合成）', ms: Math.round(fms), at: Math.round(tFrame),
                            N: S.N, lod: S.lod, heapMB: (typeof performance === 'object' && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
            S.heavyLog = S.heavyLog || []; if (S.heavyLog.length < 12) S.heavyLog.push(S.lastHeavy);
          }
        }
      } else if (!S.ready && ov) { syncOverlay(); }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    /* ---------- 公共 API ---------- */
    var api = {
      version: VERSION, canvas: canvas, ready: ready, cosmo: cosmo, seed: seed, boxMpc: L,
      start: function () {
        if (S.disposed || !S.ready) { S.pendingStart = true; return api; }
        if (S.mode === 'webgpu') { if (simTargetsReached()) { /* 到头了：不动 */ } S.running = true; }
        else if (S.worker) { S.running = true; S.worker.postMessage({ type: 'run', target: { t: S.targetT / cosmo.TH - t0H0, a: S.targetA } }); }
        return api;
      },
      pause: function () { S.running = false; if (S.worker) S.worker.postMessage({ type: 'pause' }); if (S.mode === 'webgpu') scheduleAnalysis(true); return api; },
      step: function (dtGyr) {
        if (!S.ready) return api;
        if (S.mode === 'webgpu') { if (!S.backend) return api; var st = S.backend.st, dt = dtGyr != null ? dtGyr / cosmo.TH : K.suggestDt(cosmo, st, 0.03, 0.02); if (pexp !== 2 && dtGyr == null) { refreshAccelGPU(); dt = Math.max(1e-7, Math.min(dt, cflLimit(st.a))); } S.backend.step(dt); S.lastDt = dt; S.a = st.a; S.ad = st.ad; S.t = st.t; S.steps = st.steps; scheduleAnalysis(true); }
        else if (S.worker) S.worker.postMessage({ type: 'step', dt: dtGyr != null ? dtGyr / cosmo.TH : null });
        return api;
      },
      // 目标时刻（Gyr，宇宙年龄）：向前 → 继续演化到该时刻；向后 → 从初始条件重算（不回放）
      setTime: function (tGyr) {
        if (!S.ready) return api;
        var cur = t0Gyr + S.t * cosmo.TH;
        S.targetT = Math.max(t0Gyr, tGyr); S.targetA = S.aStop;
        if (tGyr < cur - 1e-6) {
          if (S.mode === 'webgpu') {
            if (icCache) { S.backend.reset(icCache.pos, icCache.vel); S.a = S.backend.st.a; S.t = 0; S.steps = 0; S.running = true; }
            else {
              // 重算用的 IC Worker 也要挂到 S.icWorker：否则 dispose 之后它还在为 np³ 粒子算初始条件
              S.running = false; setProgress(T('重算：重新生成初始条件…'));
              if (S.icWorker) { try { S.icWorker.terminate(); } catch (e) { /* ignore */ } S.icWorker = null; }
              var w = makeWorker(); S.icWorker = w;
              var fin = function () { if (S.icWorker === w) S.icWorker = null; try { w.terminate(); } catch (e) { /* ignore */ } };
              w.onmessage = function (ev) {
                if (S.disposed) { fin(); return; }
                var m = ev.data;
                if (m.type === 'ic') { fin(); if (S.disposed || !S.backend) return; S.backend.reset(m.pos, m.vel); S.a = S.backend.st.a; S.t = 0; setProgress(''); S.running = true; }
                else if (m.type === 'progress') setProgress(T('重算：') + TX(m.text));
                else if (m.type === 'error') { fin(); setProgress(T('重算失败：') + m.message); }
              };
              w.onerror = function (e) { fin(); if (!S.disposed) setProgress(T('重算失败：') + (e && e.message || e)); };
              w.postMessage({ type: 'ic', cosmo: cosmoPlain(), mesh: S.mesh, np: S.np, boxMpc: L, seed: seed, aIc: aIc });
            }
          } else if (S.worker) { S.worker.postMessage({ type: 'reset', run: { t: S.targetT / cosmo.TH - t0H0, a: S.targetA } }); S.running = true; }
        } else api.start();
        return api;
      },
      getState: function () {
        return { mode: S.mode, tier: S.tier, N: S.N, mesh: S.mesh, a: S.a, z: 1 / S.a - 1, t: t0Gyr + S.t * cosmo.TH, tGyr: t0Gyr + S.t * cosmo.TH, running: S.running, ready: S.ready, fps: Math.round(S.fps), stepMs: S.stepMs || null, stepsPerSec: S.stepsPerSec || null, steps: S.steps,
          camera: { pos: cam.pos.slice(), yaw: cam.yaw, pitch: cam.pitch, speed: cam.speed, fovDeg: cam.fov * 180 / Math.PI }, scale: { boxMpcOverH: L, boxMpc: boxToMpc, kpcToBox: kpcToBox, proper: S.properScale },
          halosFound: S.halos.length, lod: S.lod, galaxy: S.galaxy ? { type: S.galaxy.type, morph: S.galaxy.morph, sub: S.galaxy.sub, typeName: S.galaxy.typeName, count: S.galaxy.count,
            radiusKpc: S.galaxy.radiusKpc, massMsun: S.galaxy.massMsun, starMassMsun: S.galaxy.starMassMsun, isLocal: !!S.galaxy.isLocal,
            bar: !!S.galaxy.bar, lsb: !!S.galaxy.lsb, isDwarf: !!S.galaxy.isDwarf, isCluster: !!S.galaxy.isCluster,
            agn: !!S.galaxy.agn, quasar: !!S.galaxy.quasar, mBHMsun: S.galaxy.mBHMsun || null, env: S.galaxy.env, counts: S.galaxy.counts, refs: S.galaxy.refs } : null,
          label: currentLabel(), matter: matterMode, inClump: !!S.inClump, layer: S.lod === 2 ? (S.galaxy && S.galaxy.isLocal ? DATA_LAYER_LABEL : '示意：过程生成') : '模拟', progress: S.progressText, error: S.error, exposureEV: S.exposureEV, volume: S.volume, labels: S.labels, tiling: S.tiling,
          dimS: dimS, kernelExp: pexp, softenCells: softCells, softenMpc: dimS === 3 ? 0 : softenMpc(), maxAccel: S.accMax || 0,
          // 维数画面：dimView 是分档，dimVeiled 是"现在是不是还遮着"，dimVeilSeen 是会话记忆（跨宇宙）
          // 最近一次「这一帧里哪一段最慢」（≥120 ms 才记）与整轮的前 12 条：宿主写进看门狗 dump 的 u3dHeavy
          lastHeavy: S.lastHeavy || null, heavyLog: S.heavyLog || null,
          dimView: dimMode, dimVeiled: !!dimVeiled, dimVeilSeen: dimVeilRevealed(),
          dtMin: dtMin, lastDt: S.lastDt || 0, capped: S.capClamped || 0, hudPosition: opts.hudPosition === 'top-left' ? 'top-left' : 'bottom-left',
          overview: S.overview, overviewOrbit: S.ovOrbit, orbit: S.ovOrbit, exposureAuto: S.autoExposure, hud: hudMode, overlay: !!ov, lowPower: S.lowPower, suspended: !!(S.hidden || S.blurred),
          yearsPerSecond: yearsPerSecond(), slowMain: !!S.slowMain, autoExposure: S.autoExposure, autoGain: S.autoGain, lumaP99: S.lumaP99,
          clipFrac: S.lumaClip || 0, clipping: (S.lumaClip || 0) > AE_CLIP_BUDGET, clipText: clipTxt().replace(/^ · /, ''), lumaPeak: S.lumaPeak || 0, lumaLit: S.lumaLit || 0, lumaMean: S.lumaMean || 0, lumaTarget: S.lumaTarget, lumaP995Lit: S.lumaP995Lit || 0, toneKnee: TONE_K,
          // 后端诊断：backend / gpuReason / gpuAdvice / canRetryGpu（宿主 UI 用来解释"为什么在用 CPU"）
          backend: backendKind(), gpuReason: gpuInfo().reason, gpuLabel: gpuInfo().gpuLabel, gpuAdvice: gpuInfo().gpuAdvice, gpuDetail: S.gpuDetail || '',
          cpuPhysics: S.mode === 'webgl2', canRetryGpu: S.mode === 'webgl2' && !S.gpuRetrying, gpuRetrying: !!S.gpuRetrying, gpuRetryMessage: S.gpuRetryMsg || '',
          exposureTotal: (S.autoExposure ? S.autoGain : 1) * Math.pow(2, S.exposureEV), weakStructure: weakStructure(), syntheticGalaxy: !!(S.galaxy && S.galaxy.synthetic),
          sigma8: S.sigma8, sigma8Linear: cosmo.sigma8, contracting: S.ad < 0, fate: cosIn.fate || (cosmo.aMax != null ? { type: 'crunch' } : { type: 'eternal' }) };
      },
      flyTo: function (target) {
        var h = null;
        if (target === 'densest') {
          h = S.halos[0] || null;
          // 没有晕（低 σ₈ / D<3 的宇宙很常见）也要能飞：退回密度场最大的格点，那个总是存在的
          if (!h) {
            var dc = densestCell();
            if (!dc) { onStatus(T('密度网格还没算出来（等初始条件生成完）'), api.getState()); return api; }
            if (S.overview) exitOverview(true);
            var er = 2.5 / S.mesh, dd = er * 1.6;
            S.flyAnim = { pos: [dc.x - cam.fwd[0] * dd, dc.y - cam.fwd[1] * dd, dc.z - cam.fwd[2] * dd], yaw: cam.yaw, pitch: cam.pitch, tol: er * 0.05 };
            cam.speed = Math.max(cam.speed * 0.3, er * 0.5);
            onStatus(T('这个宇宙还没有识别到晕：飞向密度场最大处（δ≈') + dc.delta.toFixed(1) + T('）'), api.getState());
            return api;
          }
        } else if (target === 'randomHalo') {
          if (S.halos.length) { var r = K.mulberry32((seed ^ (Date.now() & 0xffff)) >>> 0); h = S.halos[Math.floor(r() * Math.min(S.halos.length, 60))]; }
          else {
            // 没有晕：说清楚为什么，并把"示例星系（示意）"这条路给出来
            S.showcaseOffer = true; syncButtons();
            var msg = T('这个宇宙没有形成晕（σ₈≈') + (S.sigma8 != null ? S.sigma8.toFixed(2) : '—') + ' · D=' + fmtNum(dimS, 2) + T('）：没有可进入的星系。') +
              T('可以点"参观示例星系（示意）"看一个过程生成的星系（不是这个宇宙的模拟结果）。');
            if (els.note) { els.note.hidden = false; els.note.className = 'u3d-note'; els.note.textContent = msg; S.noteSticky = performance.now(); }
            onStatus(msg, api.getState());
            return api;
          }
        } else if (target && typeof target === 'object' && target.x != null) { if (S.overview) exitOverview(true); S.flyAnim = { pos: [target.x, target.y, target.z], yaw: target.yaw != null ? target.yaw : cam.yaw, pitch: target.pitch != null ? target.pitch : cam.pitch, tol: 1e-5 }; return api; }
        if (!h) { onStatus(T('还没有识别到晕（等分析完成）'), api.getState()); return api; }
        if (S.overview) exitOverview(true);   // 飞行目标在盒内：先退出俯瞰
        // 落在晕心外 1.6×进入半径处，朝向晕心
        var enterR = Math.max(3 * h.r, 1.2 / S.mesh), d = enterR * 1.6, dir = cam.fwd;
        var pos = [h.x - dir[0] * d, h.y - dir[1] * d, h.z - dir[2] * d];
        S.flyAnim = { pos: pos, yaw: cam.yaw, pitch: cam.pitch, tol: enterR * 0.05, halo: h };
        cam.speed = Math.max(cam.speed * 0.3, enterR * 0.5);
        return api;
      },
      flyIntoHalo: function (index) { var h = S.halos[index]; if (!h) return api; var enterR = Math.max(3 * h.r, 1.2 / S.mesh); S.flyAnim = { pos: [h.x - cam.fwd[0] * enterR * 0.5, h.y - cam.fwd[1] * enterR * 0.5, h.z - cam.fwd[2] * enterR * 0.5], yaw: cam.yaw, pitch: cam.pitch, tol: enterR * 0.02, halo: h }; cam.speed = enterR * 0.2; return api; },
      setExposure: function (ev) { if (ev === 'auto') return api.setAutoExposure(true); S.exposureEV = clamp(+ev || 0, -6, 6); S.autoExposure = false; syncButtons(); return api; },
      setAutoExposure: function (v) { S.autoExposure = v == null ? !S.autoExposure : !!v; if (S.autoExposure) S.lastLuma = 0; syncButtons(); return api; },
      /* 重试 WebGPU：重新走一次适配器/设备探测，把最新的原因写回 gpuReason/gpuAdvice。
       * 拿到设备也不能就地热切换——HTML 画布的上下文类型不可逆（这块 <canvas> 已经归 WebGL2），
       * 只能由宿主用一块新画布重建实例：成功时调 opts.onRetryGpu(state)，并在告警条上直说要重新开始演化。
       * 返回 Promise<{ok, reason, gpuLabel, gpuAdvice, canHotSwap:false, message}>。 */
      retryGpu: function () {
        if (S.mode === 'webgpu') return Promise.resolve({ ok: true, reason: 'ok', gpuLabel: GPU_REASONS.ok.label, gpuAdvice: '', canHotSwap: true, message: T('已经在用 WebGPU') });
        if (S.gpuRetrying) return Promise.resolve({ ok: false, reason: S.gpuReason, message: T('正在检测…') });
        S.gpuRetrying = true; S.gpuRetryMsg = T('正在重新检测 WebGPU…'); updateWarn();
        function finish(reason, detail, msg, ok) {
          S.gpuRetrying = false;
          if (reason) setGpuReason(reason, detail, true);
          var g = gpuInfo();
          S.gpuRetryMsg = msg || (T(g.gpuLabel) + T('。') + T(g.gpuAdvice));
          updateWarn(); onStatus(S.gpuRetryMsg, api.getState());
          var out = { ok: !!ok, reason: g.reason, gpuLabel: g.gpuLabel, gpuAdvice: g.gpuAdvice, canHotSwap: false, message: S.gpuRetryMsg };
          if (ok && typeof opts.onRetryGpu === 'function') { try { opts.onRetryGpu(api.getState(), out); } catch (e) { console.warn('[universe3d] onRetryGpu:', e); } }
          return out;
        }
        if (!(root.navigator && root.navigator.gpu)) return Promise.resolve(finish(probeGpuReason(), '', null, false));
        return root.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (adapter) {
          if (S.disposed) return { ok: false, reason: 'no-adapter', message: T('已销毁') };
          if (!adapter) return finish('no-adapter', '', null, false);
          return adapter.requestDevice().then(function (device) {
            try { device.destroy(); } catch (e) { /* 只是探测，立刻还回去 */ }
            return finish('ok', '', T('WebGPU 现在可用了：但这块画布已经归 WebGL2（上下文类型不可逆），要切到 GPU 路径得重新引爆这个宇宙——会从初始条件重新开始演化。'), true);
          }, function (e) { return finish('device-failed', e && e.message || String(e), null, false); });
        }, function (e) { return finish('no-adapter', e && e.message || String(e), null, false); });
      },
      // 低功耗：渲染限 ~30 fps + 物理降频（Worker 每轮让出 CPU / WebGPU 每帧最多 2 步）
      setLowPower: function (v) {
        S.lowPower = v == null ? !S.lowPower : !!v;
        if (S.worker) S.worker.postMessage({ type: 'power', lowPower: S.lowPower });
        syncButtons();
        onStatus(S.lowPower ? T('低功耗：渲染 30 fps、物理降频') : T('恢复全速'), api.getState());
        return api;
      },
      toggleOverview: function (v) { var want = v == null ? !S.overview : !!v; if (want) enterOverview(); else exitOverview(false); return api; },
      enterOverview: function () { enterOverview(); return api; },
      exitOverview: function (keepPose) { exitOverview(!!keepPose); return api; },
      toggleOrbit: function (v) { S.ovOrbit = v == null ? !S.ovOrbit : !!v; syncButtons(); return api; },
      setOrbit: function (v) { S.ovOrbit = !!v; syncButtons(); return api; },
      // setExposure('auto') 恢复自动；数字 = 手动 EV
      setExposureMode: function (v) { if (v === 'auto') return api.setAutoExposure(true); return api.setExposure(+v || 0); },
      hudMode: function () { return hudMode; },
      // 没有晕的宇宙里的"示例星系"：按最密处的种子过程生成一个星系，明确标示意
      showcaseGalaxy: function () {
        if (!hasStars) {   // 没有恒星的宇宙不该"变"出一个星系来看
          onStatus(T('这个宇宙没有稳定原子、也没有恒星：没有星系可言，示例星系也不适用（画面里的是引力聚集的物质团块）'), api.getState());
          return api;
        }
        var dc = densestCell();
        if (!dc) { onStatus(T('密度网格还没算出来'), api.getState()); return api; }
        var cellMass = cosmo.OmM * RHO_CRIT * Math.pow(L, 3) / (S.mesh * S.mesh * S.mesh);
        var halo = { id: 0x5A5AC0DE, x: dc.x, y: dc.y, z: dc.z, r: 2.5 / S.mesh, rMpc: 2.5 * L / S.mesh, mass: Math.max(cellMass * (1 + dc.delta) * 8, 1e11), synthetic: true };
        if (S.overview) exitOverview(true);
        ensureGalaxy(halo);
        if (S.galaxy) { S.galaxy.synthetic = true; S.galaxy.typeName = S.galaxy.typeName + '（示例）'; }
        S.lod = 2; S.nearHalo = halo; S.nearDist = 0;
        var er = Math.max(3 * halo.r, 1.2 / S.mesh);
        S.flyAnim = { pos: [halo.x - cam.fwd[0] * er * 0.8, halo.y - cam.fwd[1] * er * 0.8, halo.z - cam.fwd[2] * er * 0.8], yaw: cam.yaw, pitch: cam.pitch, tol: er * 0.02, halo: halo };
        cam.speed = er * 0.2;
        onStatus(T('示意：这个宇宙没有形成晕，下面是按最密处种子过程生成的一个星系——不是模拟结果'), api.getState());
        return api;
      },
      toggleVolume: function (v) { S.volume = v == null ? !S.volume : !!v; S.volAuto = false; syncButtons(); return api; },
      toggleLabels: function (v) { S.labels = v == null ? !S.labels : !!v; if (els.labels && !S.labels) els.labels.innerHTML = ''; return api; },
      /* 「我们无法观察它」那一屏的开关（只有 dimMode==='chaos' 那一档有这层）。
         宿主在 D≥4 下会在本模块与 ui/hyper.js 的 D 维 N 体之间来回切：
         在 hyper 里点了「重看那一屏」之后，宿主切回本模块并调这个方法把遮罩重新盖上
         —— 会话记忆 dimVeilSeen 已经是 true，不这么叫一声它会直接是揭开态，两边就来回弹了。 */
      setVeiled: function (v) { if (dimVeil) { if (v) dimVeil.veilAgain(); else dimVeil.reveal(); } return api; },
      toggleTiling: function (v) { S.tiling = v == null ? !S.tiling : !!v; if (S.tiling && S.N > 600000) { S.tiling = false; onStatus(T('粒子数过多，不启用 27 重平铺'), api.getState()); } return api; },
      toggleParticles: function (v) { S.showParticles = v == null ? !S.showParticles : !!v; return api; },
      setColorMode: function (m) { S.colorMode = m === 'speed' || m === 1 ? 1 : 0; return api; },
      setProperScale: function (v) { S.properScale = !!v; return api; },
      setSpeed: function (boxPerSec) { cam.speed = clamp(+boxPerSec, 1e-9, 2); return api; },
      setCamera: function (c) { if (c.pos) cam.pos = c.pos.slice(); if (c.yaw != null) cam.yaw = c.yaw; if (c.pitch != null) cam.pitch = c.pitch; if (c.fovDeg) cam.fov = c.fovDeg * Math.PI / 180; basis(); wrapCam(); return api; },
      setAutoBrake: function (v) { S.autoBrake = !!v; return api; },
      halos: function () { return S.halos.slice(); },
      requestAnalysis: function () { if (S.mode === 'webgpu') scheduleAnalysis(true); else if (S.worker) S.worker.postMessage({ type: 'analyze' }); return api; },
      diagnostics: function () {
        var PkLin = null;
        if (S.Pk) { var D = cosmo.growth(S.a); PkLin = S.Pk.map(function (p) { return [p[0], cosmo.Pk(p[0]) * D * D]; }); }
        return { Pk: S.Pk, PkLinear: PkLin, sigma8: S.sigma8, sigma8Linear: cosmo.sigma8 * cosmo.growth(S.a), sigma8LinearZ0: cosmo.sigma8, haloCount: S.halos.length, halos: S.halos.slice(0, 20), mode: S.mode, a: S.a, N: S.N, mesh: S.mesh, boxMpc: L, growth: cosmo.growth(S.a), tier: S.tier, stepMs: S.stepMs || null };
      },
      pickStar: function (cx, cy) { handleClick(cx, cy); return S.pick; },
      resize: function () { resize(); return api; },
      dispose: function () {
        if (S.disposed) return;
        S.disposed = true; S.running = false; S.ready = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        listeners.forEach(function (l) { try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) { /* ignore */ } });
        listeners.length = 0;
        // 三个 Worker 都要停：sim（CPU PM，一直在跑）、analysis（回读分析）、ic（初始条件，可能正在为 np³ 粒子分配网格）
        [['worker', S.worker], ['anWorker', S.anWorker], ['icWorker', S.icWorker]].forEach(function (p) {
          var w = p[1]; if (!w) return;
          try { w.onmessage = null; w.onerror = null; } catch (e) { /* ignore */ }
          try { w.terminate(); } catch (e) { /* ignore */ }
          S[p[0]] = null;
        });
        // 后端：WebGPU 会 destroy 设备 + unconfigure 画布，WebGL2 会删完资源 + loseContext
        if (S.backend) { try { S.backend.dispose(); } catch (e) { /* ignore */ } S.backend = null; }
        if (els.btns && els.btnsClick) { try { els.btns.removeEventListener('click', els.btnsClick); } catch (e) { /* ignore */ } }
        if (els.warn && els.warnClick) { try { els.warn.removeEventListener('click', els.warnClick); } catch (e) { /* ignore */ } }
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        ov = null; els = {};
        if (dimCv && dimCv.parentNode) dimCv.parentNode.removeChild(dimCv);
        dimCv = null; dimCtx = null; dimSt = null; dimChaos = null;
        if (dimVeil) { try { dimVeil.dispose(); } catch (e) { /* ignore */ } dimVeil = null; }
        icCache = null; S.galaxy = null; S.halos = []; S.haloRel = null; S.minimap = null;
        S.cpuGridF32 = null; S.cpuGrid8 = null; S.Pk = null;
      },
      _S: S, _cam: cam
    };
    ready.then(function () { if (S.pendingStart) api.start(); });
    return api;
  }

  // createDimVeil / dimVeilRevealed 导出给 ui/scenes.js 的 2D 回退路径复用（同一份界面、同一份会话记忆）
  root.MirrorUniverse3D = { VERSION: VERSION, isSupported: isSupported, create: create, cosmologyFrom: cosmologyFrom, TIERS: TIERS, kernel: K, GLSL: GLSL, WGSL: WGSL, generateGalaxy: generateGalaxy, localData: localData, DATA_LAYER_LABEL: DATA_LAYER_LABEL, tempFromCI: tempFromCI, fmtLen: fmtLen, bbColor: bbColor, createDimVeil: createDimVeil, createDimChaos: createDimChaos, dimVeilRevealed: dimVeilRevealed };
})(typeof window !== 'undefined' ? window : this);
