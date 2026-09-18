/*
 * 出图 —— 统一底图 + 参数标题卡
 * ------------------------------------------------------------
 * 演进过程（别再走回头路）：
 *   v1 程序化 SVG 画宇宙网      → 用户判断「不行」，和模拟器真画面差太远
 *   v2 无头 Chrome 真跑 PM 再截图 → 画面对了，但**一张 31 秒**，太慢
 *   v3（现在）所有 NFT 用同一张底图（就是模拟器真跑出来的那张 D=3 宇宙网），
 *      区别只在参数卡：爆炸后 mint 的叠参数，直接 mint 的不叠。
 *
 * 这么改把 C1 捡回来了：底图固定、文字全部由 card 决定 ⇒
 * **出图重新是 blockHash 的纯函数**，逐字节可重建，服务器没了也能还原。
 * 运行时不需要 puppeteer —— 它只留在 tools/make-base.js 这个一次性构图工具里。
 *
 * 字号：用户明确要求「参数放大，不然看不清」。维度 148px、数值 44px、标签 20px，
 * 缩到 200px 宽的列表缩略图里，维度那个数仍然认得出。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const S = 1200;
/* 卡面上那行水印 = 系列名。**写死，不读 env** —— 这张图就是 NFT 本身
   （tokenURI 的 image 指着它），必须是 blockHash 的纯函数：换一台服务器、
   换一份 env 都得渲出一模一样的字节，否则「谁都能复算出同一张图」这条就不成立了。 */
const BRAND = 'ARCBANG';
const BASE_FILE = path.join(__dirname, 'base', 'universe-base.jpg');
/* 缩略图档的底图。由 tools/make-base-thumb.py 从上面那张生成（400×400 / q80）。
   缺了不算错 —— 退回用全尺寸那张，只是慢，不该让出图整个挂掉。 */
const BASE_THUMB_FILE = path.join(__dirname, 'base', 'universe-base-thumb.jpg');

/* 底图必须 base64 内嵌，不能引用外部 URL：
   SVG 通过 <img> 加载时处于受限模式，加载不了任何外部资源，
   而钱包和 NFT 市场几乎都用 <img> 渲染 —— 引用外链的话底图直接不显示。

   代价是每张图都驮着同一张底图：1200 那张内嵌后 495 KB，占整张 SVG 的 99.3%，
   而真正属于这个宇宙的矢量内容只有 3.4 KB。所以给列表页单开一档缩略图。
   矢量文字不受影响（它是矢量的，何况缩略尺寸下本来也看不清）。 */
const BASE_URI = { full: null, thumb: null };
function baseURI(thumb) {
  const key = thumb ? 'thumb' : 'full';
  if (BASE_URI[key] == null) {
    let f = thumb ? BASE_THUMB_FILE : BASE_FILE;
    if (thumb && !fs.existsSync(f)) f = BASE_FILE;      // 没生成缩略底图就退回大图
    if (!fs.existsSync(f)) {
      throw new Error('缺底图 ' + f + '：先跑 node tools/make-base.js');
    }
    BASE_URI[key] = 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64');
  }
  return BASE_URI[key];
}

/* 档位只借它的颜色给整张卡定调（tint）——档位名字本身不再印在卡面上（2026-08-21 拍板删除）。
   card 数据里的 tier 字段原样保留：cardHash 是对卡片内容算的，这里只是不显示。 */
const TIER = {
  whisper: { tint: '#9df0cd' },
  drift:   { tint: '#9fd4ff' },
  quake:   { tint: '#ffd08c' },
  storm:   { tint: '#ffa8a8' },
  chaos:   { tint: '#e2b6ff' }
};

/** 与合约 outcomeName() 逐条一致 */
const OUTCOME_EN = [
  'Unstable orbits', 'Big Crunch', 'Big Rip', 'Heat death, no structure',
  'Black hole dominated', 'No atoms', 'No chemistry', 'No stars',
  'Stars but no life', 'Observers possible', 'No carbon chemistry', 'Beyond model (D≠3)'
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 救活过的宇宙用金色，且**整张图的气质都要变** —— 用户要求"一眼能认出来"。
   这不只是好看：救活是这个项目唯一真正稀缺的东西（区块要多少有多少，烧掉的币不是），
   所以它必须在缩略图里就能和普通宇宙区分开。 */
const GOLD = { tint: '#ffd479', hi: '#fff4d0', line: '#c9a227' };
/** 千分位。自己写不用 toLocaleString —— 后者跟着系统区域设置走，会破坏纯函数性 */
function grp(n) {
  const t = String(Math.round(n)), out = [];
  for (let i = t.length; i > 0; i -= 3) out.unshift(t.slice(Math.max(0, i - 3), i));
  return out.join(',');
}
/** 科学计数法，指数用 Unicode 上标 —— 原著就是"一点六七乘十的负十一次方"这种念法 */
const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function sci(v, digits) {
  const ex = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, ex);
  return m.toFixed(digits == null ? 3 : digits) + '×10'
    + String(ex).split('').map(ch => SUP[ch] || ch).join('');
}
/** 把 wei 级的 BANG 数量写成人看得懂的样子 */
function bangTxt(iv) {
  if (!iv || !iv.bang) return '';
  let n = 0;
  try { n = Number(BigInt(iv.bang) / (10n ** 18n)); } catch (e) { return ''; }
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M BANG';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K BANG';
  return n + ' BANG';
}

