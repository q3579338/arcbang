/*
 * server/rpcrelay.js —— 同源只读 RPC 中继：POST /api/rpc
 * ------------------------------------------------------------
 * 为什么要它：站点读链走 config.js 里的公开节点（publicnode / dataseed / defibit）。
 * 2026-09-02 用户截图：市场页整页「读不到」，几秒后又好了。实测国内直连只有 publicnode
 * 一个通（dataseed / defibit 的域名被 DNS 污染，12 秒超时），publicnode 一限流，
 * 后面两个节点各卡 12 秒，页面先标「读不到」、下一轮刷新才盖回来。
 * 服务器在海外，三个节点都通 —— 那就让浏览器在公开节点失败时落到自己的服务器上来问。
 *
 * ---- 边界，缺一条它就是别人的免费公共节点 ----
 *   · 只收 JSON-RPC 的**只读**方法（下面 METHODS 白名单），写链永远走钱包；
 *   · eth_call / eth_getCode / eth_getLogs 的目标地址只认**本站自己的合约**
 *     （env 里配的那几个 + ARCBANG_RELAY_TO 补充的），别的地址一律 -32602；
 *   · eth_getLogs 跨度封顶（默认 5000 块），与索引器同量级；
 *   · 按 IP 限流（默认每分钟 300 条，批量里每一条都算）；
 *   · 体积 64 KB 封顶，批量 40 条封顶；
 *   · 永远 no-store：这是实时读，缓存住等于给人看旧账。
 *
 * ---- 语义 ----
 *   收到数组就回数组（顺序与请求一致），收到对象就回对象；id 原样带回。
 *   上游按 chain.js 的节点表轮换：一个节点打不通换下一个；节点**答了**的错误
 *   （execution reverted 等）原样透传给浏览器 —— 换节点也是同样的答案。
 *   全部节点都打不通：每一条都回 -32000，HTTP 仍是 200（JSON-RPC 的口径），
 *   浏览器那边的 rpc() 看到 error 会继续换它自己表里的下一个节点。
 */
'use strict';

const chain = require('./chain.js');
const { envInt } = require('./envint.js');

const METHODS = {
  eth_chainId: 1, eth_blockNumber: 1,
  eth_getBlockByNumber: 1, eth_getBlockByHash: 1,
  eth_call: 1, eth_getCode: 1, eth_getLogs: 1,
  eth_getTransactionReceipt: 1, eth_getTransactionByHash: 1
};
const MAX_BODY = 64 * 1024;
const MAX_BATCH = envInt(process.env.ARCBANG_RELAY_BATCH, 40, 1, 200);
const PER_MIN = envInt(process.env.ARCBANG_RELAY_PER_MIN, 300, 10, 100000);
const LOG_RANGE = envInt(process.env.ARCBANG_RELAY_LOG_RANGE, 5000, 10, 50000);
const UPSTREAM_MS = envInt(process.env.ARCBANG_RELAY_UPSTREAM_MS, 10000, 1000, 60000);
const MAX_DATA_HEX = 8192;          // eth_call 的 data：4 KB 的 calldata 足够任何 getter

const HEX = /^0x[0-9a-fA-F]*$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const H32_RE = /^0x[0-9a-fA-F]{64}$/;
const QTY_RE = /^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/;      // 区块号：无前导零的 hex

/* ---------------- 目标地址白名单 ---------------- */
let allowCache = null;
function allowedTo() {
  if (allowCache) return allowCache;
  const set = new Set();
  const put = (v) => { const s = String(v || '').trim().toLowerCase(); if (ADDR_RE.test(s)) set.add(s); };
  ['ARCBANG_CONTRACT', 'ARCBANG_MARKET', 'ARCBANG_NAMES', 'ARCBANG_NAMES2', 'ARCBANG_CRAFTED', 'ARCBANG_REFERRAL_VAULT']
    .forEach((k) => put(process.env[k]));
  String(process.env.ARCBANG_RELAY_TO || '').split(/[,\s]+/).forEach(put);
  allowCache = set;
  return set;
}
function toAllowed(a) { return typeof a === 'string' && ADDR_RE.test(a) && allowedTo().has(a.toLowerCase()); }

/* ---------------- 按 IP 限流（每分钟 PER_MIN 条） ---------------- */
const buckets = new Map();
function take(ip, n, now) {
  now = now || Date.now();
  let b = buckets.get(ip);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + 60000 }; buckets.set(ip, b); }
  if (b.count + n > PER_MIN) return { ok: false, resetAt: b.resetAt };
  b.count += n;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  return { ok: true, remaining: PER_MIN - b.count, resetAt: b.resetAt };
}

/* ---------------- 单条请求的校验与规范化 ---------------- */
function bad(id, code, message) { return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } }; }

