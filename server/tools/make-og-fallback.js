/*
 * 生成 base/og-fallback.png —— 出图挂了的时候顶上去的那张通用预览图
 * ------------------------------------------------------------
 *   node tools/make-og-fallback.js
 *
 * 一次性工具，产物进仓库。为什么不在运行时现生成：需要它的时候，恰恰是
 * 光栅化用不了的时候（依赖缺失 / 渲染抛错）—— 那会儿再想画一张已经晚了。
 *
 * 刻意不放底图那张星系照：
 *   1. 它一进 PNG 就是 2.6 MB，而这张是"兜底"，越小越该早点发出去；
 *   2. 它得让人一眼看出「这不是某个宇宙的图」，不然分享出去的是一张
 *      看着像宇宙、其实和链接里那个宇宙无关的图 —— 那比没有图更糟。
 * 纯色 + 字，压出来 20 KB 上下。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'base', 'og-fallback.png');
const S = 1200;
const F = 'Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,Menlo,Consolas,monospace';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" width="' + S + '" height="' + S + '">'
  + '<defs><radialGradient id="g" cx="50%" cy="42%" r="62%">'
  + '<stop offset="0%" stop-color="#141c3a"/><stop offset="60%" stop-color="#070b1c"/>'
  + '<stop offset="100%" stop-color="#03050c"/></radialGradient></defs>'
  + '<rect width="' + S + '" height="' + S + '" fill="url(#g)"/>'
  // 一圈极简的"宇宙网"暗示：三个同心椭圆，不像任何一个真宇宙，只是不至于全空
  + '<g fill="none" stroke="#9fd4ff" stroke-opacity="0.16">'
  + '<circle cx="600" cy="500" r="250" stroke-width="1.5"/>'
  + '<circle cx="600" cy="500" r="330" stroke-width="1"/>'
  + '<circle cx="600" cy="500" r="410" stroke-width="0.7"/>'
  + '</g>'
  + '<text x="600" y="520" text-anchor="middle" fill="#ffd08c" font-family="' + F
  + '" font-size="86" font-weight="300" letter-spacing="26">BNBBANG</text>'
  + '<text x="600" y="592" text-anchor="middle" fill="#ffffff" fill-opacity="0.72" font-family="' + F
  + '" font-size="34" font-weight="300" letter-spacing="2">Every BNB block hash is a set of physical laws</text>'
  + '<text x="600" y="1130" text-anchor="middle" fill="#ffffff" fill-opacity="0.34" font-family="' + MONO
  + '" font-size="22" letter-spacing="3">DETONATE  ·  MINT  ·  RESCUE</text>'
  + '</svg>';

let Resvg;
try { Resvg = require('@resvg/resvg-js').Resvg; }
catch (e) {
  console.error('要先 npm install @resvg/resvg-js 才能生成这张图：' + e.message);
  process.exit(1);
}
const png = Buffer.from(new Resvg(svg, {
  fitTo: { mode: 'width', value: S },
  font: { loadSystemFonts: true }
}).render().asPng());
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log('写好 ' + OUT + '  ' + (png.length / 1024).toFixed(1) + ' KB');
