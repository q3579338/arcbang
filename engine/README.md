# 镜像宇宙引擎（engine/）

界面与文案致敬刘慈欣《镜子》："给它一组初始条件，它就从奇点开始把整个宇宙算一遍。"
物理上**只做真实计算**，并遵守一条原则：**一个参数都不编造。**

- **默认输入 = 物理学界普遍接受的基本参数**（标准模型 + ΛCDM + 观测量，PDG 2022 / Planck 2018），每项 `status:'accepted'` + `ref`。它们在现有物理里就是"测量而非推导"的量，因此本身就是最底层输入。空间维数 D=3 标 `status:'accepted-fact, no-mechanism'`（Tegmark 1997 的分析方式）。
- **公认的派生**（Λ_QCD、m_p、α_G、m_n−m_p、Ω_r、η、Q……）标 `basis:'computed'`。
- **推测性模块**（`status:'speculative' | 'mainstream-model'`，UI 有开关）：开启后其参数替换掉被派生的输入。**弦气维数模块默认开启**（用户决定：D 由 T₀/T_H、n_w、κ 涌现，允许非整数，随机宇宙 P(D=3)≈1/30；默认参数下 D=3.000，#1207 不变；可关闭改为直接输入 D）；其余模块默认关闭。除 dimS 外，默认配置下不出现任何 speculative 项。
- 每一步演化计算给出 `{id, title, basis, formula, inputs, value, threshold, verdict, ref}`，`basis ∈ computed | scaling | heuristic`。

纯 JS，无 DOM 依赖。Node `require('./engine/engine.js')`；浏览器按顺序引入 `params.js`、`engine.js` 后用 `window.MirrorEngine`（参数表 `window.MirrorParams`）。

```
node engine/test.js      # 273 项测试
```

---

## 0. 三层结构

```
第 0 层  输入（可编辑）           BASE 20 个公认参数  ＋  已开启模块的参数（替换被派生的项）
   ↓ Engine.deriveConstants(params, modules)
第 1 层  派生常数 derived[key]      computed：Λ_QCD ← αₛ(M_Z) 跑动；m_p；α_G=(m_p/M_Pl)²；m_n−m_p ← m_d−m_u、α；
                                       Ω_r ← T_CMB、h、N_eff；Ω_b、Ω_c ← Ωh²/h²；η ← Ω_bh²；G_F、λ_H；Q=(2/5)√A_s
                                   scaling：核力强度 ← m_π²∝(m_u+m_d)Λ_QCD
                                   模块开启时另加：D（speculative）、A_s/n_s/Ω_k（mainstream-model）、α/αₛ/汤川/Λ（speculative）
   ↓
第 2 层  真实演化 findings[]        Friedmann → Saha 复合 → BBN → 线性增长/Press–Schechter → 恒星（Adams）→ 原子/化学 → 行星/宜居 → 生物化学（Hoyle/液态水/复杂化学）→ 结局
```

---

## 1. 快速上手

```js
const Engine = require('./engine/engine.js');

const r = Engine.simulate({});                       // 我们的宇宙 → #1207（弦气模块默认开：D=3.000）
r.outcome.id                                        // 'OBSERVERS_POSSIBLE'
r.constants                                         // 第 1 层：演化层实际使用的常数（alpha, alphaS, meOverMp, mnMinusMp, omegaB, Q, dimS, alphaG …）
r.derived.lambdaQCD                                 // {value:87.3, basis:'computed', status:'accepted', formula:'Λ = M_Z·e^{−2π/(b₀αₛ)}…', inputs:['alphaSMZ'], ref, text}
r.derivedOrder                                      // 供 UI 分组显示"常数由此而来"
r.findings                                          // 第 2 层每一步计算 [{id, title, basis, formula, inputs, value, valueText, threshold, verdict, severity, text, ref}]
r.calc                                              // 数值汇总：expansion / recombination / bbn / structure / stars / atoms / planets / dims / baryons
r.timeline / r.fate / r.report / r.distance
r.derived.cSI.text                                  // "在约定 A（固定 e、ħ、m_p 为我们的数值）下，这个宇宙的光速为 299792458 m/s（我们的 1 倍）。"
r.dimensionful.si                                   // {c, hbar, e, G, mp}（约定 A）
Engine.dimensionfulConstants(r, 'B').si.hbar        // 换成"固定 c、e、m_p"的表述
Engine.UNIT_CONVENTIONS                             // {A:{fixed:['e','hbar','m_p'],varies:['c','G']}, B:…, C:…}

Engine.simulate({ omegaLambda: 300 }).outcome.name                                   // '热寂——无结构的宇宙'（Weinberg 上界）
Engine.simulate({ mDown: 2.16 }).outcome.name                                        // '没有原子的宇宙'（质子衰变）
Engine.simulate({ stringGasT: 1.0476, compactStiffness: 0.9 }).constants.dimS          // 4（弦气模块，默认开）
Engine.simulate({ dimS: 4 }, { modules: { stringGas: false } }).constants.dimS          // 4（关闭模块，直接输入）
Engine.dimensionStatistics(20000)                   // 蒙特卡洛：{pExact3, pInteger, pFractional, pBelow3, p3to4, pAtLeast4, histogram}
Engine.simulate({}, { modules: { slowRoll: true } }).derived.As.status               // 'mainstream-model'

Engine.PARAMS_FOR()                                 // 当前有效参数表（默认弦气开）：去掉 dimS，加入 T₀/T_H、n_w、κ
Engine.MODULES                                      // [{id, name, status, params:[schema], derives:[keys], ref, desc}]

const nb = Engine.createNBody({ As: 4e-9 }, { N: 6000, mesh: 56 });   // 结构形成粒子模拟（PM 引力）
while (!nb.ended) nb.step(nb.suggestDt());

Engine.Catalog.save(r);  Engine.Catalog.list();  Engine.Catalog.exportJSON(true);      // 条目记录 modules 状态
```

