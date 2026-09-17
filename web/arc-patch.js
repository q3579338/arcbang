/*
 * web/arc-patch.js —— ARCBANG 产物的文案改写表（**只在 `--site arc` 时被 require**）
 * ------------------------------------------------------------
 * 为什么要有这个文件：
 *   market.html / status.html / profile.html 三页是 bnb / btc / arc 共用的源文件，
 *   而 bnb 与 btc 的产物必须**逐字节不变**（那是这套构建的验收线）。
 *   改源文件就等于改 bnb 的产物；给 arc 各复制一份又会立刻和主线分家。
 *   所以第三条路：源文件一个字不动，落盘之前按这张表把 arc 站该改的地方改掉。
 *   这张表本身就是「arc 和主线差在哪」的**全部**说明，没有第二处。
 *
 * 铁律（specs/arcbang-v1.md）：ARCBANG 在 Arc 链上，gas 就是 USDC，**没有任何代币** ——
 *   没有 BANG、没有铸造奖励、没有邀请返利、没有命名、没有造物。
 *   凡是讲代币经济的段落一律**删掉**，不改写成含糊话。
 *   删掉的段落若被 JS 按 id 取用，换成**保留 id 的 hidden 空壳**，
 *   免得 $('xxx').textContent 在一个不存在的节点上炸掉整页脚本。
 *
 * 每条规则都写死命中次数：源文件改了字而这里没跟上时，构建**当场停下**，
 * 绝不悄悄漏改一处然后让一句「烧 BANG」出现在一个不发币的站上。
 *
 * 用法：build-web.js 在 siteify() **之前**调用 —— 所以这里匹配的是源文件原文
 * （BNBBANG / bnbbang.com 还没被换成 ARCBANG / 本站域名，那一步由 siteify 负责）。
 */
'use strict';

/* 联系邮箱：跟着 SITES.arc.base 的域名走。换域名时这一行和 build-web.js 的 base 一起改。 */
const MAIL = 'admin@arcbang.xyz';

