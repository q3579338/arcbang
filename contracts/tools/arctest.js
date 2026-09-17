/*
 * ArcUniverse（ARCBANG）单测：只卖 NFT、没有代币的那条路。
 *
 * 守的是四条不变量：
 *   1. 免费期只付 gas、每地址上限，用完自动转付费；
 *   2. 付费期收的是 native（Arc 上就是 USDC），一分不差；
 *   3. 干预付的钱**全额进销毁地址**，burnedOn/totalBurned 与那个地址的余额对得上；
 *   4. owner 的调参能力被上下限夹死，且免费额度只能收紧。
 *
 * 跑法：node tools/compile.js src/ArcUniverse.sol && node tools/arctest.js
 */
const path = require('path');
const { Wallet, keccak256, getBytes, AbiCoder } = require(path.join(__dirname, '../../server/node_modules/ethers'));
const {
  Harness, sel, word, addrWord, bytes32Word, asBig, asBool, decodeRevert, ok, eq, summary, B
} = require(path.join(__dirname, 'evmlib.js'));

const coder = AbiCoder.defaultAbiCoder();
const wallet = new Wallet('0x' + '11'.repeat(32));          // 服务端签名钥匙
const OWNER = '0x' + 'a0'.repeat(20);
const USER = '0x' + 'b0'.repeat(20);
const USER2 = '0x' + 'c0'.repeat(20);
const SINK = '0x000000000000000000000000000000000000dead';
const DL = 9999999999n;
const ONE = 10n ** 18n;
const big = (h) => BigInt(h === '0x' ? 0 : h);

/* 结局与稀有度的记号，和引擎顺序一致 */
const OBS = 9;          // OBSERVERS_POSSIBLE
const DEAD_OUTCOME = 5; // NO_ATOMS
const R = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function signMint(uni, bh, bn, outcome, rarity, ch, dl, minter) {
  return wallet.signMessageSync(getBytes(keccak256(coder.encode(
    ['uint256', 'address', 'bytes32', 'uint64', 'uint8', 'uint8', 'bytes32', 'uint64', 'address'],
    [1n, uni, bh, bn, outcome, rarity, ch, dl, minter]))));
}

/** bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes) —— 没有 payWithBang 了 */
function mintData(bh, bn, outcome, rarity, ch, dl, sig) {
  return sel('bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes)')
    + bytes32Word(bh) + word(BigInt(bn)) + word(BigInt(outcome)) + word(BigInt(rarity))
    + bytes32Word(ch) + word(BigInt(dl))
    + word(224n)                                   // bytes 偏移 = 7 个字
    + word(65n) + sig.replace(/^0x/, '').padEnd(128, '0');
}

function signIntervene(uni, id, oldCard, newCard, outcome, rarity, cost, dl, ops, sender) {
  return wallet.signMessageSync(getBytes(keccak256(coder.encode(
    ['uint256', 'address', 'uint256', 'bytes32', 'bytes32', 'uint8', 'uint8', 'uint256', 'uint64', 'bytes32', 'address'],
    [1n, uni, id, oldCard, newCard, outcome, rarity, cost, dl, keccak256(ops), sender]))));
}

/** intervene(uint256,bytes32,uint8,uint8,uint256,uint64,bytes,bytes) */
function interveneData(id, newCard, outcome, rarity, cost, dl, ops, sig) {
  const opsHex = ops.replace(/^0x/, '');
  const opsLen = opsHex.length / 2;
  return sel('intervene(uint256,bytes32,uint8,uint8,uint256,uint64,bytes,bytes)')
    + word(id) + bytes32Word(newCard) + word(BigInt(outcome)) + word(BigInt(rarity))
    + word(cost) + word(dl)
    + word(256n)                                   // ops 偏移
    + word(320n)                                   // sig 偏移（ops 占 2 个字）
    + word(BigInt(opsLen)) + opsHex.padEnd(64, '0')
    + word(65n) + sig.replace(/^0x/, '').padEnd(128, '0');
}

