/*
 * 市场索引层 —— 后台跟事件，前端只打一页 API
 * ============================================================================
 * specs/market-index-v1.md 第一、二节。目标：挂单一百万也能开得动市场页。
 *
 * 一条贯穿全文件的纪律：**索引只服务「看」，不服务「写」**。
 * 铸造（/api/bang）、干预（/api/intervene）、造物（/api/craft）三条链路
 * 一个字节都不经过这里。这个模块整个挂掉、RPC 全断、落盘文件被删，
 * 后果的上限是「市场页看到的是旧数据，并且自己说自己旧」——
 * 不是白屏，更不是签不出名。所以：
 *   · 定时器里的每一轮都包在 try/catch 里，异常只打日志，绝不外泄；
 *   · 对外的三个查询函数（listingsPage / ownedOf / statusOf）**不抛错**，
 *     最坏情况返回空集 + stale: true；
 *   · require 这个文件不启动任何东西，startIndexer() 才启动
 *     （selftest 直接 require index.js，不该因此在后台开始扫链）。
 *
 * ----------------------------------------------------------------------------
 * 为什么不用 chain.js 的 overNodes
 * ----------------------------------------------------------------------------
 * 它没导出，而 specs/market-index-v1.md 划死了改动边界（只许新建本文件与测试文件、
 * 在 index.js 挂三条路由）。chain.js 导出了 RPCS 与 ethCall，够用：
 * eth_getLogs 这边自己轮换节点（它需要比 8 秒更长的超时、和不一样的重试口径），
 * 元数据补齐直接复用 ethCall。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ethCall, RPCS, rpcsForLogs } = require('./chain.js');
const { envInt } = require('./envint.js');

/* ============================================================ 配置 */

const STORE_DIR = process.env.ARCBANG_STORE || path.join(__dirname, '.store');
const INDEX_FILE = path.join(STORE_DIR, 'market-index.json');
const META_FILE = path.join(STORE_DIR, 'meta-cache.json');

const lc = (s) => String(s || '').toLowerCase();
const ADDR_RE = /^0x[0-9a-f]{40}$/;

const CFG = {
  market: lc(process.env.ARCBANG_MARKET),
  universe: lc(process.env.ARCBANG_CONTRACT),
  crafted: lc(process.env.ARCBANG_CRAFTED),
  names: lc(process.env.ARCBANG_NAMES),      // BangNames  → 原生宇宙的名字
  names2: lc(process.env.ARCBANG_NAMES2),    // BangNames2 → 造物的名字（specs/crafted-names-v1.md）
  /* 起点：合约部署高度。没配就从当前高度往回 50,000 块 ——
     BSC 三秒一块，五万块约等于 41 小时，够覆盖「今天刚部署」这个常态。
     真上主网时必须显式配部署高度，否则每次冷启动都白扫五万块。 */
  from: envInt(process.env.ARCBANG_INDEX_FROM, 0, 0, Number.MAX_SAFE_INTEGER),
  /* NaN/0 会让 setInterval 按 0ms 狂火，跟正在跑的 scanOnce 叠出一串 enrichSome。 */
  intervalMs: envInt(process.env.ARCBANG_INDEX_INTERVAL, 15000, 1000, 300000),
  /* **分片上限 5,000 块，不能赌。** 公共 RPC 对 eth_getLogs 的跨度普遍设了上限，
     超了是直接报错（"exceed maximum block range"），**不是**返回前 5000 块的部分结果。
     赌一把的代价不是慢，是整轮扫描失败、索引永远停在原地。
     Arc（5042 / 5042002）那边单次上限是 20,000 块，比这里宽：
     envInt 的第四个参数把 chunk 夹死在 5,000，**环境变量也调不上去**，
     所以 Arc 上永远是 5,000 ≤ 20,000，不用分链设第二个值。 */
  chunk: envInt(process.env.ARCBANG_INDEX_CHUNK, 5000, 1, 5000),
  /* 重组容错：只把 latest-15 之前的块记成「已确认」，之后的每轮重扫。
     BSC 终局很快（PoSA），15 块是保守值。
     重扫不怕：状态机按 (blockNumber, logIndex) 单调推进，同一事件重放不改变结果。
     NaN 会让 lastScanned 永远不前进（NaN > n 恒 false）。 */
  confirmations: envInt(process.env.ARCBANG_INDEX_CONFIRMATIONS, 15, 0, 256),
  lookback: 50000,
  flushMs: 10000,          // 落盘节流：内存为准，最多每 10 秒写一次盘
  /* 「只有 lastScanned 往前挪了」这种轮次的落盘间隔。
     **这一条是给一百万挂单准备的**：lastScanned 每一轮都会前进，
     按 10 秒的节奏写就是每 10 秒把整张表重新 stringify 一遍并落盘 ——
     一百万条挂单时那是几百 MB 的写，而它换来的只是「重启时少扫几十个块」。
     真有事件变化时仍然走 flushMs 的 10 秒档，那才是值得马上写下去的东西。 */
  flushTipMs: 60000,
  maxSales: 500,           // sales 只留最近这么多笔
  metaTtlMs: 60000,        // 可变元数据（原生 cardOf/outcome、两系列的 name）缓 60 秒
  metaMax: 40000,          // 元数据缓存条目上限，超了按最后刷新时间淘汰
  enrichPerRound: 48,      // 每轮扫描顺手补几个挂单的元数据（摊薄首屏成本）
  /* 每轮顺手给几枚**没挂单的**原生持仓补元数据。分享落地页与 sitemap 要靠 meta 里的
     blockHash / blockNumber 答「这个哈希铸了没有」（见 mintStatusOf），而 meta 原来只为
     挂单和个人中心服务，从没挂过单的 token 永远不会进来。48 枚 × 每轮 15 秒，
     一小时补一万枚出头；补齐之前 mintStatusOf 老老实实答「不知道」。 */
  coverPerRound: 48,
  metaConcurrency: 8,      // 补元数据时的并发 eth_call 数
  metaFilterBudget: 600,   // 带 rarity/outcome/named 过滤时最多考察多少个候选
  tsPerRound: 50,          // 一轮最多抓多少个区块的时间戳
  logTimeoutMs: 20000,
  staleAfterMs: 90000,     // 这么久没有一轮成功的扫描就报 stale

  /* ---- 物理字段（specs/market-physics-filter.md 第一节） ----
     physColdBudget：一次 ensureMeta 里最多允许几次**冷算**（.cache 里没有、
       必须真跑一遍引擎的 buildCard，实测 14 ms/次）。热的（缓存命中）不占预算。
       没这道闸的话，一次带筛选的冷请求会考察 metaFilterBudget=600 个候选，
       600×14ms = 8.4 秒**同步**堵住事件循环 —— 那不是慢，那是整台服务停摆。
       超预算的留 ph:null + phNext:now，下一轮后台补齐时再算。
     physRetryMs：物理量真的读不出来（造物没存档、复算对不上 cardHash）时的重试间隔。
       不能不重试 —— 存档可能是后来才恢复的；也不能每轮重试 —— 那是白烧 eth_call。 */
  physColdBudget: envInt(process.env.ARCBANG_INDEX_PHYS_BUDGET, 48, 1, 256),
  physRetryMs: 1800000,
  devLow: 0.10,            // 「与我们宇宙偏离小」的门槛：三项相对偏差的最大值 ≤10%
  devHigh: 0.50            // 「偏离大」：>50%
};

const enabled = () => process.env.ARCBANG_INDEX_OFF !== '1'
  && ADDR_RE.test(CFG.market) && ADDR_RE.test(CFG.universe);

/* ============================================================ 事件与选择器

   事件 topic0 = keccak256(事件签名)（不截断），函数选择器 = keccak256(签名) 前 4 字节。
   签名逐字抄自 contracts/src/*.sol，值离线算好写死 —— 用的是站点那份
   web/keccak-lite.js，好让浏览器和服务端永远是同一份实现。

   **复核命令**（改了合约签名就回来重算；对不上的表现是索引一条事件都收不到）：

     node -e "var K=require('./web/keccak-lite.js'); \
       ['Listed(uint256,address,address,uint256,uint256,uint256,bool,bool)', \
        'Cancelled(uint256,address)', \
        'Sold(uint256,address,address,uint256,uint256,bool)', \
        'Transfer(address,address,uint256)'] \
       .forEach(function(s){ console.log(K.keccak256(s), s); })"

     node -e "var K=require('./web/keccak-lite.js'); \
       ['cardOf(uint256)','nameOf(uint256)','burnedOn(uint256)','universeOf(uint256)'] \
       .forEach(function(s){ console.log(K.keccak256(s).slice(0,10), s); })"

   Transfer 那条算出来是 0xddf252ad…，正是 ERC-721/ERC-20 世所共知的那一个 ——
   这本身就是一次交叉验算：算错了不可能正好撞上它。
   marketindex-test.js 里还有一条测试会把这四个常量再算一遍比对，
   所以「合约改了签名却忘了改这里」会在测试里当场红掉，而不是在线上安静地少收事件。 */
const TOPICS = {
  // MirrorMarket.sol:87  Listed(uint256 indexed listingId, address indexed seller,
  //                             address indexed token, uint256 id, uint256 amount,
  //                             uint256 price, bool is1155, bool inBang)
  Listed: '0x8681fffa8ffc199dcd15be528cd99e1632c630438624ecfeda749228c5503755',
  // MirrorMarket.sol:97  Cancelled(uint256 indexed listingId, address indexed seller)
  Cancelled: '0x26deca31ff8139a06c52453ce8985d34f7648a6d9af1d283c4063d052c355a0f',
  // MirrorMarket.sol:98  Sold(uint256 indexed listingId, address indexed buyer,
  //                          address indexed seller, uint256 price, uint256 fee, bool inBang)
  Sold: '0x0f3da34075a8a481156bc430d602159ff2da0ccafc75fcdd04de3944ecbed3a9',
  // MirrorUniverse.sol:294 / MirrorCrafted.sol:89
  //                     Transfer(address indexed from, address indexed to, uint256 indexed id)
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  /* MirrorCrafted.Crafted。burned 加在末尾，topic0 跟着签名变了 ——
     新旧两份都认：现役测试网造物合约未部署，但旧字节码可能在别处。 */
  // Crafted(uint256 indexed tokenId, bytes32 indexed originHash, bytes32 indexed cardHash,
  //         bytes32 opsHash, uint8 rarity, uint256 cost, uint256 burned)
  Crafted: '0x8ad1eceef2c1e5e3448c0618d3877f809105cab21705c16cf9649f650448b605',
  // 旧：没有末尾 burned。签名少一个 uint256，topic0 不同。
  CraftedOld: '0xab2dd9c101b6669b1d91d51e611fc52152885970500f073ce924bfd654613098'
};

/** 事件签名原文，测试用它复算 TOPICS。改签名的时候两边一起改，改漏了测试会报 */
const EVENT_SIGS = {
  Listed: 'Listed(uint256,address,address,uint256,uint256,uint256,bool,bool)',
  Cancelled: 'Cancelled(uint256,address)',
  Sold: 'Sold(uint256,address,address,uint256,uint256,bool)',
  Transfer: 'Transfer(address,address,uint256)',
  Crafted: 'Crafted(uint256,bytes32,bytes32,bytes32,uint8,uint256,uint256)',
  CraftedOld: 'Crafted(uint256,bytes32,bytes32,bytes32,uint8,uint256)'
};

/* ------------------------------------------------------------ Arc：另一套市场事件

   ArcMarket 是 MirrorMarket 的无币版（contracts/src/ArcMarket.sol）：BANG 没了，
   于是 Listed 末尾的 is1155/inBang 两个 bool 没了、Sold 的 inBang 换成了
   royalty + royaltyReceiver、Cancelled 多了第三个 indexed（by：谁撤的 ——
   cancelStale 让路人也能清失效单），还多出一个 PriceChanged。
   **四个签名全变了，topic0 也就全变了**：拿主线那套 topic 去 Arc 上查 eth_getLogs，
   回来的是一个合法的空数组 —— 索引不报错、不 stale，安安静静地一条挂单都收不到。
   这正是这一节存在的理由。

   解码出来的挂单对象与主线**同形**：inBang 恒 false、is1155 恒 false、
   token 恒等于 ArcUniverse（ArcMarket.list() 里写死的 nft）。
   前端 web/market.html 与 /api/market 因此一个字节都不用改。

   **复核命令**（改了 ArcMarket 的事件签名就回来重算）：

     node -e "var K=require('./web/keccak-lite.js'); \
       ['Listed(uint256,address,address,uint256,uint256,uint256)', \
        'Cancelled(uint256,address,address)', \
        'PriceChanged(uint256,address,uint256,uint256)', \
        'Sold(uint256,address,address,uint256,uint256,uint256,address)'] \
       .forEach(function(s){ console.log(K.keccak256(s), s); })"

   selftest 里有一条用例会把这四个常量再算一遍比对，签名改了忘了改这里会当场红掉。 */
