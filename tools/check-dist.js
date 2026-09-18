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

/* ============================================================ 7. ARCBANG 站
 * 上面 1～6 节查的是离线单文件，与站点无关；这一节查 web/dist-arc 这一份产物本身。 */
head('7. ARCBANG 站（web/dist-arc / config.arc.js / nginx）');
(function () {
  var dist = path.join(ROOT, 'web', 'dist-arc');
  var idx = path.join(dist, 'index.html');
  if (!fs.existsSync(idx)) { skip('web/dist-arc/index.html 不存在（node web/build-web.js --site arc），ARCBANG 产物检查'); return; }

  /* a. 该有的页都在 */
  /* warmup.html 必须永远在：app.html 的铸造面板在放号还没轮到时把人指过去，
     那个链接不能有「今天不存在」的时候（首页切不切成预热页是另一回事）。 */
  var want = ['index.html', 'app.html', 'market.html', 'status.html', 'profile.html',
              'faq.html', 'how-it-works.html', 'verify.html', 'deploy.html', 'warmup.html',
              'en/index.html', 'en/faq.html', 'en/how-it-works.html', 'en/verify.html', 'en/warmup.html',
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
  /* 这几个仓库名**拼出来**，不写成整串字面量：从前那个导出脚本会把
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

  /* c2. 铸造入口的 ABI 三边一致：合约、站点包、部署向导。
     2026-09-18 给 bangSigned 加了 bool free（免费与否由服务端签死，见 ArcUniverse.sol）。
     漏改任何一边的后果都是「铸造在链上 revert，而报错看不出是哪一项错了」——
     上线第一枚就撞过一次（那次是 sig 偏移 224/256 没对上）。 */
  var MINT_SIG = 'bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bool,bytes)';
  var solSrc = '';
  try { solSrc = fs.readFileSync(path.join(ROOT, 'contracts/src/ArcUniverse.sol'), 'utf8'); } catch (e) { }
  var chainSrc = '';
  try { chainSrc = fs.readFileSync(path.join(dist, 'arc-chain.js'), 'utf8'); } catch (e) { }
  var abiJson = '';
  try { abiJson = fs.readFileSync(path.join(dist, 'ArcUniverse.abi.json'), 'utf8'); } catch (e) { }
  var mintBad = [];
  /* 合约那一侧比的是**摘要**：free 必须和 msg.sender 一起进 abi.encode，
     只在函数签名里加一个参数而不签进摘要，等于把免费额度交给调用者自己填。 */
  if (!solSrc) mintBad.push('读不到 contracts/src/ArcUniverse.sol');
  else {
    if (!/bool\s+free/.test(solSrc)) mintBad.push('合约的 bangSigned 没有 bool free 参数');
    /* 不去匹配整个 abi.encode(…)：里面有 address(this)，括号不成对，
       任何 [^)]* 都会在那儿断掉。只钉末尾那三个字段的顺序。 */
    if (!/deadline,\s*msg\.sender,\s*free\s*\)/.test(solSrc)) {
      mintBad.push('合约摘要末尾不是 (…, deadline, msg.sender, free)');
    }
  }
  if (!chainSrc) mintBad.push('读不到 dist-arc/arc-chain.js');
  else {
    if (chainSrc.indexOf("'" + MINT_SIG + "'") < 0) mintBad.push('arc-chain.js 的选择器不是 ' + MINT_SIG);
    /* sig 在 bool 之后 → 头部 8 个槽 → 偏移 256。写 7*32 就是老编码。 */
    if (chainSrc.indexOf('encUint(8 * 32)') < 0) mintBad.push('arc-chain.js 的 sig 偏移不是 8×32（bool 排在 sig 之前）');
  }
  if (abiJson && abiJson.indexOf('"free"') < 0) mintBad.push('dist-arc/ArcUniverse.abi.json 里没有 free 参数（字节码是旧的）');
  (mintBad.length ? bad : ok)('铸造入口 ABI 三边一致（合约摘要 / 站点包编码 / abi.json 都带 bool free）'
    + (mintBad.length ? '：' + mintBad.join('；') : ''));

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

/* ============================================================ 汇总 */
console.log('');
if (nSkip) console.log('跳过 ' + nSkip + ' 项（文件不存在）');
console.log(nPass + ' 通过，' + nFail + ' 失败');
process.exit(nFail ? 1 : 0);
