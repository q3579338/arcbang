/*
 * ARCBANG 服务端
 * ------------------------------------------------------------
 * 跑在 127.0.0.1:8801（ARCBANG_PORT 可改），由 nginx 以 /api/ 反代出去
 * （见 web/nginx-arcbang.xyz.conf）。
 * 职责三件：算 card、盖章（签名）、出图。
 */
'use strict';
/* 环境变量旧名兼容（BNBBANG_* → ARCBANG_*）。**必须排在所有 require 之前** ——
   下面每个模块都在自己的顶层就把 env 读进常量了。 */
require('./env-compat.js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildCard, DERIVATION_VERSION, CARD_SHAPE } = require('./card.js');
const { renderSVG } = require('./art.js');
const { blockByHash, CHAIN_ID, CHAIN_NAME, probeChainId, liveChainId,
  probeLogRpc, liveLogRpcOk, chainConfigErrors } = require('./chain.js');
const { makeSigner, TTL_SEC, minterFromBody } = require('./sign.js');
/* 后台的钱包登录要验一条 personal_sign —— 和 allowlist 用的是同一套恢复。 */
const { verifyMessage } = require('ethers');
const { evaluate, interveneDigest, opsHashOf, suggestNext, MAX_OPS } = require('./intervene.js');
const { readToken, buildMetadata } = require('./token.js');
const RL = require('./ratelimit.js');
/* 广播 v2三件套。全部是**旁路**：
   出图退通用预览、落地页退跳首页、短码只是留痕的别名 ——
   任何一环挂了，铸造/干预/市场照常。 */
const PNG = require('./png.js');
const SHARE = require('./share.js');
const RELAY = require('./rpcrelay.js');
/* 可索引的分享落地页（landing.js）、索引集合与 sitemap（seo.js）、1200×630 的 og 图（og.js）。
   同样全是旁路：任何一个挂了，落地页退成通用文案、og 图退通用预览，
   铸造/干预/市场一个字节都不经过它们。 */
const LANDING = require('./landing.js');
const SEO = require('./seo.js');
const OG = require('./og.js');
/* 邀请奖励 + 邀请列表。同样是旁路：
   它挂了个人中心少两块数据，铸造/干预/市场一个字节都不经过它。 */
/* 按高度取块要走 chainMod.blockByNumber 而**不是**解构出来的引用：
   selftest 靠替换模块上的方法来打桩，解构走的那份换不掉（token.js 踩过这个坑）。 */
const chainMod = require('./chain.js');
/* 市场索引。**require 它不会启动任何东西** ——
   后台扫链要 MI.startIndexer() 显式开，而那一句只在 start() 里（selftest 直接
   require 本文件，不该因此在后台开始扫链）。索引整个挂掉的后果上限是市场页
   看到旧数据并自己说自己旧；铸造/干预/造物三条写链路一个字节都不经过它。 */
const MI = require('./marketindex.js');
/* 算卡线程池（server/cardpool.js）。**require 它不会起任何线程** —— 线程是第一次
   真要算卡时才惰性起的，而且闲着时 unref，所以 selftest 直接 require 本文件不会
   被它钉住不退出。ARCBANG_CARD_WORKERS=0 可以整个关掉，退回主线程同步算。 */
const CARDPOOL = require('./cardpool.js');
const { envInt } = require('./envint.js');

const PORT = envInt(process.env.ARCBANG_PORT, 8801, 1, 65535);
const CONTRACT = (process.env.ARCBANG_CONTRACT || '').toLowerCase();
const PUBLIC_BASE = process.env.ARCBANG_PUBLIC_BASE || '';
const CACHE_DIR = process.env.ARCBANG_CACHE || path.join(__dirname, '.cache');
const STORE_DIR = process.env.ARCBANG_STORE || path.join(__dirname, '.store');

if (!/^0x[0-9a-f]{40}$/.test(CONTRACT)) {
  console.error('必须设 ARCBANG_CONTRACT（合约地址）—— 签名要绑死它，否则能被喂给别的合约');
  process.exit(1);
}

/** 启动时用。缺链身份 / RPC / 对外域名，或主网却带着测试网默认，一律拒绝启动。
    不在 require 时退出：selftest 要先设 env 再加载本文件。opts 给自检覆盖。 */
function serverEnvErrors(opts) {
  opts = opts || {};
  const id = opts.chainId != null ? Number(opts.chainId) : CHAIN_ID;
  const publicBase = opts.publicBase != null ? opts.publicBase : PUBLIC_BASE;
  const indexFrom = opts.indexFrom != null ? opts.indexFrom : process.env.ARCBANG_INDEX_FROM;
  const vault = String(opts.referralVault != null ? opts.referralVault : (process.env.ARCBANG_REFERRAL_VAULT || '')).toLowerCase();
  const errs = chainConfigErrors({
    chainId: id,
    rpcs: opts.rpcs || undefined,
    logRpcs: opts.logRpcs || undefined
  });
  if (!publicBase) {
    errs.push('ARCBANG_PUBLIC_BASE 必须显式配置（主网 https://arcbang.xyz），禁止默认测试域名');
  } else if (id === 56 && /satloot|testnet/i.test(publicBase)) {
    errs.push('主网 ARCBANG_PUBLIC_BASE 不能是测试域名：' + publicBase);
  }
  if (id === 56) {
    if (!(Number(indexFrom) > 0)) {
      errs.push('主网必须设 ARCBANG_INDEX_FROM=合约部署高度，禁止默认回看 50000 块');
    }
    if (!/^0x[0-9a-f]{40}$/.test(vault)) {
      errs.push('主网必须设 ARCBANG_REFERRAL_VAULT（返利金库地址），禁止测试网默认值');
    } else if (vault === '0x052e9c4bc320706e1bdb1bae618256f54b5ae4a5') {
      errs.push('主网 ARCBANG_REFERRAL_VAULT 不能是测试网默认金库');
    }
  }
  return errs;
}
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(STORE_DIR, { recursive: true });

const signer = makeSigner(CHAIN_ID, CONTRACT);
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/* ---------------------------------------------------------------- 缓存
   card 和 SVG 都是 blockHash 的纯函数，所以缓存永不失效，不需要 TTL。

   但缓存键必须同时带**两个**版本号，少一个就会吃到旧结构：
     derivationVersion —— 数值变了（换了推导）
     SHAPE             —— 结构变了（card 多了/少了字段，数值没变）
   踩过一次：给 card 加 rarity 字段时只有结构变、derivationVersion 没动，
   于是旧缓存一直命中，前端拿到的 card 里 rarity 是 undefined。 */
const SHAPE = CARD_SHAPE;            // 与干预/造物指纹序列化版本同一口径；改结构或改指纹算法时 +1

/* 写盘必须原子。writeFileSync 是「先把文件截成 0 再往里灌」，中间那一小段时间
   文件是半截的 —— 而同一个哈希**同时**来两个请求时，两边都会算完往同一个文件写，
   第三个请求正好在这时候读，拿到的就是坏 JSON，然后 JSON.parse 抛出去变成 500。
   一张 card 12 KB、一张全尺寸 SVG 498 KB，窗口不算小。
   先写临时文件再 rename：rename 在同一个文件系统上是原子的（Windows 上 Node 走
   MoveFileEx + REPLACE_EXISTING，同样是原子替换），读的人要么看到旧的完整内容、
   要么看到新的完整内容，永远看不到半截。

   实现搬去了 atomic.js —— 分享图缓存（png.js）和短码映射表（refcode.js）
   要用同一份，抄三遍迟早有一份漏掉 unlink 或者少一次 rename。 */
const { writeAtomic } = require('./atomic.js');
/* 缓存文件名只许 [A-Za-z0-9._-]。path.join(dir, '/etc/passwd') 在 POSIX 上
   会丢掉 dir，等于读任意绝对路径；HTTP 那头 key 是我们拼的哈希，这是防漏。 */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
function underDir(dir, name) {
  if (!SAFE_NAME.test(name)) return null;
  const root = path.resolve(dir);
  const resolved = path.resolve(path.join(dir, name));
  if (resolved !== root && resolved.indexOf(root + path.sep) !== 0) return null;
  return resolved;
}
function cacheGet(key) {
  const f = underDir(CACHE_DIR, key);
  return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
function cachePut(key, val) {
  const f = underDir(CACHE_DIR, key);
  if (!f) throw new Error('bad cache key');
  writeAtomic(f, val);
  return val;
}

/* ---------------------------------------------------------------- 存档
   干预后的 card 存这儿，和上面的缓存**分两个目录**，区别是可不可再生：
   blockHash 的 card 删了能按哈希重算，干预后的 card 删了就真没了 ——
   位移是用户当场提交的，链上只留下一个 cardHash，谁也反推不回参数。
   缓存目录随时可以清空，这个目录清空等于把已经烧掉币的 NFT 变成白板。

   键里**不挂版本号**，理由同样是不可再生：cardHash 本身已经把 derivationVersion
   签进去了，再挂一层 SHAPE，哪天结构一升级，老 NFT 的 tokenURI 指的图就集体 404。 */
function storeGet(cardHash) {
  const h = String(cardHash || '').toLowerCase();
  if (!HASH_RE.test(h)) return null;
  const f = underDir(STORE_DIR, 'card-' + h + '.json');
  if (!f || !fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) {
    /* 存档坏了不能把整个端点带崩：/api/token 会因此 500，市场连这枚 NFT 的
       名字都读不出来。当成「读不出来」处理 —— buildMetadata 有专门的一档
       （source='unknown'：不给图、明说这枚章复算不出），那正是诚实的答案。
       但一定要吼一声：存档不可再生，坏一个就是永久丢一份参数。 */
    console.error('[store] 存档文件坏了，当成读不出来处理：' + f + '  ' + e.message);
    return null;
  }
}
function storePut(cardHash, card) {
  const h = String(cardHash || '').toLowerCase();
  if (!HASH_RE.test(h)) throw new Error('bad cardHash');
  const f = underDir(STORE_DIR, 'card-' + h + '.json');
  if (!f) throw new Error('bad cardHash');
  writeAtomic(f, JSON.stringify(card));
  return card;
}

/* ---------------------------------------------------------------- 推广留痕
   两份数据，都只是留痕，发钱是 owner 拿着它人工核对后用 BangPromo.grant 手动发：
     .store/ref-bindings.json   绑定表 minter → {ref, at}。**首触定终身**：
                                一个 minter 只绑一次，之后再带别的 ref 一律不改。
     .store/referrals.jsonl     追加式流水，一行一个 JSON：{ref, ref2?, minter, hash, at}。
                                ref2 = ref 自己的邀请人（二级，只往上找一层，不递归——
                                A↔M 互绑成环时 ref2 会等于 minter 本人，这种直接不记）。
   三条铁律（与 /bang 的关系）：
     1. ref 非法/缺失/自邀 → 静默忽略，绝不因此拒签或改变响应；
     2. 全部写盘动作都在签名响应发出**之后**，写失败只进日志；
     3. ref 不进签名摘要、不上链。 */
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
/** v2 签名要绑铸造人。非法/缺省当场 400 并回人话；v1 忽略。
    返回小写地址或 null（v1）。返回 false 表示已经答过 400。 */
/* ---------------------------------------------------------------- 免费额度（ARCBANG，2026-09-18 重做）
   **IP 闸已经删掉了**（原来是「同一 IP 每天最多领 N 个免费签名」）。
   2026-09-18 第一次主网部署上线 20 分钟，一个 IP 用 5 个新地址一分钟一枚薅走 5 枚：
   IP 是最便宜的东西，那道闸拦不住任何认真的人，留着只会给人一种「有防线」的错觉。

   现在的防线是两件事（见 server/allowlist.js 顶部）：
     · 合约的 bangSigned 收一个 bool free 并签进摘要 —— 免费与否**服务端说了算**，
       换个干净的新地址再也变不出免费额度；
     · 白名单 + 四段放号（warmup / gtd / fcfs / public）决定给谁签 free。

   下面这个 wouldBeFreeMint 留着，但职责变了：它不再是「要不要扣 IP 额度」的判据，
   而是「链上此刻还给不给这个地址免费」——服务端在签 free=true 之前先问一句，
   免得签出一张必然 revert 的名（合约那边 freeCap / freePerAddr 是硬边界）。 */
const FREE_SEL = { totalSupply: '0x18160ddd', freeCap: '0x69b126ef', freePerAddr: '0x21daa6e7', freeMintCount: '0x5ecf8a80' };
/* 返回 true / false / null（null = 链上读不到，判不了）。
   freeCap / freePerAddr 是只能往下调的常量，缓存 10 分钟；totalSupply 缓存 20 秒；
   freeMintCount 只在「本进程已经给这个地址签过免费」时记住（签过就当已用）。
   这样每次签名最多 1 次 eth_call —— 上线当晚公共 RPC 限流（HTTP 429）时，原来 4 次并发调用
   一起失败、闸「判不了就放行」，被一个 IP 用 5 个地址一分钟一枚地薅走了免费额度。 */
const FREE_CACHE = { cap: null, per: null, capAt: 0, sup: null, supAt: 0 };
async function wouldBeFreeMint(minter) {
  const to = CONTRACT;
  if (!to || !/^0x[0-9a-f]{40}$/.test(to)) return false;
  const word = (hex) => { const h = String(hex || '').replace(/^0x/, ''); return h.length >= 64 ? BigInt('0x' + h.slice(0, 64)) : null; };
  const rd = (data) => chainMod.ethCall(to, data).then(word, () => null);
  const now = Date.now();
  const m = String(minter).toLowerCase();
  /* 2026-09-18 删掉了这里原来那句「本进程已给它签过免费，再来就按付费走」。
     在 IP 闸那一版它只影响扣不扣额度，无伤大雅；现在这个返回值**直接决定签 free 还是 paid**，
     于是「取了签名没上链、回头再点一次」的人会被改判成付费 —— 而他的免费额度明明还在。
     每次现读 freeMintCount 是一次 eth_call，值这个钱：
     就算同一秒签出两张 free，合约那边 freePerAddr 也只认第一笔。 */
  if (FREE_CACHE.cap === null || now - FREE_CACHE.capAt > 600e3) {
    const [cap, per] = await Promise.all([rd(FREE_SEL.freeCap), rd(FREE_SEL.freePerAddr)]);
    if (cap !== null && per !== null) { FREE_CACHE.cap = cap; FREE_CACHE.per = per; FREE_CACHE.capAt = now; }
  }
  if (FREE_CACHE.sup === null || now - FREE_CACHE.supAt > 20e3) {
    const sup = await rd(FREE_SEL.totalSupply);
    if (sup !== null) { FREE_CACHE.sup = sup; FREE_CACHE.supAt = now; }
  }
  if (FREE_CACHE.cap === null || FREE_CACHE.sup === null) return null;
  if (!(FREE_CACHE.sup < FREE_CACHE.cap)) return false;         // 免费期已过：付费，不限
  if (FREE_CACHE.per === 0n) return false;
  const cnt = await rd(FREE_SEL.freeMintCount + m.replace(/^0x/, '').padStart(64, '0'));
  if (cnt === null) return null;
  return cnt < FREE_CACHE.per;
}

/** 链上还剩几枚免费额度（freeCap - totalSupply，发完是 0）。读不到回 null。
    /api/allowlist/status 拿它显示「免费还剩 X 枚」；用的是 wouldBeFreeMint 同一份缓存，
    所以看状态这件事不会额外打 RPC。 */
async function freeLeftOnChain() {
  const to = CONTRACT;
  if (!to || !/^0x[0-9a-f]{40}$/.test(to)) return null;
  const word = (hex) => { const h = String(hex || '').replace(/^0x/, ''); return h.length >= 64 ? BigInt('0x' + h.slice(0, 64)) : null; };
  const rd = (data) => chainMod.ethCall(to, data).then(word, () => null);
  const now = Date.now();
  if (FREE_CACHE.cap === null || now - FREE_CACHE.capAt > 600e3) {
    const [cap, per] = await Promise.all([rd(FREE_SEL.freeCap), rd(FREE_SEL.freePerAddr)]);
    if (cap !== null && per !== null) { FREE_CACHE.cap = cap; FREE_CACHE.per = per; FREE_CACHE.capAt = now; }
  }
  if (FREE_CACHE.sup === null || now - FREE_CACHE.supAt > 20e3) {
    const sup = await rd(FREE_SEL.totalSupply);
    if (sup !== null) { FREE_CACHE.sup = sup; FREE_CACHE.supAt = now; }
  }
  if (FREE_CACHE.cap === null || FREE_CACHE.sup === null) return null;
  return FREE_CACHE.sup >= FREE_CACHE.cap ? 0 : Number(FREE_CACHE.cap - FREE_CACHE.sup);
}

function minterForSig(body, res) {
  const r = minterFromBody(body);
  if (!r.ok) {
    json(res, 400, { error: r.error });
    return false;
  }
  return r.minter;
}

function send(res, code, body, headers) {
  const h = Object.assign({ 'access-control-allow-origin': '*' }, res.__rl || {}, headers || {});
  res.writeHead(code, h);
  res.end(body);
}
function json(res, code, obj, headers) {
  send(res, code, JSON.stringify(obj), Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {}));
}

/* ---------------------------------------------------------------- 管理员 IP 门
   /api/admin-check、/deploy-gate、/api/referrals 共用。ARCBANG_ADMIN_IPS：逗号分隔
   的白名单；**没配就一律不是管理员**。真正的链上权限（owner / 受益人）不在这，
   但这扇门一旦被伪造头骗开，访客就能拿到 deploy.html 和全站邀请汇总。

   IP 口径与限流**同一份** RL.ipOf：只信 nginx 覆盖过的 X-Real-IP，或 XFF 最后一跳。
   原来优先信 cf-connecting-ip 和 XFF 第一段 —— nginx 不会覆盖前者，后者是客户端
   自己写的；知道白名单里任何一个 IP 就能把自己头成管理员。
   本机 nginx 已经用 real_ip_header CF-Connecting-IP 把 $remote_addr 设成真实访客，
   所以 X-Real-IP / XFF 末跳就是那一个地址，不必再去信可伪造的那两头。 */
function clientIpOf(req) { return RL.ipOf(req); }

/* ---------------------------------------------------------------- 管理员口令
   审核页（/admin.html）用它，不走 IP 白名单 —— 审核是坐在任意网络下做的事。
   **没配 ARCBANG_ADMIN_TOKEN 时整套后台接口回 404**，不是 401：
   没开的功能就该不存在，401 等于告诉人「这儿有个后台，只是你进不去」。
   比对走 timingSafeEqual：== 在第一个不同的字节上就返回，够耐心的人能一位一位试出来。
   两边先各哈希一遍再比 —— timingSafeEqual 长度不等会直接抛，而长度本身也是一位信息。 */
const nodeCrypto = require('crypto');
function adminTokenConfigured() {
  /* 两条路任配一条，后台就算开着：口令，或者管理员钱包地址。
     **一条都没配时所有后台接口回 404** —— 功能没开就该不存在。 */
  return String(process.env.ARCBANG_ADMIN_TOKEN || '').length >= 8 || adminWalletConfigured();
}
function adminTokenOk(req) {
  const got = String((req.headers && req.headers['x-admin-token']) || '');
  if (!got) return false;
  /* 钱包登录签发的那一枚也走这条通道：后台每个接口只判这一处，不给自己留第二道门。 */
  if (adminSessionOk(got)) return true;
  const want = String(process.env.ARCBANG_ADMIN_TOKEN || '');
  if (want.length < 8) return false;
  const h = (s) => nodeCrypto.createHash('sha256').update(s, 'utf8').digest();
  try { return nodeCrypto.timingSafeEqual(h(got), h(want)); } catch (e) { return false; }
}
/* ---------------------------------------------------------------- 钱包登录后台
   口令之外的第二条路：用**管理员钱包签一句话**进后台。
   口令留着 —— 手机上没钱包扩展的时候还得靠它。

   为什么不直接「签一句固定的话」：那条签名一旦泄露就是永久钥匙。
   所以走 nonce：服务端发一次性随机串，5 分钟内有效，用掉即焚。

   签发的令牌走**和口令同一条校验通道**（X-Admin-Token 头），
   后台每个接口的判断只有 adminTokenOk 一处，不给自己留第二道门。 */
const ADMIN_NONCES = new Map();          // nonce → 发出的时间
const ADMIN_SESSIONS = new Map();        // token → { addr, exp }
const ADMIN_NONCE_MS = 5 * 60 * 1000;
const ADMIN_SESSION_MS = 24 * 3600 * 1000;

/** env 里配的管理员地址（逗号分隔，小写比较）。没配就等于这条路没开。 */
function adminAddrs() {
  return String(process.env.ARCBANG_ADMIN_ADDRS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^0x[0-9a-f]{40}$/.test(x));
}
function adminWalletConfigured() { return adminAddrs().length > 0; }
function sweepAdmin(now) {
  const t = now || Date.now();
  for (const [k, at] of ADMIN_NONCES) if (t - at > ADMIN_NONCE_MS) ADMIN_NONCES.delete(k);
  for (const [k, v] of ADMIN_SESSIONS) if (t > v.exp) ADMIN_SESSIONS.delete(k);
  /* 两张表都只活几小时，但别赌没人狂刷：超了就从最旧的开始扔。 */
  while (ADMIN_NONCES.size > 500) ADMIN_NONCES.delete(ADMIN_NONCES.keys().next().value);
  while (ADMIN_SESSIONS.size > 200) ADMIN_SESSIONS.delete(ADMIN_SESSIONS.keys().next().value);
}
/** 要签的那句话。**域名和时间戳都写进去** —— 别的站拿不去复用，人也看得懂自己在签什么。 */
function adminLoginMessage(nonce, host) {
  return 'ARCBANG admin sign-in\n'
    + 'domain: ' + (host || 'arcbang.xyz') + '\n'
    + 'nonce: ' + nonce + '\n'
    + 'issued: ' + new Date().toISOString().slice(0, 19) + 'Z';
}
/** 钱包签发的令牌在不在有效期内。 */
function adminSessionOk(token) {
  sweepAdmin();
  const v = ADMIN_SESSIONS.get(String(token || ''));
  return !!(v && Date.now() <= v.exp);
}
/** 「是谁动的」。钱包登录的记地址缩写，口令那条路只记 'token' ——
   口令是共用的，写一个具体的人名进日志反而是编的。 */
function adminWho(req) {
  const got = String((req && req.headers && req.headers['x-admin-token']) || '');
  const v = ADMIN_SESSIONS.get(got);
  if (v && Date.now() <= v.exp && v.addr) return v.addr.slice(0, 6) + '…' + v.addr.slice(-4);
  return 'token';
}

function adminAllowed(ip) {
  const allow = String(process.env.ARCBANG_ADMIN_IPS || '')
    .split(',').map(s => s.trim().replace(/^::ffff:/i, '')).filter(Boolean);
  return !!ip && ip !== 'unknown' && allow.indexOf(ip) >= 0;
}

/**
 * 读请求体。体过大要报 413，不能变成 500 ——
 * "服务端出错" 会让人去翻服务端日志找一个根本不存在的故障，而错在请求。
 * @returns {Promise<string|null>} null = 已经把错误答复发出去了，调用方直接 return
 */
async function bodyOf(req, res) {
  if (req.__body !== undefined) return req.__body;
  try { req.__body = await readBody(req); }
  catch (e) {
    json(res, 413, { error: '请求体过大（上限 4 KB）' });
    req.__body = null;                 // 空体是 ''，null 只可能是这里设的
  }
  return req.__body;
}

/**
 * 把请求体解析成普通对象。4 KB 上限挡体积，这里挡结构：
 *   · 不是对象（数组 / 数字 / null）—— 所有 POST 都要 {…}
 *   · 带 __proto__ / constructor / prototype 自有键 —— 原型污染
 *   · 嵌套过深或键太多 —— JSON 炸弹
 * 一律当「不是 JSON」400，不把解析器的 RangeError 变成 500。
 */
function parseJsonObject(str) {
  let v;
  try { v = JSON.parse(str); }
  catch (e) { return { error: '请求体不是 JSON' }; }
  if (v == null || typeof v !== 'object' || Array.isArray(v)) {
    return { error: '请求体不是 JSON' };
  }
  if (jsonUnsafe(v, 0)) return { error: '请求体不是 JSON' };
  return { value: v };
}
function jsonUnsafe(o, depth) {
  if (depth > 20) return true;
  if (o == null || typeof o !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(o, '__proto__')
    || Object.prototype.hasOwnProperty.call(o, 'constructor')
    || Object.prototype.hasOwnProperty.call(o, 'prototype')) return true;
  if (Array.isArray(o)) {
    if (o.length > 256) return true;
    for (let i = 0; i < o.length; i++) if (jsonUnsafe(o[i], depth + 1)) return true;
    return false;
  }
  const keys = Object.keys(o);
  if (keys.length > 128) return true;
  for (let i = 0; i < keys.length; i++) if (jsonUnsafe(o[keys[i]], depth + 1)) return true;
  return false;
}

/**
 * 扣一次额度。拦下时直接把 429 答出去并返回 true，调用方收手。
 *
 * **只在真要算一个宇宙时调用，而且必须知道是哪个宇宙。**
 * 额度按不同哈希计，拿不到哈希就无从计起 —— 硬扣的话，一个发坏请求的客户端
 * 能把用户当天的额度耗光（实测：连发 3 个非 JSON 的 /bang，第 4 个正经请求就 429 了）。
 */
function gate(req, res, hash) {
  const r = RL.check(req, hash);
  if (!r.ok) {
    json(res, 429, {
      error: r.scope === 'global'
        ? '服务器正忙（这一分钟算的宇宙太多了），十几秒后再点'
        : r.scope === 'address'
          ? '点得太快了：每分钟最多算 ' + RL.ADDR_PER_DAY + ' 个新区块，歇几秒再来'
          : '点得太快了：每分钟最多算 ' + RL.ANON_PER_HOUR + ' 个新区块，歇几秒再来（连上钱包签一次名可以放宽到 ' + RL.ADDR_PER_DAY + ' 个）',
      scope: r.scope,
      resetAt: Math.ceil(r.resetAt / 1000)
    }, RL.headers(r));
    return true;
  }
  res.__rl = RL.headers(r);            // 放行时也把剩余额度告诉客户端
  return false;
}

/**
 * 拿到 card（带缓存）。不做链上校验 —— 校验是 /api/bang 的事。
 *
 * **blockNumber 不进缓存键，必须每次按调用方给的值重设。**
 * 它是「这个哈希来自哪个高度」的元数据，不参与派生，也不进 cardHash
 * （指纹只有 [hash, uInt, uG, uF1, uF2, outcome, rarity, version]）——
 * 所以同一个哈希的缓存是可以共用的，唯独这个字段因调用方而异：
 *   /api/card/<hash>、出图、干预   传 null（它们不需要知道高度）
 *   /api/bang                      传真实高度（要签进摘要）
 *
 * 踩过一次：页面先浏览（把 blockNumber=null 的那份存进了缓存），再点铸造，
 * /bang 缓存命中拿回 null，前端 encUint(null) 直接抛
 * "Cannot convert null to a BigInt"。而签名是按**真实高度**签的 ——
 * 就算前端把 null 当 0 传上去，合约算出的摘要也对不上，结果是 BadSig，
 * 链上报错完全看不出根因。
 */
function cardKey(hash) {
  return 'card-' + hash.toLowerCase() + '-v' + DERIVATION_VERSION + '-s' + SHAPE + '.json';
}
/** 这个哈希的 card 是不是已经算过了。限流要用：算一个**没算过的**宇宙才是要挡的动作 */
function cardCached(hash) {
  const f = underDir(CACHE_DIR, cardKey(hash));
  return !!(f && fs.existsSync(f));
}
function cardFor(hash, blockNumber) {
  const key = cardKey(hash);
  const hit = cacheGet(key);
  let built = null;
  if (hit) {
    try { built = JSON.parse(hit); }
    catch (e) {
      /* 缓存**按定义可再生**（card 是 blockHash 的纯函数），坏了就重算，
         没有任何理由把 500 甩给用户。存档不一样，见 storeGet。 */
      console.error('[cache] 缓存文件坏了，重算：' + key + '  ' + e.message);
      built = null;
    }
  }
  if (!built) {
    /* **存进缓存的必须是规范形态：blockNumber 一律 null。**
       它不参与派生、不进 cardHash，是「谁在问」带来的元数据 —— 把调用方那次的值
       烤进缓存文件，同一个 URL 就会因为**谁先来**而产生两种字节：
       先 /bang（带真实高度）再出图，SVG 上有 "UNIVERSE #125988327"；
       反过来先出图，那一行就永远没有。而这张图是带着 immutable 发给市场和钱包的，
       等于掷一次骰子决定这枚 NFT 的图长什么样。
       这和「blockNumber 没进缓存键」是同一个毛病的两面：**缓存的内容不许依赖
       没进键的入参**。键里加不了它（出图那条路根本不知道高度），那就把它从内容里拿掉。 */
    built = buildCard(hash, null);
    cachePut(key, JSON.stringify(built));
  }
  // 调用方知道高度就以它为准；不知道（null）就保持规范形态里的 null
  if (blockNumber !== null && blockNumber !== undefined && built.card) {
    built.card.blockNumber = Number(blockNumber);
  }
  return built;
}

/* 同一个哈希正在算的那一份。**并发合并**：40 个人同时点同一个新区块，
   只算一次，其余 39 个等这一份。不合并的话它们会各自占一个 worker 算出
   一模一样的结果，再各自往同一个文件上盖一次 rename —— 纯粹的浪费。
   键用 cardKey（带版本 + shape），值是那份 JSON 字符串的 promise。 */
const cardInflight = new Map();

/**
 * cardFor 的异步版：缓存命中的路径**一个字节都没变**（命中就不进池，
 * 同步读盘、同步 parse、同步返回），只有未命中才把「派生 + 引擎 + 拼 card」
 * 这段纯计算丢进 worker 线程池，算完照旧落盘。
 *
 * 线程池关掉（ARCBANG_CARD_WORKERS=0）或自保退回时，buildCardJSON 就在主线程
 * 同步算完再交出一个 resolved promise —— 行为与 cardFor 逐字节相同。
 *
 * 为什么不干脆把 cardFor 也改成异步：marketindex.js 那条注入（MI.setCardSource）
 * 和出图那几条路都在同步调它，全改一遍的风险远大于收益 ——
 * 吃掉 CPU 的是 /api/card 与 /api/bang 这两条前台路。
 */
async function cardForAsync(hash, blockNumber) {
  const key = cardKey(hash);
  const hit = cacheGet(key);
  if (hit) {
    try {
      const built = JSON.parse(hit);
      if (blockNumber !== null && blockNumber !== undefined && built.card) {
        built.card.blockNumber = Number(blockNumber);
      }
      return built;
    } catch (e) {
      console.error('[cache] 缓存文件坏了，重算：' + key + '  ' + e.message);
    }
  }
  let p = cardInflight.get(key);
  if (!p) {
    p = CARDPOOL.buildCardJSON(hash, null)
      .then((jsonStr) => {
        /* 落盘的是 worker 里 JSON.stringify 出来的那串字节本身，
           与同步路径 cachePut(key, JSON.stringify(built)) 产出的完全一致。
           存的仍然是规范形态（blockNumber = null），理由见 cardFor 上面那段。 */
        cachePut(key, jsonStr);
        return jsonStr;
      })
      .finally(() => { cardInflight.delete(key); });
    cardInflight.set(key, p);
  }
  const jsonStr = await p;
  /* 每个等待者各自 parse 一份**自己的**对象：下面那行 blockNumber 是就地改的，
     共用同一个对象的话，/bang（真实高度）会把出图那条路（null）的值一起改掉。 */
  const built = JSON.parse(jsonStr);
  if (blockNumber !== null && blockNumber !== undefined && built.card) {
    built.card.blockNumber = Number(blockNumber);
  }
  return built;
}

/** 线程池排不下 / 算超时：这是「现在算不过来」，不是请求写错了，统一 503。
    其余错误照旧往上抛，由 handle 的 catch 报 500。 */
function cardPoolBusy(res, e) {
  if (e && (e.code === 'POOL_BUSY' || e.code === 'CARD_TIMEOUT' || e.code === 'CARD_WORKER_DOWN')) {
    json(res, 503, { error: e.message }, { 'cache-control': 'no-store' });
    return true;
  }
  return false;
}

/* 市场索引要往 meta 里补物理字段（维度、卡面上那几个常数），得有一条拿 card 的路。
ard.js，不要走 HTTP
   自己打自己** —— 自己打自己会白白吃一遍限流、序列化、TCP 往返，而且
   /api/card 的限流本来就是拿来挡「挨个哈希扫全链」的，索引补元数据正好长得像它。

   注进去的是这三条：
     cardFor     blockHash → card（带 .cache 磁盘缓存，热的约 1 ms，冷的约 14 ms）
     storeGet    cardHash  → 存档里的 card（**造物与被干预过的原生卡只有这一条路**）
     cardCached  这个哈希算过没有 —— 索引拿它决定要不要占「冷算预算」

   反过来让 marketindex.js 去 require('./index.js') 是不行的：index.js 在模块顶上
   就 require 了它，那是个循环依赖，拿到的会是一份还没填完的 exports。 */
MI.setCardSource({ cardFor, storeGet, cardCached });
/* 上线预约（server/subscribe.js）：tool 站等「即将开放」页留邮箱。 */
const SUB = require('./subscribe.js').create({ storeDir: STORE_DIR, take: RL.take });
/* 卡死报告（server/stall.js）：前端看门狗抓到的现场，用户点一下发过来。
   配了 ARCBANG_RESEND_KEY 才发邮件；没配就只落盘，启动日志里说一声。 */
const STALL = require('./stall.js').create({ storeDir: STORE_DIR, take: RL.take });
/* 白名单与四段放号（server/allowlist.js）：/api/bang 到底签不签、签的是不是免费，
   全由它决定。freeLeft 读的是 wouldBeFreeMint 那份缓存，看状态不额外打 RPC。 */
const AL = require('./allowlist.js').create({ storeDir: STORE_DIR, take: RL.take, freeLeft: freeLeftOnChain });
/* 用 X 登录（OAuth 1.0a）。凭证不走 env，存在 .store/xauth.json，由管理员在审核页粘贴。
   没配的话 /api/x/* 一律 404，预热页退回手填 X 名的老路。 */
const XA = require('./xauth.js').create({ storeDir: STORE_DIR });
/* X 任务自动核（server/xverify.js）：每 10 分钟拉一次关注 / 点赞 / 转发名单，
   自动打勾也自动掉勾。**要花钱**（Owned Reads $0.001 一条），所以没配
   Bearer / Access Token 时它整个不动，三连退回原来的信任模式。 */
const XV = require('./xverify.js').create({ storeDir: STORE_DIR, xauth: XA, allowlist: AL });
/* 回接：名单那边要知道「自动核开没开、上一轮什么时候拉的」——
   开着的时候「我关注了」不再直接算数，只把那一项推进「审核中」，等 API 去查。
   **后接而不是构造时传**：XV 依赖 AL，AL 再依赖 XV 就成环了。 */
AL.setApiProbe(() => XV.info());
/* X 账号的公开档案（注册日期 / 粉丝数）：后台那两列和 CSV 都从这儿取。
   同样是后接 —— 构造时传会成环。 */
AL.setXUsersProbe(() => XV.users());
XV.start();
/* 自动核推文的重试队列：每分钟推一次（取不到推文的那些 1/5/30 分钟后再试）。unref 让它不挡进程退出。 */
if (typeof AL.runProofQueue === 'function') {
  const t = setInterval(() => { AL.runProofQueue(Date.now()).catch((e) => console.error('[allowlist] 重试队列：' + (e && e.message))); }, 60 * 1000);
  if (t.unref) t.unref();
}

/* ---------------------------------------------------------------- 路由 */

async function handle(req, res, u) {
  const p = u.pathname.replace(/^\/api/, '');

  /* ---- 额度验证：签一次名换 24 小时令牌，不花 gas ---- */
  if (p === '/limit/challenge' && req.method === 'POST') {
    const cb = await bodyOf(req, res);
    if (cb === null) return;
    const parsed = parseJsonObject(cb);
    if (parsed.error) return json(res, 400, { error: parsed.error });
    try { return json(res, 200, RL.challenge(parsed.value.address, req), { 'cache-control': 'no-store' }); }
    catch (e) { return json(res, e.status === 429 ? 429 : 400, { error: e.message }); }
  }
  if (p === '/limit/redeem' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsed = parseJsonObject(rb);
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const b = parsed.value;
    try { return json(res, 200, RL.redeem(b.nonce, b.signature), { 'cache-control': 'no-store' }); }
    catch (e) { return json(res, /太频繁/.test(e.message) ? 429 : 400, { error: e.message }); }
  }

  /* ---- 限流 ----
     只卡「算宇宙」这两条：免费引爆本身就是扫描接口，用户不需要拿到推导算法，
     挨个哈希点引爆、只 mint 好的即可。
     /health 和出图不卡：前者要给监控用，后者是纯静态且有强缓存。

     额度按**不同的哈希**计，所以要先把哈希拿出来再判：
     /card/<hash> 在路径里，/bang 在请求体里 —— 后者必须先读 body。
     body 只能读一次（流读完就没了），读到的挂在 req.__body 上给下面复用。

     为什么非要这样：铸造前必须再取一次签名（签名带 600 秒 deadline，
     引爆时那份早过期了）。如果那一次也扣额度，就会出现**人已经决定收下
     这个宇宙、却因为之前看得多而铸不了**。闸该拦扫描，不该拦成交。 */
  /* /intervene 也在闸内 —— 它**曾经完全没限流**，而 preview:true 那条路
     只要一个 blockHash 就把整张 card（结局、稀有度、维度、全部参数）白送出来，
     不签名、不上链、不花钱。那正是这道闸要挡的动作：挨个哈希扫、只挑 S 档下手。
     实测：额度设成 3/小时时，8 个不同哈希的预览 8 次全是 200。
     沙盒不受影响 —— 它反复推的是**同一个** blockHash，第二次起就是 repeat，不再扣。 */
  if (p === '/bang' || p === '/intervene' || /^\/card\//.test(p)) {
    let rlHash = null;
    const cm = p.match(/^\/card\/(0x[0-9a-fA-F]{64})$/);
    if (cm) rlHash = cm[1].toLowerCase();
    else if (req.method === 'POST') {
      // 体只能读一次（流读完就没了），读到的挂在 req.__body 上给下面复用
      const b = await bodyOf(req, res);
      if (b === null) return;                 // 体过大，413 已经答出去了
      const parsed = parseJsonObject(b);
      if (parsed.value) {
        const h = parsed.value.blockHash;
        if (typeof h === 'string' && HASH_RE.test(h)) rlHash = h.toLowerCase();
      }
    }
    // 拿不到哈希就不扣：这条路一个宇宙都算不出来，扣了只是在罚发坏请求的人
    if (rlHash && gate(req, res, rlHash)) return;
  }

  if (p === '/health') {
    return json(res, 200, {
      ok: true, chainId: CHAIN_ID, chainName: CHAIN_NAME, contract: CONTRACT, signer: signer.address,
      /* RPC 真正连着的链。与 chainId 对不上 = 签名绑错链，每一笔铸造都会 BadSig。
         null 表示启动自检时 RPC 不通，没问到 —— 不是「对不上」。 */
      rpcChainId: liveChainId(), chainMismatch: liveChainId() != null && liveChainId() !== CHAIN_ID,
      derivationVersion: DERIVATION_VERSION, cardShape: SHAPE, sigTtlSec: TTL_SEC,
      /* 分享图能不能真出：false = @resvg/resvg-js 没装上，.png 一律发通用预览图。
         这条必须报出来 —— 否则线上悄悄退成通用图，只有等谁发了条链接才发现。 */
      pngRasterizer: PNG.available(),
      /* 启动时对每个 RPC 探过 eth_getLogs（小跨度）。null = 还没探或没启动过自检。
         false = 没有任何节点肯答日志查询，索引会一直 stale。 */
      logRpcOk: liveLogRpcOk(),
      /* 算卡线程池：0 = 关掉了（或崩太多次自保退回同步）。线上排查「为什么只用一个核」
         先看这个数，不用去猜环境变量。 */
      cardWorkers: CARDPOOL.size(),
      /* 放号阶段与名单人数（server/allowlist.js）。状态页按它显示「现在开到哪一段」、
         两档人数与榜前 10。名单由积分榜算，frozen=false 时它是**实时的**。 */
      phase: AL.phase(), phaseOpens: AL.opens(), phaseNext: AL.nextOpen(),
      /* **不承诺名额**：定格之前 publicCounts 里的数字全是 null（见 allowlist.js）。
         /health 是公开接口，不能从这里把 ARCBANG_GTD_TOP 漏出去。 */
      allowlist: AL.publicCounts(), allowlistApplied: AL.appliedCount(),
      allowlistBoardSize: AL.board().rows.length,
      allowlistPts: AL.pointsTable(), allowlistTop: AL.topRows(10)
    });
  }

  /* GET /api/admin-check —— deploy.html 加载时问一声"我是谁"，
     决定给完整向导还是访客状态卡。判定逻辑见上面 clientIpOf / adminAllowed。 */
  if (p === '/admin-check') {
    const ip = clientIpOf(req);
    return json(res, 200, { admin: adminAllowed(ip), ip },
      { 'cache-control': 'no-store' });
  }

  /* GET /deploy-gate —— 部署页本体从这里发。nginx 把 location = /deploy.html
     反代到这条路由（配置不在本仓库），于是：
       白名单命中 → 200，正文就是 ARCBANG_WEBROOT/deploy.html 的内容；
       未命中     → 200，正文换成公开的系统状态页（status.html）——
                    访客照旧拿不到向导 HTML 的一个字节，但也不再被 302 弹回首页，
                    同一个 URL 两副面孔：管理员见操作台，访客见舷窗。
                    status.html 读不到（部署顺序上它可能还没落盘）才退回 302 /。
     页面里的 admin-check 双视图仍保留：nginx/网关失手把 deploy.html 当静态文件
     放出去时，页面自己还会把操作台藏起来（第二道保险）。
     所有分支都 no-store：这条路的答案跟着请求方 IP 走，缓存哪个都是错的。 */
  if (p === '/deploy-gate') {
    if (!adminAllowed(clientIpOf(req))) {
      const pub = path.join(process.env.ARCBANG_WEBROOT || '/var/www/bnbbang', 'status.html');
      try {
        const html = await fs.promises.readFile(pub, 'utf8');
        return send(res, 200, html, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'
        });
      } catch (e) {
        return send(res, 302, '', { location: '/', 'cache-control': 'no-store' });
      }
    }
    const file = path.join(process.env.ARCBANG_WEBROOT || '/var/www/bnbbang', 'deploy.html');
    try {
      /* 80 KB 的单文件，整读比流式省掉"发了一半才炸、500 发不出去"那档故障；
         读失败（WEBROOT 配错、文件没部署）必须是 500 不是进程崩。 */
      const html = await fs.promises.readFile(file, 'utf8');
      return send(res, 200, html, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'
      });
    } catch (e) {
      console.error('[deploy-gate] 部署页读不出来：' + (e && e.message));
      return json(res, 500, { error: '部署页读不出来，核对 ARCBANG_WEBROOT' },
        { 'cache-control': 'no-store' });
    }
  }

  // POST /api/bang {blockHash} —— 唯一会签名的端点
  if (p === '/bang' && req.method === 'POST') {
    // 上面限流那步已经把体读掉了（流只能读一次），这里复用
    const body = await bodyOf(req, res);
    if (body === null) return;                 // 体过大，413 已经答出去了
    const parsedBang = parseJsonObject(body);
    if (parsedBang.error) return json(res, 400, { error: parsedBang.error });
    const hash = parsedBang.value.blockHash;
    const minter = minterForSig(parsedBang.value, res);
    if (minter === false) return;

    if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
      return json(res, 400, { error: '不是 32 字节十六进制哈希' });
    }
    if (/^0x0{64}$/i.test(hash)) {
      return json(res, 400, { error: '零哈希不是区块' });
    }

    /* 放号那一半的判断**排在取块与算卡之前**：它一次链上读都不做，
       而预热期每个点击都白算一张卡的话，预热本身就成了一个免费的算力消耗接口。
       「签不签免费」那一半在下面 —— 那一半要先有 card 才谈得上。 */
    {
      const deny = AL.denyReason(minter);
      if (deny) {
        return json(res, deny.status, {
          error: deny.error, code: deny.code, phase: deny.phase, opens: deny.opens, next: deny.next
        }, { 'cache-control': 'no-store' });
      }
    }

    let blk;
    try {
      blk = await blockByHash(hash);
    } catch (e) {
      // RPC 全挂 ≠ 哈希是假的。这两件事必须分开报，否则一次网络故障
      // 会被用户读成"我的哈希被判定成假的"。
      console.error('[bang] RPC 不通：' + (e && e.message));
      return json(res, 424, { error: '链上节点暂时打不通，请稍后再试' });   // 不用 503：Cloudflare 会换成自己的错误页
    }
    if (!blk) {
      // C3：查不到就拒绝，不回退常量
      return json(res, 400, { error: '这个哈希不是 BNB 链上的区块，不给引爆' });
    }

    /* 算卡进 worker 线程池（server/cardpool.js）：缓存命中不进池，未命中才算。
       池子排满 / 算超时 → 503「服务器正忙」，与限流的 429 分开 ——
       429 是「你点太快」，503 是「我们算不过来」。 */
    let built;
    try { built = await cardForAsync(hash, blk.number); }
    catch (e) { if (cardPoolBusy(res, e)) return; throw e; }
    const { card, cardHash } = built;
    /* 免费与否**在这里定死**，然后签进摘要（合约 bangSigned 的 bool free）。
       合约不再自己按 totalSupply / freeMintCount 猜 —— 猜的那一版等于
       「换个干净的新地址就有一枚免费额度」，2026-09-18 上线 20 分钟就是这么被薅的。
       四段放号与名单判断全在 server/allowlist.js，这里只负责把结论用上。 */
    const g = await AL.gate(minter, () => wouldBeFreeMint(minter));
    if (!g.ok) {
      return json(res, g.status || 403, {
        error: g.error, code: g.code, phase: g.phase, opens: g.opens, next: g.next
      }, { 'cache-control': 'no-store' });   // NOSTORE 在这个函数后面才声明，别踩 TDZ
    }
    const { sig, deadline } = await signer.sign(
      card.blockHash, blk.number, card.outcome.index, card.rarity.index, cardHash,
      undefined, minter, g.free
    );
    json(res, 200, {
      card, cardHash, deadline, sig, signer: signer.address, rarity: card.rarity,
      /* free 必须原样回给前端：它要拿这个值拼 calldata（改一位就 BadSig），
         也要拿它决定 msg.value 是 0 还是 price。 */
      free: g.free, phase: g.phase, freeGone: !!g.freeGone,
      art: PUBLIC_BASE + '/api/art/' + card.blockHash + '.svg?p=1'
    }, { 'cache-control': 'no-store' });
    return;
  }


  /* ================================================================ 用 X 登录
     OAuth 1.0a 三腿（server/xauth.js）。选 1.0a 是因为 access_token 的响应里
     **自带 user_id 与 screen_name** —— 不必再调 users/me，而那一条要读取额度，
     免费档的读取额度是 0。

     没配凭证时这几条一律 404：功能没开就该不存在，预热页据此退回手填 X 名。 */
  if (p.indexOf('/x/') === 0) {
    if (!XA.configured()) return json(res, 404, { error: '还没开通用 X 登录' }, { 'cache-control': 'no-store' });

    if (p === '/x/login' && (req.method === 'GET' || req.method === 'HEAD')) {
      const r = await XA.begin();
      /* 失败也跳回预热页（?xerr=…）而不是回 5xx：Cloudflare 会把源站的 502/503 换成它自己的错误页，
         用户看到的就只剩 "error code: 502"。 */
      if (!r.ok) {
        const back = (process.env.ARCBANG_PUBLIC_BASE || '').replace(/\/+$/, '') + '/quest.html';
        return send(res, 302, '', { location: back + '?xerr=' + encodeURIComponent(r.error || 'failed'), 'cache-control': 'no-store' });
      }
      /* 直接 302 过去。把 URL 回给前端再跳也行，但那样会多一次「点了没反应」的窗口。
         同时下发一次性的 state cookie —— 回调那一步要拿它验，见 server/xauth.js。 */
      return send(res, 302, '', { location: r.url, 'set-cookie': r.cookie, 'cache-control': 'no-store' });
    }

    if (p === '/x/callback' && (req.method === 'GET' || req.method === 'HEAD')) {
      const q = {};
      u.searchParams.forEach((v, k) => { q[k] = v; });
      const r = await XA.finish(q, XA.stateFromReq(req));
      /* 回调是浏览器跟过来的，所以**不回 JSON 回跳转** —— 失败也跳回去，
         把原因塞在 query 里让页面说人话。 */
      const back = (process.env.ARCBANG_PUBLIC_BASE || '').replace(/\/+$/, '') + '/quest.html';
      /* 不管成没成，那个一次性 state cookie 都当场删掉。 */
      const killState = XA.stateCookieHeader(null);
      if (!r.ok) {
        return send(res, 302, '', {
          location: back + '?xerr=' + encodeURIComponent(r.error || 'failed'),
          'set-cookie': killState,
          'cache-control': 'no-store'
        });
      }
      /* 站方官号（ARCBANG_X_HANDLE）登录：把它的 Access Token 对存成 owner token。
         自动核读官号推文的点赞列表只认作者本人的用户上下文（X 的点赞已是私密），
         机器人号的 token 读出来永远是空。存盘走 saveCred，secret 一个字符不进日志。 */
      try {
        const want = String(process.env.ARCBANG_X_HANDLE || 'arcbang_xyz').replace(/^@+/, '').toLowerCase();
        if (r.tokens && r.tokens.token && r.tokens.secret && String(r.session.handle).toLowerCase() === want) {
          const cur = XA.readCred();
          if (cur) {
            XA.saveCred(cur.key, cur.secret, {
              ownerAccessToken: r.tokens.token, ownerAccessSecret: r.tokens.secret,
              ownerHandle: r.session.handle, ownerAt: new Date().toISOString()
            });
            console.log('[xauth] 站方官号 @' + r.session.handle + ' 已授权：自动核改用它的用户上下文读点赞/转发/回复');
          }
        }
      } catch (e) { console.error('[xauth] 存站方 token 失败：' + (e && e.message)); }
      return send(res, 302, '', {
        location: back + '?x=1',
        'set-cookie': [r.cookie, killState],
        'cache-control': 'no-store'
      });
    }

    /* 站方官号授权了没（部署向导第 7 步问它）。只回有没有、用户名、时间，token 一个字符不出。 */
    if (p === '/x/owner' && (req.method === 'GET' || req.method === 'HEAD')) {
      const ci = XA.credInfo();
      return json(res, 200, {
        authorized: !!ci.hasOwnerToken, handle: ci.ownerHandle || null, at: ci.ownerAt || null,
        want: String(process.env.ARCBANG_X_HANDLE || 'arcbang_xyz').replace(/^@+/, ''),
        loginConfigured: !!ci.configured
      }, { 'cache-control': 'no-store' });
    }

    /* 页面问「我登录了吗」。没登录回 200 + {login:false} —— 这不是错误。 */
    if (p === '/x/me' && (req.method === 'GET' || req.method === 'HEAD')) {
      const s = XA.fromReq(req);
      if (!s) return json(res, 200, { login: false }, { 'cache-control': 'no-store' });
      /* 顺手回这个号绑没绑过地址：页面据此**在连钱包之前**就能说清楚
         「这个 X 已经绑了 0x1234…abcd」，不用等到提交才吃一个 409。 */
      const bound = AL.addrOfXid(s.id);
      return json(res, 200, {
        /* 没有 avatar 字段：OAuth 1.0a 的 access_token 只给 user_id 与 screen_name，
           取头像要调 users/me，而免费档的读取额度是 0。页面用 handle 生成首字母头像。 */
        login: true, id: s.id, handle: s.handle,
        bound: bound ? AL.shortAddr(bound) : null
      }, { 'cache-control': 'no-store' });
    }

    if (p === '/x/logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'cache-control': 'no-store', 'set-cookie': XA.cookieHeader(null) });
    }

    return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
  }

  /* 管理员那一侧：贴 consumer key / secret。GET 只回「配没配 + key 前 4 位」，
     secret 一个字符都不回 —— 贴进去之后连管理员自己也读不回来。 */
  if (p === '/admin/xauth') {
    if (!adminTokenConfigured()) return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
    if (!adminTokenOk(req)) return json(res, 401, { error: '口令不对' }, { 'cache-control': 'no-store' });
    if (req.method === 'GET' || req.method === 'HEAD') {
      return json(res, 200, XA.credInfo(), { 'cache-control': 'no-store' });
    }
    if (req.method === 'POST') {
      const rb = await bodyOf(req, res);
      if (rb === null) return;
      const q = parseJsonObject(rb);
      if (q.error) return json(res, 400, { error: q.error }, { 'cache-control': 'no-store' });
      const r = q.value.clear ? XA.clearCred() : XA.saveCred(q.value.key, q.value.secret, {
        bearer: q.value.bearer,
        accessToken: q.value.accessToken,
        accessSecret: q.value.accessSecret
      });
      return json(res, r.ok ? 200 : 400, Object.assign({}, r, XA.credInfo()), { 'cache-control': 'no-store' });
    }
    return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
  }

  /* 钱包登录后台：拿一次性 nonce → 用管理员钱包签 → 换一枚 24 小时的令牌。
     这两条**不校验口令**（它们本来就是拿来换口令的），但 nonce 是一次性的，
     签名必须由 ARCBANG_ADMIN_ADDRS 里的地址签出来。 */
  if (p === '/admin/nonce' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!adminTokenConfigured()) return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
    if (!adminWalletConfigured()) return json(res, 404, { error: '没开钱包登录' }, { 'cache-control': 'no-store' });
    sweepAdmin();
    const nonce = nodeCrypto.randomBytes(16).toString('hex');
    ADMIN_NONCES.set(nonce, Date.now());
    const host = String((req.headers && req.headers.host) || '').split(':')[0] || 'arcbang.xyz';
    return json(res, 200, { nonce, message: adminLoginMessage(nonce, host) }, { 'cache-control': 'no-store' });
  }
  if (p === '/admin/login' && req.method === 'POST') {
    if (!adminTokenConfigured()) return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
    if (!adminWalletConfigured()) return json(res, 404, { error: '没开钱包登录' }, { 'cache-control': 'no-store' });
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const q = parseJsonObject(rb);
    if (q.error) return json(res, 400, { error: q.error }, { 'cache-control': 'no-store' });
    sweepAdmin();
    const nonce = String(q.value.nonce || '');
    const at = ADMIN_NONCES.get(nonce);
    /* **用掉即焚**：无论签名对不对都先删。留着的话，一条被抓包的签名可以重放。 */
    ADMIN_NONCES.delete(nonce);
    if (!at) return json(res, 401, { error: '这次登录已过期，请重新发起' }, { 'cache-control': 'no-store' });
    if (Date.now() - at > ADMIN_NONCE_MS) return json(res, 401, { error: '这次登录已过期，请重新发起' }, { 'cache-control': 'no-store' });
    const host = String((req.headers && req.headers.host) || '').split(':')[0] || 'arcbang.xyz';
    let who = null;
    try { who = verifyMessage(q.value.message || adminLoginMessage(nonce, host), String(q.value.sig || '')); }
    catch (e) { return json(res, 401, { error: '签名验不过' }, { 'cache-control': 'no-store' }); }
    const addr = String(who || '').toLowerCase();
    if (!addr || addr !== String(q.value.address || '').toLowerCase()) {
      return json(res, 401, { error: '签名和地址对不上' }, { 'cache-control': 'no-store' });
    }
    if (adminAddrs().indexOf(addr) < 0) {
      console.warn('[admin] 不在名单里的地址想进后台：' + addr);
      return json(res, 403, { error: '这个地址不在管理员名单里' }, { 'cache-control': 'no-store' });
    }
    const token = nodeCrypto.randomBytes(32).toString('hex');
    ADMIN_SESSIONS.set(token, { addr, exp: Date.now() + ADMIN_SESSION_MS });
    console.log('[admin] 钱包登录：' + addr.slice(0, 6) + '…' + addr.slice(-4));
    return json(res, 200, { ok: true, token, addr, expiresIn: ADMIN_SESSION_MS / 1000 }, { 'cache-control': 'no-store' });
  }

  /* 自动核的状态与账单。POST {run:true} 立刻拉一轮（管理员想马上看结果时用），
     POST {run:true, full:true} 强制翻到底 —— 那一次读得最多，也最花钱。 */
  if (p === '/admin/xverify') {
    if (!adminTokenConfigured()) return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
    if (!adminTokenOk(req)) return json(res, 401, { error: '口令不对' }, { 'cache-control': 'no-store' });
    if (req.method === 'GET' || req.method === 'HEAD') {
      return json(res, 200, XV.info(), { 'cache-control': 'no-store' });
    }
    if (req.method === 'POST') {
      const rb = await bodyOf(req, res);
      if (rb === null) return;
      const q = parseJsonObject(rb);
      if (q.error) return json(res, 400, { error: q.error }, { 'cache-control': 'no-store' });
      const r = await XV.runOnce({ full: !!q.value.full });
      return json(res, r.ok ? 200 : 400, Object.assign({}, r, { info: XV.info() }), { 'cache-control': 'no-store' });
    }
    return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
  }
  /* ================================================================ 积分榜与白名单
     五条路，权限一条比一条高：
       GET  /api/allowlist/board?top=     公开的积分榜。**只给地址缩写** ——
                                          名次和分数是规则的一部分，完整地址不是。
       GET  /api/allowlist/status?addr=   谁都能问。榜与名额是公开规则；
                                          积分明细、登记码、下一步只回**查询的那个地址自己的**。
       POST /api/allowlist/register       登记（上榜 + 拿登记码 + 得登记分）。要钱包签一句固定文案。
       POST /api/allowlist/share          站内分享按钮生成链接时打一发，同地址同一天只计一次。
       GET  /api/allowlist/applied        导出登记表 CSV，**管理员 IP 才给**。

     **名单是榜算出来的**，接口里没有任何一条路能改名次或发名额：
     转发勾要管理员跑 server/tools/allowlist.js verify（X 那边的评论是人工核的），
     进保底期之前跑一次 freeze 把榜定格。 */
  if (p === '/allowlist/board' && (req.method === 'GET' || req.method === 'HEAD')) {
    /* 榜有 30 秒内存缓存（server/allowlist.js 的 BOARD_TTL_MS），响应头也给 30 秒：
       预热页会被很多人同时刷，而榜是 O(登记数) 的全量重算。 */
    return json(res, 200, AL.boardView(u.searchParams.get('top')), { 'cache-control': 'public, max-age=30' });
  }

  if (p === '/allowlist/status' && (req.method === 'GET' || req.method === 'HEAD')) {
    const st = await AL.status(u.searchParams.get('addr'));
    return json(res, 200, st, { 'cache-control': 'no-store' });
  }

  if (p === '/allowlist/register' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedAl = parseJsonObject(rb);
    if (parsedAl.error) return json(res, 400, { error: parsedAl.error }, { 'cache-control': 'no-store' });
    /* 开通了用 X 登录，就**只认登录拿到的那个号**：手填的 xHandle 一律不看，
       没登录直接挡回去。手填那条老路只在没配凭证时还活着（记录里标 xSource:'typed'）。 */
    const xSess = XA.configured() ? XA.fromReq(req) : null;
    if (XA.configured() && !xSess) {
      return json(res, 401, { error: '先用 X 登录，再登记', needX: true }, { 'cache-control': 'no-store' });
    }
    const r = AL.register(parsedAl.value, RL.ipOf(req), xSess);
    return json(res, r.status, r.body, { 'cache-control': 'no-store' });
  }

  /* POST /api/allowlist/share {address, sig, hash}
     sig 是**登记时那一次**签名（同一句 registerMessage），浏览器留在 localStorage 复用 ——
     用户拍板「别每次弹钱包」。重放它最多能给签名者自己记一次分，而同一天只记一次。 */
  if (p === '/allowlist/share' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedSh = parseJsonObject(rb);
    if (parsedSh.error) return json(res, 400, { error: parsedSh.error }, { 'cache-control': 'no-store' });
    const r = AL.share(parsedSh.value, RL.ipOf(req));
    return json(res, r.status, r.body, { 'cache-control': 'no-store' });
  }

  /* 引爆计分那一路专用的读块：**查不到就隔 1.5 秒再试，最多 4 次**。
     为什么只在这里重试：用户刚在模拟器里引爆过这个块，它一定是真的；
     查不到通常是这一刻挑中的那个 RPC 节点还没同步到，而不是哈希是假的。
     不重试的表现是「明明引爆成功了却没加分」，而且看不出原因。
     取块本身带缓存，所以正常那一次根本走不到重试。 */
  async function bangReadBlock(hash) {
    for (let i = 0; i < 4; i++) {
      let blk = null;
      try { blk = await blockByHash(hash); }
      catch (e) {
        /* RPC 抛了：最后一次才把错往上抛（allowlist 会回 503），中间的照样重试。 */
        if (i === 3) throw e;
        blk = null;
      }
      if (blk) return blk;
      if (i < 3) await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }

  /* POST /api/allowlist/bang {address, hash, sig}
     在模拟器里真引爆一次就 +1 分（每日与预热期各有上限，见 server/allowlist.js）。
     **区块哈希回头找链验一次** —— 自己编一个 64 位十六进制串是最省事的刷法。
     blockByHash 命中它自己的缓存时不额外打 RPC，正常引爆刚查过，这一下基本白拿。 */
  if (p === '/allowlist/bang' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedBg = parseJsonObject(rb);
    if (parsedBg.error) return json(res, 400, { error: parsedBg.error }, { 'cache-control': 'no-store' });
    const r = await AL.bang(parsedBg.value, RL.ipOf(req), Date.now(), bangReadBlock);
    /* 没过的那些**在服务端留一行**。用户那边只看到一句「查不到」，
       而排查要的是哪个地址、哪个哈希、第几次 —— 排练站上手打过同样的补丁，
       所以它必须进仓库，不然下次部署又把它盖掉。 */
    if (r.status !== 200) {
      console.log('[bang] ' + r.status + ' ' + ((r.body && r.body.error) || '')
        + ' ' + String((parsedBg.value && parsedBg.value.address) || '?')
        + ' ' + String((parsedBg.value && parsedBg.value.hash) || '?'));
    }
    return json(res, r.status, r.body, { 'cache-control': 'no-store' });
  }

  /* POST /api/allowlist/proof {address, url, sig}
     贴自己那条「回复了登记码」的推文链接。服务端**立刻去取那条推文自动核**
     （作者 / 登记码 / 回复对象三项全对才打勾），取不到就按 1/5/30 分钟排重试。
     同 share：sig 是登记时那一次签名，不再弹钱包。 */
  if (p === '/allowlist/proof' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedPf = parseJsonObject(rb);
    if (parsedPf.error) return json(res, 400, { error: parsedPf.error }, { 'cache-control': 'no-store' });
    const r = await AL.submitProof(parsedPf.value, RL.ipOf(req));
    return json(res, r.status, r.body, { 'cache-control': 'no-store' });
  }

  /* POST /api/allowlist/post {address, url, sig}
     自己发的那条「提到本站 + #ARCBANG」的推。服务端自动核（作者 / 提及 / 标签 / 不是转发），
     过了就按条计分。限每周 2 条、预热期共 4 条。 */
  if (p === '/allowlist/post' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedPo = parseJsonObject(rb);
    if (parsedPo.error) return json(res, 400, { error: parsedPo.error }, { 'cache-control': 'no-store' });
    const r = await AL.submitPost(parsedPo.value, RL.ipOf(req));
    return json(res, r.status, r.body, { 'cache-control': 'no-store' });
  }

  /* POST /api/allowlist/claim {address, sig, task:'follow'|'engage', post?}
     「我做完了」那一下。接了 X API 时它只把这一项推进「审核中」，
     真正的勾等下一轮去 X 上查（见 allowlist.js 的 claim / syncApi）；
     没接 API 时点一下就计分，管理员抽查撤销之后这个地址整个失去信任。
     task='engage' 时 post 是那条官方推文的 id（不给就是置顶推）。 */
  if (p === '/allowlist/claim' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedCl = parseJsonObject(rb);
    if (parsedCl.error) return json(res, 400, { error: parsedCl.error }, { 'cache-control': 'no-store' });
    const r = AL.claim(parsedCl.value);
    return json(res, r.status, r.body, { 'cache-control': 'no-store' });
  }

  /* ================================================================ 管理员审核页的后端
     口令在 ARCBANG_ADMIN_TOKEN，请求带 X-Admin-Token 头，**常量时间比对**。
     **没配 token 时这些路一律 404** —— 不是 401：没开的功能就该不存在，
     401 等于告诉人「这儿有个后台，只是你进不去」。
     原有的 ARCBANG_ADMIN_IPS 门禁照旧管 /deploy-gate 与 /api/allowlist/applied，两者不冲突。 */
  /* 这一段里一律写 { 'cache-control': 'no-store' } 而不是常量 NOSTORE ——
     那个常量声明在这个函数后面，在这里引用会踩 TDZ（ReferenceError），
     而且只在真有人访问后台时才炸。上面 /bang 那一处早就留过同样的注解。 */
  if (p.indexOf('/allowlist/admin') === 0) {
    if (!adminTokenConfigured()) return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
    if (!adminTokenOk(req)) return json(res, 401, { error: '口令不对' }, { 'cache-control': 'no-store' });

    if (p === '/allowlist/admin/list' && (req.method === 'GET' || req.method === 'HEAD')) {
      return json(res, 200, AL.adminList(u.searchParams.get('q'), u.searchParams.get('only')), { 'cache-control': 'no-store' });
    }
    if (p === '/allowlist/admin/verify' && req.method === 'POST') {
      const rb = await bodyOf(req, res);
      if (rb === null) return;
      const q = parseJsonObject(rb);
      if (q.error) return json(res, 400, { error: q.error }, { 'cache-control': 'no-store' });
      const which = {};
      for (const k of ['follow', 'repost', 'like', 'comment']) if (q.value[k]) which[k] = true;
      const r = q.value.on === false
        ? (q.value.distrust ? AL.distrust(q.value.token, which) : AL.unverify(q.value.token, which))
        : AL.verify(q.value.token, which);
      return json(res, r.ok ? 200 : 400, r, { 'cache-control': 'no-store' });
    }
    if (p === '/allowlist/admin/reject' && req.method === 'POST') {
      const rb = await bodyOf(req, res);
      if (rb === null) return;
      const q = parseJsonObject(rb);
      if (q.error) return json(res, 400, { error: q.error }, { 'cache-control': 'no-store' });
      const r = AL.rejectProof(q.value.token, q.value.reason);
      return json(res, r.ok ? 200 : 400, r, { 'cache-control': 'no-store' });
    }
    /* ---- 阶段控制台 ----
       GET  现在哪一段、从哪儿来的（后台落盘 / env）、各段开放时间、榜定没定格、
            名单人数、最近 10 条变更。后台那张「阶段控制」卡整张照它画。
       POST { phase?, gtdOpenAt?, fcfsOpenAt?, publicOpenAt?, warmupStart?, warmupDays? }
            **改完立刻生效，不用重启** —— 服务端下一张铸造签名就按新阶段签。
            不给 phase 就只改时间；给 'auto' 是清掉后台那一份重新跟 env 走。
            切到 gtd 时榜还没定格只回 warning，**不拦** —— 后台按钮不替人做决定，
            但也不能让这件事悄无声息地过去。 */
    if (p === '/allowlist/admin/phase' && (req.method === 'GET' || req.method === 'HEAD')) {
      return json(res, 200, AL.phaseInfo(), { 'cache-control': 'no-store' });
    }
    if (p === '/allowlist/admin/phase' && req.method === 'POST') {
      const rb = await bodyOf(req, res);
      if (rb === null) return;
      const q = parseJsonObject(rb);
      if (q.error) return json(res, 400, { error: q.error }, { 'cache-control': 'no-store' });
      const opt = { by: adminWho(req) };
      /* **只把请求里真出现过的键往下传**：没出现 = 保持原样，出现但是空串 = 清掉。
         全部无脑传下去的话，只改一个公售时间会把另外三个一起抹成 null。 */
      for (const k of ['gtdOpenAt', 'fcfsOpenAt', 'publicOpenAt', 'warmupStart', 'warmupDays']) {
        if (Object.prototype.hasOwnProperty.call(q.value, k)) opt[k] = q.value[k];
      }
      const r = AL.setPhase(Object.prototype.hasOwnProperty.call(q.value, 'phase') ? q.value.phase : null, opt);
      if (!r.ok) return json(res, 400, r, { 'cache-control': 'no-store' });
      return json(res, 200, Object.assign({}, r, { info: AL.phaseInfo() }), { 'cache-control': 'no-store' });
    }
    if (p === '/allowlist/admin/freeze' && req.method === 'POST') {
      const r = AL.freeze();
      console.log('[allowlist] 名单定格（' + adminWho(req) + '）：gtd ' + r.gtd + ' / fcfs ' + r.fcfs);
      return json(res, 200, Object.assign({}, r, { info: AL.phaseInfo() }), { 'cache-control': 'no-store' });
    }
    /* 解除定格：写错了要能重来。名单条目原样留着，只是榜重新开始决定谁在名单里。 */
    if (p === '/allowlist/admin/unfreeze' && req.method === 'POST') {
      const r = AL.unfreeze();
      console.log('[allowlist] 名单解除定格（' + adminWho(req) + '）');
      return json(res, 200, Object.assign({}, r, { info: AL.phaseInfo() }), { 'cache-control': 'no-store' });
    }
    /* 官方推文表（推文互动任务的数据源）。加一条 = 多一个「一键三连」任务；
       置顶推来自 ARCBANG_PINNED_POST_URL，它不在这张表里，删不掉。 */
    if (p === '/allowlist/admin/posts' && (req.method === 'GET' || req.method === 'HEAD')) {
      return json(res, 200, { ok: true, posts: AL.engagePosts(), pts: AL.pointsTable() }, { 'cache-control': 'no-store' });
    }
    if (p === '/allowlist/admin/posts' && req.method === 'POST') {
      const rb = await bodyOf(req, res);
      if (rb === null) return;
      const q = parseJsonObject(rb);
      if (q.error) return json(res, 400, { error: q.error }, { 'cache-control': 'no-store' });
      const r = q.value.remove
        ? AL.engageRemove(q.value.remove)
        : AL.engageAdd(q.value.url, { pts: q.value.pts, note: q.value.note });
      return json(res, r.ok ? 200 : 400, Object.assign({ posts: AL.engagePosts() }, r), { 'cache-control': 'no-store' });
    }
    /* ?top=100 只导前 100 名（管理员页那颗「导出 TOP 100」）。不带就是全量。 */
    if (p === '/allowlist/admin/csv' && (req.method === 'GET' || req.method === 'HEAD')) {
      const topN = Math.max(0, Math.min(100000, Number(u.searchParams.get('top')) || 0));
      return send(res, 200, AL.appliedCsv(topN), {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="arcbang-allowlist'
          + (topN ? '-top' + topN : '') + '.csv"',
        'cache-control': 'no-store'
      });
    }
    return json(res, 404, { error: '没有这个接口' }, NOSTORE);
  }

  if (p === '/allowlist/applied' && (req.method === 'GET' || req.method === 'HEAD')) {
    const ip = clientIpOf(req);
    if (!adminAllowed(ip)) {
      /* 404 而不是 403：这条路对非管理员来说就该不存在。
         403 等于告诉人「这儿有个导出接口，只是你进不去」。 */
      return json(res, 404, { error: '没有这个接口' }, { 'cache-control': 'no-store' });
    }
    return send(res, 200, AL.appliedCsv(), {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="arcbang-allowlist-applied.csv"',
      'cache-control': 'no-store'
    });
  }

  /* POST /api/intervene {blockHash, tokenId, oldCardHash, deltas | ops, preview?, suggest?}
     烧 BANG 把一个死宇宙往"能诞生观察者"那侧推。签的是**另一套**摘要
     （见 intervene.js 的 interveneDigest，字段与合约 intervene() 逐字段对齐）。

     位移有两种写法，二选一（同时给就 400，别猜用户想要哪个）：
       deltas = { 参数名: 新的绝对值 }
       ops    = [{ key, dir, steps }]   ← 相对档位，服务端自己查生存半径算距离

     ops 是为了让浏览器**根本不算这段距离**：一格 = 步长 × 生存半径，
     而半径表是整套推导里唯一藏得住的东西。
     前端自己算就得在站点包里带一份表，等于原样发给每个访客。

     返回里的 ops 是**上链用的位移记录**（0x 开头的 hex，5 字节一条：参数下标 + unit×1e9）。
     前端原样转发给合约 intervene(…, ops, sig)，合约不解析它、只把 keccak256(ops) 签进摘要。
     它存在的理由只有一个：让"推了哪几个参数、各推到哪"进区块 ——
     在这之前那份信息只躺在本机的 .store 里，服务器一没它就永远算不回来了。

     preview:true —— 只算不签名、不落盘，给干预沙盒用（沙盒本来就"不花钱、不上链"）。
     这条路不需要 tokenId：还没铸造的宇宙也能在沙盒里推着玩。
     它回不了 sig，所以拿它上不了链 —— 真要烧币还得走上面那条带 tokenId 的路。
     suggest:true —— 顺带算一条「下一格该推谁」，只在 preview 下给：
     爬山要试着推一格，也得用半径，所以浏览器同样算不了。 */
  if (p === '/intervene' && req.method === 'POST') {
    // 同 /bang：限流那步已经把体读掉了，这里复用同一份
    const body = await bodyOf(req, res);
    if (body === null) return;                 // 体过大，413 已经答出去了
    const parsedIv = parseJsonObject(body);
    if (parsedIv.error) return json(res, 400, { error: parsedIv.error });
    const q = parsedIv.value;

    /* 费用只能服务端算。请求里带了费用就**明着拒绝**，
       不是默默忽略：默默忽略的话，前端作者看到自己算的费用发过去也能通，
       就会以为服务端认这个数，等哪天有人改了那段前端代码，问题才爆出来。 */
    if (q.cost != null || q.costBang != null) {
      return json(res, 400, { error: '费用由服务端算，请求里不许带 cost' });
    }

    let preview = q.preview === true;

    /* ARCBANG（Arc 链）没有拯救系统：沙盒仍要服务端算「推参数之后的宇宙」，但一律按预览走——

       不落盘、不签名、不报价。有人硬带 minter 来也签不到名（2026-09-17 用户拍板删除拯救）。 */

    if (CHAIN_ID === 5042 || CHAIN_ID === 5042002) preview = true;

    const hash = q.blockHash;
    if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
      return json(res, 400, { error: '不是 32 字节十六进制哈希' });
    }

    /* ---- 位移：deltas（绝对值）与 ops（相对档位）二选一 ---- */
    const hasDeltas = q.deltas != null;
    const hasOps = q.ops != null;
    if (hasDeltas && hasOps) {
      return json(res, 400, { error: '绝对值 deltas 与相对档位 ops 只能给一个' });
    }
    if (hasDeltas && (typeof q.deltas !== 'object' || Array.isArray(q.deltas)
      || Object.keys(q.deltas).length > 64)) {
      return json(res, 400, { error: 'deltas 要是 {参数名: 新值} 的对象' });
    }
    if (hasOps && (!Array.isArray(q.ops) || q.ops.length > MAX_OPS)) {
      return json(res, 400, { error: 'ops 要是 [{key, dir, steps}] 的数组，最多 ' + MAX_OPS + ' 条' });
    }
    /* 一格都没推也得放行 —— 但只在预览里：沙盒刚打开时 ops 是空的，
       它照样要问"当前这个状态下一格该推谁"。真干预不许空推（那是白签一次名）。 */
    const empty = (!hasDeltas || !Object.keys(q.deltas).length) && (!hasOps || !q.ops.length);
    if (empty && !preview) {
      return json(res, 400, { error: '要给 deltas 或 ops' });
    }

    /* tokenId 必须原样进摘要。只收数字和数字字符串 —— BigInt(null) 会安安静静给出 0n，
       那就等于替用户挑了 token #0 去签名。预览不签名，所以不要它。 */
    let tokenId = 0n;
    if (!preview) {
      try {
        if (typeof q.tokenId !== 'number' && typeof q.tokenId !== 'string') throw new Error();
        tokenId = BigInt(q.tokenId);
        if (tokenId < 0n || tokenId >= 2n ** 256n) throw new Error();
      } catch (e) {
        return json(res, 400, { error: 'tokenId 不是非负整数' });
      }
    }
    const oldCardHash = q.oldCardHash;
    const hasOld = typeof oldCardHash === 'string' && HASH_RE.test(oldCardHash);
    if (!preview && !hasOld) {
      return json(res, 400, { error: 'oldCardHash 不是 32 字节十六进制' });
    }

    /* 基准 card：oldCardHash 在存档里有，就接着**那一份**继续推。
       第二次干预必须从第一次的结果出发，否则前一次烧掉的币等于白烧 ——
       而合约那边只认 cardOf[id]，它压根不知道服务端是从哪份参数算起的。
       存档里没有（第一次干预、基准就是原生 card）才回到 blockHash 重算。 */
    const stored = hasOld ? storeGet(oldCardHash) : null;
    const useStored = !!(stored && stored.blockHash === hash.toLowerCase());
    const native = useStored ? null : cardFor(hash.toLowerCase(), null);
    const base = useStored ? stored : native.card;

    /* ---- oldCardHash 必须真的是**这个 blockHash 的卡** ----

       合约的 intervene 摘要里只有 (tokenId, cardOf[id], 新卡…)，**没有 blockHash**
       —— 链上根本无从判断新卡算的是不是这枚 NFT 自己的宇宙，这件事只能在这里把住。
       原来这里只在「存档命中」时核对 blockHash，对不上就**默默退回按请求里的
       blockHash 重算**，于是：

         我持有 token 7（宇宙 A，D 档），拿 A 的 cardOf 当 oldCardHash，
         blockHash 却填一个 S 档的区块 B，随便推一格 ——
         服务端照签，合约验的是 cardOf[7] 和签名，两样都对，
         于是 token 7 的 cardOf 指向 B 的卡、稀有度被改写成 S。
       实测过：签名、费用、200 全都拿到了，新卡的 blockHash 是 B 而不是 A。
       稀有度直接决定定价和发币，这等于凭一次最便宜的干预把废卡刷成 S。

       所以：oldCardHash 必须能从这个 blockHash 复算出来 —— 要么是它的存档
       （上一次干预的结果），要么就是它的原生指纹。两样都不是就拒。
       这样一来「cardOf[id] 属于 universeOf[id].blockHash」这条链就是归纳成立的：
       第一枚章由 bangSigned 盖（摘要里有 blockHash，合约同时记下 universeOf），
       此后每一次干预的新旧两张卡都同属一个 blockHash。

       预览不设这道闸：它不签名、不落盘、不花钱，拿不到任何能上链的东西。 */
    if (!preview) {
      if (stored && !useStored) {
        return json(res, 400, {
          error: 'oldCardHash 是另一个区块的宇宙的卡，不能嫁接到这个 blockHash 上',
          code: 'CARD_MISMATCH'
        });
      }
      if (!useStored && native.cardHash.toLowerCase() !== oldCardHash.toLowerCase()) {
        /* 走到这儿有三种成因，都不能签：
             1. 就是上面说的嫁接（blockHash 和 oldCardHash 各说各的）
             2. 这枚是旧推导版本铸的 —— cardHash 里签着 derivationVersion，升级后必然对不上；
                按新推导给它签一份，等于把用户买到的那个宇宙换成另一个
             3. 干预存档丢了 —— 那份参数只有用户当场提交过，链上只留指纹，反推不回来；
                退回原生重算的话，他上一次烧掉的币就这么没了，而且合约看不出来
           三种都该当场说清楚，而不是签一份"看起来没问题"的名。 */
        return json(res, 400, {
          error: 'oldCardHash 复算不出来：它既不是这个 blockHash 的原生指纹，'
            + '也不在干预存档里（可能是旧推导版本铸的，或者存档丢了）',
          code: 'CARD_MISMATCH'
        });
      }
    }

    let out;
    if (empty) {
      // 空推：原样把基准状态回过去，费用 0。只有预览走得到这里
      out = { card: base, cardHash: useStored ? oldCardHash.toLowerCase() : native.cardHash, costBang: '0' };
    } else {
      try {
        out = evaluate(base, hasDeltas ? q.deltas : null, hasOps ? q.ops : null);
      } catch (e) {
        // evaluate 抛的都是用户输入问题（参数名不存在、值不是数、一个都没动）
        return json(res, 400, { error: e.message, code: e.code || undefined });
      }
    }

    if (preview) {
      /* 预览**不落盘**：沙盒里每点一下都是一次预览，落盘等于给了任何人
         一条往磁盘里灌垃圾的路。也**不签名**：没签名就上不了链，
         这条路因此不可能被拿去白嫖一次干预。 */
      const resp = {
        card: out.card, cardHash: out.cardHash, costBang: out.costBang,
        rarity: out.card.rarity, preview: true,
        /* 预览也回 ops：它不是秘密（它记的是"推到哪"，不是"一格有多长"，
           而"推到哪"本来就写在回给沙盒的 card.params 里）。
           沙盒拿着它就能在本地自己复算一遍，不必等真烧币才发现两边算的不是一个宇宙。
           空推那条路没有 opsHex（一格都没推，无位移可记），给 null。 */
        ops: out.opsHex || null
      };
      if (q.suggest === true) {
        /* 只回 key/dir 这几个标量。绝不能把"推一格之后的参数"也带上 ——
           那等于把这一格的长度直接送出去，几十次请求就能把半径表拼回来。 */
        try { resp.suggest = suggestNext(out.card); }
        catch (e) { resp.suggest = null; }
      }
      return json(res, 200, resp, { 'cache-control': 'no-store' });
    }

    /* v2 要绑 msg.sender：预览不签名所以前面已经 return；走到这儿才要 minter。
       校验必须在落盘之前：缺 minter 是 400，不该在存档里留下一张没签出去的卡。 */
    const minter = minterForSig(q, res);
    if (minter === false) return;

    /* 先落盘再签名，顺序不能反：签名一旦发出去用户就能拿去上链，
       那之后 tokenURI 指的图必须找得到参数。反过来则会出现"链上有这枚 NFT、
       服务端却不知道它长什么样"。 */
    storePut(out.cardHash, out.card);

    /* ops 必须**先于签名**定下来，并且原样进摘要：它被签名盖住之后，
       前端就只能把它一字不差地转给合约 —— 改一个字节链上就 BadSig。
       （合约不解析 ops，所以「签名盖住它」是它可信的唯一理由。） */
    const opsHex = out.opsHex;
    const { sig, deadline } = await signer.signWith((dl) => interveneDigest(
      CHAIN_ID, CONTRACT, tokenId, oldCardHash.toLowerCase(), out.cardHash,
      out.card.outcome.index, out.card.rarity.index, BigInt(out.costBang), dl,
      opsHashOf(opsHex), minter
    ));

    return json(res, 200, {
      card: out.card, cardHash: out.cardHash, costBang: out.costBang, deadline, sig,
      signer: signer.address, rarity: out.card.rarity,
      /* 位移记录，前端**原样**转发给合约的 intervene(…, ops, sig)。
         这是「这枚 NFT 被推到哪」唯一会上链的形态：服务端和它的存档都没了之后，
         任何人还能用 blockHash + 这段字节把参数算回来（server/intervene.js 的 applyOpsHex）。 */
      ops: opsHex,
      // 干预后参数变了，图不能再按 blockHash 索引 —— 见下面的 /art/card/
      art: PUBLIC_BASE + '/api/art/card/' + out.cardHash + '.svg'
    }, { 'cache-control': 'no-store' });
  }


  // GET /api/card/<hash> —— 幂等查询，不签名
  let m = p.match(/^\/card\/(0x[0-9a-fA-F]{64})$/);
  if (m) {
    let builtC;
    try { builtC = await cardForAsync(m[1].toLowerCase(), null); }
    catch (e) { if (cardPoolBusy(res, e)) return; throw e; }
    const { card, cardHash } = builtC;
    /* 只有 URL 里带了当前版本才敢发 immutable。
       否则推导一升级，所有客户端会永远拿着旧宇宙 —— 踩过一次：
       浏览器缓存里那份 card 的维度还是换阶梯之前的值，怎么刷新都不变。 */
    const fresh = u.searchParams.get('v') === DERIVATION_VERSION + '-' + SHAPE;
    return json(res, 200, { card, cardHash, version: DERIVATION_VERSION + '-' + SHAPE },
      { 'cache-control': fresh ? 'public, max-age=31536000, immutable' : 'no-cache' });
  }

  /* GET /api/art/card/<cardHash>.svg
     干预之后同一个 blockHash 对应的参数已经变了，按 blockHash 出的还是原生那张图。
     所以带干预痕迹的 NFT 必须按 cardHash 索引，参数从存档里读。 */
  m = p.match(/^\/art\/card\/(0x[0-9a-fA-F]{64})\.svg$/);
  if (m) {
    const ch = m[1].toLowerCase();
    const card = storeGet(ch);
    if (!card) return json(res, 404, { error: '没有这个 cardHash 的宇宙' });
    // 图仍然是 card 的纯函数，只是索引换了，所以照旧可以缓存（SVG 删了能从存档重画）
    /* ?t=1 出缩略图档：矢量内容照旧，只把内嵌的底图换成 400×400 的小图。
       全尺寸那张里底图占 99.3%（495 KB / 498 KB），列表页那个格子实际才显示
       300 像素左右，驮着 1200 的底图是纯浪费。缓存键必须带这个标志，
       否则两档会互相串。 */
    const thumb = u.searchParams.get('t') === '1';
    const key = 'artc-' + ch + '-v' + DERIVATION_VERSION + '-s' + SHAPE + (thumb ? '-t' : '') + '.svg';
    let svg = cacheGet(key);
    // 这里不设 ?p 开关：cardHash 是服务端签出来的，拿得到它的宇宙一定引爆过，必带参数
    if (!svg) svg = cachePut(key, renderSVG(card.blockHash, card, true, thumb));
    const freshCard = u.searchParams.get('v') === DERIVATION_VERSION + '-' + SHAPE;
    return send(res, 200, svg, {
      'content-type': 'image/svg+xml; charset=utf-8',
      // 缓存口径与下面那条一致：版本没带对就必须回源
      'cache-control': freshCard ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
  }

  // GET /api/art/<hash>.svg[?p=1]
  m = p.match(/^\/art\/(0x[0-9a-fA-F]{64})\.svg$/);
  if (m) {
    const hash = m[1].toLowerCase();
    const withParams = u.searchParams.get('p') === '1';
    const thumb = u.searchParams.get('t') === '1';   // 缩略图档，理由同上
    const key = 'art-' + hash + '-' + (withParams ? 'p' : 'n') + '-v' + DERIVATION_VERSION
      + '-s' + SHAPE + (thumb ? '-t' : '') + '.svg';
    let svg = cacheGet(key);
    if (!svg) {
      /* **出图这条路也能扫全链。** 图本身不是秘密，但「算一个还没算过的宇宙」是：
         ?p=1 的图上白纸黑字印着结局（"Observers possible"）、维度和四个常数，
         而这条路原来一点额度都不扣 —— /api/card 被 429 拦下之后，
         改打这个 URL 照样一个一个把结局读出来。实测：额度设成 3/小时时，
         8 个不同哈希的 ?p=1 出图 8 次全是 200。

         但闸只能架在**新宇宙**上，不能架在出图上：
         已经算过的宇宙（引爆过、或者别人问过）再出图、出缩略图，都是纯静态内容，
         扣额度只会让正常看图的人莫名其妙被 429 —— 而且图是 <img> 拉的，
         带不上 Authorization 头，只能落到宽松的 IP 档上。
         所以判据是 card 缓存在不在，不是 SVG 缓存在不在。 */
      /* 闸只架在 ?p=1 上。不带 p 的那张图上只有 "NOT DETONATED · NO PARAMETERS"
         和一个档位色 —— 档位是 keccak256(blockHash, 255) % 1000，合约自己就算得出来，
         本来就不是秘密。而市场和钱包要展示**没引爆过**的 NFT 就得拉这张图，
         把它也拦下来只会让那些格子变成裂图。 */
      if (withParams && !cardCached(hash) && gate(req, res, hash)) return;
      const { card } = cardFor(hash, null);
      svg = cachePut(key, renderSVG(hash, card, withParams, thumb));
    }
    const freshArt = u.searchParams.get('v') === DERIVATION_VERSION + '-' + SHAPE;
    return send(res, 200, svg, {
      'content-type': 'image/svg+xml; charset=utf-8',
      // 纯函数 → 对**同一个版本**永不变。版本没带对就必须回源，理由同上。
      'cache-control': freshArt ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
  }

  /* ================================================================ 分享图（PNG）
。**多数平台不认 SVG**（X 明确不支持，微信也不认），
     所以每条 .svg 都配一条 .png。选型、缓存、并发闸与"绝不 500"的实现都在 png.js。

     NFT 的图仍然是 SVG（tokenURI 指的还是 .svg，逐字节可重建）——
     PNG 只是分享用的派生物：可再生、可删、不进 cardHash。 */

  /** 出图响应的公共部分。fallback 那张**绝不许发长缓存**：
      依赖缺失是暂时状态，发了 immutable 就等于让 CDN 把通用图钉在这个 URL 上一年。 */
  function sendPNG(r, fresh) {
    return send(res, 200, r.buf, {
      'content-type': 'image/png',
      'cache-control': r.fallback ? 'no-cache'
        : (fresh ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
      // 验收和排障用：这张是命中缓存、现渲、还是退了通用图
      'x-png-cache': r.fallback ? 'fallback' : (r.cached ? 'hit' : 'miss'),
      'x-png-ms': String(r.ms)
    });
  }

  /* GET /api/art/preview.png —— 站点通用预览图。
     落地页在拿不到区块哈希时把 og:image 指到这里，前端也可以拿它当占位图。 */
  if (p === '/art/preview.png') {
    return send(res, 200, PNG.fallbackPNG(), {
      'content-type': 'image/png', 'cache-control': 'public, max-age=86400'
    });
  }

  // GET /api/art/card/<cardHash>.png —— 造物与被干预过的卡，索引换成 cardHash，理由同 .svg
  m = p.match(/^\/art\/card\/(0x[0-9a-fA-F]{64})\.png$/);
  if (m) {
    const ch = m[1].toLowerCase();
    const card = storeGet(ch);
    /* 没有这个 cardHash 就是 404，和 .svg 一条口径 —— 这是"调用方给错了"，
       不是"出图失败"。分享链路走的是下面那条按 blockHash 的路，不受影响。 */
    if (!card) return json(res, 404, { error: '没有这个 cardHash 的宇宙' });
    const key = 'artc-' + ch + '-v' + DERIVATION_VERSION + '-s' + SHAPE + '.png';
    const r = await PNG.pngFor(key, () => renderSVG(card.blockHash, card, true, false));
    return sendPNG(r, u.searchParams.get('v') === DERIVATION_VERSION + '-' + SHAPE);
  }

  /* GET /api/art/<hash>.png[?p=1][&og=1&n=<高度>][&w=<300..1200>]
       og=1  1200×630 的分享图：方卡原样缩到左边 + 右栏文字（og.js），落地页拿它当 og:image。
             它**永远带参数**（右栏印着结局），所以闸的判据按 withParams 走。
             n 是高度，只认纯数字 ≤ 12 位（去前导零归一化），没有就不印那一行。
       w     fitTo 宽度，300..1200 之外一律忽略 —— 老 URL 一个参数不带仍是 1200 的方图，字节不变。
     缓存键把变体和 n/w 都拼进去（art-<hash>-og-n<N>-w<W>-v<ver>-s<shape>.png）：
     不然 og 与方图、不同高度的 og、不同宽度会互相串。 */
  m = p.match(/^\/art\/(0x[0-9a-fA-F]{64})\.png$/);
  if (m) {
    const hash = m[1].toLowerCase();
    const og = u.searchParams.get('og') === '1';
    const withParams = og || u.searchParams.get('p') === '1';
    const nRaw = og ? String(u.searchParams.get('n') || '') : '';
    const n = /^\d{1,12}$/.test(nRaw) ? String(Number(nRaw)) : null;
    const wRaw = String(u.searchParams.get('w') || '');
    const w = /^\d{3,4}$/.test(wRaw) && Number(wRaw) >= 300 && Number(wRaw) <= 1200 ? Number(wRaw) : null;
    /* 闸与 .svg 逐字同口径：只拦「带参数 + 这个宇宙还没算过」。
       图上白纸黑字印着结局和常数，不拦的话它就是另一个扫描接口；
       但已经算过的宇宙再出图是纯静态内容，拦它只会让正常看图的人莫名其妙 429
       （图是 <img> 拉的，带不上 Authorization 头，只能落到宽松的 IP 档）。 */
    if (withParams && !cardCached(hash) && gate(req, res, hash)) return;
    const key = 'art-' + hash + '-' + (og ? 'og' + (n ? '-n' + n : '') : (withParams ? 'p' : 'n'))
      + (w ? '-w' + w : '') + '-v' + DERIVATION_VERSION + '-s' + SHAPE + '.png';
    const r = await PNG.pngFor(key, () => {
      const card = cardFor(hash, null).card;
      const svg = renderSVG(hash, card, withParams, false);
      return og ? OG.composeOG(svg, { blockNumber: n, card, blockHash: hash }) : svg;
    }, { width: w || PNG.SIZE });
    return sendPNG(r, u.searchParams.get('v') === DERIVATION_VERSION + '-' + SHAPE);
  }

  /* GET /api/token/<id> —— ERC-721 metadata，合约的 tokenURI 在 baseURI 非空时指到这里。
     **全站唯一读链上状态的端点**：cardOf[id] 会被干预改写、burnedOn[id] 会累加，
     所以它不是 blockHash 的纯函数，也不能强缓存。
     max-age 给 30 秒：既让市场不至于每次刷新都打四次 RPC，又让一次干预
     半分钟内就能在钱包里看见。 */
  m = p.match(/^\/token\/(\d{1,78})$/);
  if (m) {
    let chain;
    try {
      chain = await readToken(CONTRACT, BigInt(m[1]));
    } catch (e) {
      /* universeOf 都 revert 了，说明 ARCBANG_CONTRACT 指的根本不是这个合约 ——
         那是我们的配置错，不是链的问题，报 503 会让人一直等节点恢复。 */
      if (e.reverted) {
        return json(res, 502, { error: '配置的合约地址不认识 universeOf，请核对 ARCBANG_CONTRACT' });
      }
      /* 地址上压根没有合约（eth_call 回空数据，不 revert）。同样是配置错，
         但和上面那条是两种毛病，话要分开说：一个是"地址上没东西"，
         一个是"地址上有东西但不是这个合约"。报成 404 的后果见 token.js 里的注释。 */
      if (e.noContract) {
        console.error('[token] 地址上没有合约：' + (e && e.message));
        return json(res, 502, { error: '配置的合约地址上没有合约，请核对 ARCBANG_CONTRACT 与 chainId' });
      }
      /* 与 /bang 同一口径：节点全挂是我们的故障，必须报 503。
         报成 404 的话，一次网络抖动会让市场以为这枚 NFT 被烧了。 */
      console.error('[token] RPC 不通：' + (e && e.message));
      return json(res, 424, { error: '链上节点暂时打不通，请稍后再试' });   // 不用 503：Cloudflare 会换成自己的错误页
    }
    if (!chain) return json(res, 404, { error: '链上没有这枚 NFT' });
    const { meta } = buildMetadata(chain, {
      cardFor, storeGet, publicBase: PUBLIC_BASE, version: DERIVATION_VERSION + '-' + SHAPE
    });
    return json(res, 200, meta, { 'cache-control': 'public, max-age=30' });
  }

  /* ================================================================ 市场索引
。全部 no-store：市场数据实时性优先，
     而且 stale 标志本身就是「这份数据有多新」的答案，缓存它等于把答案也缓存了。

     三条都**不会抛**：marketindex.js 里的实现最坏返回空集 + stale:true，
     前端据此走它保留的直读降级路径。这里再包一层 try/catch 是双保险 ——
     市场页读不到索引可以降级，但绝不该看见 500。 */
  const NOSTORE = { 'cache-control': 'no-store' };

  // GET /api/market/listings —— 服务端分页 + 排序 + 筛选，前端一页只打一次
  if (p === '/market/listings' && req.method === 'GET') {
    try {
      const q = u.searchParams;
      const out = await MI.listingsPage({
        sort: q.get('sort'), series: q.get('series'), cur: q.get('cur'),
        rarity: q.get('rarity'), outcome: q.get('outcome'), named: q.get('named'),
        /* 物理筛选：
             dim=3 | 3-5 | frac | int | >3     维度
             const=<键>&min=&max=              卡面上印的常数（c/h/e/G/alpha/alphaInv/alphaGRel）
             sort=const_asc&by=<键>            按某个常数排序
             dev=low|high                      与我们宇宙的偏离度（**服务端算**） */
        dim: q.get('dim'), const: q.get('const'), min: q.get('min'), max: q.get('max'),
        by: q.get('by'), dev: q.get('dev'),
        page: q.get('page'), size: q.get('size')
      });
      return json(res, 200, out, NOSTORE);
    } catch (e) {
      console.error('[market/listings]', e);
      return json(res, 200, { total: 0, page: 0, size: 24, stale: true, items: [], error: '索引暂时读不了' }, NOSTORE);
    }
  }

  /* GET /api/market/owned?addr=0x… —— 这一条替代前端「倒扫 totalSupply + 逐个 ownerOf」。
     地址不合法报 400（是调用方给错了），索引没起来不报错、报 stale（是我们这边的事，
     而前端有直读退路）。 */
  if (p === '/market/owned' && req.method === 'GET') {
    try {
      const addr = String(u.searchParams.get('addr') || '');
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        return json(res, 400, { error: 'addr 不是一个地址' }, NOSTORE);
      }
      return json(res, 200, await MI.ownedOf(addr), NOSTORE);
    } catch (e) {
      console.error('[market/owned]', e);
      return json(res, 200, { stale: true, native: [], crafted: [], other: [], error: '索引暂时读不了' }, NOSTORE);
    }
  }

  // GET /api/market/status —— 索引落后多少、是不是旧的。前端靠 stale 决定要不要显示那行黄字
  if (p === '/market/status' && req.method === 'GET') {
    try { return json(res, 200, MI.statusOf(), NOSTORE); }
    catch (e) {
      console.error('[market/status]', e);
      return json(res, 200, { stale: true, error: '索引暂时读不了' }, NOSTORE);
    }
  }

  /* POST /api/subscribe { site, email, lang? } —— 上线预约（server/subscribe.js）。
     同一 IP 每小时 5 次；重复登记回 already:true；不发邮件、不连第三方。 */
  /* POST /api/stall { dump, site, page, appVersion, sentAt } —— 前端看门狗的假死现场。
     同一 IP 每小时 10 条；落盘 .store/stall-reports.jsonl（IP 只留前缀）；配了 key 再发一封邮件。
     **不提供 GET** —— 报告里有别人的页面路径与机器信息，没理由让它可读。 */
  if (p === '/stall' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedSt = parseJsonObject(rb);
    if (parsedSt.error) return json(res, 400, { error: parsedSt.error }, NOSTORE);
    const rs = STALL.add(parsedSt.value, RL.ipOf(req), rb.length);
    return json(res, rs.status, rs.body, NOSTORE);
  }

  if (p === '/subscribe' && req.method === 'POST') {
    const rb = await bodyOf(req, res);
    if (rb === null) return;
    const parsedSub = parseJsonObject(rb);
    if (parsedSub.error) return json(res, 400, { error: parsedSub.error }, NOSTORE);
    const r = SUB.add(parsedSub.value, RL.ipOf(req));
    return json(res, r.status, r.body, NOSTORE);
  }

  /* ================================================================ 分享落地页
     GET /s/<区块号>（也认 /s/<0x哈希>：造物的起源、老存档拿不到区块号）。
     第一版是「爬虫拿 og，人拿跳转」；现在是一张
     **可索引的真页面**（landing.js）：结局、物理解释、常数表、铸造状态、进模拟器的按钮，
     不再自动跳转，爬虫和人拿同一份。这里只负责"把哈希、card、铸造状态弄到手，弄不到就降级"。
     索引口径（seo.js）：已铸造 / 精选 / 附加名单 → index, follow；其余 noindex, follow，页面照样出。

     nginx 把 /s/ 原样转到本进程；/api/s/<区块号> 也能用：handle() 开头把 /api 前缀剥掉。
     **整段包在 try 里**：落地页任何一环炸了都退成通用文案，绝不落到 500 那层。 */
  m = p.match(/^\/s\/(\d{1,12}|0x[0-9a-fA-F]{64})$/);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const token = m[1];
    const carry = SHARE.carryQuery(u.searchParams);
    const isHash = token.startsWith('0x');
    let hash = isHash ? token.toLowerCase() : null;
    const blockNumber = isHash ? null : Number(token);
    let card = null;
    let mint = { minted: null };
    let height = blockNumber;
    try {
      if (!isHash) {
        try {
          const b = await blockNumToHash(blockNumber);
          /* 查不到这个高度 = 链接里的数是编的或者还没出块 → **跳首页，不给错误页**。
             分享链接落地成一句"没有这个区块"，对收到链接的人毫无意义。 */
          if (!b) return send(res, 302, '', { location: '/', 'cache-control': 'no-store' });
          hash = b.hash;
        } catch (e) {
          /* RPC 全挂：这是我们的故障，不是链接的错。照样给页面，结局写"还没算"（**不猜结局**），
             按钮照样指向 app.html，前端自己会再查一次。 */
          console.error('[/s] 按高度取块失败（降级成通用文案）：' + (e && e.message));
        }
      }

      if (hash) {
        /* card 只在**不用扣额度**时才取：出图那条路的判据一样 ——
           已经算过的宇宙随便读，没算过的要走限流。被限流拦下时不报 429，
           降级成"还没算"就好（爬虫要的是能抓到东西，不是一个错误码）。 */
        try {
          if (cardCached(hash)) card = cardFor(hash, blockNumber).card;
          else if (RL.check(req, hash).ok) card = cardFor(hash, blockNumber).card;
        } catch (e) { console.error('[/s] 取 card 失败（降级成通用文案）：' + (e && e.message)); }
        /* 铸造状态只读内存索引，不打 RPC；反查不到时它自己会三态作答（marketindex.mintStatusOf）。 */
        try { mint = MI.mintStatusOf(hash) || mint; } catch (e) { mint = { minted: null }; }
        // 哈希形式的链接：索引知道高度就拿来印在 og 图上（页面标题仍按哈希写，见 landing.js）
        if (height == null && Number.isSafeInteger(mint.blockNumber)) height = mint.blockNumber;
      }
    } catch (e) {
      console.error('[/s] 落地页装配失败（降级成通用文案）：' + (e && e.message));
    }

    const ver = DERIVATION_VERSION + '-' + SHAPE;
    const bang = hash && !isHash ? String(blockNumber) : (hash || String(blockNumber));
    const appUrl = '/app.html?bang=' + encodeURIComponent(bang) + (carry ? '&' + carry : '');
    /* 落地页上那颗「去任务页」：**把 ?ref= 原样带过去**。
       分享链接现在带的是 6 位登记码，任务页的登记表单认得它（?ref=<码> 预填邀请码）。
       带不过去的话，通过分享链接进来的人等于白邀请一场。 */
    const refCode = /^[A-Z0-9]{6}$/i.test(String(u.searchParams.get('ref') || ''))
      ? String(u.searchParams.get('ref')).toUpperCase() : '';
    const questUrl = '/quest.html' + (refCode ? '?ref=' + encodeURIComponent(refCode) : '');
    const base = PUBLIC_BASE;
    const canonical = base + '/s/' + token;
    /* og:image 用 1200×630 的变体（右栏印高度，所以带 n）；正文里那张仍是方卡本体。
       拿不到哈希时两张都退站点通用预览图。 */
    const ogImage = hash
      ? base + '/api/art/' + hash + '.png?og=1' + (height != null ? '&n=' + height : '') + '&v=' + ver
      : base + '/api/art/preview.png';
    const cardImage = hash ? base + '/api/art/' + hash + '.png?p=1&v=' + ver : ogImage;
    let indexable = false;
    try {
      indexable = SEO.inIndexSet(blockNumber, mint.minted === true);
    } catch (e) { indexable = false; }

    const opts = { blockNumber, hash, card, mint, indexable, appUrl, questUrl, canonical, ogImage, cardImage, base };
    let html;
    try { html = LANDING.landingHTML(opts); }
    catch (e) {
      console.error('[/s] 渲染落地页失败（退通用文案）：' + (e && e.message));
      try { html = LANDING.landingHTML(Object.assign({}, opts, { card: null, mint: { minted: null } })); }
      catch (e2) {
        /* 连通用文案都渲不出来（landing.js 本身坏了）：最后一道，一行硬编码的页，仍然指向 app.html。 */
        html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ARCBANG</title></head>'
          + '<body><p><a href="' + SHARE.esc(appUrl) + '">Open in the simulator</a></p></body></html>';
      }
    }
    return send(res, 200, req.method === 'HEAD' ? '' : html, {
      'content-type': 'text/html; charset=utf-8',
      /* 完整那版缓存五分钟（区块是不可变的；铸造状态会变，但五分钟内看见"已铸"够快）；
         **降级那版只给一分钟** —— 它是"这次没拿到 card"的临时结果，
         钉久了等于让一次 RPC 抽风毁掉这条链接一整段时间的预览。 */
      'cache-control': card ? 'public, max-age=300' : 'public, max-age=60',
      /* 搜索引擎看头也看 meta，两处同口径（seo.js）。 */
      'x-robots-tag': indexable ? 'index, follow' : 'noindex, follow'
    });
  }

  /* GET /sitemap-s.xml、/sitemap-s-<k>.xml —— /s/ 落地页的 sitemap（seo.js）。
     只列有高度的、进索引集合的宇宙；超过 45,000 条出 sitemap index 分页。
     绝不 500：seo.js 炸了就给一份空的、结构正确的 urlset（no-store，别把空表钉住十分钟）。 */
  m = p.match(/^\/sitemap-s(?:-(\d{1,5}))?\.xml$/);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    let r = null;
    try {
      r = SEO.sitemap(PUBLIC_BASE, m[1] ? Number(m[1]) : null);
    }
    catch (e) { console.error('[sitemap-s] 出 sitemap 失败（退空表）：' + (e && e.message)); }
    const xml = r ? r.xml
      : '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';
    return send(res, r ? r.status : 200, req.method === 'HEAD' ? '' : xml, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': r ? 'public, max-age=600' : 'no-store'
    });
  }

  /* POST /api/rpc —— 同源只读 RPC 中继（rpcrelay.js）。浏览器的公开节点在国内只有一个能通，
     这里让它落到服务器来问；方法白名单、目标合约白名单、限流、跨度封顶都在模块里。 */
  if (p === '/rpc') {
    if (req.method !== 'POST') return json(res, 405, { error: '只收 POST' }, { allow: 'POST', 'cache-control': 'no-store' });
    try { return await RELAY.handle(req, res, { ip: clientIpOf(req), json }); }
    catch (e) {
      console.error('[rpc-relay]', e && e.message);
      return json(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32000, message: '中继出错' } }, { 'cache-control': 'no-store' });
    }
  }

  return json(res, 404, { error: '没有这个端点' });
}

