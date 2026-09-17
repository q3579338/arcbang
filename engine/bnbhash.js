/*
 * 镜像宇宙模拟器 · BNB 区块哈希 → 创世参数（确定性派生）
 * ------------------------------------------------------------
 * 一个哈希唯一确定一组参数：同一个 blockHash，在浏览器、Node、Solidity 里
 * 算出的 u 向量逐位一致（全程整数 keccak256 + 取模，不含浮点）。
 *
 * 派生链：
 *   u_i  = uint256(keccak256(blockHash ‖ uint8(i)))  mod 1e9        // i = 0..19，链上链下同式
 *   tier = uint256(keccak256(blockHash ‖ uint8(255))) mod 1000      // 扰动档位，决定偏离我们宇宙多远
 *   参数 = fromUnit(key, clamp(toUnit(key, 默认值) + strength·(2u_i−1)))
 *
 * 为什么不直接把 u 均匀铺满参数全程：那样几乎每个宇宙都在第一秒死掉，
 * 稀有度就没有梯度了。这里按档位给扰动幅度，档位本身由哈希决定（见 TIERS）。
 *
 * 参数表固定为 20 个基础参数（modules 全关），保证"哈希 → 参数"是稳定映射，
 * 不随模块开关漂移。
 *
 * API：keccak256(bytesOrHex) → hex   derive(hashHex) → {hash, tier, u, uInt, params, modules}
 *      TIERS  U_DEN  PARAM_KEYS  selfTest()
 *
 * UMD：Node 下 module.exports = MirrorBnbHash；浏览器下 window.MirrorBnbHash。
 * 无外部依赖（keccak256 在本文件内用 BigInt 实现，浏览器与 Node 都没有原生 keccak）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./params.js'));
  else root.MirrorBnbHash = factory(root.MirrorParams);
})(typeof self !== 'undefined' ? self : this, function (Params) {
  'use strict';

  /* ============================================================ keccak-f[1600] */
  var MASK = (1n << 64n) - 1n;
  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  // 旋转量 r[x + 5y]
  var ROT = [
    0n, 1n, 62n, 28n, 27n,
    36n, 44n, 6n, 55n, 20n,
    3n, 10n, 43n, 25n, 39n,
    41n, 45n, 15n, 21n, 8n,
    18n, 2n, 61n, 56n, 14n
  ];
  function rotl(v, n) { return n === 0n ? v : (((v << n) | (v >> (64n - n))) & MASK); }

  function keccakF(A) {
    var C = new Array(5), D = new Array(5), B = new Array(25), x, y, i;
    for (i = 0; i < 24; i++) {
      // θ
      for (x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
      for (x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) A[x + 5 * y] ^= D[x];
      // ρ + π
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
      // χ
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
      }
      // ι
      A[0] ^= RC[i];
    }
    return A;
  }

  /** 输入 Uint8Array / 十六进制串（可带 0x）；输出 32 字节 Uint8Array */
  function keccak256Bytes(input) {
    var msg = toBytes(input);
    var RATE = 136;                                  // 1600/8 − 2·256/8
    var padLen = RATE - (msg.length % RATE);
    var block = new Uint8Array(msg.length + padLen);
    block.set(msg);
    block[msg.length] |= 0x01;                       // keccak 原始填充（SHA3 是 0x06，别混）
    block[block.length - 1] |= 0x80;

    var A = new Array(25).fill(0n), off, j, k, lane;
    for (off = 0; off < block.length; off += RATE) {
      for (j = 0; j < RATE / 8; j++) {
        lane = 0n;
        for (k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(block[off + j * 8 + k]);   // 小端
        A[j] ^= lane;
      }
      keccakF(A);
    }
    var out = new Uint8Array(32);
    for (j = 0; j < 4; j++) { lane = A[j]; for (k = 0; k < 8; k++) { out[j * 8 + k] = Number(lane & 0xffn); lane >>= 8n; } }
    return out;
  }
  function keccak256(input) { return '0x' + hex(keccak256Bytes(input)); }

  /* ============================================================ 字节工具 */
  function hex(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }
  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (Array.isArray(x)) return new Uint8Array(x);
    var s = String(x);
    if (/^0x/i.test(s)) {
      s = s.slice(2);
      if (s.length % 2) s = '0' + s;
      if (!/^[0-9a-f]*$/i.test(s)) throw new Error('不是合法的十六进制串');
      var b = new Uint8Array(s.length / 2), i;
      for (i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
      return b;
    }
    // 普通字符串按 UTF-8
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, 'utf8'));
  }
  function toBigInt(bytes) { var v = 0n, i; for (i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]); return v; }

  /** 归一化 32 字节区块哈希；不合法则抛错（区块哈希必须是 32 字节） */
  function normHash(h) {
    var s = String(h || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(s)) throw new Error('区块哈希必须是 0x 开头的 64 位十六进制（32 字节）');
    return '0x' + s.slice(2).toLowerCase();
  }

  /* ============================================================ 派生 */
  var U_DEN = 1000000000;      // u = n / 1e9：30 位以内，double 精确表示，链上链下同值
  /* 弦气模块**开着**（引擎里它本来就默认开）。这一条是这套派生的地基：
     空间维数 D 不是第 20 个输入，而是由 Brandenberger–Vafa 弦气模型从三个更底层的量推出来的
     —— 初始弦气温度 T₀/T_H、缠绕模初始密度 n_w、紧致化刚度 κ。
     以前为了"映射稳定"把模块全关，D 退化成普通输入，连续扰动又会让每个宇宙都掉进
     "超出模型范围"，于是只好再补一颗骰子去救。那是拿工程便利覆盖物理：
     骰子给出 96.5% 的三维，而弦气模型自己算出来只有 3.3%——**三维本来就是稀罕物**。
     现在回到模型：三个弦气参数铺满全量程（与引擎自己的蒙特卡洛同口径），D 由它们决定。 */
  var MODULES_ON = { stringGas: true, slowRoll: false, landscape: false, altBiochem: false };
  var MODULES_OFF = MODULES_ON;                    // 兼容旧名字：外部还有几处在读它
  var PARAM_SPECS = Params.paramsFor(MODULES_ON);  // 22 个：19 个基础 + 3 个弦气（dimS 被派生掉了）
  var PARAM_KEYS = PARAM_SPECS.map(function (d) { return d.key; });
  /* 哈希槽位表 —— **不包含 gNewton**。
     gNewton 是后加的引力自由度；如果让它挤进这个循环，它后面每个参数的槽位都会挪一格，
     等于所有已经引爆过的宇宙全部改值。它改从专用槽（SLOT_G）派生，
     于是 alpha…compactStiffness 这 22 个的取值与 v1 逐位相同，
     已有的档位/结局/救活率标定继续有效。 */
  var HASH_KEYS = PARAM_KEYS.filter(function (k) { return k !== 'gNewton'; });
  var SPEC_BY_KEY = {};
  PARAM_SPECS.forEach(function (d) { SPEC_BY_KEY[d.key] = d; });
  // 弦气三参数不走"围绕我们宇宙扰动"那条路——它们铺满全量程，维数才可能真的解开成别的数
  var STRING_GAS = { stringGasT: 1, windingDensity: 1, compactStiffness: 1 };

  /* ---------------- G / c / h / e 四个常数（v2）----------------
     原著（《镜子》第八、十五章）是把 G、c、h、e 四个并列报出来的，
     所以四个都得真的变。原来做不到，是因为引擎只有两个无量纲输入：
     α 和 α_G —— 四个有量纲的数从两个无量纲量里生不出来，缺两个自由度。

     现在补齐：α 照旧从 slot(0) 抽（分布**一字不改**，所以旧标定全部有效），
     引力倍率从 SLOT_G 抽，另外两个"参照系自由度"从 SLOT_F1/F2 抽。四个比值由下式定：

         ħ_r = exp(σ·(2f₁−1))          ← 参照系自由度
         c_r = exp(σ·(2f₂−1))          ← 参照系自由度
         e_r = √(α_r · ħ_r · c_r)      ← 反解，保证 α = e²/(4πε₀ħc) 不变
         G_r = g_r · ħ_r · c_r         ← 反解，保证 α_G = G m_p²/(ħc) 等于引擎那个值

     四个数因此**各不相同且都随哈希变化**，同时物理内容仍然只有 α 和 α_G 两个
     —— 多出来的 ħ_r、c_r 两个自由度正是"宇宙内部的观察者测不出来的那部分"。
     这一点必须在 UI 里写明，不能暗示"光速真的变了"是可观测事实。 */
  var SLOT_G = 200, SLOT_F1 = 201, SLOT_F2 = 202;   // 0..22 归参数，255 归档位，254 已废弃
  var FRAME_SIGMA = 0.30;                            // 参照系自由度的 ln 幅度，再乘档位 scale
  var ALPHA0 = 1 / 137.035999084;                    // 与 engine.js 同值

  /* 每个参数的「生存半径」：其余 19 个按我们宇宙不动，只推这一个，
     结局还能保持 OBSERVERS_POSSIBLE 的最远 unit 距离 [向下, 向上]。
     由 tools/bnb-radius.js 扫描生成（EPS=2e-5），改引擎后请重跑并粘回。
     扰动以半径为单位下发：不这样的话，像 αₛ（指数敏感）和 D（一动就出模型）
     这种参数会让每个样本都死在同一个原因上，稀有度就没有梯度了。 */
  var RADIUS = {
    alpha: [0.00424, 0.00413],
    alphaSMZ: [0.00065, 0.000643],
    higgsVev: [0.5, 0.119],
    higgsMass: [0.549, 0.451],
    electronMass: [0.502, 0.101],
    mUp: [0.00221, 0.00222],
    mDown: [0.00221, 0.00222],
    thetaQCD: [0, 1],
    sumNu: [0.012, 0.286],
    ckmPhase: [0.365, 0.619],
    generations: [0.1, 0.6],
    H0: [0.263, 0.737],
    omegaBh2: [0.0447, 0.955],
    omegaCh2: [0.0161, 0.976],
    omegaLambda: [0.0000671, 0.00198],
    As: [0.109, 0.386],
    ns: [0.412, 0.588],
    omegaK: [0.384, 0.5],
    tcmb: [0.0754, 0.0304],
    /* gNewton 实测（扫描法，其余参数取我们宇宙的默认值）：
       向上 12.5 倍 α_G 就烧穿恒星窗口；向下一直到量程底 1e-4 仍保持 OBSERVERS_POSSIBLE
       —— 引力弱只是让恒星更大更慢，引力强则直接烧完，这个不对称是物理的。
       量程 [1e-4, 1e4] 取对数后：unit(1)=0.5，unit(12.5)=0.637 → 上 0.137；下取满 0.5。 */
    gNewton: [0.5, 0.137],
    // dimS 不在表里：它已经不是输入，由弦气模型派生
  };

  /* 扰动档位：越离谱越稀有。p 是命中概率（千分位区间），
     scale 是「几倍生存半径」——1.0 就是推到该参数单独变化时刚好活不下去的边界。
     full=true 不再围绕我们宇宙扰动，把 u 直接铺满参数全程（几乎必死，但那正是它稀有的原因）。
     dimP 是该档位下 D≠3 的概率（千分位）。 */
  var TIERS = [
    { id: 'whisper', name: '微澜', from: 0, to: 500, p: 0.500, scale: 0.15, dimP: 5 },
    { id: 'drift', name: '偏航', from: 500, to: 800, p: 0.300, scale: 0.50, dimP: 20 },
    { id: 'quake', name: '剧变', from: 800, to: 950, p: 0.150, scale: 1.20, dimP: 80 },
    { id: 'storm', name: '狂澜', from: 950, to: 995, p: 0.045, scale: 3.00, dimP: 250 },
    { id: 'chaos', name: '混沌', from: 995, to: 1000, p: 0.005, scale: 1.00, dimP: 1000, full: true }
  ];
  function tierOf(n) {
    for (var i = 0; i < TIERS.length; i++) if (n >= TIERS[i].from && n < TIERS[i].to) return TIERS[i];
    return TIERS[TIERS.length - 1];
  }

  /* Box–Muller：把两路均匀数变成一个标准正态。两路都从哈希取（i 与 i+64），
     所以整条派生仍然是"同一个哈希 → 同一个宇宙"，没有引入任何真随机。 */
  function gaussOf(hash, i) {
    var a = slot(hash, i, U_DEN) / U_DEN;
    var b = slot(hash, (i + 64) & 0xff, U_DEN) / U_DEN;
    var u1 = 1 - a;                                   // (0,1]，避免 log(0)
    if (u1 <= 0) u1 = 1e-9;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * b);
  }
  function clampN(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  /** 弦气参数的抽样分布，逐条照 engine.js randomParams 里那段校准值 */
  function stringGasValue(key, hash, i) {
    /* 与 engine.js 里 18 级阶梯配套标定：**P(D=3)=3.05%**，D≤1 占 16.1%，满维 3.5%。
       这三个数必须与 engine.js 的 randomParams 完全一致（那边是引擎自己的随机宇宙），
       否则 dimensionStatistics 报的分布不是用户实际会遇到的那个。
       T₀/T_H 的抽样中心取 1.02 而不是默认值 0.98 —— 这是**产品选择，不是物理结论**：
       我们的宇宙定义了振幅 A=1 这个点且它正好给 D=3，若抽样关于它对称，就有约一半的
       宇宙 D<3，而 D<3 只有 {0,0.5,1,1.5,2,2.5} 六个格子装这一半，低维会堆得很挤。
       把中心右移一点把质量往高维推，低维堆积从 28.4% 降到 22.8%。
       参数默认值（= 我们的宇宙）不受影响，仍是 0.98。 */
    if (key === 'stringGasT') return clampN(1.02 + 0.15 * gaussOf(hash, i), 0.5, 1.5);
    if (key === 'windingDensity') return clampN(Math.exp(0.54 * gaussOf(hash, i)), 0.1, 10);
    return Math.pow(slot(hash, i, U_DEN) / U_DEN, 1.5);        // compactStiffness：偏向宽阈值带
  }

  /** keccak256(hash ‖ uint8(i)) mod m —— 与 Solidity 的
      uint256(keccak256(abi.encodePacked(bytes32 h, uint8 i))) % m 同式 */
  function slot(hashHex, i, m) {
    var h = toBytes(hashHex), buf = new Uint8Array(h.length + 1);
    buf.set(h); buf[h.length] = i & 0xff;
    return Number(toBigInt(keccak256Bytes(buf)) % BigInt(m));
  }

  /**
   * hashHex → 一组创世参数。纯函数，无随机、无时间、无环境依赖。
   * 返回 { hash, tier, uInt[20], u[20], params, modules }
   */
  function derive(hashHex) {
    var hash = normHash(hashHex);
    var tier = tierOf(slot(hash, 255, 1000));
    var uInt = [], u = [], params = {}, i;
    for (i = 0; i < HASH_KEYS.length; i++) {
      var n = slot(hash, i, U_DEN);
      uInt.push(n);
      u.push(n / U_DEN);
    }
    for (i = 0; i < HASH_KEYS.length; i++) {
      var key = HASH_KEYS[i], spec = SPEC_BY_KEY[key];
      var target;
      if (STRING_GAS[key]) {
        // 弦气三参数走引擎**校准过的那套分布**，不是均匀铺满全量程。
        // engine.js 的注释写着：T₀/T_H ~ N(0.98, 0.20) 夹到 [0.5,1.5]、ln n_w ~ N(0, 0.70)、
        // κ = u^1.5，蒙特卡洛 2 万次得 P(D=3) ≈ 1/30。均匀铺满会把三维率压到 2.5%，
        // 偏离模型自己的标定值——既然要"完全照弦气模型"，抽样口径也得照它的。
        params[key] = stringGasValue(key, hash, i);
        continue;
      } else if (tier.full) {
        target = u[i];
      } else {
        var base = Params.toUnit(key, spec.default);             // 我们宇宙的位置
        var d = 2 * u[i] - 1;                                    // −1..1
        var r = RADIUS[key] || [0, 0];
        target = base + tier.scale * d * (d < 0 ? r[0] : r[1]);  // 以生存半径为单位
      }
      if (target < 0) target = 0; else if (target > 1) target = 1;
      params[key] = Params.fromUnit(key, target);
    }
    /* ---- 引力倍率：走和别的参数一样的"生存半径"扰动，只是槽位是专用的 ---- */
    var ug = slot(hash, SLOT_G, U_DEN), gU = ug / U_DEN;
    var gSpec = SPEC_BY_KEY.gNewton;
    var gTarget;
    if (tier.full) {
      gTarget = gU;
    } else {
      var gBase = Params.toUnit('gNewton', gSpec.default);
      var gd = 2 * gU - 1, gr = RADIUS.gNewton;
      gTarget = gBase + tier.scale * gd * (gd < 0 ? gr[0] : gr[1]);
    }
    if (gTarget < 0) gTarget = 0; else if (gTarget > 1) gTarget = 1;
    params.gNewton = Params.fromUnit('gNewton', gTarget);

    params = Params.normalize(params, MODULES_ON);

    /* ---- 四个常数在"外部参照系"里的比值 ---- */
    var uf1 = slot(hash, SLOT_F1, U_DEN), uf2 = slot(hash, SLOT_F2, U_DEN);
    var sigma = FRAME_SIGMA * (tier.full ? 3 : tier.scale);
    var hbarRel = Math.exp(sigma * (2 * uf1 / U_DEN - 1));
    var cRel = Math.exp(sigma * (2 * uf2 / U_DEN - 1));
    var alphaRel = params.alpha / ALPHA0;
    var eRel = Math.sqrt(alphaRel * hbarRel * cRel);      // 反解：α = e²/(4πε₀ħc) 保持不变
    var GRel = params.gNewton * hbarRel * cRel;           // 反解：α_G = G m_p²/(ħc) 保持不变

    return {
      hash: hash, tier: tier, uInt: uInt, u: u, params: params, modules: MODULES_ON,
      /* 四个常数相对我们宇宙的倍率。物理内容只有 α 和 α_G 两个；
         hbarRel、cRel 这两个自由度宇宙内部测不出来，是外部参照系的选择。 */
      frame: {
        cRel: cRel, hbarRel: hbarRel, eRel: eRel, GRel: GRel,
        alphaRel: alphaRel, gNewtonRel: params.gNewton,
        uG: ug, uF1: uf1, uF2: uf2                        // 进 cardHash 用
      }
    };
  }

  /* ============================================================ 自检 */
  var VECTORS = [
    ['', '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
    ['abc', '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
    ['testing', '0x5f16f4c7f149ac4f9510d9cf8cf384038ad348b3bcdc01915f95de12df9d1b02']
  ];
  function selfTest() {
    var fails = [];
    VECTORS.forEach(function (v) {
      var got = keccak256(v[0]);
      if (got !== v[1]) fails.push('keccak256(' + JSON.stringify(v[0]) + ') = ' + got + '，期望 ' + v[1]);
    });
    // 确定性：同一哈希两次派生必须逐位相同
    var h = '0x' + '3b'.repeat(32), a = derive(h), b = derive(h);
    PARAM_KEYS.forEach(function (k) { if (a.params[k] !== b.params[k]) fails.push('派生不确定：' + k); });
    return { ok: fails.length === 0, fails: fails };
  }

  return {
    keccak256: keccak256,
    keccak256Bytes: keccak256Bytes,
    normHash: normHash,
    slot: slot,
    derive: derive,
    TIERS: TIERS,
    U_DEN: U_DEN,
    PARAM_KEYS: PARAM_KEYS,
    MODULES_ON: MODULES_ON,
    MODULES_OFF: MODULES_OFF,        // 旧名字，指向同一个对象（弦气已默认开）
    PARAM_SPECS: PARAM_SPECS,
    RADIUS: RADIUS,
    selfTest: selfTest
  };
});
