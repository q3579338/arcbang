/*
 * 限流 —— 免费引爆的那道闸
 * ------------------------------------------------------------
 * 为什么需要它（specs/economy-v4.md §七「关于算法保密」）：
 * 免费引爆**本身就是扫描接口**。用户不需要拿到推导算法，挨个哈希点引爆、
 * 服务端把结局告诉他、他只 mint 好的即可。把算法藏在服务端没堵住这条路，
 * 只是把扫描的算力成本转嫁到了我们的服务器上。
 *
 * 所以：**限流才是真正起作用的那道闸**，保密只是抬高门槛。
 *
 * 两档识别，理由见下：
 *   匿名   按 IP 限，宽松。IP 换起来太容易，这一档只挡随手写的脚本。
 *   已验证 按钱包地址限，额度高。要拿到这一档必须用私钥签一次名 ——
 *          不花 gas，但证明了地址确实归你。
 *
 * 诚实说明：**这挡不住肯造地址的人**。签名不花钱，一万个地址就是一万份额度。
 * 它真正的作用是让「随手写个循环扫全链」变得不划算，以及在真出事时有据可查。
 * 想再进一步就得要求地址有链上历史或余额 —— 那才有真实成本，但也会挡住新用户，
 * 留到真出问题再加。
 *
 * 内存实现，进程重启即清零。单机足够；将来上多实例要换成 Redis。
 */
'use strict';
const crypto = require('crypto');
const { verifyMessage } = require('ethers');
const { envInt } = require('./envint.js');

/* 2026-09-17 用户拍板改口径：原来是「匿名每 IP 每小时 30 个新哈希、签名后每天 50 个」，
   玩家正常点几下就撞墙，而且 /api/card 只是算一张参数卡，还不是引爆——被拦的人一头雾水。
   改成两道**短窗**：
     · 每 IP 每分钟的突发上限（挡随手写的循环脚本，人手点不到）；
     · 全站每分钟总上限（保护 CPU：一张卡是一次完整的引擎模拟）。
   不再有「一天的额度」这种东西；签名换来的只是更高的每分钟突发值。
   老的环境变量名保留兼容但语义变了：BNBBANG_ANON_LIMIT = 每分钟。 */
/** 匿名：每 IP 每分钟多少个**新**哈希。NaN 会让 `count >= limit` 恒为 false = 限流被关掉。 */
const ANON_PER_HOUR = envInt(process.env.BNBBANG_ANON_PER_MIN || process.env.BNBBANG_ANON_LIMIT, 12, 1, 10000);
/** 已验证地址：每分钟多少个（签一次名换 24 小时令牌，不花 gas） */
const ADDR_PER_DAY = envInt(process.env.BNBBANG_ADDR_PER_MIN || process.env.BNBBANG_ADDR_LIMIT, 30, 1, 10000);
/** 全站每分钟总上限（所有人共用一个桶） */
/* 2026-09-17：算卡搬进 worker 线程池（server/cardpool.js）之后从 3,000 提到 10,000。
   原来的 3,000 是按**单线程**定的：一张卡本机实测 8 ms、VPS（E3-1230）单核 15–20 ms，
   一条请求线程一分钟也就算 3,000–4,000 张。现在 4 核并行，产能翻了几倍，
   3,000 这根保险丝先于 CPU 熔断，反而成了人为的天花板。
   10,000 是用户拍板的固定值（不随线程数变：线程数是本机的事，
   而这根丝要挡的是「有人拿一万个哈希扫全链」，两者不该绑在一起）。
   仍然是保险丝不是目标：每 IP 12/分钟，要 800 多人同时以最快手速点才碰得到；
   真要调就设 BNBBANG_GLOBAL_PER_MIN。 */
const GLOBAL_PER_MIN = envInt(process.env.BNBBANG_GLOBAL_PER_MIN, 10000, 1, 100000);
const MINUTE = 60 * 1000;
/** /limit/challenge 每 IP 每小时多少次。这条路原来不限流，刷 nonce 能把内存撑爆 */
const CHALLENGE_PER_HOUR = envInt(process.env.BNBBANG_CHALLENGE_LIMIT, 30, 1, 10000);
/** 令牌有效期 */
const TOKEN_TTL_MS = 24 * 3600 * 1000;
/** 挑战有效期：短一点，防止有人囤一堆待签的挑战 */
const NONCE_TTL_MS = 5 * 60 * 1000;
/** 未兑换挑战 / 令牌的硬顶。sweep 是 60 秒一次，窗口里仍能灌满 */
const MAX_NONCES = 4000;
const MAX_TOKENS = 8000;

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/* key → { count, resetAt }。滑窗做成"到点整体清零"而不是逐条记时间戳：
   逐条记的话，一个刷子能让内存无限增长 —— 限流器自己成了攻击面。 */
