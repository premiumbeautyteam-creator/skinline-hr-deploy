#!/bin/bash
# Avito finalization: auto-fetch USER_ID, write to .env, register webhook, test
set -e
exec > >(tee /tmp/avito-finalize.log) 2>&1

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/6] Fetch AVITO_USER_ID via /api/integrations/avito/self..."
SELF_JSON=$(curl -fsS http://localhost:3000/api/integrations/avito/self || echo '{"error":"request_failed"}')
echo "Response: $SELF_JSON"

USER_ID=$(echo "$SELF_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('self', {}).get('id') or data.get('id') or '')
except Exception as e:
    print('', file=sys.stderr)
" 2>/dev/null)

if [ -z "$USER_ID" ] || [ "$USER_ID" = "None" ]; then
    echo "ERROR: cannot extract USER_ID from /self response"
    exit 1
fi

echo "  Extracted USER_ID: $USER_ID"

echo "[2/6] Write AVITO_USER_ID to .env..."
if grep -q '^AVITO_USER_ID=' .env 2>/dev/null; then
    sed -i "s|^AVITO_USER_ID=.*|AVITO_USER_ID=$USER_ID|" .env
    echo "  AVITO_USER_ID updated in .env"
else
    echo "AVITO_USER_ID=$USER_ID" >> .env
    echo "  AVITO_USER_ID appended to .env"
fi

echo "[3/6] Get access_token via OAuth (for webhook registration)..."
CLIENT_ID=$(grep '^AVITO_CLIENT_ID=' .env | cut -d= -f2-)
CLIENT_SECRET=$(grep '^AVITO_CLIENT_SECRET=' .env | cut -d= -f2-)

TOKEN_RESP=$(curl -fsS -X POST 'https://api.avito.ru/token/' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "grant_type=client_credentials" \
    --data-urlencode "client_id=$CLIENT_ID" \
    --data-urlencode "client_secret=$CLIENT_SECRET" \
    --data-urlencode "scope=messenger:read,messenger:write,user:read,job/applications")

TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('access_token', ''))")

if [ -z "$TOKEN" ]; then
    echo "ERROR: cannot get access_token"
    echo "Response: $TOKEN_RESP"
    exit 1
fi

echo "  Token obtained (len=${#TOKEN})"

echo "[4/6] List existing webhooks..."
EXISTING=$(curl -fsS -X POST "https://api.avito.ru/messenger/v1/subscriptions" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')
echo "  Existing: $EXISTING"

echo "[5/6] Register webhook https://api.skinline-hr.ru/api/webhooks/avito..."
WEBHOOK_URL="https://api.skinline-hr.ru/api/webhooks/avito"
REGISTER_RESP=$(curl -sS -X POST "https://api.avito.ru/messenger/v3/webhook" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$WEBHOOK_URL\"}")
echo "  Register response: $REGISTER_RESP"

echo "[6/6] Restart app & verify..."
pm2 restart skinline-hr-crm || systemctl restart skinline || true
sleep 4

echo ""
echo "=== Test /api/integrations/avito/chats ==="
curl -s http://localhost:3000/api/integrations/avito/chats | head -c 800
echo ""

echo ""
echo "=== Trigger initial sync ==="
curl -s -X POST http://localhost:3000/api/integrations/avito/sync | head -c 500
echo ""

echo ""
echo "Done. Avito integration finalized."
echo "AVITO_USER_ID=$USER_ID"
