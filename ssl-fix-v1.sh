#!/bin/bash
set +e
echo "=== nginx -T | grep listen 80 ==="
nginx -T 2>/dev/null | grep -B2 -A15 "listen 80" | head -200
echo ""
echo "=== /etc/nginx/sites-enabled/ ==="
ls -la /etc/nginx/sites-enabled/
echo ""
echo "=== sites-available/skinline-hr ==="
cat /etc/nginx/sites-available/skinline-hr* 2>/dev/null | head -200
echo ""
echo "=== port 80 listeners ==="
ss -tlnp | grep ':80 '
echo ""
echo "=== curl localhost:80 with each Host ==="
for h in skinline-hr.ru api.skinline-hr.ru app.skinline-hr.ru www.skinline-hr.ru; do
  echo "--- Host: $h ---"
  curl -sS -I --max-time 5 -H "Host: $h" "http://127.0.0.1/.well-known/acme-challenge/test" 2>&1 | head -10
done
echo ""
echo "=== UFW/iptables port 80 ==="
ufw status 2>/dev/null | head -20
iptables -L INPUT -n 2>/dev/null | grep -E "(80|DROP|REJECT)" | head -20
