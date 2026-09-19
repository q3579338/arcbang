/*
 * ui/hyper.js —— 真·D 维 N 体 + 可换轴的投影（specs/highdim-v1.md §一）
 * ------------------------------------------------------------
 * 浏览器全局 window.MirrorHyper。无外部依赖、无 import、ES5 风格，可被 build.js 直接内联。
 *
 *   const H = window.MirrorHyper;
 *   H.isSupported()                        → {webgpu, webgl2}
 *   const h = H.create(hostElement, {cosmology, seed, dimS, boxMpc, tier, force, onStatus, reducedMotion});
 *   h.ready (Promise) · h.start()/pause()/setTime(tGyr)/getState()/resize()/dispose()
 *   h.setAxes([i,j,k]) · h.randomAxes() · h.stepAxes(±1) · h.toggleSlice() · h.setSliceEps(e)
 *
 * 为什么要有这个模块（规格原话）：D≥4 的宇宙占链上的一半以上，而它们现在看到的那张粒子网
 * **不是高维数据**——它是 3 维 PM 模拟把泊松核换成 k^{−(5−D)} 之后的产物，粒子只有 3 个坐标。
 * 这里换成在**真的 D 维空间**里做直接求和 N 体：每个粒子有 D 个坐标、D 个速度分量，
 * 力律 F ∝ r^{−(D−1)} 直接写进核里（分数维就把 D 代成小数，同一份代码）。
 *
 * ── 物理约定（与 ui/planets.js 的轨道演示同一套口径，同一个 D 下两处数值一致）──
 *   加速度幅度  g(r) = amp · r / (r² + ε²)^{D/2}，  amp = R_NORM^{D−3}
 *   ⇒ r ≫ ε 时 g(r) = amp · r^{1−D}，且 g(R_NORM) = R_NORM^{−2}
 *   也就是「核以最大尺度归一」：在最大尺度 R_NORM（= 半个盒长，周期盒里两点能拉开的最远距离）上，
 *   D 维引力与 3 维牛顿引力**强度相同**，差别只在更小的尺度上显出来。D=3 时 amp=1，退化成牛顿。
 *   planets.js 的 accelD 是同一式子的 R_NORM=1、ε=0 特例（f = −1/r^{D−1}/r，在 r=1 处 g=1）。
 *
 *   软化长度 ε：D 维下的平均粒子间距 N^{−1/D} 的 0.30 倍，封在 [0.004, 0.16] 盒长之间。
 *   ——D 越高粒子在盒子里离得越开（14 维下 2000 个粒子两两约 0.5 盒长），ε 必须跟着 D 长，
 *     否则近碰撞的 r^{−13} 会把步长逼到 0；反过来 D 小的时候 ε 也不能大到把引力吃掉。
 *
 *   共动坐标 + Hubble 阻尼：正则动量 u = a²·dx/dτ（τ 以 1/H0 为单位），与 ui/universe3d.js 一致。
 *       dx/dτ = u / a²            ← a 变大，同一个 u 推出的共动位移变小，这就是 Hubble 阻尼
 *       du/dτ = g，  g_i = −(1.5·Ω_m)/(4π·a·N) · Σ_{j≠i} amp·dx_ij/(r²+ε²)^{D/2}
 *   （由 ∇²φ = 1.5·Ω_m·δ/a 的点源格林函数得来；D=3 时与 PM 那条路完全同一个方程。）
 *   a(τ) 由引擎给的 Ω_r/Ω_m/Ω_k/Ω_Λ 积 Friedmann 方程得到，时间轴照常驱动它。
 *
 *   积分：leapfrog KDK，步长自适应（dlna 上限 + 加速度/速度判据），**子步数有硬上限**，
 *   超预算本帧到此为止（照 ui/planets.js stepThreeBody / stepOrbitDemo 的先例）。
 *
 * ── 预期结果就是「不成团」──
 *   D≥4 时 r^{−(D−1)} 没有束缚态（Ehrenfest 1917）：粒子要么互相飞散，要么两两坠核。
 *   这正是要给玩家看的物理事实，代码里没有任何让它「好看一点」的修正。
 *
 * ── 投影 ──
 *   渲染时把 D 维位置投到玩家选定的 3 根轴 (x_i, x_j, x_k)，其余维度折进颜色与亮度：
 *   第一根未选中的轴映射色相，剩余维度到盒心的范数映射亮度。换一组轴，同一份数据整个重排
 *   ——「同一个宇宙无限多张脸」，3 维宇宙没有的玩法。
 *   D<4 时没有「剩余维度」，色相改用速度（HUD 会写明）。
 *
 * ── 两档后端 ──
 *   WebGPU（N 16k–32k）：位置/速度常驻 GPU，compute shader 做直接求和与投影，
 *                        每帧只回读 N×4 个 float 的投影结果；画面仍由 WebGL2 画（两套上下文各用各的画布）。
 *   Worker CPU（N 1k–3k）：物理全在 Worker 里跑，主线程只做投影 + 画点。
 *   没有 WebGPU 适配器、WGSL 编译失败、设备丢失 —— 任何一步出问题都自动落到 CPU 档。
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var TAU = Math.PI * 2;
  /* 中英文案：词典在 web/i18n-app.js（与 ui/scenes.js / ui/universe3d.js 同一命名空间）；
     i18n 没加载时静默退回中文。 */
  function T(s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'app') : s); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmtNum(x, d) { return Number(x).toFixed(d == null ? 2 : d); }
  function fmtBig(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var SUBS = '₀₁₂₃₄₅₆₇₈₉';
  function sub(n) { return String(n).replace(/\d/g, function (c) { return SUBS[+c]; }); }
  function axName(i) { return 'x' + sub(i + 1); }          // 轴从 1 开始数：HUD 上写 (x₃,x₇,x₁₂)
  function hash32(a) { a = a >>> 0; a = (a ^ 61) ^ (a >>> 16); a = Math.imul(a, 9) >>> 0; a ^= a >>> 4; a = Math.imul(a, 0x27d4eb2d) >>> 0; a ^= a >>> 15; return a >>> 0; }
  function hashMix(a, b) { return hash32((a >>> 0) ^ Math.imul(b >>> 0, 0x9E3779B1)); }
  var _rmq = null, _rmqTried = false;
  function reducedMotion() {
    if (!_rmqTried) { _rmqTried = true; try { _rmq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { _rmq = null; } }
    return !!(_rmq && _rmq.matches);
  }

  /* ============================================================
   * §1 物理核 —— 主线程与 Worker 共用同一份源码
   * ------------------------------------------------------------
   * 整个函数体会被 toString() 出来塞进 Worker 的 Blob，所以：
   *   - 里面不许引用闭包外的任何东西（T()/root/… 一律不行）
   *   - 只用 ES5 + TypedArray
   * ============================================================ */
  function HKERNEL() {
    'use strict';
    var R_NORM = 0.5;          // 归一半径：半个盒长 = 周期盒里两点能拉开的最远距离 = 「最大尺度」
    var FOURPI = 4 * Math.PI;

    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    /* 坐标轴条数 n：整数 D 就是 D 根轴；分数维取 ⌈D⌉ 根
       （D=1.5 → 2 根、D=2.5 → 3 根、D=3.5 → 4 根）。
       力律指数一律用**没有取整的 D**，分数维只通过指数起作用——这一点与 ui/planets.js 一致；
       不同的是 planets 给所有分数维固定 3 根轴，这里按 ⌈D⌉ 给，
       否则 D=1.5 的宇宙会凭空多出两根它没有的轴（而画面正是要给人看轴数的）。 */
    function nDimOf(D) {
      D = +D; if (!isFinite(D) || D <= 0) D = 3;
      var n = (Math.abs(D - Math.round(D)) < 1e-9) ? Math.round(D) : Math.ceil(D);
      return Math.max(1, Math.min(18, n));
    }
    /* 软化长度：D 维平均粒子间距的 0.20 倍，封在 [0.003, 0.09] 盒长。
       上限从 0.16 收到 0.09（2026-09-17）：0.16 差不多有半个归一半径那么大，
       近距离那一段 r^{−(D−1)} 被整个抹平，两两坠核/弹开根本看不出来。
       再往下收就要配一个按加速度自适应的步长才稳得住 —— CPU 档本来就有（suggestDt 的 dAcc 判据），
       GPU 档是定步长，所以 0.09 是「既看得见近距离相互作用、定步长又不会积出垃圾」的下界。 */
    function softOf(n, N) {
      var spacing = Math.pow(Math.max(2, N), -1 / Math.max(1, n));
      return Math.min(0.09, Math.max(0.003, 0.20 * spacing));
    }
    // 核归一系数：g(R_NORM) = R_NORM^{−2}，D=3 时为 1
    function ampOf(D) { return Math.pow(R_NORM, D - 3); }

    /* Friedmann 背景：E(a)² = Ω_r/a⁴ + Ω_m/a³ + Ω_k/a² + Ω_Λ（τ 以 1/H0 计）
       E² ≤ 0 即转向坍缩：此后 a 递减（大挤压那一支）。 */
    function esq(cos, a) {
      var ia = 1 / Math.max(a, 1e-8);
      return cos.OmR * ia * ia * ia * ia + cos.OmM * ia * ia * ia + cos.OmK * ia * ia + cos.OmL;
    }
    function eOf(cos, a) { var e2 = esq(cos, a); return e2 > 0 ? Math.sqrt(e2) : 0; }

    /* 初始条件：D 维盒子里的近均匀分布 + Zel'dovich 位移（增长模）+ 小随机速度。
       整条链只吃 seed（区块哈希派生），同一哈希同一初态。

       2026-09-17 真机反馈「不同的轴只是色彩有点变化」之后重写过一次，两处是实打实的物理错：

       1) **位移方向原来是随机的**。Zel'dovich 位移必须**沿波矢方向**（纵模）：
          密度反差 δ ≈ −∇·Ψ，横向位移的散度为零 —— 随机方向等于绝大部分位移不产生任何密度反差，
          初态只是「抖了一下的均匀分布」，那么它在**任何**投影下都长一样。现在 Ψ = Σ A_m k̂_m sin(2πk_m·x+φ_m)。

       2) **幅度太小**（~2% 盒长）。现在按**目标 δ_rms** 反推振幅：
          单模 δ_m = −2π|k|A_m cos(…)，rms = 2π|k|A_m/√2，各模独立求和
          ⇒ δ_rms = √(Σ (2π|k_m|A_m)²/2)，把整体缩放系数定成命中 DELTA_RMS。

       还有一处是**为了让换轴真的换一张脸**：每个模只让 1–3 根轴参与（其余分量为 0）。
       这样它在「恰好选中了这几根轴」的投影里是清清楚楚的薄层/条纹，在别的投影里被积分掉、几乎看不见。
       换一组轴 = 换一组还看得见的模 —— 这是初态自带的各向异性，不是画上去的。
       D≥4 下引力不会放大它（没有束缚结构），所以屏幕上这些结构**始终只是初始条件本身**，
       HUD 会照实这么写。 */
    /* 2026-09-17 第二轮：**少而强**。上一版摊了 50 个模去凑 δ_rms=0.45，每个模只剩 ~0.06，
       再叠上几千个粒子的散粒噪声，屏幕上一条带也看不见；整盒投影把其余 n−3 维积掉之后更没了。
       现在一个宇宙只取 3–8 个模（个数由哈希定），每个模自己就有 δ≈0.30–0.50，
       波矢只沿 1–2 根轴、|k|∈{1,2} —— 整盒尺度的粗带/大薄层。
       于是：选中含该轴的三元组 → 几条粗带清清楚楚；不含 → 那一面是均匀的。这才是「一张脸换另一张」。 */
    var DELTA_MIN = 0.30, DELTA_MAX = 0.50;   // 单模密度反差（rms）
    var DELTA_RMS_CAP = 0.8;                  // 总 δ_rms 上限
    /* |∇Ψ| 最坏情况的上限。1.5 时这道闸先咬，把 δ_rms 压到 0.38–0.53，屏幕上带子还是太淡；
       3.0 让 δ_rms 闸（0.8）先咬。代价是局部会出现壳层交叉（雅可比本征值过 −1，薄层折叠成多流区）
       —— 那正是 Zel'dovich 薄层之所以亮的原因，而这个幅度本来就已经标成「可视化取值」了。 */
    var GRAD_CAP = 3.0;
    function makeIC(cfg) {
      var n = cfg.n, N = cfg.N, a = cfg.aIc, cos = cfg.cos;
      var rnd = mulberry32(cfg.seed >>> 0);
      var pos = new Float32Array(N * n), vel = new Float32Array(N * n), i, d, m, q;
      for (i = 0; i < N * n; i++) pos[i] = rnd();
      var M = 3 + ((rnd() * 4) | 0);          // 3–6 个模，由哈希定（模越少，每个分到的振幅越大）
      if (n < 3) M = Math.min(M, 4);          // 一两根轴的宇宙塞不下那么多独立方向
      var waves = [], sum2 = 0, gradMax = 0;
      for (m = 0; m < M; m++) {
        var k = new Float32Array(n), k2 = 0, axes = [];
        /* 只沿 1–2 根轴：沿一根轴的模就是一组**垂直于那根轴的平板**，选中那根轴时是粗带，
           没选中时被整个积分掉（切片模式下只要有一根轴被选中就还看得见，见 visibleModes）。 */
        var nAx = (n >= 2 && rnd() > 0.65) ? 2 : 1;
        for (q = 0; q < nAx; q++) {
          var ax = (rnd() * n) | 0;
          if (k[ax]) continue;
          var kv = rnd() < 0.7 ? 1 : 2;       // |k_i| ∈ {1,2}：整盒尺度，积分不掉
          k[ax] = rnd() < 0.5 ? -kv : kv;
          axes.push(ax);
        }
        for (d = 0; d < n; d++) k2 += k[d] * k[d];
        if (!k2) { var a0 = (rnd() * n) | 0; k[a0] = 1; k2 = 1; axes = [a0]; }
        var kn = Math.sqrt(k2);
        // 先定这个模自己的密度反差，再反推位移振幅：δ_m = 2π|k|A_m/√2
        var dm = DELTA_MIN + (DELTA_MAX - DELTA_MIN) * rnd();
        var A = dm * Math.SQRT2 / (2 * Math.PI * kn);
        waves.push({ k: k, kn: kn, A: A, ph: rnd() * Math.PI * 2, axes: axes, delta: dm });
        sum2 += dm * dm;
        gradMax += 2 * Math.PI * kn * A;      // 各模的 |∂Ψ/∂q| 上界之和（最坏情况：全在同一点同向对齐）
      }
      /* 两道闸：总 δ_rms 不超过 DELTA_RMS_CAP；最坏情况的 |∇Ψ| 不超过 GRAD_CAP
         （雅可比 I+∂Ψ/∂q 的本征值掉到 −1 以下就是壳层交叉，薄层会折叠成多流区）。哪道先咬用哪道。 */
      var dRms = Math.sqrt(sum2), scale = 1;
      if (dRms > DELTA_RMS_CAP) scale = DELTA_RMS_CAP / dRms;
      if (gradMax * scale > GRAD_CAP) scale = GRAD_CAP / gradMax;
      if (scale !== 1) { for (m = 0; m < M; m++) { waves[m].A *= scale; waves[m].delta *= scale; } dRms *= scale; }
      // 增长模的速度：u = a²·dx/dτ，线性增长 dΨ/dτ ≈ f·H·a·Ψ ⇒ u ≈ a²·a·E(a)·Ψ（f≈1，物质主导）
      var vf = a * a * a * eOf(cos, a);
      for (i = 0; i < N; i++) {
        for (m = 0; m < M; m++) {
          var w = waves[m], ph = w.ph;
          for (d = 0; d < n; d++) ph += Math.PI * 2 * w.k[d] * pos[i * n + d];
          var s = Math.sin(ph) * w.A / w.kn;              // 沿 k̂ = k/|k|
          for (d = 0; d < n; d++) { var dx = s * w.k[d]; pos[i * n + d] += dx; vel[i * n + d] += vf * dx; }
        }
        // 小随机速度：一点热运动，量级远小于增长模
        for (d = 0; d < n; d++) vel[i * n + d] += (rnd() - 0.5) * vf * 0.004;
      }
      for (i = 0; i < N * n; i++) { pos[i] -= Math.floor(pos[i]); }
      // waveAxes：每个模真正起伏的那 1–2 根轴。UI 靠它算「这组投影轴里还看得见几个模」
      return { pos: pos, vel: vel, deltaRms: +dRms.toFixed(3), modes: M,
               waveAxes: waves.map(function (w) { return w.axes.slice(); }) };
    }

    /* 直接求和加速度（对称：一次算出 i、j 两边）。
       out 必须是 N*n 的 Float32Array，函数内部会先清零。
       cg = 1.5·Ω_m/(4π·a·N)，amp = R_NORM^{D−3}，eps2 = ε²，pe = D/2（pow 的指数）。 */
    function accel(pos, out, n, N, cg, amp, eps2, pe) {
      var i, j, d, base, bj, r2, s, dr = new Float64Array(n);
      for (i = 0; i < N * n; i++) out[i] = 0;
      var C = cg * amp, pow = Math.pow;
      /* (r²+ε²)^{D/2} 是内层最贵的一句（N=3000 时每步要算 450 万次）。
         引擎把 D 量化成 0.5 的整数倍，所以 pe=D/2 一定是 0.25 的整数倍
         ⇒ q^{pe} = (q^{1/4})^{4·pe}，两次 sqrt（硬件指令）+ 一个整数快速幂就够，不用 Math.pow。
         实测 D=14 从 123 ms/步降到 103 ms/步，D=2.5 那种分数维降得更多。
         万一 pe 不是 0.25 的整数倍（将来引擎换量化粒度），老老实实退回 Math.pow。 */
      var q4 = (Math.abs(pe * 4 - Math.round(pe * 4)) < 1e-9 && pe >= 0 && pe * 4 <= 80) ? Math.round(pe * 4) : -1;
      for (i = 0; i < N; i++) {
        base = i * n;
        for (j = i + 1; j < N; j++) {
          bj = j * n; r2 = 0;
          for (d = 0; d < n; d++) {
            var v = pos[base + d] - pos[bj + d];
            // 周期最小像：盒长 1，位移折进 [−0.5, 0.5]
            if (v > 0.5) v -= 1; else if (v < -0.5) v += 1;
            dr[d] = v; r2 += v * v;
          }
          var q = r2 + eps2;
          if (q4 >= 0) { var b2 = Math.sqrt(Math.sqrt(q)), e2 = q4, acc2 = 1; while (e2 > 0) { if (e2 & 1) acc2 *= b2; b2 *= b2; e2 >>= 1; } s = C / acc2; }
          else s = C / pow(q, pe);
          for (d = 0; d < n; d++) { var f = s * dr[d]; out[base + d] -= f; out[bj + d] += f; }
        }
      }
      return out;
    }

    // 最大加速度 / 最大速度（定步长判据用）
    function maxNorm(arr, n, N) {
      var i, d, m = 0, s;
      for (i = 0; i < N; i++) { s = 0; for (d = 0; d < n; d++) { var v = arr[i * n + d]; s += v * v; } if (s > m) m = s; }
      return Math.sqrt(m);
    }

    /* 一个 KDK 步。st = {pos, vel, acc, a, tau, n, N, D, eps, amp, cos, dir}
       dir = +1 膨胀 / −1 坍缩。返回实际用掉的 dτ。 */
    function stepKDK(st, dtau) {
      var n = st.n, N = st.N, i, half = 0.5 * dtau;
      // K：半步踢（用进入这一步时已经算好的 acc）
      for (i = 0; i < N * n; i++) st.vel[i] += st.acc[i] * half;
      // D：整步漂移（共动位移 = u/a² · dτ，这里取步中点的 a 做二阶精度）
      var aMid = advanceA(st, half), aMid2 = aMid * aMid;
      for (i = 0; i < N * n; i++) {
        var v = st.pos[i] + st.vel[i] / aMid2 * dtau;
        v -= Math.floor(v);                      // 周期盒：坐标恒在 [0,1)
        st.pos[i] = v;
      }
      advanceA(st, half);
      // 重算加速度 → K：后半步踢
      var cg = 1.5 * st.cos.OmM / (FOURPI * st.a * N);
      accel(st.pos, st.acc, n, N, cg, st.amp, st.eps * st.eps, st.D * 0.5);
      for (i = 0; i < N * n; i++) st.vel[i] += st.acc[i] * half;
      st.tau += dtau;
      return dtau;
    }
    // 背景推进半步（RK2）：da/dτ = dir·a·E(a)；E² 变负即转向
    function advanceA(st, h) {
      var a = st.a, cos = st.cos;
      var k1 = st.dir * a * eOf(cos, a);
      var am = a + k1 * h * 0.5;
      if (am <= 1e-6) am = 1e-6;
      var e2 = esq(cos, am);
      if (e2 <= 0) { st.dir = -1; e2 = 0; }      // 转向坍缩
      var k2 = st.dir * am * Math.sqrt(Math.max(e2, 0));
      a = a + k2 * h;
      if (a < 1e-6) a = 1e-6;
      st.a = a;
      return a;
    }

    /* 自适应步长：三条判据取最小
         dlna：一步不许让 a 变化超过 dlnaMax（背景演化的分辨率）
         加速度：一步走过的共动位移不超过 ε 的一小部分
         速度：同上，按当前最大速度算 */
    function suggestDt(st, o) {
      var dlna = o.dlnaMax / Math.max(eOf(st.cos, st.a), 1e-6);
      var gmax = maxNorm(st.acc, st.n, st.N), vmax = maxNorm(st.vel, st.n, st.N);
      var a2 = st.a * st.a;
      var dAcc = gmax > 0 ? 0.35 * Math.sqrt(st.eps * a2 / gmax) : Infinity;
      var dVel = vmax > 0 ? 0.35 * st.eps * a2 / vmax : Infinity;
      var dt = Math.min(dlna, dAcc, dVel, o.dtMax);
      return dt > 1e-9 ? dt : 1e-9;
    }

    function makeState(cfg) {
      var n = cfg.n, N = cfg.N;
      var ic = makeIC(cfg);
      var st = {
        n: n, N: N, D: cfg.D, a: cfg.aIc, tau: 0, dir: 1, cos: cfg.cos,
        eps: cfg.eps, amp: cfg.amp, deltaRms: ic.deltaRms, modes: ic.modes, waveAxes: ic.waveAxes,
        pos: ic.pos, vel: ic.vel, acc: new Float32Array(N * n), steps: 0
      };
      var cg = 1.5 * st.cos.OmM / (FOURPI * st.a * N);
      accel(st.pos, st.acc, n, N, cg, st.amp, st.eps * st.eps, st.D * 0.5);
      return st;
    }
    // 速度模长（渲染用：D<4 时色相取速度）
    function speeds(st, out) {
      var i, d, n = st.n;
      for (i = 0; i < st.N; i++) { var s = 0; for (d = 0; d < n; d++) { var v = st.vel[i * n + d]; s += v * v; } out[i] = Math.sqrt(s); }
      return out;
    }

    return { R_NORM: R_NORM, mulberry32: mulberry32, nDimOf: nDimOf, softOf: softOf, ampOf: ampOf,
             esq: esq, eOf: eOf, makeIC: makeIC, accel: accel, stepKDK: stepKDK, suggestDt: suggestDt,
             makeState: makeState, speeds: speeds, maxNorm: maxNorm };
  }
  var K = HKERNEL();

  /* ============================================================
   * §2 Worker：CPU 档的物理全在这里跑，主线程只画
   * ============================================================ */
  function WORKER_MAIN() {
    var K = HKERNEL();
    var st = null, running = false, timer = null, targetA = 1, budget = 12, low = false;
    var opt = { dlnaMax: 0.02, dtMax: 0.05 };
    function post(m, tr) { self.postMessage(m, tr || []); }
    function snap(type) {
      var pos = new Float32Array(st.pos), spd = new Float32Array(st.N);
      K.speeds(st, spd);
      return { type: type, pos: pos, spd: spd, a: st.a, tau: st.tau, steps: st.steps, dir: st.dir,
               deltaRms: st.deltaRms, modes: st.modes, waveAxes: type === 'ready' ? st.waveAxes : null };
    }
    function loop() {
      timer = null;
      if (!st || !running) return;
      var t0 = (self.performance && self.performance.now) ? self.performance.now() : Date.now();
      var lim = low ? budget * 0.5 : budget, done = false, sub = 0;
      /* 子步硬预算：时间到就本帧到此为止（步长不动、轨道逐位不变，只是现实时间里放慢），
         与 ui/planets.js 的 stepOrbitDemo 同一套办法。 */
      while (sub < 4000) {
        if ((st.dir > 0 && st.a >= targetA) || (st.dir < 0 && st.a <= targetA)) { done = true; break; }
        var dt = K.suggestDt(st, opt);
        // 别越过目标：最后一步缩到正好落在 targetA 上
        var eNow = Math.max(K.eOf(st.cos, st.a), 1e-9);
        var dtToTarget = Math.abs(Math.log(targetA / st.a)) / eNow;
        if (dtToTarget > 0 && dt > dtToTarget) dt = dtToTarget;
        K.stepKDK(st, dt);
        st.steps++; sub++;
        var t1 = (self.performance && self.performance.now) ? self.performance.now() : Date.now();
        if (t1 - t0 >= lim) break;
      }
      var s = snap('state'); s.done = done; s.sub = sub;
      s.ms = ((self.performance && self.performance.now) ? self.performance.now() : Date.now()) - t0;
      post(s, [s.pos.buffer, s.spd.buffer]);
      if (done) { running = false; return; }
      timer = setTimeout(loop, 0);
    }
    self.onmessage = function (ev) {
      var m = ev.data;
      try {
        if (m.type === 'init') {
          st = K.makeState(m.cfg);
          if (m.budget) budget = m.budget;
          var r = snap('ready'); post(r, [r.pos.buffer, r.spd.buffer]);
        } else if (m.type === 'run') {
          if (m.targetA != null) targetA = m.targetA;
          if (st && !running) { running = true; if (!timer) timer = setTimeout(loop, 0); }
        } else if (m.type === 'pause') {
          running = false;
        } else if (m.type === 'power') {
          low = !!m.low;
        } else if (m.type === 'reset') {
          running = false; if (timer) { clearTimeout(timer); timer = null; }
          st = K.makeState(m.cfg);
          var r2 = snap('ready'); post(r2, [r2.pos.buffer, r2.spd.buffer]);
          if (m.targetA != null) { targetA = m.targetA; running = true; timer = setTimeout(loop, 0); }
        }
      } catch (err) { post({ type: 'error', message: String(err && err.stack || err) }); }
    };
  }
  var workerURL = null;
  function makeWorker() {
    if (!workerURL) {
      var src = HKERNEL.toString() + '\n;(' + WORKER_MAIN.toString() + ')();';
      workerURL = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    }
    return new Worker(workerURL);
  }

  /* ============================================================
   * §3 WGSL：WebGPU 档的直接求和 + 投影
   * ------------------------------------------------------------
   * 三个 compute pass：
   *   accel   —— O(N²) 直接求和，按 64 个粒子一块搬进 workgroup 共享内存（每块 64×D 个 f32）
   *   kdk     —— 半步踢 / 漂移（背景 a 由主机侧算好，作为 uniform 传进来）
   *   project —— 把 D 维位置投到选定三轴，并把其余维度折成打包好的色相/亮度
   * 位置与速度常驻 GPU，每帧只回读投影结果（N×4 个 f32）。
   * ============================================================ */
  var WGSL_HEAD =
    'struct U {\n' +
    '  n: u32, N: u32, ax0: u32, ax1: u32,\n' +
    '  ax2: u32, axHue: u32, restN: u32, pad0: u32,\n' +
    '  cg: f32, amp: f32, eps2: f32, pe: f32,\n' +
    '  a2: f32, half: f32, dt: f32, restScale: f32,\n' +
    '  spdScale: f32, sliceEps: f32, sliceOn: u32, pad3: u32\n' +
    '};\n' +
    '@group(0) @binding(0) var<uniform> u: U;\n' +
    '@group(0) @binding(1) var<storage, read_write> pos: array<f32>;\n' +
    '@group(0) @binding(2) var<storage, read_write> vel: array<f32>;\n' +
    '@group(0) @binding(3) var<storage, read_write> acc: array<f32>;\n' +
    '@group(0) @binding(4) var<storage, read_write> proj: array<vec4<f32>>;\n';

  var WGSL_ACCEL = WGSL_HEAD +
    'var<workgroup> tile: array<f32, 1152>;\n' +          // 64 粒子 × 最多 18 维
    '@compute @workgroup_size(64)\n' +
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {\n' +
    '  let i = gid.x; let n = u.n; let N = u.N;\n' +
    '  var me: array<f32, 18>;\n' +
    '  var g: array<f32, 18>;\n' +
    '  for (var d: u32 = 0u; d < n; d = d + 1u) { g[d] = 0.0; me[d] = select(0.0, pos[i * n + d], i < N); }\n' +
    '  let C = u.cg * u.amp;\n' +
    '  var base: u32 = 0u;\n' +
    '  loop {\n' +
    '    if (base >= N) { break; }\n' +
    '    let src = base + lid.x;\n' +
    '    for (var d: u32 = 0u; d < n; d = d + 1u) { tile[lid.x * n + d] = select(0.0, pos[src * n + d], src < N); }\n' +
    '    workgroupBarrier();\n' +
    '    let cnt = min(64u, N - base);\n' +
    '    for (var t: u32 = 0u; t < cnt; t = t + 1u) {\n' +
    '      let j = base + t;\n' +
    '      if (j != i && i < N) {\n' +
    '        var r2: f32 = 0.0;\n' +
    '        for (var d: u32 = 0u; d < n; d = d + 1u) {\n' +
    '          var v = me[d] - tile[t * n + d];\n' +
    '          if (v > 0.5) { v = v - 1.0; } else if (v < -0.5) { v = v + 1.0; }\n' +
    '          r2 = r2 + v * v;\n' +
    '        }\n' +
    '        let s = C / pow(r2 + u.eps2, u.pe);\n' +
    '        for (var d: u32 = 0u; d < n; d = d + 1u) {\n' +
    '          var v = me[d] - tile[t * n + d];\n' +
    '          if (v > 0.5) { v = v - 1.0; } else if (v < -0.5) { v = v + 1.0; }\n' +
    '          g[d] = g[d] - s * v;\n' +
    '        }\n' +
    '      }\n' +
    '    }\n' +
    '    workgroupBarrier();\n' +
    '    base = base + 64u;\n' +
    '  }\n' +
    '  if (i < N) { for (var d: u32 = 0u; d < n; d = d + 1u) { acc[i * n + d] = g[d]; } }\n' +
    '}\n';

  var WGSL_KICK = WGSL_HEAD +
    '@compute @workgroup_size(64)\n' +
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; if (i >= u.N) { return; }\n' +
    '  for (var d: u32 = 0u; d < u.n; d = d + 1u) { vel[i * u.n + d] = vel[i * u.n + d] + acc[i * u.n + d] * u.half; }\n' +
    '}\n';

  var WGSL_DRIFT = WGSL_HEAD +
    '@compute @workgroup_size(64)\n' +
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; if (i >= u.N) { return; }\n' +
    '  for (var d: u32 = 0u; d < u.n; d = d + 1u) {\n' +
    '    var v = pos[i * u.n + d] + vel[i * u.n + d] / u.a2 * u.dt;\n' +
    '    v = v - floor(v);\n' +
    '    pos[i * u.n + d] = v;\n' +
    '  }\n' +
    '}\n';

  var WGSL_PROJECT = WGSL_HEAD +
    '@compute @workgroup_size(64)\n' +
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n' +
    '  let i = gid.x; if (i >= u.N) { return; }\n' +
    '  let n = u.n; let b = i * n;\n' +
    '  let x = select(0.5, pos[b + u.ax0], u.ax0 < n) - 0.5;\n' +
    '  let y = select(0.5, pos[b + u.ax1], u.ax1 < n) - 0.5;\n' +
    '  let z = select(0.5, pos[b + u.ax2], u.ax2 < n) - 0.5;\n' +
    '  var hue: f32 = 0.0; var w: f32 = 0.5;\n' +
    '  if (u.restN > 0u) {\n' +
    '    hue = select(0.0, pos[b + u.axHue], u.axHue < n);\n' +
    '    var s: f32 = 0.0; var cnt: u32 = 0u;\n' +
    '    for (var d: u32 = 0u; d < n; d = d + 1u) {\n' +
    '      if (d != u.ax0 && d != u.ax1 && d != u.ax2 && d != u.axHue) { let q = pos[b + d] - 0.5; s = s + q * q; cnt = cnt + 1u; }\n' +
    '    }\n' +
    '    if (cnt > 0u) { w = clamp(0.5 + (sqrt(s) * u.restScale - 1.0) * 2.2, 0.0, 1.0); }\n' +
    '  } else {\n' +
    '    var sv: f32 = 0.0;\n' +
    '    for (var d: u32 = 0u; d < n; d = d + 1u) { let q = vel[b + d]; sv = sv + q * q; }\n' +
    '    let sp = clamp(sqrt(sv) * u.spdScale, 0.0, 1.0);\n' +
    '    hue = sp; w = sp;\n' +
    '  }\n' +
    /* 切片模式：未选中的轴必须全部落在盒心 ±ε 的薄片里，否则这一颗塞到相机背后（等于不画） */
    '  if (u.sliceOn == 1u) {\n' +
    '    for (var d: u32 = 0u; d < n; d = d + 1u) {\n' +
    '      if (d != u.ax0 && d != u.ax1 && d != u.ax2) {\n' +
    '        if (abs(pos[b + d] - 0.5) > u.sliceEps) { proj[i] = vec4<f32>(0.0, 0.0, 1.0e6, 0.0); return; }\n' +
    '      }\n' +
    '    }\n' +
    '  }\n' +
    '  let hi = floor(clamp(hue, 0.0, 0.999) * 1023.0);\n' +
    '  proj[i] = vec4<f32>(x, y, z, hi + min(w, 0.999));\n' +
    '}\n';

  /* ============================================================
   * §4 WebGL2 点云渲染（两档共用同一套）
   * ============================================================ */
  var VS = '#version 300 es\n' +
    'in vec4 a_pv;\n' +                       // xyz = 投影后的盒坐标（−0.5..0.5），w = 打包的色相/亮度
    'uniform mat4 u_vp;\n' +
    'uniform float u_ptScale;\n' +
    'uniform float u_gain;\n' +
    /* 时空图（D=1）：顶点里存的是 (x, 绝对步号, 0, 打包色相/亮度)，
       纵坐标由「这一步离当前多久」当场算 —— 于是整张图随时间往上滚，缓冲只需要写最新那一行。 */
    'uniform float u_wl;\n' +
    'uniform float u_tHead;\n' +
    'uniform float u_tSpan;\n' +
    'out vec3 v_col;\n' +
    'out float v_gain;\n' +
    'vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0); vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y); }\n' +
    'void main(){\n' +
    '  vec3 P = a_pv.xyz;\n' +
    '  if (u_wl > 0.5) { P = vec3(a_pv.x, (a_pv.y - u_tHead)/u_tSpan + 0.5, 0.0); }\n' +
    '  vec4 clip = u_vp * vec4(P, 1.0);\n' +
    '  gl_Position = clip;\n' +
    '  float hi = floor(a_pv.w); float w = a_pv.w - hi; float hue = hi/1023.0;\n' +
    '  float d = max(clip.w, 0.02);\n' +
    '  gl_PointSize = clamp(u_ptScale/d, 2.0, 26.0);\n' +
    '  v_col = hsv2rgb(vec3(hue, 0.72, 0.26 + 0.72*w));\n' +
    '  v_gain = u_gain;\n' +
    '}\n';
  var FS = '#version 300 es\n' +
    'precision mediump float;\n' +
    'in vec3 v_col; in float v_gain; out vec4 o;\n' +
    'void main(){ vec2 d = gl_PointCoord*2.0-1.0; float r2 = dot(d,d); if(r2>1.0) discard; float f = exp(-2.1*r2)-0.122; o = vec4(v_col*max(f,0.0)*v_gain, 1.0); }\n';
  // 盒线框：让人知道这是个周期盒，也给换轴之后的重排一个参照
  var VS_LINE = '#version 300 es\nin vec3 a_p; uniform mat4 u_vp; void main(){ gl_Position = u_vp * vec4(a_p,1.0); }\n';
  var FS_LINE = '#version 300 es\nprecision mediump float; uniform vec4 u_c; out vec4 o; void main(){ o = u_c; }\n';

  function m4persp(fovy, asp, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function m4lookAt(eye, at, up) {
    var zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
    var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
  }
  function m4mul(a, b) {
    var o = new Float32Array(16), i, j, k;
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) { var s = 0; for (k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
    return o;
  }

  /* ============================================================
   * §5 覆盖层（换轴面板）的样式
   * ============================================================ */
  var CSS = '.hy-panel{position:absolute;left:12px;top:12px;z-index:21;max-width:min(420px,calc(100% - 24px));' +
    'font:12px/1.6 Consolas,"Microsoft YaHei",monospace;color:#cdd3e8;background:rgba(6,8,18,.78);' +
    'border:1px solid rgba(150,175,255,.28);border-radius:8px;padding:8px 10px;backdrop-filter:blur(3px)}' +
    '.hy-panel .hy-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:2px 0}' +
    '.hy-panel .hy-t{color:#8d95b8;margin-right:2px}' +
    '.hy-b{font:inherit;color:#cdd3e8;background:rgba(255,255,255,.07);border:1px solid rgba(150,175,255,.3);' +
    'border-radius:5px;padding:1px 7px;cursor:pointer;min-width:26px}' +
    '.hy-b:hover{background:rgba(255,255,255,.16)}' +
    '.hy-b[aria-pressed="true"]{background:rgba(120,170,255,.34);border-color:rgba(170,200,255,.75);color:#fff}' +
    '.hy-b.ax{padding:1px 5px}' +
    '.hy-b.slot{background:rgba(120,170,255,.30);border-color:rgba(170,200,255,.7);color:#fff}' +
    '.hy-note{color:#9aa2c4;margin-top:3px;line-height:1.5}' +
    '.hy-panel input[type=range]{width:110px;vertical-align:middle}' +
    // 遮罩期那一屏：盖在点云画布之上的一张 2D 画布（与 universe3d 的 .u3d-dim 同一套定位）
    '.hy-dim{position:absolute;left:0;top:0;width:100%;height:100%;display:block;z-index:5;pointer-events:none;background:transparent}' +
    // 必须显式写：UA 的 [hidden]{display:none} 只有 (0,0,1)，压不过上面那条 (0,1,0) 的 display:block，
    // 少了这一句 canvas.hidden = true 根本不生效（遮罩揭开后那一屏会一直糊在点云上）
    '.hy-dim[hidden]{display:none}' +
    '@media (max-width:720px){.hy-panel{font-size:11px;max-width:calc(100% - 24px)}}';
  var cssDone = false;
  function injectCSS() {
    if (cssDone || !root.document) return; cssDone = true;
    var s = root.document.createElement('style'); s.setAttribute('data-hyper', '1'); s.textContent = CSS;
    root.document.head.appendChild(s);
  }

  var supCache = null;
  function isSupported() {
    if (supCache) return supCache;
    var out = { webgpu: false, webgl2: false };
    try { out.webgpu = !!(root.navigator && root.navigator.gpu); } catch (e) { /* ignore */ }
    try {
      var c = root.document.createElement('canvas');
      out.webgl2 = !!(c.getContext && c.getContext('webgl2'));
    } catch (e2) { /* ignore */ }
    supCache = out;
    return out;
  }

  /* 粒子档：WebGPU 直接求和 16k–32k，Worker CPU 1k–3k。
     D 越高每粒子内存越大（D 个坐标 + D 个速度），而且 O(N²·D) 的每对代价也跟着 D 长，
     所以 N 上限按 D 缩（规格 §一「N 上限按 D 缩」）。 */
  function pickN(mode, n, tier) {
    var base = mode === 'webgpu' ? 32768 : 3000;
    if (tier === 'tiny') base = mode === 'webgpu' ? 16384 : 1000;
    else if (tier === 'low') base = mode === 'webgpu' ? 16384 : 1600;
    else if (tier === 'high' || tier === 'ultra') base = mode === 'webgpu' ? 32768 : 3000;
    var scaled = Math.round(base * Math.sqrt(3 / Math.max(3, n)));
    var lo = mode === 'webgpu' ? 4096 : 900, hi = mode === 'webgpu' ? 32768 : 3000;
    /* 直接求和一次 accel 的工作量是 N²·D 个「粒子对 × 维」，而**一次 compute 派发跑多久，
       整页的 requestAnimationFrame 就被顶住多久**（不是掉帧，是根本轮不到我们画）。
       2026-09-17 真机：D=14 给到 15232 时，回读与自检全对，可画面从头到尾停在初始那一帧
       —— draw() 压根没排上。所以这条预算不是防 TDR，是**防止单次派发霸占合成**。
       6×10⁸ 对维：D=14 → 6528，D=18 → 5760，D=4 → 12224，n≤3 → 封在 32768 的上限。
       这比规格里写的 16k–32k 保守，是拿粒子数换「画面真的在动」；
       真机上 `[hyper] GPU 一批活儿跑完：… ms` 那条日志就是下一轮往回调的依据。 */
    var WORK_MAX = 6e8;
    hi = Math.min(hi, Math.max(lo, Math.floor(Math.sqrt(WORK_MAX / Math.max(1, n)))));
    scaled = clamp(scaled, lo, hi);
    if (mode === 'webgpu') scaled = Math.ceil(scaled / 64) * 64;      // 对齐到 workgroup
    return scaled;
  }
  function autoTier() {
    var cores = (root.navigator && root.navigator.hardwareConcurrency) || 4;
    var mem = (root.navigator && root.navigator.deviceMemory) || 4;
    if (cores <= 4 || mem <= 4) return 'tiny';
    return cores >= 8 ? 'mid' : 'low';
  }

  /* 预设轴序列：`[` `]` 就在这张表里前后翻。
     n ≤ 3 只有一组（轴不够，画面就是这个样子，HUD 会说明）；
     n > 3 时给全部 C(n,3) 组合，超过 160 组就按步长抽稀（18 维有 816 组，翻不完也没必要）。 */
  function axisPresets(n) {
    /* 轴不够三根：多出来的槽给一个越界的轴号，投影时按盒心（0.5）处理
       —— D=1 就是屏幕上一条直线，D=2 就是一个平面，这是这个宇宙的事实，不是渲染问题。
       槽里重复填 x₁ 会把点摆成一条斜对角线，读起来像出了 bug。 */
    if (n < 3) return [[0, 1, 2]];
    var all = [], i, j, k;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) for (k = j + 1; k < n; k++) all.push([i, j, k]);
    if (all.length <= 160) return all;
    var step = all.length / 160, out = [];
    for (i = 0; i < 160; i++) out.push(all[Math.floor(i * step)]);
    return out;
  }

  /* ============================================================
   * §6 create()
   * ============================================================ */
  function create(host, opts) {
    opts = opts || {};
    if (!host || !root.document) throw new Error('MirrorHyper.create 需要一个宿主元素');
    injectCSS();

    var cos0 = opts.cosmology || {};
    var cos = {
      OmM: num(cos0.omegaM, 0.315), OmL: num(cos0.omegaLambda, 0.685),
      OmK: num(cos0.omegaK, 0), OmR: num(cos0.omegaR, 9.2e-5), h: num(cos0.h, 0.674)
    };
    function num(v, d) { v = +v; return isFinite(v) ? v : d; }
    var TH = 9.778 / Math.max(cos.h, 0.05);        // 1/H0，单位 Gyr
    var tOfA = (typeof cos0.tOfA === 'function') ? cos0.tOfA : null;

    var D = +opts.dimS; if (!isFinite(D) || D <= 0) D = 3;
    var n = K.nDimOf(D);
    var seed = (opts.seed >>> 0) || 1;
    var L = opts.boxMpc || 100;                    // 共动盒长（Mpc/h），只用于标尺文案
    var tier = opts.tier && opts.tier !== 'auto' ? opts.tier : autoTier();
    var sup = isSupported();
    var wantGPU = sup.webgpu && opts.force !== 'cpu' && opts.force !== 'webgl2';
    if (opts.force === 'webgpu') wantGPU = sup.webgpu;
    var aIc = 0.02, aStop = 8;

    var S = {
      ready: false, disposed: false, running: false, mode: 'cpu', tier: tier, N: 0,
      a: aIc, tau: 0, dir: 1, fps: 0, steps: 0, msPerStep: 0, lowPower: false,
      gain: 0.85, exposureAuto: true, overview: false, orbit: !reducedMotion(), labels: true,
      targetA: 1, hidden: false, blurred: false, pendingGPU: false, stepMs: 0, drawMs: 0
    };
    var eps = K.softOf(n, 1), amp = K.ampOf(D);    // N 定下来之后重算 eps

    /* ---------- 轴选择 ---------- */
    var presets = axisPresets(n), presetIdx = 0;
    var axes = presets[0].slice();
    var slotOrder = [0, 1, 2];                     // 手选时按最久没换的槽轮替
    /* 切片：把未选中的那 m 根轴全都限制在盒心 ±ε 的薄片内，只画这一片。
       ε 不能直接当参数给：m 一大，保留比例是 (2ε)^m —— D=14 下 ε=0.1、m=11 时
       约 2×10⁻⁸，屏幕上一个粒子都不剩（实测就是一片空）。
       所以滑杆调的是**保留比例** frac，ε 由 frac 反推：ε = ½·frac^{1/m}。
       这样 D=1 和 D=18 下拖同一个位置，画面里剩下的粒子数量级一致。 */
    /* 切片默认**开**、保留 40%：薄层在切片里最清楚（未选中的轴被钉在盒心，
       那些「一根轴在选中三元组里、另一根不在」的模会从被积分掉变成看得见的粗带）。
       比例取 40% 而不是更薄：实测屏幕对比度对切片比例并不敏感（D=14/N=32,768 下
       整盒 0.35、60% 0.35、40% 0.35、20% 0.35），切得越薄纯粹是在丢粒子。
       整盒投影留作第二种看法，面板上一键切换。
       还有一道下限：切完剩下的粒子太少，散粒噪声会把结构整个淹掉（实测 D=14、N=1,389 的 CPU 档
       按 20% 切完只剩 278 个点，屏幕上什么都读不出来）。所以只有**切完还剩 ≥2500 个粒子**时才默认开，
       否则默认整盒 —— 开关和滑杆一直都在，用户随时能自己切。
       2500 这条线让 WebGPU 档开局的 N（D=14 时 6,592 × 40% ≈ 2,637）就能默认开，
       不会在自适应放大 N 的时候中途翻一次。 */
    var SLICE_MIN_KEEP = 2500;
    var slice = { on: true, frac: 0.40 };
    function sliceAutoDefault() { if (!S.sliceTouched) slice.on = (S.N * slice.frac) >= SLICE_MIN_KEEP; }
    function sliceRestN() { var m = 0, d; for (d = 0; d < n; d++) if (axes.indexOf(d) < 0) m++; return m; }
    function sliceEps() { var m = sliceRestN(); return m > 0 ? 0.5 * Math.pow(slice.frac, 1 / m) : 0.5; }
    function axHue() { var d; for (d = 0; d < n; d++) if (axes.indexOf(d) < 0) return d; return -1; }
    /* 这组投影轴里还看得见几个初始扰动模。判据是真的：
       整盒投影：一个模只有**所有**起伏的轴都被选中，才不会被其余维度积分掉；
       切片模式：未选中的轴被钉在盒心附近，相位固定 ⇒ 只要**有一根**起伏的轴被选中就还看得见。
       这也解释了为什么有的三元组那一面是均匀的 —— 不是渲染坏了，是那些模不在这几根轴上。 */
    function visibleModes() {
      var W = S.waveAxes; if (!W) return null;
      var cnt = 0, i, j, ax, all, any;
      for (i = 0; i < W.length; i++) {
        ax = W[i]; all = true; any = false;
        for (j = 0; j < ax.length; j++) { if (axes.indexOf(ax[j]) >= 0) any = true; else all = false; }
        if (slice.on ? any : all) cnt++;
      }
      return cnt;
    }
    function restCount() { var h = axHue(); return h < 0 ? 0 : Math.max(0, n - 4); }
    function axesLabel() { return '(' + axes.map(function (d) { return d < n ? axName(d) : '0'; }).join(',') + ')'; }

    /* ---------- 画布（自己建一张，不抢 #gl3d） ----------
       #gl3d 可能已经被 universe3d 绑成 webgl2 或 webgpu 上下文，而一张 canvas 的上下文类型定了就不能换；
       自己建一张既没有这个问题，dispose 时整个元素摘掉也不会留下上下文泄漏。 */
    var canvas = root.document.createElement('canvas');
    canvas.className = 'layer';
    canvas.id = 'glHyper';
    canvas.setAttribute('aria-label', T('D 维 N 体投影视图'));
    canvas.tabIndex = -1;
    canvas.style.zIndex = '4';
    canvas.style.background = '#000000';
    canvas.style.touchAction = 'none';
    canvas.style.outline = 'none';
    host.appendChild(canvas);

    var gl = null, prog = null, progLine = null, vbo = null, vao = null, lineVbo = null, lineVao = null, uni = {}, uniLine = {}, lineCount = 24;
    var worker = null, gpu = null;
    var proj = null;                               // Float32Array(N*4)：投影结果（渲染直接用）
    var posSnap = null, spdSnap = null;            // CPU 档：worker 传回来的最新快照

    /* ---------- 相机 ---------- */
    var cam = { yaw: 0.6, pitch: 0.42, dist: 2.9, fov: 55 * Math.PI / 180, target: [0, 0, 0], dragging: false, lastX: 0, lastY: 0, moved: 0 };

    var listeners = [];
    function on(t, ev, fn, o) { t.addEventListener(ev, fn, o); listeners.push([t, ev, fn, o]); }

    var onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    function status(msg) { try { onStatus(msg, null); } catch (e) { /* ignore */ } }

    /* ---------- 背景：a ↔ t 表（时间轴与 HUD 用） ---------- */
    var aTab = [], tTab = [];
    (function buildTable() {
      var a = 1e-4, tau = 0, i, steps = 900;
      var lnHi = Math.log(aStop), lnLo = Math.log(a), h = (lnHi - lnLo) / steps;
      aTab.push(a); tTab.push(0);
      for (i = 0; i < steps; i++) {
        var a0 = Math.exp(lnLo + i * h), a1 = Math.exp(lnLo + (i + 1) * h);
        var e0 = K.eOf(cos, a0), e1 = K.eOf(cos, a1);
        if (e0 <= 0 || e1 <= 0) break;             // 转向坍缩：表到此为止
        tau += 0.5 * (1 / (a0 * e0) + 1 / (a1 * e1)) * (a1 - a0);
        aTab.push(a1); tTab.push(tau);
      }
    })();
    function tGyrOfA(a) {
      if (tOfA) { try { var v = tOfA(a); if (v != null && isFinite(v) && v > 0) return v; } catch (e) { /* 落回表 */ } }
      if (a <= aTab[0]) return tTab[0] * TH;
      var lo = 0, hi = aTab.length - 1;
      if (a >= aTab[hi]) return tTab[hi] * TH;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (aTab[m] <= a) lo = m; else hi = m; }
      var f = (a - aTab[lo]) / Math.max(aTab[hi] - aTab[lo], 1e-12);
      return (tTab[lo] + f * (tTab[hi] - tTab[lo])) * TH;
    }
    function aOfTGyr(t) {
      var lo = 0, hi = aTab.length - 1;
      if (t <= tGyrOfA(aTab[0])) return aTab[0];
      if (t >= tGyrOfA(aTab[hi])) return aTab[hi];
      // tOfA 未必与本地表一致，统一用二分 + tGyrOfA 求逆，两种来源都吃得住
      for (var it = 0; it < 48 && hi - lo > 1; it++) {
        var m = (lo + hi) >> 1;
        if (tGyrOfA(aTab[m]) <= t) lo = m; else hi = m;
      }
      return aTab[hi];
    }
    var zOf = function (a) { return 1 / Math.max(a, 1e-8) - 1; };

    /* ---------- WebGL2 初始化 ---------- */
    function initGL() {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      if (!gl) throw new Error('没有 WebGL2');
      function sh(type, src) {
        var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
        return s;
      }
      function link(vs, fs) {
        var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
        return p;
      }
      prog = link(VS, FS);
      uni.vp = gl.getUniformLocation(prog, 'u_vp');
      uni.pt = gl.getUniformLocation(prog, 'u_ptScale');
      uni.gain = gl.getUniformLocation(prog, 'u_gain');
      uni.wl = gl.getUniformLocation(prog, 'u_wl');
      uni.tHead = gl.getUniformLocation(prog, 'u_tHead');
      uni.tSpan = gl.getUniformLocation(prog, 'u_tSpan');
      progLine = link(VS_LINE, FS_LINE);
      uniLine.vp = gl.getUniformLocation(progLine, 'u_vp');
      uniLine.c = gl.getUniformLocation(progLine, 'u_c');
      vbo = gl.createBuffer(); vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      /* 周期盒的线框：**只画这个宇宙真有的那几根轴**。
         D=1 画一条线段、D=2 画一个正方形、D≥3 才画 12 条棱的立方体——
         给一维宇宙套一个立方体等于凭空多画两根它没有的轴。 */
      var c = [], e;
      function corner(i) { return [(i & 1 ? 0.5 : -0.5), (n >= 2 || wlOn) ? (i & 2 ? 0.5 : -0.5) : 0, n >= 3 ? (i & 4 ? 0.5 : -0.5) : 0]; }
      // 时空图那一档画一个方框（横轴 = 位置、纵轴 = 时间），不是一条线段
      var E = (n >= 3) ? [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
            : ((n === 2 || wlOn) ? [[0, 1], [1, 3], [3, 2], [2, 0]] : [[0, 1]]);
      for (e = 0; e < E.length; e++) { var A = corner(E[e][0]), B = corner(E[e][1]); c.push(A[0], A[1], A[2], B[0], B[1], B[2]); }
      lineCount = E.length * 2;
      lineVbo = gl.createBuffer(); lineVao = gl.createVertexArray();
      gl.bindVertexArray(lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(c), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);               // 加性混合：密的地方自然亮
      gl.clearColor(0, 0, 0, 1);
    }

    /* ---------- CPU 档 ---------- */
    function initCPU() {
      S.mode = 'cpu';
      S.N = pickN('cpu', n, tier);
      eps = K.softOf(n, S.N);
      sliceAutoDefault();
      proj = new Float32Array(S.N * 4);
      posSnap = new Float32Array(S.N * n);
      spdSnap = new Float32Array(S.N);
      uploadProj('init-cpu');  // 从 GPU 档落回来时 N 会变，VBO 要立刻按新 N 重开
      worker = makeWorker();
      worker.onmessage = function (ev) {
        var m = ev.data;
        if (S.disposed) return;
        if (m.type === 'error') { console.warn('[hyper] worker:', m.message); return; }
        posSnap = m.pos; spdSnap = m.spd;
        S.a = m.a; S.tau = m.tau; S.steps = m.steps; S.dir = m.dir;
        if (m.ms != null && m.sub) S.msPerStep = m.ms / m.sub;
        if (m.deltaRms != null) { S.deltaRms = m.deltaRms; S.modes = m.modes; }
        if (m.waveAxes) S.waveAxes = m.waveAxes;
        if (m.type === 'ready') { S.ready = true; label(); resolveReady(api); autoStart(); status(T('D 维 N 体已就绪')); }
        if (m.done) S.running = false;
        projectCPU();
      };
      worker.onerror = function (e) { console.warn('[hyper] worker error', e && e.message); };
      worker.postMessage({ type: 'init', budget: 12, cfg: cfgOf() });
      status(T('正在生成 D 维初始条件'));
    }
    function cfgOf() {
      return { n: n, N: S.N, D: D, aIc: aIc, seed: seed, eps: eps, amp: amp,
               cos: { OmM: cos.OmM, OmL: cos.OmL, OmK: cos.OmK, OmR: cos.OmR } };
    }
    // 主线程投影：只读最新快照，换轴立刻生效（不用等 worker）
    function projectCPU() {
      if (!posSnap || !proj) return;
      var N = S.N, i, d, b, h = axHue(), rc = restCount();
      /* 亮度 = 其余维度到盒心的范数，但要**按这个维数下的典型值归一**再放大偏离：
         均匀分布下该范数的期望约 √(rc/12)，维数一高几乎每个粒子都落在这个值附近，
         直接线性映射会全部顶到 1（D=18 实测整屏一个亮度）。这里取 0.5 + 2.2×(相对偏离)，
         亮暗差读出来的就是「比典型情况更靠边 / 更靠中心」。 */
      var restScale = rc > 0 ? 1 / Math.max(1e-6, Math.sqrt(rc / 12)) : 1;
      var spdRef = 0;
      if (rc === 0 && spdSnap) { for (i = 0; i < N; i++) if (spdSnap[i] > spdRef) spdRef = spdSnap[i]; spdRef = spdRef || 1; }
      var a0 = axes[0], a1 = axes[1], a2 = axes[2];
      var sOn = slice.on, sE = sliceEps();
      for (i = 0; i < N; i++) {
        b = i * n;
        var x = a0 < n ? posSnap[b + a0] : 0.5, y = a1 < n ? posSnap[b + a1] : 0.5, z = a2 < n ? posSnap[b + a2] : 0.5;
        var hue, w;
        if (rc > 0 || h >= 0) {
          hue = h >= 0 ? posSnap[b + h] : 0;
          var s = 0, cnt = 0;
          for (d = 0; d < n; d++) { if (d === a0 || d === a1 || d === a2 || d === h) continue; var q = posSnap[b + d] - 0.5; s += q * q; cnt++; }
          w = cnt > 0 ? clamp(0.5 + (Math.sqrt(s) * restScale - 1) * 2.2, 0, 1) : 0.5;
        } else {
          var sp = spdSnap ? clamp(spdSnap[i] / spdRef, 0, 1) : 0.5;
          hue = sp; w = sp;
        }
        // 切片模式：未选中的轴要全部落在盒心 ±ε 的薄片里，否则这一颗不画（塞到相机背后）
        if (sOn) {
          var keep = true;
          for (d = 0; d < n; d++) { if (d === a0 || d === a1 || d === a2) continue; if (Math.abs(posSnap[b + d] - 0.5) > sE) { keep = false; break; } }
          if (!keep) { proj[i * 4] = 0; proj[i * 4 + 1] = 0; proj[i * 4 + 2] = 1e6; proj[i * 4 + 3] = 0; continue; }
        }
        proj[i * 4] = x - 0.5; proj[i * 4 + 1] = y - 0.5; proj[i * 4 + 2] = z - 0.5;
        proj[i * 4 + 3] = Math.floor(clamp(hue, 0, 0.999) * 1023) + Math.min(w, 0.999);
      }
      S.projDirty = true; S.projLen = proj.length; S.projSeq = (S.projSeq || 0) + 1;
      uploadProj('worker');
    }
    /* 顶点上传只在 draw() 里做，别的地方一律只打脏标记。
       原来是在 worker 的 onmessage / WebGPU 的 mapAsync 回调里直接 bufferData —— 那是一段
       与绘制无关的异步上下文：GL 的当前状态（绑定、上下文是否已重建、画布尺寸有没有刚改过）
       都不由我们说了算，真机上出现过「proj 里数据是对的、自检也过了，可屏幕上还是初始那一帧
       （线框 + 全零 = 中心一个点）」。现在数据到手只置 projDirty，
       真正的 bufferData 与 drawArrays 在同一个任务、同一段 GL 状态里挨着做，中间不会再插进别的东西。 */
    function markProjDirty() { S.projDirty = true; }
    /* proj 的长度必须恰好是 N×4（每个粒子一个 vec4：xyz + 打包的色相/亮度），
       对不上就当场重开一条，免得 drawArrays(POINTS, 0, N) 读到缓冲之外（那会整批不画）。 */
    function uploadProj(why) {
      if (!gl || !proj) return;
      if (proj.length !== S.N * 4) {
        console.warn('[hyper] proj 长度与 N 不符：' + proj.length + ' ≠ ' + (S.N * 4) + '，按 N 重开');
        var np = new Float32Array(S.N * 4);
        np.set(proj.subarray(0, Math.min(proj.length, np.length)));
        proj = np;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, proj, gl.DYNAMIC_DRAW);
      S.projDirty = false;
      S.uploads = (S.uploads || 0) + 1;
      S.lastUpload = why || '?';
      if (S.uploads <= 3) {
        console.log('[hyper] 上传顶点 #' + S.uploads + ' · ' + (S.mode === 'webgpu' ? 'WebGPU' : 'CPU') +
          ' · N=' + S.N + ' · proj 长度 ' + proj.length + '（应为 ' + (S.N * 4) + '）· 触发 ' + S.lastUpload +
          ' · frames=' + (S.frames || 0));
      }
      // 头三次上传各核对一次（第一次是初始化的空缓冲，第二次才是第一批真数据），之后按需
      if (S.uploads <= 3 || S.verifyNext) { S.verifyNext = false; verifyVBO(); }
    }
    /* 一次性核对「CPU 端的 proj」与「GL 缓冲里真正躺着的字节」是否一致。
       回读自检只证明 proj 是对的；画面不对时必须再往下走一格，看顶点缓冲有没有拿到同一份数据。
       getBufferSubData 是同步读回，只在头一次上传（和显式要求时）做一次，不进每帧路径。 */
    function verifyVBO(quiet) {
      if (!gl || !proj) return;
      try {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        var bytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
        var head = new Float32Array(8), tail = new Float32Array(8);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, head);
        if (bytes >= 32) gl.getBufferSubData(gl.ARRAY_BUFFER, bytes - 32, tail);
        S.vbo = { bytes: bytes, want: S.N * 16, head: Array.prototype.slice.call(head).map(function (v) { return +v.toFixed(4); }),
                  tail: Array.prototype.slice.call(tail).map(function (v) { return +v.toFixed(4); }), err: gl.getError() };
        if (quiet) return;
        console.log('[hyper] 顶点缓冲核对 · ' + (S.mode === 'webgpu' ? 'WebGPU' : 'CPU') + ' · N=' + S.N +
          ' · VBO ' + bytes + ' 字节（应为 ' + (S.N * 16) + '）· 前两个顶点 ' + JSON.stringify(S.vbo.head) +
          ' · 末两个顶点 ' + JSON.stringify(S.vbo.tail) + ' · glError=' + S.vbo.err);
      } catch (e) { console.warn('[hyper] 顶点缓冲核对失败', e); }
    }

    /* ---------- WebGPU 档 ----------
       物理与投影全在 GPU 上；每帧只回读 N×4 个 f32（16k 粒子 = 256 KB），用双缓冲 mapAsync，不阻塞。
       任何一步失败（没有适配器 / WGSL 编译不过 / 设备丢失）都落到 CPU 档，画面不中断。 */
    /* ---------- WebGPU 档 ----------
       物理与投影全在 GPU 上；每帧只回读 N×4 个 f32（16k 粒子 = 256 KB），双 staging + mapAsync，不阻塞。

       这一段被 2026-09-17 真显卡实测按着改过三处，每一处都是「画面看着在跑，其实什么都没发生」或者
       「整个渲染进程卡死」，都不是普通的慢：

       1) **布局必须显式给，不能用 layout:'auto'**（画面只剩中央一个白点的根因）。
          auto 生成的布局只包含该 shader 真正用到的 binding：accel 用 0/1/3、kick 用 0/2/3、
          drift 用 0/1/2、project 用 0/1/2/4。而 bind group 是按满 0..4 建的，多出来那条不在布局里
          ⇒ createBindGroup 是一条 validation error（WebGPU 不抛异常，只走 uncapturederror），
          bind group 变 invalid，之后每次 setBindGroup + dispatch 全部无效 —— 四个 compute pass
          一次都没真跑过。proj 缓冲从头到尾全 0：N 个粒子全投到 (0,0,0)，换轴只改 uniform，画面当然不变。

       2) **一步只提交一次**（渲染进程卡死的根因）。原来每个 pass 各建一个 CommandEncoder、各 submit 一次、
          中间还各写一次同一个 uniform buffer —— 240 fps × 4 子步 × 4 pass ≈ 每秒 4000 次 submit
          加 4000 次 writeBuffer。Dawn 的命令流水被灌爆，主线程在下一次 flush 上堵死（表现为整页冻结，
          CDP 都超时）。现在每个 pass 有自己的 uniform 槽（5 个小 buffer + 5 个 bind group），
          一个 encoder 装下 kick→drift→accel→kick(→project)，**整步只 submit 一次**。
          同一个 encoder 里相邻 compute pass 之间有隐式屏障，顺序与可见性都成立。

       3) **在飞的活儿要封顶**。`queue.onSubmittedWorkDone()` 是 promise（不是同步等待）：
          上一批没跑完就不提交下一批。GPU 慢就自然降到它的速度，而不是把几千个 dispatch 堆进队列。
          直接求和是 O(N²·D)，16k 粒子 14 维一次 accel 就是 3.7×10⁹ 个「粒子对×维」，
          核显上单次几十毫秒 —— 没有这道闸，一秒钟能堆出几十秒的活儿，看着就是死机。

       任何一步失败（没有适配器 / WGSL 编译不过 / 校验错 / 设备丢失 / 5 秒读不回数据）都自动落 CPU 档。 */
    function initGPU() {
      S.mode = 'webgpu';
      S.N = pickN('webgpu', n, tier);
      eps = K.softOf(n, S.N);
      sliceAutoDefault();
      proj = new Float32Array(S.N * 4);
      uploadProj('init-gpu');                             // 先按 N 把缓冲开出来（内容还是空的）
      status(T('正在初始化 WebGPU 直接求和'));
      return root.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (ad) {
        if (S.disposed) return null;
        if (!ad) throw new Error('requestAdapter 返回空');
        /* timestamp-query：量**GPU 真正跑了多久**。没有它就只能量「提交 → onSubmittedWorkDone」的
           墙钟，而那里面混着排队与 vsync 等待 —— 一帧一步时量到的其实是帧间隔。
           2026-09-17 真机就栽在这里：一批 3 ms、126 fps 的卡被判成超预算，N 一路缩到下限 4096。 */
        var feats = [];
        try { if (ad.features && ad.features.has && ad.features.has('timestamp-query')) feats.push('timestamp-query'); } catch (e) { /* ignore */ }
        return ad.requestDevice(feats.length ? { requiredFeatures: feats } : undefined)
          .catch(function () { return ad.requestDevice(); });
      }).then(function (dev) {
        if (!dev) return;
        // 续期检查：requestAdapter/requestDevice 都是异步的，中途用户可能已经退出或换了视图
        if (S.disposed) { try { dev.destroy(); } catch (e) { /* ignore */ } return; }
        var N = S.N, bytes = N * n * 4, u;
        var G = { dev: dev, uni: [], bind: [], read: [], readBusy: [], busy: false, gen: (S.gen = (S.gen || 0) + 1),
                  uarr: new Float32Array(20), uarr32: null };
        G.uarr32 = new Uint32Array(G.uarr.buffer);
        try {
          if (dev.features && dev.features.has && dev.features.has('timestamp-query')) {
            G.ts = { qs: dev.createQuerySet({ type: 'timestamp', count: 2 }),
                     res: dev.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
                     read: dev.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
                     busy: false };
            S.tsOk = true;
          }
        } catch (e) { G.ts = null; S.tsOk = false; }
        G.pos = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        G.vel = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        G.acc = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE });
        G.proj = dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        // 五个 uniform 槽：0 前半步踢 · 1 漂移 · 2 重算加速度 · 3 后半步踢 · 4 投影
        for (u = 0; u < 5; u++) G.uni.push(dev.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        for (u = 0; u < 2; u++) { G.read.push(dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })); G.readBusy.push(false); }
        var BGL = dev.createBindGroupLayout({ entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
        ] });
        G.BGL = BGL;
        var PLO = dev.createPipelineLayout({ bindGroupLayouts: [BGL] });
        /* **必须用 createComputePipelineAsync**：同步版 createComputePipeline 会在主线程上
           等着把四段 WGSL 编译完（真机实测第一批含编译要 113 ms，之后每批只要 3 ms），
           而这段等待正好落在「点了引爆、屏幕还黑着」的那一拍上。异步版把编译挪到后台线程。 */
        function pipe(code) {
          return dev.createComputePipelineAsync({ layout: PLO, compute: { module: dev.createShaderModule({ code: code }), entryPoint: 'main' } });
        }
        dev.pushErrorScope('validation');
        dev.onuncapturederror = function (ev) {
          var m = (ev && ev.error && ev.error.message) || String(ev);
          if (S.gpuErrs == null) S.gpuErrs = [];
          if (S.gpuErrs.length < 8) S.gpuErrs.push(String(m).slice(0, 220));
          console.warn('[hyper] WebGPU 运行期错误：', m);
        };
        dev.lost.then(function (info) {
          if (S.disposed || gpu !== G) return;
          console.warn('[hyper] WebGPU 设备丢失，落回 Worker CPU 档：', info && info.message);
          fallbackToCPU('device-lost: ' + ((info && info.message) || ''));
        });
        status(T('正在编译 WebGPU 内核'));
        return Promise.all([pipe(WGSL_ACCEL), pipe(WGSL_KICK), pipe(WGSL_DRIFT), pipe(WGSL_PROJECT)]).then(function (ps) {
          /* 编译是异步的，这中间用户可能已经退出/换了宇宙：续期检查，否则会在一个死实例上接着建 */
          if (S.disposed) { try { dev.destroy(); } catch (e) { /* ignore */ } return; }
          G.pAccel = ps[0]; G.pKick = ps[1]; G.pDrift = ps[2]; G.pProj = ps[3];
          gpuMakeBinds(G);
          /* 建管线/绑定组的 validation error 是异步冒出来的：不 pop 一次就只在控制台留一条红字，
             画面照样「在跑」（只是什么都没算）。 */
          dev.popErrorScope().then(function (err) {
            if (!err || S.disposed || gpu !== G) return;
            console.warn('[hyper] WebGPU 管线/绑定组校验失败，落回 Worker CPU 档：', err.message);
            fallbackToCPU('pipeline-validation: ' + err.message);
          });
          // 初始条件在主线程算一次（同一份 HKERNEL，所以与 CPU 档逐位一致），然后写进 GPU
          var ic = K.makeIC(cfgOf());
          S.deltaRms = ic.deltaRms; S.modes = ic.modes; S.waveAxes = ic.waveAxes;
          dev.queue.writeBuffer(G.pos, 0, ic.pos);
          dev.queue.writeBuffer(G.vel, 0, ic.vel);
          G.groups = Math.ceil(S.N / 64);
          gpu = G;
          S.reads = 0; S.lastRead = nowMs();
          gpuKickoff();                                 // 先算一次加速度（KDK 的第一次踢要用）+ 投一次
          S.ready = true; label(); resolveReady(api); autoStart(); status(T('D 维 N 体已就绪'));
        });
      });
    }
    function nowMs() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
    // 五个 uniform 槽各配一个 bind group（0 前半步踢 · 1 漂移 · 2 重算加速度 · 3 后半步踢 · 4 投影）
    function gpuMakeBinds(G) {
      G.bind = [];
      for (var u = 0; u < 5; u++) G.bind.push(G.dev.createBindGroup({ layout: G.BGL, entries: [
        { binding: 0, resource: { buffer: G.uni[u] } }, { binding: 1, resource: { buffer: G.pos } },
        { binding: 2, resource: { buffer: G.vel } }, { binding: 3, resource: { buffer: G.acc } },
        { binding: 4, resource: { buffer: G.proj } }] }));
    }
    /* ---------- 按实测调粒子数 ----------
     * 直接求和一次 accel 是 O(N²·D)，而**一次 compute 派发跑多久，整页的 rAF 就被顶住多久**。
     * 所以开局先用保守的 N（pickN 的 6×10⁸ 对维预算）跑起来，量几批真实耗时，再反推这张卡
     * 能扛多少：N' = N·√(预算 / 实测)。一次最多放大 2×，上限仍是规格里的 32,768 并对齐 workgroup，
     * 下限 4096。粒子数变了就按同一个 seed 重新生成初态（N 不同，离散化本来就不是同一套）。
     * 前两批含 WGSL 编译与预热（真机 113 ms vs 之后 3 ms），一律丢掉不参与统计。
     */
    function gpuBudgetMs() { return S.lowPower ? 5 : 10; }
    /* 用 timestamp-query 量到的**内核耗时**定 N。可以反复调整（每次至少隔 60 帧），
       所以快卡会一档一档走到规格上限 32,768，慢卡会往下退到 4096。 */
    function gpuSample(ms) {
      if (!gpu || S.rebuildWant) return;
      S.gpuSamples = S.gpuSamples || [];
      if (S.gpuSubmits <= 2) return;                    // 第 1–2 批含编译/预热，不作数
      if ((S.adaptHold || 0) > 0) return;
      S.gpuSamples.push(ms);
      if (S.gpuSamples.length < 5) return;
      var a = S.gpuSamples.slice().sort(function (x, y) { return x - y; });
      S.gpuSamples = [];
      var med = a[2];                                   // 中位数：别被个别抖动带偏
      if ((S.nMoves || 0) >= 10) return;                // 别无限折腾
      gpuWantN(med, '内核中位 ' + med.toFixed(2) + ' ms');
    }
    /* 没有 timestamp-query 的机器：退化成帧率判据。
       连续 60 帧里 fps ≥ 50 且这 60 帧至少走了 45 步（说明 GPU 跟得上）→ 放大一档；fps < 30 → 缩一档。 */
    function gpuAdaptByFps() {
      if (!gpu || S.tsOk || S.rebuildWant || (S.adaptHold || 0) > 0) return;
      S.adaptFrames = (S.adaptFrames || 0) + 1;
      if (S.adaptFrames < 60) return;
      var steps = S.stepsIn || 0;
      S.adaptFrames = 0; S.stepsIn = 0;
      if ((S.nMoves || 0) >= 10) return;
      if (S.fps >= 50 && steps >= 45 && S.N < 32768) gpuWantN(gpuBudgetMs() / 2.25, 'fps ' + S.fps + '、60 帧走了 ' + steps + ' 步（无 timestamp-query，按帧率判）');
      else if (S.fps > 0 && S.fps < 30 && S.N > 4096) gpuWantN(gpuBudgetMs() * 2.04, 'fps ' + S.fps + '（无 timestamp-query，按帧率判）');
    }
    function gpuWantN(ms, why) {
      var budget = gpuBudgetMs();
      var f = Math.sqrt(budget / Math.max(ms, 0.05));
      f = clamp(f, 0.5, 2);                             // 一次最多放大 2×、缩小 2×
      var want = Math.ceil(clamp(Math.round(S.N * f), 4096, 32768) / 64) * 64;
      if (Math.abs(want - S.N) < S.N * 0.15) { S.nAdapted = true; return; }   // 差不到 15%：已经到位
      console.log('[hyper] 按实测调整粒子数：' + why + '（预算 ' + budget + ' ms）· N ' + S.N + ' → ' + want);
      S.rebuildWant = want; S.nMoves = (S.nMoves || 0) + 1; S.nAdapted = true;
    }
    /* 换粒子数：设备/管线/uniform 都留着，只重开与 N 有关的缓冲 + 绑定组，按同一 seed 重算初态。
       在飞的活儿没落地就先记下来、下一帧再试——正在被 copy/map 的缓冲不能抽走。 */
    function gpuRebuild(newN) {
      var G = gpu; if (!G || S.disposed) return;
      var busyRead = false, i;
      for (i = 0; i < G.readBusy.length; i++) if (G.readBusy[i]) busyRead = true;
      if (G.busy || busyRead || (G.pendingRead && G.pendingRead.length)) return;   // 下一帧再试
      S.rebuildWant = 0;
      var dev = G.dev, old = { pos: G.pos, vel: G.vel, acc: G.acc, proj: G.proj, read: G.read };
      S.nFrom = S.nFrom || S.N;
      S.N = newN; eps = K.softOf(n, S.N);
      sliceAutoDefault();                                // 粒子数变了，默认切不切也跟着变
      var bytes = S.N * n * 4;
      G.bufGen = (G.bufGen || 0) + 1;                   // 旧回调靠这个认出自己已经过期
      G.pos = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      G.vel = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      G.acc = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE });
      G.proj = dev.createBuffer({ size: S.N * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      G.read = []; G.readBusy = []; G.pendingRead = [];
      for (i = 0; i < 2; i++) { G.read.push(dev.createBuffer({ size: S.N * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })); G.readBusy.push(false); }
      gpuMakeBinds(G);
      G.groups = Math.ceil(S.N / 64);
      proj = new Float32Array(S.N * 4);
      var ic = K.makeIC(cfgOf());                        // 同一个 seed；粒子数变了，初态按新粒子数重新生成
      S.deltaRms = ic.deltaRms; S.modes = ic.modes; S.waveAxes = ic.waveAxes;
      dev.queue.writeBuffer(G.pos, 0, ic.pos);
      dev.queue.writeBuffer(G.vel, 0, ic.vel);
      S.a = aIc; S.tau = 0; S.dir = 1; S.steps = 0; S.reads = 0; S.lastRead = nowMs();
      S.gpuSamples = []; S.gpuSubmits = 0; S.adaptFrames = 0; S.stepsIn = 0; S.adaptHold = 60;
      uploadProj('rebuild');
      gpuKickoff();
      label();
      setTimeout(function () {                           // 旧缓冲延一拍再销毁，别在提交刚发出去时抽走
        try { old.pos.destroy(); old.vel.destroy(); old.acc.destroy(); old.proj.destroy();
              for (var k = 0; k < old.read.length; k++) { try { old.read[k].destroy(); } catch (e) { /* ignore */ } } } catch (e2) { /* ignore */ }
      }, 0);
    }

    /* uniform 里既有 u32（维数/轴号/粒子数）又有 f32（系数/步长），同一段 ArrayBuffer 开两个视图分别写。
       布局与 WGSL 的 struct U 逐字段对齐；writeBuffer 传的是 ArrayBuffer，所以 offset/size 的单位是字节。 */
    function gpuWriteU(slot, o) {
      var G = gpu, f = G.uarr, i32 = G.uarr32, h = axHue(), rc = restCount();
      i32[0] = n; i32[1] = S.N; i32[2] = axes[0]; i32[3] = axes[1];
      i32[4] = axes[2]; i32[5] = h < 0 ? 255 : h; i32[6] = (h >= 0) ? 1 : 0; i32[7] = 0;
      f[8] = 1.5 * cos.OmM / (4 * Math.PI * S.a * S.N); f[9] = amp; f[10] = eps * eps; f[11] = D * 0.5;
      f[12] = S.a * S.a; f[13] = o.half || 0; f[14] = o.dt || 0;
      f[15] = rc > 0 ? 1 / Math.max(1e-6, Math.sqrt(rc / 12)) : 1;
      f[16] = 1; f[17] = sliceEps();
      i32[18] = slice.on ? 1 : 0; i32[19] = 0;
      G.dev.queue.writeBuffer(G.uni[slot], 0, G.uarr.buffer, 0, 80);
    }
    function gpuEncodePass(enc, pipeline, slot, stamp) {
      var G = gpu, desc;
      if (stamp && G.ts && !G.ts.busy) {
        desc = { timestampWrites: { querySet: G.ts.qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } };
        G.tsPending = true;
      }
      var p = enc.beginComputePass(desc);
      p.setPipeline(pipeline); p.setBindGroup(0, G.bind[slot]); p.dispatchWorkgroups(G.groups); p.end();
    }
    /* 把这一批的时间戳解析出来并回读：拿到的是 accel 那个 pass 的 GPU 纳秒，
       与排队、vsync、rAF 节奏全都无关 —— 这才是能拿来定 N 的数。 */
    function gpuStampResolve(G, enc) {
      if (!G.tsPending || !G.ts || G.ts.busy) return;
      G.tsPending = false; G.ts.busy = true;
      enc.resolveQuerySet(G.ts.qs, 0, 2, G.ts.res, 0);
      enc.copyBufferToBuffer(G.ts.res, 0, G.ts.read, 0, 16);
      G.tsWant = true;
    }
    function gpuStampRead(G) {
      if (!G.tsWant || !G.ts) return;
      G.tsWant = false;
      var pr; try { pr = G.ts.read.mapAsync(GPUMapMode.READ); } catch (e) { G.ts.busy = false; return; }
      pr.then(function () {
        if (gpu !== G) { return; }
        var ns = 0;
        try {
          var v = new BigInt64Array(G.ts.read.getMappedRange());
          ns = Number(v[1] - v[0]);
        } catch (e) { ns = 0; }
        try { G.ts.read.unmap(); } catch (e2) { /* ignore */ }
        G.ts.busy = false;
        if (ns > 0 && ns < 5e9) { S.gpuKernelMs = ns / 1e6; gpuSample(S.gpuKernelMs); }
      }, function () { if (gpu === G) G.ts.busy = false; });
    }
    /* 提交并把「在飞的活儿」记为忙。onSubmittedWorkDone 是 promise，不是同步等待：
       上一批没跑完就不提交下一批（见本段开头第 3 条）。 */
    function gpuSubmit(G, enc) {
      var t0 = nowMs();
      G.dev.queue.submit([enc.finish()]);
      G.busy = true;
      /* 记一次「提交 → GPU 真正跑完」的墙钟耗时。直接求和是 O(N²·D)：D=14、N=15232 就是
         3.2×10⁹ 个「粒子对 × 维」，而 WGSL 里 me/g/dr 三个 18 长的私有数组是动态下标，
         多半会被溢出到 scratch（设备内存）—— 单次派发几百毫秒完全可能。
         一次派发跑多久，整页的 requestAnimationFrame 就被顶住多久：画面看着「不动」，
         其实是根本没轮到我们画。这个数是下一轮调 N 的唯一依据，所以头五次都打出来。 */
      G.dev.queue.onSubmittedWorkDone().then(function () {
        if (gpu !== G) return;
        G.busy = false;
        var ms = nowMs() - t0;
        S.gpuStepMs = Math.round(ms);
        S.gpuStepMsMax = Math.max(S.gpuStepMsMax || 0, S.gpuStepMs);
        S.gpuSubmits = (S.gpuSubmits || 0) + 1;
        /* 注意：这个 ms 是**墙钟**（提交 → 跑完），里面混着排队与 vsync 等待，
           一帧一步时它约等于帧间隔 —— 只能拿来看「有没有被顶住」，**不能拿来定 N**。
           定 N 用的是 timestamp-query 量到的 GPU 纳秒（S.gpuKernelMs），见 gpuStampRead。 */
        if (S.gpuSubmits <= 5 || ms > 250) {
          console.log('[hyper] GPU 一批活儿跑完（墙钟）：' + S.gpuStepMs + ' ms · 内核 ' +
            (S.gpuKernelMs != null ? S.gpuKernelMs.toFixed(2) + ' ms' : '未知（无 timestamp-query）') +
            '（N=' + S.N + ' · D=' + fmtNum(D, 2) + ' · 第 ' + S.gpuSubmits + ' 批）' +
            (ms > 250 ? ' ← 一次派发就把整页的 rAF 顶住这么久' : ''));
        }

      }, function () { if (gpu === G) G.busy = false; });
    }
    // 开场：算一次加速度 + 投一次（一个 encoder 一次 submit）
    function gpuKickoff() {
      var G = gpu, enc = G.dev.createCommandEncoder();
      gpuWriteU(2, {}); gpuEncodePass(enc, G.pAccel, 2, true);
      encodeProject(G, enc);
      gpuStampResolve(G, enc);
      gpuSubmit(G, enc);
      drainReads(G); gpuStampRead(G);   // 漏了 drainReads staging 会永远停在 busy，一帧都读不回来
    }
    /* 把投影 pass + 回读拷贝挂进给定的 encoder。两块 staging 都忙就**连 project 都不编码**：
       原来是「照样跑一遍 project、只是不回读」，于是 proj 被反复重写而上一次还没读走，
       浏览器一直报 "READ-usage buffer was written, then fenced, but written again before being read back"，
       还白白烧 GPU 时间。返回是否真的编码了。 */
    function encodeProject(G, enc) {
      var idx = -1, i;
      for (i = 0; i < G.read.length; i++) if (!G.readBusy[i]) { idx = i; break; }
      if (idx < 0) return false;
      gpuWriteU(4, {});
      gpuEncodePass(enc, G.pProj, 4);
      enc.copyBufferToBuffer(G.proj, 0, G.read[idx], 0, S.N * 16);
      G.readBusy[idx] = true;
      // 提交之后再排回读：mapAsync 会等这次提交里的拷贝完成
      G.pendingRead = (G.pendingRead || []).concat([idx]);
      return true;
    }
    // submit 之后调用：把这一批排好的 staging 真正拿去 map（回调里做世代检查，旧实例的回调一律丢掉）
    function drainReads(G) {
      var list = G.pendingRead; if (!list || !list.length) return;
      G.pendingRead = [];
      list.forEach(function (idx) {
        var pr; try { pr = G.read[idx].mapAsync(GPUMapMode.READ); } catch (e) { G.readBusy[idx] = false; return; }
        var gen = G.bufGen || 0;
        pr.then(function () {
          if (S.disposed || gpu !== G || (G.bufGen || 0) !== gen) return;   // 已 dispose / 换过后端 / 粒子数已重建：这块内存不再属于我们
          /* getMappedRange() 给的 ArrayBuffer 在 unmap() 之后会被 detach。
              这里**在 unmap 之前**就整段拷进我们自己的 proj（slice(0) 把话说死），
              之后所有读写（自检、上传 VBO）都只碰 proj，不再碰那块映射内存。 */
          try {
            var mapped = G.read[idx].getMappedRange();
            var copy = mapped.slice(0);                  // 先拷贝，再 unmap
            var fv = new Float32Array(copy);
            if (fv.length === proj.length) proj.set(fv);
            else { proj = fv; S.projLenMismatch = fv.length + '/' + (S.N * 4); }
          } catch (e) { /* 设备没了 */ }
          try { G.read[idx].unmap(); } catch (e2) { /* ignore */ }
          G.readBusy[idx] = false;
          /* 数据到手就**当场上传一次**，同时置脏让 draw() 再兜一次。
             只置脏是不够的：真机上 draw() 可能长时间不跑（一次 O(N²·D) 的 accel 派发能把
             整页的 requestAnimationFrame 顶住几百毫秒到几秒），于是「回读正确、顶点缓冲却
             从头到尾没更新过」—— 屏幕上就是初始那一帧：线框 + 全零 = 中心一个点。 */
          S.projDirty = true; S.projLen = proj ? proj.length : 0; S.projSeq = (S.projSeq || 0) + 1;
          uploadProj('readback');
          S.reads = (S.reads || 0) + 1; S.lastRead = nowMs();
          if (S.reads === 1) firstReadCheck();
          if (logNext) { logProj(logNext); logNext = null; }
        }, function () { if (gpu === G && (G.bufGen || 0) === gen) G.readBusy[idx] = false; });
      });
    }
    // 单独投一次（暂停中换轴、切片开关）：也走一个 encoder 一次 submit
    function gpuProject() {
      var G = gpu; if (!G || !readSlotFree(G)) return;   // 两块 staging 都忙：这一次跳过，下一帧自然会补
      var enc = G.dev.createCommandEncoder();
      if (!encodeProject(G, enc)) return;
      gpuSubmit(G, enc);
      drainReads(G);
    }
    function readSlotFree(G) { for (var i = 0; i < G.read.length; i++) if (!G.readBusy[i]) return true; return false; }
    /* 一个完整的 KDK 步：五个 uniform 槽先写好，四个（含投影是五个）pass 装进**同一个 encoder**，
       整步只 submit 一次。背景 a 在主机侧推进，与 CPU 档同一段 RK2。 */
    function gpuStep(dtau) {
      var G = gpu, half = 0.5 * dtau;
      gpuWriteU(0, { half: half });                     // 前半步踢：用进入这一步时已经算好的 acc
      advanceBg(half);
      gpuWriteU(1, { dt: dtau });                       // 漂移：a 取步中点（二阶精度）
      advanceBg(half);
      gpuWriteU(2, {});                                 // 重算加速度：cg 用步末的 a
      gpuWriteU(3, { half: half });                     // 后半步踢
      var enc = G.dev.createCommandEncoder();
      gpuEncodePass(enc, G.pKick, 0);
      gpuEncodePass(enc, G.pDrift, 1);
      gpuEncodePass(enc, G.pAccel, 2, true);      // 只给 accel 打时间戳：O(N²·D)，其余三个 pass 可以忽略
      gpuEncodePass(enc, G.pKick, 3);
      encodeProject(G, enc);
      gpuStampResolve(G, enc);
      gpuSubmit(G, enc);
      drainReads(G); gpuStampRead(G);
      S.tau += dtau; S.steps++;
    }
    /* WebGPU 档的背景推进：与 kernel 里 advanceA 同一个 RK2 半步式子
       （kernel 的那份在 Worker 里跑，这份在主线程跑，两处必须一模一样）。 */
    function advanceBg(h) {
      var a = S.a, dir = S.dir;
      var k1 = dir * a * K.eOf(cos, a), am = a + k1 * h * 0.5;
      if (am <= 1e-6) am = 1e-6;
      var e2 = K.esq(cos, am);
      if (e2 <= 0) { dir = -1; e2 = 0; }
      var k2 = dir * am * Math.sqrt(Math.max(e2, 0));
      a = a + k2 * h; if (a < 1e-6) a = 1e-6;
      S.a = a; S.dir = dir;
    }
    // GPU 档的步长：拿不到 GPU 上的 max|g|（回读太贵），按 dlna 与固定上限走，
    // 近碰撞由软化长度兜住（ε 已按 D 与 N 调过）
    /* GPU 档的步长：拿不到 GPU 上的 max|g|（回读太贵），按 dlna 与固定上限走。
       ε 收小之后近距离的力大了一个量级，步长也要跟着收（0.02 → 0.006），
       否则定步长会在两两接近时积出垃圾。代价是从 a=0.02 走到 a=1 要 ~650 步
       （一帧一步、60 fps ⇒ 约 11 秒），正好也让人看得见演化过程。 */
    function gpuSuggestDt() {
      var dlna = 0.006 / Math.max(K.eOf(cos, S.a), 1e-6);
      return Math.min(dlna, 0.006);
    }

    /* ---------- 时空图（D=1 的画法）----------
     * 一维宇宙的全部信息就是「每个粒子的 x 随时间怎么走」。把它按三维点云画出来只能得到
     * 屏幕中央一条细线 —— 不是渲染坏了，是那个宇宙真的只有一根轴，但这条线什么也读不出来。
     * 时空图（worldlines）是这类系统的标准画法：横轴 x（整盒 [−0.5, 0.5]），纵轴时间向上滚，
     * 每个粒子留下一条世界线。D=1 的引力是**常力**（r^{−(D−1)} = r⁰，与距离无关），
     * 于是会看到一束束世界线往密处并拢、穿过去、再散开 —— 那正是「没有束缚结构」的样子。
     * 画的全是 N 体轨迹本身，没有任何编造。
     *
     * 实现：一条环形顶点缓冲，K 条被跟踪的世界线 × T 行历史。每帧只用 bufferSubData 写最新一行，
     * 纵坐标由着色器按「这一步离当前多久」当场算，所以整张图自己往上滚，不用重传整块。
     * 色相 = 粒子的**初始位置**（同一条世界线颜色恒定，眼睛跟得住）；亮度 = 当前速率。
     */
    var wlOn = (n === 1), WL = wlOn ? { T: 320, step: 0, K: 0 } : null;
    function wlInit() {
      var K = Math.min(S.N, 1500), T = WL.T, j;
      WL.K = K; WL.step = 0;
      WL.idx = new Int32Array(K); WL.hue = new Float32Array(K); WL.row = new Float32Array(K * 4);
      var stride = S.N / K;
      for (j = 0; j < K; j++) {
        var i = Math.min(S.N - 1, Math.floor(j * stride));
        WL.idx[j] = i;
        // 初始位置 → 色相（0..1023 的整数部分，与 proj 的打包格式一致）
        WL.hue[j] = Math.floor(clamp(proj[i * 4] + 0.5, 0, 0.999) * 1023);
      }
      WL.vbo = gl.createBuffer(); WL.vao = gl.createVertexArray();
      gl.bindVertexArray(WL.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, WL.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, K * T * 16, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    function wlPush() {
      if (!wlOn || !gl || !proj || !S.N) return;
      if (!WL.vbo) wlInit();
      var K = WL.K, T = WL.T, row = WL.row, step = WL.step, j;
      for (j = 0; j < K; j++) {
        var i = WL.idx[j], hw = proj[i * 4 + 3];
        row[j * 4] = proj[i * 4];                       // x（盒坐标 −0.5..0.5）
        row[j * 4 + 1] = step;                          // 绝对步号：纵坐标在着色器里算
        row[j * 4 + 2] = 0;
        row[j * 4 + 3] = WL.hue[j] + (hw - Math.floor(hw));   // 固定色相 + 当前速率当亮度
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, WL.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, (step % T) * K * 16, row);
      WL.step = step + 1;
    }
    function wlDispose() {
      if (!WL || !gl) return;
      try { if (WL.vbo) gl.deleteBuffer(WL.vbo); if (WL.vao) gl.deleteVertexArray(WL.vao); } catch (e) { /* ignore */ }
      WL.vbo = null; WL.vao = null;
    }

    /* ---------- 投影自检与诊断 ----------
       WebGPU 档看不到中间结果，出问题只会表现成「画面不动」。这里在第一次回读后统计一次，
       退化（几乎没有不同的点 / 全是 NaN）就直接落回 CPU 档，别让人对着一个白点猜。 */
    var projStat = null, logNext = null;
    /* 扫全量。上一版的 distinct 封顶 64 且按顺序数，于是「前 64 个是对的、其余全是 0」
       也会报 distinct=64、min/max 也照样是 ±0.5 —— 正好把最该抓的那种坏情况漏掉。
       现在改成两个能分辨整体的指标：
         atOrigin  三个坐标都落在 1e-6 以内的粒子占比（全零回读 = 1.0）
         cells     16³ = 4096 个格子里有几个非空（真实点云通常上千，退化时只有个位数） */
    function projScan() {
      if (!proj) return null;
      var N = S.N, i, mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, nan = 0, culled = 0, atOrigin = 0;
      var G16 = 16, occ = new Uint8Array(G16 * G16 * G16), cells = 0;
      for (i = 0; i < N; i++) {
        var x = proj[i * 4], y = proj[i * 4 + 1], z = proj[i * 4 + 2];
        if (!(isFinite(x) && isFinite(y) && isFinite(z))) { nan++; continue; }
        if (z > 1e5) { culled++; continue; }                 // 切片剔掉的那些
        if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6) atOrigin++;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
        var gx = clamp(((x + 0.5) * G16) | 0, 0, G16 - 1), gy = clamp(((y + 0.5) * G16) | 0, 0, G16 - 1), gz = clamp(((z + 0.5) * G16) | 0, 0, G16 - 1);
        var id = (gz * G16 + gy) * G16 + gx;
        if (!occ[id]) { occ[id] = 1; cells++; }
      }
      return { N: N, nan: nan, culled: culled, cells: cells, atOrigin: +(atOrigin / Math.max(1, N)).toFixed(4),
               xmin: isFinite(mnx) ? +mnx.toFixed(4) : null, xmax: isFinite(mxx) ? +mxx.toFixed(4) : null,
               ymin: isFinite(mny) ? +mny.toFixed(4) : null, ymax: isFinite(mxy) ? +mxy.toFixed(4) : null,
               head: head3() };
    }
    function head3() {
      var o = [], i;
      if (!proj) return o;
      for (i = 0; i < 3 && i < S.N; i++) o.push([+proj[i * 4].toFixed(4), +proj[i * 4 + 1].toFixed(4), +proj[i * 4 + 2].toFixed(4), +proj[i * 4 + 3].toFixed(3)]);
      return o;
    }
    function logProj(tag) {
      try {
        console.log('[hyper] ' + tag + ' · ' + (S.mode === 'webgpu' ? 'WebGPU' : 'CPU') + ' · D=' + fmtNum(D, 2) +
          ' · N=' + S.N + ' · 轴 ' + axesLabel() + ' · 切片=' + (slice.on ? fmtNum(sliceEps(), 3) : 'off') +
          ' · 前 3 个粒子投影 ' + JSON.stringify(head3()));
      } catch (e) { /* ignore */ }
    }
    function firstReadCheck() {
      projStat = projScan();
      if (!projStat) return;
      logProj('首次回读自检 ' + JSON.stringify({ cells: projStat.cells, atOrigin: projStat.atOrigin, nan: projStat.nan,
        culled: projStat.culled, x: [projStat.xmin, projStat.xmax], y: [projStat.ymin, projStat.ymax],
        frames: S.frames || 0, uploads: S.uploads || 0 }));
      // 切片开着时「没剩几个点」是正常结果，不算退化；atOrigin 高 = 绝大多数粒子挤在原点
      var dead = projStat.nan >= S.N || (!slice.on && (projStat.cells < 8 || projStat.atOrigin > 0.9));
      if (!dead) return;
      console.warn('[hyper] WebGPU 投影退化：' + JSON.stringify(projStat) + ' —— compute pass 很可能一次都没真跑（绑定组/布局），已自动落回 Worker CPU 档');
      fallbackToCPU('degenerate-projection ' + JSON.stringify({ distinct: projStat.distinct, nan: projStat.nan }));
    }
    // 把 GPU 档整个拆掉、原地换成 Worker CPU 档；画面不中断（下一帧就是 CPU 档在画）
    function fallbackToCPU(why) {
      if (S.disposed || S.mode !== 'webgpu') return;
      S.gpuFellBack = why || 'unknown';
      destroyGPU();
      S.reads = 0; projStat = null;
      try { initCPU(); } catch (e) { console.warn('[hyper] 落回 CPU 档失败', e); }
    }
    /* 拆 GPU 档。两件事必须分开：
       **先**把 gpu 置空（所有在飞的 mapAsync / onSubmittedWorkDone 回调都做 `gpu !== G` 的世代检查，
       置空之后它们一律自己走开，不会去碰新实例的 proj / VBO）；
       **后**在下一个宏任务里才真的 destroy —— 在 map 回调自己的调用栈里同步 destroy 那块 buffer、
       或者在 submit 刚发出去就 destroy 设备，Dawn 那边要同步等命令流水排空，真机上就是整页冻住。 */
    function destroyGPU() {
      if (!gpu) return;
      var g = gpu; gpu = null;
      try { g.dev.onuncapturederror = null; } catch (e0) { /* ignore */ }
      g.pendingRead = null;
      root.setTimeout(function () {
        try {
          if (g.ts) { try { g.ts.qs.destroy(); g.ts.res.destroy(); g.ts.read.destroy(); } catch (e0) { /* ignore */ } }
          for (var i = 0; i < g.read.length; i++) { try { g.read[i].destroy(); } catch (e) { /* 可能还 mapped 着 */ } }
          for (i = 0; i < g.uni.length; i++) { try { g.uni[i].destroy(); } catch (e1) { /* ignore */ } }
          g.pos.destroy(); g.vel.destroy(); g.acc.destroy(); g.proj.destroy();
          g.dev.destroy();
        } catch (e2) { /* ignore */ }
      }, 0);
    }

    /* ---------- 主循环 ---------- */
    var raf = 0, lastFrame = 0, fpsAcc = 0, fpsN = 0;
    /* 每帧循环**不许被一次异常打死**。以前 frame() 里任何一处抛出（GPU 提交、投影、面板重绘…）
       都会让 requestAnimationFrame 链就此断掉：画面从此停在最后一帧上。
       而第一帧恰恰是「线框 + proj 全零 = 中心一个点」——看起来就像粒子没画出来，
       其实是整条渲染循环早就停了，非常难认。现在包一层：记下错误、照常排下一帧，
       第一次出错在控制台留一条完整栈，诊断里也带着（frameErr）。 */
    function frame(ts) {
      raf = 0;
      if (S.disposed) return;
      try { frameBody(ts); }
      catch (e) {
        S.frameErrs = (S.frameErrs || 0) + 1;
        S.frameErr = String((e && e.stack) || e).slice(0, 400);
        if (S.frameErrs === 1) console.error('[hyper] 每帧循环出错（已继续下一帧）：', e);
      }
      raf = root.requestAnimationFrame(frame);
    }
    function frameBody(ts) {
      var now = ts || ((root.performance && performance.now()) || Date.now());
      var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0.016;
      lastFrame = now;
      var t0 = (root.performance && performance.now()) || Date.now();

      /* WebGPU 档：物理由主线程提交命令驱动（CPU 档的物理在 worker 里，这里什么都不用做）。
         一帧**最多一步**，而且上一批还在飞就整帧不提交（gpu.busy 由 onSubmittedWorkDone 清）。
         直接求和是 O(N²·D)：16k 粒子 14 维一次 accel 就是 3.7×10⁹ 个「粒子对×维」，
         核显上单次几十毫秒。不封顶的话一秒能堆出几十秒的 GPU 活儿，表现就是整页冻死。 */
      if (S.adaptHold > 0) S.adaptHold--;
      if (gpu && S.ready && S.rebuildWant) gpuRebuild(S.rebuildWant);
      else if (gpu && S.ready) gpuAdaptByFps();
      if (gpu && S.ready && S.running && !gpu.busy && !S.hidden && !S.blurred) {
        if ((S.dir > 0 && S.a >= S.targetA) || (S.dir < 0 && S.a <= S.targetA)) S.running = false;
        else {
          var d1 = gpuSuggestDt();
          var eNow = Math.max(K.eOf(cos, S.a), 1e-9);
          var toT = Math.abs(Math.log(S.targetA / S.a)) / eNow;
          if (toT > 0 && d1 > toT) d1 = toT;
          gpuStep(d1);                                  // 投影 pass 就挂在同一个 encoder 里，不另发
          S.stepsIn = (S.stepsIn || 0) + 1;
        }
      } else if (gpu && S.ready && !gpu.busy && S.reads === 0) {
        gpuProject();                                   // 还没读回过一次：暂停中也要把画面先投出来
      }
      /* 回读拿到了数据、顶点缓冲却一次都没更新：这条路径上出过一次真机 bug，留个明确的告警，
         别再让人对着「自检全对、画面不动」去猜。 */
      if (!S.staleWarned && S.reads > 0 && (S.uploads || 0) < 2 && now - (S.lastRead || now) > 2000) {
        S.staleWarned = true;
        console.warn('[hyper] 已回读 ' + S.reads + ' 次，但顶点缓冲只上传过 ' + (S.uploads || 0) +
          ' 次（frames=' + (S.frames || 0) + ' · projDirty=' + !!S.projDirty + ' · ready=' + S.ready +
          ' · disposed=' + S.disposed + '）—— 画面会停在初始那一帧');
      }
      /* 保险：WebGPU 档 5 秒读不回一帧数据，说明这条路已经卡住（设备没响应 / 回读排不出去 /
         校验错把 pass 全废了），直接落 CPU 档，别让人对着一张不动的画面等。 */
      if (gpu && S.ready && S.lastRead && !S.hidden && !S.blurred && (S.running || !S.reads) &&
          ((root.performance && performance.now()) || Date.now()) - S.lastRead > 5000) {
        console.warn('[hyper] WebGPU 已 5 秒没有回读到投影数据（reads=' + (S.reads || 0) + '，busy=' + gpu.busy + '），落回 Worker CPU 档');
        fallbackToCPU('no-readback-5s reads=' + (S.reads || 0));
      }
      S.stepMs = ((root.performance && performance.now()) || Date.now()) - t0;

      if (S.orbit && !wlOn && !reducedMotion() && !cam.dragging) cam.yaw += dt * 0.055;
      draw();
      drawDim(dt);                                     // 遮罩盖着时把那一屏画在上面（底下的 N 体照跑）
      S.drawMs = ((root.performance && performance.now()) || Date.now()) - t0;

      S.frames = (S.frames || 0) + 1; S.lastFrameAt = now;
      fpsAcc += dt; fpsN++;
      if (fpsAcc >= 0.5) { S.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
      syncPanel(dt);
    }
    var W = 1, H = 1, dpr = 1;
    function resize() {
      dpr = Math.min(root.devicePixelRatio || 1, opts.maxDpr || 1.5);
      var cw = canvas.clientWidth || 640, ch = canvas.clientHeight || 480;
      W = Math.max(1, Math.round(cw * dpr)); H = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    }
    var szTick = 0;
    function draw() {
      if (!gl) return;
      if ((++szTick % 15) === 0) resize();
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!S.ready || !proj) return;
      /* 时空图是一张**图**，不是一个可以绕着转的三维场景：机位锁死在正前方，
         视距刚好让 [−0.5,0.5]² 那个方框填满画面。 */
      var d = wlOn ? 1.18 : (S.overview ? 4.2 : cam.dist);
      if (wlOn) { cam.yaw = 0; cam.pitch = 0; cam.target = [0, 0, 0]; }
      var eye = [
        cam.target[0] + d * Math.cos(cam.pitch) * Math.sin(cam.yaw),
        cam.target[1] + d * Math.sin(cam.pitch),
        cam.target[2] + d * Math.cos(cam.pitch) * Math.cos(cam.yaw)
      ];
      var vp = m4mul(m4persp(cam.fov, W / Math.max(H, 1), 0.01, 60), m4lookAt(eye, cam.target, [0, 1, 0]));
      gl.useProgram(progLine);
      gl.uniformMatrix4fv(uniLine.vp, false, vp);
      gl.uniform4f(uniLine.c, 0.26, 0.34, 0.6, 1);
      gl.bindVertexArray(lineVao);
      gl.drawArrays(gl.LINES, 0, lineCount);
      if (S.projDirty) uploadProj('draw');               // 与 drawArrays 同一个任务、同一段 GL 状态
      if (wlOn && WL.lastSeq !== S.projSeq) { WL.lastSeq = S.projSeq; wlPush(); }
      gl.useProgram(prog);
      gl.uniformMatrix4fv(uni.vp, false, vp);
      /* 点大小：以相机距 2.0 为参考给 2.6–5 CSS 像素（粒子越多画得越小），再由 1/w 按距离衰减。
         点画大了就糊成一团——D≥4 的画面本来就是「均匀铺满」，糊了就什么都读不出来。 */
      // 粒子越少画得越大：2k 个硬小点读到的只有散粒噪声，软大点叠起来才是密度场
      // 时空图的点要小：一条世界线是由几百个点连出来的，点一大就糊成一片
      var ptPx = wlOn ? 1.7 : (S.N > 12000 ? 3.2 : (S.N > 5000 ? 4.6 : 7.2));
      gl.uniform1f(uni.pt, ptPx * 2.4 * dpr);
      // 换轴后的 300 ms 淡入：从 15% 亮度升到满亮，让「整个重排」这件事有动作感
      var left = S.fadeUntil ? (S.fadeUntil - nowMs()) : 0;
      var fade = left > 0 ? (0.15 + 0.85 * (1 - left / 300)) : 1;
      gl.uniform1f(uni.gain, S.gain * (S.lowPower ? 0.8 : 1) * fade * (wlOn ? 0.20 : 1));
      if (wlOn && WL.vbo) {
        // 时空图：画环形缓冲里已经填过的那部分（没填满时只画前 step 行）
        gl.uniform1f(uni.wl, 1); gl.uniform1f(uni.tHead, WL.step - 1); gl.uniform1f(uni.tSpan, WL.T);
        var cnt = Math.min(WL.step, WL.T) * WL.K;
        gl.bindVertexArray(WL.vao);
        gl.drawArrays(gl.POINTS, 0, cnt);
        S.drawCount = cnt;
      } else {
        gl.uniform1f(uni.wl, 0);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.POINTS, 0, S.N);
        S.drawCount = S.N;
      }
      gl.bindVertexArray(null);
    }

    /* ---------- 「我们无法观察它」那一屏的常驻提示 ----------
       D≥4 时宿主先给 ui/universe3d.js 画原著那一屏（混乱的色彩和形状），揭开之后才切到这里。
       切过来之后那行常驻提示与「重看那一屏」必须还在，所以直接复用 universe3d 导出的同一个部件
       （同一份界面、同一份会话记忆）。点「重看那一屏」→ veiled 翻回 true → 宿主看到
       getState().dimVeiled 变了，就把画面切回 universe3d 并让它重新盖上。 */
    var veil = null, veiled = false, dimCv = null, dimCtx = null, dimChaos = null;
    function buildVeil() {
      var U = root.MirrorUniverse3D;
      if (!opts.veil || !U || typeof U.createDimVeil !== 'function') return;
      /* 遮罩期那一屏（混乱的色彩和形状）由本模块自己画：createDimChaos 是 universe3d 导出的同一份实现，
         两条路看到的是同一幅画面、同一套种子。以前这一屏只能由一个 universe3d 实例来放，
         于是 D≥4 必须先建一整套 PM 模拟（光生成初始条件就几十秒，屏幕上还一眼看不到）
         再在揭开时整个拆掉换成 N 体 —— 真显卡上那一拆一建会连着建/销毁两个 WebGPU 设备。
         现在遮罩期不再需要任何 PM，也不需要换视图。 */
      if (typeof U.createDimChaos === 'function' && root.document) {
        dimChaos = U.createDimChaos(seed, D);
        dimCv = root.document.createElement('canvas');
        dimCv.className = 'hy-dim';
        dimCv.setAttribute('aria-hidden', 'true');
        dimCv.hidden = true;
        canvas.parentNode.insertBefore(dimCv, canvas.nextSibling);
        dimCtx = dimCv.getContext('2d');
      }
      veil = U.createDimVeil(host, {
        dim: D,
        exitText: '仍然要看它的 D 维 N 体投影',
        tipHead: '屏幕上是它的 D 维 N 体投影（D=',
        onChange: function (rev) { veiled = !rev; syncVeil(); label(); }
      });
      if (veil) { veiled = !veil.revealed(); veil.setVisible(true); }
      syncVeil();
    }
    // 遮罩盖着的时候：那一屏显示、换轴面板收起（底下的 N 体照跑不误，与 universe3d 的做法一致）
    function syncVeil() {
      if (dimCv) dimCv.hidden = !veiled;
      if (panel) panel.hidden = !!veiled || !S.labels;
    }
    function drawDim(dt) {
      // 每帧对一次显隐：只在 onChange 里对的话，任何一次没走到 onChange（或那一帧抛了）
      // 都会让遮罩状态和覆盖层永久对不上（HUD 说「我们无法观察它」而屏幕上根本没有那一屏）
      if (dimCv) dimCv.hidden = !veiled;
      if (panel) panel.hidden = !!veiled || !S.labels;
      if (!veiled || !dimCtx || !dimCv || !dimChaos) return;
      if (dimCv.width !== W || dimCv.height !== H) { dimCv.width = W; dimCv.height = H; dimChaos.reset(); }
      dimCtx.setTransform(dpr, 0, 0, dpr, 0, 0);       // 画布按设备像素开，内容按 CSS 像素画
      dimChaos.draw(dimCtx, Math.max(1, W / dpr), Math.max(1, H / dpr), dt, { calm: S.lowPower, drawText: !veil });
    }

    /* ---------- 换轴面板 ---------- */
    var panel = null, pAxRow = null, pInfo = null, pAll = null, pSlice = null, pSliceRange = null, panelAcc = 0;
    function buildPanel() {
      panel = root.document.createElement('div');
      panel.className = 'hy-panel';
      host.appendChild(panel);
      var r1 = mk('div', 'hy-row');
      r1.appendChild(mk('span', 'hy-t', T('投影轴')));
      pAxRow = mk('span', 'hy-row'); pAxRow.style.display = 'inline-flex'; r1.appendChild(pAxRow);
      r1.appendChild(btn(T('随机 (P)'), function () { api.randomAxes(); }));
      r1.appendChild(btn('[', function () { api.stepAxes(-1); }, T('上一组预设轴')));
      r1.appendChild(btn(']', function () { api.stepAxes(1); }, T('下一组预设轴')));
      if (!wlOn) panel.appendChild(r1);       // 时空图：只有一根轴，没有「换一组轴」这回事
      var r2 = mk('div', 'hy-row');
      r2.appendChild(mk('span', 'hy-t', T('全部轴')));
      pAll = mk('span', 'hy-row'); pAll.style.display = 'inline-flex'; r2.appendChild(pAll);
      if (!wlOn) panel.appendChild(r2);
      var r3 = mk('div', 'hy-row');
      pSlice = btn(T('切片'), function () { api.toggleSlice(); });
      pSlice.setAttribute('aria-pressed', 'false');
      r3.appendChild(pSlice);
      pSliceRange = root.document.createElement('input');
      pSliceRange.type = 'range'; pSliceRange.min = '1'; pSliceRange.max = '50'; pSliceRange.step = '1'; pSliceRange.value = String(Math.round(slice.frac * 100));
      pSliceRange.setAttribute('aria-label', T('切片保留比例'));
      pSliceRange.addEventListener('input', function () { api.setSliceEps(+pSliceRange.value / 100); });
      pSliceRange.addEventListener('keydown', function (e) { e.stopPropagation(); });
      r3.appendChild(pSliceRange);
      r3.appendChild(mk('span', 'hy-t', '%'));
      r3.appendChild(btn(T('重置视角'), function () { cam.yaw = 0.6; cam.pitch = 0.42; cam.dist = 2.9; cam.target = [0, 0, 0]; }));
      if (wlOn) { var r3b = mk('div', 'hy-row'); r3b.appendChild(btn(T('重置视角'), function () { resetCam(); })); panel.appendChild(r3b); }
      else panel.appendChild(r3);
      pInfo = mk('div', 'hy-note');
      panel.appendChild(pInfo);
      // 轴按钮：手选三根轴
      for (var d = 0; d < n; d++) (function (dd) {
        var b = btn(axName(dd), function () { pickAxis(dd); });
        b.className = 'hy-b ax';
        pAll.appendChild(b);
      })(d);
      paintAxes();
    }
    function mk(tag, cls, txt) { var e = root.document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
    function btn(txt, fn, title) {
      var b = mk('button', 'hy-b', txt); b.type = 'button';
      if (title) b.title = title;
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); b.blur(); });
      return b;
    }
    // 手选：点一根没被选中的轴，就把它换进「最久没动过」的那个槽
    function pickAxis(d) {
      if (axes.indexOf(d) >= 0) return;
      var slot = slotOrder.shift(); slotOrder.push(slot);
      axes[slot] = d;
      afterAxes();
    }
    function paintAxes() {
      if (!pAxRow) return;
      while (pAxRow.firstChild) pAxRow.removeChild(pAxRow.firstChild);
      for (var i = 0; i < 3; i++) {
        var b = mk('span', 'hy-b slot', axes[i] < n ? axName(axes[i]) : '—');
        pAxRow.appendChild(b);
      }
      var kids = pAll ? pAll.childNodes : [];
      for (i = 0; i < kids.length; i++) kids[i].setAttribute('aria-pressed', axes.indexOf(i) >= 0 ? 'true' : 'false');
      if (pSlice) pSlice.setAttribute('aria-pressed', slice.on ? 'true' : 'false');
      paintInfo();
    }
    function paintInfo() {
      if (!pInfo) return;
      var h = axHue(), rc = restCount();
      var s;
      if (wlOn) s = T('一维宇宙的时空图：横轴位置、纵轴时间（向上为新），每条线是一个粒子的世界线。常力引力（r⁰，与距离无关）下没有束缚结构：世界线只会并拢、穿过、再散开');
      else if (n <= 2) s = T('这个宇宙只有 ') + n + T(' 根空间轴：画面就是一条线 / 一个面，不是渲染问题。颜色 = 速度');
      else if (h < 0) s = T('三根轴已经用光（D=') + fmtNum(D, 2) + T('）：没有可折进颜色的维度，颜色 = 速度');
      else s = T('色相 = ') + axName(h) + (rc > 0 ? T(' · 亮度 = 其余 ') + rc + T(' 维到盒心的范数') : T(' · 没有更多维度'));
      var vm = visibleModes();
      if (vm != null) s += vm > 0 ? T('　·　可见初始扰动模 ') + vm + '/' + (S.modes || 0)
                                  : T('　·　这一面是均匀的：可见初始扰动模 0/') + (S.modes || 0);
      if (wlOn) s += T('　·　跟踪 ') + fmtBig(WL.K || 0) + T(' 条世界线 × ') + WL.T + T(' 步历史');
      else if (slice.on) s += T('　·　切片 · 厚度 ε=') + fmtNum(sliceEps(), 2) + T('（未选的 ') + sliceRestN() + T(' 根轴各自 |x−0.5|<ε，约保留 ') + Math.round(slice.frac * 100) + T('% 的粒子）');
      else s += T('　·　整盒投影：全部 ') + n + T(' 维一起压到这三根轴上（开「切片」只看盒心那一薄片，薄层会变清楚）');
      s += T('　·　预设 ') + (presetIdx + 1) + '/' + presets.length;
      pInfo.textContent = s;
    }
    // 面板里只有「预设 i/n」会随操作变；每 0.5 s 对一次就够（换轴那一下由 afterAxes 立刻重画）
    function syncPanel(dt) { panelAcc += dt; if (panelAcc < 0.5) return; panelAcc = 0; paintInfo(); }
    /* 换轴时把相机复位到同一个俯瞰角度，并给 300 ms 淡入。
       不复位的话，上一组轴留下的视角会让「同一份数据换三根轴」看上去只是颜色变了；
       固定同一个机位，屏幕上的差别才全部来自数据本身。勾了「减少动态」就不淡入，直接切。 */
    function resetCam() { cam.yaw = 0.6; cam.pitch = 0.42; cam.dist = 2.9; cam.target = [0, 0, 0]; S.overview = false; }
    function afterAxes(keepCam) {
      if (!keepCam) { resetCam(); S.fadeUntil = reducedMotion() ? 0 : (nowMs() + 300); }
      paintAxes();
      if (posSnap) { projectCPU(); logProj('换轴'); }
      else if (gpu) { logNext = '换轴'; gpuProject(); }      // GPU 档要等下一次回读才有新数据可打
      if (typeof opts.onAxes === 'function') { try { opts.onAxes(axes.slice()); } catch (e) { /* ignore */ } }
      label();
    }

    /* ---------- 输入 ---------- */
    on(canvas, 'contextmenu', function (e) { e.preventDefault(); });
    on(canvas, 'pointerdown', function (e) {
      if (e.button !== 0 && e.button !== 2) return;
      cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY; cam.moved = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    on(canvas, 'pointermove', function (e) {
      if (!cam.dragging) return;
      var dx = e.clientX - cam.lastX, dy = e.clientY - cam.lastY;
      cam.lastX = e.clientX; cam.lastY = e.clientY; cam.moved += Math.abs(dx) + Math.abs(dy);
      cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.006, -1.5, 1.5);
    });
    on(canvas, 'pointerup', function (e) {
      if (!cam.dragging) return; cam.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    on(canvas, 'wheel', function (e) { cam.dist = clamp(cam.dist * Math.pow(1.12, e.deltaY / 100), 0.15, 12); }, { passive: true });
    on(canvas, 'touchstart', function (e) { if (e.touches.length === 1) { cam.dragging = true; cam.lastX = e.touches[0].clientX; cam.lastY = e.touches[0].clientY; } }, { passive: true });
    on(canvas, 'touchmove', function (e) {
      if (e.touches.length !== 1 || !cam.dragging) return;
      var dx = e.touches[0].clientX - cam.lastX, dy = e.touches[0].clientY - cam.lastY;
      cam.lastX = e.touches[0].clientX; cam.lastY = e.touches[0].clientY;
      cam.yaw -= dx * 0.007; cam.pitch = clamp(cam.pitch + dy * 0.007, -1.5, 1.5);
    }, { passive: true });
    on(canvas, 'touchend', function () { cam.dragging = false; });
    function isTyping() { var a = root.document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); }
    /* 键盘：只认 P / [ / ] 三个，别的全留给宿主（空格 = 播放暂停、Esc = 退出、A = 分析面板…）。
       用 capture 在宿主之前拿到并就地停住，免得 [ ] 被别处吃掉。 */
    on(root, 'keydown', function (e) {
      if (S.disposed || isTyping()) return;
      var k = e.key;
      if (k === 'p' || k === 'P') { api.randomAxes(); e.preventDefault(); e.stopPropagation(); }
      else if (k === '[' || k === '【') { api.stepAxes(-1); e.preventDefault(); e.stopPropagation(); }
      else if (k === ']' || k === '】') { api.stepAxes(1); e.preventDefault(); e.stopPropagation(); }
    }, true);
    on(root.document, 'visibilitychange', function () { S.hidden = !!root.document.hidden; syncSuspend(); });
    on(root, 'blur', function () { S.blurred = true; syncSuspend(); });
    on(root, 'focus', function () { S.blurred = false; syncSuspend(); });
    on(root, 'resize', resize);
    on(root.document, 'mirror:lang', function () {
      try { label(); paintAxes(); } catch (e) { /* ignore */ }
      try { canvas.setAttribute('aria-label', T('D 维 N 体投影视图')); } catch (e) { /* ignore */ }
    });
    function syncSuspend() {
      var sus = S.hidden || S.blurred;
      if (worker) {
        if (sus && S.running) { worker.postMessage({ type: 'pause' }); S.pausedByHide = true; }
        else if (!sus && S.pausedByHide) { S.pausedByHide = false; worker.postMessage({ type: 'run', targetA: S.targetA }); S.running = true; }
      }
      if (!sus) { lastFrame = 0; S.lastRead = nowMs(); }     // 回前台重置：别让「挂后台 5 秒」被当成 GPU 卡住
    }

    /* ---------- 顶部说明 ---------- */
    var labelStr = '';
    function label() {
      var s = 'D=' + fmtNum(D, 2) + T(' 的宇宙（D = 空间有几个维度，我们的宇宙是 3）· 真 ') + fmtNum(D, 2) + T(' 维 N 体（N=') + fmtBig(S.N) + T('，直接求和 ') +
        (S.mode === 'webgpu' ? T('WebGPU') : T('Worker CPU')) + T('）') +
        (wlOn ? T(' · 时空图：横轴位置、纵轴时间（向上为新），每条线是一个粒子的世界线；色相 = 初始位置，亮度 = 当前速率')
              : T(' · 投影到 ') + axesLabel());
      var rc = restCount(), h = axHue();
      if (h >= 0 && !wlOn) s += T(' · 其余 ') + (n - 3) + T(' 维折进颜色') + (rc > 0 ? T('与亮度') : '');
      if (slice.on) s += T(' · 切片 · 厚度 ε=') + fmtNum(sliceEps(), 2) + T('（约保留 ') + Math.round(slice.frac * 100) + T('%）');
      // 粒子数是按这张卡的实测速度定的，不是写死的：说一句，免得同一个宇宙在两台机器上 N 不同看着像 bug
      if (S.nFrom && S.nFrom !== S.N) s += T('　·　已按显卡性能调到 N=') + fmtBig(S.N) + T('（开局 ') + fmtBig(S.nFrom) + T('，单批预算 ') + gpuBudgetMs() + T(' ms）');
      s += T(' · 软化长度 ε=') + fmtNum(eps, 3) + T(' 盒长');
      /* 屏幕上那些薄层/条纹是**初始条件**，不是引力长出来的 —— D≥4 下引力根本不放大它。
         这句必须写，否则「有结构」会被读成「成团了」。 */
      if (S.deltaRms) {
        var vis = visibleModes();
        s += T(' · 初始扰动 δ_rms≈') + fmtNum(S.deltaRms, 2) +
          T('（可视化取值，比真实宇宙 a≈0.02 时的 ~10⁻³ 大得多）；来自 ') + (S.modes || 0) +
          T(' 个平面波，方向/相位/振幅由区块哈希决定') +
          (D >= 4 - 1e-9 ? T('；D≥4 下引力不放大它，屏幕上的结构自始至终只是初态') : '');
        if (vis != null) s += vis > 0
          ? T('　·　这组轴里有 ') + vis + T(' 个初始扰动模可见')
          : T('　·　这组轴里没有可见的初始扰动模：这一面是均匀的（那些模不在这三根轴上，不是渲染问题）');
      }
      /* 铁律：不许出现「成团 = 结构」的暗示。D≥4 下必须明写没有束缚结构。 */
      if (D >= 4 - 1e-9) s += T('　·　没有束缚结构，这是 r^{−(D−1)} 的直接后果（Ehrenfest 1917：D≥4 无稳定圆轨道）');
      else if (D <= 2 + 1e-9) s += T('　·　D≤2 的 r^{−(D−1)} 是常力（D=1）或对数势（D=2）：没有牛顿吸引，物质不会聚成团（Tegmark 1997）');
      else if (D < 4) s += T('　·　2<D<4：轨道稳定但不闭合（进动），这是直接积分出来的，不是外推');
      /* 遮罩盖着的时候，顶部说明先说人**看到**的是什么，再说底下还在算什么——不然屏幕和标注对不上 */
      if (veiled) s = T('高维宇宙（D=') + fmtNum(D, 2) + T('）：我们无法观察它 · 屏幕上只有一堆极其混乱的色彩和形状') + T(' · 底层仍在跑：') + s;
      labelStr = s;
      return s;
    }

    /* ---------- ready ---------- */
    var resolveReady = null, rejectReady = null;
    var ready = new Promise(function (res, rej) { resolveReady = res; rejectReady = rej; });
    ready.catch(function () { /* 由调用方处理 */ });

    /* ---------- 对外 API（与 ui/universe3d.js 的子集同形，app.js 两条路共用一套接线） ---------- */
    var api = {
      ready: ready,
      canvas: canvas,
      isHyper: true,
      start: function () { setRunning(true); return api; },
      pause: function () { setRunning(false); return api; },
      setTime: function (tGyr) {
        var a = aOfTGyr(tGyr);
        if (a < S.a * 0.999) {                                  // 回拨：N 体不能倒放，按同一初态重算
          S.targetA = a; S.a = aIc; S.tau = 0; S.dir = 1; S.steps = 0;
          if (worker) worker.postMessage({ type: 'reset', cfg: cfgOf(), targetA: a });
          else if (gpu) { resetGPU(); S.running = true; }
          status(T('回拨：D 维 N 体按同一初始条件重算'));
        } else { S.targetA = a; setRunning(true); }
        return api;
      },
      getState: function () {
        return {
          ready: S.ready, hyper: true, mode: S.mode === 'webgpu' ? 'webgpu' : 'cpu', tier: tier,
          N: S.N, mesh: 0, dims: n, dimS: D,
          a: S.a, z: zOf(S.a), t: tGyrOfA(S.a), contracting: S.dir < 0,
          running: S.running, fps: S.fps, stepsPerSec: S.msPerStep > 0 ? 1000 / S.msPerStep : 0,
          yearsPerSecond: yearsPerSecond(),
          scale: { boxMpc: L * S.a, boxMpcOverH: L },
          label: label(), layer: '模拟',
          halosFound: 0, lod: 0, galaxy: null,
          overview: S.overview, orbit: S.orbit, volume: false, exposureAuto: S.exposureAuto, lowPower: S.lowPower,
          dimView: D >= 4 ? 'chaos' : (D >= 2 && D < 3 ? 'plane' : 'normal'), dimVeiled: veiled,
          axes: axes.slice(), axesLabel: axesLabel(), presets: presets.length, presetIdx: presetIdx,
          slice: slice.on, sliceEps: sliceEps(), sliceFrac: slice.frac,
          soften: eps, amp: amp, stepMs: S.stepMs, drawMs: S.drawMs, msPerStep: S.msPerStep,
          sigma8: null, sigma8Linear: null, cpuPhysics: S.mode !== 'webgpu', gpuLabel: S.mode
        };
      },
      halos: function () { return null; },                     // D≠3 没有「晕」可言：镜像那边会退回按种子生成
      flyTo: function (where) {
        if (where === 'densest') { centerOnDensest(); return api; }
        status(T('D≠3 的宇宙里没有晕：没有束缚结构，这是 r^{−(D−1)} 的直接后果'));
        return api;
      },
      toggleOverview: function () { S.overview = !S.overview; return api; },
      toggleOrbit: function () { S.orbit = !S.orbit; return api; },
      toggleVolume: function () { status(T('D 维 N 体没有体渲染：屏幕上就是粒子本身')); return api; },
      toggleLabels: function () { S.labels = !S.labels; syncVeil(); return api; },
      setExposure: function (ev) {
        if (ev === 'auto') { S.exposureAuto = true; S.gain = 0.85; }
        else { S.exposureAuto = false; S.gain = clamp(Math.pow(2, +ev || 0), 0.05, 20); }
        return api;
      },
      setLowPower: function (v) { S.lowPower = !!v; if (worker) worker.postMessage({ type: 'power', low: S.lowPower }); return api; },
      // keepCam：程序化设轴（验收脚本、外部联动）时不动相机；用户换轴走 randomAxes/stepAxes，会复位
      setAxes: function (a, keepCam) {
        if (!a || a.length < 3) return api;
        // 越界的轴号是合法的：轴不够三根时它表示「这一槽没有轴」，投影时按盒心处理（见 axisPresets）
        axes = [clamp(a[0] | 0, 0, 17), clamp(a[1] | 0, 0, 17), clamp(a[2] | 0, 0, 17)];
        afterAxes(keepCam); return api;
      },
      randomAxes: function () {
        if (presets.length <= 1) { status(T('这个宇宙的空间轴不足 4 根，只有一组投影')); return api; }
        var i = 0, tryN = 0;
        do { i = (Math.random() * presets.length) | 0; tryN++; } while (tryN < 12 && sameAxes(presets[i], axes));
        presetIdx = i; axes = presets[i].slice(); afterAxes(); return api;
      },
      stepAxes: function (d) {
        if (presets.length <= 1) { status(T('这个宇宙的空间轴不足 4 根，只有一组投影')); return api; }
        presetIdx = (presetIdx + (d < 0 ? -1 : 1) + presets.length) % presets.length;
        axes = presets[presetIdx].slice(); afterAxes(); return api;
      },
      toggleSlice: function () { slice.on = !slice.on; S.sliceTouched = true; afterAxes(true); return api; },
      // 参数是**保留比例**（0.01–0.5），不是 ε 本身：ε 由维数反推，见 slice 的注释
      setSliceEps: function (f) { slice.frac = clamp(+f || 0.40, 0.01, 0.5); S.sliceTouched = true; if (slice.on) afterAxes(true); else paintInfo(); return api; },
      axisInfo: function () { return { n: n, D: D, axes: axes.slice(), hue: axHue(), rest: restCount(), presets: presets.length, presetIdx: presetIdx }; },
      /* 看门狗 dump 用（app.js 的 wdSnapshot 把它挂到 c.hyper）：后端、粒子数、回读样本、轴、切片，
         外加 WebGPU 出过的错。projScan() 会扫一遍当前投影，只在出问题时调，不进每帧路径。 */
      diagnostics: function () {
        return { backend: S.mode, N: S.N, dims: n, D: D, veiled: veiled, axes: axesLabel(), presetIdx: presetIdx, presets: presets.length,
                 slice: slice.on, sliceFrac: slice.frac, sliceEps: sliceEps(), soften: eps, amp: amp,
                 deltaRms: S.deltaRms || null, modes: S.modes || null,
                 a: S.a, tau: S.tau, steps: S.steps, reads: S.reads || 0, uploads: S.uploads || 0,
                 frames: S.frames || 0, sinceFrameMs: S.lastFrameAt ? Math.round(nowMs() - S.lastFrameAt) : null,
                 drawCount: S.drawCount || 0, projLen: proj ? proj.length : 0, vbo: S.vbo || null,
                 projLenMismatch: S.projLenMismatch || null, frameErrs: S.frameErrs || 0, frameErr: S.frameErr || null,
                 msPerStep: S.msPerStep,
                 drawMs: S.drawMs, fps: S.fps, cam: { dist: +cam.dist.toFixed(3), yaw: +cam.yaw.toFixed(3), pitch: +cam.pitch.toFixed(3) },
                 viewport: [W, H, +dpr.toFixed(2)],
                 gpuFellBack: S.gpuFellBack || null, gpuErrs: S.gpuErrs || null,
                 gpuStepMs: S.gpuStepMs || null, gpuStepMsMax: S.gpuStepMsMax || null, gpuSubmits: S.gpuSubmits || 0,
                 gpuKernelMs: S.gpuKernelMs != null ? +S.gpuKernelMs.toFixed(3) : null, tsOk: !!S.tsOk, nMoves: S.nMoves || 0,
                 waveAxes: S.waveAxes || null, visibleModes: visibleModes(),
                 nFrom: S.nFrom || null, nAdapted: !!S.nAdapted, nShrinks: S.nShrinks || 0,
                 gpuSamples: S.gpuSamples || null, budgetMs: gpuBudgetMs(),
                 firstRead: projStat, now: projScan(), vboNow: (verifyVBO(true), S.vbo) };
      },
      /* 取一张当前画面的 PNG（验收/回归用）。WebGL 上下文没开 preserveDrawingBuffer（那会拖慢每一帧），
         所以这里先当场画一帧，再在同一个任务里读回来——中间没有 present，缓冲还在。 */
      snapshot: function () { try { draw(); return canvas.toDataURL('image/png'); } catch (e) { return null; } },
      resize: function () { resize(); return api; },
      dispose: dispose
    };
    function sameAxes(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
    function yearsPerSecond() {
      // 「实时演化 ≈ X/秒」：按最近的步长与步速估
      if (!S.running) return 0;
      var dtau = gpu ? gpuSuggestDt() : 0.02 / Math.max(K.eOf(cos, S.a), 1e-6);
      // GPU 档是「一帧最多一步」（见 frame()），所以步速就是帧率；CPU 档按 worker 报的每步耗时估
      var stepsPerSec = gpu ? Math.min(S.fps || 30, 60) : (S.msPerStep > 0 ? Math.min(1000 / S.msPerStep, 80) : 5);
      return dtau * stepsPerSec * TH * 1e9;
    }
    // 就绪即开跑（与 universe3d 一致：进太空画面就在演化，时间条上是「▶ 实时演化」）
    function autoStart() { if (!S.disposed) setRunning(true); }
    function setRunning(v) {
      S.running = !!v;
      if (worker) { if (v) worker.postMessage({ type: 'run', targetA: S.targetA }); else worker.postMessage({ type: 'pause' }); }
    }
    function resetGPU() {
      if (!gpu) return;
      var ic = K.makeIC(cfgOf());
      gpu.dev.queue.writeBuffer(gpu.pos, 0, ic.pos);
      gpu.dev.queue.writeBuffer(gpu.vel, 0, ic.vel);
      S.reads = 0; S.lastRead = nowMs();
      gpuKickoff();
    }
    // 「飞到最密处」：在当前投影里找最密的格子，把相机对准它（换轴之后这个点会变，本来就该变）
    function centerOnDensest() {
      if (!proj) return;
      var G = 12, cnt = new Int32Array(G * G * G), i, best = -1, bi = 0;
      for (i = 0; i < S.N; i++) {
        var x = proj[i * 4], y = proj[i * 4 + 1], z = proj[i * 4 + 2];
        if (z > 1e5) continue;
        var gx = clamp(((x + 0.5) * G) | 0, 0, G - 1), gy = clamp(((y + 0.5) * G) | 0, 0, G - 1), gz = clamp(((z + 0.5) * G) | 0, 0, G - 1);
        var id = (gz * G + gy) * G + gx; cnt[id]++;
        if (cnt[id] > best) { best = cnt[id]; bi = id; }
      }
      /* 投影退化（所有粒子挤在同一格）时不要动相机：否则会把视点怼到盒子内部，
         看上去就是「线框撑满整个屏幕」，反而把真正的问题盖住。 */
      if (best >= S.N * 0.9) { status(T('这一帧的投影里所有粒子重合，先不动相机')); return; }
      var gz2 = (bi / (G * G)) | 0, gy2 = ((bi / G) | 0) % G, gx2 = bi % G;
      cam.target = [(gx2 + 0.5) / G - 0.5, (gy2 + 0.5) / G - 0.5, (gz2 + 0.5) / G - 0.5];
      cam.dist = 1.1;
      S.overview = false;
    }

    function dispose() {
      if (S.disposed) return;
      S.disposed = true;
      if (raf) { root.cancelAnimationFrame(raf); raf = 0; }
      for (var i = 0; i < listeners.length; i++) { try { listeners[i][0].removeEventListener(listeners[i][1], listeners[i][2], listeners[i][3]); } catch (e) { /* ignore */ } }
      listeners.length = 0;
      if (worker) { try { worker.postMessage({ type: 'pause' }); worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      destroyGPU();
      if (gl) {
        try {
          gl.deleteBuffer(vbo); gl.deleteBuffer(lineVbo);
          gl.deleteVertexArray(vao); gl.deleteVertexArray(lineVao);
          gl.deleteProgram(prog); gl.deleteProgram(progLine);
          var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
        } catch (e4) { /* ignore */ }
        gl = null;
      }
      wlDispose();
      if (veil) { try { veil.dispose(); } catch (e6) { /* ignore */ } veil = null; }
      if (dimCv && dimCv.parentNode) dimCv.parentNode.removeChild(dimCv);
      dimCv = null; dimCtx = null; dimChaos = null;
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      proj = null; posSnap = null; spdSnap = null;
      try { if (rejectReady && !S.ready) rejectReady(new Error('disposed')); } catch (e5) { /* ignore */ }
    }

    /* ---------- 起步 ---------- */
    try {
      resize();
      initGL();
      buildPanel();
      buildVeil();
    } catch (e) {
      dispose();
      throw e;
    }
    (function boot() {
      if (wantGPU) {
        initGPU().catch(function (err) {
          if (S.disposed) return;
          console.warn('[hyper] WebGPU 档不可用，落回 Worker CPU 档：', err && err.message || err);
          gpu = null;
          try { initCPU(); } catch (e2) { rejectReady(e2); }
        });
      } else {
        try { initCPU(); } catch (e3) { rejectReady(e3); }
      }
    })();
    label();
    resize();
    raf = root.requestAnimationFrame(frame);
    S.targetA = 1;

    return api;
  }

  root.MirrorHyper = {
    VERSION: VERSION, isSupported: isSupported, create: create,
    kernel: K, axisPresets: axisPresets, pickN: pickN,
    WGSL: { accel: WGSL_ACCEL, kick: WGSL_KICK, drift: WGSL_DRIFT, project: WGSL_PROJECT }
  };
})(typeof window !== 'undefined' ? window : this);
