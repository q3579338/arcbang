#!/usr/bin/env node
/*
 * tools/verify-onchain.js —— 把链上那枚 NFT 读回来，与本地复算逐字节比对
 * ------------------------------------------------------------
 * 用法：node tools/verify-onchain.js <tokenId> [--rpc <url>] [--contract <0x地址>] [--block] [--json]
 *
 * 做的事：
 *   1. 打两次 eth_call：universeOf(tokenId) 拿回链上存的那份（区块哈希、结局、稀有度……），
 *      cardOf(tokenId) 拿回参数指纹；
 *   2. 只拿其中的 **blockHash** 喂给 tools/recompute.js，把整个宇宙在本机重算一遍；
 *   3. outcome / rarity / cardHash 三项与链上逐字节比对：一致 ✓，不一致 ✗ 并以非 0 退出。
 *   加 --block 再多打一次 eth_getBlockByNumber，核对那个哈希确实是 Arc 上那个高度的区块
 *   （verified=false 的老区块合约自己验不了，就是留给这一步的）。
 *
 * 服务端的任何东西都不参与：RPC 是公开节点，复算只吃那个哈希。
 *
 * **零依赖**（理由同 recompute.js）：Node 18 起自带 fetch；函数选择器用 engine/archash.js
 * 里那份 BigInt keccak256 现算；返回值全是静态类型，abi 解码就是按 32 字节切字。
 *
 * 合约地址与 RPC 从 web/config.arc.js 读（站点用的就是这一份），可以覆盖：
 *   --contract / 环境变量 ARCBANG_CONTRACT
 *   --rpc      / 环境变量 ARCBANG_RPC（逗号分隔多个，按顺序轮换）
 *
 * 退出码：0 = 全部一致（或合约尚未部署）；1 = 有不一致 / 读不到 / 这枚不存在；2 = 用法错。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'engine/archash.js'));
const R = require('./recompute.js');

const ZERO32 = '0x' + '0'.repeat(64);

/* ------------------------------------------------------------ abi：选择器 / 编码 / 解码 */

/** 函数选择器 = keccak256(签名) 的前 4 字节 */
function selector(sig) { return B.keccak256(sig).slice(0, 10); }

/** uint256 → 32 字节大端字（不带 0x） */
function word(n) {
  const v = BigInt(n);
  if (v < 0n) throw new Error('uint256 不能是负数：' + n);
  const h = v.toString(16);
  if (h.length > 64) throw new Error('放不进 uint256：' + n);
  return '0'.repeat(64 - h.length) + h;
}

/** 单个 uint256 参数的 calldata */
function callData(sig, tokenId) { return selector(sig) + word(tokenId); }

/** 返回值切成 32 字节字；长度不对直接报错（别拿半截数据去比） */
function words(hex, n, what) {
  const s = String(hex || '').replace(/^0x/i, '').toLowerCase();
  if (s === '') throw new Error(what + ' 返回空：这个地址上没有合约，或者不是 ArcUniverse');
  if (!/^[0-9a-f]*$/.test(s) || s.length !== n * 64) {
    throw new Error(what + ' 的返回应是 ' + n + ' 个 32 字节字，实际 ' + (s.length / 2) + ' 字节');
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push(s.slice(i * 64, (i + 1) * 64));
  return out;
}

/** 无符号整数字；bits 位之外必须全零（高位有脏数据说明解码位置错了，宁可报错） */
function uintOf(w, bits, name) {
  const v = BigInt('0x' + w);
  if (v >> BigInt(bits) !== 0n) throw new Error(name + ' 超出 uint' + bits + '：0x' + w);
  return v;
}

/*
 * universeOf(uint256) 是 public mapping 的自动 getter：结构体成员按**声明顺序**平铺成一个元组，
 * 七个成员全是静态类型，所以返回就是七个 32 字节字（contracts/src/ArcUniverse.sol 的 struct Universe）：
 *   [0] bytes32 blockHash   [1] uint64 blockNumber   [2] uint64 mintedAt   [3] address minter
 *   [4] uint8 outcome       [5] bool verified        [6] uint8 rarity
 * tools/verify-onchain.test.js 会拿 contracts/out/ArcUniverse.abi.json 核对这个顺序，防止两边漂移。
 */
const UNIVERSE_FIELDS = ['blockHash', 'blockNumber', 'mintedAt', 'minter', 'outcome', 'verified', 'rarity'];

function decodeUniverse(hex) {
  const w = words(hex, 7, 'universeOf');
  uintOf(w[3], 160, 'minter');                                  // 地址左边 12 字节必须是零
  const verified = uintOf(w[5], 1, 'verified');
  const u = {
    blockHash: '0x' + w[0],
    blockNumber: uintOf(w[1], 64, 'blockNumber'),
    mintedAt: uintOf(w[2], 64, 'mintedAt'),
    minter: '0x' + w[3].slice(24),
    outcome: Number(uintOf(w[4], 8, 'outcome')),
    verified: verified === 1n,
    rarity: Number(uintOf(w[6], 8, 'rarity'))
  };
  /* 没铸过的 tokenId 读出来是全零（mapping 的缺省值），不是 revert。
     mintedAt 是 block.timestamp，铸过的一定非零。 */
  u.exists = !(u.blockHash === ZERO32 && u.mintedAt === 0n);
  return u;
}

function decodeBytes32(hex, what) { return '0x' + words(hex, 1, what || 'bytes32')[0]; }

/* ------------------------------------------------------------ 配置 */

/** web/config.arc.js 是给浏览器的脚本（window.ARCBANG_CONFIG = {…}），放进沙箱里跑一下取值 */
function loadConfig(file) {
  const f = file || path.join(ROOT, 'web', 'config.arc.js');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
  const c = sandbox.window.ARCBANG_CONFIG || {};
  return {
    contract: String(c.contract || '').trim(),
    /* 站点配置里有 '/api/rpc' 这种同域相对路径，命令行下没有「同域」，只留完整的 http(s) 地址 */
    rpc: [].concat(c.rpc || []).map(String).filter((u) => /^https?:\/\//i.test(u)),
    chain: c.chain || {}
  };
}

function parseTokenId(s) {
  const t = String(s == null ? '' : s).trim();
  if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(t)) throw new Error('tokenId 要是十进制或 0x 十六进制的非负整数：' + s);
  return BigInt(t);
}

/* ------------------------------------------------------------ JSON-RPC */

/** 按顺序试每个 RPC，第一个答得上来的算数；全挂了把每家的死因一起报出来 */
async function rpcCall(rpcs, method, params, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('这个 Node 没有内置 fetch，请用 Node 18 或更新的版本');
  const errs = [];
  for (const url of rpcs) {
    try {
      const opt = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
      };
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opt.signal = AbortSignal.timeout(15000);
      const res = await f(url, opt);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) throw new Error('RPC 报错：' + (j.error.message || JSON.stringify(j.error)));
      return j.result;
    } catch (e) {
      errs.push(url + ' → ' + (e && e.message));
    }
  }
  throw new Error('所有 RPC 都没答上来：\n  ' + errs.join('\n  '));
}