---

## 2. 基础参数（`Engine.PARAMS`，20 个，全部 accepted）

| # | key | 名称 | 默认（出处） | 范围 | 进入哪些计算 |
|---|---|---|---|---|---|
| 1 | `alpha` | 精细结构常数 α | 1/137.035999084（CODATA 2018） | 0.001–0.5 | Bohr/Rydberg、Saha、m_n−m_p 电磁项、Z_max（核/原子）、恒星点火与寿命 |
| 2 | `alphaSMZ` | αₛ(M_Z) | 0.1179（PDG） | 0.06–0.25 | Λ_QCD（量纲传输）→ m_p → α_G；π 介子质量 → 核力强度 |
| 3 | `higgsVev` | v [GeV] | 246.22（PDG；G_F=1.1663788×10⁻⁵ GeV⁻²） | 2.46–24622 | G_F=1/(√2v²)：T_f、τ_n（878.4 s，PDG 2022）、超新星 |
| 4 | `higgsMass` | m_H [GeV] | 125.25（PDG） | 10–1000 | λ_H=m_H²/2v²（电弱相变级别提示） |
| 5 | `electronMass` | mₑ [MeV] | 0.51099895（PDG） | 0.005–50 | Saha、mₑ/mₚ、电子俘获阈值、恒星、分子刚性 |
| 6 | `mUp` | m_u [MeV] | 2.16（PDG） | 0–20 | m_n−m_p、m_π |
| 7 | `mDown` | m_d [MeV] | 4.67（PDG） | 0–20 | m_n−m_p、m_π |
| 8 | `thetaQCD` | θ_QCD | 0（<10⁻¹⁰） | 0–π | 提示 |
| 9 | `sumNu` | Σm_ν [eV] | 0.06 | 0–5 | f_ν 抹平小尺度功率 |
| 10 | `ckmPhase` | δ_CKM | 1.196（PDG） | 0–π | 重子生成（Sakharov） |
| 11 | `generations` | N_gen | 3（LEP） | 1–6 | CP 相位存在性；N_eff（标准 3.044，Froustey 2020 / Bennett 2021）→Ω_r、Y_p |
| 12 | `H0` | H₀ [km/s/Mpc] | 67.4（Planck） | 20–200 | ρ_crit、时间标度、Ω=Ωh²/h² |
| 13 | `omegaBh2` | Ω_bh² | 0.02237（Planck） | 0–0.5 | η₁₀、Y_p、Saha、气体 |
| 14 | `omegaCh2` | Ω_ch² | 0.1200（Planck） | 0–5 | Ω_m、z_eq、增长 |
| 15 | `omegaLambda` | Ω_Λ | 0.685（Planck） | −2–10⁴ | Friedmann、Weinberg 上界；<0 反德西特坍缩 |
| 16 | `As` | A_s | 2.1×10⁻⁹（Planck） | 10⁻¹³–10⁻⁴ | Q=(2/5)√A_s → σ(M,z)、坍缩、原初黑洞 |
| 17 | `ns` | n_s | 0.965（Planck） | 0.8–1.2 | σ 的尺度依赖 |
| 18 | `omegaK` | Ω_k | 0（Planck 2018+BAO：0.0007±0.0019） | −1–1 | Friedmann 曲率项 |
| 19 | `tcmb` | T_CMB [K] | 2.7255（FIRAS） | 0.5–30 | Ω_γ、η∝Ω_bh²/T³、复合温度标度 |
| 20 | `dimS` | 空间维数 D | 3（accepted-fact, no-mechanism） | 1–11 | Ehrenfest/Tegmark 判据：D≥4 或 D≤2 → UNSTABLE_ORBITS；其余 D≠3 → BEYOND_MODEL_DIM（3 维公式外推，不给可居住性，`canEnterMirror=false`） |

参数空间距离 `Engine.distance(p, q, modules)`：在当前有效参数表上，各参数刻度坐标偏差 u_i，100·min(1,√(Σu²/3))。

---

## 3. 模块（`Engine.MODULES`；stringGas 默认开，其余默认关）

| id | 名称 | status | 参数（替换的输入） | 派生公式 | ref |
|---|---|---|---|---|---|
| `stringGas`（默认开） | 弦气维数模块 | speculative | `stringGasT` T₀/T_H（0.98）、`windingDensity` n_w（1）、`compactStiffness` κ（0.5） → 替换 `dimS` | 见 §4：ε_i=g_i·e^{6(T₀/T_H−0.98)}/n_w，g=[3,2,1.3,0.78,0.55,0.38,0.26,0.18,0.12]；w=0.4(1−κ)；s_i=smoothstep((ε_i−1+w)/2w)（\|ε_i−1\|>w 饱和 0/1，带内分数）；D=Σs_i。默认 D=3.000；(1.0476,κ0.9)→4；0.9362→2.5；(1.174,κ0.9)→6；n_w=8→≤2 | Brandenberger & Vafa 1989；Tseytlin & Vafa 1992 |
| `slowRoll` | 慢滚暴胀势能模块 | mainstream-model | `inflatonScale` V₀^{1/4}/M_Pl（7.06×10⁻³）、`slowRollEpsilon` ε（0.005）、`slowRollEta` η（−0.0025）、`efolds` N（60）、`initialCurvature` k₀（0） → 替换 `As`、`ns`、`omegaK` | A_s=V₀/(24π²εM_Pl⁴)，n_s=1−6ε+2η，r=16ε，Ω_k=k₀e^{−2(N−60)}（真计算） | Liddle & Lyth 2000 |
| `altBiochem` | 替代生化（硅基 / 非水溶剂） | speculative | 无参数 | 只增加 finding R_ALT_BIOCHEM（heuristic 倾向 低/中/高），不改变主结局 | Bains 2004；Schulze-Makuch & Irwin 2008；NRC 2007 |
| `landscape` | 弦论景观模块 | speculative | `stringCoupling` g_s（1）、`compactVolume` V（137.036）、`shape1..3` φ（0.5）、`flux1..3` n（2,1,1）、`bareLambda` log₁₀\|Λ₀\|（−120.348） → 替换 `alpha`、`alphaSMZ`、`electronMass`、`mUp`、`mDown`、`omegaLambda` | α=g_s/V；αₛ(M_Z)=0.1179·α/α₀；mₑ=0.511e^{7.8(φ₁−0.5)}，m_u=2.16e^{6(φ₂−0.5)}，m_d=4.67e^{6(φ₃−0.5)}；Λ=Λ₀+½Σnᵢ²qᵢ²，qᵢ²=10⁻¹²¹(1,2,3)g_s²·137/V（玩具刻度，机制真实） | Polchinski 1998；Bousso & Polchinski 2000；Candelas et al. 1985 |