/**
 * @returns {{ok:true, id:any, method:string, params:any[], logs:boolean}|{ok:false, resp:object}}
 */
function normalize(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, resp: bad(null, -32600, '不是 JSON-RPC 请求') };
  const id = (typeof item.id === 'number' || typeof item.id === 'string' || item.id === null) ? item.id : null;
  const method = item.method;
  if (typeof method !== 'string' || !METHODS[method]) return { ok: false, resp: bad(id, -32601, '中继不转这个方法：' + String(method).slice(0, 40)) };
  const p = Array.isArray(item.params) ? item.params : [];
  const inv = (msg) => ({ ok: false, resp: bad(id, -32602, msg) });
  let params;
  switch (method) {
    case 'eth_chainId':
    case 'eth_blockNumber':
      params = [];
      break;
    case 'eth_getBlockByNumber': {
      const tag = p[0];
      if (!(tag === 'latest' || tag === 'earliest' || tag === 'safe' || tag === 'finalized' || (typeof tag === 'string' && QTY_RE.test(tag)))) return inv('区块号不合法');
      params = [tag, false];                               // 永远不带整块交易
      break;
    }
    case 'eth_getBlockByHash':
      if (typeof p[0] !== 'string' || !H32_RE.test(p[0])) return inv('区块哈希不合法');
      params = [p[0].toLowerCase(), false];
      break;
    case 'eth_getTransactionReceipt':
    case 'eth_getTransactionByHash':
      if (typeof p[0] !== 'string' || !H32_RE.test(p[0])) return inv('交易哈希不合法');
      params = [p[0].toLowerCase()];
      break;
    case 'eth_getCode':
      if (!toAllowed(p[0])) return inv('中继只读本站合约');
      params = [p[0].toLowerCase(), 'latest'];
      break;
    case 'eth_call': {
      const c = p[0];
      if (!c || typeof c !== 'object' || Array.isArray(c)) return inv('eth_call 缺调用对象');
      if (!toAllowed(c.to)) return inv('中继只读本站合约');
      const data = c.data == null ? '0x' : c.data;
      if (typeof data !== 'string' || !HEX.test(data) || data.length > MAX_DATA_HEX || data.length % 2) return inv('calldata 不合法');
      const call = { to: c.to.toLowerCase(), data };
      if (typeof c.from === 'string' && ADDR_RE.test(c.from)) call.from = c.from.toLowerCase();
      params = [call, 'latest'];                           // 只读最新态；历史态查询不是页面要的
      break;
    }
    case 'eth_getLogs': {
      const f = p[0];
      if (!f || typeof f !== 'object' || Array.isArray(f)) return inv('eth_getLogs 缺过滤器');
      const addrs = Array.isArray(f.address) ? f.address : [f.address];
      if (!addrs.length || addrs.length > 8 || !addrs.every(toAllowed)) return inv('中继只读本站合约的日志');
      const tagOk = (t) => t === undefined || t === 'latest' || (typeof t === 'string' && QTY_RE.test(t));
      if (!tagOk(f.fromBlock) || !tagOk(f.toBlock)) return inv('区块范围不合法');
      if (QTY_RE.test(String(f.fromBlock)) && QTY_RE.test(String(f.toBlock))) {
        const a = parseInt(f.fromBlock, 16), b = parseInt(f.toBlock, 16);
        if (b < a || b - a + 1 > LOG_RANGE) return inv('日志跨度最多 ' + LOG_RANGE + ' 块');
      }
      let topics;
      if (f.topics !== undefined) {
        if (!Array.isArray(f.topics) || f.topics.length > 4) return inv('topics 不合法');
        const one = (t) => t === null || (typeof t === 'string' && H32_RE.test(t));
        topics = f.topics.map((t) => {
          if (Array.isArray(t)) { if (t.length > 8 || !t.every(one)) throw new Error('topics'); return t.map((x) => x && x.toLowerCase()); }
          if (!one(t)) throw new Error('topics');
          return t && t.toLowerCase();
        });
      }
      const filter = { address: addrs.map((a) => a.toLowerCase()) };
      if (f.fromBlock !== undefined) filter.fromBlock = f.fromBlock;
      if (f.toBlock !== undefined) filter.toBlock = f.toBlock;
      if (topics) filter.topics = topics;
      params = [filter];
      break;
    }
    default:
      return inv('中继不转这个方法');
  }
  return { ok: true, id, method, params, logs: method === 'eth_getLogs' };
}

/* ---------------- 上游：整批发给一个节点，打不通换下一个 ---------------- */
async function postBatch(url, payload) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), UPSTREAM_MS);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: ctl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

