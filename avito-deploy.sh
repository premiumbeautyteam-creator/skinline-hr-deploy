#!/usr/bin/env bash
# Обновление CRM до версии с Avito Messenger интеграцией.
# Запуск на VPS под root:
#   curl -fsSL https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/avito-deploy.sh | bash

set -e

REPO_RAW="https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main"
APP_DIR="/home/skinline/skinline-hr-crm"
BACKUP_DIR="/home/skinline/backups"

echo "==> Бэкап текущей версии"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
if [ -d "$APP_DIR" ]; then
  tar -C /home/skinline -czf "$BACKUP_DIR/skinline-hr-crm-$TS.tar.gz" --exclude='skinline-hr-crm/node_modules' --exclude='skinline-hr-crm/dist' skinline-hr-crm 2>/dev/null || true
  echo "Бэкап: $BACKUP_DIR/skinline-hr-crm-$TS.tar.gz"
fi

echo "==> Скачиваю новый исходник"
cd /tmp
rm -f skinline-hr-crm.tar.gz
curl -fsSL "$REPO_RAW/skinline-hr-crm.tar.gz" -o skinline-hr-crm.tar.gz
ls -lh skinline-hr-crm.tar.gz

echo "==> Сохраняю .env и data.db"
cp -p "$APP_DIR/.env" /tmp/skinline.env.bak 2>/dev/null || true
cp -p "$APP_DIR/data.db" /tmp/skinline.data.db.bak 2>/dev/null || true

echo "==> Распаковка"
cd /home/skinline
# не сносим node_modules, чтобы избежать долгого npm install
rm -rf skinline-hr-crm/server skinline-hr-crm/client skinline-hr-crm/shared skinline-hr-crm/script skinline-hr-crm/dist
tar -xzf /tmp/skinline-hr-crm.tar.gz
chown -R skinline:skinline skinline-hr-crm

echo "==> Восстанавливаю .env и data.db"
[ -f /tmp/skinline.env.bak ] && cp -p /tmp/skinline.env.bak "$APP_DIR/.env"
[ -f /tmp/skinline.data.db.bak ] && cp -p /tmp/skinline.data.db.bak "$APP_DIR/data.db"
chown skinline:skinline "$APP_DIR/.env" "$APP_DIR/data.db" 2>/dev/null || true

echo "==> Сборка"
cd "$APP_DIR"
# на случай новых зависимостей
sudo -u skinline npm install --include=optional --no-audit --no-fund 2>&1 | tail -3
sudo -u skinline npm run build 2>&1 | tail -8

echo "==> Перезапуск PM2"
pm2 restart skinline-hr --update-env
sleep 2
pm2 status

echo "==> Проверка endpoint /api/integrations"
curl -fsS https://app.skinline-hr.ru/api/integrations | head -200 || true
echo
echo "==> Проверка /api/integrations/avito/self (через локальный порт)"
curl -fsS http://127.0.0.1:3000/api/integrations/avito/self || true
echo
echo "==> Готово"
