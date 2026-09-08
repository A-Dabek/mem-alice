#!/bin/bash
set -e

# mem-alice prod for Termux (Android) - reuse existing bombos2 tunnel
# bombos2: PORT=3000 -> termux.bombos.online
# mem-alice: PORT=3001 -> alice.termux.bombos.online (second ingress)

echo "=== mem-alice prod ==="
echo "Installing deps (android prebuilds for better-sqlite3)..."
pnpm install --prod --os=android || pnpm install --prod || pnpm install

export NODE_ENV=production
export PORT=${PORT:-3001}
export DB_PATH=${DB_PATH:-data/milestones.db}

mkdir -p data backup

# Backup DB if exists
if [ -f "$DB_PATH" ]; then
  BACKUP="backup/milestones-$(date +%Y%m%d-%H%M).db"
  echo "Backing up $DB_PATH -> $BACKUP"
  cp "$DB_PATH" "$BACKUP" || true
  # also backup WAL/SHM if present
  cp "$DB_PATH-wal" "$BACKUP-wal" 2>/dev/null || true
  cp "$DB_PATH-shm" "$BACKUP-shm" 2>/dev/null || true
fi

echo "Starting mem-alice on PORT=$PORT DB_PATH=$DB_PATH NODE_ENV=$NODE_ENV"
echo "Tunnel should map alice.termux.bombos.online -> http://localhost:$PORT"
echo "If you run both apps, keep bombos2 on 3000 and mem-alice on 3001."

# Foreground (blocks) - use tmux/pm2/nohup for background:
#   tmux new -s alice 'PORT=3001 ./prod.sh'
#   pm2 start server/index.js --name mem-alice -- --port 3001
#   nohup ./prod.sh > mem-alice.log 2>&1 &
node server/index.js
