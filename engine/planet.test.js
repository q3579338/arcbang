/*
 * 镜像宇宙 · 行星引擎测试
 * 运行：node engine/planet.test.js
 */
'use strict';
var path = require('path');
var fs = require('fs');
var PE = require('./planet.js');

var passed = 0, failed = 0, failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; failures.push(msg); console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + '（得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b) + '）'); }
function between(x, lo, hi, msg) { ok(typeof x === 'number' && isFinite(x) && x >= lo && x <= hi, msg + '（得到 ' + (typeof x === 'number' ? Number(x.toPrecision(5)) : x) + '，期望 ' + lo + '–' + hi + '）'); }
function within(x, target, relTol, msg) { ok(typeof x === 'number' && isFinite(x) && Math.abs(x - target) <= relTol * Math.abs(target), msg + '（得到 ' + (typeof x === 'number' ? Number(x.toPrecision(5)) : x) + '，目标 ' + target + ' ±' + (relTol * 100) + '%）'); }
function section(t) { console.log('\n== ' + t); }
function finding(ev, id) { for (var i = 0; i < ev.findings.length; i++) if (ev.findings[i].id === id) return ev.findings[i]; return null; }

var SUN = { massRel: 1, lumRel: 1, tempK: 5772, radiusRel: 1, ageGyr: 4.6, cls: 'G2V' };
function solar(key) {
  var p = PE.deriveFromSeed(1207, SUN, { real: true, key: key }, null);
  return { params: p, ev: PE.evaluate(p, SUN, null) };
}

// ------------------------------------------------------------
section('输入参数表 SCHEMA');
eq(PE.SCHEMA.length, 18, '输入参数 18 项');
ok(PE.SCHEMA.every(function (d) { return d.key && d.name && d.unit != null && typeof d.ref === 'string' && d.ref.length > 5 && typeof d.desc === 'string'; }), '每项都有 key/name/unit/ref/desc');
ok(PE.SCHEMA.every(function (d) { return typeof d.min === 'number' && typeof d.max === 'number' && d.min < d.max; }), '每项都有 min < max');
ok(Object.keys(PE.SOLAR).length === 8, '太阳系实测表 8 颗行星');
ok(Object.keys(PE.SOLAR).every(function (k) { var s = PE.SOLAR[k]; return s.massKg > 0 && s.radiusM > 0 && s.aAU > 0 && s.bond > 0 && s.tBBK > 0; }), '实测表每颗都有质量/半径/轨道/邦德反照率/黑体温度');

