/*
 * 上线预约 —— POST /api/subscribe { site, email, lang? }
 * ------------------------------------------------------------
 * 站族里还没上线的东西（tool 站客户端、BTCBANG 开闸……）留个邮箱，上线时人工发一封。
 * 不发验证邮件、不接第三方邮件服务：只是把地址追加进 .store/subscribers.jsonl，
 * 一行一个 { site, email, lang, ip, at }；站长用 `grep '"site":"tool"'` 就能导出。
 *
 * 防刷：同一 IP 每小时最多 5 次（借 ratelimit.take，独立桶，不占引爆额度）；
 *       (site, email) 重复直接说「已登记」，不重复写；
 *       邮箱只做形式校验（长度 ≤ 254、一个 @、域名带点），不去连 MX —— 不值得。
 * 站名白名单：只收已知的几个站，别让这个文件变成谁都能写的留言板。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SITES = new Set(['tool', 'home', 'bnbbang', 'btcbang', 'earn', 'sim', 'airdrop', 'game', 'faucet', 'trx']);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PER_IP_PER_HOUR = 5;
const HOUR = 3600000;

function normEmail(s) {
  const e = String(s == null ? '' : s).trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

function create(opts) {
  const o = opts || {};
  const storeDir = o.storeDir || path.join(__dirname, '.store');
  const file = path.join(storeDir, 'subscribers.jsonl');
  const take = o.take;               // ratelimit.take(key, limit, windowMs)
  let seen = null;                   // Set("site|email")，启动时从文件建一次

  function load() {
    if (seen) return seen;
    seen = new Set();
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const j = JSON.parse(line); if (j && j.site && j.email) seen.add(j.site + '|' + j.email); } catch (e) { /* 坏行跳过 */ }
      }
    } catch (e) { /* 还没有文件 */ }
    return seen;
  }

  /** 返回 { status, body } */
  function add(input, ip) {
    const b = input && typeof input === 'object' ? input : {};
    const site = String(b.site || '').trim().toLowerCase();
    if (!SITES.has(site)) return { status: 400, body: { error: '不认识的站' } };
    const email = normEmail(b.email);
    if (!email) return { status: 400, body: { error: '邮箱格式不对' } };
    const lang = /^en/i.test(String(b.lang || '')) ? 'en' : 'zh';
    if (typeof take === 'function') {
      const r = take('sub:' + (ip || '?'), PER_IP_PER_HOUR, HOUR);
      if (r && r.ok === false) return { status: 429, body: { error: '太频繁了，一小时后再试' } };
    }
    const k = site + '|' + email;
    const s = load();
    if (s.has(k)) return { status: 200, body: { ok: true, already: true } };
    const rec = { site, email, lang, ip: ip || null, at: new Date().toISOString() };
    try {
      fs.mkdirSync(storeDir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    } catch (e) {
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    s.add(k);
    return { status: 200, body: { ok: true } };
  }

  return { add, count: () => load().size, _file: file };
}

module.exports = { create, normEmail, SITES };
