/*
 * web/onboard.js —— 首次引导 + 新手模式 + 术语人话表（模块 D）
 * ------------------------------------------------------------
 * 用户原话：「目前感觉人机交互尤其是对新手不友好」。拆下来是三件事，本文件管全部三件：
 *
 *   ① 不知道该干什么   → 首次进入走三步引导（哈希决定参数 → 引爆看结局 → 死了可以救），
 *                        可跳过，看过一次就不再弹（localStorage: bnbbang.onboard.v1）。
 *   ② 旋钮太多不知推谁 → 新手模式的**开关与状态**放在这里，沙盒和首页各自去读它，
 *                        免得两处各存一份、切了一处另一处不认（localStorage: bnbbang.novice.v1）。
 *   ③ 术语裸奔         → ξ / f_O / Ω_b h² / weinbergRatio 这类符号一律配人话，
 *                        且**人话在前、符号在后**：新手读第一眼就懂，老手也没丢符号。
 *
 * 为什么结局的人话不自己编：engine/engine.js 的 OUTCOMES 每一条都带 visual 字段，
 * 那才是引擎真正判出来的东西。这里只做「术语 → 口语」的改写，一个物理结论都不新增。
 *
 * 为什么状态要集中：新手模式是**默认开**的，但它必须能一键关掉且记得住。
 * 分散存两份 key 的话，"关掉了又冒出来"是最招人烦的 bug。
 *
 * 依赖：无。DOM 只在 show() 被调用时才碰，加载即无副作用。
 * 缺席容错：别的模块都按 `root.MirrorOnboard && ...` 的写法调用，本文件没加载也不该炸。
 *
 * API：
 *   MirrorOnboard.maybeShow()            没看过就弹引导，返回是否弹了
 *   MirrorOnboard.show(force)            弹引导（force=true 时无视"看过"标记）
 *   MirrorOnboard.seen() / markSeen() / forget()
 *   MirrorOnboard.novice() / setNovice(v) / toggleNovice() / onNovice(fn)
 *   MirrorOnboard.plain(key)             '电磁力有多强'
 *   MirrorOnboard.paramLabel(key)        '电磁力有多强（α）'   ← 人话在前
 *   MirrorOnboard.meterLabel(id)         仪表术语的人话（ξ、f_O、weinbergRatio…）
 *   MirrorOnboard.outcomeLine(id)        结局的一句话人话
 *   MirrorOnboard.outcomeName(id)        结局的中文短名
 *   MirrorOnboard.KEY_SEEN / KEY_NOVICE / STEPS
 *
 *   ④ WebGPU 开不起来也说不清  → 真跑一次 requestAdapter() 做检测（而不是只看 navigator.gpu），
 *                        按"不支持 / 有 API 没适配器 / 能用"三种情况给不同的教程。
 *   MirrorOnboard.gpuProbe(cb)           真探一次，结果缓存；cb(state)
 *   MirrorOnboard.gpuState()             已知结果或 null
 *   MirrorOnboard.gpuRecheck(cb)         丢缓存重探（用户按教程改完 flags 回来复查）
 *   MirrorOnboard.onGpu(fn)              订阅结果变化
 *   MirrorOnboard.showGpuGuide(backEl)   打开教程弹窗
 */
