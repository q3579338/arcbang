#!/usr/bin/env bash
# 把 web/dist-arc 整目录发到 VPS 的 /var/www/arcbang，并装 nginx 配置。
# 用法：bash web/deploy-site-arc.sh [ssh 私钥路径]
# 先构建：node build.js && node web/build-web.js --site arc && node tools/check-dist.js
set -euo pipefail
KEY="${1:-$HOME/.ssh/arcbang_deploy_key}"
HOST="${BNBBANG_HOST:-root@YOUR_SERVER_IP}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/web/dist-arc"
WWW=/var/www/arcbang
[ -f "$DIST/index.html" ] || { echo "先构建：node build.js && node web/build-web.js --site arc"; exit 1; }
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")
SCP=(scp -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15)
echo "→ 建目录"
"${SSH[@]}" "mkdir -p $WWW"
echo "→ 传 nginx 配置"
"${SCP[@]}" "$ROOT/web/nginx-arcbang.xyz.conf" "$HOST:/etc/nginx/sites-available/arcbang.xyz"
"${SSH[@]}" "ln -sf /etc/nginx/sites-available/arcbang.xyz /etc/nginx/sites-enabled/arcbang.xyz"
echo "→ 传整个 dist-arc（tar 过去，保留子目录 en/ assets/）"
tar -C "$DIST" -czf - . | "${SSH[@]}" "tar -C $WWW -xzf -"
echo "→ 校验并重载"
"${SSH[@]}" "nginx -t && systemctl reload nginx && du -sh $WWW"
echo "→ 自测（回源，跳过 Cloudflare）"
"${SSH[@]}" "curl -sk -o /dev/null -w 'index.html %{http_code} %{size_download} bytes
' -H 'Host: arcbang.xyz' https://127.0.0.1/"
echo "完成：https://arcbang.xyz"
