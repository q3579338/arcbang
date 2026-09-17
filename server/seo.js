/*
 * 可索引集合与 sitemap —— /s/ 落地页哪些让搜索引擎收，哪些不收
 * ------------------------------------------------------------
 * 区块要多少有多少：/s/<高度> 有一亿多个合法 URL。全放开等于让爬虫把服务器当引擎跑
 * （每个没算过的宇宙都是一次冷算 + 一次出图），而且搜索引擎会把它当成垃圾站降权。
 * 所以只有三类页面给 index，其余一律 noindex, follow（**页面照样服务**，分享预览不受影响）：
 *   1. 已铸造的 —— marketindex 反查得到（mintStatusOf），那是真有主人的宇宙；
 *   2. 人工精选 —— BNBBANG_SHARE_CURATED 指向一个 JSON 数组文件（高度列表）；
 *      没配就只有内置的 [0]；
 *   3. 别的进程写出来的附加名单 —— BNBBANG_SHARE_EXTRA（比如「今天最好看的十个」）。
 * 两个文件都是 60 秒读一次；缺了、坏了、不是数组 → 当空，绝不因此让落地页出错。
 *
 * sitemap 只列有高度的宇宙：/s/<0x哈希> 那种链接（造物起源、老存档）没有高度，
 * 而同一个宇宙同时有两个 URL 会被当成重复内容。单个 sitemap 上限 45,000 条
 * （规范是 50,000 / 50 MB，留一点余量），超了就出 sitemap index 分页。
 */
'use strict';
const fs = require('fs');
const MI = require('./marketindex.js');

const CURATED_DEFAULT = [0];          // 创世块：没配精选名单时唯一一个进索引的非铸造页
const PAGE = 45000;
const FILE_TTL_MS = 60000;
const MAX_HEIGHT = 999999999999;      // 与 /s/ 路由的 \d{1,12} 同口径

/** 读一个「高度数组」JSON 文件。任何异常都当空数组：这只是名单，不是数据。 */
function readHeights(file) {
  if (!file) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return []; }
  if (!Array.isArray(j)) return [];
  const seen = new Set();
  for (const v of j) {
    const n = typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : v;
    if (Number.isSafeInteger(n) && n >= 0 && n <= MAX_HEIGHT) seen.add(n);
    if (seen.size >= 200000) break;    // 名单不该比 sitemap 本身还大
  }
  return Array.from(seen);
}

/* 两份名单各带一个 60 秒缓存，键是文件路径（env 可以在测试里换）。 */
const cache = { curated: null, extra: null };
function cached(slot, file, fallback) {
  const now = Date.now();
  const c = cache[slot];
  if (c && c.file === file && now - c.at < FILE_TTL_MS) return c.list;
  const list = file ? readHeights(file) : fallback;
  cache[slot] = { file, at: now, list };
  return list;
}
function curatedHeights() {
  return cached('curated', process.env.BNBBANG_SHARE_CURATED || '', CURATED_DEFAULT);
}
function extraHeights() {
  return cached('extra', process.env.BNBBANG_SHARE_EXTRA || '', []);
}

/**
 * 这一页要不要进索引。
 * @param {number|null} height  URL 里的高度（哈希形式的链接为 null）
 * @param {boolean} minted      marketindex 反查到已铸造
 */
function inIndexSet(height, minted) {
  if (minted) return true;
  if (!Number.isSafeInteger(height)) return false;
  return curatedHeights().indexOf(height) >= 0 || extraHeights().indexOf(height) >= 0;
}

/**
 * 名单 ∪ 已铸 → 升序去重的 [{n, at}]。纯函数，btc 站（specs/btcbang-v1.md）拿它合自己那套
 * 名单（创世 / 减半 / 名块）与已铸的比特币宇宙，规则与这里一字不差。
 * @param {number[]} curated              名单里的高度（无时间戳）
 * @param {Array<{n:number,at:number|null}>} minted  已铸的
 */
function mergeHeights(curated, minted) {
  const m = new Map();
  for (const n of curated || []) {
    if (Number.isSafeInteger(n) && n >= 0 && n <= MAX_HEIGHT && !m.has(n)) m.set(n, null);
  }
  for (const x of minted || []) {
    if (!x || !Number.isSafeInteger(x.n) || x.n < 0 || x.n > MAX_HEIGHT) continue;
    // 已铸造的带时间戳；同一高度精选又铸造了，以铸造时间为准
    if (!m.has(x.n) || m.get(x.n) == null) m.set(x.n, x.at || null);
  }
  return Array.from(m.entries()).map(([n, at]) => ({ n, at })).sort((a, b) => a.n - b.n);
}

/** 全部应进索引的高度，升序去重：[{n, at}]，at = 铸造时间戳（秒）或 null */
function indexHeights() {
  let minted = [];
  try { minted = MI.mintedHeights(); } catch (e) { minted = []; }
  return mergeHeights(curatedHeights().concat(extraHeights()), minted);
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dateOf = sec => new Date(sec * 1000).toISOString().slice(0, 10);

function urlsetXML(base, items) {
  let out = XML_HEAD + '<urlset xmlns="' + NS + '">\n';
  for (const it of items) {
    out += '<url><loc>' + escXml(base + '/s/' + it.n) + '</loc>'
      + (it.at ? '<lastmod>' + dateOf(it.at) + '</lastmod>' : '')
      + '</url>\n';
  }
  return out + '</urlset>\n';
}
function indexXML(base, pages) {
  let out = XML_HEAD + '<sitemapindex xmlns="' + NS + '">\n';
  for (let k = 1; k <= pages; k++) {
    out += '<sitemap><loc>' + escXml(base + '/sitemap-s-' + k + '.xml') + '</loc></sitemap>\n';
  }
  return out + '</sitemapindex>\n';
}

/**
 * 出 sitemap。纯函数部分抽出来（heights 传进来），路由和自检共用。
 * @param {string} base        PUBLIC_BASE
 * @param {number|null} page   null = /sitemap-s.xml；k = /sitemap-s-<k>.xml（1 起）
 * @param {Array<{n:number,at:number|null}>} [heights]  不传就现算
 * @returns {{status:number, xml:string}}  status 404 = 没有这一页
 */
function sitemap(base, page, heights) {
  const all = heights || indexHeights();
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  if (page == null) {
    if (pages > 1) return { status: 200, xml: indexXML(base, pages) };
    return { status: 200, xml: urlsetXML(base, all) };
  }
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
    return { status: 404, xml: urlsetXML(base, []) };
  }
  return { status: 200, xml: urlsetXML(base, all.slice((page - 1) * PAGE, page * PAGE)) };
}

module.exports = {
  inIndexSet, indexHeights, mergeHeights, sitemap, curatedHeights, extraHeights,
  PAGE,
  /** 自检用：把两份名单的 60 秒缓存清掉（换了 env 路径立刻生效） */
  _reset: () => { cache.curated = null; cache.extra = null; }
};