function ethCall(rpcs, to, data, fetchImpl) {
  return rpcCall(rpcs, 'eth_call', [{ to: to, data: data }, 'latest'], fetchImpl);
}

/* ------------------------------------------------------------ 比对 */

/**
 * 读链 + 复算 + 比对。不打印、不退出，结果整个返回（测试直接调这个）。
 * opts: { contract, rpc: [url…], fetch?, checkBlock? }
 */
async function verify(tokenId, opts) {
  const id = parseTokenId(tokenId);
  const contract = String(opts.contract || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) throw new Error('合约地址不是 20 字节的 0x 地址：' + contract);
  const rpcs = [].concat(opts.rpc || []);
  if (!rpcs.length) throw new Error('没有可用的 RPC（--rpc 或 ARCBANG_RPC 指定一个）');

  const chain = decodeUniverse(await ethCall(rpcs, contract, callData('universeOf(uint256)', id), opts.fetch));
  const out = { tokenId: id.toString(), contract: contract, exists: chain.exists, chain: chain, checks: [], ok: false };
  if (!chain.exists) return out;
  chain.cardHash = decodeBytes32(await ethCall(rpcs, contract, callData('cardOf(uint256)', id), opts.fetch), 'cardOf');

  /* 本地复算只吃链上那个哈希，别的一概不看 */
  const local = R.recompute(chain.blockHash);
  out.local = local;

  const name = (i) => R.OUTCOME_ORDER[i] || '不在 OUTCOMES 里';
  out.checks.push({
    key: 'outcome', ok: chain.outcome === local.outcome.index,
    chain: chain.outcome + ' · ' + name(chain.outcome), local: local.outcome.index + ' · ' + local.outcome.id
  });
  out.checks.push({
    key: 'rarity', ok: chain.rarity === local.rarity.index,
    chain: chain.rarity + ' · ' + (R.RARITY_NAME[chain.rarity] || '?'), local: local.rarity.index + ' · ' + local.rarity.name
  });
  /* cardOf 为 0 = 这枚铸造时没带服务端签名（不带参数的那条路），合约就没写指纹。
     这不是「对不上」，是「链上没有这一项可对」—— 单独说明，不判失败。 */
  out.cardStamped = chain.cardHash !== ZERO32;
  if (out.cardStamped) {
    out.checks.push({ key: 'cardHash', ok: chain.cardHash === local.cardHash, chain: chain.cardHash, local: local.cardHash });
  }

  if (opts.checkBlock) {
    const blk = await rpcCall(rpcs, 'eth_getBlockByNumber', ['0x' + chain.blockNumber.toString(16), false], opts.fetch);
    const got = blk && blk.hash ? String(blk.hash).toLowerCase() : null;
    out.checks.push({
      key: 'block', ok: got === chain.blockHash,
      chain: chain.blockHash, local: got || '节点没返回这个高度的区块'
    });
  }

  out.ok = out.checks.every((c) => c.ok);
  return out;
}

/* ------------------------------------------------------------ 命令行 */

