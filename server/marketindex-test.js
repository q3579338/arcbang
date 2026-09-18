/*
 * 市场索引自检 —— 对着
 * ============================================================================
 * 用法：node server/marketindex-test.js   （**不需要联网、不需要服务在跑**）
 *
 * 假 log 喂进状态机是这份测试的主体。理由：索引的所有难点都在状态机上 ——
 * 重扫窗口里的重放、乱序到达、Listed 在索引起点之前的残单、销毁 —— 而这些
 * 在真链上要么等不到、要么等到了也复现不了第二次。链那一侧只负责把 log 抓回来，
 * 它的正确性由「真链实测」那一步（规格第四节第 2 条）盯着。
 *
 * 环境变量在 require 之前设死：marketindex.js 与 chain.js 都在模块加载时读配置。
 * RPC 故意配成一个必然连不上的地址（127.0.0.1:1），好让「RPC 全挂」那一条
 * 测起来是秒级的 ECONNREFUSED，而不是等一轮真超时。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mkidx-'));

const MARKET = '0x1fa7e50d401b38faff65e454b22fc7ff47943cba';
const UNIVERSE = '0xee3b42eeab3fe0c25b6e62ce9ab57efbd5391ff2';
const CRAFTED = '0xb6669797262fd0211226d164ad20de9e34d7fae4';
const ALICE = '0x378efade29d33eddefcf0ef700917e343dfa2cdc';
const BOB = '0x1111111111111111111111111111111111111111';
const ZERO = '0x0000000000000000000000000000000000000000';

process.env.ARCBANG_STORE = TMP;
process.env.ARCBANG_MARKET = MARKET;
process.env.ARCBANG_CONTRACT = UNIVERSE;
process.env.ARCBANG_CRAFTED = CRAFTED;
process.env.ARCBANG_INDEX_CHUNK = '999999';        // 故意配一个越界的值，验证会被夹到 5000
process.env.ARCBANG_CHAIN_ID = '97';
process.env.ARCBANG_RPC = 'http://127.0.0.1:1';    // 必然连不上 → 秒级失败
delete process.env.ARCBANG_INDEX_OFF;

const MI = require('./marketindex.js');
const K = require(path.join(__dirname, '..', 'web/keccak-lite.js'));

let pass = 0, fail = 0;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ ' + name + (note ? '  ' + note : '')); }
  else { fail++; console.log('  ✗ ' + name + '  ' + (note || '')); }
}

/* ------------------------------------------------------------ 造假 log 的工具
   一条 eth_getLogs 返回的 log 长什么样：address / topics[] / data / blockNumber / logIndex。
   indexed 参数进 topics（左补零到 32 字节），其余按 ABI 顺序拼进 data。 */
const w = (v) => BigInt(v).toString(16).padStart(64, '0');
const tNum = (v) => '0x' + w(v);
const tAddr = (a) => '0x' + String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const data = (...ws) => '0x' + ws.map((v) => w(v)).join('');

let LOGI = 0;
function listedLog(blockNo, listingId, seller, token, id, price, opts) {
  opts = opts || {};
  return {
    address: MARKET,
    topics: [MI.TOPICS.Listed, tNum(listingId), tAddr(seller), tAddr(token)],
    data: data(id, opts.amount == null ? 1 : opts.amount, price, opts.is1155 ? 1 : 0, opts.inBang ? 1 : 0),
    blockNumber: tNum(blockNo),
    logIndex: tNum(opts.logIndex == null ? LOGI++ : opts.logIndex)
  };
}
function cancelledLog(blockNo, listingId, seller, logIndex) {
  return {
    address: MARKET,
    topics: [MI.TOPICS.Cancelled, tNum(listingId), tAddr(seller)],
    data: '0x',
    blockNumber: tNum(blockNo),
    logIndex: tNum(logIndex == null ? LOGI++ : logIndex)
  };
}
function soldLog(blockNo, listingId, buyer, seller, price, opts) {
  opts = opts || {};
  return {
    address: MARKET,
    topics: [MI.TOPICS.Sold, tNum(listingId), tAddr(buyer), tAddr(seller)],
    data: data(price, opts.fee || 0, opts.inBang ? 1 : 0),
    blockNumber: tNum(blockNo),
    logIndex: tNum(opts.logIndex == null ? LOGI++ : opts.logIndex)
  };
}
function transferLog(blockNo, token, from, to, tokenId, logIndex) {
  return {
    address: token,
    topics: [MI.TOPICS.Transfer, tAddr(from), tAddr(to), tNum(tokenId)],
    data: '0x',
    blockNumber: tNum(blockNo),
    logIndex: tNum(logIndex == null ? LOGI++ : logIndex)
  };
}

const CFG = MI._internals.CFG;
/* 这份测试从头到尾喂的是 MirrorMarket 的事件。**显式钉死 arc:false**：
   不钉的话解码器按 process.env.ARCBANG_CHAIN_ID 现挑，
   在一台 env 里留着 ARCBANG_CHAIN_ID=5042 的机器上跑，整份测试会莫名其妙全红。
   Arc 那一套的用例在 server/selftest.js 的 [S3]。 */
CFG.arc = false;
const fresh = () => MI.emptyState();

