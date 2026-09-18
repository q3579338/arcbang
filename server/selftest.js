/*
 * 服务端自检 —— 对着 的验收表逐条跑
 * 用法：node selftest.js  （不需要服务在跑；需要联网的那两条会自己跳过并说明）
 */
'use strict';
require('./env-compat.js');            // 环境变量旧名兼容，排在所有 require 之前
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCard, DERIVATION_VERSION, CARD_SHAPE, OUTCOME_ORDER, rarityOf } = require('./card.js');
const { renderSVG, renderCraftedSVG, craftedBurnLabel } = require('./art.js');
const { digestOf, _ttlOf, minterFromBody } = require('./sign.js');
const { evaluate, interveneDigest, craftDigest, opsHashOf, applyOps, suggestNext,
  encodeOps, decodeOps, applyOpsHex, cardHashOf, cardHashFromCard, quantizeUnit, OPS_SCALE, PARAM_KEYS, CARD_SHAPE: IV_SHAPE } = require('./intervene.js');
const { Wallet, verifyMessage, getBytes, id: keccakId } = require('ethers');

const B = require(path.join(__dirname, '..', 'engine/archash.js'));
const P = require(path.join(__dirname, '..', 'engine/params.js'));
const E = require(path.join(__dirname, '..', 'engine/engine.js'));

let pass = 0, fail = 0;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ✓ ' + name + (note ? '  ' + note : '')); }
  else { fail++; console.log('  ✗ ' + name + '  ' + (note || '')); }
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const H = [
  '0x0d21840abff46b96c84b2ac9e10e4f5cdaeb5693cb665db62a2f3b02d2d57b5b',
  '0x6d3c66c5357ec91d5c43af47e234a939b22557cbb552dc45bebbceeed90fbe34',
  B.keccak256('sample-alive-1')
];

console.log('\n[A1] 出图是 blockHash 的纯函数');
for (const h of H) {
  const { card } = buildCard(h, 1);
  const digests = new Set();
  for (let i = 0; i < 200; i++) digests.add(sha(renderSVG(h, card, true)));
  ok('同哈希渲染 200 次唯一', digests.size === 1, h.slice(0, 12) + '… → ' + digests.size + ' 种结果');
}
{
  // 带参数/不带参数必须是两张不同的图（两档 NFT 的核心区别）
  const { card } = buildCard(H[0], 1);
  ok('带参数与不带参数是两张图', sha(renderSVG(H[0], card, true)) !== sha(renderSVG(H[0], card, false)));
  const withP = renderSVG(H[0], card, true), noP = renderSVG(H[0], card, false);
  const dTxt = card.dimension.D.toFixed(3);
  ok('带参数的图上印着维度数值', withP.indexOf('>' + dTxt + '<') >= 0, 'D=' + dTxt);
  ok('不带参数的图上没有维度数值', noP.indexOf('>' + dTxt + '<') < 0);
  ok('不带参数的图标明未引爆', noP.indexOf('NOT DETONATED') >= 0);
  ok('两档共用同一张底图', withP.indexOf('data:image/jpeg;base64,') >= 0
    && noP.indexOf('data:image/jpeg;base64,') >= 0);
}

console.log('\n[A2] card 与直接跑 bnbhash.derive 一致');
for (const h of H) {
  const { card, cardHash } = buildCard(h, 7);
  const d = B.derive(h);
  ok('uInt 逐项相同', JSON.stringify(card.uInt) === JSON.stringify(d.uInt), h.slice(0, 12) + '…');
  ok('tier 相同', card.tier.id === d.tier.id);
  ok('cardHash 稳定', buildCard(h, 7).cardHash === cardHash, cardHash.slice(0, 14) + '…');
  ok('cardHash 与 blockNumber 无关', buildCard(h, 999999).cardHash === cardHash);
  ok('card 带稀有度', card.rarity != null && card.rarity.index >= 0 && card.rarity.index <= 4,
    card.rarity ? card.rarity.name + ' 档' : '(缺失)');
  ok('原生卡带 cardShape=3（结构字段；cardHash 仍是 uInt 整数基）', card.cardShape === 3);
  ok('结局在合约 OUTCOMES 内', OUTCOME_ORDER.indexOf(card.outcome.id) === card.outcome.index,
    card.outcome.id + ' → ' + card.outcome.index);
}

console.log('\n[A5/A7] 签名摘要绑死 chainId + 合约地址');
{
  /* 基线默认 v1：进程外带进来的 ARCBANG_SIG_V2=1 不能把改前向量打红。
     v2 用例在下面同进程内自己设/清。 */
  delete process.env.ARCBANG_SIG_V2;

  const w = new Wallet('0x' + '11'.repeat(32));
  const CA = '0x1111111111111111111111111111111111111111';
  const CB = '0x2222222222222222222222222222222222222222';
  const { cardHash } = buildCard(H[0], 42);
  const dl = 1900000000;

  const dA = digestOf(97, CA, H[0], 42, 9, 0, cardHash, dl);
  const dB = digestOf(97, CB, H[0], 42, 9, 0, cardHash, dl);
  const dMain = digestOf(56, CA, H[0], 42, 9, 0, cardHash, dl);
  ok('换合约地址摘要就变', dA !== dB);
  ok('换 chainId 摘要就变', dA !== dMain);
  ok('改 cardHash 摘要就变', dA !== digestOf(97, CA, H[0], 42, 9, 0, H[1], dl));
  ok('改 deadline 摘要就变', dA !== digestOf(97, CA, H[0], 42, 9, 0, cardHash, dl + 1));
  ok('改 outcome 摘要就变', dA !== digestOf(97, CA, H[0], 42, 8, 0, cardHash, dl));
  // 稀有度直接决定价格和发币量，它必须在摘要里 —— 不然谁都能按 D 档的价买 S 档
  ok('改 rarity 摘要就变', dA !== digestOf(97, CA, H[0], 42, 9, 4, cardHash, dl));

  // EIP-191 往返：合约侧要用同一套前缀才能 ecrecover 出同一个地址
  const sig = w.signMessageSync(getBytes(dA));
  ok('签名能还原出签名者', verifyMessage(getBytes(dA), sig).toLowerCase() === w.address.toLowerCase());
  ok('拿 B 合约的摘要验不过', verifyMessage(getBytes(dB), sig).toLowerCase() !== w.address.toLowerCase());

  /* ---- 改前已知向量：v1 必须逐字节钉死。现役测试网 §7 两组 + 造物合成向量。 ---- */
  const liveBang = digestOf(
    97, '0xf8b2033cfdec1a52f1a31ce61ee092a688eb7740',
    '0xca00b6c467818ea0fafdc417f9cb902ea9db297e1ef0ad3961997f621adfce4c',
    60991179, 9, 0,
    '0xf0519ad4ab2556955f9aedb6527f98739f4e1ba090eecb0d3f5686edf79d240a',
    1787355972
  );
  ok('v1 bangSigned 与改前已知向量逐字节相同',
    liveBang === '0xde18555e0bf46fb64f9daa4052a57d3effbc164d637e749f70e753caccd22ad6',
    liveBang);
  const liveIv = interveneDigest(
    97, '0xf8b2033cfdec1a52f1a31ce61ee092a688eb7740',
    12n,
    '0x59bd8e1c2080f8e4b2020486fa0d1e48cbae8466585193642696d6c48c910315',
    '0xf5f46edc172b2888e6793443f9e8dcaef6b5d448305a2ddf6a5c8ce24da6a072',
    9, 0, 10362000000000000000000n, 1787354216,
    '0x12c634fe761c5b61ad75a44ae7855d90d6489372bd44727312ae4d77a635e644'
  );
  ok('v1 intervene 与改前已知向量逐字节相同',
    liveIv === '0x18d6d1f0e3f79df0fb6608fe3ce115191e0a7612f7ce63522dc5769a5673af35',
    liveIv);
  const liveCraft = craftDigest(
    1n, '0x1111111111111111111111111111111111111111',
    '0x' + 'ab'.repeat(32), 126197324n,
    opsHashOf('0x0100000005'), '0x' + 'cd'.repeat(32),
    9, 0, 12000n * (10n ** 18n), 1900000000n
  );
  ok('v1 craftDigest 与改前合成向量逐字节相同',
    liveCraft === '0x1b388189f0b8841f2174aba4e9c6a9d81f33c82ea0161e13a96059ea53d9dea1',
    liveCraft);
  const v1bangWithMinter = digestOf(97, CA, H[0], 42, 9, 0, cardHash, dl, '0x' + '22'.repeat(20));
  ok('v1 即使传入 minter 摘要也不变', v1bangWithMinter === dA);

  /* ---- 同进程内打开 v2：摘要末尾多一个 address，换地址就变 ---- */
  process.env.ARCBANG_SIG_V2 = '1';
  const M1 = '0x' + '22'.repeat(20);
  const M2 = '0x' + '33'.repeat(20);
  const v2b = digestOf(97, CA, H[0], 42, 9, 0, cardHash, dl, M1);
  const v2b2 = digestOf(97, CA, H[0], 42, 9, 0, cardHash, dl, M2);
  ok('v2 bang 摘要与 v1 不同（含了铸造人地址）', v2b !== dA);
  ok('v2 bang 换 minter 摘要就变', v2b !== v2b2);
  ok('v2 bang 同一 minter 稳定', v2b === digestOf(97, CA, H[0], 42, 9, 0, cardHash, dl, M1));
  const v2sig = w.signMessageSync(getBytes(v2b));
  ok('v2 bang 签名能还原出签名者',
    verifyMessage(getBytes(v2b), v2sig).toLowerCase() === w.address.toLowerCase());
  ok('v2 bang 拿另一个 minter 的摘要验不过',
    verifyMessage(getBytes(v2b2), v2sig).toLowerCase() !== w.address.toLowerCase());

  const OH = opsHashOf('0x0100000005');
  const A32 = '0x' + 'aa'.repeat(32), B32 = '0x' + 'bb'.repeat(32);
  delete process.env.ARCBANG_SIG_V2;
  const v1i = interveneDigest(97, CA, 7n, A32, B32, 9, 0, 123n, dl, OH);
  process.env.ARCBANG_SIG_V2 = '1';
  const v2i = interveneDigest(97, CA, 7n, A32, B32, 9, 0, 123n, dl, OH, M1);
  const v2i2 = interveneDigest(97, CA, 7n, A32, B32, 9, 0, 123n, dl, OH, M2);
  ok('v2 intervene 摘要与 v1 不同', v2i !== v1i);
  ok('v2 intervene 换 minter 摘要就变', v2i !== v2i2);

  delete process.env.ARCBANG_SIG_V2;
  const v1c = craftDigest(1n, CA, A32, 1n, OH, B32, 9, 0, 1n, dl);
  process.env.ARCBANG_SIG_V2 = '1';
  const v2c = craftDigest(1n, CA, A32, 1n, OH, B32, 9, 0, 1n, dl, M1);
  const v2c2 = craftDigest(1n, CA, A32, 1n, OH, B32, 9, 0, 1n, dl, M2);
  ok('v2 craft 摘要与 v1 不同', v2c !== v1c);
  ok('v2 craft 换 minter 摘要就变', v2c !== v2c2);

  /* 请求体校验：v2 必填合法地址，v1 忽略 */
  delete process.env.ARCBANG_SIG_V2;
  ok('v1 minterFromBody 忽略缺省', minterFromBody({}).ok === true && minterFromBody({}).minter === null);
  ok('v1 minterFromBody 忽略非法', minterFromBody({ minter: 'zz' }).ok === true);
  process.env.ARCBANG_SIG_V2 = '1';
  ok('v2 缺 minter 拒', minterFromBody({}).ok === false && /minter/.test(minterFromBody({}).error));
  ok('v2 非法 minter 拒并给人话',
    minterFromBody({ minter: '0xzz' }).ok === false
    && /十六进制/.test(minterFromBody({ minter: '0xzz' }).error));
  const mixed = minterFromBody({ minter: '0xAa' + 'bb'.repeat(19) });
  ok('v2 合法 minter 收下并转小写',
    mixed.ok && mixed.minter === ('0xaabb' + 'bb'.repeat(18)));
  ok('v2 零地址拒',
    minterFromBody({ minter: '0x' + '00'.repeat(20) }).ok === false
    && /零地址/.test(minterFromBody({ minter: '0x' + '00'.repeat(20) }).error));
  ok('v2 非字符串 minter 拒', minterFromBody({ minter: { toString: () => M1 } }).ok === false);
  ok('v2 请求体 sigV2/cardShape 不影响开关（只认 env）',
    minterFromBody({ sigV2: false, cardShape: 2, ARCBANG_SIG_V2: '0' }).ok === false);
  let threwNoMinter = false;
  try { digestOf(97, CA, H[0], 42, 9, 0, cardHash, dl); }
  catch (e) { threwNoMinter = /minter/.test(e.message); }
  ok('v2 组摘要缺 minter 直接抛，不把 null 编成零地址', threwNoMinter);

  /* 后面 HTTP 基线按 v1 跑；v2 HTTP 用例自己再设。 */
  delete process.env.ARCBANG_SIG_V2;
}

console.log('\n[跨进程] 同一哈希在新进程里出的图必须还是同一张');
{
  const { execFileSync } = require('child_process');
  const script = 'const {buildCard}=require("' + path.join(__dirname, 'card.js').replace(/\\/g, '/') + '");'
    + 'const {renderSVG}=require("' + path.join(__dirname, 'art.js').replace(/\\/g, '/') + '");'
    + 'const h="' + H[0] + '";const{card}=buildCard(h,1);'
    + 'process.stdout.write(require("crypto").createHash("sha256").update(renderSVG(h,card,true)).digest("hex"));';
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim();
  const { card } = buildCard(H[0], 1);
  ok('新进程结果一致', out === sha(renderSVG(H[0], card, true)), out.slice(0, 16) + '…');
}

console.log('\n[干预] 费用只能服务端算，结果必须和引擎一致');
/* 用「把全部参数推回我们宇宙的默认值」当测试用例：它必然把任何死宇宙救活，
   所以 rescued 那条断言是确定的，不用碰运气去找一组刚好能救活的位移。 */
