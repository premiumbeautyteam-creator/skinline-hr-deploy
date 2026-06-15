#!/bin/bash
# Запуск тестового анализа видео-интервью с Google Drive
set -e
exec > >(tee /tmp/trigger-v2.log) 2>&1

APP_DIR=/home/skinline/skinline-hr-crm
cd "$APP_DIR"

VIDEO_URL='https://drive.google.com/uc?export=download&id=1QtTFhg8wbcDZQGfLjgG0X0Q2B34_7ec2'

echo "=== Step 1: Find HR user ==="
HR_ID=$(sqlite3 data.db "SELECT id FROM crm_users WHERE role_key='hr_manager' LIMIT 1;")
echo "HR_ID=$HR_ID"
if [ -z "$HR_ID" ]; then
  echo "ERROR: HR user not found"
  exit 1
fi

echo "=== Step 2: Create or find test candidate ==="
CAND_ID=$(sqlite3 data.db "SELECT id FROM candidates WHERE phone='+79990000001' LIMIT 1;")
if [ -z "$CAND_ID" ]; then
  CAND_ID=$(uuidgen)
  NOW=$(date -u +%s)000
  sqlite3 data.db <<SQL
INSERT INTO candidates (id, full_name, phone, city, role_target, stage, source, hr_owner_id, created_at, updated_at)
VALUES ('$CAND_ID', 'Тест Видео-Анализа', '+79990000001', 'Казань', 'administrator', 'video_interview', 'test', '$HR_ID', '$NOW', '$NOW');
SQL
  echo "Created candidate $CAND_ID"
else
  echo "Reusing candidate $CAND_ID"
fi

echo "=== Step 3: Create interview_videos record ==="
VID_ID=$(uuidgen)
NOW=$(date -u +%s)000
sqlite3 data.db <<SQL
INSERT INTO interview_videos (id, candidate_id, source, source_url, status, uploaded_by, created_at, updated_at)
VALUES ('$VID_ID', '$CAND_ID', 'upload', '$VIDEO_URL', 'pending', '$HR_ID', '$NOW', '$NOW');
SQL
echo "Created video $VID_ID"

echo "=== Step 4: Trigger pipeline via internal HTTP ==="
# Создадим эндпоинт inline через node, импортирующий video_pipeline.enqueueAnalysis
cat > /tmp/enqueue.mjs <<EOF
import('/home/skinline/skinline-hr-crm/dist/index.js').catch(()=>{});
// Дадим серверу 2 сек для прогрева импортов
setTimeout(async () => {
  try {
    const mod = await import('/home/skinline/skinline-hr-crm/dist/lib/video_pipeline.js');
    mod.enqueueAnalysis('$VID_ID');
    console.log('Enqueued $VID_ID');
  } catch (e) {
    console.error('Enqueue error:', e.message);
  }
  process.exit(0);
}, 2000);
EOF

# Альтернатива: вызвать через работающий процесс pm2 нельзя напрямую,
# поэтому отправим сигнал через файл-триггер и подключимся к БД из running app.
# Самый надёжный способ — сделать HTTP-вызов на новый dev-endpoint, но его нет.
# Поэтому стартанём отдельный node, который импортит pipeline и поставит в очередь.
# Внутрипроцессная очередь в running pm2 не увидит наш enqueue.
# Единственный путь: добавить временный admin-route ИЛИ напрямую запустить pipeline в отдельном процессе.

echo "=== Step 4b: Run pipeline standalone ==="
# Запускаем pipeline в фоне через standalone node-процесс
nohup node --experimental-vm-modules -e "
import('/home/skinline/skinline-hr-crm/dist/lib/video_pipeline.js').then(async (mod) => {
  console.log('Module loaded, processing $VID_ID');
  if (mod.processVideo) {
    await mod.processVideo('$VID_ID');
  } else if (mod.enqueueAnalysis) {
    mod.enqueueAnalysis('$VID_ID');
    await new Promise(r => setTimeout(r, 300000));
  }
  console.log('Done');
}).catch(e => console.error('Pipeline error:', e));
" > /tmp/pipeline.out 2>&1 &
PID=$!
echo "Pipeline PID=$PID"

echo "=== Step 5: Wait and check ==="
sleep 5
echo "--- pipeline.out after 5s ---"
cat /tmp/pipeline.out

echo "=== Video record state ==="
sqlite3 data.db "SELECT id, status, error_msg FROM interview_videos WHERE id='$VID_ID';"

echo "=== Saved IDs ==="
echo "VID_ID=$VID_ID"
echo "CAND_ID=$CAND_ID"
echo "$VID_ID" > /tmp/last_vid_id.txt
