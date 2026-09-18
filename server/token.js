/*
 * tokenURI 的那一头 —— 把链上事实和服务端算出的 card 拼成 ERC-721 metadata
 * ------------------------------------------------------------
 * 合约的 tokenURI(id) 在 baseURI 非空时直接指到这里（见 MirrorUniverse.sol 的 tokenURI）。
 * 所以这个端点是市场、钱包、扫块器看这枚 NFT 的唯一入口。
 *
 * 它和别的端点有一点本质不同：**其余端点都是 blockHash 的纯函数，这个不是**。
 * cardOf[id] 会因为干预而改变，burnedOn[id] 会累加 —— 必须每次真的去读链，
 * 不能拿 blockHash 算完就当数。
 *
 * 一条贯穿全文件的原则：**链上说什么就是什么，服务端算不出来的就不印**。
 * 一枚 NFT 到底带不带参数，凭据是链上的 cardOf，不是服务端手里有没有那份 card。
 */
'use strict';
const { id: keccakId } = require('ethers');
const { ethCall } = require('./chain.js');
const { RARITY_NAME } = require('./card.js');
const { OUTCOME_EN, craftedBurnOf, craftedBurnLabel } = require('./art.js');

const sel = (sig) => keccakId(sig).slice(0, 10);

/* 命名合约（BangNames）。**独立于 NFT 合约，可以不配**：
   没设这个环境变量时，metadata 里就是没有名字这一条，别的一个字都不变。
   它是 BANG 的第二条销毁通路，和 cardOf / 稀有度 / 结局 / 出图全都不相干。

   为什么从 env 直接读，而不是像 CONTRACT 那样由 index.js 传进来：
   readToken 的调用方只有 index.js 那一处，加一个参数就要动那边；而这一层是
   纯附加的，不该逼着上游改签名。给 readToken 留了第三个可选参数，测试用它注入。 */
/* 描述里那个链名。**写死，不读 env** —— tokenURI 是要被市场抓走存档的链上内容，
   必须和合约自己那份链上兜底 metadata 一字不差（ArcUniverse.sol 的 tokenURI 里
   写的就是 "A universe grown from Arc block …"）。 */
const CHAIN_WORD = 'Arc';
const NAMES = (process.env.ARCBANG_NAMES || '').toLowerCase();
/* 造物系列的名册（BangNames2）。没配就不打那一笔，metadata 其余部分一个字不变。 */
const NAMES2 = (process.env.ARCBANG_NAMES2 || '').toLowerCase();

/* 链上返回的 string → JS 字符串。**每一步都验长度**：这份数据来自一个可以配错的
   外部合约地址，不是我们自己的结构体。偏移或长度是垃圾时返回 null，不要抛 ——
   名字读不出来不该让整枚 NFT 的 metadata 变成 500。 */
function asString(raw) {
  const body = String(raw || '').replace(/^0x/, '');
  if (body.length < 128) return null;                 // 至少要有 偏移 + 长度 两个字
  const off = Number(BigInt('0x' + body.slice(0, 64)));
  if (!Number.isSafeInteger(off) || off % 32 !== 0) return null;
  const lenAt = off * 2;
  if (body.length < lenAt + 64) return null;
  const len = Number(BigInt('0x' + body.slice(lenAt, lenAt + 64)));
  /* 名字上限是 32 字节（合约里的 MAX_LEN）。这里放宽到 1KB 只为了能读出
     "长得离谱"这件事本身，然后在 cleanName 里拒掉 —— 直接按 32 截断的话，
     一个 40 字节的名字会被截成另一个名字印上去，那比不印更糟。 */
  if (!Number.isSafeInteger(len) || len > 1024) return null;
  const at = lenAt + 64;
  if (body.length < at + len * 2) return null;
  return Buffer.from(body.slice(at, at + len * 2), 'hex').toString('utf8');
}

/* 名字的**独立复核**。合约那边已经把规则钉死了（ASCII、1..32、首尾不能是连字符），
   这里再验一遍不是不信任它，是因为 ARCBANG_NAMES 指向哪个合约由配置决定：
   指错一个地址，返回的就可能是任意字节，而这段字符串会被原样送进 NFT metadata，
   出现在市场、钱包、扫块器上。

   **验不过就当没有名字，绝不"清洗后照印"** —— 清洗等于印一个链上不存在的名字，
   而 metadata 的全部意义是"链上说什么就是什么"。 */
