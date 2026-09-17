/*
 * web/i18n-mirror.js —— ui/mirror.js, ui/adapter.js, ui/about-content.js 的中英词条
 * ------------------------------------------------------------
 * 只放**界面上真会出现**的句子；注释、日志、开发用文字不进这里。
 * key 是中文原文，逐字相等才命中；漏翻的自动退回中文，不会出现裸 key。
 * 机制与约定见 web/i18n.js 顶部。
 *
 * 三件后来人容易踩的事：
 *   1. 很多 key 是**句子的一截**（'距今 ' + 数字 + ' 亿年'）。译文里的首尾空格是拼接用的，
 *      别顺手 trim；改中文原文的时候，这三截都要跟着改。
 *   2. 数字、公式、单位一个都没动。中文的「万 / 亿」在英文里没有对应词：
 *      动态数字后面一律写成 ×10⁴ / ×10⁸（等值，不换算数字），静态数字才按等值写成 million / billion。
 *   3. 名字与判定用的原文不在这里：'椭圆'（genGalaxy 用 indexOf 判臂）、'地球'（定位用 ===）、
 *      '束缚'（演示表的状态键）这些原文留在代码里，只有"显示出来的那一份"过 t()。
 */
(function (root) {
  'use strict';
  var I = root.MirrorI18n;
  if (!I) return;            // i18n 核心没加载：静默退回全中文，不要让页面挂掉

  /* ---- 层级、天体名与类型（ui/mirror.js） ---- */
  I.add({
    '宇宙': 'Universe',
    '星系': 'Galaxy',
    '恒星系': 'Star system',
    '行星': 'Planets',
    '地表': 'Surface',
    '星球': 'World',
    '恒星': 'Stars',
    '太阳': 'Sun',
    '太阳系': 'Solar System',
    '银河系': 'Milky Way',
    '星系 G-': 'Galaxy G-',
    '中心质点 ': 'Central mass ',
    '质点 ': 'Particle ',
    '流浪行星': 'Rogue planet',
    /* 太阳系九个天体的通用译名 */
    '水星': 'Mercury',
    '金星': 'Venus',
    '地球': 'Earth',
    '火星': 'Mars',
    '木星': 'Jupiter',
    '土星': 'Saturn',
    '天王星': 'Uranus',
    '海王星': 'Neptune',
    '冥王星': 'Pluto',
    /* 行星类型（3 维） */
    '岩质行星': 'Rocky planet',
    '类地行星': 'Earth-like planet',
    '气体巨行星': 'Gas giant',
    '冰巨星': 'Ice giant',
    '熔岩世界': 'Lava world',
    '海洋世界': 'Ocean world',
    /* 行星类型（2 维世界里是圆盘不是球） */
    '岩质圆盘': 'Rocky disc',
    '类地圆盘': 'Earth-like disc',
    '液态水覆盖的圆盘': 'Disc covered in liquid water',
    '气态圆盘（没有可以站立的地面）': 'Gaseous disc (no ground to stand on)',
    '冰封圆盘': 'Frozen disc',
    '熔融圆盘': 'Molten disc',
    '圆盘': 'Disc',
    /* 星系形态与恒星光谱型 */
    '旋涡星系 Sb': 'Spiral galaxy Sb',
    '旋涡星系 Sc': 'Spiral galaxy Sc',
    '棒旋星系 SBb': 'Barred spiral galaxy SBb',
    '棒旋星系 SBc': 'Barred spiral galaxy SBc',
    '椭圆星系 E3': 'Elliptical galaxy E3',
    'O5V 蓝巨星': 'O5V blue giant',
    'B2V 蓝白星': 'B2V blue-white star',
    'A0V 白星': 'A0V white star',
    'F5V 黄白星': 'F5V yellow-white star',
    'G2V 黄矮星': 'G2V yellow dwarf',
    'K3V 橙矮星': 'K3V orange dwarf',
    'M4V 红矮星': 'M4V red dwarf',
    /* 卫星类型 */
    '岩质': 'rocky',
    '冰质': 'icy',
    '火山': 'volcanic',
    '有大气': 'has an atmosphere',
    '海洋': 'ocean',
    /* 「找一个…系统」的宿主类型 */
    '白矮星': 'white dwarf',
    '红巨星 / 渐近巨星支': 'red giant / asymptotic giant branch',
    '中子星': 'neutron star',
    '黑洞': 'black hole',
    '较大质量主序星（≥2 M☉，A/B 型）': 'higher-mass main-sequence star (≥2 M☉, type A/B)',
    /* 过程生成的恒星系名（'恒星 B6BG'）的通名前缀。**只在 TRN() 里用**：整串是"通名 + 专名"，
       专名是种子抽出来的编号，不能进词典也不能改。上面那条 '恒星' → 'Stars' 是层级名（复数），
       两条 key 差一个尾空格，别合并。 */
    '恒星 ': 'Star ',
    /* 面包屑上恒星系那一级的后缀：中文写「恒星 B6BG系」，英文是后置的词「Star B6BG system」。 */
    '系': ' system',
    /* engine/planet.js describeStar 的两个兜底词：恒星没名字时的称呼、演化阶段名缺失时的类名 */
    '这颗恒星': 'this star',
    '致密遗骸': 'compact remnant'
  }, 'mirror');

  /* ---- 量词、单位与数量（拼接用，首尾空格有意义） ---- */
  I.add({
    '约 ': 'about ',
    '约 2000 亿': 'about 2000×10⁸',
    ' 亿': '×10⁸',
    ' 亿年': ' ×10⁸ yr',
    ' 万年': ' ×10⁴ yr',
    ' 年': ' yr',
    ' 天': ' d',
    ' 光年': ' ly',
    ' 亿光年': ' ×10⁸ ly',
    ' 千光年': ' kly',
    ' 万 km': ' ×10⁴ km',
    ' 万 AU': ' ×10⁴ AU',
    ' 千公里': ' ×10³ km',
    ' 万米': ' ×10⁴ m',
    ' 米': ' m',
    ' 星等': ' mag',
    ' AU · 周期 ': ' AU · period ',
    '第 ': '#',
    '共 ': 'Total ',
    ' 个': '',
    ' 颗': '',
    ' 项）': ' items)',
    '（': ' (',
    '）': ')',
    '（GCVS ': ' (GCVS ',
    '（D=': ' (D=',
    '（heuristic）': ' (heuristic)',
    ' 颗行星': ' planet',
    ' 颗卫星': ' moons',
    ' 颗矮行星': ' dwarf planet',
    ' 颗彗星': ' comet',
    ' 条小行星带': ' asteroid belt',
    '距今 ': '',
    '未来 +': 'future +',
    '现在（零时标）': 'now (zero mark)',
    '公元 ': 'AD ',
    '公元前 ': 'BC ',
    ' 年（距今 ': ' (',
    ' 年）': ' yr ago)',
    /* 时间轴的比例档 */
    '全程': 'Full span',
    '10 亿年': '10⁹ yr',
    '1 亿年': '10⁸ yr',
    '1000 万年': '10⁷ yr',
    '100 万年': '10⁶ yr',
    '10 万年': '10⁵ yr',
    '1 万年': '10⁴ yr',
    '1000 年': '10³ yr',
    '100 年': '100 yr',
    '10 年': '10 yr'
  }, 'mirror');

  /* ---- 面包屑、地址栏、命名 ---- */
  I.add({
    '层级': 'Levels',
    '退出镜像': 'Leave the mirror',
    '宇宙 ': 'Universe ',
    '星系 #': 'Galaxy #',
    '恒星系 #': 'System #',
    '地址：M:星系种子/恒星系种子/行星序号': 'Address: M:galaxySeed/systemSeed/planetIndex',
    '位置地址：粘贴后回车跳转': 'Location address: paste it and press Enter to jump',
    '地址用**种子**表示，与粒子档位无关：换台机器、换个档位，同一个地址到的是同一个地方（星系目录会因档位而异，地址不会）。回车跳转。':
      'An address is written as **seeds**, independent of the particle setting: on another machine, at another setting, the same address lands in the same place (the galaxy catalog changes with the setting, the address does not). Press Enter to jump.',
    '跳转': 'Go',
    '跳到输入框里的地址': 'Jump to the address in the box',
    '复制': 'Copy',
    '复制当前位置的地址，发给别人就能到同一个地方': 'Copy the address of this spot — send it to someone and they land in the same place',
    '还没进入任何星系，没有地址可复制': 'You have not entered a galaxy yet, so there is no address to copy',
    '已复制地址：': 'Address copied: ',
    '复制不了，手动选中输入框里的地址：': 'Could not copy — select the address in the box by hand: ',
    '地址是空的。格式：M:星系种子/恒星系种子/行星序号，例如 ': 'The address is empty. Format: M:galaxySeed/systemSeed/planetIndex, e.g. ',
    '看不懂这个地址：「': 'Cannot read this address: “',
    '」。格式：M:星系种子/恒星系种子/行星序号（36 进制）': '”. Format: M:galaxySeed/systemSeed/planetIndex (base 36)',
    '这个星系种子生成失败：': 'This galaxy seed failed to generate: ',
    '已跳到 ': 'Jumped to ',
    '恒星系种子读不出来，已停在星系层': 'Could not read the system seed — stopped at the galaxy level',
    '这个恒星系只有 ': 'This star system has only ',
    ' 颗行星，序号 ': ' planets; index ',
    ' 越界，已停在恒星系层': ' is out of range — stopped at the star-system level',
    /* 重命名 */
    '重命名': 'Rename',
    '重命名（当前天体）': 'Rename (current body)',
    '双击可以给它起个名字': 'Double-click to give it a name',
    '给这个天体起个名字': 'Give this body a name',
    '保存': 'Save',
    '保存（Enter）': 'Save (Enter)',
    '取消': 'Cancel',
    '取消（Esc）': 'Cancel (Esc)',
    'Enter 保存 · Esc 取消 · 留空恢复原名（原名：': 'Enter = save · Esc = cancel · leave it empty to restore the original name (originally: ',
    '；最多 ': '; at most ',
    ' 字）': ' characters)',
    '这一层没有可以命名的天体': 'Nothing on this level can be named',
    '已命名：': 'Named: ',
    '（原名 ': ' (originally ',
    '已恢复原名：': 'Original name restored: ',
    '现在叫「': 'Currently called “',
    '」，原名 ': '”, originally ',
    '；留空可恢复原名': '; leave it empty to restore the original name',
    '给「': 'Give “',
    '」起个自己的名字（最多 ': '” a name of your own (at most '
  }, 'mirror');

  /* ---- 时间轴与彩蛋 ---- */
  I.add({
    '比例': 'Scale',
    '时间比例': 'Time scale',
    '拉出未来时段': 'Extend into the future',
    '时间后退': 'Step back in time',
    '时间前进': 'Step forward in time',
    '回到现在': 'Back to now',
    '时间滚动条': 'Time slider',
    '零时标': 'Zero mark',
    '零时标之后：未来不可计算——混沌与量子随机': 'Past the zero mark the future cannot be computed — chaos and quantum randomness',
    '时间轴回到现在': 'Timeline back to now',
    '时间轴已经停在"现在"': 'The timeline is already at “now”',
    '一个玩笑式的演示，不是计算结果': 'A joke of a demo, not a computed result',
    '彩蛋（致敬）': 'Easter egg (homage)',
    '彩蛋（致敬） — Stack overflow': 'Easter egg (homage) — Stack overflow',
    '彩蛋（致敬）：把“模拟宇宙里再模拟一个宇宙”一路递归下去，每一层都要把上一层的现场压入堆栈，没有终止条件，堆栈迟早耗尽——这是个玩笑式的演示，不是本程序的计算结果。限制在别处：未来不可计算——混沌系统对初始条件敏感（Lorenz 1963），量子测量结果本身随机。':
      'Easter egg (homage): recurse “simulate a universe inside the simulated universe” all the way down, and every level has to push the caller’s state onto the stack. With no termination condition the stack runs out sooner or later — a joke of a demo, not a result this program computed. The limit is elsewhere: the future cannot be computed, because chaotic systems are sensitive to initial conditions (Lorenz 1963) and quantum measurement outcomes are random in themselves.',
    '看一眼递归': 'Watch the recursion',
    '确定': 'OK',
    ' 层 · Stack overflow': ' levels down · Stack overflow',
    '彩蛋（致敬）：每一层都在模拟下一层，每次调用都要把上层现场压入堆栈——没有终止条件，堆栈迟早耗尽。':
      'Easter egg (homage): every level simulates the next, and every call pushes the caller’s state onto the stack — with no termination condition the stack runs out sooner or later.',
    '限制在别处：未来不可计算——混沌对初始条件敏感（Lorenz 1963），量子测量结果本身随机。':
      'The limit is elsewhere: the future cannot be computed — chaos is sensitive to initial conditions (Lorenz 1963), and quantum measurement outcomes are random in themselves.',
    '按 Esc / 点击 结束跟踪': 'Esc or click to stop the trace',
    '点击收起': 'Click to collapse',
    '点击展开说明': 'Click to expand'
  }, 'mirror');

  /* ---- 底部提示条 ---- */
  I.add({
    '选中后按 Enter 或点“进入”才会下潜': 'selecting only highlights it — press Enter or click “Enter” to descend',
    '“← 上一个 / 下一个 →”按一下就直接换过去': '“← previous / next →” switches straight away',
    '路径：宇宙网 → 星系 → 恒星系 → 行星 → 地表　｜　“随机选一个星系”= 直接进入（右键菜单里有「只选中」），点列表里的一行 = 只选中，':
      'Path: cosmic web → galaxy → star system → planet → surface · “Pick a random galaxy” enters directly (the right-click menu has “select only”); clicking a row in the list only selects — ',
    ' · 双击任意处直接进入该处星系 · 拖动时间滚动条 · Esc 退出镜像':
      ' · double-click anywhere to enter the galaxy there · drag the time slider · Esc to leave the mirror',
    '“随机选一个恒星系” = 直接进入（右键菜单里有「只选中」）；': '“Pick a random star system” enters directly (the right-click menu has “select only”); ',
    ' · 双击旋臂任意处直接进入 · PageUp / PageDown 在星系目录里选 · Backspace 返回 · [ ] 移动时间':
      ' · double-click anywhere on a spiral arm to enter · PageUp / PageDown to step through the galaxy catalog · Backspace to go back · [ ] to move through time',
    '点行星名 = 选中，双击行星 = 直接进入，': 'Click a planet name to select it, double-click a planet to enter it; ',
    '；': '; ',
    ' · Backspace 返回 · [ ] 移动时间 · , . 调轨道流速': ' · Backspace to go back · [ ] to move through time · , . to change the orbital speed',
    '滚轮 = 高度（向下滚动降低） · 双击降到地表 · , . 或“← 上一颗 / 下一颗 →”直接换到本恒星系的另一颗 · Backspace 返回':
      'Scroll = altitude (scroll down to descend) · double-click to drop to the surface · , . or “← previous / next →” switches to another planet in this system · Backspace to go back',
    '滚轮 = 高度 · 双击急剧下降 · 方向键平移 · , . 或“← 上一颗 / 下一颗 →”直接换到另一颗（换过去仍留在地表）· Backspace 返回':
      'Scroll = altitude · double-click to dive · arrow keys to pan · , . or “← previous / next →” switches to another planet (you stay on the surface) · Backspace to go back',
    '轨道投影演示：这个维数没有稳定轨道与球面地表，到恒星系为止 · 画面上的亮点是试探质点，不是行星，不能进入 · Backspace 返回 · [ ] 移动时间':
      'Orbit-projection demo: at this dimension there are no stable orbits and no spherical surfaces, so the view stops at the star system · the bright dots are test particles, not planets, and cannot be entered · Backspace to go back · [ ] to move through time'
  }, 'mirror');

  /* ---- 受限维数下的说明横幅（D≥4 的轨道投影演示 / D=2 的平面世界） ---- */
  I.add({
    '这是 D=': 'This is a D=',
    ' 的轨道投影演示：该维数下引力按 r^{−': ' orbit-projection demo: at this dimension gravity falls off as r^{−',
    '} 衰减，没有稳定的圆轨道（Ehrenfest 1917）——画面上那几个亮点是试探质点（不是行星，不能进入），在 1% 扰动下几圈内就会坠入中心、或沿径向逃逸到无穷远。两种下场都发生在这个 D 维空间内部：质点并没有「进入别的维度」，高维在这里只体现为引力衰减更快、有效势里不再有稳定极小值。R 重置 · 3 切换到 D=3 对照 · +/− 调扰动':
      '}, so no circular orbit is stable (Ehrenfest 1917). The bright dots are test particles — not planets, and you cannot enter them; under a 1% perturbation they fall into the centre or escape radially to infinity within a few orbits. Both endings happen inside this D-dimensional space: the particles do not “enter another dimension”. The extra dimensions show up here only as gravity falling off faster, so the effective potential no longer has a stable minimum. R = reset · 3 = switch to the D=3 comparison · +/− = adjust the perturbation',
    '　｜　分数维（推测）': ' · fractional dimension (speculative)',
    ' 的 2 维世界（示意）：引力按 r^{−': ' 2-dimensional world (schematic): gravity falls off as r^{−',
    '} 衰减，2+1 维引力本身是推测；行星是圆盘而不是球，没有球面地表。下面的画面与数值都只是示意。':
      '}, and 2+1-dimensional gravity is itself speculative. Planets are discs rather than spheres, and there is no spherical surface. Everything below — the view and the numbers alike — is schematic.',
    ' 轨道投影演示 · 点此看说明': ' orbit-projection demo · click for the details',
    ' 2 维世界（示意）· 点此看说明': ' 2-dimensional world (schematic) · click for the details',
    '有恒星，但没有分子化学 · 点此看说明': 'Stars, but no molecular chemistry · click for the details',
    '轨道投影演示（D=': 'Orbit-projection demo (D=',
    '）：力 ∝ r^{−(D−1)}，没有稳定的闭合轨道，也没有球面地表——只画到恒星系这一层，画面上的亮点是试探质点而不是行星，不能进入。':
      '): the force goes as r^{−(D−1)}, so there are no stable closed orbits and no spherical surfaces. The view stops at the star-system level; the bright dots are test particles rather than planets, and cannot be entered.',
    '2 维世界（示意）：D=': '2-dimensional world (schematic): D=',
    '，下面的画面是 2 维几何下的示意渲染，物理量仍按 3 维公式外推。':
      '. The view below is a schematic rendering in 2D geometry; the physical quantities are still extrapolated from the 3D formulas.',
    ' 没有稳定轨道与球面地表，这里只演示引力律；这些是试探质点，不是行星，没有可进入的星球。':
      ' has no stable orbits and no spherical surfaces, so this only demonstrates the force law. These are test particles, not planets — there is no world to enter.',
    '试探质点（该维数下无行星可言，仅演示引力律的后果）': 'Test particles (no planets exist at this dimension; this only shows what the force law implies)',
    '引力律': 'Force law',
    '圈数': 'Orbits',
    '进动°/圈': 'Precession °/orbit',
    '演示尚未开始': 'the demo has not started',
    '束缚': 'bound',
    '坠入': 'infall',
    '逃逸': 'escape',
    '扰动 ': 'Perturbation ',
    '% · 已演化 ': '% · evolved ',
    ' T₀ · 束缚 ': ' T₀ · bound ',
    '）· R 重置 · 3 切换 D=3 对照 · +/− 调扰动': ') · R = reset · 3 = switch to the D=3 comparison · +/− = adjust the perturbation',
    '（相对我们的太阳，仅作积分单位）': ' (relative to our Sun, used only as the unit of integration)',
    /* ---- 2026-09-17 高维显示审计：轨道稳不稳定要按 D 分开说（D≥4 才不稳；2<D<4 稳但进动），
           选中卡也必须跟进去之后那一层说同一套话 ---- */
    '} 衰减，': '}, ',
    '没有稳定的圆轨道（Ehrenfest 1917）': 'and no circular orbit is stable (Ehrenfest 1917)',
    '圆轨道对径向微扰仍然稳定，但不再闭合——轨道会进动（Ehrenfest 1917：只有 D=3 给出闭合椭圆）':
      'circular orbits are still stable against radial perturbations but no longer close — they precess (Ehrenfest 1917: only D=3 gives a closed ellipse)',
    '——画面上那几个亮点是试探质点（不是行星，不能进入），在 1% 扰动下几圈内就会坠入中心、或沿径向逃逸到无穷远。两种下场都发生在这个 D 维空间内部：质点并没有「进入别的维度」，高维在这里只体现为引力衰减更快、有效势里不再有稳定极小值。':
      '. The bright dots are test particles — not planets, and you cannot enter them; under a 1% perturbation they fall into the centre or escape radially to infinity within a few orbits. Both endings happen inside this D-dimensional space: the particles do not “enter another dimension”. The extra dimensions show up here only as gravity falling off faster, so the effective potential no longer has a stable minimum. ',
    '。画面上那几个亮点是试探质点（不是行星，不能进入）：本引擎不为 D≠3 生成行星，因为行星形成、恒星结构与地表那一整套公式都只对 3 维成立。这里只演示引力律本身的后果。':
      '. The bright dots are test particles — not planets, and you cannot enter them. This engine does not generate planets for D≠3, because planet formation, stellar structure and the whole surface pipeline only hold in three dimensions. All this shows is what the force law itself implies. ',
    'R 重置 · 3 切换到 D=3 对照 · +/− 调扰动': 'R = reset · 3 = switch to the D=3 comparison · +/− = adjust the perturbation',
    ' 的 2 维世界（示意）：画面里的圆盘与轨道建立在"把引力写成 r^{−': ' 2-dimensional world (schematic): the discs and orbits on screen rest on writing gravity as r^{−',
    '}"这个推测之上；引擎自己的判据相反——D≤2 时引力势为对数或排斥，没有牛顿吸引，物质根本聚集不起来（Tegmark 1997），这个宇宙的结局因此是「无稳定轨道 / 无稳定原子」。行星是圆盘而不是球，没有球面地表；下面的画面与数值都只是示意。':
      '}, which is conjecture. The engine’s own test says the opposite: at D≤2 the gravitational potential is logarithmic or repulsive, there is no Newtonian attraction and matter cannot clump at all (Tegmark 1997) — which is why this universe’s outcome is “no stable orbits / no stable atoms”. Planets are discs rather than spheres and there is no spherical surface; the view and the numbers below are schematic.',
    '）：力 ∝ r^{−(D−1)}，': '): the force goes as r^{−(D−1)}, ',
    '没有稳定的闭合轨道': 'so there are no stable closed orbits',
    '轨道稳定但不闭合（进动）': 'so orbits are stable but not closed — they precess',
    '，本引擎不为 D≠3 生成行星与球面地表——只画到恒星系这一层，画面上的亮点是试探质点而不是行星，不能进入。':
      '. This engine does not generate planets or spherical surfaces for D≠3, so the view stops at the star-system level; the bright dots are test particles rather than planets, and cannot be entered.',
    '，下面的画面是 2 维几何下的示意渲染，物理量仍按 3 维公式外推；引擎判据在 D≤2 没有牛顿吸引（物质无法聚集），这些圆盘与轨道是推测，不是结论。':
      '. The view below is a schematic rendering in 2D geometry and the physical quantities are still extrapolated from the 3D formulas; the engine’s own test gives no Newtonian attraction at D≤2 (matter cannot clump), so these discs and orbits are conjecture, not a conclusion.',
    '：没有稳定轨道，': ': no stable orbits, ',
    '：轨道稳定但不闭合（进动），': ': orbits are stable but precess rather than close, ',
    '本引擎不为这个维数生成行星与球面地表，这里只演示引力律；这些是试探质点，不是行星，没有可进入的星球。':
      'and this engine does not generate planets or spherical surfaces for this dimension, so all you see is the force law. These are test particles, not planets — there is no world to enter.',
    '轨道投影演示：': 'Orbit-projection demo: ',
    '这个维数没有稳定轨道': 'at this dimension there are no stable orbits',
    '这个维数的轨道稳定但不闭合（进动）': 'at this dimension orbits are stable but precess rather than close',
    '，本引擎也不为它生成球面地表，到恒星系为止 · 画面上的亮点是试探质点，不是行星，不能进入 · Backspace 返回 · [ ] 移动时间':
      ', and this engine does not generate spherical surfaces for it, so the view stops at the star system · the bright dots are test particles, not planets, and cannot be entered · Backspace to go back · [ ] to move through time',
    '试探质点（该维数下无稳定轨道，无行星可言，仅演示引力律的后果）':
      'Test particles (no stable orbits at this dimension, so no planets exist; this only shows what the force law implies)',
    '试探质点（本引擎不为 D≠3 生成行星，仅演示引力律的后果）':
      'Test particles (this engine generates no planets for D≠3; all this shows is what the force law implies)',
    '（本引擎不为 D≠3 生成行星：行星形成、恒星结构与地表公式都只对 3 维成立）':
      ' (this engine generates no planets for D≠3: planet formation, stellar structure and the surface formulas only hold in three dimensions)',
    '不给数': 'No number given',
    /* 受限维数（2d / orbitDemo）下每一层面板顶上的常驻说明 + 不再断言"行星已经诞生" */
    '：下面的光谱型、主序寿命、宜居带、轨道周期、卫星数全部由 3 维的恒星与行星模型生成（示意）；引擎对这个宇宙的结论是「':
      ': the spectral type, main-sequence lifetime, habitable zone, orbital periods and moon counts below all come from the 3-dimensional stellar and planetary models (schematic). The engine’s verdict on this universe is “',
    '没有牛顿吸引，物质无法聚集': 'no Newtonian attraction — matter cannot clump',
    '无稳定轨道 / 无稳定原子': 'no stable orbits, no stable atoms',
    '超出模型适用范围（D≠3）': 'beyond the model’s range (D≠3)',
    '」，这些数不是它真会长出来的东西。': '”, so these numbers are not things it would actually grow.',
    '已按 3 维模型生成行星（示意，不是这个维数下的结论）':
      'Planets generated from the 3-D model (schematic — not a conclusion about this dimension)',
    '：本引擎不为 D≠3 判定生命，这颗天体上不会有生物圈。': ': this engine makes no life call for D≠3, so this body carries no biosphere.',
    '：本引擎不为 D≠3 判定生命，地表是无机世界。': ': this engine makes no life call for D≠3, so the surface is an inorganic world.',
    '路径：宇宙网 → 星系 → 恒星系（这个维数到此为止）': 'Path: cosmic web → galaxy → star system (this dimension stops here)',
    '路径：宇宙网 → 星系 → 恒星系 → 行星 → 地表': 'Path: cosmic web → galaxy → star system → planet → surface',
    '　｜　“随机选一个星系”= 直接进入（右键菜单里有「只选中」），点列表里的一行 = 只选中，':
      ' · “Pick a random galaxy” = enter it straight away (the context menu has “select only”); clicking a row in the list only selects it, '
  }, 'mirror');

  /* ---- 动作条与右键菜单 ---- */
  I.add({
    '进入：': 'Enter: ',
    '进入选中的': 'Enter the selected ',
    '（快捷键 Enter；在画面上双击也是直接进入）': ' (shortcut: Enter; double-clicking in the view also enters directly)',
    '取消选择': 'Clear selection',
    '放弃这次选中，留在当前这一层': 'Drop this selection and stay on the current level',
    '返回上一级': 'Back one level',
    '返回上一级（': 'Back one level (',
    '← 返回上一处': '← back one step',
    '按你实际走过的路线退回上一个位置（跨层也管用，共 ': 'Retrace the route you actually took, back to the previous position (it works across levels; ',
    ' 步可退）· 快捷键 Alt+←': ' steps available) · shortcut: Alt+←',
    '定位银河系（观测目录）': 'Locate the Milky Way (observational catalog)',
    '按观测目录直接进入银河系（这一条是确定的目标，点了就进）': 'Go straight into the Milky Way from the observational catalog (a fixed target — one click and you are in)',
    '定位太阳（观测目录）': 'Locate the Sun (observational catalog)',
    '按观测目录直接进入太阳系（确定的目标，点了就进）': 'Go straight into the Solar System from the observational catalog (a fixed target — one click and you are in)',
    '定位地球（调出储存的坐标）': 'Locate Earth (stored coordinates)',
    '按储存的坐标直接进入地球（确定的目标，点了就进）': 'Go straight to Earth from the stored coordinates (a fixed target — one click and you are in)',
    '随机选一个星系': 'Pick a random galaxy',
    '在星系目录里随机挑一个：只选中并给出它的详细信息，不进入；再点一次换下一个':
      'Pick one at random from the galaxy catalog: it is selected and described, not entered; click again for the next one',
    '随机选一个恒星系': 'Pick a random star system',
    '在本星系的恒星系目录里随机挑一个：只选中，不进入；再点一次换下一个':
      'Pick one at random from this galaxy’s star-system catalog: selected only, not entered; click again for the next one',
    '随机挑一个恒星系：只选中，按 Enter / 点「进入」才换过去': 'Pick a star system at random: selected only — press Enter or click “Enter” to switch to it',
    '随机选一颗星球': 'Pick a random world',
    '在本恒星系里随机挑一颗行星并直接进入；再点一次换下一颗。想先看信息再决定，用右键菜单里的「只选中」':
      'Pick a random planet in this star system and enter it directly; click again for the next one. To look before deciding, use “select only” in the right-click menu',
    '在本恒星系里随机挑一颗行星：': 'Pick a random planet in this star system: ',
    '随机选一颗（换恒星系）': 'Pick a random world (another system)',
    '随机挑另一个恒星系的一颗星球：只选中，进入才会离开当前恒星系':
      'Pick a world in another star system: selected only — you leave this system only once you enter',
    '随机挑另一个恒星系的一颗星球；进入才会离开当前恒星系': 'Pick a world in another star system; you leave this system only once you enter',
    '随机选一个星系（目录外）': 'Pick a random galaxy (outside the catalog)',
    '“目录”是这次 N 体模拟在盒子里识别出来的晕（按质量排序），数量由盒长/粒子数/这组参数决定，不是这个宇宙星系数量的上限。这个按钮不走目录，按种子另取一个并直接进入':
      'The “catalog” is the set of halos this N-body run identified in the box (sorted by mass); how many there are follows from the box length, the particle count and this parameter set — it is not an upper bound on how many galaxies this universe has. This button ignores the catalog, draws another galaxy from the seed and enters it directly',
    '随机选一个恒星系（目录外）': 'Pick a random star system (outside the catalog)',
    '“目录”是按星系种子派生出的恒星系列表，只是一份可枚举的清单，不是这个星系恒星数量的上限。这个按钮不走目录，另取一个并直接进入':
      'The “catalog” is the list of star systems derived from the galaxy seed — an enumerable list, not an upper bound on how many stars this galaxy has. This button ignores the catalog, draws another one and enters it directly',
    '不走目录（目录 = N 体盒里识别出的晕，数量受分辨率限制，不是星系总数）；':
      'Ignores the catalog (the catalog = the halos identified in the N-body box, limited by resolution — not the total number of galaxies); ',
    '不走目录（目录只是按种子派生的一份清单，不是恒星系总数）；':
      'Ignores the catalog (which is only a list derived from the seed, not the total number of star systems); ',
    '← 上一个': '← previous',
    '下一个 →': 'next →',
    '← 上一个星系': '← previous galaxy',
    '下一个星系 →': 'next galaxy →',
    '上一个星系': 'Previous galaxy',
    '下一个星系': 'Next galaxy',
    '← 上一个恒星系': '← previous star system',
    '下一个恒星系 →': 'next star system →',
    '上一个恒星系': 'Previous star system',
    '下一个恒星系': 'Next star system',
    '← 上一颗': '← previous',
    '下一颗 →': 'next →',
    '上一颗星球': 'Previous world',
    '下一颗星球': 'Next world',
    '降低高度（滚轮）': 'Lower the altitude (scroll)',
    '降到这颗星球的地表（当前这颗，不用先选）': 'Descend to this world’s surface (the current one — no need to select it first)',
    '急剧下降（双击）': 'Dive (double-click)',
    '升高': 'Climb',
    '找一个': 'Find a ',
    '系统': ' system',
    /* 右键菜单的二级项「寻找指定天体 ▸」（specs/sim-ui-v1.md 之外的 09-17 追加）。
       子项去掉重复的「找一个…」前缀，只留天体本身；上面那些 STAGE_FIND.name 的词条不动，
       它们还在「找到了：…（红巨星 / 渐近巨星支，扫了 N 个恒星系）」那句提示里用着。 */
    '寻找指定天体': 'Find a specific object',
    '按恒星类型在本星系里搜，找到就飞过去': 'Searches this galaxy by star type and flies you there once it finds one',
    '白矮星系统': 'White dwarf system',
    '红巨星·渐近巨星支系统': 'Red giant / asymptotic giant branch system',
    '中子星系统': 'Neutron star system',
    '黑洞系统': 'Black hole system',
    '大质量主序星（≥2 M☉，A/B 型）系统': 'Massive main-sequence star system (≥2 M☉, type A/B)',
    '按种子扫描直到找到这一类宿主：它们真实存在但稀少（实测白矮星约 6.2%、红巨星约 0.14%、黑洞约 0.11%），随机点很难碰上':
      'Scan by seed until a host of this kind turns up. They do exist, but they are rare (measured: white dwarfs about 6.2%, red giants about 0.14%, black holes about 0.11%), so clicking at random seldom lands on one',
    '只选中并给出详细信息，按 Enter / 点「进入」才真的过去': 'Selects it and shows the details; press Enter or click “Enter” to actually go there',
    '直接换到本恒星系的另一颗（共 ': 'Switch straight to another planet in this star system (',
    ' 颗，到头循环）：按一下就换过去，不是只选中 · 快捷键 , / .': ' in total, wrapping around): one click switches, it does not merely select · shortcut: , / .',
    '在本恒星系内选另一颗（共 ': 'Pick another planet in this star system (',
    ' 颗，到头循环）；': ' in total, wrapping around); ',
    '这个恒星系只有一颗行星，没有别的可选': 'This star system has only one planet — there is nothing else to pick',
    '，到头循环：按一下就直接换过去，不是只选中 · 快捷键 PageUp / PageDown':
      ', wrapping around: one click switches straight away, it does not merely select · shortcut: PageUp / PageDown',
    '在本星系的恒星系目录里步进（共 ': 'Step through this galaxy’s star-system catalog (',
    ' 个，按星系种子派生，到头循环）：按一下就直接换过去，不是只选中 · 快捷键 PageUp / PageDown':
      ' in total, derived from the galaxy seed, wrapping around): one click switches straight away, it does not merely select · shortcut: PageUp / PageDown',
    '，到头循环；': ', wrapping around; ',
    '目录里只有一个星系': 'The catalog holds only one galaxy',
    '这个星系的目录里只有一个恒星系': 'This galaxy’s catalog holds only one star system',
    '正在过渡/定位，等这一段放完再操作': 'Transitioning / locating — wait for this to finish before doing anything else',
    '正在放大进入上一次选中的目标，等这段动画放完（约 1 秒）再点': 'Zooming into the previous selection — wait for the animation to finish (about 1 s) before clicking',
    '正在按观测目录定位，等这段检索走完再点': 'Locating from the observational catalog — wait for the lookup to finish before clicking',
    '正在生成星球表面…': 'Generating the planet surface…',
    '正在生成地表…': 'Generating the terrain…'
  }, 'mirror');

  /* ---- 提示与出错（note 条） ---- */
  I.add({
    '这个宇宙里没有可选的星系': 'There is no galaxy to pick in this universe',
    '还没有进入任何星系：先选一个星系进去': 'You have not entered a galaxy yet — pick one and go in first',
    '还没有进入任何星系：先在宇宙网层选一个星系': 'You have not entered a galaxy yet — pick one at the cosmic-web level first',
    '先进入一个星系再找': 'Enter a galaxy first, then search',
    '这个维数没有可进入的行星层': 'This dimension has no planet level to enter',
    '这个恒星系里没有行星': 'This star system has no planets',
    '随机到的恒星系里没有行星，再点一次换一个': 'The star system that came up has no planets — click again for another',
    '没有更早的位置了': 'There is no earlier position',
    '回不去了：': 'Could not go back: ',
    '还没有选中任何目标：先点「随机选一个…」，或用「← 上一个 / 下一个 →」挑一个':
      'Nothing is selected — click “Pick a random …”, or use “← previous / next →” to pick one',
    '这个恒星系没能生成：': 'This star system could not be generated: ',
    '这一步没能执行：': 'This step could not be carried out: ',
    '（详见控制台）': ' (see the console for details)',
    '扫了 ': 'Scanned ',
    ' 个恒星系也没找到': ' star systems without finding a ',
    '——这个宇宙的参数下它可能根本不出现': ' — with this universe’s parameters it may not occur at all',
    '找到了：': 'Found: ',
    '，扫了 ': ', scanned ',
    ' 个恒星系）': ' star systems)',
    '已选中：': 'Selected: ',
    '（Enter 进入）': ' (Enter to go in)',
    ' 在这个时刻还没有形成': ' has not formed yet at this moment',
    '它形成于距今 ': 'It forms ',
    ' 亿年；把时间轴拖到那之后，或点“时间轴回到现在”': ' ×10⁸ yr ago — drag the timeline past that point, or click “Timeline back to now”',
    '行星尚未形成': 'The planet has not formed yet'
  }, 'mirror');

  /* ---- 信息面板：字段名与状态 ---- */
  I.add({
    '名称': 'Name',
    '类型': 'Type',
    '形态': 'Morphology',
    '质量': 'Mass',
    '半径': 'Radius',
    '直径': 'Diameter',
    '轨道': 'Orbit',
    '轨道半径': 'Orbital radius',
    '周期': 'Period',
    '光谱型': 'Spectral type',
    '形成': 'Formed',
    '状态': 'State',
    '此刻': 'Right now',
    '时刻': 'Time',
    '高度': 'Altitude',
    '高度 ': 'Altitude ',
    '坐标': 'Coordinates',
    '所在': 'Located in',
    '距盒心': 'From box centre',
    '宏观维数': 'Macroscopic dimension',
    '参数': 'Parameter',
    '值': 'Value',
    '单位': 'Unit',
    '报告': 'Report',
    /* 「　依据：」的分隔用的是全角空格；英文里没有这个字符，改成全站通行的中点。 */
    '　依据：': ' · basis: ',
    '已经形成': 'already formed',
    '尚未形成': 'not formed yet',
    '尚未形成——只有正在坍缩的气体': 'not formed yet — only collapsing gas',
    '还只有原行星盘（行星没有诞生）': 'still only a protoplanetary disc (no planets born yet)',
    '行星已经诞生': 'the planets have been born',
    '以漆黑的太空为背景，一个银色大旋涡': 'a great silver whirlpool against pitch-black space',
    '光球周围环绕着一个雾蒙蒙的大环：行星还没有诞生，这个星际尘埃构成的环就是它们的原材料':
      'a hazy ring circles the photosphere: the planets have not been born yet, and this ring of interstellar dust is the raw material for them',
    '行星已经诞生。这是真实尺度的图象，不是天象演示': 'the planets have been born. This is a true-scale picture, not a planetarium show',
    '有生命': 'life',
    '有生物圈': 'Has a biosphere',
    '无分子化学：这颗行星上不会有生命。': 'No molecular chemistry: there can be no life on this planet.',
    '无分子化学：这颗行星上不会有生命，地表是无机世界。': 'No molecular chemistry: there can be no life on this planet — the surface is an inorganic world.',
    '行星尚未形成——只有尘埃与碎块。': 'The planet has not formed yet — only dust and debris.',
    '进入之后还会给出行星参数、派生量与完整报告（engine/planet.js）。':
      'Once you enter, you also get the planet parameters, the derived quantities and the full report (engine/planet.js).',
    '宜居性：': 'Habitability: ',
    '不给数（': 'no number given (',
    '维数不为 3': 'the dimension is not 3',
    '行星参数（输入）': 'Planet parameters (input)',
    '派生量（真算 / 标度 / 启发式）': 'Derived quantities (computed / scaling / heuristic)',
    '数值': 'computed',
    '示意': 'schematic',
    '画面：过程生成的可视化（示意）': 'Image: procedurally generated (schematic)',
    '地形、云、海面、灯光都是按种子过程生成的可视化，不是观测影像；只有太阳系的轨道与天体尺度用了真实数值。':
      'Terrain, clouds, seas and lights are all procedurally generated from the seed — not observed imagery. Only the Solar System’s orbits and body sizes use real values.',
    '数据：行星引擎计算（点开看每项依据）': 'Data: computed by the planet engine (open it for the basis of each item)',
    '下面的每一个数字都由 engine/planet.js 从输入参数算出：真算给公式、标度给定标关系、启发式给判据。点这里展开「行星参数」「派生量」两个折叠区。':
      'Every number below is computed by engine/planet.js from the input parameters: computed values come with a formula, scaling values with a calibration relation, heuristics with their criterion. Click here to open the “Planet parameters” and “Derived quantities” sections.',
    /* 选中卡片与计数 */
    '已选中的': 'Selected ',
    ' · 还没进入': ' · not entered yet',
    '这个候选的详细信息没能渲染（详见控制台），但仍然可以进入。':
      'The details of this candidate could not be rendered (see the console), but you can still enter it.',
    '按 Enter 或点「进入：': 'Press Enter or click “Enter: ',
    '」才会': '” to ',
    '换过去': 'switch to it',
    '下潜': 'descend',
    '；再点一次「随机选一个…」可以换一个候选。': '. Click “Pick a random …” again for a different candidate.',
    '目录外自选': 'custom, outside the catalog',
    '选中 ': 'selected ',
    '自选': 'custom',
    '（另一个恒星系）': ' (another star system)',
    ' · 另一个恒星系': ' · another star system',
    ' · 当前第 ': ' · currently #',
    ' · 已选中第 ': ' · selected #',
    ' 个（未进入）': ' (not entered)',
    ' · 当前这个不在目录里（双击自选）': ' · this one is not in the catalog (picked by double-click)',
    '单击选中（只看信息）· 双击直接进入': 'Click to select (info only) · double-click to enter',
    '单击选中（只看信息）· 再点一次 / 双击直接进入': 'Click to select (info only) · click again or double-click to enter',
    /* 星系目录与来源 */
    '这一档没有 3D 晕表：列表由种子生成，质量与距离不适用。':
      'This setting has no 3D halo table: the list is generated from the seed, so mass and distance do not apply.',
    '本宇宙已识别 ': 'This universe has ',
    ' 个星系（N 体盒里找到的晕，按质量排序）': ' identified galaxies (halos found in the N-body box, sorted by mass)',
    '按种子生成的 ': '',
    ' 个星系（示意：这一档没有 3D 模拟的晕表可用，不是识别结果）':
      ' galaxies generated from the seed (schematic: this setting has no simulated 3D halo table, so these are not identification results)',
    '，另加观测目录里的银河系': ', plus the Milky Way from the observational catalog',
    '本星系群成员按 McConnachie 2012 目录放置（位置为观测值，形态为示意）。列表里单击一行 = 选中，双击 = 直接进入；画面上双击任意处也直接进入该处星系。':
      'Local Group members are placed from the McConnachie 2012 catalog (positions are observed values, morphology is schematic). In the list, one click selects a row and a double-click enters it; double-clicking anywhere in the view also enters the galaxy there.',
    '列表里单击一行 = 选中（只看信息），双击 = 直接进入；画面上双击任意处也直接进入该处星系。这个宇宙里的星系、恒星与行星都由创世参数决定。':
      'In the list, one click selects a row (info only) and a double-click enters it; double-clicking anywhere in the view also enters the galaxy there. Every galaxy, star and planet in this universe follows from the creation parameters.',
    '银河系：S(B)bc，盘直径约 30 kpc；太阳距银心 8.178 kpc（GRAVITY 2019）。双击旋臂任意处直接进入该处恒星系，或用“随机选一个恒星系”先选中再决定。':
      'Milky Way: S(B)bc, disc diameter about 30 kpc; the Sun sits 8.178 kpc from the Galactic centre (GRAVITY 2019). Double-click anywhere on a spiral arm to enter the star system there, or use “Pick a random star system” to select one first.',
    '双击旋臂任意处直接进入该处恒星系，或用“随机选一个恒星系”先选中再决定。':
      'Double-click anywhere on a spiral arm to enter the star system there, or use “Pick a random star system” to select one first.',
    /* 观测目录定位日志 */
    '按 McConnachie 2012（AJ 144, 4）目录放置本星系群成员。': 'Local Group members placed from the McConnachie 2012 (AJ 144, 4) catalog.',
    '仙女座星系 M31 距离 783 kpc；大麦哲伦云 51 kpc、小麦哲伦云 64 kpc（同目录）。':
      'The Andromeda Galaxy M31 at 783 kpc; the Large Magellanic Cloud at 51 kpc and the Small Magellanic Cloud at 64 kpc (same catalog).',
    '银河系：S(B)bc，盘直径约 30 kpc（Bland-Hawthorn & Gerhard 2016）。': 'Milky Way: S(B)bc, disc diameter about 30 kpc (Bland-Hawthorn & Gerhard 2016).',
    '赤经赤纬 → 银道坐标：位置为观测值，形态为示意渲染。':
      'Right ascension and declination → galactic coordinates: the positions are observed values, the morphology is a schematic rendering.',
    '已按目录定位银河系。': 'The Milky Way has been located from the catalog.',
    '太阳距银心 8.178 kpc（GRAVITY Collab. 2019, A&A 625, L10），位于猎户臂内缘。':
      'The Sun is 8.178 kpc from the Galactic centre (GRAVITY Collab. 2019, A&A 625, L10), on the inner edge of the Orion Arm.',
    '恒星位置取自 HYG v4.1 星表；旋臂形态为示意渲染。': 'Stellar positions are taken from the HYG v4.1 catalog; the spiral-arm shape is a schematic rendering.'
  }, 'mirror');

  /* ---- 卫星、恒星演化与恒星系里的其它天体 ---- */
  I.add({
    '卫星与环': 'Moons and rings',
    ' 卫': ' moons',
    ' · 环': ' · rings',
    ' · 有环系': ' · has a ring system',
    '潮汐加热': 'tidally heated',
    '潮汐加热的 ': 'The ',
    ' 颗：冰壳下可能有液态水海洋（木卫二/土卫二类比，示意）。':
      ' tidally heated ones may hold liquid-water oceans under their ice shells (by analogy with Europa and Enceladus; schematic). ',
    '恒星演化': 'Stellar evolution',
    '演化阶段': 'Evolutionary stage',
    '前身质量': 'Progenitor mass',
    '遗迹质量': 'Remnant mass',
    '主序寿命': 'Main-sequence lifetime',
    '年龄': 'Age',
    '脉冲星': 'Pulsar',
    '是': 'yes',
    '变星：': 'Variable star: ',
    ' · 周期 ': ' · period ',
    ' · 无周期（爆发型）': ' · no period (eruptive)',
    ' · 振幅 ': ' · amplitude ',
    '星子带': 'Planetesimal belts',
    '彗星': 'Comets',
    '长周期彗星约每世纪 ': 'About ',
    ' 颗 · 奥尔特云约 ': ' long-period comets per century · Oort cloud at about ',
    '盘': 'Disc',
    '此刻在 ': 'Right now, within ',
    ' 光年内有 ': ' ly there are ',
    ' 颗（不属于这个恒星系，只是路过）': ' of them (not part of this star system — just passing through)',
    ' · 半径 ': ' · radius '
  }, 'mirror');

  /* ---- 地表纪元（EPOCH_TEXT）
     显示时代码切了两刀：'：' 前半截进「此刻」，去掉结尾「示意。」的整句进正文，
     所以两种形态都要有词条。年代按等值换算，数字没变。 ---- */
  I.add({
    '冥古宙（约 46–40 亿年前）': 'Hadean (about 4.6–4.0 billion years ago)',
    '太古宙（约 40–25 亿年前）': 'Archean (about 4.0–2.5 billion years ago)',
    '元古宙（约 25–5.4 亿年前）': 'Proterozoic (about 2.5 billion to 540 million years ago)',
    '显生宙（约 5.4 亿年前至今）': 'Phanerozoic (about 540 million years ago to today)',
    '第四纪（约 30 万年前起）': 'Quaternary (from about 300,000 years ago)',
    '全新世晚期（约 1 万年前起）': 'Late Holocene (from about 10,000 years ago)',
    '气态巨行星': 'Gas giant',
    '岩质表面': 'Rocky surface',
    '冥古宙（约 46–40 亿年前）：地表尚未固结，岩浆洋与高频撞击（依据：月球撞击记录与地球早期热演化）。':
      'Hadean (about 4.6–4.0 billion years ago): the surface has not solidified — magma oceans and frequent impacts (basis: the lunar impact record and Earth’s early thermal evolution).',
    '太古宙（约 40–25 亿年前）：还原性大气，海洋已存在，出现最早的微生物与叠层石（依据：Nutman 2016；Schopf 1993）。':
      'Archean (about 4.0–2.5 billion years ago): a reducing atmosphere, oceans already present, and the first microbes and stromatolites appear (basis: Nutman 2016; Schopf 1993).',
    '元古宙（约 25–5.4 亿年前）：大氧化事件后大气与海水含氧上升，陆核长大（依据：Lyons 2014）。':
      'Proterozoic (about 2.5 billion to 540 million years ago): after the Great Oxidation Event the oxygen content of air and seawater rises, and the continental cores grow (basis: Lyons 2014).',
    '显生宙（约 5.4 亿年前至今）：植物登陆，超大陆裂解（依据：Kenrick & Crane 1997；板块重建）。':
      'Phanerozoic (about 540 million years ago to today): plants colonise the land and the supercontinent breaks up (basis: Kenrick & Crane 1997; plate reconstructions).',
    '第四纪（约 30 万年前起）：解剖学意义上的现代人出现（依据：Hublin 2017，Jebel Irhoud）。':
      'Quaternary (from about 300,000 years ago): anatomically modern humans appear (basis: Hublin 2017, Jebel Irhoud).',
    '全新世晚期（约 1 万年前起）：农业与城市出现，夜面可见人工光源（依据：DMSP/VIIRS 夜间灯光观测）。':
      'Late Holocene (from about 10,000 years ago): agriculture and cities appear, and artificial lights are visible on the night side (basis: DMSP/VIIRS night-lights observations).',
    '气态巨行星：没有固体表面，只有分层的对流云带（依据：Juno 重力场测量）。':
      'Gas giant: no solid surface, only layered belts of convective cloud (basis: Juno gravity-field measurements).',
    '冰巨星：水／氨／甲烷冰幔外包氢氦大气，云顶约 50–70 K（依据：Voyager 2 掠过测量）。':
      'Ice giant: a water/ammonia/methane ice mantle wrapped in a hydrogen–helium atmosphere, with cloud tops at about 50–70 K (basis: Voyager 2 flyby measurements).',
    '岩质表面：撞击坑与风化碎屑，没有稳定的液态水（依据：类地行星地质对比）。':
      'Rocky surface: impact craters and weathered debris, with no stable liquid water (basis: comparison with the geology of the terrestrial planets).',
    '生物圈：原核生物与叠层石': 'Biosphere: prokaryotes and stromatolites',
    '生物圈：海洋中的光合生物': 'Biosphere: photosynthetic life in the oceans',
    '生物圈：出现会制造工具的物种': 'Biosphere: a tool-making species has appeared',
    '生物圈：夜面出现人工光源': 'Biosphere: artificial lights on the night side'
  }, 'mirror');

  /* ---- ui/adapter.js：状态标签、结局名与参数口径
     （标签与结局名由 ui/app.js 在显示时过 t()，这里只提供译文） ---- */
  I.add({
    '公认': 'Accepted',
    '公认事实 · 无生成机制': 'Accepted fact · no mechanism',
    '主流模型 · 未证实': 'Mainstream model · unconfirmed',
    '推测': 'Speculative',
    ' 个公认基础参数': ' accepted base parameters',
    '我们的宇宙': 'Our universe',
    '（预期：': ' (expected: ',
    '空间湮灭，只剩时间': 'Space annihilated, only time left',
    '近空宇宙': 'Near-empty universe',
    '高维宇宙（不可观察）': 'High-dimensional universe (unobservable)',
    '分数维宇宙': 'Fractional-dimension universe',
    '无稳定轨道的宇宙': 'Universe with no stable orbits',
    '液体大洋宇宙': 'Liquid-ocean universe',
    '异质定律的宇宙': 'Universe with alien laws',
    '黑洞宇宙': 'Black-hole universe',
    '大挤压': 'Big Crunch',
    '大撕裂': 'Big Rip',
    '热寂——无结构的宇宙': 'Heat death — a universe without structure',
    '基本粒子汤宇宙': 'Soup-of-particles universe',
    '黑暗的宇宙': 'Dark universe',
    '无化学的恒星宇宙': 'Universe with stars but no chemistry',
    '有化学无生命': 'Chemistry but no life',
    '可能诞生观察者': 'Observers possible'
  }, 'mirror');

  /* ---- ui/about-content.js：「关于与来源」面板
     长篇说明，一段对一段。两条红线：
       1. 论文、作者、期刊、目录名、DOI、arXiv 号原样保留，不翻译也不音译；
       2. "这是模型给出的" 与 "这是公认事实" 是两种不同的断言，译文里不能互相串味
          —— accepted / accepted-fact, no-mechanism / mainstream-model / speculative 四档照搬原文的口径。 ---- */
  I.add({
    '给宇宙一组初始条件，从奇点开始把它算一遍，看这样的宇宙会长成什么样，再决定它能不能生出会问这个问题的人。':
      'Give a universe a set of initial conditions, compute it forward from the singularity, watch what such a universe grows into — and then decide whether it could ever produce someone to ask the question.',
    'README.md 开头与 §一': 'README.md, opening and §1',
    '一个参数都不编造': 'Not one parameter is invented',
    "默认输入是 21 个物理学界普遍接受的基本参数（标准模型 + ΛCDM + 观测量，PDG 2022 / Planck 2018），每一项都带 status:'accepted' 与文献出处 ref。空间维数 D=3 标注为 accepted-fact, no-mechanism——它是事实，但现有物理里没有推导它的机制。":
      "The default inputs are 21 fundamental parameters that physics broadly accepts (Standard Model + ΛCDM + observations, PDG 2022 / Planck 2018); every one of them carries status:'accepted' and a literature ref. The spatial dimension D=3 is tagged accepted-fact, no-mechanism — it is a fact, but current physics has no mechanism that derives it.",
    '推测性模块显式标记': 'Speculative modules are labelled as such',
    '弦气维数、弦论景观标 speculative，慢滚暴胀标 mainstream-model；UI 里是显式开关。':
      'String-gas dimensionality and the string landscape are tagged speculative; slow-roll inflation is tagged mainstream-model. In the UI each one is an explicit switch.',
    '维数默认由弦气模型（推测）生成': 'By default the dimension comes out of the (speculative) string-gas model',
    '维数默认由弦气模型（推测）生成，而不是直接输入 D：空间维数是 18 个维的解开度之和 D=Σs_i，由 T₀/T_H、n_w、κ 三个参数决定。每一维的解开度量化成"蜷缩 0 / 半开 0.5 / 全开 1"三档，因此 D 只会取整数或整数+0.5（不会出现 3.1749 这种数），范围 0–18。可在参数编辑器里关闭弦气模块，改为直接输入 D（直接输入时范围是 1–11）。这一项标 speculative，请按推测看待。':
      'By default the dimension is produced by the (speculative) string-gas model rather than entered as D directly: the spatial dimension is the sum of how far 18 dimensions have unwound, D=Σs_i, fixed by three parameters — T₀/T_H, n_w and κ. Each dimension\'s unwinding is quantised into three states (curled 0 / half-open 0.5 / open 1), so D only ever takes an integer or an integer plus a half (never something like 3.1749), over the range 0–18. You can switch the string-gas module off in the parameter editor and enter D directly instead (the direct-input range is 1–11). This item is tagged speculative; treat it as conjecture.',
    '每条结论都标注依据等级': 'Every conclusion states the level of its basis',
    '演化层每一步给出 {公式, 输入, 数值, 阈值, 判定}，并标 basis。':
      'Each step of the evolution layer reports {formula, inputs, value, threshold, verdict}, tagged with its basis.',
    '镜像里的星球与地表是过程生成的示意，不是模拟结果': 'The worlds and surfaces in the mirror are procedurally generated illustrations, not simulation results',
    '星系、恒星系、行星地表由参数 + 种子确定性生成，画面上会标"示意"。3D 视图里，PM N 体那一层标"模拟"，星系与地表那一层标"示意"，本星系群与百光年内亮星那一层标"数据"。':
      'Galaxies, star systems and planetary surfaces are generated deterministically from the parameters plus a seed, and the view labels them "schematic". In the 3D view the PM N-body layer is labelled "simulated", the galaxy and surface layers "schematic", and the Local Group together with the bright stars within a hundred light-years "data".',
    '模拟给出的是"像我们的宇宙"，不可能复现我们这一个宇宙': 'What the simulation gives is "a universe like ours"; reproducing this particular universe is impossible',
    '相同参数一定得到相同结果（决定论：参数哈希即随机种子），但那是同一套统计规律下的另一次实现，不是我们这一个宇宙的历史。':
      'The same parameters always give the same result (determinism: the parameter hash is the random seed), but that is another realisation under the same statistical laws — not the history of our own universe.',
    '界面与文案致敬刘慈欣《镜子》的"创世游戏 / 镜像"体验。小说只提供界面与文案的参考，不提供物理；物理部分全部是真实计算，参数取物理学界公认的测量值。':
      'The interface and its wording are an homage to the "creation game / mirror" experience in Liu Cixin’s Mirror. The novel is a reference for the interface and the wording only, never for the physics: everything physical here is really computed, from measured values that physics accepts.',
    '有量纲常数（光速 c、引力常数 G、普朗克常数 ħ、电子电量 e）在不同宇宙里可以给出数值，但数值取决于单位约定：固定哪三个量、让哪两个随 α 与 α_G 变，是约定不是物理。分析面板可在约定 A（固定 e、ħ、m_p）/ B（固定 c、e、m_p）/ C（固定 c、ħ、m_p）之间切换，同一个宇宙会得到不同的 c、G、ħ、e。跨宇宙真正不变的物理内容是无量纲量 α=e²/(4πε₀ħc) 与 α_G=Gm_p²/(ħc)（Duff 2002；Albrecht & Magueijo 1999）。':
      'Dimensional constants (the speed of light c, the gravitational constant G, the Planck constant ħ, the electron charge e) can be given numerical values in another universe, but those values depend on the choice of units: which three quantities you hold fixed, and which two you let vary with α and α_G, is a convention rather than physics. The analysis panel switches between convention A (fix e, ħ, m_p), B (fix c, e, m_p) and C (fix c, ħ, m_p), and one and the same universe then comes out with different values of c, G, ħ and e. What is genuinely invariant across universes is the dimensionless content: α=e²/(4πε₀ħc) and α_G=Gm_p²/(ħc) (Duff 2002; Albrecht & Magueijo 1999).',
    /* 标签图例 */
    '参数与结论的可信度（status）': 'How much confidence a parameter or a conclusion carries (status)',
    'README.md §一 1–2；engine/README.md §8 状态总表': 'README.md §1.1–1.2; engine/README.md §8, the status table',
    'accepted：物理学界普遍接受的测量值（PDG 2022 / Planck 2018 等），在现有物理里就是"测量而非推导"的量。':
      'accepted: a measured value that physics broadly accepts (PDG 2022 / Planck 2018 and the like) — in current physics these are quantities you measure rather than derive.',
    'accepted-fact, no-mechanism：是事实，但现有物理里没有推导它的机制——空间维数 D=3 属于这一类。':
      'accepted-fact, no-mechanism: it is a fact, but current physics has no mechanism that derives it — the spatial dimension D=3 belongs here.',
    'mainstream-model：主流理论模型，公式是真计算，但模型本身尚未被证实——慢滚暴胀属于这一类。':
      'mainstream-model: a mainstream theoretical model; the formulas really are computed, but the model itself has not been confirmed — slow-roll inflation belongs here.',
    'speculative：推测性模块；引文只支持定性机制，定量式是本引擎的玩具延伸——弦气维数（默认开、可关）、弦论景观（默认关）属于这一类。':
      'speculative: a speculative module; the cited work supports the qualitative mechanism only, and the quantitative formula is this engine’s toy extension — string-gas dimensionality (on by default, can be switched off) and the string landscape (off by default) belong here.',
    '每一步计算的依据等级（basis）': 'The basis level of every computed step (basis)',
    'engine/README.md §0、§4、§5': 'engine/README.md §0, §4, §5',
    '计算': 'computed',
    'computed：直接数值计算得到。': 'computed: obtained directly by numerical calculation.',
    '标度关系': 'scaling',
    'scaling：标度关系 / 量纲估计，只用比值，不保证绝对口径。':
      'scaling: a scaling relation or dimensional estimate — only the ratio is used, the absolute normalisation is not guaranteed.',
    '启发式': 'heuristic',
    'heuristic：启发式判据（文献给出的经验窗口）。': 'heuristic: a heuristic criterion (an empirical window taken from the literature).',
    '玩具': 'toy',
    'toy：玩具模型（推测性模块开启后才会出现）。': 'toy: a toy model (it shows up only once a speculative module is switched on).',
    '画面这一层是什么（顶部标注）': 'What this layer of the view is (the label at the top)',
    'README.md §一 4': 'README.md §1.4',
    '模拟': 'simulated',
    'PM N 体那一层：真实引力 + Friedmann 背景的数值模拟。': 'The PM N-body layer: a numerical simulation with real gravity on a Friedmann background.',
    '星系、恒星系、行星、地表那一层：由参数 + 种子过程生成的可视化，不是模拟结果。':
      'The galaxy, star-system, planet and surface layers: visualisations generated procedurally from the parameters plus a seed — not simulation results.',
    '数据': 'data',
    '本星系群与百光年内亮星那一层：来自公开观测目录（见下方数据来源）。':
      'The Local Group and the bright stars within a hundred light-years: taken from public observational catalogs (see the data sources below).',
    /* 数据来源表 */
    'research/data/SOURCES.md（生成脚本 tools/fetch-localdata.js、tools/fetch-cities.js）':
      'research/data/SOURCES.md (generator scripts tools/fetch-localdata.js, tools/fetch-cities.js)',
    'ui/localdata.js 里的每一个数值都来自下列公开目录或已发表文献，目录中缺失的字段一律写 null，不做任何估计或补全。':
      'Every number in ui/localdata.js comes from one of the public catalogs or published papers below. Any field missing from a catalog is written as null — nothing is estimated, nothing is filled in.',
    '百光年内亮星（636 条，其中有专名的 140 条）': 'Bright stars within a hundred light-years (636 entries, 140 of them with proper names)',
    '本星系群成员（74 条）与银河系形态类型 S(B)bc': 'Local Group members (74 entries) and the Milky Way’s morphological type S(B)bc',
    'CDS / VizieR 使用条款': 'CDS / VizieR terms of use',
    'VizieR J/AJ/144/4/catalog（论文 tables 1–5 合并表），doi:10.26093/cds/vizier.51440004':
      'VizieR J/AJ/144/4/catalog (tables 1–5 of the paper, merged), doi:10.26093/cds/vizier.51440004',
    '室女座星系团方向与距离（16.5 ± 0.1(ran) ± 1.1(sys) Mpc）': 'Direction and distance of the Virgo Cluster (16.5 ± 0.1(ran) ± 1.1(sys) Mpc)',
    'CDS / SIMBAD 使用条款': 'CDS / SIMBAD terms of use',
    '地球夜面灯光与地表附近的示意建筑（3089 条，pop_max ≥ 100000）':
      'Night-side lights on Earth and the schematic buildings near the surface (3089 entries, pop_max ≥ 100000)',
    '公有领域（Free for any use, no permission required）': 'Public domain (free for any use, no permission required)',
    'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com；城市位置为真实数据，建筑为示意':
      'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com; the city positions are real data, the buildings are schematic',
    '太阳距银心 R₀ = 8.178 kpc（8178 ± 13(stat) ± 22(sys) pc）': 'Distance from the Sun to the Galactic centre, R₀ = 8.178 kpc (8178 ± 13(stat) ± 22(sys) pc)',
    '已发表文献': 'Published paper',
    '银河系盘标长、厚盘标高、棒半长、恒星质量、位力质量、Sgr A* 质量':
      'Milky Way disc scale length, thick-disc scale height, bar half-length, stellar mass, virial mass, and the mass of Sgr A*',
    'arXiv:1602.07702；恒星盘至今没有观测到的截断半径，故 diskRadius_kpc 写 null':
      'arXiv:1602.07702; no truncation radius of the stellar disc has been observed to date, so diskRadius_kpc is written as null',
    '太阳距银道面高度 z = 20.8 ± 0.3 pc': 'Height of the Sun above the Galactic plane, z = 20.8 ± 0.3 pc',
    '太阳所在旋臂：猎户臂（本地臂）': 'The spiral arm the Sun sits in: the Orion Arm (Local Arm)',
    '赤道坐标 → 银道坐标换算（IAU 1958 银道系常量）': 'Conversion from equatorial to galactic coordinates (IAU 1958 galactic constants)',
    '北银极 (192.85948°, +27.12825°)，北天极银经 122.93192°':
      'North galactic pole (192.85948°, +27.12825°); galactic longitude of the north celestial pole 122.93192°',
    '中文星名与本星系群条目的中文名均为通用译名（中国星官名或习惯译名），不属于目录字段；目录里没有对应习惯译名的条目写 null。':
      'The Chinese star names, and the Chinese names of the Local Group entries, are the conventional renderings (traditional Chinese asterism names or customary translations). They are not catalog fields, and entries with no customary rendering are written as null.',
    /* 参数出处 */
    'engine/README.md §2（20 个基础参数，全部 accepted）': 'engine/README.md §2 (20 base parameters, all accepted)',
    /* 只有中文标点、没有中文词的几行：只把标点换成英文，数字与符号原样 */
    'SIMBAD（M 87）+ Mei et al. 2007':
      'SIMBAD (M 87) + Mei et al. 2007',
    'hygdata_v41.csv（Hipparcos + Yale Bright Star Catalog + Gliese），astronexus/HYG-Database':
      'hygdata_v41.csv (Hipparcos + Yale Bright Star Catalog + Gliese), astronexus/HYG-Database',
    'Mei et al. 2007, ApJ 655, 144（ACS Virgo Cluster Survey XIII）':
      'Mei et al. 2007, ApJ 655, 144 (ACS Virgo Cluster Survey XIII)',
    'αₛ(M_Z)=0.1179、v=246.22 GeV、m_H=125.25 GeV、mₑ=0.51099895 MeV、m_u=2.16 MeV、m_d=4.67 MeV、δ_CKM=1.196、τ_n=878.4 s、G_F=1.1663788×10⁻⁵ GeV⁻²':
      'αₛ(M_Z)=0.1179, v=246.22 GeV, m_H=125.25 GeV, mₑ=0.51099895 MeV, m_u=2.16 MeV, m_d=4.67 MeV, δ_CKM=1.196, τ_n=878.4 s, G_F=1.1663788×10⁻⁵ GeV⁻²',
    'H₀=67.4 km/s/Mpc、Ω_bh²=0.02237、Ω_ch²=0.1200、Ω_Λ=0.685、A_s=2.1×10⁻⁹、n_s=0.965、Ω_k=0（+BAO：0.0007±0.0019）':
      'H₀=67.4 km/s/Mpc, Ω_bh²=0.02237, Ω_ch²=0.1200, Ω_Λ=0.685, A_s=2.1×10⁻⁹, n_s=0.965, Ω_k=0 (+BAO: 0.0007±0.0019)',
    'T_CMB = 2.7255 K（FIRAS）':
      'T_CMB = 2.7255 K (FIRAS)',
    'N_gen = 3（N_ν = 2.984 ± 0.008）':
      'N_gen = 3 (N_ν = 2.984 ± 0.008)',
    'N_eff = 3.044（标准三代中微子）': 'N_eff = 3.044 (three standard neutrino species)',
    '空间维数 D = 3，标 accepted-fact, no-mechanism（Ehrenfest/Tegmark 判据）':
      'Spatial dimension D = 3, tagged accepted-fact, no-mechanism (the Ehrenfest/Tegmark criterion)',
    /* 诚实清单 */
    'engine/README.md §9 什么没有被模拟（诚实清单）': 'engine/README.md §9, what is not modelled (the honesty list)',
    '传递函数是幂律 + 有效谱指数近似；σ(M) 用一个星系尺度校准点外推；坍缩用 Press–Schechter 的 νσ=δ_c。':
      'The transfer function is a power law plus an effective spectral-index approximation; σ(M) is extrapolated from a single galaxy-scale calibration point; collapse uses Press–Schechter with νσ=δ_c.',
    '复合用 Saha 平衡近似（Peebles 非平衡解把去耦推到 z≈1090）。':
      'Recombination uses the Saha equilibrium approximation (the Peebles non-equilibrium solution pushes decoupling out to z≈1090).',
    'BBN 用 Steigman 拟合 + n/p 比值修正，不是核反应网络；氘核/双质子阈值是文献标度估计。':
      'BBN uses the Steigman fit plus an n/p ratio correction, not a nuclear reaction network; the deuteron and diproton thresholds are scaling estimates from the literature.',
    'Λ_QCD 用一环 n_f=5 口径（≈87 MeV），非 PDG Λ_MS-bar，只用其比值；m_p、α_G、mₑ/mₚ、m_n−m_p 均为标度关系。':
      'Λ_QCD uses the one-loop n_f=5 convention (≈87 MeV) rather than the PDG Λ_MS-bar, and only its ratio is used; m_p, α_G, mₑ/mₚ and m_n−m_p are all scaling relations.',
    '恒星用 Adams 2008 的量纲标度，没有恒星结构方程。': 'Stars use the dimensional scalings of Adams 2008; there are no stellar structure equations.',
    '弦气维数（默认开、可关）、弦论景观（默认关）是玩具模型（speculative）：引文只支持定性机制，定量式为本引擎玩具延伸；慢滚公式为真计算但模型未证实。':
      'String-gas dimensionality (on by default, can be switched off) and the string landscape (off by default) are toy models (speculative): the cited work supports the qualitative mechanism only, and the quantitative formula is this engine’s toy extension. The slow-roll formulas really are computed, but the model is unconfirmed.',
    '行星地表、生命出现是过程生成的示意：只比较时间尺度、宜居带、重元素供给与 Tegmark–Rees 的 Q 窗口。':
      'Planetary surfaces and the appearance of life are procedurally generated illustrations: all that is actually compared are the time scales, the habitable zone, the supply of heavy elements, and the Tegmark–Rees Q window.',
    'N 体是 2D 周期盒 PM 引力，只用于可视化结构形成的相对快慢与团块度。':
      'The N-body part is PM gravity in a 2D periodic box, used only to visualise how fast structure forms and how clumpy it gets.',
    /* 键盘 / 操作速查 */
    '起爆参数页': 'Detonation parameter page',
    '在下拉目录里移动': 'Move through the drop-down catalog',
    'Enter / 空格': 'Enter / Space',
    '选中这一行创世参数': 'Select this row of creation parameters',
    '关闭下拉目录 / 参数编辑器': 'Close the drop-down catalog / the parameter editor',
    '下拉目录': 'Drop-down catalog',
    '只列"我保存的"（编号 #0001 起）；引擎自带的示例参数组在"参数编辑器 → 加载示例参数组（不入目录）"里，加载后可改再引爆，不占编号':
      'Lists only "my saved" sets (numbered from #0001). The engine’s own example sets live under "Parameter editor → Load an example set (not added to the catalog)"; load one, edit it, detonate it — it takes no number.',
    '引爆动画': 'Detonation animation',
    '跳过动画；稳定演化阶段按 Enter 或点击进入宇宙': 'Skip the animation; in the steady-evolution phase, press Enter or click to enter the universe',
    '退回起爆页': 'Back to the detonation page',
    '进入宇宙（3D）': 'Inside the universe (3D)',
    '移动（Shift 加速 · Ctrl 减速）': 'Move (Shift to speed up · Ctrl to slow down)',
    '右键拖拽': 'Right-drag',
    '转向；右键单击 = 弹出菜单（分析面板是第一项）': 'Turn; right-click = context menu (the analysis panel is the first item)',
    '滚轮': 'Scroll wheel',
    '调速度（Ctrl + 滚轮改视场角）': 'Adjust speed (Ctrl + scroll changes the field of view)',
    '飞到最密处 / 飞入随机晕': 'Fly to the densest spot / into a random halo',
    '空格': 'Space',
    '播放 / 暂停宇宙时间': 'Play / pause cosmic time',
    '分析面板（长按 A = 相机左平移）': 'Analysis panel (hold A = pan the camera left)',
    '进入镜像（仅 D=3 且可能诞生观察者时）': 'Enter the mirror (only when D=3 and observers are possible)',
    '随机引爆（分析面板打开时）': 'Detonate at random (while the analysis panel is open)',
    '镜像浏览': 'Mirror browsing',
    '双击': 'Double-click',
    '放大进入下一层（星系 → 恒星系 → 行星 → 地表）': 'Zoom into the next level (galaxy → star system → planet → surface)',
    '前后移动时间': 'Move backwards and forwards in time',
    '行星/地表层 = 高度（向下滚动降低）': 'Planet and surface levels = altitude (scroll down to descend)',
    '方向键': 'Arrow keys',
    '地表层平移视点': 'Pan the viewpoint on the surface level',
    '任何时候': 'Any time',
    '关闭当前面板': 'Close the current panel',
    '页脚"深色/浅色"': 'The "dark/light" link in the footer',
    '切换主题（记住选择，默认跟随系统）': 'Switch the theme (remembers your choice; follows the system by default)'
  }, 'mirror');

  /* ================================================================
   * 引擎运行时叙事 + 3D 层（2026-08-21 运行时字符串英文化）
   * ----------------------------------------------------------------
   * 这一册收两类此前没进 i18n 的运行时字符串：
   *   1. engine/engine.js 在运行时拼出来的句子（时间线、结论、发现、常数核对）。
   *      引擎一个字不改——这里只做**显示层**翻译。带插值的句子存「中文模板 →
   *      英文模板」，模板用 {0}/{1} 标插值点；加载时把中文模板编译成锚定正则，
   *      显示层拿整句实例来匹配（ui/app.js 的 TE() → MirrorI18n.tx()）。
   *      **翻模板不翻实例**：引擎改句式时改这里的模板即可。
   *   2. ui/universe3d.js 的 HUD / WebGPU 诊断 / 状态行（T() 走 'app' 命名空间，
   *      词条收在下面；动态拼接的经 tx() 走模板）。
   * 槽位转换器：
   *   {n}    原样通过（数字、科学计数、符号）
   *   {n:t}  引擎 formatTime / adapter fmtTimeGyr 的中文时间串 → 规范英文
   *          （312 年→312 yr；38 万年→380 kyr；138 亿年→13.8 Gyr；10¹⁰⁰ 年→10¹⁰⁰ yr）
   *   {n:cn} 中文数词 → 阿拉伯数字（三点五→3.5；一千八百三十六→1836）
   *   {n:w}  词槽：先查本册 WORD 表，再落词典（是/否、结局里的短语）
   *   {n:lw} 同 :w，但首字母小写（句中用）
   *   {n:s}  递归翻译（槽里还是一句可翻的话）
   *   {n:l}  顿号列表：按「、」拆开逐项翻，再用 ", " 连回
   *   {n:el} 元素表：'无' → 'none'，其余（H C N O…）原样
   * 命名空间统一用 'app'：ui/app.js 与 ui/universe3d.js 的 T() 都查它。
   * ================================================================ */

  /* ---- 时间线（engine buildTimeline / adapter 回退时间线）：事件名与静态描述 ---- */
  I.add({
    '奇点': 'Singularity',
    '暴胀结束': 'End of inflation',
    '夸克禁闭为强子': 'Quarks confine into hadrons',
    '大爆炸核合成': 'Big Bang nucleosynthesis',
    '物质-辐射相等': 'Matter–radiation equality',
    '复合 · 微波背景释放': 'Recombination · CMB released',
    '黑暗时代': 'Dark ages',
    '第一代恒星': 'First stars',
    '参照点 a=1（我们的今天）': 'Reference point a=1 (our today)',
    '恒星纪元结束': 'End of the stellar era',
    '黑洞蒸发': 'Black-hole evaporation',
    '热寂': 'Heat death',
    '空间湮灭': 'Space annihilated',
    '没有大小，没有结构，时间从这里开始': 'No size, no structure — time begins here',
    '没有暴胀阶段': 'No inflationary phase',
    'T≈2×10¹² K，质子与中子出现': 'T≈2×10¹² K; protons and neutrons appear',
    '质子衰变，只剩中子': 'Protons decay; only neutrons remain',
    '氘核不束缚，核合成卡在氘瓶颈': 'The deuteron is unbound; nucleosynthesis stalls at the deuterium bottleneck',
    '没有物质时代': 'No matter era',
    '没有稳定原子，宇宙从未变得透明': 'No stable atoms — the universe never became transparent',
    '没有任何光源，只有冷却的背景辐射': 'No light sources at all, only the cooling background radiation',
    '没有黑暗时代': 'No dark ages',
    '结构从未形成': 'Structure never formed',
    '团块直接坍缩为黑洞': 'Clumps collapse directly into black holes',
    '恒星无法点燃': 'Stars cannot ignite',
    '涨落被冻结在线性阶段': 'Fluctuations are frozen in the linear stage',
    '尺度因子与我们的宇宙今天相同': 'The scale factor matches our universe today',
    '从未膨胀到这一尺度': 'Never expands to this scale',
    '最小质量的恒星也烧尽（t ∝ α²·M^{−2.5}），只剩白矮星、中子星与黑洞':
      'Even the lowest-mass stars burn out (t ∝ α²·M^{−2.5}); only white dwarfs, neutron stars and black holes remain',
    '没有恒星纪元': 'No stellar era',
    '霍金辐射带走最后一点信息': 'Hawking radiation carries away the last bit of information',
    '永恒膨胀，温度趋于德西特温度': 'Eternal expansion; the temperature approaches the de Sitter temperature',
    '宇宙已终结，不会发生': 'The universe has already ended — this never happens',
    '核聚变点燃': 'Nuclear fusion ignites',
    '宇宙变得透明': 'The universe becomes transparent',
    '暗物质晕聚集气体': 'Dark-matter halos gather gas',
  }, 'app');

  /* ---- 结局名（engine OUTCOMES.name，核心表没收全的几条） ---- */
  I.add({
    '没有原子的宇宙': 'A universe without atoms',
    '无化学的宇宙': 'A universe without chemistry',
    '没有恒星的宇宙': 'A universe without stars',
    '无碳-水型生物化学的宇宙': 'A universe without carbon–water biochemistry',
    '超出模型适用范围（D≠3，按 3 维公式外推）': "Beyond the model's range (D≠3; 3-D formulas extrapolated)",
    '无碳-水型化学': 'No carbon–water chemistry',
    '这是我们的宇宙': 'This is our universe'
  }, 'app');

  /* ---- 发现（findings）标题 ---- */
  I.add({
    '空间维数的涌现（弦气玩具模型）': 'Emergence of the spatial dimension (string-gas toy model)',
    '空间维数（直接输入）': 'Spatial dimension (entered directly)',
    '空间维数与轨道/原子稳定性': 'Spatial dimension and orbit/atom stability',
    'D≠3 的演化未做维数修正': 'Evolution at D≠3 has no dimensional correction',
    '分数维（数学练习，推测）': 'Fractional dimension (a mathematical exercise; speculative)',
    'CP 破坏与重子生成': 'CP violation and baryogenesis',
    '重子密度为零': 'Zero baryon density',
    '膨胀史（Friedmann）': 'Expansion history (Friedmann)',
    '几何自洽提示': 'Geometric consistency note',
    '复合（Saha）': 'Recombination (Saha)',
    '复合红移（Saha 近似）': 'Recombination redshift (Saha approximation)',
    '中子-质子质量差': 'Neutron–proton mass difference',
    '原初氦丰度': 'Primordial helium abundance',
    '线性增长因子与 σ₈ 等价量': 'Linear growth factor and σ₈ equivalent',
    '星系尺度坍缩红移（Press–Schechter）': 'Galaxy-scale collapse redshift (Press–Schechter)',
    'Weinberg 上界': 'Weinberg bound',
    '原初黑洞（Carr 阈值）': 'Primordial black holes (Carr threshold)',
    'Q 的宜居窗口': 'Habitable window in Q',
    '中微子自由流动': 'Neutrino free streaming',
    '没有冷暗物质': 'No cold dark matter',
    '恒星质量窗口': 'Stellar mass window',
    '恒星能否点燃核燃烧': 'Can stars ignite nuclear burning',
    '主序寿命': 'Main-sequence lifetime',
    '稳定原子核的上限': 'Upper limit of stable nuclei',
    '重元素散布（超新星）': 'Heavy-element dispersal (supernovae)',
    '原子稳定性（Bohr / Dirac）': 'Atomic stability (Bohr / Dirac)',
    '分子刚性（Born–Oppenheimer）': 'Molecular rigidity (Born–Oppenheimer)',
    '化学是否可行': 'Is chemistry possible',
    '行星与宜居带': 'Planets and the habitable zone',
    '时间尺度：恒星寿命 vs 生物演化': 'Time scales: stellar lifetime vs biological evolution',
    '三氦过程与 Hoyle 共振（碳/氧产率）': 'Triple-alpha process and the Hoyle resonance (C/O yields)',
    '液态水温度窗口': 'Liquid-water temperature window',
    '复杂化学的可能性': 'Feasibility of complex chemistry',
    '碳-水型生物化学': 'Carbon–water biochemistry',
    '替代生化（硅基 / 非水溶剂）的推测倾向': 'Speculative tendency towards alternative biochemistry (silicon / non-aqueous solvents)',
    /* R_OCEAN（engine.js calcOcean，依据等级 heuristic）。只说物理，不提出处 */
    '冷液体宇宙（弥散的液态物质）': 'Cold liquid universe (diffuse liquid matter)'
  }, 'app');

  /* ---- 发现：静态的 text / valueText / threshold（整句逐字命中） ---- */
  I.add({
    /* R_OCEAN：四条判据全过时的整句（无数值，可逐字命中）与阈值 */
    '四条全 ✓（塌缩时标/年龄 > 1、无恒星、有原子与分子、温度在液态窗口内）':
      'All four ✓ (collapse time / age > 1, no stars, atoms and molecules present, temperature inside the liquid window)',
    '冷液体宇宙：引力太弱以致气体不塌缩、没有恒星，但分子在液态温区内——物质以液滴/液膜形态弥散（启发式；画面为示意，物理判定见本条）。三条近似写在这里：引擎的 Friedmann 层由 Ω 参数化，G 在 ρ_crit 里被约掉，膨胀史不随 α_G 变，本条只让 α_G 进入自引力一侧；塌缩时标取宇宙平均重子密度，不计暗物质晕内的增密；液态还需要足够的压强才能真正凝聚，本条不计算凝聚判据。结局判定不受本条影响。':
      'Cold liquid universe: gravity is too weak for the gas to collapse and no star ignites, yet molecules sit inside their liquid temperature range — matter is spread out as droplets and films (heuristic; the picture is indicative, the physics test is this entry). Three approximations, stated here: the engine parameterises its Friedmann layer by the Ω values, so G cancels out of ρ_crit and the expansion history does not follow α_G — this entry lets α_G act only on the self-gravity side; the collapse time is taken at the mean cosmic baryon density, ignoring the enhancement inside dark-matter haloes; and a real liquid also needs enough pressure to condense, which this entry does not compute. The outcome verdict is unaffected by this entry.',
    /* 维数 */
    '9 个空间维初始都蜷缩；缠绕弦与反缠绕弦相遇湮灭的维才能解开膨胀':
      'All 9 spatial dimensions start out curled up; only dimensions where winding and anti-winding strings meet and annihilate can unwind and expand',
    '弦气太冷/缠绕太密，连一维都没有解开': 'The string gas is too cold or the windings too dense — not even one dimension unwound',
    '恰好解开三维': 'Exactly three dimensions unwound',
    '（真实物理没有公认机制，这是弦气图景的玩具实现。）':
      '(Real physics has no accepted mechanism — this is a toy realisation of the string-gas picture.)',
    'ε>1+w 解开；<1−w 蜷缩；带内部分解开（分数维）':
      'ε>1+w unwinds; <1−w stays curled; inside the band it partially unwinds (fractional dimension)',
    'D 作为观测事实直接输入（无公认生成机制）': 'D is entered directly as an observed fact (no accepted generating mechanism)',
    'D=3：力 ∝ 1/r²，束缚轨道稳定且闭合（Bertrand 定理），氢原子有基态':
      "D=3: force ∝ 1/r², bound orbits are stable and closed (Bertrand's theorem), and hydrogen has a ground state",
    '后续演化按 D=3 的标度计算，未做 D≠3 修正（basis: scaling）':
      'Subsequent evolution uses the D=3 scalings, with no D≠3 correction (basis: scaling)',
    '后续演化按 D=3 的标度计算，未做 D≠3 修正': 'Subsequent evolution uses the D=3 scalings, with no D≠3 correction',
    'D<4 且 D>2；D=3 闭合轨道': 'D<4 and D>2; closed orbits at D=3',
    '力 F ∝ r^{−(D−1)}；圆轨道径向稳定 ⇔ D<4；氢原子哈密顿量有下界 ⇔ D<4（势 r^{−(D−2)} 弱于 r⁻²）；牛顿吸引 ⇔ D>2；3<D<4 轨道稳定但不闭合（进动）':
      'Force F ∝ r^{−(D−1)}; circular orbits radially stable ⇔ D<4; hydrogen Hamiltonian bounded below ⇔ D<4 (potential r^{−(D−2)} weaker than r⁻²); Newtonian attraction ⇔ D>2; for 3<D<4 orbits are stable but do not close (precession)',
    'D 非整数（弦气模块：有维度处于阈值带 |ε−1|<w 内部分解开；直接输入非整数 D 亦然）：力律 r^{−(D−1)} 与判据按 D 连续插值':
      'Non-integer D (string-gas module: some dimension sits inside the threshold band |ε−1|<w, partially unwound; likewise for a directly entered non-integer D): the force law r^{−(D−1)} and the criteria interpolate continuously in D',
    'D 非整数': 'Non-integer D',
    /* 重子生成 */
    'Sakharov 条件之一：CP 破坏': 'One of the Sakharov conditions: CP violation',
    '标准模型内 CP 破坏 ∝ J = Im(V_ud V_cs V_us* V_cd*) ∝ sin δ_CKM，且需 N_gen ≥ 3':
      'Within the Standard Model, CP violation ∝ J = Im(V_ud V_cs V_us* V_cd*) ∝ sin δ_CKM, and N_gen ≥ 3 is required',
    '无 CP 破坏': 'No CP violation',
    'δ_CKM ≥ 0.05 rad 且 N_gen ≥ 3': 'δ_CKM ≥ 0.05 rad and N_gen ≥ 3',
    '有 CP 破坏来源，重子生成可以进行（标准模型 CKM 相位本身不足以解释观测的 η，此处假定与之同比例的额外来源）':
      'A source of CP violation exists, so baryogenesis can proceed (the Standard Model CKM phase alone cannot explain the observed η; an extra source proportional to it is assumed here)',
    'δ_CKM≈0：没有 CP 破坏（且假定无其它来源），物质与反物质对称湮灭，只剩光子与暗物质':
      'δ_CKM≈0: no CP violation (and no other source is assumed), so matter and antimatter annihilate symmetrically, leaving only photons and dark matter',
    '没有重子物质，只有暗物质与辐射': 'No baryonic matter — only dark matter and radiation',
    /* 膨胀史 / 复合 */
    'H²/H0² = Ω_r a⁻⁴ + Ω_m a⁻³ + Ω_k a⁻² + Ω_Λ；Ω_r = Ω_γ(1+0.2271 N_eff)，Ω_γh² = 2.47×10⁻⁵(T_CMB/2.7255 K)⁴；RK4 积分 a(t)':
      'H²/H0² = Ω_r a⁻⁴ + Ω_m a⁻³ + Ω_k a⁻² + Ω_Λ; Ω_r = Ω_γ(1+0.2271 N_eff), Ω_γh² = 2.47×10⁻⁵(T_CMB/2.7255 K)⁴; RK4 integration of a(t)',
    '从未膨胀到 a=1': 'Never expands to a=1',
    '在到达 a=1 之前就转向坍缩': 'Turns around and collapses before reaching a=1',
    '永恒膨胀，最终进入德西特相': 'Eternal expansion, eventually entering a de Sitter phase',
    '永恒膨胀，渐近减速': 'Eternal expansion, asymptotically decelerating',
    '无物质': 'No matter',
    'Ω_m=0：没有物质时代': 'Ω_m=0: no matter era',
    '若要几何自洽可令 Ω_k=1−Ω_m−Ω_Λ': 'For geometric consistency, set Ω_k=1−Ω_m−Ω_Λ',
    'Saha：x²/(1−x) = (mₑT/2π)^{3/2} e^{−B/T} / n_b': 'Saha: x²/(1−x) = (mₑT/2π)^{3/2} e^{−B/T} / n_b',
    '无重子，无复合': 'No baryons, no recombination',
    '没有重子，谈不上复合': 'Without baryons there is nothing to recombine',
    'x_e²/(1−x_e) = (mₑT/2π)^{3/2} e^{−B/T} / n_b，B = 13.6 eV·(α/α₀)²·(mₑ/mₑ₀)，n_b = η n_γ，η₁₀ = 273.9 Ω_b h²(2.7255/T_CMB)³；复合取 x_e=0.5，去耦取 x_e=0.01（Saha 平衡近似；Peebles 非平衡解给 z*≈1090）':
      'x_e²/(1−x_e) = (mₑT/2π)^{3/2} e^{−B/T} / n_b, B = 13.6 eV·(α/α₀)²·(mₑ/mₑ₀), n_b = η n_γ, η₁₀ = 273.9 Ω_b h²(2.7255/T_CMB)³; recombination at x_e=0.5, decoupling at x_e=0.01 (Saha equilibrium approximation; the Peebles non-equilibrium solution gives z*≈1090)',
    '在 0.02–200 eV 内无解': 'No solution within 0.02–200 eV',
    '我们：z_rec≈1380（Saha）、z*≈1090': 'Ours: z_rec≈1380 (Saha), z*≈1090',
    '复合温度落在求解窗口之外': 'The recombination temperature falls outside the solution window',
    /* BBN */
    '氢稳定需 Δ > mₑ': 'Hydrogen stability requires Δ > mₑ',
    'Δ = 1.293 + 2.52·[(m_d−m_u)/2.51 − 1] − 1.00·[α/α₀ − 1] MeV（BMW 2015 格点分解：QCD 项 2.52、QED 项 −1.00，线性化于观测值）':
      'Δ = 1.293 + 2.52·[(m_d−m_u)/2.51 − 1] − 1.00·[α/α₀ − 1] MeV (BMW 2015 lattice decomposition: QCD term 2.52, QED term −1.00, linearised about the observed values)',
    'Δ < −mₑ：质子比中子+电子还重，p→n e⁺ν 放能，质子衰变——没有氢，也没有任何原子核外的电子壳层':
      'Δ < −mₑ: the proton outweighs neutron+electron, p→n e⁺ν releases energy, and protons decay — no hydrogen, and no electron shells around any nucleus',
    '−mₑ < Δ < mₑ：p+e→n+ν 放能，氢原子被电子俘获吃掉；重核内的中子反而稳定':
      '−mₑ < Δ < mₑ: p+e→n+ν releases energy and hydrogen atoms are eaten by electron capture, while neutrons inside heavy nuclei are actually stable',
    '没有氢': 'No hydrogen',
    'B_d ≈ 2.22 MeV·[1+10(αₛ,nuc−1)]：阈值量级（核力弱 ~10% 解体）引自 Pochet 1991 / Hogan 2000，线性插值为本引擎近似；且需 m_n−m_p < B_d+mₑ，否则氘核内中子 β 衰变':
      "B_d ≈ 2.22 MeV·[1+10(αₛ,nuc−1)]: the threshold magnitude (the deuteron unbinds when the nuclear force weakens by ~10%) is from Pochet 1991 / Hogan 2000, with the linear interpolation as this engine's approximation; also requires m_n−m_p < B_d+mₑ, or the neutron inside the deuteron β-decays",
    'B_d > 0 且 Δ < B_d + mₑ': 'B_d > 0 and Δ < B_d + mₑ',
    '氘核不束缚：大爆炸核合成卡在氘瓶颈，恒星也无法通过 pp 链点燃':
      'The deuteron is unbound: Big Bang nucleosynthesis stalls at the deuterium bottleneck, and stars cannot ignite via the pp chain either',
    'B_pp ≈ 2.22 MeV·[10(αₛ,nuc−1)−1]：阈值量级（核力强 ~10% 束缚）引自 Barrow & Tipler 1986 / Bradford 2009，线性插值为本引擎近似':
      "B_pp ≈ 2.22 MeV·[10(αₛ,nuc−1)−1]: the threshold magnitude (the diproton binds when the nuclear force strengthens by ~10%) is from Barrow & Tipler 1986 / Bradford 2009, with the linear interpolation as this engine's approximation",
    'B_pp < 0（不束缚）': 'B_pp < 0 (unbound)',
    '双质子束缚：p+p→²He 无需弱作用，大爆炸核合成把氢几乎全部烧成氦（Y_p→1），没有氢、没有水':
      'The diproton is bound: p+p→²He needs no weak interaction, and Big Bang nucleosynthesis burns nearly all the hydrogen into helium (Y_p→1) — no hydrogen, no water',
    '双质子不束缚，pp 链受弱作用限制，氢得以保留':
      'The diproton is unbound; the pp chain is throttled by the weak interaction and hydrogen survives',
    'Y_p ≈ 0.2485 + 0.0016(η₁₀−6) + 0.013ΔN_eff（拟合，N_eff₀=3.044），再按 n/p = e^{−Δ/T_f}·e^{−t_BBN/τ_n} 相对标准值修正；T_f ∝ v^{4/3}，τ_n = 878.4 s·v⁴(1.293/Δ)⁵（瓶法/束法张力 ~10 s）':
      'Y_p ≈ 0.2485 + 0.0016(η₁₀−6) + 0.013ΔN_eff (a fit, N_eff₀=3.044), then corrected relative to the standard value by n/p = e^{−Δ/T_f}·e^{−t_BBN/τ_n}; T_f ∝ v^{4/3}, τ_n = 878.4 s·v⁴(1.293/Δ)⁵ (bottle/beam tension ~10 s)',
    '无重子，无核合成': 'No baryons, no nucleosynthesis',
    '我们：0.245': 'Ours: 0.245',
    /* 结构形成 */
    'δ̈+2Hδ̇ = (3/2)H0²Ω_m δ/a³ 从 a_eq 积分；σ(M,a) = σ_gal(a)·(M/10¹²M⊙)^{−(n_eff+3)/6}，n_eff = n_s−2.965；σ_gal ∝ Q=(2/5)√A_s（k=0.05）并含谱倾斜 e^{1.84(n_s−0.965)} 与中微子 √(1−8f_ν)；校准使默认 σ(10¹²,z=0)=1.9':
      'δ̈+2Hδ̇ = (3/2)H0²Ω_m δ/a³ integrated from a_eq; σ(M,a) = σ_gal(a)·(M/10¹²M⊙)^{−(n_eff+3)/6}, n_eff = n_s−2.965; σ_gal ∝ Q=(2/5)√A_s (k=0.05), including the spectral tilt e^{1.84(n_s−0.965)} and the neutrino factor √(1−8f_ν); calibrated so the default σ(10¹²,z=0)=1.9',
    'a=1 前已坍缩': 'Collapsed before a=1',
    '我们：σ₈=0.81': 'Ours: σ₈=0.81',
    '宇宙在到达 a=1 之前就已转向': 'The universe turned around before reaching a=1',
    'ν σ(M,a) ≥ δ_c=1.686；第一批天体取 3σ 峰、M=10⁸ M⊙；星系取 2σ、M=10¹² M⊙':
      'ν σ(M,a) ≥ δ_c=1.686; first objects taken as 3σ peaks with M=10⁸ M⊙; galaxies as 2σ with M=10¹² M⊙',
    'β ≳ 10⁻⁸ 时黑洞占主导（形成后 ∝a 增长）': 'For β ≳ 10⁻⁸ black holes dominate (growing ∝a after formation)',
    'Tegmark & Rees 1998：Q ≲ 10⁻⁶ 星系太稀无法冷却；Q ≳ 10⁻⁴ 星系太密、行星轨道被扰动；Q ≳ 10⁻³ 团块在冷却前坍缩为黑洞（束缚能 ~Q c²）':
      'Tegmark & Rees 1998: for Q ≲ 10⁻⁶ galaxies are too diffuse to cool; for Q ≳ 10⁻⁴ galaxies are too dense and planetary orbits get perturbed; for Q ≳ 10⁻³ clumps collapse into black holes before cooling (binding energy ~Q c²)',
    '星系过密：恒星密近交会频繁，行星系统难以长期稳定':
      'Galaxies too dense: close stellar encounters are frequent, and planetary systems cannot stay stable for long',
    '星系过稀：位力温度太低、气体难以冷却成恒星':
      'Galaxies too diffuse: the virial temperature is too low for gas to cool into stars',
    '落在 Tegmark–Rees 窗口内': 'Falls inside the Tegmark–Rees window',
    '重子涨落受 Silk 阻尼与光子拖曳，复合后才增长':
      'Baryon fluctuations suffer Silk damping and photon drag; they grow only after recombination',
    '幅度按 ½ 计': 'Amplitude counted as ½',
    '结构只能靠重子自身，形成推迟': 'Structure must rely on the baryons alone; formation is delayed',
    /* 恒星 */
    'Adams 2008：M_min、M_max ∝ M₀ = α_G^{−3/2}m_p（eq.1/35/39）':
      'Adams 2008: M_min and M_max ∝ M₀ = α_G^{−3/2}m_p (eq. 1/35/39)',
    'M_min、M_max 需为有限正数': 'M_min and M_max must be finite and positive',
    '这组参数使恒星质量标度 M₀=α_G^{−3/2}m_p 发散或非有限（多为 αₛ(M_Z) 极小导致 Λ_QCD 下溢、α_G→0）：Adams 2008 的标度关系在此不再适用，引擎不做外推，恒星一栏留空':
      'These parameters make the stellar mass scale M₀=α_G^{−3/2}m_p diverge or become non-finite (usually a tiny αₛ(M_Z) underflowing Λ_QCD, so α_G→0): the Adams 2008 scaling no longer applies, the engine does not extrapolate, and the stars section is left empty',
    'Adams 2008：两端都 ∝ M₀ = α_G^{−3/2}m_p（eq. 1）。M_min = 6(3π)^{1/2}(4/5)^{3/4}(m_p/m_ion)²(kT_nuc/mₑc²)^{3/4}·M₀（eq. 35，简并 vs 点火）；M_max = (18√5/π^{3/2})((1−f_g)/f_g⁴)^{1/2}(m_p/⟨m⟩)²·M₀ ≈ 56M₀（eq. 39，辐射压 f_g=½）。取 T_nuc ∝ α²m_p（Gamow）⇒ M_min/M_max ∝ (α/α₀)^{3/2}(mₑ/mₚ)^{−3/4}：窗口宽度由 α 与质量比控制，α_G 只整体平移。适用范围：牛顿论证；M_min ≳ 300 M⊙ 时未纳入 GR/对不稳定性':
      'Adams 2008: both ends ∝ M₀ = α_G^{−3/2}m_p (eq. 1). M_min = 6(3π)^{1/2}(4/5)^{3/4}(m_p/m_ion)²(kT_nuc/mₑc²)^{3/4}·M₀ (eq. 35, degeneracy vs ignition); M_max = (18√5/π^{3/2})((1−f_g)/f_g⁴)^{1/2}(m_p/⟨m⟩)²·M₀ ≈ 56M₀ (eq. 39, radiation pressure f_g=½). With T_nuc ∝ α²m_p (Gamow) ⇒ M_min/M_max ∝ (α/α₀)^{3/2}(mₑ/mₚ)^{−3/4}: the window width is set by α and the mass ratio, while α_G only shifts the whole scale. Range of validity: Newtonian arguments; for M_min ≳ 300 M⊙ GR and pair instability are not included',
    'M_min < M_max；且 M_min ≲ 300 M⊙ 时标度才可信为"主序恒星"':
      'M_min < M_max; and only for M_min ≲ 300 M⊙ can the scaling be trusted to describe "main-sequence stars"',
    '点火所需质量超过辐射压上限——没有稳定燃烧的恒星':
      'The mass needed for ignition exceeds the radiation-pressure limit — there are no stably burning stars',
    '这组参数下形成的致密天体更可能是直接坍缩黑洞而非稳定燃烧的主序恒星':
      'The compact objects formed under these parameters are more likely direct-collapse black holes than stably burning main-sequence stars',
    '若后续可居住性判断建立在此窗口上，结论仅供参考':
      'If the habitability judgement below rests on this window, treat the conclusion as indicative only',
    '点火下限已偏高（>10 M⊙），恒星稀少且寿命短': 'The ignition threshold is high (>10 M⊙): stars are rare and short-lived',
    '窗口宽度 M_max/M_min ∝ α^{−3/2}(mₑ/mₚ)^{3/4}，与 α_G 无关；α_G 只整体缩放质量标度 M₀':
      'The window width M_max/M_min ∝ α^{−3/2}(mₑ/mₚ)^{3/4} is independent of α_G; α_G only rescales the overall mass scale M₀',
    '需要：氘核束缚（pp 链）∧ M_min<M_max ∧ 有重子 ∧ Zα<1（库仑势垒可穿透）':
      'Requires: deuteron bound (pp chain) ∧ M_min<M_max ∧ baryons present ∧ Zα<1 (Coulomb barrier penetrable)',
    '标度上可点燃（但已越出 Adams 适用范围）': 'Ignites by the scaling (but beyond the Adams range)',
    '可以点燃': 'Can ignite',
    '无法点燃': 'Cannot ignite',
    '恒星可以通过 pp 链稳定燃烧': 'Stars can burn stably via the pp chain',
    '氘核不束缚，pp 链第一步走不通': 'The deuteron is unbound, so the first step of the pp chain fails',
    '点火质量超过上限': 'The ignition mass exceeds the upper limit',
    't_MS ≈ 10 Gyr·α_G⁻¹·(α/α₀)²·(mₑ/mₚ)^{−2}（t ∝ M/L，L ∝ M³/κ，κ_es ∝ α²/mₑ²）':
      't_MS ≈ 10 Gyr·α_G⁻¹·(α/α₀)²·(mₑ/mₚ)^{−2} (t ∝ M/L, L ∝ M³/κ, κ_es ∝ α²/mₑ²)',
    '生物演化需 ≳ 0.5 Gyr': 'Biological evolution needs ≳ 0.5 Gyr',
    '短于生物演化所需的数亿年': 'Shorter than the few hundred million years biological evolution needs',
    '碳 Z=6；铁 Z=26': 'Carbon Z=6; iron Z=26',
    '碳以上的原子核因库仑排斥瓦解，没有碳': 'Nuclei beyond carbon fall apart under Coulomb repulsion — no carbon',
    '铁以上的核不稳定，恒星核合成早早截止': 'Nuclei beyond iron are unstable; stellar nucleosynthesis cuts off early',
    '核坍缩超新星靠中微子加热；G_F ∝ v⁻²，v≳3 中微子截面过小、无法炸开':
      'Core-collapse supernovae rely on neutrino heating; G_F ∝ v⁻², and for v≳3 the neutrino cross-section is too small to blow the star apart',
    '超新星可以把重元素散布到星际空间': 'Supernovae can spread the heavy elements into interstellar space',
    '弱作用太弱，超新星哑火，重元素锁在恒星核心':
      'The weak interaction is too weak: supernovae fizzle and the heavy elements stay locked in stellar cores',
    /* 原子 / 化学 */
    'a₀ ∝ 1/(α mₑ)；Ry = 13.6 eV·(α/α₀)²(mₑ/mₑ₀)；Dirac 基态要求 Zα<1 ⇒ Z_max,atom = ⌊1/α⌋':
      'a₀ ∝ 1/(α mₑ); Ry = 13.6 eV·(α/α₀)²(mₑ/mₑ₀); the Dirac ground state requires Zα<1 ⇒ Z_max,atom = ⌊1/α⌋',
    'Z_max ≥ 2（有多电子原子）': 'Z_max ≥ 2 (multi-electron atoms exist)',
    '没有重子，没有原子': 'No baryons, no atoms',
    '质子衰变，没有原子核可供束缚电子': 'Protons decay; there are no nuclei left to bind electrons',
    '(mₑ/mₚ)^{1/4} 控制振动/电子能级分离；≳0.45 时分子失去固定形状':
      '(mₑ/mₚ)^{1/4} controls the vibrational/electronic level separation; above ≳0.45 molecules lose their fixed shape',
    '<0.45（我们 0.153）': '<0.45 (ours: 0.153)',
    '分子结构开始模糊': 'Molecular structure begins to blur',
    '分子有确定的几何结构': 'Molecules have definite geometric structure',
    '电子与原子核质量可比，分子没有固定形状，复杂化学不可能':
      'Electrons are comparable in mass to the nuclei; molecules have no fixed shape and complex chemistry is impossible',
    '需要：原子 ∧ 氢 ∧ 元素数 ≥ 6（碳）∧ 分子刚性 ∧ 轨道稳定':
      'Requires: atoms ∧ hydrogen ∧ element count ≥ 6 (carbon) ∧ molecular rigidity ∧ stable orbits',
    'Z_max ≥ 6 且有氢': 'Z_max ≥ 6 and hydrogen present',
    '有氢有碳，分子刚性足够：化学可以复杂化': 'Hydrogen and carbon exist and molecules are rigid enough: chemistry can grow complex',
    '没有氢（在 BBN 烧光），没有水': 'No hydrogen (burned away in BBN) — no water',
    '没有氢（氢原子不稳定），没有水': 'No hydrogen (the hydrogen atom is unstable) — no water',
    '没有重子': 'No baryons',
    '三氦过程产不出足够的碳/氧（Hoyle 共振越出容许区间）': 'The triple-alpha process cannot make enough carbon/oxygen (the Hoyle resonance is outside the allowed range)',
    '复杂化学受限': 'Complex chemistry is limited',
    '库仑能 ∝ Z²α/A^{1/3} vs 核结合 ∝ A ⇒ Z_max ≈ 92·(α₀/α)': 'Coulomb energy ∝ Z²α/A^{1/3} vs nuclear binding ∝ A ⇒ Z_max ≈ 92·(α₀/α)',
    'Albrecht & Magueijo 1999, PRD 59, 043516（变光速表述）；Duff 2002, hep-th/0208093（有量纲常数的"变化"只是单位约定）': 'Albrecht & Magueijo 1999, PRD 59, 043516 (varying-c formulation); Duff 2002, hep-th/0208093 (a "varying" dimensionful constant is only a unit convention)',
    'Duff 2002, hep-th/0208093；Bekenstein 1982（变电荷表述）': 'Duff 2002, hep-th/0208093; Bekenstein 1982 (varying-charge formulation)',
    '没有碳': 'No carbon',
    '分子没有刚性': 'Molecules have no rigidity',
    '轨道不稳定': 'orbits are unstable',
    /* 行星 / 宜居 */
    '行星质量上限 ∝ (α/α_G)^{3/2} mₚ（Weisskopf 1975）；宜居带 d_HZ = 1 AU·√(L/L⊙)；需要重元素被造出并散布':
      'Planet mass limit ∝ (α/α_G)^{3/2} mₚ (Weisskopf 1975); habitable zone d_HZ = 1 AU·√(L/L⊙); requires heavy elements to be made and dispersed',
    '缺少重元素或化学，难有岩石行星与海洋': 'Lacking heavy elements or chemistry, rocky planets and oceans are unlikely',
    't_MS ≥ 0.5 Gyr 且 星系形成到终结的窗口 ≥ 1 Gyr（地球：生命 ~0.5 Gyr，复杂生命 ~4 Gyr）':
      't_MS ≥ 0.5 Gyr, and a window from galaxy formation to the end ≥ 1 Gyr (Earth: life ~0.5 Gyr, complex life ~4 Gyr)',
    '≥ 0.5 Gyr / ≥ 1 Gyr': '≥ 0.5 Gyr / ≥ 1 Gyr',
    '有足够的时间让化学复杂化': 'There is enough time for chemistry to grow complex',
    '恒星寿命太短': 'Stellar lifetimes are too short',
    '宇宙在星系形成后不久就终结': 'The universe ends soon after galaxies form',
    /* 生物化学 */
    'ξ = (αₛ,nuc−1)/0.005 − (α/α₀−1)/0.04；f_C = 10^{−2·max(0,−ξ)}，f_O = 10^{−2·max(0,ξ)}——线性化自 Oberhummer et al. 2000（核力 ±0.5% / 电磁 ±4% ⇒ C 或 O 产率降 30–1000 倍）；Ekström et al. 2010 与 Epelbaum et al. 2013（夸克质量 ±2–3%）给出更宽区间；仅在 |Δαₛ|≲2%、|Δα|≲15% 内使用':
      'ξ = (αₛ,nuc−1)/0.005 − (α/α₀−1)/0.04; f_C = 10^{−2·max(0,−ξ)}, f_O = 10^{−2·max(0,ξ)} — linearised from Oberhummer et al. 2000 (±0.5% in the nuclear force / ±4% in electromagnetism ⇒ the C or O yield drops 30–1000×); Ekström et al. 2010 and Epelbaum et al. 2013 (quark masses ±2–3%) give wider ranges; used only within |Δαₛ|≲2%, |Δα|≲15%',
    'f_C ≥ 0.05 且 f_O ≥ 0.05': 'f_C ≥ 0.05 and f_O ≥ 0.05',
    '恒星无法点燃，谈不上三氦过程': 'Stars cannot ignite, so there is no triple-alpha process to speak of',
    'H₂O 键能与液态温区 ∝ Ry ∝ α²mₑ；行星平衡温度 T ∝ (L/d²)^{1/4} ⇒ 存在液态水的轨道 d_w = 1 AU·√(L/L⊙)·(α²mₑ/α₀²mₑ₀)^{−2}；需要 H、O（三氦过程产氧）与刚性分子':
      'H₂O bond energies and the liquid range ∝ Ry ∝ α²mₑ; planetary equilibrium temperature T ∝ (L/d²)^{1/4} ⇒ the orbit with liquid water d_w = 1 AU·√(L/L⊙)·(α²mₑ/α₀²mₑ₀)^{−2}; requires H, O (oxygen from the triple-alpha process) and rigid molecules',
    '某轨道处可有液态水：否': 'Liquid water possible on some orbit: no',
    '有 H、有 O、分子刚性、恒星点燃': 'H present, O present, rigid molecules, stars ignited',
    '没有氢，没有水': 'No hydrogen, no water',
    '没有氧（核不稳定或三氦过程不产氧），没有水': 'No oxygen (unstable nuclei, or a triple-alpha process that makes none) — no water',
    '分子没有刚性，谈不上液态水': 'Molecules have no rigidity, so liquid water is moot',
    '没有恒星加热行星': 'No star heats the planets',
    'α<0.1（化学能标/相对论修正）∧ (mₑ/mₚ)^{1/4}<0.45（分子刚性）∧ Z_max ≥ 16（C、N、O、Si、P、S 可用）∧ 有氢':
      'α<0.1 (chemical energy scale / relativistic corrections) ∧ (mₑ/mₚ)^{1/4}<0.45 (molecular rigidity) ∧ Z_max ≥ 16 (C, N, O, Si, P, S available) ∧ hydrogen present',
    'Z_max ≥ 16、α<0.1、分子刚性': 'Z_max ≥ 16, α<0.1, molecular rigidity',
    '碳、氮、氧、硅、磷、硫都可用，分子有刚性：复杂化学可行':
      'Carbon, nitrogen, oxygen, silicon, phosphorus and sulfur are all available and molecules are rigid: complex chemistry works',
    '分子无刚性': 'Molecules lack rigidity',
    'α≥0.1，化学能标与相对论修正过大': 'α≥0.1: chemical energy scales and relativistic corrections are too large',
    '原料（C、O 由三氦过程产出）∧ 溶剂窗口（液态水）∧ 复杂化学 ⇒ 可能':
      'Raw material (C and O from the triple-alpha process) ∧ solvent window (liquid water) ∧ complex chemistry ⇒ possible',
    '三项皆 ✓': 'All three ✓',
    '碳与氧由三氦过程产出（Hoyle 共振在容许区间内），液态水窗口存在，复杂化学可行 → 碳-水型生化可能':
      'Carbon and oxygen come from the triple-alpha process (the Hoyle resonance sits in the allowed range), a liquid-water window exists, and complex chemistry works → carbon–water biochemistry is possible',
    '碳受抑 + Si 可用 + （行星温度 >400 K 的轨道 或 液态氨/甲烷窗口）→ 倾向 低/中/高；无公认判据，仅为文献中的定性论证':
      'Carbon suppressed + Si available + (orbits hotter than 400 K, or a liquid ammonia/methane window) → tendency low/medium/high; no accepted criterion — qualitative arguments from the literature only',
    '无公认判据，仅为文献中的定性论证：Bains 讨论硅化学在高温/非水溶剂中的可能，NRC 2007 指出液态氨、甲烷等溶剂的化学可行性未被排除':
      'No accepted criterion — qualitative arguments from the literature only: Bains discusses the possibility of silicon chemistry at high temperatures and in non-aqueous solvents, and NRC 2007 notes that the chemical viability of solvents such as liquid ammonia and methane has not been ruled out',
    '不改变主结局': 'Does not change the main outcome'
  }, 'app');

  /* ---- 引文（ref）里带中文注脚的几条 ---- */
  I.add({
    'Barrow & Tipler 1986；Bradford 2009（争议：MacDonald & Mullan 2009 认为部分氢可存留）':
      'Barrow & Tipler 1986; Bradford 2009 (disputed: MacDonald & Mullan 2009 argue some hydrogen would survive)',
    'Peebles 1980；BBKS 1986（传递函数斜率）': 'Peebles 1980; BBKS 1986 (transfer-function slope)',
    'Agrawal et al. 1998；Harnik, Kribs & Perez 2006（弱作用缺席宇宙）':
      'Agrawal et al. 1998; Harnik, Kribs & Perez 2006 (the weakless universe)',
    'Bohr 1913；Dirac 1928；Greiner, Müller & Rafelski 1985（超临界场）':
      'Bohr 1913; Dirac 1928; Greiner, Müller & Rafelski 1985 (supercritical fields)',
    'Barrow & Tipler 1986；Barnes 2012, PASA 29, 529（综述）；Kasting, Whitmire & Reynolds 1993':
      'Barrow & Tipler 1986; Barnes 2012, PASA 29, 529 (review); Kasting, Whitmire & Reynolds 1993',
    'Bains 2004, Astrobiology 4, 137；Schulze-Makuch & Irwin 2008《Life in the Universe》；NRC 2007《The Limits of Organic Life in Planetary Systems》':
      'Bains 2004, Astrobiology 4, 137; Schulze-Makuch & Irwin 2008, Life in the Universe; NRC 2007, The Limits of Organic Life in Planetary Systems',
    'Durr et al. 2008（BMW，格点强子谱）': 'Durr et al. 2008 (BMW, lattice hadron spectrum)',
    'Polchinski 1998（机制）': 'Polchinski 1998 (mechanism)',
    'Candelas et al. 1985（背景）': 'Candelas et al. 1985 (background)',
    'Brandenberger & Vafa 1989（玩具延伸）': 'Brandenberger & Vafa 1989 (toy extension)',
    'Borsanyi et al. (BMW) 2015, Science 347, 1452；Gasser & Leutwyler 1982':
      'Borsanyi et al. (BMW) 2015, Science 347, 1452; Gasser & Leutwyler 1982'
  }, 'app');

  /* ---- 结论散文（engine describe()）：静态句（句号在显示层拆掉后逐句命中） ---- */
  I.add({
    '几乎没有空间维展开': 'Almost no spatial dimension unwound',
    'D≤2 时引力势为对数或排斥，没有牛顿吸引，物质无法聚集（Tegmark 1997）':
      'For D≤2 the gravitational potential is logarithmic or repulsive — no Newtonian attraction, so matter cannot clump (Tegmark 1997)',
    '非整数维按连续插值处理': 'Non-integer dimensions are handled by continuous interpolation',
    '没有行星系统，也没有化学，物质在坍缩与飞散之间摇摆':
      'No planetary systems and no chemistry; matter sways between collapse and dispersal',
    '演化链在这一步终止：后面的复合、核合成、结构、恒星都以 3+1 维公式为前提':
      'The evolutionary chain ends at this step: recombination, nucleosynthesis, structure and stars all presuppose the 3+1-dimensional formulas',
    '非整数维没有严格的物理定义，判据按连续插值':
      'Non-integer dimensions have no strict physical definition; the criteria interpolate continuously',
    '可居住性不给数；镜像与星球观测在此关闭':
      'No habitability number is given; the mirror and planet views are closed here',
    '结构还来不及形成就被压碎': 'Structure is crushed before it has time to form',
    '最后一刻，所有的光被压回一个点': 'At the last moment, all the light is squeezed back into a point',
    '气体始终均匀地稀释，没有星系、没有恒星，也没有观察者':
      'The gas just dilutes uniformly — no galaxies, no stars, and no observers',
    '温度随尺度因子单调下降，直到与德西特温度相当':
      'The temperature falls monotonically with the scale factor until it is comparable to the de Sitter temperature',
    '这个宇宙没有被谁看见过': 'No one ever saw this universe',
    '星光从未点燃': 'Starlight never ignited',
    '这是一个由视界与霍金辐射组成的宇宙，要到 10¹⁰⁰ 年之后才在蒸发中归于寂静':
      'This is a universe of horizons and Hawking radiation; only after 10¹⁰⁰ years does it evaporate into silence',
    'Ω_b=0：没有重子物质': 'Ω_b=0: no baryonic matter',
    '没有 CP 破坏，Sakharov 条件不满足：物质与反物质完全湮灭，只剩光子与暗物质':
      'No CP violation, so the Sakharov conditions fail: matter and antimatter annihilate completely, leaving only photons and dark matter',
    '物质停留在基本粒子或裸核层次，从未组装出原子':
      'Matter stays at the level of elementary particles or bare nuclei; atoms are never assembled',
    '它膨胀、冷却，暗物质照常聚成团块，但团块里什么也不发光，然后什么也不发生':
      'It expands and cools — dark matter still gathers into clumps, but nothing in them shines — and then nothing happens',
    '它膨胀、冷却，然后什么也不发生': 'It expands and cools, and then nothing happens',
    '气体云只能缓慢冷却、坍缩成致密天体，从不发光':
      'Gas clouds can only cool slowly and collapse into compact objects; they never shine',
    '这是一个黑暗的宇宙': 'This is a dark universe',
    '但氢原子被电子俘获吃掉了，没有可以复杂化的化学':
      'But hydrogen atoms are eaten by electron capture — there is no chemistry that can grow complex',
    '但电子与原子核质量可比，分子没有固定形状，没有可以复杂化的化学':
      'But electrons are as heavy as the nuclei and molecules have no fixed shape — there is no chemistry that can grow complex',
    '有行星，也许有海洋，也许有一些分子在拼凑，但没有人抬头看星空':
      'There are planets, perhaps oceans, perhaps some molecules assembling — but no one looks up at the stars',
    '但没有液态水窗口，碳-水型生化缺少溶剂':
      'But there is no liquid-water window, so carbon–water biochemistry lacks its solvent',
    '结构、恒星、化学与时间尺度都满足条件':
      'Structure, stars, chemistry and the time scales all meet the requirements',
    '它与我们的略有不同，但已经具备诞生观察者的全部前提':
      'It differs slightly from ours, but already has every prerequisite for observers'
  }, 'app');

  /* ---- 常数核对（engine constantsReport）与派生常数（第 1 层）名称 ---- */
  I.add({
    '精细结构常数': 'Fine-structure constant',
    '电子/质子质量比': 'Electron/proton mass ratio',
    '质子质量': 'Proton mass',
    '轻夸克质量': 'Light quark masses',
    '粒子代数': 'Particle generations',
    '密度': 'Densities',
    '原初涨落': 'Primordial fluctuations',
    '空间维数': 'Spatial dimension',
    '有量纲常数（单位约定）': 'Dimensionful constants (unit convention)',
    '辐射密度': 'Radiation density',
    '重子密度': 'Baryon density',
    '暗物质密度': 'Dark-matter density',
    '重子/光子比': 'Baryon-to-photon ratio',
    'QCD 标度（一环 n_f=5 口径）': 'QCD scale (one-loop n_f=5 convention)',
    '引力精细结构常数（相对）': 'Gravitational fine-structure constant (relative)',
    '电子/质子质量比（相对）': 'Electron/proton mass ratio (relative)',
    '核力强度（相对）': 'Nuclear force strength (relative)',
    '费米常数': 'Fermi constant',
    '希格斯自耦合': 'Higgs self-coupling',
    '视界尺度密度扰动': 'Horizon-scale density perturbation',
    '空间维数（涌现）': 'Spatial dimension (emergent)',
    '强耦合 αₛ(M_Z)': 'Strong coupling αₛ(M_Z)',
    '电子质量': 'Electron mass',
    '上夸克质量': 'Up-quark mass',
    '下夸克质量': 'Down-quark mass',
    '暗能量密度': 'Dark-energy density',
    '原初标量功率谱幅度': 'Primordial scalar power-spectrum amplitude',
    '谱指数': 'Spectral index',
    '曲率': 'Curvature',
    '光速（A 约定）': 'Speed of light (convention A)',
    '光速（B 约定）': 'Speed of light (convention B)',
    '光速（C 约定）': 'Speed of light (convention C)',
    '引力常数（A 约定）': 'Gravitational constant (convention A)',
    '引力常数（B 约定）': 'Gravitational constant (convention B)',
    '引力常数（C 约定）': 'Gravitational constant (convention C)',
    '约化普朗克常数（A 约定）': 'Reduced Planck constant (convention A)',
    '约化普朗克常数（B 约定）': 'Reduced Planck constant (convention B)',
    '约化普朗克常数（C 约定）': 'Reduced Planck constant (convention C)',
    '基本电荷（A 约定）': 'Elementary charge (convention A)',
    '基本电荷（B 约定）': 'Elementary charge (convention B)',
    '基本电荷（C 约定）': 'Elementary charge (convention C)',
    'G = α_G·ħc/m_p²（m_p 取我们的数值）': 'G = α_G·ħc/m_p² (m_p takes our value)',
    /* 派生常数的公式注脚 */
    'Λ = M_Z·e^{−2π/(b₀αₛ(M_Z))}，b₀=11−2n_f/3=23/3——固定 n_f=5 一环、无阈值匹配，非 PDG 的 Λ_MS-bar（≈210 MeV）；只用其比值 Λ/Λ₀':
      'Λ = M_Z·e^{−2π/(b₀αₛ(M_Z))}, b₀=11−2n_f/3=23/3 — one loop at fixed n_f=5, no threshold matching; not the PDG Λ_MS-bar (≈210 MeV); only the ratio Λ/Λ₀ is used',
    'm_p ≈ 938.27 MeV·(Λ_QCD/Λ_QCD₀)（手征极限 m_p ∝ Λ_QCD 的标度；忽略夸克质量修正 ~几 %）':
      'm_p ≈ 938.27 MeV·(Λ_QCD/Λ_QCD₀) (the chiral-limit scaling m_p ∝ Λ_QCD; quark-mass corrections of a few % ignored)',
    'α_G = G m_p²/ħc = (m_p/M_Pl)² = 5.9×10⁻³⁹·(m_p/938 MeV)²（m_p 由 Λ_QCD 标度）':
      'α_G = G m_p²/ħc = (m_p/M_Pl)² = 5.9×10⁻³⁹·(m_p/938 MeV)² (m_p scaled by Λ_QCD)',
    '(mₑ/0.51099895)/(m_p/938.272)（m_p 由 Λ_QCD 标度）':
      '(mₑ/0.51099895)/(m_p/938.272) (m_p scaled by Λ_QCD)',
    'm_π² ∝ (m_u+m_d)Λ_QCD（GMOR）；核力强度 ≈ 1 − ½ln(m_π²/m_π₀²)（π 越重射程越短；氘核在 +~10% 解体，双质子在 −~10% 束缚）':
      'm_π² ∝ (m_u+m_d)Λ_QCD (GMOR); nuclear force strength ≈ 1 − ½ln(m_π²/m_π₀²) (a heavier π means a shorter range; the deuteron unbinds at +~10%, the diproton binds at −~10%)',
    'Q ≈ (2/5)√A_s（物质时代 δ_H = 2R/5）': 'Q ≈ (2/5)√A_s (matter era δ_H = 2R/5)',
    'D = Σ s_i，ε_i = g_i·e^{6(T₀/T_H−0.98)}/n_w，s_i = smoothstep((ε_i−1+w)/2w)，w=0.4(1−κ)（饱和为 0/1，带内分数）——引文只支持"三维一般性解开"的定性机制，定量形式为本引擎玩具延伸':
      'D = Σ s_i, ε_i = g_i·e^{6(T₀/T_H−0.98)}/n_w, s_i = smoothstep((ε_i−1+w)/2w), w=0.4(1−κ) (saturating to 0/1, fractional inside the band) — the cited work supports only the qualitative mechanism of "three dimensions generically unwinding"; the quantitative form is this engine\'s toy extension',
    'ε_i = g_i·e^{6(T₀/T_H−0.98)}/n_w，g 为 18 级维序阶梯（前三级 3.0/2.0/1.06 钉住"默认参数→D=3"的锚点，其后按 e^{−0.14} 等比细分）；w=0.4(1−κ)；s_i=smoothstep((ε_i−1+w)/2w) 后量化到 {0, 0.5, 1}；D=Σs_i，因此 D 只取整数或整数+0.5——引文只支持"一维弦世界面在 ≤3+1 维一般性相交"的定性机制，定量形式为本引擎玩具延伸':
      'ε_i = g_i·e^{6(T₀/T_H−0.98)}/n_w, where g is an 18-level ladder of dimension order (the first three levels 3.0/2.0/1.06 pin the anchor "default parameters → D=3"; the rest subdivide geometrically by e^{−0.14}); w=0.4(1−κ); s_i=smoothstep((ε_i−1+w)/2w), then quantised to {0, 0.5, 1}; D=Σs_i, so D only takes integer or integer+0.5 values — the cited work supports only the qualitative mechanism of "one-dimensional string worldsheets generically intersecting in ≤3+1 dimensions"; the quantitative form is this engine\'s toy extension',
    'α = g_s/V（4 维规范耦合 1/g₄² ∝ V/g_s；引文只支持这一定性机制，刻度 α⁻¹=V/g_s 为本引擎玩具延伸）':
      'α = g_s/V (the 4-D gauge coupling 1/g₄² ∝ V/g_s; the citation supports only this qualitative mechanism — the normalisation α⁻¹=V/g_s is this engine\'s toy extension)',
    'αₛ(M_Z) = 0.1179·(α/α₀)（同一模量因子）': 'αₛ(M_Z) = 0.1179·(α/α₀) (same modulus factor)',
    'mₑ = 0.511 MeV·e^{7.8(φ₁−0.5)}（汤川由紧致几何决定为定性背景；指数形式为本引擎玩具延伸）':
      'mₑ = 0.511 MeV·e^{7.8(φ₁−0.5)} (Yukawas set by the compact geometry as qualitative background; the exponential form is this engine\'s toy extension)',
    'm_u = 2.16 MeV·e^{6(φ₂−0.5)}（玩具延伸）': 'm_u = 2.16 MeV·e^{6(φ₂−0.5)} (toy extension)',
    'm_d = 4.67 MeV·e^{6(φ₃−0.5)}（玩具延伸）': 'm_d = 4.67 MeV·e^{6(φ₃−0.5)} (toy extension)',
    'A_s = V₀/(24π²ε M_Pl⁴)（约化 M_Pl）': 'A_s = V₀/(24π²ε M_Pl⁴) (reduced M_Pl)',
    'Ω_k = k₀·e^{−2(N−60)}（夹到 ±1）': 'Ω_k = k₀·e^{−2(N−60)} (clamped to ±1)',
    'Λ = Λ₀ + ½Σnᵢ²qᵢ²，qᵢ² = 10⁻¹²¹(1,2,3)·g_s²·137/V；Ω_Λ = 0.685·Λ/10⁻¹²³（Bousso–Polchinski 机制，玩具刻度）':
      'Λ = Λ₀ + ½Σnᵢ²qᵢ², qᵢ² = 10⁻¹²¹(1,2,3)·g_s²·137/V; Ω_Λ = 0.685·Λ/10⁻¹²³ (Bousso–Polchinski mechanism, toy normalisation)',
    '直接输入': 'Entered directly',
    /* 固定词组（有量纲常数的三套约定） */
    '固定 e、ħ、m_p 为我们的数值': 'e, ħ and m_p fixed at our values',
    '固定 c、e、m_p 为我们的数值': 'c, e and m_p fixed at our values',
    '固定 c、ħ、m_p 为我们的数值': 'c, ħ and m_p fixed at our values',
    /* 分析面板零章的小标签（ui/app.js zeroDimHTML） */
    '年': ' yr',
    '/秒': '/s',
    '⏸ 已暂停': '⏸ Paused',
    '盒长 ': 'Box ',
    '引擎结局：大挤压于 ': 'Engine outcome: Big Crunch at ',
    '引擎结局：': 'Engine outcome: ',
    ' · 刻度到 10³ Gyr': ' · scale runs to 10³ Gyr',
    ' · a=1（“今天”）在 ': ' · a=1 (“today”) at ',
    ' · 拖动可推到未来，回拨则重算': ' · drag to run into the future; dragging back recomputes',
    '单位约定 ': 'Unit convention ',
    ' · 固定': ' · fixed',
    '相对我们': 'Relative to ours',
    ' 项': ' items',
    ' 条': ' entries',
    '、': ', ',
    '：': ': '
  }, 'app');

  /* ---- 3D 层（ui/universe3d.js）：WebGPU 诊断、HUD、状态与提示 ---- */
  I.add({
    /* WebGPU 拿不到的六种原因 + 建议（GPU_REASONS，显示层包 T()） */
    'WebGPU 可用': 'WebGPU available',
    '页面不是安全上下文（file:// 或非 https）': 'The page is not a secure context (file:// or non-https)',
    '用 https 链接打开（file:// 不提供 WebGPU）；本地调试用 http://localhost 也算安全上下文':
      'Open it over https (file:// does not provide WebGPU); for local debugging, http://localhost also counts as a secure context',
    '浏览器没有暴露 navigator.gpu': 'The browser does not expose navigator.gpu',
    'Chrome/Edge 113+ 才有 WebGPU；如果已是新版，在 chrome://flags 搜 WebGPU 确认没被禁用（Linux 上还要 enable-unsafe-webgpu）':
      'WebGPU needs Chrome/Edge 113+; if yours is new enough, search chrome://flags for WebGPU and make sure it is not disabled (on Linux you also need enable-unsafe-webgpu)',
    'requestAdapter() 返回空：没有可用的显卡适配器': 'requestAdapter() returned null: no graphics adapter is available',
    '显卡驱动或浏览器没把适配器暴露出来：更新显卡驱动 / 关闭省电模式 / 在 Windows「图形设置」里把浏览器设为“高性能”（别让它只看到集显）':
      'The GPU driver or the browser is not exposing an adapter: update the GPU driver / turn off power-saving mode / in Windows "Graphics settings" set the browser to "High performance" (do not leave it seeing only the integrated GPU)',
    'requestDevice() 失败：适配器在，设备建不出来': 'requestDevice() failed: the adapter is there, but no device could be created',
    '多半是驱动或显存问题：更新显卡驱动、重启浏览器后重试；仍不行就降低粒子档位':
      'Usually a driver or GPU-memory problem: update the GPU driver, restart the browser and retry; if it still fails, lower the particle tier',
    'WebGPU 初始化中途失败，已回退到 WebGL2': 'WebGPU initialisation failed partway; fell back to WebGL2',
    '控制台里搜 [universe3d] 看具体报错（常见是着色器/显存限制）；更新显卡驱动或降低粒子档位后重试':
      'Search the console for [universe3d] to see the exact error (usually shader or GPU-memory limits); update the GPU driver or lower the particle tier and retry',
    '调用方指定了 force:"webgl2"': 'The caller forced force:"webgl2"',
    '去掉 force 选项（或地址栏里的 ?mode=webgl2）就会优先走 WebGPU':
      'Remove the force option (or ?mode=webgl2 in the address bar) and WebGPU will be preferred again',
    /* CPU 告警条 */
    '⚠ 正在用 CPU 计算（': '⚠ Computing on the CPU (',
    ' 粒子 · ': ' particles · ',
    ' fps）：': ' fps): ',
    '重试 WebGPU': 'Retry WebGPU',
    '。': '. ',
    '也可以把粒子档位调低': 'You can also lower the particle tier',
    'CPU 路径较慢：已自动给物理降频。': 'The CPU path is slow: physics has been throttled automatically. ',
    '正在检测…': 'Probing…',
    '正在重新检测 WebGPU…': 'Re-probing WebGPU…',
    '已经在用 WebGPU': 'Already running on WebGPU',
    '已销毁': 'Disposed',
    'WebGPU 现在可用了：但这块画布已经归 WebGL2（上下文类型不可逆），要切到 GPU 路径得重新引爆这个宇宙——会从初始条件重新开始演化。':
      'WebGPU is available now — but this canvas already belongs to WebGL2 (the context type is irreversible). To switch to the GPU path, re-detonate this universe; evolution will restart from the initial conditions.',
    /* 顶部标签与状态行 */
    '3D PM N 体模拟（': '3D PM N-body simulation (',
    '³ 网格 · 盒长 ': '³ mesh · box ',
    '3 维投影 · 引力按 r^{−(D−1)} 衰减（D=': '3-D projection · gravity falls off as r^{−(D−1)} (D=',
    '，核以最大尺度归一）· 软化长度 ε=': ', kernel normalised at the largest scale) · softening length ε=',
    '引力聚集的物质团块 · 该宇宙无稳定原子/无恒星，没有星系可言 · ':
      'Matter clumps bound by gravity · no stable atoms or stars in this universe, no galaxies to speak of · ',
    '▶ 实时演化 · 每秒 ≈ ': '▶ Evolving live · per second ≈ ',
    '（空格暂停）': ' (Space to pause)',
    '⏸ 已暂停 · 空格继续': '⏸ Paused · Space to resume',
    '俯瞰全盒（O 退出 · 环绕 ': 'Box overview (O to exit · orbit ',
    '）  ': ')  ',
    '曝光 ×': 'Exposure ×',
    '（自动）': ' (auto)',
    '（手动）': ' (manual)',
    ' · 过曝 ': ' · clipped ',
    '（按 − 调暗，或点右侧"曝光 手动"按钮交回自动）': ' (press − to dim, or click the "Exposure manual" button on the right to hand back to auto)',
    'CPU 物理已自动降频（原因见上方提示）  ': 'CPU physics auto-throttled (see the notice above)  ',
    '物质团块（无恒星）  ': 'Matter clumps (no stars)  ',
    '晕 ': 'Halos ',
    '（结构尚未形成）': ' (structure not formed yet)',
    '  初始条件：Zel’dovich 位移后的格点（随机相位已含，看着像网格是正常的）':
      '  Initial conditions: the lattice after Zel’dovich displacement (random phases included — looking like a grid is normal)',
    '  最近晕 ': '  nearest halo ',
    '  速度 ': '  speed ',
    '  限速 |Δx|≤ε/步': '  speed cap |Δx|≤ε/step',
    '（本步限幅 ': ' (clamped this step: ',
    ' 粒）': ' particles)',
    '  σ₈(测)=': '  σ₈(measured)=',
    ' / 线性 ': ' / linear ',
    '（固有）': ' (proper)',
    '（共动）': ' (comoving)',
    ' @ 参考距离 ': ' @ reference distance ',
    ' 十亿光年': ' Gly',
    ' 百万光年': ' Mly',
    /* 时间量（fmtGyr / fmtYears 的中文单位段） */
    ' 千年': ' kyr',
    ' 百万年': ' Myr',
    /* 按钮与快捷键提示 */
    'WASD/QE 移动 · 右键/左键拖拽转向 · 滚轮调速 · Shift 加速 · O 俯瞰全盒 · F 飞到最密处 · H 飞到随机晕 · ':
      'WASD/QE to move · drag (either button) to look · wheel for speed · Shift to boost · O box overview · F fly to the densest spot · H fly to a random halo · ',
    '点击恒星进入': 'click a star to enter',
    '本宇宙无恒星可点选': 'no stars to click in this universe',
    ' · V 体渲染 · L 标签': ' · V volume rendering · L labels',
    '俯瞰全盒 (O)': 'Box overview (O)',
    '环绕 ': 'Orbit ',
    '开': 'on',
    '关': 'off',
    '飞到最密处 (F)': 'Fly to densest (F)',
    '飞入随机晕 (H)': 'Fly into a random halo (H)',
    '参观示例星系（示意）': 'Tour a sample galaxy (illustrative)',
    '曝光 ': 'Exposure ',
    '自动': 'auto',
    '手动': 'manual',
    '低功耗 ': 'Low power ',
    '把相机拉到盒外俯瞰整盒（快捷键 O）': 'Pull the camera out of the box for an overview (shortcut: O)',
    '还在生成初始条件…': 'Still generating initial conditions…',
    '俯瞰时缓慢自动环绕': 'Slow automatic orbit while in overview',
    '飞到最重的晕': 'Fly to the heaviest halo',
    '这个宇宙还没有识别到晕：飞到密度场最大处': 'No halos identified in this universe yet: fly to the densest point of the density field',
    '随机飞进一个晕': 'Fly into a random halo',
    '随机飞进一个物质团块（该宇宙无恒星，没有星系）': 'Fly into a random matter clump (this universe has no stars, hence no galaxies)',
    '这个宇宙没有形成晕（σ₈≈': 'This universe formed no halos (σ₈≈',
    '）：点一下看说明': '): click for an explanation',
    '）：没有可进入的星系。': '): there is no galaxy to enter. ',
    '按最密处的种子过程生成一个星系，只作示意（不是这个宇宙的模拟结果）':
      'Procedurally generates a galaxy from the densest spot’s seed, for illustration only (not a simulation result of this universe)',
    '密度体渲染：显示纤维与空洞（快捷键 V）': 'Density volume rendering: shows filaments and voids (shortcut: V)',
    '低功耗开：渲染限 30 fps、物理降频（省电/降温）': 'Low power on: rendering capped at 30 fps, physics throttled (saves power and heat)',
    '机器发烫或风扇狂转时打开：渲染限 30 fps、物理降频': 'Turn this on when the machine runs hot: rendering capped at 30 fps, physics throttled',
    '自动曝光：按屏幕亮度直方图归一（目标随分布形状自适应，削顶像素压在 0.5% 以内）。+ / − 手动调节会关掉它':
      'Auto exposure: normalised from the on-screen brightness histogram (the target adapts to the distribution; clipped pixels held under 0.5%). Adjusting with + / − switches it off',
    '手动曝光：点一下恢复自动': 'Manual exposure: click to return to auto',
    /* 进度与状态消息 */
    '生成初始条件：': 'Generating initial conditions: ',
    '白噪声 → 傅里叶空间': 'white noise → Fourier space',
    '生成初始条件（': 'Generating initial conditions (',
    '³ 粒子，': '³ particles, ',
    '³ 网格）…': '³ mesh)…',
    '初始化失败：': 'Initialisation failed: ',
    'WebGL2 不可用（': 'WebGL2 unavailable (',
    '未知原因': 'unknown reason',
    '重算：重新生成初始条件…': 'Recomputing: regenerating initial conditions…',
    '重算：': 'Recomputing: ',
    '重算失败：': 'Recompute failed: ',
    '俯瞰全盒：整盒 ': 'Box overview: the whole ',
    ' Mpc/h · 自动环绕': ' Mpc/h box · auto orbit ',
    ' · 再按 O 或 WASD 回到自由飞行': ' · press O again, or WASD, to return to free flight',
    '低功耗：渲染 30 fps、物理降频': 'Low power: rendering at 30 fps, physics throttled',
    '恢复全速': 'Back to full speed',
    '粒子数过多，不启用 27 重平铺': 'Too many particles — 27× tiling not enabled',
    '密度网格还没算出来（等初始条件生成完）': 'The density grid is not ready yet (waiting for the initial conditions)',
    '密度网格还没算出来': 'The density grid is not ready yet',
    '还没有识别到晕（等分析完成）': 'No halos identified yet (waiting for the analysis)',
    '这个宇宙还没有识别到晕：飞向密度场最大处（δ≈': 'No halos identified in this universe yet: flying to the densest point of the density field (δ≈',
    '进入晕：': 'Entering halo: ',
    '（示意）': ' (illustrative)',
    '可以点"参观示例星系（示意）"看一个过程生成的星系（不是这个宇宙的模拟结果）。':
      'You can click "Tour a sample galaxy (illustrative)" to see a procedurally generated galaxy (not a simulation result of this universe).',
    '这个宇宙没有稳定原子，也没有恒星：画面里的亮点是引力聚集的物质团块，没有可进入的天体':
      'This universe has no stable atoms and no stars: the bright dots are gravitationally bound matter clumps, with nothing to enter',
    '没有可点选的天体：该宇宙无稳定原子/无恒星，亮点是引力聚集的物质团块':
      'Nothing selectable here: this universe has no stable atoms or stars — the bright dots are gravitationally bound matter clumps',
    '这个宇宙没有稳定原子、也没有恒星：没有星系可言，示例星系也不适用（画面里的是引力聚集的物质团块）':
      'This universe has no stable atoms and no stars: there are no galaxies to speak of, so the sample galaxy does not apply either (what you see are gravitationally bound matter clumps)',
    '示意：这个宇宙没有形成晕，下面是按最密处种子过程生成的一个星系——不是模拟结果':
      'Illustrative: this universe formed no halos; below is a galaxy procedurally generated from the densest spot’s seed — not a simulation result',
    '示意：这个宇宙没有形成晕，这是按最密处种子过程生成的示例星系——不是模拟结果':
      'Illustrative: this universe formed no halos; this is a sample galaxy procedurally generated from the densest spot’s seed — not a simulation result',
    '该宇宙结构极弱（σ₈≈': 'Structure in this universe is very weak (σ₈≈',
    '）：看到的基本还是初始条件格点，没有形成晕': '): what you see is still mostly the initial-condition lattice — no halos formed',
    '引力聚集的物质团块（模拟结果）：该宇宙没有稳定原子、也没有恒星，没有星系可言——这里没有可点选的天体':
      'Gravitationally bound matter clumps (simulation result): this universe has no stable atoms and no stars, hence no galaxies — nothing here can be selected',
    '：太阳位置 / 百光年内恒星 / 本星系群 · 星系点云本身为过程生成示意':
      ': Sun position / stars within 100 ly / Local Group · the galaxy point cloud itself is procedurally generated (illustrative)',
    '数据：观测目录（HYG v4.1 / McConnachie 2012）': 'Data: observational catalogs (HYG v4.1 / McConnachie 2012)',
    '示意：过程生成，不是模拟结果': 'Illustrative: procedurally generated, not a simulation result',
    '示意：过程生成': 'Illustrative: procedurally generated',
    '示意：': 'Illustrative: ',
    ' · 过程生成，不是模拟结果': ' · procedurally generated, not a simulation result',
    ' · 含团内热气体与 cD 星系': ' · with intracluster hot gas and a cD galaxy',
    ' · 带': ' · with a ',
    '类星体级': 'quasar-grade ',
    '活动星系核（M_BH≈': 'active galactic nucleus (M_BH≈',
    /* 大尺度环境标签 */
    '空洞': 'Void',
    '低密度区': 'Low-density region',
    '纤维/墙': 'Filament/wall',
    '节点：星系团/超星系团尺度': 'Node: cluster/supercluster scale',
    '节点：物质团块密集区': 'Node: dense region of matter clumps',
    '（物质分布）': ' (matter distribution)',
    /* 小地图与晕标签 */
    '俯视 xy · z=': 'Top view xy · z=',
    '模拟盒 ': 'Simulation box ',
    ' Mpc/h（共动 ': ' Mpc/h (comoving ',
    '晕 #': 'Halo #',
    ' · 银河系宿主': ' · Milky Way host',
    /* 星系形态名（过程生成层） */
    '星系团（含 cD 星系与热气体晕）': 'Galaxy cluster (with a cD galaxy and a hot gas halo)',
    '矮椭球星系': 'Dwarf spheroidal galaxy',
    '矮不规则星系': 'Dwarf irregular galaxy',
    '透镜星系 S0': 'Lenticular galaxy S0',
    '不规则星系': 'Irregular galaxy',
    '低表面亮度盘星系': 'Low-surface-brightness disc galaxy',
    '旋涡星系': 'Spiral galaxy',
    '椭圆星系': 'Elliptical galaxy',
    '星云': 'Nebula',
    '球状星团': 'Globular cluster',
    '疏散星团': 'Open cluster',
    '活动星系核': 'Active galactic nucleus',
    '团内热气体': 'Intracluster gas',
    '成员星系': 'Member galaxy',
    'HII 区 / 反射星云（示意）': 'HII region / reflection nebula (illustrative)',
    '疏散星团（示意）': 'Open cluster (illustrative)',
    '超新星遗迹（示意）': 'Supernova remnant (illustrative)',
    '室女座星系团（方向）': 'Virgo Cluster (direction)',
    '猎户臂（本地臂）': 'Orion Arm (Local Arm)',
    /* 恒星信息面板 */
    '恒星（观测目录）': 'Star (observational catalog)',
    '星系（观测目录）': 'Galaxy (observational catalog)',
    '星系团（观测目录）': 'Galaxy cluster (observational catalog)',
    ' 型': ' type',
    '距银心 ': 'Distance from the Galactic centre ',
    '距太阳 ': 'Distance from the Sun ',
    '距星系中心 ': 'Distance from the galaxy centre ',
    '（类星体级光度）': ' (quasar-grade luminosity)',
    ' · 喷流为示意': ' · jets are illustrative',
    '团内热气体 T ≈ 10⁷ K（X 射线示意）': 'Intracluster gas T ≈ 10⁷ K (X-ray, illustrative)',
    ' · 晕 ': ' · halo ',
    '，晕 ': ', halo ',
    '，R≈': ', R≈',
    '（点一下进入）': ' (click to enter)',
    '；占比 ': '; fraction '
  }, 'app');


  /* ---- 参数显示名（engine/params.js 的 name/desc/si；确认屏 plainName 兜底与参数编辑器用）
     人话表（web/onboard.js PLAIN）收了 20 个老参数；后加的引力耦合与弦气三参数落到
     spec.name —— 这里把全部 name 收齐，desc/si 先收新参数这一批（其余 desc 列入待翻清单）。 ---- */
  I.add({
    '引力耦合倍率': 'Gravitational coupling ratio',
    '初始弦气温度 / Hagedorn 温度': 'Initial string-gas temperature / Hagedorn temperature',
    '缠绕模初始密度': 'Initial winding-mode density',
    '紧致化刚度（解开阈值宽度）': 'Compactification stiffness (unwrap-threshold width)',
    'CKM CP 相位': 'CKM CP phase',
    '中微子质量和': 'Sum of neutrino masses',
    '冷暗物质物理密度': 'Cold dark matter physical density',
    '哈勃常数': 'Hubble constant',
    '希格斯真空期望值': 'Higgs vacuum expectation value',
    '希格斯质量': 'Higgs mass',
    '弦耦合': 'String coupling',
    '强 CP 相位': 'Strong CP phase',
    '强耦合常数 αₛ(M_Z)': 'Strong coupling constant αₛ(M_Z)',
    '形状模量 φ₁（电子汤川）': 'Shape modulus φ₁ (electron Yukawa)',
    '形状模量 φ₂（上夸克汤川）': 'Shape modulus φ₂ (up-quark Yukawa)',
    '形状模量 φ₃（下夸克汤川）': 'Shape modulus φ₃ (down-quark Yukawa)',
    '微波背景温度': 'CMB temperature',
    '慢滚参数 ε': 'Slow-roll parameter ε',
    '慢滚参数 η': 'Slow-roll parameter η',
    '暴胀 e-folds': 'Inflation e-folds',
    '暴胀前曲率': 'Pre-inflation curvature',
    '暴胀能标': 'Inflation energy scale',
    '紧致化体积': 'Compactification volume',
    '裸真空能 log₁₀|Λ₀|（Λ₀<0）': 'Bare vacuum energy log₁₀|Λ₀| (Λ₀<0)',
    '通量整数 n₁': 'Flux integer n₁',
    '通量整数 n₂': 'Flux integer n₂',
    '通量整数 n₃': 'Flux integer n₃',
    '重子物理密度': 'Baryon physical density',
    /* 新参数的 desc / si（参数编辑器右侧说明） */
    '把 α_G 从"只由质子质量决定"里解放出来。α_G=(m_p/M_Pl)²×gNewton。进入恒星点火质量窗口、主序寿命、行星最大质量（Weisskopf）。':
      'Frees α_G from being set by the proton mass alone. α_G=(m_p/M_Pl)²×gNewton. Feeds the stellar ignition-mass window, main-sequence lifetimes, and the maximum planet mass (Weisskopf).',
    '1（按我们的宇宙归一）': '1 (normalised to our universe)',
    '过热→更多维解开；过冷→只解开 1–2 维。湮灭效率整体因子 e^{6(T₀/T_H−0.98)}。':
      'Hotter → more dimensions unwind; colder → only 1–2 unwind. Overall annihilation-efficiency factor e^{6(T₀/T_H−0.98)}.',
    '0.98（恰好解开三维）': '0.98 (exactly three dimensions unwind)',
    '越多越难全部湮灭，解开的维数越少（效率 ∝ 1/n_w）。':
      'The more windings, the harder it is to annihilate them all, so fewer dimensions unwind (efficiency ∝ 1/n_w).',
    '阈值带宽 w=0.4(1−κ)：κ→1 硬阈值（D 恒为整数）；κ→0 宽带（更多分数维）。':
      'Threshold band width w=0.4(1−κ): κ→1 gives a hard threshold (D always an integer); κ→0 a wide band (more fractional dimensions).',
    '0.5（w=0.2）': '0.5 (w=0.2)'
  }, 'app');

  /* ---- 行星引擎的固定词条（engine/planet.js 的 SCHEMA / derivedRows / findings 标题与出处）
     这些是整串不带数值的，进词典就够，不用上模板。数值、公式、文献引用一个字符不改；
     只有中文的解释语按学界通用译法重写。术语一律取通用：宜居带 habitable zone、
     潮汐锁定 tidally locked、逃逸速度 escape velocity、洛希极限 Roche limit、
     邦德反照率 Bond albedo、外逸层 exobase、灰大气 grey atmosphere。 ---- */
  I.add({
    /* 输入参数名（paramRows） */
    '岩铁质量分数': 'Rock + iron mass fraction',
    '冰质量分数': 'Ice mass fraction',
    'H/He 包层质量分数': 'H/He envelope mass fraction',
    '金属核质量分数': 'Metallic-core mass fraction',
    '轨道半长轴': 'Orbital semi-major axis',
    '偏心率': 'Eccentricity',
    '轨道倾角': 'Orbital inclination',
    '自转周期': 'Rotation period',
    '转轴倾角': 'Axial tilt',
    '邦德反照率': 'Bond albedo',
    '表面气压': 'Surface pressure',
    '大气成分': 'Atmospheric composition',
    '含水量': 'Water inventory',
    '放射性元素丰度（相对地球）': 'Radiogenic element abundance (relative to Earth)',
    '磁场指数': 'Magnetic-field index',
    '地球海洋': 'Earth oceans',
    '种子抽样': 'seeded',
    /* 派生量名（derivedRows） */
    '表面重力': 'Surface gravity',
    '逃逸速度': 'Escape velocity',
    '平均密度': 'Mean density',
    '成分推断': 'Inferred composition',
    '公转周期': 'Orbital period',
    '辐照': 'Insolation',
    '希尔球半径': 'Hill-sphere radius',
    '洛希极限（流体卫星）': 'Roche limit (fluid satellite)',
    '平衡温度': 'Equilibrium temperature',
    '灰大气光学厚度': 'Grey-atmosphere optical depth',
    '表面温度': 'Surface temperature',
    '外逸层温度': 'Exobase temperature',
    'Jeans 逃逸参数': 'Jeans escape parameter',
    '潮汐锁定时标': 'Tidal-locking timescale',
    '日长（太阳日）': 'Day length (solar day)',
    '季节幅度（45° 纬度）': 'Seasonal amplitude (45° latitude)',
    /* 派生量表里的符号列：只有这一个符号带汉字（下标是「季」＝季节） */
    'ΔT_季': 'ΔT_seas',
    '常压下可能的液态溶剂': 'Liquid solvents possible at 1 bar',
    '放射性地表热流': 'Radiogenic surface heat flux',
    '地质活动指数': 'Geological activity index',
    '行星质量上限': 'Maximum planet mass',
    /* 发现（findings）的标题 */
    '温度：平衡温度与温室增温': 'Temperature: equilibrium value and greenhouse warming',
    '大气逃逸：哪些气体留得住': 'Atmospheric escape: which gases stay',
    'Cosmic shoreline：辐照与逃逸速度的分界': 'Cosmic shoreline: where insolation beats escape velocity',
    '自转：潮汐锁定': 'Rotation: tidal locking',
    '季节：转轴倾角': 'Seasons: axial tilt',
    '液态水': 'Liquid water',
    '宜居带位置': 'Position relative to the habitable zone',
    '磁场与大气保留': 'Magnetic field and atmospheric retention',
    '本体：重力、逃逸速度、密度': 'The body itself: gravity, escape velocity, density',
    '轨道：周期、辐照、希尔球': 'Orbit: period, insolation, Hill sphere',
    '生命等级': 'Life level',
    /* 发现里的公式/判据行 */
    'Berger 1978 的日均辐照公式，φ=45°、δ=±ε':
      'Berger 1978 daily-mean insolation, φ=45°, δ=±ε',
    'I_crit/I⊕ = C·(v_esc[km/s])⁴（Zahnle & Catling 2017 的经验分界 I_XUV ∝ v_esc⁴）；C = 4×10⁻³ 用太阳系六个天体定标（金星/地球/火星/土卫六 有大气，水星/月球 无），并以总辐照代替累计 XUV':
      'I_crit/I⊕ = C·(v_esc[km/s])⁴ (the empirical Zahnle & Catling 2017 divide, I_XUV ∝ v_esc⁴); C = 4×10⁻³ is calibrated on six Solar System bodies (Venus/Earth/Mars/Titan keep an atmosphere, Mercury/the Moon do not), with total insolation standing in for cumulative XUV',
    'Kopparapu et al. 2013 的 S_eff(T_eff) 四次多项式':
      'the quartic S_eff(T_eff) polynomial of Kopparapu et al. 2013',
    'λ = GMm/(kT_exo R)；判据 λ≥30 保留 / λ<15 快速逃逸（Catling & Kasting 2017 §5.9）':
      'λ = GMm/(kT_exo R); λ≥30 means retained, λ<15 means rapid escape (Catling & Kasting 2017 §5.9)',
    '按宜居性 × 年龄的启发式门槛：地球的时间表是唯一样本（微生物 ≈0.5 Gyr、真核 ≈2 Gyr、陆生植物 ≈4.1 Gyr、动物 ≈4.0 Gyr、文明 ≈4.55 Gyr），n=1，因此这是启发式而不是统计':
      'a heuristic threshold on habitability × age. Earth\'s timetable is the only sample we have (microbes ≈0.5 Gyr, eukaryotes ≈2 Gyr, land plants ≈4.1 Gyr, animals ≈4.0 Gyr, civilisation ≈4.55 Gyr); with n=1 this is a heuristic, not a statistic',
    '水的相图（IAPWS-95）：P > 611.657 Pa 且 273.16 K < T_s < T_沸(P) < 647.096 K':
      'the phase diagram of water (IAPWS-95): P > 611.657 Pa and 273.16 K < T_s < T_boil(P) < 647.096 K',
    '磁场指数由导电核质量分数 × 自转 × 内部热流合成；对大气保留的作用按"有磁场则减少恒星风剥蚀"处理':
      'the magnetic index combines conducting-core mass fraction × rotation × internal heat flux; its effect on atmospheric retention is treated as "a field reduces stellar-wind stripping"',
    /* 出处行（refs）。文献本身原样，只有中文的注解改写。 */
    'Chen & Kipping 2017（Forecaster 中位质量-半径关系）':
      'Chen & Kipping 2017 (the Forecaster median mass–radius relation)',
    'Zeng et al. 2016；雪线 2.7√(L/L⊙) AU（Hayashi 1981）':
      'Zeng et al. 2016; snow line 2.7√(L/L⊙) AU (Hayashi 1981)',
    'Hayashi 1981（雪线以外冰可参与吸积）':
      'Hayashi 1981 (beyond the snow line, ice can take part in accretion)',
    '地球 0.325（PREM）；水星 0.70（Hauck et al. 2013）——取两者之间抽样':
      'Earth 0.325 (PREM); Mercury 0.70 (Hauck et al. 2013) — sampled between the two',
    '轨道由恒星系生成器给定（对数间距，Hayashi 1981 的最小质量星云）':
      'the orbit is given by the star-system generator (logarithmic spacing, Hayashi 1981 minimum-mass nebula)',
    '太阳系八大行星 e = 0.007–0.206（NASA）；系外行星分布更宽（Kipping 2013）':
      'the eight Solar System planets span e = 0.007–0.206 (NASA); the exoplanet distribution is wider (Kipping 2013)',
    '太阳系 i < 7.0°（NASA）；共面性来自原行星盘':
      'Solar System i < 7.0° (NASA); the coplanarity is inherited from the protoplanetary disc',
    '太阳系巨行星 9.9–17.2 h、岩质行星 23.9–5832 h（NASA）':
      'Solar System giants 9.9–17.2 h, rocky planets 23.9–5832 h (NASA)',
    '太阳系 0.03°–177.4°（NASA）；巨撞击可给出任意倾角（Kokubo & Ida 2007）':
      'Solar System 0.03°–177.4° (NASA); a giant impact can leave any obliquity at all (Kokubo & Ida 2007)',
    '取值区间取自太阳系天体的 Bond 反照率（水星 0.088、月球 0.11、火星 0.25、地球 0.306、木星 0.343、金星 0.77；NASA）':
      'the range is taken from Bond albedos in the Solar System (Mercury 0.088, the Moon 0.11, Mars 0.25, Earth 0.306, Jupiter 0.343, Venus 0.77; NASA)',
    '出气量按硅酸盐挥发分标度（Elkins-Tanton 2008）；随后由 Jeans 逃逸与 cosmic shoreline 判据裁剪':
      'outgassing scales with the volatile content of silicates (Elkins-Tanton 2008); the result is then trimmed by the Jeans-escape and cosmic-shoreline criteria',
    'Catling & Kasting 2017 第 6–11 章（岩质行星大气成分的可能路径）':
      'Catling & Kasting 2017, chapters 6–11 (possible paths to a rocky-planet atmosphere)',
    '系外行星含水量没有直接观测约束；地球 1 单位 = 1.4×10²¹ kg（Tian & Ida 2015 的吸积模拟给出很宽的分布）':
      'there is no direct observational constraint on exoplanet water inventories; 1 Earth unit = 1.4×10²¹ kg (the accretion simulations of Tian & Ida 2015 give a very wide distribution)',
    '恒星 Th/Eu、U/Si 弥散约 ±0.3 dex（Unterborn et al. 2015, ApJ 806, 139）':
      'stellar Th/Eu and U/Si scatter by about ±0.3 dex (Unterborn et al. 2015, ApJ 806, 139)',
    'Christensen 2010 的发电机标度指出场强主要由核内热流决定；此处的 0–1 指数是本引擎的启发式合成（核质量分数 × 自转 × 内部热流）':
      'the Christensen 2010 dynamo scaling makes field strength depend mainly on the heat flux through the core; the 0–1 index used here is this engine\'s own heuristic combination (core mass fraction × rotation × internal heat flux)',
    '取恒星年龄': 'taken to be the age of the star',
    'CODATA 2018；NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov/planetary/factsheet/）（NASA 表列的是赤道口径且含自转离心项，快转天体会差几个百分点）':
      'CODATA 2018; NASA Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/) — NASA quotes equatorial values including the centrifugal term, so fast rotators differ by a few per cent',
    'NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov/planetary/factsheet/）（对照：土星 687、木星 1326、天王星 1270、火星 3934、地球 5514 kg/m³）':
      'NASA Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/) — for comparison: Saturn 687, Jupiter 1326, Uranus 1270, Mars 3934, Earth 5514 kg/m³',
    'Newton 1687；IAU 2012（AU 定义值）':
      'Newton 1687; IAU 2012 (defining value of the AU)',
    'Kopp & Lean 2011（太阳常数 1360.8±0.5 W/m²）':
      'Kopp & Lean 2011 (solar constant 1360.8±0.5 W/m²)',
    'NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov/planetary/factsheet/）（Black-body temperature 一列；本式对八大行星复现到 1% 以内）':
      'NASA Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/), the Black-body temperature column — this formula reproduces all eight planets to within 1%',
    'Schmidt et al. 2010, JGR 115, D20106（地球温室归因）；Haberle 2013, Icarus 223, 619（火星）；Pierrehumbert 2010《Principles of Planetary Climate》§4（曲线生长律）':
      'Schmidt et al. 2010, JGR 115, D20106 (attribution of Earth\'s greenhouse); Haberle 2013, Icarus 223, 619 (Mars); Pierrehumbert 2010, Principles of Planetary Climate §4 (curve-of-growth law)',
    'Catling & Kasting 2017 §13；Kasting 1988, Icarus 74, 472（失控温室）':
      'Catling & Kasting 2017 §13; Kasting 1988, Icarus 74, 472 (runaway greenhouse)',
    'Catling & Kasting 2017 §5.3；Bougher et al. 2002（金星/火星热层）':
      'Catling & Kasting 2017 §5.3; Bougher et al. 2002 (the thermospheres of Venus and Mars)',
    'Jeans 1925；Catling & Kasting 2017 §5.9（阈值 λ≈25–30 对应 Gyr 量级的逃逸时标）':
      'Jeans 1925; Catling & Kasting 2017 §5.9 (the λ≈25–30 threshold corresponds to escape timescales of order a Gyr)',
    'Gladman et al. 1996, Icarus 122, 166；Q、k₂ 为假定值（地球固体 Q≈100、k₂≈0.3；木星 Q≈3×10⁴、k₂≈0.59，Lainey et al. 2009）':
      'Gladman et al. 1996, Icarus 122, 166; Q and k₂ are assumed (solid Earth Q≈100, k₂≈0.3; Jupiter Q≈3×10⁴, k₂≈0.59, Lainey et al. 2009)',
    'NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov/planetary/factsheet/）（Length of day 一列：金星 2802 h、水星 4222.6 h）':
      'NASA Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/), the Length of day column: Venus 2802 h, Mercury 4222.6 h',
    'Berger 1978, J. Atmos. Sci. 35, 2362；海洋热惯量会把实际振幅压到这个上限的一半以下（地球中纬度实测约 25 K）':
      'Berger 1978, J. Atmos. Sci. 35, 2362; ocean thermal inertia pushes the real amplitude to less than half this ceiling (about 25 K measured at Earth\'s mid-latitudes)',
    'CRC Handbook of Chemistry and Physics；土卫六表面 94 K 有甲烷/乙烷湖（Stofan et al. 2007）':
      'CRC Handbook of Chemistry and Physics; at 94 K Titan\'s surface holds lakes of methane and ethane (Stofan et al. 2007)',
    'Kopparapu et al. 2013, ApJ 765, 131（含 2013 勘误）；适用范围 2600 K ≤ T_eff ≤ 7200 K':
      'Kopparapu et al. 2013, ApJ 765, 131 (including the 2013 erratum); valid for 2600 K ≤ T_eff ≤ 7200 K',
    'Turcotte & Schubert《Geodynamics》表 4-2；Davies & Davies 2010（地球总热流 47 TW）':
      'Turcotte & Schubert, Geodynamics, table 4-2; Davies & Davies 2010 (Earth\'s total heat flow, 47 TW)',
    'Korenaga 2010, ApJ 725, L43；Valencia et al. 2007（超级地球的板块构造仍有争议）':
      'Korenaga 2010, ApJ 725, L43; Valencia et al. 2007 (plate tectonics on super-Earths is still disputed)',
    'Berger 1978；Ward 1974（倾角混沌与卫星的稳定作用）':
      'Berger 1978; Ward 1974 (chaotic obliquity and the stabilising role of a moon)',
    'Christensen 2010；Gunell et al. 2018, A&A 614, L3；Kasting & Catling 2003（碳酸盐-硅酸盐循环）':
      'Christensen 2010; Gunell et al. 2018, A&A 614, L3; Kasting & Catling 2003 (the carbonate–silicate cycle)',
    'Gladman et al. 1996, Icarus 122, 166；Peale 1969（自旋轨道共振）':
      'Gladman et al. 1996, Icarus 122, 166; Peale 1969 (spin–orbit resonance)',
    'Nutman et al. 2016（37 亿年叠层石）；Knoll 2015；Carter 1983（时间尺度论证）':
      'Nutman et al. 2016 (3.7-Gyr stromatolites); Knoll 2015; Carter 1983 (the timescale argument)',
    /* 书名号：英文书名用斜体或直排即可，这里保持纯文本 */
    'Catling & Kasting 2017《Atmospheric Evolution on Inhabited and Lifeless Worlds》§5':
      'Catling & Kasting 2017, Atmospheric Evolution on Inhabited and Lifeless Worlds, §5',
    'Turcotte & Schubert《Geodynamics》': 'Turcotte & Schubert, Geodynamics',
    /* 输入参数的说明行（SCHEMA.desc）。引擎按句号拼，tx() 也按句号拆，所以这里一句一条。 */
    '决定表面重力、逃逸速度、大气保留、内部热与最大质量判据。':
      'Sets surface gravity, escape velocity, atmospheric retention, internal heat and the maximum-mass criterion.',
    '太阳系为实测值。': 'Solar System values are measured.',
    '体积平均半径。': 'Volumetric mean radius.',
    '与质量一起给出密度、重力与逃逸速度。':
      'Together with the mass it gives density, gravity and escape velocity.',
    '硅酸盐 + 铁核占总质量的比例。':
      'The share of total mass in silicates plus an iron core.',
    '与冰、气分数之和为 1。': 'It sums to 1 with the ice and gas fractions.',
    'H₂O/NH₃/CH₄ 冰占总质量的比例；雪线以外才可能显著。':
      'The share of total mass in H₂O/NH₃/CH₄ ice; it can only be significant beyond the snow line.',
    '氢氦包层占总质量的比例；>0.1 即为巨行星。':
      'The share of total mass in the hydrogen–helium envelope; above 0.1 the planet is a giant.',
    '导电流体核的规模，进入发电机（磁场）判据。':
      'The size of the conducting fluid core, which feeds the dynamo (magnetic-field) criterion.',
    '决定辐照、平衡温度、公转周期、潮汐锁定时标与希尔球。':
      'Sets insolation, equilibrium temperature, orbital period, tidal-locking timescale and the Hill sphere.',
    '近日/远日辐照比 = ((1+e)/(1−e))²；也进入潮汐加热。':
      'Periastron/apastron insolation ratio = ((1+e)/(1−e))²; it also feeds tidal heating.',
    '相对系统不变平面的倾角；只作记录，不进入温度计算。':
      'Inclination to the system\'s invariable plane; recorded only, it does not enter the temperature calculation.',
    '负值为逆行。': 'A negative value means retrograde.',
    '决定日长、科里奥利参数与发电机强度。':
      'Sets day length, the Coriolis parameter and dynamo strength.',
    '决定季节幅度；>90° 表示自转为逆行。':
      'Sets the seasonal amplitude; above 90° the rotation is retrograde.',
    '被反射掉的入射恒星辐射比例，直接进入平衡温度。':
      'The fraction of incoming starlight reflected away; it enters the equilibrium temperature directly.',
    '与成分一起决定温室光学厚度与液态窗口。':
      'With the composition it sets the greenhouse optical depth and the liquid window.',
    'H₂/He/CH₄/H₂O/N₂/O₂/Ar/CO₂ 的摩尔分数（归一化）。':
      'Mole fractions of H₂/He/CH₄/H₂O/N₂/O₂/Ar/CO₂ (normalised).',
    '以地球海洋质量为单位的水总量；决定海洋、水汽储库与失控温室的上限。':
      'Total water in units of one Earth ocean; it sets the oceans, the vapour reservoir and the ceiling of the runaway greenhouse.',
    '按恒星金属丰度弥散抽样；决定放射性产热与板块活动。':
      'Sampled from the scatter in stellar metallicity; it sets radiogenic heating and plate activity.',
    '导电核 + 自转 + 内部热的综合指数；0 表示没有全球磁场。':
      'A combined index of conducting core + rotation + internal heat; 0 means no global field.',
    '行星年龄≈恒星年龄；决定放射性产热衰减、大气演化与生命等级。':
      'Planet age ≈ star age; it sets radiogenic decay, atmospheric evolution and the life level.',
    /* 派生量的说明行（derivedRows.desc）：公式原样，只翻中文的注解 */
    'g = GM/R²（球对称牛顿引力；G = 6.67430×10⁻¹¹ m³kg⁻¹s⁻²，CODATA 2018）':
      'g = GM/R² (spherically symmetric Newtonian gravity; G = 6.67430×10⁻¹¹ m³kg⁻¹s⁻², CODATA 2018)',
    '按平均密度与太阳系天体对照分档；质量分数取自输入参数':
      'binned by mean density against Solar System bodies; the mass fractions come from the input parameters',
    'P = 2π√(a³/(G(M★+M_p)))（开普勒第三定律）':
      'P = 2π√(a³/(G(M★+M_p))) (Kepler\'s third law)',
    'S = L★/(4πa²)；地球处 1361 W/m²（太阳常数）':
      'S = L★/(4πa²); 1361 W/m² at Earth (the solar constant)',
    'R_H = a(1−e)·(M_p/3M★)^{1/3}；顺行卫星大致稳定在 0.5 R_H 以内':
      'R_H = a(1−e)·(M_p/3M★)^{1/3}; prograde moons are roughly stable out to 0.5 R_H',
    'd = 2.44R(ρ_p/ρ_m)^{1/3}（流体卫星，ρ_m = 3000 kg/m³ 取岩质卫星；刚体式系数为 1.26）':
      'd = 2.44R(ρ_p/ρ_m)^{1/3} (fluid satellite, ρ_m = 3000 kg/m³ for a rocky moon; the rigid-body coefficient is 1.26)',
    'T_eq = T★√(R★/2a)(1−A_B)^{1/4}（等价于 σT⁴ = S(1−A)/4，全球均匀再辐射）':
      'T_eq = T★√(R★/2a)(1−A_B)^{1/4} (equivalent to σT⁴ = S(1−A)/4, with uniform global re-radiation)',
    'τ_i = k_i·p̃_i^0.384·P̃^0.426（p̃、P̃ 为折算到地球重力的分压/总压，bar）——形式取自强线曲线生长律 τ ∝ √(u·γ)，u∝p/g、γ∝P；k 与指数用金星 737 K、地球 288 K、火星温室 +5 K 三点定标。':
      'τ_i = k_i·p̃_i^0.384·P̃^0.426 (p̃ and P̃ are the partial and total pressures in bar, scaled to Earth gravity) — the form comes from the strong-line curve of growth, τ ∝ √(u·γ) with u∝p/g and γ∝P; k and the exponents are calibrated on three points: Venus 737 K, Earth 288 K and a Martian greenhouse of +5 K.',
    '地球 τ=0.87，其中 H₂O+云 75%、CO₂ 20%、CH₄/O₃/N₂O 5%':
      'Earth sits at τ=0.87, of which H₂O plus clouds contribute 75%, CO₂ 20% and CH₄/O₃/N₂O 5%',
    'T_s = T_eq(1+¾τ)^{1/4}（灰大气 Eddington 近似）；水汽分压由 Clausius–Clapeyron 与含水量自洽迭代（正反馈）':
      'T_s = T_eq(1+¾τ)^{1/4} (grey-atmosphere Eddington approximation); the water-vapour partial pressure is iterated to consistency from Clausius–Clapeyron and the water inventory (positive feedback)',
    'T_exo ≈ f·T_eq，f = 8.0（H₂/He 主导）/ 3.9（N₂/O₂）/ 1.2（CO₂ 主导，15 μm 带强烈致冷）——用地球 ~1000 K、火星 ~200 K、金星 ~275 K、木星 ~900 K 的实测外逸层温度定标':
      'T_exo ≈ f·T_eq, with f = 8.0 (H₂/He dominated) / 3.9 (N₂/O₂) / 1.2 (CO₂ dominated, where the 15 μm band cools strongly) — calibrated on measured exobase temperatures: Earth ~1000 K, Mars ~200 K, Venus ~275 K, Jupiter ~900 K',
    'λ = GMm/(kT_exo R)（分子热能与引力束缚之比）；λ≳30 → 10 Gyr 尺度上保留，λ≲15 → 快速逃逸':
      'λ = GMm/(kT_exo R) (molecular thermal energy against gravitational binding); λ≳30 means retention on a 10-Gyr scale, λ≲15 means rapid escape',
    't_lock = ω_i a⁶ I Q /(3 G M★² k₂ R⁵)，I = 0.4MR²，ω_i = 2π/13.5 h（吸积末期自转），Q/k₂ = 100/0.3（岩质）':
      't_lock = ω_i a⁶ I Q /(3 G M★² k₂ R⁵), with I = 0.4MR², ω_i = 2π/13.5 h (the spin at the end of accretion) and Q/k₂ = 100/0.3 (rocky)',
    '1/T_syn = 1/T_rot − 1/T_orb（会合周期；逆行自转取负 T_rot）；潮汐锁定后 T_syn = T_orb':
      '1/T_syn = 1/T_rot − 1/T_orb (synodic period; retrograde rotation takes a negative T_rot); once tidally locked, T_syn = T_orb',
    '日均辐照 Q̄ = (S/π)(h₀ sinφ sinδ + cosφ cosδ sin h₀)，h₀ = arccos(−tanφ tanδ)，φ=45°、δ=±ε；温度按 T ∝ Q̄^{1/4}':
      'Daily mean insolation Q̄ = (S/π)(h₀ sinφ sinδ + cosφ cosδ sin h₀), h₀ = arccos(−tanφ tanδ), φ=45°, δ=±ε; temperature follows T ∝ Q̄^{1/4}',
    '三相点 273.16 K / 611.657 Pa、临界点 647.096 K / 22.064 MPa（IAPWS-95）；沸点由 Clausius–Clapeyron 反解（三相点与常压沸点两点定标，0.006–1 bar 内误差 <1 K）':
      'Triple point 273.16 K / 611.657 Pa, critical point 647.096 K / 22.064 MPa (IAPWS-95); the boiling point is inverted from Clausius–Clapeyron (calibrated on the triple point and the 1 atm boiling point, to better than 1 K over 0.006–1 bar)',
    '把 T_s 与各溶剂在 1 atm 下的熔点/沸点区间比较：水 273–373 K、氨 195–240 K、乙烷 90–185 K、甲烷 91–112 K、氮 63–77 K':
      'T_s is compared with each solvent\'s melting–boiling range at 1 atm: water 273–373 K, ammonia 195–240 K, ethane 90–185 K, methane 91–112 K, nitrogen 63–77 K',
    'S_eff = S⊙ + aT★ + bT★² + cT★³ + dT★⁴（T★ = T_eff − 5780 K），d = √(L/S_eff)；保守边界取湿温室（内）与最大温室（外），宽松边界取"近期金星"与"早期火星"。':
      'S_eff = S⊙ + aT★ + bT★² + cT★³ + dT★⁴ (T★ = T_eff − 5780 K), d = √(L/S_eff); the conservative edges are the moist greenhouse (inner) and the maximum greenhouse (outer), the optimistic ones "recent Venus" and "early Mars".',
    '对太阳复现 0.99 / 1.70 / 0.75 / 1.77 AU':
      'For the Sun it reproduces 0.99 / 1.70 / 0.75 / 1.77 AU',
    'H(t) = Σ H_i·2^{(4.54−t)/T_{1/2,i}}（²³⁸U 8.0 TW/4.468 Gyr、²³⁵U 0.4/0.704、²³²Th 8.0/14.05、⁴⁰K 4.0/1.248），产热 ∝ 幔质量、热流 = H/(4πR²)':
      'H(t) = Σ H_i·2^{(4.54−t)/T_{1/2,i}} (²³⁸U 8.0 TW/4.468 Gyr, ²³⁵U 0.4/0.704, ²³²Th 8.0/14.05, ⁴⁰K 4.0/1.248); heating ∝ mantle mass, heat flux = H/(4πR²)',
    '按热流相对地球值 × 质量的 0.3 次方合成的 0–1 指数：热流决定对流强度，质量决定散热路径长度。':
      'A 0–1 index combining heat flux relative to Earth with mass to the power 0.3: heat flux sets the vigour of convection, mass sets the length of the cooling path.',
    '板块构造能否启动至今没有定论':
      'whether plate tectonics can start at all is still unsettled',
    'M_max ≈ (α/α_G)^{3/2}·m_p（Weisskopf 1975：再重，中心压强就会压垮原子间的化学键，天体转由电子简并支撑）。':
      'M_max ≈ (α/α_G)^{3/2}·m_p (Weisskopf 1975: any heavier and the central pressure crushes the chemical bonds between atoms, leaving the body supported by electron degeneracy).',
    '我们的宇宙给出 2.3×10²⁷ kg ≈ 385 M⊕ ≈ 1.2 M_木':
      'Our universe gives 2.3×10²⁷ kg ≈ 385 M⊕ ≈ 1.2 M_Jup',
    /* basis 徽标（STATUS_CN / BASIS_CN）。'启发式' 已在别处收过，这里补齐其余四个。 */
    '实测': 'measured',
    '给定': 'given',
    '真算': 'computed',
    '标度': 'scaling',
    /* 成分分档（evaluate 的 compo） */
    '岩铁（富铁核）': 'Rock and iron (iron-rich core)',
    '硅酸盐岩质': 'Silicate rock',
    '岩石 + 冰': 'Rock + ice',
    '冰 / 含厚包层': 'Ice / thick envelope',
    'H/He 主导': 'H/He dominated',
    /* 八种常见气体（GASES.name）与五种溶剂（SOLVENTS.name）：只在气体/溶剂清单里出现 */
    '氢 H₂': 'hydrogen H₂',
    '氦 He': 'helium He',
    '甲烷 CH₄': 'methane CH₄',
    '水蒸气 H₂O': 'water vapour H₂O',
    '氮 N₂': 'nitrogen N₂',
    '氧 O₂': 'oxygen O₂',
    '氩 Ar': 'argon Ar',
    '二氧化碳 CO₂': 'carbon dioxide CO₂',
    '水': 'water',
    '氨': 'ammonia',
    '甲烷': 'methane',
    '乙烷': 'ethane',
    '氮': 'nitrogen',
    /* describeLong 的气体清单只取名字的前一半（GASES.name.split(' ')[0]） */
    '氢': 'hydrogen',
    '氦': 'helium',
    '水蒸气': 'water vapour',
    '氧': 'oxygen',
    '氩': 'argon',
    '二氧化碳': 'carbon dioxide',
    '成分未知': 'composition unknown',
    /* 天体没名字时的兜底称呼（buildReport / describeLong） */
    '这颗行星': 'this planet',
    '这颗星球': 'this world',
    '母恒星': 'its host star'
  }, 'mirror');

  /* ---- 模板翻译器：中文模板 → 英文模板（翻模板不翻实例） ----
   * 引擎把数值拼进中文句子，实例串没法逐字进词典。这里把模板编译成锚定正则，
   * MirrorI18n.tx(s) 在显示层拿整句实例来匹配。槽位转换器见本册顶部注释。
   * 没命中的原样返回中文——与 t() 同一哲学：宁可中英混排，不出裸 key。 */
  (function () {
    if (I.tx) return;                      // 已装过（防重复加载）
    var PAT = [];
    /* 词槽（{n:w} / {n:lw}）：先查这张表，再落词典。收「语境化短词」。 */
    var WORD = {
      '光速': 'Speed of light',
      '引力常数': 'Gravitational constant',
      '约化普朗克常数': 'Reduced Planck constant',
      '普朗克常数': 'Planck constant',
      '基本电荷': 'Elementary charge',
      '有': 'yes', '无': 'no',
      '无涨落': 'no fluctuations',
      '暗能量过早主导': 'dark energy dominates too early',
      '在坍缩前来不及': 'not enough time before the collapse',
      '增长被冻结': 'growth is frozen',
      '没有硅': 'no silicon', '没有磷': 'no phosphorus', '没有硫': 'no sulfur',
      '可能': 'possible', '不可能': 'not possible',
      '三氦过程产不出足够的碳/氧': 'the triple-alpha process cannot make enough carbon or oxygen',
      '没有液态水窗口': 'there is no liquid-water window',
      '复杂化学受限': 'complex chemistry is limited',
      '低': 'low', '中': 'medium', '高': 'high'
    };
    function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    /* 槽位不许吞句号/分号：模板 '空间维数是{0:cn}' 以槽结尾，若捕获组是 [\s\S]+?，
       多句长文会被整段吞进槽里"看似命中"。逐句切分交给 tx() 做，这里只在句内匹配。 */
    function compile(zh, en) {
      var slots = [], rx = '', last = 0, m, re = /\{(\d+)(?::([a-z]+))?\}/g;
      while ((m = re.exec(zh))) {
        rx += escRe(zh.slice(last, m.index)) + '([^。；]+?)';
        slots.push(m[2] || '');
        last = m.index + m[0].length;
      }
      rx += escRe(zh.slice(last));
      /* 字面量越长的模板越具体，先试：否则 '旋涡星系 {0}' 会抢在
         '{0:s}（银河系，含数据层）' 前面把整串吞掉 */
      var lit = zh.replace(/\{\d+(?::[a-z]+)?\}/g, '').length;
      PAT.push([new RegExp('^' + rx + '$'), en, slots, lit]);
      PAT.sort(function (a, b) { return b[3] - a[3]; });
    }
    function num4(x) { return String(Number(x.toPrecision(4))); }
    /* 引擎 formatTime / adapter fmtTimeGyr 的中文时间串 → 规范英文。
       万/亿是十进位组：等值换算到 kyr/Myr/Gyr（38 万年 → 380 kyr，138 亿年 → 13.8 Gyr）。 */
    function cvTime(s) {
      s = String(s).trim();
      var neg = '';
      if (s.charAt(0) === '−' || s.charAt(0) === '-') { neg = s.charAt(0); s = s.slice(1); }
      var m, v;
      if ((m = s.match(/^([\d.eE+\-×⁰¹²³⁴⁵⁶⁷⁸⁹⁻^]+) 秒$/))) return neg + m[1] + ' s';
      if ((m = s.match(/^([\d.]+) 分钟$/))) return neg + m[1] + ' min';
      if ((m = s.match(/^([\d.]+) 小时$/))) return neg + m[1] + ' h';
      if ((m = s.match(/^([\d.]+) 天$/))) return neg + m[1] + ' d';
      if ((m = s.match(/^([\d.]+(?:e[+\-]?\d+)?) 年$/))) return neg + m[1] + ' yr';
      if ((m = s.match(/^([\d.]+(?:e[+\-]?\d+)?) 万年$/))) {
        v = parseFloat(m[1]) * 1e4;
        return neg + (v < 1e6 ? num4(v / 1e3) + ' kyr' : num4(v / 1e6) + ' Myr');
      }
      if ((m = s.match(/^([\d.]+(?:e[+\-]?\d+)?) 亿年$/))) {
        v = parseFloat(m[1]) * 1e8;
        return neg + (v < 1e9 ? num4(v / 1e6) + ' Myr' : num4(v / 1e9) + ' Gyr');
      }
      if ((m = s.match(/^10(\^?[\d⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+) 年$/))) return neg + '10' + m[1] + ' yr';
      return null;
    }
    /* 中文数词 → 阿拉伯数字（engine cnNumber / cnInt 的逆）：三 → 3、二点五 → 2.5、一千八百三十六 → 1836 */
    var CN_D = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    function cnIntBack(s) {
      if (/^\d+$/.test(s)) return s;
      var n = 0, cur = 0;
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (CN_D[ch] != null) cur = CN_D[ch];
        else if (ch === '十') { n += (cur || 1) * 10; cur = 0; }
        else if (ch === '百') { n += (cur || 1) * 100; cur = 0; }
        else if (ch === '千') { n += (cur || 1) * 1000; cur = 0; }
        else return null;
      }
      return String(n + cur);
    }
    function cvCn(s) {
      s = String(s);
      if (/^[\d.]+$/.test(s)) return s;
      var p = s.split('点');
      var a = cnIntBack(p[0]);
      if (a == null) return null;
      if (p.length === 1) return a;
      var frac = '';
      for (var i = 0; i < p[1].length; i++) { var d = CN_D[p[1].charAt(i)]; if (d == null) return null; frac += d; }
      return a + '.' + frac;
    }
    function conv(kind, g) {
      if (kind === 't') { var t = cvTime(g); return t != null ? t : g; }
      if (kind === 'cn') { var c = cvCn(g); return c != null ? c : g; }
      if (kind === 'w') { return WORD[g] || I.t(g, 'app'); }
      if (kind === 'lw') { var w = WORD[g] || I.t(g, 'app'); return w.charAt(0).toLowerCase() + w.slice(1); }
      if (kind === 's') { return tx(g); }
      if (kind === 'l') { return g.split('、').map(function (x) { return tx(x); }).join(', '); }
      /* {n:ll} 同 {n:l}，但把每一项的首字母压成小写 —— 词典里「液态水」这类词条为了当小标题
         用的是大写开头（'Liquid water'），塞进句子中间的清单里就会大写满天飞。
         只动 Xx 开头的（'Liquid water'），'H/He'、'CO₂'、'NASA' 这种全大写/带符号的不碰。 */
      if (kind === 'll') {
        return g.split('、').map(function (x) {
          var v = tx(x);
          return /^[A-Z][a-z]/.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : v;
        }).join(', ');
      }
      if (kind === 'el') { return g === '无' ? 'none' : g; }
      /* {n:n} 天体名。过程生成的名字是「通名 + 专名」（'恒星 K-1234'），整串查词典永远查不到；
         只换通名前缀，专名（种子抽的编号、用户起的名）一个字都不动。与 ui/planets.js 的 TRN 同口径。 */
      if (kind === 'name') {
        /* 引擎的 pad() 会在拉丁字母/数字结尾的名字后补一个空格，免得中文挤在一起；
           英文模板自己带空格，所以这里先把尾部空白去掉，不然会出现两个空格。 */
        var gn = String(g).replace(/\s+$/, ''), mn = /^恒星\s(.+)$/.exec(gn);
        return mn ? I.t('恒星 ', 'mirror') + mn[1] : tx(gn);
      }
      /* {n:host} 句子中间的宿主恒星名。与 {n:name} 同一套，只是太阳在英文里要带冠词
         （「绕太阳公转」→「around the Sun」），而句首那一格不能带，所以分成两个转换器。 */
      if (kind === 'host') { var hv = conv('name', g); return hv === 'Sun' ? 'the Sun' : hv; }
      return g;
    }
    function lookup(s) {
      var v = I.t(s, 'app');
      if (v !== s) return v;
      var t = cvTime(s);
      if (t != null) return t;
      for (var i = 0; i < PAT.length; i++) {
        var P = PAT[i], m = P[0].exec(s);
        if (m) {
          var slots = P[2];
          /* 英文模板里也可写 {n:t} 之类的注记，替换时一并吃掉（转换器以中文侧槽位为准） */
          return P[1].replace(/\{(\d+)(?::[a-z]+)?\}/g, function (_, n) { return conv(slots[+n], m[+n + 1]); });
        }
      }
      return null;
    }
    function txPiece(s) {
      var hit = lookup(s);
      if (hit != null) return hit;
      if (/。$/.test(s)) { hit = lookup(s.slice(0, -1)); if (hit != null) return /[.!?)）]$/.test(hit) ? hit : hit + '.'; }
      return null;
    }
    var CJK_RE = /[㐀-鿿]/;
    function puncSwap(s) {
      return s.replace(/（/g, ' (').replace(/）/g, ')').replace(/，/g, ', ').replace(/；/g, '; ')
        .replace(/：/g, ': ').replace(/、/g, ', ').replace(/。/g, '. ')
        .replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
    }
    function txSemi(s) {
      var parts = s.split('；'), out = [], any = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p === '') { out.push(p); continue; }
        var h = txPiece(p);
        if (h != null) { any = true; out.push(i < parts.length - 1 ? h.replace(/\.$/, '') : h); }
        else out.push(p);
      }
      return any ? out.join('; ') : null;
    }
    /**
     * MirrorI18n.tx(s)：显示层的引擎叙事翻译。
     * 整句 → 词典 / 时间串 / 模板；多句（describe() 把带句号的句子 join('')）→ 逐句；
     * 分号长句（constantsReport.sentence）→ 逐段；只剩中文标点、没有中文词 → 换标点。
     */
    function tx(s) {
      if (s == null) return s;
      s = String(s);
      if (!s || I.lang() === 'zh') return s;
      var hit = txPiece(s);
      if (hit != null) return hit;
      if (s.indexOf('。') >= 0) {
        var pieces = s.match(/[^。]*。[）」”’']*|[^。]+$/g);
        if (pieces && pieces.length > 1) {
          var out = [], any = false;
          for (var i = 0; i < pieces.length; i++) {
            var p = pieces[i];
            if (!p) continue;
            var h = txPiece(p);
            if (h == null && p.indexOf('；') >= 0) h = txSemi(p);
            /* 这一截已经是英文了（拼进来的片段在生成时就过了 t()），只剩个中文句号。
               整句版本末尾有同样的兜底，逐句这一路原来没有，于是 describeStar 的
               「遗骸说明」那一句会挂着个「。」留在英文里。 */
            if (h == null && !CJK_RE.test(p) && /[（），；：、。]/.test(p)) h = puncSwap(p);
            if (h != null) { out.push(h); any = true; } else out.push(p);
          }
          if (any) return out.join(' ');
        }
      }
      if (s.indexOf('；') >= 0) { var h2 = txSemi(s); if (h2 != null) return h2; }
      if (!CJK_RE.test(s) && /[（），；：、。]/.test(s)) return puncSwap(s);
      return s;
    }

    /* ---- 模板表：时间线 / 结论 / 发现 / 常数核对 / 3D 层 ----
       槽位一律按出现顺序编号；英文侧可重排。 */
    [
      /* 时间线（engine buildTimeline） */
      '空间膨胀 e^{0} 倍，量子涨落被拉成密度皱纹', 'Space inflates by e^{0}; quantum fluctuations are stretched into density wrinkles',
      '空间膨胀 e^{0} 倍', 'Space inflates by e^{0}',
      'T≈10⁹ K，Y_p={0}（氢几乎耗尽）', 'T≈10⁹ K, Y_p={0} (hydrogen almost exhausted)',
      'T≈10⁹ K，Y_p={0}', 'T≈10⁹ K, Y_p={0}',
      'z_eq≈{0}，引力开始放大密度涨落', 'z_eq≈{0}; gravity starts amplifying density perturbations',
      'z_rec≈{0}（去耦 z≈{1}），电子落入原子，宇宙变得透明', 'z_rec≈{0} (decoupling z≈{1}); electrons fall into atoms and the universe becomes transparent',
      '3σ 峰（10⁸ M⊙）坍缩，z≈{0}，核聚变点燃', '3σ peaks (10⁸ M⊙) collapse at z≈{0}; nuclear fusion ignites',
      '2σ 的 10¹² M⊙ 涨落非线性化，z≈{0}', '2σ fluctuations of 10¹² M⊙ go nonlinear at z≈{0}',
      '转向于 {0:t}（a_max={1}），随后坍缩回奇点', 'Turnaround at {0:t} (a_max={1}), then collapse back to a singularity',
      /* 结局判定的 reasons（choose() 的 why） */
      'D={0}（涌现）：D≥4 无稳定轨道/原子基态', 'D={0} (emergent): no stable orbits or atomic ground states for D≥4',
      'D={0}：D≥4 无稳定轨道/原子基态', 'D={0}: no stable orbits or atomic ground states for D≥4',
      'D={0}（涌现）：D≤2 无牛顿吸引', 'D={0} (emergent): no Newtonian attraction for D≤2',
      'D={0}：D≤2 无牛顿吸引', 'D={0}: no Newtonian attraction for D≤2',
      'D={0}（涌现）≠3：核合成/恒星/化学/宜居公式只对 3 维成立，以下为 3 维公式外推，不构成观察者判断', 'D={0} (emergent) ≠3: the nucleosynthesis/stellar/chemistry/habitability formulas hold only in 3 dimensions; what follows extrapolates the 3-D formulas and is no judgement about observers',
      'D={0}≠3：核合成/恒星/化学/宜居公式只对 3 维成立，以下为 3 维公式外推，不构成观察者判断', 'D={0}≠3: the nucleosynthesis/stellar/chemistry/habitability formulas hold only in 3 dimensions; what follows extrapolates the 3-D formulas and is no judgement about observers',
      '闭合几何转向坍缩', 'Closed geometry turns around and collapses',
      '原初黑洞比例 β={0}', 'Primordial black-hole fraction β={0}',
      'Q_eff≥10⁻³ 团块在冷却前坍缩', 'Q_eff≥10⁻³: clumps collapse before they can cool',
      '涨落在冻结前未能非线性化', 'Fluctuations failed to go nonlinear before freezing',
      '超过 Weinberg 上界', 'Above the Weinberg bound',
      '质子衰变', 'Protons decay',
      'Zα→1 电子壳层不稳定', 'Zα→1: electron shells are unstable',
      '恒星质量标度非有限（参数越出 Adams 2008 标度的适用范围）', 'The stellar mass scale is not finite (parameters outside the range of the Adams 2008 scaling)',
      '氘核不束缚', 'The deuteron is unbound',
      '可居住性 {0} < 0.4', 'Habitability {0} < 0.4',
      '可居住性 {0}', 'Habitability {0}',
      /* 结论散文（describe()，逐句） */
      '弦气冷却后解开了{0:cn}维（ε={1}…），空间维数是{2:cn}', 'After the string gas cooled, {0:cn} dimensions unwound (ε={1}…); the spatial dimension is {2:cn}',
      '空间维数是{0:cn}', 'The spatial dimension is {0:cn}',
      '力按 r^{−{0}} 衰减，D≥4 时圆轨道对径向微扰不稳定（Ehrenfest 1917），氢原子的哈密顿量没有下界：任何靠得近的两个东西要么坠向彼此，要么永远分开', 'The force falls off as r^{−{0}}; for D≥4 circular orbits are unstable to radial perturbations (Ehrenfest 1917) and the hydrogen Hamiltonian has no lower bound: any two things that come close either fall into each other or separate forever',
      '本引擎的核合成/恒星/化学/宜居公式只对 3 维空间成立；下列数值是把 3 维公式外推到 D={0} 的结果，仅供参考，不构成"可能诞生观察者"的判断', 'This engine\'s nucleosynthesis, stellar, chemistry and habitability formulas hold only in 3 spatial dimensions; the numbers below extrapolate the 3-D formulas to D={0}, are for reference only, and constitute no "observers possible" judgement',
      '力 ∝ r^{−{0}}：圆轨道对径向微扰稳定（D<4）但不闭合（进动），氢原子有基态而能级与化学显著改变（Ehrenfest 1917；Tegmark 1997）', 'Force ∝ r^{−{0}}: circular orbits are stable to radial perturbations (D<4) but do not close (they precess); hydrogen has a ground state, with markedly altered energy levels and chemistry (Ehrenfest 1917; Tegmark 1997)',
      '力 ∝ r^{−{0}}：有牛顿吸引但引力聚集更弱，拓扑上复杂网络受限（Tegmark 1997）', 'Force ∝ r^{−{0}}: Newtonian attraction exists, but gravitational clustering is weaker and complex networks are topologically constrained (Tegmark 1997)',
      '外推数值：复合 z≈{0}，星系尺度坍缩 z≈{1}，氦丰度 {2}，太阳质量恒星寿命 {3:t}——均未做 D≠3 修正', 'Extrapolated values: recombination z≈{0}, galaxy-scale collapse z≈{1}, helium abundance {2}, solar-mass stellar lifetime {3:t} — none corrected for D≠3',
      '外推数值：复合 z≈{0}，星系尺度未坍缩，氦丰度 {1}，太阳质量恒星寿命 {2:t}——均未做 D≠3 修正', 'Extrapolated values: recombination z≈{0}, no galaxy-scale collapse, helium abundance {1}, solar-mass stellar lifetime {2:t} — none corrected for D≠3',
      '膨胀在 {0:t} 后停止（a_max={1}），引力赢了', 'Expansion stops after {0:t} (a_max={1}) — gravity wins',
      '宇宙用 {0:t} 走完从奇点到奇点的一个来回', 'The universe takes {0:t} for the full round trip from singularity to singularity',
      '途中曾形成星系（z≈{0}，{1:t}），甚至可能有过观察者，眼看着天空由红移转为蓝移，随后一同被压碎', 'Along the way galaxies did form (z≈{0}, {1:t}) — perhaps even observers, watching the sky turn from redshift to blueshift — before everything was crushed together',
      '途中曾形成星系（z≈{0}，{1:t}），随后一同被压碎', 'Along the way galaxies did form (z≈{0}, {1:t}), then were crushed together',
      '真空能 Ω_Λ≈{0}，是 Weinberg 上界的 {1} 倍：Λ 在星系坍缩前就主导了膨胀', 'The vacuum energy Ω_Λ≈{0} is {1} times the Weinberg bound: Λ came to dominate the expansion before galaxies could collapse',
      '星系尺度的线性涨落最大只长到 {0}（临界 1.686），在增长冻结之前没有非线性化', 'Galaxy-scale linear fluctuations grow at most to {0} (critical value 1.686) and never go nonlinear before growth freezes',
      '视界尺度的涨落 σ_hor={0}，按 Carr 阈值有 β={1} 的质量在辐射时代就坍缩成原初黑洞', 'Horizon-scale fluctuations σ_hor={0}: by the Carr threshold, a mass fraction β={1} collapses into primordial black holes already in the radiation era',
      'Q_eff={0}：坍缩团块的位力速度约 {1} km/s，气体来不及冷却成恒星就落进视界（Tegmark & Rees 1998）', 'Q_eff={0}: collapsing clumps have virial velocities of about {1} km/s, and the gas falls through the horizon before it can cool into stars (Tegmark & Rees 1998)',
      'm_n−m_p={0} MeV < −mₑ：质子衰变为中子，宇宙里没有氢，也没有任何原子——只有中子与中子星', 'm_n−m_p={0} MeV < −mₑ: protons decay into neutrons — no hydrogen and no atoms at all, only neutrons and neutron stars',
      'α={0}：Zα 逼近 1，多电子原子的内层轨道坠入负能海，没有稳定的原子壳层', 'α={0}: Zα approaches 1, the inner orbitals of many-electron atoms plunge into the negative-energy sea, and no atomic shell is stable',
      '引力照常工作，星系在 {0:t}（z≈{1}）形成，但恒星质量标度 M₀=α_G^{−3/2}m_p 在这组参数下非有限（Adams 2008 的标度关系不再适用），引擎不做外推', 'Gravity works as usual and galaxies form at {0:t} (z≈{1}), but the stellar mass scale M₀=α_G^{−3/2}m_p is not finite for these parameters (the Adams 2008 scaling no longer applies); the engine does not extrapolate',
      '引力照常工作，星系在 {0:t}（z≈{1}）形成，但氘核结合能 {2} MeV ≤ 0，pp 链第一步走不通', 'Gravity works as usual and galaxies form at {0:t} (z≈{1}), but the deuteron binding energy {2} MeV ≤ 0, so the first step of the pp chain fails',
      '引力照常工作，星系在 {0:t}（z≈{1}）形成，但中子太重（m_n−m_p={2} MeV），氘核内的中子也会衰变，pp 链第一步走不通', 'Gravity works as usual and galaxies form at {0:t} (z≈{1}), but the neutron is too heavy (m_n−m_p={2} MeV) — even the neutron inside a deuteron decays — so the first step of the pp chain fails',
      '引力照常工作，星系在 {0:t}（z≈{1}）形成，但点火质量 {2} M⊙ 超过辐射压上限', 'Gravity works as usual and galaxies form at {0:t} (z≈{1}), but the ignition mass {2} M⊙ exceeds the radiation-pressure limit',
      '恒星点燃了（第一代恒星 {0:t}），宇宙有光', 'Stars ignited (first stars at {0:t}) — the universe has light',
      '但双质子束缚，氢在大爆炸核合成里就烧光了（Y_p={0}），剩下惰性的氦，没有可以复杂化的化学', 'But the diproton is bound: hydrogen burned away during Big Bang nucleosynthesis (Y_p={0}), leaving inert helium — there is no chemistry that can grow complex',
      '但原子核最多到 Z={0}，没有碳，没有可以复杂化的化学', 'But nuclei stop at Z={0} — no carbon, no chemistry that can grow complex',
      '恒星寿命约 {0:t}，然后是黑暗', 'The stars live about {0:t}, and then comes darkness',
      '结构、恒星、化学都存在：第一代恒星 {0:t}，星系 {1:t}', 'Structure, stars and chemistry all exist: first stars at {0:t}, galaxies at {1:t}',
      '恒星寿命只有 {0:t}', 'stellar lifetimes are only {0:t}',
      '造不出铁以上的元素', 'no elements beyond iron can be made',
      '超新星哑火，重元素锁在恒星里', 'supernovae fizzle and the heavy elements stay locked inside the stars',
      'Q 越出 Tegmark–Rees 窗口（星系过密/过稀）', 'Q falls outside the Tegmark–Rees window (galaxies too dense or too sparse)',
      '距终结只有 {0:t}', 'only {0:t} remain before the end',
      '条件勉强', 'conditions are marginal',
      '但{0:l}，复杂化学没有足够的时间或舞台（可居住性 {1}）', 'But {0:l} — complex chemistry lacks the time or the stage (habitability {1})',
      '结构、恒星与化学都存在：第一代恒星 {0:t}，星系 {1:t}，可用元素 {2:el}', 'Structure, stars and chemistry all exist: first stars at {0:t}, galaxies at {1:t}, available elements {2:el}',
      '但 Hoyle 共振越出容许区间（ξ={0}）：三氦过程的碳产率 ×{1}、氧产率 ×{2}（Oberhummer et al. 2000：核力 ±0.5% 或电磁 ±4% 即骤降），碳-水型生化缺少原料', 'But the Hoyle resonance falls outside the allowed range (ξ={0}): the triple-alpha carbon yield ×{1} and oxygen yield ×{2} (Oberhummer et al. 2000: ±0.5% in the nuclear force or ±4% in electromagnetism suffices for the collapse) — carbon–water biochemistry lacks its raw material',
      '但复杂化学受限（Z_max={0}），碳-水型生化难以搭建', 'But complex chemistry is limited (Z_max={0}), so carbon–water biochemistry is hard to build',
      '恒星寿命 {0:t}，行星在 {1} AU 附近凝结，但没有碳-水型的生命化学', 'Stars live {0:t} and planets condense near {1} AU, but there is no carbon–water life chemistry',
      '替代生化模块（推测）：硅基/非水溶剂倾向 {0:w}，无公认判据', 'Alternative-biochemistry module (speculative): silicon / non-aqueous tendency {0:w}; no accepted criterion',
      '复合于 z≈{0}（去耦 z≈{1}），第一代恒星在 {2:t} 点燃，星系形成于 {3:t}，太阳质量恒星可以燃烧 {4:t}；原初氦丰度 {5}，重元素被锻造并散布出去，行星凝结，化学在足够长的时间里展开', 'Recombination at z≈{0} (decoupling z≈{1}); the first stars ignite at {2:t}, galaxies form at {3:t}, and a solar-mass star can burn for {4:t}. Primordial helium abundance {5}; heavy elements are forged and dispersed, planets condense, and chemistry unfolds over a long enough span',
      '生物化学基础：碳与氧由三氦过程产出（Hoyle 共振在容许区间内，ξ={0}），液态水窗口存在（d≈{1} AU），复杂化学可行（{2}）→ 碳-水型生化可能', 'Biochemical foundations: carbon and oxygen come from the triple-alpha process (the Hoyle resonance sits in the allowed range, ξ={0}), a liquid-water window exists (d≈{1} AU), and complex chemistry works ({2}) → carbon–water biochemistry is possible',
      '注意：恒星质量标度 M_min={0} M⊙ 已超出 Adams 2008 牛顿标度的合理适用范围（≳300 M⊙）；可居住性判断建立在此外推之上，结论仅供参考——真实物理下这类致密天体更可能直接坍缩为黑洞', 'Note: the stellar mass scale M_min={0} M⊙ is beyond the reasonable range of the Newtonian Adams 2008 scaling (≳300 M⊙); the habitability judgement rests on this extrapolation and is indicative only — in real physics such compact objects would more likely collapse directly into black holes',
      /* 常数核对（constantsReport 各条 text 与有量纲句） */
      '精细结构常数是{0:cn}分之一', 'The fine-structure constant is 1/{0:cn}',
      '电子与质子的质量比是{0:cn}分之一', 'The electron-to-proton mass ratio is 1/{0:cn}',
      '质子质量 {0} MeV（Λ_QCD={1} MeV）', 'Proton mass {0} MeV (Λ_QCD={1} MeV)',
      '上夸克 {0} MeV、下夸克 {1} MeV', 'Up quark {0} MeV, down quark {1} MeV',
      '费米子有{0:cn}代', 'There are {0:cn} fermion generations',
      'H₀={0}，Ω_b={1}，Ω_c={2}，Ω_Λ={3}', 'H₀={0}, Ω_b={1}, Ω_c={2}, Ω_Λ={3}',
      'A_s={0}（Q≈{1}），n_s={2}', 'A_s={0} (Q≈{1}), n_s={2}',
      '光速 {0} m/s，引力常数 {1} m³·kg⁻¹·s⁻²，普朗克常数 {2} J·s（单位约定 {3}）', 'Speed of light {0} m/s, gravitational constant {1} m³·kg⁻¹·s⁻², Planck constant {2} J·s (unit convention {3})',
      /* 有量纲常数的条目散文与公式（dimensionfulEntries） */
      '在约定 {0}（{1:w}）下，{2:lw}固定为我们的数值 {3} {4}', 'In convention {0} ({1:w}), the {2:lw} is fixed at our value, {3} {4}',
      '在约定 {0}（{1:w}）下，这个宇宙的{2:lw}为 {3} {4}（我们的 {5} 倍）', 'In convention {0} ({1:w}), this universe\'s {2:lw} is {3} {4} ({5}× ours)',
      '{0} 在本约定下固定为我们的数值', '{0} is fixed at our value in this convention',
      '{0:w}（{1} 约定）', '{0:w} (convention {1})',
      /* 发现（findings）里带插值的 valueText / text */
      'D={0}（{1} 维饱和解开、{2} 维部分解开，w={3}）', 'D={0} ({1} dimensions fully unwound, {2} partially, w={3})',
      'D={0}（{1} 维饱和解开，w={2}）', 'D={0} ({1} dimensions fully unwound, w={2})',
      '只解开了 {0} 维', 'Only {0} dimensions unwound',
      '弦气过热、缠绕模不足，解开了 {0} 维', 'The string gas overheated and winding modes ran short: {0} dimensions unwound',
      '空间维数 D={0}（status: accepted-fact, no-mechanism；开启弦气模块可由初始条件派生）', 'Spatial dimension D={0} (status: accepted-fact, no-mechanism; switch on the string-gas module to derive it from initial conditions)',
      'D={0}：力 ∝ r^{−{1}}，D≥4 时圆轨道对径向微扰不稳定，氢原子哈密顿量无下界（势 r^{−{2}} 比 r⁻² 更奇异）——没有稳定轨道，也没有原子基态（Ehrenfest 1917）', 'D={0}: force ∝ r^{−{1}}; for D≥4 circular orbits are unstable to radial perturbations and the hydrogen Hamiltonian has no lower bound (the potential r^{−{2}} is more singular than r⁻²) — no stable orbits and no atomic ground state (Ehrenfest 1917)',
      'D={0}：力 ∝ r^{−{1}}，圆轨道对径向微扰仍稳定（D<4），但不再闭合（进动）；氢原子有基态，能级与化学显著改变', 'D={0}: force ∝ r^{−{1}}; circular orbits are still stable to radial perturbations (D<4) but no longer close (they precess); hydrogen has a ground state, with markedly altered energy levels and chemistry',
      'D={0}：有牛顿吸引，但势 ∝ r^{−{1}} 更平缓、引力聚集更弱；拓扑上复杂网络受限（Tegmark 1997）', 'D={0}: Newtonian attraction exists, but the potential ∝ r^{−{1}} is shallower and gravitational clustering weaker; complex networks are topologically constrained (Tegmark 1997)',
      'D={0}：D≤2 时引力势为对数/排斥，没有牛顿吸引，物质无法聚集（2+1 维引力无局域自由度）', 'D={0}: for D≤2 the gravitational potential is logarithmic or repulsive — no Newtonian attraction, matter cannot clump (2+1-dimensional gravity has no local degrees of freedom)',
      '轨道稳定 {0:w}，牛顿吸引 {1:w}，可居住性因子 {2}', 'Stable orbits: {0:w} · Newtonian attraction: {1:w} · habitability factor {2}',
      '结构增长、恒星与原子标度按 D=3 公式计算；可居住性乘 {0}', 'Structure growth and the stellar and atomic scalings use the D=3 formulas; habitability is multiplied by {0}',
      '本引擎的 Friedmann/Saha/BBN/Press–Schechter/Adams 标度都是 3+1 维公式；D={0} 时只在可居住性上打折，未重推各步的 D 依赖', 'The Friedmann/Saha/BBN/Press–Schechter/Adams scalings in this engine are all 3+1-dimensional formulas; at D={0} only the habitability is discounted — the D dependence of each step has not been rederived',
      'D={0:cn}：非整数维没有严格的物理定义（可视为一种数学练习，标推测），这里把力律 r^{−(D−1)} 与判据按 D 连续插值', 'D={0:cn}: non-integer dimensions have no strict physical definition (view it as a mathematical exercise, tagged speculative); the force law r^{−(D−1)} and the criteria interpolate continuously in D',
      'N_gen={0}：CKM 矩阵没有不可消去的相位，没有 CP 破坏（且假定无其它来源），物质与反物质对称湮灭，只剩光子与暗物质', 'N_gen={0}: the CKM matrix has no irremovable phase — no CP violation (and no other source is assumed), so matter and antimatter annihilate symmetrically, leaving only photons and dark matter',
      '年龄(a=1) {0:t}，H(a=1)={1} km/s/Mpc', 'Age (a=1) {0:t}, H(a=1)={1} km/s/Mpc',
      'a=1 时年龄 {0:t}', 'Age at a=1: {0:t}',
      '膨胀在 {0:t}（a_max={1}）转向，{2:t} 后回到奇点', 'Expansion turns around at {0:t} (a_max={1}) and returns to a singularity after {2:t}',
      'z_eq={0}，t_eq={1:t}', 'z_eq={0}, t_eq={1:t}',
      '相等发生于 z≈{0}，之后涨落才开始线性增长（Meszaros 效应）', 'Equality occurs at z≈{0}; only after that do fluctuations begin to grow linearly (the Meszaros effect)',
      'Ω 之和为 {0}：a=1 处 H={1} km/s/Mpc（≠H₀={2}）', 'The Ω sum is {0}: at a=1, H={1} km/s/Mpc (≠H₀={2})',
      'z_rec≈{0}（T≈{1} eV，{2:t}）；去耦 z≈{3}', 'z_rec≈{0} (T≈{1} eV, {2:t}); decoupling z≈{3}',
      '电离能 {0} eV；x_e=½ 于 z≈{1}，光子去耦（x_e≈0.01）于 z≈{2}、{3:t}，宇宙变得透明', 'Ionisation energy {0} eV; x_e=½ at z≈{1}, photon decoupling (x_e≈0.01) at z≈{2}, {3:t} — the universe becomes transparent',
      'Δ={0} MeV（mₑ={1} MeV）', 'Δ={0} MeV (mₑ={1} MeV)',
      '中子比质子重 {0} MeV，超过电子质量：氢原子稳定，自由中子衰变', 'The neutron outweighs the proton by {0} MeV, more than the electron mass: hydrogen is stable and free neutrons decay',
      'B_d={0} MeV，Δ={1} MeV', 'B_d={0} MeV, Δ={1} MeV',
      '氘核束缚（结合能 {0} MeV），pp 链第一步 p+p→d 可以走通', 'The deuteron is bound (binding energy {0} MeV), so the first pp-chain step p+p→d works',
      '中子太重（Δ={0} MeV > B_d+mₑ），氘核内的中子也会 β 衰变：大爆炸核合成卡在氘瓶颈，恒星也无法通过 pp 链点燃', 'The neutron is too heavy (Δ={0} MeV > B_d+mₑ) — even the neutron inside a deuteron β-decays: Big Bang nucleosynthesis stalls at the deuterium bottleneck, and stars cannot ignite via the pp chain either',
      'Y_p={0}，D/H={1}', 'Y_p={0}, D/H={1}',
      'n/p 冻结于 T_f≈{0} MeV，比值 {1}；中子寿命 {2} s，到 BBN（{3} s）剩 {4}', 'n/p freezes out at T_f≈{0} MeV with ratio {1}; the neutron lifetime is {2} s, and by BBN ({3} s) the ratio is down to {4}',
      'n/p 冻结于 T_f≈{0} MeV，比值 {1}；中子寿命 ∞，到 BBN（{2} s）剩 {3}', 'n/p freezes out at T_f≈{0} MeV with ratio {1}; the neutron lifetime is infinite, and by BBN ({2} s) the ratio is {3}',
      '氦质量分数 {0}——氢几乎耗尽', 'Helium mass fraction {0} — hydrogen almost exhausted',
      '氦质量分数 {0}', 'Helium mass fraction {0}',
      'σ₈≈{0}（σ_gal(z=0)={1}，D(1)/D(a_eq)={2}）', 'σ₈≈{0} (σ_gal(z=0)={1}, D(1)/D(a_eq)={2})',
      '今天（a=1）星系尺度线性涨落 {0}，等价 σ₈≈{1}', 'Today (a=1) the galaxy-scale linear fluctuation is {0}, equivalent to σ₈≈{1}',
      '首批天体 z≈{0}（{1:t}）；星系 z≈{2}（{3:t}）', 'First objects z≈{0} ({1:t}); galaxies z≈{2} ({3:t})',
      '首批天体 z≈{0}（{1:t}）；星系：未坍缩（δ_max={2}）', 'First objects z≈{0} ({1:t}); galaxies: no collapse (δ_max={2})',
      '首批天体：未坍缩；星系 z≈{0}（{1:t}）', 'First objects: no collapse; galaxies z≈{0} ({1:t})',
      '首批天体：未坍缩；星系：未坍缩（δ_max={0}）', 'First objects: no collapse; galaxies: no collapse (δ_max={0})',
      '2σ 的 10¹² M⊙ 涨落在 z≈{0} 非线性坍缩，星系形成', '2σ fluctuations of 10¹² M⊙ collapse nonlinearly at z≈{0}; galaxies form',
      '星系尺度涨落最大只长到 {0}（{1:w}），永远停留在线性阶段', 'Galaxy-scale fluctuations grow at most to {0} ({1:w}), staying linear forever',
      '真空能小于结构形成期的物质密度（上界 Ω_Λ≈{0}），星系可以在 Λ 主导前形成', 'The vacuum energy is below the matter density of the structure-forming era (bound Ω_Λ≈{0}); galaxies can form before Λ dominates',
      '真空能是上界的 {0} 倍：Λ 在星系坍缩之前主导膨胀，增长冻结', 'The vacuum energy is {0} times the bound: Λ dominates the expansion before galaxies collapse, and growth freezes',
      '视界尺度涨落 σ_hor={0}，坍缩为原初黑洞的质量比例 β={1}，辐射时代后黑洞主导', 'Horizon-scale fluctuations σ_hor={0}; a mass fraction β={1} collapses into primordial black holes, which dominate after the radiation era',
      '视界尺度涨落 σ_hor={0}，原初黑洞比例可忽略', 'Horizon-scale fluctuations σ_hor={0}; the primordial black-hole fraction is negligible',
      'Q_eff≥10⁻³：坍缩团块的位力速度 ~√Q c≈{0} km/s，气体在冷却成恒星前直接落入视界——黑洞主导', 'Q_eff≥10⁻³: collapsing clumps have virial velocities ~√Q c≈{0} km/s, and the gas falls straight through the horizon before cooling into stars — black holes dominate',
      '小尺度功率被压低约 {0}%', 'Small-scale power is suppressed by about {0}%',
      '质量标度非有限（α_G={0}×、α={1}、mₑ/mₚ={2}）', 'Mass scale not finite (α_G={0}×, α={1}, mₑ/mₚ={2})',
      'M_min={0} M⊙，M_max={1} M⊙（M_max/M_min={2}）·超出牛顿标度适用范围', 'M_min={0} M⊙, M_max={1} M⊙ (M_max/M_min={2}) · beyond the Newtonian scaling\'s range',
      'M_min={0} M⊙，M_max={1} M⊙（M_max/M_min={2}）', 'M_min={0} M⊙, M_max={1} M⊙ (M_max/M_min={2})',
      '标度给出 M_min={0}–M_max={1} M⊙，但 M_min ≳ {2} M⊙ 已超出 Adams 2008 标度关系的合理适用范围（该标度基于牛顿简并压/辐射压论证，未包含大质量端的广义相对论不稳定性与对不稳定性修正；观测主序恒星也极少超过 ~150–300 M⊙）', 'The scaling gives M_min={0}–M_max={1} M⊙, but M_min ≳ {2} M⊙ is beyond the reasonable range of the Adams 2008 scaling (it rests on Newtonian degeneracy/radiation-pressure arguments, without the general-relativistic and pair-instability corrections at the high-mass end; observed main-sequence stars also rarely exceed ~150–300 M⊙)',
      '主序恒星质量范围 {0}–{1} M⊙', 'Main-sequence stellar mass range {0}–{1} M⊙',
      '按 Adams 标度 M_min<M_max 且氘核束缚，形式上可通过 pp 链"点燃"，但点火质量已 ≳ {0} M⊙，越出该标度的合理适用范围：更可能直接坍缩为黑洞，而非稳定主序燃烧', 'By the Adams scaling M_min<M_max and the deuteron is bound, so formally the pp chain can "ignite" — but the ignition mass is ≳ {0} M⊙, beyond the scaling\'s reasonable range: direct collapse to black holes is more likely than stable main-sequence burning',
      't_MS(1 M⊙)={0:t}，L={1} L⊙', 't_MS(1 M⊙)={0:t}, L={1} L⊙',
      '太阳质量恒星寿命 {0:t}，光度 {1} L⊙', 'A solar-mass star lives {0:t}, with luminosity {1} L⊙',
      '原子核最多到 Z≈{0}', 'Nuclei reach at most Z≈{0}',
      'a₀={0} a₀⁰，Ry={1} eV，Z_max,atom={2}', 'a₀={0} a₀⁰, Ry={1} eV, Z_max,atom={2}',
      '原子存在，电子壳层稳定到 Z={0}', 'Atoms exist; electron shells are stable up to Z={0}',
      '可用元素 Z≤{0}，有氢', 'Available elements Z≤{0}, hydrogen present',
      '可用元素 Z≤{0}，无氢', 'Available elements Z≤{0}, no hydrogen',
      'd_HZ={0} AU，行星质量尺度 ×{1}', 'd_HZ={0} AU, planet mass scale ×{1}',
      '岩石行星可以形成，液态水区间在 {0} AU 附近', 'Rocky planets can form; the liquid-water zone lies near {0} AU',
      't_MS={0:t}，窗口={1:t}', 't_MS={0:t}, window={1:t}',
      't_MS={0:t}，窗口=∞', 't_MS={0:t}, window=∞',
      '碳产率 ×{0}，氧产率 ×{1}', 'Carbon yield ×{0}, oxygen yield ×{1}',
      '原子核最多到 Z={0}，没有稳定的氧', 'Nuclei stop at Z={0}; there is no stable oxygen',
      'Hoyle 共振在容许区间内（ξ={0}），恒星同时产出碳与氧', 'The Hoyle resonance sits in the allowed range (ξ={0}); stars produce both carbon and oxygen',
      '核力偏弱/库仑偏强使 Hoyle 能级上移，¹²C 产率降到 ×{0}——几乎没有碳', 'A weaker nuclear force / stronger Coulomb pushes the Hoyle level up; the ¹²C yield drops to ×{0} — almost no carbon',
      '核力偏强/库仑偏弱使 Hoyle 能级下移，¹²C 迅速烧成 ¹⁶O 之前的平衡被打破，¹⁶O 产率降到 ×{0}——几乎没有氧', 'A stronger nuclear force / weaker Coulomb pulls the Hoyle level down, upsetting the balance before ¹²C burns on to ¹⁶O; the ¹⁶O yield drops to ×{0} — almost no oxygen',
      '某轨道处可有液态水：是（d_w≈{0} AU）', 'Liquid water possible on some orbit: yes (d_w≈{0} AU)',
      '在 d≈{0} AU 处行星表面可维持液态水（键能标度 ×{1}）', 'A planetary surface at d≈{0} AU can hold liquid water (bond-energy scale ×{1})',
      '可用元素：{0:el}（Z≤{1}）', 'Available elements: {0:el} (Z≤{1})',
      '周期表在 Z={0} 截止：{1:w}，复杂化学受限', 'The periodic table stops at Z={0}: {1:w} — complex chemistry is limited',
      '原料（C、O）{0} · 溶剂窗口 {1} · 复杂化学 {2} → {3:w}', 'Raw material (C, O) {0} · solvent window {1} · complex chemistry {2} → {3:w}',
      '碳-水型生化不可能：{0:w}', 'Carbon–water biochemistry is not possible: {0:w}',
      '倾向：{0:w}', 'Tendency: {0:w}',
      '硅基或非水溶剂生化的推测倾向：{0:w}（碳受抑 {1:w}，Si 可用 {2:w}，>400 K 轨道 {3:w}，氨/甲烷窗口 {4:w}）', 'Speculative tendency towards silicon or non-aqueous-solvent biochemistry: {0:w} (carbon suppressed: {1:w}, Si available: {2:w}, >400 K orbits: {3:w}, ammonia/methane window: {4:w})',
      'n_s = 1 − 6ε + 2η；r = 16ε = {0}', 'n_s = 1 − 6ε + 2η; r = 16ε = {0}',
      '{0} MeV（方案相关）', '{0} MeV (scheme-dependent)',
      '{0}（m_H≲72 GeV：电弱相变可为一级）', '{0} (m_H≲72 GeV: the electroweak phase transition can be first-order)',
      '{0}（电弱相变为平滑过渡）', '{0} (the electroweak phase transition is a smooth crossover)',
      '{0:cn}维（分数维）', '{0:cn} dimensions (fractional)',
      '{0:cn}维', '{0:cn} dimensions',
      'Λ={0} M_Pl⁴，Ω_Λ={1}', 'Λ={0} M_Pl⁴, Ω_Λ={1}',
      /* 分析面板小结行的复合值（ui/app.js calcSummary） */
      'D={0}（{1:s}）', 'D={0} ({1:s})',
      '{0}（满足）', '{0} (satisfied)',
      '{0}（超出）', '{0} (exceeded)',
      'z≈{0}（{1:t}）', 'z≈{0} ({1:t})',
      '{0}（分数维）', '{0} (fractional)',
      '{0} 个完全展开，{1} 个部分展开', '{0} fully unfurled, {1} partially unfurled',
      '{0} 个完全展开', '{0} fully unfurled',
      '氘束缚 / 双质子束缚', 'deuteron bound / diproton bound',
      '氘束缚 / 双质子不束缚', 'deuteron bound / diproton unbound',
      '氘不束缚 / 双质子束缚', 'deuteron unbound / diproton bound',
      '氘不束缚 / 双质子不束缚', 'deuteron unbound / diproton unbound',
      '有氢 / 有分子 / 化学可行', 'hydrogen / molecules / chemistry works',
      '有氢 / 有分子 / 化学不可行', 'hydrogen / molecules / no chemistry',
      '有氢 / 无分子 / 化学可行', 'hydrogen / no molecules / chemistry works',
      '有氢 / 无分子 / 化学不可行', 'hydrogen / no molecules / no chemistry',
      '无氢 / 有分子 / 化学可行', 'no hydrogen / molecules / chemistry works',
      '无氢 / 有分子 / 化学不可行', 'no hydrogen / molecules / no chemistry',
      '无氢 / 无分子 / 化学可行', 'no hydrogen / no molecules / chemistry works',
      '无氢 / 无分子 / 化学不可行', 'no hydrogen / no molecules / no chemistry',
      '是（超新星哑火）', 'yes (supernovae fizzle)',
      '否（超新星哑火）', 'no (supernovae fizzle)',
      /* 3D 层的动态串（ui/universe3d.js 经 TX() 走这里） */
      '椭圆星系 E{0}', 'Elliptical galaxy E{0}',
      '棒旋星系 SB{0}', 'Barred spiral galaxy SB{0}',
      '旋涡星系 {0}', 'Spiral galaxy {0}',
      '{0:s}（银河系，含数据层）', '{0:s} (Milky Way, with data layer)',
      '{0:s}（示例）', '{0:s} (sample)',
      '位移场分量 {0}/3', 'displacement-field component {0}/3',
      '放置 {0}³ 粒子', 'placing {0}³ particles',
      '距银心 {0} kpc（GRAVITY 2019）· 银盘中平面之上 {1} pc（Bennett & Bovy 2019）· Θ₀ = {2} km/s（BHG 2016）· {3:s}', 'Distance from the Galactic centre {0} kpc (GRAVITY 2019) · {1} pc above the disc midplane (Bennett & Bovy 2019) · Θ₀ = {2} km/s (BHG 2016) · {3:s}',
      '（{0} 十亿光年）', '({0} Gly)',
      '（{0} 百万光年）', '({0} Mly)',
      '（{0} 千光年）', '({0} kly)',
      '（{0} 光年）', '({0} ly)',

      /* ============================================================
         行星引擎的叙事（engine/planet.js）—— 恒星系层与行星层的整段散文。
         引擎只出中文，数值拼在句子里，所以这里翻的是**模板**不是实例：
         数字、单位、公式、文献引用（Kopparapu 2013 / Hayashi 1981 / Heger 2003 /
         Duchêne & Kraus 2013 / HW99 / Jeans / Zahnle & Catling …）一个字符都不动，
         只有中文句式按天文科普的英文重写。时间串走 {n:t}（'336 亿年' → '33.6 Gyr'），
         天体名走 {n:name}（只换 '恒星 ' 前缀，专名不动）。
         ============================================================ */

      /* ---- 恒星简介（describeStar，逐句） ---- */
      '{0:name}是一个黑洞，质量 {1} M⊙、视界半径约 {2} R⊙。',
      '{0:name} is a black hole: mass {1} M⊙, event-horizon radius about {2} R⊙.',
      '它没有光球，也就没有有效温度和光度可言——你在画面上看到的橙色圆环是吸积盘示意，不是它本身在发光。',
      'It has no photosphere, so neither an effective temperature nor a luminosity applies to it — the orange ring you see is a schematic accretion disc, not the object itself shining.',
      '{0:name}是一颗中子星，质量 {1} M⊙、半径 {2} R⊙（约十几公里）、表面温度约 {3} K、光度 {4} L⊙。',
      '{0:name} is a neutron star: mass {1} M⊙, radius {2} R⊙ (a little over ten kilometres), surface temperature about {3} K, luminosity {4} L⊙.',
      '{0:name}是一颗 {1} 型主序星，质量 {2} M⊙、有效温度 {3} K、光度 {4} L⊙、半径 {5} R⊙。',
      '{0:name} is a main-sequence star of spectral type {1}: mass {2} M⊙, effective temperature {3} K, luminosity {4} L⊙, radius {5} R⊙.',
      '{0:name}是一颗 {1} 型{2:s}，质量 {3} M⊙、有效温度 {4} K、光度 {5} L⊙、半径 {6} R⊙。',
      '{0:name} is a {2:s} of type {1}: mass {3} M⊙, effective temperature {4} K, luminosity {5} L⊙, radius {6} R⊙.',
      /* 主序寿命那一截（msTxt）单独成模板：它被括号包着塞进下面两句里，走 {n:s} 递归 */
      '主序寿命约 {0:t}，t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 是标度关系',
      'main-sequence lifetime about {0:t}, from the scaling relation t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5}',
      '主序寿命无法给出：t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 是按 0.075–200 M⊙ 给出的标度关系，这个质量已经远在它的适用范围之外',
      'no main-sequence lifetime can be quoted: t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} is a scaling relation calibrated over 0.075–200 M⊙, and this mass lies far outside that range',
      '它形成于 {0:t}前，前身是一颗 {1} M⊙ 的恒星（{2:s}）；主序阶段早已结束，现在的温度与光度是余热冷却的结果，不再有核聚变供能。',
      'It formed {0:t} ago from a progenitor of {1} M⊙ ({2:s}); the main sequence is long behind it, and its present temperature and luminosity are leftover heat radiating away — no fusion is feeding them.',
      '它形成于 {0:t}前；按 t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 估计，主序寿命约 {1:t}，还剩约 {2:t}（质光关系与主序寿命都是标度关系）。',
      'It formed {0:t} ago; t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} puts its main-sequence lifetime at about {1:t}, of which roughly {2:t} is still to come (both the mass–luminosity relation and the lifetime are scalings).',
      '它形成于 {0:t}前；按 t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 估计，主序寿命约 {1:t}，已经走到主序末端（质光关系与主序寿命都是标度关系）。',
      'It formed {0:t} ago; t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} puts its main-sequence lifetime at about {1:t}, and it has reached the end of it (both the mass–luminosity relation and the lifetime are scalings).',
      '它形成于 {0:t}前；主序寿命无法给出：t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} 是按 0.075–200 M⊙ 给出的标度关系，这个质量已经远在它的适用范围之外。',
      'It formed {0:t} ago; no main-sequence lifetime can be quoted: t_MS ≈ 10 Gyr·(M/M⊙)^{−2.5} is a scaling relation calibrated over 0.075–200 M⊙, and this mass lies far outside that range.',
      /* 多重性 × 有没有行星，八种拼法 */
      '这是一个单星系统。',
      'This is a single-star system.',
      '这是一个单星系统，已经凝出 {0} 颗行星，最内一颗在 {1} AU、最外一颗在 {2} AU。',
      'This is a single-star system, and {0} planets have condensed out of it — the innermost at {1} AU, the outermost at {2} AU.',
      '这是一个双星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据）。',
      'This is a binary system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion).',
      '这是一个双星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据），已经凝出 {0} 颗行星，最内一颗在 {1} AU、最外一颗在 {2} AU。',
      'This is a binary system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion), and {0} planets have condensed out of it — the innermost at {1} AU, the outermost at {2} AU.',
      '这是一个三星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据）。',
      'This is a triple system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion).',
      '这是一个三星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据），已经凝出 {0} 颗行星，最内一颗在 {1} AU、最外一颗在 {2} AU。',
      'This is a triple system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion), and {0} planets have condensed out of it — the innermost at {1} AU, the outermost at {2} AU.',
      '这是一个{0} 合星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据）。',
      'This is a {0}-star multiple system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion).',
      '这是一个{0} 合星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据），已经凝出 {1} 颗行星，最内一颗在 {2} AU、最外一颗在 {3} AU。',
      'This is a {0}-star multiple system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion), and {1} planets have condensed out of it — the innermost at {2} AU, the outermost at {3} AU.',
      /* 只有一颗行星时中文不变、英文要用单数：literal「1」让这四条比上面的通用式先命中
         （PAT 按字面长度排序，多出的那个字符就够了）。 */
      '这是一个单星系统，已经凝出 1 颗行星，最内一颗在 {0} AU、最外一颗在 {1} AU。',
      'This is a single-star system with one planet, orbiting at {0} AU.',
      '这是一个双星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据），已经凝出 1 颗行星，最内一颗在 {0} AU、最外一颗在 {1} AU。',
      'This is a binary system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion) with one planet, orbiting at {0} AU.',
      '这是一个三星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据），已经凝出 1 颗行星，最内一颗在 {0} AU、最外一颗在 {1} AU。',
      'This is a triple system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion) with one planet, orbiting at {0} AU.',
      '这是一个{0} 合星系统（伴星率按 Duchêne & Kraus 2013 随质量缩放，行星轨道要过 HW99 稳定区判据），已经凝出 1 颗行星，最内一颗在 {1} AU、最外一颗在 {2} AU。',
      'This is a {0}-star multiple system (companion fraction scaled with mass after Duchêne & Kraus 2013; planetary orbits have to pass the HW99 stability criterion) with one planet, orbiting at {1} AU.',
      /* 宜居带（Kopparapu 2013）四种拼法 */
      '按 Kopparapu et al. 2013，保守宜居带在 {0}–{1} AU，宽松宜居带在 {2}–{3} AU；落在保守带内的有 {4} 颗（{5:l}）。',
      'Following Kopparapu et al. 2013, the conservative habitable zone runs from {0} to {1} AU and the optimistic one from {2} to {3} AU; {4} planets fall inside the conservative zone ({5:l}).',
      '按 Kopparapu et al. 2013，保守宜居带在 {0}–{1} AU，宽松宜居带在 {2}–{3} AU；落在保守带内的有 {4} 颗（{5:l}）——该多项式只在 2600–7200 K 内有效，这里是外推。',
      'Following Kopparapu et al. 2013, the conservative habitable zone runs from {0} to {1} AU and the optimistic one from {2} to {3} AU; {4} planets fall inside the conservative zone ({5:l}) — but the polynomial is only valid for 2600–7200 K, so this is an extrapolation.',
      '按 Kopparapu et al. 2013，保守宜居带在 {0}–{1} AU，宽松宜居带在 {2}–{3} AU；落在保守带内的有 1 颗（{4:l}）。',
      'Following Kopparapu et al. 2013, the conservative habitable zone runs from {0} to {1} AU and the optimistic one from {2} to {3} AU; one planet falls inside the conservative zone ({4:l}).',
      '按 Kopparapu et al. 2013，保守宜居带在 {0}–{1} AU，宽松宜居带在 {2}–{3} AU；落在保守带内的有 1 颗（{4:l}）——该多项式只在 2600–7200 K 内有效，这里是外推。',
      'Following Kopparapu et al. 2013, the conservative habitable zone runs from {0} to {1} AU and the optimistic one from {2} to {3} AU; one planet falls inside the conservative zone ({4:l}) — but the polynomial is only valid for 2600–7200 K, so this is an extrapolation.',
      '按 Kopparapu et al. 2013，保守宜居带在 {0}–{1} AU，宽松宜居带在 {2}–{3} AU；没有行星落在保守带内。',
      'Following Kopparapu et al. 2013, the conservative habitable zone runs from {0} to {1} AU and the optimistic one from {2} to {3} AU; no planet falls inside the conservative zone.',
      '按 Kopparapu et al. 2013，保守宜居带在 {0}–{1} AU，宽松宜居带在 {2}–{3} AU；没有行星落在保守带内——该多项式只在 2600–7200 K 内有效，这里是外推。',
      'Following Kopparapu et al. 2013, the conservative habitable zone runs from {0} to {1} AU and the optimistic one from {2} to {3} AU; no planet falls inside the conservative zone — and the polynomial is only valid for 2600–7200 K, so this is an extrapolation.',
      '水冰可以凝结的雪线约在 {0} AU（Hayashi 1981 的最小质量星云标度），雪线以内是岩质行星的地盘，以外才可能长出巨行星。',
      'The snow line, where water ice can condense, sits at about {0} AU (scaled from the Hayashi 1981 minimum-mass nebula); inside it the ground belongs to rocky planets, and only outside it can giants grow.',
      /* 遗骸宿主的模型局限声明 */
      '注意：以上宜居带与雪线都按它**现在**的光度算。',
      'Note: the habitable zone and snow line above are both computed from its luminosity **today**.',
      '它在成为{0:s}之前经历过巨星阶段，半径一度可达 1 AU 量级，那时轨道在这个尺度以内的行星多半已被吞没或轨道被改写——本引擎不模拟这段演化，所以这里的行星系统是按当前恒星参数生成的，不是演化史的推演结果（这一条是模型局限，不是这个宇宙的物理）。',
      'Before it became a {0:s} it passed through a giant phase, when its radius could reach the order of 1 AU; planets orbiting inside that scale were most likely swallowed or had their orbits rewritten. This engine does not model that stretch of evolution, so the planetary system shown here is generated from the star\'s present parameters rather than traced through its history (a limitation of the model, not physics of this universe).',
      '数据：恒星质量/温度/光度由恒星系生成器给定 · 主序寿命与质光关系为标度 · 宜居带为真算（Kopparapu et al. 2013）',
      'Data: stellar mass / temperature / luminosity are given by the star-system generator · main-sequence lifetime and the mass–luminosity relation are scalings · the habitable zone is computed (Kopparapu et al. 2013)',
      '数据：恒星质量/温度/光度由恒星系生成器给定 · 主序寿命与质光关系为标度 · 宜居带为真算（Kopparapu et al. 2013） · 遗骸宿主：巨星阶段的吞没未模拟，已在正文注明',
      'Data: stellar mass / temperature / luminosity are given by the star-system generator · main-sequence lifetime and the mass–luminosity relation are scalings · the habitable zone is computed (Kopparapu et al. 2013) · remnant host: engulfment during the giant phase is not modelled, as noted in the text',

      /* ---- 派生量那一列的值（derivedRows.text） ---- */
      '{0:s}（岩铁 {1}% / 冰 {2}% / 气 {3}%）', '{0:s} (rock+iron {1}% / ice {2}% / gas {3}%)',
      '{0} W/m²（地球现今 0.0865）', '{0} W/m² (Earth today 0.0865)',
      '{0} K（{1} ℃），失控温室', '{0} K ({1} ℃) — a runaway greenhouse',
      '{0} K（{1} ℃），已越出灰大气模型的适用范围', '{0} K ({1} ℃) — beyond the range where the grey-atmosphere model holds',
      '{0} h（自转周期 {1} h）', '{0} h (rotation period {1} h)',
      '{0}（活跃）', '{0} (active)',
      '{0}（中等）', '{0} (moderate)',
      '{0}（微弱）', '{0} (faint)',
      '{0}（已冷透）', '{0} (cold through and through)',
      '{0} M⊕（{1} M_木）', '{0} M⊕ ({1} M_Jup)',
      '保守 {0}–{1} AU，宽松 {2}–{3} AU；本行星 {4} AU',
      'conservative {0}–{1} AU, optimistic {2}–{3} AU; this planet {4} AU',
      '夏至/冬至日均辐照比 {0}，无热惯量时地表温度比 {1}',
      'daily-mean insolation ratio summer/winter solstice {0}; with no thermal inertia the surface-temperature ratio is {1}',
      '液态水稳定（沸点 {0} K）', 'liquid water is stable (boiling point {0} K)',
      '气压 {0} Pa 低于三相点 611.657 Pa：水只能在冰与汽之间转换',
      'the pressure of {0} Pa is below the 611.657 Pa triple point: water can only pass between ice and vapour',
      '表面 {0} K 低于 273.16 K：水以冰的形式存在',
      'the surface at {0} K is below 273.16 K: water is there as ice',
      '表面 {0} K 高于该气压下的沸点 {1} K：水只能是蒸汽',
      'the surface at {0} K is above the {1} K boiling point at that pressure: water can only be vapour',
      '{0:l}（在 1 bar 下为液态）', '{0:l} (liquid at 1 bar)',
      '在 1 bar 下没有常见溶剂能保持液态', 'no common solvent stays liquid at 1 bar',
      /* ---- 发现那一行的值（findings.valueText） ---- */
      'T_eq={0} K，τ={1}，T_s={2} K（增温 {3} K）', 'T_eq={0} K, τ={1}, T_s={2} K (warming of {3} K)',
      '保留：{0:l}；逃逸：{1:l}', 'Retained: {0:l}; escaping: {1:l}',
      '保留：无；逃逸：{0:l}', 'Retained: none; escaping: {0:l}',
      '保留：{0:l}；逃逸：无', 'Retained: {0:l}; escaping: none',
      'S={0} S⊕，分界 {1} S⊕', 'S={0} S⊕, divide at {1} S⊕',
      't_lock={0:t}，年龄={1:t}', 't_lock={0:t}, age {1:t}',
      'ε={0}°，夏冬地表温度比 {1}', 'ε={0}°, summer/winter surface-temperature ratio {1}',
      '有（沸点 {0} K）', 'yes (boiling point {0} K)',
      '{0} AU（保守带 {1}–{2} AU）', '{0} AU (conservative zone {1}–{2} AU)',
      'a={0} AU，P={1:t}，S={2} S⊕，R_H={3} R_p', 'a={0} AU, P={1:t}, S={2} S⊕, R_H={3} R_p',
      '{0:s}（等级 {1}）', '{0:s} (level {1})',
      'I_B={0}，I_tec={1}', 'I_B={0}, I_tec={1}',
      /* ---- 行星报告的来源行（sourceLine） ---- */
      '数据：NASA 实测 {0} 项 · 生成器给定 {1} · 种子抽样 {2} · 真算 {3} · 标度 {4} · 启发式 {5}',
      'Data: {0} measured by NASA · {1} given by the generator · {2} seeded · {3} computed · {4} scaled · {5} heuristic',
      '数据：NASA 实测 {0} 项 · 生成器给定 {1} · 真算 {2} · 标度 {3} · 启发式 {4}',
      'Data: {0} measured by NASA · {1} given by the generator · {2} computed · {3} scaled · {4} heuristic',
      '数据：NASA 实测 {0} 项 · 种子抽样 {1} · 真算 {2} · 标度 {3} · 启发式 {4}',
      'Data: {0} measured by NASA · {1} seeded · {2} computed · {3} scaled · {4} heuristic',
      '数据：生成器给定 {0} · 种子抽样 {1} · 真算 {2} · 标度 {3} · 启发式 {4}',
      'Data: {0} given by the generator · {1} seeded · {2} computed · {3} scaled · {4} heuristic',
      '数据：生成器给定 {0} · 真算 {1} · 标度 {2} · 启发式 {3}',
      'Data: {0} given by the generator · {1} computed · {2} scaled · {3} heuristic',
      '数据：种子抽样 {0} · 真算 {1} · 标度 {2} · 启发式 {3}',
      'Data: {0} seeded · {1} computed · {2} scaled · {3} heuristic',
      '数据：真算 {0} · 标度 {1} · 启发式 {2}',
      'Data: {0} computed · {1} scaled · {2} heuristic',

      /* ---- 发现里的说明句（findings.text） ---- */
      '灰大气模型给出的增温为 {0} K。', 'The grey-atmosphere model gives {0} K of warming.',
      '灰大气解越出了模型的适用范围（T_s > 1500 K）：这么厚的大气要用非灰、对流调整的模型才算得准，这里的数只标出量级。',
      'The grey solution has run past where the model is valid (T_s > 1500 K): an atmosphere this thick needs a non-grey, convectively adjusted model to be got right, so the figure here is an order of magnitude only.',
      '水汽正反馈没有收敛：这是一次失控温室，海洋全部进入大气。',
      'The water-vapour feedback never converged: this is a runaway greenhouse, and the whole ocean has gone into the atmosphere.',
      '任何常见气体都留不住，这是一颗裸露的星球。',
      'It cannot hold on to any common gas — a bare world.',
      '只有最重的分子勉强留住，大气会持续变薄。',
      'Only the heaviest molecules barely stay; the atmosphere will keep thinning.',
      '氮、氧一级的分子可以保留，氢与氦会持续逃逸。',
      'Molecules as heavy as nitrogen and oxygen are retained; hydrogen and helium keep escaping.',
      '氮、氧一级的分子可以保留，连氢也留得住。',
      'Molecules as heavy as nitrogen and oxygen are retained — even hydrogen stays.',
      '位于分界线的"有大气"一侧：引力足以对抗累计的 XUV 剥蚀。',
      'It lies on the "has an atmosphere" side of the divide: gravity is enough to hold out against the accumulated XUV stripping.',
      '位于分界线的"无大气"一侧：恒星风与 XUV 的累计剥蚀足以吹光原生大气。',
      'It lies on the "no atmosphere" side of the divide: the accumulated stellar wind and XUV are enough to blow the primordial atmosphere away.',
      '锁定时标远短于年龄，它多半已经被潮汐锁定：一面永昼、一面永夜（除非落入 3:2 之类的自旋轨道共振，如水星）。',
      'The locking timescale is far shorter than its age, so it is most likely tidally locked: one face in permanent day, the other in permanent night (unless it fell into a spin–orbit resonance such as the 3:2 of Mercury).',
      '锁定时标长于年龄，自转不会被恒星潮汐锁定。',
      'The locking timescale is longer than its age, so stellar tides will not lock its rotation.',
      '几乎没有转轴倾角，也就几乎没有季节。',
      'With almost no axial tilt there are almost no seasons.',
      '倾角温和，季节变化在辐射平衡上限内约 {0}%。',
      'The tilt is moderate: seasonal swing reaches about {0}% of the radiative-equilibrium ceiling.',
      '倾角很大，季节极端：高纬度在一年里既是最热也是最冷的地方（天王星的 97.8° 是极端例子）。',
      'The tilt is large and the seasons extreme: over one year the high latitudes are both the hottest and the coldest places on the planet (the 97.8° of Uranus is the extreme case).',
      '{0:s}；不过 {1:l} 在这个温度下可以是液体。',
      '{0:s}; {1:l}, though, can be liquid at this temperature.',
      '落在保守宜居带内。', 'It lies inside the conservative habitable zone.',
      '落在宽松宜居带内、保守带之外（地球本身就只比湿温室内边界远 1%，Kopparapu 2013 指出过这一点）。',
      'It lies inside the optimistic habitable zone but outside the conservative one (Earth itself is only 1% beyond the moist-greenhouse inner edge — Kopparapu 2013 makes that point).',
      '比宜居带内边界更靠近恒星。', 'It is closer to the star than the inner edge of the habitable zone.',
      '比宜居带外边界更远。', 'It is farther out than the outer edge of the habitable zone.',
      '有全球磁场，恒星风被挡在磁层之外。',
      'It has a global magnetic field, which keeps the stellar wind outside the magnetosphere.',
      '没有全球磁场，大气直接暴露在恒星风中。',
      'There is no global field, so the atmosphere is exposed to the stellar wind directly.',
      '地质活动仍在向大气补充气体（火山），并通过碳酸盐-硅酸盐循环调节 CO₂。',
      'Geological activity is still resupplying the atmosphere through volcanism, and regulating CO₂ through the carbonate–silicate cycle.',
      '内部已经冷却，火山不再向大气补气。',
      'The interior has cooled, and volcanism no longer resupplies the atmosphere.',
      '注：磁场对大气保留的净作用有争议——磁层也会把极区的离子逃逸通道打开（Gunell et al. 2018）。',
      'Note: the net effect of a magnetic field on atmospheric retention is disputed — a magnetosphere also opens polar channels for ion escape (Gunell et al. 2018).',
      '质量 {0} M⊕、半径 {1} R⊕，岩铁（富铁核）。',
      'Mass {0} M⊕, radius {1} R⊕, rock and iron with an iron-rich core.',
      '质量 {0} M⊕、半径 {1} R⊕，硅酸盐岩质。',
      'Mass {0} M⊕, radius {1} R⊕, silicate rock.',
      '质量 {0} M⊕、半径 {1} R⊕，岩石 + 冰。',
      'Mass {0} M⊕, radius {1} R⊕, rock and ice.',
      '质量 {0} M⊕、半径 {1} R⊕，冰 / 含厚包层。',
      'Mass {0} M⊕, radius {1} R⊕, ice or a thick envelope.',
      '质量 {0} M⊕、半径 {1} R⊕，H/He 主导。',
      'Mass {0} M⊕, radius {1} R⊕, H/He dominated.',
      '轨道稳定，近星点与远星点的辐照相差 {0} 倍。',
      'The orbit is stable; insolation at periastron and apastron differ by a factor of {0}.',
      '宜居性 {0} 低于 0.35 的门槛，没有生命。',
      'Habitability {0} is below the 0.35 threshold, so there is no life.',
      '条件允许（宜居性 {0}），但这颗行星上没有出现生命——这一步按宜居性做一次确定性抽签（种子固定，结果可复现）。',
      'Conditions would allow it (habitability {0}), but no life appeared on this planet — this step is a deterministic draw weighted by habitability (the seed is fixed, so the outcome is reproducible).',
      '年龄 {0} Gyr、宜居性 {1}，按地球的时间表（微生物 0.5 Gyr、动物 4.0 Gyr、文明 4.55 Gyr）缩放后落在「{2:s}」一档。',
      'Age {0} Gyr, habitability {1}: scaled against Earth\'s timetable (microbes 0.5 Gyr, animals 4.0 Gyr, civilisation 4.55 Gyr) it lands in the "{2:s}" band.',
      '地球是唯一的样本，这一步是启发式。',
      'Earth is the only sample we have, so this step is a heuristic.',

      /* ---- 行星报告（buildReport，逐句） ---- */
      '{0:name}：质量 {1} M⊕、半径 {2} km，表面重力 {3} m/s²，逃逸速度 {4} km/s，平均密度 {5} kg/m³。',
      '{0:name}: mass {1} M⊕, radius {2} km, surface gravity {3} m/s², escape velocity {4} km/s, mean density {5} kg/m³.',
      '轨道半长轴 {0} AU、偏心率 {1}，公转周期 {2:t}；辐照 {3} W/m²，平衡温度 {4} K。',
      'Semi-major axis {0} AU, eccentricity {1}, orbital period {2:t}; insolation {3} W/m², equilibrium temperature {4} K.',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K.',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K——水汽正反馈失控，这是一次失控温室。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K — the water-vapour feedback ran away: this is a runaway greenhouse.',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K——已越出灰大气模型的适用范围，只标量级。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K — past the range where the grey model holds, so this is an order of magnitude only.',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K（实测 {4} K，差值来自本模型未含的云与尘埃）。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K (measured {4} K; the gap comes from clouds and dust, which this model leaves out).',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K（实测 {4} K，差值来自内部热流与 H₂–H₂ 碰撞诱导吸收，本模型未含）。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K (measured {4} K; the gap comes from internal heat flow and H₂–H₂ collision-induced absorption, which this model leaves out).',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K——水汽正反馈失控，这是一次失控温室（实测 {4} K，差值来自本模型未含的云与尘埃）。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K — the water-vapour feedback ran away: this is a runaway greenhouse (measured {4} K; the gap comes from clouds and dust, which this model leaves out).',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K——水汽正反馈失控，这是一次失控温室（实测 {4} K，差值来自内部热流与 H₂–H₂ 碰撞诱导吸收，本模型未含）。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K — the water-vapour feedback ran away: this is a runaway greenhouse (measured {4} K; the gap comes from internal heat flow and H₂–H₂ collision-induced absorption, which this model leaves out).',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K——已越出灰大气模型的适用范围，只标量级（实测 {4} K，差值来自本模型未含的云与尘埃）。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K — past the range where the grey model holds, so this is an order of magnitude only (measured {4} K; the gap comes from clouds and dust, which this model leaves out).',
      '大气 {0} bar（{1:s}），灰大气光学厚度 τ={2}，表面温度 {3} K——已越出灰大气模型的适用范围，只标量级（实测 {4} K，差值来自内部热流与 H₂–H₂ 碰撞诱导吸收，本模型未含）。',
      'Atmosphere {0} bar ({1:s}), grey optical depth τ={2}, surface temperature {3} K — past the range where the grey model holds, so this is an order of magnitude only (measured {4} K; the gap comes from internal heat flow and H₂–H₂ collision-induced absorption, which this model leaves out).',
      '没有可观的大气：表面温度即平衡温度 {0} K，昼夜温差由自转与热惯量决定。',
      'There is no appreciable atmosphere: the surface temperature is just the equilibrium value, {0} K, and the day–night contrast is set by rotation and thermal inertia alone.',
      '表面温压落在水的液相区内，液态水稳定；Jeans 判据下留得住的气体：{0:l}。',
      'Surface temperature and pressure fall in the liquid field of water, so liquid water is stable; the gases the Jeans criterion lets it keep: {0:l}.',
      '表面温压落在水的液相区内，液态水稳定；任何常见气体都留不住。',
      'Surface temperature and pressure fall in the liquid field of water, so liquid water is stable; but it cannot hold on to any common gas.',
      '表面没有液态水（{0:s}）；Jeans 判据下留得住的气体：{1:l}。',
      'There is no liquid water at the surface ({0:s}); the gases the Jeans criterion lets it keep: {1:l}.',
      '表面没有液态水（{0:s}）；任何常见气体都留不住。',
      'There is no liquid water at the surface ({0:s}); and it cannot hold on to any common gas.',
      '潮汐锁定时标 {0:t}，短于年龄，自转多半已被锁定；放射性地表热流 {1} W/m²，地质活动指数 {2}。',
      'Tidal-locking timescale {0:t}, shorter than its age, so the rotation is most likely locked; radiogenic surface heat flux {1} W/m², geological activity index {2}.',
      '潮汐锁定时标 {0:t}，长于年龄，自转未被锁定；放射性地表热流 {1} W/m²，地质活动指数 {2}。',
      'Tidal-locking timescale {0:t}, longer than its age, so the rotation is not locked; radiogenic surface heat flux {1} W/m², geological activity index {2}.',
      /* 宜居性那一句（habitability.sentence），四种收尾 */
      '宜居性 {0}：把液态水、大气保留、温度窗口、宜居带位置、地质活动、时间与恒星寿命等 {1} 项按 0–1 连乘（heuristic）。',
      'Habitability {0}: the product of {1} factors between 0 and 1 — liquid water, atmospheric retention, the temperature window, position in the habitable zone, geological activity, time, stellar lifetime and so on (heuristic).',
      '宜居性 {0}：把液态水、大气保留、温度窗口、宜居带位置、地质活动、时间与恒星寿命等 {1} 项按 0–1 连乘（heuristic）；压得最低的一项是「{2:s}」（{3:s}）。',
      'Habitability {0}: the product of {1} factors between 0 and 1 — liquid water, atmospheric retention, the temperature window, position in the habitable zone, geological activity, time, stellar lifetime and so on (heuristic); the one dragging it down hardest is "{2:s}" ({3:s}).',
      '宜居性 {0}：把液态水、大气保留、温度窗口、宜居带位置、地质活动、时间与恒星寿命等 {1} 项按 0–1 连乘（heuristic）；生命等级：{2:s}（启发式）。',
      'Habitability {0}: the product of {1} factors between 0 and 1 — liquid water, atmospheric retention, the temperature window, position in the habitable zone, geological activity, time, stellar lifetime and so on (heuristic); life level: {2:s} (heuristic).',
      '宜居性 {0}：把液态水、大气保留、温度窗口、宜居带位置、地质活动、时间与恒星寿命等 {1} 项按 0–1 连乘（heuristic）；压得最低的一项是「{2:s}」（{3:s}）；生命等级：{4:s}（启发式）。',
      'Habitability {0}: the product of {1} factors between 0 and 1 — liquid water, atmospheric retention, the temperature window, position in the habitable zone, geological activity, time, stellar lifetime and so on (heuristic); the one dragging it down hardest is "{2:s}" ({3:s}); life level: {4:s} (heuristic).',
      '空间维数 D={0}≠3：上面所有公式都只对 3 维成立，宜居性不给数。',
      'The spatial dimension is D={0}≠3: every formula above holds only in three dimensions, so no habitability figure is given.',
      /* 连乘因子的「理由」小句（habitability 的 why），被上面那句用 {n:s} 嵌进去 */
      '表面温压落在水的液相区', 'surface temperature and pressure sit in the liquid field of water',
      '表面没有液态水', 'there is no liquid water at the surface',
      'λ(N₂)≥30 且有可观气压', 'λ(N₂)≥30 and the pressure is appreciable',
      'λ 够大但几乎没有大气', 'λ is large enough, but there is hardly any atmosphere',
      'N₂ 都留不住', 'not even N₂ is retained',
      '表面 {0} K', 'surface at {0} K',
      '水汽正反馈失控', 'the water-vapour feedback ran away',
      '气候未失控', 'no runaway climate',
      '在保守宜居带内', 'inside the conservative habitable zone',
      '只在宽松宜居带内', 'only inside the optimistic habitable zone',
      '在宜居带之外', 'outside the habitable zone',
      '在 cosmic shoreline 的有大气一侧', 'on the atmosphere-keeping side of the cosmic shoreline',
      '在无大气一侧', 'on the airless side',
      '有固体表面', 'it has a solid surface',
      '没有固体表面', 'it has no solid surface',
      '地质活动指数 {0}（碳酸盐-硅酸盐循环需要火山与风化）',
      'geological activity index {0} — the carbonate–silicate cycle needs volcanism and weathering',
      '多半已被潮汐锁定（昼夜半球温差极大，但厚大气可以输运热量，因此只打折不归零）',
      'most likely tidally locked (the day and night hemispheres differ enormously, but a thick atmosphere can carry heat across, so this only discounts the score rather than zeroing it)',
      '自转未被锁定', 'unlocked rotation',
      '年龄 {0} Gyr', 'age {0} Gyr',
      '主序寿命 {0} Gyr', 'main-sequence lifetime {0} Gyr',
      '来自创世参数的宇宙可居住性 {0}', 'universe-level habitability {0}, inherited from the creation parameters',
      /* 因子名（habitability 的 name，也出现在长描述的"通过/没通过"清单里） */
      '液态水', 'liquid water',
      '大气保留', 'atmospheric retention',
      '温度窗口', 'temperature window',
      '宜居带', 'the habitable zone',
      '抗恒星风剥蚀', 'resistance to stellar-wind stripping',
      '岩质表面', 'a rocky surface',
      '地质活动', 'geological activity',
      '演化时间', 'time to evolve',
      '恒星寿命', 'stellar lifetime',
      '宇宙尺度的前提', 'cosmic preconditions',
      /* 生命等级的判词（lifeLevel.text） */
      '维数不为 3，不做生命判断。', 'The dimension is not 3, so no judgement about life is made.',
      '地球：目前唯一已知有生物圈与文明的行星（实测，不是判据的输出）。',
      'Earth: so far the only planet known to carry a biosphere and a civilisation (observed, not an output of the criteria).',
      '{0:name}：至今没有发现生命（实测，不是判据的输出）。',
      '{0:name}: no life has been found there (observed, not an output of the criteria).',
      '年龄只有 {0} Gyr，还不到地球出现最早生命的 0.5 Gyr。',
      'It is only {0} Gyr old, short of the 0.5 Gyr at which the earliest life appeared on Earth.',

      /* ---- 行星长描述（describeLong，十句，逐句） ---- */
      /* 1 类型与体量 */
      '{0:name}是一颗{1:lw}，质量 {2} M⊕（{3} kg）、半径 {4} km（{5} R⊕），平均密度 {6} kg/m³，表面重力 {7} m/s²（{8} g⊕），逃逸速度 {9} km/s。',
      '{0:name} is a {1:lw}: mass {2} M⊕ ({3} kg), radius {4} km ({5} R⊕), mean density {6} kg/m³, surface gravity {7} m/s² ({8} g⊕), escape velocity {9} km/s.',
      '{0:name}是一颗{1:lw}，质量 {2} M⊕（{3} kg）、半径 {4} km（{5} R⊕），平均密度 {6} kg/m³，表面重力 {7} m/s²（{8} g⊕），逃逸速度 {9} km/s（质量、半径取 NASA Planetary Fact Sheet 的实测值）。',
      '{0:name} is a {1:lw}: mass {2} M⊕ ({3} kg), radius {4} km ({5} R⊕), mean density {6} kg/m³, surface gravity {7} m/s² ({8} g⊕), escape velocity {9} km/s (mass and radius are the measured values from the NASA Planetary Fact Sheet).',
      /* 2 轨道 */
      '它在 {0} AU 上绕{1:host}公转一周需要 {2:t}，偏心率 {3}，轨道近乎正圆，一年里的辐照几乎不变，接收到的辐照为 {4} W/m²（地球的 {5} 倍）。',
      'At {0} AU it takes {2:t} to go once around {1:host}. With an eccentricity of {3} the orbit is very nearly circular and the insolation barely changes over the year; it receives {4} W/m² ({5} times what Earth gets).',
      '它在 {0} AU 上绕{1:host}公转一周需要 {2:t}，偏心率 {3}，近星点与远星点的辐照相差 {4} 倍，接收到的辐照为 {5} W/m²（地球的 {6} 倍）。',
      'At {0} AU it takes {2:t} to go once around {1:host}. With an eccentricity of {3}, insolation at periastron and apastron differ by a factor of {4}; on average it receives {5} W/m² ({6} times what Earth gets).',
      /* 3 自转与季节 */
      '自转周期 {0} 小时，一个太阳日 {1} 小时；转轴倾角 {2}°，几乎没有季节，{3:s}。',
      'Rotation period {0} h, solar day {1} h; with an axial tilt of {2}° there are effectively no seasons, and {3:s}.',
      '自转周期 {0} 小时（逆行），一个太阳日 {1} 小时；转轴倾角 {2}°，几乎没有季节，{3:s}。',
      'Rotation period {0} h (retrograde), solar day {1} h; with an axial tilt of {2}° there are effectively no seasons, and {3:s}.',
      '自转周期 {0} 小时，一个太阳日 {1} 小时；转轴倾角 {2}°，45° 纬度上夏至与冬至的日均辐照相差 {3} 倍，{4:s}。',
      'Rotation period {0} h, solar day {1} h; the axial tilt is {2}°, so at 45° latitude the daily mean insolation differs by a factor of {3} between the solstices, and {4:s}.',
      '自转周期 {0} 小时（逆行），一个太阳日 {1} 小时；转轴倾角 {2}°，45° 纬度上夏至与冬至的日均辐照相差 {3} 倍，{4:s}。',
      'Rotation period {0} h (retrograde), solar day {1} h; the axial tilt is {2}°, so at 45° latitude the daily mean insolation differs by a factor of {3} between the solstices, and {4:s}.',
      '自转周期 {0} 小时，一个太阳日 {1} 小时；转轴倾角 {2}°，45° 纬度上夏至与冬至的日均辐照相差 {3} 倍，高纬度在一年里既是最热也是最冷的地方，{4:s}。',
      'Rotation period {0} h, solar day {1} h; the axial tilt is {2}°, so at 45° latitude the daily mean insolation differs by a factor of {3} between the solstices and the high latitudes are both the hottest and the coldest places on the planet over one year, and {4:s}.',
      '自转周期 {0} 小时（逆行），一个太阳日 {1} 小时；转轴倾角 {2}°，45° 纬度上夏至与冬至的日均辐照相差 {3} 倍，高纬度在一年里既是最热也是最冷的地方，{4:s}。',
      'Rotation period {0} h (retrograde), solar day {1} h; the axial tilt is {2}°, so at 45° latitude the daily mean insolation differs by a factor of {3} between the solstices and the high latitudes are both the hottest and the coldest places on the planet over one year, and {4:s}.',
      '不过潮汐锁定时标只有 {0:t}，远短于它的年龄，它多半已经被锁定成一面永昼、一面永夜',
      'the tidal-locking timescale is only {0:t}, far shorter than its age, so it is most likely locked into permanent day on one side and permanent night on the other',
      '潮汐锁定时标 {0:t}，长于它的年龄，自转不会被恒星潮汐锁定',
      'the tidal-locking timescale of {0:t} is longer than its age, so stellar tides will not lock its rotation',
      /* 4 温度与大气 */
      '平衡温度 {0} K；表面气压 {1} bar，大气以 {2:s} 为主，灰大气模型给出的温室增温 {3} K，表面温度 {4} K。',
      'Equilibrium temperature {0} K; surface pressure {1} bar, the atmosphere mostly {2:s}, and the grey-atmosphere model adds {3} K of greenhouse warming for a surface temperature of {4} K.',
      '平衡温度 {0} K；表面气压 {1} bar，大气以 {2:s} 为主，灰大气模型给出的温室增温 {3} K，表面温度 {4} K——水汽正反馈失控。',
      'Equilibrium temperature {0} K; surface pressure {1} bar, the atmosphere mostly {2:s}, and the grey-atmosphere model adds {3} K of greenhouse warming for a surface temperature of {4} K — the water-vapour feedback has run away.',
      '平衡温度 {0} K；在 1 bar 参考面上，大气以 {1:s} 为主，灰大气模型给出的温室增温 {2} K，表面温度 {3} K。',
      'Equilibrium temperature {0} K; at the 1 bar reference level the atmosphere is mostly {1:s}, and the grey-atmosphere model adds {2} K of greenhouse warming for a temperature of {3} K.',
      '平衡温度 {0} K；在 1 bar 参考面上，大气以 {1:s} 为主，灰大气模型给出的温室增温 {2} K，表面温度 {3} K——水汽正反馈失控。',
      'Equilibrium temperature {0} K; at the 1 bar reference level the atmosphere is mostly {1:s}, and the grey-atmosphere model adds {2} K of greenhouse warming for a temperature of {3} K — the water-vapour feedback has run away.',
      '平衡温度 {0} K；它几乎没有大气，表面温度就是平衡温度 {1} K，昼夜温差只由自转与热惯量决定。',
      'Equilibrium temperature {0} K; it has hardly any atmosphere, so the surface temperature is simply that equilibrium value of {1} K and the day–night contrast is set by rotation and thermal inertia alone.',
      /* 5 气体保留 */
      '按 Jeans 判据（外逸层温度 {0} K），任何常见气体都留不住，大气会被剥得精光。',
      'By the Jeans criterion (exobase temperature {0} K) it can hold on to no common gas at all: the atmosphere gets stripped bare.',
      '按 Jeans 判据（外逸层温度 {0} K），八种常见气体全部留得住，连最轻的氢也不例外。',
      'By the Jeans criterion (exobase temperature {0} K) all eight common gases are retained — even hydrogen, the lightest of them.',
      '按 Jeans 判据（外逸层温度 {0} K），{1:l}留得住，{2:l}会持续逃逸。',
      'By the Jeans criterion (exobase temperature {0} K): retained — {1:l}; escaping — {2:l}.',
      /* 6 水 */
      '表面温压落在水的液相区内（该气压下的沸点 {0} K），液态水稳定，含水量约 {1} 个地球海洋。',
      'Surface temperature and pressure fall inside the liquid field of water (the boiling point at this pressure is {0} K), so liquid water is stable; the inventory is about {1} Earth oceans.',
      '表面温压落在水的液相区内（该气压下的沸点 {0} K），液态水稳定，含水量约 {1} 个地球海洋——足够把整颗行星裹进一层深海。',
      'Surface temperature and pressure fall inside the liquid field of water (the boiling point at this pressure is {0} K), so liquid water is stable; the inventory is about {1} Earth oceans — enough to wrap the whole planet in a deep ocean.',
      '{0:s}；不过 {1:l}（在 1 bar 下为液态）。',
      '{0:s}; {1:l}, however, would be liquid at 1 bar.',
      /* 7 地质与磁场 */
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（活跃），磁场指数 {2}：有全球磁场，恒星风被挡在磁层之外。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (active) and the magnetic index {2}, so a global field keeps the stellar wind outside the magnetosphere.',
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（活跃），磁场指数 {2}：没有全球磁场，大气直接暴露在恒星风里。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (active) and the magnetic index {2}, so there is no global field and the atmosphere lies open to the stellar wind.',
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（中等），磁场指数 {2}：有全球磁场，恒星风被挡在磁层之外。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (moderate) and the magnetic index {2}, so a global field keeps the stellar wind outside the magnetosphere.',
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（中等），磁场指数 {2}：没有全球磁场，大气直接暴露在恒星风里。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (moderate) and the magnetic index {2}, so there is no global field and the atmosphere lies open to the stellar wind.',
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（微弱），磁场指数 {2}：有全球磁场，恒星风被挡在磁层之外。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (faint) and the magnetic index {2}, so a global field keeps the stellar wind outside the magnetosphere.',
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（微弱），磁场指数 {2}：没有全球磁场，大气直接暴露在恒星风里。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (faint) and the magnetic index {2}, so there is no global field and the atmosphere lies open to the stellar wind.',
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（已冷透），磁场指数 {2}：有全球磁场，恒星风被挡在磁层之外。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (cold through and through) and the magnetic index {2}, so a global field keeps the stellar wind outside the magnetosphere.',
      '放射性地表热流 {0} W/m²（地球现今 0.0865），地质活动指数 {1}（已冷透），磁场指数 {2}：没有全球磁场，大气直接暴露在恒星风里。',
      'Radiogenic surface heat flux {0} W/m² (Earth today: 0.0865); the geological activity index is {1} (cold through and through) and the magnetic index {2}, so there is no global field and the atmosphere lies open to the stellar wind.',
      /* 8 卫星与环 */
      '{0:s}，{1:s}；卫星的稳定区在希尔球半径 {2} km 的一半以内，洛希极限 {3} km 以内的东西会被潮汐撕碎。',
      '{0:s}, {1:s}. Moons are roughly stable out to half the Hill radius of {2} km, and anything inside the Roche limit at {3} km is pulled apart by tides.',
      '它没有卫星', 'It has no moons',
      '它有 1 颗卫星', 'It has one moon',
      '它有 {0} 颗卫星', 'It has {0} moons',
      '它有 1 颗已知卫星', 'It has one known moon',
      '它有 {0} 颗已知卫星', 'It has {0} known moons',
      '它有 1 颗卫星（{0:l}）', 'It has one moon ({0:l})',
      '它有 {0} 颗卫星（{1:l}）', 'It has {0} moons ({1:l})',
      '它有 {0} 颗卫星（{1:l} 等）', 'It has {0} moons ({1:l} among others)',
      '它有 1 颗已知卫星（{0:l}）', 'It has one known moon ({0:l})',
      '它有 {0} 颗已知卫星（{1:l}）', 'It has {0} known moons ({1:l})',
      '它有 {0} 颗已知卫星（{1:l} 等）', 'It has {0} known moons ({1:l} among others)',
      '并有一组由碎屑与冰粒构成的环', 'and a ring of debris and ice grains',
      '但没有环系', 'but no ring system',
      '也没有环系', 'and no ring system either',
      /* 9 宜居性与生命 */
      '宜居性 {0}：{1:ll}这几项通过，{2:ll}没通过；没有出现生命（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: {1:ll} pass, while {2:ll} do not; no life appeared (both habitability and the life level are heuristic criteria).',
      '宜居性 {0}：{1:ll}这几项通过，{2:ll}没通过；生命等级判为「{3:s}」（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: {1:ll} pass, while {2:ll} do not; the life level is judged "{3:s}" (both habitability and the life level are heuristic criteria).',
      '宜居性 {0}：{1:ll}这几项通过，没有明显的短板；没有出现生命（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: {1:ll} pass, with no obvious weak link; no life appeared (both habitability and the life level are heuristic criteria).',
      '宜居性 {0}：{1:ll}这几项通过，没有明显的短板；生命等级判为「{2:s}」（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: {1:ll} pass, with no obvious weak link; the life level is judged "{2:s}" (both habitability and the life level are heuristic criteria).',
      '宜居性 {0}：没有一项拿到满分，{1:ll}没通过；没有出现生命（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: not one factor scores full marks, and {1:ll} fail outright; no life appeared (both habitability and the life level are heuristic criteria).',
      '宜居性 {0}：没有一项拿到满分，{1:ll}没通过；生命等级判为「{2:s}」（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: not one factor scores full marks, and {1:ll} fail outright; the life level is judged "{2:s}" (both habitability and the life level are heuristic criteria).',
      '宜居性 {0}：没有一项拿到满分，没有明显的短板；没有出现生命（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: not one factor scores full marks, though none fails outright either; no life appeared (both habitability and the life level are heuristic criteria).',
      '宜居性 {0}：没有一项拿到满分，没有明显的短板；生命等级判为「{1:s}」（宜居性与生命等级都是启发式判据）。',
      'Habitability {0}: not one factor scores full marks, though none fails outright either; the life level is judged "{1:s}" (both habitability and the life level are heuristic criteria).',
      /* 10 年龄与历史 */
      '它形成于 {0:t}前，{1:host}已经走过主序寿命的 {2}%，还能再燃烧约 {3:t}。',
      'It formed {0:t} ago; {1:host} has now run through {2}% of its main-sequence life and has about {3:t} of burning left.',
      '它形成于 {0:t}前，{1:host}已经走过主序寿命的 {2}%，已经离开主序。',
      'It formed {0:t} ago; {1:host} has run through {2}% of its main-sequence life and has left the main sequence.',

      /* ---- 太阳系八大行星（status:'accepted'）的实测注记，覆盖同名参数的通用说明 ---- */
      '{0:name} 质量 {1} kg', '{0:name}, mass {1} kg',
      '体积平均半径 {0} km', 'Volumetric mean radius {0} km',
      '按平均密度判为岩铁', 'classified as rock and iron from its mean density',
      '"冰"指 H₂O/NH₃/CH₄ 的高压相', '"ice" here means the high-pressure phases of H₂O/NH₃/CH₄',
      '巨行星的核质量至今没有定论，这里只给一个量级',
      'the core mass of a giant planet is still unsettled, so only an order of magnitude is given here',
      '逆行自转', 'retrograde rotation',
      '有全球内禀磁场', 'it has a global intrinsic magnetic field',
      '没有全球内禀磁场', 'it has no global intrinsic magnetic field',
      '1 bar 参考面（没有固体表面）', 'the 1 bar reference level (there is no solid surface)',
      '没有固体表面；1 bar 参考面。', 'It has no solid surface; values are quoted at the 1 bar reference level.',
      '没有固体表面；温度与压强取 1 bar 参考面。',
      'It has no solid surface; temperature and pressure are quoted at the 1 bar reference level.',
      '1 bar 参考面；内部热流约为吸收太阳辐射的 2.6 倍',
      'the 1 bar reference level; the internal heat flow is about 2.6 times the absorbed sunlight',
      '内部热流约为吸收太阳辐射的 1.67 倍（有效温度 124 K > 平衡温度 110 K）',
      'the internal heat flow is about 1.67 times the absorbed sunlight (effective temperature 124 K against an equilibrium temperature of 110 K)',
      '平均密度 687 kg/m³，低于水', 'mean density 687 kg/m³ — less than water',
      '只有由太阳风与撞击溅射维持的外逸层（Na/K/O），没有稳定大气；有微弱的内禀磁场（≈1% 地球）',
      'only an exosphere (Na/K/O) kept up by the solar wind and impact sputtering, with no stable atmosphere; the intrinsic field is faint (≈1% of Earth\'s)',
      '自转为逆行（转轴倾角 177.4°）；无内禀磁场',
      'the rotation is retrograde (axial tilt 177.4°); there is no intrinsic field',
      '平均气压随季节在 4.0–8.7 mbar 之间变化（极冠 CO₂ 凝结/升华）；无全球磁场，只有地壳剩磁',
      'the mean pressure swings between 4.0 and 8.7 mbar with the seasons (CO₂ condensing onto and subliming off the polar caps); there is no global field, only crustal remanence',
      '自转轴几乎躺在轨道面内（倾角 97.8°，自转为逆行）；1 bar 参考面',
      'the spin axis lies almost in the orbital plane (tilt 97.8°, retrograde rotation); values at the 1 bar reference level',
      'H₂O 取全球平均柱量的等效摩尔分数（实际 0–4% 强烈可变）；CO₂ 取 2023 年 420 ppm',
      'H₂O is the mole fraction equivalent to the global mean column (in reality it varies strongly, 0–4%); CO₂ is the 2023 value of 420 ppm',
      '{0} h（自转周期 {1} h，逆行）', '{0} h (rotation period {1} h, retrograde)',
      't_lock = ω_i a⁶ I Q /(3 G M★² k₂ R⁵)，I = 0.4MR²，ω_i = 2π/13.5 h（吸积末期自转），Q/k₂ = 30000/0.5（巨行星）',
      't_lock = ω_i a⁶ I Q /(3 G M★² k₂ R⁵), with I = 0.4MR², ω_i = 2π/13.5 h (the spin at the end of accretion) and Q/k₂ = 30000/0.5 (giant planet)',
      '实测平均温度 {0} K（NASA）。', 'The measured mean temperature is {0} K (NASA).',
      '实测平均温度 {0} K（NASA），与模型相差 {1} K。',
      'The measured mean temperature is {0} K (NASA), {1} K away from the model.',
      '实测平均温度 {0} K（NASA），与模型相差 {1} K——巨行星的 1 bar 温度由内部热流与 H₂–H₂ 碰撞诱导吸收决定，本灰大气模型不含这两项。',
      'The measured mean temperature is {0} K (NASA), {1} K away from the model — the 1 bar temperature of a giant planet is set by internal heat flow and H₂–H₂ collision-induced absorption, neither of which this grey-atmosphere model carries.',
      '数据：NASA 实测 {0} 项 · 真算 {1} · 标度 {2} · 启发式 {3}',
      'Data: {0} measured by NASA · {1} computed · {2} scaled · {3} heuristic',
      'NASA Planetary Fact Sheet（nssdc.gsfc.nasa.gov/planetary/factsheet/）（相对黄道）',
      'NASA Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/), relative to the ecliptic',
      'Connelly et al. 2012, Science 338, 651（CAI 铅-铅年龄 4.567 Gyr）',
      'Connelly et al. 2012, Science 338, 651 (Pb–Pb age of CAIs, 4.567 Gyr)',
      'Hauck et al. 2013（水星）；行星内部模型',
      'Hauck et al. 2013 (Mercury); planetary interior models',
      '火星/金星的现存水量为估计值（Villanueva et al. 2015）',
      'the surviving water on Mars and Venus is an estimate (Villanueva et al. 2015)',
      'Guillot 2005；Helled & Fortney 2020（巨行星内部模型仍有量级不确定）',
      'Guillot 2005; Helled & Fortney 2020 (giant-planet interior models are still uncertain by an order of magnitude)',
      'Anderson et al. 2011（MESSENGER：水星偶极矩约地球的 1%）',
      'Anderson et al. 2011 (MESSENGER: Mercury\'s dipole moment is about 1% of Earth\'s)',
      '地球海洋 1.4×10²¹ kg', 'one Earth ocean = 1.4×10²¹ kg'
    ].forEach(function (v, i, arr) { if (i % 2 === 0) compile(v, arr[i + 1]); });

    I.tx = tx;
  })();
})(typeof window !== 'undefined' ? window : this);
