#!/usr/bin/env node
/*
 * tools/verify-onchain.test.js —— 链上比对工具的自检（全程不联网）
 * ------------------------------------------------------------
 * 用法：node tools/verify-onchain.test.js
 *
 * 合约没部署之前没有真链可读，部署之后测试也不该依赖公开 RPC 的心情 ——
 * 所以这里把 fetch 换成一个假节点：它认 universeOf / cardOf 两个选择器和 eth_getBlockByNumber，
 * 按 abi 规则吐回 32 字节字。覆盖：
 *   1. 选择器计算（对已知向量 + 对 contracts/out 的 ABI + 有 ethers 时再对一遍）
 *   2. 结构体解码（字段顺序、各类型、脏高位、长度不对、全零 = 不存在）
 *   3. 端到端：全一致 ✓ / 篡改任一项 ✗ / cardOf 为 0 单独说明不判失败 / RPC 轮换 / --block
 *   4. 命令行：合约未部署时友好退出（退出码 0，不抛栈）、用法错退 2
 */
'use strict';

const fs = require('fs');
const path = require('path');
const V = require('./verify-onchain.js');
const R = require('./recompute.js');

let pass = 0, fail = 0;
function ok(m) { pass++; console.log('✓ ' + m); }
function bad(m) { fail++; console.log('✗ ' + m); }
function check(cond, m, detail) { cond ? ok(m) : bad(m + (detail ? ' —— ' + detail : '')); }
function throws(fn, re, m) {
  try { fn(); bad(m + ' —— 没抛错'); }
  catch (e) { check(re.test(e.message), m, '错误信息是：' + e.message); }
}

const HASH = '0x0d21840abff46b96c84b2ac9e10e4f5cdaeb5693cb665db62a2f3b02d2d57b5b';
const CONTRACT = '0x' + 'c0'.repeat(20);
const MINTER = '0x' + 'ab'.repeat(20);
const SEL_UNIVERSE = '0x003eb9d7';      // ethers.id('universeOf(uint256)').slice(0, 10)，2026-09-17 独立算的
const SEL_CARD = '0xc22b8d82';          // ethers.id('cardOf(uint256)').slice(0, 10)

/** 按 abi 规则拼 universeOf 的返回：七个 32 字节字 */
function encodeUniverse(u) {
  return '0x' + u.blockHash.slice(2) + V.word(u.blockNumber) + V.word(u.mintedAt) +
    '0'.repeat(24) + u.minter.slice(2) + V.word(u.outcome) + V.word(u.verified ? 1 : 0) + V.word(u.rarity);
}

/** 假节点。tokens: { '<十进制 id>': { universe, cardHash } }；记下每次请求供断言 */
function fakeNode(tokens, o) {
  o = o || {};
  const seen = [];
  const fetchImpl = async (url, opt) => {
    const req = JSON.parse(opt.body);
    seen.push({ url: url, method: req.method, params: req.params });
    if (o.dead && o.dead.indexOf(url) >= 0) throw new Error('connect ECONNREFUSED');
    let result;
    if (req.method === 'eth_call') {
      const call = req.params[0], sel = call.data.slice(0, 10), id = BigInt('0x' + call.data.slice(10)).toString();
      if (call.to !== CONTRACT) result = '0x';                                   // 没有合约的地址
      else if (sel === SEL_UNIVERSE) result = tokens[id] ? encodeUniverse(tokens[id].universe) : '0x' + '0'.repeat(64 * 7);
      else if (sel === SEL_CARD) result = tokens[id] ? tokens[id].cardHash : V.ZERO32;
      else return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }) };
    } else if (req.method === 'eth_getBlockByNumber') {
      result = { number: req.params[0], hash: o.blockHash || HASH };
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: result }) };
  };
  return { fetch: fetchImpl, seen: seen };
}

function token(over, cardHash) {
  const c = R.recompute(HASH);
  const universe = Object.assign({
    blockHash: HASH, blockNumber: 12345678n, mintedAt: 1789000000n, minter: MINTER,
    outcome: c.outcome.index, verified: true, rarity: c.rarity.index
  }, over || {});
  return { universe: universe, cardHash: cardHash === undefined ? c.cardHash : cardHash };
}

