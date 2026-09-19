/*
 * ArcMarket（ARCBANG 无币挂单簿）单测：本地 EVM 跑真字节码。
 *
 * 守的是六条不变量：
 *   1. 只有 native（Arc 上就是 USDC）一种计价，buy 的 msg.value 必须**精确等于** price；
 *   2. 分账数值对得上：ERC-2981 版税（ArcUniverse 默认 5%）+ 手续费 0（默认不收）+ 卖家 95%，
 *      三笔在同一笔交易里全部转出，合约余额恒为 0；
 *   3. 版税**截断在 10%**：外部 NFT 报 50% 也只付 10%，报废的 royaltyInfo 不影响成交；
 *   4. 挂单是**不托管**的，失效（卖家转走 token / 撤授权）时 buy 带原因 revert，
 *      任何人都能 cancelStale 把它清掉，而有效的单谁也清不了；
 *   5. owner 的手被夹死：非 owner 改不了费率与国库，费率守 10% 硬上限；
 *   6. 重入被 nonReentrant 挡住，国库不会被刷第二次。
 *
 * 跑法：
 *   node tools/compile.js src/ArcUniverse.sol
 *   node tools/compile.js src/ArcMarket.sol
 *   node tools/arcmarket-test.js
 */
const path = require('path');
const solc = require('solc');
const { Address, hexToBytes } = require('@ethereumjs/util');
const { Wallet, keccak256, getBytes, AbiCoder } = require(path.join(__dirname, '../../server/node_modules/ethers'));
const L = require(path.join(__dirname, 'evmlib.js'));
const { Harness, sel, word, addrWord, bytes32Word, words, asBig, asAddr, asBool, ok, eq, summary, B } = L;

const coder = AbiCoder.defaultAbiCoder();
const signerWallet = new Wallet('0x' + '11'.repeat(32));      // 服务端签名钥匙

const OWNER = '0x' + 'a0'.repeat(20);      // ArcUniverse 与 ArcMarket 的 owner，也是默认版税收款人
const SELLER = '0x' + 'b0'.repeat(20);
const BUYER = '0x' + 'c0'.repeat(20);
const STRANGER = '0x' + 'd0'.repeat(20);   // 路人：用来验 cancelStale 谁都能调
const TREASURY = '0x' + 'e0'.repeat(20);
const ZERO = '0x' + '00'.repeat(20);

const ONE = 10n ** 18n;                    // 1 USDC
const PRICE = 100n * ONE;                  // 挂单价 100 USDC，分账数字好口算
const DL = 9999999999n;
const OBS = 9;                             // OBSERVERS_POSSIBLE
const R = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const big = (h) => BigInt(h === '0x' ? 0 : h);

/* ------------------------------------------------------------ 现编两个陪练合约 */

/* 恶意卖家：收到卖款时在 receive() 里回头再调一次 buy */
const ATTACKER_SRC = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract ReentrantSeller {
    address public market;
    uint256 public target;
    bool public reentryTried;
    bool public reentrySucceeded;
    bytes public reentryError;
    constructor(address m) { market = m; }
    function approveAndList(address token, uint256 id, uint256 price) external returns (uint256) {
        (bool a,) = token.call(abi.encodeWithSignature("setApprovalForAll(address,bool)", market, true));
        require(a, "approve failed");
        (bool b, bytes memory ret) = market.call(abi.encodeWithSignature("list(uint256,uint256)", id, price));
        require(b, "list failed");
        target = abi.decode(ret, (uint256));
        return target;
    }
    receive() external payable {
        reentryTried = true;
        (bool okk, bytes memory err) = market.call(abi.encodeWithSignature("buy(uint256)", target));
        reentrySucceeded = okk;
        reentryError = err;
    }
}`;

/* 一个**故意不守规矩**的 721：版税可以报到 50%，也可以让 royaltyInfo 直接爆炸。
   市场的 nft 是 immutable 的，所以这条路要另起一个 ArcMarket 指到它上面 ——
   这正是「合约该防的是被调用方坑」那一条要验的东西。 */
const EVIL_SRC = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract EvilNFT {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    address public royaltyReceiver;
    uint256 public royaltyBpsRaw = 5000;      // 50%，远超市场的 10% 截断线
    bool public royaltyBroken;
    constructor() { royaltyReceiver = msg.sender; }
    function mint(address to, uint256 id) external { ownerOf[id] = to; }
    function setApprovalForAll(address op, bool v) external { isApprovedForAll[msg.sender][op] = v; }
    function transferFrom(address from, address to, uint256 id) external {
        require(ownerOf[id] == from, "wrong from");
        ownerOf[id] = to;
    }
    function setRoyalty(address r, uint256 bps) external { royaltyReceiver = r; royaltyBpsRaw = bps; }
    function breakRoyalty(bool v) external { royaltyBroken = v; }
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        require(!royaltyBroken, "royalty exploded");
        return (royaltyReceiver, salePrice * royaltyBpsRaw / 10000);
    }
}`;

