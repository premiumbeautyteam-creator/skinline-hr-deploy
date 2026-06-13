#!/usr/bin/env bash
# SkinLine HR CRM — Шаг 2: nginx + Let's Encrypt + PM2 + миграция БД + запуск
# Usage on VPS (run as root):
#   curl -fsSL https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/configure.sh | bash

set -euo pipefail

DOMAIN="skinline-hr.ru"
APP_DOMAIN="app.${DOMAIN}"
API_DOMAIN="api.${DOMAIN}"
ROOT_DOMAIN="${DOMAIN}"
ADMIN_EMAIL="premium.beauty.team@gmail.com"
APP_USER="skinline"
APP_DIR="/home/${APP_USER}/skinline-hr-crm"
APP_PORT=3000

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/8 Конфигурируем nginx (HTTP-only сначала, для challenge)"
cat > /etc/nginx/sites-available/skinline-hr <<EOF
# CRM (app.skinline-hr.ru) + root (skinline-hr.ru)
server {
    listen 80;
    listen [::]:80;
    server_name ${APP_DOMAIN} ${ROOT_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
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

# API (api.skinline-hr.ru) — webhooks от Avito/hh.ru
server {
    listen 80;
    listen [::]:80;
    server_name ${API_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # API эндпоинты идут в тот же бэкенд по префиксу /api
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 25M;
        proxy_read_timeout 60s;
    }
}
EOF

mkdir -p /var/www/html
ln -sf /etc/nginx/sites-available/skinline-hr /etc/nginx/sites-enabled/skinline-hr
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
log "  nginx HTTP-конфиг применён"

log "2/8 Получаем Let's Encrypt сертификат для всех 3 доменов"
certbot --nginx --non-interactive --agree-tos \
    --email "${ADMIN_EMAIL}" \
    -d "${ROOT_DOMAIN}" \
    -d "${APP_DOMAIN}" \
    -d "${API_DOMAIN}" \
    --redirect \
    --no-eff-email 2>&1 | tail -20

log "3/8 Проверка сертификатов"
certbot certificates 2>&1 | tail -15

log "4/8 Установка нужных npm-пакетов для PostgreSQL"
cd "${APP_DIR}"
sudo -u ${APP_USER} npm install pg @types/pg --save 2>&1 | tail -3 || true

log "5/8 Применяем миграции Drizzle (если есть)"
cd "${APP_DIR}"
# Сначала проверим, есть ли drizzle config с поддержкой Postgres
if [ -f "drizzle.config.ts" ]; then
    echo "  drizzle.config.ts найден"
    grep -E "dialect|driver" drizzle.config.ts || true
fi
# Пытаемся прогнать миграцию; если не получится — отметим и продолжим
sudo -u ${APP_USER} bash -c "cd ${APP_DIR} && npx drizzle-kit push --force 2>&1 | tail -20" || \
  echo "  ⚠️ drizzle push не отработал — миграция нужна вручную после правки drizzle.config.ts"

log "6/8 Билд фронта/бэка"
cd "${APP_DIR}"
sudo -u ${APP_USER} bash -c "cd ${APP_DIR} && npm run build 2>&1 | tail -15" || \
  echo "  ⚠️ npm run build упал — будем чинить отдельно"

log "7/8 Настройка PM2 (запуск приложения)"
# Останавливаем старые процессы если есть
sudo -u ${APP_USER} pm2 delete all 2>/dev/null || true

# Создаём ecosystem-файл
cat > "${APP_DIR}/ecosystem.config.cjs" <<'EOF'
module.exports = {
  apps: [{
    name: 'skinline-hr',
    script: 'dist/index.js',
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
    autorestart: true
  }]
};
EOF
chown ${APP_USER}:${APP_USER} "${APP_DIR}/ecosystem.config.cjs"
mkdir -p /home/${APP_USER}/logs
chown ${APP_USER}:${APP_USER} /home/${APP_USER}/logs

# Запускаем приложение
sudo -u ${APP_USER} bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.cjs" 2>&1 | tail -10 || \
  echo "  ⚠️ pm2 start не сработал — проверим dist/index.js"

# Сохраняем и настраиваем автозапуск
sudo -u ${APP_USER} pm2 save 2>&1 | tail -3
env PATH=$PATH:/usr/bin pm2 startup systemd -u ${APP_USER} --hp /home/${APP_USER} 2>&1 | tail -3

log "8/8 Финальная проверка"
echo "============================================"
echo "✓ nginx:      $(systemctl is-active nginx)"
echo "✓ postgresql: $(systemctl is-active postgresql)"
echo "✓ ssh:        $(systemctl is-active ssh)"
echo "PM2 список процессов:"
sudo -u ${APP_USER} pm2 list 2>&1 | tail -15
echo "============================================"
echo "URLs:"
echo "  https://${APP_DOMAIN}"
echo "  https://${API_DOMAIN}"
echo "============================================"
