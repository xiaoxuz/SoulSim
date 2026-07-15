#!/bin/bash
# SoulSim 一键启动：后端 (8000) + 前端 (3000)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

detect_lan_ip() {
  ipconfig getifaddr en0 2>/dev/null \
    || ipconfig getifaddr en1 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || echo "localhost"
}

LAN_IP="${SOULSIM_HOST:-$(detect_lan_ip)}"
API_BASE="${NEXT_PUBLIC_API_BASE:-http://$LAN_IP:8000/api}"

# 检查是否已在运行
if lsof -ti :8000 > /dev/null 2>&1 || lsof -ti :3000 > /dev/null 2>&1; then
  echo "⚠ 检测到 8000 或 3000 端口被占用，可能服务已在运行。"
  echo "  先执行 ./stop.sh 再启动，或手动检查: lsof -i :8000 -i :3000"
  exit 1
fi

# 启动后端
echo "▶ 启动后端 (uvicorn :8000)..."
cd "$ROOT/backend"
nohup ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > "$LOG_DIR/backend.log" 2>&1 &
echo $! > "$LOG_DIR/backend.pid"
disown 2>/dev/null || true

# 启动前端
echo "▶ 启动前端 (next dev 0.0.0.0:3000)..."
cd "$ROOT/frontend"
nohup env SOULSIM_HOST="$LAN_IP" NEXT_PUBLIC_API_BASE="$API_BASE" npm run dev -- --hostname 0.0.0.0 > "$LOG_DIR/frontend.log" 2>&1 &
echo $! > "$LOG_DIR/frontend.pid"
disown 2>/dev/null || true

# 等待服务就绪
echo ""
echo "等待服务就绪..."
for i in {1..40}; do
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✓ 后端就绪"
    break
  fi
  [ $i -eq 40 ] && echo "✗ 后端启动超时，查看 logs/backend.log" && exit 1
  sleep 1
done
for i in {1..40}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✓ 前端就绪"
    break
  fi
  [ $i -eq 40 ] && echo "✗ 前端启动超时，查看 logs/frontend.log" && exit 1
  sleep 1
done

echo ""
echo "════════════════════════════════════════"
echo "  SoulSim 已启动 🐶"
echo "════════════════════════════════════════"
echo "  前端:  http://localhost:3000"
echo "  后端:  http://localhost:8000"
echo "  局域网前端: http://$LAN_IP:3000"
echo "  局域网后端: http://$LAN_IP:8000"
echo "  API Base: $API_BASE"
echo "  日志:  $LOG_DIR/"
echo "           ├── backend.log"
echo "           └── frontend.log"
echo "════════════════════════════════════════"
