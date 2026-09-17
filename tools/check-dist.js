#!/usr/bin/env node
/*
 * tools/check-dist.js —— 构建产物发布前自检
 * ------------------------------------------------------------
 * 用法：node tools/check-dist.js [dist/mirror.html] [dist/mirror.min.html]
 *       （不给参数就用上面这两个默认路径；文件不存在则该项跳过并提示）
 *
 * 检查项：
 *   1. 体积          ≤ 15 MB，打印每个文件的 KB 与压缩率
 *   2. 无外部请求    src= / href= / url( / fetch( / importScripts( / new Worker( 的值不得是 http(s):// 或 //
 *                    注释与字符串里的文献 URL 只列为「疑似」，不算失败；
 *                    但 <script src=http / <link href=http / <img src=http 一律失败
 *   3. 全局对象齐全  MirrorEngine / MirrorAdapter / MirrorScenes / MirrorParticles / MirrorBrowser / MirrorPlanets
 *                    （若 ui/universe3d.js、ui/localdata.js 等源文件存在，则另加 MirrorUniverse3D / MirrorLocalData / …）
 *                    判定用「定义式赋值」模式（x.MirrorXxx = / x["MirrorXxx"] =），不是子串搜索：
 *                    删掉某个 ui/*.js 后，成品里残留的引用（如别处的 window.MirrorAdapter 读取）不再算通过
 *   4. 引擎自检      require('../engine/engine.js')，simulate(defaults()) 不抛错且结局为 OBSERVERS_POSSIBLE；
 *                    node engine/test.js 退出码 0
 *   5. 内联脚本语法  每个 <script> 块用 new vm.Script() 编译（只编译，不执行）
 *   6. Worker 引擎   压缩版的 <script id="mirrorEngineSrc"> 在"只有 self、没有 module"的 vm 沙箱里跑通，
 *                    并暴露 MirrorEngine / MirrorParams，simulate(defaults()) 结局为 OBSERVERS_POSSIBLE
 *
 * 退出码：任何一项失败 → 1；全部通过（含跳过）→ 0。
 * 无第三方依赖，Node ≥ 18。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var MB = 1024 * 1024;
var SIZE_LIMIT = 15 * MB;          // 自检阈值

/* ------------------------------------------------------------ 计分与输出 */
var nPass = 0, nFail = 0, nSkip = 0;
function ok(msg) { nPass++; console.log('✓ ' + msg); }
function bad(msg) { nFail++; console.log('✗ ' + msg); }
function skip(msg) { nSkip++; console.log('○ ' + msg + '（跳过）'); }
function note(msg) { console.log('    ' + msg); }
function head(msg) { console.log('\n— ' + msg + ' —'); }
function rel(p) { var r = path.relative(ROOT, p); return r && r.indexOf('..') !== 0 ? r.replace(/\\/g, '/') : p; }
function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

/* ------------------------------------------------------------ 参数 */
var argv = process.argv.slice(2);
var DEFAULTS = ['dist/mirror.html', 'dist/mirror.min.html'];
var mainPath = argv[0] ? path.resolve(process.cwd(), argv[0]) : path.join(ROOT, DEFAULTS[0]);
var minPath = argv[1] ? path.resolve(process.cwd(), argv[1]) : path.join(ROOT, DEFAULTS[1]);

function load(p, kind) {
  var f = { path: p, name: rel(p), kind: kind, min: kind === 'min', exists: false, buf: null, text: '', lineStarts: null };
  try {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      f.buf = fs.readFileSync(p);
      f.text = f.buf.toString('utf8');
      f.exists = true;
    }
  } catch (e) { f.error = e && e.message; }
  return f;
}
/* 「这是不是 ARCBANG 那个独立仓库」。
   arcbang（github.com/q3579338/arcbang）是从单体仓库导出的：里面只有 ARCBANG 那一份，
   BNB / BTC 两站的 config、nginx、部署脚本一个都没有。
   判据用 web/config.js 在不在 —— 那是 BNBBANG 主站的配置，导出时明确排除掉了。
   在单体仓库里它永远在，所以下面第 7～9 节的行为**一个字都没变**（仍然是 32 项）。
   导出仓库里则换成第 7 节的 ARCBANG 自检：那三节查的是别的站，缺文件不是错，是本来就没有。 */
var ARC_ONLY = !fs.existsSync(path.join(ROOT, 'web', 'config.js'));

var files = [load(mainPath, 'plain'), load(minPath, 'min')];
var fMain = files[0], fMin = files[1];

function lineOf(f, idx) {
  if (!f.lineStarts) {
    var s = [0];
    for (var i = 0; i < f.text.length; i++) if (f.text.charCodeAt(i) === 10) s.push(i + 1);
    f.lineStarts = s;
  }
  var a = 0, b = f.lineStarts.length - 1;
  while (a < b) { var m = (a + b + 1) >> 1; if (f.lineStarts[m] <= idx) a = m; else b = m - 1; }
  return a + 1;
}

console.log('镜像宇宙 · 构建产物自检');
console.log('目标：' + files.map(function (f) { return rel(f.path) + (f.exists ? '' : '（不存在）'); }).join('，'));

/* ============================================================ 1. 体积 */
head('1. 体积');
files.forEach(function (f) {
  if (!f.exists) { skip(f.name + ' 体积'); return; }
  var limitNote = '（阈值 ' + kb(SIZE_LIMIT) + '）';
  var over = f.buf.length > SIZE_LIMIT;
  (over ? bad : ok)(f.name + ' ' + kb(f.buf.length) + limitNote);
});
(function () {
  function cut(a, b) { return (100 - b.buf.length / a.buf.length * 100).toFixed(1) + '%'; }
  if (fMain.exists && fMin.exists) {
    note('压缩率：' + fMain.name + ' ' + kb(fMain.buf.length) + ' → ' + fMin.name + ' ' + kb(fMin.buf.length)
      + '，减少 ' + cut(fMain, fMin) + '（' + fMain.buf.length + ' → ' + fMin.buf.length + ' 字节）');
  }
})();

/* ============================================================ 2. 无外部请求 */
head('2. 无外部请求');

