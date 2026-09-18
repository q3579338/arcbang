/*
 * 分享图（PNG）—— 把已有的 SVG 光栅化一份给社交平台抓
 * ------------------------------------------------------------
 * 为什么要 PNG：X 明确不认 SVG 当 og:image，微信也不认。链接发出去要有预览图，
 * 就必须有一份 PNG。**NFT 的图仍然是 SVG**（tokenURI 指的还是 .svg，逐字节可重建），
 * PNG 只是分享用的派生物 —— 它可再生、可删、不进 cardHash。
 *
 * ---- 选型：@resvg/resvg-js，不是 puppeteer ----
 * 任务书上说服务器上"已经有 @puppeteer 可以直接用"。**实测不成立**（2026-08-21 现场查）：
 *   /opt/bnbbang/server/node_modules/@puppeteer 是个空目录，
 *   puppeteer / puppeteer-core 两个包都不在，~/.cache/puppeteer 不存在（Chrome 没下过），
 *   系统里也没有 fontconfig（fc-list 都没装），只有 DejaVu 那几只字体。
 * 也就是说走 puppeteer 要现下 Chrome（约 400 MB）+ 一串 apt 依赖（libnss3/libatk/libgbm…），
 * 而且每张图都要过一次浏览器 —— art.js 顶上那段注释记着上一轮的教训：
 * 无头 Chrome 真跑一张 31 秒，就是因为这条路被否掉才有了现在的固定底图方案。
 *
 * @resvg/resvg-js 是 Rust 的静态 napi 二进制：装完 4.3 MB、两个包、2 秒，
 * 没有任何系统依赖，也不需要 fontconfig（它自己扫 /usr/share/fonts）。
 * 服务器实测 1200×1200 一张 145 ms、2.59 MB；缺字体时会退回系统里有的那只，
 * 拉回来肉眼比对过：标题、维度大字、四个常数、上标与 α 全部正常。
 *
 * ---- 三条硬约束 ----
 * 1. **绝不 500**：装不上依赖、渲染抛错、底图缺了，一律退到通用预览图。
 *    分享链路不能因为出图挂掉而整个断 —— 那会让"复制文案和图片"和 og 预览一起哑掉。
 * 2. **落盘缓存**：PNG 比 SVG 贵得多（150 ms + 2.6 MB），不能每次现渲。
 * 3. **并发闸**：同一个 key 同时来十个请求只渲染一次（inflight），
 *    另外全局最多同时渲 RENDER_MAX 张 —— 光栅化是纯 CPU，放开了会把整个进程堵死，
 *    而铸造/签名和它挤在同一个事件循环里。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writeAtomic } = require('./atomic.js');
const { envInt } = require('./envint.js');

/** 出图边长。1200×1200（方图）—— 选它的理由见 specs 与报告：
 *  底稿本来就是 1200 的方形 viewBox，压成 1200×630 只能靠裁掉上下两条
 *  （上边是 UNIVERSE #号，下边是 D、结局、四个常数 —— 恰好是全部信息量）
 *  或者留 47% 的黑边。方图还能一图三用：og:image、剪贴板里粘进微信的那张、市场缩略。 */
const SIZE = 1200;
/* 后来加的两个变体（index.js 的 /api/art/<hash>.png）：
     ?og=1   1200×630 —— 方卡原样缩到左边 + 右栏文字（og.js），给可索引的落地页当 og:image；
     ?w=N    fitTo 宽度 300..1200，方图或 og 都认。
   老 URL 一个参数不带，仍然是上面这个 1200 的方图，字节不变。 */

/** fitTo 宽度。只认 16..4096 的整数，其余一律回 SIZE。
    index.js 已经把 ?w 限在 300..1200，这里再夹一次是防以后哪条路把用户输入直接漏进来
    （NaN 会让 resvg 抛错 → 退通用图，不算灾难，但没必要）。 */
function fitWidthOf(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 16 && n <= 4096 ? n : SIZE;
}

/* 缓存目录。任务书点名 .store/png/ —— 依它，但要说清楚：
   **这个子目录和 .store 里其余东西的性质相反，它可再生、随时可以整个删掉。**
   .store 的其余部分（card-*.json）是干预记录，删了就永久丢参数。
   文件名带 derivationVersion 与 SHAPE，理由同 .cache：结构一升级就该出新的一张，
   而不是让旧字节一直命中。 */
function pngDir() {
  const store = process.env.ARCBANG_STORE || path.join(__dirname, '.store');
  return process.env.ARCBANG_PNG_DIR || path.join(store, 'png');
}

