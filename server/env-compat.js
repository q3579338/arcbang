/*
 * server/env-compat.js —— 环境变量旧名兼容层
 * ------------------------------------------------------------
 * 正名是 ARCBANG_*。本仓库是从一个三站共用的单体仓库导出的，那边的变量名一律是
 * BNBBANG_*，线上 /etc/bnbbang/api.arc.env 里写的也还是旧名 —— 改名不能让正在跑的
 * 实例在下一次重启时突然读不到配置。
 *
 * 规矩只有一条：**新名优先**。
 *   · 只配了 ARCBANG_X    → 用它；
 *   · 只配了 BNBBANG_X    → 复制成 ARCBANG_X，照旧能跑；
 *   · 两个都配了          → 以 ARCBANG_X 为准，旧的不看（迁移期间避免两头改一头忘）。
 *
 * 复制而不是"读的时候两边都试"：这样服务端其余文件里只剩一个名字，
 * 不会出现某个模块记得退回旧名、另一个忘了的分裂。
 *
 * **必须在任何模块读 env 之前跑** —— 多数模块在自己的顶层就把 env 读进常量了。
 * 所以三个入口（server/index.js、server/selftest.js、tools/dev-api.js）
 * 都把它 require 在第一行，require 本身就会完成复制（下面那句立即执行）。
 */
'use strict';

const OLD = 'BNBBANG_';
const NEW = 'ARCBANG_';

/** 把 BNBBANG_* 复制成同名的 ARCBANG_*（新名已存在就跳过）。返回复制了哪些。 */
function adopt(env) {
  const e = env || process.env;
  const moved = [];
  for (const k of Object.keys(e)) {
    if (k.indexOf(OLD) !== 0) continue;
    const nk = NEW + k.slice(OLD.length);
    if (e[nk] === undefined) { e[nk] = e[k]; moved.push(k + ' → ' + nk); }
  }
  return moved;
}

/* require 的那一刻就生效 —— 调用方不用记得再调一次 */
const adopted = adopt();

module.exports = { adopt, adopted, OLD, NEW };
