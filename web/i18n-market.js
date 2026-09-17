/*
 * web/i18n-market.js —— web/market.html, web/bnb-ui.js 的中英词条
 * ------------------------------------------------------------
 * 只放**界面上真会出现**的句子；注释、日志、开发用文字不进这里。
 * key 是中文原文，逐字相等才命中；漏翻的自动退回中文，不会出现裸 key。
 * 机制与约定见 web/i18n.js 顶部。
 *
 * 这一轮收的是 web/market.html（市场页）。**bnb-ui.js 的词条还没收**，
 * 那是后一轮的事 —— 没收的部分照旧显示中文，不影响这一页。
 *
 * 三条自己给自己定的规矩：
 *   1. 核心词典（web/i18n.js）里已经有的**不重复收**：结局名、
 *      「已验证」「已救活」「已烧掉」「引爆者」「卖家」「撤单」「未部署」…
 *      重复一遍就是给自己留一处会走散的副本。
 *   2. 带 {0}/{1} 的是**整句**词条（TF 用）。英文的语序跟中文不一样，
 *      拆成 T('已切到') + 地址 那种拼法迟早拼歪。
 *   3. 数字、单位、地址、哈希、合约字段名（cardOf / burnedOn / bang()）一个字都不动。
 */
(function (root) {
  'use strict';
  var I = root.MirrorI18n;
  if (!I) return;            // i18n 核心没加载：静默退回全中文，不要让页面挂掉
  I.add({
    '宇宙': 'Universe',

    /* ---------------- 顶栏与页面切换 ---------------- */
    '模拟器': 'Simulator',
    '市场': 'Market',                       // 导航链接 + 配置条上那一枚 chip
    '经济': 'Economy',
    /* 顶栏品牌副标题 + 钱包浮层里的入口链接（web/nav.js 的 #lnkProfile），
       同一个词 —— 收在全局表里，四个页面的浮层都翻得到。 */
    '个人中心': 'Profile',
    '站点页面': 'Site pages',
    '钱包': 'Wallet',
    '复制地址': 'Copy address',
    '在区块浏览器里打开': 'Open in the block explorer',

    /* ---------------- 钱包浮层 ---------------- */
    '未连接': 'Not connected',
    /* 链名由 config.js 的 chain 块填（web/nav.js 的 walletNoteHtml）。**整句进词典**：
       中文的句号和英文的句点不是一个字符，英文那句后面还要一个空格接 <b>。 */
    '当前链：{0}。': 'Network: {0}. ',
    '「断开」只清得掉本页的状态': "\"Disconnect\" only clears this page's state",
    /* 这一段前面挨着 <b>…</b>，原文那个破折号要留着，别把句子接断了 */
    '—— 连接是钱包授予这个站点的权限，网页替你挂断不了；能撤就撤，撤不掉会明说。':
      '— the connection is a permission your wallet granted this site, and a web page cannot hang up for you. It is revoked where possible, and said plainly where not.',
    '连接钱包后可以看自己的宇宙、挂单、撤单':
      'Connect a wallet to see your own universes, post listings, and cancel them',
    '{0} · 点开看完整地址、切换账户、换钱包、断开':
      '{0} · open for the full address, account switching, switching wallet, and disconnect',
    '换钱包': 'Switch wallet',
    '复制不了 —— 手动选中浮层里那串地址复制':
      'Cannot copy — select the address in the popover and copy it by hand',
    '浏览器不让复制': 'The browser refused to copy',

    /* ---------------- 页面引子与标题 ---------------- */
    '{0} · 只上架带参数的宇宙。没连钱包也能看。':
      '{0} · only universes with parameters are listed. Browsable without a wallet.',
    '未连钱包 · 只读浏览（走公开 RPC）': 'No wallet · read-only browsing (public RPC)',
    '已断开 · 只读浏览（走公开 RPC）': 'Disconnected · read-only browsing (public RPC)',
    '在售的宇宙': 'Universes for sale',
    '销毁量与救活记录是这里最要紧的两栏 —— 区块要多少有多少，币不是':
      'Burn totals and rescue records are the two columns that matter most here — blocks are endless, tokens are not',
    '最近铸造的宇宙': 'Recently minted universes',
    '不在售，只是让你看看链上现在有什么': 'Not for sale — just a look at what is on-chain right now',
    '挂一单': 'Post a listing',
    '选宇宙 → 填价 → 授权 → 挂单': 'Pick a universe → set a price → approve → list',
    '我挂着的单': 'My listings',

    /* ---------------- 合约与配置 ---------------- */
    '宇宙 NFT': 'Universe NFT',
    'BANG 代币': 'BANG token',
    '{0}合约还没部署。': 'The {0} contract is not deployed yet.',
    '这一块的合约还没接上 —— 页面其余部分照常能用。':
      'This contract is not wired in yet — the rest of the page works as usual.',
    '（未部署）': '(not deployed)',
    '市场合约未部署。': 'Market contract not deployed.',
    'NFT 合约未部署': 'NFT contract not deployed',
    '站点配置没读到 —— 合约都还没接上，先用公开节点浏览':
      'Site config did not load — none of the contracts are wired in; browsing uses the public nodes for now',

    /* ---------------- 宇宙卡 ---------------- */
    '宇宙 {0}': 'Universe {0}',
    '宇宙缩略图': 'Universe thumbnail',
    '图还没读到': 'Image not loaded',
    '结局未知': 'Outcome unknown',
    '读不到': 'Unreadable',
    'cardOf 非零：这枚 NFT 走过服务端，参数指纹已写进合约':
      'cardOf is non-zero: this NFT went through the server, and its parameter fingerprint is written into the contract',
    'cardOf：服务端算过并签过名的参数指纹':
      'cardOf: the parameter fingerprint the server computed and signed',
    '区块号 —— 这个宇宙的身份。token {0}':
      "Block number — this universe's identity. token {0}",
    '链上读不到 burnedOn': 'burnedOn cannot be read on-chain',
    '烧掉的币不会回来 —— 这个数字是这枚 NFT 的成本证明':
      "Burned tokens never come back — this number is this NFT's proof of cost",
    '救活过': 'Rescued',
    '救活过：这是全场最稀缺的一档': 'Rescued — the scarcest thing on this page',
    '从「{0}」推回可能诞生观察者':
      'pulled back from "{0}" to a universe where observers are possible',
    '干预 {0} 次': '{0} interventions',

    /* ---------------- 稀有度（S/A/B/C/D）
       这一轴译作 Grade，不用 Tier：Tier 是 NFT 元数据里弦气扰动强度那套轴的
       属性名（数据里还在，界面已不显示），两个词不许换过来。 */
    '{0} 档': 'Grade {0}',
    '{0} · 全链约 {1}': '{0} · about {1} chain-wide',
    '三维但没活': 'Three-dimensional but lifeless',
    '整数维（非三维）': 'Integer dimension (not 3D)',
    '半整数维': 'Half-integer dimension',
    '一维及以下': 'One dimension or lower',
    '没有稀有度：要么是直接调 bang() 铸的（合约记 5 = 未知），要么这一枚的 universeOf 这次没读到':
      'No rarity: either it was minted by calling bang() directly (the contract records 5 = unknown), or universeOf could not be read for this one this time',
    '显示「{0} 档」的那几枚：是直接调 {1} 铸的，没走服务端引爆，本来就没有稀有度（合约里记的是 5 = 未知）。':
      'The ones showing "Grade {0}" were minted by calling {1} directly, without a server detonation, so they never had a rarity (the contract records 5 = unknown).',
    '稀有度由服务端算并签进摘要，只有 {0} 那条路才有。':
      'Rarity is computed by the server and signed into the digest; only the {0} path has one.',

    /* ---------------- 结局名：市场页这份和核心词典的措辞不完全一样
       （核心是「大坍缩 / 热寂，无结构 / 能诞生观察者」），key 逐字相等才命中，
       所以这几条差异写法要单收。语义与合约 outcomeName() 同序，不许改。 */
    '大挤压': 'Big Crunch',
    '热寂·无结构': 'Heat death · no structure',
    '有恒星但没有生命': 'Stars but no life',
    '可能诞生观察者': 'Observers possible',
    '无碳化学': 'No carbon chemistry',

    /* ---------------- 我的宇宙 ---------------- */
    '链上共 {0} 枚': '{0} on-chain in total',
    '，只扫了最新的 {0} 枚': ', only the newest {0} scanned',
    '你名下还有 {0} 枚没盖章的宇宙没有列出来：它们的 {1} 是 0，没走服务端引爆，没有参数卡，市场不上架。':
      'You hold {0} more unverified universes that are not listed here: their {1} is 0 — never detonated through the server, no parameter card, so the market will not list them.',
    '还没连钱包。点右上角「连接钱包」看你手里的宇宙 —— 在那之前这一页也能随便逛，市场和挂单都是公开读的。':
      'No wallet connected yet. Use "Connect wallet" at the top right to see the universes you hold — until then you can still browse freely: the market and the listings are public reads.',
    '事实上链上一枚都还没有 —— 去模拟器里引爆一个。':
      'In fact there is not one on-chain yet — go detonate one in the simulator.',

    /* ---------------- 宇宙市场 ---------------- */
    '下面是链上最近铸造的宇宙，先看着。':
      'Below are the most recently minted universes on-chain, in the meantime.',
    '正在读取挂单…': 'Loading listings…',
    '正在读取链上数据…': 'Reading the chain…',
    '链上节点暂时没响应，正在换节点重试 —— 几秒后会自动刷新。':
      'Chain nodes are not responding right now; switching nodes and retrying — this page refreshes itself in a few seconds.',
    '市场合约地址填了，但读不到挂单 —— 地址填错了，或者合约的 {0} 和规格对不上。':
      'The market contract address is set, but no listings can be read — either the address is wrong, or the {0} of that contract does not match the spec.',
    '（市场刚开张，没人挂单不是故障 —— 需求得自己长出来。）':
      '(The market just opened. Nobody listing anything is not a fault — demand has to grow on its own.)',
    '这一单已经取消或卖掉了': 'This listing was cancelled or already sold',
    '卖家已经不持有这份资产了，买不成': 'The seller no longer holds this asset — it cannot be bought',
    '卖家撤了对市场的授权，买不成': "The seller revoked the market's approval — it cannot be bought",
    '现在买不成': 'Cannot be bought right now',
    '买不成': 'Cannot buy',
    '买入': 'Buy',

    /* ---------------- 挂单 ---------------- */
    '表单先摆在这里，填不了。': 'The form is here, but it cannot be filled in.',
    '挂单要签名，先连钱包。': 'Listing needs a signature — connect a wallet first.',
    /* 单位由 config.js 的 chain.currency（原生币）或 'BANG' 填 —— 一条词条管两种计价。 */
    '总价（{0}）': 'Total price ({0})',
    '例如 0.02': 'e.g. 0.02',
    '例如 5000': 'e.g. 5000',
    '计价': 'Currency',
    '授权 BANG': 'Approve BANG',
    'BANG 代币地址没配，买不了 BANG 计价的单': 'BANG token address not configured; BANG-priced listings cannot be bought',
    '读不到 BANG 授权额度，稍后再试': 'Could not read BANG allowance; try again shortly',
    '① 授权市场': '① Approve the market',
    '② 挂单': '② List',
    /* 表单下面那段说明被 <span class="mono"> 断成四个文本节点，每一段单独收。
       末尾的空格是**故意的**：它前后紧挨着代码块，没有它英文会粘成一个词。 */
    '手续费在成交时从买家付的钱里扣：BNB 计价单抽 1%、BANG 计价单抽 5%。授权是一次性的：':
      "The fee is taken out of the buyer's payment at settlement — 1% on BNB-priced listings, 5% on BANG-priced ones. Approval is one-time: ",
    '之后市场才有权在成交那一刻把 NFT 转给买家 —— 在那之前东西一直在你自己钱包里。':
      'only then may the market move the NFT to the buyer at the moment of sale — until then it stays in your own wallet.',
    '没盖章的宇宙（': 'Unverified universes (',
    '，也就是没走服务端引爆的）不在这个下拉里 —— 它们没有参数卡，市场不上架。':
      ', that is, those never detonated through the server) are not in this dropdown — they have no parameter card, so the market will not list them.',
    '你名下没有可卖的宇宙': 'You have no universes to sell',
    '{0} 单在挂': '{0} listed',
    '连钱包后这里显示你挂出去的单。': 'Connect a wallet and the listings you posted show up here.',
    '你还没挂单。': 'You have not listed anything yet.',
    '资产': 'Asset',
    '授权': 'Approve',
    '已授权': 'Approved',
    '还没授权': 'Not approved yet',
    '授权状态读不到': 'Approval status unreadable',
    '先选一个要卖的宇宙': 'Pick the universe you want to sell first',
    '价格填得不对，写成 0.02 这样': 'That price is not valid — write it like 0.02',

    /* ---------------- BANG 数字条 ---------------- */
    'BANG 代币还没接上': 'The BANG token is not wired in yet',
    '连钱包后显示这个地址的余额': "Connect a wallet to see this address's balance",
    '地址填错了，或者合约还没上线': 'Wrong address, or the contract is not live yet',
    '铸造 NFT 时发放，修正宇宙和命名时销毁；团队 / 上交易所费用 / 返利另有三个一次性池':
      'Issued when an NFT is minted, burned when a universe is corrected or named; team, listing fees and referral have three separate one-off pools',
    '链上读不到 totalBurned': 'totalBurned cannot be read on-chain',
    '全网累计销毁，只增不减 —— 这是所有 NFT 价值的总来源':
      "Burned network-wide, only ever growing — the source of every NFT's value",

    /* ---------------- 写链 ---------------- */
    '没有检测到小狐狸（MetaMask）': 'MetaMask not detected',
    /* 钱包选择器空列表提示（web/wallet.js 的 pick；app 分册也收了同一条） */
    'TronLink / TokenPocket 连不上：请用 MetaMask 或币安钱包':
      'TronLink / TokenPocket cannot connect — please use MetaMask or Binance Wallet',
    '等待回执超时': 'Timed out waiting for the receipt',
    '上一笔还没落地，等它出结果再点':
      'The previous transaction has not landed — wait for its result before clicking again',
    /* {0} = 动作名（授权 / 挂单 / 撤单 #3 / 买入 #3），{1} = 哈希或错误原文 */
    '{0}：在钱包里确认…': '{0}: confirm in your wallet…',
    '{0}：已发出，等上链… {1}': '{0}: sent, waiting for the chain… {1}',
    '{0}：成功': '{0}: done',
    '{0}：交易被链上回滚了': '{0}: the transaction was reverted on-chain',
    '{0}失败：{1}': '{0} failed: {1}',
    '这一单读不到了，刷新看看': 'This listing can no longer be read — try refreshing',
    '读链出了点问题：{0}': 'Something went wrong reading the chain: {0}',
    'RPC 出错': 'RPC error',

    /* ---------------- 连接 / 切换 / 断开 ---------------- */
    '已连接 {0}': 'Connected {0}',
    '连接失败：{0}': 'Connection failed: {0}',
    '没拿到账户 —— 钱包可能锁着，或者你在弹窗里拒绝了':
      'No account came back — the wallet may be locked, or you rejected the prompt',
    '账户没变，还是 {0}': 'Account unchanged — still {0}',
    '已切到 {0}': 'Switched to {0}',
    '钱包没给账户 —— 请到 MetaMask 里手动切换账户':
      'The wallet returned no account — switch accounts by hand in MetaMask',
    '取消了切换账户 —— 账户没变': 'Account switch cancelled — the account did not change',
    '切换账户没成：{0} —— 可以到 MetaMask 里手动切':
      'Could not switch account: {0} — you can switch by hand in MetaMask',
    '本页已断开。钱包里的授权还在 —— 要彻底移除请到 MetaMask 的「已连接的网站」':
      'This page is disconnected. The approval in your wallet is still there — remove it under "Connected sites" in MetaMask',

    /* ---------------- 页脚。末尾的空格同样是**故意的**：紧挨着代码块或链接。 */
    '合约：': 'Contracts: ',
    /* 「这是 XX。」那半句只在 chain.isTestnet 为真时渲染（market.html 的 renderChainText）；
       主网走下面那条不带链名的。两条都是整句 —— 英文的语序和中文对不上。 */
    '这是 {0}。这里的一切都不是投资建议，也不构成任何价值承诺。':
      'This is {0}. Nothing here is investment advice, and nothing here promises any value.',
    '这里的一切都不是投资建议，也不构成任何价值承诺。':
      'Nothing here is investment advice, and nothing here promises any value.',
    '「已验证」= 合约里的': '"Verified" = the',
    '非零，表示这枚 NFT 的参数是服务端算过并签过名的； 「已烧」=':
      'in the contract is non-zero, meaning this NFT\'s parameters were computed and signed by the server; "Burned" =',
    '，这枚 token 上累计销毁的 BANG，链上可查、伪造不了。':
      ', the BANG burned on this token so far — readable on-chain and impossible to fake.',
    /* 唯一性口径 2026-08-21 改定：**不是全站唯一，是本系列内唯一** ——
       原生 BangNames 与造物 BangNames2 是两套独立名册（specs/crafted-names-v1.md §四）。 */
    '名字 = 持有人烧 BANG 登记的，在本系列内唯一（原生与造物是两套独立名册）；大小写和同形字（O/0、I i L l/1）都算重名，名字跟着 NFT 一起转手。':
      'A name is registered by its holder by burning BANG. Names are unique within a collection (Native and Crafted are two separate registries); case and look-alike characters (O/0, I i L l/1) all count as the same name. A name travels with the NFT.',

    /* ================================================================ 命名
       烧 BANG 给宇宙命名（contracts/src/BangNames.sol）。功能的来由是《镜子》
       第八章白冰那句「我要把这组创世参数记下来」——**引文本身也要翻**，
       它是这个弹窗的第一句话，不是装饰。 */
    '命名': 'Names',                       // 配置条上那一枚 chip（合约名，与「命名已销毁」区分）
    '造物命名': 'Crafted names',           // 配置条上 BangNames2 那一枚 chip
    '取个名字': 'Name it',
    '改名': 'Rename',
    '给宇宙命名': 'Name this universe',
    '给宇宙改名': 'Rename this universe',
    /* 「关闭」在核心词典（i18n.js）里，「名字」在 i18n-market 之前加载的 i18n-app.js 里，
       两个都已经进了全局表 —— 按本文件第 1 条规矩不重复收，重复一遍就是给自己留一处会走散的副本。 */
    '例如 first-light': 'e.g. first-light',
    '「分数维的宇宙很少见，我要把这组创世参数记下来。」':
      '"Fractional-dimension universes are rare. I want to write these genesis parameters down."',
    '——《镜子》第八章': '— The Mirror, chapter 8',
    '持有人烧 BANG 给它取的名字。在原生系列内唯一，链上可查':
      'The name its holder burned BANG to register. Unique within the Native collection, readable on-chain',
    '持有人烧 BANG 给它取的名字。在造物系列内唯一，链上可查':
      'The name its holder burned BANG to register. Unique within the Crafted collection, readable on-chain',
    /* 弹窗里那一行灰字。**必须有**：不写的话，有人给造物取名成功后会以为抢到了
       全站唯一，拿去二级市场按唯一性叫价 —— 那误解是我们造成的（用户点名要求）。 */
    '原生宇宙与造物宇宙是两套独立名册：同一个名字在两边可以各占一次，查重也只在本系列内进行。':
      'Native and Crafted are two separate name registries: the same name can be taken once in each, and uniqueness is checked within a collection only.',
    '烧掉 BANG，把这组创世参数记下来': 'Burn BANG to write these genesis parameters down',
    '改名要烧掉上一次的两倍 —— 这是为了让名字不能被反复铲走':
      'Renaming costs twice what the last one did — so names cannot be shovelled away over and over',

    /* ---- 查重的每一种结果。**说清为什么**，否则用户只会反复试 ---- */
    '先起个名字': 'Type a name first',
    '查重中…': 'Checking…',
    '「{0}」还没人用，可以命名': '"{0}" is free — you can take it',
    '「{0}」已经被 {1} 占了 —— 名字在本系列内唯一，先到先得':
      '"{0}" is already held by {1} — names are unique within a collection, first come first served',
    '这就是它现在的名字（大小写、O/0、I/1 都算同一个），不用改':
      'That is already its name (case, O/0 and I/1 all count as the same) — nothing to change',
    '名字不能是空的': 'A name cannot be empty',
    '最多 32 个字符': '32 characters at most',
    '第 {0} 个字符不能用 —— 只收 a-z A-Z 0-9 和连字符':
      'Character {0} is not allowed — only a-z A-Z 0-9 and the hyphen',
    '首尾不能是连字符': 'A name cannot start or end with a hyphen',
    '查不了这个名字': 'This name cannot be checked',
    '查不了 —— 命名合约地址可能填错了':
      'Cannot check — the naming contract address may be wrong',
    '查重没成：{0}': 'The check did not go through: {0}',
    '命名要发交易，先连钱包': 'Naming sends a transaction — connect a wallet first',

    /* ---- 价格与授权。**授权多少必须写出来**，不做无限授权的诱导 ---- */
    '价格要等名字合法才算得出来 —— 短名更贵，改名比上一次贵一倍':
      'The price is computed once the name is valid — shorter names cost more, and each rename costs twice the last',
    '这一步要烧掉': 'This burns',
    '① 只授权这一笔的 {0} BANG，不做无限授权':
      'Step ① approves exactly {0} BANG for this one burn — never an unlimited allowance',
    '已授权 {0} BANG，够这一笔，直接点 ②':
      '{0} BANG already approved, enough for this — go straight to ②',
    '烧掉的币不会回来。名字跟着这枚 NFT 走，转手一起转':
      'Burned tokens do not come back. The name belongs to this NFT and travels with it',
    '① 授权': '① Approve',
    '② 命名': '② Name it',
    '命名 {0}': 'Naming {0}',
    '已经把它记下来了：{0}': 'Written down: {0}',
    '名字只能用 a-z A-Z 0-9 和连字符，1 到 32 个字符，首尾不能是连字符。不收 Unicode —— 全角的「Ｅ」和「E」看起来一样，收了就有人拿它冒充别人的名字。大小写不区分；O 和 0、I i L l 和 1 也当作同一个字符，理由同上。':
      'Names use a-z A-Z 0-9 and the hyphen, 1 to 32 characters, and cannot start or end with a hyphen. No Unicode: a full-width "Ｅ" looks exactly like "E", and allowing it would let someone impersonate another name. Case is ignored; O and 0, and I i L l and 1, are treated as the same character for the same reason.',

    /* ---- BANG 那一栏里的新一格 ---- */
    '命名已销毁': 'Burned for names',
    '给宇宙取名字烧掉的量。这是第二条销毁通路，和干预分开记':
      'Burned to name universes. This is the second burn path, counted separately from interventions',
    '链上读不到 totalBurnedForNames': 'totalBurnedForNames could not be read on-chain',

    /* ================================================================ 造物系列
       第二套 721（contracts/src/MirrorCrafted.sol，specs/crafted-v1.md）：
       沙盒里干预后的宇宙。config.js 的 crafted 没配时这些词条一条都不会上屏。
       「全部」在 i18n-app.js 里已有（'All'），按第 1 条规矩不重复收。 */
    '造物': 'Crafted',                     // 徽标 / 筛选分段 / 下拉分组 / 配置条 chip，同一个词
    '原生': 'Native',
    '按系列筛选': 'Filter by series',
    '造物宇宙 #{0}': 'Crafted Universe #{0}',
    '造物宇宙': 'Crafted Universe',   // 挂单表单下拉的 optgroup 标签
    '造物缩略图': 'Crafted universe thumbnail',
    '起源区块': 'Origin block',
    '铸造序号 —— 造物的身份是参数卡哈希（右边那串），起源区块在下面':
      "Mint number — a crafted universe's identity is its card hash (to the right); its origin block is below",
    '参数卡哈希（cardHash）：拿起源哈希和干预操作序列跑开源引擎，能复算出同一张卡':
      'Card hash: replay the origin hash plus the recorded ops through the open engine and you recompute this exact card',
    '造物必经服务端复算与签名才铸得出来，参数卡哈希已写进合约':
      'A crafted universe can only be minted after the server recomputes and signs it; its card hash is written into the contract',
    '造物系列：沙盒里干预后的宇宙。参数 = 起源区块哈希 + 干预操作序列，任何人可复算':
      'Crafted series: a universe reshaped in the sandbox. Parameters = origin block hash + the recorded ops — anyone can recompute it',
    '；造物链上共 {0} 枚': '; {0} crafted on-chain',
    '现在没有造物在售。': 'No crafted universes are for sale right now.',
    /* **绝不把铸造费标成「已烧掉」**：paid 里只有一部分真的销毁，
       其余进国库 —— 原生 burnedOn 那套 100% 全烧的口径不适用造物。
       8 槽用 cardOf.burned（铸造当时写入）；7 槽未知才按当前费率折算并标明。 */
    '铸造投入': 'Paid at mint',
    '其中 {0} BANG 已销毁（铸造当时写入），其余进了国库':
      'Of which {0} BANG was burned (written at mint); the rest went to the treasury',
    '其中约 {0} BANG 已销毁（按当前费率 {1}% 折算，链上 burned 未知），其余进了国库':
      'Of which about {0} BANG was burned (estimated at the current {1}% rate; on-chain burned unknown); the rest went to the treasury',
    '销毁比例读不到（burnBps）—— 只给总投入，不猜销毁份额':
      'The burn share cannot be read (burnBps) — only the total paid is shown; the burned part is not guessed',
    '链上读不到 cardOf 的 paid': 'paid in cardOf cannot be read on-chain',

    /* ================================================================ 广播与推广（specs/share-referral-v1.md）
       激励口径 2026-08-21 定稿：说费率（10%/5%）、说人工核对、说专款与反女巫；
       绝不说「自动到账 / 立即到账」。文案是长句，整句进词典，别拆开拼。 */
    '广播': 'Broadcast',
    '再引爆看看': 'Detonate it again',
    /* 拯救入口（specs/rescue-entry.md）。术语跟 i18n-tools.js 定的一致：
       rescue = 救 / 拯救，burn = 烧（不是 spend）。
       「拯救」这个词个人中心那张持仓卡也用，i18n-site.js 里收的是**同一句英文** ——
       两处值一样，i18n.js 的撞车警告不会响；哪天要改，两处一起改。 */
    '拯救': 'Rescue',
    '烧 BANG 改写它的参数，销毁量记进这枚 NFT':
      'Burn BANG to rewrite its parameters — the amount burned is recorded on this NFT',
    /* 3D 画面上那颗 HUD 按钮的两种态：死宇宙是「救救它」，活宇宙是「调教它」。
       核心词典里的 '救救它' 是短标签，这两条是完整按钮文案，不冲突。 */
    '救救它（进沙盒推参数）': 'Rescue it (nudge parameters in the sandbox)',
    '调教它（进沙盒推参数）': 'Tune it (nudge parameters in the sandbox)',
    '看它的起源宇宙': 'See its origin universe',
    '查看大图': 'View full image',
    '宇宙大图': 'Full-size universe image',
    '在新标签打开': 'Open in a new tab',
    '复制链接+文案': 'Copy link + text',
    '已复制 ✓': 'Copied ✓',
    '复制不了 —— 手动选中上面的文案': 'Copy failed — select the text above by hand',
    '广播到 X': 'Broadcast on X',
    /* 渠道网格（用户 2026-08-21 加渠道）：专名 X/Telegram/Facebook/Reddit/WhatsApp
       中英同形不进词典，进词典的只有这两条。与 app 分册（i18n-app.js）同句同译。 */
    '微博': 'Weibo',
    '复制链接': 'Copy link',
    /* ---- 广播 v2（specs/broadcast-v2.md §三/§四）：复制带图、微信二维码。
       市场页与 web/bnb-ui.js 的广播浮层共用这几条 —— 本分册的抬头就说了它管两处。 */
    '复制文案和图片': 'Copy text and image',
    '正在准备图片…': 'Preparing the image…',
    '复制中…': 'Copying…',
    /* 剪贴板装不下图片时**必须明说**，否则用户以为图丢了。整句进词典 */
    '图片没能复制（这个浏览器不支持），文案已经进剪贴板了 —— 图片可以在卡片上右键另存。':
      'The image could not be copied (this browser does not support it). The text is on the clipboard — you can right-click the card image and save it.',
    /* 附图预览（用户 2026-08-21「附带一张游戏内的截图」）：市场页与 web/bnb-ui.js
       的广播浮层共用这三条（app 页另有一条「实况截图」小签在 app 分册）。 */
    '广播附图': 'Broadcast image',
    '点开看大图': 'Click to view it full size',
    '卡面图': 'Card art',
    /* 微信没有网页分享 API，能给的只有二维码。英文站也照样叫 WeChat */
    '微信': 'WeChat',
    '长按识别 / 扫码打开': 'Long-press to recognise, or scan to open',
    '这条链接太长，二维码画不下 —— 直接复制下面的链接吧':
      'This link is too long to fit in a QR code — copy the link below instead',
    '这张卡还没读全，稍等一下再广播': 'This card has not fully loaded yet — try broadcasting again in a moment',
    '这张卡还没读全，稍等一下再试': 'This card has not fully loaded yet — try again in a moment',
    '我在 BNBBANG 引爆了宇宙 {0}：{1}。每个 BNB 区块哈希都是一套物理定律——来引爆你自己的，前 100 万枚每地址 10 次免费，之后 0.01 BNB。{2}':
      'I detonated universe {0} on BNBBANG: {1}. Every BNB block hash is a complete set of physical laws — come detonate your own; the first 1M mints are free (10 per address), then 0.01 BNB. {2}',
    '我把一个死宇宙救成了「{0}」（{1} 档造物宇宙 #{2}）。烧 BANG 改写物理常数——BNBBANG，宇宙可以手作。{3}':
      'I rescued a dead universe into "{0}" (Grade {1} Crafted Universe #{2}). Burn BANG to rewrite the physical constants — on BNBBANG, universes can be handmade. {3}',
    '链接已带上你的推广地址。邀请好友引爆宇宙：好友铸造奖励的 10% 归你，好友的好友再给你 5% —— 人工核对后从邀请返利专款（2 亿）发放，链上留痕可查。':
      "Your referral address is on the link. Invite friends to detonate universes: 10% of a friend's mint reward goes to you, plus 5% from friends of friends — paid from the 200M referral treasury after manual review, with an on-chain trail.",
    '未连接钱包：链接不带推广地址，照常能广播。连接钱包再广播，好友铸造奖励的 10% 归你，好友的好友再给你 5% —— 人工核对后从邀请返利专款（2 亿）发放，链上留痕可查。':
      "No wallet connected: the link carries no referral address, and broadcasting still works. Connect a wallet before broadcasting and 10% of a friend's mint reward goes to you, plus 5% from friends of friends — paid from the 200M referral treasury after manual review, with an on-chain trail.",
    '邀请返利专款 2 亿 BANG。': 'A dedicated 200M BANG fund backs referral rewards. ',
    '女巫账户（自邀、批量小号、刷量）经人工核对一律不予发放。':
      'Sybil accounts (self-referrals, bulk wallets, farmed volume) will be rejected in manual review.',

    /* ================================================================ 筛选与排序条 */
    '排序': 'Sort',
    '最新上架': 'Newest listed',
    '价格从低到高': 'Price low → high',
    '价格从高到低': 'Price high → low',
    '编号': 'Number',
    '最新铸造': 'Newest minted',
    '全部结局': 'All outcomes',
    '全部计价': 'Any currency',
    '已命名/未命名': 'Named / unnamed',
    '已命名': 'Named',
    '未命名': 'Unnamed',
    '{0} 条符合 / 共 {1} 条': '{0} matching / {1} total',
    '清空筛选': 'Clear filters',
    '没有符合筛选的宇宙 —— 点「清空筛选」看全部。':
      'No universes match these filters — hit "Clear filters" to see everything.',

    /* ================================================================ 物理参数筛选与排序
       specs/market-physics-filter.md 第三节。维度那一组是**人话**，不是让人填数字，
       所以英文也别退回 "dim=3" 这种参数写法。「全部」在 i18n-app.js 里已有（'All'），
       按第 1 条规矩不重复收。 */
    '维度': 'Dimension',
    'D=3（能长出结构的）': 'D = 3 (structure can form)',
    'D>3': 'D > 3',
    '整数维': 'Integer D',
    '分数维': 'Fractional D',
    '维度↑': 'Dimension ↑',
    '维度↓': 'Dimension ↓',
    /* 维度这一组下面那句说明。**整句进词典**：英文的破折号和中文的不是一个字符 */
    'D=3 是我们这个宇宙的维数，也是唯一能长出稳定轨道的':
      'D = 3 is the dimension of our own universe — and the only one where stable orbits can form.',
    /* ---- 进阶：按卡面上印的常数筛 ---- */
    '进阶：按卡面上的常数筛': 'Advanced: filter by the constants on the card',
    '不按常数筛': 'No constant filter',
    '光速 c': 'Speed of light c',
    '普朗克常数 h': 'Planck constant h',
    '基本电荷 e': 'Elementary charge e',
    '引力常数 G': 'Gravitational constant G',
    '精细结构常数倒数 α⁻¹': 'Inverse fine-structure constant α⁻¹',
    '最小值': 'Min',
    '最大值': 'Max',
    '常数按卡面上的单位填（SI），可以写 3e8 这种科学计数法；两头都留空就是不按它筛。':
      'Use the SI units printed on the card; scientific notation such as 3e8 works. Leave both ends empty and this constant is not filtered on.',
    '区间只认数字（3e8 / 0.0073 这样），这一格先没算进筛选。':
      'The range takes numbers only (3e8, 0.0073, …) — this box is left out of the filter for now.',
    /* ---- 偏离度：档位与文案全部由服务端算，这里只是把 low/high 说成人话 ---- */
    '偏离度': 'Deviation',
    '不看偏离度': 'Any deviation',
    '接近我们的宇宙': 'Close to ours',
    '和我们差着一截': 'Some way off ours',
    '差得很远': 'Far off from ours',
    '空间维数 —— 服务端从这张卡的参数推出来的':
      "Spatial dimension — derived on the server from this card's parameters",
    '分数维：维数不是整数。这种空间里长不出我们熟悉的轨道和场':
      'Fractional dimension: not a whole number. The orbits and fields we know cannot form in a space like this',
    '与我们这个宇宙的偏离度，由服务端算': 'Deviation from our universe, computed on the server',
    '与我们这个宇宙的偏离度 {0}（服务端算的，取各常数里偏得最狠的那一项）':
      'Deviation from our universe: {0} (computed on the server — the constant that strays furthest)',
    /* ---- 服务端那一头的状态。读不到就明说读不到，不拿没筛过的一屏冒充筛过的 ---- */
    '正在按物理参数筛…': 'Filtering by physics…',
    '读不到服务端的物理索引，维度 / 常数 / 偏离度这几项这会儿筛不了。':
      'The physics index on the server is unreachable, so dimension / constants / deviation cannot be filtered right now.',
    '读不到服务端的物理索引，没按维度排 —— 下面仍是按最新上架排的。':
      'The physics index on the server is unreachable, so nothing was sorted by dimension — the list below is still newest first.',
    '挂单太多，服务端只考察了前 {0} 条，条数统计的是这一段。':
      'Too many listings — the server only examined the first {0}, and the counts cover that stretch.',
    '索引正在重扫，刚挂出来的那几单可能还没进去。':
      'The index is rescanning — listings posted moments ago may not be in it yet.',
    '读不到服务端的物理索引，维度 / 常数 / 偏离度这几项这会儿筛不了 —— 点「清空筛选」看全部。':
      'The physics index on the server is unreachable, so dimension / constants / deviation cannot be filtered right now — hit "Clear filters" to see everything.',
    '没有符合这些物理条件的宇宙 —— 换一档维度，或者点「清空筛选」看全部。':
      'No universes match these physical conditions — try another dimension, or hit "Clear filters" to see everything.'
  }, 'market');
})(typeof window !== 'undefined' ? window : this);
