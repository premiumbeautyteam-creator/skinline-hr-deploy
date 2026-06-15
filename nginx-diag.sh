#!/bin/bash
exec > /tmp/ngd.out 2>&1
echo "===== sites-enabled ====="
ls -la /etc/nginx/sites-enabled/
echo ""
echo "===== sites-available ====="
ls -la /etc/nginx/sites-available/ 2>/dev/null
echo ""
echo "===== server_name directives ====="
nginx -T 2>/dev/null | grep -E "server_name" | sort -u
echo ""
echo "===== listen + server_name pairs ====="
nginx -T 2>/dev/null | grep -E "listen|server_name" | head -30
echo ""
echo "===== Test local curl per Host header ====="
curl -s -o /dev/null -w "app: http=%{http_code}\n" -H "Host: app.skinline-hr.ru" -k https://127.0.0.1/
curl -s -o /dev/null -w "api: http=%{http_code}\n" -H "Host: api.skinline-hr.ru" -k https://127.0.0.1/
curl -s -o /dev/null -w "skinline-hr.ru: http=%{http_code}\n" -H "Host: skinline-hr.ru" -k https://127.0.0.1/
echo ""
echo "===== DNS resolution ====="
dig +short app.skinline-hr.ru
echo "---"
dig +short api.skinline-hr.ru
echo "---"
dig +short skinline-hr.ru
echo ""
echo "===== Certs check ====="
ls /etc/letsencrypt/live/ 2>/dev/null
echo ""
echo "===== Nginx errors last 1h ====="
journalctl -u nginx --since "1 hour ago" --no-pager 2>&1 | tail -20
echo ""
echo "===== nginx -t output ====="
nginx -t 2>&1
echo ""
echo "===== DONE ====="
