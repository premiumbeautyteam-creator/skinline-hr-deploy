#!/usr/bin/env bash
# fix4 — Чистая переустановка зависимостей (rollup optional bug)
APP_USER="skinline"
APP_DIR="/home/${APP_USER}/skinline-hr-crm"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/5 Чистим node_modules + package-lock + ставим rollup явно"
cd "${APP_DIR}" || exit 1
rm -rf node_modules package-lock.json
echo "  Установка с --include=optional"
npm install --include=optional 2>&1 | tail -10
echo "  Дополнительно ставим rollup linux x64 явно"
npm install --save-dev @rollup/rollup-linux-x64-gnu 2>&1 | tail -5
chown -R ${APP_USER}:${APP_USER} "${APP_DIR}"

log "2/5 Build"
cd "${APP_DIR}"
npm run build 2>&1 | tail -25
echo "--- dist/ ---"
ls -la "${APP_DIR}/dist/" 2>&1 | head -10
echo "--- размер dist/index.cjs ---"
ls -lh "${APP_DIR}/dist/index.cjs" 2>&1
echo "--- наличие dist/public (фронт) ---"
ls -la "${APP_DIR}/dist/public" 2>&1 | head -5

log "3/5 Тест запуска вручную (10 сек)"
cd "${APP_DIR}"
timeout 10 node dist/index.cjs > /tmp/manual.log 2>&1 &
MPID=$!
sleep 6
echo "--- вывод за 6 сек ---"
cat /tmp/manual.log
echo "--- порт 3000? ---"
ss -tln | grep ':3000' && echo "  ✓ слушает 3000" || echo "  ✗ НЕ слушает"
kill $MPID 2>/dev/null
wait $MPID 2>/dev/null

log "4/5 PM2 — запуск"
pm2 kill 2>/dev/null
sleep 1
cd "${APP_DIR}"
pm2 delete all 2>/dev/null
pm2 start ecosystem.config.cjs 2>&1 | tail -8
sleep 5
pm2 list
echo "--- PM2 логи ---"
pm2 logs skinline-hr --lines 30 --nostream 2>&1 | tail -35
pm2 save
pm2 startup systemd -u root --hp /root 2>&1 | tail -2

log "5/5 Финальные проверки"
echo "--- порты ---"
ss -tln | grep -E ':(3000|443|80)'
echo "--- localhost 3000 ---"
curl -sI http://127.0.0.1:3000 2>&1 | head -3
echo "--- https снаружи ---"
curl -skI https://app.skinline-hr.ru 2>&1 | head -3
curl -sk https://app.skinline-hr.ru 2>&1 | head -c 200 && echo
echo "============================================"
echo "✓ nginx:     $(systemctl is-active nginx)"
echo "✓ SSL есть:  $(ls /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem 2>/dev/null && echo OK || echo NO)"
echo "PM2:"
pm2 list 2>&1 | tail -6
echo "============================================"
