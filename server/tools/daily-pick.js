#!/usr/bin/env node
/*
 * 每日稀有宇宙 —— 给官方号每天一条推文挑素材
 * ------------------------------------------------------------
 * 1. 问 Arc 主网最新高度，从「最新往回 RANGE 块」里随机抽 SAMPLE 个高度（每天换一段，不会老是同一截）。
 * 2. 逐个取区块哈希，**本地**调 card.js 的 buildCard 算卡（与 /api/card 同一个函数，
 *    不走 HTTP，所以不吃全站限流，也不占 API 进程的 CPU 桶）。
 * 3. 按稀有度打分挑 1 个：OBSERVERS_POSSIBLE > STARS_NO_LIFE > D≠3（越怪越高）> 稀有度 S/A；
 *    7 天内挑过的区块排除。
 * 4. 写 .store/daily-picks.json，加 --push 时经 PushPlus 推到微信（失败只记日志）。
 *
 * 用法（服务器上）：
 *   systemctl start arcbang-daily-pick.service       # 与定时器同一条路径
 *   node tools/daily-pick.js [--push] [--dry] [--sample 400] [--range 3000]
 *     --dry  只打印，不写存档、不推送
 *
 * 环境：ARCBANG_RPC（/etc/arcbang/api.env）、ARCBANG_STORE、
 *       BTT_PUSHPLUS_TOKEN（/etc/btt-monitor.env，systemd 注入，**不打印、不入库**）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..');
const { buildCard } = require(path.join(SERVER, 'card.js'));
const chain = require(path.join(SERVER, 'chain.js'));
const { writeAtomic } = require(path.join(SERVER, 'atomic.js'));

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };

const SAMPLE = opt('--sample', 400);
const RANGE = opt('--range', 3000);
const DRY = flag('--dry');
const PUSH = flag('--push') && !DRY;
const EXCLUDE_DAYS = 7;
const KEEP = 120;                         // 存档只留最近这么多条

const PUBLIC_BASE = (process.env.ARCBANG_PUBLIC_BASE || 'https://arcbang.xyz').replace(/\/+$/, '');
const API_LOCAL = 'http://127.0.0.1:' + (process.env.ARCBANG_PORT || 8803);
const STORE_DIR = process.env.ARCBANG_STORE || path.join(SERVER, '.store');
const PICKS_FILE = path.join(STORE_DIR, 'daily-picks.json');

const log = (...a) => console.log('[daily-pick]', ...a);

/* ---------------- 文案素材 ---------------- */

const OUTCOME_EN = {
  UNSTABLE_ORBITS: 'No stable orbits',
  BIG_CRUNCH: 'Big Crunch',
  BIG_RIP: 'Big Rip',
  HEAT_DEATH_NO_STRUCTURE: 'Heat death, no structure',
  BLACK_HOLE_DOMINATED: 'Black-hole dominated',
  NO_ATOMS: 'No atoms',
  NO_CHEMISTRY: 'No chemistry',
  NO_STARS: 'No stars',
  STARS_NO_LIFE: 'Stars but no life',
  OBSERVERS_POSSIBLE: 'Observers possible',
  NO_CARBON_CHEMISTRY: 'No carbon-water chemistry',
  BEYOND_MODEL_DIM: 'Beyond the model (D≠3)'
};
const OUTCOME_ZH_SHORT = { BEYOND_MODEL_DIM: '超出模型适用范围（D≠3）' };

const ALPHA0 = 1 / 137.035999084;
/* 「我们的宇宙」= 各比值 1。偏离度取 |log10(比值)|：10 倍与 1/10 一样远。 */
const CONST_DEFS = [
  { key: 'G', en: 'G', zh: '引力常数 G', get: (c) => c.G && c.G.ratio },
  { key: 'c', en: 'c', zh: '光速 c', get: (c) => c.c && c.c.ratio },
  { key: 'h', en: 'h', zh: '普朗克常数 h', get: (c) => c.h && c.h.ratio },
  { key: 'e', en: 'e', zh: '元电荷 e', get: (c) => c.e && c.e.ratio },
  { key: 'alpha', en: 'α', zh: '精细结构常数 α', get: (c) => (c.alpha ? c.alpha / ALPHA0 : null) }
  /* α_G 不列：它基本就是 G 换了个单位，和 G 一起出现等于同一个数说两遍。 */
];

