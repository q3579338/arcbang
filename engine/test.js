/*
 * 镜像宇宙引擎 · 测试
 * 运行：node engine/test.js
 */
'use strict';
var path = require('path');
var fs = require('fs');
var os = require('os');
var Engine = require('./engine.js');
var P = Engine.Params;

var passed = 0, failed = 0, failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; failures.push(msg); console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + '（得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b) + '）'); }
function between(x, lo, hi, msg) { ok(typeof x === 'number' && x >= lo && x <= hi, msg + '（得到 ' + (typeof x === 'number' ? x.toPrecision(4) : x) + '，期望 ' + lo + '–' + hi + '）'); }
function within(x, target, relTol, msg) { ok(typeof x === 'number' && Math.abs(x - target) <= relTol * Math.abs(target), msg + '（得到 ' + (typeof x === 'number' ? x.toPrecision(5) : x) + '，目标 ' + target + ' ±' + (relTol * 100) + '%）'); }
function section(t) { console.log('\n== ' + t); }
function sim(p, o) { return Engine.simulate(p, Object.assign({ register: false }, o || {})); }
function finding(r, id) { for (var i = 0; i < r.findings.length; i++) if (r.findings[i].id === id) return r.findings[i]; return null; }

// ------------------------------------------------------------
section('参数表：公认的基础参数 + 默认关闭的模块');
// 21 而不是 20：加了 gNewton（引力耦合倍率）。
// 原来 α_G 只由质子质量平方决定，G 没有独立入口 —— 那正是"G/c/h/e 四个常数
// 不可能都变"的技术根源。补上它之后四个常数才各自独立。
eq(P.BASE.length, 21, '基础参数 21 个（PDG/Planck 公认 + 引力耦合 gNewton）');
ok(P.BASE.every(function (d) { return d.status === 'accepted' || d.status === 'accepted-fact, no-mechanism'; }), '基础参数 status 全为 accepted / accepted-fact');
ok(P.BASE.filter(function (d) { return d.status === 'accepted-fact, no-mechanism'; }).map(function (d) { return d.key; }).join() === 'dimS', '只有 dimS 是 accepted-fact, no-mechanism');
ok(P.BASE.every(function (d) { return typeof d.ref === 'string' && d.ref.length > 5 && typeof d.si === 'string'; }), '每个基础参数都有 ref 与 si（出处）');
ok(['stringGasT', 'windingDensity', 'inflatonScale', 'stringCoupling', 'flux1', 'bareLambda'].every(function (k) { return P.keys.indexOf(k) < 0; }), '基础参数表（BASE）里没有任何推测性参数');
eq(P.MODULES.length, 4, '四个模块：stringGas / slowRoll / landscape / altBiochem');
ok(P.MODULES.every(function (m) { return m.status === 'speculative' || m.status === 'mainstream-model'; }), '模块 status 为 speculative / mainstream-model');
ok(P.MODULES.every(function (m) { return m.params.every(function (d) { return d.status === m.status && d.module === m.id && typeof d.ref === 'string'; }); }), '模块参数带 status/module/ref');
eq(JSON.stringify(P.normalizeModules()), JSON.stringify({ stringGas: true, slowRoll: false, landscape: false, altBiochem: false }), '默认模块：stringGas 开，其余关');
eq(JSON.stringify(P.normalizeModules({ stringGas: false })), JSON.stringify({ stringGas: false, slowRoll: false, landscape: false, altBiochem: false }), '显式 stringGas:false 可关闭');
eq(P.paramsFor({ stringGas: false }).length, 21, 'paramsFor(全关) = 21 个基础参数');
var pf = P.paramsFor().map(function (d) { return d.key; });
ok(pf.indexOf('dimS') < 0 && pf.indexOf('stringGasT') >= 0 && pf.indexOf('windingDensity') >= 0 && pf.indexOf('compactStiffness') >= 0 && pf.length === 23, 'paramsFor(默认=stringGas 开)：去掉 dimS，加入 T₀/T_H、n_w、κ（23 个）');
var pf2 = P.paramsFor({ slowRoll: true }).map(function (d) { return d.key; });
ok(pf2.indexOf('As') < 0 && pf2.indexOf('ns') < 0 && pf2.indexOf('omegaK') < 0 && pf2.indexOf('inflatonScale') >= 0, 'paramsFor(slowRoll)：A_s、n_s、Ω_k 被派生');
var pf3 = P.paramsFor({ landscape: true }).map(function (d) { return d.key; });
ok(pf3.indexOf('alpha') < 0 && pf3.indexOf('omegaLambda') < 0 && pf3.indexOf('mUp') < 0 && pf3.indexOf('flux1') >= 0, 'paramsFor(landscape)：α、Λ、夸克质量被派生');
ok(P.isDefault(P.defaults()), 'defaults() 即我们的宇宙');
ok(P.isDefault(P.defaults({ stringGas: false }), { stringGas: false }), '关闭弦气模块的默认参数也是我们的宇宙');
var n = P.normalize({ alpha: 5, generations: 2.6, foo: 1 });
ok(n.alpha === 0.5 && n.generations === 3 && n.foo === undefined && n.As === 2.1e-9, 'normalize 夹范围、整数取整、补默认、丢弃未知键');
eq(P.distance(P.defaults()), 0, '默认参数与我们的距离为 0');
ok(P.distance({ alpha: 0.5 }) > 0 && P.distance({ alpha: 0.5 }) <= 100, '单参数偏离距离 ∈ (0,100]');
ok(Engine.PARAMS === P.BASE && Engine.MODULES === P.MODULES && Engine.PARAMS_FOR === P.paramsFor, 'Engine.PARAMS / MODULES / PARAMS_FOR');

// ------------------------------------------------------------
section('工具');
eq(Engine.formatTime(13.8), '138 亿年', 'formatTime 13.8 Gyr');
eq(Engine.formatTime(3.8e-4), '38 万年', 'formatTime 380 kyr');
eq(Engine.formatTime(1e5), '10¹⁴ 年', 'formatTime 1e14 年');
eq(Engine.cnNumber(2.5), '二点五', 'cnNumber 2.5');
eq(Engine.cnInt(137), '一百三十七', 'cnInt 137');
eq(Engine.formatId(7), '#0007', 'formatId');
ok(Math.abs(Engine.erfc(0) - 1) < 1e-6 && Engine.erfc(3) < 1e-4, 'erfc');