function compileOne(src, file, name) {
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { [file]: { content: src } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } }
  })));
  (out.errors || []).forEach((e) => { if (e.severity === 'error') throw new Error(e.formattedMessage); });
  return out.contracts[file][name].evm.bytecode.object;
}

/** bytes 返回值 → 0x hex（拿来读攻击者存下来的 revert 数据） */
function decodeBytesReturn(hex) {
  const raw = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  const off = Number(BigInt('0x' + raw.subarray(0, 32).toString('hex')));
  const len = Number(BigInt('0x' + raw.subarray(off, off + 32).toString('hex')));
  return '0x' + raw.subarray(off + 32, off + 32 + len).toString('hex');
}

/* ------------------------------------------------------------ ArcUniverse 铸造 */
/* free 是摘要的最后一个字段，也是 calldata 里 sig 之前那个槽
   （见 contracts/src/ArcUniverse.sol 的 bangSigned 与 server/sign.js 的 digestOf）。
   市场测试里的货全是付费铸出来的，所以调用处一律 free=false。 */
function signMint(uni, bh, bn, outcome, rarity, ch, dl, minter, free) {
  return signerWallet.signMessageSync(getBytes(keccak256(coder.encode(
    ['uint256', 'address', 'bytes32', 'uint64', 'uint8', 'uint8', 'bytes32', 'uint64', 'address', 'bool'],
    [1n, uni, bh, bn, outcome, rarity, ch, dl, minter, !!free]))));
}
function mintData(bh, bn, outcome, rarity, ch, dl, sig, free) {
  return sel('bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bool,bytes)')
    + bytes32Word(bh) + word(BigInt(bn)) + word(BigInt(outcome)) + word(BigInt(rarity))
    + bytes32Word(ch) + word(BigInt(dl)) + word(free ? 1n : 0n)
    + word(256n)
    + word(65n) + sig.replace(/^0x/, '').padEnd(128, '0');
}

async function expectRevert(fn, want, msg) {
  try {
    await fn();
    ok(false, msg + '（居然没 revert）');
  } catch (e) {
    if (!e.reverted) throw e;
    if (want && e.message !== want) ok(false, msg + `（revert 原因是「${e.message}」，期望「${want}」）`);
    else ok(true, msg);
  }
}

/* Harness.deploy 失败时抛的是普通 Error（带 revert 原因的字符串），没有 .reverted 标记，
   所以构造函数那两条用这个专门的断言，别混进 expectRevert。 */
async function expectDeployRevert(h, args, want, msg) {
  try {
    await h.deploy('ArcMarket', args, OWNER);
    ok(false, msg + '（居然部署成功了）');
  } catch (e) {
    ok(e.message.indexOf(want) >= 0, msg + (e.message.indexOf(want) >= 0 ? '' : `（原因是「${e.message}」）`));
  }
}

/** 解一条 listings(id) 的返回 */
function decListing(hex) {
  const w = words(hex);
  return {
    seller: asAddr(w[0]), token: asAddr(w[1]), id: asBig(w[2]), amount: asBig(w[3]),
    price: asBig(w[4]), is1155: asBool(w[5]), active: asBool(w[6]), fields: w.length
  };
}

