/*
 * 卡死报告 —— POST /api/stall { dump, site, page, appVersion, sentAt }
 * ------------------------------------------------------------
 * 前端看门狗（ui/app.js）抓到主线程卡住 >1 s 时会存一份现场到 localStorage，
 * 并在右下角弹一条「上次假死现场已记录」。用户点「发送报告」就走到这里。
 *
 * 落盘：.store/stall-reports.jsonl，一行一条 { id, at, ip, site, page, appVersion, sentAt, dump }。
 *       IP 只留前缀（IPv4 前两段 / IPv6 前两组），够看「是不是同一个人连发」，又不是完整地址。
 * 邮件：配了 ARCBANG_RESEND_KEY 才发，走 Resend 的 HTTPS API（Node 自带 fetch，不引入依赖）。
 *       发失败只记日志，**不影响 200 返回** —— 报告已经落盘了，用户那边不该看到失败。
 * 防刷：同一 IP 每小时 10 条（借 ratelimit.take 的独立桶，不占引爆额度）。
 * 体积：调用方（index.js 的 bodyOf）已经限过；这里再兜一道 32 KB，超了直接拒。
 *
 * GET 不开放：报告里有别人的页面路径与机器信息，没有任何理由让它可读。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 32 * 1024;
const PER_IP_PER_HOUR = 10;
const HOUR = 3600000;
const SITES = new Set(['bnb', 'bnbbang', 'btc', 'btcbang', 'arc', 'arcbang']);

/** IP 脱敏：IPv4 留前两段，IPv6 留前两组，其余丢掉 */
function ipPrefix(ip) {
  const s = String(ip == null ? '' : ip).trim();
  if (!s) return null;
  if (s.indexOf(':') >= 0) {
    const g = s.split(':').filter(Boolean);
    return g.length ? g.slice(0, 2).join(':') + '::/32' : null;
  }
  const q = s.split('.');
  return q.length === 4 ? q[0] + '.' + q[1] + '.x.x' : null;
}

/* 页面路径只留 pathname + 白名单里的 query（前端已经筛过一遍，这里再兜一道）。
   别把任何来路不明的 query 原样落盘，那正是地址/邮箱漏出去的典型路径。 */
const Q_OK = new Set(['bang', 'n', 'hash', 'site', 'lang', 'D', 'dim']);
function safePage(s) {
  const raw = String(s == null ? '' : s).slice(0, 512);
  if (!raw) return null;
  const qi = raw.indexOf('?');
  const pathPart = (qi < 0 ? raw : raw.slice(0, qi)).replace(/[^\w./-]/g, '').slice(0, 200);
  if (qi < 0) return pathPart || '/';
  const kept = [];
  for (const kv of raw.slice(qi + 1).split('&')) {
    const eq = kv.indexOf('=');
    const k = (eq < 0 ? kv : kv.slice(0, eq)).replace(/[^\w-]/g, '');
    if (!k || !Q_OK.has(k)) continue;
    const v = (eq < 0 ? '' : kv.slice(eq + 1)).replace(/[^\w.-]/g, '').slice(0, 80);
    kept.push(v ? k + '=' + v : k);
    if (kept.length >= 4) break;
  }
  return kept.length ? pathPart + '?' + kept.join('&') : (pathPart || '/');
}

function str(v, n) { return v == null ? null : String(v).slice(0, n || 120); }

