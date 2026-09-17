/*
 * 分享落地页 —— /s/<区块号>（真页面，可被索引）
 * ------------------------------------------------------------
 * 第一版（share.js）是「爬虫拿 og，人拿跳转」：极小 HTML + meta refresh 立刻跳去 app.html。
 * 代价是搜索引擎一个字都索引不到 —— 一个跳转页在它眼里是空的。
 * 这一版把 /s/ 做成一张**真正的落地页**：结局、物理解释、常数表、铸造状态、进模拟器的按钮，
 * 全部服务端渲染、英文、内联 CSS、不到 12 KB、除卡片图外零外部请求。人进来看完再点按钮走。
 *
 * share.js 的三条纪律原样继承：
 *   1. 绝不报错页；2. 不阻塞铸造/市场主流程（只读 card 缓存和内存索引）；
 *   3. 降级要诚实 —— card 拿不到就写 "Outcome not computed yet"，不猜结局。
 *
 * 文案：平实、事实、不吹；不谈价格，不谈投资。
 */
'use strict';
const { OUTCOME_EN } = require('./art.js');
const { esc, grp } = require('./share.js');

/* CODATA 2018 的 α⁻¹，表里那句 "ours 1/137.04" 用。card.constants 没带 α 的比值，
   c/h/e/G 各自带了 ratio；α 这一行自己除一下，不算猜 —— α 是引擎真算出来的内部可观测量。 */
const ALPHA_INV_0 = 137.035999084;

/* 页脚「Open source engine」指向哪个仓库。
   默认是 BNBBANG / BTCBANG 两站一直在用的那个（不配这个变量时输出逐字节不变）；
   ARCBANG 是独立仓库（2026-09-17 用户拍板），在它那一份 env 里写 BNBBANG_REPO_URL 覆盖。
   分享页是服务端渲染的，站点包里的改写表（web/arc-patch.js）够不到这里。 */
const REPO_URL = process.env.BNBBANG_REPO_URL || 'https://github.com/q3579338/arcbang/tree/main/engine';

/**
 * 十二个结局各一段物理解释（按 card.outcome.index 索引，顺序与合约 outcomeName() 一致）。
 * 逐条对着 engine/engine.js OUTCOMES 的 visual 写，不加戏。
 */
const OUTCOME_EXPLAIN = [
  /* 0 UNSTABLE_ORBITS */
  'In this universe the number of spatial dimensions is not three. Gravitational orbits and the ground states of atoms are both unstable, so matter cannot settle: it either collapses inward or disperses. Nothing lasting can be built from it.',
  /* 1 BIG_CRUNCH */
  'The expansion of this universe does not last. Gravity wins, the expansion halts and reverses, and everything is compressed back toward a single point. Whatever structure formed on the way out is destroyed on the way back.',
  /* 2 BIG_RIP */
  'Dark energy grows stronger with time and tears structure apart at ever smaller scales: galaxies, then stars, then atoms. This ending needs phantom energy with w below −1, which the current parameter set cannot produce, so it is listed for completeness rather than reached in practice.',
  /* 3 HEAT_DEATH_NO_STRUCTURE */
  'Density fluctuations are too small for gravity to gather anything. The universe stays an almost uniform gas that keeps diluting and cooling forever, and no galaxies, stars or planets ever condense out of it.',
  /* 4 BLACK_HOLE_DOMINATED */
  'Density fluctuations are too large. Overdense regions collapse into black holes before they can cool and fragment into stars, so most of the matter ends up behind event horizons instead of in galaxies.',
  /* 5 NO_ATOMS */
  'Stable atoms do not exist here. Either there are no baryons, protons decay, or electron shells cannot hold together. Without atoms there is no chemistry and nothing for stars to burn in the usual way.',
  /* 6 NO_CHEMISTRY */
  'Atoms and light both exist, but the constants do not allow carbon, hydrogen or rigid molecules. Without a working chemistry there is nothing to build complex structures from, however long the universe lasts.',
  /* 7 NO_STARS */
  'Galaxies form, but the gas inside them never ignites. No star reaches the temperature and pressure needed for fusion, so there is no starlight, no heavy elements and no energy source for planets.',
  /* 8 STARS_NO_LIFE */
  'Stars, planets and chemistry all exist in this universe. What is missing is time or a stage: stars burn out too quickly, or the habitable window is too short for anything complex to develop.',
  /* 9 OBSERVERS_POSSIBLE */
  'Galaxies, stars, planets and chemistry all exist, and stars live long enough for complex processes to unfold. Under this model the conditions for observers are met. Only a few percent of blocks get this far.',
  /* 10 NO_CARBON_CHEMISTRY */
  'Stars and chemistry both work here, but not the kind that leads to carbon-based life. Either the triple-alpha process in stars fails to produce carbon and oxygen, or there is no temperature window in which water stays liquid.',
  /* 11 BEYOND_MODEL_DIM */
  'The number of spatial dimensions is not three, and the model\u2019s formulas for nucleosynthesis, stars, chemistry and habitability are only valid in three dimensions. The simulator still reports numbers by extrapolating the 3-D formulas, but they should be read as a reference, not a verdict.'
];

