#!/bin/bash
# Iter4 deploy
set -e

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/7] Backup..."
[ -d dist ] && cp -r dist "dist.iter3.bak.$(date +%s)" || true
cp data.db "data.db.bak.iter4.$(date +%s)"

echo "[2/7] Download tarball..."
curl -sSL -o /tmp/skinline-iter4.tar.gz \
  https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/skinline-iter4.tar.gz

echo "[3/7] Extract..."
tar xzf /tmp/skinline-iter4.tar.gz -C "$APP_DIR"

echo "[4/7] Ensure kb in dist/server/lib..."
mkdir -p "$APP_DIR/dist/server/lib"
cp -f "$APP_DIR/server/lib/ai_knowledge_base.md" "$APP_DIR/dist/server/lib/"

echo "[5/7] Ensure uploads dir..."
mkdir -p "$APP_DIR/uploads"
chmod 755 "$APP_DIR/uploads"

echo "[6/7] npm install (production)..."
npm install --omit=dev 2>&1 | tail -3

echo "[7/7] Restart PM2..."
pm2 restart skinline-hr-crm --update-env
sleep 4
pm2 list

echo ""
echo "--- /api/stages count ---"
curl -s http://localhost:3000/api/stages | python3 -c "import sys,json;d=json.load(sys.stdin);print('stages:',len(d))"
echo "--- /api/quizzes ---"
curl -s http://localhost:3000/api/quizzes | python3 -c "import sys,json;d=json.load(sys.stdin);print('quizzes:',len(d) if isinstance(d,list) else d)"
echo "--- /api/channel/rubrics still works ---"
curl -s http://localhost:3000/api/channel/rubrics | python3 -c "import sys,json;d=json.load(sys.stdin);print('rubrics:',len(d) if isinstance(d,list) else d)"
echo "--- /api/ai/test ---"
curl -s -X POST http://localhost:3000/api/ai/test

echo ""
echo "✅ Iter4 deploy DONE"
