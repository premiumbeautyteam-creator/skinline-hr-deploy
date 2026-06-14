#!/usr/bin/env bash
# Iter1 fix: kill old PM2 process, keep new one, update bot username, verify
set -e

APP_DIR=/home/skinline/skinline-hr-crm
TELEGRAM_USERNAME="Assistant_skin_line_bot"

echo "=== Iter1 fix: started $(date -u) ==="

# Stop and delete old process
pm2 delete skinline-hr 2>&1 || true

# Make sure new one runs cluster + with env
pm2 delete skinline-hr-crm 2>&1 || true
cd "$APP_DIR"

# Fix bot username in .env to actual one
ENV_FILE="$APP_DIR/.env"
sed -i '/^TELEGRAM_BOT_USERNAME=/d' "$ENV_FILE"
echo "TELEGRAM_BOT_USERNAME=$TELEGRAM_USERNAME" >> "$ENV_FILE"

# Start with the new name from .env
pm2 start dist/index.cjs --name skinline-hr-crm --update-env
pm2 save

sleep 4

echo "=== PM2 ==="
pm2 status

echo "=== App health ==="
curl -ks -o /dev/null -w 'app: %{http_code}\n' https://app.skinline-hr.ru
curl -ks -o /dev/null -w 'api: %{http_code}\n' https://api.skinline-hr.ru/api/stages

echo "=== /api/stages (first 800 bytes) ==="
curl -ks https://api.skinline-hr.ru/api/stages | head -c 800
echo ""

echo "=== /api/candidates count ==="
curl -ks https://api.skinline-hr.ru/api/candidates | python3 -c "import sys,json; d=json.load(sys.stdin); print('candidates:', len(d) if isinstance(d,list) else 'not list')" 2>/dev/null || echo "candidates check failed"

echo "=== /api/users count ==="
curl -ks https://api.skinline-hr.ru/api/users | python3 -c "import sys,json; d=json.load(sys.stdin); print('users:', len(d) if isinstance(d,list) else 'not list')" 2>/dev/null || echo "users check failed"

echo "=== Avito self ==="
curl -ks https://api.skinline-hr.ru/api/integrations/avito/self | head -c 200
echo ""

echo "=== Iter1 fix: done $(date -u) ==="