const ARC_TOPICS = {
  // ArcMarket.sol  Listed(uint256 indexed listingId, address indexed seller,
  //                       address indexed token, uint256 id, uint256 amount, uint256 price)
  Listed: '0x1d2286580411f12056775bf9e0fd10101148b09a6fca67c9f426fb113a28d1f8',
  // ArcMarket.sol  Cancelled(uint256 indexed listingId, address indexed seller, address indexed by)
  Cancelled: '0x53f0d99629f4e9878bf5fd8f104f115f47a53477d0d85add41f932d18291a506',
  // ArcMarket.sol  PriceChanged(uint256 indexed listingId, address indexed seller,
  //                             uint256 oldPrice, uint256 newPrice)
  PriceChanged: '0x4dd527488b2da8f4ed25ba1bcb310a986b81f7853d55baaa39fd87f69b49ff65',
  // ArcMarket.sol  Sold(uint256 indexed listingId, address indexed buyer, address indexed seller,
  //                     uint256 price, uint256 fee, uint256 royalty, address royaltyReceiver)
  Sold: '0x7e099afe369bc74451fca3447329cd897c0a2ab79e3f89806c9faaeb59188741'
};

/** Arc 那四条事件的签名原文，selftest 拿它复算 ARC_TOPICS */
const ARC_EVENT_SIGS = {
  Listed: 'Listed(uint256,address,address,uint256,uint256,uint256)',
  Cancelled: 'Cancelled(uint256,address,address)',
  PriceChanged: 'PriceChanged(uint256,address,uint256,uint256)',
  Sold: 'Sold(uint256,address,address,uint256,uint256,uint256,address)'
};

/* Arc 主网 / 测试网。判定**每次现读 process.env**，不认 chain.js 的 CHAIN_ID 常量：
   marketindex.js 会被 selftest 在设链之前 require（server/intervene.js 的 rescueWei
   为同一个坑写了同一条注释），模块顶层把 chainId 定死就会定死成 NaN，
   之后 env 补上了也回不来 —— 表现正是「Arc 站一条挂单都收不到」。
   现读一次 Number() 的代价对每条 log 来说也可以忽略。 */
const ARC_CHAIN_IDS = new Set([5042, 5042002]);
const isArcChain = () => ARC_CHAIN_IDS.has(Number(process.env.ARCBANG_CHAIN_ID));

/** 这条链上市场合约会发的 topic0 列表（scanOnce 的 eth_getLogs 按它查） */
const marketTopics = () => (isArcChain()
  ? [ARC_TOPICS.Listed, ARC_TOPICS.Cancelled, ARC_TOPICS.PriceChanged, ARC_TOPICS.Sold]
  : [TOPICS.Listed, TOPICS.Cancelled, TOPICS.Sold]);

const SEL = {
  cardOf: '0xc22b8d82',      // cardOf(uint256)      原生 → bytes32；造物 → 8 槽 Card（旧字节码 7 槽）
  nameOf: '0x051a2664',      // nameOf(uint256)      → string
  burnedOn: '0xffeb9ad4',    // burnedOn(uint256)    原生：这枚 token 累计烧掉的 BANG
  universeOf: '0x003eb9d7'   // universeOf(uint256)  → (blockHash, blockNumber, mintedAt,
                             //                        minter, outcome, verified, rarity)
};
const FN_SIGS = {
  cardOf: 'cardOf(uint256)', nameOf: 'nameOf(uint256)',
  burnedOn: 'burnedOn(uint256)', universeOf: 'universeOf(uint256)'
};

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

/* ============================================================ 小工具 */

const hexToNum = (h) => {
  try {
    const n = Number(BigInt(h == null ? 0 : h));
    return Number.isSafeInteger(n) ? n : 0;
  } catch (e) { return 0; }
};
const hexToBig = (h) => {
  try { return BigInt(h == null ? 0 : h); } catch (e) { return 0n; }
};
/** 32 字节的字，i 从 0 起。取不到返回 null（别让一段畸形数据把整轮扫描弄崩） */
function word(raw, i) {
  const body = String(raw || '').replace(/^0x/, '');
  return body.length < (i + 1) * 64 ? null : body.slice(i * 64, (i + 1) * 64);
}
const wAddr = (w) => (w == null ? null : '0x' + w.slice(24).toLowerCase());
const wBig = (w) => { try { return w == null ? null : BigInt('0x' + w); } catch (e) { return null; } };
const wNum = (w) => { const b = wBig(w); return b == null ? null : Number(b); };
const wHash = (w) => (w == null ? null : '0x' + w.toLowerCase());
const isZeroHash = (h) => h == null || /^0x0*$/.test(h);

/**
 * MirrorCrafted.cardOf(id) → Card 结构体。
 *   8 槽（现源码）：0 originHash  1 opsHash  2 cardHash  3 outcome  4 rarity
 *                   5 originBlock  6 paid  7 burned
 *   7 槽（旧字节码）：没有 burned，burned 落 null，不报错。
 * 字段只往末尾追加才兼容；往中间插会整个错位。
 * **不抛**：畸形数据给得出多少算多少，缺的槽是 null。
 */
function parseCraftedCard(raw) {
  const ch = wHash(word(raw, 2));
  const burnedW = word(raw, 7);
  return {
    originHash: wHash(word(raw, 0)),
    opsHash: wHash(word(raw, 1)),
    cardHash: isZeroHash(ch) ? null : ch,
    outcome: wNum(word(raw, 3)),
    rarity: wNum(word(raw, 4)),
    originBlock: wNum(word(raw, 5)),
    paid: (wBig(word(raw, 6)) || 0n).toString(),
    burned: burnedW == null ? null : (wBig(burnedW) || 0n).toString()
  };
}

/**
 * Crafted 事件 data：opsHash / rarity / cost / [burned]。
 * 4 槽（新）burned 取末槽；3 槽（旧）burned=null。不抛。
 * 入参可以是 data hex，也可以是 {topics, data} 整条 log。
 */
function parseCraftedEvent(logOrData) {
  const isLog = logOrData && typeof logOrData === 'object'
    && (logOrData.data != null || Array.isArray(logOrData.topics));
  const data = isLog ? logOrData.data : logOrData;
  const topics = isLog ? (logOrData.topics || []) : [];
  const burnedW = word(data, 3);
  const costW = word(data, 2);
  const out = {
    opsHash: wHash(word(data, 0)),
    rarity: wNum(word(data, 1)),
    cost: costW == null ? null : (wBig(costW) || 0n).toString(),
    burned: burnedW == null ? null : (wBig(burnedW) || 0n).toString()
  };
  if (topics[1] != null) out.tokenId = hexToBig(topics[1]).toString();
  if (topics[2] != null) out.originHash = wHash(word(topics[2], 0));
  if (topics[3] != null) out.cardHash = wHash(word(topics[3], 0));
  return out;
}

/** 事件在链上的全序位置。同一张挂单的事件只能沿它单调推进，见 applyOne */
function seqOf(blockNo, logIndex) {
  // blockNo 到 1e9 时 seq 是 1e15，仍在 2^53 之内；logIndex 封顶 999999
  return blockNo * 1e6 + Math.min(Math.max(logIndex, 0), 999999);
}

const tokenKey = (token, id) => lc(token) + ':' + String(id);

/* ============================================================ 状态

   落盘的就是那四个字段。两张派生表挂在 state 上但**不可枚举**，
   所以 JSON.stringify 看不见它们 —— 读盘时由 rebuildDerived 重建。
   （挂成普通字段的话，Map/Set 会被 stringify 成 {}，落盘文件里多两个永远是空的键，
     下次读回来还会被误当成数据。）

     byOwner    owner → Set("token:tokenId")。没有它，/api/market/owned 要遍历
                整张 owners 表：一百万枚 token 时一次请求就是一百万次比较 ——
                那正是这份规格要消灭的东西。
     activeSet  还挂着的 listingId。没有它，每次翻页都要把**历史上所有**挂单
                （含早就撤掉、卖掉的）过一遍。活跃单数会稳定下来，
                但历史总数只增不减，那是个随时间无限恶化的扫描。 */

function emptyState() {
  const s = { lastScanned: 0, listings: Object.create(null), owners: Object.create(null), sales: [] };
  Object.defineProperty(s, 'byOwner', { value: new Map(), enumerable: false, writable: true });
  Object.defineProperty(s, 'activeSet', { value: new Set(), enumerable: false, writable: true });
  return s;
}

let st = emptyState();

const runtime = {
  latest: 0,           // 最后一次 eth_blockNumber 的结果
  lastOkAt: 0,         // 最后一次「整轮成功」的时间戳（ms）
  lastErr: null,       // 最后一次失败的原因（给 /status 看，不进日志刷屏）
  scans: 0,
  logsSeen: 0,
  started: false,
  running: false,
  timer: null,
  dirty: false,        // 有事件改动没落盘
  tipDirty: false,     // 只有 lastScanned 前进没落盘（低优先级，见 CFG.flushTipMs）
  lastFlushAt: 0,
  rpcIdx: 0,
  rpcCalls: 0,         // 本进程累计打了多少次 RPC（性能对照用）
  ticking: false,      // scanOnce + enrichSome 整段占位，防定时器重叠
  /* 原生持仓里还有几枚没补上 blockHash/blockNumber 元数据。null = 还没数过。
     只有它是 0 时，mintStatusOf 才敢对反查不到的哈希说「没铸过」。 */
  coverGap: null
};

/* ============================================================ 落盘

   写盘用「先写临时文件再 rename」：rename 在同一分区上是原子的，
   进程正好在写到一半时被 kill 也不会留下半截 JSON。
   索引文件本身**可再生**（大不了从头扫一遍链），所以读盘时坏了就当没有，
   绝不因此拒绝启动 —— 这和 index.js 里 storeGet 的存档不一样，那个丢了是真丢了。 */

function ensureDir() {
  try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch (e) { /* 已存在 */ }
}

function writeAtomic(file, text) {
  ensureDir();
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    const next = emptyState();
    next.lastScanned = Number(j.lastScanned) || 0;
    if (j.listings && typeof j.listings === 'object') Object.assign(next.listings, j.listings);
    if (j.owners && typeof j.owners === 'object') Object.assign(next.owners, j.owners);
    if (Array.isArray(j.sales)) next.sales = j.sales.slice(-CFG.maxSales);
    st = next;
    rebuildDerived(st);
    console.log('[marketindex] 续扫：lastScanned=' + st.lastScanned
      + '  挂单 ' + Object.keys(st.listings).length
      + '  持仓 ' + Object.keys(st.owners).length);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[marketindex] 索引文件读不了，从头扫：' + e.message);
    st = emptyState();
  }
}

/**
 * 落盘。两档节流，见 CFG.flushTipMs：
 *   dirty    真有事件改动 → 10 秒档
 *   tipDirty 只是 lastScanned 往前挪了 → 60 秒档
 */
function flush(force) {
  const now = Date.now();
  if (!force) {
    if (runtime.dirty) { if (now - runtime.lastFlushAt < CFG.flushMs) return false; }
    else if (runtime.tipDirty) { if (now - runtime.lastFlushAt < CFG.flushTipMs) return false; }
    else return false;
  }
  try {
    writeAtomic(INDEX_FILE, JSON.stringify({
      lastScanned: st.lastScanned,
      listings: st.listings,
      owners: st.owners,
      sales: st.sales
    }));
    runtime.lastFlushAt = now;
    runtime.dirty = false;
    runtime.tipDirty = false;
    return true;
  } catch (e) {
    /* 写不了盘不是灾难：内存里的索引照常服务，下次再试。
       报出来但不抛 —— 磁盘满的时候市场页不该跟着白屏。 */
    console.error('[marketindex] 落盘失败（内存索引照常用）：' + e.message);
    return false;
  }
}

/* ============================================================ 状态机

   下面几个函数是这个模块的心脏，**纯函数、不碰网络**，marketindex-test.js
   拿假 log 直接喂它们。真链那一侧只负责把 log 抓回来按顺序递进去。 */

/**
 * MirrorMarket（BSC / BTC 两站）的三条市场事件 → 归一化事件。认不出来返回 null。
 * base 是 decodeLog 已经算好的 {addr, blockNo, logIndex, seq}。
 */
