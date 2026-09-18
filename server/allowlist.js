/*
 * 积分榜、白名单与分期 —— 谁能铸、什么时候能铸、免不免费
 * ============================================================================
 *
 * 为什么有这个文件（2026-09-18）：
 *   第一次主网部署上线 20 分钟，一个 IP 用 5 个新地址、一分钟一枚，
 *   把 5 枚免费额度薅走了。原来的防线是「同一 IP 每天最多 N 个免费签名」——
 *   IP 是最便宜的东西，这道闸等于没有。那次部署已作废。
 *
 *   现在的防线换成两件事，缺一不可：
 *     1. **合约那边**：bangSigned 收一个 bool free，它签在摘要里（见 ArcUniverse.sol）。
 *        合约不再自己按 totalSupply / freeMintCount 判「这一枚该不该免费」，
 *        所以「换个干净的新地址就有一枚免费额度」这条路从根上没了。
 *     2. **这个文件**：免费与否由服务端按名单和阶段决定，然后签进那道摘要。
 *
 *   IP 不再参与任何铸造判断。这里只剩登记接口那一道 IP 闸，它防的是灌名单。
 *
 * ---------------------------------------------------------------------------
 * 名单怎么来的：**按积分榜生成，不是人工一个个批**（2026-09-18 用户拍板改）
 *
 *   四项积分，数字全部走环境变量（下面括号里是默认值）：
 *     登记            ARCBANG_PTS_REGISTER        10 分，登记即得
 *     转发置顶推      ARCBANG_PTS_REPOST          30 分，**管理员 verify 打勾后才计**
 *                     （X 那边的评论是人工核的 —— 不买 X API）
 *     有效邀请        ARCBANG_PTS_INVITE          20 分/人
 *                     ARCBANG_PTS_INVITE_MAX      最多算 20 人
 *                     「有效」= **被邀请人已经被 verify**（光登记不算）
 *     引爆并分享      ARCBANG_PTS_SHARE            5 分/天
 *                     ARCBANG_PTS_SHARE_MAX_DAYS  最多算 5 天
 *                     同一地址同一天只计一次
 *
 *   排名：积分降序，同分按登记时间升序（先登记的在前）；再同就按地址排，保证稳定。
 *
 *   名次 ≤ ARCBANG_GTD_TOP（默认 100）  → tier='gtd'（保底）
 *   名次 ≤ ARCBANG_FREE_TOP（默认 387） → tier='fcfs'（先到先得）
 *   其余不在名单。
 *
 *   **预热期这个名单是实时的**：榜每次现算（30 秒缓存），今天第 101 名明天可能进前 100。
 *   进入 gtd 段之前必须跑一次 `freeze`，把当时的榜定格写进 allowlist.json ——
 *   之后名单不再随积分变（否则有人铸到一半被挤出名单，那是不可解释的）。
 *
 *   命令行仍保留 add / remove / tier 做人工覆盖：allowlist.json 里的条目**永远赢**，
 *   无论定格没定格。
 *
 * ---------------------------------------------------------------------------
 * 四个阶段（ARCBANG_PHASE，默认 warmup）
 *
 *   warmup    预热。**一张铸造签名都不签**，页面只有倒计时、积分榜和登记入口。
 *   gtd       保底期。只有 tier='gtd' 的地址能铸，且走免费额度。
 *   fcfs      先到先得期。gtd 与 fcfs 两层都能铸，都走免费额度，
 *             抢到合约的 freeCap（387 枚）用完为止 —— 之后名单里的人也只能付费。
 *   public    公售。谁都能铸，默认付费（1 USDC，每地址最多 3 枚）。
 *             名单里还没用掉免费额度的人仍然签 free=true，直到 freeCap 用完。
 *
 *   积分榜和名次是**公开**的（榜上只给地址缩写）；「谁是 gtd」不单独播报 ——
 *   看榜的人自己数得出来前 100 是谁，这没关系，那本来就是公开的规则。
 *
 * 到点自动切段：ARCBANG_GTD_OPEN_AT / ARCBANG_FCFS_OPEN_AT / ARCBANG_PUBLIC_OPEN_AT
 *   （ISO 时间，可选）。规则是**只前进不后退** —— 时间到了就往后推一段，
 *   但不会把 ARCBANG_PHASE 已经手动推到的段拉回来。
 *
 * ---------------------------------------------------------------------------
 * 登记码（不买 X API，人工/半自动比对）
 *
 *   登记成功后给这个地址一个 **6 位大写字母数字**的码，
 *   由 HMAC(盐, 地址) 派生 —— 所以它**可复现**：盘上丢了也能重算，
 *   服务端不必再存一张码表，人工比对时也能从地址现场算出来对。
 *   盐在 ARCBANG_ALLOWLIST_SALT。**换盐等于把所有已发出去的码作废**，别在活动中途换。
 *
 *   任务是「转发置顶推 + 回复自己的登记码」。置顶推的链接在 ARCBANG_PINNED_POST_URL。
 *   审核时把 X 那边的评论和 /api/allowlist/applied 的 CSV 对一遍，
 *   对上的跑 `verify <码>` —— 那一步只打转发勾（+30 分），**不直接进名单**。
 *
 *   登记码兼作邀请码：登记时带 ref=<别人的码>。自己邀自己直接拒。
 *
 * ---------------------------------------------------------------------------
 * 三份盘上的文件（都在 .store/）
 *   allowlist-applied.jsonl 登记流水，一行一条 { addr, x, ref, inviter, ip, at }。追加式。
 *   allowlist-state.json    会变的那部分：{ verified: {addr: ISO}, shares: {addr: [YYYY-MM-DD]} }
 *   allowlist.json          **定格后**的名单与人工覆盖：
 *                           { updatedAt, frozen, frozenAt, addresses: [{addr, tier, src, at}] }
 *                           也认老式的纯地址数组（一律当 tier='fcfs'）。
 *
 * 环境变量每次调用现读：自检要在同一个进程里把四个阶段、各种分值各跑一遍。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifyMessage } = require('ethers');
const { writeAtomic } = require('./atomic.js');

/* 阶段名按时间顺序排，下面靠下标比大小（「只前进不后退」就是比这个下标）。 */
const PHASES = ['warmup', 'gtd', 'fcfs', 'public'];
const TIERS = ['gtd', 'fcfs'];
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDR = /^0x0{40}$/i;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
/* X 用户名：1–15 位字母数字下划线，这是 X 自己的规矩。前面的 @ 收进来后剥掉。 */
const X_RE = /^[A-Za-z0-9_]{1,15}$/;
/** 登记码：6 位大写字母数字。人要抄进 X 的评论里，所以只用这一种形状。 */
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LEN = 6;
const CODE_RE = /^[A-Z0-9]{6}$/;
/** 登记接口每 IP 每天多少次。防的是「一个人灌两万条」，不是防薅 —— 薅由名单本身挡。 */
const REGISTER_PER_IP_DAY = 20;
const DAY = 24 * 3600 * 1000;
/** 登记流水的硬顶：超过就不再收，免得磁盘被人灌满。 */
const MAX_APPLIED = 200000;
/** 榜的缓存窗口。榜是 O(登记数) 的全量重算，预热页会被很多人同时刷。 */
const BOARD_TTL_MS = 30 * 1000;
/** **公开的榜只到前 100 名**（2026-09-18 用户拍板）。
    第 101 名往后不在榜上出现 —— 但他自己的名次、积分、离第 100/387 名差几分
    照常在 status 里回给**他本人**。这道上限在服务端夹死，前端改不了。 */
