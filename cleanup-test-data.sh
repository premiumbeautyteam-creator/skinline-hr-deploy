#!/bin/bash
# Удаление всех тестовых сидовых кандидатов и связанных сущностей
# Сохраняем: vacancies, crm_users, ai_settings, channel_settings, content_rubrics, pulse_surveys, quizzes, scorecard_templates, company_ratings
set -e

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/4] Backup DB..."
cp data.db "data.db.bak.cleanup.$(date +%s)"

echo "[2/4] Count before..."
python3 <<'PY'
import sqlite3
con = sqlite3.connect("/home/skinline/skinline-hr-crm/data.db")
cur = con.cursor()
for t in ["candidates", "messages", "tasks", "scheduled_actions", "stage_events", "documents", "telegram_links", "quiz_attempts", "ai_calls", "alerts", "pulse_responses", "probation_tracks", "probation_checkpoints", "reserve_pool", "referrals", "referral_codes", "interview_videos", "scorecard_responses"]:
    try:
        n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {n}")
    except sqlite3.OperationalError as e:
        print(f"  {t}: (no table)")
con.close()
PY

echo "[3/4] Delete all candidates and related entities..."
python3 <<'PY'
import sqlite3
con = sqlite3.connect("/home/skinline/skinline-hr-crm/data.db")
cur = con.cursor()
# Удаляем зависимые сущности сначала
for t in ["messages", "tasks", "scheduled_actions", "stage_events", "documents", "telegram_links",
          "quiz_attempts", "ai_calls", "alerts", "pulse_responses",
          "probation_checkpoints", "probation_tracks", "reserve_pool",
          "referrals", "referral_codes",
          "interview_videos", "scorecard_responses",
          "candidates"]:
    try:
        cur.execute(f"DELETE FROM {t}")
        print(f"  cleared: {t} ({cur.rowcount} rows)")
    except sqlite3.OperationalError as e:
        print(f"  skip: {t} -> {e}")
con.commit()
con.close()
PY

echo "[4/4] Verify after..."
python3 <<'PY'
import sqlite3
con = sqlite3.connect("/home/skinline/skinline-hr-crm/data.db")
cur = con.cursor()
print("After cleanup:")
for t in ["candidates", "messages", "tasks", "vacancies", "crm_users", "scorecard_templates", "pulse_surveys", "company_ratings"]:
    try:
        n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {n}")
    except sqlite3.OperationalError:
        print(f"  {t}: (no table)")
con.close()
PY

echo "Restart app..."
pm2 restart skinline-hr-crm || systemctl restart skinline || true
sleep 2

echo ""
echo "Done. Дашборд должен показать 0 кандидатов."