const RULES = {

  /* ============================================================ app.html
     模拟器整页来自离线底稿 dist/mirror.html（源头是仓库根的 index.html），
     那里唯一的站点字样是页脚的联系邮箱。 */
  'app.html': [
    ['<a class="link" href="mailto:admin@bnbbang.com" data-nolang>admin@bnbbang.com</a>',
     '<a class="link" href="mailto:' + MAIL + '" data-nolang>' + MAIL + '</a>'],
    /* 假死看门狗横幅「发送失败，可复制后发到 …」：app.html 里源码（两份 app 层）+ 内联词典的键与值 */
    ['发到 admin@bnbbang.com', '发到 ' + MAIL, 3],
    ['email admin@bnbbang.com', 'email ' + MAIL, 2]
  ],

  /* ============================================================ market.html */
  'market.html': [
    /* ---- <head>：标题 / 描述 / 结构化数据（BNBBANG → ARCBANG 那一步由 siteify 做） ---- */
    ['用 BNB 或 BANG 买卖宇宙 NFT', '买卖宇宙 NFT', 4],
    ['内置市场：挂单、购买、按结局与稀有度筛选宇宙 NFT。BNB 挂单手续费 1%，BANG 挂单 5%，合约上限 10%。',
     '内置市场：挂单、购买、按结局与稀有度筛选宇宙 NFT。挂单手续费 1%，合约上限 10%。', 3],
    ['Mirror Universe NFT market on BSC', 'Mirror Universe NFT market on Arc'],

    /* ---- 挂单表单：计价只剩原生币（USDC），没有第二种币可选 ---- */
    [`          <!-- 两种币走合约里两条不同的支付路径：原生币单成交抽 1%、BANG 单抽 5%，
               都在成交那一刻从买家付的钱里扣，卖家拿其余。挂单本身不区别对待。
               原生币那一项的文字（tBNB / BNB）由 renderChainText() 按 config.js 的 chain 块填。 -->`,
     `          <!-- ARCBANG 只有一种计价：native，在 Arc 上就是 USDC。成交时先按 ERC-2981 付版税
               （ArcUniverse 默认 5%，市场侧截断在 10%），再抽 1% 手续费，其余归卖家。
               这一项的文字由 renderChainText() 按 config.arc.js 的 chain.currency 填。 -->`],
    [`          <select id="fCur">
            <option value="bnb" id="fCurNative" data-nolang></option>
            <option value="bang" data-nolang>BANG</option>
          </select>`,
     `          <select id="fCur">
            <option value="bnb" id="fCurNative" data-nolang></option>
          </select>`],
    ['          手续费在成交时从买家付的钱里扣：BNB 计价单抽 1%、BANG 计价单抽 5%。授权是一次性的：',
     '          手续费在成交时从买家付的钱里扣：先按 ERC-2981 付版税（默认 5%），再抽成交价的 1%。授权是一次性的：'],

    /* ---- 挂单簿的结构体只有 7 个字段 ----
       ArcMarket 的 Listing 比 MirrorMarket 少一个 inBang（那个站不发币，没有第二种计价）。
       解码按下标和步长读，所以下标、步长、长度校验三处都要跟着减一 —— 少改一处的表现是
       整页挂单读成空，而且不报错。

       **inBang 这个键本身留着**（恒为 false）：fmtPrice / cmpPrice / passFil / buy 四处
       都在读它，留一个恒假的键，那四处就一个字都不用改。 */
    [`    var is1155 = uw(hex, base + 5), active = uw(hex, base + 6), inBang = uw(hex, base + 7);
    if (is1155 === null || active === null || inBang === null) return null;
    if (is1155 > 1n || active > 1n || inBang > 1n) return null;  // 字段顺序对不上`,
     `    var is1155 = uw(hex, base + 5), active = uw(hex, base + 6);
    if (is1155 === null || active === null) return null;
    if (is1155 > 1n || active > 1n) return null;                 // 字段顺序对不上`],
    [`      inBang: inBang === 1n            // true = BANG 计价，false = tBNB`,
     `      inBang: false                    // ARCBANG 只有 USDC 一种计价，这个键恒为 false`],
    [`      /* 结构体步长是 8：v5 在末尾加了 inBang。前 7 个字段的下标没变，只有步长变了。 */
      if (words(hex) < oItems + 1 + nItems * 8) return null;
      for (k = 0; k < nItems; k++) {
        one = decListingStruct(hex, oItems + 1 + k * 8, Number(uw(hex, oIds + 1 + k)));`,
     `      /* ARCBANG：结构体步长是 7 —— ArcMarket 没有 inBang 那一格。 */
      if (words(hex) < oItems + 1 + nItems * 7) return null;
      for (k = 0; k < nItems; k++) {
        one = decListingStruct(hex, oItems + 1 + k * 7, Number(uw(hex, oIds + 1 + k)));`],
    [`    if (rest >= len * 8) {                                       // b) Listing[]，没带 id
      for (k = 0; k < len; k++) {
        one = decListingStruct(hex, 2 + k * 8, k);`,
     `    if (rest >= len * 7) {                                       // b) Listing[]，没带 id
      for (k = 0; k < len; k++) {
        one = decListingStruct(hex, 2 + k * 7, k);`],

    /* ---- list() 的签名变了 ----
       ArcMarket 只认一个 NFT 合约（nft 是 immutable）、721 的数量恒为 1、计价只有 USDC，
       所以那三个参数在它的 list 里根本不存在。旧选择器 0x05408a26 在新合约上打不中任何函数，
       会直接 revert —— 这是好事，比打中一个语义变了的函数安全。
       cancel / buy / listings / checkListing / activeListings / listingCount 六个选择器
       两边同形，一个字都不用改。 */
    [`    /* v5 换了签名：多了第 5 个参数 bool inBang（true = 按 BANG 计价）。
       旧选择器 0xbb74a1c2 在新合约上打不中任何函数，直接 revert —— 这是故意的，
       比打中一个语义变了的函数安全。 */
    list:             '0x05408a26',   // list(address,uint256,uint256,uint256,bool)`,
     `    /* ARCBANG（contracts/src/ArcMarket.sol）：市场只认 ArcUniverse 一个合约、
       721 数量恒为 1、计价只有 USDC，所以 list 只收 id 和 price 两个参数。 */
    list:             '0x50fd7367',   // list(uint256,uint256)`],
    [`      var inBang = $('fCur') && $('fCur').value === 'bang';
      return sendTx(ADDR.market, SEL.list + encAddr(a.token) + encUint(a.id) + encUint(1) + encUint(wei) + encBool(inBang));`,
     `      // ARCBANG：list(uint256 id, uint256 price)，价格是 USDC 的 wei（1 USDC = 1e18）
      return sendTx(ADDR.market, SEL.list + encUint(a.id) + encUint(wei));`],

    /* ---- ArcMarket 多出来的两个动作：改价 / 清失效挂单 ----
       MirrorMarket 两个都没有，所以这几条只在 arc 站加，主线产物一个字节不动。
       · updatePrice：只有卖家能改，改的只是 price 一格。没有它的话，
         想换个价只能撤单重挂 —— 两笔 gas，还换来一个新挂单号。
       · cancelStale：**任何人**都能清掉一条已经失效的挂单（卖家把 NFT 转走了、
         或者撤了授权）。卖家把东西卖去别处之后通常不会回来撤单，
         那些点下去必然 revert 的单只能靠别人清。合约只对真失效的单放行，
         有效的单谁调都 revert，所以这不是「别人能撤我的单」。 */
    [`    cancel:           '0x40e58ee5',   // cancel(uint256)
    buy:              '0xd96a094a'    // buy(uint256)`,
     `    cancel:           '0x40e58ee5',   // cancel(uint256)
    buy:              '0xd96a094a',   // buy(uint256)
    updatePrice:      '0x82367b2d',   // updatePrice(uint256,uint256)  ArcMarket 专有
    cancelStale:      '0xe333b097'    // cancelStale(uint256)          ArcMarket 专有`],
    [`    if (isMine(l.seller)) return '<button class="sm" data-act="cancel" data-lid="' + l.id + '">' + esc(T('撤单')) + '</button>';
    if (l.status) return`,
     `    if (isMine(l.seller)) {
      return '<button class="sm" data-act="reprice" data-lid="' + l.id + '">' + esc(T('改价')) + '</button>'
        + '<button class="sm" data-act="cancel" data-lid="' + l.id + '">' + esc(T('撤单')) + '</button>';
    }
    // status 2/3 = 卖家不持有 / 撤了授权，正是 cancelStale 认的那两种失效
    if (l.status === 2 || l.status === 3) return '<button class="sm" data-act="stale" data-lid="' + l.id + '">' + esc(T('清失效挂单')) + '</button>';
    if (l.status) return`],
    [`          + '<td class="r"><button class="sm" data-act="cancel" data-lid="' + l.id + '">' + esc(T('撤单')) + '</button></td></tr>';`,
     `          + '<td class="r"><button class="sm" data-act="reprice" data-lid="' + l.id + '">' + esc(T('改价')) + '</button>'
          + '<button class="sm" data-act="cancel" data-lid="' + l.id + '">' + esc(T('撤单')) + '</button></td></tr>';`],
    [`    else if (act === 'cancel') runTx(function () { return T('撤单') + ' #' + lid; }, function () { return sendTx(ADDR.market, SEL.cancel + encUint(lid)); });
  });
`,
     `    else if (act === 'cancel') runTx(function () { return T('撤单') + ' #' + lid; }, function () { return sendTx(ADDR.market, SEL.cancel + encUint(lid)); });
    else if (act === 'stale') runTx(function () { return T('清失效挂单') + ' #' + lid; }, function () { return sendTx(ADDR.market, SEL.cancelStale + encUint(lid)); });
    else if (act === 'reprice') reprice(lid);
  });

  /* 改价（ArcMarket.updatePrice）。新价用 prompt 收 —— 这一页没有现成的输入弹层，
     为一个只填一个数的动作新建一套灯箱不值当。价格解析不出来或为 0 就一笔都不发：
     合约那边 price==0 是 revert，白烧一次 gas 不如在这里拦住。 */
  function reprice(lid) {
    var l = null;
    (S.listings || []).forEach(function (x) { if (String(x.id) === String(lid)) l = x; });
    if (!l) { toast(function () { return T('这一单读不到了，刷新看看'); }, 'err'); return; }
    var raw = window.prompt(TF('新的总价（{0}）', CUR), fmtBNB(l.price));
    if (raw === null) return;                       // 点了取消
    var wei = toWei(raw);
    if (wei === null || wei <= 0n) { toast(function () { return T('价格填得不对，写成 0.02 这样'); }, 'err'); return; }
    runTx(function () { return T('改价') + ' #' + lid; },
          function () { return sendTx(ADDR.market, SEL.updatePrice + encUint(lid) + encUint(wei)); });
  }
`],

    /* ---- 页脚说明 ---- */
    /* 拯救系统在 ARCBANG 上整套下线：卡上没有「已烧」这一格，页脚这句跟着删掉，
       不改写成含糊话。前半句（「已验证」）留着 —— 它讲的是签名，与拯救无关。 */
    [' 「已烧」= <span class="mono">burnedOn</span>，这枚 token 上累计销毁的 BANG，链上可查、伪造不了。',
     ''],
    [`    <!-- 名字这一句单独一个文本节点：拆成几段再拼，英文的语序对不上（见 i18n-market.js 的第 2 条）。 -->
    名字 = 持有人烧 BANG 登记的，在本系列内唯一（原生与造物是两套独立名册）；大小写和同形字（O/0、I i L l/1）都算重名，名字跟着 NFT 一起转手。<br>`,
     `    <!-- 命名（BangNames）整套建在 BANG 上，ARCBANG v1 不上：这一句直接删掉，不改写成含糊话。 -->`],
    ['    <a href="mailto:admin@bnbbang.com" data-nolang>admin@bnbbang.com</a>',
     '    <a href="mailto:' + MAIL + '" data-nolang>' + MAIL + '</a>'],

    /* ---- 「已烧掉」那一格：ARCBANG 上没有销毁，整格不渲染 ----
       上面那几行（burned / has / txt / note）不动：它们只是几个局部变量，
       删掉会牵动缩进和下面 rescuedAt 那一支，收益为零。 ---- */
    [`    var html = '<div class="burnbox">'
      + '<div class="statlab">' + esc(T('已烧掉')) + '</div>'
      + '<div class="burnval ' + (has ? 'burned' : 'noburn') + '">' + esc(txt)
      + (burned === null || burned === undefined ? '' : '<span class="unit">BANG</span>') + '</div>'
      + '<div class="statnote">' + esc(note) + '</div></div>';`,
     `    var html = '';        // ARCBANG：拯救下线，没有 burnedOn 可报，这一格整个不出现`],

    /* ---- 卡底那颗「拯救」按钮：整颗不渲染 ---- */
    [`    return '<button class="sm fix" data-act="fix" data-id="' + id + '" title="'
      + esc(T('烧 BANG 改写它的参数，销毁量记进这枚 NFT')) + '">'
      + esc(T('拯救')) + '</button>';`,
     `    return '';            // ARCBANG：拯救系统下线，卡底不出这颗按钮`],

    /* ---- BANG 数字条：没有代币，整条不出现 ---- */
    [`    $('bangbar').innerHTML =
      '<div class="stat"><div class="statlab">' + esc(T('我的 BANG 余额')) + '</div>'
      + '<div class="statval">' + esc(bal) + (ADDR.bang && S.bang != null && S.account ? '<span class="unit">BANG</span>' : '') + '</div>'
      + '<div class="statnote">' + esc(note) + '</div></div>'
      + '<div class="stat"><div class="statlab">' + esc(T('全网已销毁')) + '</div>'
      + '<div class="statval">' + esc(tb) + (S.totalBurned != null ? '<span class="unit">BANG</span>' : '') + '</div>'
      + '<div class="statnote">' + esc(tbnote) + '</div></div>'
      + nameStat;`,
     `    /* ARCBANG：没有代币，也没有拯救 —— 「我的 BANG 余额 / 全网已销毁 /
        命名已销毁」三格一个都不存在，整条数字条连同它的外边距一起收掉。 */
    $('bangbar').innerHTML = '';
    $('bangbar').hidden = true;`],

    /* ---- 筛选条：没有第二种计价币；来源只有 Arc 一种 ---- */
    [`        + '<option value="bang"' + (f.cur === 'bang' ? ' selected' : '') + ' data-nolang>BANG</option></select>';`,
     `        + '</select>';`],
    [`  var SRC_OPTS = [['all', '全部来源'], ['btc', '₿ 比特币'], ['bnb', 'BNB']];`,
     `  var SRC_OPTS = [['all', '全部来源']];   /* ARCBANG：这个市场只有 Arc 宇宙，没有第二种来源 */`],

    /* ---- 广播文案 ---- */
    [`    if (d.kind === 'c') {
      return TX('我把一个死宇宙救成了「{0}」（{1} 档造物宇宙 #{2}）。烧 BANG 改写物理常数——BNBBANG，宇宙可以手作。{3}',
                d.outcome, d.rar, d.id, link).replace(/\\s+$/, '');
    }
    return TX('我在 BNBBANG 引爆了宇宙 {0}：{1}。每个 BNB 区块哈希都是一套物理定律——来引爆你自己的，前 100 万枚每地址 10 次免费，之后 0.01 BNB。{2}',
              '#' + d.no, d.outcome, link).replace(/\\s+$/, '');`,
     `    /* ARCBANG：没有造物系列，价格与免费额度按 specs/arcbang-v1.md */
    return TX('我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希都是一套物理定律——来引爆你自己的，前 387 枚每地址 1 次免费，之后 1 USDC。@arcbang_xyz {2}',
              '#' + d.no, d.outcome, link).replace(/\\s+$/, '');`],
    [`    $('shareNote').textContent =
      (S.account
        ? T('链接已带上你的推广地址。邀请好友引爆宇宙：好友铸造奖励的 10% 归你，好友的好友再给你 5% —— 人工核对后从邀请返利专款（2 亿）发放，链上留痕可查。')
        : T('未连接钱包：链接不带推广地址，照常能广播。连接钱包再广播，好友铸造奖励的 10% 归你，好友的好友再给你 5% —— 人工核对后从邀请返利专款（2 亿）发放，链上留痕可查。'))
      + ' ' + T('邀请返利专款 2 亿 BANG。')
      + T('女巫账户（自邀、批量小号、刷量）经人工核对一律不予发放。');`,
     `    /* ARCBANG：没有代币，也就没有铸造奖励与邀请返利可言 */
    $('shareNote').textContent =
      T('链接里就是这一枚宇宙：谁点开都能看到同一套物理常数。ARCBANG 没有代币、没有铸造奖励、没有邀请返利 —— 引爆永远免费，想留住它才铸成 NFT。');`],

    /* ---- 配置条：没有代币合约，也没有命名合约 ---- */
    [`      { k: '宇宙 NFT', v: ADDR.universe, key: 'contract' },
      { k: 'BANG 代币', v: ADDR.bang, key: 'bangToken' },
      { k: '市场', v: ADDR.market, key: 'market' },
      /* 命名合约也列出来。没填地址时它就那么亮着"未部署"——那正是要说的话：
         这一栏是给运维看的，缺哪一个一眼就知道要去 config.js 里补哪个键。 */
      { k: '命名', v: ADDR.names, key: 'bangNames' }`,
     `      /* ARCBANG：v1 只有两个合约（ArcUniverse + ArcMarket），
         代币与命名那两行在这里不是「未部署」，是**永远不会有** */
      { k: '宇宙 NFT', v: ADDR.universe, key: 'contract' },
      { k: '市场', v: ADDR.market, key: 'market' }`]
  ],

  /* ============================================================ status.html */
  'status.html': [
    ['<title>BNBBANG · 系统状态</title>', '<title>ARCBANG · 系统状态</title>'],
    ['  <span class="eyebrow" id="eyebrow">BNBBANG · STATUS</span>\n  <h1>BNBBANG <span class="dot">·</span> 系统状态</h1>',
     '  <span class="eyebrow" id="eyebrow">ARCBANG · STATUS</span>\n  <h1>ARCBANG <span class="dot">·</span> 系统状态</h1>'],

    /* ---- 铸造进度：1,387 枚（宇宙 137.87 亿岁，一枚 = 一千万年）；没有造物系列 ---- */
    [`    <p class="why">宇宙限量 1,707,000 枚；造物没有数量上限，铸一枚烧一次 BANG——成本即闸门。</p>
    <div class="kline"><span>宇宙 NFT · MirrorUniverse</span>
      <span><span class="num" id="muSupply">—</span> <span class="dimtx">/ 1,707,000</span></span></div>
    <div class="bar"><i class="seg-mint" id="muBar" style="width:0"></i></div>
    <div class="kline" style="margin-top:16px"><span>造物 NFT · MirrorCrafted</span>
      <span><span class="num" id="cfSupply">—</span> <span class="dimtx">/ ∞ · 成本即闸门</span></span></div>`,
     `    <p class="why">宇宙限量 1,387 枚 —— 宇宙 137.87 亿岁，一枚 NFT 就是一千万年。铸满即止。</p>
    <div class="kline"><span>宇宙 NFT · ArcUniverse</span>
      <span><span class="num" id="muSupply">—</span> <span class="dimtx">/ 1,387</span></span></div>
    <div class="bar"><i class="seg-mint" id="muBar" style="width:0"></i></div>
    <!-- ARCBANG 没有造物系列（它的定价整套建在 BANG 上）：这一行删掉，
         只留一个 hidden 的 id 壳子给下面的 $('cfSupply') 用。 -->
    <span id="cfSupply" hidden></span>`],

    /* ---- 代币分发全景：整块换成保留 id 的 hidden 空壳 ---- */
    [`  <!-- ============================================ 代币分发全景（默认展开） -->
  <details class="fold" data-fold="dist" open>
    <summary><h2>代币分发全景</h2><span class="fsum" id="fsDist">—</span></summary>`,
     `  <!-- ============================================ 代币分发全景：
       ARCBANG 没有代币，这一整块在这个站上不存在。保留 id 的 hidden 空壳，
       是因为下面的脚本会按 id 写这些节点 —— 删干净会让整段读数在第一个
       $('distWhy') 上抛 TypeError，连铸造进度一起黑掉。 -->
  <details class="fold" data-fold="dist" hidden>
    <summary><span class="fsum" id="fsDist"></span></summary>`],
    [`    <p class="why" id="distWhy">BANG 总量 10 亿，零预铸，四份：铸造奖励 6 亿 + 邀请返利 2 亿 + 团队 1 亿 + 上交易所费用 1 亿，全部从零按规则发出。2 亿是从原 8 亿铸造额度里划出来的（一级 10% / 二级 5%，人工核对后发放，女巫不予发放），预期实发约 4.74 亿，不到 6 亿，铸造奖励的发放规则一分不变。</p>`,
     `    <p class="why" id="distWhy" hidden></p>`],
    [`      <div class="row"><span class="k">铸造奖励已赠送 <b id="dRewardCap">/ 6 亿</b></span>
        <span class="num" id="dGive">—</span></div>
      <div class="row" id="rowRef"><span class="k"><span id="dRefCapLabel">邀请返利 2 亿</span> · <span id="dRefFlag">—</span> · 已发放</span>
        <span class="num" id="dRef">—</span></div>
      <div class="row"><span class="k"><span id="dDevCapLabel">团队 1 亿</span> · <span id="dDevFlag">—</span> · 已领取</span>
        <span class="num" id="dDev">—</span></div>
      <div class="row"><span class="k"><span id="dPromoCapLabel">上交易所费用 1 亿</span> · <span id="dPromoFlag">—</span> · 已发放</span>
        <span class="num" id="dPromo">—</span></div>
      <div class="row"><span class="k">累计销毁 <b>—— 拯救全烧、造物烧两成、命名也烧</b></span>
        <span class="num" id="dBurn">—</span></div>`,
     `      <span id="dRewardCap"></span><span id="dGive"></span><span id="rowRef"></span>
      <span id="dRefCapLabel"></span><span id="dRefFlag"></span><span id="dRef"></span>
      <span id="dDevCapLabel"></span><span id="dDevFlag"></span><span id="dDev"></span>
      <span id="dPromoCapLabel"></span><span id="dPromoFlag"></span><span id="dPromo"></span>
      <span id="dBurn"></span>`],

    /* ---- 合约矩阵：v1 只有两个合约 ---- */
    [`  var ROWS = [
    /* [中文名, 合约名, 地址, 参数格填充器 key] */
    ['BANG 代币', 'BangToken', CFG.bangToken, 'bang'],
    ['宇宙 NFT', 'MirrorUniverse', CFG.contract, 'mu'],
    ['市场', 'MirrorMarket', CFG.market, 'market'],
    ['命名', 'BangNames', CFG.bangNames, 'names'],
    ['团队锁仓', 'BangVesting', VESTING, 'vesting'],
    ['上交易所费用金库', 'BangPromo', PROMO, 'promo'],
    ['造物 NFT', 'MirrorCrafted', CFG.crafted, 'crafted']
  ];`,
     `  /* ARCBANG（specs/arcbang-v1.md §四）：v1 只部署两个合约 —— 没有代币，
     命名 / 造物 / 锁仓 / 金库那五行在这个站上不是「未部署」，是永远不会有。 */
  var ROWS = [
    /* [中文名, 合约名, 地址, 参数格填充器 key] */
    ['宇宙 NFT', 'ArcUniverse', CFG.contract, 'mu'],
    ['市场', 'ArcMarket', CFG.market, 'market']
  ];`],
    [`      st('bang', T('已发行') + ' <span class="num">' + fmtBang(toBig(V.bangSupply)) + '</span>');
      st('mu', gateTxt(V.muSigner));
      st('market', T('费 BANG ') + bps(V.mktBangFee) + ' / BNB ' + bps(V.mktBnbFee));
      st('names', T('命名烧 BANG'));`,
     `      st('mu', gateTxt(V.muSigner));
      st('market', T('成交费 ') + bps(V.mktBnbFee));`],

    /* ---- 摘要行 ---- */
    [`      var pct = Number(mu * 10000n / 1707000n) / 100;`,
     `      var pct = Number(mu * 10000n / 1387n) / 100;`],
    [`      $('fsMint').textContent = TX('宇宙 {0} / 1,707,000 · 造物 {1}',
        (mu == null ? '—' : grp(mu.toString())), (cf == null ? '—' : grp(cf.toString())));
      $('fsDist').textContent = TX('已发行 {0} / 10 亿 · 已销毁 {1}', fmtYi(minted), fmtYi(burned));`,
     `      $('fsMint').textContent = TF('宇宙 {0} / 1,387', (mu == null ? '—' : grp(mu.toString())));`],

    /* ---- 两句说明 ---- */
    [`    $('distWhy').innerHTML = REF
      ? T('BANG 总量 10 亿，零预铸，四份：铸造奖励 6 亿 + <b>邀请返利 2 亿</b> + 团队 1 亿 + 上交易所费用 1 亿，全部从零按规则发出。<br>2 亿是从原 8 亿铸造额度里划出来的（一级 10% / 二级 5%，人工核对后发放，女巫不予发放），预期实发 4.74 亿 &lt; 6 亿，<b>铸造奖励的发放规则一分不变</b>。这一套合约已按四份部署 —— 下面第二行就是返利池的注入与发放进度。')
      : T('BANG 总量 10 亿，零预铸，四份：铸造奖励 6 亿 + 邀请返利 2 亿 + 团队 1 亿 + 上交易所费用 1 亿，全部从零按规则发出。2 亿是从原 8 亿铸造额度里划出来的（一级 10% / 二级 5%，人工核对后发放，女巫不予发放），预期实发约 4.74 亿，不到 6 亿，铸造奖励的发放规则一分不变。');
    $('mxWhy').textContent = REF
      ? T('八个合约的地址、在线状态与关键参数。点击进区块浏览器。')
      : T('八个合约的地址、在线状态与关键参数。点击进区块浏览器。');`,
     `    /* ARCBANG：分发全景整块是 hidden 的，这里不再往里写任何一个字 */
    $('mxWhy').textContent = T('两个合约的地址、在线状态与关键参数。点击进区块浏览器。');`],
    [`    <p class="why" id="mxWhy">八个合约的地址、在线状态与关键参数。点击进区块浏览器。</p>`,
     `    <p class="why" id="mxWhy">两个合约的地址、在线状态与关键参数。点击进区块浏览器。</p>`],

    ['      <a href="mailto:admin@bnbbang.com" data-nolang>admin@bnbbang.com</a>',
     '      <a href="mailto:' + MAIL + '" data-nolang>' + MAIL + '</a>'],
    /* 经济页在 arc 站不进包（整页是代币经济学），页脚那条链接跟着去掉 */
    ['      <a href="economy.html">经济</a>\n', '']
  ],

  /* ============================================================ profile.html */
  'profile.html': [
    /* ---- 余额格：没有 BANG 余额这回事 ---- */
    [`        <div class="bal"><div class="ballab">BANG 余额</div><div class="balval wait" id="pBang">读取中…</div></div>
        <!-- 单位名由 config.js 的 chain.currency 填（renderChainText），不写死 -->`,
     `        <!-- ARCBANG 没有代币：BANG 余额那一格整个不存在。
             单位名由 config.js 的 chain.currency 填（renderChainText），不写死 -->`],
    [`    var b = balHtml(S.bang, 'BANG'), n = balHtml(S.bnb, CUR);
    $('pBang').className = 'balval' + b.cls; $('pBang').innerHTML = b.html;
    $('pBnb').className = 'balval' + n.cls; $('pBnb').innerHTML = n.html;`,
     `    /* ARCBANG：只剩原生币（USDC）那一格 */
    var n = balHtml(S.bnb, CUR);
    $('pBnb').className = 'balval' + n.cls; $('pBnb').innerHTML = n.html;`],

    /* ---- 造物系列：ARCBANG v1 不上（它的定价整套建在 BANG 上），
           标题连同容器一起收起来，只留 id 给 renderAssets 用 ---- */
    [`      <h3>造物</h3>
      <div id="craftGrid" class="pgrid"></div>`,
     `      <div id="craftGrid" class="pgrid" hidden></div>`],

    /* ---- 持仓卡上那条「拯救」链接：整条不渲染 ---- */
    [`    return '<a class="pfix" href="app.html?bang=' + esc(m.blockHash) + '&amp;fix=1" title="'
      + esc(P('烧 BANG 改写它的参数，销毁量记进这枚 NFT')) + '">' + esc(P('拯救')) + '</a>';`,
     `    return '';            // ARCBANG：拯救系统下线，持仓卡上没有这条入口`],

    /* ---- 「我的销毁」整节：ARCBANG 上没有销毁这回事 ----
       换成**保留 id 的 hidden 空壳**：本页脚本按 id 直取 #pBurn，
       真删干净会在那里抛 TypeError，把整页读数一起带走。 ---- */
    [`    <!-- 4. 我的销毁 -->
    <section class="card">
      <h2>我的销毁</h2>
      <div class="burnbig wait" id="pBurn">读取中…</div>
      <p class="tiny dim">名下原生宇宙 burnedOn 之和 · 这些销毁支撑着全网价值</p>
    </section>`,
     `    <!-- 4. 我的销毁：ARCBANG 没有拯救，也就没有销毁。只留 id 的 hidden 空壳。 -->
    <section class="card" hidden><span id="pBurn"></span></section>`],

    /* ---- 邀请奖励的单位（整块 hidden，留着以防将来解锁） ---- */
    [`      g.innerHTML = esc(group(st.granted)) + '<span class="unit">' + esc('BANG · ' + P('链上已发放')) + '</span>';`,
     `      g.innerHTML = esc(group(st.granted)) + '<span class="unit">' + esc(P('链上已发放')) + '</span>';`],

    ['    <a href="mailto:admin@bnbbang.com" data-nolang>admin@bnbbang.com</a>',
     '    <a href="mailto:' + MAIL + '" data-nolang>' + MAIL + '</a>']
  ]
};

