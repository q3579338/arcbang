/*
 * 链上查询 —— 只做一件事：这个哈希到底是不是本链上的一个区块
 * ------------------------------------------------------------
 * specs/server-side.md 的 C3：查不到就拒绝，**绝不回退常量**。
 * 回退常量意味着一个凭空编造的哈希也能算出一个宇宙来，那这个项目就没有意义了。
 */
'use strict';

function splitUrls(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 日志里不许出现 RPC URL 的 path / userinfo：Alchemy/Infura 把 key 写在路径里。 */
function redactUrl(u) {
  try {
    const x = new URL(String(u));
    return x.origin + (x.pathname && x.pathname !== '/' ? '/…' : '');
  } catch (e) {
    return '[rpc]';
  }
}

/* **没有测试网默认值。** 以前 ARCBANG_RPC / ARCBANG_CHAIN_ID 缺了就悄悄落到
   BSC 测试网节点和 chainId 97：主网机器忘了配 env，签名绑到 97、块去测试网
   上查，每一笔都 BadSig / 假哈希，而报错看起来像「用户给的哈希不对」。
   现在缺了就是空。start() 会在启动时对着空配置大声 process.exit(1)。
   模块被 require 时不退出（selftest 要先设 env 再加载）。 */
const RPCS = splitUrls(process.env.ARCBANG_RPC);
/* 付费/归档节点专供 eth_getLogs。公共节点经常能 eth_call 却拒日志查询
   （specs/market-index-v1.md「公共 RPC 日志能力实测」）。索引层优先用它。 */
const LOG_RPCS = splitUrls(process.env.ARCBANG_LOG_RPC);

const CHAIN_ID = process.env.ARCBANG_CHAIN_ID != null && process.env.ARCBANG_CHAIN_ID !== ''
  ? Number(process.env.ARCBANG_CHAIN_ID)
  : NaN;

/* 链名只为了"人一眼能看出来对不对"。数字 56 和 97 长得太像，
   而部署时最容易犯的错就是服务端连着一条链、合约在另一条链上：
   签名摘要里带着 chainId，链错了每一笔 bangSigned 都会 BadSig，
   而报错信息里只有一个"BadSig"，看不出是链错了。所以 /api/health 和启动日志
   都把名字一起打出来，部署页第 9 步核对时也能直接读到。 */
const CHAIN_NAMES = {
  56: 'BSC 主网',
  97: 'BSC 测试网',
  /* ARCBANG（specs/arcbang-v1.md）：Arc 是 Circle 的 L1，native 就是 USDC。
     5042 与 5042002 也长得像，同一个理由要把名字打出来。 */
  5042: 'Arc 主网',
  5042002: 'Arc 测试网'
};
const CHAIN_NAME = CHAIN_NAMES[CHAIN_ID] || ('未知链（chainId ' + CHAIN_ID + '）');

const TESTNET_RPC_RE = /testnet|prebsc|data-seed-prebsc/i;

/** 启动时用：缺 CHAIN_ID / RPC，或主网却配了测试网节点，返回错误文案列表（空 = 通过）。
    opts 可覆盖，给自检喂假配置；生产路径不传。 */
function chainConfigErrors(opts) {
  const id = opts && opts.chainId != null ? Number(opts.chainId) : CHAIN_ID;
  const rpcs = opts && opts.rpcs ? opts.rpcs : RPCS;
  const logRpcs = opts && opts.logRpcs ? opts.logRpcs : LOG_RPCS;
  const errs = [];
  if (!Number.isInteger(id) || !CHAIN_NAMES[id]) {
    errs.push('ARCBANG_CHAIN_ID 必须显式设为 56 / 97（BSC 主网 / 测试网）或 5042 / 5042002（Arc 主网 / 测试网），禁止缺省落到测试网');
  }
  if (!rpcs.length) {
    errs.push('ARCBANG_RPC 必须显式配置，禁止默认测试网节点');
  }
  /* 主网却连着测试网节点：这是部署时最贵的一类错，两条主网都要挡。
     Arc 的测试网域名是 rpc.testnet.arc.io / rpc.testnet.arc.network，
     同一条 TESTNET_RPC_RE（认 testnet 字样）就能盖住。 */
  if (id === 56 || id === 5042) {
    const bad = rpcs.concat(logRpcs).filter((u) => TESTNET_RPC_RE.test(u));
    if (bad.length) {
      errs.push('主网 ARCBANG_RPC / ARCBANG_LOG_RPC 里出现了测试网地址：' + bad.join(', '));
    }
  }
  return errs;
}

/** 日志查询用的节点列表：LOG_RPC 在前，再拼普通 RPC（去重，保序）。
    LOG_RPC 每次现读 env：自检要在同一进程里开关它；生产里启动前就配好了。 */
function rpcsForLogs() {
  const seen = new Set();
  const out = [];
  splitUrls(process.env.ARCBANG_LOG_RPC).concat(RPCS).forEach((u) => {
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  });
  return out;
}

/* 配置说的链 vs RPC 真正连着的链 —— **这两样对不上是最贵的一种配错**。
   启动时问一次 eth_chainId，把实测值缓存起来给 /api/health 报出去，
   部署向导核对那一步就能当场发现，而不是等第一笔铸造失败。

   **只报不拦**：RPC 临时抽风不该让服务起不来 —— 起不来比配错更糟。
   链身份缺配置则相反：那是 process.exit，见 chainConfigErrors / start()。 */
let LIVE_CHAIN_ID = null;      // null = 还没问到（RPC 挂了或没启动过自检）
async function probeChainId() {
  try {
    const hex = await overNodes('eth_chainId', []);
    LIVE_CHAIN_ID = Number(hex);
    if (LIVE_CHAIN_ID !== CHAIN_ID) {
      console.error('[chain] ⚠ 链对不上：ARCBANG_CHAIN_ID=' + CHAIN_ID +
        '（' + CHAIN_NAME + '），但 RPC 实际连的是 chainId ' + LIVE_CHAIN_ID +
        '。签名摘要绑的是前者，每一笔铸造都会 BadSig —— 改 env 或改 ARCBANG_RPC，然后重启。');
    }
  } catch (e) {
    console.warn('[chain] 启动自检没问到 chainId（RPC 不通）：' + (e && e.message));
  }
  return LIVE_CHAIN_ID;
}
const liveChainId = () => LIVE_CHAIN_ID;

/* eth_getLogs 探测：公共节点「能 eth_call ≠ 能 getLogs」。
   对每个节点用 3 块的小跨度问一次；任一成功 → logRpcOk=true。
   索引层另走 rpcsForLogs()（LOG_RPC 优先）。 */
let LIVE_LOG_RPC_OK = null;
async function probeOneLogs(url) {
  const hex = await rpc(url, 'eth_blockNumber', []);
  const latest = parseInt(hex, 16);
  if (!Number.isFinite(latest) || latest <= 0) throw new Error('eth_blockNumber 答非所问：' + hex);
  const from = Math.max(0, latest - 2);
  /* 带一个不可能有日志的地址：只验证节点肯答 getLogs，不把近 3 块全链日志拉回来。 */
  const logs = await rpc(url, 'eth_getLogs', [{
    address: '0x0000000000000000000000000000000000000001',
    fromBlock: '0x' + from.toString(16),
    toBlock: '0x' + latest.toString(16)
  }]);
  if (!Array.isArray(logs)) throw new Error('eth_getLogs 没回数组');
  return true;
}
async function probeLogRpc() {
  const urls = rpcsForLogs();
  if (!urls.length) {
    LIVE_LOG_RPC_OK = false;
    console.error('[chain] ⚠ 没有可探的 RPC，eth_getLogs 不可用');
    return false;
  }
  let any = false;
  for (const url of urls) {
    try {
      await probeOneLogs(url);
      any = true;
      console.log('[chain] eth_getLogs OK  ' + redactUrl(url));
    } catch (e) {
      console.warn('[chain] eth_getLogs FAIL ' + redactUrl(url) + '  ' + (e && e.message));
    }
  }
  LIVE_LOG_RPC_OK = any;
  if (!any) {
    console.error('[chain] ⚠ 没有任何 RPC 肯答 eth_getLogs（跨度 3 块也失败）。'
      + '索引会一直 stale。配 ARCBANG_LOG_RPC（付费节点）或换会服务日志的节点。');
  }
  return any;
}
const liveLogRpcOk = () => LIVE_LOG_RPC_OK;

async function rpc(url, method, params) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.error) {
      const err = new Error(j.error.message || 'rpc error');
      /* revert **不是节点故障**：节点好好地答复了，只是答案是"这个调用不成立"。
         分不开的后果实测过：2026-08-18 部署的那版合约没有 cardOf/burnedOn/rescueOf，
         四个 getter 里三个 revert，被当成节点挂了一路重试到底，整个 /api/token
         变成 503 —— 连早就铸好的 #1 都读不出来。
         JSON-RPC 的执行错误是 code 3；有的节点只给文字，所以两样都认。 */
      err.reverted = j.error.code === 3 || /execution reverted|revert/i.test(err.message);
      throw err;
    }
    return j.result;
  } finally { clearTimeout(t); }
}

