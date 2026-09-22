/*
 * 邀请卡片 —— /api/invite-card/<登记码>.png 与 /i/<登记码> 短链落地页
 * ------------------------------------------------------------
 * 以前邀请只有一条光秃秃的链接（quest.html?ref=<码>），发到 X 上预览图是任务页那张通用图，
 * 看不出「这是一张邀请」。现在每个登记码有一张自己的 1200×630 卡片：
 *   左栏：ARCBANG 字标、主口号、「Free mint on Arc · 887 free」、邀请码、网址；
 *   右边：一枚真实的 Arc 区块宇宙（方卡原样缩小，和 NFT 是同一份矢量）；
 *   整张底：模拟器真跑出来的那张宇宙网（art.js 的统一底图）。
 * **不印价格、人数、名次**（这些会变，而卡片按码缓存一天）。
 *
 * 右边那枚宇宙：按登记码确定性地从一小组「能诞生观察者」的主网区块里挑一个。
 * 这组区块是 2026-09-22 从 Arc 主网（chainId 5042）现取、现算出来的（全部 D=3、
 * OBSERVERS_POSSIBLE），哈希与高度写死在这里 —— 出卡片不打 RPC，也不占算卡预算。
 * 其他链（排练站）上这些高度不是真的，所以只在主网印「UNIVERSE #高度」，别处不印。
 *
 * 出图走 png.js 的 pngFor（落盘缓存 + 并发闸 + 绝不 500），缓存文件名带 CARD_VER：
 * 改了版式就把它 +1，旧卡自然作废。
 *
 * /i/<码>：社交爬虫拿一张带 og:image 的极小 HTML，真人直接 302 去任务页。
 * 这里和 /s/ 的取舍不同：/s/ 要进搜索索引，所以是爬虫与人同一份真页面；
 * /i/ 只是一个邀请跳板，不该被收录（noindex），人进来要的是立刻落到登记表单上。
 * 爬虫那份 HTML 里也带 meta refresh 和链接 —— UA 名单判漏了，人也照样走得到任务页。
 */
'use strict';
const fs = require('fs');
const { renderSVG, BASE_FILE } = require('./art.js');

const CARD_VER = 1;
const W = 1200, H = 630;
const F = 'Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,Menlo,Consolas,monospace';
const GOLD = '#ffd08c';
const MAINNET_CHAIN_ID = 5042;

/* [高度, 哈希]。全部是 Arc 主网上 OBSERVERS_POSSIBLE、D=3 的区块。 */
const PICKS = [
  [22120857, '0xd050b365c446e293856e2b49113904d719aee770a656e0702fc9baf0d9f3e67c'],
  [22120672, '0xef36dd4238e5542beda3fefa3066e516c84ad2599bbe01fa679f3379fb33db30'],
  [22120561, '0x9b5148196c70e6217e2ed2c4a5432f741fcde80dd2d597e12f26fcc5d7b74197'],
  [22117749, '0x26c2a77854bdb9872b57dda673217c59268ec0cc2b93514c095e9418de3c4664'],
  [22113753, '0x5a00cab08189b543c58678fa0bf8f38836512a643c5bad0ec8a20a5b8087df7c'],
  [22113716, '0xc918eb1f16618dd6dbdba8ece4fd4002ae4ceb7c0c848403e18327e976167d04'],
  [22113013, '0xa44d93704c4b224e33668bac341d093839f2fcc2a13d27ddffb21184b7b126da'],
  [22112088, '0xbbd7fdd8ba179ce2e3ab7d2d968b12261747815b7abe4a1f576017a8d68f8c77'],
  [22111533, '0xd9eb4a1de5c19df0dbdb9f791f6066a47f4d59c5a9b58cf8583f29ec80f3aaa6'],
  [22111274, '0x918d4cf32b8d37e625d7ed4a1af28631733c6595b7b24a7c0e87ecefb61b7f89']
];

const CODE_RE = /^[A-Z0-9]{6}$/;
/** 登记码归一：大小写都收，其余一律 null */
function normCode(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
}