function decodeMirrorMarketLog(log, t0, base) {
  if (t0 === TOPICS.Listed) {
    if (log.topics.length < 4) return null;
    return Object.assign(base, {
      kind: 'Listed',
      listingId: hexToBig(log.topics[1]).toString(),
      seller: wAddr(word(log.topics[2], 0)),
      token: wAddr(word(log.topics[3], 0)),
      id: (wBig(word(log.data, 0)) || 0n).toString(),
      amount: (wBig(word(log.data, 1)) || 0n).toString(),
      price: (wBig(word(log.data, 2)) || 0n).toString(),
      is1155: (wBig(word(log.data, 3)) || 0n) === 1n,
      inBang: (wBig(word(log.data, 4)) || 0n) === 1n
    });
  }
  if (t0 === TOPICS.Cancelled) {
    if (log.topics.length < 3) return null;
    return Object.assign(base, {
      kind: 'Cancelled',
      listingId: hexToBig(log.topics[1]).toString(),
      seller: wAddr(word(log.topics[2], 0))
    });
  }
  if (t0 === TOPICS.Sold) {
    if (log.topics.length < 4) return null;
    return Object.assign(base, {
      kind: 'Sold',
      listingId: hexToBig(log.topics[1]).toString(),
      buyer: wAddr(word(log.topics[2], 0)),
      seller: wAddr(word(log.topics[3], 0)),
      price: (wBig(word(log.data, 0)) || 0n).toString(),
      fee: (wBig(word(log.data, 1)) || 0n).toString(),
      inBang: (wBig(word(log.data, 2)) || 0n) === 1n
    });
  }
  return null;
}

/**
 * ArcMarket（Arc 主网 / 测试网）的四条市场事件 → 归一化事件，**字段与主线同形**。
 *
 * 同形的三条恒定值不是凑数，是这份改动的全部意义所在：
 *   inBang: false —— Arc 上没有 BANG，一切计价都是 native（USDC，18 位小数）；
 *   is1155: false —— ArcMarket 只收 ArcUniverse 这一个 ERC-721；
 *   token          —— 从 topics[3] 读出来的就是那个 ArcUniverse 地址（合约里写死的 nft）。
 * 有了它们，applyOne / listingsPage / market.html 三段代码一个字都不用分链写。
 *
 * Arc 独有的两件事：
 *   · Cancelled 第三个 indexed 是 by（谁撤的）。卖家自己撤时 by == seller；
 *     失效挂单被路人 cancelStale 清掉时 by 是那个路人。记成 by 带出去，
 *     不覆盖 seller —— 挂单归属永远是 seller 那一个。
 *   · PriceChanged 是主线没有的第四条事件。不认它的后果是「卖家改了价，
 *     市场页永远显示旧价，点进去按新价报错」—— 比收不到挂单更难查。
 */
function decodeArcMarketLog(log, t0, base) {
  if (t0 === ARC_TOPICS.Listed) {
    if (log.topics.length < 4) return null;
    return Object.assign(base, {
      kind: 'Listed',
      listingId: hexToBig(log.topics[1]).toString(),
      seller: wAddr(word(log.topics[2], 0)),
      token: wAddr(word(log.topics[3], 0)),
      id: (wBig(word(log.data, 0)) || 0n).toString(),
      amount: (wBig(word(log.data, 1)) || 0n).toString(),
      price: (wBig(word(log.data, 2)) || 0n).toString(),
      is1155: false,
      inBang: false
    });
  }
  if (t0 === ARC_TOPICS.Cancelled) {
    /* 三个 indexed，所以是 4 个 topic。少于 4 个的要么不是这条事件，
       要么是条畸形 log —— 两种情况都该当作没看见。 */
    if (log.topics.length < 4) return null;
    return Object.assign(base, {
      kind: 'Cancelled',
      listingId: hexToBig(log.topics[1]).toString(),
      seller: wAddr(word(log.topics[2], 0)),
      by: wAddr(word(log.topics[3], 0))
    });
  }
  if (t0 === ARC_TOPICS.PriceChanged) {
    if (log.topics.length < 3) return null;
    return Object.assign(base, {
      kind: 'PriceChanged',
      listingId: hexToBig(log.topics[1]).toString(),
      seller: wAddr(word(log.topics[2], 0)),
      oldPrice: (wBig(word(log.data, 0)) || 0n).toString(),
      price: (wBig(word(log.data, 1)) || 0n).toString()
    });
  }
  if (t0 === ARC_TOPICS.Sold) {
    if (log.topics.length < 4) return null;
    return Object.assign(base, {
      kind: 'Sold',
      listingId: hexToBig(log.topics[1]).toString(),
      buyer: wAddr(word(log.topics[2], 0)),
      seller: wAddr(word(log.topics[3], 0)),
      price: (wBig(word(log.data, 0)) || 0n).toString(),
      fee: (wBig(word(log.data, 1)) || 0n).toString(),
      royalty: (wBig(word(log.data, 2)) || 0n).toString(),
      royaltyReceiver: wAddr(word(log.data, 3)),
      inBang: false
    });
  }
  return null;
}

/** raw log → 归一化事件。认不出来返回 null（多一个未知事件不该弄崩一整轮） */
function decodeLog(log, cfg) {
  const c = cfg || CFG;
  if (!log || !Array.isArray(log.topics) || !log.topics.length) return null;
  const addr = lc(log.address);
  const t0 = lc(log.topics[0]);
  const blockNo = hexToNum(log.blockNumber);
  const logIndex = hexToNum(log.logIndex);
  const base = { addr, blockNo, logIndex, seq: seqOf(blockNo, logIndex) };

  if (addr === lc(c.market)) {
    /* 按链选解码器，而不是「两套 topic 都试一遍」：两份签名的 topic0 不可能相撞，
       但「都试」意味着一条链上的畸形 log 有机会被另一条链的解码器按错误的字段位读走。
       cfg.arc 是给测试用的显式开关（不传就现读 env）。 */
    const arc = (c && c.arc != null) ? !!c.arc : isArcChain();
    return arc ? decodeArcMarketLog(log, t0, base) : decodeMirrorMarketLog(log, t0, base);
  }

  if (c.crafted && addr === lc(c.crafted)
      && (t0 === TOPICS.Crafted || t0 === TOPICS.CraftedOld)) {
    /* Crafted 事件：3 个 indexed + data 3 或 4 槽。解析失败不抛，缺 burned 就 null。
       扫描目前只拉 Transfer（持仓靠那个），这条是给测试和以后补 burned 用的。 */
    if (log.topics.length < 4) return null;
    const d = parseCraftedEvent(log);
    return Object.assign(base, {
      kind: 'Crafted',
      token: addr,
      tokenId: d.tokenId,
      originHash: d.originHash,
      cardHash: d.cardHash,
      opsHash: d.opsHash,
      rarity: d.rarity,
      cost: d.cost,
      burned: d.burned
    });
  }

  if (addr === lc(c.universe) || (c.crafted && addr === lc(c.crafted))) {
    /* **必须正好 4 个 topic。** ERC-20 的 Transfer 用的是同一个 topic0，
       但它只索引 from/to（3 个 topic），金额在 data 里。我们只对 NFT 合约地址发查询，
       本来撞不上；这道检查是为了「有人把 BANG 代币地址误配成 ARCBANG_CRAFTED」那天 ——
       那时候错的是配置，而索引应该安静地一条都不认，
       而不是把一笔转账金额当成 tokenId 存进持仓表。 */
    if (t0 !== TOPICS.Transfer || log.topics.length !== 4) return null;
    return Object.assign(base, {
      kind: 'Transfer',
      token: addr,
      from: wAddr(word(log.topics[1], 0)),
      to: wAddr(word(log.topics[2], 0)),
      tokenId: hexToBig(log.topics[3]).toString()
    });
  }
  return null;
}

function ownerLink(state, owner, key) {
  let s = state.byOwner.get(owner);
  if (!s) { s = new Set(); state.byOwner.set(owner, s); }
  s.add(key);
}
function ownerUnlink(state, owner, key) {
  const s = state.byOwner.get(owner);
  if (!s) return;
  s.delete(key);
  if (!s.size) state.byOwner.delete(owner);
}
/** 从落盘的四个字段重建两张派生表。进程启动读盘走的就是这条路 */
function rebuildDerived(state) {
  state.byOwner = new Map();
  for (const k in state.owners) ownerLink(state, state.owners[k], k);
  state.activeSet = new Set();
  for (const id in state.listings) if (state.listings[id].active) state.activeSet.add(id);
}

/**
 * 把一条已解码的事件作用到状态上。**幂等**：
 * 每张挂单记着最后一次生效的事件位置 seq=(blockNumber, logIndex)，
 * 位置不比它新的事件一律跳过。
 *
 * 为什么非要这个 seq 不可：重组容错要求最近 15 块每轮重扫，于是
 * 「Listed 之后紧跟着 Cancelled」这一对会被反复重放。没有 seq 的话，
 * Sold 每重放一次就往 sales 里多记一笔成交，「最近成交价」变成同一笔交易刷屏；
 * Listed 重放会把已经撤掉的单重新点亮成 active。两个 bug 都只在重扫窗口内发生 ——
 * 正是最难复现的那一类。
 *
 * @returns {string|null} 被改动的挂单 id（Transfer 返回 null）
 */
function applyOne(state, ev) {
  if (!ev) return null;

  if (ev.kind === 'Transfer') {
    /* 持仓是**最后写的赢**：扫描永远按 (blockNumber, logIndex) 升序、
       且每轮都一路扫到 latest，所以重放一段旧区间之后，那之后的转移
       同样会被重放并落在后面 —— 最终持有者不会退回旧值。
       铸造是 from=0；销毁是 to=0，销毁就把这一条删掉，
       不留一个「零地址持有」（否则 /owned?addr=0x000… 会返回全站烧掉的 NFT）。 */
    if (ev.tokenId == null || !ev.to) return null;
    const key = tokenKey(ev.token, ev.tokenId);
    const prev = state.owners[key];
    if (ev.to === ZERO_ADDR) {
      if (prev !== undefined) { delete state.owners[key]; ownerUnlink(state, prev, key); }
      return null;
    }
    if (prev === ev.to) return null;
    if (prev !== undefined) ownerUnlink(state, prev, key);
    state.owners[key] = ev.to;
    ownerLink(state, ev.to, key);
    return null;
  }

  const id = ev.listingId;
  if (id == null) return null;
  let l = state.listings[id];

  if (ev.kind === 'Listed') {
    if (l && !(ev.seq > l.seq)) return null;                 // 重放，或乱序的旧事件
    state.listings[id] = {
      seller: ev.seller,
      token: ev.token,
      id: ev.id,
      price: ev.price,
      inBang: !!ev.inBang,
      is1155: !!ev.is1155,
      active: true,
      listedAt: null,        // 区块时间戳，抓得到才填（见 fillTimestamps）
      blockNo: ev.blockNo,
      seq: ev.seq
    };
    state.activeSet.add(id);
    return id;
  }

  if (ev.kind === 'PriceChanged') {
    /* Arc 专有（ArcMarket.updatePrice）。**没见过那张单就不建残桩**：
       Cancelled / Sold 建残桩是为了挡住重扫窗口里的重复记账（见下面那段），
       改价没有这个副作用，而凭一条 PriceChanged 造出来的挂单不知道 token/id，
       也不知道它还 active 不 active —— 那会是一条点不开的幽灵挂单。
       真正的挂单会在下一次冷启动、从部署高度重扫时带着正确的价格回来。 */
    if (!l) return null;
    if (!(ev.seq > l.seq)) return null;                      // 重放，或乱序的旧事件
    if (l.price === ev.price) { l.seq = ev.seq; return null; }
    l.price = ev.price;
    l.seq = ev.seq;
    return id;
  }

  if (ev.kind === 'Cancelled' || ev.kind === 'Sold') {
    if (!l) {
      /* Listed 发生在索引起点之前（ARCBANG_INDEX_FROM 配得晚，或默认只回看五万块）。
         这不是错：那张单我们本来就没见过。但**残桩必须建**，
         否则下一轮重扫时这条 Sold 会被再记一笔成交。 */
      l = state.listings[id] = {
        seller: ev.seller || null,
        token: null, id: null, price: null, inBang: null, is1155: false,
        active: false, listedAt: null, blockNo: ev.blockNo, seq: -1, partial: true
      };
    }
    if (!(ev.seq > l.seq)) return null;                      // 重放
    l.active = false;
    state.activeSet.delete(id);
    l.seq = ev.seq;
    l.endedAt = ev.blockNo;
    l.endedBy = ev.kind;
    if (ev.kind === 'Sold') {
      state.sales.push({
        listingId: id,
        price: ev.price,
        inBang: !!ev.inBang,
        buyer: ev.buyer,
        seller: ev.seller,
        token: l.token,
        tokenId: l.id,
        blockNo: ev.blockNo,
        at: null                                             // 区块时间戳，同 listedAt
      });
      if (state.sales.length > CFG.maxSales) {
        state.sales.splice(0, state.sales.length - CFG.maxSales);
      }
    }
    return id;
  }
  return null;
}