`Engine.PARAMS_FOR(modules)` 返回当前有效参数表；`simulate(params, {modules})`；Catalog 条目记录 `modules`；`randomParams(seed, modules)`；`normalizeModules(m)`：缺省键取模块默认（stringGas 开），显式 `false` 可关闭。全关配置下不出现任何 speculative 项。

### 4′. 空间维数如何涌现（弦气模块，speculative）
- **机制（推测）**：Brandenberger & Vafa 1989 的弦气宇宙学——9 个空间维初始蜷缩在弦尺度，缠绕弦与反缠绕弦相遇湮灭的维才能解开膨胀；一维弦世界面在 ≤3+1 维中一般性相交 ⇒ 典型解开 3 维。真实物理没有公认机制；引文只支持这一定性论证，下面的定量式是本引擎的玩具延伸。
- **参数**：T₀/T_H（初温，湮灭效率整体因子 e^{6(T₀/T_H−0.98)}）、n_w（缠绕密度，效率 ∝1/n_w）、κ（紧致化刚度，阈值带宽 w=0.4(1−κ)：κ→1 硬阈值只出整数维，κ→0 宽带多分数维）。
- **公式**：ε_i=g_i·A，A=e^{6(T₀/T_H−0.98)}/n_w，g=[3,2,1.3,0.78,0.55,0.38,0.26,0.18,0.12]（维序惩罚，数值经校准）；解开度 s_i=smoothstep((ε_i−1+w)/2w)，\|ε_i−1\|>w 时**精确饱和**为 0 或 1（因此整数 D 有非零概率），带内为分数；D=Σs_i。默认 ε=[3,2,1.3,0.78,…]、w=0.2 ⇒ 前三维饱和解开、其余饱和蜷缩，D=3.000。
- **分数维含义**：非整数 D 没有严格的物理定义，这里把力律 r^{−(D−1)} 与 Ehrenfest/Tegmark 判据按 D 连续插值——是一种数学练习（标推测）；`R_DIM_FRACTAL` 在 D 非整数时出现（不再需要单独模块；关闭 stringGas 后直接输入非整数 D 同样触发）。结局判定不变：D≥4/D≤2 → UNSTABLE_ORBITS，其余 D≠3 → BEYOND_MODEL_DIM。
- **输出**：`derived.dimS = {value, epsilons[9], s[9], w, nOpen, nPartial, fractional, basis:'toy', status:'speculative', formula, ref}`。
- **随机宇宙的校准**（`randomParams` 对弦气参数的抽样：T₀/T_H~N(0.98,0.20) 夹到 [0.5,1.5]，ln n_w~N(0,0.70)，κ=u^{1.5}；`Engine.dimensionStatistics(20000, 20240816)`）：

| 量 | 值 |
|---|---|
| P(D 恰好 = 3) | **0.0375**（目标 1/30=0.033，守住区间 [1/40, 1/20]） |
| P(D 为整数) / P(非整数) | 0.339 / 0.661 |
| P(D<3) / P(3<D<4) / P(D≥4) | 0.470 / 0.139 / 0.391 |
| 直方图 floor(D)：0..9 | 4844, 2005, 2544, 2789, 1909, 1669, 1403, 1069, 882, 886（/20000） |

测试守住 P(D=3) ∈ [1/40, 1/20]，并要求整数/非整数、D<3 / 3–4 / ≥4 都非零。

### 4″. 搜索的抽样先验与命中率（`randomParams(seed, modules, {spread})`、`Engine.searchStatistics(N, seed, {modules, spread})`）
`spread` 三档（弦气模块参数不受影响，始终用 §4′ 的校准分布）：

| 档 | 定义（以我们的宇宙为中心） |
|---|---|
| `full` | 各有效参数在允许范围内均匀（现状） |
| `wide` | 对数参数 ±1 dex 对数均匀；线性参数 ±30%×(max−min)；Ω_k ±0.1、θ_QCD∈[0,0.3]、δ_CKM ±0.5、Ω_Λ 与 Σm_ν 按 ±1 dex、N_gen∈{2,3,4} |
| `narrow` | 全部参数 ±10%（相对；对数参数 ×10^{±0.041}）；Ω_k ±0.01、θ_QCD∈[0,0.05]、δ_CKM ±0.1、N_gen=3 |

`spread≠full` 时 `randomParams` 结果带 `_prior` 文案、`searchStatistics` 返回 `prior`："抽样先验 …——这是探索用的先验，不代表宇宙参数的真实分布"。

实测（蒙特卡洛 20000 次，seed 20240816，v2.3.0）：

