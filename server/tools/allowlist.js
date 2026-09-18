#!/usr/bin/env node
/*
 * 白名单命令行 —— 审核之后动名单的唯一入口
 * ============================================================================
 * 接口里**没有任何一条路**能写 allowlist.json：登记接口只往流水里追加，
 * 管理员看完 X 上的评论，在这里 approve。名额是钱，发名额这件事不该有自动路径。
 *
 * 用法（在仓库根或 server/ 下都行）：
 *   node server/tools/allowlist.js status
 *   node server/tools/allowlist.js applied [--csv] [--pending]
 *   node server/tools/allowlist.js approve <登记码|地址> [--tier=gtd]
 *   node server/tools/allowlist.js add <地址…> [--tier=gtd] [--src=手工]
 *   node server/tools/allowlist.js remove <地址…>
 *   node server/tools/allowlist.js tier <地址> gtd|fcfs        ← 钉死，不再自动升降
 *   node server/tools/allowlist.js import <文件.csv>           ← 第一列当地址，其余列忽略
 *   node server/tools/allowlist.js list [--tier=gtd]
 *   node server/tools/allowlist.js code <地址>                 ← 从地址现算登记码
 *   node server/tools/allowlist.js rank [--top=50]
 *
 * 名单目录跟服务端同一份：ARCBANG_STORE（默认 server/.store）。
 * **登记码是从地址 + ARCBANG_ALLOWLIST_SALT 算出来的**，所以跑这个工具时
 * 那个盐必须和线上一致，否则 approve <码> 找不到人。
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('../env-compat.js');

const STORE_DIR = process.env.ARCBANG_STORE || path.join(__dirname, '..', '.store');
const AL = require('../allowlist.js').create({ storeDir: STORE_DIR });

const argv = process.argv.slice(2);
const cmd = (argv.shift() || '').toLowerCase();
const flags = {};
const args = [];
for (const a of argv) {
  const m = /^--([a-z0-9-]+)(?:=(.*))?$/i.exec(a);
  if (m) flags[m[1].toLowerCase()] = m[2] === undefined ? true : m[2];
  else args.push(a);
}

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('用法')[1].replace(/^\S*\n/, '').replace(/^ \* ?/gm, ''));
}

function main() {
  switch (cmd) {
    case 'status': {
      const c = AL.counts();
      console.log('阶段      ' + AL.phase());
      const o = AL.opens();
      console.log('开放时间  保底 ' + (o.gtd || '待定') + ' · 先到先得 ' + (o.fcfs || '待定') + ' · 公售 ' + (o.public || '待定'));
      console.log('下一段    ' + JSON.stringify(AL.nextOpen()));
      console.log('名单      gtd ' + c.gtd + ' · fcfs ' + c.fcfs + ' · 合计 ' + c.total);
      console.log('登记      ' + AL.appliedCount() + ' 条（未进名单的见 applied --pending）');
      console.log('自动升 gtd 的有效邀请门槛  ' + AL.gtdInvites());
      console.log('置顶推    ' + (AL.pinnedPost() || '（没配 ARCBANG_PINNED_POST_URL）'));
      console.log('名单文件  ' + AL.listFile);
      console.log('登记流水  ' + AL.appliedFile);
      break;
    }
    case 'applied': {
      let rows = AL.appliedRows();
      if (flags.pending) rows = rows.filter((r) => !r.listed);
      if (flags.csv) { process.stdout.write(AL.appliedCsv()); break; }
      if (!rows.length) { console.log('（没有登记记录）'); break; }
      rows.sort((a, b) => (b.validInvites - a.validInvites) || (String(a.at) < String(b.at) ? -1 : 1));
      for (const r of rows) {
        console.log([r.code, r.addr, '@' + (r.x || '?'),
          '邀请 ' + r.validInvites + '/' + r.invites,
          r.ref ? '来自 ' + r.ref : '',
          r.listed ? '已入名单(' + r.tier + ')' : '待审',
          r.ip || '', r.at || ''].filter(Boolean).join('  '));
      }
      console.log('— 共 ' + rows.length + ' 条 —');
      break;
    }
    case 'approve': {
      if (!args.length) die('要给一个登记码或地址');
      let okN = 0;
      for (const t of args) {
        const r = AL.approve(t, flags.tier);
        if (!r.ok) { console.log('✗ ' + t + '：' + r.error); continue; }
        okN++;
        console.log((r.already ? '○ ' : '✓ ') + r.code + ' ' + r.addr + (r.x ? ' @' + r.x : '') + (r.already ? '（早就在名单里）' : ' 已进名单'));
      }
      console.log('— ' + okN + '/' + args.length + ' —');
      break;
    }
    case 'add': {
      if (!args.length) die('要给至少一个地址');
      const r = AL.addAddresses(args, flags.tier, flags.src || '手工', flags.lock === true || flags.tier === 'gtd');
      console.log('✓ 新增 ' + r.added + '，升层 ' + r.upgraded + '，已有 ' + r.skipped
        + (r.bad.length ? '，看不懂的 ' + r.bad.length + ' 个：' + r.bad.slice(0, 5).join(' ') : ''));
      break;
    }
    case 'remove': {
      if (!args.length) die('要给至少一个地址');
      const r = AL.removeAddresses(args);
      console.log('✓ 移除 ' + r.removed + (r.bad.length ? '，看不懂的 ' + r.bad.length + ' 个' : ''));
      break;
    }
    case 'tier': {
      if (args.length < 2) die('用法：tier <地址> gtd|fcfs');
      const r = AL.setTier(args[0], args[1]);
      if (!r.ok) die(r.error);
      console.log('✓ ' + r.addr + ' 钉死在 ' + r.tier + '（不再随邀请数自动变）');
      break;
    }
    case 'import': {
      if (!args[0]) die('要给一个 CSV 文件');
      let text = '';
      try { text = fs.readFileSync(path.resolve(args[0]), 'utf8'); } catch (e) { die('读不出来：' + e.message); }
      /* 第一列当地址，其余列忽略；表头那一行自然会因为不是地址而被丢进 bad，不必特判。 */
      const addrs = text.split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter(Boolean);
      const r = AL.addAddresses(addrs, flags.tier, flags.src || path.basename(args[0]), flags.tier === 'gtd');
      console.log('✓ 新增 ' + r.added + '，升层 ' + r.upgraded + '，已有 ' + r.skipped
        + '，跳过 ' + r.bad.length + ' 行（表头和空行也算在这里）');
      break;
    }
    case 'list': {
      const want = flags.tier ? String(flags.tier).toLowerCase() : null;
      const rows = AL.rankTable().filter((r) => !want || AL.tierOf(r.addr) === want);
      for (const r of rows) console.log(AL.tierOf(r.addr) + '  ' + r.addr + '  ' + AL.codeOf(r.addr) + '  有效邀请 ' + r.validInvites);
      console.log('— 共 ' + rows.length + ' 个 —');
      break;
    }
    case 'code': {
      if (!args[0]) die('要给一个地址');
      const c = AL.codeOf(args[0]);
      if (!c) die('地址不合法');
      console.log(c);
      break;
    }
    case 'rank': {
      const top = Math.max(1, Math.min(Number(flags.top) || 50, 5000));
      const rows = AL.rankTable().slice(0, top);
      rows.forEach((r, i) => console.log(String(i + 1).padStart(4) + '  ' + r.addr + '  ' + AL.tierOf(r.addr)
        + '  有效邀请 ' + r.validInvites + '/' + r.invites + '  ' + (r.at === '9999' ? '(没登记过)' : r.at)));
      break;
    }
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
}

main();