// ------------------------------------------------------------
section('第 1 层：公认的派生常数（默认 → 目标值误差 <1%）');
var DC = Engine.deriveConstants({}, { stringGas: false });
var c = DC.c;
within(c.alpha, 1 / 137.035999084, 1e-9, 'α 直接输入（CODATA 2018）');
within(c.lambdaQCD, 87.3, 0.02, 'Λ_QCD（一环 n_f=5）≈ 87 MeV');
within(c.protonMass, 938.272, 1e-6, 'm_p = 938.272 MeV');
within(c.alphaG, 1, 1e-6, 'α_G 相对值 = 1');
within(c.meOverMp, 1, 1e-4, 'mₑ/mₚ 相对值 = 1（1/1836）');
within(c.mnMinusMp, 1.29333, 1e-6, 'm_n−m_p = 1.293 MeV（BMW 2015 分解，线性化于观测值）');
within(c.alphaS, 1, 1e-6, '核力强度相对值 = 1');
within(c.higgsVev, 1, 1e-6, 'v/v₀ = 1');
within(c.GF, 1.1664e-5, 0.002, 'G_F = 1.166×10⁻⁵ GeV⁻²');
within(c.lambdaH, 0.1294, 0.005, 'λ_H = 0.129');
within(c.omegaR, 9.1e-5, 0.03, 'Ω_r ≈ 9.1×10⁻⁵');
within(c.omegaB, 0.0492, 0.005, 'Ω_b = 0.049');
within(c.omegaC, 0.264, 0.005, 'Ω_c = 0.264');
within(c.eta10, 6.13, 0.005, 'η₁₀ = 6.13');
within(c.Q, 1.833e-5, 0.005, 'Q = (2/5)√A_s = 1.83×10⁻⁵');
eq(c.dimS, 3, 'D = 3');
ok(DC.derivedOrder.length >= 12 && DC.derivedOrder.every(function (k) { var d = DC.derived[k]; return d && d.key === k && typeof d.formula === 'string' && typeof d.ref === 'string' && ['computed', 'scaling', 'toy'].indexOf(d.basis) >= 0 && ['accepted', 'accepted (scheme-dependent)', 'accepted (convention-dependent)', 'accepted-fact, no-mechanism', 'mainstream-model', 'speculative'].indexOf(d.status) >= 0 && Array.isArray(d.inputs); }), 'derived[key] = {value, name, symbol, basis, status, formula, inputs[], ref, text}');
eq(DC.derived.lambdaQCD.status, 'accepted (scheme-dependent)', 'Λ_QCD 标 scheme-dependent（固定 n_f=5 一环）');
ok(DC.derived.protonMass.basis === 'scaling' && DC.derived.mnMinusMp.basis === 'scaling' && DC.derived.alphaS.basis === 'scaling', 'm_p / m_n−m_p / 核力强度 basis=scaling');
var dEta = Engine.deriveConstants({ tcmb: 5.451 }).c.eta10;
within(dEta, c.eta10 / 8, 1e-6, 'T_CMB×2 → η₁₀ 变为 1/8（η ∝ Ω_bh²/T³）');
ok(Object.keys(DC.derived).every(function (k) { return DC.derived[k].status !== 'speculative' && DC.derived[k].status !== 'mainstream-model'; }), '全关配置下没有任何 speculative / mainstream-model 派生');
// 有量纲常数（单位约定）
eq(Object.keys(Engine.UNIT_CONVENTIONS).join(','), 'A,B,C', 'Engine.UNIT_CONVENTIONS = A/B/C');
ok(Engine.UNIT_CONVENTIONS.A.fixed.join(',') === 'e,hbar,m_p' && Engine.UNIT_CONVENTIONS.A.varies.join(',') === 'c,G' && Engine.UNIT_CONVENTIONS.A.isDefault === true, '约定 A：固定 e/ħ/m_p，变 c/G（默认）');
ok(Engine.UNIT_CONVENTIONS.B.fixed.join(',') === 'c,e,m_p' && Engine.UNIT_CONVENTIONS.C.fixed.join(',') === 'c,hbar,m_p', '约定 B 固定 c/e/m_p；约定 C 固定 c/ħ/m_p');
ok(/Albrecht & Magueijo 1999/.test(Engine.UNIT_CONVENTIONS.A.ref) && /Duff 2002/.test(Engine.UNIT_CONVENTIONS.A.ref), '约定 A 引 Albrecht & Magueijo 1999 与 Duff 2002');
eq(DC.derived.cSI.value, 299792458, '我们的宇宙精确复现 c=299792458 m/s');
eq(DC.derived.GSI.value, 6.6743e-11, '……G=6.6743×10⁻¹¹ m³·kg⁻¹·s⁻²');
eq(DC.derived.hbarSI.value, 1.054571817e-34, '……ħ=1.054571817×10⁻³⁴ J·s');
eq(DC.derived.eSI.value, 1.602176634e-19, '……e=1.602176634×10⁻¹⁹ C');
ok(DC.derived.cSI.status === 'accepted (convention-dependent)' && DC.derived.cSI.convention === 'A' && DC.derived.cSI.unit === 'm/s' && /约定 A/.test(DC.derived.cSI.text), 'derived.cSI：{value, unit, basis, status, convention, formula, text}');
ok(DC.derived.hbarSI.fixedInConvention === true && DC.derived.cSI.fixedInConvention === false, '……约定 A 下 ħ 标记为固定、c 为可变');
var oursSim = Engine.simulate({}, { register: false });
var dfA = Engine.dimensionfulConstants(oursSim, 'A'), dfB = Engine.dimensionfulConstants(oursSim, 'B'), dfC = Engine.dimensionfulConstants(oursSim, 'C');
ok(dfA.si.c === SIc() && dfB.si.c === SIc() && dfC.si.c === SIc() && dfB.si.hbar === 1.054571817e-34 && dfC.si.e === 1.602176634e-19, '我们的宇宙：三种约定给出同样的 SI 数值（比值皆为 1）');
function SIc() { return 299792458; }
var a200 = sim({ alpha: 1 / 200 });
var cA = Engine.dimensionfulConstants(a200, 'A'), cB = Engine.dimensionfulConstants(a200, 'B'), cC = Engine.dimensionfulConstants(a200, 'C');
within(cA.si.c / 299792458, 200 / 137.035999084, 1e-9, 'α=1/200 约定 A：c/c₀ = α₀/α');
ok(cA.si.hbar === 1.054571817e-34 && cA.si.e === 1.602176634e-19, '……约定 A 下 ħ、e 不变');
within(cB.si.hbar / 1.054571817e-34, 200 / 137.035999084, 1e-9, '……约定 B：ħ/ħ₀ = α₀/α，c 不变');
ok(cB.si.c === 299792458, '……约定 B 下 c 不变');
within(cC.si.e / 1.602176634e-19, Math.sqrt(137.035999084 / 200), 1e-9, '……约定 C：e/e₀ = √(α/α₀)');
within(cA.si.G / cB.si.G, 1, 1e-12, '……A 与 B 给出相同的 G（都 ∝ ħc）');
within(cC.si.G / 6.6743e-11, 1, 1e-12, '……约定 C 下 G 不随 α 变（α_G 未变）');
within(Engine.dimensionfulSI(1, 1, 'A').si.G, 6.6743e-11, 1e-12, 'dimensionfulSI(1,1) 复现 G₀');
var gG = sim({ alphaSMZ: 0.121 });
within(gG.derived.GSI.value / 6.6743e-11, gG.constants.alphaG, 2e-3, 'α_G↑（αₛ(M_Z)=0.121）→ G ∝ α_G（约定 A，ħc 不变）');
ok(/单位约定 A/.test(oursSim.constantsReport.sentence) && /光速 299792458 m\/s/.test(oursSim.constantsReport.sentence) && /引力常数 6.6743×10⁻¹¹/.test(oursSim.constantsReport.sentence) && /普朗克常数 1.0546×10⁻³⁴ J·s/.test(oursSim.constantsReport.sentence), 'constantsReport.sentence 含"光速 X m/s，引力常数 Y，普朗克常数 Z（单位约定 A）"');
ok(oursSim.dimensionful && oursSim.dimensionful.convention === 'A' && oursSim.dimensionful.entries.cSI.value === 299792458 && /Duff 2002/.test(oursSim.dimensionful.ref), 'result.dimensionful（默认约定 A，含 ref）');
var DCd = Engine.deriveConstants({});
ok(DCd.derived.dimS.status === 'speculative' && DCd.c.dimS === 3 && Object.keys(DCd.derived).every(function (k) { return k === 'dimS' || DCd.derived[k].status !== 'speculative'; }), '默认（stringGas 开）只有 dimS 一项 speculative，且 D=3.000');
var DC2 = Engine.deriveConstants({ alphaSMZ: 0.125 });
ok(DC2.c.lambdaQCD > c.lambdaQCD * 1.4 && DC2.c.protonMass > 1300 && DC2.c.alphaG > 2, 'αₛ(M_Z)↑ → Λ_QCD 指数增大 → m_p、α_G↑（' + DC2.c.lambdaQCD.toFixed(1) + ' MeV，α_G×' + DC2.c.alphaG.toFixed(2) + '）');
ok(DC2.c.alphaS < 0.9, '……π 介子更重 → 核力强度 <0.9（' + DC2.c.alphaS.toFixed(3) + '）');
eq(JSON.stringify(Engine.deriveConstants({ tcmb: 3 }).c), JSON.stringify(Engine.deriveConstants({ tcmb: 3 }).c), '派生确定性');

