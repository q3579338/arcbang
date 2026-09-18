/*
 * web/wallet.js —— 多钱包发现与选择（ES5，零依赖）
 * ------------------------------------------------------------
 * 为什么需要它：
 *
 * 站点原来只认 `window.ethereum`。装了两个以上钱包扩展时，那个位置**是谁抢到算谁** ——
 * 用户想用币安钱包，点下去连上的却是小狐狸，而且界面上没有任何办法改。
 * 这不是小概率：BNB 链的用户装币安钱包的比例很高，而很多人同时装着小狐狸。
 *
 * 解决办法是 **EIP-6963（多注入钱包发现）**：钱包不再抢同一个全局变量，
 * 而是各自广播一条带 uuid / name / icon / rdns 的公告，页面把它们列出来让人选。
 * 币安钱包、小狐狸、OKX、Rabby 等主流扩展都实现了它。
 *
 * 三层回退，缺哪层用哪层：
 *   1. EIP-6963 公告        —— 有几个列几个，能区分同名扩展
 *   2. window.ethereum.providers —— 6963 之前的老约定，某些环境里还在用
 *   3. window.ethereum / window.BinanceChain —— 最后的兜底
 *
 * 选择结果记在 localStorage['mirror.wallet']（存的是 rdns，不是 uuid ——
 * uuid 每次刷新都会变，存了等于没存）。
 */