const NAME_RE = /^[A-Za-z0-9-]{1,32}$/;
function cleanName(s) {
  if (typeof s !== 'string' || !NAME_RE.test(s)) return null;
  if (s[0] === '-' || s[s.length - 1] === '-') return null;
  return s;
}

/* 取返回数据的第 i 个字。**取不到就给 null，不给 0** ——
   已部署的合约可能比当前源码少几个字段（verified 和 rarity 都是后来追加到
   结构体末尾的，2026-08-18 部署的那版上 universeOf 只回 5 个字）。
   缺字段时补 0 会把"不知道"印成"D 档、没验过"，那是编的。 */
function word(raw, i) {
  const body = String(raw || '').replace(/^0x/, '');
  return body.length < (i + 1) * 64 ? null : body.slice(i * 64, (i + 1) * 64);
}
const asNum = (w) => (w == null ? null : Number(BigInt('0x' + w)));
const asBig = (w) => (w == null ? null : BigInt('0x' + w));
const asBool = (w) => (w == null ? null : BigInt('0x' + w) === 1n);
const asAddr = (w) => (w == null ? null : '0x' + w.slice(24));
const asHash = (w) => (w == null ? null : '0x' + w);
const isZero = (h) => h == null || /^0x0{64}$/.test(h);

/** 与 card.js 的 tier.id、art.js 的 TIER 表同一套档位 */
const TIER_IDS = ['whisper', 'drift', 'quake', 'storm', 'chaos'];
const TIER_EN = ['Whisper', 'Drift', 'Quake', 'Storm', 'Chaos'];

/**
 * 读这枚 token 的全部链上事实。
 * @returns {Promise<object|null>} null = 链上没有这枚 token（blockHash 为零）
 */
async function readToken(contract, tokenId, namesAddr) {
  const arg = tokenId.toString(16).padStart(64, '0');
  const names = (namesAddr === undefined ? NAMES : namesAddr) || '';
  /* 四个 getter 并发读，但**容错程度不一样**：
       universeOf  是这枚 NFT 的本体，读不到就没什么可说的了，错往上抛
       其余三个     是 economy-v4 之后才加进合约的，2026-08-18 部署的那版上没有 ——
                   那版合约上 revert 恰恰说明"这条链上还没有盖章/销毁/救活这回事"，
                   拿 null 当"没有"是事实，不是回退常量（对比 C3：那条禁止的是
                   在**取不到数据时编一个**，这里是节点明确告诉我们这个概念不存在）
     这么分的直接原因：不分的话已经铸好的 #1 会因为三个 revert 变成 503，读都读不出来。 */
  const soft = { nullOnRevert: true };
  const [uRaw, cRaw, bRaw, rRaw, nRaw] = await Promise.all([
    ethCall(contract, sel('universeOf(uint256)') + arg),
    ethCall(contract, sel('cardOf(uint256)') + arg, soft),
    ethCall(contract, sel('burnedOn(uint256)') + arg, soft),
    ethCall(contract, sel('rescueOf(uint256)') + arg, soft),
    /* 名字打的是**另一个合约**。没配地址就根本不发这一笔（不是发了再忽略：
       每一枚 NFT 的 metadata 都要走这里，白打一次 RPC 是实打实的延迟）。
       配了但地址不对、合约没这个函数、或者那枚 token 没命名 —— 三种都落成
       "没有名字"，因为它们对使用者的意思完全一样，而且名字这一层缺了不影响别的。 */
    names ? ethCall(names, sel('nameOf(uint256)') + arg, soft) : Promise.resolve(null)
  ]);

  /* 返回数据**一个字都没有** = 这个地址上根本没有合约：节点对无代码地址的
     eth_call 不 revert，就是干干净净回一个空的 0x。
     这是**配置错**，不是"链上没有这枚 NFT" —— 原来两者一起掉进下面那个 isZero 里
     （空数据 → word 给 null → isZero(null) 为真 → return null → 404），
     于是 ARCBANG_CONTRACT 填错一个字符、或者服务端连的链和合约不在一条链上时，
     每一枚 NFT 都报「链上没有这枚 NFT」。人看到这句话会去查铸造记录、查扫块器，
     唯独不会去看配置 —— 和当年 /etc/bnbbang 权限 700 却报"没有私钥"是同一种坑。
     三类错必须报三种话：503 节点打不通 / 502 合约地址不对 / 404 这个 id 没铸过。 */
  const w0 = word(uRaw, 0);
  if (w0 == null) {
    const e = new Error('合约地址 ' + contract + ' 读不出 universeOf：返回数据是空的，'
      + '这个地址上多半没有合约（或者服务端连错了链）');
    e.noContract = true;
    throw e;
  }

  const blockHash = asHash(w0);
  // 没铸造过的 id，mapping 返回全零。这不是故障，是"没有这枚 NFT"
  if (isZero(blockHash)) return null;

  const cardHash = asHash(word(cRaw, 0));
  return {
    tokenId,
    blockHash: blockHash.toLowerCase(),
    blockNumber: asNum(word(uRaw, 1)),
    mintedAt: asNum(word(uRaw, 2)),
    minter: asAddr(word(uRaw, 3)),
    /* 这是**铸造者填进 bang() 的声称值**，合约不核对（web/arc-chain.js 的 universeAt
       标了同一件事）。只有走 bangSigned 盖过章的才是服务端签出来的。
       所以下面 metadata 里要把"这个结局是谁说的"单列一条，不能让两者看起来一样可信。 */
    outcome: asNum(word(uRaw, 4)),
    verified: asBool(word(uRaw, 5)),
    rarity: asNum(word(uRaw, 6)),
    cardHash: isZero(cardHash) ? null : cardHash.toLowerCase(),
    /* 持有人烧 BANG 登记的名字，没有就是 null。**保留原文的大小写** ——
       链上存的就是原文，唯一性才是按归一化的 key 判的。 */
    name: cleanName(asString(nRaw)),
    burned: asBig(word(bRaw, 0)) || 0n,
    rescue: {
      at: asNum(word(rRaw, 0)) || 0,
      fromOutcome: asNum(word(rRaw, 1)),
      steps: asNum(word(rRaw, 2))
    }
  };
}

