/*
 * 比特币主网区块 —— BTCBANG 的奇点来源（specs/btcbang-v1.md §一、§五）
 * ------------------------------------------------------------
 * 只做一件事：**这个高度 / 这个哈希在比特币主网上是不是一个块，块是什么时候出的**。
 * 哈希到手之后的一切（card、签名、出图、市场）走 BNBBANG 原有那套，一个字节不改：
 * seed = btcHash，不做任何二次变换，合约那头 bangSigned(blockHash = btcHash, blockNumber = 高度)。
 *
 * 三条纪律：
 *   1. C3 原样适用（specs/server-side.md）：上游查不到就拒绝，上游全挂就抛错让路由报 503，
 *      **绝不回退常量**。回退常量意味着一个编造的哈希也能铸成"比特币宇宙"。
 *   2. require 本文件不碰网络、不碰磁盘 —— selftest 直接 require index.js，不该因此联网。
 *      tip 是**惰性**刷新：请求来了才看它过没过期，不开定时器。
 *   3. 网络与时钟都可注入（createBtc({fetch, now, store})），自检不联网也能把逻辑测全。
 *
 * 为什么不直连节点而走 mempool.space / blockstream.info 的 REST：两家接口同形，
 * 免费、无 key、全球可达；本机跑一个比特币全节点只为查哈希不划算。
 * 两家轮换：一家挂了换另一家，都挂了才抛。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./atomic.js');
const { envInt } = require('./envint.js');

const HASH_RE = /^0x[0-9a-f]{64}$/;
const HEX64_RE = /^(0x)?[0-9a-fA-F]{64}$/;
const ZERO_HASH = /^0x0{64}$/;

/** 上游超时。每个上游各 8 秒，和 chain.js 的 RPC 同一口径 */
const TIMEOUT_MS = 8000;
/** tip 多久刷一次（惰性：请求来了才检查） */
const TIP_TTL_MS = 30000;
/** 「高度 > tip」时允许强刷 tip 的最小间隔：新块可能刚出，但不能让人拿未来高度把上游打爆 */
const TIP_FORCE_MIN_MS = 5000;
/* 刷新失败时，多久以内的旧 tip 还能用。tip 是真数据不是常量：十分钟一个块，
   一次上游抖动不该让磁盘里几十万个已确认的块全部报 503。超过一个出块间隔就不敢用了 —— 抛。 */
const TIP_GRACE_MS = 10 * 60 * 1000;
/** 未成熟块（高度 > tip − STORE_DEPTH）只放内存这么久 */
const MEM_TTL_MS = 60000;
/** height ≤ tip − 6 的条目才落盘永久缓存（规格 §五）；再浅的块可能被重组 */
const STORE_DEPTH = 6;
/** 内存条目上限；满了整体清空（同 index.js 的 NUM2HASH），不做 LRU */
const MEM_MAX = 20000;
/* 磁盘缓存按高度 × 32 字节定位。比特币到一千万高度还要一百六十多年；
   上限只为了防一个荒唐的高度把文件撑成几 GB 的稀疏文件。 */
const MAX_HEIGHT = 10000000;
/** 注册表落盘节流：写盘是 O(注册表大小)，一次浏览一个新块不该重写整张表 */
const SEEDS_FLUSH_MS = 2000;

const HASH_BYTES = 32;
const TIME_BYTES = 4;

/* ---------------------------------------------------------------- 名块（收藏层，不改物理）
   全部可从高度算出或有公开出处；徽章只叠在牌面上，稀有度 S/A/B/C/D 仍只看哈希。 */
const HALVING_INTERVAL = 210000;
const PERIOD_INTERVAL = 2016;
const FAMOUS = {
  1:      { label: '第一个被挖出的块', labelEn: 'First mined block' },
  170:    { label: '第一笔比特币转账（Satoshi → Hal Finney）', labelEn: 'First bitcoin transaction (Satoshi → Hal Finney)' },
  57043:  { label: '披萨块（一万枚比特币买两张披萨）', labelEn: 'Pizza block (10,000 BTC for two pizzas)' },
  74638:  { label: '溢出事故（凭空造出 1,844 亿枚）', labelEn: 'Value overflow incident' },
  481824: { label: 'SegWit 激活', labelEn: 'SegWit activation' },
  709632: { label: 'Taproot 激活', labelEn: 'Taproot activation' }
};
/** 创世 + 四个减半 + 六个名块：btc 站 /s/ 索引集合里的「精选」，与 seo.js 的内置 [0] 同一角色 */
const CURATED_HEIGHTS = [0, 1, 170, 57043, 74638, 210000, 420000, 481824, 630000, 709632, 840000];