/* 普通结局的英文说法（「a universe …」后面接的那半句） */
const OUTCOME_PHRASE = {
  UNSTABLE_ORBITS: 'where no orbit is stable',
  BIG_CRUNCH: 'that collapses back in a Big Crunch',
  BIG_RIP: 'that tears itself apart in a Big Rip',
  HEAT_DEATH_NO_STRUCTURE: 'that fades into a structureless heat death',
  BLACK_HOLE_DOMINATED: 'swallowed by black holes',
  NO_ATOMS: 'where atoms never form',
  NO_CHEMISTRY: 'with atoms but no chemistry',
  NO_STARS: 'where no star ever ignites',
  NO_CARBON_CHEMISTRY: 'with stars but no carbon-water chemistry'
};

function sig(x) {
  if (x >= 100) return Math.round(x).toLocaleString('en-US');
  if (x >= 10) return x.toFixed(1).replace(/\.0$/, '');
  return String(Number(x.toFixed(2)));
}
/** 比值 → "3.2× ours" / "1/40 of ours" */
function ratioEn(r) { return r >= 1 ? sig(r) + '× ours' : (r >= 0.1 ? sig(r) + '× ours' : '1/' + sig(1 / r) + ' of ours'); }
function ratioZh(r) { return r >= 0.1 ? '我们的 ' + sig(r) + ' 倍' : '我们的 1/' + sig(1 / r); }

function topConstants(card, n) {
  const cs = card.constants || {};
  return CONST_DEFS.map((d) => {
    const r = Number(d.get(cs));
    if (!Number.isFinite(r) || r <= 0) return null;
    return { key: d.key, en: d.en, zh: d.zh, ratio: r, dev: Math.abs(Math.log10(r)), textEn: d.en + ' = ' + ratioEn(r), textZh: d.zh + ' 是' + ratioZh(r) };
  }).filter(Boolean).sort((a, b) => b.dev - a.dev).slice(0, n);
}

function dimStr(D) {
  if (D == null) return '?';
  return Math.abs(D - Math.round(D)) < 1e-9 ? String(Math.round(D)) : D.toFixed(2).replace(/0$/, '');
}

/* ---------------- 打分 ---------------- */

function scoreOf(card) {
  const oid = card.outcome.id;
  const D = card.dimension ? card.dimension.D : null;
  let s = 0;
  if (oid === 'OBSERVERS_POSSIBLE') s += 1000;
  else if (oid === 'STARS_NO_LIFE') s += 700;
  if (D != null && Math.abs(D - 3) > 1e-9) {
    // D 越怪越好：离 3 越远越高，分数维再加一截（分数维只有约 5%）
    const frac = Math.abs(D - Math.round(D)) > 1e-9;
    s += 300 + 60 * Math.min(Math.abs(D - 3), 8) + (frac ? 120 : 0);
  }
  const rk = card.rarity && card.rarity.name;
  if (rk === 'S') s += 200; else if (rk === 'A') s += 250;          // A（三维却死了）比 S 还罕见
  // 同档之间：常数离我们越远越有看头；档位（tier.p 越小越稀）再加一点
  const dev = topConstants(card, 3).reduce((a, x) => a + x.dev, 0);
  s += Math.min(dev, 6) * 15;
  if (card.tier && card.tier.p > 0) s += Math.min(-Math.log10(card.tier.p), 4) * 10;
  return s;
}

/* ---------------- 推文 ---------------- */

