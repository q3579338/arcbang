# 行星引擎（`engine/planet.js`）

观测到一颗星球时（进入恒星系 / 星球 / 地表），按种子**确定性**生成它的输入参数，再对这些参数做一遍推导：
能真算的真算，只有标度关系的标 `scaling`，判据性的标 `heuristic`，每一条都写出公式与出处。

- UMD：Node 下 `require('./engine/planet.js')`；浏览器下 `window.MirrorPlanetEngine`（**不依赖任何其它文件**）。
- 纯 JS、无 DOM、无外部请求。单颗 `evaluate` 约 0.04 ms（阈值 2 ms）。
- 决定论：同 seed + 同 star + 同 given → 同参数、同派生量、同报告。
- 测试：`node engine/planet.test.js`（103 项）。

---

## 0. 三层结构

| 层 | 内容 | 标签 |
|---|---|---|
| 输入 | `params[key]`（18 项，见 §1） | `params.meta[key].status` = `accepted`（NASA 实测）/ `given`（恒星系生成器给定）/ `seeded`（种子抽样） |
| 派生 | `derived[key]`（22 项，见 §3） | `basis` = `computed`（真算）/ `scaling`（标度或定标经验式）/ `heuristic`（启发式） |
| 判定 | `findings[]`（见 §4） | `verdict` = `ok` / `warn` / `bad` / `fail` |

`derived[key] = {key, name, symbol, unit, value, text, basis, formula, inputs, ref}` —— 与 `engine.js` 同一套记法。

---

## 1. 输入参数（`PE.SCHEMA`，18 项）

| key | 名称 | 符号 | 单位 | 出处 |
|---|---|---|---|---|
| `massEarth` | 质量 | M | M⊕ | NASA Planetary Fact Sheet |
| `radiusEarth` | 半径 | R | R⊕ | NASA；系外用 Chen & Kipping 2017 |
| `rockFrac` / `iceFrac` / `gasFrac` | 岩铁 / 冰 / H-He 包层质量分数 | f | | Zeng et al. 2016；Lopez & Fortney 2014 |
| `coreMassFrac` | 金属核质量分数 | f_core | | 地球 0.325（PREM） |
| `orbitAU` / `ecc` / `incDeg` | 轨道半长轴 / 偏心率 / 倾角 | a, e, i | AU, —, ° | NASA |
| `rotationHours` / `obliquityDeg` | 自转周期 / 转轴倾角 | P_rot, ε | h, ° | NASA（负值为逆行） |
| `albedo` | 邦德反照率 | A_B | | NASA（Bond albedo 一列） |
| `surfacePressureBar` | 表面气压 | P₀ | bar | NASA（巨行星取 1 bar 参考面） |
| `atmosphere` | 大气成分（H₂/He/CH₄/H₂O/N₂/O₂/Ar/CO₂ 摩尔分数） | x_i | | NASA；Catling & Kasting 2017 |
| `waterOceans` | 含水量 | W | 地球海洋 | 地球 1.4×10²¹ kg；系外无观测约束 |
| `radiogenicRel` | 放射性元素丰度 | | rel | Unterborn et al. 2015 |
| `magneticIndex` | 磁场指数 | I_B | 0–1 | Christensen 2010（本引擎取启发式合成） |
| `ageGyr` | 年龄 | t | Gyr | 太阳系 4.567 Gyr（Connelly et al. 2012） |

太阳系八大行星的每一项都是 NASA Planetary Fact Sheet 的实测值（`status:'accepted'`），
包括质量、体积平均半径、轨道要素、自转、转轴倾角、**邦德反照率**、表面气压、大气成分、全球磁场有无。

---

## 2. API

