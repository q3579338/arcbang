#!/usr/bin/env node
/*
 * build.js —— 把 index.html + engine/*.js + ui/*.js 内联成单文件（无外部请求）。
 * 产出两个文件：
 *   dist/mirror.html      可读版：源码原样内联，保留注释与缩进（调试、审阅、diff 用）
 *   dist/mirror.min.html  压缩版：每个内联 <script>（type="text/plain" 的除外）用 terser 压缩，
 *                         <style> 做保守压缩（去注释/折叠空白，选择器逐字不动）。发布用。
 * 引擎源码另外以 <script id="mirrorEngineSrc" type="text/plain"> 内嵌一份，供 ui/particles.js 在 Web Worker 里
 * 以 Blob URL + importScripts 载入；压缩版里这一份也是压缩后的源码，构建时用 Node vm 验证它仍能
 * 在类 Worker 全局（只有 self、没有 module）里跑出 MirrorEngine / MirrorParams。
 * 用法：node build.js
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = __dirname;
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// 应用版本号：根目录 VERSION 单行文本（发布时改它再构建）；构建时间与下面的注释共用一个时刻
var APP_VERSION = (function () {
  try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch (e) { return 'dev'; }
})();
var BUILD_TIME = new Date().toISOString();

var terser = null;
try { terser = require('terser'); } catch (e) { /* 见下面的提示 */ }

function read(rel) {
  var p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}
function safeInline(js) { return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--'); }
// 尺寸一律按 UTF-8 字节算：本项目的注释与文案大量是中文，用 String.length（UTF-16 码元数）会把体积低估到 1/3
function kb(n) { if (typeof n === 'string') n = Buffer.byteLength(n, 'utf8'); return (n / 1024).toFixed(1) + ' KB'; }

/* ------------------------------------------------------------ JS 压缩（失败即回退原文） */
var warnings = [];
var TERSER_OPTS = {
  ecma: 5,
  compress: true,
  mangle: true,                       // 只压缩函数作用域内的名字；不开 toplevel，跨文件全局名（MirrorXxx）原样保留
  format: { comments: false, ecma: 5 },
  sourceMap: false
};
function minifyJs(code, label) {
  if (!terser) return code;
  try {
    var r = terser.minify_sync(code, TERSER_OPTS);
    if (r.error) throw r.error;
    if (typeof r.code !== 'string' || !r.code) throw new Error('terser 返回空结果');
    return r.code;
  } catch (e) {
    warnings.push(label + '：terser 失败（' + (e && e.message) + '），该块回退为未压缩源码');
    console.warn('警告：' + label + ' terser 压缩失败，已回退未压缩：' + (e && e.message));
    return code;
  }
}

/* ------------------------------------------------------------ CSS 保守压缩
 * 只做两件事：去 /* *\/ 注释、把空白折叠为单个空格，再删掉 { } ; , 周围多余的空格。
 * 字符串字面量单独成段、逐字保留，选择器与 content:'…' 里的空格一个不动。
 */
function minifyCss(css) {
  var parts = [], i = 0, n = css.length, buf = '', c, j, q, k, e;
  function flush() { if (buf) { parts.push({ s: false, v: buf }); buf = ''; } }
  while (i < n) {
    c = css.charAt(i);
    if (c === '/' && css.charAt(i + 1) === '*') { e = css.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {                            // 字符串字面量：逐字保留
      q = c; j = i + 1;
      while (j < n) { if (css.charAt(j) === '\\') j += 2; else if (css.charAt(j) === q) { j++; break; } else j++; }
      flush(); parts.push({ s: true, v: css.slice(i, j) });
      i = j; continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      k = i; while (k < n && /\s/.test(css.charAt(k))) k++;
      buf += ' '; i = k; continue;                            // 连续空白 → 单个空格（不敢删：可能是后代选择器）
    }
    buf += c; i++;
  }
  flush();
  var out = parts.map(function (p) {
    return p.s ? p.v : p.v.replace(/\s*([{};,])\s*/g, '$1').replace(/;}/g, '}');
  }).join('');
  return out.trim();
}

/* ------------------------------------------------------------ 引擎源码（Worker 用的那一份）
 * 可读版：把 params.js + engine.js 原样再内嵌一份到 <script id="mirrorEngineSrc" type="text/plain">。
 * 压缩版：不再重复内嵌（那是 ~98 KB，占成品的 1/10）。改成给页面里本来就有的两块引擎脚本加 id，
 *         再插一小段 shim，在解析到它时把两块的 textContent 拼进空的 #mirrorEngineSrc 节点。
 *         ui/particles.js 读的还是 document.getElementById('mirrorEngineSrc').textContent，一个字都不用改；
 *         没有 eval / document.write / 新建 <script>，CSP 下与原来等价（浏览器拿到的仍是同样转义过的源码文本）。
 */
var ENGINE_FILES = ['engine/params.js', 'engine/engine.js'];
var ENGINE_TAG_ID = ['mirrorEngineP', 'mirrorEngineE'];
var SHIM = '<script id="mirrorEngineShim">(function(){var d=document,g=function(i){var e=d.getElementById(i);return e?e.textContent:"";},'
  + 'p=g("' + ENGINE_TAG_ID[0] + '"),e=g("' + ENGINE_TAG_ID[1] + '"),n=d.getElementById("mirrorEngineSrc");'
  + 'if(n&&e)n.textContent=p+"\\n;\\n"+e;})();</script>';

var engineRaw = ENGINE_FILES.map(function (f) { var s = read(f); return s ? ('/* ---- ' + f + ' ---- */\n' + s) : ''; }).join('\n;\n');
// shim 路线要求两个引擎文件都在、且 index.html 里确实以 <script src> 引了它们；否则退回"压缩版也内嵌一份"
var htmlSrcList = [];
html.replace(/<script src="([^"]+)"><\/script>/g, function (m, s) { htmlSrcList.push(s); return m; });
var useShim = ENGINE_FILES.every(function (f) { return read(f) != null && htmlSrcList.indexOf(f) >= 0; });
if (!useShim) console.warn('提示：index.html 未按预期引入 ' + ENGINE_FILES.join(' / ') + '，压缩版退回内嵌完整引擎副本');
var engineMin = (!useShim && engineRaw.trim()) ? minifyJs(engineRaw, 'mirrorEngineSrc（Worker 引擎源码）') : '';