/** 科学计数法，指数用 Unicode 上标（与 art.js 卡面同一写法；art.js 不导出它，这里抄一份） */
const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function sci(v, digits) {
  if (!(typeof v === 'number' && isFinite(v)) || v === 0) return '—';
  const ex = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, ex);
  return m.toFixed(digits == null ? 3 : digits) + '×10'
    + String(ex).split('').map(ch => SUP[ch] || ch).join('');
}
const ratioTxt = r => (typeof r === 'number' && isFinite(r)) ? r.toFixed(3) + '× ours' : '';
const shortAddr = a => (a && /^0x[0-9a-fA-F]{40}$/.test(a)) ? a.slice(0, 6) + '…' + a.slice(-4) : '';

/**
 * 组一张落地页。
 *
 * @param {object} o
 * @param {number|null} o.blockNumber  URL 里的高度；哈希形式的链接为 null
 * @param {string|null} o.hash         区块哈希（按高度查不到时为 null）
 * @param {object|null} o.card         拿得到就写真实结局；拿不到走降级文案
 * @param {object} o.mint              marketindex.mintStatusOf 的三态 {minted, tokenId, owner}
 * @param {boolean} o.indexable        进不进索引（决定 meta robots）
 * @param {string} o.appUrl            "Open in the simulator" 的目标（已拼好 query）
 * @param {string} o.canonical         这张页自己的完整 URL
 * @param {string} o.ogImage           1200×630 的 og 图完整 URL
 * @param {string} o.cardImage         页面正文里那张方卡的完整 URL
 * @param {string} o.base              PUBLIC_BASE（btc 站是 btc 站的根）
 * @param {string} [o.origin]          'btc' → 比特币宇宙变体（specs/btcbang-v1.md §五）：标题 Bitcoin block #n、
 *                                     徽章、前导零、verified=false 属正常态的解释。不传时输出**逐字节不变**。
 * @param {object} [o.btc]             {height, time, badges:[{key,label,labelEn}], zeros, base}
 */