| 配置 | full | wide | narrow |
|---|---|---|---|
| 默认（弦气开）P(OBSERVERS ∧ D=3) | 0 | 0 | 0.025%（5/20000） |
| 默认（弦气开）P(D=3) | 3.3% | 3.7% | 3.7% |
| D=3 直接输入（stringGas 关）P(OBSERVERS) | 0 | 0 | **0.97%** |
| D=3 直接输入 narrow 的其它结局 | — | — | NO_STARS 39.9%，NO_CHEMISTRY 35.0%，NO_CARBON_CHEMISTRY 24.1% |
| D=3 直接输入 wide 的结局 | — | NO_ATOMS 71.8%，HEAT_DEATH 15.1%，NO_CHEMISTRY 6.5%，NO_STARS 6.4% | — |

说明：曾按"±0.5 dex / ±10% 范围"定义 narrow，实测 20000 次命中为 0——Hoyle 共振（R_HOYLE）要求 αₛ(M_Z) 在 ~0.1%、α 在 ~3% 内，Λ_QCD 的指数放大使 αₛ(M_Z) 的 0.5 dex 几乎必然把核力推出窗口；因此 narrow 改为相对 ±10%（在 D=3 条件下命中 ≈1%）。乘上 P(D=3)≈1/30 后默认配置的联合命中 ≈0.03%（20000 次约 5 个）。测试守住：narrow（D=3 直接输入）≥0.5%；full ≤ wide ≤ narrow。以上是实测值，不是凑数。

---

## 4. 第 1 层派生量（`result.derived[key]`，`derivedOrder`）

| key | 名称 | basis | status | 公式 | ref |
|---|---|---|---|---|---|
| `dimS` | 空间维数 | computed（直接输入）/ toy（弦气） | accepted-fact / speculative | — / D=Σs(ε_i) | Tegmark 1997 / Brandenberger & Vafa 1989 |
| `omegaR` | Ω_r | computed | accepted | Ω_γh²=2.47×10⁻⁵(T/2.7255)⁴；Ω_r=Ω_γ(1+0.2271N_eff)，N_eff=3.046+(N_gen−3) | Fixsen 2009；Planck 2018 |
| `omegaB` / `omegaC` | Ω_b / Ω_c | computed | accepted | Ωh²/h² | Planck 2018 |
| `eta10` | η₁₀ | computed | accepted | η=n_b/n_γ=273.9·Ω_bh²·(2.7255 K/T_CMB)³ | Steigman 2007 |
| `lambdaQCD` | Λ_QCD | computed | accepted (scheme-dependent) | M_Z·e^{−2π/(b₀αₛ(M_Z))}，b₀=23/3——固定 n_f=5 一环、无阈值匹配（≈87 MeV），非 PDG Λ_MS-bar；只用比值 | Gross & Wilczek 1973；Politzer 1973 |
| `protonMass` | m_p | scaling | accepted | 938.272 MeV·Λ_QCD/Λ_QCD₀（手征极限 m_p∝Λ_QCD 的标度，忽略夸克质量修正） | Durr et al. 2008（BMW 格点） |
| `alphaG` | α_G/α_G₀ | scaling | accepted | (m_p/M_Pl)²∝(m_p/938)² | Carr & Rees 1979 |
| `meOverMp` | mₑ/mₚ（相对） | scaling | accepted | (mₑ/0.51099895)/(m_p/938.272) | PDG |
| `mnMinusMp` | m_n−m_p | scaling | accepted | Δ = 1.293 + 2.52[(m_d−m_u)/2.51−1] − 1.00[α/α₀−1] MeV（BMW 2015 格点分解 QCD 2.52 / QED −1.00，线性化于观测值） | Borsanyi et al. (BMW) 2015；Gasser & Leutwyler 1982 |
| `alphaS` | 核力强度（相对） | scaling | accepted | m_π²∝(m_u+m_d)Λ_QCD（GMOR）；强度≈1−½ln(m_π²/m_π₀²)（π 越重射程越短；+~10% 氘核解体，−~10% 双质子束缚） | GMOR 1968；Beane & Savage 2003；Epelbaum 2013；Pochet 1991 |
| `GF` / `lambdaH` | G_F / λ_H | computed | accepted | 1/(√2v²) / m_H²/(2v²) | PDG |
| `Q` | 视界尺度密度扰动 | computed | accepted | (2/5)√A_s | Liddle & Lyth 2000 |
| `cSI` / `GSI` / `hbarSI` / `eSI` | 有量纲常数（SI） | computed | accepted (convention-dependent) | 见 §4A（默认约定 A：c=e²/(4πε₀ħα)，G=α_G ħc/m_p²） | Albrecht & Magueijo 1999；Duff 2002 |
| （模块）`As`,`ns`,`omegaK` | 慢滚 | computed | mainstream-model | 见 §3 | Liddle & Lyth 2000 |
| （模块）`alpha`,`alphaSMZ`,`electronMass`,`mUp`,`mDown`,`omegaLambda` | 景观 | toy | speculative | 见 §3（引文只支持定性机制，定量式为本引擎玩具延伸） | Polchinski 1998；Bousso & Polchinski 2000；Candelas 1985（背景） |

---

## 4A. 有量纲常数与单位约定（c、G、ħ、e）

**有量纲常数的数值取决于单位约定**：跨宇宙不变的物理内容是无量纲量 α = e²/(4πε₀ħc)、α_G = G m_p²/(ħc)……；把 α 的变化"归给"c、ħ 还是 e，是一个**约定**（Duff 2002, hep-th/0208093）。演化层只用无量纲量；报告里的 SI 数值按下表换算，**默认约定 A**（Albrecht & Magueijo 1999 的变光速表述），可切 B/C。

