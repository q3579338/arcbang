/*
 * 推广短码 —— 8 位，一地址一码（specs/share-referral-v1.md §8）
 * ------------------------------------------------------------
 * 为什么是 8 位定长：不定长的自定义名有"好名字"之分（短的、词典词），会被脚本刷光。
 * 8 位定长里没有哪个比哪个更值钱，抢注没有收益 —— 所以不设门槛、不烧币。
 *
 * 字符集去掉 O/0/I/1（32 个字符），防的是人抄错。32^8 ≈ 1.1 万亿，随机撞不上，
 * 但生成时**照样查重**：概率小不等于不发生，而这里查重只是一次 Map.has。
 *
 * ---- 要害：认领必须验签 ----
 * 没有签名的话，任何人都能把别人的短码改到自己名下 —— 短码是拿返利的凭据，
 * 那等于把别人的推广收益转走。所以 POST 必须带该地址对
 *     "BNBBANG refcode <CODE> <时间戳>"
 * 的 EIP-191 签名（就是钱包 personal_sign 那套，不花 gas）。
 * 手法照 ratelimit.js 的挑战验签：verifyMessage 还原出签名者，和 addr 逐字比。
 *
 * 时间戳那一段是**新鲜度**，不是身份：
 *   - 超出 CLAIM_WINDOW_SEC 的旧签名一律拒（捡到一份旧签名也用不了）；
 *   - 窗口内重放只能把同一个地址的同一个码再认领一次 —— 幂等，没有收益。
 * 规格把消息格式定死了（前端要照着签），所以这里不另发服务端 nonce：
 * 换成 nonce 就要多一次往返，而前端那半边正由另一个 agent 照规格实现。
 *
 * ---- 存储 ----
 * .store/refcodes.json，**原子写**（照 .store 里其余文件的写法）：
 *     { codes: { "K7M2X9QP": {addr, at} }, byAddr: { "0x…": "K7M2X9QP" } }
 * 两张表互为反向索引，任何一次改动都要一起改、一起落盘。
 * 规格里写的是 `{ code: {addr, at}, byAddr: {addr: code} }` —— 同样两张表，
 * 这里把码那张收进 codes 键下，免得哪天有人认领了一个叫 BYADDR 的码（8 位定长
 * 其实撞不上，但把数据和索引平铺在同一层本身就是个坑）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifyMessage } = require('ethers');
const { writeAtomic } = require('./atomic.js');
const { ipOf } = require('./ratelimit.js');
const { envInt } = require('./envint.js');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 个：去掉 O/0/I/1
const LEN = 8;
const CODE_RE = new RegExp('^[' + ALPHABET + ']{' + LEN + '}$');
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
/** 认领签名的新鲜度窗口（秒）。给用户留出打开钱包、看清内容、点确认的时间。
    NaN 会让 `now - ts > CLAIM_WINDOW_SEC` 恒为 false = 旧签名永不超时。 */
const CLAIM_WINDOW_SEC = envInt(process.env.BNBBANG_REFCODE_WINDOW, 600, 30, 86400);
/** 时钟偏差容忍：客户端表快一点不该被判过期 */
const CLOCK_SKEW_SEC = 120;

/* 撞路由/页面的不给用。**即使凑够 8 位也拦** —— 判据是"以保留词开头"：
   短码将来很可能出现在路径里（bnbbang.com/K7M2X9QP），而 APPXXXXX 这种
   一眼看去就像 /app 的子路径，容易被人拿来钓鱼。
   注意字符集里没有 O/0/I/1，所以 api、admin、token、deploy、login 这些词
   **根本拼不出来**（含 I 或 O）—— 下面按字符集过滤一遍，只留真能拼出来的，
   免得黑名单里躺着一堆永远匹配不到的词，让人误以为防住了什么。 */
const RESERVED_RAW = [
  // 服务端路由
  'API', 'BANG', 'CARD', 'ART', 'TOKEN', 'MARKET', 'HEALTH', 'LIMIT', 'CRAFT',
  'INTERVENE', 'REFERRALS', 'REFCODE', 'DEPLOY', 'ADMIN', 'STATUS',
  // 页面与站点保留
  'WWW', 'APP', 'INDEX', 'LANDING', 'ECONOMY', 'PROFILE', 'MIRROR', 'PLANETS',
  'CONFIG', 'STATIC', 'ASSETS', 'PUBLIC', 'ROBOTS', 'FAVICON', 'SHARE', 'HELP',
  // 品牌与角色：拿去冒充官方的
  'BNBBANG', 'BNB', 'TEAM', 'STAFF', 'SUPPORT', 'SYSTEM', 'ABUSE', 'SECURITY',
  'WALLET', 'MINT', 'RESCUE', 'PROMO', 'TEST'
];
const RESERVED = RESERVED_RAW.filter(w => w.split('').every(ch => ALPHABET.indexOf(ch) >= 0));

const FILE = () => path.join(process.env.BNBBANG_STORE || path.join(__dirname, '.store'), 'refcodes.json');

