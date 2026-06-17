#!/usr/bin/env bash
# SkinLine HR CRM — VPS bootstrap (Ubuntu 24.04, Timeweb MSK-1)
# Usage on fresh server (run as root):
#   curl -fsSL https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/bootstrap.sh | bash

set -euo pipefail

DOMAIN="skinline-hr.ru"
APP_DOMAIN="app.${DOMAIN}"
API_DOMAIN="api.${DOMAIN}"
ADMIN_EMAIL="premium.beauty.team@gmail.com"
APP_USER="skinline"
APP_DIR="/home/${APP_USER}/skinline-hr-crm"
REPO_RAW="https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/10 apt update + базовый софт"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget gnupg2 ca-certificates lsb-release \
    software-properties-common ufw fail2ban git nginx certbot \
    python3-certbot-nginx build-essential rsync jq postgresql postgresql-contrib

log "2/10 Установка Node.js 20.x"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -qq nodejs
node --version && npm --version

log "3/10 Установка PM2 глобально"
npm install -g pm2@latest

log "4/10 Настройка firewall (UFW)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 22000/tcp comment 'SSH-alt'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose

log "5/10 Создание пользователя ${APP_USER}"
if ! id "${APP_USER}" &>/dev/null; then
    useradd -m -s /bin/bash "${APP_USER}"
    usermod -aG sudo "${APP_USER}"
    mkdir -p /home/${APP_USER}/.ssh
    cp /root/.ssh/authorized_keys /home/${APP_USER}/.ssh/authorized_keys 2>/dev/null || true
    chown -R ${APP_USER}:${APP_USER} /home/${APP_USER}/.ssh
    chmod 700 /home/${APP_USER}/.ssh
    chmod 600 /home/${APP_USER}/.ssh/authorized_keys 2>/dev/null || true
fi

log "6/10 Загрузка и распаковка CRM"
mkdir -p "${APP_DIR}"
cd /home/${APP_USER}
curl -fsSL "${REPO_RAW}/skinline-hr-crm.tar.gz" -o /tmp/crm.tar.gz
tar -xzf /tmp/crm.tar.gz -C /home/${APP_USER}/
# tar содержит skinline-hr-crm/ — переименуем в APP_DIR если нужно
if [ -d "/home/${APP_USER}/skinline-hr-crm" ] && [ "${APP_DIR}" != "/home/${APP_USER}/skinline-hr-crm" ]; then
    mv "/home/${APP_USER}/skinline-hr-crm" "${APP_DIR}"
fi
chown -R ${APP_USER}:${APP_USER} "${APP_DIR}"
rm -f /tmp/crm.tar.gz
ls -la "${APP_DIR}" | head -15

log "7/10 PostgreSQL: создание базы skinline_hr"
DB_PASS=$(openssl rand -hex 16)
sudo -u postgres psql <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'skinline') THEN
    CREATE USER skinline WITH PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
CREATE DATABASE skinline_hr OWNER skinline ENCODING 'UTF8';
GRANT ALL PRIVILEGES ON DATABASE skinline_hr TO skinline;
EOF
echo "DATABASE_URL=postgres://skinline:${DB_PASS}@127.0.0.1:5432/skinline_hr" > /root/db_credentials.env
chmod 600 /root/db_credentials.env

log "8/10 npm install в проекте"
cd "${APP_DIR}"
sudo -u ${APP_USER} npm ci --omit=optional 2>&1 | tail -10 || sudo -u ${APP_USER} npm install 2>&1 | tail -10

log "9/10 Подготовка .env (заглушка — реальные ключи допишутся отдельно)"
cat > "${APP_DIR}/.env" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://skinline:${DB_PASS}@127.0.0.1:5432/skinline_hr
PUBLIC_URL=https://${APP_DOMAIN}
API_URL=https://${API_DOMAIN}
SESSION_SECRET=$(openssl rand -hex 32)
# Шифрование токенов интеграций (AES-256-GCM, 32 байта = 64 hex)
ENCRYPTION_KEY=$(openssl rand -hex 32)
# Avito (заполнить после регенерации ключей в кабинете)
AVITO_CLIENT_ID=
AVITO_CLIENT_SECRET=
AVITO_WEBHOOK_SECRET=$(openssl rand -hex 24)
# hh.ru OAuth (заполнить значениями из кабинета работодателя hh.ru)
HH_CLIENT_ID=
HH_CLIENT_SECRET=
HH_REDIRECT_URI=https://${API_DOMAIN}/api/integrations/hh/callback
HH_EMPLOYER_ID=
EOF
chown ${APP_USER}:${APP_USER} "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"

log "10/10 Готово. Дальше — nginx, SSL, PM2 (отдельный шаг)"
echo "============================================"
echo "✓ Базовая установка завершена"
echo "  Server: $(hostname)"
echo "  IP:     $(hostname -I | awk '{print $1}')"
echo "  Node:   $(node -v)"
echo "  npm:    $(npm -v)"
echo "  PM2:    $(pm2 -v 2>/dev/null || echo 'installed')"
echo "  PostgreSQL: $(sudo -u postgres psql -tc 'SELECT version();' | head -1 | xargs)"
echo "  App dir: ${APP_DIR}"
echo "  DB creds: /root/db_credentials.env"
echo "============================================"