| id | 固定 | 变化 | 定义式 | ref |
|---|---|---|---|---|
| **A（默认）** | e、ħ、m_p | c、G | c = e²/(4πε₀ħα)；G = α_G·ħc/m_p² | Albrecht & Magueijo 1999, PRD 59, 043516；Duff 2002 |
| B | c、e、m_p | ħ、G | ħ = e²/(4πε₀cα)；G = α_G·ħc/m_p² | Duff 2002；Uzan 2003, RMP 75, 403 |
| C | c、ħ、m_p | e、G | e = √(4πε₀ħcα)；G = α_G·ħc/m_p² | Duff 2002；Bekenstein 1982 |

比值形式（m_p 在三种约定下都固定为我们的数值，α_G 的变化因此全落到 G 上）：A: c/c₀=α₀/α；B: ħ/ħ₀=α₀/α；C: e/e₀=√(α/α₀)；三者 G/G₀=(α_G/α_G₀)·(ħ/ħ₀)(c/c₀)。

- `result.derived.cSI / GSI / hbarSI / eSI` = `{value, unit, basis:'computed', status:'accepted (convention-dependent)', convention:'A', fixedInConvention, ratio, formula, inputs, ref, text}`；`text` 例："在约定 A（固定 e、ħ、m_p 为我们的数值）下，这个宇宙的光速为 4.3754×10⁸ m/s（我们的 1.46 倍）。"
- `result.dimensionful` = `{convention, name, definition, ref, fixed, varies, ratios, si:{c,hbar,e,G,mp}, entries, sentence}`；`Engine.dimensionfulConstants(result, 'B'|'C')` 换约定，`Engine.dimensionfulSI(alphaRel, alphaGRel, conv)` 直接算，`Engine.UNIT_CONVENTIONS`、`Engine.SI_CONSTANTS` 可查。
- `constantsReport.sentence` 末尾附一句："光速 X m/s，引力常数 Y m³·kg⁻¹·s⁻²，普朗克常数 Z J·s（单位约定 A）"。
- **我们的宇宙精确复现**：c=299792458 m/s、G=6.6743×10⁻¹¹ m³·kg⁻¹·s⁻²、ħ=1.054571817×10⁻³⁴ J·s、e=1.602176634×10⁻¹⁹ C（三种约定下比值皆为 1，数值相同）。示例（α=1/200）：A → c=4.3754×10⁸ m/s、ħ 与 e 不变；B → ħ=1.5391×10⁻³⁴ J·s、c 不变；C → e=1.3262×10⁻¹⁹ C、G 不随 α 变。

---

## 5. 第 2 层：每一步计算（`findings[]`）

