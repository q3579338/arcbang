/*
 * web/tour.js —— 盖在真实界面上的分步新手引导（coach-mark）
 * ------------------------------------------------------------
 * specs/sim-ui-v1.md「新手教程」节。用户原话：「第一次进入的客户有简单的新手教程，按步点的那种」。
 *
 * 和旧的 web/onboard.js 三步弹窗的区别只有一条，但它是全部：
 *   旧的是**读**（三屏文字，读完关掉，页面还在原地）；
 *   这个是**做**（暗色遮罩挖一个洞，把真正的那颗按钮亮出来，你点它，教程自己往下走）。
 *
 * 几条自己给自己定的规矩：
 *   · 遮罩不吃点击。它 pointer-events:none，靠一圈超大的 box-shadow 把周围压暗——
 *     所以引导开着的时候，页面**任何地方**都还能点，包括被压暗的地方。
 *     新手最怕的是"教程把我卡住了"，所以宁可引导跟丢，也不锁住界面。
 *   · 目标不存在就往后跳。D≥4 的宇宙没有「进入镜像」，D=3 的没有「投影」——
 *     每一步自己回答"我现在还适用吗"，不适用就让位给后面第一条适用的。
 *   · 跟着用户走，不是用户跟着它走。每 240 ms 对一次：如果用户自己跑到了后面的步骤，
 *     引导直接跳过去；如果当前这步的目标暂时不在屏幕上（还在确认页、还在算初始条件），
 *     就把气泡收起来安静等着，不弹任何东西。
 *
 * 状态只有一条：localStorage 里的 bnbbang.tour.v1（看过了）。?tour=1 强制重放。
 * 三站共用，按钮名与结尾那句按 site() 分支。
 *
 * 依赖：无。i18n / onboard 缺席都不炸。
 * API：
 *   MirrorTour.start(force)    开始（force=true 时无视「看过」）
 *   MirrorTour.maybeStart()    没看过、或带了 ?tour=1 才开始；返回是否开了
 *   MirrorTour.stop()          结束并记下「看过」
 *   MirrorTour.active() / seen() / markSeen() / forget()
 *   MirrorTour.KEY
 */