// ------------------------------------------------------------
section('模块派生（开启时才出现，带 status）');
var sg = Engine.deriveConstants({}, { stringGas: true });
eq(sg.c.dimS, 3, '开启弦气模块，默认参数 → D=3.000（3 维饱和解开、其余饱和蜷缩）');
eq(sg.derived.dimS.status, 'speculative', '……dimS 派生 status=speculative');
// epsilons 有 18 项：维序阶梯从 9 级加密到 18 级（见 engine.js 的 SG_G）。
// 加密的目的是让 P(D=3) 降到 3% 左右 —— 那道坎越窄，三维越稀缺。
ok(Array.isArray(sg.derived.dimS.epsilons) && sg.derived.dimS.epsilons.length === 18 && Array.isArray(sg.derived.dimS.s) && typeof sg.derived.dimS.w === 'number' && sg.derived.dimS.fractional === false, '……derived.dimS 含 epsilons、s_i、w、fractional（18 级阶梯）');
ok(sg.derived.dimS.s.slice(0, 3).every(function (x) { return x === 1; }) && sg.derived.dimS.s.slice(3).every(function (x) { return x === 0; }), '……默认 s=前 3 个 1、其余 0（饱和）');
// 断言的原意是"更热 → 解开的维度明显多于 3"，这一点没变；
// 变的是落点：18 级阶梯下 T=1.2 给 D=12（9 级时是 3.5–9）。带子跟着阶梯走。
between(Engine.deriveConstants({ stringGasT: 1.2 }, { stringGas: true }).c.dimS, 4, 18, 'T₀/T_H=1.2 → 解开 >3 维（D 在 4–18）');
ok(Engine.deriveConstants({ windingDensity: 8 }, { stringGas: true }).c.dimS <= 2, '缠绕密度 8 → D ≤ 2');
ok(Engine.deriveConstants({ compactStiffness: 1, stringGasT: 1.2 }, { stringGas: true }).derived.dimS.fractional === false, 'κ=1（硬阈值）→ D 恒为整数');
/* D 已经量化成 {整数, 整数+0.5}，所以"分数维"现在特指**半整数**。
   κ=0 加 T=1.05 在新阶梯下正好落在整数上，换一组真的落在半整数的参数。
   断言的原意不变：过渡带够宽时会出现解不开也蜷不回的"半开"维度。 */
/* 参数这已经是第二次重挑：上次是维序阶梯 9 级换 18 级，这次是半开带宽从 ±0.25
   收成 ±0.02（见 engine.js 的 SG_HALF_BAND）。窄带之后落在半整数上的参数区间很窄，
   κ=0 / T=1.0402 是扫出来邻域最宽的一组（稳定区间 [1.0385, 1.0420]）。
   改阶梯或改带宽都要重扫 —— 断言的原意从来没变，变的只是参数。 */
var sgHalf = Engine.deriveConstants({ compactStiffness: 0, stringGasT: 1.0402 }, { stringGas: true });
ok(sgHalf.derived.dimS.fractional === true && Math.abs(sgHalf.c.dimS * 2 - Math.round(sgHalf.c.dimS * 2)) < 1e-9,
   '宽过渡带 → 半整数维（D=' + sgHalf.c.dimS + '）');
var stats = Engine.dimensionStatistics(20000, 20240816);
between(stats.pExact3, 1 / 40, 1 / 20, '蒙特卡洛 20000 次：P(D 恰好=3) ∈ [1/40, 1/20]（目标 1/30）');
ok(stats.pInteger > 0.05 && stats.pFractional > 0.05, '……整数维与非整数维概率都非零（整数 ' + stats.pInteger.toFixed(3) + '，非整数 ' + stats.pFractional.toFixed(3) + '）');
ok(stats.pBelow3 > 0 && stats.p3to4 > 0 && stats.pAtLeast4 > 0, '……D<3 / 3–4 / ≥4 都有分布（' + stats.pBelow3.toFixed(3) + ' / ' + stats.p3to4.toFixed(3) + ' / ' + stats.pAtLeast4.toFixed(3) + '）');
console.log('    D 直方图（floor(D)→计数）：' + JSON.stringify(stats.histogram));
var sr = Engine.deriveConstants({}, { slowRoll: true });
within(sr.c.As, 2.1e-9, 0.01, '开启慢滚模块，默认参数复现 A_s=2.1×10⁻⁹');
within(sr.c.ns, 0.965, 1e-6, '……复现 n_s=0.965');
eq(sr.c.omegaK, 0, '……Ω_k=0');
eq(sr.derived.As.status, 'mainstream-model', '……A_s 派生 status=mainstream-model，basis=computed');
eq(sr.derived.As.basis, 'computed', '……basis=computed');
var sr2 = Engine.deriveConstants({ slowRollEpsilon: 0.01, slowRollEta: 0 }, { slowRoll: true });
within(sr2.c.ns, 0.94, 1e-6, 'ε=0.01, η=0 → n_s=1−6ε=0.94');
var ls = Engine.deriveConstants({}, { landscape: true });
within(ls.c.alpha, 1 / 137.036, 1e-6, '开启景观模块，默认参数复现 α');
within(ls.c.electronMassMeV, 0.51099895, 1e-6, '……复现 mₑ');
within(ls.c.mUp, 2.16, 1e-6, '……复现 m_u');
within(ls.c.omegaLambda, 0.685, 0.005, '……通量与裸真空能抵消复现 Ω_Λ=0.685');
eq(ls.derived.omegaLambda.status, 'speculative', '……Λ 派生 status=speculative');
var ls2 = Engine.deriveConstants({ flux3: 2 }, { landscape: true });
ok(ls2.c.omegaLambda > 100, '通量 n₃=1→2 → Ω_Λ 跳到 ~300（' + ls2.c.omegaLambda.toFixed(0) + '）');

