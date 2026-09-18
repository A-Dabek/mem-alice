#!/bin/bash
set -e

# Load .env if present so the values can be filled in once instead of exported
# by hand. Real environment variables still win (the exports below use `:-`
# defaults). NODE_ENV is forced to production afterwards.
ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  echo "Loading $ENV_FILE"
  set -a
  . "$ENV_FILE"
  set +a
fi

# mem-alice prod for Termux (Android) - reuse existing bombos2 tunnel
# bombos2: PORT=3000 -> termux.bombos.online
# mem-alice: PORT=3001 -> alice.termux.bombos.online (second ingress)

echo "=== mem-alice prod ==="
echo "Installing deps (android prebuilds for better-sqlite3)..."
pnpm install --prod --os=android || pnpm install --prod || pnpm install

export NODE_ENV=production
export PORT=${PORT:-3001}
export DB_PATH=${DB_PATH:-data/milestones.db}
export MS_CLIENT_ID=${MS_CLIENT_ID:-f825bf3d-364e-4780-94d5-9651c72a61a8}
export MS_AUTHORITY=${MS_AUTHORITY:-https://login.microsoftonline.com/consumers}
# Comma-separated allowlist of Microsoft account emails allowed to call the API.
# Empty => every API request is rejected with 403.
export ALLOWED_EMAILS=${ALLOWED_EMAILS:-}
# AUTH_DISABLED=1 disables /api/milestones auth for LOCAL DEV ONLY. It is
# ignored (with a warning) when NODE_ENV=production, which this script sets.
# export AUTH_DISABLED=1

if [ -z "$ALLOWED_EMAILS" ]; then
  echo "WARN ALLOWED_EMAILS is empty - all /api/milestones requests will be 403"
fi

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
echo "MS_CLIENT_ID=$MS_CLIENT_ID MS_AUTHORITY=$MS_AUTHORITY"
echo "ALLOWED_EMAILS=$ALLOWED_EMAILS"
echo "Tunnel should map alice.termux.bombos.online -> http://localhost:$PORT"
echo "If you run both apps, keep bombos2 on 3000 and mem-alice on 3001."

# Foreground (blocks) - use tmux/pm2/nohup for background:
#   tmux new -s alice 'PORT=3001 ./prod.sh'
#   pm2 start server/index.js --name mem-alice -- --port 3001
#   nohup ./prod.sh > mem-alice.log 2>&1 &
node server/index.js