(async function () {
  /* ---- 1. 选择器 ---- */
  check(V.selector('transfer(address,uint256)') === '0xa9059cbb', '选择器 transfer(address,uint256) = 0xa9059cbb（ERC-20 的公知向量）');
  check(V.selector('ownerOf(uint256)') === '0x6352211e', '选择器 ownerOf(uint256) = 0x6352211e（ERC-721 的公知向量）');
  check(V.selector('universeOf(uint256)') === SEL_UNIVERSE, '选择器 universeOf(uint256) = ' + SEL_UNIVERSE, '算出来是 ' + V.selector('universeOf(uint256)'));
  check(V.selector('cardOf(uint256)') === SEL_CARD, '选择器 cardOf(uint256) = ' + SEL_CARD, '算出来是 ' + V.selector('cardOf(uint256)'));
  check(V.callData('universeOf(uint256)', 1n) === SEL_UNIVERSE + '0'.repeat(63) + '1' &&
    V.callData('cardOf(uint256)', 255) === SEL_CARD + '0'.repeat(62) + 'ff', 'calldata = 选择器 + 一个 32 字节大端字');

  /* 解码顺序是照着合约抄的；合约那边一改，编译产物里的 ABI 会先变 —— 拿它当哨兵 */
  const abiFile = path.join(__dirname, '..', 'contracts', 'out', 'ArcUniverse.abi.json');
  if (fs.existsSync(abiFile)) {
    const abi = JSON.parse(fs.readFileSync(abiFile, 'utf8'));
    const fn = abi.find((x) => x.type === 'function' && x.name === 'universeOf');
    const sig = fn && fn.outputs.map((x) => x.name + ':' + x.type).join(',');
    check(sig === 'blockHash:bytes32,blockNumber:uint64,mintedAt:uint64,minter:address,outcome:uint8,verified:bool,rarity:uint8' &&
      fn.outputs.map((x) => x.name).join() === V.UNIVERSE_FIELDS.join(),
      'universeOf 的解码顺序与 contracts/out/ArcUniverse.abi.json 一致（7 个静态字段）', 'ABI 里是 ' + sig);
    const card = abi.find((x) => x.type === 'function' && x.name === 'cardOf');
    check(card && card.inputs.length === 1 && card.inputs[0].type === 'uint256' && card.outputs.length === 1 && card.outputs[0].type === 'bytes32',
      'cardOf(uint256) → bytes32 与 ABI 一致');
  } else console.log('○ 跳过与 ABI 的比对（contracts/out/ArcUniverse.abi.json 不在：cd contracts && node tools/compile.js src/ArcUniverse.sol）');

  let ethers = null;
  try { ethers = require(path.join(__dirname, '..', 'server', 'node_modules', 'ethers')); }
  catch (e) { console.log('○ 跳过与 ethers 的比对（缺 ethers：cd server && npm i）'); }

  /* ---- 2. 结构体解码 ---- */
  const t = token({ verified: false, blockNumber: 0xffffffffffffffffn });
  const d = V.decodeUniverse(encodeUniverse(t.universe));
  check(d.blockHash === HASH, '解码 blockHash（bytes32，第 0 个字）');
  check(d.blockNumber === 0xffffffffffffffffn && d.mintedAt === 1789000000n, '解码 blockNumber / mintedAt（uint64 取满也不丢精度）');
  check(d.minter === MINTER, '解码 minter（address = 字的后 20 字节）');
  check(d.outcome === t.universe.outcome && d.rarity === t.universe.rarity && d.verified === false && d.exists === true,
    '解码 outcome / verified / rarity（第 4、5、6 个字，verified 夹在两个 uint8 中间）');
  check(V.decodeUniverse(encodeUniverse(token({ outcome: 11, rarity: 4, verified: true }).universe)).verified === true, '解码 verified = true');
  check(V.decodeUniverse('0x' + '0'.repeat(64 * 7)).exists === false, '全零返回 = 这枚不存在（mapping 缺省值，不是 revert）');
  throws(() => V.decodeUniverse('0x'), /没有合约/, '空返回报「没有合约」而不是硬解');
  throws(() => V.decodeUniverse('0x' + '0'.repeat(64 * 6)), /7 个 32 字节字/, '少一个字（旧版 6 字段结构体）拒绝解码');
  throws(() => V.decodeUniverse(encodeUniverse(t.universe).replace(/.{64}$/, '0'.repeat(61) + '100')), /rarity 超出 uint8/, 'uint8 高位有脏数据拒绝解码');
  check(V.decodeBytes32('0x' + 'Ab'.repeat(32)) === '0x' + 'ab'.repeat(32), '解码 bytes32（统一小写）');

  if (ethers) {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const u = t.universe;
    const enc = coder.encode(['bytes32', 'uint64', 'uint64', 'address', 'uint8', 'bool', 'uint8'],
      [u.blockHash, u.blockNumber, u.mintedAt, u.minter, u.outcome, u.verified, u.rarity]);
    const m = V.decodeUniverse(enc);
    check(enc === encodeUniverse(u) && m.minter === MINTER && m.blockNumber === u.blockNumber && m.rarity === u.rarity,
      '与 ethers AbiCoder 的编码逐字节一致，解得回来');
    check(ethers.id('universeOf(uint256)').slice(0, 10) === V.selector('universeOf(uint256)') &&
      ethers.id('cardOf(uint256)').slice(0, 10) === V.selector('cardOf(uint256)'), '两个选择器与 ethers.id() 一致');
  }

  /* ---- 3. 端到端（假节点）---- */
  const RPC = ['https://rpc.fake.invalid'];
  let node = fakeNode({ '1': token() });
  let r = await V.verify('1', { contract: CONTRACT, rpc: RPC, fetch: node.fetch });
  check(r.ok && r.exists && r.cardStamped && r.checks.map((c) => c.key).join() === 'outcome,rarity,cardHash' && r.checks.every((c) => c.ok),
    '链上与复算一致 → outcome / rarity / cardHash 三项全 ✓');
  check(node.seen.length === 2 && node.seen.every((s) => s.method === 'eth_call' && s.params[0].to === CONTRACT && s.params[1] === 'latest') &&
    node.seen[0].params[0].data === V.callData('universeOf(uint256)', 1) && node.seen[1].params[0].data === V.callData('cardOf(uint256)', 1),
    '恰好两次 eth_call：universeOf(1) 然后 cardOf(1)');

  const good = R.recompute(HASH);
  const tamper = [
    ['outcome', token({ outcome: (good.outcome.index + 1) % 12 })],
    ['rarity', token({ rarity: (good.rarity.index + 1) % 5 })],
    ['cardHash', token(null, '0x' + good.cardHash.slice(2, 64) + (good.cardHash.slice(-2) === '00' ? '01' : '00'))]
  ];
  for (const [key, tk] of tamper) {
    r = await V.verify('1', { contract: CONTRACT, rpc: RPC, fetch: fakeNode({ '1': tk }).fetch });
    const wrong = r.checks.filter((c) => !c.ok).map((c) => c.key).join();
    check(!r.ok && wrong === key, '链上 ' + key + ' 被改过 → 只有这一项 ✗', '✗ 的是 ' + (wrong || '（无）'));
  }

  r = await V.verify('1', { contract: CONTRACT, rpc: RPC, fetch: fakeNode({ '1': token(null, V.ZERO32) }).fetch });
  check(r.ok && r.cardStamped === false && r.checks.map((c) => c.key).join() === 'outcome,rarity',
    'cardOf 为 0（没走服务端签名）→ 不判失败，只比 outcome / rarity');

  r = await V.verify('7', { contract: CONTRACT, rpc: RPC, fetch: fakeNode({ '1': token() }).fetch });
  check(r.exists === false && r.ok === false && r.checks.length === 0, '没铸过的 tokenId → exists=false，不去复算');

  node = fakeNode({ '1': token() }, { dead: ['https://dead.invalid'] });
  r = await V.verify('0x1', { contract: CONTRACT, rpc: ['https://dead.invalid'].concat(RPC), fetch: node.fetch });
  check(r.ok && node.seen.filter((s) => s.url === RPC[0]).length === 2, '第一个 RPC 挂了 → 轮换到下一个（tokenId 也认 0x 写法）');

  let msg = '';
  try { await V.verify('1', { contract: CONTRACT, rpc: ['https://dead.invalid'], fetch: node.fetch }); } catch (e) { msg = e.message; }
  check(/所有 RPC 都没答上来/.test(msg) && /ECONNREFUSED/.test(msg), 'RPC 全挂 → 报错里带每一家的死因');

  msg = '';
  try { await V.verify('1', { contract: '0x' + '11'.repeat(20), rpc: RPC, fetch: node.fetch }); } catch (e) { msg = e.message; }
  check(/没有合约/.test(msg), '地址上没有合约（eth_call 返回 0x）→ 明说，不当成不一致');

  r = await V.verify('1', { contract: CONTRACT, rpc: RPC, fetch: fakeNode({ '1': token() }).fetch, checkBlock: true });
  const r2 = await V.verify('1', { contract: CONTRACT, rpc: RPC, fetch: fakeNode({ '1': token() }, { blockHash: '0x' + '22'.repeat(32) }).fetch, checkBlock: true });
  check(r.ok && r.checks.length === 4 && !r2.ok && r2.checks.filter((c) => !c.ok).map((c) => c.key).join() === 'block',
    '--block：节点上该高度的哈希一致 ✓，不一致 ✗');

  /* ---- 4. 命令行 ---- */
  const run = async (argv, deps) => {
    const out = [];
    const code = await V.main(argv, Object.assign({ env: {}, log: (s) => out.push(s), err: (s) => out.push(s) }, deps));
    return { code: code, text: out.join('\n') };
  };
  const never = async () => { throw new Error('不该联网'); };

  let c = await run(['1'], { config: { contract: '', rpc: RPC, chain: {} }, fetch: never });
  check(c.code === 0 && /ArcUniverse 尚未部署/.test(c.text) && !/\bat .*\.js:\d+/.test(c.text), '合约未部署 → 打印「ArcUniverse 尚未部署」，退出码 0，不抛栈、不联网');

  c = await run([], { config: { contract: '', rpc: RPC }, fetch: never });
  const c2 = await run(['abc'], { config: { contract: '', rpc: RPC }, fetch: never });
  const c3 = await run(['1', '--wat'], { config: { contract: '', rpc: RPC }, fetch: never });
  check(c.code === 2 && c2.code === 2 && c3.code === 2 && /用法/.test(c.text), '没给 tokenId / 不是整数 / 不认识的参数 → 退出码 2 并打印用法');

  const cfgOn = { contract: CONTRACT, rpc: RPC, chain: { name: 'Arc 主网' } };
  c = await run(['1'], { config: cfgOn, fetch: fakeNode({ '1': token() }).fetch });
  check(c.code === 0 && (c.text.match(/^✓ /gm) || []).length === 4 && !/✗/.test(c.text), '命令行：一致 → 三项 ✓ + 总结 ✓，退出码 0');
  c = await run(['1'], { config: cfgOn, fetch: fakeNode({ '1': tamper[2][1] }).fetch });
  check(c.code === 1 && /✗ cardHash/.test(c.text) && /✓ 结局/.test(c.text), '命令行：cardHash 对不上 → 那一项 ✗，退出码 1');
  c = await run(['1'], { config: cfgOn, fetch: fakeNode({ '1': token(null, V.ZERO32) }).fetch });
  check(c.code === 0 && /○ cardHash/.test(c.text) && /没走服务端签名/.test(c.text) && !/✗/.test(c.text), '命令行：cardOf 为 0 → ○ 单独说明，退出码 0');
  c = await run(['9'], { config: cfgOn, fetch: fakeNode({}).fetch });
  check(c.code === 1 && /链上没有 #9/.test(c.text), '命令行：这枚不存在 → 说清楚，退出码 1');
  c = await run(['1', '--json'], { config: cfgOn, fetch: fakeNode({ '1': token() }).fetch });
  let j = null; try { j = JSON.parse(c.text); } catch (e) { /* 下面判 */ }
  check(c.code === 0 && j && j.ok === true && j.chain.blockNumber === '12345678' && j.local.cardHash === good.cardHash, '--json：BigInt 转成字符串，能被 JSON.parse 读回');

  /* 覆盖顺序：--contract > 环境变量 > 配置文件；--rpc 同理 */
  node = fakeNode({ '1': token() });
  c = await run(['1', '--rpc', 'https://flag.invalid', '--contract=' + CONTRACT],
    { config: { contract: '', rpc: RPC, chain: {} }, env: { ARCBANG_CONTRACT: '0x' + '11'.repeat(20), ARCBANG_RPC: 'https://env.invalid' }, fetch: node.fetch });
  check(c.code === 0 && node.seen.every((s) => s.url === 'https://flag.invalid' && s.params[0].to === CONTRACT), '--rpc / --contract 压过环境变量，环境变量压过配置文件');
  node = fakeNode({ '1': token() });
  c = await run(['1'], { config: { contract: '', rpc: RPC, chain: {} }, env: { ARCBANG_CONTRACT: CONTRACT, ARCBANG_RPC: 'https://a.invalid, https://b.invalid' }, fetch: node.fetch });
  check(c.code === 0 && node.seen.every((s) => s.url === 'https://a.invalid'), '环境变量 ARCBANG_CONTRACT / ARCBANG_RPC（逗号分隔）生效');

  /* 真的那份 web/config.arc.js 读得出来 */
  const cfg = V.loadConfig();
  check(typeof cfg.contract === 'string' && cfg.rpc.length >= 1 && cfg.rpc.every((u) => /^https?:\/\//.test(u)) && cfg.chain.id > 0,
    'web/config.arc.js 读得出来：rpc ' + cfg.rpc.length + ' 个（同域相对路径已滤掉），chainId ' + cfg.chain.id +
    '，contract ' + (cfg.contract || '（空，尚未部署）'));

  /* 真进程跑一遍。只在合约还没部署时跑 —— 部署之后这条命令会去联网，那不是单测该干的事 */
  if (!cfg.contract) {
    const env = Object.assign({}, process.env); delete env.ARCBANG_CONTRACT; delete env.ARCBANG_RPC;
    const p = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'verify-onchain.js'), '1'], { encoding: 'utf8', env: env });
    check(p.status === 0 && /ArcUniverse 尚未部署/.test(p.stdout) && p.stderr === '', '真进程：node tools/verify-onchain.js 1 → 友好退出，退出码 0，stderr 为空');
  } else console.log('○ 跳过真进程那一条（contract 已填，跑了就会联网）');

  console.log('\n通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试自己崩了：' + (e && e.stack)); process.exit(1); });
