/*
 * 邀请奖励 + 邀请列表 —— specs/profile-referral-v2.md
 * ------------------------------------------------------------
 * 两条数据源，各自只认一种事实，不编第三条：
 *
 *   奖励余额 = 链上事实。返利金库（BangPromo 第二实例）的 Granted 日志按收款人
 *   求和 —— owner 人工核对后用 grant() 发的每一笔都在链上，没发的就是没有。
 *   读链失败答 null（「链上查询暂不可用」），**绝不回 0** —— 0 是一个链上事实
 *   （"确实一分没发"），失败不是，两者在个人中心上不是同一句话。
 *
 *   邀请列表 = 服务端留痕。.store/referrals.jsonl（index.js 的 recordReferral
 *   append 的那份流水），一级 = ref 是我的行，二级 = ref 是「我的一级 minter」
 *   的行（只往上找一层，不递归）。它只是留痕，发钱始终是人工核对后手动 grant。
 *
 * **不改 server/chain.js**：它只导出 RPCS/ethCall/blockByHash 等，没有 getLogs，
 * 而它是好几个模块共享的基础设施 —— 照 server/marketindex.js 的先例自带一份
 * rpcAny/getLogs（复用它导出的 RPCS 列表做节点轮换），改动面越小越安全。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { RPCS, rpcsForLogs } = require('./chain.js');   // 只读节点列表，别的都自带
const RC = require('./refcode.js');

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/* 返利金库（BangPromo 第二实例，与 web/config.js 的 referral 键同值）。
   配了个格式不对的值 → VAULT 为空 → granted 永远 null，不报错、不发请求 ——
   配错时个人中心显示「链上查询暂不可用」，比拿错地址扫出一个假 0 诚实。 */
const VAULT = (() => {
  /* 禁止测试网默认金库：主网忘了配会把别人测试网的 grant 扫进来当余额。没配就空。 */
  const v = String(process.env.BNBBANG_REFERRAL_VAULT || '').toLowerCase();
  return ADDR_RE.test(v) ? v : '';
})();

/* topic0 = keccak256("Granted(address,uint256,string)")，事件定义照抄
   contracts/src/BangPromo.sol：event Granted(address indexed to, uint256 amount, string reason);
   只有 to 是 indexed，amount 是第一个非 indexed 参数 —— 永远是 data 的头 32 字节
   （reason 是动态类型，跟在后面，这里不需要解析）。离线算好写死，复核命令：
     node -e "var K=require('./web/keccak-lite.js'); console.log(K.keccak256('Granted(address,uint256,string)'))" */
const TOPIC_GRANTED = '0x05f5e610b13c82b03c5bc3744e5668028ea5b93c9dc0b8db4e720a6ab86bf26a';

/* 每次调用现算，不在模块加载时定死：selftest 是先设 BNBBANG_STORE 再 require，
   但列表那一侧的测试要在同一个进程里反复换文件内容，路径也跟着 env 走最稳。 */
const REF_FILE = () => path.join(process.env.BNBBANG_STORE || path.join(__dirname, '.store'), 'referrals.jsonl');

const ONE_BANG = 10n ** 18n;              // 链上金额是 wei 精度（18 位小数，同 BangToken）
const CACHE_MS = 60000;                    // 求和结果缓存 60 秒
const CHUNK_SPAN = 5000;                   // eth_getLogs 分片跨度（同 marketindex.js 的理由）
const LOG_TIMEOUT_MS = 20000;              // getLogs 用长超时（marketindex.js 同款口径）

/* ------------------------------------------------------------ RPC
   照 server/marketindex.js 的 rpcOne/rpcAny/chunkRanges 抄的小份：
   逐个节点试，全挂才抛（err.rpcDown），分片是**闭区间**、每片 ≤5000 块。 */
async function rpcOne(url, method, params, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  } finally { clearTimeout(t); }
}

async function rpcAny(method, params, timeoutMs) {
  const list = method === 'eth_getLogs' ? rpcsForLogs() : RPCS;
  let lastErr = null;
  for (const url of list) {
    try { return await rpcOne(url, method, params, timeoutMs || 8000); }
    catch (e) { lastErr = e; }
  }
  const err = new Error('所有 RPC 节点都打不通：' + (lastErr && lastErr.message));
  err.rpcDown = true;
  throw err;
}

/** 闭区间 [from, to] 切片，每片不超过 span 块（差一块就是整轮报错与整轮成功的区别）。 */
function chunkRanges(from, to, span) {
  const out = [];
  const s = Math.max(1, Number(span) || 1);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return out;
  for (let a = from; a <= to; a += s) out.push([a, Math.min(a + s - 1, to)]);
  return out;
}