/* 「我的邀请」整块：ARCBANG 没有代币，也就没有邀请返利。
   换成**保留全部 id 的 hidden 空壳** —— 那一节的脚本（renderRef / renderRefCode /
   renderReferralGrants 与几颗按钮的 addEventListener）都是按 id 直取节点的，
   真删干净会在第一个 $('pRefLink') 上抛 TypeError，把整页读数一起带走。 */
const PROFILE_REF_FROM = `    <!-- 2. 我的邀请 -->
    <section class="card refcard">
      <h2>我的邀请</h2>
      <p class="sub">专属邀请链接</p>
      <div class="reflink">
        <span class="mono" id="pRefLink"></span>
        <button id="btnCopyRef" class="sm" type="button">复制链接</button>
      </div>
      <!-- 8 位推广短码（specs/share-referral-v1.md §8 + broadcast-v2.md §一）。
           链接里那 42 个字符的地址换成 8 位码，整条链接短一半还多。
           「换一个」= 重新随机一个再认领；「自定义」= 自己挑 8 位。
           两条都要**签一次名**（不花 gas）—— 没有签名的话谁都能改别人的码，
           而短码是拿返利的凭据。 -->
      <div class="refcode">
        <span class="refcodelab">我的短码</span>
        <span class="mono refcodeval" id="pRefCode">读取中…</span>
        <button id="btnRefRoll" class="sm" type="button">换一个</button>
        <button id="btnRefEdit" class="sm" type="button">自定义</button>
      </div>
      <div class="refedit" id="refEdit" hidden>
        <input id="refInput" type="text" maxlength="8" inputmode="latin"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               placeholder="8 位，A–Z 与 2–9（没有 O/0/I/1）">
        <button id="btnRefClaim" class="sm" type="button">认领</button>
        <button id="btnRefCancel" class="sm" type="button">取消</button>
      </div>
      <p id="refMsg" class="err tiny" hidden></p>
      <div class="balgrid">
        <div class="bal"><div class="ballab">一级邀请</div><div class="balval wait" id="pRef1">统计生成中</div></div>
        <div class="bal"><div class="ballab">二级邀请</div><div class="balval wait" id="pRef2">统计生成中</div></div>
      </div>
      <!-- 邀请奖励（链上已发放）+ 我邀请的人（specs/profile-referral-v2.md）。
           数字 = 返利金库 Granted 事件按我地址求和，是**已经发生**的链上事实；
           这里绝不出现「预计可得/待发放」—— 数额未定，算出来就是空头支票。
           上面 pRef1/pRef2 那两格是另一条接口（/api/referrals/mine）的统计占位，
           与这一块各归各，不复用、不接线。 -->
      <div class="balgrid">
        <div class="bal">
          <div class="ballab">邀请奖励</div>
          <div class="balval wait" id="pGrant">读取中…</div>
          <p class="grantnote">好友铸造奖励的一级 10% / 二级 5%，人工核对后发放，女巫不予发放</p>
        </div>
      </div>
      <div class="invites">
        <h3>我邀请的人</h3>
        <div class="invbody" id="invBody"><div class="invwait">读取中…</div></div>
      </div>
      <ul class="refnotes">
        <li>一级 10% · 二级 5%，基数是好友的铸造奖励</li>
        <li>人工核对后从邀请返利专款 2 亿 BANG 发放</li>
        <li>女巫账户（自邀、批量小号、刷量）一律不予发放</li>
      </ul>
    </section>`;
