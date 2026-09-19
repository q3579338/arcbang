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
 * 互动的口径（用户 2026-09-19 拍板）：
 *   **点赞 / 转发 / 评论是一体的**，一条推文的三项都核到才给那条的分。
 *     点赞 = liking_users，转发 = retweeted_by，评论 = recent search conversation_id:<id>。
 *   **官方每发一条新推文就多一个任务**，旧的不下线、不过期：所以这里除了置顶推，
 *   还要把 allowlist 的官方推文表（engagePosts）里每一条都各拉一遍。
 *
 *   评论那一路（recent search）跟另外两条不是一个计费档：$0.005 一条，
 *   而且不是所有账号档位都开。被拒（402 / 403）时记下 searchOk=false，
 *   页面据此把「贴回复链接」那条老路（submitProof）放出来。
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
/** recent search 一条多少钱。它跟 Owned Reads 不是一个档（默认 $0.005）。 */
const SEARCH_PRICE = () => {
  const v = Number(process.env.ARCBANG_XV_SEARCH_PRICE);
  return Number.isFinite(v) && v >= 0 ? v : 0.005;
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
/** 一轮最多抓几个**没抓过的**登记账号。X 那条接口一次最多 100 个 id，
    所以这个数也就是「一轮最多几个请求」的闸：默认一轮一个请求、100 个人。 */
const USERS_PER_ROUND = () => {
  const v = Number(process.env.ARCBANG_XV_USERS_PER_ROUND);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 100;
};
/** GET /2/users?ids= 一次最多 100 个。这是 X 定的，不是我们调的。 */
const USERS_MAX_IDS = 100;
const TIMEOUT_MS = 12000;

/** 各项各自从哪个接口来。key 与 allowlist 的 CHECKS 一一对应。 */
const SOURCES = {
  follow: { kind: 'followers', max: 1000 },
  like: { kind: 'liking_users', max: 100 },
  repost: { kind: 'retweeted_by', max: 100 },
  /* 评论：recent search，按 conversation_id 找这条推下面的所有回复，按 author_id 对人。 */
  comment: { kind: 'search', max: 100 }
};
/** 一条推文上要拉的那三个名单（关注不在里面：它跟具体推文无关）。 */
const POST_KINDS = { like: 'liking_users', repost: 'retweeted_by', comment: 'search' };

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
  /* 登记账号的公开档案（注册日期 / 粉丝数）。**单独一个文件**：
     它跟「谁打了勾」不是一回事，一个是查出来的事实，一个是我们的结账结果；
     而且这份只增不减，混在状态文件里会让那个文件一直长。 */
  const usersFile = o.usersFile || path.join(storeDir, 'xusers.json');
  const XA = o.xauth;
  const AL = o.allowlist;
  const fetchImpl = o.fetch || ((...a) => fetch(...a));
  /** 我们自己那个账号的 @名字。followers 要先把它换成数字 id。 */
  const handle = () => String(o.handle || process.env.ARCBANG_X_HANDLE || 'arcbang_xyz').replace(/^@+/, '').trim();

  let cache = null;

  const EMPTY = () => ({
    accountId: null, tweetId: null,
    sets: {},                       // key → { ids:[…], at, full:boolean }（置顶推 + 关注）
    /* 置顶推**以外**每条官方推文的三个名单：tweetId → { like/repost/comment: {ids, at, since} } */
    posts: {},
    /* 评论那一路能不能用。X 那边拒过一次就记下来，页面据此退回「贴回复链接」。
       **不是永久的**：下一轮还会再试一次，额度加开之后自己会恢复。 */
    searchOk: true, searchError: null,
    rounds: 0, lastRunAt: null, lastError: null, running: false,
    cost: { records: 0, requests: 0, searchRecords: 0, byDay: {} }
  });

  function load() {
    if (cache) return cache;
    try {
      const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      cache = Object.assign(EMPTY(), j || {});
      cache.sets = cache.sets || {};
      cache.posts = cache.posts || {};
      cache.searchOk = cache.searchOk !== false;
      cache.cost = Object.assign({ records: 0, requests: 0, searchRecords: 0, byDay: {} }, cache.cost || {});
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
    /* 优先站方官号的 token（点赞列表只对推文作者本人返回），其次是后台贴的 Access Token 对。 */
    const tok = (c.ownerAccessToken && c.ownerAccessSecret)
      ? { t: c.ownerAccessToken, s: c.ownerAccessSecret }
      : ((c.accessToken && c.accessSecret) ? { t: c.accessToken, s: c.accessSecret } : null);
    if (tok) {
      const p = {
        oauth_consumer_key: c.key,
        oauth_nonce: nonce(),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(nowSec()),
        oauth_token: tok.t,
        oauth_version: '1.0'
      };
      const sg = XAUTH.sign(method, url, p, c.secret, tok.s);
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

  /* ---------------------------------------------------------------- 账号档案
     2026-09-19 用户拍板：后台要看得见「这个 X 号是不是刚注册的小号」。
     GET /2/users?ids=…&user.fields=created_at,public_metrics —— 一次最多 100 个，
     计费与别处一样按**读到的条数**算（Owned Reads，$0.001 一条）。

     **每个账号只抓一次**：注册日期永远不变，粉丝数是拿来筛小号的，不需要实时。
     要重抓就删掉 .store/xusers.json 里那一条（或整份删掉）。 */
  let usersCache = null;
  function users() {
    if (usersCache) return usersCache;
    try {
      const j = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      usersCache = (j && typeof j === 'object') ? j : {};
    } catch (e) { usersCache = {}; }
    return usersCache;
  }
  function saveUsers() {
    if (!usersCache) return;
    try {
      fs.mkdirSync(path.dirname(usersFile), { recursive: true });
      const tmp = usersFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(usersCache, null, 2) + '\n');
      fs.renameSync(tmp, usersFile);
    } catch (e) { console.error('[xverify] 账号档案存不下：' + (e && e.message)); }
  }
  /**
   * 抓一批账号的公开档案。**不写盘**（由调用方决定要不要并进去），
   * 失败不抛 —— 这一项挂了不该把整轮带走。
   * @param ids 数字 id 的数组；重复的、不是数字的一律先滤掉
   * @returns { ok, users:{id:{createdAt,followers,following,tweets,fetchedAt}}, 
   *            missing:[id…], records, requests, error? }
   */
  async function fetchUsers(ids) {
    const want = [];
    const seen = new Set();
    for (const x of (Array.isArray(ids) ? ids : [])) {
      const id = String(x == null ? '' : x).trim();
      if (!/^\d{1,25}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      want.push(id);
    }
    const out = {};
    if (!want.length) return { ok: true, users: out, missing: [], records: 0, requests: 0 };
    let records = 0, requests = 0, err = null;
    const at = new Date().toISOString();
    for (let i = 0; i < want.length; i += USERS_MAX_IDS) {
      const chunk = want.slice(i, i + USERS_MAX_IDS);
      const url = API + '/2/users?ids=' + chunk.join(',')
        + '&user.fields=' + encodeURIComponent('created_at,public_metrics');
      const r = await get(url);
      requests++;
      if (!r.ok) { err = r.error; charge(0, 1); continue; }   // 这一批跳过，别的批照抓
      const rows = (r.json && r.json.data) || [];
      records += rows.length;
      charge(rows.length, 1);
      for (const u of rows) {
        const id = u && u.id != null ? String(u.id) : null;
        if (!id) continue;
        const pm = u.public_metrics || {};
        out[id] = {
          createdAt: u.created_at || null,
          followers: Number(pm.followers_count) || 0,
          following: Number(pm.following_count) || 0,
          tweets: Number(pm.tweet_count) || 0,
          fetchedAt: at
        };
      }
    }
    /* 查不到的（销号 / 改私密 / id 写错）：**也记一条**，标 missing。
       不记的话下一轮又会去查它，一个销号能把这个额度一直占着。 */
    const missing = want.filter((id) => !out[id]);
    for (const id of missing) {
      out[id] = { createdAt: null, followers: null, following: null, tweets: null, fetchedAt: at, missing: true };
    }
    return { ok: !err || Object.keys(out).length > 0, users: out, missing, records, requests, error: err };
  }
  /** 这一轮补抓：只挑**还没抓过**的登记账号，最多 USERS_PER_ROUND 个。 */
  async function syncUsers() {
    const cap = USERS_PER_ROUND();
    if (!cap) return { skipped: true, why: 'ARCBANG_XV_USERS_PER_ROUND=0' };
    const known = users();
    const all = (AL && AL.xIds) ? AL.xIds() : [];
    const todo = [];
    for (const id of all) {
      if (known[id]) continue;
      todo.push(id);
      if (todo.length >= cap) break;
    }
    if (!todo.length) return { fetched: 0, total: Object.keys(known).length };
    const r = await fetchUsers(todo);
    Object.assign(known, r.users);
    usersCache = known;
    saveUsers();
    return {
      fetched: Object.keys(r.users).length, missing: r.missing.length,
      records: r.records, requests: r.requests, error: r.error || undefined,
      total: Object.keys(known).length, left: Math.max(0, all.length - Object.keys(known).length)
    };
  }

  /** 记一笔账：读了多少条、发了几个请求、折合多少钱。 */
  function charge(records, requests, now, search) {
    const s = load();
    const d = dayOf(now == null ? Date.now() : now);
    s.cost.records += records;
    s.cost.requests += requests;
    if (search) s.cost.searchRecords = (s.cost.searchRecords || 0) + records;
    s.cost.byDay[d] = s.cost.byDay[d] || { records: 0, requests: 0, searchRecords: 0 };
    s.cost.byDay[d].records += records;
    s.cost.byDay[d].requests += requests;
    if (search) s.cost.byDay[d].searchRecords = (s.cost.byDay[d].searchRecords || 0) + records;
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
    if (kind === 'search') return fetchRepliers(id, known, full);
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
   * 谁在这条推下面回过帖 —— recent search，按 conversation_id 找，取 author_id。
   *
   * 三件跟上面那个不一样的事：
   *   1. **单价不同**（$0.005），所以账单里单记一笔 searchRecords；
   *   2. 增量靠 **since_id**：上一轮见过的最新那条回复的 id，下一轮只要比它新的；
   *   3. **被拒不是错误而是状态**：402（没开这个档）/ 403（这个 token 没权限）
   *      说明这条路这个账号走不通，记 searchOk=false，页面退回「贴回复链接」。
   *
   * recent search 只回最近 7 天 —— 老推文的评论翻不到。所以已经见过的人
   * **只并不减**（调用方 merge），不会因为搜不到就把勾撤掉。
   *
   * @returns {{ok, ids?:Set, pages, records, sinceId?:string, denied?:boolean}}
   */
  async function fetchRepliers(tweetId, known, since) {
    const max = SOURCES.comment.max;
    const q = 'conversation_id:' + tweetId;
    const root = API + '/2/tweets/search/recent?query=' + encodeURIComponent(q)
      + '&max_results=' + max + '&tweet.fields=author_id'
      + (since ? '&since_id=' + encodeURIComponent(since) : '');
    const out = new Set();
    const cap = MAX_PAGES();
    let token = null, pages = 0, records = 0, newest = since || null;
    while (pages < cap) {
      const r = await get(root + (token ? '&next_token=' + encodeURIComponent(token) : ''));
      pages++;
      if (!r.ok) {
        charge(records, pages, null, true);
        const denied = r.status === 402 || r.status === 403;
        return { ok: false, pages, records, error: r.error, status: r.status, denied };
      }
      const rows = (r.json && r.json.data) || [];
      for (const t of rows) {
        const uid = t && t.author_id != null ? String(t.author_id) : null;
        if (uid) out.add(uid);
        const tid = t && t.id != null ? String(t.id) : null;
        /* id 是雪花号：位数一样时字典序就是时间序，位数不一样时长的更新。 */
        if (tid && (!newest || tid.length > newest.length || (tid.length === newest.length && tid > newest))) newest = tid;
      }
      records += rows.length;
      token = (r.json && r.json.meta && r.json.meta.next_token) || null;
      if (!token) break;
    }
    charge(records, pages, null, true);
    return { ok: true, ids: out, pages, records, sinceId: newest };
  }

  /**
   * 拉一条推文的三个名单（点赞 / 转发 / 评论）。
   * @param slot 盘上存这条推的那一格（{like/repost/comment: {ids, at, since}}），**会被就地改**
   * @returns {{sets:{like?:Set,repost?:Set,comment?:Set}, detail:object}}
   */
  async function fetchPost(tweetId, slot, full) {
    const sets = {}, detail = {};
    const s = load();
    for (const key of Object.keys(POST_KINDS)) {
      const kind = POST_KINDS[key];
      if (kind === 'search' && !s.searchOk) { detail[key] = { skipped: true, why: '评论那一路被拒过' }; continue; }
      const cell = slot[key] || {};
      const known = new Set((cell.ids || []).map(String));
      const doFull = full || !slot[key];
      const r = kind === 'search'
        ? await fetchRepliers(tweetId, known, cell.since || null)
        : await fetchList(kind, tweetId, known, doFull);
      if (!r.ok) {
        if (r.denied) {
          s.searchOk = false;
          s.searchError = r.error || ('X 回了 ' + r.status);
          console.error('[xverify] 评论那一路被拒（' + r.status + '）：退回贴回复链接。' + s.searchError);
        }
        detail[key] = { error: r.error, pages: r.pages, records: r.records };
        continue;                    // 这一项这一轮不动名单 —— 拉失败不等于没人
      }
      if (kind === 'search') s.searchOk = true;
      /* 点赞 / 转发做全量时整份替换（能发现取消），评论**只并不减**
         （recent search 只回 7 天，老回复翻不到，减了等于把勾抹掉）。 */
      const merged = (kind !== 'search' && doFull) ? r.ids : new Set([...known, ...r.ids]);
      slot[key] = {
        ids: [...merged], at: new Date().toISOString(),
        full: kind === 'search' ? false : doFull,
        since: kind === 'search' ? (r.sinceId || cell.since || null) : undefined
      };
      sets[key] = merged;
      detail[key] = { pages: r.pages, records: r.records, total: merged.size };
    }
    return { sets, detail };
  }

  /**
   * 拉一轮，把各项写回名单。
   * @param opt.full  强制这一轮做全量
   * @returns 这一轮的账单与打勾结果
   */
  async function runOnce(opt) {
    const s = load();
    if (s.running) return { ok: false, error: '上一轮还没跑完' };
    if (!configured()) return { ok: false, error: '还没配自动核用的凭证（Bearer 或 Access Token）' };
    s.running = true;
    const started = Date.now();
    const before = { records: s.cost.records, requests: s.cost.requests, search: s.cost.searchRecords || 0 };
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
        if (kind === 'search' && !s.searchOk) { detail[key] = { skipped: true, why: '评论那一路被拒过' }; continue; }
        const old = (s.sets[key] && s.sets[key].ids) || [];
        const known = new Set(old.map(String));
        /* 第一次跑（从没存过这一项）一律全量：没有底子的话，
           「这一页全是老人」永远不成立，反而会一路翻到底还多花钱。 */
        const doFull = full || !s.sets[key];
        const r = kind === 'search'
          ? await fetchRepliers(target, known, (s.sets[key] && s.sets[key].since) || null)
          : await fetchList(kind, target, known, doFull);
        if (!r.ok) {
          if (r.denied) { s.searchOk = false; s.searchError = r.error || ('X 回了 ' + r.status); }
          detail[key] = { error: r.error, pages: r.pages, records: r.records };
          continue;                  // 这一项这一轮不动名单 —— 拉失败不等于没人
        }
        if (kind === 'search') s.searchOk = true;
        const merged = (kind !== 'search' && doFull) ? r.ids : new Set([...known, ...r.ids]);
        s.sets[key] = {
          ids: [...merged], at: new Date().toISOString(), full: kind === 'search' ? false : doFull,
          since: kind === 'search' ? (r.sinceId || (s.sets[key] && s.sets[key].since) || null) : undefined
        };
        sets[key] = merged;
        detail[key] = { full: doFull, pages: r.pages, records: r.records, total: merged.size };
      }

      /* ---- 置顶推以外的官方推文，每条各拉一遍 ----
         官方每发一条就多一个任务，旧的不下线：所以这里是**整张表**，不是只看最新那条。
         一条推三个请求，表长了就是线性增长的钱 —— 增量在 fetchPost 里（点赞 / 转发
         翻到「这一页全是老人」就停，评论走 since_id），所以旧推文实际上几乎不花钱。 */
      const postSets = {};
      const allPosts = (AL && AL.engagePosts) ? AL.engagePosts() : [];
      s.posts = s.posts || {};
      for (const post of allPosts) {
        if (tid && post.tweetId === tid) continue;      // 置顶推上面已经拉过
        /* 没配置顶推 URL 时表里第一条是个占位（tweetId 不是数字），它没有推文可拉。 */
        if (!/^\d{5,25}$/.test(String(post.tweetId))) continue;
        const slot = s.posts[post.tweetId] || {};
        const r = await fetchPost(post.tweetId, slot, full);
        s.posts[post.tweetId] = slot;
        if (Object.keys(r.sets).length) postSets[post.tweetId] = r.sets;
        detail['post:' + post.tweetId] = r.detail;
      }
      /* 表里删掉的推文，盘上那一格也跟着清 —— 不然这个文件只增不减。 */
      const live = new Set(allPosts.map((x) => x.tweetId));
      for (const k of Object.keys(s.posts)) if (!live.has(k)) delete s.posts[k];

      const applied = (AL && AL.syncApi) ? AL.syncApi(sets, null, postSets) : { added: {}, removed: {}, seen: 0 };
      /* 顺手补抓一批账号档案（注册日期 / 粉丝数），用来在后台筛多号农场。
         **只抓没抓过的**，一轮最多 100 个 —— 一次请求、一分钱的量级。 */
      detail.users = await syncUsers();
      s.rounds++;
      s.lastRunAt = new Date().toISOString();
      s.lastError = null;
      const records = s.cost.records - before.records;
      const requests = s.cost.requests - before.requests;
      const searchRecords = (s.cost.searchRecords || 0) - before.search;
      save();
      const line = Object.keys(SOURCES).map((k) => k + (!detail[k] ? '—' : (detail[k].error ? '✗' : '=' + (detail[k].total == null ? '跳过' : detail[k].total)))).join(' ');
      const usd = (records - searchRecords) * PRICE() + searchRecords * SEARCH_PRICE();
      console.log('[xverify] 第 ' + s.rounds + ' 轮：' + line
        + ' · 推文 ' + allPosts.length + ' 条'
        + ' · 读 ' + records + ' 条（搜 ' + searchRecords + '）≈ $' + usd.toFixed(3)
        + ' · ' + (Date.now() - started) + 'ms');
      return {
        ok: true, rounds: s.rounds, detail, applied,
        cost: { records, requests, searchRecords, usd: +usd.toFixed(4) }
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
      /* 评论那一路（recent search）通不通。allowlist 的 status 把它传给页面：
         false 时互动卡上多出「贴回复链接」那一块，那是评论的退路。 */
      searchOk: s.searchOk !== false,
      searchError: s.searchError || null,
      /* 账号档案抓到哪儿了（后台那两列的数据源） */
      users: (function () {
        const u = users();
        const ids = Object.keys(u);
        return { known: ids.length, missing: ids.filter((k) => u[k] && u[k].missing).length };
      })(),
      /* 置顶推以外每条官方推文拉到哪儿了（后台看的） */
      posts: Object.keys(s.posts || {}).map((tid) => ({
        tweetId: tid,
        like: s.posts[tid].like ? s.posts[tid].like.ids.length : null,
        repost: s.posts[tid].repost ? s.posts[tid].repost.ids.length : null,
        comment: s.posts[tid].comment ? s.posts[tid].comment.ids.length : null,
        at: (s.posts[tid].like || s.posts[tid].repost || s.posts[tid].comment || {}).at || null
      })),
      price,
      searchPrice: SEARCH_PRICE(),
      cost: {
        records: s.cost.records, requests: s.cost.requests,
        searchRecords: s.cost.searchRecords || 0,
        /* 搜索那部分按它自己的单价算，别一律乘 0.001 —— 那会把账少报五倍。 */
        usd: +(((s.cost.records - (s.cost.searchRecords || 0)) * price
          + (s.cost.searchRecords || 0) * SEARCH_PRICE()).toFixed(4)),
        today: {
          records: today.records, requests: today.requests,
          searchRecords: today.searchRecords || 0,
          usd: +(((today.records - (today.searchRecords || 0)) * price
            + (today.searchRecords || 0) * SEARCH_PRICE()).toFixed(4))
        },
        byDay: s.cost.byDay
      }
    };
  }

  /** 自检要用：把盘上的状态扔掉重读。 */
  function _reload() { cache = null; usersCache = null; }

  return {
    configured, runOnce, start, stop, info, accountId, fetchList,
    fetchUsers, users, syncUsers, usersFile,
    stateFile, _reload, _state: load
  };
}

module.exports = { create, SOURCES };
