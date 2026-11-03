#!/bin/sh
# EVoucher X 一键安装/验证/启动脚本（web 形态）
set -e
cd "$(dirname "$0")"

echo "== [1/3] 安装依赖（express + pdfjs-dist）="
npm install --no-audit --no-fund express pdfjs-dist

echo "== [2/3] 启动本地服务 ="
node server/main.js &
SERVER_PID=$!
sleep 1.5

echo "== [3/3] 冒烟验证 ="
curl -s http://localhost:8721/api/config | head -c 200; echo
curl -s http://localhost:8721/api/vouchers | head -c 200; echo
NO=$(curl -s http://localhost:8721/api/vouchers | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).vouchers[0].voucherNo))")
echo "sample voucher: $NO"
curl -s -o /tmp/evoucher_sample.pdf -w "pdf bytes: %{size_download}\n" "http://localhost:8721/api/vouchers/$NO/pdf"
curl -s -X POST http://localhost:8721/api/evoucher/GetServerVersion -H 'Content-Type: application/json' -d '{}' | head -c 200; echo

echo ""
echo "服务运行中: http://localhost:8721  (PID $SERVER_PID)"
echo "停止: kill $SERVER_PID"