const PROFILE_REF_TO = `    <!-- 2. 我的邀请：ARCBANG 没有代币，没有铸造奖励，也就没有邀请返利这回事。
         整节换成**只剩 id 的 hidden 空壳**，一个字也不摆：本页的脚本
         （renderRef / renderRefCode / renderReferralGrants 和六颗按钮的
         addEventListener）全是按 id 直取节点的，真删干净会在第一个
         $('pRefLink') 上抛 TypeError，把整页读数一起带走。 -->
    <section class="card refcard" hidden>
      <span class="mono" id="pRefLink"></span>
      <button id="btnCopyRef" type="button" hidden></button>
      <span id="pRefCode"></span>
      <button id="btnRefRoll" type="button" hidden></button>
      <button id="btnRefEdit" type="button" hidden></button>
      <div id="refEdit" hidden><input id="refInput" type="text" maxlength="8">
        <button id="btnRefClaim" type="button" hidden></button>
        <button id="btnRefCancel" type="button" hidden></button></div>
      <p id="refMsg" hidden></p>
      <span id="pRef1"></span><span id="pRef2"></span>
      <span id="pGrant"></span><span id="invBody"></span>
    </section>`;
RULES['profile.html'].unshift([PROFILE_REF_FROM, PROFILE_REF_TO]);