/* 从成品 HTML 里取出"Worker 实际会拿到的引擎源码"：
 * #mirrorEngineSrc 里直接有内容就用它；否则用假 document 跑一遍成品里的那段 shim，再读节点。
 * 不做反转义——浏览器把 textContent 原样喂给 Blob，<\/script 这种写法在 JS 字符串/正则里本来就等价。 */
function parseScripts(text) {
  var re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m, list = [];
  while ((m = re.exec(text)) !== null) {
    var idM = (m[1] || '').match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    list.push({ id: idM ? (idM[1] || idM[2]) : '', code: m[2] || '' });
  }
  return list;
}
function workerEngineSrc(text) {
  var byId = {};
  parseScripts(text).forEach(function (s) { if (s.id) byId[s.id] = { textContent: s.code }; });
  var node = byId.mirrorEngineSrc;
  if (!node) return { src: '', via: '没有 #mirrorEngineSrc' };
  if (node.textContent.trim().length >= 100) return { src: node.textContent, via: '直接内嵌' };
  var shim = byId.mirrorEngineShim;
  if (!shim) return { src: '', via: '#mirrorEngineSrc 是空的且没有 shim' };
  var ctx = vm.createContext({ console: console, document: { getElementById: function (id) { return byId[id] || null; } } });
  new vm.Script(shim.textContent, { filename: 'mirrorEngineShim' }).runInContext(ctx, { timeout: 10000 });
  return { src: node.textContent, via: 'shim 运行时拼装（#' + ENGINE_TAG_ID.join(' + #') + '）' };
}