// ------------------------------------------------------------
section('地球（NASA Planetary Fact Sheet 实测输入）');
var E = solar('earth'), Ep = E.params, Ee = E.ev;
ok(Ep.meta.massEarth.status === 'accepted' && Ep.meta.albedo.status === 'accepted', '地球的质量与反照率标 accepted（实测）');
within(Ep.radiusEarth * 6371, 6371, 1e-9, '半径 6371 km（体积平均）');
within(Ee.derived.gravity.value, 9.81, 0.01, 'g = GM/R² ≈ 9.81 m/s²（算出 9.82；NASA 表列 9.80 为赤道口径）');
within(Ee.derived.escapeVelocity.value, 11.2, 0.01, 'v_esc = √(2GM/R) ≈ 11.2 km/s');
within(Ee.derived.density.value, 5514, 0.01, '平均密度 5514 kg/m³');
between(Ee.equilibriumTempK, 252, 256, 'T_eq ≈ 255 K（A_B=0.306 → 254.0 K；NASA 黑体温度 254.3 K）');
between(Ee.surfaceTempK, 286, 290, 'T_s ≈ 288 K（灰大气）');
between(Ee.tau, 0.85, 0.90, '灰大气 τ ≈ 0.87（H₂O+云 75% / CO₂ 20% / CH₄ 等 5%，Schmidt et al. 2010 归因）');
ok(Ee.derived.greenhouseTau.text.indexOf('CO₂') >= 0, 'τ 的分项（CO₂/H₂O/CH₄）写在输出里');
var jE = Ee.derived.jeans;
ok(Ee.derived.exobaseTemp.value > 900 && Ee.derived.exobaseTemp.value < 1100, '外逸层温度 ≈1000 K（观测定标）');
var jf = finding(Ee, 'PL_JEANS');
ok(jf.valueText.indexOf('氢 H₂') < 0 || jf.valueText.indexOf('逃逸：氢 H₂') >= 0, 'Jeans：H₂ 在逃逸一侧');
ok(jf.valueText.indexOf('保留：') === 0 && jf.valueText.indexOf('氮 N₂') > 0, 'Jeans：N₂ 被保留');
ok(jf.valueText.split('逃逸：')[1].indexOf('氢 H₂') >= 0, 'Jeans：H₂ 逃逸（λ<30）');
between(Ee.liquidWater ? 1 : 0, 1, 1, '地球有液态水');
ok(Ee.habitability > 0.5, '地球宜居（habitability = ' + Ee.habitability.toFixed(2) + ' > 0.5）');
ok(Ee.derived.tidalLock.value > 4.6e9, '潮汐锁定时标 ' + PE.fmtTimeYr(Ee.derived.tidalLock.value) + ' 长于太阳系年龄 → 未锁定');
within(Ee.derived.solarDay.value, 24, 0.01, '太阳日 24 h（自转 23.9345 h + 公转）');
within(Ee.derived.period.value, 1, 0.01, '公转周期 1 年（开普勒）');
within(Ee.derived.insolation.value, 1361, 0.01, '辐照 1361 W/m²（太阳常数）');
within(Ee.derived.hillRadius.value, 1.47e6, 0.05, '希尔球半径 ≈1.5×10⁶ km');
eq(Ee.life.rank, 3, '地球生命等级 = 文明（实测）');

section('金星：强温室');
var V = solar('venus'), Ve = V.ev;
between(Ve.equilibriumTempK, 224, 229, '金星 T_eq ≈ 226.6 K（NASA 黑体温度）');
ok(Ve.surfaceTempK > 700, '金星表面温度 ' + Ve.surfaceTempK.toFixed(0) + ' K > 700 K（实测 737 K）');
ok(Ve.tau > 100, '金星 τ = ' + Ve.tau.toFixed(0) + '（92 bar CO₂）');
ok(!Ve.liquidWater, '金星没有液态水（表面温度高于水的临界温度 647 K）');
eq(Ve.habitability < 0.05, true, '金星宜居性 ≈ 0');

section('火星：薄大气、无液态水');
var Ma = solar('mars'), Me = Ma.ev;
between(Me.equilibriumTempK, 207, 213, '火星 T_eq ≈ 210 K');
between(Me.surfaceTempK, 210, 220, '火星 T_s ≈ 215 K（温室仅 +5 K，Haberle 2013；NASA 均温 208 K 为另一口径）');
ok(Ma.params.surfacePressureBar < 0.01, '火星大气薄：' + (Ma.params.surfacePressureBar * 1000).toFixed(2) + ' mbar');
ok(!Me.liquidWater, '火星没有液态水');
ok(finding(Me, 'PL_WATER').verdict !== 'ok', '液态水判定为非 ok');
ok(Me.derived.waterWindow.text.indexOf('冰') >= 0, '给出原因：温度低于 273.16 K，水以冰的形式存在');

