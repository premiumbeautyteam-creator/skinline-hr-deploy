#!/bin/bash
set +e
echo "=== iptables -L -n -v --line-numbers ==="
iptables -L -n -v --line-numbers 2>&1
echo ""
echo "=== iptables -S ==="
iptables -S 2>&1
echo ""
echo "=== ip6tables -S ==="
ip6tables -S 2>&1
echo ""
echo "=== conntrack on port 80 (last 20) ==="
timeout 5 conntrack -L 2>/dev/null | grep -E "(:80|:443)" | head -20
echo ""
echo "=== TCP 80 from external test via dig+probe ==="
echo "(see /tmp/diag.txt curl results)"
echo ""
echo "=== fail2ban status ==="
fail2ban-client status 2>&1 | head -20
fail2ban-client status sshd 2>&1 | head -10
echo ""
echo "=== nginx error log tail ==="
tail -40 /var/log/nginx/error.log 2>&1
echo ""
echo "=== nginx access log tail (last 30) ==="
tail -30 /var/log/nginx/access.log 2>&1
echo ""
echo "=== check if nginx received the certbot probe ==="
grep "acme-challenge" /var/log/nginx/access.log 2>/dev/null | tail -10
grep "acme-challenge" /var/log/nginx/error.log 2>/dev/null | tail -10
echo ""
echo "=== external probe via Internet ==="
# Probe from the server itself going out and back to verify the public reachability
timeout 8 curl -sS -v http://api.skinline-hr.ru/ 2>&1 | head -25
echo ""
echo "=== /etc/letsencrypt/live ==="
ls -la /etc/letsencrypt/live/ 2>&1
ls -la /etc/letsencrypt/live/skinline-hr.ru/ 2>&1
echo ""
echo "=== current cert SAN ==="
openssl x509 -in /etc/letsencrypt/live/skinline-hr.ru/fullchain.pem -noout -text 2>/dev/null | grep -A2 "Subject Alternative Name"
echo ""
echo "=== /etc/nginx/conf.d/ files ==="
ls -la /etc/nginx/conf.d/ 2>&1
cat /etc/nginx/conf.d/*.conf 2>/dev/null | head -100
