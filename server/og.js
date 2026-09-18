/*
 * OG 图（1200×630）—— 方卡原样缩到左边 + 右侧一栏文字
 * ------------------------------------------------------------
 * png.js 顶上讲过方图与 630 之争：方卡压成 1.91:1 只能裁掉上下两条或留 47% 黑边。
 * /s/ 落地页改成可索引的真页面之后，og:image 要给搜索引擎和 X / Telegram 的大图卡位用，
 * 1.91:1 才不会被平台从中间裁掉一半。做法不是裁：**整张方卡一个像素不动，缩到 630×630
 * 放左边**，右边 570px 留给一栏文字（编号、结局、D、α、档位、域名）。
 * 方卡仍然是 renderSVG 的原样输出，所以它和 NFT 的图是同一份矢量。
 *
 * 嵌套方式：外层 1200×630 的 <svg> 里直接内联 <svg width="630" height="630" viewBox="0 0 1200 1200">。
 * 本机 resvg 实测能渲（含 base64 底图，1200×630 一张约 670 ms 首渲）。
 * 不走 <image href="data:image/svg+xml;base64,…">：那要把 500 KB 的卡再 base64 一遍，
 * 而且嵌套 data URI 里的底图能不能被 resvg 认出来是另一层不确定。
 *
 * 字体：只用 Helvetica/Arial 退化链和等宽退化链，和 art.js 一致 —— 不印中文
 * （服务器上只有 DejaVu，CJK 会变成豆腐块；中文结局名留给落地页正文）。
 */
'use strict';
const { OUTCOME_EN } = require('./art.js');

const W = 1200, H = 630, CARD = 630;
const F = 'Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,Menlo,Consolas,monospace';
const GOLD = '#ffd08c';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 千分位。理由同 art.js：不用 toLocaleString，它跟着系统区域设置走 */
function grp(n) {
  const t = String(Math.round(Number(n))), out = [];
  for (let i = t.length; i > 0; i -= 3) out.unshift(t.slice(Math.max(0, i - 3), i));
  return out.join(',');
}

/**
 * 结局名最多折成两行。右栏净宽 474px，46px 的 Helvetica 一行放得下约 18 个字符；
 * 最长的 "Heat death, no structure"（24）先按逗号折，其余按单词折。
 */
function wrap2(s, max) {
  if (s.length <= max) return [s];
  const comma = s.indexOf(', ');
  if (comma > 0 && comma + 1 <= max && s.length - comma - 2 <= max) {
    return [s.slice(0, comma + 1), s.slice(comma + 2)];
  }
  const words = s.split(' ');
  let a = '', b = '';
  for (const w of words) {
    if (!b && (a ? a + ' ' + w : w).length <= max) a = a ? a + ' ' + w : w;
    else b = b ? b + ' ' + w : w;
  }
  return b ? [a, b] : [a];
}

/**
 * 把方卡 SVG 嵌进 1200×630 的外框。
 *
 * @param {string} cardSVG   renderSVG(hash, card, true, false) 的原样输出
 * @param {object} o
 * @param {string|null} o.blockNumber  纯数字字符串；没有就不印那一行
 * @param {object|null} o.card         拿得到就印结局与常数；拿不到只印编号和域名
 * @param {string} [o.blockHash]       右栏底部那行短哈希
 *                                     不传时输出逐字节不变。水印仍是 BNBBANG，域名那行也不动（系列名）。
 */
