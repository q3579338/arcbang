/*
 * web/i18n-arc.js —— ARCBANG（Arc 链 · USDC · 没有代币）专属文案的中英词条
 * ------------------------------------------------------------
 * 只在 `node web/build-web.js --site arc` 的产物里加载（app.html 的注入层 + 各独立页的 <script>），
 * 格式与其余 i18n 分册相同：
 * key 是中文原文，逐字相等才命中；漏翻的自动退回中文，不会出现裸 key。机制见 web/i18n.js 顶部。
 *
 * 这里**只收 arc 分支才会出现的句子**。凡是三站共用的句子仍走 i18n-app / i18n-tools /
 * i18n-site —— 在这里重复收一遍会触发 i18n.js 的「全局词条被改写」告警。
 * 首页（landing-arc.html）自带的那一册在 web/i18n-arc-site.js，两册互不重叠。
 *
 * 分节按命名空间：
 *   不带命名空间 = 静态文本（顶栏品牌名、面板副标题），由 DOM 遍历翻；
 *   'app'   = web/arc-ui.js 的 T()/TF()/TX()；
 *   'tools' = web/intervene.js 的 T()/TN()；
 *   'site'  = web/onboard.js 的 T()（新手引导）；
 *   'market'= web/market.html（市场页里 arc 口径的那几句）。
 * 带 {0}/{n} 的整句进词典 —— 英文语序不一定跟中文一样，别在外面拼。
 */
