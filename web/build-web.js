#!/usr/bin/env node
/*
 * web/build-web.js —— 站点版构建
 * ------------------------------------------------------------
 * 用法：node build.js && node web/build-web.js  [--min] [--site bnb|btc]
 *
 * 站点版 = 离线单文件 + BNBBANG 这一层（区块哈希、钱包、铸造）。
 * 离线版 dist/mirror.html 一个字节都不改：它仍然是零外部请求的那个产物，
 * 联网能力只存在于 web/dist/index.html 里。
 *
 * 注入顺序要紧：bnbhash 依赖 MirrorParams，bnb-ui 依赖 MirrorApp，
 * 所以整层都追加在 </body> 之前——那时前面的脚本已经全部执行完。
 *
 * --site btc（specs/btcbang-v1.md §六）：同一套代码出 BTCBANG（bang.satloot.com）的包，落在 web/dist-btc/：
 *   · config 换入 web/config.btc.js（落盘名仍是 config.js，指纹照算）；
 *   · web/landing-btc.html → index.html，economy-btc → economy.html，三份英文文档 *-btc.html 落成无后缀名
 *     （缺席只打印跳过，不中断 —— 那几页由别人并行写）；
 *   · app.html 的 SEO 头按站参数化；每页 <head> 打一行 window.BNBBANG_SITE="btc"（nav.js 品牌名靠它，
 *     它在多数页面里比 config.js 先加载）；tokens.css 之后插 btc-theme.css（打指纹）；i18n-btc.js 跟在各 i18n 分册后；
 *   · robots / sitemap / manifest 用 -btc 版本；/en/ 预渲染照跑；不拷 deploy.html、不拷字节码。
 * 不带 --site（或 --site bnb）时行为与从前逐字节相同（唯一的差别：注入层多了 web/btc-source.js，它只挂一个全局对象）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const min = argv.includes('--min');
const siteAt = argv.indexOf('--site');
/* 独立的 ARCBANG 仓库里没有 web/config.js（那是别的站的），不带 --site 就是 arc。 */
const SITE = siteAt >= 0 ? String(argv[siteAt + 1] || '').toLowerCase()
  : (require('fs').existsSync(require('path').join(__dirname, 'config.js')) ? 'bnb' : 'arc');
if (SITE !== 'bnb' && SITE !== 'btc' && SITE !== 'arc') {
  console.error('--site 只认 bnb / btc / arc，收到「' + SITE + '」');
  process.exit(1);
}
const IS_BTC = SITE === 'btc';
/* 「不是主站」。从前只有 btc 一个变体，判定写的是 IS_BTC；加了 arc 之后，
   那些本意是「非默认站要做的改写」的地方一律改用 IS_ALT，
   只有真正 BTC 专属的内容（i18n-btc 词典、比特币文案）还留 IS_BTC。 */
const IS_ALT = SITE !== 'bnb';
/* 两站的差异全部收在这一张表里；下面的流程不再写死任何域名 / 站名。
   bnb 这一列的每个值都与改造前的字面量逐字相同 —— 那是「bnb 产物一个字节不变」的依据。 */