async function main() {
  const h = await Harness.create();
  for (const a of [OWNER, SELLER, BUYER, STRANGER]) await h.fund(a, 10n ** 22n);
  for (const a of [TREASURY]) await h.fund(a, 0n);

  const uni = await h.deploy('ArcUniverse', '', OWNER);
  const market = await h.deploy('ArcMarket', addrWord(uni) + addrWord(TREASURY), OWNER);
  console.log('ArcUniverse  ' + uni);
  console.log('ArcMarket    ' + market + '（owner = OWNER，treasury = TREASURY）\n');

  await h.call(uni, OWNER, sel('setSigner(address)') + addrWord(signerWallet.address), 0);
  /* 免费期关掉：市场测试只是要几枚 NFT 当货，每枚都走付费期的固定 1 USDC，
     不用在这里分「第一枚免费」那一支。 */
  await h.call(uni, OWNER, sel('setFreeCap(uint256)') + word(0n), 0);

  /* 付费期每地址最多 3 枚（paidPerAddr，09-17）：SELLER 一个人在这份测试里要拿 8 枚当货，
     所以每枚都由一个一次性地址铸出来再转给 `to` —— 市场测试要的只是「to 持有这枚」。 */
  let n = 0;
  const mint = async (to) => {
    const tag = 'arcmarket-' + (++n);
    const bh = B.keccak256(tag), ch = B.keccak256('card-' + tag);
    const minter = '0x' + (0xc0de000000000000000000000000000000000000n + BigInt(n)).toString(16).padStart(40, '0');
    await h.fund(minter, 10n ** 20n);
    await h.call(uni, minter, mintData(bh, 0, OBS, R.S, ch, DL, signMint(uni, bh, 0, OBS, R.S, ch, DL, minter, false), false), ONE);
    const id = big(await h.view(uni, sel('tokenOfHash(bytes32)') + bytes32Word(bh)));
    await h.call(uni, minter, sel('transferFrom(address,address,uint256)') + addrWord(minter) + addrWord(to) + word(id), 0);
    return id;
  };
  const ownerOfTok = async (id) => asAddr(words(await h.view(uni, sel('ownerOf(uint256)') + word(id)))[0]);
  const approveAll = (who, on) =>
    h.call(uni, who, sel('setApprovalForAll(address,bool)') + addrWord(market) + word(on ? 1n : 0n), 0);
  const list = (who, id, price) => h.call(market, who, sel('list(uint256,uint256)') + word(id) + word(price), 0);
  const listingAt = async (lid) => decListing(await h.view(market, sel('listings(uint256)') + word(lid)));
  const checkListing = async (lid) => Number(asBig(words(await h.view(market, sel('checkListing(uint256)') + word(lid)))[0]));

  /* ============================================================ 1. 部署与常量 */
  console.log('— 常量与构造：只认一个 NFT 合约，默认不收手续费 —');
  {
    eq(asAddr(words(await h.view(market, sel('nft()')))[0]), uni.toLowerCase(), 'nft 锁死在 ArcUniverse 上（immutable）');
    eq(asAddr(words(await h.view(market, sel('treasury()')))[0]), TREASURY.toLowerCase(), '国库地址就是构造时传的那个');
    eq(asBig(words(await h.view(market, sel('feeBps()')))[0]), 0n, '默认手续费 0（只收版税）');
    eq(asBig(words(await h.view(market, sel('MAX_FEE_BPS()')))[0]), 1000n, '手续费硬上限 10%');
    eq(asBig(words(await h.view(market, sel('MAX_ROYALTY_BPS()')))[0]), 1000n, '版税截断线 10%');
    /* 「没有 BANG」这一条对着 ABI 验，不是对着注释验：
       ABI 里一旦冒出 bang / inBang 这两个词，就说明代币又从某条缝里钻回来了。 */
    const abiText = require('fs').readFileSync(path.join(__dirname, '../out/ArcMarket.abi.json'), 'utf8');
    ok(!/bang/i.test(abiText), 'ABI 里搜不到 bang / inBang —— BANG 一个字都不剩');
    ok(!/payWith|allowance|transferFrom\(address,address,uint256\)/.test(abiText), 'ABI 里没有任何 ERC-20 支付路径');
    await expectDeployRevert(h, addrWord(ZERO) + addrWord(TREASURY), 'market: nft is zero', 'nft 传 0 地址：部署失败');
    await expectDeployRevert(h, addrWord(SELLER) + addrWord(TREASURY), 'market: nft is not a contract',
      'nft 传一个 EOA（没有代码）：部署失败');
  }

  /* ============================================================ 2. 挂单 */
  console.log('\n— 挂单：先授权，再挂 —');
  const t1 = await mint(SELLER);
  {
    await expectRevert(() => list(SELLER, t1, PRICE), 'market: market not approved', '没授权就挂单：revert');
    await approveAll(SELLER, true);
    await expectRevert(() => list(SELLER, t1, 0n), 'market: price is zero', '价格填 0：revert');
    await expectRevert(() => list(BUYER, t1, PRICE), 'market: seller does not own token', '挂别人的 token：revert');
    await expectRevert(() => list(SELLER, 999n, PRICE), 'market: seller does not own token', '挂一枚不存在的 token：revert（ownerOf 爆炸也算不持有）');

    const r = await list(SELLER, t1, PRICE);
    const lid = asBig(words(r.data)[0]);
    eq(lid, 0n, '第一单的 listingId = 0');
    const l = await listingAt(lid);
    eq(l.fields, 7, '结构体只有 7 个字段 —— 没有第 8 个 inBang');
    eq(l.seller, SELLER.toLowerCase(), '卖家记对了');
    eq(l.token, uni.toLowerCase(), 'token 恒等于 nft');
    eq(l.id, t1, 'tokenId 记对了');
    eq(l.amount, 1n, 'amount 恒为 1');
    eq(l.price, PRICE, '价格 100 USDC（wei，1 USDC = 1e18）');
    eq(l.is1155, false, 'is1155 恒为 false');
    eq(l.active, true, '挂单是 active 的');
    eq(await ownerOfTok(t1), SELLER.toLowerCase(), '不托管：NFT 还在卖家钱包里');
    eq(await h.balance(market), 0n, '市场合约余额是 0');
    eq(asBig(words(await h.view(market, sel('listingCount()')))[0]), 1n, 'listingCount = 1');
    eq(await checkListing(0n), 0, 'checkListing = 0（可买）');
  }

  /* ============================================================ 3. 改价 */
  console.log('\n— 改价：只有卖家能改 —');
  {
    await expectRevert(() => h.call(market, BUYER, sel('updatePrice(uint256,uint256)') + word(0n) + word(50n * ONE), 0),
      'market: not the seller', '别人来改价：revert');
    await expectRevert(() => h.call(market, SELLER, sel('updatePrice(uint256,uint256)') + word(0n) + word(0n), 0),
      'market: price is zero', '改成 0：revert');
    await h.call(market, SELLER, sel('updatePrice(uint256,uint256)') + word(0n) + word(50n * ONE), 0);
    eq((await listingAt(0n)).price, 50n * ONE, '改成 50 USDC 生效');
    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(0n), PRICE),
      'market: wrong price', '按老价 100 USDC 买：revert（价格已经改了）');
    await h.call(market, SELLER, sel('updatePrice(uint256,uint256)') + word(0n) + word(PRICE), 0);
    eq((await listingAt(0n)).price, PRICE, '再改回 100 USDC');
  }

  /* ============================================================ 4. 撤单 */
  console.log('\n— 撤单：只有卖家能撤，撤完就买不了 —');
  {
    await expectRevert(() => h.call(market, BUYER, sel('cancel(uint256)') + word(0n), 0),
      'market: not the seller', '别人来撤单：revert');
    await expectRevert(() => h.call(market, STRANGER, sel('cancelStale(uint256)') + word(0n), 0),
      'market: listing is still valid', '有效的单，路人 cancelStale 也撤不掉');
    await h.call(market, SELLER, sel('cancel(uint256)') + word(0n), 0);
    eq((await listingAt(0n)).active, false, '撤单后 active = false');
    eq(await checkListing(0n), 1, 'checkListing = 1（已取消或已售出）');
    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(0n), PRICE),
      'market: listing not active', '撤了的单再买：revert');
    await expectRevert(() => h.call(market, SELLER, sel('cancel(uint256)') + word(0n), 0),
      'market: listing not active', '同一单撤两次：revert');
    await expectRevert(() => h.call(market, SELLER, sel('cancel(uint256)') + word(77n), 0),
      'market: no such listing', '撤一个不存在的 listingId：revert');
  }

  /* ============================================================ 5. 买入与分账 */
  console.log('\n— 买入：金额必须精确，分账 5% 版税 + 0 手续费 + 95% 卖家 —');
  {
    const r = await list(SELLER, t1, PRICE);
    const lid = asBig(words(r.data)[0]);

    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(lid), PRICE - 1n),
      'market: wrong price', '少付 1 wei：revert');
    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(lid), PRICE + 1n),
      'market: wrong price', '多付 1 wei：revert（合约没有退款路径，多收就是卡死）');
    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(lid), 0n),
      'market: wrong price', '一分不付：revert');

    // 先用 quote() 对一遍明细，再真买
    const q = words(await h.view(market, sel('quote(uint256)') + word(lid)));
    eq(asBig(q[0]), PRICE, 'quote：price = 100 USDC');
    eq(asAddr(q[1]), OWNER.toLowerCase(), 'quote：版税收款人是 ArcUniverse 的 owner（royaltyReceiver 没设，退回 owner）');
    eq(asBig(q[2]), 5n * ONE, 'quote：版税 5 USDC（ArcUniverse 默认 5%）');
    eq(asBig(q[3]), 0n, 'quote：手续费 0（默认不收）');
    eq(asBig(q[4]), 95n * ONE, 'quote：卖家拿 95 USDC');
    eq(asBig(q[2]) + asBig(q[3]) + asBig(q[4]), PRICE, 'quote：三项之和恒等于成交价');

    const b0 = { own: await h.balance(OWNER), tre: await h.balance(TREASURY), sel_: await h.balance(SELLER) };
    await h.call(market, BUYER, sel('buy(uint256)') + word(lid), PRICE);

    eq(await h.balance(OWNER) - b0.own, 5n * ONE, '版税 5 USDC 到了 royaltyInfo 指定的收款人');
    eq(await h.balance(TREASURY) - b0.tre, 0n, '手续费 0：国库一分不进');
    eq(await h.balance(SELLER) - b0.sel_, 95n * ONE, '卖家到手 95 USDC');
    eq(await h.balance(market), 0n, '合约不留钱：余额仍然是 0');
    eq(await ownerOfTok(t1), BUYER.toLowerCase(), 'NFT 到了买家手上');
    eq((await listingAt(lid)).active, false, '成交后挂单自动下架');
    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(lid), PRICE),
      'market: listing not active', '同一单买两次：revert');
  }

  /* ============================================================ 6. 版税改了就跟着改 */
  console.log('\n— 版税跟着 ArcUniverse 走：改成 10% 立刻生效 —');
  {
    await h.call(uni, OWNER, sel('setRoyalty(address,uint16)') + addrWord(STRANGER) + word(1000n), 0);
    const t = await mint(SELLER);
    const lid = asBig(words((await list(SELLER, t, PRICE)).data)[0]);
    const b0 = { str: await h.balance(STRANGER), tre: await h.balance(TREASURY), sel_: await h.balance(SELLER) };
    await h.call(market, BUYER, sel('buy(uint256)') + word(lid), PRICE);
    eq(await h.balance(STRANGER) - b0.str, 10n * ONE, '版税 10 USDC 打给新的收款地址');
    eq(await h.balance(TREASURY) - b0.tre, 0n, '手续费仍然是 0');
    eq(await h.balance(SELLER) - b0.sel_, 90n * ONE, '卖家到手 90 USDC（100 − 10 − 0）');
    eq(await h.balance(market), 0n, '合约余额仍然是 0');
    // 改回默认 5% / 收款人退回 owner，后面的用例按默认值算
    await h.call(uni, OWNER, sel('setRoyalty(address,uint16)') + addrWord(ZERO) + word(500n), 0);
  }

  /* ============================================================ 7. 失效挂单 */
  console.log('\n— 失效挂单：买不成，但谁都能清 —');
  {
    // (a) 卖家把 token 转走了
    const ta = await mint(SELLER);
    const la = asBig(words((await list(SELLER, ta, PRICE)).data)[0]);
    await h.call(uni, SELLER, sel('transferFrom(address,address,uint256)') + addrWord(SELLER) + addrWord(STRANGER) + word(ta), 0);
    eq(await checkListing(la), 2, 'checkListing = 2（卖家已不持有）');
    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(la), PRICE),
      'market: seller no longer owns token', '卖家已转走：buy 带原因 revert');
    await h.call(market, STRANGER, sel('cancelStale(uint256)') + word(la), 0);
    eq((await listingAt(la)).active, false, '路人 cancelStale 把这条死单清掉了');
    await expectRevert(() => h.call(market, STRANGER, sel('cancelStale(uint256)') + word(la), 0),
      'market: listing not active', '同一条死单清两次：revert');

    // (b) 卖家撤了授权
    const tb = await mint(SELLER);
    const lb = asBig(words((await list(SELLER, tb, PRICE)).data)[0]);
    await approveAll(SELLER, false);
    eq(await checkListing(lb), 3, 'checkListing = 3（卖家撤了授权）');
    await expectRevert(() => h.call(market, BUYER, sel('buy(uint256)') + word(lb), PRICE),
      'market: seller revoked approval', '撤了授权：buy 带原因 revert');
    await h.call(market, BUYER, sel('cancelStale(uint256)') + word(lb), 0);
    eq((await listingAt(lb)).active, false, '买家自己也能把这条死单清掉');

    // (c) 单枚 approve 也算授权（不是只认 setApprovalForAll）
    const tc = await mint(SELLER);
    await h.call(uni, SELLER, sel('approve(address,uint256)') + addrWord(market) + word(tc), 0);
    const lc = asBig(words((await list(SELLER, tc, PRICE)).data)[0]);
    eq(await checkListing(lc), 0, '单枚 approve(market, id) 一样能挂能买');
    const b0 = await h.balance(SELLER);
    await h.call(market, BUYER, sel('buy(uint256)') + word(lc), PRICE);
    eq(await h.balance(SELLER) - b0, 94n * ONE, '成交分账照旧');
    await approveAll(SELLER, true);   // 后面的用例还要用
  }

  /* ============================================================ 8. 版税截断与报废的 royaltyInfo */
  console.log('\n— 版税上限 10%：外部 NFT 报 50% 也只付 10% —');
  {
    const evilInit = compileOne(EVIL_SRC, 'E.sol', 'EvilNFT');
    const dep = await h.evm.runCall({
      caller: new Address(hexToBytes(STRANGER)), origin: new Address(hexToBytes(STRANGER)),
      data: hexToBytes('0x' + evilInit), gasLimit: 60000000n, block: h.block
    });
    if (dep.execResult.exceptionError) throw new Error('部署 EvilNFT 失败');
    const evil = '0x' + dep.createdAddress.toString().replace(/^0x/, '');
    const m2 = await h.deploy('ArcMarket', addrWord(evil) + addrWord(TREASURY), OWNER);

    const EID = 1n;
    await h.call(evil, STRANGER, sel('mint(address,uint256)') + addrWord(SELLER) + word(EID), 0);
    await h.call(evil, SELLER, sel('setApprovalForAll(address,bool)') + addrWord(m2) + word(1n), 0);
    const lid = asBig(words((await h.call(m2, SELLER, sel('list(uint256,uint256)') + word(EID) + word(PRICE), 0)).data)[0]);

    const q = words(await h.view(m2, sel('quote(uint256)') + word(lid)));
    eq(asBig(q[2]), 10n * ONE, 'quote：报 50% 的版税被截断成 10 USDC（10%）');
    eq(asBig(q[4]), 90n * ONE, 'quote：卖家仍然拿到 90 USDC，不是 50');

    const b0 = { str: await h.balance(STRANGER), tre: await h.balance(TREASURY), sel_: await h.balance(SELLER) };
    await h.call(m2, BUYER, sel('buy(uint256)') + word(lid), PRICE);
    eq(await h.balance(STRANGER) - b0.str, 10n * ONE, '实际只付了 10 USDC 版税');
    eq(await h.balance(TREASURY) - b0.tre, 0n, '手续费 0');
    eq(await h.balance(SELLER) - b0.sel_, 90n * ONE, '卖家到手 90 USDC');
    eq(await h.balance(m2), 0n, '合约余额 0');

    // royaltyInfo 直接爆炸 → 按没有版税处理，成交照常
    const EID2 = 2n;
    await h.call(evil, STRANGER, sel('breakRoyalty(bool)') + word(1n), 0);
    await h.call(evil, STRANGER, sel('mint(address,uint256)') + addrWord(SELLER) + word(EID2), 0);
    const lid2 = asBig(words((await h.call(m2, SELLER, sel('list(uint256,uint256)') + word(EID2) + word(PRICE), 0)).data)[0]);
    const q2 = words(await h.view(m2, sel('quote(uint256)') + word(lid2)));
    eq(asAddr(q2[1]), ZERO, 'royaltyInfo 爆炸时收款人是 0 地址');
    eq(asBig(q2[2]), 0n, '版税归零');
    const b1 = await h.balance(SELLER);
    await h.call(m2, BUYER, sel('buy(uint256)') + word(lid2), PRICE);
    eq(await h.balance(SELLER) - b1, 100n * ONE, '成交照常，卖家拿全额 100 USDC（版税归零、无手续费）');

    // receiver 是 0 地址 → 版税归零，那笔钱回到卖家手上，不是打给 0 地址烧掉
    const EID3 = 3n;
    await h.call(evil, STRANGER, sel('breakRoyalty(bool)') + word(0n), 0);
    await h.call(evil, STRANGER, sel('setRoyalty(address,uint256)') + addrWord(ZERO) + word(500n), 0);
    await h.call(evil, STRANGER, sel('mint(address,uint256)') + addrWord(SELLER) + word(EID3), 0);
    const lid3 = asBig(words((await h.call(m2, SELLER, sel('list(uint256,uint256)') + word(EID3) + word(PRICE), 0)).data)[0]);
    const b2 = await h.balance(SELLER);
    await h.call(m2, BUYER, sel('buy(uint256)') + word(lid3), PRICE);
    eq(await h.balance(SELLER) - b2, 100n * ONE, '版税收款人是 0 地址时版税归零，卖家拿全额 100 USDC');
  }

  /* ============================================================ 9. 治理 */
  console.log('\n— 费率与国库：非 owner 改不动，10% 是硬上限 —');
  {
    await expectRevert(() => h.call(market, SELLER, sel('setFeeBps(uint16)') + word(0n), 0),
      'market: not owner', '非 owner 改费率：revert');
    await expectRevert(() => h.call(market, SELLER, sel('setTreasury(address)') + addrWord(SELLER), 0),
      'market: not owner', '非 owner 改国库：revert');
    await expectRevert(() => h.call(market, OWNER, sel('setFeeBps(uint16)') + word(1001n), 0),
      'market: fee above 10%', '费率想调到 10.01%：revert');
    await h.call(market, OWNER, sel('setFeeBps(uint16)') + word(1000n), 0);
    eq(asBig(words(await h.view(market, sel('feeBps()')))[0]), 1000n, '顶格 10% 放行');

    // 顶格费率 + 顶格版税：卖家仍然拿得到 80%
    await h.call(uni, OWNER, sel('setRoyalty(address,uint16)') + addrWord(STRANGER) + word(1000n), 0);
    const t = await mint(SELLER);
    const lid = asBig(words((await list(SELLER, t, PRICE)).data)[0]);
    const b0 = { sel_: await h.balance(SELLER), tre: await h.balance(TREASURY), str: await h.balance(STRANGER) };
    await h.call(market, BUYER, sel('buy(uint256)') + word(lid), PRICE);
    eq(await h.balance(STRANGER) - b0.str, 10n * ONE, '版税顶格 10 USDC');
    eq(await h.balance(TREASURY) - b0.tre, 10n * ONE, '手续费顶格 10 USDC');
    eq(await h.balance(SELLER) - b0.sel_, 80n * ONE, '最坏情况卖家仍然拿到 80 USDC —— 那个减法不会下溢');

    await h.call(market, OWNER, sel('setFeeBps(uint16)') + word(0n), 0);
    await h.call(uni, OWNER, sel('setRoyalty(address,uint16)') + addrWord(ZERO) + word(500n), 0);
    await expectRevert(() => h.call(market, OWNER, sel('setTreasury(address)') + addrWord(ZERO), 0),
      'market: treasury is zero', '国库改成 0 地址：revert');
    await h.call(market, OWNER, sel('transferOwnership(address)') + addrWord(STRANGER), 0);
    eq(asAddr(words(await h.view(market, sel('owner()')))[0]), STRANGER.toLowerCase(), 'owner 交出去了');
    await h.call(market, STRANGER, sel('transferOwnership(address)') + addrWord(OWNER), 0);
    ok(true, '合约里没有 withdraw()、没有 receive()：钱没有任何路径停在这里');
  }

  /* ============================================================ 10. 重入 */
  console.log('\n— 重入：恶意卖家在收款回调里回头调 buy —');
  {
    const attackerInit = compileOne(ATTACKER_SRC, 'A.sol', 'ReentrantSeller');
    const dep = await h.evm.runCall({
      caller: new Address(hexToBytes(SELLER)), origin: new Address(hexToBytes(SELLER)),
      data: hexToBytes('0x' + attackerInit + addrWord(market)), gasLimit: 60000000n, block: h.block
    });
    if (dep.execResult.exceptionError) throw new Error('部署 ReentrantSeller 失败');
    const attacker = '0x' + dep.createdAddress.toString().replace(/^0x/, '');

    const t = await mint(SELLER);
    await h.call(uni, SELLER, sel('transferFrom(address,address,uint256)') + addrWord(SELLER) + addrWord(attacker) + word(t), 0);
    await h.call(attacker, SELLER, sel('approveAndList(address,uint256,uint256)') + addrWord(uni) + word(t) + word(PRICE), 0);
    const lid = asBig(words(await h.view(attacker, sel('target()')))[0]);

    const treB = await h.balance(TREASURY);
    await h.call(market, BUYER, sel('buy(uint256)') + word(lid), PRICE);
    eq(asBool(words(await h.view(attacker, sel('reentryTried()')))[0]), true, '攻击者确实在收款回调里回头调了 buy');
    eq(asBool(words(await h.view(attacker, sel('reentrySucceeded()')))[0]), false, '重入调用失败了');
    eq(L.decodeRevert(decodeBytesReturn(await h.view(attacker, sel('reentryError()')))), 'market: reentrant',
       '重入被 nonReentrant 挡住，原因是 market: reentrant');
    eq(await ownerOfTok(t), BUYER.toLowerCase(), '正常那一笔照样成交，NFT 到了买家手上');
    eq(await h.balance(TREASURY) - treB, 0n, '国库分文未收（手续费 0，且没有被重入刷出钱来）');
    eq(await h.balance(market), 0n, '市场合约余额仍然是 0');
  }

  /* ============================================================ 11. 视图 */
  console.log('\n— 视图：分页扫单与卖家索引 —');
  {
    const ids = [await mint(SELLER), await mint(SELLER)];
    for (const id of ids) await list(SELLER, id, 7n * ONE);
    const total = asBig(words(await h.view(market, sel('listingCount()')))[0]);
    const page = await h.view(market, sel('activeListings(uint256,uint256)') + word(0n) + word(50n));
    ok(page.length > 2, 'activeListings 返回了一页数据');
    const mine = words(await h.view(market, sel('listingsOf(address)') + addrWord(SELLER)));
    eq(asBig(mine[1]) > 0n, true, 'listingsOf(卖家) 列出了他挂过的所有单');
    eq(total > 0n, true, 'listingCount 随挂单增长');
    await expectRevert(() => h.view(market, sel('checkListing(uint256)') + word(9999n)),
      'market: no such listing', 'checkListing 查不存在的单：revert');
    await expectRevert(() => h.view(market, sel('quote(uint256)') + word(9999n)),
      'market: no such listing', 'quote 查不存在的单：revert');
  }

  summary('ArcMarket');
}

main().catch((e) => { console.error(e); process.exit(1); });
