/*
 * 本地 EVM 测试台：把编译出来的真字节码部署进 @ethereumjs/evm 里跑。
 * 不需要链、不需要 Foundry，Windows 上 node 一条命令就能跑。
 *
 * 提供：部署、调用、极简 ABI 编解码、revert 原因解码、可推进的区块环境
 *（block.number / block.timestamp 可任意推进，blockhash 由确定性函数给出，
 *  超过 256 块 EVM 自己会返回 0 —— 正好用来测「揭晓过期」这条路）。
 */
const fs = require('fs');
const path = require('path');
const { EVM } = require('@ethereumjs/evm');
const { Address, hexToBytes, bytesToHex, Account } = require('@ethereumjs/util');
const B = require(path.join(__dirname, '../../engine/archash.js'));

const OUT = path.join(__dirname, '../out');

/* ---------------------------------------------------------------- ABI 小工具 */
const sel = (sig) => B.keccak256(sig).slice(0, 10);
const hx = (v) => BigInt(v).toString(16);
const word = (v) => hx(v).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const bytes32Word = (h) => h.replace(/^0x/, '').padStart(64, '0');

/** 把返回数据切成 32 字节的字 */
function words(hex) {
  const h = hex.replace(/^0x/, '');
  const out = [];
  for (let i = 0; i < h.length; i += 64) out.push(h.slice(i, i + 64));
  return out;
}
const asBig = (w) => BigInt('0x' + w);
const asNum = (w) => Number(BigInt('0x' + w));
const asAddr = (w) => '0x' + w.slice(24);
const asBool = (w) => BigInt('0x' + w) !== 0n;

/** ABI string 返回值 → JS 字符串 */
function decodeString(hex) {
  const raw = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  const off = Number(BigInt('0x' + raw.subarray(0, 32).toString('hex')));
  const len = Number(BigInt('0x' + raw.subarray(off, off + 32).toString('hex')));
  return raw.subarray(off + 32, off + 32 + len).toString('utf8');
}

/** Error(string) / Panic(uint256) 的 revert 数据 → 人话 */
function decodeRevert(hex) {
  const h = (hex || '').replace(/^0x/, '');
  if (h.length === 0) return '(无 revert 数据)';
  if (h.slice(0, 8) === '08c379a0') {
    const body = Buffer.from(h.slice(8), 'hex');
    const off = Number(BigInt('0x' + body.subarray(0, 32).toString('hex')));
    const len = Number(BigInt('0x' + body.subarray(off, off + 32).toString('hex')));
    return body.subarray(off + 32, off + 32 + len).toString('utf8');
  }
  if (h.slice(0, 8) === '4e487b71') return 'Panic(0x' + h.slice(8 + 56) + ')';
  return '0x' + h.slice(0, 16) + '…';
}

/* ---------------------------------------------------------------- 区块环境 */
/** 确定性的区块哈希：blockhash(n) = keccak256("evmlib-block-" + n) */
const blockHashOf = (n) => B.keccak256('evmlib-block-' + n);

class Chain {
  async getBlock(id) {
    const h = hexToBytes(blockHashOf(Number(id)));
    return { hash: () => h };
  }
  shallowCopy() {
    return this;
  }
}

class Harness {
  constructor(evm) {
    this.evm = evm;
    this.number = 1000n;
    this.timestamp = 1800000000n;
  }

  static async create() {
    const evm = await EVM.create({ blockchain: new Chain() });
    return new Harness(evm);
  }

  get block() {
    const n = this.number;
    const t = this.timestamp;
    return {
      header: {
        number: n,
        timestamp: t,
        coinbase: new Address(hexToBytes('0x' + 'aa'.repeat(20))),
        difficulty: 0n,
        prevRandao: hexToBytes('0x' + '00'.repeat(32)),
        gasLimit: 140000000n,
        baseFeePerGas: 0n,
        cliqueSigner: () => new Address(hexToBytes('0x' + 'aa'.repeat(20))),
        getBlobGasPrice: () => undefined
      }
    };
  }

  /** 推进区块高度与时间（秒） */
  advance(blocks, seconds) {
    this.number += BigInt(blocks || 0);
    this.timestamp += seconds === undefined ? BigInt(blocks || 0) * 3n : BigInt(seconds);
  }

  async fund(addrHex, wei) {
    const a = new Address(hexToBytes(addrHex));
    const acc = (await this.evm.stateManager.getAccount(a)) || new Account();
    acc.balance = BigInt(wei);
    await this.evm.stateManager.putAccount(a, acc);
  }

