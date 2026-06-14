#!/bin/bash
# Iter3 deploy: Channel autopilot
set -e

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/6] Backup dist..."
[ -d dist ] && cp -r dist "dist.iter2.bak.$(date +%s)" || true

echo "[2/6] Download Iter3 tarball..."
curl -sSL -o /tmp/skinline-iter3.tar.gz \
  https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/skinline-iter3.tar.gz
ls -lh /tmp/skinline-iter3.tar.gz

echo "[3/6] Extract..."
tar xzf /tmp/skinline-iter3.tar.gz -C "$APP_DIR"

echo "[4/6] Ensure ai_knowledge_base.md in both places..."
mkdir -p "$APP_DIR/dist/server/lib"
ls -la "$APP_DIR/server/lib/ai_knowledge_base.md"
cp -f "$APP_DIR/server/lib/ai_knowledge_base.md" "$APP_DIR/dist/server/lib/ai_knowledge_base.md"
ls -la "$APP_DIR/dist/server/lib/ai_knowledge_base.md"

echo "[5/6] npm install (production)..."
npm install --omit=dev 2>&1 | tail -3

echo "[6/6] Restart PM2..."
pm2 restart skinline-hr-crm --update-env
sleep 4
pm2 list

echo ""
echo "--- /api/stages count ---"
curl -s http://localhost:3000/api/stages | python3 -c "import sys,json;d=json.load(sys.stdin);print('stages:',len(d))"
echo "--- /api/channel/settings ---"
curl -s http://localhost:3000/api/channel/settings
echo ""
echo "--- /api/channel/rubrics ---"
curl -s http://localhost:3000/api/channel/rubrics | python3 -c "import sys,json;d=json.load(sys.stdin);print('rubrics:',len(d) if isinstance(d,list) else d)"
echo "--- /api/channel/posts ---"
curl -s http://localhost:3000/api/channel/posts | python3 -c "import sys,json;d=json.load(sys.stdin);print('posts:',len(d) if isinstance(d,list) else d)"
echo "--- /api/ai/test ---"
curl -s -X POST http://localhost:3000/api/ai/test

echo ""
echo "✅ Iter3 deploy DONE"