| id | 标题 | basis | 公式 / 依据 | 判定 |
|---|---|---|---|---|
| `R_DIM_INPUT` / `R_DIM_EMERGE` | 空间维数（直接输入 / 弦气涌现） | computed / heuristic | — / 弦气玩具模型（含 ε 数组） | D≠3 → warn |
| `R_DIM` | 维数与轨道/原子稳定性 | computed（3<D<4、2<D<3 时 scaling） | 力∝r^{−(D−1)}，势∝r^{−(D−2)}（Ehrenfest 1917；Tegmark 1997）：**D≥4** 圆轨道对径向微扰不稳定、氢原子哈密顿量无下界 → fail；**3<D<4** 轨道稳定但不闭合（进动）、原子能级与化学显著改变 → warn，继续演化链；**2<D<3** 有牛顿吸引但引力弱、拓扑受限 → warn，继续；**D≤2** 势为对数/排斥、无牛顿吸引 → fail | 见左 |
| `R_DIM_UNCORRECTED` | D≠3 的演化未做维数修正 | scaling | 3<D<4、2<D<3 时后续步骤仍按 3+1 维公式；可居住性乘 (1−0.5(D−3)) 或 (D−2) | warn |
| `R_DIM_FRACTAL` | 分数维 | heuristic | 非整数 D 按连续插值 | warn |
| `R_CP` | CP 破坏与重子生成 | heuristic | Sakharov 1967；CKM 相位需 N_gen≥3 | δ<0.05 或 N_gen<3 → fail |
| `R_FRIEDMANN` | 膨胀史 | computed | H²/H0²=Ω_ra⁻⁴+Ω_ma⁻³+Ω_ka⁻²+Ω_Λ，RK4；年龄、H(a=1)、转向/挤压 | 挤压 → bad |
| `R_ZEQ` | 物质-辐射相等 | computed | 1+z_eq=Ω_m/Ω_r | — |
| `R_CLOSURE` | 几何自洽提示 | computed | ΣΩ=1 ⇔ H(a=1)=H₀ | ≠1 → warn |
| `R_RECOMB` | 复合红移 | computed | Saha：x²/(1−x)=(mₑT/2π)^{3/2}e^{−B/T}/n_b，B=13.6 eV(α/α₀)²(mₑ/mₑ₀)，η₁₀=273.9Ω_bh²；x_e=½ → z≈1380，x_e=0.01 → z≈1140（Peebles 非平衡解 1090） | — |
| `R_MNP` | m_n−m_p | scaling | Δ = 1.293 + 2.52[(m_d−m_u)/2.51−1] − 1.00[α/α₀−1] MeV（BMW 2015） | Δ<−mₑ 质子衰变 / Δ<mₑ 电子俘获 → fail |
| `R_DEUTERON` | 氘核束缚 | scaling | B_d≈2.22[1+10(αₛ,nuc−1)] MeV——阈值量级引自 Pochet 1991 / Hogan 2000，线性插值为本引擎近似；且 Δ<B_d+mₑ（Hogan 2000） | 不束缚 → fail |
| `R_DIPROTON` | 双质子束缚 | scaling | B_pp≈2.22[10(αₛ,nuc−1)−1] MeV——阈值量级引自 Barrow & Tipler / Bradford 2009（有争议），线性插值为本引擎近似 | 束缚 → fail |
| `R_BBN_YP` | 原初氦丰度 | computed | Y_p≈0.2485+0.0016(η₁₀−6)+0.013ΔN_eff（Steigman 2007，N_eff₀=3.044）× n/p 修正 e^{−Δ/T_f}e^{−t_BBN/τ_n}；T_f∝v^{4/3}g*^{1/6}，τ_n=878.4 s·v⁴(1.293/Δ)⁵（瓶法/束法张力） | Y_p>0.6 → fail |
| `R_GROWTH` | 增长因子与 σ₈ | computed | δ̈+2Hδ̇=(3/2)Ω_mδ/a³ 从 a_eq 积分；σ(M,a)=σ_gal(a)(M/10¹²)^{−(n_eff+3)/6}，n_eff=n_s−2.965；σ_gal∝Q，含谱倾斜与 √(1−8f_ν)；校准默认 σ(10¹²,0)=1.9（σ₈≈0.8） | σ₈<0.05 → fail |
| `R_COLLAPSE` | 坍缩红移 | computed | Press–Schechter：νσ(M,a)≥δ_c=1.686；首批 3σ/10⁸M⊙；星系 2σ/10¹²M⊙ | 星系未坍缩 → fail |
| `R_WEINBERG` | Weinberg 上界 | scaling | Ω_Λ,max≈Ω_m(2σ_gal/δ_c)³ | 超过 → fail |
| `R_PBH` | 原初黑洞 | computed | β=erfc(0.45/(√2σ_hor))，σ_hor=Q(k_hor/k_piv)^{(n_s−1)/2}（Carr 1975） | β>10⁻⁸ → fail |
| `R_Q_WINDOW` | Q 宜居窗口 | heuristic | Tegmark & Rees 1998：Q≲10⁻⁶ 无法冷却；≳10⁻⁴ 太密；≳10⁻³ 团块坍缩为黑洞 | ≥10⁻³ → fail |
| `R_NEUTRINO` / `R_NO_CDM` | 中微子 / 无冷暗物质 | scaling / heuristic | f_ν；Silk 阻尼 | — |
| `R_STAR_MASS` | 恒星质量窗口 | scaling | Adams 2008 (arXiv:0807.3697) §3.1–3.2：两端都 ∝ M₀=α_G^{−3/2}m_p（eq.1）；M_min=6(3π)^{1/2}(4/5)^{3/4}(m_p/m_ion)²(kT_nuc/mₑc²)^{3/4}M₀（eq.35，简并 vs 点火）；M_max≈56M₀≈100M⊙（eq.39，辐射压 f_g=½）。取 T_nuc∝α²m_p ⇒ M_min/M_max∝(α/α₀)^{3/2}(mₑ/mₚ)^{−3/4}：窗口宽度由 α 与质量比控制，α_G 只整体平移 | M_min≥M_max → fail |
| `R_STAR_IGNITE` | 能否点燃 | scaling | 氘核束缚 ∧ M_min<M_max ∧ 有重子 ∧ Zα<1 | 否 → fail |
| `R_STAR_LIFE` | 主序寿命 | scaling | t_MS≈10 Gyr·α_G⁻¹(α/α₀)²(mₑ/mₚ)^{−2} | <0.5 Gyr → bad |
| `R_NUCLEI` | 稳定核上限 | scaling | Z_max≈92(α₀/α) | <6 无碳 → fail |
| `R_SUPERNOVA` | 重元素散布 | heuristic | 中微子机制；v≳3v₀ 哑火 | bad |
| `R_ATOMS` | 原子稳定性 | computed | a₀∝1/(αmₑ)；Ry；Dirac Zα<1 ⇒ Z_max=⌊1/α⌋ | fail |
| `R_MOLECULES` | 分子刚性 | scaling | (mₑ/mₚ)^{1/4}<0.45 | fail |
| `R_CHEMISTRY` | 化学可行 | scaling | 原子 ∧ 氢 ∧ 元素≥6 ∧ 分子刚性 ∧ 轨道稳定 | fail |
| `R_PLANETS` | 行星与宜居带 | scaling | 行星质量∝(α/α_G)^{3/2}mₚ（Weisskopf）；d_HZ=√L AU | bad |
| `R_TIMESCALE` | 时间尺度 | heuristic | t_MS≥0.5 Gyr 且窗口≥1 Gyr | bad |
| `R_HOYLE` | 三氦过程与 Hoyle 共振（碳/氧产率） | scaling | ξ=(αₛ,nuc−1)/0.005−(α/α₀−1)/0.04；f_C=10^{−2max(0,−ξ)}，f_O=10^{−2max(0,ξ)}——线性化自 Oberhummer, Csótó & Schlattl 2000 Science 289, 88（核力 ±0.5% / 电磁 ±4% ⇒ C 或 O 产率降 30–1000 倍；|ξ|=1↔100 倍）；Ekström 2010 / Epelbaum 2013 给出更宽区间；仅在 |Δαₛ|≲2%、|Δα|≲15% 内使用 | f<0.05 → fail |
| `R_WATER` | 液态水温度窗口 | scaling | H₂O 键能与液态温区 ∝ Ry ∝ α²mₑ；T_planet∝(L/d²)^{1/4} ⇒ d_w=1 AU·√L·(α²mₑ)^{−2}；需 H、O（三氦产氧）、刚性分子（Barrow & Tipler；Barnes 2012） | 否 → fail |
| `R_COMPLEX_CHEM` | 复杂化学 | scaling | α<0.1 ∧ (mₑ/mₚ)^{1/4}<0.45 ∧ Z_max≥16（C N O Si P S 可用）∧ 有氢；输出可用元素集合 | Z_max<16 → warn/fail |
| `R_BIOCHEM_CARBON` | 碳-水型生物化学 | scaling | 原料（C、O）✓/✗ · 溶剂窗口 ✓/✗ · 复杂化学 ✓/✗ → 可能/不可能；**OBSERVERS_POSSIBLE 的必要条件** | ✗ → fail |
| `R_ALT_BIOCHEM`（模块 altBiochem） | 替代生化（硅基/非水溶剂）推测倾向 | heuristic | 碳受抑 + Si 可用 + (>400 K 轨道 或 液态氨/甲烷窗口) → 低/中/高；无公认判据，仅为文献定性论证；不改变主结局（Bains 2004；Schulze-Makuch & Irwin 2008；NRC 2007） | warn（信息） |
| `R_OCEAN` | 冷液体宇宙（弥散的液态物质） | heuristic | 四条同时成立：① 自由落体塌缩时标 t_ff=√(3π/(32Gρ_b))，ρ_b=Ω_b ρ_crit,0 a⁻³ ⇒ t_ff=(π/2)H₀⁻¹a^{3/2}(G/G₀·Ω_b)^{−1/2}（G/G₀=α_G/(m_p/m_p₀)²，即 gNewton），在液态窗口起点的 a 上与 t(a=1) 相比 >1；② `!stars.canIgnite`；③ `atoms.atoms ∧ atoms.molecules`；④ 背景温度 T=T_CMB/a 落在 [273.15, 373.15] K×(α/α₀)²(mₑ/mₑ₀)（与 R_WATER 同一条键能标度），且在复合之后、在寿命之内。近似：Friedmann 层由 Ω 参数化，G 不进膨胀史；取宇宙平均重子密度；不判凝聚。**不参与结局判定** —— 结局仍是既有的 `NO_STARS`，只在 `result.variant` 上挂 `'ocean'`（合约写死 outcome>11 即 revert，12 项结局一项都不能加）。只在 `!canIgnite` 时进 findings（有恒星的宇宙一条不多） | 四条全 ✓ → ok，否则 warn（信息） |

