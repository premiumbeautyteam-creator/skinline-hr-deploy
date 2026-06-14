#!/usr/bin/env bash
# Записываем Avito ключи в .env и тестируем OAuth
APP_DIR="/home/skinline/skinline-hr-crm"
ENV_FILE="${APP_DIR}/.env"

CLIENT_ID="A6H-_AXGmdHvB67T0vbB"
CLIENT_SECRET="fJ4hnFKtpNYne6zjZ0D6RFsJ37pomNOW8aJFKFjo"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/4 Обновляем .env"
# Удаляем старые строки и добавляем новые
sed -i '/^AVITO_CLIENT_ID=/d; /^AVITO_CLIENT_SECRET=/d' "${ENV_FILE}"
echo "AVITO_CLIENT_ID=${CLIENT_ID}" >> "${ENV_FILE}"
echo "AVITO_CLIENT_SECRET=${CLIENT_SECRET}" >> "${ENV_FILE}"
chown skinline:skinline "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
echo "  .env обновлён"
grep -E "^AVITO_" "${ENV_FILE}" | sed 's/=.*$/=***/'

log "2/4 Тестируем OAuth2 client_credentials"
RESPONSE=$(curl -s -X POST "https://api.avito.ru/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}")
echo "Ответ Avito:"
echo "$RESPONSE" | head -c 500
echo

ACCESS_TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)

if [ -n "$ACCESS_TOKEN" ]; then
    echo ""
    echo "✓ Токен получен (первые 20 символов): ${ACCESS_TOKEN:0:20}..."
    
    log "3/4 Получаем user_id (Avito self-info)"
    SELF=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" "https://api.avito.ru/core/v1/accounts/self")
    echo "Self:"
    echo "$SELF" | head -c 500
    echo
    USER_ID=$(echo "$SELF" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    echo "user_id=$USER_ID"
    
    if [ -n "$USER_ID" ]; then
        # Сохраняем user_id в .env для использования в CRM
        sed -i '/^AVITO_USER_ID=/d' "${ENV_FILE}"
        echo "AVITO_USER_ID=${USER_ID}" >> "${ENV_FILE}"
        chown skinline:skinline "${ENV_FILE}"
        
        log "4/4 Проверяем список чатов (Messenger API)"
        CHATS=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
            "https://api.avito.ru/messenger/v2/accounts/${USER_ID}/chats?limit=5")
        echo "Чаты (первые 500 символов):"
        echo "$CHATS" | head -c 500
        echo
    fi
else
    echo "✗ ОШИБКА: токен не получен"
fi

log "Перезапускаем PM2 чтобы CRM подхватила новые env"
cd "${APP_DIR}"
pm2 restart skinline-hr --update-env 2>&1 | tail -5
sleep 3
pm2 list 2>&1 | tail -5
echo ""
echo "============================================"
echo "✓ .env обновлён"
echo "✓ Avito OAuth протестирован"
echo "✓ PM2 перезапущен"
echo "============================================"
