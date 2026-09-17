/*
 * 环境变量整数夹紧。Number('abc') 是 NaN，后续比较（n >= limit、running < n、
 * setInterval(fn, n)）会静默失效：限流被关掉、出图锁死、索引狂扫。
 * 空 / 非数字 → 默认值；越界夹到 [min, max]。
 */
'use strict';

function envInt(v, def, min, max) {
  const n = Math.floor(Number(v == null || v === '' ? def : v));
  if (!Number.isFinite(n)) return def;
  let x = n;
  if (min != null && x < min) x = min;
  if (max != null && x > max) x = max;
  return x;
}

module.exports = { envInt };
