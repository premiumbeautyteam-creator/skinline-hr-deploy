#!/usr/bin/env bash
# Финальная проверка: что роуты Avito возвращают JSON, что Node слушает,
# что в логах PM2 нет ошибок старта.
set -e

echo "==> 1) PM2"
pm2 list | head -20

echo
echo "==> 2) Node слушает 3000?"
ss -tlnp | grep :3000 || echo "Node НЕ слушает 3000"

echo
echo "==> 3) Прямой запрос на Node (минуя nginx)"
echo "--- /api/integrations:"
curl -sS http://127.0.0.1:3000/api/integrations | head -c 500
echo
echo "--- /api/integrations/avito/self:"
curl -sS http://127.0.0.1:3000/api/integrations/avito/self | head -c 500
echo

echo
echo "==> 4) Через nginx по локальному порту (Host: api.skinline-hr.ru)"
curl -sS -k https://127.0.0.1/api/integrations/avito/self -H 'Host: api.skinline-hr.ru' | head -c 500
echo
echo "Через app.skinline-hr.ru:"
curl -sS -k https://127.0.0.1/api/integrations/avito/self -H 'Host: app.skinline-hr.ru' | head -c 500
echo

echo
echo "==> 5) Последние строки лога PM2"
pm2 logs skinline-hr --lines 25 --nostream 2>&1 | tail -40

echo
echo "==> 6) Webhook events в БД"
sqlite3 /home/skinline/skinline-hr-crm/data.db "SELECT id,source,eventType,status,createdAt FROM webhookEvents WHERE source='avito' ORDER BY createdAt DESC LIMIT 5;" 2>&1 || echo "sqlite3 не установлен или таблицы нет"

echo
echo "==> Готово"