/* 内存里那一份。**每次读文件路径**（FILE()）是因为自检会把 BNBBANG_STORE 指到临时目录，
   而这个模块可能在那之前就被 require 了。 */
let db = null;
let dbFile = null;
function load() {
  const f = FILE();
  if (db && dbFile === f) return db;
  dbFile = f;
  db = { codes: {}, byAddr: {} };
  try {
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (o && typeof o === 'object') {
      if (o.codes && typeof o.codes === 'object') db.codes = o.codes;
      if (o.byAddr && typeof o.byAddr === 'object') db.byAddr = o.byAddr;
    }
  } catch (e) {
    /* 没有文件 = 还没人领过码，不是错。
       文件坏了：这份表**可再生性很差**（用户领过的码丢了就是换了个码），
       所以吼一声，但不能因此让端点 500 —— 那会让整条分享链路跟着哑。 */
    if (e.code !== 'ENOENT') console.error('[refcode] 映射表读不出来，当成空表：' + e.message);
  }
  return db;
}
function persist() {
  const f = FILE();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeAtomic(f, JSON.stringify(db));
}

/** 随机一个码。crypto 取随机数并**丢掉不能整除的那一段**，否则前几个字符概率偏高 */
function randomCode() {
  let out = '';
  while (out.length < LEN) {
    const buf = crypto.randomBytes(LEN);
    for (let i = 0; i < buf.length && out.length < LEN; i++) {
      const v = buf[i];
      if (v >= 256 - (256 % ALPHABET.length)) continue;   // 拒采样，保持均匀
      out += ALPHABET[v % ALPHABET.length];
    }
  }
  return out;
}

/** @returns {{ok:true}|{ok:false, error:string, reason:string}} */
function validateCode(code) {
  if (typeof code !== 'string') return { ok: false, reason: 'format', error: '短码要是一个字符串' };
  const c = code.toUpperCase();
  if (c.length !== LEN) return { ok: false, reason: 'length', error: '短码必须是 ' + LEN + ' 位' };
  if (!CODE_RE.test(c)) {
    return { ok: false, reason: 'charset', error: '短码只能用 ' + ALPHABET + '（去掉了容易抄错的 O/0/I/1）' };
  }
  for (const w of RESERVED) {
    if (c.startsWith(w)) return { ok: false, reason: 'reserved', error: '「' + w + '」开头的短码是保留词，换一个' };
  }
  return { ok: true };
}

/** 认领时要签的那句话。前端必须逐字节签这一句，差一个空格都验不过 */
function claimMessage(code, ts) {
  return 'BNBBANG refcode ' + String(code).toUpperCase() + ' ' + String(ts);
}

/* ---------------------------------------------------------------- 自动生成的闸
   GET /api/refcode?addr= 会**当场生成并落盘**（规格要求幂等）。这就意味着
   谁都能拿一串编好的地址把 refcodes.json 撑大，而这张表是整份读进内存、
   每次改动整份写回的 —— 涨到几十万条时一次写盘就是几十 MB。
   所以给"生成新码"这个动作单独加一道很松的 IP 闸（查已有的码不受影响）。
   内存实现，进程重启清零，和 ratelimit.js 同口径。 */
const GEN_PER_HOUR = envInt(process.env.BNBBANG_REFCODE_GEN_LIMIT, 30, 1, 10000);
const genBuckets = new Map();
/* commit 不传只查不扣：额度要等**真落盘成功**才扣（codeOf 里 persist 之后）。
   原来进门就 n++，写盘 503 时额度已经被吃掉 —— 磁盘抖一阵，用户一个码都没拿到，
   一小时的额度先烧光了。load/persist 都是同步的，查和扣之间不会插进别的请求。 */
function genGate(ip, commit) {
  const now = Date.now();
  for (const [k, v] of genBuckets) if (v.resetAt <= now) genBuckets.delete(k);
  let b = genBuckets.get(ip);
  if (!b || b.resetAt <= now) { b = { n: 0, resetAt: now + 3600000 }; genBuckets.set(ip, b); }
  if (b.n >= GEN_PER_HOUR) return false;
  if (commit) b.n++;
  return true;
}
/* IP 口径与 ratelimit.js 的 ipOf 完全同一份：X-Real-IP / XFF 最后一跳，
   永不信 cf-connecting-ip。抄一份迟早会漏掉某一头。 */

/* ---------------------------------------------------------------- 对外三条 */

/**
 * 这个地址的码；没有就生成一个并落盘（幂等）。
 * @returns {{code:string, addr:string, created:boolean}|{error:string, status:number}}
 */
