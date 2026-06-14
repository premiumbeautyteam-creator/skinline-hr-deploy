#!/bin/bash
# Iter6 deploy: scorecards + Zoom video analysis pipeline
set -e

APP_DIR=/home/skinline/skinline-hr-crm
REPO_URL=https://raw.githubusercontent.com/premiumbeautyteam-creator/skinline-hr-deploy/main

cd "$APP_DIR"

echo "[1/8] Backup..."
cp data.db "data.db.bak.iter6.$(date +%s)"

echo "[2/8] Install yt-dlp (if missing)..."
if ! command -v yt-dlp &>/dev/null; then
  pip3 install -U yt-dlp 2>&1 | tail -3 || curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp
fi
yt-dlp --version || echo "WARN: yt-dlp install failed"

echo "[3/8] Verify ffmpeg..."
ffmpeg -version 2>&1 | head -1

echo "[4/8] Download new bundle..."
curl -fsSL "$REPO_URL/skinline-iter6.tar.gz" -o /tmp/skinline-iter6.tar.gz
ls -la /tmp/skinline-iter6.tar.gz

echo "[5/8] Extract..."
tar -xzf /tmp/skinline-iter6.tar.gz -C "$APP_DIR"

echo "[6/8] Create video storage dirs..."
mkdir -p /var/skinline/interview_videos /var/skinline/interview_frames /var/skinline/interview_audio
chmod 755 /var/skinline/interview_videos /var/skinline/interview_frames /var/skinline/interview_audio

echo "[7/8] Sync DB schema (idempotent)..."
node -e "
const Database = require('better-sqlite3');
const db = new Database('$APP_DIR/data.db');
const exec = (sql) => { try { db.exec(sql); console.log('OK'); } catch(e) { console.log('SKIP:', e.message.slice(0, 100)); } };

exec(\`CREATE TABLE IF NOT EXISTS scorecard_templates (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  criteria_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)\`);

exec(\`CREATE TABLE IF NOT EXISTS scorecard_responses (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  stage TEXT,
  scores_json TEXT NOT NULL,
  total_score INTEGER,
  max_score INTEGER,
  percentage REAL,
  ai_drafted INTEGER NOT NULL DEFAULT 0,
  ai_verdict TEXT,
  recommendation TEXT,
  interviewer_id TEXT,
  source_video_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)\`);

exec(\`CREATE TABLE IF NOT EXISTS interview_videos (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'zoom',
  source_url TEXT NOT NULL,
  local_path TEXT,
  duration_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_msg TEXT,
  transcript_path TEXT,
  transcript_json TEXT,
  raw_analysis_json TEXT,
  sentiment_timeline_json TEXT,
  red_flags_json TEXT,
  ai_summary TEXT,
  key_timestamps_json TEXT,
  extracted_facts_json TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
)\`);

console.log('Schema sync complete.');
db.close();
"

echo "[8/8] Restart app..."
pm2 restart skinline-hr-crm || systemctl restart skinline || true
sleep 5

echo ""
echo "=== Verify ==="
echo "Health:"
curl -s http://localhost:3000/api/health | head -300
echo ""
echo "Scorecard templates:"
curl -s 'http://localhost:3000/api/scorecards/templates' | python3 -m json.tool 2>&1 | head -40
echo ""
echo "Done. Iter6 deployed."