/** X 的计数：URL 一律 23；CJK 等记 2，拉丁与常用标点记 1（twitter-text v3 的区间）。 */
function xLength(text) {
  let n = 0;
  const urlRe = /https?:\/\/\S+/g;
  const stripped = text.replace(urlRe, () => { n += 23; return ''; });
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    const light = (cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    n += light ? 1 : 2;
  }
  return n;
}

/* 「今天扫的 N 个区块里只有 k 个」—— 用当天样本说稀有，不引用会过期的全局百分比。 */
function luckEn(k, n) { return n ? ' Only ' + k + ' of the ' + n + ' blocks we scanned today did.' : ''; }
function luckZh(k, n) { return n ? '今天扫的 ' + n + ' 个区块里只有 ' + k + ' 个。' : ''; }

function hookEn(card, num, k, n) {
  const oid = card.outcome.id;
  const D = card.dimension ? card.dimension.D : null;
  const d = dimStr(D);
  const blk = 'Arc block #' + num.toLocaleString('en-US');
  if (oid === 'OBSERVERS_POSSIBLE') return blk + ' detonated into a ' + d + 'D universe where observers could exist.' + luckEn(k, n);
  if (oid === 'STARS_NO_LIFE') return blk + ' built a universe with stars, planets and chemistry, but no life ever wakes up.' + luckEn(k, n);
  if (D != null && Math.abs(D - 3) > 1e-9) return blk + ' detonated into a ' + d + '-dimensional universe. Our 3D physics can\'t even describe it.';
  return blk + ' detonated into a universe ' + (OUTCOME_PHRASE[oid] || '(' + (OUTCOME_EN[oid] || oid) + ')') + '.';
}
function hookZh(card, num, k, n) {
  const oid = card.outcome.id;
  const D = card.dimension ? card.dimension.D : null;
  const d = dimStr(D);
  const blk = 'Arc 第 ' + num + ' 块';
  if (oid === 'OBSERVERS_POSSIBLE') return blk + '炸出了一个可能诞生观察者的 ' + d + ' 维宇宙。' + luckZh(k, n);
  if (oid === 'STARS_NO_LIFE') return blk + '炸出一个有恒星、行星、化学，却始终没有生命的宇宙。' + luckZh(k, n);
  if (D != null && Math.abs(D - 3) > 1e-9) return blk + '炸出一个 ' + d + ' 维宇宙，我们的三维物理根本描述不了它。';
  return blk + '炸出的宇宙：' + card.outcome.name + '。';
}

function composeTweets(card, num, link, sameCount, scanned) {
  const top = topConstants(card, 3);
  const tail = '@arc #ARCBANG #FreeMint';
  const hook = hookEn(card, num, sameCount, scanned);
  let en = null;
  // 两个关键数：先试两条常数；超长就退到一条、再退到不带长句
  for (const k of [2, 1]) {
    const nums = top.slice(0, k).map((x) => x.textEn).join(', ') + '.';
    const t = hook + '\n\n' + nums + '\n\nDetonate your own block & get WL: ' + link + '\n\n' + tail;
    if (xLength(t) <= 270) { en = t; break; }
  }
  if (!en) en = hookEn(card, num, 0, 0).split('. ')[0] + '.\n\nDetonate your own & get WL: ' + link + '\n\n' + tail;

  const hz = hookZh(card, num, sameCount, scanned);
  let zh = null;
  for (const k of [2, 1, 0]) {
    const nums = k ? top.slice(0, k).map((x) => x.textZh).join('，') + '。\n\n' : '';
    const t = hz + '\n\n' + nums + '来引爆你自己的区块、拿白名单：' + link + '\n\n' + tail;
    if (xLength(t) <= 270) { zh = t; break; }
  }
  if (!zh) zh = hz + '\n' + link + '\n' + tail;
  return { en, zh, top };
}

/* ---------------- 链 ---------------- */

async function latestBlock() {
  let lastErr;
  for (const url of chain.RPCS) {
    try { return parseInt(await chain.rpc(url, 'eth_blockNumber', []), 16); }
    catch (e) { lastErr = e; }
  }
  throw new Error('取最新高度失败：' + (lastErr && lastErr.message));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => ({ error: e })); }
  }));
  return out;
}