// ------------------------------------------------------------
section('我们的宇宙（默认，全部模块关闭）· 数值合理性');
var ours = Engine.simulate({});
eq(ours.outcome.id, 'OBSERVERS_POSSIBLE', '默认参数 → 可能诞生观察者');
eq(ours.id, 1207, '我们的宇宙编号 1207');
eq(ours.idLabel, '#1207', '编号标签 #1207');
ok(ours.isOurUniverse, 'isOurUniverse');
eq(JSON.stringify(ours.modules), JSON.stringify({ stringGas: true, slowRoll: false, landscape: false, altBiochem: false }), 'result.modules：stringGas 默认开');
ok(ours.habitability >= 0.8, '可居住性 ≥ 0.8（' + ours.habitability.toFixed(2) + '）');
between(ours.calc.expansion.ageGyr, 13.0, 14.5, 'a=1 年龄 ≈ 13.8 Gyr');
between(ours.calc.expansion.H0eff, 66, 69, 'H(a=1) ≈ 67.4 km/s/Mpc');
between(ours.calc.expansion.zEq, 3000, 3800, 'z_eq ≈ 3400');
between(ours.calc.recombination.zRec, 1300, 1450, 'z_rec（Saha x_e=½）≈ 1380');
between(ours.calc.recombination.zDec, 1050, 1250, '去耦（Saha x_e=0.01）≈ 1140（Peebles/Planck 1090）');
between(ours.calc.bbn.Yp, 0.24, 0.26, 'Y_p ≈ 0.245–0.25');
between(ours.calc.bbn.deltaMeV, 1.2, 1.4, 'm_n−m_p ≈ 1.29 MeV');
within(ours.calc.bbn.tauN, 878.4, 1e-6, 'τ_n = 878.4 s（PDG 2022）');
between(ours.calc.structure.sigma8, 0.6, 1.0, 'σ₈ 等价量 ≈ 0.8');
between(ours.calc.structure.first.z, 12, 25, '第一批天体 z ≈ 15–20');
between(ours.calc.structure.gal.z, 1, 4, '星系尺度（2σ，10¹² M⊙）坍缩 z ≈ 1–3');
between(ours.calc.stars.tMSGyr, 9, 11, '太阳质量恒星寿命 ≈ 10 Gyr');
between(ours.calc.stars.Mmin, 0.07, 0.09, 'M_min ≈ 0.08 M⊙');
eq(ours.fate.type, 'eternal', '永恒膨胀');
ok(ours.findings.every(function (f) { return f.verdict === 'ok'; }), '所有判定都是 ok');
ok(ours.findings.every(function (f) { return ['computed', 'scaling', 'heuristic'].indexOf(f.basis) >= 0 && typeof f.formula === 'string' && f.formula.length > 5 && typeof f.ref === 'string' && f.ref.length > 3 && f.inputs && 'value' in f && typeof f.verdict === 'string'; }), '每条 finding 都有 basis/formula/inputs/value/threshold/verdict/ref');
ok(!!finding(ours, 'R_DIM_EMERGE') && !finding(ours, 'R_DIM_INPUT') && !finding(ours, 'R_DIM_FRACTAL'), '默认（stringGas 开）D=3.000 由弦气涌现，无分数维条目');
ok(!!finding(sim({}, { modules: { stringGas: false } }), 'R_DIM_INPUT'), '关闭弦气模块 → D 为直接输入');
// BIOCHEM
ok(finding(ours, 'R_HOYLE').verdict === 'ok' && Math.abs(ours.calc.biochem.fC - 1) < 1e-9 && Math.abs(ours.calc.biochem.fO - 1) < 1e-9, 'R_HOYLE：默认 ξ=0，碳/氧产率 ×1');
ok(finding(ours, 'R_WATER').verdict === 'ok' && /液态水：是/.test(finding(ours, 'R_WATER').valueText) && Math.abs(ours.calc.biochem.dWater - 1) < 1e-6, 'R_WATER：液态水窗口存在（d_w=1 AU）');
ok(finding(ours, 'R_COMPLEX_CHEM').verdict === 'ok' && ours.calc.biochem.elements.join(' ') === 'H C N O Si P S Fe', 'R_COMPLEX_CHEM：可用元素 H C N O Si P S Fe');
ok(finding(ours, 'R_BIOCHEM_CARBON').verdict === 'ok' && /→ 可能/.test(finding(ours, 'R_BIOCHEM_CARBON').valueText) && ours.calc.biochem.carbonWater === true, 'R_BIOCHEM_CARBON：原料✓ 溶剂✓ 复杂化学✓ → 可能');
ok(/碳与氧由三氦过程产出/.test(ours.report) && /碳-水型生化可能/.test(ours.report), '报告含生物化学基础摘要');
ok(!finding(ours, 'R_ALT_BIOCHEM'), '默认关闭替代生化模块（无 R_ALT_BIOCHEM）');
ok(ours.timeline.every(function (e) { return e.happens; }), '时间线各纪元全部发生');
ok(ours.report.indexOf('这是我们的宇宙') >= 0 && ours.report.indexOf('精细结构常数是一百三十七分之一') >= 0, '报告含核对句与"这是我们的宇宙"');
ok(ours.cosmology.series && ours.cosmology.series.a.length > 50, '输出 a(t) 序列');
eq(ours.distance, 0, '距离 0');
ok(ours.constants && ours.constants.alpha === 1 / 137.035999084 && ours.derived && ours.derivedOrder.length > 10, 'result.constants / derived / derivedOrder');
ok(ours.constantsReport && /一百三十七分之一/.test(ours.constantsReport.sentence), 'result.constantsReport');