const USAGE = '用法：node tools/verify-onchain.js <tokenId> [--rpc <url>] [--contract <0x地址>] [--block] [--json]';

function parseArgs(argv) {
  const a = { pos: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--json' || s === '--block') a.flags[s.slice(2)] = true;
    else if (s === '--rpc' || s === '--contract') {
      if (argv[i + 1] == null) throw new Error(s + ' 后面要跟一个值');
      a.flags[s.slice(2)] = argv[++i];
    } else if (/^--(rpc|contract)=/.test(s)) a.flags[s.slice(2, s.indexOf('='))] = s.slice(s.indexOf('=') + 1);
    else if (s.indexOf('--') === 0) throw new Error('不认识的参数：' + s);
    else a.pos.push(s);
  }
  return a;
}

/** JSON 里放不了 BigInt */
function jsonSafe(k, v) { return typeof v === 'bigint' ? v.toString() : v; }

/**
 * 返回退出码，不自己 process.exit —— 测试要能直接调。
 * deps: { env?, config?, fetch?, log?, err? }
 */
async function main(argv, deps) {
  deps = deps || {};
  const env = deps.env || process.env;
  const log = deps.log || console.log;
  const err = deps.err || console.error;

  let args, id;
  try {
    args = parseArgs(argv);
    if (args.pos.length !== 1) throw new Error('要且只要一个 tokenId');
    id = parseTokenId(args.pos[0]);
  } catch (e) { err((e && e.message) + '\n' + USAGE); return 2; }

  let cfg;
  try { cfg = deps.config || loadConfig(); }
  catch (e) { err('读不了 web/config.arc.js：' + (e && e.message)); return 1; }

  const contract = String(args.flags.contract || env.ARCBANG_CONTRACT || cfg.contract || '').trim();
  const rpcSrc = args.flags.rpc || env.ARCBANG_RPC;
  const rpc = rpcSrc ? String(rpcSrc).split(',').map((s) => s.trim()).filter(Boolean) : cfg.rpc;

  if (!contract) {
    log('ArcUniverse 尚未部署：web/config.arc.js 的 contract 还是空的，链上没有东西可对。');
    log('部署之后再跑这条命令；想先对别处的部署，用 --contract <0x地址> 或环境变量 ARCBANG_CONTRACT。');
    log('不联网的那一半现在就能跑：node tools/recompute.js 0x<区块哈希>');
    return 0;
  }

  let r;
  try { r = await verify(id, { contract: contract, rpc: rpc, fetch: deps.fetch, checkBlock: !!args.flags.block }); }
  catch (e) { err('验不了：' + (e && e.message)); return 1; }

  if (args.flags.json) { log(JSON.stringify(r, jsonSafe, 2)); return r.exists && r.ok ? 0 : 1; }

  log('合约       ' + r.contract + (cfg.chain && cfg.chain.name ? '（' + cfg.chain.name + '）' : ''));
  log('tokenId    #' + r.tokenId);
  if (!r.exists) {
    err('\n✗ 链上没有 #' + r.tokenId + ' 这一枚（universeOf 读出来全是零）—— 还没铸到这个编号，或者 tokenId 写错了。');
    return 1;
  }
  const c = r.chain;
  log('区块哈希   ' + c.blockHash);
  log('区块高度   ' + c.blockNumber + (c.verified ? '（铸造时合约用 blockhash() 验过）' : '（铸造时已超出 256 块窗口，合约没验；加 --block 现在验）'));
  log('铸造时间   ' + new Date(Number(c.mintedAt) * 1000).toISOString());
  log('铸造者     ' + c.minter);
  log('');

  const LABEL = { outcome: '结局      ', rarity: '稀有度    ', cardHash: 'cardHash  ', block: '区块哈希  ' };
  r.checks.forEach((k) => {
    if (k.ok) log('✓ ' + LABEL[k.key] + ' ' + k.chain + (k.key === 'block' ? '（与节点上该高度的区块一致）' : ''));
    else log('✗ ' + LABEL[k.key] + ' 链上 ' + k.chain + '  ≠  ' + (k.key === 'block' ? '节点 ' : '本地 ') + k.local);
  });
  if (!r.cardStamped) {
    log('○ cardHash   链上是 0 —— 这枚铸造时没走服务端签名（不带参数），合约没写参数指纹，这一项无从比对。');
    log('             本地从哈希算出来的是 ' + r.local.cardHash);
  }

  const n = r.checks.length, bad = r.checks.filter((k) => !k.ok).length;
  log('');
  if (bad) { log('✗ ' + n + ' 项里有 ' + bad + ' 项对不上：链上存的和从哈希算出来的不是同一个宇宙。'); return 1; }
  log('✓ ' + n + ' 项全部一致：链上这枚和从它的区块哈希重算出来的宇宙逐字节相同。');
  return 0;
}

module.exports = {
  selector, word, callData, words, decodeUniverse, decodeBytes32,
  loadConfig, parseTokenId, parseArgs, rpcCall, verify, main, UNIVERSE_FIELDS, ZERO32
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error('验不了：' + (e && e.message)); process.exitCode = 1; }
  );
}
