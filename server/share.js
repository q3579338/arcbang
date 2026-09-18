/*
 * 分享落地页的公共小件 —— /s/<区块号>
 * ------------------------------------------------------------
 * 第一版落地页是「爬虫拿 og，人拿跳转」：
 * 极小 HTML + meta refresh 立刻跳去 app.html?bang=。它解决了 SPA 里 og 标签是死的问题，
 * 代价是搜索引擎一个字都索引不到 —— 跳转页在它眼里是空的。
 * 现在 /s/ 是一张**可索引的真页面**，页面本体在 landing.js，索引口径与 sitemap 在 seo.js，
 * 1200×630 的 og 图在 og.js。这里只留三件公用的小工具：
 *   esc          HTML 转义
 *   grp          千分位
 *   carryQuery   把落地页的 ?ref= 等 query 白名单过滤后带去 app.html
 *
 * 方案 B（nginx 按 UA 分流爬虫）仍然明确不做：UA 名单永远追不全，而且同一个 URL
 * 对不同人返回不同内容，出了问题连复现都难。真页面对爬虫和人是同一份。
 *
 * ---- 三条纪律（landing.js 与 index.js 的 /s/ 路由继续遵守）----
 * 1. **绝不报错页**：区块号查不到 → 跳首页；链上问不到（RPC 抽风）→ 照样给页面，
 *    结局写"还没算"，按钮照样指向 app.html。分享链接落地成一个 500 页面是最糟的结果。
 * 2. **不阻塞主流程**：这条路只读 card 缓存、链上取块、内存里的市场索引，
 *    一个字节都不经过铸造/干预/市场的写路径。
 * 3. **降级要诚实**：拿不到 card 时不写结局、不猜结局；铸造状态查不到就说"查不到"，
 *    不把"我还没查到"说成"没铸过"。
 */
'use strict';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 千分位。和 art.js 同一个理由：不用 toLocaleString，它跟着系统区域设置走 */
function grp(n) {
  const t = String(Math.round(Number(n))), out = [];
  for (let i = t.length; i > 0; i -= 3) out.unshift(t.slice(Math.max(0, i - 3), i));
  return out.join(',');
}

/**
 * 把落地页的 query 原样带到 app.html 去（?ref= 是重点：推广留痕全靠它）。
 * **必须过一遍白名单**：这段字符串会进 HTML 属性，而它完全来自请求方。
 * 键值都限死字符集 + 长度，再各自 encodeURIComponent。
 */
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/;
const SAFE_VAL = /^[a-zA-Z0-9_.:-]{0,80}$/;
function carryQuery(searchParams) {
  const out = [];
  if (!searchParams) return '';
  for (const [k, v] of searchParams) {
    if (k === 'bang') continue;                 // bang 由我们自己写，不许被覆盖
    if (!SAFE_KEY.test(k) || !SAFE_VAL.test(v)) continue;
    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    if (out.length >= 6) break;                 // 谁也不需要六个以上的参数
  }
  return out.join('&');
}

module.exports = { carryQuery, esc, grp };