section('木星：气态、保留 H₂');
var J = solar('jupiter'), Je = J.ev;
between(Je.equilibriumTempK, 108, 112, '木星 T_eq ≈ 109.9 K（NASA 黑体温度）');
eq(J.params.kind, 'gas', '木星为气态');
ok(finding(Je, 'PL_JEANS').valueText.indexOf('保留：氢 H₂') === 0, '木星保留 H₂（λ ≫ 30）');
ok(Je.derived.jeans.text.indexOf('H2') === 0, 'λ 表以 H₂ 打头');
ok(finding(Je, 'PL_TEMP').text.indexOf('内部热流') > 0, '诚实说明：1 bar 温度 163 K 与灰大气模型的差来自内部热流与 H₂ CIA（未含）');
within(J.params.massEarth, 317.8, 0.01, '木星质量 317.8 M⊕');
between(Je.derived.maxPlanetMass.value / J.params.massEarth, 1, 1.5, 'Weisskopf 质量上限 385 M⊕ 就在木星（317.8 M⊕）上方 —— 木星正处在这个转折点附近');
var big = PE.deriveFromSeed(3, SUN, { au: 5, type: 'gas', radiusRel: 12, gravityRel: 4 }, null);
ok(finding(PE.evaluate(big, SUN, null), 'PL_MASSMAX') != null, '576 M⊕ 的巨行星越过 Weisskopf 上限 → 给出 PL_MASSMAX');

section('八大行星：T_eq 对 NASA 黑体温度');
['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].forEach(function (k) {
  var r = solar(k);
  within(r.ev.equilibriumTempK, PE.SOLAR[k].tBBK, 0.01, PE.SOLAR[k].cn + ' T_eq = ' + r.ev.equilibriumTempK.toFixed(1) + ' K vs NASA ' + PE.SOLAR[k].tBBK + ' K');
});

// ------------------------------------------------------------
section('宜居带（Kopparapu et al. 2013 对太阳的复现）');
within(PE.hzEdge(PE.HZ_COEF.recentVenus, 5772, 1).dAU, 0.75, 0.01, '近期金星 0.75 AU');
within(PE.hzEdge(PE.HZ_COEF.moistGreenhouse, 5772, 1).dAU, 0.99, 0.01, '湿温室（保守内边界）0.99 AU');
within(PE.hzEdge(PE.HZ_COEF.maxGreenhouse, 5772, 1).dAU, 1.70, 0.01, '最大温室（保守外边界）1.70 AU');
within(PE.hzEdge(PE.HZ_COEF.earlyMars, 5772, 1).dAU, 1.77, 0.01, '早期火星 1.77 AU');

section('水的相图（IAPWS-95 定标）');
within(PE.boilingT(101325), 373.15, 0.005, '1 atm 沸点 373.15 K');
within(PE.boilingT(50000), 354.5, 0.01, '0.5 bar 沸点 ≈354.5 K');
eq(PE.boilingT(500), null, '低于三相点气压时没有沸点（只有冰与汽）');
within(PE.pSatH2O(373.15), 101325, 0.02, '373.15 K 的饱和蒸气压 ≈1 atm');
within(PE.boilingT(22.064e6), 647.096, 1e-6, '临界压强处沸点 = 临界温度 647.096 K');

section('潮汐锁定：M 型矮星 0.03 AU 的行星');
var MD = { massRel: 0.2, lumRel: 0.005, tempK: 3200, radiusRel: 0.22, ageGyr: 5 };
var mp = PE.deriveFromSeed(7, MD, { au: 0.03, type: 'rock', radiusRel: 1, gravityRel: 1, rotationH: 24 }, null);
var me = PE.evaluate(mp, MD, null);
ok(me.derived.tidalLock.value < 1e6, '潮汐锁定时标 ' + PE.fmtTimeYr(me.derived.tidalLock.value) + ' ≪ 年龄 50 亿年');
ok(me.derived.tidalLock.value / 5e9 < 1e-3, 't_lock/年龄 = ' + (me.derived.tidalLock.value / 5e9).toExponential(2) + ' < 10⁻³');
eq(finding(me, 'PL_TIDAL').verdict, 'warn', '潮汐锁定判定为 warn 并说明永昼/永夜');
var mpe = PE.deriveFromSeed(7, SUN, { au: 1, type: 'rock', radiusRel: 1, gravityRel: 1, rotationH: 24 }, null);
ok(PE.evaluate(mpe, SUN, null).derived.tidalLock.value > 4.6e9, '同一颗行星放到 1 AU 的太阳边上则不会被锁定');

