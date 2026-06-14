#!/bin/bash
# Iter5 deploy: probation + pulse + reserve + referrals + UTM + alerts + dreamjob widget + tooltips
set -e

APP_DIR=/home/skinline/skinline-hr-crm
REPO_URL=https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main

cd "$APP_DIR"

echo "[1/7] Backup current state..."
cp data.db "data.db.bak.iter5.$(date +%s)"
tar -czf "../sl-iter5-rollback-$(date +%s).tar.gz" --exclude=node_modules --exclude=data.db.bak.* . 2>/dev/null || true

echo "[2/7] Download new bundle..."
curl -fsSL "$REPO_URL/skinline-iter5.tar.gz" -o /tmp/skinline-iter5.tar.gz
ls -la /tmp/skinline-iter5.tar.gz

echo "[3/7] Extract over current install..."
tar -xzf /tmp/skinline-iter5.tar.gz -C "$APP_DIR"

echo "[4/7] Install missing deps if any..."
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5 || true

echo "[5/7] Sync DB schema via better-sqlite3 (idempotent)..."
node -e "
const Database = require('better-sqlite3');
const db = new Database('$APP_DIR/data.db');
const exec = (sql) => { try { db.exec(sql); console.log('OK:', sql.split('\n')[0].slice(0, 80)); } catch(e) { console.log('SKIP:', e.message.slice(0, 100)); } };

// UTM columns on candidates
const cols = db.prepare('PRAGMA table_info(candidates)').all().map(c => c.name);
['utm_source', 'utmSource', 'utm_medium', 'utmMedium', 'utm_campaign', 'utmCampaign', 'utm_content', 'utmContent', 'utm_term', 'utmTerm'].forEach(c => {
  if (!cols.includes(c) && (c.startsWith('utm_') || c.startsWith('utm'))) {
    try { db.exec(\`ALTER TABLE candidates ADD COLUMN \${c} TEXT\`); console.log('Added column:', c); } catch(e) { console.log('Skip column:', c, e.message.slice(0, 60)); }
  }
});

// New tables - drizzle will not have created them, so create here with IF NOT EXISTS
exec(\`CREATE TABLE IF NOT EXISTS probation_tracks (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  manager_id TEXT,
  final_decision_at TEXT,
  final_decision_by TEXT,
  final_decision_notes TEXT,
  score INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)\`);

exec(\`CREATE TABLE IF NOT EXISTS probation_checkpoints (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  day_number INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  check_type TEXT NOT NULL,
  result TEXT
)\`);

exec(\`CREATE TABLE IF NOT EXISTS pulse_surveys (
  id TEXT PRIMARY KEY,
  day_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  questions TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
)\`);

exec(\`CREATE TABLE IF NOT EXISTS pulse_responses (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  responses TEXT NOT NULL,
  avg_rating REAL,
  sentiment REAL,
  created_at TEXT NOT NULL
)\`);

exec(\`CREATE TABLE IF NOT EXISTS reserve_pool (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  reason TEXT,
  city TEXT,
  role TEXT,
  last_contacted_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT
)\`);

exec(\`CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  candidate_id TEXT,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  bonus_amount INTEGER
)\`);

exec(\`CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  bonus_amount INTEGER,
  paid_at TEXT,
  created_at TEXT NOT NULL
)\`);

exec(\`CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  candidate_id TEXT,
  user_id TEXT,
  related_entity TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
)\`);

exec(\`CREATE TABLE IF NOT EXISTS company_ratings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  company_name TEXT,
  overall_rating REAL,
  total_reviews INTEGER,
  recommend_percent REAL,
  subcategory_ratings TEXT,
  fetched_at TEXT NOT NULL,
  raw TEXT
)\`);

console.log('Schema sync complete.');
db.close();
"

echo "[6/7] Restart app..."
pm2 restart skinline-hr-crm || systemctl restart skinline || true
sleep 5

echo "[7/7] Verify..."
echo "Health:"
curl -s http://localhost:3000/api/health | head -200 || true
echo ""
echo "Alerts endpoint:"
curl -s http://localhost:3000/api/alerts | head -200 || true
echo ""
echo "Probation endpoint:"
curl -s http://localhost:3000/api/probation/active | head -200 || true
echo ""
echo "Pulse surveys:"
curl -s http://localhost:3000/api/pulse/surveys | head -200 || true
echo ""
echo "Company rating:"
curl -s http://localhost:3000/api/company-rating | head -200 || true
echo ""
echo "UTM funnel:"
curl -s http://localhost:3000/api/utm/funnel | head -200 || true

echo ""
echo "Iter5 deploy done."