```js
const PE = require('./engine/planet.js');          // 或 window.MirrorPlanetEngine

PE.SCHEMA                                          // 输入参数表（18 项，每项 key/name/symbol/unit/min/max/ref/desc）
PE.SOLAR                                           // 太阳系实测表（8 颗，键为 mercury…neptune）
PE.deriveFromSeed(seed, star, given, uc) → params  // 确定性抽样；given 里给了的量直接采用
PE.evaluate(params, star, uc) → {                  // 推导
  derived, derivedOrder, findings, worstVerdict,
  description,                                     // 面板默认展开的正文：10 句结构化中文（见 §2.1）
  descriptionSentences, descriptionSource,         // 逐句数组 + 末尾来源摘要行
  report,                                          // 3–6 句中文摘要，冷静，无小说措辞
  habitability,                                    // 0–1；D≠3 时为 null
  habitabilityDetail: {value, factors[], sentence},
  life: {rank, level, text},                       // 微生物 / 植物 / 动物 / 文明（heuristic）
  surfaceTempK, equilibriumTempK, tau, liquidWater, elapsedMs
}
PE.attach(planet, system, universeParams)          // 给 ui/planets.js 的 Planet 挂 params / report（并定生命等级）
PE.pickHabitable(planets, fallback)                // 恒星系里"最值得看"的行星下标
PE.paramRows(params) / PE.derivedRows(ev)          // UI 表格行：{name, symbol, value, unit, basis, basisLabel, ref, desc}
PE.hzEdge(coef, Teff, L) / PE.boilingT(Pa) / PE.pSatH2O(K) / PE.radiusFromMass(M) / PE.seasonAmplitude(ε) …
```

`PE.describeStar(star, uc, {planets}) → {text, sentences, source}`：恒星系层的恒星描述（5 句）——
光谱型 / 质量 / 有效温度 / 光度 / 半径、形成时刻与主序寿命剩余、单星与否加行星数、
Kopparapu 保守与宽松宜居带（并指出哪几颗落在保守带内）、雪线位置。

### 2.1 `description`：面板默认展开的正文（10 句，固定顺序）

1. **类型与体量** —— 类型、质量（M⊕ 与 kg）、半径（km 与 R⊕）、平均密度、表面重力、逃逸速度；太阳系注明取自 NASA。
2. **轨道** —— 半长轴、公转周期、偏心率与近远星点辐照比、辐照（W/m² 与地球倍数）。
3. **自转与季节** —— 自转周期（逆行标出）、太阳日、转轴倾角与 45° 纬度的夏冬辐照比、潮汐锁定与否。
4. **温度与大气** —— 平衡温度、表面气压（巨行星为 1 bar 参考面）、前三种成分、温室增温、表面温度。
5. **哪些气体保得住** —— 外逸层温度与 Jeans 判据下留得住 / 会逃逸的气体。
6. **水** —— 液态水窗口（沸点）、含水量；没有水时给出原因与可替代的溶剂。
7. **地质与磁场** —— 放射性地表热流、地质活动指数、磁场指数与有无全球磁场。
8. **卫星与环** —— 卫星数（太阳系给名字）、有无环系、希尔球稳定区与洛希极限。
9. **宜居性与生命等级** —— 分数 + **哪几条判定通过 / 未通过** + 生命等级（标明是启发式）。
10. **年龄与历史** —— 形成于多少亿年前、母恒星走过主序寿命的百分之几、还能燃烧多久。

正文里**不逐句标注 basis**；末尾统一给一行 `descriptionSource`，例如地球：
`数据：NASA 实测 18 项 · 真算 23 · 标度 6 · 启发式 4`；过程生成的行星则是
`数据：生成器给定 8 · 种子抽样 10 · 真算 23 · 标度 6 · 启发式 4`。

`star = {massRel, lumRel, tempK, radiusRel, ageGyr}`（缺项按主序关系补齐）。
`uc`（宇宙常数，可选）= `{alphaRel, alphaGRel, meOverMpRel, dimS, universeHabitability}`，
也可以直接把 `engine.js` 的 sim 对象丢给 `PE.universeConstantsOf(sim)`。默认全是我们的宇宙。

---

## 3. 派生量（`derived`，22 项）

