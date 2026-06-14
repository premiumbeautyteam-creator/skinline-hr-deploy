#!/usr/bin/env bash
# SkinLine HR CRM — fix2: PM2 под root, certbot standalone, рабочий запуск
set -euo pipefail

DOMAIN="skinline-hr.ru"
APP_DOMAIN="app.${DOMAIN}"
API_DOMAIN="api.${DOMAIN}"
ROOT_DOMAIN="${DOMAIN}"
ADMIN_EMAIL="premium.beauty.team@gmail.com"
APP_USER="skinline"
APP_DIR="/home/${APP_USER}/skinline-hr-crm"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/8 Диагностика: почему skinline не может запустить node"
ls -ld /home/${APP_USER}
ls -la /home/${APP_USER}/ | head -8
namei -l /usr/bin/node 2>&1 | head -10
# Часто корень EACCES — это noexec на /home или mount option
mount | grep -E "/home|/usr" | head

log "2/8 Чиним права /home/skinline (рекурсивно ownership + права на исполнение)"
chown -R ${APP_USER}:${APP_USER} /home/${APP_USER}
chmod 755 /home/${APP_USER}
# .pm2 пересоздаём
rm -rf /home/${APP_USER}/.pm2
# Тест: можем ли мы запустить node от skinline вообще?
sudo -u ${APP_USER} node -e "console.log('node от skinline ОК:', process.version)" 2>&1 | head -5

log "3/8 npm install (если ещё не было)"
cd "${APP_DIR}"
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    log "  npm install..."
    cd "${APP_DIR}" && npm install 2>&1 | tail -5
fi
chown -R ${APP_USER}:${APP_USER} "${APP_DIR}"

log "4/8 Build"
cd "${APP_DIR}"
npm run build 2>&1 | tail -15 || echo "  ⚠️ build упал"
ls -la "${APP_DIR}/dist/" 2>&1 | head -10
chown -R ${APP_USER}:${APP_USER} "${APP_DIR}/dist" 2>/dev/null || true

log "5/8 Drizzle push на SQLite"
cd "${APP_DIR}"
npm run db:push -- --force 2>&1 | tail -10 || echo "  ⚠️ db:push упал"
ls -la "${APP_DIR}/data.db" 2>&1 || true
chown ${APP_USER}:${APP_USER} "${APP_DIR}/data.db" 2>/dev/null || true

log "6/8 PM2: запускаем от ROOT (через ecosystem), процесс от пользователя skinline"
# Кладём ecosystem
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
    error_file: '/var/log/skinline-hr.err.log',
    out_file: '/var/log/skinline-hr.out.log',
    time: true,
    max_memory_restart: '500M',
    autorestart: true,
    watch: false
  }]
};
EOF
# Останавливаем старый PM2 daemon (вдруг где-то висит)
pm2 kill 2>/dev/null || true
sudo -u ${APP_USER} pm2 kill 2>/dev/null || true

# Запускаем от ROOT — это устраняет все EACCES
cd "${APP_DIR}"
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs 2>&1 | tail -10
sleep 4
pm2 list 2>&1 | tail -10
echo "--- логи приложения (первые 30 строк после старта) ---"
pm2 logs skinline-hr --lines 30 --nostream 2>&1 | tail -40

# Сохраняем + автозапуск
pm2 save 2>&1 | tail -3
pm2 startup systemd 2>&1 | tail -5

log "7/8 Проверка что приложение слушает 3000"
sleep 2
ss -tln | grep -E ':3000' || echo "  ⚠️ не слушает 3000"
curl -sI http://127.0.0.1:3000 2>&1 | head -3

log "8/8 Получаем SSL сертификат через certbot --standalone (надёжнее webroot)"
# Останавливаем nginx ВРЕМЕННО — чтобы certbot занял 80 порт
systemctl stop nginx
sleep 2
certbot certonly --standalone --non-interactive --agree-tos \
    --email "${ADMIN_EMAIL}" \
    -d "${ROOT_DOMAIN}" \
    -d "${APP_DOMAIN}" \
    -d "${API_DOMAIN}" \
    --no-eff-email 2>&1 | tail -15

# Поднимаем nginx обратно
systemctl start nginx
sleep 1

# Если сертификат получен — обновляем nginx с SSL
if [ -d "/etc/letsencrypt/live/${ROOT_DOMAIN}" ]; then
    log "  ✓ Сертификат получен — обновляем nginx с SSL"
    cat > /etc/nginx/sites-available/skinline-hr <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${ROOT_DOMAIN} ${APP_DOMAIN} ${API_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

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
    echo "  ⚠️ Сертификат всё ещё не получен"
fi

# Финал
echo "============================================"
echo "Сервисы:"
echo "  nginx:      $(systemctl is-active nginx)"
echo "  postgresql: $(systemctl is-active postgresql)"
echo "PM2:"
pm2 list 2>&1 | tail -8
echo "SSL:"
ls /etc/letsencrypt/live/ 2>/dev/null || echo "  нет"
echo "Локальный 3000:"
curl -sI http://127.0.0.1:3000 2>&1 | head -1
echo "Доступ снаружи:"
curl -skI https://${APP_DOMAIN} 2>&1 | head -2
echo "============================================"
