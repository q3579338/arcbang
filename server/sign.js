/*
 * 签名 —— 服务端盖的那道章
 * ------------------------------------------------------------
 * 合约拿 ecrecover 验这个签名，验过才把 cardHash 写进链上。
 * 没走服务端的 mint 就没有签名，cardOf 是 0，市场不收。
 *
 * C4：签名内容必须绑死 chainId + 合约地址 + deadline。
 *   - 少了 chainId：测试网签的名能拿到主网用
 *   - 少了合约地址：A 合约的签名能喂给 B 合约
 *   - 少了 deadline：一份签名永久有效，等于把印章送人
 */
'use strict';
const fs = require('fs');
const { Wallet, keccak256, getBytes, AbiCoder } = require('ethers');

const coder = AbiCoder.defaultAbiCoder();

/** 签名有效期：够用户看完确认页再点 mint，又不至于长到能被囤积。
    夹在 [30, 3600]：配成 NaN 会让 deadline 变成 NaN 签出废名；
    配成十年等于把印章送人（deadline 是摘要字段，合约只认过期与否）。 */
function ttlOf(v) {
  const n = Math.floor(Number(v == null || v === '' ? 600 : v));
  if (!Number.isFinite(n)) return 600;
  return Math.min(3600, Math.max(30, n));
}
const TTL_SEC = ttlOf(process.env.ARCBANG_SIG_TTL);

function loadWallet() {
  const inline = process.env.ARCBANG_SIGNER_KEY;
  const file = process.env.ARCBANG_SIGNER_KEY_FILE || '/etc/bnbbang/signer.key';
  let pk = inline;
  if (!pk && fs.existsSync(file)) pk = fs.readFileSync(file, 'utf8').trim();
  if (!pk) {
    throw new Error('没有签名私钥：设 ARCBANG_SIGNER_KEY 或把私钥放到 ' + file);
  }
  return new Wallet(pk.startsWith('0x') ? pk : '0x' + pk);
}

/** 签名协议 v2：摘要末尾绑铸造人地址，挡住抢跑窗口。
    只认字符串 '1'；没设或任何别的值都走 v1，保证现役合约的摘要逐字节不变。
    必须每次调用现读 env：自检要在同一进程里设/清各跑一遍。 */
function sigV2() {
  return process.env.ARCBANG_SIG_V2 === '1';
}

const MINTER_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDR = /^0x0{40}$/i;

/** v2 摘要入参：必须是 0x+40 hex，且不是零地址（零地址永远当不了 msg.sender）。 */
function assertMinter(minter) {
  if (typeof minter !== 'string' || !MINTER_RE.test(minter)) {
    throw new Error('v2 摘要需要合法 minter');
  }
  if (ZERO_ADDR.test(minter)) throw new Error('v2 摘要 minter 不能是零地址');
}

/**
 * 从请求体取出铸造人地址。
 *   v1：忽略 minter，返回 { ok:true, minter:null }（摘要不加这个字）
 *   v2：必填、必须是 0x + 40 位 hex、不许零地址；非法/缺省 { ok:false, error } 给人话
 * 大小写都收，进摘要之前统一小写（address 编码不认大小写，统一了两边才对得死）。
 *
 * **开关只认 process.env.ARCBANG_SIG_V2 === '1'**。请求体里的 sigV2 / sigVersion
 * / ARCBANG_SIG_V2 / cardShape 一律不看 —— 客户端不能靠参数把 v2 关掉或打开。
 */
function minterFromBody(body) {
  if (!sigV2()) return { ok: true, minter: null };
  const m = body && body.minter;
  if (m == null || m === '') {
    return { ok: false, error: 'v2 签名必须带铸造人地址 minter' };
  }
  if (typeof m !== 'string' || !MINTER_RE.test(m)) {
    return { ok: false, error: 'minter 不是合法地址（要 0x 开头的 40 位十六进制）' };
  }
  if (ZERO_ADDR.test(m)) {
    return { ok: false, error: 'minter 不能是零地址' };
  }
  return { ok: true, minter: m.toLowerCase() };
}

