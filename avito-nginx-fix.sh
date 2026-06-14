#!/usr/bin/env bash
# Восстанавливает nginx-конфиг для app.skinline-hr.ru и api.skinline-hr.ru
# (после деплоя они стали отдавать TLS handshake error) и регистрирует
# webhook Avito.

set -e

echo "==> Записываю /etc/nginx/sites-available/skinline-hr.conf"
cat > /etc/nginx/sites-available/skinline-hr.conf <<'NGINX'
# HTTP -> HTTPS redirect for all three names
server {
    listen 80;
    listen [::]:80;
    server_name skinline-hr.ru www.skinline-hr.ru app.skinline-hr.ru api.skinline-hr.ru;
    location /.well-known/acme-challenge/ { root /var/www/skinline-hr; }
    location / { return 301 https://$host$request_uri; }
}

# Корневой домен — статическая заглушка / редирект на app
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name skinline-hr.ru www.skinline-hr.ru;
    ssl_certificate /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skinline-hr.ru/privkey.pem;
    return 301 https://app.skinline-hr.ru$request_uri;
}

# app.skinline-hr.ru — фронт CRM (Node на 3000)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name app.skinline-hr.ru;
    ssl_certificate /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skinline-hr.ru/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}

# api.skinline-hr.ru — backend / webhook endpoint
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.skinline-hr.ru;
    ssl_certificate /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skinline-hr.ru/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
NGINX

echo "==> Включаю конфиг"
ln -sf /etc/nginx/sites-available/skinline-hr.conf /etc/nginx/sites-enabled/skinline-hr.conf
# удаляю старые потенциально-конфликтные включения, если они отдельные файлы
rm -f /etc/nginx/sites-enabled/skinline-hr /etc/nginx/sites-enabled/default
ls -la /etc/nginx/sites-enabled/

echo "==> Тест и reload nginx"
nginx -t
systemctl reload nginx
sleep 1

echo "==> Проверки"
echo "--- HTTPS на app.skinline-hr.ru:"
curl -sI -k https://127.0.0.1/ -H 'Host: app.skinline-hr.ru' | head -3
echo "--- HTTPS на api.skinline-hr.ru:"
curl -sI -k https://127.0.0.1/ -H 'Host: api.skinline-hr.ru' | head -3
echo "--- /api/integrations/avito/self (через api.):"
curl -sS -k https://127.0.0.1/api/integrations/avito/self -H 'Host: api.skinline-hr.ru' | head -c 300
echo
echo "==> Регистрирую webhook Avito"
# Получаю свежий токен через client_credentials и вызываю /messenger/v3/webhook
source /home/skinline/skinline-hr-crm/.env
TOKEN=$(curl -fsS -X POST https://api.avito.ru/token \
  -d "grant_type=client_credentials" \
  -d "client_id=$AVITO_CLIENT_ID" \
  -d "client_secret=$AVITO_CLIENT_SECRET" \
  -d "scope=messenger:read,messenger:write,user_balance:read,job:applications" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "Token: ${TOKEN:0:20}..."

echo "--- Регистрация webhook:"
curl -sS -X POST https://api.avito.ru/messenger/v3/webhook \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://api.skinline-hr.ru/api/webhooks/avito"}'
echo

echo "--- Текущие подписки:"
curl -sS -X POST https://api.avito.ru/messenger/v1/subscriptions \
  -H "Authorization: Bearer $TOKEN"
echo

echo "==> Готово"
