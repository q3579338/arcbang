/*
 * 一次性构图工具：把模拟器真跑出来的那张 D=3 宇宙网转成底图 JPEG。
 * 只在换底图时跑，**不是运行时依赖** —— 服务跑起来之后不需要 puppeteer。
 *   node tools/make-base.js <源PNG> [质量]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const src = process.argv[2] || path.join(__dirname, '../../contracts/out/samples/dims/u-D3.png');
const q = Number(process.argv[3] || 0.88);
const OUT = path.join(__dirname, '..', 'base', 'universe-base.jpg');

(async () => {
  const png = fs.readFileSync(src);
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setContent('<canvas id="c"></canvas>');
  const dataUrl = await p.evaluate(async (b64, q) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const S = 1200;
    const c = document.getElementById('c');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#03050c'; g.fillRect(0, 0, S, S);
    // 源图是方的，等比铺满
    g.drawImage(img, 0, 0, S, S);
    return c.toDataURL('image/jpeg', q);
  }, png.toString('base64'), q);
  await b.close();
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('底图 → ' + OUT + '  ' + Math.round(buf.length / 1024) + ' KB'
    + '  （base64 后约 ' + Math.round(buf.length * 4 / 3 / 1024) + ' KB，每张 SVG 都要带这么多）');
})();