/* undefined = 还没试过；null = 没有这个依赖（退通用图）；function = 能用 */
let Resvg = undefined;
function rasterizer() {
  if (Resvg === undefined) {
    try {
      Resvg = require('@resvg/resvg-js').Resvg;
    } catch (e) {
      Resvg = null;
      console.error('[png] 没装 @resvg/resvg-js，分享图一律退通用预览：' + (e && e.message));
    }
  }
  return Resvg;
}

/* 字体：只开 loadSystemFonts，不点名家族。
   服务器上点名与不点名渲出来的字节几乎一样（2650946 vs 2651177），但点名一个
   本机没有的家族（比如在 Windows 开发机上点 DejaVu Sans）会平白多一层查找，
   而 SVG 里本来就写着 "Helvetica,Arial,sans-serif" 的退化链。
   ARCBANG_PNG_FONT 留给「哪天想把出图字体钉死」用。 */
function fontOpt() {
  const o = { loadSystemFonts: true };
  if (process.env.ARCBANG_PNG_FONT) o.defaultFontFamily = process.env.ARCBANG_PNG_FONT;
  return o;
}

/* ---------------------------------------------------------------- 通用预览图
   两级：
     1) base/og-fallback.png —— 出图工具预先生成好的那张（tools/make-og-fallback.js）
     2) 连它都缺了 → 现编一张纯色 PNG。
   第二级看着多余，但它是"绝不 500"的最后一道：真到那一步时手里没有任何光栅化能力，
   而纯色 PNG 只是 zlib + 四个 chunk，谈不上"自己写光栅化"。 */
const FALLBACK_FILE = path.join(__dirname, 'base', 'og-fallback.png');
let fallbackBuf = null;
function fallbackPNG() {
  if (fallbackBuf) return fallbackBuf;
  try {
    if (fs.existsSync(FALLBACK_FILE)) {
      fallbackBuf = fs.readFileSync(FALLBACK_FILE);
      return fallbackBuf;
    }
  } catch (e) { /* 读不出来就往下走纯色那档 */ }
  console.error('[png] 连 base/og-fallback.png 都没有，退纯色图（跑 node tools/make-og-fallback.js 生成）');
  fallbackBuf = solidPNG(SIZE, SIZE, 0x03, 0x05, 0x0c);
  return fallbackBuf;
}