const BOARD_PUBLIC_MAX = 100;

/** 非负整数环境变量。NaN / 负数 / 空一律退默认 —— 配歪一个字就把分值变成 0 太危险。 */
function envInt(name, def) {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n >= 0 ? n : def;
}
/** 积分表。**每次现读**：自检要在同一进程里换着分值跑。 */
function pointsTable() {
  return {
    register: envInt('ARCBANG_PTS_REGISTER', 10),
    repost: envInt('ARCBANG_PTS_REPOST', 30),
    invite: envInt('ARCBANG_PTS_INVITE', 20),
    inviteMax: envInt('ARCBANG_PTS_INVITE_MAX', 20),
    share: envInt('ARCBANG_PTS_SHARE', 5),
    shareMaxDays: envInt('ARCBANG_PTS_SHARE_MAX_DAYS', 5)
  };
}
/** 两档名额。gtdTop 必须 ≤ freeTop，配反了就把 gtd 夹到 freeTop（不是报错崩掉）。 */
function tops() {
  const free = envInt('ARCBANG_FREE_TOP', 387);
  const gtd = Math.min(envInt('ARCBANG_GTD_TOP', 100), free);
  return { gtd, free };
}

function rank(p) { const i = PHASES.indexOf(p); return i < 0 ? 0 : i; }
function normAddr(v) {
  const s = String(v == null ? '' : v).trim();
  if (!ADDR_RE.test(s) || ZERO_ADDR.test(s)) return null;
  return s.toLowerCase();
}
function normTier(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return TIERS.indexOf(s) >= 0 ? s : null;
}
function normX(v) {
  const s = String(v == null ? '' : v).trim().replace(/^@+/, '');
  return X_RE.test(s) ? s : null;
}
function normCode(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
}
/** 地址缩写。榜是公开的，但只给缩写 —— 名次和分数是规则的一部分，完整地址不是。 */
function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }
/** UTC 的 YYYY-MM-DD。**必须是 UTC**：按本地时区算的话，服务器换个时区就多送一天的分。 */
function dayOf(now) { return new Date(now == null ? Date.now() : now).toISOString().slice(0, 10); }
/** IP 脱敏：与 stall.js 同一口径（IPv4 前两段 / IPv6 前两组）。落盘只留这个。 */
function ipPrefix(ip) {
  const s = String(ip == null ? '' : ip).trim();
  if (!s) return null;
  if (s.indexOf(':') >= 0) {
    const g = s.split(':').filter(Boolean);
    return g.length ? g.slice(0, 2).join(':') + '::/32' : null;
  }
  const q = s.split('.');
  return q.length === 4 ? q[0] + '.' + q[1] + '.x.x' : null;
}

/* ---------------------------------------------------------------- 登记码
   HMAC(盐, 小写地址) 取前 8 字节，按 36 进制铺成 6 位。
   **可复现**是这个设计的全部意义：盘上的流水丢了、或者要在别的机器上核对，
   拿地址和盐就能把码算回来，不必再维护一张码表。
   盐没配时退回一个写死的默认值 —— 这不是密钥，它只是让码不能被外人从地址直接猜到；
   猜到别人的码最多能冒名去 X 上刷一条评论，链上什么也做不了。 */
function salt() {
  return String(process.env.ARCBANG_ALLOWLIST_SALT || 'arcbang-allowlist-v1');
}
function codeOf(addrRaw) {
  const a = normAddr(addrRaw);
  if (!a) return null;
  const h = crypto.createHmac('sha256', salt()).update(a).digest();
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(h[i]);
  let out = '';
  const base = BigInt(CODE_ALPHABET.length);
  for (let i = 0; i < CODE_LEN; i++) { out = CODE_ALPHABET[Number(n % base)] + out; n /= base; }
  return out;
}

/* ---------------------------------------------------------------- 阶段 */
function envPhase() {
  const v = String(process.env.ARCBANG_PHASE || '').trim().toLowerCase();
  return PHASES.indexOf(v) >= 0 ? v : 'warmup';
}
/** ISO 时间 → 毫秒；空 / 看不懂一律 null（不是 0 —— 0 是 1970，等于「早就开了」）。 */
function tsOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function openTimes() {
  return {
    gtd: tsOf(process.env.ARCBANG_GTD_OPEN_AT),
    fcfs: tsOf(process.env.ARCBANG_FCFS_OPEN_AT),
    public: tsOf(process.env.ARCBANG_PUBLIC_OPEN_AT)
  };
}
/** 给页面看的：ISO 串或 null */
function opensIso() {
  const o = openTimes();
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  return { gtd: iso(o.gtd), fcfs: iso(o.fcfs), public: iso(o.public) };
}
/** 当前阶段。env 里手动设的那一段是**下限**，到点的时间只会把它往后推。 */
function phaseAt(now) {
  const t = now == null ? Date.now() : now;
  let p = envPhase();
  const o = openTimes();
  if (o.gtd != null && t >= o.gtd && rank(p) < rank('gtd')) p = 'gtd';
  if (o.fcfs != null && t >= o.fcfs && rank(p) < rank('fcfs')) p = 'fcfs';
  if (o.public != null && t >= o.public && rank(p) < rank('public')) p = 'public';
  return p;
}
/** 下一段什么时候开（给倒计时用）：{ phase, at } 或 null（已经是最后一段） */
function nextOpen(now) {
  const t = now == null ? Date.now() : now;
  const p = phaseAt(t);
  const o = openTimes();
  const seq = [['gtd', o.gtd], ['fcfs', o.fcfs], ['public', o.public]];
  for (const [name, at] of seq) {
    if (rank(name) <= rank(p)) continue;        // 已经过了这一段
    if (at == null) return { phase: name, at: null };   // 待定：页面显示「时间待定」
    if (at > t) return { phase: name, at: new Date(at).toISOString() };
  }
  return null;
}
/** 置顶推的地址（任务要转发它）。没配就只显示码和说明。 */
function pinnedPost() {
  const u = String(process.env.ARCBANG_PINNED_POST_URL || '').trim();
  return /^https:\/\/(x\.com|twitter\.com)\//i.test(u) ? u : null;
}