/* ============================================================ [T1] 选择器与 topic */
console.log('\n[T1] 事件 topic / 函数选择器 —— 用 web/keccak-lite.js 现算一遍比对');
{
  for (const k of Object.keys(MI.EVENT_SIGS)) {
    const got = K.keccak256(MI.EVENT_SIGS[k]);
    ok('topic ' + k + ' 与 keccak256(签名) 一致', got === MI.TOPICS[k], got);
  }
  for (const k of Object.keys(MI.FN_SIGS)) {
    const got = K.keccak256(MI.FN_SIGS[k]).slice(0, 10);
    ok('选择器 ' + k + ' 与 keccak256(签名)[0:4] 一致', got === MI.SEL[k], got);
  }
  /* 交叉验算：ERC-721 的 Transfer topic 是全世界都能查到的那一个。
     算错了不可能正好撞上它。 */
  ok('Transfer topic 就是世所共知的 0xddf252ad…',
    MI.TOPICS.Transfer === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
}

/* ============================================================ [T2] Listed / Cancelled / Sold */
console.log('\n[T2] 挂单状态机');
{
  const s = fresh();
  MI.applyLogs(s, [listedLog(100, 0, ALICE, UNIVERSE, 1, '1000000000000000000')], CFG);
  const l0 = s.listings['0'];
  ok('Listed 入表', !!l0 && l0.active === true, JSON.stringify(l0 && { seller: l0.seller, token: l0.token, id: l0.id }));
  ok('Listed 解出 seller/token/tokenId/price 都对',
    l0.seller === ALICE && l0.token === UNIVERSE && l0.id === '1' && l0.price === '1000000000000000000');
  ok('Listed 记下块高', l0.blockNo === 100);
  ok('inBang 默认 false（BNB 计价）', l0.inBang === false);

  MI.applyLogs(s, [listedLog(101, 1, ALICE, CRAFTED, 7, '2000', { inBang: true })], CFG);
  ok('BANG 计价的单 inBang=true', s.listings['1'].inBang === true);

  MI.applyLogs(s, [cancelledLog(110, 0, ALICE)], CFG);
  ok('Cancelled 下架', s.listings['0'].active === false && s.listings['0'].endedBy === 'Cancelled');
  ok('Cancelled 不影响别的单', s.listings['1'].active === true);

  MI.applyLogs(s, [soldLog(120, 1, BOB, ALICE, '2000', { inBang: true, fee: '100' })], CFG);
  ok('Sold 下架', s.listings['1'].active === false && s.listings['1'].endedBy === 'Sold');
  ok('Sold 记一笔成交价', s.sales.length === 1 && s.sales[0].price === '2000' && s.sales[0].inBang === true,
    JSON.stringify(s.sales[0]));
  ok('成交记录带买卖双方与 token', s.sales[0].buyer === BOB && s.sales[0].seller === ALICE
    && s.sales[0].token === CRAFTED && s.sales[0].tokenId === '7');

  /* activeSet 是翻页的入口（不扫历史全表），它跟 listings.active 走散的话
     市场页会显示已经卖掉的单、或者漏掉刚挂上的单 —— 两种都是「看得见的错」。 */
  const setMatchesFlags = (x) => {
    const inSet = Array.from(x.activeSet).sort().join(',');
    const byFlag = Object.keys(x.listings).filter((k) => x.listings[k].active).sort().join(',');
    return inSet === byFlag;
  };
  ok('activeSet 与 listings.active 一致（撤单/成交之后）', setMatchesFlags(s),
    'set=[' + Array.from(s.activeSet).join(',') + ']');
  ok('两张单一撤一卖之后 activeSet 是空的', s.activeSet.size === 0);
  MI.applyLogs(s, [listedLog(130, 2, BOB, UNIVERSE, 8, '55')], CFG);
  ok('新挂的单进 activeSet', s.activeSet.has('2') && s.activeSet.size === 1);
  ok('重放那条 Listed 不会把 activeSet 弄重（Set 本来也不会，但一致性要测）',
    (MI.applyLogs(s, [listedLog(130, 2, BOB, UNIVERSE, 8, '55', { logIndex: 0 })], CFG),
      s.activeSet.size === 1 && setMatchesFlags(s)));
}

/* ============================================================ [T3] 重放幂等（重组重扫） */
console.log('\n[T3] 重放幂等 —— 最近 15 块每轮重扫，同一批事件不能产生第二遍效果');
{
  const s = fresh();
  const round = [
    listedLog(200, 5, ALICE, UNIVERSE, 3, '500', { logIndex: 0 }),
    cancelledLog(202, 5, ALICE, 1)
  ];
  MI.applyLogs(s, round, CFG);
  const after1 = JSON.stringify(s.listings['5']);
  ok('先 Listed 后 Cancelled → 最终是下架', s.listings['5'].active === false);

  const r2 = MI.applyLogs(s, round, CFG);           // 重扫同一段
  ok('重扫同一段：一条都不生效', r2.changed === 0, 'changed=' + r2.changed);
  ok('重扫后挂单状态一字未改', JSON.stringify(s.listings['5']) === after1);
  ok('**重扫没有把撤掉的单重新点亮**', s.listings['5'].active === false);

  // Sold 的重放：sales 是 push，不做幂等的话每重扫一次就多一笔假成交
  const s2 = fresh();
  const round2 = [
    listedLog(300, 9, ALICE, UNIVERSE, 4, '700', { logIndex: 0 }),
    soldLog(300, 9, BOB, ALICE, '700', { logIndex: 1 })
  ];
  MI.applyLogs(s2, round2, CFG);
  MI.applyLogs(s2, round2, CFG);
  MI.applyLogs(s2, round2, CFG);
  ok('Sold 重放三次，成交只记一笔', s2.sales.length === 1, '实际 ' + s2.sales.length + ' 笔');

  // 同一块里 Listed 与 Cancelled 只差 logIndex：seq 必须把它们分开
  const s3 = fresh();
  MI.applyLogs(s3, [
    listedLog(400, 11, ALICE, UNIVERSE, 5, '900', { logIndex: 3 }),
    cancelledLog(400, 11, ALICE, 4)
  ], CFG);
  ok('同一块内靠 logIndex 定序：先挂后撤 → 下架', s3.listings['11'].active === false);
  MI.applyLogs(s3, [listedLog(400, 11, ALICE, UNIVERSE, 5, '900', { logIndex: 3 })], CFG);
  ok('同块内重放 Listed 不能覆盖后面的 Cancelled', s3.listings['11'].active === false);
}

/* ============================================================ [T4] 乱序到达 */
console.log('\n[T4] 乱序到达 —— 分片是并发请求回来的，顺序不保证');
{
  const s = fresh();
  // 故意把 Cancelled 放在 Listed 前面递进去
  MI.applyLogs(s, [
    cancelledLog(510, 20, ALICE, 1),
    listedLog(500, 20, ALICE, UNIVERSE, 6, '111', { logIndex: 0 })
  ], CFG);
  ok('applyLogs 内部按 (blockNumber, logIndex) 排序后再应用', s.listings['20'].active === false,
    'active=' + s.listings['20'].active);

  // 不排序的话，Transfer 也会算错最终持有人
  const s2 = fresh();
  MI.applyLogs(s2, [
    transferLog(605, UNIVERSE, ALICE, BOB, 1, 0),
    transferLog(600, UNIVERSE, ZERO, ALICE, 1, 0)
  ], CFG);
  ok('乱序的两条 Transfer 也能算出正确的最终持有人', s2.owners[UNIVERSE + ':1'] === BOB,
    s2.owners[UNIVERSE + ':1']);
}

/* ============================================================ [T5] Transfer 持仓累积 */
console.log('\n[T5] 持仓（Transfer 累积）');
{
  const s = fresh();
  MI.applyLogs(s, [
    transferLog(700, UNIVERSE, ZERO, ALICE, 1),           // 铸造
    transferLog(701, CRAFTED, ZERO, ALICE, 1),            // 造物铸造
    transferLog(702, UNIVERSE, ZERO, BOB, 2)
  ], CFG);
  ok('铸造进持仓表', s.owners[UNIVERSE + ':1'] === ALICE && s.owners[CRAFTED + ':1'] === ALICE);
  ok('两个系列各记各的（键带合约地址）',
    Object.keys(s.owners).length === 3, Object.keys(s.owners).join(' '));
  ok('反查表建起来了', s.byOwner.get(ALICE).size === 2 && s.byOwner.get(BOB).size === 1);

  MI.applyLogs(s, [transferLog(710, UNIVERSE, ALICE, BOB, 1)], CFG);
  ok('转手改持有人', s.owners[UNIVERSE + ':1'] === BOB);
  ok('转手同步改反查表：卖家少一枚', s.byOwner.get(ALICE).size === 1);
  ok('转手同步改反查表：买家多一枚', s.byOwner.get(BOB).size === 2);

  MI.applyLogs(s, [transferLog(720, UNIVERSE, BOB, ZERO, 2)], CFG);
  ok('销毁（to=0）把这一条删掉，不留「零地址持有」',
    s.owners[UNIVERSE + ':2'] === undefined && !s.byOwner.has(ZERO));

  // 重扫整段：最终持有人不变
  const snapshot = JSON.stringify(s.owners);
  MI.applyLogs(s, [
    transferLog(700, UNIVERSE, ZERO, ALICE, 1, 0),
    transferLog(710, UNIVERSE, ALICE, BOB, 1, 0),
    transferLog(720, UNIVERSE, BOB, ZERO, 2, 0)
  ], CFG);
  ok('重扫整段之后持仓表一字未改', JSON.stringify(s.owners) === snapshot);

  // 反查表重建（进程重启读盘走的就是这条路）
  const s2 = MI.emptyState();
  s2.owners = JSON.parse(snapshot);
  MI.rebuildDerived(s2);
  ok('读盘后能从 owners 重建反查表',
    s2.byOwner.get(BOB) && s2.byOwner.get(BOB).has(UNIVERSE + ':1'));
  ok('派生表不进落盘文件（byOwner / activeSet 都不可枚举）',
    JSON.stringify(s2).indexOf('byOwner') < 0 && JSON.stringify(s2).indexOf('activeSet') < 0);
}

/* ============================================================ [T6] 认不出来的 log */
console.log('\n[T6] 认不出来的 log 一条都不许进表');
{
  const s = fresh();
  const evil = [
    // ERC-20 的 Transfer：**同一个 topic0**，但只有 3 个 topic，金额在 data 里。
    // 认下来的话，一笔 1000 BANG 的转账会变成「tokenId 1000 的持仓」。
    { address: UNIVERSE, topics: [MI.TOPICS.Transfer, tAddr(ALICE), tAddr(BOB)], data: data('1000'), blockNumber: tNum(800), logIndex: tNum(0) },
    // 别的合约发的同名事件
    { address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', topics: [MI.TOPICS.Transfer, tAddr(ALICE), tAddr(BOB), tNum(1)], data: '0x', blockNumber: tNum(801), logIndex: tNum(0) },
    // 市场地址上的未知事件
    { address: MARKET, topics: ['0x' + 'ab'.repeat(32)], data: '0x', blockNumber: tNum(802), logIndex: tNum(0) },
    // 畸形
    { address: MARKET, topics: [], data: '0x', blockNumber: tNum(803), logIndex: tNum(0) },
    null
  ];
  const r = MI.applyLogs(s, evil, CFG);
  ok('五条垃圾一条都没进表', r.decoded === 0 && r.changed === 0
    && Object.keys(s.owners).length === 0 && Object.keys(s.listings).length === 0);
  ok('ERC-20 的 3-topic Transfer 被挡在门外（否则转账金额会变成 tokenId）',
    MI.decodeLog(evil[0], CFG) === null);
  ok('别的合约发的 Transfer 不认', MI.decodeLog(evil[1], CFG) === null);
}

/* ============================================================ [T7] Listed 在索引起点之前 */
console.log('\n[T7] 只见 Sold 没见 Listed（索引起点晚于挂单）');
{
  const s = fresh();
  MI.applyLogs(s, [soldLog(900, 42, BOB, ALICE, '333')], CFG);
  ok('建一条残桩而不是无视', !!s.listings['42'] && s.listings['42'].partial === true);
  ok('残桩是下架状态（我们没见过它挂着的样子）', s.listings['42'].active === false);
  ok('成交照记', s.sales.length === 1 && s.sales[0].listingId === '42');
  MI.applyLogs(s, [soldLog(900, 42, BOB, ALICE, '333', { logIndex: 0 })], CFG);
  ok('残桩也挡得住重放（不再记第二笔成交）', s.sales.length === 1, '实际 ' + s.sales.length);
}

/* ============================================================ [T8] 分片 */
console.log('\n[T8] 分片 —— 公共 RPC 的 eth_getLogs 跨度上限，超了是报错不是截断');
{
  ok('配了 999999 也被夹到 5000', CFG.chunk === 5000, 'chunk=' + CFG.chunk);
  ok('intervalMs/confirmations/physColdBudget 是夹紧后的有限整数（NaN 会狂扫或卡住）',
    Number.isFinite(CFG.intervalMs) && CFG.intervalMs >= 1000 && CFG.intervalMs <= 300000
    && Number.isInteger(CFG.confirmations) && CFG.confirmations >= 0 && CFG.confirmations <= 256
    && Number.isInteger(CFG.physColdBudget) && CFG.physColdBudget >= 1 && CFG.physColdBudget <= 256,
    JSON.stringify({ intervalMs: CFG.intervalMs, confirmations: CFG.confirmations, phys: CFG.physColdBudget }));

  const r1 = MI.chunkRanges(1, 10000, 5000);
  ok('[1,10000] 分 5000 → 两片', r1.length === 2, JSON.stringify(r1));
  ok('闭区间：第一片是 [1,5000] 不是 [1,5001]', r1[0][0] === 1 && r1[0][1] === 5000);
  ok('片与片首尾相接不漏块', r1[1][0] === r1[0][1] + 1 && r1[1][1] === 10000);
  for (const [a, b] of r1) ok('每片跨度 ≤ 5000（含两端）', b - a + 1 <= 5000, (b - a + 1) + ' 块');

  const r2 = MI.chunkRanges(1, 50000, 5000);
  ok('五万块 → 正好 10 片', r2.length === 10);
  ok('十片覆盖到底不多不少', r2[0][0] === 1 && r2[9][1] === 50000);
  let cover = 0; for (const [a, b] of r2) cover += b - a + 1;
  ok('十片加起来正好五万块', cover === 50000, cover + '');

  ok('单块区间给一片', JSON.stringify(MI.chunkRanges(7, 7, 5000)) === '[[7,7]]');
  ok('正好 5000 块给一片', MI.chunkRanges(1, 5000, 5000).length === 1);
  ok('5001 块给两片（差一块就是整轮报错和整轮成功的区别）',
    MI.chunkRanges(1, 5001, 5000).length === 2);
  ok('to < from 给空数组（没有新块时不发请求）', MI.chunkRanges(10, 9, 5000).length === 0);
  ok('非法入参不崩', MI.chunkRanges(NaN, 10, 5000).length === 0);
}

/* ============================================================ [T9] 落盘与续扫 */
console.log('\n[T9] 落盘节流 + 启动读盘续扫');
{
  const I = MI._internals;
  const s = fresh();
  MI.applyLogs(s, [
    listedLog(1000, 77, ALICE, UNIVERSE, 12, '4242'),
    transferLog(1000, UNIVERSE, ZERO, ALICE, 12)
  ], CFG);
  s.lastScanned = 1000;
  I.setState(s);

  I.runtime.dirty = true; I.runtime.lastFlushAt = 0;
  ok('force 落盘写得出文件', I.flush(true) === true && fs.existsSync(I.INDEX_FILE));

  I.runtime.dirty = true;
  ok('**节流**：刚写完 10 秒内不再写', I.flush(false) === false);
  I.runtime.lastFlushAt = Date.now() - CFG.flushMs - 1;
  ok('过了节流窗口才又写一次', I.flush(false) === true);

  /* 第二档节流：只有 lastScanned 往前挪的那种轮次走 60 秒档。
     一百万挂单时，每 10 秒把整张表重写一遍只为了记住「又扫了 5 个块」，
     那是几百 MB 的写换几十个块的重扫 —— 换反了。 */
  I.runtime.dirty = false; I.runtime.tipDirty = true;
  I.runtime.lastFlushAt = Date.now() - CFG.flushMs - 1;
  ok('只有 lastScanned 前进时，10 秒档不写盘', I.flush(false) === false);
  I.runtime.lastFlushAt = Date.now() - CFG.flushTipMs - 1;
  ok('只有 lastScanned 前进时，满 60 秒才写', I.flush(false) === true);
  ok('写完两个脏标志都清了', I.runtime.dirty === false && I.runtime.tipDirty === false);
  ok('都不脏时不写盘', I.flush(false) === false);

  const onDisk = JSON.parse(fs.readFileSync(I.INDEX_FILE, 'utf8'));
  ok('落盘的就是规格里那四个字段',
    JSON.stringify(Object.keys(onDisk).sort()) === '["lastScanned","listings","owners","sales"]',
    Object.keys(onDisk).join(','));

  I.setState(MI.emptyState());
  I.loadState();
  const back = I.getState();
  ok('读盘续扫：lastScanned 回来了', back.lastScanned === 1000, back.lastScanned + '');
  ok('读盘续扫：挂单回来了', !!back.listings['77'] && back.listings['77'].price === '4242');
  ok('读盘续扫：反查表重建了', back.byOwner.get(ALICE) && back.byOwner.get(ALICE).size === 1);
  ok('读盘续扫：activeSet 也重建了（翻页全靠它）',
    back.activeSet.size === 1 && back.activeSet.has('77'));

  // 文件坏了：当没有，从头扫，绝不因此拒绝启动（索引是可再生的）
  fs.writeFileSync(I.INDEX_FILE, '{"lastScanned": 10, "listi');
  let threw = false;
  try { I.loadState(); } catch (e) { threw = true; }
  ok('索引文件坏了不抛，退成空索引重扫', !threw && I.getState().lastScanned === 0);
  I.setState(MI.emptyState());
  try { fs.unlinkSync(I.INDEX_FILE); } catch (e) { /* 已经没了 */ }
}

/* ============================================================ [T14] 造物 Card.burned：8 槽 / 7 槽 / 事件两种长度 */
console.log('\n[T14] 造物 cardOf 8 槽解析、7 槽兼容、Crafted 事件两种长度');
{
  const oh = '11'.repeat(32), ops = '22'.repeat(32), ch = '33'.repeat(32);
  const seven = '0x' + oh + ops + ch + w(9) + w(0) + w(42) + w(1000);
  const eight = seven + w(200);
  let threw = false;
  let p8, p7, p0;
  try {
    p8 = MI.parseCraftedCard(eight);
    p7 = MI.parseCraftedCard(seven);
    p0 = MI.parseCraftedCard('0x');
  } catch (e) { threw = true; }
  ok('8 槽解析不抛', !threw && p8);
  ok('8 槽 burned 取槽 7', p8 && p8.burned === '200' && p8.paid === '1000'
    && p8.cardHash === '0x' + ch && p8.outcome === 9 && p8.originBlock === 42,
    p8 && JSON.stringify({ burned: p8.burned, paid: p8.paid, outcome: p8.outcome }));
  ok('7 槽兼容：burned=null、paid 仍在、不报错',
    !threw && p7 && p7.burned === null && p7.paid === '1000' && p7.cardHash === '0x' + ch,
    p7 && JSON.stringify({ burned: p7.burned, paid: p7.paid }));
  ok('空数据 burned=null 不抛', !threw && p0 && p0.burned === null);

  const ev3 = '0x' + ops + w(1) + w(5000);
  const ev4 = ev3 + w(1000);
  let eThrew = false;
  let n4, n3;
  try {
    n4 = MI.parseCraftedEvent(ev4);
    n3 = MI.parseCraftedEvent(ev3);
  } catch (e) { eThrew = true; }
  ok('新 Crafted 事件 4 槽 burned 取末槽', !eThrew && n4 && n4.burned === '1000' && n4.cost === '5000' && n4.rarity === 1);
  ok('旧 Crafted 事件 3 槽 burned=null 不报错', !eThrew && n3 && n3.burned === null && n3.cost === '5000');

  const craftedLog = (topic, dataHex, logIndex) => ({
    address: CRAFTED,
    topics: [topic, tNum(7), '0x' + oh, '0x' + ch],
    data: dataHex,
    blockNumber: tNum(9000),
    logIndex: tNum(logIndex == null ? 0 : logIndex)
  });
  const dNew = MI.decodeLog(craftedLog(MI.TOPICS.Crafted, ev4), CFG);
  const dOld = MI.decodeLog(craftedLog(MI.TOPICS.CraftedOld, ev3, 1), CFG);
  ok('decodeLog 认新 Crafted topic，burned 有值',
    dNew && dNew.kind === 'Crafted' && dNew.burned === '1000' && dNew.tokenId === '7');
  ok('decodeLog 认旧 Crafted topic，burned=null',
    dOld && dOld.kind === 'Crafted' && dOld.burned === null && dOld.cost === '5000');

  const s = fresh();
  const r = MI.applyLogs(s, [
    craftedLog(MI.TOPICS.Crafted, ev4, 0),
    craftedLog(MI.TOPICS.CraftedOld, ev3, 1)
  ], CFG);
  ok('Crafted 事件进解码但不改挂单/持仓（扫描仍靠 Transfer）',
    r.decoded === 2 && r.changed === 0
    && Object.keys(s.listings).length === 0 && Object.keys(s.owners).length === 0,
    'decoded=' + r.decoded + ' changed=' + r.changed);
}

/* ============================================================ [T10] 查询 API */
console.log('\n[T10] listings / owned 的筛选、排序、分页');
(async () => {
  const I = MI._internals;
  const s = fresh();
  const logs = [];
  /* 30 张单：偶数 id 是原生、奇数是造物；价格递增；一半 BANG 计价。
     第 30 张是 ERC-1155（市场页不认，必须被筛掉）。 */
  for (let i = 0; i < 30; i++) {
    logs.push(listedLog(2000 + i, i, ALICE, i % 2 === 0 ? UNIVERSE : CRAFTED, 100 + i,
      String((i + 1) * 1000), { inBang: i % 2 === 1, logIndex: 0 }));
  }
  logs.push(listedLog(2100, 30, ALICE, UNIVERSE, 999, '1', { is1155: true, amount: 5, logIndex: 0 }));
  logs.push(cancelledLog(2200, 3, ALICE, 0));               // 3 号撤了
  logs.push(soldLog(2201, 4, BOB, ALICE, '5000', { logIndex: 1 }));   // 4 号卖了
  MI.applyLogs(s, logs, CFG);
  s.lastScanned = 2300;
  I.setState(s);

  /* 元数据缓存直接喂满：这一节测的是筛选/排序/分页的逻辑，
     不是元数据怎么读回来的（那要打链，属于真链实测那一步）。 */
  const m = Object.create(null);
  for (let i = 0; i < 30; i++) {
    const token = i % 2 === 0 ? UNIVERSE : CRAFTED;
    m[MI.tokenKey(token, 100 + i)] = {
      cardHash: '0x' + String(i).padStart(64, '0'),
      rarity: i % 5, outcome: i % 12,
      name: i % 3 === 0 ? ('Name' + i) : null,
      burned: '0', perm: token === CRAFTED, at: Date.now()
    };
  }
  I.setMeta(m);
  I.runtime.lastOkAt = Date.now();
  I.runtime.latest = 2315;

  ok('index 不 stale（刚扫过、只落后确认深度）', I.isStale() === false,
    'behind=' + (I.runtime.latest - I.getState().lastScanned));

  let r = await MI.listingsPage({});
  ok('默认一页 24 条', r.size === 24 && r.items.length === 24, r.items.length + '');
  ok('撤单与成交不在列表里（30 张挂上，撤 1 卖 1，1155 那张不算）', r.total === 28, 'total=' + r.total);
  ok('默认按 new 排序：块高最大的在前', r.items[0].listingId === '29', r.items[0].listingId);
  ok('元数据补进条目', r.items[0].rarity != null && r.items[0].cardHash != null);
  ok('每条都带 series', r.items.every((x) => x.series === 'native' || x.series === 'crafted'));
  ok('索引条目都带 burned 字段（null 表示未知）',
    r.items.every((x) => Object.prototype.hasOwnProperty.call(x, 'burned')),
    r.items[0] && ('burned' in r.items[0] ? 'burned=' + r.items[0].burned : '缺键'));
  ok('ERC-1155 那张被筛掉', !r.items.some((x) => x.listingId === '30')
    && (await MI.listingsPage({ page: 1 })).items.every((x) => x.listingId !== '30'));

  const p1 = await MI.listingsPage({ page: 1 });
  ok('第二页接着上一页，不重不漏', p1.items.length === 4 && p1.items[0].listingId === '5', p1.items[0].listingId);

  r = await MI.listingsPage({ series: 'native' });
  ok('series=native 只出原生', r.items.every((x) => x.series === 'native') && r.total === 14, 'total=' + r.total);
  r = await MI.listingsPage({ series: 'crafted' });
  ok('series=crafted 只出造物', r.items.every((x) => x.series === 'crafted') && r.total === 14, 'total=' + r.total);

  r = await MI.listingsPage({ cur: 'bang' });
  ok('cur=bang 只出 BANG 计价', r.items.every((x) => x.inBang === true) && r.total === 14, 'total=' + r.total);
  r = await MI.listingsPage({ cur: 'bnb' });
  ok('cur=bnb 只出 BNB 计价', r.items.every((x) => x.inBang === false) && r.total === 14, 'total=' + r.total);

  r = await MI.listingsPage({ sort: 'price_asc', cur: 'bnb' });
  const asc = r.items.map((x) => BigInt(x.price));
  ok('price_asc 真的升序', asc.every((v, i) => i === 0 || asc[i - 1] <= v), asc.slice(0, 3).join(','));
  r = await MI.listingsPage({ sort: 'price_desc', cur: 'bnb' });
  const desc = r.items.map((x) => BigInt(x.price));
  ok('price_desc 真的降序', desc.every((v, i) => i === 0 || desc[i - 1] >= v), desc.slice(0, 3).join(','));
  r = await MI.listingsPage({ sort: 'id' });
  ok('sort=id 按 listingId 升序', r.items[0].listingId === '0' && r.items[1].listingId === '1');

  /* 价格是 wei，早就越过 2^53：用 Number 比会乱序。这一条专门盯它。 */
  {
    const s2 = fresh();
    MI.applyLogs(s2, [
      listedLog(3000, 900, ALICE, UNIVERSE, 1, '10000000000000000000000001', { logIndex: 0 }),
      listedLog(3000, 901, ALICE, UNIVERSE, 2, '10000000000000000000000002', { logIndex: 1 })
    ], CFG);
    const keep = I.getState();
    I.setState(s2);
    const rr = await MI.listingsPage({ sort: 'price_asc' });
    ok('高位 wei 只差 1 也排得对（BigInt 比，不是 Number）',
      rr.items[0].listingId === '900' && rr.items[1].listingId === '901',
      rr.items.map((x) => x.listingId).join(','));
    I.setState(keep);
  }

  r = await MI.listingsPage({ rarity: '0' });
  ok('rarity 筛选（走元数据缓存）', r.items.every((x) => x.rarity === 0) && r.items.length > 0,
    'total=' + r.total);
  r = await MI.listingsPage({ rarity: '0,1' });
  ok('rarity 支持逗号分隔', r.items.every((x) => x.rarity === 0 || x.rarity === 1));
  r = await MI.listingsPage({ outcome: '3' });
  ok('outcome 筛选', r.items.every((x) => x.outcome === 3));
  r = await MI.listingsPage({ named: '1' });
  ok('named=1 只出命名过的', r.items.length > 0 && r.items.every((x) => !!x.name), 'total=' + r.total);
  r = await MI.listingsPage({ named: '0' });
  ok('named=0 只出没命名的', r.items.every((x) => x.name === undefined), 'total=' + r.total);
  r = await MI.listingsPage({ rarity: '9,abc' });
  ok('越界/垃圾筛选值当没筛，不报错', r.total === 28, 'total=' + r.total);

  ok('size 上限 100', (await MI.listingsPage({ size: 5000 })).size === 100);
  ok('size 下限 1', (await MI.listingsPage({ size: 0 })).size === 24);
  ok('page 负数当 0', (await MI.listingsPage({ page: -5 })).page === 0);
  ok('翻过头给空数组而不是报错', (await MI.listingsPage({ page: 999 })).items.length === 0);
  ok('未知 sort 退回默认', (await MI.listingsPage({ sort: 'drop table' })).sort === 'new');

  /* 空索引不报错（规格第四节第 3 条） */
  {
    const keep = I.getState();
    I.setState(MI.emptyState());
    const empty = await MI.listingsPage({});
    ok('空索引：total 0、items 空数组、不抛错',
      empty.total === 0 && Array.isArray(empty.items) && empty.items.length === 0 && !empty.error);
    const own = await MI.ownedOf(ALICE);
    ok('空索引查持仓：三个空数组，不抛错',
      own.native.length === 0 && own.crafted.length === 0 && own.other.length === 0);
    I.setState(keep);
  }

  /* ---- owned ---- */
  {
    const s3 = fresh();
    MI.applyLogs(s3, [
      transferLog(4000, UNIVERSE, ZERO, ALICE, 1),
      transferLog(4001, CRAFTED, ZERO, ALICE, 1),
      transferLog(4002, UNIVERSE, ZERO, BOB, 2)
    ], CFG);
    I.setState(s3);
    I.setMeta(Object.create(null));    // 空缓存：ensureMeta 会想去打链，但 RPC 是坏的
    const own = await MI.ownedOf(ALICE);
    ok('owned 分成原生与造物两列', own.native.length === 1 && own.crafted.length === 1,
      JSON.stringify({ n: own.native.length, c: own.crafted.length }));
    ok('owned 给的是链上真持仓（#1 原生 + #1 造物）',
      own.native[0].tokenId === '1' && own.native[0].token === UNIVERSE
      && own.crafted[0].tokenId === '1' && own.crafted[0].token === CRAFTED);
    ok('**元数据读不回来（RPC 全挂）也照样返回持仓**，只是少几个字段',
      own.total === 2 && own.native[0].rarity === undefined);
    ok('没元数据时 burned 为 null（未知），字段仍在',
      own.native[0].burned === null && own.crafted[0].burned === null);
    ok('不持有任何 token 的地址：空三列不报错', (await MI.ownedOf(BOB)).crafted.length === 0);
    ok('地址格式不对报错但不抛', (await MI.ownedOf('xyz')).error === '地址格式不对');
    ok('大小写地址一样查得到', (await MI.ownedOf(ALICE.toUpperCase())).total === 2);
    I.setState(s);
    I.setMeta(m);
  }

  /* ---- 最近成交 ---- */
  {
    ok('recentSales 倒序给最近的', MI.recentSales(10)[0].listingId === '4');
    const s4 = fresh();
    const many = [];
    for (let i = 0; i < CFG.maxSales + 20; i++) many.push(soldLog(5000 + i, 10000 + i, BOB, ALICE, String(i)));
    MI.applyLogs(s4, many, CFG);
    ok('sales 只留最近 500 笔', s4.sales.length === CFG.maxSales, s4.sales.length + '');
    ok('留下的是最近的那 500 笔', s4.sales[s4.sales.length - 1].listingId === String(10000 + CFG.maxSales + 19));
  }

  /* ============================================================ [T11] RPC 全挂 */
  console.log('\n[T11] RPC 全挂 —— 保持上次索引 + 报 stale，绝不清表、绝不抛');
  {
    I.setState(s);
    const before = JSON.stringify(I.getState().listings);
    const beforeScanned = I.getState().lastScanned;
    const r2 = await MI.scanOnce();          // RPC 配的是 127.0.0.1:1，必然连不上
    ok('scanOnce 返回失败而不是抛异常', r2.ok === false && !!r2.error, r2.error);
    ok('索引一条都没丢', JSON.stringify(I.getState().listings) === before);
    ok('lastScanned 没被推进也没被清零', I.getState().lastScanned === beforeScanned);
    ok('失败原因记在 status 里', /打不通|ECONNREFUSED|fetch/i.test(MI.statusOf().lastError || ''),
      MI.statusOf().lastError);

    I.runtime.lastOkAt = Date.now() - CFG.staleAfterMs - 1000;
    ok('**超过 90 秒没有成功的一轮 → stale: true**', MI.statusOf().stale === true);
    ok('stale 时 listings 照常返回数据（不是空）',
      (await MI.listingsPage({})).items.length > 0 && (await MI.listingsPage({})).stale === true);
    ok('stale 时 owned 也照常返回', (await MI.ownedOf(ALICE)).stale === true);

    I.runtime.lastOkAt = Date.now();
    I.runtime.latest = I.getState().lastScanned + CFG.confirmations + 500;
    ok('落后链头太多也算 stale（比如刚重启还在回补）', MI.statusOf().stale === true,
      'behind=' + MI.statusOf().behind);
    I.runtime.latest = I.getState().lastScanned + CFG.confirmations;
    ok('追上了就不 stale 了', MI.statusOf().stale === false);

    const stt = MI.statusOf();
    ok('status 带齐 lastScanned/latest/behind/stale/counts',
      typeof stt.lastScanned === 'number' && typeof stt.latest === 'number'
      && typeof stt.behind === 'number' && typeof stt.stale === 'boolean'
      && stt.counts && typeof stt.counts.listings === 'number'
      && typeof stt.counts.owners === 'number',
      JSON.stringify(stt.counts));
  }

  /* ============================================================ [T12] 元数据缓存 */
  console.log('\n[T12] 元数据惰性缓存：造物的 Card 永久，可变的缓 60 秒');
  {
    const now = Date.now();
    ok('造物 + 没配 BangNames2 → 永久有效',
      MI.metaFresh({ perm: true, at: now - 86400000 }) === true);
    ok('原生的 60 秒内有效', MI.metaFresh({ perm: false, at: now - 30000 }) === true);
    ok('原生的过了 60 秒失效（干预会改写 cardOf/outcome）',
      MI.metaFresh({ perm: false, at: now - 61000 }) === false);
    ok('没有缓存就是没有', MI.metaFresh(null) === false);
    CFG.names2 = '0x2222222222222222222222222222222222222222';
    ok('配了 BangNames2 之后造物也要过 60 秒（名字可改）',
      MI.metaFresh({ perm: true, at: now - 61000 }) === false);
    CFG.names2 = '';
  }

  console.log('\n[T13] 合约 string 返回值的解码（名字会被原样送进市场页）');
  {
    const enc = (s) => {
      const hex = Buffer.from(s, 'utf8').toString('hex');
      return '0x' + w(32) + w(Buffer.byteLength(s)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
    };
    ok('正常名字解得出来', MI.decString(enc('Andromeda-7')) === 'Andromeda-7');
    ok('空返回 → null', MI.decString('0x') === null);
    ok('截断的返回 → null 而不是抛', MI.decString('0x' + w(32)) === null);
    ok('非 ASCII 一律当没有名字（绝不清洗后照印）', MI.decString(enc('宇宙')) === null);
    ok('超长（>32）当没有名字', MI.decString(enc('x'.repeat(40))) === null);
    ok('带空格的当没有名字', MI.decString(enc('a b')) === null);
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 临时目录 */ }
  console.log('\n通过 ' + pass + ' 条，失败 ' + fail + ' 条\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('\n测试自身崩了：', e);
  process.exitCode = 1;
});
