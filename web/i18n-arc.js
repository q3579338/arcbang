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
    'ARC宇宙': 'ARCBANG',
    '宇宙 NFT · ArcUniverse': 'Universe NFT · ArcUniverse',
    '市场 · ArcMarket': 'Market · ArcMarket',
    '每个 Arc 区块哈希就是一套物理定律：引爆它，看这样的宇宙能不能长出生命':
      'Every Arc block hash is a set of physical laws: detonate it and see whether such a universe can grow life'
  });

  /* ---- web/arc-ui.js，ARC 模式（命名空间 'app'） ---- */
  I.add({
    '正在从 Arc 链上取一个区块…': 'Fetching a block from Arc…',
    'ARC宇宙 · ARCBANG': 'ARCBANG · Simulator',
    '确认交易：免费期，只花 gas': 'Confirm the transaction: free period, gas only',
    '我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希都是一套物理定律——来引爆你自己的，前 387 枚每地址 1 次免费，之后 1 USDC。@arcbang_xyz {2}':
      'I detonated universe {0} on ARCBANG: {1}. Every Arc block hash is a set of physical laws — come detonate your own. First 387 mints free, 1 per address, then 1 USDC. @arcbang_xyz {2}',
    /* 原来这里有两条「我把一个死宇宙救成了…」的广播文案。拯救系统在 ARCBANG 上
       整套下线，那两句连同它们的代码分支一起删掉了，没有改写成含糊话。 */
    '链接里就是这一枚宇宙：谁点开都能看到同一套物理常数。ARCBANG 没有代币、没有铸造奖励、没有邀请返利 —— 引爆永远免费，想留住它才铸成 NFT。':
      'The link is this universe: whoever opens it sees the same physical constants. ARCBANG has no token, no mint reward and no referral rebate — detonating is always free, and you only mint if you want to keep one.',
    /* ---- 2026-09-17：拯救系统在 ARCBANG 上整套下线 ----
       沙盒留着当免费玩法，但在这个站上它叫「调参沙盒」，而且没有任何上链的出口。
       下面几条都是 arc 专属的新句子；bnb / btc 的 key 一个字没动。 */
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
    'Arc 链每 0.5 秒吐出一个区块，每个区块带一串 64 位哈希。这串数字被拆成 20 个创世参数 —— 电磁力有多强、暗能量有多少、空间有几个维度……全由它决定。你不需要懂这些参数：换一个区块，就是换一套物理定律。':
      'Arc seals a new block every 0.5 seconds, and every block carries a 64-digit hash. That number is split into 20 genesis parameters: how strong electromagnetism is, how much dark energy there is, how many dimensions space has. You do not need to understand any of them — a different block is a different set of physical laws.',
    '死掉的宇宙，能推活': 'A dead universe can be pushed back to life',
    '结局不好别扔。进「调参沙盒」，照着提示一格一格地推参数，右边的仪表会跟着动 ——结局标签常常十几格才跳一次，动的是仪表。实测 83% 的死宇宙能推活，中位 4 步。沙盒不花钱、不上链、可撤销，随便试。':
      'A bad ending is not the end of it. Open the parameter sandbox and push the constants one notch at a time, following the prompts; the gauges on the right move with you. The ending label often takes a dozen notches to flip, so watch the gauges. In testing, 83% of dead universes can be pushed back to life, four steps being the median. The sandbox costs nothing, touches no chain, and every step can be undone.'
  }, 'site');

  /* ---- web/market.html 的 arc 改写（命名空间 'market'） ---- */
  I.add({
    /* 拯救系统下线：市场页上「拯救」按钮与「已烧 / 全网已销毁」那几格连同它们的
       词条一起删掉了。 */
    '我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希都是一套物理定律——来引爆你自己的，前 387 枚每地址 1 次免费，之后 1 USDC。@arcbang_xyz {2}':
      'I detonated universe {0} on ARCBANG: {1}. Every Arc block hash is a set of physical laws — come detonate your own. First 387 mints free, 1 per address, then 1 USDC. @arcbang_xyz {2}',
    '链接里就是这一枚宇宙：谁点开都能看到同一套物理常数。ARCBANG 没有代币、没有铸造奖励、没有邀请返利 —— 引爆永远免费，想留住它才铸成 NFT。':
      'The link is this universe: whoever opens it sees the same physical constants. ARCBANG has no token, no mint reward and no referral rebate — detonating is always free, and you only mint if you want to keep one.',
    /* ArcMarket 比 MirrorMarket 多两个动作：卖家改价、任何人清掉一条已失效的挂单。 */
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
    '保底': 'Guaranteed',
    '免费': 'Free',
    '未核': 'unchecked',
    '已定格（不再随积分变）': 'frozen (no longer follows the board)',
    '实时按积分榜算': 'live from the leaderboard',
    '还没有人上榜': 'Nobody on the board yet',
    '已是最后一段': 'the last round',
    '定格时公布': 'announced at the freeze',
    '问不到': 'no answer',
    /* **整句进词典**：'分' / '天' 这种单字在预热页的倒计时里已经是 min / sec 的意思，
       在这儿按「积分 / 天数」再收一遍必然撞车（i18n 的 key 是全局唯一的中文原文）。 */
    '{0} 分': '{0} pts',
    '登记 {0} · 转发 {1} · 邀请 {2}/人（上限 {3} 人）· 分享 {4}/天（上限 {5} 天）':
      'Sign-up {0} · repost {1} · invite {2} each (cap {3}) · broadcast {4}/day (cap {5} days)'
  });

  /* ---- 放号分期（2026-09-18）：web/arc-ui.js 在铸造入口上说的话 ----
     **必须收在这一册**，不能收进 i18n-arc-site.js：那一册只有首页与文档页会加载，
     app.html 的注入层（build-web.js 的 LAYER）里没有它 ——
     收错地方的表现是英文站上这几句仍然是中文，而且一个错都不报。踩过一次。

     口径：**不点名谁是保底层**（名单构成不公开），只说段名。
     命名空间 'app'：arc-ui.js 的 T()/TF()/TX() 查的就是它（查不到会落回全局表）。 */
  I.add({
    '时间待定': 'to be announced',
    '看开放时间 · 登记白名单': 'See the opening times · join the allowlist',
    '铸造还没开：{0} 开放白名单铸造。现在可以先去登记白名单；引爆和模拟器随时都能玩。':
      'Minting has not opened: the allowlist round starts {0}. You can sign up for the allowlist now; detonating and the simulator are open regardless.',
    '现在是保底期，还没轮到你。先到先得期 {0} 开。':
      'The guaranteed round is running and it is not your turn yet. The first-come round starts {0}.',
    '你不在白名单里。先到先得期 {0} 开，公售 {1} 开。':
      'You are not on the allowlist. The first-come round starts {0} and the public sale {1}.',
    '你不在白名单里，公售 {0} 开，到时候人人都能铸。':
      'You are not on the allowlist. The public sale starts {0}, and then anyone can mint.',
    /* 免费额度是白名单的：名单外的人看到的必须是价格，不能是「首批免费」——
       展示和真报价打架比不显示糟得多（钱包弹出来要 1 USDC）。 */
    '{0} {1} 铸造（免费额度只给白名单）': 'Mint for {0} {1} (the free tier is allowlist only)',
    '免费额度只给白名单，你这边按固定价铸造': 'The free tier is allowlist only; you mint at the flat price'
  }, 'app');

  /* ---- web/status.html 的 arc 改写（命名空间 'status'） ---- */
  I.add({
    '两个合约的地址、在线状态与关键参数。点击进区块浏览器。':
      'Addresses, liveness and key parameters of the two contracts. Click through to the explorer.',
    '成交费 ': 'Sale fee ',
    '宇宙 {0} / 1,387': 'Universes {0} / 1,387',
    '宇宙限量 1,387 枚 —— 宇宙 137.87 亿岁，一枚 NFT 就是一千万年。铸满即止。':
      'Hard cap 1,387 universes — the universe is 13.787 billion years old, so one NFT stands for ten million years. Minting stops at the cap.'
  }, 'status');

  /* ---- web/profile.html 的 arc 改写 ----
     拯救入口整个删掉了，这里已经没有专属词条。 */
})(typeof window !== 'undefined' ? window : this);