/* 逐个节点试，全挂了才抛 rpcDown。
   调用方必须靠这个标志把两件事分开报：**我们的节点全挂了**（503，我们的锅）
   和**链上确实没有这个东西**（400/404，用户给的数据不对）。混在一起报的话，
   一次网络抖动会被用户读成"我的哈希被判定成假的"。 */
async function overNodes(method, params) {
  let lastErr = null;
  if (!RPCS.length) {
    const err = new Error('ARCBANG_RPC 没配，没有可问的节点');
    err.rpcDown = true;
    throw err;
  }
  for (const url of RPCS) {
    try { return await rpc(url, method, params); }
    catch (e) {
      if (e.reverted) throw e;                       // 节点答复了，换一个也是同样的答复
      lastErr = e;                                   // 这个节点不行，换下一个
    }
  }
  const err = new Error('所有 RPC 节点都打不通：' + (lastErr && lastErr.message));
  err.rpcDown = true;
  throw err;
}

/**
 * @returns {Promise<{number:number, hash:string}|null>}
 *   null = 这条链上没有这个区块（节点明确答复了，只是答案是"没有"）。
 *   抛错 = 所有 RPC 都打不通。两者必须分开，理由见 overNodes。
 */
async function blockByHash(hash) {
  const b = await overNodes('eth_getBlockByHash', [hash, false]);
  if (!b || !b.hash) return null;                    // 明确答复：没有这个块
  /* **核对返回的哈希就是请求的那个**。按哈希查块，诚实节点返回的 b.hash 必然等于 hash；
     不等 = 这个 RPC 在撒谎（回了别的块、或凭空造了个块）。签名摘要用的是请求方给的
     hash，所以这道核对是「这个 hash 真是一个 BSC 区块」的最后一关 —— 少了它，一个被
     污染的公共节点就能让服务端给任意 hash 签名。等于 null 处理：换下一个节点重试。
     注：这挡不住一个 RPC 伪造「哈希对得上」的整块（那要验共识，轻客户端做不到），
     但那属于供应链威胁，且扁平奖励下经济收益近乎为零。 */
  if (String(b.hash).toLowerCase() !== String(hash).toLowerCase()) return null;
  return { number: parseInt(b.number, 16), hash: b.hash.toLowerCase() };
}