const SITES = {
  bnb: {
    dist: 'dist',
    base: 'https://bnbbang.com',
    name: 'BNBBANG',
    config: 'config.js',
    title: '镜像宇宙模拟器 · 引爆任意 BNB 区块 · BNBBANG',
    desc: '在线宇宙模拟器：把任意 BNB 区块哈希读成 23 个物理常数，从奇点算到热寂，看它能不能长出原子、恒星、行星和观察者。免费引爆，喜欢再铸成 NFT。',
    landing: 'landing.html',
    /* 独立页：[源文件, 落盘名]。deploy.html 只有主站有 */
    pages: [['market.html'], ['economy.html'], ['status.html'], ['profile.html'], ['deploy.html'], ['faq.html'], ['how-it-works.html'], ['verify.html']],
    extraAssets: [],
    seo: { 'robots.txt': 'robots.txt', 'sitemap.xml': 'sitemap.xml', 'sitemap-pages.xml': 'sitemap-pages.xml', 'manifest.webmanifest': 'manifest.webmanifest' },
    bytecode: true,
    en: null
  },
  btc: {
    dist: 'dist-btc',
    stamp: 'btc',
    theme: 'btc-theme.css',
    og: '/assets/og/home-btc.png',
    ldKind: 'Bitcoin',
    themeColor: '#160C02',
    lightOnly: true,
    base: 'https://bang.satloot.com',
    name: 'BTCBANG',
    config: 'config.btc.js',
    title: '镜像宇宙模拟器 · 引爆任意比特币区块 · BTCBANG',
    desc: '在线宇宙模拟器：把任意比特币区块哈希读成 23 个物理常数，从奇点算到热寂，看它能不能长出原子、恒星、行星和观察者。免费引爆，喜欢再铸成 NFT。',
    dict: 'i18n-btc.js',
    landing: 'landing-btc.html',
    pages: [['market.html'], ['economy-btc.html', 'economy.html'], ['status.html'], ['profile.html'], ['faq-btc.html', 'faq.html'], ['how-it-works-btc.html', 'how-it-works.html'], ['verify-btc.html', 'verify.html']],
    /* i18n-btc-site.js 是首页（landing-btc.html）作者自带的词典分册：有就拷、打指纹、进 /en/ 预渲染 */
    extraAssets: ['i18n-btc.js', 'i18n-btc-site.js', 'btc-theme.css'],
    seo: { 'robots-btc.txt': 'robots.txt', 'sitemap-btc.xml': 'sitemap.xml', 'sitemap-pages-btc.xml': 'sitemap-pages.xml', 'manifest-btc.webmanifest': 'manifest.webmanifest' },
    bytecode: false,
    en: {
      title: 'BTCBANG — Every Bitcoin block is a universe. Free to detonate, mint once.',
      desc: 'Read a Bitcoin mainnet block hash as 23 physical constants and run that universe to heat death. Detonate any block free; after 6 confirmations mint it once as an NFT on BSC — same contract and token as BNBBANG. Open source engine, zero premine.'
    }
  },
  /* ARCBANG（specs/arcbang-v1.md）：Arc 链 · 只卖 NFT · 没有代币。
     与 btc 那一列的差别：
       - economy.html / deploy.html 不进包 —— 前者整页是代币经济学，后者是六合约部署向导，
         两者在「没有代币」的站上都是错的，宁可缺页也不要放一份说谎的页；
       - 文档页的语言方向与 btc 站**相反**：arc 站中文在根路径、英文在 /en/（与首页同一条规矩），
         所以 zhPages 空着（中文就是根路径那一份，走 pages），改用 enPages 把英文版落进 /en/；
       - lightOnly：新站一律浅色（2026-09-08 用户定）。 */
  arc: {
    dist: 'dist-arc',
    base: 'https://arcbang.xyz',
    name: 'ARCBANG',
    config: 'config.arc.js',
    stamp: 'arc',
    title: '镜像宇宙模拟器 · 引爆任意 Arc 区块 · ARCBANG',
    desc: '在线宇宙模拟器：把任意 Arc 区块哈希读成 23 个物理常数，从奇点算到热寂，看它能不能长出原子、恒星、行星和观察者。免费引爆，喜欢再铸成 NFT。',
    landing: 'landing-arc.html',
    /* 三份文档各有 arc 版（照 btc 的先例 faq-btc.html → faq.html）：
       它们整篇是「Arc 链 · USDC · 没有代币」的口径，不是把 BNB 换成 Arc 就完事。
       **中文版是根路径那一份**（arc 站中文为主），英文版见下面的 enPages。
       它们不引 doc.css，改引 web/arc-doc.css —— 那是首页「测绘板」那套版式的内页延续。
       market / status / profile 三页仍用共用源文件，差异收在 web/arc-patch.js 里。 */
    /* deploy-arc.html → deploy.html：ARCBANG 自己的两合约部署向导（钱包签名，私钥不进 env）。
       主站那份 deploy.html 是六合约一套、按 BSC 的 chainId 硬核对，在 Arc 上第一步就停，
       所以不能共用源文件。页面自己带 noindex，也不进 sitemap（SITES.arc.seo 是空的）。 */
    pages: [['market.html'], ['status.html'], ['profile.html'], ['deploy-arc.html', 'deploy.html'],
            ['faq-arc.html', 'faq.html'], ['how-it-works-arc.html', 'how-it-works.html'], ['verify-arc.html', 'verify.html']],
    /* 三份文档的英文版：各写一份源文件（*-arc.en.html），与中文版同一套版式，
       落进 /en/。**不走 prerender-en 的词典预渲染** —— 那是给首页用的，
       几千字的长文档靠词典逐句对译，漏一句就中英混排；各写一份反而稳。
       走的仍是 zhPages 那一段的同一个流程（指纹 / siteify / absolutize），只是方向相反。 */
    enPages: [['how-it-works-arc.en.html', 'en/how-it-works.html'],
              ['faq-arc.en.html', 'en/faq.html'],
              ['verify-arc.en.html', 'en/verify.html']],
    dict: 'i18n-arc.js',
    /* i18n-arc-site.js 是首页（landing-arc.html）自带的词典分册：只收 arc 站独有的句子，
       与 BNBBANG 首页逐字相同的那些仍走 i18n-site.js（重复收会触发「全局词条被改写」告警）。 */
    /* keccak-lite.js 只有 arc 站单独拷一份：部署向导要它给字节码打指纹（显示 keccak 前 10 位）。
       别的站不外链它 —— 它在单文件包里已经被 build.js 内联进去了。 */
    extraAssets: ['i18n-arc.js', 'i18n-arc-site.js', 'arc-doc.css', 'keccak-lite.js'],
    seo: {},
    zhPages: [],
    lightOnly: true,
    bytecode: false,
    /* 部署向导（deploy.html）要在浏览器里现取字节码。ABI 一并拷过去：向导自己手写编解码，
       用不到 abi.json，但运营者拿它去浏览器上做合约验证时就在旁边，不用再回仓库找。
       BNBBANG 那一套的字节码走上面的 ST.bytecode（八个合约），两条路互不相干。 */
    artifacts: ['ArcUniverse', 'ArcMarket'],
    /* Arc 站自己的图标（黑底蓝奇点，web/assets/icons-arc/）与社交预览图：BNBBANG 那个金色 B 不能出现在 arcbang.xyz。 */
    icons: 'icons-arc',
    og: '/assets/og/home-arc.png',
    enDicts: ['i18n-arc.js', 'i18n-arc-site.js'],
    en: {
      title: 'ARCBANG — Every Arc block is a universe. Free to detonate, mint one.',
      desc: 'Read an Arc mainnet block hash as 23 physical constants and run that universe to heat death. Detonating is free and needs no wallet; keep one by minting it on Arc, where gas is USDC. 1,387 universes in total, the first 387 free (one per address), 1 USDC after that. No token, ever. Open source engine.'
    }
  }
};
const ST = SITES[SITE];
const srcName = min ? 'dist/mirror.min.html' : 'dist/mirror.html';
const src = path.join(ROOT, srcName);

if (!fs.existsSync(src)) {
  console.error('找不到 ' + srcName + '：先跑 node build.js');
  process.exit(1);
}