  async balance(addrHex) {
    const acc = await this.evm.stateManager.getAccount(new Address(hexToBytes(addrHex)));
    return acc ? acc.balance : 0n;
  }

  /** 部署：初始化字节码 + 构造参数（已编码的 hex，无 0x） */
  async deploy(name, args, fromHex) {
    const init = fs.readFileSync(path.join(OUT, name + '.bytecode.hex'), 'utf8').trim();
    const from = fromHex || '0x' + '22'.repeat(20);
    await this.fund(from, 10n ** 22n);
    const res = await this.evm.runCall({
      caller: new Address(hexToBytes(from)),
      origin: new Address(hexToBytes(from)),
      data: hexToBytes('0x' + init + (args || '')),
      gasLimit: 60000000n,
      block: this.block
    });
    if (res.execResult.exceptionError) {
      throw new Error(`部署 ${name} 失败：${res.execResult.exceptionError.error} ${decodeRevert(bytesToHex(res.execResult.returnValue))}`);
    }
    return '0x' + res.createdAddress.toString().replace(/^0x/, '');
  }

  /** 部署并只返回执行 gas（含代码存储费），给 gastest 估上线成本用。
      不返回地址：调用方要地址就用 deploy，这里刻意分开，免得有人拿它当部署用
      却发现每次都在一个新 Harness 上算，状态对不上。 */
  async deployGas(name, fromHex, args) {
    const init = fs.readFileSync(path.join(OUT, name + '.bytecode.hex'), 'utf8').trim();
    const from = fromHex || '0x' + '22'.repeat(20);
    await this.fund(from, 10n ** 22n);
    const res = await this.evm.runCall({
      caller: new Address(hexToBytes(from)),
      origin: new Address(hexToBytes(from)),
      data: hexToBytes('0x' + init + (args || '')),
      gasLimit: 60000000n,
      block: this.block
    });
    if (res.execResult.exceptionError) {
      throw new Error(`部署 ${name} 失败：${res.execResult.exceptionError.error}`);
    }
    return res.execResult.executionGasUsed;
  }

  /** 调用；失败时抛出带 revert 原因的错误 */
  async call(to, from, data, value) {
    const acc = await this.evm.stateManager.getAccount(new Address(hexToBytes(from)));
    if (!acc) await this.evm.stateManager.putAccount(new Address(hexToBytes(from)), new Account());
    const res = await this.evm.runCall({
      to: new Address(hexToBytes(to)),
      caller: new Address(hexToBytes(from)),
      origin: new Address(hexToBytes(from)),
      value: BigInt(value || 0),
      data: hexToBytes(data.startsWith('0x') ? data : '0x' + data),
      gasLimit: 60000000n,
      block: this.block
    });
    const ret = bytesToHex(res.execResult.returnValue);
    if (res.execResult.exceptionError) {
      const e = new Error(decodeRevert(ret));
      e.reverted = true;
      e.raw = res.execResult.exceptionError.error;
      throw e;
    }
    return { data: ret, gas: res.execResult.executionGasUsed, logs: res.execResult.logs || [] };
  }

  /** 只读调用（不改状态：用 checkpoint/revert 保证） */
  async view(to, data, from) {
    await this.evm.stateManager.checkpoint();
    try {
      const r = await this.call(to, from || '0x' + '22'.repeat(20), data, 0);
      return r.data;
    } finally {
      await this.evm.stateManager.revert();
    }
  }
}

/* ---------------------------------------------------------------- 断言 */
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failures.push(msg);
    console.log('  ✗ ' + msg);
  }
}
function eq(actual, expected, msg) {
  const a = typeof actual === 'bigint' ? actual.toString() : String(actual);
  const e = typeof expected === 'bigint' ? expected.toString() : String(expected);
  ok(a === e, `${msg}${a === e ? '' : `（实际 ${a}，期望 ${e}）`}`);
}
function summary(title) {
  console.log(`\n${failures.length ? '✗' : '✓'} ${title}：${passed} 项通过，${failures.length} 项失败`);
  if (failures.length) {
    failures.forEach((f) => console.log('   ✗ ' + f));
    process.exit(1);
  }
}

module.exports = {
  Harness, sel, word, addrWord, bytes32Word, words, asBig, asNum, asAddr, asBool,
  decodeString, decodeRevert, blockHashOf, ok, eq, summary, B
};