/* ---------------------------------------------------------------- 要签的那句话
   固定文案，含域名与地址：
     · 含域名 —— 在 A 站骗到的签名拿不到 B 站来用；
     · 含地址 —— 签名本身就说清楚「我是这个地址」，服务端 verifyMessage 回来对得上才算；
     · 不含 nonce —— 这不是登录，重放一次也只是重复登记同一个地址，去重那一步会挡掉。

   **同一句话兼作会话令牌**：登记时签一次，浏览器把签名留在 localStorage，
   之后每次「引爆并分享」拿它去 /api/allowlist/share 记一天的分 ——
   用户拍板「别每次弹钱包」。重放这个签名最多能给**签名者自己**记一次分，
   而同一天只记一次，所以它不需要 nonce。

   **客户端不自己拼这句话**：它从 /api/allowlist/status 拿 message 字段原样去签，
   两边各拼一次早晚会差一个换行。 */
function domain() {
  const d = String(process.env.ARCBANG_ALLOWLIST_DOMAIN || '').trim();
  if (d) return d;
  const base = String(process.env.ARCBANG_PUBLIC_BASE || '').trim();
  if (base) { try { return new URL(base).host; } catch (e) { /* 配歪了就退默认 */ } }
  return 'arcbang.xyz';
}
function registerMessage(addr) {
  const a = normAddr(addr);
  if (!a) return null;
  return 'ARCBANG allowlist registration\n'
    + 'domain: ' + domain() + '\n'
    + 'address: ' + a + '\n'
    + 'Signing this costs no gas and moves no funds.';
}