/**
 * 摘要必须和合约里算的一模一样，否则 ecrecover 出来的地址对不上。
 * 合约侧对应（MirrorUniverse.sol 的 bangSigned，逐字段同序同类型）：
 *   keccak256(abi.encode(
 *     block.chainid,   // uint256
 *     address(this),   // address
 *     blockHash,       // bytes32
 *     blockNumber,     // uint64
 *     outcome,         // uint8
 *     rarity,          // uint8   ← 别漏：它决定定价和发币，不签就等于让调用者自己报价
 *     cardHash,        // bytes32
 *     deadline,        // uint64
 *     msg.sender,      // address  ← 仅 v2：不签就是「谁先交谁铸」的能力票
 *     free))           // bool     ← 仅 ARCBANG：不签就是「换个新地址就有一枚免费额度」
 * 再套 EIP-191 的 "\x19Ethereum Signed Message:\n32" 前缀。
 *
 * v1（开关关掉）不加最后那个 address，编码与改前逐字节相同。
 * v2 打开时 minter 必须是合法地址，对应链上 msg.sender。
 */
/* 上面这段原来漏了 rarity，和下面的代码对不上。签名摘要的文档写错代价特别大：
   照着注释去实现合约那一侧，链上只会甩一个 BadSig，从签名本身看不出少了哪个字段。 */
/* free（2026-09-18 加，ARCBANG）：**只有显式传了布尔值才进摘要**。
   传 null / undefined 就一个字节都不加，这样 BNB 那条老路（v1 与 v2）的摘要逐字节不变 ——
   selftest 里那三条「与改前已知向量逐字节相同」就是钉这件事的。
   忘了传的后果是安全的：签出来的是旧摘要，新合约 ecrecover 出别的地址，当场 BadSig。 */
function digestOf(chainId, contractAddr, blockHash, blockNumber, outcome, rarity, cardHash, deadline, minter, free) {
  const types = ['uint256', 'address', 'bytes32', 'uint64', 'uint8', 'uint8', 'bytes32', 'uint64'];
  const values = [chainId, contractAddr, blockHash, blockNumber, outcome, rarity, cardHash, deadline];
  if (sigV2()) {
    assertMinter(minter);
    types.push('address');
    values.push(minter.toLowerCase());
  }
  if (typeof free === 'boolean') {
    if (!sigV2()) throw new Error('free 标志要求 v2 摘要（合约那边 msg.sender 与 free 是一起加的）');
    types.push('bool');
    values.push(free);
  }
  return keccak256(coder.encode(types, values));
}

function makeSigner(chainId, contractAddr) {
  const wallet = loadWallet();

  /* 收的是「给定 deadline 才能组出摘要」的函数，而不是一个已经组好的摘要。
     deadline 本身是摘要的一个字段，所以它必须先算出来再进摘要 —— 如果把顺序交给调用方，
     早晚有人先组摘要再取 deadline，签出来的那份里外两个 deadline 不一致，
     合约那边只会甩一个 BadSig，从签名本身完全看不出错在哪。这里把顺序焊死。
     @returns {Promise<{sig:string, deadline:number}>} */
  async function signWith(buildDigest, nowSec) {
    const deadline = Math.floor(nowSec == null ? Date.now() / 1000 : nowSec) + TTL_SEC;
    // signMessage 会自动加 EIP-191 前缀；传 bytes 而不是字符串，否则会按 UTF-8 当文本签
    const sig = await wallet.signMessage(getBytes(buildDigest(deadline)));
    return { sig, deadline };
  }

  return {
    address: wallet.address,
    /** @returns {Promise<{sig:string, deadline:number}>}
        minter：v2 摘要末尾那个 address（= 之后上链交易的 from）；v1 忽略。
        free：走不走免费额度（ARCBANG）。传 true/false 才进摘要，传 null/undefined 不加字段。
        **免费与否由服务端决定**（server/allowlist.js），不是合约自己按 totalSupply 猜。 */
    async sign(blockHash, blockNumber, outcome, rarity, cardHash, nowSec, minter, free) {
      return signWith(
        (dl) => digestOf(chainId, contractAddr, blockHash, blockNumber, outcome, rarity, cardHash, dl, minter, free),
        nowSec
      );
    },
    /* 干预的摘要字段和引爆完全不同（见 intervene.js 的 interveneDigest），
       但用的是同一把私钥、同一套 EIP-191 前缀，所以只把「怎么组摘要」交出去。

       干预那份摘要的倒数第二个字段是 keccak256(ops) —— 位移记录的哈希。
       签名盖住它，链上那段"推了哪几个参数、各推到哪"才是服务端认过的那一份；
       合约本身不解析 ops，所以除了这道签名之外没有别的东西在担保它。
       v2 再在末尾加 minter（address），与 bang / craft 同一套开关。 */
    signWith,
    digestOf
  };
}

module.exports = { makeSigner, digestOf, TTL_SEC, _ttlOf: ttlOf, sigV2, minterFromBody, assertMinter };
