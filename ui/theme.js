/*
 * ui/theme.js —— 浅色 / 深色主题开关（独立模块，ES5，不依赖 app.js）
 * ------------------------------------------------------------
 * 规则：
 *   1. localStorage['mirror.theme'] 为 'light' | 'dark' 时以它为准；
 *   2. 没有记忆时跟随系统 prefers-color-scheme（无系统偏好 → 浅色）；
 *   3. 主题写成根元素（html）的 data-theme 属性，CSS 用 :root[data-theme="dark"] 与
 *      @media (prefers-color-scheme: dark) :root:not([data-theme="light"]) 两路覆盖。
 * 本文件在文档头部同步执行：首屏绘制前 data-theme 就已就位，不会闪白/闪黑。
 * **三个页面都引它**（index.html 直接引 ui/theme.js；web/market.html 与
 * 各独立页引 ../ui/theme.js，构建时被 web/build-web.js 改写成同目录的
 * theme.js）—— 这是全站唯一一份主题实现，别处不许再写第二套。
 *
 * 右下角那颗浮动小按钮 #themeToggle：**默认不再注入**。
 * 三个页面现在都用顶栏设置浮层里的三选一（浅色 / 深色 / 跟随系统），
 * 那颗按钮本来就被各页 CSS 的 #themeToggle{display:none} 盖掉了，注入了也看不见。
 * 元素、样式、点击/键盘监听一行都没删，只是改成由调用方决定：
 *   MirrorTheme.mountToggle()        注入到 #app（没有就 body）
 *   MirrorTheme.mountToggle(el)      注入到指定容器
 */
(function () {
  'use strict';

  var KEY = 'mirror.theme';
  var BTN_ID = 'themeToggle';
  var root = document.documentElement;

  function readStored() {
    try {
      var v = window.localStorage.getItem(KEY);
      return (v === 'light' || v === 'dark') ? v : null;
    } catch (e) { return null; }
  }
  function writeStored(t) {
    try { window.localStorage.setItem(KEY, t); } catch (e) { /* 隐私模式 / 沙箱：只在本次会话生效 */ }
  }
  function mql() {
    try { return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null; } catch (e) { return null; }
  }
  function systemTheme() {
    var m = mql();
    return (m && m.matches) ? 'dark' : 'light';
  }
  /* MIRROR_LIGHT_ONLY（build-web 在每个产物 HTML 的 <head> 首行打的标记）：一律浅色，
     不读记忆、不跟随系统 —— 用户 2026-09-08 定的规矩「新做的网站默认浅色，不要跟随系统深色」。 */
  function resolve() { if (window.MIRROR_LIGHT_ONLY) return 'light'; return readStored() || systemTheme(); }

  function paintButton(t) {
    var b = document.getElementById(BTN_ID);
    if (!b) return;
    var next = (t === 'dark') ? 'light' : 'dark';
    b.textContent = (next === 'dark') ? '深色' : '浅色';
    b.setAttribute('aria-label', '主题切换');
    b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    b.title = '当前' + (t === 'dark' ? '深色' : '浅色') + '主题，点击切换到' + (next === 'dark' ? '深色' : '浅色');
  }

  function apply(t) {
    if (t !== 'light' && t !== 'dark') t = 'light';
    root.setAttribute('data-theme', t);
    paintButton(t);
    return t;
  }

  // 首屏：立刻定主题（此时文档体还不存在，按钮稍后注入）
  apply(resolve());

  function setTheme(t) { writeStored(apply(t)); }
  function toggle() { setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }

  function injectButton(host) {
    if (document.getElementById(BTN_ID)) return;
    host = host || document.getElementById('app') || document.body;
    if (!host) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = BTN_ID;
    b.setAttribute('aria-label', '主题切换');
    b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); toggle(); });
    // 别让空格/回车冒泡到页面级快捷键
    b.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    host.appendChild(b);
    paintButton(root.getAttribute('data-theme') || 'light');
  }

  /* 注入改成可关：默认**不注入**（三页都走顶栏设置浮层里的三选一）。
     要那颗浮动按钮的调用方自己叫 MirrorTheme.mountToggle()；
     DOM 还没好时排到 DOMContentLoaded，调用方不用自己判断时机。 */
  function mountToggle(host) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { injectButton(host); });
    } else {
      injectButton(host);
    }
  }

  // 没有手动记忆时，跟随系统的实时变化
  var m = mql();
  if (m) {
    var onSys = function () { if (!readStored()) apply(systemTheme()); };
    if (m.addEventListener) m.addEventListener('change', onSys);
    else if (m.addListener) m.addListener(onSys);
  }

  /* 「跟随系统」是第三档，不是第三个主题：它意味着**没有手动记忆**，
     由 prefers-color-scheme 现场决定，而且系统切换时会跟着变（上面那个监听）。
     所以设置面板要区分两件事：
       get()  —— 现在实际是浅色还是深色（画面用）
       mode() —— 用户选的是哪一档（三个单选按钮用）
     只有 get() 的话，选了「跟随系统」而系统恰好是浅色时，
     面板会把高亮打在「浅色」上 —— 用户下次打开会以为自己选的是固定浅色。 */
  function mode() { return readStored() || 'system'; }
  function useSystem() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* 隐私模式：只在本次会话生效 */ }
    apply(systemTheme());
  }

  /* 别的标签页改了偏好，这一页跟着变（原来只有 economy.html 有这一条，
     收进来之后三页都有了）。手动记忆被清掉时退回跟随系统。 */
  window.addEventListener('storage', function (e) {
    if (e && e.key && e.key !== KEY) return;
    apply(resolve());
  });

  window.MirrorTheme = {
    get: function () { return root.getAttribute('data-theme') || 'light'; },
    mode: mode,
    set: function (t) { if (t === 'system') useSystem(); else setTheme(t); },
    toggle: toggle,
    clear: useSystem,
    /** 右下角那颗浮动按钮：默认不注入，要就自己叫一次 */
    mountToggle: mountToggle
  };
})();