function badgesOf(height) {
  const h = Number(height);
  const out = [];
  if (!Number.isSafeInteger(h) || h < 0) return out;
  if (h === 0) out.push({ key: 'genesis', label: '创世块', labelEn: 'Genesis block' });
  if (h > 0 && h % HALVING_INTERVAL === 0) {
    const n = h / HALVING_INTERVAL;
    out.push({ key: 'halving', n, label: '第 ' + n + ' 次减半', labelEn: 'Halving #' + n });
  }
  if (h % PERIOD_INTERVAL === 0) {
    out.push({ key: 'period', label: '难度周期首块', labelEn: 'Difficulty period start' });
  }
  if (FAMOUS[h]) out.push(Object.assign({ key: 'famous' }, FAMOUS[h]));
  return out;
}

/** 十六进制前导零数。只是信息，不是徽章（规格 §1.3 末） */
function zerosOf(hash) {
  const s = String(hash || '').replace(/^0x/i, '');
  const m = s.match(/^0*/);
  return m ? m[0].length : 0;
}

function normHash(h) {
  if (typeof h !== 'string' || !HEX64_RE.test(h)) return null;
  const x = (h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h).toLowerCase();
  return '0x' + x;
}

function splitList(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/* ---------------------------------------------------------------- 配置
   全部**每次调用现读 env**（同 sign.js 的 sigV2）：自检要在同一进程里设/清各跑一遍，
   而这几个字符串的解析成本可以忽略。每一项都有默认值，含义见 api.env.mainnet.example。 */

/** 上游 REST 根，逗号分隔，逐个轮换 */
function apiBases() {
  const list = splitList(process.env.BNBBANG_BTC_API || 'https://mempool.space/api,https://blockstream.info/api');
  return list.map((u) => u.replace(/\/+$/, ''));
}
/** 签名铸造要求的确认数。夹在 [1, 100]：0 会把刚出的、可能被重组的块签上链 */
function confirmationsRequired() {
  return envInt(process.env.BNBBANG_BTC_CONFIRMATIONS, 6, 1, 100);
}
/** 保留名单：默认创世块 + 四个减半块，到开闸时间才放签（规格 §2.4） */
function reservedSet() {
  const raw = process.env.BNBBANG_BTC_RESERVED;
  const list = raw == null ? ['0', '210000', '420000', '630000', '840000'] : splitList(raw);
  const set = new Set();
  for (const s of list) {
    const n = Number(s);
    if (Number.isSafeInteger(n) && n >= 0) set.add(n);
  }
  return set;
}
/** 开闸时间（unix 秒）。0 / 缺省 = 永不开闸 */
function openAt() {
  return envInt(process.env.BNBBANG_BTC_OPEN_AT, 0, 0, 4102444800);
}
/** 哪些 Host 是 btc 站 */
function hostsOf() {
  return splitList(process.env.BNBBANG_BTC_HOSTS || 'bang.satloot.com').map((h) => h.toLowerCase());
}
/** btc 站对外根：canonical / og / 分享图 URL 用。缺省 = https:// + 第一个 host */
function publicBase() {
  const b = process.env.BNBBANG_BTC_PUBLIC_BASE;
  if (b) return b.replace(/\/+$/, '');
  return 'https://' + (hostsOf()[0] || 'bang.satloot.com');
}
/** Host 头命中 btc 站吗。去端口、去大小写、去末尾的点；没有 Host 一律不是 */
function isBtcHost(host) {
  if (typeof host !== 'string' || !host) return false;
  const h = host.trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
  return hostsOf().indexOf(h) >= 0;
}
function isCurated(height) {
  return CURATED_HEIGHTS.indexOf(Number(height)) >= 0;
}

/**
 * 能不能签。三态之外还把「差几个确认」说清楚 —— 界面写「出生证还没盖章（差 n 个确认）」。
 * 保留块优先于确认数：那是更长期的一条理由。
 * @param {number} height
 * @param {number} tipHeight
 * @param {number} nowSec
 */
function mintability(height, tipHeight, nowSec) {
  const confirmations = tipHeight - height + 1;
  const need = confirmationsRequired();
  const reserved = reservedSet().has(height);
  const open = openAt();
  const isOpen = open > 0 && nowSec >= open;
  let mintable = true, reason = null, code = null;
  if (reserved && !isOpen) {
    mintable = false; code = 'RESERVED';
    reason = open > 0
      ? '保留块：创世块与减半块要到 ' + new Date(open * 1000).toISOString() + ' 才开闸，先到先得'
      : '保留块：创世块与减半块暂不开放铸造，开闸时间另行公示';
  } else if (confirmations < need) {
    const lack = need - confirmations;
    mintable = false; code = 'IMMATURE';
    reason = '出生证还没盖章（差 ' + lack + ' 个确认，约 ' + (lack * 10) + ' 分钟）';
  }
  return {
    mintable, reason, code, confirmations, confirmationsRequired: need,
    reserved, openAt: open > 0 ? open : null
  };
}

/* ---------------------------------------------------------------- 实例 */

/**
 * @param {object} [opts]
 * @param {function} [opts.fetch]  替代全局 fetch（自检注假的）
 * @param {function} [opts.now]    替代 Date.now
 * @param {string}   [opts.store]  替代 BNBBANG_STORE
 */
function createBtc(opts) {
  opts = opts || {};
  let fetchFn = opts.fetch || null;                 // null = 用全局 fetch（调用时再取，别在 require 时绑死）
  let nowFn = opts.now || Date.now;
  const storeOf = () => opts.store || process.env.BNBBANG_STORE || path.join(__dirname, '.store');
  const HASH_FILE = () => path.join(storeOf(), 'btc-hashes.bin');
  const TIME_FILE = () => path.join(storeOf(), 'btc-times.bin');
  const SEEDS_FILE = () => path.join(storeOf(), 'btc-seeds.json');
  const LEDGER_FILE = () => path.join(storeOf(), 'btc-ledger.json');

  /* ---- 上游 ---- */
  async function upstreamOne(base, pathname, kind) {
    const f = fetchFn || globalThis.fetch;
    if (typeof f !== 'function') throw new Error('没有 fetch（要 Node 18+）');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await f(base + pathname, {
        signal: ctl.signal,
        headers: { accept: kind === 'json' ? 'application/json' : 'text/plain' }
      });
      if (res.status === 404) return null;              // 明确答复：没有这个块 / 高度
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return kind === 'json' ? await res.json() : String(await res.text()).trim();
    } finally { clearTimeout(t); }
  }
  /* 逐个上游试，全挂才抛 upstreamDown。路由靠这个标志把两件事分开报：
     **上游全挂**（503，我们的锅）和**主网确实没有这个块**（404，用户给的数据不对）。 */
  async function upstream(pathname, kind) {
    const bases = apiBases();
    let lastErr = null;
    if (!bases.length) {
      const err = new Error('BNBBANG_BTC_API 是空的，没有可问的上游');
      err.upstreamDown = true;
      throw err;
    }
    for (const base of bases) {
      try { return await upstreamOne(base, pathname, kind); }
      catch (e) { lastErr = e; }
    }
    const err = new Error('比特币上游全部打不通：' + (lastErr && lastErr.message));
    err.upstreamDown = true;
    throw err;
  }
  /** 上游答了但答非所问（哈希不是 64 hex、高度对不上）：当上游故障，不当「没有」 */
  function badAnswer(msg) {
    const err = new Error('比特币上游答非所问：' + msg);
    err.upstreamDown = true;
    return err;
  }

  /* ---- 磁盘缓存：按高度定位的两个定长文件 ---- */
  function readSlot(file, idx, size) {
    let fd;
    try { fd = fs.openSync(file, 'r'); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    try {
      const buf = Buffer.alloc(size);
      const n = fs.readSync(fd, buf, 0, size, idx * size);
      return n === size ? buf : null;                // 文件还没长到这个高度 = 未知
    } finally { fs.closeSync(fd); }
  }
  function writeSlot(file, idx, buf) {
    fs.mkdirSync(storeOf(), { recursive: true });
    /* O_CREAT 而不是 'w+'：'w+' 会截断，两个请求同时首次写就会互相抹掉 */
    const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644);
    try { fs.writeSync(fd, buf, 0, buf.length, idx * buf.length); }
    finally { fs.closeSync(fd); }
  }
  function diskGet(height) {
    if (height > MAX_HEIGHT) return null;
    const hb = readSlot(HASH_FILE(), height, HASH_BYTES);
    if (!hb || hb.every((b) => b === 0)) return null;   // 零槽 = 未知
    const tb = readSlot(TIME_FILE(), height, TIME_BYTES);
    return { height, hash: '0x' + hb.toString('hex'), time: tb ? tb.readUInt32BE(0) : null };
  }
  function diskPut(rec) {
    if (rec.height > MAX_HEIGHT) return;
    try {
      writeSlot(HASH_FILE(), rec.height, Buffer.from(rec.hash.slice(2), 'hex'));
      const tb = Buffer.alloc(TIME_BYTES);
      tb.writeUInt32BE(Math.max(0, Math.min(0xffffffff, rec.time || 0)), 0);
      writeSlot(TIME_FILE(), rec.height, tb);
    } catch (e) {
      // 缓存写不进去不是错：下次再问上游就是了
      console.error('[btc] 缓存写不进去（不影响答复）：' + e.message);
    }
  }

  /* ---- 内存缓存 ---- */
  let mem = new Map();          // height → {height, hash, time, exp}
  function memGet(height) {
    const r = mem.get(height);
    if (!r) return null;
    if (r.exp <= nowFn()) { mem.delete(height); return null; }
    return { height: r.height, hash: r.hash, time: r.time };
  }
  function memPut(rec, exp) {
    if (mem.size >= MEM_MAX) mem = new Map();
    mem.set(rec.height, { height: rec.height, hash: rec.hash, time: rec.time, exp });
  }

  /* ---- 注册表：哈希 → {height, time}。只为快，不是真相来源（规格 §1.1） ---- */
  let seeds = null;             // Map<hash, {height, time}>；null = 还没读盘
  let seedsDirty = false;
  let seedsTimer = null;
  function ensureSeeds() {
    if (seeds) return seeds;
    seeds = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(SEEDS_FILE(), 'utf8'));
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        for (const k of Object.keys(j)) {
          const v = j[k];
          const h = normHash(k);
          if (h && v && Number.isSafeInteger(v.height) && v.height >= 0) {
            seeds.set(h, { height: v.height, time: Number.isSafeInteger(v.time) ? v.time : null });
          }
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[btc] 注册表读不了，从空表开始：' + e.message);
    }
    return seeds;
  }
  function flush() {
    if (!seeds || !seedsDirty) return false;
    if (seedsTimer) { clearTimeout(seedsTimer); seedsTimer = null; }
    try {
      fs.mkdirSync(storeOf(), { recursive: true });
      const obj = {};
      for (const [h, v] of seeds) obj[h] = v;
      writeAtomic(SEEDS_FILE(), JSON.stringify(obj));
      seedsDirty = false;
      return true;
    } catch (e) {
      console.error('[btc] 注册表写不进去（内存里还在）：' + e.message);
      return false;
    }
  }
  function register(hash, height, time) {
    const h = normHash(hash);
    if (!h || !Number.isSafeInteger(height) || height < 0) return false;
    const s = ensureSeeds();
    const prev = s.get(h);
    if (prev && prev.height === height && prev.time === time) return false;
    s.set(h, { height, time: Number.isSafeInteger(time) ? time : null });
    seedsDirty = true;
    /* 一次性、unref 的定时器：不让进程为它活着，也不把每次浏览都变成一次整表重写 */
    if (!seedsTimer) {
      seedsTimer = setTimeout(() => { seedsTimer = null; flush(); }, SEEDS_FLUSH_MS);
      if (seedsTimer.unref) seedsTimer.unref();
    }
    return true;
  }
  /**
   * 同步查：这个哈希是不是登记过的比特币块。
   * 带 height 时还查一条路：注册表没有，但 (height 的缓存哈希) === hash 也算 ——
   * 那是 universeOf 里的 (blockHash, blockNumber) 对得上比特币（规格 §五 /api/token）。
   * @returns {{height:number, time:number|null}|null}
   */
  function originOf(hash, height) {
    const h = normHash(hash);
    if (!h || ZERO_HASH.test(h)) return null;
    const hit = ensureSeeds().get(h);
    if (hit) return { height: hit.height, time: hit.time };
    if (Number.isSafeInteger(height) && height >= 0) {
      const c = cachedAt(height);
      if (c && c.hash === h) {
        register(h, height, c.time);                 // 顺手补进注册表，下次就是一次 Map 查找
        return { height, time: c.time };
      }
    }
    return null;
  }

  /* ---- tip ---- */
  let tipState = null;          // {height, at}
  let tipPending = null;
  /**
   * 当前高度。TTL 30 秒；force 时最快 5 秒刷一次。
   * 刷新失败：十分钟内的旧值照用（真数据，不是常量），再旧就抛 —— 路由报 503。
   */
  async function tipHeight(force) {
    const now = nowFn();
    if (tipState) {
      const age = now - tipState.at;
      if (!force && age < TIP_TTL_MS) return tipState.height;
      if (force && age < TIP_FORCE_MIN_MS) return tipState.height;
    }
    if (tipPending) return tipPending;
    tipPending = (async () => {
      try {
        const txt = await upstream('/blocks/tip/height', 'text');
        if (txt == null || !/^\d{1,9}$/.test(txt)) throw badAnswer('tip = ' + txt);
        const h = Number(txt);
        if (h > MAX_HEIGHT) throw badAnswer('tip 高得离谱：' + h);
        tipState = { height: h, at: nowFn() };
        return h;
      } catch (e) {
        if (tipState && nowFn() - tipState.at < TIP_GRACE_MS) {
          console.warn('[btc] tip 刷新失败，沿用 ' + Math.round((nowFn() - tipState.at) / 1000) + ' 秒前的 '
            + tipState.height + '：' + (e && e.message));
          return tipState.height;
        }
        throw e;
      } finally { tipPending = null; }
    })();
    return tipPending;
  }

  /* ---- 取块 ---- */
  /** 只看缓存（内存 → 磁盘），不碰网络。给 originOf 与「已缓存过的不扣额度」用 */
  function cachedAt(height) {
    const h = Number(height);
    if (!Number.isSafeInteger(h) || h < 0) return null;
    const m = memGet(h);
    if (m) return m;
    const d = diskGet(h);
    if (d) { memPut(d, Infinity); return d; }
    return null;
  }
  /** 记住一条刚从上游拿到的块：够深就落盘永久缓存，不够深只放内存 60 秒；注册表都登记 */
  function remember(rec, tipH) {
    const deep = rec.height <= tipH - STORE_DEPTH;
    memPut(rec, deep ? Infinity : nowFn() + MEM_TTL_MS);
    if (deep) diskPut(rec);
    register(rec.hash, rec.height, rec.time);
  }
  async function fetchAt(h, tipH) {
    const hashTxt = await upstream('/block-height/' + h, 'text');
    if (hashTxt == null) return null;                  // 明确答复：没有这个高度
    if (!/^[0-9a-fA-F]{64}$/.test(hashTxt)) throw badAnswer('block-height/' + h + ' = ' + hashTxt.slice(0, 40));
    const j = await upstream('/block/' + hashTxt.toLowerCase(), 'json');
    if (!j || typeof j !== 'object') throw badAnswer('block/' + hashTxt.slice(0, 12) + '… 读不到');
    if (String(j.id).toLowerCase() !== hashTxt.toLowerCase() || Number(j.height) !== h) {
      /* 两个端点各说各的（可能是轮换到另一家时正赶上重组）：当上游故障，让用户再试 */
      throw badAnswer('block/' + hashTxt.slice(0, 12) + '… 的 id/height 与 block-height/' + h + ' 对不上');
    }
    const rec = { height: h, hash: '0x' + hashTxt.toLowerCase(), time: Number(j.timestamp) || null };
    remember(rec, tipH);
    return rec;
  }
  /**
   * 按高度取块。
   * @returns {Promise<{height:number, hash:string, time:number|null}|null>}
   *   null = 主网还没有这个高度（或高度不合法）；抛错 = 上游全挂（err.upstreamDown）
   */
  async function blockAt(height) {
    const h = Number(height);
    if (!Number.isSafeInteger(h) || h < 0 || h > MAX_HEIGHT) return null;
    const hit = cachedAt(h);
    if (hit) return hit;
    let t = await tipHeight(false);
    /* 高度超过缓存里的 tip：新块可能刚出（十分钟一个），强刷一次再判，
       让「最新区块」有实时感；刷不了（5 秒内刷过）就按旧 tip 答「还没有」。 */
    if (h > t) { t = await tipHeight(true); if (h > t) return null; }
    return fetchAt(h, t);
  }
  /**
   * 按哈希取块。**签名前的最后一道核对**：注册表只是捷径，答案以上游为准。
   * @returns {Promise<{height:number, hash:string, time:number|null}|null>}
   *   null = 这不是比特币主网（主链）上的块；抛错 = 上游全挂
   */
  async function blockByHash(hashIn) {
    const hash = normHash(hashIn);
    if (!hash || ZERO_HASH.test(hash)) return null;
    const seed = ensureSeeds().get(hash);
    if (seed) {
      /* 捷径：注册表说它在这个高度 → 按高度取（多半命中缓存），哈希对得上就是它。
         对不上 = 那个高度现在是另一个块（被重组掉了），往下走上游按哈希核对。 */
      const b = await blockAt(seed.height);
      if (b && b.hash === hash) return b;
    }
    const j = await upstream('/block/' + hash.slice(2), 'json');
    if (!j) return null;                               // 明确答复：没有这个哈希
    if (String(j.id).toLowerCase() !== hash.slice(2)) throw badAnswer('block/<hash> 回了别的块');
    const h = Number(j.height);
    if (!Number.isSafeInteger(h) || h < 0 || h > MAX_HEIGHT) throw badAnswer('block/<hash> 的高度不合法：' + j.height);
    let t = await tipHeight(false);
    if (h > t) { t = await tipHeight(true); if (h > t) return null; }
    /* 主链核对：有的浏览器按哈希也能查到孤块。这个高度上的规范哈希必须就是它，
       否则它不是「比特币主网的块」—— 铸上链会是一个孤儿宇宙。 */
    const canon = await upstream('/block-height/' + h, 'text');
    if (canon == null || String(canon).toLowerCase() !== hash.slice(2)) return null;
    const rec = { height: h, hash, time: Number(j.timestamp) || null };
    remember(rec, t);
    return rec;
  }
  /** GET /api/btc/tip 的答案 */
  async function tip() {
    const h = await tipHeight(false);
    const b = await blockAt(h);
    if (!b) throw badAnswer('tip 高度 ' + h + ' 取不到块');
    return {
      height: h, hash: b.hash, time: b.time,
      confirmationsRequired: confirmationsRequired(),
      updatedAt: Math.floor(tipState.at / 1000)
    };
  }

  /* ---- 点火基金账本：人工维护的 JSON，没有就给空账本（规格 §2.3） ---- */
  function readLedger() {
    const empty = { budget: 21000000, granted: 0, entries: [] };
    let j;
    try { j = JSON.parse(fs.readFileSync(LEDGER_FILE(), 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') { empty.error = '账本文件读不了：' + e.message; }
      return empty;
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return Object.assign(empty, { error: '账本不是对象' });
    return {
      budget: Number.isFinite(Number(j.budget)) ? Number(j.budget) : empty.budget,
      granted: Number.isFinite(Number(j.granted)) ? Number(j.granted) : 0,
      entries: Array.isArray(j.entries) ? j.entries.slice(0, 1000) : []
    };
  }

  const inst = {
    tip, tipHeight, blockAt, blockByHash, cachedAt, originOf, register, flush, readLedger,
    badgesOf, zerosOf, mintability,
    isBtcHost, publicBase, hostsOf, apiBases, confirmationsRequired, reservedSet, openAt,
    isCurated, CURATED_HEIGHTS, FAMOUS, STORE_DEPTH,
    createBtc,
    /* 自检注入 */
    _setFetch: (f) => { fetchFn = f || null; },
    _setNow: (f) => { nowFn = f || Date.now; },
    /* 只清内存缓存与 tip；注册表单独一把（_resetSeeds），否则测试里没来得及落盘的登记会被清掉 */
    _reset: () => { mem = new Map(); tipState = null; tipPending = null; },
    _resetSeeds: () => { seeds = null; seedsDirty = false; if (seedsTimer) { clearTimeout(seedsTimer); seedsTimer = null; } },
    _seedCount: () => ensureSeeds().size,
    _tipState: () => tipState
  };
  /* 退出时把注册表写掉：它是「只为快」的表，丢了下次再问上游就是，但没必要白丢。 */
  process.on('exit', () => { try { flush(); } catch (e) { /* 退出路径上不折腾 */ } });
  return inst;
}

module.exports = createBtc();