const LAYER = [
  // i18n 排第一：后面每个模块在自己的顶层就可能调 t()
  'web/i18n.js',
  'web/i18n-planets.js',
  'web/i18n-app.js',
  'web/i18n-mirror.js',
  'web/i18n-tools.js',
  'web/i18n-site.js',
  'web/i18n-market.js',
  // BTCBANG 专属词条只进 btc 包（bnb 包里没有它要翻的句子）
  IS_BTC ? 'web/i18n-btc.js' : null,
  // ARCBANG 同理：arc 站那些「付 USDC / Arc 区块 / 没有代币」的句子只在 arc 包里要翻
  SITE === 'arc' ? 'web/i18n-arc.js' : null,
  'web/' + ST.config,
  // engine/bnbhash.js 已经不打进站点包：爆炸的计算搬到服务端了（specs/server-side.md）。
  // 浏览器只需要 keccak256 来算 ABI 选择器，那是个哈希函数，泄露不了参数映射。
  // 多钱包发现要排在 bnb-chain 之前：后者的 eth() 会问它选了哪个
  'web/wallet.js',
  'web/keccak-lite.js',
  'web/bnb-api.js',
  // 比特币取块层（specs/btcbang-v1.md §四）：只挂 MirrorBtcSource，bnb-ui 按 config.site 决定用不用。
  // 两站都打进去 —— bnb-ui 里的 btc 分支引用它，缺了不炸但留着更省心；它不发任何请求。
  'web/btc-source.js',
  'web/bnb-chain.js',
  // 顺序有讲究：gauges / hint 只挂全局不依赖别人；intervene 运行时才用它们；
  // bnb-ui 最后，它要调 intervene，而且 mount 时 MirrorApp 必须已就位
  'web/gauges.js',
  'web/hint.js',
  'web/intervene.js',
  // 排在 onboard 之前：onboard.show() 会把「第一次进来」这件事让给它（有它就走 coach-mark，没有就退回三步弹窗）
  'web/tour.js',           // 可选：盖在真实界面上的分步引导（specs/sim-ui-v1.md）
  'web/onboard.js',        // 可选：术语人话表 + 新手模式 + WebGPU 教程
  'web/bnb-ui.js'
].filter(Boolean);

// 缺席时只跳过不中断——并行开发时某个模块还没交付，构建也得能跑
const OPTIONAL = ['web/tour.js', 'web/onboard.js', 'web/i18n-btc.js', 'web/i18n-arc.js', 'web/btc-source.js'];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    if (OPTIONAL.indexOf(rel) >= 0) return null;
    console.error('缺文件：' + rel);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}