(function (root, doc) {
  'use strict';

  var KEY_SEEN = 'bnbbang.onboard.v1';      // 键名由 定死，别改
  var KEY_NOVICE = 'bnbbang.novice.v1';

  /* ============================================================ 中英双语
     取译文的时刻是**渲染时**，不是定义时。下面的 PLAIN / METER / OUTCOME / STEPS / GPU_*
     都在模块加载时就建好了，在定义处翻一遍等于把语言焊死在加载那一刻，之后切语言
     只能靠刷新页面。所以那些表一个字都不动，只在读出来往 DOM 里放的那一步套 T()。
     词典在 web/i18n-site.js；i18n 核心缺席就原样返回中文，不炸。 */
  function T(s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'site') : s); }
  function curLang() { return (root.MirrorI18n ? root.MirrorI18n.lang() : 'zh'); }

  /* ============================================================ localStorage 包一层
     隐私模式 / 存储被禁时 localStorage 一读就抛。引导弹不出来是小事，
     把整页带崩是大事——所以读写全部吞异常，取不到就按默认值走。 */
  function get(k) {
    try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; }
  }
  function set(k, v) {
    try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* 存不下就算了 */ }
  }
  function del(k) {
    try { if (root.localStorage) root.localStorage.removeItem(k); } catch (e) { /* 同上 */ }
  }

  /* ============================================================ 术语人话表
     规则：人话是主语，符号是括号里的注脚。反过来写（"α（电磁力）"）新手第一眼
     还是先撞上符号，等于没改。 */
  var PLAIN = {
    alpha: '电磁力有多强',
    alphaSMZ: '强核力有多强',
    higgsVev: '希格斯场有多强',
    higgsMass: '希格斯粒子有多重',
    electronMass: '电子有多重',
    mUp: '上夸克有多重',
    mDown: '下夸克有多重',
    thetaQCD: '强核力的对称性偏了多少',
    sumNu: '中微子加起来有多重',
    ckmPhase: '物质比反物质多出来的那一点',
    generations: '基本粒子有几代',
    H0: '宇宙膨胀得有多快',
    omegaBh2: '普通物质有多少',
    omegaCh2: '暗物质有多少',
    omegaLambda: '暗能量有多少',
    As: '早期宇宙的疙瘩有多大',
    ns: '疙瘩在大尺度和小尺度上谁更明显',
    omegaK: '空间是平的还是弯的',
    tcmb: '宇宙背景辐射有多热',
    dimS: '空间有几个维度'
  };

  /* 仪表盘与提示里会冒出来的量。gauges.js 由别人维护，这里不改它，
     只在沙盒的提示区把这些符号翻译一遍。 */
  var METER = {
    xi: '碳的合成窗口偏了多少（越接近 0 越好）',
    fC: '恒星造得出多少碳',
    fO: '恒星造得出多少氧',
    dWater: '能有液态水的轨道离恒星多远',
    water: '能有液态水的轨道离恒星多远',
    weinbergRatio: '暗能量抢跑的程度（小于 1 才来得及长出星系）',
    tMSGyr: '恒星能烧多少亿年',
    gates: '一共 26 道生存关卡，过了几道',
    habitability: '这个宇宙的宜居程度'
  };

  /* 12 个结局的一句话。**依据是 engine/engine.js OUTCOMES 的 visual 字段**，
     只把术语换成口语，不添任何引擎没算的物理。 */
  var OUTCOME = {
    UNSTABLE_ORBITS: { name: '无稳定轨道／原子',
      line: '空间不是三维：行星绕不成圈，电子也待不住，物质在坍缩和飞散之间来回摇摆' },
    BIG_CRUNCH: { name: '大挤压',
      line: '膨胀顶不住了，一切被压回一个点，来不及长出任何东西' },
    BIG_RIP: { name: '大撕裂',
      line: '一切被拉散（这套参数下其实不会出现，得有更古怪的暗能量）' },
    HEAT_DEATH_NO_STRUCTURE: { name: '热寂 · 无结构',
      line: '一锅几乎均匀的气，永远变稀、变冷，连一个星系都没聚起来' },
    BLACK_HOLE_DOMINATED: { name: '黑洞主导',
      line: '早期的疙瘩太大，物质还没冷却成恒星就先塌成了黑洞' },
    NO_ATOMS: { name: '没有原子',
      line: '连原子都搭不起来：要么没剩下物质，要么质子会衰变，要么电子壳层撑不住' },
    NO_CHEMISTRY: { name: '无化学',
      line: '有原子也有光，但缺碳缺氢、分子没有固定形状，拼不出化学' },
    NO_STARS: { name: '没有恒星',
      line: '星系长出来了，却没有一颗恒星点得着，永远是黑的' },
    STARS_NO_LIFE: { name: '有恒星无生命',
      line: '恒星、行星、化学都齐了，但时间不够或者舞台太差，生命没长出来' },
    OBSERVERS_POSSIBLE: { name: '可能诞生观察者',
      line: '星系、恒星、行星、化学都齐了，时间也够 —— 这里可能有人抬头看星星' },
    NO_CARBON_CHEMISTRY: { name: '无碳-水型化学',
      line: '有恒星有行星，但造不出碳（或者没有液态水），长不出生命' },
    BEYOND_MODEL_DIM: { name: '超出模型范围（D≠3）',
      line: '空间不是三维，后面那套物理公式全都不适用了 —— 引擎只能外推，算不准' }
  };

  function plain(key) { return PLAIN[key] ? T(PLAIN[key]) : null; }

  /** 人话（符号）。查不到人话就退回符号本身，绝不返回 undefined 让界面出现空格子 */
  function paramLabel(key, symbol) {
    var p = PLAIN[key];
    var sym = symbol || symbolOf(key) || key;
    if (!p) return sym;
    // 英文用半角括号：全角括号夹在英文句子里，看着像没翻完
    return curLang() === 'en' ? (T(p) + ' (' + sym + ')') : (p + '（' + sym + '）');
  }

  /** 符号从 MirrorParams 取——那是唯一的真源，抄一份到这里迟早会对不上 */
  function symbolOf(key) {
    var P = root.MirrorParams;
    var d = P && P.byKey ? P.byKey[key] : null;
    return d ? d.symbol : null;
  }

  function meterLabel(id) { return METER[id] ? T(METER[id]) : null; }
  function outcomeLine(id) { return (OUTCOME[id] && OUTCOME[id].line) ? T(OUTCOME[id].line) : null; }
  function outcomeName(id) { return (OUTCOME[id] && OUTCOME[id].name) ? T(OUTCOME[id].name) : null; }

  /* ============================================================ 新手模式状态
     默认开：新手是多数，老手点一下就能关，代价不对称。 */
  var listeners = [];

  function novice() {
    var v = get(KEY_NOVICE);
    return v === null ? true : v !== '0';
  }
  function setNovice(on) {
    var was = novice(), now = !!on;
    set(KEY_NOVICE, now ? '1' : '0');
    if (was !== now) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](now); } catch (e) { /* 一个订阅者出错不该拖累别人 */ }
      }
    }
    return now;
  }
  function toggleNovice() { return setNovice(!novice()); }
  function onNovice(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ============================================================ 三步引导 */
  var STEPS = [
    {
      k: '第 1 步',
      t: '一个区块哈希，就是一套物理定律',
      p: 'Arc 链每 0.5 秒产出一个区块，每个区块带一串 64 位哈希。这串数字被拆成 23 个创世参数 —— ' +
         '电磁力有多强、暗能量有多少、空间有几个维度……全由它决定。' +
         '你不需要懂这些参数：换一个区块，就是换一套物理定律。',
      d: '0x9a00…6478　→　23 个物理常数'
    },
    {
      k: '第 2 步',
      t: '引爆，看它长成什么样',
      p: '点「给我一个宇宙」，浏览器会在本地真算一遍这个宇宙的一生：有没有原子、点不点得着恒星、' +
         '造不造得出碳、有没有液态水。最后落进 12 种结局里的一种。' +
         '不用连钱包，也不上链 —— 免费炸，喜欢了再铸造。',
      d: '奇点　→　原子　→　恒星　→　行星　→　有人吗？'
    },
    {
      k: '第 3 步',
      /* 拯救系统整套下线，「救」是那套话术的词，沙盒在这个站上叫「调参沙盒」，
         而且纯粹是玩法 —— 推出来的参数不上链、也铸不了。 */
      t: '死掉的宇宙，能推活',
      p: '结局不好别扔。进「调参沙盒」，照着提示一格一格地推参数，右边的仪表会跟着动 ——' +
         '结局标签常常十几格才跳一次，动的是仪表。实测 83% 的死宇宙能推活，中位 4 步。' +
         '沙盒不花钱、不上链、可撤销，随便试。',
      d: '无碳-水型化学　→　推 4 格　→　可能诞生观察者'
    }
  ];

  var CSS = [
    /* z-index 压在干预沙盒(9600)之上：引导是"现在必须先读完"的那层，
       但仍低于导出/确认框(9999)，免得挡住不可取消的操作 */
    '.ob-box{position:fixed;inset:0;z-index:9700;background:var(--scrim);display:flex;',
    '  align-items:center;justify-content:center;padding:18px}',
    '.ob-box[hidden]{display:none}',
    '.ob-panel{width:min(560px,100%);background:var(--panel);border:1px solid var(--line2);',
    '  border-radius:8px;box-shadow:0 20px 60px var(--shadow);color:var(--ink);overflow:hidden;',
    '  display:flex;flex-direction:column;max-height:min(88vh,720px)}',
    '.ob-head{display:flex;align-items:center;gap:10px;padding:11px 16px;',
    '  border-bottom:1px solid var(--line-soft);background:var(--panel2)}',
    '.ob-k{font-size:11.5px;letter-spacing:.14em;color:var(--cyan);font-weight:700}',
    '.ob-dots{display:flex;gap:6px;margin-left:auto}',
    '.ob-dot{width:7px;height:7px;border-radius:50%;background:var(--line2)}',
    '.ob-dot.on{background:var(--cyan)}',
    '.ob-body{padding:16px 18px 6px;overflow:auto}',
    '.ob-t{margin:0 0 8px;font-size:19px;font-weight:600;letter-spacing:.03em;color:var(--ink)}',
    '.ob-p{margin:0;font-size:13.5px;line-height:1.85;color:var(--ink2)}',
    '.ob-d{margin:14px 0 4px;padding:9px 12px;border:1px dashed var(--cyan-line);border-radius:6px;',
    '  background:var(--cyan-bg);font-family:var(--mono);font-size:12px;color:var(--ink2);',
    '  text-align:center;white-space:nowrap;overflow:auto}',
    '.ob-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--line-soft);',
    '  background:var(--panel2)}',
    '.ob-btn{padding:7px 14px;border:1px solid var(--line2);border-radius:6px;background:var(--panel);',
    '  color:var(--ink);cursor:pointer;font-size:13px;font-family:var(--sans)}',
    '.ob-btn:hover{background:var(--sel);border-color:var(--cyan)}',
    '.ob-btn.go{background:var(--cyan);border-color:var(--cyan);color:var(--on-red);font-weight:600;',
    '  padding:7px 18px}',
    '.ob-skip{color:var(--dim);border-color:transparent;background:transparent}',
    '.ob-sp{flex:1 1 auto}',
    /* ---- WebGPU 教程弹窗 ----
       外壳（遮罩 .ob-box + 面板 .ob-panel + 头 .ob-head + 脚 .ob-foot）整套复用上面的引导弹窗，
       这里只加内容区的排版。再造一套外壳既没必要，两套也会随时间慢慢长歪。 */
    '.obg-ht{font-size:13.5px;font-weight:600;color:var(--ink)}',
    '.obg-body{padding:14px 18px 10px;overflow:auto;min-height:0}',
    '.obg-state{padding:10px 12px;border-radius:7px;border:1px solid var(--line2);',
    '  background:var(--panel2);font-size:13px;line-height:1.8;color:var(--ink)}',
    '.obg-state.ok{border-color:var(--green-line);background:var(--green-bg)}',
    '.obg-state.warn{border-color:var(--amber-line);background:var(--amber-bg)}',
    '.obg-state.bad{border-color:var(--red-line);background:var(--red-bg)}',
    '.obg-det{display:block;margin-top:5px;font-family:var(--mono);font-size:11.5px;color:var(--dim);',
    '  overflow-wrap:anywhere}',
    '.obg-tip{margin:12px 0 0;font-size:12px;line-height:1.75;color:var(--dim)}',
    '.obg-list{margin:12px 0 0;padding:0;list-style:none;counter-reset:obg}',
    '.obg-li{position:relative;padding:0 0 0 26px;margin:0 0 13px}',
    '.obg-li:before{counter-increment:obg;content:counter(obg);position:absolute;left:0;top:1px;',
    '  width:18px;height:18px;border-radius:50%;background:var(--cyan-bg);border:1px solid var(--cyan-line);',
    '  color:var(--cyan);font-size:11px;line-height:17px;text-align:center;font-weight:700}',
    '.obg-t{margin:0 0 3px;font-size:13.5px;font-weight:600;color:var(--ink)}',
    '.obg-p{margin:0;font-size:12.5px;line-height:1.9;color:var(--ink2)}',
    /* 地址必须能被完整看到、能被整段选中：chrome:// 这类地址浏览器不允许网页跳过去，
       用户只能自己粘到地址栏。所以既不能截断（overflow-wrap），也别让它只选中半截（user-select:all）。 */
    '.obg-code{font-family:var(--mono);font-size:12px;padding:1px 5px;border-radius:4px;',
    '  background:var(--sel);border:1px solid var(--line-soft2);color:var(--ink);',
    '  overflow-wrap:anywhere;-webkit-user-select:all;user-select:all}',
    '@media (max-width:520px){.ob-t{font-size:17px}.ob-d{white-space:normal}',
    '  .obg-body{padding:12px 14px 8px}.obg-li{padding-left:23px}}'
  ].join('\n');

  var S = { el: null, step: 0, onDone: null, focusBack: null };

  function seen() { return get(KEY_SEEN) === '1'; }
  function markSeen() { set(KEY_SEEN, '1'); }
  function forget() { del(KEY_SEEN); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* 样式只注入一次。抽成函数是因为引导弹窗与 WebGPU 教程共用同一套 .ob-* 外壳，
     谁先被打开谁负责注入——不能再赖在 ensureEl() 里（那是引导弹窗专用的） */
  function ensureStyle() {
    if (doc.getElementById('obStyle')) return;
    var style = doc.createElement('style');
    style.id = 'obStyle';
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  function ensureEl() {
    if (S.el && S.el.parentNode) return S.el;
    ensureStyle();
    var box = doc.createElement('div');
    box.className = 'ob-box';
    box.id = 'obBox';
    box.hidden = true;
    box.innerHTML = [
      '<div class="ob-panel" role="dialog" aria-modal="true" aria-label="' + esc(T('新手引导')) + '">',
      '  <div class="ob-head"><span class="ob-k" id="obK"></span>',
      '    <span class="ob-dots" id="obDots"></span></div>',
      '  <div class="ob-body"><h2 class="ob-t" id="obT"></h2>',
      '    <p class="ob-p" id="obP"></p><div class="ob-d" id="obD"></div></div>',
      '  <div class="ob-foot">',
      '    <button type="button" class="ob-btn ob-skip" id="obSkip">' + esc(T('跳过')) + '</button>',
      '    <span class="ob-sp"></span>',
      '    <button type="button" class="ob-btn" id="obPrev">' + esc(T('上一步')) + '</button>',
      '    <button type="button" class="ob-btn go" id="obNext">' + esc(T('下一步')) + '</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    doc.body.appendChild(box);
    S.el = box;

    box.querySelector('#obSkip').addEventListener('click', function () { finish(); });
    box.querySelector('#obPrev').addEventListener('click', function () { go(S.step - 1); });
    box.querySelector('#obNext').addEventListener('click', function () {
      if (S.step >= STEPS.length - 1) finish(); else go(S.step + 1);
    });
    // 点遮罩关掉 = 跳过：弹窗挡着首页，必须给一个"我就想走"的出口
    box.addEventListener('click', function (e) { if (e.target === box) finish(); });
    return box;
  }

  function go(i) {
    if (i < 0) i = 0;
    if (i > STEPS.length - 1) i = STEPS.length - 1;
    S.step = i;
    var s = STEPS[i], el = S.el;
    // 整句进词典（'第 1 步 / 共 3 步'），不拼半截：英文是 "Step 1 of 3"，语序对不上中文的拼法
    el.querySelector('#obK').textContent = T(s.k + ' / 共 ' + STEPS.length + ' 步');
    el.querySelector('#obT').textContent = T(s.t);
    el.querySelector('#obP').textContent = T(s.p);
    el.querySelector('#obD').textContent = T(s.d);
    var dots = '', j;
    for (j = 0; j < STEPS.length; j++) dots += '<i class="ob-dot' + (j === i ? ' on' : '') + '"></i>';
    el.querySelector('#obDots').innerHTML = dots;
    var prev = el.querySelector('#obPrev'), next = el.querySelector('#obNext');
    var focusWasPrev = (doc.activeElement === prev);
    prev.hidden = (i === 0);
    next.textContent = T((i === STEPS.length - 1) ? '开始玩' : '下一步');
    // 回到第 1 步时「上一步」会被藏起来，焦点正好在它身上就会掉到 body 上：接住，挪给「下一步」
    if (prev.hidden && focusWasPrev) { try { next.focus(); } catch (e) { /* ignore */ } }
  }

  /* 键盘：**捕获阶段**接，而且接住就 stopPropagation。
     app.js 在 document 上也挂了 keydown，而且它是先注册的（冒泡阶段先跑）——
     引导弹窗开着时按 Esc / Enter，事件会先被主程序吃掉：在确认页上 Enter = 直接引爆，
     Esc = 退回起爆页。弹窗明明是模态的，键却穿透到了后面那一层。
     捕获 + stopPropagation 之后，弹窗开着时这几个键只属于弹窗。 */
  function onKey(e) {
    if (!S.el || S.el.hidden) return;
    var k = e.key;
    if (k === 'Escape' || e.keyCode === 27) { e.preventDefault(); e.stopPropagation(); finish(); }
    else if (k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (S.step < STEPS.length - 1) go(S.step + 1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(S.step - 1); }
    // Enter = 下一步 / 最后一步就是"开始玩"。三步弹窗里 Enter 是最顺手的键，
    // 原来它什么都不做，却会被后面的主程序当成"引爆"
    else if (k === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (S.step >= STEPS.length - 1) finish(); else go(S.step + 1);
    }
  }

  /** 关闭并记下"看过了"。跳过与走完都走这里：看过一次就不该再弹，这是用户明确要的 */
  function finish() {
    markSeen();
    if (S.el) S.el.hidden = true;
    doc.removeEventListener('keydown', onKey, true);   // 注册时带了 capture，摘的时候也必须带
    // 焦点还给点开它的那个按钮（「怎么玩」），不然关掉之后 Tab 从页面开头重来
    var back = S.focusBack; S.focusBack = null;
    if (back && back.focus) { try { back.focus(); } catch (e) { /* 元素可能已经没了 */ } }
    var fn = S.onDone; S.onDone = null;
    if (typeof fn === 'function') { try { fn(); } catch (e) { /* 回调出错不影响关闭 */ } }
  }

  /* 首次引导的正主已经换成 web/tour.js（盖在真实界面上、按步点的那种，specs/sim-ui-v1.md）。
     这里只做转交：有它就走它，并把「看过」记在两边——「怎么玩」按钮与首访自动弹
     都走这个函数，一处转交就够，arc-ui.js 一个字都不用改。
     它缺席时（并行开发、或构建里被跳过）照旧退回下面这套三步弹窗。 */
  function show(force, onDone) {
    if (!doc || !doc.body) return false;
    // 注意 force 这个位置也可能被当成 onDone 回调传进来（见下面 S.onDone 那行），只有 ===true 才算强制
    var tour = root.MirrorTour, hard = (force === true);
    if (tour && tour.start) {
      if (tour.start(hard)) { markSeen(); return true; }
      if (!hard) return false;           // 已经看过、又不是强制：和旧行为一致，什么都不弹
    }
    if (!force && seen()) return false;
    ensureEl();
    S.onDone = (typeof force === 'function') ? force : onDone;
    S.focusBack = doc.activeElement;
    S.el.hidden = false;
    go(0);
    doc.addEventListener('keydown', onKey, true);
    // 焦点挪进弹窗：它是 aria-modal，焦点却留在后面的页面上，读屏和键盘用户会以为没打开
    var next = S.el.querySelector('#obNext');
    if (next) { try { next.focus(); } catch (e) { /* ignore */ } }
    return true;
  }

  function maybeShow(onDone) { return show(false, onDone); }
  function isOpen() { return !!(S.el && !S.el.hidden); }

  /* ============================================================ WebGPU：真检测 + 教程
   *
   * 为什么不能只判断 'gpu' in navigator：本机实测就是「有 navigator.gpu、requestAdapter()
   * 返回空」——浏览器实现了这套 API，但驱动/黑名单没交出可用的适配器。只看 navigator.gpu
   * 会把这台机器报成"支持"，然后它每次引爆都静默回退 WebGL2（控制台里那句
   * `[universe3d] WebGPU 初始化失败，回退 WebGL2：requestAdapter 返回空`），
   * 用户永远不知道该去哪儿开。所以这里真跑一次 requestAdapter()，按结果分三种情况给指引。
   *
   * 探测只跑一次并缓存：一次会话里结果不会变，每个调用方各跑一次只会在控制台
   * 刷出一串一模一样的失败。想重来（改完 flags 回来看）走 gpuRecheck()。
   */
  var GPU = { st: null, running: false, waiting: [], subs: [] };

  var GPU_TONE = { probing: '', ok: 'ok', 'no-adapter': 'warn', 'no-api': 'warn', insecure: 'warn', error: 'warn' };

  /** 开关旁边那一行短状态：一句话说清"现在到底能不能用"，不写"需要浏览器支持"这种废话 */
  var GPU_SHORT = {
    probing: '正在检测本机支持情况…',
    ok: '这台机器可以用 WebGPU',
    'no-adapter': '浏览器支持，但这台机器没有可用的显卡适配器 —— 会自动回退 WebGL2',
    'no-api': '这个浏览器没有 WebGPU —— 会一直用 WebGL2',
    insecure: '当前页面不是安全上下文（WebGPU 只在 https 或 localhost 上提供）',
    error: '检测时出错，按用不了处理 —— 会自动回退 WebGL2'
  };

  /* 文案里要混排代码/加粗，又必须转义用户看不见的东西，所以正文一律写成"片段数组"：
     字符串 = 纯文本（转义），{code:} = 等宽代码块，{b:} = 加粗。比在字符串里拼 HTML 安全。 */
  function parts(list) {
    var out = '', i, p;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      // {code:} 是代码/地址/flag 名，永远不翻——翻了用户就搜不到那个开关了
      if (typeof p === 'string') out += esc(T(p));
      else if (p && p.code != null) out += '<code class="obg-code">' + esc(p.code) + '</code>';
      else if (p && p.b != null) out += '<b>' + esc(T(p.b)) + '</b>';
    }
    return out;
  }

  var GPU_LINE = {
    probing: ['正在向浏览器要一个显卡适配器…'],
    ok: ['浏览器有 ', { code: 'navigator.gpu' }, '，', { code: 'requestAdapter()' }, ' 也真拿到了适配器：',
      { b: '这台机器能用 WebGPU' }, '。'],
    'no-adapter': ['浏览器有 ', { code: 'navigator.gpu' }, '——它', { b: '支持' }, ' WebGPU 这套 API；但 ',
      { code: 'requestAdapter()' }, ' 返回的是空，', { b: '拿不到可用的显卡适配器' },
      '。常见原因：图形加速被关了、显卡被浏览器的黑名单挡住了、或者驱动没把适配器交出来。'],
    'no-api': ['这个浏览器根本没有 ', { code: 'navigator.gpu' }, '：', { b: '不支持 WebGPU' },
      '。引擎会一直走 WebGL2 那条路。'],
    insecure: ['浏览器没有暴露 ', { code: 'navigator.gpu' }, '，而且当前页面不是安全上下文 —— WebGPU 只在 ',
      { code: 'https' }, ' 或 ', { code: 'localhost' }, ' 上提供。'],
    error: ['调用 ', { code: 'navigator.gpu.requestAdapter()' }, ' 时抛了异常，按"用不了"处理。']
  };

  /* chrome:// 地址点不动，这一条必须先说：不然用户会一直点那串灰字，以为页面坏了 */
  var GPU_TIP = ['下面这些 ', { code: 'chrome://' }, ' 地址只能', { b: '手动复制到地址栏' },
    '打开 —— 浏览器不允许网页跳转到它自己的设置页，做成链接也点不动。Edge 把 ',
    { code: 'chrome://' }, ' 换成 ', { code: 'edge://' }, ' 就行（同为 Chromium 内核）。'];

  /* 「有 API、没适配器」的排查顺序，依据 Chrome 官方 WebGPU troubleshooting 那一页。
     flag 名一个字都不改写：写错一个字用户就搜不到那个开关。 */
  var GPU_FIX_ADAPTER = [
    { t: '先确认浏览器的图形加速没被关掉', p: ['地址栏打开 ', { code: 'chrome://settings/system' },
      '，确认「使用图形加速功能（如果可用）」（英文界面是 Use graphics acceleration when available）是开着的。改完要重启浏览器。'] },
    { t: '再看一眼 chrome://gpu 是怎么说的', p: ['地址栏打开 ', { code: 'chrome://gpu' },
      '，在页面里搜 WebGPU。如果看到 ', { code: 'WebGPU has been disabled via blocklist or the command line' },
      '，说明你的显卡或驱动被浏览器列进了黑名单 —— 走下一步。'] },
    { t: '被黑名单挡住就开这个开关', p: ['打开 ', { code: 'chrome://flags/#enable-unsafe-webgpu' },
      '，设为 Enabled，重启浏览器。也可以改开 ', { code: 'chrome://flags/#ignore-gpu-blocklist' },
      '。Linux 上还要一起开 ', { code: 'chrome://flags/#enable-vulkan' },
      '。名字里的 unsafe 指的是"绕过了浏览器给显卡驱动定的安全名单"，不是说会弄坏机器；不放心就用完再关回去。'] },
    /* Windows 那一层的菜单名各版本不一样（10 是「显示 → 图形设置」，11 是「屏幕 → 显示卡」），
       所以只描述去哪儿找、要改成什么，不写死一条会对不上的路径 */
    { t: '如果 chrome://gpu 里连 GPU 都没认出来', p: ['那多半是显卡驱动：更新驱动、重启浏览器再试。',
      'Windows 上还可以在「设置 → 系统 → 显示」里那一项图形／显卡设置中，把浏览器指定为「高性能」，别让它只看得到集显。'] }
  ];

  var GPU_FIX_NOAPI = [
    { t: '先看浏览器版本够不够', p: ['Chrome / Edge 113 及以上（Windows、macOS、ChromeOS）；Android 上是 Chrome 121+；',
      'Firefox 141+（Windows）、145+（macOS）；Safari 26+（macOS / iOS / iPadOS）。低于这些版本就是没有，升级是唯一的办法。'] },
    { t: '版本够了还是没有：可能被开关关着', p: ['Chrome / Edge 打开 ', { code: 'chrome://flags/#enable-unsafe-webgpu' },
      '，设为 Enabled 再重启浏览器；Linux 上还要一起开 ', { code: 'chrome://flags/#enable-vulkan' }, '。'] },
    { t: '确认页面是 https 或 localhost', p: ['WebGPU 只在安全上下文里暴露：用 ', { code: 'file://' },
      ' 直接打开本地文件是拿不到的，本地调试请用 ', { code: 'http://localhost' }, '。'] }
  ];

  var GPU_FIX_INSECURE = [
    { t: '换成 https 链接重新打开', p: ['同一个页面，把地址里的 ', { code: 'http://' }, ' 换成 ', { code: 'https://' },
      '，或者直接用站点的正式链接进来。'] },
    { t: '本地调试用 localhost', p: [{ code: 'http://localhost' }, ' 也算安全上下文；',
      { code: 'file://' }, ' 直接双击打开的本地文件不算。'] }
  ];

  var GPU_FIX_OK = [
    { t: '已经能用了，勾上就行', p: ['不用改任何浏览器设置。'] }
  ];

  /* 三条与状态无关、但每种情况都必须说的话。尤其第二条：不说清"什么时候生效"，
     用户会以为开关坏了（他刚切完，画面上什么都没变）。 */
  var GPU_COMMON = [
    { t: '开不了也不影响玩', p: ['引擎会自动回退到 WebGL2：粒子档位低一点、引力求解落到 CPU 的 Worker 上，帧率慢一些，',
      { b: '但功能一个都不少，算出来的结局也完全一样' }, '。'] },
    { t: '开关是什么意思、什么时候生效', p: ['勾上 = ', { b: '优先用 WebGPU，用不了就自动回退 WebGL2' },
      '；取消 = ', { b: '强制用 WebGL2' }, '。改完不用刷新页面，但当前正在跑的 3D 视图不会跟着变：',
      '一块 ', { code: '<canvas>' }, ' 的上下文类型是不可逆的，换后端只能换一块新画布重来。所以',
      { b: '要下一次引爆（或退出镜像回到太空）才按新设置来' }, '。'] },
    { t: '别指望它一定更快', p: ['WebGPU 把引力求解搬到显卡上跑，通常能开更多粒子、更流畅；',
      '但快多少完全取决于显卡和驱动，个别机器上反而更卡甚至花屏。遇到就把开关关掉，回到 WebGL2。'] }
  ];

  function gpuFix(id) {
    if (id === 'ok') return GPU_FIX_OK;
    if (id === 'no-api') return GPU_FIX_NOAPI;
    if (id === 'insecure') return GPU_FIX_INSECURE;
    if (id === 'probing') return [];
    return GPU_FIX_ADAPTER;                 // no-adapter 与 error 走同一套排查
  }
  // 只有真要用户去开 chrome:// 页面的时候才提"地址点不动"，别每种状态都念一遍
  function gpuNeedsTip(id) { return id === 'no-adapter' || id === 'no-api' || id === 'error'; }

  function gpuSettle(id, detail) {
    GPU.st = { id: id, tone: GPU_TONE[id] || '', short: T(GPU_SHORT[id] || ''), detail: detail || '' };
    GPU.running = false;
    var w = GPU.waiting, i;
    GPU.waiting = [];
    for (i = 0; i < w.length; i++) { try { w[i](GPU.st); } catch (e) { /* 一个订阅者出错不该拖累别人 */ } }
    for (i = 0; i < GPU.subs.length; i++) { try { GPU.subs[i](GPU.st); } catch (e2) { /* 同上 */ } }
  }

  /** 真跑一次 requestAdapter()。cb 在拿到结果时调用（已经有结果就当场调）；返回已知结果或 null */
  function gpuProbe(cb) {
    if (GPU.st) { if (cb) { try { cb(GPU.st); } catch (e) { /* ignore */ } } return GPU.st; }
    if (cb) GPU.waiting.push(cb);
    if (GPU.running) return null;
    GPU.running = true;
    var nav = root.navigator;
    // navigator.gpu 缺席有两种原因，给出的办法完全不同：换浏览器 vs 换成 https
    if (!nav || !nav.gpu) { gpuSettle(root.isSecureContext === false ? 'insecure' : 'no-api'); return null; }
    var p = null;
    try { p = nav.gpu.requestAdapter(); } catch (e) { gpuSettle('error', String((e && e.message) || e)); return null; }
    if (!p || typeof p.then !== 'function') { gpuSettle('error', T('requestAdapter() 没有返回 Promise')); return null; }
    p.then(function (ad) {
      if (!ad) { gpuSettle('no-adapter'); return; }
      // 适配器的自述信息（部分浏览器才有 adapter.info）：能拿到就顺手报给用户，拿不到也不影响判定
      var d = '';
      try {
        var it = ad.info;
        if (it) {
          d = [it.vendor, it.architecture, it.device, it.description].filter(function (x) { return !!x; }).join(' · ');
        }
      } catch (e2) { d = ''; }
      gpuSettle('ok', d);
    }, function (e3) { gpuSettle('error', String((e3 && e3.message) || e3)); });
    return null;
  }

  function gpuState() { return GPU.st; }
  /** 订阅结果变化（重新检测也会再通知一次）。首屏那一行状态靠它跟着更新 */
  function onGpu(fn) { if (typeof fn === 'function') GPU.subs.push(fn); }
  /** 丢掉缓存重新探一次：用户按教程改完 flags 回来，得有个不刷新也能复查的入口 */
  function gpuRecheck(cb) { GPU.st = null; GPU.running = false; return gpuProbe(cb); }

  /* ------------------------------------------------------------ 教程弹窗 */
  var G = { el: null, focusBack: null };

  /** 当前页面的上下文：说"需要 https"的同时把"你现在是什么"摆出来，用户才不用自己猜 */
  function gpuWhere() {
    var loc = root.location, sec = (root.isSecureContext === true) ? T('是') : (root.isSecureContext === false ? T('否') : T('未知'));
    var origin = loc ? (loc.protocol + '//' + (loc.host || T('（本地文件）'))) : T('（未知）');
    return T('当前页面：') + origin + T('　安全上下文：') + sec;
  }

  function gpuGuideHTML(st) {
    var id = st ? st.id : 'probing';
    var h = '<div class="obg-state ' + (GPU_TONE[id] || '') + '">' + parts(GPU_LINE[id] || GPU_LINE.probing);
    if (st && st.detail) h += '<span class="obg-det">' + esc(st.detail) + '</span>';
    h += '<span class="obg-det">' + esc(gpuWhere()) + '</span></div>';
    if (gpuNeedsTip(id)) h += '<p class="obg-tip">' + parts(GPU_TIP) + '</p>';
    var list = gpuFix(id).concat(GPU_COMMON), i;
    h += '<ol class="obg-list">';
    for (i = 0; i < list.length; i++) {
      h += '<li class="obg-li"><p class="obg-t">' + esc(T(list[i].t)) + '</p>' +
           '<p class="obg-p">' + parts(list[i].p) + '</p></li>';
    }
    return h + '</ol>';
  }

  function gpuRender() {
    if (!G.el) return;
    var body = G.el.querySelector('#obgBody');
    if (body) body.innerHTML = gpuGuideHTML(GPU.st);
  }

  function gpuKey(e) {
    if (!G.el || G.el.hidden) return;
    var k = e.key;
    // 与引导弹窗同一个理由：app.js 也在 document 上听 keydown 且注册得更早，
    // 不在捕获阶段吃掉，Esc 会穿到主程序去（在确认页上直接退回起爆页）
    if (k === 'Escape' || e.keyCode === 27) { e.preventDefault(); e.stopPropagation(); gpuClose(); }
  }

  function gpuClose() {
    if (G.el) G.el.hidden = true;
    doc.removeEventListener('keydown', gpuKey, true);
    var back = G.focusBack; G.focusBack = null;
    if (back && back.focus) { try { back.focus(); } catch (e) { /* 元素可能已经没了 */ } }
  }

  function gpuEnsureEl() {
    if (G.el && G.el.parentNode) return G.el;
    ensureStyle();
    var box = doc.createElement('div');
    box.className = 'ob-box';
    box.id = 'obGpuBox';
    box.hidden = true;
    box.innerHTML = [
      '<div class="ob-panel" role="dialog" aria-modal="true" aria-label="' + esc(T('开启 WebGPU')) + '">',
      '  <div class="ob-head"><span class="ob-k">WEBGPU</span>',
      '    <span class="obg-ht">' + esc(T('开启显卡加速')) + '</span></div>',
      '  <div class="obg-body" id="obgBody"></div>',
      '  <div class="ob-foot">',
      '    <button type="button" class="ob-btn" id="obgAgain">' + esc(T('重新检测')) + '</button>',
      '    <span class="ob-sp"></span>',
      '    <button type="button" class="ob-btn go" id="obgClose">' + esc(T('知道了')) + '</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    doc.body.appendChild(box);
    G.el = box;
    box.querySelector('#obgClose').addEventListener('click', gpuClose);
    box.querySelector('#obgAgain').addEventListener('click', function () {
      var b = box.querySelector('#obgAgain');
      b.disabled = true; b.textContent = T('检测中…');
      gpuRecheck(function () { b.disabled = false; b.textContent = T('重新检测'); gpuRender(); });
      gpuRender();
    });
    // 点遮罩关掉：弹窗盖住整页，必须留一个"我就想走"的出口
    box.addEventListener('click', function (e) { if (e.target === box) gpuClose(); });
    return box;
  }

  /** 打开 WebGPU 教程。backEl = 关掉之后把焦点还给谁（通常是点开它的那个按钮） */
  function showGpuGuide(backEl) {
    if (!doc || !doc.body) return false;
    gpuEnsureEl();
    G.focusBack = backEl || doc.activeElement;
    G.el.hidden = false;
    gpuRender();
    gpuProbe(function () { gpuRender(); });     // 还没探过就现探，结果回来再重画一次
    doc.addEventListener('keydown', gpuKey, true);
    var ok = G.el.querySelector('#obgClose');
    if (ok) { try { ok.focus(); } catch (e) { /* ignore */ } }
    return true;
  }

  root.MirrorOnboard = {
    KEY_SEEN: KEY_SEEN,
    KEY_NOVICE: KEY_NOVICE,
    STEPS: STEPS,
    PLAIN: PLAIN,
    METER: METER,
    OUTCOME: OUTCOME,
    seen: seen,
    markSeen: markSeen,
    forget: forget,
    show: show,
    maybeShow: maybeShow,
    isOpen: isOpen,
    novice: novice,
    setNovice: setNovice,
    toggleNovice: toggleNovice,
    onNovice: onNovice,
    plain: plain,
    paramLabel: paramLabel,
    meterLabel: meterLabel,
    outcomeLine: outcomeLine,
    outcomeName: outcomeName,
    // WebGPU：真检测（跑 requestAdapter）+ 教程弹窗
    gpuProbe: gpuProbe,
    gpuState: gpuState,
    gpuRecheck: gpuRecheck,
    onGpu: onGpu,
    showGpuGuide: showGpuGuide,
    GPU_SHORT: GPU_SHORT
  };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