// ------------------------------------------------------------
section('参数扫描 → 结局');
var r;
r = sim({ omegaCh2: 1.226, omegaK: -2, omegaLambda: 0 });
eq(r.outcome.id, 'BIG_CRUNCH', 'Ω_m≈2.75、Ω_k=−2 → 大挤压');
eq(r.fate.type, 'crunch', '……fate=crunch');
r = sim({ omegaLambda: -1 });
eq(r.outcome.id, 'BIG_CRUNCH', 'Ω_Λ=−1 → 反德西特坍缩');
r = sim({ omegaLambda: 300 });
eq(r.outcome.id, 'HEAT_DEATH_NO_STRUCTURE', 'Ω_Λ=300 → 无结构');
eq(finding(r, 'R_WEINBERG').verdict, 'fail', '……Weinberg 上界判定 fail');
r = sim({ As: 1.6e-12 });
eq(r.outcome.id, 'HEAT_DEATH_NO_STRUCTURE', 'A_s 极小 → 无结构');
r = sim({ As: 1e-4 });
eq(r.outcome.id, 'BLACK_HOLE_DOMINATED', 'A_s=10⁻⁴ → 黑洞主导');
r = sim({ As: 1e-4, ns: 1.2 });
ok(finding(r, 'R_PBH').value > 1e-20 && finding(r, 'R_PBH').verdict !== 'ok', 'A_s=10⁻⁴、n_s=1.2 → Carr 原初黑洞比例可观（β=' + Engine.sci(finding(r, 'R_PBH').value, 2) + '）');
r = sim({ mDown: 2.16 });
eq(r.outcome.id, 'NO_ATOMS', 'm_d=m_u → 质子衰变 → 无原子');
ok(finding(r, 'R_MNP').value < -0.5, '……m_n−m_p<−mₑ');
r = sim({ mDown: 3.2 });
eq(r.outcome.id, 'NO_CHEMISTRY', 'm_d=3.2 → 氢被电子俘获 → 无化学');
r = sim({ mDown: 9 });
eq(r.outcome.id, 'NO_STARS', 'm_d=9 → 氘核内 β 衰变 → 无恒星');
r = sim({ alpha: 0.4 });
eq(r.outcome.id, 'NO_ATOMS', 'α=0.4 → 无稳定原子');
r = sim({ alpha: 0.05 });
ok(finding(r, 'R_NUCLEI').value < 26, 'α=0.05 → Z_max,nuc<26');
r = sim({ alphaSMZ: 0.125 });
eq(r.outcome.id, 'NO_STARS', 'αₛ(M_Z)=0.125 → 氘核不束缚 → 无恒星');
r = sim({ alphaSMZ: 0.112 });
eq(r.outcome.id, 'NO_CHEMISTRY', 'αₛ(M_Z)=0.112 → 双质子束缚 → 无氢');
ok(r.calc.bbn.Yp > 0.9, '……Y_p→1');
r = sim({ ckmPhase: 0 });
eq(r.outcome.id, 'NO_ATOMS', 'δ_CKM=0 → 无重子');
// Hoyle 敏感性
r = sim({ alpha: 1.05 / 137.035999084 });
ok(r.outcome.id === 'NO_CARBON_CHEMISTRY' && r.calc.biochem.fC < 0.01 && finding(r, 'R_HOYLE').verdict === 'fail', 'α +5% → 碳产率 ×' + Engine.sci(r.calc.biochem.fC, 2) + ' → NO_CARBON_CHEMISTRY');
r = sim({ alphaSMZ: 0.11756 });
ok(Math.abs(r.constants.alphaS - 1.01) < 0.002 && r.outcome.id === 'NO_CARBON_CHEMISTRY' && r.calc.biochem.fO < 0.01, 'αₛ,nuc +1%（αₛ(M_Z)=0.11756）→ 氧产率 ×' + Engine.sci(r.calc.biochem.fO, 2) + ' → NO_CARBON_CHEMISTRY');
ok(finding(r, 'R_STAR_IGNITE').verdict === 'ok' && r.calc.atoms.chemistry === true, '……恒星与化学仍在（只是没有碳-水型生化）');
r = sim({ alpha: 1.05 / 137.035999084 }, { modules: { altBiochem: true } });
ok(!!finding(r, 'R_ALT_BIOCHEM') && finding(r, 'R_ALT_BIOCHEM').basis === 'heuristic' && /倾向：(低|中|高)/.test(finding(r, 'R_ALT_BIOCHEM').valueText) && /无公认判据/.test(finding(r, 'R_ALT_BIOCHEM').text) && /Bains 2004/.test(finding(r, 'R_ALT_BIOCHEM').ref), '替代生化模块开启 → R_ALT_BIOCHEM（heuristic，低/中/高，注明无公认判据）');
ok(r.outcome.id === 'NO_CARBON_CHEMISTRY' && r.calc.biochem.altTendency === '高', '……碳受抑 + Si 可用 → 倾向 高；主结局不变');
ok(Engine.simulate({}, { modules: { altBiochem: true }, register: false }).outcome.id === 'OBSERVERS_POSSIBLE', '模块开启不改变默认宇宙结局');
r = sim({ generations: 2 });
eq(r.outcome.id, 'NO_ATOMS', '两代粒子 → 无 CP 破坏 → 无重子');
r = sim({ omegaBh2: 0 });
eq(r.outcome.id, 'NO_ATOMS', 'Ω_bh²=0 → 无重子');
r = sim({ sumNu: 3 });
eq(r.outcome.id, 'HEAT_DEATH_NO_STRUCTURE', 'Σm_ν=3 eV → 结构被抹平');
r = sim({ higgsVev: 2462 });
eq(r.outcome.id, 'STARS_NO_LIFE', 'v=10 v₀ → 超新星哑火 → 有恒星无生命');
r = sim({ electronMass: 2.6 });
ok(r.outcome.id === 'NO_CHEMISTRY', 'mₑ×5 → 电子俘获 → 无化学（' + r.outcome.id + '）');
r = sim({ generations: 6 });
ok(r.calc.bbn.Yp > ours.calc.bbn.Yp, '六代粒子 → N_eff↑ → Y_p 上升');
r = sim({ omegaBh2: 0.1 });
ok(r.calc.bbn.Yp > ours.calc.bbn.Yp && r.calc.recombination.zRec > ours.calc.recombination.zRec, 'Ω_bh²↑ → η↑ → Y_p↑、z_rec↑');
r = sim({ higgsVev: 740 });
ok(r.calc.bbn.Tf > ours.calc.bbn.Tf && r.calc.bbn.tauN > ours.calc.bbn.tauN, 'v↑ → G_F↓ → T_f↑、τ_n↑');
r = sim({ H0: 73 });
ok(r.calc.expansion.ageGyr < ours.calc.expansion.ageGyr && r.calc.expansion.H0eff > 70, 'H₀=73 → 年龄更短，H(a=1)>70（Ω 由物理密度换算，闭合和 ≠1 时略低于 73）');
r = sim({ tcmb: 5 });
ok(r.calc.expansion.zEq < ours.calc.expansion.zEq && r.calc.recombination.zRec < ours.calc.recombination.zRec && r.calc.bbn.eta10 < ours.calc.bbn.eta10 / 5, 'T_CMB↑ → Ω_r↑ z_eq↓，η↓，z_rec↓');
ok(/Adams 2008/.test(finding(ours, 'R_STAR_MASS').ref) && /eq\. 1\/35\/39/.test(finding(ours, 'R_STAR_MASS').ref) && /窗口宽度/.test(finding(ours, 'R_STAR_MASS').text), 'R_STAR_MASS 引 Adams 2008 eq.1/35/39，说明窗口宽度由 α 与质量比控制');
var rG = sim({ alphaSMZ: 0.121 });
var stG = rG.calc.stars, aGr = stG.alphaGRel, ratioPred = 1250 * Math.pow(rG.constants.alpha / Engine.constants.ALPHA0, -1.5) * Math.pow(rG.constants.meOverMp, 0.75);
ok(aGr > 1.3 && Math.abs(stG.Mmax * Math.pow(aGr, 1.5) - 100) < 1e-6 && Math.abs(stG.Mmax / stG.Mmin - ratioPred) / ratioPred < 1e-6, 'α_G↑（αₛ(M_Z)=0.121，α_G×' + aGr.toFixed(2) + '）：M_max=100M⊙·α_G^{−3/2}，M_max/M_min 只随 α、mₑ/mₚ 变（Adams eq.35/39）');
var OFF = { modules: { stringGas: false } };
r = sim({ dimS: 4 }, OFF);
ok(r.outcome.id === 'UNSTABLE_ORBITS' && finding(r, 'R_DIM').verdict === 'fail', 'D=4（直接输入）→ 无稳定轨道/原子基态（fail）');
r = sim({ dimS: 6 }, OFF);
eq(r.outcome.id, 'UNSTABLE_ORBITS', 'D=6 → 无稳定轨道');
r = sim({ dimS: 2 }, OFF);
ok(r.outcome.id === 'UNSTABLE_ORBITS' && /牛顿吸引/.test(r.outcome.reasons[0]), 'D=2 → 无牛顿吸引（fail）');
r = sim({ dimS: 3.7 }, OFF);
eq(r.outcome.id, 'BEYOND_MODEL_DIM', 'D=3.7 → BEYOND_MODEL_DIM（3 维公式外推）');
ok(finding(r, 'R_DIM').verdict === 'warn' && finding(r, 'R_DIM').basis === 'scaling' && /进动/.test(finding(r, 'R_DIM').text) && !!finding(r, 'R_DIM_UNCORRECTED'), '……R_DIM 保留 Ehrenfest/Tegmark 结论（进动、未做 D≠3 修正）');
ok(r.habitability === null && r.canEnterMirror === false && r.outcome.observers === false && r.outcome.beyondModel === true, '……habitability=null、canEnterMirror=false、observers=false');
ok(/只对 3 维空间成立/.test(r.report) && /外推到 D=3\.70/.test(r.report) && /不构成/.test(r.report), '……报告首句声明 3 维公式外推、不构成观察者判断');
r = sim({ dimS: 2.5 }, OFF);
ok(r.outcome.id === 'BEYOND_MODEL_DIM' && finding(r, 'R_DIM').verdict === 'warn' && !!finding(r, 'R_DIM_FRACTAL') && finding(r, 'R_DIM_FRACTAL').basis === 'heuristic' && r.habitability === null, 'D=2.5 → BEYOND_MODEL_DIM + 分数维 finding，habitability=null');
ok(ours.habitability === 1 && ours.canEnterMirror === true && ours.outcome.beyondModel === false, 'D=3 完全不变：habitability=1、canEnterMirror=true');
r = sim({ stringGasT: 1.2 }, { modules: { stringGas: true } });
ok(r.outcome.id === 'UNSTABLE_ORBITS' && !!finding(r, 'R_DIM_EMERGE') && r.derived.dimS.epsilons.length === 18, '弦气模块 T₀/T_H=1.2 → 涌现 D>4 → 无稳定轨道，含 R_DIM_EMERGE');
// 0.9362 是按旧的 9 级维序阶梯选的，18 级下它给 D=2（整数），不再是"二点五维"。
// 0.97 才落在 2.5 上，与 engine.js 里 sg_fractal 预设保持同值。
/* 这个数跟 engine.js 的 sg_fractal 预设**必须同值** —— 它们说的是同一件事。
     历史：9 级阶梯时代是 0.9362，18 级要 0.97，半开带宽收成 ±0.02 之后要 0.9703
     且 κ 必须显式给 0.1（默认 0.9 下无解）。 */
  r = sim({ stringGasT: 0.9703, compactStiffness: 0.1 }, { modules: { stringGas: true } });
ok(Math.abs(r.constants.dimS - Math.round(r.constants.dimS)) > 0.05 && !!finding(r, 'R_DIM_FRACTAL') && r.outcome.id === 'BEYOND_MODEL_DIM' && r.canEnterMirror === false, '弦气模块二点五维 → 非整数 D、分数维结论、BEYOND_MODEL_DIM、canEnterMirror=false');
r = sim({ dimS: 4 }, OFF);
ok(r.outcome.id === 'UNSTABLE_ORBITS' && r.habitability === null && r.canEnterMirror === false, 'D=4 仍以 UNSTABLE_ORBITS 为主结局，且 habitability=null、canEnterMirror=false');
ok(!/原文|白冰|镜子|无法观察|很少见|星海|这台机器/.test(JSON.stringify(Engine.presets) + sim({ dimS: 6 }, OFF).report + sim({}).report + sim({ dimS: 3.7 }, OFF).report), '报告与预设文案不引用小说');