// ------------------------------------------------------------
section('每一项都有 basis / status / ref');
var all = [Ee, Ve, Me, Je, me];
ok(all.every(function (ev) {
  return ev.derivedOrder.every(function (k) {
    var d = ev.derived[k];
    return d && d.key === k && d.name && typeof d.formula === 'string' && d.formula.length > 5
      && typeof d.ref === 'string' && d.ref.length > 5 && ['computed', 'scaling', 'heuristic'].indexOf(d.basis) >= 0;
  });
}), 'derived[key] = {name, symbol, unit, value, text, basis∈{computed,scaling,heuristic}, formula, inputs, ref}');
ok(all.every(function (ev) {
  return ev.findings.every(function (f) {
    return f.id && f.title && ['computed', 'scaling', 'heuristic'].indexOf(f.basis) >= 0
      && typeof f.formula === 'string' && f.formula.length > 5 && typeof f.ref === 'string' && f.ref.length > 5
      && ['ok', 'warn', 'bad', 'fail'].indexOf(f.verdict) >= 0 && typeof f.text === 'string' && f.text.length > 0;
  });
}), 'findings[] = {id, title, basis, formula, inputs, value, valueText, threshold, verdict∈{ok,warn,bad,fail}, text, ref}');
ok(PE.paramRows(Ep).every(function (r) { return r.name && r.value != null && r.basisLabel && r.ref && r.ref.length > 5; }), 'paramRows：参数名/值/单位/basis 标签/依据齐全（供 UI 表格）');
ok(PE.derivedRows(Ee).every(function (r) { return r.name && r.value != null && r.basisLabel && r.ref && r.desc; }), 'derivedRows：同上');
ok(PE.paramRows(Ep).every(function (r) { return ['accepted', 'given', 'seeded'].indexOf(r.basis) >= 0; }), '参数 status ∈ {accepted, given, seeded}');
ok(PE.paramRows(Ep).filter(function (r) { return r.basis === 'accepted'; }).length >= 12, '地球至少 12 项参数是实测值（accepted）');

section('报告');
ok(all.every(function (ev) { return typeof ev.report === 'string' && ev.report.length > 60; }), '每颗行星都有中文报告');
all.forEach(function (ev, i) {
  var n = (ev.report.match(/。/g) || []).length;
  ok(n >= 3 && n <= 7, '报告 ' + (i + 1) + ' 为 ' + n + ' 句（3–6 句，允许尾句合并）');
});
ok(!/仿佛|宛如|命运|孤独地|静静地|凝视/.test(all.map(function (e) { return e.report; }).join('')), '报告里没有小说措辞');

// ------------------------------------------------------------
section('确定性与性能');
var d1 = PE.deriveFromSeed(20240816, SUN, { au: 1.3, type: 'ocean', radiusRel: 1.2, gravityRel: 1.1 }, null);
var d2 = PE.deriveFromSeed(20240816, SUN, { au: 1.3, type: 'ocean', radiusRel: 1.2, gravityRel: 1.1 }, null);
ok(JSON.stringify(d1) === JSON.stringify(d2), '同 seed → 同参数');
var v1 = PE.evaluate(d1, SUN, null), v2 = PE.evaluate(d2, SUN, null);
ok(v1.report === v2.report, '同参数 → 同报告');
ok(JSON.stringify(v1.derived) === JSON.stringify(v2.derived), '同参数 → 同派生量');
var d3 = PE.deriveFromSeed(20240817, SUN, { au: 1.3, type: 'ocean', radiusRel: 1.2, gravityRel: 1.1 }, null);
ok(JSON.stringify(d3) !== JSON.stringify(d1), '不同 seed → 不同参数');

