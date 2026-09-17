/*
 * ui/scenes.js —— 各结局的 Canvas 2D 画面
 * ------------------------------------------------------------
 * MirrorScenes.create(sim, opts) -> scene
 *   scene.draw(ctx, W, H, dt, elapsed)   每帧调用（ctx 已按 dpr 缩放，W/H 为 CSS 像素）
 *   scene.dispose()
 *   scene.kind                            'black' | 'ocean' | 'chaos' | 'fractal' | 'nbody' | 'starsea'
 *   scene.caption                         可选：屏幕上的一行小字
 * opts: { adapter, reducedMotion, seed }
 * 所有画面由 sim.seed 决定（决定论：同一参数组 → 同一宇宙）。
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  /* 中英文案：词典在 web/i18n-app.js；i18n 没加载时静默退回中文 */
  var T = function (s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'app') : s); };
  function rngOf(seed) { var A = root.MirrorAdapter; return A ? A.rng(seed >>> 0) : Math.random; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  // 宏观空间维数 D：引擎的 calc.dims.D（可能涌现/分数）→ 适配器 report.dimension → 参数 dimS → 3
  function dimOf(sim) {
    var r = sim && sim.raw, d = r && r.calc && r.calc.dims && r.calc.dims.D;
    if (d == null && sim && sim.report && sim.report.dimension != null) d = sim.report.dimension;
    if (d == null && sim && sim.params && sim.params.dimS != null) d = sim.params.dimS;
    d = +d;
    return isFinite(d) && d > 0 ? d : 3;
  }

  /* ------------------------------------------------------------ 维数分档：画面由 D 决定，不由结局标签决定
   * 依据 research/mirror-notes.md §2.4 / §3.3 / §3.4 —— 原著第八章对高维与低维的描写是**两回事**：
   *   §3.3 六维宇宙：「屏幕上出现了一堆极其混乱的色彩和形状，白冰立刻将它关掉了……
   *                    这是一个六维宇宙，我们无法观察它，其实大多数情况都是这样」
   *   §3.4 二点五维：「宇宙呈现一个无际的黑色平面，有无数银光闪闪的直线与黑的平面垂直相交……
   *                    这个黑色没有厚度的二维平面就是这个宇宙的太空……那些与平面垂直的亮线就是
   *                    太空中的恒星，她们都有几亿光年长，但无限细，只有一维」
   * 所以只分原文写过的两档；原文没写的不编：
   *   D ≥ 4       → 'chaos'   高维：先给"混乱的色彩和形状 + 我们无法观察它"这一屏，**带出口**；
   *                          点了就揭开，露出底下一直在跑的投影（见 highDimScene）
   *   2 ≤ D < 3   → 'plane'   比我们低：黑平面 + 垂直银线。**没有出口** —— 它就是这个宇宙的样子
   *   3 < D < 4   → 'normal'  见下：这一档不属于原文写过的任何一种
   *   D < 2       → 'normal'  原文没有任何描写（D≤2 引擎里连牛顿吸引都没有），退回现有粒子网画面
   *   D = 3       → 'normal'  照旧
   * 之所以不看 sim.outcome.type：维数量化改造之后，所有 D≠3 的宇宙结局都是 UNSTABLE_ORBITS 或
   * BEYOND_MODEL_DIM（4000 个链上派生宇宙实测，无一例外），按结局路由等于这两个场景永远走不到。
   * 而原著里外观由维数决定，跟轨道稳不稳定本来就是两件事。
   *
   * **阈值为什么是 4 而不是 3+1e-9（2026-09-17 修正）**：
   * 原来只要 D 比 3 大一丁点就盖"我们无法观察它 · 一堆极其混乱的色彩和形状"。
   * 可引擎对 3<D<4 的结论恰恰相反（engine/README §5 的 R_DIM）：
   *   「圆轨道对径向微扰稳定（D<4）但不闭合（进动），氢原子有基态而能级与化学显著改变」，
   * 结局也只判到 BEYOND_MODEL_DIM（"超出模型适用范围"），calc.dims.orbitsOK 为 true。
   * 一边说轨道稳定、原子有基态，一边盖一屏"无法观察"，是这一档最直白的自相矛盾。
   * 现在把分界挪到引擎自己判 fail 的那条线：D≥4 —— 那正是 Ehrenfest 判据崩掉、
   * 也正是原著拿来举例的六维宇宙所在的一侧。3<D<4 改走粒子网，标注照实写
   * "引力按 r^{−(D−1)} 衰减 · PM N 体"，不再替它宣称人看不见。
   * 实测影响面很小：D 被引擎量化成 0.5 的整数倍，这一档里只有 D=3.5（3000 个链上
   * 派生宇宙中 16 个，0.5%），而 D≥4 仍占 55%，chaosScene 不会因此变成死代码。
   * 低维那一侧不动：[2,3) 里实际只出现 D=2 与 D=2.5，后者正是原文的"二点五维"。
   * 容差 1e-9：D 是浮点数，整数 3 也可能带尾巴。 */
  var DIM_EPS = 1e-9;
  var DIM_CHAOS_FROM = 4;          // 引擎 R_DIM 判 fail 的下界（D≥4 轨道不稳、氢原子无下界）
  function dimView(D) {
    D = +D;
    if (!isFinite(D) || D <= 0) return 'normal';
    if (D >= DIM_CHAOS_FROM - DIM_EPS) return 'chaos';
    if (D >= 2 - DIM_EPS && D < 3 - DIM_EPS) return 'plane';
    return 'normal';
  }

  /* ------------------------------------------------------------ 全黑（空间湮灭 / 近空） */
  function blackScene(sim, o) {
    var t0 = 0;
    return {
      kind: 'black',
      /* 屏幕是黑的，标注就必须把「为什么黑」说清楚，否则读起来像渲染坏了。
         这里写的是引擎判据本身（依据等级：计算结果），不是示意。 */
      get label() {
        if (!isNearEmpty(sim)) return T('示意画面：过程生成的可视化，不是模拟结果');
        var c = sim.raw && sim.raw.calc, s8 = c && c.structure ? c.structure.sigma8 : null;
        var why = (c && c.baryons && c.baryons.hasBaryons === false)
          ? T('引擎判据：没有重子（CP 破坏不足或 Ω_b=0）')
          : T('引擎判据：σ₈=') + (s8 == null ? T('（a=1 前已坍缩）') : Number(s8).toExponential(2)) + T('，低于结构形成的下界 0.05');
        return T('近空宇宙 · 触发条件：') + why + T('，且星系尺度涨落从未越过球坍缩临界值 δ_c=1.686 —— 没有恒星、没有团块，屏幕上没有东西可画');
      },
      caption: '',
      draw: function (ctx, W, H, dt, el) {
        t0 = el;
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
      },
      dispose: function () {}
    };
  }

  /* ------------------------------------------------------------ 液体大洋：银色大膜 + 多彩露珠星球 */
  function oceanScene(sim, o) {
    var rnd = rngOf(sim.seed ^ 0x51ab);
    var drops = [];
    for (var i = 0; i < 46; i++) {
      var z = 0.08 + Math.pow(rnd(), 1.6) * 0.92;      // 深度 0..1（越大越远）
      drops.push({ x: (rnd() - 0.5) * 2.4, z: z, r: 0.35 + rnd() * 0.9, hue: rnd() * 360, sat: 55 + rnd() * 35, spin: (rnd() - 0.5) * 0.6, ph: rnd() * TAU });
    }
    drops.sort(function (a, b) { return b.z - a.z; });
    // 主角：木星那么大的星球，近处，自转，有山脉与彩虹环
    var big = { x: 0.32, z: 0.05, r: 1.0, hue: 28, sat: 62, spin: 0.35, ph: 0.4 };
    var stars = [];
    for (i = 0; i < 90; i++) stars.push({ x: rnd(), y: rnd() * 0.5, a: 0.15 + rnd() * 0.5, s: 0.5 + rnd() * 1.1 });
    var horizonK = 0.46;
    var rm = o.reducedMotion;
    function project(x, z, W, H) {
      // 简单透视：z→屏幕 y（地平线以下），x 缩放
      var hy = H * horizonK;
      var f = 1 / (0.06 + z * 1.4);
      var sy = hy + (H - hy) * clamp(0.02 + 0.28 * f, 0, 1.15);
      var sx = W * 0.5 + x * W * 0.42 * f * 0.35;
      return { x: sx, y: sy, s: f };
    }
    function drawDrop(ctx, d, W, H, el) {
      var p = project(d.x, d.z, W, H);
      var R = d.r * Math.min(W, H) * 0.045 * p.s * 0.55;
      if (R < 0.6) return;
      var bob = rm ? 0 : Math.sin(el * 0.5 + d.ph) * R * 0.05;
      var cy = p.y - R * 0.55 + bob;
      // 倒影
      var g0 = ctx.createRadialGradient(p.x, p.y + R * 0.4, R * 0.1, p.x, p.y + R * 0.4, R * 1.4);
      g0.addColorStop(0, 'hsla(' + d.hue + ',' + d.sat + '%,60%,0.35)'); g0.addColorStop(1, 'hsla(' + d.hue + ',' + d.sat + '%,60%,0)');
      ctx.fillStyle = g0; ctx.beginPath(); ctx.ellipse(p.x, p.y + R * 0.4, R * 1.4, R * 0.5, 0, 0, TAU); ctx.fill();
      // 球体
      var g = ctx.createRadialGradient(p.x - R * 0.35, cy - R * 0.35, R * 0.1, p.x, cy, R);
      g.addColorStop(0, 'hsl(' + d.hue + ',' + d.sat + '%,86%)');
      g.addColorStop(0.45, 'hsl(' + d.hue + ',' + d.sat + '%,58%)');
      g.addColorStop(1, 'hsl(' + d.hue + ',' + (d.sat * 0.8) + '%,22%)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, cy, R, 0, TAU); ctx.fill();
      // 条纹（自转）
      if (R > 8) {
        ctx.save(); ctx.beginPath(); ctx.arc(p.x, cy, R, 0, TAU); ctx.clip();
        var rot = rm ? d.ph : el * d.spin + d.ph;
        for (var k = -3; k <= 3; k++) {
          var yy = cy + k * R * 0.28;
          var w = Math.sqrt(Math.max(0, R * R - (yy - cy) * (yy - cy)));
          ctx.fillStyle = 'hsla(' + (d.hue + 20 * ((k % 2) ? 1 : -1)) + ',' + d.sat + '%,50%,0.35)';
          var off = Math.sin(rot + k) * R * 0.3;
          ctx.fillRect(p.x - w + off, yy - R * 0.06, w * 1.2, R * 0.12);
        }
        // 山脉（在出水入水处）
        ctx.fillStyle = 'rgba(40,30,25,0.55)';
        for (k = 0; k < 6; k++) { var a = rot * 1.0 + k * 1.05; var mx = p.x + Math.cos(a) * R * 0.95, my = cy + Math.sin(a) * R * 0.25 + R * 0.55; ctx.beginPath(); ctx.moveTo(mx - R * 0.12, my + R * 0.1); ctx.lineTo(mx, my - R * 0.18); ctx.lineTo(mx + R * 0.12, my + R * 0.1); ctx.fill(); }
        ctx.restore();
      }
      // 高光
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.ellipse(p.x - R * 0.4, cy - R * 0.45, R * 0.18, R * 0.1, -0.6, 0, TAU); ctx.fill();
      // 水面接触处的银亮边
      ctx.strokeStyle = 'rgba(235,240,255,0.55)'; ctx.lineWidth = Math.max(1, R * 0.05);
      ctx.beginPath(); ctx.ellipse(p.x, p.y - R * 0.05, R * 1.02, R * 0.22, 0, 0, Math.PI); ctx.stroke();
      // 半圆彩虹环（大星球）
      if (d === big) {
        var cols = ['#ff5a5a', '#ffb347', '#ffe66d', '#8ce99a', '#66d9e8', '#748ffc', '#b197fc'];
        for (var c = 0; c < cols.length; c++) { ctx.strokeStyle = cols[c]; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1.2, R * 0.03); ctx.beginPath(); ctx.arc(p.x, p.y - R * 0.05, R * (1.35 + c * 0.05), Math.PI * 1.02, Math.PI * 1.98); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    }
    return {
      kind: 'ocean',
      /* 只写物理与依据等级：这张画面是示意，真正的判定在分析面板的 R_OCEAN 那一条
         （engine.js calcOcean，依据等级 heuristic）。 */
      get label() { return T('冷液体宇宙 · 画面为示意，物理判定见分析面板（启发式）'); },
      caption: '',
      draw: function (ctx, W, H, dt, el) {
        var hy = H * horizonK;
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
        // 黑色天空 + 极稀疏星
        for (var i = 0; i < stars.length; i++) { var s = stars[i]; ctx.fillStyle = 'rgba(200,210,235,' + s.a * 0.5 + ')'; ctx.fillRect(s.x * W, s.y * hy, s.s, s.s); }
        // 银色大膜：远处亮银，近处深银；波动条带
        var g = ctx.createLinearGradient(0, hy, 0, H);
        g.addColorStop(0, '#e8ecf3'); g.addColorStop(0.08, '#b9c2d3'); g.addColorStop(0.5, '#6f7788'); g.addColorStop(1, '#3a3f4c');
        ctx.fillStyle = g; ctx.fillRect(0, hy, W, H - hy);
        // 地平线辉光
        var gl = ctx.createLinearGradient(0, hy - 30, 0, hy + 2);
        gl.addColorStop(0, 'rgba(230,236,250,0)'); gl.addColorStop(1, 'rgba(230,236,250,0.65)');
        ctx.fillStyle = gl; ctx.fillRect(0, hy - 30, W, 32);
        // 波纹：透视排布的横向明暗带，缓缓移动
        var tt = rm ? 0 : el * 0.12;
        for (var k = 0; k < 42; k++) {
          var u = (k + (tt % 1)) / 42; var y = hy + (H - hy) * (u * u);
          var th = (H - hy) * (2 * u / 42 + 0.002) * 2.2;
          var a = 0.06 + 0.06 * Math.sin(k * 1.7 + el * 0.6);
          ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
          ctx.fillRect(0, y, W, Math.max(1, th * 0.5));
        }
        // 露珠星球（远到近）
        for (i = 0; i < drops.length; i++) drawDrop(ctx, drops[i], W, H, el);
        drawDrop(ctx, big, W, H, el);
        // 近处暗角
        var vg = ctx.createRadialGradient(W / 2, H * 0.6, Math.min(W, H) * 0.3, W / 2, H * 0.6, Math.max(W, H) * 0.85);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      },
      dispose: function () {}
    };
  }

  /* ------------------------------------------------------------ 高维：极其混乱的色彩和形状
   * 现在它只当 highDimScene 的"那一屏"用（画在投影上面，可以揭开），不再是独立的一整个场景；
   * label / status 由 highDimScene 统一给（它要按遮着 / 揭开两种状态说不同的话），这里留着的两条
   * 只在有人单独拿 chaosScene 当场景用时才有意义。 */
  function chaosScene(sim, o) {
    var rnd = rngOf(sim.seed ^ 0x77);         // 布局与配色：只在建场景时抽一次，同一 seed 永远是同一幅
    var rndT = rngOf(sim.seed ^ 0x77c1);      // 运行期事件（隔几秒换掉几个形状）另走一条流，免得帧率去搅上面那幅
    var rm = o.reducedMotion;
    var N = rm ? 60 : 140;
    var DT_MAX = 0.05;                        // dt 兜上限：切走再切回来别一帧跳过半分钟
    var t = 0;                                // 场景自己的慢时钟；reducedMotion 下永远停在 0（近乎静止）
    var swapIn = 2 + rndT() * 2;              // 距离下一次"换掉少量形状"还有几秒

    /* 色彩与节奏的取舍（09-17 用户说「这个彩色动得太快、也不够绚丽」之后重写）：
       v0：hue = rnd()*360、饱和 95%，背景还按帧轮转全色相 —— 一块彩虹屏保，读着像渲染坏了。
       v1：收进 200–270° 冷蓝紫、饱和 12–34%，每 45 ms 整屏重抽 140 个块 —— 不刺眼了，
           但一是灰，二是"整屏高频重抽"只有闪没有动，眼睛读到的是噪点而不是形状。
       v2（现在）：色相放开到整个色轮，但**锚在 4 个色上**、且不随帧轮转 —— 所以是混乱，不是彩虹；
           饱和 45–85%、明度按远近分层；远层 source-over 当色块、近层 'lighter' 烧出光来；
           形状不再重抽，各自带相位地连续漂移 / 旋转 / 呼吸 / 明灭，一个周期几秒到几十秒，
           每 2–4 秒只换掉 3–6 个，还带淡入淡出，所以画面永远在动、永远不闪。
       要的是"极其混乱、瑰丽、不可解析"——一段解不开的高维信号，不是彩虹屏保，也不是关机前的渐变。 */
    var anchors = [0, 0, 0, 0], h0 = rnd() * 360;
    // 四个锚点强制铺开整个色轮（90° 一档、±22° 抖动）：随机间隔试过，容易四个色全挤在一边，
    // 整屏只剩一种色调（实测抽到过一片橄榄绿），那就既不混乱也不绚丽了。
    for (var ai = 0; ai < 4; ai++) anchors[ai] = (h0 + ai * 90 + (rnd() - 0.5) * 44 + 360) % 360;
    var bgHue = anchors[0];

    /* 形状池：建场景时一次性分配 N 个对象，之后**只改字段、不再 new**（每帧零分配）。
       位置与尺寸全按 0..1 归一化存，所以画布改尺寸不用重建。 */
    function reseed(s, R, layFix) {
      var lay = layFix == null ? R() : layFix;            // 0 = 远（大、暗、慢）… 1 = 近（小、亮）
      var hue = (anchors[(R() * 4) | 0] + (R() - 0.5) * 54 + 360) % 360;
      var sat = 45 + R() * 40;                            // 45–85%：够艳，又不到荧光
      var li = 22 + lay * 40 + R() * 12;                  // 明度分层：远 22–34%（底色块），近 62–74%（发光）
      s.lay = lay;
      s.hue = hue;
      s.nx = R(); s.ny = R();
      s.ax = (0.04 + R() * 0.10) * (1.25 - lay);          // 漂移幅度（归一化）：远的走得更远
      s.ay = (0.04 + R() * 0.10) * (1.25 - lay);
      s.wx = 0.10 + R() * 0.30; s.wy = 0.10 + R() * 0.30; // 漂移角频率 → 周期 21–63 s（比呼吸/明灭更慢，读着是漂不是飞）
      s.px = R() * TAU; s.py = R() * TAU;
      // 尺寸偏小（幂 2.0）：大块只是偶尔出现的底噪，满屏都是大块的话叠出来就是一团雾
      s.w = 0.05 + Math.pow(R(), 2.0) * (0.46 - 0.34 * lay);
      s.h = 0.05 + Math.pow(R(), 2.0) * (0.46 - 0.34 * lay);
      s.rot = R() * TAU;
      s.rs = (R() - 0.5) * 0.30;                          // 自转 ≤0.15 rad/s：转一圈 40 s 上下
      s.bs = 0.10 + R() * 0.26;                           // 呼吸幅度
      s.wb = 0.45 + R() * 0.85; s.pb = R() * TAU;         // 呼吸周期 4.8–14 s
      s.wa = 0.35 + R() * 0.90; s.pa = R() * TAU;         // 明灭周期 5.4–18 s
      // 远近两层的不透明度各算各的：远层走 source-over 当色块（要看得见颜色本身），
      // 近层走 lighter 当发光（要能烧起来但不能把底吃掉）
      s.a = lay < 0.5 ? (0.09 + R() * 0.13) : (0.14 + (lay - 0.5) * 0.44 + R() * 0.10);
      var kr = R();
      s.k = kr < 0.20 ? 0 : kr < 0.38 ? 1 : kr < 0.58 ? 2 : kr < 0.74 ? 3 : kr < 0.90 ? 4 : 5;
      // 最近的一层多给些光斑：亮核是绚丽的来源，光全靠描边撑不起来
      if (lay > 0.70 && R() < 0.45) s.k = 4;
      s.n = 3 + ((R() * 7) | 0);
      s.a0 = R() * TAU; s.a1 = s.a0 + 0.6 + R() * 4.2;    // 弧段用
      s.lw = 1 + R() * 2.2;
      // 颜色前缀预拼好：每帧只剩一次"前缀 + alpha + )"，省掉 140×2 次完整 hsla 拼串
      s.cf = 'hsla(' + hue.toFixed(0) + ',' + sat.toFixed(0) + '%,' + li.toFixed(0) + '%,';
      s.cs = 'hsla(' + ((hue + 14) % 360).toFixed(0) + ',' + Math.min(96, sat + 12).toFixed(0) + '%,' + Math.min(92, li + 28).toFixed(0) + '%,';
      s.dying = false;
    }
    var shapes = new Array(N);
    for (var i0 = 0; i0 < N; i0++) { shapes[i0] = {}; reseed(shapes[i0], rnd); shapes[i0].f = 1; }
    shapes.sort(function (a, b) { return a.lay - b.lay; });   // 远的先画、近的压上去；只排这一次

    /* 柔光斑：每帧现 createRadialGradient 上百次太贵，改成开场烤 24 张 96px 的光斑贴图
       （每 15° 色相一张），之后只 drawImage 缩放。宿主拿不到 document 就退回实心椭圆，不让画面塌掉。 */
    var GLOW_N = 24, glow = null, glowFail = false;
    function ensureGlow(ctx) {
      if (glow || glowFail) return glow;
      var doc = (ctx.canvas && ctx.canvas.ownerDocument) || root.document;
      if (!doc || !doc.createElement) { glowFail = true; return null; }
      var arr = new Array(GLOW_N);
      for (var g = 0; g < GLOW_N; g++) {
        var c = doc.createElement('canvas'); c.width = 96; c.height = 96;
        var c2 = c.getContext && c.getContext('2d');
        if (!c2) { glowFail = true; return null; }
        var hu = (g + 0.5) * (360 / GLOW_N);
        var rg = c2.createRadialGradient(48, 48, 0, 48, 48, 48);
        rg.addColorStop(0, 'hsla(' + hu.toFixed(0) + ',92%,78%,1)');
        rg.addColorStop(0.28, 'hsla(' + hu.toFixed(0) + ',88%,58%,0.55)');
        rg.addColorStop(0.62, 'hsla(' + ((hu + 20) % 360).toFixed(0) + ',85%,44%,0.16)');
        rg.addColorStop(1, 'hsla(' + ((hu + 20) % 360).toFixed(0) + ',85%,40%,0)');
        c2.fillStyle = rg; c2.fillRect(0, 0, 96, 96);
        arr[g] = c;
      }
      glow = arr; return glow;
    }
    function glowOf(hue) { return glow ? glow[((hue / (360 / GLOW_N)) | 0) % GLOW_N] : null; }

    var vg = null, vgW = 0, vgH = 0;           // 暗角渐变：只在画布尺寸变了才重建
    return {
      kind: 'chaos',
      // 顶部标注（app.js 的 setDisclaim）：说清楚这不是渲染坏了，是原著里高维宇宙本来就看不了
      get label() { return T('高维宇宙（D=') + dimOf(sim).toFixed(2) + T('）：我们无法观察它 · 屏幕上只有一堆极其混乱的色彩和形状'); },
      caption: '',
      // 顶栏状态位：不写就一直挂着 app.js 的默认值"2D 粒子网"，而这一档根本不是粒子网
      status: function () { return T('无法观察'); },
      draw: function (ctx, W, H, dt, el) {
        var d = dt > 0 ? (dt > DT_MAX ? DT_MAX : dt) : 0;
        if (!rm) t += d;
        ensureGlow(ctx);

        /* 底：深底不动摇，只让色相与明度非常慢地流（周期约 100 s / 57 s）——
           这是"缓慢流动的色调"，不是背景在闪。 */
        var bh = (bgHue + 30 * Math.sin(t * 0.062)) % 360;
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = 'hsl(' + bh.toFixed(1) + ',36%,' + (rm ? 6.5 : (6.2 + 1.8 * Math.sin(t * 0.11))).toFixed(2) + '%)';
        ctx.fillRect(0, 0, W, H);

        ctx.globalCompositeOperation = 'lighter';
        // 四团柔光在底上慢慢挪：给画面一层会呼吸的底色，代价只有 4 次 drawImage。
        // 半径与不透明度都压得很低——铺满整屏的高亮底噪正是上一版糊成一片雾的原因。
        if (glow) {
          var Rb = Math.max(W, H) * 0.42;
          for (var b = 0; b < 4; b++) {
            var bhb = anchors[b];
            var sp = glowOf(bhb); if (!sp) break;
            var bx = W * (0.5 + 0.34 * Math.sin(t * (0.037 + b * 0.013) + b * 2.1));
            var by = H * (0.5 + 0.30 * Math.cos(t * (0.031 + b * 0.017) + b * 1.3));
            ctx.globalAlpha = 0.05 + 0.035 * Math.sin(t * 0.09 + b);
            ctx.drawImage(sp, bx - Rb, by - Rb, Rb * 2, Rb * 2);
          }
          ctx.globalAlpha = 1;
        }

        // 隔 2–4 秒只换掉 3–6 个形状（淡出→重抽→淡入），其余的一直在原地连续地动
        if (!rm) {
          swapIn -= d;
          if (swapIn <= 0) {
            swapIn = 2 + rndT() * 2;
            var q = 3 + ((rndT() * 4) | 0);
            for (var m = 0; m < q; m++) shapes[(rndT() * N) | 0].dying = true;
          }
        }

        /* 两层不同的叠加模式（shapes 已按 lay 远→近排好，所以只切一次状态）：
           远层 source-over —— 大色块互相覆盖，颜色是**颜色**，画面才有实体感；
           近层 lighter    —— 小而亮的形状、线、光斑叠在上面自己烧出光。
           全用 lighter 试过：几十个大块一叠就加满，整屏变成一层均匀的彩雾（看过截图，很难看）。 */
        ctx.globalCompositeOperation = 'source-over';
        var lit = false;
        for (var i = 0; i < N; i++) {
          var s = shapes[i];
          if (!lit && s.lay >= 0.5) { lit = true; ctx.globalCompositeOperation = 'lighter'; }
          if (!rm) {
            if (s.dying) { s.f -= d * 0.9; if (s.f <= 0) { var lf = clamp(s.lay + (rndT() - 0.5) * 0.12, 0, 1); reseed(s, rndT, lf); s.f = 0; } }
            else if (s.f < 1) { s.f += d * 0.8; if (s.f > 1) s.f = 1; }
          }
          var al = s.a * (0.55 + 0.45 * Math.sin(t * s.wa + s.pa)) * s.f;
          if (al < 0.004) continue;
          var x = (s.nx + s.ax * Math.sin(t * s.wx + s.px)) * W;
          var y = (s.ny + s.ay * Math.sin(t * s.wy + s.py)) * H;
          var sc = 1 + s.bs * Math.sin(t * s.wb + s.pb);
          var pw = s.w * W * sc, ph = s.h * H * sc;
          if (s.k === 4) {                         // 柔光斑：不用旋转，直接贴图
            var g4 = glowOf(s.hue), R4 = (pw + ph) * 0.35;
            if (g4) { ctx.globalAlpha = al * 2.4 > 1 ? 1 : al * 2.4; ctx.drawImage(g4, x - R4, y - R4, R4 * 2, R4 * 2); ctx.globalAlpha = 1; }
            else { ctx.fillStyle = s.cf + al.toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(x, y, R4, R4, 0, 0, TAU); ctx.fill(); }
            continue;
          }
          ctx.save();
          ctx.translate(x, y); ctx.rotate(s.rot + t * s.rs);
          ctx.fillStyle = s.cf + al.toFixed(3) + ')';
          if (s.k === 0) ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
          else if (s.k === 1) { ctx.beginPath(); ctx.ellipse(0, 0, pw / 2, ph / 2, 0, 0, TAU); ctx.fill(); }
          else if (s.k === 2) {
            ctx.beginPath();
            for (var j = 0; j < s.n; j++) { var a = j / s.n * TAU; ctx.lineTo(Math.cos(a) * pw / 2, Math.sin(a) * ph / 2); }
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = s.cs + (al * 0.95).toFixed(3) + ')'; ctx.lineWidth = s.lw; ctx.stroke();
          } else if (s.k === 3) {                  // 高亮细线：负责画面里的"结构"，只描边
            ctx.strokeStyle = s.cs + Math.min(1, al * 2.1).toFixed(3) + ')'; ctx.lineWidth = s.lw;
            ctx.beginPath(); ctx.moveTo(-pw, 0);
            for (j = 0; j < 12; j++) ctx.lineTo(-pw + j * pw / 6, Math.sin(j * 1.3 + s.pb + t * s.wb * 0.5) * ph / 2);
            ctx.stroke();
          } else {                                 // 弧段：像信号里残留的一截轨道
            ctx.strokeStyle = s.cs + Math.min(1, al * 1.8).toFixed(3) + ')'; ctx.lineWidth = s.lw * 1.6;
            ctx.beginPath(); ctx.arc(0, 0, (pw + ph) * 0.25, s.a0, s.a1); ctx.stroke();
          }
          ctx.restore();
        }

        // 暗角：把四周压回深色，画面才有"中间烧起来"的层次，而不是一整片均匀的光
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        if (!vg || vgW !== W || vgH !== H) {
          vgW = W; vgH = H;
          vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.22, W / 2, H / 2, Math.max(W, H) * 0.76);
          vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.55, 'rgba(0,0,0,0.20)'); vg.addColorStop(1, 'rgba(0,0,0,0.78)');
        }
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      },
      dispose: function () { glow = null; vg = null; }
    };
  }

  /* ------------------------------------------------------------ 分数维：无际黑平面 + 垂直银线 */
  function fractalScene(sim, o) {
    var rnd = rngOf(sim.seed ^ 0x2d5);
    var rm = o.reducedMotion;
    var lines = [];
    var n = 420;
    for (var i = 0; i < n; i++) lines.push({ x: (rnd() - 0.5) * 60, z: 1 + rnd() * 60, h: 6 + rnd() * 30, b: 0.5 + rnd() * 0.5 });
    var camZ = 0, horizonK = 0.55;
    return {
      kind: 'fractal',
      // 顶部标注：这一档的每个元素都出自原文，标注也照原文的说法写
      get label() { return T('低维宇宙（D=') + dimOf(sim).toFixed(2) + T('）：黑色没有厚度的平面就是这个宇宙的太空，与平面垂直相交的亮线是只有一维的恒星'); },
      caption: '',
      // 顶栏状态位：同上，不写就挂着"2D 粒子网"
      status: function () { return T('黑平面 · 垂直银线'); },
      draw: function (ctx, W, H, dt, el) {
        camZ += rm ? 0 : dt * 0.9;
        var hy = H * horizonK, f = Math.min(W, H) * 0.9;
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
        // 平面本身是"黑色没有厚度"的——只在地平线画一条极淡的银灰分界
        var gl = ctx.createLinearGradient(0, hy - 2, 0, hy + 40);
        gl.addColorStop(0, 'rgba(180,190,210,0.28)'); gl.addColorStop(1, 'rgba(180,190,210,0)');
        ctx.fillStyle = gl; ctx.fillRect(0, hy - 2, W, 42);
        // 收集可见线并按深度排序
        var vis = [];
        for (var i = 0; i < lines.length; i++) {
          var L = lines[i]; var z = ((L.z - camZ) % 60 + 60) % 60 + 0.4;
          var s = f / z; var sx = W / 2 + L.x * s * 0.35; var gy = hy + 4.2 * s;   // 眼高 4.2
          if (sx < -20 || sx > W + 20 || gy < hy) continue;
          // 「与黑的平面**垂直相交**」：亮线穿过平面、两侧都有，不是立在平面上的一根柱子。
          // 这个投影里平面上方 +h 落在 gy − h·s、下方 −h 落在 gy + h·s，所以两段对称。
          // 屏幕上的半长要封顶：近处的线投影出来有几千像素，不封顶就成了一根贯穿全屏的竖条，
          // 满屏竖条会把"有个平面"整个盖掉（实测过，画面变成一片栅栏）。
          var half = Math.min(L.h * s * 0.9, H * 0.62);
          vis.push({ sx: sx, gy: gy, top: gy - half, bot: gy + half, w: clamp(s * 0.05, 0.4, 3.2), a: clamp(L.b * (0.25 + 0.9 / Math.sqrt(z)), 0.08, 1), z: z });
        }
        vis.sort(function (a, b) { return b.z - a.z; });
        ctx.lineCap = 'butt';
        for (i = 0; i < vis.length; i++) {
          var v = vis[i];
          var yT = Math.max(-50, v.top), yB = Math.min(H + 50, v.bot);
          // 亮度从相交点向两端衰减：最亮的地方正是线与平面相交的那一点。
          // 线身整体压暗当尾迹 —— 画面的主体必须是**平面**，一整面这样的交点才看得出有个平面；
          // 线身一亮就糊成栅栏，反而看不出平面（3D 那条路径同理，两边用同一套配比）。
          var g = ctx.createLinearGradient(0, yT, 0, yB);
          g.addColorStop(0, 'rgba(226,234,255,0)');
          g.addColorStop(clamp((v.gy - yT) / Math.max(1, yB - yT), 0.02, 0.98), 'rgba(226,234,255,' + (v.a * 0.5).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(226,234,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = v.w; ctx.beginPath(); ctx.moveTo(v.sx, yT); ctx.lineTo(v.sx, yB); ctx.stroke();
          // 交点：恒星本身，「银光闪闪」的那一点
          var dr = clamp(v.w * 1.4, 0.7, 5);
          if (dr > 2) {
            var hg = ctx.createRadialGradient(v.sx, v.gy, 0, v.sx, v.gy, dr * 2.6);
            hg.addColorStop(0, 'rgba(226,238,255,' + (v.a * 0.4).toFixed(3) + ')'); hg.addColorStop(1, 'rgba(226,238,255,0)');
            ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(v.sx, v.gy, dr * 2.6, 0, TAU); ctx.fill();
          }
          ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, v.a * 1.25).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(v.sx, v.gy, dr * 0.5, 0, TAU); ctx.fill();
        }
      },
      dispose: function () {}
    };
  }

  /* ------------------------------------------------------------ 粒子网结构（大挤压 / 大撕裂 / 热寂 / 黑洞 / 黑暗 / 不育 / 异质 / 灿烂星海） */
  function modeOf(type, cls) {
    switch (type) {
      case 'OBSERVERS_POSSIBLE': return 'starsea';
      case 'BIG_CRUNCH': return 'crunch';
      case 'BIG_RIP': return 'rip';
      case 'BLACK_HOLE_DOMINATED': case 'BLACK_HOLE': return 'blackhole';
      case 'HEAT_DEATH_NO_STRUCTURE': case 'HEAT_DEATH': case 'PARTICLES_ONLY': return 'heat';
      case 'NO_STARS': return 'dark';
      case 'UNSTABLE_ORBITS': return 'unstable';
      case 'ALIEN_LAWS': return 'alien';
      case 'NO_CHEMISTRY': case 'STARS_NO_LIFE': case 'STERILE': return 'sterile';
      default:   // 未知结局 id：按 cls 兜底
        return cls === 'cold' ? 'heat' : cls === 'bad' ? 'dark' : cls === 'weird' ? 'unstable' : 'sterile';
    }
  }
  function nbodyScene(sim, o) {
    var A = o.adapter, MP = root.MirrorParticles, gl = o.gl && o.gl.ok ? o.gl : null;
    var type = sim.outcome.type, mode = modeOf(type, sim.outcome.severity);
    var rm = o.reducedMotion;
    var N = o.particles || (MP ? MP.tierN(null, A.isReal) : 6000);
    if (!gl) N = Math.min(N, 8000);
    var params = Object.assign({}, sim.params);
    if (mode === 'heat') { if (params.Q != null) params.Q = Math.min(params.Q, 0.12 * 2e-5); else if (params.delta != null) params.delta = Math.min(params.delta, 0.12); }
    var pre = mode === 'crunch' ? 260 : mode === 'rip' ? 220 : mode === 'heat' ? 200 : mode === 'blackhole' ? 340 : 300;
    // 空间维数：引擎算出的宏观维数优先（可能是涌现/分数维），传给粒子层换 D 维引力核
    var dimS = dimOf(sim);
    var ps;
    if (MP) ps = MP.createSim(A, params, { N: N, mode: sim.mode, preSteps: pre, preDt: 0.0007, dimS: dimS });
    else {
      var nb = A.createNBody(params, { N: Math.min(N, 8000), mesh: 56, mode: sim.mode });
      for (var q = 0; q < pre && !nb.ended; q++) nb.step(0.0007 * (1 + nb.a * 0.6));
      // nb.density 是 M×M 的网格，不是每粒子数组（同 particles.js 的说明）：这里也要重采样成 Float32Array(N)，
      // 否则 WebGL 的 bufferSubData 长度不符、Canvas2D 的 D[i] 读越界。
      var nbDens = new Float32Array(nb.N), nbM = nb.mesh || 56;
      var nbResample = function () {
        var grid = nb.density, P = nb.positions, NN = nb.N, M = nbM, M2 = M * M, i;
        if (!grid || !P) return;
        if (grid.length !== M2) { for (i = 0; i < NN; i++) nbDens[i] = grid.length >= NN ? grid[i] : 0; return; }
        for (i = 0; i < NN; i++) {
          var gx = (P[2 * i] * M) | 0, gy = (P[2 * i + 1] * M) | 0;
          if (gx >= M) gx = M - 1; else if (gx < 0) gx = 0;
          if (gy >= M) gy = M - 1; else if (gy < 0) gy = 0;
          nbDens[i] = grid[gy * M + gx];
        }
      };
      nbResample();
      ps = { ready: true, worker: false, N: nb.N, get positions() { return nb.positions; }, get density() { return nbDens; }, get a() { return nb.a; }, get dir() { return nb.dir; }, get ended() { return nb.ended; }, get reason() { return nb.reason; }, era: function () { return nb.era ? nb.era() : ''; }, tick: function (dt) { if (!nb) return; nb.step(dt == null ? (nb.suggestDt ? nb.suggestDt() : 0.0006 * (1 + nb.a * 0.6)) : dt); nbResample(); }, dispose: function () { nb = null; } };
    }
    var starsea = mode === 'starsea';
    var stars = [], rnd = rngOf(sim.seed ^ 0xbeef);
    if (starsea || mode === 'sterile') {
      var ns = starsea ? (rm ? 500 : 900) : 260;
      for (var i = 0; i < ns; i++) {
        var col = starsea ? [[255, 255, 255], [200, 220, 255], [255, 235, 190], [255, 205, 150], [180, 200, 255]][(rnd() * 5) | 0] : [[220, 225, 235], [200, 200, 210]][(rnd() * 2) | 0];
        stars.push({ x: rnd(), y: rnd(), r: 0.4 + Math.pow(rnd(), 3) * 2.6, tw: rnd() * TAU, sp: 0.5 + rnd() * 2.5, c: col });
      }
    }
    var endT = -1, holes = null, zoom = 1, fade = 1;
    var glMode = mode === 'heat' ? 'heat' : mode === 'dark' ? 'dark' : mode === 'sterile' ? 'sterile' : mode === 'alien' ? 'alien' : mode === 'starsea' ? 'starsea' : 'normal';
    /* D≤2：引擎判的是"势为对数或排斥，没有牛顿吸引，物质无法聚集"（Tegmark 1997），
       而这里的 PM 核 k^{−(5−D)} 是把牛顿力按 r^{−(D−1)} 一路外推下去的结果，
       屏幕上照样会结出团块 —— 画面与结论正好相反。改不了画（换成一片不动的点阵等于把
       这一档 20% 的宇宙全变成空屏），那就把这句话写在标注里，别让人以为那些团是真的。 */
    var noNewton = isFinite(dimS) && dimS <= 2 + 1e-9;
    return {
      kind: starsea ? 'starsea' : 'nbody',
      get label() { return (Math.abs(dimS - 3) > 1e-9
        ? T('2 维投影 · 引力按 r^{−(D−1)} 衰减（D=') + dimS.toFixed(2) + T('）· 软化长度 ε=') + (1 + Math.min(1, Math.abs(dimS - 3) * 0.5)).toFixed(2) + T(' 网格 · PM N 体模拟')
        : T('PM N 体模拟（真实引力 + Friedmann 背景）')) + (starsea ? T(' · 星点闪烁为示意') : '')
        + (noNewton ? T('　·　注意：引擎判据在 D≤2 没有牛顿吸引（势为对数或排斥，物质无法聚集，Tegmark 1997），屏幕上的成团是把 r^{−(D−1)} 当牛顿力外推出来的，不是这个宇宙里会发生的事') : ''); },
      usesGL: !!gl,
      caption: '',
      sim: ps,
      status: function () { return ps.ready ? ((ps.worker ? 'worker' : 'main') + (gl ? '+webgl2' : '+canvas2d') + ' · ' + ps.N + T(' 粒子')) : T('初始化…'); },
      draw: function (ctx, W, H, dt, el) {
        if (ps.ready && !ps.ended) ps.tick(null);   // null → 用引擎 suggestDt()
        if (ps.ready && ps.ended && endT < 0) endT = el;
        var S = Math.min(W, H) * 0.98, ox = (W - S) / 2, oy = (H - S) / 2;
        var since = endT >= 0 ? el - endT : -1;
        var a = ps.ready ? ps.a : 0.02, dir = ps.ready ? ps.dir : 1;
        if (mode === 'crunch') { zoom = since >= 0 ? Math.max(0.001, 1 - ease(since / 2.2)) : (a < 0.6 && dir < 0 ? clamp(a / 0.6, 0.15, 1) : 1); }
        if (mode === 'rip') { zoom = since >= 0 ? 1 + since * 0.9 : 1 + Math.max(0, a - 3) * 0.25; fade = since >= 0 ? Math.max(0, 1 - since / 3) : 1; }
        var skew = null;
        if (mode === 'alien') { var k = rm ? 0.15 : Math.sin(el * 0.23) * 0.35, rot = rm ? 0.2 : el * 0.05, cr = Math.cos(rot), sr = Math.sin(rot), sy = 1 + Math.cos(el * 0.17) * 0.12; skew = [cr - sr * k, sr + cr * k, cr * (-k * 0.6) - sr * sy, sr * (-k * 0.6) + cr * sy]; }
        if (mode === 'unstable') { var j = rm ? 0 : Math.sin(el * 7.3) * 0.02; skew = [1 + j, 0, 0, 1 - j]; }
        var heat = clamp((0.15 - a) / 0.13, 0, 1);
        var size = Math.max(0.6, 1.5 - Math.log10(Math.max(a, 0.02)) * 0.4);
        // ---- 粒子层
        if (gl) {
          gl.clear(0, 0, 0);
          if (ps.ready) gl.draw(ps, { ox: ox, oy: oy, S: S, W: W, H: H, zoom: zoom, skew: skew, size: size * 2.2, alpha: fade, mode: glMode, heat: heat, time: el });
          ctx.clearRect(0, 0, W, H);
        } else {
          ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
        }
        ctx.save();
        ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom);
        if (skew) ctx.transform(skew[0], skew[1], skew[2], skew[3], 0, 0);
        ctx.translate(-W / 2, -H / 2);
        ctx.globalCompositeOperation = 'lighter';
        if (!gl && ps.ready) {
          var P = ps.positions, D = ps.density, n = ps.N, dim = starsea ? 0.55 : 1;
          // D 必须是每粒子数组（长度 ≥ n）。真短了就当没有密度（0）而不是读越界拿 undefined——
          // undefined 参与算术会把 fillStyle 变成 "rgba(NaN,NaN,NaN,NaN)"，整层粒子直接不画。
          var nD = D && D.length >= n ? D : null;
          for (i = 0; i < n; i++) {
            var dd = nD ? nD[i] : 0, r, g, b, al;
            if (dd > 4) { r = 255; g = 240; b = 200; al = 0.85; }
            else if (dd > 1) { r = 120 + dd * 30; g = 200; b = 255; al = 0.55; }
            else { r = 255 * heat + 90 * (1 - heat); g = 120 * heat + 70 * (1 - heat); b = 47 * heat + 130 * (1 - heat); al = 0.3; }
            if (mode === 'heat') { r = 110; g = 100; b = 120; al = 0.28; }
            if (mode === 'dark') { r = Math.min(r, 90); g = Math.min(g, 80); b = Math.min(b, 110); al *= 0.6; }
            if (mode === 'sterile') { al *= 0.7; }
            if (mode === 'alien') { var hh = (dd * 40 + el * 20) % 360; ctx.fillStyle = 'hsla(' + hh + ',90%,60%,' + (al * 0.8).toFixed(3) + ')'; }
            else ctx.fillStyle = 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + (al * fade * dim).toFixed(3) + ')';
            ctx.fillRect(ox + P[2 * i] * S, oy + P[2 * i + 1] * S, size, size);
          }
        }
        // ---- 黑洞：密度峰处画黑盘 + 吸积辉光
        if (mode === 'blackhole' && ps.ready) {
          // 黑洞位置：只取密度场的局部极大值（周期边界），并保证最小间距，避免一整排相邻格子连成"一串黑球"；半径按质量开方并封顶
          if (!holes) {
            holes = []; var P2 = ps.positions, n2 = ps.N, G = 56, cnt = new Float32Array(G * G);
            for (i = 0; i < n2; i++) { cnt[((P2[2 * i + 1] * G) | 0) * G + ((P2[2 * i] * G) | 0)]++; }
            var peaks = [];
            for (var gy = 0; gy < G; gy++) for (var gx = 0; gx < G; gx++) {
              var c0 = cnt[gy * G + gx]; if (c0 < n2 / (G * G) * 3) continue;   // 至少 3 倍平均密度
              var isMax = true;
              for (var dy = -1; dy <= 1 && isMax; dy++) for (var dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; var nx = (gx + dx + G) % G, ny = (gy + dy + G) % G; if (cnt[ny * G + nx] > c0) { isMax = false; break; } }
              if (isMax) peaks.push({ x: (gx + 0.5) / G, y: (gy + 0.5) / G, c: c0 });
            }
            peaks.sort(function (a1, b1) { return b1.c - a1.c; });
            var minSep = 0.06;   // 盒长的 6%
            for (i = 0; i < peaks.length && holes.length < 18; i++) {
              var pk = peaks[i], ok = true;
              for (var j = 0; j < holes.length; j++) { var ddx = Math.abs(pk.x - holes[j].x), ddy = Math.abs(pk.y - holes[j].y); ddx = Math.min(ddx, 1 - ddx); ddy = Math.min(ddy, 1 - ddy); if (ddx * ddx + ddy * ddy < minSep * minSep) { ok = false; break; } }
              if (ok) holes.push({ x: pk.x, y: pk.y, rBox: Math.min(0.045, 0.006 + Math.sqrt(pk.c / n2) * 0.10) });
            }
          }
          var grow = 1 + Math.min(0.6, el * 0.06);
          function eachHole(fn) { for (var hi = 0; hi < holes.length; hi++) { var hh2 = holes[hi], Rr = hh2.rBox * S * grow; for (var ty = -1; ty <= 1; ty++) for (var tx = -1; tx <= 1; tx++) { var hx2 = ox + (hh2.x + tx) * S, hy2 = oy + (hh2.y + ty) * S; if (hx2 < -Rr * 3 || hx2 > W + Rr * 3 || hy2 < -Rr * 3 || hy2 > H + Rr * 3) continue; fn(hx2, hy2, Rr); } } }
          eachHole(function (hx, hy, R) {
            var gg = ctx.createRadialGradient(hx, hy, R * 0.9, hx, hy, R * 2.6);
            gg.addColorStop(0, 'rgba(255,170,90,0.55)'); gg.addColorStop(0.5, 'rgba(255,90,40,0.18)'); gg.addColorStop(1, 'rgba(255,90,40,0)');
            ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(hx, hy, R * 2.6, 0, TAU); ctx.fill();
          });
          ctx.globalCompositeOperation = 'source-over';
          eachHole(function (hx, hy, R) { ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(hx, hy, R, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,220,180,0.7)'; ctx.lineWidth = 1; ctx.stroke(); });
        }
        // ---- 灿烂星海：星点闪烁 + 少数亮星光芒
        if (stars.length) {
          ctx.globalCompositeOperation = 'lighter';
          for (i = 0; i < stars.length; i++) {
            var st = stars[i]; var tw = rm ? 0.85 : 0.6 + 0.4 * Math.sin(el * st.sp + st.tw);
            var rr = st.r * (0.8 + 0.4 * tw), x = st.x * W, y = st.y * H;
            ctx.fillStyle = 'rgba(' + st.c[0] + ',' + st.c[1] + ',' + st.c[2] + ',' + (0.55 + 0.45 * tw).toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
            if (st.r > 2.2 && starsea) {
              ctx.strokeStyle = 'rgba(' + st.c[0] + ',' + st.c[1] + ',' + st.c[2] + ',' + (0.25 * tw).toFixed(3) + ')'; ctx.lineWidth = 1;
              var L = rr * 5; ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke();
              var hg = ctx.createRadialGradient(x, y, 0, x, y, rr * 6); hg.addColorStop(0, 'rgba(' + st.c[0] + ',' + st.c[1] + ',' + st.c[2] + ',0.35)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, rr * 6, 0, TAU); ctx.fill();
            }
          }
        }
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        if (mode === 'crunch' && since > 1.6) { var kk = clamp((since - 1.6) / 0.8, 0, 1); var rg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 40 * (1 - kk) + 2); rg.addColorStop(0, 'rgba(255,90,60,' + (1 - kk * 0.6) + ')'); rg.addColorStop(1, 'rgba(255,90,60,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); }
      },
      dispose: function () { if (ps && ps.dispose) ps.dispose(); ps = null; }
    };
  }

  /* ------------------------------------------------------------ 高维（D>3）：那一屏 + 出口 + 底下的投影
   * 原著第八章（research/mirror-notes.md §3.3）那一击照给：进去先是「一堆极其混乱的色彩和形状」
   * 加上「我们无法观察它」。区别在于白冰是**关掉**，这里给一个明确的出口：点画面 / 点按钮 / 按 Enter
   * 就揭开，露出底下**一直在跑**的 PM N 体投影（引力按 D 维核，与 3D 那条路同一套）。
   * 为什么必须留投影：4000 个链上派生宇宙里 D>3 占 56.9%，一层盖死等于一半以上的宇宙点进去没东西看
   * （链上已铸的 D=8.5 / D=12.5 两个 NFT 也在这一档）。
   *
   * 两条渲染路径要一致：那块字、出口按钮、揭开后的常驻提示、会话记忆全部复用
   * MirrorUniverse3D.createDimVeil —— 3D 主路径和这条 2D 回退看到的是同一个部件、同一份记忆，
   * 在 3D 里揭开过，退回 2D 就不会再拦一次（反过来也一样）。
   * 底下的画面这里照旧自己画：2D 是 nbodyScene 画在 #stage 上，3D 是 WebGL 画在 #gl3d 上。 */
  function highDimScene(sim, o) {
    var U = root.MirrorUniverse3D;
    var mkVeil = U && typeof U.createDimVeil === 'function' ? U.createDimVeil : null;
    var D = dimOf(sim);
    var inner = nbodyScene(sim, o);        // 底下一直在跑的投影（建了就一直 tick，遮着也不停）
    var veil = chaosScene(sim, o);         // 「极其混乱的色彩和形状」那一屏
    /* 部件建不出来（理论上只有没有 universe3d 的构建才会这样，index.html 与 dist 里它一定在前面）
       就直接给投影，不再遮 —— 没有出口的遮罩正是这次要改掉的东西，宁可少那一屏也不能把画面盖死。 */
    var veiled = !!mkVeil && !U.dimVeilRevealed();
    var ui = null, host = null;
    // 改成函数：切语言后每次读都按当前词典重拼（inner.label 本身也已经是 getter，跟着一起新）
    function LAB_HEAD() { return T('高维宇宙（D=') + D.toFixed(2); }
    function LAB_TAIL() { return T(' · 底层仍在跑：') + inner.label; }
    function LAB_VEIL() { return LAB_HEAD() + T('）：我们无法观察它 · 屏幕上只有一堆极其混乱的色彩和形状') + LAB_TAIL(); }
    function LAB_OPEN() { return LAB_HEAD() + T('）：屏幕上是它的二维投影，这个宇宙本身我们无法直接观察') + LAB_TAIL(); }
    /* 顶部标注（.disclaim）：app.js 在建完场景时设一次，2D 这条路之后不再刷新它，
       于是揭开之后那行字还在说"屏幕上只有一堆混乱的色彩"，和眼前的画面对不上。
       这里只在它**还是我们写的那句**时改写 textContent；换成别的文案（进镜像、回放…）一律不碰。
       不新增、不改动任何 id/class/事件绑定，只改一个文本节点。 */
    function swapDisclaim(from, to) {
      try {
        var doc = root.document, el = doc && doc.querySelector ? doc.querySelector('.disclaim') : null;
        if (el && el.textContent === T(from)) el.textContent = T(to);
      } catch (e) { /* 宿主没有这一条就算了 */ }
    }
    return {
      kind: inner.kind,
      usesGL: inner.usesGL,
      sim: inner.sim,                      // 时间轴与分析面板照常拿得到粒子数据（遮着的时候也在跑）
      get label() { return veiled ? LAB_VEIL() : LAB_OPEN(); },
      caption: '',
      status: function () { return veiled ? T('无法观察') : inner.status(); },
      draw: function (ctx, W, H, dt, el) {
        if (!ui && mkVeil && ctx.canvas && ctx.canvas.parentNode) {
          host = ctx.canvas.parentNode;
          ui = mkVeil(host, {
            dim: D, exitText: T('仍然要看它的二维投影'), tipHead: T('屏幕上是它的二维投影（D='),
            onChange: function (rev) {
              veiled = !rev;
              swapDisclaim(rev ? LAB_VEIL() : LAB_OPEN(), rev ? LAB_OPEN() : LAB_VEIL());
            }
          });
          if (ui) ui.setVisible(true);
        }
        inner.draw(ctx, W, H, dt, el);                  // 引擎不因为盖了一层就停（与 3D 一致）
        if (veiled) veil.draw(ctx, W, H, dt, el);       // 那一屏盖在上面：整幅不透明，底下的 WebGL 层也被挡住
      },
      dispose: function () {
        if (ui) { try { ui.dispose(); } catch (e) { /* ignore */ } ui = null; }
        try { veil.dispose(); } catch (e2) { /* ignore */ }
        inner.dispose();
      }
    };
  }

  /* 「近空宇宙」（有空间有时间，却没有可发光的东西）的触发判据。
     两条都只用引擎自己的字段与阈值，不新增任何常数：
       A  calc.baryons.hasBaryons === false 且 calc.structure.structureFormed === false
          （engine.js calcBaryogenesis：Sakharov CP 破坏不足或 Ω_b=0；calcStructure：星系尺度涨落从未越过 δ_c=1.686）
       B  结局 HEAT_DEATH_NO_STRUCTURE 且 σ₈ 低于引擎 R_GROWTH 自己的 fail 线 0.05
          （engine.js 判 verdict 用的就是这个数：sigma8 < 0.05 → 'fail'；σ₈ 为 null = a=1 前已坍缩，同样算命中）
     实测 10000 个链上派生宇宙合计命中 1.72%（A 1.67% + B 0.05%）：既不是死代码，也不会淹掉别的画面。
     引擎不给「粒子总数」这种量，所以标注里一个具体粒子数都不写。 */
  /* 与 ui/app.js 的 isNearEmpty 同一份（两个文件之间没有共享工具模块，dimOf 也是各写一份）。 */
  function isNearEmpty(sim) {
    var c = sim && sim.raw && sim.raw.calc;
    if (!c || !c.baryons || !c.structure) return false;
    if (c.baryons.hasBaryons === false && c.structure.structureFormed === false) return true;
    var t = sim.outcome && sim.outcome.type, s8 = c.structure.sigma8;
    return t === 'HEAT_DEATH_NO_STRUCTURE' && (s8 == null || s8 < 0.05);
  }
  /* 冷液体宇宙的变体判据（与 ui/app.js 的 isOceanVariant 同一份）：
     sim.variant 由 ui/adapter.js 透传；沙盘/旧数据没带 variant 时回退去看引擎的 calc.ocean.pass。 */
  function isOceanVariant(sim) {
    if (!sim) return false;
    if (sim.variant === 'ocean') return true;
    var c = sim.raw && sim.raw.calc;
    return !!(c && c.ocean && c.ocean.pass);
  }
  function create(sim, opts) {
    opts = opts || {};
    var t = sim.outcome.type;
    // ---- 1. 与维数无关的两类画面先走：它们本来就不是粒子网，原著里也是各自独立的一次演示。
    //  实测（4000 个链上派生宇宙）D≠3 只会得到 UNSTABLE_ORBITS / BEYOND_MODEL_DIM，
    //  不会同时是 SPACE_ANNIHILATED / NEAR_EMPTY / LIQUID_OCEAN，所以这两条前置不会吃掉下面的维数分档。
    if (t === 'SPACE_ANNIHILATED' || t === 'NEAR_EMPTY' || (sim.outcome.severity === 'void' && !/OBSERV/.test(t))) return blackScene(sim, opts);
    /* 近空宇宙：有空间有时间，却没有可发光的东西。判据见文件上方 isNearEmpty 的注释
       （全部取自引擎已有字段与阈值，实测链上派生命中 1.72%）。放在维数分档之前：
       一个没有重子、连团块都没有的宇宙，本来也没有东西可以「混乱地闪」。
       与 ui/app.js 的 scene2DOnly 同一条，3D 主路径也会让位给这块黑屏，两条路径都到得了。 */
    if (isNearEmpty(sim)) return blackScene(sim, opts);
    if (t === 'LIQUID_OCEAN') return oceanScene(sim, opts);
    /* 冷液体宇宙：结局仍是既有的 NO_STARS（合约写死 outcome>11 即 revert，12 项结局一个都不能加），
       只多一个由引擎 R_OCEAN 判出来的变体标记 sim.variant='ocean'（engine.js calcOcean：
       塌缩时标>宇宙年龄 ∧ 没有恒星点燃 ∧ 有原子与刚性分子 ∧ 背景温度落在分子液态温区）。
       放在维数分档之前：这类宇宙实测都是 D=3（D≠3 的结局是 UNSTABLE_ORBITS / BEYOND_MODEL_DIM，
       根本到不了 NO_STARS），所以这一条不会吃掉 chaos / plane 两档。 */
    if (t === 'NO_STARS' && isOceanVariant(sim)) return oceanScene(sim, opts);
    // ---- 2. 显式的维数结局 id：引擎现在不产出，将来若产出仍然直达（留着，不是死代码的理由见下）
    if (t === 'HIGH_DIM_UNOBSERVABLE') return highDimScene(sim, opts);
    if (t === 'FRACTAL_DIM' || t === 'LOW_DIM') return fractalScene(sim, opts);
    // ---- 3. 按**维数**路由，不按结局标签（见上面 dimView 的注释与原文出处）。
    //  原来这里是"UNSTABLE_ORBITS 一律走粒子网"，而 D≠3 的宇宙结局全是 UNSTABLE_ORBITS，
    //  于是上面两个忠于原著的场景变成了永远走不到的死代码。
    var dv = dimView(dimOf(sim));
    // D>3：先给「混乱的色彩和形状 + 我们无法观察它」，给出口；揭开后是底下一直在跑的投影
    if (dv === 'chaos') return highDimScene(sim, opts);
    // 2≤D<3：黑平面 + 垂直银线。**没有出口、不揭开** —— 原著里这就是这个宇宙的样子，不是一层遮罩
    if (dv === 'plane') return fractalScene(sim, opts);
    // D<2（原文没写）与 D=3：粒子网，引力按 D 维核 k^{−(5−D)} 求解
    return nbodyScene(sim, opts);
  }

  root.MirrorScenes = { create: create, dimView: dimView, dimOf: dimOf, isNearEmpty: isNearEmpty, isOceanVariant: isOceanVariant };
})(typeof window !== 'undefined' ? window : this);
