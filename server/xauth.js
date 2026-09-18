/*
 * 用 X 登录（OAuth 1.0a 三腿流程）
 * ============================================================================
 *
 * 为什么是 1.0a 而不是 OAuth 2.0（2026-09-18 用户拍板）：
 *   1.0a 的 access_token 响应里**自带 user_id 与 screen_name**，
 *   拿到就够用，不必再调一次 users/me —— 而 users/me 是要读取额度的，
 *   免费档的读取额度是 0。OAuth 2.0 那条路拿到 token 之后必须再读一次，
 *   在免费档上直接就走不通。
 *
 * 三腿：
 *   1. POST oauth/request_token   带 oauth_callback，换一个临时 token
 *   2. 跳 oauth/authenticate      用户在 X 上点同意
 *   3. POST oauth/access_token    带 oauth_verifier，换正式 token
 *                                 响应里就有 user_id / screen_name
 *
 * 签名 HMAC-SHA1 自己实现（Node 自带 crypto），不引第三方包 ——
 * 这套算法总共三十行，引一个包反而多一份供应链。
 *
 * ---------------------------------------------------------------------------
 * 凭证放哪儿：**不走环境变量**
 *   consumer key / secret 存在 .store/xauth.json（0600），由管理员在审核页粘贴。
 *   理由是用户明说的「我不经手」：走 env 就得有人把它贴进部署脚本或 systemd unit，
 *   那串东西会留在 shell 历史、备份和日志里。存文件的话它只在那一个文件里。
 *
 *   同一个文件里还存一把随机的 cookieSecret（第一次保存凭证时生成）——
 *   会话 cookie 的 HMAC 用它。**不能用那个公开默认值的盐**：
 *   盐没配时是个写死的字符串，谁都能照着签一个「我是 @vitalik」的 cookie 出来。
 *
 * ---------------------------------------------------------------------------
 * 会话 cookie
 *   arcbang_x = base64url(payload) + '.' + HMAC-SHA256(cookieSecret, payload)
 *   HttpOnly + Secure + SameSite=Lax + Path=/ + 有效期 2 小时。
 *   payload 里只有 {id, handle, img, exp} —— 没有 access_token：
 *   我们拿到 token 之后再也不需要它了，存着只是多一份可被偷的东西。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'arcbang_x';
/** 发起登录时下发的一次性 CSRF cookie，回调时必须对得上。 */
const STATE_COOKIE = 'arcbang_xs';
/** 会话有效期。够走完「登录 → 连钱包 → 签名 → 登记」，又短到丢了也不要紧。 */
const SESSION_MS = 2 * 3600 * 1000;
/** 临时 token（第一腿换来的那个）留多久。X 那边本来就只给几分钟。 */
const PENDING_MS = 10 * 60 * 1000;
/** 同时最多留几个待回调的临时 token。防的是有人狂点登录把内存撑爆。 */
const MAX_PENDING = 2000;

const API = 'https://api.x.com';

/* ---------------------------------------------------------------- 百分号编码
   OAuth 1.0a 要的是 RFC 3986：encodeURIComponent 漏了 ! * ' ( ) 五个。
   漏掉它们的表现是「带这几个字符的参数签名对不上」，而 X 只回一句 401，
   从错误里完全看不出是编码的问题。 */