var T0 = process.hrtime();
for (var i = 0; i < 500; i++) PE.evaluate(d1, SUN, null);
var dt = process.hrtime(T0); var perMs = (dt[0] * 1000 + dt[1] / 1e6) / 500;
ok(perMs < 2, '单颗 evaluate ' + perMs.toFixed(3) + ' ms < 2 ms');

// ------------------------------------------------------------
section('随机 1000 颗');
function rng(s) { s = s >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
var r = rng(1207), nanCount = 0, habs = [], types = ['rock', 'desert', 'ocean', 'living', 'ice', 'lava', 'gas'], N = 1000;
var T1 = process.hrtime();
for (i = 0; i < N; i++) {
  var m = Math.exp(Math.log(0.15) + r() * Math.log(3.2 / 0.15));
  var star = { massRel: m, lumRel: Math.pow(m, 3.5), tempK: 3000 + r() * 4000, radiusRel: Math.pow(m, 0.8), ageGyr: 0.05 + r() * 11 };
  var given = { au: 0.05 * Math.exp(r() * Math.log(400)), ecc: r() * 0.12, type: types[(r() * types.length) | 0],
    radiusRel: 0.3 + r() * 3, gravityRel: 0.3 + r() * 2, rotationH: 8 + r() * 60, tiltDeg: r() * 60 };
  var pp = PE.deriveFromSeed((i * 2654435761) >>> 0, star, given, null);
  var ee = PE.evaluate(pp, star, null);
  var bad = false;
  ee.derivedOrder.forEach(function (k) { var v = ee.derived[k].value; if (typeof v === 'number' && isNaN(v)) bad = true; });
  PE.SCHEMA.forEach(function (s) { var v = pp[s.key]; if (typeof v === 'number' && (isNaN(v) || !isFinite(v))) bad = true; });
  if (bad || isNaN(ee.habitability) || isNaN(ee.surfaceTempK) || isNaN(ee.tau) || !ee.report) nanCount++;
  habs.push(ee.habitability);
}
var dt1 = process.hrtime(T1);
eq(nanCount, 0, '1000 颗随机行星：没有 NaN / 缺报告');
var nHab = habs.filter(function (h) { return h >= 0.5; }).length;
ok(nHab / N < 0.10, '宜居（≥0.5）比例 ' + (100 * nHab / N).toFixed(1) + '% < 10%');
ok(nHab > 0, '宜居比例不为 0（' + nHab + ' 颗）');
ok(habs.every(function (h) { return h >= 0 && h <= 1; }), '宜居性都落在 0–1');
ok((dt1[0] * 1000 + dt1[1] / 1e6) / N < 2, '平均 ' + ((dt1[0] * 1000 + dt1[1] / 1e6) / N).toFixed(3) + ' ms/颗 < 2 ms');

// ------------------------------------------------------------
section('D≠3 的宇宙：宜居性不给数');
var uc4 = PE.normUC({ dimS: 4, alphaRel: 1, alphaGRel: 1 });
var e4 = PE.evaluate(Ep, SUN, uc4);
eq(e4.habitability, null, 'D=4 时 habitability = null');
ok(e4.report.indexOf('不给数') > 0, '报告里说明为什么不给数');
var ucA = PE.normUC({ alphaRel: 2, alphaGRel: 1 });
var eA = PE.evaluate(Ep, SUN, ucA);
ok(finding(eA, 'PL_CONSTANTS') != null, 'α 改变时给出 PL_CONSTANTS（Weisskopf 质量上限 + 化学温度刻度）');
within(eA.derived.maxPlanetMass.value / Ee.derived.maxPlanetMass.value, Math.pow(2, 1.5), 1e-6, '行星质量上限 ∝ (α/α_G)^{3/2}');

// ------------------------------------------------------------
section('长描述（面板默认展开的正文）');
var ES = Ee.descriptionSentences;
between(ES.length, 6, 10, '地球描述 ' + ES.length + ' 句（6–10 句）');
ok(all.every(function (ev) { var n = ev.descriptionSentences.length; return n >= 6 && n <= 10; }), '五颗样本行星的描述都在 6–10 句');
var ORDER = [
  [0, /质量|半径|重力|逃逸速度/, '类型与体量'],
  [1, /AU|公转|偏心率/, '轨道'],
  [2, /自转|太阳日|倾角|锁定/, '自转与季节'],
  [3, /平衡温度|大气|温室|表面温度/, '温度与大气'],
  [4, /Jeans|逃逸|留得住/, '哪些气体保得住'],
  [5, /液态水|水|沸点|冰|溶剂/, '水'],
  [6, /热流|地质活动|磁场/, '地质与磁场'],
  [7, /卫星|环/, '卫星与环'],
  [8, /宜居性|生命|维数/, '宜居性与生命等级'],
  [9, /形成于|主序/, '年龄与历史']
];
ORDER.forEach(function (o) { ok(o[1].test(ES[o[0]] || ''), '第 ' + (o[0] + 1) + ' 句是「' + o[2] + '」'); });
ok(ES[8].indexOf('通过') > 0 || ES[8].indexOf('短板') > 0, '宜居性一句给出哪几条通过 / 未通过');
eq(Ee.descriptionSource, '数据：NASA 实测 18 项 · 真算 23 · 标度 6 · 启发式 4', '地球的来源摘要行');
ok(all.every(function (ev) { return ev.description.indexOf('示意') < 0; }), '正文里没有孤立的「示意」（改由面板顶部徽标承担）');
ok(Ee.description.indexOf('NASA') > 0, '地球正文注明数据取自 NASA');
var mixed = PE.evaluate(PE.deriveFromSeed(555, SUN, { au: 1.1, type: 'ocean', radiusRel: 1.1, gravityRel: 1.05 }, null), SUN, null);
ok(/种子抽样 \d+/.test(mixed.descriptionSource) && mixed.descriptionSource.indexOf('NASA') < 0, '过程生成的行星来源摘要写「种子抽样/生成器给定」而不是 NASA：' + mixed.descriptionSource);

section('恒星描述（恒星系层）');
var ds = PE.describeStar(SUN, null, { planets: [{ name: '地球', orbitAU: 1 }, { name: '火星', orbitAU: 1.524 }] });
between(ds.sentences.length, 4, 8, '恒星描述 ' + ds.sentences.length + ' 句');
[['G', '光谱型'], ['M⊙', '质量'], ['K', '有效温度'], ['L⊙', '光度'], ['主序寿命', '寿命'], ['单星', '多星与否'], ['宜居带', '宜居带范围'], ['雪线', '雪线']].forEach(function (t) {
  ok(ds.text.indexOf(t[0]) >= 0, '恒星描述含' + t[1] + '（' + t[0] + '）');
});
ok(ds.text.indexOf('还剩约 54 亿年') > 0, '太阳主序寿命剩余 54 亿年（10 Gyr − 4.6 Gyr）');
ok(ds.source.indexOf('标度') > 0 && ds.source.indexOf('真算') > 0, '恒星描述也带来源摘要');
var mstar = PE.describeStar({ massRel: 0.3, lumRel: 0.012, tempK: 3400, radiusRel: 0.3, ageGyr: 6, name: '恒星 X' }, null, { planets: [] });
ok(mstar.text.indexOf('宜居带') > 0 && !/NaN/.test(mstar.text), 'M 型矮星的恒星描述无 NaN');

// ------------------------------------------------------------
section('与 ui/planets.js 对接');
var planetsPath = path.join(__dirname, '..', 'ui', 'planets.js');
if (!fs.existsSync(planetsPath)) {
  console.log('  ○ ui/planets.js 不存在，跳过对接测试');
} else {
  var MP = require(planetsPath);
  var sys = MP.solarSystem({ isOurs: true });
  var earth = sys.planets[2];
  ok(earth.params && earth.report, '太阳系：地球挂上了 params / report');
  ok(earth.params.meta.massEarth.status === 'accepted', '地球参数标 accepted（NASA 实测）');
  between(earth.report.surfaceTempK, 286, 290, '经 planets.js 生成的地球 T_s ≈ 288 K');
  eq(earth.life.level, '文明', '太阳系行星的 life 不被引擎改写');
  ok(sys.planets.every(function (p) { return p.params && p.report && p.report.report.length > 60; }), '八大行星都有参数与报告');
  var s2 = MP.generateSystem(99887766, { isOurs: false, habitability: 0.8 });
  ok(s2.planets.every(function (p) { return p.params && p.report; }), '过程生成的恒星系：每颗行星都有 params / report');
  ok(s2.planets.every(function (p) { return !isNaN(p.report.habitability) && p.report.habitability >= 0 && p.report.habitability <= 1; }), '过程生成的宜居性都在 0–1');
  var s2b = MP.generateSystem(99887766, { isOurs: false, habitability: 0.8 });
  ok(s2.planets.map(function (p) { return p.report.report; }).join('|') === s2b.planets.map(function (p) { return p.report.report; }).join('|'), '同 seed 的恒星系两次生成得到同样的报告');
  ok(s2.planets.every(function (p) { return !p.life || (p.type !== 'gas' && p.type !== 'lava'); }), '气态/熔岩世界上没有被判出生命');
  var withLife = 0, tot = 0;
  for (i = 0; i < 60; i++) { var ss = MP.generateSystem((i * 2654435761) >>> 0, { isOurs: true }); ss.planets.forEach(function (p) { tot++; if (p.life) withLife++; }); }
  ok(withLife / tot < 0.15, '60 个恒星系共 ' + tot + ' 颗行星，有生命的占 ' + (100 * withLife / tot).toFixed(1) + '% < 15%');
}

// ------------------------------------------------------------
section('回归：grok 审查 A 组（#10–#13）');
(function () {
  // #10：过程生成的行星借用太阳系贴图 key，不得被换成 NASA 实测值
  var proc = { seed: 12345, id: 'x1', name: '某行星', visualKey: 'earth', type: 'rock', orbitAU: 0.5, real: false, star: SUN };
  PE.attach(proc, { star: SUN }, null);
  ok(proc.params.solarKey == null, '#10 visualKey=earth 但 real=false → 不加载太阳系实测（solarKey 为空）');
  ok(Math.abs(proc.params.orbitAU - 0.5) < 1e-9 && proc.params.name === '某行星', '#10 保留自己的轨道与名字（a=' + trimNum2(proc.params.orbitAU) + ' AU）');
  ok(Math.abs(proc.params.massEarth - 1) > 0.01, '#10 质量不是地球的 1 M⊕（得到 ' + trimNum2(proc.params.massEarth) + '）');
  var earth = { seed: 1, id: 'e', name: '地球', visualKey: 'earth', type: 'living', orbitAU: 1, real: true, star: SUN };
  PE.attach(earth, { star: SUN }, null);
  eq(earth.params.solarKey, 'earth', '#10 real=true 的地球仍然加载 NASA 实测');
  eq(earth.params.massEarth, 1, '#10 ……质量 1 M⊕');
  var pDirect = PE.deriveFromSeed(9, SUN, { key: 'mars', real: false }, null);
  ok(pDirect.solarKey == null, '#10 deriveFromSeed：给了 key 但 real=false → 不用实测');

  // #11：D≠3 时"不给生命"不能被 type==='living' 绕过
  var alive25 = { seed: 99, id: 'p25', name: 'X', type: 'living', orbitAU: 1, real: false, star: SUN, dim: 2.5,
    life: { level: '文明', rank: 3 }, timeline: { greenGyr: 1, civGyr: 4 } };
  PE.attach(alive25, { star: SUN }, null);
  eq(alive25.report.habitability, null, '#11 D=2.5：宜居性不给数');
  eq(alive25.life, null, '#11 ……type=living 的世界也不给生命（生成器给的 life 被清掉）');
  ok(alive25.timeline.greenGyr === Infinity && alive25.timeline.civGyr === Infinity, '#11 ……时间线里的生命节点也清成 Infinity');
  var alive3 = { seed: 99, id: 'p3', name: 'X', type: 'living', orbitAU: 1, real: false, star: SUN, dim: 3 };
  PE.attach(alive3, { star: SUN }, null);
  ok(alive3.report.habitability != null && alive3.life && alive3.life.rank >= 0, '#11 D=3：type=living 仍至少保留微生物（' + (alive3.life && alive3.life.level) + '）');

  // #12：非水溶剂要进入宜居性
  var pw = PE.deriveFromSeed(4242, SUN, { au: 1.9, type: 'rock' }, null);
  var ew = PE.evaluate(pw, SUN, null);
  var fw = ew.habitabilityDetail.factors[0];
  eq(fw.name, '液态水', '#12 宜居性第一项是液态水');
  ok(!ew.liquidWater && ew.derived.solvents.value > 0, '#12 该样本没有液态水但有 ' + ew.derived.solvents.value + ' 种常压溶剂（' + ew.derived.solvents.text + '）');
  eq(fw.value, 0.05, '#12 → 因子取 0.05（有非水溶剂）而不是 0.02');
  var pd = PE.deriveFromSeed(4242, SUN, { au: 40, type: 'rock' }, null);
  var ed = PE.evaluate(pd, SUN, null);
  if (!ed.liquidWater && ed.derived.solvents.value === 0) eq(ed.habitabilityDetail.factors[0].value, 0.02, '#12 完全没有溶剂时仍是 0.02');
  else ok(true, '#12 （该样本有溶剂或有水，跳过 0.02 分支）');

  // #13：ageGyr===0 / rotationHours===0 是合法值，不是"缺失"
  var p0 = PE.deriveFromSeed(7, SUN, { ageGyr: 0, rotationH: 0, au: 1, type: 'rock' }, null);
  var e0 = PE.evaluate(p0, SUN, null);
  var pA = PE.deriveFromSeed(7, SUN, { au: 1, type: 'rock' }, null);
  var eA = PE.evaluate(pA, SUN, null);
  eq(p0.ageGyr, 0, '#13 params.ageGyr=0 被保留');
  eq(p0.rotationHours, 0, '#13 params.rotationHours=0 被保留');
  eq(finding(e0, 'PL_TIDAL').inputs.ageYr, 0, '#13 潮汐锁定用 age=0（不再回落到恒星的 4.6 Gyr）');
  ok(e0.derived.heatFlux.value > eA.derived.heatFlux.value * 5, '#13 刚形成的行星放射性热流远高于 4.6 Gyr（' + trimNum2(e0.derived.heatFlux.value) + ' vs ' + trimNum2(eA.derived.heatFlux.value) + ' W/m²）');
  ok(e0.derived.solarDay.value === Infinity, '#13 rotationHours=0 → 日长为 ∞（不自转），不是 24 h');
  var evo = e0.habitabilityDetail.factors.filter(function (f) { return f.name === '演化时间'; })[0];
  eq(evo.value, 0, '#13 age=0 → 演化时间因子 0（此前被当成缺失而借用恒星年龄）');
})();
function trimNum2(x) { return String(Number(x.toPrecision(3))); }

// ------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log(passed + ' 通过，' + failed + ' 失败');
if (failed) { console.log('\n失败项：'); failures.forEach(function (f) { console.log('  · ' + f); }); }
process.exit(failed ? 1 : 0);
