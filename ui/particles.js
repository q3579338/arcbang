/*
 * ui/particles.js —— 粒子物理（Web Worker）+ 粒子渲染（WebGL2 点精灵，Canvas 2D 回退）
 * ------------------------------------------------------------
 * MirrorParticles.tier()/setTier(t)/tierN(t)      粒子数档位：low / mid / high（localStorage）
 * MirrorParticles.createSim(adapter, params, opts) 结构形成模拟：
 *     opts {N, mesh, mode, preSteps, preDt, dimS}
 *     - dimS≠3 时受力换成 D 维核 φ_k ∝ ρ_k·k^{−(4−D)}·exp(−k²ε²)（见 makePM2D）；dimS=3（默认）走原路径
 *     返回 sim：{N, positions, density, a, t, dir, ended, reason, era(), ready, worker(bool), tick(dt), dispose()}
 *     - 引擎在场且能拿到引擎源码（dist 内联 <script id="mirrorEngineSrc"> 或 http 下 fetch）时，物理放进 Worker，
 *       主线程只收 Float32Array（transferable，双缓冲）；否则退回主线程 adapter.createNBody。
 * MirrorParticles.createGL(canvas)                WebGL2 渲染器：{ok, resize(w,h,dpr), clear(), draw(sim, view), dispose()}
 *     view {ox, oy, S, W, H, zoom, skew:[a,b,c,d]|null, size, alpha, mode, heat, time}
 *     mode: 'normal' | 'heat' | 'dark' | 'sterile' | 'alien' | 'starsea'
 */