/* ---------------- 存档 ---------------- */

function readPicks() {
  try {
    const j = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
    return Array.isArray(j.picks) ? j : { picks: [] };
  } catch (e) { return { picks: [] }; }
}

/* ---------------- 推送 ---------------- */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function pushplus(pick) {
  const token = process.env.BTT_PUSHPLUS_TOKEN;
  if (!token) { log('没有 BTT_PUSHPLUS_TOKEN，跳过推送（区块 #' + pick.blockNumber + '，' + pick.outcome.zh + '）'); return false; }
  const pre = 'white-space:pre-wrap;word-break:break-word;background:#f4f5f7;padding:10px;border-radius:6px;font-family:inherit';
  const content =
    '<p><b>区块 #' + pick.blockNumber + '</b> · ' + esc(pick.outcome.zh) + ' / ' + esc(pick.outcome.en) +
    ' · D=' + esc(pick.dimensionText) + ' · 稀有度 ' + esc(pick.rarity) + '</p>' +
    '<p><b>英文推文</b>（X 计 ' + pick.tweet.enLength + '）</p><pre style="' + pre + '">' + esc(pick.tweet.en) + '</pre>' +
    '<p><b>分享图</b>：<a href="' + esc(pick.imageUrl) + '">' + esc(pick.imageUrl) + '</a></p>' +
    '<p><b>站内链接</b>：<a href="' + esc(pick.siteUrl) + '">' + esc(pick.siteUrl) + '</a></p>' +
    '<p><b>中文备用</b>（X 计 ' + pick.tweet.zhLength + '）</p><pre style="' + pre + '">' + esc(pick.tweet.zh) + '</pre>' +
    '<p style="color:#888">三条最偏离的常数：' + esc(pick.constants.map((c) => c.textZh).join('；')) +
    '<br>哈希 ' + esc(pick.blockHash) + '<br>从 ' + pick.sampled + ' 个区块里挑出，得分 ' + pick.score + '</p>';
  for (let i = 0; i < 3; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch('https://www.pushplus.plus/send', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ token, title: 'ARCBANG 今日推文素材', content, template: 'html' })
      }).finally(() => clearTimeout(t));
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.code === 200) { log('PushPlus 已推送（区块 #' + pick.blockNumber + '，' + pick.outcome.zh + '）'); return true; }
      log('PushPlus 返回异常（区块 #' + pick.blockNumber + '，' + pick.outcome.zh + '）：HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    } catch (e) {
      log('PushPlus 推送失败（区块 #' + pick.blockNumber + '，' + pick.outcome.zh + '）：' + (e && e.message));
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return false;
}

