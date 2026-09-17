/*
 * web/i18n-planets.js —— ui/planets.js 的中英词条
 * ------------------------------------------------------------
 * 只放**界面上真会出现**的句子；注释、日志、开发用文字不进这里。
 * key 是中文原文，逐字相等才命中；漏翻的自动退回中文，不会出现裸 key。
 * 机制与约定见 web/i18n.js 顶部。
 *
 * 这一块专业术语密集，译法一律取学界通用：恒星 star、行星 planet、宜居带 habitable zone、
 * 潮汐锁定 tidally locked、金属丰度 metallicity、洛希极限 Roche limit、逃逸速度 escape velocity、
 * 光度 luminosity。单位与符号（M☉、AU、K、R⊕、L☉、bar…）原样保留，数字一个不改。
 * 带前后空格的 key 是拼接片段（前后接数值），空格必须照抄，否则英文会粘成一团。
 */
(function (root) {
  'use strict';
  var I = root.MirrorI18n;
  if (!I) return;            // i18n 核心没加载：静默退回全中文，不要让页面挂掉
  I.add({

    /* ---- 标点（只在拼接处用；整段文本节点不会命中这些） ---- */
    '（': ' (',
    '）': ')',
    '，': ', ',
    '、': ', ',
    '；': '; ',
    '：': ': ',

    /* ---- 时间与长度单位 ---- */
    ' 年': ' yr',
    ' 万年': '×10⁴ yr',
    ' 亿年': '×10⁸ yr',
    ' 天': ' d',
    ' 小时': ' h',
    ' 圈': ' orbits',

    /* ---- 天体类型（TYPE_CN） ---- */
    '岩质行星': 'Rocky planet',
    '海洋世界': 'Ocean world',
    '气态巨行星': 'Gas giant',
    '冰封世界': 'Ice world',
    '熔岩世界': 'Lava world',
    '沙漠世界': 'Desert world',
    '有生命的世界': 'Living world',
    '地球': 'Earth',
    '冰巨星': 'Ice giant',
    '（冰巨星）': ' (ice giant)',

    /* ---- 生命等级（LIFE_LEVELS） ---- */
    '微生物': 'Microbes',
    '植物': 'Plants',
    '动物': 'Animals',
    '文明': 'Civilization',

    /* ---- 演化阶段（STAGE_CN）与遗骸 ---- */
    '前主序': 'pre-main-sequence',
    '主序': 'main sequence',
    '主序末期': 'late main sequence',
    '亚巨星': 'subgiant',
    '红巨星': 'red giant',
    '渐近巨星支': 'asymptotic giant branch',
    '行星状星云': 'planetary nebula',
    '超新星遗迹': 'supernova remnant',
    '白矮星': 'white dwarf',
    '中子星': 'neutron star',
    '黑洞': 'black hole',
    '褐矮星': 'brown dwarf',
    '遗骸': 'stellar remnant',
    '恒星': 'star',
    '恒星 ': 'Star ',                      // 过程生成的系统名前缀，只在显示时替换（见 planets.js 的 TRN）
    '流浪行星 ': 'Rogue planet ',
    '内双星 ': 'inner binary ',
    'M III（AGB）': 'M III (AGB)',
    '（前主序）': ' (pre-MS)',

    '褐矮星：质量低于氢燃烧下限（≈0.075 M☉），只靠氘燃烧与引力收缩发光，随年龄一路冷却（':
      'Brown dwarf: below the hydrogen-burning limit (≈0.075 M☉), it shines only by deuterium burning and gravitational contraction, cooling steadily with age (type ',
    ' 型）': ')',
    '还在引力收缩：外面裹着原行星盘，氢还没点燃':
      'Still contracting: wrapped in a protoplanetary disc, hydrogen not yet ignited',
    '氢壳层燃烧：核心收缩、外壳膨胀':
      'Hydrogen shell burning: the core contracts while the envelope expands',
    '红巨星支：半径涨到几十倍，内侧的行星会被吞掉':
      'Red giant branch: the radius grows tens of times over and the inner planets are swallowed',
    '渐近巨星支：热脉动与强星风，正在把外壳吹走':
      'Asymptotic giant branch: thermal pulses and a strong wind are blowing the envelope away',
    '行星状星云：外壳刚被吹开，中心是裸露的碳氧核（这一阶段只有几万年）':
      'Planetary nebula: the envelope has just been ejected, leaving a bare carbon-oxygen core (this stage lasts only tens of thousands of years)',
    '白矮星：前身 ': 'White dwarf: progenitor ',
    ' M☉（<8 M☉ → 白矮星，Heger 2003），末质量 ': ' M☉ (<8 M☉ → white dwarf, Heger 2003), final mass ',
    ' M☉，已冷却 ': ' M☉, cooling for ',
    '超新星遗迹：核心坍缩才过去 ': 'Supernova remnant: core collapse was only ',
    '，激波还在膨胀': ' ago — the shock is still expanding',
    '中子星：前身 ': 'Neutron star: progenitor ',
    ' M☉（8–20 M☉ → 中子星，Heger 2003），半径约 12 km、1.4 M☉':
      ' M☉ (8–20 M☉ → neutron star, Heger 2003); radius ≈12 km, 1.4 M☉',
    '黑洞：前身 ': 'Black hole: progenitor ',
    ' M☉（>20 M☉ 直接坍缩或大量回落，Heger 2003），视界半径约 ':
      ' M☉ (>20 M☉ → direct collapse or heavy fallback, Heger 2003); horizon radius ≈ ',

    /* ---- 变星（GCVS） ---- */
    '食双星': 'Eclipsing binary',
    '造父变星': 'Cepheid',
    '天琴 RR 型': 'RR Lyrae',
    '刍藁型长周期变星': 'Mira-type long-period variable',
    '盾牌 δ 型': 'Delta Scuti',
    '耀星（dMe）': 'Flare star (dMe)',
    'GCVS 食双星（Algol / β Lyr / W UMa 型）；掩食概率 ≈ (R₁+R₂)/a':
      'GCVS eclipsing binary (Algol / β Lyr / W UMa type); eclipse probability ≈ (R₁+R₂)/a',
    'GCVS DCEP：经典造父变星，周期–光度关系（Leavitt 1912）':
      'GCVS DCEP: classical Cepheid, period–luminosity relation (Leavitt 1912)',
    'GCVS RR：水平支上的老年贫金属星，周期 0.2–1 d':
      'GCVS RR: old metal-poor horizontal-branch star, period 0.2–1 d',
    'GCVS M：Mira 型，AGB 上的脉动，振幅 >2.5 星等':
      'GCVS M: Mira type, pulsation on the AGB, amplitude >2.5 mag',
    'GCVS DSCT：不稳定带下端的 A–F 型脉动星':
      'GCVS DSCT: A–F pulsator at the low end of the instability strip',
    'GCVS UV：鲸鱼座 UV 型耀星，M 矮星常见（年轻时更活跃）':
      'GCVS UV: UV Ceti flare star, common among M dwarfs (more active when young)',

    /* ---- 行星类型全谱（Kepler 出现率） ---- */
    '亚地球': 'Sub-Earth',
    '类地行星': 'Earth-sized planet',
    '超级地球': 'Super-Earth',
    '迷你海王星': 'Mini-Neptune',
    '海王星型': 'Neptune-like',
    '雪球行星': 'Snowball planet',
    '热木星': 'Hot Jupiter',
    '亚地球（潮汐锁定）': 'Sub-Earth (tidally locked)',
    '类地行星（潮汐锁定）': 'Earth-sized planet (tidally locked)',
    '超级地球（潮汐锁定）': 'Super-Earth (tidally locked)',
    '迷你海王星（潮汐锁定）': 'Mini-Neptune (tidally locked)',
    '海王星型（潮汐锁定）': 'Neptune-like (tidally locked)',
    '气态巨行星（潮汐锁定）': 'Gas giant (tidally locked)',
    '熔岩世界（潮汐锁定）': 'Lava world (tidally locked)',
    '雪球行星（潮汐锁定）': 'Snowball planet (tidally locked)',
    'Fressin et al. 2013 表 3（P < 85 d，每颗恒星的出现率）· 半径谷 Fulton 2017 · 质量–半径 Chen & Kipping 2017':
      'Fressin et al. 2013 Table 3 (P < 85 d, occurrence per star) · radius valley Fulton 2017 · mass–radius Chen & Kipping 2017',

    /* ---- 盘 ---- */
    '原行星盘': 'Protoplanetary disc',
    '碎屑盘': 'Debris disc',
    'Haisch et al. 2001：盘比例随年龄指数衰减，半衰期约 3 Myr':
      'Haisch et al. 2001: the disc fraction decays exponentially with age, half-life ≈3 Myr',
    'Su et al. 2006：A 型星碎屑盘比例约 32%':
      'Su et al. 2006: ≈32% of A-type stars have a debris disc',
    'Eiroa et al. 2013 (DUNES)：FGK 星碎屑盘比例 20.2% ± 2.0%':
      'Eiroa et al. 2013 (DUNES): 20.2% ± 2.0% of FGK stars have a debris disc',

    /* ---- 流浪行星 ---- */
    '流浪行星': 'Rogue planet',
    '（无主星）': '(no host star)',
    'Sumi et al. 2011：微引力透镜给出每颗主序星约 1.8 颗木星质量的自由漂浮行星；Mróz et al. 2017 把上限压到 <0.25 颗/星，同时指出低质量端更多。示意':
      'Sumi et al. 2011: microlensing gives ≈1.8 Jupiter-mass free-floating planets per main-sequence star; Mróz et al. 2017 lowers the bound to <0.25 per star while noting the low-mass end is more numerous. Illustrative',
    '一颗没有恒星的行星。它在星际空间里独自漂流，表面温度只由内部余热与放射性衰变维持（约 ':
      'A planet with no star. It drifts alone through interstellar space, its surface temperature sustained only by residual internal heat and radioactive decay (about ',
    ' K），天空里除了星光什么都没有。': ' K), and its sky holds nothing but starlight.',
    'Sumi et al. 2011 / Mróz et al. 2017（示意）': 'Sumi et al. 2011 / Mróz et al. 2017 (illustrative)',
    'Sumi 2011 / Mróz 2017，示意': 'Sumi 2011 / Mróz 2017, illustrative',
    '此刻距 ': 'currently ',
    ' 约 ': ' about ',
    ' 光年': ' light-years away',
    '星际空间': 'interstellar space',
    '本恒星系': 'this star system',
    ' · 流浪行星（不绕任何恒星）· ': ' · Rogue planet (orbiting no star) · ',

    /* ---- 维数 ---- */
    '一维及以下：没有可展示的轨道与地表': 'One dimension or fewer: no orbits or surfaces to show',
    '超过 17 维': 'More than 17 dimensions',
    '示意（2 维几何）· 引力 2+1 维为推测':
      'Illustrative (2D geometry) · gravity in 2+1 dimensions is conjectural',
    'D≥4：D 维两体问题的 3 维投影 · Ehrenfest 1917：无稳定圆轨道':
      'D≥4: a 3D projection of the D-dimensional two-body problem · Ehrenfest 1917: no stable circular orbits',
    '分数维（推测：分形/谱维数模块）· 引力 r^{−(D−1)} 的轨道 3 维投影':
      'Fractional dimension (conjectural: fractal / spectral dimension module) · 3D projection of orbits under r^{−(D−1)} gravity',

    /* ---- 照明色温 ---- */
    '照明色温：宿主 ': 'Illumination color temperature: the host ',
    ' 的 T_eff ≈ ': ' has T_eff ≈ ',
    ' K，普朗克谱': ' K, so its Planck spectrum is ',
    '偏红 —— 高反照率的云顶/冰面因此整体带粉橙调':
      'red-shifted — high-albedo cloud tops and ice therefore take on an overall pink-orange cast',
    '偏蓝 —— 同样的表面在这里偏蓝白':
      'blue-shifted — the same surfaces look blue-white here',
    '（这是**照明**的颜色，不是天体本身的颜色；白点取太阳 5772 K；默认部分白平衡 0.55 是显示约定——人眼色适应/火星车“自然色”式折中，不是物理测量或标度关系，示意）':
      ' (this is the color of the **illumination**, not of the body itself; the white point is the Sun at 5772 K; the default partial white balance of 0.55 is a display convention — the same compromise as human chromatic adaptation and rover "natural color" products, not a measurement or a scaling relation. Illustrative)',

    /* ---- 托林雾霾 ---- */
    '海卫一那样的粉': 'pink, like Triton',
    '冥王星那样的红棕': 'red-brown, like Pluto',
    '土卫六那样的橙黄': 'orange-yellow, like Titan',
    '托林雾霾（光学厚度 ': 'Tholin haze (optical depth ',
    '）：甲烷与氮在紫外辐照下生成的有机气溶胶，':
      '): an organic aerosol produced from methane and nitrogen under UV irradiation, ',
    '在': 'which on the ',
    ' K 的表面上': ' K surface ',
    '只积不散': 'only accumulates and never disperses',
    '一边沉积一边被喷发与裂隙翻新（所以只有薄薄一层）':
      'is deposited and resurfaced at the same time by eruptions and fractures (so only a thin layer survives)',
    '悬在稳定的平流层里': 'is suspended in a stable stratosphere',
    '，因此偏': ', hence the ',
    '；累积紫外剂量约为地球轨道 46 亿年的 ':
      ' shade; the cumulative UV dose is about ',
    ' 倍（依据：Sagan & Khare 1979 命名并测定 tholin 光学常数；Grundy 等 New Horizons 工作：冥王星/柯伊伯带红色有机物；Zhang et al. 2017 Nature 551, 352 冥王星雾霾加热与能量收支——不是土卫六；色相三支与 τ 为示意，非计算）':
      '× that of 4.6 Gyr in Earth orbit (sources: Sagan & Khare 1979 named tholins and measured their optical constants; Grundy et al., New Horizons: red organics on Pluto and in the Kuiper belt; Zhang et al. 2017, Nature 551, 352 on haze heating and the energy budget of Pluto — not Titan. The three hue branches and τ are illustrative, not computed)',

    /* ---- 巨行星云顶分类（Sudarsky et al. 2000） ---- */
    '甲烷 + 氨冰云': 'Methane + ammonia-ice cloud',
    '主要凝结物为甲烷冰与氨冰': 'the main condensates are methane ice and ammonia ice',
    '青蓝色（甲烷吸收 0.6–0.9 μm 的红光，只把蓝绿散射回来）':
      'cyan-blue (methane absorbs red light at 0.6–0.9 μm and scatters back only blue-green)',
    '甲烷吸收带 Karkoschka 1998 + 天王星/海王星实测':
      'methane absorption bands, Karkoschka 1998 + Uranus/Neptune measurements',
    '第 I 类 · 氨冰云': 'Class I · ammonia-ice cloud',
    '主要凝结物为氨冰（NH₃，更深处还有 NH₄SH 与水云）':
      'the main condensate is ammonia ice (NH₃, with NH₄SH and water clouds deeper down)',
    '高反照率的乳白色，带纹很淡（土星那一端）':
      'a high-albedo creamy white with very faint banding (the Saturn end of the class)',
    '白中带浅黄褐的纬向云带': 'white zonal bands with a light yellow-brown tint',
    '黄褐分明的明暗云带（木星那一端）—— 氨冰本身是白的，黄褐来自云顶的发色团（West et al. 2004；Carlson et al. 2016）':
      'sharply contrasting yellow-brown belts and zones (the Jupiter end of the class) — ammonia ice itself is white; the yellow-brown comes from chromophores at the cloud top (West et al. 2004; Carlson et al. 2016)',
    '第 II 类 · 水云': 'Class II · water cloud',
    '主要凝结物为水云（H₂O，氨已经不再凝结）':
      'the main condensate is water (H₂O; ammonia no longer condenses)',
    '接近纯白、带纹很淡的高反照率云顶（这一类的 Bond 反照率可达 0.8，是五类里最亮的）':
      'a near-white, faintly banded, high-albedo cloud top (Bond albedo up to 0.8 — the brightest of the five classes)',
    '第 III 类 · 晴空（Na/K 吸收）': 'Class III · clear sky (Na/K absorption)',
    '大气是晴空的（可凝结的物种都沉到光球之下）':
      'the atmosphere is cloud-free (every condensable species has settled below the photosphere)',
    '，只剩一点高层水霾': ', leaving only a little high water haze',
    '，可见光被 Na/K 共振线（589 / 770 nm）吃掉':
      ', and visible light is eaten by the Na/K resonance lines (589 / 770 nm)',
    '深蓝紫色、几乎看不出带纹': 'a deep blue-violet with almost no visible banding',
    '（残余的水霾让它没那么暗）': ' (the residual water haze makes it less dark)',
    '（瑞利散射剩下的蓝端就是它唯一的颜色，反照率只有 ~0.12）':
      ' (the blue left by Rayleigh scattering is its only color; the albedo is just ~0.12)',
    '第 IV 类 · 碱金属吸收（硅酸盐散射变体）':
      'Class IV · alkali-metal absorption (silicate-scattering variant)',
    '主要凝结物为硅酸盐与铁（大部分沉在光球之下，但有一部分颗粒被抬到高层）':
      'the main condensates are silicates and iron (mostly below the photosphere, though some grains are lofted to high altitude)',
    '深蓝色 —— 与 HD 189733b 同型：高层硅酸盐颗粒把蓝光散射回来，红端仍被 Na/K 吸收（Evans et al. 2013 测到 290–450 nm 的几何反照率 ≈0.4）':
      'deep blue — the HD 189733b type: high-altitude silicate grains scatter blue light back while the red end is still absorbed by Na/K (Evans et al. 2013 measured a geometric albedo of ≈0.4 at 290–450 nm)',
    '第 IV 类 · 碱金属吸收': 'Class IV · alkali-metal absorption',
    '主要凝结物为硅酸盐与铁，但它们凝结在光球之下，云顶之上是 Na/K 蒸气':
      'the main condensates are silicates and iron, but they condense below the photosphere, leaving Na/K vapor above the cloud top',
    '几乎不反光的暗红褐色，只有少数几条云带亮一点（这一类的反照率低到 ~0.03）':
      'an almost non-reflective dark red-brown with only a few slightly brighter bands (the albedo of this class is as low as ~0.03)',
    '第 V 类 · 超热木星（热辐射）': 'Class V · ultra-hot Jupiter (thermal emission)',
    '云顶什么也凝结不了（矿物与氢分子都被热解离），TiO/VO 造成温度反转':
      'nothing can condense at the cloud top (both minerals and molecular hydrogen are thermally dissociated), and TiO/VO drive a temperature inversion',
    '一个几乎全黑的球，只有边缘因自身热辐射而发光 —— 超热木星在可见光里极暗（WASP-12b 的 A_g < 0.064，Bell et al. 2017），看到的是它自己的光而不是恒星的反光（WASP-121b：Evans et al. 2017）':
      'an almost entirely black sphere glowing only at the limb from its own thermal emission — ultra-hot Jupiters are extremely dark in the visible (A_g < 0.064 for WASP-12b, Bell et al. 2017); what you see is its own light, not reflected starlight (WASP-121b: Evans et al. 2017)',
    '第 V 类 · 高层硅酸盐/铁云': 'Class V · high silicate/iron cloud',
    '主要凝结物为硅酸盐与铁，且云层已经升到光球之上':
      'the main condensates are silicates and iron, and the cloud deck has risen above the photosphere',
    '偏灰黄的反光云顶 —— SBP2000 预言的"重新变亮"的一支，Kepler-7b 就是这样（A_g ≈ 0.35，Demory et al. 2011/2013）':
      'a grey-yellow reflective cloud top — the "brightening again" branch predicted by SBP2000, exactly like Kepler-7b (A_g ≈ 0.35, Demory et al. 2011/2013)',
    '甲烷已不再凝结（这个温度下 CH₄ 逐步让位给 CO，天王星式的青蓝没有了）；':
      'methane no longer condenses (at this temperature CH₄ gives way to CO, so the Uranus-like cyan is gone); ',
    'Sudarsky et al. 2000 巨行星反照率分类': 'Sudarsky et al. 2000 giant-planet albedo classification',
    '云顶温度 ': 'Cloud-top temperature ',
    ' K：': ' K: ',
    '，因此呈': ', hence ',
    '（依据：': ' (source: ',
    '，示意）': '; illustrative)',
    '云顶温度 124 K（T_eff）：主要凝结物为氨冰（NH₃，更深处是 NH₄SH 与水云），因此呈黄褐分明的明暗云带 —— 氨冰本身是白的，黄褐来自云顶的发色团（West et al. 2004；Carlson et al. 2016）（依据：Sudarsky et al. 2000 巨行星反照率分类第 I 类；颜色为实测）':
      'Cloud-top temperature 124 K (T_eff): the main condensate is ammonia ice (NH₃, with NH₄SH and water clouds deeper down), hence the sharply contrasting yellow-brown belts and zones — ammonia ice itself is white; the yellow-brown comes from chromophores at the cloud top (West et al. 2004; Carlson et al. 2016) (source: Class I of the Sudarsky et al. 2000 giant-planet albedo classification; color as measured)',
    '云顶温度 95 K（T_eff）：主要凝结物为氨冰（NH₃），因此呈乳白偏淡金的云带 —— 与木星同属第 I 类，但云顶之上多一层厚的光化学霾，发色团更少，所以带纹比木星淡得多（依据：Sudarsky et al. 2000 巨行星反照率分类第 I 类；颜色为实测）':
      'Cloud-top temperature 95 K (T_eff): the main condensate is ammonia ice (NH₃), hence creamy pale-gold bands — Class I like Jupiter, but with a thick photochemical haze above the cloud top and fewer chromophores, so the banding is far fainter than Jupiter’s (source: Class I of the Sudarsky et al. 2000 giant-planet albedo classification; color as measured)',
    '云顶温度 76 K：主要凝结物为甲烷冰与氨冰，因此呈淡青色（甲烷吸收 0.6–0.9 μm 的红光，只把蓝绿散射回来；上方还有一层厚霾把带纹抹平）（依据：甲烷吸收带 Karkoschka 1998 + 旅行者 2 号实测；颜色为实测）':
      'Cloud-top temperature 76 K: the main condensates are methane ice and ammonia ice, hence a pale cyan (methane absorbs red light at 0.6–0.9 μm and scatters back only blue-green; a thick haze above smooths out the banding) (source: methane absorption bands, Karkoschka 1998 + Voyager 2 measurements; color as measured)',
    '云顶温度 72 K：主要凝结物为甲烷冰与氨冰，因此呈深蓝色（与天王星同为甲烷吸收，但霾层更薄、散射更少，蓝得更深）（依据：甲烷吸收带 Karkoschka 1998 + 旅行者 2 号实测；颜色为实测）':
      'Cloud-top temperature 72 K: the main condensates are methane ice and ammonia ice, hence a deep blue (the same methane absorption as Uranus, but a thinner haze and less scattering make the blue deeper) (source: methane absorption bands, Karkoschka 1998 + Voyager 2 measurements; color as measured)',

    /* ---- 多星系统 ---- */
    '单星': 'Single star',
    '双星': 'Binary',
    '分层三星（稳定判据 MA01）': 'Hierarchical triple (stability criterion MA01)',
    '四星（2+2 分层，MA01）': 'Quadruple (2+2 hierarchy, MA01)',
    '分层三星（真实参数）· 稳定判据 MA01 ✓': 'Hierarchical triple (real parameters) · stability criterion MA01 ✓',
    '外层': 'outer ',
    '双星 P=': 'binary P=',
    '（MA01 ✓ 外/内周期比 ': ' (MA01 ✓ outer/inner period ratio ',
    '，近心比 ': ', pericenter ratio ',
    ' > 判据 ': ' > criterion ',
    '全部恒星的质心': 'the barycenter of all the stars',
    '多重性：Raghavan 2010 的 单 56 / 双 33 / 三 8 / 四+ 3 % 是对太阳型（F6–K3）星的统计；本模块按 Kroupa 2001 IMF 抽全质量段，并按质量缩放伴星率（Duchêne & Kraus 2013：M 矮星 26%、太阳型 44%、O/B ≳80%），样本里八成是 M 矮星，所以总体为 单 71.1 / 双 21.6 / 三 5.3 / 四+ 2.0 %（示意，口径不同不是矛盾）':
      'Multiplicity: the 56 / 33 / 8 / 3 % single / binary / triple / quadruple+ split of Raghavan 2010 is a statistic for solar-type (F6–K3) stars. This module samples the whole mass range from the Kroupa 2001 IMF and scales the companion fraction with mass (Duchêne & Kraus 2013: 26% for M dwarfs, 44% for solar-type, ≳80% for O/B). Eighty per cent of the sample are M dwarfs, so the overall split is 71.1 / 21.6 / 5.3 / 2.0 % (illustrative — the different baselines are not a contradiction)',

    /* ---- 南门二（真实参数） ---- */
    '南门二': 'Alpha Centauri',
    '南门二 A（α Cen A）': 'α Centauri A',
    '南门二 B（α Cen B）': 'α Centauri B',
    '比邻星（Proxima Cen）': 'Proxima Centauri',
    '比邻星': 'Proxima Centauri',
    '比邻星 b': 'Proxima Centauri b',
    '比邻星 d': 'Proxima Centauri d',
    '定位南门二': 'Locate Alpha Centauri',
    'A/B：P = 79.91 年，a ≈ 23.4 AU（17.57″ @ 1.3475 pc），e = 0.52':
      'A/B: P = 79.91 yr, a ≈ 23.4 AU (17.57″ @ 1.3475 pc), e = 0.52',
    '比邻星距 A/B 约 8700 AU，P ≈ 547 kyr，e ≈ 0.50（Kervella et al. 2017）':
      'Proxima lies ≈8700 AU from A/B, P ≈ 547 kyr, e ≈ 0.50 (Kervella et al. 2017)',
    'A/B 与比邻星参数：Kervella et al. 2016/2017；比邻星 b/d：Anglada-Escudé et al. 2016 / Faria et al. 2022；A/B 周围迄今没有确认的行星（S 型稳定区约 ≤ ':
      'Parameters for A/B and Proxima: Kervella et al. 2016/2017; Proxima b/d: Anglada-Escudé et al. 2016 / Faria et al. 2022. No planet around A/B has been confirmed to date (the S-type stability zone is roughly ≤ ',
    ' AU，HW99）': ' AU, HW99)',
    'Faria et al. 2022：最小质量 0.26 M⊕，半径为按质量推算（示意）':
      'Faria et al. 2022: minimum mass 0.26 M⊕; the radius is inferred from the mass (illustrative)',
    'Anglada-Escudé et al. 2016：最小质量 1.07 M⊕，位于宜居带；半径按质量推算，是否有大气未知（示意）':
      'Anglada-Escudé et al. 2016: minimum mass 1.07 M⊕, inside the habitable zone; the radius is inferred from the mass and it is unknown whether it has an atmosphere (illustrative)',
    '真实系外行星（半径与表面为按质量推算的示意）：':
      'A real exoplanet (radius and surface are illustrative, inferred from the mass): ',
    '。绕比邻星运行，': '. It orbits Proxima Centauri, ',
    '潮汐锁定，一面永昼。': 'tidally locked, with one side in perpetual day.',
    '离恒星更近，表面炽热。': 'closer to the star, with a scorching surface.',

    /* ---- 卫星 ---- */
    '卫星': 'Moon',
    '受潮汐加热的火山卫星': 'Tidally heated volcanic moon',
    '有大气的卫星': 'Moon with an atmosphere',
    '受潮汐加热的冰卫星': 'Tidally heated icy moon',
    '冰卫星': 'Icy moon',
    '岩质卫星': 'Rocky moon',
    '一颗被潮汐揉热的火山卫星': 'A volcanic moon kneaded warm by tides',
    '一颗冰质卫星': 'An icy moon',
    '一颗有稀薄大气的卫星': 'A moon with a thin atmosphere',
    '一颗岩质卫星': 'A rocky moon',
    '，半径约 ': ', radius about ',
    ' km，在 ': ' km, on an orbit ',
    ' 的轨道上绕': ' out, circling ',
    '公转一周需要 ': ' once every ',
    ' 天。': ' days. ',
    '母行星的潮汐反复揉捏它的内部，冰壳下可能有一层液态水海洋（木卫二/土卫二类比，示意）。':
      'Tides from the parent planet knead its interior over and over, so there may be a liquid-water ocean beneath the ice shell (by analogy with Europa/Enceladus; illustrative). ',
    '表面几乎没有大气，昼夜温差很大。':
      'It has almost no atmosphere and a large day-night temperature swing. ',
    '它多半已被潮汐锁定，永远以同一面朝向母行星。':
      'It is most likely tidally locked, keeping one face toward its parent forever.',
    '潮汐加热与冰下海洋：木卫二（Khurana 1998 的磁场证据）/ 土卫二（Porco 2006 的南极喷流）类比，示意':
      'Tidal heating and a subsurface ocean: by analogy with Europa (magnetic evidence, Khurana 1998) and Enceladus (south-polar plumes, Porco 2006); illustrative',
    '受潮汐加热：冰壳下可能有液态水海洋（木卫二/土卫二类比，示意）':
      'Tidally heated: there may be a liquid-water ocean beneath the ice shell (by analogy with Europa/Enceladus; illustrative)',
    '受潮汐加热的冰卫星：冰壳下可能有液态海洋（木卫二/土卫二类比，示意）':
      'Tidally heated icy moon: there may be a liquid ocean beneath the ice shell (by analogy with Europa/Enceladus; illustrative)',
    '（半径 ': ' (radius ',
    '，轨道 ': ', orbit ',
    '，周期 ': ', period ',
    ' · 潮汐加热：冰壳下可能有液态水海洋': ' · tidally heated: possible liquid-water ocean beneath the ice',
    ' 的卫星）': ')',
    ' ·潮汐加热': ' ·tidally heated',

    /* ---- 小行星 / 柯伊伯带天体 ---- */
    '柯伊伯带天体（冰质星子）': 'Kuiper belt object (icy planetesimal)',
    'S 型小行星（硅酸盐）': 'S-type asteroid (silicate)',
    'C 型小行星（碳质）': 'C-type asteroid (carbonaceous)',
    '柯伊伯带天体 ': 'KBO ',
    '小行星 ': 'Asteroid ',
    '带内天体': 'belt object',
    'Dohnanyi 1969 的碰撞级联尺寸分布 + DeMeo & Carry 2014 的类型分布 + Britt et al. 2002 的密度（示意）':
      'Size distribution from the Dohnanyi 1969 collisional cascade + taxonomic mix from DeMeo & Carry 2014 + densities from Britt et al. 2002 (illustrative)',
    '一颗': '',
    '冰质的柯伊伯带天体': 'An icy Kuiper belt object',
    '硅酸盐质的 S 型小行星': 'A silicate S-type asteroid',
    '碳质的 C 型小行星': 'A carbonaceous C-type asteroid',
    '，平均半径约 ': ', mean radius about ',
    ' km，': ' km. ',
    '尺寸已经大到被自身引力揉成近似的球。':
      'It is large enough that its own gravity has pulled it into a near-sphere. ',
    '形状不规则——它太小，自引力压不住岩石的强度（Lineweaver & Norman 2010）。':
      'Its shape is irregular — it is too small for self-gravity to overcome the strength of rock (Lineweaver & Norman 2010). ',
    '表面重力只有 ': 'Surface gravity is only ',
    ' m/s²（地球的 ': ' m/s² (',
    ' 倍），逃逸速度 ': '× Earth), and the escape velocity is ',
    '——': ' — ',
    '在这里用力一跳就再也落不回来。': 'a hard jump here would never bring you back down. ',
    '跳起来要很久才落地。': 'a jump takes a long time to come back down. ',
    '没有大气，': 'There is no atmosphere: ',
    '太阳只是一个不比别的星亮多少的点，表面温度约 ':
      'the Sun is a point barely brighter than the other stars, and the surface temperature is about ',
    ' K。': ' K. ',
    '天空永远是黑的，恒星是一个刺眼的亮点，表面温度约 ':
      'the sky is always black, the star a piercing point of light, and the surface temperature is about ',

    /* ---- 彗星 ---- */
    '长周期彗星（奥尔特云来源）': 'Long-period comet (Oort cloud origin)',
    '短周期彗星': 'Short-period comet',
    '彗星 C/': 'Comet C/',
    '长周期彗星（示意）': 'Long-period comet (illustrative)',
    'Whipple 1950 的脏雪球模型 · 核密度与双瓣形状取 Rosetta/67P（Pätzold et al. 2016）· 反照率 0.04 取 Giotto/哈雷（Keller et al. 1986）· 离子尾 Biermann 1951 / 尘埃尾 Finson & Probstein 1968（示意）':
      'Whipple 1950 dirty-snowball model · nucleus density and bilobate shape from Rosetta/67P (Pätzold et al. 2016) · albedo 0.04 from Giotto/Halley (Keller et al. 1986) · ion tail Biermann 1951 / dust tail Finson & Probstein 1968 (illustrative)',
    '：核是一块半径约 ': ': the nucleus is a mixture of ice and dust about ',
    ' km 的冰与尘埃的混合物，密度只有 ': ' km in radius, with a density of only ',
    ' kg/m³（比水还轻，内部大半是空的）。': ' kg/m³ (lighter than water — most of its interior is empty). ',
    '轨道近日 ': 'Its orbit runs from ',
    ' AU、远日 ': ' AU at perihelion to ',
    ' AU，绕一圈需要 ': ' AU at aphelion, taking ',
    ' 年。': ' yr to complete. ',
    '它的样子随日心距变：进到约 3 AU 以内水冰开始升华，喷出的气体与尘埃形成彗发与两条尾；退回远日点就只剩一块几乎全黑的冰。':
      'Its appearance changes with heliocentric distance: inside about 3 AU the water ice begins to sublimate and the escaping gas and dust form a coma and two tails; back at aphelion nothing is left but an almost pitch-black block of ice.',
    '正在离开近日点': 'leaving perihelion',
    '正在接近近日点': 'approaching perihelion',
    '正在远离恒星': 'receding from the star',
    '正在返回': 'on its way back',
    '强烈活动（彗发与彗尾完全展开）': 'strongly active (coma and tails fully developed)',
    '开始活动（彗发出现，尾还短）': 'becoming active (coma visible, tails still short)',
    '刚刚苏醒': 'just waking up',
    '休眠（只剩一块黑冰）': 'dormant (nothing but a block of black ice)',

    /* ---- 恒星本体（近观） ---- */
    '黑洞没有可以站立的表面：视界只是一个"进去就出不来"的单向边界。恒星质量黑洞的视界附近潮汐力足以把任何物体沿径向拉断（意大利面化），落进去的信息也再传不出来。':
      'A black hole has no surface to stand on: the horizon is only a one-way boundary you cannot come back through. Near the horizon of a stellar-mass black hole the tidal force is enough to pull any object apart radially (spaghettification), and no information that falls in ever gets back out.',
    '视界半径 r_s = 2GM/c² = ': 'Horizon radius r_s = 2GM/c² = ',
    ' km（Schwarzschild 1916）· 阴影角半径 ≈ √27/2 · r_s/D':
      ' km (Schwarzschild 1916) · angular shadow radius ≈ √27/2 · r_s/D',
    '中子星表面重力约 10¹¹ 个地球重力，磁场可达 10⁸–10¹⁵ 高斯，表面温度 10⁵–10⁶ K。任何物质靠近都会被压成中子简并态的一层薄壳。':
      'A neutron star has a surface gravity of about 10¹¹ g, a magnetic field of up to 10⁸–10¹⁵ gauss and a surface temperature of 10⁵–10⁶ K. Any matter that comes close is crushed into a thin shell of degenerate neutrons.',
    '典型 1.4 M☉ / 半径 12 km，核心密度超过原子核（Lattimer & Prakash 2004）':
      'Typically 1.4 M☉ and 12 km in radius, with a core denser than an atomic nucleus (Lattimer & Prakash 2004)',
    ' · 磁轴与自转轴不重合 → 脉冲星（Hewish et al. 1968）':
      ' · the magnetic and rotation axes are misaligned → pulsar (Hewish et al. 1968)',
    '白矮星是电子简并物质，表面温度上万到十万 K，表面重力约 10⁵ g。没有能量来源，只能靠余热慢慢冷却。':
      'A white dwarf is electron-degenerate matter with a surface temperature of tens of thousands to a hundred thousand K and a surface gravity of about 10⁵ g. With no energy source, it can only cool slowly on residual heat.',
    '半径 R ∝ M^{−1/3}（Chandrasekhar 1931），约地球大小；末质量取 Kalirai et al. 2008':
      'Radius R ∝ M^{−1/3} (Chandrasekhar 1931), about the size of Earth; the final mass follows Kalirai et al. 2008',
    '恒星没有固体表面。所谓"表面"是光球层——等离子体变得不透明的那一层，厚度只有几百公里，温度数千到数万 K。':
      'A star has no solid surface. Its "surface" is the photosphere — the layer where the plasma turns opaque, only a few hundred kilometres thick, at thousands to tens of thousands of K.',
    '光球温度与半径取 Pecaut & Mamajek 2013 的主序序列 + Heger 2003 的演化分界':
      'Photospheric temperature and radius from the Pecaut & Mamajek 2013 main sequence + the evolutionary boundaries of Heger 2003',
    'Kroupa 2001 IMF · Pecaut & Mamajek 2013 光谱序列 · Heger et al. 2003 演化分界 · Kalirai et al. 2008 白矮星末质量（外观为示意）':
      'Kroupa 2001 IMF · Pecaut & Mamajek 2013 spectral sequence · Heger et al. 2003 evolutionary boundaries · Kalirai et al. 2008 white-dwarf final masses (appearance is illustrative)',
    '一个恒星质量黑洞：': 'A stellar-mass black hole: ',
    ' M☉ 的质量塌进半径 ': ' M☉ collapsed inside a horizon ',
    ' km 的视界之内。它本身不发光，看得见的是被吸进去之前摩擦生热的吸积盘，以及背景星光被引力弯折出来的那一圈亮环。':
      ' km in radius. It emits no light of its own; what you see is the accretion disc heated by friction before the matter falls in, plus the bright ring of background starlight bent by gravity.',
    '一颗中子星：': 'A neutron star: ',
    ' M☉ 压在半径 12 km 的球里，一茶匙的物质就有上亿吨。':
      ' M☉ squeezed into a sphere 12 km in radius — a teaspoon of it weighs hundreds of millions of tonnes. ',
    '它的磁轴与自转轴不重合，两极的辐射束像灯塔一样扫过来——这就是脉冲星。':
      'Its magnetic and rotation axes are misaligned, so the polar beams sweep past like a lighthouse — that is what a pulsar is.',
    '表面温度仍有几十万 K，主要辐射在 X 射线波段。':
      'The surface is still hundreds of thousands of K and radiates mainly in X-rays.',
    '一颗白矮星：一颗中低质量恒星烧完核燃料后剩下的碳氧核心，只有地球大小，却有 ':
      'A white dwarf: the carbon-oxygen core left after a low- or intermediate-mass star burned through its fuel — the size of Earth, yet ',
    ' M☉。它没有能量来源，': ' M☉. With no energy source, its ',
    ' K 的余热要花上百亿年才散得掉。': ' K of residual heat will take tens of billions of years to radiate away.',
    '一颗红巨星：核心的氢已经烧完，外壳膨胀到原来的几十倍，表面因此冷到 ':
      'A red giant: the core hydrogen is exhausted and the envelope has swollen tens of times over, cooling the surface to ',
    ' K 而发红。它的对流层极厚，整个星面只剩几个巨大的对流胞在翻涌。':
      ' K and turning it red. Its convection zone is so deep that only a handful of giant convective cells churn across the whole disc.',
    '一颗渐近巨星支上的恒星：核心是简并的碳氧，外面两层壳交替燃烧氢与氦。它正在剧烈脉动并把外层一层层吹进星际空间，几万年后只会剩下一颗白矮星和一圈行星状星云。':
      'A star on the asymptotic giant branch: a degenerate carbon-oxygen core with two shells alternately burning hydrogen and helium. It pulsates violently and blows its outer layers into interstellar space; in a few tens of thousands of years nothing will be left but a white dwarf and a planetary nebula.',
    '一团行星状星云中心的裸露核心：外壳已经被吹散成一圈发光的气体，中心那颗炽热的星正在变成白矮星。':
      'The bare core at the centre of a planetary nebula: the envelope has been blown out into a glowing ring of gas, and the scorching star at the centre is on its way to becoming a white dwarf.',
    '一片超新星遗迹：这颗大质量恒星已经炸掉，抛出的物质仍在以每秒数千公里向外冲击星际介质。':
      'A supernova remnant: this massive star has already exploded, and the ejecta are still slamming into the interstellar medium at thousands of kilometres per second.',
    '一颗前主序星：它还在靠引力收缩发光，核心的氢聚变尚未稳定点燃。周围往往还留着尚未散尽的原行星盘。':
      'A pre-main-sequence star: it still shines by gravitational contraction, and hydrogen fusion in the core has not yet ignited steadily. A protoplanetary disc often still lingers around it.',
    '型主序星：核心正在把氢聚成氦，光球温度约 ':
      ' main-sequence star: its core is fusing hydrogen into helium at a photospheric temperature of about ',
    ' K。你看到的"表面"是光球层——等离子体在这里变得不透明，厚度只有几百公里，上面翻涌的颗粒是直径上千公里的对流米粒。':
      ' K. The "surface" you see is the photosphere — the layer where the plasma turns opaque, only a few hundred kilometres thick; the grains churning across it are convective granules a thousand kilometres wide.',

    /* ---- 恒星系结构 ---- */
    '轨道内边界 = max(尘埃升华半径 ': 'Inner orbital edge = max(dust sublimation radius ',
    ' AU（T_sub ≈ 1500 K，Isella & Natta 2005 / Millan-Gabet 2007），洛希极限 ':
      ' AU (T_sub ≈ 1500 K, Isella & Natta 2005 / Millan-Gabet 2007), Roche limit ',
    ' AU（Roche 1849））；雪线 ': ' AU (Roche 1849)); snow line ',
    '小行星带': 'Asteroid belt',
    '小行星带（主带）': 'Asteroid belt (main belt)',
    '柯伊伯带 / 外围星子盘': 'Kuiper belt / outer planetesimal disc',
    '柯伊伯带': 'Kuiper belt',
    '黄道尘埃带（碎屑）': 'Zodiacal dust band (debris)',
    '巨行星摄动清空的空隙里剩下的星子（示意；类比主带 2.1–3.3 AU）':
      'Planetesimals left in the gap swept clear by the giant planet (illustrative; by analogy with the main belt at 2.1–3.3 AU)',
    '雪线外没能并入行星的冰质星子（示意；类比 30–50 AU 的柯伊伯带）':
      'Icy planetesimals beyond the snow line that never assembled into planets (illustrative; by analogy with the Kuiper belt at 30–50 AU)',
    '奥尔特云与短周期彗星（示意；数量级取太阳系）':
      'Oort cloud and short-period comets (illustrative; orders of magnitude taken from the Solar System)',
    '木星摄动让这里的星子无法并成行星；总质量只有月球的约 4%（实测）':
      'Jupiter’s perturbations kept these planetesimals from assembling into a planet; the total mass is only about 4% of the Moon (measured)',
    '海王星外的冰质星子盘，冥王星就在其中（实测）':
      'The disc of icy planetesimals beyond Neptune, Pluto among them (measured)',
    '长周期彗星来自奥尔特云（≈2000–100000 AU；Oort 1950）；每世纪肉眼可见的大彗星数量级为十几颗（示意）':
      'Long-period comets come from the Oort cloud (≈2000–100000 AU; Oort 1950); of order a dozen great comets per century are visible to the naked eye (illustrative)',
    '小行星碰撞与彗星尘构成的行星际尘埃云——夜里的黄道光就是它（实测）':
      'An interplanetary dust cloud from asteroid collisions and cometary dust — it is what the zodiacal light at night is (measured)',
    'Sumi et al. 2011：每颗主序星约 1.8 颗木星质量的自由漂浮行星（Mróz et al. 2017 修正为 <0.25 颗/星）。示意：这里只列"此刻在几光年内"的几颗':
      'Sumi et al. 2011: ≈1.8 Jupiter-mass free-floating planets per main-sequence star (revised to <0.25 per star by Mróz et al. 2017). Illustrative: only the few that happen to be within a few light-years right now are listed',
    '热木星：形成于雪线以外，靠盘内迁移或高偏心率迁移 + 潮汐圈化进到恒星跟前，停在观测到的 P ≈ 3 天堆积处（Dawson & Johnson 2018 综述；终点 a ≈ 2 a_Roche，Ford & Rasio 2006）。它现在的轨道在尘埃升华半径以内 —— 那里原地长不出行星，只有迁移能把它送到这个位置。':
      'Hot Jupiter: formed beyond the snow line and brought in close to the star by disc migration or by high-eccentricity migration plus tidal circularization, halting at the observed pile-up near P ≈ 3 d (review: Dawson & Johnson 2018; end point a ≈ 2 a_Roche, Ford & Rasio 2006). Its present orbit lies inside the dust sublimation radius — no planet can form there in situ, so only migration could have put it here.',

    /* ---- 太阳系天体名 ---- */
    '太阳系': 'Solar System',
    '太阳': 'Sun',
    '水星': 'Mercury',
    '金星': 'Venus',
    '火星': 'Mars',
    '木星': 'Jupiter',
    '土星': 'Saturn',
    '天王星': 'Uranus',
    '海王星': 'Neptune',
    '月球': 'Moon',
    '火卫一': 'Phobos',
    '火卫二': 'Deimos',
    '木卫一': 'Io',
    '木卫二': 'Europa',
    '木卫三': 'Ganymede',
    '木卫四': 'Callisto',
    '土卫六': 'Titan',
    '土卫二': 'Enceladus',
    '土卫五': 'Rhea',
    '天卫三': 'Titania',
    '海卫一': 'Triton',
    '冥王星': 'Pluto',
    '谷神星': 'Ceres',
    '灶神星': 'Vesta',
    '智神星': 'Pallas',
    '健神星': 'Hygiea',
    '阋神星': 'Eris',
    '妊神星': 'Haumea',
    '鸟神星': 'Makemake',
    '创神星': 'Quaoar',

    /* ---- 太阳系天体描述（实测） ---- */
    '地球唯一的天然卫星，没有大气，表面布满撞击坑与古老的玄武岩月海。它始终以同一面朝向地球。':
      'Earth’s only natural satellite: no atmosphere, a surface covered in impact craters and ancient basaltic maria. It keeps the same face toward Earth at all times.',
    '太阳系里火山活动最剧烈的天体：木星与另外两颗伽利略卫星的轨道共振把它反复揉捏，内部因此持续熔融（Voyager 1 1979 年拍到了正在喷发的火山）。':
      'The most volcanically active body in the Solar System: the orbital resonance with Jupiter and two other Galilean moons kneads it constantly, keeping its interior molten (Voyager 1 photographed erupting volcanoes in 1979).',
    '冰壳下几乎肯定有一层全球性的液态水海洋，水量可能是地球全部海水的两倍。依据是伽利略号测到的感应磁场（Khurana et al. 1998）与几乎没有撞击坑的年轻冰面。':
      'Beneath the ice shell there is almost certainly a global ocean of liquid water, possibly holding twice as much water as all of Earth’s oceans. The evidence is the induced magnetic field measured by Galileo (Khurana et al. 1998) and a young ice surface with almost no craters.',
    '太阳系最大的卫星，比水星还大，也是唯一有自身磁场的卫星。冰壳深处可能夹着一层咸水海洋。':
      'The largest moon in the Solar System — bigger than Mercury — and the only one with a magnetic field of its own. A salty ocean may be sandwiched deep inside its ice shell.',
    '太阳系里撞击坑最密的天体之一：它没有参与轨道共振，几乎没有内部加热，表面从四十多亿年前保留至今。':
      'One of the most heavily cratered bodies in the Solar System: it takes no part in the orbital resonance and gets almost no internal heating, so its surface has survived from more than four billion years ago.',
    '太阳系里唯一有浓密大气的卫星：1.5 bar 的氮气，地表 94 K，有甲烷的雨、河与湖（惠更斯号 2005 年着陆实测）。':
      'The only moon in the Solar System with a thick atmosphere: 1.5 bar of nitrogen, a surface at 94 K, and rain, rivers and lakes of methane (measured in situ by the Huygens landing in 2005).',
    '直径只有 500 km，南极却在往太空喷水：卡西尼号直接穿过羽流，测到了盐、二氧化硅与有机分子（Porco et al. 2006）。冰壳下有一片液态水海洋。':
      'Only 500 km across, yet its south pole sprays water into space: Cassini flew straight through the plume and measured salts, silica and organic molecules (Porco et al. 2006). A liquid-water ocean lies beneath the ice shell.',
    '主带里最大的天体，也是唯一被归为矮行星的一颗：半径 470 km，已经被自身引力揉成球。黎明号（Dawn, 2015）发现它的地壳含有大量水冰，欧西里斯坑里的亮斑是碳酸钠盐。':
      'The largest body in the main belt and the only one classed as a dwarf planet: 470 km in radius and already pulled into a sphere by its own gravity. Dawn (2015) found abundant water ice in its crust, and the bright spots in Occator crater are sodium carbonate salts.',
    '主带第二大、也是最亮的小行星：分异过的岩质天体，有铁核与玄武岩壳，南极有一个直径 500 km 的巨大撞击盆地（雷亚希尔维亚）。地球上的 HED 陨石就来自这里。':
      'The second largest and the brightest asteroid in the main belt: a differentiated rocky body with an iron core and a basaltic crust, and a 500 km impact basin (Rheasilvia) at its south pole. The HED meteorites found on Earth came from here.',
    '主带第三大天体，轨道倾角高达 34.8°，形状明显不规则、表面遍布大坑——甚高倍适应光学成像显示它像一颗"高尔夫球"（Marsset et al. 2020）。':
      'The third largest body in the main belt, on a strongly inclined orbit (34.8°), clearly irregular and pocked with large craters — high-resolution adaptive-optics imaging makes it look like a golf ball (Marsset et al. 2020).',
    '主带第四大天体，典型的 C 型碳质小行星：反照率只有 0.07，密度不到 2 g/cm³，含水矿物丰富。它接近球形，可能也满足矮行星的判据。':
      'The fourth largest body in the main belt and a typical C-type carbonaceous asteroid: an albedo of just 0.07, a density under 2 g/cm³ and abundant hydrated minerals. It is nearly spherical and may also meet the dwarf-planet criteria.',
    '离散盘天体，质量比冥王星还大 27%——正是它的发现（2005）逼着国际天文联合会重新定义"行星"。表面覆盖着冻结的甲烷，反照率高达 0.96，几乎和新雪一样白。':
      'A scattered-disc object 27% more massive than Pluto — its discovery in 2005 is what forced the IAU to redefine "planet". Its surface is covered in frozen methane with an albedo of 0.96, almost as white as fresh snow.',
    '柯伊伯带里最奇怪的天体之一：3.9 小时转一圈，快到被自转拉成一个 2100×1680×1050 km 的三轴椭球，还带着一圈环（掩星发现，Ortiz et al. 2017）。':
      'One of the strangest objects in the Kuiper belt: it spins once every 3.9 hours, fast enough to have been drawn into a 2100×1680×1050 km triaxial ellipsoid, and it carries a ring (found by stellar occultation, Ortiz et al. 2017).',
    '经典柯伊伯带天体，表面是冻结的甲烷与乙烷颗粒，反照率 0.81。2011 年的掩星显示它几乎没有大气。':
      'A classical Kuiper belt object with a surface of frozen methane and ethane grains and an albedo of 0.81. An occultation in 2011 showed it has almost no atmosphere.',
    '经典柯伊伯带天体，表面有结晶态水冰——这需要某种加热机制不断"退火"，否则宇宙线早该把它打成非晶态。2023 年在它周围也发现了环。':
      'A classical Kuiper belt object with crystalline water ice on its surface — something must keep annealing it, or cosmic rays would long since have turned it amorphous. A ring was found around it in 2023 as well.',
    'Dawn 任务实测（Russell et al. 2016）': 'Measured by the Dawn mission (Russell et al. 2016)',
    'Dawn 任务实测（Russell et al. 2012）': 'Measured by the Dawn mission (Russell et al. 2012)',
    'VLT/SPHERE 成像（Marsset et al. 2020）': 'VLT/SPHERE imaging (Marsset et al. 2020)',
    'VLT/SPHERE 成像（Vernazza et al. 2020）': 'VLT/SPHERE imaging (Vernazza et al. 2020)',
    '掩星测半径（Sicardy et al. 2011）': 'Radius from a stellar occultation (Sicardy et al. 2011)',
    '掩星观测（Ortiz et al. 2017）': 'Occultation observations (Ortiz et al. 2017)',
    '掩星观测（Ortiz et al. 2012）': 'Occultation observations (Ortiz et al. 2012)',
    '掩星与光谱（Jewitt & Luu 2004；Morgado et al. 2023）':
      'Occultation and spectroscopy (Jewitt & Luu 2004; Morgado et al. 2023)',

    /* ---- 地球纪元 ---- */
    '尚未形成': 'Not yet formed',
    '吸积中': 'Accreting',
    '冥古宙 · 岩浆地表': 'Hadean · magma surface',
    '冥古宙末 · 褐色原始海洋': 'Late Hadean · brown primordial ocean',
    '太古宙 · 酸雾渐散': 'Archean · the acid fog thins',
    '元古宙 · 雪球地球': 'Proterozoic · snowball Earth',
    '元古宙 · 海洋变蓝': 'Proterozoic · the ocean turns blue',
    '古生代早期 · 陆地仍是裸岩': 'Early Paleozoic · the land is still bare rock',
    '古生代 · 大陆变绿': 'Paleozoic · the continents turn green',
    '中生代 · 冈瓦纳分裂': 'Mesozoic · Gondwana breaks up',
    '现代 · 文明的灯光': 'Modern · the lights of civilization',
    '新生代 · 现代大陆格局': 'Cenozoic · the modern continents',
    '地表仍在熔融': 'The surface is still molten',
    '陆地已有生物覆盖': 'Life covers the land',
    '稳定演化中': 'Evolving steadily',

    /* ---- describe()：二维与高维 ---- */
    '岩质圆盘': 'rocky disc',
    '被一圈液态水覆盖的圆盘': 'disc covered by a ring of liquid water',
    '气态圆盘，没有可以站立的地面': 'gaseous disc with no ground to stand on',
    '冰封的圆盘': 'frozen disc',
    '熔融的圆盘': 'molten disc',
    '干燥的圆盘': 'dry disc',
    '有生命的圆盘': 'living disc',
    '圆盘': 'disc',
    '二维世界（示意）：这个星球是一个': 'Two-dimensional world (illustrative): this planet is a ',
    '，半径约为地球的 ': ', about ',
    ' 倍；它的地面是一条线——圆周。昼夜是圆盘的两个半圆，大气是圆周外的一圈。':
      '× the radius of Earth. Its ground is a line — the circumference. Day and night are the two half-discs, and the atmosphere is a ring outside the circumference. ',
    '沿着这条线分布着': 'Along that line lie ',
    '聚落与灯光': 'settlements and lights',
    '生命': 'life',
    '（生命等级：': ' (life level: ',
    '）。': '). ',
    '在这里，引力如何随距离变化只是推测（2+1 维）。':
      'How gravity varies with distance here is only conjecture (2+1 dimensions).',
    ' 维': 'D',
    ' 维（分数维）': 'D (fractional)',
    '空间里的一颗试探行星：引力随距离按 r^{−(D−1)} 衰减，':
      ' space, a test planet: gravity falls off as r^{−(D−1)} with distance, ',
    '不存在稳定的圆轨道，轻微扰动就会坠入恒星、或沿径向逃逸到无穷远（Ehrenfest 1917）——两种都发生在这个 D 维空间内部，不是「跑进别的维度」':
      'and no stable circular orbit exists: the slightest perturbation sends it into the star or out radially to infinity (Ehrenfest 1917) — both happen inside this D-dimensional space; nothing "escapes into another dimension"',
    '轨道束缚但不闭合，近心点持续进动': 'so orbits are bound but never close, and the pericenter precesses continuously',
    '。这一层只展示轨道的 3 维投影，不进入行星与地表。':
      '. This level only shows the 3D projection of the orbits; you cannot enter the planets or their surfaces.',

    /* ---- describe()：通用 ---- */
    '此时它还不存在。恒星周围只有一个雾蒙蒙的尘埃环，行星的原材料就在里面。':
      'It does not exist yet. All that surrounds the star is a hazy ring of dust — the raw material of the planets.',
    '行星正在吸积中。尘埃与星子在轨道上碰撞、合并，还没有稳定的表面。':
      'The planet is still accreting. Dust and planetesimals collide and merge along the orbit; there is no stable surface yet.',
    '原始地球，一个灰蒙蒙的球体。地表纵横交错着发红的岩浆河，浓密的酸雾把一切裹在里面；褐色的海刚刚开始凝结。':
      'The primordial Earth, a dull grey sphere. Glowing rivers of magma criss-cross the surface, a dense acid fog wraps everything, and the brown ocean has only just begun to condense.',
    '冥古宙末期。褐色的海面在酸雾下微微起伏，岩浆河已经退到少数低地。若把视点扎入海中，能看到刚出现的生命。':
      'The end of the Hadean. The brown sea heaves gently under the acid fog and the magma rivers have retreated to a few lowlands. Dip the viewpoint beneath the water and you can see life just appearing.',
    '太古宙。笼罩地表的浓雾正在消散，海洋逐渐由褐转蓝，陆地仍是裸露的灰岩，还没有一片绿色。':
      'The Archean. The thick fog over the surface is clearing and the ocean is turning from brown to blue, but the land is still bare grey rock without a trace of green.',
    '元古宙的雪球时期。冰盖从两极推进到赤道附近，海洋几乎被封在冰下。':
      'The snowball episode of the Proterozoic. Ice sheets have advanced from the poles almost to the equator, sealing the ocean under ice.',
    '元古宙。海洋已经是蓝色，陆地依旧荒芜。大气里的氧在缓慢累积。':
      'The Proterozoic. The ocean is blue now, the land still barren, and oxygen is slowly building up in the atmosphere.',
    '显生宙。大陆在变绿，海岸线由植物勾勒出来；巨大的冈瓦纳古陆正像初春的冰块一样分崩离析。':
      'The Phanerozoic. The continents are turning green and plants trace out the coastlines, while the vast supercontinent of Gondwana breaks apart like ice in early spring.',
    '现代地球。蓝色海洋与绿色大陆之间是白色的云系；转到夜面，可以看到人工光源排成的网络——文明出现了。':
      'The modern Earth. White cloud systems drift between blue oceans and green continents; turn to the night side and you can see a network of artificial lights — civilization has arrived.',
    '现代大陆格局的地球。蓝海、绿陆、白云、两极冰盖。人类已经出现，但夜面还看不见灯光。':
      'Earth with its modern continents: blue seas, green land, white clouds and polar ice caps. Humans have appeared, but no lights show on the night side yet.',
    '离太阳最近的岩质行星，没有大气。表面布满撞击坑，昼夜温差超过六百度，看上去与月球十分相似。':
      'The rocky planet closest to the Sun, with no atmosphere. Its cratered surface swings more than six hundred degrees between day and night, and it looks a great deal like the Moon.',
    '与地球大小相当，却被九十多个大气压的二氧化碳和硫酸云层包裹。云下的地表温度约 737 K，是太阳系里最热的行星表面。':
      'The same size as Earth, but wrapped in more than ninety atmospheres of carbon dioxide and clouds of sulfuric acid. The surface below the clouds sits at about 737 K — the hottest planetary surface in the Solar System.',
    '半径约为地球的一半，稀薄的二氧化碳大气留不住热量。地表是氧化铁的红色荒漠，两极有水冰与干冰构成的极冠，有巨大的峡谷与火山。':
      'About half the radius of Earth, with a thin carbon-dioxide atmosphere that cannot hold heat. The surface is a red desert of iron oxide, with polar caps of water ice and dry ice and enormous canyons and volcanoes.',
    '太阳系最大的行星，半径约为地球的 11 倍。表面是沿纬度排列的云带，大红斑是一个持续了数百年的风暴。已知卫星九十余颗。':
      'The largest planet in the Solar System, about 11 times the radius of Earth. Its surface is banded in latitude and the Great Red Spot is a storm that has lasted centuries. More than ninety moons are known.',
    '气态巨行星，密度比水还低。冰粒构成的光环宽达数十万公里，却只有几十米厚。土卫六有浓密的大气。':
      'A gas giant less dense than water. Its rings of ice particles stretch hundreds of thousands of kilometres across yet are only tens of metres thick. Its moon Titan has a thick atmosphere.',
    '冰巨星，自转轴几乎躺在轨道面上。淡青色来自大气里的甲烷，云带很淡，有一组暗弱的细环。':
      'An ice giant whose rotation axis lies almost in its orbital plane. The pale cyan comes from methane in the atmosphere, the banding is faint, and it has a set of narrow, dim rings.',
    '距太阳最远的行星，深蓝色的冰巨星。表面风速可达每秒数百米，偶尔出现大黑斑之类的风暴。':
      'The most distant planet from the Sun, a deep-blue ice giant. Winds reach hundreds of metres per second, and storms such as the Great Dark Spot appear from time to time.',
    '它绕多星系统中的 ': 'It orbits ',
    ' 运行（S 型轨道，稳定区判据 HW99）。':
      ' in a multiple-star system (S-type orbit, stability criterion HW99). ',
    '它绕': 'It orbits ',
    '运行（P 型环双星轨道，恒星辐照取两颗恒星光度之和，稳定区判据 HW99）。':
      ' (P-type circumbinary orbit; the stellar irradiation is the sum of both luminosities, stability criterion HW99). ',
    '半径不到地球的三分之二': 'less than two-thirds the radius of Earth',
    '半径与地球相当（': 'about the radius of Earth (',
    ' 倍）': '×)',
    '半径约为地球的 ': 'about ',
    ' 倍': '× the radius of Earth',
    '生命等级：': 'Life level: ',
    '。': '. ',
    '一颗岩质行星，': 'A rocky planet, ',
    '，表面重力约 ': ', surface gravity about ',
    ' g。': ' g. ',
    '几乎没有大气，地表由撞击坑与古老的熔岩平原构成，昼夜温差极大。':
      'It has almost no atmosphere; the surface is impact craters and ancient lava plains, and the day-night temperature swing is extreme. ',
    '大气稀薄，地表是风化的岩石与尘土，平均温度约 ':
      'The atmosphere is thin and the surface is weathered rock and dust, at a mean temperature of about ',
    '干燥的岩质世界，': 'A dry rocky world, ',
    '稀薄的大气留不住水分，地表以沙丘与风蚀岩为主，平均温度约 ':
      'The thin atmosphere cannot hold water; the surface is mostly dunes and wind-carved rock, at a mean temperature of about ',
    '两极有少量水冰。': 'There is a little water ice at the poles. ',
    '表面几乎全部被液态水覆盖，只有零星岛屿露出海面。':
      'Liquid water covers almost the entire surface, with only scattered islands breaking through. ',
    '大气压约为地球的 ': 'The atmospheric pressure is about ',
    ' 倍，平均温度约 ': '× that of Earth, at a mean temperature of about ',
    '生命在水里。': 'Life is in the water. ',
    '目前没有发现生命。': 'No life has been found so far. ',
    '一颗冰巨星，': 'An ice giant, ',
    '一颗气态巨行星，': 'A gas giant, ',
    '，没有可以站立的表面。': ', with no surface to stand on. ',
    '云带沿纬度排列，风暴系统可以持续数百年。':
      'The cloud bands run along latitude and storm systems can last for centuries. ',
    '已知卫星 ': 'It has ',
    ' 颗。': ' known moons. ',
    '它有一组光环。': 'It has a ring system. ',
    '远离恒星的冰封世界，表面温度约 ': 'A frozen world far from its star, with a surface temperature of about ',
    '冰壳上有纵横的裂隙': 'Fractures criss-cross the ice shell',
    '，稀薄的大气里偶有霜雾': ', frost haze appears now and then in the thin atmosphere',
    '；冰下可能有海洋。': ', and there may be an ocean beneath the ice. ',
    '距离恒星过近，表面温度约 ': 'Far too close to its star: the surface is about ',
    ' K，岩石处于熔融状态。': ' K and the rock is molten. ',
    '夜面能看到发红的岩浆河网与熔岩海，昼面被恒星光烤成一片白热。':
      'On the night side a network of glowing magma rivers and lava seas is visible; the day side is baked white-hot by starlight. ',
    '有生命的世界，': 'A living world, ',
    '，平均温度约 ': ', mean temperature about ',
    '海洋与陆地并存，陆地上覆盖着某种利用恒星光的生物。':
      'Ocean and land coexist, and the land is covered with organisms that live off starlight. ',
    '海洋里已经有生命，陆地还未被覆盖。':
      'There is already life in the ocean, but the land is not yet covered. ',
    '夜面可以看到人工光源排成的网络。':
      'A network of artificial lights is visible on the night side. ',
    '文明尚未出现。': 'No civilization has appeared yet. ',
    '一颗行星。': 'A planet. ',
    '分类：': 'Class: ',
    ' M⊕，质量–半径关系 Chen & Kipping 2017）': ' M⊕, mass–radius relation Chen & Kipping 2017)',
    '，Kepler 出现率约 ': ', Kepler occurrence rate about ',
    '%/星（P<85 d，Fressin et al. 2013）': '% per star (P<85 d, Fressin et al. 2013)',
    '它形成在雪线以外，再迁移进来，停在观测到的 P ≈ ':
      'It formed beyond the snow line and then migrated inward, halting at the observed pile-up near P ≈ ',
    ' 天堆积处（Dawson & Johnson 2018；终点 a ≈ 2 a_Roche，Ford & Rasio 2006）——现在的轨道在尘埃升华半径以内，那里原地长不出行星。观测最终出现率随宿主：FGK 约 0.4–1.2%/星（Fressin 2013 / Wright 2012），M 矮星约 0.1%（Obermeier 2016）——这是文献里的全局最终率，不是单次迁移条件概率。':
      ' d (Dawson & Johnson 2018; end point a ≈ 2 a_Roche, Ford & Rasio 2006). Its present orbit is inside the dust sublimation radius, where no planet can form in situ. The observed final occurrence rate depends on the host: ≈0.4–1.2% per star for FGK (Fressin 2013 / Wright 2012) and ≈0.1% for M dwarfs (Obermeier 2016) — these are the global final rates from the literature, not the conditional probability of a single migration. ',
    '热木星：一般认为从雪线外迁移进来；观测最终出现率随宿主：FGK 约 0.4–1.2%/星（Fressin 2013 / Wright 2012），M 矮星约 0.1%（Obermeier 2016）。':
      'Hot Jupiter: generally thought to have migrated in from beyond the snow line. The observed final occurrence rate depends on the host: ≈0.4–1.2% per star for FGK (Fressin 2013 / Wright 2012) and ≈0.1% for M dwarfs (Obermeier 2016). ',
    '轨道在潮汐锁定半径以内（Kasting et al. 1993），它多半已经被恒星锁定：一面永昼、一面永夜。':
      'Its orbit lies inside the tidal-locking radius (Kasting et al. 1993), so it is most likely locked to the star: one side in perpetual day, the other in perpetual night. ',

    /* ---- 地貌 ---- */
    '城市': 'City',
    '熔岩海': 'Lava sea',
    '海面': 'Open water',
    '海岸': 'Coast',
    '冰原': 'Ice sheet',
    '山地': 'Mountains',
    '丘陵': 'Hills',
    '荒漠平原': 'Desert plain',
    '岩浆平原': 'Magma plain',
    '平原': 'Plain',
    '高地': 'Highland',
    '植被带': 'Vegetation belt',
    '熔岩': 'Lava',
    '荒地': 'Barren ground',
    '升华塌陷坑的陡崖': 'Cliffs of a sublimation collapse pit',
    '崎岖的冰尘地形': 'Rugged ice-and-dust terrain',
    '回落尘埃铺成的平坦区（尘埃池）': 'Flats paved by fallback dust (a dust pond)',
    '撞击坑壁与棱脊': 'Crater walls and ridges',
    '坑洼的风化层': 'Pitted regolith',
    '碎石堆平原（遍地砾石）': 'Rubble-pile plain (gravel everywhere)',
    '亮带（上升气流）': 'Bright zone (upwelling)',
    '暗带（下沉气流）': 'Dark belt (downwelling)',
    '过程生成（示意）': 'Procedurally generated (illustrative)',
    '聚落 ': 'Settlement ',

    /* ---- 面包屑 ---- */
    '卫星表面': 'Moon surface',
    '小行星表面': 'Asteroid surface',
    '彗核表面': 'Comet nucleus surface',
    '地表': 'Surface',
    '气态/冰巨星没有固体表面：降落即为云顶飞越，高度相对 1 bar 参考面。':
      'Gas and ice giants have no solid surface: landing means flying over the cloud tops, with altitude measured from the 1 bar reference level.',

    /* ---- 恒星系视图 HUD ---- */
    'Enter 进入 · 再点一次或双击进入': 'Enter to go in · click again or double-click to enter',
    '时间流速 ×': 'Time rate ×',
    '（1 秒 = ': ' (1 s = ',
    '，约为实时的 ': ', about ',
    ' 倍）': '× real time)',
    '恒星尚未点燃': 'the star has not ignited yet',
    '尘埃环，行星尚未诞生（': 'dust ring, no planets born yet (',
    '恒星系年龄 ': 'System age ',
    ' 颗行星': ' planets',
    '恒星：': 'Star: ',
    ' M☉，': ' M☉, ',
    ' L☉）': ' L☉)',
    ' · 变星 ': ' · variable ',
    '，P=': ', P=',
    '抽样：': 'Sampling: ',
    ' · 光谱序列 ': ' · spectral sequence ',
    ' · 演化与遗骸 Heger 2003 / Kalirai 2008 · 行星出现率 Fressin 2013 / Petigura 2013（均为示意）':
      ' · evolution and remnants Heger 2003 / Kalirai 2008 · planet occurrence Fressin 2013 / Petigura 2013 (all illustrative)',
    ' · 行星：S 型绕单星 / P 型绕双星（HW99 稳定区）':
      ' · planets: S-type around one star / P-type around the binary (HW99 stability zone)',
    ' · 行星：S 型（HW99 稳定区）': ' · planets: S-type (HW99 stability zone)',
    '恒星系形态：': 'System morphology: ',
    '小天体：': 'Small bodies: ',
    '（代表天体：': ' (representative bodies: ',
    '，实测）': ', measured)',
    '（点带为示意，颗数不代表真实数量；面板可进入其中的代表天体）':
      ' (the dotted belts are illustrative and the number of dots is not the real count; the panel lets you enter the representative bodies)',
    '彗星：奥尔特云外缘约 ': 'Comets: the outer edge of the Oort cloud is about ',
    ' 万 AU': '×10⁴ AU',
    '，长周期彗星约 ': ', with roughly ',
    ' 颗/世纪 · ': ' long-period comets per century · ',
    '（可进入彗核：彗发与彗尾随日心距变化）':
      ' (you can enter the nucleus: the coma and tails change with heliocentric distance)',
    '流浪行星：此刻 ': 'Rogue planets: ',
    ' 光年内有 ': ' light-years away right now there are ',
    ' 颗（不绕任何恒星，可进入；': ' of them (orbiting no star; you can enter them; ',
    '吸积盘为示意：黑洞本身不发光，画面上那圈发热的物质是被吸进去之前摩擦生热的盘。它的视界半径只有 ':
      'The accretion disc is illustrative: the black hole itself emits no light, and the glowing ring on screen is matter heated by friction before it falls in. Its horizon radius is only ',
    ' km（≈ ': ' km (≈ ',
    ' AU），按真比例在这一层连一个像素都不到，所以盘的**大小按取景半径给**（约 6%，只随黑洞质量弱变化），不代表真实尺度；内缘取最内稳定圆轨道 ISCO = 3 r_s、外缘取 22 r_s（与近景观同一口径），内外之比是真的。颜色按 Shakura & Sunyaev 1973 的薄盘温标 T ∝ R^{−3/4}（内缘蓝白、外缘橙红），亮暗不对称是相对论性集束。要按 r_s 看盘，点进黑洞本体。':
      ' AU) — at true scale it would not span a single pixel at this zoom, so the **disc size is set from the framing radius** (about 6%, varying only weakly with black-hole mass) and does not represent the real scale. The inner edge is the innermost stable circular orbit, ISCO = 3 r_s, and the outer edge 22 r_s (the same convention as the close-up), so the inner-to-outer ratio is real. The colors follow the Shakura & Sunyaev 1973 thin-disc temperature scale T ∝ R^{−3/4} (blue-white inside, orange-red outside), and the brightness asymmetry is relativistic beaming. To see the disc in units of r_s, click into the black hole itself.',
    '恒星本体：点击': 'The star itself: click ',
    '可近观（安全距离外的示意；恒星与遗骸都不可降落，进去会说明为什么）。':
      ' for a close-up (illustrative, from beyond a safe distance; neither stars nor remnants can be landed on, and going in explains why).',
    '卫星：轨道已放大约 ': 'Moons: orbits are enlarged about ',
    ' 倍显示（真实轨道在这个视图里不到一个像素）· M 键切换「所有行星都显示卫星」':
      '× for display (the real orbits would be under a pixel at this zoom) · press M to toggle "show moons for every planet"',
    '卫星：行星标签后的「N 卫」即卫星数；选中行星或按 M 可看放大示意':
      'Moons: the "N moons" after a planet label is its moon count; select a planet or press M to see the enlarged view',
    ' · , / . 或 Shift+滚轮 调速 · M 卫星 · T 经典三体演示':
      ' · , / . or Shift+wheel to change speed · M for moons · T for the classic three-body demo',
    '拖动旋转 · 滚轮缩放 · 单击选中行星（再点一次/双击/Enter 进入） · [ ] 切换':
      'Drag to rotate · wheel to zoom · click to select a planet (click again / double-click / Enter to enter) · [ ] to cycle',
    ' · Enter 近观（安全距离外，不可降落）': ' · Enter for a close-up (from a safe distance; no landing)',
    ' 卫': ' moons',
    ' · 环': ' · rings',
    '卫星：': 'Moons: ',
    ' 等 ': ' — ',
    ' 颗': ' in total',
    '（双击卫星进入）': ' (double-click a moon to enter it)',
    '宿主是': 'The host is a ',
    '（光度 ': ' (luminosity ',
    ' L☉）：这里几乎没有星光，画面亮度为示意，只为看清地形轮廓与地平线。':
      ' L☉): there is almost no starlight here, so the on-screen brightness is illustrative, only enough to make out the terrain and the horizon.',

    /* ---- 小天体 / 彗星 / 流浪行星 视图 ---- */
    '平均半径 ': 'mean radius ',
    '关键参数：半径 ': 'Key parameters: radius ',
    ' km · 密度 ': ' km · density ',
    ' kg/m³ · 反照率 ': ' kg/m³ · albedo ',
    ' · 表面重力 ': ' · surface gravity ',
    ' m/s²（': ' m/s² (',
    ' g）· 逃逸速度 ': ' g) · escape velocity ',
    ' · 自转 ': ' · rotation ',
    ' h · 平衡温度 ': ' h · equilibrium temperature ',
    ' K · 无大气': ' K · no atmosphere',
    '数据：实测（': 'Data: measured (',
    '）；表面纹理与形状为示意': '); surface texture and shape are illustrative',
    '示意（依据：': 'Illustrative (source: ',
    ' · 形状不规则：三轴比约 1 : ': ' · irregular shape: axis ratios about 1 : ',
    ' · 已被自引力揉圆': ' · rounded by self-gravity',
    '画面里的其它小天体为示意：主带真实平均间距在 10⁶ km 量级，站在一颗上几乎看不见另一颗；这里按碰撞族（Hirayama 1918）压缩到几倍核半径显示。':
      'The other small bodies on screen are illustrative: the real mean separation in the main belt is of order 10⁶ km, so from one you could hardly see another. Here they are compressed to a few body radii, as within a collisional family (Hirayama 1918).',
    '拖动旋转 · 滚轮拉近直至降落到表面 · [ ] 切换同一条带里的其它天体 · Esc 返回恒星系':
      'Drag to rotate · wheel in until you land on the surface · [ ] to cycle through other bodies in the same belt · Esc to return to the system',
    ' · 日心距 ': ' · heliocentric distance ',
    '关键参数：核半径 ': 'Key parameters: nucleus radius ',
    ' kg/m³（孔隙率高，内部大半是空的）· 反照率 0.04（太阳系里最黑的一类表面）· 表面重力 ':
      ' kg/m³ (highly porous — most of the interior is empty) · albedo 0.04 (one of the darkest surfaces in the Solar System) · surface gravity ',
    ' m/s² · 逃逸速度 ': ' m/s² · escape velocity ',
    ' m/s · 近日 ': ' m/s · perihelion ',
    ' AU / 远日 ': ' AU / aphelion ',
    ' AU / 周期 ': ' AU / period ',
    '活动度随时间变：当前 r = ': 'Activity changes with time: currently r = ',
    ' AU（': ' AU (',
    '），活动度 ': '), activity ',
    '% —— 水冰在约 ': '% — water ice only sublimates appreciably within about ',
    ' AU 以内才明显升华，产气率再按 1/r² 的日照标度。拖动时间条到近日点附近，彗发与彗尾会长出来；退到远日点只剩一块黑冰。':
      ' AU, and the gas production then scales with the 1/r² insolation. Drag the time bar toward perihelion and the coma and tails grow; back at aphelion only a block of black ice is left.',
    '彗发半径此刻约 ': 'The coma radius is currently about ',
    ' 万 km': '×10⁴ km',
    '，彗尾约 ': ', and the tails about ',
    '——真实尺度远大于画面，这里按屏幕压缩显示（示意）。蓝色的是离子尾（太阳风吹的，严格背向恒星；Biermann 1951），黄白色的是尘埃尾（被轨道运动拖弯；Finson & Probstein 1968）。真实彗发会把彗核完全盖住（乔托号、罗塞塔正是为此才必须飞过去），这里把最内圈的彗发挖空，才看得见核的轮廓。':
      ' — the true scale is far larger than the frame, so it is compressed to the screen (illustrative). The blue one is the ion tail (blown by the stellar wind, pointing strictly anti-starward; Biermann 1951) and the yellow-white one is the dust tail (curved by orbital motion; Finson & Probstein 1968). A real coma would hide the nucleus completely (which is exactly why Giotto and Rosetta had to fly through it), so the innermost coma is cut away here to keep the nucleus visible.',
    '近日点窗口很窄：这颗彗星 ': 'The perihelion window is narrow: of this comet’s ',
    ' 年的周期里只有约 ': ' yr period only about ',
    ' 年（': ' yr (',
    '%）在 3 AU 以内——开普勒第二定律的直接后果。':
      '%) is spent within 3 AU — a direct consequence of Kepler’s second law.',
    '距下一次过近日点还有约 ': 'The next perihelion passage is about ',
    '依据：': 'Source: ',
    '拖动旋转 · 滚轮拉近直至降落到彗核表面 · [ ] 切换其它彗星 · Esc 返回恒星系':
      'Drag to rotate · wheel in until you land on the nucleus · [ ] to cycle through other comets · Esc to return to the system',
    ' R⊕ · 质量 ': ' R⊕ · mass ',
    ' M⊕ · 表面重力 ': ' M⊕ · surface gravity ',
    ' g · 表面温度约 ': ' g · surface temperature about ',
    ' K（': ' K (',
    ' ℃）· 恒星辐照 0（没有宿主恒星）': ' ℃) · stellar irradiation 0 (no host star)',
    '照明：这里唯一的光源是整个天空的星光——比地球上的满月还暗几个数量级。画面亮度是示意，只为看清地形轮廓；真实景象接近全黑。热量全部来自内部余热与放射性衰变（':
      'Illumination: the only light source here is the starlight of the whole sky — orders of magnitude fainter than a full moon on Earth. The on-screen brightness is illustrative, just enough to make out the terrain; the real view is close to pitch black. All of its heat comes from residual internal heat and radioactive decay (',
    ' K 就是这么维持的）。': ' K is what that sustains).',
    '拖动旋转 · 滚轮拉近直至降落 · [ ] 切换其它流浪行星 · Esc 返回恒星系':
      'Drag to rotate · wheel in until you land · [ ] to cycle through other rogue planets · Esc to return to the system',

    /* ---- 星球视图 ---- */
    '卫星 ': 'Moons: ',
    '（画出最大的 ': ' (the largest ',
    ' 颗，大小为真实比例；轨道距离已压缩约 ':
      ' are drawn at true relative size; orbital distances are compressed about ',
    ' 倍才进得了画面，双击卫星进入）':
      '× to fit the frame — double-click a moon to enter it)',
    ' · 另有一组行星环': ' · plus a ring system',
    '这颗行星有一组行星环。': 'This planet has a ring system.',
    '受潮汐加热的冰卫星：': 'Tidally heated icy moon: ',
    '返回上一级（Esc）回到母行星 ': 'Esc goes back up to the parent planet ',
    ' · [ ] 切换同一颗行星的其它卫星': ' · [ ] to cycle through the planet’s other moons',
    '拖动旋转 · 滚轮拉近直至降落 · 双击某点直接降落 · Esc 返回':
      'Drag to rotate · wheel in until you land · double-click a spot to land there · Esc to go back',

    /* ---- 恒星近观 HUD ---- */
    '视界半径 ': 'horizon radius ',
    '半径 12 km': 'radius 12 km',
    '半径 ': 'radius ',
    ' km（约地球大小）': ' km (about the size of Earth)',
    ' R☉（': ' R☉ (',
    ' km）': ' km)',
    '）· 观察距离 ': ') · viewing distance ',
    '关键参数：': 'Key parameters: ',
    '（末质量；前身 ': ' (final mass; progenitor ',
    ' M☉）': ' M☉)',
    '无光球': 'no photosphere',
    ' · 光度 ': ' · luminosity ',
    ' · 年龄 ': ' · age ',
    '不可降落：': 'Cannot land: ',
    '　此处辐照约 ': '  The irradiation here is about ',
    ' S⊕（地球日照 = 1），"安全距离"取辐照 ≈ 2 S⊕ 处，约 ':
      ' S⊕ (Earth insolation = 1); the "safe distance" is taken where the irradiation is ≈2 S⊕, about ',
    ' AU。': ' AU.',
    '画面里的透镜效应是示意：背景星光按弱场偏折 α ≈ 2r_s/b 反向映射，阴影角半径取 √27/2 · r_s/D（Schwarzschild 解），光子环与"次像"细环只画到量级；吸积盘的完整次像（Luminet 1979）没有画。吸积盘温度按 T ∝ R^{−3/4}（Shakura & Sunyaev 1973），内缘取 ISCO = 3 r_s（无自转），外缘取 22 r_s 为示意压缩（真实盘可伸到数百～数千 r_s；恒星系视图用同一个内外比，只是那边的绝对尺度按取景半径给），亮暗不对称是相对论性集束。':
      'The lensing on screen is illustrative: background starlight is inverse-mapped with the weak-field deflection α ≈ 2r_s/b, the angular shadow radius is √27/2 · r_s/D (Schwarzschild solution), and the photon ring and the thin "secondary image" ring are drawn only to order of magnitude; the full secondary image of the disc (Luminet 1979) is not drawn. The disc temperature follows T ∝ R^{−3/4} (Shakura & Sunyaev 1973), the inner edge is ISCO = 3 r_s (non-spinning) and the outer edge 22 r_s as an illustrative compression (a real disc can extend to hundreds or thousands of r_s; the system view uses the same inner-to-outer ratio, only with its absolute size set from the framing radius). The brightness asymmetry is relativistic beaming.',
    '两极的亮斑是磁极热斑（示意）：': 'The bright polar spots are magnetic hot spots (illustrative): ',
    '这一颗的磁轴与自转轴不重合，辐射束随自转扫过观察者就成了脉冲——它是一颗脉冲星（Hewish et al. 1968 发现，Gold 1968 给出灯塔模型）。':
      'this one has misaligned magnetic and rotation axes, so the beam sweeps past the observer once per rotation and is seen as a pulse — it is a pulsar (discovered by Hewish et al. 1968; the lighthouse model is due to Gold 1968).',
    '这一颗没有被标为脉冲星：要么磁轴与自转轴太接近、要么辐射束扫不到我们这个方向（射电脉冲星的可见性只有几成）。':
      'this one is not flagged as a pulsar: either its magnetic and rotation axes are too closely aligned, or the beam never sweeps our way (only a fraction of radio pulsars are visible from any given direction).',
    '中子星没有光球也没有对流米粒，画面上的纹理只为让球体不至于是一块纯色。':
      'A neutron star has neither a photosphere nor convective granules; the texture on screen only keeps the sphere from being a flat block of color.',
    '脉动为示意：AGB 星常是刍藁型（Mira）长周期变星，光变幅度可达几个星等，同时通过星风每年抛掉 10⁻⁷–10⁻⁴ M☉。':
      'The pulsation is illustrative: AGB stars are often Mira-type long-period variables, varying by several magnitudes while shedding 10⁻⁷–10⁻⁴ M☉ per year in a stellar wind.',
    '外观为示意：白矮星的对流层极薄，实际几乎看不到米粒组织；这里只留一点点纹理免得像一个纯色圆盘。':
      'The appearance is illustrative: a white dwarf’s convection zone is extremely thin and granulation is essentially invisible; only a hint of texture is kept here so it does not look like a flat disc.',
    '米粒组织、黑子、日珥的位置与花纹都是过程生成（示意）；临边昏暗按 I(μ)/I(0) = 1 − u(1−μ)、u ≈ ':
      'The positions and patterns of granulation, spots and prominences are procedurally generated (illustrative). Limb darkening follows I(μ)/I(0) = 1 − u(1−μ) with u ≈ ',
    '（Eddington 灰大气近似）；对流胞尺度 ~ 压力标高（Schwarzschild 1975），所以巨星上只剩几个巨胞。米粒被放大了约 20 倍：太阳的米粒直径约 1000 km，只有星面的 1/700，按真比例在屏幕上不到两个像素。':
      ' (Eddington grey-atmosphere approximation); the convective cell size scales with the pressure scale height (Schwarzschild 1975), which is why only a few giant cells remain on a giant star. The granules are enlarged about 20×: solar granules are about 1000 km across, 1/700 of the disc, and at true scale would be under two pixels on screen.',
    '拖动旋转 · 滚轮改变观察距离 · Esc 返回恒星系':
      'Drag to rotate · wheel to change the viewing distance · Esc to return to the system',

    /* ---- 地表 / 云顶飞越 ---- */
    '北纬 ': 'N ',
    '南纬 ': 'S ',
    '东经 ': 'E ',
    '西经 ': 'W ',
    '高度（1 bar 参考面以上）': 'altitude above the 1 bar level ',
    '1 bar 参考面以下 ': 'below the 1 bar level ',
    ' · 气压约 ': ' · pressure about ',
    ' · 气温约 ': ' · air temperature about ',
    ' · 自动巡航（任意按键接管）': ' · auto-cruise (any key takes over)',
    ' · 自动前进（← → 接管）': ' · auto-advance (← → takes over)',
    '冰巨星：氢氦大气之下是水/氨/甲烷的超临界流体幔，同样没有可以站立的表面；高度一律相对 1 bar 参考面。':
      'Ice giant: below the hydrogen-helium atmosphere lies a supercritical mantle of water, ammonia and methane — again with no surface to stand on. All altitudes are relative to the 1 bar level.',
    '气态巨行星：没有固体表面，只有分层的对流云带（依据：Juno 重力场测量）；高度一律相对 1 bar 参考面。':
      'Gas giant: no solid surface, only layered convective cloud bands (source: Juno gravity measurements). All altitudes are relative to the 1 bar level.',
    '滚轮 = 升降（往下只会进入更浓的霾）· WASD/方向键 平移 · 拖动 视角 · Esc 返回星球':
      'Wheel = climb/descend (going down only takes you into thicker haze) · WASD/arrows to move · drag to look · Esc to return to the planet',
    '视点在海面以下 ': 'viewpoint below sea level ',
    '地表视角 · 高度 ': 'surface view · altitude ',
    '高度 ': 'altitude ',
    ' · 正在飞越：': ' · flying over: ',
    '生命，刚出现的生命。': 'Life — life that has only just appeared.',
    '陆地 ': 'land ',
    '最近城市：': 'Nearest city: ',
    '，人口约 ': ', population about ',
    ' 百万': ' million',
    ' 万': '×10⁴',
    '城市位置：Natural Earth（真实）；建筑为示意':
      'City positions: Natural Earth (real); the buildings are illustrative',
    '城市与建筑均为过程生成示意': 'Both cities and buildings are procedurally generated and illustrative',
    '地表：': 'Surface: ',
    ' · 相对基准面 ': ' · relative to datum ',
    ' m · 表面重力 ': ' m · surface gravity ',
    ' m/s²（地球的 ': ' m/s² (',
    ' 倍）· 逃逸速度 ': '× Earth) · escape velocity ',
    '：以 3 m/s 起跳能升到 ': '. A 3 m/s jump would take you ',
    '……直接飞走（初速已超过逃逸速度）': '… straight off the body (the take-off speed already exceeds escape velocity)',
    ' km 高': ' km up',
    ' m 高': ' m up',
    '，落回来要 ': ', and coming back down would take ',
    ' 分钟。': ' minutes.',
    '没有大气：天空永远是黑的、星星白天也在，':
      'No atmosphere: the sky is always black and the stars are out even by day. The ',
    '只是一个视半径约 ': ' is just a piercing point about ',
    ' 角分的刺眼亮点（地球上看太阳是 32 角分）；没有风化、没有声音，昼夜温差全靠辐射平衡。地平线只有 ':
      ' arcmin in apparent radius (the Sun from Earth is 32 arcmin). There is no weathering and no sound, and the day-night temperature swing is set purely by radiative balance. The horizon is only ',
    ' 远——这颗天体半径只有 ': ' away — this body is a mere ',
    '天上的其它小天体为示意：主带真实平均间距在 10⁶ km 量级，肉眼看不到邻居；这里按碰撞族（Hirayama 1918）与双小行星（Margot et al. 2002：近地小行星约 15% 是双星）压缩显示。地表为过程生成（示意），':
      'The other small bodies in the sky are illustrative: the real mean separation in the main belt is of order 10⁶ km, so no neighbour would be visible to the eye. They are compressed here as within a collisional family (Hirayama 1918) and as binary asteroids (Margot et al. 2002: about 15% of near-Earth asteroids are binaries). The terrain is procedurally generated (illustrative); ',
    '半径/密度/反照率/自转为实测。': 'radius, density, albedo and rotation are measured values.',
    '依据见星球视图。': 'see the planet view for sources.',
    '彗核表面：日心距 ': 'Comet nucleus surface: heliocentric distance ',
    ' AU，活动度 ': ' AU, activity ',
    '%。': '%. ',
    '脚下的冰正在升华，尘埃被气流带着离开——这也是彗核每过一次近日点就轻一点的原因。':
      'The ice underfoot is subliming and the escaping gas carries dust away — which is why the nucleus gets a little lighter with every perihelion passage.',
    '此刻它是休眠的：温度太低，冰不升华，只剩一层被太阳晒黑的尘壳。':
      'Right now it is dormant: too cold for the ice to sublimate, leaving only a sun-darkened dust crust.',
    '形状与地形为示意，密度/反照率/双瓣结构取 Rosetta 的 67P。':
      'The shape and terrain are illustrative; density, albedo and the bilobate structure follow Rosetta’s 67P.',
    '注意：不规则形状只在星球视图的剪影上体现；地表飞越用的是局部球面近似（示意）。':
      'Note: the irregular shape only shows in the silhouette in the body view; the surface fly-over uses a local spherical approximation (illustrative).',
    '照明：没有宿主恒星，唯一光源是整个天空的星光。画面亮度为示意（只为看清地形轮廓），真实景象接近全黑；表面温度 ':
      'Illumination: with no host star, the only light source is the starlight of the whole sky. The on-screen brightness is illustrative (just enough to make out the terrain) and the real view is close to pitch black. The surface temperature of ',
    ' K 全部来自内部余热与放射性衰变。依据：':
      ' K comes entirely from residual internal heat and radioactive decay. Source: ',
    '滚轮 = 高度 · WASD/方向键 平移 · 拖动 视角 · Shift 加速 · 双击 下潜到该处 · Esc 返回':
      'Wheel = altitude · WASD/arrows to move · drag to look · Shift to speed up · double-click to drop to that spot · Esc to return to the ',
    '天体视图': 'body view',
    '星球': 'planet',

    /* ---- 2 维世界 ---- */
    ' · 二维宇宙的恒星系（示意 · 2 维几何）· 引力 ∝ 1/r（对数势，2+1 维推测）· 轨道为真实积分的玫瑰线 · 恒星系年龄 ':
      ' · star system in a two-dimensional universe (illustrative · 2D geometry) · gravity ∝ 1/r (logarithmic potential, 2+1 dimensions conjectural) · the rosette orbits are genuinely integrated · system age ',
    ' 天）· 拖动平移 · 滚轮缩放 · 单击选中，再点/双击/Enter 进入':
      ' d) · drag to pan · wheel to zoom · click to select, then click again / double-click / Enter to enter',
    ' · 二维世界（示意 · 2 维几何）· ': ' · two-dimensional world (illustrative · 2D geometry) · ',
    ' · 圆盘就是整个星球，圆周就是它的地面':
      ' · the disc is the whole planet and its circumference is the ground',
    '拖动旋转 · 滚轮拉近直至降落 · 双击圆周某处降落 · Esc 返回':
      'Drag to rotate · wheel in until you land · double-click anywhere on the circumference to land · Esc to go back',
    ' · 二维世界（示意）· 地面是一条线 · 沿圆周 ':
      ' · two-dimensional world (illustrative) · the ground is a line · along the circumference ',
    ' · 高度 ': ' · altitude ',
    '← → / A D 沿剖面前进 · 滚轮 = 高度 · Esc 返回':
      '← → / A D to move along the profile · wheel = altitude · Esc to go back',

    /* ---- D 维轨道投影演示 ---- */
    '试探行星 ': 'Test planet ',
    '束缚': 'bound',
    '坠入': 'infall',
    '逃逸': 'escaped',
    ' · 进动 ': ' · precession ',
    '°/圈': '°/orbit',
    ' · 投影外 ': ' · outside the projection ',
    ' 维（分数维，推测：分形/谱维数模块）': 'D (fractional, conjectural: fractal / spectral dimension module)',
    '两体问题的 3 维投影 · 引力 r^{−(D−1)} · ':
      ' two-body problem, projected into 3D · gravity r^{−(D−1)} · ',
    'Ehrenfest 1917：D≥4 无稳定圆轨道': 'Ehrenfest 1917: no stable circular orbits for D≥4',
    '3<D<4：束缚但进动': '3<D<4: bound but precessing',
    '2<D<3：束缚但进动（力更长程）': '2<D<3: bound but precessing (a longer-range force)',
    'D=3 对照：闭合椭圆，稳定': 'D=3 control: closed ellipses, stable',
    ' · 扰动 ': ' · perturbation ',
    '% · 束缚 ': '% · bound ',
    '：第 4': ': the 4th',
    ' 维方向未绘制，这里画的是八维轨迹在三维里的投影（影子）。':
      ' and higher directions are not drawn; what you see is the shadow of an eight-dimensional trajectory projected into three dimensions. ',
    '当前为**纯投影**：质点不因"跑到看不见的方向"而变淡——真实的投影本来就不会（就像影子不会因为物体离墙远而变暗）。代价是它可能忽然折返或彼此穿过，因为那一步发生在没画出来的方向上。按 P 切回可读性提示。':
      'Currently a **pure projection**: points do not fade when they travel along directions you cannot see — a real projection never would (a shadow does not dim as the object moves away from the wall). The price is that they may suddenly double back or pass through one another, because that step happened along an undrawn direction. Press P to switch the readability cues back on. ',
    '当前叠加了**可读性提示**（非投影本身的性质）：质点按投影外分量比例变淡、拖尾改虚线，好让你看出它正沿没画出来的方向走远。按 P 关掉，看纯投影。':
      '**Readability cues** are currently overlaid (they are not a property of the projection itself): points fade in proportion to the component outside the projection and their trails turn dashed, so you can tell they are moving away along an undrawn direction. Press P to turn them off and see the pure projection. ',
    '束缚/坠入/逃逸一律按 D 维真实距离判定：「逃逸」= 径向距离跑向无穷远，质点始终待在这个 D 维空间里、始终有完整的 D 个坐标，不存在"换到别的维度去"这回事；':
      'Bound / infall / escape are always decided by the true D-dimensional distance: "escape" means the radial distance runs off to infinity. The point always stays inside this D-dimensional space and always has its full D coordinates; there is no such thing as "moving to another dimension". ',
    '而质点在影子里变淡只是沿着没画出来的方向走了，它可能**仍然被束缚**——这两件事别混。':
      'A point fading in the shadow only means it moved along an undrawn direction — it may **still be bound**. Do not confuse the two. ',
    'D=4 是临界情形：扰动严格为 0 时圆轨道能一直转下去，但扰动会指数放大（实测扰动缩小 10 倍，寿命只延长约 3 倍），按 − 把扰动调小可以亲眼看到这条刀锋。':
      'D=4 is the marginal case: with a perturbation of exactly 0 a circular orbit can go round forever, but any perturbation grows exponentially (measured here: shrinking the perturbation 10× extends the lifetime only about 3×). Press − to lower the perturbation and watch that knife edge for yourself.',
    'D≥5 连零扰动都留不住：圆轨道对应有效势的极大值，浮点舍入误差就足以推翻它（实测 D=5 约 3 圈、D=6 约 2 圈即失稳）。':
      'For D≥5 not even zero perturbation holds: the circular orbit sits at a maximum of the effective potential, and floating-point rounding alone is enough to topple it (measured here: instability after about 3 orbits at D=5 and 2 at D=6).',
    '分数维 D=': 'Fractional dimension D=',
    '：无额外坐标轴，维数只通过引力律指数 r^{−(D−1)} 起作用（推测）':
      ': no extra coordinate axes; the dimension acts only through the exponent of the gravitational law r^{−(D−1)} (conjectural)',
    '当前注入扰动 ε=': 'Injected perturbation ε=',
    '0（严格圆轨道，没有推它）': '0 (an exactly circular orbit, nothing pushing it)',
    '——你看到的逃逸是这个扰动被放大的结果，按 − 一路调到 0 自己验：D=4 会一直转，D≥5 照样失稳。':
      ' — the escapes you see are that perturbation being amplified. Press − all the way down to 0 and check for yourself: D=4 keeps going round, D≥5 goes unstable anyway.',
    ' 拖动旋转投影 · 滚轮缩放 · + / − 扰动 ×2/÷2 · R 重置 · 3 切换 D=3 对照':
      ' Drag to rotate the projection · wheel to zoom · + / − to double/halve the perturbation · R to reset · 3 for the D=3 control',
    '恢复可读性提示': 'restore the readability cues',
    '看纯投影': 'see the pure projection',
    ' · 空格 暂停 · , / . 调速（': ' · Space to pause · , / . to change speed (',

    /* ---- 经典三体演示 ---- */
    '第 ': 'Orbit ',
    ' 圈：第 ': ': body ',
    ' 颗被弹出，双星 + 单星散架':
      ' was ejected — the system broke up into a binary plus a single star',
    '经典三体演示 · 三颗等质量、非分层随机初值（seed ':
      'Classic three-body demo · three equal masses, non-hierarchical random initial conditions (seed ',
    '）· 混沌，对初值敏感 · t = ': ') · chaotic, sensitive to initial conditions · t = ',
    ' 圈 · 能量守恒误差 |ΔE/E₀| = ': ' orbits · energy conservation error |ΔE/E₀| = ',
    ' · 仍在纠缠（最近距离 ': ' · still entangled (closest approach ',
    '拖动旋转 · 滚轮缩放 · R 同初值重放 · N 新随机初值 · 空格 暂停 · , / . 调速 · Esc/T 返回恒星系':
      'Drag to rotate · wheel to zoom · R to replay the same initial conditions · N for new random ones · Space to pause · , / . to change speed · Esc/T to return to the system',

    /* ---- 2D 回退 ---- */
    ' · Canvas 2D 回退 · ': ' · Canvas 2D fallback · ',
    ' · Canvas 2D 回退': ' · Canvas 2D fallback',
    ' · 没有固体表面 · Canvas 2D 回退': ' · no solid surface · Canvas 2D fallback',
    '尘埃环': 'dust ring',

    /* ---- 面板清单 ---- */
    '小行星/柯伊伯带天体按 Dohnanyi 1969 的尺寸分布取代表天体（太阳系用实测天体）；彗星轨道要素按 system.comets 的量级抽；流浪行星来自 system.rogues（Sumi 2011 / Mróz 2017）。恒星只能近观、不可降落。':
      'Asteroids and Kuiper belt objects are drawn as representative bodies from the Dohnanyi 1969 size distribution (the Solar System uses real measured bodies); cometary orbital elements are sampled at the scale given by system.comets; rogue planets come from system.rogues (Sumi 2011 / Mróz 2017). Stars can only be viewed close up, never landed on.',

    /* ---- 轨道投影演示：试探质点 r₀ 滑杆与悬崖说明（specs/highdim-v1.md 二节） ---- */
    '试探质点 r₀ ': 'Test particle r₀ ',
    '（拖动；松手重算）': ' (drag; releases re-integrates)',
    '核边界 r=1': 'core edge r=1',
    '探针 r₀=': 'Probe r₀=',
    '逃逸（第 ': 'escaped (lap ',
    ' 圈）': ')',
    '坠核（第 ': 'fell into core (lap ',
    '核外近乎自由（F/F₁≈': 'outside core, near-free (F/F₁≈',
    '核外·仍有引力（F/F₁≈': 'outside core, still pulled (F/F₁≈',
    '）· 已 ': ') · ',
    '核内尚未失稳 · 已 ': 'inside core, not yet unstable · ',
    '核外几乎无引力（F/F₁≈': 'outside core, almost no gravity (F/F₁≈',
    '）· 近乎自由漂移 · 已 ': ') · near-free drift · ',
    '尚未失稳 · 已 ': 'not yet unstable · ',
    ' / 核外仍被引力拉着 ': ' / still pulled outside core ',
    '拖左下角滑杆（或 Z/X）改试探质点的初始半径 r₀：': 'Drag the slider at bottom left (or Z/X) to change the test particle’s initial radius r₀: ',
    '把它从核内拨到核外，看 F/F₁ = r^{−(D−1)} 在 r=1 两侧的落差': 'sweep it from inside the core to outside and watch F/F₁ = r^{−(D−1)} fall off a cliff at r=1',
    '——核外几乎无引力、核内一头栽进去，中间没有稳定带': ' — almost no gravity outside, a headlong plunge inside, and no stable band in between',
    '——2<D<4 两侧都还有像样的引力，看到的是稳定但不闭合的进动轨道': ' — for 2<D<4 both sides keep real gravity, so you get stable but non-closing precessing orbits',
    ' · 现在 r₀=': ' · now r₀=',
    '，F/F₁=': ', F/F₁=',
    '漂浮的星球': 'The floating world'
  }, 'planets');
})(typeof window !== 'undefined' ? window : this);