/**
 * 把一批 raw log 作用到状态上。
 * **先按 (blockNumber, logIndex) 全序排一遍**：分片是分开请求回来的，
 * Promise 的完成顺序、节点返回的顺序都不保证，乱序应用会把
 * 「先 Listed 后 Cancelled」变成「先 Cancelled 后 Listed」。
 * @returns {{changed:number, touched:Set<string>, decoded:number}}
 */
function applyLogs(state, rawLogs, cfg) {
  const c = cfg || CFG;
  const evs = [];
  for (const log of rawLogs || []) {
    const ev = decodeLog(log, c);
    if (ev) evs.push(ev);
  }
  evs.sort((a, b) => (a.blockNo - b.blockNo) || (a.logIndex - b.logIndex));
  const touched = new Set();
  let changed = 0;
  for (const ev of evs) {
    const before = ev.kind === 'Transfer' ? JSON.stringify(state.owners[tokenKey(ev.token, ev.tokenId)]) : null;
    const id = applyOne(state, ev);
    if (id != null) { touched.add(id); changed++; }
    else if (ev.kind === 'Transfer'
      && before !== JSON.stringify(state.owners[tokenKey(ev.token, ev.tokenId)])) changed++;
  }
  return { changed, touched, decoded: evs.length };
}

/**
 * 分片。**闭区间 [from, to]，每片不超过 span 块。**
 * 公共 RPC 的跨度上限算的是 toBlock-fromBlock+1，所以 5000 块的片
 * 必须是 [0,4999] 而不是 [0,5000] —— 差这一块，就是整轮报错和整轮成功的区别。
 */
function chunkRanges(from, to, span) {
  const out = [];
  const s = Math.max(1, Number(span) || 1);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return out;
  for (let a = from; a <= to; a += s) out.push([a, Math.min(a + s - 1, to)]);
  return out;
}

/* ============================================================ RPC

   自己轮换节点：从上次成功的那个开始试，全挂了才抛。
   之所以不是每次从头试：一个挂掉的节点排在第一位时，每一轮都要先白等一次超时，
   15 秒一轮的定时器很快就会开始重叠。

   ----------------------------------------------------------------------------
   **ARCBANG_RPC / ARCBANG_LOG_RPC 里必须至少有一个节点肯答 eth_getLogs**
   主网请把付费节点写进 ARCBANG_LOG_RPC，索引层优先用它。
   ----------------------------------------------------------------------------
   2026-08-21 实测（BSC 测试网，逐个节点探）：

     bsc-testnet-rpc.publicnode.com          跨度 5000 / 5001 / 50001 全部 OK
     data-seed-prebsc-1-s1.bnbchain.org:8545 **跨度 10 都报 "limit exceeded"**
     data-seed-prebsc-2-s1.bnbchain.org:8545 同上

   也就是说 data-seed 那两条**根本不提供日志查询**，不是「跨度超了」——
   它们对任何 eth_getLogs 都回同一句 limit exceeded。web/config.js 里
   把它们列为 RPC 备份是对的（eth_call 它们答得好好的），但索引这一侧
   一旦 publicnode 挂掉就等于全挂：那时候索引停在原地并报 stale，
   市场页走前端的直读降级 —— 这是设计内的降级，不是 bug。
   换 RPC 供应商时**先用这几行的方式探一遍**，别假设「能 eth_call 就能 getLogs」。

   分片仍然按 5,000 块做，且必须做：publicnode 今天不限跨度不代表明天不限，
   而超限的表现是整轮报错、索引原地不动 —— 那是最不该靠运气的地方。 */

async function rpcOne(url, method, params, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    runtime.rpcCalls++;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  } finally { clearTimeout(t); }
}

async function rpcAny(method, params, timeoutMs) {
  /* getLogs 优先走 ARCBANG_LOG_RPC（付费节点专供日志）；其余方法走普通 RPC。 */
  const list = method === 'eth_getLogs' ? rpcsForLogs() : RPCS;
  if (!list.length) {
    const err = new Error('没有可问的 RPC 节点（ARCBANG_RPC / ARCBANG_LOG_RPC 都空）');
    err.rpcDown = true;
    throw err;
  }
  let lastErr = null;
  for (let k = 0; k < list.length; k++) {
    const i = (runtime.rpcIdx + k) % list.length;
    try {
      const r = await rpcOne(list[i], method, params, timeoutMs || CFG.logTimeoutMs);
      runtime.rpcIdx = i;                       // 下一轮从这个能用的节点开始
      return r;
    } catch (e) { lastErr = e; }
  }
  const err = new Error('所有 RPC 节点都打不通：' + (lastErr && lastErr.message));
  err.rpcDown = true;
  throw err;
}

function getLogs(address, topic0s, from, to) {
  return rpcAny('eth_getLogs', [{
    address,
    topics: [topic0s],
    fromBlock: '0x' + from.toString(16),
    toBlock: '0x' + to.toString(16)
  }]);
}

/* ============================================================ 扫描一轮 */

/** 抓这些区块的时间戳，**有预算**（一轮最多 tsPerRound 次 eth_getBlockByNumber）。
    时间戳是链上事实，抓不到就留 null —— 绝不用「块高差 × 3 秒」倒推一个假时间填进去，
    那个数会一路显示成「上架于 3 分钟前」，看起来和真的一模一样。
    排序用的是 blockNo，永远精确，所以 listedAt 缺失只影响文案不影响顺序。 */
async function fillTimestamps(blockNos, cap) {
  const want = Array.from(new Set(blockNos)).slice(0, cap);
  const out = new Map();
  for (const b of want) {
    try {
      const blk = await rpcAny('eth_getBlockByNumber', ['0x' + b.toString(16), false], 8000);
      if (blk && blk.timestamp) out.set(b, hexToNum(blk.timestamp));
    } catch (e) { /* 时间戳是装饰，抓不到就算了 */ }
  }
  return out;
}

/**
 * 跑一轮扫描。**不抛错**：出问题就记在 runtime.lastErr 上，索引保持上一轮的样子。
 * @returns {Promise<{ok:boolean, from?:number, to?:number, logs?:number, error?:string}>}
 */
async function scanOnce() {
  if (!enabled()) return { ok: false, error: '索引未启用（ARCBANG_MARKET / ARCBANG_CONTRACT 没配全）' };
  if (runtime.running) return { ok: false, error: '上一轮还在跑' };
  runtime.running = true;
  try {
    const latest = hexToNum(await rpcAny('eth_blockNumber', [], 8000));
    if (!latest) throw new Error('eth_blockNumber 返回不了高度');
    runtime.latest = latest;

    let from = st.lastScanned + 1;
    if (!st.lastScanned) from = CFG.from > 0 ? CFG.from : Math.max(1, latest - CFG.lookback);

    /* **扫到 latest，不是扫到 latest-15。** 只扫已确认段的话，
       刚挂上的单要等 45 秒才出现在市场页 —— 用户会以为挂单失败、又挂一次。
       未确认段照扫、照展示，但 lastScanned 只推进到已确认线，
       所以下一轮它会被重扫；状态机幂等，重扫不产生副作用。 */
    const to = latest;
    if (to < from) {                       // 没有新块
      runtime.lastOkAt = Date.now();
      runtime.lastErr = null;
      return { ok: true, from, to, logs: 0, changed: 0 };
    }

    const ranges = chunkRanges(from, to, CFG.chunk);
    const nft = ADDR_RE.test(CFG.crafted) ? [CFG.universe, CFG.crafted] : CFG.universe;

    let changed = 0, seen = 0;
    const touched = new Set();
    const evBlocks = [];
    for (const [a, b] of ranges) {
      /* 分两次问，不是把三个地址塞进一次查询：市场的三种事件和 NFT 的 Transfer
         topic 完全不同，混在一起要么多拉一堆用不上的日志，
         要么写出一个某些公共节点直接拒答的查询。
         稳态下一轮只有一个分片，也就是 2 次 eth_getLogs，代价可以忽略。 */
      const [mLogs, nLogs] = await Promise.all([
        getLogs(CFG.market, marketTopics(), a, b),
        getLogs(nft, [TOPICS.Transfer], a, b)
      ]);
      const all = [].concat(mLogs || [], nLogs || []);
      seen += all.length;
      const r = applyLogs(st, all, CFG);
      changed += r.changed;
      for (const id of r.touched) touched.add(id);
      for (const lg of mLogs || []) evBlocks.push(hexToNum(lg.blockNumber));
    }

    /* 时间戳只补**这一轮真的动过的那些挂单**，不是遍历全表 ——
       一百万条挂单时，每 15 秒遍历一次全表本身就是个性能 bug。 */
    if (touched.size && evBlocks.length) {
      const ts = await fillTimestamps(evBlocks, CFG.tsPerRound);
      if (ts.size) {
        for (const id of touched) {
          const l = st.listings[id];
          if (l && l.listedAt == null && ts.has(l.blockNo)) l.listedAt = ts.get(l.blockNo);
        }
        for (const s of st.sales) if (s.at == null && ts.has(s.blockNo)) s.at = ts.get(s.blockNo);
      }
    }

    // 已确认线：只有它之前的块才算「扫完了不用再看」
    const confirmed = Math.max(0, latest - CFG.confirmations);
    if (confirmed > st.lastScanned) { st.lastScanned = confirmed; runtime.tipDirty = true; }

    runtime.scans++;
    runtime.logsSeen += seen;
    runtime.lastOkAt = Date.now();
    runtime.lastErr = null;
    if (changed) runtime.dirty = true;
    flush(false);
    return { ok: true, from, to, logs: seen, changed };
  } catch (e) {
    /* **RPC 全挂不能把索引清掉。** 保持上一次的结果不动，
       由 statusOf() 把 stale 报出去，前端在列表顶上显示一行黄字。
       这里绝不 throw：调用方是一个 setInterval，抛出去就是未捕获的 Promise 异常，
       Node 会直接把整个进程带走 —— 那就成了「索引挂了拖垮整站」。 */
    runtime.lastErr = e.message;
    return { ok: false, error: e.message };
  } finally {
    runtime.running = false;
  }
}

/* ============================================================ 元数据惰性缓存

   索引里只有链上事件给的东西（谁挂的、什么价、哪枚 token）。
   稀有度 / 结局 / cardHash / 名字要读合约的 view，这一层就是那些读的缓存。

   两种有效期，理由不同：
     · **造物的 Card 永久有效** —— MirrorCrafted 里没有任何一个函数能写 cardOf，
       铸完就钉死了（源码 51 行的 mapping 只在 mintCrafted 里赋一次值）。
       所以哪怕整条记录到期重读，Card 那几个字段也是直接留用、**不再打那次 eth_call**。
     · **原生的 cardOf / outcome 只缓 60 秒** —— 干预会改写它们
       （MirrorUniverse.sol:579-581：u.outcome = newOutcome; cardOf[id] = newCardHash）。
       规格里「Card 铸后不可变」说的是造物那一侧；原生这边照实处理，
       缓一分钟，够挡住翻页时的重复读，也不会让一次干预半天看不见。
     · 名字两边都是 60 秒（可以改名，改名还翻倍收费）。 */

let meta = Object.create(null);
let metaDirty = false;
let metaLastFlush = 0;
const metaInflight = new Map();   // tokenKey → 正在打的 fetchMeta，同枚 token 不并发 eth_call

function loadMeta() {
  try {
    const j = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    if (j && typeof j === 'object') meta = Object.assign(Object.create(null), j);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[marketindex] 元数据缓存读不了，重建：' + e.message);
    meta = Object.create(null);
  }
  rebuildHashIdx();
}

/* ============================================================ 铸造反查（分享落地页 / sitemap）

   落地页要答「这个区块哈希铸了没有 → 几号、谁持有」，sitemap 要列出全部已铸的高度。
   两条都**只读内存，不打 RPC**：落地页是爬虫打的，一次 eth_call 的延迟和额度不该花在那里。
   原生记录带 blockHash（universeOf 槽 0），hashIdx 就是它的倒排：blockHash → tokenId。
   跟 meta 四处同步：读盘、补元数据、淘汰、测试注入。造物没有 blockHash，不进这张表。 */
let hashIdx = new Map();
function hashIdxPut(k, rec) {
  if (!rec || !rec.blockHash) return;
  const at = k.indexOf(':');
  if (at < 0 || k.slice(0, at) !== CFG.universe) return;
  hashIdx.set(lc(rec.blockHash), k.slice(at + 1));
}
function rebuildHashIdx() {
  hashIdx = new Map();
  for (const k in meta) hashIdxPut(k, meta[k]);
}

/**
 * 这个区块哈希铸过没有。三态，**不猜**：
 *   {minted:true, tokenId, owner, blockNumber, mintedAt}  反查表里有
 *   {minted:false}   反查表里没有，且索引新鲜、原生持仓的元数据已经补齐（coverGap===0）
 *   {minted:null}    其余一切（索引没起来 / 旧了 / 还有持仓没补元数据）—— 答「不知道」
 * 落地页把 null 写成「Mint status unavailable」，绝不把「我还没查到」说成「没铸过」。
 */
