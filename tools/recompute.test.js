#!/usr/bin/env node
/*
 * tools/recompute.test.js —— 复算工具与服务端的一致性自检
 * ------------------------------------------------------------
 * 用法：node tools/recompute.test.js
 *
 * tools/recompute.js 是零依赖的（自己拼 abi.encode 的定长字），
 * server/card.js 走 ethers 的 AbiCoder。两条路必须给出**逐字节相同**的 cardHash，
 * 否则站上显示的卡和链上签的那一份对不上。
 *
 * 服务端那份要 ethers（cd server && npm i）。装不上时这个测试只跑自洽检查（确定性 + 长度），
 * 打印一行提示后照样退 0 —— 公开仓库里 clone 下来先跑测试的人不该被一个可选依赖挡住。
 */
'use strict';

const path = require('path');
const R = require('./recompute.js');

const HASHES = [
  '0x0d21840abff46b96c84b2ac9e10e4f5cdaeb5693cb665db62a2f3b02d2d57b5b',
  '0x00000000000000000000000000000000000000000000000000000000000000ff',
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '0x8f2a559b3a2c1d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6',
  '0x1111111111111111111111111111111111111111111111111111111111111111'
];

let pass = 0, fail = 0;
function ok(m) { pass++; console.log('✓ ' + m); }
function bad(m) { fail++; console.log('✗ ' + m); }

/* ---- 1. 自洽：同一个哈希算两遍必须一模一样，cardHash 是 32 字节 ---- */
HASHES.forEach((h) => {
  const a = R.recompute(h), b = R.recompute(h);
  if (JSON.stringify(a) !== JSON.stringify(b)) return bad(h.slice(0, 12) + '… 两次复算不一致');
  if (!/^0x[0-9a-f]{64}$/.test(a.cardHash)) return bad(h.slice(0, 12) + '… cardHash 不是 32 字节：' + a.cardHash);
  if (a.uInt.length !== 22) return bad(h.slice(0, 12) + '… uInt 不是 22 个槽');
  ok(h.slice(0, 12) + '… → ' + a.outcome.id + ' · ' + a.rarity.name + ' · ' + a.cardHash.slice(0, 12) + '…');
});

/* ---- 2. 与 server/card.js 逐字段比对（有 ethers 才跑）---- */
let card = null;
try { card = require(path.join(__dirname, '..', 'server', 'card.js')); }
catch (e) { console.log('○ 跳过与 server/card.js 的比对（缺 ethers：cd server && npm i）'); }

if (card) {
  HASHES.forEach((h) => {
    const mine = R.recompute(h);
    const theirs = card.buildCard(h, null);
    const c = theirs.card;
    const diff = [];
    if (mine.cardHash !== theirs.cardHash) diff.push('cardHash ' + mine.cardHash + ' ≠ ' + theirs.cardHash);
    if (mine.outcome.index !== c.outcome.index) diff.push('outcome ' + mine.outcome.index + ' ≠ ' + c.outcome.index);
    if (mine.rarity.index !== c.rarity.index) diff.push('rarity ' + mine.rarity.index + ' ≠ ' + c.rarity.index);
    if (mine.tier.id !== c.tier.id) diff.push('tier ' + mine.tier.id + ' ≠ ' + c.tier.id);
    if (mine.derivationVersion !== c.derivationVersion) diff.push('version ' + mine.derivationVersion + ' ≠ ' + c.derivationVersion);
    if (String(mine.uInt) !== String(c.uInt)) diff.push('uInt 不一致');
    if (diff.length) bad(h.slice(0, 12) + '… 与 server/card.js 不一致：' + diff.join('；'));
    else ok(h.slice(0, 12) + '… 与 server/card.js 逐字段一致');
  });
}

console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