/* 区块号 → 哈希。**带一层内存缓存 + 超时**：
   - 缓存：已经出块的高度对应的哈希是不变的，同一个链接被十个人点开不该打十次 RPC；
   - 超时：爬虫等不了 chain.js 那套（每个节点 8 秒 × N 个节点）。抓不到就降级，
     宁可 og 少一句结局，也不能让落地页转圈到爬虫超时——那等于没有预览图。
   条数封顶，不然它自己会变成内存泄漏。 */
const NUM2HASH = new Map();
const NUM2HASH_PENDING = new Map();
const NUM2HASH_MAX = 5000;
/* 6 秒：实测热连接一次 eth_getBlockByNumber 约 250 ms，但**进程刚起来那一次**
   要连 DNS + TLS，实测 2.3 秒，赶上节点慢就会超过 4 秒 —— 而超时的代价是
   这条链接抓到的 og 里没有结局（分享出去最有说服力的那半句就没了）。
   上限还是要有：爬虫大多 10 秒左右就放弃，转圈到它超时等于连通用文案都没有。
   NaN 会让 setTimeout 立刻触发，分享页永远降级。 */
const BLOCK_LOOKUP_MS = envInt(process.env.ARCBANG_SHARE_RPC_MS, 6000, 500, 30000);
async function blockNumToHash(n) {
  if (NUM2HASH.has(n)) return NUM2HASH.get(n);
  const pending = NUM2HASH_PENDING.get(n);
  if (pending) return pending;
  const job = (async () => {
    /* 超时赢了之后 lookup 仍可能随后 reject —— 多接一个空 catch，避免未处理拒绝。 */
    const lookup = Promise.resolve(chainMod.blockByNumber(n));
    lookup.catch(() => {});
    const b = await Promise.race([
      lookup,
      new Promise((_, rej) => setTimeout(() => rej(new Error('取块超时')), BLOCK_LOOKUP_MS).unref())
    ]);
    /* 只缓存"查到了"。查不到可能是这个高度还没出（下一秒就出了），缓存它等于
       把一个会变的答案钉死。 */
    if (b) {
      if (NUM2HASH.size >= NUM2HASH_MAX) NUM2HASH.clear();
      NUM2HASH.set(n, b);
    }
    return b;
  })();
  NUM2HASH_PENDING.set(n, job);
  job.catch(() => {}).finally(() => { NUM2HASH_PENDING.delete(n); });
  return job;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const bufs = [];
    let n = 0;
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; fn(v); };
    req.on('data', d => {
      n += d.length;
      if (n > 4096) { finish(reject, new Error('请求体过大')); req.destroy(); return; }
      bufs.push(d);
    });
    req.on('end', () => finish(resolve, Buffer.concat(bufs).toString('utf8')));
    req.on('error', (e) => finish(reject, e));
  });
}

