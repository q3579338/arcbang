/*
 * web/i18n-market.js —— web/market.html, web/arc-ui.js 的中英词条
 * ------------------------------------------------------------
 * 只放**界面上真会出现**的句子；注释、日志、开发用文字不进这里。
 * key 是中文原文，逐字相等才命中；漏翻的自动退回中文，不会出现裸 key。
 * 机制与约定见 web/i18n.js 顶部。
 *
 * 这一轮收的是 web/market.html（市场页）。**arc-ui.js 的词条还没收**，
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
    /* 顶栏那个页签 2026-09-19 改叫「引爆」；'模拟器' 留着给页内正文。 */
    '引爆': 'Detonate',
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
    '连接钱包后可查看名下宇宙，并进行挂单与撤单': 'Connect a wallet to see the universes you hold and to post or cancel listings',
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
    '销毁量与救活记录是两项关键指标：区块可无限产生，BANG 不能':
      'Burn totals and rescue records are the two key columns: blocks are unlimited, BANG is not',
    '最近铸造的宇宙': 'Recently minted universes',
    '未挂单，仅展示链上现有的宇宙': 'Not listed for sale; a view of what currently exists on-chain',
    '挂一单': 'Post a listing',
    '选宇宙 → 填价 → 授权 → 挂单': 'Pick a universe → set a price → approve → list',
    '我挂着的单': 'My listings',

    /* ---------------- 合约与配置 ---------------- */
    '宇宙 NFT': 'Universe NFT',
    'BANG 代币': 'BANG token',
    '{0}合约还没部署。': 'The {0} contract is not deployed yet.',
    '该合约尚未接入，页面其余功能不受影响。': 'This contract is not wired in yet. The rest of the page is unaffected.',
    '（未部署）': '(not deployed)',
    '市场合约未部署。': 'Market contract not deployed.',
    'NFT 合约未部署': 'NFT contract not deployed',
    '未读到站点配置，合约尚未接入，当前使用公开节点浏览':
      'Site config not loaded. No contract is wired in; browsing currently uses public nodes.',

    /* ---------------- 宇宙卡 ---------------- */
    '宇宙 {0}': 'Universe {0}',
    '宇宙缩略图': 'Universe thumbnail',
    '图片未读取到': 'Image not loaded',
    '结局未知': 'Outcome unknown',
    '读不到': 'Unreadable',
    '该 NFT 的参数已由服务端复算并签名，参数指纹写入合约':
      "This NFT's parameters were recomputed and signed by the server; the fingerprint is written into the contract",
    '服务端复算并签名的参数指纹': 'The parameter fingerprint recomputed and signed by the server',
    '区块号，即该宇宙的身份。token {0}': "Block number, this universe's identity. token {0}",
    '链上未读到销毁量': 'Burn total could not be read on-chain',
    '销毁不可逆。该数值是这枚 NFT 的投入证明': "Burning is irreversible. This figure is this NFT's proof of cost",
    '救活过': 'Rescued',
    '已救活：当前最稀缺的一档': 'Rescued: the scarcest tier on this page',
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
    '无稀有度记录：该 NFT 未经服务端引爆铸造，或本次未读到链上稀有度':
      'No rarity on record: this NFT was not minted through a server detonation, or its rarity could not be read this time',
    '标为「{0} 档」的 NFT 由直接调用 {1} 铸造，未经服务端引爆，因此没有稀有度记录。':
      'NFTs shown as tier {0} were minted by calling {1} directly. They never went through a server detonation, so they carry no rarity.',
    '稀有度由服务端计算并签入摘要，仅经 {0} 路径铸造的 NFT 具备。':
      'Rarity is computed by the server and signed into the digest; only NFTs minted through {0} carry it.',

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
    '另有 {0} 枚宇宙未列出：{1} 为 0，未经服务端引爆，没有参数卡，不支持上架。':
      'Another {0} universes are not listed: their {1} is 0, they were not detonated through the server, they carry no parameter card, and they cannot be listed.',
    '尚未连接钱包。点击右上角「连接钱包」查看名下宇宙。未连接时仍可浏览本页，市场与挂单数据公开可读。':
      'No wallet connected. Use "Connect wallet" at the top right to see the universes you hold. The page remains browsable without a wallet: market and listing data are public reads.',
    '链上暂无已铸造的宇宙。可前往模拟器引爆一个。': 'There are none on-chain yet. Detonate one in the simulator.',

    /* ---------------- 宇宙市场 ---------------- */
    '以下为链上最近铸造的宇宙。': 'Below are the most recently minted universes on-chain.',
    '正在读取挂单…': 'Loading listings…',
    '正在读取链上数据…': 'Reading the chain…',
    '链上节点暂无响应，正在切换节点重试，稍后自动刷新。':
      'Chain nodes are not responding. Switching nodes and retrying; the page refreshes automatically in a few seconds.',
    '已配置市场合约地址，但读不到挂单。可能是地址有误，或合约的 {0} 与规格不一致。':
      'The market contract address is set, but no listing can be read. Either the address is wrong, or the contract {0} does not match the spec.',
    '（市场新开，暂无挂单属于正常情况。）': '(The market has just opened; an empty order book is expected at this stage.)',
    '该挂单已取消或已成交': 'This listing was cancelled or has already sold',
    '卖家已不持有该资产，无法成交': 'The seller no longer holds this asset, so it cannot be bought',
    '卖家已撤销对市场合约的授权，无法成交': 'The seller revoked the approval for the market contract, so it cannot be bought',
    '当前无法成交': 'Cannot be bought right now',
    '无法成交': 'Cannot buy',
    '买入': 'Buy',

    /* ---------------- 挂单 ---------------- */
    '表单当前不可用。': 'The form is unavailable.',
    '挂单需要签名，请先连接钱包。': 'Listing requires a signature. Connect a wallet first.',
    /* 单位由 config.js 的 chain.currency（原生币）或 'BANG' 填 —— 一条词条管两种计价。 */
    '总价（{0}）': 'Total price ({0})',
    '例如 0.02': 'e.g. 0.02',
    '例如 5000': 'e.g. 5000',
    '计价': 'Currency',
    '授权 BANG': 'Approve BANG',
    '未配置 BANG 代币地址，无法购买以 BANG 计价的挂单':
      'No BANG token address is configured, so BANG-priced listings cannot be bought',
    '未读到 BANG 授权额度，请稍后再试': 'The BANG allowance could not be read. Try again shortly.',
    '① 授权市场': '① Approve the market',
    '② 挂单': '② List',
    /* 表单下面那段说明被 <span class="mono"> 断成四个文本节点，每一段单独收。
       末尾的空格是**故意的**：它前后紧挨着代码块，没有它英文会粘成一个词。 */
    '名下没有可出售的宇宙': 'You hold no universe available for sale',
    '{0} 单在挂': '{0} listed',
    '连接钱包后显示你的挂单。': 'Connect a wallet to see the listings you posted.',
    '暂无挂单。': 'You have no listings.',
    '资产': 'Asset',
    '授权': 'Approve',
    '尚未授权市场合约，先完成授权，随后自动挂单。': 'The market contract is not approved yet. Approve first; the listing follows automatically.',
    '未读到授权状态，请稍后再试': 'Could not read the approval state. Try again shortly.',
    '已授权': 'Approved',
    '尚未授权': 'Not approved',
    '未读到授权状态': 'Approval status could not be read',
    '请先选择要出售的宇宙': 'Select the universe you want to sell first',
    '价格格式有误，请填写如 0.02 的数值': 'That price is not valid. Enter a number such as 0.02.',

    /* ---------------- BANG 数字条 ---------------- */
    'BANG 代币尚未接入': 'The BANG token is not wired in yet',
    '连接钱包后显示该地址余额': "Connect a wallet to see this address's balance",
    '地址有误，或合约尚未上线': 'The address is wrong, or the contract is not live yet',
    '铸造 NFT 时发放，修正宇宙与命名时销毁。团队、上所费用、返利另有三个一次性池。':
      'Issued when an NFT is minted and burned when a universe is corrected or named. Team, listing fees and referrals have three separate one-off pools.',
    '链上未读到累计销毁量': 'The total burned could not be read on-chain',
    '全网累计销毁量，只增不减。': 'Burned network-wide. The figure only ever increases.',

    /* ---------------- 写链 ---------------- */
    '未检测到 MetaMask': 'MetaMask not detected',
    /* 钱包选择器空列表提示（web/wallet.js 的 pick；app 分册也收了同一条） */
    'TronLink / TokenPocket 连不上：请用 MetaMask 或币安钱包':
      'TronLink / TokenPocket cannot connect — please use MetaMask or Binance Wallet',
    '等待回执超时': 'Timed out waiting for the receipt',
    '上一笔交易尚未确认，请等待结果': 'The previous transaction has not settled. Wait for its result.',
    /* {0} = 动作名（授权 / 挂单 / 撤单 #3 / 买入 #3），{1} = 哈希或错误原文 */
    '{0}：在钱包里确认…': '{0}: confirm in your wallet…',
    '{0}：已发出，等上链… {1}': '{0}: sent, waiting for the chain… {1}',
    '{0}：成功': '{0}: done',
    '{0}：交易在链上被回滚': '{0}: the transaction was reverted on-chain',
    '{0}失败：{1}': '{0} failed: {1}',
    '该挂单已读不到，请刷新页面': 'This listing can no longer be read. Refresh the page.',
    '读取链上数据失败：{0}': 'Reading the chain failed: {0}',
    'RPC 出错': 'RPC error',

    /* ---------------- 连接 / 切换 / 断开 ---------------- */
    '已连接 {0}': 'Connected {0}',
    '连接失败：{0}': 'Connection failed: {0}',
    '没拿到账户 —— 钱包可能锁着，或者你在弹窗里拒绝了':
      'No account came back — the wallet may be locked, or you rejected the prompt',
    '未获取到账户。钱包可能处于锁定状态，或已在弹窗中拒绝。':
      'No account was returned. The wallet may be locked, or the request was rejected in the popup.',
    '账户未变更，仍为 {0}': 'The account did not change; it is still {0}',
    '已切到 {0}': 'Switched to {0}',
    '钱包未返回账户，请在 MetaMask 中手动切换账户': 'The wallet returned no account. Switch accounts manually in MetaMask.',
    '取消了切换账户 —— 账户没变': 'Account switch cancelled — the account did not change',
    '已取消切换账户，账户未变更': 'Account switching was cancelled; the account did not change',
    '切换账户失败：{0}。可在 MetaMask 中手动切换。': 'Account switching failed: {0}. You can switch manually in MetaMask.',
    '本页已断开连接。钱包中的授权仍然存在，如需彻底移除请在 MetaMask 的「已连接的网站」中操作。':
      'This page is disconnected. The approval in your wallet remains; remove it under "Connected sites" in MetaMask.',

    /* ---------------- 页脚。末尾的空格同样是**故意的**：紧挨着代码块或链接。 */
    '合约：': 'Contracts: ',
    /* 「这是 XX。」那半句只在 chain.isTestnet 为真时渲染（market.html 的 renderChainText）；
       主网走下面那条不带链名的。两条都是整句 —— 英文的语序和中文对不上。 */
    '这是 {0}。这里的一切都不是投资建议，也不构成任何价值承诺。':
      'This is {0}. Nothing here is investment advice, and nothing here promises any value.',
    '「已验证」表示该 NFT 的参数已由服务端复算并签名，参数指纹写入合约。':
      "\"Verified\" means this NFT's parameters were recomputed and signed by the server, with the fingerprint written into the contract.",
    '这里的一切都不是投资建议，也不构成任何价值承诺。':
      'Nothing here is investment advice, and nothing here promises any value.',
    /* 2026-09-19 改定：**自家市场不收手续费**，成交只走 ERC-2981 的 5% 版税。
       旧那条「再收 1% 手续费」的词条随中文原文一起删掉 —— 留着就是留一处
       会被人当真的旧口径。 */
    '成交时按 ERC-2981 支付 5% 版税，其余全部归卖家，市场不收手续费。':
      'At settlement a 5% ERC-2981 royalty is paid; the rest goes to the seller. The market charges no fee.',
    '挂单前需一次性授权市场合约；成交前 NFT 始终留在你的钱包。仅支持带参数卡的宇宙上架。':
      'Listing requires a one-time approval of the marketplace contract. The NFT stays in your wallet until the sale settles, and only universes with a parameter card can be listed.',
    /* 唯一性口径 2026-08-21 改定：**不是全站唯一，是本系列内唯一** ——
       原生 BangNames 与造物 BangNames2 是两套独立名册。 */

    /* ================================================================ 命名
       烧 BANG 给宇宙命名（BangNames）。功能的来由是《镜子》
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
    '为这组创世参数登记一个链上名字。名字在本系列内唯一，随 NFT 一同转移。':
      'Register an on-chain name for this set of genesis parameters. The name is unique within its series and transfers with the NFT.',
    '持有人销毁 BANG 设定的名字，在原生系列内唯一，可在链上查询':
      'A name the holder set by burning BANG. Unique within the native series and verifiable on-chain.',
    '持有人销毁 BANG 设定的名字，在造物系列内唯一，可在链上查询':
      'A name the holder set by burning BANG. Unique within the crafted series and verifiable on-chain.',
    /* 弹窗里那一行灰字。**必须有**：不写的话，有人给造物取名成功后会以为抢到了
       全站唯一，拿去二级市场按唯一性叫价 —— 那误解是我们造成的（用户点名要求）。 */
    '原生宇宙与造物宇宙使用两套独立名册。同一名字在两个系列各可占用一次，查重仅在本系列内进行。':
      'Native and crafted universes use two separate name registries. The same name can be taken once in each series, and the uniqueness check runs within one series only.',
    '销毁 BANG，为这组创世参数命名': 'Burn BANG to name this set of genesis parameters',
    '改名需销毁上一次的两倍数量，以避免名字被反复替换':
      'Renaming burns twice the previous amount, so a name cannot be taken over repeatedly',

    /* ---- 查重的每一种结果。**说清为什么**，否则用户只会反复试 ---- */
    '先起个名字': 'Type a name first',
    '查重中…': 'Checking…',
    '「{0}」尚未被占用，可以命名': '"{0}" is available and can be used',
    '「{0}」已被 {1} 占用。名字在本系列内唯一，先到先得。':
      '"{0}" is already taken by {1}. A name is unique within its series and assigned first come, first served.',
    '这已是它当前的名字（大小写、O/0、I/1 视为同一字符），无需修改':
      'This is already its current name (case, O/0 and I/1 count as the same character), so no change is needed',
    '名字不能是空的': 'A name cannot be empty',
    '最多 32 个字符': '32 characters at most',
    '第 {0} 个字符不可用，仅支持 a-z A-Z 0-9 与连字符':
      'Character {0} is not allowed; only a-z, A-Z, 0-9 and hyphens are accepted',
    '首尾不能是连字符': 'A name cannot start or end with a hyphen',
    '查不了这个名字': 'This name cannot be checked',
    '无法查重，命名合约地址可能有误': 'The uniqueness check failed; the naming contract address may be wrong',
    '查重失败：{0}': 'Uniqueness check failed: {0}',
    '命名需要发起交易，请先连接钱包': 'Naming sends a transaction. Connect a wallet first.',

    /* ---- 价格与授权。**授权多少必须写出来**，不做无限授权的诱导 ---- */
    '名字合法后显示价格。名字越短价格越高，改名为上一次的两倍。':
      'The price appears once the name is valid. Shorter names cost more, and renaming costs twice the previous amount.',
    '本次将销毁': 'This step burns',
    '① 仅授权本次所需的 {0} BANG，不做无限授权':
      '① Approves only the {0} BANG this transaction needs, never an unlimited allowance',
    '已授权 {0} BANG，满足本次所需，可直接点击 ②':
      '{0} BANG is already approved, which covers this transaction. Go straight to ②.',
    '销毁不可逆。名字随该 NFT 转移。': 'Burning is irreversible. The name transfers with the NFT.',
    '① 授权': '① Approve',
    '② 命名': '② Name it',
    '命名 {0}': 'Naming {0}',
    '命名已记录：{0}': 'The name is recorded: {0}',
    '名字支持 a-z、A-Z、0-9 与连字符，长度 1 至 32 个字符，首尾不得为连字符。不支持 Unicode 字符，以避免全角字形冒充已有名字。大小写不敏感；O 与 0、I、i、L、l 与 1 视为同一字符。':
      'A name accepts a-z, A-Z, 0-9 and hyphens, is 1 to 32 characters long, and may not start or end with a hyphen. Unicode is not accepted, which prevents full-width look-alikes from impersonating an existing name. Names are case-insensitive, and O and 0, as well as I, i, L, l and 1, count as the same character.',

    /* ---- BANG 那一栏里的新一格 ---- */
    '命名已销毁': 'Burned for names',
    '命名消耗的销毁量。命名是第二条销毁通路，与干预分开记录':
      'The amount burned by naming. Naming is the second burn path and is recorded separately from interventions.',
    '链上未读到命名销毁总量': 'The total burned for names could not be read on-chain',

    /* ================================================================ 造物系列
       第二套 721（MirrorCrafted）：
       沙盒里干预后的宇宙。config.js 的 crafted 没配时这些词条一条都不会上屏。
       「全部」在 i18n-app.js 里已有（'All'），按第 1 条规矩不重复收。 */
    '造物': 'Crafted',                     // 徽标 / 筛选分段 / 下拉分组 / 配置条 chip，同一个词
    '原生': 'Native',
    '按系列筛选': 'Filter by series',
    '造物宇宙 #{0}': 'Crafted Universe #{0}',
    '造物宇宙': 'Crafted Universe',   // 挂单表单下拉的 optgroup 标签
    '造物缩略图': 'Crafted universe thumbnail',
    '起源区块': 'Origin block',
    '铸造序号。造物的身份为参数卡哈希，起源区块见下方':
      'Mint number. A crafted universe is identified by its card hash; the origin block is shown below.',
    '参数卡哈希：以起源哈希与干预操作序列运行开源引擎，可复算出同一张参数卡':
      'Card hash: running the open-source engine on the origin hash and the intervention sequence reproduces the same card',
    '造物须经服务端复算与签名方可铸造，参数卡哈希已写入合约':
      'A crafted universe can only be minted after server-side recomputation and signature; the card hash is written into the contract',
    '造物系列：沙盒中干预后的宇宙。参数由起源区块哈希与干预操作序列决定，任何人可复算':
      'Crafted series: universes altered in the sandbox. Parameters follow from the origin block hash plus the sequence of interventions, and anyone can recompute them.',
    '；造物链上共 {0} 枚': '; {0} crafted on-chain',
    '当前没有造物在售。': 'No crafted universe is currently for sale.',
    /* **绝不把铸造费标成「已烧掉」**：paid 里只有一部分真的销毁，
       其余进国库 —— 原生 burnedOn 那套 100% 全烧的口径不适用造物。
       8 槽用 cardOf.burned（铸造当时写入）；7 槽未知才按当前费率折算并标明。 */
    '铸造投入': 'Paid at mint',
    '其中 {0} BANG 已销毁（铸造时写入），其余计入国库':
      'Of which {0} BANG was burned (recorded at mint); the remainder went to the treasury',
    '其中约 {0} BANG 已销毁（按当前费率 {1}% 折算，链上销毁量未知），其余计入国库':
      'Of which about {0} BANG was burned (derived from the current {1}% rate; the on-chain burn figure is unknown); the remainder went to the treasury',
    '销毁比例未读到，仅显示总投入，不估算销毁份额':
      'The burn ratio could not be read. Only the total cost is shown; the burned share is not estimated.',
    '链上未读到铸造投入': 'Mint cost could not be read on-chain',

    /* ================================================================ 广播与推广
       激励口径 2026-08-21 定稿：说费率（10%/5%）、说人工核对、说专款与反女巫；
       绝不说「自动到账 / 立即到账」。文案是长句，整句进词典，别拆开拼。 */
    '广播': 'Broadcast',
    '重新引爆': 'Detonate again',
    /* 拯救入口。术语跟 i18n-tools.js 定的一致：
       rescue = 救 / 拯救，burn = 烧（不是 spend）。
       「拯救」这个词个人中心那张持仓卡也用，i18n-site.js 里收的是**同一句英文** ——
       两处值一样，i18n.js 的撞车警告不会响；哪天要改，两处一起改。 */
    '拯救': 'Rescue',
    /* 3D 画面上那颗 HUD 按钮的两种态：死宇宙是「救救它」，活宇宙是「调教它」。
       核心词典里的 '救救它' 是短标签，这两条是完整按钮文案，不冲突。 */
    '看它的起源宇宙': 'See its origin universe',
    '查看大图': 'View full image',
    '宇宙大图': 'Full-size universe image',
    '在新标签打开': 'Open in a new tab',
    '复制链接+文案': 'Copy link + text',
    '已复制 ✓': 'Copied ✓',
    '复制不了 —— 手动选中上面的文案': 'Copy failed — select the text above by hand',
    '无法复制，请手动选中上方文案': 'Copying failed. Select the text above manually.',
    '广播到 X': 'Broadcast on X',
    /* 渠道网格（用户 2026-08-21 加渠道）：专名 X/Telegram/Facebook/Reddit/WhatsApp
       中英同形不进词典，进词典的只有这两条。与 app 分册（i18n-app.js）同句同译。 */
    '微博': 'Weibo',
    '复制链接': 'Copy link',
    /* ---- 广播 v2：复制带图、微信二维码。
       市场页与 web/arc-ui.js 的广播浮层共用这几条 —— 本分册的抬头就说了它管两处。 */
    '复制文案和图片': 'Copy text and image',
    '正在准备图片…': 'Preparing the image…',
    '复制中…': 'Copying…',
    /* 剪贴板装不下图片时**必须明说**，否则用户以为图丢了。整句进词典 */
    '图片没能复制（这个浏览器不支持），文案已经进剪贴板了 —— 图片可以在卡片上右键另存。':
      'The image could not be copied (this browser does not support it). The text is on the clipboard — you can right-click the card image and save it.',
    '图片未能复制（当前浏览器不支持），文案已复制到剪贴板。可在卡片上右键另存图片。':
      'The image could not be copied (unsupported in this browser); the text is on the clipboard. Right-click the card to save the image.',
    /* 附图预览（用户 2026-08-21「附带一张游戏内的截图」）：市场页与 web/arc-ui.js
       的广播浮层共用这三条（app 页另有一条「实况截图」小签在 app 分册）。 */
    '广播附图': 'Broadcast image',
    '点开看大图': 'Click to view it full size',
    '卡面图': 'Card art',
    /* 微信没有网页分享 API，能给的只有二维码。英文站也照样叫 WeChat */
    '微信': 'WeChat',
    '长按识别 / 扫码打开': 'Long-press to recognise, or scan to open',
    '链接过长，无法生成二维码，请直接复制下方链接。': 'The link is too long for a QR code. Copy the link below instead.',
    '参数卡尚未读取完成，请稍后再广播': 'The parameter card is still loading. Try broadcasting again shortly.',
    '参数卡尚未读取完成，请稍后再试': 'The parameter card is still loading. Try again shortly.',

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
    '没有符合筛选条件的宇宙。点击「清空筛选」查看全部。': 'No universe matches the filters. Use "Clear filters" to see all of them.',

    /* ================================================================ 物理参数筛选与排序
。维度那一组是**人话**，不是让人填数字，
       所以英文也别退回 "dim=3" 这种参数写法。「全部」在 i18n-app.js 里已有（'All'），
       按第 1 条规矩不重复收。 */
    '维度': 'Dimension',
    'D=3（可形成结构）': 'D=3 (can form structure)',
    'D>3': 'D > 3',
    '整数维': 'Integer D',
    '分数维': 'Fractional D',
    '维度↑': 'Dimension ↑',
    '维度↓': 'Dimension ↓',
    /* 维度这一组下面那句说明。**整句进词典**：英文的破折号和中文的不是一个字符 */
    'D=3 是我们所在宇宙的维数，也是唯一能形成稳定轨道的维数':
      'D=3 is the dimension of our own universe and the only one in which stable orbits form',
    /* ---- 进阶：按卡面上印的常数筛 ---- */
    '进阶：按参数卡上的常数筛选': 'Advanced: filter by the constants on the card',
    '不按常数筛': 'No constant filter',
    '光速 c': 'Speed of light c',
    '普朗克常数 h': 'Planck constant h',
    '基本电荷 e': 'Elementary charge e',
    '引力常数 G': 'Gravitational constant G',
    '精细结构常数倒数 α⁻¹': 'Inverse fine-structure constant α⁻¹',
    '最小值': 'Min',
    '最大值': 'Max',
    '常数按参数卡上的单位（SI）填写，支持 3e8 等科学计数法。两端留空表示不按该项筛选。':
      'Enter constants in the units shown on the card (SI); scientific notation such as 3e8 is accepted. Leave both ends empty to skip that filter.',
    '区间仅接受数字（如 3e8、0.0073），该项暂未计入筛选。':
      'A range accepts numbers only (such as 3e8 or 0.0073); this field is not part of the filter for now.',
    /* ---- 偏离度：档位与文案全部由服务端算，这里只是把 low/high 说成人话 ---- */
    '偏离度': 'Deviation',
    '不看偏离度': 'Any deviation',
    '接近我们的宇宙': 'Close to ours',
    '偏离中等': 'Moderately off',
    '偏离较大': 'Far off',
    '空间维数，由服务端根据参数卡推导': 'Spatial dimension, derived by the server from the parameter card',
    '分数维：维数不是整数。此类空间无法形成稳定的轨道与场结构':
      'Fractional dimension: the dimension is not an integer, and such a space cannot form stable orbits or field structure',
    '与我们所在宇宙的偏离度，由服务端计算': 'Deviation from our own universe, computed by the server',
    '与我们所在宇宙的偏离度 {0}（服务端计算，取各常数中偏离最大的一项）':
      'Deviation from our own universe: {0} (computed by the server from the most deviant constant)',
    /* ---- 服务端那一头的状态。读不到就明说读不到，不拿没筛过的一屏冒充筛过的 ---- */
    '正在按物理参数筛选…': 'Filtering by physical parameters…',
    '未读到服务端物理索引，维度、常数与偏离度暂时无法筛选。':
      'The server physics index could not be read, so dimension, constants and deviation cannot be filtered right now.',
    '未读到服务端物理索引，未按维度排序，当前仍按最新上架排序。':
      'The server physics index could not be read, so the list is not sorted by dimension and remains sorted by newest listing.',
    '挂单数量较多，服务端仅处理前 {0} 条，统计范围为这一部分。':
      'There are many listings; the server processed only the first {0}, and the counts cover that subset.',
    '索引正在重建，最新挂单可能尚未收录。': 'The index is being rebuilt, so the newest listings may not be included yet.',
    '未读到服务端物理索引，维度、常数与偏离度暂时无法筛选。点击「清空筛选」查看全部。':
      'The server physics index could not be read, so dimension, constants and deviation cannot be filtered right now. Use "Clear filters" to see all of them.',
    '没有符合这些物理条件的宇宙。可更换维度档位，或点击「清空筛选」查看全部。':
      'No universe matches these physical conditions. Try another dimension tier, or use "Clear filters" to see all of them.',

    /* ---------------- 交易记录（第四个标签页） ----------------
       数据来自服务端索引 /api/market/history：挂单 / 改价 / 撤单 / 成交一条时间线。

       **事件那一列的四个词不在这里** —— 它们是 market.html 里的 EVT_EN：
         挂单 → Listed   改价 → Price changed   撤单 → Cancelled   成交 → Sold
       因为「挂单 / 撤单 / 改价」这三个 key 在核心词典（web/i18n.js）里已经是
       **按钮**的意思（Listings / Cancel listing / Change price）。同一个 key 两种
       译法只能就近覆盖（与 TV 同一条路子），收进词典就会把挂单标签页和
       撤单按钮一起带歪。 */
    '交易记录': 'Trade history',
    '只看我的': 'Only mine',
    '暂无记录。': 'No records yet.',
    '正在读取…': 'Loading…',
    '时间': 'Time',
    '事件': 'Event',
    '卖方': 'Seller',
    '买方': 'Buyer',
    '交易': 'Transaction',
    '我': 'Me',
    '{0} 条': '{0} records',
    '区块 {0}': 'Block {0}',
    /* 'token #{0}' 两种语言一个样（token 是合约里的字段名，不翻），
       但还是收一条：漏收的句子会退回中文原文，而这一条原文就是它自己。
       '造物宇宙 #{0}' 上面已经收过了，不再收第二遍。 */
    'token #{0}': 'token #{0}',
    '在区块浏览器里打开该区块': 'Open this block in the block explorer',
    '未读到服务端交易记录，稍后再试。': 'The trade history could not be read from the server. Try again shortly.',
    '索引正在重建，最新记录可能尚未收录。': 'The index is being rebuilt, so the newest records may not be included yet.',
    /* 缩略图取不到时那块占位的提示。图本身没问题时（两个端点都是 200）
       点一下就回来了，所以这句要写成「可以再试」，不是「失败了」。 */
    '点击重新读取图片': 'Tap to load the image again'
  }, 'market');
})(typeof window !== 'undefined' ? window : this);