// ------------------------------------------------------------
section('决定论');
var h1 = Engine.hashParams({}), h2 = Engine.hashParams(P.defaults()), h3 = Engine.hashParams({ As: 3e-9 });
ok(h1 === h2 && h1 !== h3, '同参数同哈希，不同参数不同哈希');
ok(Engine.hashParams({}, { slowRoll: true }) !== h1 && Engine.hashParams({}, { stringGas: false }) !== h1, '模块状态进入哈希');
eq(sim({}).hash, sim({}).hash, '两次模拟哈希一致');
var nbA = Engine.createNBody({ As: 3e-9 }, { N: 900, mesh: 24 }), nbB = Engine.createNBody({ As: 3e-9 }, { N: 900, mesh: 24 });
for (var i = 0; i < 40; i++) { nbA.step(nbA.suggestDt()); nbB.step(nbB.suggestDt()); }
ok(nbA.px[123] === nbB.px[123] && nbA.py[777] === nbB.py[777] && nbA.a === nbB.a, '同参数两次 N 体演化逐位相同');
eq(nbA.seed, Engine.hashParams({ As: 3e-9 }), 'N 体种子 = 参数哈希');

// ------------------------------------------------------------
section('N 体（PM 引力）');
function runNB(p, o) { var nb = Engine.createNBody(p, Object.assign({ N: 1600, mesh: 32 }, o || {})); var k = 0; while (!nb.ended && k < 20000) { nb.step(nb.suggestDt()); k++; } return nb; }
var nb = runNB({});
eq(nb.N, 1600, 'N 取平方数');
ok(nb.positions.length === 2 * nb.N && nb.density.length === 32 * 32, 'positions / density 数组尺寸');
ok(nb.endReason === 'age' && nb.clumpiness().clusters > 3, '默认宇宙：跑到年龄上限并形成团块（clusters=' + nb.clumpiness().clusters + '）');
nb = runNB({ As: 1e-13 });
ok(nb.clumpiness().clusters === 0, 'A_s=10⁻¹³：几乎均匀，无团块');
nb = runNB(Engine.getPreset('crunch'));
eq(nb.endReason, 'crunch', '大挤压预设：N 体背景走到大挤压');
ok(isFinite(nb.px[0]) && isFinite(nb.density[0]), '数值有限（无 NaN）');
var nb1 = Engine.createNBody({}, { N: 400, mesh: 16, aStart: 0.05 }); nb1.step(0.0006);
ok(Math.abs(nb1.gravityCoupling - 1.5 * nb1.background.OmM / Math.pow(0.05, 3)) < 1e-6 * nb1.gravityCoupling, '引力耦合 = 1.5·Ω_m/a³');
// T 从 1.0476 重标：那个值是按 9 级阶梯选的，18 级下给不出 D=4
var nbm = Engine.createNBody({ stringGasT: 1.0, compactStiffness: 0.9 }, { modules: { stringGas: true }, N: 400, mesh: 16 });
ok(nbm.modules.stringGas === true && nbm.constants.dimS === 4, 'createNBody 支持 modules（弦气 D=4）');

// ------------------------------------------------------------
section('目录 Catalog');
var C = Engine.createCatalog({ storage: Engine.storage.Memory() });
eq(C.runs(), 0, '初始引爆次数 0');
var s1 = Engine.simulate({ As: 3e-9 }, { catalog: C });
eq(s1.id, 1, '第一次引爆编号 1');
eq(s1.idLabel, '#0001', '……标签 #0001');
var s2 = Engine.simulate({ As: 4e-9 }, { catalog: C });
eq(s2.id, 2, '第二次引爆编号 2');
var s3 = Engine.simulate({}, { catalog: C });
eq(s3.id, 1207, '我们的宇宙 → 1207');
eq(C.runs(), 3, '引爆计数 3');
var e1 = C.save(s1);
ok(e1.id === 1 && e1.outcome === s1.outcome.id && e1.hash === s1.hash && typeof e1.createdAt === 'string' && e1.modules && e1.modules.stringGas === true, 'save(simulate 结果) 保留 id/outcome/hash/createdAt/modules');
var e3 = C.save({ name: '备份的家', params: s3.params, outcome: s3.outcome });
eq(e3.id, 1207, 'save 我们的宇宙参数 → 1207');
var e4 = C.save({ name: '手工条目', params: { alpha: 0.01 } });
ok(e4.id > 2 && e4.id !== 1207, '无 id 的手工条目分配新号（' + e4.label + '）');
var e5 = C.save({ name: '直接输入条目', params: { dimS: 4 }, modules: { stringGas: false } });
ok(e5.modules.stringGas === false && e5.params.dimS === 4 && e5.params.stringGasT === undefined, '条目记录 modules 状态，参数按有效表归一化');
eq(C.list().length, 4, 'list 4 条');
eq(C.get(1207).name, '备份的家', 'get 1207');
ok(C.remove(e4.id) && C.list().length === 3 && !C.remove(9999), 'remove 成功/失败返回值');
var json = C.exportJSON(true);
var C2 = Engine.createCatalog({ storage: Engine.storage.Memory() });
eq(C2.importJSON(json), 3, 'importJSON 导入 3 条');
eq(JSON.stringify(C2.list()), JSON.stringify(C.list()), '导出→导入往返一致（含 modules）');
C2.importJSON({ entries: [{ id: 1, name: '覆盖', params: { As: 3e-9 } }] }, { merge: true });
eq(C2.get(1).name, '覆盖', 'merge 导入同 id 覆盖');
C2.importJSON({ entries: [] }, { merge: false });
eq(C2.list().length, 0, 'merge:false 替换为空');
var threw = false; try { C2.importJSON('{"nope":1}'); } catch (e) { threw = true; }
ok(threw, '无效 JSON 抛错');
var tmp = path.join(os.tmpdir(), 'mirror-catalog-test-' + process.pid + '.json');
var CF = Engine.createCatalog({ storage: Engine.storage.File(tmp) });
CF.save({ name: '文件条目', params: { As: 1e-8 } });
var CF2 = Engine.createCatalog({ storage: Engine.storage.File(tmp) });
eq(CF2.list().length, 1, '文件后端持久化并重新载入');
try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
ok(Engine.Catalog && Engine.Catalog.storage.kind === 'memory', 'Node 下默认目录后端为内存（浏览器下自动 localStorage）');
var C3 = Engine.createCatalog({ storage: Engine.storage.Memory() });
C3.importJSON({ runs: 1206, entries: [] });
eq(C3.nextId(), 1208, '普通编号跳过 1207');

// ------------------------------------------------------------
section('预设（含模块预设）');
var seen = {};
Engine.presets.forEach(function (pr) {
  var res = sim(Engine.getPreset(pr.key), { modules: Engine.presetModules(pr.key) });
  var okOut = res.outcome.id === pr.expect;
  ok(okOut, '预设「' + pr.name + '」→ ' + res.outcome.name + (okOut ? '' : '（期望 ' + pr.expect + '）'));
  seen[res.outcome.id] = true;
});
ok(Object.keys(seen).length >= 8, '预设覆盖 ≥8 种结局（' + Object.keys(seen).length + '）');
eq(Engine.getPreset('ours').alpha, 1 / 137.035999084, 'getPreset(ours) 为默认参数');
eq(Engine.getPreset('nope'), null, '不存在的预设返回 null');
eq(Engine.presetModules('sg_ours').stringGas, true, 'presetModules');