| key | 量 | basis | 公式 / 依据 | ref |
|---|---|---|---|---|
| `gravity` | 表面重力 g | computed | g = GM/R²（球对称牛顿值；NASA 表列的是赤道口径且含自转离心项） | CODATA 2018 |
| `escapeVelocity` | 逃逸速度 | computed | v = √(2GM/R) | CODATA 2018 |
| `density` | 平均密度 | computed | ρ = M/(4πR³/3) | NASA（对照表） |
| `composition` | 成分推断 | scaling | 按密度与太阳系天体对照分档 | Zeng et al. 2016 |
| `period` | 公转周期 | computed | P = 2π√(a³/G(M★+M_p)) | Newton 1687 |
| `insolation` | 辐照 | computed | S = L★/(4πa²)；地球 1361 W/m² | Kopp & Lean 2011 |
| `hillRadius` | 希尔球半径 | computed | R_H = a(1−e)(M/3M★)^{1/3} | Hamilton & Burns 1992 |
| `rocheLimit` | 洛希极限 | computed | d = 2.44R(ρ_p/ρ_m)^{1/3}（流体） | Roche 1849 |
| `equilibriumTemp` | 平衡温度 | computed | T_eq = T★√(R★/2a)(1−A_B)^{1/4} | 对八大行星复现 NASA 黑体温度到 1% 以内 |
| `greenhouseTau` | 灰大气光学厚度 | **scaling** | τ_i = k_i·p̃_i^0.384·P̃^0.426（见 §5） | Schmidt et al. 2010；Haberle 2013；Pierrehumbert 2010 |
| `surfaceTemp` | 表面温度 | **scaling** | T_s = T_eq(1+¾τ)^{1/4}，水汽与 T_s 自洽迭代（正反馈 → 可失控） | Catling & Kasting 2017 §13；Kasting 1988 |
| `exobaseTemp` | 外逸层温度 | **heuristic** | T_exo ≈ f·T_eq，f = 8.0 / 3.9 / 1.2（H₂He / N₂O₂ / CO₂ 主导），用地球 1000 K、火星 200 K、金星 275 K、木星 900 K 定标 | Catling & Kasting 2017 §5.3 |
| `jeans` | Jeans 逃逸参数 λ | computed | λ = GMm/(kT_exo R)；λ≳30 保留、λ≲15 快速逃逸 | Jeans 1925；Catling & Kasting 2017 §5.9 |
| `tidalLock` | 潮汐锁定时标 | computed | t = ω_i a⁶ I Q/(3G M★² k₂ R⁵)，I=0.4MR²，ω_i=2π/13.5h；Q/k₂ 为假定值 | Gladman et al. 1996 |
| `solarDay` | 日长（太阳日） | computed | 1/T_syn = 1/T_rot − 1/T_orb；锁定后 = T_orb | NASA（Length of day 一列） |
| `season` | 季节幅度（45°） | computed | Berger 1978 的日均辐照式，δ=±ε；T ∝ Q̄^{1/4}（无热惯量的上限） | Berger 1978 |
| `waterWindow` | 液态水窗口 | computed | 三相点 273.16 K/611.657 Pa、临界点 647.096 K/22.064 MPa；沸点由 CC 反解 | IAPWS-95 |
| `solvents` | 其它液态溶剂 | computed | 与 1 atm 下水/氨/乙烷/甲烷/氮的熔沸点区间比较 | CRC Handbook |
| `habitableZone` | 宜居带 | computed | Kopparapu 四次多项式；对太阳复现 0.75 / 0.99 / 1.70 / 1.77 AU | Kopparapu et al. 2013 |
| `heatFlux` | 放射性地表热流 | computed | H(t)=ΣH_i·2^{(4.54−t)/T½}（²³⁸U/²³⁵U/²³²Th/⁴⁰K），热流 = H/4πR² | Turcotte & Schubert；Davies & Davies 2010 |
| `tectonics` | 地质活动指数 | **heuristic** | 热流相对值 × M^0.3 合成的 0–1 指数（板块构造能否启动至今没有定论） | Korenaga 2010；Valencia et al. 2007 |
| `maxPlanetMass` | 行星质量上限 | scaling | M_max ≈ (α/α_G)^{3/2}m_p = 385 M⊕ ≈ 1.2 M_木（我们的宇宙） | Weisskopf 1975 |

---

## 4. 判定（`findings[]`）