function codeOf(addr, req) {
  if (!ADDR_RE.test(String(addr || ''))) return { error: 'addr 不是一个地址', status: 400 };
  const a = String(addr).toLowerCase();
  const d = load();
  const have = d.byAddr[a];
  if (have && d.codes[have]) return { code: have, addr: a, created: false };

  if (req && !genGate(ipOf(req))) {
    return { error: '生成短码太频繁了，过一会儿再来', status: 429 };
  }
  let code = randomCode();
  /* 查重 + 撞保留词就重 roll。上限 40 次是防死循环，不是防碰撞：
     32^8 里撞 40 次的概率约等于零，真撞到 40 次说明表已经不对劲了。 */
  for (let i = 0; (d.codes[code] || !validateCode(code).ok) && i < 40; i++) code = randomCode();
  if (d.codes[code]) return { error: '一时生成不出没被占用的短码，请重试', status: 503 };
  d.codes[code] = { addr: a, at: new Date().toISOString() };
  d.byAddr[a] = code;
  try { persist(); }
  catch (e) {
    /* 写不进去就**不能**把这个码报出去：用户会拿它去发链接，重启之后它不存在。
       额度也不扣（genGate 只查未扣）—— 503 是服务端自己的问题，不该记在用户头上。 */
    delete d.codes[code]; delete d.byAddr[a];
    console.error('[refcode] 映射表写不进去：' + e.message);
    return { error: '短码存不下来，请稍后再试', status: 503 };
  }
  if (req) genGate(ipOf(req), true);   // 真生成成功了，这一刻才扣额度
  return { code, addr: a, created: true };
}

/**
 * 认领自定义码。**必须验签**。
 * @param {{addr:string, code:string, sig:string, ts:number|string}} body
 * @returns {{code:string, addr:string, replaced:string|null}|{error:string, status:number, reason?:string}}
 */
function claim(body) {
  const b = body || {};
  if (!ADDR_RE.test(String(b.addr || ''))) return { error: 'addr 不是一个地址', status: 400 };
  const a = String(b.addr).toLowerCase();

  const v = validateCode(b.code);
  if (!v.ok) return { error: v.error, status: 400, reason: v.reason };
  const code = String(b.code).toUpperCase();

  const ts = Number(b.ts != null ? b.ts : b.timestamp);
  if (!Number.isFinite(ts) || !Number.isInteger(ts) || ts <= 0) {
    return { error: '缺 ts（签名里那个 Unix 秒时间戳，要原样传上来）', status: 400, reason: 'ts' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (ts > now + CLOCK_SKEW_SEC || now - ts > CLAIM_WINDOW_SEC) {
    return {
      error: '签名过期了（有效期 ' + CLAIM_WINDOW_SEC + ' 秒），重新签一次',
      status: 400, reason: 'expired'
    };
  }
  if (typeof b.sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(b.sig)) {
    return { error: '缺签名，或者签名格式不对', status: 400, reason: 'sig' };
  }

  let signer;
  try { signer = verifyMessage(claimMessage(code, ts), b.sig).toLowerCase(); }
  catch (e) { return { error: '签名无法解析', status: 400, reason: 'sig' }; }
  if (signer !== a) {
    /* 这条就是整件事的要害：签名不是这个地址签的，说明有人想替别人改码。 */
    return { error: '签名不是这个地址签的', status: 401, reason: 'sig' };
  }

  const d = load();
  const owner = d.codes[code];
  if (owner && owner.addr !== a) return { error: '这个短码已经被占用了', status: 409, reason: 'taken' };
  if (owner && owner.addr === a) return { code, addr: a, replaced: null };   // 幂等：本来就是他的

  /* 换码：旧码**立刻失效**，不做重定向 —— 短码不是永久身份，地址才是（规格 §8.1）。 */
  const old = d.byAddr[a] || null;
  const snapshot = { old, oldRec: old ? d.codes[old] : null };
  if (old) delete d.codes[old];
  d.codes[code] = { addr: a, at: new Date().toISOString() };
  d.byAddr[a] = code;
  try { persist(); }
  catch (e) {
    // 回滚内存，免得内存与磁盘说两套话
    delete d.codes[code];
    if (snapshot.old) { d.codes[snapshot.old] = snapshot.oldRec; d.byAddr[a] = snapshot.old; }
    else delete d.byAddr[a];
    console.error('[refcode] 认领写不进去：' + e.message);
    return { error: '短码存不下来，请稍后再试', status: 503 };
  }
  return { code, addr: a, replaced: old };
}

/**
 * 短码 → 地址。
 * 也认 0x 地址原样返回：规格 §8.2 要求两种 ?ref= 格式都支持，
 * 前端少写一段分支，而**已经发出去的地址链接不能失效**是硬要求。
 */
function resolve(code) {
  const s = String(code || '');
  if (ADDR_RE.test(s)) return { addr: s.toLowerCase(), code: null, direct: true };
  if (!CODE_RE.test(s.toUpperCase())) return { error: '短码格式不对', status: 400 };
  const rec = load().codes[s.toUpperCase()];
  if (!rec) return { error: '没有这个短码', status: 404 };
  return { addr: rec.addr, code: s.toUpperCase(), at: rec.at, direct: false };
}

module.exports = {
  codeOf, claim, resolve, validateCode, claimMessage, randomCode,
  ALPHABET, LEN, RESERVED, CLAIM_WINDOW_SEC,
  _reload: () => { db = null; dbFile = null; return load(); },
  _stats: () => ({ codes: Object.keys(load().codes).length, addrs: Object.keys(load().byAddr).length })
};