const buckets = new Map();
const nonces = new Map();     // nonce → { addr, expires }
const tokens = new Map();     // token → { addr, expires }

function sweep(now) {
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  for (const [k, v] of nonces) if (v.expires <= now) nonces.delete(k);
  for (const [k, v] of tokens) if (v.expires <= now) tokens.delete(k);
}
let lastSweep = 0;

/**
 * 扣一次额度。
 *
 * @param hash 这次请求问的是哪个宇宙。**同一个哈希在窗口内只扣一次。**
 *
 * 为什么按「不同的宇宙」计数而不是按请求数：这道闸防的是「挨个哈希扫全链、
 * 只挑 S 档下手」，而扫描的特征就是哈希各不相同。重复问同一个哈希不是扫描 ——
 * 最典型的就是铸造：铸造前必须再取一次签名（签名带 600 秒 deadline，
 * 引爆时那份早过期了），如果这一次也扣额度，就会出现
 * **人已经决定收下这个宇宙、却因为之前看得多而铸不了** 的情况。
 * 那是把闸架在了它根本不该拦的动作上。
 *
 * seen 的大小天然被 limit 卡住（只有真扣了才往里加），不会涨成内存问题。
 *
 * @returns {{ok:boolean, remaining:number, resetAt:number, repeat:boolean}}
 */
function take(key, limit, windowMs, hash) {
  const now = Date.now();
  if (now - lastSweep > 60000) { sweep(now); lastSweep = now; }

  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs, seen: new Set() };
    buckets.set(key, b);
  }
  if (!b.seen) b.seen = new Set();          // 兼容旧桶（热升级时窗口里还留着的）

  // 这个窗口里已经为它扣过了 —— 直接放行，也不再扣
  if (hash && b.seen.has(hash)) {
    return { ok: true, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt, repeat: true };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, resetAt: b.resetAt, repeat: false };
  }
  b.count++;
  if (hash) b.seen.add(hash);
  return { ok: true, remaining: limit - b.count, resetAt: b.resetAt, repeat: false };
}

/* ---------------------------------------------------------------- 客户端 IP
   nginx（web/nginx-test.satloot.com.conf）在 Cloudflare 后面：
     real_ip_header CF-Connecting-IP;          ← $remote_addr 已经是真实访客
     proxy_set_header X-Real-IP $remote_addr;  ← **覆盖**客户端带来的同名头
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; ← 末尾追加 $remote_addr

   所以可信的是 X-Real-IP，或 XFF **最后一跳**。不可信的：
     · cf-connecting-ip —— nginx 不会覆盖，客户端随便填
     · XFF 第一段 —— 客户端自己写的
   直连（socket 不是本机）一律不信转发头：服务绑 127.0.0.1，直连只可能是本机或配错。 */

function normalizeIp(s) {
  return String(s || '').trim().replace(/^::ffff:/i, '');
}
function isLoopback(addr) {
  const a = normalizeIp(addr).toLowerCase();
  return !a || a === '127.0.0.1' || a === '::1' || a === 'localhost';
}
/**
 * @param {object} req
 * @returns {string}
 */