function kb(s) { return (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + ' KB'; }
// </script> 出现在字符串里会提前闭合标签
function safeInline(code) { return code.replace(/<\/script>/gi, '<\\/script>'); }

let html = fs.readFileSync(src, 'utf8');

const layer = LAYER.map((rel) => {
  const code = read(rel);
  if (code == null) { console.log('  ○ ' + rel + '（缺席，跳过）'); return null; }
  console.log('  + ' + rel + ' (' + kb(code) + ')');
  return '<script>/* ---- ' + rel + ' ---- */\n' + safeInline(code) + '\n</script>';
}).filter(Boolean).join('\n');

/* 防呆：别拿已经注入过的站点版再当输入（会叠两层）。
   **哨兵不能用产品名**：BNBBANG 现在是可翻译文本（词典里就有「← 回到 BNBBANG」），
   词典打进离线包之后，纯净的底稿里也会出现这个词，于是好好的构建被自己拦住。
   踩过一次。改用一个只有注入过程才会写下的标记，它不可能出现在任何文案里。 */
var STAMP = '<!-- bnbbang-layer -->';
if (html.indexOf(STAMP) >= 0) {
  console.error('这个输入里已经有 BNBBANG 层了——别拿站点版当输入');
  process.exit(1);
}

/* 站点标识那一行：nav.js 的品牌名靠它（它在多数页面里比 config.js 先加载，见 nav.js siteOf）。
   bnb 包不打 —— 那是默认值，打了反而让 bnb 产物变样。 */
const SITE_STAMP = ST.stamp ? '<script>window.BNBBANG_SITE="' + ST.stamp + '"</script>\n' : '';
/* 强调色覆盖（specs/btcbang-v1.md §三）：排在 tokens.css 之后，打指纹（见下面的 FP）。 */
const THEME_LINK = ST.theme ? '<link rel="stylesheet" href="' + ST.theme + '">' : '';

html = html.replace('<title>镜像宇宙模拟器</title>', '<title>' + ST.title + '</title>');
/* 社交预览图：BTC 站有自己的一张（web/assets/og/home-btc.png，比特币橙 + 最新区块卡），bnb 站照旧。 */
const OG_IMG = ST.og || '/assets/og/home.jpg';
/* SEO 头（specs/seo-v1.md）：描述、canonical、OG/Twitter 卡、图标。离线包 dist/mirror.html 不带这些，
   只有站点版有 —— 它们全是指向本站的绝对地址（按 SITES 表参数化）。图标那行底稿里是 data:,（零外部请求），站点版换成真图标。 */
/* app.html 的结构化数据：WebApplication（首页那份在 landing 里；市场 / 经济页各自静态带）。站名与域名按 SITES 表。 */
const LD_APP = '<script type="application/ld+json">' + JSON.stringify({
  '@context': 'https://schema.org', '@type': 'WebApplication',
  name: ST.name + ' ' + (ST.ldKind || (IS_BTC ? 'Bitcoin' : 'Mirror')) + ' Universe Simulator', url: ST.base + '/app.html',
  inLanguage: ['zh-CN', 'en'], applicationCategory: 'EntertainmentApplication', operatingSystem: 'Web',
  browserRequirements: 'Requires WebGL', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  description: ST.desc, publisher: { '@type': 'Organization', name: ST.name, url: ST.base + '/' }
}) + '</script>';
{
  const seoHead = SITE_STAMP
    + "<meta name=\"description\" content=\"" + ST.desc + "\">\n<link rel=\"canonical\" href=\"" + ST.base + "/app.html\">\n<meta property=\"og:type\" content=\"website\">\n<meta property=\"og:site_name\" content=\"" + ST.name + "\">\n<meta property=\"og:url\" content=\"" + ST.base + "/app.html\">\n<meta property=\"og:title\" content=\"" + ST.title + "\">\n<meta property=\"og:description\" content=\"" + ST.desc + "\">\n<meta property=\"og:image\" content=\"" + ST.base + "" + OG_IMG + "\">\n<meta property=\"og:image:width\" content=\"1200\">\n<meta property=\"og:image:height\" content=\"630\">\n<meta property=\"og:locale\" content=\"zh_CN\">\n<meta property=\"og:locale:alternate\" content=\"en_US\">\n<meta name=\"twitter:card\" content=\"summary_large_image\">\n<meta name=\"twitter:title\" content=\"" + ST.title + "\">\n<meta name=\"twitter:description\" content=\"" + ST.desc + "\">\n<meta name=\"twitter:image\" content=\"" + ST.base + "" + OG_IMG + "\">\n<link rel=\"icon\" href=\"/assets/icons/favicon.ico\" sizes=\"32x32\">\n<link rel=\"icon\" type=\"image/svg+xml\" href=\"/assets/icons/favicon.svg\">\n<link rel=\"apple-touch-icon\" href=\"/assets/icons/apple-touch-icon.png\">\n<link rel=\"manifest\" href=\"/manifest.webmanifest\">\n<meta name=\"theme-color\" content=\"" + (ST.themeColor || (IS_BTC ? '#160C02' : '#0A0F2E')) + "\">\n" + LD_APP;
  const ICON_STUB = '<link rel="icon" href="data:,">';
  const iconAt = html.indexOf(ICON_STUB);
  if (iconAt < 0) { console.error('底稿里找不到 ' + ICON_STUB + '，SEO 头没处放'); process.exit(1); }
  html = html.slice(0, iconAt) + seoHead + html.slice(iconAt + ICON_STUB.length);
}
/* 注入点必须是**最后一个** </body>。String.replace 换的是第一个 —— 而 index.html
   顶部「站点顶栏」那段注释里恰好写着一个字面量的 </body>（"下面 </body> 前的
   ui/app.js…"），于是整层曾被塞进 <body> 开头的注释里：层比 engine/params.js
   先执行，bnb-ui 捕获到的 MirrorParams 是 undefined，参数表从此永远渲染成空
   （renderParams 静默 return，一个错都不报）；页面顶部还多出一段注释残骸和
   一个流浪的 </body>。线上实测就是这个症状。lastIndexOf 拼接，换谁都换不错。 */
const bodyAt = html.lastIndexOf('</body>');
if (bodyAt < 0) { console.error('底稿里没有 </body>，不是完整 HTML'); process.exit(1); }
html = html.slice(0, bodyAt) + STAMP + '\n' + layer + '\n' + html.slice(bodyAt);

const outDir = path.join(__dirname, ST.dist);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

/* config.js 的指纹。**这个文件决定整个站点连哪一个合约**，被缓存住的后果是
   换了合约之后用户还连着旧的，而且报出来的是"未部署"这种看不出根因的错 ——
   踩过一次：Cloudflare 给 .js 默认 max-age=14400，市场页整整四小时读的是旧地址。
   只靠 nginx 发 no-cache 不够稳（边缘节点、公司代理、Service Worker 都可能不听），
   所以这里把内容指纹拼进 URL：内容变了 URL 就变，任何一层缓存都不可能命中旧的。 */
/* 所有被 HTML 外链的静态资源都打内容指纹 —— nav.js 踩过和 config.js 同一个坑：
   Cloudflare 默认给 .js/.css 缓 4 小时，站点改版后旧 nav.js 还在边缘节点上活着，
   「模拟器」页签就指着旧地址把人弹回首页。指纹进 URL 之后任何一层缓存都不可能命中旧的。 */
const FP = {};
['nav.js', 'tokens.css', 'doc.css', 'wallet.js', 'bnb-chain.js', 'i18n.js', 'i18n-planets.js',
 'i18n-app.js', 'i18n-mirror.js', 'i18n-tools.js', 'i18n-site.js', 'i18n-market.js', 'i18n-btc.js', 'i18n-btc-site.js', 'btc-theme.css',
 'i18n-arc.js', 'i18n-arc-site.js', 'arc-doc.css', 'keccak-lite.js']
  .forEach((f) => {
    const fp = path.join(__dirname, f);
    if (fs.existsSync(fp)) FP[f] = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 10);
  });
{
  const tj = path.join(__dirname, '../ui/theme.js');
  if (fs.existsSync(tj)) FP['theme.js'] = crypto.createHash('sha256').update(fs.readFileSync(tj)).digest('hex').slice(0, 10);
}
function stampAssets(h) {
  for (const f of Object.keys(FP)) {
    const re = new RegExp('((?:src|href)=")' + f.replace(/\./g, '\\.') + '(?:\\?v=[0-9a-f]+)?(")', 'g');
    h = h.replace(re, '$1' + f + '?v=' + FP[f] + '$2');
  }
  return h;
}
const cfgSrc = fs.readFileSync(path.join(__dirname, ST.config), 'utf8');
const cfgVer = crypto.createHash('sha256').update(cfgSrc).digest('hex').slice(0, 10);

/* app.html 的站内改写（btc 才有）：btc-theme.css 插在 </head> 前 —— 底稿里 tokens.css 已被 build.js
   内联成 <style>，没有 <link> 可跟，排在 head 末尾同样在它之后。 */
if (THEME_LINK) {
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) { console.error('底稿里没有 </head>'); process.exit(1); }
  html = html.slice(0, headEnd) + stampAssets(THEME_LINK) + '\n' + html.slice(headEnd);
}
/* 模拟器整包搬去 app.html —— index.html 的位置让给首页（web/landing.html）。 */
const out = path.join(outDir, 'app.html');
/* ARCBANG：离线底稿里那点站点字样（页脚联系邮箱）在这里换掉。
   改写表在 web/arc-patch.js —— 那里就是「arc 和主线差在哪」的全部说明。 */