// ------------------------------------------------------------
section('随机宇宙');
var kinds = {}, threwR = false, kindsSG = {};
for (var s = 0; s < 40; s++) {
  try {
    var rsg = sim(Engine.randomParams(2000 + s));
    kindsSG[rsg.outcome.id] = (kindsSG[rsg.outcome.id] || 0) + 1;
    var rr = sim(Engine.randomParams(1000 + s, { stringGas: false }));
    kinds[rr.outcome.id] = (kinds[rr.outcome.id] || 0) + 1;
    if (!(rr.distance >= 0 && rr.distance <= 100) || !isFinite(rr.habitability)) threwR = true;
    if (!rr.findings.every(function (f) { return isFinite(f.value) || f.value === null; })) threwR = true;
  } catch (e) { threwR = true; console.log('    随机宇宙异常：', e.message); }
}
ok(!threwR, '80 个随机宇宙全部跑通、数值有限');
ok(Object.keys(kinds).length >= 4, '关闭弦气模块的随机宇宙结局多样（' + JSON.stringify(kinds) + '）');
ok((kindsSG.UNSTABLE_ORBITS || 0) + (kindsSG.BEYOND_MODEL_DIM || 0) >= 30, '默认（弦气开）随机宇宙绝大多数 D≠3（' + JSON.stringify(kindsSG) + '）');
ok(JSON.stringify(Engine.randomParams(42)) === JSON.stringify(Engine.randomParams(42)), '同种子随机参数可复现');
// 抽样先验 spread
var pw = Engine.randomParams(5, null, { spread: 'wide' }), pn = Engine.randomParams(5, null, { spread: 'narrow' });
ok(pn.alpha / (1 / 137.035999084) > 0.9 && pn.alpha / (1 / 137.035999084) < 1.1 && pn.generations === 3 && Math.abs(pn.omegaK) <= 0.01, 'narrow：α 在 ±10% 内、N_gen=3、|Ω_k|≤0.01');
ok(pw.alpha / (1 / 137.035999084) >= 0.1 && pw.alpha / (1 / 137.035999084) <= 10 && [2, 3, 4].indexOf(pw.generations) >= 0, 'wide：α 在 ±1 dex 内、N_gen∈{2,3,4}');
ok(/探索用的先验/.test(pn._prior) && /探索用的先验/.test(pw._prior) && /不代表宇宙参数的真实分布/.test(Engine.spreadLabel('narrow')), 'spread≠full 时标注"探索用的先验，不代表宇宙参数的真实分布"');
var stN = Engine.searchStatistics(2000, 424242, { spread: 'narrow', modules: { stringGas: false } });
var stW = Engine.searchStatistics(2000, 424242, { spread: 'wide', modules: { stringGas: false } });
var stF = Engine.searchStatistics(2000, 424242, { spread: 'full', modules: { stringGas: false } });
ok(stN.pObservers >= 0.005, 'searchStatistics narrow（D=3 直接输入）：P(OBSERVERS) ≥ 0.5%（' + (stN.pObservers * 100).toFixed(2) + '%）');
ok(stF.pObservers <= stW.pObservers && stW.pObservers <= stN.pObservers, 'full ≤ wide ≤ narrow（' + stF.pObservers + ' ≤ ' + stW.pObservers + ' ≤ ' + stN.pObservers + '）');
ok(typeof stN.prior === 'string' && stN.outcomes && stN.pObserversAnd3D <= stN.pObservers && stN.pD3 === 1, 'searchStatistics 返回 outcomes/prior/pObserversAnd3D/pD3');
var stSG = Engine.searchStatistics(1500, 424242, { spread: 'narrow' });
ok(stSG.pD3 > 0.01 && stSG.pD3 < 0.08 && stSG.pObserversAnd3D <= stSG.pD3, '默认（弦气开）narrow：P(D=3)≈1/30，P(OBSERVERS∧D=3) ≤ P(D=3)（' + (stSG.pObserversAnd3D * 100).toFixed(3) + '%）');
console.log('    命中率（N=2000，D=3 直接输入）：full ' + (stF.pObservers * 100).toFixed(2) + '%，wide ' + (stW.pObservers * 100).toFixed(2) + '%，narrow ' + (stN.pObservers * 100).toFixed(2) + '%');
var rm = Engine.randomParams(7, { landscape: true });
ok('flux1' in rm && !('alpha' in rm) && 'stringGasT' in rm, 'randomParams(seed, modules) 按有效参数表采样（默认含弦气参数）');

// ------------------------------------------------------------
section('结局枚举');
['UNSTABLE_ORBITS', 'BIG_CRUNCH', 'BIG_RIP', 'HEAT_DEATH_NO_STRUCTURE', 'BLACK_HOLE_DOMINATED', 'NO_ATOMS', 'NO_CHEMISTRY', 'NO_CARBON_CHEMISTRY', 'NO_STARS', 'STARS_NO_LIFE', 'OBSERVERS_POSSIBLE', 'BEYOND_MODEL_DIM'].forEach(function (id) {
  ok(!!Engine.OUTCOMES[id], '包含 ' + id);
});
ok(!Engine.OUTCOMES.SPACE_ANNIHILATED && !Engine.OUTCOMES.LIQUID_OCEAN && !Engine.OUTCOMES.ALIEN_LAWS && !Engine.OUTCOMES.NEAR_EMPTY, '纯小说结局已移除');

// ------------------------------------------------------------
section('回归：grok 审查 A 组（#6–#9）');
// #6：m_u=m_d 取下限时 ln(m_π²) 不再发散
eq(P.byKey.mUp.min, 0.01, '#6 schema：m_u 下限 0.01 MeV（0 会让 ln m_π² 发散）');
eq(P.byKey.mDown.min, 0.01, '#6 schema：m_d 下限 0.01 MeV');
var q0 = Engine.deriveConstants({ mUp: 0, mDown: 0 });
ok(isFinite(q0.c.alphaS) && q0.c.alphaS > 0, '#6 m_u=m_d=0（会被夹到 0.01）→ 核力强度有限（' + q0.c.alphaS.toFixed(3) + '），不再是 Infinity');
var r6 = sim({ mUp: 0, mDown: 0 });
ok(isFinite(r6.calc.bbn.Bd) && isFinite(r6.calc.bbn.Bpp) && isFinite(r6.calc.bbn.Yp), '#6 BBN 全链有限（B_d/B_pp/Y_p）');
ok(r6.findings.every(function (f) { return f.value === null || isFinite(f.value); }) && !/Infinity|NaN/.test(r6.report), '#6 findings 与报告里没有 Infinity/NaN');
// #7：landscape 模块把 αₛ(M_Z) 压到极小 → Λ_QCD 下溢，不得产生 NaN
var r7 = sim({ stringCoupling: 0.05, compactVolume: 3000 }, { modules: { landscape: true } });
ok(r7.constants.lambdaQCD > 0 && isFinite(r7.constants.alphaG) && r7.constants.alphaG > 0, '#7 Λ_QCD/α_G 有正的下限保护（α_G=' + Engine.sci(r7.constants.alphaG, 2) + '）');
ok(isFinite(r7.calc.stars.Mmin) && isFinite(r7.calc.stars.Mmax), '#7 M_min/M_max 有限，不再是 NaN');
ok(!/NaN/.test(r7.report) && r7.findings.every(function (f) { return !/NaN/.test(f.valueText || ''); }), '#7 报告与 findings 里没有 "NaN M⊙"');
ok(r7.findings.every(function (f) { return f.value === null || isFinite(f.value); }), '#7 所有 finding.value 为 null 或有限');
// 人为构造非有限质量标度 → calcStars 短路并给出明确 finding
var degCalc = { bbn: { deuteronBound: true }, baryons: { hasBaryons: true }, dims: { orbitStability: 1 } };
Engine.calc.stars({ alpha: 1 / 137.035999084, meOverMp: 1, alphaG: 0 }, [], degCalc);
ok(degCalc.stars.degenerate === true && degCalc.stars.canIgnite === false, '#7 α_G=0 → calcStars 短路（degenerate=true，canIgnite=false）');
var degF = [];
Engine.calc.stars({ alpha: 1 / 137.035999084, meOverMp: 1, alphaG: 0 }, degF, { bbn: { deuteronBound: true }, baryons: { hasBaryons: true }, dims: { orbitStability: 1 } });
ok(degF.length === 1 && degF[0].id === 'R_STAR_MASS' && degF[0].verdict === 'fail' && /非有限/.test(degF[0].valueText), '#7 短路时给出 R_STAR_MASS(fail，"质量标度非有限")');
// #8：Saha 无解时报告不得写成 "z≈0"
var r8 = sim({ electronMass: 0.005 });
eq(r8.calc.recombination.zRec, null, '#8 mₑ 取 schema 下限 → Saha 在窗口内无解，zRec=null');
ok(!/z≈0（/.test(r8.report) && /z≈—/.test(r8.report), '#8 报告写 "z≈—" 而不是 "复合于 z≈0"');
// #9：负取模 → CIC 负索引 → NaN
eq(Engine.wrap1(-0.25), 0.75, '#9 wrap1(−0.25)=0.75（正取模）');
eq(Engine.wrap1(-3.5), 0.5, '#9 wrap1(−3.5)=0.5');
eq(Engine.wrap1(1), 0, '#9 wrap1(1)=0');
var nb9 = Engine.createNBody({ As: 1e-4 }, { N: 400, mesh: 16 });   // 大 A_s → Zel'dovich 位移 > 1 盒
var neg9 = 0; for (var i9 = 0; i9 < nb9.N; i9++) if (nb9.px[i9] < 0 || nb9.py[i9] < 0 || nb9.px[i9] >= 1 || nb9.py[i9] >= 1) neg9++;
eq(neg9, 0, '#9 大位移初始条件下所有坐标仍在 [0,1)');
for (var k9 = 0; k9 < 40; k9++) nb9.step(nb9.suggestDt());
var nan9 = 0; for (var j9 = 0; j9 < nb9.N; j9++) if (!isFinite(nb9.px[j9]) || !isFinite(nb9.py[j9])) nan9++;
eq(nan9, 0, '#9 演化 40 步后没有 NaN 坐标');
ok(isFinite(nb9.density[0]) && isFinite(nb9.clumpiness().var), '#9 密度网格与团块度有限');

