/*
 * web/arc-ui.js —— ARCBANG 面板（只在站点版加载）
 * ------------------------------------------------------------
 * 起爆页上多一块：拿一个 BNB 区块哈希当奇点。
 *   取区块（最新 / 指定高度 / 随机 / 直接粘哈希）→ 免费引爆 → 喜欢再 mint
 * 引爆完全在本地算，不需要钱包、不需要连链；只有 mint 才走小狐狸。
 *
 * 首屏为什么长这样：
 * 原来 hero + 面板 + 20 参数表 + 我保存的宇宙 + 帮助折叠一起铺开，新手第一眼看到七八个入口，
 * 反而不知道先点哪个。现在首屏只留**一句话 + 一个大按钮**：
 *   · 取区块的四个入口（最新/随机/高度/粘哈希）收进「自己挑一个区块」折叠 —— 功能一个没删
 *   · 20 参数表默认收起（它是给想细看的人的，不是给第一次来的人的）
 *   · 「我保存的宇宙」「操作说明」「已引爆的宇宙」整体搬进「更多」折叠
 *   · 引爆之后才显示结局，而且**结局配一句人话**，再给一个「救救它」直通干预沙盒
 * 原则：新手模式是默认，老手一次点击就能展开全部；不为了简化删任何功能。
 *
 * 这一轮打磨又加/改了四件事（每件都对着一个具体的毛病）：
 *   · 「市场」入口：站点里原来一个 market.html 的链接都没有，用户只能手输网址
 *   · 「创世区块」：这条链的 0 号区块本身是个有故事的宇宙，值得给它一个按钮
 *   · 「不看就收下」：不引爆也能铸造 —— 结局照算（合约要），但一个字都不显示
 *   · 编号不再撞车：顶部 HUD 里的 #0001 是本机引爆流水号，链上是 tokenId，
 *     两个 # 摆一起没人分得清；这里把显示换成区块号，链上编号一律写「NFT #N」
 *   · WebGPU 开关抬到首屏：页脚设置里那个 #gpuChk 被折叠埋了两层，而且它旁边只写
 *     "需要浏览器支持"——本机实测是"支持 API、没有可用适配器"，用户看不出该去哪儿开。
 *     首屏这一行与 #gpuChk 双向同步，状态由 MirrorOnboard 真跑一次 requestAdapter() 给出
 *
 * 依赖：window.MirrorBnbApi（服务端算 card）、window.MirrorChain（链）、window.MirrorApp（主程序）
 * 注：爆炸的计算不在这里 —— 它在服务端。本文件只负责问、显示、发交易。
 *       window.MirrorOnboard（引导与人话表，缺席时退回符号与原文案，不炸）
 */