(function (root) {
  'use strict';

  var LS_TIER = 'mirror.ui.particleTier.v1';
  /* 新增 tiny 档：低配机（没有 WebGPU、CPU 核少）在 low 档也会卡到个位数帧率，
     而 low 已经是原来的地板。tiny 大约是 low 的三分之一负载。 */
  var TIERS = { tiny: 2500, low: 8000, mid: 20000, high: 40000 };
  var TIERS_2D = { tiny: 1200, low: 3000, mid: 5000, high: 8000 };
  var TIER_NAMES = { tiny: '极低', low: '低', mid: '中', high: '高' };
  function safeLS() { try { return root.localStorage; } catch (e) { return null; } }
  // 能力探测：探完立刻把上下文丢掉。每个源的 WebGL 上下文有配额（Chrome ≈16），
  // 这个只用来问一句"支不支持"的上下文如果留着，等于白白占掉一个名额；配额一满浏览器就回收最旧的，
  // 被吞掉的往往正是画面在用的那个（CONTEXT_LOST）。与 universe3d.js 的 isSupported() 同一处理。
  function hasGL2() {
    try {
      var c = document.createElement('canvas'), g = c.getContext('webgl2');
      if (g) { var ext = g.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
      return !!g;
    } catch (e) { return false; }
  }
  var gl2 = hasGL2();
  function defaultTier() {
    var cores = (navigator.hardwareConcurrency || 4);
    var mem = navigator.deviceMemory || 4;
    if (!gl2) return 'tiny';                       // 连 WebGL2 都没有：这台机器什么都跑不动，直接给最低档
    if (cores >= 8 && mem >= 8) return 'high';
    if (cores >= 4) return 'mid';
    if (cores <= 2 || mem <= 2) return 'tiny';
    return 'low';
  }
  function tier() { var ls = safeLS(); var t = ls && ls.getItem(LS_TIER); return TIERS[t] ? t : defaultTier(); }
  function setTier(t) { if (!TIERS[t]) return; var ls = safeLS(); if (ls) try { ls.setItem(LS_TIER, t); } catch (e) { /* ignore */ } }
  function tierN(t, workerOK) { t = t || tier(); return (gl2 && workerOK !== false) ? TIERS[t] : TIERS_2D[t]; }

  /* ---------------------------------------------------------- 引擎源码（给 Worker 用） */
  var engineSrcPromise = null;
  function engineSource() {
    if (engineSrcPromise) return engineSrcPromise;
    engineSrcPromise = new Promise(function (resolve) {
      var el = document.getElementById('mirrorEngineSrc');
      if (el && el.textContent && el.textContent.length > 100) return resolve(el.textContent);
      // 开发模式：http(s) 下从 <script src> 拉取
      if (!/^https?:/.test(location.protocol) || typeof fetch !== 'function') return resolve(null);
      var scripts = Array.prototype.slice.call(document.querySelectorAll('script[src]')).map(function (s) { return s.src; });
      var p = scripts.filter(function (s) { return /params\.js(\?|$)/.test(s); })[0];
      var e = scripts.filter(function (s) { return /engine\.js(\?|$)/.test(s); })[0];
      if (!e) return resolve(null);
      Promise.all([p ? fetch(p).then(function (r) { return r.text(); }) : Promise.resolve(''), fetch(e).then(function (r) { return r.text(); })])
        .then(function (arr) { resolve(arr[0] + '\n;\n' + arr[1]); }, function () { resolve(null); });
    });
    return engineSrcPromise;
  }

  /* ---------------------------------------------------------- D 维引力（2D 回退路径的力学核）
   * 引擎 createNBody 解的是标准 2 维泊松方程（实空间 Jacobi 迭代），与空间维数无关。
   * D≠3 时由本对象接管"力"：2 维嵌入下的傅里叶核
   *     φ_k ∝ ρ_k · k^{−(4−D)} · exp(−k²ε²)          （ε = 1~2 个网格间距的软化长度）
   * 来源与 universe3d.js 的 3 维核 k^{−(5−D)} 相同：D 维引力 F ∝ r^{−(D−1)} → φ ∝ r^{−(D−2)}，
   * 在 d 维嵌入下傅里叶变换给出 k^{−(d−D+2)}（d=3 → 5−D；d=2 → 4−D）。
   * 常数前因子按基频 k_f=2π 归一（"∝"允许），使最大尺度的力与标准 2 维泊松一致，D 只改变小尺度相对强度。
   * 背景膨胀 / 结局判定仍全部来自引擎的 nb（a、H、gravityCoupling、ended、era 都取自它），这里只换受力；
   * D=3 时根本不创建本对象，旧路径逐位不变。
   */
  function makePM2D(nb, dimS, meshWanted) {
    var M = 8; while (M < (meshWanted || 64)) M <<= 1;      // FFT 要 2 的幂
    if (M > 128) M = 128;
    var M2 = M * M, N = nb.N, PI2 = Math.PI * 2;
    var PEXP = 4 - dimS;                                     // φ_k ∝ k^{−(4−D)}
    var SOFT = 1 + Math.min(1, Math.abs(dimS - 3) * 0.5);    // 软化长度 ε：1~2 个网格间距
    var px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
    px.set(nb.px.subarray(0, N)); py.set(nb.py.subarray(0, N)); vx.set(nb.vx.subarray(0, N)); vy.set(nb.vy.subarray(0, N));
    var positions = new Float32Array(2 * N);
    var re = new Float32Array(M2), im = new Float32Array(M2), rho = new Float32Array(M2), fx = new Float32Array(M2), fy = new Float32Array(M2);
    var tre = new Float64Array(M), tim = new Float64Array(M), green = null, accMax = 0;
    var bits = Math.round(Math.log(M) / Math.LN2);
    var rev = new Uint16Array(M);
    for (var r0 = 0; r0 < M; r0++) { var xr = r0, yr = 0; for (var b0 = 0; b0 < bits; b0++) { yr = (yr << 1) | (xr & 1); xr >>= 1; } rev[r0] = yr; }
    function fft1(sign) {                                    // 就地基 2 FFT（tre/tim，长度 M）
      var i, j, t;
      for (i = 0; i < M; i++) { j = rev[i]; if (j > i) { t = tre[i]; tre[i] = tre[j]; tre[j] = t; t = tim[i]; tim[i] = tim[j]; tim[j] = t; } }
      for (var len = 2; len <= M; len <<= 1) {
        var half = len >> 1, ang = sign * PI2 / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (i = 0; i < M; i += len) {
          var cr = 1, ci = 0;
          for (j = 0; j < half; j++) {
            var i0 = i + j, i1 = i0 + half;
            var ar = tre[i1] * cr - tim[i1] * ci, ai = tre[i1] * ci + tim[i1] * cr;
            tre[i1] = tre[i0] - ar; tim[i1] = tim[i0] - ai; tre[i0] += ar; tim[i0] += ai;
            var nc = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nc;
          }
        }
      }
    }
    function fft2(sign) {
      var x, y, b;
      for (y = 0; y < M; y++) { b = y * M; for (x = 0; x < M; x++) { tre[x] = re[b + x]; tim[x] = im[b + x]; } fft1(sign); for (x = 0; x < M; x++) { re[b + x] = tre[x]; im[b + x] = tim[x]; } }
      for (x = 0; x < M; x++) { for (y = 0; y < M; y++) { tre[y] = re[y * M + x]; tim[y] = im[y * M + x]; } fft1(sign); for (y = 0; y < M; y++) { re[y * M + x] = tre[y]; im[y * M + x] = tim[y]; } }
    }
    function greenTab() {
      if (green) return green;
      green = new Float64Array(M2);
      var half = M >> 1, kf2 = PI2 * PI2, eps = SOFT / M, eps2 = eps * eps, norm = 1 / M2, idx = 0;
      function sinc(v) { return v === 0 ? 1 : Math.sin(v) / v; }
      for (var y = 0; y < M; y++) {
        var ny = y > half ? y - M : y, wy = sinc(Math.PI * ny / M);
        for (var x = 0; x < M; x++, idx++) {
          var nx = x > half ? x - M : x, n2 = nx * nx + ny * ny;
          if (!n2) { green[idx] = 0; continue; }
          var k2 = kf2 * n2, w = sinc(Math.PI * nx / M) * wy; w = w * w;   // 反卷积一次 CIC 窗
          green[idx] = -norm * Math.pow(n2, -PEXP / 2) / kf2 * Math.exp(-k2 * eps2) / Math.max(w, 0.15);
        }
      }
      return green;
    }
    function deposit() {
      var i, mean = N / M2;
      for (i = 0; i < M2; i++) rho[i] = 0;
      for (i = 0; i < N; i++) {
        var gx = px[i] * M, gy = py[i] * M, x0 = gx | 0, y0 = gy | 0;
        if (x0 >= M) x0 = M - 1; if (y0 >= M) y0 = M - 1;
        var tx = gx - x0, ty = gy - y0, x1 = x0 + 1 === M ? 0 : x0 + 1, y1 = y0 + 1 === M ? 0 : y0 + 1;
        rho[y0 * M + x0] += (1 - tx) * (1 - ty); rho[y0 * M + x1] += tx * (1 - ty);
        rho[y1 * M + x0] += (1 - tx) * ty; rho[y1 * M + x1] += tx * ty;
      }
      for (i = 0; i < M2; i++) { rho[i] = rho[i] / mean - 1; re[i] = rho[i]; im[i] = 0; }
    }
    function gravity() {
      deposit();
      fft2(-1);
      var G = greenTab(), i;
      for (i = 0; i < M2; i++) { re[i] *= G[i]; im[i] *= G[i]; }
      fft2(+1);                                            // re = φ（green 里已含 1/M²）
      for (var y = 0; y < M; y++) {
        var ym = ((y + M - 1) % M) * M, yp = ((y + 1) % M) * M, yy = y * M;
        for (var x = 0; x < M; x++) {
          var xm = (x + M - 1) % M, xp = (x + 1) % M;
          fx[yy + x] = -(re[yy + xp] - re[yy + xm]) * M * 0.5;
          fy[yy + x] = -(re[yp + x] - re[ym + x]) * M * 0.5;
        }
      }
    }
    function wrap(v) { return v - Math.floor(v); }
    function sync() {
      for (var i = 0; i < N; i++) { positions[2 * i] = px[i]; positions[2 * i + 1] = py[i]; }
      self.a = nb.a; self.t = nb.t; self.tGyr = nb.tGyr; self.dir = nb.dir; self.H = nb.H;
      self.ended = nb.ended; self.endReason = nb.endReason; self.reason = nb.reason;
    }
    var self = {
      N: N, mesh: M, px: px, py: py, vx: vx, vy: vy, positions: positions, density: rho, dimS: dimS, softenCells: SOFT,
      a: nb.a, t: nb.t, tGyr: nb.tGyr, H: nb.H, dir: nb.dir, ended: nb.ended, endReason: nb.endReason, reason: nb.reason,
      era: function () { return nb.era ? nb.era() : ''; },
      maxAccel: function () { return accMax; },
      // 自适应步长：Δx ≈ accel·dt² 不超过 1/4 个网格
      suggestDt: function () {
        var d = nb.suggestDt ? nb.suggestDt() : 0.0006 * (1 + nb.a * 0.6);
        if (accMax > 0) d = Math.min(d, Math.sqrt(0.25 / (M * accMax)));
        return Math.max(1e-7, d);
      },
      step: function (dt) {
        if (nb.ended) { sync(); return self; }
        nb.step(dt);                                        // 背景膨胀 + 结局判定（引擎的粒子结果这里不用）
        var H = nb.H, gs = nb.gravityCoupling, fMax = 0;     // 二者对应本步的旧 a（引擎在 step 内先算力再更新 a）
        gravity();
        for (var i = 0; i < N; i++) {
          var gx = px[i] * M, gy = py[i] * M, x0 = gx | 0, y0 = gy | 0;
          if (x0 >= M) x0 = M - 1; if (y0 >= M) y0 = M - 1;
          var tx = gx - x0, ty = gy - y0, x1 = x0 + 1 === M ? 0 : x0 + 1, y1 = y0 + 1 === M ? 0 : y0 + 1;
          var w0 = (1 - tx) * (1 - ty), w1 = tx * (1 - ty), w2 = (1 - tx) * ty, w3 = tx * ty;
          var i0 = y0 * M + x0, i1 = y0 * M + x1, i2 = y1 * M + x0, i3 = y1 * M + x1;
          var ax = fx[i0] * w0 + fx[i1] * w1 + fx[i2] * w2 + fx[i3] * w3;
          var ay = fy[i0] * w0 + fy[i1] * w1 + fy[i2] * w2 + fy[i3] * w3;
          var af = Math.abs(ax) + Math.abs(ay); if (af > fMax) fMax = af;
          vx[i] += (ax * gs - 2 * H * vx[i]) * dt; vy[i] += (ay * gs - 2 * H * vy[i]) * dt;
          var sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]); if (sp > 4) { vx[i] *= 4 / sp; vy[i] *= 4 / sp; }
          px[i] = wrap(px[i] + vx[i] * dt); py[i] = wrap(py[i] + vy[i] * dt);
        }
        accMax = gs * fMax;
        sync();
        return self;
      }
    };
    gravity();                                              // 初始力（让第一帧的 suggestDt 就是收敛的）
    sync();
    return self;
  }

  /* Worker 主体（以 toString 方式打包成 Blob） */
  function workerMain() {
    var nb = null, M = 56, N = 0;
    function fill(pos, dens) {
      var P = nb.positions, px = nb.px, py = nb.py, grid = nb.density;
      if (px && py) { for (var i = 0; i < N; i++) { pos[2 * i] = px[i]; pos[2 * i + 1] = py[i]; } }
      else pos.set(P.subarray(0, 2 * N));
      if (grid && grid.length === M * M) for (i = 0; i < N; i++) dens[i] = grid[((pos[2 * i + 1] * M) | 0) * M + ((pos[2 * i] * M) | 0)];
    }
    function state(pos, dens) {
      return { type: 'state', pos: pos, dens: dens, a: nb.a, t: nb.t, dir: nb.dir == null ? 1 : nb.dir, ended: !!nb.ended, reason: nb.endReason || nb.reason || null, era: typeof nb.era === 'function' ? nb.era() : '' };
    }
    self.onmessage = function (ev) {
      var m = ev.data;
      try {
        if (m.type === 'init') {
          if (m.engineURL) importScripts(m.engineURL);
          var E = self.MirrorEngine;
          if (!E) throw new Error('worker: MirrorEngine 不可用');
          M = m.mesh || 56; N = m.N;
          nb = E.createNBody(m.params, { N: N, mesh: M, mode: m.mode });
          N = nb.N;
          // D≠3：把受力换成 D 维核（k^{−(4−D)}），背景仍由引擎的 nb 驱动；D=3 完全不碰旧路径
          var D2 = (m.dimS != null && isFinite(m.dimS)) ? +m.dimS : 3;
          if (Math.abs(D2 - 3) > 1e-9 && typeof makePM2D === 'function') { nb = makePM2D(nb, D2, M); M = nb.mesh; }
          for (var i = 0; i < (m.preSteps || 0) && !nb.ended; i++) nb.step(typeof nb.suggestDt === 'function' ? nb.suggestDt() : (m.preDt || 0.0007) * (1 + nb.a * 0.6));
          var pos = new Float32Array(2 * N), dens = new Float32Array(N);
          fill(pos, dens);
          var st = state(pos, dens); st.N = N; st.type = 'ready';
          self.postMessage(st, [pos.buffer, dens.buffer]);
        } else if (m.type === 'step') {
          for (var k = 0; k < (m.count || 1) && !nb.ended; k++) nb.step((m.dt == null && typeof nb.suggestDt === 'function') ? nb.suggestDt() : (m.dt == null ? 0.0006 * (1 + nb.a * 0.6) : m.dt));
          var p2 = new Float32Array(m.pos), d2 = new Float32Array(m.dens);
          fill(p2, d2);
          self.postMessage(state(p2, d2), [p2.buffer, d2.buffer]);
        }
      } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
    };
  }
  var workerURL = null;
  function getWorkerURL() {
    if (workerURL) return workerURL;
    var src = makePM2D.toString() + ';(' + workerMain.toString() + ')();';
    workerURL = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    return workerURL;
  }
  var engineURLCache = null;

  /* ---------------------------------------------------------- 模拟（Worker 优先） */
  function createSim(adapter, params, opts) {
    opts = opts || {};
    var wantN = opts.N || tierN();
    var mesh = opts.mesh || (wantN > 15000 ? 64 : 56);
    var sim = {
      N: 0, positions: null, density: null, a: 0.02, t: 0, dir: 1, ended: false, reason: null, eraName: '',
      ready: false, worker: false, disposed: false, pending: false, error: null,
      era: function () { return sim.eraName; },
      tick: function () {}, dispose: function () { sim.disposed = true; }
    };
    var canWorker = adapter.isReal && typeof Worker !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL;
    var dimS = (opts.dimS != null && isFinite(opts.dimS)) ? +opts.dimS : 3;
    var dimGrav = Math.abs(dimS - 3) > 1e-9;
    function fallbackMain() {
      if (sim.disposed) return;                  // dispose 之后 Worker 的异步回调才到：不要再造一个没人管的实例
      var n = Math.min(wantN, 8000);
      var nb = adapter.createNBody(params, { N: n, mesh: 56, mode: opts.mode });
      if (dimGrav) nb = makePM2D(nb, dimS, 56);   // D≠3：受力换成 D 维核
      for (var i = 0; i < (opts.preSteps || 0) && !nb.ended; i++) nb.step(nb.suggestDt ? nb.suggestDt() : (opts.preDt || 0.0007) * (1 + nb.a * 0.6));
      /* 每粒子密度：nb.density（引擎的 createNBody 与 makePM2D 都一样）是 M×M 的**网格**数组，
       * 而渲染层要的是长度 N 的**每粒子**数组——WebGL 那边 bufferSubData(…, D, 0, n) 按 n 个 float 读，
       * Canvas2D 那边按 D[i]（i<N）读。两者长度对不上（mesh 56 → 3136，粒子可到 7921）：
       * WebGL 抛 INVALID_VALUE 整个粒子层不画，Canvas2D 读越界拿到 undefined → 颜色算成 NaN。
       * 所以这里每步把网格重采样成 Float32Array(N)，与 Worker 里的 fill() 完全同一套做法。 */
      var dens = new Float32Array(nb.N), meshM = nb.mesh || 56;
      function resample() {
        var grid = nb.density, P = nb.positions, NN = nb.N, M = meshM, M2 = M * M, i;
        if (!grid || !P) return;
        if (grid.length !== M2) {                                  // 不是网格：已是每粒子数组就直接用，否则给 0
          if (grid.length >= NN) { for (i = 0; i < NN; i++) dens[i] = grid[i]; }
          else { for (i = 0; i < NN; i++) dens[i] = 0; }
          return;
        }
        for (i = 0; i < NN; i++) {
          var gx = (P[2 * i] * M) | 0, gy = (P[2 * i + 1] * M) | 0;
          if (gx >= M) gx = M - 1; else if (gx < 0) gx = 0;         // 位置是 [0,1)，但浮点下 1-ε 可能舍成 1.0
          if (gy >= M) gy = M - 1; else if (gy < 0) gy = 0;
          dens[i] = grid[gy * M + gx];
        }
      }
      resample();
      sim.N = nb.N; sim.positions = nb.positions; sim.density = dens; sim.a = nb.a; sim.t = nb.t; sim.dir = nb.dir; sim.ended = nb.ended; sim.reason = nb.reason; sim.eraName = nb.era ? nb.era() : '';
      sim.ready = true; sim.worker = false;
      sim.tick = function (dt) { if (sim.disposed || nb.ended) { sim.ended = nb.ended; sim.reason = nb.reason; return; } nb.step(dt == null ? (nb.suggestDt ? nb.suggestDt() : 0.0006 * (1 + nb.a * 0.6)) : dt); resample(); sim.a = nb.a; sim.t = nb.t; sim.dir = nb.dir; sim.ended = nb.ended; sim.reason = nb.reason; sim.eraName = nb.era ? nb.era() : ''; };
      sim.dispose = function () { sim.disposed = true; nb = null; };
      if (opts.onReady) opts.onReady(sim);
    }
    if (!canWorker) { fallbackMain(); return sim; }
    engineSource().then(function (src) {
      if (sim.disposed) return;
      if (!src) { fallbackMain(); return; }
      if (!engineURLCache) engineURLCache = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      var w;
      try { w = new Worker(getWorkerURL()); } catch (e) { console.warn('[particles] Worker 创建失败，回退主线程：', e); fallbackMain(); return; }
      var display = null, free = [], fellBack = false;
      // dispose 之后 Worker 还可能再发一两条消息（terminate 前已在途的），一律忽略：
      // 否则会在已废弃的 sim 上跑 fallbackMain、把 sim.dispose 换成新的，留下一个没人 dispose 的 nb。
      w.onerror = function (e) {
        if (sim.disposed) return;
        console.warn('[particles] worker error，回退主线程：', e.message || e);
        if (!fellBack && !sim.ready) { fellBack = true; try { w.terminate(); } catch (x) { /* ignore */ } fallbackMain(); }
      };
      w.onmessage = function (ev) {
        if (sim.disposed) return;
        var m = ev.data;
        if (m.type === 'error') { console.warn('[particles] worker:', m.message); if (!sim.ready && !fellBack) { fellBack = true; try { w.terminate(); } catch (x) { /* ignore */ } fallbackMain(); } return; }
        if (m.type === 'ready') { sim.N = m.N; free.push({ pos: new Float32Array(2 * m.N), dens: new Float32Array(m.N) }); }
        else if (display) free.push(display);      // 旧的显示缓冲回收为可写缓冲（双缓冲）
        display = { pos: m.pos, dens: m.dens };
        sim.positions = m.pos; sim.density = m.dens; sim.a = m.a; sim.t = m.t; sim.dir = m.dir; sim.ended = m.ended; sim.reason = m.reason; sim.eraName = m.era || '';
        sim.pending = false;
        if (m.type === 'ready') { sim.ready = true; sim.worker = true; if (opts.onReady) opts.onReady(sim); }
      };
      sim.tick = function (dt) {
        if (sim.disposed || !sim.ready || sim.pending || sim.ended || !free.length) return;
        var b = free.pop();
        sim.pending = true;
        w.postMessage({ type: 'step', dt: dt, count: 1, pos: b.pos.buffer, dens: b.dens.buffer }, [b.pos.buffer, b.dens.buffer]);
      };
      sim.dispose = function () {
        sim.disposed = true;
        w.onmessage = null; w.onerror = null;    // 先摘处理器再 terminate：在途消息不会再回到已废弃的 sim
        try { w.terminate(); } catch (e) { /* ignore */ }
        display = null; free = [];
      };
      w.postMessage({ type: 'init', engineURL: engineURLCache, params: params, N: wantN, mesh: mesh, mode: opts.mode, preSteps: opts.preSteps || 0, preDt: opts.preDt || 0.0007, dimS: dimS });
    });
    return sim;
  }

  /* ---------------------------------------------------------- WebGL2 渲染器 */
  var VS = '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 a_pos; in float a_dens;\n' +
    'uniform mat3 u_m; uniform float u_size; uniform float u_heat; uniform float u_alpha; uniform int u_mode; uniform float u_time; uniform int u_tiles;\n' +
    'out vec4 v_col;\n' +
    'vec3 hsv(float h, float s, float v){ vec3 k = vec3(1.0, 2.0/3.0, 1.0/3.0); vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0); return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s); }\n' +
    'void main(){\n' +
    // 周期盒 3×3 平铺（实例 0..8 → 偏移 -1/0/+1），让宇宙网铺满整个屏幕而不是框在中间的正方形里
    '  vec2 off = (u_tiles > 1) ? vec2(float(gl_InstanceID % 3) - 1.0, float(gl_InstanceID / 3) - 1.0) : vec2(0.0);\n' +
    '  vec3 p = u_m * vec3(a_pos + off, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0);\n' +
    '  float d = a_dens; vec3 c; float al;\n' +
    // 团块处按密度衰减 alpha，避免叠加过曝成一坨白
    '  if (d > 4.0) { c = vec3(1.0, 0.93, 0.80); al = 0.55 / (1.0 + (d - 4.0) * 0.08); }\n' +
    '  else if (d > 1.0) { c = vec3(min(1.0, (120.0 + d * 30.0) / 255.0), 0.78, 1.0); al = 0.42; }\n' +
    '  else { c = mix(vec3(0.35, 0.27, 0.51), vec3(1.0, 0.47, 0.18), u_heat); al = 0.26; }\n' +
    '  if (u_mode == 1) { c = vec3(0.43, 0.39, 0.47); al = 0.28; }\n' +
    '  else if (u_mode == 2) { c = min(c, vec3(0.35, 0.31, 0.43)); al *= 0.6; }\n' +
    '  else if (u_mode == 3) { al *= 0.7; }\n' +
    '  else if (u_mode == 4) { c = hsv(fract((d * 40.0 + u_time * 20.0) / 360.0), 0.9, 0.7); al *= 0.8; }\n' +
    '  else if (u_mode == 5) { al *= 0.55; }\n' +
    '  v_col = vec4(c, al * u_alpha);\n' +
    '  gl_PointSize = u_size * (d > 4.0 ? 1.15 : 1.0);\n' +
    '}\n';
  var FS = '#version 300 es\n' +
    'precision mediump float;\n' +
    'in vec4 v_col; out vec4 o;\n' +
    'void main(){ vec2 q = gl_PointCoord - 0.5; float r2 = dot(q, q) * 4.0; if (r2 > 1.0) discard; float g = exp(-r2 * 3.0); o = vec4(v_col.rgb * v_col.a * g, v_col.a * g); }\n';

  function createGL(canvas) {
    var gl = null;
    try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
    if (!gl) return { ok: false };
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[gl] shader:', gl.getShaderInfoLog(s)); return null; } return s; }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return { ok: false };
    var prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[gl] link:', gl.getProgramInfoLog(prog)); return { ok: false }; }
    var loc = { pos: gl.getAttribLocation(prog, 'a_pos'), dens: gl.getAttribLocation(prog, 'a_dens'), m: gl.getUniformLocation(prog, 'u_m'), size: gl.getUniformLocation(prog, 'u_size'), heat: gl.getUniformLocation(prog, 'u_heat'), alpha: gl.getUniformLocation(prog, 'u_alpha'), mode: gl.getUniformLocation(prog, 'u_mode'), time: gl.getUniformLocation(prog, 'u_time'), tiles: gl.getUniformLocation(prog, 'u_tiles') };
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    var bPos = gl.createBuffer(), bDens = gl.createBuffer(), capN = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bDens); gl.enableVertexAttribArray(loc.dens); gl.vertexAttribPointer(loc.dens, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    var MODES = { normal: 0, heat: 1, dark: 2, sterile: 3, alien: 4, starsea: 5 };
    var W = 1, H = 1, dpr = 1;
    var api = {
      ok: true, gl: gl,
      resize: function (w, h, d) { W = w; H = h; dpr = d; canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); gl.viewport(0, 0, canvas.width, canvas.height); },
      clear: function (r, g, b) { gl.clearColor(r || 0, g || 0, b || 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
      draw: function (sim, v) {
        var P = sim.positions, D = sim.density, n = sim.N;
        if (!P || !n) return;
        if (P.length < 2 * n) return;                          // 位置数组短于 N：宁可不画，也不让 GL 报 INVALID_VALUE
        if (D && D.length < n) D = null;                       // 密度必须是每粒子数组；短了（例如误传成网格）就当没有
        gl.useProgram(prog); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
        if (n > capN) { gl.bufferData(gl.ARRAY_BUFFER, P, gl.DYNAMIC_DRAW); } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, P, 0, 2 * n);
        gl.bindBuffer(gl.ARRAY_BUFFER, bDens);
        if (n > capN) { gl.bufferData(gl.ARRAY_BUFFER, D || new Float32Array(n), gl.DYNAMIC_DRAW); capN = n; } else if (D) gl.bufferSubData(gl.ARRAY_BUFFER, 0, D, 0, n);
        // 变换：[0,1]² → 像素盒 → 以屏幕中心缩放/斜切 → clip
        var ox = v.ox, oy = v.oy, S = v.S, z = v.zoom || 1, cx = W / 2, cy = H / 2;
        var sk = v.skew || [1, 0, 0, 1];   // [a,b,c,d]: x' = a x + c y, y' = b x + d y（绕中心）
        // 像素坐标 px = ox + S*x, py = oy + S*y；然后 p' = center + z*Sk*(p - center)
        // 组合成 3x3（列主序给 GL）
        var A = z * sk[0], B = z * sk[1], C = z * sk[2], Dd = z * sk[3];
        var m00 = A * S, m01 = C * S, m02 = A * (ox - cx) + C * (oy - cy) + cx;
        var m10 = B * S, m11 = Dd * S, m12 = B * (ox - cx) + Dd * (oy - cy) + cy;
        // 像素 → clip: cx' = px*2/W - 1; cy' = 1 - py*2/H
        var c00 = 2 / W, c11 = -2 / H;
        var mat = new Float32Array([
          c00 * m00, c11 * m10, 0,
          c00 * m01, c11 * m11, 0,
          c00 * m02 - 1, c11 * m12 + 1, 1
        ]);
        gl.uniformMatrix3fv(loc.m, false, mat);
        gl.uniform1f(loc.size, (v.size || 2.6) * dpr * z);
        gl.uniform1f(loc.heat, v.heat || 0);
        gl.uniform1f(loc.alpha, v.alpha == null ? 1 : v.alpha);
        gl.uniform1i(loc.mode, MODES[v.mode] || 0);
        gl.uniform1f(loc.time, v.time || 0);
        var tiles = v.tile === false ? 1 : 9;   // 默认 3×3 平铺周期盒铺满屏幕
        gl.uniform1i(loc.tiles, tiles);
        if (tiles > 1) gl.drawArraysInstanced(gl.POINTS, 0, n, tiles); else gl.drawArrays(gl.POINTS, 0, n);
        gl.bindVertexArray(null);
      },
      dispose: function () { try { gl.deleteBuffer(bPos); gl.deleteBuffer(bDens); gl.deleteProgram(prog); } catch (e) { /* ignore */ } }
    };
    return api;
  }

  root.MirrorParticles = { TIERS: TIERS, TIER_NAMES: TIER_NAMES, hasGL2: gl2, tier: tier, setTier: setTier, tierN: tierN, defaultTier: defaultTier, createSim: createSim, createGL: createGL, engineSource: engineSource, makePM2D: makePM2D };
})(typeof window !== 'undefined' ? window : this);