/** 按码挑一枚宇宙：同一个码永远是同一枚（FNV-1a，够散，不依赖 crypto） */
function pickFor(code) {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const [n, hash] = PICKS[h % PICKS.length];
  return { blockNumber: n, hash };
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const brandOf = () => String(process.env.ARCBANG_BRAND || '').trim() || 'ARCBANG';
const chainWordOf = () => String(process.env.ARCBANG_CHAIN_WORD || '').trim() || 'Arc';
const siteHostOf = () => String(process.env.ARCBANG_PUBLIC_BASE || 'https://arcbang.xyz')
  .replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'arcbang.xyz';
/** 跳转时带的 v=：与前端 config.arc.js 的 shareVer 同口径，改那边时这边配 ARCBANG_SHARE_VER */
const shareVerOf = () => String(process.env.ARCBANG_SHARE_VER || '2').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16);

/**
 * 拼卡片 SVG。
 * @param {string} code  已归一的登记码
 * @param {object} o
 * @param {string} o.baseURI   底图 data URI（art.js 那张统一底图）
 * @param {string} o.cardSVG   右边那枚宇宙的方卡 SVG（renderSVG 原样输出）
 */
function composeInvite(code, o) {
  const CX = 704, CY = 92, CS = 446;             // 右边方卡：446×446，上下留白对称
  const inner = String(o.cardSVG || '').replace(/^<svg\b([^>]*)>/, (m, attrs) => {
    const kept = attrs.replace(/\s(width|height|x|y)="[^"]*"/g, '');
    return '<svg' + kept + ' x="' + CX + '" y="' + CY + '" width="' + CS + '" height="' + CS + '">';
  });
  const X = 64;
  const chain = chainWordOf();
  const url = siteHostOf() + '/quest.html?ref=' + code;
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + ' viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">'
    + '<defs>'
    + '<linearGradient id="ivl" x1="0" y1="0" x2="1" y2="0">'
    + '<stop offset="0%" stop-color="#03050c" stop-opacity="0.94"/>'
    + '<stop offset="50%" stop-color="#03050c" stop-opacity="0.80"/>'
    + '<stop offset="100%" stop-color="#03050c" stop-opacity="0.35"/>'
    + '</linearGradient>'
    + '<filter id="ivs" x="-10%" y="-10%" width="120%" height="120%">'
    + '<feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.6"/></filter>'
    + '</defs>'
    + '<rect width="' + W + '" height="' + H + '" fill="#03050c"/>'
    + (o.baseURI ? '<image x="0" y="-285" width="1200" height="1200" preserveAspectRatio="xMidYMid slice"'
      + ' xlink:href="' + o.baseURI + '"/>' : '')
    + '<rect width="' + W + '" height="' + H + '" fill="url(#ivl)"/>'
    // 右边那枚宇宙：阴影 + 细边框，像一张摆在桌上的卡
    + (inner
      ? '<rect x="' + CX + '" y="' + CY + '" width="' + CS + '" height="' + CS + '" rx="4" fill="#03050c" filter="url(#ivs)"/>'
        + inner
        + '<rect x="' + (CX - 0.5) + '" y="' + (CY - 0.5) + '" width="' + (CS + 1) + '" height="' + (CS + 1)
        + '" rx="4" fill="none" stroke="#ffffff" stroke-opacity="0.28"/>'
      : '')
    // 左栏
    + '<text x="' + X + '" y="104" fill="' + GOLD + '" font-family="' + MONO
    + '" font-size="34" letter-spacing="11">' + esc(brandOf()) + '</text>'
    + '<text x="' + X + '" y="156" fill="#ffffff" fill-opacity="0.78" font-family="' + F
    + '" font-size="25" font-weight="300">Every ' + esc(chain) + ' block hash is a universe.</text>'
    + '<text x="' + X + '" y="268" fill="#ffffff" font-family="' + F
    + '" font-size="56" font-weight="700" letter-spacing="-1">Free mint on ' + esc(chain) + '</text>'
    + '<text x="' + X + '" y="336" fill="' + GOLD + '" font-family="' + F
    + '" font-size="56" font-weight="700" letter-spacing="-1">· 887 free</text>'
    + '<line x1="' + X + '" y1="392" x2="620" y2="392" stroke="#ffffff" stroke-opacity="0.18"/>'
    + '<text x="' + X + '" y="444" fill="#ffffff" fill-opacity="0.62" font-family="' + F
    + '" font-size="22" letter-spacing="2">Invite code:</text>'
    + '<text x="' + X + '" y="508" fill="#ffffff" font-family="' + MONO
    + '" font-size="58" font-weight="700" letter-spacing="10">' + esc(code) + '</text>'
    + '<text x="' + X + '" y="580" fill="' + GOLD + '" fill-opacity="0.9" font-family="' + MONO
    + '" font-size="21">' + esc(url) + '</text>'
    + '</svg>';
}