(function (root, doc) {
  'use strict';

  var API = root.MirrorBnbApi, C = root.MirrorChain;   // 推导已搬到服务端，浏览器不再持有 bnbhash
  var App = null;                                  // MirrorApp 在 app.js 末尾才挂上，用时再取
  var Engine = root.MirrorEngine;

  /* ============================================================ ARCBANG（specs/arcbang-v1.md）
     奇点来自 **Arc 链**的区块，取块走 MirrorChain（EVM）。
     合约是 ArcUniverse：**没有代币、没有每枚奖励**，所以一个字也不去问链上要（问了必 revert），
     铸造按钮与价格行只标价（见 paidMintLabel）。
     Arc 的 native 就是 USDC，chainCur() 从 config.chain.currency 现读，界面上自动是 USDC。 */

  // 结局顺序必须与合约 outcomeName() 一致
  var OUTCOME_ORDER = [
    'UNSTABLE_ORBITS', 'BIG_CRUNCH', 'BIG_RIP', 'HEAT_DEATH_NO_STRUCTURE',
    'BLACK_HOLE_DOMINATED', 'NO_ATOMS', 'NO_CHEMISTRY', 'NO_STARS',
    'STARS_NO_LIFE', 'OBSERVERS_POSSIBLE', 'NO_CARBON_CHEMISTRY', 'BEYOND_MODEL_DIM'
  ];
  var OUTCOME_CN = {
    UNSTABLE_ORBITS: '无稳定轨道／原子', BIG_CRUNCH: '大挤压', BIG_RIP: '大撕裂',
    HEAT_DEATH_NO_STRUCTURE: '热寂 · 无结构', BLACK_HOLE_DOMINATED: '黑洞主导',
    NO_ATOMS: '没有原子', NO_CHEMISTRY: '无化学', NO_STARS: '没有恒星',
    STARS_NO_LIFE: '有恒星无生命', OBSERVERS_POSSIBLE: '可能诞生观察者',
    NO_CARBON_CHEMISTRY: '无碳-水型化学', BEYOND_MODEL_DIM: '超出模型范围（D≠3）'
  };
  /* 创世区块（0 号）的实测哈希与日期 —— **只对 chainId 97 成立**，别的链上这两个数都不是它。
     哈希现在纯属参考：useGenesis() 一律走 blockHashOf(0)，取不到就拒绝（见那里的说明）。
     日期只出现在创世宇宙那一句话里，换了链就认不出来，那半句直接不说 ——
     主网的 0 号区块不是这一天，照抄等于在页面上撒谎。 */
  var GENESIS_REF = {
    chainId: 97,
    hash: '0x6d3c66c5357ec91d5c43af47e234a939b22557cbb552dc45bebbceeed90fbe34',
    date: '2020-04-20'
  };
  /** 这条链的创世日期；不是那条已知的链就返回空串（调用处据此少说半句）。 */
  function genesisDate() {
    return (C && C.CHAIN && C.CHAIN.id === GENESIS_REF.chainId) ? GENESIS_REF.date : '';
  }
  /* 链名与币符号只有一个来源：web/config.arc.js 的 chain 块，
     由 arc-chain.js 派生成 C.CHAIN / C.chainName()。这个文件里不许再写死任何一个。
     退路是防着页面装了旧版 arc-chain.js（缓存），不是给换链用的。 */
  function chainName() {
    if (C && C.chainName) return C.chainName();
    return (C && C.CHAIN && C.CHAIN.name) || '';
  }
  function chainCur() {
    return (C && C.CHAIN && C.CHAIN.currency && C.CHAIN.currency.symbol) || 'BNB';
  }
  /* 市场页是独立 HTML，和站点版同目录（web/build-web.js 把 market.html 一起拷进 dist）。
     所以用相对链接直接跳走，不要在单页里模拟路由。 */
  var MARKET_URL = 'market.html';
  /* 预热页（倒计时 / 规则 / 登记白名单）。放号还没轮到时，铸造面板给的就是这个出口。
     首页被切成任务页时（build-web 的 --landing=warmup）它俩是同一份内容，
     但 quest.html 永远在，所以链接一律指它。
     2026-09-18 改名：原来叫 warmup.html，旧路径有 302 兜着，但新链接直接写新名。 */
  var WARMUP_URL = 'quest.html';

  var S = { hash: null, blockNumber: null, derived: null, minted: null, busy: false, revealed: false };

  /* 人话表在 web/onboard.js（模块 D）。它可能没加载（并行开发 / 构建里被跳过），
     所以每次都现取，取不到就退回符号与原文案 —— 少一句人话，不能少一个功能。 */
  function OB() { return root.MirrorOnboard || null; }
  function plainName(key, fallback) {
    var o = OB();
    /* 人话表没收的参数（弦气三参数、引力耦合倍率…）落到 spec.name（engine/params.js 的中文）：
       这一份是显示出口，包一层 T() —— 词条在 i18n 分册；中文态与漏翻时原样返回。 */
    return (o && o.plain(key)) || T(fallback || key);
  }

  /* 界面文案走 i18n，命名空间 'app'（词条在 web/i18n-app.js，不归这个文件改）。
     T(zh)      —— 一句话；没译文就原样退回中文，界面上永远不会出现裸 key。
     TF(zh,a)   —— 带 {0} 占位符的句子。**整句进词典**，别在外面拼 T('宇宙 ') + n：
                   英文的语序不一定跟中文一样。用法与 web/market.html 的 TF 一致。
     i18n 没加载（并行开发 / 构建里被跳过）时两个都原样返回中文，页面照常能用。 */
  function T(s) { var I = root.MirrorI18n; return (I && I.t) ? I.t(s, 'app') : s; }
  function TF(zh, a) {
    var s = T(zh);
    return a === undefined ? s : s.split('{0}').join(String(a));
  }

  /* 宇宙的编号 = **区块号**，不是 tokenId —— 全站一个口径（web/market.html 的 uniNo()、
     NFT 元数据里的 name 都是这么写的）。tokenId 只是铸造顺序，参数、结局、稀有度
     全从那个区块的哈希派生，所以"哪个区块"才是这个宇宙是什么。区块号也唯一
     （tokenOfHash 不让同一个哈希被引爆两次）。

     两个坑：
       1. **0 是合法区块号**（创世块，链上实测 token #5 就是它）。所以判的是 `!= null`，
          不能写 `blockNumber ? … : fallback` —— 那会把创世宇宙显示成它的 tokenId。
       2. 读不到就退回调用方给的兜底（gallery 给 tokenId），**绝不编一个**。
          兜底也没有就返回空串，让调用方自己决定怎么写。 */
  function uniNo(blockNumber, fallback) {
    if (blockNumber != null && isFinite(blockNumber)) return '#' + blockNumber;
    return fallback != null ? '#' + fallback : '';
  }

  /* ============================================================ 广播与推广
     ref 的一生：广播链接带 ?ref=<广播者地址> → 落地页把它存进 localStorage
     （**首触优先**，30 天）→ 被邀请者第一次成功铸造时随 /api/bang 一起提交 →
     服务端只留痕。发钱是 owner 拿着留痕人工核对后用 BangPromo.grant 手动发。
     这里绝不出现具体承诺以外的话术 —— 口径见 specs 第一节。 */
  var REF_KEY = 'bnbbang.ref.v1';
  var REF_TTL = 30 * 24 * 3600 * 1000;              // 30 天
  var ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
  /* 签名即将绑 msg.sender：已连钱包时把当前地址小写带给 /api/bang；未连或非法则空串，调用处不加该字段。 */
  function minterOf(a) {
    var s = String(a || '').toLowerCase();
    return /^0x[0-9a-f]{40}$/.test(s) ? s : '';
  }
  /* 推广短码：8 位定长，字符集去掉 O/0/I/1。
     **两种 ?ref= 都要认** —— 老链接里是 0x 地址，新链接里是短码。
     已经发出去的链接不能因为这一版改造而失效，所以地址那条路一个字都不动，
     短码只是**多认一种**。 */
  var CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
  /** 服务端前缀。MirrorBnbApi 已经算过一次，缺席时按 config.js 自己算，别写死 */
  function apiBase() {
    var c = root.ARCBANG_CONFIG || {};
    if (API && API.base) return API.base;
    return (c.apiBase != null ? String(c.apiBase) : '/api').replace(/\/$/, '');
  }
  function refFresh() {
    try {
      var o = JSON.parse(root.localStorage.getItem(REF_KEY) || 'null');
      return !!(o && o.ref && Date.now() - (o.at || 0) < REF_TTL);
    } catch (e) { return false; }
  }
  function refPut(a) {
    if (!ADDR_RE.test(String(a || ''))) return;     // 非法就当没有，别把脏数据写进本机
    try {
      if (refFresh()) return;                       // 首触优先
      root.localStorage.setItem(REF_KEY, JSON.stringify({ ref: String(a).toLowerCase(), at: Date.now() }));
    } catch (e) { /* 隐私模式：存不了就算了，广播照常 */ }
  }
  /* 落地后立刻从地址栏摘掉 ?ref=。不摘的话，再点 GitHub / 区块浏览器 / 广播渠道，
     Referer 会把别人的推广码送到第三方。存进 localStorage 之后链接里那一截已经没用。 */
  function stripRefParam() {
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has('ref')) return;
      u.searchParams.delete('ref');
      var q = u.searchParams.toString();
      history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash);
    } catch (e) { /* 老浏览器没有 URL / history：不剥 */ }
  }
  function refCapture() {
    var v = null;
    try { v = new URLSearchParams(location.search).get('ref'); } catch (e) { return; }
    if (!v) return;
    stripRefParam();
    if (ADDR_RE.test(v)) { refPut(v); return; }     // 老形式：地址原样存，不用联网
    var code = String(v).toUpperCase();
    if (!CODE_RE.test(code) || refFresh()) return;
    /* 短码要问服务端换回地址。**留痕提交的一直是地址**（/api/bang 只认地址），
       所以换不到就什么都不存 —— 下次带着同一条链接进来会再试一次，
       比存一个服务端不认识的字符串强。整条路失败也只是这一次没留痕，
       页面照常用（这就是为什么它不 await、不报错）。 */
    try {
      fetch(apiBase() + '/refcode/resolve?code=' + encodeURIComponent(code))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.addr) refPut(j.addr); })
        .catch(function () { /* 网络不好：不留痕，广播照常 */ });
    } catch (e) { /* 老浏览器没有 fetch */ }
  }
  /* 我自己的短码（广播链接要用）。**拿不到就退回地址**：链接长一点，但一定能用。
     一次会话只问一次 —— 短码是幂等生成的，问十次也是同一个，
     但每次都问会把服务端那道「生成短码」的 IP 闸白白吃掉。 */
  var RC_KEY = 'bnbbang.refcode.v1';
  var rcCache = {};
  function myRefCode(addr) {
    var a = String(addr || '').toLowerCase();
    if (!ADDR_RE.test(a)) return Promise.resolve(null);
    if (rcCache[a]) return Promise.resolve(rcCache[a]);
    try {
      var o = JSON.parse(root.sessionStorage.getItem(RC_KEY) || 'null');
      if (o && o.addr === a && CODE_RE.test(o.code || '')) { rcCache[a] = o.code; return Promise.resolve(o.code); }
    } catch (e) { /* 隐私模式：不缓存，每次现问 */ }
    var p;
    try {
      p = fetch(apiBase() + '/refcode?addr=' + encodeURIComponent(a))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var c = (j && j.code) ? String(j.code).toUpperCase() : '';
          if (!CODE_RE.test(c)) return null;
          rcCache[a] = c;
          try { root.sessionStorage.setItem(RC_KEY, JSON.stringify({ addr: a, code: c })); } catch (e2) { /* ignore */ }
          return c;
        })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
    /* **不许把浮层挂在这条请求上**：服务端慢的时候广播按钮要能照常打开，
       超时就当没有短码，退回地址形式。 */
    return new Promise(function (done) {
      var fired = false;
      var t = setTimeout(function () { if (!fired) { fired = true; done(null); } }, 4000);
      p.then(function (v) { if (!fired) { fired = true; clearTimeout(t); done(v); } },
             function () { if (!fired) { fired = true; clearTimeout(t); done(null); } });
    });
  }
  function refStored() {
    try {
      var o = JSON.parse(root.localStorage.getItem(REF_KEY) || 'null');
      if (o && o.ref && /^0x[0-9a-f]{40}$/.test(o.ref) && Date.now() - (o.at || 0) < REF_TTL) return o.ref;
    } catch (e) { /* ignore */ }
    return null;
  }

  /** 多占位符版 TF（{0}{1}{2}…）。广播文案是长句，语序中英不同，必须整句进词典。 */
  function TX(zh) {
    var s = T(zh);
    for (var i = 1; i < arguments.length; i++) s = s.split('{' + (i - 1) + '}').join(String(arguments[i]));
    return s;
  }

  /* 站点根地址。`/s/<区块号>` 是**挂在站点根上**的一条服务端路由（分享落地页，
     带 og 标签、随后跳 app.html），所以这里要的是 origin，不是当前页面所在的目录。
     取不到就返回空串，调用方据此退回老的 app.html?bang=… 形式 ——
     那条路在任何部署下都成立（本地 file://、localhost 联调、塞在子目录里的站点）。 */
  function siteRoot() {
    var c = root.ARCBANG_CONFIG || {};
    if (c.siteBase) return String(c.siteBase).replace(/\/+$/, '');
    var o = String(location.origin || '');
    if (!/^https?:/.test(o)) return '';
    if (/localhost|127\.0\.0\.1|\[::1\]/.test(o)) return '';
    // 站点没挂在根上时 /s/ 不是它的路由，硬拼出来的链接会 404
    if (String(location.pathname).replace(/[^/]*$/, '') !== '/') return '';
    return o;
  }

  /** 分享链接。两头都砍：
        bang 用**区块号**代替 66 字符的哈希（拿不到区块号才退回哈希）；
        ref  用**8 位短码**代替 42 字符的地址（拿不到短码才退回地址）。
          https://arcbang.xyz/s/8642956?ref=K7M2X9QP     ≈ 42 字符（原来 ≈ 160）
      老形式的链接**仍然有效** —— 落地页 /s/ 两种 token 都认，?ref= 两种格式也都认，
      所以这里只管把新发出去的链接缩短，已经发出去的一条都不会失效。
      不用 URL()：这段要在老一点的 WebView 里也能跑，字符串拼起来就够了。 */
  /**
    * 分享链接。两条都是为了**短**（2026-09-19 用户：链接太长）：
    *   · 有区块号就一律用区块号（/s/119969013），只有沙盒宇宙那种确实没有号的才退回
    *     64 位哈希。服务端的 /s/ 两种都认。
    *   · ref 只放 6 位登记码。**没有码就不带 ref** —— 老的 ?ref=<42 位地址> 还读得进来
    *     （server 那边兼容），但不再生成：一个 42 位地址就把链接撑长了一倍。
    */
  function shareUrl(o, ref) {
    var no = o && o.no;
    var token = (no != null && isFinite(no)) ? String(no) : String((o && o.hash) || '');
    var site = siteRoot();
    /* v=<shareVer>：社交平台按 URL 缓存卡片，版本号一改就是新链接、新卡片（config.shareVer） */
    var ver = String((root.ARCBANG_CONFIG || {}).shareVer || '');
    var tail = (ref ? '&ref=' + encodeURIComponent(ref) : '') + (ver ? '&v=' + encodeURIComponent(ver) : '');
    if (site) return site + '/s/' + token + tail.replace(/^&/, '?');
    var base = String(location.href).split(/[?#]/)[0].replace(/[^/]*$/, '') + 'app.html';
    return base + '?bang=' + token + tail;
  }
  /** 老签名留着：BnbShare.url(hash, addr) 曾经就是这个形状，外面可能还有人拿着它 */
  function appShareUrl(hash, myAddr) { return shareUrl({ hash: hash }, myAddr); }

  /** 分享图（PNG）。**多数平台不认 SVG**（X 明确不支持，微信也不认），
      所以广播这条路一律走 /api/art/*.png。
      造物按 cardHash 索引 —— 干预之后参数变了，blockHash 已经不是它的身份。 */
  function shareImgUrl(o) {
    var H32 = /^0x[0-9a-fA-F]{64}$/;
    if (o && H32.test(String(o.cardHash || ''))) {
      return apiBase() + '/art/card/' + String(o.cardHash).toLowerCase() + '.png';
    }
    if (o && H32.test(String(o.hash || ''))) {
      return apiBase() + '/art/' + String(o.hash).toLowerCase() + '.png?p=1';
    }
    return '';
  }

  /* ============================================================ 游戏内截图（用户 2026-08-21「附带一张游戏内的截图」）
     广播附的图优先是**模拟器此刻的实况画面**，不只是 NFT 卡面。
     app 页有四层画布（#gl 粒子网 / #planet 星球 / #stage 2D / #gl3d 三维），
     凡是没藏起来的按 z 序（1/2/3/4）合成到一张离屏 2D 画布，再在底部烙一条窄字幕
     （区块号 · 结局 + 站点域名），toBlob 出 PNG。

     WebGL 的经典坑：#gl / #gl3d 都是 preserveDrawingBuffer:false 建的
     （ui/particles.js:371、ui/universe3d.js:1437，不归本文件改），合成器取走一帧后
     缓冲区就标记清空，之后随时 drawImage 得到的都是**全黑**。
     对策选的是**同帧抓取**，不开 preserveDrawingBuffer：
       · 主程序（ui/app.js 的 loop）和三维层（ui/universe3d.js 的 frame）都是每帧
         在自己的 rAF 回调末尾注册下一帧 —— 它们下一帧的回调永远比这里现注册的早。
         所以在打开浮层那一下 requestAnimationFrame 一次，回调必然排在两个渲染循环
         **之后、页面合成之前**执行：此刻缓冲区里正是刚画完的这一帧，drawImage 拿到的
         是完整画面。universe3d 自己也在 render 之后同帧回读做自动曝光（autoExpose），
         这条时序是它已经验证过的。
       · preserveDrawingBuffer:true 的代价是两块 WebGL 画布常驻多一份显存拷贝、
         每帧多一次 blit，所有人为广播这一下买单，不值；而且那两个文件不归这里改。

     抓完先做**黑帧检测**再烙字幕（隔 4 像素采样，最亮通道 ≤8 判黑 —— 字幕后烙，
     免得字幕条把黑帧"救活"）：页面藏着、rAF 停了、或用户还在起爆页（画布本来就空）
     都会得到黑帧，此时返回 null，调用方退回服务端卡面 PNG，再不行退纯文案 ——
     与现有降级链同构。市场页没有模拟器画布，不走这条路。 */
  var SHOT_IDS = ['gl', 'planet', 'stage', 'gl3d'];   // z 序 1/2/3/4，谁在上谁后画
  function shotCanvases() {
    var out = [], i, c;
    for (i = 0; i < SHOT_IDS.length; i++) {
      c = doc.getElementById(SHOT_IDS[i]);
      if (c && !c.hidden && c.width > 0 && c.height > 0) out.push(c);
    }
    return out;
  }
  /** 字幕条（烙进图里）：左「宇宙 #区块号 · 结局」右站点域名。编号一律区块号（uniNo 口径）。
      图永远是深底星空，颜色不走主题令牌 —— 令牌是给界面的，图发出去后主题管不着它。 */
  function drawShotCaption(g, w, h, o) {
    var no = uniNo(o && o.no, null) || (o && o.hash ? String(o.hash).slice(0, 10) : '?');
    var oc = (o && o.outcome) || (o && o.oid && T(OUTCOME_CN[o.oid] || o.oid)) || '?';
    var label = TX('宇宙 {0} · {1}', no, oc);
    var site = siteRoot().replace(/^https?:\/\//, '') || String(location.host || '') || 'ARCBANG';
    var bh = Math.max(24, Math.min(44, Math.round(h * 0.055)));
    var fs = Math.max(11, Math.round(bh * 0.46));
    var pad = Math.round(bh * 0.55), y = h - bh / 2 + 0.5;
    g.fillStyle = 'rgba(5,11,19,0.78)';                 // 半透深条，不盖画面主体
    g.fillRect(0, h - bh, w, bh);
    g.fillStyle = 'rgba(110,231,255,0.5)';              // 顶缘一线扫描光，科幻但克制
    g.fillRect(0, h - bh, w, 1);
    g.font = '600 ' + fs + 'px Consolas,Menlo,"Courier New",monospace';
    g.textBaseline = 'middle';
    var siteW = g.measureText(site).width;
    g.fillStyle = 'rgba(159,203,231,0.92)';
    g.fillText(site, w - pad - siteW, y);
    g.fillStyle = '#dff3ff';
    // maxWidth 兜底：结局名长（英文态更长）时压扁而不是压到域名身上
    g.fillText(label, pad, y, Math.max(40, w - pad * 3 - siteW));
  }
  /** 抓当前帧 → Promise<PNG Blob|null>。失败一律 resolve(null)（黑帧 / 无画布 /
      画布被污染 / toBlob 缺席 / rAF 不跑），由调用方走降级链，绝不 reject。 */
  function captureGameShot(o) {
    return new Promise(function (done) {
      var fired = false;
      function finish(b) { if (!fired) { fired = true; done(b || null); } }
      /* 页面藏着时 rAF 一帧都不跑（切后台、锁屏）：1.2 秒兜底判失败。
         BnbShare.noShot 是给回归测试掐这条路用的调试口（顺带也是紧急开关）。 */
      if ((root.BnbShare && root.BnbShare.noShot) || typeof root.requestAnimationFrame !== 'function') { finish(null); return; }
      var guard = setTimeout(function () { finish(null); }, 1200);
      root.requestAnimationFrame(function () {
        clearTimeout(guard);
        try {
          var list = shotCanvases();
          if (!list.length) { finish(null); return; }
          // 目标尺寸：按最大的那块画布算，宽压到 1280 以内（微信/X 上够清楚，PNG 不至于几 MB）
          var w0 = list[0].width, h0 = list[0].height, i;
          for (i = 1; i < list.length; i++) if (list[i].width > w0) { w0 = list[i].width; h0 = list[i].height; }
          var w = Math.min(1280, w0), h = Math.max(1, Math.round(h0 * w / w0));
          var cv = doc.createElement('canvas'); cv.width = w; cv.height = h;
          var g = cv.getContext('2d');
          g.fillStyle = '#000'; g.fillRect(0, 0, w, h);   // #app 的底就是纯黑，#stage 透明处露的是它
          for (i = 0; i < list.length; i++) g.drawImage(list[i], 0, 0, w, h);
          var data = g.getImageData(0, 0, w, h).data, max = 0, p;
          for (p = 0; p < data.length; p += 16) {         // RGBA×4 = 隔 4 像素采一个
            if (data[p] > max) max = data[p];
            if (data[p + 1] > max) max = data[p + 1];
            if (data[p + 2] > max) max = data[p + 2];
            if (max > 8) break;
          }
          if (max <= 8) { finish(null); return; }          // 全黑 = 抓失败
          drawShotCaption(g, w, h, o);
          if (!cv.toBlob) { finish(null); return; }
          cv.toBlob(function (b) { finish(b); }, 'image/png');
        } catch (e) { finish(null); }                      // 跨域素材污染画布等：当失败
      });
    });
  }

  /* 「复制文案和图片」。剪贴板能同时装文本和图片，
     复制完在微信里 Ctrl+V 就是连图带字一条消息 —— 这条比二维码实用。
     两条纪律：
       1. **必须降级**：Safari 和一部分浏览器没有 ClipboardItem、或者装不下 image/png，
          那就只复制文案，并且**明说图片没进去**，别让人以为图丢在哪儿了；
       2. PNG 第一次是现渲的（约 3 秒），按钮期间要说「正在准备图片…」，
          否则看起来就是卡死。
     ClipboardItem 收 Promise<Blob>：这是唯一能跨过"必须在用户手势里写剪贴板"
     那道闸的写法，所以图片的 fetch **直接当值传进去**，不要先等它再构造。
     imgSrc 收两种形状（游戏截图那一轮加的）：
       · 字符串 URL —— 老路，市场卡面 PNG 走它，fetch 当值传入；
       · 函数 () => Promise<Blob> —— app 页游戏截图走它：截图 blob 已经在浮层
         打开那一刻抓好了，函数在手势里现调、Promise 当值传入，闸门照样过。
     失败路径不变：函数抛错/拒绝 ⇒ nc.write 拒绝 ⇒ 退回只复制文案并明说。 */
  function copyTextAndImage(text, imgSrc) {
    var nav = root.navigator, nc = nav && nav.clipboard, CI = root.ClipboardItem;
    if (!nc) return Promise.reject(new Error('no-clipboard'));
    var textOnly = function () { return nc.writeText(text).then(function () { return { image: false }; }); };
    if (!CI || !nc.write || !imgSrc) return textOnly();
    var img = (typeof imgSrc === 'function'
      ? Promise.resolve().then(imgSrc).then(function (b) {
          if (!b) throw new Error('no-image');
          return b;
        })
      : fetch(imgSrc).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        })
    ).then(function (b) {
      // 类型对不上时 ClipboardItem 会直接拒收，所以重新贴一层 image/png
      return (b && b.type === 'image/png') ? b : new Blob([b], { type: 'image/png' });
    });
    var item;
    try {
      item = new CI({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'image/png': img });
    } catch (e) { return textOnly(); }
    return nc.write([item]).then(function () { return { image: true }; }, textOnly);
  }

  /* ============================================================ 二维码（纯前端，零外部请求）
，能给的只有二维码。
     **不许调第三方二维码 API** —— 那等于把用户的推广链接发到别人的服务器上，
     而且破了离线包「零外部请求」那条红线。所以这里自己编码。

     实现范围**刻意收窄**，只够装下一条分享链接：
       · 字节模式（UTF-8）；纠错级 M（约 15% 冗余）——
         微信扫码是隔着屏幕拍的，级别 L 太脆
       · 版本 1..10（最多 213 字节）：新的短链 ≈ 45 字符落在版本 3，
         老的长链接（哈希 + 地址 ≈ 160 字符）落在版本 9，都在范围内；
         再长就返回 null，调用方退回「只给链接文字」。
     算法照 ISO/IEC 18004：分块 RS 纠错 → 交织 → 锯齿排布 → 八种掩模取罚分最低。
     返回 { size, version, mask, rows }，rows[r][c] 为 1 表示黑。

     ⚠ web/market.html 里有**逐字相同的一份**。那一页是自带脚本的独立单文件
     （理由见它开头的说明），而 web/build-web.js 的文件清单是写死的，
     新开一个 另开一个 qr 模块 就得改构建 —— 所以两处各留一份，**改一处要连另一处一起改**。 */
  function qrEncode(text) {
    var i, j, k;
    /* ---- GF(256)，本原多项式 0x11d（QR 规定的那一个） ---- */
    var EXP = [], LOG = [], x = 1;
    for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

    /* 版本 1..10 在纠错级 M 下的分块表（ISO/IEC 18004 表 9）：
       [每块纠错码字, 组1块数, 组1数据码字, 组2块数, 组2数据码字] */
    var RS = [null,
      [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
      [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
      [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
    // 对齐图案的中心坐标（版本 1 没有）
    var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
      [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
    function dataCW(v) { var r = RS[v]; return r[1] * r[2] + r[3] * r[4]; }

    /* ---- UTF-8。链接是 ASCII，但万一有人拿它编中文也不该炸 ---- */
    var bytes = [];
    for (i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00); i++;
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }

    /* ---- 挑最小的装得下的版本。装不下就认输（返回 null），不硬塞 ---- */
    var ver = 0;
    for (i = 1; i <= 10; i++) {
      if (dataCW(i) * 8 - (4 + (i >= 10 ? 16 : 8)) >= bytes.length * 8) { ver = i; break; }
    }
    if (!ver) return null;

    /* ---- 位流：模式(0100) + 长度 + 数据 + 结束符 + 补齐 + 填充码字 ---- */
    var bits = [];
    function put(v, n) { for (var q = n - 1; q >= 0; q--) bits.push((v >>> q) & 1); }
    put(4, 4);
    put(bytes.length, ver >= 10 ? 16 : 8);
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
    var cap = dataCW(ver) * 8;
    for (i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var cw = [];
    for (i = 0; i < bits.length; i += 8) {
      var v8 = 0;
      for (j = 0; j < 8; j++) v8 = (v8 << 1) | bits[i + j];
      cw.push(v8);
    }
    var PAD = [0xec, 0x11], pi = 0;
    while (cw.length < dataCW(ver)) cw.push(PAD[pi++ & 1]);

    /* ---- Reed-Solomon：生成多项式与余式 ---- */
    function genPoly(n) {
      var g = [1];
      for (var a = 0; a < n; a++) {
        var ng = [];
        for (var b = 0; b <= g.length; b++) {
          ng[b] = (b < g.length ? g[b] : 0) ^ (b > 0 ? gmul(g[b - 1], EXP[a]) : 0);
        }
        g = ng;
      }
      return g;
    }
    function ecOf(block, n) {
      var g = genPoly(n), r = block.slice(), a, b;
      for (a = 0; a < n; a++) r.push(0);
      for (a = 0; a < block.length; a++) {
        var f = r[a];
        if (!f) continue;
        for (b = 1; b < g.length; b++) r[a + b] ^= gmul(g[b], f);
      }
      return r.slice(block.length);
    }

    /* ---- 分块 + 交织（数据按列取，纠错码字整段跟在后面） ---- */
    var R = RS[ver], ecN = R[0], blocks = [], ecs = [], p = 0, blk;
    for (i = 0; i < R[1]; i++) { blk = cw.slice(p, p + R[2]); p += R[2]; blocks.push(blk); ecs.push(ecOf(blk, ecN)); }
    for (i = 0; i < R[3]; i++) { blk = cw.slice(p, p + R[4]); p += R[4]; blocks.push(blk); ecs.push(ecOf(blk, ecN)); }
    var seq = [], maxD = Math.max(R[2], R[4]);
    for (i = 0; i < maxD; i++) for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) seq.push(blocks[j][i]);
    for (i = 0; i < ecN; i++) for (j = 0; j < ecs.length; j++) seq.push(ecs[j][i]);

    /* ---- 功能图案 ---- */
    var size = ver * 4 + 17;
    var m = [], fn = [];
    for (i = 0; i < size; i++) {
      m.push([]); fn.push([]);
      for (j = 0; j < size; j++) { m[i][j] = 0; fn[i][j] = 0; }
    }
    function setF(r, c, v) {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      m[r][c] = v ? 1 : 0; fn[r][c] = 1;
    }
    // 定位图案 7×7 + 一圈分隔用的浅色（所以从 -1 扫到 7）
    function finder(r0, c0) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        var d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        setF(r0 + dr, c0 + dc, inner && d !== 2 ? 1 : 0);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (i = 8; i < size - 8; i++) { setF(6, i, i % 2 === 0 ? 1 : 0); setF(i, 6, i % 2 === 0 ? 1 : 0); }
    var AP = ALIGN[ver];
    for (i = 0; i < AP.length; i++) for (j = 0; j < AP.length; j++) {
      // 三个角上被定位图案占了的不放；其余都要放，**哪怕压在定时图案上**
      if ((i === 0 && j === 0) || (i === 0 && j === AP.length - 1) || (i === AP.length - 1 && j === 0)) continue;
      for (var ar = -2; ar <= 2; ar++) for (var ac = -2; ac <= 2; ac++) {
        setF(AP[i] + ar, AP[j] + ac, Math.max(Math.abs(ar), Math.abs(ac)) === 1 ? 0 : 1);
      }
    }
    // 格式信息区先占位（掩模定了才写真值），外加那一枚永远是黑的模块
    for (i = 0; i <= 8; i++) if (i !== 6) { setF(8, i, 0); setF(i, 8, 0); }
    for (i = 0; i < 8; i++) { setF(8, size - 1 - i, 0); setF(size - 1 - i, 8, 0); }
    setF(size - 8, 8, 1);
    // 版本信息（版本 7 起才有），两处对称各一份
    if (ver >= 7) {
      var vr = ver;
      for (i = 0; i < 12; i++) vr = (vr << 1) ^ (((vr >>> 11) & 1) * 0x1f25);
      var vbits = (ver << 12) | (vr & 0xfff);
      for (i = 0; i < 18; i++) {
        var vb = (vbits >>> i) & 1, va = size - 11 + (i % 3), vc = Math.floor(i / 3);
        setF(vc, va, vb); setF(va, vc, vb);
      }
    }

    /* ---- 数据锯齿排布：右下角起，每次两列蛇形上下走，跳过第 6 列（定时图案）。
           数据位排完之后剩下的（余数位）保持浅色，规范就是这么定的。 ---- */
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var col = right - j, up = ((right + 1) & 2) === 0;
          var row = up ? size - 1 - vert : vert;
          if (fn[row][col] || bi >= seq.length * 8) continue;
          m[row][col] = (seq[bi >>> 3] >>> (7 - (bi & 7))) & 1;
          bi++;
        }
      }
    }

    /* ---- 格式信息（纠错级 M = 00 与掩模号，BCH(15,5) 后异或 0x5412） ---- */
    function writeFormat(g, msk) {
      var d = msk, rem = d;                       // 纠错级 M 的两位是 00，所以 d 就是掩模号
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
      var fb = ((d << 10) | (rem & 0x3ff)) ^ 0x5412;
      function bit(n) { return (fb >>> n) & 1; }
      for (var t = 0; t <= 5; t++) g[t][8] = bit(t);
      g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
      for (t = 9; t < 15; t++) g[8][14 - t] = bit(t);
      for (t = 0; t < 8; t++) g[8][size - 1 - t] = bit(t);
      for (t = 8; t < 15; t++) g[size - 15 + t][8] = bit(t);
      g[size - 8][8] = 1;
    }

    /* ---- 八种掩模各算一次罚分，取最低（ISO 表 11 的四条规则） ---- */
    function maskOn(msk, r, c) {
      switch (msk) {
        case 0: return (r + c) % 2 === 0;
        case 1: return r % 2 === 0;
        case 2: return c % 3 === 0;
        case 3: return (r + c) % 3 === 0;
        case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5: return (r * c) % 2 + (r * c) % 3 === 0;
        case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
        default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
      }
    }
    var P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function penalty(g) {
      var s = 0, r, c, run, dark = 0, a, b;
      // 规则 1：一行/一列里连着 5 个以上同色
      for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c < size; c++) {
          if (g[r][c] === g[r][c - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s += 1; }
          else run = 1;
        }
      }
      for (c = 0; c < size; c++) {
        run = 1;
        for (r = 1; r < size; r++) {
          if (g[r][c] === g[r - 1][c]) { run++; if (run === 5) s += 3; else if (run > 5) s += 1; }
          else run = 1;
        }
      }
      // 规则 2：2×2 同色
      for (r = 0; r + 1 < size; r++) for (c = 0; c + 1 < size; c++) {
        var v0 = g[r][c];
        if (v0 === g[r][c + 1] && v0 === g[r + 1][c] && v0 === g[r + 1][c + 1]) s += 3;
      }
      // 规则 3：1:1:3:1:1 那个像定位图案的序列（连同它一侧的四格浅色区）
      for (r = 0; r < size; r++) for (c = 0; c + 10 < size; c++) {
        a = true; b = true;
        for (k = 0; k < 11; k++) {
          if (g[r][c + k] !== P1[k]) a = false;
          if (g[r][c + k] !== P2[k]) b = false;
        }
        if (a) s += 40;
        if (b) s += 40;
      }
      for (c = 0; c < size; c++) for (r = 0; r + 10 < size; r++) {
        a = true; b = true;
        for (k = 0; k < 11; k++) {
          if (g[r + k][c] !== P1[k]) a = false;
          if (g[r + k][c] !== P2[k]) b = false;
        }
        if (a) s += 40;
        if (b) s += 40;
      }
      // 规则 4：黑模块占比偏离 50%，每偏 5% 加 10 分
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (g[r][c]) dark++;
      s += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return s;
    }
    var best = null, bestMask = 0;
    for (var msk = 0; msk < 8; msk++) {
      var g3 = [];
      for (i = 0; i < size; i++) {
        g3.push([]);
        for (j = 0; j < size; j++) g3[i][j] = (!fn[i][j] && maskOn(msk, i, j)) ? (m[i][j] ^ 1) : m[i][j];
      }
      // 罚分要在格式信息**已经写好**的图上算，否则算的不是解码器看到的那张
      writeFormat(g3, msk);
      var sc = penalty(g3);
      if (best === null || sc < best.s) { best = { s: sc, g: g3 }; bestMask = msk; }
    }
    return { size: size, version: ver, mask: bestMask, rows: best.g };
  }

  /** 把矩阵画成一张内联 SVG。**黑白写死**：二维码要的是高对比，
      跟着深色主题反过来的话不少相机就认不出来了 —— 全站少有的不走令牌的地方，
      理由就是它必须被摄像头认出来。四格静区（quiet zone）是规范要求的，不能省。
      画不出来（内容超过版本 10）返回 null，调用方退回「只给链接文字」。 */
  function qrSvg(text, px) {
    var q = qrEncode(String(text));
    if (!q) return null;
    var n = q.size, pad = 4, w = n + pad * 2, d = [], r, c;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) {
      if (q.rows[r][c]) d.push('M' + (c + pad) + ' ' + (r + pad) + 'h1v1h-1z');
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w + '"'
      + ' width="' + px + '" height="' + px + '" shape-rendering="crispEdges" aria-hidden="true">'
      + '<rect width="' + w + '" height="' + w + '" fill="#fff"/>'
      + '<path d="' + d.join('') + '" fill="#000"/></svg>';
  }

  /** 广播文案。o.kind = 'native' | 'craft'；link 传空串可得到「不带链接」的正文（Telegram 用）。 */
  function shareText(o, link) {
    if (o.kind === 'craft') {
      var outc = o.outcome || '?';
      /* 造物系列在 v1 不上（config.arc.js 的 crafted 是空的），这一支走不到；
         拯救系统也整套下线，所以这里没有「救活 / 销毁」文案 ——
         万一走到了，退回引爆那条通用文案。 */
      return shareText({ kind: 'native', outcome: outc, no: o.no, oid: o.oid, hash: o.hash || '' }, link);
    }
    // 结局既收现成的名字（o.outcome），也收引擎 id（o.oid，切语言时现翻）
    var oc = o.outcome || (o.oid && T(OUTCOME_CN[o.oid] || o.oid)) || '?';
    /* 主口号（2026-09-19 用户拍板）：「每个 Arc 区块哈希，都是一个宇宙」。
       供应量一律用那句标准话「1,387 枚，永不增发」，不再在分享文里铺价格细则 ——
       一条推里塞免费额度和单价，读的人一个都记不住。 */
    return TX('我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希，都是一个宇宙。1,387 枚，永不增发。@arcbang_xyz @arc {2}',
              uniNo(o.no, null) || o.hash.slice(0, 10), oc, link).replace(/\s+$/, '');
  }

  /* 广播浮层：复制文案和图片 / 微信二维码 / X / Telegram / 微博 / Facebook / Reddit / WhatsApp / 复制链接。
     社交链接全部是**用户点击**才跳的 <a target=_blank rel="noopener noreferrer">（普通新标签页，
     不用 window.open 弹小窗 —— 用户 2026-08-21：「X不要打开窗口 打开浏览器的X即可」），
     纯 intent URL、零 SDK；二维码是本地算的，页面自己只在「复制图片」那一下
     拉一次自家的 PNG —— 不碰离线包的零请求红线
     （何况这整个文件只进站点包，见 web/build-web.js）。
     ⚠ web/market.html 里有**同款一份**（那页是刻意的单文件），渠道、图标、样式
     改这里要连那边一起改 —— 先例见 qrEncode 的说明。 */
  /* 渠道图标：全部内联 SVG、currentColor 上色，零外部图标库。
     ⚠ 与 web/market.html 静态 HTML 里的那套图形同款，改一处连另一处一起改。 */
  var SICO = {
    sig: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="11" r="1.8" fill="currentColor"/><path d="M12 13.5V20M5.6 16.2a8.5 8.5 0 0 1 0-10.4M8.3 13.9a5 5 0 0 1 0-5.8M18.4 16.2a8.5 8.5 0 0 0 0-10.4M15.7 13.9a5 5 0 0 0 0-5.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12.5" height="12.5" rx="2"/><path d="M15.5 3.5H6A2.5 2.5 0 0 0 3.5 6v9.5"/><path d="m9 17.5 2.7-2.7 3.2 3.2 1.8-1.8 3.3 3.3"/></svg>',
    wx: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.5C6.1 4.5 3 7 3 10c0 1.7.9 3.2 2.4 4.2l-.6 2.3 2.5-1.3c.5.2 1.1.3 1.7.3"/><path d="M14.6 8.1c3.2 0 5.9 2.2 5.9 4.9 0 1.5-.8 2.9-2.1 3.8l.5 2-2.2-1.1c-.7.2-1.4.3-2.1.3-3.2 0-5.9-2.2-5.9-4.9s2.6-5 5.9-5z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M17.9 3H21l-6.8 7.8L22.2 21h-6.3l-4.9-6-5.6 6H2.3l7.3-8.3L1.8 3h6.4l4.4 5.5L17.9 3zm-1.1 16.1h1.7L7.3 4.8H5.5l11.3 14.3z"/></svg>',
    tg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M21.9 3.1 2.5 10.6c-.8.3-.8 1 .1 1.3l4.9 1.6 1.9 5.7c.3.8.9.9 1.4.3l2.6-2.8 4.9 3.6c.7.5 1.4.2 1.6-.7l3-15.3c.2-.9-.4-1.4-1-.9zM7.9 13.2l9.5-6c.5-.3.9 0 .5.4l-7.7 7-.3 3.3-2-4.7z"/></svg>',
    wb: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10.4 8.7c-4 .5-7.4 3.1-7.4 6 0 3 3.2 5 7.2 5s7.4-2.2 7.4-5.3c0-2.6-2.9-4.2-5.6-4"/><circle cx="10.2" cy="14.8" r="2.1"/><path d="M15.6 3.7a6.6 6.6 0 0 1 6 7.2M15.4 7a3.4 3.4 0 0 1 3.1 3.7"/></svg>',
    fb: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M14 8.6V7.1c0-.8.2-1.2 1.3-1.2H17V3h-2.6c-2.7 0-3.9 1.4-3.9 4v1.6H8.5V12h2v9H14v-9h2.5l.5-3.4H14z"/></svg>',
    rd: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21c-4.4 0-8-2.2-8-5 0-1.1.6-2.1 1.6-2.9a2 2 0 0 1 3-2.5A10 10 0 0 1 12 10c1.2 0 2.4.2 3.4.6a2 2 0 0 1 3 2.5c1 .8 1.6 1.8 1.6 2.9 0 2.8-3.6 5-8 5z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.5" cy="15.2" r="1.1" fill="currentColor"/><circle cx="14.5" cy="15.2" r="1.1" fill="currentColor"/><path d="M9.6 18.1c1.6 1 3.2 1 4.8 0M12 10l1-4.6 3.4 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="17.6" cy="6.1" r="1.2" fill="currentColor"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5A8.5 8.5 0 0 0 4.6 16.2L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.8 8.4c-.5 2.6 4.2 7.3 6.8 6.8l.9-1.6-2.1-1.3-.9.8c-1.1-.5-2.1-1.5-2.6-2.6l.8-.9-1.3-2.1-1.6.9z" fill="currentColor"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7"/></svg>'
  };
  var SHARE_POP = null;
  /* 代际令牌：openShare 是异步的（account() + myRefCode 最多 4 秒），飞行中用户
     可能已经点了 ×、或又点开了另一个宇宙的广播。只清 SHARE_POP 拦不住飞行中的
     那条链 —— 它回来照样 appendChild，屏幕上就叠出两层（后写的才被记住，
     先挂的那层永远关不掉）。每次打开占一个新代，append 前核对；关闭把代推进一格，
     所有在飞的打开链一并作废。 */
  var SHARE_GEN = 0;
  function closeShare() {
    SHARE_GEN++;                       // 就算浮层还没挂上，也要作废在飞的那条打开链
    var pop = SHARE_POP;
    if (!pop) return;
    SHARE_POP = null;
    closeShotBig();                                       // 大图还开着就一起收
    /* 截图预览的 objectURL 要亲手回收 —— 每开一次浮层抓一张新图，不收就攒一堆位图 */
    try { if (pop.__shotURL) { URL.revokeObjectURL(pop.__shotURL); pop.__shotURL = null; } } catch (e) { /* ignore */ }
    doc.removeEventListener('keydown', shareKey, true);
    /* 150ms 收场过渡；prefers-reduced-motion（或老浏览器没有 matchMedia）直切 */
    var still = true;
    try { still = !root.matchMedia || root.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { still = true; }
    if (still) { pop.remove(); return; }
    pop.classList.add('closing');
    setTimeout(function () { pop.remove(); }, 160);
  }
  function shareKey(ev) {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    if (SHOT_BIG) { closeShotBig(); return; }             // 大图开着：Esc 先收大图，浮层留着
    closeShare();
  }
  /* 预览图点开看大图：简易遮罩（app 页没有市场那个 #lbox 灯箱，自己铺一层）。
     点任意处 / Esc 关；压在浮层(10050)之上。 */
  var SHOT_BIG = null;
  function openShotBig(src, alt) {
    closeShotBig();
    if (!src) return;
    var d = doc.createElement('div');
    d.className = 'bshare-lbox';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', T('查看大图'));
    var im = doc.createElement('img');
    im.src = src; im.alt = alt || '';
    d.appendChild(im);
    d.addEventListener('click', closeShotBig);
    doc.body.appendChild(d);
    SHOT_BIG = d;
  }
  function closeShotBig() { if (SHOT_BIG) { SHOT_BIG.remove(); SHOT_BIG = null; } }
  function openShare(o) {
    if (!o) return;
    closeShare();
    var gen = SHARE_GEN;               // closeShare 刚把代推进了一格，这一代归本次打开
    /* 附图在浮层打开的**这一帧**就开抓（用户 2026-08-21「附带一张游戏内的截图」）：
       等短码那 4 秒回来再抓，用户可能已经切走画面；而且复制要走 ClipboardItem 的
       Promise 通道，图越早备好越稳。抓不到（黑帧/无画布）resolve null，
       下面按「截图 → 服务端卡面 PNG → 纯文案」的顺序降级。 */
    var shotP = captureGameShot(o);
    var acctP;
    try { acctP = (C && C.account) ? C.account() : Promise.resolve(null); }
    catch (e) { acctP = Promise.resolve(null); }
    acctP.then(null, function () { return null; }).then(function (acct) {
      var my = acct ? String(acct).toLowerCase() : null;
      /* 短码要问一次服务端。**问不到不拦浮层** —— myRefCode 自带 4 秒上限，
         到点就当没有，链接退回 ?ref=<地址>（长一点，但一样能用）。 */
      /* 拿不到码就**不带 ref**（而不是退回地址）：没登记的人本来也没有推广留痕可言，
         为此把链接撑长一倍不值。 */
      return myRefCode(my).then(function (code) { return { my: my, ref: code || null }; });
    }).then(function (who) {
      if (gen !== SHARE_GEN) return;   // 等短码的空当里浮层被关掉/换成别的宇宙了：这条链作废
      var my = who.my;
      /* 「引爆并分享」那一分就记在这里 —— **生成分享链接的这一刻**，
         而不是等用户真去 X 上发（那件事我们看不见，也不该假装看得见）。
         同地址同一天只计一次由服务端挡；没登记过就静默跳过，一次钱包都不弹。 */
      alShareTick(my, o.hash);
      var link = shareUrl(o, who.ref);
      var img = shareImgUrl(o);
      var full = shareText(o, link);
      var noLink = shareText(o, '');
      /* 渠道链接（全部纯 intent URL、零 SDK、点击前零对外请求；一律普通新标签页）：
           X        https://x.com/intent/tweet?text=<正文含链接>
                    （x.com 就是「浏览器的 X」——twitter.com 那个域只是多一跳重定向）
           Telegram https://t.me/share/url?url=&text=（正文不带链接，链接单独给）
           微博     https://service.weibo.com/share/share.php?url=&title=
           Facebook https://www.facebook.com/sharer/sharer.php?u=（它只收 u，正文靠 og 标签）
           Reddit   https://www.reddit.com/submit?url=&title=
           WhatsApp https://api.whatsapp.com/send?text=<正文含链接> */
      var xUrl = 'https://x.com/intent/tweet?text=' + encodeURIComponent(full);
      var tgUrl = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(noLink);
      var wbUrl = 'https://service.weibo.com/share/share.php?url=' + encodeURIComponent(link) + '&title=' + encodeURIComponent(noLink);
      var fbUrl = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(link);
      var rdUrl = 'https://www.reddit.com/submit?url=' + encodeURIComponent(link) + '&title=' + encodeURIComponent(noLink);
      var waUrl = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(full);
      var pop = doc.createElement('div');
      pop.className = 'bshare-pop';
      pop.innerHTML = '<div class="bshare-box" role="dialog" aria-label="' + esc(T('广播')) + '" tabindex="-1">'
        + '<div class="bshare-head">'
        + '<span class="bshare-sig" aria-hidden="true">' + SICO.sig + '</span>'
        + '<b>' + esc(T('广播')) + '</b>'
        + '<button type="button" class="bshare-x" aria-label="' + esc(T('关闭')) + '">×</button></div>'
        /* 附图预览（用户 2026-08-21）：广播前先看到发出去的是哪张图。
           app 页优先是游戏实况截图，抓不到退卡面 PNG；都没有整块藏起来，
           别摆一个空框。图能点开看大图（openShotBig）。 */
        + '<figure class="bshare-shot" id="bshareShot" hidden>'
        + '<img id="bshareShotImg" alt="' + esc(T('广播附图')) + '" title="' + esc(T('点开看大图')) + '">'
        + '<figcaption class="bshare-shot-tag" id="bshareShotTag"></figcaption>'
        + '</figure>'
        + '<p class="bshare-preview mono">' + esc(full) + '</p>'
        /* 主功能位：只有「复制文案和图片」一颗通栏大格。
           微信降级进下面的渠道网格（用户 2026-08-21「微信应该和别的在一起」），
           点击行为不变：点格子 → 展开二维码面板（§四）。 */
        + '<div class="bshare-feats">'
        + '<button type="button" class="bshare-feat primary" id="bshareCopy">' + SICO.copy + '<span>' + esc(T('复制文案和图片')) + '</span></button>'
        + '</div>'
        + '<p class="bshare-msg" id="bshareMsg" hidden></p>'
        /* 渠道网格：一格一个渠道（图标 + 名字）。专名（X/Telegram/Facebook/Reddit/WhatsApp）
           中英同形，不进词典；「微博」「复制链接」走 T()。
           微信排第一格：没有网页分享 API，点开是二维码面板（在网格下方展开）。 */
        + '<div class="bshare-grid">'
        + '<button type="button" class="bshare-tile" id="bshareWx" aria-expanded="false">' + SICO.wx + '<span>' + esc(T('微信')) + '</span></button>'
        + '<a class="bshare-tile" href="' + esc(xUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="' + esc(T('广播到 X')) + '">' + SICO.x + '<span>X</span></a>'
        + '<a class="bshare-tile" href="' + esc(tgUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + SICO.tg + '<span>Telegram</span></a>'
        + '<a class="bshare-tile" href="' + esc(wbUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + SICO.wb + '<span>' + esc(T('微博')) + '</span></a>'
        + '<a class="bshare-tile" href="' + esc(fbUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + SICO.fb + '<span>Facebook</span></a>'
        + '<a class="bshare-tile" href="' + esc(rdUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + SICO.rd + '<span>Reddit</span></a>'
        + '<a class="bshare-tile" href="' + esc(waUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + SICO.wa + '<span>WhatsApp</span></a>'
        + '<button type="button" class="bshare-tile" id="bshareLnk">' + SICO.link + '<span>' + esc(T('复制链接')) + '</span></button>'
        + '</div>'
        /* 微信二维码面板：默认收起，点上面网格里的微信格展开。
           二维码本地算（qrEncode），不调第三方接口。 */
        + '<div class="bshare-wx" id="bshareWxBox" hidden>'
        + '<div class="bshare-qr" id="bshareQr"></div>'
        + '<div class="bshare-qrnote">' + esc(T('长按识别 / 扫码打开')) + '</div>'
        + '<div class="bshare-qrlink mono">' + esc(link) + '</div>'
        + '</div>'
        + '<div class="bshare-note">'
        /* ARCBANG 没有代币，也就没有铸造奖励与邀请返利这回事（specs/arcbang-v1.md）。 */
        + esc(T('链接里就是这一枚宇宙：谁点开都能看到同一套物理常数。ARCBANG 没有代币、没有铸造奖励、没有邀请返利 —— 引爆永远免费，想留住它才铸成 NFT。'))
        + '</div></div>';
      doc.body.appendChild(pop);
      SHARE_POP = pop;
      pop.addEventListener('click', function (ev) { if (ev.target === pop) closeShare(); });
      pop.querySelector('.bshare-x').addEventListener('click', closeShare);
      doc.addEventListener('keydown', shareKey, true);
      /* ---- 附图预览回填。截图是异步抓的（等一帧 rAF），回来时浮层可能已经
         关了、甚至换成另一个宇宙的 —— 认 SHARE_POP === pop 才动 DOM。 */
      var shotBox = pop.querySelector('#bshareShot'), shotImg = pop.querySelector('#bshareShotImg'),
          shotTag = pop.querySelector('#bshareShotTag');
      shotImg.addEventListener('error', function () { shotBox.hidden = true; });   // 卡面 404（还没铸）→ 整块收起
      shotImg.addEventListener('click', function () { openShotBig(shotImg.getAttribute('src'), shotImg.alt); });
      shotP.then(function (b) {
        if (SHARE_POP !== pop) return;
        if (b) {
          var u = null;
          try { u = URL.createObjectURL(b); } catch (e) { u = null; }
          if (u) {
            pop.__shotURL = u;                            // closeShare 里回收
            shotImg.src = u;
            shotTag.textContent = T('实况截图');
            shotBox.hidden = false;
            return;
          }
        }
        if (img) {                                        // 降级：服务端卡面 PNG（已铸的才有，404 走上面的 onerror）
          shotImg.src = img;
          shotTag.textContent = T('卡面图');
          shotBox.hidden = false;
        }                                                 // 再没有：整块不出现，浮层照常
      });
      /* ---- 「复制文案和图片」的图源：截图优先，退卡面 PNG，都没有就让 write 拒绝
         → 走既有的「只复制文案并明说」降级（copyTextAndImage 的注释）。
         传函数不传值：函数在用户手势里现调，Promise 当值进 ClipboardItem，闸门照过。 */
      function copyImgSrc() {
        return shotP.then(function (b) {
          if (b) return b;
          if (!img) throw new Error('no-image');
          return fetch(img).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
          });
        });
      }
      var msg = pop.querySelector('#bshareMsg');
      function say(text, cls) {
        msg.hidden = !text;
        msg.className = 'bshare-msg' + (cls ? ' ' + cls : '');
        msg.textContent = text || '';
      }
      /* 按钮里现在带图标 SVG，文字都写在 <span> 里 —— 改字只动 span，别用
         textContent 把图标一起抹掉。 */
      var cp = pop.querySelector('#bshareCopy'), cpSpan = cp.querySelector('span');
      cp.addEventListener('click', function () {
        if (cp.disabled) return;
        /* PNG 第一次是服务端现渲的（约 3 秒），不说一声的话按钮看起来就是卡死了
           （截图那条路是本地现成的 blob，几乎瞬间，这句话一闪而过） */
        cp.disabled = true;
        cpSpan.textContent = img ? T('正在准备图片…') : T('复制中…');
        say('');
        copyTextAndImage(full, copyImgSrc).then(function (r) {
          cp.disabled = false;
          cpSpan.textContent = T('已复制 ✓');
          say(r.image ? '' : T('图片没能复制（这个浏览器不支持），文案已经进剪贴板了 —— 图片可以在卡片上右键另存。'), 'warn');
        }, function () {
          cp.disabled = false;
          /* 剪贴板被浏览器整个拦下时给一条能自己走下去的退路：
             正文就摆在上面的预览里，手动选中就能复制 */
          cpSpan.textContent = T('复制不了 —— 手动选中上面的文案');
          say('');
        });
      });
      /* 复制链接：只复制链接本身（发群、发评论区用）。失败走同一条退路提示 ——
         链接就在二维码块和预览文案里，手动选中也能复制。 */
      var lk = pop.querySelector('#bshareLnk'), lkSpan = lk.querySelector('span');
      lk.addEventListener('click', function () {
        var nc = root.navigator && root.navigator.clipboard;
        function okd() {
          lk.classList.add('ok');
          lkSpan.textContent = T('已复制 ✓');
          clearTimeout(lk.__t);
          lk.__t = setTimeout(function () { lk.classList.remove('ok'); lkSpan.textContent = T('复制链接'); }, 1500);
        }
        function bad() { say(T('复制不了 —— 手动选中上面的文案'), 'warn'); }
        if (nc && nc.writeText) nc.writeText(link).then(okd, bad); else bad();
      });
      /* 微信：二维码是**本地算出来的**（qrEncode），不调任何第三方二维码接口 ——
         那等于把用户的推广链接发到别人的服务器上。算不出来（内容太长）就只留链接文字。 */
      var wxBtn = pop.querySelector('#bshareWx'), wxBox = pop.querySelector('#bshareWxBox');
      wxBtn.addEventListener('click', function () {
        var show = wxBox.hidden;
        wxBox.hidden = !show;
        wxBtn.classList.toggle('on', show);
        wxBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
        if (!show) return;
        var slot = pop.querySelector('#bshareQr');
        if (slot.getAttribute('data-done')) return;
        var svg = qrSvg(link, 168);
        slot.innerHTML = svg || '';
        if (!svg) slot.textContent = T('链接过长，无法生成二维码，请直接复制下方链接。');
        slot.setAttribute('data-done', '1');
      });
      /* 键盘可达：焦点先落在对话框上（tabindex=-1），Esc 关、Tab 顺着往下走 */
      try { pop.querySelector('.bshare-box').focus({ preventScroll: true }); }
      catch (e) { try { pop.querySelector('.bshare-box').focus(); } catch (e2) { /* 老浏览器：不聚焦也能用 */ } }
    });
  }
  /* 「广播这枚」按钮走事件委托：铸造成功的提示是 innerHTML 重写出来的，
     直接绑监听器会随下一次重写一起没掉。payload 存在 SHARED 里按哈希查。 */
  var SHARED = {};
  function wireShare() {
    doc.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-bnbshare]') : null;
      if (!b) return;
      var h = b.getAttribute('data-bnbshare');
      openShare(SHARED[h] || { kind: 'native', hash: h });
    });
  }
  // 干预沙盒（web/intervene.js）铸成造物后也要广播，把入口交出去。
  // capture 是给回归测试直接验截图管线用的（tools 下的 headless 脚本）；
  // noShot=true 可掐掉截图这条路（预览与复制都会按降级链退回卡面 PNG / 纯文案）。
  root.BnbShare = { open: openShare, url: appShareUrl, capture: captureGameShot, noShot: false };

  /* ============================================================ 样式 */
  var CSS = [
    /* ============================================================ 外观 v2
       层次改成「白卡片浮在浅灰底上」：--panel 白面 + 极淡的 --line 一线 + --shadow-card 柔和阴影，
       不再靠重描边分块。颜色一处都不写死 —— 这块面板深浅两套主题都要能看，
       写死 hex 必然有一套是瞎的。裸色值只许出现在**永远深底**的两处例外里：
       #bnbMintHud 那张卡，和确认屏的太空时刻（见各自的注释）。
       --radius-* / --shadow-* 是 v2 新加的令牌，值由 index.html 的令牌表给；这里每处带一个
       兜底值，万一令牌表还没到位也只是圆角小一点，不会塌成完全没样式。 */
    '#bnbPanel{margin:18px 0 4px;background:var(--panel);border:1px solid var(--line);',
    '  border-radius:var(--radius-card,14px);box-shadow:var(--shadow-card,0 1px 2px var(--shadow));overflow:hidden;'
      /* .select-wrap 是纵向 flex：不写 flex:0 0 auto 的话，展开参数表会被 flex-shrink 压扁，
         再叠上 overflow:hidden 就直接裁掉——看起来就像"打不开" */
      + 'flex:0 0 auto}',
    /* 头一行加了「市场」之后，375 宽会被挤出横向溢出，所以允许换行。
       v2：头部不再涂 --panel2 —— 卡片整张是白的，头身之间只留一条 --line-soft */
    '#bnbPanel .bnb-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;',
    '  padding:16px 20px 13px;border-bottom:1px solid var(--line-soft)}',
    '#bnbPanel .bnb-title{font-weight:700;letter-spacing:.4px;font-size:15px;color:var(--ink)}',
    '#bnbPanel .bnb-sub{color:var(--dim);font-size:12px}',
    /* 市场入口：站点里原来一个链接都没有，只能手输网址。放在头部右侧，
       视觉上是徽标不是按钮（§3.7 的形状）——别去抢「给我一个宇宙」那个大按钮的注意力。 */
    '#bnbPanel .bnb-mk{font-size:11px;font-weight:600;padding:3px 10px;border-radius:var(--radius-chip,999px);',
    '  background:var(--cyan-bg);border:1px solid var(--cyan-line);color:var(--cyan);',
    '  text-decoration:none;white-space:nowrap;transition:background .15s,border-color .15s}',
    '#bnbPanel .bnb-mk:hover{background:var(--sel2);border-color:var(--cyan);color:var(--sel2-ink)}',
    '#bnbPanel .bnb-mk:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    '#bnbPanel .bnb-body{padding:18px 20px 20px}',
    '#bnbPanel .bnb-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
    /* 输入框：次级面做底（和 §3.6 的表头同一套），聚焦时才把强调色借给它 */
    '#bnbPanel input[type=text]{flex:1;min-width:220px;height:36px;padding:0 12px;box-sizing:border-box;',
    '  border:1px solid var(--line);border-radius:var(--radius-btn,10px);background:var(--panel2);',
    '  color:var(--ink);font-family:var(--mono);font-size:12px;transition:border-color .15s,background .15s}',
    '#bnbPanel input[type=text]:focus{background:var(--panel);border-color:var(--cyan);',
    '  outline:2px solid var(--focus);outline-offset:2px}',
    /* ---------- 按钮（§3.2）
       默认 = 次按钮：白底 + --line2 描边 + --ink2 字。主/危险/大按钮各自实底。
       高度统一 36（小号 30），inline-flex 居中 —— 原来靠 padding 撑高，一行里几个按钮
       文字长短不同就参差不齐。 */
    '#bnbPanel .bnb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;',
    '  height:36px;padding:0 14px;border:1px solid var(--line2);border-radius:var(--radius-btn,10px);',
    '  background:var(--panel);color:var(--ink2);cursor:pointer;font-size:13px;font-weight:600;',
    '  font-family:inherit;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}',
    '#bnbPanel .bnb-btn:hover:not(:disabled){background:var(--panel2)}',
    '#bnbPanel .bnb-btn:disabled{opacity:.45;cursor:default}',
    /* 键盘焦点必须看得见：这几个按钮一半藏在折叠里，用键盘的人比用鼠标的人更需要这圈 */
    '#bnbPanel .bnb-btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    /* 主按钮：实底强调色。字色用 --void 而不是写死 #fff ——
       浅色主题 --void 是近白（就是规格里那个白字），深色主题 --cyan 翻成亮紫，
       这时白字几乎糊掉，而 --void 正好反过来变成深字，两套主题都是高对比。 */
    '#bnbPanel .bnb-btn.primary{background:var(--cyan);border-color:var(--cyan);color:var(--on-cyan)}',
    '#bnbPanel .bnb-btn.primary:hover:not(:disabled){background:var(--cyan);filter:brightness(1.08)}',
    /* 引爆是这一页唯一的破坏性动作，留给红色。字色和主按钮一样走 --void，不用 --on-red：
       --on-red 两套主题都是白，而深色主题的 --red 是浅珊瑚（#FF7A6E），白字压上去实测
       只有 2.5:1，按钮上的字基本糊住；--void 在浅色主题是近白、深色主题是近黑，
       两边分别是 5.9:1 和 8.4:1。 */
    '#bnbPanel .bnb-btn.fire{background:var(--red);border-color:var(--red);color:var(--on-cyan);padding:0 22px}',
    '#bnbPanel .bnb-btn.fire:hover:not(:disabled){background:var(--red);filter:brightness(1.06)}',
    /* 首屏那一个大按钮：它得比页面上任何东西都显眼，新手才不用挑。
       比标准 36 高一号是有意的 —— 首屏只有它一个主动作。 */
    '#bnbPanel .bnb-start{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:6px}',
    '#bnbPanel .bnb-btn.give{background:var(--cyan);border-color:var(--cyan);color:var(--on-cyan);',
    '  height:44px;font-size:16px;font-weight:700;padding:0 26px;letter-spacing:.04em;',
    '  box-shadow:var(--shadow-card,0 1px 2px var(--shadow))}',
    '#bnbPanel .bnb-btn.give:hover:not(:disabled){background:var(--cyan);filter:brightness(1.08)}',
    /* 「救救它」14px/700 不是随手放大：--green 是中亮度的，浅色主题下 --void 压上去只有
       3.77:1，13px 常规字达不到 AA 的 4.5；14px 粗字走的是大字号那条线（3.0），这才够。
       绿色系里换不出更深的底 —— --green 是令牌表定的，不归这个文件改。 */
    '#bnbPanel .bnb-btn.save{background:var(--green);border-color:var(--green);color:var(--on-cyan);',
    '  font-size:14px;font-weight:700}',
    '#bnbPanel .bnb-btn.save:hover:not(:disabled){background:var(--green);filter:brightness(1.06)}',
    /* 幽灵按钮（怎么玩 / 怎么开）：透明底、无边、灰字，hover 才浮出 --panel2。
       它们是"顺手能看见"，不该跟主动作抢。 */
    '#bnbPanel .bnb-btn.bnb-how,#bnbPanel .bnb-btn.gpu-help{height:30px;padding:0 12px;font-size:12px;',
    '  background:transparent;border-color:transparent;color:var(--dim);border-radius:var(--radius-chip,999px)}',
    '#bnbPanel .bnb-btn.bnb-how:hover:not(:disabled),#bnbPanel .bnb-btn.gpu-help:hover:not(:disabled)',
    '  {background:var(--panel2);color:var(--ink2)}',
    '#bnbPanel .bnb-how{margin-left:auto}',
    /* 窄屏取消这个 auto：右上角有个 fixed 的钱包芯片，把「怎么玩」推到最右边正好被它盖住
       （实测 375 下页面往下一滚就看不见了）。改成整行靠左排，谁也不压谁。 */
    '@media (max-width:520px){#bnbPanel .bnb-how{margin-left:0}}',
    /* WebGPU 那一行：紧跟在大按钮下面，是首屏唯一一条设置。刻意做得比按钮弱一号
       （12px、灰字、幽灵按钮），它是"顺手能看见"，不是"要你先决定"。 */
    '#bnbPanel .bnb-gpu{display:flex;flex-wrap:wrap;align-items:center;gap:7px 10px;margin:11px 0 2px;font-size:12px}',
    /* .bnb-gpu 的 display:flex 会盖掉 UA 的 [hidden]{display:none}，得自己补一条 */
    '#bnbPanel .bnb-gpu[hidden]{display:none}',
    '#bnbPanel .gpu-sw{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--ink2);white-space:nowrap}',
    '#bnbPanel .gpu-sw input{margin:0;cursor:pointer;accent-color:var(--cyan)}',
    /* 开关被主程序锁住时（浏览器没有 navigator.gpu，或地址栏指定了 ?mode=）：灰掉，但别藏 */
    '#bnbPanel .gpu-sw.off,#bnbPanel .gpu-sw.off input{cursor:default}',
    '#bnbPanel .gpu-sw.off{opacity:.62}',
    /* flex:1 1 190px + min-width:0：状态句在 375 上要能自己换行，不能把整行顶出横向滚动 */
    '#bnbPanel .gpu-st{flex:1 1 190px;min-width:0;color:var(--dim);line-height:1.65;overflow-wrap:anywhere}',
    '#bnbPanel .gpu-st.ok{color:var(--green)}',
    '#bnbPanel .gpu-st.warn{color:var(--amber)}',
    '#bnbPanel .gpu-st.bad{color:var(--bad)}',
    '#bnbPanel .bnb-card{margin-top:12px;padding-top:14px;border-top:1px solid var(--line-soft)}',
    '#bnbPanel .bnb-card[hidden]{display:none}',
    /* 折叠区（自己挑区块 / 更多）：视觉上要明显弱于那个大按钮。
       白卡片里再套一张白卡片会糊成一片，所以内层改用次级面 --panel2、不给阴影。 */
    '#bnbPanel details.bnb-fold{margin-top:12px;border:1px solid var(--line);',
    '  border-radius:var(--radius-btn,10px);background:var(--panel2)}',
    '#bnbPanel details.bnb-fold>summary{cursor:pointer;padding:9px 13px;font-size:12.5px;color:var(--dim);user-select:none}',
    '#bnbPanel details.bnb-fold>summary:hover{color:var(--ink3)}',
    '#bnbPanel details.bnb-fold>summary:focus-visible{outline:2px solid var(--focus);outline-offset:-2px;border-radius:var(--radius-btn,10px)}',
    '#bnbPanel details.bnb-fold>summary::marker{color:var(--dim2)}',
    '#bnbPanel details.bnb-fold .fold-in{padding:2px 13px 12px}',
    /* 「更多」是面板外的第二张卡片，所以按 §3.1 给全套白卡片待遇 */
    '#bnbMore{margin-top:10px;border:1px solid var(--line);border-radius:var(--radius-card,14px);',
    '  background:var(--panel);box-shadow:var(--shadow-card,0 1px 2px var(--shadow))}',
    '#bnbMore>summary{cursor:pointer;padding:13px 18px;font-size:12.5px;color:var(--dim);user-select:none}',
    '#bnbMore>summary:hover{color:var(--ink3)}',
    '#bnbMore>summary:focus-visible{outline:2px solid var(--focus);outline-offset:-2px;border-radius:var(--radius-card,14px)}',
    '#bnbMore>summary::marker{color:var(--dim2)}',
    '#bnbMore .more-in{padding:4px 18px 16px;display:flex;flex-direction:column;gap:12px}',
    '#bnbPanel .bnb-hash{font-family:var(--mono);font-size:12px;word-break:break-all;color:var(--ink2)}',
    /* 编号是这张卡片的标题（身份），哈希是它的凭据（细节）——所以编号走正文字号的
       无衬线粗字、单独一行，哈希退成灰色小字。两者字号一样大的话，长得更"技术"的
       那串反而更抢眼，而它恰恰是最不需要被读的。 */
    '#bnbPanel .bnb-hash .bh-no{display:block;font-family:var(--sans);font-size:14px;',
    '  font-weight:700;color:var(--ink);margin-bottom:3px;word-break:normal}',
    '#bnbPanel .bnb-hash .bh-h{color:var(--dim2);font-size:11.5px}',
    '#bnbPanel .bnb-facts{display:flex;flex-wrap:wrap;gap:12px 14px;margin:10px 0;font-size:13px;align-items:center}',
    '#bnbPanel .bnb-note{color:var(--dim);font-size:12px;line-height:1.6}',
    '#bnbPanel .bnb-warn{color:var(--amber)}',
    '#bnbPanel .bnb-err{color:var(--bad)}',
    '#bnbPanel .bnb-ok{color:var(--green)}',
    '#bnbPanel .bnb-mint{margin-top:14px;padding-top:14px;border-top:1px solid var(--line-soft)}',
    /* ---------- 画廊：一行一张小卡片。它被搬进「更多」折叠里（不在 #bnbPanel 内了），
       选择器不能再挂 #bnbPanel。
       .bnb-gal 本身一定不能设 display —— 列表为空时 loadGallery() 会 gal.hidden=true，
       写了 display 就把 [hidden] 盖掉，等于永远藏不住。所以卡片间距走 margin，不走 gap。 */
    '.bnb-gal{font-size:12px}',
    '.bnb-gal-item{display:flex;gap:10px;align-items:center;padding:10px 12px;font-size:12px;',
    '  font-family:var(--mono);cursor:pointer;background:var(--panel);border:1px solid var(--line);',
    '  border-radius:var(--radius-card,14px);box-shadow:var(--shadow-card,0 1px 2px var(--shadow));',
    '  transition:transform .15s,box-shadow .15s,border-color .15s}',
    '.bnb-gal-item+.bnb-gal-item{margin-top:8px}',
    '.bnb-gal-item:hover{transform:translateY(-2px);border-color:var(--line2);',
    '  box-shadow:var(--shadow-pop,0 8px 32px var(--shadow))}',
    '.bnb-gal .bnb-note{color:var(--dim);font-size:12px;line-height:1.6}',
    '.bnb-gal-item .gal-id{flex:0 0 auto;font-size:11px;font-weight:600;padding:3px 10px;',
    '  border-radius:var(--radius-chip,999px);background:var(--sel2);color:var(--sel2-ink)}',
    '.bnb-gal-item .gal-h{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dim2)}',
    '.bnb-gal-item .gal-o{flex:0 0 auto;text-align:right;color:var(--ink2)}',
    '.bnb-gal-item .gal-o.unknown{color:var(--dim2)}',
    /* 窄屏让这一行折行。编号从「NFT #7」换成「宇宙 #108805826」之后，行里三段
       （编号 + 哈希 + D·结局）在 375 上实测要 274px，而卡片内宽只有 265 —— 差 9px，
       再遇上「超出模型范围（D≠3）」这种长结局只会更挤。
       折行而不是隐藏：三段一个都没少，只是结局换到第二行；顺带把这一行的点击目标
       从 45px 撑到 ~68px，手机上更好按。 */
    '@media (max-width:520px){',
    '  .bnb-gal-item{flex-wrap:wrap}',
    '  .bnb-gal-item .gal-o{flex:1 1 100%;text-align:left}}',
    '#bnbPanel a{color:var(--cyan)}',
    /* 创世参数表（§3.6：表头次级面、行间极淡、最后一行不留边、数字列 tabular-nums） */
    '#bnbParams{margin:10px 0 2px;border:1px solid var(--line);border-radius:var(--radius-btn,10px);background:var(--panel2)}',
    '#bnbParams>summary{cursor:pointer;padding:9px 13px;font-size:13px;color:var(--ink2);user-select:none}',
    '#bnbParams>summary:focus-visible{outline:2px solid var(--focus);outline-offset:-2px;border-radius:var(--radius-btn,10px)}',
    '#bnbParams>summary::marker{color:var(--dim2)}',
    '#bnbParams .pin{padding:4px 13px 12px;max-height:min(52vh,430px);overflow:auto}',
    '#bnbParams table{width:100%;border-collapse:collapse;font-size:12px;font-family:var(--mono)}',
    '#bnbParams td{padding:5px 6px;border-bottom:1px solid var(--line-soft);white-space:nowrap}',
    '#bnbParams tr:last-child td{border-bottom:0}',
    /* 人话在前、符号退到第二列 */
    '#bnbParams td.plain{color:var(--ink);white-space:normal;font-family:var(--sans);font-size:12px}',
    '#bnbParams td.sym{color:var(--dim2);width:1%}',
    '#bnbParams td.nm{color:var(--dim);white-space:normal}',
    '#bnbParams td.val{text-align:right;color:var(--ink);font-variant-numeric:tabular-nums}',
    '#bnbParams td.ours{text-align:right;color:var(--dim2);font-variant-numeric:tabular-nums}',
    '#bnbParams td.dev{text-align:right;width:1%;font-variant-numeric:tabular-nums}',
    '#bnbParams tr.moved td.val{color:var(--diff);font-weight:700}',
    '#bnbParams tr.moved td.dev{color:var(--diff)}',
    '#bnbParams .phead td{color:var(--dim);border-bottom:1px solid var(--line);font-weight:600;',
    '  font-size:11px;letter-spacing:.04em;font-family:var(--sans)}',
    '#bnbTop{margin:8px 0 0;font-size:12px;color:var(--dim);line-height:1.7}',
    '#bnbTop b{color:var(--diff)}',
    /* ---------- 右上角钱包条：**只是无顶栏时的退路**（离线单文件不挂 nav 那条线）。
       有顶栏时钱包走 nav.js 的 walletChip（市场页同款 chip + 浮层），
       这块浮空条根本不会被创建 —— 原来那条「进顶栏」的 #siteNav #bnbWallet
       变体样式已随之删掉。 */
    '#bnbWallet{position:fixed;top:12px;right:14px;z-index:60;display:flex;gap:8px;align-items:center;' +
      'padding:6px 8px 6px 12px;border:1px solid var(--line);border-radius:var(--radius-chip,999px);' +
      'background:var(--panel-a);box-shadow:var(--shadow-card,0 2px 10px var(--shadow2));font-size:12px}',
    '#bnbWallet[hidden]{display:none}',
    '#bnbWallet .w-btn{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 14px;' +
      'border:1px solid var(--cyan);border-radius:var(--radius-chip,999px);background:var(--cyan);' +
      'color:var(--on-cyan);cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:filter .15s}',
    '#bnbWallet .w-btn:hover{filter:brightness(1.08)}',
    '#bnbWallet .w-btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    '#bnbWallet .w-addr{font-family:var(--mono);color:var(--ink2)}',
    '#bnbWallet .w-dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block}',
    '#bnbWallet .w-dim{color:var(--dim)}',
    '#bnbWallet .w-err{color:var(--bad)}',
    /* ============================================================ 确认屏 · 太空时刻
       原来这里是乳白确认页上的一条上下文信息（#bnbConfirmInfo，ci-* 一族只归它用）。
       用户拍板：确认屏只留「引爆」「取消」两个交互件，信息块整个退场——数在上一屏都看过了。
       这一屏**刻意不跟浅色主题走**：按下引爆就进黑色的 3D 视图，从确认到爆炸不该有一次
       亮暗跳变，所以整屏固定深空底，颜色全部写死暗色（与 #bnbMintHud 同属"永远深底"的例外）。
       离线版 dist/mirror.html 不带本文件，它的乳白确认页一个字不变。
       两个按钮的 id（btnFire/btnCancel）与 app.js 里的事件接线一个字没动——只动样式。 */
    '#pageConfirm{background-color:#04050C;overflow:hidden;background-image:',
    '  radial-gradient(58% 44% at 50% 46%,rgba(96,48,140,.18),transparent 70%),',
    '  radial-gradient(1px 1px at 12% 24%,rgba(255,255,255,.55),transparent),',
    '  radial-gradient(1px 1px at 28% 68%,rgba(255,255,255,.35),transparent),',
    '  radial-gradient(1.5px 1.5px at 41% 12%,rgba(255,255,255,.45),transparent),',
    '  radial-gradient(1px 1px at 63% 79%,rgba(255,255,255,.4),transparent),',
    '  radial-gradient(1.5px 1.5px at 76% 30%,rgba(255,255,255,.5),transparent),',
    '  radial-gradient(1px 1px at 88% 60%,rgba(255,255,255,.35),transparent),',
    '  radial-gradient(1px 1px at 52% 90%,rgba(255,255,255,.3),transparent)}',
    /* 中央能量核：纯 CSS（径向渐变 + 关键帧），零外部资源。挂在 confirmMount() 里，
       #pageConfirm 平时带 [hidden]（display:none），动画不会在看不见的时候空烧。 */
    '#bnbCore{position:absolute;inset:0;pointer-events:none}',
    '#bnbCore i{position:absolute;left:50%;top:50%;display:block;border-radius:50%;transform:translate(-50%,-50%)}',
    '#bnbCore .core-glow{width:min(52vmin,460px);height:min(52vmin,460px);filter:blur(2px);',
    '  background:radial-gradient(closest-side,rgba(255,150,105,.5),rgba(255,72,42,.26) 36%,rgba(150,40,120,.16) 60%,transparent 74%);',
    '  animation:bnbCoreBreath 3.6s ease-in-out infinite}',
    '#bnbCore .core-heart{width:min(10vmin,88px);height:min(10vmin,88px);filter:blur(1px);',
    '  background:radial-gradient(closest-side,rgba(255,244,232,.95),rgba(255,190,150,.6) 46%,transparent);',
    '  animation:bnbCoreBreath 3.6s ease-in-out infinite}',
    /* 引力环：两个压扁的椭圆细环，周期错开，像在核外缓慢进动。纯 border，无 SVG 长路径 */
    '#bnbCore .core-ring{width:min(72vmin,640px);height:min(26vmin,230px);',
    '  border:1px solid rgba(140,170,255,.26);box-shadow:0 0 24px rgba(120,150,255,.12),inset 0 0 24px rgba(120,150,255,.1);',
    '  transform:translate(-50%,-50%) rotate(-14deg);animation:bnbRing1 8s ease-in-out infinite alternate}',
    '#bnbCore .core-ring.r2{width:min(58vmin,520px);height:min(19vmin,170px);',
    '  border-color:rgba(255,140,110,.2);box-shadow:0 0 18px rgba(255,120,80,.1),inset 0 0 18px rgba(255,120,80,.08);',
    '  transform:translate(-50%,-50%) rotate(19deg);animation:bnbRing2 11s ease-in-out infinite alternate}',
    '@keyframes bnbCoreBreath{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.82}',
    '  50%{transform:translate(-50%,-50%) scale(1.07);opacity:1}}',
    '@keyframes bnbRing1{from{transform:translate(-50%,-50%) rotate(-14deg) scale(.97);opacity:.55}',
    '  to{transform:translate(-50%,-50%) rotate(-14deg) scale(1.04);opacity:.95}}',
    '@keyframes bnbRing2{from{transform:translate(-50%,-50%) rotate(19deg) scale(1.03);opacity:.85}',
    '  to{transform:translate(-50%,-50%) rotate(19deg) scale(.96);opacity:.5}}',
    /* 「引爆」是主角：大号、暗红/等离子 glow、呼吸脉动。脉动只动 box-shadow 不动 transform——
       给 :active 的按压反馈留位，也让 reduced-motion 停掉动画后底座上的静态光晕还在。
       「取消」退成幽灵按钮：细边、低对比，不跟主角抢。 */
    '#pageConfirm .confirm-btns{position:relative;z-index:1;flex-direction:column;align-items:center;gap:30px}',
    '#pageConfirm #btnFire{width:min(340px,80vw);height:104px;font-size:36px;letter-spacing:.4em;text-indent:.4em;',
    '  font-weight:600;color:#FFE2D8;border:1px solid rgba(255,96,70,.55);border-radius:14px;',
    '  background:radial-gradient(130% 150% at 50% 16%,#551119 0%,#2A070E 55%,#160310 100%);',
    '  text-shadow:0 0 16px rgba(255,110,70,.8);',
    '  box-shadow:0 0 24px rgba(255,70,45,.4),0 0 90px rgba(255,64,40,.2),inset 0 0 22px rgba(255,100,65,.26);',
    '  animation:bnbFireBreath 2.8s ease-in-out infinite;transition:filter .15s}',
    '@keyframes bnbFireBreath{0%,100%{box-shadow:0 0 18px rgba(255,64,40,.28),0 0 70px rgba(255,64,40,.14),inset 0 0 18px rgba(255,90,60,.2)}',
    '  50%{box-shadow:0 0 34px rgba(255,84,52,.55),0 0 120px rgba(255,64,40,.3),inset 0 0 28px rgba(255,110,70,.34)}}',
    '#pageConfirm #btnFire:hover{filter:brightness(1.22)}',
    '#pageConfirm #btnFire:active{transform:scale(.985)}',
    '#pageConfirm #btnCancel{width:auto;height:46px;padding:0 32px;font-size:15px;letter-spacing:.35em;text-indent:.35em;',
    '  font-weight:500;color:rgba(198,208,238,.68);background:transparent;border:1px solid rgba(150,166,216,.32);',
    '  border-radius:999px;box-shadow:none;transition:color .15s,border-color .15s,background .15s}',
    '#pageConfirm #btnCancel:hover{color:#E2E8FB;border-color:rgba(190,205,250,.6);background:rgba(120,140,210,.1)}',
    '#pageConfirm #btnCancel:active{transform:scale(.98)}',
    /* 焦点圈按铁律走 var(--focus)：深浅两套都有定义，加 3px offset 用深空底隔开一圈更好认 */
    '#pageConfirm .big-btn:focus-visible{outline:2px solid var(--focus);outline-offset:3px}',
    '@media (max-width:520px){#pageConfirm #btnFire{height:88px;font-size:30px}}',
    /* 窄屏：整条芯片 210px 宽，实测在 375 上压住页面大标题 209×11，而且它是 fixed，
       往下滚会一直盖着正文。把次要说明（价格 / 网络名）收掉，只留状态与按钮。 */
    '@media (max-width:520px){#bnbWallet{max-width:calc(100vw - 28px)}#bnbWallet .w-dim{display:none}}',
    /* 引爆之后压在 3D 画面上的铸造入口。贴的是黑画布，所以固定用 HUD 那套深底浅字，
       不跟界面主题走 —— 这是全文件唯一不吃 v2 白卡片那一套的地方。
       top 为什么是 114 而不是 56：56 只躲开了顶部标注条（.hud-top 34~60），却正好压在
       早期宇宙时间线条带（.tl-strip top:64，含字幕到 ~105）上——实测 1038×990 下盖住
       95×25 的字幕，而那正是新手刚进宇宙时要读的东西。114 把两条都让开了。
       左右还要躲开 3D 的按钮列（#hudSide）与镜像信息面板（.mb-info），它们的尺寸随
       视口变，写死没用——由 hudPlace() 按真实矩形算，见下面。 */
    '#bnbMintHud{position:fixed;top:114px;right:14px;z-index:55;max-width:280px;',
    '  padding:14px 16px;border:1px solid var(--hud-line2);border-radius:var(--radius-card,14px);',
    '  background:var(--hud-panel2);color:var(--hud-ink);font-size:13px;',
    '  box-shadow:0 4px 18px rgba(0,0,0,.45)}',
    '#bnbMintHud[hidden]{display:none}',
    '#bnbMintHud .hud-title{font-weight:700;font-size:14px;margin-bottom:2px}',
    '#bnbMintHud .hud-sub{color:var(--hud-dim);font-size:11px;font-family:var(--mono);margin-bottom:8px}',
    /* 主按钮不能用 var(--cyan) 填充：这张卡片永远是深底，而 --cyan 在浅色主题里是深靛蓝
       （白字很清楚）、在深色主题里翻成亮紫（白字就糊了，实测深色下几乎看不清）。
       改成"反相"——固定浅的 --hud-ink 作底、深的 --hud-panel2 作字，两套主题下都是同一个
       高对比按钮；强调色只用在 hover 的描边上。
       焦点圈同理只能用 --hud-ink：--focus 在浅色主题里是深靛蓝，套在这张深卡上等于没画。 */
    '#bnbMintHud .hud-btn{width:100%;height:36px;padding:0 12px;border:1px solid var(--hud-ink);',
    '  border-radius:var(--radius-btn,10px);background:var(--hud-ink);color:var(--hud-panel2);',
    '  font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;transition:box-shadow .15s}',
    '#bnbMintHud .hud-btn:hover:not(:disabled){box-shadow:0 0 0 2px var(--cyan)}',
    '#bnbMintHud .hud-btn:disabled{opacity:.5;cursor:default}',
    /* 次要动作（救救它）：同样在固定深底上，用 --hud-* 描边，不跟主按钮抢 */
    '#bnbMintHud .hud-btn2{width:100%;height:32px;margin-top:6px;padding:0 12px;border:1px solid var(--hud-line2);',
    '  border-radius:var(--radius-btn,10px);background:transparent;color:var(--hud-ink);font-size:12.5px;',
    '  font-weight:600;font-family:inherit;cursor:pointer;transition:border-color .15s,background .15s}',
    '#bnbMintHud .hud-btn2:hover{border-color:var(--cyan);background:var(--hud-panel)}',
    '#bnbMintHud .hud-btn:focus-visible,#bnbMintHud .hud-btn2:focus-visible{outline:2px solid var(--hud-ink);outline-offset:2px}',
    '#bnbMintHud .hud-msg{color:var(--hud-dim);font-size:11.5px;line-height:1.6;margin-top:6px}',
    '#bnbMintHud .hud-msg:empty{margin-top:0}',
    '#bnbMintHud .hud-msg a{color:var(--cyan)}',
    /* 这两条是全文件仅有的两个裸色值，故意的：卡片永远是深底，而 var(--green)/var(--bad)
       在浅色主题里是深绿/深红，贴到深底上就没了。这里要的是"永远浅"的成功/失败色，
       取的正是深色主题那一套的值。 */
    '#bnbMintHud .hud-msg.bnb-ok{color:#7ee787}',
    '#bnbMintHud .hud-msg.bnb-err{color:#ff7a7a}',
    /* 窄屏只收窄，不改锚点。原来是贴底通栏（left/right:14 + bottom），实测 375×812 下
       同时压住右侧按钮列 91×108 和底部时间条 199×65 —— 手机上 3D 的 HUD 把下半屏
       占满了，通栏放哪儿都会挡。收窄之后仍由 hudPlace() 顶到按钮列左边的空当里。
       130 = 右侧按钮列（~91）+ 两边留白 */
    '@media (max-width:520px){#bnbMintHud{max-width:calc(100vw - 130px);font-size:12px}}',
    /* ---------- 分析面板开着时，铸造卡片收成右上角小徽标
       分析面板（#analysis）是右侧 min(600px,100vw) 的抽屉（z-index 40），这张卡片 fixed 在
       top:114/right:14、z-index 55 —— 面板一开正好压在它的内容上，被盖住的那栏读不了。
       过渡只挂 opacity/transform：top/right 由 hudPlace() 随时在写，挂上过渡会变成飘来飘去。
       visibility 只在收起态延迟 .15s（等淡出走完再摘掉），展开走底座这条（不延迟，立即可见）。 */
    '#bnbMintHud{transition:opacity .15s,transform .15s}',
    '#bnbMintHud.hud-away{opacity:0;transform:translateX(10px);visibility:hidden;pointer-events:none;',
    '  transition:opacity .15s,transform .15s,visibility 0s .15s}',
    '#bnbHudBadge{position:fixed;top:114px;right:14px;z-index:56;display:inline-flex;align-items:center;gap:7px;',
    '  height:34px;padding:0 14px;border:1px solid var(--hud-line2);border-radius:var(--radius-chip,999px);',
    '  background:var(--hud-panel2);color:var(--hud-ink);font-size:12px;font-weight:600;font-family:inherit;',
    '  cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45);transition:border-color .15s}',
    '#bnbHudBadge[hidden]{display:none}',
    '#bnbHudBadge:hover{border-color:var(--cyan)}',
    /* 深卡上的焦点圈只能用 --hud-ink：--focus 浅色主题是深靛蓝，贴深底等于没画（同 hud-btn） */
    '#bnbHudBadge:focus-visible{outline:2px solid var(--hud-ink);outline-offset:2px}',
    '#bnbHudBadge .hb-dot{width:8px;height:8px;border-radius:50%;background:var(--cyan);display:inline-block;flex:0 0 auto}',
    /* 说了不要动效的人就一下都别动：v2 里会动的只有画廊卡片的抬升和几个 hover 过渡 */
    '@media (prefers-reduced-motion:reduce){',
    '  #bnbPanel .bnb-btn,#bnbPanel .bnb-mk,#bnbPanel input[type=text],',
    '  #bnbWallet .w-btn,#bnbMintHud .hud-btn,#bnbMintHud .hud-btn2,.bnb-gal-item{transition:none}',
    '  .bnb-gal-item:hover{transform:none}',
    /* 确认屏与徽标：动画全停（静态光晕留在底座的 box-shadow 上），HUD 收放直切 */
    '  #bnbCore i,#pageConfirm #btnFire{animation:none}',
    '  #bnbMintHud,#bnbMintHud.hud-away,#bnbHudBadge,#pageConfirm .big-btn{transition:none}}',

    /* ---------- 广播浮层
       外观 v3（用户 2026-08-21「做好看、科幻」）：玻璃拟态半透面板 + 顶缘扫描光 +
       hover 发光描边。颜色一处不写死，全走 tokens.css —— 深色主题里 --cyan 是亮紫，
       发光描边自然亮；浅色主题里同一套令牌退成干净的白卡淡描边。
       模态遮罩 z 压过 export-box（9999）与 HUD。
       ⚠ web/market.html 的 .share-* 是同款一份（那页是刻意的单文件），
       改这里要连那边一起改 —— 先例见 qrEncode 的说明。 */
    '.bshare-pop{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;',
    '  padding:16px;background:var(--scrim,rgba(10,12,20,.55));overflow-y:auto;',
    '  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:bshareFade .15s ease-out}',
    '.bshare-pop.closing{opacity:0;transition:opacity .15s ease-in}',
    '.bshare-box{position:relative;width:100%;max-width:460px;background:var(--panel);',
    '  border:1px solid var(--cyan-line,var(--line));border-radius:var(--radius-pop,14px);',
    '  box-shadow:var(--shadow-pop,0 8px 32px rgba(0,0,0,.3)),0 0 42px var(--cyan-bg,transparent);',
    '  padding:18px 20px;margin:auto;color:var(--ink);overflow:hidden;',
    '  animation:bsharePop .18s cubic-bezier(.2,.7,.3,1)}',
    /* 玻璃质感只给支持 backdrop-filter 的浏览器：半透面板必须配毛玻璃，
       不然身后的页面文字会清清楚楚透进来叠在正文上（headless/老浏览器实测）。 */
    '@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){',
    '  .bshare-box{background:var(--panel-a,var(--panel));',
    '    -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}}',
    '.bshare-pop.closing .bshare-box{opacity:0;transform:translateY(8px) scale(.97);',
    '  transition:opacity .15s ease-in,transform .15s ease-in}',
    '.bshare-box:focus{outline:none}',
    /* 顶缘一线扫描光：科幻感的主笔画。颜色仍是令牌，深浅两态自己配平 */
    '.bshare-box::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;',
    '  background:linear-gradient(90deg,transparent,var(--cyan) 35%,var(--cyan) 65%,transparent);opacity:.8}',
    '@keyframes bshareFade{from{opacity:0}}',
    '@keyframes bsharePop{from{opacity:0;transform:translateY(10px) scale(.96)}}',
    '.bshare-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
    '.bshare-head b{font-size:15px;letter-spacing:.06em;flex:1;min-width:0}',
    /* 信号徽标：广播塔图标，装在一枚发光小方块里 */
    '.bshare-sig{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;',
    '  border-radius:9px;background:var(--cyan-bg);border:1px solid var(--cyan-line);color:var(--cyan);flex:none}',
    '.bshare-sig svg{width:17px;height:17px;display:block}',
    '.bshare-x{width:30px;height:30px;border:0;background:transparent;color:var(--dim);cursor:pointer;',
    '  font-size:18px;line-height:1;border-radius:var(--radius-btn,10px);flex:none}',
    '.bshare-x:hover{background:var(--panel2);color:var(--ink)}',
    '.bshare-x:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    /* 附图预览（用户 2026-08-21「附带一张游戏内的截图」）：图按原比例居中摆（截图是宽幅、
       卡面偏方，object-fit:contain 谁来都不裁），衬 --panel2 的底；右下角一枚来源小签
       （实况截图 / 卡面图）。签是压在图上的，图永远深底星空，签的底色写死深色不走令牌 ——
       与市场页 .share-shot 同款一份，改一处连另一处一起改（先例见 qrEncode 的说明）。 */
    '.bshare-shot{position:relative;margin:0 0 10px;padding:6px;background:var(--panel2);',
    '  border:1px solid var(--line-soft);border-radius:var(--radius-btn,10px)}',
    '.bshare-shot[hidden]{display:none}',
    '.bshare-shot img{display:block;margin:0 auto;height:110px;max-width:100%;width:auto;',
    '  object-fit:contain;border-radius:8px;background:#000;cursor:zoom-in}',
    '.bshare-shot-tag{position:absolute;right:12px;bottom:10px;margin:0;font-size:10px;font-weight:600;',
    '  letter-spacing:.08em;padding:2px 8px;border-radius:999px;background:rgba(5,11,19,.7);',
    '  color:#9fe8ff;pointer-events:none}',
    '.bshare-shot-tag:empty{display:none}',
    /* 预览图的大图遮罩：压过浮层（10050）；点任意处 / Esc 关（shareKey 先关它再关浮层） */
    '.bshare-lbox{position:fixed;inset:0;z-index:10060;display:flex;align-items:center;',
    '  justify-content:center;padding:24px;background:var(--scrim,rgba(0,0,0,.62));cursor:zoom-out}',
    '.bshare-lbox img{max-width:min(92vw,900px);max-height:82vh;border-radius:12px;',
    '  border:1px solid var(--line);background:#000;box-shadow:var(--shadow-pop,0 8px 32px rgba(0,0,0,.5))}',
    '.bshare-preview{margin:0 0 12px;padding:10px 12px;font-size:12px;line-height:1.7;color:var(--ink2);',
    '  background:var(--panel2);border:1px solid var(--line-soft);border-left:2px solid var(--cyan-line);',
    '  border-radius:var(--radius-btn,10px);word-break:break-all;user-select:text}',
    /* 主功能位：只有「复制文案和图片」一颗通栏大格（
       微信在渠道网格里，点开在网格下方展开二维码面板 §四） */
    '.bshare-feats{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:8px}',
    '.bshare-feat{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;',
    '  padding:0 12px;border-radius:var(--radius-btn,10px);font-size:13px;font-weight:700;',
    '  font-family:inherit;cursor:pointer;white-space:nowrap;min-width:0;',
    '  transition:filter .15s,background .15s,border-color .15s,color .15s}',
    '.bshare-feat svg{width:18px;height:18px;flex:none}',
    '.bshare-feat span{overflow:hidden;text-overflow:ellipsis}',
    '.bshare-feat.primary{background:var(--cyan);border:1px solid var(--cyan);color:var(--on-cyan)}',
    '.bshare-feat.primary:hover:not(:disabled){filter:brightness(1.08)}',
    '.bshare-feat:disabled{opacity:.55;cursor:default}',
    '.bshare-feat:focus-visible,.bshare-tile:focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    /* 渠道网格：一格一个渠道（图标 + 名字），hover 发光描边微微上浮 */
    '.bshare-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}',
    '.bshare-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;',
    '  padding:10px 4px 8px;border:1px solid var(--line);border-radius:var(--radius-btn,10px);',
    '  background:var(--panel2);color:var(--ink2);cursor:pointer;text-decoration:none;',
    '  font-family:inherit;font-size:11px;font-weight:600;min-width:0;',
    '  transition:border-color .15s,background .15s,color .15s,box-shadow .15s,transform .15s}',
    '.bshare-tile svg{width:20px;height:20px;flex:none}',
    '.bshare-tile span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bshare-tile:hover{border-color:var(--cyan);background:var(--cyan-bg);color:var(--cyan);',
    '  box-shadow:0 0 14px var(--cyan-bg);transform:translateY(-1px)}',
    '.bshare-tile.ok{border-color:var(--green-line);background:var(--green-bg);color:var(--green)}',
    /* 微信格的展开态（aria-expanded 同步）：微信绿 —— --green 系令牌正好是它的品牌色相 */
    '.bshare-tile.on{border-color:var(--green);background:var(--green-bg);color:var(--green)}',
    /* 窄屏（≤430）：网格收三列 —— 375 不许有横向滚动 */
    '@media (max-width:430px){.bshare-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}',
    /* 动效纪律：prefers-reduced-motion 一律直切（关闭那 160ms 由 closeShare 的 JS 同步跳过） */
    '@media (prefers-reduced-motion:reduce){.bshare-pop,.bshare-box{animation:none}',
    '  .bshare-pop.closing,.bshare-pop.closing .bshare-box{transition:none}',
    '  .bshare-feat,.bshare-tile{transition:none}.bshare-tile:hover{transform:none}}',
    /* 复制的结果那一行（图片没进剪贴板时要**明说**） */
    '.bshare-msg{margin:0 0 10px;font-size:11.5px;line-height:1.7;color:var(--dim)}',
    '.bshare-msg.warn{color:var(--gold,var(--ink2))}',
    /* 微信二维码那一块。二维码本身**永远白底黑块**（相机要的是对比度），
       所以给它一圈白垫底，深色主题下也不至于是一张浮在暗面上的孤零零方块。 */
    '.bshare-wx{margin:0 0 12px;padding:12px;border:1px solid var(--line-soft);',
    '  border-radius:var(--radius-btn,10px);background:var(--panel2);text-align:center}',
    '.bshare-qr{display:inline-block;padding:8px;background:#fff;border-radius:8px;line-height:0;',
    '  max-width:100%;font-size:12px;color:#333}',
    '.bshare-qr svg{display:block;width:100%;height:auto;max-width:168px}',
    '.bshare-qrnote{margin-top:8px;font-size:12px;color:var(--ink2)}',
    '.bshare-qrlink{margin-top:4px;font-size:11px;color:var(--dim);word-break:break-all;user-select:text}',
    '.bshare-note{font-size:11.5px;line-height:1.7;color:var(--dim)}',
    /* 「广播这枚」内联小按钮：混在铸造成功那行字里，长得像链接不抢戏 */
    '.bnb-share-inline{border:0;background:transparent;padding:0;margin:0;cursor:pointer;',
    '  font:inherit;font-weight:600;color:var(--cyan);text-decoration:underline}',
    '#bnbMintHud .bnb-share-inline{color:#9fb6ff}'
  ].join('\n');

  /* ============================================================ 面板 */
  var HTML = [
    '<div class="bnb-head">',
    '  <span class="bnb-title">ARCBANG</span>',
    '  <span class="bnb-sub">免费引爆，喜欢再铸造</span>',
    '  <button type="button" class="bnb-btn bnb-how" id="bnbHow" title="重看三步引导">怎么玩</button>',
    '  <a class="bnb-mk" id="bnbMarket" href="' + MARKET_URL + '" title="挂单、买卖宇宙 NFT 与资源（独立页面）">市场 ↗</a>',
    '</div>',
    '<div class="bnb-body">',
    /* 首屏就这一行：一个大按钮 + 一句状态。别的都藏在折叠里 */
    '  <div class="bnb-start">',
    '    <button type="button" class="bnb-btn give" id="bnbGive">给我一个宇宙</button>',
    '    <span id="bnbStatus" class="bnb-note"></span>',
    '  </div>',
    /* WebGPU 开关：页脚「设置」里本来就有一个，但新手改造之后它被埋进折叠里，等于没有。
       这里抬到首屏，两个是同一个开关（见 wireGpu），状态双向同步。 */
    '  <div class="bnb-gpu" id="bnbGpuRow" hidden>',
    '    <label class="gpu-sw" id="bnbGpuLab"><input type="checkbox" id="bnbGpuChk"><span>WebGPU 显卡加速</span></label>',
    '    <span class="gpu-st" id="bnbGpuSt">正在检测这台机器能不能用…</span>',
    '    <button type="button" class="bnb-btn gpu-help" id="bnbGpuHelp" title="看看这台机器能不能开 WebGPU、该去哪儿开">怎么开？</button>',
    '  </div>',
    '  <div class="bnb-card" id="bnbCard" hidden>',
    '    <div id="bnbHash" class="bnb-hash"></div>',
    '    <div id="bnbFacts" class="bnb-facts"></div>',
    /* 这个区块本身值得说一句的时候才出现（目前只有创世区块用到） */
    '    <div id="bnbNote" class="bnb-note" hidden></div>',
    '    <div id="bnbTop"></div>',
    '    <details id="bnbParams"><summary>想细看：这个宇宙的物理常数被推成了什么样</summary>',
    '      <div class="pin" id="bnbParamsIn"></div></details>',
    '    <div class="bnb-row" id="bnbActions" hidden>',
    '      <button type="button" class="bnb-btn fire" id="bnbFire">引爆这个宇宙</button>',
    /* 「不看就收下」= 不引爆、不看结局，直接铸造。结局在本地照算（合约要这个参数），
       但一个字都不显示——想留悬念的人可以先收着，回头自己炸开看。 */
    '      <button type="button" class="bnb-btn" id="bnbMintNow"',
    '        title="不引爆、也不看结局，直接铸造成 NFT——留着以后自己炸开看">不看就收下</button>',
    '      <button type="button" class="bnb-btn" id="bnbFix" hidden>干预沙盒</button>',
    '      <span id="bnbNowMsg" class="bnb-note"></span>',
    '    </div>',
    '    <div class="bnb-mint" id="bnbMintBox" hidden></div>',
    '  </div>',
    /* 四个取区块入口一个没删，只是收起来了 */
    '  <details class="bnb-fold" id="bnbPick">',
    '    <summary>自己挑一个区块（最新 / 创世 / 随机 / 指定高度 / 直接粘哈希）</summary>',
    '    <div class="fold-in">',
    '      <div class="bnb-row">',
    '        <button type="button" class="bnb-btn" id="bnbLatest">最新区块</button>',
    '        <button type="button" class="bnb-btn" id="bnbGenesis" title="这条链的第一个区块（0 号）">创世区块</button>',
    '        <button type="button" class="bnb-btn" id="bnbRandom">随机区块</button>',
    '        <input type="text" id="bnbInput" placeholder="区块高度，或直接粘贴 0x 开头的 64 位哈希" autocomplete="off">',
    '        <button type="button" class="bnb-btn" id="bnbLoad">取这个</button>',
    '      </div>',
    '    </div>',
    '  </details>',
    '</div>'
  ].join('\n');

  /* 「更多」折叠：把「我保存的宇宙」「操作说明」「已引爆的宇宙」三块从首屏搬进来。
     搬的是原来的 DOM 节点本身（appendChild 会移动而不是复制），所以 app.js 挂在
     #savedBox / #helpBox 上的监听和 localStorage 记忆全都原样有效。 */
  var MORE_HTML = [
    /* 末一项原来写「别人已经引爆的宇宙」，两个词都不准：那个列表既不是"引爆过的"
       （引爆不上链），也不一定是"别人的"（自己铸的排在最前面）。 */
    '<summary id="bnbMoreSum">更多：我保存的宇宙 · 怎么操作 · 快捷键 · 已经铸造成 NFT 的宇宙</summary>',
    '<div class="more-in" id="bnbMoreIn"></div>'
  ].join('\n');

  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function mount() {
    var acts = doc.querySelector('#pageSelect .acts');
    if (!acts) return false;
    var style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.appendChild(style);

    var panel = doc.createElement('section');
    panel.id = 'bnbPanel';
    panel.innerHTML = HTML;
    acts.parentNode.insertBefore(panel, acts.nextSibling);

    $('bnbGive').addEventListener('click', giveMe);
    $('bnbLatest').addEventListener('click', useLatest);
    $('bnbGenesis').addEventListener('click', useGenesis);
    $('bnbRandom').addEventListener('click', useRandom);
    $('bnbLoad').addEventListener('click', useInput);
    $('bnbMintNow').addEventListener('click', mintNow);
    $('bnbInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); useInput(); } });
    $('bnbFire').addEventListener('click', fire);
    // 干预沙盒：随便推参数、不花钱、不上链。模块缺席就不显示这个按钮
    if (root.MirrorIntervene && root.MirrorIntervene.open) {
      var fx = $('bnbFix');
      fx.hidden = false;
      fx.title = '进沙盒改这个宇宙的创世参数，看它会变成什么样——不花钱，不上链';
      fx.addEventListener('click', openSandbox);
    }
    // 「怎么玩」= 重看三步引导。模块缺席就把按钮收掉，别留一个点了没反应的东西
    var how = $('bnbHow');
    if (OB()) how.addEventListener('click', function () { OB().show(true); });
    else how.hidden = true;

    wireGpu();
    arcMount(panel);           // 品牌名与输入框提示
    installBlockSource();      // 先装来源，再收入口
    lockToBlocks();
    buildMore(panel);
    confirmMount();           // 确认屏的氛围层（能量核），挂一次就完
    return true;
  }

  /* ============================================================ WebGPU 开关（首屏）
   * 页脚「设置」折叠里本来就有一个 #gpuChk，逻辑全在 ui/app.js（写 localStorage、
   * 决定 forceBackend()）。新手改造之后首屏收得很紧，那个开关被埋进折叠里，等于不存在。
   *
   * 所以这里在面板上再放一个——但**不复制它的逻辑**：勾我们这个，就把 #gpuChk 的 checked
   * 改掉再给它派发一次 change，让 app.js 原来的监听去写 localStorage。两处各写一份 key
   * 是最容易长歪的做法（切了一处另一处不认），一个真源就没这个问题。
   *
   * 状态文案不走 app.js 的 #gpuNote：那一套只判断 navigator.gpu 在不在。本机实测是
   * 「navigator.gpu 在、requestAdapter() 返回空」，按它的说法叫"支持"，实际每次引爆都
   * 静默回退 WebGL2。真状态由 MirrorOnboard.gpuProbe() 跑一次 requestAdapter() 给出。
   */
  var GPUS = { st: null, hint: false, timer: 0 };

  /** 派发 change：老浏览器没有 Event 构造器，退回 createEvent。程序性赋值 .checked
      本身不触发 change，所以两边的监听不会互相打转 */
  function fireChange(el) {
    var ev;
    try { ev = new root.Event('change', { bubbles: true }); }
    catch (e) { ev = doc.createEvent('HTMLEvents'); ev.initEvent('change', true, false); }
    el.dispatchEvent(ev);
  }

  function gpuRender() {
    var st = $('bnbGpuSt');
    if (!st) return;
    var s = GPUS.st, src = $('gpuChk');
    /* 状态句永远以我们自己探到的结果为准：app.js 那句只判断 navigator.gpu 在不在，
       在本机会把"有 API 没适配器"说成"支持"。只有一种情况要借 #gpuNote —— 开关被锁住、
       而锁它的理由我们探不出来（地址栏 ?mode=xxx），那时把它的理由接在后面。 */
    var txt = s ? s.short : T('正在检测这台机器能不能用…');
    if (src && src.disabled && s && s.id === 'ok') {
      var note = $('gpuNote');
      if (note && note.textContent) txt += '　·　' + note.textContent;
    }
    // 刚切完开关：把"什么时候生效"贴在后面几秒。不说的话用户会以为开关没反应
    if (GPUS.hint) txt += T('　·　下次引爆生效（当前 3D 视图不变）');
    st.className = 'gpu-st ' + ((s && s.tone) || '');
    st.textContent = txt;
  }

  function gpuHint() {
    GPUS.hint = true;
    gpuRender();
    if (GPUS.timer) root.clearTimeout(GPUS.timer);
    GPUS.timer = root.setTimeout(function () { GPUS.hint = false; gpuRender(); }, 7000);
  }

  function wireGpu() {
    var row = $('bnbGpuRow'), mine = $('bnbGpuChk'), lab = $('bnbGpuLab'), help = $('bnbGpuHelp');
    var src = $('gpuChk');
    if (!row || !mine) return;
    // 主程序没挂这个开关（离线版 / 换了模板）：别摆一个操作不了任何东西的假开关
    if (!src) return;
    row.hidden = false;

    mine.checked = !!src.checked;
    if (src.disabled) { mine.disabled = true; if (lab) lab.className = 'gpu-sw off'; }

    // 我们 → 页脚：改真源 + 派发 change，写 localStorage 与 toast 都归 app.js 原来的监听
    mine.addEventListener('change', function () {
      if (src.checked === mine.checked) return;
      src.checked = mine.checked;
      fireChange(src);
      gpuHint();
    });
    // 页脚 → 我们：用户在设置里改的也要跟过来（同一个开关不能有两个状态）
    src.addEventListener('change', function () {
      if (mine.checked !== src.checked) { mine.checked = src.checked; gpuHint(); }
    });

    var o = OB();
    if (!o || !o.gpuProbe) {
      // 教程模块缺席：开关照样能用，只是给不出真状态，也别留一个点了没反应的按钮
      if (help) help.hidden = true;
      gpuRender();
      return;
    }
    o.onGpu(function (s) { GPUS.st = s; gpuRender(); });     // 「重新检测」之后也会再通知一次
    o.gpuProbe(function (s) { GPUS.st = s; gpuRender(); });
    if (help) help.addEventListener('click', function () { o.showGpuGuide(help); });
    gpuRender();
  }

  /** 把首屏的次要内容搬进一个折叠。搬节点而不是重建，避免动到 app.js 的既有逻辑 */
  function buildMore(panel) {
    if (!panel || !panel.parentNode) return;
    var more = doc.createElement('details');
    more.id = 'bnbMore';
    more.innerHTML = MORE_HTML;
    panel.parentNode.insertBefore(more, panel.nextSibling);   // 紧跟面板，排在页脚之前
    var box = $('bnbMoreIn');
    ['savedBox', 'helpBox'].forEach(function (id) {
      var el = $(id);
      if (el) box.appendChild(el);          // appendChild = 移动，监听器与 id 都还在
    });
    // 画廊本来在面板里，一起搬过来：它是"别人炸过什么"，属于逛，不属于第一步
    var gal = doc.createElement('div');
    gal.className = 'bnb-gal';
    gal.id = 'bnbGal';
    gal.hidden = true;
    box.appendChild(gal);
  }

  /* 装上"宇宙来源"钩子（ui/app.js 里的 blockSource()）。
     装了它之后，**分析面板底部的"随机引爆"和右键菜单里的同名项也只能来自 BNB 区块** ——
     lockToBlocks() 只收得掉起爆页上的按钮，那两条路它够不着，
     等于站点上仍有办法引爆一个不属于任何区块的宇宙。 */
  function installBlockSource() {
    function entryOf(card, n) {
      return {
        id: 'bnb-' + card.blockHash.slice(2, 10),
        label: n != null ? '区块 ' + n : card.blockHash.slice(0, 10),
        name: 'Arc 区块', params: card.params, modules: card.modules,
        preset: false, ours: false, temp: true
      };
    }
    /** 取一个随机高度的区块 → 服务端算 card → 组成 entry */
    function pickOne() {
      return C.latestBlockNumber().then(function (n) {
        var at = Math.floor(Math.random() * n);
        return C.blockHashOf(at).then(function (h) {
          return API.card(h).then(function (res) { return entryOf(res.card, at); });
        });
      });
    }
    root.MirrorBlockSource = {
      one: function (cb) {
        pickOne().then(function (e) { cb(e, null); }, function (err) { cb(null, err); });
      },
      /* 连续搜索用。取块是网络操作，一次多取几个摊平往返；
         n 给大了会把公共 RPC 打爆，所以这里封顶。 */
      many: function (n, cb) {
        /* 封顶 8：n 给大了会把公开 RPC 打爆。注意调用方传的 48 只是"尽量多给"，
           实际永远是 8 —— 这不是 bug，但调用方那边的队列阈值要按 8 来想。
           **同时把错误回传**：每个候选都要打一次 /api/card，那条是被限流的
           （匿名每小时 30 个不同哈希）。额度用完时全部 reject，
           不把原因传出去的话，调用方只能显示"搜索中…"，看不出是被限流了。 */
        var want = Math.min(n || 8, 8), jobs = [], firstErr = null;
        for (var i = 0; i < want; i++) {
          jobs.push(pickOne().catch(function (e) { if (!firstErr) firstErr = e; return null; }));
        }
        Promise.all(jobs).then(function (list) {
          var got = list.filter(Boolean);
          cb(got, got.length ? null : firstErr);
        }, function (e) { cb([], e); });
      }
    };
  }

  /* 站点版只认 BNB 区块：把"随机引爆 / 连续搜索 / 自己调参数"这些入口收掉。
     离线版 dist/mirror.html 不受影响，那里三条路都还在。
     注：这是产品面的收口，不是安全边界——合约那边本来就只接受区块哈希，
     自己捏的参数没法铸造。 */
  function lockToBlocks() {
    /* 命令面板（ui/app.js 的 palette）里也有"连续随机引爆"这一条，隐藏按钮够不着它。
       站点版必须一并收掉 —— 不是为了整齐，是因为那个功能在站点上**结构性地跑不通**：
       每个候选宇宙都要打一次 /api/card，而那条是被限流的（匿名每小时 30 个不同哈希）。
       搜索上限却写着 5000 次。放着不管，用户点进去只会看到一个转不动的进度。
       离线版 dist/mirror.html 不受影响，那里本地算，想搜多少搜多少。 */
    root.MIRROR_LOCK_TO_BLOCKS = true;

    ['actRandom', 'actSearch', 'actEdit', 'btnEditor', 'btnRandom', 'btnSearch'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
    var acts = doc.querySelector('#pageSelect .acts');
    if (acts) acts.hidden = true;                     // 三个按钮都没了，整条也收掉

    // 一句话说清「这是什么」——首屏的文字预算就这一行，剩下的交给那个大按钮
    var sub = doc.querySelector('#pageSelect .hero-sub');
    if (sub) sub.textContent = '每个 Arc 区块哈希，都是一个宇宙：引爆它，看它能否长出生命';

    // 编辑器里的"随机"按钮同理（编辑器抽屉本身已经进不去了，防个万一）
    var edRandom = $('edRandom');
    if (edRandom) edRandom.hidden = true;
  }

  /* ============================================================ 取哈希 */
  function status(msg, cls) {
    var el = $('bnbStatus');
    if (el) { el.className = 'bnb-note ' + (cls || ''); el.textContent = msg || ''; }
  }

  /** 首屏那个大按钮：不问任何问题，直接给一个宇宙（随机区块）。
      新手不知道"最新/随机/高度/哈希"有什么区别，也不该被要求知道。 */
  function giveMe() {
    var b = $('bnbGive');
    if (b) { b.disabled = true; b.textContent = T('正在从 Arc 链上取一个区块…'); }
    useRandom(function () {
      if (b) { b.disabled = false; b.textContent = T('再给我一个'); }
    });
  }

  function useLatest() {
    status(T('正在取最新区块…'));
    C.latestBlockNumber().then(function (n) {
      return C.blockHashOf(n).then(function (h) { setHash(h, n); status(''); });
    }).catch(rpcFail);
  }

  /** 创世区块：这条链的 0 号，走正常的 blockHashOf(0)。
      取不到就**拒绝**，不再退回写死的常量。
      那个常量确实是我从链上取下来核对过的（派生出的宇宙和联网取到的一模一样），
      但"这一刻没验证过"和"验证过"是两回事 —— 站点既然对粘贴的哈希立了
      "不是真区块就不给引爆"的规矩，自己这条路就不能开后门。
      常量保留在 GENESIS_REF.hash 里只作参考，不再拿它引爆。 */
  function useGenesis() {
    status(T('正在取这条链的第一个区块…'));
    C.blockHashOf(0).then(function (h) {
      setHash(h, 0, genesisNote());
      status('');
    }).catch(function (e) {
      clearHash();
      status(TF('取不到创世区块（{0}）—— 没从链上核实过就不给引爆。换个网络或稍后再试。',
        (e && e.message ? e.message : T('节点无响应'))), 'bnb-err');
    });
  }

  /* 空间维数只有一个来源：服务端算好的 card.dimension（renderCard 显示的就是它）。
     以前判的是 d.dimOff / d.params.dimS —— 维度改成弦气体派生之后这两个字段就没有了，
     于是 dimOff 恒为 undefined，所有判它的地方**都默默走"否"那一支**：
     创世区块这句"维数不是 3"永远不出现（实测创世块 D = 12.5），
     确认页则把每一个宇宙都写成「D = 3 维」。两处共用这一个函数，不再各判各的。 */
  function dimOf(d) {
    var D = (d && d.dimension && d.dimension.D != null) ? d.dimension.D : null;
    return { D: D, off: D != null && Math.abs(D - 3) > 1e-9 };
  }

  /** 创世区块的那句话。只说有据可查的事：它是这条链的第一个区块；维数不是 3 就报个数。
      原来这里还有一段「结构性死亡：救活率 0%，怎么推参数都活不了」—— 那是 economy.md v3
      时代（dimS 直接输入）的结论，维度改成弦气派生后已经不成立
      （economy-v4 §4.1 实测 D≠3 推回 3 的比例 100%，intervene.js 的 doomVerdict 同日已改口），
      而且当着用户的面否定拯救玩法。删。「反常」资源那半句跟着资源系统一起废了。 */
  function genesisNote() {
    return function (d) {
      /* 日期只有认识这条链才说得出口（见 GENESIS_REF）；不认识就只说「第一个区块」。 */
      var day = genesisDate();
      var s = day ? TX('这是这条链的第一个区块（0 号，{0}上出生于 {1}）。', chainName(), day)
                  : TF('这是这条链的第一个区块（0 号，{0}）。', chainName());
      if (dimOf(d).off) {
        s += T('它派生出来的空间维数不是 3。');
      }
      return s;
    };
  }

  function useRandom(done) {
    status(T('正在随机取一个区块…'));
    C.latestBlockNumber().then(function (n) {
      var pick = Math.floor(Math.random() * n);
      return C.blockHashOf(pick).then(function (h) { setHash(h, pick); status(''); });
    }).catch(rpcFail).then(function () { if (typeof done === 'function') done(); });
  }

  function useInput() {
    var v = String($('bnbInput').value || '').trim();
    if (!v) return;
    /* 粘进来的哈希必须先核对它真的是本链上的一个区块。
       不核的话随手编一串十六进制也能炸出宇宙 ——「一个区块一个宇宙」这条设定就漏了，
       而且这种哈希铸上链之后，别人拿区块号根本对不上，等于往链上写脏数据。
       eth_getBlockByHash 找不到就直接拒绝，连引爆都不给。 */
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
      status(TF('正在核对这个哈希是不是 {0} 上的区块…', chainName()));
      clearHash();
      C.blockByHash(v).then(function (b) {
        if (!b) {
          status(TF('这不是 {0} 上的区块 —— 不给引爆。哈希得来自真实区块'
            + '（也可能它属于别的链，本站只认这一条）。', chainName()), 'bnb-err');
          return;
        }
        var n = parseInt(b.number, 16);
        setHash(b.hash, n);
        status(TF('核对通过：这是区块 {0}', n), 'bnb-ok');
      }).catch(function (e) {
        status(TF('核对失败（节点无响应）：{0}。未完成核实前不能引爆。', (e && e.message ? e.message : e)), 'bnb-err');
      });
      return;
    }
    var n = Number(v);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) { status(T('无法识别：既不是区块高度，也不是 64 位哈希。'), 'bnb-err'); return; }
    status(TF('正在取区块 {0}…', n));
    C.blockHashOf(n).then(function (h) { setHash(h, n); status(''); }).catch(rpcFail);
  }

  function rpcFail(e) {
    // 取不到区块时给一条**能自己走下去**的退路，而不是只丢一句报错
    status(TF('取区块失败：{0}（稍后再试，或者展开下面的「自己挑一个区块」，直接粘一个 0x 开头的哈希）',
      (e && e.message ? e.message : e)), 'bnb-err');
    var pick = $('bnbPick');
    if (pick) pick.open = true;
  }

  /* 只换品牌名与输入框提示。
     再加一处：拯救系统在这个站上整套下线，沙盒留着当免费玩法，但不能再叫「干预沙盒」——
     「干预」是拯救那套话术的词。按钮与它的 title 在这里改名，标记里的默认值不动。 */
  function arcMount(panel) {
    var tt = panel.querySelector('.bnb-title');
    if (tt) tt.textContent = 'ARCBANG';
    var inp = $('bnbInput');
    if (inp) inp.placeholder = 'Arc 区块高度，或粘贴 64 位区块哈希（带不带 0x 都行）';
    var fx = $('bnbFix');
    if (fx) {
      fx.textContent = T('调参沙盒');
      fx.title = T('在沙盒中调整该宇宙的创世参数并即时查看结果；不花费、不上链。');
    }
  }


  /* ============================================================ 派生与展示 */
  /** note：可选，(derived) => 文案。做成函数是因为要不要说那句话取决于派生结果
      （比如"维数不是 3"这种），而派生要等到这里才发生 */
  /* 把当前宇宙整个撤下来。核对哈希这段必须先调它：否则核对失败时，
     上一个宇宙的卡片还挂在页面上，「引爆」按钮照样能按 —— 等于验了个寂寞。 */
  function clearHash() {
    S.hash = null; S.blockNumber = null; S.derived = null; S.minted = null; S.revealed = false;
    var card = $('bnbCard'), acts = $('bnbActions'), mint = $('bnbMintBox');
    if (card) card.hidden = true;
    if (acts) acts.hidden = true;
    if (mint) mint.hidden = true;
  }

  function setHash(hash, blockNumber, note) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash))) { status(T('哈希不合法：必须是 32 字节十六进制'), 'bnb-err'); return; }
    status(T('正在向服务端要这个宇宙的参数…'));
    API.card(hash).then(function (res) {
      renderCard(res.card, res.cardHash, blockNumber, note);
      status('');
    }, function (e) {
      /* 限流和"算不出来"是两件完全不同的事，混成一句会把人推向正好相反的动作：
         看到"服务端算不出来"，人只会以为是这个哈希的问题，然后**接着换一个再试** ——
         而那正是额度用完时最不该做的。所以 429 单独说，并且告诉他额度没白花：
         已经看过的宇宙在同一个窗口里重复问不扣额度（server/ratelimit.js 的 seen 集合，
         实测 /api/card 与 /api/bang 问同一个哈希只扣一次），照样铸得了。 */
      if (e && e.status === 429) {
        status(TF('这一下没算成：{0}。这只是算参数卡的速率限制，不是引爆次数；刚才看过的宇宙不受影响，稍等几秒再点。',
          (e.message || T('稍后再试'))), 'bnb-warn');
        return;
      }
      status(TF('服务端算不出来：{0}', (e && e.message || T('无响应'))), 'bnb-err');
    });
  }

  /* card 由服务端算好送来。这里只做显示。
     旧版在这一步本地跑 bnbhash.derive + engine.simulate —— 那份代码已经不打进站点包了。 */
  function renderCard(card, cardHash, blockNumber, note) {
    var d = {
      hash: card.blockHash, tier: card.tier, params: card.params, modules: card.modules,
      uInt: card.uInt, dimension: card.dimension, outcome: card.outcome,
      constants: card.constants, cardHash: cardHash
    };
    S.hash = d.hash; S.blockNumber = blockNumber != null ? blockNumber : card.blockNumber;
    S.derived = d; S.minted = null;
    S.revealed = false;                              // 换了宇宙：结局重新盖上，等真炸过再揭

    /* 编号摆前面、哈希退到第二行。
       原来这一行是「<66 个十六进制字符>　← 区块 119969013」：第一眼撞上的是那串谁也读不了
       的哈希，而真正的身份（区块号）挂在一个箭头后面，是全行最后才读到的东西。

       原注释写着"区块号刻意不写成 #12345，页面上另有 NFT 的 #N，两个 # 挨在一起没人
       分得清"——那个顾虑现在没有了：画廊已经不显示 tokenId 了，而剩下几处提到 tokenId
       的地方一律带着「NFT」两个字。全站现在是这个口径，和 market.html 一致：
         「宇宙 #<区块号>」= 身份　　「NFT #<tokenId>」= 铸造顺序
       两个 # 前面永远有一个词说清它是哪一种。 */
    $('bnbHash').innerHTML = (S.blockNumber != null
        ? '<b class="bh-no">' + esc(TF('宇宙 {0}', uniNo(S.blockNumber))) + '</b>'
        : '')
      + '<span class="bh-h">' + esc(d.hash) + '</span>';
    $('bnbFacts').innerHTML =
      /* 维度来自服务端算好的 card.dimension。
         这里以前读的是 d.dimOff / d.params.dimS —— 自从维度改由弦气体模型派生之后，
         这两个字段就不存在了，页面上显示的是 undefined。 */
      /* D≠3 的括号注原来写着「这类基本救不活」—— 当着用户的面否定玩法。删掉，只报数。
         D≠3 那一支现在补一句「（我们的宇宙是 3）」：这张卡是很多人第一次见到 D，
         光写「空间维数 D = 14」没有参照系，读者不知道 14 是大是小。 */
      '<span class="bnb-note">' + esc(T('空间维数 ')) +
        (d.dimension && d.dimension.D != null
          ? (Math.abs(d.dimension.D - 3) < 1e-9
              ? '<b>D = 3</b>' + esc(T('（和我们一样，约 3% 的区块能走到这一步）'))
              : '<b>D = ' + d.dimension.D + '</b>' + esc(T('（我们的宇宙是 3）')))
          : esc(T('（服务端没给）'))) + '</span>';
    var nb = $('bnbNote'), txt = typeof note === 'function' ? note(d) : (note || '');
    nb.innerHTML = esc(txt);
    nb.hidden = !txt;

    $('bnbCard').hidden = false;
    $('bnbActions').hidden = false;
    $('bnbMintBox').hidden = true;
    nowMsg('');
    renderParams(d);
    syncMintNow();

    checkMinted();
  }

  /* ---------------------------------------------------------- 不看就收下（直接铸造）
     铸造要往链上写 outcome，所以本地必须算一遍结局 —— 但**算了不显示**。
     这条路上界面不能出现任何结局字样，否则"留悬念"这个承诺就没了。 */
  function nowMsg(html, cls) {
    var el = $('bnbNowMsg');
    if (el) { el.className = 'bnb-note ' + (cls || ''); el.innerHTML = html; }
  }

  /* ---------------------------------------------------------- 放号阶段（白名单）
     2026-09-18 起铸造分四段：warmup（不开）/ gtd（白名单优先）/ fcfs（名单先到先得）/ public。
     判断在服务端（server/allowlist.js），**这里只是提前把话说清楚** ——
     没有这一层的话，预热期点「铸造」会先弹钱包、再拿回一个 403，
     用户已经在钱包里确认过一次了才被告知「还没开」。

     所以 PH 只用来**决定要不要弹钱包**，不用来决定能不能铸：真正算数的仍是服务端那道闸。
     拿不到状态（接口没起来、老服务端）时一律不拦 —— 宁可让人点下去看服务端怎么说，
     也不能因为一次网络抖动把铸造按钮永久灰掉。 */
  var PH = { got: false, phase: null, tier: null, listed: false, opens: {}, next: null, addr: null };
  function phaseLoad() {
    if (!API || !API.allowlistStatus) return;
    var a = W.addr || null;
    API.allowlistStatus(a).then(function (st) {
      if ((W.addr || null) !== a) return;              // 问的过程中换了地址就作废
      PH = {
        got: true, phase: st.phase || null, tier: st.tier || null, listed: !!st.listed,
        opens: st.opens || {}, next: st.next || null, addr: a
      };
      syncMintNow();
      if (!$('bnbMintBox') || $('bnbMintBox').hidden) return;
      if (S.derived) showMint();                        // 面板开着就顺手重画一次
    }, function () { /* 拿不到就当没有这一层 */ });
  }
  /* ---- 登记签名（兼作会话令牌） ----
     预热页登记时签过一次，把 {addr, sig} 留在 localStorage；这里只**读**它，
     用来给「引爆并分享」那一分打卡（POST /api/allowlist/share）。
     用户拍板「别每次弹钱包」，所以这条路上一次都不弹：没有存档就静默跳过。
     键名与 web/quest-arc.html 里写的那一个必须逐字相同。 */
  var AL_SIG_KEY = 'arcbang.al.sig';
  function alSigFor(addr) {
    if (!addr) return null;
    try {
      var raw = root.localStorage && root.localStorage.getItem(AL_SIG_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      if (!j || String(j.addr).toLowerCase() !== String(addr).toLowerCase()) return null;
      return /^0x[0-9a-fA-F]{130}$/.test(String(j.sig)) ? j.sig : null;
    } catch (e) { return null; }      // 隐私模式下 localStorage 会抛，不能让它带走整条链
  }
  /**
   * 引爆计分。**绝不让它影响引爆本身** —— 成败都不报错、不拦界面。
   * 打点在 reveal()：卡拿到了、3D 也进去了，那才叫真引爆过一次。
   * 没连钱包 / 没登记（拿不到会话签名）就静默跳过，一次钱包都不弹。
   * 每日与预热期两道上限、同区块去重、频率闸全在服务端，这里不预判。
   */
  function alBangTick(addr, hash) {
    var sig = alSigFor(addr);
    if (!sig || !API || !API.allowlistBang || !hash) return;
    try {
      API.allowlistBang(addr, sig, hash).then(function (r) {
        /* 真加上分了才去刷榜：到顶 / 重复 / 离上一次不够间隔（capped:'interval'）
           回的也都是 200，刷了也白刷。这几种情况**一律静默** ——
           那颗按钮本来就随便点，弹一句「太快了」只会让人以为自己做错了什么。 */
        if (r && r.counted) phaseLoad();
      }, function () { /* 没登记 / 频率闸 / 网络不通：都不该打断引爆 */ });
    } catch (e) { /* 同上 */ }
  }
  /** 分享打卡。**绝不让它影响分享本身** —— 成败都不报错、不拦浮层。 */
  function alShareTick(addr, hash) {
    var sig = alSigFor(addr);
    if (!sig || !API || !API.allowlistShare || !hash) return;
    try {
      API.allowlistShare(addr, sig, hash).then(function () {
        phaseLoad();                  // 分数变了，榜和「下一步」跟着刷
      }, function () { /* 没登记 / 今天已记过 / 网络不通：都不该打断分享 */ });
    } catch (e) { /* 同上 */ }
  }

  /** 本地时间的人话时间。服务端给的是 ISO，直接摆出来没人读得下去。 */
  function fmtWhen(iso) {
    if (!iso) return T('时间待定');
    var d = new Date(iso);
    if (isNaN(d.getTime())) return T('时间待定');
    try { return d.toLocaleString(); } catch (e) { return iso; }
  }
  /** 「开放时间：{0}」这种冒号句式里的短写。没定就是「待定」——
      那里再套 fmtWhen 会写出「开放时间：时间待定」。 */
  function fmtOpen(iso) { return iso ? fmtWhen(iso) : T('待定'); }
  /** 段名的人话。**不点名谁在优先层**（用户拍板：名单构成不公开）。
      内部 key 一律还是 gtd / fcfs，改的只是显示名。 */
  function phaseWord(p) {
    return p === 'gtd' ? T('白名单') : p === 'fcfs' ? T('先到先得') : p === 'public' ? T('公售') : T('预热');
  }
  /**
   * 现在这个地址能不能点铸造。能就回 null，不能就回一句给人看的话。
   * 只在**确知**不行时才拦：状态没拿到、或者钱包还没连（不知道在不在名单）一律放行。
   */
  function phaseBlock() {
    if (!PH.got || !PH.phase) return null;
    var o = PH.opens || {};
    if (PH.phase === 'warmup') {
      /* 有确定时间就写时间，没有就直说待定 —— **不编一个日期出来**，
         也不把「时间待定」塞进「将于 … 开放」那个句式里读成病句。 */
      var gtdAt = o.gtd || (PH.next && PH.next.at) || null;
      return gtdAt
        ? TF('铸造尚未开放。白名单阶段将于 {0} 开放，可先完成登记与任务。', fmtWhen(gtdAt))
        : T('铸造尚未开放。白名单阶段开放时间待定，可先完成登记与任务。');
    }
    if (!W.addr) return null;                   // 没连钱包就不知道在不在名单，别提前拦
    if (PH.phase === 'gtd' && PH.tier !== 'gtd') {
      return PH.listed
        ? TF('当前为白名单阶段，仅白名单地址可铸造。先到先得阶段开放时间：{0}。', fmtOpen(o.fcfs))
        : TF('该地址不在白名单内。先到先得阶段开放时间：{0}；公售开放时间：{1}。', fmtOpen(o.fcfs), fmtOpen(o.public));
    }
    if (PH.phase === 'fcfs' && !PH.listed) {
      return TF('该地址不在白名单内。当前为先到先得阶段，公售开放时间：{0}，届时所有地址均可铸造。', fmtOpen(o.public));
    }
    /* 白名单 / 先到先得两段只放免费额度：这个地址的免费次数用完了就到此为止，
       付费要等公售（服务端 gate 同样拒签 FREE_GONE，这里只是不给一个必然失败的按钮）。 */
    if (PH.phase === 'gtd' || PH.phase === 'fcfs') {
      var freeUsedUp = (W.fc && W.fc.supported) ? (W.fc.used >= W.fc.cap) : (W.usedFree === true);
      if (freeUsedUp) return TF('免费额度已用完，付费铸造将在公售阶段开放（{0}）。', fmtOpen(o.public));
    }
    return null;
  }

  /** 按钮该不该能点：合约没部署、放号还没轮到、或这个哈希已经被铸走，
      都不该给一个点了必然失败的按钮 */
  function syncMintNow() {
    var b = $('bnbMintNow');
    if (!b) return;
    var blocked = phaseBlock();
    if (blocked) { b.disabled = true; b.title = blocked; nowMsg(esc(blocked)); return; }
    if (!C.contract()) {
      b.disabled = true;
      b.title = TF('合约还没部署到 {0}，暂时不能铸造', chainName());
      // 灰按钮 + tooltip 说不清事，把原因摆在旁边（和引爆后那块面板的说法一致）
      nowMsg(esc(T('（合约还没部署，暂时不能铸造；引爆和干预都不受影响）')));
      return;
    }
    if (S.minted) { b.disabled = true; b.title = S.minted > 0 ? T('该宇宙已被其他地址铸造') : T('你已铸造该宇宙'); return; }
    b.disabled = false;
    b.title = T('不引爆、不查看结局，直接铸造为 NFT，留待之后开启。');
  }

  function mintNow() {
    if (!S.derived) return;
    var blockedNow = phaseBlock();
    if (blockedNow) { nowMsg(esc(blockedNow), 'bnb-warn'); return; }
    if (!C.contract()) { nowMsg(esc(TF('合约还没部署到 {0}，暂时不能铸造（引爆和干预都不受影响）', chainName()))); return; }
    if (S.minted) {
      nowMsg(S.minted > 0 ? esc(T('该宇宙已被其他地址铸造，请换一个区块。'))
                          : esc(T('你已铸造该宇宙')) + ' · <a href="' + MARKET_URL + '">' + esc(T('到市场查看')) + '</a>', 'bnb-warn');
      return;
    }
    var idx = OUTCOME_ORDER.indexOf(outcomeOf(S.derived));
    // 结局算不出来就不能声明。措辞刻意不提"结局是什么"，只说这个宇宙铸不了
    if (idx < 0) { nowMsg(esc(T('该宇宙超出引擎的计算范围，无法铸造，请换一个区块。')), 'bnb-err'); return; }
    mint(idx, nowMsg, function () { return $('bnbMintNow'); });
  }

  /* ---------------------------------------------------------- 创世参数表 */
  /* **不捕获成常量**（web/intervene.js 顶部早写明过同一个教训）：这个文件在注入层里，
     一旦排到 engine/params.js 之前（build-web 的注入点错位就真发生过），
     启动时捕获到的就是 undefined，参数表从此永远空白且一个错都不报。用时现取。 */
  function ParamsMod() { return root.MirrorParams || null; }

  /** 相对我们宇宙的偏离：log 参数看倍率，lin 参数看百分比；两者都给一个 unit 空间的排序值 */
  function deviation(d, v) {
    var Params = ParamsMod();
    var base = d.default, unit = Params.toUnit(d.key, v) - Params.toUnit(d.key, base);
    var text;
    if (v === base) text = '—';
    else if (d.scale === 'log' && base > 0 && v > 0) {
      var r = v / base;
      // 差得很少时倍率会全挤在 ×1.00 上，那就改说百分比
      if (Math.abs(r - 1) < 0.05) {
        var p2 = (r - 1) * 100;
        text = (p2 > 0 ? '+' : '') + (Math.abs(p2) >= 1 ? p2.toFixed(1) : p2.toFixed(2)) + '%';
      } else {
        text = r > 1 ? '×' + (r >= 10 ? r.toFixed(0) : r.toFixed(2))
                     : '÷' + (1 / r >= 10 ? (1 / r).toFixed(0) : (1 / r).toFixed(2));
      }
    } else if (base !== 0) {
      var pct = (v - base) / Math.abs(base) * 100;
      text = (pct > 0 ? '+' : '') + (Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
    } else {
      text = (v > 0 ? '+' : '') + Params.formatValue(d.key, v);
    }
    return { unit: unit, text: text, moved: Math.abs(unit) > 1e-9 };
  }

  function renderParams(d) {
    var Params = ParamsMod();
    var box = $('bnbParamsIn'), top = $('bnbTop');
    if (!box || !Params) return;
    /* 参数清单必须跟着 card 走，不能写死 Params.BASE。
       维度改成弦气派生之后（commit 533d552），dimS 不再是输入：服务端的 card.params
       里没有它，多出来的是 T₀/T_H、n_w、κ 三个。照着 BASE 遍历就会读到 undefined，
       formatValue 里一个 toPrecision 直接抛异常 —— **整张参数表变空白，而且
       renderCard 里排在后面的 syncMintNow() 和 checkMinted() 全部被跳过**
       （铸造按钮的状态、"这个宇宙已经被铸走了"的检查都不再执行）。
       paramsFor(modules) 是引擎自己对"这套配置的输入是哪些"的回答，跟着它走就不会再漂。 */
    var specs = (d.modules && Params.paramsFor) ? Params.paramsFor(d.modules) : Params.BASE;
    var rows = [];
    specs.forEach(function (spec) {
      var v = d.params[spec.key];
      // 服务端没给的参数就不显示。少一行远好过整张表连同后面的逻辑一起崩掉
      if (typeof v !== 'number' || !isFinite(v)) return;
      rows.push({ spec: spec, v: v, dev: deviation(spec, v) });
    });

    // 列序是人话 → 符号 → 数值：符号留着（老手要看），但不再是第一眼撞上的东西
    box.innerHTML =
      '<table><tr class="phead"><td>' + esc(T('它管什么')) + '</td><td>' + esc(T('符号')) + '</td><td class="val">' + esc(T('这个宇宙')) + '</td>' +
      '<td class="ours">' + esc(T('我们的')) + '</td><td class="dev">' + esc(T('偏离')) + '</td></tr>' +
      rows.map(function (r) {
        var u = r.spec.unit ? ' ' + r.spec.unit : '';
        return '<tr class="' + (r.dev.moved ? 'moved' : '') + '">' +
          '<td class="plain">' + esc(plainName(r.spec.key, r.spec.name)) + '</td>' +
          '<td class="sym">' + esc(r.spec.symbol) + '</td>' +
          '<td class="val">' + esc(Params.formatValue(r.spec.key, r.v)) + esc(u) + '</td>' +
          '<td class="ours">' + esc(Params.formatValue(r.spec.key, r.spec.default)) + '</td>' +
          '<td class="dev">' + esc(r.dev.text) + '</td></tr>';
      }).join('') + '</table>';

    // 一句话概括：偏得最狠的三个
    var worst = rows.filter(function (r) { return r.dev.moved; })
      .sort(function (a, b) { return Math.abs(b.dev.unit) - Math.abs(a.dev.unit); }).slice(0, 3);
    top.innerHTML = worst.length
      ? esc(T('和我们的宇宙差得最远的三条：')) + worst.map(function (r) {
          return '<b>' + esc(plainName(r.spec.key, r.spec.name)) + '（' + esc(r.spec.symbol) + '）' +
            esc(r.dev.text) + '</b>';
        }).join(esc(T('、'))) + esc(TX('　（{0} 个常数里有 {1} 个被推动了）', rows.length, rows.filter(function (r) { return r.dev.moved; }).length))
      : esc(TF('{0} 个常数全部停在我们宇宙的位置上——这个哈希抽到了一模一样的物理定律。', rows.length));
  }

  function checkMinted() {
    if (!C.contract()) return;
    var h = S.hash;
    C.tokenOfHash(h).then(function (id) {
      if (S.hash !== h) return;                      // 用户已经换了一个哈希
      S.minted = Number(id);
      // 链上编号一律写成"NFT #N"：光一个 # 会和顶部 HUD 里的本机流水号看着像同一个东西
      if (S.minted > 0) status(TF('该宇宙已被铸造（宇宙 #{0} · 链上 NFT #{1}），仍可查看，但不能再次铸造。', S.blockNumber != null ? S.blockNumber : '—', S.minted), 'bnb-warn');
      syncMintNow();
    }).catch(function () { /* 合约没部署或节点抽风：不打扰，mint 时会再报 */ });
  }

  /* ============================================================ 引爆 */
  function fire() {
    if (!S.derived) return;
    App = App || root.MirrorApp;
    if (!App || !App.selectEntry) { status(T('主程序还没就绪，稍等一下再点'), 'bnb-err'); return; }
    var d = S.derived;
    App.selectEntry({
      id: 'bnb-' + d.hash.slice(2, 10),
      label: '#' + d.hash.slice(2, 8).toUpperCase(),
      name: entryName(d),
      params: d.params,
      modules: d.modules,
      temp: true
    });
    App.setState('confirm');
    /* 这里**不再**提前写结局。原来在这一步就调 showMint()：确认页把整个起爆页藏起来了，
       那块内容当场看不见；等用户在确认页点「取消」退回来，结局却已经写在那儿了 ——
       等于"我没炸，你先把答案告诉我了"。改成真的进了宇宙才揭（见 hudSync 里的 reveal）。 */
  }

  /* 打开干预沙盒。刻意不在这里算结局：那会把"引爆看结果"的悬念提前剧透掉，
     按钮文案保持中性，进了沙盒自然就看到了。

     **返回开没开成**：深链 fix=1 要靠这个布尔决定
     "还要不要再试一次 / 就地停在确认屏"。MirrorIntervene.open() 自己在引擎或 DOM
     没就绪时返回 false 且不抛，所以这里只是把它如实透出来。
     作为 click 监听时返回值没有任何作用（addEventListener 不看返回值），不影响原行为。 */
  function openSandbox() {
    if (!S.derived || !root.MirrorIntervene || !root.MirrorIntervene.open) return false;
    var d = S.derived;
    return root.MirrorIntervene.open({
      hash: d.hash,
      blockNumber: S.blockNumber,
      label: '#' + d.hash.slice(2, 8).toUpperCase(),
      name: entryName(d),
      params: d.params,
      modules: d.modules
    }) !== false;
  }

  /** 结局由服务端算好放在 card 里。
      以前这里本地跑 Engine.simulate —— 现在浏览器不做这件事了，
      而且 mint 时链上要验的是服务端签名，本地算的值本来也不作数。 */
  function outcomeOf(d) {
    return (d && d.outcome && d.outcome.id) || null;
  }

  /** 引擎里这个 sim 的显示名（fire / openSandbox 两处共用）。
      'Arc 区块 119969013'；没有区块号退回哈希前缀。 */
  function entryName(d) {
    return 'Arc' + (S.blockNumber != null ? ' 区块 ' + S.blockNumber : ' ' + d.hash.slice(0, 10));
  }

  /* 引爆之后这一块要回答新手的三个问题：它变成什么了？这算好还是不好？我还能干嘛？
     所以结局**先给一句人话**，再给下一步（活了→铸造；死了→救救它）。
     铸造的技术说明退到最后，而且合约没部署时也不影响前两问的答案。 */
  function showMint() {
    var box = $('bnbMintBox');
    if (!box) return;
    box.hidden = false;

    var d = S.derived, oid = outcomeOf(d);
    var o = OB();
    var cn = (o && o.outcomeName(oid)) || T(OUTCOME_CN[oid] || '') || oid || T('（算不出来）');
    var line = (o && o.outcomeLine(oid)) || '';
    var alive = oid === 'OBSERVERS_POSSIBLE';
    var idx = OUTCOME_ORDER.indexOf(oid);

    var head = '<div class="bnb-row"><span class="' + (alive ? 'bnb-ok' : 'bnb-warn') + '" ' +
      'style="font-size:15px;font-weight:700">' + esc(alive ? T('活了：') : T('死了：')) + esc(cn) + '</span></div>' +
      (line ? '<div class="bnb-note" style="font-size:13px;color:var(--ink2)">' + esc(line) + '</div>' : '');

    // 死宇宙 83% 能救——这个出口必须就摆在结局旁边，
    // 而不是让新手自己想到去点上面那个"干预沙盒"
    /* 拯救整套下线，「救救它」这个说法跟着下线 —— 但沙盒还在，而且是免费玩法，
       所以这一格照出，只用不带拯救色彩的说法。 */
    var rescue = (!alive && root.MirrorIntervene && root.MirrorIntervene.open)
      ? '<div class="bnb-row"><button type="button" class="bnb-btn save" id="bnbRescue">' +
        esc(T('进调参沙盒')) + '</button>' +
        '<span class="bnb-note">' + esc(T('在沙盒中按提示调整参数；不花费、不上链、可撤销。')) + '</span></div>'
      : '';

    var mintPart;
    var blockedMint = phaseBlock();
    if (blockedMint) {
      /* 放号还没轮到：**一个按钮都不给**，免得人点下去先弹钱包再被 403 打回来。
         这里顺手给出预热页的入口 —— 那页上有倒计时、规则和登记白名单。 */
      mintPart = '<div class="bnb-row"><span class="bnb-warn">' + esc(blockedMint) + '</span></div>' +
        '<div class="bnb-row"><a class="bnb-btn" href="' + WARMUP_URL + '">' + esc(T('看开放时间 · 登记白名单')) + '</a></div>';
    } else if (!C.contract()) {
      mintPart = '<div class="bnb-note">' + esc(TF('（合约还没部署到 {0}，铸造暂时不可用；引爆和干预都不受影响）', chainName())) + '</div>';
    } else if (S.minted) {
      /* S.minted 有两种非零值：**>0** 是链上查到的 tokenId（别人、或你以前铸的），
         **-1** 是"这一次会话里刚刚铸成功"。这里原来只判 >0，于是自己刚收下的那一枚
         （-1）会掉进下面的 else，把「铸造成 NFT」按钮又摆出来一次。
         实测路径：先「不看就收下」→ 再点「引爆」进宇宙 → reveal() 调 showMint()，
         按钮就回来了，点下去会真的再弹一次钱包、发一笔必然 AlreadyBanged 的交易。
         syncMintNow() 和 hudRender() 判的都是真假值，这里跟上它们。 */
      /* 铸完仍能把参数卡图拿走（09-17 用户：「MINT 完毕以后还是能导出参数图片的」）：
         /api/art/<hash>.png?p=1 是服务端渲染的卡面，印着结局与全部常数，已算过的宇宙随时可取。 */
      var artUrl = shareImgUrl({ hash: S.hash });
      var artName = 'universe-' + (S.blockNumber != null ? S.blockNumber : String(S.hash || '').slice(2, 10)) + '.png';
      mintPart = '<div class="bnb-row"><span class="bnb-warn">' +
        esc(S.minted > 0 ? TF('该宇宙已被铸造（宇宙 #{0} · 链上 NFT #{1}）', S.blockNumber != null ? S.blockNumber : '—', S.minted) : T('该宇宙已由你铸造完成。')) +
        '</span><a href="' + MARKET_URL + '">' + esc(S.minted > 0 ? T('到市场查看挂单') : T('到市场查看')) + '</a>' +
        (artUrl ? '<a class="bnb-btn" id="bnbArtDl" href="' + esc(artUrl) + '" download="' + esc(artName) + '" target="_blank" rel="noopener">' + esc(T('下载参数卡图（PNG）')) + '</a>' : '') +
        '</div>';
    } else {
      /* 按钮文案与 HUD 上那颗同一套：免费次数用完就直接标价（paidMintLabel），
         还有免费口就是原话。旁边常驻一行免费次数/价格（#bnbMintPrice），
         链上读数异步到、或换了地址，walletSync() 会按 id 把这两处一起补写。 */
      mintPart = '<div class="bnb-row"><button type="button" class="bnb-btn primary" id="bnbMint">' + esc(paidMintLabel() || T('铸造成 NFT')) + '</button>' +
        '<span id="bnbMintMsg" class="bnb-note"></span></div>' +
        '<div id="bnbMintPrice" class="bnb-note">' + esc(priceLine()) + '</div>' +
        '<div class="bnb-note">' + esc(T('铸造把哈希、结局和一张全链 SVG 写进 NFT。' +
        '结局是你提交的声明值——谁都能拿同一个哈希离线复算来验证。')) + '</div>';
    }

    box.innerHTML = head + rescue + mintPart;

    var rb = $('bnbRescue');
    if (rb) rb.addEventListener('click', openSandbox);
    var btn = $('bnbMint');
    if (btn) {
      if (idx < 0) btn.disabled = true;                       // 结局算不出来就没法声明，别让人白签一次
      else btn.addEventListener('click', function () { mint(idx); });
    }
  }

  function mintMsg(html, cls) {
    var el = $('bnbMintMsg');
    if (el) { el.className = 'bnb-note ' + (cls || ''); el.innerHTML = html; }
  }

  /* 服务端返回的稀有度。合约要的是 0..4 的下标，不是 'S'/'A' 这种名字。 */
  function d2r(d) {
    var r = d && d.rarity && typeof d.rarity.index === 'number' ? d.rarity.index : -1;
    if (r < 0 || r > 4) throw new Error(TF('服务端返回的稀有度不合法：{0}', JSON.stringify(d && d.rarity)));
    return r;
  }

  /* report/btnOf 让同一套铸造流程能被两个入口复用：起爆页的面板，和引爆之后
     压在 3D 画面上的那个按钮。报错去哪儿、禁哪个按钮，由调用方给。 */
  function mint(outcomeIdx, report, btnOf) {
    report = report || mintMsg;
    btnOf = btnOf || function () { return $('bnbMint'); };
    if (S.busy) return;
    /* 放号还没轮到就**一步都不走**：不弹钱包、不去要签名。
       服务端那道闸才是算数的（server/allowlist.js），这里只是别让人白确认一次钱包。 */
    var blockedHere = phaseBlock();
    if (blockedHere) { report(esc(blockedHere), 'bnb-warn'); return; }
    if (!C.hasWallet()) {
      /* 手机浏览器多半没有注入环境：选择器会给「在 Binance App 里打开」的深链；
         桌面端它会说去装扩展。话术不再点名小狐狸 —— 币安钱包同样是正路。 */
      if (root.MirrorWallet && root.MirrorWallet.pick) root.MirrorWallet.pick({ force: true });
      report(esc(T('未检测到钱包扩展。请安装浏览器钱包后重试；移动端可在钱包应用内打开本页。引爆与模拟器不受影响。')), 'bnb-err');
      return;
    }
    S.busy = true;
    var btn = btnOf(); if (btn) btn.disabled = true;
    report(esc(T('正在向服务端要签名…')));

    /* 开始铸造的这一刻对着的是哪个宇宙。等上链要好几十秒，而「给我一个宇宙」
       这些按钮在这期间是活的 —— 用户完全可能已经换了一个在看。
       链上铸成的永远是 hash0，所以"已铸造"这个状态也只能记到 hash0 头上。
       （实测不记的话：换成宇宙 B 之后，B 的按钮 title 变成"你已经收下它了"，
       而 B 从来没被铸过。checkMinted() 里早就有同样的守卫，这里跟上。） */
    var hash0 = S.hash;
    var mintedNow = false;

    /* **签名在这一刻才去取，不在引爆的时候取。** 签名带 deadline（默认 600 秒），
       而人看完一个宇宙再决定收不收，隔十几分钟很正常 —— 引爆时取的名到这里
       多半已经过期，合约报 Expired，用户看到的是一句莫名其妙的失败。
       在按下按钮的这一秒去取，有效期问题就根本不存在。

       另外 outcome 和 rarity **必须用服务端返回的**，不能用页面传进来的 outcomeIdx：
       这两个字段都签进了摘要，差一个 ecrecover 就恢复出别的地址，合约直接 BadSig。 */
    var stamp = null;
    var acct = null;
    /* 模拟和真发必须用**同一份**参数（八个字段全签进摘要，差一个 ecrecover 就
       恢复出别的地址），所以拼参数只允许有这一处。 */
    function txArgs(wei) {
      return {
        blockHash: stamp.card.blockHash,
        blockNumber: stamp.card.blockNumber,
        outcome: stamp.card.outcome.index,
        rarity: d2r(stamp),
        cardHash: stamp.cardHash,
        deadline: stamp.deadline,
        /* free 是服务端签进摘要的那个标志（走不走免费额度）。**原样转发，不许自己决定** ——
           改一位 ecrecover 就恢复出别的地址，合约当场 BadSig。
           它同时决定 msg.value：free=true 必须正好 0，free=false 必须正好 price。 */
        free: stamp.free === true,
        sig: stamp.sig,
        payWithBang: false,
        valueWei: wei
      };
    }
    /* 这一笔该付多少。**跟着 stamp.free 走**，不再去链上猜：
       服务端签的是免费就必须 0，签的是付费就必须一口价。
       老服务端不回 free 字段时才退回原来那条「问链上还给不给免费」的路。 */
    function valueForStamp() {
      if (stamp.free === true) return Promise.resolve(0n);
      if (stamp.free === false) return C.price();
      return C.mintValueFor(acct, d2r(stamp));
    }
    var refAddr = refStored();
    Promise.resolve(null).then(function () {
      /* 推广留痕：ref 要随 /api/bang 一起交，
         而服务端按 minter 绑定，所以还得知道钱包地址。eth_accounts 不弹窗；
         只有「被邀请而来、这台浏览器从没连过钱包」这一种情况才把连接提前 ——
         那次连接本来就是铸造流程的一步，下面的 C.connect() 会复用结果，不弹第二次。
         签名即将绑 msg.sender：已连钱包时把 minter 一并带上（小写 0x 40 hex）；
         未连则不加该字段。现役服务端忽略多余字段。 */
      /* v2 签名绑 msg.sender（服务端 SIG_V2=1 时没有 minter 直接 400）：所以铸造前**必须**先连上钱包，
         不再有「没连钱包也先去要签名」这条路 —— 2026-09-18 上线第一枚就撞上「v2 签名必须带铸造人地址」。 */
      return C.account().then(function (a) {
        if (a) return a;
        return C.connect();
      });
    }).then(function (acct) {
      var extra = {};
      var m = minterOf(acct);
      if (!m) throw new Error(T('要铸造得先连接钱包（签名会绑定你的地址）'));
      extra.minter = m;
      if (refAddr && m && refAddr !== m) extra.ref = refAddr;
      return API.bang(hash0, extra.minter || extra.ref ? extra : null);
    }).then(function (d) {
      if (!d || !d.sig || !d.cardHash) throw new Error(T('服务端没给出签名'));
      /* 逐个字段点名检查。全都要签进摘要，缺一个 ecrecover 就恢复出别的地址。
         不做这一步的话，null 会一路走到 BigInt(null)，抛出的是
         "Cannot convert null to a BigInt" —— 看不出是哪个字段没给，
         而这正是服务端缓存把 blockNumber 抹成 null 时的表现。 */
      var need = {
        'card.blockHash': d.card && d.card.blockHash,
        'card.blockNumber': d.card && d.card.blockNumber,
        'card.outcome.index': d.card && d.card.outcome && d.card.outcome.index,
        'rarity.index': d.rarity && d.rarity.index,
        'deadline': d.deadline
      };
      for (var k in need) {
        if (need[k] === null || need[k] === undefined) {
          throw new Error(TF('服务端返回的 {0} 是空的，签名没法用。刷新页面重试；一直这样就是服务端的问题。', k));
        }
      }
      /* 签回来的必须是**按下按钮那一刻的宇宙**（hash0）。等上链的几十秒里
         「给我一个宇宙」是活的，S.hash 随时会换 —— 上面取签名已经改成按 hash0 要，
         这里照拯救路径（intervene.js mintRescueGo）的先例再上一道硬校验：
         对不上就停，一笔不发（结局下标碰巧相同时后面那道一致性检查拦不住）。 */
      if (String(d.card.blockHash).toLowerCase() !== String(hash0).toLowerCase()) {
        throw new Error(T('服务端签的是另一个区块哈希，和你按下铸造时的宇宙对不上 —— 交易没发出去，重新打开那个宇宙再铸。'));
      }
      /* 页面上那个结局来自 API.card()，这里的来自 API.bang() —— 同一个服务端、
         同一个哈希，正常必然相同。不同只可能是中途推导版本变了，
         那就意味着即将铸下去的是一个**用户没看过的宇宙**。宁可停下让人重看一眼。 */
      if (outcomeIdx >= 0 && d.card.outcome.index !== outcomeIdx) {
        throw new Error(T('服务端算出的结局和页面上显示的不一致，可能是推导版本刚更新了。刷新页面重看一次再铸。'));
      }
      stamp = d;
      /* 广播要用的现场（区块号/结局）在这一刻就存住：等上链要几十秒，期间用户可能
         已经换了一个宇宙在看，到时候再读 S.* 就是别人的了。 */
      SHARED[hash0] = {
        kind: 'native', hash: hash0, no: d.card.blockNumber,
        oid: (d.card.outcome && d.card.outcome.id) || null
      };
      return C.connect();
    }).then(function (from) {
      acct = from;
      return valueForStamp();
    }).then(function (wei) {
      /* 发交易前用**同一个 from/value/calldata** 先 eth_call 模拟一遍（拯救路径
         mintRescueGo 的先例）：报价和上链之间不是原子的 —— 最后一枚全局免费、
         或这个地址第 10 次免费，并发下 msg.value==0 会撞 WrongPrice，而那时用户
         已经在钱包里确认过了。模拟失败就重报一次价再模拟；仍失败就报错停下 ——
         钱包一次都不弹、一分 gas 不花。 */
      return C.simulateBangSigned(txArgs(wei), acct).then(function () { return wei; }, function () {
        return valueForStamp().then(function (wei2) {
          return C.simulateBangSigned(txArgs(wei2), acct).then(function () { return wei2; }, function (e2) {
            var er = new Error(TF('模拟铸造被链上回滚（真发也必败，交易没有发出去）：{0}', (e2 && e2.message) || e2));
            er.rpcData = e2 && e2.rpcData;   // WrongPrice 的选择器在 revert data 里，下面的人话翻译要靠它
            throw er;
          });
        });
      });
    }).then(function (wei) {
      report(String(wei) === '0'
        ? esc(T('确认交易：免费期，只花 gas'))
        : TX('确认交易：{0} {1}', C.fmtBNB(wei), chainCur()));
      return C.bangSigned(txArgs(wei));
    }).then(function (tx) {
      report(esc(T('已发出，等待上链…')) + ' <a href="' + C.CHAIN.explorer + '/tx/' + tx + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + esc(T('看交易')) + '</a>');
      return C.waitTx(tx).then(function (r) {
        if (r && String(r.status) === '0x1') {
          // 刚收下的那一刻正是最想去看看它的时候，所以这里同时给交易和市场两个出口。
          // report 是调用方给的：面板与 3D 上的 HUD 共用这一条，改一处两边都变
          var same = S.hash === hash0;
          mintedNow = same;
          /* 刚铸完是广播意愿最高的一刻，
             所以「广播这枚」就长在成功提示里。走 data-bnbshare 委托：这行字
             随时会被 innerHTML 重写，直接绑监听器活不过下一次重写。 */
          report(esc(same ? T('铸造成功！') : T('刚才那个宇宙铸造成功了（你现在看的已经是另一个了）　')) +
            '<a href="' + C.CHAIN.explorer + '/tx/' + tx + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + esc(T('看交易')) + '</a>' +
            ' · <a href="' + MARKET_URL + '">' + esc(T('到市场查看')) + '</a>' +
            ' · <button type="button" class="bnb-share-inline" data-bnbshare="' + esc(hash0) + '">' +
            esc(T('广播这枚')) + '</button>', 'bnb-ok');
          if (same) {
            S.minted = -1;                     // 标记已铸造，三个入口都会据此变成"已铸造"
            syncMintNow();                     // 「不看就收下」也要跟着灰掉，别让人再签一次必失败的交易
          }
          /* 这一笔刚把免费计数（可能还有全局免费余量）用掉一格：立刻现读链上刷新，
             别让按钮还挂着「免费」、钱包弹出来却要钱（展示和真报价打架）。 */
          refreshFreeStatus();
          loadPrices();
          loadGallery();
        } else {
          /* 签名路能回滚的原因不止一种，笼统说"被抢先"会把人引到错的方向去查。
             最常见的三个：哈希已被引爆（tokenOfHash 非零）、签名过期（deadline 到了，
             但我们在按钮里现取，正常不会撞上）、msg.value 和合约算的价对不上。 */
          report(esc(T('交易被回滚了。常见原因：这个哈希已经被引爆过、签名过期、或者付款金额和合约要的对不上。')) +
            '<a href="' + C.CHAIN.explorer + '/tx/' + tx + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' + esc(T('看交易详情')) + '</a>', 'bnb-err');
        }
      });
    }).catch(function (e) {
      var m = (e && e.message) ? e.message : String(e);
      if (e && e.code === 4001) m = T('你在钱包里取消了');
      /* 429 是"服务端这一刻不肯签名"，和链上失败完全是两回事。
         笼统写成"铸造失败：引爆太频繁了"会让人以为交易发出去又挂了 ——
         其实钱包里什么都没动过，等额度回来再点一次就行。 */
      if (e && e.status === 429) {
        m = TF('服务端这一刻被限速，签不出名，所以交易根本没发出去 —— '
          + '几秒后再点一次这个按钮就行（钱包里什么都没动）。原话：{0}', m);
      }
      /* WrongPrice（选择器 0xf7760f25）多半死在钱包的 gas 预估阶段 —— 交易没发出去，
         一分 gas 没花。裸给一串 revert 数据没人看得懂，翻成人话：报价和合约算的对不上，
         典型是免费次数**刚好在这一刻**被用完（或 owner 调了价），重报一次价就好。
         错误对象各钱包长得不一样（message / data / originalError），整个序列化了再找。 */
      var raw = m + ' ' + (function () { try { return JSON.stringify(e); } catch (_) { return ''; } })();
      if (/WrongPrice|0xf7760f25/i.test(raw)) {
        m = T('付款金额和合约要的对不上（WrongPrice）—— 多半是免费次数刚用完或价格刚调整。'
          + '交易没有发出去，刷新页面按最新报价再试一次就行。');
      }
      report(TF('铸造失败：{0}', esc(m)), 'bnb-err');
    }).then(function () {
      S.busy = false;
      /* **只有没铸成才把按钮放回去。** 原来这一句是无条件的，而成功那一支刚刚才让
         syncMintNow() 把按钮灰掉 —— 它排在后面，等于又把"已经收下了"的锁打开。
         实测：铸造成功之后「不看就收下」仍然 disabled=false，再点一次会真的弹钱包、
         真的发出第二笔交易，而那一笔在链上必然 AlreadyBanged。 */
      var b = btnOf(); if (b && !mintedNow) b.disabled = false;
    });
  }

  /* ============================================================ 引爆之后的铸造入口
     起爆页那块面板一进 3D 就看不见了，而"看完这个宇宙才决定要不要收"恰恰是最自然的时机。
     所以在 space / mirror 状态下压一个按钮在画面上。

     一个必须守住的边界：**干预过的宇宙不给铸**。合约里 outcome 是声明值，
     它之所以可信是因为"任何人拿这个哈希离线复算都能验"；干预后的参数已经不是
     哈希派生出来的了，拿改好的结局去铸原哈希等于撒谎。所以这种情况只显示一句说明。 */
  var HUD = { el: null, lastKey: '' };

  function hudMount() {
    var el = doc.createElement('div');
    el.id = 'bnbMintHud';
    el.hidden = true;
    doc.body.appendChild(el);
    HUD.el = el;
    hudBadgeMount();     // 分析面板开着时把这张卡收成徽标（见下）
    setInterval(hudSync, 500);
  }

  function hudMsg(html, cls) {
    var m = $('bnbHudMsg');
    if (m) { m.className = 'hud-msg ' + (cls || ''); m.innerHTML = html; }
  }

  /* 确认屏（#pageConfirm）：只往里挂一次氛围层（能量核），别的什么都不加。
     原来这里的 confirmInfo() 会塞一条上下文（结局名/维数/哈希/区块 + 一句提示）——
 把它整个撤了：确认屏只留「引爆」「取消」两个交互件，
     数在上一屏都看过了。ci-* 那族类名只归那块信息用（全文件唯一用途），随它一起退场。 */
  function confirmMount() {
    var page = doc.getElementById('pageConfirm');
    if (!page || doc.getElementById('bnbCore')) return;
    var core = doc.createElement('div');
    core.id = 'bnbCore';
    core.setAttribute('aria-hidden', 'true');
    core.innerHTML = '<i class="core-ring"></i><i class="core-ring r2"></i>'
      + '<i class="core-glow"></i><i class="core-heart"></i>';
    page.insertBefore(core, page.firstChild);
  }

  function hudSync() {
    if (!HUD.el) return;
    App = App || root.MirrorApp;
    var st = (App && App.state && App.state.state) || 'select';
    var entry = App && App.state && App.state.entry;
    var inSpace = (st === 'space' || st === 'mirror');
    if (!inSpace || !entry || !S.derived) { hudHide(); return; }

    var id = String(entry.id || '');
    var intervened = id.indexOf('fix-') === 0;
    var mine = intervened || id === 'bnb-' + S.derived.hash.slice(2, 10);
    if (!mine) { hudHide(); return; }              // 别人的宇宙（比如从收藏里放的），不认

    relabel(intervened);
    if (!intervened) reveal();

    // 状态没变就别重画，否则每 500ms 把用户正在点的按钮换掉
    var key = st + '|' + id + '|' + intervened + '|' + S.minted + '|' + (C.contract() ? 1 : 0);
    if (key !== HUD.lastKey) {
      HUD.lastKey = key;
      HUD.el.hidden = false;
      hudRender(intervened);
    }
    hudPlace();     // 镜像里信息面板会随层级长高/变矮，所以每次同步都量一遍
    hudMinSync();   // 分析面板开着的话保持收起（卡片刚被重显时要补 .hud-away）
  }

  /* 编号撞车：引擎给的 idLabel（#0001）是**本机第几次引爆**的流水号，存在 localStorage 里；
     链上 NFT 的编号是 tokenId（现在只到 #1）。两个 # 数字摆在一起，没人分得清。
     引擎不能改，但显示可以：进了宇宙就把这个 sim 的显示名换成区块号 —— 顶部 HUD、
     镜像信息面板、分析报告读的都是同一个字段，换一次全都对上。 */
  function labelOf(intervened) {
    var t = S.blockNumber != null ? TF('区块 {0}', S.blockNumber) : S.derived.hash.slice(0, 10);
    // 干预过的必须说清楚：它的参数已经不是这个区块派生出来的了
    return intervened ? t + T(' · 已干预') : t;
  }

  function relabel(intervened) {
    var sim = App && App.state && App.state.sim;
    if (!sim || sim.bnbLabel) return;               // 每个 sim 只换一次
    var txt = labelOf(intervened);
    sim.bnbLabel = txt;
    sim.idLabel = txt;
    // 顶部那一行在进入 3D 的瞬间就渲染好了，改字段追不回来，补一次 DOM
    var el = $('hTid') || doc.querySelector('#hudTop b');
    if (el) el.textContent = txt;
  }

  /* 引爆之后再切语言：卡片标题「宇宙 #N」/「区块 N」、顶部 HUD 那一条、卡片正文都是当场用
     TF()/T() 拼出来的（带插值数字，i18n 的 applyStatic 整句命中不了），字符串落地后不跟语言走。
     这里按原式重拼一遍 —— labelOf() / hudRender() 都是纯渲染，不重算宇宙、不碰链上状态。
     relabel() 有「每个 sim 只换一次」的闸（防 hudSync 每 500 ms 重复改名），切语言要绕过它，
     所以这里直接写字段，不调 relabel()。 */
  doc.addEventListener('mirror:lang', function () {
    try {
      App = App || root.MirrorApp;
      var sim = App && App.state && App.state.sim;
      var entry = App && App.state && App.state.entry;
      if (sim && entry && S.derived) {
        var txt = labelOf(String(entry.id || '').indexOf('fix-') === 0);
        sim.bnbLabel = txt; sim.idLabel = txt;
        var el = $('hTid') || doc.querySelector('#hudTop b');
        if (el) el.textContent = txt;
      }
      HUD.lastKey = '';                                   // 逼下一次 hudSync 把卡片正文重画一遍
    } catch (e) { console.warn('[bnb-ui] 切语言重刷失败', e); }
  });

  /** 真的进了宇宙，才把结局写进起爆页那块面板（见 fire() 里的说明） */
  function reveal() {
    if (S.revealed) return;
    S.revealed = true;
    /* 引爆计分就记在这一刻：卡拿到了、宇宙也真进去了。
       记在 setHash 那里会把「贴了个哈希看看参数」也算成一次引爆。 */
    alBangTick(W.addr, S.hash);
    showMint();
  }

  /* 卡片摆哪儿不能拍脑袋写死：space 状态右侧是 3D 的按钮列（#hudSide，矮屏会变成两列、更宽），
     mirror 状态右上角整块被信息面板（.mb-info）占着（实测 1038×990 下卡片 148×114 完全压在
     面板上）。这两个尺寸都随视口和层级变，所以按真实矩形算落点：
       · 上方的东西（时间线条带、镜像信息面板）→ 往下让
       · 右侧那条按钮列 → 往左让（它竖着占满整屏，往下让没用） */
  function rectOf(el) {
    if (!el || el.hidden) return null;
    var r = el.getBoundingClientRect();
    return (r.width > 1 && r.height > 1) ? r : null;
  }

  function hudPlace() {
    var el = HUD.el;
    if (!el || el.hidden) return;
    var top = 114, right = 14, r;
    r = rectOf($('tlStrip'));                       if (r) top = Math.max(top, Math.round(r.bottom) + 10);
    r = rectOf(doc.querySelector('#mirrorUI .mb-info')); if (r) top = Math.max(top, Math.round(r.bottom) + 10);
    /* 3D 的降级警告（.u3d-warn，"正在用 CPU 计算…重试 WebGPU"）：桌面宽度下它在顶部居中、
       114 就躲开了；但 375 宽时它会长到 150 高，而我的卡片 z-index 更高，会把带按钮的
       警告整块盖住 —— 那是用户此刻最该看见的东西 */
    r = rectOf(doc.querySelector('.u3d-warn'));     if (r) top = Math.max(top, Math.round(r.bottom) + 10);
    r = rectOf($('hudSide'));                       if (r) right = Math.max(right, Math.round(root.innerWidth - r.left) + 12);
    // 上面的东西太高时（矮屏 + 展开的镜像面板）别把卡片顶到屏幕外去：宁可贴着底
    top = Math.min(top, Math.max(114, root.innerHeight - 180));
    if (el.style.top !== top + 'px') el.style.top = top + 'px';
    if (el.style.right !== right + 'px') el.style.right = right + 'px';
  }

  function hudHide() {
    if (HUD.el && !HUD.el.hidden) { HUD.el.hidden = true; HUD.lastKey = ''; hudMinSync(); }
  }

  /* ============================================================ 给分析面板让路
     开合信号：app.js 不派事件，但 openAnalysis/closeAnalysis 都只拨 #analysis 的 hidden，
     MutationObserver 盯这个属性就等于订阅了开关 —— app.js / intervene.js 一个字不用改。
     （intervene.js 的沙盒是全屏遮罩 dialog，开着时人机都到不了 HUD，不归这里管。） */
  var AN = { open: false, expand: false, badge: null, last: '' };

  function hudBadgeMount() {
    var b = doc.createElement('button');
    b.type = 'button';
    b.id = 'bnbHudBadge';
    b.hidden = true;
    b.setAttribute('aria-controls', 'bnbMintHud');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<span class="hb-dot"></span><span id="bnbHudBadgeTxt"></span>';
    b.addEventListener('click', function () { AN.expand = !AN.expand; hudMinSync(); });
    doc.body.appendChild(b);
    AN.badge = b;
    var p = doc.getElementById('analysis');
    if (p && root.MutationObserver) {
      AN.open = !p.hidden;
      new MutationObserver(function () {
        var open = !p.hidden;
        if (open === AN.open) return;
        AN.open = open;
        if (!open) AN.expand = false;          // 关面板 = 复原；上次点开过也不记
        hudMinSync();
      }).observe(p, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  /* 分析面板（ui/app.js 写 #anBody）页脚：开源推导引擎。app.js 一个字不改，
     盯 childList —— openAnalysis 每次 innerHTML 重写都会把旧节点冲掉。 */
  var ENGINE_SRC = 'https://github.com/q3579338/arcbang/tree/main/engine';
  function paintEngineNote() {
    var body = doc.getElementById('anBody');
    if (!body || !body.firstChild) return;
    var html = '<a href="' + ENGINE_SRC + '" target="_blank" rel="noopener noreferrer">'
      + esc(T('推导代码开源，可以自己算：github.com/q3579338/arcbang'))
      + '</a>';
    var el = doc.getElementById('bnbEngineSrc');
    if (el) {
      if (el.innerHTML !== html) el.innerHTML = html;
      return;
    }
    el = doc.createElement('p');
    el.id = 'bnbEngineSrc';
    el.className = 'rp-text';
    el.innerHTML = html;
    body.appendChild(el);
  }
  function wireAnalysisEngineNote() {
    var body = doc.getElementById('anBody');
    if (body && root.MutationObserver) {
      var ticking = false;
      new MutationObserver(function () {
        if (ticking) return;
        ticking = true;
        root.setTimeout(function () { ticking = false; paintEngineNote(); }, 0);
      }).observe(body, { childList: true });
    }
    doc.addEventListener('mirror:lang', paintEngineNote);
    paintEngineNote();
  }

  /* 收/放的唯一同步点：卡片挂/摘 .hud-away，徽标显隐 + aria-expanded。
     hudSync 每 500ms 也会来一趟（卡片可能刚被显示/隐藏），所以先比状态串，
     没变就一个属性都不碰 —— 别每 500ms 重写 title，打断正悬停看提示的人。 */
  function hudMinSync() {
    var away = AN.open && !AN.expand;
    var show = !!(AN.open && HUD.el && !HUD.el.hidden);
    var key = away + '|' + show + '|' + AN.expand;
    if (key === AN.last) return;
    AN.last = key;
    if (HUD.el) HUD.el.classList.toggle('hud-away', away);
    var b = AN.badge;
    if (!b) return;
    b.hidden = !show;
    b.setAttribute('aria-expanded', AN.expand ? 'true' : 'false');
    var t = $('bnbHudBadgeTxt');
    if (t) t.textContent = T('收下');
    b.title = AN.expand ? T('收起铸造卡片') : T('展开铸造卡片');
    b.setAttribute('aria-label', b.title);
  }

  /* HUD 副标题上"这是哪个宇宙"。
     原来这里写的是哈希前 10 位，而**同一屏顶上**那条（relabel() 写的）写的是「区块 119969013」
     —— 一个宇宙、一屏里两个互相对不上的身份，实测就是这样。这里跟顶上那条统一。
     区块号读不到时才退回哈希前缀（粘哈希那条路正常会带上高度，兜底是防万一）。 */
  function hudWhich(d) {
    return S.blockNumber != null ? TF('宇宙 {0}', uniNo(S.blockNumber)) : d.hash.slice(0, 10) + '…';
  }

  function hudRender(intervened) {
    var d = S.derived;
    if (intervened) {
      /* 整段（含 <b>/<br> 标记）作为**一条**词条走 T()（i18n-app.js / i18n-arc.js）。
         拯救整套下线，改过的参数在这个站上**没有**上链的路。 */
      var iv = T('沙盒里推出来的参数不上链，也铸不了 —— 它已经不是这个哈希派生出来的宇宙了。<br>想收下这个区块，回起爆页铸<b>原始宇宙</b>。');
      HUD.el.innerHTML = '<div class="hud-title">' + esc(T('调参后的宇宙')) + '</div>' +
        '<div class="hud-msg">' + iv + '</div>';
      return;
    }
    /* 「广播这个宇宙」在三种状态下都给（2026-09-18 用户：「引爆以后没有广播啊」）——
       预热期的「引爆并广播」任务靠它记分，而那时合约往往还没部署、也还没铸。走 data-bnbshare 委托。 */
    if (!C.contract()) {
      HUD.el.innerHTML = '<div class="hud-title">' + esc(hudWhich(d)) + '</div>' +
        '<div class="hud-msg">' + esc(T('合约还没部署，暂时不能铸造。')) + '</div>' +
      '<div class="hud-msg"><button type="button" class="bnb-share-inline" data-bnbshare="' + esc(S.hash || '') + '">' + esc(T('广播这个宇宙')) + '</button></div>';
      return;
    }
    if (S.minted) {
      HUD.el.innerHTML = '<div class="hud-title">' + esc(T('该宇宙已被铸造')) + '</div>' +
        '<div class="hud-msg">' + (S.minted > 0 ? esc(TF('宇宙 #{0}（链上 NFT #{1}）', S.blockNumber != null ? S.blockNumber : '—', S.minted)) : esc(T('刚刚铸造成功'))) +
        ' · <a href="' + MARKET_URL + '">' + esc(T('到市场查看')) + '</a></div>' +
      '<div class="hud-msg"><button type="button" class="bnb-share-inline" data-bnbshare="' + esc(S.hash || '') + '">' + esc(T('广播这个宇宙')) + '</button></div>';
      return;
    }
    var oid = outcomeOf(d), idx = OUTCOME_ORDER.indexOf(oid);
    var cn = (OB() && OB().outcomeName && OB().outcomeName(oid)) || T(OUTCOME_CN[oid] || '') || oid;
    /* 拯救系统整套下线，「救救它 / 调教它」是它的话术，3D 画面里那颗钮不出。
       沙盒本身还在（免费、不上链），入口留在起爆面板上那颗「调参沙盒」。 */
    HUD.el.innerHTML = '<div class="hud-title">' + esc(cn) + '</div>' +
      '<div class="hud-sub">' + esc(hudWhich(d)) + '</div>' +
      /* 免费期/价格那行原来在右上角钱包条上 —— 钱包收进顶栏 chip 之后挪到这里：
         这里本来就是铸造信息面板，价格该跟铸造按钮站在一起。
         内容是异步到的（freeLeft / price / freeStatus），walletSync() 会按 id 直接补写。 */
      '<div id="bnbHudPrice" class="hud-msg">' + esc(priceLine()) + '</div>' +
      /* 免费次数用完时按钮直接标价（「1 USDC 铸造」）：
         点之前就知道这一下要花多少，而不是钱包弹出来才发现要收钱。 */
      (idx < 0 ? '<div class="hud-msg bnb-err">' + esc(T('这个结局算不出来，铸不了')) + '</div>'
               : '<button type="button" id="bnbHudMint" class="hud-btn">' + esc(paidMintLabel() || T('把这个宇宙收下')) + '</button>') +
      '<div id="bnbHudMsg" class="hud-msg"></div>' +
      '<div class="hud-msg"><button type="button" class="bnb-share-inline" data-bnbshare="' + esc(S.hash || '') + '">' + esc(T('广播这个宇宙')) + '</button></div>';
    var b = $('bnbHudMint');
    if (b) b.addEventListener('click', function () {
      mint(idx, hudMsg, function () { return $('bnbHudMint'); });
    });
  }

  /* ============================================================ 右上角钱包 */
  /* free    = freeLeft()：免费期还剩几枚
     fc      = freeStatus(addr)：免费口计数 { supported, used, cap }。
               supported=false 表示链上还是旧合约（没有 freeMintCount/freePerAddr
               这两个 getter，读了就 revert）—— 那就藏起计数行、回退 usedFree 的旧行为
     usedFree= usedFree(addr)：旧合约的一次性名额，只当 fc.supported=false 的退路
     price   = price()：v5 一口价（免费次数用完后每枚收这个数，不分档）
     原来这里还有个 band = priceBnb[0..4] 的区间 —— 那是 v4 的分档价，
     v5 字节码里没有 priceBnb，读了一律 revert，随 mintValueFor 一起清掉了。 */
  var W = { el: null, chip: null, addr: null, free: null, fc: null, usedFree: null, price: null };

  function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }

  /* 钱包 provider 与 arc-chain.js 的 eth() 同一个口径：多钱包发现（wallet.js）
     选中的那个优先，退回 window.ethereum。断开/切换要对**同一个** provider 说话，
     不然连的是币安钱包、撤的却是小狐狸。 */
  function provider() {
    return (root.MirrorWallet && root.MirrorWallet.provider()) || root.ethereum || null;
  }

  /* accountsChanged / chainChanged 必须听**选中的那个 provider**（上面 provider()
     的口径），不是 root.ethereum：交易走币安钱包时监听却挂在小狐狸上 ——
     币安换账户界面纹丝不动（免费次数一直显示旧地址的），小狐狸换账户反而来改
     价格行。换 provider（选择器换钱包、6963 公告顶掉老壳）时把监听迁过去，
     旧的拆干净 —— 不拆的话两个钱包都在改 W.addr，最后写的算谁的全看运气。 */
  var EVP = null;                     // 现在挂着监听的那个 provider
  function onAccountsChanged(a) { W.addr = (a && a[0]) || null; walletSync(); refreshFreeStatus(); }
  function onChainChanged() { walletSync(); }
  function bindWalletEvents() {
    var p = provider();
    if (p === EVP) return;
    if (EVP && typeof EVP.removeListener === 'function') {
      try { EVP.removeListener('accountsChanged', onAccountsChanged); } catch (e) { /* 有的钱包没实现 */ }
      try { EVP.removeListener('chainChanged', onChainChanged); } catch (e) { /* ignore */ }
    }
    EVP = null;
    if (p && typeof p.on === 'function') {
      try {
        p.on('accountsChanged', onAccountsChanged);
        p.on('chainChanged', onChainChanged);
        EVP = p;
      } catch (e) { EVP = null; }
    }
  }

  /* 钱包显示更新的唯一入口：顶栏 chip（nav.js 的壳）在就叫它重画，
     不在（无顶栏的退路）就画浮空条；铸造 HUD / 结局面板上那行价格也在这里跟着刷。
     两颗铸造按钮的文案也在这里补：链上读数都是异步到的，按钮画出来的那一刻
     多半还不知道免费次数用没用完 —— 数一到就把「把这个宇宙收下」换成带价的那句。 */
  function walletSync() {
    if (W.chip) W.chip.refresh();
    else walletRender();
    var line = priceLine();
    var pl = $('bnbHudPrice');
    if (pl) pl.textContent = line;
    var pl2 = $('bnbMintPrice');
    if (pl2) pl2.textContent = line;
    var lbl = paidMintLabel();
    var b1 = $('bnbHudMint');
    if (b1) b1.textContent = lbl || T('把这个宇宙收下');
    var b2 = $('bnbMint');
    if (b2) b2.textContent = lbl || T('铸造成 NFT');
  }

  /* 价格文案要说的三件事全部现取，一个都不写死（owner 可以调价，写死早晚说谎）。
     取不到就一个字都不说 —— 和以前"合约没配就不显示价格"一样，绝不猜一个数出来。

     合约没配时必须**先挡住**：链上读走的 call() 里那句 needContract() 是**同步 throw**
     的，不是 reject，所以 .catch 接不住 —— 它会一路窜出 walletMount()，把排在它后面的
     hudMount() 和 loadGallery() 一起带走。syncMintNow()/loadGallery() 早就是这么挡的。 */
  function loadPrices() {
    if (!C.contract()) return;
    C.freeLeft().then(function (n) { W.free = n; walletSync(); }, function () { });
    /* v5 一口价 + 每枚奖励。原来这里问的是 priceBnb[0..4] 的区间 —— v4 的函数，
       v5 字节码里没有，五个 eth_call 全 revert，价格那行从来没显示出来过。 */
    C.price().then(function (v) { W.price = v; walletSync(); }, function () { });
  }

  /** 免费次数是**按地址记的**，所以换了地址必须重问一遍。
      新合约走 freeStatus（freeMintCount / freePerAddr，每地址 10 次）；
      现网那版旧合约没有这两个 getter（freeStatus 吞掉 revert 返回 supported:false），
      回退 usedFree 的一次性判定 —— 计数行不显示，但免费/付费的判断照旧成立。 */
  function refreshFreeStatus() {
    /* 换了地址，「在不在名单、是哪一层」也跟着变 —— 免费计数和放号资格是一对，
       只刷一半的话按钮会按上一个地址的资格显示。 */
    if ((W.addr || null) !== PH.addr) phaseLoad();
    if (!W.addr || !C.contract()) { W.fc = null; W.usedFree = null; walletSync(); return; }
    var a = W.addr;
    C.freeStatus(a).then(function (st) {
      if (W.addr !== a) return;                             // 问的过程中又换了地址就作废
      W.fc = st;
      if (st.supported) { W.usedFree = null; walletSync(); return; }
      C.usedFree(a).then(function (u) {
        if (W.addr === a) { W.usedFree = u; walletSync(); }
      }, function () { });
      walletSync();
    }, function () { });
  }

  function walletMount() {
    /* 有统一顶栏（且壳在）就用 nav.js 的钱包 chip —— 市场页那套观感，用户点名要的：
       渐变头像 + 短地址，浮层里完整地址 / 复制 / 浏览器 / 切换账户 / 断开。
       没有（离线单文件版 dist/mirror.html 不带本文件；万一 nav 挂载失败也算）
       才退回右上角浮着的 #bnbWallet —— **这条退路不能删**，
       没顶栏时它是唯一的连接入口。 */
    if (doc.querySelector('#siteNav .topbtns') && root.MirrorNav && root.MirrorNav.walletChip) {
      chipMount();
    } else {
      var el = doc.createElement('div');
      el.id = 'bnbWallet';
      doc.body.appendChild(el);
      W.el = el;
      walletRender();
      // 只在起爆页/确认页露脸：进了宇宙就别挡着 HUD（顶栏 chip 没这个问题，它不压画面）
      setInterval(function () {
        var st = (root.MirrorApp && root.MirrorApp.state && root.MirrorApp.state.state) || 'select';
        W.el.hidden = !(st === 'select' || st === 'confirm');
      }, 400);
    }

    bindWalletEvents();
    /* 列表/选择一变（6963 公告到得晚、选择器换了钱包、断开忘记）就把监听迁过去 */
    if (root.MirrorWallet && root.MirrorWallet.onChange) root.MirrorWallet.onChange(bindWalletEvents);
    // 已经授权过的话，静默恢复地址（不弹窗）
    C.account().then(function (a) { if (a) { W.addr = a; walletSync(); refreshFreeStatus(); } phaseLoad(); });
    loadPrices();                    // 原来这里问的是 C.price()，见 priceLine 处的说明
    /* 放号阶段先问一次（不依赖钱包：warmup 段谁都铸不了），连上钱包后 refreshFreeStatus
       会再问一次带地址的 —— 那一次才知道这个地址在不在名单、是哪一层。 */
    phaseLoad();
  }

  /* 顶栏 chip 的适配器：壳只管画（UI 四页同一份），行为在这里 ——
     全部包着 MirrorChain / provider() 转。W.addr 的更新路径必须保持畅通：
     免费名额（usedFree）按地址问，HUD 上那行价格靠它。 */
  function chipMount() {
    W.chip = root.MirrorNav.walletChip({
      account: function () { return W.addr; },
      connect: function () {
        /* 连接前先过一遍钱包选择器（web/wallet.js 的 pick）：≥2 个钱包一定弹
           （记住的那个只高亮、不静默直连）；只装一个的一次都看不到（零回归）；
           一个都没装时它负责说明 —— 手机端给「在 Binance App 里打开」的深链，桌面端说去装扩展。 */
        var MW = root.MirrorWallet;
        var pre = (MW && MW.pick) ? MW.pick() : Promise.resolve(null);
        return pre.then(function (sel) {
          if (sel === false) return null;                    // 用户自己关掉了选择器：不是错误
          if (sel === null && !C.hasWallet()) return null;   // 没钱包：面板已经把出路说了
          /* C.connect() 里带 ensureChain（不在 config.js 指定的那条链上就请求切换/添加） */
          return C.connect().then(function (a) { W.addr = a; refreshFreeStatus(); return a; });
        });
      },
      disconnect: function () {
        var p = provider();
        W.addr = null;
        W.fc = null;
        W.usedFree = null;
        walletSync();
        /* 网页没法真的"挂断"钱包 —— 能撤就撤（wallet_revokePermissions），
           撤不掉就把「授权还在」这句话交给壳摆进浮层，明说。 */
        if (p && p.request) {
          return p.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
            .then(function () { }, function () {
              return T('本页已断开。钱包里的授权还在 —— 要彻底移除请到钱包扩展的「已连接的网站」');
            });
        }
      },
      switchAccount: function () {
        var p = provider();
        if (!p || !p.request) return Promise.reject(new Error(T('没有检测到钱包扩展（MetaMask / 币安钱包 等）')));
        /* wallet_requestPermissions 才会让钱包重新弹账户选择；
           4001 = 用户点了取消，**不能**退回 eth_requestAccounts（它不弹窗、
           立刻还你原账户，页面就会把「没换」说成「已切」—— 市场页踩过）。
           只有钱包压根不支持这个方法才退回。 */
        return p.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
          .then(
            function () { return p.request({ method: 'eth_accounts' }); },
            function (er) {
              if (er && er.code === 4001) throw new Error(T('取消了切换账户 —— 账户没变'));
              return p.request({ method: 'eth_requestAccounts' });
            }
          )
          .then(function (a) { W.addr = (a && a[0]) || null; refreshFreeStatus(); });
      },
      explorer: function () { return W.addr ? C.CHAIN.explorer + '/address/' + W.addr : ''; },
      onChange: function () { /* 本文件的账户变更都从 walletSync() 过，它直接调 chip.refresh() */ }
    });
  }

  /* 免费次数用完（或免费期整个结束）之后铸造按钮该写什么。
     一口价（price()，不按稀有度分档），所以能在点之前就给出确数：「1 USDC 铸造」。
     价格现读链上（owner 能调 price，写死早晚说谎），没读到就返回 null，调用方保持原文案。
     还有免费次数（或还不知道）时也返回 null —— 免费口的按钮不标价。 */
  /** 公售价现在公不公布（服务端 ARCBANG_SHOW_PRICE，默认 0=不公布）。
      2026-09-19 用户拍板：公售开始前页面上**一个价格数字都不出现**，
      哪怕链上读得到。读不到配置时按「不公布」办 —— 少说一个数，比说错一个数强。 */
  function showPrice() {
    var c = root.ARCBANG_CONFIG || {};
    return c.showPrice === true || c.showPrice === 1 || c.showPrice === '1';
  }
  function paidMintLabel() {
    if (!showPrice()) return null;             // 不公布价格：按钮保持「铸造成 NFT」那句原文案
    var exhausted =
      (PH.got && W.addr && !PH.listed) ||                                    // 不在白名单：免费额度跟你无关（09-18）
      (W.free != null && W.free <= 0n) ||                                    // 免费期整个发完了
      (W.fc && W.fc.supported && W.fc.cap != null && W.fc.used >= W.fc.cap) || // 新合约：10 次用光
      (W.fc && !W.fc.supported && W.usedFree === true);                      // 旧合约：那一次用过了
    if (!exhausted || W.price == null) return null;
    return TX('{0} {1} 铸造', C.fmtBNB(W.price), chainCur());
  }

  /* 铸造按钮旁常驻的那行价格/免费次数。三件事全部现取，一个都不写死
     （owner 可以调价调次数，写死早晚说谎）；读不到就少说，绝不猜一个数出来。

     四种态，按知道多少说多少：
       没连钱包        → 中性一句（不读任何按地址的计数）
       新合约有免费次数 → 「免费次数：X / 10」（freeMintCount / freePerAddr，现读）
       旧合约（getter revert，fc.supported=false）→ 回退 usedFree 的一次性话术，
                         计数行**不出现** —— 链上还是旧字节码时这里不许报错也不许白屏
       次数用完 / 免费期结束 → 一口价 + 奖励（paidMintLabel 同一句）

     这行字挂在**铸造 HUD**（#bnbHudPrice）和结局面板（#bnbMintPrice）上 ——
     那里本来就是铸造信息面板，价格该跟铸造按钮站在一起；
     无顶栏的退路（浮空 #bnbWallet）里也还是它。 */
  function priceLine() {
    var paid = paidMintLabel();
    /* 免费额度是**白名单的**（2026-09-18）：链上还剩 387 枚不等于你能免费领。
       不先判这一条的话，公售段一个名单外的路人会看到「首批免费，只花 gas」，
       点下去钱包却要 1 USDC —— 展示和真报价打架，比不显示糟得多。
       状态还没问到（PH.got=false）时照旧按链上读数说话，不因为一次网络抖动改口径。 */
    if (PH.got && W.addr && !PH.listed) {
      return (showPrice() && W.price != null
        ? TX('{0} {1} 铸造（免费额度只给白名单）', C.fmtBNB(W.price), chainCur())
        : T('免费额度只给白名单，公售价格另行公布'));
    }
    if (W.free != null && W.free > 0n) {
      /* 未连钱包：按地址的计数根本没得问，给一句中性的 —— 连上才知道你还剩几次 */
      if (!W.addr) return T('首批免费，只花 gas（连接钱包看你的免费次数）');
      if (W.fc && W.fc.supported) {
        if (W.fc.used < W.fc.cap) return TX('已用 {0} / {1} 次免费（只花 gas）', W.fc.used, W.fc.cap);
        return paid || T('你的免费次数用完了，接下来按固定价铸造');
      }
      /* 旧合约（或计数还没读到）：沿用一次性名额的旧话术 */
      if (W.usedFree === false) return T('你还有一次免费铸造（只花 gas）');
      if (W.usedFree === true) return paid || T('免费名额你已经用过了，接下来按固定价铸造');
      return T('首批免费，只花 gas');
    }
    if (W.free != null && W.free <= 0n) {
      return paid || T('免费期已结束，按固定价铸造');
    }
    return '';
  }

  function walletRender() {
    if (!W.el) return;
    var priceTxt = priceLine();
    /* 这块芯片是 fixed 的，页面一滚就会压在正文上。里面没有按钮时它纯粹是块状态显示，
       那就别再吃点击 —— 被它盖住的按钮照样点得到。有「连接钱包」按钮时再把事件收回来。 */
    W.el.style.pointerEvents = 'none';
    if (!C.hasWallet()) {
      /* 话术不再点名小狐狸（币安钱包同样是正路）；「怎么连？」开钱包选择器 ——
         桌面端它说去装扩展，手机端给「在 Binance App 里打开」的深链。 */
      W.el.innerHTML = '<span class="w-err">' + esc(T('没检测到钱包')) + '</span>' +
        '<button type="button" class="w-btn" id="bnbNoWallet">' + esc(T('怎么连？')) + '</button>' +
        '<span class="w-dim">' + esc(T('引爆免费，铸造才需要')) + '</span>';
      W.el.style.pointerEvents = '';
      var nb = $('bnbNoWallet');
      if (nb) nb.addEventListener('click', function () {
        if (root.MirrorWallet && root.MirrorWallet.pick) root.MirrorWallet.pick({ force: true });
      });
      return;
    }
    if (!W.addr) {
      W.el.innerHTML = '<span class="w-dim">' + esc(priceTxt || T('铸造需要付费')) + '</span>' +
        '<button type="button" class="w-btn" id="bnbConnect">' + esc(T('连接钱包')) + '</button>';
      W.el.style.pointerEvents = '';                 // 有按钮了，得能点
      $('bnbConnect').addEventListener('click', function () {
        var b = $('bnbConnect'); b.disabled = true; b.textContent = T('连接中…');
        var MW = root.MirrorWallet;
        var pre = (MW && MW.pick) ? MW.pick() : Promise.resolve(null);
        pre.then(function (sel) {
          if (sel === false || (sel === null && !C.hasWallet())) {
            b.disabled = false; b.textContent = T('连接钱包');   // 选择器已经把话说了，这里不再报错
            return null;
          }
          return C.connect().then(function (a) { W.addr = a; walletRender(); refreshFreeStatus(); });
        }).catch(function (e) {
            b.disabled = false; b.textContent = T('连接钱包');
            W.el.insertAdjacentHTML('afterbegin', '<span class="w-err">' + esc(e && e.code === 4001 ? T('你取消了') : (e.message || T('连接失败'))) + '</span>');
          });
      });
      return;
    }
    W.el.innerHTML = '<span class="w-dot"></span><span class="w-addr">' + esc(shortAddr(W.addr)) + '</span>' +
      '<span class="w-dim">' + esc(chainName()) + '</span>' +
      (priceTxt ? '<span class="w-dim">· ' + esc(priceTxt) + '</span>' : '');
  }

  /* ============================================================ 画廊 */
  /* 结局一律以**服务端算的**为准，不用链上那个数。
     链上的 outcome 是 bang() 的一个入参 —— 直接调合约的人想填几就填几，
     合约不会去核对（能核对就不需要服务端签名这套了）。
     实测就有：NFT #3 链上写着 9（可能诞生观察者），服务端按同一个哈希算出来是
     UNSTABLE_ORBITS。照抄链上那个数等于替铸造者的一面之词背书，
     而且和点进去看到的结局自相矛盾。 */
  function galFill(list) {
    var gal = $('bnbGal');
    if (!gal) return;
    // 一个一个来：服务端对同一哈希是纯函数且落盘缓存，串行几乎没有代价，
    // 也不会在展开的一瞬间给自家服务端来 12 个并发
    var i = 0;
    (function next() {
      if (i >= list.length) return;
      var b = list[i++];
      var cell = gal.querySelector('.gal-o[data-h="' + b.blockHash + '"]');
      if (!cell) return next();
      if (cell.getAttribute('data-spoiler') === '1') return next();   // 自己那枚，不剧透
      API.card(b.blockHash).then(function (res) {
        var card = res && res.card;
        var id = card && card.outcome && card.outcome.id;
        /* 维度排在结局前面，理由和 market.html 的 uniBrief() 一模一样：结局的区分度太低。
           实测链上这 7 枚**结局全是「无稳定轨道／原子」**，七行长得一个样，等于没写；
           而它们的 D 是 12 / 3 / 10 …，一眼就分得开。
           D 不用多发一个请求 —— 它就在这次 API.card 的同一份响应里。
           读不到就不写这一段，不编一个（和 uniBrief 一样的规矩）。 */
        var D = card && card.dimension && card.dimension.D;
        var bits = [];
        if (D != null && isFinite(D)) bits.push('D=' + D);
        bits.push(OUTCOME_CN[id] || '?');
        cell.textContent = bits.join(' · ');
        cell.className = 'gal-o';
      }, function () {
        cell.textContent = T('算不出');               // 服务端没响应就直说，不拿链上那个数顶
        cell.className = 'gal-o unknown';
      }).then(next, next);
    }());
  }

  function loadGallery() {
    if (!C.contract()) return;
    var gal = $('bnbGal');
    if (!gal) return;
    C.recentBangs(12).then(function (list) {
      if (!list.length) { gal.hidden = true; return; }
      gal.hidden = false;
      /* 标题原来写的是「已经被引爆的宇宙」—— 那是错的，而且错得会误导人去等它出现：
         引爆是免费的、纯本地算，一个字都不上链；这个列表枚举的是 totalSupply()，
         也就是**真的花钱铸成了 NFT 的那些**。引爆过但没铸的宇宙永远不会出现在这儿。 */
      gal.innerHTML = '<div class="bnb-note" style="margin-bottom:6px">' +
        esc(T('已经铸造成 NFT 的宇宙（点一下就能重炸同一个）')) + '</div>' +
        list.map(function (b) {
          // 「不看就收下」的人不该在这里被剧透自己那一个：他手上这枚还没炸开看
          var mine = S.hash && b.blockHash && b.blockHash.toLowerCase() === S.hash.toLowerCase();
          var spoiler = mine && !S.revealed;
          /* 编号写区块号，不写 tokenId（见 uniNo 的说明）。tokenId 没被丢掉 ——
             它挪进了 title，和 market.html 卡片上那个 uid 的 tooltip 一个写法。 */
          return '<div class="bnb-gal-item" data-hash="' + esc(b.blockHash) + '"' +
            ' title="' + esc(TF('区块号 —— 这个宇宙的身份。token #{0}', b.tokenId)) + '">' +
            '<b class="gal-id">' + esc(TF('宇宙 {0}', uniNo(b.blockNumber, b.tokenId))) + '</b>' +
            '<span class="gal-h">' + esc(b.blockHash.slice(0, 12)) + '…</span>' +
            '<span class="gal-o unknown" data-h="' + esc(b.blockHash) + '"' +
            (spoiler ? ' data-spoiler="1">' + esc(T('（你的，还没炸开看）'))
                     : '>' + esc(T('读取中…'))) +
            '</span></div>';
        }).join('');
      Array.prototype.forEach.call(gal.querySelectorAll('.bnb-gal-item'), function (el) {
        el.addEventListener('click', function () { setHash(el.getAttribute('data-hash'), null); });
      });
      /* 画廊躺在折叠的「更多」里。没展开就先不去问服务端要 12 个 card ——
         首屏本来就该安静，这些请求等人真想看的时候再发。 */
      var more = $('bnbMore');
      if (!more || more.open) { galFill(list); return; }
      more.addEventListener('toggle', function once() {
        if (!more.open) return;
        more.removeEventListener('toggle', once);
        galFill(list);
      });
    }).catch(function () { /* 读链失败就不显示画廊 */ });
  }

  /* ============================================================ 深链
     app.html?bang=<0x哈希或区块号>：加载后自动走「直接粘哈希 / 指定高度」那条现成路
     （useInput 会核对真区块 / 按高度取块），card 就绪后直接进确认屏。
     与 MIRROR_LOCK_TO_BLOCKS 不冲突 —— 深链恰恰是"认区块"的正路。
     失败（限流 / 假哈希 / RPC 挂了）由 useInput 里现成的 status() 报错，这里只等不催。 */
  function deepLink() {
    var v = null, fix = false;
    try {
      var q = new URLSearchParams(location.search);
      v = q.get('bang');
      /* fix=1：从市场 / 个人中心那颗「拯救」按钮过来的。
         参数名沿用现成的 bang，只多这一个开关，不另起炉灶。 */
      fix = q.get('fix') === '1';
    } catch (e) { return; }
    if (!v) return;
    var inp = $('bnbInput');
    if (!inp) return;
    inp.value = String(v).trim();
    var pick = $('bnbPick');
    if (pick) pick.open = true;               // 让人看得到「正在核对…」的状态行在哪
    useInput();
    var t0 = Date.now();
    (function wait() {
      if (S.derived && S.hash) {                       // fire() = 现成的进确认屏那条路
        fire();
        if (fix) toSandbox();
        return;
      }
      if (Date.now() - t0 > 45000) return;             // 失败已由 status() 说过，别无限空转
      root.setTimeout(wait, 250);
    }());
  }

  /* fix=1 的落地动作：**直接把干预沙盒开出来**，
     跳过「用户自己进 3D、再在 HUD 上找那颗按钮」那两步。走的就是 #bnbFix 那颗
     按钮的行为（openSandbox），不另写一套开法。

     降级：开不起来就**停在确认屏** —— 那正是这条深链改动之前的落点，用户看到的是
     一个可以按的引爆页，而不是白屏。intervene.js 偶尔会比这里晚就绪（脚本顺序、
     慢设备），所以给两秒的重试窗口，过了就安静放弃。 */
  function toSandbox() {
    var t1 = Date.now();
    (function tryOpen() {
      if (openSandbox()) return;
      if (Date.now() - t1 > 2000) return;
      root.setTimeout(tryOpen, 200);
    }());
  }

  /* ============================================================ 启动 */
  function start() {
    // 依赖从 MirrorBnbHash 换成了 MirrorBnbApi（推导搬到服务端），这里跟着改
    if (!API || !C) return;
    if (!mount()) return;
    // app.js 的 applyVersion() 会把标题写成"镜像宇宙模拟器 vX"，站点版在它之后再改一次
    var setTitle = function () {
      doc.title = T('ARC宇宙 · ARCBANG');
    };
    setTitle();
    doc.addEventListener('mirror:lang', setTitle);   // 切语言标题跟着换（09-17 用户：英文态标签页还是中文）
    refCapture();        // ?ref= 落地留痕（首触优先，30 天）—— 在任何请求之前
    wireShare();         // 「广播这枚」按钮的事件委托
    walletMount();
    hudMount();          // 引爆之后压在 3D 画面上的铸造入口
    wireAnalysisEngineNote();  // 计算报告页脚：开源引擎链接
    loadGallery();
    deepLink();          // ?bang= 深链：直接把那个宇宙端上来
    /* 首屏刻意**不**自动取区块了：原来一进来就铺开哈希、参数表和一堆按钮，
       新手第一眼看到的是信息，而不是"我该干什么"。现在页面上只有一个大按钮，
       点它才发请求 —— 少一次自动 RPC，也少一屏噪音。 */
    var o = OB();
    if (o) o.maybeShow();
    /* 英文态兜底：MirrorI18n 的 DOM 遍历跑在 DOMContentLoaded，它的监听比本模块
       注册得早 —— 上面 mount 出来的整层标记（hero、选块面板、确认页…）那时还不在树上，
       静态文本节点一个也没被翻到。挂完再整树过一遍；中文态这一步是空操作。 */
    if (root.MirrorI18n && root.MirrorI18n.apply) root.MirrorI18n.apply();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : this, document);