(function (root) {
  'use strict';

  var KEY = 'mirror.wallet';
  /* rdns → 显示名。**只用于把没报名字的钱包认出来**；
     报了名字的一律用它自己报的，别替人家改名。 */
  var KNOWN = {
    'com.binance.wallet': 'Binance Wallet',
    /* 币安钱包扩展改过一次 rdns：老包报 com.binance.wallet，Web3 Wallet 那一支报
       com.binance.w3w（w3w = Web3 Wallet，与 npm 包 @binance/w3w-* 同名）。
       两条都收，哪条到就认哪条 —— 报了名字的一律用它自己报的，这里只兜「没报名字」。 */
    'com.binance.w3w': 'Binance Wallet',
    'io.metamask': 'MetaMask',
    'io.metamask.flask': 'MetaMask Flask',
    'com.okex.wallet': 'OKX Wallet',
    'com.coinbase.wallet': 'Coinbase Wallet',
    'io.rabby': 'Rabby',
    'com.trustwallet.app': 'Trust Wallet',
    'app.phantom': 'Phantom',
    /* Bitget 从 BitKeep 改的名，老包的 rdns 还是 com.bitkeep.wallet */
    'com.bitget.web3': 'Bitget Wallet',
    'com.bitkeep.wallet': 'Bitget Wallet',
    'io.gate.wallet': 'Gate Wallet',
    'com.gateio.web3wallet': 'Gate Wallet',
    'me.rainbow': 'Rainbow'
  };

  var found = [];        // [{ uuid, name, icon, rdns, provider }]
  var chosen = null;     // 当前选中的那条
  var listeners = [];

  /* 界面文案走 i18n（词条在 web/i18n-app.js，app 与市场页都载它）。
     i18n 缺席（老页面 / 并行开发）时原样返回中文 —— 少一句译文，不能少一个功能。 */
  function TT(s) { var I = root.MirrorI18n; return (I && I.t) ? I.t(s, 'app') : s; }
  /* 带插值的句子：整句进词典，占位符在译文里，别在外面拼 —— 中英的标点和语序都不一样。 */
  function TTF(s, a, b) {
    var out = TT(s).split('{0}').join(String(a == null ? '' : a));
    return out.split('{1}').join(String(b == null ? '' : b));
  }

  /* 币安钱包图标：内联 SVG（品牌黄底 + 五菱形），data URI，不外链任何资源。
     6963 公告自带 icon 的钱包一律用它自己报的；这一份只给两处兜底用：
     老版注入（window.BinanceChain 没有 icon）和「在 Binance App 里打开」的深链入口。 */
  var BINANCE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="7" fill="#F0B90B"/>' +
    '<path fill="#FFF" d="M16 5.4l3.4 3.4-3.4 3.4-3.4-3.4z' +
    'M8.8 12.6l3.4 3.4-3.4 3.4-3.4-3.4z' +
    'M23.2 12.6l3.4 3.4-3.4 3.4-3.4-3.4z' +
    'M16 12.6l3.4 3.4-3.4 3.4-3.4-3.4z' +
    'M16 19.8l3.4 3.4-3.4 3.4-3.4-3.4z"/></svg>');
  /* MetaMask 兜底图标：6963 公告自带 icon 的用它自己的；老注入只有 isMetaMask 旗标、没有图。 */
  var METAMASK_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="7" fill="#E2761B"/>' +
    '<path fill="#FFF" d="M9.2 11.2L16 7.2l6.8 4-1.4 8.4H10.6z"/>' +
    '<path fill="#C0AD9E" d="M12.4 19.6h7.2L16 24z"/></svg>');
  /* OKX 兜底图标：黑底 + 白色 OK 方块，data URI，不外链。与上面两份同样只给
     「老注入没有图」和「没装钱包时的安装入口」两处用。 */
  var OKX_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="7" fill="#111"/>' +
    '<path fill="#FFF" d="M7 7h6v6H7zM19 7h6v6h-6zM13 13h6v6h-6zM7 19h6v6H7zM19 19h6v6h-6z"/></svg>');
  /* 认不出来的钱包给一个中性的圆点图标，别让列表里一半有图一半空着 */
  var GENERIC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="7" fill="#8A90A6"/>' +
    '<path fill="#FFF" d="M8 11a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" opacity=".35"/>' +
    '<circle cx="20" cy="16" r="2.4" fill="#FFF"/></svg>');
  function iconOf(e) {
    if (e && e.icon) return e.icon;
    if (e && (e.rdns === 'com.binance.wallet' || e.rdns === 'com.binance.w3w' || e.name === 'Binance Wallet')) return BINANCE_ICON;
    if (e && (e.rdns === 'io.metamask' || e.name === 'MetaMask')) return METAMASK_ICON;
    if (e && (e.rdns === 'com.okex.wallet' || e.name === 'OKX Wallet')) return OKX_ICON;
    return GENERIC_ICON;
  }

  function keyOf(e) { return e && (e.rdns || e.name || ''); }
  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (err) { /* 某个订阅者炸了不该拖垮其他人 */ } } }

  /* ---------------------------------------------------------- 拉黑 TronLink / TokenPocket
     这两家会抢 window.ethereum，连上之后弹「您在 EVM 网络下未创建账户」且关不掉。
     本站只做 BNB 链，不接它们。发现层（6963 公告 + ethereum/providers 老注入，
     两条路都进 addEntry）三条线索任一命中就丢弃，不入列表、不自动连、不进选择器：
       1. rdns 含 tronlink / tokenpocket（TokenPocket 常见 rdns 是 pro.tokenpocket；
          com.tron.link 这种带点的写法按去掉分隔符再比，避免漏网）
       2. provider 自曝 isTronLink / isTokenPocket，或对象就是 window.tronLink /
          window.tronWeb（及其 .ethereum / .tronWeb）—— 只认「这个 provider 来自它」，
          页面上同时装着小狐狸时不能因为 window.tronLink 存在就把小狐狸也扔掉
       3. info.name 不区分大小写含 tronlink / tokenpocket */
  var BLOCK_NEEDLE = ['tronlink', 'tokenpocket'];
  var KNOWN_RDNS_PREFIX = [
    'io.metamask', 'com.binance.wallet', 'com.binance.w3w', 'com.okex.wallet',
    'io.rabby', 'com.trustwallet.app', 'app.phantom', 'com.coinbase.wallet',
    'com.bitget.web3', 'com.bitkeep.wallet', 'io.gate.wallet', 'com.gateio.web3wallet',
    'me.rainbow'
  ];
  var KNOWN_NAMES = {
    metamask: 1, 'metamask flask': 1, 'binance wallet': 1, 'binance web3 wallet': 1,
    'okx wallet': 1, rabby: 1, 'trust wallet': 1, phantom: 1, 'coinbase wallet': 1,
    'bitget wallet': 1, 'gate wallet': 1, 'gate.io wallet': 1, rainbow: 1
  };
  function blockedHay(s) {
    var raw = String(s == null ? '' : s).toLowerCase();
    if (!raw) return false;
    var alnum = raw.replace(/[^a-z0-9]/g, '');
    for (var i = 0; i < BLOCK_NEEDLE.length; i++) {
      var n = BLOCK_NEEDLE[i];
      if (raw.indexOf(n) >= 0 || alnum.indexOf(n) >= 0) return true;
    }
    return false;
  }
  function isKnownGoodRdns(rdns) {
    var s = String(rdns == null ? '' : rdns).toLowerCase();
    if (!s) return false;
    if (KNOWN[rdns] || KNOWN[s]) return true;
    for (var i = 0; i < KNOWN_RDNS_PREFIX.length; i++) {
      var p = KNOWN_RDNS_PREFIX[i];
      if (s === p || s.indexOf(p + '.') === 0) return true;
    }
    return false;
  }
  function isKnownGoodName(name) {
    var s = String(name == null ? '' : name).toLowerCase().replace(/\s+/g, ' ').trim();
    return !!KNOWN_NAMES[s];
  }
  function providerFromTronShell(p) {
    if (!p) return false;
    var tl = root.tronLink, tw = root.tronWeb;
    if (tl) {
      if (p === tl) return true;
      try {
        if (tl.ethereum && p === tl.ethereum) return true;
        if (tl.tronWeb && p === tl.tronWeb) return true;
      } catch (e) { /* 跨源壳可能抛 */ }
    }
    if (tw && p === tw) return true;
    return false;
  }
  /* 6963 用 rdns/name 认出是黑名单之后，同一份对象可能已经从
     window.ethereum 以「注入的钱包」进过列表（老注入没有 rdns）。
     记下对象，之后哪条路再送来都丢；已经在列表里的要摘掉。 */
  var blockedProviders = [];
  function markBlockedProvider(p) {
    if (!p) return;
    for (var i = 0; i < blockedProviders.length; i++) if (blockedProviders[i] === p) return;
    blockedProviders.push(p);
  }
  function isBlockedProvider(p) {
    if (!p) return false;
    for (var i = 0; i < blockedProviders.length; i++) if (blockedProviders[i] === p) return true;
    return false;
  }
  function dropProvider(p) {
    if (!p) return;
    var changed = false;
    for (var i = found.length - 1; i >= 0; i--) {
      if (found[i].provider === p) {
        if (chosen === found[i]) chosen = null;
        found.splice(i, 1);
        changed = true;
      }
    }
    if (changed) emit();
  }
  function isBlocked(e) {
    if (!e) return false;
    var p = e.provider;
    if (isBlockedProvider(p)) return true;
    /* MetaMask 名里不含关键字、但 rdns 畸形时：不能拿那串 rdns 去匹配 tronlink。
       已知 rdns（io.metamask…）永远放行；已知显示名只跳过 rdns 针，name / 壳仍查。
       TokenPocket 自报名字或 isTokenPocket、以及真是 tronLink 壳的，照拦。 */
    var knownRdns = isKnownGoodRdns(e.rdns);
    var knownName = isKnownGoodName(e.name);
    if (knownRdns) return false;
    /* 已知显示名（MetaMask 等）：rdns 畸形不拿去匹配针；isTokenPocket 旗标
       可能是别的扩展打在共享对象上的污染，只认「provider 就是 tronLink 壳」。 */
    var hit = (!knownName && blockedHay(e.rdns)) || blockedHay(e.name);
    if (knownName) {
      if (providerFromTronShell(p)) hit = true;
    } else if (p && (p.isTronLink || p.isTokenPocket || providerFromTronShell(p))) {
      hit = true;
    }
    if (hit) markBlockedProvider(p);
    return hit;
  }

  function addEntry(e) {
    if (!e || !e.provider) return;
    if (isBlocked(e)) { dropProvider(e.provider); return; }
    var k = keyOf(e);
    for (var i = 0; i < found.length; i++) {
      /* 同一个钱包会被多次公告（页面加载时一次、我们主动请求时又一次）。
         按 rdns 去重，否则列表里会出现两个一模一样的"币安钱包"。 */
      if (keyOf(found[i]) === k && k) {
        /* chosen 可能已经指着旧条目（provider() 在 6963 公告到来前就被问过 ——
           bnb-chain 的 eth() 每次请求都问）。只换 found 不换 chosen 的话，
           后到的标准 provider 永远顶不掉先占位的老壳。 */
        if (chosen === found[i]) chosen = e;
        found[i] = e;
        emit();
        return;
      }
      if (found[i].provider === e.provider) return;
    }
    found.push(e);
    emit();
  }

  /* ---- 第 1 层：EIP-6963 ---- */
  /* 监听只注册**一次**：原来每次 rescan（加载时 3 次 + 每次 pick()）都
     addEventListener，一条 announceProvider 公告会进 N 个回调 ——
     addEntry 按 rdns 去重保得住列表，但 emit() 被放大 N 倍（钱包 chip 连刷 N 次），
     而且监听器只增不减，选择器开得久就线性泄漏。重扫只需要再广播一次
     requestProvider，钱包自会重新公告。 */
  var scan6963Wired = false;
  function scan6963() {
    if (!root.addEventListener || !root.CustomEvent) return;
    if (!scan6963Wired) {
      scan6963Wired = true;
      root.addEventListener('eip6963:announceProvider', function (ev) {
        var d = ev && ev.detail;
        if (!d || !d.info || !d.provider) return;
        addEntry({
          uuid: d.info.uuid, rdns: d.info.rdns,
          name: d.info.name || KNOWN[d.info.rdns] || d.info.rdns || '未具名钱包',
          icon: d.info.icon || null, provider: d.provider
        });
      });
    }
    /* 主动请求一次。**必须在监听之后发** —— 钱包是同步回应这个事件的，
       先发后听就什么都收不到。 */
    try { root.dispatchEvent(new root.CustomEvent('eip6963:requestProvider')); } catch (e) { /* 老浏览器：靠下面两层 */ }
  }

  /* ---------------------------------------------------------- 老版币安钱包（window.BinanceChain）适配
     老扩展（Binance Chain Wallet）的 request 与小狐狸有三处对不上，全按官方文档
     （binance-wallet.gitbook.io › dev › get-started）原文适配，别想当然：
       1. **没有 personal_sign**，只有 eth_sign —— 且它的 eth_sign 收明文并按原样
          展示给用户签，不是小狐狸那个"只收 32 字节哈希"的 eth_sign；
       2. eth_sign 的参数序是 **[地址, 消息]**（文档原句
          `request({method:"eth_sign", params:["address","message"]})`），
          与小狐狸 personal_sign 的 [消息, 地址] 正好相反；
       3. 不认 wallet_switchEthereumChain / wallet_addEthereumChain，切链走它自己的
          switchNetwork('bsc-mainnet' | 'bsc-testnet' | …)。
     ⚠ 老扩展已停维护，本机没法装到它实测 —— 这层薄壳照文档写，每一条都注明出处；
     新版币安钱包走 6963 标准路，根本不进这里。 */
  function isHexAddr(v) { return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v); }
  /* personal_sign 的消息按约定是 0x 开头的 **UTF-8 字节 hex**。老壳的 eth_sign
     收明文并原样展示给用户签（EIP-191 对明文）——把 hex 串直接塞过去，
     它签的就是「0x6d79…」这串字符本身，服务端 verifyMessage 恢复出来的地址
     对不上，认领 401。所以先解回 UTF-8 再交给它；解不动（不是整字节 hex /
     不是合法 UTF-8）就原样透传，行为与从前逐字一致。
     ⚠ 老扩展已停维护、本机装不到，真机行为**待核实**（2026-08-22 审查 #11）。 */
  function hexToUtf8(h) {
    var body = String(h == null ? '' : h);
    if (!/^0x[0-9a-fA-F]*$/.test(body) || body.length % 2) return null;
    body = body.slice(2);
    try {
      var pct = '';
      for (var i = 0; i < body.length; i += 2) pct += '%' + body.substr(i, 2);
      return decodeURIComponent(pct);        // 顺带验 UTF-8 合法性：坏序列直接 throw
    } catch (e) { return null; }
  }
  var BNC_NET_BY_HEX = { '0x38': 'bsc-mainnet', '0x61': 'bsc-testnet' };
  function wrapBinanceLegacy(p) {
    if (!p || typeof p.request !== 'function' || p.__mirrorBinanceLegacy) return p;
    var w = {
      __mirrorBinanceLegacy: true,
      isBinance: true,
      isBinanceChain: true,
      _raw: p,                       // 要摸 bnbSign 这类私有 API 的调用方从这里拿原件
      request: function (args) {
        var m = args && args.method, ps = (args && args.params) || [];
        if (m === 'personal_sign') {
          /* 按"哪个长得像地址"判定参数序，两种传法（[消息,地址] / [地址,消息]）都接得住；
             都像地址时按小狐狸约定（[消息, 地址]）取，不瞎猜。 */
          var addr = (isHexAddr(ps[0]) && !isHexAddr(ps[1])) ? ps[0] : ps[1];
          var msg = (addr === ps[0]) ? ps[1] : ps[0];
          var plain = hexToUtf8(msg);        // 老壳收明文；hex 解得动就给它明文（见 hexToUtf8 顶注）
          if (plain !== null) msg = plain;
          return p.request({ method: 'eth_sign', params: [addr, msg] });
        }
        if ((m === 'wallet_switchEthereumChain' || m === 'wallet_addEthereumChain') &&
            typeof p.switchNetwork === 'function') {
          var hex = String((ps[0] && ps[0].chainId) || '').toLowerCase();
          var net = BNC_NET_BY_HEX[hex];
          if (net) return Promise.resolve(p.switchNetwork(net)).then(function () { return null; });
          /* 不是 BSC 的链：老扩展本来就只有 BSC/BC，落到底层让它自己拒绝 */
        }
        return p.request(args);
      },
      on: function (ev, fn) { if (typeof p.on === 'function') p.on(ev, fn); return w; },
      removeListener: function (ev, fn) { if (typeof p.removeListener === 'function') p.removeListener(ev, fn); return w; }
    };
    return w;
  }

  function hasEntry(rdns) {
    for (var i = 0; i < found.length; i++) if (found[i].rdns === rdns) return true;
    return false;
  }

  /* ---------------------------------------------------------- 没有 6963 公告的老钱包
     （2026-09-17 加）EIP-6963 之前的扩展只往 window 上挂一个自己的对象，
     window.ethereum 又是谁抢到算谁 —— 于是「装了 OKX + 小狐狸，列表里只有小狐狸」。
     这张表按**钱包自己文档里写的那个全局名**去捞，捞到就补进列表。

     三条防重复，缺一个就会在 bnb / btc 站上凭空多出一条重复项（列表从 1 变 2，
     本来不弹的选择器开始弹 —— 那就是回归）：
       1. 同 rdns 已经被 6963 公告收过 → 跳过（标准路优先，永远不拿老壳去顶它）；
       2. 同一个对象已经在列表里（window.ethereum 就是它本人）→ 跳过；
       3. 列表里已有 provider 自曝同一面旗（它抢到了 window.ethereum，被 scanLegacy
          以「注入的钱包」收过，只是没有 rdns）→ 跳过。
     只认钱包**自己**打的旗标，认不出就不收，绝不按「名字像」瞎猜。 */
  var LEGACY_INJECTED = [
    { at: ['okxwallet'], rdns: 'com.okex.wallet', name: 'OKX Wallet', flags: ['isOkxWallet', 'isOKExWallet'] },
    { at: ['trustwallet', 'trustWallet'], rdns: 'com.trustwallet.app', name: 'Trust Wallet', flags: ['isTrust', 'isTrustWallet'] },
    { at: ['coinbaseWalletExtension'], rdns: 'com.coinbase.wallet', name: 'Coinbase Wallet', flags: ['isCoinbaseWallet', 'isCoinbaseBrowser'] },
    { at: ['bitkeep', 'bitgetWallet'], rdns: 'com.bitget.web3', name: 'Bitget Wallet', flags: ['isBitKeep', 'isBitget'], alt: ['com.bitkeep.wallet'] },
    { at: ['gatewallet'], rdns: 'io.gate.wallet', name: 'Gate Wallet', flags: ['isGateWallet'], alt: ['com.gateio.web3wallet'] },
    { at: ['rabby'], rdns: 'io.rabby', name: 'Rabby', flags: ['isRabby'] },
    { at: ['rainbow'], rdns: 'me.rainbow', name: 'Rainbow', flags: ['isRainbow'] },
    { at: ['phantom'], rdns: 'app.phantom', name: 'Phantom', flags: ['isPhantom'] }
  ];
  /* 全局名下面挂的可能是 provider 本身，也可能是 { ethereum: provider }（Phantom /
     Bitget 都是后者）。两种都试，拿不到 request() 就当没有。 */
  function injectedAt(entry) {
    for (var i = 0; i < entry.at.length; i++) {
      var o = null;
      try { o = root[entry.at[i]]; } catch (e) { o = null; }
      if (!o) continue;
      if (typeof o.request !== 'function') {
        try { o = o.ethereum; } catch (e2) { o = null; }
      }
      if (o && typeof o.request === 'function') return o;
    }
    return null;
  }
  function alreadyListed(obj, entry) {
    if (hasEntry(entry.rdns)) return true;
    var alt = entry.alt || [];
    for (var a = 0; a < alt.length; a++) if (hasEntry(alt[a])) return true;
    for (var i = 0; i < found.length; i++) {
      var p = found[i].provider;
      if (!p) continue;
      if (p === obj) return true;
      if (p._raw && p._raw === obj) return true;          // 老币安壳：比的是里面那件原件
      for (var k = 0; k < entry.flags.length; k++) {
        try { if (p[entry.flags[k]]) return true; } catch (e) { /* 跨源壳读属性可能抛 */ }
      }
    }
    return false;
  }
  function scanInjectedByName() {
    for (var i = 0; i < LEGACY_INJECTED.length; i++) {
      var e = LEGACY_INJECTED[i];
      var obj = injectedAt(e);
      if (!obj || alreadyListed(obj, e)) continue;
      addEntry({ uuid: null, rdns: e.rdns, name: e.name, icon: null, provider: obj });
    }
  }

  /* ---- 第 2、3 层：老约定与兜底 ---- */
  function scanLegacy() {
    var eth = root.ethereum;
    if (eth && eth.providers && eth.providers.length) {
      for (var i = 0; i < eth.providers.length; i++) {
        var p = eth.providers[i];
        addEntry({ uuid: null, rdns: null, name: nameOfLegacy(p), icon: null, provider: p });
      }
    } else if (eth) {
      addEntry({ uuid: null, rdns: null, name: nameOfLegacy(eth), icon: null, provider: eth });
    }
    /* 币安钱包的老版本注入在自己的位置上，不进 window.ethereum。
       新版走 6963，上面已经收到了；这里是给老版本兜底 ——
       **6963 那条已经报过币安就不再加**：原来 addEntry 会按 rdns 覆盖，
       等于拿文档适配的老壳把标准 provider 顶掉，方向反了。 */
    if (root.BinanceChain && root.BinanceChain !== eth &&
        !hasEntry('com.binance.wallet') && !hasEntry('com.binance.w3w')) {
      addEntry({ uuid: null, rdns: 'com.binance.wallet', name: 'Binance Wallet', icon: BINANCE_ICON, provider: wrapBinanceLegacy(root.BinanceChain) });
    }
    /* 其余只注入 window 对象、不发 6963 公告的老钱包（OKX / Trust / Bitget / …） */
    scanInjectedByName();
  }
  /* 老约定下钱包不报名字，只能看这些自曝的旗标。认不出就说"注入的钱包"，别瞎猜。 */
  function nameOfLegacy(p) {
    if (!p) return '注入的钱包';
    if (p.isBinance || p.isBinanceChain) return 'Binance Wallet';
    if (p.isMetaMask) return 'MetaMask';
    if (p.isOkxWallet || p.isOKExWallet) return 'OKX Wallet';
    if (p.isRabby) return 'Rabby';
    if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
    if (p.isCoinbaseWallet || p.isCoinbaseBrowser) return 'Coinbase Wallet';
    /* 下面几个是 2026-09 补的：都只看钱包**自己**打的旗标，认不出照旧说「注入的钱包」。
       isBitKeep 是 Bitget 改名前的旧旗标，两个都认。 */
    if (p.isBitget || p.isBitKeep) return 'Bitget Wallet';
    if (p.isGateWallet || p.isGate) return 'Gate Wallet';
    if (p.isRainbow) return 'Rainbow';
    if (p.isPhantom) return 'Phantom';
    return '注入的钱包';
  }

  function stored() {
    try { return root.localStorage.getItem(KEY) || null; } catch (e) { return null; }
  }
  function remember(k) {
    try { if (k) root.localStorage.setItem(KEY, k); else root.localStorage.removeItem(KEY); } catch (e) { /* 隐私模式：只在本次会话生效 */ }
  }

  /** 当前该用哪个 provider。没选过就按记忆挑，没记忆就用第一个找到的。 */
  function provider() {
    if (chosen && chosen.provider) {
      /* 记忆里若是已被拉黑的壳（升级前存过），丢掉再往下挑。 */
      if (isBlocked(chosen)) chosen = null;
      else return chosen.provider;
    }
    var want = stored();
    if (want) {
      for (var i = 0; i < found.length; i++) if (keyOf(found[i]) === want) { chosen = found[i]; return chosen.provider; }
    }
    if (found.length) { chosen = found[0]; return chosen.provider; }
    /* 一个都没发现：以前退回 window.ethereum。现在那个位置可能是刚扔掉的
       TronLink 壳，交出去就等于自动连上它。不是拉黑项才沿用旧兜底。 */
    var eth = root.ethereum;
    if (eth && !isBlocked({ provider: eth, name: nameOfLegacy(eth), rdns: null })) return eth;
    return null;
  }

  function select(k) {
    for (var i = 0; i < found.length; i++) {
      if (keyOf(found[i]) === k || found[i].uuid === k) {
        chosen = found[i]; remember(keyOf(found[i])); emit(); return chosen;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------- 手机端：没有注入环境时给 Binance App 深链
     格式逐字段取自币安自己的 npm 包 @binance/w3w-utils v1.1.8 的 getDeepLink()：
       bnc://app.binance.com/mp/app?appId=yFK5FCqYprrXDiVFbhyRx7
         &startPagePath=btoa('/pages/browser/index')
         &startPageQuery=btoa('url=<页面地址>&defaultChainId=<链id>')
     打不开 app 的兜底是下载页带 _dp=btoa(整条深链)。
     ⚠ 本机没有手机环境，这两条链接**没在真机上点过** —— 字段来源如上，
     真机验完之前别顺手改任何一段。 */
  function binanceDeepLink(url, chainId) {
    if (!root.btoa) return null;
    try {
      /* url 必须 URI 编码：页面地址本身常带 ?bang=…&ref=…，不编码的话
         startPageQuery 解出来 ref 成了外层参数，落地后推广绑定就丢了。
         编码后全是 ASCII，顺带也解决了 btoa 只吃 Latin-1 的坑。 */
      var link = 'bnc://app.binance.com/mp/app?appId=yFK5FCqYprrXDiVFbhyRx7' +
        '&startPagePath=' + root.btoa('/pages/browser/index') +
        '&startPageQuery=' + root.btoa('url=' + encodeURIComponent(url) + '&defaultChainId=' + (chainId || 56));
      return { bnc: link, http: 'https://app.binance.com/en/download?_dp=' + root.btoa(link) };
    } catch (e) { return null; }       // btoa 只吃 Latin-1：地址里带非 ASCII 就不给深链，别给一条必坏的
  }
  /* MetaMask 深链（App Links）：https://metamask.app.link/dapp/<host><path>。
     **不带协议头** —— 官方 deeplink 文档原文如此，带上就会拼成 /dapp/https://… 打不开。
     页面自己的 ?bang=…&ref=… 原样跟在后面（MetaMask 内置浏览器会照搬整条地址）。 */
  function metamaskDeepLink(url) {
    var u = String(url || '').replace(/^[a-z]+:\/\//i, '');
    return u ? 'https://metamask.app.link/dapp/' + u : null;
  }
  /* OKX 深链：okx://wallet/dapp/url?dappUrl=<编码后的页面地址>（OKX DApp deeplink 文档）。
     外层再包一次 https://www.okx.com/download?deeplink=… —— 没装 App 的人落到下载页，
     装了的人被系统直接接管。两段都要编码：页面地址里有 & 的话不编码就散架。 */
  function okxDeepLink(url) {
    var u = String(url || '');
    if (!u) return null;
    var inner = 'okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(u);
    return { okx: inner, http: 'https://www.okx.com/download?deeplink=' + encodeURIComponent(inner) };
  }
  /* 一个钱包都没装时的安装入口：只放三家官网首页（不是下载直链，避免把人送到一个
     随版本失效的文件地址）。图标用上面三份内联 SVG，不外链任何资源。 */
  var INSTALL_LINKS = [
    { name: 'MetaMask', icon: METAMASK_ICON, url: 'https://metamask.io/download/' },
    { name: 'Binance Wallet', icon: BINANCE_ICON, url: 'https://www.binance.com/en/web3wallet' },
    { name: 'OKX Wallet', icon: OKX_ICON, url: 'https://www.okx.com/web3' }
  ];
  function isMobileUA() {
    return /Android|iPhone|iPad|iPod/i.test((root.navigator && root.navigator.userAgent) || '');
  }

  /* ---------------------------------------------------------- 选择器（连接前弹的那层）
     规矩：
       · 只发现一个钱包 → 不弹，直接用它（装一个小狐狸或只装币安的人一次都不会看到这层，零回归）；
       · 两个以上 → **一定弹**。记住的那个排第一并加 .mwp-on 高亮，不再因记忆静默直连
         （Binance 抢占 window.ethereum 时，「上次选过它」会让装了小狐狸的人永远没得选）；
       · 一个都没有（含：发现到的全是拉黑项）→ 桌面端说去装扩展；手机端给
         「在 Binance App 里打开」的深链。不自动连任何东西。
     opts.force=true：即使只有一个也弹（「换钱包」清记忆后走这条）。
     resolve 值：选中的条目 / false（没钱包或用户关掉了）/ 无 document 时 null。
     没钱包回 false 而不是 null：调用方（market.html / bnb-ui）对 false 当「别去
     connect」；回 null 时它们会落到 window.ethereum，而那个位置可能是刚扔掉的
     TronLink 壳，正好把「关不掉的弹窗」又唤回来。 */
  var PICK_CSS = [
    '#mwPick{position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;',
    '  padding:12px;box-sizing:border-box}',
    '#mwPick .mwp-mask{position:absolute;inset:0;background:var(--scrim,rgba(20,22,30,.5))}',
    '#mwPick .mwp-box{position:relative;width:min(340px,100%);max-width:100%;',
    '  max-height:min(80vh,calc(100vh - 24px));overflow:auto;box-sizing:border-box;',
    '  background:var(--panel,#fff);color:var(--ink,#1a1d26);border:1px solid var(--line,#e6e8ef);',
    '  border-radius:var(--radius-pop,14px);box-shadow:var(--shadow-pop,0 8px 32px rgba(0,0,0,.2));padding:16px}',
    '#mwPick .mwp-title{font-weight:700;font-size:15px;margin:0 0 10px;padding-right:22px}',
    '#mwPick .mwp-item{display:flex;align-items:center;gap:10px;width:100%;margin:6px 0;padding:9px 10px;',
    '  border:1px solid var(--line,#e6e8ef);border-radius:var(--radius-btn,10px);background:transparent;',
    '  color:inherit;font:inherit;cursor:pointer;text-align:left;text-decoration:none;box-sizing:border-box;max-width:100%}',
    '#mwPick .mwp-item:hover{border-color:var(--cyan,#4a5bd4)}',
    '#mwPick .mwp-item.mwp-on{border-color:var(--cyan,#4a5bd4);background:var(--sel2,#eef1ff)}',
    '#mwPick .mwp-item img{width:24px;height:24px;border-radius:6px;flex:none}',
    '#mwPick .mwp-item .mwp-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mwPick .mwp-tag{margin-left:auto;font-size:11px;color:var(--cyan,#4a5bd4);flex:none;white-space:nowrap}',
    '#mwPick .mwp-note{font-size:12px;line-height:1.7;color:var(--dim,#696e7d);margin-top:8px}',
    '#mwPick .mwp-x{position:absolute;top:8px;right:10px;border:0;background:transparent;',
    '  color:var(--dim,#696e7d);font-size:18px;line-height:1;cursor:pointer;padding:4px}'
  ].join('\n');
  var pickStyleDone = false;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function closePick(doc) {
    var el = doc.getElementById('mwPick');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  /* 记住的那个排第一，其余保持发现顺序。只有一份列表、只在选择器里用。 */
  function orderedFound() {
    var want = stored();
    if (!want || found.length < 2) return found;
    var head = [], rest = [];
    for (var i = 0; i < found.length; i++) {
      if (keyOf(found[i]) === want) head.push(found[i]);
      else rest.push(found[i]);
    }
    return head.concat(rest);
  }
  function pick(opts) {
    opts = opts || {};
    var doc = root.document;
    return new Promise(function (resolve) {
      if (!doc || !doc.body) { resolve(null); return; }
      rescanAll();
      /* 只有一个才直连（零回归）。≥2 个一定弹选择器，记忆只用来高亮/排第一。 */
      if (!opts.force && found.length === 1) { chosen = found[0]; resolve(chosen); return; }
      if (!pickStyleDone) {
        var st = doc.createElement('style');
        st.textContent = PICK_CSS;
        doc.head.appendChild(st);
        pickStyleDone = true;
      }
      closePick(doc);
      var wrap = doc.createElement('div');
      wrap.id = 'mwPick';
      var html = '<div class="mwp-mask"></div><div class="mwp-box" role="dialog" aria-modal="true" tabindex="-1">' +
        '<button type="button" class="mwp-x" aria-label="' + esc(TT('取消')) + '">×</button>';
      if (found.length) {
        var list = orderedFound();
        var want = stored();
        html += '<div class="mwp-title">' + esc(TT('用哪个钱包连接？')) + '</div>';
        for (var j = 0; j < list.length; j++) {
          var on = !!(want && keyOf(list[j]) === want);
          html += '<button type="button" class="mwp-item' + (on ? ' mwp-on' : '') + '" data-mwk="' +
            esc(keyOf(list[j]) || String(j)) + '"' + (on ? ' aria-current="true"' : '') + '>' +
            '<img alt="" src="' + esc(iconOf(list[j])) + '"><span class="mwp-name">' + esc(TT(list[j].name)) + '</span>' +
            (on ? '<span class="mwp-tag">' + esc(TT('上次使用')) + '</span>' : '') + '</button>';
        }
      } else {
        html += '<div class="mwp-title">' + esc(TT('没检测到钱包')) + '</div>';
        var dl = isMobileUA() ? binanceDeepLink(String(root.location && root.location.href || ''), currentChainId()) : null;
        if (dl) {
          html += '<a class="mwp-item" href="' + esc(dl.bnc) + '">' +
            '<img alt="" src="' + esc(BINANCE_ICON) + '"><span>' + esc(TT('在 Binance App 里打开')) + '</span></a>' +
            '<div class="mwp-note"><a href="' + esc(dl.http) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' +
            esc(TT('打不开？先装 Binance App，装好再点一次')) + '</a></div>';
        }
        /* 手机浏览器里没有注入钱包 —— 唯一出路是在钱包 App 的内置浏览器里打开这一页。
           只放格式有据可查的两条（MetaMask App Links / OKX deeplink）加上面那条币安的；
           拿不准格式的钱包一条都不写：一条点不开的深链比没有更糟。 */
        if (isMobileUA()) {
          var here = String(root.location && root.location.href || '');
          var mm = metamaskDeepLink(here);
          if (mm) {
            html += '<a class="mwp-item" href="' + esc(mm) + '">' +
              '<img alt="" src="' + esc(METAMASK_ICON) + '"><span class="mwp-name">' +
              esc(TT('在 MetaMask App 里打开')) + '</span></a>';
          }
          var ox = okxDeepLink(here);
          if (ox) {
            html += '<a class="mwp-item" href="' + esc(ox.http) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' +
              '<img alt="" src="' + esc(OKX_ICON) + '"><span class="mwp-name">' +
              esc(TT('在 OKX App 里打开')) + '</span></a>';
          }
          html += '<div class="mwp-note">' + esc(TT('手机浏览器装不了钱包扩展：用上面的入口在钱包 App 的内置浏览器里打开这一页。')) + '</div>';
        } else {
          html += '<div class="mwp-note">' + esc(TT('还没装钱包？装一个再回来（装完刷新这一页）：')) + '</div>';
          for (var q = 0; q < INSTALL_LINKS.length; q++) {
            html += '<a class="mwp-item" href="' + esc(INSTALL_LINKS[q].url) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">' +
              '<img alt="" src="' + esc(INSTALL_LINKS[q].icon) + '"><span class="mwp-name">' +
              esc(TTF('去装 {0}', INSTALL_LINKS[q].name)) + '</span></a>';
          }
        }
        html += '<div class="mwp-note">' + esc(TT('电脑上装了 MetaMask 或币安钱包扩展后刷新这一页就能连。')) + '</div>';
        html += '<div class="mwp-note">' + esc(TT('TronLink / TokenPocket 连不上：请用 MetaMask 或币安钱包')) + '</div>';
      }
      html += '</div>';
      wrap.innerHTML = html;
      doc.body.appendChild(wrap);
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        closePick(doc);
        doc.removeEventListener('keydown', onKey);
        resolve(v);
      }
      function onKey(ev) { if (ev.key === 'Escape' || ev.key === 'Esc') finish(false); }
      doc.addEventListener('keydown', onKey);
      wrap.addEventListener('click', function (ev) {
        var t = ev.target;
        if (t && t.closest && t.closest('.mwp-mask')) { finish(false); return; }
        if (t && t.closest && t.closest('.mwp-x')) { finish(false); return; }
        var b = t && t.closest ? t.closest('[data-mwk]') : null;
        if (b) { finish(select(b.getAttribute('data-mwk'))); }
      });
      try { wrap.querySelector('.mwp-box').focus({ preventScroll: true }); } catch (e) { /* 老浏览器 */ }
      /* 没钱包的面板纯属说明（深链点了就走），别让调用方傻等：立刻回 false
         （见 pick() 顶注：回 null 会让调用方落到被拉黑的 window.ethereum 壳上）。 */
      if (!found.length) resolve(false);
    });
  }
  /** 深链要带 defaultChainId：从站点配置读，读不到按 BSC 主网 56（深链只是入口，链最终由页面 ensureChain 把关） */
  function currentChainId() {
    var c = root.ARCBANG_CONFIG;
    return (c && c.chain && c.chain.id != null) ? Number(c.chain.id) : 56;
  }

  /* ============================================================ 切链 / 加链（EIP-3326 + EIP-3085）
     （2026-09-17 加，为 ARCBANG 上 Arc 链而做，但对三个站是同一套代码：
       链参数全部由调用方从 ARCBANG_CONFIG.chain + rpc 现读传进来，这里**一个链号都不写死**。）

     流程与从前逐字相同，只是把「两份抄在 arc-chain.js 和 market.html 里的实现」收成一份：
       1. eth_chainId 已经对了 → 直接过；
       2. wallet_switchEthereumChain；
       3. 报「没有这条链」→ wallet_addEthereumChain，加完再核一次 chainId。
     新增的是三件事：
       · **参数按最严的钱包来**。币安钱包对 addEthereumChain 的校验比小狐狸紧：
         rpcUrls 必须是 https（http 与相对地址一律拒），nativeCurrency.symbol 只收
         2–6 位字母数字，decimals 必须是数字。所以这里过滤掉 '/api/rpc' 这种同源中继、
         把 symbol 清洗到 6 位以内、decimals 强制成数字；一条 https 节点都没有时
         **不发那条必被拒的请求**，直接说清楚为什么。
       · **加完要核对**。币安钱包会「加上了但不切过去」，此时页面若继续发交易，
         钱包会在另一条链上签 —— 那是真金白银的事故。加完重读 chainId，不对就再切一次，
         还不对就明确要求用户手动切，绝不返回 true。
       · **失败有人话**。用户拒绝（4001）和钱包根本不支持自定义网络（4200 / -32601）
         是两回事，提示不一样；原始 code 挂在 err.code 上，调用方要分支照样分得了。 */
  function errMsgOf(e) {
    if (!e) return '';
    var m = e.message || (e.data && e.data.message) || '';
    return String(m || e);
  }
  function chainErr(zh, a, b, cause) {
    var err = new Error(TTF(zh, a, b));
    if (cause && cause.code != null) err.code = cause.code;
    err.cause = cause || null;
    err.chainSwitch = true;
    return err;
  }
  function isUserReject(e) {
    var c = e && e.code;
    if (c === 4001 || c === 'ACTION_REJECTED') return true;
    return /user\s*(rejected|denied|cancell?ed)|用户(拒绝|取消)/i.test(errMsgOf(e));
  }
  /* 「钱包里没有这条链」。4902 是标准码；-32603 是小狐狸早年（以及 Rabby / 币安）
     把它包在内部错误里的写法 —— 这两条与改造前逐字一致，不动。
     -32602（参数非法）和无码的情况再看文案，别把别的错误也当成「没这条链」。 */
  function isUnknownChain(e) {
    var c = e && e.code;
    if (c === 4902 || c === -32603) return true;
    if (c === -32602 || c == null) return /unrecognized chain|unknown chain|chain.*not (been )?added|添加|未知(的)?链/i.test(errMsgOf(e));
    return false;
  }
  /* 钱包根本没实现这个方法（Coinbase 早期版本、部分 App 内置浏览器、老币安扩展）。 */
  function isUnsupported(e) {
    var c = e && e.code;
    if (c === 4200 || c === -32601) return true;
    return /unsupported method|method not (found|supported)|not implemented/i.test(errMsgOf(e));
  }
  function httpsOnly(list) {
    var out = [], i, u;
    for (i = 0; i < (list || []).length; i++) {
      u = String(list[i] || '');
      /* 相对地址（'/api/rpc' 同源中继）钱包用不了；http:// 币安钱包直接拒。 */
      if (/^https:\/\//i.test(u) && out.indexOf(u) < 0) out.push(u);
    }
    return out;
  }
  /* wallet_addEthereumChain 的参数。按最严的钱包（币安）清洗，宽松的钱包照样收。 */
  function addChainParams(spec) {
    var cur = spec.currency || {};
    var sym = String(cur.symbol || cur.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
    var dec = Number(cur.decimals);
    var p = {
      chainId: spec.hex,
      chainName: String(spec.name || '').trim(),
      nativeCurrency: {
        name: String(cur.name || sym || ''),
        symbol: sym,
        decimals: (dec === dec && dec > 0) ? dec : 18       // NaN 检测不用 isNaN（ES5 老浏览器上它会把 '' 也当数字）
      },
      rpcUrls: [httpsOnly(spec.rpcUrls)[0]]
    };
    /* 浏览器地址也必须 https；没有就整个键不给（给空数组有钱包会当参数非法整条拒掉）。 */
    var ex = httpsOnly([spec.explorer]);
    if (ex.length) p.blockExplorerUrls = ex;
    return p;
  }
  function chainIdOf(p) {
    return p.request({ method: 'eth_chainId' }).then(function (id) { return String(id || '').toLowerCase(); });
  }
  /**
   * 把钱包切到 spec 指定的链上；钱包里没有这条链就先加进去。
   * spec = { hex, id, name, label, currency:{name,symbol,decimals}, rpcUrls:[], explorer }
   *   hex    '0x13b2' 这样的链号（Arc 主网 5042；测试网 5042002 是 '0x4cef52'）
   *   name   钱包网络列表里显示的**规范名**（英文，不跟页面语言走）
   *   label  报错文案里给人看的名字（可以跟语言走）；不给就用 name
   * resolve(true) = 现在确实在这条链上。任何情况下都不会「以为切好了其实没切」。
   */
  function ensureChainOn(p, spec) {
    if (!p || typeof p.request !== 'function') {
      return Promise.reject(new Error(TT('没有检测到钱包')));
    }
    var want = String(spec.hex || '').toLowerCase();
    var label = spec.label || spec.name || want;
    function addChain() {
      var params = addChainParams(spec);
      if (!params.rpcUrls[0]) {
        /* 站点配置里只有同源中继 / http 节点：那条请求发出去必被拒，与其让钱包
           弹一个「参数非法」，不如在这里说清楚是配置的问题。 */
        return Promise.reject(chainErr('站点配置里没有 https 节点，钱包无法添加 {0}', label, null, null));
      }
      return p.request({ method: 'wallet_addEthereumChain', params: [params] }).then(function () {
        /* 币安钱包会「加上了但没切过去」：加完必须重核，不对就再切一次。 */
        return chainIdOf(p).then(function (now) {
          if (now === want) return true;
          return p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] })
            .then(function () { return true; }, function () { return false; })
            .then(function () {
              return chainIdOf(p).then(function (now2) {
                if (now2 === want) return true;
                throw chainErr('钱包里已经有 {0} 了，但没有切过去：请在钱包里手动切到 {0}', label, null, null);
              });
            });
        });
      }, function (e) {
        if (e && e.chainSwitch) throw e;
        if (isUserReject(e)) throw chainErr('你在钱包里取消了添加 {0}', label, null, e);
        if (isUnsupported(e)) throw chainErr('这个钱包不支持自动添加网络：请在钱包里手动添加 {0}（chainId {1}），再回来重试', label, (spec.id != null ? spec.id : want), e);
        throw chainErr('添加 {0} 失败：{1}', label, errMsgOf(e), e);
      });
    }
    return chainIdOf(p).then(function (now) {
      if (now === want) return true;
      return p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] })
        .then(function () { return true; })
        .catch(function (e) {
          if (isUnknownChain(e)) return addChain();
          if (isUserReject(e)) throw chainErr('你在钱包里取消了切换网络（需要 {0}）', label, null, e);
          if (isUnsupported(e)) throw chainErr('这个钱包不支持切换自定义网络：请在钱包里手动切到 {0}（chainId {1}）', label, (spec.id != null ? spec.id : want), e);
          throw chainErr('切换到 {0} 失败：{1}', label, errMsgOf(e), e);
        });
    });
  }

  function rescanAll() { scan6963(); scanLegacy(); }

  scan6963();
  scanLegacy();
  /* 有些扩展注入得比页面脚本晚。再扫两次，代价可以忽略，
     漏掉的话用户看到的是"没检测到钱包"，那是最糟的失败方式。 */
  if (root.setTimeout) { root.setTimeout(function () { scan6963(); scanLegacy(); }, 300); root.setTimeout(function () { scan6963(); scanLegacy(); }, 1200); }

  root.MirrorWallet = {
    /** 发现到的钱包列表（不含 provider 本身，给界面渲染用） */
    list: function () {
      var out = [];
      for (var i = 0; i < found.length; i++) {
        out.push({ key: keyOf(found[i]) || String(i), name: found[i].name, icon: iconOf(found[i]), rdns: found[i].rdns });
      }
      return out;
    },
    provider: provider,
    select: select,
    selected: function () { return chosen ? (keyOf(chosen) || null) : stored(); },
    /** 忘掉选择（断开时用）。**不会**动钱包那边的授权，那是钱包的事。 */
    forget: function () { chosen = null; remember(null); emit(); },
    has: function () { return !!provider(); },
    /** 列表变化时回调（扩展注入得晚，界面要能跟着刷新） */
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    rescan: rescanAll,
    /** 连接前弹的选择器（规矩见 pick() 顶上的注释）。≥2 个一定弹；opts.force=true 即使只有一个也弹。 */
    pick: pick,
    /** Binance App 深链（手机端没有注入环境时的入口）。格式出处见函数顶注释。 */
    binanceDeepLink: binanceDeepLink,
    /** MetaMask / OKX 的 App 深链（同上，格式出处见各自函数顶注释）。 */
    metamaskDeepLink: metamaskDeepLink,
    okxDeepLink: okxDeepLink,
    /** 切链 / 加链（EIP-3326 + EIP-3085）。链参数由调用方现读传入，见 ensureChainOn 顶注。 */
    ensureChain: ensureChainOn,
    isMobile: isMobileUA
  };
})(typeof window !== 'undefined' ? window : this);