if (SITE === 'arc') html = require('./arc-patch.js')('app.html', html);
fs.writeFileSync(out, html);

/* 独立页的站内改写（btc 才动；bnb 一律原样返回）：
     1. <head> 里 <title> / <meta> / <link> 的 https://bnbbang.com/ → 本站，BNBBANG → BTCBANG
        （只碰这三种标签的属性与标题文本，脚本里的 BNBBANG_CONFIG 之类一个字不动；
        别人写的 *-btc.html 里本来就没有主站地址，这一步对它们是空操作）；
     2. <meta charset> 之后打 window.BNBBANG_SITE="btc" 那一行（已有就不重复）；
     3. tokens.css 的 <link> 之后插 btc-theme.css（没有 tokens.css 的页插在 </head> 前；已有就不重复）；
     4. 最后一个 i18n-*.js 之后插 i18n-btc.js（页面没有 i18n 就不插；已有就不重复）。 */
function siteify(h) {
  if (!IS_ALT) return h;
  const headAt = h.indexOf('<head');
  const headEnd = h.indexOf('</head>');
  if (headAt < 0 || headEnd < 0) return h;
  let head = h.slice(headAt, headEnd);
  /* ld+json 里的域名与站名也要换：市场页等静态页的结构化数据写的是 bnbbang.com */
  head = head.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, (s) =>
    s.replace(/https:\/\/bnbbang\.com\//g, ST.base + '/').replace(/BNBBANG(?![_A-Za-z0-9])/g, ST.name));
  head = head.replace(/<title>[^<]*<\/title>|<(?:meta|link)\b[^>]*>/g, (tag) =>
    tag.replace(/https:\/\/bnbbang\.com\//g, ST.base + '/').replace(/BNBBANG(?![_A-Za-z0-9])/g, ST.name)
       .replace(/\/assets\/og\/home\.jpg/g, OG_IMG));
  if (head.indexOf('BNBBANG_SITE=') < 0) {
    const cs = head.match(/<meta charset="[^"]*">/);
    if (cs) head = head.replace(cs[0], cs[0] + '\n' + SITE_STAMP.replace(/\n$/, ''));
    else head = head.replace(/<head[^>]*>/, (m) => m + '\n' + SITE_STAMP.replace(/\n$/, ''));
  }
  if (THEME_LINK && head.indexOf(ST.theme) < 0) {
    const tk = head.match(/<link rel="stylesheet" href="tokens\.css(?:\?v=[0-9a-f]+)?">/);
    if (tk) head = head.replace(tk[0], tk[0] + '\n' + THEME_LINK);
    else head += THEME_LINK + '\n';
  }
  if (ST.dict && head.indexOf(ST.dict) < 0) {
    const re = /<script src="i18n(?:-[a-z]+)?\.js(?:\?v=[0-9a-f]+)?"><\/script>/g;
    let last = null, m;
    while ((m = re.exec(head)) !== null) last = m;
    if (last) head = head.slice(0, last.index + last[0].length) + '\n<script src="' + ST.dict + '"></script>' + head.slice(last.index + last[0].length);
  }
  return h.slice(0, headAt) + head + h.slice(headEnd);
}

// 独立 HTML（不进单文件包；含部署页——裸拷会漏掉 config.js?v= 指纹，换合约后向导读到旧 config）
ST.pages.forEach(([srcF, dstF]) => {
  const extra = path.join(__dirname, srcF);
  const dst = dstF || srcF;
  if (!fs.existsSync(extra)) { if (IS_ALT) console.log('  ○ ' + srcF + '（缺席，跳过）'); return; }
  // 给 config.js 的引用打上指纹；已经带了 ?v= 的不重复加
  let h = fs.readFileSync(extra, 'utf8');
  const before = h;
  h = h.replace(/(<script[^>]*\ssrc=")config\.js(?:\?v=[0-9a-f]+)?(")/g,
                '$1config.js?v=' + cfgVer + '$2');
  /* 源码里引 ../ui/theme.js 是为了本地开发直接用仓库那份；
     线上是扁平目录，../ 会逃出网站根变成 404，主题会闪白。落盘时改写成同目录。 */
  h = h.replace(/src="\.\.\/ui\/theme\.js"/g, 'src="theme.js"');
  /* ARCBANG：market / status / profile 三页与 bnb 共用源文件，
     「没有代币」那套差异全部收在 web/arc-patch.js 里，在 siteify 之前落到这里。 */
  if (SITE === 'arc') h = require('./arc-patch.js')(dst, h);
  h = siteify(h);
  h = stampAssets(h);
  /* 经济页也出 /en/（2026-09-09，用户经另一会话转交）：中文版 head 补三条 hreflang，
     英文版由 prerender-en 落到 en/economy.html。market 页静态文案词典几乎覆盖不到（实测 636 → 624），不做；
     faq / how-it-works / verify 本来就是英文页（specs/seo-v1.md §三）。x-default 与首页口径一致指英文。 */
  if (dst === 'economy.html') {
    const base = String(ST.base || 'https://bnbbang.com').replace(/\/+$/, '');
    const alt = '<link rel="alternate" hreflang="zh-CN" href="' + base + '/economy.html">\n'
      + '<link rel="alternate" hreflang="en" href="' + base + '/en/economy.html">\n'
      + '<link rel="alternate" hreflang="x-default" href="' + base + '/en/economy.html">\n';
    const zh = h.replace(/(<link rel="canonical" href="[^"]*">\n)/, '$1' + alt);
    if (zh === h) console.log('  ! ' + srcF + '：没找到 canonical，hreflang 没加');
    h = zh;
    const EN_ECON = IS_BTC
      ? { title: 'BTCBANG economics: no new coin, one magazine, two fuses · BTCBANG',
          desc: 'BTCBANG issues no new token: it mints into the same BNBBANG NFT contract and pays the same BANG (1,000,000,000 cap, zero premine). Both sites share the 1,707,000 cap and the free allowance; Bitcoin blocks mint after 6 confirmations; badges do not change the physics; the launch fund would come from the Promo treasury — pending decision, not a contract guarantee.' }
      : { title: 'BANG tokenomics: zero premine, four pools, burn mechanics · BNBBANG',
          desc: 'BANG is a BEP-20 with a 1,000,000,000 cap and zero premine: 600M mint rewards only the NFT contract can issue, 200M referral rewards, 100M team vesting linearly over 24 months, 100M exchange listing fees. Rescues, crafting and naming all burn BANG.' };
    const en = require('./prerender-en.js').build(h, outDir, {
      base, page: 'economy.html', title: EN_ECON.title, desc: EN_ECON.desc,
      dicts: IS_BTC ? ['i18n-btc.js', 'i18n-btc-site.js'] : undefined
    });
    console.log('  + ' + srcF + ' → ' + ST.dist + '/en/economy.html（英文预渲染：词典 ' + en.dict + ' 条，命中 ' + en.hits + ' 处）');
  }
  fs.writeFileSync(path.join(outDir, dst), h);
  console.log('  + ' + srcF + ' → ' + ST.dist + '/' + (dst !== srcF ? dst : '') + (h !== before ? '（config.js?v=' + cfgVer + '）' : ''));
});
/* 三份文档的「另一种语言」那一份，落进子目录：
     · bnb / btc：英文在根路径，中文版源文件 *.zh.html（btc 站 *-btc.zh.html）落到 dist/zh/<页名>.html
       （2026-09-09 用户拍板）；
     · arc：方向相反 —— 中文在根路径（走上面的 pages），英文版源文件 *-arc.en.html 落到 dist-arc/en/<页名>.html
       （SITES.arc.enPages，2026-09-17）。
   两个方向共用这一段：处理与独立页相同（config 指纹 / theme.js 路径 / siteify / 资源指纹），
   再把相对地址改成根绝对（子目录里相对地址会指错），复用 prerender-en 的 absolutize()。
   目录按落盘名自己的父目录建（zh/ 或 en/），缺席只打印跳过。 */
{
  const ZH_PAGES = ST.zhPages ? ST.zhPages : IS_BTC
    ? [['how-it-works-btc.zh.html', 'zh/how-it-works.html'], ['faq-btc.zh.html', 'zh/faq.html'], ['verify-btc.zh.html', 'zh/verify.html']]
    : [['how-it-works.zh.html', 'zh/how-it-works.html'], ['faq.zh.html', 'zh/faq.html'], ['verify.zh.html', 'zh/verify.html']];
  const SUB_PAGES = ZH_PAGES.map((p) => [p[0], p[1], '中文版'])
    .concat((ST.enPages || []).map((p) => [p[0], p[1], '英文版']));
  const { absolutize } = require('./prerender-en.js');
  SUB_PAGES.forEach(([srcF, dstF, tag]) => {
    const extra = path.join(__dirname, srcF);
    if (!fs.existsSync(extra)) { console.log('  ○ ' + srcF + '（缺席，跳过）'); return; }
    let h = fs.readFileSync(extra, 'utf8');
    h = h.replace(/(<script[^>]*\ssrc=")config\.js(?:\?v=[0-9a-f]+)?(")/g, '$1config.js?v=' + cfgVer + '$2');
    h = h.replace(/src="\.\.\/ui\/theme\.js"/g, 'src="theme.js"');
    if (SITE === 'arc') h = require('./arc-patch.js')(dstF, h);
    h = siteify(h);
    h = stampAssets(h);
    h = absolutize(h);
    fs.mkdirSync(path.dirname(path.join(outDir, dstF)), { recursive: true });
    fs.writeFileSync(path.join(outDir, dstF), h);
    console.log('  + ' + srcF + ' → ' + ST.dist + '/' + dstF + '（' + tag + '）');
  });
}
['doc.css', 'market.js', 'bnb-chain.js', 'config.js', 'i18n.js', 'wallet.js', 'tokens.css', 'nav.js', 'i18n-planets.js', 'i18n-app.js', 'i18n-mirror.js', 'i18n-tools.js', 'i18n-site.js', 'i18n-market.js'].concat(ST.extraAssets).forEach((f) => {
  /* config.js：btc 站落盘的是 config.btc.js 的内容（名字仍叫 config.js —— 各页引的就是它） */
  const extra = path.join(__dirname, f === 'config.js' ? ST.config : f);
  if (!fs.existsSync(extra)) return;
  /* ARCBANG：外链出去的 .js / .css 也要过一遍改写表 —— 词典里有写死的代码仓库地址
     （i18n-app.js / i18n-site.js 那句「推导代码开源，可以自己算：…」），
     裸拷过去就等于在 arc 站上挂一个 bnbbang 仓库的链接。bnb / btc 仍然是裸拷。
     指纹 ?v= 按**源文件**算（上面的 FP），改写只动内容不动那个值：它是缓存串号，
     不是完整性校验，串号只要"源文件变了就变"就够用。 */
  if (SITE === 'arc' && /\.(js|css)$/.test(f)) {
    fs.writeFileSync(path.join(outDir, f), require('./arc-patch.js')(f, fs.readFileSync(extra, 'utf8')));
  } else fs.copyFileSync(extra, path.join(outDir, f));
  console.log('  + ' + (f === 'config.js' ? ST.config : f) + ' → ' + ST.dist + '/' + (f === 'config.js' && ST.config !== f ? f : ''));
});
/* 部署页要用的字节码。
   BangToken / MirrorUniverse 是当前这一套（构造函数都无参，页面直接把字节码当 data 发）。
   v5 是六合约一套：市场把 BANG 地址存成 immutable —— 换 BangToken 必须连市场一起重发，
   「市场不用跟着重部署」的老话不再成立。BangNames/BangVesting/BangPromo 的构造参数由部署页拼。
   **MirrorResources 已经去掉** —— 资源那套被 BANG 代币取代（specs/economy-v4.md），
   market.html 里只剩一句说明它被移除的注释，没有任何代码消费这份字节码。
   继续发上去是 27 KB 死重，而且摆在公网上有人捡去部署一个废弃合约反而是麻烦。
   缺哪个就跳过哪个 —— 少一份字节码只是那一步得手动粘贴，不该让整个构建挂掉。 */
/* SEO 静态文件（specs/seo-v1.md）：robots / sitemap / manifest / IndexNow 密钥文件原样直通；
   assets/og（社交预览图）与 assets/icons（图标）整目录拷贝。这些文件不打指纹：
   robots 与 sitemap 的地址是固定的（搜索引擎按固定地址取），图标一年也换不了一次。
   btc 站用 -btc 版本（内容只差域名与站名），落盘时去掉 -btc；bnb 的循环要把 -btc 那几份排除掉。 */
Object.keys(ST.seo).forEach((f) => {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) { console.log('  ○ ' + f + '（缺席，跳过）'); return; }
  fs.copyFileSync(p, path.join(outDir, ST.seo[f]));
  console.log('  + ' + f + ' → ' + ST.dist + '/' + (ST.seo[f] !== f ? ST.seo[f] : ''));
});
fs.readdirSync(__dirname).forEach((f) => {
  /* IndexNow 密钥文件：按域名验证，两站各放一份同名文件即可（密钥文件内容就是密钥本身） */
  if (/^[0-9a-f]{32}\.txt$/.test(f)) {
    fs.copyFileSync(path.join(__dirname, f), path.join(outDir, f));
    console.log('  + ' + f + ' → ' + ST.dist + '/');
  }
});
/* 图标目录按站点可换（SITES.*.icons），产物里的路径不变（仍是 assets/icons/）。 */
['og', 'icons'].forEach((sub) => {
  const src = path.join(__dirname, 'assets', sub === 'icons' && ST.icons ? ST.icons : sub);
  if (!fs.existsSync(src)) return;
  const dst = path.join(outDir, 'assets', sub);
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  fs.readdirSync(src).forEach((f) => { if (fs.statSync(path.join(src, f)).isFile()) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; } });
  console.log('  + assets/' + sub + '/ → ' + ST.dist + '/assets/' + sub + '/（' + n + ' 个文件）');
});

/* 首页图廊（web/assets/gallery/）：模拟器实况截图 + index.json（每张的区块号 / 哈希 / 结局 / 视图）。
   整目录原样拷进 dist/assets/gallery/ —— 文件清单是写死的，新目录不进这里就永远上不了线
   （scp -r web/dist/. 会连子目录一起推，tools/deploy-site.sh 的「文件齐全」也查它）。
   HTML 里对图片的每一处引用（src / srcset / data-full）都打内容指纹 ?v=：理由同 config.js，
   Cloudflare 对图片默认缓得更久，换了图旧图还在边缘节点上活着。 */
const GAL_SRC = path.join(__dirname, 'assets', 'gallery');
const GAL_FP = {};
if (fs.existsSync(GAL_SRC)) {
  const galOut = path.join(outDir, 'assets', 'gallery');
  fs.mkdirSync(galOut, { recursive: true });
  let n = 0;
  fs.readdirSync(GAL_SRC).forEach((f) => {
    const src = path.join(GAL_SRC, f);
    if (!fs.statSync(src).isFile()) return;
    const buf = fs.readFileSync(src);
    fs.copyFileSync(src, path.join(galOut, f));
    GAL_FP[f] = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
    n++;
  });
  console.log('  + assets/gallery/ → ' + ST.dist + '/assets/gallery/（' + n + ' 个文件，引用打指纹）');
}
function stampGallery(h) {
  // 只改有指纹记录的文件名；已经带 ?v= 的重打，不叠两层
  return h.replace(/assets\/gallery\/([A-Za-z0-9._-]+)(\?v=[0-9a-f]+)?/g, (m, f) => GAL_FP[f] ? 'assets/gallery/' + f + '?v=' + GAL_FP[f] : m);
}

/* 首页：web/landing.html（btc：web/landing-btc.html）落盘成 dist/index.html。
   两个落盘改写与其他 HTML 一致：config.js 打指纹、../ui/theme.js 收成同目录。 */
const landing = path.join(__dirname, ST.landing);
if (fs.existsSync(landing)) {
  let h = fs.readFileSync(landing, 'utf8');
  h = h.replace(/(<script[^>]*\ssrc=")config\.js(?:\?v=[0-9a-f]+)?(")/g, '$1config.js?v=' + cfgVer + '$2');
  h = h.replace(/src="\.\.\/ui\/theme\.js"/g, 'src="theme.js"');
  /* ARCBANG 首页只过代码仓库那张改写表，**不走整个 arc-patch** ——
     首页是 arc 自己的源文件（landing-arc.html），里面没有要删的代币段落；
     整套 arcPatch 还会剥掉 <nav class="sitefriends">，那是给三张共用页定的规矩，
     首页挂不挂友链是首页自己的事，这里不替它决定。 */
  if (SITE === 'arc') h = require('./arc-patch.js').repoify(h);
  h = siteify(h);
  h = stampAssets(h);
  h = stampGallery(h);
  fs.writeFileSync(path.join(outDir, 'index.html'), h);
  console.log('  + ' + ST.landing + ' → ' + ST.dist + '/index.html（首页）');
  /* 英文版首页：/en/index.html（web/prerender-en.js）。词典漏翻自动退回中文，构建不会因此失败。
     btc：域名 / 标题 / 描述 / 词典（多一册 i18n-btc.js）按站传；bnb 不传参，与从前逐字节相同。 */
  const en = ST.en
    ? require('./prerender-en.js').build(h, outDir, { base: ST.base, title: ST.en.title, desc: ST.en.desc, dicts: ST.enDicts || ['i18n-btc.js', 'i18n-btc-site.js'] })
    : require('./prerender-en.js').build(h, outDir);
  console.log('  + ' + ST.landing + ' → ' + ST.dist + '/en/index.html（英文预渲染：词典 ' + en.dict + ' 条，命中 ' + en.hits + ' 处）');
  /* 站点有 enPages（arc：英文文档落在 /en/）时，英文首页指向文档的链接也要进 /en/ ——
     prerender-en 把相对链接绝对化成 /how-it-works.html，那是中文页。只改这三页，别的链接不动。 */
  if (ST.enPages && ST.enPages.length) {
    const enIdx = path.join(outDir, 'en', 'index.html');
    let eh = fs.readFileSync(enIdx, 'utf8'), n = 0;
    ST.enPages.forEach((p) => {
      const root = '/' + p[1].replace(/^en\//, '');
      eh = eh.replace(new RegExp('href="' + root.replace(/[.]/g, '\.') + '(["#?])', 'g'), (m, tail) => { n++; return 'href="/' + p[1] + tail; });
    });
    fs.writeFileSync(enIdx, eh);
    console.log('  + en/index.html：文档链接改指 /en/（' + n + ' 处）');
  }
} else if (IS_ALT) {
  console.log('  ○ ' + ST.landing + '（缺席，跳过：没有首页也没有 /en/）');
}

const themeSrc = path.join(__dirname, '../ui/theme.js');
if (fs.existsSync(themeSrc)) { fs.copyFileSync(themeSrc, path.join(outDir, 'theme.js')); console.log('  + ui/theme.js → ' + ST.dist + '/theme.js'); }

/* 字节码只有主站要（部署页）。BTCBANG 不部署合约、不发字节码（specs/btcbang-v1.md §三）。 */
if (ST.bytecode) {
  ['BangToken', 'MirrorUniverse', 'MirrorMarket', 'BangNames', 'BangVesting', 'BangPromo', 'MirrorCrafted', 'BangNames2'].forEach((name) => {
    const f = path.join(ROOT, 'contracts/out/' + name + '.bytecode.hex');
    if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(outDir, name + '.bytecode.hex')); console.log('  + ' + name + '.bytecode.hex → dist/'); }
  });

  const bc = path.join(ROOT, 'contracts/out/bytecode.hex');
  if (fs.existsSync(bc)) {
    fs.copyFileSync(bc, path.join(outDir, 'bytecode.hex'));
    console.log('  + contracts/out/bytecode.hex → dist/（部署页要用）');
  } else {
    console.log('  ! contracts/out/bytecode.hex 不在——部署页要靠手动粘贴字节码（先在 contracts/ 跑 npm run build）');
  }
}