/** 邮件正文：先给一段人能一眼看完的摘要，再附完整 dump */
function mailText(rec) {
  const d = (rec.dump && typeof rec.dump === 'object') ? rec.dump : {};
  const frames = Array.isArray(d.frames) ? d.frames : [];
  let maxGap = 0, maxDraw = 0;
  for (const f of frames) {
    if (!Array.isArray(f)) continue;
    if (+f[0] > maxGap) maxGap = +f[0];
    if (+f[1] > maxDraw) maxDraw = +f[1];
  }
  const lines = [
    '站点        ' + (rec.site || '?'),
    '页面        ' + (rec.page || '?'),
    '版本        ' + (rec.appVersion || '?'),
    '卡住        ' + (d.stallMs != null ? d.stallMs + ' ms' : '?'),
    '状态/视图   ' + (d.state || '?') + ' / ' + (d.view || '?'),
    '镜像层级    ' + (d.level != null ? d.level : '—') + '   dimMode=' + (d.dimMode || '—') + '   D=' + (d.dimS != null ? d.dimS : '—'),
    '恒星系      ' + (d.system || '—') + '   行星数=' + (d.planetCount != null ? d.planetCount : '—'),
    '最近帧      间隔最大 ' + maxGap + ' ms · drawFrame 最大 ' + maxDraw + ' ms · 共 ' + frames.length + ' 帧',
    '进镜像分段  ' + JSON.stringify(d.enterMirrorMs || null),
    '进恒星系分段 ' + JSON.stringify(d.enterSystemMs || null),
    '可见性      ' + (d.visibility || '?') + '   最后输入=' + JSON.stringify(d.lastInput || null),
    '堆          ' + (d.heapMB != null ? d.heapMB + ' MB' : '?'),
    'UA          ' + (d.ua || '?'),
    'IP 前缀     ' + (rec.ip || '—'),
    '收到时间    ' + rec.at,
    '',
    '—— 完整 dump ——',
    JSON.stringify(rec.dump, null, 2)
  ];
  return lines.join('\n');
}

function create(opts) {
  const o = opts || {};
  const storeDir = o.storeDir || path.join(__dirname, '.store');
  const file = path.join(storeDir, 'stall-reports.jsonl');
  const take = o.take;                       // ratelimit.take(key, limit, windowMs)
  const env = o.env || process.env;
  const mailTo = String(env.ARCBANG_STALL_MAIL_TO || 'admin@arcbang.xyz').trim();
  const mailFrom = String(env.ARCBANG_STALL_MAIL_FROM || 'stall@arcbang.xyz').trim();
  const resendKey = String(env.ARCBANG_RESEND_KEY || '').trim();
  const mailOn = !!resendKey;

  async function sendMail(rec) {
    if (!mailOn) return;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + resendKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: mailFrom,
          to: [mailTo],
          subject: '[卡死报告] ' + (rec.site || '?') + ' · ' + ((rec.dump && rec.dump.stallMs) || '?') + ' ms · ' + (rec.page || '?'),
          text: mailText(rec)
        })
      });
      if (!r.ok) console.error('[stall] 邮件发送失败 HTTP ' + r.status);
    } catch (e) {
      console.error('[stall] 邮件发送失败：' + (e && e.message));   // 落盘已完成，不回滚、不影响返回
    }
  }

  /** 返回 { status, body }；邮件是后台发的，不 await 进响应 */
  function add(input, ip, rawLen) {
    if (rawLen != null && rawLen > MAX_BYTES) return { status: 413, body: { error: '报告太大' } };
    const b = input && typeof input === 'object' ? input : {};
    if (!b.dump || typeof b.dump !== 'object') return { status: 400, body: { error: '缺少 dump' } };
    if (typeof take === 'function') {
      const r = take('stall:' + (ip || '?'), PER_IP_PER_HOUR, HOUR);
      if (r && r.ok === false) return { status: 429, body: { error: '太频繁了，一小时后再试' } };
    }
    let dump;
    try {
      const s = JSON.stringify(b.dump);
      if (s.length > MAX_BYTES) return { status: 413, body: { error: '报告太大' } };
      dump = JSON.parse(s);                    // 深拷贝一份纯数据，切掉任何原型/函数
    } catch (e) { return { status: 400, body: { error: 'dump 不是合法 JSON' } }; }

    const siteRaw = String(b.site || 'bnb').trim().toLowerCase();
    const rec = {
      id: 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      at: new Date().toISOString(),
      ip: ipPrefix(ip),
      site: SITES.has(siteRaw) ? siteRaw : 'other',
      page: safePage(b.page),
      appVersion: str(b.appVersion, 40),
      sentAt: str(b.sentAt, 40),
      dump
    };
    try {
      fs.mkdirSync(storeDir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    } catch (e) {
      return { status: 500, body: { error: '暂时存不下，稍后再试' } };
    }
    sendMail(rec);                             // 故意不 await：邮件慢或挂都不该让用户等
    return { status: 200, body: { ok: true, id: rec.id } };
  }

  return { add, mailOn, mailTo, _file: file, _mailText: mailText };
}

module.exports = { create, ipPrefix, safePage, mailText, MAX_BYTES, PER_IP_PER_HOUR };
