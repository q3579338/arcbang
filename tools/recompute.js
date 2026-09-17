#!/usr/bin/env node
/*
 * tools/recompute.js —— 只凭一个区块哈希，把那个宇宙整个重算一遍
 * ------------------------------------------------------------
 * 用法：node tools/recompute.js 0x<32 字节区块哈希> [--json]
 *
 * 打印：23 个参数、结局、档位、稀有度、cardHash。
 * 站点上显示的那张卡就是这么来的 —— 同一个哈希，在哪台机器上算都是同一个结果。
 *
 * **零依赖**：只用 engine/ 里的东西（keccak256 是 engine/bnbhash.js 自带的 BigInt 实现）。
 * 服务端 server/card.js 走的是 ethers 的 AbiCoder；这里把那一段静态类型的编码
 * 手写成 29 个 32 字节字（bytes32 + uint32[22] + 三个 uint32 + 两个 uint8 + uint32），
 * 静态类型的 abi.encode 就是定长字的拼接，两边逐字节相同。
 * tools/recompute.test.js 会拿 server/card.js 的输出逐字段比对，防止两边漂移。
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'engine/bnbhash.js'));
require(path.join(ROOT, 'engine/params.js'));
const E = require(path.join(ROOT, 'engine/engine.js'));

/* 这三个常量必须与 server/card.js 逐字相同 —— 它们进 cardHash。 */
const OUTCOME_ORDER = [
  'UNSTABLE_ORBITS', 'BIG_CRUNCH', 'BIG_RIP', 'HEAT_DEATH_NO_STRUCTURE',
  'BLACK_HOLE_DOMINATED', 'NO_ATOMS', 'NO_CHEMISTRY', 'NO_STARS',
  'STARS_NO_LIFE', 'OBSERVERS_POSSIBLE', 'NO_CARBON_CHEMISTRY', 'BEYOND_MODEL_DIM'
];
const DERIVATION_VERSION = 3;
const RARITY_NAME = ['S', 'A', 'B', 'C', 'D'];

function rarityOf(outcomeId, D) {
  if (outcomeId === 'OBSERVERS_POSSIBLE') return 0;              // S
  if (D != null && Math.abs(D - 3) < 1e-9) return 1;             // A
  if (D == null || D <= 1) return 4;                             // D
  if (Math.abs(D - Math.round(D)) < 1e-9) return 2;              // B
  return 3;                                                      // C
}

/** 静态类型的 abi.encode：每个值一个 32 字节大端字 */
function word(n) {
  let h = BigInt(n).toString(16);
  if (h.length > 64) throw new Error('放不进一个字：' + n);
  return '0'.repeat(64 - h.length) + h;
}

function cardHashOf(hash, d, outcomeIdx, rarity) {
  const f = d.frame;
  let body = hash.slice(2).toLowerCase();                        // bytes32
  for (let i = 0; i < 22; i++) body += word(d.uInt[i]);          // uint32[22]（定长数组，就地展开）
  body += word(f.uG) + word(f.uF1) + word(f.uF2);                // uint32 ×3
  body += word(outcomeIdx) + word(rarity);                       // uint8 ×2
  body += word(DERIVATION_VERSION);                              // uint32
  return B.keccak256('0x' + body);
}

/** 哈希 → 整张卡（与 server/card.js buildCard 的同名字段一致） */
function recompute(blockHash) {
  const hash = B.normHash(blockHash);
  const d = B.derive(hash);
  // register:false：别往引擎的目录里盖戳，这里只是复算
  const r = E.simulate(d.params, { modules: d.modules, register: false });
  const outcomeId = (r.outcome && r.outcome.id) || null;
  const outcomeIdx = OUTCOME_ORDER.indexOf(outcomeId);
  if (outcomeIdx < 0) throw new Error('引擎给出的结局不在合约的 OUTCOMES 里：' + outcomeId);
  const dims = (r.calc && r.calc.dims) || {};
  const D = dims.D == null ? null : dims.D;
  const rarity = rarityOf(outcomeId, D);
  return {
    blockHash: hash,
    derivationVersion: DERIVATION_VERSION,
    tier: { id: d.tier.id, name: d.tier.name, scale: d.tier.scale, p: d.tier.p },
    outcome: { index: outcomeIdx, id: outcomeId, name: r.outcome.name, observers: !!r.outcome.observers },
    rarity: { index: rarity, name: RARITY_NAME[rarity] },
    dimension: D == null ? null : { D: D, kind: dims.kind || null },
    params: d.params,
    uInt: d.uInt,
    modules: d.modules,
    cardHash: cardHashOf(hash, d, outcomeIdx, rarity)
  };
}

module.exports = { recompute, cardHashOf, rarityOf, OUTCOME_ORDER, DERIVATION_VERSION, RARITY_NAME };

/* ------------------------------------------------------------ 命令行 */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const asJson = argv.indexOf('--json') >= 0;
  const hash = argv.filter((a) => a.indexOf('--') !== 0)[0];
  if (!hash) {
    console.error('用法：node tools/recompute.js 0x<32 字节区块哈希> [--json]');
    process.exit(2);
  }
  let card;
  try { card = recompute(hash); }
  catch (e) { console.error('算不出来：' + (e && e.message)); process.exit(1); }

  if (asJson) { console.log(JSON.stringify(card, null, 2)); process.exit(0); }

  console.log('区块哈希   ' + card.blockHash);
  console.log('推导版本   v' + card.derivationVersion);
  console.log('档位       ' + card.tier.name + '（scale ' + card.tier.scale + '，占比 ' + card.tier.p + '）');
  console.log('结局       ' + card.outcome.index + ' · ' + card.outcome.id + '（' + card.outcome.name + '）');
  console.log('稀有度     ' + card.rarity.name);
  console.log('空间维数   ' + (card.dimension ? card.dimension.D + (card.dimension.kind ? '（' + card.dimension.kind + '）' : '') : '未知'));
  console.log('cardHash   ' + card.cardHash);
  console.log('\n参数（' + Object.keys(card.params).length + ' 个）');
  Object.keys(card.params).forEach((k) => console.log('  ' + k.padEnd(22) + card.params[k]));
}
