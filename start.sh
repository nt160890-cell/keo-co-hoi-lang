#!/usr/bin/env bash
# Kéo Co Hội Làng: start the game on Ubuntu/Linux or macOS (same job as START.bat on Windows).
#   bash start.sh            (macOS: double-click START.command in Finder)
# Ctrl+C or closing the terminal stops the game.
GAME="Kéo Co Hội Làng"
DEFAULT_PORT=3946

cd "$(dirname "$0")" || exit 1

pause_exit() { echo "$1"; [ -t 0 ] && read -r -p "Bấm Enter để đóng..." _; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin) pause_exit "Chưa cài Node.js. Tải bản LTS tại https://nodejs.org (hoặc: brew install node) rồi chạy lại." ;;
    *)      pause_exit "Chưa cài Node.js 20+. Ubuntu: sudo snap install node --classic (hoặc tải tại https://nodejs.org) rồi chạy lại." ;;
  esac
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || pause_exit "Node.js đang là $(node -v), cần bản 20 trở lên."

if [ ! -d node_modules ]; then
  echo "Đang cài thư viện lần đầu, chờ một chút..."
  npm install --no-audit --no-fund || pause_exit "Cài thư viện lỗi. Kiểm tra mạng rồi chạy lại."
fi
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }

PORT=$( [ -f .env ] && grep '^PORT=' .env | cut -d= -f2 | tr -d '\r ' )
PORT=${PORT:-$DEFAULT_PORT}
URL="http://localhost:$PORT/"

# Open the game in the browser a moment after the server starts.
( sleep 2
  if command -v open >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  else echo "Mở trình duyệt tại $URL"; fi ) &

echo "Đang chạy $GAME ở $URL. Bấm Ctrl+C hoặc đóng cửa sổ này để tắt game."

# Keep the computer awake during the live.
if [ "$(uname -s)" = Darwin ] && command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dis node server.mjs
elif command -v systemd-inhibit >/dev/null 2>&1; then
  systemd-inhibit --what=idle:sleep --who="$GAME" --why="Đang live" node server.mjs \
    || node server.mjs # inhibit can be refused without a login session (e.g. over SSH)
else
  node server.mjs
fi