/**
 * 造物烧掉的量。优先用链上 Card.burned（铸造当时写下的）；
 * 旧 7 槽读不到才按当前 burnBps 折 paid，并标 estimated。
 * 两边都没有就 {amount:null}，不猜一个数。
 */
function craftedBurnOf(burned, paid, burnBps) {
  if (burned != null && burned !== '') {
    try {
      return { amount: BigInt(burned), estimated: false };
    } catch (e) { /* 不是合法整数，往下看能不能折算 */ }
  }
  if (paid == null || paid === '' || burnBps == null || burnBps === '') {
    return { amount: null, estimated: false };
  }
  try {
    return { amount: (BigInt(paid) * BigInt(burnBps)) / 10000n, estimated: true };
  } catch (e) {
    return { amount: null, estimated: false };
  }
}

/** 卡面上那行「销毁 X」。估的会缀「按当前费率折算」。没有数就 null。 */
function craftedBurnLabel(burned, paid, burnBps) {
  const x = craftedBurnOf(burned, paid, burnBps);
  if (x.amount == null) return null;
  const n = (x.amount / (10n ** 18n)).toString();
  return x.estimated ? ('销毁 ' + n + ' · 按当前费率折算') : ('销毁 ' + n);
}
/** 结局 id → 序号，画"从什么死法救回来的"要用 */
const OUTCOME_INDEX = {
  UNSTABLE_ORBITS: 0, BIG_CRUNCH: 1, BIG_RIP: 2, HEAT_DEATH_NO_STRUCTURE: 3,
  BLACK_HOLE_DOMINATED: 4, NO_ATOMS: 5, NO_CHEMISTRY: 6, NO_STARS: 7,
  STARS_NO_LIFE: 8, OBSERVERS_POSSIBLE: 9, NO_CARBON_CHEMISTRY: 10, BEYOND_MODEL_DIM: 11
};
const F = 'Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,Menlo,Consolas,monospace';

/**
 * @param {string} blockHash
 * @param {object} card buildCard() 的 card
 * @param {boolean} withParams 爆炸后 mint 带参数；直接 mint（含合约调用）不带
 */
/**
 * @param thumb 出缩略图档：画布尺寸不变（矢量内容照旧按 1200 排版，
 *              缩放由渲染方决定），只把内嵌的底图换成小的。
 *              不传 opts 时输出**逐字节不变**：原生 / 干预卡的图是 tokenURI 指着的东西。
 */