(function (root, doc) {
  'use strict';

  var KEY = 'bnbbang.tour.v1';
  function T(s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'app') : s); }
  function get(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function set(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* 存不下就算了 */ } }
  function del(k) { try { if (root.localStorage) root.localStorage.removeItem(k); } catch (e) { /* 同上 */ } }
  function seen() { return get(KEY) === '1'; }
  function markSeen() { set(KEY, '1'); }
  function forget() { del(KEY); }
  function site() {
    var c = root.BNBBANG_CONFIG;
    return (c && c.site) || root.BNBBANG_SITE || 'bnb';
  }
  // prefers-reduced-motion 由上面 CSS 里那条 @media 管：挖洞不做位移动画，直接跳过去
  function forced() {
    try { return /[?&]tour=1\b/.test(root.location.search || ''); } catch (e) { return false; }
  }
  function q(sel) { try { return doc.querySelector(sel); } catch (e) { return null; } }

  /* 「这个元素现在真的能看见、能点吗」。光看 offsetParent 不够：
     确认页是一整块盖在上面的浮层，底下的 #bnbGive 仍然有尺寸、仍然有 offsetParent，
     但用户根本点不到它。所以还要问一句 elementFromPoint：那个位置上现在是谁。 */
  function usable(el) {
    if (!el || el.disabled || el.hidden) return false;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.top > (root.innerHeight || 0) || r.right < 0 || r.left > (root.innerWidth || 0)) return false;
    var cx = Math.min(Math.max(r.left + r.width / 2, 2), (root.innerWidth || 2) - 2);
    var cy = Math.min(Math.max(r.top + Math.min(r.height / 2, 18), 2), (root.innerHeight || 2) - 2);
    var hit = null;
    try { hit = doc.elementFromPoint(cx, cy); } catch (e) { return true; }
    if (!hit) return false;
    if (el.contains(hit) || hit.contains(el)) return true;
    /* pointer-events:none 的容器（工具条外框就是）永远不会是 elementFromPoint 的答案，
       但它确确实实画在屏幕上。这种元素只按矩形判断就够了。 */
    try { if (root.getComputedStyle(el).pointerEvents === 'none') return true; } catch (e2) { /* 取不到就按下面那条走 */ }
    return false;
  }

  /* ---------------------------------------------------------- 步骤
     sel 可以是选择器、选择器数组，或一个自己挑元素的函数；返回 null = 这一步现在不适用。
     adv:'click' = 目标本身被点了就进下一步；'next' = 只能按「下一步」；'input' = 拖动它也算。 */
  function SANDBOX() { return site() === 'arc' ? '调参沙盒' : '干预沙盒'; }
  function STEPS() {
    var s = site();
    return [
      {
        id: 'give', sel: '#bnbGive', adv: 'click',
        body: s === 'btc'
          ? '先拿一个宇宙。比特币的一个区块哈希，就是一套完整的物理定律。'
          : s === 'arc'
            ? '先拿一个宇宙。Arc 链的一个区块哈希，就是一套完整的物理定律。'
            : '先拿一个宇宙。BNB 链的一个区块哈希，就是一套完整的物理定律。'
      },
      {
        id: 'card', sel: '#bnbCard', adv: 'next', pad: 6,
        body: '这就是那套定律：物理常数和它注定的结局。D 是空间有几个维度——我们的宇宙是 3。'
      },
      { id: 'fire', sel: '#bnbFire', adv: 'click', body: '点它，进这个宇宙里面看。免费，不连钱包，也不上链。' },
      { id: 'confirm', sel: '#btnFire', adv: 'click', body: '再确认一次，然后它就在你面前炸开。' },
      // 指向 .rail-box 而不是 #hudSide：外框是 pointer-events:none 的定位壳，真正画出来的是里面那块
      { id: 'view', sel: '#hudSide .rail-box', adv: 'next', body: '拖画面转视角，滚轮拉远拉近。右边这条工具条管「怎么看」：俯瞰、环绕、飞到最密处。' },
      { id: 'time', sel: '#hudTime', adv: 'input', body: '拖这条，看这个宇宙的一生。往右是未来；往左回拨，它会按初始条件重算一遍。' },
      {
        id: 'go',
        /* D≥4 有「投影」就先指它——那才是这类宇宙真正好玩的地方（同一份数据换三根轴，整张脸都变）；
           D=3 没有这颗按钮，就指「进入镜像」。两颗都没有（或都点不了）时这一步自己跳过。 */
        sel: function () {
          var p = q('#hudProj');
          if (p && !p.disabled && usable(p)) return p;
          var e = q('#hudEnter');
          if (e && !e.disabled && usable(e)) return e;
          return null;
        },
        adv: 'click',
        body: function (el) {
          return (el && el.id === 'hudProj')
            ? '这个宇宙的维度多于三个，屏幕上只是它的一张三维投影。换三根轴，同一个宇宙会变成完全不同的一张脸。'
            : '再往里走一层：从整盒宇宙下到星系、恒星，最后落到一颗行星的地表。';
        }
      },
      {
        id: 'done', sel: null, adv: 'next',
        body: s === 'arc'
          ? '就这些。不喜欢这个结局就换一个区块再炸一次；想自己拧参数，' + SANDBOX() + '随便玩，不花钱也不上链。'
          : '就这些。喜欢这个宇宙就把它铸成 NFT 收着；想自己拧参数，' + SANDBOX() + '随便玩，不花钱也不上链。'
      }
    ];
  }

  /* ---------------------------------------------------------- 样式 */
  var CSS = [
    '.tour-hole{position:fixed;z-index:9700;border-radius:3px;pointer-events:none;',
    '  box-shadow:0 0 0 100vmax rgba(3,5,12,.62),inset 0 0 0 1px rgba(139,153,245,.9);',
    '  transition:left .16s ease,top .16s ease,width .16s ease,height .16s ease}',
    '.tour-hole.center{box-shadow:0 0 0 100vmax rgba(3,5,12,.62)}',
    '.tour-tip{position:fixed;z-index:9701;width:300px;max-width:calc(100vw - 24px);padding:12px 14px 10px;',
    '  background:#12141F;color:#E9E6F5;border:1px solid #3A4370;border-radius:3px;',
    '  box-shadow:0 14px 40px rgba(0,0,0,.5);',
    '  font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;font-size:13px;line-height:1.7}',
    '.tour-tip .tt-k{font-family:Consolas,"Microsoft YaHei",monospace;font-size:10.5px;color:#5C6280}',
    '.tour-tip .tt-b{margin:5px 0 11px;color:#E9E6F5}',
    '.tour-tip .tt-f{display:flex;align-items:center;gap:8px}',
    '.tour-tip .tt-sp{flex:1}',
    '.tour-tip button{font:inherit;font-size:12px;border-radius:2px;padding:4px 12px;cursor:pointer}',
    '.tour-tip .tt-skip{background:transparent;border:0;color:#8B8FA8;padding-left:0}',
    '.tour-tip .tt-skip:hover{color:#E9E6F5}',
    '.tour-tip .tt-next{background:rgba(139,153,245,.2);border:1px solid rgba(139,153,245,.62);color:#FFFFFF}',
    '.tour-tip .tt-next:hover{background:rgba(139,153,245,.34)}',
    '.tour-tip button:focus-visible{outline:2px solid #8B99F5;outline-offset:2px}',
    '@media (prefers-reduced-motion:reduce){.tour-hole{transition:none}}'
  ].join('');

  var S = { on: false, i: 0, hole: null, tip: null, timer: 0, steps: null, cur: null, armed: 0 };

  function ensureDom() {
    if (S.hole) return;
    if (!doc.getElementById('tourStyle')) {
      var st = doc.createElement('style'); st.id = 'tourStyle'; st.textContent = CSS; doc.head.appendChild(st);
    }
    S.hole = doc.createElement('div'); S.hole.className = 'tour-hole'; S.hole.hidden = true;
    S.tip = doc.createElement('div');
    S.tip.className = 'tour-tip'; S.tip.hidden = true;
    S.tip.setAttribute('role', 'dialog');
    S.tip.setAttribute('aria-live', 'polite');
    S.tip.innerHTML = '<div class="tt-k" id="ttK"></div><p class="tt-b" id="ttB"></p>' +
      '<div class="tt-f"><button type="button" class="tt-skip" id="ttSkip"></button><span class="tt-sp"></span>' +
      '<button type="button" class="tt-next" id="ttNext"></button></div>';
    doc.body.appendChild(S.hole);
    doc.body.appendChild(S.tip);
    S.tip.querySelector('#ttSkip').addEventListener('click', function () { stop(); });
    S.tip.querySelector('#ttNext').addEventListener('click', function () { next(); });
  }

  function target(step) {
    if (!step || !step.sel) return null;
    if (typeof step.sel === 'function') { try { return step.sel(); } catch (e) { return null; } }
    var list = (typeof step.sel === 'string') ? [step.sel] : step.sel;
    for (var i = 0; i < list.length; i++) { var el = q(list[i]); if (el && usable(el)) return el; }
    return null;
  }

  /* 气泡摆哪儿：下、上、左、右轮着试，第一个放得下的就用它。
     工具条贴着右边，时间条贴着底边——这两处只有「左」和「上」放得下，所以顺序不能写死。 */
  function place(r) {
    var vw = root.innerWidth, vh = root.innerHeight, m = 12;
    var tw = S.tip.offsetWidth || 300, th = S.tip.offsetHeight || 120;
    var cand = [
      [r.left + r.width / 2 - tw / 2, r.bottom + m],
      [r.left + r.width / 2 - tw / 2, r.top - th - m],
      [r.left - tw - m, r.top + r.height / 2 - th / 2],
      [r.right + m, r.top + r.height / 2 - th / 2]
    ];
    for (var i = 0; i < cand.length; i++) {
      var x = cand[i][0], y = cand[i][1];
      if (x >= m && y >= m && x + tw <= vw - m && y + th <= vh - m) return [x, y];
    }
    // 都放不下：夹回视口里，宁可压住一点点也别飘到屏幕外
    var fx = Math.min(Math.max(r.left + r.width / 2 - tw / 2, m), Math.max(m, vw - tw - m));
    var fy = Math.min(Math.max(r.bottom + m, m), Math.max(m, vh - th - m));
    return [fx, fy];
  }

  function paint(step, el) {
    var steps = S.steps, last = (S.i >= steps.length - 1);
    // 计数器写成一对数字，不写「第 N 步 / 共 M 步」：一对数字任何语言都读得懂，也不用进词典
    S.tip.querySelector('#ttK').textContent = (S.i + 1) + ' / ' + steps.length;
    S.tip.querySelector('#ttB').textContent = T(typeof step.body === 'function' ? step.body(el) : step.body);
    S.tip.querySelector('#ttSkip').textContent = T(last ? '关闭' : '跳过引导');
    S.tip.querySelector('#ttNext').textContent = T(last ? '开始玩' : '下一步');
    S.tip.hidden = false;
    if (el) {
      /* 目标露在视口外（起爆页会往下滚，结果卡往往一半在折线以下）：把它滚到中间，每步只滚一次。
         不滚的话洞会挖在屏幕边上，气泡也只能挤在角落。 */
      var r0 = el.getBoundingClientRect(), vh0 = root.innerHeight || 0;
      if (S.scrolledAt !== S.i && (r0.top < 8 || r0.bottom > vh0 - 8)) {
        S.scrolledAt = S.i;
        try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* 老浏览器忽略 */ }
      }
      var r = el.getBoundingClientRect(), pad = step.pad != null ? step.pad : 4;
      S.hole.className = 'tour-hole';
      S.hole.hidden = false;
      S.hole.style.left = (r.left - pad) + 'px';
      S.hole.style.top = (r.top - pad) + 'px';
      S.hole.style.width = (r.width + pad * 2) + 'px';
      S.hole.style.height = (r.height + pad * 2) + 'px';
      var p = place(r);
      S.tip.style.left = p[0] + 'px'; S.tip.style.top = p[1] + 'px';
    } else {
      // 收尾那一步没有目标：整屏压暗，气泡居中
      S.hole.className = 'tour-hole center';
      S.hole.hidden = false;
      S.hole.style.left = '50%'; S.hole.style.top = '50%';
      S.hole.style.width = '0px'; S.hole.style.height = '0px';
      var tw = S.tip.offsetWidth || 300, th = S.tip.offsetHeight || 120;
      S.tip.style.left = Math.round((root.innerWidth - tw) / 2) + 'px';
      S.tip.style.top = Math.round((root.innerHeight - th) / 2) + 'px';
    }
  }

  function hideOverlay() {
    if (S.hole) S.hole.hidden = true;
    if (S.tip) S.tip.hidden = true;
    S.cur = null;
  }

  /* 每 240 ms 对一次：当前这步还适用吗？不适用就让给后面第一条适用的；
     都不适用就安静等着（页面正在切场景、正在算初始条件）。 */
  function tick() {
    if (!S.on) return;
    var steps = S.steps, step = steps[S.i], el = target(step);
    /* 让位给后面那一步之前先连丢三拍（≈0.7 s）。切场景的那一瞬间 HUD 是一块一块重建的，
       工具条已经拆了、时间条还没建，这一拍看上去就像「当前这步不适用了」——
       不等一等的话，进 3D 的头一步会被白白跳掉。 */
    if (el) S.miss = 0; else if (step.sel) S.miss = (S.miss || 0) + 1;
    if (!el && step.sel && S.miss >= 3) {
      for (var j = S.i + 1; j < steps.length; j++) {
        var e2 = steps[j].sel ? target(steps[j]) : null;
        if (e2 || (!steps[j].sel && j === steps.length - 1 && S.i >= steps.length - 2)) { S.i = j; S.miss = 0; step = steps[j]; el = e2; break; }
      }
    }
    if (!el && step.sel) { hideOverlay(); return; }
    S.cur = el;
    paint(step, el);
  }

  function next() {
    if (!S.on) return;
    if (S.i >= S.steps.length - 1) { stop(); return; }
    S.i++;
    S.armed = Date.now();
    S.miss = 0;
    tick();
  }

  /* 目标本身被点了 = 进下一步。捕获阶段只是旁听，不拦不改，页面照常处理这一下。
     给 380 ms 的延迟是让页面先把新界面画出来，下一步的目标才找得到。 */
  function onClick(e) {
    if (!S.on || !S.cur) return;
    var step = S.steps[S.i];
    if (step.adv !== 'click') return;
    if (Date.now() - S.armed < 250) return;              // 刚切过来这一步，别把同一下点击算两次
    var t = e.target;
    if (t !== S.cur && !S.cur.contains(t)) return;
    /* 只有「这一步还停在原地」时才往前走。踩过一次：点完「引爆这个宇宙」，
       页面立刻切到确认屏，tick 发现当前目标没了、自己往前跳了一步；
       380 ms 后这条延时又跳一步 —— 确认屏那一步一闪而过，直接蹦到 3D。 */
    var at = S.i;
    root.setTimeout(function () { if (S.on && S.i === at) next(); }, 380);
  }
  function onInput(e) {
    if (!S.on || !S.cur) return;
    var step = S.steps[S.i];
    if (step.adv !== 'input') return;
    if (e.target !== S.cur) return;
    root.setTimeout(function () { if (S.on && S.steps[S.i] === step) next(); }, 700);
  }
  function onKey(e) {
    if (!S.on) return;
    if (e.key === 'Escape') { e.stopPropagation(); stop(); }
  }

  function start(force) {
    if (S.on) return true;
    if (!doc || !doc.body) return false;
    if (!force && seen() && !forced()) return false;
    ensureDom();
    S.on = true; S.i = 0; S.steps = STEPS(); S.armed = Date.now();
    S.miss = 0; S.scrolledAt = -1;          // 重看一遍时这两个也得从头来，否则第一步不会再滚进视口
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('change', onInput, true);
    doc.addEventListener('keydown', onKey, true);
    root.addEventListener('resize', tick);
    root.addEventListener('scroll', tick, true);
    S.timer = root.setInterval(tick, 240);
    tick();
    return true;
  }
  function maybeStart() { return start(forced()); }
  function stop() {
    if (!S.on) return;
    S.on = false;
    markSeen();
    hideOverlay();
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('change', onInput, true);
    doc.removeEventListener('keydown', onKey, true);
    root.removeEventListener('resize', tick);
    root.removeEventListener('scroll', tick, true);
    if (S.timer) { root.clearInterval(S.timer); S.timer = 0; }
  }

  root.MirrorTour = {
    KEY: KEY,
    start: start,
    maybeStart: maybeStart,
    stop: stop,
    active: function () { return !!S.on; },
    step: function () { return S.on ? S.i : -1; },
    steps: function () { return (S.steps || STEPS()).length; },
    seen: seen,
    markSeen: markSeen,
    forget: forget
  };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