/* ARCBANG 的构件（SITES.arc.artifacts）：部署向导 deploy.html 在浏览器里 fetch 同目录的
   <名>.bytecode.hex。取不到时向导退回 ../contracts/out/（本地直开）再退回手工粘贴，
   所以这里缺哪个只打印跳过，不让整个构建挂掉 —— 先在 contracts/ 跑 npm run build 再来。
   与上面 ST.bytecode 那一段互不相干：那是 BNBBANG 六合约一套，arc 站 bytecode 仍是 false。 */
if (ST.artifacts) {
  ST.artifacts.forEach((name) => {
    ['.bytecode.hex', '.abi.json'].forEach((ext) => {
      const f = path.join(ROOT, 'contracts/out/' + name + ext);
      if (fs.existsSync(f)) {
        fs.copyFileSync(f, path.join(outDir, name + ext));
        console.log('  + ' + name + ext + ' → ' + ST.dist + '/（部署向导要用）');
      } else {
        console.log('  ! contracts/out/' + name + ext + ' 不在——部署向导那一份要手工粘贴');
      }
    });
  });
}

console.log('\n站点版写入完成：' + path.relative(ROOT, out).replace(/\\/g, '/') + '  ' + kb(html) + (IS_ALT ? '（' + ST.name + ' · ' + ST.base + '）' : ''));
console.log('底稿：' + srcName);
console.log('提醒：站点版会向 config.js 里的公开 RPC 发请求——这是有意的，' + srcName + ' 仍然零外部请求。');

