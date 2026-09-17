/*
 * IndexNow 推送 —— 新铸造的 /s/<高度> 分享页一出现就报给 api.indexnow.org
 * ------------------------------------------------------------
 * 搜索引擎（Bing / Yandex / Naver / Seznam 共用一个入口）不会自己来翻 sitemap-s.xml，
 * 一枚 NFT 铸完到被收录往往要几周。IndexNow 是「你告诉我有新页」：一次 POST，回 200 / 202 即收到。
 *
 * 口径：
 *   · 只推**已铸造**的宇宙（marketindex 反查得到的那些），与 seo.js 的可索引集合同源；
 *     精选 / 附加名单不推 —— 那些页早就在 sitemap 里，且不会「新出现」。
 *   · 按站分组：BNB 来源推到 BNBBANG_PUBLIC_BASE，比特币来源推到 BTC 站（btc.originOf 判来源）；
 *     同一密钥两站各放一份同名文件，IndexNow 按 host 校验。
 *   · 推过的记在 .store/indexnow-pushed.json（{ "base|n": at }），进程重启不重推；
 *     失败（网络 / 429 / 5xx）不记，下一轮再试，但两次尝试至少隔 10 分钟，别把限速撞成封禁。
 *   · 一轮最多 10,000 条（IndexNow 单次上限）；余下的下一轮接着推。
 *   · 关掉：BNBBANG_INDEXNOW=0。换密钥：BNBBANG_INDEXNOW_KEY=<32hex>（web/<key>.txt 要一起换）。
 *   · 任何异常只进日志，绝不影响索引轮与 API —— 这是锦上添花的事，不是主链路。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./atomic.js');

const DEFAULT_KEY = '654dba6aba1548264ddc12b90111e6cd';   // 与 web/654d….txt 同一把（密钥文件内容就是密钥本身）
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_PER_POST = 10000;
const RETRY_GAP_MS = 10 * 60000;
const KEY_RE = /^[0-9a-f]{32}$/;

/** 挑出还没推过的：items = [{ n, base }]，pushed = Set("base|n") → 按 base 分组的 URL 表 */
function groupNew(items, pushed) {
  const groups = new Map();
  for (const it of items || []) {
    if (!it || typeof it.base !== 'string' || !/^https:\/\/[a-z0-9.-]+$/i.test(it.base)) continue;
    if (!Number.isSafeInteger(it.n) || it.n < 0) continue;
    const k = it.base + '|' + it.n;
    if (pushed.has(k)) continue;
    if (!groups.has(it.base)) groups.set(it.base, []);
    groups.get(it.base).push(it.n);
  }
  return groups;
}

function create(opts) {
  const o = opts || {};
  const storeDir = o.storeDir || path.join(__dirname, '.store');
  const file = path.join(storeDir, 'indexnow-pushed.json');
  const enabled = o.enabled != null ? !!o.enabled : !/^(0|off|false|no)$/i.test(String(process.env.BNBBANG_INDEXNOW || '1'));
  const keyRaw = String(o.key || process.env.BNBBANG_INDEXNOW_KEY || DEFAULT_KEY).trim().toLowerCase();
  const key = KEY_RE.test(keyRaw) ? keyRaw : DEFAULT_KEY;
  let fetchImpl = o.fetch || null;
  let nowFn = o.now || Date.now;
  const log = o.log || ((s) => console.log('[indexnow] ' + s));

  let pushed = null;                  // Map "base|n" → at
  const lastTry = new Map();          // base → 上次尝试时间（失败退避）
  const stats = { rounds: 0, posted: 0, urls: 0, failed: 0, lastCode: null, lastAt: 0 };

  function load() {
    if (pushed) return pushed;
    pushed = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && typeof j === 'object') for (const [k, v] of Object.entries(j)) if (/^https:\/\/[^|]+\|\d{1,12}$/.test(k)) pushed.set(k, Number(v) || 0);
    } catch (e) { /* 没有就是没推过 */ }
    return pushed;
  }
  function save() {
    const obj = {};
    for (const [k, v] of pushed) obj[k] = v;
    try { writeAtomic(file, JSON.stringify(obj)); } catch (e) { log('记录写不下去（下次可能重推，无害）：' + (e && e.message)); }
  }

  async function post(base, host, urls) {
    const f = fetchImpl || globalThis.fetch;
    if (typeof f !== 'function') throw new Error('没有 fetch（Node ≥ 18）');
    const body = { host, key, keyLocation: base + '/' + key + '.txt', urlList: urls };
    const r = await f(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined
    });
    return r && r.status;
  }

  /** 一轮：items = [{ n, base }]。返回 { posted, urls, skipped } —— 只为测试与 /status 看。 */
  async function pushRound(items) {
    const out = { posted: 0, urls: 0, skipped: 0, codes: {} };
    if (!enabled) return out;
    stats.rounds++;
    const set = load();
    const groups = groupNew(items, new Set(set.keys()));
    const now = nowFn();
    for (const [base, ns] of groups) {
      const last = lastTry.get(base) || 0;
      if (now - last < RETRY_GAP_MS && last) { out.skipped += ns.length; continue; }
      const host = base.replace(/^https:\/\//i, '');
      const batch = ns.slice(0, MAX_PER_POST);
      const urls = batch.map((n) => base + '/s/' + n);
      lastTry.set(base, now);
      let code = null;
      try { code = await post(base, host, urls); }
      catch (e) { log(host + '：推送失败（下一轮再试）：' + (e && e.message)); stats.failed++; out.codes[base] = 'error'; continue; }
      out.codes[base] = code;
      stats.lastCode = code; stats.lastAt = now;
      if (code === 200 || code === 202) {
        for (const n of batch) set.set(base + '|' + n, now);
        lastTry.delete(base);
        save();
        out.posted++; out.urls += urls.length; stats.posted++; stats.urls += urls.length;
        log(host + '：推了 ' + urls.length + ' 个 /s/ 页 → HTTP ' + code);
      } else {
        stats.failed++;
        log(host + '：HTTP ' + code + '（' + urls.length + ' 条未记，10 分钟后再试）');
      }
    }
    return out;
  }

  return {
    pushRound,
    status: () => Object.assign({ enabled, key: key.slice(0, 6) + '…', recorded: load().size }, stats),
    _setFetch: (f) => { fetchImpl = f; },
    _setNow: (f) => { nowFn = f || Date.now; },
    _file: file
  };
}

module.exports = { create, groupNew, DEFAULT_KEY };