// ------------------------------------------------------------
section('R_OCEAN：冷液体宇宙（heuristic 变体，不新增结局）');
/* 判据见 engine.js calcOcean：
   (1) 塌缩时标/年龄>1 (2) 没有恒星点燃 (3) 有原子且分子刚性 (4) 背景温度落在分子液态温区（复合之后、寿命之内）
   触发参数：gNewton=1e-4（引力弱 4 个量级）+ m_d=12 MeV（m_π² ∝ (m_u+m_d)Λ_QCD 变大 → π 变重、核力射程变短
   → 氘核不束缚 → pp 链第一步走不通 → 没有恒星）+ mₑ=0.2555 MeV（键能减半 → 液态温区 137–187 K，
   对应 z≈67→49，在复合之后）。 */
var oceanP = { gNewton: 1e-4, mDown: 12, electronMass: 0.2555 };
var rOc = sim(oceanP);
eq(rOc.outcome.id, 'NO_STARS', 'R_OCEAN 触发宇宙的结局仍是既有的 NO_STARS（不新增结局类型）');
eq(rOc.variant, 'ocean', 'R_OCEAN 触发 → sim.variant = "ocean"');
ok(rOc.calc.ocean.pass === true && rOc.calc.ocean.noCollapse && rOc.calc.ocean.starsOff && rOc.calc.ocean.chemistry && rOc.calc.ocean.liquid,
  'calc.ocean 四条全 true（不塌缩 / 无恒星 / 有原子分子 / 温度在液态窗口）');
var fOc = finding(rOc, 'R_OCEAN');
ok(!!fOc && fOc.basis === 'heuristic' && fOc.verdict === 'ok', 'R_OCEAN finding 存在，basis=heuristic，verdict=ok');
ok(!!fOc && typeof fOc.formula === 'string' && fOc.formula.length > 80 && /3π\/\(32Gρ_b\)/.test(fOc.formula) && /R_STAR_IGNITE/.test(fOc.formula) && /273\.15/.test(fOc.formula),
  'R_OCEAN 的 formula 写清四条判据（自由落体时标 / 点火 / 原子分子 / 液态温区）');
ok(!!fOc && /Jeans 1902/.test(fOc.ref) && /Adams 2008/.test(fOc.ref) && /Barrow & Tipler/.test(fOc.ref), 'R_OCEAN 的 ref 给出 Jeans / Adams / Barrow & Tipler');
ok(!!fOc && fOc.inputs && fOc.inputs.alphaGRel != null && fOc.inputs.gOverG0 != null && fOc.inputs.omegaB != null && fOc.inputs.eScale != null && fOc.inputs.canIgnite === false,
  'R_OCEAN 的 inputs 齐全（α_G、G/G₀、Ω_b、键能标度、能否点火）');
ok(!!fOc && /液滴\/液膜/.test(fOc.text) && /启发式/.test(fOc.text) && /近似/.test(fOc.text), 'R_OCEAN 文案写明形态、依据等级与近似');
ok(!!fOc && !/镜子|原著|致敬|第八章/.test(fOc.text + fOc.title + fOc.valueText + fOc.formula), 'R_OCEAN 用户可见文案不含文学来源字样');
between(rOc.calc.ocean.collapseRatio, 1, 1e6, 'R_OCEAN 触发宇宙的塌缩时标/年龄 > 1');
between(rOc.calc.ocean.TliqLoK, 100, 250, '液态温区下沿 ≈ 273.15 K × 键能标度（mₑ 减半 → ≈137 K）');
ok(rOc.calc.ocean.zHi < rOc.calc.recombination.zRec, '液态窗口整段在复合之后（z_窗口起点 < z_rec）');

// 默认宇宙（我们的宇宙）：有恒星 → 这条规则根本不评估，findings 一条不多
eq(ours.variant, null, '默认宇宙 variant 为 null（不是冷液体宇宙）');
ok(!finding(ours, 'R_OCEAN') && ours.calc.ocean.evaluated === false && ours.calc.ocean.why === 'stars',
  '默认宇宙有恒星 → 不评估 R_OCEAN，不多出 finding');
eq(ours.worstVerdict, 'ok', '加入 R_OCEAN 后默认宇宙的 worstVerdict 仍为 ok');

// 缺任一条件都不触发
var rNoGrav = sim(Object.assign({}, oceanP, { gNewton: 1 }));
ok(rNoGrav.variant === null && rNoGrav.calc.ocean.why === 'collapse' && rNoGrav.calc.ocean.collapseRatio < 1,
  '缺条件 1（引力不弱，gNewton=1）→ 气体仍会塌缩，不触发');
var rStars = sim({ gNewton: 1e-4, electronMass: 0.2555 });
ok(rStars.variant === null && rStars.calc.ocean.evaluated === false && rStars.calc.stars.canIgnite === true,
  '缺条件 2（恒星照常点燃）→ 不评估、不触发');
var rNoAtom = sim(Object.assign({}, oceanP, { omegaBh2: 0 }));
ok(rNoAtom.variant === null && rNoAtom.calc.ocean.why === 'chemistry' && rNoAtom.calc.atoms.atoms === false,
  '缺条件 3（没有重子 → 没有原子）→ 不触发');
var rNoLiq = sim(Object.assign({}, oceanP, { alpha: 0.001 }));
ok(rNoLiq.variant === null && rNoLiq.calc.ocean.why === 'liquid' && rNoLiq.calc.ocean.liquid === false,
  '缺条件 4（背景温度没有一段落在液态温区）→ 不触发');
// R_OCEAN 不参与结局判定：同一组参数去掉/保留这条规则，结局与既有 finding 不变
ok(rNoGrav.outcome.id === 'NO_STARS' && rOc.outcome.id === 'NO_STARS', 'R_OCEAN 通过与否都不改变结局（同为 NO_STARS）');
ok(Engine.calc && typeof Engine.calc.ocean === 'function', 'Engine.calc.ocean 已导出');

// ------------------------------------------------------------
section('浏览器式加载（UMD，vm 沙箱模拟 window/localStorage）');
(function () {
  var vm = require('vm');
  var sandbox = { console: console, Math: Math, JSON: JSON, Date: Date, Number: Number, String: String, Object: Object, Array: Array, Float32Array: Float32Array, isFinite: isFinite,
    localStorage: { _d: {}, getItem: function (k) { return this._d[k] || null; }, setItem: function (k, v) { this._d[k] = v; } } };
  sandbox.self = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'params.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8'), sandbox);
  var BE = sandbox.MirrorEngine;
  ok(!!BE && !!sandbox.MirrorParams, 'window.MirrorParams / window.MirrorEngine 已挂载');
  eq(BE.Catalog.storage.kind, 'localStorage', '浏览器下自动使用 localStorage 后端');
  eq(BE.simulate({}).outcome.id, 'OBSERVERS_POSSIBLE', '浏览器实例可模拟');
  BE.Catalog.save({ name: 'ls', params: { As: 3e-9 } });
  ok(!!sandbox.localStorage._d['mirror-universe-catalog'], '目录写入 localStorage');
})();

// ------------------------------------------------------------
console.log('\n' + passed + ' 通过，' + failed + ' 失败');
if (failed) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