function composeOG(cardSVG, o) {
  o = o || {};
  const card = o.card || null;
  /* 只改开标签：去掉 width/height，钉成 630×630 摆在 (0,0)。viewBox 留着，缩放靠它。 */
  const inner = String(cardSVG).replace(/^<svg\b([^>]*)>/, (m, attrs) => {
    const kept = attrs.replace(/\s(width|height|x|y)="[^"]*"/g, '');
    return '<svg' + kept + ' x="0" y="0" width="' + CARD + '" height="' + CARD + '">';
  });

  const X = CARD + 48;                 // 右栏左边距
  const R = W - 48;                    // 右栏右边距
  const tint = card && card.rarity && card.rarity.index === 0 ? '#9df0cd' : GOLD;
  let lines = '';

  if (card && card.outcome) {
    const name = OUTCOME_EN[card.outcome.index] || card.outcome.id || '';
    const ls = wrap2(name, 18);
    const yTop = ls.length > 1 ? 262 : 282;     // 折成两行时整栏上提 20px，给底下的档位留出呼吸
    lines += ls.map((t, i) =>
      '<text x="' + X + '" y="' + (yTop + i * 54) + '" fill="#ffffff" font-family="' + F
      + '" font-size="46" font-weight="300">' + esc(t) + '</text>').join('');
    const yObs = yTop + (ls.length - 1) * 54 + 42;
    lines += '<text x="' + X + '" y="' + yObs + '" fill="' + tint + '" font-family="' + F
      + '" font-size="21" letter-spacing="3" opacity="0.85">'
      + (card.outcome.observers ? 'OBSERVERS POSSIBLE' : 'NO OBSERVERS') + '</text>';
    lines += '<line x1="' + X + '" y1="' + (yObs + 28) + '" x2="' + R + '" y2="' + (yObs + 28)
      + '" stroke="#ffffff" stroke-opacity="0.18"/>';

    const D = card.dimension && card.dimension.D != null ? card.dimension.D.toFixed(3) : '—';
    const K = card.constants || {};
    const aInv = K.alphaInv != null ? '1/' + K.alphaInv.toFixed(2) : '—';
    const grade = card.rarity && card.rarity.name ? card.rarity.name : '—';
    const y0 = yObs + 62;
    const cell = (x, y, label, val, big) =>
      '<text x="' + x + '" y="' + y + '" fill="#ffffff" fill-opacity="0.55" font-family="' + F
      + '" font-size="18" letter-spacing="2">' + esc(label) + '</text>'
      + '<text x="' + x + '" y="' + (y + (big ? 46 : 40)) + '" fill="#ffffff" font-family="' + F
      + '" font-size="' + (big ? 44 : 36) + '" font-weight="300">' + esc(val) + '</text>';
    lines += cell(X, y0, 'DIMENSION D', D, true)
      + cell(X + 250, y0, 'FINE STRUCTURE α', aInv, true)
      + cell(X, y0 + 86, 'GRADE', grade, false);
  } else {
    /* 降级：拿不到 card 就不编结局（share.js 三条纪律的第三条）。 */
    lines += '<text x="' + X + '" y="282" fill="#ffffff" fill-opacity="0.75" font-family="' + F
      + '" font-size="30" font-weight="300" letter-spacing="3">OUTCOME NOT COMPUTED YET</text>';
  }

  const num = o.blockNumber != null && /^\d{1,12}$/.test(String(o.blockNumber))
    ? 'BNB block #' + grp(o.blockNumber) : '';
  const short = o.blockHash ? String(o.blockHash).slice(0, 10) + '…' + String(o.blockHash).slice(-6) : '';

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + ' viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">'
    + '<rect width="' + W + '" height="' + H + '" fill="#03050c"/>'
    + inner
    + '<line x1="' + (CARD + 0.5) + '" y1="0" x2="' + (CARD + 0.5) + '" y2="' + H
    + '" stroke="#ffffff" stroke-opacity="0.10"/>'
    + '<text x="' + X + '" y="118" fill="' + GOLD + '" font-family="' + MONO
    + '" font-size="34" letter-spacing="11">BNBBANG</text>'
    + (num ? '<text x="' + X + '" y="176" fill="#ffffff" fill-opacity="0.72" font-family="' + F
      + '" font-size="28">' + esc(num) + '</text>' : '')
    + lines
    + (short ? '<text x="' + R + '" y="596" text-anchor="end" fill="#ffffff" fill-opacity="0.35"'
      + ' font-family="' + MONO + '" font-size="18">' + esc(short) + '</text>' : '')
    + '<text x="' + X + '" y="596" fill="' + GOLD + '" fill-opacity="0.8" font-family="' + MONO
    + '" font-size="22" letter-spacing="2">bnbbang.com</text>'
    + '</svg>';
}

module.exports = { composeOG, W, H, _wrap2: wrap2 };
