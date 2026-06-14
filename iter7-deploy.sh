#!/bin/bash
set -e
exec > >(tee /tmp/iter7-deploy.log) 2>&1
APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/4] Download tarball..."
curl -fsSL https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/skinline-iter7.tar.gz -o /tmp/iter7.tar.gz

echo "[2/4] Backup & extract..."
cp -r dist dist.bak.$(date +%s) 2>/dev/null || true
tar -xzf /tmp/iter7.tar.gz -C "$APP_DIR"

echo "[3/4] Restart app..."
pm2 restart skinline-hr-crm || systemctl restart skinline
sleep 4

echo "[4/4] Import Avito vacancies..."
curl -s -X POST http://localhost:3000/api/integrations/avito/import-vacancies | head -c 800
echo ""
echo "=== Done ==="