/* ------------------------------------------------------------ 链上求和
   下面两个函数**必须挂在 module.exports 上、内部调用也走 module.exports.xxx**：
   selftest 打桩靠替换模块对象上的属性，解构出来单独持有的那份引用换不掉
   （index.js 顶部 chainMod 那段注释记着 token.js 踩过的同一个坑）。 */

/** 现在的链高。selftest 会把它换成秒回的假货，免得归类测试看网络脸色。 */
module.exports._latestBlock = async function () {
  const hex = await rpcAny('eth_blockNumber', []);
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n) || n <= 0) throw new Error('eth_blockNumber 答非所问：' + hex);
  return n;
};

/** 抓金库的全部 Granted 原始日志（分片扫描）。全部节点打不通 → 抛（不吞掉，
    让上层的缓存刷新层决定这次请求答 null）。返回原始 log 数组 {topics, data, …}。 */
module.exports._fetchGrantedLogs = async function (fromBlock, toBlock) {
  const out = [];
  for (const [a, b] of chunkRanges(fromBlock, toBlock, CHUNK_SPAN)) {
    const logs = await rpcAny('eth_getLogs', [{
      address: VAULT,
      topics: [TOPIC_GRANTED],
      fromBlock: '0x' + a.toString(16),
      toBlock: '0x' + b.toString(16)
    }], LOG_TIMEOUT_MS);
    if (Array.isArray(logs)) out.push(...logs);
  }
  return out;
};

/* 60 秒缓存。失败时**不碰 cache**（不清空、不更新 ts）：下一次请求立刻重试，
   不会被一次失败拖进 60 秒冷却；这一次请求如实答 null。
   inflight：冷缓存时 N 个 /referrals/me 只扫一遍链。主网从 INDEX_FROM 扫到链头
   是上千次 getLogs，没有单飞就会把付费节点打爆。 */
let cache = { ts: 0, map: null };
let inflight = null;

/** @returns {Promise<Map<string,bigint>|null>} 地址小写 → 累计 wei；null = 读不到 */
let warnedNoFrom = false;
module.exports._refreshGranted = async function () {
  if (!VAULT) return null;                                    // 没配金库：不发请求，直接「不可用」
  /* 起扫高度必须显式配置（BNBBANG_INDEX_FROM，主网 = 金库部署高度，规格写的是
     126355000）。没配时**不扫**、直接答 null：原来默认「回看 5 万块」只有约 1.7 天，
     更早的 grant 会被漏掉，而 grantedOf 把「map 里没有」当成链上事实（"确实一分没发"）
     显示成 0 —— 漏扫不是链上事实，0 和 null 在个人中心上不是同一句话。
     每次调用现读 env（不在模块顶定死）：selftest 要在同一进程里两种配置都测。 */
  const from = Number(process.env.BNBBANG_INDEX_FROM || 0);
  if (!Number.isFinite(from) || !(from > 0)) {
    if (!warnedNoFrom) {
      warnedNoFrom = true;
      console.error('[referral] BNBBANG_INDEX_FROM 没配 —— 邀请奖励余额一律答 null'
        + '（不完整扫描不能当链上事实）。部署时把它设成返利金库的部署高度。');
    }
    return null;
  }
  if (cache.map && Date.now() - cache.ts < CACHE_MS) return cache.map;
  if (inflight) return inflight;
  const job = (async () => {
    try {
      const latest = await module.exports._latestBlock();
      const logs = await module.exports._fetchGrantedLogs(from, latest);
      const map = new Map();
      for (const lg of logs) {
        /* to = topics[1] 去掉左侧 padding；amount = data 头 32 字节。
           形状不对的单条跳过 —— 个别坏记录当读不出来，不搞挂整份求和。 */
        if (!lg || !Array.isArray(lg.topics) || lg.topics.length < 2) continue;
        const t1 = String(lg.topics[1] || '');
        const d = String(lg.data || '');
        if (!/^0x[0-9a-fA-F]{64}$/.test(t1) || !/^0x[0-9a-fA-F]{64,}$/.test(d)) continue;
        const to = '0x' + t1.slice(-40).toLowerCase();
        let amt;
        try { amt = BigInt('0x' + d.slice(2, 66)); } catch (e) { continue; }
        map.set(to, (map.get(to) || 0n) + amt);
      }
      cache = { ts: Date.now(), map };                          // 成功才整体替换
      return map;
    } catch (e) {
      console.error('[referral] 链上求和刷新失败（这次答 null，下次立刻重试）：' + (e && e.message));
      return null;
    }
  })();
  inflight = job;
  try { return await job; }
  finally { if (inflight === job) inflight = null; }
};

