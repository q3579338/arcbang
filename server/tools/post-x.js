// 以官号（ARCBANG_X_HANDLE，默认 @arcbang_xyz）发一条推。
//   node server/tools/post-x.js --file 推文.txt [--reply <推文ID>] [--dry]
// 凭证：.store/xauth.json 里的 ownerAccessToken（官号在任务页用 X 登录时存下的，见 server/index.js /x/callback）。
// 一个字的凭证都不打印。X 按条计费（发帖约 $0.2/条，带链接同价），所以**默认先 --dry 预览**，确认后再发。
'use strict';
const fs = require('fs');
const path = require('path');
const XAUTH = require('../xauth.js');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] || d); };
const has = (n) => argv.indexOf('--' + n) >= 0;

const STORE = process.env.ARCBANG_STORE || path.join(__dirname, '..', '.store');
const cred = JSON.parse(fs.readFileSync(path.join(STORE, 'xauth.json'), 'utf8'));
const token = cred.ownerAccessToken, secret = cred.ownerAccessSecret;
if (!token || !secret) { console.error('官号还没授权：用官号在任务页点一次「用 X 登录」'); process.exit(1); }

const file = flag('file');
if (!file) { console.error('要给 --file <文本文件>'); process.exit(1); }
const text = fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
/* X 的计数规则：链接一律按 23 个字符算，中文一个字算一个 */
const counted = text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
console.log('—— 将以 @' + (cred.ownerHandle || '?') + ' 发出 ——');
console.log(text);
console.log('—— 字数 ' + counted + ' / 280 ——');
if (counted > 280) { console.error('超长，发不出去'); process.exit(1); }
if (has('dry')) { console.log('(--dry：没有真发)'); process.exit(0); }

const nonce = () => require('crypto').randomBytes(16).toString('hex');
(async () => {
  const url = 'https://api.x.com/2/tweets';
  const p = {
    oauth_consumer_key: cred.key, oauth_nonce: nonce(), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: token, oauth_version: '1.0'
  };
  /* JSON 请求体不进签名基串（OAuth 1.0a 只签 query 与 form 参数） */
  const sig = XAUTH.sign('POST', url, p, cred.secret, secret);
  const body = { text };
  const reply = flag('reply');
  if (reply) body.reply = { in_reply_to_tweet_id: String(reply) };
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: XAUTH.authHeader(p, sig), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) { console.error('发失败 ' + r.status + ' ' + JSON.stringify(j).slice(0, 300)); process.exit(1); }
  const id = j && j.data && j.data.id;
  console.log('已发出：https://x.com/' + (cred.ownerHandle || 'arcbang_xyz') + '/status/' + id);
})();
