/*
 * X 任务自动核（关注 / 点赞 / 转发）
 * ============================================================================
 *
 * 为什么有这个文件（2026-09 的定价变化）：
 *   X 从 2026-02 起没有免费档了，改成按量付费。登录本身不计费，
 *   而「Owned Reads」—— 读**自己账号**的数据 —— 是 $0.001 一条：
 *     GET /2/users/:id/followers          谁关注了我
 *     GET /2/tweets/:id/liking_users      谁赞了我这条推
 *     GET /2/tweets/:id/retweeted_by      谁转了我这条推
 *   三条合起来正好能把「X 三连」全自动核掉，不必再让用户自称、管理员抽查。
 *
 * 怎么核：
 *   每 10 分钟拉一轮，把三个名单拉成三个 **X 数字 id 的集合**，
 *   交给 server/allowlist.js 的 syncApi() 一次性打勾 / 取消勾（来源标 by:'api'）。
 *   退关、取消赞、撤回转发都会在下一轮自动掉勾 —— 这是这套东西比「点一下我做了」
 *   强的地方，也是它必须**周期性全量**拉一次的原因。
 *
 * 省钱的两个办法（每条记录都要真金白银）：
 *   1. **增量**：这三个接口都是新的在前。平时只翻到「这一页全是老人」为止，
 *      通常就是一页。新增的人一定在最前面，翻不到老人的那一页说明还有新人。
 *   2. **全量少做**：只有每 N 轮（默认 6 轮 ≈ 1 小时）做一次翻到底的全量，
 *      因为**只有全量才能发现退关**（退关的人不会出现在任何新页里）。
 *   结果按 x_id 落盘（.store/xverify.json），进程重启不用重头拉。
 *
 * 认证：两条路，任选其一（管理员在后台贴，和登录用的是同一份 .store/xauth.json）
 *   - OAuth 2.0 App-only Bearer Token
 *   - OAuth 1.0a 用户上下文（consumer key/secret + 本账号的 Access Token 对）
 *   一个都没配 → configured() 是 false，整套退回原来的信任模式，一分钱不花。
 *
 * 转发那一项的口径（用户 2026-09-18 拍板）：
 *   **转发这个事实以 retweeted_by 为准**；「转发并在评论里回登记码」那条
 *   仍然走 syndication 核回复（server/allowlist.js 的 submitProof）。
 *   两条路都能把 repost 打上勾，而这里**只撤自己打的那种**（by === 'api'）——
 *   有人只回了评论没点转发，他的分是 proof 给的，不归这一轮管。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XAUTH = require('./xauth.js');

const API = 'https://api.x.com';
/** 一条记录多少钱（Owned Reads）。X 改价了就改这个 env，不用动代码。 */
const PRICE = () => {
  const v = Number(process.env.ARCBANG_XV_PRICE);
  return Number.isFinite(v) && v >= 0 ? v : 0.001;
};
/** 多久拉一轮（分钟）。 */
const EVERY_MIN = () => {
  const v = Number(process.env.ARCBANG_XV_EVERY_MIN);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 10;
};
/** 每几轮做一次翻到底的全量（只有全量才发现得了退关）。 */
const FULL_EVERY = () => {
  const v = Number(process.env.ARCBANG_XV_FULL_EVERY);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 6;
};
/** 一轮最多翻几页。**保险丝**：接口给出环形 next_token 时不至于无限翻下去烧钱。 */
const MAX_PAGES = () => {
  const v = Number(process.env.ARCBANG_XV_MAX_PAGES);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 50;
};
const TIMEOUT_MS = 12000;

/** 三项各自从哪个接口来。key 与 allowlist 的 CHECKS 一一对应。 */
const SOURCES = {
  follow: { kind: 'followers', max: 1000 },
  like: { kind: 'liking_users', max: 100 },
  repost: { kind: 'retweeted_by', max: 100 }
};

function nowSec() { return Math.floor(Date.now() / 1000); }
function nonce() { return crypto.randomBytes(16).toString('hex'); }
function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

