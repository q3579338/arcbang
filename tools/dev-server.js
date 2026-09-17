// 本地预览：根路径就是 web/dist-arc，/api/* 反代到本地 API（默认 8801）。先 npm run build，再 npm run api、npm run dev。
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'web', 'dist-arc');
const PORT = Number(process.env.PORT || 8795), API = Number(process.env.API_PORT || 8801);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.hex': 'text/plain', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/s/')) {
    const p = http.request({ host: '127.0.0.1', port: API, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:' + API } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end('本地 API 没起来：npm run api'); });
    return void req.pipe(p);
  }
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf);
  });
}).listen(PORT, () => console.log('ARCBANG 本地预览 http://localhost:' + PORT + '/  （/api → ' + API + '）'));