/**
 * 按高度取块。分享落地页 /s/<区块号> 要用它把区块号翻回哈希。
 *
 * **和 blockByHash 不是一回事，不能互相替代**：那条是"这个哈希真是本链的块吗"，
 * 是签名前的最后一道核对；这条是"第 N 块的哈希是多少"，只是个查询 ——
 * 高度是我们自己传上去的，节点回什么就是什么，没有可核对的东西
 * （所以它的结果**不能**直接拿去签名，要签就得再走一遍 blockByHash）。
 *
 * @returns {Promise<{number:number, hash:string}|null>}
 *   null = 这条链上还没有这个高度（未来的块 / 打错的数）。
 *   抛错 = 所有 RPC 都打不通。两者必须分开，理由见 overNodes。
 */
async function blockByNumber(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 0) return null;
  const b = await overNodes('eth_getBlockByNumber', ['0x' + num.toString(16), false]);
  if (!b || !b.hash) return null;
  /* 核对回来的高度就是问的那个：诚实节点必然相等，不等说明这个 RPC 在乱答，
     换一个也没有意义（当成"没有"处理，调用方会退到通用文案）。 */
  if (parseInt(b.number, 16) !== num) return null;
  return { number: num, hash: String(b.hash).toLowerCase() };
}

/**
 * 只读合约调用。用来读 tokenURI 需要的链上事实（universeOf / cardOf / burnedOn / rescueOf）。
 *
 * public mapping 的 getter 在**合约有这个字段时**不会 revert：不存在的 token 返回全零
 * 而不是报错，所以"这枚 token 不存在"由调用方看 blockHash 是否为零来判断。
 *
 * 但**合约上压根没有这个函数**时会 revert —— 已部署的那版就没有 cardOf/burnedOn/rescueOf。
 * 这种 revert 是一个有意义的答复（"这条链上的这个合约不认识这个概念"），不是故障，
 * 所以给调用方一个开关：nullOnRevert 的字段拿 null，其余的照旧把错抛上去。
 *
 * @param {{nullOnRevert?:boolean}} [opts]
 */
async function ethCall(to, data, opts) {
  try {
    return await overNodes('eth_call', [{ to, data }, 'latest']);
  } catch (e) {
    if (e.reverted && opts && opts.nullOnRevert) return null;
    throw e;
  }
}

module.exports = {
  blockByHash, blockByNumber, ethCall, rpc,
  CHAIN_ID, CHAIN_NAME, CHAIN_NAMES, RPCS, LOG_RPCS,
  probeChainId, liveChainId, probeLogRpc, liveLogRpcOk,
  rpcsForLogs, chainConfigErrors, TESTNET_RPC_RE, redactUrl
};