// 压缩后的引擎源码必须仍能在"类 Worker 全局"里跑：只有 self、没有 module/exports
function verifyEngineSrc(src, label) {
  if (!src || !src.trim()) return null;
  var sandbox = { console: console };
  sandbox.self = sandbox;
  var ctx = vm.createContext(sandbox);
  try {
    new vm.Script(src, { filename: label }).runInContext(ctx, { timeout: 30000 });
  } catch (e) {
    return { ok: false, msg: label + ' 在 Worker 式全局中执行抛错：' + (e && e.message) };
  }
  var miss = ['MirrorEngine', 'MirrorParams'].filter(function (g) { return !ctx[g]; });
  if (miss.length) return { ok: false, msg: label + ' 执行后缺少全局：' + miss.join('、') };
  // ui/particles.js 的 Worker 靠 MirrorEngine.createNBody 建粒子；少了它 Worker 会静默退回主线程
  if (typeof ctx.MirrorEngine.createNBody !== 'function') return { ok: false, msg: label + ' 的 MirrorEngine 没有 createNBody（ui/particles.js 的 Worker 用它建粒子）' };
  try {
    var r = ctx.MirrorEngine.simulate(ctx.MirrorEngine.defaults());
    var id = r && r.outcome && r.outcome.id;
    if (id !== 'OBSERVERS_POSSIBLE') return { ok: false, msg: label + ' simulate(defaults()) 结局为 ' + id + '，期望 OBSERVERS_POSSIBLE' };
    return { ok: true, msg: label + '：Worker 式全局 OK（MirrorEngine v' + (ctx.MirrorEngine.VERSION || '?') + '、MirrorParams、createNBody 就位，simulate → ' + id + '）' };
  } catch (e2) {
    return { ok: false, msg: label + ' simulate(defaults()) 抛错：' + (e2 && e2.message) };
  }
}

/* ------------------------------------------------------------ 外部样式表内联
 * index.html 用 <link rel="stylesheet" href="web/tokens.css"> 吃那份三页共用的
 * 设计令牌表。**离线单文件不许有任何外部请求**（README 的承诺，tools/check-dist.js
 * 有专项检查），所以构建时把它换成内联 <style>。
 * 换进来的 <style> 就地接受下面那一轮 CSS 压缩（压缩版里跟页面自己的 <style> 一视同仁）。
 * 内联后如果还剩任何 <link rel="stylesheet">，直接让构建失败 —— 那就是一个漏网的外链。
 */
var cssIncluded = [], cssMissing = [];
function inlineStylesheets(text) {
  var out = text.replace(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi, function (tag) {
    var m = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    var href = m ? (m[1] !== undefined ? m[1] : m[2]) : '';
    if (!href) return tag;
    if (/^(?:https?:)?\/\//i.test(href)) {
      console.warn('警告：index.html 的样式表是外部地址，内联不了：' + href);
      process.exitCode = 1;
      return tag;
    }
    var css = read(href);
    if (css == null) { cssMissing.push(href); return '<!-- ' + href + ' 缺席（构建时不存在） -->'; }
    if (css.indexOf('</style') >= 0) {
      console.warn('警告：' + href + ' 里出现 </style，内联会提前闭合标签');
      process.exitCode = 1;
      return tag;
    }
    cssIncluded.push(href + ' (' + kb(css) + ')');
    return '<style>/* ---- ' + href + ' ---- */\n' + css + '\n</style>';
  });
  if (/<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i.test(out)) {
    console.error('✗ 内联之后仍有 <link rel="stylesheet"> 残留 —— 单文件会发外部请求');
    process.exitCode = 1;
  }
  return out;
}
html = inlineStylesheets(html);
if (cssIncluded.length) console.log('内联样式表：' + cssIncluded.join(', '));
if (cssMissing.length) { console.warn('警告：样式表缺席：' + cssMissing.join(', ')); process.exitCode = 1; }

/* ------------------------------------------------------------ 组装 */
// 版本与构建时间注入成真正的全局：只靠 <head> 里的注释，下游任何压缩/改写都可能把它删掉。
// 这个 <script> 在 head 里、排在 theme.js 之前。
var verTag = '<script>window.MIRROR_APP_VERSION=' + JSON.stringify(APP_VERSION) + ';window.MIRROR_BUILD_TIME=' + JSON.stringify(BUILD_TIME) + ';</script>';

