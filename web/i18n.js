/*
 * web/i18n.js —— 中英双语（独立模块，ES5，零依赖）
 * ------------------------------------------------------------
 * 设计取舍，先说清楚，因为它决定了后面几千行怎么改：
 *
 * **以中文原文本身作为 key**，而不是 `t('badge.verified')` 这种抽象键。
 *   - 代价：key 很长，而且两处不同语境用了同一句中文会被迫共用一条译文。
 *   - 换来的：现有代码里满是内联中文，抽象键意味着**每一处都要先起名再替换**，
 *     3700 多行文案就是 3700 次改名机会，改错了还不报错（key 打错 → 显示 key）。
 *     用原文当 key，漏翻的地方**自动退回中文**，永远不会出现界面上一个裸键。
 *   - 遇到真的需要区分语境时，用 `t('原文', '语境')` 的第二个参数分开。
 *
 * 静态 HTML 不用 data-i18n 逐个标注，走 DOM 遍历，但**只翻译整段完全命中的文本节点**
 * （trim 之后与词典的 key 逐字相等）。理由：
 *   - 部分匹配会误伤地址、哈希、数字、代码块 —— 那些东西一旦被"翻译"就是灾难
 *   - 整段命中意味着译文是人写好的完整句子，不是拼出来的
 * 没命中的照旧显示中文。这让翻译可以一句一句加，任何时候都是可发布状态。
 *
 * 语言存在 localStorage['mirror.lang']；没存过时看浏览器语言，
 * 中文（zh*）→ 中文，其余一律英文。
 */