| id | 标题 | basis | 判定 |
|---|---|---|---|
| `PL_BODY` | 本体：重力、逃逸速度、密度 | computed | — |
| `PL_ORBIT` | 轨道：周期、辐照、希尔球 | computed | 轨道在恒星洛希极限内 → fail；e>0.4 → warn |
| `PL_TEMP` | 平衡温度与温室增温 | scaling | 失控温室 / T_s>1200 K → bad |
| `PL_JEANS` | 大气逃逸：哪些气体留得住 | computed | 全都留不住 → bad；N₂ 也留不住 → warn |
| `PL_SHORELINE` | cosmic shoreline | scaling | 在"无大气"一侧 → bad/warn |
| `PL_TIDAL` | 潮汐锁定 | computed | t_lock < 年龄 → warn |
| `PL_SEASON` | 季节：转轴倾角 | computed | ε>54° 或夏冬温度比 >1.8 → warn |
| `PL_WATER` | 液态水 | computed | 无水但有其它溶剂 → warn；都没有 → bad |
| `PL_HZ` | 宜居带位置 | computed | 保守带内 ok；只在宽松带内 warn；带外 bad |
| `PL_MAGNET` | 磁场与大气保留 | heuristic | 无磁场且有大气 → warn（并声明这一作用有争议） |
| `PL_CONSTANTS` | 宇宙常数对这颗行星的影响 | scaling | α 或 α_G ≠ 我们的值时才出现 |
| `PL_MASSMAX` | 质量上限 | scaling | M > Weisskopf 上限 → warn |
| `PL_LIFE` | 生命等级 | heuristic | 宜居性 ≥0.35 且年龄 ≥0.5 Gyr 才可能有 |

---

## 5. 温室模型的诚实说明（这是全篇最"软"的一处）

`T_s = T_eq(1+¾τ)^{1/4}` 是灰大气 Eddington 近似（真算）。**τ 的取法是标度关系，不是逐线辐射传输**：

```
τ_i = k_i · p̃_i^0.384327 · P̃^0.425622        （p̃、P̃ = 折算到地球重力的分压与总压，bar）
k_CO2 = 3.4300   k_H2O = 6.5222   k_CH4 = 6.8218
```

- 形式来自强线的曲线生长律 τ ∝ √(u·γ)：柱量 u ∝ p/g，洛伦兹展宽 γ ∝ P_tot；
  因此分压与总压各出现一个约 0.4 次幂。
- 三个系数与两个指数用**三个实测点**定标：金星 737 K、地球 288 K、火星温室 +5 K（Haberle 2013 的估计）。
  地球 τ=0.87 的分配按 Schmidt et al. 2010 的归因：H₂O+云 75%、CO₂ 20%、CH₄/O₃/N₂O 5%。
- 水汽分压由 Clausius–Clapeyron 与含水量自洽迭代，可凝结水汽的等效柱量因子 0.2146（地球定标，heuristic）。
  这条正反馈在地球附近的增益约 0.5（对应"水汽反馈把气候敏感度放大约一倍"），温度更高时越过 1 → 失控温室。
- **不含**：云的反照率反馈、H₂–H₂ 碰撞诱导吸收、尘埃、巨行星的内部热流。
  所以巨行星的 1 bar 温度（木星 163 K）比本模型（116 K）高得多——这一点在 `PL_TEMP` 的文字里直接写出来。

复现结果：

| | T_eq（本引擎） | NASA 黑体温度 | T_s（本引擎） | 实测均温 |
|---|---|---|---|---|
| 水星 | 437.2 | 439.6 | 437.2 | 440 |
| 金星 | 226.6 | 226.6 | 736.6 | 737 |
| 地球 | 254.0 | 254.3 | 288.3 | 288 |
| 火星 | 209.8 | 209.8 | 214.9 | 208（口径不同，见下） |
| 木星 | 109.9 | 109.9 | 116.2 | 163（内部热流 + CIA，未含） |
| 土星 | 81.2 | 81.1 | 91.0 | 133（同上） |
| 天王星 | 58.1 | 58.1 | 71.5 | 78 |
| 海王星 | 46.6 | 46.6 | 54.8 | 73（内部热流，未含） |

火星：文献给出的温室增温约 5 K（Haberle 2013），而 NASA 表列的均温 208 K 略低于黑体温度 209.8 K
（Viking 的地表气温年均值与有效辐射温度不是一个口径）。本引擎按前者定标，给出 215 K，并在报告里注明差异。