/** 测试专用：把缓存打回原点，好让「成功求和」和「失败答 null」在同一个进程里连测。 */
module.exports._resetGrantedCacheForTest = function () { cache = { ts: 0, map: null }; inflight = null; };

/** 这个地址链上累计已发放，**整 BANG**（wei ÷ 1e18 向下取整）。null = 读不到。
    不在 map 里 = 确实是 0（一分没发过），不是失败 —— 失败在缓存刷新那层就答 null 了。 */
async function grantedOf(a) {
  const map = await module.exports._refreshGranted();
  if (!map) return null;
  return (map.get(a) || 0n) / ONE_BANG;
}

/* ------------------------------------------------------------ 邀请列表
   每次请求都重新读盘：selftest 要在同一个进程里反复写不同的假 referrals.jsonl，
   模块级缓存会让测试互相污染；线上这份文件量级是「被邀请人数」，读一遍没负担。 */
function invitesOf(me) {
  let text = '';
  try { text = fs.readFileSync(REF_FILE(), 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') console.error('[referral] 留痕读不了（当空处理，不 500）：' + e.message);
    return { invitedL1: [], invitedL2: [] };                  // 没有文件 = 还没人被邀请过
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    /* 单行坏 JSON 跳过 —— 一行坏数据不搞挂整个接口（仓库一贯的
       「个别坏记录当读不出来」口径，同 index.js 的 storeGet）。 */
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object'
        && typeof o.ref === 'string' && ADDR_RE.test(o.ref)
        && typeof o.minter === 'string' && ADDR_RE.test(o.minter)) rows.push(o);
    } catch (e) { /* 跳过这一行 */ }
  }
  const l1 = [], l1set = new Set();
  for (const r of rows) {
    if (r.ref.toLowerCase() !== me) continue;
    const m = r.minter.toLowerCase();
    l1.push({ addr: m, at: typeof r.at === 'string' ? r.at : null });
    l1set.add(m);
  }
  /* 二级不用行里的 ref2 字段，自己从 rows 推：ref ∈ 我的一级 minter 集合。
     只往上找一层，不递归。minter 是我本人的行不算（A↔M 互绑成环那种，
     与 recordReferral 对 ref2 成环「直接不记」同一个口径）。 */
  const l2 = [];
  for (const r of rows) {
    const m = r.minter.toLowerCase();
    if (l1set.has(r.ref.toLowerCase()) && m !== me) l2.push({ addr: m, at: typeof r.at === 'string' ? r.at : null });
  }
  /* 各档最多 200 条，超出保留 at 最新的 200（ISO 字符串按字典序比就是按时间比）。 */
  const cut = (arr) => arr
    .sort((x, y) => (String(y.at || '') < String(x.at || '') ? -1 : (String(y.at || '') > String(x.at || '') ? 1 : 0)))
    .slice(0, 200);
  return { invitedL1: cut(l1), invitedL2: cut(l2) };
}

/* ------------------------------------------------------------ 对外入口 */

/**
 * GET /api/referrals/me 的全部内容。
 * @returns {Promise<{code:string|null, invitedL1:Array, invitedL2:Array, granted:string|null}
 *                   |{error:string, status:number}>}
 *   granted 是**整 BANG 的十进制字符串**（前端直接显示，不再换算）；null = 链上读不到。
 */
async function meOf(addr, req) {
  if (typeof addr !== 'string' || !ADDR_RE.test(addr)) {
    return { error: 'addr 不是一个地址', status: 400 };
  }
  const a = addr.toLowerCase();
  /* 短码复用 refcode.js 的 codeOf（与 GET /api/refcode 同一个函数、同一道生成闸）。
     锦上添花：读不到（限流/存不下）就 null，不拦下面两块。 */
  let code = null;
  try {
    const c = RC.codeOf(a, req);
    if (c && c.code) code = c.code;
  } catch (e) { /* code 只是省一次请求，出错不影响列表与余额 */ }
  const { invitedL1, invitedL2 } = invitesOf(a);
  const granted = await grantedOf(a);
  return { code, invitedL1, invitedL2, granted: granted === null ? null : granted.toString() };
}

module.exports.meOf = meOf;
module.exports.invitesOf = invitesOf;
module.exports.TOPIC_GRANTED = TOPIC_GRANTED;
module.exports.VAULT = VAULT;
