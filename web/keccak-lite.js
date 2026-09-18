/*
 * keccak256（浏览器用的精简版）
 * ------------------------------------------------------------
 * 从 engine/archash.js 里抽出来的哈希部分，**不含任何派生逻辑**。
 *
 * 为什么要拆：爆炸的计算已经搬到服务端（specs/server-side.md 目标 1），
 * archash.js 因此不再打进站点包。但 arc-chain.js 还需要 keccak256 来算
 * ABI 的函数选择器和事件 topic —— 那只是个哈希函数，发到浏览器里
 * 泄露不了参数映射，而派生表留在服务端。
 *
 * 与 archash.js 里那份必须逐位一致；tools/keccak-parity.js 会比对。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.MirrorKeccak = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================================================ keccak-f[1600] */
  var MASK = (1n << 64n) - 1n;
  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  // 旋转量 r[x + 5y]
  var ROT = [
    0n, 1n, 62n, 28n, 27n,
    36n, 44n, 6n, 55n, 20n,
    3n, 10n, 43n, 25n, 39n,
    41n, 45n, 15n, 21n, 8n,
    18n, 2n, 61n, 56n, 14n
  ];
  function rotl(v, n) { return n === 0n ? v : (((v << n) | (v >> (64n - n))) & MASK); }

  function keccakF(A) {
    var C = new Array(5), D = new Array(5), B = new Array(25), x, y, i;
    for (i = 0; i < 24; i++) {
      // θ
      for (x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
      for (x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) A[x + 5 * y] ^= D[x];
      // ρ + π
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
      // χ
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
      }
      // ι
      A[0] ^= RC[i];
    }
    return A;
  }

  /** 输入 Uint8Array / 十六进制串（可带 0x）；输出 32 字节 Uint8Array */
  function keccak256Bytes(input) {
    var msg = toBytes(input);
    var RATE = 136;                                  // 1600/8 − 2·256/8
    var padLen = RATE - (msg.length % RATE);
    var block = new Uint8Array(msg.length + padLen);
    block.set(msg);
    block[msg.length] |= 0x01;                       // keccak 原始填充（SHA3 是 0x06，别混）
    block[block.length - 1] |= 0x80;

    var A = new Array(25).fill(0n), off, j, k, lane;
    for (off = 0; off < block.length; off += RATE) {
      for (j = 0; j < RATE / 8; j++) {
        lane = 0n;
        for (k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(block[off + j * 8 + k]);   // 小端
        A[j] ^= lane;
      }
      keccakF(A);
    }
    var out = new Uint8Array(32);
    for (j = 0; j < 4; j++) { lane = A[j]; for (k = 0; k < 8; k++) { out[j * 8 + k] = Number(lane & 0xffn); lane >>= 8n; } }
    return out;
  }
  function keccak256(input) { return '0x' + hex(keccak256Bytes(input)); }

  /* ============================================================ 字节工具 */
  function hex(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }
  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (Array.isArray(x)) return new Uint8Array(x);
    var s = String(x);
    if (/^0x/i.test(s)) {
      s = s.slice(2);
      if (s.length % 2) s = '0' + s;
      if (!/^[0-9a-f]*$/i.test(s)) throw new Error('不是合法的十六进制串');
      var b = new Uint8Array(s.length / 2), i;
      for (i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
      return b;
    }
    // 普通字符串按 UTF-8
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, 'utf8'));
  }
  function toBigInt(bytes) { var v = 0n, i; for (i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]); return v; }

  /** 归一化 32 字节区块哈希；不合法则抛错（区块哈希必须是 32 字节） */
  function normHash(h) {
    var s = String(h || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(s)) throw new Error('区块哈希必须是 0x 开头的 64 位十六进制（32 字节）');
    return '0x' + s.slice(2).toLowerCase();
  }

  return {
    keccak256: keccak256,
    keccak256Bytes: keccak256Bytes,
    normHash: normHash,
    toBytes: toBytes,
    toBigInt: toBigInt,
    hex: hex
  };
}));
