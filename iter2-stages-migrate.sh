#!/bin/bash
# Migrate old stage values to new 14-stage scheme
set -e

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

echo "[1/5] Stop app temporarily to safely migrate DB..."
pm2 stop skinline-hr-crm

echo "[2/5] Backup DB..."
cp data.db "data.db.bak.$(date +%s)"
ls -la data.db*

echo "[3/5] Show current stage distribution..."
python3 <<'PY'
import sqlite3
c = sqlite3.connect("/home/skinline/skinline-hr-crm/data.db")
for row in c.execute("SELECT stage, COUNT(*) FROM candidates GROUP BY stage ORDER BY 2 DESC"):
    print(f"  {row[0]:20s} {row[1]}")
PY

echo "[4/5] Apply stage migration..."
python3 <<'PY'
import sqlite3, datetime
c = sqlite3.connect("/home/skinline/skinline-hr-crm/data.db")
cur = c.cursor()
# Map: old_stage -> new_stage
mapping = {
    "new":          "form_filled",
    "screening":    "in_work",
    "test_service": "video_interview",
    "documents":    "studio_demo",
    "offer":        "scheduled",
    "hired":        "official",
    "dismissed":    "dismissed",
    "rejected":     "rejected",
    "reserve":      "reserve",
}
now = datetime.datetime.utcnow().isoformat() + "Z"

# Update each candidate
rows = cur.execute("SELECT id, stage FROM candidates").fetchall()
updated = 0
for cid, old_stage in rows:
    new_stage = mapping.get(old_stage)
    if not new_stage:
        print(f"  ⚠️ unknown stage '{old_stage}' for candidate {cid} — leaving as-is")
        continue
    if new_stage == old_stage:
        continue
    cur.execute("UPDATE candidates SET stage=?, last_stage_at=? WHERE id=?", (new_stage, now, cid))
    # Add stage_event for history
    cur.execute(
        "INSERT INTO stage_events (id, candidate_id, from_stage, to_stage, changed_by, changed_at, meta) VALUES (?,?,?,?,?,?,?)",
        (f"mig-{cid[:8]}-{int(datetime.datetime.utcnow().timestamp())}", cid, old_stage, new_stage, "system", now, '{"migration":"old_to_14stages"}')
    )
    updated += 1

c.commit()
print(f"  ✅ migrated {updated} candidates")

# New distribution
print("\nNew distribution:")
for row in c.execute("SELECT stage, COUNT(*) FROM candidates GROUP BY stage ORDER BY 2 DESC"):
    print(f"  {row[0]:20s} {row[1]}")
c.close()
PY

echo "[5/5] Restart app..."
pm2 start skinline-hr-crm
sleep 3
pm2 list

echo ""
echo "--- /api/candidates?stage=form_filled count ---"
curl -s 'http://localhost:3000/api/candidates?stage=form_filled' | python3 -c "import sys,json;d=json.load(sys.stdin);print('count:',len(d) if isinstance(d,list) else d)"
echo "--- /api/candidates?stage=in_work count ---"
curl -s 'http://localhost:3000/api/candidates?stage=in_work' | python3 -c "import sys,json;d=json.load(sys.stdin);print('count:',len(d) if isinstance(d,list) else d)"
echo "--- /api/candidates?stage=video_interview count ---"
curl -s 'http://localhost:3000/api/candidates?stage=video_interview' | python3 -c "import sys,json;d=json.load(sys.stdin);print('count:',len(d) if isinstance(d,list) else d)"
echo "--- /api/candidates?stage=studio_demo count ---"
curl -s 'http://localhost:3000/api/candidates?stage=studio_demo' | python3 -c "import sys,json;d=json.load(sys.stdin);print('count:',len(d) if isinstance(d,list) else d)"

echo ""
echo "✅ Stage migration DONE"