function mintStatusOf(blockHash) {
  const h = lc(blockHash);
  const id = hashIdx.get(h);
  if (id != null) {
    const k = tokenKey(CFG.universe, id);
    const rec = meta[k] || {};
    return {
      minted: true, tokenId: id,
      owner: st.owners[k] || null,
      blockNumber: Number.isSafeInteger(rec.blockNumber) ? rec.blockNumber : null,
      mintedAt: Number.isSafeInteger(rec.mintedAt) && rec.mintedAt > 0 ? rec.mintedAt : null
    };
  }
  if (isStale() || runtime.coverGap !== 0) return { minted: null };
  return { minted: false };
}

/**
 * 反查表里已铸宇宙的高度，可按哈希筛（BTCBANG 拿它数「注册表认得的哈希」）。
 * 没有 blockNumber 的记录（旧格式缓存）跳过。
 * @param {function|null} pred (blockHash, rec) → 要不要；null = 全部
 * @returns {Array<{n:number, at:number|null, hash:string}>}
 */
function mintedWhere(pred) {
  const out = [];
  for (const [hash, id] of hashIdx) {
    const rec = meta[tokenKey(CFG.universe, id)];
    if (!rec || !Number.isSafeInteger(rec.blockNumber) || rec.blockNumber < 0) continue;
    if (pred && !pred(hash, rec)) continue;
    out.push({
      n: rec.blockNumber,
      at: Number.isSafeInteger(rec.mintedAt) && rec.mintedAt > 0 ? rec.mintedAt : null,
      hash,
      /* 点火基金应发名单（/api/btc/due）要知道是哪枚、谁铸的；老调用方只读 n / at / hash，多两个字段不碍事 */
      id: Number(id),
      minter: typeof rec.minter === 'string' ? rec.minter : null
    });
  }
  return out;
}
/** 反查表里全部已铸宇宙的高度（sitemap 用） */
function mintedHeights() {
  return mintedWhere(null).map((x) => ({ n: x.n, at: x.at }));
}

function flushMeta(force) {
  if (!metaDirty && !force) return false;
  const now = Date.now();
  if (!force && now - metaLastFlush < CFG.flushMs) return false;
  try {
    const keys = Object.keys(meta);
    if (keys.length > CFG.metaMax) {
      /* 超上限就按最后一次刷新时间淘汰旧的。缓存的意义是省 RPC，不是当数据库 ——
         淘汰掉的条目重读一次就又回来了。 */
      keys.sort((a, b) => (meta[b].at || 0) - (meta[a].at || 0));
      const keep = Object.create(null);
      for (let i = 0; i < CFG.metaMax; i++) keep[keys[i]] = meta[keys[i]];
      meta = keep;
      rebuildHashIdx();           // 淘汰掉的 token 不能还留在反查表里
      runtime.coverGap = null;    // 覆盖度要重新数
    }
    writeAtomic(META_FILE, JSON.stringify(meta));
    metaLastFlush = now;
    metaDirty = false;
    return true;
  } catch (e) {
    console.error('[marketindex] 元数据缓存落盘失败（不影响读取）：' + e.message);
    return false;
  }
}

function seriesOf(token) {
  const t = lc(token);
  if (t && t === CFG.universe) return 'native';
  if (t && CFG.crafted && t === CFG.crafted) return 'crafted';
  return 'other';
}

/** 这条缓存还能直接用吗 */
function metaFresh(rec) {
  if (!rec) return false;
  /* 造物 + 没配 BangNames2：这条记录里一个可变字段都没有 → 永久有效 */
  if (rec.perm && !CFG.names2) return true;
  return !!rec.at && (Date.now() - rec.at < CFG.metaTtlMs);
}

/**
 * 这条记录的**物理字段**要不要补一次。
 * 和 metaFresh 分开：那一条问的是「链上那几个可变字段旧了没有」，
 * 这一条问的是「维度和常数补上没有」—— 后者是 cardHash 的纯函数，
 * 本地就算得出来，**不需要再打一遍 eth_call**（见 ensureMeta 的 topUp 分支）。
 *   undefined  加这个功能之前落的盘，还没有 ph 字段 → 补（老缓存的迁移路径）
 *   null       真读不出来（造物没存档 / 复算对不上）或上一轮冷算预算用完 → 到点再试
 */
function physNeeds(rec) {
  if (!rec) return false;
  if (rec.ph === undefined) return true;
  return rec.ph === null && Date.now() >= (rec.phNext || 0);
}

/** 只带并发上限的 map，不引第三方库 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(new Array(n).fill(0).map(async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; }
    }
  }));
  return out;
}

/** 合约里的 string 返回值 → JS 字符串。任何一步不对就当没有名字 */
function decString(raw) {
  const body = String(raw || '').replace(/^0x/, '');
  if (body.length < 128) return null;
  let off, len;
  try { off = Number(BigInt('0x' + body.slice(0, 64))); } catch (e) { return null; }
  if (!Number.isSafeInteger(off) || off % 32 !== 0) return null;
  const lenAt = off * 2;
  if (body.length < lenAt + 64) return null;
  try { len = Number(BigInt('0x' + body.slice(lenAt, lenAt + 64))); } catch (e) { return null; }
  if (!Number.isSafeInteger(len) || len > 1024) return null;
  const at = lenAt + 64;
  if (body.length < at + len * 2) return null;
  const s = Buffer.from(body.slice(at, at + len * 2), 'hex').toString('utf8');
  /* 名字会被原样送进市场页。合约那边已经把字符集钉死了（ASCII 字母数字与连字符、1..32），
     这里独立复核一遍：ARCBANG_NAMES 指向哪个合约由配置决定，指错一个地址返回的
     就可能是任意字节。**验不过当没有名字，绝不「清洗后照印」** ——
     清洗等于印一个链上不存在的名字。 */
  return /^[A-Za-z0-9-]{1,32}$/.test(s) ? s : null;
}

const soft = { nullOnRevert: true };

/* ============================================================ 物理字段
   specs/market-physics-filter.md 第一节。用户要按**维度和卡面上印的那几个常数**
   筛选排序，而这些东西链上一个都没有 —— 它们是引擎从区块哈希推出来的。

   三条纪律：

   1. **服务端内部直调 card.js，不走 HTTP 自己打自己。**
      index.js 起来时会 setCardSource({ cardFor, storeGet, cardCached }) 把它
      带磁盘缓存的那条路注进来；没注（marketindex-test.js 单独 require 本文件）
      就退到下面的本地实现。反过来 require('./index.js') 是不行的 ——
      index.js 在模块顶上 require 本文件，那是个环。

   2. **只存筛选排序要用的那几项，绝不把整张 card 塞进索引文件。**
      一张 card 约 2 KB（21 个输入参数 + 22 个整数槽 + 模块表），
      而 meta 缓存的上限是 40,000 条 —— 整卡塞进去就是 80 MB 的 JSON
      每 10 秒 stringify 一遍再落盘。这里只留 12 个数（见 physOf）。
      params 那 21 个输入参数**一个都不存**：卡面上没印，用户看不到也筛不到。

   3. **偏离度在服务端算，算完只把结果发出去。**
      c/h/e/G 的 ratio 本身就是「相对我们宇宙的倍率」，基准恒为 1；
      α 的基准从 engine/params.js 的 default 取（**不写死数字**）。 */

let cardSrc = null;
/** index.js 在模块加载时调它，把带磁盘缓存的 cardFor/storeGet/cardCached 注进来；
 */
function setCardSource(s) {
  cardSrc = (s && typeof s === 'object') ? s : null;
  return !!cardSrc;
}
/** 来源：'btc' | 'bnb'。注册表查不到、没注入、查的时候炸了 → 一律 'bnb'（查不到默认 bnb） */
function originKind(blockHash, blockNumber) {
  if (!blockHash || !cardSrc || typeof cardSrc.originOf !== 'function') return 'bnb';
  try { return cardSrc.originOf(blockHash, blockNumber) ? 'btc' : 'bnb'; }
  catch (e) { return 'bnb'; }
}

/* 注入缺席时的本地退路。和 index.js 里那两份是同一套文件布局（同一个 STORE_DIR、
   同一个 card-<cardHash>.json 命名），只是没有 .cache 那层磁盘缓存。 */
let _buildCard = null;
const memoCard = new Map();          // 本地退路的内存缓存，上限 512 张
function localStoreGet(cardHash) {
  try {
    const h = lc(cardHash);
    if (!/^0x[0-9a-f]{64}$/.test(h)) return null;
    const f = path.join(STORE_DIR, 'card-' + h + '.json');
    const root = path.resolve(STORE_DIR);
    const resolved = path.resolve(f);
    if (resolved !== root && resolved.indexOf(root + path.sep) !== 0) return null;
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return null; }
}
function localCardFor(blockHash) {
  const k = lc(blockHash);
  if (memoCard.has(k)) return memoCard.get(k);
  if (!_buildCard) _buildCard = require('./card.js').buildCard;
  const built = _buildCard(k, null);
  if (memoCard.size >= 512) memoCard.delete(memoCard.keys().next().value);
  memoCard.set(k, built);
  return built;
}
const srcStoreGet = (h) => (cardSrc && cardSrc.storeGet ? cardSrc.storeGet(h) : localStoreGet(h));
const srcCardFor = (h) => (cardSrc && cardSrc.cardFor ? cardSrc.cardFor(h, null) : localCardFor(h));
/* 这个哈希的 card 是不是已经在磁盘缓存里躺着了。只用来决定「算它要不要占冷预算」，
   拿不准就当冷的 —— 宁可少算几个（下一轮补上），不可堵住事件循环。 */
const srcCardCached = (h) => (cardSrc && cardSrc.cardCached ? !!cardSrc.cardCached(h) : memoCard.has(lc(h)));

/** 六位有效数字。索引文件里存 17 位浮点纯属浪费 —— 筛选排序用不上那个精度 */
const sig6 = (x) => (typeof x === 'number' && isFinite(x)) ? Number(x.toPrecision(6)) : null;
const numOr = (x) => (typeof x === 'number' && isFinite(x)) ? x : null;

/* 分数维判定。**不能写 D !== Math.round(D)** —— D 是弦气体那套浮点算出来的，
   「本该是 3」的宇宙实际拿到的可能是 2.9999999999999996，直接比就成了分数维。
   容差取 1e-9，与 card.js 的 rarityOf 同一口径（那边定的是 S/A/B/C/D 档位，
   两处判定必须一致，否则会出现「稀有度说是整数维、筛选说是分数维」）。
   也不能拿 card.dimension.kind 当准：kind 在 D<1.5 时一律是 'line'，
   D=1.2 这种明明是分数维也会被叫成 line。 */
const DIM_EPS = 1e-9;
const isFracDim = (D) => Math.abs(D - Math.round(D)) > DIM_EPS;

/**
 * 从一张 card 里挑出要进索引的那 12 个数。
 * 存的就是**卡面上印的那几个**（用户看到什么就该能筛什么）：
 *   d/f            空间维数 D、是不是分数维
 *   c/h/e/G        四个基本常数的 SI 值（NFT 卡面上并列印出来的那四个）
 *   cr/hr/er/Gr    同上，相对我们宇宙的倍率 —— 偏离度就是拿它算的
 *   a/ag           α（精细结构常数）、α_G/α_G₀
 * 没存 alphaInv：它恒等于 1/α，查询时现算，存进去是白占体积。
 */
function physOf(card) {
  if (!card) return null;
  const dm = card.dimension;
  const D = dm ? numOr(dm.D) : null;
  const K = card.constants || {};
  const out = { d: D, f: D == null ? null : (isFracDim(D) ? 1 : 0) };
  for (const k of ['c', 'h', 'e', 'G']) {
    const one = K[k];
    if (!one || typeof one !== 'object') continue;
    const si = sig6(one.si), ra = sig6(one.ratio);
    if (si == null) continue;
    out[k] = si;
    if (ra != null) out[k + 'r'] = ra;
  }
  const a = sig6(K.alpha);
  if (a != null) out.a = a;
  const ag = sig6(K.alphaGRel);
  if (ag != null) out.ag = ag;
  // 一个数都没捞着就当读不出来，别塞一条 {d:null,f:null} 的空壳进索引
  return (out.d == null && out.c == null && out.a == null) ? null : out;
}

/* 一轮 ensureMeta 的冷算预算。buildCard 是同步的，所以同一次 ensureMeta 内部
   不会交错；两次 ensureMeta 撞上时共用这个计数只会更保守，无害。 */
let physBudget = 0;

/**
 * 一枚 token 的物理量从哪儿来。
 * @returns {object|null|undefined} 对象=算出来了；null=真的读不出来；undefined=预算用完，下一轮再说
 */