/* 站族友情链接：ARCBANG 是独立站（2026-09-17 用户拍板），不挂 satloot 站族的友链。
   三张共用页的页脚都有 <nav class="sitefriends">…</nav>，源文件不动，落盘前整块剥掉。
   用正则而不是逐字规则：三页的友链内容会随站族变化，逐字对会经常失配。 */
const FRIENDS_RE = /\s*<!--\s*友情链接[\s\S]*?-->\s*<nav class="sitefriends"[\s\S]*?<\/nav>|\s*<nav class="sitefriends"[\s\S]*?<\/nav>/g;

/* ------------------------------------------------------------ 代码仓库地址
   ARCBANG 有自己的公开仓库（2026-09-17 用户拍板）：github.com/q3579338/arcbang。
   arc 站上**一个 bnbbang 仓库的链接都不许出现** —— 那是另一条产品线的仓库，
   点过去看到的是 BNB 链的代币经济，和一个不发币的站对不上。

   为什么做成这里的一条通用规则，而不是逐个改源文件：
     · 引擎层（web/bnb-ui.js 的 ENGINE_SRC）与词典（i18n-app / i18n-site）是三站共用的，
       改源文件就等于改 bnb / btc 的产物 —— 那是这套构建的验收线；
     · arc 自己那几份文档页在被反复重写，逐字规则会天天失配。
   所以：源文件一个字不动，落盘前统一改写。顺序从具体到笼统，先匹配的先赢。

   落点（按下面的顺序）：
     · 签名协议那一段原本指 bnbbang-economy 里的 docs/signing-protocol.md，
       新仓库里没有那份文档，改指真正实现它的 server/sign.js（连可见文字一起换，
       否则页面上写着一个不存在的路径）；
     · `git clone … && cd bnbbang-engine` 连 cd 的目标一起换，照抄下来能直接跑；
     · 当 href 用的（后面紧跟引号或空白）指到 /tree/main/engine —— 引擎在那个子目录；
     · 其余裸写的域名/路径一律指仓库根。 */