const DEFAULTS = {};
P.paramsFor(B.MODULES_ON).forEach((d) => { DEFAULTS[d.key] = d.default; });
const IV = (function () {
  const { card, cardHash } = buildCard(H[2], 1);
  return { base: card, baseHash: cardHash, r: evaluate(card, DEFAULTS) };
})();
{
  const base = IV.base, r = IV.r;
  ok('基准宇宙确实是死的', base.outcome.id !== 'OBSERVERS_POSSIBLE',
    base.outcome.id + ' · D=' + (base.dimension && base.dimension.D));
  ok('干预费用是正数', BigInt(r.costBang) > 0n, (BigInt(r.costBang) / 10n ** 18n) + ' BANG');
  // 合约烧的是 wei，签名里那个数必须已经是 wei —— 签成整枚会少烧 10¹⁸ 倍
  ok('费用是 wei 口径', BigInt(r.costBang) % (10n ** 18n) === 0n && BigInt(r.costBang) >= 10n ** 18n);

  // 结局/稀有度不能是 evaluate 自己编的，必须是引擎对这组参数的判定
  const re = E.simulate(r.card.params, { modules: B.MODULES_ON, register: false });
  ok('新 card 的 outcome 与引擎一致', re.outcome.id === r.card.outcome.id
    && OUTCOME_ORDER.indexOf(re.outcome.id) === r.card.outcome.index,
    base.outcome.id + ' → ' + r.card.outcome.id);
  const reD = (re.calc && re.calc.dims && re.calc.dims.D != null) ? re.calc.dims.D : null;
  ok('新 card 的 rarity 与引擎一致', rarityOf(re.outcome.id, reD) === r.card.rarity.index,
    r.card.rarity.name + ' 档 · D=' + reD);
  ok('救活了就盖 rescued 章', r.card.intervention.rescued === true
    && r.card.outcome.id === 'OBSERVERS_POSSIBLE');
  ok('干预后 cardHash 必须变', r.cardHash !== IV.baseHash, r.cardHash.slice(0, 14) + '…');
  ok('干预可复现', evaluate(base, DEFAULTS).cardHash === r.cardHash);
  ok('新签发的干预卡 cardShape=3', r.card.cardShape === 3 && CARD_SHAPE === 3 && IV_SHAPE === 3);

  // 推得越远越贵。这条塌了就说明费用没跟着位移走，等于可以白嫖
  const u0 = P.toUnit('alpha', base.params.alpha);
  const dir = u0 > 0.5 ? -1 : 1;
  const near = evaluate(base, { alpha: P.fromUnit('alpha', u0 + dir * 0.02) });
  const far = evaluate(base, { alpha: P.fromUnit('alpha', u0 + dir * 0.08) });
  ok('推得越远越贵', BigInt(far.costBang) > BigInt(near.costBang),
    (BigInt(near.costBang) / 10n ** 18n) + ' → ' + (BigInt(far.costBang) / 10n ** 18n) + ' BANG');
  ok('一个参数都没动就报错', (function () {
    try { evaluate(base, { alpha: base.params.alpha }); return false; } catch (e) { return true; }
  })());
  ok('参数名不存在就报错', (function () {
    try { evaluate(base, { notAParam: 1 }); return false; } catch (e) { return true; }
  })());

  /* ---------------- 相对档位（ops）：客户端只说推谁、往哪、几格 ----------------
     这条路存在的唯一理由是「一格有多远」不能发到浏览器里去（见 intervene.js 文件头）。
     所以要盯的是：它算出来的东西和绝对值那条路**逐位一样**——不一样就意味着
     沙盒里看到的宇宙和真烧币时签的宇宙是两个，那比泄露半径还糟。 */
  {
    const ops = [{ key: 'alpha', dir: -1, steps: 3 }, { key: 'As', dir: 1, steps: 2 }];
    const byOps = evaluate(base, null, ops);
    // 同一串 ops 自己先算一遍绝对值，再当 deltas 喂回去
    const after = applyOps(base.params, ops);
    const asDeltas = {};
    Object.keys(after).forEach((k) => { if (after[k] !== base.params[k]) asDeltas[k] = after[k]; });
    const byDeltas = evaluate(base, asDeltas);
    ok('ops 与等价绝对值算出同一份参数',
      JSON.stringify(byOps.card.params) === JSON.stringify(byDeltas.card.params),
      'alpha ' + base.params.alpha.toExponential(4) + ' → ' + byOps.card.params.alpha.toExponential(4));
    ok('ops 与等价绝对值算出同一个 cardHash', byOps.cardHash === byDeltas.cardHash, byOps.cardHash.slice(0, 14) + '…');
    ok('ops 与等价绝对值算出同一份费用', byOps.costBang === byDeltas.costBang,
      (BigInt(byOps.costBang) / 10n ** 18n) + ' BANG');
    ok('ops 真的动了参数', byOps.card.params.alpha !== base.params.alpha && byOps.card.params.As !== base.params.As);
    // 推得多的那次必须更贵：不然"格数"和收费就脱钩了
    ok('ops 推得越多格越贵',
      BigInt(evaluate(base, null, [{ key: 'alpha', dir: -1, steps: 6 }]).costBang)
      > BigInt(evaluate(base, null, [{ key: 'alpha', dir: -1, steps: 2 }]).costBang));

    ok('两种入参同时给就报错', (function () {
      try { evaluate(base, asDeltas, ops); return false; } catch (e) { return /只能给一个/.test(e.message); }
    })());
    ok('deltas 与 ops 都不给也报错', (function () {
      try { evaluate(base, null, null); return false; } catch (e) { return true; }
    })());
    ok('ops 里的参数名不存在就报错', (function () {
      try { evaluate(base, null, [{ key: 'notAParam', dir: 1, steps: 1 }]); return false; } catch (e) { return true; }
    })());
    ok('dir 不是 ±1 就报错', (function () {
      try { evaluate(base, null, [{ key: 'alpha', dir: 0, steps: 1 }]); return false; } catch (e) { return true; }
    })());
    ok('steps 不是正整数就报错', (function () {
      try { evaluate(base, null, [{ key: 'alpha', dir: 1, steps: 1.5 }]); return false; } catch (e) { return true; }
    })());
    ok('steps 大到能拖死 CPU 就报错', (function () {
      try { evaluate(base, null, [{ key: 'alpha', dir: 1, steps: 1e9 }]); return false; } catch (e) { return true; }
    })());
    /* 一格一格地算，不许把 N 格并成一次位移：粒子代数是整数参数，
       一格小到被取整吃掉，所以它推多少格都不该动。并起来算就会在第 N 格突然跳一档，
       和玩家点 N 下看到的（那颗按钮一直没反应）对不上。 */
    ok('整数参数推多少格都还是推不动',
      applyOps(base.params, [{ key: 'generations', dir: 1, steps: 30 }]).generations === base.params.generations,
      'N_gen = ' + base.params.generations);
    ok('整数参数一格都没动就报 NO_MOVE', (function () {
      try { evaluate(base, null, [{ key: 'generations', dir: 1, steps: 3 }]); return false; }
      catch (e) { return e.code === 'NO_MOVE'; }
    })());
  }

  /* ---------------- 位移上链：只用 blockHash 和 opsHex 就能把这个宇宙算回来 ----------------

     这一段是 ops 存在的**全部理由**，也是整个自检里最要紧的一条。

     在 ops 之前，一次干预在链上留下的只有 cardOf[id]（32 字节不可逆指纹）、
     新结局、新稀有度和销毁量 —— 「推了哪几个参数、各推到哪」一个字都不在链上，
     它只躺在这台机器的 .store 里。那份存档一丢，那枚 NFT 的参数就永远算不回来了；
     开源代码救不了，因为缺的是**输入**不是代码。
     而这个项目的价值叙事是「这个宇宙我烧了 X 枚币救回来的」——
     那句话不能只有服务器一个人能作证。

     所以下面这几条断言扮演的是**一个什么都没有的陌生人**：
     他手上只有链上那个 blockHash、链上那段 ops，和这个开源仓库。
     没有 .store，没有 card，没有 evaluate 的返回值。
     他算出来的 cardHash 必须和干预时签的那个**逐位相同** ——
     一位都不能差，因为链上认的就是那 32 个字节。 */
  {
    const opsHex = r.opsHex;
    ok('干预返回了 opsHex', typeof opsHex === 'string' && /^0x[0-9a-f]+$/.test(opsHex),
      opsHex ? (opsHex.length - 2) / 2 + ' 字节 / ' + (opsHex.length - 2) / 10 + ' 条' : '(无)');
    // 合约只验这两条（它不解析内容），所以服务端发出去的必须先过这两关
    ok('opsHex 非空且长度是 5 字节的整数倍', opsHex.length > 2 && (opsHex.length - 2) % 10 === 0);

    /* ↓↓↓ 复算。从这里到断言为止，只用到 H[2]（blockHash）和 opsHex ↓↓↓ */
    const { card: nat } = buildCard(H[2], null);          // 区块哈希 → 原生宇宙，纯函数
    const back = applyOpsHex(nat.params, opsHex);         // 按 ops 把参数搬到位
    const sim = E.simulate(back, { modules: B.MODULES_ON, register: false });
    const idx = OUTCOME_ORDER.indexOf(sim.outcome.id);
    const D = (sim.calc && sim.calc.dims && sim.calc.dims.D != null) ? sim.calc.dims.D : null;
    const rar = rarityOf(sim.outcome.id, D);
    const backHash = cardHashOf(H[2], back, idx, rar);
    /* ↑↑↑ 到此为止 ↑↑↑ */

    ok('复算出的参数与干预时逐位相同',
      JSON.stringify(back) === JSON.stringify(r.card.params));
    ok('复算出的结局与稀有度一致',
      idx === r.card.outcome.index && rar === r.card.rarity.index,
      sim.outcome.id + ' · ' + ['S', 'A', 'B', 'C', 'D'][rar]);
    ok('★ 只用 blockHash + opsHex 复算出的 cardHash 与干预时逐位相同 —— 服务端没了也能重现',
      backHash === r.cardHash, r.cardHash.slice(0, 18) + '…');

    /* 量化必须发生在**计算之前**：链上记的是量化后的位置，服务端也必须拿这个数去模拟。
       要是先算完再回头四舍五入写进 ops，两边就差那么一点点 ——
       平时看不出来，但只要有参数落在某道门的临界点附近，复算的人会得到另一个结局，
       然后合理地认为服务端撒了谎。这条断言守的就是那个顺序。 */
    ok('ops 记的位置就是服务端实际用的位置（量化在前，不是算完再取整）',
      decodeOps(opsHex).every((e) => quantizeUnit(P.toUnit(e.key, r.card.params[e.key])) === e.unitInt));
    ok('ops 按参数下标升序、下标都认得',
      (function () {
        const list = decodeOps(opsHex);
        return list.every((e, i) => (i === 0 || list[i - 1].index < e.index) && PARAM_KEYS[e.index] === e.key);
      })(),
      decodeOps(opsHex).map((e) => e.key).join(','));

    // ops 真的盖住了位移：改一个刻度，复算出来的宇宙就是另一个
    ok('ops 改一个刻度就复算出另一个 cardHash', (function () {
      const list = decodeOps(opsHex);
      list[0].unitInt = list[0].unitInt > 0 ? list[0].unitInt - 1 : 1;
      const alt = applyOpsHex(nat.params, encodeOps(list));
      const s2 = E.simulate(alt, { modules: B.MODULES_ON, register: false });
      const i2 = OUTCOME_ORDER.indexOf(s2.outcome.id);
      const d2 = (s2.calc && s2.calc.dims && s2.calc.dims.D != null) ? s2.calc.dims.D : null;
      return cardHashOf(H[2], alt, i2, rarityOf(s2.outcome.id, d2)) !== r.cardHash;
    })());

    /* 第二次干预也必须自足。ops 记的是**绝对位置**而不是位移量，基准又固定取原生宇宙，
       所以最后那一笔交易的 ops 就是完整答案 —— 复算的人不用把前面几笔翻出来累加。
       （记位移量的话，漏掉中间任何一笔，后面全错。） */
    const r2 = evaluate(r.card, { alpha: P.fromUnit('alpha', P.toUnit('alpha', r.card.params.alpha) * 0.9) });
    const back2 = applyOpsHex(nat.params, r2.opsHex);
    const sim2 = E.simulate(back2, { modules: B.MODULES_ON, register: false });
    const d2 = (sim2.calc && sim2.calc.dims && sim2.calc.dims.D != null) ? sim2.calc.dims.D : null;
    ok('连着干预两次之后，最后那笔 ops 仍然只用 blockHash 就能复算',
      cardHashOf(H[2], back2, OUTCOME_ORDER.indexOf(sim2.outcome.id), rarityOf(sim2.outcome.id, d2)) === r2.cardHash,
      decodeOps(r2.opsHex).length + ' 条位移');
    ok('第二次的 ops 覆盖了第一次动过的参数（否则得翻历史才算得回来）',
      decodeOps(r.opsHex).every((e) => decodeOps(r2.opsHex).some((x) => x.index === e.index)));
  }

  /* 编解码本身：链上的字节改不了，读出一堆似是而非的东西比直接报错危险得多，
     所以 decodeOps 宁可炸也不许"尽力而为地"猜。 */
  {
    ok('编码后再解码回到原样', (function () {
      const src = [{ key: PARAM_KEYS[2], unitInt: 0 }, { key: PARAM_KEYS[0], unitInt: OPS_SCALE }];
      const d = decodeOps(encodeOps(src));
      return d.length === 2 && d[0].index === 0 && d[0].unitInt === OPS_SCALE
        && d[1].index === 2 && d[1].unitInt === 0;
    })());
    ok('编码自动按下标升序（合约那边和复算的人都指望这个顺序）',
      decodeOps(encodeOps([{ index: 9, unitInt: 1 }, { index: 3, unitInt: 2 }])).map((e) => e.index).join(',') === '3,9');
    ok('同一个参数出现两次就报错（"最终位置"不能有两个答案）', (function () {
      try { encodeOps([{ index: 3, unitInt: 1 }, { index: 3, unitInt: 2 }]); return false; } catch (e) { return true; }
    })());
    ok('unit 刻度超过 1e9 就报错', (function () {
      try { encodeOps([{ index: 0, unitInt: OPS_SCALE + 1 }]); return false; } catch (e) { return true; }
    })());
    ok('长度不是 5 的倍数解不出来（合约也会 BadOps）', (function () {
      try { decodeOps('0x03' + '1dcd65'); return false; } catch (e) { return true; }
    })());
    ok('空 ops 解不出来', (function () {
      try { decodeOps('0x'); return false; } catch (e) { return true; }
    })());
    ok('参数下标不存在就报错（不许"尽力而为"地猜）', (function () {
      try { decodeOps('0x' + 'ff' + '00000000'); return false; } catch (e) { return true; }
    })());
    ok('没按升序的 ops 解不出来', (function () {
      try { decodeOps('0x' + '05' + '00000000' + '01' + '00000000'); return false; } catch (e) { return true; }
    })());
  }

  /* ---------------- 干预/造物卡指纹：3-2 String vs 3-3 整数基 ----------------
     钉死给开源引擎仓对照。输入不依赖 derive/simulate，只测序列化本身。 */
  {
    const VEC_H = H[0];
    const VEC_P = { alpha: 0.007, omegaLambda: 0.685, generations: 3 };
    const H32 = '0x4e834e0608630516257d85a3d970033469eea7c5561f6a15f44e5d42cc2af822';
    const H33 = '0xd88d1f23c4caa77f2c2d63789dbb6df1212cd2339946f181cff0c92c1a646087';
    ok('3-2 固定向量（String(float) 旧算法）',
      cardHashOf(VEC_H, VEC_P, 9, 0, 2) === H32, cardHashOf(VEC_H, VEC_P, 9, 0, 2));
    ok('3-3 固定向量（uint32 unitInt 新算法）',
      cardHashOf(VEC_H, VEC_P, 9, 0, 3) === H33, cardHashOf(VEC_H, VEC_P, 9, 0, 3));
    ok('缺省 shape 走 3', cardHashOf(VEC_H, VEC_P, 9, 0) === H33);
    ok('同一输入 3-2 与 3-3 指纹不同', H32 !== H33);
    const ulp = { alpha: 0.007 + Number.EPSILON, omegaLambda: 0.685, generations: 3 };
    ok('3-2：1 ulp 就换指纹（旧病）',
      cardHashOf(VEC_H, ulp, 9, 0, 2) !== H32);
    ok('3-3：1 ulp 仍同一指纹（量化到同一 uint32）',
      cardHashOf(VEC_H, ulp, 9, 0, 3) === H33);
    const { card: nat0 } = buildCard(H[0], 1);
    /* 3-2 的原生卡指纹**不钉死**：它把 String(float) 直接进哈希，simulate 里 Math.pow 在
       Windows 与 Linux 之间可能差 1 ulp（旧病，3-3 用整数基治好了）。上面那条固定向量测的是
       序列化本身（输入不经 simulate），能钉；这里经过 simulate，钉死的值只在生成它的平台上成立 ——
       2026-09-02 部署时在服务器（Linux）上就是这一条红了，本地（Windows）全绿。
       只验它确实是一个 3-2 指纹（格式对、与 3-3 不同、同一进程内稳定）。 */
    {
      const h32a = cardHashOf(H[0], nat0.params, nat0.outcome.index, nat0.rarity.index, 2);
      const h32b = cardHashOf(H[0], nat0.params, nat0.outcome.index, nat0.rarity.index, 2);
      ok('H[0] 原生卡 3-2 指纹：格式对、进程内稳定、与 3-3 不同（跨平台可能差 1 ulp，不钉死）',
        /^0x[0-9a-f]{64}$/.test(h32a) && h32a === h32b
        && h32a !== '0xe6d5cfd965a290b7c0200f63a9a8f50449cd0a92416a35b4e60e5095325fff43', h32a);
    }
    ok('H[0] 原生参数 3-3 钉死',
      cardHashOf(H[0], nat0.params, nat0.outcome.index, nat0.rarity.index, 3)
      === '0xe6d5cfd965a290b7c0200f63a9a8f50449cd0a92416a35b4e60e5095325fff43');
    ok('原生 cardHash 仍是 uInt 基，不等于干预指纹',
      buildCard(H[0], 1).cardHash !== cardHashOf(H[0], nat0.params, nat0.outcome.index, nat0.rarity.index, 3));
    const oldCard = {
      blockHash: VEC_H, params: VEC_P, outcome: { index: 9 }, rarity: { index: 0 }
    };
    ok('缺 cardShape 的老卡按 shape=2 验', cardHashFromCard(oldCard) === H32);
    ok('卡上 cardShape=3 按整数基验',
      cardHashFromCard(Object.assign({}, oldCard, { cardShape: 3 })) === H33);
  }

  /* 上面那条 ★ 只证明了**一个**宇宙能复现。真正要守的是"任何一枚 NFT 都能"，
     而复现能不能成立取决于参数本身的性质：
       · 对数刻度的参数（α、A_s…）要经 log/pow 往返，量化误差会被放大；
       · 整数参数（粒子代数）在 normalize 里会被四舍五入，量化前后必须落回同一个整数；
       · 顶到取值边界（unit=0 或 1）的参数，fromUnit 有特例分支。
     所以这里扫一批随机哈希 × 随机位移，把这几类都覆盖到。
     只要有一例对不上，就说明存在一类 NFT 是"服务器没了就算不回来"的
     —— 而那正是加 ops 要解决的问题本身。 */
  {
    const KEYS = P.paramsFor(B.MODULES_ON).map((d) => d.key);
    let tried = 0, mismatch = null;
    for (let i = 0; i < 40 && !mismatch; i++) {
      const h = B.keccak256('ops-replay-' + i);
      const { card } = buildCard(h, null);
      const deltas = {};
      for (let j = 0; j <= i % 5; j++) {
        // 取模挑参数和目标位置：伪随机但**每次跑都一样**，出了问题能原地复现
        const key = KEYS[(i * 7 + j * 3) % KEYS.length];
        deltas[key] = P.fromUnit(key, ((i * 13 + j * 29) % 1000) / 1000);
      }
      let rr;
      try { rr = evaluate(card, deltas); } catch (e) { continue; }   // 一个都没推动，跳过
      tried++;
      const back = applyOpsHex(card.params, rr.opsHex);
      const sm = E.simulate(back, { modules: B.MODULES_ON, register: false });
      const dd = (sm.calc && sm.calc.dims && sm.calc.dims.D != null) ? sm.calc.dims.D : null;
      const ch = cardHashOf(h, back, OUTCOME_ORDER.indexOf(sm.outcome.id), rarityOf(sm.outcome.id, dd));
      if (ch !== rr.cardHash) mismatch = h + ' / ' + Object.keys(deltas).join(',');
    }
    ok('随机 ' + tried + ' 组哈希×位移，每一组都只用 blockHash + opsHex 复算出同一个 cardHash',
      !mismatch && tried > 20, mismatch ? '第一处不一致：' + mismatch : tried + ' 组');
  }

  /* 提示（下一格该推谁）也在服务端算：爬山要试着推一格，同样离不开半径表。
     返回值里**不许**出现推完之后的参数——那等于把这一格的长度直接送出去。 */
  {
    const s = suggestNext(base);
    ok('服务端能给出下一格该推谁', !!(s && s.key && (s.dir === 1 || s.dir === -1)),
      s ? s.key + ' ' + (s.dir > 0 ? '+1' : '-1') + '（试了 ' + s.tried + ' 次模拟）' : '(null)');
    ok('提示里不带推完的参数/模拟结果（带了就等于泄露一格有多长）',
      !!s && s.params === undefined && s.sim === undefined
      && Object.keys(s).every((k) => ['key', 'dir', 'gain', 'tried', 'narrowed', 'outcome', 'fixes'].indexOf(k) >= 0),
      s ? Object.keys(s).join(',') : '');
  }

  // 干预后的图必须一眼能认出来（用户要求"救活的一眼看出来"）
  const svgIv = renderSVG(base.blockHash, r.card, true);
  const svgBase = renderSVG(base.blockHash, base, true);
  ok('干预后的图与原生的图不同', sha(svgIv) !== sha(svgBase));
  ok('救活的图上有 RESCUED 印记', svgIv.indexOf('RESCUED') >= 0 && svgBase.indexOf('RESCUED') < 0);
  ok('干预出图仍是纯函数', sha(renderSVG(base.blockHash, JSON.parse(JSON.stringify(r.card)), true)) === sha(svgIv));
}

console.log('\n[摘要] 干预签名与合约 intervene() 逐字段对齐');
{
  const CA = '0x1111111111111111111111111111111111111111';
  const A = IV.baseHash, Bh = IV.r.cardHash;
  const OH = opsHashOf(IV.r.opsHex);
  const d0 = interveneDigest(97, CA, 7n, A, Bh, 9, 0, 123n, 1900000000, OH);
  ok('换 tokenId 摘要就变', d0 !== interveneDigest(97, CA, 8n, A, Bh, 9, 0, 123n, 1900000000, OH));
  // 摘要里的 oldCardHash 就是链上的 cardOf[id]：它变了旧签名才会失效，否则能重放
  ok('换 oldCardHash 摘要就变', d0 !== interveneDigest(97, CA, 7n, Bh, Bh, 9, 0, 123n, 1900000000, OH));
  ok('换费用摘要就变', d0 !== interveneDigest(97, CA, 7n, A, Bh, 9, 0, 124n, 1900000000, OH));
  ok('换 chainId 摘要就变', d0 !== interveneDigest(56, CA, 7n, A, Bh, 9, 0, 123n, 1900000000, OH));
  ok('换合约地址摘要就变', d0 !== interveneDigest(97, '0x2222222222222222222222222222222222222222', 7n, A, Bh, 9, 0, 123n, 1900000000, OH));
  ok('换 deadline 摘要就变', d0 !== interveneDigest(97, CA, 7n, A, Bh, 9, 0, 123n, 1900000001, OH));
  /* 合约不解析 ops，所以「链上那段位移记录是服务端认过的那一份」这件事，
     除了这道签名之外没有任何东西在担保。opsHash 一旦没进摘要，
     调用者就能把 ops 换成任意内容照样上链 —— "任何人都能重放"当场变成一句空话。 */
  ok('换 opsHash 摘要就变（ops 被签名盖住的唯一证据）',
    d0 !== interveneDigest(97, CA, 7n, A, Bh, 9, 0, 123n, 1900000000, opsHashOf('0x0300000000')));
  /* 摘要里放的是定长的 keccak256(ops) 而不是变长的 ops 本身：
     abi.encode 一个变长 bytes 会插入偏移和长度，摘要的编码长度就跟着 ops 变长，
     两边（合约与服务端）对齐时多一处可以错位的地方。 */
  ok('ops 长短不同，摘要长度不变（放的是哈希不是 ops 本身）',
    interveneDigest(97, CA, 7n, A, Bh, 9, 0, 123n, 1900000000, opsHashOf('0x0300000000')).length
    === interveneDigest(97, CA, 7n, A, Bh, 9, 0, 123n, 1900000000,
      opsHashOf('0x' + '0300000000'.repeat(40))).length);
}

console.log('\n[HTTP] /api/intervene 与按 cardHash 出图');
/* 直接调 index.js 的 handle()，不起真端口：起端口要挑没被占的口、等监听、再收尾，
   测试会变成看天吃饭。缓存和存档都指到临时目录，免得自检往真的存档里写垃圾。 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bnbbang-selftest-'));
process.env.ARCBANG_CONTRACT = '0x1111111111111111111111111111111111111111';
process.env.ARCBANG_SIGNER_KEY = '0x' + '11'.repeat(32);
process.env.ARCBANG_CACHE = path.join(TMP, 'cache');
process.env.ARCBANG_STORE = path.join(TMP, 'store');
/* 链身份必须显式。自检自己选测试网，不是服务端缺省偷偷落到 97。 */
process.env.ARCBANG_CHAIN_ID = process.env.ARCBANG_CHAIN_ID || '97';
process.env.ARCBANG_RPC = process.env.ARCBANG_RPC || 'https://bsc-testnet-rpc.publicnode.com';
process.env.ARCBANG_PUBLIC_BASE = process.env.ARCBANG_PUBLIC_BASE || 'https://x.test';
/* 金库地址也显式：生产代码不再带测试网默认。 */
process.env.ARCBANG_REFERRAL_VAULT = process.env.ARCBANG_REFERRAL_VAULT
  || '0x052e9c4bc320706e1bdb1bae618256f54b5ae4a5';
/* /api/token/<id> 是全站唯一读链上状态的端点，自检里不能真去打 RPC：
   测试网上没有这个合约地址，而且测试也不该看网络脸色。所以给 ethCall 挂一个可控的桩。

   **必须在 require('./index.js') 之前挂**：token.js 是在自己加载的那一刻
   `const { ethCall } = require('./chain.js')` 解构走的，等 index.js（进而 token.js）
   load 完再改 chainMod.ethCall，token.js 手里攥的还是原来那个函数，桩换不进去。
   blockByHash 原样不动 —— 末尾 C3 那条仍然要打真网。 */
const chainMod = require('./chain.js');
const realEthCall = chainMod.ethCall;
let ethCallStub = null;
/* opts 要原样透传：token.js 给 cardOf/burnedOn/rescueOf 传的是 {nullOnRevert:true}
   （合约上没有这三个函数时 revert 要当"链上没这回事"，不是当节点挂了）。
   桩把第三个参数吃掉的话，测出来的宽容行为是假的。 */
chainMod.ethCall = (to, data, opts) => (ethCallStub ? ethCallStub(to, data, opts) : realEthCall(to, data, opts));

const api = require('./index.js');
const { buildMetadata } = require('./token.js');   // 挂完桩再取，理由同上
const { CHAIN_ID, chainConfigErrors, rpcsForLogs } = chainMod;

ok('现役 cardShape / SHAPE 是 3', api.SHAPE === 3 && CARD_SHAPE === 3);

function call(method, url, body, headers) {
  return new Promise((resolve) => {
    const req = new (require('stream').Readable)({ read() { } });
    req.method = method;
    /* 限流按 IP 分桶，所以测限流的用例要能自己指定 X-Forwarded-For。
       不传就没有 headers —— 和原来一样，全部落进同一个 'i:unknown' 桶。 */
    if (headers) req.headers = headers;
    if (body != null) req.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.push(null);
    const res = {
      status: 0, hdr: {},
      writeHead(code, h) { this.status = code; this.hdr = h || {}; },
      /* Buffer 原样留着，别 String() —— 分享图（.png）发的是二进制，
         按 UTF-8 转成字符串会把字节改掉，PNG 魔数那几个字节首当其冲。
         其余端点发的都是字符串，行为不变。 */
      end(b) {
        resolve({
          status: this.status, hdr: this.hdr,
          body: b == null ? '' : (Buffer.isBuffer(b) ? b : String(b))
        });
      }
    };
    api.handle(req, res, new URL(url, 'http://localhost'))
      .catch((e) => resolve({ status: 500, hdr: {}, body: String(e && e.message) }));
  });
}

