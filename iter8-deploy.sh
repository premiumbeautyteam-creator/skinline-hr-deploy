#!/bin/bash
# SkinLine HR CRM — iter8 deploy (hh.ru full-cycle integration)
# Idempotent: appends missing HH_*/ENCRYPTION_KEY to .env, reuses npm deps when unchanged.
set -e
exec > >(tee /tmp/iter8-deploy.log) 2>&1

APP_DIR=/home/skinline/skinline-hr-crm
PM2_NAME=skinline-hr-crm
TARBALL_URL=https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/skinline-iter8.tar.gz
ENV_FILE="$APP_DIR/.env"

cd "$APP_DIR"

echo "[1/6] Download tarball..."
curl -fsSL "$TARBALL_URL" -o /tmp/iter8.tar.gz

echo "[2/6] Backup & extract..."
cp -r dist "dist.bak.$(date +%s)" 2>/dev/null || true
# Capture package.json hash before extracting to decide whether deps changed.
PKG_BEFORE=$(sha256sum package.json 2>/dev/null | awk '{print $1}' || echo "none")
tar -xzf /tmp/iter8.tar.gz -C "$APP_DIR"
PKG_AFTER=$(sha256sum package.json 2>/dev/null | awk '{print $1}' || echo "none")

echo "[3/6] Ensure .env has hh.ru + encryption vars (idempotent)..."
touch "$ENV_FILE"
ensure_env() {
  local key="$1" val="$2"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "${key}=${val}" >> "$ENV_FILE"
    echo "  + added ${key}"
  else
    echo "  = ${key} already present"
  fi
}
# ENCRYPTION_KEY must be generated once and kept stable (rotating it invalidates stored tokens).
if ! grep -q "^ENCRYPTION_KEY=" "$ENV_FILE"; then
  echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> "$ENV_FILE"
  echo "  + generated ENCRYPTION_KEY"
else
  echo "  = ENCRYPTION_KEY already present"
fi
ensure_env HH_CLIENT_ID ""
ensure_env HH_CLIENT_SECRET ""
ensure_env HH_REDIRECT_URI "https://api.skinline-hr.ru/api/integrations/hh/callback"
ensure_env HH_EMPLOYER_ID ""
chown skinline:skinline "$ENV_FILE" 2>/dev/null || true
chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "[4/6] Install deps if package.json changed..."
if [ "$PKG_BEFORE" != "$PKG_AFTER" ]; then
  echo "  package.json changed -> npm ci"
  npm ci --omit=optional 2>&1 | tail -10 || npm install 2>&1 | tail -10
else
  echo "  package.json unchanged -> skipping npm ci"
fi

echo "[5/6] Restart app..."
pm2 restart "$PM2_NAME" --update-env || systemctl restart skinline
sleep 4

echo "[6/6] Healthcheck on actual PORT..."
# Read PORT from .env (default 3000 to match this deployment), do not hardcode.
PORT=$(grep -E "^PORT=" "$ENV_FILE" | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'" )
PORT=${PORT:-3000}
echo "  using PORT=${PORT}"
HTTP_CODE=$(curl -s -o /tmp/iter8-health.json -w "%{http_code}" "http://localhost:${PORT}/api/integrations/hh" || echo "000")
echo "  GET /api/integrations/hh -> HTTP ${HTTP_CODE}"
head -c 600 /tmp/iter8-health.json 2>/dev/null || true
echo ""
if [ "$HTTP_CODE" = "200" ]; then
  echo "=== iter8 deploy OK ==="
else
  echo "=== iter8 deploy finished (verify app: pm2 logs ${PM2_NAME}) ==="
fi
