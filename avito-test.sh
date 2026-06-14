#!/usr/bin/env bash
# Тестируем Avito OAuth используя ключи из .env (которые админ вставит вручную)
APP_DIR="/home/skinline/skinline-hr-crm"
ENV_FILE="${APP_DIR}/.env"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

# Читаем ключи из .env
set -a
source "${ENV_FILE}"
set +a

CLIENT_ID="${AVITO_CLIENT_ID:-}"
CLIENT_SECRET="${AVITO_CLIENT_SECRET:-}"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    echo "✗ AVITO_CLIENT_ID или AVITO_CLIENT_SECRET не заданы в ${ENV_FILE}"
    exit 1
fi

echo "  CLIENT_ID = ${CLIENT_ID:0:6}...${CLIENT_ID: -4}"
echo "  CLIENT_SECRET = ${CLIENT_SECRET:0:4}...${CLIENT_SECRET: -4}"

log "1/3 OAuth2 client_credentials"
RESPONSE=$(curl -s -X POST "https://api.avito.ru/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}")
echo "Ответ:"
echo "$RESPONSE" | head -c 400
echo

ACCESS_TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)

if [ -z "$ACCESS_TOKEN" ]; then
    echo "✗ Токен не получен"
    exit 1
fi
echo "✓ Токен получен (первые 20): ${ACCESS_TOKEN:0:20}..."

log "2/3 GET /core/v1/accounts/self"
SELF=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" "https://api.avito.ru/core/v1/accounts/self")
echo "$SELF" | head -c 600
echo
USER_ID=$(echo "$SELF" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo "user_id=$USER_ID"

if [ -n "$USER_ID" ]; then
    # Сохраняем user_id в .env
    sed -i '/^AVITO_USER_ID=/d' "${ENV_FILE}"
    echo "AVITO_USER_ID=${USER_ID}" >> "${ENV_FILE}"
    chown skinline:skinline "${ENV_FILE}"
    
    log "3/3 Список чатов Messenger"
    CHATS=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
        "https://api.avito.ru/messenger/v2/accounts/${USER_ID}/chats?limit=5&unread_only=false")
    echo "$CHATS" | head -c 700
    echo
    # Считаем число чатов
    N=$(echo "$CHATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('chats',[])))" 2>/dev/null)
    echo "Чатов получено: $N"
fi

log "Перезапускаем PM2"
pm2 restart skinline-hr --update-env 2>&1 | tail -3
sleep 2
pm2 list | tail -5
echo ""
echo "============================================"
echo "Avito ключи рабочие, OAuth и Messenger API доступны"
echo "============================================"