/* 出一次图：让分享图先进缓存，顺便确认端点能用（本机回环，只打一次）。 */
async function warmImage(hash) {
  const tries = [
    ['art', API_LOCAL + '/art/' + hash + '.png?p=1', PUBLIC_BASE + '/api/art/' + hash + '.png?p=1'],
    ['svg', API_LOCAL + '/art/' + hash + '.svg?p=1', PUBLIC_BASE + '/api/art/' + hash + '.svg?p=1']
  ];
  for (const [kind, local, pub] of tries) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 60000);
      const r = await fetch(local, { signal: ctl.signal }).finally(() => clearTimeout(t));
      const ct = r.headers.get('content-type') || '';
      await r.arrayBuffer();
      if (r.ok && /image/.test(ct)) return { url: pub, ok: true, kind, status: r.status };
      log('出图端点 ' + kind + ' 不可用：HTTP ' + r.status + ' ' + ct);
    } catch (e) { log('出图端点 ' + kind + ' 请求失败：' + (e && e.message)); }
  }
  return { url: tries[0][2], ok: false, kind: 'art', status: null };
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const t0 = Date.now();
  const tip = await latestBlock();
  const lo = Math.max(1, tip - RANGE + 1);
  const heights = new Set();
  const want = Math.min(SAMPLE, tip - lo + 1);
  while (heights.size < want) heights.add(lo + Math.floor(Math.random() * (tip - lo + 1)));

  const store = readPicks();
  const cutoff = Date.now() - EXCLUDE_DAYS * 86400e3;
  const recent = new Set();
  store.picks.filter((p) => Date.parse(p.pickedAt) >= cutoff).forEach((p) => { recent.add(p.blockNumber); recent.add(p.blockHash); });

  const blocks = await mapLimit([...heights], 6, (n) => chain.blockByNumber(n));
  const cands = [];
  let rpcErr = 0;
  for (const b of blocks) {
    if (!b || b.error) { rpcErr++; continue; }
    if (recent.has(b.number) || recent.has(b.hash)) continue;
    try {
      const r = buildCard(b.hash, b.number);
      cands.push({ b, card: r.card, cardHash: r.cardHash, score: scoreOf(r.card) });
    } catch (e) { log('算卡失败 #' + b.number + '：' + e.message); }
  }
  if (!cands.length) throw new Error('没有可用候选（最新 #' + tip + '，RPC 失败 ' + rpcErr + ' 个）');

  const dist = {};
  cands.forEach((c) => { const k = c.card.outcome.id; dist[k] = (dist[k] || 0) + 1; });
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  const { b, card } = best;

  const siteUrl = PUBLIC_BASE + '/s/' + b.number;
  const img = DRY ? { url: PUBLIC_BASE + '/api/art/' + b.hash + '.png?p=1', ok: null } : await warmImage(b.hash);
  const tw = composeTweets(card, b.number, siteUrl, dist[card.outcome.id], cands.length);
  const D = card.dimension ? card.dimension.D : null;

  const pick = {
    date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10),   // 北京日期
    pickedAt: new Date().toISOString(),
    blockNumber: b.number,
    blockHash: b.hash,
    cardHash: best.cardHash || null,
    outcome: { id: card.outcome.id, index: card.outcome.index, zh: OUTCOME_ZH_SHORT[card.outcome.id] || card.outcome.name, en: OUTCOME_EN[card.outcome.id] || card.outcome.id },
    dimension: D,
    dimensionText: dimStr(D),
    rarity: card.rarity.name,
    tier: card.tier ? card.tier.name : null,
    constants: tw.top.map((x) => ({ key: x.key, ratio: x.ratio, textEn: x.textEn, textZh: x.textZh })),
    imageUrl: img.url,
    imageOk: img.ok,
    siteUrl,
    tweet: { en: tw.en, enLength: xLength(tw.en), zh: tw.zh, zhLength: xLength(tw.zh) },
    score: Math.round(best.score),
    sampled: cands.length,
    range: [lo, tip],
    distribution: dist,
    runnersUp: cands.slice(1, 4).map((c) => ({ blockNumber: c.b.number, outcome: c.card.outcome.id, D: c.card.dimension ? c.card.dimension.D : null, rarity: c.card.rarity.name, score: Math.round(c.score) })),
    pushed: null
  };

  if (PUSH) pick.pushed = await pushplus(pick);

  if (!DRY) {
    store.picks.push(pick);
    store.picks = store.picks.slice(-KEEP);
    store.updatedAt = pick.pickedAt;
    fs.mkdirSync(STORE_DIR, { recursive: true });
    writeAtomic(PICKS_FILE, JSON.stringify(store, null, 2) + '\n');
  }

  log('#' + b.number + ' ' + pick.outcome.id + ' D=' + pick.dimensionText + ' ' + pick.rarity + ' 分 ' + pick.score +
    '（候选 ' + cands.length + '，RPC 失败 ' + rpcErr + '，' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
  console.log(JSON.stringify(pick, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error('[daily-pick] 失败：' + (e && e.message)); process.exit(1); });
}

module.exports = { scoreOf, composeTweets, xLength, topConstants };
