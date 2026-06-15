#!/bin/bash
# Полный fix SSL: чистый nginx-конфиг + certbot --expand
# Лог в /tmp/sslfix.log, маркер /tmp/sslfix.done в конце
set +e
exec > /tmp/sslfix.log 2>&1
echo "=== START $(date) ==="

echo "=== iptables INPUT ==="
iptables -L INPUT -n -v --line-numbers
echo ""

echo "=== sanitize sites-enabled (keep only skinline-hr.conf) ==="
ls /etc/nginx/sites-enabled/
echo ""

# Бэкап текущего конфига
cp /etc/nginx/sites-available/skinline-hr.conf /etc/nginx/sites-available/skinline-hr.conf.bak.$(date +%s)

# Webroot для challenge
mkdir -p /var/www/html/.well-known/acme-challenge
echo "challenge-test-$(date +%s)" > /var/www/html/.well-known/acme-challenge/probe
chmod -R 755 /var/www/html

# ЕДИНЫЙ чистый конфиг — без дублей
cat > /etc/nginx/sites-available/skinline-hr.conf <<'NGINX'
# ============ HTTP (port 80) — все домены, отдают acme-challenge, остальное -> HTTPS ============
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name skinline-hr.ru www.skinline-hr.ru app.skinline-hr.ru api.skinline-hr.ru;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ============ HTTPS root + www — редирект на app ============
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name skinline-hr.ru www.skinline-hr.ru;
    ssl_certificate /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skinline-hr.ru/privkey.pem;
    return 301 https://app.skinline-hr.ru$request_uri;
}

# ============ HTTPS app — CRM фронт ============
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name app.skinline-hr.ru;
    ssl_certificate /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skinline-hr.ru/privkey.pem;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}

# ============ HTTPS api — webhooks ============
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.skinline-hr.ru;
    ssl_certificate /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skinline-hr.ru/privkey.pem;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
NGINX

# Уберём возможные дублирующие fragments
rm -f /etc/nginx/conf.d/*skinline* 2>/dev/null
rm -f /etc/nginx/sites-enabled/default 2>/dev/null

echo "=== nginx -t ==="
nginx -t
NGT=$?
echo "nginx-t exit=$NGT"

if [ "$NGT" != "0" ]; then
  echo "!!! nginx config broken, restoring backup"
  cp /etc/nginx/sites-available/skinline-hr.conf.bak.* /etc/nginx/sites-available/skinline-hr.conf 2>/dev/null
  nginx -t
  echo "RESTORED" > /tmp/sslfix.done
  exit 1
fi

systemctl reload nginx
sleep 2

echo "=== probe webroot through Internet (self) ==="
for h in skinline-hr.ru api.skinline-hr.ru app.skinline-hr.ru www.skinline-hr.ru; do
  echo "--- $h ---"
  timeout 10 curl -sS -v "http://${h}/.well-known/acme-challenge/probe" 2>&1 | tail -15
  echo ""
done

echo "=== certbot --webroot --expand ==="
certbot certonly --webroot -w /var/www/html \
  -d skinline-hr.ru -d www.skinline-hr.ru -d app.skinline-hr.ru -d api.skinline-hr.ru \
  --expand --non-interactive --agree-tos -m skin.my.line@gmail.com 2>&1
CB=$?
echo "certbot exit=$CB"

echo "=== cert SAN after ==="
openssl x509 -in /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem -noout -text 2>/dev/null | grep -A2 "Subject Alternative Name"

systemctl reload nginx

echo "=== TLS handshake test ==="
for h in api.skinline-hr.ru app.skinline-hr.ru www.skinline-hr.ru skinline-hr.ru; do
  echo "--- $h ---"
  echo | timeout 10 openssl s_client -servername "$h" -connect 127.0.0.1:443 2>/dev/null | grep -E "(subject=|issuer=|verify return)" | head -5
done

echo "=== telegram webhook setInfo (drain) ==="
. /home/skinline/skinline-hr-crm/.env 2>/dev/null
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | head -200
  echo ""
fi

echo "DONE_$CB" > /tmp/sslfix.done
echo "=== END $(date) ==="
