#!/usr/bin/env bash
# Iter1 fix2: cleanly start the new process on port 3000 (now free)
set -e

APP_DIR=/home/skinline/skinline-hr-crm

echo "=== Iter1 fix2: started $(date -u) ==="

cd "$APP_DIR"

# Wipe ALL pm2 processes and start clean
pm2 delete all 2>&1 || true
sleep 1

# Make sure nothing is squatting on 3000
fuser -k 3000/tcp 2>&1 || true
sleep 1

# Start fresh
pm2 start dist/index.cjs --name skinline-hr-crm --update-env
pm2 save
sleep 4

echo "=== PM2 ==="
pm2 status

echo "=== Localhost /api/stages ==="
curl -s http://localhost:3000/api/stages | head -c 600
echo ""

echo "=== Localhost /api/candidates count ==="
curl -s http://localhost:3000/api/candidates | python3 -c "import sys,json; d=json.load(sys.stdin); print('candidates:', len(d) if isinstance(d,list) else d)" 2>/dev/null || echo "fail"

echo "=== Localhost /api/users count ==="
curl -s http://localhost:3000/api/users | python3 -c "import sys,json; d=json.load(sys.stdin); print('users:', len(d) if isinstance(d,list) else d)" 2>/dev/null || echo "fail"

echo "=== Public /api/stages ==="
curl -ks https://api.skinline-hr.ru/api/stages | head -c 600
echo ""

echo "=== Public app ==="
curl -ks -o /dev/null -w 'app: %{http_code}\n' https://app.skinline-hr.ru/

echo "=== Avito self ==="
curl -s http://localhost:3000/api/integrations/avito/self | head -c 200
echo ""

echo "=== If still errored, show logs ==="
pm2 jlist | python3 -c "import sys,json; ps=json.load(sys.stdin); [print(p['name'], p['pm2_env']['status']) for p in ps]" 2>/dev/null || true

echo "=== Iter1 fix2: done $(date -u) ==="
