#!/usr/bin/env bash
# Запуск оптимизатора ставок Avito на VPS.
# Запуск на VPS под root:
#   curl -fsSL https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/claude/avito-advertising-plan-3azjc6/avito-bid-run.sh | bash -s -- [ACTION] [--dry-run]
#
# Примеры:
#   ... | bash -s -- stats              # сводная статистика за 30 дней
#   ... | bash -s -- list_laser         # показать все лазерные объявления
#   ... | bash -s -- laser_reduce --dry-run   # показать план снижения ставок
#   ... | bash -s -- laser_reduce       # применить снижение ставок
#   ... | bash -s -- kriopoliz_off      # снять Криополиз с публикации

set -e

ACTION="${1:-stats}"
DRY_RUN="${2:-}"

BRANCH="claude/avito-advertising-plan-3azjc6"
SCRIPT_URL="https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/${BRANCH}/avito_bid_optimizer.py"
ENV_FILE="/home/skinline/skinline-hr-crm/.env"
WORK_DIR="/tmp/avito-bid-optimizer"

log() { echo -e "\n\033[1;36m[$(date +%H:%M:%S)] $*\033[0m"; }

log "1/4 Создаю рабочую директорию"
mkdir -p "$WORK_DIR"

log "2/4 Скачиваю скрипт оптимизатора"
curl -fsSL "$SCRIPT_URL" -o "$WORK_DIR/avito_bid_optimizer.py"
echo "  ✓ Скрипт загружен"

log "3/4 Читаю Avito ключи из .env"
if [ ! -f "$ENV_FILE" ]; then
    echo "  ✗ Файл $ENV_FILE не найден"
    exit 1
fi
set -a
source "$ENV_FILE"
set +a
if [ -z "$AVITO_CLIENT_ID" ] || [ -z "$AVITO_CLIENT_SECRET" ]; then
    echo "  ✗ AVITO_CLIENT_ID или AVITO_CLIENT_SECRET не найдены в $ENV_FILE"
    exit 1
fi
echo "  ✓ Ключи загружены (CLIENT_ID=${AVITO_CLIENT_ID:0:8}…)"

log "4/4 Запускаю оптимизатор: action=${ACTION} dry_run=${DRY_RUN}"
cd "$WORK_DIR"
export AVITO_CLIENT_ID AVITO_CLIENT_SECRET
python3 avito_bid_optimizer.py --action "$ACTION" $DRY_RUN

echo ""
echo "============================================"
echo "Завершено: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Лог сохранён: $WORK_DIR/"
echo "============================================"