// 一律失败：外部资源标签
var HARD_TAG = /<\s*(script|link|img)\b[^>]*?\b(src|href)\s*=\s*(?:"|')?\s*(?:https?:)?\/\//gi;

// 属性与调用参数位置（只取字面量；变量表达式无法判断，跳过）
var SLOTS = [
  { name: 'src=', re: /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`)]+))/gi },
  { name: 'href=', re: /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`)]+))/gi },
  { name: 'url(', re: /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi },
  { name: 'fetch(', re: /\bfetch\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gi },
  { name: 'importScripts(', re: /\bimportScripts\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gi },
  { name: 'new Worker(', re: /\bnew\s+Worker\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gi }
];
var EXTERNAL = /^\s*(?:https?:)?\/\//i;
var ALLOWED = /^\s*(?:data:|blob:|#|javascript:void)/i;

files.forEach(function (f) {
  if (!f.exists) { skip(f.name + ' 外部请求扫描'); return; }
  var hits = [], hardHits = [], flagged = {};
  var m;

  HARD_TAG.lastIndex = 0;
  while ((m = HARD_TAG.exec(f.text)) !== null) {
    hardHits.push({ line: lineOf(f, m.index), text: m[0].slice(0, 90) });
    flagged[m.index] = true;
  }
  SLOTS.forEach(function (slot) {
    slot.re.lastIndex = 0;
    var mm;
    while ((mm = slot.re.exec(f.text)) !== null) {
      var v = mm[1] !== undefined ? mm[1] : (mm[2] !== undefined ? mm[2] : (mm[3] !== undefined ? mm[3] : ''));
      if (v === undefined || v === null) continue;
      var val = String(v).trim();
      if (!val || ALLOWED.test(val)) continue;
      if (!EXTERNAL.test(val)) continue;                       // 相对路径 → 放行
      hits.push({ slot: slot.name, line: lineOf(f, mm.index), value: val.slice(0, 90) });
      var at = f.text.indexOf(val, mm.index);
      if (at >= 0) flagged[at] = true;
    }
  });

  // 剩下的 http(s) 出现处：无法归到属性/调用位置（注释、字符串里的文献 URL）→ 只提示
  var suspects = [];
  var reAny = /https?:\/\/[^\s"'`)<>]*/gi, mu;
  while ((mu = reAny.exec(f.text)) !== null) {
    if (flagged[mu.index]) continue;
    suspects.push({ line: lineOf(f, mu.index), value: mu[0].slice(0, 78) });
  }

  if (hardHits.length || hits.length) {
    bad(f.name + '：外部资源标签 ' + hardHits.length + ' 处，属性/调用参数位置的外部地址 ' + hits.length + ' 处');
    hardHits.slice(0, 8).forEach(function (h) { note('[标签] 第 ' + h.line + ' 行：' + h.text); });
    hits.slice(0, 8).forEach(function (h) { note('[' + h.slot + '] 第 ' + h.line + ' 行 → ' + h.value); });
  } else {
    ok(f.name + '：属性与调用参数位置未出现 http:// https:// //（data:/blob:/#/相对路径放行）');
  }

  if (suspects.length) {
    var uniq = {}, order = [];
    suspects.forEach(function (s) { if (!uniq[s.value]) { uniq[s.value] = s; order.push(s.value); } });
    note('疑似（注释/字符串中的文献与数据源 URL，不作为失败）：共 ' + suspects.length + ' 处 / ' + order.length + ' 个不同地址');
    order.slice(0, 10).forEach(function (v) { note('  第 ' + uniq[v].line + ' 行：' + v); });
    if (order.length > 10) note('  …另有 ' + (order.length - 10) + ' 个');
  }
});

/* ============================================================ 3. 全局对象齐全 */
head('3. 全局对象');
var NEEDED = ['MirrorEngine', 'MirrorAdapter', 'MirrorScenes', 'MirrorParticles', 'MirrorBrowser', 'MirrorPlanets'];
var COND = [
  { src: 'ui/universe3d.js', name: 'MirrorUniverse3D' },
  { src: 'ui/localdata.js', name: 'MirrorLocalData' },
  { src: 'engine/planet.js', name: 'MirrorPlanetEngine' },
  { src: 'ui/citydata.js', name: 'MirrorCityData' },
  { src: 'ui/about-content.js', name: 'MirrorAbout' }
];
var condOn = [];
COND.forEach(function (c) {
  if (fs.existsSync(path.join(ROOT, c.src))) { NEEDED.push(c.name); condOn.push(c.src + ' → ' + c.name); }
});
if (condOn.length) note('条件项（源文件存在故要求）：' + condOn.join('，'));

/* 「定义式赋值」：成品里必须真的有一处把这个名字挂到某个对象上，而不是只提到过它。
 * 覆盖三种写法（压缩版把 root/window 形参 mangle 成单字母，点号形式仍然成立）：
 *   root.MirrorXxx = …   e.MirrorXxx=…   window.MirrorXxx=…      → 点号
 *   g["MirrorXxx"] = …                                            → 方括号字面量
 * 排除 ==/=== 比较（`=(?!=)`）与 `.MirrorXxx ==`。 */
function defRe(name) {
  return new RegExp('(?:[\\w$)\\]]\\s*\\.\\s*' + name + '|\\[\\s*["\\\']' + name + '["\\\']\\s*\\])\\s*=(?!=)');
}
files.forEach(function (f) {
  if (!f.exists) { skip(f.name + ' 全局对象'); return; }
  var missing = [], refOnly = [];
  NEEDED.forEach(function (g) {
    if (defRe(g).test(f.text)) return;
    missing.push(g);
    if (f.text.indexOf(g) >= 0) refOnly.push(g);
  });
  if (missing.length) {
    bad(f.name + '：缺少定义式赋值 ' + missing.join('、') + '（共需 ' + NEEDED.length + ' 个）');
    if (refOnly.length) note('其中 ' + refOnly.join('、') + ' 在文本里出现过但没有 `x.名字 =` 形式的定义 —— 多半是对应的 ui/*.js 没被内联进来，只剩别处的引用');
  } else {
    ok(f.name + '：' + NEEDED.length + ' 个全局对象均有定义式赋值（' + NEEDED.join('、') + '）');
  }
});

/* ============================================================ 4. 引擎自检 */
head('4. 引擎自检');
(function () {
  var enginePath = path.join(ROOT, 'engine', 'engine.js');
  if (!fs.existsSync(enginePath)) { skip('engine/engine.js 不存在，引擎自检'); skip('node engine/test.js'); return; }
  var Engine = null;
  try {
    Engine = require(enginePath); // engine.js 在 Node 下自行 require('./params.js')
  } catch (e) {
    bad('require(engine/engine.js) 抛错：' + (e && e.message));
  }
  if (Engine) {
    try {
      var r = Engine.simulate(Engine.defaults());
      var id = r && r.outcome && r.outcome.id;
      if (id === 'OBSERVERS_POSSIBLE') {
        ok('Engine.simulate(Engine.defaults()) → ' + id + '（' + ((r.outcome && r.outcome.name) || '') + '，v' + (Engine.VERSION || r.version || '?') + '）');
      } else {
        bad('Engine.simulate(Engine.defaults()) 结局为 ' + id + '，期望 OBSERVERS_POSSIBLE');
      }
    } catch (e2) {
      bad('Engine.simulate(Engine.defaults()) 抛错：' + (e2 && e2.message));
    }
  }

  var testPath = path.join(ROOT, 'engine', 'test.js');
  if (!fs.existsSync(testPath)) { skip('engine/test.js 不存在'); return; }
  var res = cp.spawnSync(process.execPath, [testPath], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * MB });
  var out = String((res.stdout || '') + (res.stderr || '')).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
  var tail = out.slice(-3);
  if (res.status === 0) ok('node engine/test.js 退出码 0');
  else bad('node engine/test.js 退出码 ' + res.status + (res.error ? '（' + res.error.message + '）' : ''));
  tail.forEach(function (l) { note('| ' + l); });
})();

/* ============================================================ 5. 内联脚本语法 */
head('5. 内联脚本语法');
var SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
var SKIP_TYPE = /json|importmap/i;
files.forEach(function (f) {
  if (!f.exists) { skip(f.name + ' 内联脚本编译'); return; }
  SCRIPT_RE.lastIndex = 0;
  var m, n = 0, skipped = 0, errs = [];
  while ((m = SCRIPT_RE.exec(f.text)) !== null) {
    var attrs = m[1] || '', code = m[2] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;                // 外链脚本（本项目不应有），无内容可编译
    var typeM = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    var type = typeM ? (typeM[1] || typeM[2] || typeM[3] || '') : '';
    if (type && SKIP_TYPE.test(type)) { skipped++; continue; }
    if (!code.trim()) continue;
    n++;
    var idM = attrs.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    var label = (idM ? '#' + (idM[1] || idM[2]) : '第 ' + n + ' 块') + (type ? ' [' + type + ']' : '');
    try {
      new vm.Script(code, { filename: f.name + ' ' + label });
    } catch (e) {
      errs.push(label + '（第 ' + lineOf(f, m.index) + ' 行起）：' + (e && e.message));
    }
  }
  if (errs.length) {
    bad(f.name + '：' + errs.length + '/' + n + ' 个 <script> 块语法错误');
    errs.slice(0, 8).forEach(function (e) { note(e); });
  } else {
    ok(f.name + '：' + n + ' 个 <script> 块编译通过' + (skipped ? '（另跳过 ' + skipped + ' 个数据块）' : ''));
  }
});

/* ============================================================ 6. Worker 引擎源码 */
head('6. Worker 引擎源码（<script id="mirrorEngineSrc">）');
/* 取"Worker 实际拿到的引擎源码"：
 *   可读版 —— #mirrorEngineSrc 里直接内嵌整份；
 *   压缩版 —— #mirrorEngineSrc 是空节点，内容由页面里那段 #mirrorEngineShim 在解析时用
 *             #mirrorEngineP + #mirrorEngineE 两块内联脚本的 textContent 拼出来（省掉一份 ~98 KB 的重复引擎）。
 * 这里不猜 shim 干了什么：把成品里的那段 shim 原样丢进带假 document 的 vm 跑一遍，再读节点，
 * 与浏览器同一条路径。也不做反转义——浏览器把 textContent 原样喂给 Blob，<\/script 这种写法在 JS 里本来就等价。 */
function scriptsById(text) {
  var re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m, byId = {};
  while ((m = re.exec(text)) !== null) {
    var idM = (m[1] || '').match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    var id = idM ? (idM[1] || idM[2]) : '';
    if (id) byId[id] = { textContent: m[2] || '' };
  }
  return byId;
}
function workerEngineSrc(text) {
  var byId = scriptsById(text), node = byId.mirrorEngineSrc;
  if (!node) return { src: '', via: '没有 <script id="mirrorEngineSrc">' };
  if (node.textContent.trim().length >= 100) return { src: node.textContent, via: '直接内嵌' };
  var shim = byId.mirrorEngineShim;
  if (!shim) return { src: '', via: '#mirrorEngineSrc 是空的且没有 #mirrorEngineShim' };
  var ctx = vm.createContext({ console: console, document: { getElementById: function (i) { return byId[i] || null; } } });
  try {
    new vm.Script(shim.textContent, { filename: '#mirrorEngineShim' }).runInContext(ctx, { timeout: 10000 });
  } catch (e) {
    return { src: '', via: '#mirrorEngineShim 执行抛错：' + (e && e.message) };
  }
  return { src: node.textContent, via: '#mirrorEngineShim 运行时拼装' };
}

files.forEach(function (f) {
  if (!f.exists) { skip(f.name + ' Worker 引擎源码'); return; }
  var got = workerEngineSrc(f.text), src = got.src;
  if (!src || src.trim().length < 100) { bad(f.name + '：取不到 Worker 引擎源码（' + got.via + '）→ Worker 会退回主线程'); return; }
  var label = '#mirrorEngineSrc（' + got.via + '）';
  var sandbox = { console: console };        // 模仿 Worker 全局：只有 self，没有 module/exports/window/document
  sandbox.self = sandbox;
  var ctx = vm.createContext(sandbox);
  try {
    new vm.Script(src, { filename: f.name + ' ' + label }).runInContext(ctx, { timeout: 60000 });
  } catch (e) {
    bad(f.name + '：' + label + ' 在 Worker 式全局中执行抛错：' + (e && e.message));
    return;
  }
  var miss = ['MirrorEngine', 'MirrorParams'].filter(function (g) { return !ctx[g]; });
  if (miss.length) { bad(f.name + '：' + label + ' 执行后缺少全局 ' + miss.join('、')); return; }
  if (typeof ctx.MirrorEngine.createNBody !== 'function') { bad(f.name + '：' + label + ' 的 MirrorEngine 没有 createNBody（Worker 用它建粒子）'); return; }
  try {
    var r = ctx.MirrorEngine.simulate(ctx.MirrorEngine.defaults());
    var id = r && r.outcome && r.outcome.id;
    if (id !== 'OBSERVERS_POSSIBLE') { bad(f.name + '：' + label + ' simulate(defaults()) 结局为 ' + id + '，期望 OBSERVERS_POSSIBLE'); return; }
    ok(f.name + '：' + label + ' ' + kb(Buffer.byteLength(src, 'utf8')) + '，Worker 式全局跑通（MirrorEngine + MirrorParams + createNBody，simulate → ' + id + '）');
  } catch (e2) {
    bad(f.name + '：' + label + ' simulate(defaults()) 抛错：' + (e2 && e2.message));
  }
});

if (!ARC_ONLY) {
/* ============================================================ 7. 站点首页图廊 */
/* web/dist/index.html（首页）引用的 assets/gallery/ 图片必须真的在 web/dist 里，
 * 而且 index.json 里每一条的文件都在、单张 ≤ 250 KB —— 图没进 dist 等于白做，
 * 线上就是一排裂图。web/dist 不存在（只跑离线包）时整项跳过。 */
head('7. 站点首页图廊（web/dist/assets/gallery）');
(function () {
  var siteIndex = path.join(ROOT, 'web', 'dist', 'index.html');
  var galDir = path.join(ROOT, 'web', 'dist', 'assets', 'gallery');
  if (!fs.existsSync(siteIndex)) { skip('web/dist/index.html 不存在，图廊检查'); return; }
  var html = fs.readFileSync(siteIndex, 'utf8');
  var refs = {}, re = /assets\/gallery\/([A-Za-z0-9._-]+)(?:\?v=([0-9a-f]+))?/g, m;
  while ((m = re.exec(html)) !== null) refs[m[1]] = m[2] || '';
  var names = Object.keys(refs);
  if (!names.length) { skip('首页没有引用 assets/gallery/，图廊检查'); return; }
  var missing = names.filter(function (f) { return !fs.existsSync(path.join(galDir, f)); });
  var unstamped = names.filter(function (f) { return !refs[f]; });
  if (missing.length) bad('首页引用了 ' + missing.length + ' 个不在 web/dist/assets/gallery 的文件：' + missing.slice(0, 5).join('、'));
  else ok('首页引用的 ' + names.length + ' 个图廊文件都在 web/dist/assets/gallery');
  if (unstamped.length) bad('图廊引用没打 ?v= 指纹：' + unstamped.slice(0, 5).join('、'));
  else ok('图廊引用全部带 ?v= 内容指纹（' + names.length + ' 处文件）');
  var idx = path.join(galDir, 'index.json'), list = null;
  try { list = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch (e) { bad('web/dist/assets/gallery/index.json 缺失或不是合法 JSON：' + (e && e.message)); return; }
  var items = Array.isArray(list) ? list : (list && list.items) || [];
  var LIMIT = 250 * 1024, over = [], lost = [], noMeta = [];
  items.forEach(function (it) {
    [it.file, it.thumb].forEach(function (f) {
      if (!f) return;
      var p = path.join(galDir, f);
      if (!fs.existsSync(p)) { lost.push(f); return; }
      if (fs.statSync(p).size > LIMIT) over.push(f + ' ' + kb(fs.statSync(p).size));
    });
    if (!it.block || !/^0x[0-9a-f]{64}$/i.test(it.hash || '') || !it.outcome || !it.view) noMeta.push(it.file || '?');
  });
  if (lost.length) bad('index.json 列出的文件不在：' + lost.join('、'));
  else if (over.length) bad('图廊单张超过 250 KB：' + over.join('、'));
  else if (noMeta.length) bad('index.json 条目缺 区块号/哈希/结局/视图：' + noMeta.join('、'));
  else ok('index.json ' + items.length + ' 条：文件齐全、单张 ≤ 250 KB、每条都有区块号/哈希/结局/视图');
})();

/* ============================================================ 8. 主网态文案（桩 config）
   specs/mainnet-ready.md 演练：不改现役 web/config.js，用
   web/config.mainnet.example.js（isTestnet=false）在 vm 里派生链身份，
   并扫描玩家可见 HTML（剥注释/脚本/样式）确认测试网专属字样已经门控掉。 */
head('8. 主网态文案（桩 config isTestnet=false）');
(function () {
  var exPath = path.join(ROOT, 'web', 'config.mainnet.example.js');
  if (!fs.existsSync(exPath)) { bad('缺少 web/config.mainnet.example.js'); return; }
  var exSrc = fs.readFileSync(exPath, 'utf8');
  var exBox = { window: {} };
  exBox.window = exBox;
  try {
    new vm.Script(exSrc, { filename: 'web/config.mainnet.example.js' }).runInNewContext(exBox);
  } catch (e) {
    bad('config.mainnet.example.js 执行抛错：' + (e && e.message));
    return;
  }
  var CFG = exBox.window.BNBBANG_CONFIG;
  if (!CFG || !CFG.chain) { bad('config.mainnet.example.js 没有 BNBBANG_CONFIG.chain'); return; }
  var ch = CFG.chain;
  var addrKeys = ['contract', 'bangToken', 'market', 'bangNames', 'referral', 'vesting', 'promo', 'crafted', 'craftedNames'];
  var filled = addrKeys.filter(function (k) { return CFG[k]; });
  var rpcBad = (CFG.rpc || []).filter(function (u) {
    var host = String(u).replace(/^https?:\/\//, '').split('/')[0];
    return /:\d+$/.test(host);
  });
  if (Number(ch.id) !== 56 || ch.name !== 'BSC 主网' || ch.nameEn !== 'BSC Mainnet'
      || String(ch.explorer).replace(/\/+$/, '') !== 'https://bscscan.com'
      || ch.currency !== 'BNB' || ch.isTestnet !== false) {
    bad('主网模板 chain 块不是 id 56 / BSC 主网 / bscscan.com / BNB / isTestnet false');
    note(JSON.stringify(ch));
  } else if (filled.length) {
    bad('主网模板合约地址应留空，却填了：' + filled.join('、'));
  } else if (!CFG.rpc || !CFG.rpc.length) {
    bad('主网模板 rpc 列表是空的');
  } else if (rpcBad.length) {
    bad('主网模板 rpc 含非 443 端口（应 443 优先）：' + rpcBad.join('、'));
  } else {
    ok('config.mainnet.example.js：chain 主网值齐、合约地址全空、rpc ' + CFG.rpc.length + ' 条均走默认 443');
  }

  function miniDoc() {
    function el() {
      return {
        id: '', appendChild: function () {}, insertBefore: function () {},
        firstChild: null, addEventListener: function () {}
      };
    }
    var head = el();
    head.insertBefore = function () {};
    return {
      getElementById: function () { return null; },
      getElementsByTagName: function (t) { return t === 'head' ? [head] : []; },
      createElement: function () { return el(); },
      createTextNode: function (t) { return { data: t }; },
      head: head,
      body: el(),
      documentElement: { getAttribute: function () { return ''; } },
      addEventListener: function () {}
    };
  }
  var navPath = path.join(ROOT, 'web', 'nav.js');
  if (!fs.existsSync(navPath)) { bad('web/nav.js 不存在，无法用桩 config 派生 chain()'); }
  else {
    var sandbox = {
      window: null,
      document: miniDoc(),
      BNBBANG_CONFIG: CFG,
      console: { log: function () {}, warn: function () {}, error: function () {} }
    };
    sandbox.window = sandbox;
    sandbox.document.defaultView = sandbox;
    try {
      new vm.Script(fs.readFileSync(navPath, 'utf8'), { filename: 'web/nav.js' }).runInNewContext(sandbox, { timeout: 10000 });
      var derived = sandbox.MirrorNav && sandbox.MirrorNav.chain && sandbox.MirrorNav.chain();
      var nm = sandbox.MirrorNav && sandbox.MirrorNav.chainName && sandbox.MirrorNav.chainName();
      if (!derived) bad('桩 config 下 MirrorNav.chain() 没有返回值');
      else if (derived.isTestnet) bad('桩 config isTestnet=false，chain() 却当成测试网');
      else if (derived.currency !== 'BNB') bad('桩 config 下 currency=' + derived.currency + '，期望 BNB');
      else if (String(derived.explorer).indexOf('testnet.bscscan') >= 0) bad('桩 config 下 explorer 仍指向 testnet.bscscan');
      else if (String(derived.explorer).replace(/\/+$/, '') !== 'https://bscscan.com') bad('桩 config 下 explorer=' + derived.explorer);
      else if (Number(derived.id) !== 56) bad('桩 config 下 chain.id=' + derived.id + '，期望 56');
      else {
        var legal = derived.isTestnet ? (nm + ' · 测试资产无价值') : '';
        if (legal) bad('主网态「测试资产无价值」仍会渲染：' + legal);
        else ok('桩 config 下 chain() → id 56 / ' + nm + ' / BNB / ' + derived.explorer + '，「测试资产无价值」整句不渲染');
      }
    } catch (e2) {
      bad('桩 config + nav.js vm 抛错：' + (e2 && e2.message));
    }

    function deriveWith(cfg) {
      var box = {
        window: null,
        document: miniDoc(),
        BNBBANG_CONFIG: cfg,
        console: { log: function () {}, warn: function () {}, error: function () {} }
      };
      box.window = box;
      box.document.defaultView = box;
      new vm.Script(fs.readFileSync(navPath, 'utf8'), { filename: 'web/nav.js' }).runInNewContext(box, { timeout: 10000 });
      return box.MirrorNav && box.MirrorNav.chain && box.MirrorNav.chain();
    }
    var fbFails = [];
    try {
      var dMain = deriveWith({ rpc: ['https://bsc-dataseed.binance.org'] });
      if (!dMain) fbFails.push('缺 chain + 主网 rpc：chain() 无返回');
      else if (dMain.isTestnet) fbFails.push('缺 chain + 主网 rpc 却 isTestnet=true（主网会误显示测试网提示）');
      else if (Number(dMain.id) !== 56) fbFails.push('缺 chain + 主网 rpc 的 id=' + dMain.id + '，期望 56');
      var dTest = deriveWith({ rpc: ['https://bsc-testnet-rpc.publicnode.com'] });
      if (!dTest) fbFails.push('缺 chain + 测试网 rpc：chain() 无返回');
      else if (!dTest.isTestnet) fbFails.push('缺 chain + 测试网 rpc 却 isTestnet=false（测试网丢提示）');
      var d97 = deriveWith({ chain: { id: 97, name: 'BSC 测试网', nameEn: 'BSC Testnet', explorer: 'https://testnet.bscscan.com', currency: 'tBNB' } });
      if (!d97 || !d97.isTestnet) fbFails.push('chain.id=97 漏写 isTestnet 应仍当测试网');
      var d56 = deriveWith({ chain: { id: 56, name: 'BSC 主网', nameEn: 'BSC Mainnet', explorer: 'https://bscscan.com', currency: 'BNB' } });
      if (!d56 || d56.isTestnet) fbFails.push('chain.id=56 漏写 isTestnet 应当主网');
    } catch (e3) {
      fbFails.push('抛错 ' + (e3 && e3.message));
    }
    if (fbFails.length) bad('isTestnet 回退：' + fbFails.join('；'));
    else ok('isTestnet 回退：缺 chain 跟 rpc 走、id 97/56 漏写不误标');
  }

  var mktPath = path.join(ROOT, 'web', 'market.html');
  if (!fs.existsSync(mktPath)) bad('web/market.html 不存在');
  else {
    var mkt = fs.readFileSync(mktPath, 'utf8');
    var iC = mkt.indexOf('function loadCCard');
    var chunk = iC < 0 ? '' : mkt.slice(iC, iC + 2200);
    var mktMiss = [];
    if (iC < 0) mktMiss.push('没有 loadCCard');
    if (!/n >= 8/.test(chunk)) mktMiss.push('未按 8 槽取 burned');
    if (!/\bburned:/.test(chunk)) mktMiss.push('未写入 burned 字段');
    if (!/n < 7/.test(chunk)) mktMiss.push('7 槽兼容门槛丢了');
    if (mkt.indexOf('铸造当时写入') < 0) mktMiss.push('8 槽精确销毁话术缺失');
    if (mkt.indexOf('链上 burned 未知') < 0) mktMiss.push('7 槽折算标注缺失');
    if (mktMiss.length) bad('market.html loadCCard 8 槽：' + mktMiss.join('；'));
    else ok('market.html loadCCard：8 槽 burned + 7 槽兼容并标注');
  }

  function stripVisible(html) {
    return String(html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  }
  var FORBID = /测试网|tBNB|testnet\.bscscan|测试资产无价值/i;
  var playerPages = ['landing.html', 'market.html', 'economy.html', 'status.html', 'profile.html'];
  var visHits = [];
  playerPages.forEach(function (f) {
    var p = path.join(ROOT, 'web', f);
    if (!fs.existsSync(p)) { visHits.push(f + ' 缺失'); return; }
    var vis = stripVisible(fs.readFileSync(p, 'utf8'));
    var m = vis.match(FORBID);
    if (m) visHits.push(f + ' 可见文案残留「' + m[0] + '」');
  });
  if (visHits.length) {
    bad('玩家页静态可见文案仍有测试网专属字样：' + visHits.join('；'));
  } else {
    ok('玩家五页静态可见文案（剥注释/脚本/样式）无 测试网 / tBNB / testnet.bscscan / 测试资产无价值');
  }

  var depPath = path.join(ROOT, 'web', 'deploy.html');
  if (!fs.existsSync(depPath)) { bad('web/deploy.html 不存在'); return; }
  var dep = fs.readFileSync(depPath, 'utf8');
  var depNotes = [];
  if (dep.indexOf('这是主网，真') < 0) depNotes.push('缺少「这是主网，真 BNB」红字确认');
  if (dep.indexOf('isMainnetMode') < 0 || dep.indexOf('siteChainId') < 0) depNotes.push('缺少主网硬核对 isMainnetMode / siteChainId');
  if (dep.indexOf('function visitorExplorer') < 0) depNotes.push('缺少 visitorExplorer（访客卡浏览器链接未按 chain 派生）');
  var scanHits = [];
  var reScan = /https:\/\/testnet\.bscscan\.com/g, mm;
  while ((mm = reScan.exec(dep)) !== null) {
    var line = dep.slice(0, mm.index).split('\n').length;
    var around = dep.slice(Math.max(0, mm.index - 80), mm.index + 40);
    if (!/CHAINS[\s\S]{0,400}$/.test(dep.slice(Math.max(0, mm.index - 400), mm.index))
        && around.indexOf("key: 'testnet'") < 0
        && around.indexOf('explorer: ') < 0) {
      scanHits.push('第 ' + line + ' 行');
    }
  }
  /* 允许 CHAINS.testnet.explorer 这一处；其它硬编码一律失败。 */
  var allScan = dep.match(/https:\/\/testnet\.bscscan\.com/g) || [];
  if (allScan.length > 1) depNotes.push('testnet.bscscan.com 出现 ' + allScan.length + ' 处（只允许 CHAINS.testnet 一处）');
  if (/"https:\/\/testnet\.bscscan\.com\/address\//.test(dep) || /'https:\/\/testnet\.bscscan\.com\/address\//.test(dep)) {
    depNotes.push('访客卡仍写死 testnet.bscscan.com/address/');
  }
  var pubHard = /var PUB_RPC = 'https:\/\/bsc-testnet-rpc\.publicnode\.com'/.test(dep);
  if (pubHard) depNotes.push('PUB_RPC 仍写死测试网节点');

  SCRIPT_RE.lastIndex = 0;
  var sm, sErrs = [], sN = 0;
  var depNoCmt = dep.replace(/<!--[\s\S]*?-->/g, '');
  while ((sm = SCRIPT_RE.exec(depNoCmt)) !== null) {
    var attrs = sm[1] || '', code = sm[2] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (!code.trim()) continue;
    sN++;
    try { new vm.Script(code, { filename: 'web/deploy.html <script>' }); }
    catch (e3) { sErrs.push(e3.message); }
  }
  if (sErrs.length) depNotes.push('内联脚本语法错误：' + sErrs[0]);
  if (depNotes.length) bad('deploy.html 主网硬核对：' + depNotes.join('；'));
  else ok('deploy.html：主网红字确认 + chainId 硬核对 + 访客浏览器按 config.chain 派生；' + sN + ' 个内联脚本编译通过');

  var ngx = path.join(ROOT, 'web', 'nginx-bnbbang.com.conf');
  if (!fs.existsSync(ngx)) { bad('缺少 web/nginx-bnbbang.com.conf'); }
  else {
    var nx = fs.readFileSync(ngx, 'utf8');
    var miss = [];
    if (nx.indexOf('root /var/www/bnbbang-main') < 0) miss.push('root /var/www/bnbbang-main');
    /* 2026-09-02 起这两条是 ^~ 前缀（正则 location 会截走 /api/art/*.png），两种写法都认 */
    if (!/location\s+(\^~\s+)?\/api\/\s*\{/.test(nx)) miss.push('/api 反代');
    if (nx.indexOf('deploy-gate') < 0) miss.push('deploy-gate');
    if (nx.indexOf('bytecode') < 0 || nx.indexOf('deny all') < 0) miss.push('.bytecode.hex 白名单');
    if (nx.indexOf('real_ip_header CF-Connecting-IP') < 0) miss.push('CF-Connecting-IP');
    if (nx.indexOf('proxy_set_header X-Real-IP') < 0) miss.push('X-Real-IP 覆盖');
    if (!/location\s+(\^~\s+)?\/s\/\s*\{/.test(nx)) miss.push('/s/ 落地页');
    if (nx.indexOf('www.bnbbang.com') < 0 || nx.indexOf('return 301') < 0) miss.push('www 301');
    if (nx.indexOf('location ~ \\.html$') < 0) miss.push('.html no-cache');
    if (nx.indexOf('location = /config.js') < 0) miss.push('config.js no-cache');
    if (miss.length) bad('nginx-bnbbang.com.conf 缺：' + miss.join('、'));
    else ok('nginx-bnbbang.com.conf：root / api / deploy-gate / bytecode 白名单 / 真实 IP / no-cache /s/ / www 301 齐全');
  }

  var sh = fs.readFileSync(path.join(ROOT, 'tools', 'deploy-site.sh'), 'utf8');
  if (sh.indexOf('BNBBANG_TARGET') < 0 || sh.indexOf('/var/www/bnbbang-main') < 0 || sh.indexOf('bnbbang.com') < 0) {
    bad('tools/deploy-site.sh 未按 BNBBANG_TARGET=main 参数化（root / 冒烟域名）');
  } else if (!/node tools\/check-dist\.js/.test(sh) || !/node engine\/test\.js/.test(sh)) {
    bad('tools/deploy-site.sh 门禁被改掉了');
  } else {
    ok('deploy-site.sh：默认测试站，BNBBANG_TARGET=main → /var/www/bnbbang-main + bnbbang.com，门禁仍在');
  }
})();

/* ============================================================ 9. BTCBANG 站（specs/btcbang-v1.md §六）
   bang.satloot.com 与主站共用合约、服务端与大部分代码，只换奇点来源与站名。这一段对
   web/dist-btc/（`node web/build-web.js --site btc` 的产物，目录名可用 BNBBANG_DIST 覆盖）跑同一套
   主网态检查，并核对 nginx / deploy / config.btc.js 三份配置。dist-btc 不存在时产物那几项跳过，
   配置三项照查（它们是源码，不用先构建）。 */
head('9. BTCBANG 站（bang.satloot.com：web/dist-btc / nginx / deploy / config.btc.js）');
(function () {
  var BTC_DIST = process.env.BNBBANG_DIST || 'dist-btc';
  var btcDir = path.join(ROOT, 'web', BTC_DIST);
  var btcBase = 'https://bang.satloot.com';

  function stripVisible(html) {
    return String(html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  }
  function readIf(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  function runConfig(p) {
    var box = { window: {} };
    box.window = box;
    new vm.Script(fs.readFileSync(p, 'utf8'), { filename: rel(p) }).runInNewContext(box);
    return box.window.BNBBANG_CONFIG;
  }

  /* ---- 9a nginx-bang.satloot.com.conf ---- */
  var ngx = path.join(ROOT, 'web', 'nginx-bang.satloot.com.conf');
  var nx = readIf(ngx);
  if (nx == null) bad('缺少 web/nginx-bang.satloot.com.conf');
  else {
    /* 只看指令，不看注释：conf 的注释里正说着「没有 deploy.html」，字面搜索会把它当成有 */
    nx = nx.replace(/^[ \t]*#.*$/mg, '');
    var miss = [];
    if (nx.indexOf('server_name bang.satloot.com') < 0) miss.push('server_name bang.satloot.com');
    if (nx.indexOf('root /var/www/btcbang') < 0) miss.push('root /var/www/btcbang');
    /* 这两条必须是 ^~ 前缀：正则 location 会截走 /api/art/*.png（主站 2026-09-02 踩过） */
    if (!/location\s+\^~\s+\/api\/\s*\{/.test(nx)) miss.push('location ^~ /api/');
    if (!/location\s+\^~\s+\/s\/\s*\{/.test(nx)) miss.push('location ^~ /s/');
    if (nx.indexOf('location = /sitemap-s.xml') < 0) miss.push('sitemap-s 反代');
    if (!/proxy_pass\s+http:\/\/127\.0\.0\.1:8802;/.test(nx)) miss.push('反代 127.0.0.1:8802');
    if (nx.indexOf('deploy.html') >= 0 || nx.indexOf('deploy-gate') >= 0) miss.push('不该有 deploy.html / deploy-gate');
    if (!/location\s+~\s+\\\.hex\$\s*\{\s*deny all;/.test(nx)) miss.push('.hex 一律 deny');
    if (/bytecode\)?\\\.hex/.test(nx)) miss.push('不该有 .bytecode.hex 白名单');
    if (nx.indexOf('real_ip_header CF-Connecting-IP') < 0) miss.push('CF-Connecting-IP');
    if (nx.indexOf('proxy_set_header X-Real-IP') < 0) miss.push('X-Real-IP 覆盖');
    if (nx.indexOf('location ~ \\.html$') < 0) miss.push('.html no-cache');
    if (nx.indexOf('location = /config.js') < 0) miss.push('config.js no-cache');
    if (nx.indexOf('gzip on') < 0) miss.push('gzip');
    if (/server_name\s+www\./.test(nx)) miss.push('不该有 www 段');
    if (miss.length) bad('nginx-bang.satloot.com.conf 缺：' + miss.join('、'));
    else ok('nginx-bang.satloot.com.conf：bang.satloot.com / root btcbang / ^~ api / ^~ s / sitemap-s / 8802 / 无 deploy.html / .hex 全拒 / 真实 IP / no-cache / gzip');
  }

  /* ---- 9b deploy-site.sh 的 btc 目标 ---- */
  var sh = readIf(path.join(ROOT, 'tools', 'deploy-site.sh')) || '';
  var shMiss = [];
  if (!/^\s*btc\)/m.test(sh)) shMiss.push('btc) 分支');
  if (sh.indexOf('/var/www/btcbang') < 0) shMiss.push('DOCROOT /var/www/btcbang');
  if (sh.indexOf('https://bang.satloot.com') < 0) shMiss.push('冒烟 https://bang.satloot.com');
  if (sh.indexOf('--site btc') < 0) shMiss.push('构建 --site btc');
  if (sh.indexOf('dist-btc') < 0) shMiss.push('上传 web/dist-btc');
  if (shMiss.length) bad('deploy-site.sh 未按 BNBBANG_TARGET=btc 参数化：' + shMiss.join('、'));
  else ok('deploy-site.sh：BNBBANG_TARGET=btc → /var/www/btcbang + bang.satloot.com，构建 --site btc，上传 dist-btc');

  /* ---- 9c config.btc.js：site/siteBase/source 齐、chain 仍是 BSC 主网、合约地址与 config.main.js 逐字相同 ---- */
  var cfgBtcPath = path.join(ROOT, 'web', 'config.btc.js');
  var cfgMainPath = path.join(ROOT, 'web', 'config.main.js');
  var CB = null;
  if (!fs.existsSync(cfgBtcPath)) bad('缺少 web/config.btc.js');
  else {
    try { CB = runConfig(cfgBtcPath); } catch (e) { bad('config.btc.js 执行抛错：' + (e && e.message)); }
    if (CB) {
      var cm = [];
      if (CB.site !== 'btc') cm.push('site 不是 btc');
      if (String(CB.siteBase || '').replace(/\/+$/, '') !== btcBase) cm.push('siteBase 不是 ' + btcBase);
      if (!CB.source || CB.source.chain !== 'BTC' || !/mempool\.space/.test(String(CB.source.explorer || ''))) cm.push('source 块不是 BTC / mempool.space');
      var ch = CB.chain || {};
      if (Number(ch.id) !== 56 || ch.isTestnet !== false || String(ch.explorer || '').replace(/\/+$/, '') !== 'https://bscscan.com' || ch.currency !== 'BNB') cm.push('chain 块不是 BSC 主网（id 56 / bscscan / BNB / isTestnet false）');
      if (fs.existsSync(cfgMainPath)) {
        try {
          var CM = runConfig(cfgMainPath);
          ['contract', 'bangToken', 'market', 'bangNames', 'referral', 'vesting', 'promo', 'crafted', 'craftedNames'].forEach(function (k) {
            if (String(CM[k] || '').toLowerCase() !== String(CB[k] || '').toLowerCase()) cm.push(k + ' 与 config.main.js 不同');
          });
          if (JSON.stringify(CM.rpc || []) !== JSON.stringify(CB.rpc || [])) cm.push('rpc 列表与 config.main.js 不同');
        } catch (e2) { cm.push('config.main.js 执行抛错：' + (e2 && e2.message)); }
      }
      if (cm.length) bad('config.btc.js：' + cm.join('；'));
      else ok('config.btc.js：site btc / siteBase ' + btcBase + ' / source BTC / chain BSC 主网 / 九个合约地址与 rpc 同 config.main.js');
    }
  }

  /* ---- 9d 产物 web/dist-btc ---- */
  if (!fs.existsSync(btcDir)) { skip('web/' + BTC_DIST + ' 不存在（node web/build-web.js --site btc），产物检查'); return; }
  var files = fs.readdirSync(btcDir);
  var banned = files.filter(function (f) { return f === 'deploy.html' || /\.hex$/.test(f); });
  if (banned.length) bad('web/' + BTC_DIST + ' 里不该有：' + banned.join('、'));
  else ok('web/' + BTC_DIST + '：没有 deploy.html，没有 .hex');

  var distCfg = readIf(path.join(btcDir, 'config.js'));
  var srcCfg = readIf(cfgBtcPath);
  if (distCfg == null) bad('web/' + BTC_DIST + '/config.js 缺失');
  else if (srcCfg != null && distCfg !== srcCfg) bad('web/' + BTC_DIST + '/config.js 不是 config.btc.js 的内容');
  else ok('web/' + BTC_DIST + '/config.js 就是 config.btc.js');

  var app = readIf(path.join(btcDir, 'app.html'));
  if (app == null) bad('web/' + BTC_DIST + '/app.html 缺失');
  else {
    var am = [];
    if (app.indexOf('<link rel="canonical" href="' + btcBase + '/app.html">') < 0) am.push('canonical 不是 ' + btcBase + '/app.html');
    if (app.indexOf('<meta property="og:site_name" content="BTCBANG">') < 0) am.push('og:site_name 不是 BTCBANG');
    if (app.indexOf('<title>镜像宇宙模拟器 · 引爆任意比特币区块 · BTCBANG</title>') < 0) am.push('title 不是比特币口径');
    if (app.indexOf('window.BNBBANG_SITE="btc"') < 0) am.push('缺 BNBBANG_SITE 标记');
    if (!/href="btc-theme\.css\?v=[0-9a-f]{10}"/.test(app)) am.push('缺 btc-theme.css（带指纹）');
    if (app.indexOf('/* ---- web/i18n-btc.js ---- */') < 0) am.push('注入层缺 i18n-btc.js');
    if (app.indexOf('/* ---- web/btc-source.js ---- */') < 0) am.push('注入层缺 btc-source.js');
    if (app.indexOf('/* ---- web/config.btc.js ---- */') < 0) am.push('注入层不是 config.btc.js');
    if (app.indexOf('https://bnbbang.com/app.html') >= 0) am.push('还有指向 bnbbang.com/app.html 的地址');
    if (am.length) bad('web/' + BTC_DIST + '/app.html：' + am.join('；'));
    else ok('web/' + BTC_DIST + '/app.html：canonical / og:site_name / title 按站参数化，BNBBANG_SITE + btc-theme.css + i18n-btc + btc-source + config.btc 齐');
  }

  /* 独立页：head 里要有站标记与主题覆盖，canonical 不能还指主站 */
  var pages = ['index.html', 'market.html', 'economy.html', 'status.html', 'profile.html', 'faq.html', 'how-it-works.html', 'verify.html', 'en/index.html', 'en/economy.html', 'zh/how-it-works.html', 'zh/faq.html', 'zh/verify.html'];
  var pm = [], seen = [];
  pages.forEach(function (f) {
    var h = readIf(path.join(btcDir, f));
    if (h == null) return;                          // 别人还没交的页（landing-btc / economy-btc …）不算错
    seen.push(f);
    var headEnd = h.indexOf('</head>');
    var hd = headEnd >= 0 ? h.slice(0, headEnd) : h;
    if (hd.indexOf('BNBBANG_SITE="btc"') < 0) pm.push(f + ' 缺 BNBBANG_SITE');
    if (!/btc-theme\.css\?v=[0-9a-f]{10}/.test(hd)) pm.push(f + ' 缺 btc-theme.css');
    if (/rel="canonical" href="https:\/\/bnbbang\.com\//.test(hd)) pm.push(f + ' canonical 仍指 bnbbang.com');
  });
  if (pm.length) bad('web/' + BTC_DIST + ' 独立页：' + pm.join('；'));
  else ok('web/' + BTC_DIST + ' 独立页（' + seen.length + ' 页）：BNBBANG_SITE + btc-theme.css 齐，canonical 不指主站');

  /* 主网态文案：与第 8 项同一条正则，扫产物里的玩家可见文本（含别人写的 landing-btc / economy-btc） */
  var FORBID2 = /测试网|tBNB|testnet\.bscscan|测试资产无价值/i;
  var vis = [];
  ['index.html', 'app.html', 'market.html', 'economy.html', 'status.html', 'profile.html', 'faq.html', 'how-it-works.html', 'verify.html'].forEach(function (f) {
    var h = readIf(path.join(btcDir, f));
    if (h == null) return;
    var m = stripVisible(h).match(FORBID2);
    if (m) vis.push(f + ' 可见文案残留「' + m[0] + '」');
  });
  if (vis.length) bad('web/' + BTC_DIST + ' 玩家页可见文案仍有测试网专属字样：' + vis.join('；'));
  else ok('web/' + BTC_DIST + ' 玩家页可见文案（剥注释/脚本/样式）无 测试网 / tBNB / testnet.bscscan / 测试资产无价值');

  /* 外链白名单：dist-btc 可见标记里出现的外部域名 ⊆ 主站 dist 里出现的 ∪ {bang.satloot.com, mempool.space}。
     主站那份 dist 就是白名单的来源 —— 那里的每个域名都已经过审；BTCBANG 只多两个自家的。 */
  function hostsOf(dir) {
    var set = {};
    if (!fs.existsSync(dir)) return null;
    fs.readdirSync(dir).forEach(function (f) {
      if (!/\.html$/.test(f)) return;
      var t = stripVisible(fs.readFileSync(path.join(dir, f), 'utf8'));
      var re = /\b(?:href|src|content|action)="(?:https?:)?\/\/([^/"'\s:]+)/gi, m;
      while ((m = re.exec(t)) !== null) set[m[1].toLowerCase()] = 1;
    });
    return set;
  }
  var mainHosts = hostsOf(path.join(ROOT, 'web', 'dist'));
  var btcHosts = hostsOf(btcDir);
  if (!mainHosts) skip('web/dist 不存在，dist-btc 外链白名单无从比对');
  else {
    var allow = Object.assign({ 'bang.satloot.com': 1, 'mempool.space': 1 }, mainHosts);
    var extra = Object.keys(btcHosts || {}).filter(function (h) { return !allow[h]; });
    if (extra.length) bad('web/' + BTC_DIST + ' 出现了白名单之外的外链域名：' + extra.join('、'));
    else ok('web/' + BTC_DIST + ' 外链域名（' + Object.keys(btcHosts || {}).length + ' 个）都在白名单内（主站 dist 的域名 + bang.satloot.com + mempool.space）');
  }
})();

} else {
/* ============================================================ 7'. ARCBANG 站（导出仓库专用）
 * 上面 1～6 节查的是离线单文件，与站点无关，两边都跑。
 * 这一节替下 7～9：查 web/dist-arc 这一份产物本身。 */
head("7'. ARCBANG 站（web/dist-arc / config.arc.js / nginx）");
(function () {
  var dist = path.join(ROOT, 'web', 'dist-arc');
  var idx = path.join(dist, 'index.html');
  if (!fs.existsSync(idx)) { skip('web/dist-arc/index.html 不存在（node web/build-web.js --site arc），ARCBANG 产物检查'); return; }

  /* a. 该有的页都在 */
  var want = ['index.html', 'app.html', 'market.html', 'status.html', 'profile.html',
              'faq.html', 'how-it-works.html', 'verify.html', 'deploy.html',
              'en/index.html', 'en/faq.html', 'en/how-it-works.html', 'en/verify.html',
              'config.js', 'theme.js', 'nav.js', 'tokens.css', 'arc-doc.css'];
  var lack = want.filter(function (f) { return !fs.existsSync(path.join(dist, f)); });
  (lack.length ? bad : ok)('web/dist-arc 页面齐全（' + (want.length - lack.length) + '/' + want.length + '）'
    + (lack.length ? '：缺 ' + lack.join('、') : ''));

  /* b. 图廊：index.html 引到的每一张都真的在 dist-arc 里 */
  var html = fs.readFileSync(idx, 'utf8');
  var refs = {}, m, re = new RegExp("assets\\/gallery\\/([A-Za-z0-9._-]+)", "g");
  while ((m = re.exec(html)) !== null) refs[m[1]] = 1;
  var names = Object.keys(refs);
  var miss = names.filter(function (f) { return !fs.existsSync(path.join(dist, 'assets', 'gallery', f)); });
  if (!names.length) skip('首页没引图廊，图廊检查');
  else (miss.length ? bad : ok)('首页引到的 ' + names.length + ' 张图廊图片都在 dist-arc 里'
    + (miss.length ? '：缺 ' + miss.slice(0, 5).join('、') : ''));

  /* c. 一个 bnbbang 仓库的链接都不许有（2026-09-17 用户拍板：本站独立） */
  /* 这几个仓库名**拼出来**，不写成整串字面量：导出脚本（tools/export-arcbang.js）会把
     导出树里所有文本过一遍 repoify()，整串写在这里的话，这个判据自己会被改成 arcbang，
     于是「有没有 bnbbang 链接」变成「有没有 arcbang 链接」，整节反着报。踩过一次。 */
  var BAD_REPO = new RegExp(['bnbbang', '-engine|bnbbang', '-economy|mirror-universe-', 'BNBBANG'].join(''));
  var dirty = [];
  (function walk(d) {
    fs.readdirSync(d).forEach(function (f) {
      var fp = path.join(d, f);
      if (fs.statSync(fp).isDirectory()) return void (f === 'assets' || walk(fp));
      if (!/\.(html|js|css|json|txt)$/.test(f)) return;
      if (BAD_REPO.test(fs.readFileSync(fp, 'utf8'))) dirty.push(rel(fp));
    });
  })(dist);
  (dirty.length ? bad : ok)('web/dist-arc 里没有指向 bnbbang 仓库的链接'
    + (dirty.length ? '：' + dirty.slice(0, 5).join('、') : ''));

  /* d. IndexNow 的密钥文件是按域名验证的，别的站那一份不能出现在这里 */
  var keyf = fs.readdirSync(dist).filter(function (f) { return /^[0-9a-f]{32}\.txt$/.test(f); });
  (keyf.length ? bad : ok)('web/dist-arc 里没有别站的 IndexNow 密钥文件' + (keyf.length ? '：' + keyf.join('、') : ''));

  /* e. 新站一律浅色（2026-09-08 用户定）：每个 HTML 的 head 里都要有那个标记 */
  var htmls = [];
  (function walk2(d, base) {
    fs.readdirSync(d).forEach(function (f) {
      var fp = path.join(d, f);
      if (fs.statSync(fp).isDirectory()) { if (f !== 'assets') walk2(fp, base + f + '/'); return; }
      if (/\.html$/.test(f)) htmls.push([base + f, fs.readFileSync(fp, 'utf8')]);
    });
  })(dist, '');
  var noLight = htmls.filter(function (h) { return h[1].indexOf('MIRROR_LIGHT_ONLY=true') < 0; }).map(function (h) { return h[0]; });
  (noLight.length ? bad : ok)('web/dist-arc 的 ' + htmls.length + ' 个 HTML 都打了 MIRROR_LIGHT_ONLY（只浅色）'
    + (noLight.length ? '：缺 ' + noLight.join('、') : ''));

  /* f. config.arc.js：链身份是唯一真相来源，错一个数就是连错链 */
  var cfg = path.join(ROOT, 'web', 'config.arc.js');
  if (!fs.existsSync(cfg)) bad('缺少 web/config.arc.js');
  else {
    var c = fs.readFileSync(cfg, 'utf8');
    var want2 = [["site: 'arc'", 'site arc'], ['id: 5042', 'chainId 5042'], ["currency: 'USDC'", 'currency USDC']];
    var badKeys = want2.filter(function (w) { return c.indexOf(w[0]) < 0; }).map(function (w) { return w[1]; });
    /* 没有代币：这四个键在 arc 的配置里必须是**不存在**，不是留空 */
    ['bangToken', 'vesting', 'promo', 'referralVault'].forEach(function (k) {
      if (new RegExp('^\\s*' + k + '\\s*:', 'm').test(c)) badKeys.push('多了代币键 ' + k);
    });
    (badKeys.length ? bad : ok)('config.arc.js：site arc / chainId 5042 / USDC / 没有任何代币键'
      + (badKeys.length ? '：' + badKeys.join('、') : ''));
    var dcfg = path.join(dist, 'config.js');
    if (fs.existsSync(dcfg)) {
      var same = fs.readFileSync(dcfg, 'utf8') === c;
      (same ? ok : bad)('web/dist-arc/config.js 就是 config.arc.js');
    }
  }

  /* g. nginx 配置在，且指的是本站 */
  var ng = path.join(ROOT, 'web', 'nginx-arcbang.xyz.conf');
  if (!fs.existsSync(ng)) bad('缺少 web/nginx-arcbang.xyz.conf');
  else {
    var n = fs.readFileSync(ng, 'utf8');
    var lack2 = ['arcbang.xyz', 'root '].filter(function (k) { return n.indexOf(k) < 0; });
    (lack2.length ? bad : ok)('nginx-arcbang.xyz.conf：server_name / root 就位' + (lack2.length ? '：缺 ' + lack2.join('、') : ''));
  }
})();
}

/* ============================================================ 汇总 */
console.log('');
if (nSkip) console.log('跳过 ' + nSkip + ' 项（文件不存在）');
console.log(nPass + ' 通过，' + nFail + ' 失败');
process.exit(nFail ? 1 : 0);