---

## 6. 宜居性与生命等级

`habitability` 是 12 项 0–1 因子的连乘（**heuristic**）：液态水、大气保留、温度窗口、失控温室、宜居带位置、
恒星风剥蚀、岩质表面、地质活动、潮汐锁定、时间、恒星寿命、宇宙尺度的前提。
`habitabilityDetail.factors[]` 逐项给出取值与理由，`sentence` 指出压得最低的那一项。
**D≠3 时为 `null`**（与 `engine.js` 一致：3 维公式外推不给数）。

生命等级由「宜居性 + 年龄 + 种子」决定，不再由 `ui/planets.js` 硬编码：
先按宜居性做一次确定性抽签，再按地球的时间表（微生物 0.5 Gyr、动物 4.0 Gyr、文明 4.55 Gyr，按宜居性缩放）
落到 微生物 / 植物 / 动物 / 文明。**地球是唯一的样本，n=1，所以这一步是启发式而不是统计**——输出里写明了这一点。
太阳系的行星不走这条路：地球 = 文明（实测），其余 = 至今没有发现生命（实测）。

随机 1000 颗（M–A 型主序星、七类行星、0.05–20 AU）：无 NaN，宜居（≥0.5）占 0.5%。

---

## 7. 与 `ui/planets.js` / `ui/mirror.js` 的对接

- `ui/planets.js` 在 `generateSystem` / `solarSystem` 末尾调用 `attachParams(sys, universeParams)`（一行），
  它对每颗行星调 `PE.attach()`，把 `params` / `report` 挂上去，并按引擎的宜居性重排 `habitableIndex`。
  引擎缺席（未载入 `engine/planet.js`）时整段跳过，其余逻辑完全不变。
- `PE.attach` 只在**过程生成**的行星上改写 `life`（并同步 `timeline.greenGyr/civGyr` 以免画面与文案打架）；
  太阳系的实测行星一律不动。`system.dim ≠ 3` 时宜居性为 null，生命一律为空。
- `ui/mirror.js` 的信息面板在行星层：顶部两个徽标（悬停有说明）——
  「画面：过程生成的可视化（示意）」与「数据：行星引擎计算（点开看每项依据）」，
  取代了原先散在每段末尾的孤立「示意」二字；接着是默认展开的 10 句正文 + 来源摘要行；
  再往下是三个折叠区：**行星参数（输入）/ 派生量 / 报告**，
  表格列 = 参数名（符号）/ 值 / 单位 / basis 标签，紧随一行是依据（公式 + 出处）。
- 恒星系层在行星列表下方追加 `PE.describeStar()` 的 5 句恒星描述与来源摘要行。

---

## 8. 什么没有被模拟（诚实清单）

- 温室是灰大气 + 三点定标的 τ，不是逐线辐射传输；没有云反照率反馈、没有 CIA、没有尘埃、没有巨行星内部热流。
- 外逸层温度是按平衡温度标度的启发式，真实的 T_exo 由 XUV 加热与 IR 致冷的平衡决定（火星就因 CO₂ 致冷而只有 ~200 K）。
- 逃逸只算 Jeans（热逃逸）与经验的 cosmic shoreline；没有流体力学逃逸、离子拾取、溅射的逐项计算。
- 潮汐锁定用 Gladman 1996 的解析式，Q 与 k₂ 是假定值（岩质 100/0.3，巨行星 3×10⁴/0.5），两者的不确定度就有一个量级；
  也没有算自旋轨道共振（水星 3:2）与偏心率潮汐加热。
- 地质活动指数、磁场指数是启发式合成；板块构造能否在超级地球上启动至今没有定论。
- 质量-半径用 Chen & Kipping 2017 的中位关系（对木星会高估约 20%，其固有弥散本就很大）；太阳系一律用实测值。
- 宜居带是 Kopparapu 2013 的 1 M⊕、无云一维模型，只对 2600–7200 K 的恒星有效。
- 生命等级的唯一定标样本是地球。
- 宇宙常数只按 Weisskopf 标度影响行星质量上限，并提示化学的温度刻度 ∝ α²mₑ；没有重算相图。