(function (root) {
  'use strict';
  var I = root.MirrorI18n;
  if (!I) return;            // i18n 核心没加载：静默退回全中文，不要让页面挂掉

  /* ---- 静态文本（DOM 遍历翻）：顶栏品牌名、面板副标题、输入框提示 ---- */
  I.add({
    /* 起爆页的大标题（build-web.js 注入）与输入框提示：原来两处都没进词典，
       英文界面上是中文（2026-09-20 用户点名）。 */
    'ARCBANG · 引爆任意 Arc 区块': 'ARCBANG · Detonate any Arc block',
    'ARC宇宙': 'ARCBANG',
    '宇宙 NFT · ArcUniverse': 'Universe NFT · ArcUniverse',
    '市场 · ArcMarket': 'Market · ArcMarket',
    '一个区块哈希只对应一个宇宙，铸走之后不再重复': 'One block hash yields one universe; once minted it does not recur',
    '每个 Arc 区块哈希，都是一个宇宙：引爆它，看它能否长出生命':
      'Every Arc block hash is a universe: detonate it and see whether it can grow life'
  });

  /* ---- web/arc-ui.js，ARC 模式（命名空间 'app'） ---- */
  I.add({
    '正在从 Arc 链上取一个区块…': 'Fetching a block from Arc…',
    'ARC宇宙 · ARCBANG': 'ARCBANG · Detonate',
    '确认交易：免费期，只花 gas': 'Confirm the transaction: free period, gas only',
    '我在 ARCBANG 引爆了宇宙 {0}。每个 Arc 区块哈希，都是一个宇宙。1,387 枚，永不增发。@arcbang_xyz @arc {1}':
      'I detonated universe {0} on ARCBANG. Every Arc block hash is a universe. 1,387 pieces. No further issuance, ever. @arcbang_xyz @arc {1}',
    '我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希，都是一个宇宙。1,387 枚，永不增发。@arcbang_xyz @arc {2}':
      'I detonated universe {0} on ARCBANG: {1}. Every Arc block hash is a universe. 1,387 pieces. No further issuance, ever. @arcbang_xyz @arc {2}',
    /* 原来这里有两条「我把一个死宇宙救成了…」的广播文案。拯救系统在 ARCBANG 上
       整套下线，那两句连同它们的代码分支一起删掉了，没有改写成含糊话。 */
    '链接里就是这一枚宇宙：谁点开都能看到同一套物理常数。ARCBANG 没有代币、没有铸造奖励、没有邀请返利 —— 引爆永远免费，想留住它才铸成 NFT。':
      'The link is this universe: whoever opens it sees the same physical constants. ARCBANG has no token, no mint reward and no referral rebate — detonating is always free, and you only mint if you want to keep one.',
    /* ---- 2026-09-17：拯救系统在 ARCBANG 上整套下线 ----
       沙盒留着当免费玩法，但在这个站上它叫「调参沙盒」，而且没有任何上链的出口。
       下面几条都是 arc 专属的新句子；bnb / btc 的 key 一个字没动。 */
    'Arc 区块高度，或粘贴 64 位区块哈希（带不带 0x 都行）':
      'An Arc block height, or paste a 64-character block hash (0x prefix optional)',
    '调参沙盒': 'Parameter sandbox',
    '进调参沙盒': 'Open the sandbox',
    '调参后的宇宙': 'The universe after tuning',
    '沙盒里推出来的参数不上链，也铸不了 —— 它已经不是这个哈希派生出来的宇宙了。<br>想收下这个区块，回起爆页铸<b>原始宇宙</b>。':
      'What you build in the sandbox never goes on chain and cannot be minted: it is no longer the universe this hash derives.<br>To keep this block, go back and mint the <b>original universe</b>.'
  }, 'app');

  /* ---- web/intervene.js，ARC 模式（命名空间 'tools'） ----
     2026-09-17 拯救系统下线：原来这一段十来条全是「付 USDC / 全额销毁 / burnedOn」的
     价签与按钮文案，对应的代码分支已经在 arc 下不可达（renderRescue 直接返回、
     quoteOf 一个报价请求都不发），词条跟着删干净。留下的只有沙盒自己的话。 */
  I.add({
    '调参沙盒': 'Parameter sandbox',
    '<b>这是沙盒</b> —— 推参数不花钱、不上链，推出来的宇宙也不能铸。想收下一个区块，回起爆页铸它的原始宇宙。':
      '<b>This is a sandbox.</b> Pushing constants costs nothing, touches no chain, and what you build here cannot be minted. To keep a block, go back and mint its original universe.',
    '（沙盒不收费，推不动就换一个）': '(the sandbox is free; if it will not move, try another universe)',
    '共推了 {n} 格。沙盒里的参数不上链，换个宇宙可以从头再来。':
      '{n} steps in all. Nothing here goes on chain, so pick another universe and start over whenever you like.',
    '调参后的 Arc 区块 {n}（推了 {m} 格）': 'Arc block {n} after tuning ({m} steps)'
  }, 'tools');

  /* ---- web/onboard.js 新手引导第 1 / 3 步（命名空间 'site'；第 2 步与 bnb 站同 key） ----
     第 3 步在 arc 上换了措辞：拯救下线之后「救活」是那套话术的词，沙盒改叫「调参沙盒」。 */
  I.add({
    'Arc 链每 0.5 秒产出一个区块，每个区块带一串 64 位哈希。这串数字被拆成 23 个创世参数 —— 电磁力有多强、暗能量有多少、空间有几个维度……全由它决定。你不需要懂这些参数：换一个区块，就是换一套物理定律。':
      'Arc seals a new block every 0.5 seconds, and every block carries a 64-digit hash. That number is split into 23 genesis parameters: how strong electromagnetism is, how much dark energy there is, how many dimensions space has. You do not need to understand any of them — a different block is a different set of physical laws.',
    '死掉的宇宙，能推活': 'A dead universe can be pushed back to life',
    '结局不好别扔。进「调参沙盒」，照着提示一格一格地推参数，右边的仪表会跟着动 ——结局标签常常十几格才跳一次，动的是仪表。实测 83% 的死宇宙能推活，中位 4 步。沙盒不花钱、不上链、可撤销，随便试。':
      'A bad ending is not the end of it. Open the parameter sandbox and push the constants one notch at a time, following the prompts; the gauges on the right move with you. The ending label often takes a dozen notches to flip, so watch the gauges. In testing, 83% of dead universes can be pushed back to life, four steps being the median. The sandbox costs nothing, touches no chain, and every step can be undone.'
  }, 'site');

  /* ---- web/market.html 的 arc 改写（命名空间 'market'） ---- */
  I.add({
    /* 拯救系统下线：市场页上「拯救」按钮与「已烧 / 全网已销毁」那几格连同它们的
       词条一起删掉了。 */
    '我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希，都是一个宇宙。1,387 枚，永不增发。@arcbang_xyz @arc {2}':
      'I detonated universe {0} on ARCBANG: {1}. Every Arc block hash is a universe. 1,387 pieces. No further issuance, ever. @arcbang_xyz @arc {2}',
    '链接里就是这一枚宇宙：谁点开都能看到同一套物理常数。ARCBANG 没有代币、没有铸造奖励、没有邀请返利 —— 引爆永远免费，想留住它才铸成 NFT。':
      'The link is this universe: whoever opens it sees the same physical constants. ARCBANG has no token, no mint reward and no referral rebate — detonating is always free, and you only mint if you want to keep one.',
    /* ArcMarket 比 ArcMarket 多两个动作：卖家改价、任何人清掉一条已失效的挂单。 */
    'ARCBANG · 市场': 'ARCBANG · Market',
    '改价': 'Change price',
    '清失效挂单': 'Clear stale listing',
    '新的总价（{0}）': 'New total price ({0})'
  }, 'market');

  /* ---- 积分榜的通用短词（2026-09-18）----
     **收在这一册而不是 i18n-arc-site.js**：状态页（status.html）也要用它们，
     而那一页只加载 i18n / i18n-site / i18n-market 加本册，不加载首页那一册。
     进全局表（不带 ns）：状态页的 T() 走 'status' 分册，查不到会落回全局。
     这几个词在中文里短得像标签，英文里也必须短 —— 它们出现在表格的一格里。 */
  I.add({
    '白名单': 'Whitelist',
    '白名单 · 保底层': 'Allowlist · guaranteed tier',
    '白名单 · 先到先得层': 'Allowlist · first-come tier',
    '先到先得': 'First-come, first-served',
    '免费': 'Free',
    /* ---- 2026-09-20：下面五条原来与页面上真正那句对不上，逐字改回来了 ----
       key 要**逐字相等**才命中，差一个「动」字就整条漏翻，而且一个错都不报
       （漏翻自动退回中文，正是用户在英文界面上看到中文的那一半原因）。
       原写法 → 现写法：
         '未核'                 → 公开榜不再显示核验状态，整条删（见 status.html）
         '已定格（不再随积分变）' → '已定格（不再随积分变动）'
         '还没有人上榜'          → '暂无上榜地址'
         '已是最后一段'          → '已是最后阶段'
         '问不到'                → '读不到'（'问不到' 只有部署向导在用，留着） */
    '已定格（不再随积分变动）': 'frozen (no longer follows the board)',
    '实时按积分榜算': 'live from the leaderboard',
    '暂无上榜地址': 'Nobody on the board yet',
    '已是最后阶段': 'the last round',
    '定格时公布': 'announced at the freeze',
    '问不到': 'no answer',
    /* **整句进词典**：'分' / '天' 这种单字在预热页的倒计时里已经是 min / sec 的意思，
       在这儿按「积分 / 天数」再收一遍必然撞车（i18n 的 key 是全局唯一的中文原文）。 */
    '{0} 分': '{0} pts',
    '登记 {0} · 关注 {1} · 置顶推互动 {2} · 邀请 {3}/人（上限 {4} 人）· 引爆并广播 {5}/次（累计 {6} 次）':
      'Sign-up {0} · follow {1} · pinned-post engagement {2} · invite {3} each (cap {4}) · detonate and broadcast {5} each (cap {6})'
  });

  /* ---- 放号分期（2026-09-18）：web/arc-ui.js 在铸造入口上说的话 ----
     **必须收在这一册**，不能收进 i18n-arc-site.js：那一册只有首页与文档页会加载，
     app.html 的注入层（build-web.js 的 LAYER）里没有它 ——
     收错地方的表现是英文站上这几句仍然是中文，而且一个错都不报。踩过一次。

     口径：**不点名谁在优先层**（名单构成不公开），只说段名。
     命名空间 'app'：arc-ui.js 的 T()/TF()/TX() 查的就是它（查不到会落回全局表）。 */
  I.add({
    '时间待定': 'to be announced',
    /* 「开放时间：{0}」那种冒号句式里的短写。跟上面那条不是一回事：
       那一条是整句的宾语，这一条是冒号后面孤零零的一个词。 */
    '待定': 'TBA',
    '看开放时间 · 登记白名单': 'See the opening times · join the allowlist',
    /* 2026-09-19 用户拍板：这几句改成产品语气 —— 不出现「玩」「先去」「随时」。 */
    '铸造尚未开放。白名单阶段将于 {0} 开放，可先完成登记与任务。':
      'Minting has not opened. The allowlist round opens {0}. You can complete sign-up and the tasks in the meantime.',
    '铸造尚未开放。白名单阶段开放时间待定，可先完成登记与任务。':
      'Minting has not opened. The allowlist round has no confirmed date yet. You can complete sign-up and the tasks in the meantime.',
    '当前为白名单阶段，仅白名单地址可铸造。先到先得阶段开放时间：{0}。':
      'The allowlist round is open to allowlisted addresses only. First-come round opens: {0}.',
    '该地址不在白名单内。先到先得阶段开放时间：{0}；公售开放时间：{1}。':
      'This address is not on the allowlist. First-come round opens: {0}. Public sale opens: {1}.',
    '该地址不在白名单内。当前为先到先得阶段，公售开放时间：{0}，届时所有地址均可铸造。':
      'This address is not on the allowlist. The first-come round is running; the public sale opens: {0}, when any address can mint.',
            '该地址付费铸造已达上限（每地址 {0} 枚）。': 'This address has reached the paid mint limit ({0} per address).',
    '该地址付费铸造已达上限（每地址最多 3 枚）。': 'This address has reached the paid mint limit (3 per address).',
    '免费额度已用完。': 'The free allocation is used up.',
    '该区块已被铸造。': 'This block has already been minted.',
    '全部 1,387 枚已铸完。': 'All 1,387 universes have been minted.',
    '签名已过期，请重新引爆后再铸。': 'The signature has expired. Detonate again and mint.',
    '签名无效，请刷新页面后重试。': 'Invalid signature. Refresh the page and try again.',
'没有读到铸造价格，请刷新页面后重试。': 'Could not read the mint price. Refresh the page and try again.',
    '付款金额与合约要求不一致（WrongPrice）。交易未发出，请刷新页面后重试。': 'Payment amount does not match the contract (WrongPrice). Nothing was sent. Refresh the page and try again.',
'免费额度已用完，付费铸造将在公售阶段开放（{0}）。':
      'Your free allocation is used up. Paid minting opens in the public sale ({0}).',
    /* 免费额度是白名单的：名单外的人看到的必须是价格，不能是「首批免费」——
       展示和真报价打架比不显示糟得多（钱包弹出来要按 price() 付钱）。 */
    '{0} {1} 铸造（免费额度只给白名单）': 'Mint for {0} {1} (the free tier is allowlist only)',
    '免费额度只给白名单，你这边按固定价铸造': 'The free tier is allowlist only; you mint at the flat price'
  }, 'app');

  /* ---- web/status.html 的 arc 改写（命名空间 'status'） ---- */
  I.add({
    /* 2026-09-20：原来收的是 '…点击进区块浏览器。'，页面上写的是下面这句，
       两者差了三个字 —— 于是英文态整句退回中文。以页面为准。 */
    '两个合约的地址、在线状态与关键参数。点击可在区块浏览器中打开。':
      'Addresses, liveness and key parameters of the two contracts. Click through to the explorer.',
    '成交费 ': 'Sale fee ',
    '宇宙 {0} / 1,387': 'Universes {0} / 1,387',
    '1,387 枚，永不增发。宇宙 137.87 亿岁，一枚 NFT 就是一千万年。铸满即止。':
      '1,387 pieces. No further issuance, ever. The universe is 13.787 billion years old, so one NFT stands for ten million years.',

    /* ---- 放号阶段那一块（2026-09-20 补齐）----
       这一整块原来一条词条都没有：标题、说明段、六个行标签全是中文，
       而同一块里由 JS 拼出来的读数（Whitelist / live from the leaderboard …）
       早就有译文，于是英文界面上中英混排，用户截图报的就是它。
       行标签收在 'status' 分册里 —— '名单' / '分值' 这种两字词在别的页上
       是另一个意思，进全局表会撞车。 */
    '放号阶段': 'Mint rounds',
    '预热期不签发任何铸造签名；白名单阶段仅对白名单地址开放；先到先得阶段对白名单与先到先得地址开放，免费额度先到先得；公售阶段向所有地址开放。免费共 887 枚（保底 387 + 先到先得 500），由积分榜产生，名单于榜单定格时确定。免费额度为每地址 1 枚，额度用尽后，名单内地址同样按公售价铸造。':
      'The warm-up signs no mint signatures at all; the whitelist round is open to whitelisted addresses only; the first-come round is open to both whitelist and first-come addresses, with the free allocation handed out on a first-come basis; the public sale is open to every address. 887 mint free in all (387 guaranteed plus 500 first-come), drawn from the leaderboard, and the list is settled when the board freezes. The free allocation is one per address; once it is used up, addresses on the list mint at the public-sale price like everyone else.',
    '下一段开放': 'Next round opens',
    '名单': 'Allowlist',
    '分值': 'Points'
  }, 'status');

  /* ---- web/profile.html 的 arc 改写 ----
     拯救入口整个删掉了，这里已经没有专属词条。 */
})(typeof window !== 'undefined' ? window : this);
