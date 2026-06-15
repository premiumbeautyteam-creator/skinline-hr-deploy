#!/bin/bash
exec > /tmp/wh.out 2>&1
TOK=$(grep TELEGRAM_BOT_TOKEN /home/skinline/skinline-hr-crm/.env | cut -d= -f2 | tr -d '"' | tr -d "'")
echo "=== Telegram webhook status ==="
curl -s "https://api.telegram.org/bot${TOK}/getWebhookInfo" | python3 -m json.tool
echo ""
echo "=== Re-register webhook to drain ==="
curl -s "https://api.telegram.org/bot${TOK}/setWebhook?url=https://api.skinline-hr.ru/api/webhooks/telegram&drop_pending_updates=false" | head -c 200
echo ""
sleep 5
echo "=== After re-register ==="
curl -s "https://api.telegram.org/bot${TOK}/getWebhookInfo" | python3 -m json.tool
echo ""
echo "=== Avito webhook ==="
echo "Skipped (no easy probe), but if api is reachable externally then it works too."
echo ""
echo "=== DONE ==="