/** 去掉 18 位小数，只为显示。BANG 的整数部分才是用户念得出来的那个数 */
function bangWhole(v) {
  return (v / 10n ** 18n).toString();
}

/**
 * 把链上事实 + card 拼成 metadata。
 *
 * @param {object} chain readToken 的结果
 * @param {object} deps  { cardFor, storeGet, publicBase, version }
 *
 * card 的来源分四种，**分清楚它们是这个函数的全部工作**：
 *   none        cardOf 为 0 —— 没走服务端，链上明说不带参数。此时哪怕服务端算得出
 *               这个区块的参数也**不许印**：印了就等于把"直接 mint"和"引爆后 mint"
 *               这两档抹平，而市场收不收货正是按这一档分的（economy-v4 §4）。
 *   intervened  cardOf 在干预存档里 —— 参数被推过，图按 cardHash 索引。
 *   native      cardOf 等于服务端按 blockHash 重算出来的指纹 —— 原生盖章。
 *   unknown     cardOf 非零但两边都对不上。见下面的处理。
 */
function buildMetadata(chain, deps) {
  const { cardFor, storeGet, publicBase, version } = deps;
  const art = publicBase + '/api/art/';

  let source = 'none', card = null, image = null;
  if (chain.cardHash) {
    const stored = storeGet(chain.cardHash);
    if (stored) {
      source = 'intervened';
      card = stored;
      image = art + 'card/' + chain.cardHash + '.svg?v=' + version;
    } else {
      const nat = cardFor(chain.blockHash, chain.blockNumber);
      if (nat.cardHash.toLowerCase() === chain.cardHash) {
        source = 'native';
        card = nat.card;
        image = art + chain.blockHash + '.svg?p=1&v=' + version;
      } else {
        /* 链上盖了章，服务端却复算不出这张卡。两种成因：
             1. 这枚是旧推导版本铸的（cardHash 里签着 derivationVersion，升级后必然对不上）
             2. 干预存档丢了 —— 那份参数是用户当场提交的，链上只留指纹，反推不回来
           两种情况下**任何一张图都是假的**：印当前版本的参数是拿另一个宇宙换掉他买到的那个，
           印 NOT DETONATED 又是在否认他确实盖过章、烧过币。
           所以宁可不给 image —— 让它在市场上显示成缺图，而不是显示成一个错的宇宙。
            */
        source = 'unknown';
      }
    }
  } else {
    image = art + chain.blockHash + '.svg?v=' + version;   // 不带 p=1 → 图上印 NOT DETONATED
  }

  const attrs = [];
  const push = (t, v) => { if (v != null && v !== '') attrs.push({ trait_type: t, value: v }); };

  /* 档位（tier）链上没有，只有服务端的 card 里才有。没有 card 就不印 —— 别去猜。 */
  if (card && card.tier) {
    const ti = TIER_IDS.indexOf(card.tier.id);
    push('Tier', ti >= 0 ? TIER_EN[ti] : card.tier.name);
  }

  /* 结局印哪个：盖过章的用 card 里服务端签过的，没盖章的只能用铸造者声称的。
     两者都叫 "Outcome" 没问题，但必须再加一条说明它是谁说的 —— 否则
     一个直接 mint 的人随便填个 "Observers possible" 会和真货长得一模一样。 */
  const outIdx = card ? card.outcome.index : chain.outcome;
  if (outIdx != null && OUTCOME_EN[outIdx]) push('Outcome', OUTCOME_EN[outIdx]);
  push('Outcome source', card ? 'server-signed' : 'minter-claimed');
  /* 名字换成区块号之后，tokenId 得在属性里留一份 —— 市场和合约都按它索引，
     界面上完全找不到它的话，出问题时没法把一枚 NFT 对回链上那条记录。 */
  push('Token ID', String(chain.tokenId));
  // Block 那条下面已经有了（第 175 行附近），别重复推一次
  if (card) push('Observers', card.outcome.observers ? 'yes' : 'no');

  /* 维度：链上算不出来（合约里那个 dimOffOf 就是因为这个被删掉的），
     只有服务端跑过引擎才知道。没 card 就没有这一条。 */
  if (card && card.dimension && card.dimension.D != null) {
    push('Spatial dimension', Number(card.dimension.D.toFixed(3)));
    push('Dimension kind', card.dimension.kind === 'fractional' ? 'half-open' : 'integer');
  }

  /* 稀有度优先用链上的：它是被签进摘要、决定过定价和发币的那个值。
     链上没有（旧合约少这个字段）才退回 card 算的。 */
  const rarityIdx = chain.rarity != null ? chain.rarity : (card ? card.rarity.index : null);
  if (rarityIdx != null && RARITY_NAME[rarityIdx]) push('Rarity', RARITY_NAME[rarityIdx]);

  push('Parameters', source === 'none' ? 'none' : (source === 'unknown' ? 'stamped, unreadable' : 'stamped'));
  push('Block proof', chain.verified == null ? null : (chain.verified ? 'on-chain' : 'off-chain'));
  push('Block', chain.blockNumber);
  push('Block hash', chain.blockHash);

  /* 救活记录 —— economy-v4 §11 的结论是整个项目真正稀缺的只有这一样：
     区块要多少有多少，烧掉的币不是。所以它必须印在 metadata 上，而且数字要
     来自链上的 burnedOn（真的销毁量），不是来自 card 里那个服务端算的报价。 */
  if (chain.rescue.at) {
    push('Rescued', 'yes');
    push('Rescued from', OUTCOME_EN[chain.rescue.fromOutcome] || null);
    push('Interventions', chain.rescue.steps);
  }
  if (chain.burned > 0n) push('Burned', bangWhole(chain.burned));

  /* 名字。**单独一条 trait**，即使它同时也是上面的 name 字段 ——
     市场按 trait 筛选，只写在标题里的话筛不到「已命名」这一批。
     名字读不出来（没配命名合约、验不过）就一条都不印，不写 "unnamed"：
     "没有名字"和"名字读不到"是两回事，而这里分不出来，就都不说。 */
  const named = cleanName(chain.name);
  if (named) push('Name', named);

  let desc = 'A universe grown from ' + CHAIN_WORD + ' block ' + chain.blockNumber
    + '. One block hash, one set of genesis parameters, one outcome. '
    + 'Derived by an integer formula anyone can recompute from the block hash alone.';
  if (source === 'none') {
    desc += ' This one was minted without detonating: the chain carries no parameter stamp for it,'
      + ' so none are shown.';
  } else if (source === 'unknown') {
    desc += ' This token carries a parameter stamp (' + chain.cardHash + ') that this server cannot'
      + ' reproduce — it was minted under an older derivation, or its intervention record is missing.'
      + ' No image is shown rather than a wrong one.';
  } else if (source === 'intervened') {
    desc += ' Its parameters were moved away from the ones this block hash derives'
      + (chain.rescue.at ? ', into a universe that can hold observers.' : '.');
  }
  /* 命名这件事要在描述里说一句，而且要说清是**持有人**取的。
     不说的话，市场上一个叫 "earth" 的 NFT 看起来就像是发行方给的官方名字。 */
  if (named) {
    desc += ' Its holder named it "' + named + '" — names are unique across the'
      + ' collection and travel with the token.';
  }

  /* 名字用**区块号**，不是 tokenId。
     tokenId 只是铸造顺序（谁先点谁小），而"哪个区块"才是这个宇宙的身份 ——
     参数、结局、稀有度全是从那个区块的哈希派生的。区块号也是唯一的：
     合约的 tokenOfHash 不让同一个 blockHash 被引爆两次。
     链上读不到高度时（理论上不该发生）才退回 tokenId，总比没有名字好。 */
  /* **0 是合法区块号**：创世块。BSC 测试网的 0 号块
     （0x6d3c66c5…）已经被引爆并铸出来了，它的名字就该是 Universe #0。
     这里原来写的是 > 0，等于把创世宇宙的名字退回成 tokenId —— 只有
     null / undefined 才算"读不到"。 */
  const uniNo = chain.blockNumber == null ? chain.tokenId : chain.blockNumber;

  /* 命名过的就用名字当标题，编号退成 Block / Token ID 两条属性（上面已经印了）。
     这和市场页的处理是同一条规则：**名字优先，编号退成次要，但一个都不能丢** ——
     名字可以改、可以放弃，区块号不能，出问题时要靠它把一枚 NFT 对回链上。 */
  const meta = {
    // 比特币宇宙的名字把来源写进去：两站共用一个市场，「Universe #840000」看不出它是哪条链的块
    name: named || ('Universe #' + uniNo),
    description: desc,
    external_url: publicBase + '/',      // 还没有按 token 的深链页面，指站点根，别造死链
    attributes: attrs
  };
  // image 只在真知道该画什么的时候才给。缺图好过错图
  if (image) meta.image = image;
  return { meta, source, card };
}