function ipOf(req) {
  const hdr = (req && req.headers) || {};
  const remote = normalizeIp(req && req.socket && req.socket.remoteAddress);
  let ip = '';
  if (isLoopback(remote)) {
    const real = normalizeIp(hdr['x-real-ip']);
    /* 逗号 / 斜杠 = 有人把一整串 XFF 塞进 X-Real-IP，不当单一地址 */
    if (real && real.indexOf(',') < 0 && real.indexOf('/') < 0) ip = real;
    if (!ip) {
      const parts = String(hdr['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length) ip = normalizeIp(parts[parts.length - 1]);
    }
  }
  return ip || remote || 'unknown';
}

/* ---------------------------------------------------------------- 地址验证 */

/**
 * 发一个待签的挑战。**必须由服务端生成并记住** ——
 * 让客户端自己挑要签什么，等于谁都能拿一份旧签名反复用。
 * @param {string} addr
 * @param {object} [req] 用来按 IP 限流；测试里可以不传
 */
function challenge(addr, req) {
  const a = String(addr || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error('地址格式不对');
  /* 这里也要扫一遍。清理原来只挂在 take() 里，而 take 只有 /bang、/card、
     /intervene 这几条路会走 —— 光刷 /limit/challenge（它自己不限流）的话，
     一个过期挑战都清不掉，限流器自己成了内存攻击面。 */
  const now = Date.now();
  if (now - lastSweep > 60000) { sweep(now); lastSweep = now; }
  const ip = ipOf(req);
  const gated = take('c:' + ip, CHALLENGE_PER_HOUR, HOUR, null);
  if (!gated.ok) {
    const e = new Error('验证太频繁了，过一会儿再来');
    e.status = 429;
    throw e;
  }
  if (nonces.size >= MAX_NONCES) {
    sweep(Date.now());
    if (nonces.size >= MAX_NONCES) {
      const e = new Error('验证太频繁了，过一会儿再来');
      e.status = 429;
      throw e;
    }
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(nonce, { addr: a, expires: Date.now() + NONCE_TTL_MS });
  return {
    nonce,
    message: 'BNBBANG 引爆额度验证\n地址: ' + a + '\n随机串: ' + nonce
      + '\n\n签名不会花费任何 gas，也不会授权任何转账。'
  };
}

/** 验签换令牌。签错、过期、地址对不上都拒。 */
function redeem(nonce, signature) {
  const rec = nonces.get(nonce);
  if (!rec) throw new Error('挑战不存在或已过期');
  nonces.delete(nonce);                       // 一次性，用过即焚
  if (rec.expires <= Date.now()) throw new Error('挑战已过期');

  const msg = 'BNBBANG 引爆额度验证\n地址: ' + rec.addr + '\n随机串: ' + nonce
    + '\n\n签名不会花费任何 gas，也不会授权任何转账。';
  let signer;
  try { signer = verifyMessage(msg, signature).toLowerCase(); }
  catch (e) { throw new Error('签名无法解析'); }
  if (signer !== rec.addr) throw new Error('签名不是这个地址签的');

  if (tokens.size >= MAX_TOKENS) {
    sweep(Date.now());
    if (tokens.size >= MAX_TOKENS) throw new Error('验证太频繁了，过一会儿再来');
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { addr: rec.addr, expires: Date.now() + TOKEN_TTL_MS });
  return { token, address: rec.addr, expiresIn: TOKEN_TTL_MS / 1000, limitPerDay: ADDR_PER_DAY };
}

/** 令牌 → 地址；无效返回 null */
function addrOf(token) {
  if (!token) return null;
  const rec = tokens.get(token);
  if (!rec || rec.expires <= Date.now()) return null;
  return rec.addr;
}

/* ---------------------------------------------------------------- 主入口 */

/**
 * 对一次请求计数。
 * @param {object} req  用来取 IP 和 Authorization 头
 * @param {string} [hash] 这次问的是哪个宇宙。传了的话，窗口内重复问同一个不再扣额度
 * @returns {{ok:boolean, scope:'address'|'ip', remaining:number, resetAt:number, address:string|null}}
 */
function check(req, hash) {
  const auth = (req.headers && req.headers.authorization) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const addr = addrOf(token);
  const h = typeof hash === 'string' && hash ? hash.toLowerCase() : null;

  /* 先过全站总闸再过个人闸：全站满了谁都进不来，个人闸只挡脚本。
     重复问同一个哈希（h 已见过）两道闸都不扣 —— take() 里的 seen 集合负责。 */
  const g = take('g:all', GLOBAL_PER_MIN, MINUTE, h);
  if (!g.ok) return Object.assign({ scope: 'global', address: addr || null }, g);

  if (addr) {
    const r = take('a:' + addr, ADDR_PER_DAY, MINUTE, h);
    return Object.assign({ scope: 'address', address: addr }, r);
  }

  const ip = ipOf(req);
  const r = take('i:' + ip, ANON_PER_HOUR, MINUTE, h);
  return Object.assign({ scope: 'ip', address: null }, r);
}

/** 给响应加标准的限流头，客户端能自己看还剩多少 */
function headers(r) {
  return {
    'x-ratelimit-limit': String(r.scope === 'address' ? ADDR_PER_DAY : r.scope === 'global' ? GLOBAL_PER_MIN : ANON_PER_HOUR),
    'x-ratelimit-remaining': String(r.remaining),
    'x-ratelimit-reset': String(Math.ceil(r.resetAt / 1000)),
    'x-ratelimit-scope': r.scope
  };
}

module.exports = {
  check, headers, challenge, redeem, addrOf, ipOf, take,
  ANON_PER_HOUR, ADDR_PER_DAY, CHALLENGE_PER_HOUR, GLOBAL_PER_MIN,
  _stats: () => ({ buckets: buckets.size, nonces: nonces.size, tokens: tokens.size })
};
