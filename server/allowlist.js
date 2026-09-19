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
 *   六项积分，数字全部走环境变量（下面括号里是默认值）：
 *     登记            ARCBANG_PTS_REGISTER        10 分，登记即得
 *     ---- X 三连（三项各记各的，全部**管理员 verify 打勾后才计**；不买 X API，人工核）----
 *     关注 @本站      ARCBANG_PTS_FOLLOW          10 分
 *     转发 + 回登记码 ARCBANG_PTS_REPOST          30 分
 *                     三项里只有它要在评论里回登记码，也只有它能把一个 X 账号
 *                     和一个钱包地址对上 —— 所以它值三倍，别调平。
 *     点赞置顶推      ARCBANG_PTS_LIKE            10 分
 *     ---- 站内 ----
 *     有效邀请        ARCBANG_PTS_INVITE          10 分/人
 *                     ARCBANG_PTS_INVITE_MAX      最多算 10 人
 *                     2026-09-19 用户拍板砍半：邀请原来是 20 分 × 20 人 + 里程碑 180，
 *                     一项就能顶过其余全部之和，榜变成了「谁拉人多」而不是「谁参与多」。
 *                     「有效」= **被邀请人的转发那一项已经核过**（光登记不算）
 *     引爆并分享      ARCBANG_PTS_SHARE            5 分/天
 *                     ARCBANG_PTS_SHARE_MAX_DAYS  最多算 5 天
 *                     同一地址同一天只计一次
 *
 *   X 那边的三个入口：关注走 intent/follow?screen_name=（用户名在 ARCBANG_X_HANDLE），
 *   转发走 intent/post（带登记码），点赞走 intent/like?tweet_id=（id 从
 *   ARCBANG_PINNED_POST_URL 末尾解析）。全是纯 URL、零 SDK、点击前零对外请求。
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
 *   三连里的转发那一项要求「转发置顶推 + 在评论里回自己的登记码」。
 *   审核时把 X 那边的关注 / 转发 / 点赞和 /api/allowlist/applied 的 CSV 对一遍，
 *   对上的跑 `verify <码>`（默认三个勾一起打，`--follow` / `--repost` / `--like` 单打）。
 *   **它只加分，不直接进名单** —— 名单是榜算出来的。
 *
 *   登记码兼作邀请码：登记时带 ref=<别人的码>。自己邀自己直接拒。
 *
 * ---------------------------------------------------------------------------
 * **登记之后就不能改了**（2026-09-18 用户拍板）
 *
 *   同一个地址第二次调 /api/allowlist/register 一律 **409**，连带把原记录
 *   （登记码 / X 名 / 登记时间）回给页面，让它直接渲染「已登记」卡片。
 *   X 用户名与邀请码首次写下就定死 —— 接口上没有任何一条路能改它们。
 *
 *   为什么是 409 而不是「静默当成功」：改不了这件事必须**看得见**。
 *   静默成功的话，改了 X 名的人会一直以为改上了，直到审核对不上评论才发现。
 *
 *   真要修只有一条路：管理员命令行 `allowlist.js setx <地址> <新X名>`，
 *   它写进状态文件的 xfix，**不动流水**（流水只追加，这条规矩就是靠它保证的）。
 *
 * ---------------------------------------------------------------------------
 * 三份盘上的文件（都在 .store/）
 *   allowlist-applied.jsonl 登记流水，一行一条 { addr, x, ref, inviter, ip, at }。
 *                           **只追加，永不改写** —— 「登记之后不能改」的根据就在这里。
 *   allowlist-state.json    会变的那部分：
 *                           { follow/repost/like: {addr: ISO},   ← X 三连三个勾，各记各的
 *                             shares: {addr: [YYYY-MM-DD]},
 *                             xfix: {addr: 新X名} }
 *                           老格式那个单数的 verified 仍然认，按**转发**那一项读进来。
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
/** 引爆计分每地址每分钟多少次。上限本身由 bangsOf 那两道顶管，这一道管的是**写盘频率**：
    一个脚本一秒能发几百个请求，分数拦得住，磁盘拦不住。 */
const BANG_PER_MIN = 3;
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
/** X 那几个勾。**这四张表存的是置顶推那一条**（外加与推文无关的关注）。
    2026-09-19 用户拍板：**点赞 / 转发 / 评论是一体的** —— 页面上一条推文一张卡，
    三项都核到才给那条的分。这里仍然三项各记各的：
    「三项到齐没有」是算分时的判断，不是存储格式；分开记才看得出他卡在哪一项。
    其余官方推文的三个勾存在 state().engage 里（addr → {tweetId: {...}}）。 */
const CHECKS = ['follow', 'repost', 'like', 'comment'];
/** 互动这一整项由哪几个勾组成。少一个都不给分。 */
const ENGAGE_PARTS = ['like', 'repost', 'comment'];
/** 没配置顶推 URL 时，第一条互动任务的占位 id。它读写的还是老的三张表。 */
const PINNED_KEY = 'pinned';
/** 能自己点「我做完了」的任务。互动卡一条推文一颗按钮，claim 时带上 post=<推文id>。 */
const CLAIM_TASKS = ['follow', 'engage'];
/** 积分表。**每次现读**：自检要在同一进程里换着分值跑。 */
function pointsTable() {
  return {
    register: envInt('ARCBANG_PTS_REGISTER', 10),
    /* 关注单算一张卡：它跟具体某条推文无关，做一次管一辈子。 */
    follow: envInt('ARCBANG_PTS_FOLLOW', 10),
    /* **一条推文的点赞 + 转发 + 评论一体计分**。
       用户 2026-09-19 拍板：「点赞、转发、评论应该是一体的」——
       一张卡、一颗按钮、一个分值，三项都核到才给。
       engage     = 置顶推那一条值多少（默认 50）
       engagePost = 之后每条官方推文的默认分值（默认 20，加的时候可以 --pts 单独定）
       **没有每日上限、旧推文不过期**：官方每发一条就多一个任务，来晚的人补得回来。 */
    engage: envInt('ARCBANG_PTS_ENGAGE', 50),
    engagePost: envInt('ARCBANG_PTS_ENGAGE_POST', 20),
    /* 老的两个分值**保留但不再计入总分**：状态文件里还有按它们算过的旧数据，
       导出和后台仍然读得到；UI 上不再单列。别删这两行。 */
    repost: envInt('ARCBANG_PTS_REPOST', 30),
    like: envInt('ARCBANG_PTS_LIKE', 10),
    invite: envInt('ARCBANG_PTS_INVITE', 10),
    inviteMax: envInt('ARCBANG_PTS_INVITE_MAX', 10),
    /* 引爆并广播：2026-09-19 用户拍板从「一天一次、共五天」改成
       **每日最多 3 次、累计 15 次**，每次 5 分。同一个区块只计一次。
       shareMaxDays 还留着，值等于累计次数上限 —— 老页面读它画进度条，别让它变成 undefined。 */
    share: envInt('ARCBANG_PTS_SHARE', 5),
    sharePerDay: envInt('ARCBANG_PTS_SHARE_PER_DAY', 3),
    shareMax: envInt('ARCBANG_PTS_SHARE_MAX', 15),
    shareMaxDays: envInt('ARCBANG_PTS_SHARE_MAX', 15),
    /* 引爆计分：每引爆一个真实 Arc 区块 +1，每天封顶、整个预热期再封一次顶。
       两道顶都是**分**不是次数：改了单次分值，两个上限的含义不用跟着改。
       这一项比别的都便宜，因为它零成本 —— 不封顶的话一个脚本能把榜刷穿。 */
    bang: envInt('ARCBANG_PTS_BANG', 1),
    /* 2026-09-19 用户拍板：每日 5 次（原来 10），两次计分之间至少隔 3 分钟。
       间隔那一条**只在服务端生效、页面上一个字都不写** —— 写出来等于教人踩点刷，
       而正常玩的人本来也碰不到它。 */
    bangPerDay: envInt('ARCBANG_PTS_BANG_PER_DAY', 5),
    bangMax: envInt('ARCBANG_PTS_BANG_MAX', 50),
    bangIntervalMin: envInt('ARCBANG_BANG_INTERVAL_MIN', 3),
    /* 创作推文：自己发一条提到本站并带 #ARCBANG 的推，过了就计分。
       限每周 2 条、预热期共 4 条 —— 不限的话这一项会变成刷帖机。
       **4 而不是 5**（2026-09-19 用户指出）：预热期 14 天，每周 2 条最多也就发得出 4 条，
       写 5 等于在卡上摆一个永远点不亮的点。两个数要对得上。 */
    post: envInt('ARCBANG_PTS_POST', 20),
    postPerWeek: envInt('ARCBANG_PTS_POST_PER_WEEK', 2),
    postMax: envInt('ARCBANG_PTS_POST_MAX', 4),
    milestones: inviteMilestones()
  };
}
/**
 * 邀请里程碑："3:10,5:20,10:30" = 攒到 3 个有效邀请再奖 10，5 个再奖 20，10 个再奖 30。
 * 这是**在每人 10 分之外**另加的，按人数一档档累加（到 5 人时 3 人那档也还在）。
 * 所以邀请这一项满打满算 10×10 + 60 = 160 分（2026-09-19 用户拍板，原来是 400+180）。
 * 配歪了退默认，不是变成空 —— 空表等于悄悄把一整项奖励关掉。
 */
function inviteMilestones() {
  const raw = String(process.env.ARCBANG_PTS_INVITE_MILESTONES || '').trim() || '3:10,5:20,10:30';
  const out = raw.split(',').map((s) => {
    const m = /^\s*(\d{1,4}):(\d{1,6})\s*$/.exec(s);
    return m ? { at: Number(m[1]), pts: Number(m[2]) } : null;
  }).filter(Boolean).sort((a, b) => a.at - b.at);
  return out.length ? out : [{ at: 3, pts: 10 }, { at: 5, pts: 20 }, { at: 10, pts: 30 }];
}
/** 两档名额。gtdTop 必须 ≤ freeTop，配反了就把 gtd 夹到 freeTop（不是报错崩掉）。 */
/**
 * 两道名次线。
 *   gtd  = 名次 ≤ ARCBANG_GTD_TOP（默认 100）→ 「白名单」，优先铸造。
 *   free = 「先到先得」那一层的**可选上限**。2026-09-19 用户改了规则：
 *          先到先得不再看名次，而是看「除登记外至少完成一项任务」，
 *          所以这里默认 0 = **不限**。想再压一道名次线时把它配成正数即可。
 */
