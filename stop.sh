#!/bin/bash
# SoulSim 一键停止：后端 + 前端
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/logs"

stopped=0

# 按 PID 文件停止
for name in backend frontend; do
  PID_FILE="$LOG_DIR/$name.pid"
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      echo "✓ $name 主进程已停止 (PID $PID)"
      stopped=1
    fi
    rm -f "$PID_FILE"
  fi
done

# 兜底：按进程名清理（--reload 会 fork 子进程，npm 也会 fork next）
if lsof -ti :8000 > /dev/null 2>&1; then
  lsof -ti :8000 | xargs kill 2>/dev/null
  echo "✓ 端口 8000 残留进程已清理"
  stopped=1
fi
if lsof -ti :3000 > /dev/null 2>&1; then
  lsof -ti :3000 | xargs kill 2>/dev/null
  echo "✓ 端口 3000 残留进程已清理"
  stopped=1
fi

# 再等一下确认子进程退出
sleep 1
pkill -f "uvicorn app.main:app" 2>/dev/null && echo "✓ uvicorn 子进程已清理" && stopped=1
pkill -f "next dev" 2>/dev/null && echo "✓ next dev 子进程已清理" && stopped=1
pkill -f "next-server" 2>/dev/null && echo "✓ next-server 子进程已清理" && stopped=1

if [ $stopped -eq 0 ]; then
  echo "没有运行中的服务"
fi

echo ""
echo "════════════════════════════════════════"
echo "  SoulSim 已停止 🐶"
echo "════════════════════════════════════════"