`verdict`：ok / warn / bad / fail；`severity`：info / warn / severe / fatal（供旧 UI）。

---

## 6. 结局枚举（`Engine.OUTCOMES`，判定顺序即表序）

| id | 名称 | 触发 |
|---|---|---|
| `UNSTABLE_ORBITS` | 无稳定轨道 / 无稳定原子 | D≥4（无稳定轨道/原子基态）或 D≤2（无牛顿吸引）；`habitability=null`、`canEnterMirror=false` |
| `BEYOND_MODEL_DIM` | 超出模型适用范围（D≠3，按 3 维公式外推） | 其余 D≠3（3<D<4、2<D<3、非 3 整数维亦然）：R_DIM 保留 Ehrenfest/Tegmark 结论，后续数值为 3 维公式外推、仅供参考；`habitability=null`、`canEnterMirror=false`、`outcome.observers=false`；报告首句声明"不构成可能诞生观察者的判断" |
| `NO_ATOMS` | 没有原子 | 无重子（CP/Ω_b）/ 质子衰变（Δ<−mₑ）/ Zα→1 |
| `BIG_CRUNCH` | 大挤压 | Friedmann 转向坍缩（Ω_k<0、Ω_Λ<0） |
| `BLACK_HOLE_DOMINATED` | 黑洞主导 | Carr β>10⁻⁸ 或 Q_eff≥10⁻³ |
| `HEAT_DEATH_NO_STRUCTURE` | 热寂——无结构 | 星系尺度涨落未达 δ_c（Weinberg / Q 小 / ν） |
| `NO_STARS` | 没有恒星 | 氘核不束缚 / 点火质量>上限 |
| `NO_CHEMISTRY` | 无化学 | 无氢 / 无碳 / 分子无刚性 |
| `NO_CARBON_CHEMISTRY` | 无碳-水型生物化学 | 恒星与化学都在，但 R_BIOCHEM_CARBON ✗：Hoyle 共振失谐（碳/氧产率 <5%）、无液态水窗口或复杂化学受限（选择新枚举而非并入 STARS_NO_LIFE，便于 UI 区分"缺原料"与"缺时间"） |
| `STARS_NO_LIFE` | 有恒星无生命 | 可居住性 <0.4 |
| `OBSERVERS_POSSIBLE` | 可能诞生观察者 | 其余（我们的宇宙必落此） |
| `BIG_RIP` | 大撕裂 | 保留枚举；无幻影能量参数，不会出现 |

---

## 7. API

`Engine.simulate(params, {modules, register, series, catalog, name}) → {version, mode:'real', id, idLabel, runs, hash, seed, isOurUniverse, name, params(有效输入), modules, constants, derived, derivedOrder, findings, worstVerdict, calc, cosmology{background, fate, events, series, tOfA, d0}, timeline, outcome{id,name,cls,visual,reasons,observers,viewTimeGyr,description,beyondModel}, fate, habitability(D≠3 时 null), habitabilityRaw, canEnterMirror(D≠3 时 false，UI 据此禁用镜像/星球), distance, constantsReport{items,sentence}, report, elapsedMs}`

`Engine.PARAMS`（=`Params.BASE`）、`Engine.MODULES`、`Engine.PARAMS_FOR(modules)`、`Engine.normalizeModules(m)`、`Engine.deriveConstants(params, modules) → {c, derived, derivedOrder, modules, params}`、`Engine.defaults(modules)`、`normalize(p, modules)`、`distance(p, q, modules)`、`isOurUniverse(p, modules)`、`hashParams(p, modules)`、`emergentDimensions(p)`、`background(c)`、`integrate(B, {d0, thresholds, series})`、`Engine.calc.{dimensions,baryogenesis,expansion,recombination,bbn,structure,stars,atoms,planets}`；
`createNBody(params, {modules, N, mesh, seed, aStart, tEnd, aRip})`（PM 引力，耦合 1.5·Ω_m/a³，Zel'dovich 初值 ∝ Q）；
`Engine.Catalog` / `createCatalog({storage})` / `storage.{Memory, LocalStorage, File}`（条目 `{id, label, name, params, modules, outcome, outcomeName, hash, createdAt, note}`；引爆计数 #0001 起，跳过 1207；我们的宇宙 #1207）；
`presets` / `getPreset(key)` / `presetModules(key)`；`randomParams(seed, modules, {spread})`、`searchStatistics(N, seed, {modules, spread})`、`dimensionStatistics(N, seed)`、`SPREADS`、`spreadLabel(spread)`；`formatTime / formatId / cnNumber / cnInt / sci / erfc`。