(function (root) {
  'use strict';

  var KEY = 'mirror.lang';
  var LANGS = ['zh', 'en'];

  /* 词典：中文原文 → 英文。
     只放**界面上真会出现**的句子；注释、日志、开发用文字不进这里。
     分模块只是为了好维护，运行时会拍平成一张表。 */
  var EN = {};
  /* 分模块的词表。**这是「原文当 key」这个取舍的必要补丁。**
     短片段在不同模块里意思完全不同：'第 ' 在 planets 是「第 3 条轨道」(Orbit)、
     在 app 是「第 12 次」(Try)、在 mirror 是编号 (#)。全都塞进一张表的话，
     后加载的那份会静默盖掉前面的，而每个模块单测时只装了自己那份，测不出来。
     所以：显式 t() 调用先查本模块的表，查不到再落到全局表。
     DOM 遍历仍然只用全局表 —— 它匹配的是整段长句，本来就极少撞车。 */
  var NS = {};

  function add(map, ns) {
    var into = EN;
    if (ns) { if (!NS[ns]) NS[ns] = {}; into = NS[ns]; }
    for (var k in map) if (map.hasOwnProperty(k)) {
      /* 撞车了就喊一声。静默覆盖正是上一轮六个 agent 各自都测通、
         合到一起却出错的根因；宁可控制台吵一句，也别让它无声发生。 */
      if (!ns && EN.hasOwnProperty(k) && EN[k] !== map[k] && root.console && root.console.warn) {
        root.console.warn('[i18n] 全局词条被改写，可能是两个模块抢同一个 key：' + k);
      }
      into[k] = map[k];
    }
    // 分模块的词条同时补进全局：DOM 遍历只认全局表，静态 HTML 才有得翻
    if (ns) for (var k2 in map) if (map.hasOwnProperty(k2) && !EN.hasOwnProperty(k2)) EN[k2] = map[k2];
    REV = null;               // 词表变了：反查表作废，下次用时重建
  }

  /* ---- 反查表（英文 → 中文）：切回中文时用 --------------------------------
     切语言原本有两条路：静态标记走 DOM 遍历（切英文时把中文原文记在 node.__zh 上，
     切回来照着还原），动态渲染的那一半靠各页监听 mirror:lang 自己重画。
     漏掉的是第三种：**节点本身就是在英文态下现画出来的** —— 它从来没有过中文原文，
     __zh 是空的，那一块又没人重画，于是它在中文界面里永远是英文。
     （2026-09-20 用户报的「好多英文没汉化」有一半是这个。）

     按值反查回中文，规则比正向更严，只认铁板钉钉的那些：
       · key 必须是**纯中文**（不含任何拉丁字母）—— 'ARC宇宙' → 'ARCBANG' 这种带品牌名的不收：
         页面上真有一处写着 ARCBANG 的地方会被它改成中文品牌名；
       · 一个英文值指向两个不同中文 key 的一律丢弃（有歧义就不猜）；
       · 带前后空格的**拼接碎片**不收（见下面那条 if 的说明）；
       · 与正向一致，**整段逐字相等**才换，绝不做子串替换。 */
  var REV = null;
  function rev() {
    if (REV) return REV;
    var r = {}, dup = {}, k, v, s;
    for (k in EN) if (EN.hasOwnProperty(k)) {
      v = EN[k];
      if (typeof v !== 'string') continue;
      s = v.trim();
      if (!s || s === k) continue;
      /* 带前后空格的 key 是**拼接用的碎片**（' 维' → 'D'、' 次大爆炸' → ' big bangs'）：
         反查会把整段就是 'D' 的那个节点换成 ' 维'，而正向查的是 trim 过的 '维' —— 对不上，
         于是英文态里那一格永远停在中文（2026-09-20 实测踩到）。碎片一律不反推。 */
      if (k !== k.trim() || v !== s) continue;
      if (!/[\u4e00-\u9fff]/.test(k) || /[A-Za-z]/.test(k)) continue;   // 非纯中文 key：不反推
      if (!/[A-Za-z]/.test(s)) continue;                                // 译文里一个字母都没有：换回去没意义
      if (r.hasOwnProperty(s)) { if (r[s] !== k) dup[s] = 1; }
      else r[s] = k;
    }
    for (k in dup) if (dup.hasOwnProperty(k)) delete r[k];
    REV = r;
    return r;
  }

  /* ---- 通用 ---- */
  add({
    '连接钱包': 'Connect wallet',
    '连接小狐狸': 'Connect MetaMask',
    '断开': 'Disconnect',
    '切换账户': 'Switch account',
    '复制': 'Copy',
    '已复制': 'Copied',
    '刷新': 'Refresh',
    '设置': 'Settings',
    '主题': 'Theme',
    '语言': 'Language',
    '浅色': 'Light',
    '深色': 'Dark',
    '跟随系统': 'System',
    '关闭': 'Close',
    '取消': 'Cancel',
    '确认': 'Confirm',
    '加载中…': 'Loading…',
    '出错了': 'Something went wrong',
    /* 链名不再进词典：它是**数据**，来源是 web/config.arc.js 的 chain 块
       ——中文态取 chain.name、英文态取 chain.nameEn，
       页面按语言现挑一个。原来这里的 'BSC 测试网' / 'BNB Smart Chain 测试网' /
       '这是测试网' 三条已随之删掉：留着就是在词典里再写死一次链名，
       换主网那天必然有人只改 config.js、改不到这里。 */
    '在区块浏览器里查看': 'View on explorer',
    /* 顶栏页签「状态」（web/nav.js 的 PAGES）。**必须收在核心表**：
       i18n-mirror.js 的分册里有一条 '状态' → 'State'（天体信息面板那格），
       它的分册词条会静默补进全局；核心表先到先得，这里占住全局的 'Status'，
       mirror 语境靠 t('状态','mirror') 照拿 'State'，两边互不相扰。
       挪去后加载的分册会触发「全局词条被改写」的撞车警告 —— 别挪。 */
    '状态': 'Status',
    /* 顶栏品牌名（web/nav.js 的 .brand-n）与首页副标题。市场页标题早已译作
       'Mirror Universe · Market'，品牌名跟它同一个词，不另起炉灶。 */
    '镜像宇宙': 'Mirror Universe',
    '首页': 'Home',
    /* 顶栏页签「任务」（只有 ARCBANG 有这一页）。收在核心表的理由同「状态」：
       任务页与首页各自加载的分册不同，收在分册里会在另一页漏译。 */
    '任务': 'Quests'
  });

  /* ---- 宇宙与铸造 ---- */
  add({
    '引爆': 'Detonate',
    '引爆这个宇宙': 'Detonate this universe',
    '铸造': 'Mint',
    '把这个宇宙收下': 'Keep this universe',
    '救救它': 'Rescue it',
    '干预沙盒': 'Intervention sandbox',
    '已验证': 'Verified',
    '未验证': 'Unverified',
    '已救活': 'Rescued',
    '免费期，只花 gas': 'Free period — gas only',
    '铸造免费（只花 gas）': 'Minting is free (gas only)',
    '正在向服务端要签名…': 'Requesting signature from the server…',
    '正在连接钱包…': 'Connecting wallet…',
    '铸造成功！': 'Minted.',
    '已发出，等待上链…': 'Sent — waiting for confirmation…',
    '你在钱包里取消了': 'You cancelled it in the wallet',
    '没检测到小狐狸（MetaMask）—— 只读浏览不受影响':
      'MetaMask not detected — read-only browsing still works',
    '空间维数': 'Spatial dimension',
    '结局': 'Outcome',
    '稀有度': 'Rarity',
    '区块': 'Block',
    '引爆者': 'Detonated by',
    '已烧掉': 'Burned',
    '还没有人为它烧过币': 'Nobody has burned tokens for it yet'
  });

  /* ---- 结局名（与合约 outcomeName() 同序，语义不能改） ----
     **同一个结局在仓库里有四套中文写法**：引擎的长名（'热寂——无结构的宇宙'）、
     market.html 的（'热寂·无结构'）、arc-ui.js 的（'热寂 · 无结构'），
     以及我最初照英文回译写出来的第四种（'热寂，无结构'）—— 最后那种界面上根本
     不存在，是死词条。key 要逐字相等才命中，所以这里把**实际会出现的写法全列上**，
     都指向同一句英文。
     中文侧本该只有一种写法，但那是内容问题，不该在翻译任务里顺手改掉：
     有代码按这些串做判断，而且会改变中文用户看到的东西。已单独上报。 */
  add({
    /* 术语统一（2026-08-21 英文校订）：
       · D≥4 的物理是「不存在稳定轨道」，不是「轨道存在但不稳定」——
         用 No stable orbits，不用 Unstable orbits；
       · 热寂那格统一用全站通行的间隔号写法 'Heat death · no structure'
         （i18n-app / onboard 同句同译，三处不再各写各的）；
       · 黑洞主导作复合修饰语，连字符：Black-hole dominated。 */
    '无稳定轨道': 'No stable orbits',
    '无稳定轨道 / 无稳定原子的宇宙': 'No stable orbits or atoms',
    '大挤压': 'Big Crunch',
    '大坍缩': 'Big Crunch',
    '大撕裂': 'Big Rip',
    '热寂——无结构的宇宙': 'Heat death — a universe without structure',
    '热寂·无结构': 'Heat death · no structure',
    '热寂 · 无结构': 'Heat death · no structure',
    '黑洞主导': 'Black-hole dominated',
    '黑洞主导的宇宙': 'A black-hole-dominated universe',
    '没有原子': 'No atoms',
    '没有化学': 'No chemistry',
    '没有恒星': 'No stars',
    '有恒星但没有生命': 'Stars but no life',
    '有恒星无生命': 'Stars but no life',
    '有恒星但无生命': 'Stars but no life',
    '可能诞生观察者': 'Observers possible',
    '能诞生观察者': 'Observers possible',
    '无碳化学': 'No carbon chemistry',
    '没有碳化学': 'No carbon chemistry',
    '超出模型（D≠3）': 'Beyond model (D≠3)',
    '超出模型范围（D≠3）': "Beyond the model's range (D≠3)"
  });

  /* ---- 市场 ---- */
  add({
    '镜像宇宙 · 市场': 'Mirror Universe · Market',
    '我的宇宙': 'My universes',
    '宇宙市场': 'Market',
    '挂单': 'Listings',
    '我的 BANG 余额': 'My BANG balance',
    '全网已销毁': 'Total burned',
    '选择要出售的宇宙': 'Which universe to sell',
    '请先连接钱包': 'Connect a wallet first',
    '撤单': 'Cancel listing',
    '买下': 'Buy',
    '价格': 'Price',
    '卖家': 'Seller',
    '未部署': 'Not deployed',
    '这个地址名下还没有带参数的宇宙。': 'This address holds no universes with parameters yet.',
    '现在没有带参数的宇宙在售。': 'No universes with parameters are for sale right now.'
  });

  /* ------------------------------------------------------------ 运行时 */

  function stored() {
    try {
      var v = root.localStorage.getItem(KEY);
      return (v === 'zh' || v === 'en') ? v : null;
    } catch (e) { return null; }
  }
  function detect() {
    var n = root.navigator || {};
    var l = String(n.language || (n.languages && n.languages[0]) || 'en').toLowerCase();
    return l.indexOf('zh') === 0 ? 'zh' : 'en';
  }
  var cur = stored() || detect();

  function lang() { return cur; }
  /** 日期 / 数字格式化用的 locale：中文 zh-CN、英文 en-US。
      各页的 toLocaleString() 都要带上它 —— 不带就跟着浏览器语言走，
      英文界面上会冒出 "2026/10/4" 这种中文写法（2026-09-20 用户点名）。 */
  function locale() { return cur === 'en' ? 'en-US' : 'zh-CN'; }

  /**
   * 翻译一句。**没有译文就原样返回中文** —— 这是有意的：
   * 界面上出现半句英文半句中文，好过出现一个裸的 key。
   */
  function t(zh, ns) {
    if (cur === 'zh') return zh;
    if (ns && NS[ns] && NS[ns].hasOwnProperty(zh)) return NS[ns][zh];
    var v = EN[zh];
    return v == null ? zh : v;
  }

  /* 只翻译"整段完全命中"的文本节点。
     部分替换会误伤地址、哈希、数字与代码 —— 那类东西被"翻译"就是灾难。 */
  function walk(node) {
    if (!node) return;
    var SKIP = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
    var it = root.document.createTreeWalker(node, root.NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || SKIP[p.nodeName]) return root.NodeFilter.FILTER_REJECT;
        if (p.getAttribute && p.getAttribute('data-nolang') != null) return root.NodeFilter.FILTER_REJECT;
        return root.NodeFilter.FILTER_ACCEPT;
      }
    });
    var hits = [], n;
    while ((n = it.nextNode())) {
      var raw = n.nodeValue, s = raw.trim();
      if (!s) continue;
      var v = EN[s];
      if (v == null) continue;
      hits.push([n, raw, v]);
    }
    /* 先收集再改：改的过程中动 DOM 会让 TreeWalker 的位置失效 */
    for (var i = 0; i < hits.length; i++) {
      var node2 = hits[i][0], raw2 = hits[i][1], en = hits[i][2];
      if (cur === 'en') {
        if (node2.__zh == null) node2.__zh = raw2;      // 记下原文，切回来要用
        node2.nodeValue = raw2.replace(raw2.trim(), en);
      }
    }
  }

  /** 切回中文：把记过原文的节点还原。比重新翻译一遍可靠。
      记过原文的照着还原；**没记过原文的**（在英文态下现画出来的那些）走反查表 rev()，
      整段逐字命中才换回中文。后者不留标记 —— 下次切英文时 walk() 会照常再翻一遍。 */
  function restore(node) {
    var SKIP = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
    var it = root.document.createTreeWalker(node || root.document.body, root.NodeFilter.SHOW_TEXT, null);
    var R = rev(), n, p, raw, s2, zh;
    while ((n = it.nextNode())) {
      if (n.__zh != null) { n.nodeValue = n.__zh; n.__zh = null; continue; }
      p = n.parentNode;
      if (!p || SKIP[p.nodeName]) continue;
      if (p.getAttribute && p.getAttribute('data-nolang') != null) continue;
      raw = n.nodeValue; s2 = raw.trim();
      if (!s2) continue;
      zh = R[s2];
      if (zh != null) n.nodeValue = raw.replace(s2, zh);
    }
  }

  /* 属性也要翻。DOM 遍历只走文本节点，够不着 aria-label / title / placeholder ——
     不补这一段，英文模式下**读屏软件读到的全是中文**，而那正是最依赖标签的一群用户。
     只翻这几个确定是给人看的属性；`value`、`data-*`、`href` 一律不碰。
     规则与文本节点一致：整段完全命中才换，没命中原样留着。 */
  var ATTRS = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt'];

  function walkAttrs(rootEl) {
    var all = rootEl.querySelectorAll('*'), i, j, el, a, raw, en;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (el.getAttribute('data-nolang') != null) continue;
      for (j = 0; j < ATTRS.length; j++) {
        a = ATTRS[j];
        raw = el.getAttribute(a);
        if (raw == null) continue;
        en = EN[raw.trim()];
        if (en == null) continue;
        if (el.getAttribute('data-zh-' + a) == null) el.setAttribute('data-zh-' + a, raw);
        el.setAttribute(a, en);
      }
    }
  }
  function restoreAttrs(rootEl) {
    var all = rootEl.querySelectorAll('*'), i, j, el, a, zh, raw, R = rev();
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (el.getAttribute('data-nolang') != null) continue;
      for (j = 0; j < ATTRS.length; j++) {
        a = ATTRS[j];
        zh = el.getAttribute('data-zh-' + a);
        if (zh == null) {
          /* 英文态下由 JS 现写上去的属性没有 data-zh-* 备份：走反查表 */
          raw = el.getAttribute(a);
          if (raw == null) continue;
          var back = R[raw.trim()];
          if (back != null) el.setAttribute(a, raw.replace(raw.trim(), back));
          continue;
        }
        el.setAttribute(a, zh);
        el.removeAttribute('data-zh-' + a);
      }
    }
  }

  function applyStatic() {
    if (!root.document || !root.document.body) return;
    if (cur === 'en') { walk(root.document.body); walkAttrs(root.document.body); }
    else { restore(root.document.body); restoreAttrs(root.document.body); }
    /* <title> 不在 body 里，遍历够不着，单独处理 —— 它是浏览器标签页上那行字。 */
    var ti = root.document.querySelector('title');
    if (ti) {
      var tv = (ti.textContent || '').trim();
      if (cur === 'en') {
        var te = EN[tv];
        if (te != null) { if (!ti.getAttribute('data-zh')) ti.setAttribute('data-zh', tv); ti.textContent = te; }
      } else if (ti.getAttribute('data-zh')) {
        ti.textContent = ti.getAttribute('data-zh');
        ti.removeAttribute('data-zh');
      }
    }
    root.document.documentElement.setAttribute('lang', cur === 'en' ? 'en' : 'zh-CN');
  }

  function setLang(l) {
    if (LANGS.indexOf(l) < 0) return;
    if (l === cur) return;
    cur = l;
    try { root.localStorage.setItem(KEY, l); } catch (e) { /* 隐私模式：只在本次会话生效 */ }
    applyStatic();
    /* 动态渲染的部分（列表、卡片）自己重画一遍。
       各页监听这个事件；没监听的部分靠 applyStatic 的整段命中兜底。 */
    try {
      var ev = root.document.createEvent('Event');
      ev.initEvent('mirror:lang', true, false);
      root.document.dispatchEvent(ev);
    } catch (e) { /* 老浏览器：静态部分已经切了，动态部分等下次重画 */ }
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', applyStatic);
    } else {
      applyStatic();
    }
  }

  root.MirrorI18n = {
    t: t,
    lang: lang,
    locale: locale,
    /** 英文 → 中文的反查（整段逐字命中才有结果，查不到返回 null）。自检与各页兜底用。 */
    zh: function (en) { var v = rev()[String(en).trim()]; return v == null ? null : v; },
    set: setLang,
    apply: applyStatic,
    /** 给各模块补词条用：MirrorI18n.add({'中文':'English'}, '模块名') */
    add: function (map, ns) { add(map, ns); applyStatic(); },
    /** 某个模块下这条怎么翻，自检用 */
    peek: function (zh, ns) { return t(zh, ns); },
    /** 词条数，自检用 */
    size: function () { var n = 0, k; for (k in EN) if (EN.hasOwnProperty(k)) n++; return n; }
  };
})(typeof window !== 'undefined' ? window : this);
