#!/bin/bash
# Iter2 deploy: AI layer (OpenRouter)
set -e

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/8] Backup current dist..."
[ -d dist ] && cp -r dist dist.iter1.bak || true

echo "[2/8] Download Iter2 tarball..."
curl -sSL -o /tmp/skinline-iter2.tar.gz \
  https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main/skinline-iter2.tar.gz
ls -lh /tmp/skinline-iter2.tar.gz

echo "[3/8] Extract over existing project..."
tar xzf /tmp/skinline-iter2.tar.gz -C "$APP_DIR"

echo "[4/8] Ensure ai_knowledge_base.md in server/lib/..."
ls -la "$APP_DIR/server/lib/ai_knowledge_base.md"
ls -la "$APP_DIR/dist/server/lib/ai_knowledge_base.md" 2>/dev/null || cp "$APP_DIR/server/lib/ai_knowledge_base.md" "$APP_DIR/dist/server/lib/ai_knowledge_base.md"

echo "[5/8] Set OpenRouter key in .env..."
# Read existing .env, replace or add OPENROUTER lines
grep -v "^OPENROUTER" "$APP_DIR/.env" > "$APP_DIR/.env.new" 2>/dev/null || touch "$APP_DIR/.env.new"
cat >> "$APP_DIR/.env.new" <<EOF
OPENROUTER_API_KEY=${OPENROUTER_KEY:?OPENROUTER_KEY env var required}
CUSTOM_CRED_OPENROUTER_AI_TOKEN=${OPENROUTER_KEY}
CUSTOM_CRED_OPENROUTER_AI_URL=https://openrouter.ai/api/v1
EOF
mv "$APP_DIR/.env.new" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

echo "[6/8] npm install (production only if package.json changed)..."
cd "$APP_DIR"
npm install --omit=dev 2>&1 | tail -5

echo "[7/8] Restart PM2..."
pm2 restart skinline-hr-crm --update-env
sleep 3
pm2 list

echo "[8/8] Health checks..."
echo "--- /api/stages ---"
curl -s http://localhost:3000/api/stages | head -c 200
echo ""
echo "--- /api/settings ---"
curl -s http://localhost:3000/api/settings | head -c 500
echo ""
echo "--- /api/ai/test ---"
curl -s -X POST http://localhost:3000/api/ai/test | head -c 500
echo ""
echo "--- pm2 logs (tail) ---"
pm2 logs skinline-hr-crm --lines 20 --nostream

echo ""
echo "✅ Iter2 deploy DONE"
