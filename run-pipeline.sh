#!/bin/bash
# Скрипт запуска видео-pipeline через эмуляцию Telegram webhook + callback
exec > /tmp/run-pipeline.out 2>&1
set -x

FAKE_CHAT=88888888
CAND_ID="35d68a16-5b9a-4d10-98d5-809321cf612a"
URL="https://drive.google.com/uc?export=download&id=1QtTFhg8wbcDZQGfLjgG0X0Q2B34_7ec2"
DB=/home/skinline/skinline-hr-crm/data.db

echo "=== STEP 1: /analyze command ==="
NOW=$(date +%s)
curl -sX POST http://localhost:3000/api/webhooks/telegram \
  -H "Content-Type: application/json" \
  --data "{\"update_id\":90001,\"message\":{\"message_id\":1,\"from\":{\"id\":${FAKE_CHAT},\"first_name\":\"HR\",\"is_bot\":false},\"chat\":{\"id\":${FAKE_CHAT},\"type\":\"private\"},\"date\":${NOW},\"text\":\"/analyze ${URL}\"}}" \
  -w "\nHTTP=%{http_code}\n"

sleep 2
echo "=== STEP 2: pending stored? ==="
sqlite3 $DB "SELECT key, substr(value,1,200) FROM settings WHERE key='analyze_pending_${FAKE_CHAT}';"

echo "=== STEP 3: callback analyze_pick ==="
NOW=$(date +%s)
curl -sX POST http://localhost:3000/api/webhooks/telegram \
  -H "Content-Type: application/json" \
  --data "{\"update_id\":90002,\"callback_query\":{\"id\":\"cb1\",\"from\":{\"id\":${FAKE_CHAT},\"first_name\":\"HR\",\"is_bot\":false},\"chat_instance\":\"xyz\",\"message\":{\"message_id\":2,\"chat\":{\"id\":${FAKE_CHAT},\"type\":\"private\"},\"date\":${NOW}},\"data\":\"analyze_pick:${CAND_ID}\"}}" \
  -w "\nHTTP=%{http_code}\n"

echo "=== STEP 4: poll status every 30s for 12 min ==="
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  sleep 30
  STATUS=$(sqlite3 $DB "SELECT status FROM interview_videos ORDER BY rowid DESC LIMIT 1;")
  ERR=$(sqlite3 $DB "SELECT substr(error_msg,1,150) FROM interview_videos ORDER BY rowid DESC LIMIT 1;")
  TR=$(sqlite3 $DB "SELECT length(transcript_json) FROM interview_videos ORDER BY rowid DESC LIMIT 1;")
  SC=$(sqlite3 $DB "SELECT length(raw_analysis_json) FROM interview_videos ORDER BY rowid DESC LIMIT 1;")
  echo "[$i/24] status=$STATUS tr_len=$TR sc_len=$SC err=$ERR"
  if [ "$STATUS" = "done" ] || [ "$STATUS" = "error" ]; then
    echo "=== Terminal status reached ==="
    break
  fi
done

echo ""
echo "=== FINAL RESULT ==="
sqlite3 $DB "SELECT 'STATUS: ' || status FROM interview_videos ORDER BY rowid DESC LIMIT 1;"
echo "--- AI SUMMARY ---"
sqlite3 $DB "SELECT substr(ai_summary,1,2000) FROM interview_videos ORDER BY rowid DESC LIMIT 1;"
echo "--- SCORECARD ---"
sqlite3 $DB "SELECT substr(raw_analysis_json,1,3500) FROM interview_videos ORDER BY rowid DESC LIMIT 1;"
echo "--- RED FLAGS ---"
sqlite3 $DB "SELECT substr(red_flags_json,1,1500) FROM interview_videos ORDER BY rowid DESC LIMIT 1;"
echo "--- FACTS ---"
sqlite3 $DB "SELECT substr(extracted_facts_json,1,1500) FROM interview_videos ORDER BY rowid DESC LIMIT 1;"
echo "--- ERROR (if any) ---"
sqlite3 $DB "SELECT substr(error_msg,1,500) FROM interview_videos ORDER BY rowid DESC LIMIT 1;"
echo "--- TRANSCRIPT (first 800) ---"
sqlite3 $DB "SELECT substr(transcript_json,1,800) FROM interview_videos ORDER BY rowid DESC LIMIT 1;"
echo ""
echo "=== PM2 last 60 lines ==="
pm2 logs skinline-hr-crm --lines 60 --nostream 2>/dev/null | tail -c 4000