function start() {
  const envErrs = serverEnvErrors();
  if (envErrs.length) {
    console.error('[bnbbang] 拒绝启动：环境变量不完整，不会悄悄用测试网默认值：');
    envErrs.forEach((e) => console.error('  · ' + e));
    process.exit(1);
  }
  if (!start._rejHook) {
    start._rejHook = true;
    process.on('unhandledRejection', (e) => {
      console.error('[unhandledRejection]', e && (e.stack || e.message || e));
    });
  }
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      return send(res, 204, '', {
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type, authorization'
      });
    }
    handle(req, res, u).catch(e => {
      console.error('[500]', u.pathname, e);
      json(res, 500, { error: '服务端出错' });
    });
  }).listen(PORT, '127.0.0.1', () => {
    console.log('ARCBANG api  http://127.0.0.1:' + PORT);
    console.log('  chainId   ' + CHAIN_ID + '   （' + CHAIN_NAME + '）');
    console.log('  contract  ' + CONTRACT);
    console.log('  signer    ' + signer.address + '   ← 这个地址必须和合约里的 signer 一致');
    console.log('  derivation v' + DERIVATION_VERSION);
    /* 算卡线程数与全站每分钟上限一起打：这两个数是一对 —— 线程数决定我们一分钟
       真能算多少张，上限是给这条产能配的保险丝。看日志的人不该再去翻两个文件。 */
    console.log('  算卡线程 ' + CARDPOOL.size() + ' 个'
      + (CARDPOOL.size() ? '' : '（已关闭，退回主线程同步算）')
      + '，全站上限 ' + RL.GLOBAL_PER_MIN + '/分钟');
    console.log('  store     ' + STORE_DIR + '   ← 干预记录在这儿，别当缓存删');
    {
      /* 放号阶段要在启动日志第一屏就看得见：warmup 段是**一张铸造签名都不签**的，
         线上如果忘了往后推阶段，表现就是「所有人点铸造都说还没开」，
         而这件事从别的地方看不出来。 */
      const c = AL.counts();
      const nx = AL.nextOpen();
      const T = AL.tops();
      /* 阶段现在是**后台落盘的**（.store/phase.json）还是 env 的，日志里要说清楚：
         这两者对不上时，改 env 重启是没有用的，而那一刻人最容易以为是自己改错了。 */
      const pi = AL.phaseInfo();
      const SRC = { file: '后台设的', state: '后台设的（老格式）', env: 'env 默认' };
      console.log('  阶段      ' + AL.phase()
        + '（' + (SRC[pi.source] || pi.source) + (pi.source === 'file' && pi.updatedAt ? ' ' + pi.updatedAt : '') + '）'
        + (AL.phase() === 'warmup' ? '（预热：不签任何铸造签名）' : '')
        + (nx ? '   下一段 ' + nx.phase + ' ' + (nx.at || '（时间待定）') : '   已是最后一段'));
      console.log('  名单      保底 ' + c.gtd + ' · 先到先得 ' + c.fcfs
        + '（榜前 ' + T.gtd + ' / ' + T.free + ' 名）· 登记 ' + AL.appliedCount() + ' 条'
        + (c.frozen ? ' · **已定格**' : ' · 实时按积分榜算'));
      /* 不在预热期却还没定格是真实故障：名单会随积分变，有人可能铸到一半被挤出去。
         这句必须在启动日志第一屏喊出来，而不是等谁发现。 */
      if (!c.frozen && AL.phase() !== 'warmup') {
        console.log('  !! 已经不在预热期，名单却没定格 —— 跑 node server/tools/allowlist.js freeze');
      }
      if (!AL.pinnedPost()) console.log('  !! 没配 ARCBANG_PINNED_POST_URL，预热页不显示转发按钮（转发那 30 分没人拿得到）');
    }
    console.log('  stall     ' + (STALL.mailOn ? '报告落盘 + 邮件 → ' + STALL.mailTo : '卡死报告只落盘，未配邮件（要发信就设 ARCBANG_RESEND_KEY）'));
    /* 市场索引后台扫链。**放在 listen 回调里、且不 await** ——
       索引起不起得来与站点能不能服务无关，它自己会重试，
       起不来时市场页走直读降级。绝不能让它拦在 listen 前面。 */
    probeChainId().catch((e) => console.error('[chain] probeChainId', e && e.message));
    probeLogRpc().catch((e) => console.error('[chain] probeLogRpc', e && e.message));
    try { MI.startIndexer(); }
    catch (e) { console.error('[marketindex] 起不来（不影响其余端点）：' + (e && e.message)); }
  });
}

/* 被 require 时**不监听**，只把 handle 交出去 —— selftest 要直接调路由。
   起真端口去测就得挑没被占的口、等监听、再收尾，测试会变成看天吃饭。 */
if (require.main === module) start();

module.exports = { handle, start, cardFor, storeGet, storePut, STORE_DIR, SHAPE, serverEnvErrors };