/**
 * 拼整张卡片的 SVG（给 pngFor 的 buildSVG 用）。
 * @param {string} code
 * @param {{cardFor:function, chainId:number, baseURI?:function}} deps
 */
function inviteSVG(code, deps) {
  const pick = pickFor(code);
  let cardSVG = '';
  try {
    const card = Object.assign({}, deps.cardFor(pick.hash, null).card);
    card.blockNumber = Number(deps.chainId) === MAINNET_CHAIN_ID ? pick.blockNumber : null;
    cardSVG = renderSVG(pick.hash, card, true, true);      // 缩略底图就够：卡在图上只有 446px
  } catch (e) {
    console.error('[invite] 右边那枚宇宙渲不出来，只出左栏：' + (e && e.message));
  }
  let base = '';
  try { base = (deps.baseURI || baseURI)(); } catch (e) { base = ''; }   // 底图缺了就纯黑底，不挂
  return composeInvite(code, { baseURI: base, cardSVG });
}

/* 整张卡的底：art.js 那张统一底图（1200 全尺寸，卡片要铺满 1200 宽）。读一次留着。 */
let BASE_URI = null;
function baseURI() {
  if (BASE_URI == null) BASE_URI = 'data:image/jpeg;base64,' + fs.readFileSync(BASE_FILE).toString('base64');
  return BASE_URI;
}

/** 社交平台抓预览的 UA。判漏了不要紧：爬虫那份 HTML 对人也能用（meta refresh）。 */
const BOT_RE = /Twitterbot|facebookexternalhit|Facebot|LinkedInBot|Slackbot|TelegramBot|Discordbot|WhatsApp|Applebot|redditbot|Pinterest|SkypeUriPreview|vkShare|Embedly|Iframely|Mastodon|Bluesky|Cardyb|MicroMessenger.*Bot|bingbot|Googlebot|Google-InspectionTool|DuckDuckBot|YandexBot|Baiduspider|ia_archiver|LINE-Parts|Line\/|KAKAOTALK-scrap|Snapchat|Tumblr|Viber/i;
function isBot(ua) { return BOT_RE.test(String(ua || '')); }

/** 真人要去的地方（相对路径，和 /s/ 的 questUrl 一个口径） */
function questUrlOf(code) {
  const v = shareVerOf();
  return '/quest.html?ref=' + encodeURIComponent(code) + (v ? '&v=' + encodeURIComponent(v) : '');
}

/** 爬虫那份 HTML：og / twitter 卡片 + 给人兜底的 refresh */
function crawlerHTML(code, base) {
  const brand = brandOf(), chain = chainWordOf();
  const title = brand + ' · Invite ' + code;
  const desc = 'Every ' + chain + ' block hash is a universe. Free mint on ' + chain
    + ', 887 free. Join with invite code ' + code + '.';
  const img = base + '/api/invite-card/' + code + '.png?v=' + CARD_VER;
  const canonical = base + '/i/' + code;
  const dest = questUrlOf(code);
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="robots" content="noindex, follow">'
    + '<meta name="description" content="' + esc(desc) + '">'
    + '<link rel="canonical" href="' + esc(canonical) + '">'
    + '<meta property="og:type" content="website">'
    + '<meta property="og:site_name" content="' + esc(brand) + '">'
    + '<meta property="og:title" content="' + esc(title) + '">'
    + '<meta property="og:description" content="' + esc(desc) + '">'
    + '<meta property="og:url" content="' + esc(canonical) + '">'
    + '<meta property="og:image" content="' + esc(img) + '">'
    + '<meta property="og:image:type" content="image/png">'
    + '<meta property="og:image:width" content="1200">'
    + '<meta property="og:image:height" content="630">'
    + '<meta property="og:image:alt" content="' + esc(brand + ' invite card, code ' + code) + '">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<meta name="twitter:site" content="@arcbang_xyz">'
    + '<meta name="twitter:title" content="' + esc(title) + '">'
    + '<meta name="twitter:description" content="' + esc(desc) + '">'
    + '<meta name="twitter:image" content="' + esc(img) + '">'
    + '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '">'
    + '</head><body><p><a href="' + esc(dest) + '">' + esc(desc) + '</a></p></body></html>';
}

module.exports = {
  CARD_VER, PICKS, normCode, pickFor, composeInvite, inviteSVG, isBot, questUrlOf, crawlerHTML, W, H
};
