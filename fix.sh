#!/usr/bin/env bash
# SkinLine HR CRM — Fix: build на SQLite + PM2 правильно + повтор Let's Encrypt
set -euo pipefail

DOMAIN="skinline-hr.ru"
APP_DOMAIN="app.${DOMAIN}"
API_DOMAIN="api.${DOMAIN}"
ROOT_DOMAIN="${DOMAIN}"
ADMIN_EMAIL="premium.beauty.team@gmail.com"
APP_USER="skinline"
APP_DIR="/home/${APP_USER}/skinline-hr-crm"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/7 Проверяем права на /usr/bin/node для пользователя skinline"
ls -la /usr/bin/node /usr/bin/npm 2>&1 | head -5
sudo -u ${APP_USER} which node npm 2>&1 | head -5
# Иногда EACCES — это проблема home dir permissions
ls -la /home/${APP_USER}/ | head -10

log "2/7 Чиним PM2 — пересоздаём home/.pm2 с правильными правами"
rm -rf /home/${APP_USER}/.pm2
mkdir -p /home/${APP_USER}/.pm2
chown -R ${APP_USER}:${APP_USER} /home/${APP_USER}/.pm2
chmod 755 /home/${APP_USER}
# Тест что pm2 работает
sudo -u ${APP_USER} bash -c "pm2 ping" 2>&1 | tail -5

log "3/7 Build проекта (SQLite, ничего не меняем в коде пока)"
cd "${APP_DIR}"
# Ставим зависимости, если ещё не стояли
if [ ! -d "node_modules" ]; then
    log "  установка npm-пакетов"
    sudo -u ${APP_USER} bash -c "cd ${APP_DIR} && npm install 2>&1 | tail -5"
fi

# Билдим
sudo -u ${APP_USER} bash -c "cd ${APP_DIR} && npm run build 2>&1 | tail -20" || \
    echo "  ⚠️ npm run build упал — смотрим dist"
ls -la "${APP_DIR}/dist/" 2>&1 | head -10

log "4/7 Drizzle: применяем схему к SQLite (data.db создастся)"
cd "${APP_DIR}"
sudo -u ${APP_USER} bash -c "cd ${APP_DIR} && npm run db:push -- --force 2>&1 | tail -10" || \
    echo "  ⚠️ db:push упал, продолжаем"
ls -la "${APP_DIR}/data.db" 2>&1 || true

log "5/7 Обновляем .env под SQLite (NODE_ENV=production, PORT=3000)"
cat > "${APP_DIR}/.env" <<EOF
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://${APP_DOMAIN}
API_URL=https://${API_DOMAIN}
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "fallback-secret-change-me")
# Avito (вставить после регенерации)
AVITO_CLIENT_ID=
AVITO_CLIENT_SECRET=
AVITO_WEBHOOK_SECRET=$(openssl rand -hex 24 2>/dev/null || echo "fallback-webhook-change-me")
EOF
chown ${APP_USER}:${APP_USER} "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"

log "6/7 PM2: пересоздаём ecosystem (правильный путь к dist/index.cjs)"
cat > "${APP_DIR}/ecosystem.config.cjs" <<'EOF'
module.exports = {
  apps: [{
    name: 'skinline-hr',
    script: 'dist/index.cjs',
    cwd: '/home/skinline/skinline-hr-crm',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/home/skinline/logs/skinline-hr.err.log',
    out_file: '/home/skinline/logs/skinline-hr.out.log',
    time: true,
    max_memory_restart: '500M',
    autorestart: true,
    watch: false
  }]
};
EOF
chown ${APP_USER}:${APP_USER} "${APP_DIR}/ecosystem.config.cjs"
mkdir -p /home/${APP_USER}/logs
chown ${APP_USER}:${APP_USER} /home/${APP_USER}/logs

# Запуск PM2
sudo -u ${APP_USER} pm2 delete all 2>/dev/null || true
sudo -u ${APP_USER} bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.cjs" 2>&1 | tail -10
sleep 3
sudo -u ${APP_USER} pm2 list 2>&1 | tail -10
echo "--- последние логи ---"
sudo -u ${APP_USER} pm2 logs skinline-hr --lines 20 --nostream 2>&1 | tail -25 || true

sudo -u ${APP_USER} pm2 save 2>&1 | tail -3
env PATH=$PATH:/usr/bin pm2 startup systemd -u ${APP_USER} --hp /home/${APP_USER} 2>&1 | tail -3

log "7/7 Повторяем certbot (rate-limit должен пройти)"
# Получаем сертификат с standalone (более надёжно), или nginx, или http-01 через /var/www/html
mkdir -p /var/www/html
certbot certonly --webroot -w /var/www/html --non-interactive --agree-tos \
    --email "${ADMIN_EMAIL}" \
    -d "${ROOT_DOMAIN}" \
    -d "${APP_DOMAIN}" \
    -d "${API_DOMAIN}" \
    --no-eff-email 2>&1 | tail -15

# Если сертификат получен — настраиваем SSL в nginx
if [ -d "/etc/letsencrypt/live/${ROOT_DOMAIN}" ]; then
    log "  Сертификат получен — обновляем nginx с SSL"
    cat > /etc/nginx/sites-available/skinline-hr <<EOF
# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name ${ROOT_DOMAIN} ${APP_DOMAIN} ${API_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

# CRM web (app + root)
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${APP_DOMAIN} ${ROOT_DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${ROOT_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${ROOT_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}

# API
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${API_DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${ROOT_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${ROOT_DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
    nginx -t && systemctl reload nginx
    echo "  ✓ nginx с SSL применён"
else
    echo "  ⚠️ Сертификат ещё не получен — оставляем HTTP-only"
fi

# Финал
echo "============================================"
echo "✓ nginx:      $(systemctl is-active nginx)"
echo "✓ postgresql: $(systemctl is-active postgresql)"
echo "PM2:"
sudo -u ${APP_USER} pm2 list 2>&1 | tail -8
echo "SSL:"
ls /etc/letsencrypt/live/ 2>/dev/null || echo "  нет"
echo "URLs:"
echo "  https://${APP_DOMAIN}"
echo "  https://${API_DOMAIN}"
echo "============================================"
