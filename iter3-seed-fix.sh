#!/bin/bash
# Iter3 seed fix: добавляет channel_settings и content_rubrics в существующую БД
set -e

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/3] Backup DB..."
cp data.db "data.db.bak.iter3.$(date +%s)"

echo "[2/3] Seed channel_settings + content_rubrics + app_settings (autopilot)..."
python3 <<'PY'
import sqlite3, datetime, json
con = sqlite3.connect("/home/skinline/skinline-hr-crm/data.db")
cur = con.cursor()
now = datetime.datetime.utcnow().isoformat() + "Z"

# channel_settings
n = cur.execute("SELECT COUNT(*) FROM channel_settings").fetchone()[0]
print(f"channel_settings rows: {n}")
if n == 0:
    cur.execute("""INSERT INTO channel_settings
        (id, channel_username, channel_title, autopilot_enabled, posts_per_week, preferred_hours, preferred_days, last_post_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
        ("ch_main", "@SkinLineHR", "SKIN LINE | HR", 0, 2, json.dumps([10,14,18]), json.dumps([1,3,5]), None, now, now))
    print("  → channel_settings inserted")
else:
    # update channel_title and username from real chat
    cur.execute("UPDATE channel_settings SET channel_username=?, channel_title=?, updated_at=? WHERE 1=1",
                ("@SkinLineHR", "SKIN LINE | HR", now))
    print("  → channel_settings updated")

# content_rubrics
n = cur.execute("SELECT COUNT(*) FROM content_rubrics").fetchone()[0]
print(f"content_rubrics rows: {n}")
if n == 0:
    rubrics = [
        ("studio_life", "Жизнь студии", "Закулисье, день мастера, оборудование, эстетика студии. Покажи, как красиво и уютно работать в Skin Line.", 3, 1),
        ("review", "Отзывы", "Реальные истории сотрудников от первого лица: как пришли, чему научились, что нравится.", 2, 1),
        ("tips", "Советы", "Навыки косметолога, тонкости лазерной эпиляции, профессиональное развитие, обучение.", 3, 1),
        ("poll", "Опросы", "Вовлечение аудитории через опросы: о карьере, о предпочтениях в работе, о мечтах.", 1, 1),
        ("vacancy", "Вакансии", "Приглашение присоединиться к команде Skin Line: условия, преимущества, ссылка на бота.", 1, 1),
    ]
    for r in rubrics:
        cur.execute("INSERT INTO content_rubrics (key, name, description, weight, active) VALUES (?,?,?,?,?)", r)
    print(f"  → {len(rubrics)} content_rubrics inserted")

# Show final state
print("\nFinal state:")
print(" channel_settings:")
for row in cur.execute("SELECT id, channel_username, channel_title, autopilot_enabled, posts_per_week FROM channel_settings"):
    print(f"   {row}")
print(" content_rubrics:")
for row in cur.execute("SELECT key, name, weight, active FROM content_rubrics"):
    print(f"   {row}")

con.commit()
con.close()
PY

echo "[3/3] Restart PM2..."
pm2 restart skinline-hr-crm
sleep 3
echo ""
echo "--- /api/channel/settings ---"
curl -s http://localhost:3000/api/channel/settings
echo ""
echo "--- /api/channel/rubrics ---"
curl -s http://localhost:3000/api/channel/rubrics | python3 -m json.tool | head -40

echo ""
echo "✅ Iter3 seed fix DONE"
