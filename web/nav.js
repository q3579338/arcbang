/* ============================================================================
 * web/nav.js —— 站点顶栏，一处实现，三个页面各自挂载
 * ----------------------------------------------------------------------------
 * 收敛之前：index.html / web/market.html / web/status.html 各写各的顶栏标记，
 * 那份「站点顶栏 · 共用块 v1」的样式也在三处**逐字**各存一份（每份 97 行 CSS）。
 * 于是「三个导航栏不一样」是必然的：改一处忘两处，或者三处抄歪一处。
 *
 * 现在：样式 + 标记 + 行为都在这一个文件里，三页各调一次
 *   MirrorNav.mount({ page: 'simulator' | 'market' | 'status', ... })
 *
 * ------------------------------- 页面差异怎么表达 -------------------------------
 * **不复制整块**，只给参数：
 *   back:true    模拟器页要的「‹ 选宇宙」出口（#navBack）
 *   wallet:true  市场页要的钱包 chip（#btnConnect）+ 刷新（#btnRefresh）
 *   经济页两者都不给 —— 它没有链上操作，摆一颗连不上东西的钱包按钮只会误导
 * 页面独有、且带大段文案的东西（市场页的钱包浮层 #walletPop、旧的 #btnTheme）
 * 仍然以静态标记留在**它自己那一页**里，写在挂载点 <div id="siteNavMount"> 内部，
 * mount() 会把它们原样搬进 .topbtns。这样文案还在自己页面的词典覆盖范围内，
 * 也不用把一大坨 HTML 塞进 JS 字符串。
 *
 * ------------------------------- 站名口径 -------------------------------
 * 三页同一个结构：.brand > .brand-t > [ .brand-n 品牌名 ][ .brand-s 当前页副标题 ]
 * 类名、层级、文案口径完全一致，两截之间那个「·」是 .brand-s::before 画的，不是文本节点。
 * 只有最外层标签按页取（PAGES 表里的 brandTag）：市场页正文没有别的 h1，站名就是
 * 它的 h1；模拟器页（.hero-title）和经济页（「烧掉的币…」）正文各自已经有一个 h1，
 * 那边写 span —— 一页两个 h1 是文档结构错误，而市场页写 span 则是整页没有 h1。
 * 这条差异从三个 HTML 文件里各写各的，收进这一张表，成了一个有出处的参数。
 * **渲染完全一致**：.brand-t 把 margin / font-size / font-weight 全部写死了，
 * h1 和 span 出来一个像素不差。
 *
 * ------------------------------- 零外部请求 -------------------------------
 * 图标一律内联 SVG，样式由本文件在 <head> 最前面插一个 <style> ——
 * 没有任何外部资源。index.html 这条线由 build.js 把整个文件内联进 dist/mirror.html。
 * 样式插在 <head> **最前面**是有讲究的：这是基座，页面自己的 <style> 排在它后面
 * 才覆盖得掉（模拟器页要把 #siteNav 从 sticky 改成 fixed，靠的就是这个顺序）。
 * ========================================================================== */
