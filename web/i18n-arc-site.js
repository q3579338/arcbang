/*
 * web/i18n-arc-site.js —— ARCBANG（Arc 主网）首页的中英词条
 * ------------------------------------------------------------
 * 只放 landing-arc.html 里**界面上真会出现**的句子，而且只放 arc 站独有的那些：
 * 与 BNBBANG 首页逐字相同的句子（图廊视图名、页脚那几栏、状态卡的
 * 「在线 / 离线 / 未部署」…）已经在 web/i18n-site.js 的全局表里，
 * 这里**不重复收** —— 重复收一旦值不一样，MirrorI18n.add() 会在控制台喊
 * 「全局词条被改写」，那正是它要防的事。踩过一次：'说明' 和 '数值' 都是别人占过的 key。
 *
 * key 是中文原文（trim 后逐字相等才命中，见 i18n-site.js 顶部）。
 * 全部进全局表（不带 ns）：DOM 遍历与 /en/ 预渲染只认全局表；
 * 页面里显式 t(zh,'home') 的调用查不到 home 分册时也会落到全局，一样命中。
 *
 * ARCBANG 没有代币：这份词典里不该出现 BANG / 邀请返利 / 代币分发 这类词条。
 *
 * 2026-09-17（拯救系统下线）：首页整页文案重写成**对外的介绍**而不是工程说明，
 * 同时「拯救 / 销毁 / 0x…dEaD」那一路词条全部删掉，没有一条改写成含糊话。
 * 英文这边同样是介绍口吻，不是逐字翻译。
 */