预设（`Engine.presets`，24 个）：我们的宇宙、大挤压、负真空能、Λ 超过 Weinberg 上界、涨落太小、黑洞主导、没有氢、强电磁、四维、3.7 维（BEYOND_MODEL_DIM）、氘核不束缚、双质子、Hoyle 共振失谐（α+5% → NO_CARBON_CHEMISTRY）、正反物质对称、弱作用极弱；弦气模块（默认 D=3 / 过热 D≈4 / 二点五维（BEYOND_MODEL_DIM）/ 六维）；慢滚模块（默认 / 高能标→黑洞）；景观模块（默认 / 多一个通量量子→无结构 / 通量归零→坍缩）。报告与预设文案不引用小说；小说只作为 UI 参考。

---

## 8. 状态总表

| 类别 | 项 | status |
|---|---|---|
| 输入 | α、αₛ(M_Z)、v、m_H、mₑ、m_u、m_d、θ_QCD、Σm_ν、δ_CKM、N_gen、H₀、Ω_bh²、Ω_ch²、Ω_Λ、A_s、n_s、Ω_k、T_CMB | accepted |
| 输入 | D | accepted-fact, no-mechanism |
| 派生 | Ω_r、Ω_b、Ω_c、η、Λ_QCD、m_p、α_G、mₑ/mₚ、m_n−m_p、核力强度、G_F、λ_H、Q | accepted（basis computed / scaling） |
| 派生 | c、G、ħ、e 的 SI 数值（§4A） | accepted (convention-dependent) |
| 模块 | slowRoll：V₀、ε、η、N、k₀ → A_s、n_s、Ω_k | mainstream-model |
| 模块（默认开） | stringGas：T₀/T_H、n_w、κ → D（允许非整数） | speculative |
| 模块 | landscape：g_s、V、φ₁₋₃、n₁₋₃、Λ₀ → α、αₛ、mₑ、m_u、m_d、Λ | speculative |

---

## 9. 什么没有被模拟（诚实清单）

- **有量纲常数（v2.4.0）**：c、G、ħ、e 的数值取决于单位约定（§4A），不是"跨宇宙的物理差异"本身；跨宇宙不变的物理内容是 α、α_G 等无量纲量。默认按约定 A 呈现，可切 B/C；三种约定给出同一套无量纲物理，只是把 α 的变化归给不同的有量纲常数（Duff 2002）。
- **口径与标度（v2.0.2 审查后标注）**：Λ_QCD 是固定 n_f=5 的一环口径（≈87 MeV），非 PDG Λ_MS-bar，标 scheme-dependent，只用比值；m_p、α_G、mₑ/mₚ、m_n−m_p 均为标度关系（basis scaling）；m_n−m_p 用 BMW 2015 的 QCD/QED 分解并线性化于观测值 1.293 MeV；氘核/双质子结合能的线性式只有阈值量级来自文献，线性插值是本引擎近似；恒星质量窗口按 Adams 2008 eq.35/39——两端都 ∝ α_G^{−3/2}，窗口宽度只随 α、mₑ/mₚ 变。η=n_b/n_γ ∝ Ω_bh²/T_CMB³ 已含 T_CMB 依赖。常数取 CODATA 2018 / PDG 2022（α=1/137.035999084，mₑ=0.51099895 MeV，G_F=1.1663788×10⁻⁵ GeV⁻²，τ_n=878.4 s，N_eff=3.044）。
- 传递函数是幂律 + 有效谱指数近似；σ(M) 用一个星系尺度校准点外推；坍缩用 Press–Schechter 的 νσ=δ_c。
- 复合用 Saha 平衡近似（Peebles 非平衡解把去耦推到 z≈1090）。
- BBN 用 Steigman 拟合 + n/p 比值修正，不是核反应网络；氘核/双质子阈值是文献标度估计，双质子的后果有争议；核力强度对 m_π 的依赖是标度关系。
- Λ_QCD 用一环 n_f=5 口径（≈87 MeV，与两环 MS-bar 的 210 MeV 口径不同，只用其比值）。
- 恒星用 Adams 2008 的量纲标度，没有恒星结构方程；M_max 取常数×α_G^{−3/2}。
- 弦气维数（默认开、可关）、弦论景观（默认关）是玩具模型（speculative）：引文（Brandenberger & Vafa 1989；Polchinski 1998；Bousso & Polchinski 2000；Candelas 1985 作背景）只支持定性机制，定量式为本引擎玩具延伸；慢滚公式为真计算但模型未证实。
- 行星地表、生命出现是过程生成的示意：只比较时间尺度、宜居带、重元素供给与 Tegmark–Rees 的 Q 窗口；生物化学层（v2.1.0）只做 Hoyle 共振的线性化敏感性（Oberhummer 2000 区间）、H₂O 键能标度的液态水窗口与元素可用性，不做行星大气/地质；替代生化模块是文献定性论证（Bains 2004 等），无公认判据。
- N 体是 2D 周期盒 PM 引力，只用于可视化结构形成的相对快慢与团块度。
- 大撕裂不会出现（没有幻影暗能量参数）。

## 10. 决定论
`hash = FNV-1a(模块状态 + 归一化参数串)`；所有计算确定；`createNBody` 的随机初值用该哈希做种子——同一组参数再次引爆，得到完全一样的宇宙。