function resolvePhys(kind, rec) {
  const ch = rec && rec.cardHash;
  /* 1) 存档优先。**造物系列的参数只在这儿** —— 它是沙盒里推出来的，
        区块哈希复算不出来（specs/market-physics-filter.md 第一节末）。
        被干预救过的原生卡同理：cardOf 已经改写，按 blockHash 算出来的是老宇宙。 */
  if (ch) {
    const archived = srcStoreGet(ch);
    if (archived) return physOf(archived);
  }
  // 2) 没被动过的原生卡：card 是 blockHash 的纯函数，直接复算
  if (kind === 'native' && rec && rec.blockHash) {
    if (!srcCardCached(rec.blockHash)) {
      if (physBudget <= 0) return undefined;
      physBudget--;
    }
    let built = null;
    try { built = srcCardFor(rec.blockHash); } catch (e) { return null; }
    if (!built || !built.card) return null;
    /* **复算不出同一个 cardHash 就当读不出来。** 这枚 NFT 要么是干预过而存档丢了，
       要么是旧推导版本铸的 —— 两种情况下按 blockHash 算出来的物理量都不是它的。
       报一个错的维度比报「未知」坏得多：它会被 dim=3 的筛选实实在在地捞出来。 */
    if (ch && lc(built.cardHash) !== lc(ch)) return null;
    return physOf(built.card);
  }
  return null;   // 造物没存档 / 不认识的系列 → 未知
}

/** 把物理量填进一条新读出来的 meta 记录。cardHash 没变就直接留用上一条的 */
function fillPhys(kind, rec, prev, now) {
  if (prev && rec.cardHash && prev.cardHash && lc(prev.cardHash) === lc(rec.cardHash)) {
    /* 物理量是 cardHash 的纯函数：cardHash 一样，这几个数按定义不可能变，
       长缓即可（规格第一节「缓存口径」）。原生被拯救后 cardOf 变了，
       这个条件自然不成立，会重取。 */
    if (prev.ph) { rec.ph = prev.ph; return rec; }
    if (prev.ph === null && now < (prev.phNext || 0)) {
      rec.ph = null; rec.phNext = prev.phNext; return rec;
    }
  }
  const r = resolvePhys(kind, rec);
  if (r === undefined) { rec.ph = null; rec.phNext = now; }            // 预算用完，下一轮马上再试
  else if (r === null) { rec.ph = null; rec.phNext = now + CFG.physRetryMs; }
  else rec.ph = r;
  return rec;
}

/* ---- 基准值与偏离度 ----------------------------------------------------
   规格第四节：**前端不许自己算偏离度**。半径表与基准值是整套推导里唯一藏得住的
   东西，把基准发下去就等于把「离我们多远」这件事白送了。所以这里只发结果。 */

let ALPHA0 = undefined;
/** α 的基准值：engine/params.js 里 alpha 的 default（1/137.035999084）。**不写死数字** */
function alpha0() {
  if (ALPHA0 === undefined) {
    ALPHA0 = null;
    try {
      const P = require(path.join(__dirname, '..', 'engine', 'params.js'));
      const d = P && P.byKey && P.byKey.alpha;
      if (d && typeof d.default === 'number' && isFinite(d.default) && d.default > 0) ALPHA0 = d.default;
    } catch (e) { console.error('[marketindex] 取不到 α 基准值，偏离度里不计 α：' + e.message); }
  }
  return ALPHA0;
}

/**
 * 与我们这个宇宙的偏离度 = 各常数相对偏差的**最大值**。
 * c/h/e/G/α_G 那五个存的就是倍率（我们宇宙 = 1），偏差直接是 |ratio − 1|；
 * α 存的是绝对值，除以 params.js 的 default 再比。
 * alphaInv 不进这个式子：它是 1/α，同一个物理量，算进去等于把 α 记两遍，
 * 而且倒数会让偏差不对称（α 减半 → α 侧 0.5、α⁻¹ 侧 1.0）。
 */
function devOf(ph) {
  if (!ph) return null;
  let mx = null;
  const bump = (v) => { if (typeof v === 'number' && isFinite(v)) mx = Math.max(mx == null ? 0 : mx, Math.abs(v)); };
  for (const k of ['cr', 'hr', 'er', 'Gr', 'ag']) {
    if (typeof ph[k] === 'number' && isFinite(ph[k])) bump(ph[k] - 1);
  }
  const a0 = alpha0();
  if (a0 && typeof ph.a === 'number' && isFinite(ph.a)) bump(ph.a / a0 - 1);
  return mx;
}

/* 可筛选排序的常数键 = card.constants 里全部**数值**成员。
   frame 不在内（它是 'external' 这个字符串，不是数）。 */
const CONST_KEYS = ['c', 'h', 'e', 'G', 'alpha', 'alphaInv', 'alphaGRel'];
const CONST_ALIAS = {
  c: 'c', h: 'h', e: 'e', g: 'G',
  alpha: 'alpha', a: 'alpha',
  alphainv: 'alphaInv', ainv: 'alphaInv', alpha_inv: 'alphaInv',
  alphagrel: 'alphaGRel', alphag: 'alphaGRel', ag: 'alphaGRel'
};
const constKey = (s) => (s == null ? null : (CONST_ALIAS[String(s).trim().toLowerCase()] || null));

/**
 * 取一个常数的值。**筛选、排序、发给前端显示，三处必须都走这一个函数** ——
 * 否则会出现「界面上写着 137.1、按 137.1 筛却筛不到自己」：
 * alphaInv 是现算的（索引里只存 α），现算完不收到和存的值同样的六位有效数字，
 * 显示的那份和比较的那份就不是同一个数了。踩过一次，验收里当场红。
 */
function constVal(ph, key) {
  if (!ph) return null;
  switch (key) {
    case 'c': return numOr(ph.c);
    case 'h': return numOr(ph.h);
    case 'e': return numOr(ph.e);
    case 'G': return numOr(ph.G);
    case 'alpha': return numOr(ph.a);
    case 'alphaInv': return (typeof ph.a === 'number' && isFinite(ph.a) && ph.a !== 0) ? sig6(1 / ph.a) : null;
    case 'alphaGRel': return numOr(ph.ag);
    default: return null;
  }
}

/** 索引里的紧凑形态 → 发给前端的可读形态。偏离度已经算好，前端只管显示 */
function physOut(ph) {
  if (!ph) return null;
  const cs = {}, rs = {};
  for (const k of CONST_KEYS) cs[k] = constVal(ph, k);      // 与筛选排序同一个取值函数
  for (const k of ['c', 'h', 'e', 'G']) rs[k] = numOr(ph[k + 'r']);
  rs.alphaG = numOr(ph.ag);
  const d = devOf(ph);
  return {
    dim: numOr(ph.d),
    fractional: ph.f == null ? null : !!ph.f,
    constants: cs,
    ratios: rs,                                        // 相对我们宇宙的倍率（卡面上也印这个）
    deviation: d == null ? null : Number(d.toPrecision(4)),
    devBand: d == null ? null : (d <= CFG.devLow ? 'low' : (d > CFG.devHigh ? 'high' : 'mid'))
  };
}

/**
 * 读一枚 token 的元数据。**读不到不抛**。
 * @param {object|null} prev 上一条缓存。造物的 Card 部分可以直接留用，省掉那次 eth_call
 */
async function fetchMeta(token, tokenId, prev) {
  const kind = seriesOf(token);
  const arg = BigInt(tokenId).toString(16).padStart(64, '0');
  const now = Date.now();

  if (kind === 'crafted') {
    /* MirrorCrafted.cardOf(id) → 8 槽 Card（旧字节码 7 槽，burned 落 null）：
         0 originHash  1 opsHash  2 cardHash  3 outcome  4 rarity  5 originBlock  6 paid  7 burned
       字段序照 contracts/src/MirrorCrafted.sol:41-50，只许往末尾追加。
       老缓存没 burned 键时必须重读一次，否则造物 Card 永久有效会把「未知」钉死。 */
    const keepCard = prev && prev.perm && prev.cardHash != null
      && Object.prototype.hasOwnProperty.call(prev, 'burned');
    const [cRaw, nRaw] = await Promise.all([
      keepCard ? Promise.resolve(null) : ethCall(token, SEL.cardOf + arg, soft),
      CFG.names2 ? ethCall(CFG.names2, SEL.nameOf + arg, soft) : Promise.resolve(null)
    ]);
    const card = keepCard ? {
      cardHash: prev.cardHash, outcome: prev.outcome, rarity: prev.rarity,
      originBlock: prev.originBlock, paid: prev.paid, burned: prev.burned
    } : parseCraftedCard(cRaw);
    const rec = Object.assign(card, { name: decString(nRaw), perm: true, at: now });
    /* 造物的参数只在存档里（cardHash 那张卡），读不到就是 null ——
       **不要当 0**：D=0 会被「D<3」那种筛选实实在在地捞出来。 */
    return fillPhys('crafted', rec, prev, now);
  }

  // 原生 MirrorUniverse
  const [uRaw, cRaw, bRaw, nRaw] = await Promise.all([
    ethCall(token, SEL.universeOf + arg, soft),
    ethCall(token, SEL.cardOf + arg, soft),
    ethCall(token, SEL.burnedOn + arg, soft),
    CFG.names ? ethCall(CFG.names, SEL.nameOf + arg, soft) : Promise.resolve(null)
  ]);
  const cardHash = wHash(word(cRaw, 0));
  const blockHash = wHash(word(uRaw, 0));
  const rec = {
    blockHash: isZeroHash(blockHash) ? null : blockHash,
    cardHash: isZeroHash(cardHash) ? null : cardHash,
    /* 槽 1/2：哈希来自哪个高度、什么时候铸的。分享落地页与 sitemap 要（mintStatusOf）。
       加这两个字段之前落盘的老记录没有它们 —— TTL 到期重读一次就补上，不用迁移。 */
    blockNumber: wNum(word(uRaw, 1)),
    mintedAt: wNum(word(uRaw, 2)),
    outcome: wNum(word(uRaw, 4)),
    verified: wBig(word(uRaw, 5)) === 1n,
    rarity: wNum(word(uRaw, 6)),
    burned: (wBig(word(bRaw, 0)) || 0n).toString(),
    name: decString(nRaw),
    perm: false,
    at: now
  };
  /* 来源 —— 这个哈希是比特币块还是 BNB 块（两站市场互见，卡片上要印「₿ #N」还是「BNB #N」）。
     enrich 时查注册表；查不到默认 bnb。输出时 metaInto 还会再查一次：注册表可能是之后才认得它的。 */
  rec.origin = originKind(rec.blockHash, rec.blockNumber);
  return fillPhys('native', rec, prev, now);
}

/**
 * 批量补齐一页的元数据。**一次补一页，不是一枚一个 RPC 往返** ——
 * 那正是 specs/market-scale.md 第三条病灶要消灭的东西。
 * @param {Array<{token:string,tokenId:string}>} pairs
 */
async function ensureMeta(pairs) {
  const need = [];
  const topUp = [];
  const seenKey = new Set();
  const now = Date.now();
  for (const p of pairs || []) {
    if (!p || !p.token || p.tokenId == null) continue;
    const k = tokenKey(p.token, p.tokenId);
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    const rec = meta[k];
    if (!metaFresh(rec)) { need.push(p); continue; }
    /* 链上那几个字段还新鲜，只是物理量没补上 —— 本地算就行，别为这个再打一轮 RPC */
    if (physNeeds(rec)) topUp.push({ rec, kind: seriesOf(p.token) });
  }
  /* 冷算预算按**每次调用**重置。buildCard 是同步的十几毫秒，一次补一页（24）时
     根本用不满；带筛选的冷请求会考察到 metaFilterBudget=600 个，那时这道闸就是
     「这一轮先算 48 个，剩下的下一轮」，而不是把事件循环堵上八秒。 */
  physBudget = CFG.physColdBudget;
  for (const t of topUp) { fillPhys(t.kind, t.rec, null, now); metaDirty = true; }
  if (!need.length) {
    if (topUp.length) flushMeta(false);
    return 0;
  }
  await mapLimit(need, CFG.metaConcurrency, async (p) => {
    const k = tokenKey(p.token, p.tokenId);
    const pending = metaInflight.get(k);
    if (pending) { await pending; return; }
    const job = (async () => {
      try {
        meta[k] = await fetchMeta(p.token, p.tokenId, meta[k]);
        hashIdxPut(k, meta[k]);
        metaDirty = true;
      } catch (e) {
        /* 读不到就读不到：卡片少几个字段，但那一页照样渲染。
           **不写一条空记录进缓存** —— 那等于把一次网络抖动缓存 60 秒。 */
      }
    })();
    metaInflight.set(k, job);
    try { await job; }
    finally { metaInflight.delete(k); }
  });
  flushMeta(false);
  return need.length;
}