/**
 * MirrorCrafted.cardOf 返回值。8 槽取 burned；7 槽（旧字节码）burned=null，不报错。
 * 字段序照 MirrorCrafted:41-50。
 */
function parseCraftedCard(raw) {
  const originHash = asHash(word(raw, 0));
  const opsHash = asHash(word(raw, 1));
  const cardHash = asHash(word(raw, 2));
  const burnedW = word(raw, 7);
  return {
    originHash: isZero(originHash) ? null : (originHash ? originHash.toLowerCase() : null),
    opsHash: isZero(opsHash) ? null : (opsHash ? opsHash.toLowerCase() : null),
    cardHash: isZero(cardHash) ? null : (cardHash ? cardHash.toLowerCase() : null),
    outcome: asNum(word(raw, 3)),
    rarity: asNum(word(raw, 4)),
    originBlock: asNum(word(raw, 5)),
    paid: asBig(word(raw, 6)) || 0n,
    burned: burnedW == null ? null : (asBig(burnedW) || 0n)
  };
}

/**
 * 读一枚造物 token 的链上事实。
 * @returns {Promise<object|null>} null = 这个 id 没铸过
 */
async function readCrafted(contract, tokenId, namesAddr) {
  const arg = tokenId.toString(16).padStart(64, '0');
  const names = (namesAddr === undefined ? NAMES2 : namesAddr) || '';
  const soft = { nullOnRevert: true };
  const [cRaw, bpsRaw, nRaw] = await Promise.all([
    ethCall(contract, sel('cardOf(uint256)') + arg),
    ethCall(contract, sel('burnBps()'), soft),
    names ? ethCall(names, sel('nameOf(uint256)') + arg, soft) : Promise.resolve(null)
  ]);

  const w0 = word(cRaw, 0);
  if (w0 == null) {
    const e = new Error('合约地址 ' + contract + ' 读不出 cardOf：返回数据是空的，'
      + '这个地址上多半没有合约（或者服务端连错了链）');
    e.noContract = true;
    throw e;
  }

  const parsed = parseCraftedCard(cRaw);
  if (!parsed.cardHash) return null;

  let burnBps = asBig(word(bpsRaw, 0));
  if (burnBps != null && (burnBps < 1n || burnBps > 10000n)) burnBps = null;

  return {
    tokenId,
    originHash: parsed.originHash,
    opsHash: parsed.opsHash,
    cardHash: parsed.cardHash,
    outcome: parsed.outcome,
    rarity: parsed.rarity,
    originBlock: parsed.originBlock,
    paid: parsed.paid,
    burned: parsed.burned,
    burnBps,
    name: cleanName(asString(nRaw))
  };
}

