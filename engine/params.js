/*
 * 镜像宇宙模拟器 · 参数 schema（数据驱动）
 * ------------------------------------------------------------
 * 原则：一个参数都不编造。
 *   BASE   —— 默认可编辑的输入 = 物理学界普遍接受的基本参数（标准模型 + ΛCDM + 观测量），
 *             每项 status:'accepted' + ref（PDG 2022 / Planck 2018）。它们在现有物理里是"测量而非推导"的量，
 *             因此本身就是最底层输入。空间维数 D=3：status:'accepted-fact, no-mechanism'（Tegmark 1997 的分析方式）。
 *   MODULES —— 推测性/主流模型模块（UI 有开关；stringGas 默认开、其余默认关）。开启后其参数替换掉被派生的基础输入：
 *             stringGas（Brandenberger–Vafa 弦气 → D，允许非整数，speculative，默认开）
 *             slowRoll （慢滚暴胀势能 → A_s、n_s、Ω_k，mainstream-model）
 *             landscape（弦论景观：g_s、V、模量、通量 → α、αₛ(M_Z)、汤川、Λ，speculative）
 *             altBiochem（替代生化：硅基/非水溶剂的定性倾向 finding，speculative；无参数）
 *   公认的派生量（Λ_QCD、m_p、α_G、m_n−m_p、Ω_r、η……）在 engine.deriveConstants() 里计算，basis:'computed'。
 *
 * "十八个"取自《镜子》（"奇点的性质由十八个参数确定"），是小说数字；这里以公认为准（20 个基础参数）。
 *
 * 字段：
 *   key / index / name / symbol / unit / min / max / default / step / scale('lin'|'log') / floor
 *   status   'accepted' | 'accepted-fact, no-mechanism' | 'mainstream-model' | 'speculative'
 *   si       默认值出处/含义   ref   文献   group   分组   desc   一句说明
 *   module   （模块参数）所属模块 id
 *
 * API：
 *   BASE / SCHEMA / PARAMS         基础参数表        MODULES  模块表 [{id, name, status, params:[schema], derives:[keys], ref, desc}]
 *   paramsFor(modules)             当前有效参数表（关闭 → 直接输入；开启 → 模块参数替换被派生的输入）
 *   defaults(modules)  normalize(p, modules)  toUnit(key, v)  fromUnit(key, u)  distance(p, q, modules)  isDefault(p, modules)  formatValue(key, v)
 *   normalizeModules(m) → {stringGas:true（默认开）, slowRoll:false, landscape:false, altBiochem:false}；缺省键取模块默认，显式 false 可关闭
 *
 * UMD：Node 下 module.exports = MirrorParams；浏览器下 window.MirrorParams。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.MirrorParams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PI = Math.PI;

  // ============================================================
  // 基础参数（公认；默认可编辑）
  // ============================================================
  var BASE = [
    { key: 'alpha', index: 1, status: 'accepted', name: '精细结构常数', symbol: 'α', unit: '', min: 0.001, max: 0.5, default: 1 / 137.035999084, step: 0.0001, scale: 'log',
      si: '1/137.035999084（CODATA 2018 / PDG 2022）', group: '标准模型', ref: 'PDG 2022；Barrow & Tipler 1986；Adams 2008',
      desc: '电磁相互作用强度。进入 Bohr 半径、Rydberg、Saha 复合、m_n−m_p 电磁项、核库仑极限、Dirac 原子稳定性、恒星点火与寿命。' },
    { key: 'alphaSMZ', index: 2, status: 'accepted', name: '强耦合常数 αₛ(M_Z)', symbol: 'αₛ(M_Z)', unit: '', min: 0.06, max: 0.25, default: 0.1179, step: 0.0005, scale: 'log',
      si: '0.1179±0.0009（PDG 2022）', group: '标准模型', ref: 'PDG 2022；Gross & Wilczek 1973；Politzer 1973（渐近自由、量纲传输）',
      desc: '在 M_Z 的强耦合。一环跑动给出 Λ_QCD=M_Z e^{−2π/(b₀αₛ)}（b₀=23/3，n_f=5）→ 质子质量 → α_G=(m_p/M_Pl)²，指数敏感。' },
    { key: 'higgsVev', index: 3, status: 'accepted', name: '希格斯真空期望值', symbol: 'v', unit: 'GeV', min: 2.46, max: 24622, default: 246.22, step: 0.1, scale: 'log',
      si: '246.22 GeV（G_F=1.1663788×10⁻⁵ GeV⁻²，PDG 2022）', group: '标准模型', ref: 'PDG 2022；Agrawal, Barr, Donoghue & Seckel 1998',
      desc: '电弱能标。G_F=1/(√2v²)：中子寿命 ∝ v⁴、n/p 冻结温度 ∝ v^{4/3}、超新星中微子机制。费米子质量在此按给定值输入（不随 v 联动）。' },
    { key: 'higgsMass', index: 4, status: 'accepted', name: '希格斯质量', symbol: 'm_H', unit: 'GeV', min: 10, max: 1000, default: 125.25, step: 0.05, scale: 'log',
      si: '125.25±0.17 GeV（PDG 2022）', group: '标准模型', ref: 'PDG 2022；Kajantie, Laine, Rummukainen & Shaposhnikov 1996（电弱相变级别）',
      desc: '决定自耦合 λ_H=m_H²/(2v²)=0.129。m_H≲72 GeV 电弱相变为一级（电弱重子生成的条件之一）；只作提示，不进入演化。' },
    { key: 'electronMass', index: 5, status: 'accepted', name: '电子质量', symbol: 'mₑ', unit: 'MeV', min: 0.005, max: 50, default: 0.51099895, step: 0.001, scale: 'log',
      si: '0.51099895 MeV（PDG）', group: '标准模型', ref: 'PDG 2022；Barrow & Tipler 1986',
      desc: '与质子质量之比进入 Saha、恒星点火质量、分子刚性；与 m_n−m_p 之比决定氢原子稳定性。' },
    { key: 'mUp', index: 6, status: 'accepted', name: '上夸克质量', symbol: 'm_u', unit: 'MeV', min: 0.01, max: 20, default: 2.16, step: 0.01, scale: 'lin',
      si: '2.16 MeV（MS-bar 2 GeV，PDG 2022）', group: '标准模型', ref: 'PDG 2022；Gasser & Leutwyler 1982；Hogan 2000',
      desc: '与 m_d 决定 m_n−m_p 的 QCD 部分与 π 介子质量（核力射程）。下限 0.01 MeV：m_π²∝(m_u+m_d) 为 0 时核力强度公式（含 ln m_π²）发散。' },
    { key: 'mDown', index: 7, status: 'accepted', name: '下夸克质量', symbol: 'm_d', unit: 'MeV', min: 0.01, max: 20, default: 4.67, step: 0.01, scale: 'lin',
      si: '4.67 MeV（PDG 2022）', group: '标准模型', ref: 'PDG 2022；Gasser & Leutwyler 1982；BMW 2015（格点）',
      desc: 'm_d−m_u 太小→质子衰变/氢被电子俘获；太大→中子太重，氘核内 β 衰变。' },
    { key: 'thetaQCD', index: 8, status: 'accepted', name: '强 CP 相位', symbol: 'θ_QCD', unit: 'rad', min: 0, max: PI, default: 0, step: 0.01, scale: 'lin',
      si: '|θ|<10⁻¹⁰（中子 EDM）', group: '标准模型', ref: 'PDG 2022；Ubaldi 2010',
      desc: '强作用 CP 相位。观测上极小；O(1) 时核结合能改变（只作提示，不进入演化）。' },
    { key: 'sumNu', index: 9, status: 'accepted', name: '中微子质量和', symbol: 'Σm_ν', unit: 'eV', min: 0, max: 5, default: 0.06, step: 0.01, scale: 'lin',
      si: '≥0.06 eV（振荡）；<0.12 eV（Planck）', group: '标准模型', ref: 'PDG 2022；Planck 2018；Tegmark, Vilenkin & Pogosian 2005',
      desc: '热暗物质分量 f_ν=Ω_ν/Ω_m，Ω_νh²=Σm_ν/93.14 eV；ΔP/P≈−8f_ν。' },
    { key: 'ckmPhase', index: 10, status: 'accepted', name: 'CKM CP 相位', symbol: 'δ_CKM', unit: 'rad', min: 0, max: PI, default: 1.196, step: 0.01, scale: 'lin',
      si: '68.5°（PDG 2022）', group: '标准模型', ref: 'PDG 2022；Kobayashi & Maskawa 1973；Sakharov 1967',
      desc: '夸克混合的 CP 破坏相位。为 0（且假定无其它来源）→ Sakharov 条件不满足。' },
    { key: 'generations', index: 11, status: 'accepted', name: '粒子代数', symbol: 'N_gen', unit: '', min: 1, max: 6, default: 3, step: 1, scale: 'lin',
      si: '3（LEP N_ν=2.984±0.008）', group: '标准模型', ref: 'PDG 2022；Kobayashi & Maskawa 1973',
      desc: '<3 时 CKM 没有 CP 相位；每多一代多一种轻中微子：N_eff↑（标准 3.044，Froustey 2020 / Bennett 2021）、Ω_r↑、Y_p↑。' },
    { key: 'H0', index: 12, status: 'accepted', name: '哈勃常数', symbol: 'H₀', unit: 'km/s/Mpc', min: 20, max: 200, default: 67.4, step: 0.1, scale: 'lin',
      si: '67.4±0.5（Planck 2018；局域测量 73）', group: 'ΛCDM', ref: 'Planck 2018；Riess et al. 2022',
      desc: '今天的膨胀率。定义 ρ_crit 与时间标度 1/H₀；Ω_b、Ω_c 由物理密度 Ω h² 换算。' },
    { key: 'omegaBh2', index: 13, status: 'accepted', name: '重子物理密度', symbol: 'Ω_b h²', unit: '', min: 0, max: 0.5, default: 0.02237, step: 0.0001, scale: 'lin',
      si: '0.02237±0.00015（Planck 2018）', group: 'ΛCDM', ref: 'Planck 2018；Steigman 2007',
      desc: 'η₁₀=273.9·Ω_b h²·(2.7255/T_CMB)³=6.13；决定氦丰度、复合红移、恒星形成的气体供应。' },
    { key: 'omegaCh2', index: 14, status: 'accepted', name: '冷暗物质物理密度', symbol: 'Ω_c h²', unit: '', min: 0, max: 5, default: 0.1200, step: 0.001, scale: 'lin',
      si: '0.1200±0.0012（Planck 2018）', group: 'ΛCDM', ref: 'Planck 2018；Tegmark, Aguirre, Rees & Wilczek 2006',
      desc: 'Ω_m=Ω_b+Ω_c 决定 z_eq、增长因子与膨胀史。' },
    { key: 'omegaLambda', index: 15, status: 'accepted', name: '暗能量密度', symbol: 'Ω_Λ', unit: 'ρ_crit', min: -2, max: 1e4, default: 0.685, step: 0.005, scale: 'lin',
      si: '0.685±0.007（Planck 2018）', group: 'ΛCDM', ref: 'Planck 2018；Weinberg 1987；Martel, Shapiro & Weinberg 1998',
      desc: '宇宙学常数（w=−1）。<0 反德西特式坍缩；超过 Weinberg 上界 ~Ω_m(2σ_gal/δ_c)³ 时星系无法形成。' },
    { key: 'As', index: 16, status: 'accepted', name: '原初标量功率谱幅度', symbol: 'A_s', unit: '', min: 1e-13, max: 1e-4, default: 2.1e-9, step: 1e-11, scale: 'log',
      si: 'ln(10¹⁰A_s)=3.044（Planck 2018，k=0.05 Mpc⁻¹）', group: 'ΛCDM', ref: 'Planck 2018；Tegmark & Rees 1998；Press & Schechter 1974',
      desc: '曲率扰动幅度。视界进入时的密度扰动 Q≈(2/5)√A_s≈1.8×10⁻⁵；决定 σ(M,z)、坍缩红移、原初黑洞。' },
    { key: 'ns', index: 17, status: 'accepted', name: '谱指数', symbol: 'n_s', unit: '', min: 0.8, max: 1.2, default: 0.965, step: 0.005, scale: 'lin',
      si: '0.965±0.004（Planck 2018）', group: 'ΛCDM', ref: 'Planck 2018；Harrison 1970 / Zeldovich 1972',
      desc: '涨落谱倾斜：σ(k)∝(k/k_piv)^{(n_s−1)/2}。' },
    { key: 'omegaK', index: 18, status: 'accepted', name: '曲率', symbol: 'Ω_k', unit: '', min: -1, max: 1, default: 0, step: 0.005, scale: 'lin',
      si: '0.0007±0.0019（Planck 2018 + BAO），与 0 相容', group: 'ΛCDM', ref: 'Planck 2018；Vilenkin & Winitzki 1997',
      desc: 'Friedmann 曲率项 Ω_k/a²。<0 闭合→可能大挤压；>0 开放→增长提前冻结。' },
    { key: 'tcmb', index: 19, status: 'accepted', name: '微波背景温度', symbol: 'T_CMB', unit: 'K', min: 0.5, max: 30, default: 2.7255, step: 0.001, scale: 'lin',
      si: '2.7255±0.0006 K（COBE/FIRAS）', group: 'ΛCDM', ref: 'Fixsen 2009',
      desc: '今天的辐射温度。Ω_γh²=2.47×10⁻⁵(T/2.7255)⁴，Ω_r=Ω_γ(1+0.2271N_eff)；η ∝ Ω_bh²/T³。' },
    { key: 'dimS', index: 20, status: 'accepted-fact, no-mechanism', name: '空间维数', symbol: 'D', unit: '维', min: 1, max: 11, default: 3, step: 0.1, scale: 'lin',
      si: '3（观测事实；无公认生成机制）', group: '几何', ref: 'Ehrenfest 1917；Tegmark 1997',
      desc: '直接输入（Tegmark 1997 的分析方式）。D≥4 无稳定轨道与原子基态；D≤2 无牛顿吸引；开启弦气模块后由 T₀/T_H 与缠绕密度派生。' }
,
    /* 引力耦合的独立自由度。原来 α_G 完全由质子质量平方决定（engine.js 里
       alphaG = (m_p/M_Pl)²），于是 G 没有自己的入口 —— 这正是「G/c/h/e 四个常数
       不可能都变」的技术根源，是建模缺了一维，不是物理禁止。
       这里补上：α_G = (m_p/M_Pl)² × gNewton。gNewton = G_r/(ħ_r c_r)，
       即"外部参照系里 G 相对我们的倍率，扣掉 ħ、c 换算带来的部分"。
       默认 1 ⇒ 不传这个参数时，引擎行为与以前逐位相同。 */
    { key: 'gNewton', index: 23, status: 'accepted', name: '引力耦合倍率', symbol: 'G_r/(ħ_r c_r)', unit: '', min: 1e-4, max: 1e4, default: 1, step: 0.01, scale: 'log',
      si: '1（按我们的宇宙归一）', group: '引力', ref: 'Barrow & Tipler 1986；Adams 2008（α_G 决定恒星质量窗口与寿命）',
      desc: '把 α_G 从"只由质子质量决定"里解放出来。α_G=(m_p/M_Pl)²×gNewton。进入恒星点火质量窗口、主序寿命、行星最大质量（Weisskopf）。' }  ];

  // ============================================================
  // 推测性 / 主流模型模块（默认关闭）
  // ============================================================
  var MODULES = [
    { id: 'stringGas', name: '弦气维数模块（Brandenberger–Vafa）', status: 'speculative', defaultOn: true, derives: ['dimS'],
      ref: 'Brandenberger & Vafa 1989, Nucl. Phys. B316, 391；Tseytlin & Vafa 1992',
      desc: '9 个空间维初始蜷缩，缠绕弦与反缠绕弦湮灭的维才能解开；一维弦世界面在 ≤3+1 维中一般性相交 ⇒ 典型 3 维（引文只支持这一定性机制）。定量式为本引擎玩具延伸：ε_i = g_i·e^{6(T₀/T_H−0.98)}/n_w，g=[3,2,1.3,0.78,0.55,0.38,0.26,0.18,0.12]；解开度 s_i = smoothstep((ε_i−1+w)/2w)，w=0.4(1−κ)，|ε_i−1|>w 时饱和为 0/1，带内为分数；D=Σs_i（允许非整数）。默认 T₀/T_H=0.98、n_w=1、κ=0.5 ⇒ 恰好 3 维饱和解开、其余饱和蜷缩，D=3.000。真实物理没有公认机制；默认开启但可关闭（关闭后 D 为直接输入）。',
      params: [
        { key: 'stringGasT', module: 'stringGas', status: 'speculative', name: '初始弦气温度 / Hagedorn 温度', symbol: 'T₀/T_H', unit: '', min: 0.5, max: 1.5, default: 0.98, step: 0.005, scale: 'lin', si: '0.98（恰好解开三维）', group: '弦气', ref: 'Brandenberger & Vafa 1989', desc: '过热→更多维解开；过冷→只解开 1–2 维。湮灭效率整体因子 e^{6(T₀/T_H−0.98)}。' },
        { key: 'windingDensity', module: 'stringGas', status: 'speculative', name: '缠绕模初始密度', symbol: 'n_w', unit: 'rel', min: 0.1, max: 10, default: 1, step: 0.01, scale: 'log', si: '1', group: '弦气', ref: 'Brandenberger & Vafa 1989', desc: '越多越难全部湮灭，解开的维数越少（效率 ∝ 1/n_w）。' },
        /* 默认 0.9（原 0.5）：我们的宇宙观测到的是三个维度**干净地全开**，没有任何
       "半开"的维度，对应过渡带 w=0.4(1−κ) 很窄。κ=0.5 时 w=0.2，窄坎会落在带内，
       锚点会解出 "2 个全开 + 2 个半开" 这种碰巧凑成 3 的结果 —— 那不是三维宇宙。 */
    { key: 'compactStiffness', module: 'stringGas', status: 'speculative', name: '紧致化刚度（解开阈值宽度）', symbol: 'κ', unit: '', min: 0, max: 1, default: 0.9, step: 0.01, scale: 'lin', si: '0.5（w=0.2）', group: '弦气', ref: 'Brandenberger & Vafa 1989（玩具延伸）', desc: '阈值带宽 w=0.4(1−κ)：κ→1 硬阈值（D 恒为整数）；κ→0 宽带（更多分数维）。' }
      ] },
    { id: 'slowRoll', name: '慢滚暴胀势能模块', status: 'mainstream-model', derives: ['As', 'ns', 'omegaK'],
      ref: 'Liddle & Lyth 2000；Planck 2018 X（暴胀约束）',
      desc: '慢滚公式（真计算）：A_s = V₀/(24π²ε M_Pl⁴)，n_s = 1−6ε+2η，r=16ε；Ω_k = k₀·e^{−2(N−60)}。主流模型但未证实。',
      params: [
        { key: 'inflatonScale', module: 'slowRoll', status: 'mainstream-model', name: '暴胀能标', symbol: 'V₀^{1/4}/M_Pl', unit: '', min: 1e-4, max: 0.1, default: 7.0619e-3, step: 1e-5, scale: 'log', si: '7.06×10⁻³（≈1.7×10¹⁶ GeV，复现 A_s=2.1×10⁻⁹）', group: '暴胀', ref: 'Liddle & Lyth 2000', desc: '势能高度（约化普朗克单位）。' },
        { key: 'slowRollEpsilon', module: 'slowRoll', status: 'mainstream-model', name: '慢滚参数 ε', symbol: 'ε', unit: '', min: 1e-4, max: 0.5, default: 0.005, step: 1e-4, scale: 'log', si: '0.005（r=0.08）', group: '暴胀', ref: 'Liddle & Lyth 2000', desc: 'ε=(M_Pl²/2)(V′/V)²。' },
        { key: 'slowRollEta', module: 'slowRoll', status: 'mainstream-model', name: '慢滚参数 η', symbol: 'η', unit: '', min: -0.2, max: 0.2, default: -0.0025, step: 0.0005, scale: 'lin', si: '−0.0025（使 n_s=0.965）', group: '暴胀', ref: 'Liddle & Lyth 2000', desc: 'η=M_Pl²V″/V。' },
        { key: 'efolds', module: 'slowRoll', status: 'mainstream-model', name: '暴胀 e-folds', symbol: 'N', unit: '', min: 30, max: 120, default: 60, step: 1, scale: 'lin', si: '60', group: '暴胀', ref: 'Guth 1981；Liddle & Leach 2003', desc: '曲率稀释 e^{−2N}。' },
        { key: 'initialCurvature', module: 'slowRoll', status: 'mainstream-model', name: '暴胀前曲率', symbol: 'k₀', unit: '', min: -1, max: 1, default: 0, step: 0.01, scale: 'lin', si: '0', group: '暴胀', ref: 'Guth 1981', desc: 'Ω_k = k₀·e^{−2(N−60)}（夹到 ±1）。' }
      ] },
    { id: 'landscape', name: '弦论景观模块', status: 'speculative', derives: ['alpha', 'alphaSMZ', 'electronMass', 'mUp', 'mDown', 'omegaLambda'],
      ref: 'Polchinski 1998（机制）；Bousso & Polchinski 2000（机制）；Candelas et al. 1985（背景）——定量刻度为本引擎玩具延伸',
      desc: '机制真实、刻度为玩具：α = g_s/V（4 维规范耦合 1/g₄²∝V/g_s）；αₛ(M_Z) 同比；汤川 ∝ e^{k(φ−0.5)}（几何决定汤川只是定性背景）；Λ = Λ₀ + ½Σnᵢ²qᵢ²（Bousso–Polchinski），qᵢ² = 10⁻¹²¹·(1,2,3)·g_s²·137/V。全部标 speculative；定量形式为本引擎玩具延伸。',
      params: [
        { key: 'stringCoupling', module: 'landscape', status: 'speculative', name: '弦耦合', symbol: 'g_s', unit: '', min: 0.05, max: 20, default: 1, step: 0.01, scale: 'log', si: '1（刻度：α⁻¹=V/g_s）', group: '弦', ref: 'Polchinski 1998', desc: 'α = g_s/V；通量量子 q ∝ g_s。' },
        { key: 'compactVolume', module: 'landscape', status: 'speculative', name: '紧致化体积', symbol: 'V', unit: '弦单位', min: 2, max: 3000, default: 137.036, step: 0.5, scale: 'log', si: '137.036', group: '弦', ref: 'Polchinski 1998', desc: 'α = g_s/V。' },
        { key: 'shape1', module: 'landscape', status: 'speculative', name: '形状模量 φ₁（电子汤川）', symbol: 'φ₁', unit: '', min: 0, max: 1, default: 0.5, step: 0.005, scale: 'lin', si: '0.5', group: '弦', ref: 'Candelas et al. 1985（背景）', desc: 'mₑ=0.511 MeV·e^{7.8(φ₁−0.5)}（玩具延伸）。' },
        { key: 'shape2', module: 'landscape', status: 'speculative', name: '形状模量 φ₂（上夸克汤川）', symbol: 'φ₂', unit: '', min: 0, max: 1, default: 0.5, step: 0.005, scale: 'lin', si: '0.5', group: '弦', ref: 'Candelas et al. 1985（背景）', desc: 'm_u=2.16 MeV·e^{6(φ₂−0.5)}（玩具延伸）。' },
        { key: 'shape3', module: 'landscape', status: 'speculative', name: '形状模量 φ₃（下夸克汤川）', symbol: 'φ₃', unit: '', min: 0, max: 1, default: 0.5, step: 0.005, scale: 'lin', si: '0.5', group: '弦', ref: 'Candelas et al. 1985（背景）', desc: 'm_d=4.67 MeV·e^{6(φ₃−0.5)}（玩具延伸）。' },
        { key: 'flux1', module: 'landscape', status: 'speculative', name: '通量整数 n₁', symbol: 'n₁', unit: '', min: -5, max: 5, default: 2, step: 1, scale: 'lin', si: '2', group: '真空', ref: 'Bousso & Polchinski 2000', desc: 'Λ = Λ₀ + ½Σnᵢ²qᵢ²。' },
        { key: 'flux2', module: 'landscape', status: 'speculative', name: '通量整数 n₂', symbol: 'n₂', unit: '', min: -5, max: 5, default: 1, step: 1, scale: 'lin', si: '1', group: '真空', ref: 'Bousso & Polchinski 2000', desc: '同 n₁。' },
        { key: 'flux3', module: 'landscape', status: 'speculative', name: '通量整数 n₃', symbol: 'n₃', unit: '', min: -5, max: 5, default: 1, step: 1, scale: 'lin', si: '1', group: '真空', ref: 'Bousso & Polchinski 2000', desc: '同 n₁。' },
        { key: 'bareLambda', module: 'landscape', status: 'speculative', name: '裸真空能 log₁₀|Λ₀|（Λ₀<0）', symbol: 'log₁₀|Λ₀|', unit: 'M_Pl⁴', min: -124, max: -117, default: -120.34775366, step: 0.001, scale: 'lin', si: '−120.348（Λ₀=−4.49×10⁻¹²¹，与默认通量抵消到 +10⁻¹²³）', group: '真空', ref: 'Bousso & Polchinski 2000', desc: '负的裸真空能被通量抵消后剩极小正 Λ。' }
      ] }
  ];
  MODULES.push({ id: 'altBiochem', name: '替代生化（硅基 / 非水溶剂）', status: 'speculative', derives: [],
    ref: 'Bains 2004, Astrobiology 4, 137；Schulze-Makuch & Irwin 2008《Life in the Universe》；NRC 2007《The Limits of Organic Life in Planetary Systems》',
    desc: '开启后增加 finding R_ALT_BIOCHEM（basis heuristic）：在碳受抑但 Si 可用、行星温度 >400 K 或存在液态氨/甲烷窗口时，硅基或非水溶剂生化的推测倾向（低/中/高）。无公认判据，仅为文献中的定性论证；不引入新参数、不改变主结局。',
    params: [] });
  var MODULE_BY_ID = {};
  MODULES.forEach(function (m) { MODULE_BY_ID[m.id] = m; });
  var ALL_PARAMS = BASE.slice();
  MODULES.forEach(function (m) { m.params.forEach(function (d) { ALL_PARAMS.push(d); }); });
  var BY_KEY = {};
  ALL_PARAMS.forEach(function (d) { BY_KEY[d.key] = d; });

  /** 模块开关归一化：缺省用模块自身默认（stringGas 默认开，其余默认关）；显式 true/false 覆盖 */
  function normalizeModules(m) {
    var o = {};
    MODULES.forEach(function (mod) { o[mod.id] = (m && mod.id in m && m[mod.id] != null) ? !!m[mod.id] : !!mod.defaultOn; });
    return o;
  }
  /** 当前有效的可编辑参数表：基础参数去掉被开启模块派生的项，再加上模块参数 */
  function paramsFor(modules) {
    var ms = normalizeModules(modules), derived = {}, list = [];
    MODULES.forEach(function (mod) { if (ms[mod.id]) mod.derives.forEach(function (k) { derived[k] = mod.id; }); });
    BASE.forEach(function (d) { if (!derived[d.key]) list.push(d); });
    MODULES.forEach(function (mod) { if (ms[mod.id]) mod.params.forEach(function (d) { list.push(d); }); });
    return list;
  }
  function defaults(modules) {
    var o = {};
    paramsFor(modules).forEach(function (d) { o[d.key] = d.default; });
    return o;
  }
  /** 补全缺失、去 NaN、夹范围、整数取整；只保留当前有效参数（返回新对象） */
  function normalize(p, modules) {
    var o = {};
    p = p || {};
    paramsFor(modules).forEach(function (d) {
      var v = Number(p[d.key]);
      if (!isFinite(v)) v = d.default;
      if (v < d.min) v = d.min;
      if (v > d.max) v = d.max;
      if (d.step === 1 && d.scale === 'lin') v = Math.round(v);
      o[d.key] = v;
    });
    return o;
  }
  function toUnit(key, v) {
    var d = BY_KEY[key];
    if (!d) return 0;
    if (d.scale === 'log') {
      var lo = d.min > 0 ? d.min : (d.floor || 1e-3);
      var x = Math.max(v, lo);
      return (Math.log10(x) - Math.log10(lo)) / (Math.log10(d.max) - Math.log10(lo));
    }
    return (v - d.min) / (d.max - d.min);
  }
  function fromUnit(key, u) {
    var d = BY_KEY[key];
    if (!d) return NaN;
    u = Math.min(1, Math.max(0, u));
    if (d.scale === 'log') {
      var lo = d.min > 0 ? d.min : (d.floor || 1e-3);
      var v = Math.pow(10, Math.log10(lo) + u * (Math.log10(d.max) - Math.log10(lo)));
      if (d.min === 0 && u === 0) v = 0;
      return v;
    }
    return d.min + u * (d.max - d.min);
  }
  /** 参数空间归一化距离 0–100（在当前有效参数表上）：100·min(1, sqrt(Σu²/3)) */
  function distance(p, q, modules) {
    var list = paramsFor(modules);
    p = normalize(p, modules); q = normalize(q || defaults(modules), modules);
    var sum = 0;
    list.forEach(function (d) { var u = toUnit(d.key, p[d.key]) - toUnit(d.key, q[d.key]); sum += u * u; });
    return Math.round(100 * Math.min(1, Math.sqrt(sum / 3)) * 10) / 10;
  }
  function isDefault(p, modules, tol) {
    if (typeof modules === 'number') { tol = modules; modules = null; }
    tol = tol == null ? 1e-6 : tol;
    var n = normalize(p, modules);
    return paramsFor(modules).every(function (d) { return Math.abs(toUnit(d.key, n[d.key]) - toUnit(d.key, d.default)) <= tol; });
  }
  function formatValue(key, v) {
    var d = BY_KEY[key];
    if (!d) return String(v);
    if (key === 'alpha') return '1/' + (1 / v).toFixed(1);
    if (key === 'As' || key === 'inflatonScale') return v.toExponential(2);
    if (d.scale === 'log') return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toPrecision(3);
    return Math.abs(v) >= 100 ? v.toFixed(0) : String(Number(v.toPrecision(4)));
  }

  return {
    MODES: ['real'],
    BASE: BASE,
    SCHEMA: BASE,
    PARAMS: BASE,
    MODULES: MODULES,
    moduleById: MODULE_BY_ID,
    ALL_PARAMS: ALL_PARAMS,
    byKey: BY_KEY,
    keys: BASE.map(function (d) { return d.key; }),
    allKeys: ALL_PARAMS.map(function (d) { return d.key; }),
    modeOf: function () { return 'real'; },
    normalizeModules: normalizeModules,
    paramsFor: paramsFor,
    defaults: defaults,
    normalize: normalize,
    toUnit: toUnit,
    fromUnit: fromUnit,
    distance: distance,
    isDefault: isDefault,
    formatValue: formatValue
  };
});