(async () => {
  {
    const h = await call('GET', '/api/health');
    const jh = h.status === 200 ? JSON.parse(h.body) : {};
    ok('/api/health 200', h.status === 200);
    ok('/api/health cardShape 报 3', jh.cardShape === 3, JSON.stringify(jh.cardShape));
    ok('/api/health 有 logRpcOk 字段（未启动探测时为 null）',
      'logRpcOk' in jh && (jh.logRpcOk === null || typeof jh.logRpcOk === 'boolean'),
      String(jh.logRpcOk));
    ok('缺 CHAIN_ID 启动检查报错',
      chainConfigErrors({ chainId: NaN, rpcs: ['https://bsc-dataseed.binance.org'] }).some((e) => /CHAIN_ID/.test(e)));
    ok('缺 RPC 启动检查报错',
      chainConfigErrors({ chainId: 56, rpcs: [] }).some((e) => /ARCBANG_RPC/.test(e)));
    ok('主网配测试网 RPC 启动检查报错',
      chainConfigErrors({ chainId: 56, rpcs: ['https://bsc-testnet-rpc.publicnode.com'] }).some((e) => /测试网地址/.test(e)));
    ok('测试网显式 97 + 自备 RPC 通过',
      chainConfigErrors({ chainId: 97, rpcs: ['https://bsc-testnet-rpc.publicnode.com'] }).length === 0);
    ok('主网缺 PUBLIC_BASE / INDEX_FROM / VAULT 启动检查报错',
      api.serverEnvErrors({
        chainId: 56, rpcs: ['https://bsc-dataseed.binance.org'],
        publicBase: '', indexFrom: '', referralVault: ''
      }).length >= 3);
    ok('主网配测试网金库默认地址报错',
      api.serverEnvErrors({
        chainId: 56, rpcs: ['https://bsc-dataseed.binance.org'],
        publicBase: 'https://bnbbang.com', indexFrom: '123',
        referralVault: '0x052e9c4bc320706e1bdb1bae618256f54b5ae4a5'
      }).some((e) => /测试网默认金库/.test(e)));
    ok('主网齐全配置通过',
      api.serverEnvErrors({
        chainId: 56, rpcs: ['https://bsc-dataseed.binance.org'],
        publicBase: 'https://bnbbang.com', indexFrom: '42000000',
        referralVault: '0x' + '11'.repeat(20)
      }).length === 0);
    const savedLog = process.env.ARCBANG_LOG_RPC;
    process.env.ARCBANG_LOG_RPC = 'http://127.0.0.1:8546';
    ok('rpcsForLogs 把 LOG_RPC 放在最前', rpcsForLogs()[0] === 'http://127.0.0.1:8546');
    if (savedLog === undefined) delete process.env.ARCBANG_LOG_RPC;
    else process.env.ARCBANG_LOG_RPC = savedLog;
  }

  const OLD = IV.baseHash;
  const r = await call('POST', '/api/intervene',
    { blockHash: H[2], tokenId: 7, oldCardHash: OLD, deltas: DEFAULTS });
  const j = r.status === 200 ? JSON.parse(r.body) : {};
  ok('/api/intervene 返回 200', r.status === 200, r.status === 200 ? '' : r.body.slice(0, 120));
  ok('返回 card / cardHash / costBang / deadline / sig 五样齐全',
    !!(j.card && j.cardHash && j.costBang && j.deadline && j.sig));
  /* ops 必须跟着回：前端要把它原样转发给合约。少了它这次干预的位移就上不了链，
     那枚 NFT 又退回"只有这台服务器知道自己长什么样"的状态。 */
  ok('返回 ops（前端原样转发给合约的位移记录）',
    typeof j.ops === 'string' && /^0x[0-9a-f]+$/.test(j.ops) && (j.ops.length - 2) % 10 === 0,
    j.ops ? (j.ops.length - 2) / 10 + ' 条' : '(无)');
  ok('端点回的 ops 与直接调 evaluate 算出的逐字节相同', j.ops === IV.r.opsHex);
  ok('返回的费用是正数', j.costBang && BigInt(j.costBang) > 0n,
    j.costBang ? (BigInt(j.costBang) / 10n ** 18n) + ' BANG' : '');
  ok('端点算出的 card 与直接调 evaluate 一致', j.cardHash === IV.r.cardHash);

  /* 签名必须是合约那套摘要签出来的。这条是整件事的地基：
     摘要错一个字段，链上就只会甩一个 BadSig，从签名本身看不出错在哪。 */
  if (j.sig) {
    const dg = interveneDigest(CHAIN_ID, process.env.ARCBANG_CONTRACT, 7n, OLD, j.cardHash,
      j.card.outcome.index, j.card.rarity.index, BigInt(j.costBang), j.deadline, opsHashOf(j.ops));
    ok('签名能用合约摘要还原出 signer',
      verifyMessage(getBytes(dg), j.sig).toLowerCase() === String(j.signer).toLowerCase(),
      j.signer);
    const bad = interveneDigest(CHAIN_ID, process.env.ARCBANG_CONTRACT, 8n, OLD, j.cardHash,
      j.card.outcome.index, j.card.rarity.index, BigInt(j.costBang), j.deadline, opsHashOf(j.ops));
    ok('换个 tokenId 就验不过', verifyMessage(getBytes(bad), j.sig).toLowerCase() !== String(j.signer).toLowerCase());
    /* 签的是**服务端发出去的那一段 ops**。改一个字节还能验过的话，调用者就能一手拿着
       合法签名、一手往链上写自己编的位移记录 —— 链上那段字节也就不值得信了。 */
    const flip = j.ops.slice(0, -1) + (j.ops.slice(-1) === '0' ? '1' : '0');
    const tampered = interveneDigest(CHAIN_ID, process.env.ARCBANG_CONTRACT, 7n, OLD, j.cardHash,
      j.card.outcome.index, j.card.rarity.index, BigInt(j.costBang), j.deadline, opsHashOf(flip));
    ok('ops 改一个字节就验不过（链上那段位移记录动不了）',
      verifyMessage(getBytes(tampered), j.sig).toLowerCase() !== String(j.signer).toLowerCase());
  }

  ok('新 card 落了盘', fs.existsSync(path.join(api.STORE_DIR, 'card-' + String(j.cardHash).toLowerCase() + '.json')));

  console.log('\n[摘要 v2 HTTP] /api/bang /intervene 读 minter');
  {
    const MINTER = '0x' + '22'.repeat(20);
    const saved = process.env.ARCBANG_SIG_V2;
    process.env.ARCBANG_SIG_V2 = '1';

    const bangMiss = await call('POST', '/api/bang', { blockHash: H[0] });
    const bangMissJ = bangMiss.status === 400 ? JSON.parse(bangMiss.body) : {};
    ok('v2 /api/bang 缺 minter → 400 人话',
      bangMiss.status === 400 && /minter/.test(String(bangMissJ.error)),
      bangMiss.status + ' ' + String(bangMiss.body).slice(0, 80));

    const bangBad = await call('POST', '/api/bang', { blockHash: H[0], minter: '0xzz' });
    const bangBadJ = bangBad.status === 400 ? JSON.parse(bangBad.body) : {};
    ok('v2 /api/bang 非法 minter → 400 人话',
      bangBad.status === 400 && /十六进制/.test(String(bangBadJ.error)),
      bangBad.status + ' ' + String(bangBad.body).slice(0, 80));

    const ivMiss = await call('POST', '/api/intervene',
      { blockHash: H[2], tokenId: 7, oldCardHash: OLD, deltas: DEFAULTS });
    const ivMissJ = ivMiss.status === 400 ? JSON.parse(ivMiss.body) : {};
    ok('v2 /api/intervene 缺 minter → 400 人话',
      ivMiss.status === 400 && /minter/.test(String(ivMissJ.error)),
      ivMiss.status + ' ' + String(ivMiss.body).slice(0, 80));

    const ivPrev = await call('POST', '/api/intervene',
      { blockHash: H[2], ops: [{ key: 'alpha', dir: 1, steps: 1 }], preview: true });
    ok('v2 预览不签名，缺 minter 也 200', ivPrev.status === 200, ivPrev.status + '');

    const ivOk = await call('POST', '/api/intervene',
      { blockHash: H[2], tokenId: 7, oldCardHash: OLD, deltas: DEFAULTS, minter: MINTER });
    const ivj = ivOk.status === 200 ? JSON.parse(ivOk.body) : {};
    ok('v2 /api/intervene 带合法 minter → 200', ivOk.status === 200,
      ivOk.status === 200 ? '' : String(ivOk.body).slice(0, 120));
    if (ivj.sig) {
      const dg = interveneDigest(CHAIN_ID, process.env.ARCBANG_CONTRACT, 7n, OLD, ivj.cardHash,
        ivj.card.outcome.index, ivj.card.rarity.index, BigInt(ivj.costBang), ivj.deadline,
        opsHashOf(ivj.ops), MINTER);
      ok('v2 干预签名能用含 minter 的摘要还原',
        verifyMessage(getBytes(dg), ivj.sig).toLowerCase() === String(ivj.signer).toLowerCase());
      const dgOther = interveneDigest(CHAIN_ID, process.env.ARCBANG_CONTRACT, 7n, OLD, ivj.cardHash,
        ivj.card.outcome.index, ivj.card.rarity.index, BigInt(ivj.costBang), ivj.deadline,
        opsHashOf(ivj.ops), '0x' + '33'.repeat(20));
      ok('v2 换个 minter 就验不过',
        verifyMessage(getBytes(dgOther), ivj.sig).toLowerCase() !== String(ivj.signer).toLowerCase());
    }

    delete process.env.ARCBANG_SIG_V2;
    const bangV1 = await call('POST', '/api/bang', { blockHash: H[0] });
    ok('v1 /api/bang 不因缺 minter 拒（错误里没有 minter）',
      bangV1.status !== 400 || !/minter/.test(String(bangV1.body)),
      bangV1.status + ' ' + String(bangV1.body).slice(0, 80));
    delete process.env.ARCBANG_SIG_V2;
    void saved;
  }

  console.log('\n[HTTP] /api/intervene 其余校验');
  // 费用只能服务端算：请求里带费用必须被明着拒绝，不能默默忽略
  const withCost = await call('POST', '/api/intervene',
    { blockHash: H[2], tokenId: 7, oldCardHash: OLD, deltas: DEFAULTS, cost: '1' });
  ok('请求里带 cost 一律 400', withCost.status === 400);
  const badParam = await call('POST', '/api/intervene',
    { blockHash: H[2], tokenId: 7, oldCardHash: OLD, deltas: { notAParam: 1 } });
  ok('参数名不存在 400', badParam.status === 400);
  const badToken = await call('POST', '/api/intervene',
    { blockHash: H[2], tokenId: null, oldCardHash: OLD, deltas: DEFAULTS });
  ok('tokenId 是 null 也要 400（BigInt(null) 会静悄悄给 0n）', badToken.status === 400);

  /* ---------------- 端点上的相对档位与预览 ----------------
     沙盒每点一下都走这条路。它必须：算得和绝对值口径一模一样、不签名、不落盘。 */
  {
    const OPS = [{ key: 'alpha', dir: -1, steps: 3 }, { key: 'As', dir: 1, steps: 2 }];

    /* 预览必须先跑：它要断言"这份 card 没落盘"，而下面那次真干预会把同一份 card
       写进存档 —— 顺序反了的话，这条断言看到的是真干预留下的文件，永远绿，白测。 */
    const prev = await call('POST', '/api/intervene', { blockHash: H[2], ops: OPS, preview: true });
    const jp = prev.status === 200 ? JSON.parse(prev.body) : {};
    ok('预览不用 tokenId / oldCardHash 也能算', prev.status === 200, prev.status === 200 ? '' : prev.body.slice(0, 120));
    ok('预览回费用（费用只能服务端算）', !!jp.costBang && BigInt(jp.costBang) > 0n,
      jp.costBang ? (BigInt(jp.costBang) / 10n ** 18n) + ' BANG' : '');
    ok('预览不签名 —— 拿它上不了链', !jp.sig && !jp.deadline);
    // 沙盒里点一下就是一次预览，落盘等于开了个往磁盘灌垃圾的口子
    ok('预览不落盘', !fs.existsSync(path.join(api.STORE_DIR, 'card-' + String(jp.cardHash).toLowerCase() + '.json')));

    const byOps = await call('POST', '/api/intervene',
      { blockHash: H[2], tokenId: 7, oldCardHash: OLD, ops: OPS });
    const jo = byOps.status === 200 ? JSON.parse(byOps.body) : {};
    ok('/api/intervene 收 ops 返回 200', byOps.status === 200, byOps.status === 200 ? '' : byOps.body.slice(0, 120));
    ok('端点的 ops 与直接调 evaluate 一致', jo.cardHash === evaluate(IV.base, null, OPS).cardHash);
    ok('ops 那条路照样签名', !!(jo.sig && jo.deadline));
    /* 相对档位这条路也得把位移记录带上链。沙盒推出来的宇宙和绝对值口径推出来的
       既然是同一个，它们的位移记录也必须是同一段字节。 */
    ok('相对档位那条路也回 ops，且与绝对值口径逐字节相同',
      jo.ops === evaluate(IV.base, null, OPS).opsHex && (jo.ops.length - 2) % 10 === 0,
      jo.ops ? (jo.ops.length - 2) / 10 + ' 条' : '(无)');
    ok('预览也回同一段 ops（沙盒能就地自己复算一遍）', jp.ops === jo.ops);

    const both = await call('POST', '/api/intervene',
      { blockHash: H[2], tokenId: 7, oldCardHash: OLD, deltas: DEFAULTS, ops: OPS });
    ok('deltas 与 ops 同时给一律 400（别猜用户想要哪个）', both.status === 400,
      both.status === 400 ? JSON.parse(both.body).error : '');
    const neither = await call('POST', '/api/intervene',
      { blockHash: H[2], tokenId: 7, oldCardHash: OLD });
    ok('两种入参都不给也 400', neither.status === 400);
    const badDir = await call('POST', '/api/intervene',
      { blockHash: H[2], tokenId: 7, oldCardHash: OLD, ops: [{ key: 'alpha', dir: 0, steps: 1 }] });
    ok('ops 里 dir 不是 ±1 就 400', badDir.status === 400);
    const noMove = await call('POST', '/api/intervene',
      { blockHash: H[2], tokenId: 7, oldCardHash: OLD, ops: [{ key: 'generations', dir: 1, steps: 2 }] });
    ok('一格都没推动时回 code=NO_MOVE（界面要把它说成"推不动"，不是"出错了"）',
      noMove.status === 400 && JSON.parse(noMove.body).code === 'NO_MOVE');

    /* 沙盒里看到的宇宙和真烧币时签的宇宙必须是同一个 —— 不然玩家在沙盒里
       推活了、掏钱一签发现是另一个结局，那比泄露半径还糟。 */
    ok('预览与真干预算出同一份 card', jp.cardHash === jo.cardHash, jp.cardHash ? jp.cardHash.slice(0, 14) + '…' : '');

    // 沙盒刚打开时一格都没推，它照样要问"下一格该推谁"，所以空 ops 的预览必须放行
    const zero = await call('POST', '/api/intervene', { blockHash: H[2], ops: [], preview: true, suggest: true });
    const jz = zero.status === 200 ? JSON.parse(zero.body) : {};
    ok('空 ops 的预览回基准状态、费用 0', zero.status === 200 && jz.costBang === '0'
      && jz.card.outcome.id === IV.base.outcome.id);
    ok('预览能顺带给一条提示', !!(jz.suggest && jz.suggest.key), jz.suggest ? jz.suggest.key : '(null)');
    ok('提示只回 key/dir 这几个标量，不回推完的参数',
      !!jz.suggest && jz.suggest.params === undefined && jz.suggest.sim === undefined);
    // 真干预那条路不给提示：它要签名，不该顺手再跑 46 次模拟
    ok('空 ops 走真干预（要签名）必须 400',
      (await call('POST', '/api/intervene',
        { blockHash: H[2], tokenId: 7, oldCardHash: OLD, ops: [] })).status === 400);
    ok('预览也不许自报费用',
      (await call('POST', '/api/intervene',
        { blockHash: H[2], ops: OPS, preview: true, cost: '1' })).status === 400);
  }

  /* 第二次干预必须**接着第一次的参数**继续推：oldCardHash 就是链上的 cardOf[id]，
     它指向存档里那份干预后的 card。要是每次都从原生 card 重算，
     用户第一次烧掉的币就白烧了，而合约压根看不出来。 */
  const step2 = await call('POST', '/api/intervene', {
    blockHash: H[2], tokenId: 7, oldCardHash: j.cardHash,
    deltas: { alpha: P.fromUnit('alpha', P.toUnit('alpha', j.card.params.alpha) - 0.03) }
  });
  const j2 = step2.status === 200 ? JSON.parse(step2.body) : {};
  ok('第二次干预保留第一次的位移', step2.status === 200
    && j2.card.params.stringGasT === j.card.params.stringGasT
    && j2.card.params.alpha !== j.card.params.alpha);
  /* 拿别的宇宙的 cardHash 当基准 —— **必须当场拒掉**，不能默默退回按 blockHash 重算。
     原来这里退回重算并返回 200（连签名一起给），而合约的 intervene 摘要里
     根本没有 blockHash，链上验不出新卡算的是不是这枚 NFT 自己的宇宙。
     于是「A 宇宙的 token + B 宇宙的 blockHash」这一手就能把 B 的卡盖到 A 头上，
     详见下面 [嫁接] 那一节。 */
  const alien = await call('POST', '/api/intervene',
    { blockHash: H[0], tokenId: 7, oldCardHash: j.cardHash, deltas: DEFAULTS });
  ok('别的宇宙的 cardHash 当基准必须 400，不能默默换成原生卡再签名',
    alien.status === 400 && JSON.parse(alien.body).code === 'CARD_MISMATCH',
    alien.status + ' ' + alien.body.slice(0, 90));

  const artCard = await call('GET', '/api/art/card/' + j.cardHash + '.svg');
  const artBlock = await call('GET', '/api/art/' + H[2] + '.svg?p=1');
  ok('按 cardHash 出图 200', artCard.status === 200 && /image\/svg/.test(artCard.hdr['content-type'] || ''));
  ok('按 cardHash 出的图与按 blockHash 出的不同', sha(artCard.body) !== sha(artBlock.body),
    sha(artCard.body).slice(0, 12) + ' ≠ ' + sha(artBlock.body).slice(0, 12));
  ok('按 cardHash 出的图带 RESCUED 印记', artCard.body.indexOf('RESCUED') >= 0);
  ok('按 cardHash 出图幂等（第二次走缓存也一样）',
    sha((await call('GET', '/api/art/card/' + j.cardHash + '.svg')).body) === sha(artCard.body));

  const miss = await call('GET', '/api/art/card/' + B.keccak256('no-such-card') + '.svg');
  ok('查不到的 cardHash 返回 404', miss.status === 404, miss.status + '');
  // 版本没带对就不敢发 immutable，理由同 /api/art/<hash>.svg
  const fresh = await call('GET', '/api/art/card/' + j.cardHash + '.svg?v=' + DERIVATION_VERSION + '-' + api.SHAPE);
  ok('版本带对了才发 immutable', /immutable/.test(fresh.hdr['cache-control'] || '')
    && !/immutable/.test(artCard.hdr['cache-control'] || ''));

  /* ---------------------------------------------------------------- tokenURI
     buildMetadata 是纯函数（链上事实由调用方读好再传进来），所以这里直接喂四种
     链上状态，一次网都不用上。要盯的不是它印了什么，而是**它不肯印什么**：
     链上没盖章就一个参数都不许露，链上盖了章而服务端复算不出就一张图都不许给。 */
  console.log('\n[tokenURI] metadata 只印链上认得的东西');
  const { buildMetadata } = require('./token.js');
  const deps = {
    cardFor: api.cardFor, storeGet: api.storeGet,
    publicBase: 'https://x.test', version: DERIVATION_VERSION + '-' + api.SHAPE
  };
  const baseChain = {
    tokenId: 7n, blockHash: H[0].toLowerCase(), blockNumber: 123, mintedAt: 1,
    /* rarity 必须与 H[0] 的 card 算出来的**不同**，下面两条断言才有判别力：
       一条验"链上的优先"，一条验"链上没有才退回 card 算的"。
       两边同值的话，回退逻辑坏掉测试也照样绿。
       v3 下 H[0] 的 card 算出来是 B(2)，所以这里取 S(0)。 */
    minter: '0x' + '22'.repeat(20), outcome: 9, verified: true, rarity: 0,
    cardHash: null, burned: 0n, rescue: { at: 0, fromOutcome: 0, steps: 0 }
  };
  const attr = (meta, t) => {
    const a = meta.attributes.find((x) => x.trait_type === t);
    return a ? a.value : undefined;
  };

  const mNone = buildMetadata(baseChain, deps);
  ok('没盖章 → source=none', mNone.source === 'none', mNone.source);
  ok('没盖章 → 图不带参数', mNone.meta.image.indexOf('p=1') < 0);
  /* 这条是"未引爆"这一档存在的全部意义（economy-v4 §4）：服务端明明算得出
     这个区块的参数，但链上没盖章就不能露 —— 露了市场就没法按档收货了。 */
  ok('没盖章 → 一个参数都不印', attr(mNone.meta, 'Spatial dimension') === undefined
    && attr(mNone.meta, 'Tier') === undefined && attr(mNone.meta, 'Parameters') === 'none');
  ok('没盖章 → 结局标明只是铸造者声称的', attr(mNone.meta, 'Outcome source') === 'minter-claimed');

  const natHash = buildCard(H[0], null).cardHash.toLowerCase();
  const mNat = buildMetadata(Object.assign({}, baseChain, { cardHash: natHash }), deps);
  ok('原生盖章 → source=native', mNat.source === 'native', mNat.source);
  ok('原生盖章 → 图带 p=1', mNat.meta.image.indexOf('p=1') > 0);
  /* v3（半开带宽 ±0.02）之后这个哈希的 D 从 5.5 变成 5 —— 它原来正是被宽带
     误判成"半开"的那一类。档位不受影响：档位走 255 号槽，与维度无关。 */
  ok('原生盖章 → 印维度和档位', attr(mNat.meta, 'Spatial dimension') === 5
    && attr(mNat.meta, 'Tier') === 'Quake', attr(mNat.meta, 'Tier') + ' D=' + attr(mNat.meta, 'Spatial dimension'));
  ok('原生盖章 → 结局是服务端签过的', attr(mNat.meta, 'Outcome source') === 'server-signed');

  const mIv = buildMetadata(Object.assign({}, baseChain, {
    blockHash: H[2].toLowerCase(), cardHash: j.cardHash,
    burned: 1234n * 10n ** 18n, rescue: { at: 1700000000, fromOutcome: 0, steps: 2 }
  }), deps);
  ok('干预过 → source=intervened', mIv.source === 'intervened', mIv.source);
  ok('干预过 → 图按 cardHash 索引', mIv.meta.image.indexOf('/api/art/card/' + j.cardHash) > 0);
  /* 销毁量必须取链上的 burnedOn，不能取 card 里那个服务端算的报价：
     报价是"要烧多少"，链上那个才是"真烧了多少"，印在 NFT 上的数字得经得起核对。 */
  ok('干预过 → 印的是链上的真实销毁量', attr(mIv.meta, 'Burned') === '1234',
    String(attr(mIv.meta, 'Burned')));
  ok('干预过 → 印救活记录', attr(mIv.meta, 'Rescued') === 'yes'
    && attr(mIv.meta, 'Interventions') === 2);

  const mUnk = buildMetadata(Object.assign({}, baseChain,
    { cardHash: B.keccak256('no-such-stamp') }), deps);
  ok('盖了章却复算不出 → source=unknown', mUnk.source === 'unknown', mUnk.source);
  /* 旧推导版本铸的、或者干预存档丢了。这时候印当前版本的参数是拿另一个宇宙
     换掉他买到的那个，印 NOT DETONATED 又是否认他确实烧过币 —— 只能不给图。 */
  ok('盖了章却复算不出 → 宁可没有图也不给错图', mUnk.meta.image === undefined);
  ok('盖了章却复算不出 → 明说这枚章读不出来',
    attr(mUnk.meta, 'Parameters') === 'stamped, unreadable');
  ok('盖了章却复算不出 → 描述里带上那枚读不出的章',
    mUnk.meta.description.indexOf(B.keccak256('no-such-stamp')) > 0);

  ok('稀有度优先取链上的（它决定过定价和发币）', attr(mNat.meta, 'Rarity') === 'S',
    String(attr(mNat.meta, 'Rarity')));
  const noRarity = buildMetadata(Object.assign({}, baseChain,
    { cardHash: natHash, rarity: null }), deps);
  ok('链上没有稀有度字段才退回 card 算的', attr(noRarity.meta, 'Rarity') === 'B',
    String(attr(noRarity.meta, 'Rarity')));

  /* ---------------------------------------------------------------- 名字
     BangNames（BangNames）—— 烧 BANG 给宇宙命名，
     BANG 的第二条销毁通路。**它是纯附加的一层**：没配、配错、读不到，
     metadata 的其余部分一个字都不许变。
     这里要盯的还是那句老话：**链上说什么就是什么，读不准的宁可不印** ——
     名字会出现在市场、钱包、扫块器上，印错一个字就是替别人认领了一个名字。 */
  console.log('\n[命名] 名字优先当标题，但编号一个都不能丢');
  {
    const named = buildMetadata(Object.assign({}, baseChain,
      { cardHash: natHash, name: 'first-light' }), deps);
    ok('命名过 → 标题就是名字', named.meta.name === 'first-light', named.meta.name);
    /* **同时还要是一条 trait**：市场按 trait 筛选，只写在标题里的话
       "已命名"这一批根本筛不出来。 */
    ok('命名过 → Name 单独作为一条属性', attr(named.meta, 'Name') === 'first-light');
    /* 名字可以改、可以放弃，区块号不能 —— 出问题时要靠它把一枚 NFT 对回链上。
       所以名字只能"顶掉标题"，不能"顶掉编号"。 */
    ok('命名过 → 区块号和 tokenId 照样在属性里',
      attr(named.meta, 'Block') === 123 && attr(named.meta, 'Token ID') === '7',
      attr(named.meta, 'Block') + ' / ' + attr(named.meta, 'Token ID'));
    ok('命名过 → 描述里说清是持有人取的（不是官方给的名字）',
      /holder named it "first-light"/.test(named.meta.description));

    const unnamed = buildMetadata(Object.assign({}, baseChain, { cardHash: natHash }), deps);
    ok('没命名 → 标题退回 Universe #区块号', unnamed.meta.name === 'Universe #123', unnamed.meta.name);
    /* 不印 "unnamed"：**"没有名字"和"名字读不到"是两回事**，而这里分不出来，
       分不出来就都不说 —— 和 C3 是同一条规矩。 */
    ok('没命名 → 一条 Name 属性都不印', attr(unnamed.meta, 'Name') === undefined);
    ok('没命名 → 描述里不提命名这件事', !/ name it /.test(unnamed.meta.description));

    /* ---- 品牌与链名：这三样是**要上链 / 被市场存档**的内容，印错一个字就得重部署 ----
       tokenURI 的描述必须与合约自己那份链上兜底 metadata 一字不差
       （ArcUniverse.sol 的 tokenURI：'A universe grown from Arc block …'）。
       卡面水印是 NFT 图本体，写死不读 env（renderSVG 必须是 blockHash 的纯函数）。 */
    ok('tokenURI 描述写的是 Arc block，整份 metadata 不带 BNB / BNBBANG',
      /^A universe grown from Arc block 123\./.test(unnamed.meta.description)
      && JSON.stringify(unnamed.meta).indexOf('BNBBANG') < 0
      && !/BNB/.test(JSON.stringify(unnamed.meta)),
      unnamed.meta.description.slice(0, 60));
    {
      const svgBrand = renderSVG(H[0], buildCard(H[0], 123).card, true, false);
      ok('卡面 SVG 的水印是 ARCBANG，且不含 BNBBANG',
        svgBrand.indexOf('>ARCBANG</text>') > 0 && svgBrand.indexOf('BNBBANG') < 0);
      const OGB = require('./og.js');
      const savedB = process.env.ARCBANG_BRAND, savedW = process.env.ARCBANG_CHAIN_WORD,
            savedP = process.env.ARCBANG_PUBLIC_BASE;
      delete process.env.ARCBANG_BRAND; delete process.env.ARCBANG_CHAIN_WORD;
      process.env.ARCBANG_PUBLIC_BASE = 'https://arcbang.xyz';
      const og0 = OGB.composeOG(svgBrand, { blockNumber: '123', card: buildCard(H[0], 123).card, blockHash: H[0] });
      ok('分享图不配 env 时也是 ARCBANG / Arc block / arcbang.xyz，不含 BNBBANG',
        og0.indexOf('>ARCBANG</text>') > 0 && og0.indexOf('Arc block #123') > 0
        && og0.indexOf('>arcbang.xyz</text>') > 0 && og0.indexOf('BNBBANG') < 0
        && og0.indexOf('bnbbang.com') < 0);
      process.env.ARCBANG_BRAND = 'OTHER'; process.env.ARCBANG_CHAIN_WORD = 'Foo';
      const og1 = OGB.composeOG(svgBrand, { blockNumber: '123', card: buildCard(H[0], 123).card, blockHash: H[0] });
      ok('分享图的站名 / 链名跟着 env 走（卡面水印不跟 —— 它是 NFT 本体）',
        og1.indexOf('>OTHER</text>') > 0 && og1.indexOf('Foo block #123') > 0
        && og1.indexOf('>ARCBANG</text>') > 0);   // 内嵌的那张卡仍写 ARCBANG
      if (savedB === undefined) delete process.env.ARCBANG_BRAND; else process.env.ARCBANG_BRAND = savedB;
      if (savedW === undefined) delete process.env.ARCBANG_CHAIN_WORD; else process.env.ARCBANG_CHAIN_WORD = savedW;
      if (savedP === undefined) delete process.env.ARCBANG_PUBLIC_BASE; else process.env.ARCBANG_PUBLIC_BASE = savedP;
    }

    /* 名字来自**另一个合约**，而那个地址由 ARCBANG_NAMES 配置决定 —— 配错就可能
       返回任意字节。合约那边已经把规则钉死了，这里独立再验一遍，验不过一律当没名字。
       **绝不"清洗后照印"**：清洗出来的是一个链上不存在的名字。 */
    const junk = [
      ['Ｅarth', '全角同形字'],
      ['地球', '非 ASCII'],
      ['ea rth', '带空格'],
      ['-earth', '首字符是连字符'],
      ['earth-', '末字符是连字符'],
      ['a'.repeat(33), '超过 32 字节'],
      ['', '空串'],
      ['ea<b>rth', '带标签的字符（印进 metadata 会被某些前端当 HTML）']
    ];
    let allRejected = true, detail = '';
    for (const [nm, why] of junk) {
      const m = buildMetadata(Object.assign({}, baseChain, { cardHash: natHash, name: nm }), deps);
      if (m.meta.name !== 'Universe #123' || attr(m.meta, 'Name') !== undefined) {
        allRejected = false;
        detail = why + ' 竟然被印出来了：' + m.meta.name;
      }
    }
    ok('名字验不过就当没有名字，不清洗、不截断、不照印', allRejected, detail);

    /* readToken 那一头：ABI 里的 string 解码 + 三种"读不到"。
       用桩喂真实形状的返回数据，一次网都不上。 */
    const { readToken } = require('./token.js');
    const selOf = (sig) => keccakId(sig).slice(0, 10);
    const NFT = '0x' + '11'.repeat(20);
    const NAMES = '0x' + '99'.repeat(20);
    const w = (v) => BigInt(v).toString(16).padStart(64, '0');
    /* universeOf 的 7 个字：blockHash / blockNumber / mintedAt / minter / outcome / verified / rarity */
    const uniRet = '0x' + H[0].replace(/^0x/, '') + w(123) + w(1) + '22'.repeat(20).padStart(64, '0')
      + w(9) + w(1) + w(2);
    const strRet = (s) => {
      const b = Buffer.from(s, 'utf8');
      return '0x' + w(32) + w(b.length) + b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64 || 64, '0');
    };
    const savedStub = ethCallStub;
    let nameCalls = 0;
    /* 桩**顶掉的是 chain.js 的 ethCall 本身**，所以 nullOnRevert 那段宽容逻辑
       也一起被顶掉了 —— 桩必须自己照着实现一遍。不实现的话，下面那条
       "revert 当成没有名字"测的就只是"桩抛不抛"，而不是
       "token.js 到底给 nameOf 传没传 {nullOnRevert:true}"，
       真把 soft 漏了也照样绿。 */
    const mkStub = (nameAnswer) => (to, data, opts) => {
      if (String(to).toLowerCase() === NAMES.toLowerCase()) {
        nameCalls++;
        if (typeof nameAnswer === 'function') {
          try { return nameAnswer(); }
          catch (e) {
            if (e.reverted && opts && opts.nullOnRevert) return null;
            throw e;
          }
        }
        return nameAnswer;
      }
      if (data.startsWith(selOf('universeOf(uint256)'))) return uniRet;
      return '0x' + w(0);
    };

    nameCalls = 0;
    ethCallStub = mkStub(strRet('first-light'));
    const rt = await readToken(NFT, 7n, NAMES);
    ok('readToken 解得出链上那个 string', rt.name === 'first-light', String(rt.name));
    ok('读名字确实打了那个合约', nameCalls === 1, nameCalls + ' 次');

    /* **没配地址时一次 RPC 都不许发**：每一枚 NFT 的 metadata 都走这里，
       发了再忽略是实打实的延迟。 */
    nameCalls = 0;
    ethCallStub = mkStub(strRet('never-read'));
    const rtOff = await readToken(NFT, 7n, '');
    ok('没配命名合约 → 没有名字', rtOff.name === null, String(rtOff.name));
    ok('没配命名合约 → 一次 RPC 都不发', nameCalls === 0, nameCalls + ' 次');

    // 地址指向一个没有 nameOf 的合约：revert 是**有意义的答复**，不是故障
    ethCallStub = mkStub(() => { const e = new Error('execution reverted'); e.reverted = true; throw e; });
    const rtRev = await readToken(NFT, 7n, NAMES);
    ok('命名合约 revert → 当成没有名字，不把整枚 NFT 拖成 500', rtRev.name === null);
    ok('命名合约 revert → 别的字段照常读出来', rtRev.blockNumber === 123 && rtRev.outcome === 9);

    // 地址上压根没有合约：节点回一个干干净净的 0x
    ethCallStub = mkStub('0x');
    const rtEmpty = await readToken(NFT, 7n, NAMES);
    ok('命名合约地址上没有合约 → 当成没有名字', rtEmpty.name === null);

    // 返回一个长度字段离谱的 string：不许照着那个长度去切
    ethCallStub = mkStub('0x' + w(32) + w(999999));
    const rtBad = await readToken(NFT, 7n, NAMES);
    ok('返回的 string 长度对不上数据 → 给 null，不抛', rtBad.name === null);

    ethCallStub = savedStub;
  }

  console.log('\n[造物 burned] cardOf 8 槽 / 7 槽兼容；元数据与出图优先链上销毁');
  {
    const { parseCraftedCard, buildCraftedMetadata, readCrafted } = require('./token.js');
    const w = (v) => BigInt(v).toString(16).padStart(64, '0');
    const E18 = 10n ** 18n;
    const oh = 'aa'.repeat(32), ops = 'bb'.repeat(32), ch = String(j.cardHash).replace(/^0x/, '');
    const paid = 10000n * E18, burnedAmt = 2000n * E18;
    const seven = '0x' + oh + ops + ch + w(9) + w(0) + w(42) + w(paid);
    const eight = seven + w(burnedAmt);
    let threw = false;
    let p8, p7;
    try {
      p8 = parseCraftedCard(eight);
      p7 = parseCraftedCard(seven);
      parseCraftedCard('0x');
    } catch (e) { threw = true; }
    ok('8 槽解析不抛，burned 取槽 7', !threw && p8 && p8.burned === burnedAmt && p8.paid === paid,
      p8 && String(p8.burned));
    ok('7 槽兼容：burned=null、不报错', !threw && p7 && p7.burned === null && p7.paid === paid);

    const { card } = buildCard(H[0], 1);
    const svgExact = renderCraftedSVG(H[0], card, { burned: burnedAmt });
    ok('链上 burned → 图上印「销毁 2000」', svgExact.indexOf('销毁 2000') >= 0);
    ok('链上 burned 不标「按当前费率折算」', svgExact.indexOf('按当前费率折算') < 0);
    const svgEst = renderCraftedSVG(H[0], card, { paid: paid, burnBps: 2000n });
    ok('读不到 burned → 按当前 burnBps 折算并标注',
      svgEst.indexOf('销毁 2000') >= 0 && svgEst.indexOf('按当前费率折算') >= 0);
    const svgNone = renderCraftedSVG(H[0], card, {});
    ok('两边都没有就不印销毁（不猜）', svgNone.indexOf('销毁') < 0);
    ok('默认 renderSVG 不含「销毁」（指纹不变）',
      renderSVG(H[0], card, true).indexOf('销毁') < 0);
    ok('craftedBurnLabel 优先链上值',
      craftedBurnLabel(burnedAmt, paid, 100n) === '销毁 2000');

    const mC = buildCraftedMetadata({
      tokenId: 1n, originHash: '0x' + oh, opsHash: '0x' + ops, cardHash: String(j.cardHash).toLowerCase(),
      outcome: 9, rarity: 0, originBlock: 42, paid: paid, burned: burnedAmt, burnBps: 2000n
    }, deps);
    ok('造物元数据优先链上 burned', attr(mC.meta, '销毁') === '2000', String(attr(mC.meta, '销毁')));
    ok('链上 burned 不标折算', attr(mC.meta, 'Burn source') === undefined);
    ok('描述里带「销毁 2000」', /销毁 2000/.test(mC.meta.description));
    const mEst = buildCraftedMetadata({
      tokenId: 1n, originHash: '0x' + oh, opsHash: '0x' + ops, cardHash: String(j.cardHash).toLowerCase(),
      outcome: 9, rarity: 0, originBlock: 42, paid: paid, burned: null, burnBps: 2000n
    }, deps);
    ok('读不到 burned 才按 burnBps 折算并标注',
      attr(mEst.meta, '销毁') === '2000（按当前费率折算）', String(attr(mEst.meta, '销毁')));
    ok('折算时 Burn source 标明估的', attr(mEst.meta, 'Burn source') === 'estimated at current burnBps');

    const selOf = (sig) => keccakId(sig).slice(0, 10);
    const CRAFT = '0x' + 'cc'.repeat(20);
    const savedStub = ethCallStub;
    ethCallStub = (to, data, opts) => {
      if (data.startsWith(selOf('cardOf(uint256)'))) return eight;
      if (data.startsWith(selOf('burnBps()'))) return '0x' + w(2000);
      return '0x';
    };
    const rc8 = await readCrafted(CRAFT, 1n, '');
    ok('readCrafted 8 槽 burned 取槽 7', rc8 && rc8.burned === burnedAmt && rc8.paid === paid,
      rc8 && String(rc8.burned));
    ethCallStub = (to, data, opts) => {
      if (data.startsWith(selOf('cardOf(uint256)'))) return seven;
      if (data.startsWith(selOf('burnBps()'))) return '0x' + w(2000);
      return '0x';
    };
    const rc7 = await readCrafted(CRAFT, 1n, '');
    ok('readCrafted 7 槽 burned=null，burnBps 仍读到',
      rc7 && rc7.burned === null && rc7.burnBps === 2000n, rc7 && String(rc7.burned));
    ethCallStub = savedStub;

  }

  console.log('\n[K] card 缓存不能把 blockNumber 抹掉');
  {
    /* 复现踩过的那个顺序：先浏览（不知道高度，传 null），再铸造（传真实高度）。
       cardHash 里不含 blockNumber，所以缓存可以共用；但 blockNumber 是
       「这个哈希来自哪个高度」的元数据，因调用方而异，不能被缓存里的 null 盖住。
       盖住的后果：/bang 返回 blockNumber=null，前端 BigInt(null) 直接抛；
       就算前端当 0 传上去，签名是按真实高度签的，合约照样 BadSig。 */
    const h = B.keccak256('cache-blocknumber-order');
    const seen = new Map();
    const cacheGet = k => (seen.has(k) ? seen.get(k) : null);
    const cachePut = (k, v) => { seen.set(k, v); return v; };

    /* 测的是 index.js 导出的**那一个** cardFor，不是抄一份过来。
       抄一份的话真实现哪天改了这里照样绿 —— 而这个 bug 本来就出在
       "缓存里存了不该存的东西"，副本永远测不到。 */
    const cardFor = api.cardFor;

    const browse = cardFor(h, null);              // 第一步：浏览，不知道高度
    ok('浏览时 blockNumber 是 null', browse.card.blockNumber === null,
       'got ' + browse.card.blockNumber);

    const mint = cardFor(h, 125988327);           // 第二步：铸造，知道高度 —— 这里命中缓存
    ok('铸造时拿到真实高度而不是缓存里的 null', mint.card.blockNumber === 125988327,
       'got ' + mint.card.blockNumber);

    ok('cardHash 不受高度影响（缓存本来就该共用）', browse.cardHash === mint.cardHash,
       browse.cardHash.slice(0, 12) + '… vs ' + mint.cardHash.slice(0, 12) + '…');

    const again = cardFor(h, null);               // 再浏览一次不该被上一步污染成数字
    ok('高度未知时不编一个出来', again.card.blockNumber === null,
       'got ' + again.card.blockNumber);
  }

  console.log('\n[R] 限流按「不同的宇宙」计数');
  {
    /* 换一份干净的限流器实例，额度调小便于测边界。
       require 缓存会让别的用例共用同一份计数，所以先删缓存。 */
    delete require.cache[require.resolve('./ratelimit.js')];
    process.env.ARCBANG_ANON_LIMIT = '3';
    const RL = require('./ratelimit.js');
    const req = ip => ({ headers: { 'x-forwarded-for': '10.0.0.1, ' + ip }, socket: {} });
    const h1 = '0x' + '11'.repeat(32), h2 = '0x' + '22'.repeat(32),
          h3 = '0x' + '33'.repeat(32), h4 = '0x' + '44'.repeat(32);

    const a = RL.check(req('1.1.1.1'), h1);
    ok('第一次问 h1 放行并扣额度', a.ok && a.remaining === 2, 'remaining=' + a.remaining);

    /* 这一条就是这次要锁住的行为：铸造前会再取一次同一个哈希的签名。
       如果它也扣额度，就会出现「人已经决定收下这个宇宙、却因为之前看得多而铸不了」。 */
    const b = RL.check(req('1.1.1.1'), h1);
    ok('重复问 h1 不再扣额度', b.ok && b.repeat === true && b.remaining === 2,
       'remaining=' + b.remaining + ' repeat=' + b.repeat);

    RL.check(req('1.1.1.1'), h2);
    const c = RL.check(req('1.1.1.1'), h3);
    ok('三个不同哈希把额度用完', c.ok && c.remaining === 0, 'remaining=' + c.remaining);

    const d = RL.check(req('1.1.1.1'), h4);
    ok('第四个新哈希被拦', !d.ok, 'ok=' + d.ok);

    // 额度用完后，已看过的宇宙仍然铸得了 —— 闸拦的是扫描，不是成交
    const e2 = RL.check(req('1.1.1.1'), h1);
    ok('额度用完后，已看过的宇宙仍可取签名', e2.ok && e2.repeat === true, 'ok=' + e2.ok);

    const f = RL.check(req('1.1.1.1'), h1.toUpperCase().replace('0X', '0x'));
    ok('哈希大小写不敏感', f.ok && f.repeat === true, 'repeat=' + f.repeat);

    const g = RL.check(req('2.2.2.2'), h4);
    ok('不同 IP 各算各的', g.ok && g.remaining === 2, 'remaining=' + g.remaining);

    /* 代理头信任链：与管理员门禁同一份 ipOf。cf-connecting-ip 永不信；
       XFF 取最后一跳；非本机直连不信任何转发头。 */
    ok('ipOf 信 nginx 覆盖的 X-Real-IP，不信 CF-Connecting-IP',
      RL.ipOf({ headers: { 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }, socket: {} }) === '2.2.2.2');
    ok('ipOf 单独的 CF-Connecting-IP 当不存在（nginx 不会覆盖它）',
      RL.ipOf({ headers: { 'cf-connecting-ip': '1.1.1.1' }, socket: {} }) === 'unknown');
    ok('ipOf 取 XFF 最后一跳，第一段伪造无效',
      RL.ipOf({ headers: { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }, socket: {} }) === '9.9.9.9');
    ok('非本机直连不信转发头',
      RL.ipOf({ headers: { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '8.8.8.8' } }) === '8.8.8.8');
    ok('::ffff: 前缀剥掉再比',
      RL.ipOf({ headers: { 'x-real-ip': '::ffff:203.0.113.9' }, socket: {} }) === '203.0.113.9');

    delete process.env.ARCBANG_ANON_LIMIT;
    delete require.cache[require.resolve('./ratelimit.js')];
  }

  console.log('\n[嫁接] oldCardHash 必须真的是这个 blockHash 的卡');
  {
    /* 合约的 intervene 摘要是
         (chainId, 合约, tokenId, cardOf[id], 新卡, 结局, 稀有度, 费用, deadline, keccak256(ops))
       —— **里面没有 blockHash**。链上因此无从判断"新卡算的是不是这枚 NFT 自己的宇宙"，
       这件事只能由服务端把住。原来服务端只在存档命中时核对 blockHash，对不上就默默
       退回按请求里的 blockHash 重算，照签：

         持有 token 7（宇宙 A），oldCardHash 填 A 真实的 cardOf，
         blockHash 填一个 S 档区块 B，随手推一格 → 拿到签名。
         合约验 cardOf[7] ✓ 验签名 ✓，于是 token 7 的 cardOf 指向 B 的卡、
         u.rarity 被改写成 S。稀有度直接决定定价和发币量。 */
    const S_HASH = B.keccak256('alive-seed-8');          // 这个哈希原生就是 S 档
    const sCard = buildCard(S_HASH, 1);
    const aCard = buildCard(H[0], 1);
    ok('测试素材：一个 S 档宇宙 + 一个非 S 档宇宙',
      sCard.card.rarity.name === 'S' && aCard.card.rarity.name !== 'S',
      S_HASH.slice(0, 10) + '…=' + sCard.card.rarity.name + '  ' + H[0].slice(0, 10) + '…=' + aCard.card.rarity.name);

    const graft = await call('POST', '/api/intervene', {
      blockHash: S_HASH, tokenId: 7, oldCardHash: aCard.cardHash,
      ops: [{ key: 'alpha', dir: 1, steps: 1 }]
    });
    ok('把 S 档宇宙的卡嫁接到别人的 token 上 → 400 CARD_MISMATCH',
      graft.status === 400 && JSON.parse(graft.body).code === 'CARD_MISMATCH',
      graft.status + ' ' + graft.body.slice(0, 80));
    ok('被拒时一个签名字节都不发出去', graft.body.indexOf('"sig"') < 0);

    const legit = await call('POST', '/api/intervene', {
      blockHash: S_HASH, tokenId: 7, oldCardHash: sCard.cardHash,
      ops: [{ key: 'alpha', dir: 1, steps: 1 }]
    });
    ok('原生指纹当基准照常放行（别把正经的第一次干预也拦了）',
      legit.status === 200, legit.status + ' ' + legit.body.slice(0, 80));

    /* 从没盖过章的 token（cardOf 为 0）也不能借这条路凭空得到一张卡：
       合约允许 cardOf[id] 为 0 时调 intervene（摘要里那一格就是 0x00…00），
       而"这个 token 是哪个宇宙"服务端一无所知，只能拒。 */
    const zeroOld = await call('POST', '/api/intervene', {
      blockHash: S_HASH, tokenId: 7, oldCardHash: '0x' + '00'.repeat(32),
      ops: [{ key: 'alpha', dir: 1, steps: 1 }]
    });
    ok('没盖过章的 token（oldCardHash 全零）不许凭空拿一张卡',
      zeroOld.status === 400 && JSON.parse(zeroOld.body).code === 'CARD_MISMATCH', zeroOld.status + '');

    // 预览不设这道闸：不签名、不落盘、不花钱，拿不到任何能上链的东西
    const prevAlien = await call('POST', '/api/intervene', {
      blockHash: S_HASH, oldCardHash: aCard.cardHash, preview: true,
      ops: [{ key: 'alpha', dir: 1, steps: 1 }]
    });
    ok('预览不受这道闸影响（沙盒本来就要能推没铸造过的宇宙）',
      prevAlien.status === 200, prevAlien.status + '');
  }

  console.log('\n[限流] 闸要盖住每一条"能算出结局"的路');
  {
    /* 免费引爆本身就是扫描接口：挨个哈希点，服务端把结局告诉他，只 mint 好的。
       所以闸必须盖住**每一条**能算出结局的路，漏一条等于没有闸。
       各用例用自己的 IP 分桶，免得互相吃额度。 */
    const ipOf = (n) => ({ 'x-forwarded-for': '10.9.0.' + n });
    const rem = (r) => Number(r.hdr['x-ratelimit-remaining']);
    /* 额度上限从响应头读，不写死 30 —— 环境里设了 ARCBANG_ANON_LIMIT 的话，
       写死的期望值会让这些用例莫名其妙地红，而红的原因和被测的行为无关。 */
    const lim = (r) => Number(r.hdr['x-ratelimit-limit']);
    const OUT_EN = require('./art.js').OUTCOME_EN;

    /* ---- /intervene 预览：原来**完全不限流**，一个 blockHash 就白送整张 card
       （结局、稀有度、维度、全部参数），不签名不上链不花钱。 */
    const P1 = B.keccak256('gate-preview-1'), P2 = B.keccak256('gate-preview-2');
    const p1 = await call('POST', '/api/intervene', { blockHash: P1, ops: [], preview: true }, ipOf(1));
    ok('预览要扣额度（它把结局和全部参数一起回给调用方）',
      p1.status === 200 && Number.isFinite(rem(p1)), 'remaining=' + rem(p1));
    const p1b = await call('POST', '/api/intervene',
      { blockHash: P1, ops: [{ key: 'alpha', dir: 1, steps: 1 }], preview: true }, ipOf(1));
    ok('沙盒对着同一个宇宙反复推不再扣额度（闸拦扫描，不拦玩）',
      p1b.status === 200 && rem(p1b) === rem(p1), rem(p1) + ' → ' + rem(p1b));
    const p2 = await call('POST', '/api/intervene', { blockHash: P2, ops: [], preview: true }, ipOf(1));
    ok('换一个宇宙就再扣一次（扫描的特征就是哈希各不相同）',
      p2.status === 200 && rem(p2) === rem(p1) - 1, rem(p1) + ' → ' + rem(p2));

    /* ---- 出图：?p=1 的图上白纸黑字印着结局，同样是一条扫描路。
       但闸只能架在"算一个新宇宙"上：已经算过的再出图是纯静态内容，
       而且图是 <img> 拉的、带不上 Authorization，扣了只会误伤看图的人。 */
    const A1 = B.keccak256('gate-art-1');
    const a1 = await call('GET', '/api/art/' + A1 + '.svg?p=1', null, ipOf(2));
    ok('出一个没算过的宇宙要扣额度', a1.status === 200 && Number.isFinite(rem(a1)), 'remaining=' + rem(a1));
    ok('那张图确实把结局印在上面（所以它必须进闸）',
      a1.body.indexOf(OUT_EN[buildCard(A1, 1).card.outcome.index]) >= 0,
      OUT_EN[buildCard(A1, 1).card.outcome.index]);
    const a1b = await call('GET', '/api/art/' + A1 + '.svg?p=1&t=1', null, ipOf(2));
    ok('已经算过的宇宙再出图（换缩略图档也一样）不扣额度',
      a1b.status === 200 && a1b.hdr['x-ratelimit-remaining'] === undefined,
      'remaining 头=' + a1b.hdr['x-ratelimit-remaining']);
    /* 不带 p=1 的那张图（NOT DETONATED）不进闸：它一个字的结局都没印，
       而市场要展示没引爆过的 NFT 就得拉它，拦下来只会变成裂图。 */
    const A3 = B.keccak256('gate-art-noparam');
    const a3 = await call('GET', '/api/art/' + A3 + '.svg', null, ipOf(2));
    ok('不带参数的图不扣额度（它没印结局，且市场要拿它显示未引爆的 NFT）',
      a3.status === 200 && a3.body.indexOf('NOT DETONATED') >= 0
      && a3.hdr['x-ratelimit-remaining'] === undefined,
      'remaining 头=' + a3.hdr['x-ratelimit-remaining']);

    const A2 = B.keccak256('gate-art-2');
    await call('GET', '/api/card/' + A2, null, ipOf(3));            // 正常流程：先浏览/引爆
    const a2 = await call('GET', '/api/art/' + A2 + '.svg?p=1', null, ipOf(3));
    ok('引爆过的宇宙再出图不扣额度（闸不该拦成交）',
      a2.status === 200 && a2.hdr['x-ratelimit-remaining'] === undefined,
      'remaining 头=' + a2.hdr['x-ratelimit-remaining']);

    // ---- 扫到底真的会被拦下（匿名额度默认 30/小时/IP）
    const ANON = lim(p1);
    let blockedAt = -1;
    for (let i = 0; i < ANON + 5 && blockedAt < 0; i++) {
      const r = await call('POST', '/api/intervene',
        { blockHash: B.keccak256('gate-scan-' + i), ops: [], preview: true }, ipOf(4));
      if (r.status === 429) blockedAt = i;
    }
    ok('用预览扫全链会被 429 拦下', blockedAt === ANON,
      '额度 ' + ANON + '，第 ' + (blockedAt + 1) + ' 个哈希被拦');

    // ---- 坏请求不许扣额度：拿不到哈希就一个宇宙都没算，扣了只是在罚发坏请求的人
    const bad1 = await call('POST', '/api/bang', 'not json at all', ipOf(5));
    const bad2 = await call('POST', '/api/bang', 'still not json', ipOf(5));
    ok('请求体不是 JSON 时报 400 且不扣额度',
      bad1.status === 400 && bad2.status === 400
      && bad1.hdr['x-ratelimit-remaining'] === undefined
      && bad2.hdr['x-ratelimit-remaining'] === undefined, bad1.status + '/' + bad2.status);
    const goodAfterBad = await call('GET', '/api/card/' + B.keccak256('after-bad'), null, ipOf(5));
    ok('坏请求发过一串之后，正经请求的额度一格没少',
      goodAfterBad.status === 200 && rem(goodAfterBad) === lim(goodAfterBad) - 1,
      'remaining=' + rem(goodAfterBad) + '/' + lim(goodAfterBad));

    // ---- 体过大是请求的错，报 413，不能变成 500「服务端出错」
    const big = await call('POST', '/api/bang',
      JSON.stringify({ blockHash: H[0], pad: 'x'.repeat(9000) }), ipOf(6));
    ok('请求体过大报 413，不是 500', big.status === 413, big.status + ' ' + big.body.slice(0, 60));

    /* X-Forwarded-For 必须取**最后一跳**（我们自己的 nginx 追加的那个）。
       取第一个的话，客户端随手伪造一个头就能换一个桶，闸形同虚设。 */
    const spoof = (n) => ({ 'x-forwarded-for': '1.2.3.' + n + ', 10.9.0.9' });
    const s1 = await call('GET', '/api/card/' + B.keccak256('xff-1'), null, spoof(1));
    const s2 = await call('GET', '/api/card/' + B.keccak256('xff-2'), null, spoof(2));
    ok('伪造 X-Forwarded-For 换不掉桶（取的是最后一跳）',
      rem(s2) === rem(s1) - 1, rem(s1) + ' → ' + rem(s2));
  }

  console.log('\n[缓存] 内容不许依赖没进键的入参；坏了要能自愈');
  {
    /* 同一个 URL 不许因为"谁先来"产生两种字节。
       blockNumber 不在任何缓存键里，却曾经被烤进缓存的 card 文件：
       先 /bang（带真实高度）再出图 → SVG 上有 "UNIVERSE #125988327"；
       反过来先出图 → 那一行永远没有。而这张图是带着 immutable 发给市场和钱包的。 */
    const hOrd = B.keccak256('cache-order-dep');
    api.cardFor(hOrd, 125988327);                        // 先走一遍"铸造"：知道真实高度
    const artA = await call('GET', '/api/art/' + hOrd + '.svg?p=1');
    for (const f of fs.readdirSync(process.env.ARCBANG_CACHE)) {
      fs.unlinkSync(path.join(process.env.ARCBANG_CACHE, f));
    }
    const artB = await call('GET', '/api/art/' + hOrd + '.svg?p=1');   // 换成"先出图"的顺序
    ok('出图与请求顺序无关（没进键的入参就不许进内容）',
      artA.status === 200 && sha(artA.body) === sha(artB.body),
      sha(artA.body).slice(0, 12) + ' vs ' + sha(artB.body).slice(0, 12));
    ok('缓存里存的是规范形态（blockNumber 一律 null）',
      JSON.parse(fs.readFileSync(path.join(process.env.ARCBANG_CACHE,
        'card-' + hOrd.toLowerCase() + '-v' + DERIVATION_VERSION + '-s' + api.SHAPE + '.json'),
        'utf8')).card.blockNumber === null);
    ok('但调用方给了高度就以它为准（前端 BigInt(null) 会抛，这条不能退）',
      api.cardFor(hOrd, 125988327).card.blockNumber === 125988327);

    /* 缓存文件只写了一半 —— 进程被 kill / 断电正好卡在 writeFileSync 中间就是这样。
       card 按定义可再生（blockHash 的纯函数），坏了就该重算；
       原来是 JSON.parse 直接抛出去变成 500，而且那个文件一直躺在那，
       之后**每一次**问这个哈希都是 500，直到有人手动去删。 */
    const hTorn = B.keccak256('cache-torn');
    const first = await call('GET', '/api/card/' + hTorn);
    const cfile = path.join(process.env.ARCBANG_CACHE,
      'card-' + hTorn.toLowerCase() + '-v' + DERIVATION_VERSION + '-s' + api.SHAPE + '.json');
    const good = fs.readFileSync(cfile, 'utf8');
    fs.writeFileSync(cfile, good.slice(0, Math.floor(good.length / 2)));
    const second = await call('GET', '/api/card/' + hTorn);
    ok('缓存文件只剩半截时重算，不是 500',
      second.status === 200 && JSON.parse(second.body).cardHash === JSON.parse(first.body).cardHash,
      second.status + '');
    ok('重算之后缓存被写回完整的', JSON.parse(fs.readFileSync(cfile, 'utf8')).cardHash != null);

    /* 写盘走临时文件 + rename：被 kill 时要么是旧的完整内容、要么是新的完整内容，
       不会在真路径上留下半截。顺带确认临时文件没有漏在缓存目录里。 */
    ok('缓存目录里没有漏下的临时文件',
      fs.readdirSync(process.env.ARCBANG_CACHE).filter(f => /\.tmp$/.test(f)).length === 0);

    /* 同一个哈希同时来一堆请求：结果必须一致、不能有人拿到 500。
       （单进程里 writeFileSync 不会被别的 JS 打断，这条测的是整条路的一致性） */
    const hCon = B.keccak256('cache-concurrent');
    const many = await Promise.all([0, 1, 2, 3, 4, 5].map(
      () => call('GET', '/api/card/' + hCon)));
    ok('同一个哈希并发 6 个请求：全 200 且 cardHash 一致',
      many.every(r => r.status === 200)
      && new Set(many.map(r => JSON.parse(r.body).cardHash)).size === 1);
    ok('并发只扣一次额度（同一个宇宙问几次都是一次）',
      new Set(many.map(r => r.hdr['x-ratelimit-remaining'])).size <= 2);

    /* 存档坏了不能把 /api/token 带崩（市场连名字都读不出来），
       但也不能装作无事发生 —— 它不可再生，坏一个就是永久丢一份参数。
       正确答案是 buildMetadata 里那一档：盖了章、复算不出、**不给图**。 */
    const sfile = path.join(api.STORE_DIR, 'card-' + String(j.cardHash).toLowerCase() + '.json');
    const savedStore = fs.readFileSync(sfile, 'utf8');
    fs.writeFileSync(sfile, '{"blockHash": "0x12');
    ok('存档坏了 storeGet 给 null 而不是抛（否则整个端点 500）', api.storeGet(j.cardHash) === null);
    const mBroken = buildMetadata(Object.assign({}, baseChain, {
      blockHash: H[2].toLowerCase(), cardHash: String(j.cardHash).toLowerCase()
    }), deps);
    ok('存档坏了退到"盖了章但读不出来"，绝不给一张错的图',
      mBroken.meta.image === undefined && /stamped, unreadable/.test(JSON.stringify(mBroken.meta)),
      mBroken.source);
    fs.writeFileSync(sfile, savedStore);
    ok('存档修回来之后又能正常读', api.storeGet(j.cardHash) != null);
  }

  console.log('\n[配置错] 三类错要报三种话，不能混成一句');
  {
    /* 混在一起的后果是查错方向完全跑偏。踩过的原型：/etc/bnbbang 目录 700
       导致服务用户读不到私钥，报错却说"没有私钥"。 */
    const saved = ethCallStub;

    // 1. 地址上根本没有合约：节点不 revert，就是干干净净回一个空的 0x
    ethCallStub = () => '0x';
    const noCode = await call('GET', '/api/token/5');
    ok('合约地址上没有合约 → 502 说配置不对，不是 404「链上没有这枚 NFT」',
      noCode.status === 502 && /ARCBANG_CONTRACT/.test(noCode.body),
      noCode.status + ' ' + noCode.body.slice(0, 70));

    // 2. 地址上有合约，但不认识 universeOf（revert）
    ethCallStub = () => { const e = new Error('execution reverted'); e.reverted = true; throw e; };
    const wrongAbi = await call('GET', '/api/token/5');
    ok('合约不认识 universeOf → 502，且和上一条不是同一句话',
      wrongAbi.status === 502 && /universeOf/.test(JSON.parse(wrongAbi.body).error), wrongAbi.status + '');

    // 3. 节点全挂：这是我们的故障，必须 503 —— 报 404 会让市场以为这枚 NFT 被烧了
    ethCallStub = () => { const e = new Error('所有 RPC 节点都打不通'); e.rpcDown = true; throw e; };
    const down = await call('GET', '/api/token/5');
    ok('节点全挂 → 503，不是 404 也不是 502', down.status === 503, down.status + '');

    // 4. 合约在、能读、这个 id 没铸过：这才是 404
    ethCallStub = () => '0x' + '00'.repeat(32);
    const none = await call('GET', '/api/token/5');
    ok('合约能读但这个 id 没铸过 → 404', none.status === 404, none.status + '');

    ethCallStub = saved;
  }

  console.log('\n[广播 PNG] 分享图：出图、缓存、并发闸、依赖缺失退通用图');
  {
    /*。多数平台不认 SVG（X 明确不支持，微信也不认），
       所以每条 .svg 都配一条 .png。这一节盯死四件事：
       出的是真 PNG、第二次走缓存、同一张图并发只渲一次、依赖没了也**绝不 500**。 */
    const PNG = require('./png.js');
    const PNGDIR = path.join(process.env.ARCBANG_STORE, 'png');
    const isPNG = (b) => Buffer.isBuffer(b) && b.length > 8
      && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG';
    const keyOf = (h, p) => 'art-' + h.toLowerCase() + '-' + (p ? 'p' : 'n')
      + '-v' + DERIVATION_VERSION + '-s' + api.SHAPE + '.png';
    const ip = (n) => ({ 'x-forwarded-for': '10.9.1.' + n });

    const PH = B.keccak256('png-share-1');
    const t0 = Date.now();
    const p1 = await call('GET', '/api/art/' + PH + '.png?p=1', null, ip(1));
    const ms1 = Date.now() - t0;
    ok('/api/art/<hash>.png 出图 200，且是真 PNG（魔数对）',
      p1.status === 200 && isPNG(p1.body) && p1.hdr['content-type'] === 'image/png',
      p1.status + ' · ' + (isPNG(p1.body) ? (p1.body.length / 1024).toFixed(0) + ' KB' : p1.body.length + ' B')
      + ' · 首次 ' + ms1 + ' ms');
    ok('第一次是现渲（x-png-cache: miss）', p1.hdr['x-png-cache'] === 'miss', p1.hdr['x-png-cache']);
    ok('渲出来的落了盘（.store/png/）', fs.existsSync(path.join(PNGDIR, keyOf(PH, true))));

    const t1 = Date.now();
    const p2 = await call('GET', '/api/art/' + PH + '.png?p=1', null, ip(1));
    const ms2 = Date.now() - t1;
    ok('第二次命中缓存，字节完全一样',
      p2.status === 200 && p2.hdr['x-png-cache'] === 'hit'
      && sha(p1.body) === sha(p2.body),
      '首次 ' + ms1 + ' ms → 命中 ' + ms2 + ' ms');
    ok('命中缓存明显更快（这就是必须落盘的理由）', ms2 <= Math.max(30, ms1 / 2),
      ms1 + ' ms → ' + ms2 + ' ms');

    /* 造物与被干预过的卡按 cardHash 索引 —— 参数变了，按 blockHash 出的还是原生那张。 */
    const pc = await call('GET', '/api/art/card/' + j.cardHash + '.png', null, ip(1));
    ok('/api/art/card/<cardHash>.png 出图 200', pc.status === 200 && isPNG(pc.body),
      pc.status + ' · ' + (isPNG(pc.body) ? (pc.body.length / 1024).toFixed(0) + ' KB' : ''));
    ok('干预过的卡出的图和原生那张不是同一张（参数已经变了）',
      isPNG(pc.body) && sha(pc.body) !== sha(p1.body));
    const pcNone = await call('GET', '/api/art/card/0x' + 'ab'.repeat(32) + '.png', null, ip(1));
    ok('没有这个 cardHash → 404（调用方给错了，不是出图失败）', pcNone.status === 404, pcNone.status + '');

    /* 并发：同一个 hash 同时来十个请求只渲染一次。
       没有这道闸的话，一条链接被转发出去的那一瞬间十个平台同时来抓，
       服务器就同时开十份光栅化 —— 而它和签名跑在同一个事件循环里。 */
    const CH = B.keccak256('png-concurrent');
    const before = PNG._stats().renders;
    const many = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      () => call('GET', '/api/art/' + CH + '.png?p=1', null, ip(2))));
    const rendered = PNG._stats().renders - before;
    ok('同一张图并发 10 个请求：全 200、字节一致、只渲染一次',
      many.every(r => r.status === 200 && isPNG(r.body))
      && new Set(many.map(r => sha(r.body))).size === 1 && rendered === 1,
      '渲染 ' + rendered + ' 次');

    /* 依赖缺失（服务器上没装成 @resvg/resvg-js）：**绝不 500**。
       分享链路不能因为出图挂掉而整个断 —— og:image 500 等于所有平台都没有预览图。 */
    const FH = B.keccak256('png-nodep');
    PNG._setRasterizer(null);
    const f1 = await call('GET', '/api/art/' + FH + '.png?p=1', null, ip(3));
    ok('光栅化依赖缺失时退通用预览图，不是 500',
      f1.status === 200 && isPNG(f1.body) && f1.hdr['x-png-cache'] === 'fallback',
      f1.status + ' · ' + f1.hdr['x-png-cache']);
    ok('退通用图时绝不发 immutable 长缓存（依赖回来了要能出真图）',
      !/immutable/.test(String(f1.hdr['cache-control'])), f1.hdr['cache-control']);
    ok('通用图没被当成这个宇宙的图存进缓存', !fs.existsSync(path.join(PNGDIR, keyOf(FH, true))));
    const sBad = await call('GET', '/s/0x' + FH.slice(2), null, ip(3));
    ok('出图挂着的时候，落地页照常出（分享流程不许被出图带断）',
      sBad.status === 200 && String(sBad.body).indexOf('og:image') > 0, sBad.status + '');
    PNG._setRasterizer(undefined);                    // 恢复：下次调用重新探测
    const f2 = await call('GET', '/api/art/' + FH + '.png?p=1', null, ip(3));
    ok('依赖回来之后同一个 URL 出的是真图，不是刚才那张通用图',
      f2.status === 200 && isPNG(f2.body) && sha(f2.body) !== sha(f1.body)
      && f2.hdr['x-png-cache'] === 'miss', f2.hdr['x-png-cache']);

    /* 渲染本身抛错（SVG 里有认不出的东西、底图丢了…）同样退通用图。 */
    const EH = B.keccak256('png-throw');
    PNG._setRasterizer(function () { throw new Error('假装渲染炸了'); });
    const f3 = await call('GET', '/api/art/' + EH + '.png?p=1', null, ip(4));
    ok('渲染抛错也退通用图，不是 500', f3.status === 200 && isPNG(f3.body)
      && f3.hdr['x-png-cache'] === 'fallback', f3.status + '');
    PNG._setRasterizer(undefined);

    /* 闸与 .svg 逐字同口径：拦「带参数 + 还没算过」，不拦已经算过的和不带参数的。 */
    const G1 = B.keccak256('png-gate-1');
    const g1 = await call('GET', '/api/art/' + G1 + '.png?p=1', null, ip(5));
    ok('出一个没算过的宇宙的 PNG 要扣额度（图上印着结局）',
      g1.status === 200 && Number.isFinite(Number(g1.hdr['x-ratelimit-remaining'])),
      'remaining=' + g1.hdr['x-ratelimit-remaining']);
    const g2 = await call('GET', '/api/art/' + G1 + '.png', null, ip(5));
    ok('不带 p=1 的 PNG 不扣额度（它一个字的结局都没印）',
      g2.status === 200 && g2.hdr['x-ratelimit-remaining'] === undefined,
      'remaining 头=' + g2.hdr['x-ratelimit-remaining']);

    /* 审查 #19：ARCBANG_PNG_CONCURRENCY 配错（非数字）时 Number() 是 NaN，
       running < NaN 恒 false —— 一个名额都发不出去，所有请求进 waiters 永远等。 */
    ok('ARCBANG_PNG_CONCURRENCY 非数字/0/负数不锁死信号量（NaN→2、0→1、"4"→4）；Infinity/过大夹到 8',
      PNG._renderMaxOf('abc') === 2 && PNG._renderMaxOf(undefined) === 2
      && PNG._renderMaxOf('') === 2 && PNG._renderMaxOf('0') === 1
      && PNG._renderMaxOf('-3') === 1 && PNG._renderMaxOf('4') === 4
      && PNG._renderMaxOf('Infinity') === 2 && PNG._renderMaxOf('100') === 8);
  }

  console.log('\n[广播 落地页] /s/<区块号>：真页面，爬虫与人拿同一份');
  {
    /*。app.html 是 SPA，静态 HTML 里的 og 是死的，
       所以服务端单开这条路：真实 og + 真页面（不再自动跳转，见 landing.js）。 */
    const { OUTCOME_EN } = require('./art.js');
    const savedBBN = chainMod.blockByNumber;
    const NUM = 8642956;
    chainMod.blockByNumber = async (n) => (n === NUM ? { number: n, hash: H[0] } : null);
    const bot = { 'user-agent': 'Twitterbot/1.0', 'x-forwarded-for': '10.9.2.1' };
    const { card: realCard } = buildCard(H[0], NUM);

    const s = await call('GET', '/s/' + NUM + '?ref=K7M2X9QP', null, bot);
    const html = String(s.body);
    ok('/s/<区块号> 返回 200 的 HTML', s.status === 200
      && /^<!doctype html>/i.test(html) && /text\/html/.test(String(s.hdr['content-type'])),
      s.status + ' · ' + html.length + ' 字节');
    ok('og:image 指向那枚宇宙的 PNG（不是 SVG，多数平台不认 SVG）',
      new RegExp('og:image" content="[^"]*/api/art/' + H[0] + '\\.png').test(html),
      (html.match(/og:image" content="([^"]+)"/) || [])[1]);
    ok('og:title 写的是真实结局，不是一句通用标语',
      html.indexOf('og:title" content="Universe from BNB block #8,642,956 — ' + OUTCOME_EN[realCard.outcome.index]) > 0,
      OUTCOME_EN[realCard.outcome.index]);
    ok('og:description 带真实物理参数（维度 / α）',
      html.indexOf('D = ' + realCard.dimension.D.toFixed(3)) > 0
      && html.indexOf('α = 1/' + realCard.constants.alphaInv.toFixed(2)) > 0);
    ok('twitter:card 是 summary_large_image', /twitter:card" content="summary_large_image"/.test(html));
    ok('不再自动跳转；进模拟器的按钮指向 app.html，且 ?ref= 一路带过去',
      html.indexOf('http-equiv="refresh"') < 0 && html.indexOf('location.replace') < 0
      && html.indexOf('href="/app.html?bang=8642956&amp;ref=K7M2X9QP"') > 0);

    /* 查不到的区块号 → 跳首页。分享链接落地成一句"没有这个区块"对收链接的人毫无意义。 */
    const miss = await call('GET', '/s/999999999', null, bot);
    ok('区块号查不到就跳首页，不给错误页', miss.status === 302 && miss.hdr.location === '/',
      miss.status + ' → ' + miss.hdr.location);

    /* RPC 全挂：是我们的故障，不是链接的错 —— 照样出页面，但**不猜结局**。 */
    chainMod.blockByNumber = async () => { const e = new Error('所有 RPC 节点都打不通'); e.rpcDown = true; throw e; };
    const down = await call('GET', '/s/8600001', null, bot);
    const dh = String(down.body);
    ok('RPC 挂了照样给页面（不 500、不报错页）', down.status === 200 && /og:title/.test(dh), down.status + '');
    ok('拿不到 card 时不编结局，og:image 退到站点通用预览图',
      dh.indexOf('/api/art/preview.png') > 0 && dh.indexOf('Universe from BNB block #8,600,001') > 0
      && dh.indexOf('Outcome not computed yet') > 0);
    ok('降级时按钮照样指向 app.html（前端自己会再查一次）',
      dh.indexOf('/app.html?bang=8600001') > 0);
    chainMod.blockByNumber = async (n) => (n === NUM ? { number: n, hash: H[0] } : null);

    /* 造物的起源、老存档拿不到区块号 —— /s/<0x哈希> 也要认。 */
    const sh = await call('GET', '/s/' + H[2], null, bot);
    ok('/s/<0x哈希> 同样出 og（老链接不能失效）',
      sh.status === 200 && String(sh.body).indexOf('/app.html?bang=' + H[2]) > 0, sh.status + '');

    /* query 完全来自请求方，而它要进 HTML 属性和一行 JS 字面量。白名单挡在最前面。 */
    const inj = await call('GET',
      '/s/' + NUM + '?ref=' + encodeURIComponent('"><script>alert(1)</script>') + '&utm_source=x', null, bot);
    const ih = String(inj.body);
    ok('query 里的注入进不了页面（键值都过白名单）',
      ih.indexOf('alert(1)') < 0 && ih.indexOf('<script>alert') < 0
      && ih.indexOf('bang=8642956&amp;utm_source=x') > 0);

    /* 落地页也能算出结局 —— 它必须和出图那条路一样受闸约束，否则又是一条扫描接口。
       但被拦下时不报 429：爬虫要的是能抓到东西，降级成通用文案就好。 */
    const scanIp = { 'user-agent': 'Twitterbot/1.0', 'x-forwarded-for': '10.9.2.7' };
    let degraded = 0, tried = 0;
    for (let i = 0; i < 40 && !degraded; i++) {
      const n = 8700000 + i;
      chainMod.blockByNumber = async () => ({ number: n, hash: B.keccak256('scan-' + n) });
      const r = await call('GET', '/s/' + n, null, scanIp);
      tried++;
      if (r.status === 200 && String(r.body).indexOf('Outcome not computed yet') > 0) degraded = tried;
    }
    ok('拿落地页扫全链会被闸拦成通用文案（且仍然是 200，不是 429）', degraded > 0,
      '第 ' + degraded + ' 个区块号起只给通用文案');

    chainMod.blockByNumber = savedBBN;
  }

  console.log('\n[RPC 中继] POST /api/rpc（server/rpcrelay.js）');
  {
    const RELAY = require('./rpcrelay.js');
    const CH = require('./chain.js');
    const OK_TO = '0x' + '33'.repeat(20);
    const savedTo = process.env.ARCBANG_RELAY_TO;
    process.env.ARCBANG_RELAY_TO = OK_TO;
    RELAY._reset();
    const savedFetch = global.fetch;
    let seen = [];                      // 每次上游请求：{ url, payload }
    let upstream = (payload) => (Array.isArray(payload) ? payload : [payload]).map((r) => ({ jsonrpc: '2.0', id: r.id, result: '0x' + '00'.repeat(31) + '2a' }));
    global.fetch = async (url, opt) => {
      const payload = JSON.parse(opt.body);
      seen.push({ url, payload });
      const out = upstream(payload, url);
      if (out instanceof Error) throw out;
      return { ok: true, json: async () => (Array.isArray(payload) ? out : out[0]) };
    };
    try {
      const g = await call('GET', '/api/rpc');
      ok('GET /api/rpc → 405', g.status === 405);
      const nj = await call('POST', '/api/rpc', 'not json');
      ok('非 JSON → 400 / -32700', nj.status === 400 && JSON.parse(nj.body).error.code === -32700);
      const bm = await call('POST', '/api/rpc', { jsonrpc: '2.0', id: 7, method: 'eth_sendRawTransaction', params: ['0x00'] });
      ok('写链方法 → -32601（HTTP 200，JSON-RPC 口径）', bm.status === 200 && JSON.parse(bm.body).error.code === -32601 && JSON.parse(bm.body).id === 7, bm.body.slice(0, 80));
      const bt = await call('POST', '/api/rpc', { jsonrpc: '2.0', id: 8, method: 'eth_call', params: [{ to: '0x' + '44'.repeat(20), data: '0x18160ddd' }, 'latest'] });
      ok('eth_call 到非本站合约 → -32602', JSON.parse(bt.body).error.code === -32602);
      seen = [];
      const ok1 = await call('POST', '/api/rpc', { jsonrpc: '2.0', id: 'abc', method: 'eth_call', params: [{ to: OK_TO, data: '0x18160ddd' }, 'latest'] });
      const j1 = JSON.parse(ok1.body);
      ok('eth_call 到本站合约 → 转发、result 透传、id 原样、no-store',
        ok1.status === 200 && j1.id === 'abc' && /2a$/.test(j1.result) && /no-store/.test(String(ok1.hdr['cache-control'])) && seen.length === 1,
        ok1.body.slice(0, 100));
      ok('上游收到的是规范化后的调用（to 小写、latest、无多余字段）',
        seen[0] && seen[0].payload.params[0].to === OK_TO && seen[0].payload.params[1] === 'latest' && !('gas' in seen[0].payload.params[0]));
      seen = [];
      const batch = await call('POST', '/api/rpc', [
        { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: '0x' + '55'.repeat(20), data: '0x' }, 'latest'] },
        { jsonrpc: '2.0', id: 3, method: 'eth_getBlockByNumber', params: ['0x10', true] }
      ]);
      const jb = JSON.parse(batch.body);
      ok('批量：回数组、顺序与 id 对应、坏的那条就地报错、好的两条合成一个上游请求',
        Array.isArray(jb) && jb.length === 3 && jb[0].id === 1 && jb[0].result && jb[1].error && jb[1].error.code === -32602 && jb[2].result
        && seen.length === 1 && Array.isArray(seen[0].payload) && seen[0].payload.length === 2,
        batch.body.slice(0, 120));
      ok('eth_getBlockByNumber 的第二个参数被强制成 false（不带整块交易）',
        seen[0].payload.some((r) => r.method === 'eth_getBlockByNumber' && r.params[1] === false));
      // 第一个节点打不通 → 换下一个
      seen = [];
      let nth = 0;
      upstream = (payload) => { nth++; if (nth === 1) return new Error('ECONNRESET'); return (Array.isArray(payload) ? payload : [payload]).map((r) => ({ jsonrpc: '2.0', id: r.id, result: '0x1' })); };
      const fo = await call('POST', '/api/rpc', { jsonrpc: '2.0', id: 9, method: 'eth_blockNumber', params: [] });
      ok('第一个节点打不通 → 换下一个节点答复（RPCS ≥ 2 时）',
        CH.RPCS.length < 2 ? JSON.parse(fo.body).error && JSON.parse(fo.body).error.code === -32000 : JSON.parse(fo.body).result === '0x1',
        'RPCS=' + CH.RPCS.length + ' ' + fo.body.slice(0, 80));
      // 节点答了 revert → 原样透传，不换节点
      seen = [];
      upstream = (payload) => (Array.isArray(payload) ? payload : [payload]).map((r) => ({ jsonrpc: '2.0', id: r.id, error: { code: 3, message: 'execution reverted', data: '0x' } }));
      const rv = await call('POST', '/api/rpc', { jsonrpc: '2.0', id: 10, method: 'eth_call', params: [{ to: OK_TO, data: '0x12345678' }, 'latest'] });
      ok('revert 透传（code 3），只问了一个节点', JSON.parse(rv.body).error.code === 3 && seen.length === 1, rv.body.slice(0, 80));
      // 全部节点打不通 → 每条 -32000，HTTP 仍 200
      upstream = () => new Error('down');
      const dn = await call('POST', '/api/rpc', [{ jsonrpc: '2.0', id: 11, method: 'eth_blockNumber', params: [] }]);
      const jd = JSON.parse(dn.body);
      ok('全部节点打不通 → 每条 -32000，HTTP 200', dn.status === 200 && jd[0].error.code === -32000, dn.body.slice(0, 80));
      upstream = (payload) => (Array.isArray(payload) ? payload : [payload]).map((r) => ({ jsonrpc: '2.0', id: r.id, result: [] }));
      // eth_getLogs：跨度封顶、地址白名单、topics 规范化
      const big = await call('POST', '/api/rpc', { jsonrpc: '2.0', id: 12, method: 'eth_getLogs', params: [{ address: OK_TO, fromBlock: '0x1', toBlock: '0x' + (RELAY.LOG_RANGE + 2).toString(16) }] });
      ok('eth_getLogs 跨度超过 ' + RELAY.LOG_RANGE + ' → -32602', JSON.parse(big.body).error && JSON.parse(big.body).error.code === -32602, big.body.slice(0, 80));
      seen = [];
      const lg = await call('POST', '/api/rpc', { jsonrpc: '2.0', id: 13, method: 'eth_getLogs', params: [{ address: OK_TO.toUpperCase().replace('0X', '0x'), fromBlock: '0x10', toBlock: '0x20', topics: [null, ['0x' + 'AB'.repeat(32)]] }] });
      ok('eth_getLogs 合法请求 → 转发到日志节点，地址/topics 小写化',
        JSON.parse(lg.body).result && seen.length === 1 && seen[0].payload.params[0].address[0] === OK_TO && seen[0].payload.params[0].topics[1][0] === '0x' + 'ab'.repeat(32),
        JSON.stringify(seen[0] && seen[0].payload.params[0]).slice(0, 120));
      // 体积与批量上限
      const huge = await call('POST', '/api/rpc', '[' + '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]},'.repeat(1500) + '{}]');
      ok('请求体 > 64 KB → 413', huge.status === 413, String(huge.status));
      const many = await call('POST', '/api/rpc', Array.from({ length: RELAY.MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_blockNumber', params: [] })));
      ok('批量超过 ' + RELAY.MAX_BATCH + ' 条 → 400', many.status === 400, String(many.status));
      // 限流：按 IP、按条计
      RELAY._reset(); process.env.ARCBANG_RELAY_TO = OK_TO;
      ok('限流：额度内放行', RELAY.take('9.9.9.9', RELAY.PER_MIN).ok === true);
      ok('限流：超一条就拒', RELAY.take('9.9.9.9', 1).ok === false);
      ok('限流：别的 IP 不受影响', RELAY.take('9.9.9.8', 1).ok === true);
      const lim = await call('POST', '/api/rpc', Array.from({ length: RELAY.MAX_BATCH }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_blockNumber', params: [] })), { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '9.9.9.9' });
      ok('限流命中 → 429 + retry-after', lim.status === 429 && lim.hdr['retry-after'], String(lim.status));
    } finally {
      global.fetch = savedFetch;
      if (savedTo === undefined) delete process.env.ARCBANG_RELAY_TO; else process.env.ARCBANG_RELAY_TO = savedTo;
      RELAY._reset();
    }
  }

  console.log('\n[W] 钱包层 / 链访问层（2026-08-22 审查修复的桩验）');
  {
    const vm = require('vm');
    const readWeb = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');

    /* ---- arc-chain.js：freeStatus 三态（新合约 / 旧合约 revert / 网络失败）+ 模拟总检。
       在 vm 沙盒里加载**真文件**，fetch 换成可控桩 —— 测的是发布的那份代码，不是复述。 */
    {
      const sb = {
        MirrorKeccak: { keccak256: B.keccak256 },
        ARCBANG_CONFIG: {
          contract: '0x' + '11'.repeat(20),
          rpc: ['http://rpc-stub.invalid'],
          chain: { id: 97, name: 'BSC 测试网', nameEn: 'BSC Testnet', explorer: 'https://x.invalid', currency: 'tBNB', isTestnet: true }
        },
        TextEncoder, TextDecoder,
        console: { warn() { }, log() { }, error() { } }
      };
      let fetchImpl = () => Promise.reject(new Error('fetch 桩还没设'));
      sb.fetch = (...a) => fetchImpl(...a);
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(readWeb('arc-chain.js'), sb, { filename: 'arc-chain.js' });
      const MC = sb.MirrorChain;
      const ADDR = '0x' + '22'.repeat(20);
      const w32 = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
      const mkRes = (j) => Promise.resolve({ ok: true, json: () => Promise.resolve(j) });
      const selFMC = MC.selector('freeMintCount(address)');
      const selFPA = MC.selector('freePerAddr()');
      const selFreeLeft = MC.selector('freeLeft()');
      const selUsed = MC.selector('usedFree(address)');
      const selPrice = MC.selector('price()');
      /* 2026-09-02 起 rpc() 会把同一时刻的调用合并成批量（数组）发出：桩要两种都认，
         批量按条答、带回 id；单条照旧。 */
      const byuSel = (map) => (url, opt) => {
        const req = JSON.parse(opt.body);
        const one = (r) => {
          const sel = String(r.params[0].data).slice(0, 10);
          const p = map[sel] ? map[sel]() : mkRes({ error: { message: 'unexpected ' + sel } });
          return p.then((x) => x.json()).then((j) => Object.assign({ jsonrpc: '2.0', id: r.id }, j));
        };
        if (Array.isArray(req)) return Promise.all(req.map(one)).then((arr) => ({ ok: true, json: () => Promise.resolve(arr) }));
        return one(req).then((j) => ({ ok: true, json: () => Promise.resolve(j) }));
      };

      fetchImpl = byuSel({ [selFMC]: () => mkRes({ result: w32(3) }), [selFPA]: () => mkRes({ result: w32(10) }) });
      const st1 = await MC.freeStatus(ADDR);
      ok('freeStatus 新合约：supported=true 且 used/cap 现读',
        st1.supported === true && st1.used === 3n && st1.cap === 10n, JSON.stringify({ u: String(st1.used), c: String(st1.cap) }));

      fetchImpl = () => mkRes({ error: { message: 'execution reverted', code: 3, data: '0x' } });
      const st2 = await MC.freeStatus(ADDR);
      ok('freeStatus 旧合约（eth_call revert）：supported=false 回退', st2.supported === false);

      fetchImpl = () => mkRes({ result: '0x' });
      const st3 = await MC.freeStatus(ADDR);
      ok('freeStatus 节点回空数据（方法不存在）：supported=false 回退', st3.supported === false);

      fetchImpl = () => Promise.reject(new Error('node down'));
      let netErr = null;
      try { await MC.freeStatus(ADDR); } catch (e) { netErr = e; }
      ok('freeStatus 网络失败：重试后明确报错（rpcDown），不冒充旧合约',
        !!(netErr && netErr.rpcDown), netErr ? netErr.message.slice(0, 40) : '(没抛)');

      fetchImpl = byuSel({
        [selFreeLeft]: () => mkRes({ result: w32(5) }),
        [selFMC]: () => Promise.reject(new Error('node down')),
        [selFPA]: () => Promise.reject(new Error('node down'))
      });
      let mvErr = null;
      try { await MC.mintValueFor(ADDR, 0); } catch (e) { mvErr = e; }
      ok('mintValueFor：免费口状态读不到时报错，不按 0 报价（不静默走旧闸）',
        !!(mvErr && mvErr.rpcDown));

      fetchImpl = byuSel({
        [selFreeLeft]: () => mkRes({ result: w32(5) }),
        [selFMC]: () => mkRes({ error: { message: 'execution reverted' } }),
        [selFPA]: () => mkRes({ error: { message: 'execution reverted' } }),
        [selUsed]: () => mkRes({ result: w32(1) }),
        [selPrice]: () => mkRes({ result: w32(10n ** 16n) })
      });
      ok('mintValueFor 旧合约回退：usedFree=true → 报 price（一口价），不是 0',
        await MC.mintValueFor(ADDR, 0) === 10n ** 16n);

      let seen = null;
      fetchImpl = (url, opt) => { seen = JSON.parse(opt.body); return mkRes({ result: '0x' }); };
      await MC.simulateBangSigned({
        blockHash: '0x' + 'ab'.repeat(32), blockNumber: 123, outcome: 9, rarity: 2,
        cardHash: '0x' + 'cd'.repeat(32), deadline: 1900000000,
        sig: '0x' + '11'.repeat(65), payWithBang: false, valueWei: 5n
      }, ADDR);
      const selBang = MC.selector('bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes,bool)');
      ok('simulateBangSigned：走 eth_call，同 from / value / calldata（选择器同 bangSigned）',
        !!seen && seen.method === 'eth_call'
        && seen.params[0].from === ADDR && seen.params[0].value === '0x5'
        && String(seen.params[0].data).slice(0, 10) === selBang
        && seen.params[1] === 'latest');
    }

    /* ---- wallet.js：6963 监听只注册一次 / 深链 url 编码 / 老币安壳 hex→UTF-8 ---- */
    {
      const listeners = [];
      let requests = 0;
      const seenSign = [];
      const sb = {
        console: { warn() { }, log() { }, error() { } },
        addEventListener: (ev, fn) => { if (ev === 'eip6963:announceProvider') listeners.push(fn); },
        dispatchEvent: (e) => { if (e && e.type === 'eip6963:requestProvider') requests++; return true; },
        CustomEvent: function CustomEvent(type) { this.type = type; },
        btoa: (s) => Buffer.from(String(s), 'latin1').toString('base64'),
        navigator: { userAgent: 'iPhone' },
        location: { href: 'https://bnbbang.com/app.html?bang=8642956&ref=K7M2X9QP' },
        setTimeout: () => null,                        // 掐掉 300/1200ms 的自动重扫，测试手动 rescan
        ARCBANG_CONFIG: { chain: { id: 56 } },
        BinanceChain: {
          request: (args) => { seenSign.push(args); return Promise.resolve('0x' + '00'.repeat(65)); },
          switchNetwork: () => Promise.resolve()
        }
      };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(readWeb('wallet.js'), sb, { filename: 'wallet.js' });
      const MW = sb.MirrorWallet;

      MW.rescan(); MW.rescan(); MW.rescan();
      ok('6963 监听只注册一次；rescan 只是再广播 requestProvider',
        listeners.length === 1 && requests >= 4, 'listeners=' + listeners.length + ' requests=' + requests);

      const p = MW.provider();
      const MYADDR = '0x' + 'ab'.repeat(20);
      const MSGTXT = 'BNBBANG refcode K7M2X9QP 1755000000';
      const hexMsg = '0x' + Buffer.from(MSGTXT, 'utf8').toString('hex');
      await p.request({ method: 'personal_sign', params: [hexMsg, MYADDR] });
      const g1 = seenSign[seenSign.length - 1];
      ok('老币安壳：personal_sign → eth_sign 参数序 [地址, 消息] 且 hex 解回 UTF-8 明文（真机待核实）',
        g1.method === 'eth_sign' && g1.params[0] === MYADDR && g1.params[1] === MSGTXT,
        JSON.stringify(g1.params[1]).slice(0, 50));
      await p.request({ method: 'personal_sign', params: ['plain text', MYADDR] });
      ok('老币安壳：不是 hex 的消息原样透传', seenSign[seenSign.length - 1].params[1] === 'plain text');

      const dl = MW.binanceDeepLink('https://bnbbang.com/app.html?bang=8642956&ref=K7M2X9QP', 56);
      const q = Buffer.from(dl.bnc.split('startPageQuery=')[1], 'base64').toString('latin1');
      const m = /^url=([^&]+)&defaultChainId=56$/.exec(q);
      ok('深链 url 参数已 URI 编码（页面自带的 &ref= 不再被拆成外层参数）',
        !!m && decodeURIComponent(m[1]) === 'https://bnbbang.com/app.html?bang=8642956&ref=K7M2X9QP',
        q.slice(0, 60));
    }

    /* ---- DOM 绑死的流程（bnb-ui / intervene）桩不进来，用**源码不变量**把关：
       改回老写法（活指针、无守卫、无刷新）这些会当场红。 */
    {
      const src = readWeb('arc-ui.js');
      ok('铸造签名按 hash0 要（活指针 S.hash 不再进 API.bang）',
        src.indexOf('API.bang(hash0') >= 0 && src.indexOf('API.bang(S.hash') < 0);
      ok('铸造有 blockHash === hash0 硬校验（intervene.js 拯救路径的同款）',
        src.indexOf('String(d.card.blockHash).toLowerCase() !== String(hash0).toLowerCase()') >= 0);
      const iSim = src.indexOf('C.simulateBangSigned(txArgs(');
      const iSend = src.indexOf('return C.bangSigned(txArgs(');
      ok('主铸造路径发交易前先 eth_call 模拟（模拟在真发之前）', iSim >= 0 && iSend > iSim);
      const iOk = src.indexOf('S.minted = -1;');
      ok('铸造成功后立刻刷新免费计数与价格',
        iOk >= 0 && src.indexOf('refreshFreeStatus();', iOk) >= 0
        && src.indexOf('loadPrices();', iOk) >= 0
        && src.indexOf('refreshFreeStatus();', iOk) < src.indexOf('loadGallery();', iOk));
      const iGen = src.indexOf('if (gen !== SHARE_GEN) return;');
      const iApp = src.indexOf('doc.body.appendChild(pop);');
      ok('广播浮层：closeShare 推进代际、append 前核对代际',
        iGen >= 0 && iApp > iGen && /function closeShare\(\) \{\s*SHARE_GEN\+\+/.test(src));
      ok('钱包事件绑在选中的 provider 上并随选择迁移，不再绑 root.ethereum',
        src.indexOf('function bindWalletEvents') >= 0
        && src.indexOf('MirrorWallet.onChange(bindWalletEvents)') >= 0
        && src.indexOf("root.ethereum.on('accountsChanged'") < 0);
      ok('免费次数行是「已用 X / Y 次免费」的语义', src.indexOf('已用 {0} / {1} 次免费') >= 0
        && src.indexOf('免费次数：{0} / {1}') < 0);
      /* ARCBANG 没有代币：面板里一个 BANG 数额都不许出现，也不许去问合约的 rewardPerMint
         （ArcUniverse 上没有这个方法，读了必 revert）。 */
      ok('铸造按钮只标价、不提代币奖励', src.indexOf('rewardPerMint') < 0
        && src.indexOf('bangAmt(') < 0
        && src.indexOf("TX('{0} {1} 铸造', C.fmtBNB(W.price), chainCur())") >= 0);

      const srcI = readWeb('intervene.js');
      ok('报价失败不永久钉死（记时间戳冷却重试，不写 quote=null）',
        srcI.indexOf('stt.quoteFailAt = Date.now()') >= 0
        && srcI.indexOf('stt.quoting = false; stt.quote = null;') < 0);
      ok('报价回来核对 ops 快照，状态变了就丢弃', srcI.indexOf('JSON.stringify(S.box.ops()) !== snap') >= 0);

      const srcL = readWeb('i18n-app.js');
      ok('i18n：三条新话术都有英译', srcL.indexOf('Free mints used: {0} / {1}') >= 0
        && srcL.indexOf('The server signed a different block hash') >= 0
        && srcL.indexOf('The mint simulation was reverted on-chain') >= 0);
    }
  }

  console.log('\n[C3] 拒绝非区块哈希（需要联网，失败只说明网络不通）');
  const { blockByHash } = require('./chain.js');
  try {
    const fake = await blockByHash('0x' + 'ab'.repeat(32));
    ok('伪造哈希查不到区块', fake === null, fake ? '竟然查到了：' + JSON.stringify(fake) : '');
  } catch (e) {
    console.log('  - 跳过：' + e.message);
  }
  console.log('\n[SEC] 管理员门禁 / 骗签面 / 限流 / JSON / 路径 / 泄漏');
  {
    const PNG = require('./png.js');
    const secIp = (n) => ({ 'x-forwarded-for': '198.51.100.' + n });

    /* ---- 签名 TTL 夹紧：NaN 会签出 deadline=NaN 的废名；十年等于把印章送人 ---- */
    ok('TTL 默认 600，NaN/空串回 600，0 抬到 30，十年压到 3600',
      _ttlOf(undefined) === 600 && _ttlOf('') === 600 && _ttlOf('abc') === 600
      && _ttlOf('0') === 30 && _ttlOf('-1') === 30 && _ttlOf('999999') === 3600
      && _ttlOf('600') === 600);

    /* ---- 管理员 IP：伪造 CF-Connecting-IP / XFF 第一段不能过门；X-Real-IP 才能 ---- */
    const savedAdmin = process.env.ARCBANG_ADMIN_IPS;
    process.env.ARCBANG_ADMIN_IPS = '203.0.113.10';
    const adminHdr = (h) => call('GET', '/api/admin-check', null, h);
    const cf = await adminHdr({ 'cf-connecting-ip': '203.0.113.10' });
    const cj = cf.status === 200 ? JSON.parse(cf.body) : {};
    ok('伪造 CF-Connecting-IP 当不成管理员', cf.status === 200 && cj.admin === false,
      JSON.stringify(cj));
    const xff1 = await adminHdr({ 'x-forwarded-for': '203.0.113.10, 198.51.100.1' });
    ok('伪造 XFF 第一段当不成管理员（取的是最后一跳）',
      xff1.status === 200 && JSON.parse(xff1.body).admin === false);
    const realIp = await adminHdr({ 'x-real-ip': '203.0.113.10' });
    ok('nginx 覆盖的 X-Real-IP 命中白名单才是管理员',
      realIp.status === 200 && JSON.parse(realIp.body).admin === true,
      JSON.stringify(JSON.parse(realIp.body)));
    ok('admin-check 回的 ip 不是伪造的 CF 头',
      JSON.parse(cf.body).ip !== '203.0.113.10');

    if (savedAdmin === undefined) delete process.env.ARCBANG_ADMIN_IPS;
    else process.env.ARCBANG_ADMIN_IPS = savedAdmin;

    /* ---- 客户端不能自报 deadline / nowSec 来把有效期拉长 ---- */
    const fakeDl = await call('POST', '/api/intervene', {
      blockHash: H[2], tokenId: 7, oldCardHash: IV.baseHash,
      ops: [{ key: 'alpha', dir: 1, steps: 1 }],
      deadline: 9999999999, nowSec: 1
    }, secIp(2));
    const fdj = fakeDl.status === 200 ? JSON.parse(fakeDl.body) : {};
    ok('请求里带 deadline/nowSec 不影响服务端自己算的有效期（600s 量级）',
      fakeDl.status === 200 && typeof fdj.deadline === 'number'
      && fdj.deadline <= Math.floor(Date.now() / 1000) + 3600 + 5
      && fdj.deadline >= Math.floor(Date.now() / 1000) + 30,
      'deadline=' + fdj.deadline + ' status=' + fakeDl.status + ' ' + String(fakeDl.body).slice(0, 80));
    /* ---- JSON 炸弹 / 原型污染键 ---- */
    const protoBody = '{"__proto__":{"admin":true},"blockHash":"' + H[0] + '"}';
    const proto = await call('POST', '/api/bang', protoBody, secIp(4));
    ok('请求体带 __proto__ 键 → 400，不往下签', proto.status === 400, proto.status + '');
    let deep = '0';
    for (let i = 0; i < 30; i++) deep = '{"a":' + deep + '}';
    const bomb = await call('POST', '/api/bang', deep, secIp(5));
    ok('嵌套过深的 JSON → 400 不是 500', bomb.status === 400, bomb.status + '');
    const arr = await call('POST', '/api/bang', '[1,2,3]', secIp(6));
    ok('顶层是数组 → 400', arr.status === 400);

    /* ---- 路径穿越：出图文件名只认 0x + 64 hex ---- */
    const trav = await call('GET', '/api/art/..%2f..%2fpackage.json');
    ok('art 路径穿越 → 404（不是把 package.json 发出去）',
      trav.status === 404 && String(trav.body).indexOf('"name"') < 0, trav.status + '');
    const trav2 = await call('GET', '/api/art/card/../' + 'aa'.repeat(32) + '.svg');
    ok('art/card 夹杂 .. → 404', trav2.status === 404);
    const pngTrav = await PNG.pngFor('../etc/passwd', () => { throw new Error('不该渲'); });
    ok('pngFor 拒绝带 / 的 key，退通用图而不是读盘',
      pngTrav.fallback === true && Buffer.isBuffer(pngTrav.buf));

    /* ---- 错误回包不带路径 / 密钥 / 环境变量值 ---- */
    const big = await call('POST', '/api/bang', JSON.stringify({ pad: 'x'.repeat(9000) }), secIp(7));
    ok('413 回包没有文件系统路径',
      big.status === 413 && !/[A-Za-z]:\\/.test(String(big.body)) && !/\/etc\//.test(String(big.body)));
    const savedStub = ethCallStub;
    ethCallStub = () => '0x';
    const noCode = await call('GET', '/api/token/5');
    ethCallStub = savedStub;
    ok('502 回包没有 detail 字段、不含私钥',
      noCode.status === 502 && String(noCode.body).indexOf('detail') < 0
      && !/11{10,}/.test(String(noCode.body)), String(noCode.body).slice(0, 80));

    /* ---- /limit/challenge 按 IP 限流，刷 nonce 撑爆内存这条路被堵住 ---- */
    const ADDR = '0x' + 'ab'.repeat(20);
    let chOk = 0, ch429 = 0;
    for (let i = 0; i < 35; i++) {
      const r = await call('POST', '/api/limit/challenge', { address: ADDR }, secIp(8));
      if (r.status === 200) chOk++;
      else if (r.status === 429) ch429++;
    }
    ok('/limit/challenge 超额 429（不能拿它灌 nonce 表）',
      chOk === 30 && ch429 === 5, '200×' + chOk + ' 429×' + ch429);

    /* ---- 测试钩子只在 module.exports 上，生产 HTTP 触发不了 ---- */
    const hook404 = await Promise.all([
      call('GET', '/api/_setRasterizer'),
      call('POST', '/api/_reload'),
      call('GET', '/api/_resetGrantedCacheForTest'),
      call('POST', '/api/_stats')
    ]);
    ok('测试钩子没有 HTTP 入口（生产请求 404）',
      hook404.every((r) => r.status === 404), hook404.map((r) => r.status).join(','));

    /* ---- 第二轮：SIG_V2 / cardShape 不能被请求体切换；env 非法值；RPC URL 脱敏 ---- */
    const { envInt } = require('./envint.js');
    ok('envInt：NaN/空/Infinity 回默认，越界夹紧（NaN 限流等于关掉）',
      envInt(undefined, 30, 1, 100) === 30 && envInt('', 30, 1, 100) === 30
      && envInt('abc', 30, 1, 100) === 30 && envInt('Infinity', 30, 1, 100) === 30
      && envInt('0', 30, 1, 100) === 1 && envInt('-5', 30, 1, 100) === 1
      && envInt('9999', 30, 1, 100) === 100 && envInt('50', 30, 1, 100) === 50);

    const { redactUrl } = require('./chain.js');
    ok('RPC URL 脱敏：userinfo 与 path key 不进日志',
      redactUrl('https://user:pass@bsc-dataseed.binance.org/v2/SECRET') === 'https://bsc-dataseed.binance.org/…'
      && redactUrl('http://127.0.0.1:8546') === 'http://127.0.0.1:8546'
      && redactUrl('not a url') === '[rpc]');

    const v1switch = await call('POST', '/api/intervene', {
      blockHash: H[2], tokenId: 7, oldCardHash: IV.baseHash,
      ops: [{ key: 'alpha', dir: 1, steps: 1 }],
      sigV2: true, sigVersion: 2, ARCBANG_SIG_V2: '1',
      minter: '0x' + '22'.repeat(20), cardShape: 2
    }, secIp(11));
    const v1sj = v1switch.status === 200 ? JSON.parse(v1switch.body) : {};
    ok('v1 下请求体 sigV2/cardShape 不能把签发切到 v2 或把指纹降到 2',
      v1switch.status === 200 && v1sj.card && v1sj.card.cardShape === 3 && v1sj.sig,
      v1switch.status + ' shape=' + (v1sj.card && v1sj.card.cardShape));
    if (v1sj.sig) {
      const dgV1 = interveneDigest(CHAIN_ID, process.env.ARCBANG_CONTRACT, 7n, IV.baseHash, v1sj.cardHash,
        v1sj.card.outcome.index, v1sj.card.rarity.index, BigInt(v1sj.costBang), v1sj.deadline,
        opsHashOf(v1sj.ops));
      ok('v1 摘要（无 minter）能还原签名：请求体没把协议切到 v2',
        verifyMessage(getBytes(dgV1), v1sj.sig).toLowerCase() === String(v1sj.signer).toLowerCase());
    }

    const savedV2 = process.env.ARCBANG_SIG_V2;
    process.env.ARCBANG_SIG_V2 = '1';
    const v2off = await call('POST', '/api/intervene', {
      blockHash: H[2], tokenId: 7, oldCardHash: IV.baseHash,
      ops: [{ key: 'alpha', dir: 1, steps: 1 }],
      sigV2: false, cardShape: 2
    }, secIp(12));
    ok('v2 下请求体 sigV2:false 仍要 minter（不能靠参数把 v2 关掉）',
      v2off.status === 400 && /minter/.test(String(v2off.body)), v2off.status + '');
    if (savedV2 === undefined) delete process.env.ARCBANG_SIG_V2;
    else process.env.ARCBANG_SIG_V2 = savedV2;
  }
  console.log('\n[SEO 落地页] /s/ 可索引：英文真页面、robots 口径、sitemap、1200×630 og 图');
  {
    /* 落地页从「跳转页」改成「真页面」之后要盯住的事：
       页面本体（英文、结局、解释、常数表、CTA、无跳转、<12 KB）、robots 口径（已铸/精选/附加 → index，
       其余 noindex）、sitemap（结构、分页、lastmod、名单文件缺/坏不报错）、
       铸造反查三态诚实、og 变体真是 1200×630 且缓存键不串、任何一环挂了都不 500。 */
    const { OUTCOME_EN } = require('./art.js');
    const SEO = require('./seo.js');
    const OGM = require('./og.js');
    const LANDING = require('./landing.js');
    const MI = require('./marketindex.js');
    const PNG = require('./png.js');
    const BASE = process.env.ARCBANG_PUBLIC_BASE;
    const savedBBN = chainMod.blockByNumber;
    const NUM = 8642956;
    chainMod.blockByNumber = async (n) => (n === NUM ? { number: n, hash: H[0] }
      : (n === 4242 ? { number: n, hash: H[1] } : null));
    const ipS = (n) => ({ 'x-forwarded-for': '10.9.3.' + n });
    const { card: rc } = buildCard(H[0], NUM);
    const en = OUTCOME_EN[rc.outcome.index];
    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    /* 名单先全部清掉：这个高度既没铸造也不在名单里 → noindex */
    const savedCur = process.env.ARCBANG_SHARE_CURATED, savedExtra = process.env.ARCBANG_SHARE_EXTRA;
    delete process.env.ARCBANG_SHARE_CURATED; delete process.env.ARCBANG_SHARE_EXTRA;
    SEO._reset();

    const s = await call('GET', '/s/' + NUM + '?ref=K7M2X9QP', null, ipS(1));
    const html = String(s.body);
    ok('/s/<区块号> 是 200 的英文 HTML（lang="en"）',
      s.status === 200 && /^<!doctype html><html lang="en">/i.test(html)
      && /text\/html/.test(String(s.hdr['content-type'])), s.status + ' · ' + html.length + ' B');
    ok('/api/s/<区块号> 别名照样能用', (await call('GET', '/api/s/' + NUM, null, ipS(1))).status === 200);
    ok('H1 是 Universe from BNB block #8,642,956（千分位）',
      html.indexOf('<h1>Universe from BNB block #8,642,956</h1>') > 0);
    ok('正文有英文结局名 + 中文名 + 档位 + 观察者判定',
      html.indexOf('<strong>' + en + '</strong>') > 0 && html.indexOf(rc.outcome.name) > 0
      && html.indexOf('Grade ' + rc.rarity.name + ' · ' + (rc.outcome.observers ? 'observers possible' : 'no observers')) > 0,
      en + ' / ' + rc.outcome.name + ' / ' + rc.rarity.name);
    ok('<title> 带结局与站名',
      html.indexOf('<title>Universe from BNB block #8,642,956 — ' + en + ' | BNBBANG</title>') > 0);
    ok('meta description 英文，带结局 / D / α / 档位',
      new RegExp('name="description" content="[^"]*' + reEsc(en) + '[^"]*D = ' + rc.dimension.D.toFixed(3)
        + '[^"]*α = 1/' + rc.constants.alphaInv.toFixed(2) + '[^"]*grade ' + rc.rarity.name).test(html));
    ok('canonical 指向自己', html.indexOf('<link rel="canonical" href="' + BASE + '/s/' + NUM + '">') > 0);
    {
      const mm = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      let j = null;
      try { j = mm && JSON.parse(mm[1]); } catch (e) { j = null; }
      ok('JSON-LD VisualArtwork：name / image / url / creator BNBBANG / isBasedOn 哈希',
        !!j && j['@type'] === 'VisualArtwork' && /^Universe from BNB block #8,642,956/.test(j.name)
        && /og=1/.test(j.image) && j.url === BASE + '/s/' + NUM
        && j.creator && j.creator['@type'] === 'Organization' && j.creator.name === 'BNBBANG'
        && j.isBasedOn === H[0]);
    }
    ok('不再自动跳转：没有 meta refresh，也没有 location.replace',
      html.indexOf('http-equiv="refresh"') < 0 && html.indexOf('location.replace') < 0);
    ok('CTA "Open in the simulator" 指向 app.html 且 ?ref= 一路带过去',
      html.indexOf('class="btn" href="/app.html?bang=8642956&amp;ref=K7M2X9QP">Open in the simulator</a>') > 0);
    ok('上一块 / 下一块 / 回首页三条链接',
      html.indexOf('href="/s/8642955"') > 0 && html.indexOf('href="/s/8642957"') > 0
      /* 「Back to」读的是 o.base（landing.js），自测里的 base 是 ARCBANG_PUBLIC_BASE，不是 bnbbang.com */
      && html.indexOf('Back to ' + BASE.replace(/^https?:\/\//, '') + '<') > 0);
    {
      /* 站名 / 链名可配（ARCBANG_BRAND / ARCBANG_CHAIN_WORD）：不配时退回历史默认值
         （BNBBANG / BNB），arc 实例在自己那份 env 里覆盖成 ARCBANG / Arc。 */
      const savedBrand = process.env.ARCBANG_BRAND, savedWord = process.env.ARCBANG_CHAIN_WORD;
      const mk = (base, extra) => LANDING.landingHTML(Object.assign({
        blockNumber: NUM, hash: H[0], card: rc, mint: { minted: null }, indexable: false,
        appUrl: '/app.html?bang=' + NUM, canonical: base + '/s/' + NUM,
        ogImage: base + '/api/art/' + H[0] + '.png?og=1', cardImage: base + '/api/art/' + H[0] + '.png?p=1', base
      }, extra || {}));
      const ldOf = (h) => { try { return JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]); } catch (e) { return null; } };
      const four = (h, brand) => h.indexOf('<a class="wm" href="/">' + brand + '</a>') > 0
        && h.indexOf(' | ' + brand + '</title>') > 0
        && h.indexOf('og:site_name" content="' + brand + '"') > 0
        && !!ldOf(h) && ldOf(h).creator.name === brand;

      delete process.env.ARCBANG_BRAND; delete process.env.ARCBANG_CHAIN_WORD;
      const bnb0 = mk('https://bnbbang.com');
      ok('不配 ARCBANG_BRAND / ARCBANG_CHAIN_WORD：四处站名退回 BNBBANG、链名退回 BNB',
        four(bnb0, 'BNBBANG') && bnb0.indexOf('<h1>Universe from BNB block #8,642,956</h1>') > 0
        && bnb0.indexOf('<th>BNB block</th>') > 0 && bnb0.indexOf('Every BNB block hash') > 0);

      process.env.ARCBANG_BRAND = 'ARCBANG'; process.env.ARCBANG_CHAIN_WORD = 'Arc';
      const arc1 = mk('https://arcbang.xyz');
      ok('配成 ARCBANG / Arc：watermark、<title> 后缀、og:site_name、ld+json creator.name 全是 ARCBANG，creator.url 是 arcbang.xyz',
        four(arc1, 'ARCBANG') && ldOf(arc1).creator.url === 'https://arcbang.xyz/'
        && arc1.indexOf('Back to arcbang.xyz') > 0);
      ok('配成 ARCBANG / Arc：H1 / og:title / 描述 / 常数表写 Arc block，整页不剩 BNBBANG 也不剩 BNB block',
        arc1.indexOf('<h1>Universe from Arc block #8,642,956</h1>') > 0
        && arc1.indexOf('og:title" content="Universe from Arc block #8,642,956') > 0
        && arc1.indexOf('Every Arc block hash is a set of physical laws') > 0
        && arc1.indexOf('<th>Arc block</th>') > 0
        && arc1.indexOf('BNBBANG') < 0 && arc1.indexOf('BNB block') < 0 && arc1.indexOf('bnbbang.com') < 0,
        (arc1.match(/BNB[A-Z]*|bnbbang\.com/g) || []).join(','));

      process.env.ARCBANG_BRAND = '  '; process.env.ARCBANG_CHAIN_WORD = '';
      ok('变量配成空串 / 空白 = 没配：bnb 站逐字节不变', mk('https://bnbbang.com') === bnb0);
      process.env.ARCBANG_BRAND = '<b>&"'; process.env.ARCBANG_CHAIN_WORD = '<i>';
      {
        const hx = mk('https://arcbang.xyz');
        ok('站名 / 链名里的 < > & " 全部转义（env 写错不至于破页）',
          hx.indexOf('<b>') < 0 && hx.indexOf('<i>') < 0 && hx.indexOf('&lt;b&gt;&amp;&quot;') > 0
          && !!ldOf(hx) && ldOf(hx).creator.name === '<b>&"');
      }
      if (savedBrand === undefined) delete process.env.ARCBANG_BRAND; else process.env.ARCBANG_BRAND = savedBrand;
      if (savedWord === undefined) delete process.env.ARCBANG_CHAIN_WORD; else process.env.ARCBANG_CHAIN_WORD = savedWord;
    }
    ok('十二个结局各有一段解释，本页那段在正文里',
      LANDING.OUTCOME_EXPLAIN.length === 12
      && LANDING.OUTCOME_EXPLAIN.every((t) => typeof t === 'string' && t.length > 120)
      && html.indexOf('<p>' + LANDING.OUTCOME_EXPLAIN[rc.outcome.index] + '</p>') > 0);
    ok('常数表：D、α、c、h、e、G + 相对我们宇宙的比值；哈希等宽；有外部参照系脚注',
      html.indexOf('Dimension D') > 0 && html.indexOf('1/' + rc.constants.alphaInv.toFixed(2)) > 0
      && html.indexOf('Speed of light c') > 0 && html.indexOf('Planck constant h') > 0
      && html.indexOf('Elementary charge e') > 0 && html.indexOf('Gravitational constant G') > 0
      && html.indexOf(rc.constants.c.ratio.toFixed(3) + '× ours') > 0
      && html.indexOf('<code>' + H[0] + '</code>') > 0 && html.indexOf('external frame') > 0);
    ok('og:image 是 1200×630 的 og 变体（带 n=高度），og:image:width/height 标 1200/630',
      new RegExp('og:image" content="' + reEsc(BASE) + '/api/art/' + H[0] + '\\.png\\?og=1&amp;n=8642956&amp;v=').test(html)
      && html.indexOf('og:image:width" content="1200"') > 0 && html.indexOf('og:image:height" content="630"') > 0
      && html.indexOf('twitter:card" content="summary_large_image"') > 0);
    ok('整页不到 12 KB，除卡片图外零外部请求（无外链样式/脚本，只有一张 img）',
      Buffer.byteLength(html) < 12 * 1024 && !/<link[^>]*stylesheet|<script src=/.test(html)
      && (html.match(/<img /g) || []).length === 1, Buffer.byteLength(html) + ' B');
    ok('没铸造、不在名单：X-Robots-Tag noindex, follow，meta robots 同口径',
      s.hdr['x-robots-tag'] === 'noindex, follow' && html.indexOf('name="robots" content="noindex,follow"') > 0,
      String(s.hdr['x-robots-tag']));
    ok('索引没起来 → Mint status unavailable（不把"没查到"说成"没铸过"）',
      html.indexOf('Mint status unavailable') > 0);
    ok('十二个英文结局名在 og 右栏最多折成两行、每行 ≤18 字符',
      OUTCOME_EN.every((nm) => {
        const ls = OGM._wrap2(nm, 18);
        return ls.length <= 2 && ls.every((l) => l.length <= 18) && ls.join(' ') === nm;
      }));

    /* 哈希形式的链接（造物起源、老存档）：没有高度，标题按哈希写，没有上一块/下一块 */
    const hs = await call('GET', '/s/' + H[2], null, ipS(7));
    const hh = String(hs.body);
    ok('/s/<0x哈希>：H1 是 Universe 0x…，没有上一块/下一块，og 图不带 n，仍有 CTA',
      hs.status === 200 && hh.indexOf('<h1>Universe ' + H[2].slice(0, 10) + '…</h1>') > 0
      && hh.indexOf('rel="prev"') < 0 && hh.indexOf('rel="next"') < 0
      && /og:image" content="[^"]*\.png\?og=1&amp;v=/.test(hh)
      && hh.indexOf('href="/app.html?bang=' + H[2] + '"') > 0);

    /* 精选名单：env 指到一个临时 JSON 文件 → 这个高度进索引 */
    const curFile = path.join(TMP, 'curated.json');
    fs.writeFileSync(curFile, JSON.stringify([NUM, 0, 'x', -1, 1e15, '000', NUM]));
    process.env.ARCBANG_SHARE_CURATED = curFile;
    SEO._reset();
    const s2 = await call('GET', '/s/' + NUM, null, ipS(1));
    ok('精选名单里的高度：X-Robots-Tag index, follow，meta robots index',
      s2.hdr['x-robots-tag'] === 'index, follow' && String(s2.body).indexOf('name="robots" content="index,follow"') > 0,
      String(s2.hdr['x-robots-tag']));
    ok('名单里的垃圾项被剔掉（非数字 / 负数 / 超过 12 位），去重，只剩合法高度',
      JSON.stringify(SEO.curatedHeights()) === JSON.stringify([NUM, 0]), JSON.stringify(SEO.curatedHeights()));
    ok('没配精选名单时内置 [0]（创世块）', (() => {
      delete process.env.ARCBANG_SHARE_CURATED; SEO._reset();
      const r = JSON.stringify(SEO.curatedHeights()) === '[0]';
      process.env.ARCBANG_SHARE_CURATED = curFile; SEO._reset();
      return r;
    })());

    const sm = await call('GET', '/sitemap-s.xml', null, ipS(1));
    const xml = String(sm.body);
    ok('/sitemap-s.xml 200 application/xml，public max-age=600',
      sm.status === 200 && /application\/xml/.test(String(sm.hdr['content-type']))
      && /max-age=600/.test(String(sm.hdr['cache-control'])), sm.status + ' · ' + sm.hdr['cache-control']);
    ok('sitemap 结构完整，列出精选高度（含创世块 0），<url> 成对',
      /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/.test(xml)
      && /<\/urlset>\n$/.test(xml)
      && xml.indexOf('<url><loc>' + BASE + '/s/' + NUM + '</loc></url>') > 0
      && xml.indexOf('<url><loc>' + BASE + '/s/0</loc></url>') > 0
      && (xml.match(/<url>/g) || []).length === (xml.match(/<\/url>/g) || []).length
      && (xml.match(/<url>/g) || []).length === 2, (xml.match(/<url>/g) || []).length + ' 条');
    {
      const hd = await call('HEAD', '/sitemap-s.xml', null, ipS(1));
      ok('HEAD /sitemap-s.xml 只给头', hd.status === 200 && hd.body === '' && /application\/xml/.test(String(hd.hdr['content-type'])));
    }

    /* 附加名单：另一个进程写的文件，60 秒缓存；缺了、坏了当空 */
    const extraFile = path.join(TMP, 'extra.json');
    fs.writeFileSync(extraFile, '[4242, 4242, "17"]');
    process.env.ARCBANG_SHARE_EXTRA = extraFile;
    SEO._reset();
    const sm2 = String((await call('GET', '/sitemap-s.xml', null, ipS(1))).body);
    ok('附加名单也进 sitemap：去重，字符串数字也认',
      sm2.indexOf('/s/4242</loc>') > 0 && sm2.indexOf('/s/17</loc>') > 0
      && (sm2.match(/\/s\/4242</g) || []).length === 1);
    ok('附加名单里的高度进索引（index, follow）',
      (await call('GET', '/s/4242', null, ipS(2))).hdr['x-robots-tag'] === 'index, follow');
    fs.writeFileSync(extraFile, '{not json');
    SEO._reset();
    const sm3 = await call('GET', '/sitemap-s.xml', null, ipS(1));
    ok('附加名单文件坏了：当空，sitemap 照出（200，精选仍在）',
      sm3.status === 200 && String(sm3.body).indexOf('/s/4242<') < 0 && String(sm3.body).indexOf('/s/' + NUM + '<') > 0);
    process.env.ARCBANG_SHARE_EXTRA = path.join(TMP, 'no-such-file.json');
    SEO._reset();
    ok('附加名单文件缺了：当空，不报错', SEO.extraHeights().length === 0
      && (await call('GET', '/sitemap-s.xml', null, ipS(1))).status === 200);

    /* 分页 */
    const pg1 = await call('GET', '/sitemap-s-1.xml', null, ipS(1));
    ok('/sitemap-s-1.xml 是第一页（不分页时与总表相同）',
      pg1.status === 200 && String(pg1.body).indexOf('/s/' + NUM + '<') > 0);
    const pg99 = await call('GET', '/sitemap-s-99.xml', null, ipS(1));
    ok('越界页码 404（不是 500），仍是合法 XML', pg99.status === 404 && /<urlset/.test(String(pg99.body)));
    {
      const many = [];
      for (let i = 0; i < 100001; i++) many.push({ n: i, at: i === 5 ? 1756700000 : null });
      const idx = SEO.sitemap(BASE, null, many);
      const p1 = SEO.sitemap(BASE, 1, many);
      const p3 = SEO.sitemap(BASE, 3, many);
      ok('超过 45,000 条：总表变 sitemap index 指向 3 页，每页 ≤45,000，第 3 页剩 10,001 条，第 4 页 404',
        /<sitemapindex/.test(idx.xml) && (idx.xml.match(/<sitemap>/g) || []).length === 3
        && idx.xml.indexOf('<loc>' + BASE + '/sitemap-s-3.xml</loc>') > 0
        && p1.status === 200 && (p1.xml.match(/<url>/g) || []).length === SEO.PAGE
        && p3.status === 200 && (p3.xml.match(/<url>/g) || []).length === 10001
        && SEO.sitemap(BASE, 4, many).status === 404);
      ok('已铸造的带 <lastmod>（铸造日期），其余不带',
        p1.xml.indexOf('<url><loc>' + BASE + '/s/5</loc><lastmod>'
          + new Date(1756700000 * 1000).toISOString().slice(0, 10) + '</lastmod></url>') > 0
        && p1.xml.indexOf('<url><loc>' + BASE + '/s/6</loc></url>') > 0);
    }

    /* 铸造反查：往索引注一条 meta + 一条持仓 → Minted as #N, owner …；已铸造 → index, follow */
    const I = MI._internals;
    const savedUni = I.CFG.universe, savedMarket = I.CFG.market;
    const savedMeta = I.getMeta(), savedState = I.getState();
    const savedRt = { lastOkAt: I.runtime.lastOkAt, latest: I.runtime.latest, coverGap: I.runtime.coverGap };
    I.CFG.universe = '0x' + 'ab'.repeat(20);
    const UK = (id) => I.CFG.universe + ':' + id;
    const st2 = MI.emptyState();
    st2.owners[UK(7)] = '0xabcdef0000000000000000000000000000001234';
    I.setState(st2);
    const m2 = Object.create(null);
    m2[UK(7)] = { blockHash: H[0], blockNumber: NUM, mintedAt: 1756700000, at: Date.now() };
    I.setMeta(m2);
    const ms = MI.mintStatusOf(H[0]);
    ok('mintStatusOf：铸了 → tokenId / owner / 高度 / 铸造时间',
      ms.minted === true && ms.tokenId === '7' && ms.owner === '0xabcdef0000000000000000000000000000001234'
      && ms.blockNumber === NUM && ms.mintedAt === 1756700000, JSON.stringify(ms));
    ok('索引没起来时，反查不到的哈希答 null（不知道），不答 false', MI.mintStatusOf(H[1]).minted === null);
    delete process.env.ARCBANG_SHARE_CURATED; delete process.env.ARCBANG_SHARE_EXTRA; SEO._reset();
    const s3 = await call('GET', '/s/' + NUM, null, ipS(1));
    ok('页面写 Minted as #7, owner 0xabcd…1234；已铸造 → index, follow（不靠名单）',
      String(s3.body).indexOf('Minted as #7, owner 0xabcd…1234') > 0 && s3.hdr['x-robots-tag'] === 'index, follow',
      String(s3.hdr['x-robots-tag']));
    const sm4 = String((await call('GET', '/sitemap-s.xml', null, ipS(1))).body);
    ok('sitemap 列出已铸造的高度并带铸造日期 lastmod',
      sm4.indexOf('<url><loc>' + BASE + '/s/' + NUM + '</loc><lastmod>'
        + new Date(1756700000 * 1000).toISOString().slice(0, 10) + '</lastmod></url>') > 0);
    /* 索引新鲜 + 持仓元数据补齐（coverGap=0）→ 反查不到才敢说"没铸过" */
    I.CFG.market = '0x' + 'cd'.repeat(20);
    I.runtime.lastOkAt = Date.now(); I.runtime.latest = 0; I.runtime.coverGap = 0;
    ok('索引新鲜且 coverGap=0：反查不到 → 没铸过（false）', MI.mintStatusOf(H[1]).minted === false);
    const s4 = await call('GET', '/s/4242', null, ipS(2));
    ok('页面写 Not minted yet — the first confirmed transaction owns it',
      String(s4.body).indexOf('Not minted yet — the first confirmed transaction owns it.') > 0);
    I.runtime.coverGap = 3;
    ok('还有持仓没补元数据（coverGap>0）→ 又答"不知道"', MI.mintStatusOf(H[1]).minted === null);

    /* coverNative：没挂单的持仓也会被补上 blockHash/blockNumber（ethCall 打桩，不联网） */
    const W32 = (v) => (typeof v === 'string' ? v.replace(/^0x/, '') : BigInt(v).toString(16)).padStart(64, '0');
    st2.owners[UK(8)] = '0x' + '11'.repeat(20);
    ethCallStub = (to, data) => {
      const sel = String(data).slice(0, 10);
      if (sel === MI.SEL.universeOf) {
        return '0x' + W32(H[2]) + W32(4243) + W32(1756700100) + W32(0) + W32(9) + W32(1) + W32(0);
      }
      return '0x' + W32(0);
    };
    I.runtime.coverGap = null;
    await I.coverNative();
    const ms8 = MI.mintStatusOf(H[2]);
    ok('coverNative 补上没挂单的持仓：反查表随之更新（#8），这一轮先数出 gap=1',
      ms8.minted === true && ms8.tokenId === '8' && ms8.blockNumber === 4243 && ms8.mintedAt === 1756700100
      && I.runtime.coverGap === 1, JSON.stringify(ms8) + ' gap=' + I.runtime.coverGap);
    await I.coverNative();
    ok('下一轮 coverGap 归零', I.runtime.coverGap === 0);
    ok('mintedHeights 列出两枚已铸的高度',
      JSON.stringify(MI.mintedHeights().map((x) => x.n).sort()) === JSON.stringify([4243, NUM].sort()));
    ethCallStub = null;
    // 复原索引状态，别影响后面的用例
    I.CFG.universe = savedUni; I.CFG.market = savedMarket;
    I.runtime.lastOkAt = savedRt.lastOkAt; I.runtime.latest = savedRt.latest; I.runtime.coverGap = savedRt.coverGap;
    I.setMeta(savedMeta); I.setState(savedState);

    /* og 图：1200×630，方卡在左、右栏文字；?w= 缩放；缓存键带变体与 n/w，不串 */
    const PNGDIR = path.join(process.env.ARCBANG_STORE, 'png');
    const ihdr = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    const isPNG = (b) => Buffer.isBuffer(b) && b.length > 24 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG';
    const keyOG = (h, n, w) => 'art-' + h + '-og' + (n ? '-n' + n : '') + (w ? '-w' + w : '')
      + '-v' + DERIVATION_VERSION + '-s' + api.SHAPE + '.png';
    const og1 = await call('GET', '/api/art/' + H[0] + '.png?og=1&n=123', null, ipS(3));
    ok('?og=1&n=123 出真 PNG，IHDR 1200×630',
      og1.status === 200 && isPNG(og1.body) && ihdr(og1.body).w === 1200 && ihdr(og1.body).h === 630
      && og1.hdr['x-png-cache'] === 'miss',
      isPNG(og1.body) ? ihdr(og1.body).w + '×' + ihdr(og1.body).h + ' · ' + (og1.body.length / 1024).toFixed(0)
        + ' KB · ' + og1.hdr['x-png-ms'] + ' ms' : og1.status + '');
    ok('og 缓存键 art-<hash>-og-n123-v<ver>-s<shape>.png 落了盘', fs.existsSync(path.join(PNGDIR, keyOG(H[0], '123'))));
    const og2 = await call('GET', '/api/art/' + H[0] + '.png?og=1&n=123', null, ipS(3));
    ok('同 URL 第二次命中缓存，字节一致', og2.hdr['x-png-cache'] === 'hit' && sha(og2.body) === sha(og1.body));
    const ogz = await call('GET', '/api/art/' + H[0] + '.png?og=1&n=0000123', null, ipS(3));
    ok('n 去前导零归一化后与 n=123 同键命中', ogz.hdr['x-png-cache'] === 'hit');
    const og3 = await call('GET', '/api/art/' + H[0] + '.png?og=1&n=124', null, ipS(3));
    ok('换一个 n 是另一张图（键里带 n，不串）', og3.hdr['x-png-cache'] === 'miss' && sha(og3.body) !== sha(og1.body));
    const ogx = await call('GET', '/api/art/' + H[0] + '.png?og=1&n=12ab', null, ipS(3));
    ok('n 不是纯数字就当没有（不进键）', ogx.status === 200 && isPNG(ogx.body)
      && fs.existsSync(path.join(PNGDIR, keyOG(H[0], null))));
    const ogw = await call('GET', '/api/art/' + H[0] + '.png?og=1&w=600', null, ipS(3));
    ok('?og=1&w=600 → 600×315，键带 -w600',
      ogw.status === 200 && isPNG(ogw.body) && ihdr(ogw.body).w === 600 && ihdr(ogw.body).h === 315
      && fs.existsSync(path.join(PNGDIR, keyOG(H[0], null, 600))));
    const sqw = await call('GET', '/api/art/' + H[0] + '.png?p=1&w=600', null, ipS(3));
    ok('方图 ?p=1&w=600 → 600×600，键 art-<hash>-p-w600-…',
      isPNG(sqw.body) && ihdr(sqw.body).w === 600 && ihdr(sqw.body).h === 600
      && fs.existsSync(path.join(PNGDIR, 'art-' + H[0] + '-p-w600-v' + DERIVATION_VERSION + '-s' + api.SHAPE + '.png')));
    const bad = await call('GET', '/api/art/' + H[0] + '.png?p=1&w=100', null, ipS(3));
    ok('w 越界（<300 或 >1200）忽略，仍是 1200 的方图（老 URL 行为不变）',
      isPNG(bad.body) && ihdr(bad.body).w === 1200 && ihdr(bad.body).h === 1200);
    ok('fitTo 宽度夹取：非法/越界回 1200',
      PNG._fitWidthOf('abc') === 1200 && PNG._fitWidthOf(0) === 1200 && PNG._fitWidthOf(600) === 600
      && PNG._fitWidthOf(5000) === 1200);
    const GH = B.keccak256('og-gate-1');
    const gg = await call('GET', '/api/art/' + GH + '.png?og=1', null, ipS(4));
    ok('og 图印着结局：没算过的宇宙要扣额度（与 ?p=1 同口径）',
      gg.status === 200 && Number.isFinite(Number(gg.hdr['x-ratelimit-remaining'])),
      'remaining=' + gg.hdr['x-ratelimit-remaining']);
    PNG._setRasterizer(null);
    const gf = await call('GET', '/api/art/' + B.keccak256('og-nodep') + '.png?og=1&n=5', null, ipS(5));
    ok('依赖缺失时 og 变体也退通用图、不 500、不发长缓存',
      gf.status === 200 && isPNG(gf.body) && gf.hdr['x-png-cache'] === 'fallback'
      && !/immutable/.test(String(gf.hdr['cache-control'])));
    PNG._setRasterizer(undefined);

    /* 降级：拿不到 card（RPC 挂）→ 同一套页壳、Outcome not computed yet、仍有 CTA、max-age 60、noindex */
    chainMod.blockByNumber = async () => { throw new Error('所有 RPC 节点都打不通'); };
    const dg = await call('GET', '/s/8600002', null, ipS(6));
    const dh2 = String(dg.body);
    ok('降级页：同一套页壳、Outcome not computed yet、仍有 CTA、max-age 60、noindex',
      dg.status === 200 && dh2.indexOf('<html lang="en">') > 0 && dh2.indexOf('Outcome not computed yet') > 0
      && dh2.indexOf('class="btn" href="/app.html?bang=8600002">') > 0
      && dg.hdr['cache-control'] === 'public, max-age=60' && dg.hdr['x-robots-tag'] === 'noindex, follow',
      dg.status + ' · ' + dg.hdr['cache-control']);
    ok('降级页没有常数表、不猜结局、og 退通用预览图',
      dh2.indexOf('Dimension D') < 0 && !OUTCOME_EN.some((nm) => dh2.indexOf('<strong>' + nm + '</strong>') > 0)
      && dh2.indexOf('/api/art/preview.png') > 0);
    chainMod.blockByNumber = async (n) => (n === NUM ? { number: n, hash: H[0] } : null);
    const hd = await call('HEAD', '/s/' + NUM, null, ipS(1));
    ok('HEAD /s/<区块号> 只给头（含 X-Robots-Tag）', hd.status === 200 && hd.body === ''
      && /text\/html/.test(String(hd.hdr['content-type'])) && typeof hd.hdr['x-robots-tag'] === 'string');

    if (savedCur === undefined) delete process.env.ARCBANG_SHARE_CURATED; else process.env.ARCBANG_SHARE_CURATED = savedCur;
    if (savedExtra === undefined) delete process.env.ARCBANG_SHARE_EXTRA; else process.env.ARCBANG_SHARE_EXTRA = savedExtra;
    SEO._reset();
    chainMod.blockByNumber = savedBBN;
  }

  {
    console.log('\n[S2] 上线预约（server/subscribe.js）');
    const SBX = require('./subscribe.js');
    const sdir = path.join(TMP, 'sub'); fs.mkdirSync(sdir, { recursive: true });
    const takes = [];
    const sub = SBX.create({ storeDir: sdir, take: (k, limit) => { takes.push(k); return { ok: takes.filter((x) => x === k).length <= limit }; } });
    ok('站名不在白名单 → 400', sub.add({ site: 'evil', email: 'a@b.co' }, '1.1.1.1').status === 400);
    ok('邮箱格式不对 → 400', sub.add({ site: 'tool', email: 'nope' }, '1.1.1.1').status === 400 && sub.add({ site: 'tool', email: 'a@b' }, '1.1.1.1').status === 400);
    const first = sub.add({ site: 'tool', email: ' A@B.co ', lang: 'en-US' }, '1.1.1.1');
    ok('合法登记 → 200 ok', first.status === 200 && first.body.ok === true && !first.body.already);
    ok('重复登记 → already:true', sub.add({ site: 'tool', email: 'a@b.co' }, '1.1.1.1').body.already === true);
    const lines = fs.readFileSync(sub._file, 'utf8').trim().split('\n');
    ok('只写了一行，邮箱已小写去空格、语言归一成 en', lines.length === 1 && JSON.parse(lines[0]).email === 'a@b.co' && JSON.parse(lines[0]).lang === 'en');
    for (let i = 0; i < 5; i++) sub.add({ site: 'tool', email: 'u' + i + '@c.co' }, '2.2.2.2');
    ok('同一 IP 第 6 次 → 429', sub.add({ site: 'tool', email: 'u9@c.co' }, '2.2.2.2').status === 429);
    const sub2 = SBX.create({ storeDir: sdir });
    ok('重启后从文件读回去重表', sub2.add({ site: 'tool', email: 'a@b.co' }, '3.3.3.3').body.already === true && sub2.count() >= 1);
  }
  {
    /* ------------------------------------------------------------------
       [S3] 市场索引的两套事件解码（server/marketindex.js）

       ArcMarket 是 MirrorMarket 的无币版，四条事件的签名全变了：
       Listed 少了 is1155/inBang、Cancelled 多了 by、Sold 的 inBang 换成
       royalty+royaltyReceiver、还多出一条 PriceChanged。
       拿错的那套 topic 去查 eth_getLogs **不会报错**，回来的是合法的空数组 ——
       索引不 stale、日志里一个字都没有，Arc 站的市场页就那么一直空着。
       这一节就是为了让「拿错了」在这里当场红掉，而不是上线之后靠人眼发现。 */
    console.log('\n[S3] 市场索引：主线 / Arc 两套事件解码');
    const MI3 = require('./marketindex.js');

    const W = (v) => (typeof v === 'string' ? v.replace(/^0x/, '') : BigInt(v).toString(16)).padStart(64, '0');
    const T = (v) => '0x' + W(v);
    const MKT = '0x' + 'cd'.repeat(20);
    const UNI = '0x' + 'ab'.repeat(20);
    const SELLER = '0x' + '11'.repeat(20);
    const BUYER = '0x' + '22'.repeat(20);
    const PASSER = '0x' + '33'.repeat(20);
    const RCV = '0x' + '44'.repeat(20);
    const cfgArc = { market: MKT, universe: UNI, crafted: '', arc: true };
    const cfgBsc = { market: MKT, universe: UNI, crafted: '', arc: false };
    const log = (t0, topics, data, bn, li) => ({
      address: MKT, topics: [t0].concat(topics), data: '0x' + data,
      blockNumber: '0x' + bn.toString(16), logIndex: '0x' + li.toString(16)
    });
    const PRICE = 1500000000000000000n;   // 1.5 USDC（Arc 的 native 是 18 位小数的 USDC）

    /* 常量复算：签名改了这里就红，不会在线上安静地少收事件 */
    ok('ARC_TOPICS 四个常量与 ArcMarket 事件签名的 keccak 逐个对上',
      Object.keys(MI3.ARC_EVENT_SIGS).every((k) => MI3.ARC_TOPICS[k] === keccakId(MI3.ARC_EVENT_SIGS[k]))
      && Object.keys(MI3.ARC_TOPICS).length === 4,
      Object.keys(MI3.ARC_TOPICS).join('/'));
    ok('两套 topic0 互不相撞（撞了就说明抄错了签名）',
      new Set(Object.values(MI3.ARC_TOPICS).concat([MI3.TOPICS.Listed, MI3.TOPICS.Cancelled, MI3.TOPICS.Sold])).size === 7);

    /* ---- 主线那条 Listed：加了分链开关之后，字段一个都不能变 ---- */
    const mList = log(MI3.TOPICS.Listed, [T(7), T(SELLER), T(UNI)],
      W(42) + W(1) + W(PRICE) + W(0) + W(1), 100, 0);
    const mEv = MI3.decodeLog(mList, cfgBsc);
    ok('主线 Listed 照旧解出 is1155=false / inBang=true（BANG 单）',
      !!mEv && mEv.kind === 'Listed' && mEv.listingId === '7' && mEv.seller === SELLER
      && mEv.token === UNI && mEv.id === '42' && mEv.price === PRICE.toString()
      && mEv.is1155 === false && mEv.inBang === true, JSON.stringify(mEv && mEv.kind));

    /* ---- Arc 的 Listed：同一份字段形状，两个 bool 恒 false ---- */
    const aList = log(MI3.ARC_TOPICS.Listed, [T(7), T(SELLER), T(UNI)],
      W(42) + W(1) + W(PRICE), 100, 0);
    const aEv = MI3.decodeLog(aList, cfgArc);
    ok('Arc Listed 与主线同形：token=ArcUniverse，is1155/inBang 恒 false',
      !!aEv && aEv.kind === 'Listed' && aEv.listingId === '7' && aEv.seller === SELLER
      && aEv.token === UNI && aEv.id === '42' && aEv.amount === '1'
      && aEv.price === PRICE.toString() && aEv.is1155 === false && aEv.inBang === false);

    /* ---- 拿错那一套：解不出来，而不是解出一堆错位的字段 ---- */
    ok('用主线解码器读 Arc 的 log → null；用 Arc 解码器读主线的 log → null',
      MI3.decodeLog(aList, cfgBsc) === null && MI3.decodeLog(mList, cfgArc) === null);

    /* ---- 一条链上的完整生命周期：挂 → 改价 → 被路人清掉 ---- */
    const stA = MI3.emptyState();
    MI3.applyLogs(stA, [aList], cfgArc);
    ok('Arc 挂单进索引：active、价格、持有人都对',
      stA.activeSet.has('7') && stA.listings['7'].active === true
      && stA.listings['7'].price === PRICE.toString() && stA.listings['7'].inBang === false);

    const NEW = 900000000000000000n;      // 0.9 USDC
    const aPrice = log(MI3.ARC_TOPICS.PriceChanged, [T(7), T(SELLER)], W(PRICE) + W(NEW), 101, 0);
    const pEv = MI3.decodeLog(aPrice, cfgArc);
    ok('PriceChanged 解出 oldPrice / price（新价放 price，与挂单字段同名）',
      !!pEv && pEv.kind === 'PriceChanged' && pEv.oldPrice === PRICE.toString() && pEv.price === NEW.toString());
    const r1 = MI3.applyLogs(stA, [aPrice], cfgArc);
    ok('改价改的是同一张单的 price，单子仍然 active',
      stA.listings['7'].price === NEW.toString() && stA.listings['7'].active === true && r1.changed === 1);
    const r2 = MI3.applyLogs(stA, [aPrice], cfgArc);
    ok('同一条 PriceChanged 重放（重组窗口每轮重扫）不再算改动',
      r2.changed === 0 && stA.listings['7'].price === NEW.toString());
    MI3.applyLogs(stA, [log(MI3.ARC_TOPICS.PriceChanged, [T(999), T(SELLER)], W(1) + W(2), 102, 0)], cfgArc);
    ok('没见过的挂单收到 PriceChanged：不建残桩，不凭空造出一条点不开的幽灵挂单',
      stA.listings['999'] === undefined);

    const aCancel = log(MI3.ARC_TOPICS.Cancelled, [T(7), T(SELLER), T(PASSER)], '', 103, 0);
    const cEv = MI3.decodeLog(aCancel, cfgArc);
    ok('cancelStale：by 是那个路人，seller 仍然是挂单的人',
      !!cEv && cEv.kind === 'Cancelled' && cEv.seller === SELLER && cEv.by === PASSER);
    MI3.applyLogs(stA, [aCancel], cfgArc);
    ok('失效挂单被清掉：active=false，退出 activeSet',
      stA.listings['7'].active === false && !stA.activeSet.has('7') && stA.listings['7'].endedBy === 'Cancelled');

    /* ---- Arc 的 Sold：多了版税两项，成交记录仍按 inBang=false 落 ---- */
    const aSold = log(MI3.ARC_TOPICS.Sold, [T(8), T(BUYER), T(SELLER)],
      W(PRICE) + W(PRICE / 100n) + W(PRICE / 20n) + W(RCV), 104, 0);
    const sEv = MI3.decodeLog(aSold, cfgArc);
    ok('Arc Sold 解出 fee / royalty / royaltyReceiver，inBang 恒 false',
      !!sEv && sEv.kind === 'Sold' && sEv.buyer === BUYER && sEv.seller === SELLER
      && sEv.fee === (PRICE / 100n).toString() && sEv.royalty === (PRICE / 20n).toString()
      && sEv.royaltyReceiver === RCV && sEv.inBang === false);
    MI3.applyLogs(stA, [aSold], cfgArc);
    const sale = stA.sales[stA.sales.length - 1];
    ok('成交落进 sales，重放一次也只有一笔',
      stA.sales.length === 1 && sale.listingId === '8' && sale.inBang === false
      && (MI3.applyLogs(stA, [aSold], cfgArc), stA.sales.length === 1));

    /* ---- 按 chainId 切：现读 env，不认加载时缓存的那一份 ---- */
    const savedChain = process.env.ARCBANG_CHAIN_ID;
    process.env.ARCBANG_CHAIN_ID = '5042';
    const arcTop = MI3.marketTopics();
    const arcOn = MI3.isArcChain();
    process.env.ARCBANG_CHAIN_ID = '56';
    const bscTop = MI3.marketTopics();
    const bscOn = MI3.isArcChain();
    process.env.ARCBANG_CHAIN_ID = savedChain;
    ok('chainId 5042 → 查 Arc 那四个 topic；56 → 查主线那三个（判定现读 env）',
      arcOn === true && bscOn === false
      && arcTop.length === 4 && arcTop.indexOf(MI3.ARC_TOPICS.PriceChanged) >= 0
      && bscTop.length === 3 && bscTop.indexOf(MI3.TOPICS.Listed) >= 0);
    ok('5042002（Arc 测试网）也算 Arc', MI3.ARC_CHAIN_IDS.has(5042002) && MI3.ARC_CHAIN_IDS.has(5042));

    /* Arc 的 eth_getLogs 单次上限 20,000 块；CFG.chunk 被 envInt 夹死在 5,000，
       环境变量也调不上去，所以分页永远不会撞上那道墙。 */
    ok('分片跨度 ≤ 5,000，远在 Arc 的 20,000 块上限之内',
      MI3._internals.CFG.chunk <= 5000
      && MI3.chunkRanges(1, 45000, MI3._internals.CFG.chunk).every(([a, b]) => b - a + 1 <= 20000));
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 临时目录，删不掉也不算失败 */ }

  console.log('\n通过 ' + pass + ' 条，失败 ' + fail + ' 条  (derivation v' + DERIVATION_VERSION + ')\n');
  process.exitCode = fail ? 1 : 0;   // 别用 process.exit：还有未收尾的句柄，Windows 上会报 libuv 断言
})();
