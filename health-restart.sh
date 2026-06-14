#!/usr/bin/env bash
# Диагностика и подъём CRM после сбоя.
set -e

echo "==> 1) nginx status"
systemctl status nginx --no-pager | head -8 || true
echo
echo "==> 2) PM2"
pm2 list | head -10 || true
echo
echo "==> 3) Слушающие порты"
ss -tlnp | grep -E ':(80|443|3000)' || echo "ничего не слушает"
echo
echo "==> 4) Последние логи PM2"
pm2 logs skinline-hr --lines 30 --nostream 2>&1 | tail -40 || true
echo
echo "==> 5) Тест локально через 443"
curl -sI -k -m 5 https://127.0.0.1/ -H 'Host: app.skinline-hr.ru' | head -3 || echo "443 не отвечает"
echo
echo "==> 6) Поднимаю всё"
systemctl restart nginx || true
sleep 1
pm2 restart skinline-hr --update-env || pm2 start /home/skinline/skinline-hr-crm/dist/index.cjs --name skinline-hr --cwd /home/skinline/skinline-hr-crm
sleep 3
echo
echo "==> 7) Повторный тест"
ss -tlnp | grep -E ':(80|443|3000)'
echo
curl -sI -k -m 5 https://127.0.0.1/ -H 'Host: app.skinline-hr.ru' | head -3 || echo "443 всё ещё нет"
echo
echo "==> 8) PM2 после restart"
pm2 list | head -10
echo
echo "==> Готово"