/**
 * @param {Array<{key:number, method:string, params:any[]}>} items  key = 内部序号
 * @param {string[]} urls
 * @returns {Promise<Map<number, object>>}  key → 上游答复（{result} 或 {error}）
 */
async function forward(items, urls) {
  const out = new Map();
  if (!items.length) return out;
  const payload = items.map((it) => ({ jsonrpc: '2.0', id: it.key, method: it.method, params: it.params }));
  let lastErr = null;
  for (const url of urls) {
    try {
      const j = await postBatch(url, payload.length === 1 ? payload[0] : payload);
      const arr = Array.isArray(j) ? j : [j];
      /* 节点答了但少答几条（有的节点批量太大会静默丢）：少的那些当这个节点没答，换下一个再问 */
      const got = new Map();
      arr.forEach((r) => { if (r && typeof r === 'object' && r.id !== undefined) got.set(Number(r.id), r); });
      if (payload.length === 1 && arr[0] && got.size === 0) got.set(items[0].key, arr[0]);
      const missing = items.filter((it) => !got.has(it.key));
      items.forEach((it) => { if (got.has(it.key)) out.set(it.key, got.get(it.key)); });
      if (!missing.length) return out;
      const rest = await forward(missing, urls.slice(urls.indexOf(url) + 1));
      rest.forEach((v, k) => out.set(k, v));
      return out;
    } catch (e) {
      lastErr = e;                                         // 这个节点不行，换下一个
    }
  }
  items.forEach((it) => { if (!out.has(it.key)) out.set(it.key, { error: { code: -32000, message: '所有 RPC 节点都打不通' + (lastErr ? '：' + lastErr.message : '') } }); });
  return out;
}

/* ---------------- 请求体 ---------------- */
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const bufs = [];
    let n = 0, done = false;
    const finish = (fn, v) => { if (done) return; done = true; fn(v); };
    req.on('data', (d) => {
      n += d.length;
      if (n > max) { finish(reject, new Error('too large')); req.destroy(); return; }
      bufs.push(d);
    });
    req.on('end', () => finish(resolve, Buffer.concat(bufs).toString('utf8')));
    req.on('error', (e) => finish(reject, e));
  });
}

/**
 * 路由入口。index.js 只做「是 /rpc 且是 POST」的判断，其余都在这里。
 * @param {object} h  { ip, json(res, code, obj, headers) }
 */
async function handle(req, res, h) {
  const NOSTORE = { 'cache-control': 'no-store' };
  let raw;
  try { raw = await readBody(req, MAX_BODY); }
  catch (e) { return h.json(res, 413, { error: '请求体过大（上限 64 KB）' }, NOSTORE); }
  let body;
  try { body = JSON.parse(raw); }
  catch (e) { return h.json(res, 400, bad(null, -32700, '请求体不是 JSON'), NOSTORE); }
  const isBatch = Array.isArray(body);
  const list = isBatch ? body : [body];
  if (!list.length) return h.json(res, 400, bad(null, -32600, '空批量'), NOSTORE);
  if (list.length > MAX_BATCH) return h.json(res, 400, bad(null, -32600, '批量最多 ' + MAX_BATCH + ' 条'), NOSTORE);

  const rl = take(h.ip, list.length);
  if (!rl.ok) {
    return h.json(res, 429, bad(null, -32005, '中继太频繁了，每分钟最多 ' + PER_MIN + ' 条'),
      Object.assign({ 'retry-after': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) }, NOSTORE));
  }

  const norm = list.map(normalize);
  const responses = new Array(list.length);
  const plain = [], logs = [];
  norm.forEach((n, i) => {
    if (!n.ok) { responses[i] = n.resp; return; }
    (n.logs ? logs : plain).push({ key: i, method: n.method, params: n.params });
  });
  const [r1, r2] = await Promise.all([
    forward(plain, chain.RPCS),
    forward(logs, chain.rpcsForLogs())
  ]);
  const fill = (m) => m.forEach((r, key) => {
    const n = norm[key];
    responses[key] = r.error
      ? { jsonrpc: '2.0', id: n.id, error: { code: r.error.code == null ? -32000 : r.error.code, message: String(r.error.message || 'rpc error').slice(0, 200), data: r.error.data } }
      : { jsonrpc: '2.0', id: n.id, result: r.result === undefined ? null : r.result };
  });
  fill(r1); fill(r2);
  return h.json(res, 200, isBatch ? responses : responses[0],
    Object.assign({ 'x-ratelimit-remaining': String(rl.remaining) }, NOSTORE));
}

module.exports = {
  handle, normalize, forward, allowedTo, take,
  METHODS, MAX_BATCH, PER_MIN, LOG_RANGE,
  _reset: () => { allowCache = null; buckets.clear(); }
};