function metaOf(token, tokenId) {
  return meta[tokenKey(token, tokenId)] || null;
}

/* ============================================================ 查询（三条 API 的实现）

   一律不抛：最坏情况是空集 + stale，前端据此走它的直读降级路径。 */

function isStale() {
  if (!enabled()) return true;
  if (!runtime.lastOkAt) return true;
  if (Date.now() - runtime.lastOkAt > CFG.staleAfterMs) return true;
  // 已确认线落后链头太多也算旧（比如刚重启、还在回补五万块）
  if (runtime.latest && runtime.latest - st.lastScanned > CFG.confirmations + 200) return true;
  return false;
}

/** 还挂着的 listingId。走 activeSet，不扫历史全表（理由见 emptyState 上面那段） */
function activeIds() {
  return Array.from(st.activeSet);
}

function statusOf() {
  const latest = runtime.latest || 0;
  return {
    configured: enabled(),
    lastScanned: st.lastScanned,
    latest,
    behind: latest ? Math.max(0, latest - st.lastScanned) : null,
    stale: isStale(),
    counts: {
      listings: Object.keys(st.listings).length,
      active: st.activeSet.size,
      owners: Object.keys(st.owners).length,
      sales: st.sales.length,
      meta: Object.keys(meta).length,
      /* 物理字段补到什么程度了。前端的维度筛选在 phys 还没铺开时会显得「结果很少」，
         这两个数是那句解释的依据（meta 上限 40,000 条，这个遍历是常数级的）。 */
      phys: Object.keys(meta).reduce((n, k) => n + (meta[k] && meta[k].ph ? 1 : 0), 0),
      // 铸造反查表的规模，以及原生持仓里还差几枚没补元数据（null = 还没数过）
      hashIdx: hashIdx.size,
      coverGap: runtime.coverGap
    },
    scans: runtime.scans,
    rpcCalls: runtime.rpcCalls,
    lastOkAt: runtime.lastOkAt || null,
    lastError: runtime.lastErr,
    chunk: CFG.chunk,
    confirmations: CFG.confirmations,
    intervalMs: CFG.intervalMs
  };
}

function metaInto(out, m) {
  /* burned：原生是 burnedOn；造物是 Card.burned（8 槽）。null = 未知（旧 7 槽 / 没读到）。
     没缓存也给这个键 —— 前端靠 null 跟「字段缺失」区分。 */
  out.burned = (m && m.burned != null) ? m.burned : null;
  if (!m) return out;
  if (m.cardHash != null) out.cardHash = m.cardHash;
  if (m.rarity != null) out.rarity = m.rarity;
  if (m.outcome != null) out.outcome = m.outcome;
  if (m.name != null) out.name = m.name;
  if (m.paid != null) out.paid = m.paid;
  if (m.blockHash != null) out.blockHash = m.blockHash;
  if (m.verified != null) out.verified = m.verified;
  /* 来源只给原生（有 blockHash 的）。缓存里写的是 enrich 当时的答案，这里再问一次注册表：
     它认得就是 btc，永远不把已认的 btc 降回 bnb。 */
  if (m.blockHash != null) {
    out.origin = (m.origin === 'btc' || originKind(m.blockHash, m.blockNumber) === 'btc') ? 'btc' : 'bnb';
  }
  /* 物理量：维度 + 卡面上印的那几个常数 + **服务端算好的**偏离度。
     ph 是 undefined 说明这条还没补过物理字段（老缓存），此时连 phys 这个键都不给，
     前端据此显示「还在补」，而不是把它当成「这个宇宙没有维度」。 */
  if (m.ph !== undefined) out.phys = physOut(m.ph);
  return out;
}

function itemOf(listingId) {
  const l = st.listings[listingId];
  if (!l || l.token == null) return null;
  return metaInto({
    listingId,
    token: l.token,
    tokenId: l.id,
    series: seriesOf(l.token),
    price: l.price,
    inBang: l.inBang,
    seller: l.seller,
    blockNo: l.blockNo,
    listedAt: l.listedAt
  }, metaOf(l.token, l.id));
}

/** 排序。price 用 BigInt 比 —— wei 早就越过 2^53 了，用 Number 比会在高价位上乱序 */
function sortCandidates(ids, sort) {
  const L = st.listings;
  if (sort === 'price_asc' || sort === 'price_desc') {
    const desc = sort === 'price_desc';
    /* **混币种排价格是没意义的**：BNB 单的 price 是 wei，BANG 单的 price 是
       18 位小数的代币最小单位，两者不可比。这里照原始数值排（不凭空编一个汇率出来），
       前端把价格排序和 cur 筛选配对使用即可。 */
    ids.sort((a, b) => {
      let pa, pb;
      try { pa = BigInt(L[a].price || 0); pb = BigInt(L[b].price || 0); }
      catch (e) { return 0; }
      if (pa === pb) return Number(a) - Number(b);
      const asc = pa < pb ? -1 : 1;
      return desc ? -asc : asc;
    });
    return ids;
  }
  if (sort === 'id') { ids.sort((a, b) => Number(a) - Number(b)); return ids; }
  // new（默认）：新挂的在前。同块内按 listingId 倒序 —— listingId 自增，天然就是链上顺序
  ids.sort((a, b) => (L[b].blockNo - L[a].blockNo) || (Number(b) - Number(a)));
  return ids;
}

function parseSet(s, lo, hi) {
  if (s == null || s === '') return null;
  const out = new Set();
  for (const part of String(s).split(',')) {
    const n = Number(String(part).trim());
    if (Number.isInteger(n) && n >= lo && n <= hi) out.add(n);
  }
  return out.size ? out : null;
}

/* ---- 物理筛选的入参解析（specs/market-physics-filter.md 第二节） ---- */

const NUMRE = '\\d+(?:\\.\\d+)?';
/**
 * dim 参数：`3`（精确）/ `3-5`（闭区间）/ `frac`（只要分数维）/ `int`（只要整数维）
 * / `>3`｜`gt3`（严格大于）/ `<3`｜`lt3` / `3-`（下界）/ `-3`（上界）。
 * 认不出来的一律返回 null（不筛），**绝不猜**：猜错的后果是用户以为自己筛了。
 */
function parseDim(s) {
  if (s == null || s === '' ) return null;
  const t = String(s).trim().toLowerCase();
  if (t === 'all' || t === 'any') return null;
  if (t === 'frac' || t === 'fractional') return { frac: true };
  if (t === 'int' || t === 'integer') return { frac: false };
  let m;
  if ((m = t.match(new RegExp('^(?:>|gt)\\s*(' + NUMRE + ')$')))) return { min: +m[1], exMin: true };
  if ((m = t.match(new RegExp('^(?:<|lt)\\s*(' + NUMRE + ')$')))) return { max: +m[1], exMax: true };
  if ((m = t.match(new RegExp('^(?:>=|gte)\\s*(' + NUMRE + ')$')))) return { min: +m[1] };
  if ((m = t.match(new RegExp('^(?:<=|lte)\\s*(' + NUMRE + ')$')))) return { max: +m[1] };
  if ((m = t.match(new RegExp('^(' + NUMRE + ')\\s*-\\s*(' + NUMRE + ')$')))) return { min: +m[1], max: +m[2] };
  if ((m = t.match(new RegExp('^(' + NUMRE + ')\\s*-$')))) return { min: +m[1] };
  if ((m = t.match(new RegExp('^-\\s*(' + NUMRE + ')$')))) return { max: +m[1] };
  if ((m = t.match(new RegExp('^(' + NUMRE + ')$')))) return { eq: +m[1] };
  return null;
}

/** 维度是不是过筛。**未知（ph 读不出来）一律不过** —— 当成 0 会被「D<3」误捞 */
function dimPass(ph, f) {
  if (!f) return true;
  if (!ph) return false;
  if (f.frac != null) return ph.f == null ? false : (!!ph.f === f.frac);
  const D = numOr(ph.d);
  if (D == null) return false;
  if (f.eq != null) return Math.abs(D - f.eq) < 1e-6;
  if (f.min != null && (f.exMin ? !(D > f.min) : !(D >= f.min - 1e-9))) return false;
  if (f.max != null && (f.exMax ? !(D < f.max) : !(D <= f.max + 1e-9))) return false;
  return true;
}

/** const=<键>&min=&max=。键认不出来就整个不筛（而不是筛出空集） */
function parseConst(q) {
  const key = constKey(q.const || q.constant);
  if (!key) return null;
  const min = Number(q.min), max = Number(q.max);
  return {
    key,
    min: (q.min != null && q.min !== '' && isFinite(min)) ? min : null,
    max: (q.max != null && q.max !== '' && isFinite(max)) ? max : null
  };
}
/** 常数区间是不是过筛。未知同样不过 —— 理由同 dimPass */
function constPass(ph, f) {
  if (!f) return true;
  const v = constVal(ph, f.key);
  if (v == null) return false;                 // 这个常数读不出来 → 未知，不是 0
  if (f.min != null && v < f.min) return false;
  if (f.max != null && v > f.max) return false;
  return true;
}

/** dev=low|high。偏离度**在这儿算**，前端只拿到结果（规格第四节） */
function devPass(ph, band) {
  if (!band) return true;
  const d = devOf(ph);
  if (d == null) return false;
  if (band === 'low') return d <= CFG.devLow;
  if (band === 'high') return d > CFG.devHigh;
  return true;
}

/* 排序名。physical 那四个要靠元数据，索引自己的字段里没有它们 */
const SORTS = ['new', 'price_asc', 'price_desc', 'id', 'dim_asc', 'dim_desc', 'const_asc', 'const_desc'];
const isPhysSort = (s) => s === 'dim_asc' || s === 'dim_desc' || s === 'const_asc' || s === 'const_desc';

/**
 * GET /api/market/listings 的实现。
 * @param {object} q sort/series/cur/rarity/outcome/named/page/size
 *                   + dim / const+min+max / by / dev（specs/market-physics-filter.md 第二节）
 */