(function (root) {
  'use strict';
  var I = root.MirrorI18n;
  if (!I) return;

  I.add({
    /* ---- 浏览器标题（/en/ 预渲染会整条换掉，这条是给运行时切语言用的）---- */
    'ARCBANG — 每个 Arc 区块哈希都是一个宇宙 | 免费引爆，一个哈希只铸一次':
      'ARCBANG — Every Arc block hash is a universe | Free to detonate, mint once.',

    /* ---- 首屏 ----
       D 在首页上第一次露面是在下面「引擎实况」那一段，那里带着一句人话解释；
       这条 lede 排在它前面，所以只说「空间有几个维度」，先不搬字母。 */
    '每个 Arc 区块哈希，都是一个宇宙': 'Every Arc block hash is a universe',
    '引爆它。哈希被读成 23 个常数：引力强度、光速、空间维数等。引擎按这套常数把宇宙从第一秒推演到热寂，看它能否形成恒星、行星与生命。':
      'Detonate it. The hash gives you 23 constants: how strong gravity is, how fast light travels, how many dimensions space has. The engine takes them and runs the universe from its first second to heat death, to see whether it grows stars, planets, life.',
    /* {0} = config.arc.js 的 chain 块给的链名（中文态 name、英文态 nameEn）。
       **整句进词典**：英文语序和中文对不上，在外面拼 T('当前在') + 链名 会拼错。 */
    '当前在 {0} · 1,387 枚，永不增发': 'On {0} · 1,387 pieces. No further issuance, ever.',

    /* ---- 首屏活仪表盘 ----
       原来还有第三格「已销毁 USDC」（totalBurned）。拯救系统下线之后那个数永远是 0，
       整格连同读数一起删掉了，词条也跟着删。 */
    'Arc 区块高度': 'Arc block height',
    '已铸宇宙': 'Universes minted',
    '分享 ARCBANG ↗': 'Share ARCBANG ↗',
    '每个 Arc 区块哈希，都是一个宇宙。免费引爆，喜欢再铸。1,387 枚，永不增发。@arcbang_xyz @arc':
      'Every Arc block hash is a universe. Free to detonate, mint the ones you like. 1,387 pieces. No further issuance, ever. @arcbang_xyz @arc',
    '我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希，都是一个宇宙。1,387 枚，永不增发。@arcbang_xyz @arc':
      'I detonated universe {0} on ARCBANG: {1}. Every Arc block hash is a universe. 1,387 pieces. No further issuance, ever. @arcbang_xyz @arc',

    /* ---- 1,387 ---- */
    '全网只有这么多。一枚宇宙算一千万年，铸满正好 137.87 亿年，就是这个宇宙的岁数。':
      'That is all there will ever be. One universe stands for ten million years, so the full set comes to 13.787 billion — the age of this universe.',
    '免费 887 枚 · 每地址 1 枚': '887 free · 1 per address',
    '付费铸造 · 价格另行公布 · 每地址上限 3 枚':
      'Paid mints · price to be announced · up to 3 per address',

    /* ---- 找到你的宇宙 ---- */
    '找到你的宇宙': 'Find your universe',
    '填入一个 Arc 区块高度，或一个 0x 开头的区块哈希，例如生日当天或首笔交易所在的区块。同一个哈希，由谁引爆都是同一个宇宙。':
      'Paste an Arc block height, or a 0x block hash. The block from your birthday, the block your first transaction landed in, anything. The same hash is the same universe, whoever detonates it.',
    '区块高度 / 0x 区块哈希': 'Block height / 0x block hash',
    '区块高度或区块哈希': 'Block height or block hash',
    /* 「个人中心」这一句被切成三段：中间那段是页内链接的文字，它的词条在
       i18n-market.js 的全局导航段里（'个人中心' → 'Profile'），**这里不重收** ——
       重收一次就是两处维护同一句话，而且值不一样时控制台会喊「全局词条被改写」。 */
    '这是一个钱包地址，不是区块。要看某个地址名下的宇宙，去':
      'That is a wallet address, not a block. To see the universes an address holds, open',
    '。': '.',
    '认不出来：给一个区块高度，或者一个 0x 开头的 64 位区块哈希。':
      'Not recognised: give a block height or a 0x block hash (64 hex chars).',

    /* ---- 引擎实况（滚动墙） ----
       **D 在整页上第一次出现就在这一句里**，所以括号里必须有一句人话；
       后面（图廊卡、模拟器）再出现就只写 D。 */
    '每一张都是引擎实时渲染的截图，未经修饰。最后一张的空间维数 D = 4（D 就是空间有几个维度，我们的宇宙是 3）。D 在 4 以上的宇宙占 55%，那里没有稳定轨道，物质只会飞散或者坠核。开出 D = 14，引擎就真的在 14 维里跑 N 体，再投影到你挑的三根轴上；换一组轴，同一个宇宙换一张脸。':
      'Every frame is a screenshot of the engine rendering live, untouched. The last one has spatial dimension D = 4 — D is how many dimensions space has, and ours has 3. 55% of universes come out above D = 4, where no orbit is stable and matter either flies apart or falls into the core. Draw D = 14 and the engine really does run an N-body in 14 dimensions, then projects it onto three axes you pick. Swap the axes and the same universe wears a different face. ',
    '引擎开源，谁都能自己复算': 'The engine is open source — recompute it yourself',
    '引爆同一个哈希 →': 'Detonate the same hash →',
    '分享 ↗': 'Share ↗',
    '横向滑动看全部六个 · 点图看大图': 'Scroll sideways for all six · tap an image for full size',
    /* ---- 引擎实况：09-17 换成六张 Arc 主网区块图之后的说明与卡片文字（用户：「英文部分没汉化」）----
       图廊卡的「区块 N · 0x…」原来带 data-nolang，预渲染会整个跳过，英文页里就一直是中文；现已去掉。 */
    '每一张都是引擎实时渲染的截图，未经修饰。第五张的空间维数 D = 18（D 就是空间有几个维度，我们的宇宙是 3），第六张是 2.5 维的黑平面。D 在 4 以上的宇宙占 55%，那里没有稳定轨道，物质只会飞散或者坠核。开出 D = 14，引擎就真的在 14 维里跑 N 体，再投影到你挑的三根轴上；换一组轴，同一个宇宙换一张脸。':
      'Every frame is a screenshot of the engine rendering live, untouched. The fifth one has spatial dimension D = 18 — D is how many dimensions space has; ours has 3 — and the sixth is a 2.5-dimensional black plane. Universes with D above 4 make up 55% of all blocks: no stable orbits exist there, matter either flies apart or falls into the core. Draw D = 14 and the engine really runs the N-body in 14 dimensions, then projects onto the three axes you pick; change the axes and the same universe shows another face.',
    '恒星系': 'Planetary system',
    '熔岩行星地表': 'Lava planet surface',
    '十八维宇宙的 N 体投影（D=18）': 'N-body projection of an 18-dimensional universe (D=18)',
    '黑平面与垂直银线（D=2.50）': 'Black plane pierced by silver lines (D=2.50)',
    '可能诞生观察者 · D=3': 'Observers possible · D=3',
    '无稳定轨道 · D=18': 'No stable orbits · D=18',
    '超出模型适用范围 · D=2.5': 'Beyond the model’s range · D=2.5',
    '区块 1,000,021 · 0xa95b…3356': 'Block 1,000,021 · 0xa95b…3356',
    '区块 5,000,017 · 0x16b9…d503': 'Block 5,000,017 · 0x16b9…d503',
    '区块 12,000,079 · 0xb0dc…d6f9': 'Block 12,000,079 · 0xb0dc…d6f9',
    '区块 18,000,081 · 0xa227…f4c9': 'Block 18,000,081 · 0xa227…f4c9',
    '区块 21,000,009 · 0xffff…5af1': 'Block 21,000,009 · 0xffff…5af1',
    '区块 9,044,269 · 0x537a…860c': 'Block 9,044,269 · 0x537a…860c',
    /* ---- 引擎实况：09-17 补到十四张之后新增的八张（用户：「图片太少了，补充」）----
       说明那一句原来写「第五张 / 第六张」，靠顺序指代；穿插加图之后顺序会变，
       改成不依赖顺序的写法（直接点名 D = 18 / 2.5 / 1 / 2 这几类），中英一起换。 */
    '每一张都是引擎实时渲染的截图，未经修饰。这里有 D = 18 的宇宙（D 就是空间有几个维度，我们的宇宙是 3），有 2.5 维的黑平面，也有 D = 1 的时空图和 D = 2 的圆盘世界。D 在 4 以上的宇宙占 55%，那里没有稳定轨道，物质只会飞散或者坠核。开出 D = 14，引擎就真的在 14 维里跑 N 体，再投影到你挑的三根轴上；换一组轴，同一个宇宙换一张脸。':
      'Every frame is a screenshot of the engine rendering live, untouched. There is a universe with spatial dimension D = 18 in here — D is how many dimensions space has; ours has 3 — a 2.5-dimensional black plane, a D = 1 spacetime diagram and a D = 2 disc world. Universes with D above 4 make up 55% of all blocks: no stable orbits exist there, matter either flies apart or falls into the core. Draw D = 14 and the engine really runs the N-body in 14 dimensions, then projects onto the three axes you pick; change the axes and the same universe shows another face.',
    '横向滑动看全部十四个 · 点图看大图': 'Scroll sideways for all fourteen · tap an image for full size',
    '一维宇宙的时空图（D=1）': 'Spacetime diagram of a one-dimensional universe (D=1)',
    '活行星的夜面与城市灯光': 'Night side of a living planet, with city lights',
    '带环的气态巨行星': 'Ringed gas giant',
    '冰封世界地表': 'Surface of an ice world',
    '沙漠世界地表': 'Surface of a desert world',
    '五维宇宙的 N 体投影（D=5）': 'N-body projection of a five-dimensional universe (D=5)',
    '二维世界的圆盘（D=2）': 'A disc world in two dimensions (D=2)',
    '黑洞主导的宇宙（晕标注）': 'A black-hole-dominated universe (halo labels)',
    '无稳定轨道 · D=1': 'No stable orbits · D=1',
    '无稳定轨道 · D=5': 'No stable orbits · D=5',
    '无稳定轨道 · D=2': 'No stable orbits · D=2',
    '黑洞主导 · D=3': 'Black-hole dominated · D=3',
    '区块 20,024,723 · 0xe428…df41': 'Block 20,024,723 · 0xe428…df41',
    '区块 20,024,600 · 0xbbd5…e7bc': 'Block 20,024,600 · 0xbbd5…e7bc',
    '区块 20,027,429 · 0x971f…af5f': 'Block 20,027,429 · 0x971f…af5f',
    '区块 20,026,445 · 0xa25f…6dbc': 'Block 20,026,445 · 0xa25f…6dbc',
    '区块 20,027,142 · 0x8856…db32': 'Block 20,027,142 · 0x8856…db32',
    '区块 20,026,568 · 0x3425…5853': 'Block 20,026,568 · 0x3425…5853',
    '区块 20,024,641 · 0x2665…bf03': 'Block 20,024,641 · 0x2665…bf03',
    '区块 20,374,740 · 0x0b6f…bf81': 'Block 20,374,740 · 0x0b6f…bf81',

    /* ---- 三个动作 ----
       第三张原来是「拯救」。拯救整套下线，这一格换成「转手」—— 铸完之后真的能做的事。 */
    '引爆免费且不限次数，铸造可选，铸后可自行转让。':
      'Detonation is free and unlimited, minting is optional, and what you mint is yours to transfer.',
    '挑一个 Arc 区块，哈希当场展开成一整套物理常数，引擎推演这个宇宙的一生。Arc 每 0.5 秒出一个区块，每个区块都尚未被引爆。':
      'Pick an Arc block. The hash expands on the spot into a full set of physical constants and the engine runs that universe’s whole life. Arc closes a block every 0.5 seconds and nobody has detonated any of them yet. ',
    '引擎开源，可以自己复算一遍': 'The engine is open source — recompute it yourself',
    '看完再决定收不收。全网': 'You decide after you have seen it. There are',
    '枚，前 887 枚免费，每个地址 1 次，只花约 0.003 USDC 的 gas。之后 500 枚价格另行公布，每个地址最多 3 枚。':
      'universes in all. The first 887 are free: 1 per address, about 0.003 USDC of gas. The remaining 500 are paid, price to be announced, up to 3 per address.',
    '转手': 'Resell',
    '铸造结果是标准 NFT，可在站内市场挂单，OpenSea 等平台同样支持。':
      'What you mint is a standard NFT. List it on the built-in market, or on OpenSea.',
    '看它怎么运作 →': 'See how it works →',

    /* ---- 一个哈希，一枚 ----
       这一节原来叫「为什么销毁的是真美元」，整节建在拯救系统上。
       拯救下线之后换成剩下的那个卖点：稀缺来自哈希本身。 */
    '一个哈希，一枚': 'One hash, one universe',
    'Arc 每 0.5 秒出一个区块，一天十七万个。引爆不收费，也不限次数。':
      'Arc closes a block every 0.5 seconds, about 170,000 a day. Detonation is free and unlimited.',
    '铸造只有一次机会。一个区块哈希只能长出一个宇宙，先铸先得。1,387 枚，永不增发。你选中的那一个被他人先铸走后，就不会再有第二枚。':
      'Minting is the part you get one shot at. One block hash grows exactly one universe and it belongs to whoever mints it first. 1,387 pieces. No further issuance, ever. Once someone mints the one you picked, there is no second copy.',
    'ARCBANG 不发行代币，不进行预售与空投，也没有解锁表。你拿到的就是一枚 NFT。':
      'ARCBANG issues no token and runs no presale or airdrop, and there is no unlock schedule. What you get is an NFT.',
    /* 表头两列（数量 / 说明）走 i18n-site.js 的全局词条，这里不重收 */
    /* ---- 2026-09-20 补：首页「铸造规则」那张表与它上面那段，五句一直没进词典 ----
       中文页切到英文时整段是中文（/en/ 预渲染也照样漏），用户报的「好多英文没汉化」里有它们。 */
    '先看结果，再决定是否铸造。1,387 枚，永不增发。免费 887 枚（保底 387 + 先到先得 500），每个地址 1 枚，仅需约 0.003 USDC 的 gas。其余 500 枚价格另行公布，每个地址最多 3 枚。':
      'See the result first, then decide whether to mint. 1,387 pieces, no further issuance ever. 887 are free (387 guaranteed plus 500 first-come), one per address, costing only about 0.003 USDC in gas. The price of the remaining 500 will be announced separately, with at most 3 per address.',
    '前往市场 →': 'Go to the market →',
    '887 枚': '887',
    '保底 387 + 先到先得 500，每地址 1 枚，仅需 gas（约 0.003 USDC）':
      '387 guaranteed + 500 first-come, one per address, gas only (about 0.003 USDC)',
    '每地址最多 3 枚；价格由合约常数限定上下界':
      'At most 3 per address; the price is bounded above and below by contract constants',
    '全网总量': 'Hard cap',
    '免费期': 'Free tier',
    '之后': 'After that',
    '二级版税': 'Secondary royalty',
    '前 887 枚': 'first 887',
    '宇宙 137.87 亿岁，一枚 NFT 一千万年；数量写入合约':
      'The universe is 13.787 Gyr old and one NFT is ten million years; hard-coded in the contract',
    '每地址 1 次，只花 gas（约 0.003 USDC）': '1 per address, gas only (about 0.003 USDC)',
    '每地址最多 3 枚；合约把价格夹在 0.1 – 20 USDC 之间': 'At most 3 per address; the contract clamps the price to 0.1 – 20 USDC',
    'OpenSea 等平台直接读取':
      'Markets like OpenSea read it straight off the NFT',

    /* ---- 四条规矩 ---- */
    '四条规则': 'Four rules',
    '四条规则，均可自行核验。': 'Four rules, all of them checkable.',
    '免费引爆，按需铸造': 'Free to detonate, mint what you want',
    '引爆不收费，也不限次数。看完结果再决定是否铸造。':
      'Detonation costs nothing and has no limit. You decide whether to mint after seeing the result.',
    '一个区块哈希，一个宇宙，永远': 'One block hash, one universe, forever',
    '一个哈希只能铸一枚。被他人铸走后，这个宇宙不会再有第二枚。':
      'A hash can be minted once. Once someone else takes it, there is no second copy of that universe.',
    '不发代币': 'No token',
    '不进行预售与空投，没有解锁表，也不作任何收益承诺。':
      'No presale, no airdrop, no unlock schedule, and no promises of returns.',
    '全程可验证': 'Fully verifiable',
    '哈希是种子，引擎开源。同一个哈希在你的机器上会算出同一个宇宙。':
      'The hash is the seed and the engine is open source. The same hash computes the same universe on your machine.',

    /* ---- 链上状态 ---- */
    '两个合约的地址和实时状态，都从链上现读。':
      'Addresses and live state of both contracts, read straight from the chain.',
    '合约尚未部署到 Arc 主网。部署完成后，上方两张卡片会自动显示链上状态。':
      'The contracts are not deployed to Arc mainnet yet. Once they are, the two cards above will show their on-chain status automatically.',

    /* ---- 2026-09-17 首页改版（web/landing-arc.html v2「测绘板」）新增的句子 ----
       （旧版已经不在仓库里。） */
    '跳到主要内容': 'Skip to content',
    '窗口中的星场由引擎实时计算。Arc 每产出一个新区块，它闪烁一次。':
      'That star field is the engine computing, right now. It flashes once for every new Arc block.',
    /* 动效开关（WCAG 2.2.2：自动播放超过 5 秒必须给一个看得见的停法）。
       按钮上写的是**点下去会发生什么**，不是当前状态。 */
    '暂停动效': 'Pause motion',
    '继续动效': 'Resume motion',
    /* 搜索框那颗提交钮：说清楚点下去发生什么 */
    '引爆这个区块': 'Detonate this block',

    /* ---- 页脚 ----
       'ARC宇宙' 在 i18n-arc.js 里已经是 'ARCBANG'（顶栏品牌名用的就是它）。
       这里**逐字照抄那个值**：值不一样就会触发 i18n.js 的「全局词条被改写」告警，
       而且 /en/ 预渲染两册都装（build-web.js 的 enDicts），谁后装谁赢，页脚会跟顶栏打架。 */
    'ARC宇宙': 'ARCBANG',
    /* 页脚导航的 aria-label —— v1 漏收，英文版那里一直是中文，顺手补上 */
    '页脚': 'Footer',
    '以区块哈希生成宇宙。引爆免费，铸造可选。':
      'Universes generated from block hashes. Detonating is free; minting is optional.',
    '怎么运作': 'How it works',
    '自己验证': 'Verify it yourself',

    /* ======================================================================
       预热页（web/warmup-arc.html）
       ----------------------------------------------------------------------
       口吻是**成熟项目的活动页**：克制、准确、陈述句。四条规矩：
         · 不用口语（「攒分」「拿分」「先玩一个」「回来点一下」），不用语气词，
           不做反问，不用破折号串解释。
         · 只写「规则是什么、现在做什么」，不解释实现，不解释合约。
         · 不承诺具体名额。一句英文里都不许出现 "top 100 free" 这种。
           只说「名额自积分榜前列产生，数量于定格时公布，不超过 887」。
           「榜只公布前 100 名」说的是页面行为，不是名额，可以讲。
         · 英文同样克制：Get started / View leaderboard / Submit for verification，
           不逐字直译中文。 */
    'ARCBANG 任务 · 积分榜与白名单': 'ARCBANG quests · leaderboard and allowlist',
    '现在是': 'Now in',
    /* 四个阶段名首字母大写：它们既进表格第一列，也进句子（「{0} opens in」）。
       表格里小写看着像没写完。 */
    '预热期': 'Warm-up',
    '白名单': 'Whitelist',
    '先到先得': 'First-come, first-served',
    '公售': 'Public sale',

    /* ---- 首屏 ---- */
    '1,387 个宇宙。积分榜前列获得免费铸造资格。':
      '1,387 universes. The top of the leaderboard mints free.',
    '天': 'days', '时': 'hrs', '分': 'min', '秒': 'sec',
    '正在获取开放时间': 'Loading the schedule',
    '开始任务': 'Get started',
    '继续任务': 'Continue',
    '查看积分榜': 'View leaderboard',
    '进入模拟器': 'Enter the simulator',
    '+{0} / 次': '+{0} each',
    '被邀请人完成登记并通过核验后，计为一位有效邀请。':
      'An invite counts once the invitee has signed up and passed verification.',
    '此 X 账号已绑定 {0}，请切换到该钱包。': 'This X account is bound to {0}; switch to that wallet.',
    '登记 {0} · 关注与互动 {1} · 邀请 {2} · 创作 {3} · 每日 {4} · 引爆 {5}':
      'Sign-up {0} · Follow & engage {1} · Invites {2} · Posts {3} · Daily {4} · Detonations {5}',

    /* ---- 任务卡 ---- */
    '关注 @arcbang_xyz': 'Follow @arcbang_xyz',
    '前往关注': 'Follow',
    '已完成，提交核验': 'Submit for verification',
    '重新提交核验': 'Resubmit for verification',
    '提交链接': 'Submit link',
    '点赞置顶推': 'Like the pinned post',
    '前往点赞': 'Like',
    /* ---- 推文互动（2026-09-19：点赞 / 转发 / 评论合成一张卡，一条推文一个任务）---- */
    '推文互动': 'Post engagement',
    '前往互动': 'Open post',
    '前往发推': 'Compose on X',
    '置顶推文': 'Pinned post',
    '官方推文 #{0}': 'Official post #{0}',
    '点赞': 'Like',
    '转发': 'Repost',
    '评论': 'Reply',
    '暂无可互动的推文，稍后再来查看。': 'No posts to engage with yet. Check back later.',
    '未核验到互动': 'engagement not found on X',
    '已在 X 核验到该互动。': 'Engagement verified on X.',
    '已提交，系统正在通过 X 核验该互动。': 'Submitted. Verifying the engagement through X.',
    '未在 X 核验到该互动，完成后可重新提交。':
      'Engagement not found on X. Complete it, then submit again.',
    '点赞、转发、评论都完成后提交，系统将通过 X 核验。':
      'Like, repost and reply, then submit. We verify all three through X.',
    '点赞、转发、评论都完成后提交，复核阶段将在 X 核验。':
      'Like, repost and reply, then submit. All three are verified on X during review.',
    '已完成 {0} / {1} 条': '{0} of {1} done',
    '已完成 +{0}': 'Done +{0}',
    '邀请': 'Invite',
    '获取邀请链接': 'Get invite link',
    '引爆宇宙并广播': 'Detonate a universe and broadcast it',
    '每日最多 3 次，累计 15 次，每次 3 分。': 'Up to 3 times a day, 15 in total, 3 points each.',
    '每日最多 {0} 次，累计 {1} 次，每次 {2} 分。': 'Up to {0} times a day, {1} in total, {2} points each.',
    '每日最多 {0} 次，累计 {1} 次': 'Up to {0} a day, {1} in total',
    '今日 {0} / {1} · 累计 {2} / {3}': 'Today {0} / {1} · Total {2} / {3}',
    '引爆并广播': 'Detonate and broadcast',
    '今日 {0} 次 · 累计 {1} 次': 'Today {0} · Total {1}',
    '前往引爆': 'Detonate',
    '前往发布': 'Post',
    '请先登记': 'Sign up first',
    '前往转发': 'Repost',
    '前往登记': 'Sign up',
    /* 状态词全页统一成四个：未完成 / 核验中 / 已完成 / 未通过。 */
    '未完成': 'Not started', '核验中': 'Verifying',
    '已完成': 'Completed', '未通过': 'Not verified',
    '系统核验中，通常数分钟': 'verification usually takes a few minutes',
    '系统核验中，约 {0} 分钟后返回结果': 'verification result in about {0} min',
    '系统核验中，最长 {0} 分钟': 'verification within {0} min',
    '上次核验 {0}': 'Last verified {0}',
    '重新提交': 'Resubmit',
    '{0} 位': '{0}',
    '已完成 {0} 天': '{0} days completed',

    '已提交：': 'Submitted: ',
    /* 待核的原因 */
    '作者不符': 'author does not match',
    '人工复核中': 'in manual review',
    '推文无法访问': 'post could not be retrieved',
    '链接格式有误': 'invalid link',
    '未通过复核': 'rejected',

    /* ---- 登记 ---- */
    '登记': 'Sign up',
    '连接钱包并完成签名。签名不产生任何链上费用。':
      'Connect a wallet and sign. Signing costs no gas.',
    '登录 X 账号，连接钱包并完成签名。签名不产生任何链上费用。':
      'Sign in with X, connect a wallet and sign. Signing costs no gas.',
    '登录 X 账号，连接钱包并完成签名。': 'Sign in with X, connect a wallet and sign.',
    '连接钱包，填写 X 用户名并完成签名。': 'Connect a wallet, enter your X handle and sign.',
    '连接钱包': 'Connect wallet',
    '更换钱包': 'Change wallet',
    'X 用户名': 'X handle',
    '邀请码（选填）': 'Invite code (optional)',
    '6 位字符': '6 characters',
    '登记信息提交后不可修改。': 'Registration details cannot be changed after submission.',
    '签名并登记': 'Sign and register',
    '已登记': 'Registered',
    '登记码': 'Registration code',
    '登记时间': 'Registered at',
    '返回任务列表': 'Back to quests',
    '邀请链接': 'Invite link',
    '复制': 'Copy',
    '已复制': 'Copied',
    '该地址在白名单优先层。榜单定格前继续累积更稳妥。':
      'This address is in the whitelist priority band. More points before the freeze is safer.',
    '该地址在免费层。再 {0} 分进入白名单优先层。':
      'This address is in the free band. {0} more points reaches the whitelist priority band.',
    '还没进免费那一档。再 {0} 分就进去。': 'Not in the free band yet. {0} more points gets you in.',
    '下一步：关注。': 'Next: follow.',
    '下一步：点赞。': 'Next: like it.',
    '下一步：把邀请链接发出去。': 'Next: send your invite link.',
    '下一步：引爆一个并广播。': 'Next: detonate one and broadcast it.',
    '都做完了，等开放。': 'All done. Now wait for the opening.',
    '你已经登记过了，下面是你的分数和登记码。': 'Already signed up. Here are your points and your code.',
    '登记完成，先拿到登记分。接着去转发置顶推 —— 那一项分最多。':
      'You are in. Next go repost the pinned post, that one is worth the most.',
    '这个地址已经登记过了，登记内容不能修改。': 'This address is already signed up and cannot be edited.',

    /* ---- 榜 ---- */
    '积分榜': 'Leaderboard',
    '公开展示 TOP 100。免费名额自积分榜产生：保底 387 枚，其余 500 枚在先到先得阶段发放。':
      'The TOP 100 are shown publicly. Free mints come from this leaderboard: 387 guaranteed slots, with the other 500 released in the first-come round.',
    '名次': 'Rank', '积分': 'Points',
    '在榜人数': 'On the board', '免费上限': 'Free cap', '免费剩余': 'Free remaining',
    '还没有人上榜 —— 第一个登记的就是第一名。': 'Empty so far. First to sign up takes first place.',
    '你': 'You', '榜首': 'Top',
    '展开全部': 'Show all',
    '展开全部 {0} 名': 'Show all {0}',
    '收起': 'Collapse',
    '距上一名差 {0} 分': '{0} behind the next rank',
    '共 {0} 人在榜，公开展示 TOP {1} · 名额数量在定格时公布':
      '{0} on the leaderboard, TOP {1} shown · slot counts announced at the freeze',
    '共 {0} 人在榜，公开展示 TOP {1} · 名单已定格':
      '{0} on the leaderboard, TOP {1} shown · list frozen',
    '关注': 'Follow', '转发': 'Repost', '点赞': 'Like', '邀请': 'Invites', '广播': 'Broadcast',

    /* ---- 开放时间与规则 ---- */
    '开放时间': 'Schedule',
    '预热期不签发任何铸造签名；白名单阶段仅对白名单地址开放；先到先得阶段对白名单与先到先得地址开放，免费额度先到先得；公售阶段向所有地址开放。':
      'No mint signatures are issued during the warm-up. The whitelist phase is open to whitelist addresses only; the first-come phase is open to whitelist and first-come addresses, with free mints on a first-come basis; the public sale is open to all addresses.',
    '待定': 'TBA',
    '白名单地址优先铸造': 'Whitelisted addresses mint first',

    '名单内地址领取剩余免费名额': 'Listed addresses claim the remaining free mints',
    '向所有地址开放': 'Open to every address',
    '白名单阶段开启时积分榜定格。': 'The leaderboard freezes when the whitelist round opens.',
    '规则': 'Rules',
    '1,387 枚，永不增发': '1,387 pieces. No further issuance, ever.',
    '免费': 'Free',
    '887 枚（保底 387 + 先到先得 500），每地址 1 枚，名单自积分榜产生':
      '887 in all (387 guaranteed + 500 first-come), one per address, allocated from the leaderboard.',
    '价格另行公布，每地址上限 3 枚': 'Price to be announced. Up to 3 per address.',
    '价格另行公布': 'Price to be announced',
    '看完再决定收不收。1,387 枚，永不增发。前 387 枚免费，每个地址 1 次，只花约 0.003 USDC 的 gas。之后价格另行公布，每个地址最多 3 枚。':
      'Look first, then decide whether to mint. 1,387 pieces. No further issuance, ever. 887 are free (387 guaranteed plus 500 first-come), one per address, costing about 0.003 USDC in gas. The remaining 500 are paid, price to be announced, up to 3 per address.',
    '唯一': 'One of one',
    '每个区块仅可铸造一次': 'Each block can be minted once',
    '没有代币': 'No token',
    '不发行代币，不进行预售': 'No token, no presale',

    /* ---- 引爆那一节 ---- */
    /* 2026-09-19 用户拍板：站内这个产品统一叫「引爆」/ Detonate。
       '模拟器' / '进入模拟器' / '打开模拟器' 三条**留着不删** —— 别处（市场页、
       文档页）还在用它们做功能名，删了那边会掉回中文。 */
    '引爆': 'Detonate',
    '前往引爆 →': 'Detonate →',
    '模拟器': 'Simulator',
    '选择任意 Arc 区块生成宇宙。每日引爆并广播一次，计 5 分。':
      'Pick any Arc block to generate a universe. Detonate and broadcast once a day for 5 points.',
    '打开模拟器': 'Open the simulator',
    '怎么算的': 'How it works',

    /* ---- 动态那几句 ---- */
    '距离{0}开放': '{0} opens in',
    '{0}的开放时间待定，确定后将在此公布。当前积分照常累积。':
      'The {0} date is not set yet and will be announced here. Points continue to accrue.',
    '已进入最后阶段，可直接在引爆页铸造。': 'The final round is open. Mint from the detonate page.',
    '已到时间，正在刷新状态': 'Refreshing',
    '暂时无法读取开放时间（{0}）。请刷新页面重试，引爆不受影响。':
      'The opening times cannot be read right now ({0}). Refresh the page and try again; detonation is unaffected.',
    '请先连接钱包': 'Connect a wallet first',
    '请先连接钱包并完成登记': 'Connect a wallet and register first',
    'X 用户名为 1–15 位字母、数字或下划线，不含 @': '1–15 letters, digits or underscores. No @.',
    '邀请码为 6 位大写字母或数字，没有可留空':
      'Invite codes are 6 characters. Leave it empty if you do not have one.',
    '正在获取待签名文本': 'Requesting the message to sign',
    '未获取到待签名文本，请稍后重试': 'No message to sign was returned. Please try again.',
    '请在钱包中完成签名（不产生费用，不转移任何资产）':
      'Sign in your wallet. No gas, no assets move.',
    '正在提交': 'Submitting',
    '请填写一条推文链接': 'Enter a post link',
    '核验中': 'Verifying',
    '核验通过，积分已计入。': 'Verified. Points have been added.',
    '已提交，将进入人工复核。': 'Submitted for manual review.',
    '本条未通过核验，请对照要求重新发布。':
      'This post was not verified. Please review the requirements and post again.',
    '该地址已完成登记，登记信息不可修改。':
      'This address is already registered and cannot be edited.',
    '登记完成，已计入登记积分。下一步：推文互动，单项分值最高。':
      'Registered. Registration points are in. Next: post engagement, the highest single task.',
    '完成关注、推文互动、邀请与引爆任务累积积分。免费共 887 枚：保底 387 枚由积分榜产生，其余 500 枚在先到先得阶段发放。':
      'Earn points by following, engaging with posts, inviting others and detonating universes. 887 mints are free: 387 guaranteed slots come from the leaderboard, and the other 500 are released in the first-come round.',
    '登记完成，已计入登记积分。下一步：推文互动，单项分值最高。':
      'Registered. Registration points have been added. The repost quest is worth the most next.',
    '已在钱包中取消': 'Cancelled in the wallet',
    /* '你在钱包里取消了' 在 i18n.js 的全局表里已经有了，这里不重收（值不一样会打架） */
    '未检测到钱包扩展': 'No wallet extension found',

    /* ---- 任务区（2026-09-18 重做结构，2026-09-19 改成产品口吻）---- */
    '完成关注、转发、邀请与引爆任务累积积分，按排名分配免费名额。另有部分名额直接分配给早期支持者与合作伙伴。':
      'Complete the follow, repost, invite and detonate quests to earn points. Free mints are allocated by rank; a portion is reserved for early supporters and partners.',
    '总积分': 'Points', '连接钱包后显示': 'Connect a wallet to view',
    '已完成任务': 'Quests completed', '共 8 项': 'of 8',
    '有效邀请': 'Valid invites', '每位 +10 分': '+10 each', '每位 +{0} 分': '+{0} each',
    'TOP 100': 'TOP 100', '按积分排名': 'by points',
    '剩余天数': 'Days remaining',
    '积分为实时统计结果，预热结束后经复核确定最终名单。':
      'Points update in real time. The final list is confirmed after review at the end of the warm-up.',
    '任务': 'Quests', '我的记录': 'My record',
    '入门': 'BASICS', '进阶': 'ADVANCED', '每日': 'DAILY',
    '完成关注后提交，系统将通过 X 核验。':
      'Follow, then submit. We verify it through X.',
    '完成点赞后提交，系统将通过 X 核验。':
      'Like the post, then submit. We verify it through X.',
    '完成关注后提交，复核阶段将在 X 核验。':
      'Follow, then submit. It is verified on X during review.',
    '完成点赞后提交，复核阶段将在 X 核验。':
      'Like the post, then submit. It is verified on X during review.',
    '转发置顶推文，在回复中附上登记码，然后提交该条回复的链接。':
      'Repost the pinned post, reply with your registration code, then submit the link to that reply.',
    '登记码 ——': 'Code ——',
    '创作推文': 'Original post',
    '发布一条提及 @arcbang_xyz 并包含 #ARCBANG 的推文，内容不限。发布后提交链接。':
      'Publish a post that mentions @arcbang_xyz and includes #ARCBANG. Content is up to you. Submit the link afterwards.',
    '在引爆页引爆任意 Arc 区块，每次计 1 分。同一区块只计一次，每日 5 次。':
      'Detonate any Arc block on the detonate page: 1 point each. One point per block, up to 5 a day.',
    '在引爆页引爆任意 Arc 区块，每次计 {0} 分。同一区块只计一次，每日 {1} 次。':
      'Detonate any Arc block on the detonate page: {0} point(s) each. One point per block, up to {1} a day.',
    /* ---- 两张「每日」卡的说明统一成同一句式（2026-09-19 用户截图指出不对称）---- */
    '在引爆页引爆任意 Arc 区块，每次 1 分。同一区块只计一次，每日最多 5 次，累计 50 次。':
      'Detonate any Arc block on the detonate page, 1 point each. Each block counts once, up to 5 a day and 50 in total.',
    '在引爆页引爆任意 Arc 区块，每次 {0} 分。同一区块只计一次，每日最多 {1} 次，累计 {2} 次。':
      'Detonate any Arc block on the detonate page, {0} point(s) each. Each block counts once, up to {1} a day and {2} in total.',
    '引爆后广播到 X，每次 3 分。每日最多 3 次，累计 15 次。':
      'Broadcast a detonation to X, 3 points each. Up to 3 a day and 15 in total.',
    '引爆后广播到 X，每次 {0} 分。每日最多 {1} 次，累计 {2} 次。':
      'Broadcast a detonation to X, {0} points each. Up to {1} a day and {2} in total.',
    /* 胶囊里的那半句：一次都没做过时整句不出现，做过了才跟在「已完成」后面。 */
    '今日 {0} / {1}': 'Today {0} / {1}',
    '+3 / 次': '+3 each',
    '连接钱包后显示任务记录。': 'Connect a wallet to view your quest record.',
    '每日引爆': 'Daily detonation',
    /* ---- 引爆计分（2026-09-19）---- */
    '引爆宇宙': 'Detonate a universe',
    '未获资格': 'Not eligible',
    '白名单：在白名单阶段优先铸造。': 'Whitelist: you mint first, in the allowlist round.',
    '先到先得：白名单阶段之后按顺序领取剩余免费名额。':
      'First-come, first-served: claim the remaining free mints in order after the whitelist phase.',
    '未获资格：完成任一任务即可进入先到先得。':
      'Not eligible: complete any quest to enter first-come, first-served.',
    '层级': 'Tier',
    '在引爆页引爆任意 Arc 区块，每次计 1 分。':
      'Detonate any Arc block on the detonate page for 1 point each.',
    '+{0} / 次': '+{0} each', '+1 / 次': '+1 each',
    '在引爆页引爆任意 Arc 区块，每次计 {0} 分。同一区块只计一次。':
      'Detonate any Arc block on the detonate page for {0} point each. Each block counts once.',
    '每日最多 {0} 分，预热期最多 {1} 分':
      'Up to {0} points a day, {1} during the warm-up',
    '今日 {0} / {1} 分 · 累计 {2} / {3} 分':
      '{0} of {1} points today · {2} of {3} in total',
    '引爆计分': 'Detonation points',
    '今日 {0} 分 · 累计 {1} 分 · 共 {2} 个区块':
      '{0} points today · {1} in total · {2} blocks',
    '+{0} / 人': '+{0} each', '+{0} / 条': '+{0} each', '+{0} / 天': '+{0} a day',
    /* 模板里写死的那几个默认值：JS 跑起来之前（以及英文预渲染时）亮的是它们，
       只收 {0} 版的话英文页上会先闪一行中文。三条要跟 server 的默认分值对上。 */
    '+10 / 人': '+10 each', '+20 / 条': '+20 each', '+1 / 次': '+1 each', '+3 / 次': '+3 each',
    '每周最多 3 条，共 6 条，每条 20 分。': 'Up to 3 per week, 6 in total, 20 points each.',
    '登记 {0} · 三连 {1} · 邀请 {2} · 创作 {3} · 每日 {4} · 引爆 {5}':
      'registration {0} · X {1} · invites {2} · posts {3} · daily {4} · detonations {5}',
    '已进入': 'Yes', '已进 TOP 100': 'inside the TOP 100',

    '距 TOP 100 所需积分': 'points needed to reach the TOP 100',
    '距 TOP 100 还差 {0} 分': '{0} points to the TOP 100',
    '已通过 {0} · 未通过 {1}': '{0} verified · {1} not verified',
    '已通过 {0} · 未通过 {1} · 共 {2} 条': 'Approved {0} · rejected {1} · {2} in total',
    '每周最多 {0} 条，共 {1} 条': 'Up to {0} per week, {1} in total',
    '每周最多 {0} 条，共 {1} 条，每条 {2} 分。': 'Up to {0} per week, {1} in total, {2} points each.',
    '已通过 {0} · 未通过 {1} · 每周上限 {2} 条':
      '{0} verified · {1} not verified · limit {2} per week',
    '每周上限 {0} 条，预热期共 {1} 条': 'Limit {0} per week, {1} during the warm-up',
    '创作 #{0}': 'Post #{0}',
    '{0} 人 +{1}': '{0} → +{1}',
    '还没有人上榜，完成任务即可上榜。': 'No entries yet. Be the first.',
    '转发不计为创作推文': 'a repost does not count as an original post',
    '未提及 @arcbang_xyz': 'it does not mention @arcbang_xyz',
    '未包含 #ARCBANG': 'it is missing #ARCBANG',

    /* ---- 用 X 登录 ---- */
    '用 X 登录': 'Sign in with X', '退出登录': 'Sign out', '更换 X 账号': 'Change X account',
    '未连接 X 账号': 'X account not connected',
    '任务以该账号核验': 'Quests are verified against this account',
    '尚未绑定地址': 'No address bound', '已绑定 {0}': 'Bound to {0}',
    '一个 X 账号仅可绑定一个地址。': 'One X account can be bound to one address.',
    '一个 X 账号仅可绑定一个地址，绑定后不可更改。':
      'One X account can be bound to one address. This cannot be changed afterwards.',
    '该 X 账号已绑定 {0}。一个 X 账号仅可绑定一个地址。':
      'This X account is already bound to {0}. One X account can be bound to one address.',
    '请先登录 X 账号。任务与推文均以该账号核验。':
      'Sign in with X first. Quests and posts are verified against that account.',
    '请先登录 X 账号': 'Sign in with X first',
    '经 X 登录绑定': 'bound via Sign in with X',
    '以 @{0} 的推文进行核验': 'Verified against posts from @{0}',
    'X 账号已连接。请继续连接钱包并完成签名登记。':
      'X account connected. Next, connect a wallet and complete the signature.',
    'X 登录未完成，请重试。': 'Sign in with X did not complete. Please try again.',
    '已在 X 取消授权。': 'Authorisation was cancelled on X.',
    '本次登录已过期，请重新发起 X 登录。':
      'This sign-in has expired. Please start Sign in with X again.',
    'X 未受理本次请求，请稍后重试。': 'X did not accept the request. Please try again shortly.',

    /* ---- 任务页：邀请宽卡 / 核验状态 ---- */
    '你的邀请码': 'Your invite code',
    '复制链接': 'Copy link', '分享到 X': 'Share on X',
    '点击复制': 'Click to copy', '完成登记后生成': 'Available after registration',
    '完成登记后生成邀请链接。': 'Your invite link is created once you register.',
    '每位有效邀请 +{0} 分，上限 {1} 位。': '+{0} points per valid invite, up to {1}.',
    '被邀请人完成登记并通过转发核验后，计为一位有效邀请。':
      'An invite counts once the invitee registers and passes repost verification.',
    '我正在参与 ARCBANG 预热，积分榜前列可免费铸造。通过此链接登记：{0} @{1}':
      'I am taking part in the ARCBANG warm-up. The top of the leaderboard mints free. Register here: {0} @{1}',
    'X 已核实': 'verified on X', '待复核': 'pending review', '已通过核验': 'verified',
    '未核验到关注': 'follow not verified',
    '未核验到点赞': 'like not verified',
    '未核验到转发': 'repost not verified',
    '未核验通过': 'not verified',
    '已提交，系统正在通过 X 核验该关注。':
      'Submitted. We are verifying the follow through X.',
    '已提交，系统正在通过 X 核验该点赞。':
      'Submitted. We are verifying the like through X.',
    '已在 X 核验到该关注。': 'The follow has been verified on X.',
    '已在 X 核验到该点赞。': 'The like has been verified on X.',
    '已记录，复核阶段将在 X 核验。': 'Recorded. It will be verified on X during review.',
    '未在 X 核验到该关注，完成后可重新提交。':
      'The follow could not be verified on X. Complete it and submit again.',
    '未在 X 核验到该点赞，完成后可重新提交。':
      'The like could not be verified on X. Complete it and submit again.',

    /* ---- 首页预热横幅 ---- */
    '预热期进行中': 'Warm-up in progress',
    '预热期进行中 · 剩余 <b>{0}</b> 天 · 已登记 <b>{1}</b> 人':
      'Warm-up in progress · <b>{0}</b> days remaining · <b>{1}</b> registered',
    '预热期进行中 · 已登记 <b>{0}</b> 人': 'Warm-up in progress · <b>{0}</b> registered',
    '前往任务页': 'View quests',
    '用 X 登录绑定': 'via Sign in with X',
    '核对 @{0} 发的那条': 'We check the post from @{0}',
    'X 连上了。接着连钱包，然后签名登记。':
      'X connected. Now connect a wallet and sign up.',
    '用 X 登录没成功，再试一次。': 'Sign in with X did not go through. Try again.',
    '你在 X 那边取消了授权。': 'You cancelled on the X side.',
    '这次登录过期了，再点一次「用 X 登录」。': 'That sign-in expired. Tap Sign in with X again.',
    'X 那边没认这次请求，稍后再试。': 'X rejected the request. Try again in a moment.',

    /* ---- FAQ ---- */
    '常见问题': 'FAQ',
    'ARCBANG 是什么？': 'What is ARCBANG?',
    'ARCBANG 将 Arc 区块哈希解析为一套物理常数，并据此推演出一个完整宇宙。结果可铸造为 NFT：1,387 枚，永不增发。不发行代币。':
      'ARCBANG reads an Arc block hash as a set of physical constants and simulates a complete universe from it. The result can be minted as an NFT: 1,387 pieces, no further issuance, ever. There is no token.',
    '积分怎么算？': 'How are points calculated?',
    '登记 10 分，关注 20 分。推文互动：置顶推 50 分，其他官方推文每条 20 分。每位有效邀请 10 分（上限 10 位），累计 3 / 5 / 10 位另奖 10 / 20 / 30 分。创作推文每条 20 分，每周最多 3 条、共 6 条。引爆并广播每次 3 分（每日 3 次，累计 15 次），引爆每次 1 分。':
      'Registration 10 points, follow 20. Post engagement: 50 for the pinned post, 20 for each other official post. Each valid invite is 10 points (up to 10 invites), with milestone bonuses of 10 / 20 / 30 at 3, 5 and 10. Each original post is 20 points, up to 3 a week and 6 in total. Detonating and broadcasting is 3 points a time (3 a day, 15 in total), detonating alone 1 point.',
    '选择任意 Arc 区块生成宇宙。引爆并广播每次 3 分，每日最多 3 次。':
      'Pick any Arc block to generate a universe. Detonating and broadcasting is 3 points a time, up to 3 a day.',
    '什么时候开铸？': 'When does minting open?',
    '预热期共 14 天，结束后依次进入白名单、先到先得与公售三个阶段。具体时间以页面顶部倒计时为准。':
      'The warm-up runs for 14 days, followed by the whitelist, first-come and public sale phases. The countdown at the top of the page is authoritative.',
    '免费名额怎么来？': 'How are free mints allocated?',
    '免费共 887 枚，全部来自积分榜：保底 387 枚在白名单阶段优先铸造，其余 500 枚在先到先得阶段发放。每地址免费 1 枚。':
      'All 887 free mints come from the leaderboard: 387 guaranteed slots mint first in the allowlist round, and the other 500 are released in the first-come round. One free mint per address.',
    '为什么在 Arc 上？': 'Why Arc?',
    'Arc 以 USDC 作为 gas，单次铸造约 0.003 USDC，无需先行持有其他代币。':
      'Arc uses USDC for gas, about 0.003 USDC per mint, so no other token is required beforehand.',
    '引爆要钱吗？': 'Is detonating free?',
    '引爆、查看结局与广播均不收费，也无需连接钱包。仅铸造 NFT 时产生链上交易。':
      'Detonating, viewing the outcome and broadcasting are free and require no wallet. Only minting creates an on-chain transaction.',
    '登记信息能改吗？': 'Can registration details be changed?',
    '不可修改。X 用户名与邀请码提交后即固定。如填写有误，请联系我们人工处理。':
      'No. The X handle and invite code are fixed once submitted. If a detail is wrong, contact us and we will correct it manually.',
    '积分为何是实时统计结果？': 'Why are points described as real-time?',
    '预热结束后将进行复核，异常积分会被扣除。复核后的结果为最终名单。':
      'A review is carried out after the warm-up and irregular points are removed. The reviewed result is the final list.',

    /* ---- 资格查询页（web/check-arc.html → check.html / en/check.html）----
       2026-09-19 新增。层级名（白名单 / 先到先得 / 未获资格）、阶段名（预热期 / 公售）、
       「已登记」「前往登记」「时间待定」「免费剩余」「未检测到钱包扩展」「已在钱包中取消」
       都已经在别处收过了，**这里不重复收** —— 重复一次值不一样就会触发「全局词条被改写」。 */
    'ARCBANG 资格查询 · 白名单与先到先得': 'ARCBANG eligibility check · whitelist and first-come',
    '资格查询': 'Check eligibility',
    '输入钱包地址，查看该地址在本轮的资格与阶段。':
      'Enter a wallet address to see its eligibility and phase for this round.',
    '钱包地址': 'Wallet address',
    '查询': 'Check',
    '使用当前钱包': 'Use connected wallet',
    '未登记': 'Not registered',
    '当前阶段': 'Current phase',
    '可铸造阶段': 'Eligible phase',
    /* {0} = 本地时间串（浏览器 toLocaleString），没配开放时间时是「时间待定」。 */
    '开放时间：{0}': 'Opens {0}',
    '请输入钱包地址': 'Enter a wallet address',
    '地址格式不正确': 'That address is not valid',
    '正在查询…': 'Checking…',
    '查询失败，请稍后重试': 'The check failed. Please try again shortly.',
    '该地址为白名单，可在白名单阶段免费铸造 1 枚。':
      'This address is on the whitelist and can mint 1 free during the whitelist phase.',
    '该地址为先到先得，可在先到先得阶段按剩余额度免费铸造。':
      'This address is first-come and can mint free during the first-come phase while free mints remain.',
    '该地址未获资格，可在公售阶段付费铸造。':
      'This address is not eligible for a free mint and can buy during the public sale.',
    '查询结果为当前实时状态，预热结束定格榜单后为准。':
      'This reflects the current live state; the leaderboard is authoritative once it freezes at the end of the warm-up.',
    '榜单已定格。': 'The leaderboard is frozen.',
  });

})(typeof window !== 'undefined' ? window : this);