function assemble(min) {
  var included = [], missing = [], engineDone = false;
  var shim = min && useShim;
  var eSrc = min ? engineMin : engineRaw;
  var engineTag = shim ? '<script id="mirrorEngineSrc" type="text/plain"></script>\n'
                       : (eSrc.trim() ? '<script id="mirrorEngineSrc" type="text/plain">\n' + safeInline(eSrc) + '\n</script>\n' : '');

  var out = html.replace(/<script src="([^"]+)"><\/script>/g, function (m, src) {
    var s = read(src);
    if (s == null) { missing.push(src); return '<!-- ' + src + ' 缺席（构建时不存在） -->'; }
    var code = min ? minifyJs(s, src) : s;
    included.push(src + ' (' + kb(code) + (min ? ' ← ' + kb(s) : '') + ')');
    var idx = shim ? ENGINE_FILES.indexOf(src) : -1;
    var tag = min ? ('<script' + (idx >= 0 ? ' id="' + ENGINE_TAG_ID[idx] + '"' : '') + '>' + safeInline(code) + '</script>')
                  : ('<script>/* ---- ' + src + ' ---- */\n' + safeInline(s) + '\n</script>');
    // 引擎源码副本（Worker 用）放在第一个 <script>（engine/params.js）之前；
    // shim 路线下这里放的是空节点，内容由 engine.js 之后紧跟的那段 shim 填。
    if (src === ENGINE_FILES[0] && engineTag) { engineDone = true; return engineTag + tag; }
    if (shim && src === ENGINE_FILES[1]) return tag + '\n' + SHIM;
    return tag;
  });
  if (engineTag && !engineDone && out.indexOf('id="mirrorEngineSrc"') < 0) out = out.replace('</body>', engineTag + '</body>');

  if (min) {
    out = out.replace(/<style>([\s\S]*?)<\/style>/g, function (m, css) { return '<style>' + minifyCss(css) + '</style>'; });
  }
  var comment = min
    ? '<!-- 单文件构建（压缩） · v' + APP_VERSION + ' · ' + BUILD_TIME + ' -->'
    : '<!-- 单文件构建 · v' + APP_VERSION + ' · ' + BUILD_TIME + ' · 内联：' + included.join(', ') + (missing.length ? ' · 缺席：' + missing.join(', ') : '') + ' -->';
  // <title> 留在文件最前面
  out = out.replace('<title>镜像宇宙模拟器</title>', '<title>镜像宇宙模拟器</title>\n' + verTag + '\n' + comment);
  return { text: out, included: included, missing: missing };
}

var distDir = path.join(ROOT, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

// 成品里的 Worker 引擎源码走一遍"类 Worker 全局"（只有 self、没有 module），确认还能建出引擎
function checkWorkerEngine(text, label) {
  var got = workerEngineSrc(text);
  var vres = verifyEngineSrc(got.src, label + ' 的 Worker 引擎源码（' + got.via + '，' + kb(Buffer.byteLength(got.src, 'utf8')) + '）');
  if (!vres) { console.warn('✗ ' + label + '：取不到 Worker 引擎源码（' + got.via + '）'); process.exitCode = 1; return; }
  console.log((vres.ok ? '✓ ' : '✗ ') + vres.msg);
  if (!vres.ok) process.exitCode = 1;
}

var plain = assemble(false);
fs.writeFileSync(path.join(distDir, 'mirror.html'), plain.text, 'utf8');
console.log('dist/mirror.html 写入完成：' + kb(plain.text) + ' · v' + APP_VERSION + ' · ' + BUILD_TIME);
console.log('内联：\n  ' + plain.included.join('\n  '));
if (plain.missing.length) console.log('缺席（已跳过）：' + plain.missing.join(', '));
checkWorkerEngine(plain.text, 'dist/mirror.html');

if (!terser) {
  console.warn('警告：未找到 terser（请 npm i -D terser），跳过 dist/mirror.min.html');
  process.exitCode = 1;
} else {
  var minified = assemble(true);
  checkWorkerEngine(minified.text, 'dist/mirror.min.html');
  fs.writeFileSync(path.join(distDir, 'mirror.min.html'), minified.text, 'utf8');
  var before = Buffer.byteLength(plain.text, 'utf8'), after = Buffer.byteLength(minified.text, 'utf8');
  console.log('dist/mirror.min.html 写入完成：' + kb(after)
    + '（原 ' + kb(before) + '，减少 ' + (100 - after / before * 100).toFixed(1) + '%；字节 ' + before + ' → ' + after + '）');
  console.log('压缩后各块：\n  ' + minified.included.join('\n  '));
  if (warnings.length) { console.warn('压缩告警（' + warnings.length + ' 处，均已回退未压缩源码）：'); warnings.forEach(function (w) { console.warn('  · ' + w); }); }
}

// 自检：不应残留外部引用
[['dist/mirror.html', plain.text]].forEach(function (p) {
  var ext = p[1].match(/<(script|link|img)[^>]+(src|href)="(https?:)?\/\/[^"]+"/g);
  if (ext) { console.warn('警告：' + p[0] + ' 仍有外部引用：', ext); process.exitCode = 1; }
});