/**
 * 造物 metadata。销毁量优先用链上 burned；读不到才按当前 burnBps 折 paid，并标注。
 */
function buildCraftedMetadata(chain, deps) {
  const { storeGet, publicBase, version } = deps;
  const art = publicBase + '/api/art/';

  let card = null, image = null;
  if (chain.cardHash) {
    const stored = storeGet(chain.cardHash);
    if (stored) {
      card = stored;
      image = art + 'crafted/' + String(chain.tokenId) + '.svg?v=' + version;
    }
  }

  const attrs = [];
  const push = (t, v) => { if (v != null && v !== '') attrs.push({ trait_type: t, value: v }); };

  if (card && card.tier) {
    const ti = TIER_IDS.indexOf(card.tier.id);
    push('Tier', ti >= 0 ? TIER_EN[ti] : card.tier.name);
  }

  const outIdx = card ? card.outcome.index : chain.outcome;
  if (outIdx != null && OUTCOME_EN[outIdx]) push('Outcome', OUTCOME_EN[outIdx]);
  push('Token ID', String(chain.tokenId));
  if (card && card.outcome) push('Observers', card.outcome.observers ? 'yes' : 'no');

  if (card && card.dimension && card.dimension.D != null) {
    push('Spatial dimension', Number(card.dimension.D.toFixed(3)));
    push('Dimension kind', card.dimension.kind === 'fractional' ? 'half-open' : 'integer');
  }

  const rarityIdx = chain.rarity != null ? chain.rarity : (card ? card.rarity.index : null);
  if (rarityIdx != null && RARITY_NAME[rarityIdx]) push('Rarity', RARITY_NAME[rarityIdx]);

  if (chain.originBlock != null) push('Origin block', chain.originBlock);
  if (chain.originHash) push('Origin hash', chain.originHash);
  if (chain.opsHash) push('Ops hash', chain.opsHash);
  if (chain.cardHash) push('Card hash', chain.cardHash);
  if (chain.paid != null) push('Paid', bangWhole(chain.paid));

  const burn = craftedBurnOf(chain.burned, chain.paid, chain.burnBps);
  if (burn.amount != null) {
    const n = bangWhole(burn.amount);
    push('销毁', burn.estimated ? (n + '（按当前费率折算）') : n);
    push('Burned', n);
    if (burn.estimated) push('Burn source', 'estimated at current burnBps');
  }

  const named = cleanName(chain.name);
  if (named) push('Name', named);

  let desc = 'A universe derived from ' + CHAIN_WORD + ' block '
    + (chain.originBlock != null ? chain.originBlock : '?')
    + ' and reshaped by a recorded sequence of interventions. Replay origin hash + ops through the open engine to recompute this exact card.';
  const burnLabel = craftedBurnLabel(chain.burned, chain.paid, chain.burnBps);
  if (burnLabel) desc += ' ' + burnLabel + '.';
  if (named) {
    desc += ' Its holder named it "' + named + '" — names are unique across the'
      + ' crafted collection and travel with the token.';
  }

  const meta = {
    name: named || ('Crafted Universe #' + String(chain.tokenId)),
    description: desc,
    external_url: publicBase + '/',
    attributes: attrs
  };
  if (image) meta.image = image;
  return { meta, card, burn };
}

module.exports = {
  readToken, buildMetadata,
  readCrafted, buildCraftedMetadata, parseCraftedCard
};