/**
 * @param opts.storeDir   .store 目录
 * @param opts.xauth      server/xauth.js 的实例（凭证从它那儿读）
 * @param opts.allowlist  server/allowlist.js 的实例（打勾写回它）
 * @param opts.fetch      注入用；默认 Node 自带 fetch
 */
function create(opts) {
  const o = opts || {};
  const storeDir = o.storeDir || path.join(__dirname, '.store');
  const stateFile = o.stateFile || path.join(storeDir, 'xverify.json');
  const XA = o.xauth;
  const AL = o.allowlist;
  const fetchImpl = o.fetch || ((...a) => fetch(...a));
  /** 我们自己那个账号的 @名字。followers 要先把它换成数字 id。 */
  const handle = () => String(o.handle || process.env.ARCBANG_X_HANDLE || 'arcbang_xyz').replace(/^@+/, '').trim();

  let cache = null;

  const EMPTY = () => ({
    accountId: null, tweetId: null,
    sets: {},                       // key → { ids:[…], at, full:boolean }
    rounds: 0, lastRunAt: null, lastError: null, running: false,
    cost: { records: 0, requests: 0, byDay: {} }
  });

  function load() {
    if (cache) return cache;
    try {
      const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      cache = Object.assign(EMPTY(), j || {});
      cache.sets = cache.sets || {};
      cache.cost = Object.assign({ records: 0, requests: 0, byDay: {} }, cache.cost || {});
      cache.running = false;         // 上次是被 kill 掉的，别把标志留成 true
    } catch (e) {
      cache = EMPTY();
    }
    return cache;
  }
  function save() {
    if (!cache) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
      fs.renameSync(tmp, stateFile);
    } catch (e) {
      console.error('[xverify] 状态存不下：' + (e && e.message));
    }
  }

  /* ---------------------------------------------------------------- 认证
     两条路：App-only 的 Bearer，或者 OAuth 1.0a 的用户上下文。
     **优先用户上下文** —— Owned Reads 读的是「自己账号的数据」，
     用户上下文是那三条接口都认的一条路；Bearer 在部分接口上会被拒。 */
  function auth(method, url) {
    const c = XA && XA.readCred ? XA.readCred() : null;
    if (!c) return null;
    if (c.accessToken && c.accessSecret) {
      const p = {
        oauth_consumer_key: c.key,
        oauth_nonce: nonce(),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(nowSec()),
        oauth_token: c.accessToken,
        oauth_version: '1.0'
      };
      const sg = XAUTH.sign(method, url, p, c.secret, c.accessSecret);
      return XAUTH.authHeader(p, sg);
    }
    if (c.bearer) return 'Bearer ' + c.bearer;
    return null;
  }
  function configured() { return !!auth('GET', API + '/2/users/me'); }

  /** 一次 GET。**失败不抛** —— 一轮里挂一条不该把整轮带走。 */
  async function get(url) {
    const a = auth('GET', url);
    if (!a) return { ok: false, error: '还没配自动核用的凭证' };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, {
        headers: { authorization: a, 'user-agent': 'arcbang-xverify/1 (+https://arcbang.xyz)' },
        signal: ctl.signal
      });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch (e) { j = null; }
      if (!r.ok) {
        return { ok: false, status: r.status, error: 'X 回了 ' + r.status + '：' + String(text).slice(0, 160) };
      }
      return { ok: true, json: j || {} };
    } catch (e) {
      return { ok: false, error: (e && e.name === 'AbortError') ? 'X 那边超时了' : ((e && e.message) || String(e)) };
    } finally {
      clearTimeout(t);
    }
  }

  /** 记一笔账：读了多少条、发了几个请求、折合多少钱。 */
  function charge(records, requests, now) {
    const s = load();
    const d = dayOf(now == null ? Date.now() : now);
    s.cost.records += records;
    s.cost.requests += requests;
    s.cost.byDay[d] = s.cost.byDay[d] || { records: 0, requests: 0 };
    s.cost.byDay[d].records += records;
    s.cost.byDay[d].requests += requests;
    /* 只留最近 30 天，不然这个文件会一直长。 */
    const keys = Object.keys(s.cost.byDay).sort();
    while (keys.length > 30) delete s.cost.byDay[keys.shift()];
  }

  /** @arcbang_xyz 的数字 id。查一次就存下来（这一次也要花 $0.001）。 */
  async function accountId() {
    const s = load();
    if (s.accountId) return { ok: true, id: s.accountId };
    const h = handle();
    if (!h) return { ok: false, error: '没配 ARCBANG_X_HANDLE' };
    const r = await get(API + '/2/users/by/username/' + encodeURIComponent(h));
    if (!r.ok) { charge(0, 1); return r; }
    charge(1, 1);
    const id = r.json && r.json.data && r.json.data.id;
    if (!id) return { ok: false, error: '查不到 @' + h + ' 的 id' };
    s.accountId = String(id);
    save();
    return { ok: true, id: s.accountId };
  }

  /**
   * 翻一个名单。
   * @param full true = 翻到底并**整份替换**（能发现退关）；
   *             false = 翻到「这一页全是老人」为止并**并进去**（便宜）
   * @returns {{ok:boolean, ids?:Set<string>, pages:number, records:number, error?:string}}
   */
  async function fetchList(kind, id, known, full) {
    const src = SOURCES[Object.keys(SOURCES).find((k) => SOURCES[k].kind === kind)];
    const max = (src && src.max) || 100;
    const root = kind === 'followers'
      ? API + '/2/users/' + encodeURIComponent(id) + '/followers'
      : API + '/2/tweets/' + encodeURIComponent(id) + '/' + kind;
    const out = new Set();
    const cap = MAX_PAGES();
    let token = null, pages = 0, records = 0;
    while (pages < cap) {
      const url = root + '?max_results=' + max + (token ? '&pagination_token=' + encodeURIComponent(token) : '');
      const r = await get(url);
      pages++;
      if (!r.ok) {
        charge(records, pages);
        return { ok: false, pages, records, error: r.error, status: r.status };
      }
      const rows = (r.json && r.json.data) || [];
      let fresh = 0;
      for (const u of rows) {
        const uid = u && u.id != null ? String(u.id) : null;
        if (!uid) continue;
        out.add(uid);
        if (!known.has(uid)) fresh++;
      }
      records += rows.length;
      token = (r.json && r.json.meta && r.json.meta.next_token) || null;
      if (!token) break;
      /* 增量：**整整一页都是老人**就停。新的排在最前面，所以这一页之后不会再有新人。
         判据是「这一页没有新人」而不是「没有下一页」—— 后者要翻到底，那是全量。 */
      if (!full && rows.length && fresh === 0) break;
    }
    charge(records, pages);
    return { ok: true, ids: out, pages, records };
  }

  /**
   * 拉一轮，把三项写回名单。
   * @param opt.full  强制这一轮做全量
   * @returns 这一轮的账单与打勾结果
   */
  async function runOnce(opt) {
    const s = load();
    if (s.running) return { ok: false, error: '上一轮还没跑完' };
    if (!configured()) return { ok: false, error: '还没配自动核用的凭证（Bearer 或 Access Token）' };
    s.running = true;
    const started = Date.now();
    const before = { records: s.cost.records, requests: s.cost.requests };
    const detail = {};
    try {
      const acc = await accountId();
      const tid = AL && AL.pinnedTweetId ? AL.pinnedTweetId() : null;
      s.tweetId = tid || null;

      const full = !!(opt && opt.full) || (s.rounds % FULL_EVERY() === 0);
      const sets = {};
      for (const key of Object.keys(SOURCES)) {
        const kind = SOURCES[key].kind;
        const target = kind === 'followers' ? (acc.ok ? acc.id : null) : tid;
        if (!target) {
          detail[key] = { skipped: true, why: kind === 'followers' ? (acc.error || '没拿到账号 id') : '没配置顶推' };
          continue;
        }
        const old = (s.sets[key] && s.sets[key].ids) || [];
        const known = new Set(old.map(String));
        /* 第一次跑（从没存过这一项）一律全量：没有底子的话，
           「这一页全是老人」永远不成立，反而会一路翻到底还多花钱。 */
        const doFull = full || !s.sets[key];
        const r = await fetchList(kind, target, known, doFull);
        if (!r.ok) {
          detail[key] = { error: r.error, pages: r.pages, records: r.records };
          continue;                  // 这一项这一轮不动名单 —— 拉失败不等于没人
        }
        const merged = doFull ? r.ids : new Set([...known, ...r.ids]);
        s.sets[key] = { ids: [...merged], at: new Date().toISOString(), full: doFull };
        sets[key] = merged;
        detail[key] = { full: doFull, pages: r.pages, records: r.records, total: merged.size };
      }

      const applied = (AL && AL.syncApi) ? AL.syncApi(sets) : { added: {}, removed: {}, seen: 0 };
      s.rounds++;
      s.lastRunAt = new Date().toISOString();
      s.lastError = null;
      const records = s.cost.records - before.records;
      const requests = s.cost.requests - before.requests;
      save();
      const line = Object.keys(detail).map((k) => k + (detail[k].error ? '✗' : '=' + (detail[k].total == null ? '跳过' : detail[k].total))).join(' ');
      console.log('[xverify] 第 ' + s.rounds + ' 轮：' + line
        + ' · 读 ' + records + ' 条 ≈ $' + (records * PRICE()).toFixed(3)
        + ' · ' + (Date.now() - started) + 'ms');
      return {
        ok: true, rounds: s.rounds, detail, applied,
        cost: { records, requests, usd: +(records * PRICE()).toFixed(4) }
      };
    } catch (e) {
      s.lastError = (e && e.message) || String(e);
      save();
      console.error('[xverify] 这一轮崩了：' + s.lastError);
      return { ok: false, error: s.lastError };
    } finally {
      s.running = false;
    }
  }

  /* ---------------------------------------------------------------- 定时
     进程内一个 setInterval 就够：这一套只在主 API 进程里跑一份。
     unref() 是为了不把进程钉在事件循环上（命令行工具 require 了它也能正常退出）。 */
  let timer = null;
  function start() {
    if (timer) return { ok: true, already: true };
    const ms = EVERY_MIN() * 60 * 1000;
    timer = setInterval(() => {
      if (!configured()) return;     // 凭证是可以在运行中贴进来的，所以每轮都问一次
      runOnce().catch(() => { });
    }, ms);
    if (timer.unref) timer.unref();
    /* 启动后 30 秒先跑一轮：重启之后不用等满一个周期才有数。 */
    const first = setTimeout(() => { if (configured()) runOnce().catch(() => { }); }, 30000);
    if (first.unref) first.unref();
    return { ok: true, everyMin: EVERY_MIN() };
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } return { ok: true }; }

  /** 管理员页要的那一份：配没配、上一轮什么时候、读了多少条、花了多少钱。 */
  function info() {
    const s = load();
    const price = PRICE();
    const today = s.cost.byDay[dayOf(Date.now())] || { records: 0, requests: 0 };
    const sizes = {};
    for (const k of Object.keys(SOURCES)) {
      sizes[k] = s.sets[k] ? { n: s.sets[k].ids.length, at: s.sets[k].at, full: !!s.sets[k].full } : null;
    }
    return {
      configured: configured(),
      handle: handle(),
      accountId: s.accountId,
      tweetId: s.tweetId,
      everyMin: EVERY_MIN(),
      fullEvery: FULL_EVERY(),
      rounds: s.rounds,
      lastRunAt: s.lastRunAt,
      lastError: s.lastError,
      running: !!s.running,
      sets: sizes,
      price,
      cost: {
        records: s.cost.records, requests: s.cost.requests,
        usd: +(s.cost.records * price).toFixed(4),
        today: { records: today.records, requests: today.requests, usd: +(today.records * price).toFixed(4) },
        byDay: s.cost.byDay
      }
    };
  }

  /** 自检要用：把盘上的状态扔掉重读。 */
  function _reload() { cache = null; }

  return { configured, runOnce, start, stop, info, accountId, fetchList, stateFile, _reload, _state: load };
}

module.exports = { create, SOURCES };