/* ================================================================ 工厂 */
function create(opts) {
  const o = opts || {};
  const storeDir = o.storeDir || path.join(__dirname, '.store');
  const listFile = o.listFile || path.join(storeDir, 'allowlist.json');
  const appliedFile = o.appliedFile || path.join(storeDir, 'allowlist-applied.jsonl');
  const stateFile = o.stateFile || path.join(storeDir, 'allowlist-state.json');
  const take = o.take;                    // ratelimit.take(key, limit, windowMs)
  /** 读链上免费余量（枚）。index.js 传进来，返回 BigInt/Number 或 null（读不到）。 */
  const readFreeLeft = typeof o.freeLeft === 'function' ? o.freeLeft : null;

  /* ---------------------------------------------------------------- 名单文件
     按 mtime 失效：命令行工具改完文件，跑着的服务端下一次请求就看得到，不用重启。 */
  const EMPTY_LIST = () => ({ mtimeMs: -1, size: -1, map: new Map(), frozen: false, frozenAt: null });
  let listCache = EMPTY_LIST();

  function parseList(text) {
    const map = new Map();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { return { map, frozen: false, frozenAt: null }; }
    /* 两种写法都认：老式的纯地址数组（一律当 fcfs），和带 tier 的对象数组。 */
    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.addresses) ? j.addresses : []);
    for (const row of arr) {
      const addr = normAddr(typeof row === 'string' ? row : (row && row.addr));
      if (!addr) continue;
      const obj = row && typeof row === 'object' ? row : {};
      const tier = normTier(obj.tier) || 'fcfs';
      /* 同一个地址出现两次：gtd 赢。名单是给人发好处的，两条冲突时给高的那一层。 */
      const old = map.get(addr);
      if (old && old.tier === 'gtd') continue;
      map.set(addr, { addr, tier, src: obj.src || null, at: obj.at || null });
    }
    return { map, frozen: !Array.isArray(j) && !!(j && j.frozen), frozenAt: (j && j.frozenAt) || null };
  }

  function list() {
    let st = null;
    try { st = fs.statSync(listFile); } catch (e) { /* 还没有名单文件 */ }
    if (!st) { if (listCache.mtimeMs !== -1) listCache = EMPTY_LIST(); return listCache; }
    if (st.mtimeMs === listCache.mtimeMs && st.size === listCache.size) return listCache;
    let r = { map: new Map(), frozen: false, frozenAt: null };
    try { r = parseList(fs.readFileSync(listFile, 'utf8')); }
    catch (e) { console.error('[allowlist] 名单读不出来：' + (e && e.message)); }
    listCache = { mtimeMs: st.mtimeMs, size: st.size, map: r.map, frozen: r.frozen, frozenAt: r.frozenAt };
    boardCache = null;                        // 名单一变，tier 跟着变
    return listCache;
  }
  function isFrozen() { return list().frozen; }

  /* ---------------------------------------------------------------- 登记流水 */
  let applied = null;              // Map(addr → rec)
  let byCode = null;               // Map(code → [addr, …])，同码多地址的极小概率也要认得出来
  function loadApplied() {
    if (applied) return applied;
    applied = new Map();
    byCode = new Map();
    try {
      for (const line of fs.readFileSync(appliedFile, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const a = normAddr(j && j.addr);
          if (!a) continue;
          /* 码不从盘上读，**现算**：盐没变就一定算得出同一个值，
             盐变了就以新的为准（老码作废，这本来就是换盐的含义）。 */
          const rec = {
            addr: a,
            x: normX(j.x),
            ref: normCode(j.ref),
            inviter: normAddr(j.inviter),
            ip: j.ip || null,
            at: j.at || null,
            code: codeOf(a)
          };
          applied.set(a, rec);
          if (!byCode.has(rec.code)) byCode.set(rec.code, []);
          byCode.get(rec.code).push(a);
        } catch (e) { /* 坏行跳过 */ }
      }
    } catch (e) { /* 还没有文件 */ }
    return applied;
  }
  function appliedCount() { return loadApplied().size; }
  function appliedOf(addr) { const a = normAddr(addr); return a ? loadApplied().get(a) || null : null; }
  /** 码 → 地址。同一个码撞上两个地址（36^6 里的极小概率）时返回 null 并喊一声，
      宁可让管理员手输地址，也不能把名额发错人。 */
  function addrOfCode(codeRaw) {
    const c = normCode(codeRaw);
    if (!c) return null;
    loadApplied();
    const hit = byCode.get(c) || [];
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) console.error('[allowlist] 登记码撞车：' + c + ' → ' + hit.join(' / ') + '，请按地址操作');
    return null;
  }

  /* ---------------------------------------------------------------- 会变的那一半
     verified：转发勾（管理员人工核过 X 评论）。shares：每个地址记过分的那些天。
     单独一个文件，不跟追加式流水混：这两样都会被改写，而流水必须只追加。 */
  let stateCache = null;             // { mtimeMs, size, verified:Map, shares:Map }
  const EMPTY_STATE = () => ({ mtimeMs: -1, size: -1, verified: new Map(), shares: new Map() });
  function state() {
    let st = null;
    try { st = fs.statSync(stateFile); } catch (e) { /* 还没有 */ }
    if (!st) { if (!stateCache || stateCache.mtimeMs !== -1) stateCache = EMPTY_STATE(); return stateCache; }
    if (stateCache && st.mtimeMs === stateCache.mtimeMs && st.size === stateCache.size) return stateCache;
    const next = EMPTY_STATE();
    try {
      const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      for (const k in (j && j.verified) || {}) {
        const a = normAddr(k);
        if (a) next.verified.set(a, j.verified[k] || true);
      }
      for (const k in (j && j.shares) || {}) {
        const a = normAddr(k);
        if (!a) continue;
        const days = Array.isArray(j.shares[k]) ? j.shares[k].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
        if (days.length) next.shares.set(a, Array.from(new Set(days)).sort());
      }
    } catch (e) { console.error('[allowlist] 状态文件读不出来：' + (e && e.message)); }
    next.mtimeMs = st.mtimeMs; next.size = st.size;
    stateCache = next;
    boardCache = null;
    return stateCache;
  }
  function saveState(s) {
    const verified = {}, shares = {};
    for (const [k, v] of s.verified) verified[k] = v;
    for (const [k, v] of s.shares) shares[k] = v;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    writeAtomic(stateFile, JSON.stringify({ updatedAt: new Date().toISOString(), verified, shares }, null, 2) + '\n');
    stateCache = null;              // 强制下次重读（mtime 立刻就变了，但别赌这个）
    boardCache = null;
  }
  function isVerified(addr) { const a = normAddr(addr); return !!a && state().verified.has(a); }
  function shareDaysOf(addr) { const a = normAddr(addr); const d = a ? state().shares.get(a) : null; return d ? d.length : 0; }

  /* ---------------------------------------------------------------- 积分与榜
     榜是全量重算（O(登记数)），预热页会被很多人同时刷，所以缓存 30 秒；
     任何一次写（登记 / verify / share / 改名单）都把它置空。 */
  let boardCache = null;             // { at, rows, byAddr:Map(addr→row) }

  /** 有效邀请人数（**未封顶**的原始数）：被邀请人必须已经 verify 过。 */
  function validInviteCount(addr) {
    const a = normAddr(addr);
    if (!a) return 0;
    let n = 0;
    for (const rec of loadApplied().values()) {
      if (rec.inviter !== a) continue;
      if (isVerified(rec.addr)) n++;
    }
    return n;
  }
  function inviteCount(addr) {
    const a = normAddr(addr);
    if (!a) return 0;
    let n = 0;
    for (const rec of loadApplied().values()) if (rec.inviter === a) n++;
    return n;
  }

  /**
   * 一个地址的积分明细。没登记过的一律 0 分、不上榜 ——
   * 登记是入场券，不登记就没有「你」这个条目。
   */
  function scoreOf(addrRaw) {
    const a = normAddr(addrRaw);
    const P = pointsTable();
    const zero = {
      registered: false, verified: false,
      invites: 0, validInvites: 0, countedInvites: 0, shareDays: 0, countedShareDays: 0,
      pts: { register: 0, repost: 0, invite: 0, share: 0 }, total: 0
    };
    if (!a || !loadApplied().has(a)) return zero;
    const verified = isVerified(a);
    const invites = inviteCount(a);
    const valid = validInviteCount(a);
    const countedInv = Math.min(valid, P.inviteMax);
    const days = shareDaysOf(a);
    const countedDays = Math.min(days, P.shareMaxDays);
    const pts = {
      register: P.register,
      repost: verified ? P.repost : 0,
      invite: countedInv * P.invite,
      share: countedDays * P.share
    };
    return {
      registered: true, verified,
      invites, validInvites: valid, countedInvites: countedInv,
      shareDays: days, countedShareDays: countedDays,
      pts, total: pts.register + pts.repost + pts.invite + pts.share
    };
  }

  /** 全榜。排序：积分降序 → 登记时间升序 → 地址升序（保证同分同时刻也稳定）。 */
  function board(now) {
    const t = now == null ? Date.now() : now;
    if (boardCache && t - boardCache.at < BOARD_TTL_MS) return boardCache;
    const rows = [];
    for (const rec of loadApplied().values()) {
      const s = scoreOf(rec.addr);
      rows.push({
        addr: rec.addr, short: shortAddr(rec.addr), at: rec.at || '9999',
        points: s.total, verified: s.verified,
        validInvites: s.validInvites, shareDays: s.shareDays, score: s
      });
    }
    rows.sort((x, y) => (y.points - x.points)
      || (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)
      || (x.addr < y.addr ? -1 : 1));
    const byAddr = new Map();
    rows.forEach((r, i) => { r.rank = i + 1; byAddr.set(r.addr, r); });
    boardCache = { at: t, rows, byAddr };
    return boardCache;
  }
  function rankOf(addr) {
    const a = normAddr(addr);
    if (!a) return null;
    const r = board().byAddr.get(a);
    return r ? r.rank : null;
  }
  /** 榜的前 n 名，只给缩写 —— 名次和分数是规则的一部分，完整地址不是。
      n 再大也不会越过 BOARD_PUBLIC_MAX：公开的榜只到前 100 名。 */
  function topRows(n) {
    const lim = Math.max(1, Math.min(Math.floor(Number(n)) || 50, BOARD_PUBLIC_MAX));
    const T = tops();
    const frozen = isFrozen();
    /* tier **只在定格之后才出门**：定格之前，某一行是 gtd 还是 fcfs 等于
       把名额分界线画在榜上，而那个数我们还没答应下来（用户拍板不承诺名额）。 */
    return board().rows.slice(0, lim).map((r) => ({
      rank: r.rank, addr: r.short, points: r.points, verified: r.verified,
      tier: frozen ? (r.rank <= T.gtd ? 'gtd' : r.rank <= T.free ? 'fcfs' : null) : null
    }));
  }

  /**
   * 这个地址在名单里的层：'gtd' / 'fcfs' / null。
   *   · allowlist.json 里的条目**永远赢**（人工覆盖，定格没定格都算）；
   *   · 已定格 → 只认那个文件；
   *   · 没定格 → 按当下的榜实时算。
   */
  function tierOf(addr) {
    const a = normAddr(addr);
    if (!a) return null;
    const L = list();
    const row = L.map.get(a);
    if (row) return row.tier;
    if (L.frozen) return null;                 // 定格之后榜不再决定名单
    const r = board().byAddr.get(a);
    if (!r) return null;
    const T = tops();
    return r.rank <= T.gtd ? 'gtd' : r.rank <= T.free ? 'fcfs' : null;
  }
  /** 两档人数。定格后数文件，没定格就按榜和名额算（人工覆盖并进来去重）。
      **这是给管理员和命令行看的那一份**，带 gtdTop / freeTop。
      对外要走 publicCounts()：名额数量在定格公布之前不出门。 */
  function counts() {
    const L = list();
    const T = tops();
    const seen = new Map();
    for (const [a, row] of L.map) seen.set(a, row.tier);
    if (!L.frozen) {
      const rows = board().rows;
      for (let i = 0; i < rows.length && i < T.free; i++) {
        if (seen.has(rows[i].addr)) continue;
        seen.set(rows[i].addr, i < T.gtd ? 'gtd' : 'fcfs');
      }
    }
    let gtd = 0, fcfs = 0;
    for (const v of seen.values()) { if (v === 'gtd') gtd++; else fcfs++; }
    return { gtd, fcfs, total: gtd + fcfs, frozen: L.frozen, gtdTop: T.gtd, freeTop: T.free };
  }

  /**
   * 对外的那一份人数。2026-09-18 用户拍板：**不承诺具体名额**。
   *   定格之前 —— 名额数量一个都不给（gtd / fcfs / total / 上限全是 null）。
   *     不这么做的话：ARCBANG_GTD_TOP 会从「前 100 名是保底」这句话里被反推出来，
   *     而那正是我们还没答应下来的东西。榜大于名额时人数本身就是名额。
   *   定格之后 —— 数字已经公布了，照实给。
   * 合约那个 387 是硬上限，它写在合约里、公开可查，所以它不算「承诺」，可以说。
   */
  function publicCounts() {
    const c = counts();
    if (!c.frozen) return { frozen: false, gtd: null, fcfs: null, total: null, gtdTop: null, freeTop: null };
    return { frozen: true, gtd: c.gtd, fcfs: c.fcfs, total: c.total, gtdTop: c.gtdTop, freeTop: c.freeTop };
  }

  /** 离榜上上一名差几分（同分也算 0 —— 同分时先登记的在前，追平还不够，但那一句由页面说）。 */
  function gapToPrev(addrRaw) {
    const a = normAddr(addrRaw);
    if (!a) return null;
    const b = board();
    const me = b.byAddr.get(a);
    if (!me || me.rank <= 1) return 0;
    return Math.max(0, b.rows[me.rank - 2].points - me.points);
  }

  /** 离上一档还差几分。已经在档里回 0；档还没坐满也回 0（现在就够）。 */
  function gapTo(addrRaw, slot) {
    const a = normAddr(addrRaw);
    const b = board();
    const mine = a ? b.byAddr.get(a) : null;
    const my = mine ? mine.points : 0;
    if (mine && mine.rank <= slot) return 0;
    if (b.rows.length < slot) return 0;                 // 名额还没坐满：进去不用加分
    /* 第 slot 名的分数。同分时先登记的在前，所以要**超过**它才挤得进去 —— 差 +1。 */
    const edge = b.rows[slot - 1].points;
    return Math.max(0, edge - my + 1);
  }

  /** 下一步该做什么（给页面上那句「接下来」用）。按四项任务的顺序给第一个没做完的。 */
  function nextStep(addrRaw) {
    const s = scoreOf(addrRaw);
    const P = pointsTable();
    if (!s.registered) return { key: 'register', pts: P.register };
    if (!s.verified) return { key: 'repost', pts: P.repost };
    if (s.validInvites < P.inviteMax) return { key: 'invite', pts: P.invite };
    if (s.shareDays < P.shareMaxDays) return { key: 'share', pts: P.share };
    return { key: 'done', pts: 0 };
  }

  /* ---------------------------------------------------------------- 名单增删（人工覆盖） */
  function saveMap(map, frozen, frozenAt) {
    const addresses = [];
    for (const v of map.values()) addresses.push({ addr: v.addr, tier: v.tier, src: v.src || null, at: v.at || null });
    addresses.sort((a, b) => (a.tier === b.tier ? (a.addr < b.addr ? -1 : 1) : (a.tier === 'gtd' ? -1 : 1)));
    fs.mkdirSync(path.dirname(listFile), { recursive: true });
    writeAtomic(listFile, JSON.stringify({
      updatedAt: new Date().toISOString(),
      frozen: !!frozen, frozenAt: frozenAt || null,
      addresses
    }, null, 2) + '\n');
    listCache = EMPTY_LIST();           // 强制下次重读
    boardCache = null;
  }
  /** @returns {{added:number, upgraded:number, skipped:number, bad:string[]}} */
  function addAddresses(addrs, tier, src) {
    const t = normTier(tier) || 'fcfs';
    const L = list();
    const map = new Map(L.map);
    const at = new Date().toISOString();
    let added = 0, upgraded = 0, skipped = 0;
    const bad = [];
    for (const raw of addrs || []) {
      const a = normAddr(raw);
      if (!a) { bad.push(String(raw)); continue; }
      const old = map.get(a);
      if (!old) { map.set(a, { addr: a, tier: t, src: src || null, at }); added++; continue; }
      if (old.tier !== t) { map.set(a, { addr: a, tier: t, src: src || old.src || null, at: old.at || at }); upgraded++; continue; }
      skipped++;
    }
    saveMap(map, L.frozen, L.frozenAt);
    return { added, upgraded, skipped, bad };
  }
  function removeAddresses(addrs) {
    const L = list();
    const map = new Map(L.map);
    let removed = 0;
    const bad = [];
    for (const raw of addrs || []) {
      const a = normAddr(raw);
      if (!a) { bad.push(String(raw)); continue; }
      if (map.delete(a)) removed++;
    }
    saveMap(map, L.frozen, L.frozenAt);
    return { removed, bad };
  }
  /** 人工把某个地址钉在某一层（榜算出来什么都不管）。 */
  function setTier(addrRaw, tierRaw) {
    const a = normAddr(addrRaw);
    const t = normTier(tierRaw);
    if (!a) return { ok: false, error: '地址不合法' };
    if (!t) return { ok: false, error: '层只能是 gtd 或 fcfs' };
    const r = addAddresses([a], t, '手工');
    return { ok: true, addr: a, tier: t, added: r.added, upgraded: r.upgraded };
  }

  /**
   * **定格**：把当下的榜按名额写进 allowlist.json，并打上 frozen。
   * 进 gtd 段之前必须跑一次 —— 不定格的话名单会随积分实时变，
   * 有人可能铸到一半被后来者挤出名单，那是不可解释的。
   * 已有的人工覆盖条目原样保留（它们永远赢）。
   */
  function freeze(now) {
    const L = list();
    const T = tops();
    const map = new Map(L.map);                 // 人工覆盖先占位
    const rows = board(now).rows;
    for (let i = 0; i < rows.length && i < T.free; i++) {
      const a = rows[i].addr;
      if (map.has(a)) continue;                 // 人工的那条赢
      map.set(a, { addr: a, tier: i < T.gtd ? 'gtd' : 'fcfs', src: 'board', at: rows[i].at });
    }
    const at = new Date(now == null ? Date.now() : now).toISOString();
    saveMap(map, true, at);
    const c = counts();
    return { ok: true, frozenAt: at, gtd: c.gtd, fcfs: c.fcfs, total: c.total, fromBoard: Math.min(rows.length, T.free) };
  }
  /** 解冻（写错了要重来）。名单条目原样留着，只是榜重新开始生效。 */
  function unfreeze() {
    const L = list();
    saveMap(new Map(L.map), false, null);
    return { ok: true };
  }

  /**
   * **verify**：管理员核对完 X 上的评论，给这个地址打转发勾（+ARCBANG_PTS_REPOST 分）。
   * 它**不直接进名单** —— 名单是榜算出来的。收登记码或地址。
   * （旧名 approve 语义已改，命令行保留同名别名指向这里。）
   */
  function verify(token) {
    const byAddr = normAddr(token);
    const a = byAddr || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址（码撞车时请直接用地址）' };
    const ap = appliedOf(a);
    if (!ap) return { ok: false, error: '这个地址没有登记过：' + a };
    const s = state();
    if (s.verified.has(a)) return { ok: true, already: true, addr: a, code: ap.code, x: ap.x };
    const next = { verified: new Map(s.verified), shares: new Map(s.shares) };
    next.verified.set(a, new Date().toISOString());
    saveState(next);
    return { ok: true, addr: a, code: ap.code, x: ap.x, points: scoreOf(a).total };
  }
  /** 撤销转发勾（核错了）。 */
  function unverify(token) {
    const a = normAddr(token) || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址' };
    const s = state();
    if (!s.verified.has(a)) return { ok: true, already: true, addr: a };
    const next = { verified: new Map(s.verified), shares: new Map(s.shares) };
    next.verified.delete(a);
    saveState(next);
    return { ok: true, addr: a };
  }

  /* ---------------------------------------------------------------- 接口：登记 */
  /**
   * POST /api/allowlist/register
   * 登记 = 上榜 + 拿登记码 + 得 ARCBANG_PTS_REGISTER 分。名单由榜算，这里不发名额。
   * @returns {{status:number, body:object}}
   */
  function register(input, ip) {
    const b = input && typeof input === 'object' ? input : {};
    const addr = normAddr(b.address);
    if (!addr) return { status: 400, body: { error: '地址不对（要 0x 开头的 40 位十六进制，且不能是零地址）' } };
    const x = normX(b.xHandle);
    if (!x) return { status: 400, body: { error: 'X 用户名不对（1–15 位字母、数字或下划线）' } };
    const sig = String(b.sig == null ? '' : b.sig).trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return { status: 400, body: { error: '签名格式不对（要 65 字节的 0x 串）' } };

    /* 邀请码可选。空串 / 认不出的码一律**当没带**（不是报错）——
       别让一个抄错的码把人挡在登记之外。但自己邀自己要明说，那是在刷数。 */
    const ref = normCode(b.ref);
    const myCode = codeOf(addr);
    if (ref && ref === myCode) return { status: 400, body: { error: '不能用自己的邀请码' } };
    const inviter = ref ? addrOfCode(ref) : null;
    if (inviter && inviter === addr) return { status: 400, body: { error: '不能邀请自己' } };

    /* 先验签再限流：验签不花钱也不写盘，而「签名错了」要立刻告诉人，
       不该先扣掉他一次每日额度。 */
    let who = null;
    try { who = verifyMessage(registerMessage(addr), sig); }
    catch (e) { return { status: 400, body: { error: '签名验不过，换个钱包重签一次' } }; }
    if (String(who).toLowerCase() !== addr) {
      return { status: 400, body: { error: '签名是另一个地址签的，和你填的地址对不上' } };
    }

    const seen = loadApplied();
    const old = seen.get(addr);
    if (old) return { status: 200, body: { ok: true, already: true, code: old.code, points: scoreOf(addr).total } };

    if (typeof take === 'function') {
      const r = take('alreg:' + (ip || '?'), REGISTER_PER_IP_DAY, DAY);
      if (r && r.ok === false) {
        return { status: 429, body: { error: '这个网络今天登记的地址已到上限（每天 ' + REGISTER_PER_IP_DAY + ' 个），明天再来', resetAt: r.resetAt } };
      }
    }
    if (seen.size >= MAX_APPLIED) return { status: 503, body: { error: '登记通道暂时满了，稍后再试' } };

    /* IP 只留前缀 —— 审核时看得出「同一个网段一口气登记 20 个」，又不是完整地址。 */
    const rec = { addr, x, ref: ref || null, inviter: inviter || null, ip: ipPrefix(ip), at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(appliedFile), { recursive: true });
      fs.appendFileSync(appliedFile, JSON.stringify(rec) + '\n');
    } catch (e) {
      console.error('[allowlist] 登记写不下去：' + (e && e.message));
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    seen.set(addr, Object.assign({ code: myCode }, rec));
    if (!byCode.has(myCode)) byCode.set(myCode, []);
    byCode.get(myCode).push(addr);
    boardCache = null;
    return { status: 200, body: { ok: true, code: myCode, points: scoreOf(addr).total, pinnedPost: pinnedPost() } };
  }

  /**
   * POST /api/allowlist/share {address, sig, hash}
   * 站内「广播」按钮生成分享链接时打一发。**同一地址同一天只记一次**（UTC 日）。
   *
   * sig 是登记时那一次签名（同一句 registerMessage），浏览器留在 localStorage 里复用 ——
   * 用户拍板「别每次弹钱包」。重放它最多能给签名者自己记一次分，而一天只记一次，
   * 所以它不需要 nonce，也不需要服务端发令牌。
   *
   * 没登记过的地址直接 403：登记是入场券，不登记连条目都没有。
   */
  function share(input, ip, now) {
    const b = input && typeof input === 'object' ? input : {};
    const addr = normAddr(b.address);
    if (!addr) return { status: 400, body: { error: '地址不对' } };
    const hash = String(b.hash == null ? '' : b.hash).trim();
    if (!HASH_RE.test(hash)) return { status: 400, body: { error: '要给被分享的区块哈希' } };
    const sig = String(b.sig == null ? '' : b.sig).trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return { status: 400, body: { error: '签名格式不对' } };
    let who = null;
    try { who = verifyMessage(registerMessage(addr), sig); }
    catch (e) { return { status: 400, body: { error: '签名验不过' } }; }
    if (String(who).toLowerCase() !== addr) return { status: 400, body: { error: '签名和地址对不上' } };
    if (!loadApplied().has(addr)) return { status: 403, body: { error: '这个地址还没登记，先去登记白名单' } };

    const P = pointsTable();
    const day = dayOf(now);
    const s = state();
    const days = (s.shares.get(addr) || []).slice();
    if (days.indexOf(day) >= 0) {
      return { status: 200, body: { ok: true, already: true, day, shareDays: days.length, points: scoreOf(addr).total } };
    }
    /* 到顶之后就不再写盘了：写下去也不加分，只是让文件白白变长。 */
    if (days.length >= P.shareMaxDays) {
      return { status: 200, body: { ok: true, capped: true, day, shareDays: days.length, points: scoreOf(addr).total } };
    }
    days.push(day);
    days.sort();
    const next = { verified: new Map(s.verified), shares: new Map(s.shares) };
    next.shares.set(addr, days);
    try { saveState(next); }
    catch (e) {
      console.error('[allowlist] 分享记不下去：' + (e && e.message));
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    return { status: 200, body: { ok: true, day, shareDays: days.length, points: scoreOf(addr).total } };
  }

  /* ---------------------------------------------------------------- 导出（管理员） */
  function appliedRows() {
    return Array.from(loadApplied().values()).map((r) => {
      const s = scoreOf(r.addr);
      return Object.assign({}, r, {
        verified: s.verified,
        invites: s.invites,
        validInvites: s.validInvites,
        shareDays: s.shareDays,
        points: s.total,
        rank: rankOf(r.addr),
        tier: tierOf(r.addr)
      });
    });
  }
  /** 每个字段都受正则约束，里面不会出现逗号。 */
  function appliedCsv() {
    const rows = appliedRows().sort((a, b) => (b.points - a.points) || (String(a.at) < String(b.at) ? -1 : 1));
    const head = 'rank,address,code,x,points,verified,ref,inviter,invites,valid_invites,share_days,tier,ip_prefix,at\n';
    return head + rows.map((r) => [
      r.rank == null ? '' : r.rank, r.addr, r.code, r.x || '', r.points, r.verified ? '1' : '0',
      r.ref || '', r.inviter || '', r.invites, r.validInvites, r.shareDays,
      r.tier || '', r.ip || '', r.at || ''
    ].join(',')).join('\n') + (rows.length ? '\n' : '');
  }

  /* ---------------------------------------------------------------- 状态 */
  /**
   * GET /api/allowlist/status?addr=
   * 榜和名额是公开规则；**积分明细、登记码、下一步只对查询的那个地址自己说**。
   */
  async function status(addrRaw, now) {
    const p = phaseAt(now);
    const addr = normAddr(addrRaw);
    const s = scoreOf(addr);
    const T = tops();
    let freeLeft = null;
    if (readFreeLeft) {
      try { const v = await readFreeLeft(); freeLeft = v == null ? null : Number(v); }
      catch (e) { freeLeft = null; }
    }
    return {
      phase: p,
      tier: addr ? tierOf(addr) : null,            // 'gtd' / 'fcfs' / null
      listed: addr ? !!tierOf(addr) : false,
      freeLeft,                                    // 链上还剩几枚免费额度；null = 这一刻读不到
      opens: opensIso(),
      next: nextOpen(now),
      /* **不承诺名额**：定格之前这里的数字全是 null（见 publicCounts 的说明）。 */
      counts: publicCounts(),
      cap: 387,                                    // 合约的硬上限，公开可查，说它不算承诺
      applied: appliedCount(),
      boardSize: board(now).rows.length,
      boardPublicMax: BOARD_PUBLIC_MAX,            // 榜只公布前这么多名
      /* ---- 本人那一份 ---- */
      registered: s.registered,
      verified: s.verified,
      code: addr ? codeOf(addr) : null,            // 登记码 = 邀请码，从地址现算
      points: s.total,
      breakdown: s.pts,                            // {register, repost, invite, share}
      invites: s.invites,
      validInvites: s.validInvites,
      countedInvites: s.countedInvites,
      shareDays: s.shareDays,
      countedShareDays: s.countedShareDays,
      rank: addr ? rankOf(addr) : null,
      /* 「还差几分」照给 —— 那是**他自己**的进度，不是名额承诺。
         页面上只说「再拿 N 分」，绝不说「进前 X 名」。 */
      gapToGtd: addr ? gapTo(addr, T.gtd) : null,
      gapToFree: addr ? gapTo(addr, T.free) : null,
      gapToPrev: addr ? gapToPrev(addr) : null,
      nextStep: addr ? nextStep(addr) : null,
      pts: pointsTable(),                          // 分值表：页面上任务清单标的分值来自它
      frozen: isFrozen(),
      pinnedPost: pinnedPost(),
      message: addr ? registerMessage(addr) : null,  // 要签的那句话，客户端原样签
      domain: domain()
    };
  }
  /** GET /api/allowlist/board?top=100 —— 公开榜，**只到前 100 名**，
      名额数量定格之前不出门（见 publicCounts / topRows 的说明）。 */
  function boardView(top) {
    const c = publicCounts();
    return {
      phase: phaseAt(), frozen: c.frozen,
      gtdTop: c.gtdTop, freeTop: c.freeTop, cap: 387, publicMax: BOARD_PUBLIC_MAX,
      total: board().rows.length, pts: pointsTable(), rows: topRows(top)
    };
  }

  /* ---------------------------------------------------------------- /api/bang 的闸 */
  /**
   * 只看阶段与名单的那一半判断，**一次链上读都不做**。
   * 拆出来是为了让 /api/bang 能在**打 RPC 取区块、算卡**之前就把「还没开」「不在名单」
   * 挡掉：预热期每个点击都白算一张卡的话，预热本身就成了免费的算力消耗接口。
   * @returns 拒绝理由对象，或 null（= 这一关过了，接着去定 free）
   */
  function denyReason(minter, now) {
    const p = phaseAt(now);
    const o = opensIso();
    const nx = nextOpen(now);
    const when = (iso) => (iso ? '（' + iso + '）' : '（时间待定，看站上的倒计时）');

    if (p === 'warmup') {
      return {
        ok: false, status: 403, code: 'WARMUP', phase: p, opens: o, next: nx,
        error: '铸造还没开。保底期' + when(o.gtd) + '开，先到先得期' + when(o.fcfs)
          + '开，公售' + when(o.public) + '开。现在可以先去攒积分（登记 / 转发 / 邀请 / 分享），'
          + '名单按积分榜排；引爆和模拟器随时都能玩。'
      };
    }
    const tier = tierOf(minter);
    if (p === 'gtd' && tier !== 'gtd') {
      return {
        ok: false, status: 403, code: 'NOT_GTD', phase: p, opens: o, next: nx,
        /* 话里**不报具体名额**（用户拍板不承诺）：只说「榜首若干名」。 */
        error: (tier ? '你在白名单里，但现在是保底期（积分榜榜首若干名）。先到先得期' + when(o.fcfs) + '开。'
          : '你不在白名单里。先到先得期' + when(o.fcfs) + '开，公售' + when(o.public) + '开。')
      };
    }
    if (p === 'fcfs' && !tier) {
      return {
        ok: false, status: 403, code: 'NOT_LISTED', phase: p, opens: o, next: nx,
        error: '你不在白名单里（名单取积分榜前列，定格时已公布）。公售' + when(o.public) + '开，到时候人人都能铸。'
      };
    }
    return null;
  }

  async function gate(minter, readChainFree, now) {
    const deny = denyReason(minter, now);
    if (deny) return deny;
    const p = phaseAt(now);
    const tier = tierOf(minter);
    /* public 段的路人：一律付费，**根本不必问链** —— 那 387 枚免费额度是留给名单的，
       不该被公售的人先抢走，所以这里连「还剩几枚」都不需要知道。 */
    if (p === 'public' && !tier) return { ok: true, free: false, phase: p };
    return freeOrPaid(p, readChainFree, p === 'public');
  }

  /** 名单里的人到底签 free=true 还是 false，取决于链上还给不给。 */
  async function freeOrPaid(p, readChainFree, allowPaidFallback) {
    let chainFree = null;
    if (typeof readChainFree === 'function') {
      try { chainFree = await readChainFree(); } catch (e) { chainFree = null; }
    }
    if (chainFree === null) {
      /* 判不了就**关闸**，不放行。宁可让真人过一分钟再点一次，
         也不能在 RPC 抖动的那几秒里把免费额度签出去 —— 上一次就是这么丢的。 */
      return {
        ok: false, status: 503, code: 'CHAIN_DOWN', phase: p,
        error: '链上节点这一刻打不通，免费额度核对不了，请过一分钟再试。'
      };
    }
    if (chainFree === true) return { ok: true, free: true, phase: p };
    /* 免费额度用完了（或这个地址已经用过一次）：退回按付费签。
       名单的意义是「能铸」，免费只是先到先得的那 387 枚，抢完就没了 —— 预热页上写着这句。 */
    return { ok: true, free: false, phase: p, freeGone: true, paidFallback: !!allowPaidFallback };
  }

  return {
    // 阶段
    phase: phaseAt, nextOpen, opens: opensIso, pinnedPost, PHASES, TIERS,
    // 积分与榜
    scoreOf, board, rankOf, topRows, boardView, gapTo, gapToPrev, nextStep,
    pointsTable, tops, inviteCount, validInviteCount, shareDaysOf, isVerified,
    // 名单
    tierOf, counts, publicCounts, isFrozen, freeze, unfreeze,
    addAddresses, removeAddresses, setTier, listFile, appliedFile, stateFile,
    // 登记 / 核验 / 分享
    register, share, verify, unverify, registerMessage, codeOf, addrOfCode, appliedOf,
    appliedCount, appliedRows, appliedCsv, domain,
    // 接口
    status, gate, denyReason,
    // 自检要用的：改完盘上的文件强制重读
    _reload: () => { listCache = EMPTY_LIST(); stateCache = null; applied = null; byCode = null; boardCache = null; }
  };
}

module.exports = {
  create, PHASES, TIERS, registerMessage, domain, codeOf, pinnedPost,
  phaseAt, nextOpen, opensIso, ipPrefix, pointsTable, tops, shortAddr, dayOf,
  REGISTER_PER_IP_DAY, CODE_RE, BOARD_TTL_MS, BOARD_PUBLIC_MAX,
  _normAddr: normAddr, _normTier: normTier, _normX: normX, _normCode: normCode
};
