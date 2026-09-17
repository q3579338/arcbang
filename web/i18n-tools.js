/*
 * web/i18n-tools.js —— web/intervene.js, web/gauges.js, web/hint.js 的中英词条
 * ------------------------------------------------------------
 * 只放**界面上真会出现**的句子；注释、日志、开发用文字不进这里。
 * key 是中文原文，逐字相等才命中；漏翻的自动退回中文，不会出现裸 key。
 * 机制与约定见 web/i18n.js 顶部。
 *
 * 术语（三个文件统一，别各译各的）：
 *   干预 intervention · 生存半径 survival radius · 一格 one notch · 救活 rescue
 *   门 gate · 余量 margin · 新手模式 novice mode · 烧 burn（不是 spend）
 * 稀有度字母在 web/i18n.js 的核心词典里，这里不重复收。
 *
 * hint.js / gauges.js 的门与仪表**定义表里存的仍是中文原文**：那两张表别的模块要读，
 * 翻译只发生在 render 的时候（web/gauges.js 的 render、web/intervene.js 的 renderStuck/askHint）。
 * 所以这里收的是那些原文，不是另起一套。
 */
(function (root) {
  'use strict';
  var I = root.MirrorI18n;
  if (!I) return;            // i18n 核心没加载：静默退回全中文，不要让页面挂掉
  I.add({
    /* ---- 干预沙盒 / 仪表 / 提示的界面文案（web/intervene.js、web/gauges.js） ----
       （旧词条 '26 道门全通了…' 已随源码改为带 {n} 的版本，2026-08-21 清掉。） */
    '{n} 道门全通了 —— 这个宇宙可以有观察者。': 'All {n} gates passed — this universe can have observers.',
    '还差 {n} 道门': 'Still {n} gates to go',
    '门全通了': 'All gates passed',
    '另外 {n} 个仪表已经达标，收起来了': 'Another {n} gauges already pass — folded away',
    '先修这几道（共 {n} 道没过）：': 'Fix these first ({n} gates still failing):',
    '收起 —— 只看还差什么': 'Fold up — show only what is missing',
    '摊开全部 {n} 道门和 {m} 个仪表': 'Spread out all {n} gates and {m} gauges',
    /* ---- 两段式拯救（web/intervene.js 的简明视图 / 维度一步，2026-08-21 补收） ---- */
    '这个宇宙解不出三维 —— 弦气模块没开，或者它的维度已经是 3。':
      'No three-dimensional solution for this universe — the string-gas module is off, or its dimension is already 3.',
    '服务端说这个方向推不动，维度这一步走不了':
      'The server says this direction cannot be pushed — the dimension step cannot proceed',
    '服务端算不出这一步：': 'The server could not compute this step: ',
    '这一个真的推不到三维 —— 它现在是 {n} 维。':
      'This one truly cannot be pushed to three dimensions — it is {n}-dimensional now.',
    '弦气那三个参数在整个取值范围里扫过去，都没有一段能让空间恰好解开成三维。':
      'Sweeping the three string-gas parameters across their whole range, no stretch lets space unfurl into exactly three dimensions. ',
    '这在实测里极少见（379 个 D≠3 的死宇宙里一个都没有）。换一个宇宙吧。':
      'This is extremely rare in practice (not one of 379 measured D≠3 dead universes). Try another universe.',
    '简明视图：只显示当前卡住的门和相关参数': 'Focused view: only the blocking gate and its related parameters',
    '简明视图': 'Focused view',
    '全部视图': 'Full view',
    '还差什么': 'What is still missing',
    '全部参数': 'All parameters',
    '（点开手动微调）': '(open to fine-tune by hand)',
    '简明视图：只列当前卡住的门，参数表只留相关的那几个':
      'Focused view: only the blocking gate is listed, and the parameter table keeps just the relevant few',
    '全部视图：{n} 道门和 {m} 个参数都摊开': 'Full view: all {n} gates and {m} parameters spread out',
    '（{n} 次操作）': '({n} moves)',
    '现在只列没过的门、只留相关参数；点一下看全部 {n} 道门':
      'Only failing gates and relevant parameters are listed now; click to see all {n} gates',
    '现在摊开全部 {n} 道门和 {m} 个参数；点一下回到简明视图':
      'All {n} gates and {m} parameters are spread out now; click to go back to the focused view',
    '提示模块没加载，只能用全部视图':
      'The hint module is not loaded — only the full view is available',
    '先把维度推到 3 —— 维度不对的时候，其余参数的诊断没有意义':
      'Push the dimension to 3 first — while the dimension is wrong, diagnosing the other parameters means nothing',
    '第 1 步 / 共 2 步': 'Step 1 of 2',
    '这个宇宙是 <b>{n} 维</b>的，不是三维。': 'This universe is <b>{n}-dimensional</b>, not three-dimensional.',
    '核合成、恒星、化学的公式全都只在三维成立 —— 维度不对的时候，推其余参数是没有意义的。<b>这一步有确定答案</b>：程序已经算出离现在最近的三维解，一次点击就能推到位（实测 100% 有解）。':
      'The formulas for nucleosynthesis, stars and chemistry only hold in three dimensions — while the dimension is wrong, nudging anything else is pointless. <b>This step has a definite answer</b>: the program has already solved for the nearest three-dimensional solution, and one click pushes it all the way (measured: a solution always exists).',
    '把维度推到 3': 'Push the dimension to 3',
    '正在估价…': 'Pricing…',
    '（推 {n} 格 · 沙盒不收费）': '({n} notches · the sandbox is free)',
    '（估不出价，点一下试试）': '(could not price it — click to try)',
    '第 2 步 / 共 2 步': 'Step 2 of 2',
    '维度已经是 3 了。还差一道门：': 'The dimension is already 3. One gate still fails: ',
    '维度已经是 3 了，没有卡住的门。': 'The dimension is already 3, and no gate is blocking.',
    '剩下的是程度问题 —— 下面的仪表还差一点。继续推就是。':
      'What is left is a matter of degree — the gauges below are just short. Keep nudging.',
    '（这一段没有确定答案 —— 只能一格一格试）':
      '(this stretch has no definite answer — you can only try notch by notch)',
    '后面还排着：': 'Still queued behind it: ',
    '　等 {n} 道': '　— {n} gates in all',
    '门是有因果顺序的：前面那道不过，后面这些大多会跟着自己好。':
      'Gates come in causal order: until the one in front passes, most of the later ones will fix themselves.',
    '原 ': 'was ',
    '（维度归它们管 —— 也可以手动推）': '(these govern the dimension — you can also nudge them by hand)',
    '（点开手动微调 · 现在只留 {n} 个相关的）': '(open to fine-tune by hand · only the {n} relevant ones are kept for now)',
    '（点开手动微调 · 共 {n} 个）': '(open to fine-tune by hand · {n} in all)',
    '另外 {n} 个参数和当前这道门没关系，先收起来了 ——右上角切到「全部视图」就能看到全部。':
      'Another {n} parameters have nothing to do with the current gate and are folded away — switch to "Full view" in the top right to see everything.',
    '简明视图还开着 —— 只是<b>现在没有卡住的门可以筛了</b>，没什么该收起来的，所以参数全在这里。':
      'The focused view is still on — it is just that <b>no blocking gate is left to filter by</b>, nothing needs folding away, so every parameter is here.',
    '活了 —— 这个宇宙能诞生观察者。': 'It lives — this universe can give rise to observers.',
    '共推了 {n} 格，真烧要 ': '{n} notches in all; burning for real costs ',
    '（沙盒不收费）。烧掉的量会永久记在链上（burnedOn）—— 这才是这枚 NFT 稀缺的部分。':
      '(the sandbox is free). The amount burned is recorded on-chain forever (burnedOn) — that is the scarce part of this NFT.',
    '正在推…': 'Pushing…',
    '维度推到 3 了 —— 这个宇宙当场就活了。（推了 {n} 格）':
      'The dimension reached 3 — and this universe came alive on the spot. ({n} notches)',
    '维度推到 3 了（推了 {n} 格）。': 'The dimension reached 3 ({n} notches). ',
    '这一步过了：': 'This step now passes: ',
    '还没活 —— 接下来是第二步，那一段才是要玩的。':
      'Not alive yet — next comes step 2, and that stretch is the game.',
    '推完还是 {n} 维 —— 再点一次试试。': 'Still {n}-dimensional after the push — click once more.',
    '提示也没辙：找不到能变好的一格。要么这是救不活的那三类（黑洞主导 / 无稳定轨道 / D≠3），要么得先往坏处推一格才能翻过去 —— 试试手动推一格再点。':
      'The hint is stuck too: no notch makes things better. Either this is one of the three unrescuable kinds (black-hole dominated / no stable orbits / D≠3), or you have to nudge one notch the wrong way first to get over the hump — try a manual notch, then click again.',
    '<b>D 这颗旋钮推不动</b>，其余 19 个推了也只是在给一具尸体调妆。':
      '<b>the D knob cannot be nudged</b>, and moving the other 19 is only doing a corpse’s makeup.',
    '<b>仪表没加载。</b><br>现在只能看结局标签 —— 而结局标签在推格的过程中大多是不动的，推一格屏幕上没反应属于正常，不是你推错了。':
      '<b>Gauges did not load.</b><br>Only the outcome label is left — and that label mostly does not move while you nudge, so a notch with no visible reaction is normal, not your mistake.',
    '<b>没有卡住的门。</b>剩下的是程度问题，看右边的仪表还差多少。':
      '<b>No gate is blocking.</b> What is left is a matter of degree — see how far the gauges on the right still have to go.',
    '<b>没有卡住的门了。</b>剩下的是程度问题（右边的仪表还没全部达标），继续推就是。':
      '<b>No gate is blocking any more.</b> What is left is a matter of degree (not every gauge on the right is there yet) — just keep nudging.',
    '<b>活了。</b>': '<b>It lives.</b>',
    '<b>爬不动了。</b>贪心找不到能变好的一格 —— 要么它是结构性死亡（黑洞主导 / 无稳定轨道 / D≠3 这三类救不活），要么得先往坏处推一格才能翻过去。':
      '<b>The climb has stalled.</b> The greedy search finds no notch that makes things better — either this is a structural death (the three unrescuable kinds: black hole dominated / unstable orbits / D≠3), or you have to nudge one notch the wrong way first to get over the hump.',
    '<b>这个宇宙已经能诞生观察者了。</b>可以就此收手，也可以继续推着玩 ——沙盒不收费，撤销随时可用。':
      '<b>This universe can already give rise to observers.</b> You can stop here, or keep nudging for fun — the sandbox is free and undo is always available.',
    'D≤2 的牛顿引力不再是吸引势，物质永远聚不成团；':
      'At D≤2 Newtonian gravity is no longer attractive and matter never clumps; ',
    'D≥4 时引力与库仑势按 r^−(D−1) 衰减，行星轨道和电子基态都没有稳定解；':
      'At D≥4 gravity and the Coulomb potential fall off as r^−(D−1), leaving no stable solution for planetary orbits or electron ground states; ',
    'Esc 也可以关': 'Esc closes it too',
    'Hoyle 共振偏移 ξ': 'Hoyle resonance offset ξ',
    '{n} 次模拟 / {m} ms，都在服务端跑）': '{n} simulations / {m} ms, all run on the server)',
    '　← 区块 #{n}': ' ← block #{n}',
    '。指针在动就说明你推对了方向。': '. If the needles move, you nudged in the right direction.',
    '下一格：': 'Next notch: ',
    '主程序还没就绪，稍等一下再点': 'The main program is not ready yet — wait a moment and click again',
    '仪表模块报错：': 'Gauge module error: ',
    '余量仪表盘': 'Margin gauges',
    '全参数模式：{n} 个创世参数全在这里': 'Full-parameter mode: all {n} creation parameters are here',
    '全部 {n} 个参数': 'All {n} parameters',
    '全部重置': 'Reset all',
    '其余 {n} 个参数也都还在（右上角关掉「新手模式」就能看到），只是这个宇宙的死因不在旋钮上，推它们翻不过维数这一关。':
      'The other {n} parameters are all still there (switch Novice mode off in the top right to see them); it is just that this universe did not die from a knob, and nudging them will not get past the dimension.',
    '刚弄坏：': 'Just broke: ',
    '刚打通：': 'Just opened: ',
    '卡在这几道门上（按因果顺序，先修第一条）：': 'Stuck on these gates (in causal order — fix the first one first):',
    '原始': 'Original',
    '参数': 'Parameters',
    '参数 · 点 − / + 推一格': 'Parameters · press − / + to nudge one notch',
    '另外 {n} 个参数和当前这道门没关系，先收起来了 ——右上角关掉「新手模式」就能看到全部 20 个。':
      'The other {n} parameters have nothing to do with the current gate and are folded away for now — switch Novice mode off in the top right to see all 20.',
    '只试了诊断指出的参数': 'tried only the parameters the diagnosis pointed at',
    '它管什么': 'What it controls',
    '已回到原始哈希态': 'Back to the original hash state',
    '已经在原始状态了，没有可撤销的': 'Already at the original state — nothing to undo',
    '已经活了，不用再推了': 'It is alive already — no need to nudge further',
    '已经顶到取值边界（{n}），这个方向没有余地了': 'Already at the edge of the range ({n}) — no room left in this direction',
    '干预后的 BNB 区块 {n}（推了 {m} 格）': 'Intervened BNB block {n} ({m} notches)',
    '干预后的 {n}（推了 {m} 格）': 'Intervened {n} ({m} notches)',
    '干预后的宇宙（推了 {n} 格）': 'Intervened universe ({n} notches)',
    '当前值': 'Current value',
    '往上推一格': 'Nudge up one notch',
    '往下推一格': 'Nudge down one notch',
    '恒星造得出多少碳和氧（越接近 1 越好）': 'how much carbon and oxygen stars can make (closer to 1 is better)',
    '把「{n}」调低一格': 'Nudge “{n}” down one notch',
    '把「{n}」调高一格': 'Nudge “{n}” up one notch',
    '换一个宇宙': 'Try another universe',
    '推了': 'Nudged',
    '提示也没辙：找不到能变好的一格。要么这是救不活的那三类（黑洞主导 / 无稳定轨道 / D≠3），要么得先往坏处推一格才能翻过去 —— 试试手动推一格再点。':
      'The hint is out of options: no notch makes it better. Either this is one of the three unrescuable kinds (black hole dominated / unstable orbits / D≠3), or you have to nudge one notch the wrong way first to get over the hump — try a manual nudge, then click again.',
    '提示模块报错：': 'Hint module error: ',
    '提示模块没给出内容': 'The hint module returned nothing',
    '提示模块没加载': 'The hint module is not loaded',
    '提示模块没加载，只能用全参数模式':
      'The hint module is not loaded — only full-parameter mode is available',
    '提示算不出来：': 'The hint could not be computed: ',
    '撤销一步': 'Undo one step',
    '新手模式': 'Novice mode',
    '新手模式还开着 —— 只是<b>现在没有卡住的门可以筛了</b>，没什么该收起来的，所以 20 个参数全在这里。':
      'Novice mode is still on — there is simply <b>no blocking gate left to filter by</b>, nothing worth folding away, so all 20 parameters are here.',
    '新手模式：只显示诊断指出的参数（以及你已经推动过的）':
      'Novice mode: only the parameters the diagnosis points at (plus the ones you have already nudged)',
    '新手模式：只显示诊断指出的那几个参数': 'Novice mode: show only the few parameters the diagnosis points at',
    '暗能量抢跑的程度（小于 1 才来得及长出星系）':
      'how far ahead dark energy is (below 1 there is still time to grow galaxies)',
    '服务端客户端没加载，这一格算不了':
      'The server client is not loaded — this notch cannot be computed',
    '服务端算不出这一格：': 'The server could not compute this notch: ',
    '核合成、恒星、化学的公式全都只在三维成立。':
      'The formulas for nucleosynthesis, stars and chemistry all hold in three dimensions only. ',
    '格': 'notches',
    '正在算…': 'Computing…',
    '沙盒：随便推、不花钱、不上链；关掉之后原宇宙不受影响':
      'Sandbox: nudge freely, no cost, nothing on chain; closing it leaves the original universe untouched',
    '没有这个参数：': 'No such parameter: ',
    '照提示推一格': 'Nudge as hinted',
    '照这个推': 'Nudge this one',
    '现在卡在：': 'Stuck on: ',
    '现在只显示诊断指出的参数；点一下看全部 {n} 个':
      'Showing only the parameters the diagnosis points at; click to see all {n}',
    '现在显示全部 {n} 个参数；点一下回到新手模式': 'Showing all {n} parameters; click to go back to Novice mode',
    '用这组参数引爆': 'Detonate with these parameters',
    '看不懂符号就看这行：': 'Lost in the symbols? Read this line: ',
    '看看现在卡在哪、下一格该推谁': 'See where it is stuck and which knob to nudge next',
    '看详细提示': 'Detailed hint',
    '真烧要': 'a real burn would cost',
    '碳/氧产率 f_C、f_O': 'Carbon / oxygen yield f_C, f_O',
    '碳的合成窗口偏了多少（越接近 0 越好）': 'how far the carbon synthesis window has shifted (closer to 0 is better)',
    '窄搜没结果，退回全参数搜了一遍': 'narrow search came up empty, fell back to searching every parameter',
    '符号': 'Symbol',
    '结构涨落余量': 'Structure-formation margin',
    '而空间维数按 0.1 一档取整，一格连一档都够不着 —— ':
      'and the spatial dimension is quantized in steps of 0.1, so one notch cannot even reach the next step — ',
    '要动的就是这几个': 'These are the ones to move',
    '让程序算出下一格该推谁，并直接替你推这一格':
      'Let the program work out which knob comes next, and nudge that notch for you',
    '该推的是：': 'Nudge: ',
    '该推：': 'Nudge: ',
    '还差这 {n} 道门：': 'Still {n} gates to go:',
    '还没有读数': 'No readings yet',
    '这一格小到被取整吃掉了（整数参数）': 'This notch was small enough to be swallowed by rounding (integer parameter)',
    '这一格推不动 —— 换个参数试试': 'This notch will not move — try another parameter',
    '这一格没能让它动起来 —— 换个参数试试': 'This notch did not move it — try another parameter',
    '这一格过了：': 'this notch passed: ',
    '这个宇宙救不活 —— 它的空间是 {n} 维，不是 3 维。':
      'This universe cannot be rescued — its space is {n}-dimensional, not 3.',
    '这个宇宙救不活 —— 它连稳定的轨道都没有。': 'This universe cannot be rescued — it does not even have stable orbits.',
    '这个宇宙是结构性死亡，推参数救不回来 —— 关掉沙盒，去引爆下一个':
      'This universe is structurally dead; nudging parameters will not bring it back — close the sandbox and go detonate the next one',
    '这个宇宙没有区块哈希，服务端没法定位它': 'This universe has no block hash, so the server cannot locate it',
    '这个宇宙现在能诞生观察者：共 {n} 格，真烧要 {m} BANG（沙盒不收费）。':
      'This universe can give rise to observers now: {n} notches in all, a real burn would cost {m} BANG (the sandbox is free).',
    '这是维数判据直接给出的结论：引力与库仑势的形状不对，行星绕不成圈、电子也落不进壳层。这不是差几格余量，是几何本身的问题。':
      'This comes straight out of the dimension criteria: the gravitational and Coulomb potentials have the wrong shape, so planets cannot hold an orbit and electrons cannot settle into shells. This is not a few notches of margin — it is the geometry itself.',
    '门': 'Gates',
    '（一格有多远由服务端算）': '(how far one notch goes is computed on the server)',
    '（全参数搜了一遍，': '(searched every parameter, ',
    '（分数 +{n}）': ' (score +{n})',
    '（只试了相关参数，': '(tried only the related parameters, ',
    '（可以随便推，但这个宇宙的死因不在这些旋钮上）': '(nudge all you like, but this universe did not die from these knobs)',
    '（没有哈希）': '(no hash)',
    '（点 − / + 推一格；一格 = 该参数还能活多远的一小截，由服务端算）':
      '(press − / + to nudge one notch; one notch = a small slice of how far that parameter can still stay alive, computed on the server)',
    '（结局标签不动的时候，动的是这些）': '(when the outcome label stays put, these are what move)',
    '（费用由服务端算，沙盒不收费）': '(the fee is computed on the server; the sandbox charges nothing)',
    '（还有 {n} 道门没过，按因果顺序先修这条）': '({n} more gates still fail; in causal order, fix this one first)',
    '：{n} 次模拟（服务端跑的）/ 往返 {m} ms': ': {n} simulations (run on the server) / {m} ms round trip',
    '、': ', ',
    /* 半句与半句之间的那个逗号。英文态里漏出一个全角「，」就露馅了 —— 与上面同理 */
    '，': ', ',
    '；': '; ',
    '{n}（{m}）': '{n} ({m})',
    '<b>拯救的销毁通路只开在救得活的死宇宙上</b> —— 烧 BANG 把参数推回可能诞生观察者的那一侧，烧掉的量永久记在链上（burnedOn）。天生就活着的宇宙没有这条路，这一枚也没有：换一个救得活的去烧。':
      '<b>The rescue burn path only opens on dead universes that can still be saved</b> — burn BANG to push the parameters back toward the side where observers can arise, and the amount burned is recorded on chain forever (burnedOn). A universe born alive has no such path, and neither does this one: find a saveable universe and burn for that.',

    /* ---- 余量仪表盘的 26 道门（web/gauges.js 的 GATES） ---- */
    '轨道能稳定': 'Orbits can be stable',
    '只有三维空间里的平方反比引力才有稳定的圆轨道；维数一变，行星要么掉进恒星，要么直接飞走。':
      'Only inverse-square gravity in three dimensions gives stable circular orbits; change the dimension and planets either fall into the star or fly straight off.',
    '引力能束缚': 'Gravity can bind',
    '维数不对时引力势没有束缚态，气体云永远凝不成恒星和行星。':
      'With the wrong dimension the gravitational potential has no bound states, and gas clouds never condense into stars and planets.',
    '维数是整数': 'The dimension is an integer',
    '分数维空间里连"绕一圈回到原地"都不成立，整套物理模型在这里失效。':
      'In a fractional-dimensional space not even “go around once and come back” holds, and the whole physical model breaks down here.',
    'CP 对称有破缺': 'CP symmetry is violated',
    '没有 CP 破坏，正反物质就等量湮灭，宇宙里只剩一片光子，没有任何实物。':
      'Without CP violation matter and antimatter annihilate in equal amounts, leaving a universe of photons and nothing solid at all.',
    '剩下了重子': 'Baryons are left over',
    '重子不对称度归零，就没有质子和中子可用，后面的一切都无从谈起。':
      'With zero baryon asymmetry there are no protons or neutrons to work with, and nothing that comes after is even possible.',
    '复合发生过': 'Recombination happened',
    '电子和质子必须能结合成中性氢，光才跑得出来、物质才开始塌缩。':
      'Electrons and protons must combine into neutral hydrogen before light can get out and matter can start to collapse.',
    '氘核能成键': 'The deuteron binds',
    '氘是所有核合成的第一级台阶，它一散架，恒星就点不着火。':
      'Deuterium is the first rung of all nucleosynthesis; once it falls apart, stars never ignite.',
    '双质子不成键': 'The diproton does not bind',
    '如果双质子能结合，氢会在大爆炸的几分钟里烧光，恒星再没有燃料。':
      'If the diproton could bind, hydrogen would burn away within minutes of the Big Bang and stars would have no fuel left.',
    '氘不会 β 衰变': 'Deuterium does not beta-decay',
    '氘要是会自发衰变，刚合成就没了，核合成链断在第一步。':
      'If deuterium decayed on its own it would be gone as soon as it formed, and the nucleosynthesis chain would break at the first step.',
    '结构长起来了': 'Structure grew',
    '密度涨落必须能塌缩成星系，否则宇宙永远是一锅越来越稀的均匀气体。':
      'Density fluctuations have to collapse into galaxies, or the universe stays a uniform gas that only gets thinner.',
    '暗能量没提前接管': 'Dark energy did not take over early',
    'Λ 太大的话，星系还没来得及塌缩就被膨胀撕散了。':
      'If Λ is too large, galaxies are pulled apart by expansion before they ever collapse.',
    '恒星能点火': 'Stars can ignite',
    '气体云中心得热到能引发核聚变，否则满天都是不发光的褐矮星。':
      'The core of a gas cloud has to get hot enough for fusion, otherwise the sky is nothing but brown dwarfs that never shine.',
    '能锻造重元素': 'Heavy elements can be forged',
    '只有氢和氦的宇宙做不出岩石行星，也做不出任何生物分子。':
      'A universe of nothing but hydrogen and helium makes no rocky planets and no biological molecules.',
    '碳能被合成': 'Carbon can be synthesized',
    '碳是生化骨架，三氦过程一旦失灵，有机化学就没有原料。':
      'Carbon is the backbone of biochemistry; once the triple-alpha process fails, organic chemistry has no raw material.',
    '超新星能把元素扔出来': 'Supernovae can throw the elements out',
    '重元素若锁死在恒星尸体里，行星和生命一克也拿不到。':
      'If heavy elements stay locked inside stellar corpses, planets and life never get a single gram of them.',
    '恒星模型仍适用': 'The stellar model still applies',
    '参数跑出了 Adams 恒星判据的适用范围，这里给的结论已经不可信。':
      'The parameters have run outside the range where the Adams stellar criteria hold, so the conclusion given here is no longer trustworthy.',
    '氢是稳定的': 'Hydrogen is stable',
    '最简单的原子都留不住的话，宇宙里不会有任何化学。':
      'If the simplest atom of all cannot survive, there is no chemistry anywhere in this universe.',
    '原子能存在': 'Atoms can exist',
    '电子必须能被原子核束缚住，否则物质永远停在等离子体状态。':
      'Electrons have to stay bound to nuclei, otherwise matter never leaves the plasma state.',
    '分子能成键': 'Molecules can bond',
    '原子之间要能共享电子并保持刚性，否则没有任何化合物。':
      'Atoms have to share electrons and hold a rigid shape, otherwise there are no compounds at all.',
    '化学足够丰富': 'Chemistry is rich enough',
    '能用的元素种类太少，搭出来的分子撑不起生命这么复杂的东西。':
      'Too few usable elements: the molecules you can build cannot carry anything as complex as life.',
    '时间够用': 'There is enough time',
    '行星要赶在恒星死掉之前形成，还得留出足够长的演化余裕。':
      'Planets have to form before their star dies, with enough room left over to evolve.',
    '涨落幅度合适': 'The fluctuation amplitude is right',
    'Q 太小结构太松散，太大则处处是黑洞，两头都长不出行星系。':
      'Too small a Q and structure is too loose; too large and black holes are everywhere. Neither end grows planetary systems.',
    '行星能形成': 'Planets can form',
    '要有固体尘埃可用、引力又能把它们黏起来，行星才凝得出来。':
      'Planets only condense when there is solid dust to work with and gravity can stick it together.',
    'Hoyle 共振对得上': 'The Hoyle resonance lines up',
    '碳-12 那条 7.65 MeV 共振偏一点，碳氧比就崩，生化拿不到原料。':
      'Shift the 7.65 MeV resonance of carbon-12 a little and the carbon-to-oxygen ratio collapses, leaving biochemistry without raw material.',
    '液态水窗口存在': 'A liquid-water window exists',
    '恒星周围得有一圈距离，让水既不结冰也不沸腾。':
      'There has to be a band of distance around the star where water neither freezes nor boils.',
    '复杂化学可行': 'Complex chemistry is possible',
    '碳氮氧磷硫硅要同时到场，才搭得出蛋白质、核酸这一类大分子。':
      'Carbon, nitrogen, oxygen, phosphorus, sulfur and silicon all have to show up before you can build macromolecules such as proteins and nucleic acids.',

    /* ---- 8 个连续仪表（web/gauges.js 的 METERS） ---- */
    'Hoyle 共振偏移': 'Hoyle resonance offset',
    '碳-12 的 7.65 MeV 共振偏了多远。越接近 0，三氦过程的碳氧产率越正常。':
      'How far the 7.65 MeV resonance of carbon-12 has shifted. The closer to 0, the more normal the carbon and oxygen yields of the triple-alpha process.',
    '碳产率': 'Carbon yield',
    '三氦过程产碳的相对产率，低于 0.05 就没有有机化学的原料。':
      'Relative carbon yield of the triple-alpha process; below 0.05 there is no raw material for organic chemistry.',
    '氧产率': 'Oxygen yield',
    '产氧的相对产率，低于 0.05 就既没有水也没有氧化还原化学。':
      'Relative oxygen yield; below 0.05 there is neither water nor redox chemistry.',
    '液态水窗口': 'Liquid-water window',
    '行星表面能维持液态水的轨道半径，越接近 1 AU 越像我们这里。':
      'The orbital radius at which a planet surface can hold liquid water; the closer to 1 AU, the more it looks like home.',
    '真空能与 Weinberg 上界之比。超过 1，星系在塌缩完成前就被膨胀撕散。':
      'Vacuum energy over the Weinberg bound. Above 1, galaxies are torn apart by expansion before they finish collapsing.',
    '恒星寿命': 'Stellar lifetime',
    '一颗太阳质量恒星的主序寿命。太短，行星上来不及演化出复杂化学。':
      'Main-sequence lifetime of a solar-mass star. Too short, and planets have no time to evolve complex chemistry.',
    '宇宙年龄': 'Age of the universe',
    '从大爆炸到现在走了多久。会大挤压或大撕裂的宇宙在这里就提前收场了。':
      'How long it has been since the Big Bang. Universes headed for a Big Crunch or a Big Rip end early right here.',
    '可观测时长': 'Observable span',
    '这个宇宙留给观察者的时间窗口有多长。': 'How long a time window this universe leaves for observers.',

    /* ---- 诊断用的 26 道门：卡在哪、该动谁（web/hint.js 的 GATES） ---- */
    '稳定轨道': 'Stable orbits',
    'D≥4 时引力与库仑势按 r^−(D−1) 变化，行星轨道和电子基态都不再稳定——空间维数得推回 3。':
      'At D≥4 gravity and the Coulomb potential go as r^−(D−1), and neither planetary orbits nor electron ground states stay stable — the spatial dimension has to go back to 3.',
    '引力能聚物': 'Gravity gathers matter',
    'D≤2 的牛顿引力不再是吸引势，物质永远聚不成团。':
      'At D≤2 Newtonian gravity is no longer an attractive potential, and matter never clumps.',
    '分数维没有严格的物理定义，引擎只能按 D 连续插值外推；把 D 推到整数 3.0。':
      'Fractional dimensions have no rigorous physical definition; the engine can only interpolate continuously in D. Push D to exactly 3.0.',
    'CP 破坏': 'CP violation',
    'Sakharov 条件之一：δ_CKM 太接近 0 或代数少于 3，物质与反物质完全对消，什么都不剩。':
      'One of the Sakharov conditions: if δ_CKM is too close to 0, or there are fewer than 3 generations, matter and antimatter cancel exactly and nothing is left.',
    '有重子': 'Baryons exist',
    '没有 CP 破坏，或重子密度本身为 0：没有物质，后面每一步都无从谈起。':
      'No CP violation, or a baryon density of 0 in the first place: with no matter, every step after this is moot.',
    '复合能发生': 'Recombination can happen',
    'Saha 方程解不出复合红移：电子始终不被原子核抓住，宇宙对光不透明，也没有中性气体去造恒星。':
      'The Saha equation yields no recombination redshift: electrons are never captured by nuclei, the universe stays opaque to light, and there is no neutral gas to build stars from.',
    '氘核束缚': 'The deuteron is bound',
    '氘核不束缚，大爆炸核合成卡在氘瓶颈，恒星连第一步燃料都没有。':
      'With an unbound deuteron, Big Bang nucleosynthesis jams at the deuterium bottleneck and stars never get their first fuel.',
    '双质子一旦能结合，氢会在大爆炸的几分钟里烧光——恒星没有燃料，也没有水。':
      'Once the diproton can bind, hydrogen burns away within minutes of the Big Bang — no fuel for stars, and no water either.',
    '氘核内中子不衰变': 'The neutron inside the deuteron does not decay',
    'm_n−m_p 太大（Δ > B_d + mₑ），氘核里的中子直接 β 衰变掉；把上下夸克的质量差收窄。':
      'm_n−m_p is too large (Δ > B_d + mₑ) and the neutron inside the deuteron simply beta-decays; narrow the up–down quark mass difference.',
    '星系形成': 'Galaxies form',
    '涨落在增长被冻结前没能非线性化：原初涨落太小、暗物质太少，或者膨胀把一切拉平了。':
      'Fluctuations never went non-linear before growth froze out: primordial fluctuations too small, too little dark matter, or expansion flattened everything.',
    '涨落跑赢暗能量': 'Fluctuations outrun dark energy',
    '暗能量超过 Weinberg 上界 ρ_Λ ≲ ρ_m(a_col)：星系还没坍缩，宇宙已经被拉散。':
      'Dark energy exceeds the Weinberg bound ρ_Λ ≲ ρ_m(a_col): the universe is pulled apart before galaxies collapse.',
    '恒星能点燃': 'Stars can ignite',
    '点火下限质量顶到了辐射压上限（或氘核不束缚、α 过大）：没有一颗恒星能稳定燃烧。':
      'The lower ignition mass has run into the radiation-pressure ceiling (or the deuteron is unbound, or α is too large): not one star can burn steadily.',
    '能炼到铁': 'Can forge up to iron',
    '核库仑极限 Z_max ∝ 1/α 卡在铁以下：恒星炼不出重元素，没有金属也没有岩石行星。':
      'The nuclear Coulomb limit Z_max ∝ 1/α stops below iron: stars forge no heavy elements, so there are no metals and no rocky planets.',
    '碳核稳定': 'The carbon nucleus is stable',
    'Z_max < 6：碳核被库仑排斥撑散，碳基化学从根上不成立——α 要调小。':
      'Z_max < 6: Coulomb repulsion blows the carbon nucleus apart and carbon-based chemistry fails at the root — α has to come down.',
    '超新星能爆': 'Supernovae can explode',
    'G_F ∝ v⁻²：希格斯真空期望值太大时中微子逃得太快，超新星哑火，重元素锁死在恒星尸体里。':
      'G_F ∝ v⁻²: when the Higgs vacuum expectation value is too large, neutrinos escape too fast, supernovae fizzle, and heavy elements stay locked inside stellar corpses.',
    '恒星标度可信': 'The stellar scaling is trustworthy',
    '点火质量已越出 Adams 2008 牛顿标度的适用范围（≳300 M⊙），这类天体更可能直接坍缩成黑洞。':
      'The ignition mass has left the range where the Adams 2008 Newtonian scaling applies (≳300 M⊙); objects like that are more likely to collapse straight into black holes.',
    '有氢': 'Hydrogen exists',
    '质子衰变、氢被电子俘获，或双质子束缚把氢烧光了：没有氢就没有水，也没有恒星燃料。':
      'Protons decay, hydrogen captures electrons, or a bound diproton burns the hydrogen away: no hydrogen means no water and no stellar fuel.',
    '原子稳定': 'Atoms are stable',
    'Zα 逼近 1：内层电子相对论性坠落、真空自发产生正负电子对，多电子原子撑不住。':
      'Zα approaches 1: inner electrons fall in relativistically and the vacuum spontaneously creates electron–positron pairs, so multi-electron atoms cannot hold together.',
    '分子有形状': 'Molecules have a shape',
    'Born–Oppenheimer 参数 (mₑ/mₚ)^{1/4} ≥ 0.45：电子与核质量可比，分子没有固定几何。':
      'Born–Oppenheimer parameter (mₑ/mₚ)^{1/4} ≥ 0.45: electron and nuclear masses are comparable, so molecules have no fixed geometry.',
    '化学能复杂化': 'Chemistry can grow complex',
    '缺氢、缺碳或分子不刚性——元素表撑不到能拼出有机分子的地步。':
      'No hydrogen, no carbon, or floppy molecules — the periodic table never reaches the point where organic molecules can be put together.',
    '恒星主序寿命不足 5 亿年，或从星系形成到宇宙终结的窗口不到 10 亿年：来不及演化出任何东西。':
      'The stellar main-sequence lifetime is under 500 million years, or the window from galaxy formation to the end of the universe is under a billion years: nothing has time to evolve.',
    '涨落幅度在窗口内': 'The fluctuation amplitude is inside the window',
    'Q_eff 越出 10⁻⁶–10⁻⁴：太大则星系过密、恒星近距交会踢飞行星；太小则气体冷却不下来。':
      'Q_eff falls outside 10⁻⁶–10⁻⁴: too large and galaxies are so dense that close stellar encounters kick planets away; too small and the gas never cools.',
    '岩石行星能形成': 'Rocky planets can form',
    '缺重元素、超新星哑火或化学不成立，尘埃与岩石无从谈起。':
      'With no heavy elements, fizzled supernovae or no working chemistry, there is no dust and no rock to speak of.',
    'Hoyle 共振在容许区间': 'The Hoyle resonance is within tolerance',
    '三氦过程对核力 ±0.5%、电磁 ±4% 极敏感（Oberhummer 2000）：ξ 离 0 太远，碳或氧的产率掉两个数量级。':
      'The triple-alpha process is extremely sensitive to the nuclear force (±0.5%) and to electromagnetism (±4%) (Oberhummer 2000): once ξ strays far from 0, the carbon or oxygen yield drops by two orders of magnitude.',
    '有液态水窗口': 'There is a liquid-water window',
    '液态水轨道 d_w = √L·(α²mₑ)⁻²：没有氧、分子不刚性或恒星不亮，溶剂窗口就是关的。':
      'Liquid-water orbit d_w = √L·(α²mₑ)⁻²: with no oxygen, floppy molecules or a dim star, the solvent window is shut.',
    '周期表在 Z<16 截止（没有硅、磷、硫），或 α≥0.1 让化学能标与相对论修正失控。':
      'The periodic table stops below Z=16 (no silicon, phosphorus or sulfur), or α≥0.1 sends the chemical energy scale and the relativistic corrections out of control.',

    /* ---- 门全过之后仍然死的那几种结局（web/hint.js 的 OUTCOME_FIX） ---- */
    '空间维数不是 3': 'The spatial dimension is not 3',
    'D≥4 没有稳定轨道，D≤2 引力不吸引；先把维数推回 3。':
      'At D≥4 there are no stable orbits and at D≤2 gravity does not attract; push the dimension back to 3 first.',
    '超出模型范围（D≠3）': 'Beyond the model range (D≠3)',
    '核合成/恒星/化学的公式只对 3 维成立；把 D 推回 3.0，其余判据才有意义。':
      'The formulas for nucleosynthesis, stars and chemistry hold in 3 dimensions only; push D back to 3.0 before any other criterion means anything.',
    '大挤压': 'Big Crunch',
    '闭合几何在恒星时代结束前就转向坍缩：调曲率或加大暗能量/降低物质密度，把寿命拉长。':
      'Closed geometry turns to collapse before the stellar era ends: adjust the curvature, or raise dark energy and lower the matter density, to stretch the lifetime.',
    '暗能量把一切拉散得太快，结构留不住。': 'Dark energy pulls everything apart too fast for structure to survive.',
    '原初涨落太大：视界尺度的团块在冷却成恒星前直接落入视界——调小 A_s 或压低谱指数。':
      'Primordial fluctuations are too large: horizon-scale lumps fall inside the horizon before they can cool into stars — lower A_s or flatten the spectral index.',
    '热寂 · 无结构': 'Heat death · no structure',
    '涨落在冻结前没能非线性化，或暗能量越过 Weinberg 上界。':
      'Fluctuations never went non-linear before freeze-out, or dark energy crossed the Weinberg bound.',
    '没有重子、质子衰变，或 Zα→1 电子壳层不稳定。':
      'No baryons, decaying protons, or Zα→1 leaving the electron shells unstable.',
    '恒星质量窗口关闭或氘核不束缚：点火这一步过不去。':
      'The stellar mass window is shut or the deuteron is unbound: ignition never happens.',
    '无化学': 'No chemistry',
    '缺氢、缺碳，或分子没有刚性。': 'No hydrogen, no carbon, or molecules with no rigidity.',
    '无碳-水型化学': 'No carbon–water chemistry',
    '三氦过程产不出足够的碳/氧，或没有液态水窗口、复杂化学受限。':
      'The triple-alpha process yields too little carbon and oxygen, or there is no liquid-water window and complex chemistry is limited.',
    '有恒星无生命': 'Stars but no life',
    '每道门都过了，但可居住性 <0.4：多半是恒星寿命太短、宜居窗口太窄或涨落幅度偏离窗口。':
      'Every gate passed, but habitability is <0.4: most likely the stellar lifetime is too short, the habitable window too narrow, or the fluctuation amplitude off-window.',

    /* ---- 铸成造物（web/intervene.js 的 craft 流程，specs/crafted-v1.md §五） ----
       两条产品线两个故事，措辞别混：原生拯救 100% 全烧（rescue），
       造物铸造 20% 销毁 / 80% 进国库（Crafted mint）。
       通用句（'正在向服务端要签名…'、'正在连接钱包…'、'已发出，等待上链…'、
       '你在钱包里取消了'）在 web/i18n.js 的全局词典里，这里不重复收。 */
    '铸成造物': 'Mint as Crafted',
    /* 造物的费用行。措辞用「费用」不用「烧」：全烧是拯救（rescue）的话术，
       造物只烧 20%，写「真烧要」是在骗人（2026-08-21 用户指出，已拍板）。
       2026-08-21 再改：拯救那条出口接通之后，两颗按钮并排站着 ——
       这一句必须先说清「铸的是新的一枚、原来那枚不动」，否则两条路照旧分不开。
       2026-08-21 三改（specs/rescue-mint-unified.md）：结尾原来是「你原来那枚不受影响」，
       而「铸下并拯救」上线后主路也对**一枚都没有**的人开着 —— 那种用户没有"原来那枚"。
       改成说两条产品线互不相干。旧 key 已经没有调用点，一并删掉，免得留一条死词条。 */
    '铸一枚<b>新的</b> NFT（造物系列）：费用 <b>{n} BANG</b>，20% 销毁 / 80% 进国库，与原生系列互不相干':
      'Mints a <b>new</b> NFT (Crafted series): fee <b>{n} BANG</b>, 20% burned / 80% to the treasury — entirely separate from the native series',
    /* 这个 key 界面上还在用（第一步的维度报价 —— 那条是 rescue，全烧，说「烧」没错），
       原先词典里只有拆开的 '真烧要' —— 整句版一直退回中文，这里补上 */
    '真烧要 <b>{n} BANG</b>': 'A real burn would cost <b>{n} BANG</b>',
    '把调教出来的这个宇宙铸成造物 NFT：先授权 BANG 再铸造，一次点击、两次钱包确认':
      'Mint this tuned universe as a Crafted NFT: approve BANG first, then mint — one click, two wallet confirmations',
    '没有检测到钱包扩展（MetaMask / 币安钱包 等），铸不了造物':
      'No wallet extension detected (MetaMask, Binance Wallet, …) — cannot mint a Crafted',
    'BANG 代币地址没配，付不了铸造费':
      'The BANG token address is not configured — the mint fee cannot be paid',
    '正在铸，等这一笔走完': 'Minting — wait for this one to finish',
    '上一格还在服务端算，等它回来再铸': 'The last notch is still being computed on the server — wait for it before minting',
    '链访问层没加载，铸不了造物':
      'Chain access layer not loaded — cannot mint a Crafted',
    '服务端的应答缺字段，铸不了': 'The server response is missing fields — cannot mint',
    '服务端签的造物合约和站点配的不是同一个，先把两边对齐':
      'The server signed for a different Crafted contract than the one this site is using — align the two first',
    '钱包没有给出账户': 'The wallet returned no account',
    '授权 BANG：在钱包里确认…': 'Approving BANG: confirm in the wallet…',
    '授权已发出，等上链…': 'Approval sent — waiting for confirmation…',
    '授权交易被链上回滚了，这一单没扣钱': 'The approval transaction was reverted on-chain — nothing was charged',
    '铸造造物：在钱包里确认…': 'Minting the Crafted: confirm in the wallet…',
    '铸造交易被链上回滚了 —— 多半是签名过期或这张卡已经铸过，重新点一次再试':
      'The mint transaction was reverted on-chain — most likely the signature expired or this card was already minted; click once more to retry',
    '铸成了 —— 这个宇宙现在是一枚造物 NFT。': 'Minted — this universe is now a Crafted NFT.',
    '看这张卡的图': 'View the card art',
    '造物没铸成：': 'The Crafted was not minted: ',

    /* ---- 发交易前的预检（2026-08-21 加，动机见 web/intervene.js 的预检注释）：
       预估必回滚时钱包会瞎填 gas 去撞节点上限，报出来的是「gas limit too high」
       而不是病因 —— 所以回滚原因在发交易之前就得用人话说出来。 */
    '发交易前先查链上状态…': 'Checking on-chain state before sending anything…',
    '造物合约的签名闸还没开（signer() 是零地址，要 owner 去 setSigner）—— 现在铸必败，一分 gas 都别花':
      'The Crafted contract’s signing gate is not open yet (signer() is the zero address — the owner must call setSigner). Minting now is guaranteed to fail; don’t spend a single bit of gas',
    'BANG 不够：钱包里有 {n} BANG，这一铸的费用是 {m} BANG':
      'Not enough BANG: the wallet holds {n} BANG, and this mint’s fee is {m} BANG',
    '授权的 gas 预估失败（这笔上链必回滚，没让钱包发）：':
      'Gas estimation for the approval failed (it would revert on-chain; the wallet was never asked to send it): ',
    '铸造前先在链上模拟这一笔…': 'Simulating this transaction on-chain before minting…',
    '模拟铸造被链上回滚（真发也必败，一分 gas 没花）：':
      'The simulated mint reverted on-chain (a real one would fail the same way; no gas was spent): ',
    '铸造的 gas 预估失败（这笔没发出去）：':
      'Gas estimation for the mint failed (nothing was sent): ',
    '链上给出的理由：{n}': 'The chain gave this reason: {n}',
    '链上回滚，错误数据认不出（{n}）': 'Reverted on-chain with unrecognized error data ({n})',
    /* 模拟回滚的选择器翻译（contracts/src/MirrorCrafted.sol 的 error 定义 + Solidity 内置 Panic） */
    '签名验不过（BadSig）：服务端签名和合约的 signer 对不上，或签名闸中途被关了':
      'Signature check failed (BadSig): the server’s signature does not match the contract’s signer, or the signing gate was closed midway',
    '签名过期了（Expired）—— 重新点一次，拿份新签名再铸':
      'The signature expired (Expired) — click once more to fetch a fresh one and mint again',
    '这张参数卡已经铸过了（AlreadyCrafted）—— 同一张卡只能铸一次':
      'This parameter card is already minted (AlreadyCrafted) — each card can be minted only once',
    '起源哈希或干预史哈希是零（BadHash），服务端应答有问题':
      'The origin hash or the ops hash is zero (BadHash) — something is wrong with the server response',
    '结局序号不合法（BadOutcome）': 'Invalid outcome index (BadOutcome)',
    '稀有度序号不合法（BadRarity）': 'Invalid rarity index (BadRarity)',
    '合约参数配置违反不变量（BadConfig）': 'The contract configuration violates an invariant (BadConfig)',
    '查不到这个编号的造物（NoToken）': 'No Crafted exists with this id (NoToken)',
    '合约挡下了一次重入（Reentrant），稍后再试':
      'The contract blocked a reentrant call (Reentrant) — try again shortly',
    '这个操作只有合约 owner 能做（NotOwner）': 'Only the contract owner can do this (NotOwner)',
    'Solidity 内置检查失败（Panic）：多半是算术溢出或数组越界':
      'A built-in Solidity check failed (Panic): most likely arithmetic overflow or an out-of-bounds access',

    /* ---- 拯救这枚 NFT（web/intervene.js 的 rescue 流程，MirrorUniverse.intervene）----
       与造物是**两个故事**，措辞一个字都不能混：
         拯救 rescue —— 改写你已有的那枚原生 NFT，费用 100% 销毁，记进 burnedOn
         造物 craft  —— 铸一枚新的第二套 NFT，20% 销毁 / 80% 进国库
       通用句（'正在向服务端要签名…'、'正在连接钱包…'、'已发出，等待上链…'、
       '你在钱包里取消了'、'钱包没有给出账户'、授权那三句、'发交易前先查链上状态…'、
       '看这张卡的图'）已经在别处收过，这里不重复。 */
    '拯救这枚 NFT': 'Rescue this NFT',
    /* ---- 铸下并拯救（specs/rescue-mint-unified.md）----
       沙盒出口现在是「一条主路 + 一条备选」。主按钮的文字随「你和这个宇宙的关系」切：
       已铸且是你的 → 上面那句；**没铸过 → 下面这句**。
       英文用 Mint & Rescue（不是 Mint and Rescue）：它是一颗按钮上的名字，
       连字号版本短、也更像一个动作 —— 用户拍板的原话就是「实际上就是一个操作」。 */
    '铸下并拯救': 'Mint & Rescue',
    '没有检测到钱包扩展（MetaMask / 币安钱包 等），铸不了也拯救不了':
      'No wallet extension detected (MetaMask, Binance Wallet, …) — cannot mint or rescue',
    '一次点击串起两件事：先把这个宇宙铸成你的原生 NFT，再烧 BANG 把它改写成沙盒里这个样子。钱包会依次弹三次（铸造、授权、拯救），界面上会写现在是第几步':
      'One click chains two things: first mint this universe as your native NFT, then burn BANG to rewrite it into what the sandbox shows. The wallet will pop up three times in a row (mint, approve, rescue) and the panel says which step you are on',
    /* 「铸下并拯救」那一格的说明。原来这里只有一句「你可以先铸下它」而**按钮根本不出现** ——
       推活了却拿不走，是条断头路。现在它是主路，两段代价要一次说清。 */
    '先把这个宇宙铸成你的 NFT（免费额度内只花 gas），':
      'First mints this universe as your NFT (gas only while you have free mints left), ',
    '再烧 <b>{n} BANG</b> 把它改写成现在这个样子':
      'then burns <b>{n} BANG</b> to rewrite it into what you see now',
    '拯救的费用 <b>100% 销毁</b>，永久记进这枚 NFT 的 burnedOn':
      'the rescue fee is <b>100% burned</b> and recorded permanently in that NFT’s burnedOn',
    /* 进度指示。EVM 改不了「三件事三笔交易」，钱包会依次弹三次 ——
       不写清楚现在是第几步，连弹三次就是"出错了"的样子（规格里点名的硬要求）。 */
    '第 {n}/{m} 步': 'Step {n}/{m}',
    '授权额度已经够了，这一步不用确认': 'The allowance is already enough — no confirmation needed for this step',
    /* 「铸下并拯救」第 1/3 步（铸造）自己的那几句。与造物那条路的措辞刻意不同：
       这里铸的是**原生**系列，付的是 BNB（免费期只花 gas），不是 BANG。 */
    '正在向服务端要铸造签名…': 'Requesting the mint signature from the server…',
    '服务端的铸造签名缺字段，铸不了': 'The server’s mint signature is missing fields — cannot mint',
    '服务端签的是另一个区块哈希，和沙盒里这个宇宙对不上':
      'The server signed a different block hash — it does not match the universe in this sandbox',
    '宇宙合约的签名闸还没开（signer() 是零地址，要 owner 去 setSigner）—— 现在铸造必败，一分 gas 都别花':
      'The universe contract’s signing gate is not open yet (signer() is the zero address — the owner must call setSigner). Minting now is guaranteed to fail; don’t spend a single bit of gas',
    '铸造前先在链上模拟这一笔（免费期，只花 gas）…':
      'Simulating this transaction on-chain before minting (free period — gas only)…',
    '铸造前先在链上模拟这一笔…': 'Simulating this transaction on-chain before minting…',
    '铸造这个宇宙：在钱包里确认（免费期，只花 gas）…':
      'Minting this universe: confirm in the wallet (free period — gas only)…',
    '铸造这个宇宙：在钱包里确认（{n}）…': 'Minting this universe: confirm in the wallet ({n})…',
    '铸造已发出，等上链…': 'Mint sent — waiting for confirmation…',
    '铸造交易被链上回滚了 —— 常见原因：这个哈希已经被别人引爆过、签名过期、或付款金额和合约要的对不上':
      'The mint transaction was reverted on-chain. Common causes: this hash has already been detonated by someone else, the signature expired, or the amount paid does not match what the contract wants',
    /* tokenId **只能**从回执的 Minted 事件里解。猜（totalSupply）的代价是：并发下猜到
       别人的 NFT，然后后面两笔照着那个号去改别人的卡。所以解不出来就停下报错。 */
    '铸造成功了，但回执里没有 Minted 事件，读不出这枚 NFT 的编号 —— 不猜编号是有意的（猜错会去改别人的那一枚）':
      'The mint succeeded, but the receipt carries no Minted event, so this NFT’s id cannot be read. Not guessing the id is deliberate — a wrong guess would rewrite somebody else’s NFT',
    /* 主编号一律是**区块号**（{n}），tokenId 只在括号里当副编号（{m}/{k}）——
       全站口径见 web/bnb-ui.js 顶部与 web/intervene.js 的 uniNo()。 */
    '铸下并拯救成功 —— 宇宙 #{n} 现在是你的了（链上 NFT #{m}），参数也已经按沙盒里这一串改写了。':
      'Minted and rescued — Universe #{n} is now yours (on-chain NFT #{m}), and its parameters have been rewritten with the nudges from the sandbox.',
    /* **中途失败的话术是这条改动的重点。** 第 1 步落地之后用户已经拿到 NFT 了，
       铸造那一笔钱不是白花的 —— 笼统一句「失败了」会让人以为钱打了水漂。 */
    '宇宙 <b>#{n}</b> 已经是你的了，但拯救没完成（{m}）。':
      'Universe <b>#{n}</b> is already yours, but the rescue did not finish ({m}).',
    '这个宇宙已经铸成你的 NFT 了，但拯救没完成（{n}）。':
      'This universe has already been minted as your NFT, but the rescue did not finish ({n}).',
    '它现在还是原始状态 —— 铸造那一笔没白花，那枚 NFT 就在你钱包里；重新进沙盒推一遍就能再拯救。':
      'It is still in its original state — the mint was not wasted, that NFT is in your wallet; re-enter the sandbox, nudge again, and you can rescue it.',
    '到市场页找到它': 'Find it on the market page',
    '没能铸下并拯救：': 'Mint & Rescue did not go through: ',
    'BANG 代币地址没配，付不了拯救的费用':
      'The BANG token address is not configured — the rescue cannot be paid for',
    '正在拯救，等这一笔走完': 'Rescuing — wait for this one to finish',
    '上一格还在服务端算，等它回来再拯救':
      'The last notch is still being computed on the server — wait for it before rescuing',
    '烧 BANG 改写你手上这枚原生 NFT 的参数：先授权 BANG 再干预，一次点击、两次钱包确认':
      'Burn BANG to rewrite the parameters of the native NFT you hold: approve BANG first, then intervene — one click, two wallet confirmations',
    /* 前置那几句：这条出口只对「你自己的、已经铸出来的」原生 NFT 开放，
       其余每一种情况都得说清楚是**哪一条**不成立，不能笼统一句「不能拯救」。 */
    '正在查这个宇宙铸了没有…': 'Checking whether this universe has been minted…',
    '查不到这个宇宙的链上状态：': 'Could not read this universe’s on-chain state: ',
    '重试': 'Retry',
    /* 「这个宇宙还没被铸造…你可以先铸下它，或直接铸成造物」这条已删：
       那正是断头路本身的文案（推活了却拿不走）。它的位置现在归「铸下并拯救」那颗按钮。 */
    '宇宙 #{n} 已经铸成 NFT 了。没有检测到钱包扩展，看不出它是不是你的':
      'Universe #{n} has already been minted as an NFT. No wallet extension was detected, so there is no way to tell whether it is yours',
    '宇宙 #{n} 已经铸成 NFT 了。': 'Universe #{n} has already been minted as an NFT.',
    '连接钱包看它是不是你的': 'Connect a wallet to see whether it is yours',
    '宇宙 #{n}（链上 NFT #{k}）的持有人是 {m} —— 拯救只能改写你自己的那一枚':
      'Universe #{n} (on-chain NFT #{k}) is held by {m} — a rescue can only rewrite the one you own yourself',
    '宇宙 #{n} 上没有参数章（cardOf 是零，多半是早期不带签名铸的）—— 服务端复算不出它的参数，改写不了':
      'Universe #{n} carries no parameter stamp (cardOf is zero — most likely minted through the early unsigned path); the server cannot recompute its parameters, so it cannot be rewritten',
    '宇宙 #{n}（链上 NFT #{k}）已经按这串位移拯救过了。沙盒里的位移是从原生态数起的，再送一次会在已经推过的卡上重推一遍 —— 关掉沙盒重新进来再继续':
      'Universe #{n} (on-chain NFT #{k}) has already been rescued with this run of nudges. The sandbox counts nudges from the native state, so sending them again would replay them on top of an already-nudged card — close the sandbox and re-enter to continue',
    /* 拯救的代价行 —— 这两句是整条改动的重点，两条路的区别就靠它和造物那句分开 */
    '改写你手上的 <b>宇宙 #{n}</b>（链上 NFT #{k}）：费用 <b>{m} BANG</b>':
      'Rewrites the <b>Universe #{n}</b> you hold (on-chain NFT #{k}): fee <b>{m} BANG</b>',
    '<b>100% 销毁</b>，永久记进它的 burnedOn（现在 {n} BANG）；稀有度和结局会真的改变':
      '<b>100% burned</b>, recorded permanently in its burnedOn (currently {n} BANG); its rarity and outcome really do change',
    /* 流程与预检 */
    '链访问层没加载，拯救不了':
      'Chain access layer not loaded — cannot rescue',
    '服务端客户端没加载，拯救不了':
      'The server client is not loaded — cannot rescue',
    '正在读这枚 NFT 现在的参数章…': 'Reading this NFT’s current parameter stamp…',
    '这枚 NFT 上没有参数章（cardOf 是零），服务端复算不出它的参数':
      'This NFT carries no parameter stamp (cardOf is zero) — the server cannot recompute its parameters',
    '服务端的应答缺字段，拯救不了': 'The server response is missing fields — cannot rescue',
    '钱包现在连的不是这枚 NFT 的持有人账户 —— 合约那边会 NotOwner，换回持有它的那个账户再试':
      'The wallet is connected to an account that does not hold this NFT — the contract would revert with NotOwner; switch back to the holding account and try again',
    '宇宙合约的签名闸还没开（signer() 是零地址，要 owner 去 setSigner）—— 现在干预必败，一分 gas 都别花':
      'The universe contract’s signing gate is not open yet (signer() is the zero address — the owner must call setSigner). Intervening now is guaranteed to fail; don’t spend a single bit of gas',
    'BANG 不够：钱包里有 {n} BANG，这一次拯救要烧 {m} BANG':
      'Not enough BANG: the wallet holds {n} BANG, and this rescue burns {m} BANG',
    '拯救之前先在链上模拟这一笔…': 'Simulating this transaction on-chain before rescuing…',
    '模拟干预被链上回滚（真发也必败，一分 gas 没花）：':
      'The simulated intervention reverted on-chain (a real one would fail the same way; no gas was spent): ',
    '干预的 gas 预估失败（这笔没发出去）：':
      'Gas estimation for the intervention failed (nothing was sent): ',
    '拯救这枚 NFT：在钱包里确认…': 'Rescuing this NFT: confirm in the wallet…',
    '拯救交易被链上回滚了 —— 多半是签名过期，重新点一次再试':
      'The rescue transaction was reverted on-chain — most likely the signature expired; click once more to retry',
    '拯救成功 —— 宇宙 #{n} 的参数被改写了。': 'Rescued — Universe #{n}’s parameters have been rewritten.',
    '它现在累计烧掉 <b>{n} BANG</b>（burnedOn，链上现读）':
      'It has now burned <b>{n} BANG</b> in total (burnedOn, read live from the chain)',
    '没能拯救：': 'The rescue did not go through: ',
    '服务端给的位移记录不是整字节，拼不出交易':
      'The nudge record from the server is not whole bytes — the transaction cannot be assembled',
    '服务端给的签名不是整字节，拼不出交易':
      'The signature from the server is not whole bytes — the transaction cannot be assembled',
    /* 模拟回滚的选择器翻译（contracts/src/MirrorUniverse.sol 的 error 定义
       + BangToken 的 Insufficient）。BadRarity / BadConfig / Panic 三句与造物共用，上面已收。 */
    '这枚 NFT 不是你的（NotOwner）—— 干预只能改写自己持有的那一枚':
      'This NFT is not yours (NotOwner) — an intervention can only rewrite one you hold yourself',
    '签名验不过（BadSig）：服务端签名和合约的 signer 对不上，或新参数章是零，或签名闸中途被关了':
      'Signature check failed (BadSig): the server’s signature does not match the contract’s signer, the new parameter stamp is zero, or the signing gate was closed midway',
    '签名过期了（Expired）—— 重新点一次，拿份新签名再试':
      'The signature expired (Expired) — click once more to fetch a fresh one and try again',
    '位移记录不合法（BadOps）：空的，或长度不是 5 字节一条 —— 多半是 calldata 拼错了':
      'The nudge record is invalid (BadOps): empty, or not a multiple of 5 bytes — most likely the calldata was assembled wrong',
    '结局或稀有度序号不合法（BadOutcome）': 'Invalid outcome or rarity index (BadOutcome)',
    'BANG 代币地址还没设进宇宙合约（TokenNotSet），烧不了币':
      'The BANG token address has not been set on the universe contract (TokenNotSet) — nothing can be burned',
    '查不到这个编号的 NFT（NoToken）': 'No NFT exists with this id (NoToken)',
    '哈希是零（BadHash），服务端应答有问题':
      'The hash is zero (BadHash) — something is wrong with the server response',
    '这个宇宙已经被引爆过了（AlreadyBanged）': 'This universe has already been detonated (AlreadyBanged)',
    '已经铸满了（MintCapReached）': 'The mint cap has been reached (MintCapReached)',
    '付的金额不对（WrongPrice）': 'The amount paid is wrong (WrongPrice)',
    'BANG 不够、或授权额度不够（Insufficient，代币合约报的）':
      'Not enough BANG, or not enough allowance (Insufficient, raised by the token contract)'
,

    /* ---- 目标二：冷液体宇宙（web/intervene.js）。结局仍是既有的 NO_STARS，只是多一个变体 ---- */
    '换一个终点：把这个宇宙推成什么样': 'Pick a different end point — what to turn this universe into',
    '目标': 'Goal',
    '冷液体宇宙': 'Cold liquid universe',
    '目标换成「冷液体宇宙」：引力弱到气体不塌缩、没有恒星，但分子还在液态温区里。结局仍是「没有恒星的宇宙」，判据见分析面板的 R_OCEAN（启发式）。':
      'Goal switched to "cold liquid universe": gravity too weak for the gas to collapse, no stars, yet molecules sit inside their liquid temperature range. The outcome is still "a universe without stars"; the test is R_OCEAN in the analysis panel (heuristic).',
    '目标换回「可能诞生观察者」。': 'Goal switched back to "observers possible".',
    '目标：冷液体宇宙': 'Goal: cold liquid universe',
    '已经是冷液体宇宙了。': 'This is already a cold liquid universe.',
    '要同时满足四条：<b>气体在宇宙年龄内不塌缩</b>、<b>没有一颗恒星点燃</b>、<b>有原子且分子有刚性</b>、<b>背景温度落在分子的液态温区</b>。':
      'Four conditions have to hold at once: <b>the gas does not collapse within the age of the universe</b>, <b>not one star ignites</b>, <b>atoms exist and molecules are rigid</b>, and <b>the background temperature falls inside the molecular liquid range</b>.',
    '物质既不聚成天体也不全是气体 —— 判据与全部数值在分析面板的 R_OCEAN 那一条（依据等级：启发式）。':
      'Matter neither gathers into bodies nor stays entirely gaseous — the test and every number behind it are in the R_OCEAN entry of the analysis panel (basis: heuristic).',
    '主要靠压低引力耦合（α_G）、调重子密度 Ω_b 与背景温度 T_CMB。<b>这一步没有确定答案</b>：程序在本地爬山找一组落点，实测一半左右的死宇宙能推到 —— 推不到就会如实说。':
      'Mostly by pushing the gravitational coupling (α_G) down and tuning the baryon density Ω_b and the background temperature T_CMB. <b>There is no exact answer here</b>: the program hill-climbs locally for a landing point and reaches it for roughly half of the dead universes measured — when it cannot, it says so.',
    '（沙盒不收费；真烧的费用在推完那一刻由服务端算）': '(free in the sandbox; the real burn cost is computed by the server at the moment you push)',
    '推向冷液体宇宙': 'Push toward a cold liquid universe',
    '再推一次': 'Push again',
    '推成冷液体宇宙了：引力太弱以致气体不塌缩、没有恒星，分子留在液态温区里。':
      'It is a cold liquid universe now: gravity is too weak for the gas to collapse, there are no stars, and molecules stay inside their liquid temperature range. ',
    '结局仍是「没有恒星的宇宙」—— 判据与数值在分析面板的 R_OCEAN 那一条（启发式）。':
      'The outcome is still "a universe without stars" — the test and the numbers are in the R_OCEAN entry of the analysis panel (heuristic).',
    '推完还差一点 —— 现在的结局是「': 'Not quite there — the outcome is now "',
    '」。': '". ',
    '取整之后落点可能被挤出判据边界，再点一次、或者手动微调几格试试。':
      'Rounding the notch count can push the landing point just outside the test. Click again, or nudge a few parameters by hand.',
    '这个宇宙推不成冷液体宇宙 —— 沿这些参数爬不到那四条判据同时成立的地方。':
      'This universe cannot be pushed into a cold liquid universe — along these parameters there is no reachable point where all four conditions hold.',
    '服务端说这些方向推不动，这一步走不了': 'The server says these directions cannot move — this step is not available',
    '四条判据都成立了。': 'All four conditions hold.',
    '现在还差：恒星照常点燃了（这一条要求没有恒星）。': 'Still missing: stars ignite as usual (this condition requires none).',
    '现在还差：气体在宇宙年龄内仍会塌缩（引力还不够弱）。': 'Still missing: the gas still collapses within the age of the universe (gravity is not weak enough).',
    '现在还差：没有稳定的原子或分子没有刚性。': 'Still missing: no stable atoms, or molecules without rigidity.',
    '现在还差：背景温度没有一段落在分子的液态温区内。': 'Still missing: no stretch of the background temperature falls inside the molecular liquid range.',

    /* ---- 自动推（web/intervene.js 的 renderAutoGo / autoTick）。
           选了目标就自动往目标推，按钮三态：自动推 / 停 / 推不动了。 ---- */
    '自动推': 'Auto-push',
    '停': 'Stop',
    '推不动了': 'Cannot push further',
    '这个宇宙推不到这个目标': 'This universe cannot reach this goal',
    '正在算提示…': 'Working out the hint…',
    '<b>这个宇宙推不到这个目标。</b>沿这些参数爬过去，找不到四条判据同时成立的落点 —— 换一个目标，或者换一个宇宙。':
      '<b>This universe cannot reach this goal.</b> Climbing along these parameters, there is no landing point where all four conditions hold — pick another goal, or another universe.',
    '按当前目标「{n}」一步一步推下去，随时可以停': 'Push step by step toward the current goal "{n}" — stop any time',
    '正在往「{n}」推，第 {m} 步 —— 点一下收手': 'Pushing toward "{n}", step {m} — click to stop',
    '已经到「{n}」了': 'Already at "{n}"',
    '提示判定：沿这些参数爬不到这个终点。换一个目标，或者换一个宇宙。':
      'The hint module says so: this end point is not reachable along these parameters. Pick another goal, or another universe.',
    '上一轮自动推没找到能变好的一格。手动推一格、或者撤销一步，再试。':
      'The last auto-push run found no notch that improves things. Push one by hand, or undo a step, then try again.',
    '自动推开始：目标「{n}」。想停随时点「停」。': 'Auto-push started, goal "{n}". Click "Stop" whenever you want.',
    '停了 —— 自动推走了 {n} 步。': 'Stopped — auto-push took {n} steps.',
    '目标换了，自动推停下了。': 'The goal changed, so auto-push stopped.',
    '到了：目标「{n}」，自动推一共走了 {m} 步。': 'Arrived: goal "{n}", reached in {m} auto-push steps.',
    '推了 {m} 秒（{n} 步）还没到，先停下来 —— 再点一次「自动推」可以接着推。':
      '{m} seconds ({n} steps) and still not there, so it stops here — click "Auto-push" again to carry on.',
    '推了 {n} 步还没到，先停下来 —— 再点一次「自动推」可以接着推。':
      '{n} steps and still not there, so it stops here — click "Auto-push" again to carry on.',
    '自动推 第 {n} 步：': 'Auto-push, step {n}: ',
    '把维度推到 3（{n} 格）': 'Pushed the dimension to 3 ({n} notches)',
    '把「{n}」调低 {m} 格': 'Turn "{n}" down by {m} notches',
    '把「{n}」调高 {m} 格': 'Turn "{n}" up by {m} notches',
    '提示模块没加载，自动推走不了。': 'The hint module is not loaded, so auto-push cannot run.',
    '　（总分 {n}/100）': ' (score {n}/100)',
    '连推 {n} 步总分都没涨，停下来了 —— 贪心在这儿转圈。':
      '{n} steps in a row without the score moving, so it stopped — the greedy search is going in circles here. ',
    '提示找不到能变好的一格了，先往坏处推也没能翻过去。':
      'The hint finds no notch that improves things, and pushing one the wrong way first did not get over the hump either. ',
    '先往坏处推一格好翻过去 —— ': 'Pushing one notch the wrong way to get over the hump — ',
    '　还卡在「{n}」这道门上。': ' Still stuck on the "{n}" gate.',
    '可以撤销一步、手动推一格换个方向，或者换个目标。':
      'You can undo a step, push one by hand in another direction, or pick another goal.',
    '把沙盒里这组参数（推了 {n} 格）直接拿去引爆看结果 —— 不上链、不铸造':
      'Detonate the sandbox parameters as they stand ({n} notches pushed) just to see the result — nothing goes on chain, nothing is minted'
  }, 'tools');
})(typeof window !== 'undefined' ? window : this);