const crc32 = typeof zlib.crc32 === 'function' ? zlib.crc32 : (function () {
  // Node < 20.12 没有 zlib.crc32，自己搭一张表（只在这一处用）
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    T[n] = c;
  }
  return function (buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}
/** 纯色 PNG（8 位 RGB，逐行 filter 0）。最后一道保险，不参与正常路径。 */
function solidPNG(w, h, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(new Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------------------------------------------------------- 并发闸
   inflight：同一个 key 十个请求只渲一次，其余的等同一个 Promise。
   sema：全局同时最多渲 RENDER_MAX 张。光栅化是同步 CPU 活（resvg 的 render 是阻塞的），
   放开了会把事件循环整个占住 —— 而 /api/bang 的签名、/api/market 的索引都在同一个循环里。 */
const inflight = new Map();
/* env 值要先验明是个数：Number('abc') 是 NaN，Math.max(1, NaN) 还是 NaN，
   而 `running < NaN` 恒为 false —— acquire() 一个名额都发不出去，
   所有请求全进 waiters 里永远等（配错一个 env 就把出图整个锁死）。
   上限 8：配成 Infinity/1e6 会放开光栅化把事件循环堵死（签名跟它挤同一环）。 */
function renderMaxOf(v) {
  return envInt(v, 2, 1, 8);
}
const RENDER_MAX = renderMaxOf(process.env.ARCBANG_PNG_CONCURRENCY);
/* 排队硬顶：不同 key 的 miss 各占一个 waiter。放开了等于把 HTTP 连接当队列，
   主网一次爬虫风暴就能把进程的内存和事件环塞满。超额退通用图，不 500。 */
const WAIT_MAX = 32;
let running = 0;
const waiters = [];
function acquire() {
  if (running < RENDER_MAX) { running++; return Promise.resolve(true); }
  if (waiters.length >= WAIT_MAX) return Promise.resolve(false);
  return new Promise(resolve => waiters.push(() => resolve(true)));
}
function release() {
  const next = waiters.shift();
  if (next) next();            // 名额直接过户，running 不动
  else running--;
}

/** 统计，自检和排障用 */
const stats = { renders: 0, hits: 0, fallbacks: 0, lastMs: 0 };

/**
 * 拿一张 PNG。**任何情况下都 resolve，不 reject。**
 *
 * @param {string} key      缓存文件名（不含目录，调用方负责把版本号、变体、宽度拼进去）
 * @param {function():string} buildSVG 真要渲染时才调用 —— 缓存命中时连 SVG 都不用拼
 * @param {{width?:number}} [opts]  width = fitTo 宽度（默认 SIZE；高度按 SVG 的 viewBox 比例走）
 * @returns {Promise<{buf:Buffer, cached:boolean, fallback:boolean, ms:number}>}
 */
async function pngFor(key, buildSVG, opts) {
  const t0 = Date.now();
  const dir = pngDir();
  const width = fitWidthOf(opts && opts.width);
  /* 文件名只许 [A-Za-z0-9._-]。path.join 遇到绝对路径会丢掉 dir
     （POSIX: join('/cache','/etc/passwd') → /etc/passwd），
     HTTP 那头 key 是我们自己拼的 0x 哈希，这道闸是防以后哪次把用户输入漏进来。 */
  if (typeof key !== 'string' || !/^[A-Za-z0-9._-]+$/.test(key)) {
    stats.fallbacks++;
    return { buf: fallbackPNG(), cached: false, fallback: true, ms: Date.now() - t0 };
  }
  const file = path.join(dir, key);
  const root = path.resolve(dir);
  const resolved = path.resolve(file);
  if (resolved !== root && resolved.indexOf(root + path.sep) !== 0) {
    stats.fallbacks++;
    return { buf: fallbackPNG(), cached: false, fallback: true, ms: Date.now() - t0 };
  }

  // 1. 磁盘缓存
  try {
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      /* 空文件 = 上一次写盘被 kill 在半路（rename 之后进程没了）。
         当成没有，重渲一张覆盖掉 —— 发一个 0 字节的 PNG 出去，
         平台那边就是一张永远裂着的预览图，而且它会被 CDN 缓存住。 */
      if (buf.length > 0) {
        stats.hits++;
        return { buf, cached: true, fallback: false, ms: Date.now() - t0 };
      }
    }
  } catch (e) { /* 读缓存失败不算错，往下渲 */ }

  // 2. 同一个 key 已经有人在渲了 —— 搭他的车，别再渲一遍
  const pending = inflight.get(key);
  if (pending) {
    const r = await pending;
    return { buf: r.buf, cached: true, fallback: r.fallback, ms: Date.now() - t0 };
  }

  const job = (async () => {
    const R = rasterizer();
    if (!R) { stats.fallbacks++; return { buf: fallbackPNG(), fallback: true }; }
    const got = await acquire();
    if (!got) { stats.fallbacks++; return { buf: fallbackPNG(), fallback: true }; }
    try {
      const svg = buildSVG();
      const t1 = Date.now();
      const buf = Buffer.from(new R(svg, {
        fitTo: { mode: 'width', value: width },
        font: fontOpt()
      }).render().asPng());
      stats.renders++; stats.lastMs = Date.now() - t1;
      try {
        fs.mkdirSync(dir, { recursive: true });
        writeAtomic(file, buf);        // 写盘失败只是下次再渲一遍，不该影响这次响应
      } catch (e) { console.error('[png] 缓存写不进去（不影响本次响应）：' + e.message); }
      return { buf, fallback: false };
    } catch (e) {
      /* 渲染炸了（SVG 里有 resvg 不认的东西、底图丢了、内存不够…）：
         退通用图。**这里绝不能把错抛上去** —— 上面那层会变成 500，
         而 og:image 500 等于整条分享链路的预览图全没。 */
      console.error('[png] 渲染失败，退通用预览图：' + (e && e.message));
      stats.fallbacks++;
      return { buf: fallbackPNG(), fallback: true };
    } finally {
      release();
    }
  })();

  inflight.set(key, job);
  try {
    const r = await job;
    return { buf: r.buf, cached: false, fallback: r.fallback, ms: Date.now() - t0 };
  } finally {
    inflight.delete(key);
  }
}

/** 依赖在不在（/api/health 报出去，部署完能一眼看出分享图是真图还是通用图） */
function available() { return !!rasterizer(); }

module.exports = {
  pngFor, available, fallbackPNG, pngDir, SIZE,
  _stats: () => Object.assign({ inflight: inflight.size, running, waiters: waiters.length }, stats),
  /** 自检用：强行制造"依赖缺失"那一档。传 undefined 恢复成"下次再探测" */
  _setRasterizer: (v) => { Resvg = v; },
  /** 自检用：并发闸上限的解析（NaN/0/负数都不许把信号量锁死） */
  _renderMaxOf: renderMaxOf,
  /** 自检用：fitTo 宽度的夹取 */
  _fitWidthOf: fitWidthOf,
  _resetFallback: () => { fallbackBuf = null; }
};