/* ---------------- 新站规矩：只浅色（2026-09-08 用户定，记忆 websites-light-theme-only）----------------
   btc 产物里每个 HTML 的 <head> 首行打 window.MIRROR_LIGHT_ONLY=true：ui/theme.js 见到它就一律 light，
   不读记忆、不跟随系统；nav.js 设置浮层的主题行由 btc-theme.css 藏掉。放在 <head> 最前面是因为
   theme.js 在文档头部同步执行，标记必须比它先到。bnb 站不打，行为不变。 */
if (ST.lightOnly) {
  const LIGHT_STAMP = '<script>window.MIRROR_LIGHT_ONLY=true</script>';
  const walk = (dir) => fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'assets') walk(p); return; }
    if (!/\.html$/.test(f)) return;
    let h = fs.readFileSync(p, 'utf8');
    /* 要认的是标记本身，不是这个名字：app.html 把 ui/theme.js 整个内联进去了，代码里就有这个词。
       第一版用名字判，app.html 因此被跳过 —— 模拟器页在深色系统上仍会变黑。 */
    if (h.indexOf(LIGHT_STAMP) >= 0) return;
    const h2 = h.replace(/<head[^>]*>/, (m) => m + '\n' + LIGHT_STAMP);
    if (h2 !== h) fs.writeFileSync(p, h2);
  });
  walk(outDir);
  console.log('  + ' + SITE + ' 产物全部 HTML：<head> 首行打 MIRROR_LIGHT_ONLY（只浅色）');
}