function tops() {
  const rawFree = envInt('ARCBANG_FREE_TOP', 0);
  const free = rawFree > 0 ? rawFree : Infinity;
  const gtd = Math.min(envInt('ARCBANG_GTD_TOP', 100), free);
  return { gtd, free, freeLimited: rawFree > 0 };
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
/** ISO 串或 null。落盘的那一份时间一律规范成 ISO，省得盘上出现三种写法。 */
function isoOrNull(v) {
  const t = tsOf(v);
  return t == null ? null : new Date(t).toISOString();
}
/**
 * 预热期窗口。ARCBANG_WARMUP_START（ISO）+ ARCBANG_WARMUP_DAYS（默认 14）。
 * 配了开始时间就能算出结束时间，**保底期没单独配时间时就用它** ——
 * 这样上线只要填一个开始时间，倒计时和放号时间一起就位。
 *
 * @param ov 后台落盘的那一份覆盖（.store/phase.json）。**只覆盖非空的字段** ——
 *           后台没填的那几格仍然跟 env 走，不会因为存过一次就把 env 整份作废。
 */
function warmupWindow(ov) {
  const o = ov || {};
  const start = o.warmupStart != null ? tsOf(o.warmupStart) : tsOf(process.env.ARCBANG_WARMUP_START);
  const days = Number(o.warmupDays) > 0 ? Math.floor(Number(o.warmupDays)) : envInt('ARCBANG_WARMUP_DAYS', 14);
  return { start, days, end: start == null ? null : start + days * DAY };
}
function openTimes(ov) {
  const o = ov || {};
  const w = warmupWindow(ov);
  const pick = (k, envKey) => (o[k] != null ? tsOf(o[k]) : tsOf(process.env[envKey]));
  const g = pick('gtdOpenAt', 'ARCBANG_GTD_OPEN_AT');
  return {
    /* 显式配的那个永远优先；没配才拿预热期的结束时间顶上。 */
    gtd: g != null ? g : w.end,
    fcfs: pick('fcfsOpenAt', 'ARCBANG_FCFS_OPEN_AT'),
    public: pick('publicOpenAt', 'ARCBANG_PUBLIC_OPEN_AT')
  };
}
/** 给页面看的：ISO 串或 null */
function opensIso(ov) {
  const o = openTimes(ov);
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  return { gtd: iso(o.gtd), fcfs: iso(o.fcfs), public: iso(o.public) };
}
/**
 * 当前阶段。起点是 base（管理员在后台切过就用那个，否则用 env 的 ARCBANG_PHASE），
 * 到点的开放时间只会把它**往后**推，永远不往回拉。
 * 管理员那一份能往回切（比如临时收回 warmup），但只要某一段的时间已经到了，
 * 它就还是会被推回去 —— 时间是写在页面上给所有人看过的，不该被一个后台按钮悄悄推翻。
 */
function phaseAt(now, base, ov) {
  const t = now == null ? Date.now() : now;
  let p = PHASES.indexOf(base) >= 0 ? base : envPhase();
  const o = openTimes(ov);
  if (o.gtd != null && t >= o.gtd && rank(p) < rank('gtd')) p = 'gtd';
  if (o.fcfs != null && t >= o.fcfs && rank(p) < rank('fcfs')) p = 'fcfs';
  if (o.public != null && t >= o.public && rank(p) < rank('public')) p = 'public';
  return p;
}
/** 下一段什么时候开（给倒计时用）：{ phase, at } 或 null（已经是最后一段） */
function nextOpen(now, base, ov) {
  const t = now == null ? Date.now() : now;
  const p = phaseAt(t, base, ov);
  const o = openTimes(ov);
  const seq = [['gtd', o.gtd], ['fcfs', o.fcfs], ['public', o.public]];
  for (const [name, at] of seq) {
    if (rank(name) <= rank(p)) continue;        // 已经过了这一段
    if (at == null) return { phase: name, at: null };   // 待定：页面显示「时间待定」
    if (at > t) return { phase: name, at: new Date(at).toISOString() };
  }
  return null;
}
/** 置顶推的地址（三连要转发、点赞它）。没配就只显示码和说明，不摆点了没反应的按钮。 */
function pinnedPost() {
  const u = String(process.env.ARCBANG_PINNED_POST_URL || '').trim();
  return /^https:\/\/(x\.com|twitter\.com)\//i.test(u) ? u : null;
}
/** 本站的 X 用户名（关注任务要它）。只收 X 自己那套形状，配歪了退默认。 */
function xHandle() {
  const h = String(process.env.ARCBANG_X_HANDLE || '').trim().replace(/^@+/, '');
  return X_RE.test(h) ? h : 'arcbang_xyz';
}
/** 关注按钮的 intent。纯 URL、零 SDK、点击前零对外请求。 */
function followUrl() {
  return 'https://x.com/intent/follow?screen_name=' + encodeURIComponent(xHandle());
}
/** 点赞按钮的 intent。**要推文 id**，从置顶推地址末尾那串数字里解析；
    没配置顶推（或那个地址里没有 id）就回 null —— 页面据此只显示说明，不摆按钮。 */
function likeUrl() {
  const u = pinnedPost();
  if (!u) return null;
  const m = /\/status\/(\d{5,25})/.exec(u);
  return m ? 'https://x.com/intent/like?tweet_id=' + m[1] : null;
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
  /** X 自动核那一套的现状（server/xverify.js 的 info()）。
      **后接**：xverify 在 index.js 里晚于本模块创建，所以给一个 setter，
      而不是在 create 的时候要一个已经存在的实例。
      没接上时一律当「没开」—— 那是原来的信任模式，行为一个字不变。 */
  let apiProbe = typeof o.apiInfo === 'function' ? o.apiInfo : null;
  function setApiProbe(fn) { apiProbe = typeof fn === 'function' ? fn : null; }
  /* X 账号的公开档案（注册日期 / 粉丝数），由 server/xverify.js 抓、存在 .store/xusers.json。
     **后接而不是构造时传**：XV 依赖 AL，AL 再依赖 XV 就成环了（apiProbe 同理）。
     没接上时后台那两列一律显示「未抓取」，不是 0 —— 0 会被当成「粉丝数为零的小号」。 */
  let usersProbe = null;
  function setXUsersProbe(fn) { usersProbe = typeof fn === 'function' ? fn : null; }
  function xUserOf(xId) {
    if (!usersProbe || xId == null) return null;
    try {
      const m = usersProbe() || {};
      const u = m[String(xId)];
      return (u && !u.missing) ? u : null;
    } catch (e) { return null; }
  }
  function apiInfo() {
    if (!apiProbe) return { configured: false, lastRunAt: null, everyMin: null };
    try {
      const j = apiProbe() || {};
      return {
        configured: !!j.configured,
        lastRunAt: j.lastRunAt || null,
        everyMin: Number(j.everyMin) || null,
        /* 评论那一路走的是 recent search，它要单独的计费档；被拒时（402/403）
           页面要退回「贴回复链接」那条老路，所以这个标志必须一直传到前端。 */
        searchOk: j.searchOk !== false
      };
    } catch (e) { return { configured: false, lastRunAt: null, everyMin: null, searchOk: false }; }
  }
  /** 接了 X API 之后，关注 / 点赞 / 转发**不再接受用户自称**。 */
  function apiOn() { return apiInfo().configured; }

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
  let byXid = null;                // Map(xId → addr)：一个 X 账号只能绑一个地址
  function loadApplied() {
    if (applied) return applied;
    applied = new Map();
    byCode = new Map();
    byXid = new Map();
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
            /* xId 是 X 那边的数字主键：**改名字它不变**，所以一 X 一地址要认它，
               不能认 handle —— 认 handle 的话，改个名就能再登记一个地址。 */
            xId: j.xId ? String(j.xId) : null,
            xSource: j.xSource === 'oauth' ? 'oauth' : 'typed',
            ref: normCode(j.ref),
            inviter: normAddr(j.inviter),
            ip: j.ip || null,
            at: j.at || null,
            /* 排练用的模拟登记。**必须读回来**：unseed 按它删，
               seed 造邀请关系时也要认得出哪些是自己造的。 */
            seed: j.seed === true,
            code: codeOf(a)
          };
          applied.set(a, rec);
          if (!byCode.has(rec.code)) byCode.set(rec.code, []);
          byCode.get(rec.code).push(a);
          if (rec.xId) byXid.set(rec.xId, a);
        } catch (e) { /* 坏行跳过 */ }
      }
    } catch (e) { /* 还没有文件 */ }
    return applied;
  }
  function appliedCount() { return loadApplied().size; }
  /** 登记过、而且是用 X 登录进来的那些数字 id。手填 X 名的没有 id，抓不了档案。 */
  function xIds() {
    const out = [];
    for (const r of loadApplied().values()) {
      if (r.xId && /^\d{1,25}$/.test(String(r.xId))) out.push(String(r.xId));
    }
    return Array.from(new Set(out));
  }
  function appliedOf(addr) { const a = normAddr(addr); return a ? loadApplied().get(a) || null : null; }
  /** 码 → 地址。同一个码撞上两个地址（36^6 里的极小概率）时返回 null 并喊一声，
      宁可让管理员手输地址，也不能把名额发错人。 */
  /** 这个 X 账号已经绑过哪个地址了（没绑过回 null）。 */
  function addrOfXid(xId) {
    const s = String(xId == null ? '' : xId).trim();
    if (!s) return null;
    loadApplied();
    return byXid.get(s) || null;
  }
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
     follow / repost / like：**X 三连**的三个勾，各记各的（管理员人工核过才打）。
     shares：每个地址记过分的那些天。
     xfix：管理员人工修正过的 X 用户名（**接口改不了，只有命令行 setx 能写**）。
     单独一个文件，不跟追加式流水混：这些都会被改写，而流水必须只追加 ——
     「登记之后就不能改」这条规矩正是靠流水只追加来保证的。 */
  let stateCache = null;             // { mtimeMs, size, follow/repost/like:Map, shares:Map, xfix:Map }
  const EMPTY_STATE = () => ({
    mtimeMs: -1, size: -1,
    follow: new Map(), repost: new Map(), like: new Map(), comment: new Map(),
    shares: new Map(), xfix: new Map(), proof: new Map(), posts: new Map(),
    /* 官方推文的互动（**不含置顶推**，它还在上面那三张表里）：
       addr → { tweetId: { like:ISO, repost:ISO, comment:ISO } }。
       按推文 id 记：官方每发一条就多一个任务，旧的不过期、补得回来。 */
    engage: new Map(),
    /* 引爆记账：addr → { h: [算过分的区块哈希…], d: { 'YYYY-MM-DD': 次数 } }
       哈希列表是**去重的依据**（同一个区块引爆一百次也只算一次），
       它的长度被总上限夹着，不会无限长。 */
    bangs: new Map(),
    /* 「我关注了」那一下的**去向**（键是 '<地址>|<任务>'）：
       接了 X API 之后，用户自称不再直接算数 —— 它只是让这一项进「审核中」，
       等下一轮 API 去 X 上查。查到了才打勾，查不到就 'failed'，他可以再点一次。 */
    claims: new Map(),
    distrust: new Map(), phase: null
  });
  function state() {
    let st = null;
    try { st = fs.statSync(stateFile); } catch (e) { /* 还没有 */ }
    if (!st) { if (!stateCache || stateCache.mtimeMs !== -1) stateCache = EMPTY_STATE(); return stateCache; }
    if (stateCache && st.mtimeMs === stateCache.mtimeMs && st.size === stateCache.size) return stateCache;
    const next = EMPTY_STATE();
    try {
      const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      for (const key of CHECKS) {
        for (const k in (j && j[key]) || {}) {
          const a = normAddr(k);
          if (a) next[key].set(a, j[key][k] || true);
        }
      }
      /* 老格式兼容：三连拆开之前只有一个 verified，它的含义就是**转发那一项**
         （那一项要在评论里回登记码，是三项里唯一能人工对上的）。所以只补 repost，
         不替人把关注和点赞也算上 —— 没核过的勾不能凭空长出来。 */
      for (const k in (j && j.verified) || {}) {
        const a = normAddr(k);
        if (a && !next.repost.has(a)) next.repost.set(a, j.verified[k] || true);
      }
      /* 老格式是 ['2026-09-18', …]（一天一次），新格式是 { d:{天:次数}, h:[哈希] }。
         老的读进来当每天各 1 次 —— 它记录的就是这个意思，分也一个不差。 */
      for (const k in (j && j.shares) || {}) {
        const a = normAddr(k);
        const v = j.shares[k];
        if (!a || !v) continue;
        const d = {};
        if (Array.isArray(v)) {
          for (const x of v) if (/^\d{4}-\d{2}-\d{2}$/.test(x)) d[x] = 1;
          if (Object.keys(d).length) next.shares.set(a, { d, h: [] });
          continue;
        }
        for (const day in (v.d || {})) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number(v.d[day]) > 0) d[day] = Math.floor(Number(v.d[day]));
        }
        const h = Array.isArray(v.h) ? v.h.filter((x) => HASH_RE.test(String(x))).map((x) => String(x).toLowerCase()) : [];
        if (Object.keys(d).length || h.length) next.shares.set(a, { d, h: Array.from(new Set(h)) });
      }
      for (const k in (j && j.xfix) || {}) {
        const a = normAddr(k);
        const x = normX(j.xfix[k]);
        if (a && x) next.xfix.set(a, x);
      }
      for (const k in (j && j.proof) || {}) {
        const a = normAddr(k);
        const v = j.proof[k];
        /* **整条原样读回来**（只挑字段的话，重试次数、自动核的结论与原因
           会在每次重读状态文件时被悄悄抹掉，表现是「重试永远从第 1 次开始」）。
           只拿 url 当必填，其余给默认值。 */
        if (a && v && typeof v.url === 'string') {
          next.proof.set(a, {
            url: v.url, at: v.at || null,
            submits: Number(v.submits) || 1, tries: Number(v.tries) || 0,
            status: v.status || 'new', reason: v.reason || null,
            nextAt: v.nextAt || null, via: v.via || null, rejected: !!v.rejected
          });
        }
      }
      for (const k in (j && j.posts) || {}) {
        const a = normAddr(k);
        if (!a || !Array.isArray(j.posts[k])) continue;
        next.posts.set(a, j.posts[k].filter((x) => x && typeof x.url === 'string').map((x) => ({
          url: x.url, at: x.at || null, status: x.status || 'new', reason: x.reason || null,
          tries: Number(x.tries) || 0, nextAt: x.nextAt || null, via: x.via || null
        })));
      }
      for (const k in (j && j.bangs) || {}) {
        const a = normAddr(k);
        const v = j.bangs[k];
        if (!a || !v) continue;
        const hs = Array.isArray(v.h) ? v.h.filter((x) => HASH_RE.test(String(x))).map((x) => String(x).toLowerCase()) : [];
        const ds = {};
        for (const d in (v.d || {})) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number(v.d[d]) > 0) ds[d] = Math.floor(Number(v.d[d]));
        }
        /* last = 上一次**被计分**的时刻（毫秒）。老数据没有这个字段，当 0 处理：
              升级之后第一次引爆一定放行，不会因为读不到时间就把人卡住。 */
        const last = Number(v.last) || 0;
        if (hs.length || Object.keys(ds).length) next.bangs.set(a, { h: Array.from(new Set(hs)), d: ds, last });
      }
      for (const k in (j && j.claims) || {}) {
        const v = j.claims[k];
        const i = String(k).indexOf('|');
        const a = i > 0 ? normAddr(String(k).slice(0, i)) : null;
        const t = i > 0 ? String(k).slice(i + 1) : '';
        /* 老数据里 claims 的任务名是 CHECKS 里的（follow/like/repost）；
           新的是 follow / engage:<推文id>。两套都读得回来，
           因为 syncApi 只按 CLAIM_TASKS 结账，读回来的旧键下一轮自然被清掉。 */
        if (a && (CLAIM_TASKS.indexOf(t) >= 0 || CHECKS.indexOf(t) >= 0 || /^engage:\d{5,25}$/.test(t)) && v) {
          next.claims.set(a + '|' + t, {
            at: v.at || null,
            status: v.status === 'failed' ? 'failed' : 'pending',
            checkedAt: v.checkedAt || null
          });
        }
      }
      for (const k in (j && j.engage) || {}) {
        const a = normAddr(k);
        const v = j.engage[k];
        if (!a || !v || typeof v !== 'object') continue;
        const byTweet = {};
        for (const tid in v) {
          if (!/^\d{5,25}$/.test(tid) || !v[tid]) continue;
          byTweet[tid] = {
            like: v[tid].like || null, repost: v[tid].repost || null, comment: v[tid].comment || null
          };
        }
        if (Object.keys(byTweet).length) next.engage.set(a, byTweet);
      }
      for (const k in (j && j.distrust) || {}) {
        const a = normAddr(k);
        if (a) next.distrust.set(a, j.distrust[k] || true);
      }
      /* 管理员在审核页切过的阶段。认不出的值当没切（跟 env 走），不是崩。 */
      if (PHASES.indexOf(j && j.phase) >= 0) next.phase = j.phase;
    } catch (e) { console.error('[allowlist] 状态文件读不出来：' + (e && e.message)); }
    next.mtimeMs = st.mtimeMs; next.size = st.size;
    stateCache = next;
    boardCache = null;
    return stateCache;
  }
  function saveState(s) {
    const out = { updatedAt: new Date().toISOString() };
    for (const key of CHECKS) {
      const o = {};
      for (const [k, v] of s[key]) o[k] = v;
      out[key] = o;
    }
    out.shares = {};
    for (const [k, v] of s.shares) out.shares[k] = v;
    out.xfix = {};
    for (const [k, v] of (s.xfix || new Map())) out.xfix[k] = v;
    out.proof = {};
    for (const [k, v] of (s.proof || new Map())) out.proof[k] = v;
    out.posts = {};
    for (const [k, v] of (s.posts || new Map())) out.posts[k] = v;
    out.bangs = {};
    for (const [k, v] of (s.bangs || new Map())) out.bangs[k] = v;
    out.claims = {};
    for (const [k, v] of (s.claims || new Map())) out.claims[k] = v;
    out.engage = {};
    for (const [k, v] of (s.engage || new Map())) out.engage[k] = v;
    out.distrust = {};
    for (const [k, v] of (s.distrust || new Map())) out.distrust[k] = v;
    out.phase = s.phase || null;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    writeAtomic(stateFile, JSON.stringify(out, null, 2) + '\n');
    stateCache = null;              // 强制下次重读（mtime 立刻就变了，但别赌这个）
    boardCache = null;
  }
  /** 改状态的通用入口：**必须整份拷出来再改**，直接动 state() 返回的那份会被 mtime 缓存吞掉。 */
  function mutState(fn) {
    const s = state();
    const next = { shares: new Map(s.shares), xfix: new Map(s.xfix), proof: new Map(s.proof),
      posts: new Map(s.posts), bangs: new Map(s.bangs), claims: new Map(s.claims),
      engage: new Map(s.engage), distrust: new Map(s.distrust), phase: s.phase || null };
    for (const key of CHECKS) next[key] = new Map(s[key]);
    fn(next);
    saveState(next);
  }
  /** X 那几个勾的某一项核过没有 */
  function hasCheck(addr, key) {
    const a = normAddr(addr);
    return !!a && CHECKS.indexOf(key) >= 0 && state()[key].has(a);
  }
  /** 互动置顶推那一整项：**点赞 + 转发 + 评论都到齐**才算。少一个就不给那 50 分。 */
  function isEngaged(addr, tweetId) {
    const a = normAddr(addr);
    if (!a) return false;
    const pin = pinnedTweetId();
    const tid = tweetId == null ? (pin || PINNED_KEY) : String(tweetId);
    if (tid === PINNED_KEY || (pin && tid === pin)) return ENGAGE_PARTS.every((k) => state()[k].has(a));
    const rec = (state().engage.get(a) || {})[tid] || {};
    return ENGAGE_PARTS.every((k) => !!rec[k]);
  }

  /* ---------------------------------------------------------------- 官方推文表
     2026-09-19 用户拍板：**官方每发一条新推文，就多出一个新的「一键三连」任务**。
     旧的不下线、不过期、没有每日上限 —— 来晚的人照样能把前面几条补做。

     置顶推（ARCBANG_PINNED_POST_URL）是这张表里天然的第一条，值 ARCBANG_PTS_ENGAGE（50）；
     后面每条默认 ARCBANG_PTS_ENGAGE_POST（20），加的时候可以 --pts 单独定。

     置顶推那一条的三个勾**仍然存在老的 like/repost/comment 三张表里**
     （状态文件里已经有按它们算过的数据，动了就等于把所有人的分清零）；
     其余每条存在新的 engage 表里：addr → { tweetId: {like, repost, comment} }。

     推文表单独一个文件（.store/engage-posts.json）：这是管理员维护的**内容**，
     跟用户的计分状态不是一回事，往线上搬时也只想搬这一个文件。 */
  const postsFile = o.engagePostsFile || path.join(storeDir, 'engage-posts.json');
  let postsCache = null;
  /** 文件里那几条（不含置顶推）。按加入时间升序。 */
  function engageFileRows() {
    let st = null;
    try { st = fs.statSync(postsFile); } catch (e) { /* 还没有 */ }
    if (!st) { postsCache = { mtimeMs: -1, size: -1, rows: [] }; return postsCache.rows; }
    if (postsCache && st.mtimeMs === postsCache.mtimeMs && st.size === postsCache.size) return postsCache.rows;
    let rows = [];
    try {
      const j = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
      const arr = Array.isArray(j) ? j : ((j && j.posts) || []);
      const seen = new Set();
      rows = arr.map((r) => {
        if (!r || typeof r.url !== 'string') return null;
        const m = PROOF_RE.exec(r.url);
        if (!m || seen.has(m[2])) return null;
        seen.add(m[2]);
        /* **null / 空串要还原成 null**（= 用默认分值）。直接 Number(null) 是 0，
           那会让「没单独定分」的推文一律变成 0 分的任务。 */
        const pts = (r.pts == null || r.pts === '') ? NaN : Math.floor(Number(r.pts));
        return {
          id: m[2], tweetId: m[2], url: 'https://x.com/' + m[1] + '/status/' + m[2],
          pts: Number.isFinite(pts) && pts >= 0 ? pts : null,
          at: r.at || null, note: r.note == null ? null : String(r.note).slice(0, 160)
        };
      }).filter(Boolean);
    } catch (e) { console.error('[allowlist] 官方推文表读不出来：' + (e && e.message)); }
    rows.sort((a, b) => String(a.at || '') < String(b.at || '') ? -1 : 1);
    postsCache = { mtimeMs: st.mtimeMs, size: st.size, rows };
    return rows;
  }
  function saveEngagePosts(rows) {
    fs.mkdirSync(path.dirname(postsFile), { recursive: true });
    writeAtomic(postsFile, JSON.stringify({ updatedAt: new Date().toISOString(), posts: rows }, null, 2) + '\n');
    postsCache = null;
    boardCache = null;
  }
  /**
   * 全部互动任务的推文，**置顶推排第一**。
   * @returns [{id, tweetId, url, pts, at, note, pinned:boolean, n:number}]
   */
  function engagePosts() {
    const P = pointsTable();
    const pin = pinnedTweetId();
    const out = [{
      id: pin || PINNED_KEY, tweetId: pin || PINNED_KEY, url: pinnedPost(), pts: P.engage,
      at: null, note: null, pinned: true
    }];
    for (const r of engageFileRows()) {
      if (pin && r.tweetId === pin) continue;        // 置顶推被重复加进文件：以上面那条为准
      out.push({
        id: r.id, tweetId: r.tweetId, url: r.url,
        pts: r.pts == null ? P.engagePost : r.pts,
        at: r.at, note: r.note, pinned: false
      });
    }
    out.forEach((r, i) => { r.n = i + 1; });
    return out;
  }
  function engagePostOf(tweetIdOrUrl) {
    const s = String(tweetIdOrUrl == null ? '' : tweetIdOrUrl).trim();
    if (!s) return null;
    const m = PROOF_RE.exec(s);
    const tid = m ? m[2] : s;
    return engagePosts().find((r) => r.tweetId === tid) || null;
  }
  /** 加一条官方推文。@param opts.pts 这条值多少分（不给就用 ARCBANG_PTS_ENGAGE_POST） */
  function engageAdd(url, opts) {
    const b = opts || {};
    const m = PROOF_RE.exec(String(url || '').trim());
    if (!m) return { ok: false, error: '这不是一条推文链接（要 https://x.com/xxx/status/123…）' };
    if (pinnedTweetId() && m[2] === pinnedTweetId()) {
      return { ok: false, error: '这就是置顶推，它已经自动是第一条了' };
    }
    const rows = engageFileRows().slice();
    if (rows.some((r) => r.tweetId === m[2])) return { ok: false, error: '这条已经在表里了' };
    const pts = b.pts == null || b.pts === '' ? null : Math.floor(Number(b.pts));
    if (pts != null && !(Number.isFinite(pts) && pts >= 0)) return { ok: false, error: '分值要是非负整数' };
    const row = {
      id: m[2], tweetId: m[2], url: 'https://x.com/' + m[1] + '/status/' + m[2],
      pts, at: b.at ? new Date(b.at).toISOString() : new Date().toISOString(),
      note: b.note == null ? null : String(b.note).slice(0, 160)
    };
    rows.push(row);
    saveEngagePosts(rows);
    return { ok: true, post: engagePostOf(row.tweetId), total: engagePosts().length };
  }
  function engageRemove(idOrUrl) {
    const s = String(idOrUrl || '').trim();
    if (!s) return { ok: false, error: '要给推文 id 或链接' };
    const m = PROOF_RE.exec(s);
    const tid = m ? m[2] : s;
    if (pinnedTweetId() && tid === pinnedTweetId()) {
      return { ok: false, error: '置顶推来自 ARCBANG_PINNED_POST_URL，要改改那个环境变量' };
    }
    const rows = engageFileRows();
    const keep = rows.filter((r) => r.tweetId !== tid);
    if (keep.length === rows.length) return { ok: false, error: '表里没有这一条：' + s };
    saveEngagePosts(keep);
    return { ok: true, removed: rows.length - keep.length, total: engagePosts().length };
  }
  /** 某个地址在某条推文上的三个勾。置顶推读老的三张表，其余读 engage 表。 */
  function engagePartsOf(addr, tweetId) {
    const a = normAddr(addr);
    if (!a) return { like: false, repost: false, comment: false };
    const pin = pinnedTweetId();
    const tid = String(tweetId);
    if (tid === PINNED_KEY || (pin && tid === pin)) {
      return { like: state().like.has(a), repost: state().repost.has(a), comment: state().comment.has(a) };
    }
    const rec = (state().engage.get(a) || {})[tid] || {};
    return { like: !!rec.like, repost: !!rec.repost, comment: !!rec.comment };
  }
  /**
   * 这个地址在每条官方推文上的进度。
   * @returns {{rows:Array, done:number, points:number}}
   */
  function engageStatus(addr) {
    const rows = engagePosts().map((p) => {
      const q = engagePartsOf(addr, p.tweetId);
      const ok = q.like && q.repost && q.comment;
      return Object.assign({}, p, { like: q.like, repost: q.repost, comment: q.comment, ok });
    });
    return {
      rows,
      done: rows.filter((r) => r.ok).length,
      points: rows.reduce((s, r) => s + (r.ok ? r.pts : 0), 0)
    };
  }

  /* ---------------------------------------------------------------- 阶段（后台那一份落盘）
     2026-09-19 用户拍板：阶段不该靠改 env 加重启。**有 .store/phase.json 就以它为准**，
     没有才读 env —— env 只是第一次的默认值。

     phase.json：{ phase, gtdOpenAt, fcfsOpenAt, publicOpenAt, warmupStart, warmupDays, updatedAt, by }
       · phase 为 null = 「跟 env 走」，不是「预热期」。这两件事差得远。
       · 四个时间字段为 null 的**逐个退回 env**，不是整份退回 ——
         后台只改了公售时间时，另外三个仍然跟 env，不会被一次保存清空。

     每次改都往 .store/phase-log.jsonl 追加一行（只追加，永不改写）：
       { at, from, to, base, by, rollback, times, frozen, warnings }
     往前一段切（回退）是允许的，但必须留痕 —— 放号这种事不能只剩一个当前值。

     **所有对外的判断都走 phaseNow() / opensNow()**，不要直接调模块级的 phaseAt()、
     opensIso() —— 那两个不认后台这一份，用错了的表现是「后台切了没反应」。 */
  const phaseFile = o.phaseFile || path.join(storeDir, 'phase.json');
  const phaseLogFile = o.phaseLogFile || path.join(storeDir, 'phase-log.jsonl');
  const PHASE_TIME_FIELDS = ['gtdOpenAt', 'fcfsOpenAt', 'publicOpenAt', 'warmupStart'];
  let phaseCache = null;             // { mtimeMs, size, rec }
  /** 盘上那一份。没有文件就回 null（**不是空对象** —— 「没存过」和「存过但全空」要分得开）。 */
  function phaseRec() {
    let st = null;
    try { st = fs.statSync(phaseFile); } catch (e) { /* 还没存过 */ }
    if (!st) { phaseCache = null; return null; }
    if (phaseCache && phaseCache.mtimeMs === st.mtimeMs && phaseCache.size === st.size) return phaseCache.rec;
    let rec = null;
    try {
      const j = JSON.parse(fs.readFileSync(phaseFile, 'utf8'));
      if (j && typeof j === 'object') {
        rec = {
          /* 认不出的阶段名当「跟 env 走」，不是崩 —— 手改坏一个字不该让整站放不了号。 */
          phase: PHASES.indexOf(j.phase) >= 0 ? j.phase : null,
          gtdOpenAt: isoOrNull(j.gtdOpenAt), fcfsOpenAt: isoOrNull(j.fcfsOpenAt),
          publicOpenAt: isoOrNull(j.publicOpenAt), warmupStart: isoOrNull(j.warmupStart),
          warmupDays: Number(j.warmupDays) > 0 ? Math.floor(Number(j.warmupDays)) : null,
          updatedAt: j.updatedAt || null, by: j.by || null
        };
      }
    } catch (e) { console.error('[allowlist] 阶段文件读不出来（当没存过，跟 env 走）：' + (e && e.message)); }
    phaseCache = { mtimeMs: st.mtimeMs, size: st.size, rec };
    return rec;
  }
  /** 传给 openTimes / warmupWindow 的覆盖。**只带非空字段**，空的那几格自己退回 env。 */
  function phaseOverride() {
    const r = phaseRec();
    if (!r) return null;
    const ov = {};
    for (const k of PHASE_TIME_FIELDS) if (r[k] != null) ov[k] = r[k];
    if (r.warmupDays != null) ov.warmupDays = r.warmupDays;
    return ov;
  }
  function phaseBase() {
    const r = phaseRec();
    if (r && PHASES.indexOf(r.phase) >= 0) return r.phase;
    /* 老版本把后台切的阶段存在 allowlist-state.json 里。升级之后照旧认它，
       不然升一次级线上就悄悄退回 env 那一段了。 */
    const b = state().phase;
    return PHASES.indexOf(b) >= 0 ? b : null;
  }
  function phaseNow(now) { return phaseAt(now, phaseBase(), phaseOverride()); }
  function nextOpenNow(now) { return nextOpen(now, phaseBase(), phaseOverride()); }
  function opensNow() { return opensIso(phaseOverride()); }
  function warmupNow() { return warmupWindow(phaseOverride()); }
  /** 干预日志：只追加。写不下去只报错，不把切段这件事一起带走。 */
  function logPhase(entry) {
    try {
      fs.mkdirSync(path.dirname(phaseLogFile), { recursive: true });
      fs.appendFileSync(phaseLogFile, JSON.stringify(entry) + '\n');
    } catch (e) { console.error('[allowlist] 阶段日志写不下：' + (e && e.message)); }
  }
  /** 最近几条变更，**新的在前**（后台那张小表直接照这个顺序画）。 */
  function phaseLog(n) {
    const want = Math.max(1, Math.min(200, Math.floor(Number(n) || 10)));
    let txt = '';
    try { txt = fs.readFileSync(phaseLogFile, 'utf8'); } catch (e) { return []; }
    return txt.split('\n').filter(Boolean).slice(-want)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean).reverse();
  }
  /**
   * 后台切段 / 改开放时间。
   *
   * @param pRaw  四个阶段之一；'auto' / '' = 清掉后台那一份重新跟 env 走；
   *              **null / undefined = 不动阶段**，只改时间（后台单独保存时间时走这条）。
   * @param opts  { gtdOpenAt, fcfsOpenAt, publicOpenAt, warmupStart, warmupDays, by }
   *              给 '' 或 null = **清掉这一格**，退回 env；不给这个键 = 保持原样。
   *
   * 顺序：warmup 到 gtd 到 fcfs 到 public 可以前进，**也允许回退**（写错了要能收回来），
   * 回退在日志里标 rollback:true。时间前后颠倒不拒绝，只回一句 warning ——
   * 半填一半的中间态是后台里正常的一步，不该被一个校验卡死。
   */
  function setPhase(pRaw, opts) {
    const q = opts || {};
    const cur = phaseRec();
    const from = phaseNow();
    const warnings = [];

    let base;
    if (pRaw == null) base = cur ? cur.phase : phaseBase();       // 不动阶段，只改时间
    else {
      const p = String(pRaw).trim().toLowerCase();
      if (p === '' || p === 'auto') base = null;
      else if (PHASES.indexOf(p) < 0) return { ok: false, error: '阶段只能是 ' + PHASES.join(' / ') + '，或 auto（跟 env 走）' };
      else base = p;
    }

    const rec = {
      phase: base,
      gtdOpenAt: null, fcfsOpenAt: null, publicOpenAt: null, warmupStart: null, warmupDays: null,
      updatedAt: new Date().toISOString(),
      by: String(q.by == null ? '' : q.by).trim().slice(0, 64) || 'admin'
    };
    for (const k of PHASE_TIME_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(q, k)) { rec[k] = cur ? cur[k] : null; continue; }
      const v = q[k];
      if (v == null || String(v).trim() === '') { rec[k] = null; continue; }
      const iso = isoOrNull(v);
      if (iso == null) return { ok: false, error: k + ' 不是一个看得懂的时间：' + String(v).slice(0, 40) };
      rec[k] = iso;
    }
    if (!Object.prototype.hasOwnProperty.call(q, 'warmupDays')) rec.warmupDays = cur ? cur.warmupDays : null;
    else if (q.warmupDays == null || String(q.warmupDays).trim() === '') rec.warmupDays = null;
    else {
      const d = Math.floor(Number(q.warmupDays));
      if (!Number.isFinite(d) || d <= 0 || d > 3650) return { ok: false, error: '预热天数要是 1 到 3650 之间的整数' };
      rec.warmupDays = d;
    }

    fs.mkdirSync(path.dirname(phaseFile), { recursive: true });
    writeAtomic(phaseFile, JSON.stringify(rec, null, 2) + '\n');
    phaseCache = null;
    /* 老那一份（状态文件里的 phase）就地清掉：一件事存两个地方，
       迟早有一天它们不一样，而那一天没人说得清哪个算数。 */
    if (PHASES.indexOf(state().phase) >= 0) mutState((n) => { n.phase = null; });

    const to = phaseNow();
    const op = opensNow();
    const seq = [op.gtd, op.fcfs, op.public].map((x) => (x == null ? null : Date.parse(x)));
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] != null && seq[i - 1] != null && seq[i] < seq[i - 1]) {
        warnings.push('开放时间前后颠倒了：' + ['白名单', '先到先得', '公售'][i] + '早于它前面那一段。');
      }
    }
    if (base != null && to !== base) {
      warnings.push('已保存，但「' + base + '」后面那一段的开放时间已经到了，实际生效的是「' + to
        + '」。开放时间是写在页面上给所有人看过的，后台按钮不会把它悄悄推翻 —— 真要回退，'
        + '请把对应的开放时间一起清空或往后挪。');
    }
    if (to === 'gtd' && !isFrozen()) {
      warnings.push('名单还没定格。白名单阶段的名单会随积分实时变，有人可能铸到一半被挤出名单 ——'
        + '进白名单阶段之前请先点「定格榜单」。');
    }
    logPhase({
      at: rec.updatedAt, from, to, base, by: rec.by,
      rollback: rank(to) < rank(from),
      times: { gtd: op.gtd, fcfs: op.fcfs, public: op.public, warmupStart: rec.warmupStart, warmupDays: rec.warmupDays },
      frozen: isFrozen(),
      warnings
    });
    return { ok: true, phase: to, base, opens: op, warnings };
  }
  /** 后台阶段卡要的那一份：现在哪一段、各段什么时候开、榜定没定格、名单多少人、最近改了什么。 */
  function phaseInfo(now) {
    const r = phaseRec();
    const c = counts();
    const L = list();
    const w = warmupNow();
    return {
      ok: true,
      phase: phaseNow(now),
      base: phaseBase(),
      envPhase: envPhase(),
      /* 现在这一段从哪儿来的：后台落盘 / 老状态文件 / env。后台那张卡要照实说清楚。 */
      source: (r && r.phase) ? 'file' : (PHASES.indexOf(state().phase) >= 0 ? 'state' : 'env'),
      stored: r,
      opens: opensNow(),
      warmup: {
        start: w.start == null ? null : new Date(w.start).toISOString(),
        days: w.days,
        end: w.end == null ? null : new Date(w.end).toISOString()
      },
      next: nextOpenNow(now),
      frozen: isFrozen(),
      frozenAt: L.frozenAt || null,
      counts: { gtd: c.gtd, fcfs: c.fcfs, total: c.total },
      tops: tops(),
      boardSize: board(now).rows.length,
      applied: appliedCount(),
      phases: PHASES.slice(),
      updatedAt: r ? r.updatedAt : null,
      by: r ? r.by : null,
      log: phaseLog(10)
    };
  }

  /* ================================================================ 自动审核
     2026-09-18 用户拍板：能自动核的就别让人一条条点。

     ---- 转发 + 回复登记码：**自动核** ----
     用户把自己那条回复的链接贴进来，服务端立刻去取那条推文，三项全对才自动打勾：
       1. 作者 == 登记时填的 X 名（大小写不敏感）
       2. 正文里有他自己的登记码
       3. 回复的对象 == 置顶推（ARCBANG_PINNED_POST_URL 里那个 id）
     取不到或对不上 → 停在「待核」并记下**原因**，管理员页上看得见，可以手动打勾或驳回。

     两条取推文的路，都不要 key：
       syndication  https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<任意>
                    回 JSON，带 user.screen_name / text / in_reply_to_status_id_str。**首选**，
                    因为只有它给得出「回复的是哪条」。
       oEmbed       https://publish.twitter.com/oembed?url=<url>&omit_script=1
                    回 HTML，能看出作者和正文，但**看不出回复对象** ——
                    所以走到这条路时只核前两项，结果标 partial，进待审而不是自动通过。

     取不到就重试：最多 3 次，间隔 1 / 5 / 30 分钟（RETRY_MS）。
     排队信息就记在这条 proof 记录里（tries / nextAt），没有单独的队列文件 ——
     进程重启之后照样接着重试，这一点比内存队列重要得多。

     ---- 关注 / 点赞：**默认信任** ----
     这两项在 X 上没有任何免 key 的办法能查（syndication 只给推文本身）。
     所以用户在任务卡上点「我已关注」「我已点赞」就计分，记 by:'trust'。
     管理员页可以抽查并撤销；**被撤销过的地址整个失去信任**（distrusted），
     之后这两项只能由管理员手动打勾 —— 不然撤了他再点一次就回来了。 */
  const PROOF_RE = /^https:\/\/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/i;
  /** 重试节奏：第 1 次失败后 1 分钟，再失败 5 分钟，再失败 30 分钟，然后就不再自动试了。 */
  const RETRY_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000];
  /** 一个地址最多提交几次链接（被驳回之后才允许再提交一次）。 */
  const PROOF_MAX_SUBMITS = 2;
  const FETCH_TIMEOUT_MS = 10 * 1000;
  const UA = 'ARCBANG-allowlist/1.0 (+https://arcbang.xyz; contact admin@arcbang.xyz)';

  /** 置顶推的 tweet id（回复对象要跟它比）。没配置顶推就回 null。 */
  function pinnedTweetId() {
    const u = pinnedPost();
    if (!u) return null;
    const m = /\/status\/(\d{5,25})/.exec(u);
    return m ? m[1] : null;
  }

  /** 带超时的 fetch。**任何失败都回 null，绝不抛** —— 审核这条路不该被一次网络抖动带崩。 */
  async function getText(url, fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return null;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const r = await f(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: ctl ? ctl.signal : undefined });
      if (!r || !r.ok) return null;
      return await r.text();
    } catch (e) { return null; }
    finally { if (timer) clearTimeout(timer); }
  }

  /**
   * 把一条推文取回来。回 { author, text, replyTo, via } 或 null。
   * replyTo 为 null 表示**这条路查不出回复对象**（oEmbed），不是「它不是回复」。
   */
  async function fetchTweet(id, url, fetchImpl) {
    /* 首选 syndication：只有它给得出回复对象。token 随便填一个，它只用来做缓存分片。 */
    const sy = await getText('https://cdn.syndication.twimg.com/tweet-result?id='
      + encodeURIComponent(id) + '&token=' + (Number(id) % 97 || 7), fetchImpl);
    if (sy) {
      try {
        const j = JSON.parse(sy);
        const author = j && j.user && j.user.screen_name;
        if (author) {
          const replyTo = j.in_reply_to_status_id_str
            || (j.parent && (j.parent.id_str || (j.parent.conversation_id_str)))
            || j.conversation_id_str || null;
          return { author: String(author), text: String(j.text || ''), replyTo: replyTo ? String(replyTo) : null, via: 'syndication' };
        }
      } catch (e) { /* 不是 JSON：当这条路没走通，往下退 */ }
    }
    /* 退路 oEmbed：HTML 里能看出作者与正文，**看不出回复对象**。 */
    const ob = await getText('https://publish.twitter.com/oembed?omit_script=1&url=' + encodeURIComponent(url), fetchImpl);
    if (ob) {
      try {
        const j = JSON.parse(ob);
        const html = String(j.html || '');
        const author = /twitter\.com\/([A-Za-z0-9_]{1,15})\/status\//.exec(html)
          || /x\.com\/([A-Za-z0-9_]{1,15})\/status\//.exec(html);
        /* 正文：把标签剥掉就够了 —— 我们只在里面找一个 6 位的码。 */
        const text = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ');
        const name = (author && author[1]) || (j.author_url && /\/([A-Za-z0-9_]{1,15})\/?$/.exec(j.author_url) || [])[1];
        if (name) return { author: String(name), text: text, replyTo: null, via: 'oembed' };
      } catch (e) { /* 同上 */ }
    }
    return null;
  }

  /**
   * 核一条已经提交的链接。**只读**，不写盘 —— 写盘由调用方按结果做。
   * @returns {{ok:boolean, partial:boolean, reason:string|null, via:string|null}}
   */
  async function checkProof(addr, url, fetchImpl) {
    const a = normAddr(addr);
    const m = PROOF_RE.exec(String(url || ''));
    if (!a || !m) return { ok: false, partial: false, reason: 'BAD_URL', via: null };
    const t = await fetchTweet(m[2], 'https://x.com/' + m[1] + '/status/' + m[2], fetchImpl);
    if (!t) return { ok: false, partial: false, reason: 'FETCH_FAILED', via: null };
    const mine = xOf(a);
    if (!mine || String(t.author).toLowerCase() !== String(mine).toLowerCase()) {
      return { ok: false, partial: false, reason: 'AUTHOR_MISMATCH', via: t.via };
    }
    const code = codeOf(a);
    if (!code || String(t.text).toUpperCase().indexOf(code) < 0) {
      return { ok: false, partial: false, reason: 'CODE_NOT_FOUND', via: t.via };
    }
    const want = pinnedTweetId();
    if (!want) {
      /* 置顶推都没配，没什么可比的：前两项对上就算过（配了再核这一项）。 */
      return { ok: true, partial: false, reason: null, via: t.via };
    }
    if (t.replyTo == null) {
      /* oEmbed 那条路看不出回复对象：**不自动通过**，标 partial 进待审。
         「查不到」和「不是回复」是两件事，不能混成一件。 */
      return { ok: false, partial: true, reason: 'REPLY_UNKNOWN', via: t.via };
    }
    if (String(t.replyTo) !== String(want)) {
      return { ok: false, partial: false, reason: 'NOT_REPLY_TO_PINNED', via: t.via };
    }
    return { ok: true, partial: false, reason: null, via: t.via };
  }

  /** 把一次核验的结果落盘。ok 就顺手把转发勾打上（by:'auto'）。 */
  function applyProofResult(addr, res, now) {
    const a = normAddr(addr);
    const t = now == null ? Date.now() : now;
    mutState((n) => {
      const p = n.proof.get(a);
      if (!p) return;
      p.tries = (p.tries || 0) + 1;
      p.lastAt = new Date(t).toISOString();
      p.via = res.via || null;
      if (res.ok) {
        p.status = 'ok'; p.reason = null; p.nextAt = null;
        if (!n.repost.has(a)) n.repost.set(a, { at: p.lastAt, by: 'auto' });
      } else {
        p.reason = res.reason;
        /* **只有「没取到」才值得重试**。作者不符 / 没找到码 / 不是回复置顶推
           都是确定的结论，再取一百次也是同一个答案 —— 那种直接停在待审，
           等管理员看一眼（或者驳回之后让用户重提）。
           partial（oEmbed 查不到回复对象）同理：换条路也还是查不到。 */
        const retryable = res.reason === 'FETCH_FAILED';
        const delay = retryable ? RETRY_MS[p.tries - 1] : null;
        p.status = res.partial ? 'partial' : (delay == null ? 'pending' : 'retry');
        p.nextAt = delay == null ? null : new Date(t + delay).toISOString();
      }
      n.proof.set(a, p);
    });
    return proofOf(a);
  }

  function proofOf(addr) {
    const a = normAddr(addr);
    return (a && state().proof.get(a)) || null;
  }

  /**
   * POST /api/allowlist/proof {address, url, sig}
   * 收下链接 → 立刻核一次 → 核过就自动打转发勾，没核过就进待审 / 排重试。
   * 一个地址最多提交 PROOF_MAX_SUBMITS 次，而且**只有被驳回之后**才允许再提交。
   */
  async function submitProof(input, ip, now, fetchImpl) {
    const b = input && typeof input === 'object' ? input : {};
    const addr = normAddr(b.address);
    if (!addr) return { status: 400, body: { error: '地址不对' } };
    const sig = String(b.sig == null ? '' : b.sig).trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return { status: 400, body: { error: '签名格式不对' } };
    let who = null;
    try { who = verifyMessage(registerMessage(addr), sig); }
    catch (e) { return { status: 400, body: { error: '签名验不过' } }; }
    if (String(who).toLowerCase() !== addr) return { status: 400, body: { error: '签名和地址对不上' } };
    if (!loadApplied().has(addr)) return { status: 403, body: { error: '这个地址还没登记，先去登记' } };

    const old = proofOf(addr);
    if (old && !old.rejected) {
      return { status: 409, body: { error: '你已经提交过一条链接了，提交之后不能改。', already: true, proof: old } };
    }
    if (old && (old.submits || 1) >= PROOF_MAX_SUBMITS) {
      return { status: 409, body: { error: '提交次数已用完（最多 ' + PROOF_MAX_SUBMITS + ' 次），将转人工复核。', proof: old } };
    }
    const url = String(b.url == null ? '' : b.url).trim();
    const m = PROOF_RE.exec(url);
    if (!m) return { status: 400, body: { error: '要给一条推文链接（https://x.com/用户名/status/数字）' } };
    const mine = xOf(addr);
    if (!mine || m[1].toLowerCase() !== String(mine).toLowerCase()) {
      return { status: 400, body: { error: '这条链接不是 @' + (mine || '?') + ' 发的。请贴你自己那条回复的链接。' } };
    }
    /* 存规范化之后的那一份：去掉 query 和锚点，域名统一成 x.com。审核的人点的是它。 */
    const clean = 'https://x.com/' + m[1] + '/status/' + m[2];
    const at = new Date(now == null ? Date.now() : now).toISOString();
    const submits = old ? (old.submits || 1) + 1 : 1;
    try {
      mutState((n) => {
        n.proof.set(addr, { url: clean, at, submits, tries: 0, status: 'new', reason: null, nextAt: null, via: null, rejected: false });
      });
    } catch (e) {
      console.error('[allowlist] 回复链接存不下：' + (e && e.message));
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    /* 立刻核一次。**取不到也只是进重试**，不该让用户的提交失败。 */
    const res = await checkProof(addr, clean, fetchImpl);
    const rec = applyProofResult(addr, res, now);
    return { status: 200, body: { ok: true, proof: rec, auto: res.ok, reason: res.reason, points: scoreOf(addr).total } };
  }

  /**
   * 重试队列。到点的那些重新核一遍，回处理了几条。
   * 排队信息就在 proof 记录里（tries / nextAt），所以**进程重启照样接着重试**。
   */
  async function runProofQueue(now, fetchImpl) {
    const t = now == null ? Date.now() : now;
    const due = [];
    for (const [addr, p] of state().proof) {
      if (!p || p.status === 'ok' || p.rejected) continue;
      if (!p.nextAt || Date.parse(p.nextAt) > t) continue;
      if ((p.tries || 0) >= RETRY_MS.length) continue;
      due.push([addr, p]);
    }
    let done = 0;
    for (const [addr, p] of due) {
      const res = await checkProof(addr, p.url, fetchImpl);
      applyProofResult(addr, res, t);
      done++;
    }
    return { checked: done };
  }


  /* ---------------------------------------------------------------- 创作推文
     用户自己发一条**提到本站、带 #ARCBANG** 的推（内容随意：宇宙截图、感想都行），
     把链接贴回来，服务端自动核：作者对得上、正文里两样都在、而且不是转发。
     过了 +ARCBANG_PTS_POST 分一条，限每周 ARCBANG_PTS_POST_PER_WEEK 条、
     预热期共 ARCBANG_PTS_POST_MAX 条（默认 4）—— 不限的话这一项就是个刷帖机。

     跟「转发置顶推」那一项分开存：那一项一个地址只有一条，这一项是一串。 */
  const HASHTAG = '#ARCBANG';
  function postsOf(addr) {
    const a = normAddr(addr);
    return (a && state().posts.get(a)) || [];
  }
  /** 最近 7 天发过几条（不管过没过 —— 限的是提交频率，不是通过率）。 */
  function postsThisWeek(addr, now) {
    const t = now == null ? Date.now() : now;
    return postsOf(addr).filter((x) => x.at && (t - Date.parse(x.at)) < 7 * DAY).length;
  }

  /**
   * 核一条创作推文。**只读**，不写盘。
   * @returns {{ok:boolean, reason:string|null, via:string|null}}
   */
  async function checkPost(addr, url, fetchImpl) {
    const a = normAddr(addr);
    const m = PROOF_RE.exec(String(url || ''));
    if (!a || !m) return { ok: false, reason: 'BAD_URL', via: null };
    const t = await fetchTweet(m[2], 'https://x.com/' + m[1] + '/status/' + m[2], fetchImpl);
    if (!t) return { ok: false, reason: 'FETCH_FAILED', via: null };
    const mine = xOf(a);
    if (!mine || String(t.author).toLowerCase() !== String(mine).toLowerCase()) {
      return { ok: false, reason: 'AUTHOR_MISMATCH', via: t.via };
    }
    const text = String(t.text || '');
    /* 转发不算「创作」：syndication 给的转发正文以 RT @ 开头。 */
    if (/^\s*RT\s+@/i.test(text)) return { ok: false, reason: 'IS_RETWEET', via: t.via };
    if (text.toLowerCase().indexOf('@' + xHandle().toLowerCase()) < 0) {
      return { ok: false, reason: 'NO_MENTION', via: t.via };
    }
    if (text.toUpperCase().indexOf(HASHTAG) < 0) return { ok: false, reason: 'NO_HASHTAG', via: t.via };
    return { ok: true, reason: null, via: t.via };
  }

  /**
   * POST /api/allowlist/post {address, url, sig}
   * 收下链接 → 立刻核一次。取不到就排重试（与 proof 同一套 RETRY_MS）。
   */
  async function submitPost(input, ip, now, fetchImpl) {
    const b = input && typeof input === 'object' ? input : {};
    const addr = normAddr(b.address);
    if (!addr) return { status: 400, body: { error: '地址不对' } };
    const sig = String(b.sig == null ? '' : b.sig).trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return { status: 400, body: { error: '签名格式不对' } };
    let who = null;
    try { who = verifyMessage(registerMessage(addr), sig); }
    catch (e) { return { status: 400, body: { error: '签名验不过' } }; }
    if (String(who).toLowerCase() !== addr) return { status: 400, body: { error: '签名和地址对不上' } };
    if (!loadApplied().has(addr)) return { status: 403, body: { error: '这个地址还没登记，先去登记' } };

    const P = pointsTable();
    const list = postsOf(addr);
    if (list.length >= P.postMax) {
      return { status: 409, body: { error: '预热期最多交 ' + P.postMax + ' 条，你已经交满了。' } };
    }
    if (postsThisWeek(addr, now) >= P.postPerWeek) {
      return { status: 429, body: { error: '这一周最多交 ' + P.postPerWeek + ' 条，下周再来。' } };
    }
    const url = String(b.url == null ? '' : b.url).trim();
    const m = PROOF_RE.exec(url);
    if (!m) return { status: 400, body: { error: '要给一条推文链接（https://x.com/用户名/status/数字）' } };
    const mine = xOf(addr);
    if (!mine || m[1].toLowerCase() !== String(mine).toLowerCase()) {
      return { status: 400, body: { error: '这条链接不是 @' + (mine || '?') + ' 发的。' } };
    }
    const clean = 'https://x.com/' + m[1] + '/status/' + m[2];
    if (list.some((x) => x.url === clean)) {
      return { status: 409, body: { error: '这一条已经交过了。' } };
    }
    const at = new Date(now == null ? Date.now() : now).toISOString();
    mutState((nn) => {
      const arr = (nn.posts.get(addr) || []).slice();
      arr.push({ url: clean, at, status: 'new', reason: null, tries: 0, nextAt: null, via: null });
      nn.posts.set(addr, arr);
    });
    const res = await checkPost(addr, clean, fetchImpl);
    applyPostResult(addr, clean, res, now);
    return {
      status: 200,
      body: { ok: true, auto: res.ok, reason: res.reason, posts: postsOf(addr), points: scoreOf(addr).total }
    };
  }

  function applyPostResult(addr, url, res, now) {
    const a = normAddr(addr);
    const t = now == null ? Date.now() : now;
    mutState((nn) => {
      const arr = (nn.posts.get(a) || []).slice();
      const i = arr.findIndex((x) => x.url === url);
      if (i < 0) return;
      const x = Object.assign({}, arr[i]);
      x.tries = (x.tries || 0) + 1;
      x.via = res.via || null;
      if (res.ok) { x.status = 'ok'; x.reason = null; x.nextAt = null; }
      else {
        x.reason = res.reason;
        /* 同 proof：只有「取不到」值得重试，其余是确定结论。 */
        const delay = res.reason === 'FETCH_FAILED' ? RETRY_MS[x.tries - 1] : null;
        x.status = delay == null ? 'bad' : 'retry';
        x.nextAt = delay == null ? null : new Date(t + delay).toISOString();
      }
      arr[i] = x;
      nn.posts.set(a, arr);
    });
  }

  /** 创作推文那一串的重试队列（与 runProofQueue 分开，跑法一样）。 */
  async function runPostQueue(now, fetchImpl) {
    const t = now == null ? Date.now() : now;
    const due = [];
    for (const [addr, arr] of state().posts) {
      for (const x of arr || []) {
        if (!x || x.status === 'ok' || x.status === 'bad') continue;
        if (!x.nextAt || Date.parse(x.nextAt) > t) continue;
        if ((x.tries || 0) >= RETRY_MS.length) continue;
        due.push([addr, x.url]);
      }
    }
    let done = 0;
    for (const [addr, url] of due) {
      const res = await checkPost(addr, url, fetchImpl);
      applyPostResult(addr, url, res, t);
      done++;
    }
    return { checked: done };
  }
  /** 管理员驳回一条提交：允许用户再提交一次（最多 PROOF_MAX_SUBMITS 次）。 */
  function rejectProof(token, why) {
    const a = normAddr(token) || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址' };
    if (!proofOf(a)) return { ok: false, error: '这个地址没有提交过链接' };
    mutState((n) => {
      const p = n.proof.get(a);
      if (!p) return;
      p.rejected = true;
      p.status = 'rejected';
      p.reason = String(why || p.reason || 'REJECTED');
      p.nextAt = null;
      n.proof.set(a, p);
      n.repost.delete(a);              // 驳回就把那个勾一起撤掉
    });
    return { ok: true, addr: a, proof: proofOf(a) };
  }

  /* ---------------------------------------------------------------- 关注 / 点赞：默认信任
     这两项在 X 上没有任何免 key 的办法能查，所以用户点一下就计分（by:'trust'）。
     管理员抽查撤销之后，这个地址整个失去信任：之后这两项只能由管理员手动打勾 ——
     不然撤了他再点一次就回来了，那道撤销等于没有。 */
  function isDistrusted(addr) { const a = normAddr(addr); return !!a && state().distrust.has(a); }
  /**
   * POST /api/allowlist/claim {address, sig, task, post?}
   * task 认 'follow'，或 'engage' + post=<推文 id 或链接>（点赞 + 转发 + 评论一体）。
   * 老的 'like' / 'repost' / 'comment' 一律折进 'engage' —— 页面上早就只剩一颗按钮了，
   * 但排练站上可能还有旧页面在跑，让它别 400；不带 post 就当置顶推那一条。
   */
  function claim(input, now) {
    const b = input && typeof input === 'object' ? input : {};
    const addr = normAddr(b.address);
    if (!addr) return { status: 400, body: { error: '地址不对' } };
    const raw = String(b.task || '').trim().toLowerCase();
    const task = ENGAGE_PARTS.indexOf(raw) >= 0 ? 'engage' : raw;
    if (CLAIM_TASKS.indexOf(task) < 0) {
      return { status: 400, body: { error: '这一项不能自己声称（认 follow / engage）' } };
    }
    /* 互动是**按推文**的：没指明就当置顶推（老页面只有那一张卡）。
       指了一条表里没有的推文直接拒 —— 不然谁都能给自己随便一条推刷分。 */
    let post = null;
    if (task === 'engage') {
      post = b.post == null || b.post === '' ? (engagePosts()[0] || null) : engagePostOf(b.post);
      if (!post) return { status: 400, body: { error: '没有这条官方推文' } };
    }
    const key = task === 'engage' ? (addr + '|engage:' + post.tweetId) : (addr + '|' + task);
    const sig = String(b.sig == null ? '' : b.sig).trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return { status: 400, body: { error: '签名格式不对' } };
    let who = null;
    try { who = verifyMessage(registerMessage(addr), sig); }
    catch (e) { return { status: 400, body: { error: '签名验不过' } }; }
    if (String(who).toLowerCase() !== addr) return { status: 400, body: { error: '签名和地址对不上' } };
    if (!loadApplied().has(addr)) return { status: 403, body: { error: '这个地址还没登记，先去登记' } };
    if (isDistrusted(addr)) {
      return { status: 403, body: { error: '该地址已被抽查撤销，互动需人工复核。' } };
    }
    const iso = new Date(now == null ? Date.now() : now).toISOString();
    /* 已经做完的就别再收一次 claim：互动看这条推文的三项到齐没有。 */
    if (task === 'engage' ? isEngaged(addr, post.tweetId) : hasCheck(addr, task)) {
      return { status: 200, body: { ok: true, already: true, task, post: post && post.tweetId, points: scoreOf(addr, now).total } };
    }
    /* **接了 X API 就不认自称**（2026-09-18 用户反馈：「这里没做核验」）。
       点这一下只把这一项推进「审核中」，真正的勾要等下一轮去 X 上查到人。
       查不到就 failed，页面写「X 上没查到」，他改完再点一次。

       为什么不干脆把按钮拿掉：**用户需要一个「我做完了」的动作**。
       没有它的话，从关注到打勾中间最多隔十分钟，那十分钟里页面上什么都没发生，
       看着就像点了没用 —— 而这正是这次反馈的由来。 */
    if (apiOn()) {
      const cur = state().claims.get(key) || null;
      if (cur && cur.status === 'pending') {
        return { status: 200, body: { ok: true, pending: true, task, post: post && post.tweetId, claim: cur, points: scoreOf(addr).total } };
      }
      mutState((n) => { n.claims.set(key, { at: iso, status: 'pending' }); });
      return {
        status: 200,
        body: { ok: true, pending: true, task, post: post && post.tweetId, claim: { at: iso, status: 'pending' }, points: scoreOf(addr).total }
      };
    }
    /* 没接 API 时的老样子：点一下就算，记 by:'trust'，管理员可抽查撤销。
       互动那一项是三个勾一起打（页面上本来就只有一颗按钮）。 */
    mutState((n) => {
      if (task !== 'engage') { if (!n[task].has(addr)) n[task].set(addr, { at: iso, by: 'trust' }); return; }
      const pin = pinnedTweetId();
      if (post.tweetId === PINNED_KEY || (pin && post.tweetId === pin)) {
        for (const k of ENGAGE_PARTS) if (!n[k].has(addr)) n[k].set(addr, { at: iso, by: 'trust' });
        return;
      }
      const rec = Object.assign({}, n.engage.get(addr) || {});
      const cur = Object.assign({}, rec[post.tweetId] || {});
      for (const k of ENGAGE_PARTS) if (!cur[k]) cur[k] = iso;
      rec[post.tweetId] = cur;
      n.engage.set(addr, rec);
    });
    return { status: 200, body: { ok: true, task, post: post && post.tweetId, points: scoreOf(addr, now).total } };
  }
  /** 这个地址在这一项上自称过没有，结果如何。task 可以是 'follow' 或 'engage:<推文id>'。 */
  function claimOf(addr, task) {
    const a = normAddr(addr);
    if (!a) return null;
    const t = String(task || '');
    if (CLAIM_TASKS.indexOf(t) < 0 && CHECKS.indexOf(t) < 0 && !/^engage:\d{5,25}$/.test(t)) return null;
    return state().claims.get(a + '|' + t) || null;
  }
  /**
   * X API 那一轮拉回来的结果，一次性写进来（server/xverify.js 每 10 分钟调一次）。
   *
   * @param sets {{follow?:Set<string>, like?:Set<string>, repost?:Set<string>, comment?:Set<string>}}
   *        每一项是**X 的数字 id 集合**（followers / liking_users / retweeted_by /
   *        conversation_id 搜出来的回复作者）。点赞 / 转发 / 评论这三项指的是**置顶推**。
   *        没给的那一项整项跳过 —— 比如置顶推没配时，它们就不该被当成「全空」而清光。
   * @param postSets {{ '<推文id>': {like?:Set, repost?:Set, comment?:Set} }}
   *        置顶推**以外**那几条官方推文各自的三个名单。同样是「没给就跳过」。
   * @returns {{added:object, removed:object, seen:number, posts:object}}
   *
   * 三条规矩：
   *   1. **只认得出有 xId 的人**。手填 X 名的老记录没有 xId，API 说不了话，一律不动。
   *   2. **只撤自己打的勾**（by === 'api'）。管理员手打的、贴链接自动核过的、
   *      用户自称的，都不归这一轮管。
   *   3. 整轮只落一次盘。逐个人调 mutState 的话，一千个人就是一千次全量重写。
   *
   * 被标成不信任的地址照样能被 API 打勾 —— 不信任挡的是「他自己说他做了」，
   * 而 X 的名单里有没有他不是他说了算的。
   */
  function syncApi(sets, now, postSets) {
    loadApplied();
    const iso = new Date(now == null ? Date.now() : now).toISOString();
    const added = {}, removed = {};
    const postStat = {};
    let seen = 0;
    mutState((n) => {
      for (const k of CHECKS) {
        const want = sets && sets[k];
        if (!want) continue;                 // 这一项这一轮没拉到，跳过
        added[k] = 0; removed[k] = 0;
        for (const [xId, addr] of byXid) {
          if (!applied.has(addr)) continue;
          const on = want.has(String(xId));
          const cur = n[k].get(addr);
          const by = cur ? ((typeof cur === 'object' && cur.by) ? cur.by : 'admin') : null;
          if (on && !cur) { n[k].set(addr, { at: iso, by: 'api' }); added[k]++; }
          else if (!on && by === 'api') { n[k].delete(addr); removed[k]++; }
        }
      }
      /* ---- 置顶推以外的官方推文 ----
         每条推文的三个名单各自写进那条推文的记录里。这里**只加不撤**：
         这几条是「做过就算」的一次性任务，旧推文的名单也不保证每轮都拉得到
         （增量拉的是新的那几页），按「没在名单里就撤」会把老数据一轮轮抹掉。 */
      for (const tid in (postSets || {})) {
        const d = postSets[tid];
        if (!d) continue;
        postStat[tid] = 0;
        for (const [xId, addr] of byXid) {
          if (!applied.has(addr)) continue;
          const id = String(xId);
          const hit = {};
          let any = false;
          for (const k of ENGAGE_PARTS) { hit[k] = d[k] ? d[k].has(id) : false; if (hit[k]) any = true; }
          if (!any) continue;
          const rec = Object.assign({}, n.engage.get(addr) || {});
          const cur = Object.assign({}, rec[tid] || {});
          const was = ENGAGE_PARTS.every((k) => !!cur[k]);
          for (const k of ENGAGE_PARTS) if (hit[k] && !cur[k]) cur[k] = iso;
          rec[tid] = cur;
          n.engage.set(addr, rec);
          if (!was && ENGAGE_PARTS.every((k) => !!cur[k])) postStat[tid]++;
        }
      }
      /* ---- 自称的那些「我做完了」，这一轮给个交代 ----
         做到了就把自称记录清掉（勾已经打上了），没做到就标 failed ——
         页面据此写「未通过 · X 上没查到…」，他修好再点一次。
         **不清掉 failed 的话页面永远停在「审核中」**，那比没有反馈还糟。
         判据和页面是同一套：那条推文的点赞 + 转发 + 评论三项到齐。 */
      const pin = pinnedTweetId();
      const pinnedChecked = ENGAGE_PARTS.some((k) => sets && sets[k]);
      /* **只结有 xId 的人**。手填 X 名的老记录 API 说不了话，把他标成 failed
         等于告诉他「你没做」，而其实是我们查不了 —— 那些人留给管理员。 */
      const known = new Set();
      for (const [, addr] of byXid) known.add(addr);
      for (const [ck, v] of n.claims) {
        const i = ck.indexOf('|');
        const addr = i > 0 ? ck.slice(0, i) : null;
        const t = i > 0 ? ck.slice(i + 1) : '';
        if (!addr || !applied.has(addr)) { n.claims.delete(ck); continue; }
        if (!known.has(addr)) continue;
        /* 老键（like / repost / comment / engage）都指置顶推那一条。 */
        const m = /^engage:(\d{5,25})$/.exec(t);
        const tid = m ? m[1] : ((t === 'engage' || ENGAGE_PARTS.indexOf(t) >= 0) ? (pin || PINNED_KEY) : null);
        if (tid == null && t !== 'follow') continue;
        let checked, done;
        if (t === 'follow') {
          checked = !!(sets && sets.follow);
          done = n.follow.has(addr);
        } else if (tid === PINNED_KEY || (pin && tid === pin)) {
          checked = pinnedChecked;
          done = ENGAGE_PARTS.every((k) => n[k].has(addr));
        } else {
          checked = !!(postSets && postSets[tid]);
          const rec = (n.engage.get(addr) || {})[tid] || {};
          done = ENGAGE_PARTS.every((k) => !!rec[k]);
        }
        if (!checked) continue;
        if (done) n.claims.delete(ck);
        else if (v.status !== 'failed') n.claims.set(ck, { at: v.at, status: 'failed', checkedAt: iso });
      }
      seen = byXid.size;
    });
    return { added, removed, seen, posts: postStat };
  }

  /** 管理员抽查撤销：撤掉那几项，并把这个地址标成不再信任。
      2026-09-19：转发那一项不再有例外 —— 它已经不靠「回复里的登记码」认人了，
      跟点赞一样是 X 名单里查出来的，该一起撤。 */
  function distrust(token, which) {
    const a = normAddr(token) || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址' };
    const want = checksOf(which);
    mutState((n) => {
      for (const k of want) n[k].delete(a);
      n.distrust.set(a, new Date().toISOString());
    });
    return { ok: true, addr: a, removed: want, points: scoreOf(a).total };
  }
  /** 恢复信任（撤错了）。 */
  function retrust(token) {
    const a = normAddr(token) || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址' };
    mutState((n) => { n.distrust.delete(a); });
    return { ok: true, addr: a };
  }
  /** 某一项是怎么来的：'admin' / 'auto' / 'trust'（老数据只有 ISO 串，一律当 admin）。 */
  function checkBy(addr, key) {
    const a = normAddr(addr);
    if (!a || CHECKS.indexOf(key) < 0) return null;
    const v = state()[key].get(a);
    if (!v) return null;
    return (typeof v === 'object' && v.by) ? v.by : 'admin';
  }
  /** 「核过了吗」在别处（榜上那个「未核」标、有效邀请的判据）一律指**转发**那一项 ——
      三项里只有它要在评论里回登记码，是唯一能人工对得上人的。 */
  function isVerified(addr) { return hasCheck(addr, 'repost'); }
  /**
   * 引爆记账。
   * @returns {{hashes:string[], days:object, today:number, count:number,
   *            todayPts:number, points:number, full:boolean, dayFull:boolean}}
   *
   * 两道上限都按**分**算（P.bangPerDay / P.bangMax）：
   *   · 当天分 = min(当天次数 × 单次分, 每日上限)
   *   · 总分   = min(各天分之和, 总上限)
   * 这样改单次分值时，两个上限的含义不用跟着改。
   */
  function bangsOf(addr, now) {
    const a = normAddr(addr);
    const P = pointsTable();
    const rec = (a && state().bangs.get(a)) || null;
    const days = (rec && rec.d) || {};
    const hashes = (rec && rec.h) || [];
    const last = Number(rec && rec.last) || 0;
    const day = dayOf(now);
    const today = Number(days[day]) || 0;
    const per = (n) => Math.min(n * P.bang, P.bangPerDay);
    let sum = 0;
    for (const d in days) sum += per(Number(days[d]) || 0);
    const points = Math.min(sum, P.bangMax);
    const gapMs = P.bangIntervalMin * 60 * 1000;
    const t = now == null ? Date.now() : now;
    return {
      hashes, days, day, last,
      /* 下一次能计分的时刻。last 是 0（老数据 / 从没引爆过）时立刻就能。 */
      nextAt: last ? last + gapMs : 0,
      tooSoon: !!last && (t - last) < gapMs,
      today, count: hashes.length,
      todayPts: per(today), points,
      dayFull: per(today) >= P.bangPerDay,
      full: points >= P.bangMax
    };
  }
  /**
   * 引爆并广播的账。**按次算，不按天** —— 每日 sharePerDay 次、累计 shareMax 次。
   * @returns {{days:object, hashes:string[], today:number, count:number,
   *            countedToday:number, counted:number, dayFull:boolean, full:boolean}}
   */
  function sharesOf(addr, now) {
    const a = normAddr(addr);
    const P = pointsTable();
    const rec = (a && state().shares.get(a)) || null;
    const days = (rec && rec.d) || {};
    const hashes = (rec && rec.h) || [];
    const day = dayOf(now);
    const today = Number(days[day]) || 0;
    /* 每天先各自封顶，再一起封总顶。两道顶都是**次数**。 */
    let sum = 0;
    for (const d in days) sum += Math.min(Number(days[d]) || 0, P.sharePerDay);
    const counted = Math.min(sum, P.shareMax);
    const countedToday = Math.min(today, P.sharePerDay);
    return {
      days, hashes, day, today, count: hashes.length,
      countedToday, counted,
      dayFull: countedToday >= P.sharePerDay,
      full: counted >= P.shareMax
    };
  }
  /** 记过分的**天数**。老字段，榜和导出里还在用。 */
  function shareDaysOf(addr) { return Object.keys(sharesOf(addr).days).length; }
  /** 这个地址算数的 X 用户名：管理员修正过就用修正的，否则用登记时那一份。 */
  function xOf(addr) {
    const a = normAddr(addr);
    if (!a) return null;
    const fix = state().xfix.get(a);
    if (fix) return fix;
    const rec = loadApplied().get(a);
    return rec ? rec.x : null;
  }
  /**
   * 管理员人工改 X 用户名。**只有命令行走得到这里** —— 接口上没有任何一条路能改登记内容。
   * 写进状态文件而不是改流水：流水是只追加的，「登记之后不能改」靠的就是这一点。
   */
  function setX(token, xRaw) {
    const a = normAddr(token) || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址' };
    if (!loadApplied().has(a)) return { ok: false, error: '这个地址没有登记过：' + a };
    const x = normX(xRaw);
    if (!x) return { ok: false, error: 'X 用户名不对（1–15 位字母、数字或下划线）' };
    const was = xOf(a);
    mutState((n) => { n.xfix.set(a, x); });
    return { ok: true, addr: a, code: codeOf(a), was, now: x };
  }

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
  function scoreOf(addrRaw, now) {
    const a = normAddr(addrRaw);
    const P = pointsTable();
    const zero = {
      shares: 0, sharesToday: 0,
      registered: false, verified: false, followed: false,
      reposted: false, liked: false, commented: false, engaged: false,
      engagePosts: 0, engageDone: 0, engageRows: [],
      invites: 0, validInvites: 0, countedInvites: 0, shareDays: 0, countedShareDays: 0,
      milestones: P.milestones.map((m) => ({ at: m.at, pts: m.pts, hit: false })),
      posts: 0, okPosts: 0, countedPosts: 0, badPosts: 0,
      bangs: 0, bangToday: 0, bangTodayPts: 0,
      pts: { register: 0, follow: 0, engage: 0, invite: 0, milestone: 0, post: 0, share: 0, bang: 0 },
      total: 0
    };
    if (!a || !loadApplied().has(a)) return zero;
    /* 关注单算；点赞 / 转发 / 评论仍然各记各的勾，但**合起来才给分**。 */
    const followed = hasCheck(a, 'follow');
    const reposted = hasCheck(a, 'repost');
    const liked = hasCheck(a, 'like');
    const commented = hasCheck(a, 'comment');
    const engaged = liked && reposted && commented;
    /* 推文互动：**每条官方推文各算各的**，一条推文的三项到齐就拿那条的分。
       没有每日上限、旧推文不过期 —— 官方每发一条就多一个任务。 */
    const eng = engageStatus(a);
    const invites = inviteCount(a);
    const valid = validInviteCount(a);
    const countedInv = Math.min(valid, P.inviteMax);
    const sh = sharesOf(a, now);
    const days = Object.keys(sh.days).length;
    const countedDays = sh.counted;
    /* 邀请里程碑：在每人 20 分之外，攒到 3/5/10 人再各奖一笔，一档档累加。 */
    const hitMs = P.milestones.filter((m) => valid >= m.at);
    const msPts = hitMs.reduce((s2, m) => s2 + m.pts, 0);
    const posts = postsOf(a);
    const okPosts = posts.filter((x) => x.status === 'ok').length;
    const countedPosts = Math.min(okPosts, P.postMax);
    const bg = bangsOf(a, now);
    const pts = {
      register: P.register,
      follow: followed ? P.follow : 0,
      /* 一体计分：一条推文的点赞 + 转发 + 评论三项到齐才有，缺一项那条就是 0。 */
      engage: eng.points,
      invite: countedInv * P.invite,
      milestone: msPts,
      post: countedPosts * P.post,
      share: countedDays * P.share,
      bang: bg.points
    };
    return {
      registered: true, verified: reposted, followed, reposted, liked, commented, engaged,
      engagePosts: eng.rows.length, engageDone: eng.done, engageRows: eng.rows,
      invites, validInvites: valid, countedInvites: countedInv,
      milestones: P.milestones.map((m) => ({ at: m.at, pts: m.pts, hit: valid >= m.at })),
      posts: posts.length, okPosts, countedPosts,
      badPosts: posts.filter((x) => x.status !== 'ok' && x.status !== 'retry' && x.status !== 'new').length,
      shareDays: days, countedShareDays: countedDays,
      shares: sh.counted, sharesToday: sh.countedToday, shareRaw: sh,
      bangs: bg.count, bangToday: bg.today, bangTodayPts: bg.todayPts,
      pts, total: pts.register + pts.follow + pts.engage
        + pts.invite + pts.milestone + pts.post + pts.share + pts.bang
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
  /**
   * 公开榜的前 n 行。**只给地址缩写和分数**，三样东西一概不出门：
   *   · 名次数字 —— 用户拍板不标 1/2/3，顺序本身已经是排名；
   *   · 审核状态（关注/转发/点赞核没核）—— 那是后台的事，别人看不到；
   *   · 定格之前的 tier —— 画出分界线就等于公布了名额。
   * n 再大也不会越过 BOARD_PUBLIC_MAX：公开的榜只到前 100 名。
   */
  function topRows(n) {
    const lim = Math.max(1, Math.min(Math.floor(Number(n)) || 50, BOARD_PUBLIC_MAX));
    const T = tops();
    const frozen = isFrozen();
    return board().rows.slice(0, lim).map((r) => ({
      addr: r.short, points: r.points,
      /* 每一行都带层级标签。**预热期也带** —— 状态实时可查是产品规则的一部分：
         看榜的人要能一眼看出自己和别人现在在哪一层。 */
      tier: tierOf(r.addr)
    }));
  }

  /**
   * 这个地址在名单里的层：'gtd' / 'fcfs' / null。
   *   · allowlist.json 里的条目**永远赢**（人工覆盖，定格没定格都算）；
   *   · 已定格 → 只认那个文件；
   *   · 没定格 → 按当下的榜实时算。
   */
  /**
   * 这个地址现在在哪一层。**预热期就是实时的**（2026-09-19 用户拍板：状态实时可查）：
   *   · 名次 ≤ GTD_TOP        → 'gtd'  「白名单」，优先铸造
   *   · 其余、且除登记外至少完成一项任务 → 'fcfs' 「先到先得」
   *   · 只登记、一项任务都没做 → null  「未获资格」
   * 定格（freeze）之后以定格结果为准：那时 list() 里有人工写下的一份，直接照它回。
   *
   * 为什么先到先得要挂一个「至少做一件事」的门槛：只登记不做任务是零成本的，
   * 不设门槛的话，一个脚本批量登记就能把免费名额全占上。
   */
  function tierOf(addr, now) {
    const a = normAddr(addr);
    if (!a) return null;
    const L = list();
    const row = L.map.get(a);
    if (row) return row.tier;
    if (L.frozen) return null;                 // 定格之后榜不再决定名单
    const r = board().byAddr.get(a);
    if (!r) return null;
    const T = tops();
    if (r.rank <= T.gtd) return 'gtd';
    if (T.freeLimited && r.rank > T.free) return null;
    return tasksDone(a, now) >= 1 ? 'fcfs' : null;
  }
  /**
   * 除登记之外做成了几件事。层级判据用它，页面上那个「已完成任务 x / 8」也用它。
   * 「做成」的口径与任务卡上的胶囊一致：核过的勾、拿到分的邀请 / 创作 / 引爆 / 打卡。
   */
  function tasksDone(addr, now) {
    const a = normAddr(addr);
    if (!a) return 0;
    const s = scoreOf(a, now);
    let n = 0;
    if (s.followed) n++;
    if ((s.engageDone || 0) > 0 || s.liked || s.reposted || s.commented) n++;
    if ((s.validInvites || 0) > 0) n++;
    if ((s.okPosts || 0) > 0) n++;
    if ((s.shareDays || 0) > 0) n++;
    if ((s.pts && s.pts.bang > 0)) n++;
    return n;
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
      /* 实时两档人数：名次进线的算白名单，其余做过任务的算先到先得。
         这一份**预热期就对外显示**（用户 2026-09-19：状态实时可查）。 */
      const rows = board().rows;
      for (let i = 0; i < rows.length; i++) {
        const a = rows[i].addr;
        if (seen.has(a)) continue;
        if (i < T.gtd) { seen.set(a, 'gtd'); continue; }
        if (T.freeLimited && i >= T.free) break;
        if (tasksDone(a) >= 1) seen.set(a, 'fcfs');
      }
    }
    let gtd = 0, fcfs = 0;
    for (const v of seen.values()) { if (v === 'gtd') gtd++; else fcfs++; }
    return {
      gtd, fcfs, total: gtd + fcfs, frozen: L.frozen,
      gtdTop: T.gtd, freeTop: T.freeLimited ? T.free : null
    };
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
    /* 2026-09-19 用户改口径：**两档人数实时显示**（状态实时可查）。
       但**名额上限仍然不公布** —— gtdTop / freeTop 在定格之前一律 null。
       人数是事实（现在有多少人站在这一层），上限是承诺（我们要发多少个），两件事。 */
    if (!c.frozen) {
      return { frozen: false, gtd: c.gtd, fcfs: c.fcfs, total: c.total, gtdTop: null, freeTop: null };
    }
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

  /** 下一步该做什么（给页面上那句「接下来」用）。按任务顺序给第一个没做完的。
      登记排在最前面**不是**因为它最重要，而是因为不登记就没有「你」这个条目，
      X 三连核过了也无处记分。 */
  function nextStep(addrRaw) {
    const s = scoreOf(addrRaw);
    const P = pointsTable();
    if (!s.registered) return { key: 'register', pts: P.register };
    if (!s.followed) return { key: 'follow', pts: P.follow };
    /* 推文互动：还有没做完的官方推文就指第一条没做完的那张卡。 */
    const und = (s.engageRows || []).find((r) => !r.ok);
    if (und) return { key: 'engage', pts: und.pts, post: und.tweetId };
    if (s.validInvites < P.inviteMax) return { key: 'invite', pts: P.invite };
    if (s.okPosts < P.postMax) return { key: 'post', pts: P.post };
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

  /** which：要打哪几个勾。不给（或给空）= **三个都打**，这是日常最常用的那一种。
      给 {repost:true} 之类就只打那一项。认不出的键一律忽略。 */
  function checksOf(which) {
    if (!which || typeof which !== 'object') return CHECKS.slice();
    const picked = CHECKS.filter((k) => which[k]);
    return picked.length ? picked : CHECKS.slice();
  }

  /**
   * **verify**：管理员核对完 X 上那三件事，给这个地址打勾。
   * 默认三个都打（关注 + 转发并回登记码 + 点赞）；`--follow` / `--repost` / `--like` 单打。
   * 它**不直接进名单** —— 名单是榜算出来的。收登记码或地址。
   * （旧名 approve 语义已改，命令行保留同名别名指向这里。）
   */
  function verify(token, which) {
    const byAddr = normAddr(token);
    const a = byAddr || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址（码撞车时请直接用地址）' };
    const ap = appliedOf(a);
    if (!ap) return { ok: false, error: '这个地址没有登记过：' + a };
    const want = checksOf(which);
    const s = state();
    const added = want.filter((k) => !s[k].has(a));
    if (!added.length) {
      return { ok: true, already: true, addr: a, code: ap.code, x: xOf(a), checks: want, points: scoreOf(a).total };
    }
    const at = new Date().toISOString();
    mutState((n) => { for (const k of added) n[k].set(a, at); });
    return { ok: true, addr: a, code: ap.code, x: xOf(a), checks: want, added, points: scoreOf(a).total };
  }
  /** 撤销（核错了）。默认三个都撤，同样能单撤。 */
  function unverify(token, which) {
    const a = normAddr(token) || addrOfCode(token);
    if (!a) return { ok: false, error: '认不出这个登记码或地址' };
    const want = checksOf(which);
    const s = state();
    const gone = want.filter((k) => s[k].has(a));
    if (!gone.length) return { ok: true, already: true, addr: a, checks: want };
    mutState((n) => { for (const k of gone) n[k].delete(a); });
    return { ok: true, addr: a, checks: want, removed: gone, points: scoreOf(a).total };
  }

  /* ---------------------------------------------------------------- 接口：登记 */
  /**
   * POST /api/allowlist/register
   * 登记 = 上榜 + 拿登记码 + 得 ARCBANG_PTS_REGISTER 分。名单由榜算，这里不发名额。
   * @returns {{status:number, body:object}}
   */
  /**
   * @param session 用 X 登录拿到的那一份 {id, handle}（server/xauth.js 验过 cookie 之后传进来）。
   *   给了就用它 —— **X 名不再由用户自己填**，自动核推文时也拿它比作者。
   *   没给（还没开通 X 登录）才退回手填那条老路，记录里标 xSource:'typed'。
   */
  function register(input, ip, session) {
    const b = input && typeof input === 'object' ? input : {};
    const addr = normAddr(b.address);
    if (!addr) return { status: 400, body: { error: '地址不对（要 0x 开头的 40 位十六进制，且不能是零地址）' } };
    const sess = session && session.id && session.handle ? session : null;
    const x = sess ? normX(sess.handle) : normX(b.xHandle);
    if (!x) return { status: 400, body: { error: 'X 用户名不对（1–15 位字母、数字或下划线）' } };
    const xId = sess ? String(sess.id) : null;
    /* **一个 X 账号只能绑一个地址**。认的是 xId 不是 handle —— 改名字 xId 不变。
       没这一条的话，一个人用同一个 X 号就能把所有任务分刷到任意多个地址上。 */
    if (xId) {
      const had = addrOfXid(xId);
      if (had && had !== addr) {
        return { status: 409, body: { error: '这个 X 账号已经绑过另一个地址了。一个 X 账号只能绑一个地址。', boundTo: shortAddr(had) } };
      }
    }
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

    /* **登记之后就不能改了**（2026-09-18 用户拍板）：第二次提交一律 409，
       X 用户名与邀请码首次写下就定死。
       为什么是 409 而不是「静默当成功」：改不了这件事必须**看得见** ——
       静默成功的话，改了 X 名的人会一直以为改上了，直到审核时对不上评论才发现。
       回原记录（码 / X 名 / 登记时间），页面拿它直接渲染「已登记」卡片。
       真要修的只有一条路：管理员命令行 `allowlist.js setx <地址> <新X名>`。 */
    const seen = loadApplied();
    const old = seen.get(addr);
    if (old) {
      return {
        status: 409,
        body: {
          error: '这个地址已经登记过了，登记内容不能修改。要改 X 用户名请联系我们。',
          already: true, code: old.code, x: xOf(addr), at: old.at,
          xSource: old.xSource || 'typed',
          ref: old.ref || null, points: scoreOf(addr).total
        }
      };
    }

    if (typeof take === 'function') {
      const r = take('alreg:' + (ip || '?'), REGISTER_PER_IP_DAY, DAY);
      if (r && r.ok === false) {
        return { status: 429, body: { error: '这个网络今天登记的地址已到上限（每天 ' + REGISTER_PER_IP_DAY + ' 个），明天再来', resetAt: r.resetAt } };
      }
    }
    if (seen.size >= MAX_APPLIED) return { status: 503, body: { error: '登记通道暂时满了，稍后再试' } };

    /* IP 只留前缀 —— 审核时看得出「同一个网段一口气登记 20 个」，又不是完整地址。 */
    const rec = {
      addr, x, xId, xSource: xId ? 'oauth' : 'typed',
      ref: ref || null, inviter: inviter || null, ip: ipPrefix(ip), at: new Date().toISOString()
    };
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
    if (xId) byXid.set(xId, addr);
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

    const cur = sharesOf(addr, now);
    const day = cur.day;
    const low = hash.toLowerCase();
    const out = (extra) => ({
      status: 200,
      body: Object.assign({
        ok: true, day, shares: cur.counted, today: cur.countedToday,
        shareDays: Object.keys(cur.days).length, points: scoreOf(addr, now).total
      }, extra || {})
    });
    /* 同一个区块只计一次：不然对着同一次引爆点三下广播就是三次分。 */
    if (cur.hashes.indexOf(low) >= 0) return out({ already: true });
    /* 到顶之后就不再写盘了：写下去也不加分，只是让文件白白变长。 */
    if (cur.full) return out({ capped: 'total' });
    if (cur.dayFull) return out({ capped: 'day' });
    const nextRec = { d: Object.assign({}, cur.days), h: cur.hashes.concat([low]) };
    nextRec.d[day] = (Number(nextRec.d[day]) || 0) + 1;
    try { mutState((n) => { n.shares.set(addr, nextRec); }); }
    catch (e) {
      console.error('[allowlist] 广播记不下去：' + (e && e.message));
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    const after = sharesOf(addr, now);
    return {
      status: 200,
      body: {
        ok: true, counted: true, day, hash: low,
        shares: after.counted, today: after.countedToday,
        shareDays: Object.keys(after.days).length, points: scoreOf(addr, now).total
      }
    };
  }

  /**
   * POST /api/allowlist/bang {address, hash, sig}
   * 在模拟器里真引爆一次就 +1 分。sig 还是登记时那一次签名（不弹钱包）。
   *
   * 五道闸，缺一不可：
   *   1. **地址得先登记**。没登记的人计分没有意义，榜上也没有他。
   *   2. **hash 得是真的 Arc 区块**。调用方自己编一个 64 位十六进制串是最省事的刷法，
   *      所以这里回头找链要一次（index.js 注入 readBlock，命中卡缓存时不额外打 RPC）。
   *      读不到链**拒绝计分**而不是放行 —— 放行等于把这道闸交给网络抖动。
   *   3. **同地址同区块只算一次**。不然对着同一个块点一百下就是一百分。
   *   4. 每日上限 + 总上限（见 bangsOf）。
   *   5. 每地址每分钟最多 3 次入账。上面四道都是「算不算分」，这一道是「让不让写盘」——
   *      一个脚本一秒钟能发几百个请求，前四道拦得住分数，拦不住盘。
   *
   * @param readBlock 可选：async (hash) => 区块对象或 null。不给就不做第 2 道校验
   *                  （自检里用假的；线上 index.js 一定会给）。
   */
  async function bang(input, ip, now, readBlock) {
    const b = input && typeof input === 'object' ? input : {};
    const addr = normAddr(b.address);
    if (!addr) return { status: 400, body: { error: '地址不对' } };
    const hash = String(b.hash == null ? '' : b.hash).trim().toLowerCase();
    if (!HASH_RE.test(hash)) return { status: 400, body: { error: '要给引爆的那个区块哈希' } };
    const sig = String(b.sig == null ? '' : b.sig).trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return { status: 400, body: { error: '签名格式不对' } };
    let who = null;
    try { who = verifyMessage(registerMessage(addr), sig); }
    catch (e) { return { status: 400, body: { error: '签名验不过' } }; }
    if (String(who).toLowerCase() !== addr) return { status: 400, body: { error: '签名和地址对不上' } };
    if (!loadApplied().has(addr)) return { status: 403, body: { error: '这个地址还没登记，请先完成登记' } };

    const P = pointsTable();
    const cur = bangsOf(addr, now);
    /* 已经算过的区块、当天到顶、总量到顶：都回 200 并说明原因 ——
       这三件事对用户都不是错误，页面照常显示进度，不该弹红字。 */
    if (cur.hashes.indexOf(hash) >= 0) {
      return { status: 200, body: { ok: true, already: true, bangs: cur.count, today: cur.today,
        todayPts: cur.todayPts, points: scoreOf(addr, now).total } };
    }
    if (cur.full) {
      return { status: 200, body: { ok: true, capped: 'total', bangs: cur.count, today: cur.today,
        todayPts: cur.todayPts, points: scoreOf(addr, now).total } };
    }
    if (cur.dayFull) {
      return { status: 200, body: { ok: true, capped: 'day', bangs: cur.count, today: cur.today,
        todayPts: cur.todayPts, points: scoreOf(addr, now).total } };
    }
    /* 两次计分之间的最短间隔。**不写盘、不读链、页面静默** ——
       它跟「这个区块已经算过」一样是状态不是错误：那颗按钮本来就随便点，
       弹一句「太快了」只会让正常玩的人以为自己做错了什么。 */
    if (cur.tooSoon) {
      return { status: 200, body: { ok: true, capped: 'interval',
        nextAt: new Date(cur.nextAt).toISOString(),
        bangs: cur.count, today: cur.today, todayPts: cur.todayPts, points: scoreOf(addr, now).total } };
    }
    /* 频率闸放在「确定要写盘」之前、链上校验之前：读链是要花时间的，
       别让一个刷子把我们的 RPC 也一起拖下水。 */
    if (typeof take === 'function') {
      const r = take('albang:' + addr, BANG_PER_MIN, 60 * 1000);
      if (r && r.ok === false) {
        return { status: 429, body: { error: '引爆记分太频繁，稍后再试', resetAt: r.resetAt } };
      }
    }
    if (typeof readBlock === 'function') {
      let blk = null;
      try { blk = await readBlock(hash); }
      catch (e) {
        console.error('[allowlist] 引爆计分读链失败：' + (e && e.message));
        return { status: 503, body: { error: '链上节点暂时打不通，稍后再试' } };
      }
      if (!blk) return { status: 400, body: { error: '这个哈希在链上查不到，不是一个真实区块' } };
    }

    const day = cur.day;
    const nextRec = { h: cur.hashes.concat([hash]), d: Object.assign({}, cur.days),
      last: now == null ? Date.now() : now };
    nextRec.d[day] = (Number(nextRec.d[day]) || 0) + 1;
    try { mutState((n) => { n.bangs.set(addr, nextRec); }); }
    catch (e) {
      console.error('[allowlist] 引爆记分写不下去：' + (e && e.message));
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    const after = bangsOf(addr, now);
    return {
      status: 200,
      body: {
        ok: true, counted: true, hash,
        bangs: after.count, today: after.today, todayPts: after.todayPts,
        bangPts: after.points, points: scoreOf(addr, now).total
      }
    };
  }

  /* ================================================================ 排练数据
     只给排练站用：造一批模拟登记，让榜、统计、层级标签、管理员页都有东西可看。
     **确定性伪随机**：同一个 base 造出来的地址、X 名、完成度逐字相同，
     排练站重来一遍还是同一张榜 —— 截图和 bug 报告才对得上。
     每条都带 seed:true，unseed 按它删，真实登记一条不动。 */

  /** xorshift32。不用 Math.random：那个给不出「同一个种子同一张榜」。 */
  function rngOf(seed) {
    let x = (Number(seed) || 1) >>> 0 || 1;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  }
  function seedAddr(base, i) {
    /* 从 (base, i) 算一个 20 字节地址。走 keccak 是为了拿到看着像真地址的分布，
       而不是 0x0000…0001 那种一眼假的东西。 */
    const h = crypto.createHash('sha256').update('arcbang-seed:' + base + ':' + i).digest('hex');
    return '0x' + h.slice(0, 40);
  }

  /**
   * @param n    造几条
   * @param base 随机种子（同一个 base 结果完全一样）
   * @returns {{added:number, skipped:number}}
   */
  function seed(n, base) {
    const N = Math.max(1, Math.min(5000, Math.floor(Number(n) || 0)));
    const B = Math.floor(Number(base) || 20260919);
    const now = Date.now();
    const seen = loadApplied();
    const P = pointsTable();
    let added = 0, skipped = 0;
    const lines = [];
    /* 状态改动攒到最后一次写：mutState 每次都是整份重写，一百二十个人就是一百二十次。 */
    const todo = [];
    for (let i = 0; i < N; i++) {
      const addr = seedAddr(B, i);
      if (seen.has(addr)) { skipped++; continue; }
      const rnd = rngOf(B + i * 7919);
      /* 登记时间铺在最近 7 天里：榜的同分排序按登记时间，全挤在同一毫秒就看不出排序效果。 */
      const at = new Date(now - Math.floor(rnd() * 7 * 24 * 3600 * 1000)).toISOString();
      const rec = {
        addr,
        x: 'arc_user_' + String(i + 1).padStart(3, '0'),
        xId: null, xSource: 'typed',
        ref: null, inviter: null, ip: '203.0.113',      // TEST-NET-3，不是真网段
        at, seed: true
      };
      lines.push(JSON.stringify(rec));
      /* 完成度随机：关注与置顶推那三项各自掷一次，邀请 / 创作 / 引爆 / 广播各掷一个数。
         **有意让一部分人一件事都不做** —— 那一档正是「未获资格」，排练时要看得到。
         互动是一体计分的：只有三项都掷中的人才拿得到那 50 分，这正是要摆出来的样子。 */
      const idle = rnd() < 0.18;
      todo.push({
        addr, at,
        follow: !idle && rnd() < 0.72,
        like: !idle && rnd() < 0.62,
        repost: !idle && rnd() < 0.45,
        comment: !idle && rnd() < 0.40,
        invites: idle ? 0 : Math.floor(Math.pow(rnd(), 2.4) * 12),
        posts: idle ? 0 : Math.floor(Math.pow(rnd(), 3) * 4),
        bangs: idle ? 0 : Math.floor(Math.pow(rnd(), 1.6) * (P.bangMax + 6)),
        shareDays: idle ? 0 : Math.floor(Math.pow(rnd(), 1.8) * (P.shareMaxDays + 1))
      });
      added++;
    }
    if (!lines.length) return { added: 0, skipped };
    fs.mkdirSync(path.dirname(appliedFile), { recursive: true });
    fs.appendFileSync(appliedFile, lines.join('\n') + '\n');
    applied = null; byCode = null; byXid = null;         // 逼下次重读流水
    loadApplied();

    mutState((st) => {
      for (const t of todo) {
        if (t.follow) st.follow.set(t.addr, { at: t.at, by: 'seed' });
        if (t.like) st.like.set(t.addr, { at: t.at, by: 'seed' });
        if (t.repost) st.repost.set(t.addr, { at: t.at, by: 'seed' });
        if (t.comment) st.comment.set(t.addr, { at: t.at, by: 'seed' });
        if (t.shareDays > 0) {
          const d = {};
          for (let i2 = 0; i2 < t.shareDays; i2++) d[dayOf(now - i2 * DAY)] = 1;
          st.shares.set(t.addr, { d, h: [] });
        }
        if (t.posts > 0) {
          const arr = [];
          for (let k = 0; k < t.posts; k++) {
            arr.push({ url: 'https://x.com/' + 'arc_seed' + '/status/' + (100000000000 + k), at: t.at, status: 'ok', by: 'seed' });
          }
          st.posts.set(t.addr, arr);
        }
        if (t.bangs > 0) {
          const days = {};
          const hs = [];
          for (let k = 0; k < t.bangs; k++) {
            const d = dayOf(now - (k % 5) * DAY);
            days[d] = (days[d] || 0) + 1;
            hs.push('0x' + crypto.createHash('sha256').update(t.addr + ':' + k).digest('hex'));
          }
          st.bangs.set(t.addr, { h: hs, d: days });
        }
      }
    });
    /* 邀请关系单独一轮：被邀请人要先在流水里存在，inviter 才指得上。
       这里直接改流水里那一份的 inviter 字段代价太大（要重写整个文件），
       所以模拟数据的邀请数用**追加一条带 inviter 的流水**实现 —— 见下。 */
    seedInvites(todo, B);
    boardCache = null;
    return { added, skipped };
  }

  /** 给模拟用户造邀请关系：每个人的 invites 个「下线」也是模拟登记，inviter 指向他。 */
  function seedInvites(todo, base) {
    const lines = [];
    let k = 0;
    for (const t of todo) {
      if (!t.invites) continue;
      for (let i = 0; i < t.invites; i++) {
        const addr = seedAddr(base + 900000, k++);
        if (loadApplied().has(addr)) continue;
        lines.push(JSON.stringify({
          addr, x: 'arc_ref_' + String(k).padStart(4, '0'),
          xId: null, xSource: 'typed',
          ref: codeOf(t.addr), inviter: t.addr, ip: '203.0.113',
          at: t.at, seed: true
        }));
      }
    }
    if (!lines.length) return;
    fs.appendFileSync(appliedFile, lines.join('\n') + '\n');
    applied = null; byCode = null; byXid = null;
    loadApplied();
    /* 有效邀请要求被邀请人**转发核过**，所以给这些下线都打上转发勾 —— 不然邀请分是 0，
       排练时那一列全是空的，看不出里程碑轨道的效果。 */
    const invited = [];
    for (const [a, r] of loadApplied()) if (r.seed && r.inviter) invited.push({ addr: a, at: r.at });
    if (!invited.length) return;
    mutState((st) => {
      for (const v of invited) st.repost.set(v.addr, { at: v.at, by: 'seed' });
    });
  }

  /** 只删模拟登记：流水按 seed 标记重写一遍，状态里对应的条目一并清掉。 */
  function unseed() {
    let kept = 0, removed = 0;
    const keepLines = [];
    const gone = new Set();
    let raw = '';
    try { raw = fs.readFileSync(appliedFile, 'utf8'); } catch (e) { return { removed: 0, kept: 0 }; }
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let j = null;
      try { j = JSON.parse(t); } catch (e) { keepLines.push(t); kept++; continue; }
      if (j && j.seed === true) { removed++; const a = normAddr(j.addr); if (a) gone.add(a); continue; }
      keepLines.push(t); kept++;
    }
    if (!removed) return { removed: 0, kept };
    writeAtomic(appliedFile, keepLines.length ? keepLines.join('\n') + '\n' : '');
    applied = null; byCode = null; byXid = null;
    mutState((st) => {
      for (const a of gone) {
        for (const k of CHECKS) st[k].delete(a);
        st.shares.delete(a);
        st.posts.delete(a);
        st.bangs.delete(a);
        st.proof.delete(a);
        st.xfix.delete(a);
        st.distrust.delete(a);
        for (const k of CHECKS) st.claims.delete(a + '|' + k);
      }
    });
    boardCache = null;
    return { removed, kept };
  }

  /* ---------------------------------------------------------------- 导出（管理员） */
  function appliedRows() {
    return Array.from(loadApplied().values()).map((r) => {
      const s = scoreOf(r.addr);
      const xu = xUserOf(r.xId);
      return Object.assign({}, r, {
        x: xOf(r.addr),                       // 管理员修正过就用修正的
        xCreatedAt: xu ? xu.createdAt : null,
        xFollowers: xu ? xu.followers : null,
        followed: s.followed, reposted: s.reposted, liked: s.liked,
        verified: s.reposted,                 // 「核过了吗」在别处一律指转发那一项
        invites: s.invites,
        validInvites: s.validInvites,
        shareDays: s.shareDays,
        bangs: s.bangs,
        score: s,                             // CSV 要各项分值，别让它再算一遍
        points: s.total,
        rank: rankOf(r.addr),
        tier: tierOf(r.addr)
      });
    });
  }
  /** 每个字段都受正则约束，里面不会出现逗号。 */
  /**
   * 导出 CSV。**按名次排序**，各项积分分开成列 —— 导出的第一用途是「拿去排个序、
   * 筛一批人出来」，所有能筛的维度都得是自己一列。
   *
   * @param top 只要前多少名（不传 = 全部）
   *
   * 两个格式上的讲究：
   *   · 开头写 UTF-8 BOM。不写的话 Excel 会按系统 ANSI 猜，中文列名直接乱码。
   *   · 每个字段都过 q()：X 名、时间里出现逗号或引号时不会把列冲散。
   */
  function appliedCsv(top) {
    let rows = appliedRows().sort((a, b) => (b.points - a.points) || (String(a.at) < String(b.at) ? -1 : 1));
    const n = Math.floor(Number(top) || 0);
    if (n > 0) rows = rows.slice(0, n);
    const q = (v) => {
      const t = String(v == null ? '' : v);
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const head = [
      '名次', '层级', '总积分',
      '登记分', '关注分', '互动分', '邀请分', '里程碑分', '创作分', '引爆分', '广播分',
      '地址', 'X 名', 'X 来源', 'X 注册日期', '粉丝数', '登记码', '邀请人码', '有效邀请', '邀请总数',
      '关注', '推文互动 已完成条数', '推文互动 总条数', '置顶推点赞', '置顶推转发', '置顶推评论',
      '创作通过', '引爆区块数', '广播次数', '广播天数',
      '登记时间', 'IP 前缀', '模拟数据'
    ].join(',');
    const body = rows.map((r) => {
      const sc = r.score || scoreOf(r.addr);
      const pts = sc.pts || {};
      const rec = appliedOf(r.addr) || {};
      return [
        r.rank == null ? '' : r.rank, r.tier || '未获资格', r.points,
        pts.register || 0, pts.follow || 0, pts.engage || 0,
        pts.invite || 0, pts.milestone || 0, pts.post || 0, pts.bang || 0, pts.share || 0,
        /* 档案没抓到时这两格**留空**，不写 0 —— 导出去之后没人分得清
           「粉丝 0」和「还没查」，而这张表的第一用途就是照它筛人。 */
        r.addr, r.x || '', rec.xSource || 'typed',
        (r.xCreatedAt ? String(r.xCreatedAt).slice(0, 10) : ''),
        (r.xFollowers == null ? '' : r.xFollowers),
        r.code, r.ref || '',
        r.validInvites, r.invites,
        r.followed ? '1' : '0', sc.engageDone || 0, (sc.engageRows || []).length,
        sc.liked ? '1' : '0', r.reposted ? '1' : '0', sc.commented ? '1' : '0',
        sc.okPosts || 0, sc.bangs || 0, sc.shares || 0, r.shareDays,
        r.at || '', r.ip || '', rec.seed ? '1' : '0'
      ].map(q).join(',');
    }).join('\n');
    /* \uFEFF = UTF-8 BOM：Excel 认它才不把中文列名读成乱码。 */
    return '\uFEFF' + head + '\n' + body + (rows.length ? '\n' : '');
  }

  /* ---------------------------------------------------------------- 状态 */
  /**
   * GET /api/allowlist/status?addr=
   * 榜和名额是公开规则；**积分明细、登记码、下一步只对查询的那个地址自己说**。
   */
  async function status(addrRaw, now) {
    const p = phaseNow(now);
    const addr = normAddr(addrRaw);
    /* **把 now 传下去**：引爆计分按 UTC 日算「今天」，不传的话自检里那种
       「把时间拨到明天」的场景会拿到今天的数。 */
    const s = scoreOf(addr, now);
    const T = tops();
    const API = apiInfo();
    let freeLeft = null;
    if (readFreeLeft) {
      try { const v = await readFreeLeft(); freeLeft = v == null ? null : Number(v); }
      catch (e) { freeLeft = null; }
    }
    return {
      phase: p,
      /* 层级实时给（不再等定格）：'gtd' 白名单 / 'fcfs' 先到先得 / null 未获资格。 */
      tier: addr ? tierOf(addr, now) : null,
      tasksDone: addr ? tasksDone(addr, now) : 0,
      listed: addr ? !!tierOf(addr) : false,
      freeLeft,                                    // 链上还剩几枚免费额度；null = 这一刻读不到
      opens: opensNow(),
      next: nextOpenNow(now),
      /* **不承诺名额**：定格之前这里的数字全是 null（见 publicCounts 的说明）。 */
      counts: publicCounts(),
      cap: 387,                                    // 合约的硬上限，公开可查，说它不算承诺
      applied: appliedCount(),
      boardSize: board(now).rows.length,
      boardPublicMax: BOARD_PUBLIC_MAX,            // 榜只公布前这么多名
      /* ---- 本人那一份 ---- */
      registered: s.registered,
      /* 置顶推那三个勾仍然分开报（老页面还在读），但计分看的是下面的 engage。 */
      followed: s.followed, reposted: s.reposted, liked: s.liked, commented: s.commented,
      engaged: s.engaged,
      verified: s.reposted,                        // 老字段：指转发那一项
      xHandle: xHandle(), followUrl: followUrl(), likeUrl: likeUrl(),
      /* ---- 推文互动 ----
         一条官方推文一张卡：三行子状态（点赞 / 转发 / 评论）都核到才给这条的分。
         置顶推是第一条；官方每发一条新的就多一张卡，旧的不过期。
         claim 里那一项是 'engage:<推文id>'，页面按 tweetId 取。 */
      engagePosts: addr
        ? s.engageRows.map((r) => Object.assign({}, r, {
          claim: claimOf(addr, 'engage:' + r.tweetId),
          by: (pinnedTweetId() && r.tweetId === pinnedTweetId()) ? checkBy(addr, 'repost') : null
        }))
        : engagePosts().map((r) => Object.assign({}, r, {
          like: false, repost: false, comment: false, ok: false, claim: null, by: null
        })),
      engageDone: s.engageDone || 0,
      /* 评论核不了（recent search 被拒）时，页面把「贴回复链接」那一块放出来。 */
      commentFallback: API.configured ? !API.searchOk : false,
      /* 自动核的现场：页面靠它把转发那张卡分成「未做 / 待核 / 已完成」并写出原因。 */
      proof: addr ? proofOf(addr) : null,
      distrusted: addr ? isDistrusted(addr) : false,
      checkBy: addr ? { follow: checkBy(addr, 'follow'), repost: checkBy(addr, 'repost'), like: checkBy(addr, 'like'), comment: checkBy(addr, 'comment') } : null,
      /* 这一项是**谁**核的：'api'（X 上查到的）/ 'auto'（贴链接自动核的）/
         'trust'（用户自称，待复核）/ 'admin'（人工打的）。页面拿它写胶囊上那半句。 */
      verifiedBy: addr ? { follow: checkBy(addr, 'follow'), repost: checkBy(addr, 'repost'), like: checkBy(addr, 'like'), comment: checkBy(addr, 'comment') } : null,
      /* 自称过但还没被 API 认下来的那些：{status:'pending'|'failed'} */
      claims: addr ? {
        follow: claimOf(addr, 'follow'),
        /* 老键还留着（排练站上可能有旧页面在读），互动的现场看 engagePosts[].claim。 */
        repost: claimOf(addr, 'repost'), like: claimOf(addr, 'like')
      } : null,
      /* X 自动核的现场：开没开、上次什么时候拉的、下一次大概什么时候。
         页面把它写进「审核中」那个胶囊里 —— 不写的话那十分钟等待看着就像卡住了。 */
      apiOn: API.configured,
      lastCheckAt: API.lastRunAt,
      checkEveryMin: API.everyMin,
      nextCheckAt: (API.configured && API.lastRunAt && API.everyMin)
        ? new Date(new Date(API.lastRunAt).getTime() + API.everyMin * 60000).toISOString()
        : null,
      proofMaxSubmits: PROOF_MAX_SUBMITS,
      /* 登记内容（登记之后不可改）：页面刷新后靠这两个字段直接渲染「已登记」卡片，
         不必再让用户看见一个填了也没用的表单。 */
      x: addr ? xOf(addr) : null,
      xSource: (addr && appliedOf(addr) && appliedOf(addr).xSource) || null,
      registeredAt: (addr && appliedOf(addr) && appliedOf(addr).at) || null,
      code: addr ? codeOf(addr) : null,            // 登记码 = 邀请码，从地址现算
      points: s.total,
      breakdown: s.pts,                            // {register, repost, invite, share}
      invites: s.invites,
      validInvites: s.validInvites,
      countedInvites: s.countedInvites,
      shareDays: s.shareDays,
      countedShareDays: s.countedShareDays,
      /* 引爆并广播：**按次**（每日 sharePerDay 次、累计 shareMax 次）。
         shareDays 是老字段（记过分的天数），榜和导出里还在用。 */
      shares: s.shares, sharesToday: s.sharesToday,
      /* 引爆计分的进度：今天拿了几分、一共拿了几分。两道上限在 pts 里（bangPerDay / bangMax），
         页面上「今日 x / 10 分 · 累计 y / 50 分」读的就是这几个数。 */
      bangs: s.bangs,
      bangToday: s.bangToday,
      bangTodayPts: s.bangTodayPts,
      bangPts: s.pts.bang,
      /* **不回具体名次**（用户拍板）：只说在不在公开榜里，以及还差几分进去。
         名次数字只有管理员页看得到（adminList 那一份）。 */
      inTop100: addr ? (rankOf(addr) != null && rankOf(addr) <= BOARD_PUBLIC_MAX) : false,
      /* 创作推文那一串 + 邀请里程碑 + 预热窗口：任务卡要拿它们画进度。 */
      postList: addr ? postsOf(addr) : [],
      postsThisWeek: addr ? postsThisWeek(addr, now) : 0,
      okPosts: s.okPosts, badPosts: s.badPosts, countedPosts: s.countedPosts,
      milestones: s.milestones,
      warmup: (function () { const w = warmupNow();
        return { start: w.start == null ? null : new Date(w.start).toISOString(),
          days: w.days, end: w.end == null ? null : new Date(w.end).toISOString() }; })(),
      gapToTop100: addr ? gapTo(addr, BOARD_PUBLIC_MAX) : null,
      boardTop: BOARD_PUBLIC_MAX,
      /* 「还差几分」照给 —— 那是**他自己**的进度，不是名额承诺。
         页面上只说「再拿 N 分」，绝不说「进前 X 名」。 */
      gapToGtd: addr ? gapTo(addr, T.gtd) : null,
      gapToFree: addr ? gapTo(addr, T.free) : null,
      nextStep: addr ? nextStep(addr) : null,
      pts: pointsTable(),                          // 分值表：页面上任务清单标的分值来自它
      frozen: isFrozen(),
      pinnedPost: pinnedPost(),
      message: addr ? registerMessage(addr) : null,  // 要签的那句话，客户端原样签
      domain: domain()
    };
  }
  /**
   * 审核页要的那一张表。**只有带对口令的人拿得到**（server/index.js 的 adminTokenOk）。
   * 这里给完整地址 —— 管理员要靠它去链上核对，而这条路本来就在口令后面。
   * @param q    按 X 名 / 登记码 / 地址搜（不分大小写）
   * @param only 'pending' = 只看还没核全的
   */
  function adminList(q, only) {
    const kw = String(q == null ? '' : q).trim().toLowerCase();
    /* 同 IP 前缀的登记数：一个网段一口气来 20 个，审核的人一眼要看得见。 */
    const perIp = new Map();
    for (const r of loadApplied().values()) perIp.set(r.ip, (perIp.get(r.ip) || 0) + 1);
    let rows = Array.from(loadApplied().values()).map((r) => {
      const s = scoreOf(r.addr);
      const pf = proofOf(r.addr);
      const x = xOf(r.addr);
      /* X 账号的公开档案。**抓不到就是 null，不是 0** —— 后台按「粉丝少于 10」筛的时候，
         把「没抓到」算成 0 会把一整批正常账号误判成小号。 */
      const xu = xUserOf(r.xId);
      return {
        addr: r.addr, short: shortAddr(r.addr), code: r.code, x,
        xId: r.xId || null, xSource: r.xSource || 'typed',
        xUrl: x ? 'https://x.com/' + x : null,
        xCreatedAt: xu ? xu.createdAt : null,
        xFollowers: xu ? xu.followers : null,
        xFollowing: xu ? xu.following : null,
        xTweets: xu ? xu.tweets : null,
        at: r.at, ip: r.ip, ipCount: perIp.get(r.ip) || 1,
        ref: r.ref || null, inviter: r.inviter || null,
        points: s.total, rank: rankOf(r.addr), tier: tierOf(r.addr),
        follow: s.followed, repost: s.reposted, like: s.liked, comment: s.commented,
        engaged: s.engaged, engageDone: s.engageDone || 0, engageTotal: (s.engageRows || []).length,
        by: { follow: checkBy(r.addr, 'follow'), repost: checkBy(r.addr, 'repost'),
          like: checkBy(r.addr, 'like'), comment: checkBy(r.addr, 'comment') },
        distrusted: isDistrusted(r.addr),
        proof: pf ? {
          url: pf.url, status: pf.status, reason: pf.reason, tries: pf.tries,
          via: pf.via, at: pf.at, submits: pf.submits, rejected: !!pf.rejected
        } : null,
        invites: s.invites, validInvites: s.validInvites, shareDays: s.shareDays, shares: s.shares || 0
      };
    });
    if (kw) {
      rows = rows.filter((r) => (r.x && r.x.toLowerCase().indexOf(kw) >= 0)
        || r.code.toLowerCase().indexOf(kw) >= 0 || r.addr.indexOf(kw) >= 0);
    }
    if (String(only || '') === 'pending') rows = rows.filter((r) => !(r.follow && r.engaged));
    rows.sort((a, b) => (b.points - a.points) || (String(a.at) < String(b.at) ? -1 : 1));
    const c = counts();
    return {
      rows: rows.slice(0, 500), total: rows.length,
      phase: phaseNow(), phaseBase: phaseBase(), frozen: isFrozen(),
      counts: c, pts: pointsTable(), pinnedPost: pinnedPost(), xHandle: xHandle(),
      engagePosts: engagePosts(),
      boardSize: board().rows.length
    };
  }
  /** GET /api/allowlist/board?top=100 —— 公开榜，**只到前 100 名**，
      名额数量定格之前不出门（见 publicCounts / topRows 的说明）。 */
  function boardView(top) {
    const c = publicCounts();
    return {
      phase: phaseNow(), frozen: c.frozen,
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
    const p = phaseNow(now);
    const o = opensNow();
    const nx = nextOpenNow(now);
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
    const p = phaseNow(now);
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
    /* 免费额度用完了（或这个地址已经用过一次）。**只有公售段才退回付费签**：
       白名单 / 先到先得两段是放免费额度的，这时候签一张付费单等于把公售提前开给名单里的人
       （2026-09-19 排练时就是这样：免费铸过一枚后 HUD 直接报 1 USDC 付费）。 */
    if (!allowPaidFallback) {
      return {
        ok: false, status: 403, code: 'FREE_GONE', phase: p, freeGone: true,
        error: '免费额度已用完，付费铸造将在公售阶段开放。'
      };
    }
    return { ok: true, free: false, phase: p, freeGone: true, paidFallback: true };
  }

  return {
    // 阶段
    /* **这三个给的都是「认后台那一份」的版本**（phaseNow / nextOpenNow / opensNow）。
       模块级的 phaseAt / nextOpen / opensIso 只认 env，那是给自检和纯函数用的。
       曾经这里挂的是模块级那几个，表现是 /api/health 与启动日志里的阶段跟后台切的对不上。 */
    phase: phaseNow, nextOpen: nextOpenNow, opens: opensNow, pinnedPost, PHASES, TIERS,
    // 积分与榜
    scoreOf, board, rankOf, topRows, boardView, gapTo, gapToPrev, nextStep,
    pointsTable, tops, inviteCount, validInviteCount, shareDaysOf, sharesOf, isVerified, hasCheck,
    xHandle, followUrl, likeUrl, CHECKS,
    // 名单
    tierOf, tasksDone, counts, publicCounts, isFrozen, freeze, unfreeze,
    addAddresses, removeAddresses, setTier, listFile, appliedFile, stateFile,
    // 登记 / 核验 / 分享
    register, share, bang, bangsOf,
    verify, unverify, setX, xOf, registerMessage, codeOf, addrOfCode, addrOfXid, appliedOf,
    shortAddr,
    // 自动核 / 信任
    submitProof, proofOf, checkProof, fetchTweet, runProofQueue, rejectProof,
    submitPost, postsOf, checkPost, runPostQueue, postsThisWeek,
    warmupWindow: warmupNow, inviteMilestones,
    claim, claimOf, distrust, retrust, isDistrusted, checkBy, pinnedTweetId, syncApi,
    // 官方推文互动
    engagePosts, engagePostOf, engageAdd, engageRemove, engageStatus, engagePartsOf, isEngaged,
    engagePostsFile: postsFile,
    setApiProbe, apiInfo, apiOn, setXUsersProbe, xUserOf, xIds,
    // 后台切段
    setPhase, phaseBase, phaseNow, nextOpenNow, opensNow, phaseInfo, phaseLog, phaseFile, phaseLogFile,
    appliedCount, appliedRows, appliedCsv, domain, seed, unseed,
    // 接口
    status, gate, denyReason, adminList,
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