const REPO = 'https://github.com/q3579338/arcbang';
const REPO_RULES = [
  [/https:\/\/github\.com\/q3579338\/bnbbang-economy\/blob\/main\/docs\/signing-protocol\.md/g, REPO + '/blob/main/server/sign.js'],
  [/>docs\/signing-protocol\.md</g, '>server/sign.js<'],
  [/git clone (?:https:\/\/)?github\.com\/q3579338\/bnbbang-engine(?: && cd bnbbang-engine)?/g,
    function (m) { return 'git clone ' + REPO + (/&& cd/.test(m) ? ' && cd arcbang' : ''); }],
  [/\bcd bnbbang-engine\b/g, 'cd arcbang'],
  [/>bnbbang-engine</g, '>arcbang/engine<'],
  [/https:\/\/github\.com\/q3579338\/bnbbang-engine(?=["'\s)])/g, REPO + '/tree/main/engine'],
  [/(?:https:\/\/)?github\.com\/q3579338\/bnbbang-engine/g, 'github.com/q3579338/arcbang'],
  [/(?:https:\/\/)?github\.com\/q3579338\/bnbbang-economy/g, 'github.com/q3579338/arcbang'],
  [/(?:https:\/\/)?github\.com\/q3579338\/mirror-universe-BNBBANG/g, 'github.com/q3579338/arcbang'],
  [/\bmirror-universe-BNBBANG\b/g, 'arcbang'],
  [/\bbnbbang-(?:engine|economy)\b/g, 'arcbang']
];
function repoify(s) {
  REPO_RULES.forEach(function (r) { s = s.replace(r[0], r[1]); });
  return s;
}
module.exports = function arcPatch(name, html) {
  html = repoify(html);
  if (/\.html$/.test(name)) html = html.replace(FRIENDS_RE, '\n');
  const rules = RULES[name];
  if (!rules) return html;
  rules.forEach(function (r) {
    const from = r[0], to = r[1], want = r[2] || 1;
    if (from === to) return;                       // 占位规则（结构留着，暂时不改）
    let n = html.split(from).length - 1;
    if (n === 0) {                                  // 源文件是 CRLF 时再试一次
      const f2 = from.replace(/\n/g, '\r\n'), t2 = to.replace(/\n/g, '\r\n');
      if (html.split(f2).length - 1 === want) return void (html = html.split(f2).join(t2));
    }
    if (n !== want) {
      console.error('arc-patch：' + name + ' 里这一条命中 ' + n + ' 次，应为 ' + want + '：\n  ' + from.slice(0, 120));
      process.exit(1);
    }
    html = html.split(from).join(to);
  });
  return html;
};
/* 导出给 tools/export-arcbang.js 用：导出到公开仓库的源文件也走同一张改写表，
   免得仓库里的源码还写着 bnbbang 的仓库名。 */
module.exports.repoify = repoify;
