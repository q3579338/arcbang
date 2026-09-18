/*
 * 白名单、分期、登记码与邀请 —— 谁能铸、什么时候能铸、免不免费
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
 * 四个阶段（ARCBANG_PHASE，默认 warmup）与两层名单（tier）
 *
 *   warmup    预热。**一张铸造签名都不签**，页面只有倒计时和登记入口。
 *   gtd       保底期。只有 tier='gtd' 的地址能铸，且走免费额度。
 *             「保底」= 名额给定了，不跟人抢。
 *   fcfs      先到先得期。gtd 与 fcfs 两层都能铸，都走免费额度，
 *             抢到合约的 freeCap（387 枚）用完为止 —— 之后名单里的人也只能付费。
 *   public    公售。谁都能铸，默认付费（1 USDC，每地址最多 3 枚）。
 *             名单里还没用掉免费额度的人仍然签 free=true，直到 freeCap 用完。
 *
 *   **谁是 gtd 不对外公开**（用户拍板）：/api/allowlist/status 只对**查询的那个地址自己**
 *   回 tier，页面文案一律说「保底期 / 先到先得期 / 公售」，除人数外不给任何名单内容。
 *
 * 到点自动切段：ARCBANG_GTD_OPEN_AT / ARCBANG_FCFS_OPEN_AT / ARCBANG_PUBLIC_OPEN_AT
 *   （ISO 时间，可选）。规则是**只前进不后退** —— 时间到了就往后推一段，
 *   但不会把 ARCBANG_PHASE 已经手动推到的段拉回来。
 *
 * ---------------------------------------------------------------------------
 * 登记码（2026-09-18 用户拍板：不买 X API，人工/半自动比对）
 *
 *   登记成功后给这个地址一个 **6 位大写字母数字**的码，
 *   由 HMAC(盐, 地址) 派生 —— 所以它**可复现**：盘上丢了也能重算，
 *   服务端不必再存一张码表，人工比对时也能从地址现场算出来对。
 *   盐在 ARCBANG_ALLOWLIST_SALT。**换盐等于把所有已发出去的码作废**，别在活动中途换。
 *
 *   任务是「转发置顶推 + 回复自己的登记码」。置顶推的链接在 ARCBANG_PINNED_POST_URL，
 *   没配就只显示码和说明（页面不会挂掉）。审核时把 X 那边的评论和
 *   /api/allowlist/applied 的 CSV 对一遍，通过的跑 `approve <码>`。
 *
 * ---------------------------------------------------------------------------
 * 邀请（登记码兼作邀请码）
 *
 *   登记时可以带 ref=<别人的码>，记下 inviter。**有效邀请 = 被邀请人已被 approve 进名单**
 *   —— 光登记不算数，否则一个人自己造两百个地址就能刷出保底名额。
 *   自己邀自己直接拒（码和地址是一一对应的，认得出来）。
 *
 *   有效邀请数 ≥ ARCBANG_GTD_INVITES（默认 5）→ **自动升 tier=gtd**。
 *   管理员可以用命令行 `tier <地址> gtd|fcfs` 钉死（写 tierLocked），钉死后不再自动变。
 *
 *   fcfs 段内的排位 rank：有效邀请数降序，其次登记时间升序。它只是给人看的名次，
 *   不改变任何签名规则 —— 免费额度仍然是先到先得，抢完为止。
 *
 * ---------------------------------------------------------------------------
 * 两份盘上的文件（都在 .store/）
 *   allowlist.json          审核**通过**的名单，是唯一算数的那一份。
 *                           { updatedAt, addresses: [{ addr, tier, tierLocked?, src, at }] }
 *                           也认老式的纯地址数组（一律当 tier='fcfs'）。
 *   allowlist-applied.jsonl 登记流水，一行一条 { addr, x, code, ref, inviter, ip, at }。
 *                           **它不是名单** —— 登记只是排队，approve 之后才算数。
 *
 * 环境变量每次调用现读：自检要在同一个进程里把四个阶段各跑一遍。
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
/** 自动升保底层要几个有效邀请 */
function gtdInvites() {
  const n = Math.floor(Number(process.env.ARCBANG_GTD_INVITES));
  return Number.isFinite(n) && n > 0 ? n : 5;
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
   HMAC(盐, 小写地址) 取前 30 bit，按 36 进制铺成 6 位。
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

/* ---------------------------------------------------------------- 登记要签的那句话
   固定文案，含域名与地址：
     · 含域名 —— 在 A 站骗到的签名拿不到 B 站来用；
     · 含地址 —— 签名本身就说清楚「我是这个地址」，服务端 verifyMessage 回来对得上才算；
     · 不含 nonce —— 这不是登录，重放一次也只是重复登记同一个地址，去重那一步会挡掉。
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
  const take = o.take;                    // ratelimit.take(key, limit, windowMs)
  /** 读链上免费余量（枚）。index.js 传进来，返回 BigInt/Number 或 null（读不到）。 */
  const readFreeLeft = typeof o.freeLeft === 'function' ? o.freeLeft : null;

  /* 名单缓存：按 mtime 失效。命令行工具改完文件，跑着的服务端下一次请求就看得到，
     不用重启 —— 审核是人工的，每次审完都重启 API 太重了。 */
  const EMPTY = () => ({ mtimeMs: -1, size: -1, map: new Map() });
  let cache = EMPTY();

  function parseList(text) {
    const map = new Map();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { return map; }
    /* 两种写法都认：老式的纯地址数组（一律当 fcfs），和带 tier 的对象数组。 */
    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.addresses) ? j.addresses : []);
    for (const row of arr) {
      const addr = normAddr(typeof row === 'string' ? row : (row && row.addr));
      if (!addr) continue;
      const obj = row && typeof row === 'object' ? row : {};
      const tier = normTier(obj.tier) || 'fcfs';
      /* 同一个地址出现两次：gtd 赢。名单是给人发好处的，两条冲突时给高的那一层，
         不然「先写 fcfs 后补 gtd」的顺序会悄悄决定结果。 */
      const old = map.get(addr);
      if (old && old.tier === 'gtd') continue;
      map.set(addr, {
        addr, tier,
        tierLocked: obj.tierLocked === true,
        src: obj.src || null,
        at: obj.at || null
      });
    }
    return map;
  }

  function list() {
    let st = null;
    try { st = fs.statSync(listFile); } catch (e) { /* 还没有名单文件 */ }
    if (!st) { if (cache.mtimeMs !== -1) cache = EMPTY(); return cache; }
    if (st.mtimeMs === cache.mtimeMs && st.size === cache.size) return cache;
    let map = new Map();
    try { map = parseList(fs.readFileSync(listFile, 'utf8')); }
    catch (e) { console.error('[allowlist] 名单读不出来：' + (e && e.message)); }
    cache = { mtimeMs: st.mtimeMs, size: st.size, map };
    return cache;
  }

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

  /* ---------------------------------------------------------------- 邀请
     有效邀请 = 被邀请人**已经在 allowlist.json 里**。光登记不算数：
     否则一个人造两百个地址登记一遍就能刷出保底名额，而登记是不花钱的。 */
  function inviteStats(addrRaw) {
    const a = normAddr(addrRaw);
    if (!a) return { invites: 0, validInvites: 0 };
    const listed = list().map;
    let invites = 0, valid = 0;
    for (const rec of loadApplied().values()) {
      if (rec.inviter !== a) continue;
      invites++;
      if (listed.has(rec.addr)) valid++;
    }
    return { invites, validInvites: valid };
  }

  /** 这个地址在名单里的层（**算上自动升级**）：'gtd' / 'fcfs' / null（不在名单里） */
  function tierOf(addr) {
    const a = normAddr(addr);
    if (!a) return null;
    const row = list().map.get(a);
    if (!row) return null;
    if (row.tier === 'gtd') return 'gtd';
    if (row.tierLocked) return row.tier;                 // 管理员钉死过，不再自动变
    return inviteStats(a).validInvites >= gtdInvites() ? 'gtd' : 'fcfs';
  }
  function counts() {
    let gtd = 0, fcfs = 0;
    for (const addr of list().map.keys()) { if (tierOf(addr) === 'gtd') gtd++; else fcfs++; }
    return { gtd, fcfs, total: gtd + fcfs };
  }

  /* 排位：有效邀请数降序，其次登记时间升序（没登记过的排最后）。
     它只是名次，不改签名规则 —— 免费额度仍然先到先得。 */
  function rankTable() {
    const rows = [];
    for (const addr of list().map.keys()) {
      const st = inviteStats(addr);
      const ap = loadApplied().get(addr);
      rows.push({ addr, validInvites: st.validInvites, invites: st.invites, at: (ap && ap.at) || '9999' });
    }
    rows.sort((a, b) => (b.validInvites - a.validInvites) || (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.addr < b.addr ? -1 : 1)));
    return rows;
  }
  function rankOf(addr) {
    const a = normAddr(addr);
    if (!a || !list().map.has(a)) return null;
    const rows = rankTable();
    for (let i = 0; i < rows.length; i++) if (rows[i].addr === a) return i + 1;
    return null;
  }

  /* ---------------------------------------------------------------- 名单增删
     命令行工具（server/tools/allowlist.js）用这几个；接口里**没有**任何一条路能写名单。
     登记接口只往流水里追加，管理员审完才跑命令行。 */
  function saveMap(map) {
    const addresses = [];
    for (const v of map.values()) {
      const row = { addr: v.addr, tier: v.tier, src: v.src || null, at: v.at || null };
      if (v.tierLocked) row.tierLocked = true;
      addresses.push(row);
    }
    addresses.sort((a, b) => (a.tier === b.tier ? (a.addr < b.addr ? -1 : 1) : (a.tier === 'gtd' ? -1 : 1)));
    fs.mkdirSync(path.dirname(listFile), { recursive: true });
    writeAtomic(listFile, JSON.stringify({ updatedAt: new Date().toISOString(), addresses }, null, 2) + '\n');
    cache.mtimeMs = -1;                 // 强制下次重读
  }
  /** @returns {{added:number, upgraded:number, skipped:number, bad:string[]}} */
  function addAddresses(addrs, tier, src, lock) {
    const t = normTier(tier) || 'fcfs';
    const map = new Map(list().map);
    const at = new Date().toISOString();
    let added = 0, upgraded = 0, skipped = 0;
    const bad = [];
    for (const raw of addrs || []) {
      const a = normAddr(raw);
      if (!a) { bad.push(String(raw)); continue; }
      const old = map.get(a);
      if (!old) { map.set(a, { addr: a, tier: t, tierLocked: !!lock, src: src || null, at }); added++; continue; }
      if (old.tier !== t && t === 'gtd') {
        map.set(a, { addr: a, tier: 'gtd', tierLocked: !!lock || old.tierLocked, src: src || old.src || null, at: old.at || at });
        upgraded++; continue;
      }
      if (lock && !old.tierLocked) { map.set(a, Object.assign({}, old, { tier: t, tierLocked: true })); upgraded++; continue; }
      skipped++;
    }
    saveMap(map);
    return { added, upgraded, skipped, bad };
  }
  function removeAddresses(addrs) {
    const map = new Map(list().map);
    let removed = 0;
    const bad = [];
    for (const raw of addrs || []) {
      const a = normAddr(raw);
      if (!a) { bad.push(String(raw)); continue; }
      if (map.delete(a)) removed++;
    }
    saveMap(map);
    return { removed, bad };
  }
  /** 把某个地址的层钉死（管理员覆盖自动升级）。 */
  function setTier(addrRaw, tierRaw) {
    const a = normAddr(addrRaw);
    const t = normTier(tierRaw);
    if (!a) return { ok: false, error: '地址不合法' };
    if (!t) return { ok: false, error: '层只能是 gtd 或 fcfs' };
    const map = new Map(list().map);
    const old = map.get(a);
    if (!old) return { ok: false, error: '这个地址不在名单里，先 add 或 approve' };
    map.set(a, Object.assign({}, old, { tier: t, tierLocked: true }));
    saveMap(map);
    return { ok: true, addr: a, tier: t };
  }
  /** 把一条**登记**移进名单（fcfs）。收登记码或地址。 */
  function approve(token, tierRaw) {
    const byAddr = normAddr(token);
    const a = byAddr || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址（码撞车时请直接用地址）' };
    const ap = appliedOf(a);
    if (!ap) return { ok: false, error: '这个地址没有登记过：' + a };
    if (list().map.has(a)) return { ok: true, already: true, addr: a, code: ap.code };
    const r = addAddresses([a], normTier(tierRaw) || 'fcfs', 'applied');
    return { ok: r.added > 0, addr: a, code: ap.code, x: ap.x, added: r.added };
  }

  /** 管理员导出用的 CSV。每个字段都受正则约束，里面不会出现逗号。 */
  function appliedRows() {
    return Array.from(loadApplied().values()).map((r) => {
      const st = inviteStats(r.addr);
      return Object.assign({}, r, {
        tier: tierOf(r.addr),                 // null = 还没被 approve
        listed: list().map.has(r.addr),
        invites: st.invites,
        validInvites: st.validInvites
      });
    });
  }
  function appliedCsv() {
    const rows = appliedRows();
    const head = 'address,code,x,ref,inviter,invites,valid_invites,listed,tier,ip_prefix,at\n';
    return head + rows.map((r) => [
      r.addr, r.code, r.x || '', r.ref || '', r.inviter || '',
      r.invites, r.validInvites, r.listed ? '1' : '0', r.tier || '', r.ip || '', r.at || ''
    ].join(',')).join('\n') + (rows.length ? '\n' : '');
  }

  /**
   * POST /api/allowlist/register 的实现。
   * 登记 ≠ 进名单：这里只往流水里追加一行，管理员审完跑 approve 才算数。
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
    if (old) {
      return { status: 200, body: { ok: true, already: true, code: old.code, applied: seen.size } };
    }

    if (typeof take === 'function') {
      const r = take('alreg:' + (ip || '?'), REGISTER_PER_IP_DAY, DAY);
      if (r && r.ok === false) {
        return { status: 429, body: { error: '这个网络今天登记的地址已到上限（每天 ' + REGISTER_PER_IP_DAY + ' 个），明天再来', resetAt: r.resetAt } };
      }
    }
    if (seen.size >= MAX_APPLIED) return { status: 503, body: { error: '登记通道暂时满了，稍后再试' } };

    /* 落盘不写 tier：层是名单那边的事，登记只是排队。
       IP 只留前缀 —— 审核时看得出「同一个网段一口气登记 20 个」，又不是完整地址。 */
    const rec = { addr, x, ref: ref || null, inviter: inviter || null, ip: ipPrefix(ip), at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(appliedFile), { recursive: true });
      fs.appendFileSync(appliedFile, JSON.stringify(rec) + '\n');
    } catch (e) {
      console.error('[allowlist] 登记写不下去：' + (e && e.message));
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    const full = Object.assign({ code: myCode }, rec);
    seen.set(addr, full);
    if (!byCode.has(myCode)) byCode.set(myCode, []);
    byCode.get(myCode).push(addr);
    return { status: 200, body: { ok: true, code: myCode, applied: seen.size, pinnedPost: pinnedPost() } };
  }

  /* ---------------------------------------------------------------- 状态 */
  /**
   * GET /api/allowlist/status?addr= 的实现。
   * **tier / 码 / 邀请数只对查询的那个地址自己说**：名单本身不外泄（谁是保底不公开）。
   * @returns {Promise<object>}
   */
  async function status(addrRaw, now) {
    const p = phaseAt(now);
    const addr = normAddr(addrRaw);
    const tier = addr ? tierOf(addr) : null;
    const ap = addr ? appliedOf(addr) : null;
    const st = addr ? inviteStats(addr) : { invites: 0, validInvites: 0 };
    let freeLeft = null;
    if (readFreeLeft) {
      try { const v = await readFreeLeft(); freeLeft = v == null ? null : Number(v); }
      catch (e) { freeLeft = null; }
    }
    return {
      phase: p,
      tier: tier,                                  // 'gtd' / 'fcfs' / null
      listed: !!tier,
      freeLeft: freeLeft,                          // 链上还剩几枚免费额度；null = 这一刻读不到
      opens: opensIso(),
      next: nextOpen(now),
      counts: counts(),                            // {gtd, fcfs, total} —— 只是人数，不是名单
      applied: appliedCount(),
      registered: !!ap,
      code: addr ? codeOf(addr) : null,            // 登记码 = 邀请码，从地址现算
      invites: st.invites,
      validInvites: st.validInvites,
      rank: addr ? rankOf(addr) : null,
      gtdInvites: gtdInvites(),
      pinnedPost: pinnedPost(),
      message: addr ? registerMessage(addr) : null,  // 登记要签的那句话，客户端原样签
      domain: domain()
    };
  }

  /* ---------------------------------------------------------------- /api/bang 的闸
     这是整套东西唯一真正管用的地方：**决定签不签、签的是不是免费**。

     readChainFree()：读链上「这个地址此刻还能不能走免费额度」，
       true / false / null（RPC 读不到）。只在真需要的时候才调 ——
       公售段的路人一律付费，根本不必问链。

     返回 { ok:true, free:boolean, phase } 或 { ok:false, status, code, error, phase, opens }。
   */
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
          + '开，公售' + when(o.public) + '开。现在可以先去登记白名单；引爆和模拟器随时都能玩。'
      };
    }
    const tier = tierOf(minter);
    if (p === 'gtd' && tier !== 'gtd') {
      return {
        ok: false, status: 403, code: 'NOT_GTD', phase: p, opens: o, next: nx,
        error: (tier ? '你在白名单里，但现在是保底期。先到先得期' + when(o.fcfs) + '开。'
          : '你不在白名单里。先到先得期' + when(o.fcfs) + '开，公售' + when(o.public) + '开。')
      };
    }
    if (p === 'fcfs' && !tier) {
      return {
        ok: false, status: 403, code: 'NOT_LISTED', phase: p, opens: o, next: nx,
        error: '你不在白名单里。公售' + when(o.public) + '开，到时候人人都能铸。'
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
    // 名单
    tierOf, counts, rankOf, rankTable, inviteStats,
    addAddresses, removeAddresses, setTier, approve, listFile, appliedFile,
    // 登记
    register, registerMessage, codeOf, addrOfCode, appliedOf,
    appliedCount, appliedRows, appliedCsv, domain, gtdInvites,
    // 接口
    status, gate, denyReason,
    // 自检要用的：改完盘上的文件强制重读
    _reload: () => { cache = EMPTY(); applied = null; byCode = null; }
  };
}

module.exports = {
  create, PHASES, TIERS, registerMessage, domain, codeOf, pinnedPost,
  phaseAt, nextOpen, opensIso, ipPrefix, gtdInvites,
  REGISTER_PER_IP_DAY, CODE_RE,
  _normAddr: normAddr, _normTier: normTier, _normX: normX, _normCode: normCode
};