async function listingsPage(q) {
  q = q || {};
  const size = Math.min(100, Math.max(1, Number(q.size) || 24));
  const page = Math.max(0, Number(q.page) || 0);
  let sort = SORTS.indexOf(q.sort) >= 0 ? q.sort : 'new';
  const series = ['all', 'native', 'crafted'].indexOf(q.series) >= 0 ? q.series : 'all';
  const cur = ['all', 'bnb', 'bang'].indexOf(q.cur) >= 0 ? q.cur : 'all';
  const rarity = parseSet(q.rarity, 0, 4);
  const outcome = parseSet(q.outcome, 0, 11);
  const named = (q.named === '1' || q.named === 1) ? 1
    : ((q.named === '0' || q.named === 0) ? 0 : null);

  // ---- 物理筛选（维度 / 常数区间 / 偏离度）
  const dimF = parseDim(q.dim);
  const constF = parseConst(q);
  const devF = (q.dev === 'low' || q.dev === 'high') ? q.dev : null;
  /* 按常数排序要知道排哪一个：by=<键>，没给就退回 const= 筛的那个键。
     两个都没给、或者键不认识，就没法排 —— 退回默认的 new，**绝不假装排过**
     （静默按 new 发回去而 sort 仍写着 const_asc，前端就会以为自己排序生效了）。 */
  let sortBy = null;
  if (sort === 'const_asc' || sort === 'const_desc') {
    sortBy = constKey(q.by) || (constF ? constF.key : null);
    if (!sortBy) sort = 'new';
  }

  const base = { total: 0, page, size, sort, series, cur, stale: isStale(), items: [] };
  if (dimF) base.dim = String(q.dim);
  if (constF) base.const = constF.key;
  if (devF) base.dev = devF;
  if ((sort === 'const_asc' || sort === 'const_desc') && sortBy) base.by = sortBy;
  try {
    const L = st.listings;
    // 第一层筛选：**只用索引自己有的字段**，纯内存过滤，一次 RPC 都不打
    const ids = activeIds().filter((id) => {
      const l = L[id];
      if (l.is1155) return false;                       // 市场页只认 ERC-721
      if (l.token == null) return false;                // 残桩（Listed 在索引起点之前）
      if (series !== 'all' && seriesOf(l.token) !== series) return false;
      if (cur === 'bnb' && l.inBang) return false;
      if (cur === 'bang' && !l.inBang) return false;
      return true;
    });
    /* 物理排序要等元数据到手才排得动，所以扫描阶段先用默认的「新挂在前」定序
       （确定性的遍历顺序），matched 攒齐之后再按物理量排。 */
    sortCandidates(ids, isPhysSort(sort) ? 'new' : sort);

    const needMeta = !!(rarity || outcome || named !== null || dimF || constF || devF || isPhysSort(sort));
    if (!needMeta) {
      base.total = ids.length;
      const slice = ids.slice(page * size, page * size + size);
      await ensureMeta(slice.map((id) => ({ token: L[id].token, tokenId: L[id].id })));
      base.items = slice.map(itemOf).filter(Boolean);
      return base;
    }

    /* 带元数据筛选时：稀有度 / 结局 / 名字**不在链上事件里**，只能靠元数据缓存。
       全量补齐一百万条是不可能的，所以按排好的顺序往下走，一次补一批（size 个），
       够一页就停，最多考察 metaFilterBudget 个候选。
       后台每轮还会顺手补 enrichPerRound 条，跑一阵之后缓存基本就满了，这个预算很少用满。
       用满时 partial: true 明说「统计的是考察过的那一段」——
       **绝不把一个假的 total 报出去**。 */
    const matched = [];
    let examined = 0;
    const wantUpTo = (page + 1) * size;
    for (let i = 0; i < ids.length && examined < CFG.metaFilterBudget; i += size) {
      const batch = ids.slice(i, i + size);
      examined += batch.length;
      await ensureMeta(batch.map((id) => ({ token: L[id].token, tokenId: L[id].id })));
      for (const id of batch) {
        const l = L[id];
        const m = metaOf(l.token, l.id);
        if (!m) continue;
        if (rarity && !rarity.has(m.rarity)) continue;
        if (outcome && !outcome.has(m.outcome)) continue;
        if (named === 1 && !m.name) continue;
        if (named === 0 && m.name) continue;
        /* 物理筛选。**读不出物理量的一律不过** —— 造物没存档、原生复算对不上，
           那就是「未知」，不是 D=0、也不是 c=0（规格第一节末）。 */
        if (dimF && !dimPass(m.ph, dimF)) continue;
        if (constF && !constPass(m.ph, constF)) continue;
        if (devF && !devPass(m.ph, devF)) continue;
        matched.push(id);
      }
      /* 物理排序时不能提前收工：排序要看**全部**考察过的候选，只攒够一页就停
         排出来的是「前 N 个里最小的」，不是「最小的」。所以让它把预算走满。 */
      if (!isPhysSort(sort) && matched.length >= wantUpTo + size) break;   // 够这一页还多一批
    }
    if (isPhysSort(sort)) {
      const desc = sort === 'dim_desc' || sort === 'const_desc';
      const valOf = (id) => {
        const l = L[id];
        const m = metaOf(l.token, l.id);
        const ph = m && m.ph;
        if (!ph) return null;
        return sort === 'dim_asc' || sort === 'dim_desc' ? numOr(ph.d) : constVal(ph, sortBy);
      };
      const cache = new Map();
      const V = (id) => { if (!cache.has(id)) cache.set(id, valOf(id)); return cache.get(id); };
      matched.sort((a, b) => {
        const va = V(a), vb = V(b);
        /* 未知**永远排最后**，升序降序都一样：把「读不出维度的」排在维度最小的前面
           是在说它比一维还低，那是假话。同值按 listingId 倒序（新的在前）保持稳定。 */
        if (va == null && vb == null) return Number(b) - Number(a);
        if (va == null) return 1;
        if (vb == null) return -1;
        if (va === vb) return Number(b) - Number(a);
        return desc ? (vb - va) : (va - vb);
      });
    }
    base.total = matched.length;
    base.partial = examined < ids.length;
    base.examined = examined;
    base.items = matched.slice(page * size, page * size + size).map(itemOf).filter(Boolean);
    return base;
  } catch (e) {
    /* 查询这一层同样不许抛：真出了 bug，市场页拿到的是「空 + stale」，
       前端走它的直读降级路径，而不是白屏。 */
    console.error('[marketindex] listingsPage 出错：' + (e && e.message));
    base.stale = true;
    base.error = '索引查询出错';
    return base;
  }
}

/**
 * GET /api/market/owned?addr=… 的实现。
 * **这一条替代前端「倒扫 totalSupply + 逐个 ownerOf」** ——
 * 那条路在十万枚时是十万次 RPC，浏览器直接死（specs/market-scale.md 第一条病灶）。
 */
async function ownedOf(addrRaw) {
  const addr = lc(addrRaw);
  const out = { addr, stale: isStale(), total: 0, native: [], crafted: [], other: [] };
  if (!ADDR_RE.test(addr)) { out.error = '地址格式不对'; return out; }
  try {
    const keys = st.byOwner.get(addr);
    if (!keys || !keys.size) return out;

    const pairs = [];
    for (const k of keys) {
      const at = k.lastIndexOf(':');
      pairs.push({ token: k.slice(0, at), tokenId: k.slice(at + 1) });
    }
    /* 补元数据也要有上限：一个地址持有一万枚时，一次请求补一万条元数据
       等于把「倒扫」的成本从浏览器搬到服务端，并没有解决问题。
       前 200 枚补齐（够首屏和几页翻页），其余先只给 tokenId ——
       前端要更多时按需再问，或者等后台把缓存喂满。 */
    pairs.sort((a, b) => {
      try { const d = BigInt(b.tokenId) - BigInt(a.tokenId); return d > 0n ? 1 : d < 0n ? -1 : 0; }
      catch (e) { return 0; }
    });
    await ensureMeta(pairs.slice(0, 200));

    for (const p of pairs) {
      const kind = seriesOf(p.token);
      const one = metaInto({ token: p.token, tokenId: p.tokenId, series: kind },
        metaOf(p.token, p.tokenId));
      (kind === 'native' ? out.native : kind === 'crafted' ? out.crafted : out.other).push(one);
    }
    out.total = pairs.length;
    return out;
  } catch (e) {
    console.error('[marketindex] ownedOf 出错：' + (e && e.message));
    out.stale = true;
    out.error = '索引查询出错';
    return out;
  }
}

/** 最近成交（「最近成交价」用）。倒序，最多 n 笔 */
function recentSales(n) {
  const k = Math.min(Math.max(1, Number(n) || 50), CFG.maxSales);
  return st.sales.slice(-k).reverse();
}

/* ============================================================ 后台补元数据

   每轮扫描之后顺手补几个还没缓存的活跃挂单。摊薄的是「第一个打开筛选的人」
   要等的那段时间：他不必替所有人把一百万条读一遍。 */
async function enrichSome() {
  try {
    const L = st.listings;
    const todo = [];
    for (const id of activeIds()) {
      const l = L[id];
      if (l.is1155 || l.token == null) continue;
      const rec = meta[tokenKey(l.token, l.id)];
      // 物理字段没补上的也算「要补」——ensureMeta 会走本地算那条路，不打 RPC
      if (metaFresh(rec) && !physNeeds(rec)) continue;
      todo.push({ token: l.token, tokenId: l.id });
      if (todo.length >= CFG.enrichPerRound) break;
    }
    if (todo.length) await ensureMeta(todo);
  } catch (e) { /* 补不到就下一轮再补 */ }
  await coverNative();
}

/**
 * 给没挂单的原生持仓补 blockHash/blockNumber（铸造反查表要）。每轮最多 coverPerRound 枚。
 * 顺手数出还差几枚（runtime.coverGap）：这一轮补的下一轮才从 gap 里扣，保守一点没坏处 ——
 * coverGap 是「敢不敢说没铸过」的依据，宁可多答一轮「不知道」。
 * 整张持仓表走一遍是 O(持仓数)：一百万枚约一两百毫秒、每 15 秒一次，到那个量级再改成游标。
 */
async function coverNative() {
  try {
    const uni = CFG.universe;
    if (!uni) return;
    const pre = uni + ':';
    let gap = 0;
    const todo = [];
    for (const k in st.owners) {
      if (k.slice(0, pre.length) !== pre) continue;
      const rec = meta[k];
      if (rec && rec.blockHash && Number.isSafeInteger(rec.blockNumber)) continue;
      gap++;
      if (todo.length < CFG.coverPerRound) todo.push({ token: uni, tokenId: k.slice(pre.length) });
    }
    runtime.coverGap = gap;
    if (todo.length) await ensureMeta(todo);
  } catch (e) { /* 同上：下一轮再补 */ }
}

/* ============================================================ 生命周期 */

/* 每轮索引（scan + enrich）之后要跑的钩子（index.js 注册：IndexNow 推送）。
   钩子各自 try/catch，抛错只进日志 —— 钩子是附属品，绝不能拖垮索引轮。 */
const roundHooks = [];
function onRound(fn) { if (typeof fn === 'function') roundHooks.push(fn); }
async function runRoundHooks() {
  for (const fn of roundHooks) {
    try { await fn(); } catch (e) { console.error('[marketindex] 轮后钩子出错（已吞）：' + (e && e.message)); }
  }
}

function startIndexer() {
  if (runtime.started) return false;
  if (!enabled()) {
    console.log('[marketindex] 未启用：ARCBANG_MARKET / ARCBANG_CONTRACT 没配全，'
      + '市场页会走它自己的直读降级路径');
    return false;
  }
  runtime.started = true;
  loadState();
  loadMeta();
  const tick = () => {
    /* **整轮包在这里面。** scanOnce 自己已经吞了错，这一层是双保险：
       定时器里逃出去的异常是未捕获的 Promise rejection，Node 会直接把进程带走 ——
       那就成了「索引挂了拖垮整站」，正是规格第五节禁止的事。
       ticking 盖住 scan + enrich：interval 配短时不让 enrichSome 跟下一轮 scan 重叠。 */
    if (runtime.ticking) return;
    runtime.ticking = true;
    scanOnce()
      .then((r) => {
        if (!r.ok && r.error && r.error !== '上一轮还在跑') {
          console.error('[marketindex] 这一轮没扫成（索引保持上次结果）：' + r.error);
        }
        return enrichSome();
      })
      .then(() => runRoundHooks())
      .catch((e) => console.error('[marketindex] 定时器异常（已吞）：' + (e && e.message)))
      .finally(() => { runtime.ticking = false; });
  };
  runtime.timer = setInterval(tick, CFG.intervalMs);
  if (runtime.timer.unref) runtime.timer.unref();   // 索引定时器不该拦着进程退出
  tick();
  console.log('[marketindex] 已启动  market=' + CFG.market
    + '  每 ' + Math.round(CFG.intervalMs / 1000) + ' 秒一轮，分片 ' + CFG.chunk + ' 块，'
    + '确认深度 ' + CFG.confirmations);
  return true;
}

function stopIndexer() {
  if (runtime.timer) clearInterval(runtime.timer);
  runtime.timer = null;
  runtime.started = false;
  flush(true);
  flushMeta(true);
}

/* 进程收尾时把内存里的索引写下去。**只是省一次重扫，不是必需** ——
   落盘文件丢了，最多是下次启动多扫五万块。 */
process.on('exit', () => {
  if (!runtime.started) return;
  try { flush(true); flushMeta(true); } catch (e) { /* 退出路径上不折腾 */ }
});

module.exports = {
  // 生命周期
  startIndexer, stopIndexer, scanOnce,
  // 三条 API 的实现
  listingsPage, ownedOf, statusOf, recentSales,
  // 状态机与分片（marketindex-test.js 拿假 log 直接测这些）
  applyLogs, applyOne, decodeLog, chunkRanges, emptyState, seqOf, tokenKey,
  parseCraftedCard, parseCraftedEvent,
  decString, rebuildDerived, metaFresh, physNeeds,
  TOPICS, EVENT_SIGS, SEL, FN_SIGS,
  /* Arc（无币版市场）那一套。marketTopics() 现读 env 决定这条链查哪些 topic。 */
  ARC_TOPICS, ARC_EVENT_SIGS, ARC_CHAIN_IDS, isArcChain, marketTopics,
  decodeMirrorMarketLog, decodeArcMarketLog,
  /* 物理字段（specs/market-physics-filter.md）。setCardSource 由 index.js 在
     模块加载时调用，把带磁盘缓存的 cardFor/storeGet/cardCached 注进来 ——
     **服务端内部直调 card.js，不走 HTTP 自己打自己**。 */
  setCardSource, CONST_KEYS,
  /* 铸造反查（分享落地页 / sitemap）。只读内存，不打 RPC；反查不到时三态诚实作答。 */
  mintStatusOf, mintedHeights, mintedWhere,
  onRound,
  // 测试注入
  _internals: {
    CFG,
    physOf, resolvePhys, devOf, physOut, constVal, constKey,
    parseDim, dimPass, parseConst, constPass, devPass, alpha0, isFracDim,
    getState: () => st,
    setState: (s) => { st = s; if (!s.byOwner || !s.activeSet) rebuildDerived(s); },
    getMeta: () => meta,
    setMeta: (m) => { meta = m; rebuildHashIdx(); },
    runtime, isStale, seriesOf, ensureMeta, fetchMeta, activeIds, coverNative,
    flush, flushMeta, loadState, loadMeta,
    INDEX_FILE, META_FILE, STORE_DIR
  }
};
