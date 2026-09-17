/*
 * web/prerender-en.js —— 把首页（web/landing.html 落盘后的 HTML）预渲染成英文版 dist/en/index.html
 * ------------------------------------------------------------
 * 为什么要这一步：i18n.js 的中英切换发生在浏览器里（localStorage['mirror.lang']），
 * 爬虫永远只看到中文源码 —— 英文搜索里这个站不存在。SEO 需要一个**真实 URL** 的英文版：
 * /en/ 与 / 互指 hreflang，x-default 指英文（受众以海外为主）。
 *
 * 做法：在 Node 里用 vm 把 i18n.js 与各分册装进一个假的全局，拿到词典；
 * 然后按 i18n.js 的 walk() 同一口径翻 HTML 字符串 ——
 *   · 只翻「整段完全命中」的文本节点（trim 后与 key 逐字相等），部分匹配一律不做，
 *     哈希、地址、数字、代码块不会被误伤；
 *   · SCRIPT / STYLE / CODE / PRE / TEXTAREA 里的不翻；带 data-nolang 的父元素不翻；
 *   · 属性只翻 walkAttrs() 会翻的那几个（见 ATTRS）。
 * 词典漏翻的地方**自动退回中文**，与线上机制一致 —— 英文版任何时候都是可发布状态。
 *
 * 落盘在 /en/ 子目录，所以页面里所有相对地址（app.html、tokens.css?v=…、assets/…）
 * 都要改成以 / 开头的绝对路径，否则会指向 /en/app.html 这种不存在的地方。
 * 不用 <base href="/">：它会把页内锚点 #xxx 也解析到 /#xxx，点一下就跳走。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DICT_FILES = ['i18n.js', 'i18n-planets.js', 'i18n-app.js', 'i18n-mirror.js', 'i18n-tools.js', 'i18n-site.js', 'i18n-market.js'];
/* 与 i18n.js walkAttrs() 保持一致 */
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP_TAGS = { script: 1, style: 1, code: 1, pre: 1, textarea: 1 };
const VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };

/** 装词典：返回 { t(zh) → en 或原文, size }。extra：站点专属分册（btc 站多一册 i18n-btc.js） */
function loadDict(extra) {
  const sandbox = {};
  vm.createContext(sandbox);
  for (const f of DICT_FILES.concat(extra || [])) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  }
  const I = sandbox.MirrorI18n;
  if (!I) throw new Error('prerender-en：i18n.js 没有在沙箱里装上');
  I.set('en');
  return { t: (zh) => I.peek(zh), size: I.size() };
}

/** 把相对地址改成根绝对地址。已经是绝对 / 带协议 / 锚点 / data: 的不动。 */
function absolutize(html) {
  const isRel = (u) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|$)/i.test(u);
  html = html.replace(/\b(src|href|data-full|poster|action)="([^"]*)"/g, (m, k, v) =>
    isRel(v) ? k + '="/' + v + '"' : m);
  html = html.replace(/\bsrcset="([^"]*)"/g, (m, v) =>
    'srcset="' + v.split(',').map((part) => {
      const s = part.trim(); if (!s) return s;
      const sp = s.split(/\s+/);
      if (isRel(sp[0])) sp[0] = '/' + sp[0];
      return sp.join(' ');
    }).join(', ') + '"');
  return html;
}

/** 按 walk() 的口径翻文本节点与属性。返回 { html, hits } */
function translate(html, t) {
  const tokens = html.split(/(<!--[\s\S]*?-->|<[^>]+>)/);
  const stack = [];
  let hits = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    if (tok.startsWith('<!--')) continue;
    if (tok[0] === '<') {
      const m = tok.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (tok[1] === '/') {
        // 闭合：弹到同名为止（容忍源码里偶尔漏闭合）
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) { stack.length = k; break; }
        continue;
      }
      // 属性翻译：整值命中才换
      let tag = tok;
      for (const a of ATTRS) {
        const re = new RegExp('(\\s' + a + '=")([^"]*)(")');
        tag = tag.replace(re, (mm, p1, v, p3) => {
          const s = v.trim();
          if (!s) return mm;
          const en = t(s);
          if (en === s) return mm;
          hits++;
          return p1 + v.replace(s, en) + p3;
        });
      }
      tokens[i] = tag;
      const selfClose = /\/>$/.test(tok) || VOID_TAGS[name];
      if (!selfClose) stack.push({ name, nolang: /\sdata-nolang(?:=|\s|>)/.test(tok) });
      continue;
    }
    // 文本节点
    const parent = stack[stack.length - 1];
    if (parent && (SKIP_TAGS[parent.name] || parent.nolang)) continue;
    // 任何祖先是 script/style 也不翻（stack 里能看到）
    if (stack.some((s) => SKIP_TAGS[s.name])) continue;
    const s = tok.trim();
    if (!s) continue;
    const en = t(s);
    if (en === s) continue;
    tokens[i] = tok.replace(s, () => en);
    hits++;
  }
  return { html: tokens.join(''), hits };
}

