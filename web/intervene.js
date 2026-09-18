/*
 * web/intervene.js —— 干预沙盒（可玩版 v1 · 模块 B）
 * ------------------------------------------------------------
 * 玩家真正动手的地方：拿一个死掉的宇宙，一格一格地推参数，看它能不能活过来。
 * 沙盒 = 随便推、不花钱、不上链、可撤销；关掉之后原宇宙一个字节都没变。
 *
 * 为什么值得做成玩法：半径表的离线标定脚本 用贪心爬山（玩家的下限）实测，
 * 83% 的死宇宙能救活、中位 4 步 —— 够得着，又不是一步到位的老虎机。
 * 救不活的三类（黑洞主导 / 无稳定轨道 / D≠3）恰好是结构性死亡 v3 §2。
 *
 * 为什么右半边非得是仪表盘：同一份实测里，把 α 连续扫向我们的值，
 * ξ 从 0.8635 平滑降到 0.6508、f_O 从 0.0187 爬到 0.0499，而结局标签全程不变。
 * 只显示结局的话，玩家推一格屏幕上什么都不动，这个游戏当场就死了。
 *
 * 新手模式（默认开，」）：
 *   20 个旋钮一起摆出来，新手唯一的策略是乱推。所以默认只显示
 *   MirrorHint.diagnose() 指出的那几个参数（它是纯查表，不跑模拟，随便刷），
 *   再配一个大按钮「照提示推一格」。右上角开关一点就回到全部 20 个 ——
 *   **简化的是默认视图，不是能力**：撤销/重置/提示/引爆/全参数一个都没少。
 *   已经被推动过的参数即使不在诊断列表里也照样显示，否则刚推完那一行会凭空消失。
 *
 * 提示提速：旧版每次提示都调 MirrorHint.suggest()，20 参数 × 2 方向 = 40 次模拟（实测 1.1 秒）。
 *   现在先用 diagnose() 收窄到 3–4 个相关参数，只试它们 = 6–8 次模拟，实测快 5 倍以上；
 *   窄搜找不到能变好的一格时**自动退回全量 suggest**，省的是时间不是能力。
 *
 * ------------------------------------------------------------
 * 「推一格有多远」不在这个文件里（2026-08-19 改）：
 * 一格 = 该参数「生存半径」的一小截，而那张半径表是整套推导里唯一藏得住的东西
 * —— 参数表和物理引擎本来就得发到浏览器里跑，只有它能留在服务端。
 * 这个文件会被 build-web.js 打进站点包，所以它一个数都不能带。
 *
 * 于是沙盒改成：**客户端只表达意图，服务端算结果**。
 *   玩家点一下 +  →  往 ops 里追加一条 {key, dir}
 *   → POST /api/intervene {blockHash, ops, preview:true}
 *   → 服务端查半径、算新参数、算费用，回一份完整的 card
 *   → 本地拿这份参数跑一次引擎，喂给仪表盘和诊断
 * 本地引擎照跑不误：它本来就是公开的，跑它才有仪表和"卡在哪"的实时反馈。
 * 费用一律用服务端返回的那个数，客户端不再自己编一条成本曲线
 * 。
 *
 * 预览与真干预共用 /api/intervene：preview:true 时不签名、不落盘，
 * 所以沙盒仍然是「随便推、不花钱、不上链」的。
 *
 * 依赖，全部允许缺席（另外两个模块由别人并行写，早于/晚于本文件到位都不能炸）：
 *   window.MirrorGauges  —— 模块 A，缺席时右侧显示"仪表模块未加载"
 *   window.MirrorHint    —— 模块 C，缺席时"提示"与"照提示推一格"禁用，新手模式退回全参数
 *   window.MirrorOnboard —— 模块 D，缺席时术语退回符号、新手模式状态只存在内存里
 *   window.MirrorApp     —— 主程序，缺席时"用这组参数引爆"只提示一句，不抛错
 *   window.MirrorBnbApi  —— 服务端客户端，缺席时推格与提示都会说"连不上服务端"
 * 真正必需的只有 MirrorParams / MirrorEngine：没有它们连沙盒都建不起来，open() 返回 false。
 *
 * API：
 *   MirrorIntervene.open(entry) → bool   entry = { hash, params, modules, label, blockNumber }
 *   MirrorIntervene.close()  MirrorIntervene.isOpen()
 *   —— 另外导出不碰 DOM 的纯逻辑，给 Node 自测与跑分用：
 *   createSandbox(entry, solve)           solve(ops, wantSuggest) → Promise，见下面 defaultSolve
 *   narrowKeys(H, sim, allKeys, cap)      诊断收窄出来的候选参数
 *   fastSuggest(H, params, modules, opts) 收窄版提示；opts.step 必给（服务端注入），
 *                                         没有它就返回 null —— 浏览器里算不了这个
 *
 * UMD：Node 下 module.exports；浏览器下 window.MirrorIntervene。加载即无副作用。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root, null, require('../engine/params.js'), require('../engine/engine.js'));
  } else {
    root.MirrorIntervene = factory(root, root.document, root.MirrorParams, root.MirrorEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (root, doc, Params0, Engine0) {
  'use strict';

  /* ============================================================ 依赖（惰性取）

     **不能把 MirrorParams / MirrorEngine 在工厂参数上捕获成常量。**

     站点包（web/build-web.js 的 LAYER）把本文件排在 engine/params.js **之前** ——
     实测 web/dist-arc/app.html 里 web/intervene.js 是第 24 个 <script>，
     engine/params.js 第 29、engine/engine.js 第 30。执行到这一行时那两个全局还不存在，
     捕获下来就永远是 undefined，于是 open() 开头那句
     `if (!Params || !Engine) return false` **永远成立**：
     干预沙盒在站点版里根本打不开 —— 点「救救它」屏幕上什么都不会发生。
     （web/hint.js 早就是惰性取的，见它的 deps()；漏的只有这个文件。）

     改成用之前现取，脚本顺序怎么排都不怕。Node 下 require 进来时两个参数直接给全，
     deps() 第一次就命中，不会去读 root。 */
  var Params = Params0 || null, Engine = Engine0 || null;
  function deps() {
    if (!Params || !Engine) {
      var g = root || (typeof self !== 'undefined' ? self : null);
      if (g) { Params = Params || g.MirrorParams; Engine = Engine || g.MirrorEngine; }
    }
    return !!(Params && Engine);
  }

  /* ============================================================ 一格 = 多少
     以前这里有一张「生存半径」表和一个步长常数。两者都已经搬回 server/intervene.js：
     一格 = 步长 × 半径，把其中任何一个发到浏览器，另一个都能被反算出来
     （所以"加个 /api/steps 端点"也一样漏）。
     现在客户端**根本不算这段距离** —— 它只记「推了谁、往哪、第几格」，
     新参数、新结局和费用统统由服务端算完发回来。 */

  /* 哈希派生固定用"模块全关"的 20 个基础参数（engine/archash.js 的 MODULES_OFF）。
     不能让 Params.normalizeModules 走默认值：stringGas 默认是开的，一开 dimS 就变成派生量，
     参数表当场从 20 个变成 22 个，和玩家手里那个哈希对不上。 */
  var MODULES_OFF = { stringGas: false, slowRoll: false, landscape: false, altBiochem: false };

  /* ============================================================ i18n
     词条在 web/i18n-tools.js，机制见 web/i18n.js 顶部。
     i18n 缺席（Node 自测、离线单文件包）时 T 原样退回中文，一句都不会变成裸 key。
     门的名字与解释来自 MirrorHint / MirrorGauges 的定义表，那两张表存的是中文原文，
     所以**在这里显示的时候**才过一遍 T —— 切语言不用重建它们。 */
  /* ============================================================ ARCBANG（specs/arcbang-v1.md）
     config.site === 'arc' 时：**没有 BANG、没有任何代币**。拯救的费用改成
     native USDC，msg.value 一分不差地等于 cost，100% 打进销毁地址。
     于是这个文件里两件事按站分叉：① 一切写着「烧 BANG」的文案换成「付 USDC」；
     ② ERC-20 那套（余额 / 授权 / approve 一笔）在 arc 上整段跳过 —— 原生币不需要授权。
     config.js 在注入层里排在本文件之前，所以顶层就读得到。 */
  var ARC = ((root.ARCBANG_CONFIG && root.ARCBANG_CONFIG.site) || root.ARCBANG_SITE) === 'arc';
  /** 费用的单位名：arc 是 USDC，其余站是 BANG。只用在**已经分叉过**的整句里，
      不要拿它去拼 T() 的 key —— 拼出来的 key 词典里没有。 */
  function T(s) { var I = root && root.MirrorI18n; return (I && I.t) ? I.t(s, 'tools') : s; }
  /** 句子里带数字/参数名时用 {n}、{m} 占位再回填：整句当 key，英文才排得开词序。
      没有译文时 T 原样退回中文，回填之后与改之前逐字相同。 */
  function TN(s, n, m, k) {
    var r = T(s).replace('{n}', String(n));
    if (m != null) r = r.replace('{m}', String(m));
    /* {k} 是第三个槽（拯救文案要同时摆「宇宙 #区块号」「链上 NFT #tokenId」和持有人）。
       老调用只传两个参数，行为逐字不变。 */
    if (k != null) r = r.replace('{k}', String(k));
    return r;
  }
  /** 一串名字连起来。中文用「、」，英文的顿号得换成逗号 */
  function TL(list) { return list.map(function (s) { return T(s); }).join(T('、')); }

  /* 宇宙的**主编号一律是区块号**，不是 tokenId。全站口径见 web/arc-ui.js 顶部：
       「宇宙 #<区块号>」= 身份　　「NFT #<tokenId>」= 铸造顺序
     两个 # 前面永远有一个词说清是哪一种；市场卡、个人中心、状态页都按这个显示，
     拯救这一格以前回归成了 tokenId（页面上是 #2，市场上是 #8642956），对不上。
     区块号**沙盒手里现成就有**：open(entry) 把 entry.blockNumber 存进了 S.meta，
     而 bnb-ui 的 openSandbox() 传的正是 /api/card 拿回来的 card.blockNumber ——
     这里一次 RPC 都不多打。真没有（离线 harness / 深链没带）就退回 label 上那个
     哈希前 6 位的编号，读起来仍是一个编号，而不会被错认成 tokenId。 */
  function uniNo() {
    var m = S.meta || {};
    if (m.blockNumber != null && isFinite(m.blockNumber)) return String(m.blockNumber);
    if (m.label) return String(m.label).replace(/^#/, '');
    return m.hash ? String(m.hash).slice(2, 8).toUpperCase() : null;
  }
  function uniNoTxt() { return uniNo() || '?'; }

  /* ============================================================ 纯逻辑：沙盒 */
  function clone(o) {
    var r = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    return r;
  }

  /** [{key,dir,steps?},…] → [{key,dir,steps}]：把连着推同一个键同一个方向的合并起来。
      合并只是省字节，不影响结果 —— 服务端仍然一格一格地算（整数参数一格推不动
      这件事，只有一格一格算才看得出来）。
      steps 缺省按 1 算：手推一格给的是 {key,dir}，一键推维度给的是带 steps 的整批，
      两种都要能进这条路，否则那两条路会在费用和 opsHex 上各说各话。 */
  function compactOps(ops) {
    var out = [], i, last, n;
    for (i = 0; i < ops.length; i++) {
      n = ops[i].steps == null ? 1 : ops[i].steps;
      last = out[out.length - 1];
      if (last && last.key === ops[i].key && last.dir === ops[i].dir) last.steps += n;
      else out.push({ key: ops[i].key, dir: ops[i].dir, steps: n });
    }
    return out;
  }

  /**
   * 默认的「问服务端」实现。solve(ops, wantSuggest) → Promise<{params, costBang, outcome, suggest}>
   * 抽成可注入的一等参数，是为了 Node 自测能塞一个假的进去（那边没有 fetch，
   * 也不该为了测沙盒的撤销/记步逻辑去起一个真服务）。
   */
  function defaultSolve(hash) {
    return function (ops, wantSuggest) {
      var api = root.MirrorBnbApi;
      if (!api || typeof api.intervenePreview !== 'function') {
        return Promise.reject(new Error(T('服务端客户端没加载，这一格算不了')));
      }
      if (!hash) return Promise.reject(new Error(T('这个宇宙没有区块哈希，服务端没法定位它')));
      return api.intervenePreview(hash, ops, wantSuggest);
    };
  }

  function run(params, modules) {
    if (!deps()) return null;
    // register:false —— 沙盒里推一格算一次，不该算作一次真正的"引爆"
    try { return Engine.simulate(params, { modules: modules, register: false }); } catch (e) { return null; }
  }

  /* ============================================================ 第一步：把维度推到 3

**：
       第一段调维度 —— 98% 的死宇宙都要做，**有确定答案**，花钱就能过；
       第二段调其余参数 —— 58% 的人做完第一段就赢了，剩下的才是真正的博弈。
     第一段实测 D≠3 能推到 D=3 的比例是 **100%**。

     所以这一步**不能交给贪心爬山**。同一份 spec 记着：早先爬山测出来救活率只有 3%，
     原因是维度被量化成整数或半整数之后目标函数是平的 —— 跨过那一格之前没有梯度，
     小步长的爬山永远卡在原地。换成直接求解最近的 D=3 点，成功率 100%。
     界面上它就该是**一个按钮**，而不是让人在 23 个旋钮里猜哪三个管维度。

     ------------------------------------------------------------
     **这里一个距离都不算，一分钱都不估，半径表一个数都没有。**

     解出来的东西是「把哪个参数挪到 unit 空间的哪个位置」。用到的只有
     engine/params.js 的 toUnit/fromUnit 和 engine/engine.js 的模拟 ——
     这两个模块本来就必须发到浏览器里跑，不是秘密。
     生存半径表（engine/archash.js 的 RADIUS）没有打进站点包，这个求解器也不需要它：
     弦气那三个参数**压根不在半径表上**（server/intervene.js 的 radiusOf 对它们走 FALLBACK，
     计价走的是固定的每 unit 单价，整条路上没有半径这个量）。
     「这段位移等于几格」由服务端回的参数现场标定（见 sandbox.solveDimension），
     客户端不存这个数、也不外推到别的参数；费用一律用服务端返回的 costBang。

     ------------------------------------------------------------
     怎么解：D = Σ s_i，s_i 由 ε_i = g_i·e^{6(T−0.98)}/n_w 和阈值带宽 w = 0.4(1−κ) 决定。
     D 对 T 单调不减、对 n_w 单调不增 —— 于是「D 恰好等于 3」在每一根轴上都是
     **一段连续的高原**，二分就能把它的两个端点找出来。
     刻意**不抄一份维度公式过来**：抄的那份迟早和引擎分叉，而这里全程只调
     Engine.simulate，引擎怎么改这里都跟得上。
     取高原里离当前位置最近的那个点，再往里让 30% —— 最后要把位移取整成格数，
     落在高原边缘上会因为舍入掉出去。高原实测宽约 0.02 unit ≈ 40 格，让进 30% 还剩十几格余量。 */

  /** 维度只由弦气这三个参数决定。这个白名单是**硬约束**：标定那一步只许走这里的键，
      它们不在生存半径表上，所以标定不可能碰到半径。别的参数推一万格也不动 D。 */
  var DIM_KEYS = ['stringGasT', 'windingDensity', 'compactStiffness'];
  /** 服务端一次最多 4096 格（MAX_TOTAL_STEPS），留点余量。实测最远的一次要 1249 格 */
  var MAX_STEPS = 4000;
  /** 二分次数。高原宽约 0.02 unit，32 次的精度是 2⁻³²，早就够了；一次模拟实测 0.45 ms */
  var PLATEAU_ITER = 32;

  function dimOf(sim) {
    var d = sim && sim.calc && sim.calc.dims;
    return (d && typeof d.D === 'number' && isFinite(d.D)) ? d.D : null;
  }

  /** 把 key 放到 unit 位置 u 的那份参数。返回新对象，绝不改入参 */
  function atUnit(params, key, u, modules) {
    var q = clone(params);
    q[key] = Params.fromUnit(key, Math.min(1, Math.max(0, u)));
    return Params.normalize(q, modules);
  }

  /**
   * 沿 key 这根轴找「D 恰好 = 3」的那段高原 → [lo, hi]（unit 空间），没有就返回 null。
   * inc = D 是否随 u 单调不减（T 是，n_w 不是）。
   */
  function dimPlateau(params, key, modules, inc) {
    var t = inc ? 3 : -3, i, m, a, b, lo, hi;
    function f(u) {
      var D = dimOf(run(atUnit(params, key, u, modules), modules));
      return D == null ? null : (inc ? D : -D);
    }
    var f0 = f(0), f1 = f(1);
    if (f0 == null || f1 == null) return null;
    if (f1 < t) return null;                                  // 整根轴都够不到 3
    if (f0 >= t) lo = 0;
    else {
      a = 0; b = 1;
      for (i = 0; i < PLATEAU_ITER; i++) { m = (a + b) / 2; if (f(m) >= t) b = m; else a = m; }
      lo = b;
    }
    if (f(lo) > t) return null;                               // 从 <3 一步跨过了 3：这根轴上没有 3 这一档
    if (f1 <= t) hi = 1;
    else {
      a = lo; b = 1;
      for (i = 0; i < PLATEAU_ITER; i++) { m = (a + b) / 2; if (f(m) <= t) a = m; else b = m; }
      hi = a;
    }
    return hi > lo ? [lo, hi] : null;
  }

  /**
   * 求「最近的 D=3 点」。返回 {key, dir, fromUnit, toUnit, params, from, to, plateau} 或 null
   * （null = 已经是三维，或者弦气模块没开，或者这个宇宙真的解不出三维）。
   *
   * 轴的先后 = 同样一段 unit 位移谁把 D 推得更远（弦气按 |Δunit| 计价，走得远就是便宜）：
   * A = e^{6(T−0.98)}/n_w，T 的量程是 1.0 → ln A 能走 6；n_w 是对数轴、量程两个十倍 → 4.6。
   * 所以先试 T。实测 379 个 D≠3 的死宇宙，T 这一根轴单独就解掉了全部 379 个，
   * 后两根是保险（κ 对 D 并不单调，所以它的二分结果一定要复核 —— 下面本来就复核）。
   */
  function dimSolve(params, modules) {
    if (!deps()) return null;
    var ms = modules || MODULES_OFF, i, key, pl, u0, u1, np;
    if (dimOf(run(params, ms)) === 3) return null;            // 已经三维，没得推
    var axes = [['stringGasT', true], ['windingDensity', false], ['compactStiffness', true]];
    for (i = 0; i < axes.length; i++) {
      key = axes[i][0];
      if (!Params.byKey[key] || params[key] == null) continue; // 弦气模块没开：这三个参数不存在
      pl = dimPlateau(params, key, ms, axes[i][1]);
      if (!pl) continue;
      u0 = Params.toUnit(key, params[key]);
      u1 = u0 < pl[0] ? pl[0] : (u0 > pl[1] ? pl[1] : u0);
      if (u1 === u0) continue;                                // 已经在高原里却不是 D=3：换一根轴
      u1 = (u1 === pl[0]) ? pl[0] + (pl[1] - pl[0]) * 0.3 : pl[1] - (pl[1] - pl[0]) * 0.3;
      np = atUnit(params, key, u1, ms);
      /* 二分是数值的，结论必须拿真引擎复核一遍。κ 那一根轴尤其要复核：
         w = 0.4(1−κ) 对 D 不是单调的，二分可能给出一个并不成立的端点。 */
      if (dimOf(run(np, ms)) !== 3) continue;
      return {
        key: key, dir: u1 > u0 ? 1 : -1, fromUnit: u0, toUnit: u1,
        plateau: pl, params: np, from: params[key], to: np[key]
      };
    }
    return null;
  }

  /* ============================================================ 目标二：冷液体宇宙（NO_STARS + ocean 变体）

     沙盒到这里为止只有一个目标：把宇宙推活（OBSERVERS_POSSIBLE）。
     引擎加了 R_OCEAN（engine/engine.js 的 calcOcean，依据等级 heuristic）之后多了一个**可推的终点**：
     结局仍是既有的 NO_STARS（合约写死 outcome>11 即 revert，12 项结局一个都不能加），
     另挂一个变体标记 result.variant === 'ocean'。四条判据：
       ① 自由落体塌缩时标 > 宇宙年龄  ② 没有恒星点燃  ③ 有原子且分子刚性  ④ 背景温度落在分子液态温区

     这条路**全程本地解**（和维度那条一样，见 dimSolve 上面那段）：引擎就在浏览器里，
     四条判据的连续余量由引擎写在 calc.ocean.margin 里，客户端只做爬山，不碰生存半径、不估价。
     「这段位移等于几格」仍然由服务端现场标定（quoteOcean），费用一律用服务端返回的 costBang。 */

  /** 可推的轴。每一根都**直接进入** R_OCEAN 的某一条判据，不是乱挑的：
        gNewton     → α_G = (m_p/M_Pl)²·gNewton → 自引力强弱（判据 ①）
        alphaSMZ    → Λ_QCD → m_p → α_G（同上，指数敏感），同时改核力射程（判据 ②）
        omegaBh2    → Ω_b：塌缩时标里的气体密度（判据 ①），也决定有没有重子（判据 ③）
        tcmb        → 背景温度 T=T_CMB/a（判据 ④ 的温标）
        electronMass / alpha → 键能标度 α²mₑ → 液态温区（判据 ④），也进分子刚性（判据 ③）
        mUp / mDown → m_π² ∝ (m_u+m_d)Λ_QCD → 核力射程 → 氘核束不束缚（判据 ②）
        higgsVev    → G_F → 中子寿命与 n/p 冻结温度，间接进 BBN（判据 ②）
      第二批是**结局排序的前置门**：NO_STARS 排在「没有重子 / 大挤压 / 黑洞主导 / 结构没形成」之后，
      这几条不让开的话，四条判据全过结局也不是 NO_STARS，变体挂不上去：
        ckmPhase / generations → Sakharov 条件 → 有没有重子
        As / ns / omegaCh2 / omegaLambda / H0 → 增长因子、Weinberg 上界、原初黑洞比例 → 结构与黑洞那两条
      顺序就是爬山的扫描顺序：影响最直接的排前面。
      实测（20 个 D=3 的随机死宇宙，full spread）：只用第一批命中 7/20，加上第二批 10/20，
      单次约 620 次模拟 / 300 ms。剩下的一半卡在局部最优 —— 界面上如实说「推不到」，不粉饰。 */
  var OCEAN_KEYS = ['gNewton', 'alphaSMZ', 'omegaBh2', 'tcmb', 'electronMass', 'mDown', 'mUp', 'alpha', 'higgsVev',
    'ckmPhase', 'generations', 'As', 'ns', 'omegaCh2', 'omegaLambda', 'H0'];
  var OCEAN_GRID = 16;        // 每根轴一轮在 unit 空间等分扫 17 个点
  var OCEAN_SWEEPS = 4;       // 坐标下降扫几轮（一轮 16×17 次模拟，实测一次模拟 0.45 ms）
  /** 服务端一次最多 4096 格（MAX_TOTAL_STEPS）。多轴方案要共用这个额度 */
  var OCEAN_MAX_TOTAL = 3800;

  /** 四条判据的连续余量 + 结局排序的前置门 → 一个分数。
      前半段（margin）全部来自引擎的 calc.ocean.margin，这里不自己判物理。
      后半段是**结局排序**的必经之路：engine.js 的 decideOutcome 里，NO_STARS 排在
      「没有重子 / 大挤压 / 黑洞主导 / 结构没形成 / 没有原子」这几条之后，
      四条判据全过但卡在这些分支上的话结局不是 NO_STARS，变体也就挂不上去。
      早先只按 margin 打分，爬山会停在「四条全过、结局却是热寂」的高原上（实测 12 个里只中 3 个）。 */
  function oceanScore(sim) {
    if (!sim || !sim.calc) return -1;
    var c = sim.calc, o = c.ocean;
    if (!o || !o.margin) return -1;
    var m = o.margin, st = c.structure || {}, s = 0;
    s += (m.stars || 0) * 30 + (m.chemistry || 0) * 25 + (m.collapse || 0) * 25 + (m.liquid || 0) * 20;
    // 结局排在 NO_STARS 之前的那几道：每一道都得先让开
    s += (c.baryons && c.baryons.hasBaryons) ? 12 : 0;            // 没有重子 → NO_ATOMS
    s += st.structureFormed ? 12 : 0;                             // 结构没形成 → HEAT_DEATH_NO_STRUCTURE
    s += (st.betaPBH > 1e-8 || st.Qeff >= 1e-3) ? 0 : 10;         // 原初黑洞/团块坍缩 → BLACK_HOLE_DOMINATED
    s += (sim.fate && sim.fate.type === 'crunch') ? 0 : 6;        // 大挤压排在更前面
    s += (c.dims && Math.abs(c.dims.D - 3) < 1e-9) ? 15 : 0;      // D≠3 的结局根本到不了 NO_STARS（维度那一步另有按钮）
    if (o.pass) s += 50;                                          // 四条全过
    if (sim.outcome && sim.outcome.id === 'NO_STARS') s += 25;    // 结局落到 NO_STARS 这一档
    if (sim.variant === 'ocean') s += 100;                        // 真的是冷液体宇宙了
    return s;
  }

  function oceanHit(sim) { return !!(sim && sim.variant === 'ocean'); }

  /* ---------------------------------------------------------- 爬山：分片跑，别霸着主线程

     这一坨是整个沙盒里唯一的**长同步任务**：16 根轴 × 17 个点 × 4 轮 ≈ 4300 次模拟。
     实测（Chrome / 本机）一次 285–311 ms —— 一口气跑完就是肉眼可见的一次假死，
     而「自动推」要一步一跑，卡顿会乘以步数。

     所以把坐标下降拆成一台**可暂停的状态机**（oceanJob）：
       · slice(budget) 跑到预算用完就返回，主线程随时能喘气；
       * 片与片之间用 MessageChannel（没有就退回 setTimeout 0）把控制权交还浏览器。
     没选 Worker：站点版是**离线单文件**，Worker 得把 params.js + engine.js 的源码
     整段塞进 Blob URL 才跑得起来，而那两个文件在包里已经被内联掉、拿不到源文本。
     分片是同一份代码、同一个结果，风险小得多。

     oceanSolve() 仍然在（Node 自测、server 侧跑分照旧用它）：它只是把 job 一口气跑完，
     逐字等价于改造前的那段循环 —— 换句话说 bnb / btc 的行为一个字节都没动。 */

  /** 一片最多占用主线程多少毫秒。8 ms ≈ 半帧，浏览器还来得及画一帧 */
  var OCEAN_SLICE_MS = 8;

  /** 把控制权交还浏览器，下一拍再继续。MessageChannel 比 setTimeout 0 快
      （后者连排 5 个之后会被钳到 4 ms），两者都没有就同步继续（Node 自测）。 */
  function yieldToUI(fn) {
    if (root.MessageChannel) {
      try {
        var c = new root.MessageChannel();
        c.port1.onmessage = function () { c.port1.close(); fn(); };
        c.port2.postMessage(0);
        return;
      } catch (e) { /* 老 WebView 没有它，退回下面 */ }
    }
    if (root.setTimeout) { root.setTimeout(fn, 0); return; }
    fn();
  }

  /**
   * 坐标下降的**可暂停版**：每根轴在 unit 空间上整轴扫一遍取最优。
   * 用整轴扫而不是小步爬山，理由和维度那条一样 —— 判据里有好几段是**阶跃**的
   * （氘核束不束缚、有没有原子、窗口在不在复合之后），小步长在跨过那一格之前没有梯度。
   * @returns {slice(budgetMs)→done, done(), result(), scans()}
   *          result() = {moves, params, hit, score} 或 null（已经是冷液体宇宙 / 爬不动）
   */
  function oceanJob(params, modules) {
    var ms = modules || MODULES_OFF;
    var origin = Params.normalize(params, ms);
    var cur = origin, best = -1;
    var sweep = 0, k = 0, i = 0, u0 = 0, bu = null, bs = -1, improved = false;
    var fin = false, res = null, scans = 0;

    if (oceanHit(run(origin, ms))) fin = true;                    // 已经到了
    else best = oceanScore(run(cur, ms));

    /** 换到第 k 根轴：跳过这个模块组合下不存在的轴，记下起点与本轮最好成绩 */
    function enter() {
      while (k < OCEAN_KEYS.length && !Params.byKey[OCEAN_KEYS[k]]) k++;
      if (k >= OCEAN_KEYS.length) return;
      u0 = Params.toUnit(OCEAN_KEYS[k], cur[OCEAN_KEYS[k]]);
      bu = null; bs = best; i = 0;
    }
    if (!fin) enter();

    function finish() {
      fin = true;
      var moves = [], j, key, a, b;
      for (j = 0; j < OCEAN_KEYS.length; j++) {
        key = OCEAN_KEYS[j];
        if (!Params.byKey[key]) continue;
        a = Params.toUnit(key, origin[key]); b = Params.toUnit(key, cur[key]);
        if (Math.abs(b - a) > 1e-9) moves.push({ key: key, dir: b > a ? 1 : -1, fromUnit: a, toUnit: b });
      }
      // 爬不动：这个宇宙推不成冷液体宇宙
      res = moves.length ? { moves: moves, params: cur, hit: oceanHit(run(cur, ms)), score: best } : null;
    }

    return {
      done: function () { return fin; },
      result: function () { return res; },
      scans: function () { return scans; },
      /** 跑一小片；budget 毫秒用完就停。返回「做完了没有」 */
      slice: function (budget) {
        if (fin) return true;
        var t0 = now(), key, u, q, sc;
        for (;;) {
          if (now() - t0 >= budget) return false;
          if (k >= OCEAN_KEYS.length) {                           // 一轮扫完
            sweep++;
            if (!improved || sweep >= OCEAN_SWEEPS) { finish(); return true; }
            k = 0; improved = false; enter();
            continue;
          }
          key = OCEAN_KEYS[k];
          if (i > OCEAN_GRID) {                                   // 这根轴扫完
            if (bu != null) { cur = atUnit(cur, key, bu, ms); best = bs; improved = true; }
            k++; enter();
            continue;
          }
          u = i / OCEAN_GRID; i++;
          if (Math.abs(u - u0) < 1e-9) continue;
          q = atUnit(cur, key, u, ms);
          sc = oceanScore(run(q, ms)); scans++;
          if (sc > bs + 1e-9) { bs = sc; bu = u; }
        }
      }
    };
  }

  /**
   * 一口气跑完的老接口。**结果与改造前逐字相同**，只是循环搬进了 oceanJob。
   * @returns {moves:[{key,dir,fromUnit,toUnit}], params, hit, score} 或 null（已经是冷液体宇宙 / 依赖没加载）
   */
  function oceanSolve(params, modules) {
    if (!deps()) return null;
    var job = oceanJob(params, modules);
    job.slice(Infinity);
    return job.result();
  }

  /**
   * 分片版：同一套爬山，每片 ≤ OCEAN_SLICE_MS 毫秒，片间把主线程还给浏览器。
   * 界面上一切要算这个方案的地方都走它 —— 同步那条只留给 Node 自测与服务端跑分。
   * @param onSlice 可选：每片结束时回调 (已扫过的点数)，给「正在算…」那行做进度
   */
  function oceanSolveAsync(params, modules, onSlice) {
    if (!deps()) return Promise.resolve(null);
    var job;
    try { job = oceanJob(params, modules); } catch (e) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      function tick() {
        var done;
        try { done = job.slice(OCEAN_SLICE_MS); } catch (e) { resolve(null); return; }
        if (done) { resolve(job.result()); return; }
        if (onSlice) { try { onSlice(job.scans()); } catch (e) { /* 进度回调不许影响爬山 */ } }
        yieldToUI(tick);
      }
      tick();
    });
  }

  /**
   * 一个宇宙的沙盒：一条状态链（trail）+ 一摞操作（ops）。
   * 撤销 = 弹掉最后一个状态，重置 = 只留第 0 个 —— 所以"撤销/重置"是真的可用，
   * 不是重新从原始参数把操作重放一遍（重放会因为夹边界而对不上）。
   * 全程只读 entry.params，第一步就 normalize 成自己的副本。
   */
  /* 这套沙盒有多少个旋钮，取决于开了哪些模块（弦气模块一开，dimS 换成三个弦气参数）。
     文案里写死"20 个"会在参数表变动时立刻说谎 —— 实测开着弦气模块是 23 个。 */
  function nParams() {
    if (!deps()) return 0;
    return (S.box && S.box.keys) ? S.box.keys.length : Params.BASE.length;
  }

  function createSandbox(entry, solve) {
    deps();                                     // 引擎没到位就让它当场抛，比静默出错清楚
    entry = entry || {};
    var modules = entry.modules ? clone(entry.modules) : clone(MODULES_OFF);
    var keys = Params.paramsFor(modules).map(function (d) { return d.key; });
    var origin = Params.normalize(entry.params || Params.defaults(modules), modules);
    /* opsHex：服务端算出的「上链用的位移记录」。一格都没推时它是 null ——
       原生宇宙没有位移可记，也没有干预可上链。 */
    var trail = [{ key: null, dir: 0, params: origin, sim: run(origin, modules), costBang: '0', opsHex: null }];
    var ops = [];
    var ask = typeof solve === 'function' ? solve : defaultSolve(entry.hash);
    /* 每次推格都是一个网络往返，而玩家会连点。所以所有请求串成一条链依次发出：
       并发发的话，后发的先回就会把状态倒着写进 trail，撤销跟着乱。 */
    var chain = Promise.resolve();
    var busy = 0;

    /* 试过、服务端说"没动"的方向。键里带上当时的取值：推不动是**位置相关**的，
       换了个位置同一颗按钮可能就能推了，缓存不带位置会把活按钮永久标死。 */
    var deadAt = {};
    function deadKey(key, dir, v) { return key + '|' + dir + '|' + v; }

    function current() { return trail[trail.length - 1]; }
    function previous() { return trail.length > 1 ? trail[trail.length - 2] : null; }

    /**
     * 这个方向能不能推 —— **同步**、不联网、不跑模拟，界面每次重画全表要问 46 次。
     *
     * 以前它是真的算一格看看动没动。现在客户端算不了距离了，能就地判定的只剩两件事：
     *   ① 已经顶到取值边界（unit 到 0 或 1），那是参数表本身的信息，不是秘密；
     *   ② 之前在同一个取值上推过同一个方向、服务端回来说没动（整数参数就是这样）。
     * 判不出来就一律放行 —— 宁可让玩家点一下换来一句"这一格推不动"，
     * 也不能靠瞎猜把一颗其实能用的按钮标灰。
     */
    function probe(key, dir) {
      var from = current();
      if (keys.indexOf(key) < 0) return { ok: false, reason: T('没有这个参数：') + key };
      var d = Params.byKey[key] || {}, at = Params.toUnit(key, from.params[key]);
      if (dir < 0 ? at <= 0 : at >= 1) {
        return { ok: false, reason: TN('已经顶到取值边界（{n}），这个方向没有余地了', (dir < 0 ? d.min : d.max)) };
      }
      var why = deadAt[deadKey(key, dir, from.params[key])];
      if (why) return { ok: false, reason: why };
      return { ok: true };
    }

    /**
     * 往服务端发一批格子。**手推一格和一键推维度共用这一条路** ——
     * 分成两份实现的话，两者迟早会在费用、opsHex 和 trail 的形状上各说各话。
     * @param more   [{key, dir, steps}]，追加在已有 ops 之后
     * @param commit true 记进 trail（可撤销）；false 只看结果不落痕迹（标定用）
     */
    function send(more, commit) {
      var wanted = ops.concat(more);
      busy++;
      var r = chain.then(function () {
        return ask(compactOps(wanted), false).then(function (res) {
          var next = Params.normalize(res.params, modules);
          if (!commit) return { ok: true, params: next, costBang: res.costBang || '0' };
          ops = wanted;
          trail.push({
            key: more.length === 1 ? more[0].key : null,
            dir: more.length === 1 ? more[0].dir : 0,
            params: next, sim: run(next, modules),
            costBang: res.costBang || '0', outcome: res.outcome || null,
            /* 和 costBang 一路回来的位移记录。客户端**不解释也不重算**它，
               只负责在真烧币时原样交给合约 —— 它被服务端签名盖住，动一个字节就废。 */
            opsHex: res.ops || null
          });
          return { ok: true, params: next };
        });
      }).then(function (v) { busy--; return v; }, function (e) { busy--; throw e; });
      chain = r.then(null, function () { });        // 链本身不许被一次失败掐断
      return r;
    }

    /**
     * 推一格（或一批格）。返回 Promise<{ok, reason?}> —— 距离和费用都在服务端算，
     * 所以这里必然是异步的。推不动时不记步（记了会让"累计费用"和"格数"撒谎），把原因说清楚。
     */
    function push(key, dir, steps) {
      var p = probe(key, dir);
      if (!p.ok) return Promise.resolve(p);
      var n = (typeof steps === 'number' && steps > 1) ? Math.min(MAX_STEPS, Math.round(steps)) : 1;
      var from = current();
      return send([{ key: key, dir: dir, steps: n }], true).then(function () {
        if (current().params[key] === from.params[key]) {
          /* 服务端算下来这一格没挪动它：记下来，下次重画就能把这颗按钮标灰。
             trail 已经压进去了，撤掉 —— 没动就不该记步。 */
          undo();
          var why = (Params.byKey[key] || {}).step === 1
            ? T('这一格小到被取整吃掉了（整数参数）')
            : T('这一格没能让它动起来 —— 换个参数试试');
          deadAt[deadKey(key, dir, from.params[key])] = why;
          return { ok: false, reason: why };
        }
        return { ok: true, key: key, dir: dir, steps: n };
      }, function (e) {
        /* 服务端说"一个参数都没动"就是这一格推不动，不是出错 —— 界面上必须分开说，
           不然玩家看到红色的"出错了"会以为是网络坏了，其实是这颗旋钮到头了。 */
        if (e && e.code === 'NO_MOVE') {
          var why = T('这一格推不动 —— 换个参数试试');
          deadAt[deadKey(key, dir, current().params[key])] = why;
          return { ok: false, reason: why };
        }
        return { ok: false, reason: T('服务端算不出这一格：') + ((e && e.message) || e) };
      });
    }

    /** 现在这个宇宙的维度还差多少 —— 有解就返回方案，没有（或已经三维）返回 null */
    function dimPlan() {
      try { return dimSolve(current().params, modules); } catch (e) { return null; }
    }

    /**
     * 维度这一步的**报价**。两次往返，两次都**不落 trail** —— 玩家还没点，不该留下痕迹。
     *   ① 标定：只推 1 格，看服务端把它挪了多远。
     *      「一格 = 多远」永远是服务端说了算 —— 客户端不存这个数，也不外推到别的参数。
     *      这条路**写死只走 DIM_KEYS**，那三个键不在生存半径表上，标定碰不到半径。
     *   ② 按标定出来的格数预览一次，拿回服务端算的费用。
     * 费用一律用服务端返回的 costBang，客户端不自己编一条成本曲线
     * 。
     * @returns Promise<{key, dir, steps, costBang, D} | null>
     */
    function quoteDimension() {
      var plan = dimPlan();
      if (!plan) return Promise.resolve(null);
      if (DIM_KEYS.indexOf(plan.key) < 0) return Promise.resolve(null);  // 白名单，防以后有人往 axes 里加参数
      var need = Math.abs(plan.toUnit - plan.fromUnit);
      return send([{ key: plan.key, dir: plan.dir, steps: 1 }], false).then(function (p1) {
        var per = Math.abs(Params.toUnit(plan.key, p1.params[plan.key]) - plan.fromUnit);
        if (!(per > 0)) return null;                            // 这个方向推不动
        var n = Math.max(1, Math.min(MAX_STEPS, Math.round(need / per)));
        return send([{ key: plan.key, dir: plan.dir, steps: n }], false).then(function (p2) {
          return {
            key: plan.key, dir: plan.dir, steps: n,
            costBang: p2.costBang || '0',
            D: dimOf(run(p2.params, modules))
          };
        });
      });
    }

    /**
     * 一键把维度推到 3：按报价那一批格子推到位，落 trail（所以「撤销一步」整步退得回来）。
     * 落点在 D=3 那段高原里还留着 30% 余量，取整误差吃不掉它；推完仍然用本地引擎复核 D。
     * @param quote quoteDimension() 的结果。界面已经拿它标过价，直接复用，省一次往返。
     */
    function solveDimension(quote) {
      return (quote ? Promise.resolve(quote) : quoteDimension()).then(function (q) {
        if (!q) return { ok: false, reason: T('这个宇宙解不出三维 —— 弦气模块没开，或者它的维度已经是 3。') };
        return send([{ key: q.key, dir: q.dir, steps: q.steps }], true).then(function () {
          var D = dimOf(current().sim);
          return { ok: true, key: q.key, dir: q.dir, steps: q.steps, D: D, hit: D === 3 };
        });
      }).then(null, function (e) {
        if (e && e.code === 'NO_MOVE') return { ok: false, reason: T('服务端说这个方向推不动，维度这一步走不了') };
        return { ok: false, reason: T('服务端算不出这一步：') + ((e && e.message) || e) };
      });
    }

    /* ---- 目标二：冷液体宇宙。三个入口的形状照维度那条抄（dimPlan / quoteDimension / solveDimension），
           因为约束是同一套：本地解、服务端标定格数、费用只认服务端返回的 costBang。
           区别只有一个 —— 维度那条一次只推一根轴，这条是多轴方案，所以标定把所有轴放在**同一次**
           往返里（发一批"每根轴 1 格"，从回来的参数上逐根读位移），往返次数和维度那条一样是 2 次。 */

    /** 这个宇宙还差多远到冷液体宇宙 —— 有解就返回方案，没有（或已经是）返回 null。
        **同步版**：一口气跑完 ≈ 4300 次模拟（实测浏览器里 285–311 ms）。
        界面上一个地方都不许再调它 —— 那就是「换目标就假死」的那一下。留着只为 Node 自测。 */
    function oceanPlan() {
      try { return oceanSolve(current().params, modules); } catch (e) { return null; }
    }

    /** 同上，但**分片跑**：每片 ≤ 8 ms，片间还主线程。界面一律走这一条。 */
    function oceanPlanAsync(onSlice) {
      try { return oceanSolveAsync(current().params, modules, onSlice); }
      catch (e) { return Promise.resolve(null); }
    }

    /**
     * 冷液体宇宙这一步的**报价**。两次往返，两次都不落 trail（玩家还没点，不该留痕迹）。
     *   ① 标定：每根轴各推 1 格，一次发出去，看服务端把每根轴各挪了多远。
     *   ② 按标定出来的格数整批预览一次，拿回服务端算的费用。
     * 总格数超过服务端一次的上限时按比例缩回去（缩完仍然用本地引擎复核落点）。
     * @param plan0 已经算好的方案（界面刚算过就直接给，省一次爬山）
     * @returns Promise<{ops, costBang, hit, moves} | null>
     */
    function quoteOcean(plan0) {
      return (plan0 ? Promise.resolve(plan0) : oceanPlanAsync()).then(function (plan) {
        if (!plan) return null;
        var one = plan.moves.map(function (m) { return { key: m.key, dir: m.dir, steps: 1 }; });
        return send(one, false).then(function (p1) {
          var want = [], total = 0, i;
          for (i = 0; i < plan.moves.length; i++) {
            var m = plan.moves[i];
            var per = Math.abs(Params.toUnit(m.key, p1.params[m.key]) - m.fromUnit);
            if (!(per > 0)) continue;                               // 这根轴这个方向推不动，放弃它
            var need = Math.abs(m.toUnit - m.fromUnit);
            var n = Math.max(1, Math.min(MAX_STEPS, Math.round(need / per)));
            want.push({ key: m.key, dir: m.dir, steps: n });
            total += n;
          }
          if (!want.length) return null;
          if (total > OCEAN_MAX_TOTAL) {                            // 缩回服务端一次能接的额度
            var f = OCEAN_MAX_TOTAL / total;
            want.forEach(function (w) { w.steps = Math.max(1, Math.round(w.steps * f)); });
          }
          return send(want, false).then(function (p2) {
            var s2 = run(p2.params, modules);
            return { ops: want, costBang: p2.costBang || '0', hit: oceanHit(s2), moves: plan.moves, outcome: s2 && s2.outcome ? s2.outcome.id : null };
          });
        });
      });
    }

    /**
     * 方案里的**一根轴**：单独标定、单独推到位，落 trail（所以「撤销一步」退得回来）。
     * 「自动推」要一步一步看得见指针动，所以按轴拆开走；落点和整批推等价 ——
     * 坐标下降给的本来就是每根轴各自的绝对落点，先后顺序不改变终点。
     * @param m {key, dir, fromUnit, toUnit}，oceanPlanAsync() 的 moves 里的一条
     * @returns Promise<{ok, key?, dir?, steps?, hit?, reason?}>
     */
    function solveOceanMove(m) {
      return send([{ key: m.key, dir: m.dir, steps: 1 }], false).then(function (p1) {
        var per = Math.abs(Params.toUnit(m.key, p1.params[m.key]) - m.fromUnit);
        if (!(per > 0)) return { ok: false, reason: T('这一格推不动 —— 换个参数试试') };
        var need = Math.abs(m.toUnit - m.fromUnit);
        var n = Math.max(1, Math.min(MAX_STEPS, Math.round(need / per)));
        return send([{ key: m.key, dir: m.dir, steps: n }], true).then(function () {
          var s = current().sim;
          return { ok: true, key: m.key, dir: m.dir, steps: n, hit: oceanHit(s) };
        });
      }).then(null, function (e) {
        if (e && e.code === 'NO_MOVE') return { ok: false, reason: T('这一格推不动 —— 换个参数试试') };
        return { ok: false, reason: T('服务端算不出这一步：') + ((e && e.message) || e) };
      });
    }

    /**
     * 一键推向冷液体宇宙：按报价那一批格子推到位，落 trail（「撤销一步」整步退得回来）。
     * 推完仍然用本地引擎复核 variant —— 取整误差可能把落点挤出判据边界，那时候如实说"还差一点"。
     * @param quote quoteOcean() 的结果，界面已经拿它标过价就直接复用，省一次往返。
     */
    function solveOcean(quote) {
      return (quote ? Promise.resolve(quote) : quoteOcean()).then(function (q) {
        if (!q) return { ok: false, reason: T('这个宇宙推不成冷液体宇宙 —— 沿这些参数爬不到那四条判据同时成立的地方。') };
        return send(q.ops, true).then(function () {
          var s = current().sim;
          return { ok: true, ops: q.ops, hit: oceanHit(s), outcome: s && s.outcome ? s.outcome.id : null };
        });
      }).then(null, function (e) {
        if (e && e.code === 'NO_MOVE') return { ok: false, reason: T('服务端说这些方向推不动，这一步走不了') };
        return { ok: false, reason: T('服务端算不出这一步：') + ((e && e.message) || e) };
      });
    }

    /** 当前是不是冷液体宇宙（NO_STARS + ocean 变体）。和 solved() 并列，互不影响 */
    function isOcean() { return oceanHit(current().sim); }

    /** 问服务端「下一格该推谁」。爬山要靠生存半径，本地没有，只能问 */
    function suggest() {
      busy++;
      var r = chain.then(function () {
        return ask(compactOps(ops), true).then(function (res) { return res.suggest || null; });
      }).then(function (v) { busy--; return v; }, function (e) { busy--; throw e; });
      chain = r.then(null, function () { });
      return r;
    }

    /* 撤销和重置全在本地：trail 里存的是服务端算过的状态，退回去不用再问一次。
       （而且"重放一遍 ops"会因为夹边界而对不上，这一点从第一版起就没变。） */
    function undo() {
      if (trail.length <= 1) return false;
      trail.pop(); ops = ops.slice(0, -1);
      return true;
    }

    function reset() {
      trail.length = 1; ops = [];
    }

    /** 相对原始哈希态推了几格（负数是往下推）——玩家要看的是"我动了多少"，不是 unit 距离 */
    function offsetOf(key) {
      var n = 0, i;
      for (i = 0; i < ops.length; i++) {
        if (ops[i].key === key) n += ops[i].dir * (ops[i].steps == null ? 1 : ops[i].steps);
      }
      return n;
    }

    function moved(key) { return current().params[key] !== origin[key]; }

    function solved() {
      var s = current().sim;
      return !!(s && s.outcome && s.outcome.id === 'OBSERVERS_POSSIBLE');
    }

    return {
      modules: modules, keys: keys, origin: origin,
      current: current, previous: previous,
      push: push, probe: probe, undo: undo, reset: reset, suggest: suggest,
      /* 第一段玩法（维度）的三个入口。dimPlan 是纯本地的（不联网、不花钱），
         所以每次重画都能问它"还差多少维"；quoteDimension 走服务端拿报价（不落痕迹）；
         solveDimension 才真的把这一步推下去。 */
      dimPlan: dimPlan, quoteDimension: quoteDimension, solveDimension: solveDimension,
      /* 目标二（冷液体宇宙）的三个入口，形状与上面那三个一一对应。
         solved() 一个字没改：救活仍然只认 OBSERVERS_POSSIBLE，这条是并列的另一个终点。 */
      oceanPlan: oceanPlan, oceanPlanAsync: oceanPlanAsync, quoteOcean: quoteOcean,
      solveOcean: solveOcean, solveOceanMove: solveOceanMove, isOcean: isOcean,
      offsetOf: offsetOf, moved: moved, solved: solved,
      /* 「推了几格」是总格数，不是操作次数：一键推维度可能一次就是 261 格，
         把它显示成"推了 1 格"是在骗人（真烧的钱是按位移算的）。
         moves() 才是操作次数 —— 撤销一次退掉的是一次操作。 */
      steps: function () {
        var n = 0, i;
        for (i = 0; i < ops.length; i++) n += (ops[i].steps == null ? 1 : ops[i].steps);
        return n;
      },
      moves: function () { return ops.length; },
      ops: function () { return compactOps(ops); },
      busy: function () { return busy > 0; },
      /* 费用只有服务端算得了。沙盒里它只是"要是真烧会花多少"，
         所以直接把服务端那个数原样显示，不再本地编一条成本曲线 —— 编的那条
         迟早会和真正收的钱对不上，而对不上的时候玩家已经烧完币了。 */
      costBang: function () { return current().costBang || '0'; },
      /* 上链时要传给合约 intervene(id, cardHash, outcome, rarity, cost, deadline, **ops**, sig)
         的那段字节。它是这次干预**唯一会进区块的位移记录**：服务端和它的存档哪天没了，
         任何人还能拿 blockHash + 这段字节把参数算回来（server/intervene.js 的 applyOpsHex）。
         所以它必须原样转发 —— 客户端既不能重编也不能补齐，签名盖的是服务端发来的那一份。 */
      opsHex: function () { return current().opsHex || null; },
      params: function () { return clone(current().params); },
      sim: function () { return current().sim; }
    };
  }

  /* ============================================================ 结构性死亡：这个宇宙救不活

     有一类死宇宙不是"差几格"，而是死因根本不在余量上。让新手对着推不动的旋钮
     试上二十下，比直接告诉他"这个救不活"要伤人得多。

     判定必须**保守**：漏判（当成能救、玩家推着推着发现不行）只是浪费几分钟；
     误判（把能救的说成救不活）等于把谜题直接剧透成"别玩了"，那是毁玩法的。
     所以这里只收那些实测跑不出反例的条件：

       ① D ≠ 3 —— 最硬的一条：维数按 0.1 一档取整，一格连一档都够不着，
          那颗旋钮物理上就是死的，推别的参数只是在给尸体调妆。
       ② 结局是 UNSTABLE_ORBITS / BEYOND_MODEL_DIM —— 这两个结局本身就是维数判据给的。

     **BLACK_HOLE_DOMINATED 刻意不收**，哪怕 v3 §2 把它列在"救不活"那一栏：
     那张表上它只有 1 个样本。重扫 4000 个哈希拿到 45 个黑洞主导的宇宙，贪心救活了 3 个
     （把 A_s 推下去就翻过来了）。收了它就会误伤这 3 个，正是最不能犯的那种错。

     实测（4000 个哈希 / 923 个死宇宙）：本规则判死 143 个，其中被贪心（60 步上限）
     救活的 **0 个**；UNSTABLE_ORBITS 的 113 个样本里 D==3 的有 0 个，所以第 ② 条
     其实被第 ① 条盖住了 —— 留着它只是不想赌"以后也一直如此"。

     返回 null = 没有把握说它救不活，一律按"能救"走。 */
  var DOOM_OUTCOMES = { UNSTABLE_ORBITS: 1, BEYOND_MODEL_DIM: 1 };

  /* 这句原来讲的是「救不活的宇宙产稀有资源（反常 A / 奇点 K）」，依据是 v3。
     **资源那套已经被 BANG 代币取代**，合约里一个字都没有了，
     可这句文案留在了干预面板上，等于向用户描述一个不存在的机制。
     换成 v4 下真实成立的说法：按 §4「币烧在哪」，拯救的销毁通路属于**救得活的死宇宙**；
     天生活着的 S 档反而没有出口（§4.2，已知且未修）。
     2026-08-21 又改了一遍措辞：上一版写成「只有救不活的宇宙才有销毁通路」——
     恰好把事实说反，而且这句话就摆在「这个宇宙救不活」的判词底下。 */
  /* ARCBANG：拯救系统整套下线，这个站上没有销毁通路，也没有「哪种宇宙才有出口」的问题。
     沙盒在这里就是沙盒：推得动就推，推完不上链。整句换掉，不留半个拯救的词。 */
  var MINE_LINE = ARC
    ? '<b>这是沙盒</b> —— 推参数不花钱、不上链，推出来的宇宙也不能铸。想收下一个区块，回起爆页铸它的原始宇宙。'
    : '<b>拯救的销毁通路只开在救得活的死宇宙上</b> —— 烧 BANG 把参数推回可能诞生观察者的那一侧，烧掉的量永久记在链上（burnedOn）。天生就活着的宇宙没有这条路，这一枚也没有：换一个救得活的去烧。';

  /**
   * 拿当前状态判「救不活」。sim 与 params 必须是同一份状态。
   * 返回 null 或 { id, title, why }。
   *
   * ------------------------------------------------------------
   * **2026-08-20 大改：D≠3 不再判死刑，它恰恰是第一步。**
   *
   * 原来这里第一条就是「D≠3 → 这个宇宙救不活，D 这颗旋钮推不动」。
   * 那句话在**弦气模块关掉**的时候是对的：那时 dimS 是直接输入的参数，
   * 一格的位移小到被取整吃掉，旋钮确实是死的。
   * 可服务端固定跑 MODULES_ON（弦气开），dimS 根本不在参数表里 ——
   * 维度是 stringGasT / n_w / κ **派生**出来的，而这三颗旋钮推得动。
   * D=3 的比例是 **100%**。
   *
   * 于是这条规则在真实配置下的效果，是对着 98% 的死宇宙说「别玩了」——
   * 正好把玩法说反，也正好是最该救的那批人被劝退。
   * 现在改成：只要三个弦气参数在场，维度就是**可推量**，一律不判死；
   * 只有 dimSolve() 真的解不出三维，才承认这是结构性死亡。
   * 旧那套判据只在弦气模块关掉（dimS 是直接输入）时才还成立，原样留着。
   *
   * @param plan sandbox.dimPlan() 的结果。给了就用它判"到底解不解得出三维"；
   *             不给（Node 自测里的老调用）就只按参数表是否含弦气参数来判。
   */
  function doomVerdict(sim, params, plan) {
    var oid = (sim && sim.outcome) ? sim.outcome.id : null;
    var i, hasSG = false;
    for (i = 0; i < DIM_KEYS.length; i++) if (params && params[DIM_KEYS[i]] != null) hasSG = true;

    if (hasSG) {
      /* 弦气开着：维度可推。有解 → 完全不是死局（那是第一步）；
         D 已经是 3 → 死因不在维度上，那是第二段博弈，也不是死局。 */
      if (plan) return null;
      var Dn = dimOf(sim);
      if (Dn == null || Math.abs(Dn - 3) < 1e-9) return null;
      /* 解不出三维。实测 379 个 D≠3 的死宇宙里一个都没落到这里 ——
         留着这条是因为「以后也一直如此」不该白赌。 */
      return {
        id: 'dim-hard',
        title: TN('这一个真的推不到三维 —— 它现在是 {n} 维。', Math.round(Dn * 10) / 10),
        why: T('弦气那三个参数在整个取值范围里扫过去，都没有一段能让空间恰好解开成三维。') +
          T('这在实测里极少见（379 个 D≠3 的死宇宙里一个都没有）。换一个宇宙吧。')
      };
    }

    /* ---- 以下是弦气模块**关掉**时的老判据：dimS 是直接输入，一格推不动它 ---- */
    var D = params ? params.dimS : null;
    if (typeof D === 'number' && isFinite(D) && Math.abs(D - 3) > 1e-9) {
      var d1 = Math.round(D * 10) / 10;
      return {
        id: 'dim',
        title: TN('这个宇宙救不活 —— 它的空间是 {n} 维，不是 3 维。', d1),
        why: T('核合成、恒星、化学的公式全都只在三维成立。') +
          (D > 3
            ? T('D≥4 时引力与库仑势按 r^−(D−1) 衰减，行星轨道和电子基态都没有稳定解；')
            : T('D≤2 的牛顿引力不再是吸引势，物质永远聚不成团；')) +
          T('而空间维数按 0.1 一档取整，一格连一档都够不着 —— ') +
          T('<b>D 这颗旋钮推不动</b>，其余 19 个推了也只是在给一具尸体调妆。')
      };
    }
    if (DOOM_OUTCOMES[oid]) {
      return {
        id: 'orbits',
        title: T('这个宇宙救不活 —— 它连稳定的轨道都没有。'),
        why: T('这是维数判据直接给出的结论：引力与库仑势的形状不对，行星绕不成圈、' +
          '电子也落不进壳层。这不是差几格余量，是几何本身的问题。')
      };
    }
    return null;
  }

  /* ============================================================ 收窄：诊断 → 候选参数
     diagnose() 是纯查表（不跑一次模拟），它按因果顺序告诉你哪几道门没过、每道门该动谁。
     新手模式显示的就是这几个，提示也只试这几个。

     为什么截到 4 个：诊断有时给出六七条门、十几个参数，全列出来等于没筛；
     而且 4 个参数 × 2 方向 = 8 次模拟，正好把提示从 40 次压到 8 次（快 5 倍）。
     H 从外面传进来而不是读全局：Node 里 root 是空对象，读全局就永远拿不到模块 C。 */
  function narrowKeys(H, sim, allKeys, cap) {
    if (!deps()) return null;
    if (!H || typeof H.diagnose !== 'function' || !sim) return null;
    var ds = [];
    try { ds = H.diagnose(sim) || []; } catch (e) { return null; }
    var lim = (typeof cap === 'number' && cap > 0) ? cap : 4;
    var seen = {}, out = [], i, j, ps;
    for (i = 0; i < ds.length && out.length < lim; i++) {
      ps = ds[i].params || [];
      for (j = 0; j < ps.length && out.length < lim; j++) {
        if (!seen[ps[j]] && (!allKeys || allKeys.indexOf(ps[j]) >= 0)) { seen[ps[j]] = 1; out.push(ps[j]); }
      }
      /* 第一条是维数类的根因就到此为止，不要再往下凑数。
         凑数会跨门去拿后面那些**连坐**门的参数：D=10.2 的宇宙上实测凑出的是
         δ_CKM / N_gen / Ω_b h²，跟"轨道不稳定"毫无关系 —— 界面于是一边说"该推 D"，
         一边把三个无关旋钮摆在最显眼的地方。宁可只给一个真参数，也不要凑满四个。 */
      if (i === 0 && /^(dims\.|outcome\.(UNSTABLE_ORBITS|BEYOND_MODEL_DIM))/.test(ds[0].gate || '')) break;
    }
    return out.length ? out : null;
  }

  /**
   * 收窄版「下一格该推谁」。
   * opts = { sim, allKeys, keys, cap, step } —— sim 必须与 params 对应（现成的别再算一遍）；
   * **step 必给**：那是「推一格」函数，它要用生存半径，所以只有服务端拿得出来
   * （server/intervene.js 的 suggestNext 就是这么调它的）。没有 step 一律返回 null。
   * 返回值形状与 MirrorHint.suggest() 一致，另加 tried（跑了几次模拟）与 narrowed（是否走的窄搜）。
   * 窄搜爬不动时退回全量 suggest：玩家要的是"下一格推哪"，慢一点也比没有强。
   */
  function fastSuggest(H, params, modules, opts) {
    if (!deps()) return null;
    if (!H || typeof H.step !== 'function' || typeof H.score !== 'function') return null;
    opts = opts || {};
    if (typeof opts.step !== 'function') return null;
    var ms = modules || MODULES_OFF;
    var sim = opts.sim || H.simulate(params, ms);
    var base = H.score(sim);
    /* 参数名从 MirrorParams 取。以前这里读的是本地那张半径表的键 ——
       表没了，而且参数名本来就印在界面上、也在 params.js 里发给了浏览器，它不是秘密。 */
    var allKeys = opts.allKeys || Params.paramsFor(ms).map(function (d) { return d.key; });
    var ks = opts.keys || narrowKeys(H, sim, allKeys, opts.cap);
    var tried = 0, best = null, i, d, np, nsim, sc;

    if (ks && ks.length) {
      for (i = 0; i < ks.length; i++) {
        for (d = -1; d <= 1; d += 2) {
          np = H.step(params, ks[i], d, ms, opts.step);
          if (!np) continue;
          nsim = H.simulate(np, ms);
          tried++;
          sc = H.score(nsim);
          // 与命令行版同判据：必须**严格**变好才算一步，否则会在平台上原地打转
          if (sc > base + 1e-9 && (!best || sc > best.score)) {
            best = {
              key: ks[i], dir: d, score: sc, gain: sc - base, params: np, sim: nsim,
              outcome: (nsim && nsim.outcome) ? nsim.outcome.id : null
            };
          }
        }
      }
    }
    if (best) { best.narrowed = true; best.tried = tried; return best; }

    var full = (typeof H.suggest === 'function') ? H.suggest(params, ms, opts.step) : null;
    if (full) { full.narrowed = false; full.tried = tried + allKeys.length * 2; }
    return full;
  }

  /** 这一步让哪几道门从"没过"变成"过了"。用 diagnose 的差集算，不额外跑模拟 */
  function fixedGates(H, before, after) {
    if (!H || typeof H.diagnose !== 'function') return [];
    var a = {}, out = [], i, db = [], da = [];
    try { db = H.diagnose(before) || []; da = H.diagnose(after) || []; } catch (e) { return []; }
    for (i = 0; i < da.length; i++) a[da[i].gate] = 1;
    for (i = 0; i < db.length; i++) if (!a[db[i].gate]) out.push(db[i].label || db[i].gate);
    return out;
  }

  /* ============================================================ 以下全是界面
     doc 为 null（Node 里 require 进来自测）时，下面一律不执行，open() 直接返回 false。 */

  var S = {
    open: false, el: null, box: null, meta: null, lastOutcome: null, saved: null, tipBusy: false,
    /* 模块 D 缺席时的兜底：状态只活在内存里，但"默认开、能切"这两条不能丢 */
    noviceMem: true,
    /* 参数表的复用状态：rows = key → 行节点，rowsBox 用来认出"换了一个宇宙要重建"；
       shown/shownWhy 是当前显示的行集，hover 为真时它被冻住（见 renderParams）；
       lastNode/prevGauge 是仪表增量箭头的基准（见 renderGauges）；doom 见 doomVerdict */
    rows: null, rowsBox: null, shown: null, shownWhy: null, hover: false,
    lastNode: null, prevGauge: null, doom: null,
    /* 玩法分段：'dim'（第一步推维度）/ 'tune'（第二步博弈）/ 'won' / 'doom'。
       plan = 本地解出来的三维方案，dimBusy = 一键那一下正在跑 */
    stage: null, plan: null, dimBusy: false,
    /* 目标（specs/highdim-v1.md §五）：'observers' = 推活（默认，老行为一字不改）
       'ocean' = 推成冷液体宇宙（结局仍是 NO_STARS + 引擎的 ocean 变体，**不是新结局**）。
       目标只影响主行动卡上多出来的那颗按钮；solved()、救活判定、铸造那几条路一个字没动。 */
    goal: 'observers', oceanBusy: false, oceanQuote: undefined, oceanQuoteAt: null,
    /* 自动推（目标下拉旁边那颗按钮）：on = 正在推、stop = 用户点了停（本拍结束收手）、
       n = 已经走了几步、goal = 开跑那一刻的目标（中途换目标就收手）、
       last = 最后一步的人话、why = 'stuck' 时按钮显示「推不动了」、whyAt = 那时候的格数
       （玩家一动手 whyAt 就对不上，按钮自动恢复成「自动推」）。 */
    auto: { on: false, stop: false, n: 0, goal: null, last: null, t0: 0, why: null, whyAt: 0,
            best: null, stall: 0, escapes: 0 },
    /* 假死看门狗要的现场（ui/app.js 的 wdSnapshot → sandbox 那一段）：
       busyAt = 当前那件重活是什么时候开跑的，lastStep = 最后推下去的那一步。 */
    busyAt: null, busyWhat: null, lastStep: null,
    /* 连点冻结：lastNudge = 上一次推格的时刻，thaw = 停手后补画那一次的定时器 */
    lastNudge: 0, thaw: null,
    /* 铸成造物：craftBusy = 三步流程（要签名 → 授权 → 铸）
       正在走；craftMsg = 那一行的状态话术（带 box/steps 快照，推格或换宇宙后自动失效）。
       craftBusy 刻意**不在 open() 里清零**：面板关了再开，链上那笔交易还在飞，
       清了它就能再点一次 —— 双击双铸。 */
    craftBusy: false, craftMsg: null,
    craftShare: null,      // 铸成那一刻的广播现场，BnbShare 消费
    /* 拯救这枚 NFT（MirrorUniverse.intervene）。规矩同上面那一组：
       rescueBusy 刻意**不在 open() 里清零** —— 面板关了再开，链上那笔还在飞，
       清了它就能再点一次，那是白烧第二遍币。
       own = 这个 blockHash 的链上身份（铸了没有 / 是谁的 / 参数章 / 已烧多少），
       按哈希缓存，见 rescueProbe；rescued = 本次会话里已经拯救过的哈希，见 renderRescue。 */
    rescueBusy: false, rescueMsg: null, own: null, ownBusy: false, rescued: {},
    /* 主按钮当前是哪条路。renderRescue 每帧算一次，
       rescueBtnGo 只照着分发 —— 一个按钮两条路，判断只能有一处，两处必然漂移。
       取值见 rescueMode()：'mint' = 铸下并拯救，'mine' = 拯救这枚 NFT，其余都不出按钮。 */
    rescueMode: null,
    /* 「铸下并拯救」跑到一半时，第 1 步（铸造）**已经落地**的证据。
       它存在 = 用户手上已经有 NFT 了，后面哪一步失败都不能说成"白花钱"
       （规格第 5 条：文案必须说「宇宙 #N 已经是你的了，但拯救没完成」）。
       每次点按钮时清零；只有回执 status=1 之后才写。 */
    mintDone: null
  };

  function $(id) { return doc.getElementById(id); }
  function OB() { return root.MirrorOnboard || null; }
  function now() {
    return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
  }

  /** 新手模式开关的唯一读法。状态归模块 D 管（它负责写 localStorage），这里只读 */
  function novice() {
    var o = OB();
    return o ? o.novice() : S.noviceMem;
  }
  function setNovice(on) {
    var o = OB();
    if (o) o.setNovice(on); else S.noviceMem = !!on;
  }

  /** 人话（符号）。模块 D 缺席就退回"名字（符号）"，绝不显示裸 key */
  function label(key) {
    var o = OB(), d = Params.byKey[key];
    /* 人话与参数名都是别的模块的文案（onboard.js → i18n-site.js、params.js → i18n-mirror.js），
       这里只负责让它们过一遍 T；没收进词典的照旧退回中文。 */
    if (o) return T(o.paramLabel(key, d ? d.symbol : key));
    return d ? TN('{n}（{m}）', T(d.name), d.symbol) : key;
  }
  function plainOnly(key) {
    var o = OB(), d = Params.byKey[key];
    return T((o && o.plain(key)) || (d ? d.name : key));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  /* wei（10¹⁸ 进制的十进制字符串）→ 整枚 BANG。
     用切字符串而不是 Number(wei)/1e18：费用是 BigInt 口径，转成双精度会在
     十几位以上悄悄丢精度，显示出来的数和链上真烧的对不上。 */
  function bangText(wei) {
    var s = String(wei == null ? '0' : wei).replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (!s || s === '0') return '0';          // 一格没推就是 0，不是"<1"
    if (s.length <= 18) return '<1';          // 不足一枚：显示 0 会让人以为免费
    return s.slice(0, s.length - 18).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var CSS = [
    /* ============================================================ 外观
       规范：白卡片浮在浅灰底上、极淡描边、柔和大范围阴影、
       克制的单一强调色（靛蓝 --cyan）。圆角与阴影一律走令牌
       （--radius-card / --radius-btn / --shadow-card / --shadow-pop），
       **一个颜色都不许写死** —— 令牌表在 web/tokens.css，三页共用，深浅两套都在那儿。 */
    /* 覆盖层：z-index 压在 about(90) 之上、导出框(9999) 之下 —— 干预是"当前在做的事"，
       但导出/确认框弹出来时应该盖住它 */
    /* align-items 是 flex-start 而不是 center：面板高度由内容决定，居中的话内容一变高度
       就变，面板整体上下浮动 —— 实测推到第 7 格救活时，"还差这 N 道门"的清单塌掉，
       面板缩了 42px，居中让它整体下移 21px，表格跟着走，光标底下的按钮就换了人。
       顶边钉死之后，内容只从下边增减，表格的位置全程不动。 */
    '.mi-box{position:fixed;inset:0;z-index:9600;background:var(--scrim);display:flex;',
    '  align-items:flex-start;justify-content:center;padding:18px;overflow:auto}',
    '.mi-box[hidden]{display:none}',
    /* 单栏、窄一点。原来是 1180px 双栏：左边 23 个参数、右边 26 道门 + 8 个仪表，
       第一眼撞上的是一张参数表，而不是"我现在该干什么"。 */
    '.mi-panel{width:min(760px,100%);max-height:min(92vh,940px);display:flex;flex-direction:column;',
    '  background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card);',
    '  box-shadow:var(--shadow-pop);color:var(--ink);overflow:hidden;font-family:var(--sans)}',
    '.mi-panel.won{border-color:var(--green-line)}',
    /* ---------- 顶部：结局 + 一句人话 */
    '.mi-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
    '  padding:14px var(--gap);border-bottom:1px solid var(--line-soft);background:var(--panel)}',
    '.mi-out{font-size:15px;font-weight:700;color:var(--ink);letter-spacing:.01em}',
    '.mi-out.good{color:var(--green)}',
    '.mi-out.bad{color:var(--bad)}',
    '.mi-say{font-size:12.5px;color:var(--dim);flex:1 1 260px;min-width:0;line-height:1.6}',
    '@keyframes mi-pop{from{transform:translateY(-2px);opacity:.4}to{transform:none;opacity:1}}',
    '.mi-pop{animation:mi-pop .28s ease-out}',
    /* 视图开关做成小胶囊，别再像个表单控件 */
    '.mi-mode{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dim);',
    '  padding:4px 10px;border:1px solid var(--line);border-radius:var(--radius-chip);',
    '  background:var(--panel2);cursor:pointer;white-space:nowrap}',
    '.mi-mode:hover{border-color:var(--cyan-line);color:var(--ink2)}',
    '.mi-mode input{margin:0;accent-color:var(--cyan)}',
    /* ---------- 正文 */
    '.mi-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:var(--gap);scrollbar-width:thin;',
    '  background:var(--void);display:flex;flex-direction:column;gap:12px}',
    /* **每张卡都必须 flex:0 0 auto**。flex 子项默认 flex-shrink:1 —— 内容一超过
       .mi-scroll 的高度，所有卡片就按比例一起被压扁，而不是让容器滚动。
       带 overflow:hidden 又没有内在最小高度的那张（.mi-more 参数表）会被压到 2px：
       实测收起状态下「全部参数」那一行整个消失，参数表根本点不开。
       禁掉收缩之后内容照常溢出，.mi-scroll 的 overflow:auto 接手滚动。 */
    '.mi-scroll>*{flex:0 0 auto}',
    /* 通用白卡片 */
    '.mi-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card);',
    '  box-shadow:var(--shadow-card);padding:14px var(--gap)}',
    '.mi-card[hidden]{display:none}',
    /* ---------- 主行动卡：整个面板的第一句话就是"我现在该干什么"
       第一步（推维度）有确定答案、100% 有解，所以它是一颗按钮 + 一个价签，
       不是让人去 23 个旋钮里试。第二步才把"卡在哪 / 建议推谁"摆出来。 */
    '.mi-act{background:var(--panel);border:1px solid var(--cyan-line);',
    '  border-radius:var(--radius-card);box-shadow:var(--shadow-card);padding:16px var(--gap);',
    '  border-left:3px solid var(--cyan)}',
    '.mi-act[hidden]{display:none}',
    '.mi-act.step2{border-left-color:var(--amber);border-color:var(--amber-line)}',
    '.mi-act-k{font-size:10.5px;letter-spacing:.16em;color:var(--dim2);text-transform:uppercase;',
    '  font-family:var(--mono);margin-bottom:6px}',
    '.mi-act-t{font-size:16px;font-weight:700;color:var(--ink);line-height:1.5}',
    '.mi-act-t b{color:var(--cyan)}',
    '.mi-act.step2 .mi-act-t b{color:var(--amber)}',
    '.mi-act-w{margin-top:6px;font-size:12.5px;line-height:1.75;color:var(--ink3)}',
    '.mi-act-w b{color:var(--ink2);font-weight:600}',
    '.mi-act-b{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}',
    /* 主按钮：整站唯一的主色实心块 */
    '.mi-cta{border:0;background:var(--cyan);color:var(--on-red);font-family:var(--sans);',
    '  font-size:13.5px;font-weight:700;padding:10px 18px;border-radius:var(--radius-btn);',
    '  cursor:pointer;min-height:40px;box-shadow:var(--shadow-card);letter-spacing:.02em}',
    '.mi-cta:hover:not(:disabled){filter:brightness(1.08)}',
    '.mi-cta:disabled{opacity:.45;cursor:default;box-shadow:none}',
    '.mi-cta:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    '.mi-cta[hidden]{display:none}',
    /* 价签：明码标价就摆在按钮边上 */
    '.mi-price{font-family:var(--mono);font-size:12px;color:var(--ink3);line-height:1.6}',
    '.mi-price b{color:var(--ink);font-size:13px}',
    '.mi-price i{font-style:normal;color:var(--dim2)}',
    /* ---------- 赢了 */
    '.mi-win{background:var(--green-bg);border:1px solid var(--green-line);',
    '  border-radius:var(--radius-card);padding:16px var(--gap);box-shadow:var(--shadow-card)}',
    '.mi-win[hidden]{display:none}',
    '.mi-win-t{font-size:17px;font-weight:700;color:var(--green);line-height:1.4}',
    '.mi-win-w{margin-top:6px;font-size:12.5px;line-height:1.7;color:var(--ink2)}',
    '.mi-win-w b{font-family:var(--mono);color:var(--ink)}',
    /* ---------- 真·结构性死亡（现在极少见） */
    '.mi-doom{background:var(--red-bg);border:1px solid var(--red-line);',
    '  border-radius:var(--radius-card);padding:14px var(--gap);box-shadow:var(--shadow-card);',
    '  font-size:12.5px;line-height:1.75;color:var(--ink2)}',
    '.mi-doom[hidden]{display:none}',
    '.mi-doom-t{display:block;font-size:14px;font-weight:700;color:var(--bad);margin-bottom:5px}',
    '.mi-mine{display:block;margin-top:8px;padding-top:8px;border-top:1px solid var(--red-line);',
    '  font-size:12px;color:var(--ink3);line-height:1.7}',
    /* ---------- 卡在哪（第二段才出现） */
    '.mi-stuck{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--amber);',
    '  border-radius:var(--radius-card);box-shadow:var(--shadow-card);padding:12px var(--gap);',
    '  font-size:12.5px;line-height:1.75;color:var(--ink2)}',
    '.mi-stuck[hidden]{display:none}',
    '.mi-stuck b{color:var(--amber)}',
    '.mi-stuck .mi-why{display:block;margin-top:4px;font-size:11.5px;color:var(--dim);line-height:1.7}',
    '.mi-stuck.ok{border-left-color:var(--green)}',
    '.mi-stuck.ok b{color:var(--green)}',
    /* ---------- 仪表盘 */
    '.mi-gwrap{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card);',
    '  box-shadow:var(--shadow-card);padding:12px var(--gap)}',
    '.mi-sec{font-size:10.5px;letter-spacing:.16em;color:var(--dim2);font-family:var(--mono);',
    '  text-transform:uppercase;margin-bottom:8px}',
    '.mi-sec i{font-style:normal;color:var(--dim3);letter-spacing:0;text-transform:none;',
    '  font-family:var(--sans)}',
    '.mi-legend{margin:0 0 8px;font-size:11.5px;line-height:1.75;color:var(--dim)}',
    '.mi-legend[hidden]{display:none}',
    '.mi-legend b{color:var(--ink2);font-weight:600}',
    /* ---------- 参数表：默认收起 */
    '.mi-more{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card);',
    '  box-shadow:var(--shadow-card);overflow:hidden}',
    /* **summary 上不许写 display:flex**。写了之后 Chrome 不再把它当作 details 的
       披露标题，details 自己的高度塌成 1.6px，而 .mi-more 上的 overflow:hidden
       正好把这行标题裁掉 —— 实测：收起状态下「全部参数」那一行整个看不见，
       参数表根本点不开。布局要用 flex 就套一层 span（.mi-more-h）在里面做。 */
    '.mi-more>summary{list-style:none;cursor:pointer;padding:12px var(--gap);font-size:12.5px;',
    '  color:var(--ink2);user-select:none}',
    '.mi-more>summary::-webkit-details-marker{display:none}',
    '.mi-more>summary:hover{background:var(--sel)}',
    '.mi-more-h{display:flex;align-items:center;gap:8px}',
    '.mi-more-h::before{content:"\\25B8";color:var(--dim2);font-size:11px;',
    '  display:inline-block;transition:transform .15s}',
    '.mi-more[open] .mi-more-h::before{transform:rotate(90deg)}',
    '.mi-more-h b{color:var(--ink);font-weight:600}',
    '.mi-more-h i{font-style:normal;color:var(--dim2);font-size:11.5px;margin-left:auto;',
    '  text-align:right;min-width:0}',
    '.mi-more-in{padding:0 var(--gap) 14px}',
    /* table-layout:fixed + colgroup 是**必须**的，不是讲究：自动布局下，玩家推第一格时
       "原始"那一列从空变成有字，列宽整体重排，长参数名多折一行、行高一变，
       按钮就从光标底下溜走了。实测就是这么丢掉第 2 到第 10 下的。
       列宽写死之后，任何一格的值怎么变，表格的几何都不动。 */
    '.mi-tbl{width:100%;border-collapse:collapse;font-size:12px;font-family:var(--mono);',
    '  table-layout:fixed}',
    '.mi-tbl col.c-plain{width:auto}',
    '.mi-tbl col.c-val{width:33%}',
    /* c-act 必须装得下两颗按钮：2×26px + 2×2px 外边距 + td 的左右各 6px = 68px。
       原来这里写的是 56px，而按钮实际要 58px —— fixed 布局下列宽由 colgroup 说了算
       （td 上的 width:1% 会被忽略），td 又带 overflow:hidden;text-overflow:ellipsis，
       于是第二颗按钮（+）被裁掉、渲染成一个省略号，用户看到的是「− …」。
       **修法是把这一列加宽，不是拿掉 table-layout:fixed** —— 上面那段注释说了它为什么必须在。
       给到 84px 留足余量，并且下面单独给 td.mi-act 开 overflow:visible 兜底。 */
    '.mi-tbl col.c-act{width:84px}',
    /* c-off 同理复核过：内容最长是「+1249 格」= 8 个等宽字符 ≈ 53px + 12px 内边距 = 65px，
       原来的 50px 一样会截。给到 80px。 */
    '.mi-tbl col.c-off{width:80px}',
    '.mi-tbl td{padding:5px 6px;border-bottom:1px solid var(--line-faint);white-space:nowrap;',
    '  overflow:hidden;text-overflow:ellipsis;vertical-align:middle}',
    '.mi-tbl tr:last-child td{border-bottom:0}',
    '.mi-tbl .mi-h td{color:var(--dim2);border-bottom:1px solid var(--line);font-size:10.5px;',
    '  letter-spacing:.1em;padding-bottom:7px}',
    /* 人话在第一列、符号跟在后面 —— 新手读第一眼不该撞上 ξ 和 Ω_b h² */
    '.mi-tbl td.plain{color:var(--ink2);white-space:normal;font-family:var(--sans);font-size:12px;',
    '  line-height:1.5}',
    '.mi-tbl td.plain i{font-style:normal;color:var(--dim2);font-family:var(--mono);font-size:11px}',
    '.mi-tbl td.val{text-align:right;color:var(--ink)}',
    '.mi-tbl td.val u{display:block;text-decoration:none;color:var(--dim3);font-size:10.5px}',
    /* 这一列的类名必须带 mi- 前缀：宿主页（index.html）自己定义了一条裸 .act
       —— display:flex;flex-direction:column;min-height:74px —— 我们的 <td class="act">
       会照单全收，结果 − 和 + 上下叠成两行、每行撑到 74px 高。实测踩到过。 */
    '.mi-tbl td.mi-act{text-align:center;white-space:nowrap;overflow:visible}',
    '.mi-tbl td.off{text-align:right;color:var(--dim3);font-size:10.5px}',
    '.mi-tbl tr.moved td.val{color:var(--diff);font-weight:700}',
    '.mi-tbl tr.moved td.off{color:var(--diff)}',
    '.mi-tbl tr.moved{background:var(--diff-bg)}',
    /* 和当前卡住那道门相关的参数：这几行才是现在该看的，其余的只是"也在这儿" */
    '.mi-tbl tr.rel td.plain{color:var(--ink);font-weight:600}',
    '.mi-tbl tr.rel td.plain::before{content:"";display:inline-block;width:4px;height:4px;',
    '  border-radius:50%;background:var(--cyan);margin-right:6px;vertical-align:middle}',
    '.mi-tbl tr.dimmed td{opacity:.5}',
    /* display 写死 inline-block：同上，宿主页把这颗按钮的祖先弄成 flex 时它会被 blockify */
    '.mi-nudge{display:inline-block;width:26px;height:26px;padding:0;margin:0 2px;',
    '  border:1px solid var(--line2);border-radius:var(--radius-btn);vertical-align:middle;',
    '  background:var(--panel);color:var(--ink2);font-size:14px;line-height:1;cursor:pointer;',
    '  font-family:var(--mono)}',
    '.mi-nudge:hover{border-color:var(--cyan);color:var(--cyan);background:var(--sel2)}',
    '.mi-nudge:focus-visible{outline:2px solid var(--focus);outline-offset:1px}',
    /* 推不动的方向（取整参数，或已经顶到边界）标灰但**不禁用**：
       禁用了点不动也就没有解释，玩家只会以为界面坏了。点得动才能把原因说给他听。 */
    '.mi-nudge.dead{opacity:.35;border-style:dashed}',
    '.mi-nudge.dead:hover{border-color:var(--amber);color:var(--amber);background:var(--amber-bg)}',
    '.mi-msg{margin-top:10px;font-size:11.5px;line-height:1.7;color:var(--dim);min-height:1.6em}',
    /* 「推不动」的解释必须自己抢眼：它出现的那一刻，玩家刚点了一下、屏幕上什么都没发生，
       这时候一行灰色小字混在表格底下等于没说。给它边框、底色和一下入场动画。 */
    '.mi-msg.warn{color:var(--amber);font-size:12.5px;padding:9px 12px;',
    '  border:1px solid var(--amber-line);border-radius:var(--radius-btn);background:var(--amber-bg);',
    '  animation:mi-pop .28s ease-out}',
    /* ---------- 详细提示 */
    '.mi-tip{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card);',
    '  box-shadow:var(--shadow-card);padding:14px var(--gap);font-size:12.5px;line-height:1.75;',
    '  color:var(--ink2)}',
    '.mi-tip[hidden]{display:none}',
    '.mi-tip ul{margin:6px 0 0;padding-left:18px}',
    '.mi-tip li{margin-bottom:6px}',
    '.mi-tip b{color:var(--ink)}',
    '.mi-tip i{font-style:normal;color:var(--cyan)}',
    /* ---------- 脚注与底栏 */
    '.mi-meta{font-size:11.5px;color:var(--dim);line-height:1.8;font-family:var(--mono)}',
    '.mi-meta b{color:var(--ink2)}',
    '.mi-meta i{font-style:normal;color:var(--dim2)}',
    '.mi-id{font-size:11px;color:var(--dim2);font-family:var(--mono);line-height:1.7}',
    /* ---------- 铸成造物。挂在底部信息卡里，
       和「真烧要 X BANG」那行做邻居 —— 它花的就是那个数。 */
    '.mi-craft{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:9px;',
    '  padding-top:9px;border-top:1px dashed var(--line-soft)}',
    '.mi-craft[hidden]{display:none}',
    /* ---------- 两条出口并排（2026-08-21 加）：左「拯救这枚 NFT」右「铸成造物」。
       为什么非得并排、而且各带一句说明：这两条路走的是两个合约、两套经济
       （拯救全烧、改写你已有的那枚；造物 20% 烧、铸一枚新的），
       而用户就是被"两颗长得一样的按钮"搞混的 —— 他手上原生 NFT 的 burnedOn 一直是 0，
       以为拯救坏了，其实站点上**根本没有**这条出口。代价必须写在按钮旁边。 */
    '.mi-two{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;margin-top:9px;',
    '  padding-top:9px;border-top:1px dashed var(--line-soft)}',
    '.mi-two[hidden]{display:none}',
    /* 套进 .mi-two 的那两列：横排改纵排（按钮在上、代价在下），
       上面那条虚线归 .mi-two 画，列里不再各画一条 */
    '.mi-two>.mi-craft{flex:1 1 250px;min-width:0;flex-direction:column;align-items:flex-start;',
    '  gap:6px;margin-top:0;padding-top:0;border-top:0}',
    /* ---------- 一条主路 + 一条备选
       两条出口不再平级：左边那一列是**主路**（拯救 / 铸下并拯救），占更多宽度；
       「铸成造物」是第二条产品线，退成次级，不该和主路抢注意力。 */
    '.mi-two>#miRescue{flex:2 1 320px}',
    '.mi-two>#miCraft{flex:1 1 230px}',
    /* 主按钮：实心，和次级那颗（描边）一眼分得开 */
    '.mi-btn.pri{background:var(--cyan);border-color:var(--cyan);color:var(--on-cyan);',
    '  font-size:12.5px;font-weight:600;padding:9px 16px;min-height:38px}',
    '.mi-btn.pri:hover:not(:disabled){background:var(--cyan);border-color:var(--cyan);',
    '  color:var(--on-cyan);filter:brightness(1.08)}',
    '.mi-craftp{font-size:11.5px;color:var(--dim);line-height:1.7;font-family:var(--mono)}',
    '.mi-craftp b{color:var(--ink2)}',
    '.mi-craftp i{font-style:normal;color:var(--dim2)}',
    '.mi-craftp.warn{color:var(--amber)}',
    '.mi-craftp.ok{color:var(--green)}',
    '.mi-craftp a{color:var(--cyan)}',
    '.mi-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px var(--gap);',
    '  border-top:1px solid var(--line-soft);background:var(--panel)}',
    '.mi-btn{background:var(--panel);border:1px solid var(--line2);color:var(--ink2);',
    '  font-family:var(--sans);font-size:12px;padding:7px 13px;border-radius:var(--radius-btn);',
    '  cursor:pointer;min-height:34px}',
    '.mi-btn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan);background:var(--sel2)}',
    '.mi-btn:disabled{opacity:.4;cursor:default}',
    '.mi-btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    '.mi-btn.alt{border-color:var(--green-line);color:var(--green);background:var(--green-bg)}',
    '.mi-btn.alt:hover:not(:disabled){border-color:var(--green);color:var(--green)}',
    '.mi-note{font-size:11px;color:var(--dim2);margin-left:auto;line-height:1.6}',
    '.mi-none{color:var(--dim);font-size:12px;line-height:1.7}',
    /* 转圈 */
    '@keyframes mi-spin{to{transform:rotate(360deg)}}',
    '.mi-spin{display:inline-block;width:11px;height:11px;margin-right:6px;vertical-align:-1px;',
    '  border:2px solid var(--line2);border-top-color:var(--cyan);border-radius:50%;',
    '  animation:mi-spin .7s linear infinite}',
    /* ---------- 窄屏：375px 要能用
       「推了几格」那一列在窄屏上让位 —— 它是参考信息，名字和按钮才是必需的。 */
    '@media (max-width:520px){',
    '  .mi-box{padding:0}',
    '  .mi-panel{width:100%;max-height:100vh;border-radius:0;border:0}',
    '  .mi-scroll{padding:12px;gap:10px}',
    '  .mi-card,.mi-act,.mi-win,.mi-doom,.mi-stuck,.mi-gwrap,.mi-tip{padding:12px}',
    '  .mi-more>summary,.mi-more-in{padding-left:12px;padding-right:12px}',
    '  .mi-tbl col.c-off,.mi-tbl td.off{display:none}',
    '  .mi-tbl col.c-val{width:38%}',
    '  .mi-act-t{font-size:15px}',
    '  .mi-cta{width:100%}',
    '  .mi-note{margin-left:0;flex:1 1 100%}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    '  .mi-pop,.mi-msg.warn{animation:none}',
    '  .mi-spin{animation-duration:2s}',
    '}'
  ].join('\n');

  /* 骨架是拼出来的，i18n 的 DOM 遍历兜不住它（它遍历的是已经在页面上的文本节点，
     而这块是 open() 时才现拼进来的），所以每一句都得自己过 T。
     写成函数而不是常量：面板要到第一次 open 才建，那时候语言可能已经切过了。 */
  /* 骨架的顺序**就是**回答问题的顺序：
       ① 这是什么（结局 + 一句人话）
       ② 我现在该干什么（#miAct —— 第一步一颗按钮，第二步才是提示 + 建议）
       ③ 还差什么（#miStuck 只说当前卡住的那道门；#miGauges 只列没过的门）
       ④ 细节（参数表，默认收起）
     原来的顺序是反的：一进来先撞上 23 个参数 × 每个两颗按钮 + 26 道门 + 8 个仪表。

     **所有已有的 id 一个都没改名、没删**：
     miOut / miSay / miModeBox / miMode / miModeTxt / miX / miWin / miParamSec / miDoom /
     miStuck / miParams / miMsg / miMeta / miId / miLegend / miGauges / miTip /
     miAuto / miUndo / miReset / miHint / miClose 全在，绑定关系也没动。
     新增的是 miAct / miActK / miActT / miActW / miActP / miDim / miMoreSum，
     以及造物入口的 miCraft / miCraftBtn / miCraftP—— 只增不改。

     #miAuto 从底栏搬进了主行动卡（它是第二步的主动作），**节点本身没有重建**，
     所以 ensureEl 里那句 addEventListener 仍然挂在同一个元素上。 */
  function panelHTML() {
    return [
      /* ARCBANG：拯救下线之后「干预」这个词跟着退场，沙盒在 arc 站叫「调参沙盒」 */
      '<div class="mi-panel" id="miPanel" role="dialog" aria-modal="true" aria-label="' + esc(T(ARC ? '调参沙盒' : '干预沙盒')) + '">',
      '  <div class="mi-head">',
      '    <span class="mi-out" id="miOut">—</span>',
      '    <span class="mi-say" id="miSay"></span>',
      /* 「用这组参数引爆」放在顶栏（2026-09-18 用户：「引爆窗口不要挪到下面啊」）——
         引爆是这个面板的出口，得在一打开就看得见的地方，不能压在滚动区下面的工具条里。
         救没救活都给；救活了的时候藏起来：那一刻庆祝卡上已经有一颗同样的（renderWin）。 */
      '    <button type="button" class="mi-btn alt" id="miBangGo" hidden></button>',
      '    <label class="mi-mode" id="miModeBox" title="' + esc(T('简明视图：只显示当前卡住的门和相关参数')) + '">',
      '      <input type="checkbox" id="miMode"><span id="miModeTxt">' + esc(T('简明视图')) + '</span></label>',
      '    <button type="button" class="mi-btn" id="miX" title="' + esc(T('Esc 也可以关')) + '">' + esc(T('关闭')) + '</button>',
      '  </div>',
      '  <div class="mi-scroll">',
      '    <div class="mi-win" id="miWin" hidden></div>',
      '    <div class="mi-doom" id="miDoom" hidden></div>',
      /* 主行动卡。文字节点（miActT/miActW/miActP）每次重画，
         两颗按钮（miDim/miAuto）是常驻节点，只切显隐和文字 —— 重建会把事件绑定弄丢。 */
      '    <div class="mi-act" id="miAct" hidden>',
      '      <div class="mi-act-k" id="miActK"></div>',
      '      <div class="mi-act-t" id="miActT"></div>',
      '      <div class="mi-act-w" id="miActW"></div>',
      '      <div class="mi-act-b">',
      '        <button type="button" class="mi-cta" id="miDim" hidden></button>',
      '        <button type="button" class="mi-cta" id="miAuto" hidden></button>',
      /* 目标二的主动作。和 miDim/miAuto 一样是常驻节点，只切显隐和文字 */
      '        <button type="button" class="mi-cta" id="miOcean" hidden></button>',
      '        <span class="mi-price" id="miActP"></span>',
      '      </div>',
      '    </div>',
      '    <div class="mi-stuck" id="miStuck" hidden></div>',
      '    <div class="mi-gwrap">',
      '      <div class="mi-sec">' + esc(T('还差什么')) +
        ' <i>' + esc(T('（结局标签不动的时候，动的是这些）')) + '</i></div>',
      '      <div class="mi-legend" id="miLegend" hidden></div>',
      '      <div id="miGauges"></div>',
      '    </div>',
      '    <div class="mi-tip" id="miTip" hidden></div>',
      /* 参数表默认收起。<details> 的开合是浏览器原生的，不用自己写状态 */
      '    <details class="mi-more" id="miMore">',
      /* 里面套一层 .mi-more-h 才做 flex：summary 自己不能是 flex（见 CSS 里那段） */
      '      <summary id="miMoreSum"><span class="mi-more-h"><b>' + esc(T('全部参数')) + '</b>' +
        '<i id="miParamSec">' + esc(T('（点开手动微调）')) + '</i></span></summary>',
      '      <div class="mi-more-in">',
      '        <div id="miParams"></div>',
      '      </div>',
      '    </details>',
      /* #miMsg 必须在 <details> **外面**：它装的是「这一格推不动」这类解释，
         而那句话出现的时候玩家刚点了一下、屏幕上什么都没发生。
         把它关进折叠区里等于没说 —— 参数表默认是收起的。 */
      '    <div class="mi-msg" id="miMsg"></div>',
      '    <div class="mi-card">',
      '      <div class="mi-meta" id="miMeta"></div>',
      /* 铸成造物。原来这里的口径是「干预后的宇宙不能铸」——
         现在能了：铸进独立的造物合约（MirrorCrafted）。常驻节点，render 只切显隐和文字；
         未部署（CONFIG.crafted 空）或一格没推时整行 hidden（见 renderCraft）。 */
      /* 两条出口并排。**#miCraft / #miCraftBtn / #miCraftP 三个 id 一个没改**，
         只是被套进了 #miTwo 里 —— renderCraft 那几行 getElementById 一个字都不用动。
         新增的是 #miTwo / #miRescue / #miRescueBtn / #miRescueP，只增不改。
         #miRescueBtn 默认 hidden：只有确认「这条主路对你开着」之后才露面
         （见 renderRescue），别的情况下那一格只留一句说明。

         2026-08-21：两颗按钮不再平级。
         #miRescueBtn 是**主按钮**（class 带 pri，实心）—— 它的文字随「你和这个宇宙的关系」
         在「拯救这枚 NFT」和「铸下并拯救」之间切；#miCraftBtn 退成次级（普通描边），
         因为造物是第二条产品线，不该和主路抢注意力。 */
      '      <div class="mi-two" id="miTwo" hidden>',
      '        <div class="mi-craft" id="miRescue" hidden>',
      '          <button type="button" class="mi-btn pri" id="miRescueBtn" hidden></button>',
      '          <span class="mi-craftp" id="miRescueP"></span>',
      '        </div>',
      '        <div class="mi-craft" id="miCraft" hidden>',
      '          <button type="button" class="mi-btn" id="miCraftBtn"></button>',
      '          <span class="mi-craftp" id="miCraftP"></span>',
      '        </div>',
      '      </div>',
      '      <div class="mi-id" id="miId"></div>',
      '    </div>',
      '  </div>',
      '  <div class="mi-foot">',
      '    <button type="button" class="mi-btn" id="miUndo">' + esc(T('撤销一步')) + '</button>',
      '    <button type="button" class="mi-btn" id="miReset">' + esc(T('全部重置')) + '</button>',
      '    <button type="button" class="mi-btn" id="miHint">' + esc(T('看详细提示')) + '</button>',
      /* 目标选择。默认还是「推活」—— 换目标只换主行动卡上那颗按钮，不动救活判定 */
      '    <label class="mi-mode" id="miGoalBox" title="' + esc(T('换一个终点：把这个宇宙推成什么样')) + '">',
      '      <span>' + esc(T('目标')) + '</span>',
      '      <select id="miGoalSel">',
      '        <option value="observers">' + esc(T('可能诞生观察者')) + '</option>',
      '        <option value="ocean">' + esc(T('冷液体宇宙')) + '</option>',
      '      </select></label>',
      /* 「自动推」。选了目标就该能自动往目标推，而不是只给提示让人一格一格点。
         三态（自动推 / 停 / 推不动了）全在 renderAutoGo 里判，这里只留一个常驻节点。 */
      '    <button type="button" class="mi-btn" id="miAutoGo"></button>',
      '    <span class="mi-note">' + esc(T('沙盒：随便推、不花钱、不上链；关掉之后原宇宙不受影响')) + '</span>',
      '    <button type="button" class="mi-btn" id="miClose">' + esc(T('关闭')) + '</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ---------------------------------------------------------- 挂载 */
  function ensureEl() {
    if (S.el && S.el.parentNode) return S.el;
    if (!doc.getElementById('miStyle')) {
      var style = doc.createElement('style');
      style.id = 'miStyle';
      style.textContent = CSS;
      doc.head.appendChild(style);
    }
    var box = doc.createElement('div');
    box.className = 'mi-box';
    box.id = 'miBox';
    box.innerHTML = panelHTML();
    doc.body.appendChild(box);
    S.el = box;

    // 按钮用事件委托绑一次，省得 40 个监听各挂各的
    $('miParams').addEventListener('click', onNudgeClick);
    /* 指针在表格里就锁住行集（见 renderParams）。用 mouseenter/mouseleave 而不是
       mouseover/mouseout：后者在子节点之间移动时会来回触发，锁会一直抖。 */
    $('miParams').addEventListener('mouseenter', function () { S.hover = true; });
    $('miParams').addEventListener('mouseleave', function () { S.hover = false; render(); });
    $('miTip').addEventListener('click', onTipClick);
    $('miWin').addEventListener('click', onWinClick);
    $('miUndo').addEventListener('click', function () { act(S.box.undo() ? '' : T('已经在原始状态了，没有可撤销的')); });
    $('miReset').addEventListener('click', function () { S.box.reset(); act(T('已回到原始哈希态')); });
    $('miHint').addEventListener('click', askHint);
    $('miAuto').addEventListener('click', autoStep);
    // 第一步的主动作。新 id、新绑定，没有动任何已有的绑定关系
    $('miDim').addEventListener('click', pushDimension);
    // 目标二：换目标只重画，推那一步走 pushOcean（和 pushDimension 同一套骨架）
    $('miOcean').addEventListener('click', pushOcean);
    // 「自动推」：按当前目标一步一步推下去（三态见 renderAutoGo）
    $('miAutoGo').addEventListener('click', autoToggle);
    // 常驻的「用这组参数引爆」。和庆祝卡上那一颗走同一个 bang()，不另起一套
    $('miBangGo').addEventListener('click', bang);
    $('miGoalSel').addEventListener('change', function () {
      S.goal = $('miGoalSel').value === 'ocean' ? 'ocean' : 'observers';
      S.oceanQuote = undefined; S.oceanQuoteAt = null;
      /* 换目标先收手：自动推是按**开跑那一刻**的目标推的，目标变了这一串就不该接着走。
         「推不动了」也一起清掉 —— 那是上一个目标的结论。 */
      if (S.auto.on) S.auto.stop = true;
      S.auto.why = null;
      /* 这一拍**只换 UI**：冷液体宇宙的提示要跑 4000 多次模拟（实测 285–311 ms），
         在这里同步算就是一次肉眼可见的假死。act() 会把那张卡先画成「正在算提示…」，
         分片算完（oceanPlanWait）自己再重画一次。 */
      act(S.goal === 'ocean'
        ? T('目标换成「冷液体宇宙」：引力弱到气体不塌缩、没有恒星，但分子还在液态温区里。结局仍是「没有恒星的宇宙」，判据见分析面板的 R_OCEAN（启发式）。')
        : T('目标换回「可能诞生观察者」。'));
    });
    // 铸成造物。常驻节点只绑一次，render 只切显隐和文字
    $('miCraftBtn').addEventListener('click', craftMint);
    /* 主按钮。同样是常驻节点，只绑一次；显隐、文字和**点了走哪条路**都由
       renderRescue 决定（它把当前模式写进 S.rescueMode，这里只做分发）。 */
    $('miRescueBtn').addEventListener('click', rescueBtnGo);
    $('miMode').addEventListener('change', function () {
      // 开关状态由模块 D 写进 localStorage：下次打开沙盒还是这个模式
      setNovice($('miMode').checked);
      act($('miMode').checked
        ? T('简明视图：只列当前卡住的门，参数表只留相关的那几个')
        : TN('全部视图：{n} 道门和 {m} 个参数都摊开', gateCount(), nParams()));
    });
    $('miX').addEventListener('click', close);
    $('miClose').addEventListener('click', close);
    return box;
  }

  /* Esc 关闭。挂在 document 上而不是面板上：面板里点过按钮之后焦点在按钮上，
     挂面板会漏掉焦点跑到 body 的情况 */
  function onKey(e) {
    if (!S.open) return;
    if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); close(); }
  }

  /* ---------- 连点期间冻结布局

     光有"节点不重建"还不够。实测：连点十下"电磁力 +"，第 7 下把宇宙推活，
     顶上多出一条庆祝栏、"卡在哪"那块又从四行缩成两行，一涨一缩把表格整体挪了一行，
     第 8 下就落在了"强核力"上。**表格上方任何一块变高变矮，光标底下的按钮就换了参数。**

     所以在一串连点期间（指针还在表格里，且距上一次推格不到 FREEZE_MS），
     表格上方那几块一律不重画；仪表盘、步数、面板边框这些不影响表格位置的照常更新，
     反馈一点没少。手一移开、或者停手 FREEZE_MS 之后，补画一次全的。 */
  var FREEZE_MS = 450;
  function frozen() { return !!S.hover && (now() - S.lastNudge) < FREEZE_MS; }

  function thawLater() {
    if (S.thaw) root.clearTimeout(S.thaw);
    S.thaw = root.setTimeout(function () { S.thaw = null; if (S.open) render(); }, FREEZE_MS + 30);
  }

  /* 推一格现在要走一趟服务端（距离和费用都在那边算），所以这两个handler都是异步的。
     连点不丢格：沙盒内部把请求串成一条链依次发，点十下就是十格，顺序也不会乱。
     期间不禁用按钮 —— 禁用会让连点在网络稍慢时变成"点了没反应"。 */
  function onNudgeClick(e) {
    var t = e.target, key = t && t.getAttribute && t.getAttribute('data-k');
    if (!key) return;
    var dir = Number(t.getAttribute('data-d')) < 0 ? -1 : 1;
    S.lastNudge = now();
    S.box.push(key, dir).then(function (r) {
      if (!S.open) return;
      S.lastNudge = now();                       // 回来的时候才是表格真正会变的那一刻
      act(r.ok ? '' : r.reason, !r.ok);
      thawLater();
    });
  }

  function onTipClick(e) {
    var t = e.target, key = t && t.getAttribute && t.getAttribute('data-k');
    if (!key) return;
    S.box.push(key, Number(t.getAttribute('data-d')) < 0 ? -1 : 1).then(function (r) {
      if (!S.open) return;
      act(r.ok ? '' : r.reason, !r.ok);
    });
  }

  function onWinClick(e) {
    if (e.target && e.target.id === 'miBang') bang();
  }

  /** 一次操作之后：重画 + 落一句状态 */
  function act(msg, warn) {
    render();
    var el = $('miMsg');
    if (el) { el.className = 'mi-msg' + (warn ? ' warn' : ''); el.textContent = msg || ''; }
  }

  /* ---------------------------------------------------------- 渲染

     整个面板回答三个问题，顺序不许倒过来：
       ① 我现在该干什么   → #miAct（第一步一颗按钮；第二步才是"卡在哪 + 推谁"）
       ② 还差什么         → #miStuck + #miGauges（默认**只列没过的门**）
       ③ 细节             → 参数表（默认收起）

     玩法是两段式：
       第一段「把维度推到 3」—— 98% 的死宇宙要做，**有确定答案，100% 有解**，所以是一键；
       第二段「调其余参数」—— 做完第一段 58% 的人已经赢了，剩下的才是真正的博弈。
     stageOf() 就是这两段加上"赢了"和"真死局"的四选一。 */

  /** 一共多少道门。写死 26 会在门表变动时立刻说谎，所以问模块 A 要 */
  function gateCount() {
    var G = root.MirrorGauges;
    return (G && G.GATES && G.GATES.length) ? G.GATES.length : 0;
  }

  /** 维度方案缓存在状态节点上：dimPlan 要跑几十次模拟，每帧重算太浪费，
      而同一个状态的答案永远一样。撤销回去时也直接拿回旧的那份。 */
  function planOf(stt) {
    if (!stt) return null;
    if (stt.plan === undefined) {
      try { stt.plan = dimSolve(stt.params, S.box.modules); } catch (e) { stt.plan = null; }
    }
    return stt.plan;
  }

  /** 维度这一步的报价。要走服务端，所以是异步的：
      undefined = 正在问 / 失败后冷却中（界面显示"正在估价…"），
      null = **问成了**但没有报价，对象 = 有价。
      失败**不钉死**：原来失败也写 stt.quote = null，网络抖一下这个状态节点就
      永远「估不出价」（quote !== undefined 短路，再也不问）。现在失败只记时间戳，
      冷却几秒后自动重问。
      报价回来还要核对 ops 快照：quoteDimension 的两次 send 拼的是**当时的** ops，
      而维度步仍可手动推弦气三键 —— 飞行中状态变了，这份报价对着的是旧状态，
      记到现在的节点上就是把标定和费用混进用户刚推的格，丢弃重问。 */
  var QUOTE_RETRY_MS = 5000;
  function quoteOf(stt) {
    if (!stt) return null;
    /* ARCBANG：拯救整套下线，沙盒里没有任何东西要花钱 —— 报价请求一发都不发。
       返回 null（= 问过了、没有价），调用方的 `q === undefined` 转圈分支因此不会亮。 */
    if (ARC) return null;
    if (stt.quote !== undefined) return stt.quote;
    if (stt.quoting) return undefined;
    if (stt.quoteFailAt && Date.now() - stt.quoteFailAt < QUOTE_RETRY_MS) return undefined;
    stt.quoting = true;
    var snap = JSON.stringify(S.box.ops());
    S.box.quoteDimension().then(function (q) {
      stt.quoting = false;
      if (!S.box || JSON.stringify(S.box.ops()) !== snap) {
        /* 报价飞行中用户又推了格：这份价对着旧 ops，不能记账。
           下一次 render 到这个节点会重问（quote 仍是 undefined）。 */
        if (S.open && S.box && S.box.current() === stt) render();
        return;
      }
      stt.quote = q || null;
      stt.quoteFailAt = null;
      if (S.open && S.box.current() === stt) render();
    }, function () {
      stt.quoting = false;
      stt.quoteFailAt = Date.now();          // 冷却，不钉死；到点自动再问
      if (root.setTimeout) {
        root.setTimeout(function () {
          if (S.open && S.box && S.box.current() === stt) render();
        }, QUOTE_RETRY_MS + 50);
      }
      if (S.open && S.box && S.box.current() === stt) render();
    });
    return undefined;
  }

  /** 现在处在玩法的哪一段 */
  function stageOf() {
    if (S.box.solved()) return 'won';
    if (S.doom) return 'doom';
    return S.plan ? 'dim' : 'tune';
  }


  /* ---------------------------------------------------------- 「重活正在跑」的现场

     面板上任何一件要等的事（爬山、问提示、推格）开跑时记一个时刻，跑完清掉。
     ui/app.js 的假死看门狗会来取（见下面导出的 wdInfo）：下一次有人报"沙盒卡死"，
     dump 里就直接写着卡的时候目标是什么、那件重活跑了多久、上一步推的是谁。 */
  function busyOn(what) { S.busyAt = now(); S.busyWhat = what || null; }
  function busyOff() { S.busyAt = null; S.busyWhat = null; }

  /** 冷液体宇宙的本地方案，按状态节点缓存 —— 形状照 planOf 抄，只是**分片异步**算。
      undefined = 正在算；null = 推不到（或已经是）；对象 = 方案。
      同步算这一坨要 4000 多次模拟（实测 285–311 ms），换目标那一拍跑它就是假死。 */
  function oceanPlanWait(stt) {
    if (!stt || !S.box) return Promise.resolve(null);
    if (stt.oplan !== undefined) return Promise.resolve(stt.oplan);
    if (stt.oplanP) return stt.oplanP;
    var t0 = now();
    busyOn('oceanPlan');
    stt.oplanP = S.box.oceanPlanAsync().then(function (p) {
      stt.oplan = p || null; stt.oplanMs = Math.round(now() - t0); stt.oplanP = null;
      busyOff();
      if (S.open && S.box && S.box.current() === stt) render();
      return stt.oplan;
    }, function () {
      stt.oplan = null; stt.oplanP = null;
      busyOff();
      if (S.open && S.box && S.box.current() === stt) render();
      return null;
    });
    return stt.oplanP;
  }
  /** 同上的**同步读法**：给 render 用。没算过就顺手开一次分片计算，这一拍先返回 undefined。 */
  function oceanPlanOf(stt) {
    if (!stt) return null;
    if (stt.oplan !== undefined) return stt.oplan;
    oceanPlanWait(stt);
    return undefined;
  }

  /* ---------------------------------------------------------- 自动推

     选了目标就该能**自动往目标推**，而不是只给提示让人一格一格点。
     每一步仍然走现成的那条路（服务端算距离、trail 照记），所以推完
     「撤销一步」「全部重置」一个都没坏 —— 自动推只是替玩家点那些按钮。

     节奏：一步走完歇 AUTO_GAP_MS 再走下一步。不留这口气的话，整段推完
     屏幕上只是闪一下，仪表指针动没动玩家根本看不见 —— 那就白推了。
     这口气同时也是**交还主线程**的那一拍：整条链上没有一处同步连推。

     2026-09-17 用户实测（大挤压那个宇宙）报了两件事，下面四条收手规则是为它们加的：
       ① 提示说「找不到能变好的一格」→ **立刻**停，并把卡住的那道门说出来；
       ② 连着 AUTO_STALL 步总分（MirrorGauges 的 0–100）一点没涨 → 停，别空转发请求；
       ③ 服务端说这一格推不动 → 停；
       ④ 步数封顶 AUTO_MAX_STEPS。
     ①③④ 早就有；真正让它"一直卡着"的是缺了 ②：贪心在局部最优附近能来回蹭很久，
     每一步都"成功"了，分数一动不动。 */
  var AUTO_GAP_MS = 300;
  /** 步数封顶。有了 ② 那条，正常情况下根本走不到这儿 */
  var AUTO_MAX_STEPS = 200;
  /** 连着这么多步总分没涨就收手。实测一个 NO_CARBON_CHEMISTRY 的宇宙要 27 步才活，
      中间有好几段是平的，所以这个数不能小 —— 小了会把正在爬的路当成转圈掐掉。 */
  var AUTO_STALL = 8;
  /** 时间封顶。步数封顶对玩家没有意义（他数不清），"推了一分半还没到"才是他能感觉到的那件事 */
  var AUTO_MAX_MS = 90000;
  /** 贪心卡死时最多试几次「先往坏处推一格」的侧移（确定性的，没有随机数） */
  var AUTO_ESCAPES = 3;

  function goalName() { return S.goal === 'ocean' ? T('冷液体宇宙') : T('可能诞生观察者'); }
  /** 当前目标到了没有。两个目标各认各的判据，互不影响 */
  function goalHit() { return S.goal === 'ocean' ? S.box.isOcean() : S.box.solved(); }
  /** 「把「电磁力有多强（α）」调高 261 格」——人话在前、符号在括号里 */
  function moveTextN(key, dir, steps) {
    return (steps > 1)
      ? TN(dir < 0 ? '把「{n}」调低 {m} 格' : '把「{n}」调高 {m} 格', label(key), steps)
      : TN(dir < 0 ? '把「{n}」调低一格' : '把「{n}」调高一格', label(key));
  }
  /**
   * 仪表盘的读数。仪表模块缺席就返回 null（那时候不走"分数不涨"这条收手规则）。
   *   show = 界面上那个 0–100 的整数分；
   *   fine = **没取整**的同一个东西（过了几道门 × 100 + 连续仪表的平均进度 × 10）。
   * 判"分数不涨"只能用 fine：整数分一步只动一两点，慢慢变好的一串在它上面看着是平的，
   * 拿它判会把还在爬的路误判成转圈，当场把玩家的自动推掐死。
   */
  function gaugeNow() {
    var G = root.MirrorGauges;
    if (!G || typeof G.compute !== 'function') return null;
    try {
      var c = G.compute(S.box.sim());
      if (!c) return null;
      var ms = c.meters || [], sum = 0, i;
      for (i = 0; i < ms.length; i++) sum += (ms[i].progress || 0);
      return {
        show: typeof c.score === 'number' ? c.score : null,
        fine: (c.gates ? c.gates.passed : 0) * 100 + (ms.length ? sum / ms.length : 0) * 10
      };
    } catch (e) { return null; }
  }
  /** 现在卡在哪一道门（人话）。停下来的时候要说出口，不然玩家只看到"推不动了" */
  function stuckGate() {
    var H = root.MirrorHint;
    if (!H || typeof H.diagnose !== 'function') return '';
    try {
      var ds = H.diagnose(S.box.sim()) || [];
      return ds.length ? T(ds[0].label || ds[0].gate) : '';
    } catch (e) { return ''; }
  }
  /** 「推不动了」那一句：带上卡住的门名，比干巴巴一句"没辙"有用得多 */
  function stuckLine(head) {
    var g = stuckGate();
    return head + (g ? TN('　还卡在「{n}」这道门上。', g) : '') +
      T('可以撤销一步、手动推一格换个方向，或者换个目标。');
  }

  function autoEnd(why, msg, warn) {
    S.auto.on = false; S.auto.stop = false;
    S.auto.why = why || null;
    S.auto.whyAt = S.box ? S.box.steps() : 0;
    S.dimBusy = false; S.oceanBusy = false; S.tipBusy = false;
    busyOff();
    if (msg) act(msg, warn); else render();
  }

  /** 按钮本体。开着就是「停」，停着就是「自动推」 */
  function autoToggle() {
    var b = $('miAutoGo');
    if (!b || b.disabled) return;
    if (S.auto.on) { S.auto.stop = true; render(); return; }
    S.auto = {
      on: true, stop: false, n: 0, goal: S.goal, last: null, t0: now(), why: null, whyAt: 0,
      best: (gaugeNow() || {}).fine, stall: 0, escapes: 0
    };
    act(TN('自动推开始：目标「{n}」。想停随时点「停」。', goalName()));
    autoTick();
  }

  /** 下一拍。**一定**经过一次 setTimeout —— 主线程在这中间是自由的 */
  function autoNext() {
    if (!S.open || !S.auto.on) return;
    if (root.setTimeout) root.setTimeout(autoTick, AUTO_GAP_MS);
    else autoTick();
  }

  /** 一步走完之后的共同收尾：记步、看分数涨没涨、落一句话、歇一拍再走下一步 */
  function autoStepDone(text) {
    S.auto.n++;
    S.auto.last = text;
    S.lastStep = text;
    busyOff();
    /* 分数不涨的那几步要数出来（规则 ②）。分数拿不到（仪表模块缺席）就不数，
       那时候只剩提示为空 / 推不动 / 步数封顶这三条收手规则。 */
    var g = gaugeNow(), sc = g ? g.fine : null;
    if (sc == null || S.auto.best == null) { S.auto.stall = 0; S.auto.best = sc; }
    else if (sc > S.auto.best + 1e-9) { S.auto.best = sc; S.auto.stall = 0; }
    else S.auto.stall++;
    act(TN('自动推 第 {n} 步：', S.auto.n) + text +
      (g && g.show != null ? TN('　（总分 {n}/100）', g.show) : ''));
    autoNext();
  }

  /**
   * 贪心卡死时的**有限逃逸**：提示自己说的就是「得先往坏处推一格才能翻过去」。
   * 做法是确定性的，没有随机数 —— 按诊断给出的第一道门的相关参数，依次试
   * 「调低一格 / 调高一格」，推完再问一次提示：提示有话说就接着自动推，
   * 没话说就撤销这一格、试下一个候选。最多 AUTO_ESCAPES 次，之后如实宣告推不动。
   * @returns Promise<bool> 逃出去了没有
   */
  function autoEscape() {
    var H = root.MirrorHint;
    if (!H || typeof H.diagnose !== 'function') return Promise.resolve(false);
    if (S.auto.escapes >= AUTO_ESCAPES) return Promise.resolve(false);
    var ds = [];
    try { ds = H.diagnose(S.box.sim()) || []; } catch (e) { ds = []; }
    var keys = (ds[0] && ds[0].params) ? ds[0].params.slice(0, 3) : [];
    if (!keys.length) return Promise.resolve(false);
    /* 候选顺序写死：第 k 次逃逸从第 k 个参数起，先低后高。
       同一个宇宙点两次自动推，走的是同一条路 —— 可复现。 */
    var cand = [], i;
    for (i = 0; i < keys.length; i++) { cand.push({ key: keys[i], dir: -1 }); cand.push({ key: keys[i], dir: 1 }); }
    S.auto.escapes++;
    function tryOne(j) {
      if (j >= cand.length || !S.open || !S.auto.on) return Promise.resolve(false);
      var c = cand[j];
      return S.box.push(c.key, c.dir).then(function (r) {
        if (!r.ok) return tryOne(j + 1);
        return S.box.suggest().then(function (s) {
          if (s) {                                  // 翻过去了：这一格留着，交回主循环
            S.auto.stall = 0;
            S.lastStep = moveTextN(c.key, c.dir, 1);
            S.auto.last = S.lastStep;
            S.auto.n++;
            act(TN('自动推 第 {n} 步：', S.auto.n) +
              T('先往坏处推一格好翻过去 —— ') + S.lastStep);
            return true;
          }
          S.box.undo();                             // 没翻过去：这一格不留
          return tryOne(j + 1);
        }, function () { S.box.undo(); return false; });
      }, function () { return tryOne(j + 1); });
    }
    return tryOne(0);
  }

  /**
   * 自动推的一拍。收手的口子见上面那四条 + 用户点「停」 + 换了目标。
   * D≠3 的宇宙先把维度推到 3（和手动那条同一个道理：维度不对时其余参数的诊断没有意义），
   * 之后再按目标分流。
   */
  function autoTick() {
    if (!S.open || !S.box || !S.auto.on) return;
    if (S.auto.stop) { autoEnd(null, TN('停了 —— 自动推走了 {n} 步。', S.auto.n)); return; }
    if (S.goal !== S.auto.goal) { autoEnd(null, T('目标换了，自动推停下了。')); return; }
    if (goalHit()) {
      autoEnd(null, TN('到了：目标「{n}」，自动推一共走了 {m} 步。', goalName(), S.auto.n));
      return;
    }
    if (S.auto.stall >= AUTO_STALL) {               // ② 连着这么多步分数一点没涨
      autoEnd('stuck', stuckLine(TN('连推 {n} 步总分都没涨，停下来了 —— 贪心在这儿转圈。', S.auto.stall)), true);
      return;
    }
    if (S.auto.n >= AUTO_MAX_STEPS) {               // ④ 步数封顶
      autoEnd('stuck', TN('推了 {n} 步还没到，先停下来 —— 再点一次「自动推」可以接着推。', S.auto.n), true);
      return;
    }
    if (now() - S.auto.t0 >= AUTO_MAX_MS) {         // ④' 时间封顶
      autoEnd('stuck', TN('推了 {m} 秒（{n} 步）还没到，先停下来 —— 再点一次「自动推」可以接着推。',
        S.auto.n, Math.round((now() - S.auto.t0) / 1000)), true);
      return;
    }

    /* 这一步开跑先报一句。服务端那一趟实测 2–3 秒，不说话就像是卡住了 */
    var say = TN('自动推 第 {n} 步：', S.auto.n + 1) + T('正在算…');

    /* ---- ① 维度不对：先把维度推到 3 ---- */
    if (S.stage === 'dim') {
      S.dimBusy = true; busyOn('dim'); act(say);
      S.box.solveDimension(null).then(function (r) {
        S.dimBusy = false;
        if (!S.open || !S.auto.on) { busyOff(); return; }
        if (!r.ok) { autoEnd('stuck', r.reason, true); return; }
        autoStepDone(TN('把维度推到 3（{n} 格）', r.steps));
      }, function (e) {
        S.dimBusy = false;
        autoEnd('stuck', T('服务端算不出这一步：') + ((e && e.message) || e), true);
      });
      return;
    }

    /* ---- ② 冷液体宇宙：本地爬山出方案，一次推方案里的一根轴 ---- */
    if (S.goal === 'ocean') {
      S.oceanBusy = true; busyOn('ocean'); act(say);
      oceanPlanWait(S.box.current()).then(function (plan) {
        if (!S.open || !S.auto.on) { S.oceanBusy = false; busyOff(); return; }
        if (!plan || !plan.moves || !plan.moves.length) {
          S.oceanBusy = false;
          autoEnd('stuck', T('这个宇宙推不成冷液体宇宙 —— 沿这些参数爬不到那四条判据同时成立的地方。'), true);
          return;
        }
        var m = plan.moves[0];
        return S.box.solveOceanMove(m).then(function (r) {
          S.oceanBusy = false;
          if (!S.open || !S.auto.on) { busyOff(); return; }
          if (!r.ok) { autoEnd('stuck', stuckLine(r.reason), true); return; }
          autoStepDone(moveTextN(r.key, r.dir, r.steps));
        });
      }, function (e) {
        S.oceanBusy = false;
        autoEnd('stuck', T('服务端算不出这一步：') + ((e && e.message) || e), true);
      });
      return;
    }

    /* ---- ③ 推活：还是问服务端「下一格该推谁」，一步一格 ---- */
    var H = root.MirrorHint;
    if (!H) { autoEnd('stuck', T('提示模块没加载，自动推走不了。'), true); return; }
    S.tipBusy = true; busyOn('suggest'); act(say);
    S.box.suggest().then(function (s) {
      S.tipBusy = false;
      if (!S.open || !S.auto.on) { busyOff(); return; }
      if (!s) {
        /* 提示没辙 = 贪心到了局部最优。先做**有限的**逃逸（先往坏处推一格），
           逃不出去就如实说推不动 —— 绝不在这里继续空转。 */
        return autoEscape().then(function (out) {
          if (!S.open || !S.auto.on) { busyOff(); return; }
          if (out) { busyOff(); autoNext(); return; }
          autoEnd('stuck', stuckLine(T('提示找不到能变好的一格了，先往坏处推也没能翻过去。')), true);
        });
      }
      var before = S.box.sim();
      return S.box.push(s.key, s.dir).then(function (r) {
        if (!S.open || !S.auto.on) { busyOff(); return; }
        if (!r.ok) { autoEnd('stuck', stuckLine(r.reason), true); return; }
        var fixed = fixedGates(H, before, S.box.sim());
        autoStepDone(moveText(s) + (fixed.length ? '　' + T('这一格过了：') + TL(fixed) : ''));
      });
    }, function (e) {
      S.tipBusy = false;
      autoEnd('stuck', T('提示算不出来：') + ((e && e.message) || e), true);
    });
  }

  /** 顶栏那颗常驻的「用这组参数引爆」。推过格才出现；救活了就让位给庆祝卡上那一颗 */
  function renderBangGo() {
    var b = $('miBangGo');
    if (!b || !S.box) return;
    var n = S.box.steps();
    b.hidden = (n === 0) || S.box.solved();
    /* 有一步还在飞就先别放行：那一步落地之后参数还会变，
       这时候引爆的是一组马上就过期的参数。自动推期间同理。 */
    b.disabled = S.auto.on || S.tipBusy || S.dimBusy || S.oceanBusy || S.box.busy();
    b.textContent = T('用这组参数引爆');
    b.title = TN('把沙盒里这组参数（推了 {n} 格）直接拿去引爆看结果 —— 不上链、不铸造', n);
  }

  /** 目标下拉旁边那颗按钮。三态：自动推 / 停 / 推不动了（外加"已经到了"就没得推） */
  function renderAutoGo() {
    var b = $('miAutoGo');
    if (!b || !S.box) return;
    var at = goalName();
    if (S.auto.on) {
      b.className = 'mi-btn alt';
      b.textContent = T('停');
      b.disabled = S.auto.stop;
      b.title = TN('正在往「{n}」推，第 {m} 步 —— 点一下收手', at, S.auto.n + 1);
      return;
    }
    b.className = 'mi-btn';
    if (goalHit()) {
      b.textContent = T('自动推'); b.disabled = true;
      b.title = TN('已经到「{n}」了', at);
      return;
    }
    /* 「推不到」只在提示模块**确实判定过**的时候才说。维度还没推到 3 的时候不算数：
       那时候爬山根本没跑（D≠3 的结局到不了 NO_STARS，跑了也是白跑）。
       冷液体宇宙有两种「推不到」：一根轴都爬不动（plan === null），
       以及爬到能爬的最好那一点、四条判据仍然凑不齐（plan.hit === false）。
       两种都不该让「自动推」假装在推 —— 手动那颗「推向冷液体宇宙」不动，
       它本来就允许你推过去看一眼「还差一点」。 */
    var op = (S.goal === 'ocean' && S.stage !== 'dim') ? oceanPlanOf(S.box.current()) : undefined;
    var no = (S.stage === 'doom') ||
      (S.goal === 'ocean' && S.stage !== 'dim' && (op === null || (op && op.hit === false)));
    if (no) {
      b.textContent = T('这个宇宙推不到这个目标'); b.disabled = true;
      b.title = T('提示判定：沿这些参数爬不到这个终点。换一个目标，或者换一个宇宙。');
      return;
    }
    if (S.auto.why === 'stuck' && S.auto.whyAt === S.box.steps()) {
      b.textContent = T('推不动了'); b.disabled = true;
      b.title = T('上一轮自动推没找到能变好的一格。手动推一格、或者撤销一步，再试。');
      return;
    }
    b.textContent = T('自动推');
    /* 冷液体宇宙的提示还在分片算：先别让人点 —— 点了也只能干等，
       而且这一刻还不知道推不推得到。算完 render 会自己把它放开。 */
    var planning = (S.goal === 'ocean' && S.stage !== 'dim' && op === undefined);
    b.disabled = S.tipBusy || S.dimBusy || S.oceanBusy || planning;
    b.title = planning ? T('正在算提示…') : TN('按当前目标「{n}」一步一步推下去，随时可以停', at);
  }

  function render() {
    if (!S.open || !S.box) return;
    var box = S.box, st = box.current(), sim = st.sim;
    var oid = sim && sim.outcome ? sim.outcome.id : null;

    // 连点期间只更新不影响表格位置的部分（见 frozen() 上面那段）
    var fz = frozen();

    var out = $('miOut'), o = OB();
    if (!fz) {
      out.textContent = T((o && o.outcomeName(oid)) || (sim && sim.outcome ? sim.outcome.name : '（算不出来）'));
      out.className = 'mi-out' + (oid === 'OBSERVERS_POSSIBLE' ? ' good' : oid ? ' bad' : '');
      // 结局标签旁边永远跟一句人话：术语本身不告诉新手"这算好还是不好"
      $('miSay').textContent = T((o && o.outcomeLine(oid)) || (sim && sim.outcome ? sim.outcome.visual || '' : ''));
      if (oid !== S.lastOutcome) {
        // 重新触发动画：改 class 之前必须先摘掉，否则同一个 class 不会重播
        out.classList.remove('mi-pop');
        void out.offsetWidth;
        out.classList.add('mi-pop');
        S.lastOutcome = oid;
      }
    }
    // 只改边框颜色，不动布局——救活的那一下面板立刻变绿，这个反馈不该等解冻
    $('miPanel').className = 'mi-panel' + (box.solved() ? ' won' : '');

    var m = S.meta;
    $('miId').textContent = (m.label ? m.label + '　' : '') +
      (m.hash ? m.hash.slice(0, 12) + '…' : T('（没有哈希）')) +
      (m.blockNumber != null ? TN('　← 区块 #{n}', m.blockNumber) : '');

    var n = box.steps();
    /* ARCBANG：拯救下线，这一行不再报费用，只报推了几格。 */
    $('miMeta').innerHTML = T('推了') + ' <b>' + n + '</b> ' + T('格') +
      (box.moves() > 1 ? ' <i>' + esc(TN('（{n} 次操作）', box.moves())) + '</i>' : '') +
      (ARC ? '' : ' · ' + T('真烧要') + ' <b>' + esc(bangText(box.costBang())) +
        ' BANG</b> <i>' + esc(T('（费用由服务端算，沙盒不收费）')) + '</i>') +
      (box.busy() ? ' <i class="mi-spin"></i>' : '');

    var H = root.MirrorHint;
    // 简明视图要靠诊断筛选，提示模块缺席时没有依据可用，老实退回全部
    var nov = novice() && !!H;
    /* 维度方案先算（本地、不联网），死局判定要靠它：
       解得出三维 = 这根本不是死局，而是第一步。 */
    S.plan = planOf(st);
    S.doom = doomVerdict(sim, st.params, S.plan);
    S.stage = stageOf();

    $('miMode').checked = novice();
    $('miMode').disabled = !H;
    $('miModeTxt').textContent = novice() ? T('简明视图') : T('全部视图');
    $('miModeBox').title = H
      ? (novice() ? TN('现在只列没过的门、只留相关参数；点一下看全部 {n} 道门', gateCount())
                  : TN('现在摊开全部 {n} 道门和 {m} 个参数；点一下回到简明视图', gateCount(), nParams()))
      : T('提示模块没加载，只能用全部视图');

    if (!fz) {
      renderWin();
      renderDoom();
      renderAct(H, sim);
      renderStuck(H, nov, sim);
    }
    renderParams(nov, H, sim, fz);
    renderLegend(nov);
    renderGauges(nov);
    /* 造物入口在参数表**下方**的信息卡里 —— 它的高矮变化挪不动上面的表格，
       所以不进 frozen() 的冻结名单，连点期间照常刷新费用。 */
    renderCraft();
    renderRescue();
    renderTwo();

    renderAutoGo();
    renderBangGo();
    $('miUndo').disabled = n === 0 || S.tipBusy;
    $('miReset').disabled = n === 0 || S.tipBusy;
    var hb = $('miHint');
    hb.disabled = !H || S.tipBusy || S.stage === 'dim';
    hb.title = !H ? T('提示模块没加载')
      : S.stage === 'dim' ? T('先把维度推到 3 —— 维度不对的时候，其余参数的诊断没有意义')
      : T('看看现在卡在哪、下一格该推谁');
  }

  /* ---------- 主行动卡：一屏上最先被读到的那句话
     它只说**一件事**：你现在该干什么。别的都往后排。 */
  function renderAct(H, sim) {
    var el = $('miAct'), dim = $('miDim'), auto = $('miAuto'), price = $('miActP');
    var ocean = $('miOcean');
    var st = S.box.current();

    if (S.stage === 'won' || S.stage === 'doom') {   // 赢了/真死局：上面那两张卡已经把话说完
      el.hidden = true;
      dim.hidden = true; auto.hidden = true; ocean.hidden = true;
      return;
    }
    el.hidden = false;
    ocean.hidden = true;

    /* ---- 目标二：冷液体宇宙。维度那一步照旧排在前面（D≠3 的结局根本到不了 NO_STARS），
           所以只在 stage 不是 'dim' 的时候接管这张卡。 ---- */
    if (S.goal === 'ocean' && S.stage !== 'dim') {
      el.className = 'mi-act step2';
      dim.hidden = true; auto.hidden = true; ocean.hidden = false;
      var o = sim && sim.calc ? sim.calc.ocean : null;
      var done = S.box.isOcean();
      /* 提示（本地爬山）**不在这一拍算**：它要 4000 多次模拟，同步跑就是一次假死。
         oceanPlanOf 只查缓存、顺手把分片计算排上，算完自己会再重画一次。
         'done' = 已经到了；undefined = 正在算；null = 爬不到；对象 = 有方案。 */
      var oplan = done ? 'done' : oceanPlanOf(st);
      $('miActK').textContent = T('目标：冷液体宇宙');
      $('miActT').innerHTML = done
        ? T('已经是冷液体宇宙了。')
        : T('要同时满足四条：<b>气体在宇宙年龄内不塌缩</b>、<b>没有一颗恒星点燃</b>、' +
            '<b>有原子且分子有刚性</b>、<b>背景温度落在分子的液态温区</b>。');
      $('miActW').innerHTML = done
        ? T('物质既不聚成天体也不全是气体 —— 判据与全部数值在分析面板的 R_OCEAN 那一条（依据等级：启发式）。')
        : (o ? esc(T(oceanMissing(o))) + '<br>' : '') +
          (oplan === undefined
            ? '<i class="mi-spin"></i>' + esc(T('正在算提示…'))
            : oplan === null
              ? T('<b>这个宇宙推不到这个目标。</b>沿这些参数爬过去，找不到四条判据同时成立的落点 —— ' +
                  '换一个目标，或者换一个宇宙。')
              : T('主要靠压低引力耦合（α_G）、调重子密度 Ω_b 与背景温度 T_CMB。<b>这一步没有确定答案</b>：' +
                  '程序在本地爬山找一组落点，实测一半左右的死宇宙能推到 —— 推不到就会如实说。'));
      if (!S.oceanBusy) ocean.textContent = done ? T('再推一次') : T('推向冷液体宇宙');
      // 爬不到就别让它假装在推：按钮直接灰掉（判词已经写在上面那段里）
      ocean.disabled = S.oceanBusy || S.tipBusy || S.dimBusy || oplan === undefined || oplan === null;
      price.innerHTML = '<i>' + esc(T(ARC ? '（沙盒不收费，推不动就换一个）' : '（沙盒不收费；真烧的费用在推完那一刻由服务端算）')) + '</i>';
      return;
    }

    if (S.stage === 'dim') {
      /* ---- 第一步：维度。有确定答案，花钱就能过 ---- */
      el.className = 'mi-act';
      dim.hidden = false; auto.hidden = true;
      var D = dimOf(sim), q = quoteOf(st);
      $('miActK').textContent = T('第 1 步 / 共 2 步');
      $('miActT').innerHTML = TN('这个宇宙是 <b>{n} 维</b>的，不是三维。', D == null ? '?' : (Math.round(D * 10) / 10));
      $('miActW').innerHTML = T('核合成、恒星、化学的公式全都只在三维成立 —— 维度不对的时候，' +
        '推其余参数是没有意义的。<b>这一步有确定答案</b>：程序已经算出离现在最近的三维解，' +
        '一次点击就能推到位（实测 100% 有解）。');
      if (!S.dimBusy) dim.textContent = T('把维度推到 3');
      dim.disabled = S.dimBusy || S.tipBusy || q === undefined;
      /* ARCBANG：没有拯救就没有费用，quoteOf() 在 arc 下直接返回 null（不发请求），
         这里也就没有价可标 —— 只说沙盒不收费。 */
      price.innerHTML = ARC
        ? '<i>' + esc(T('（沙盒不收费，推不动就换一个）')) + '</i>'
        : q === undefined
          ? '<i class="mi-spin"></i>' + esc(T('正在估价…'))
          : q
            ? TN('真烧要 <b>{n} BANG</b>', esc(bangText(q.costBang))) +
              ' <i>' + esc(TN('（推 {n} 格 · 沙盒不收费）', q.steps)) + '</i>'
            : '<i>' + esc(T('（估不出价，点一下试试）')) + '</i>';
      return;
    }

    /* ---- 第二步：其余参数。这一段才是博弈 ---- */
    el.className = 'mi-act step2';
    dim.hidden = true; auto.hidden = false;
    $('miActK').textContent = T('第 2 步 / 共 2 步');
    var ds = [];
    if (H && typeof H.diagnose === 'function') { try { ds = H.diagnose(sim) || []; } catch (e) { ds = []; } }
    var d0 = ds[0];
    if (d0) {
      var ps = (d0.params || []).map(function (k) { return label(k); }).join(T('、'));
      $('miActT').innerHTML = T('维度已经是 3 了。还差一道门：') + '<b>' + esc(T(d0.label || d0.gate)) + '</b>';
      $('miActW').innerHTML = esc(T(d0.why || '')) +
        (ps ? '<br>' + esc(T('该推的是：')) + '<b>' + esc(ps) + '</b>' : '') +
        (ds.length > 1 ? ' <span style="color:var(--dim2)">' +
          esc(TN('（还有 {n} 道门没过，按因果顺序先修这条）', ds.length - 1)) + '</span>' : '');
    } else {
      $('miActT').innerHTML = T('维度已经是 3 了，没有卡住的门。');
      $('miActW').innerHTML = T('剩下的是程度问题 —— 下面的仪表还差一点。继续推就是。');
    }
    if (!S.tipBusy) auto.textContent = T('照提示推一格');
    auto.disabled = !H || S.tipBusy || S.dimBusy;
    price.innerHTML = '<i>' + esc(T('（这一段没有确定答案 —— 只能一格一格试）')) + '</i>';
  }

  /* 真·结构性死亡。**现在极少见**：弦气模块开着的时候维度是可推量，
     只有 dimSolve() 在三根轴上都解不出三维才会走到这里（见 doomVerdict）。 */
  function renderDoom() {
    var el = $('miDoom'), v = S.doom;
    if (!v) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<b class="mi-doom-t">' + esc(v.title) + '</b>' + v.why +
      '<span class="mi-mine">' + T(MINE_LINE) + '</span>';
  }

  /* 「卡在哪」。diagnose 是纯查表、不跑模拟，所以每推一格都能实时刷新。
     第一步（维度不对）时**不显示** —— 那时候诊断说的门全是维度判据的连坐，
     一边喊"该推 δ_CKM"一边真正该做的是推维度，纯属添乱。 */
  function renderStuck(H, nov, sim) {
    var el = $('miStuck');
    if (S.doom || S.stage === 'dim') { el.hidden = true; return; }
    if (!H || typeof H.diagnose !== 'function') { el.hidden = true; return; }
    var ds = [];
    try { ds = H.diagnose(sim) || []; } catch (e) { ds = []; }
    /* 已经活了就别再喊"卡在哪"：引擎允许个别门没过而结局仍是"可能诞生观察者"
       （门是充分不必要条件），这时候提示玩家去修它纯属添乱。 */
    if (S.box.solved()) {
      el.hidden = false;
      el.className = 'mi-stuck ok';
      el.innerHTML = T('<b>这个宇宙已经能诞生观察者了。</b>可以就此收手，也可以继续推着玩 ——' +
        '沙盒不收费，撤销随时可用。');
      return;
    }
    // 第二步的"卡在哪"已经写进主行动卡了，这里只补"还有哪几道"，不重复第一条
    if (ds.length > 1) {
      el.hidden = false;
      el.className = 'mi-stuck';
      el.innerHTML = T('后面还排着：') + ds.slice(1, 4).map(function (d) {
        return '<b>' + esc(T(d.label || d.gate)) + '</b>';
      }).join(T('、')) +
        (ds.length > 4 ? esc(TN('　等 {n} 道', ds.length - 1)) : '') +
        '<span class="mi-why">' + esc(T('门是有因果顺序的：前面那道不过，后面这些大多会跟着自己好。')) + '</span>';
      return;
    }
    el.hidden = true;
  }

  /* 仪表盘的符号小抄。gauges.js 的定义表存的是中文原文，在这里显示时才过一遍 T。 */
  function renderLegend(nov) {
    var el = $('miLegend'), o = OB();
    if (!nov || S.stage === 'dim') { el.hidden = true; return; }
    el.hidden = false;
    var parts = [
      [T('Hoyle 共振偏移 ξ'), T(o ? o.meterLabel('xi') : '碳的合成窗口偏了多少（越接近 0 越好）')],
      [T('碳/氧产率 f_C、f_O'), T('恒星造得出多少碳和氧（越接近 1 越好）')],
      [T('结构涨落余量'), T(o ? o.meterLabel('weinbergRatio') : '暗能量抢跑的程度（小于 1 才来得及长出星系）')]
    ];
    el.innerHTML = T('看不懂符号就看这行：') + parts.map(function (p) {
      return '<b>' + esc(p[0]) + '</b> = ' + esc(p[1]);
    }).join(T('；')) + T('。指针在动就说明你推对了方向。');
  }

  /* ---------- 参数表：**建一次，之后只改值和显隐**

     原来每推一格就 innerHTML 整表重画，实测（1440×900、新手模式、rescue-1）
     连点十下"电磁力 +"的结果是：前 7 下把宇宙推活了，表从 4 行涨到 20 行，
     鼠标底下那颗按钮当场变成"强核力 −"，第 8 和第 10 下就把刚救活的宇宙又推死了 ——
     玩家看到的是"我一直点同一个地方，它自己坏了"。键盘更直接：按钮节点被换掉，
     焦点掉回 body，回车连推第二下就没了。
     所以行的节点和顺序全程固定，只切显隐、只改文字。

     列从六列减到四列：符号并进第一列的括号里，"原始值"并进当前值下面一行。
     少两列不是为了好看，是为了给按钮那一列腾出宽度（见 CSS 里 c-act 那段注释）。 */
  function buildRows() {
    var box = S.box, h = [], i, key, d;
    h.push('<table class="mi-tbl">');
    h.push('<colgroup><col class="c-plain"><col class="c-val">' +
      '<col class="c-act"><col class="c-off"></colgroup>');
    h.push('<tr class="mi-h"><td>' + esc(T('它管什么')) + '</td>' +
      '<td class="val">' + esc(T('当前值')) + '</td><td class="mi-act"></td>' +
      '<td class="off">' + esc(T('推了')) + '</td></tr>');
    for (i = 0; i < box.keys.length; i++) {
      key = box.keys[i];
      d = Params.byKey[key] || { symbol: key };
      h.push('<tr data-row="' + esc(key) + '">' +
        '<td class="plain">' + esc(plainOnly(key)) + ' <i>' + esc(d.symbol) + '</i></td>' +
        '<td class="val"><span></span><u></u></td>' +
        '<td class="mi-act">' +
          '<button type="button" class="mi-nudge" data-k="' + esc(key) + '" data-d="-1">−</button>' +
          '<button type="button" class="mi-nudge" data-k="' + esc(key) + '" data-d="1">+</button>' +
        '</td>' +
        '<td class="off"></td></tr>');
    }
    h.push('</table><div class="mi-msg" id="miHidden"></div>');
    $('miParams').innerHTML = h.join('');

    S.rows = {};
    var trs = $('miParams').getElementsByTagName('tr');
    for (i = 0; i < trs.length; i++) {
      var tr = trs[i], k = tr.getAttribute('data-row');
      if (!k) continue;
      var btns = tr.getElementsByTagName('button');
      S.rows[k] = {
        tr: tr,
        val: tr.cells[1].getElementsByTagName('span')[0],
        was: tr.cells[1].getElementsByTagName('u')[0],
        off: tr.cells[3], minus: btns[0], plus: btns[1]
      };
    }
    S.rowsBox = box;
    S.rowsOB = !!OB();          // 第一列的人话由模块 D 提供，它要是晚到就得重建一次
    S.shown = null;
  }

  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }

  /** 推不动的方向标灰并把原因写进 title —— 玩家该在点之前就知道这颗按钮是死的。
      probe 不跑 simulate，只做一次 normalize，整表 46 次也不到 1 ms。 */
  function markDead(box, key, dir, btn) {
    if (!btn) return;
    var p = box.probe(key, dir);
    var cls = 'mi-nudge' + (p.ok ? '' : ' dead');
    if (btn.className !== cls) btn.className = cls;
    var t = p.ok ? T(dir < 0 ? '往下推一格' : '往上推一格') : p.reason;
    if (btn.title !== t) btn.title = t;
  }

  function renderParams(nov, H, sim, fz) {
    var box = S.box, st = box.current(), i, key, r;
    if (S.rowsBox !== box || !S.rows || S.rowsOB !== !!OB()) buildRows();

    /* 和当前这道门相关的参数。第一步（维度）时它就是弦气那三个 ——
       维度只由它们决定，别的推一万格也不动 D。 */
    var rel = null;
    if (S.stage === 'dim') {
      rel = DIM_KEYS.filter(function (k) { return box.keys.indexOf(k) >= 0; });
      if (!rel.length) rel = null;
    } else {
      rel = narrowKeys(H, sim, box.keys, 4);
    }
    var isRel = {};
    for (i = 0; rel && i < rel.length; i++) isRel[rel[i]] = 1;

    /* 该显示哪几行。**连点期间不改行集**：行一增一减，光标底下的按钮就换了参数。
       这是同一个 bug 的另一半，光靠节点复用治不了。解冻后立刻重算。 */
    var vis = S.shown, why = S.shownWhy;
    if (!vis || !fz) {
      if (nov && rel) {
        /* 已经推动过的参数一律保留：刚推完一格，那一行如果因为"这道门过了"
           而凭空消失，玩家会以为自己把东西弄坏了，撤销也找不到入口。 */
        vis = box.keys.filter(function (k) { return isRel[k] || box.moved(k); });
        why = 'narrow';
      } else {
        vis = box.keys.slice();
        why = nov ? 'nothing-to-narrow' : 'all';
      }
      S.shown = vis; S.shownWhy = why;
    }

    var on = {};
    for (i = 0; i < vis.length; i++) on[vis[i]] = 1;

    for (i = 0; i < box.keys.length; i++) {
      key = box.keys[i];
      r = S.rows[key];
      if (!r) continue;
      // 用 style.display 而不是 hidden 属性：宿主页的表格样式能盖过 [hidden]
      var want = on[key] ? '' : 'none';
      if (r.tr.style.display !== want) r.tr.style.display = want;
      if (!on[key]) continue;

      var d = Params.byKey[key] || {}, v = st.params[key];
      var off = box.offsetOf(key), mv = box.moved(key);
      /* 相关的参数高亮、其余的压暗 —— 摊开全部 23 个的时候，
         用户要的是"这几个跟我现在的问题有关"，不是一张同样重的表。 */
      var cls = (mv ? 'moved ' : '') + (isRel[key] ? 'rel' : (rel ? 'dimmed' : ''));
      cls = cls.replace(/\s+$/, '');
      if (r.tr.className !== cls) r.tr.className = cls;
      setText(r.val, Params.formatValue(key, v) + (d.unit ? ' ' + d.unit : ''));
      setText(r.was, mv ? T('原 ') + Params.formatValue(key, box.origin[key]) : '');
      setText(r.off, off ? ((off > 0 ? '+' : '') + off + ' ' + T('格')) : '');
      markDead(box, key, -1, r.minus);
      markDead(box, key, 1, r.plus);
    }

    /* 折叠标题跟着**实际显示的东西**走，不跟着开关走。 */
    if (!fz) {
      var sec = $('miParamSec');
      if (sec) {
        sec.textContent = S.stage === 'dim'
          ? T('（维度归它们管 —— 也可以手动推）')
          : why === 'narrow'
            ? TN('（点开手动微调 · 现在只留 {n} 个相关的）', vis.length)
            : TN('（点开手动微调 · 共 {n} 个）', box.keys.length);
      }
    }

    var note = $('miHidden'), n = box.keys.length - vis.length;
    if (!note) return;
    if (why === 'narrow' && n > 0) {
      note.innerHTML = TN('另外 {n} 个参数和当前这道门没关系，先收起来了 ——' +
        '右上角切到「全部视图」就能看到全部。', n);
    } else if (why === 'nothing-to-narrow') {
      note.innerHTML = T('简明视图还开着 —— 只是<b>现在没有卡住的门可以筛了</b>，' +
        '没什么该收起来的，所以参数全在这里。');
    } else {
      setText(note, '');
    }
  }

  /** 仪表盘缓存在状态对象上：撤销回去时不用重算，也保证 prev 箭头指的是同一份数据 */
  function gaugeOf(stt) {
    var G = root.MirrorGauges;
    if (!stt || !G || typeof G.compute !== 'function') return null;
    if (stt.gauge === undefined) {
      try { stt.gauge = G.compute(stt.sim); } catch (e) { stt.gauge = null; }
    }
    return stt.gauge;
  }

  function renderGauges(nov) {
    var el = $('miGauges'), G = root.MirrorGauges;
    if (!G || typeof G.compute !== 'function' || typeof G.render !== 'function') {
      el.innerHTML = '<div class="mi-none">' +
        T('<b>仪表没加载。</b><br>' +
        '现在只能看结局标签 —— 而结局标签在推格的过程中大多是不动的，' +
        '推一格屏幕上没反应属于正常，不是你推错了。') + '</div>';
      return;
    }
    /* 增量箭头该跟谁比：**上一次画出来的那个状态**，而不是 trail 里的前一个。
       推一格时两者是一回事；撤销时不是 —— trail 的前一个是更早的状态，
       于是刚被撤掉的那一步会被重播成"✓ 刚打通"，跟玩家刚做的事正好说反。
       按"上一次画的"比，撤销显示的就是真实的反向增量，重置显示的是一路退回原点的总账。
       同一个状态被重画多次（比如算提示时把按钮变灰那一下）不更新基准，
       否则箭头会在玩家还没看清之前就被抹掉。 */
    var cur = S.box.current();
    if (cur !== S.lastNode) {
      S.prevGauge = S.lastNode ? gaugeOf(S.lastNode) : null;
      S.lastNode = cur;
    }
    try {
      /* 默认**只列没过的门**（用户要的是"还差什么"，不是"全部指标"）。
         26 道门全展开是可选的：模块 A 自己在块底下给一个展开按钮。 */
      G.render(el, gaugeOf(cur), S.prevGauge, { failedOnly: nov !== false });
    } catch (e) {
      // 模块 A 出问题不该把沙盒一起带走：参数表和结局还照常能用
      el.innerHTML = '<div class="mi-none">' + esc(T('仪表模块报错：') + (e && e.message ? e.message : e)) + '</div>';
    }
  }

  function renderWin() {
    var win = $('miWin'), box = S.box;
    if (!box.solved()) { win.hidden = true; win.innerHTML = ''; return; }
    win.hidden = false;
    /* 赢了要**当场判赢**，而且要说清它是怎么赢的：
       58% 的人推完维度就直接活了，
       那一刻界面必须立刻说"活了"，不能让人自己去仪表盘里数门。 */
    /* ARCBANG：拯救整套下线，沙盒是纯玩法 —— 这里不再报费用，也没有销毁可言。 */
    win.innerHTML = '<div class="mi-win-t">' + esc(T('活了 —— 这个宇宙能诞生观察者。')) + '</div>' +
      '<div class="mi-win-w">' + (ARC
        ? esc(TN('共推了 {n} 格。沙盒里的参数不上链，换个宇宙可以从头再来。', box.steps()))
        : esc(TN('共推了 {n} 格，真烧要 ', box.steps())) +
          '<b>' + esc(bangText(box.costBang())) + ' BANG</b>' +
          esc(T('（沙盒不收费）。烧掉的量会永久记在链上（burnedOn）—— 这才是这枚 NFT 稀缺的部分。'))) +
      '</div>' +
      '<div class="mi-act-b">' +
      '<button type="button" class="mi-btn alt" id="miBang">' + esc(T('用这组参数引爆')) + '</button>' +
      '</div>';
  }

  /* ---------------------------------------------------------- 提示（模块 C） */

  /** 「把「电磁力有多强（α）」调高一格」——人话在前、符号在括号里 */
  function moveText(s) {
    return TN(s.dir < 0 ? '把「{n}」调低一格' : '把「{n}」调高一格', label(s.key));
  }

  /** 算提示这段公共骨架：画转圈 → 问服务端 → 回调。
      爬山每试一步都要"推一格"，而一格有多长只有服务端知道（见文件头），
      所以这一步必然是一次网络往返，不再是本地那 8–40 次模拟。 */
  function compute(spinTarget, spinText, fn) {
    var H = root.MirrorHint;
    if (!H || S.tipBusy) return;
    S.tipBusy = true;
    busyOn('suggest');
    if (spinTarget) spinTarget.innerHTML = '<i class="mi-spin"></i>' + esc(spinText);
    render();                                        // 把按钮变灰（render 会读 tipBusy）
    var t0 = now();
    S.box.suggest().then(function (r) {
      S.tipBusy = false; busyOff();
      if (S.open) fn(r, now() - t0, null, H);
    }, function (e) {
      S.tipBusy = false; busyOff();
      if (S.open) fn(null, now() - t0, e, H);
    });
  }

  /* 新手模式的主动作：不用读懂任何东西，点一下就替他推对的那一格。
     它不是作弊 —— 半径表的离线标定脚本 的贪心爬山本来就是"玩家的下限"，
     这个按钮只是把下限交到手上，剩下的判断（推几格、什么时候收手）还是玩家的。 */
  /**
   * 第一步的主动作：一键把维度推到 3。
   *
   * 这不是替玩家作弊 —— 这一步**本来就有确定答案**，
   * 让玩家在 23 个旋钮里先猜出弦气那三个、再猜出该推几百格，那不是难度，是折磨。
   * 真正的博弈在第二步：推完维度还有 42% 的宇宙没活，那一段没有解析解。
   *
   * 报价（quoteDimension）在进入这一步时就已经在后台问过了，所以这里直接复用，
   * 玩家点下去只剩一次往返。
   */
  function pushDimension() {
    var btn = $('miDim');
    if (!btn || btn.disabled || S.dimBusy) return;
    var st = S.box.current();
    var q = (st.quote !== undefined) ? st.quote : null;
    S.dimBusy = true;
    btn.innerHTML = '<i class="mi-spin"></i>' + esc(T('正在推…'));
    busyOn('dim');
    render();
    var before = S.box.sim();
    S.box.solveDimension(q).then(function (r) {
      S.dimBusy = false; busyOff();
      if (r && r.ok) S.lastStep = TN('把维度推到 3（{n} 格）', r.steps);
      if (!S.open) return;
      if (!r.ok) { act(r.reason, true); return; }
      var fixed = fixedGates(root.MirrorHint, before, S.box.sim());
      if (S.box.solved()) {
        // 58% 的宇宙推完维度直接就活了 —— 这一刻必须当场判赢（renderWin 会接手）
        act(TN('维度推到 3 了 —— 这个宇宙当场就活了。（推了 {n} 格）', r.steps));
      } else if (r.hit) {
        act(TN('维度推到 3 了（推了 {n} 格）。', r.steps) +
          (fixed.length ? T('这一步过了：') + TL(fixed) + '　' : '') +
          T('还没活 —— 接下来是第二步，那一段才是要玩的。'));
      } else {
        act(TN('推完还是 {n} 维 —— 再点一次试试。', r.D == null ? '?' : r.D), true);
      }
    }, function (e) {
      S.dimBusy = false; busyOff();
      if (S.open) act(T('服务端算不出这一步：') + ((e && e.message) || e), true);
    });
  }

  /** 结局 id → 人话。OB()（web/onboard.js）有整张表就用它，没有就退回 id */
  function oceanOutcomeName(id) {
    var o = OB();
    return (o && typeof o.outcomeName === 'function' && o.outcomeName(id)) || id || '';
  }

  /** 四条判据里现在差哪一条 —— 直接用引擎给的 why，不在这里重判物理 */
  function oceanMissing(o) {
    if (!o) return '';
    if (o.pass) return '四条判据都成立了。';
    if (o.why === 'stars') return '现在还差：恒星照常点燃了（这一条要求没有恒星）。';
    if (o.why === 'collapse') return '现在还差：气体在宇宙年龄内仍会塌缩（引力还不够弱）。';
    if (o.why === 'chemistry') return '现在还差：没有稳定的原子或分子没有刚性。';
    if (o.why === 'liquid') return '现在还差：背景温度没有一段落在分子的液态温区内。';
    return '';
  }

  /**
   * 目标二的主动作：一键推向冷液体宇宙。骨架照 pushDimension 抄。
   * 报价不像维度那条那样提前在后台问（那是因为维度一进第一步就必然要用），
   * 这一步是玩家主动换目标之后才可能点，所以点下去时现问 —— 两次往返，界面上转圈。
   */
  function pushOcean() {
    var btn = $('miOcean');
    if (!btn || btn.disabled || S.oceanBusy) return;
    S.oceanBusy = true;
    btn.innerHTML = '<i class="mi-spin"></i>' + esc(T('正在算…'));
    busyOn('ocean');
    render();
    /* 方案已经在换目标那一拍分片算好并缓存住了（oceanPlanWait），这里直接拿来用 ——
       再爬一遍山就是白白多花 300 ms，而且两次爬山的落点未必一样。 */
    oceanPlanWait(S.box.current()).then(function (plan) {
      if (!plan) return { ok: false, reason: T('这个宇宙推不成冷液体宇宙 —— 沿这些参数爬不到那四条判据同时成立的地方。') };
      return S.box.quoteOcean(plan).then(function (q) { return S.box.solveOcean(q); });
    }).then(function (r) {
      S.oceanBusy = false; busyOff();
      if (!S.open) return;
      if (!r.ok) { act(r.reason, true); return; }
      if (r.hit) {
        act(T('推成冷液体宇宙了：引力太弱以致气体不塌缩、没有恒星，分子留在液态温区里。') +
          T('结局仍是「没有恒星的宇宙」—— 判据与数值在分析面板的 R_OCEAN 那一条（启发式）。'));
      } else {
        act(T('推完还差一点 —— 现在的结局是「') + T(oceanOutcomeName(r.outcome)) + T('」。') +
          T('取整之后落点可能被挤出判据边界，再点一次、或者手动微调几格试试。'), true);
      }
    }, function (e) {
      S.oceanBusy = false; busyOff();
      if (S.open) act(T('服务端算不出这一步：') + ((e && e.message) || e), true);
    });
  }

  function autoStep() {
    var btn = $('miAuto');
    if (!btn || btn.disabled) return;
    compute(btn, T('正在算…'), function (s, ms, err) {
      btn.textContent = T('照提示推一格');
      if (err) { act(T('提示算不出来：') + (err.message || err), true); return; }
      if (!s) {
        act(T('提示也没辙：找不到能变好的一格。要么这是救不活的那三类（黑洞主导 / 无稳定轨道 / D≠3），' +
          '要么得先往坏处推一格才能翻过去 —— 试试手动推一格再点。'), true);
        return;
      }
      var before = S.box.sim();
      S.box.push(s.key, s.dir).then(function (r) {
        if (!S.open) return;
        if (!r.ok) { act(r.reason, true); return; }
        var fixed = fixedGates(root.MirrorHint, before, S.box.sim());
        S.lastStep = moveText(s);
        /* 括号收进词条里：英文用的是半角括号，留在外面会拼出「… （tried only …）」 */
        act(moveText(s) + '　' + T(s.narrowed ? '（只试了相关参数，' : '（全参数搜了一遍，') +
          TN('{n} 次模拟 / {m} ms，都在服务端跑）', s.tried, Math.round(ms)) +
          (fixed.length ? '　' + T('这一格过了：') + TL(fixed) : ''));
      });
    });
  }

  /** 详细提示：卡在哪（全部门）+ 下一格推谁。和 autoStep 用同一个收窄搜索 */
  function askHint() {
    var tip = $('miTip');
    tip.hidden = false;
    compute(tip, T('正在算…'), function (s, ms, err, H) {
      var html = '';
      if (err) { tip.innerHTML = esc(T('提示算不出来：') + (err.message || err)); render(); return; }
      try {
        var st = S.box.current();
        if (typeof H.diagnose === 'function') {
          var ds = H.diagnose(st.sim) || [];
          html += ds.length
            ? '<b>' + esc(T('卡在这几道门上（按因果顺序，先修第一条）：')) + '</b><ul>' + ds.slice(0, 4).map(function (d) {
                var ps = (d.params || []).map(function (k) { return label(k); }).join(T('、'));
                return '<li>' + esc(T(d.label || d.gate)) +
                  (ps ? '　<i>' + esc(T('该推：') + ps) + '</i>' : '') +
                  '<br><span style="color:var(--dim)">' + esc(T(d.why || '')) + '</span></li>';
              }).join('') + '</ul>'
            : T('<b>没有卡住的门。</b>剩下的是程度问题，看右边的仪表还差多少。');
        }
        html += s
          ? '<div style="margin-top:6px"><b>' + esc(T('下一格：')) + '</b>' + esc(moveText(s)) +
            (typeof s.gain === 'number' ? esc(TN('（分数 +{n}）', s.gain.toFixed(2))) : '') +
            '　<button type="button" class="mi-btn" data-k="' + esc(s.key) + '" data-d="' +
            (s.dir < 0 ? '-1' : '1') + '">' + esc(T('照这个推')) + '</button>' +
            '<span style="color:var(--dim2)">　' + esc(T(s.narrowed ? '只试了诊断指出的参数' : '窄搜没结果，退回全参数搜了一遍') +
            TN('：{n} 次模拟（服务端跑的）/ 往返 {m} ms', s.tried, Math.round(ms))) + '</span></div>'
          : '<div style="margin-top:6px">' +
            T('<b>爬不动了。</b>贪心找不到能变好的一格 —— ' +
            '要么它是结构性死亡（黑洞主导 / 无稳定轨道 / D≠3 这三类救不活），' +
            '要么得先往坏处推一格才能翻过去。') + '</div>';
      } catch (e) {
        html = esc(T('提示模块报错：') + (e && e.message ? e.message : e));
      }
      tip.innerHTML = html || T('提示模块没给出内容');
      render();
    });
  }

  /* ---------------------------------------------------------- 引爆这组参数 */
  function bang() {
    var App = root.MirrorApp;
    if (!App || !App.selectEntry) { act(T('主程序还没就绪，稍等一下再点'), true); return; }
    var m = S.meta, h = m.hash || '';
    var short = h ? h.slice(2, 10) : 'sandbox';
    /* 整句当 key（数字用占位符回填）：英文的词序跟中文不一样，拆成前后两截拼不出好句子 */
    var steps = S.box.steps();
    var name = m.blockNumber != null
      /* ARCBANG：奇点来自 Arc 链的区块，不是 BNB 的；「干预」也跟着拯救系统一起退场 */
      ? TN(ARC ? '调参后的 Arc 区块 {n}（推了 {m} 格）' : '干预后的 BNB 区块 {n}（推了 {m} 格）', m.blockNumber, steps)
      : h ? TN('干预后的 {n}（推了 {m} 格）', h.slice(0, 10), steps)
          : TN('干预后的宇宙（推了 {n} 格）', steps);
    App.selectEntry({
      id: 'fix-' + short,
      label: '#' + (h ? h.slice(2, 8).toUpperCase() : 'FIX'),
      name: name,
      params: S.box.params(),                 // 给副本：主程序改它也碰不到沙盒
      modules: clone(S.box.modules),
      temp: true
    });
    if (App.setState) App.setState('confirm');
    close();
  }

  /* ---------------------------------------------------------- 铸成造物（MirrorCrafted）

独立的造物合约 ——
     原生系列铸的是「哈希派生的原样」，造物铸的是「哈希 + 这一串位移」。
     链上只存 originHash + opsHash + cardHash，任何人拿区块哈希和位移记录
     都能把参数复算出来，可验证性不降级。

     流程照市场页 BANG 单的两段式（web/market.html 的 buy()，「买入双路径」那段）：
       ① POST /api/craft {blockHash, ops} —— 费用**绝不带上**：
          服务端对带 cost 的请求明着拒；
       ② 查 BANG allowance(owner=用户, spender=造物合约)，不够先 approve ——
          **只批本单 cost，不批无限**：合约只会为这一单扣钱，多批的额度
          只是白留一个永久的口子（照 market.html 命名那一步的规矩）；
       ③ 授权落地后自动接着拼 mintCrafted calldata 发交易 —— 一次点击、两次钱包确认。

     九个参数一律用服务端返回的（originBlock / opsHash / cardHash / outcome / rarity /
     cost / deadline / sig），客户端只补 originHash —— 本来就是它发给服务端的那个哈希。
     所有字段都进了签名摘要（合约里 chainId ‖ address(this) ‖ 全部字段），
     自己另算任何一个都是 BadSig，而链上报错看不出是哪一项错了。 */

  /* mintCrafted 的函数选择器。keccak-lite（web/keccak-lite.js）在站点包里排在
     本文件之前（web/build-web.js 的 LAYER），所以现场算得出来；写死的那份是兜底，
     用 node -e + 同一份 keccak 复核过：
       keccak256('mintCrafted(bytes32,uint64,bytes32,bytes32,uint8,uint8,uint256,uint64,bytes)')
         .slice(0,10) === '0x632cd9f4'
     同一次复核里 transfer(0xa9059cbb) / approve(0x095ea7b3) / allowance(0xdd62ed3e)
     三个众所周知的选择器逐一对上，keccak 本身没跑偏。 */
  var CRAFT_SIG = 'mintCrafted(bytes32,uint64,bytes32,bytes32,uint8,uint8,uint256,uint64,bytes)';
  var CRAFT_SEL_FALLBACK = '0x632cd9f4';
  /* ERC-20 的两个标准选择器（与 web/market.html 的 SEL 表一致，公开常数）。
     approve 是 20 的，别和 721 的 setApprovalForAll 混。 */
  var SEL_ALLOWANCE = '0xdd62ed3e';   // allowance(address,address)
  var SEL_APPROVE = '0x095ea7b3';     // approve(address,uint256)
  var SEL_BALANCEOF = '0x70a08231';   // balanceOf(address)
  /* signer() —— 造物合约的签名闸（MirrorCrafted 65 行）。
     选择器与部署向导的 SEL 表同一份。 */
  var SEL_SIGNER = '0x238ac933';

  /* ---------- 发交易前的预检（2026-08-21 加）

     没有这一段的时候，同一个雷炸了两次：交易在预估阶段必回滚（两次的真相都是
     signer 没设，第二次用户还以为是余额），钱包估不出 gas 就填一个 34.8M 的疯值
     去撞节点 16.7M 的上限，用户看到的是「transaction gas limit too high」——
     和真正的病因隔着十万八千里。所以：

       ① 发任何交易之前，把「必败」的原因用人话说出来（signer 闸、BANG 余额、模拟回滚）；
       ② 真发的每一笔都带显式 gas（估值 ×1.3 封顶 1e6），**绝不让钱包自己瞎填**。 */

  /** mintCrafted 会撞上的自定义错误（MirrorCrafted 104–113 行）
      + Solidity 内置的 Panic。模拟 eth_call 回滚时把 revert data 前 4 字节
      对照这张表翻成人话；选择器用 web/keccak-lite.js 现算，不写死 ——
      合约改签名这里自动跟上，keccak 缺席时查不到就原样展示 hex。 */
  var CRAFT_ERR_TABLE = [
    ['BadSig()', '签名验不过（BadSig）：服务端签名和合约的 signer 对不上，或签名闸中途被关了'],
    ['Expired()', '签名过期了（Expired）—— 重新点一次，拿份新签名再铸'],
    ['AlreadyCrafted()', '这张参数卡已经铸过了（AlreadyCrafted）—— 同一张卡只能铸一次'],
    ['BadHash()', '起源哈希或干预史哈希是零（BadHash），服务端应答有问题'],
    ['BadOutcome()', '结局序号不合法（BadOutcome）'],
    ['BadRarity()', '稀有度序号不合法（BadRarity）'],
    ['BadConfig()', '合约参数配置违反不变量（BadConfig）'],
    ['NoToken()', '查不到这个编号的造物（NoToken）'],
    ['Reentrant()', '合约挡下了一次重入（Reentrant），稍后再试'],
    ['NotOwner()', '这个操作只有合约 owner 能做（NotOwner）'],
    ['Panic(uint256)', 'Solidity 内置检查失败（Panic）：多半是算术溢出或数组越界']
  ];
  var craftErrSel = null;               // 选择器 → 中文原文，第一次用到时现算
  function craftErrBySel(sel) {
    var K = root.MirrorKeccak, i;
    if (!craftErrSel) {
      craftErrSel = {};
      for (i = 0; i < CRAFT_ERR_TABLE.length; i++) {
        try {
          if (K && K.keccak256) craftErrSel[K.keccak256(CRAFT_ERR_TABLE[i][0]).slice(0, 10)] = CRAFT_ERR_TABLE[i][1];
        } catch (e) { /* keccak 缺席：认不出就走「原样展示 hex」那条路 */ }
      }
    }
    return craftErrSel[sel] || null;
  }

  /** Error(string)（0x08c379a0，require 的老式理由串）的最小解码：
      选择器已剥掉，剩 offset ‖ len ‖ utf8 数据。解不动就返回 null，外面原样展示。 */
  function craftDecodeStr(body) {
    try {
      var len = parseInt(body.slice(64, 128), 16);
      if (!(len > 0) || body.length < 128 + len * 2) return null;
      var hexs = body.slice(128, 128 + len * 2), pct = '', i;
      for (i = 0; i < hexs.length; i += 2) pct += '%' + hexs.slice(i, i + 2);
      return decodeURIComponent(pct);
    } catch (e) { return null; }
  }

  /** 从一个 RPC 错误里把 revert data 挖出来：craftRpcRaw 挂的 rpcData 优先，
      挖不到再去 message 里捞一段 0x 十六进制（有的节点把 data 拼进 message）。 */
  function craftRevertHex(e) {
    var d = e && e.rpcData;
    if (d && typeof d === 'object' && typeof d.data === 'string') d = d.data;   // 有的节点再包一层
    if (typeof d === 'string' && /^0x[0-9a-fA-F]*$/.test(d) && d.length >= 10) return d;
    var m = /0x[0-9a-fA-F]{8,}/.exec(String((e && e.message) || ''));
    return m ? m[0] : null;
  }

  /** 回滚错误 → 人话。认得出选择器就翻译；Error(string) 解出理由串；都不行原样给 hex。 */
  function craftErrHuman(e) {
    var hex = craftRevertHex(e);
    if (!hex) return String((e && e.message) || e);
    var sel = hex.slice(0, 10).toLowerCase();
    var known = craftErrBySel(sel);
    if (known) return T(known);
    if (sel === '0x08c379a0') {
      var s = craftDecodeStr(hex.slice(10));
      if (s) return TN('链上给出的理由：{n}', s);
    }
    return TN('链上回滚，错误数据认不出（{n}）', hex);
  }

  /** 裸 JSON-RPC（只读，公开节点，不动钱包）。C.rpc 会把 JSON-RPC 错误压成只剩
      message 的 Error —— revert data（error.data，错误选择器就在里面）就丢了。
      模拟总检和 estimateGas 必须拿到这份 data 才能翻译，所以这里自己 fetch
      同一份节点列表（C.CHAIN.rpc），把 data 挂在 Error 上带回来。
      换节点只在网络层挂掉时发生：带着链上答复（哪怕是回滚）的错误换十个节点也一样。 */
  function craftRpcRaw(method, params) {
    var C = root.MirrorChain;
    var list = (C && C.CHAIN && C.CHAIN.rpc) || [];
    if (!list.length) return Promise.reject(new Error(T('链访问层没加载，铸不了造物')));
    function attempt(n) {
      return fetch(list[n], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params || [] })
      }).then(function (r) {
        if (!r.ok) throw new Error('RPC HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (j.error) {
          var err = new Error(j.error.message || 'RPC error');
          err.rpcAnswered = true;                 // 链答复过了（多半是回滚），换节点没意义
          err.rpcData = j.error.data;
          throw err;
        }
        return j.result;
      }).catch(function (e) {
        if (!(e && e.rpcAnswered) && n + 1 < list.length) return attempt(n + 1);
        throw e;
      });
    }
    return attempt(0);
  }

  /** 显式 gas：估值 ×1.3 余量，封顶 1,000,000（mintCrafted 实测远用不到，
      这个顶也远低于节点 16.7M 的 cap）。 */
  var CRAFT_GAS_CAP = 1000000n;
  function craftGasOf(est) {
    var g = BigInt(est) * 13n / 10n;
    if (g > CRAFT_GAS_CAP) g = CRAFT_GAS_CAP;
    return '0x' + g.toString(16);
  }

  function craftSelector() {
    var K = root.MirrorKeccak;
    try { if (K && K.keccak256) return K.keccak256(CRAFT_SIG).slice(0, 10); } catch (e) { /* 落到写死的那份 */ }
    return CRAFT_SEL_FALLBACK;
  }

  /* ABI 编码的三个最小件，与 web/arc-chain.js 的 padHex / encUint / encBytes 同形
     （那边没导出，抄接口不抄状态）。地址和 bytes32 都是左填零到 32 字节。 */
  function craftPad(h) { return String(h).replace(/^0x/, '').toLowerCase().padStart(64, '0'); }
  function craftUint(v) { return craftPad(BigInt(v).toString(16)); }
  /* 动态 bytes：长度槽 + 数据右填充到 32 字节整数倍。
     sig 是 65 字节 —— 正好跨两个槽还余 1 字节，不填满后面的字就错位。 */
  function craftBytes(hex) {
    var body = String(hex || '').replace(/^0x/, '').toLowerCase();
    if (body.length % 2) throw new Error('bytes 长度不是整字节：' + hex);
    var chunks = Math.ceil(body.length / 64) * 64;
    return craftUint(body.length / 2) + body.padEnd(chunks, '0');
  }

  /**
   * mintCrafted 的 calldata。九个头槽 + 一段动态 bytes（sig）：
   *   槽 0  originHash   bytes32   当前区块哈希（就是发给 /api/craft 的那个）
   *   槽 1  originBlock  uint64    服务端查链得到的区块号（res.originBlock 字符串 → BigInt）
   *   槽 2  opsHash      bytes32   keccak256(规范化 ops)，**用服务端返回的，不自己算**
   *   槽 3  cardHash     bytes32   最终参数卡哈希（res.cardHash，去重的钥匙）
   *   槽 4  outcome      uint8     结局序号（res.card.outcome.index，签进摘要的那份）
   *   槽 5  rarity       uint8     稀有度序号（res.card.rarity.index，同上）
   *   槽 6  cost         uint256   BANG 总价 wei（res.costBang；20% 烧 / 80% 进国库在合约里分）
   *   槽 7  deadline     uint64    签名有效期，Unix 秒（res.deadline）
   *   槽 8  offset       uint256   sig 的字节偏移 = 9 × 32 = 288 = 0x120
   *                                （照 bangSigned 的写法 —— 那边 8 个头槽是 256，这里 9 个）
   *   尾部  len(65) + r‖s‖v 右填充到 96 字节
   */
  function craftCalldata(hash, res) {
    return craftSelector()
      + craftPad(hash)
      + craftUint(res.originBlock)
      + craftPad(res.opsHash)
      + craftPad(res.cardHash)
      + craftUint(res.card.outcome.index)
      + craftUint(res.card.rarity.index)
      + craftUint(res.costBang)
      + craftUint(res.deadline)
      + craftUint(9 * 32)
      + craftBytes(res.sig);
  }

  /** 钱包 provider：优先 wallet.js（EIP-6963）选中的那个，退回 window.ethereum ——
      与 web/arc-chain.js 的 eth() 同一条规矩（它没导出，抄规矩不抄引用）。 */
  function craftEth() {
    var W = root.MirrorWallet;
    return (W && typeof W.provider === 'function' && W.provider()) || root.ethereum;
  }
  /** gas 必给（craftGasOf 算出来的显式值）：钱包在预估回滚时会自己填一个
      撞节点上限的疯值（实测填过 34.8M 去撞 16.7M 的 cap），一次都不许它自己填。 */
  function craftSendTx(from, to, data, gas, value) {
    // 不带 value：mintCrafted 收的是 BANG（transferFrom/burnFrom），一分 BNB 都不该跟着去
    var tx = { from: from, to: to, data: data, gas: gas };
    /* ARCBANG 例外：那里的 intervene 是 payable，msg.value 必须一分不差地等于 cost，
       所以拯救那一笔会把金额传进来（别的调用一律不传，行为与从前逐字相同）。 */
    if (value) tx.value = value;
    return craftEth().request({ method: 'eth_sendTransaction', params: [tx] });
  }

  /** 造物那一行的状态话术。挂在 S 上而不是只写 DOM：render() 会整行重画，
      只写 DOM 的话下一帧就被费用报价盖掉了。带 box/steps 快照 ——
      推格、撤销或换宇宙之后，旧话术说的已经不是眼前这份位移，自动作废。 */
  function craftSay(html, cls) {
    S.craftMsg = { box: S.box, steps: S.box ? S.box.steps() : 0, html: html, cls: cls || '' };
    var p = $('miCraftP');
    if (p) { p.className = 'mi-craftp' + (cls ? ' ' + cls : ''); p.innerHTML = html; }
  }
  function craftSpin(text) { craftSay('<i class="mi-spin"></i>' + esc(text), ''); }

  /* 「广播」链接的委托：铸成那行话术由 render()
     每帧按 S.craftMsg 重写 innerHTML，元素上的监听器活不过一帧，所以挂在 doc 上认 id。
     广播现场（S.craftShare）在铸成那一刻存好，浮层本体在 web/arc-ui.js（BnbShare）。 */
  if (doc && doc.addEventListener) {
    doc.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('#miCraftShare') : null;
      if (!a) return;
      ev.preventDefault();
      if (root.BnbShare && S.craftShare) root.BnbShare.open(S.craftShare);
    });
  }

  /* 造物入口的三种状态：
       未部署（CONFIG.crafted 空）或一格没推 → 整行**不出现**：
         前者照 bangNames 的先例（config 空 = 入口不存在），
         后者是服务端的硬规矩 ——「一格都没推：原生宇宙请走普通铸造，造物必须有位移」；
       部署了、推过、但没钱包扩展 / bangToken 没配 / 正在忙 → 按钮禁用，原因写在 title；
       其余 → 可点，旁边挂当前预览费用 —— 沙盒本来就有 costBang，直接用。 */
  function renderCraft() {
    var el = $('miCraft'), btn = $('miCraftBtn'), p = $('miCraftP');
    if (!el || !btn || !p || !S.box) return;
    var CFG = root.ARCBANG_CONFIG || {};
    var box = S.box, n = box.steps();
    if (!CFG.crafted || n === 0) { el.hidden = true; if (!S.craftBusy) S.craftMsg = null; return; }
    el.hidden = false;
    btn.textContent = T('铸成造物');
    var C = root.MirrorChain;
    var noWallet = !(C && C.hasWallet && C.hasWallet());
    btn.disabled = !!S.craftBusy || noWallet || !CFG.bangToken || box.busy();
    btn.title = noWallet ? T('没有检测到钱包扩展（MetaMask / 币安钱包 等），铸不了造物')
      : !CFG.bangToken ? T('BANG 代币地址没配，付不了铸造费')
      : S.craftBusy ? T('正在铸，等这一笔走完')
      : box.busy() ? T('上一格还在服务端算，等它回来再铸')
      : T('把调教出来的这个宇宙铸成造物 NFT：先授权 BANG 再铸造，一次点击、两次钱包确认');
    var msg = S.craftMsg;
    /* 流程走着的时候快照会因为中途推格而对不上 —— 那也不能把转圈吃掉，busy 期间一律保留 */
    if (msg && !S.craftBusy && (msg.box !== box || msg.steps !== n)) { S.craftMsg = null; msg = null; }
    if (msg) {
      p.className = 'mi-craftp' + (msg.cls ? ' ' + msg.cls : '');
      p.innerHTML = msg.html;
    } else {
      p.className = 'mi-craftp';
      /* 费用直接用沙盒手里的 costBang（服务端算的那个数）；分账口径按 spec 二节标死。
         措辞用「费用」不用「烧」：全烧是拯救（rescue）的话术，造物只烧 20%，
         写「真烧要」是在骗人（2026-08-21 用户指出，已拍板）。 */
      /* 两条路的区别必须写在各自的按钮旁边（2026-08-21）：这一条铸的是**新的一枚**，
         走的是另一套合约、另一套经济；隔壁那条主路动的才是原生系列。
         原来这句结尾是「你原来那枚不受影响」——「铸下并拯救」上线之后它就不成立了：
         主路现在也对**一枚都没有**的用户开着，那种人根本没有"原来那枚"
         。改成说两条产品线互不相干。 */
      p.innerHTML = TN('铸一枚<b>新的</b> NFT（造物系列）：费用 <b>{n} BANG</b>，20% 销毁 / 80% 进国库，与原生系列互不相干',
        esc(bangText(box.costBang())));
    }
  }

  function craftMint() {
    var btn = $('miCraftBtn');
    if (!btn || btn.disabled || S.craftBusy || !S.box) return;
    var CFG = root.ARCBANG_CONFIG || {};
    var crafted = CFG.crafted, bangAddr = CFG.bangToken;
    var C = root.MirrorChain, api = root.MirrorBnbApi;
    var hash = S.meta && S.meta.hash;
    var opsArr = S.box.ops();
    if (!crafted || !bangAddr || !opsArr.length) return;
    if (!hash) { craftSay(esc(T('这个宇宙没有区块哈希，服务端没法定位它')), 'warn'); return; }
    if (!C) { craftSay(esc(T('链访问层没加载，铸不了造物')), 'warn'); return; }
    if (!api || !api.base) { craftSay(esc(T('服务端客户端没加载，这一格算不了')), 'warn'); return; }

    S.craftBusy = true;
    craftSpin(T('正在向服务端要签名…'));
    render();                                        // 把按钮按下去（render 会读 craftBusy）

    var q = null, from = null, mintData = null;
    /* ① 要签名。body 里只有 blockHash 和沙盒累计的那份 ops —— 费用**绝不带上**。
       minter：已连钱包时带当前地址（小写 0x 40 hex），未连不加该字段；现役服务端忽略多余字段。 */
    var craftBody = { blockHash: hash, ops: opsArr };
    (C.account ? C.account() : Promise.resolve(null)).then(function (acct) {
      var minter = String(acct || '').toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(minter)) craftBody.minter = minter;
    }, function () { /* 没连上就当没有 minter */ }).then(function () {
      return fetch(api.base + '/craft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(craftBody)
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    }).then(function (res) {
      q = res;
      if (!q.sig || !q.cardHash || !q.opsHash || q.originBlock == null || !q.card
        || !q.card.outcome || !q.card.rarity) {
        throw new Error(T('服务端的应答缺字段，铸不了'));
      }
      /* 签名把合约地址绑死了（摘要里有 address(this)）：两边不一致时链上一律 BadSig，
         而链上报错看不出是地址对不上 —— 在这儿就说清楚。 */
      if (q.crafted && String(q.crafted).toLowerCase() !== String(crafted).toLowerCase()) {
        throw new Error(T('服务端签的造物合约和站点配的不是同一个，先把两边对齐'));
      }
      craftSpin(T('正在连接钱包…'));
      return C.connect();
    }).then(function (acct) {
      from = acct;
      if (!from) throw new Error(T('钱包没有给出账户'));
      /* ② 预检三连（全走公开 RPC，不动钱包）。上一版把「必败」留给钱包的预估去撞：
         预估必回滚时钱包填 34.8M 的 gas 撞节点 16.7M 的上限，用户看到的是
         「transaction gas limit too high」，而不是真正的病因（两次都是 signer 没设）。
         回滚原因必须在发交易之前说出来 ——
         预检 a：signer() 闸开没开。闸没开时 mintCrafted 第一行就 BadSig，铸必败。 */
      craftSpin(T('发交易前先查链上状态…'));
      return C.rpc('eth_call', [{ to: crafted, data: SEL_SIGNER }, 'latest']);
    }).then(function (r) {
      var signerAt = null;
      try { signerAt = BigInt(r); } catch (e) { /* 读不出来放行：别误拦好交易，后面还有模拟总检兜底 */ }
      if (signerAt === 0n) {
        throw new Error(T('造物合约的签名闸还没开（signer() 是零地址，要 owner 去 setSigner）—— 现在铸必败，一分 gas 都别花'));
      }
      /* 预检 b：BANG 余额够不够本单费用 */
      return C.rpc('eth_call', [{ to: bangAddr, data: SEL_BALANCEOF + craftPad(from) }, 'latest']);
    }).then(function (r) {
      var have = null;
      try { have = BigInt(r); } catch (e) { /* 同上：读不出来不拦 */ }
      if (have != null && have < BigInt(q.costBang)) {
        throw new Error(TN('BANG 不够：钱包里有 {n} BANG，这一铸的费用是 {m} BANG',
          bangText(have.toString()), bangText(q.costBang)));
      }
      /* 预检 c：查额度 allowance(owner=用户, spender=造物合约)。原有检查，保留 */
      return C.rpc('eth_call', [{ to: bangAddr, data: SEL_ALLOWANCE + craftPad(from) + craftPad(crafted) }, 'latest']);
    }).then(function (r) {
      var have = 0n;
      try { have = BigInt(r); } catch (e) { /* 读不出来按 0 算：顶多多发一笔 approve */ }
      var need = BigInt(q.costBang);
      if (have >= need) return null;
      /* 额度不够：先 approve，只批本单 cost。落地后这条链自动接着铸 —— 两次钱包确认，一次点击。
         这一笔也先 estimateGas、再带显式 gas 发（规矩同 mint：一次都不许钱包自己填）。 */
      var adata = SEL_APPROVE + craftPad(crafted) + craftUint(need);
      return craftRpcRaw('eth_estimateGas', [{ from: from, to: bangAddr, data: adata }]).then(null, function (e) {
        throw new Error(T('授权的 gas 预估失败（这笔上链必回滚，没让钱包发）：') + craftErrHuman(e));
      }).then(function (est) {
        craftSpin(T('授权 BANG：在钱包里确认…'));
        return craftSendTx(from, bangAddr, adata, craftGasOf(est));
      }).then(function (txh) {
        craftSpin(T('授权已发出，等上链…'));
        return C.waitTx(txh);
      }).then(function (rc) {
        if (rc && rc.status !== undefined && BigInt(rc.status || 0) !== 1n) {
          throw new Error(T('授权交易被链上回滚了，这一单没扣钱'));
        }
        return null;
      });
    }).then(function () {
      /* ③ 模拟总检：同一笔 mintCrafted calldata（九个参数的形状见 craftCalldata 的注释）
         先 eth_call 一遍（from=用户）。通了才让钱包发真交易；回滚了把错误数据前
         4 字节翻成人话（craftErrHuman）—— 这正是两次 gas 惨案里没人说出口的那句真话。 */
      craftSpin(T('铸造前先在链上模拟这一笔…'));
      mintData = craftCalldata(hash, q);
      return craftRpcRaw('eth_call', [{ from: from, to: crafted, data: mintData }, 'latest']).then(null, function (e) {
        throw new Error(T('模拟铸造被链上回滚（真发也必败，一分 gas 没花）：') + craftErrHuman(e));
      });
    }).then(function () {
      /* ④ 显式 gas：先估，估出来 ×1.3 封顶 1,000,000。估不出（过了模拟按理不会发生）
         就直接拦下报错 —— 「填 gas」这件事绝不留给钱包。 */
      return craftRpcRaw('eth_estimateGas', [{ from: from, to: crafted, data: mintData }]).then(null, function (e) {
        throw new Error(T('铸造的 gas 预估失败（这笔没发出去）：') + craftErrHuman(e));
      });
    }).then(function (est) {
      craftSpin(T('铸造造物：在钱包里确认…'));
      return craftSendTx(from, crafted, mintData, craftGasOf(est));
    }).then(function (txh) {
      craftSpin(T('已发出，等待上链…'));
      return C.waitTx(txh);
    }).then(function (rc) {
      S.craftBusy = false;
      if (!S.open) return;
      var ok = !rc || rc.status === undefined || BigInt(rc.status || 0) === 1n;
      if (!ok) {
        craftSay(esc(T('铸造交易被链上回滚了 —— 多半是签名过期或这张卡已经铸过，重新点一次再试')), 'warn');
      } else {
        /* 铸造序号从回执的 Transfer 事件里挖（造物合约、from=0 的那条）。
           挖不到也不拦广播 —— 文案退回不带编号的那句。 */
        var tid = null;
        try {
          var TR = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
          ((rc && rc.logs) || []).forEach(function (lg) {
            if (lg && lg.topics && lg.topics.length === 4 && lg.topics[0] === TR
              && String(lg.address || '').toLowerCase() === String(crafted).toLowerCase()) {
              tid = parseInt(lg.topics[3], 16);
            }
          });
        } catch (e) { /* 编号只是锦上添花 */ }
        /* 广播现场存在 S 上、链接走**委托**（见 craftShareWire）：这一行话术是
           craftSay 落进 S.craftMsg 的，render() 每一帧都会拿它重写 innerHTML，
           直接 addEventListener 活不过下一帧。 */
        /* no / cardHash 是 那一轮加的，**两个都可以缺**：
             no      = 起源区块号，广播链接优先用它（/s/<区块号> 比 /s/<66 位哈希> 短得多）；
                       服务端签名时就给了 originBlock，这里顺手带上，缺了就退回哈希。
             cardHash= 分享图的索引。造物干预过，参数已经不是起源区块那一套了，
                       图必须按 cardHash 找（/api/art/card/<cardHash>.png），
                       缺了就退回按 blockHash 出的那张 —— 图不对总比没有图强，
                       但**能带就一定带**。 */
        S.craftShare = {
          kind: 'craft', hash: hash, id: isFinite(tid) && tid != null ? tid : null,
          no: (q.originBlock != null && isFinite(q.originBlock)) ? Number(q.originBlock) : null,
          cardHash: q.cardHash || null,
          outcome: (root.MirrorOnboard && root.MirrorOnboard.outcomeName)
            ? root.MirrorOnboard.outcomeName(q.card.outcome.id)
            : (q.card.outcome.name || q.card.outcome.id),
          rar: (q.card.rarity && q.card.rarity.name) || '?'
        };
        craftSay(esc(T('铸成了 —— 这个宇宙现在是一枚造物 NFT。')) +
          (q.art ? ' <a href="' + esc(q.art) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' +
            esc(T('看这张卡的图')) + '</a>' : '') +
          (root.BnbShare ? ' · <a href="#" id="miCraftShare">' + esc(T('广播')) + '</a>' : ''), 'ok');
      }
      render();
    }).catch(function (e) {
      S.craftBusy = false;
      if (!S.open) return;
      /* 钱包里点了拒绝是用户的决定，不是错误 —— 分开说（4001 = EIP-1193 userRejectedRequest） */
      var m = (e && e.code === 4001) ? T('你在钱包里取消了')
        : T('造物没铸成：') + ((e && e.message) || e);
      craftSay(esc(m), 'warn');
      render();
    });
  }

  /* ---------------------------------------------------------- 拯救这枚 NFT（MirrorUniverse.intervene）

     和隔壁「铸成造物」并排的**另一条出口**。两条路走的是两个合约、两套经济，
     一个字都不能混着说：

       拯救（这里）   改写**你已经持有的那枚原生 NFT**：MirrorUniverse.intervene()。
                      费用 **100% 销毁**（burnFeeBps 默认 0，上限也只有 10%），
                      烧掉的量永久累加进 burnedOn[id] —— 那是整个项目里唯一真正稀缺的凭证
                      （MirrorUniverse「干预记录」那一段：区块不稀缺，
                      现存 1.17 亿个还在长；烧掉的币才稀缺）。这枚 NFT 的 cardOf、结局和
                      稀有度都会**真的被改写**，市场上看到的就是新的。
       铸成造物       铸一枚**新的**第二套 NFT（MirrorCrafted），20% 烧 / 80% 进国库，
                      原来那枚一个字节都不动。

     为什么现在才有：合约、服务端（/api/intervene 的非 preview 分支）、自测一直都在，
     **前端一处都没调用** —— web/arc-api.js 里只有 intervenePreview。
     于是「烧 BANG 救活自己的 NFT」这个动作在网站上根本执行不了，
     用户手上原生 NFT 的 burnedOn 永远是 0，他一直以为是功能坏了。

     前置：这条路只能改写**你自己的**原生 NFT，所以先得知道这个 blockHash 是哪一枚：
       tokenOfHash(blockHash) == 0  → 还没铸过：不显示按钮，只留一句提示；
       ownerOf(id) != 你            → 同样不显示：合约那边直接 NotOwner，白花一笔 gas。

     流程与造物同形（要签名 → 授权 → 发交易），但**有三处不一样，一处都不能抄错**：
       ① POST /api/intervene **不带 preview**，body 要 {blockHash, tokenId, oldCardHash, ops}。
          oldCardHash 从链上 cardOf(tokenId) 现读 —— 服务端会验它必须能从这个 blockHash
          复算出来（原生指纹，或干预存档里的上一张卡），对不上就 400 CARD_MISMATCH。
          那是它修过的嫁接洞，绕不过去也不该绕：绕过去的代价是
          「凭一次最便宜的干预把废卡刷成 S」（server/index.js 那段注释里有实测记录）。
       ② BANG 授权给 **MirrorUniverse**，不是造物合约。批错地址的话额度批出去了、
          intervene 仍然扣不到款，用户白发一笔，还留下一个永久的口子。
       ③ intervene 的 calldata 有**两个动态 bytes**（ops 和 sig），见 rescueCalldata 的逐槽注释。

     **一次沙盒只拯救一次。** 服务端的 ops 是「相对档位」，基准是 oldCardHash 那张卡：
     第一次拯救时基准 = 原生卡，与沙盒预览（preview 那条路也从原生卡起算）**完全一致**；
     可一旦拯救落地，cardOf 就换成了新卡，而沙盒里的 ops 仍然是「从原生态数起」的那一串 ——
     再送一次等于把同一串位移在**已经推过的卡**上又推一遍，屏幕上报的价和真扣的钱不是一回事。
     所以拯救成功之后这条出口按哈希锁上（S.rescued），请用户重新进沙盒。
     这条限制是**故意保守**的：算错一次的代价是烧掉的币，而币烧掉就没了。 */

  /* intervene 的函数签名与选择器。全部用 web/keccak-lite.js 现算（站点包里它排在
     本文件之前，见 web/build-web.js 的 LAYER），算不出来才落到写死的那份 ——
     那几个数是拿同一份 keccak 复核过的：
       intervene(uint256,bytes32,uint8,uint8,uint256,uint64,bytes,bytes) → 0x83de78df
       tokenOfHash(bytes32) → 0x7cb15b5b   ownerOf(uint256)  → 0x6352211e
       cardOf(uint256)      → 0xc22b8d82   burnedOn(uint256) → 0xffeb9ad4
     同一次复核里 transfer(0xa9059cbb) / approve(0x095ea7b3) / allowance(0xdd62ed3e) /
     balanceOf(0x70a08231) 四个众所周知的选择器逐一对上，keccak 本身没跑偏。 */
  var MU_SIG = 'intervene(uint256,bytes32,uint8,uint8,uint256,uint64,bytes,bytes)';
  /* 铸造的函数签名。与 web/arc-chain.js 的 bangSigned() 逐字相同 —— 那边不带显式 gas
     也拿不到 calldata 做模拟，所以这条路自己拼（同一份编码，见 mintCalldata 的逐槽注释）。
     keccak256('bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes,bool)')
       .slice(0,10) === '0x2a0ca83a'（用同一份 keccak-lite 复核过） */
  var MU_MINT_SIG = 'bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes,bool)';
  var MU_SELS = {
    'intervene(uint256,bytes32,uint8,uint8,uint256,uint64,bytes,bytes)': '0x83de78df',
    'bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes,bool)': '0x2a0ca83a',
    'tokenOfHash(bytes32)': '0x7cb15b5b',
    'ownerOf(uint256)': '0x6352211e',
    'cardOf(uint256)': '0xc22b8d82',
    'burnedOn(uint256)': '0xffeb9ad4'
  };
  function muSel(sig) {
    var K = root.MirrorKeccak;
    try { if (K && K.keccak256) return K.keccak256(sig).slice(0, 10); } catch (e) { /* 落到写死的那份 */ }
    return MU_SELS[sig];
  }
  /* Minted 事件的 topic0（MirrorUniverse 298 行）：
       event Minted(uint256 indexed id, uint8 rarity, bool paidWithBang)
     **刚铸出来的那一枚是几号，只能从这里读。** 不许用 totalSupply() 猜：
     并发下同一个区块里可能有别人也在铸，猜出来的号是别人的 NFT，
     而后面那两笔（要签名、intervene）会照着这个号去改**别人的**卡 —— 服务端和合约
     会拒（CARD_MISMATCH / NotOwner），但那时铸造的钱已经花了，报错还指向错误的方向。
     id 是 indexed，所以它在 topics[1]，不在 data 里。
     keccak256('Minted(uint256,uint8,bool)') 现算，算不出来落到写死的那份（已复核）。 */
  var MU_MINTED_TOPIC = '0x3217aaaf5b1eedb840d681723e770f7cd019266d201e27875c14596544057ce6';
  function mintedTopic() {
    var K = root.MirrorKeccak;
    try { if (K && K.keccak256) return K.keccak256('Minted(uint256,uint8,bool)'); } catch (e) { /* 落到写死的那份 */ }
    return MU_MINTED_TOPIC;
  }
  var ZERO32 = '0x' + new Array(65).join('0');
  /* 市场页是站点里的独立 HTML，与沙盒同目录（web/arc-ui.js 里也是这一个常数）。
     「铸造成了、拯救没成」的时候要给用户一条去看那枚 NFT 的路。 */
  var MARKET_URL = 'market.html';

  /** eth_call 回来的一个字（32 字节）。节点回的长短不一律，统一补/截到一个字再用 */
  function mu32(r) {
    var b = String(r == null ? '' : r).replace(/^0x/, '').toLowerCase();
    if (!b || !/^[0-9a-f]+$/.test(b)) return null;
    if (b.length < 64) b = new Array(64 - b.length + 1).join('0') + b;
    return '0x' + b.slice(0, 64);
  }
  function muAddr(r) { var w = mu32(r); return w ? '0x' + w.slice(2).slice(24) : null; }
  function shortAddr(a) {
    a = String(a || '');
    return a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
  }

  /** intervene 会撞上的自定义错误（MirrorUniverse 303–315 行）
      + BangToken 的 Insufficient（burnFrom / transferFrom 会从代币合约里抛上来）
      + Solidity 内置的 Panic。翻译机制与造物那张表同一套 —— craftRevertHex /
      craftDecodeStr 是通用件（名字带 craft 只是因为先写在那儿），只有表不一样。 */
  var MU_ERR_TABLE = [
    ['NotOwner()', '这枚 NFT 不是你的（NotOwner）—— 干预只能改写自己持有的那一枚'],
    ['BadSig()', '签名验不过（BadSig）：服务端签名和合约的 signer 对不上，或新参数章是零，或签名闸中途被关了'],
    ['Expired()', '签名过期了（Expired）—— 重新点一次，拿份新签名再试'],
    ['BadOps()', '位移记录不合法（BadOps）：空的，或长度不是 5 字节一条 —— 多半是 calldata 拼错了'],
    ['BadOutcome()', '结局或稀有度序号不合法（BadOutcome）'],
    ['BadRarity()', '稀有度序号不合法（BadRarity）'],
    ['TokenNotSet()', 'BANG 代币地址还没设进宇宙合约（TokenNotSet），烧不了币'],
    ['NoToken()', '查不到这个编号的 NFT（NoToken）'],
    ['BadHash()', '哈希是零（BadHash），服务端应答有问题'],
    ['BadConfig()', '合约参数配置违反不变量（BadConfig）'],
    ['AlreadyBanged()', '这个宇宙已经被引爆过了（AlreadyBanged）'],
    ['MintCapReached()', '已经铸满了（MintCapReached）'],
    ['WrongPrice()', '付的金额不对（WrongPrice）'],
    ['Insufficient()', 'BANG 不够、或授权额度不够（Insufficient，代币合约报的）'],
    ['Panic(uint256)', 'Solidity 内置检查失败（Panic）：多半是算术溢出或数组越界']
  ];
  var muErrSel = null;
  function muErrBySel(sel) {
    var K = root.MirrorKeccak, i;
    if (!muErrSel) {
      muErrSel = {};
      for (i = 0; i < MU_ERR_TABLE.length; i++) {
        try {
          if (K && K.keccak256) muErrSel[K.keccak256(MU_ERR_TABLE[i][0]).slice(0, 10)] = MU_ERR_TABLE[i][1];
        } catch (e) { /* keccak 缺席：认不出就原样展示 hex */ }
      }
    }
    return muErrSel[sel] || null;
  }
  /** 回滚错误 → 人话。挖 revert data / 解 Error(string) 两件事与造物共用同一份实现。 */
  function muErrHuman(e) {
    var hex = craftRevertHex(e);
    if (!hex) return String((e && e.message) || e);
    var sel = hex.slice(0, 10).toLowerCase();
    var known = muErrBySel(sel);
    if (known) return T(known);
    if (sel === '0x08c379a0') {
      var str = craftDecodeStr(hex.slice(10));
      if (str) return TN('链上给出的理由：{n}', str);
    }
    return TN('链上回滚，错误数据认不出（{n}）', hex);
  }

  /* 拯救那一行的状态话术。规矩同 craftSay：挂在 S 上而不是只写 DOM ——
     render() 每帧都会重写这一行的 innerHTML，只写 DOM 的话下一帧就被说明文字盖掉。 */
  function rescueSay(html, cls) {
    S.rescueMsg = { box: S.box, steps: S.box ? S.box.steps() : 0, html: html, cls: cls || '' };
    var p = $('miRescueP');
    if (p) { p.className = 'mi-craftp' + (cls ? ' ' + cls : ''); p.innerHTML = html; }
  }
  function rescueSpin(text) { rescueSay('<i class="mi-spin"></i>' + esc(text), ''); }
  /* 带进度的那一版。**这条不是装饰。**
     EVM 改不了「铸造 / 授权 / 干预各是一笔交易」这件事，所以「铸下并拯救」这一次点击
     背后钱包会依次弹三次；界面上不写清楚现在是第几步，连弹三次只会让人以为出错了、
     半路关掉窗口 —— 而那正是最坏的结局：铸造已经上链，拯救停在半路。
     「拯救这枚 NFT」那条路是两笔，同样标号（第 1/2、第 2/2），口径一致。 */
  function rescueStep(i, n, text) {
    rescueSay('<i class="mi-spin"></i><b>' + esc(TN('第 {n}/{m} 步', i, n)) + '</b> · ' + esc(text), '');
  }

  /* 这个 blockHash 在链上的身份：铸了没有、是谁的、参数章是什么、已经烧了多少。
     四问一次问完并**按哈希缓存** —— render() 每帧都会经过这里，不缓存就是每帧四个 eth_call。
     失效点只有两个：换宇宙（key 变了）、拯救成功之后（rescueGo 里手动置 null 重查）。
     全程走公开 RPC（C.rpc），一次都不动钱包：账户用 eth_accounts 读，不会弹连接框。 */
  function rescueProbe() {
    var CFG = root.ARCBANG_CONFIG || {}, C = root.MirrorChain;
    var hash = S.meta && S.meta.hash;
    if (!CFG.contract || !C || !C.rpc || !hash || S.ownBusy) return;
    var key = String(hash).toLowerCase();
    if (S.own && S.own.key === key) return;
    S.ownBusy = true;
    var st = {
      key: key, acct: null, tokenId: 0n, owner: null, mine: false,
      cardHash: null, burnedOn: null, err: null
    };
    function rd(data) { return C.rpc('eth_call', [{ to: CFG.contract, data: data }, 'latest']); }
    var acctP = (C.hasWallet && C.hasWallet() && C.account) ? C.account() : Promise.resolve(null);
    acctP.then(null, function () { return null; }).then(function (a) {
      st.acct = a ? String(a).toLowerCase() : null;
      return rd(muSel('tokenOfHash(bytes32)') + craftPad(key));
    }).then(function (r) {
      try { st.tokenId = BigInt(r); } catch (e) { st.tokenId = 0n; }
      if (st.tokenId === 0n) return null;                 // 还没铸过：后面三问都没有对象
      return rd(muSel('ownerOf(uint256)') + craftUint(st.tokenId)).then(function (o) {
        st.owner = muAddr(o);
        st.mine = !!(st.acct && st.owner === st.acct);
        return rd(muSel('cardOf(uint256)') + craftUint(st.tokenId));
      }).then(function (c) {
        st.cardHash = mu32(c);
        return rd(muSel('burnedOn(uint256)') + craftUint(st.tokenId));
      }).then(function (b) {
        try { st.burnedOn = BigInt(b).toString(); } catch (e) { st.burnedOn = null; }
      });
    }).then(function () {
      S.ownBusy = false; S.own = st;
      if (S.open) render();
    }, function (e) {
      /* 查不出来也要**记下来**：不记的话 render 每帧都会再发一轮请求。
         那一行会给一个「重试」，由用户决定什么时候再问。 */
      S.ownBusy = false;
      st.err = (e && e.message) || String(e);
      S.own = st;
      if (S.open) render();
    });
  }

  /* 「连接钱包」「重试」两个链接走**委托**：那一行是 render() 每帧重写 innerHTML 的，
     直接 addEventListener 活不过下一帧（和 #miCraftShare 同一个道理）。 */
  if (doc && doc.addEventListener) {
    doc.addEventListener('click', function (ev) {
      var t = ev.target, a = t && t.closest ? t.closest('#miRescueConn, #miRescueRetry') : null;
      if (!a) return;
      ev.preventDefault();
      var C = root.MirrorChain;
      if (a.id === 'miRescueRetry') { S.own = null; render(); return; }
      if (!C || !C.connect) return;
      C.connect().then(function () { S.own = null; if (S.open) render(); },
        function () { S.own = null; if (S.open) render(); });
    });
  }

  /* 主按钮走哪条路。
     **判断只能有一处** —— renderRescue 和点击分发要是各判一遍，两边迟早漂移，
     而漂移的后果是"看到的按钮和实际发生的事不是一回事"。

     顺序就是判断顺序，每一条只说这一条：
       'probing'  还在查链                → 转圈，不出按钮
       'err'      查不出来                → 说清楚 + 一个「重试」
       'mint'     tokenOfHash == 0        → **铸下并拯救**（新增的主路：一次点击串起铸造+拯救）
       'nocard'   cardOf == 0             → 没盖过参数章（早期不带签名铸的），服务端复算不出来
       'nowallet' 没有钱包扩展            → 只说它是第几号，看不出是不是你的
       'noacct'   有扩展但没连            → 同上，给一个「连接钱包」
       'others'   ownerOf 不是你          → 说清楚持有人是谁（合约那边会 NotOwner，别白花 gas）
       'locked'   本次会话已经拯救过      → 锁上（理由见本节开头「一次沙盒只拯救一次」）
       'mine'     其余                    → **拯救这枚 NFT**

     'nocard' 挪到了钱包那两条之前：cardOf 是公开读，没钱包也读得到，
     而"这枚老 NFT 根本没参数章"比"看不出是不是你的"更接近真正的原因。 */
  function rescueMode(own, locked) {
    var C = root.MirrorChain;
    if (S.ownBusy || !own) return 'probing';
    if (own.err) return 'err';
    if (own.tokenId === 0n) return 'mint';
    if (!own.cardHash || own.cardHash === ZERO32) return 'nocard';
    if (!(C && C.hasWallet && C.hasWallet())) return 'nowallet';
    if (!own.acct) return 'noacct';
    if (!own.mine) return 'others';
    if (locked) return 'locked';
    return 'mine';
  }

  /* 主按钮的点击分发。两条路共用一个按钮节点（它只绑一次），走哪条由上一帧
     renderRescue 写下的 S.rescueMode 决定 —— 这里一个判断都不重做。 */
  function rescueBtnGo() {
    if (S.rescueMode === 'mint') mintRescueGo();
    else if (S.rescueMode === 'mine') rescueGo();
  }

  function renderRescue() {
    var el = $('miRescue'), btn = $('miRescueBtn'), p = $('miRescueP');
    if (!el || !btn || !p || !S.box) return;
    /* ============================ ARCBANG：拯救系统整套下线 ============================
       这一整格（「拯救这枚 NFT」/「铸下并拯救」按钮 + 它的代价说明）在 arc 站不出现，
       而且**在这里就返回**，所以 rescueProbe() 那几个链上探测请求也一并不发。
       沙盒本身照旧免费开放：能推参数、能看结局、能推向目标，只是没有上链的出口。 */
    if (ARC) {
      el.hidden = true;
      btn.hidden = true;
      S.rescueMode = null;
      return;
    }
    var CFG = root.ARCBANG_CONFIG || {};
    var box = S.box, n = box.steps();
    if (!CFG.contract || n === 0) {
      el.hidden = true;
      S.rescueMode = null;
      if (!S.rescueBusy) S.rescueMsg = null;
      return;
    }
    el.hidden = false;
    rescueProbe();                                  // 命中缓存就直接返回，不会每帧发请求

    var own = S.own, C = root.MirrorChain;
    var hash = S.meta && S.meta.hash;
    var locked = !!(hash && S.rescued[String(hash).toLowerCase()]);
    var mode = rescueMode(own, locked);
    S.rescueMode = mode;
    var can = (mode === 'mint' || mode === 'mine');

    /* 「铸下并拯救」要发三笔交易，其中第一笔就得连钱包，所以没有扩展的时候
       按钮照样露面但禁用、原因写在 title —— 比整颗按钮消失强：断头路正是这次要修的。
       「拯救这枚 NFT」那条的没钱包情形走的是 'nowallet' 分支，根本到不了这里。 */
    var noWallet = !(C && C.hasWallet && C.hasWallet());
    /* ARCBANG 没有代币合约，拯救付的是 native USDC —— 这道「代币地址没配」的闸
       在 arc 上永远不该落下，否则整条拯救路被一个不存在的前提锁死。 */
    var noBang = !ARC && !CFG.bangToken;
    btn.hidden = !can;
    btn.textContent = mode === 'mint' ? T('铸下并拯救') : T('拯救这枚 NFT');
    btn.disabled = !can || !!S.rescueBusy || noBang || box.busy()
      || (mode === 'mint' && noWallet);
    btn.title = (mode === 'mint' && noWallet)
      ? T('没有检测到钱包扩展（MetaMask / 币安钱包 等），铸不了也拯救不了')
      : noBang ? T('BANG 代币地址没配，付不了拯救的费用')
        : S.rescueBusy ? T('正在拯救，等这一笔走完')
          : box.busy() ? T('上一格还在服务端算，等它回来再拯救')
            /* ARCBANG：原生币直接付，没有 approve 那一笔，所以钱包确认次数少一次 */
            : mode === 'mint'
              ? T(ARC ? '一次点击串起两件事：先把这个宇宙铸成你的 NFT，再付 USDC 把它改写成沙盒里这个样子。钱包会依次弹两次（铸造、拯救），界面上会写现在是第几步'
                      : '一次点击串起两件事：先把这个宇宙铸成你的原生 NFT，再烧 BANG 把它改写成沙盒里这个样子。钱包会依次弹三次（铸造、授权、拯救），界面上会写现在是第几步')
              : T(ARC ? '付 USDC 改写你手上这枚 NFT 的参数：费用全额销毁，一次点击、一次钱包确认'
                      : '烧 BANG 改写你手上这枚原生 NFT 的参数：先授权 BANG 再干预，一次点击、两次钱包确认');

    var msg = S.rescueMsg;
    if (msg && !S.rescueBusy && (msg.box !== box || msg.steps !== n)) { S.rescueMsg = null; msg = null; }
    if (msg) {
      p.className = 'mi-craftp' + (msg.cls ? ' ' + msg.cls : '');
      p.innerHTML = msg.html;
      return;
    }
    p.className = 'mi-craftp';
    var id = own && own.tokenId != null ? own.tokenId.toString() : '?';
    var uni = uniNoTxt();                 // 主编号 = 区块号（见顶部 uniNo 注释）
    if (mode === 'probing') {
      p.innerHTML = '<i class="mi-spin"></i>' + esc(T('正在查这个宇宙铸了没有…'));
    } else if (mode === 'err') {
      p.innerHTML = esc(T('查不到这个宇宙的链上状态：')) + esc(own.err)
        + ' · <a href="#" id="miRescueRetry">' + esc(T('重试')) + '</a>';
    } else if (mode === 'mint') {
      /* 原来这一格只有一句「你可以先铸下它」，按钮**根本不出现** —— 推活了却拿不走，
         那是条断头路。现在它是主路，
         这一句要把两段代价一次说清：铸造免费期只花 gas，拯救烧的是 BANG。 */
      p.innerHTML = esc(T('先把这个宇宙铸成你的 NFT（免费额度内只花 gas），'))
        /* ARCBANG：费用是 native USDC，全额打进销毁地址 */
        + TN(ARC ? '再付 <b>{n} USDC</b> 把它改写成现在这个样子' : '再烧 <b>{n} BANG</b> 把它改写成现在这个样子',
             esc(bangText(box.costBang())))
        + T('，') + T('拯救的费用 <b>100% 销毁</b>，永久记进这枚 NFT 的 burnedOn');
    } else if (mode === 'nocard') {
      p.innerHTML = esc(TN('宇宙 #{n} 上没有参数章（cardOf 是零，多半是早期不带签名铸的）—— 服务端复算不出它的参数，改写不了', uni));
    } else if (mode === 'nowallet') {
      p.innerHTML = esc(TN('宇宙 #{n} 已经铸成 NFT 了。没有检测到钱包扩展，看不出它是不是你的', uni));
    } else if (mode === 'noacct') {
      p.innerHTML = esc(TN('宇宙 #{n} 已经铸成 NFT 了。', uni))
        + ' <a href="#" id="miRescueConn">' + esc(T('连接钱包看它是不是你的')) + '</a>';
    } else if (mode === 'others') {
      /* 「持有人是别人」这条要点明链上是哪一枚，但 tokenId 只配当括号里的副编号 */
      p.innerHTML = esc(TN('宇宙 #{n}（链上 NFT #{k}）的持有人是 {m} —— 拯救只能改写你自己的那一枚',
        uni, shortAddr(own.owner), id));
    } else if (mode === 'locked') {
      p.innerHTML = esc(TN('宇宙 #{n}（链上 NFT #{k}）已经按这串位移拯救过了。沙盒里的位移是从原生态数起的，再送一次会在已经推过的卡上重推一遍 —— 关掉沙盒重新进来再继续', uni, null, id));
    } else {
      /* 这一句是整条改动的重点：把代价写死在按钮旁边。
         「100% 销毁」不是修辞 —— 合约的 burnFeeBps 默认就是 0（上限也只有 10%），
         cost 全额进 burnFrom，然后累加进 burnedOn[id]。 */
      /* ARCBANG：费用是 native USDC，链上印的是「有人为这个宇宙烧掉了多少真美元」 */
      p.innerHTML = TN(ARC ? '改写你手上的 <b>宇宙 #{n}</b>（链上 NFT #{k}）：费用 <b>{m} USDC</b>'
                           : '改写你手上的 <b>宇宙 #{n}</b>（链上 NFT #{k}）：费用 <b>{m} BANG</b>',
        uni, esc(bangText(box.costBang())), id)
        + T('，') + TN(ARC ? '<b>100% 销毁</b>，永久记进它的 burnedOn（现在 {n} USDC）；稀有度和结局会真的改变'
                           : '<b>100% 销毁</b>，永久记进它的 burnedOn（现在 {n} BANG）；稀有度和结局会真的改变',
          esc(bangText(own.burnedOn || '0')));
    }
  }

  /** 两列都不出现的时候，连同外面那条虚线一起收掉 —— 否则底部会多出一条无主的横线 */
  function renderTwo() {
    var two = $('miTwo'), a = $('miRescue'), b = $('miCraft');
    if (!two) return;
    two.hidden = !!((!a || a.hidden) && (!b || b.hidden));
  }

  /**
   * intervene 的 calldata。**八个头槽 + 两段动态 bytes** —— 两个 bytes 都是变长的，
   * 第二段的偏移必须把第一段实际占了多少字算进去，这是整条链路最容易错的一处：
   * 错了链上不会告诉你"偏移不对"，只会 BadSig（ops 被读成别的字节，keccak 对不上）
   * 或者 BadOps（长度读出来不是 5 的倍数）。
   *
   *   槽 0  id           uint256   要改写的 token（tokenOfHash 查出来的那一枚）
   *   槽 1  newCardHash  bytes32   服务端算的新参数章（res.cardHash）
   *   槽 2  newOutcome   uint8     新结局序号（res.card.outcome.index，签进摘要的那份）
   *   槽 3  newRarity    uint8     新稀有度序号（res.card.rarity.index，同上）
   *   槽 4  cost         uint256   要烧的 BANG（res.costBang，100% 销毁）
   *   槽 5  deadline     uint64    签名有效期，Unix 秒（res.deadline）
   *   槽 6  offset(ops)  uint256   = 8 × 32 = 256 = 0x100      ← 头部固定 8 个槽
   *   槽 7  offset(sig)  uint256   = 256 + 32 + ceil(len(ops)/32) × 32
   *                                 （ops 的长度槽 + ops 数据右填充后占的字节数）
   *   尾 A  len(ops) ‖ ops 数据，右填充到 32 字节整数倍
   *   尾 B  len(sig)=65 ‖ r‖s‖v，右填充到 96 字节
   *
   * 两段都**原样**用服务端返回的那份：ops 被签名盖住（合约把 keccak256(ops) 签进摘要），
   * 客户端既不能重编也不能补齐 —— 改一个字节链上就 BadSig。
   */
  function rescueCalldata(tokenId, res) {
    var ops = String(res.ops || '').replace(/^0x/, '').toLowerCase();
    var sig = String(res.sig || '').replace(/^0x/, '').toLowerCase();
    if (!ops || ops.length % 2) throw new Error(T('服务端给的位移记录不是整字节，拼不出交易'));
    if (!sig || sig.length % 2) throw new Error(T('服务端给的签名不是整字节，拼不出交易'));
    var head = 8 * 32;                                 // 八个头槽
    var opsWords = Math.ceil(ops.length / 64);         // ops 数据右填充后占几个字
    return muSel(MU_SIG)
      + craftUint(tokenId)                             // 槽 0
      + craftPad(res.cardHash)                         // 槽 1
      + craftUint(res.card.outcome.index)              // 槽 2
      + craftUint(res.card.rarity.index)               // 槽 3
      + craftUint(res.costBang)                        // 槽 4
      + craftUint(res.deadline)                        // 槽 5
      + craftUint(head)                                // 槽 6：ops 的偏移
      + craftUint(head + 32 + opsWords * 32)           // 槽 7：sig 的偏移
      + craftBytes(ops)                                // 尾 A
      + craftBytes(sig);                               // 尾 B
  }

  /**
   * 拯救的**后半段**：要签名 → 授权（够了就跳过）→ 模拟 → 发交易 → 等回执 → 重读 burnedOn。
   * 两条入口共用这一份：
   *   「拯救这枚 NFT」   oldCard 从链上 cardOf(tokenId) 现读，两笔交易（第 1/2、第 2/2）
   *   「铸下并拯救」     oldCard 就是**刚才铸造用的那个 cardHash**，三笔（第 2/3、第 3/3）
   * 抽出来不是为了少写几行，是为了这两条路**永远不会在预检上分家** ——
   * 分家的代价是其中一条少查一项，然后在真钱那一步炸。
   *
   * ctx = {hash, tokenId(BigInt), oldCard, ops, from, total, approveStep, mainStep}
   * 「钱包连的是不是持有人」由调用方查：「拯救这枚 NFT」要查（用户可能在钱包里换过账户），
   * 「铸下并拯救」不用（刚铸完，持有人必是 from）。
   * 成功时**在这里**就把出口锁上（S.rescued）并作废链上身份缓存（S.own），
   * 两条入口的成功话术各写各的。
   */
  function rescueTail(ctx) {
    var CFG = root.ARCBANG_CONFIG || {};
    var mu = CFG.contract, bangAddr = CFG.bangToken;
    var C = root.MirrorChain, api = root.MirrorBnbApi;
    var from = ctx.from, tokenId = ctx.tokenId;
    var sA = ctx.approveStep, sM = ctx.mainStep, sN = ctx.total;
    var q = null, data = null, cost = 0n;
    /* ARCBANG：原生币付款，没有 approve 那一笔 —— 总步数少一步，
       否则界面说「第 2/2 步」而钱包只弹了一次。 */
    if (ARC) { sN -= 1; sM -= 1; sA = sM; }
    /* ARCBANG：intervene 是 payable，模拟 / 估 gas / 真发三处都得带上 msg.value，
       少一处就先撞 WrongPrice。别的站 payVal 恒为 null，交易对象逐字不变。 */
    var payVal = null;
    function txObj() {
      var o = { from: from, to: mu, data: data };
      if (payVal) o.value = payVal;
      return o;
    }

    rescueStep(sA, sN, T('正在向服务端要签名…'));
    /* body：{blockHash, tokenId, oldCardHash, ops}，已连钱包时再带小写 minter。
       费用**绝不带上**：服务端对带 cost 的请求明着拒。 */
    var extra = null, minter = String(from || '').toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(minter)) extra = { minter: minter };
    return api.intervene(ctx.hash, tokenId.toString(), ctx.oldCard, ctx.ops, extra)
      .then(function (res) {
        q = res;
        if (!q.sig || !q.cardHash || !q.ops || q.deadline == null || q.costBang == null
          || !q.card || !q.card.outcome || !q.card.rarity) {
          throw new Error(T('服务端的应答缺字段，拯救不了'));
        }
        cost = BigInt(q.costBang);
        /* 预检照造物那套（见上面「发交易前的预检」那段的动机）：
           signer 闸 → BANG 余额 → 授权 → 模拟总检 → 显式 gas。
           错误表换成 MirrorUniverse 自己的 error 定义（MU_ERR_TABLE）。
           预检 a：signer() 闸开没开。闸没开时 _authBurn 第一步就 BadSig，干预必败。 */
        rescueStep(sA, sN, T('发交易前先查链上状态…'));
        return C.rpc('eth_call', [{ to: mu, data: SEL_SIGNER }, 'latest']);
      }).then(function (r) {
        var signerAt = null;
        try { signerAt = BigInt(r); } catch (e) { /* 读不出来放行：后面还有模拟总检兜底 */ }
        if (signerAt === 0n) {
          throw new Error(T('宇宙合约的签名闸还没开（signer() 是零地址，要 owner 去 setSigner）—— 现在干预必败，一分 gas 都别花'));
        }
        /* 预检 b：钱够不够。ARCBANG 付的是 native USDC，问的是 eth_getBalance ——
           那条链上根本没有代币合约，问 balanceOf 只会拿到一个空回答。 */
        if (ARC) return C.rpc('eth_getBalance', [from, 'latest']);
        // 预检 b：BANG 余额够不够这一次要烧的量
        return C.rpc('eth_call', [{ to: bangAddr, data: SEL_BALANCEOF + craftPad(from) }, 'latest']);
      }).then(function (r) {
        var have = null;
        try { have = BigInt(r); } catch (e) { /* 同上：读不出来不拦 */ }
        if (have != null && have < cost) {
          /* ARCBANG：说 USDC，而且是 native —— 这一行是用户唯一看得见的「钱不够」提示 */
          throw new Error(TN(ARC ? 'USDC 不够：钱包里有 {n} USDC，这一次拯救要付 {m} USDC'
                                 : 'BANG 不够：钱包里有 {n} BANG，这一次拯救要烧 {m} BANG',
            bangText(have.toString()), bangText(q.costBang)));
        }
        /* ARCBANG：原生币不需要授权，下面那一整段（查额度 / approve 一笔）整块跳过 */
        if (ARC) return null;
        /* 预检 c：额度。**spender 是 MirrorUniverse**（干预是它 transferFrom / burnFrom 的），
           不是造物合约 —— 批错地址的话额度批出去了、intervene 仍然扣不到款。 */
        return C.rpc('eth_call', [{ to: bangAddr, data: SEL_ALLOWANCE + craftPad(from) + craftPad(mu) }, 'latest']);
      }).then(function (r) {
        if (ARC) return null;                 // ARCBANG：上一步已经短路，这里没有额度要查
        var have = 0n;
        try { have = BigInt(r); } catch (e) { /* 读不出来按 0 算：顶多多发一笔 approve */ }
        if (have >= cost) {
          /* 额度已经够：这一步**不弹钱包**。进度条上不能默不作声跳过去 ——
             说好了三次确认却只弹两次，用户会以为漏了一步。 */
          rescueStep(sA, sN, T('授权额度已经够了，这一步不用确认'));
          return null;
        }
        // 只批本单 cost，不批无限（规矩同造物）。这一笔也先估 gas、再带显式 gas 发
        var adata = SEL_APPROVE + craftPad(mu) + craftUint(cost);
        return craftRpcRaw('eth_estimateGas', [{ from: from, to: bangAddr, data: adata }]).then(null, function (e) {
          throw new Error(T('授权的 gas 预估失败（这笔上链必回滚，没让钱包发）：') + muErrHuman(e));
        }).then(function (est) {
          rescueStep(sA, sN, T('授权 BANG：在钱包里确认…'));
          return craftSendTx(from, bangAddr, adata, craftGasOf(est));
        }).then(function (txh) {
          rescueStep(sA, sN, T('授权已发出，等上链…'));
          return C.waitTx(txh);
        }).then(function (rc) {
          if (rc && rc.status !== undefined && BigInt(rc.status || 0) !== 1n) {
            throw new Error(T('授权交易被链上回滚了，这一单没扣钱'));
          }
          return null;
        });
      }).then(function () {
        /* 模拟总检：同一笔 intervene calldata 先 eth_call 一遍（from=用户）。
           通了才让钱包发真交易；回滚了把错误数据前 4 字节翻成人话。 */
        rescueStep(sM, sN, T('拯救之前先在链上模拟这一笔…'));
        data = rescueCalldata(tokenId, q);
        if (ARC) payVal = '0x' + cost.toString(16);   // ARCBANG：msg.value 必须等于 cost
        return craftRpcRaw('eth_call', [txObj(), 'latest']).then(null, function (e) {
          throw new Error(T('模拟干预被链上回滚（真发也必败，一分 gas 没花）：') + muErrHuman(e));
        });
      }).then(function () {
        // 显式 gas：估值 ×1.3 封顶 1e6。「填 gas」这件事绝不留给钱包
        return craftRpcRaw('eth_estimateGas', [txObj()]).then(null, function (e) {   // ARCBANG：带 value 估
          throw new Error(T('干预的 gas 预估失败（这笔没发出去）：') + muErrHuman(e));
        });
      }).then(function (est) {
        rescueStep(sM, sN, T('拯救这枚 NFT：在钱包里确认…'));
        return craftSendTx(from, mu, data, craftGasOf(est), payVal);   // ARCBANG：payVal 非空才带 value
      }).then(function (txh) {
        rescueStep(sM, sN, T('已发出，等待上链…'));
        return C.waitTx(txh);
      }).then(function (rc) {
        var ok = !rc || rc.status === undefined || BigInt(rc.status || 0) === 1n;
        if (!ok) throw new Error(T('拯救交易被链上回滚了 —— 多半是签名过期，重新点一次再试'));
        /* 成功：这枚 NFT 的链上事实全变了（cardOf 换章、burnedOn 加上这一笔）。
           缓存作废、这条出口锁上，burnedOn **从链上重读**再显示 ——
           本地加出来的数没有说服力，而"烧了多少"正是这枚 NFT 的价值锚。 */
        S.rescued[String(ctx.hash).toLowerCase()] = true;
        S.own = null;
        return C.rpc('eth_call', [{ to: mu, data: muSel('burnedOn(uint256)') + craftUint(tokenId) }, 'latest'])
          .then(function (b) { try { return BigInt(b).toString(); } catch (e) { return null; } },
            function () { return null; });                  // 读不到就不显示这半句，不拦成功
      }).then(function (burned) {
        return { q: q, burned: burned, tokenId: tokenId };
      });
  }

  function rescueGo() {
    var btn = $('miRescueBtn');
    if (!btn || btn.hidden || btn.disabled || S.rescueBusy || !S.box) return;
    var CFG = root.ARCBANG_CONFIG || {};
    var mu = CFG.contract, bangAddr = CFG.bangToken;
    var C = root.MirrorChain, api = root.MirrorBnbApi;
    var hash = S.meta && S.meta.hash;
    var opsArr = S.box.ops();
    var own = S.own;
    if (!mu || !bangAddr || !opsArr.length) return;
    if (!own || !own.mine || own.tokenId === 0n) return;      // 界面已经拦过，这里是第二道
    if (!hash) { rescueSay(esc(T('这个宇宙没有区块哈希，服务端没法定位它')), 'warn'); return; }
    if (!C) { rescueSay(esc(T('链访问层没加载，拯救不了')), 'warn'); return; }
    if (!api || !api.intervene) { rescueSay(esc(T('服务端客户端没加载，拯救不了')), 'warn'); return; }

    var tokenId = own.tokenId;
    S.rescueBusy = true;
    S.mintDone = null;                               // 这条路一枚都不铸，失败话术走普通那条
    rescueStep(1, 2, T('正在读这枚 NFT 现在的参数章…'));
    render();                                        // 把按钮按下去（render 会读 rescueBusy）

    var from = null, oldCard = null, q = null;

    /* ① oldCardHash 必须**现读**。上一次干预之后 cardOf 就换了，
       拿沙盒里缓存的旧章去要签名，服务端一律 CARD_MISMATCH —— 而那正是它该拒的。
       （「铸下并拯救」那条路**不能**这么读：刚铸完的那笔可能还没到公开节点的最新块，
       读回来会是零章。那边直接用铸造时服务端给的 cardHash，见 mintRescueGo。） */
    C.rpc('eth_call', [{ to: mu, data: muSel('cardOf(uint256)') + craftUint(tokenId) }, 'latest'])
      .then(function (r) {
        oldCard = mu32(r);
        if (!oldCard || oldCard === ZERO32) {
          throw new Error(T('这枚 NFT 上没有参数章（cardOf 是零），服务端复算不出它的参数'));
        }
        rescueStep(1, 2, T('正在连接钱包…'));
        return C.connect();
      }).then(function (acct) {
        from = acct;
        if (!from) throw new Error(T('钱包没有给出账户'));
        /* 连接之后账户可能和刚才 eth_accounts 读到的不是同一个（用户在钱包里换过）。
           合约那边是 NotOwner，但那时 gas 已经花掉了 —— 在这儿就说清楚。 */
        if (String(from).toLowerCase() !== own.owner) {
          throw new Error(T('钱包现在连的不是这枚 NFT 的持有人账户 —— 合约那边会 NotOwner，换回持有它的那个账户再试'));
        }
        /* 后半段共用（要签名 → 授权 → 模拟 → 发交易）。这条路两笔：授权第 1/2、干预第 2/2 */
        return rescueTail({
          hash: hash, tokenId: tokenId, oldCard: oldCard, ops: opsArr, from: from,
          total: 2, approveStep: 1, mainStep: 2
        });
      }).then(function (out) {
        q = out.q;
        S.rescueBusy = false;
        if (!S.open) return;
        rescueSay(esc(TN('拯救成功 —— 宇宙 #{n} 的参数被改写了。', uniNoTxt()))
          + (out.burned != null
            /* ARCBANG：burnedOn 记的是销毁掉的 USDC */
            ? ' ' + TN(ARC ? '它现在累计销毁 <b>{n} USDC</b>（burnedOn，链上现读）'
                           : '它现在累计烧掉 <b>{n} BANG</b>（burnedOn，链上现读）', esc(bangText(out.burned)))
            : '')
          + (q.art ? ' <a href="' + esc(q.art) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">'
            + esc(T('看这张卡的图')) + '</a>' : ''), 'ok');
        render();                                           // 顺带触发 rescueProbe 重查链上身份
      }).catch(function (e) {
        S.rescueBusy = false;
        if (!S.open) return;
        // 钱包里点了拒绝是用户的决定，不是错误（4001 = EIP-1193 userRejectedRequest）
        var m = (e && e.code === 4001) ? T('你在钱包里取消了')
          : T('没能拯救：') + ((e && e.message) || e);
        rescueSay(esc(m), 'warn');
        render();
      });
  }

  /* ---------------------------------------------------------- 铸下并拯救（新的主路）

     用户拍板：「拯救+铸造应该是一体的」「实际上就是一个操作」。
     所以这条路**只让用户点一次**：中途不做任何决策、不填任何东西、不回别的页面。
     EVM 改不了三件事各是一笔交易，钱包会依次弹三次 —— 那是硬约束，
     但界面必须全程写清楚现在是第几步（rescueStep），否则连弹三次就是"出错了"的样子。

       第 1/3  POST /api/bang → bangSigned() 铸造（免费期只花 gas，付费期按分档价带 value）
       第 2/3  从回执的 Minted 事件取 tokenId → POST /api/intervene 要签名 → approve BANG
       第 3/3  intervene() 改写

     两处最容易做错、错了都很贵：
       ① tokenId **只能**从回执的 Minted 事件里解（mintedIdOf）。用 totalSupply() 猜的话，
          并发下猜到的是别人的 NFT，后面两笔会照着那个号去改别人的卡。
       ② 第 2 步的 oldCardHash 就是第 1 步铸造用的那个 cardHash（服务端签名时给的），
          **不要再去链上 cardOf 读一次**：刚铸完的交易未必已经到了公开节点的最新块，
          读回来可能还是零章，然后在"服务端复算不出参数"上莫名其妙地死掉。

     中途失败的口径见 catch：第 1 步落地之后，用户**已经拿到 NFT 了**，
     那一笔钱不是白花的，话术必须这么说。 */

  /**
   * bangSigned 的 calldata。**八个头槽 + 一段动态 bytes（sig）**，
   * 编码与 web/arc-chain.js 的 bangSigned() 逐字段相同（那边发交易不带显式 gas、
   * 也不给出 calldata 做模拟，所以这里自己拼一份）：
   *   槽 0  blockHash    bytes32   区块哈希（发给 /api/bang 的那个，服务端签的也是它）
   *   槽 1  blockNumber  uint64    服务端查链得到的区块号（d.card.blockNumber）
   *   槽 2  outcome      uint8     结局序号（d.card.outcome.index，签进摘要的那份）
   *   槽 3  rarity       uint8     稀有度序号（d.rarity.index，同上 —— 它直接决定价格）
   *   槽 4  cardHash     bytes32   参数指纹（d.cardHash）。它同时是第 2 步的 oldCardHash
   *   槽 5  deadline     uint64    签名有效期，Unix 秒
   *   槽 6  offset(sig)  uint256   = 8 × 32 = 256
   *   槽 7  payWithBang  bool      false —— 站点上这条路一律付 BNB（与 web/arc-ui.js 一致）
   *   尾部  len(65) ‖ r‖s‖v，右填充到 96 字节
   * 八个字段全部签进了摘要，自己另算任何一个都是 BadSig，而链上报错看不出是哪一项。
   */
  function mintCalldata(d) {
    return muSel(MU_MINT_SIG)
      + craftPad(d.card.blockHash)
      + craftUint(d.card.blockNumber)
      + craftUint(d.card.outcome.index)
      + craftUint(d.rarity.index)
      + craftPad(d.cardHash)
      + craftUint(d.deadline)
      + craftUint(8 * 32)
      + craftUint(0)                                   // payWithBang = false
      + craftBytes(d.sig);
  }

  /** 回执里那一枚的编号：认 MirrorUniverse 发出的 Minted，id 在 topics[1]（indexed）。
      找不到就返回 null —— 上层据此报错，**绝不退回 totalSupply() 去猜**。 */
  function mintedIdOf(rc, mu) {
    var topic = String(mintedTopic()).toLowerCase(), out = null;
    try {
      ((rc && rc.logs) || []).forEach(function (lg) {
        if (!lg || !lg.topics || lg.topics.length < 2) return;
        if (String(lg.topics[0]).toLowerCase() !== topic) return;
        if (String(lg.address || '').toLowerCase() !== String(mu).toLowerCase()) return;
        out = BigInt(lg.topics[1]);
      });
    } catch (e) { return null; }
    return out;
  }

  /** 铸造那一笔的显式 gas。造物那份的顶（CRAFT_GAS_CAP = 1e6）对它不一定够用：
      bangSigned 要写一整个 Universe 结构、发三条事件，还要走 _settle* 那条付款/发奖路。
      所以这里的顶放到 2e6 —— 仍然远低于节点 16.7M 的 cap，而估值 ×1.3 正常连一半都到不了。
      封顶只是防"估值本身荒唐"，不该在正常路径上把交易饿死。 */
  var MINT_GAS_CAP = 2000000n;
  function mintGasOf(est) {
    var g = BigInt(est) * 13n / 10n;
    if (g > MINT_GAS_CAP) g = MINT_GAS_CAP;
    return '0x' + g.toString(16);
  }

  /** 铸造那一笔要带 value（免费期是 0，付费期是分档价）。craftSendTx 明着不带 value
      （造物收的是 BANG），所以这条路自己发 —— gas 仍然是**显式**的，一次都不许钱包自己填。 */
  function mintSendTx(from, to, data, gas, valueWei) {
    return craftEth().request({
      method: 'eth_sendTransaction',
      params: [{ from: from, to: to, data: data, gas: gas, value: '0x' + BigInt(valueWei || 0).toString(16) }]
    });
  }

  function mintRescueGo() {
    var btn = $('miRescueBtn');
    if (!btn || btn.hidden || btn.disabled || S.rescueBusy || !S.box) return;
    var CFG = root.ARCBANG_CONFIG || {};
    var mu = CFG.contract, bangAddr = CFG.bangToken;
    var C = root.MirrorChain, api = root.MirrorBnbApi;
    var hash = S.meta && S.meta.hash;
    var opsArr = S.box.ops();
    if (!mu || !bangAddr || !opsArr.length) return;
    if (!hash) { rescueSay(esc(T('这个宇宙没有区块哈希，服务端没法定位它')), 'warn'); return; }
    if (!C || !C.mintValueFor) { rescueSay(esc(T('链访问层没加载，拯救不了')), 'warn'); return; }
    if (!api || !api.bang || !api.intervene) {
      rescueSay(esc(T('服务端客户端没加载，拯救不了')), 'warn'); return;
    }

    S.rescueBusy = true;
    S.mintDone = null;                               // 每次点都从"还没铸"重新起算
    rescueStep(1, ARC ? 2 : 3, T('正在向服务端要铸造签名…'));
    render();                                        // 把按钮按下去（render 会读 rescueBusy）

    var stamp = null, from = null, mintData = null, wei = 0n, tokenId = null;

    /* 第 1/3 步。签名在**这一刻**才取：它带 deadline（默认 600 秒），
       而人在沙盒里推参数动辄十几分钟，引爆时取的名早过期了。
       minter 与 /api/craft 同款：已连钱包才带（小写 0x 40 hex），未连不加。 */
    (C.account ? C.account() : Promise.resolve(null)).then(function (acct) {
      var extra = null, minter = String(acct || '').toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(minter)) extra = { minter: minter };
      return api.bang(hash, extra);
    }, function () { return api.bang(hash); }).then(function (d) {
      stamp = d;
      /* 逐个字段点名检查。全都要签进摘要，缺一个 ecrecover 就恢复出别的地址，
         而 BigInt(null) 会安安静静给出 0n —— 那时报出来的是 BadSig，看不出是哪一项空了。 */
      if (!d || !d.sig || !d.cardHash || !d.card || !d.card.blockHash
        || d.card.blockNumber == null || !d.card.outcome || d.card.outcome.index == null
        || !d.rarity || d.rarity.index == null || d.deadline == null) {
        throw new Error(T('服务端的铸造签名缺字段，铸不了'));
      }
      /* 签的必须是**沙盒里这个宇宙**。对不上就停：接着铸下去等于给用户
         一枚他没看过的 NFT，而后面那两步的 ops 是照沙盒这一个算的，一定对不上。 */
      if (String(d.card.blockHash).toLowerCase() !== String(hash).toLowerCase()) {
        throw new Error(T('服务端签的是另一个区块哈希，和沙盒里这个宇宙对不上'));
      }
      rescueStep(1, ARC ? 2 : 3, T('正在连接钱包…'));
      return C.connect();
    }).then(function (acct) {
      from = acct;
      if (!from) throw new Error(T('钱包没有给出账户'));
      /* 预检 a：signer() 闸开没开。闸没开时 bangSigned 第一行就 BadSig，铸必败 ——
         这一笔要真花 gas，必须在发之前说出来。 */
      rescueStep(1, ARC ? 2 : 3, T('发交易前先查链上状态…'));
      return C.rpc('eth_call', [{ to: mu, data: SEL_SIGNER }, 'latest']);
    }).then(function (r) {
      var signerAt = null;
      try { signerAt = BigInt(r); } catch (e) { /* 读不出来放行：后面还有模拟总检兜底 */ }
      if (signerAt === 0n) {
        throw new Error(T('宇宙合约的签名闸还没开（signer() 是零地址，要 owner 去 setSigner）—— 现在铸造必败，一分 gas 都别花'));
      }
      /* 该付多少：免费期且这个地址还有免费次数 → 必须**正好 0**
         （合约 _settleBnb 里 msg.value != 0 就 revert，多给一分钱也过不去）；
         用完了 → v5 一口价 price()。判定整个在 mintValueFor 里（2026-08-21 修过：
         它原来问的是 v4 的 priceBnb[rarity]，v5 字节码里没有，拯救报价一律 revert 0x）。
         第二个参数它已经不看了 —— v5 价格与稀有度无关，传着只为兼容旧签名。 */
      return C.mintValueFor(from, stamp.rarity.index);
    }).then(function (v) {
      wei = BigInt(v || 0);
      mintData = mintCalldata(stamp);
      // 模拟总检：同一笔 calldata、同一个 value 先 eth_call 一遍，回滚了翻成人话
      rescueStep(1, ARC ? 2 : 3, wei === 0n ? T('铸造前先在链上模拟这一笔（免费期，只花 gas）…')
        : T('铸造前先在链上模拟这一笔…'));
      return craftRpcRaw('eth_call', [{
        from: from, to: mu, data: mintData, value: '0x' + wei.toString(16)
      }, 'latest']).then(null, function (e) {
        throw new Error(T('模拟铸造被链上回滚（真发也必败，一分 gas 没花）：') + muErrHuman(e));
      });
    }).then(function () {
      return craftRpcRaw('eth_estimateGas', [{
        from: from, to: mu, data: mintData, value: '0x' + wei.toString(16)
      }]).then(null, function (e) {
        throw new Error(T('铸造的 gas 预估失败（这笔没发出去）：') + muErrHuman(e));
      });
    }).then(function (est) {
      rescueStep(1, ARC ? 2 : 3, wei === 0n ? T('铸造这个宇宙：在钱包里确认（免费期，只花 gas）…')
        /* ARCBANG：Arc 的 native 就是 USDC，单位不能写死成 BNB */
        : TN('铸造这个宇宙：在钱包里确认（{n}）…',
             C.fmtBNB ? C.fmtBNB(wei) + (ARC ? ' USDC' : ' BNB') : wei.toString()));
      return mintSendTx(from, mu, mintData, mintGasOf(est), wei);
    }).then(function (txh) {
      rescueStep(1, ARC ? 2 : 3, T('铸造已发出，等上链…'));
      return C.waitTx(txh);
    }).then(function (rc) {
      var ok = !rc || rc.status === undefined || BigInt(rc.status || 0) === 1n;
      if (!ok) throw new Error(T('铸造交易被链上回滚了 —— 常见原因：这个哈希已经被别人引爆过、签名过期、或付款金额和合约要的对不上'));
      /* **铸造落地了。** 从这一行往后，无论哪一步失败，用户手上都已经有这枚 NFT，
         失败话术必须走「已经是你的了」那条（见 catch）。 */
      tokenId = mintedIdOf(rc, mu);
      /* uni = 区块号（主编号）。以前这里只存 tokenId，而下面那句话术写的是
         「宇宙 <b>#{n}</b>」—— 等于把 tokenId 摆进了宇宙编号的位置。 */
      S.mintDone = { hash: hash, id: tokenId != null ? tokenId.toString() : null, uni: uniNo() };
      S.own = null;                                   // 链上身份变了：缓存作废，重查
      if (tokenId == null || tokenId === 0n) {
        throw new Error(T('铸造成功了，但回执里没有 Minted 事件，读不出这枚 NFT 的编号 —— 不猜编号是有意的（猜错会去改别人的那一枚）'));
      }
      /* 第 2/3、3/3 步。oldCardHash **就是刚才铸造用的那个 cardHash** ——
         不去链上 cardOf 现读：这一笔刚上链，公开节点的最新块未必已经跟上。 */
      return rescueTail({
        hash: hash, tokenId: tokenId, oldCard: stamp.cardHash, ops: opsArr, from: from,
        total: 3, approveStep: 2, mainStep: 3
      });
    }).then(function (out) {
      S.rescueBusy = false;
      S.mintDone = null;                              // 两头都成了，不再需要那条"已经是你的了"
      if (!S.open) return;
      rescueSay(esc(TN('铸下并拯救成功 —— 宇宙 #{n} 现在是你的了（链上 NFT #{m}），参数也已经按沙盒里这一串改写了。',
        uniNoTxt(), out.tokenId.toString()))
        + (out.burned != null
          /* ARCBANG：同上，销毁的是真美元 */
          ? ' ' + TN(ARC ? '它现在累计销毁 <b>{n} USDC</b>（burnedOn，链上现读）'
                         : '它现在累计烧掉 <b>{n} BANG</b>（burnedOn，链上现读）', esc(bangText(out.burned)))
          : '')
        + (out.q && out.q.art ? ' <a href="' + esc(out.q.art) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">'
          + esc(T('看这张卡的图')) + '</a>' : ''), 'ok');
      render();
    }).catch(function (e) {
      S.rescueBusy = false;
      if (!S.open) return;
      var why = (e && e.code === 4001) ? T('你在钱包里取消了') : String((e && e.message) || e);
      if (S.mintDone) {
        /* **铸造那一笔是实打实拿到东西的。** 这里绝不能笼统说一句"失败了"，
           那会让用户以为钱白花了。
           说清三件事：它已经是你的了、拯救为什么没完成、它现在还是原始状态、去哪儿重来。 */
        var idTxt = S.mintDone.uni;                  // 主编号 = 区块号，不是 tokenId
        rescueSay((idTxt != null
          ? TN('宇宙 <b>#{n}</b> 已经是你的了，但拯救没完成（{m}）。', esc(idTxt), esc(why))
          : TN('这个宇宙已经铸成你的 NFT 了，但拯救没完成（{n}）。', esc(why)))
          + ' ' + esc(T('它现在还是原始状态 —— 铸造那一笔没白花，那枚 NFT 就在你钱包里；重新进沙盒推一遍就能再拯救。'))
          + ' <a href="' + MARKET_URL + '">' + esc(T('到市场页找到它')) + '</a>', 'warn');
      } else {
        // 第 1 步就没成：什么都没发生，照常提示
        rescueSay(esc((e && e.code === 4001) ? T('你在钱包里取消了') : T('没能铸下并拯救：') + why), 'warn');
      }
      render();
    });
  }

  /* ---------------------------------------------------------- open / close */
  function open(entry) {
    if (!deps() || !doc || !doc.body) return false;   // 引擎或 DOM 没就绪：不开，也不炸
    entry = entry || {};
    if (S.open) close();

    var hash = entry.hash ? String(entry.hash) : null;
    // 同一个哈希再打开就接着上次推：Esc 是很容易误按的，推了二十格被清零谁都要骂人
    S.box = (S.saved && S.saved.hash && hash && S.saved.hash === hash) ? S.saved.box : createSandbox(entry);
    S.saved = { hash: hash, box: S.box };
    S.meta = { hash: hash, blockNumber: entry.blockNumber != null ? entry.blockNumber : null, label: entry.label || '' };
    S.lastOutcome = null;
    S.tipBusy = false;
    // 每次打开都从"没有上一帧"重新起算：留着上次的基准会在开面板那一瞬间闪一串假箭头
    S.lastNode = null; S.prevGauge = null; S.hover = false; S.shown = null; S.doom = null;
    S.stage = null; S.plan = null; S.dimBusy = false;
    /* 自动推不跨面板：关掉再开，上一轮的步数和「推不动了」都不作数 */
    S.auto = { on: false, stop: false, n: 0, goal: null, last: null, t0: 0, why: null, whyAt: 0,
               best: null, stall: 0, escapes: 0 };
    S.busyAt = null; S.busyWhat = null; S.lastStep = null;
    S.lastNudge = 0;
    if (S.thaw) { root.clearTimeout(S.thaw); S.thaw = null; }

    ensureEl();
    S.el.hidden = false;
    S.open = true;
    $('miTip').hidden = true;
    doc.addEventListener('keydown', onKey);
    act('');
    return true;
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    /* 自动推当场断链：面板关了还留着一串定时器，回到起爆页仍在发请求，
       而用户以为自己已经退出来了。三个 busy 一起清 —— 只要有一个赖着不走，
       下次开面板满屏按钮都是灰的（「推了以后什么都点不动」就是这么来的）。 */
    S.auto.on = false; S.auto.stop = false;
    S.dimBusy = false; S.oceanBusy = false; S.tipBusy = false;
    busyOff();
    if (S.el) S.el.hidden = true;
    doc.removeEventListener('keydown', onKey);
  }

  function isOpen() { return !!S.open; }

  /* ---------------------------------------------------------- 切语言
     面板骨架是 innerHTML 拼进来的，而 i18n 的 DOM 遍历只翻译**整段完全命中**的文本节点，
     兜不住按钮标题、title 属性和这些拼出来的句子。所以换语言时把面板整块丢掉重建 ——
     沙盒状态（S.box：推过几格、trail、ops）不在 DOM 里，重建一格都不会丢。
     见 web/i18n.js 顶部「动态渲染的部分自己重画一遍」。 */
  if (doc && doc.addEventListener) {
    doc.addEventListener('mirror:lang', function () {
      if (!S.el) return;                                   // 还没开过沙盒：下次现拼就是新语言
      if (S.el.parentNode) S.el.parentNode.removeChild(S.el);
      S.el = null; S.rows = null; S.rowsBox = null; S.shown = null; S.lastOutcome = null;
      if (!S.open) return;
      ensureEl();
      S.el.hidden = false;
      render();
    });
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    /* 以下是给自测和别的模块用的纯逻辑，不碰 DOM */
    createSandbox: createSandbox,
    compactOps: compactOps,
    doomVerdict: doomVerdict,
    narrowKeys: narrowKeys,
    fastSuggest: fastSuggest,
    fixedGates: fixedGates,
    /* 维度求解器。纯本地、只用公开的 params/engine，**不碰生存半径** ——
       导出它是为了 Node 自测能直接对着它跑覆盖率（实测 379/379）。 */
    dimSolve: dimSolve,
    /* 假死看门狗的取数口（ui/app.js 的 wdSnapshot）。面板没开就是 null；
       **绝不抛** —— 它是在「页面刚卡完」那一拍被调用的，自己再炸一次就什么都留不下。 */
    wdInfo: function () {
      try {
        if (!S.open || !S.box) return null;
        return {
          target: S.goal,                                      // 'observers' / 'ocean'
          busyMs: S.busyAt ? Math.round(now() - S.busyAt) : 0,  // 这件重活已经跑了多久（0 = 没在跑）
          busyWhat: S.busyWhat || null,                         // 'oceanPlan' / 'dim' / 'ocean' / 'suggest'
          lastStep: S.lastStep || null,                         // 最后真推下去的那一步
          auto: S.auto.on ? { on: true, n: S.auto.n, goal: S.auto.goal } : null,
          steps: S.box.steps(), moves: S.box.moves()
        };
      } catch (e) { return null; }
    },
    dimPlateau: dimPlateau,
    DIM_KEYS: DIM_KEYS,
    MODULES_OFF: MODULES_OFF
    /* 步长与半径表不再存在于这个文件里，自然也没得导出（见文件头）。
       unitCost / totalCost 一并去掉：费用改用服务端返回的那个数，
       本地再留一条自己编的曲线只会和真收的钱对不上。 */
  };
});