function landingHTML(o) {
  const card = o.card || null;
  const isBtc = o.origin === 'btc';
  const chainWord = isBtc ? 'Bitcoin' : 'BNB';
  const brand = isBtc ? 'BTCBANG' : 'BNBBANG';
  const bt = (isBtc && o.btc) || {};
  const N = Number.isSafeInteger(o.blockNumber) ? o.blockNumber : null;
  /* 标题 / 表格里用的高度：比特币宇宙的哈希链接也知道高度（注册表里有），照印；
     上一块 / 下一块仍只看 URL 里的 N —— 哈希链接在哪个站都可能被打开，/s/<n±1> 的解释跟着 Host 走。 */
  const BN = N != null ? N : (isBtc && Number.isSafeInteger(bt.height) ? bt.height : null);
  const numTxt = BN != null ? '#' + grp(BN) : '';
  const hashShort = o.hash ? o.hash.slice(0, 10) + '…' : '';
  const subject = BN != null ? 'Universe from ' + chainWord + ' block ' + numTxt : 'Universe ' + hashShort;

  const outcome = card && card.outcome ? card.outcome : null;
  const en = outcome ? (OUTCOME_EN[outcome.index] || outcome.id || '') : '';
  const K = (card && card.constants) || {};
  const D = card && card.dimension && card.dimension.D != null ? card.dimension.D : null;
  const grade = card && card.rarity && card.rarity.name ? card.rarity.name : '';

  const ogTitle = outcome ? subject + ' — ' + en : subject;
  const title = ogTitle + ' | ' + brand;
  let desc;
  if (outcome) {
    desc = subject + ' derives a universe whose ending is \u201c' + en + '\u201d'
      + (D != null ? ', D = ' + D.toFixed(3) : '')
      + (K.alphaInv != null ? ', α = 1/' + K.alphaInv.toFixed(2) : '')
      + (grade ? ', grade ' + grade : '') + '. '
      + (outcome.observers ? 'Observers are possible in this universe. ' : 'No observers are possible. ')
      + 'Every ' + chainWord + ' block hash is a set of physical laws; open this one in the simulator.';
  } else {
    desc = subject + '. Outcome not computed yet. Every ' + chainWord + ' block hash is a set of physical laws; '
      + 'open this one in the simulator to derive its constants and ending.';
  }

  const meta = (prop, val, name) =>
    '<meta ' + (name ? 'name' : 'property') + '="' + prop + '" content="' + esc(val) + '">';
  const robots = o.indexable ? 'index,follow' : 'noindex,follow';

  /* JSON-LD 里的字符串全是服务端自己的（哈希、结局名、URL），query 不进来。
     仍然把 < 和 > 转成 \u003c \u003e：</script> 一旦出现在 JSON 里就能提前闭合标签。 */
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    name: ogTitle,
    description: desc,
    image: o.ogImage,
    url: o.canonical,
    artform: 'Generative art',
    artMedium: 'SVG',
    creator: { '@type': 'Organization', name: brand, url: (o.base || '') + '/' },
    isBasedOn: o.hash || undefined
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  /* ---- 正文 ---- */
  let verdict, explain = '';
  if (outcome) {
    verdict = '<p class="v"><strong>' + esc(en) + '</strong><span class="zh">' + esc(outcome.name || '') + '</span></p>'
      + '<p class="g">Grade ' + esc(grade || '—') + ' · '
      + (outcome.observers ? 'observers possible' : 'no observers') + '</p>';
    const para = OUTCOME_EXPLAIN[outcome.index];
    if (para) explain = '<p>' + esc(para) + '</p>';
  } else {
    verdict = '<p class="v"><strong>Outcome not computed yet</strong>'
      + '<span class="zh">The physical constants of this block have not been derived on this server yet. '
      + 'Open it in the simulator to compute them.</span></p>';
  }

  const rows = [];
  const row = (k, v, r) => rows.push('<tr><th>' + k + '</th><td class="n">' + v + '</td><td class="r">' + (r || '') + '</td></tr>');
  if (BN != null) row(chainWord + ' block', numTxt);
  if (o.hash) {
    /* 比特币宇宙：哈希旁边给一条去 mempool.space 复核的链接（§1.1「谁都能复核」）。BNB 那行不动。 */
    row('Block hash', '<code>' + esc(o.hash) + '</code>', isBtc
      ? '<a href="https://mempool.space/block/' + esc(o.hash.replace(/^0x/, '')) + '" rel="noopener">mempool.space</a>' : '');
  }
  if (isBtc) {
    if (Number.isSafeInteger(bt.time) && bt.time > 0) {
      row('Block time', esc(new Date(bt.time * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'));
    }
    if (Number.isSafeInteger(bt.zeros)) row('Leading zeros', String(bt.zeros) + ' hex digits');
    if (Array.isArray(bt.badges) && bt.badges.length) {
      row('Badges', bt.badges.map((b) => esc(b.labelEn || b.key)).join(' · '));
    }
  }
  if (card) {
    if (D != null) {
      row('Dimension D', D.toFixed(3) + (card.dimension.kind === 'fractional' ? ' (half-open)' : ' (integer)'), 'ours 3');
    }
    if (K.alphaInv != null) {
      row('Fine-structure constant α', '1/' + K.alphaInv.toFixed(2),
        (K.alpha ? ratioTxt(K.alpha * ALPHA_INV_0) + ' ' : '') + '(1/' + ALPHA_INV_0.toFixed(2) + ')');
    }
    if (K.c && K.c.si != null) row('Speed of light c', grp(K.c.si / 1000) + ' km/s', ratioTxt(K.c.ratio));
    if (K.h && K.h.si != null) row('Planck constant h', sci(K.h.si) + ' J·s', ratioTxt(K.h.ratio));
    if (K.e && K.e.si != null) row('Elementary charge e', sci(K.e.si) + ' C', ratioTxt(K.e.ratio));
    if (K.G && K.G.si != null) row('Gravitational constant G', sci(K.G.si) + ' m³kg⁻¹s⁻²', ratioTxt(K.G.ratio));
    if (K.alphaGRel != null) row('Gravitational coupling α<sub>G</sub>', ratioTxt(K.alphaGRel) || '—');
  }
  const table = rows.length
    ? '<table>' + rows.join('') + '</table>'
      + (card && K.frame === 'external'
        ? '<p><small>Constants are reported in an external frame. Only α and α<sub>G</sub> are observable from inside the universe; '
          + 'c, h, e and G can be rescaled without changing what its inhabitants could measure.</small></p>'
        : '')
    : '';

  const m = o.mint || {};
  let mint;
  if (m.minted === true) {
    mint = 'Minted as #' + esc(m.tokenId) + (m.owner ? ', owner ' + esc(shortAddr(m.owner) || m.owner) : '');
  } else if (m.minted === false) {
    mint = 'Not minted yet — the first confirmed transaction owns it.';
  } else {
    mint = 'Mint status unavailable.';
  }

  let nav = '';
  if (N != null) {
    if (N >= 1) nav += '<a href="/s/' + (N - 1) + '" rel="prev">← Block #' + grp(N - 1) + '</a>';
    nav += '<a href="/s/' + (N + 1) + '" rel="next">Block #' + grp(N + 1) + ' →</a>';
  }
  /* 「回首页」那一行写的是本站域名。非 btc 的那一支从前写死 bnbbang.com ——
     ARCBANG 那个实例（BNBBANG_PUBLIC_BASE=https://arcbang.xyz）跟着就把访客指去了别人家。
     改成读 o.base：bnb 实例的 base 就是 https://bnbbang.com，取出来仍是 bnbbang.com，
     产物逐字节不变；没传 base 时也退回同一个字面量。 */
  nav += '<a href="/">Back to ' + (isBtc ? esc(String(bt.base || 'https://bang.satloot.com').replace(/^https?:\/\//, ''))
    : esc(String(o.base || 'https://bnbbang.com').replace(/^https?:\/\//, '').replace(/\/+$/, ''))) + '</a>';

  /* 比特币宇宙必须把 verified=false 说清楚（规格 §一）：合约里的 blockhash(height) 查的是 BSC，
     对不上比特币哈希是必然的，_bang 只记 false 不 revert。不解释的话，链上那个 false
     会被读成「这枚是假的」。 */
  const btcNote = isBtc
    ? '<p><small>On-chain, this universe lives in the same MirrorUniverse contract on BNB Chain as every BNBBANG universe, '
      + 'with blockHash = the Bitcoin block hash and blockNumber = its Bitcoin height'
      + (BN != null ? ' (' + grp(BN) + ')' : '') + '. '
      + 'The contract’s <code>verified</code> flag is <code>false</code> for every Bitcoin-origin universe: '
      + 'BNB Chain cannot look up a Bitcoin hash, so the flag simply does not apply — that is the expected state, not an error. '
      + 'Anyone can confirm the origin by fetching this height from any Bitcoin node or explorer and comparing the hash.</small></p>'
    : '';

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<link rel="icon" href="/assets/icons/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg">'
    + '<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="description" content="' + esc(desc) + '">'
    + '<meta name="robots" content="' + robots + '">'
    + (o.canonical ? '<link rel="canonical" href="' + esc(o.canonical) + '">' : '')
    + meta('og:type', 'website')
    + meta('og:site_name', brand)
    + (o.canonical ? meta('og:url', o.canonical) : '')
    + meta('og:title', ogTitle)
    + meta('og:description', desc)
    + meta('og:image', o.ogImage)
    + meta('og:image:secure_url', o.ogImage)
    + meta('og:image:type', 'image/png')
    + meta('og:image:width', '1200')
    + meta('og:image:height', '630')
    + meta('og:image:alt', ogTitle)
    + meta('twitter:card', 'summary_large_image', true)
    + meta('twitter:title', ogTitle, true)
    + meta('twitter:description', desc, true)
    + meta('twitter:image', o.ogImage, true)
    + meta('twitter:image:alt', ogTitle, true)
    + '<script type="application/ld+json">' + ld + '</script>'
    + '<style>'
    + 'body{margin:0;background:#03050c;color:#c9d4e8;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}'
    + 'main{max-width:720px;margin:0 auto;padding:28px 20px 48px}'
    + 'a{color:#ffd08c}'
    + '.wm{display:inline-block;font:600 14px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.35em;text-decoration:none}'
    + 'h1{font-size:clamp(22px,4.5vw,32px);font-weight:400;line-height:1.25;margin:18px 0 12px;color:#fff}'
    + '.v{font-size:22px;color:#fff;margin:0}'
    + '.zh{display:block;font-size:15px;color:#8fa0bd;font-weight:400}'
    + '.g{margin:6px 0 18px;color:#ffd08c;letter-spacing:.08em;font-size:13px;text-transform:uppercase}'
    + 'img{width:100%;max-width:560px;height:auto;display:block;border-radius:8px;margin:0 0 18px;background:#0a0f1c}'
    + 'p{margin:0 0 14px}'
    + 'table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 14px}'
    + 'th,td{text-align:left;padding:7px 6px;border-bottom:1px solid #1a2233;vertical-align:top}'
    + 'th{font-weight:500;color:#8fa0bd;white-space:nowrap}'
    + 'td.n{font-variant-numeric:tabular-nums}td.r{color:#8fa0bd;white-space:nowrap}'
    + 'code{font:13px ui-monospace,Menlo,Consolas,monospace;color:#9fd4ff;word-break:break-all}'
    + '.mint{color:#9df0cd}'
    + '.btn{display:inline-block;background:#ffd08c;color:#03050c;font-weight:600;padding:12px 22px;border-radius:6px;text-decoration:none;margin:6px 0 16px}'
    + 'nav a{display:inline-block;margin:0 18px 8px 0;font-size:14px}'
    + 'footer{margin-top:28px;font-size:13px;color:#6f7f9c;border-top:1px solid #1a2233;padding-top:14px}'
    + 'small{color:#6f7f9c;font-size:12px}'
    + '@media (max-width:480px){td.r{white-space:normal}.v{font-size:19px}}'
    + '</style></head><body><main>'
    + '<a class="wm" href="/">' + brand + '</a>'
    + '<h1>' + esc(subject) + '</h1>'
    + verdict
    + '<img src="' + esc(o.cardImage) + '" alt="' + esc(ogTitle) + '" width="1200" height="1200" loading="lazy">'
    + explain
    + table
    + '<p class="mint">' + mint + '</p>'
    + btcNote
    + '<p><a class="btn" href="' + esc(o.appUrl) + '">Open in the simulator</a></p>'
    + '<nav>' + nav + '</nav>'
    + '<footer>Free to detonate. Each hash can be minted once. '
    + '<a href="' + esc(REPO_URL) + '" rel="noopener">Open source engine</a>.</footer>'
    + '</main></body></html>';
}

module.exports = { landingHTML, OUTCOME_EXPLAIN };