function renderSVG(blockHash, card, withParams, thumb, opts) {
  opts = opts || {};
  const iv = card && card.intervention;
  const rescued = !!(iv && iv.rescued);
  const t = rescued ? Object.assign({}, TIER[(card.tier && card.tier.id) || 'whisper'] || TIER.whisper, GOLD)
    : (TIER[(card && card.tier && card.tier.id) || 'whisper'] || TIER.whisper);
  const short = blockHash.slice(0, 12) + '…' + blockHash.slice(-8);

  let plate;
  if (withParams && card) {
    const D = card.dimension && card.dimension.D != null ? card.dimension.D : null;
    const dTxt = D == null ? '—' : D.toFixed(3);
    const K = card.constants || {};

    /* 原著第八、十五章是把 G、c、h、e 四个并列报出来的，所以四个都印。
       v2 的推导让它们各自独立变化（引擎补了引力自由度 gNewton + 两个参照系自由度）。
       脚注必须写明：物理内容只有 α 和 α_G，多出来的自由度宇宙内部测不出来 ——
       不写就是在暗示"光速真的变了"是可观测事实，那是不诚实的。 */
    const stats = [];
    if (K.c && K.c.si != null) stats.push(['SPEED OF LIGHT c', grp(K.c.si / 1000) + ' km/s']);
    if (K.h && K.h.si != null) stats.push(['PLANCK CONSTANT h', sci(K.h.si) + ' J·s']);
    if (K.e && K.e.si != null) stats.push(['ELEMENTARY CHARGE e', sci(K.e.si) + ' C']);
    if (K.G && K.G.si != null) stats.push(['GRAVITATION G', sci(K.G.si)]);

    /* 布局：四个常数排成 2×2 而不是一行四列。
       一行四列时每格只有 262px 宽，数值被迫压到 34px —— 网页列表里缩到 200px 宽
       就等于 5.7px，完全读不了。2×2 每格 530px，数值能给到 48px。 */
    const TOP = 620;
    const COLX = [74, 636], ROWY = [1000, 1104];
    plate =
      '<rect x="0" y="' + TOP + '" width="' + S + '" height="' + (S - TOP) + '" fill="url(#scrim)"/>'
      // 维度：整张图上最大的字，缩略图里也认得出
      + '<text x="72" y="878" fill="#ffffff" font-family="' + F
      + '" font-size="152" font-weight="300" letter-spacing="-4">' + dTxt + '</text>'
      + '<text x="' + (72 + dTxt.length * 80) + '" y="878" fill="' + t.tint
      + '" font-family="' + F + '" font-size="44">D</text>'
      + '<text x="76" y="922" fill="' + t.tint + '" font-family="' + F
      + '" font-size="23" letter-spacing="4" opacity="0.88">'
      + (card.dimension && card.dimension.kind === 'fractional' ? 'HALF-OPEN' : 'INTEGER')
      + '</text>'
      // 结局：右上，第二大
      + '<text x="' + (S - 72) + '" y="832" text-anchor="end" fill="#ffffff" font-family="' + F
      + '" font-size="50" font-weight="300">' + esc(OUTCOME_EN[card.outcome.index] || '') + '</text>'
      + '<text x="' + (S - 72) + '" y="880" text-anchor="end" fill="' + t.tint + '" font-family="' + F
      + '" font-size="22" letter-spacing="3" opacity="0.85">'
      + (card.outcome.observers ? 'OBSERVERS POSSIBLE' : 'NO OBSERVERS') + '</text>'
      + '<line x1="72" y1="952" x2="' + (S - 72) + '" y2="952" stroke="#ffffff" stroke-opacity="0.22"/>'
      + stats.slice(0, 4).map(function (st, i) {
        const x = COLX[i % 2], y = ROWY[i >> 1];
        return '<text x="' + x + '" y="' + y + '" fill="#ffffff" fill-opacity="0.62" font-family="' + F
          + '" font-size="22" letter-spacing="1.5">' + esc(st[0]) + '</text>'
          + '<text x="' + x + '" y="' + (y + 52) + '" fill="#ffffff" font-family="' + F
          + '" font-size="48" font-weight="300">' + esc(st[1]) + '</text>';
      }).join('')
      + (rescued
        ? '<text x="74" y="1160" fill="' + GOLD.tint + '" fill-opacity="0.95" font-family="' + F
          + '" font-size="21" letter-spacing="1">RESCUED FROM '
          + esc((OUTCOME_EN[OUTCOME_INDEX[iv.from.outcome]] || iv.from.outcome).toUpperCase())
          + '  ·  ' + esc(iv.moved.length) + ' PARAMETERS MOVED</text>'
        : '')
      + '<text x="74" y="' + (rescued ? 1190 : 1186) + '" fill="#ffffff" fill-opacity="0.40" font-family="' + F
      + '" font-size="18">External frame · only α = 1/'
      + (K.alphaInv != null ? K.alphaInv.toFixed(2) : '—')
      + ' and α_G are observable from inside</text>';
  } else {
    plate =
      '<rect x="0" y="1000" width="' + S + '" height="200" fill="url(#scrim)"/>'
      + '<text x="72" y="1110" fill="#ffffff" fill-opacity="0.75" font-family="' + F
      + '" font-size="30" font-weight="300" letter-spacing="3">NOT DETONATED · NO PARAMETERS</text>'
      + '<text x="' + (S - 72) + '" y="1160" text-anchor="end" fill="#ffffff" fill-opacity="0.45"'
      + ' font-family="' + MONO + '" font-size="19">' + short + '</text>';
  }

  /* 宇宙编号 = 区块号。出图那条路的 card 是规范形态、blockNumber 恒为 null（见 index.js cardFor）。 */
  const no = card && card.blockNumber != null ? card.blockNumber : null;
  const num = no != null ? '#' + grp(no) : '';
  const numLabel = 'UNIVERSE ';

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + ' viewBox="0 0 ' + S + ' ' + S + '" width="' + S + '" height="' + S + '">'
    + '<defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#03050c" stop-opacity="0"/>'
    + '<stop offset="36%" stop-color="#03050c" stop-opacity="0.74"/>'
    + '<stop offset="100%" stop-color="#03050c" stop-opacity="0.96"/>'
    + '</linearGradient>'
    + '<linearGradient id="topscrim" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#03050c" stop-opacity="0.86"/>'
    + '<stop offset="100%" stop-color="#03050c" stop-opacity="0"/>'
    + '</linearGradient></defs>'
    + '<rect width="' + S + '" height="' + S + '" fill="#03050c"/>'
    + '<image x="0" y="0" width="' + S + '" height="' + S + '" preserveAspectRatio="xMidYMid slice"'
    + ' xlink:href="' + baseURI(thumb) + '"/>'
    // 顶部压一层暗，否则大字压在亮星系上读不清
    + '<rect x="0" y="0" width="' + S + '" height="230" fill="url(#topscrim)"/>'
    + '<text x="' + (S / 2) + '" y="104" text-anchor="middle" fill="' + t.tint + '" font-family="' + F
    + '" font-size="54" font-weight="300" letter-spacing="20">' + BRAND + '</text>'
    /* 救活的宇宙：整幅加一道金边 + 右上角一枚印记。
       金边是为了在列表缩略图里也能一眼分辨 —— 那时候字已经小到看不清了。 */
    + (rescued
      ? '<rect x="10" y="10" width="' + (S - 20) + '" height="' + (S - 20) + '" rx="6" fill="none" stroke="'
        + GOLD.line + '" stroke-width="7" opacity="0.9"/>'
        + '<rect x="24" y="24" width="' + (S - 48) + '" height="' + (S - 48) + '" rx="3" fill="none" stroke="'
        + GOLD.tint + '" stroke-width="1.5" opacity="0.55"/>'
        + '<g transform="translate(' + (S - 150) + ',150) rotate(-14)">'
        + '<circle cx="0" cy="0" r="86" fill="none" stroke="' + GOLD.line + '" stroke-width="4" opacity="0.95"/>'
        + '<circle cx="0" cy="0" r="76" fill="none" stroke="' + GOLD.tint + '" stroke-width="1.2" opacity="0.7"/>'
        + '<text x="0" y="-14" text-anchor="middle" fill="' + GOLD.hi + '" font-family="' + F
        + '" font-size="27" font-weight="600" letter-spacing="3">RESCUED</text>'
        /* 中文那行「救回来的宇宙」删了：RESCUED 已经说清楚了，
           一个印章上两种语言说同一件事是噪声。烧掉的数字往上收 14px 补位。 */
      + '<text x="0" y="30" text-anchor="middle" fill="' + GOLD.tint + '" font-family="' + MONO
        + '" font-size="15" opacity="0.85">' + esc(bangTxt(iv)) + '</text>'
        + '</g>'
      : '')
    + (num ? '<text x="' + (S / 2) + '" y="152" text-anchor="middle" fill="#ffffff" fill-opacity="0.66"'
      + ' font-family="' + MONO + '" font-size="28" letter-spacing="3">' + numLabel + num + '</text>' : '')
    + '<text x="' + (S / 2) + '" y="192" text-anchor="middle" fill="#ffffff" fill-opacity="0.40"'
    + ' font-family="' + MONO + '" font-size="20">' + short + '</text>'
    + plate
    + '</svg>';
}

/**
 * 造物出图：在原宇宙图上叠「销毁 X」。
 * **不改 renderSVG 的默认输出** —— 原生 / 干预卡的指纹必须一字不动。
 * @param {object} [opts] { thumb, burned, paid, burnBps }
 */
function renderCraftedSVG(blockHash, card, opts) {
  opts = opts || {};
  const svg = renderSVG(blockHash, card, true, opts.thumb,
    opts.origin ? { origin: opts.origin, height: opts.height } : undefined);
  const label = craftedBurnLabel(opts.burned, opts.paid, opts.burnBps);
  if (!label) return svg;
  const overlay = '<text x="74" y="220" fill="#ffd479" fill-opacity="0.95" font-family="' + F
    + '" font-size="22" letter-spacing="1">' + esc(label) + '</text>';
  const i = svg.lastIndexOf('</svg>');
  return i < 0 ? svg : svg.slice(0, i) + overlay + svg.slice(i);
}

module.exports = {
  renderSVG, renderCraftedSVG, craftedBurnOf, craftedBurnLabel,
  OUTCOME_EN, S, BASE_FILE, BASE_THUMB_FILE
};
