/*
 * web/config.arc.js —— ARCBANG 站点配置（specs/arcbang-v1.md）
 *
 * 与 bnb / btc 两站的差别只有两处，其余键的语义逐字相同：
 *   1. **没有代币**。bangToken / vesting / promo / referral 四个键在这里不存在 ——
 *      不是留空，是删掉：留空的语义是「还没部署」，而这里是「永远不会有」。
 *      读到 undefined 的地方一律不渲染代币相关的界面。
 *   2. 链换成 Arc。Arc 的 native 就是 USDC（18 位小数），所以 currency 是 'USDC'，
 *      界面上所有「多少 BNB」的位置自动变成「多少 USDC」。
 *
 * 当前指向 **Arc 主网**（chainId 5042）：引爆读的是真实主网区块。
 * 测试网（5042002，水龙头 https://faucet.circle.com/ 免费领）的那一份在文件末尾注释里，
 * 要联调铸造流程时整块替换 chain + rpc。
 */
window.ARCBANG_CONFIG = {
  /* 服务端 API 前缀。引爆的计算和出图都在那边。
     同域部署时保持 '/api'；本地联调改成 'http://127.0.0.1:8801/api'。 */
  apiBase: '/api',
  /* 留空 = 跟着访问者当前的域名走。 */
  siteBase: '',
  /* 站点标识。nav / bnb-ui 按它决定品牌名与取块源；'arc' 走 EVM 取块（与 bnb 同一套），
     不走 btc-source 那条 REST 路。 */
  site: 'arc',

  /* 公售价公不公布（2026-09-19 用户拍板：公售开始前一个价格数字都不出现）。
     false = 铸造页按钮与价格行都不标价，哪怕链上读得到 price()。
     公售开始那天改成 true 重新构建即可；合约常量与 setPrice 不受它影响。 */
  showPrice: false,

  /* 分享卡片版本号（2026-09-19 用户：分享链接也要清除缓存）。
     X / Telegram / Discord 按 URL 缓存卡片，同一个链接几天内不重抓。站内生成的每条分享链接
     （引爆分享 /s/<区块号>、邀请链接 quest.html?ref=）都带上 v=<这个值>；
     卡片文案或 og 图一改，把它 +1 重新构建，新发出去的链接就是新卡片。服务端不读它。 */
  shareVer: '2',

  /* ArcUniverse（宇宙 NFT，contracts/src/ArcUniverse.sol）。
     部署后填这里，并且**服务端 /etc/bnbbang/api.env 的 ARCBANG_CONTRACT 必须同步改**——
     签名把合约地址绑死了，两边不一致时签出来的名在链上一律 BadSig。 */
  /* 2026-09-18 的第一次主网部署（0xd5b4…61ea / 0x73cc…85a8）已作废：上线 20 分钟被脚本薅走 5 枚免费额度，
     改做白名单预热后重新部署。重部署前留空 = 站点显示「合约未部署」，铸造不可用。 */
  contract: '',
  /* 市场（ArcMarket，contracts/src/ArcMarket.sol）。**部署后填这里** ——
     地址从 contracts/tools/deploy-arc.mjs 的输出里抄。空着 = 市场页显示「未部署」。

     只有一种计价：native，在 Arc 上就是 USDC，挂单价是 wei（1 USDC = 1e18）。
     成交时先按 ERC-2981 付版税（ArcUniverse 默认 5%，市场侧截断在 10%），
     市场不收手续费（feeBps 默认 0），其余全部给卖家；合约不留钱。 */
  market: '',
  /* 造物与命名两套在 v1 不上（它们的定价原本全建在 BANG 上，要重设计）。 */
  crafted: '',
  craftedNames: '',

  /* 公开 RPC，按顺序轮换。两个域名都能用：官方文档给的是 arc.io，
     arc.network 那一条是测试网时期就在用的，留作备胎。 */
  rpc: [
    'https://rpc.mainnet.arc.io',
    '/api/rpc'
  ],

  /* 链身份的唯一真相来源。**换链只改这一块。** */
  chain: {
    id: 5042,
    name: 'Arc 主网',
    nameEn: 'Arc Mainnet',
    explorer: 'https://explorer.arc.io',
    currency: 'USDC',
    isTestnet: false
  }

  /* ---- 测试网（要用水龙头联调铸造时整块替换上面的 rpc + chain；2026-09-17 用户拍板本地也读主网区块）----
  rpc: [
    'https://rpc.testnet.arc.io',
    '/api/rpc',
    'https://rpc.testnet.arc.network'
  ],
  chain: {
    id: 5042002,
    name: 'Arc 测试网',
    nameEn: 'Arc Testnet',
    explorer: 'https://explorer.testnet.arc.io',
    currency: 'USDC',
    isTestnet: true
  }
  ---- */
};
