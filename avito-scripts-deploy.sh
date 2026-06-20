#!/usr/bin/env bash
# Разворачивает Python-скрипты Avito на VPS и настраивает cron.
# Запуск на VPS под root:
#   curl -fsSL https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/claude/avito-advertising-plan-3azjc6/avito-scripts-deploy.sh | bash

set -e

BRANCH="claude/avito-advertising-plan-3azjc6"
RAW="https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/${BRANCH}"
SCRIPTS_DIR="/opt/avito-scripts"
ENV_FILE="/home/skinline/skinline-hr-crm/.env"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/5 Создаю директорию скриптов"
mkdir -p "$SCRIPTS_DIR"
echo "  ✓ $SCRIPTS_DIR"

log "2/5 Скачиваю Python-скрипты"
for script in avito_bid_optimizer.py avito_cpl_monitor.py; do
    curl -fsSL "${RAW}/${script}" -o "${SCRIPTS_DIR}/${script}"
    chmod +x "${SCRIPTS_DIR}/${script}"
    echo "  ✓ $script"
done

log "3/5 Читаю переменные из .env"
if [ ! -f "$ENV_FILE" ]; then
    echo "  ✗ $ENV_FILE не найден"
    exit 1
fi
set -a; source "$ENV_FILE"; set +a

# Проверяем обязательные переменные
for var in AVITO_CLIENT_ID AVITO_CLIENT_SECRET TELEGRAM_BOT_TOKEN; do
    if [ -z "${!var}" ]; then
        echo "  ⚠ $var не задан в $ENV_FILE (некоторые функции могут не работать)"
    else
        echo "  ✓ $var найден"
    fi
done

log "4/5 Проверяю pip зависимости (python3-стандартная библиотека, доп. пакеты не нужны)"
python3 -c "import urllib.request, json, argparse; print('  ✓ Python3 stdlib OK')"

log "5/5 Настраиваю cron"
# Генерируем env-переменные для cron
CRON_ENV_FILE="/opt/avito-scripts/.env"
cat > "$CRON_ENV_FILE" <<EOF
AVITO_CLIENT_ID=${AVITO_CLIENT_ID}
AVITO_CLIENT_SECRET=${AVITO_CLIENT_SECRET}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-5836672698}
EOF
chmod 600 "$CRON_ENV_FILE"
echo "  ✓ $CRON_ENV_FILE создан"

# Создаём cron-обёртку
CRON_WRAPPER="/opt/avito-scripts/run_with_env.sh"
cat > "$CRON_WRAPPER" <<'WRAPPER'
#!/usr/bin/env bash
# Запускает Python-скрипт с переменными из .env
set -a
source /opt/avito-scripts/.env
set +a
exec python3 "$@"
WRAPPER
chmod +x "$CRON_WRAPPER"

# Выводим текущий crontab и предлагаем добавить задачи
CRON_FILE="/tmp/avito-cron-tasks.txt"
cat > "$CRON_FILE" <<'CRONTAB'
# Avito Skin Line — мониторинг и управление ставками

# Ежедневный дайджест в 09:00 МСК (UTC+3 = 06:00 UTC)
0 6 * * * /opt/avito-scripts/run_with_env.sh /opt/avito-scripts/avito_cpl_monitor.py --period 7 >> /var/log/avito-monitor.log 2>&1

# Еженедельный дайджест за 30 дней (понедельник 09:10 МСК)
10 6 * * 1 /opt/avito-scripts/run_with_env.sh /opt/avito-scripts/avito_cpl_monitor.py --period 30 >> /var/log/avito-monitor.log 2>&1

# Автоматическое снижение ставок (раз в неделю, воскресенье 10:00 МСК)
# ВНИМАНИЕ: раскомментировать только после проверки dry-run!
# 0 7 * * 0 /opt/avito-scripts/run_with_env.sh /opt/avito-scripts/avito_bid_optimizer.py --action laser_reduce >> /var/log/avito-bids.log 2>&1
CRONTAB

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo " CRON-задачи для добавления (crontab -e):"
echo "══════════════════════════════════════════════════════════════════"
cat "$CRON_FILE"
echo "══════════════════════════════════════════════════════════════════"
echo ""
read -r -p "Добавить эти задачи в crontab? [y/N] " confirm
if [[ "$confirm" =~ ^[Yy]$ ]]; then
    (crontab -l 2>/dev/null | grep -v avito-scripts; cat "$CRON_FILE") | crontab -
    echo "  ✓ Cron обновлён"
    crontab -l | grep -A1 -B1 avito
else
    echo "  Cron не изменён. Добавьте задачи вручную через: crontab -e"
fi

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo " Скрипты установлены в: $SCRIPTS_DIR"
echo ""
echo " Тестовый запуск (статистика за 7 дней):"
echo "   $CRON_WRAPPER $SCRIPTS_DIR/avito_cpl_monitor.py --period 7 --no-telegram"
echo ""
echo " Посмотреть лазерные объявления:"
echo "   $CRON_WRAPPER $SCRIPTS_DIR/avito_bid_optimizer.py --action list_laser"
echo ""
echo " Тест снижения ставок (без изменений):"
echo "   $CRON_WRAPPER $SCRIPTS_DIR/avito_bid_optimizer.py --action laser_reduce --dry-run"
echo ""
echo " Применить снижение ставок:"
echo "   $CRON_WRAPPER $SCRIPTS_DIR/avito_bid_optimizer.py --action laser_reduce"
echo ""
echo " Отключить Криополиз:"
echo "   $CRON_WRAPPER $SCRIPTS_DIR/avito_bid_optimizer.py --action kriopoliz_off --dry-run"
echo "══════════════════════════════════════════════════════════════════"