(function (root) {
  'use strict';

  var d = root.document;
  if (!d) return;

  /* ------------------------------------------------------------ 样式（原「共用块 v1」逐字搬来）
     --navh 也在这里：它是顶栏自己的高度，连同三条响应式覆盖一起，只此一份。
     （原来 web/tokens.css 那张表里也有一个 --navh，两处并存的话，裸 :root 的那个
     会反超这里 @media 里的覆盖，窄屏就不收高了 —— 所以令牌表里那个已经去掉。） */
  var CSS = [
    "/* 顶栏高度。index.html 的 #app 从 var(--navh) 开始 —— 这个值是它的起点，别写死像素。 */",
    ":root{--navh:52px}",
    "",
    "#siteNav{position:sticky;top:0;z-index:85;height:var(--navh);",
    "  background:var(--panel);border-bottom:1px solid var(--line);color:var(--ink)}",
    "#siteNav .appbar-in{height:100%;max-width:1400px;margin:0 auto;padding:0 14px;",
    "  display:flex;align-items:center;gap:12px;flex-wrap:nowrap}",
    "#siteNav button{font-family:inherit;cursor:pointer}",
    "",
    "/* ---------------- 左区：站名 ----------------",
    "   外层标签允许各页不同（市场/经济用 h1，模拟器页正文已经有一个 h1、这里用 span，",
    "   一页两个 h1 是文档结构错误），**类名和内部结构必须一样**：",
    "     .brand > .brand-t > [ .brand-n 品牌名 ][ .brand-s 当前页 ]",
    "   两截之间那个「·」是 .brand-s::before 画的，不是文本节点 —— 它不该被翻译。 */",
    "#siteNav .brand{flex:0 1 auto;display:flex;align-items:center;min-width:0}",
    "#siteNav .brand-t{display:flex;align-items:baseline;gap:6px;margin:0;",
    "  font-size:15px;font-weight:700;letter-spacing:.02em;white-space:nowrap;color:var(--ink)}",
    "#siteNav .brand-a{color:inherit;text-decoration:none}",
    "#siteNav .brand-a:hover .brand-n{color:var(--cyan)}",
    "#siteNav .brand-s{font-weight:600;color:var(--dim)}",
    "#siteNav .brand-s::before{content:\"\\00B7\";margin-right:6px;color:var(--line2)}",
    "",
    "/* ---------------- 中区：页面切换 ----------------",
    "   flex-shrink 给 999：窄屏挤不下时**只**收这一条（它自己会横滚），右区一点不缩。",
    "   原来三区按基准宽度分摊收缩，topbtns 被压到比内容窄，overflow:visible 的",
    "   齿轮/刷新钮就露出视口右缘 —— 375px 英文态整页横滚 26–46px 的根因就是它。 */",
    "#siteNav .pagenav{flex:1 999 auto;display:flex;gap:2px;justify-content:center;min-width:0;",
    "  overflow-x:auto;scrollbar-width:none}",
    "#siteNav .pagenav::-webkit-scrollbar{display:none}",
    "#siteNav .pagelink{display:inline-flex;align-items:center;height:32px;padding:0 12px;flex:none;",
    "  border-radius:var(--radius-btn);color:var(--dim);text-decoration:none;",
    "  font-size:13px;font-weight:600;white-space:nowrap;transition:background .15s,color .15s}",
    "#siteNav .pagelink:hover{background:var(--panel2);color:var(--ink2)}",
    "#siteNav .pagelink[aria-current=\"page\"]{background:var(--sel2);color:var(--sel2-ink)}",
    "",
    "/* ---------------- 右区 ----------------",
    "   顺序固定：页面专属操作在前，设置齿轮永远在最右 —— 三页扫一眼，齿轮都在同一个角上。 */",
    "#siteNav .topbtns{flex:0 0 auto;position:relative;display:flex;gap:6px;align-items:center}",
    "/* 右区里的控件一律 32px 高。市场页那颗钱包按钮原本 36px（页面通用 button 的高度），",
    "   三页并排看就是一条栏高一条栏矮 —— 顶栏里的按钮归顶栏管，不跟正文按钮走。",
    "   只管直接子元素：浮层里的「切换账户 / 断开」还是正文按钮的尺寸。 */",
    "#siteNav .topbtns > button, #siteNav .topbtns > a{height:32px}",
    "/* 离线单文件里页面切换整条收起（market / status 那些页不在包里），撑开中间的 flex:1",
    "   也就跟着没了。收起时把右区顶回右边：两种构建里顶栏都是两端对齐的同一个样子。",
    "   （[hidden] 的元素照样参与选择器匹配，所以这条选得中。） */",
    "#siteNav .pagenav[hidden] + .topbtns{margin-left:auto}",
    "",
    "/* 图标按钮 32×32，图标一律内联 SVG：单文件构建不许有任何外部请求 */",
    "#siteNav .iconbtn{width:32px;height:32px;padding:0;flex:none;border:0;background:transparent;",
    "  color:var(--dim);border-radius:var(--radius-btn);text-decoration:none;",
    "  display:inline-flex;align-items:center;justify-content:center;",
    "  transition:background .15s,color .15s}",
    "#siteNav .iconbtn:hover:not(:disabled){background:var(--panel2);color:var(--ink2)}",
    "#siteNav .iconbtn svg{width:18px;height:18px;display:block;fill:none;stroke:currentColor;",
    "  stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}",
    "#siteNav .iconbtn.ok{color:var(--green)}",
    "#siteNav .iconbtn[aria-disabled=\"true\"]{opacity:.4;pointer-events:none}",
    "",
    "/* 主色 chip（钱包、模拟器页的「选宇宙」）：顶栏里唯一带底色的东西 */",
    "#siteNav .navchip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;",
    "  border:0;border-radius:var(--radius-chip);background:var(--sel2);color:var(--sel2-ink);",
    "  font-size:13px;font-weight:600;white-space:nowrap;transition:filter .15s}",
    "#siteNav .navchip:hover:not(:disabled){filter:brightness(.97)}",
    "#siteNav .navchip svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;",
    "  stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    "",
    "/* ---------------- 钱包 chip（walletChip 的壳，原市场页 §3.4 逐字搬来）----------------",
    "   两种形态同一颗按钮（#btnConnect）：未连接 = 上面那颗主色药丸（.navchip primary），",
    "   连上 = 加 .wchip（渐变头像 + 短地址）。换装由 walletChip() 的 paint 一处说了算。 */",
    "#siteNav .wchip{display:inline-flex;align-items:center;gap:8px;padding:0 12px 0 7px;",
    "  border:0;border-radius:var(--radius-chip);background:var(--sel2);color:var(--sel2-ink);",
    "  font-size:13px;font-weight:600;max-width:100%;min-width:0;transition:filter .15s}",
    "#siteNav .wchip:hover:not(:disabled){background:var(--sel2);filter:brightness(.97)}",
    "/* 地址那一截可以被截断：窄屏上（375px、连着钱包）右区不让位的话，",
    "   中间的页面切换会被压到 0，链接就全没了。宁可少显示两位地址。 */",
    "#siteNav .wchip .waddr{font-family:var(--mono);font-size:12.5px;white-space:nowrap;",
    "  overflow:hidden;text-overflow:ellipsis;min-width:0}",
    "/* 头像：纯 CSS 圆形色块，渐变从地址前几位派生（见 walletChip 里的 avatarCss）。",
    "   不引 blockies / gravatar 之类的外部图 —— 那等于把用户地址发给第三方。 */",
    "#siteNav .wav{width:18px;height:18px;border-radius:50%;flex:none;background:var(--dim3);",
    "  box-shadow:inset 0 0 0 1px var(--shadow)}",
    "#siteNav .wav-lg{width:26px;height:26px}",
    "/* 带 chip 的右区在窄屏上可以被压缩（钱包地址会先截断），",
    "   中间那条页面切换不至于被挤到 0。walletChip() 会把这个类挂上。 */",
    "#siteNav .topbtns.haswallet{flex:0 1 auto;min-width:0}",
    "",
    "/* ---------------- 浮层（设置 / 钱包）---------------- */",
    "#siteNav .pop{position:absolute;top:calc(100% + 10px);right:0;z-index:60;",
    "  width:300px;max-width:calc(100vw - 28px);",
    "  background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-pop);",
    "  box-shadow:var(--shadow-pop);padding:14px}",
    "#siteNav .pop-set{width:236px}",
    "/* 钱包浮层的内容排布（标记由 walletChip() 生成，四页同一份；原市场页逐字搬来） */",
    "#siteNav .poprow1{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}",
    "#siteNav .popaddrbox{display:flex;gap:8px;align-items:flex-start;min-width:0}",
    "#siteNav .popaddr{font-family:var(--mono);font-size:12px;line-height:1.55;color:var(--ink2);",
    "  word-break:break-all;overflow-wrap:anywhere}",
    "#siteNav .popicons{display:flex;gap:2px;flex:none}",
    "#siteNav .popbtns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
    "/* 「切换账户 / 换钱包 / 断开」不能靠页面的正文按钮样式：经济页和首页根本没有那套",
    "   button 规则。把市场页正文按钮的那几条值带过来，四页同款。",
    "   三颗钮在 375px 上会折成两行（min-width 约半宽），英文 Switch account 才挤得下。 */",
    "#siteNav .popbtns button{flex:1 1 calc(50% - 4px);min-width:0;height:36px;padding:0 10px;",
    "  border:1px solid var(--line2);border-radius:var(--radius-btn);background:var(--panel);",
    "  color:var(--ink2);font-size:13px;font-weight:600;",
    "  transition:background .15s,border-color .15s}",
    "#siteNav .popbtns button:hover:not(:disabled){background:var(--panel2)}",
    "/* 壳自己的反馈行：复制失败、断开后「授权还在」这类一句话 */",
    "#siteNav .popmsg{margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--dim)}",
    "#siteNav .popmsg.err{color:var(--bad)}",
    "#siteNav .popnote{margin:10px 0 0;font-size:11px;line-height:1.5;color:var(--dim);",
    "  border-top:1px solid var(--line-soft);padding-top:9px}",
    "/* 钱包浮层里的「个人中心 →」：只在已连接态显示（walletChip 的 paint 管 hidden）。",
    "   display 是 id+类写死的，UA 那条 [hidden] 特异性不够，得自己补一条。 */",
    "#siteNav .poplink{display:block;margin:12px 0 0;font-size:13px;font-weight:600;",
    "  color:var(--cyan);text-decoration:none}",
    "#siteNav .poplink:hover{text-decoration:underline}",
    "#siteNav .poplink[hidden]{display:none}",
    "/* 设置浮层：主题三选一 + 语言二选一，两行共用同一套 .setrow/.setlab/.seg/.segbtn */",
    "#siteNav .setrow{display:flex;flex-direction:column;gap:8px}",
    "#siteNav .setnote{font-size:11px;color:var(--dim);line-height:1.5}",
    "#siteNav .setrow + .setrow{margin-top:14px}",
    "#siteNav .setlab{font-size:12px;font-weight:600;color:var(--dim);letter-spacing:.04em}",
    "#siteNav .seg{display:flex;gap:2px;padding:3px;margin:0;border:0;overflow:visible;",
    "  background:var(--panel2);border-radius:var(--radius-btn)}",
    "#siteNav .segbtn{flex:1 1 0;height:28px;padding:0 6px;border:0;background:transparent;",
    "  color:var(--dim);border-radius:7px;font-size:12px;font-weight:600;white-space:nowrap}",
    "#siteNav .segbtn:hover:not([aria-checked=\"true\"]){background:var(--panel);color:var(--ink2)}",
    "#siteNav .segbtn[aria-checked=\"true\"]{background:var(--panel);color:var(--ink);",
    "  box-shadow:0 1px 2px var(--shadow)}",
    "",
    "/* ---------------- 窄屏 ----------------",
    "   **不换行、不整条收起**：换行会让顶栏高度变来变去，而 --navh 是 #app 的起点，",
    "   高度一跳画布就得重新分配一次。让位的顺序是「副标题 → 站名」，",
    "   中间那条页面切换永远在，挤不下就自己横滚，页面本身不横向滚动。 */",
    "@media (max-width:820px){",
    "  :root{--navh:48px}",
    "  #siteNav .appbar-in{padding:0 10px;gap:8px}",
    "}",
    "@media (max-width:560px){",
    "  #siteNav .brand-s{display:none}",
    "  #siteNav .pagenav{justify-content:flex-start}",
    "  #siteNav .pagelink{padding:0 9px}",
    "}",
    "@media (max-width:400px){",
    "  #siteNav .brand{display:none}",
    "}",
    "/* 矮视口（横屏手机、小笔记本）：顶栏再收 4px，把高度还给内容 */",
    "@media (max-height:700px){ :root{--navh:44px} }",
    "",
    "/* ---------------- 页脚友情链接 ----------------",
    "   八个公开页的页脚各写各的（首页的大页脚、市场/个人中心的安静一条、文档页的 footer.doc、",
    "   状态页两端对齐的一行），友链不再各配一套样式：标记在各页页脚里静态写死 ——",
    "   爬虫与 /en/ 预渲染都要在 HTML 里看得见它，JS 现画的链接对它们不存在 —— 样式只此一份。",
    "   色值、字号、字体全取 tokens.css 的令牌，跟着深浅主题走。flex:1 1 100% 是给状态页那种",
    "   flex 页脚用的（自己独占一行），普通块级页脚里没有作用；窄屏靠 flex-wrap 换行，不溢出。 */",
    ".sitefriends{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;flex:1 1 100%;",
    "  margin-top:14px;padding-top:12px;border-top:1px solid var(--line-soft);",
    "  font-family:var(--sans);font-size:12.5px;line-height:1.6;color:var(--dim)}",
    ".sitefriends-t{font-weight:600;letter-spacing:.04em}",
    ".sitefriends a{color:var(--ink3);text-decoration:none;white-space:nowrap}",
    ".sitefriends a:hover{color:var(--cyan);text-decoration:underline}"
  ].join('\n');

  function injectCSS() {
    if (d.getElementById('mirrorNavCSS')) return;
    var head = d.head || d.getElementsByTagName('head')[0];
    if (!head) return;
    var st = d.createElement('style');
    st.id = 'mirrorNavCSS';
    st.appendChild(d.createTextNode(CSS));
    /* 插在最前面：本文件是基座，页面自己的 <style>（排在它后面）才覆盖得掉。
       模拟器页把 #siteNav 改成 position:fixed 就是靠这个顺序 —— 两边都是
       单个 id 的特异性，谁在后面谁赢。 */
    head.insertBefore(st, head.firstChild);
  }
  injectCSS();   // 顶层就跑：首屏绘制前样式就位，不会先画出一条没样式的栏

  /* ------------------------------------------------------------ 三个页面入口
     顺序即显示顺序。label 同时用作 .brand-s 的副标题 —— 站名里那个词和中间
     那条链接上的词永远是同一个，不会出现「顶上写市场、链接写交易」这种漂移。
     brandTag：见文件头「站名口径」。渲染一致，只是文档结构各取所需。 */
  var PAGES = [
    { key: 'simulator', href: '/app.html',     id: 'navSim',     label: '引爆', brandTag: 'span' },
    /* 任务页（积分榜 / 白名单）：**只有 ARCBANG 有**，别站的导航里不出现。
       位置排在模拟器之后 —— 先是产品，再是这一季的活动。 */
    { key: 'quest',     href: '/quest.html',   id: 'navQuest',   label: '任务',   brandTag: 'h1', arcOnly: true },
    { key: 'market',    href: '/market.html',  id: 'navMarket',  label: '市场',   brandTag: 'h1' },
    /* 状态页正文自带 h1（「BNBBANG · 系统状态」），站名用 span —— 口径见文件头。 */
    { key: 'status',    href: '/status.html',  id: 'navStatus',  label: '状态',   brandTag: 'span' }
  ];
  /* 首页不进中间那排页签 —— 它是「站」本身，不是站里的一页；
     品牌名就是回它的链接，再给它一个页签只会跟品牌名抢同一件事。 */
  var HOME = { key: 'home', href: '/', id: 'navHome', label: '首页', brandTag: 'h1' };
  /* 个人中心照 HOME 的先例：给 mount 一个合法 page 型，但不进中间那排页签 ——
     它是「你」的页面，入口在钱包浮层里（见 walletPopHtml 的 #lnkProfile），
     没连钱包的人点进去也只有一个连接提示，摆进页签只会让多数人扑空。
     brandTag 用 h1：该页正文没有别的 h1，站名就是它的 h1（口径见文件头）。 */
  var PROFILE = { key: 'profile', href: '/profile.html', id: 'navProfile', label: '个人中心', brandTag: 'h1' };
  /* 文档页（how-it-works / faq / verify）：合法 page 型，不进中间那排页签 ——
     它们是给搜索引擎与第一次来的人读的说明，正文各自有 h1，站名用 span。 */
  var DOC = { key: 'doc', href: '/how-it-works.html', id: 'navDoc', label: '文档', brandTag: 'span' };
  function pageOf(key) {
    if (key === 'home') return HOME;
    if (key === 'profile') return PROFILE;
    if (key === 'doc') return DOC;
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].key === key) return PAGES[i];
    return null;
  }

  /* 图标全部内联：单文件构建不许有任何外部请求 */
  var SVG_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"/></svg>';
  var SVG_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>';
  var SVG_REFRESH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>';

  /* ------------------------------------------------------------ 标记
     文案写成静态文本节点（不是 JS 拼的字符串常量）：MirrorI18n 在 DOMContentLoaded
     上遍历 document.body 翻译，mount() 是同步跑在 body 解析途中的，所以这些节点
     那时已经在树上，照样被翻到。 */
  /* 站点标识（specs/arcbang-v1.md）：'arc' = ARCBANG，品牌名「ARC宇宙」。
     **每次现读，不在文件顶层捕获**：市场 / 文档页里 nav.js 排在 config.js 之前，顶层读到的永远是空。
     两个来源按序：window.ARCBANG_SITE（build-web.js 在每页 <head> 里打的一行，
     mount 时一定已经在）→ ARCBANG_CONFIG.site（config.js 先于 nav.js 的页面，或 mount 之后的补正）。 */
  function siteOf() {
    var c = root.ARCBANG_CONFIG || {};
    return String(root.ARCBANG_SITE || c.site || '');
  }
  function brandName() {
    return siteOf() === 'arc' ? 'ARC宇宙' : '镜像宇宙';
  }

  function html(o, pg) {
    var s = '';
    s += '<header class="appbar" id="siteNav">';
    s += '<div class="appbar-in">';

    var bt = pg.brandTag;
    /* 品牌名是回首页的链接（首页上点了原地刷新，无害）。副标题不进链接：
       它标的是"你在哪"，点它回首页只会让人迷路。 */
    s += '<div class="brand"><' + bt + ' class="brand-t">'
       + '<a class="brand-a" href="/"><span class="brand-n">' + brandName() + '</span></a>'
       + '<span class="brand-s">' + pg.label + '</span>'
       + '</' + bt + '></div>';

    s += '<nav class="pagenav" id="pageNav" aria-label="站点页面">';
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i], cur = (p.key === pg.key);
      if (p.arcOnly && siteOf() !== 'arc') continue;
      s += '<a class="pagelink" id="' + p.id + '" href="' + p.href + '"'
         + (cur ? ' aria-current="page"' : '') + '>' + p.label + '</a>';
    }
    s += '</nav>';

    s += '<div class="topbtns">';

    /* 模拟器页：新手出口。默认 hidden，起爆页之外由 app.js 的 syncNav 放出来。 */
    if (o.back) {
      s += '<button type="button" id="navBack" class="navchip" hidden'
         + ' title="回到选宇宙那一步" aria-label="回到选宇宙">'
         + SVG_BACK + '<span>选宇宙</span></button>';
    }

    /* 市场页：钱包 chip + 刷新。
       #btnConnect 的文字与形态由 walletChip() 的 paint 一处写（页面调它接上适配器）；
       这里只出未连接的初始形态。 */
    if (o.wallet) {
      s += '<button id="btnConnect" class="navchip primary" type="button"'
         + ' data-pop="walletPop" aria-expanded="false">连接钱包</button>';
      s += '<button id="btnRefresh" class="iconbtn" type="button" title="刷新" aria-label="刷新">'
         + SVG_REFRESH + '</button>';
    }

    /* 设置齿轮：三页都有，永远排在最右 —— 三页扫一眼，齿轮都在同一个角上。 */
    s += '<button type="button" id="btnSettings" class="iconbtn" data-pop="settingsPop"'
       + ' title="设置" aria-label="设置" aria-haspopup="dialog" aria-expanded="false">'
       + SVG_GEAR + '</button>';

    /* 设置浮层：主题三选一 + 语言二选一。三页都有，就这一份实现。
       「中文 / English」两个选项不进词典：语言名永远用它自己那门语言写。 */
    s += '<div class="pop pop-set" id="settingsPop" role="dialog" aria-label="设置" hidden>'
       +   '<div class="setrow"><span class="setlab">主题</span>'
       +     '<div class="seg" id="themeSeg" role="radiogroup" aria-label="主题">'
       +       '<button class="segbtn" type="button" role="radio" aria-checked="false" data-theme-mode="light">浅色</button>'
       +       '<button class="segbtn" type="button" role="radio" aria-checked="false" data-theme-mode="dark">深色</button>'
       +       '<button class="segbtn" type="button" role="radio" aria-checked="false" data-theme-mode="system">跟随系统</button>'
       +     '</div>'
       /* 深空页(首页/状态页)钉死深色:开关照常可用——选择会存下来应用到市场/经济页,
          但不说明白的话,用户在这一页点「浅色」看不到变化,只会当开关坏了。 */
       +     (root.MIRROR_FORCE_DARK
              ? '<div class="setnote">本页固定深空主题，此选择将应用于其他页面</div>' : '')
       +   '</div>'
       /* data-nolang：语言名永远用它自己那门语言写（「中文 / English」不进词典），
          「语言 / Language」这行标签本身就是双语 —— 整行按专名白名单处理，CJK 扫描不算残留。 */
       +   '<div class="setrow" data-nolang><span class="setlab">语言 / Language</span>'
       +     '<div class="seg" id="langSeg" role="radiogroup" data-nolang aria-label="语言 / Language">'
       +       '<button class="segbtn" type="button" role="radio" aria-checked="false" data-lang="zh">中文</button>'
       +       '<button class="segbtn" type="button" role="radio" aria-checked="false" data-lang="en">English</button>'
       +     '</div>'
       +   '</div>'
       + '</div>';

    s += '</div></div></header>';
    return s;
  }

  /* ------------------------------------------------------------ 浮层控制器
     通用行为：点外部关闭、Esc 关闭且焦点还给触发按钮、触发按钮带 aria-expanded、
     同一页上多个浮层互斥（开一个关其他）。
     注册表让页面把自己的浮层挂进来（市场页的 #walletPop 就是这么进来的），
     于是「设置和钱包互斥」不用任何一页再写一遍。 */
  var REG = {};                      // popId -> triggerId
  function $(id) { return d.getElementById(id); }
  function isOpen(id) { var el = $(id); return !!el && !el.hidden; }
  function anyOpen() {
    for (var id in REG) if (REG.hasOwnProperty(id) && isOpen(id)) return id;
    return null;
  }
  function closeAll() {
    for (var id in REG) {
      if (!REG.hasOwnProperty(id)) continue;
      var el = $(id), b = $(REG[id]);
      if (el) el.hidden = true;
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  }
  function openPop(id) {
    var el = $(id);
    if (!el) return;
    closeAll();                      // 先全关：互斥
    el.hidden = false;
    var b = $(REG[id]);
    if (b) b.setAttribute('aria-expanded', 'true');
    /* 每次打开都把两组单选重对一次。主题不止这一个入口 —— 模拟器页右键菜单里
       那一项直接调 MirrorTheme.toggle()，只在自己的 click 里同步的话，
       用右键菜单切完再打开面板，就会看到「页面是浅色、高亮却在深色」。 */
    if (id === 'settingsPop') { syncThemeSeg(); syncLangSeg(); }
  }
  function togglePop(id) {
    var el = $(id);
    if (!el) return;
    if (el.hidden) openPop(id); else closeAll();
  }
  /* bindTrigger=false：只登记浮层（照样有点外部关 / Esc 关 / 与别的浮层互斥），
     但**不接管触发按钮的 click**。市场页的钱包 chip 就是这种：
     未连接时点它是去连钱包，连上之后才是开浮层，那套判断归它自己。 */
  function registerPop(popId, triggerId, bindTrigger) {
    REG[popId] = triggerId;
    if (bindTrigger === false) return;
    var b = $(triggerId);
    if (b && !b.__navPop) {
      b.__navPop = 1;
      b.addEventListener('click', function (ev) { ev.preventDefault(); togglePop(popId); });
    }
  }

  var wired = false;
  function wireGlobal() {
    if (wired) return;
    wired = true;
    d.addEventListener('click', function (ev) {
      if (!anyOpen()) return;
      var t = ev.target;
      if (!t || !t.closest) { closeAll(); return; }
      if (t.closest('.pop') || t.closest('[data-pop]')) return;   // 浮层里面和触发器自己不算"外部"
      closeAll();
    });
    d.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
      var open = anyOpen();
      if (!open) return;
      closeAll();
      var b = $(REG[open]);
      if (b) { try { b.focus(); } catch (e) { /* ignore */ } }     // 焦点还给触发按钮，别掉到 body 上
    });
    /* 顶栏里的按键不许漏给画面。模拟器页在 document 上挂着一大串单键快捷键
       （空格暂停、A 分析、M 镜像、O 俯瞰…）；焦点在顶栏按钮上按空格，
       既要激活按钮又会顺手把模拟暂停掉。顶栏自己吃掉 keydown。 */
    var n = $('siteNav');
    if (n) {
      n.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Escape' || ev.key === 'Esc') && anyOpen()) {
          closeAll();
          var b = $('btnSettings');
          if (b) { try { b.focus(); } catch (e) { /* ignore */ } }
          ev.preventDefault();
        }
        ev.stopPropagation();
      });
    }
  }

  /* ------------------------------------------------------------ 主题三选一
     全部走 ui/theme.js（window.MirrorTheme）——**这是唯一一份主题实现**。
     用 mode() 而不是 get()：选了「跟随系统」而系统恰好是浅色时，get() 会让高亮
     打在「浅色」上，用户下次打开会以为自己选的是固定浅色。theme.js 为此分了两个方法。 */
  function syncThemeSeg() {
    var seg = $('themeSeg');
    if (!seg || !root.MirrorTheme) return;
    var mode = root.MirrorTheme.mode ? root.MirrorTheme.mode() : 'system';
    var bs = seg.querySelectorAll('.segbtn'), i;
    for (i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-checked', bs[i].getAttribute('data-theme-mode') === mode ? 'true' : 'false');
    }
  }
  var themeSubs = [];
  function wireTheme() {
    var seg = $('themeSeg');
    if (!seg) return;
    /* theme.js 缺席就把整行收起来：摆一个按不动的开关比没有开关更糟。 */
    if (!root.MirrorTheme) { if (seg.parentNode) seg.parentNode.hidden = true; return; }
    seg.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('.segbtn') : null;
      if (!b) return;
      root.MirrorTheme.set(b.getAttribute('data-theme-mode'));   // 'system' 走 theme.js 的删 key 分支
      syncThemeSeg();
    });
    syncThemeSeg();
    /* 谁改了主题都跟着对一次：右键菜单、theme.js 自己那颗按钮、以及「跟随系统」时
       系统主题的实时变化，走的都不是上面那个 click —— 盯住 <html data-theme>
       是唯一一个把它们全覆盖到的地方。老浏览器退回「打开浮层时重对」（见 openPop）。 */
    if (!root.MutationObserver) return;
    try {
      new root.MutationObserver(function () {
        syncThemeSeg();
        for (var i = 0; i < themeSubs.length; i++) {
          try { themeSubs[i](root.MirrorTheme.get()); } catch (e) { /* 订阅方自己的错不许连累别人 */ }
        }
      }).observe(d.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) { /* 老浏览器：靠 openPop 里那次重对兜住 */ }
  }

  /* ------------------------------------------------------------ 语言二选一
     真正的活是 MirrorI18n.set() 干的：写 localStorage、翻静态文本节点，然后派
     mirror:lang —— 各页在那个监听器里重画 JS 拼出来的那一半。这里只管高亮。 */
  function syncLangSeg() {
    var seg = $('langSeg');
    if (!seg) return;
    var cur = root.MirrorI18n ? root.MirrorI18n.lang() : 'zh';
    var bs = seg.querySelectorAll('.segbtn'), i;
    for (i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-checked', bs[i].getAttribute('data-lang') === cur ? 'true' : 'false');
    }
  }
  function wireLang() {
    var seg = $('langSeg');
    if (!seg) return;
    /* i18n 没加载成功就把整行藏掉：摆一个按不动的开关比没有开关更糟。 */
    if (!root.MirrorI18n) { if (seg.parentNode) seg.parentNode.hidden = true; return; }
    seg.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('.segbtn') : null;
      if (!b) return;
      var lang = b.getAttribute('data-lang');
      /* ARCBANG 的三个说明页是各写一份的静态正文（中文在根、英文在 /en/），词典翻不动它们：
         开关直接跳到 <link rel=alternate hreflang> 指的那一份（09-17 用户把页脚的语言链接删了，只留这一个开关）。 */
      if (siteOf() === 'arc' && /\/(faq|how-it-works|verify)\.html$/.test(location.pathname)) {
        var alt = document.querySelector('link[rel="alternate"][hreflang="' + (lang === 'en' ? 'en' : 'zh-CN') + '"]');
        /* hreflang 里是构建时写死的正式域名；本地预览与镜像域名也要能跳，所以只取路径、换成当前 origin */
        var to = null;
        try { to = alt ? new URL(alt.getAttribute('href'), location.href).pathname : null; } catch (e) { to = null; }
        if (to && to !== location.pathname) {
          root.MirrorI18n.set(lang);
          location.href = location.origin + to;
          return;
        }
      }
      root.MirrorI18n.set(lang);
      syncLangSeg();                 // set() 只在真换了语言时派事件，这里无条件对一次
    });
    syncLangSeg();
  }

  /* ------------------------------------------------------------ 钱包 chip（壳）
     市场页那套钱包 UI 的**壳**：chip（未连接 = 主色「连接钱包」钮，连上 = 渐变头像 +
     短地址）+ 浮层（完整地址 mono 可换行 / 复制反馈 / 区块浏览器 / 切换账户 / 断开 /
     链名提示行）。**行为不在这里** —— 全由页面的适配器提供：
       { account()        当前地址（null = 未连接）
         connect()        点「连接钱包」。reject 的话错误进浮层；页面自己报错（toast）
                          的就永不 reject（市场页是这种）
         disconnect()     断开。resolve 一句要给用户看的话（「授权还在」那类）就摆进浮层
         switchAccount()  切换账户。reject 的 message 摆进浮层
         explorer()       地址页 URL（浮层里那个外链图标）
         onChange(fn)     账户变了叫 fn —— 壳靠它重画（页面也可以直接调返回值的 refresh）
         connectHint()    可选：未连接时 chip 的 title（市场页写「连接钱包后可以看…」） }
     #btnConnect 的语义与市场页原样一致：**未连接点它 = 连接，连上之后点它 = 开浮层**。
     浮层走上面 registerPop 那套（点外关 / Esc 关 / 与设置互斥）。
     文案全走 t()（词条在 i18n.js 核心表与 i18n-market/i18n-site 的全局表里），并在
     mirror:lang 上整块重刷 —— 这块标记可能在 DOMContentLoaded **之后**才生成
     （模拟器页由 bnb-ui 在 DOMContentLoaded 里调），不能指望 MirrorI18n 的
     DOM 遍历替它翻。 */
  function tt(zh) { return root.MirrorI18n ? root.MirrorI18n.t(zh) : zh; }
  function ttf(zh, a) { return tt(zh).split('{0}').join(String(a)); }

  /* ============================================================ 链身份
     唯一真相来源是 web/config.arc.js 的 chain 块；**派生只有这一份**，首页 / 市场 /
     经济 / 状态 / 个人中心五个页面都调 MirrorNav.chain()，各自不再抄一遍。
     抄一遍就是「改了一处漏三处」，而这正是这轮改造要拔掉的病。
     （模拟器那条线走 web/arc-chain.js 自己那份 —— 链访问层不该反过来依赖顶栏这个
       UI 模块，两边各自从同一个 chain 块派生，不互相调用。）

     nav.js 在好几个页面上比 config.js **先**加载，所以每次现取，
     不在顶层缓存住一个那时候还不存在的值。 */
  var CHAIN_FALLBACK = {
    id: 97, name: 'BSC 测试网', nameEn: 'BSC Testnet',
    explorer: 'https://testnet.bscscan.com', currency: 'tBNB', isTestnet: true
  };
  var CHAIN_MAINNET_FALLBACK = {
    id: 56, name: 'BSC 主网', nameEn: 'BSC Mainnet',
    explorer: 'https://bscscan.com', currency: 'BNB', isTestnet: false
  };
  function rpcJoin(cfg) {
    var rpcs = (cfg && cfg.rpc) || [];
    return (rpcs && rpcs.join) ? rpcs.join(' ') : String(rpcs || '');
  }
  function rpcLooksTestnet(cfg) { return /testnet/i.test(rpcJoin(cfg)); }
  function rpcLooksMainnet(cfg) {
    var s = rpcJoin(cfg);
    return /bsc-dataseed|bsc-mainnet/i.test(s) && !/testnet/i.test(s);
  }
  /* isTestnet 门控：主网不能误显示「测试资产无价值」，测试网也不能把提示丢掉。
     字面 true/false 永远优先；漏写时按 id / 货币 / 浏览器 / 链名推断；
     整块缺席时再看 rpc —— 绝不用测试网兜底对象上的 isTestnet:true 去给主网贴标签。 */
  function resolveIsTestnet(c, missing, cfg) {
    if (c && c.isTestnet === true) return true;
    if (c && c.isTestnet === false) return false;
    var id = c && c.id != null ? Number(c.id) : NaN;
    if (id === 56) return false;
    if (id === 97) return true;
    if (c && String(c.currency || '') === 'tBNB') return true;
    if (c && /testnet/i.test(String(c.explorer || ''))) return true;
    if (c && /测试网|testnet/i.test(String(c.name || '') + ' ' + String(c.nameEn || ''))) return true;
    if (missing) {
      if (rpcLooksTestnet(cfg)) return true;
      if (rpcLooksMainnet(cfg)) return false;
    }
    return false;
  }
  function chainCfg() {
    var cfg = root.ARCBANG_CONFIG || {};
    var raw = cfg.chain;
    var missing = !raw;
    if (missing && !root.__bnbbangChainWarned) {
      root.__bnbbangChainWarned = 1;
      if (root.console && root.console.warn) {
        root.console.warn('[config] web/config.arc.js 里没有 chain 块，按 RPC 推断链身份 —— 换链请改那一块');
      }
    }
    var c = raw || {};
    var fb = (missing && rpcLooksMainnet(cfg) && !rpcLooksTestnet(cfg))
      ? CHAIN_MAINNET_FALLBACK : CHAIN_FALLBACK;
    return {
      id: c.id != null ? Number(c.id) : fb.id,
      name: c.name || fb.name,
      nameEn: c.nameEn || c.name || fb.nameEn,
      explorer: String(c.explorer || fb.explorer).replace(/[/]+$/, ''),
      currency: c.currency || fb.currency,
      isTestnet: resolveIsTestnet(c, missing, cfg)
    };
  }
  /** 界面上给人看的链名：中文态用 chain.name，英文态用 chain.nameEn。 */
  function chainName() {
    var c = chainCfg(), en = !!(root.MirrorI18n && root.MirrorI18n.lang() === 'en');
    return (en && c.nameEn) ? c.nameEn : (c.name || c.nameEn || '');
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var SVG_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M6.5 15H5.6A1.6 1.6 0 0 1 4 13.4V5.6A1.6 1.6 0 0 1 5.6 4h7.8A1.6 1.6 0 0 1 15 5.6v.9"/></svg>';
  var SVG_EXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18.5 14.5v4A1.5 1.5 0 0 1 17 20H5.5A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5h4"/></svg>';
  var SVG_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.8 9.3 17.5 19.5 6.9"/></svg>';

  function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  /* 钱包头像：从地址前几位派生的纯 CSS 渐变色块（原市场页 avatarCss 逐字搬来）。
     不引 blockies / gravatar 那类外部图 —— 那等于把用户地址发给第三方，
     而且离线单文件的前提就是零外部资源。 */
  function avatarCss(a) {
    var h = String(a || '').replace(/^0x/, '');
    var h1 = parseInt(h.slice(0, 3) || '0', 16) % 360;
    var h2 = (h1 + 40 + (parseInt(h.slice(3, 5) || '0', 16) % 140)) % 360;
    return 'linear-gradient(135deg,hsl(' + h1 + ',72%,58%),hsl(' + h2 + ',66%,44%))';
  }

  function copyText(s) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(s);
    }
    /* http:// 或旧浏览器下没有 clipboard API，退回 execCommand */
    return new Promise(function (resolve, reject) {
      var ta = d.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      d.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = d.execCommand('copy'); } catch (e) { ok = false; }
      d.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error(tt('浏览器不让复制')));
    });
  }

  function walletPopHtml() {
    return '<div class="pop" id="walletPop" role="dialog" aria-label="' + esc(tt('钱包')) + '" hidden>'
      +   '<div class="poprow1">'
      +     '<div class="popaddrbox">'
      +       '<span class="wav wav-lg" id="walletAv"></span>'
      +       '<span class="popaddr" id="walletFull">' + esc(tt('未连接')) + '</span>'
      +     '</div>'
      +     '<div class="popicons">'
      +       '<button id="btnCopyAddr" class="iconbtn" type="button" title="' + esc(tt('复制地址')) + '" aria-label="' + esc(tt('复制地址')) + '">' + SVG_COPY + '</button>'
      +       '<a id="lnkExplorer" class="iconbtn" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"'
      +         ' title="' + esc(tt('在区块浏览器里打开')) + '" aria-label="' + esc(tt('在区块浏览器里打开')) + '" aria-disabled="true">' + SVG_EXT + '</a>'
      +     '</div>'
      +   '</div>'
      /* 个人中心入口：未连接时 hidden（paint 按 account 开关）——
         没连钱包的个人中心只有一个连接提示，摆出来等于请人去扑空。 */
      +   '<a class="poplink" id="lnkProfile" href="/profile.html" hidden>' + esc(tt('个人中心')) + ' →</a>'
      +   '<div class="popbtns">'
      +     '<button id="btnSwitchAcct" type="button">' + esc(tt('切换账户')) + '</button>'
      +     '<button id="btnSwitchWallet" type="button">' + esc(tt('换钱包')) + '</button>'
      +     '<button id="btnDisconnect" type="button">' + esc(tt('断开')) + '</button>'
      +   '</div>'
      +   '<p class="popmsg" id="walletMsg" hidden></p>'
      +   '<p class="popnote" id="walletNote">' + walletNoteHtml() + '</p>'
      + '</div>';
  }
  function walletNoteHtml() {
    /* 三段拼法与原市场页的静态标记一致（<b> 前后各自是独立文本节点）。
       第一段原来写死「BNB Smart Chain 测试网。」，现在从 config.js 的 chain 块来：
       链名是数据，**但句子仍然整句进词典**（'当前链：{0}。'）—— 中文的句号和英文的
       句点、以及后面那个空格都不一样，在外面拼就会拼错。 */
    return esc(ttf('当前链：{0}。', chainName()))
      + '<b>' + esc(tt('「断开」只清得掉本页的状态')) + '</b> '
      + esc(tt('—— 连接是钱包授予这个站点的权限，网页替你挂断不了；能撤就撤，撤不掉会明说。'));
  }

  function walletChip(adapter) {
    if (!adapter || typeof adapter.account !== 'function') return null;
    var top = d.querySelector('#siteNav .topbtns');
    if (!top) return null;                       // 没挂顶栏（离线单文件）：页面自己找退路
    top.classList.add('haswallet');

    var b = $('btnConnect');
    if (!b) {
      /* mount({wallet:true}) 没出过这颗钮的页面（模拟器 / 经济 / 首页）：这里补上。
         位置：刷新钮之前；没有刷新钮就在设置齿轮之前 —— 齿轮永远最右。 */
      b = d.createElement('button');
      b.id = 'btnConnect';
      b.type = 'button';
      b.className = 'navchip primary';
      b.setAttribute('data-pop', 'walletPop');
      b.setAttribute('aria-expanded', 'false');
      top.insertBefore(b, $('btnRefresh') || $('btnSettings') || null);
    }
    if (!$('walletPop')) {
      var box = d.createElement('div');
      box.innerHTML = walletPopHtml();
      top.appendChild(box.firstChild);
    }
    registerPop('walletPop', 'btnConnect', false);   // click 归下面这套连接/开浮层判断

    var painted = null;      // 上一次画的地址：换了人就把浮层里的旧反馈清掉
    function say(txt, kind) {
      var m = $('walletMsg');
      if (!m) return;
      if (!txt) { m.hidden = true; m.textContent = ''; m.className = 'popmsg'; return; }
      m.hidden = false;
      m.textContent = txt;
      m.className = 'popmsg' + (kind === 'err' ? ' err' : '');
    }
    function paint() {
      var a = adapter.account() || null;
      if (a !== painted) { painted = a; say(''); }
      var full = $('walletFull'), lnk = $('lnkExplorer'), av = $('walletAv');
      if (a) {
        /* chip：头像 + 短地址。用 innerHTML 是因为 chip 里有个色块，
           textContent 会把它抹掉 —— 但写的还是只有这一处。 */
        b.innerHTML = '<span class="wav" style="background:' + avatarCss(a) + '"></span>'
          + '<span class="waddr">' + esc(shortAddr(a)) + '</span>';
        b.title = ttf('{0} · 点开看完整地址、切换账户、换钱包、断开', a);
        b.classList.remove('primary');
        b.classList.add('connected', 'wchip');
        b.setAttribute('aria-haspopup', 'dialog');
      } else {
        b.textContent = tt('连接钱包');
        var hint = (typeof adapter.connectHint === 'function') ? adapter.connectHint() : '';
        if (hint) b.title = hint; else b.removeAttribute('title');
        b.classList.add('primary');
        b.classList.remove('connected', 'wchip');
        b.removeAttribute('aria-haspopup');
      }
      if (full) full.textContent = a || tt('未连接');
      if (av) av.style.background = a ? avatarCss(a) : '';
      var pl = $('lnkProfile');
      if (pl) pl.hidden = !a;
      if (lnk) {
        var url = (a && typeof adapter.explorer === 'function') ? adapter.explorer() : '';
        if (url) { lnk.href = url; lnk.removeAttribute('aria-disabled'); }
        else { lnk.removeAttribute('href'); lnk.setAttribute('aria-disabled', 'true'); }
      }
    }

    if (!b.__navWallet) {
      b.__navWallet = 1;
      b.addEventListener('click', function () {
        /* 连上之后这颗钮是 chip，也是钱包浮层的触发器 ——
           「断开」在浮层里，不是点一下 chip 就断（点错的代价太大）。 */
        if (adapter.account()) { say(''); togglePop('walletPop'); return; }
        /* 未连接时它不是浮层触发器，但身上挂着 data-pop（连上才用得上），
           而"点外部关闭"那个监听见到 [data-pop] 就放行 —— 开着设置浮层时
           点「连接钱包」，浮层会一直挂着。这里补一次关闭。 */
        closeAll();
        b.disabled = true;
        Promise.resolve().then(function () { return adapter.connect(); }).then(
          function () { b.disabled = false; paint(); },
          function (e) {
            b.disabled = false;
            paint();
            openPop('walletPop');   // 错误摆在浮层里：这几页没有市场页那套 toast
            say((e && e.message) ? e.message : String(e), 'err');
          }
        );
      });
      $('btnCopyAddr').addEventListener('click', function () {
        var a = adapter.account();
        if (!a) return;
        var cb = $('btnCopyAddr');
        copyText(a).then(function () {
          cb.innerHTML = SVG_CHECK;                  // 复制成功的反馈：图标短暂变对勾
          cb.classList.add('ok');
          cb.title = tt('已复制');
          clearTimeout(cb.__t);
          cb.__t = setTimeout(function () {
            cb.innerHTML = SVG_COPY;
            cb.classList.remove('ok');
            cb.title = tt('复制地址');
          }, 1400);
        }, function () {
          say(tt('复制不了 —— 手动选中浮层里那串地址复制'), 'err');
        });
      });
      $('btnSwitchAcct').addEventListener('click', function () {
        say('');
        Promise.resolve().then(function () { return adapter.switchAccount(); }).then(
          function () { paint(); },
          function (e) { paint(); say((e && e.message) ? e.message : String(e), 'err'); }
        );
      });
      /* 「换钱包」：清掉 rdns 记忆，再走连接入口（≥2 个钱包一定弹选择器）。
         取消选择器不算错误 —— 本页地址还在，只是下次连不会再静默直连记住的那一个。 */
      if ($('btnSwitchWallet')) $('btnSwitchWallet').addEventListener('click', function () {
        say('');
        closeAll();
        var MW = root.MirrorWallet;
        if (MW && MW.forget) MW.forget();
        b.disabled = true;
        Promise.resolve().then(function () { return adapter.connect(); }).then(
          function () { b.disabled = false; paint(); },
          function (e) {
            b.disabled = false;
            paint();
            openPop('walletPop');
            say((e && e.message) ? e.message : String(e), 'err');
          }
        );
      });
      $('btnDisconnect').addEventListener('click', function () {
        closeAll();                                  // 市场页原有顺序：先关浮层再断
        Promise.resolve().then(function () { return adapter.disconnect(); }).then(
          function (msg) {
            paint();
            /* 适配器给了一句话（「授权还在」那类）就把浮层再打开摆给人看 ——
               这几页没有 toast，闷着不说等于骗人说断干净了。 */
            if (typeof msg === 'string' && msg) { openPop('walletPop'); say(msg); }
          },
          function (e) {
            paint();
            openPop('walletPop');
            say((e && e.message) ? e.message : String(e), 'err');
          }
        );
      });
    }

    if (typeof adapter.onChange === 'function') adapter.onChange(function () { paint(); });

    /* 切语言：这块标记的文字全是 t() 拼的（可能生成于 DOMContentLoaded 之后，
       MirrorI18n 的 DOM 遍历不一定盖得到），整块重刷。 */
    d.addEventListener('mirror:lang', function () {
      var el;
      el = $('btnSwitchAcct'); if (el) el.textContent = tt('切换账户');
      el = $('btnSwitchWallet'); if (el) el.textContent = tt('换钱包');
      el = $('btnDisconnect'); if (el) el.textContent = tt('断开');
      el = $('btnCopyAddr'); if (el) { el.title = tt('复制地址'); el.setAttribute('aria-label', tt('复制地址')); }
      el = $('lnkExplorer'); if (el) { el.title = tt('在区块浏览器里打开'); el.setAttribute('aria-label', tt('在区块浏览器里打开')); }
      el = $('walletPop'); if (el) el.setAttribute('aria-label', tt('钱包'));
      el = $('lnkProfile'); if (el) el.textContent = tt('个人中心') + ' →';
      el = $('walletNote'); if (el) el.innerHTML = walletNoteHtml();
      paint();
    });

    paint();
    return { refresh: paint, say: say };
  }

  /* ------------------------------------------------------------ mount */
  function mount(opts) {
    var o = opts || {};
    var pg = pageOf(o.page);
    if (!pg) throw new Error('MirrorNav.mount: 不认识的 page 「' + o.page + '」');
    if ($('siteNav')) return $('siteNav');            // 已经挂过了，别挂第二条

    var slot = o.el || $(o.mountId || 'siteNavMount');
    if (!slot || !slot.parentNode) return null;

    var box = d.createElement('div');
    box.innerHTML = html(o, pg);
    var header = box.firstChild;

    /* 挂载点里原有的节点＝这一页独有、且带大段文案的东西（市场页的 #walletPop、
       旧的 #btnTheme）。原样搬进 .topbtns —— 不复制、不重写、id 与监听全不动。 */
    var top = header.querySelector('.topbtns');
    while (slot.firstChild) top.appendChild(slot.firstChild);

    slot.parentNode.replaceChild(header, slot);

    /* 品牌名补正：mount 时 config.js 还没到（也没有 ARCBANG_SITE 那一行）的页面，
       等文档解析完再对一次 —— 那时 config.js 一定已经执行。写的是中文原文，
       随后叫 MirrorI18n.apply() 让英文态照常翻（新文本节点没被走过，apply 会补上）。 */
    if (d.readyState === 'loading') {
      d.addEventListener('DOMContentLoaded', function () {
        var bn = header.querySelector('.brand-n'), want = brandName();
        if (!bn) return;
        /* 英文态下 i18n 已把文本节点换成译文、原文记在 __zh 上：比的是原文，不是译文 */
        var tn = bn.firstChild, cur = (tn && tn.__zh != null) ? tn.__zh : bn.textContent;
        if (cur === want) return;
        bn.textContent = want;
        if (root.MirrorI18n && root.MirrorI18n.apply) root.MirrorI18n.apply();
      });
    }

    registerPop('settingsPop', 'btnSettings');
    if (o.wallet) registerPop('walletPop', 'btnConnect', false);   // click 归市场页自己
    wireGlobal();
    wireTheme();
    wireLang();

    /* 静态文字 MirrorI18n 自己翻过了；这里只把两组单选的高亮重新对一次 */
    d.addEventListener('mirror:lang', function () { syncLangSeg(); syncThemeSeg(); });

    return header;
  }

  root.MirrorNav = {
    mount: mount,
    /** 钱包 chip 的壳：页面接上自己的适配器（account/connect/disconnect/…），
        壳负责 chip 两种形态、浮层、复制反馈与浮层登记。见上面的说明。 */
    walletChip: walletChip,
    /** 页面把自己的浮层挂进来，就自动获得「点外部关 / Esc 关 / 与设置互斥」 */
    registerPop: registerPop,
    pop: {
      open: openPop, close: closeAll, closeAll: closeAll,
      toggle: togglePop, isOpen: isOpen, anyOpen: anyOpen
    },
    /** 主题变了叫我一声（市场页那颗旧的 #btnTheme 用它重写文字） */
    onTheme: function (fn) { if (typeof fn === 'function') themeSubs.push(fn); },
    syncTheme: syncThemeSeg,
    syncLang: syncLangSeg,
    /** 链身份：config.js 的 chain 块派生出来的 {id,name,nameEn,explorer,currency,isTestnet}。
        每次现算（nav.js 可能比 config.js 先加载），页面直接拿去用，别再抄一份兜底。 */
    chain: chainCfg,
    /** 链名，跟随当前语言。 */
    chainName: chainName,
    CSS: CSS
  };
})(typeof window !== 'undefined' ? window : this);