const EN_TITLE = 'BNBBANG — Every BNB block hash is a universe. Free to detonate, mint once.';
const EN_DESC = 'Read a BNB Chain block hash as 23 physical constants and run that universe to heat death. 93% grow nothing. Detonate any block free; mint it once as an NFT on BSC. Open source engine, zero premine, no upgrade path.';

/**
 * @param {string} landingHtml  dist/index.html 的最终内容（已打指纹）
 * @param {object} [opts]       站点参数（specs/btcbang-v1.md §六）：{base, title, desc, dicts}。
 *                              不传 = bnbbang.com 的默认值，输出与从前逐字节相同。
 *                              base 是站点根（不带尾斜杠），canonical / og:url 从 base/ 改成 base/en/；
 *                              dicts 是额外的词典分册（btc 站的 i18n-btc.js）。
 * @returns {{html:string, hits:number, dict:number}}
 */
function render(landingHtml, opts) {
  const o = opts || {};
  const base = String(o.base || 'https://bnbbang.com').replace(/\/+$/, '');
  const title = o.title || EN_TITLE;
  const desc = o.desc || EN_DESC;
  const baseRe = base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  /* page（2026-09-09）：除首页外经济页也出 /en/。'index.html' = 首页（base/ ↔ base/en/，与从前逐字节相同）；
     其它页 base/<page> ↔ base/en/<page>。 */
  const page = String(o.page || 'index.html');
  const sub = page === 'index.html' ? '' : page;
  const subRe = sub.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const { t, size } = loadDict(o.dicts);
  let h = landingHtml;
  h = h.replace(/<html lang="zh-CN">/, '<html lang="en">');
  h = h.replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>');
  h = h.replace(/(<meta name="description" content=")[^"]*(")/, '$1' + desc + '$2');
  h = h.replace(new RegExp('(<link rel="canonical" href=")' + baseRe + '\\/' + subRe + '(")'), '$1' + base + '/en/' + sub + '$2');
  h = h.replace(new RegExp('(<meta property="og:url" content=")' + baseRe + '\\/' + subRe + '(")'), '$1' + base + '/en/' + sub + '$2');
  h = h.replace(/(<meta property="og:title" content=")[^"]*(")/, '$1' + title + '$2');
  h = h.replace(/(<meta property="og:description" content=")[^"]*(")/, '$1' + desc + '$2');
  h = h.replace(/(<meta name="twitter:title" content=")[^"]*(")/, '$1' + title + '$2');
  h = h.replace(/(<meta name="twitter:description" content=")[^"]*(")/, '$1' + desc + '$2');
  h = h.replace(/<meta property="og:locale" content="zh_CN">/, '<meta property="og:locale" content="en_US">');
  h = h.replace(/<meta property="og:locale:alternate" content="en_US">/, '<meta property="og:locale:alternate" content="zh_CN">');
  h = h.replace(/"inLanguage":\s*"zh-CN"/g, '"inLanguage": "en"');
  /* 进了英文版就把浏览器里的语言偏好也定成英文：动态渲染的部分（钱包 chip、链上状态）
     由 i18n.js 在运行时翻，它只认 localStorage —— 不设的话中文用户看到的是半英半中。 */
  h = h.replace(/<script src="theme\.js/, '<script>try{localStorage.setItem("mirror.lang","en")}catch(e){}</script>\n<script src="theme.js');
  const r = translate(h, t);
  return { html: absolutize(r.html), hits: r.hits, dict: size };
}

/** build-web.js 调这个：写 dist/en/index.html。opts 同 render() */
function build(landingHtml, outDir, opts) {
  const r = render(landingHtml, opts);
  const dir = path.join(outDir, 'en');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, (opts && opts.page) || 'index.html'), r.html);
  return r;
}

module.exports = { render, build, translate, absolutize };

if (require.main === module) {
  const src = process.argv[2];
  if (!src) { console.error('用法：node web/prerender-en.js <dist/index.html>'); process.exit(1); }
  const r = render(fs.readFileSync(src, 'utf8'));
  process.stdout.write(r.html);
  console.error('词典 ' + r.dict + ' 条，命中 ' + r.hits + ' 处');
}
