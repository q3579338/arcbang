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
       预热页（web/warmup-arc.html，2026-09-18）
       ----------------------------------------------------------------------
       口径：**不点名谁是保底层**（用户拍板名单构成不公开），段名一律说
       「保底期 / 先到先得期 / 公售」。英文这边同样只给段名，不解释名单怎么来的。
       这一页的动态文案（倒计时那行、登记流程的每一句）也全在这里 ——
       它们由页内脚本调 MirrorI18n.t() 现翻，漏一条英文版就是半英半中。 */
    'ARCBANG 预热 · 白名单登记与开放时间': 'ARCBANG warm-up · allowlist sign-up and opening times',
    '现在是': 'Currently in',
    '预热期': 'warm-up',
    '保底期': 'guaranteed round',
    '先到先得期': 'first-come round',
    '公售': 'public sale',
    '保底': 'Guaranteed',
    '先到先得': 'First-come',
    '待审': 'Under review',
    '铸造还没开。先把名字留下。': 'Minting has not opened. Leave your name first.',
    '全网 1,387 枚宇宙，前 387 枚给白名单免费领（每地址 1 枚）。预热期不签任何铸造签名 —— 但引爆、模拟、看结局这些本来就免费，随时都能玩。':
      '1,387 universes in all; the first 387 go free to the allowlist, one per address. No mint signature is issued during the warm-up — but detonating, simulating and reading the outcome were always free, and they are open right now.',
    '天': 'days', '时': 'hrs', '分': 'min', '秒': 'sec',
    '正在问服务端开放时间…': 'Asking the server for the opening times…',
    '登记白名单': 'Join the allowlist',
    '先去引爆一个宇宙（免费）': 'Go detonate a universe first (free)',
    '开放时间': 'Opening times',
    '四段依次开。到点自动往下走，页面上的倒计时读的就是服务端那一份，不是我们在这里写死的数字。':
      'The four rounds open in order and advance on their own. The countdown reads the server’s own clock, not a number hard-coded into this page.',
    '名单里的一部分地址先铸，不跟人抢': 'Part of the list mints first, with nothing to race for',
    '名单里的人都能铸，387 枚免费额度抢完为止': 'Everyone on the list can mint, until the 387 free slots run out',
    '人人都能铸，1 USDC 一枚，每地址最多 3 枚': 'Open to all, 1 USDC each, up to 3 per address',
    '时间待定': 'to be announced',
    '规则': 'The rules',
    '总量': 'Supply',
    '1,387 枚，永远不增发': '1,387, and never any more',
    '一枚宇宙算一千万年，铸满正好 137.87 亿年 —— 这个宇宙的岁数':
      'One universe stands for ten million years, so the full set comes to 13.787 billion — the age of this universe',
    '免费额度': 'Free tier',
    '387 枚，每地址 1 枚，只给白名单': '387, one per address, allowlist only',
    '免费不等于白送：要先真的跑完一次引爆流程才拿得到签名':
      'Free is not the same as handed out: you only get a signature after actually running a detonation',
    '公售价': 'Public price',
    '1 USDC 一枚，每地址最多 3 枚': '1 USDC each, up to 3 per address',
    'Arc 上 gas 就是 USDC，一次铸造的 gas 约 0.003 USDC':
      'Gas on Arc is USDC; a mint costs about 0.003 USDC of it',
    '一个哈希只铸一次': 'One hash, one mint',
    '某个区块被谁引爆并铸走，它就没了': 'Once a block has been detonated and minted, it is gone',
    '同一个哈希，谁来引爆都是同一个宇宙': 'The same hash is the same universe, whoever detonates it',
    '没有代币': 'No token',
    '不发币、不预售、不做返利池': 'No token, no presale, no rebate pool',
    '收入只有铸造款和二级市场版税两项': 'The only income is mint proceeds and secondary royalties',
    '连钱包 → 签一句话（不花 gas、不动任何资产）→ 填你的 X 用户名 → 提交。登记不等于进名单：我们人工审完才会把地址放进去。':
      'Connect a wallet, sign one line (no gas, nothing moves), give your X handle, submit. Signing up is not the same as being on the list — we review by hand before an address goes in.',
    /* '连接钱包' / '已复制' 已经在 i18n.js 的全局表里且值逐字相同，这里**不重收** */
    '换一个钱包': 'Switch wallet',
    '你的 X 用户名（不带 @）': 'Your X handle (without the @)',
    '邀请码（可选，别人给你的 6 位码）': 'Invite code (optional — the 6 characters someone gave you)',
    '6 位大写字母数字': '6 characters, A–Z and 0–9',
    '签名并登记': 'Sign and register',
    '你的登记码（同时也是邀请码）': 'Your sign-up code (it doubles as your invite code)',
    '当前层级': 'Your tier',
    '有效邀请': 'Valid invites',
    '排位': 'Rank',
    '把下面这条链接发给朋友。对方登记并通过审核之后才算一个有效邀请。':
      'Send the link below to a friend. It counts as a valid invite once they have signed up and passed review.',
    '复制邀请链接': 'Copy invite link',
    '去转发置顶推并回复登记码': 'Repost the pinned post and reply with your code',
    '任务：关注 @arcbang_xyz，转发置顶那条推，并在评论里回复你的登记码。我们按登记码人工比对，所以码一定要原样贴上去。':
      'The task: follow @arcbang_xyz, repost the pinned post, and reply to it with your sign-up code. We match those codes by hand, so paste yours exactly.',
    '已登记地址': 'Addresses signed up',
    '已进名单': 'On the list',
    '免费额度余量': 'Free slots left',
    '引爆随时可以玩': 'Detonating is open right now',
    '预热的是铸造，不是模拟器。粘一个 Arc 区块高度或哈希进去，引擎会把它读成 23 个物理常数，从奇点算到热寂 —— 这件事不花钱、不连钱包、不上链，现在就能做。':
      'It is the minting that is in warm-up, not the simulator. Paste an Arc block height or hash and the engine reads it as 23 physical constants and runs it from the singularity to heat death — free, no wallet, nothing on-chain.',
    '打开模拟器': 'Open the simulator',
    '先看它是怎么算的': 'See how it computes first',
    /* ---- 动态那几句（页内脚本现翻）---- */
    '距离{0}开放': '{0} opens in',
    '{0}的时间还没定，定了会写在这里；登记随时可以。':
      'The time for the {0} is not set yet; it will appear here once it is. Signing up is open regardless.',
    '已经开到最后一段了，直接去模拟器铸造吧。': 'The last round is already open — head to the simulator and mint.',
    '时间到了，正在刷新状态…': 'Time is up — refreshing…',
    '服务端这一刻问不到（{0}）。刷新试试；模拟器不受影响。':
      'The server is not answering right now ({0}). Try refreshing; the simulator is unaffected.',
    '把下面这条链接发给朋友。对方登记并通过审核之后才算一个有效邀请；攒够 {0} 个有效邀请会自动升到保底层。':
      'Send the link below to a friend. It counts as a valid invite once they have signed up and passed review; {0} valid invites move you into the guaranteed tier automatically.',
    '先连钱包': 'Connect a wallet first',
    'X 用户名填 1–15 位字母、数字或下划线，不带 @': 'An X handle is 1–15 letters, digits or underscores, without the @',
    '邀请码是 6 位大写字母数字；没有就留空': 'An invite code is 6 characters, A–Z and 0–9. Leave it empty if you have none',
    '正在问服务端要那句话…': 'Asking the server for the line to sign…',
    '服务端没给出要签的文案': 'The server did not return a line to sign',
    '请在钱包里签名（不花 gas，不动任何资产）': 'Sign in your wallet (no gas, nothing moves)',
    '正在提交…': 'Submitting…',
    '你已经登记过了，下面就是你的登记码。': 'You had already signed up — here is your code.',
    '登记成功。审核通过后你的地址会出现在名单里 —— 下面是你的登记码。':
      'You are signed up. Your address goes on the list once it passes review — here is your code.',
    '没检测到钱包扩展': 'No wallet extension detected',

    /* 铸造页（web/arc-ui.js）那几句放号文案收在 **i18n-arc.js** 里 ——
       app.html 的注入层（build-web.js 的 LAYER）不加载本册，收在这里英文站上就永远是中文。 */
  });

})(typeof window !== 'undefined' ? window : this);
