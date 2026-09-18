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
    'ARC宇宙 · ARCBANG': 'Arc Universe · ARCBANG',

    /* ---- 首屏 ----
       D 在首页上第一次露面是在下面「引擎实况」那一段，那里带着一句人话解释；
       这条 lede 排在它前面，所以只说「空间有几个维度」，先不搬字母。 */
    '每个 Arc 区块哈希，都是一个宇宙': 'Every Arc block hash is a universe',
    '引爆它。哈希里读出 23 个常数：引力多强、光速多快、空间有几个维度。引擎按这套常数把宇宙从第一秒算到热寂，看它长不长得出恒星、行星、生命。':
      'Detonate it. The hash gives you 23 constants: how strong gravity is, how fast light travels, how many dimensions space has. The engine takes them and runs the universe from its first second to heat death, to see whether it grows stars, planets, life.',
    /* {0} = config.arc.js 的 chain 块给的链名（中文态 name、英文态 nameEn）。
       **整句进词典**：英文语序和中文对不上，在外面拼 T('当前在') + 链名 会拼错。 */
    '当前在 {0} · 前 387 枚每地址免费 1 次，之后 1 USDC、每地址最多 3 枚':
      'On {0} · first 387 free, one per address, then 1 USDC, up to 3 per address',

    /* ---- 首屏活仪表盘 ----
       原来还有第三格「已销毁 USDC」（totalBurned）。拯救系统下线之后那个数永远是 0，
       整格连同读数一起删掉了，词条也跟着删。 */
    'Arc 区块高度': 'Arc block height',
    '已铸宇宙': 'Universes minted',
    '分享 ARCBANG ↗': 'Share ARCBANG ↗',
    '每个 Arc 区块哈希都是一套物理定律。免费引爆一个，看它能不能长出恒星、行星和生命。喜欢再铸，全网 1,387 枚。@arcbang_xyz @arc':
      'Every Arc block hash is a set of physical laws. Detonate one for free and watch whether it grows stars, planets and life. Mint it if you like it — 1,387 in all. @arcbang_xyz @arc',
    '我在 ARCBANG 引爆了宇宙 {0}：{1}。每个 Arc 区块哈希都是一套物理定律——来引爆你自己的，前 387 枚每地址 1 次免费，之后 1 USDC。@arcbang_xyz @arc':
      'I detonated universe {0} on ARCBANG: {1}. Every Arc block hash is a set of physical laws — go detonate your own. First 387 are free (1 per address), 1 USDC after that. @arcbang_xyz @arc',

    /* ---- 1,387 ---- */
    '全网只有这么多。一枚宇宙算一千万年，铸满正好 137.87 亿年，就是这个宇宙的岁数。':
      'That is all there will ever be. One universe stands for ten million years, so the full set comes to 13.787 billion — the age of this universe.',
    '前 387 枚免费 · 每地址限 1 次': 'First 387 free · 1 per address',
    '免费期之后的固定价 · 一次铸造 gas 约 0.003 USDC':
      'The flat price after the free tier · about 0.003 USDC of gas per mint',

    /* ---- 找到你的宇宙 ---- */
    '找到你的宇宙': 'Find your universe',
    '粘一个 Arc 区块高度，或者一个 0x 开头的区块哈希。你生日那天的块、你第一笔交易所在的块，都可以。同一个哈希，谁来引爆都是同一个宇宙。':
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
    '每一张都是引擎实时渲染时截的屏，没修图。最后一张的空间维数 D = 4（D 就是空间有几个维度，我们的宇宙是 3）。D 在 4 以上的宇宙占 55%，那里没有稳定轨道，物质只会飞散或者坠核。开出 D = 14，引擎就真的在 14 维里跑 N 体，再投影到你挑的三根轴上；换一组轴，同一个宇宙换一张脸。':
      'Every frame is a screenshot of the engine rendering live, untouched. The last one has spatial dimension D = 4 — D is how many dimensions space has, and ours has 3. 55% of universes come out above D = 4, where no orbit is stable and matter either flies apart or falls into the core. Draw D = 14 and the engine really does run an N-body in 14 dimensions, then projects it onto three axes you pick. Swap the axes and the same universe wears a different face. ',
    '引擎开源，谁都能自己复算': 'The engine is open source — recompute it yourself',
    '引爆同一个哈希 →': 'Detonate the same hash →',
    '分享 ↗': 'Share ↗',
    '横向滑动看全部六个 · 点图看大图': 'Scroll sideways for all six · tap an image for full size',
    /* ---- 引擎实况：09-17 换成六张 Arc 主网区块图之后的说明与卡片文字（用户：「英文部分没汉化」）----
       图廊卡的「区块 N · 0x…」原来带 data-nolang，预渲染会整个跳过，英文页里就一直是中文；现已去掉。 */
    '每一张都是引擎实时渲染时截的屏，没修图。第五张的空间维数 D = 18（D 就是空间有几个维度，我们的宇宙是 3），第六张是 2.5 维的黑平面。D 在 4 以上的宇宙占 55%，那里没有稳定轨道，物质只会飞散或者坠核。开出 D = 14，引擎就真的在 14 维里跑 N 体，再投影到你挑的三根轴上；换一组轴，同一个宇宙换一张脸。':
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
    '每一张都是引擎实时渲染时截的屏，没修图。这里有 D = 18 的宇宙（D 就是空间有几个维度，我们的宇宙是 3），有 2.5 维的黑平面，也有 D = 1 的时空图和 D = 2 的圆盘世界。D 在 4 以上的宇宙占 55%，那里没有稳定轨道，物质只会飞散或者坠核。开出 D = 14，引擎就真的在 14 维里跑 N 体，再投影到你挑的三根轴上；换一组轴，同一个宇宙换一张脸。':
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
    '引爆随便玩，铸造看你喜不喜欢，铸完了想卖就卖。':
      'Detonate as much as you want, mint what you like, sell it when you want to.',
    '挑一个 Arc 区块，哈希当场展开成一整套物理常数，引擎推演这个宇宙的一生。Arc 每 0.5 秒出一个块，每个块都还没人引爆过。':
      'Pick an Arc block. The hash expands on the spot into a full set of physical constants and the engine runs that universe’s whole life. Arc closes a block every 0.5 seconds and nobody has detonated any of them yet. ',
    '引擎开源，可以自己复算一遍': 'The engine is open source — recompute it yourself',
    '看完再决定收不收。全网': 'You decide after you have seen it. There are',
    '枚，前 387 枚免费，每个地址 1 次，只花约 0.003 USDC 的 gas。之后一枚 1 USDC，每个地址最多 3 枚。':
      'universes in all. The first 387 are free: 1 per address, about 0.003 USDC of gas. After that, 1 USDC each, up to 3 per address.',
    '转手': 'Resell',
    '铸下来的就是一枚标准 NFT，站内市场能挂，OpenSea 这类市场也认。':
      'What you mint is a standard NFT. List it on the built-in market, or on OpenSea.',
    '看它怎么运作 →': 'See how it works →',

    /* ---- 一个哈希，一枚 ----
       这一节原来叫「为什么销毁的是真美元」，整节建在拯救系统上。
       拯救下线之后换成剩下的那个卖点：稀缺来自哈希本身。 */
    '一个哈希，一枚': 'One hash, one universe',
    'Arc 每 0.5 秒出一个块，一天十七万个。引爆它们不要钱，想炸多少炸多少。':
      'Arc closes a block every 0.5 seconds, about 170,000 a day. Detonating them is free, as often as you like.',
    '铸造只有一次机会。一个区块哈希只能长出一个宇宙，谁先铸走就是谁的，全网一共 1,387 枚。你挑中的那个被别人先铸了，它就永远不是你的了。':
      'Minting is the part you get one shot at. One block hash grows exactly one universe, it belongs to whoever mints it first, and there are 1,387 in all. If someone mints the one you picked, it is never going to be yours.',
    'ARCBANG 没有代币，没有预售，没有空投，也没有解锁表。你拿到的就是一枚 NFT，价格就是价格。':
      'ARCBANG has no token, no presale, no airdrop and no unlock schedule. What you get is an NFT, and the price is just the price.',
    /* 表头两列（数量 / 说明）走 i18n-site.js 的全局词条，这里不重收 */
    '全网总量': 'Hard cap',
    '免费期': 'Free tier',
    '之后': 'After that',
    '二级版税': 'Secondary royalty',
    '前 387 枚': 'first 387',
    '宇宙 137.87 亿岁，一枚 NFT 一千万年；写死在合约里':
      'The universe is 13.787 Gyr old and one NFT is ten million years; hard-coded in the contract',
    '每地址 1 次，只花 gas（约 0.003 USDC）': '1 per address, gas only (about 0.003 USDC)',
    '每地址最多 3 枚；合约把价格夹在 0.1 – 20 USDC 之间': 'At most 3 per address; the contract clamps the price to 0.1 – 20 USDC',
    'OpenSea 这类市场直接读得到':
      'Markets like OpenSea read it straight off the NFT',

    /* ---- 四条规矩 ---- */
    '四条规矩': 'Four rules',
    '四条，都能自己核。': 'Four of them, all checkable.',
    '免费玩，只铸你真喜欢的': 'Free to play; mint only what you like',
    '引爆不要钱，也不限次数。看完结果再决定铸不铸。':
      'Detonating costs nothing and has no limit. You decide whether to mint after you have seen the result.',
    '一个区块哈希，一个宇宙，永远': 'One block hash, one universe, forever',
    '一个哈希只能铸一枚。被别人铸走了，这个宇宙就不会再有第二枚。':
      'A hash can be minted once. If someone else takes it, there is no second copy of that universe.',
    '不发代币': 'No token',
    '没有预售，没有空投，没有解锁表，也没有任何收益话术。':
      'No presale, no airdrop, no unlock schedule, and no talk of returns.',
    '全程可验证': 'Fully verifiable',
    '哈希是种子，引擎开源。同一个哈希在你的机器上会算出同一个宇宙。':
      'The hash is the seed and the engine is open source. The same hash computes the same universe on your machine.',

    /* ---- 链上状态 ---- */
    '两个合约的地址和实时状态，都从链上现读。':
      'Addresses and live state of both contracts, read straight from the chain.',
    '合约还没上 Arc 主网。上线那天，上面两张卡会自己亮起来。':
      'The contracts are not on Arc mainnet yet. The two cards above light up on their own the day they are.',

    /* ---- 2026-09-17 首页改版（web/landing-arc.html v2「测绘板」）新增的句子 ----
       （旧版已经不在仓库里。） */
    '跳到主要内容': 'Skip to content',
    '窗口里那片星场是引擎此刻算出来的。Arc 每出一个新块，它闪一次。':
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
    '用区块哈希造宇宙。免费引爆，喜欢再铸。':
      'Universes made out of block hashes. Free to detonate; mint the ones you like.',
    '怎么运作': 'How it works',
    '自己验证': 'Verify it yourself',

    /* ======================================================================
       预热页（web/warmup-arc.html）
       ----------------------------------------------------------------------
       文案是给**想拿白名单的玩家**看的，不是给评审或开发者看的。
       三条规矩，改文案和翻译时都守住：
         · 每段只说「你能得到什么、现在做什么」。不解释实现，不解释合约。
         · 不承诺具体名额 —— 一句英文里都不许出现 "top 100 free" 这种。
           只说「名额从榜的前列取，数量定格时公布，不超过 387」。
           「榜只公布前 100 名」说的是页面行为，不是名额，可以讲。
         · 句子短，动词开头。不用破折号串解释，不在括号里再补一层。

       英文按中文重写成自然英文，不逐字。 */
    'ARCBANG 预热 · 积分榜与白名单': 'ARCBANG warm-up · leaderboard and allowlist',
    '现在是': 'Now in',
    '预热期': 'warm-up',
    '保底期': 'guaranteed round',
    '先到先得期': 'first-come round',
    '公售': 'public sale',

    /* ---- 首屏 ---- */
    '1,387 个宇宙，先到榜上的人免费领。': '1,387 universes. The names at the top of the board mint free.',
    '关注、转发、拉朋友、引爆——攒分。排名靠前就有你的。':
      'Follow, repost, bring friends, detonate. Score points. Rank high and one is yours.',
    '天': 'days', '时': 'hrs', '分': 'min', '秒': 'sec',
    '正在读取开放时间…': 'Loading the schedule…',
    '开始攒分': 'Start scoring',
    '看榜': 'See the board',
    '先玩一个宇宙': 'Play with a universe first',

    /* ---- 任务卡 ---- */
    '攒分': 'Score points',
    '关注 @arcbang_xyz': 'Follow @arcbang_xyz',
    '点一下去 X，关注完回来点「我关注了」。': 'Tap through to X, follow, then come back and tap Done.',
    '去关注': 'Follow', '我关注了': 'Done',
    '转发置顶推，回复你的码': 'Repost the pinned post, reply with your code',
    '转发后在评论里贴你的码，再把回复的链接贴回来。':
      'Repost it, reply with your code, then paste the link to that reply here.',
    '你那条回复的链接': 'Link to your reply',
    '提交链接': 'Submit',
    '点赞置顶推': 'Like the pinned post',
    '点个赞，回来点「我点了」。': 'Like it, then come back and tap Done.',
    '去点赞': 'Like it', '我点了': 'Done',
    '邀请朋友': 'Invite friends',
    '他登记并做完转发，你就拿分。': 'They sign up and repost, you score.',
    '拿链接': 'Get link',
    '引爆一个宇宙并广播': 'Detonate a universe and broadcast it',
    '每天一次，连做五天。': 'Once a day, five days.',
    '去引爆': 'Detonate',
    '先登记': 'Sign up first',
    '去转发': 'Repost',
    /* 状态词全页统一成四个。「未核」那种内部行话用户看不懂 —— 问过一次了。 */
    '未完成': 'Not done', '进行中': 'In progress', '审核中': 'Under review',
    '已完成': 'Done', '未通过': 'Rejected',
    '自动核对，通常几分钟': 'checked automatically, usually a few minutes',
    '重新提交': 'Submit again',
    '+{0} / 人，上限 {1} 人': '+{0} each, up to {1}',
    '+{0} / 天，上限 {1} 天': '+{0} a day, {1} days',
    '{0} 个': '{0} so far',
    '{0} 天': '{0} days',
    '已提交：': 'Submitted: ',
    /* 待核的原因 */
    '作者不符': 'not your account',
    '回复里没找到你的码': 'your code is not in the reply',
    '不是回复置顶推': 'not a reply to the pinned post',
    '在人工看了': 'with us for review',
    '推文打不开': 'we cannot open that post',
    '链接不对': 'bad link',
    '被驳回了': 'rejected',

    /* ---- 登记 ---- */
    '登记': 'Sign up',
    '连钱包 → 填 X 名 → 签个名。不花 gas。': 'Connect a wallet, give your X handle, sign. No gas.',
    '连接钱包': 'Connect wallet',
    '换一个钱包': 'Switch wallet',
    'X 用户名': 'X handle',
    '邀请码（可选）': 'Invite code (optional)',
    '6 位': '6 characters',
    '提交后不能改。': 'You cannot change this later.',
    '签名并登记': 'Sign and register',
    '已登记': 'Signed up',
    '你的码': 'Your code',
    '时间': 'When',
    '转发并回复这个码': 'Repost and reply with this code',
    '邀请链接': 'Invite link',
    '复制': 'Copy',
    '已复制': 'Copied',
    '朋友登记并做完转发，你拿分。': 'A friend signs up and reposts, you score.',
    '朋友登记并做完转发，你 +{0} 分。最多 {1} 个。': '+{0} per friend who signs up and reposts. Up to {1}.',
    '你在保底那一档。榜定格前多攒一点更稳。':
      'You are in the guaranteed band. A few more points before the board freezes is safer.',
    '你在免费那一档。再 {0} 分够到保底。': 'You are in the free band. {0} more points reaches guaranteed.',
    '还没进免费那一档。再 {0} 分就进去。': 'Not in the free band yet. {0} more points gets you in.',
    '下一步：关注。': 'Next: follow.',
    '下一步：转发并回复你的码。': 'Next: repost and reply with your code.',
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
    '前 100 名公开；免费名额从这里产生。': 'The top 100 are public. Free mints come off the front of this board.',
    '名次': 'Rank', '积分': 'Points',
    '在榜人数': 'On the board', '免费上限': 'Free cap', '已放出': 'Issued',
    '还没有人上榜 —— 第一个登记的就是第一名。': 'Empty so far. First to sign up takes first place.',
    '你': 'You', '榜首': 'Top',
    '展开全部': 'Show all',
    '展开全部 {0} 名': 'Show all {0}',
    '收起': 'Collapse',
    '距上一名差 {0} 分': '{0} behind the next rank',
    '共 {0} 人在榜，榜只公布前 {1} 名 · 名额数量在定格时公布':
      '{0} on the board, top {1} shown · slot counts announced at the freeze',
    '共 {0} 人在榜，榜只公布前 {1} 名 · 名单已定格':
      '{0} on the board, top {1} shown · list frozen',
    '关注': 'Follow', '转发': 'Repost', '点赞': 'Like', '邀请': 'Invites', '广播': 'Broadcast',

    /* ---- 开放时间与规则 ---- */
    '开放时间': 'Schedule',
    '待定': 'TBA',
    '榜首若干名先铸': 'Top of the board mints first',
    '先到先得': 'First come',
    '名单里的人抢免费额度': 'The list races for the free mints',
    '人人都能买': 'Open to everyone',
    '保底期一开，榜就定格。': 'The board freezes when the guaranteed round opens.',
    '规则': 'Rules',
    '总量': 'Supply',
    '1,387 枚，不增发': '1,387. No more, ever.',
    '免费': 'Free',
    '每地址 1 枚，名额从榜的前列取，数量定格时公布':
      'One per address. Taken off the front of the board; how many is announced at the freeze.',
    '1 USDC 一枚，每地址最多 3 枚': '1 USDC each, up to 3 per address',
    '唯一': 'One of one',
    '一个区块只能被铸一次': 'Each block can be minted once',
    '没有代币': 'No token',
    '不发币，不预售': 'No token, no presale',

    /* ---- 引爆那一节 ---- */
    '先玩起来': 'Play first',
    '随便挑一个 Arc 区块，看它长成什么样的宇宙。每天引爆一个、广播出去，+5 分。':
      'Pick any Arc block and see what universe it grows into. Detonate one a day, broadcast it, +5.',
    '打开模拟器': 'Open the simulator',
    '怎么算的': 'How it works',

    /* ---- 动态那几句 ---- */
    '距离{0}开放': '{0} opens in',
    '{0}的时间还没定，定了会写在这里；现在攒的分一样算数。':
      'No date for the {0} yet. Points you score now count either way.',
    '已经开到最后一段了，直接去模拟器铸造吧。': 'The last round is open. Head to the simulator.',
    '时间到了，正在刷新状态…': 'Refreshing…',
    '服务端这一刻问不到（{0}）。刷新试试；模拟器不受影响。':
      'Cannot reach the server right now ({0}). Try refreshing.',
    '先连钱包': 'Connect a wallet first',
    '先连钱包并登记': 'Connect a wallet and sign up first',
    'X 用户名填 1–15 位字母、数字或下划线，不带 @': '1–15 letters, digits or underscores. No @.',
    '邀请码是 6 位大写字母数字；没有就留空': 'Invite codes are 6 characters. Leave it empty if you have none.',
    '正在问服务端要那句话…': 'Getting the line to sign…',
    '服务端没给出要签的文案': 'No line to sign came back',
    '请在钱包里签名（不花 gas，不动任何资产）': 'Sign in your wallet. No gas, nothing moves.',
    '正在提交…': 'Submitting…',
    '贴一条推文链接': 'Paste a post link',
    '在核了…': 'Checking…',
    '核过了，分已经加上。': 'Checked out. Points added.',
    '收到了，人工看一眼。': 'Got it. We will take a look.',
    /* '你在钱包里取消了' 在 i18n.js 的全局表里已经有了，这里不重收（值不一样会打架） */
    '没检测到钱包扩展': 'No wallet extension found',
    '没检测到钱包扩展（MetaMask / 币安钱包 等）': 'No wallet extension found (MetaMask, Binance Wallet, …)',

    /* ---- 攒分区重做（2026-09-18，结构参照任务站；配色仍是本站令牌）---- */
    '关注、转发、拉朋友、引爆——攒分。积分榜决定大部分免费名额；另有一部分名额由我们直接给到早期支持者与合作伙伴。':
      'Follow, repost, bring friends, detonate. Points decide most of the free mints; some go straight to early supporters and partners.',
    '总积分': 'Points', '连钱包后显示': 'Connect to see',
    '已完成任务': 'Quests done', '共 7 项': 'of 7',
    '有效邀请': 'Valid invites', '每人 +20': '+20 each', '每人 +{0}': '+{0} each',
    '前 100': 'Top 100', '按积分': 'by points',
    '剩余天数': 'Days left',
    '分数为临时结果，预热结束复核后确认最终名单。':
      'Points are provisional. We review them when the warm-up ends, and that decides the list.',
    '任务': 'Quests', '我的记录': 'My record',
    '入门': 'START', '进阶': 'GROW', '每日': 'DAILY',
    '连钱包，填 X 名，签个名。': 'Connect a wallet, give your X handle, sign.',
    '去登记': 'Sign up', '先登记': 'Sign up first',
    '关注完回来点「我关注了」。': 'Follow, then come back and tap Done.',
    '转发后在评论里贴你的码，再把回复链接交回来。':
      'Repost it, reply with your code, then paste that reply link here.',
    '登记码 ——': 'Code ——', '登记码': 'Code',
    '创作推文': 'Write a post',
    '发一条提到 @arcbang_xyz 并带 #ARCBANG 的推。内容随意。':
      'Post anything that mentions @arcbang_xyz and tags #ARCBANG.',
    '去写一条': 'Write one',
    '连钱包后这里会显示你的记录。': 'Your record shows up here once you connect.',
    '每日打卡': 'Daily check-ins',
    '+{0} / 人': '+{0} each', '+{0} / 条': '+{0} each', '+{0} / 天': '+{0} a day',
    '登记 {0} · 三连 {1} · 邀请 {2} · 创作 {3} · 每日 {4}':
      'sign-up {0} · X {1} · invites {2} · posts {3} · daily {4}',
    '已进': 'In', '在前 100 内': 'inside the top 100',
    '再拿这么多分进前 100': 'points to reach the top 100',
    '再 {0} 分进前 100': '{0} points to the top 100',
    '已通过 {0} · 未通过 {1}': '{0} passed · {1} rejected',
    '已通过 {0} · 未通过 {1} · 每周最多 {2} 条': '{0} passed · {1} rejected · max {2} a week',
    '每周最多 {0} 条，共 {1} 条': 'Max {0} a week, {1} in total',
    '已打卡 {0} 天': '{0} days checked in',
    '创作 #{0}': 'Post #{0}',
    '{0} 人': '{0} people', '{0} 人 +{1}': '{0} → +{1}',
    '还没有人上榜，第一个是你。': 'Nobody here yet. Be the first.',
    '开始攒分': 'Start scoring', '继续': 'Continue',
    '这一条没过，看看说明再发一条。': 'That one did not pass. Check the rules and post another.',
    '转发不算创作': 'a repost is not a post of your own',
    '没提到 @arcbang_xyz': 'it does not mention @arcbang_xyz',
    '没带 #ARCBANG': 'it is missing #ARCBANG',

    /* ---- 用 X 登录 ---- */
    '用 X 登录': 'Sign in with X', '退出': 'Sign out', '换一个 X 账号': 'Use another X account',
    '还没连 X': 'X not connected', '任务按这个账号核对': 'Quests are checked against this account',
    '还没绑地址': 'No wallet bound yet', '已绑 {0}': 'Bound to {0}',
    '一个 X 账号只能绑一个地址。': 'One X account, one wallet.',
    '一个 X 账号只能绑一个地址，绑了不能改。': 'One X account, one wallet. This cannot be changed later.',
    '这个 X 已经绑了 {0}。一个 X 账号只能绑一个地址。':
      'This X account is already bound to {0}. One X account, one wallet.',
    '先用 X 登录。任务和推文都按这个账号核对。':
      'Sign in with X first. Quests and posts are checked against that account.',
    '用 X 登录 → 连钱包 → 签个名。不花 gas。':
      'Sign in with X → connect a wallet → sign. No gas.',
    '先用 X 登录': 'Sign in with X first',
    '用 X 登录，连钱包，签个名。': 'Sign in with X, connect a wallet, sign.',

    /* ---- 任务页：邀请宽卡 / 核验状态 ---- */
    '你的邀请码': 'Your invite code', '邀请链接': 'Invite link',
    '复制链接': 'Copy link', '分享到 X': 'Share on X',
    '点一下复制': 'Tap to copy', '登记后生成': 'Created when you sign up',
    '先登记，再把链接发出去。': 'Sign up first, then share the link.',
    '每邀到一个 +{0} 分，最多 {1} 个。': '+{0} points each, up to {1}.',
    '朋友用你的链接登记，并做完转发那一项，才算一个有效邀请。':
      'An invite counts once your friend signs up through your link and finishes the repost quest.',
    '我在 ARCBANG 攒分领免费宇宙，用我的链接登记：{0} @{1}':
      'I am scoring points on ARCBANG for a free universe. Sign up with my link: {0} @{1}',
    '回去做任务': 'Back to the quests',
    'X 已核实': 'verified on X', '待复核': 'pending review', '自动核过': 'auto-checked',
    'X 上没查到关注': 'no follow found on X',
    'X 上没查到点赞': 'no like found on X',
    'X 上没查到转发': 'no repost found on X',
    '我关注了': 'I followed', '我点了': 'I liked',
    '做好了，再核一次': 'Done — check again',
    '关注完回来点一下，我们去 X 上核实。': 'Follow, then tap here. We verify it on X.',
    '点完赞回来点一下，我们去 X 上核实。': 'Like it, then tap here. We verify it on X.',
    '收到了，我们去 X 上核实你的关注。': 'Got it. We are checking the follow on X.',
    '收到了，我们去 X 上核实你的赞。': 'Got it. We are checking the like on X.',
    '在 X 上查到了你的关注。': 'Your follow was found on X.',
    '在 X 上查到了你的赞。': 'Your like was found on X.',
    '已记下，复核时会在 X 上对一遍。': 'Recorded. We will check it on X during review.',
    '在 X 上没查到你的关注。做好了再点一次。': 'No follow found on X. Do it, then tap again.',
    '在 X 上没查到你的赞。做好了再点一次。': 'No like found on X. Do it, then tap again.',
    '自动核对，约 {0} 分钟后出结果': 'Auto-check, result in about {0} min',
    '自动核对，最长 {0} 分钟': 'Auto-check, up to {0} min',
    '上次核对 {0}': 'Last checked {0}',

    /* ---- 首页预热横幅 ---- */
    '预热进行中 · 剩 <b>{0}</b> 天 · 已登记 <b>{1}</b> 人':
      'Warm-up is on · <b>{0}</b> days left · <b>{1}</b> signed up',
    '预热进行中 · 已登记 <b>{0}</b> 人': 'Warm-up is on · <b>{0}</b> signed up',
    '去做任务攒分': 'Go score points',
    '用 X 登录绑定': 'via Sign in with X',
    '核对 @{0} 发的那条': 'We check the post from @{0}',
    'X 连上了。接着连钱包，然后签名登记。':
      'X connected. Now connect a wallet and sign up.',
    '用 X 登录没成功，再试一次。': 'Sign in with X did not go through. Try again.',
    '你在 X 那边取消了授权。': 'You cancelled on the X side.',
    '这次登录过期了，再点一次「用 X 登录」。': 'That sign-in expired. Tap Sign in with X again.',
    'X 那边没认这次请求，稍后再试。': 'X rejected the request. Try again in a moment.',

    /* ---- FAQ ---- */
    '常见问题': 'Asked a lot',
    'ARCBANG 是什么？': 'What is ARCBANG?',
    '把一个 Arc 区块哈希读成一套物理常数，跑出一个宇宙。合得来就铸成 NFT 留着。全网 1,387 枚，不发币。':
      'An Arc block hash is read as a set of physical constants and run as a universe. Mint the one you like and keep it. 1,387 in all. No token.',
    '积分怎么算？': 'How do points work?',
    '登记 10 分。关注 10，点赞 10，转发并回复你的码 30。每个有效邀请 20，攒到 3 / 5 / 10 人还有额外奖励。创作推文一条 20。每天引爆并广播一次 5 分。':
      'Signing up is 10. Follow 10, like 10, repost with your code 30. Every valid invite is 20, with bonuses at 3, 5 and 10. A post of your own is 20. Detonating and broadcasting is 5 a day.',
    '什么时候开铸？': 'When does minting open?',
    '预热 14 天，结束就进保底期，之后是先到先得，最后公售。页面顶上的倒计时是准的。':
      'The warm-up runs 14 days, then the guaranteed round, then first-come, then the public sale. The countdown at the top is the real one.',
    '免费名额怎么来？': 'Where do the free mints come from?',
    '积分榜决定大部分免费名额。另有一部分由我们直接给到早期支持者与合作伙伴。具体数量在榜单定格时公布，不超过合约里的 387 枚。':
      'Points decide most of them. Some go straight to early supporters and partners. How many there are is announced when the board freezes, and never more than the 387 the contract allows.',
    '为什么在 Arc 上？': 'Why Arc?',
    'Arc 的 gas 就是 USDC，一次铸造大约 0.003 USDC。不用先去买一种别的币才能玩。':
      'Gas on Arc is USDC, about 0.003 of it per mint. You do not have to buy some other coin first.',
    '引爆要钱吗？': 'Does detonating cost anything?',
    '不要。引爆、看结局、广播都不花钱，也不用连钱包。只有铸成 NFT 才上链。':
      'No. Detonating, reading the outcome and broadcasting are all free and need no wallet. Only minting touches the chain.',
    '登记信息能改吗？': 'Can I edit my sign-up?',
    '不能。X 用户名和邀请码提交后就定死了。填错了来信说一声，我们人工改。':
      'No. The X handle and invite code are fixed once submitted. If you got it wrong, write to us and we will fix it.',
    '分数为什么是临时的？': 'Why are points provisional?',
    '预热结束我们会复核一遍，刷出来的会被扣掉。复核之后的那一份才是最终名单。':
      'We review everything when the warm-up ends and take back anything farmed. What survives that review is the final list.',
  });

})(typeof window !== 'undefined' ? window : this);
