#!/usr/bin/env bash
# Iteration 1 deploy: 14 stages + automations + Telegram bot
set -e

APP_DIR=/home/skinline/skinline-hr-crm
TAR_URL="https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/skinline-hr-crm.tar.gz"
TELEGRAM_TOKEN="8934708636:AAGaPP2y5QvkLtC1VtpdUQY5-W7mBfIP0WA"
TELEGRAM_USERNAME="skinline_recruitment_bot"
WEBHOOK_URL="https://api.skinline-hr.ru/api/webhooks/telegram"

echo "=== Iter1 deploy: started $(date -u) ==="

# Backup current
cp -a "$APP_DIR" "${APP_DIR}.bak.$(date +%s)" 2>/dev/null || true

# Download new tarball
TMP=$(mktemp -d)
curl -fsSL "$TAR_URL" -o "$TMP/code.tar.gz"
echo "Downloaded $(du -sh $TMP/code.tar.gz | cut -f1)"

# Extract over existing (preserve data.db, .env, node_modules)
cd "$APP_DIR"
tar -xzf "$TMP/code.tar.gz" \
  --exclude='./data.db' \
  --exclude='./data.db-journal' \
  --exclude='./.env'
rm -rf "$TMP"

# Update .env with new Telegram vars (append if missing)
ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"
grep -q '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" \
  || echo "TELEGRAM_BOT_TOKEN=$TELEGRAM_TOKEN" >> "$ENV_FILE"
grep -q '^TELEGRAM_BOT_USERNAME=' "$ENV_FILE" \
  || echo "TELEGRAM_BOT_USERNAME=$TELEGRAM_USERNAME" >> "$ENV_FILE"

# Install only if package.json changed
if [ -f /tmp/last-pkg-md5 ] && md5sum -c /tmp/last-pkg-md5 2>/dev/null; then
  echo "package.json unchanged, skipping npm install"
else
  echo "Installing deps..."
  npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
  md5sum package.json > /tmp/last-pkg-md5
fi

# Restart PM2
echo "Restarting PM2..."
pm2 restart skinline-hr-crm --update-env || pm2 start dist/index.cjs --name skinline-hr-crm
pm2 save

sleep 3

# Health checks
echo "=== Health ==="
echo "App: $(curl -ks -o /dev/null -w '%{http_code}' https://app.skinline-hr.ru)"
echo "API: $(curl -ks -o /dev/null -w '%{http_code}' https://api.skinline-hr.ru/api/stages)"

# Telegram webhook
echo "=== Registering Telegram webhook ==="
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"${WEBHOOK_URL}\",\"allowed_updates\":[\"message\",\"callback_query\"]}"
echo ""

# Verify bot
echo "=== getMe ==="
curl -sS "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe"
echo ""

# Verify stages endpoint
echo "=== /api/stages count ==="
curl -ks https://api.skinline-hr.ru/api/stages | python3 -c "import sys,json; d=json.load(sys.stdin); print('stages:', len(d))" 2>/dev/null || echo "stages endpoint check failed"

echo "=== Iter1 deploy: done $(date -u) ==="
