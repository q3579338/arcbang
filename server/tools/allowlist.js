#!/usr/bin/env node
/*
 * 白名单命令行 —— 核转发、看榜、定格名单
 * ============================================================================
 * 名单**是积分榜算出来的**，不是一个个批的（2026-09-18 用户拍板）。
 * 所以这里最常用的只有两条：
 *   verify  核对完 X 上的评论，给这个登记码打转发勾（+ARCBANG_PTS_REPOST 分）。**它不发名额。**
 *   freeze  进保底期之前把当下的榜定格写进 allowlist.json，之后名单不再随积分变。
 *
 * 用法（在仓库根或 server/ 下都行）：
 *   node server/tools/allowlist.js status
 *   node server/tools/allowlist.js board [--top=50]
 *   node server/tools/allowlist.js applied [--csv] [--unverified]
 *   node server/tools/allowlist.js verify <登记码|地址…>        ← 打转发勾（+分）
 *   node server/tools/allowlist.js unverify <登记码|地址…>      ← 核错了撤回
 *   node server/tools/allowlist.js who <登记码|地址>            ← 看某人的积分明细
 *   node server/tools/allowlist.js posts list                   ← 官方推文表（推文互动任务）
 *   node server/tools/allowlist.js posts add <推文URL> [--pts=20]  ← 官方发了新推就加一条
 *   node server/tools/allowlist.js posts remove <推文id|URL>
 *   node server/tools/allowlist.js setx <登记码|地址> <新X名>   ← **唯一**能改登记内容的路
 *   node server/tools/allowlist.js freeze                       ← **进 gtd 段前必跑**
 *   node server/tools/allowlist.js unfreeze                     ← 定格错了要重来
 *   node server/tools/allowlist.js add <地址…> [--tier=gtd]     ← 人工覆盖（永远赢）
 *   node server/tools/allowlist.js remove <地址…>
 *   node server/tools/allowlist.js tier <地址> gtd|fcfs
 *   node server/tools/allowlist.js import <文件.csv> [--tier=]  ← 第一列当地址
 *   node server/tools/allowlist.js list [--tier=gtd]
 *   node server/tools/allowlist.js code <地址>                  ← 从地址现算登记码
 *   node server/tools/allowlist.js seed 120 [--seed=20260919]  ← 造模拟登记（排练站用，确定性）
 *   node server/tools/allowlist.js unseed                      ← 只删模拟登记，真实用户不动
 *
 * 名单目录跟服务端同一份：ARCBANG_STORE（默认 server/.store）。
 * **登记码是从地址 + ARCBANG_ALLOWLIST_SALT 算出来的**，所以跑这个工具时
 * 那个盐必须和线上一致，否则 verify <码> 找不到人。
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('../env-compat.js');

const STORE_DIR = process.env.ARCBANG_STORE || path.join(__dirname, '..', '.store');
const ALX = require('../allowlist.js');
const AL = ALX.create({ storeDir: STORE_DIR });

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
  const head = fs.readFileSync(__filename, 'utf8').split('*/')[0];
  console.log(head.replace(/^#![^\n]*\n\/\*\n/, '').replace(/^ \* ?/gm, ''));
}
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function showOne(a) {
  const s = AL.scoreOf(a);
  if (!s.registered) { console.log('（' + a + ' 没有登记过）'); return; }
  const ap = AL.appliedOf(a);
  const P = AL.pointsTable();
  const T = AL.tops();
  console.log('地址      ' + a);
  console.log('登记码    ' + AL.codeOf(a) + '   X @' + (ap.x || '?'));
  console.log('名次      #' + (AL.rankOf(a) || '—') + '   层 ' + (AL.tierOf(a) || '不在名单'));
  console.log('积分      ' + s.total);
  console.log('  登记    ' + padL(s.pts.register, 4));
  console.log('  关注    ' + padL(s.pts.follow, 4) + (s.followed ? '   已核' : ''));
  console.log('  互动    ' + padL(s.pts.engage, 4) + '   ' + (s.engageDone || 0) + ' / ' + ((s.engageRows || []).length) + ' 条推文');
  for (const r of (s.engageRows || [])) {
    console.log('          ' + pad('#' + r.n + (r.pinned ? ' 置顶' : ''), 10)
      + pad(r.tweetId, 22) + padL(r.pts, 4) + ' 分  '
      + (r.like ? '赞' : '·') + (r.repost ? '转' : '·') + (r.comment ? '评' : '·')
      + (r.ok ? '  已完成' : ''));
  }
  console.log('  邀请    ' + padL(s.pts.invite, 4) + '   有效 ' + s.validInvites + '/' + s.invites
    + '（计 ' + s.countedInvites + '，上限 ' + P.inviteMax + '）');
  console.log('  分享    ' + padL(s.pts.share, 4) + '   ' + s.shareDays + ' 天（计 ' + s.countedShareDays + '，上限 ' + P.shareMaxDays + '）');
  console.log('离保底    还差 ' + AL.gapTo(a, T.gtd) + ' 分   离免费 还差 ' + AL.gapTo(a, T.free) + ' 分');
  console.log('下一步    ' + JSON.stringify(AL.nextStep(a)));
  if (ap.ref) console.log('来自邀请码 ' + ap.ref + '（' + (ap.inviter || '?') + '）');
}

function main() {
  switch (cmd) {
    case 'status': {
      const c = AL.counts();
      const P = AL.pointsTable();
      const T = AL.tops();
      console.log('阶段      ' + AL.phase() + (AL.isFrozen() ? '   名单已定格' : '   名单实时按榜算'));
      const o = AL.opens();
      console.log('开放时间  保底 ' + (o.gtd || '待定') + ' · 先到先得 ' + (o.fcfs || '待定') + ' · 公售 ' + (o.public || '待定'));
      console.log('下一段    ' + JSON.stringify(AL.nextOpen()));
      console.log('榜        ' + AL.board().rows.length + ' 人在榜（登记 ' + AL.appliedCount() + ' 条）');
      console.log('名额      前 ' + T.gtd + ' 名保底 · 前 ' + T.free + ' 名免费');
      console.log('名单      gtd ' + c.gtd + ' · fcfs ' + c.fcfs + ' · 合计 ' + c.total);
      console.log('分值      登记 ' + P.register + ' · 关注 ' + P.follow + ' · 互动置顶推 ' + P.engage
        + ' · 其他官方推 ' + P.engagePost + '/条 · 邀请 ' + P.invite + '/人（上限 ' + P.inviteMax
        + ' 人）· 分享 ' + P.share + '/天（上限 ' + P.shareMaxDays + ' 天）');
      console.log('置顶推    ' + (AL.pinnedPost() || '（没配 ARCBANG_PINNED_POST_URL）'));
      console.log('推文互动  ' + AL.engagePosts().length + ' 条（posts list 看详情）');
      console.log('名单文件  ' + AL.listFile);
      console.log('登记流水  ' + AL.appliedFile);
      console.log('状态文件  ' + AL.stateFile);
      if (!AL.isFrozen() && AL.phase() !== 'warmup') {
        console.log('\n!! 已经不在预热期，名单却还没定格 —— 名单会随积分实时变，跑一次 freeze');
      }
      break;
    }
    case 'board': {
      const top = Math.max(1, Math.min(Number(flags.top) || 50, 1000));
      const rows = AL.topRows(top);
      if (!rows.length) { console.log('（榜是空的）'); break; }
      for (const r of rows) {
        console.log(padL('#' + r.rank, 6) + '  ' + pad(r.addr, 16) + padL(r.points, 6) + ' 分  '
          + pad(r.tier || '—', 6) + (r.verified ? '已核转发' : ''));
      }
      console.log('— 前 ' + rows.length + ' / 共 ' + AL.board().rows.length + ' 人 —');
      break;
    }
    case 'applied': {
      if (flags.csv) { process.stdout.write(AL.appliedCsv()); break; }
      let rows = AL.appliedRows();
      if (flags.unverified) rows = rows.filter((r) => !r.verified);
      if (!rows.length) { console.log('（没有符合的登记记录）'); break; }
      rows.sort((a, b) => (b.points - a.points) || (String(a.at) < String(b.at) ? -1 : 1));
      for (const r of rows) {
        console.log([padL('#' + (r.rank || '—'), 6), r.code, r.addr, '@' + (r.x || '?'),
          padL(r.points, 5) + ' 分',
          r.verified ? '已核' : '待核',
          '邀请 ' + r.validInvites + '/' + r.invites,
          '分享 ' + r.shareDays + ' 天',
          r.tier || '—', r.ip || ''].join('  '));
      }
      console.log('— 共 ' + rows.length + ' 条 —');
      break;
    }
    case 'verify':
    case 'approve': {          // approve 是旧名：语义已改成「只打转发勾」，别名留着不打断肌肉记忆
      if (cmd === 'approve') console.log('（approve 已改名 verify：它只打转发勾 +分，不再直接发名额 —— 名额由积分榜算）');
      if (!args.length) die('要给一个登记码或地址');
      let okN = 0;
      for (const t of args) {
        const r = AL.verify(t);
        if (!r.ok) { console.log('✗ ' + t + '：' + r.error); continue; }
        okN++;
        console.log((r.already ? '○ ' : '✓ ') + r.code + ' ' + r.addr + (r.x ? ' @' + r.x : '')
          + (r.already ? '（早就核过了）' : '  转发勾已打，现在 ' + r.points + ' 分'));
      }
      console.log('— ' + okN + '/' + args.length + ' —');
      break;
    }
    case 'unverify': {
      if (!args.length) die('要给一个登记码或地址');
      for (const t of args) {
        const r = AL.unverify(t);
        console.log((r.ok ? (r.already ? '○ ' : '✓ ') : '✗ ') + t + ' ' + (r.error || r.addr || ''));
      }
      break;
    }
    /* 官方推文表 —— 推文互动任务的数据源。
       官方每发一条新推就 `posts add` 一条，任务页上立刻多一张卡；
       置顶推（ARCBANG_PINNED_POST_URL）自动是第一条，不在文件里，也删不掉。 */
    case 'posts': {
      const sub = (args.shift() || 'list').toLowerCase();
      if (sub === 'list') {
        const rows = AL.engagePosts();
        if (!rows.length) { console.log('（一条都没有：置顶推也没配）'); break; }
        for (const r of rows) {
          console.log(padL('#' + r.n, 5) + '  ' + pad(r.tweetId, 22) + padL(r.pts, 5) + ' 分  '
            + (r.pinned ? '置顶推' : pad((r.at || '').slice(0, 10), 11)) + '  ' + r.url);
        }
        console.log('— 共 ' + rows.length + ' 条 —');
        break;
      }
      if (sub === 'add') {
        if (!args.length) die('要给一条推文链接');
        const r = AL.engageAdd(args[0], { pts: flags.pts, note: flags.note });
        if (!r.ok) die(r.error);
        console.log('✓ 加上了 #' + r.post.n + '  ' + r.post.tweetId + '  ' + r.post.pts + ' 分');
        console.log('  ' + r.post.url);
        console.log('  下一轮自动核（最多 ' + (Number(process.env.ARCBANG_XV_EVERY_MIN) || 10) + ' 分钟）就会开始拉这条的点赞 / 转发 / 评论。');
        break;
      }
      if (sub === 'remove' || sub === 'rm') {
        if (!args.length) die('要给推文 id 或链接');
        const r = AL.engageRemove(args[0]);
        if (!r.ok) die(r.error);
        console.log('✓ 删掉了 ' + r.removed + ' 条，还剩 ' + r.total + ' 条');
        console.log('  **已经拿到的分不会退** —— 那些人确实做过，撤分是在罚他们。');
        break;
      }
      die('posts 只认 list / add / remove');
      break;
    }
    case 'who': {
      if (!args[0]) die('要给一个登记码或地址');
      const a = ALX._normAddr(args[0]) || AL.addrOfCode(args[0]);
      if (!a) die('认不出这个登记码或地址');
      showOne(a);
      break;
    }
    /* 登记之后用户自己改不了（接口第二次一律 409）。人工修正只有这一条路：
       它写进状态文件的 xfix，**不动登记流水** —— 流水只追加是那条规矩的根据。 */
    case 'setx': {
      if (args.length < 2) die('用法：setx <登记码|地址> <新X名>');
      const r = AL.setX(args[0], args[1]);
      if (!r.ok) die(r.error);
      console.log('✓ ' + r.code + ' ' + r.addr + '：@' + (r.was || '?') + ' → @' + r.now);
      break;
    }
    case 'freeze': {
      const before = AL.counts();
      const r = AL.freeze();
      console.log('✓ 名单已定格于 ' + r.frozenAt);
      console.log('  从榜取了前 ' + r.fromBoard + ' 名；最终 gtd ' + r.gtd + ' · fcfs ' + r.fcfs + ' · 合计 ' + r.total
        + '（定格前按榜算是 ' + before.total + '）');
      console.log('  之后名单不再随积分变。要改用 add / remove / tier；要重来跑 unfreeze。');
      break;
    }
    case 'unfreeze': {
      AL.unfreeze();
      console.log('✓ 已解冻：名单重新按积分榜实时算（人工覆盖的条目仍然保留且仍然赢）');
      break;
    }
    case 'add': {
      if (!args.length) die('要给至少一个地址');
      const r = AL.addAddresses(args, flags.tier, flags.src || '手工');
      console.log('✓ 新增 ' + r.added + '，改层 ' + r.upgraded + '，没变 ' + r.skipped
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
      console.log('✓ ' + r.addr + ' 人工钉在 ' + r.tier + '（allowlist.json 里的条目永远赢，榜算什么都不管）');
      break;
    }
    case 'import': {
      if (!args[0]) die('要给一个 CSV 文件');
      let text = '';
      try { text = fs.readFileSync(path.resolve(args[0]), 'utf8'); } catch (e) { die('读不出来：' + e.message); }
      /* 第一列当地址，其余列忽略；表头那一行自然会因为不是地址而被丢进 bad，不必特判。 */
      const addrs = text.split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter(Boolean);
      const r = AL.addAddresses(addrs, flags.tier, flags.src || path.basename(args[0]));
      console.log('✓ 新增 ' + r.added + '，改层 ' + r.upgraded + '，没变 ' + r.skipped
        + '，跳过 ' + r.bad.length + ' 行（表头和空行也算在这里）');
      break;
    }
    case 'list': {
      const want = flags.tier ? String(flags.tier).toLowerCase() : null;
      const rows = AL.board().rows.filter((r) => { const t = AL.tierOf(r.addr); return t && (!want || t === want); });
      for (const r of rows) {
        console.log(padL('#' + r.rank, 6) + '  ' + pad(AL.tierOf(r.addr), 6) + r.addr + '  ' + AL.codeOf(r.addr) + padL(r.points, 6) + ' 分');
      }
      console.log('— 共 ' + rows.length + ' 个' + (AL.isFrozen() ? '（已定格）' : '（实时按榜）') + ' —');
      break;
    }
    /* ------------------------------------------------------------------ 排练数据
       seed <n> [--seed=<整数>]   造 n 条模拟登记，让排练站的榜 / 统计 / 管理员页有东西看。
       unseed                     只删掉这些模拟记录，真实用户一条不动。

       三条规矩：
         1. **确定性**。同一个 --seed 造出来的地址、X 名、完成度逐字相同 ——
            排练站重来一遍还是同一张榜，截图和 bug 报告才对得上。
         2. **打标**。每条流水和状态都带 seed:true，unseed 按它删。
            没有这个标记，清理就只能靠「删整个 .store」，真实登记会被一起端掉。
         3. **走正门**。写的是和真实数据同一套结构（流水 + 状态），
            所以榜、积分、层级、管理员页一行代码都不用改就能看到它们。 */
    case 'seed': {
      const n = Math.max(1, Math.min(5000, Number(args[0]) || 0));
      if (!n) die('要给个数量，例如 seed 120');
      const base = Number(flags.seed) || 20260919;
      const r = AL.seed(n, base);
      console.log('✓ 造了 ' + r.added + ' 条模拟登记（跳过已存在的 ' + r.skipped + ' 条）');
      const c = AL.counts();
      console.log('  现在在榜 ' + AL.board().rows.length + ' 人 · 白名单 ' + c.gtd + ' · 先到先得 ' + c.fcfs);
      console.log('  清掉它们：node tools/allowlist.js unseed');
      break;
    }
    case 'unseed': {
      const r = AL.unseed();
      console.log('✓ 删掉 ' + r.removed + ' 条模拟登记，真实登记 ' + r.kept + ' 条原样保留');
      break;
    }
    case 'code': {
      if (!args[0]) die('要给一个地址');
      const c = AL.codeOf(args[0]);
      if (!c) die('地址不合法');
      console.log(c);
      break;
    }
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
}

main();
