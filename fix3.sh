#!/usr/bin/env bash
# fix3 — без set -e, чтобы видеть все ошибки и идти дальше
DOMAIN="skinline-hr.ru"
APP_DOMAIN="app.${DOMAIN}"
API_DOMAIN="api.${DOMAIN}"
APP_USER="skinline"
APP_DIR="/home/${APP_USER}/skinline-hr-crm"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/7 npm install (если нужно)"
cd "${APP_DIR}" || exit 1
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    log "  ставим зависимости"
    npm install 2>&1 | tail -8
else
    log "  node_modules уже есть"
fi
chown -R ${APP_USER}:${APP_USER} "${APP_DIR}"

log "2/7 Build"
cd "${APP_DIR}"
npm run build 2>&1 | tail -25
echo "--- dist/ ---"
ls -la "${APP_DIR}/dist/" 2>&1 | head -15
echo "--- проверка dist/index.cjs ---"
ls -la "${APP_DIR}/dist/index.cjs" 2>&1

log "3/7 drizzle db:push (SQLite)"
cd "${APP_DIR}"
echo y | npm run db:push 2>&1 | tail -15
ls -la "${APP_DIR}/data.db" 2>&1
chown ${APP_USER}:${APP_USER} "${APP_DIR}/data.db" 2>/dev/null

log "4/7 .env"
if [ ! -f "${APP_DIR}/.env" ]; then
cat > "${APP_DIR}/.env" <<EOF
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://${APP_DOMAIN}
API_URL=https://${API_DOMAIN}
SESSION_SECRET=$(openssl rand -hex 32)
AVITO_CLIENT_ID=
AVITO_CLIENT_SECRET=
AVITO_WEBHOOK_SECRET=$(openssl rand -hex 24)
EOF
chown ${APP_USER}:${APP_USER} "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"
fi
echo "--- .env (без секретов) ---"
grep -vE "SECRET|SECRET=" "${APP_DIR}/.env"

log "5/7 Тест: запускается ли приложение вручную (10 секунд)?"
cd "${APP_DIR}"
timeout 10 node dist/index.cjs > /tmp/manual_start.log 2>&1 &
MANUAL_PID=$!
sleep 5
echo "--- вывод за первые 5 секунд ---"
cat /tmp/manual_start.log
echo "--- слушает ли 3000? ---"
ss -tln | grep ':3000' || echo "  не слушает"
# Убиваем тестовый процесс
kill $MANUAL_PID 2>/dev/null
wait $MANUAL_PID 2>/dev/null

log "6/7 PM2 — запуск от ROOT (а ecosystem cwd ставим на app dir)"
# Грохаем все PM2 daemon-ы
pm2 kill 2>/dev/null
sudo -u ${APP_USER} pm2 kill 2>/dev/null
sleep 1

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
    autorestart: true
  }]
};
EOF

cd "${APP_DIR}"
pm2 delete all 2>/dev/null
pm2 start ecosystem.config.cjs
sleep 5
pm2 list
echo "--- логи PM2 (последние 30 строк) ---"
pm2 logs skinline-hr --lines 30 --nostream 2>&1 | tail -35

pm2 save
pm2 startup systemd -u root --hp /root 2>&1 | tail -3

log "7/7 Финальные проверки"
echo "--- порты ---"
ss -tln | grep -E ':(3000|443|80)' 
echo "--- localhost 3000 ---"
curl -sI http://127.0.0.1:3000 2>&1 | head -3
echo "--- https снаружи ---"
curl -skI https://${APP_DOMAIN} 2>&1 | head -3
curl -skI https://${DOMAIN} 2>&1 | head -3
echo "--- nginx config check ---"
nginx -t 2>&1
echo "============================================"
echo "✓ nginx:     $(systemctl is-active nginx)"
echo "✓ SSL:       $(ls /etc/letsencrypt/live/${DOMAIN}/fullchain.pem 2>&1 | head -1)"
echo "PM2:"
pm2 list 2>&1 | tail -6
echo "============================================"
