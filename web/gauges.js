/*
 * web/gauges.js —— 余量仪表盘
 * ------------------------------------------------------------
 * 把一次模拟结果翻译成「离生命还有多远」。
 *
 * 为什么非要有这块：12 个离散结局构成的是平台。把一个死于无碳化学的宇宙的 α 连续扫向
 * 我们的值，ξ 从 0.8635 平滑降到 0.6508、f_O 从 0.0187 爬到 0.0499 —— 物理一直在变好，
 * 而结局标签全程不变。玩家推一格如果屏幕上什么都不变，这个游戏就是死的。
 * 所以这里同时显示两层：26 道布尔门（粗粒度阶梯，看得见"又打通一道"）
 * 和 8 个连续余量（真正的梯度，看得见"推对了方向"）。
 *
 * API：
 *   MirrorGauges.GATES / METERS        定义表（别的模块可以直接读，别改它）
 *   MirrorGauges.compute(sim)          sim = MirrorEngine.simulate(...) 的返回值
 *     → { gates:{passed,total,failed:[{id,label,section,key,want,why}]},
 *         meters:[{id,label,value,display,target,progress,good,hint,na}],
 *         score: 0..100 }
 *   MirrorGauges.render(el, cur, prev)  渲染进 el；prev 非空时显示变化箭头与增量
 *   MirrorGauges.selfTest()             → {ok, fails}
 *
 * UMD：Node 下 module.exports = MirrorGauges，浏览器下 window.MirrorGauges。
 * 零外部依赖；**加载本身没有任何副作用**（样式要等第一次 render 才注入，
 * 不 render 就不碰 DOM），所以别的模块可以随便在任何时机引它。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.MirrorGauges = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DOC = typeof document !== 'undefined' ? document : null;
  var DASH = '—';                                  // 没读数一律显示这个，绝不让 NaN 上界面
  var STYLE_ID = 'mirrorGaugesCSS';

  /* i18n。词条在 web/i18n-tools.js，机制见 web/i18n.js 顶部。
     **只在 render 的时候过一遍**，GATES / METERS 里存的仍旧是中文原文：
     那两张表别的模块要读（compute 的返回值里也带着它们），把它们在加载时就换成英文，
     切回中文就没得换了；而且 i18n 缺席（Node 自测、离线单文件）时 T 原样退回中文。 */
  var W = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null);
  function T(s) { var I = W && W.MirrorI18n; return (I && I.t) ? I.t(s, 'tools') : s; }
  /** 句子里带数字时用 {n} 占位再回填 —— 整句当 key，英文才排得开词序 */
  /** 句子里带数字时用 {n}、{m} 占位再回填。整句当 key，英文才排得开词序。
      原来只认 {n} —— 于是两个数字的句子会把 '{m}' 原样印到界面上。 */
  function TN(s, n, m) {
    var r = T(s).replace('{n}', String(n));
    return m == null ? r : r.replace('{m}', String(m));
  }
  function TL(list) { return list.map(function (s) { return T(s); }).join(T('、')); }

  /* ============================================================ 26 道布尔门
     字段名与 半径表的离线标定脚本 顶部那张 GATES 表逐条对应 —— 那张表是实测
     救活率 83% 的评分函数在用的，两边一旦对不上，玩家就会看到"门数涨了但提示说没变好"。
     want 是「通过时应该等于」：三道反向门（分数维、双质子、越界）通过时为 false。 */
  var GATES = [
    { id: 'dims.orbitsOK', section: 'dims', key: 'orbitsOK', want: true, label: '轨道能稳定',
      why: '只有三维空间里的平方反比引力才有稳定的圆轨道；维数一变，行星要么掉进恒星，要么直接飞走。' },
    { id: 'dims.gravityOK', section: 'dims', key: 'gravityOK', want: true, label: '引力能束缚',
      why: '维数不对时引力势没有束缚态，气体云永远凝不成恒星和行星。' },
    { id: 'dims.fractional', section: 'dims', key: 'fractional', want: false, label: '维数是整数',
      why: '分数维空间里连"绕一圈回到原地"都不成立，整套物理模型在这里失效。' },
    { id: 'baryons.cpViolation', section: 'baryons', key: 'cpViolation', want: true, label: 'CP 对称有破缺',
      why: '没有 CP 破坏，正反物质就等量湮灭，宇宙里只剩一片光子，没有任何实物。' },
    { id: 'baryons.hasBaryons', section: 'baryons', key: 'hasBaryons', want: true, label: '剩下了重子',
      why: '重子不对称度归零，就没有质子和中子可用，后面的一切都无从谈起。' },
    { id: 'recombination.sahaWindow', section: 'recombination', key: 'sahaWindow', want: true, label: '复合发生过',
      why: '电子和质子必须能结合成中性氢，光才跑得出来、物质才开始塌缩。' },
    { id: 'bbn.deuteronBound', section: 'bbn', key: 'deuteronBound', want: true, label: '氘核能成键',
      why: '氘是所有核合成的第一级台阶，它一散架，恒星就点不着火。' },
    { id: 'bbn.diprotonBound', section: 'bbn', key: 'diprotonBound', want: false, label: '双质子不成键',
      why: '如果双质子能结合，氢会在大爆炸的几分钟里烧光，恒星再没有燃料。' },
    { id: 'bbn.deuteronBetaStable', section: 'bbn', key: 'deuteronBetaStable', want: true, label: '氘不会 β 衰变',
      why: '氘要是会自发衰变，刚合成就没了，核合成链断在第一步。' },
    { id: 'structure.structureFormed', section: 'structure', key: 'structureFormed', want: true, label: '结构长起来了',
      why: '密度涨落必须能塌缩成星系，否则宇宙永远是一锅越来越稀的均匀气体。' },
    { id: 'structure.weinbergOK', section: 'structure', key: 'weinbergOK', want: true, label: '暗能量没提前接管',
      why: 'Λ 太大的话，星系还没来得及塌缩就被膨胀撕散了。' },
    { id: 'stars.canIgnite', section: 'stars', key: 'canIgnite', want: true, label: '恒星能点火',
      why: '气体云中心得热到能引发核聚变，否则满天都是不发光的褐矮星。' },
    { id: 'stars.heavyElements', section: 'stars', key: 'heavyElements', want: true, label: '能锻造重元素',
      why: '只有氢和氦的宇宙做不出岩石行星，也做不出任何生物分子。' },
    { id: 'stars.carbonOK', section: 'stars', key: 'carbonOK', want: true, label: '碳能被合成',
      why: '碳是生化骨架，三氦过程一旦失灵，有机化学就没有原料。' },
    { id: 'stars.supernovaOK', section: 'stars', key: 'supernovaOK', want: true, label: '超新星能把元素扔出来',
      why: '重元素若锁死在恒星尸体里，行星和生命一克也拿不到。' },
    { id: 'stars.outOfAdamsScope', section: 'stars', key: 'outOfAdamsScope', want: false, label: '恒星模型仍适用',
      why: '参数跑出了 Adams 恒星判据的适用范围，这里给的结论已经不可信。' },
    { id: 'atoms.hydrogen', section: 'atoms', key: 'hydrogen', want: true, label: '氢是稳定的',
      why: '最简单的原子都留不住的话，宇宙里不会有任何化学。' },
    { id: 'atoms.atoms', section: 'atoms', key: 'atoms', want: true, label: '原子能存在',
      why: '电子必须能被原子核束缚住，否则物质永远停在等离子体状态。' },
    { id: 'atoms.molecules', section: 'atoms', key: 'molecules', want: true, label: '分子能成键',
      why: '原子之间要能共享电子并保持刚性，否则没有任何化合物。' },
    { id: 'atoms.chemistry', section: 'atoms', key: 'chemistry', want: true, label: '化学足够丰富',
      why: '能用的元素种类太少，搭出来的分子撑不起生命这么复杂的东西。' },
    { id: 'planets.timeOK', section: 'planets', key: 'timeOK', want: true, label: '时间够用',
      why: '行星要赶在恒星死掉之前形成，还得留出足够长的演化余裕。' },
    { id: 'planets.qOK', section: 'planets', key: 'qOK', want: true, label: '涨落幅度合适',
      why: 'Q 太小结构太松散，太大则处处是黑洞，两头都长不出行星系。' },
    { id: 'planets.planetsOK', section: 'planets', key: 'planetsOK', want: true, label: '行星能形成',
      why: '要有固体尘埃可用、引力又能把它们黏起来，行星才凝得出来。' },
    { id: 'biochem.hoyleOK', section: 'biochem', key: 'hoyleOK', want: true, label: 'Hoyle 共振对得上',
      why: '碳-12 那条 7.65 MeV 共振偏一点，碳氧比就崩，生化拿不到原料。' },
    { id: 'biochem.waterOK', section: 'biochem', key: 'waterOK', want: true, label: '液态水窗口存在',
      why: '恒星周围得有一圈距离，让水既不结冰也不沸腾。' },
    { id: 'biochem.complexOK', section: 'biochem', key: 'complexOK', want: true, label: '复杂化学可行',
      why: '碳氮氧磷硫硅要同时到场，才搭得出蛋白质、核酸这一类大分子。' }
  ];

  /* ============================================================ 8 个连续仪表
     这些才是玩家真正盯着的指针：结局标签不动的时候，是它们在动。
     prog 一律归一到 0..1（1 = 和我们宇宙一样好），好让 score 能直接取均值；
     ok 用的阈值抄自 engine/engine.js 里对应的判据，免得"仪表全绿但门是红的"。 */
  var METERS = [
    { id: 'xi', label: 'Hoyle 共振偏移', path: 'biochem.xi', unit: '', target: '→ 0',
      prog: function (v) { return 1 / (1 + Math.abs(v)); },
      ok: function (v) { return Math.abs(v) <= 0.3; },              // 引擎在 |ξ|>0.3 时就开始报 warn
      hint: '碳-12 的 7.65 MeV 共振偏了多远。越接近 0，三氦过程的碳氧产率越正常。' },
    { id: 'fC', label: '碳产率', path: 'biochem.fC', unit: '', target: '→ 1',
      prog: function (v) { return v; },
      ok: function (v) { return v >= 0.05; },                       // engine: hoyleOK 要求 fC ≥ 0.05
      hint: '三氦过程产碳的相对产率，低于 0.05 就没有有机化学的原料。' },
    { id: 'fO', label: '氧产率', path: 'biochem.fO', unit: '', target: '→ 1',
      prog: function (v) { return v; },
      ok: function (v) { return v >= 0.05; },
      hint: '产氧的相对产率，低于 0.05 就既没有水也没有氧化还原化学。' },
    { id: 'water', label: '液态水窗口', path: 'biochem.dWater', unit: 'AU', target: '→ 1 AU',
      prog: function (v) { return v > 0 ? 1 / (1 + Math.abs(log10(v))) : 0; },
      ok: function (v) { return v > 0 && Math.abs(log10(v)) <= 1; }, // 与 1 AU 差不超过一个数量级
      hint: '行星表面能维持液态水的轨道半径，越接近 1 AU 越像我们这里。' },
    { id: 'weinberg', label: '结构涨落余量', path: 'structure.weinbergRatio', unit: '', target: '< 1',
      prog: function (v) { return v < 1 ? 1 : 1 / v; },
      ok: function (v) { return v < 1; },                            // engine: weinbergOK 就是这一式
      hint: '真空能与 Weinberg 上界之比。超过 1，星系在塌缩完成前就被膨胀撕散。' },
    { id: 'starLife', label: '恒星寿命', path: 'stars.tMSGyr', unit: 'Gyr', target: '≥ 5 Gyr',
      prog: function (v) { return v / 10; },
      ok: function (v) { return v >= 5; },
      hint: '一颗太阳质量恒星的主序寿命。太短，行星上来不及演化出复杂化学。' },
    { id: 'age', label: '宇宙年龄', path: 'expansion.ageGyr', unit: 'Gyr', target: '≥ 5 Gyr',
      prog: function (v) { return v / 13.8; },
      ok: function (v) { return v >= 5; },
      hint: '从大爆炸到现在走了多久。会大挤压或大撕裂的宇宙在这里就提前收场了。' },
    { id: 'viewTime', label: '可观测时长', path: 'outcome.viewTimeGyr', unit: 'Gyr', target: '≥ 5 Gyr',
      prog: function (v) { return v / 19; },
      ok: function (v) { return v >= 5; },
      hint: '这个宇宙留给观察者的时间窗口有多长。' }
  ];

  /* ============================================================ 小工具 */
  function log10(v) { return Math.log(v) / Math.LN10; }

  /** 引擎在极端参数下会给出 null / NaN / 整段缺失，一律折成 null 当"没读数"。
      注意 ±Infinity 是保留的：weinbergRatio 无穷大是真实结论（Λ 是上界的无穷倍），
      不是算坏了，界面上显示 ∞ 比显示 — 更有信息量。 */
  function num(v) { return (typeof v === 'number' && !isNaN(v)) ? v : null; }

  function clamp01(v) {
    if (typeof v !== 'number' || isNaN(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /** 大部分字段挂在 sim.calc 下，只有 outcome.viewTimeGyr 挂在顶层。
      两个根都走一遍，比为一个字段单开一张路径表干净。 */
  function pick(sim, path) {
    if (!sim) return null;
    var parts = path.split('.'), roots = [sim.calc, sim], i, j, cur;
    for (i = 0; i < roots.length; i++) {
      cur = roots[i];
      for (j = 0; j < parts.length; j++) {
        if (cur == null || typeof cur !== 'object') { cur = null; break; }
        cur = cur[parts[j]];
      }
      if (cur != null) return cur;
    }
    return null;
  }

  function trimZero(s) {
    // 1.500 → 1.5、1.000 → 1；指数写法的尾数同样处理（1.20e-5 → 1.2e-5）
    return String(s).replace(/(\.\d*?)0+(?=($|e))/, '$1').replace(/\.(?=($|e))/, '');
  }

  function fmtNum(v) {
    if (v === null) return DASH;
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '-∞';
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e5 || a < 1e-4) return trimZero(v.toExponential(2));
    return trimZero(a >= 100 ? v.toFixed(1) : (a >= 1 ? v.toFixed(3) : v.toFixed(4)));
  }

  function signed(v) {
    if (v > 0) return '+' + fmtNum(v);
    if (v < 0) return '-' + fmtNum(-v);
    return '0';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function pct(v) { return (clamp01(v) * 100).toFixed(1) + '%'; }

  /* ============================================================ 计算 */
  function computeGates(sim) {
    var calc = (sim && sim.calc) || null, failed = [], passed = 0, i, g, sec;
    for (i = 0; i < GATES.length; i++) {
      g = GATES[i];
      sec = calc ? calc[g.section] : null;
      // 判法与 半径表的离线标定脚本 的 gatesPassed() 逐位一致：整段缺失算不通过，
      // 段在而字段缺失按 falsy 判。这是刻意对齐 —— 仪表盘的门数必须和 MirrorHint
      // 的评分用同一把尺子，否则会出现"门数变了但提示说没变好"这种自相矛盾。
      if (sec && !!sec[g.key] === g.want) passed++;
      else failed.push({ id: g.id, label: g.label, section: g.section, key: g.key, want: g.want, why: g.why });
    }
    return { passed: passed, total: GATES.length, failed: failed };
  }

  function computeMeters(sim) {
    var out = [], i, m, v, p;
    for (i = 0; i < METERS.length; i++) {
      m = METERS[i];
      v = num(pick(sim, m.path));
      p = v === null ? 0 : clamp01(m.prog(v));
      out.push({
        id: m.id, label: m.label, value: v,
        display: v === null ? DASH : (fmtNum(v) + (m.unit ? ' ' + m.unit : '')),
        target: m.target, progress: p,
        good: v !== null && !!m.ok(v),
        hint: m.hint, na: v === null
      });
    }
    return out;
  }

  function compute(sim) {
    var gates = computeGates(sim), meters = computeMeters(sim), i, sum = 0;
    for (i = 0; i < meters.length; i++) sum += meters[i].progress;
    // 拿不到读数的仪表按 0 计：那说明这一段物理压根没算出来（通常是宇宙早就死了），
    // 当"不扣分"处理会让一个空壳宇宙显示出虚高的分数。
    var mean = meters.length ? sum / meters.length : 0;
    return {
      gates: gates, meters: meters,
      score: Math.round(gates.passed / gates.total * 70 + mean * 30)
    };
  }

  /* ============================================================ 样式
     全部走主题变量：这块要同时塞进浅色的起爆页和深色的 HUD，写死颜色两边都不对。 */
  var CSS = [
    '.mg{font-size:12px;line-height:1.5;color:var(--ink2);font-family:var(--sans)}',
    /* 头一行：**还差几道门**在左（那是行动信息），总分退到右边（那只是个感觉） */
    '.mg-top{display:flex;align-items:baseline;gap:8px}',
    '.mg-left{font-size:13px;font-weight:700;color:var(--ink)}',
    '.mg-score{font-family:var(--mono);font-size:15px;font-weight:700;color:var(--ink2);line-height:1}',
    '.mg-score-u{font-size:10.5px;font-weight:400;color:var(--dim2)}',
    '.mg-n{margin-left:auto;color:var(--dim);font-family:var(--mono);white-space:nowrap}',
    '.mg-track{height:5px;border-radius:var(--radius-chip);background:var(--sel);overflow:hidden;',
    '  margin:7px 0 4px}',
    '.mg-track>i{display:block;height:100%;background:var(--cyan);border-radius:var(--radius-chip)}',
    '.mg-track.win>i{background:var(--green)}',
    /* 收起来的东西要留一句交代，不然看着像"仪表不见了" */
    '.mg-hid{margin-top:6px;font-size:11px;color:var(--dim2);line-height:1.6}',
    /* 展开/收起 */
    '.mg-more{margin-top:10px;width:100%;background:var(--panel2);border:1px solid var(--line);',
    '  color:var(--ink3);font-family:var(--sans);font-size:11.5px;padding:7px 12px;',
    '  border-radius:var(--radius-btn);cursor:pointer;min-height:32px}',
    '.mg-more:hover{border-color:var(--cyan-line);color:var(--cyan);background:var(--sel2)}',
    '.mg-more:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    /* 增量：整个玩法的核心反馈，宁可抢眼也不要含蓄 */
    '.mg-d{font-family:var(--mono);font-size:11px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap}',
    '.mg-d.up{color:var(--green);background:var(--green-bg)}',
    '.mg-d.down{color:var(--bad);background:var(--red-bg)}',
    '.mg-news{margin:6px 0 2px}',
    '.mg-news>div{padding:2px 5px;border-radius:3px;font-weight:600}',
    '.mg-news .win{color:var(--green);background:var(--green-bg)}',
    '.mg-news .lose{color:var(--bad);background:var(--red-bg)}',
    /* 仪表 */
    '.mg-ms{margin-top:8px}',
    '.mg-m{padding:4px 5px;border-radius:4px}',
    '.mg-m-h{display:flex;align-items:baseline;gap:6px}',
    '.mg-m-l{color:var(--ink2);white-space:nowrap}',
    '.mg-m-t{color:var(--dim2);font-size:11px;white-space:nowrap}',
    '.mg-m-v{margin-left:auto;font-family:var(--mono);color:var(--ink);white-space:nowrap}',
    '.mg-m.na .mg-m-v,.mg-m.na .mg-m-l{color:var(--dim2)}',
    '.mg-m-bar{height:3px;border-radius:2px;background:var(--line-faint);overflow:hidden;margin-top:3px}',
    '.mg-m-bar>i{display:block;height:100%;background:var(--amber)}',
    '.mg-m.ok .mg-m-bar>i{background:var(--green)}',
    '.mg-m.na .mg-m-bar{background:transparent;border-top:1px dashed var(--line)}',
    '.mg-m-hint{color:var(--dim);font-size:11px;margin-top:2px}',
    /* 未通过的门 */
    '.mg-fail{margin-top:10px;border-top:1px solid var(--line-soft);padding-top:8px}',
    '.mg-h{color:var(--dim);margin-bottom:4px}',
    '.mg-g{padding:3px 0;border-bottom:1px solid var(--line-faint)}',
    '.mg-g:last-child{border-bottom:0}',
    '.mg-g b{color:var(--bad)}',
    '.mg-g span{color:var(--dim)}',
    '.mg-all{margin-top:10px;border-top:1px solid var(--line-soft);padding-top:8px;color:var(--green);font-weight:600}',
    '.mg-empty{color:var(--dim2)}',
    /* 变化的那一行闪一下。innerHTML 重建后节点是新的，动画每次都会重放，
       正好省掉一套定时器 */
    '@keyframes mg-up{from{background:var(--green-bg)}to{background:transparent}}',
    '@keyframes mg-down{from{background:var(--red-bg)}to{background:transparent}}',
    '.mg-m.up{animation:mg-up 1s ease-out}',
    '.mg-m.down{animation:mg-down 1s ease-out}'
  ].join('\n');

  var cssDone = false;
  function ensureCSS() {
    if (cssDone || !DOC || !DOC.head) return;
    cssDone = true;
    if (DOC.getElementById(STYLE_ID)) return;       // 别的实例已经注过了
    var s = DOC.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    DOC.head.appendChild(s);
  }

  /* ============================================================ 渲染 */
  /** 方向按"是否变好"判、数字按原值给：ξ 变小是好事，但增量本身是负数，
      两者分开才不会出现绿色的 −0.12 看着像坏消息。 */
  function chip(dir, text) {
    if (!dir) return '';
    return '<span class="mg-d ' + (dir > 0 ? 'up' : 'down') + '">' +
      (dir > 0 ? '↑' : '↓') + ' ' + esc(text) + '</span>';
  }

  function meterRow(m, pm) {
    var dir = 0, txt = '', cls = m.na ? 'na' : (m.good ? 'ok' : '');
    if (pm) {
      var dp = m.progress - pm.progress;
      if (Math.abs(dp) > 1e-9) {
        dir = dp > 0 ? 1 : -1;
        // 有原值就报原值的变化（玩家看得懂"ξ 少了 0.12"），只有一头缺读数时才退回百分点
        txt = (m.value !== null && pm.value !== null && isFinite(m.value) && isFinite(pm.value))
          ? signed(m.value - pm.value)
          : signed(Math.round(dp * 1000) / 10) + '%';
        cls += ' ' + (dir > 0 ? 'up' : 'down');
      }
    }
    return '<div class="mg-m ' + cls + '" title="' + esc(T(m.hint)) + '">' +
      '<div class="mg-m-h"><span class="mg-m-l">' + esc(T(m.label)) + '</span>' +
      '<span class="mg-m-t">' + esc(m.target) + '</span>' +
      '<span class="mg-m-v">' + esc(m.display) + ' ' + chip(dir, txt) + '</span></div>' +
      '<div class="mg-m-bar"><i style="width:' + pct(m.progress) + '"></i></div>' +
      // 一切正常时不占地方，出问题了才把人话解释摊开——面板本来就窄
      (m.good ? '' : '<div class="mg-m-hint">' + esc(T(m.hint)) + '</div>') +
      '</div>';
  }

  /** 上一帧到这一帧之间，哪几道门刚打通、哪几道刚被弄坏 */
  function gateNews(cur, prev) {
    var was = {}, i, h = [];
    for (i = 0; i < prev.gates.failed.length; i++) was[prev.gates.failed[i].id] = prev.gates.failed[i];
    var now = {};
    for (i = 0; i < cur.gates.failed.length; i++) now[cur.gates.failed[i].id] = cur.gates.failed[i];
    var fixed = [], broke = [];
    for (i = 0; i < GATES.length; i++) {
      if (was[GATES[i].id] && !now[GATES[i].id]) fixed.push(GATES[i].label);
      if (!was[GATES[i].id] && now[GATES[i].id]) broke.push(GATES[i].label);
    }
    if (fixed.length) h.push('<div class="win">✓ ' + esc(T('刚打通：') + TL(fixed)) + '</div>');
    if (broke.length) h.push('<div class="lose">✗ ' + esc(T('刚弄坏：') + TL(broke)) + '</div>');
    return h.length ? '<div class="mg-news">' + h.join('') + '</div>' : '';
  }

  /* ============================================================ 「还差什么」而不是「全部指标」

     以前这一块**永远**摊开全部内容：一个 86/100 的总分、8 个连续仪表、
     外加"还差这 N 道门"的完整清单。玩家要的是「我还差什么」，
     不是一张同样重的全指标表 —— 达标的那些正因为达标了才不需要占地方。

     所以默认（failedOnly）只留三样：
       ① 还差几道门（一行）
       ② **没达标**的仪表（达标的收起来，但"这一帧刚变过"的照样留着 —— 那是推格的反馈，
          正是玩家在找的东西，收掉它等于把游戏的反馈环剪断）
       ③ 没过的门，最多 4 条（门有因果顺序，前面那道不过后面大多会自己好）
     全部 26 道门 + 全部 8 个仪表做成一颗展开按钮，状态记在模块里，切换不重置沙盒。 */
  var expandAll = false;

  /** 展开/收起是这一块自己的事，不劳干预面板管。委托绑一次，innerHTML 重画也不会掉 */
  function bindToggle(node) {
    if (!node || node.__mgBound) return;
    node.__mgBound = 1;
    node.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== node && !(t.getAttribute && t.getAttribute('data-mg-all'))) t = t.parentNode;
      if (!t || t === node) return;
      e.preventDefault();
      expandAll = !expandAll;
      if (typeof node.__mgRedraw === 'function') node.__mgRedraw();
    });
  }

  function render(el, cur, prev, opts) {
    var node = (typeof el === 'string' && DOC) ? DOC.getElementById(el) : el;
    if (!node) return;
    ensureCSS();
    bindToggle(node);
    // 展开按钮按下之后要能就地重画，而重画需要的 cur/prev 只有这里有
    node.__mgRedraw = function () { render(node, cur, prev, opts); };
    if (!cur || !cur.gates) { node.innerHTML = '<div class="mg mg-empty">' + esc(T('还没有读数')) + '</div>'; return; }

    var o = opts || {};
    /* failedOnly 由调用方给（干预面板的「简明视图」开关）。
       展开按钮一按就整块摊开，压过 failedOnly。 */
    var lean = !!o.failedOnly && !expandAll;
    var g = cur.gates, h = [], i, m, pm;
    var dScore = prev ? cur.score - prev.score : 0;
    var dGate = prev ? g.passed - prev.gates.passed : 0;

    h.push('<div class="mg' + (lean ? ' lean' : '') + '">');
    /* 第一行先说**还差几道**，总分退到后面 —— "还差 4 道"是行动信息，
       "86/100"只是个感觉。原来是反过来的。 */
    h.push('<div class="mg-top">' +
      '<span class="mg-left">' +
      (g.failed.length ? esc(TN('还差 {n} 道门', g.failed.length)) : esc(T('门全通了'))) +
      '</span>' +
      chip(dGate > 0 ? 1 : (dGate < 0 ? -1 : 0), signed(dGate)) +
      '<span class="mg-n"><span class="mg-score">' + cur.score + '</span>' +
      '<span class="mg-score-u">/100</span> ' +
      chip(dScore > 0 ? 1 : (dScore < 0 ? -1 : 0), signed(dScore)) + '</span></div>');
    h.push('<div class="mg-track' + (g.passed === g.total ? ' win' : '') + '">' +
      '<i style="width:' + pct(cur.score / 100) + '"></i></div>');

    if (prev) h.push(gateNews(cur, prev));

    /* 仪表。lean 模式下只留没达标的，外加**这一帧刚动过的**那些 ——
       后者是推一格之后唯一会动的东西，收掉它玩家就看不见自己推对了没有。 */
    var rows = [], hid = 0;
    for (i = 0; i < cur.meters.length; i++) {
      m = cur.meters[i];
      pm = prev ? findMeter(prev.meters, m.id) : null;
      var changed = !!(pm && Math.abs(m.progress - pm.progress) > 1e-9);
      if (lean && m.good && !changed) { hid++; continue; }
      rows.push(meterRow(m, pm));
    }
    if (rows.length) h.push('<div class="mg-ms">' + rows.join('') + '</div>');
    if (hid) {
      h.push('<div class="mg-hid">' + esc(TN('另外 {n} 个仪表已经达标，收起来了', hid)) + '</div>');
    }

    if (g.failed.length) {
      /* 门有因果顺序：前面那道不过，后面这些大多会跟着自己好。
         所以默认只摊前 4 条，其余折进一行。 */
      var cap = lean ? Math.min(4, g.failed.length) : g.failed.length;
      h.push('<div class="mg-fail"><div class="mg-h">' +
        esc(lean && cap < g.failed.length
          ? TN('先修这几道（共 {n} 道没过）：', g.failed.length)
          : TN('还差这 {n} 道门：', g.failed.length)) + '</div>');
      for (i = 0; i < cap; i++) {
        h.push('<div class="mg-g"><b>' + esc(T(g.failed[i].label)) + '</b> ' +
          '<span>' + esc(T(g.failed[i].why)) + '</span></div>');
      }
      h.push('</div>');
    } else {
      // 门数从 g.total 来，别写死 26 —— 门表一改这句就成了假话
      h.push('<div class="mg-all">' +
        esc(TN('{n} 道门全通了 —— 这个宇宙可以有观察者。', g.total)) + '</div>');
    }

    // 展开/收起：只有确实藏了东西、或者已经展开了，才值得摆这颗按钮
    if (o.failedOnly && (expandAll || hid || g.failed.length > 4)) {
      h.push('<button type="button" class="mg-more" data-mg-all="1">' +
        esc(expandAll
          ? T('收起 —— 只看还差什么')
          : TN('摊开全部 {n} 道门和 {m} 个仪表', g.total, cur.meters.length)) +
        '</button>');
    }
    h.push('</div>');
    node.innerHTML = h.join('');
  }

  function findMeter(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ============================================================ 自测
     不碰引擎（保持零依赖）：门表用合成的 sim 喂，数值用我们宇宙的实测值。
     node -e "console.log(require('./web/gauges.js').selfTest())" 就能跑。 */
  function selfTest() {
    var fails = [], i, seen = {};

    if (GATES.length !== 26) fails.push('门应该是 26 道，实际 ' + GATES.length);
    if (METERS.length !== 8) fails.push('连续仪表应该是 8 个，实际 ' + METERS.length);
    for (i = 0; i < GATES.length; i++) {
      if (seen[GATES[i].id]) fails.push('门 id 重复：' + GATES[i].id);
      seen[GATES[i].id] = 1;
      if (!GATES[i].label || !GATES[i].why) fails.push('门缺标签或解释：' + GATES[i].id);
    }

    // 空输入：不能抛错，分数为 0，一个 NaN 都不许漏出去
    var empty = compute(null);
    if (empty.score !== 0) fails.push('空输入的分数应该是 0，实际 ' + empty.score);
    if (empty.gates.passed !== 0) fails.push('空输入不该有门通过');
    for (i = 0; i < empty.meters.length; i++) {
      if (empty.meters[i].display !== DASH) fails.push('空输入的 ' + empty.meters[i].id + ' 应显示 —');
      if (isNaN(empty.meters[i].progress)) fails.push('空输入的 ' + empty.meters[i].id + ' progress 是 NaN');
    }

    // 我们的宇宙：26/26、100 分
    var ours = fakeSim(true, { xi: 0, fC: 1, fO: 1, dWater: 1, weinbergRatio: 0.2018, tMSGyr: 10, ageGyr: 13.8, viewTimeGyr: 19 });
    var r = compute(ours);
    if (r.gates.passed !== 26) fails.push('我们的宇宙应该 26/26，实际 ' + r.gates.passed);
    if (r.score !== 100) fails.push('我们的宇宙应该 100 分，实际 ' + r.score);

    // 脏数据：null / NaN / 字符串 / 缺段，全部要折成 —，且不抛错
    var dirty = fakeSim(false, { xi: NaN, fC: null, fO: 'x', dWater: undefined, weinbergRatio: Infinity, tMSGyr: NaN, ageGyr: undefined, viewTimeGyr: null });
    var d = compute(dirty);
    for (i = 0; i < d.meters.length; i++) {
      if (d.meters[i].id === 'weinberg') continue;                 // ∞ 是真结论，保留
      if (d.meters[i].display !== DASH) fails.push('脏数据的 ' + d.meters[i].id + ' 应显示 —，实际 ' + d.meters[i].display);
    }
    if (isNaN(d.score)) fails.push('脏数据算出了 NaN 分');
    if (d.score >= r.score) fails.push('脏数据的分数不该不低于我们的宇宙');

    return { ok: fails.length === 0, fails: fails };
  }

  /** 合成一个只够喂仪表盘的 sim：pass=true 时 26 道门全按 want 填 */
  function fakeSim(pass, vals) {
    var calc = {}, i, g;
    for (i = 0; i < GATES.length; i++) {
      g = GATES[i];
      calc[g.section] = calc[g.section] || {};
      calc[g.section][g.key] = pass ? g.want : !g.want;
    }
    calc.biochem.xi = vals.xi; calc.biochem.fC = vals.fC; calc.biochem.fO = vals.fO;
    calc.biochem.dWater = vals.dWater;
    calc.structure.weinbergRatio = vals.weinbergRatio;
    calc.stars.tMSGyr = vals.tMSGyr;
    calc.expansion = { ageGyr: vals.ageGyr };
    return { calc: calc, outcome: { viewTimeGyr: vals.viewTimeGyr } };
  }

  return {
    GATES: GATES,
    METERS: METERS,
    compute: compute,
    render: render,
    selfTest: selfTest
  };
});