async function fresh() {
  const h = await Harness.create();
  for (const a of [OWNER, USER, USER2]) await h.fund(a, 10n ** 21n);
  const uni = await h.deploy('ArcUniverse', [], OWNER);
  await h.call(uni, OWNER, sel('setSigner(address)') + addrWord(wallet.address), 0);

  const ctx = { h, uni };
  ctx.mint = async (tag, from, outcome, rarity, value) => {
    const bh = B.keccak256(tag), ch = B.keccak256('card-' + tag);
    await h.call(uni, from, mintData(bh, 0, outcome, rarity, ch, DL, signMint(uni, bh, 0, outcome, rarity, ch, DL, from)), value);
    return { id: big(await h.view(uni, sel('tokenOfHash(bytes32)') + bytes32Word(bh))), card: ch };
  };
  ctx.view = (sig, arg) => h.view(uni, sel(sig) + (arg || ''));
  return ctx;
}

async function expectRevert(fn, want, msg) {
  try {
    await fn();
    ok(false, msg + '（居然没 revert）');
  } catch (e) {
    if (!e.reverted) throw e;
    ok(true, msg);
  }
}

async function main() {
  console.log('\n— 常量：总量与价格区间 —');
  {
    const c = await fresh();
    eq(big(await c.view('MINT_CAP()')), 1387n, 'MINT_CAP = 1,387（宇宙年龄 137.87 亿年）');
    eq(big(await c.view('price()')), ONE, '默认价 1 USDC');
    eq(big(await c.view('MIN_PRICE()')), ONE / 10n, '价格下限 0.1 USDC');
    eq(big(await c.view('MAX_PRICE()')), 20n * ONE, '价格上限 20 USDC');
    eq(big(await c.view('freeCap()')), 387n, '免费额度 387 枚（其后 1,000 枚付费）');
    eq(big(await c.view('freePerAddr()')), 1n, '每地址免费 1 次');
    eq(big(await c.view('paidPerAddr()')), 3n, '每地址付费最多 3 枚');
  }

  console.log('\n— 免费期：每地址一次，之后自动转付费 —');
  {
    const c = await fresh();
    await c.mint('free-1', USER, OBS, R.B, 0);
    eq(big(await c.view('totalSupply()')), 1n, '第一枚免费铸造成功');
    eq(big(await c.view('freeMintCount(address)', addrWord(USER))), 1n, '免费次数记到 1');
    await expectRevert(() => c.mint('free-2', USER, OBS, R.B, 0), null, '第 2 次再想白嫖：revert');
    await c.mint('paid-2', USER, OBS, R.B, ONE);
    eq(big(await c.view('totalSupply()')), 2n, '同一地址付 1 USDC 就能继续铸');
    // 另一个地址的免费额度是独立的
    await c.mint('free-other', USER2, OBS, R.B, 0);
    eq(big(await c.view('freeMintCount(address)', addrWord(USER2))), 1n, '免费次数按地址各记各的');
  }

  console.log('\n— 付费期：金额必须一分不差 —');
  {
    const c = await fresh();
    await c.h.call(c.uni, OWNER, sel('setFreeCap(uint256)') + word(0n), 0);   // 关掉免费期
    await expectRevert(() => c.mint('under', USER, OBS, R.S, ONE / 2n), null, '少付 0.5 USDC：revert');
    await expectRevert(() => c.mint('over', USER, OBS, R.S, 2n * ONE), null, '多付 1 USDC：revert');
    await c.mint('exact', USER, OBS, R.S, ONE);
    eq(await c.h.balance(c.uni), ONE, '铸造款留在合约里（等 owner 提走）');
    await c.mint('paid-2', USER, OBS, R.S, ONE);
    await c.mint('paid-3', USER, OBS, R.S, ONE);
    eq(big(await c.view('paidMintCount(address)', addrWord(USER))), 3n, '付费次数记到 3');
    await expectRevert(() => c.mint('paid-4', USER, OBS, R.S, ONE), null, '同一地址第 4 枚付费：revert（每地址 3 枚）');
    await c.mint('paid-other', USER2, OBS, R.S, ONE);
    eq(big(await c.view('totalSupply()')), 4n, '换个地址照常能铸');
  }

  console.log('\n— 拯救系统已删除：合约里没有 intervene —');
  {
    const c = await fresh();
    const m = await c.mint('no-rescue', USER, DEAD_OUTCOME, R.D, 0);
    const sig = signIntervene(c.uni, m.id, m.card, B.keccak256('card-x'), OBS, R.S, 3n * ONE, DL, '0x0100000001', USER);
    await expectRevert(() => c.h.call(c.uni, USER, interveneData(m.id, B.keccak256('card-x'), OBS, R.S, 3n * ONE, DL, '0x0100000001', sig), 3n * ONE),
      null, '调 intervene 选择器：revert（函数不存在）');
    const u = (await c.view('universeOf(uint256)', word(m.id))).replace(/^0x/, '').match(/.{64}/g);
    eq(BigInt('0x' + u[4]), BigInt(DEAD_OUTCOME), '结局没有被改写');
  }

  console.log('\n— 签名：没有服务端的章就铸不了 —');
  {
    const c = await fresh();
    const bh = B.keccak256('forged'), ch = B.keccak256('card-forged');
    const bad = new Wallet('0x' + '22'.repeat(32));
    const sig = bad.signMessageSync(getBytes(keccak256(coder.encode(
      ['uint256', 'address', 'bytes32', 'uint64', 'uint8', 'uint8', 'bytes32', 'uint64', 'address'],
      [1n, c.uni, bh, 0, OBS, R.S, ch, DL, USER]))));
    await expectRevert(
      () => c.h.call(c.uni, USER, mintData(bh, 0, OBS, R.S, ch, DL, sig), 0),
      null, '别人的私钥签的名：revert');
    // 同一张签名换个人来用也不行（msg.sender 签在摘要里）
    const good = signMint(c.uni, bh, 0, OBS, R.S, ch, DL, USER);
    await expectRevert(
      () => c.h.call(c.uni, USER2, mintData(bh, 0, OBS, R.S, ch, DL, good), 0),
      null, '抢别人的签名来铸：revert');
  }

  console.log('\n— owner 的手被夹死 —');
  {
    const c = await fresh();
    await expectRevert(() => c.h.call(c.uni, OWNER, sel('setPrice(uint256)') + word(ONE / 100n), 0), null, '调到 0.01 USDC（低于下限）：revert');
    await expectRevert(() => c.h.call(c.uni, OWNER, sel('setPrice(uint256)') + word(50n * ONE), 0), null, '调到 50 USDC（高于上限）：revert');
    await c.h.call(c.uni, OWNER, sel('setPrice(uint256)') + word(5n * ONE), 0);
    eq(big(await c.view('price()')), 5n * ONE, '区间内调价放行');

    await expectRevert(() => c.h.call(c.uni, OWNER, sel('setFreeCap(uint256)') + word(9999n), 0), null, '免费额度想调大：revert');
    await c.h.call(c.uni, OWNER, sel('setFreeCap(uint256)') + word(100n), 0);
    eq(big(await c.view('freeCap()')), 100n, '免费额度只能往下调');
    await expectRevert(() => c.h.call(c.uni, OWNER, sel('setFreePerAddr(uint16)') + word(10n), 0), null, '每地址次数想调大：revert');
    await expectRevert(() => c.h.call(c.uni, OWNER, sel('setPaidPerAddr(uint16)') + word(10n), 0), null, '付费每地址上限想调大：revert');
    await c.h.call(c.uni, OWNER, sel('setPaidPerAddr(uint16)') + word(2n), 0);
    eq(big(await c.view('paidPerAddr()')), 2n, '付费每地址上限只能往下调');

    await expectRevert(() => c.h.call(c.uni, USER, sel('setPrice(uint256)') + word(3n * ONE), 0), null, '不是 owner 就别想调价');
  }

  console.log('\n— 一个区块只能被引爆一次 —');
  {
    const c = await fresh();
    const bh = B.keccak256('same-block'), ch = B.keccak256('card-same');
    await c.h.call(c.uni, USER, mintData(bh, 0, OBS, R.S, ch, DL, signMint(c.uni, bh, 0, OBS, R.S, ch, DL, USER)), 0);
    await expectRevert(
      () => c.h.call(c.uni, USER2, mintData(bh, 0, OBS, R.S, ch, DL, signMint(c.uni, bh, 0, OBS, R.S, ch, DL, USER2)), 0),
      null, '同一个区块哈希再铸一次：revert');
  }

  console.log('\n— 提款：只能提铸造款 —');
  {
    const c = await fresh();
    await c.h.call(c.uni, OWNER, sel('setFreeCap(uint256)') + word(0n), 0);
    await c.mint('w1', USER, OBS, R.B, ONE);
    await c.mint('w2', USER2, OBS, R.B, ONE);
    const to = '0x' + 'ee'.repeat(20);
    await c.h.call(c.uni, OWNER, sel('withdraw(address)') + addrWord(to), 0);
    eq(await c.h.balance(to), 2n * ONE, 'owner 提走了 2 USDC');
    eq(await c.h.balance(c.uni), 0n, '合约清空');
  }

  console.log('\n— tokenURI：没设 baseURI 时退回链上 SVG —');
  {
    const c = await fresh();
    const m = await c.mint('art', USER, OBS, R.S, 0);
    const uri = await c.view('tokenURI(uint256)', word(m.id));
    const s = Buffer.from(uri.replace(/^0x/, ''), 'hex').toString('utf8');
    ok(s.includes('data:application/json;base64,'), '返回的是链上 base64 metadata');
    const b64 = s.slice(s.indexOf('base64,') + 7).replace(/\0+$/, '').trim();
    const meta = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    ok(String(meta.description).includes('Arc block'), '描述里写的是 Arc block，不是 BNB block');
    ok(String(meta.image).startsWith('data:image/svg+xml;base64,'), '图是链上 SVG');
    const svg = Buffer.from(meta.image.split('base64,')[1], 'base64').toString('utf8');
    ok(svg.includes('ARCBANG'), 'SVG 水印是 ARCBANG');
  }

  console.log('\n— ERC-2981 版税：OpenSea 二级要读的 —');
  {
    const c = await fresh();
    ok(asBool((await c.view('supportsInterface(bytes4)', '2a55205a'.padEnd(64, '0'))).replace(/^0x/, '')), '声明支持 ERC-2981');
    const r = (await c.view('royaltyInfo(uint256,uint256)', word(1n) + word(100n * ONE))).replace(/^0x/, '').match(/.{64}/g);
    eq('0x' + r[0].slice(24), OWNER, '收款地址没设时退回 owner');
    eq(BigInt('0x' + r[1]), 5n * ONE, '100 USDC 成交 → 5 USDC 版税（默认 5%）');
    await expectRevert(() => c.h.call(c.uni, OWNER, sel('setRoyalty(address,uint16)') + addrWord(USER2) + word(1500n), 0), null, '版税想调到 15%：revert');
    await c.h.call(c.uni, OWNER, sel('setRoyalty(address,uint16)') + addrWord(USER2) + word(1000n), 0);
    const r2 = (await c.view('royaltyInfo(uint256,uint256)', word(1n) + word(100n * ONE))).replace(/^0x/, '').match(/.{64}/g);
    eq('0x' + r2[0].slice(24), USER2, '收款地址改到指定地址');
    eq(BigInt('0x' + r2[1]), 10n * ONE, '顶格 10%');
    await expectRevert(() => c.h.call(c.uni, USER, sel('setRoyalty(address,uint16)') + addrWord(USER) + word(100n), 0), null, '不是 owner 不能改版税');
  }

  console.log('\n— 链上自证：blockhash 窗内盖章，窗外不炸 —');
  {
    const c = await fresh();
    const cur = Number(c.h.number);
    const bh1 = c.h.blockHashOf ? c.h.blockHashOf(cur - 10) : require(path.join(__dirname, 'evmlib.js')).blockHashOf(cur - 10);
    const ch1 = B.keccak256('card-recent');
    await c.h.call(c.uni, USER, mintData(bh1, cur - 10, OBS, R.S, ch1, DL, signMint(c.uni, bh1, cur - 10, OBS, R.S, ch1, DL, USER)), 0);
    const id1 = big(await c.view('tokenOfHash(bytes32)', bytes32Word(bh1)));
    const u1 = (await c.view('universeOf(uint256)', word(id1))).replace(/^0x/, '').match(/.{64}/g);
    ok(BigInt('0x' + u1[5]) === 1n, '10 块前的真哈希：verified = true');
    const bh2 = require(path.join(__dirname, 'evmlib.js')).blockHashOf(cur - 600);
    const ch2 = B.keccak256('card-old');
    await c.h.call(c.uni, USER2, mintData(bh2, cur - 600, OBS, R.S, ch2, DL, signMint(c.uni, bh2, cur - 600, OBS, R.S, ch2, DL, USER2)), 0);   // 免费期每地址 1 次，换个地址
    const id2 = big(await c.view('tokenOfHash(bytes32)', bytes32Word(bh2)));
    const u2 = (await c.view('universeOf(uint256)', word(id2))).replace(/^0x/, '').match(/.{64}/g);
    ok(BigInt('0x' + u2[5]) === 0n, '600 块前（测试台没有 2935 合约）：verified = false，铸造照常');
  }

  summary('ArcUniverse');
}

main().catch((e) => { console.error(e); process.exit(1); });