function pct(s) {
  return encodeURIComponent(String(s == null ? '' : s))
    .replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * 签名基串：METHOD & pct(基地址) & pct(排好序的参数串)
 * 基地址**不带 query 和 fragment**；query 里的参数要并进参数串里一起排序。
 * @returns {string}
 */
function baseString(method, url, params) {
  const u = new URL(url);
  const base = u.origin + u.pathname;
  const all = Object.assign({}, params);
  u.searchParams.forEach((v, k) => { all[k] = v; });
  const norm = Object.keys(all).sort()
    .map((k) => pct(k) + '=' + pct(all[k]))
    .join('&');
  return String(method).toUpperCase() + '&' + pct(base) + '&' + pct(norm);
}

/** 签名密钥：pct(consumerSecret) & pct(tokenSecret)。没有 token 时后半段是空的。 */
function signingKey(consumerSecret, tokenSecret) {
  return pct(consumerSecret) + '&' + pct(tokenSecret || '');
}

/** HMAC-SHA1，base64。 */
function sign(method, url, params, consumerSecret, tokenSecret) {
  return crypto.createHmac('sha1', signingKey(consumerSecret, tokenSecret))
    .update(baseString(method, url, params), 'utf8')
    .digest('base64');
}

/** Authorization 头。只放 oauth_* 那些，业务参数不进头。 */
function authHeader(params, signature) {
  const all = Object.assign({}, params, { oauth_signature: signature });
  return 'OAuth ' + Object.keys(all).sort()
    .filter((k) => k.indexOf('oauth_') === 0)
    .map((k) => pct(k) + '="' + pct(all[k]) + '"')
    .join(', ');
}

function nonce() { return crypto.randomBytes(16).toString('hex'); }
function nowSec() { return Math.floor(Date.now() / 1000); }

/** x-www-form-urlencoded 的响应体 → 对象 */
function parseForm(text) {
  const out = {};
  for (const kv of String(text || '').split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
    const v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
    out[k] = v;
  }
  return out;
}

/* ================================================================ 工厂 */
function create(opts) {
  const o = opts || {};
  const storeDir = o.storeDir || path.join(__dirname, '.store');
  const credFile = o.credFile || path.join(storeDir, 'xauth.json');
  /** 回调地址的根。**必须和 X 开发者后台里登记的那两条完全一致**，差一个斜杠都不行。 */
  const publicBase = () => String(o.publicBase || process.env.ARCBANG_PUBLIC_BASE || '').replace(/\/+$/, '');
  const fetchImpl = o.fetch || ((...a) => fetch(...a));

  let credCache = null;     // { key, secret, cookieSecret, savedAt, mtimeMs }

  function readCred() {
    let st = null;
    try { st = fs.statSync(credFile); } catch (e) { credCache = null; return null; }
    if (credCache && credCache.mtimeMs === st.mtimeMs) return credCache;
    try {
      const j = JSON.parse(fs.readFileSync(credFile, 'utf8'));
      if (!j || !j.key || !j.secret) { credCache = null; return null; }
      credCache = {
        key: String(j.key), secret: String(j.secret),
        cookieSecret: String(j.cookieSecret || ''), savedAt: j.savedAt || null,
        /* 自动核那一套（server/xverify.js）要用的三项，都是可选的：
           bearer 是 App-only 的 Bearer Token；accessToken/accessSecret 是
           本账号自己的 Access Token 对（读自己账号的数据要用户上下文）。
           一个都没配就只是不自动核，登录本身照常。 */
        bearer: j.bearer ? String(j.bearer) : null,
        accessToken: j.accessToken ? String(j.accessToken) : null,
        accessSecret: j.accessSecret ? String(j.accessSecret) : null,
        mtimeMs: st.mtimeMs
      };
      return credCache;
    } catch (e) {
      console.error('[xauth] 凭证读不出来：' + (e && e.message));
      credCache = null;
      return null;
    }
  }
  function configured() { const c = readCred(); return !!(c && c.key && c.secret && c.cookieSecret); }

  /**
   * 管理员保存凭证。**cookieSecret 只在第一次生成**，之后换 key/secret 也不动它 ——
   * 换一次就把所有人的登录状态踢掉，没必要。
   */
  function saveCred(key, secret, extra) {
    const k = String(key == null ? '' : key).trim();
    const s = String(secret == null ? '' : secret).trim();
    if (k.length < 10 || s.length < 20) return { ok: false, error: 'key / secret 看着不像 X 给的那两串' };
    const old = readCred();
    const e = extra && typeof extra === 'object' ? extra : {};
    /* 三个自动核用的字段：**没传就保留原来的**，传了空串才是清掉。
       不这样的话，管理员只想换一下 key，一保存就把 Bearer 抹了。 */
    const keep = (name) => {
      const v = e[name];
      if (v === undefined || v === null) return (old && old[name]) || null;
      const t = String(v).trim();
      return t ? t : null;
    };
    const rec = {
      key: k, secret: s,
      cookieSecret: (old && old.cookieSecret) || crypto.randomBytes(32).toString('hex'),
      bearer: keep('bearer'),
      accessToken: keep('accessToken'),
      accessSecret: keep('accessSecret'),
      savedAt: new Date().toISOString()
    };
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(credFile, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
    /* 已经存在的文件不会被 writeFileSync 的 mode 改权限，补一次。
       Windows 上 chmod 基本是空操作，不让它中断流程。 */
    try { fs.chmodSync(credFile, 0o600); } catch (e) { /* 平台不支持就算了 */ }
    credCache = null;
    return { ok: true, key4: k.slice(0, 4), savedAt: rec.savedAt };
  }
  /** 管理员那一侧只看得到「配没配、key 的前 4 位」—— secret 一个字符都不回。 */
  function credInfo() {
    const c = readCred();
    return {
      configured: !!(c && c.key && c.secret),
      key4: c ? c.key.slice(0, 4) : null,
      savedAt: c ? c.savedAt : null,
      /* 同样只回「配没配」。Bearer 和 Access Token 一个字符都不回。 */
      hasBearer: !!(c && c.bearer),
      hasAccessToken: !!(c && c.accessToken && c.accessSecret),
      callback: publicBase() ? publicBase() + '/api/x/callback' : null
    };
  }
  function clearCred() {
    try { fs.unlinkSync(credFile); } catch (e) { /* 本来就没有 */ }
    credCache = null;
    return { ok: true };
  }

  /* ---------------------------------------------------------------- 待回调的临时 token
     内存就够：它只活几分钟，进程重启时正在登录的人重点一次即可。

     **state 存在这里，也同时下发成一个一次性 cookie，回调时两边比**。
     为什么非要绑在 cookie 上、而不是把 state 塞进回调地址里：
     攻击者可以自己走一遍前两腿（用他自己的 X 号授权），拿到一对
     oauth_token / oauth_verifier，再把这条回调链接塞给受害者点。
     这时 state 就在那条链接里 —— 他当然知道。真正他拿不到的是
     **受害者浏览器里的那块 cookie**，所以门必须设在 cookie 上。
     顺带一个好处：回调地址是干净的一条，和 X 后台里登记的那条逐字相同。 */
  const pending = new Map();   // oauth_token → { secret, state, at }
  function sweep(now) {
    const t = now == null ? Date.now() : now;
    for (const [k, v] of pending) if (t - v.at > PENDING_MS) pending.delete(k);
    /* 还是太多就从最旧的开始扔 —— 有人狂点登录时，宁可让他重来，也不能把内存撑爆。 */
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
  }

  /* ---------------------------------------------------------------- 会话 cookie */
  function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(s) {
    return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }
  function signCookie(payload) {
    const c = readCred();
    if (!c) return null;
    const body = b64url(JSON.stringify(payload));
    const mac = crypto.createHmac('sha256', c.cookieSecret).update(body).digest('base64');
    return body + '.' + b64url(Buffer.from(mac, 'base64'));
  }
  /** @returns {object|null} 验不过、过期、没配凭证一律 null —— 不区分，外面只需要「没登录」。 */
  function readCookie(raw) {
    const c = readCred();
    if (!c || !raw) return null;
    const i = String(raw).indexOf('.');
    if (i < 0) return null;
    const body = String(raw).slice(0, i);
    const got = String(raw).slice(i + 1);
    const mac = crypto.createHmac('sha256', c.cookieSecret).update(body).digest('base64');
    const want = b64url(Buffer.from(mac, 'base64'));
    /* 常量时间比 —— 长度不等会抛，先用哈希摊平。 */
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    try { if (!crypto.timingSafeEqual(h(got), h(want))) return null; } catch (e) { return null; }
    try {
      const j = JSON.parse(unb64url(body));
      if (!j || !j.id || !j.handle) return null;
      if (!j.exp || Date.now() > j.exp) return null;
      return j;
    } catch (e) { return null; }
  }
  function cookieHeader(payload) {
    const v = payload ? signCookie(payload) : '';
    const bits = [COOKIE + '=' + (v || ''), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    /* 本机开发走 http，加了 Secure 浏览器直接不存这个 cookie。
       线上 PUBLIC_BASE 是 https，就一定要加。 */
    if (publicBase().indexOf('https://') === 0) bits.push('Secure');
    bits.push(payload ? 'Max-Age=' + Math.floor(SESSION_MS / 1000) : 'Max-Age=0');
    return bits.join('; ');
  }
  /** 一次性的 state cookie。传 null 就是把它删掉（回调处理完立刻删）。 */
  function stateCookieHeader(state) {
    const bits = [STATE_COOKIE + '=' + (state || ''), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (publicBase().indexOf('https://') === 0) bits.push('Secure');
    bits.push(state ? 'Max-Age=' + Math.floor(PENDING_MS / 1000) : 'Max-Age=0');
    return bits.join('; ');
  }
  /** 把某个 cookie 从请求头里摘出来（原样，不解码）。 */
  function rawCookie(req, name) {
    const raw = String((req && req.headers && req.headers.cookie) || '');
    for (const part of raw.split(';')) {
      const s = part.trim();
      if (s.indexOf(name + '=') === 0) return s.slice(name.length + 1);
    }
    return null;
  }
  /** 从请求头里把会话 cookie 摘出来并验签。 */
  function fromReq(req) {
    const v = rawCookie(req, COOKIE);
    return v == null ? null : readCookie(v);
  }
  /** 发起登录时下发的那个 state（回调时拿它和 pending 里存的比）。 */
  function stateFromReq(req) { return rawCookie(req, STATE_COOKIE); }

  /* ---------------------------------------------------------------- 第一腿 */
  async function begin(now) {
    const c = readCred();
    if (!c) return { ok: false, status: 404, error: '还没配 X 登录' };
    if (!publicBase()) return { ok: false, status: 500, error: '没配 ARCBANG_PUBLIC_BASE，回调地址拼不出来' };
    sweep(now);
    const state = crypto.randomBytes(16).toString('hex');
    /* 回调地址**不带任何 query**：X 后台登记的那一条要逐字相同，
       多一个 ?state= 就可能被判成没登记（oauth_callback_confirmed 回 false）。 */
    const cb = publicBase() + '/api/x/callback';
    const p = {
      oauth_callback: cb,
      oauth_consumer_key: c.key,
      oauth_nonce: nonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: String(nowSec()),
      oauth_version: '1.0'
    };
    const sg = sign('POST', API + '/oauth/request_token', p, c.secret, '');
    let text = null;
    try {
      const r = await fetchImpl(API + '/oauth/request_token', {
        method: 'POST',
        headers: { authorization: authHeader(p, sg), 'content-length': '0' }
      });
      text = await r.text();
      if (!r.ok) {
        console.error('[xauth] request_token 失败：' + r.status + ' ' + String(text).slice(0, 200));
        return { ok: false, status: 424, error: (r.status === 403 && /Callback URL not approved/i.test(String(text))) ? '回调地址还没在 X 开发者后台登记（User authentication settings → Callback URI）' : 'X 那边没给临时凭证（' + r.status + '）' };
      }
    } catch (e) {
      console.error('[xauth] request_token 打不通：' + (e && e.message));
      return { ok: false, status: 424, error: 'X 那边打不通，稍后再试' };
    }
    const j = parseForm(text);
    if (!j.oauth_token || !j.oauth_token_secret) return { ok: false, status: 424, error: 'X 的回复看不懂' };
    /* oauth_callback_confirmed 必须是 true：不是的话说明回调地址没在后台登记，
       这时候跳过去用户会看到 X 的报错页，而我们这边一点线索都没有。 */
    if (String(j.oauth_callback_confirmed) !== 'true') {
      return { ok: false, status: 502, error: '回调地址没在 X 后台登记（oauth_callback_confirmed 不是 true）' };
    }
    pending.set(j.oauth_token, { secret: j.oauth_token_secret, state, at: now == null ? Date.now() : now });
    return {
      ok: true,
      url: API + '/oauth/authenticate?oauth_token=' + pct(j.oauth_token),
      state,
      cookie: stateCookieHeader(state)
    };
  }

  /* ---------------------------------------------------------------- 第三腿 */
  /**
   * @param query     回调地址上的 query（oauth_token / oauth_verifier）
   * @param stateSeen 这台浏览器带回来的 state cookie（server/index.js 从请求头里摘）
   */
  async function finish(query, stateSeen, now) {
    const c = readCred();
    if (!c) return { ok: false, status: 404, error: '还没配 X 登录' };
    sweep(now);
    const token = String((query && query.oauth_token) || '');
    const verifier = String((query && query.oauth_verifier) || '');
    const state = String(stateSeen == null ? '' : stateSeen);
    if (!token || !verifier) return { ok: false, status: 400, error: '回调参数不全' };
    const p0 = pending.get(token);
    /* **这一步是整条流程的门**：临时 token 必须是我们自己发起的那一个，
       而且这台浏览器要带得出发起时下发的那个 state。少了它，别人可以自己走完
       前两腿（用他自己的 X 号授权），再把那条回调链接塞给你点 ——
       你的会话里就装进了他的账号，接着你做的任务全记在他名下。 */
    if (!p0) return { ok: false, status: 400, error: '这次登录已经过期了，重来一次' };
    if (!state || state !== p0.state) return { ok: false, status: 400, error: 'state 对不上' };
    pending.delete(token);

    const p = {
      oauth_consumer_key: c.key,
      oauth_nonce: nonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: String(nowSec()),
      oauth_token: token,
      oauth_version: '1.0'
    };
    const sg = sign('POST', API + '/oauth/access_token', Object.assign({}, p, { oauth_verifier: verifier }), c.secret, p0.secret);
    let text = null;
    try {
      const r = await fetchImpl(API + '/oauth/access_token', {
        method: 'POST',
        headers: {
          authorization: authHeader(Object.assign({}, p, { oauth_verifier: verifier }), sg),
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: 'oauth_verifier=' + pct(verifier)
      });
      text = await r.text();
      if (!r.ok) {
        console.error('[xauth] access_token 失败：' + r.status + ' ' + String(text).slice(0, 200));
        return { ok: false, status: 502, error: 'X 那边没换到正式凭证（' + r.status + '）' };
      }
    } catch (e) {
      console.error('[xauth] access_token 打不通：' + (e && e.message));
      return { ok: false, status: 424, error: 'X 那边打不通，稍后再试' };
    }
    const j = parseForm(text);
    /* **这一响应里就有 user_id 与 screen_name** —— 这正是选 1.0a 的理由：
       不必再调 users/me，那一条要读取额度，而免费档的读取额度是 0。 */
    if (!j.user_id || !j.screen_name) return { ok: false, status: 502, error: 'X 没回用户信息' };
    const payload = {
      id: String(j.user_id),
      handle: String(j.screen_name),
      exp: (now == null ? Date.now() : now) + SESSION_MS
    };
    return { ok: true, session: payload, cookie: cookieHeader(payload) };
  }

  return {
    configured, credInfo, saveCred, clearCred,
    begin, finish, fromReq, cookieHeader, readCookie, signCookie,
    stateFromReq, stateCookieHeader, readCred,
    COOKIE, STATE_COOKIE, credFile,
    _pending: pending
  };
}

module.exports = {
  create, pct, baseString, signingKey, sign, authHeader, parseForm,
  COOKIE, STATE_COOKIE, SESSION_MS
};
