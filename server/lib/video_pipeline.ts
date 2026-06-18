// Iter6: Video Pipeline
// Downloads, transcribes, and analyzes interview videos.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { storage } from "../storage.js";
import { chatCompletion } from "./ai.js";
import { getTelegram } from "../integrations/telegram.js";

const execAsync = promisify(exec);

// ── Config ────────────────────────────────────────────────────────────────────

const VIDEO_DIR = process.env.VIDEO_DIR ?? "/var/skinline/interview_videos";
const FRAMES_DIR = process.env.FRAMES_DIR ?? "/var/skinline/interview_frames";
const TRANSCRIPT_DIR = process.env.TRANSCRIPT_DIR ?? "/var/skinline/interview_transcripts";
const APP_URL = process.env.APP_URL ?? "https://app.skinline-hr.ru";

const OPENROUTER_KEY =
  process.env.CUSTOM_CRED_OPENROUTER_AI_TOKEN ??
  process.env.OPENROUTER_API_KEY ??
  "";
const OPENROUTER_URL =
  process.env.CUSTOM_CRED_OPENROUTER_AI_URL ??
  "https://openrouter.ai/api/v1";

const MODEL_ANALYSIS = "anthropic/claude-sonnet-4";
const MODEL_SENTIMENT = "openai/gpt-4o-mini";

// ── Queue ─────────────────────────────────────────────────────────────────────

const activeJobs = new Set<string>();

export function enqueueAnalysis(videoId: string): void {
  // The cron picks up pending videos automatically; this is a no-op marker.
  console.log(`[video_pipeline] Enqueued videoId=${videoId}`);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function processVideo(videoId: string): Promise<void> {
  if (activeJobs.has(videoId)) {
    console.log(`[video_pipeline] Already processing videoId=${videoId}, skipping`);
    return;
  }
  activeJobs.add(videoId);

  try {
    await _processVideo(videoId);
  } catch (err) {
    console.error(`[video_pipeline] Fatal error for videoId=${videoId}:`, err);
    try {
      await storage.updateInterviewVideo(videoId, {
        status: "error",
        errorMsg: String(err),
      });
    } catch (_) { /* ignore */ }
  } finally {
    activeJobs.delete(videoId);
  }
}

async function _processVideo(videoId: string): Promise<void> {
  const video = await storage.getInterviewVideo(videoId);
  if (!video) throw new Error(`InterviewVideo ${videoId} not found`);

  // Ensure directories exist
  for (const dir of [VIDEO_DIR, FRAMES_DIR, TRANSCRIPT_DIR]) {
    try { mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
  }

  const mp4Path = join(VIDEO_DIR, `${videoId}.mp4`);
  const wavPath = join(VIDEO_DIR, `${videoId}.wav`);
  const framesDir = join(FRAMES_DIR, videoId);
  const transcriptPath = join(TRANSCRIPT_DIR, `${videoId}.json`);

  // ── Step 1: Download ──────────────────────────────────────────────────────

  await storage.updateInterviewVideo(videoId, { status: "downloading", errorMsg: null });
  console.log(`[video_pipeline] Downloading ${video.sourceUrl}`);

  try {
    // Try yt-dlp first (supports Zoom public links)
    await execAsync(
      `yt-dlp -o "${mp4Path}" --no-playlist --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${video.sourceUrl}"`,
      { timeout: 10 * 60 * 1000 }
    );
  } catch (dlErr) {
    // Fallback: direct curl download
    try {
      await execAsync(`curl -L -o "${mp4Path}" "${video.sourceUrl}"`, { timeout: 10 * 60 * 1000 });
    } catch (curlErr) {
      throw new Error(`Скачивание видео не удалось. yt-dlp: ${String(dlErr).substring(0, 200)}. curl: ${String(curlErr).substring(0, 200)}`);
    }
  }

  if (!existsSync(mp4Path)) {
    throw new Error("Видео не скачалось — файл не существует после загрузки");
  }

  await storage.updateInterviewVideo(videoId, { localPath: mp4Path });

  // Get duration
  let durationSec: number | null = null;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${mp4Path}"`
    );
    durationSec = Math.round(parseFloat(stdout.trim()));
    await storage.updateInterviewVideo(videoId, { durationSec });

    if (durationSec > 90 * 60) {
      console.warn(`[video_pipeline] Video ${videoId} is ${Math.round(durationSec / 60)} minutes — proceeding but may be slow`);
    }
  } catch (_) { /* duration is optional */ }

  // ── Step 2: Extract audio ─────────────────────────────────────────────────

  await execAsync(
    `ffmpeg -y -i "${mp4Path}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${wavPath}"`,
    { timeout: 5 * 60 * 1000 }
  );

  // ── Step 3: Transcribe ────────────────────────────────────────────────────

  await storage.updateInterviewVideo(videoId, { status: "transcribing" });
  console.log(`[video_pipeline] Transcribing videoId=${videoId}`);

  const transcriptResult = await transcribeAudio(wavPath, videoId);
  if (!transcriptResult || !transcriptResult.text?.trim()) {
    throw new Error("Транскрипт пустой — возможно, аудио не содержит речи или Whisper недоступен");
  }

  const transcriptJson = JSON.stringify(transcriptResult);
  await storage.updateInterviewVideo(videoId, {
    transcriptPath,
    transcriptJson,
  });

  // ── Step 4: Extract frames ────────────────────────────────────────────────

  try {
    mkdirSync(framesDir, { recursive: true });
    await execAsync(
      `ffmpeg -y -i "${mp4Path}" -vf "fps=1/5" "${framesDir}/frame_%04d.jpg"`,
      { timeout: 5 * 60 * 1000 }
    );
  } catch (err) {
    console.warn(`[video_pipeline] Frame extraction failed (non-fatal):`, err);
  }

  // ── Step 5: AI Analysis ───────────────────────────────────────────────────

  await storage.updateInterviewVideo(videoId, { status: "analyzing" });
  console.log(`[video_pipeline] Analyzing videoId=${videoId}`);

  // Get candidate + role for scorecard
  const candidate = await storage.getCandidate(video.candidateId);
  const vacancy = candidate ? await storage.getVacancy(candidate.vacancyId) : null;
  const role = inferRoleFromVacancy(vacancy?.title ?? "");
  const templates = await storage.getScorecardTemplates({ role, active: true });
  const template = templates[0] ?? null;

  const transcript = transcriptResult.text;

  // Run 5 parallel AI tasks
  const [scorecardResult, factsResult, redFlagsResult, summaryResult, sentimentResult] =
    await Promise.allSettled([
      analyzeScorecard(transcript, template, candidate?.fullName ?? ""),
      extractFacts(transcript),
      detectRedFlags(transcript),
      generateSummary(transcript, candidate?.fullName ?? ""),
      analyzeSentiment(transcript, durationSec ?? 0),
    ]);

  const rawAnalysis: Record<string, unknown> = {};
  if (scorecardResult.status === "fulfilled") rawAnalysis.scorecard = scorecardResult.value;
  if (factsResult.status === "fulfilled") rawAnalysis.facts = factsResult.value;
  if (redFlagsResult.status === "fulfilled") rawAnalysis.redFlags = redFlagsResult.value;
  if (summaryResult.status === "fulfilled") rawAnalysis.summary = summaryResult.value;
  if (sentimentResult.status === "fulfilled") rawAnalysis.sentiment = sentimentResult.value;

  const aiSummary =
    summaryResult.status === "fulfilled" ? String(summaryResult.value ?? "") : null;
  const redFlags =
    redFlagsResult.status === "fulfilled" ? (redFlagsResult.value as unknown[]) ?? [] : [];
  const extractedFacts =
    factsResult.status === "fulfilled" ? (factsResult.value as unknown[]) ?? [] : [];
  const sentimentTimeline =
    sentimentResult.status === "fulfilled" ? (sentimentResult.value as unknown[]) ?? [] : [];
  const keyTimestamps =
    scorecardResult.status === "fulfilled"
      ? extractKeyTimestamps(scorecardResult.value as ScorecardAnalysis)
      : [];

  await storage.updateInterviewVideo(videoId, {
    rawAnalysisJson: JSON.stringify(rawAnalysis),
    aiSummary,
    redFlagsJson: JSON.stringify(redFlags),
    extractedFactsJson: JSON.stringify(extractedFacts),
    sentimentTimelineJson: JSON.stringify(sentimentTimeline),
    keyTimestampsJson: JSON.stringify(keyTimestamps),
    status: "done",
    completedAt: new Date().toISOString(),
  });

  // ── Step 6: Auto-fill scorecard_response ────────────────────────────────

  if (
    template &&
    scorecardResult.status === "fulfilled" &&
    scorecardResult.value
  ) {
    try {
      const sa = scorecardResult.value as ScorecardAnalysis;
      const criteriaArr = JSON.parse(template.criteriaJson) as Array<{ id: string; weight: number }>;
      const maxScore = criteriaArr.length * 5;
      const totalScore = sa.scores.reduce((acc: number, s: { score: number }) => acc + (s.score ?? 0), 0);
      const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
      const recommendation =
        percentage >= 70 ? "pass" : percentage >= 50 ? "think" : "reject";

      await storage.createScorecardResponse({
        candidateId: video.candidateId,
        templateId: template.id,
        stage: "video_interview",
        scoresJson: JSON.stringify(sa.scores),
        totalScore,
        maxScore,
        percentage,
        aiDrafted: 1,
        aiVerdict: sa.overallRecommendation ?? null,
        recommendation,
        interviewerId: video.uploadedBy ?? null,
        sourceVideoId: videoId,
      });
    } catch (err) {
      console.error("[video_pipeline] Failed to create scorecard response:", err);
    }
  }

  // ── Step 7: Red flags side effects ───────────────────────────────────────

  const highRedFlags = (redFlags as Array<{ severity: string; quote: string; timestamp: string; description: string }>)
    .filter((f) => f.severity === "high" || f.severity === "medium");

  if (highRedFlags.length > 0 && candidate) {
    // Reduce predictive score
    const penalty = highRedFlags.length * 10;
    const currentScore = candidate.predictiveScore ?? 50;
    const newScore = Math.max(0, currentScore - penalty);
    await storage.updateCandidate(video.candidateId, { predictiveScore: newScore });

    // Create alerts
    for (const flag of highRedFlags) {
      try {
        await storage.createAlert({
          type: "interview_red_flag",
          severity: "med",
          title: `Красный флаг в интервью: ${candidate.fullName}`,
          description: `${flag.description ?? ""} — «${flag.quote ?? ""}» (${flag.timestamp ?? ""})`,
          candidateId: video.candidateId,
          userId: video.uploadedBy ?? null,
          relatedEntity: JSON.stringify({ videoId }),
          resolvedAt: null,
          resolvedBy: null,
        });
      } catch (err) {
        console.error("[video_pipeline] Failed to create red flag alert:", err);
      }
    }
  }

  // ── Step 8: Telegram notification ────────────────────────────────────────

  if (video.uploadedBy) {
    try {
      const crmUsers = await storage.getCrmUsers();
      const uploader = crmUsers.find((u) => u.id === video.uploadedBy);
      const chatId = uploader?.telegramChatId;
      if (chatId) {
        const tg = getTelegram();
        if (tg) {
          const name = candidate?.fullName ?? "Кандидат";
          const summary = aiSummary
            ? aiSummary.substring(0, 300) + (aiSummary.length > 300 ? "..." : "")
            : "Анализ завершён.";
          const videoUrl = `${APP_URL}/#/candidates/${video.candidateId}/video/${videoId}`;
          await tg.sendMessage(
            chatId,
            `✅ Анализ интервью готов!\n\n👤 ${name}\n\n${summary}`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Открыть детально", url: videoUrl }],
                ],
              },
            }
          );
        }
      }
    } catch (err) {
      console.error("[video_pipeline] Telegram notification failed:", err);
    }
  }

  console.log(`[video_pipeline] Done videoId=${videoId}`);
}

// ── Transcription ─────────────────────────────────────────────────────────────

interface TranscriptResult {
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

async function transcribeAudio(wavPath: string, videoId: string): Promise<TranscriptResult | null> {
  if (!OPENROUTER_KEY) {
    console.warn("[video_pipeline] No OpenRouter key, skipping transcription");
    return null;
  }

  // Read the WAV file
  const { readFileSync } = await import("node:fs");
  const audioBuffer = readFileSync(wavPath);
  const base64Audio = audioBuffer.toString("base64");

  // Try OpenRouter Whisper
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      // OpenRouter Whisper via audio transcription endpoint
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: "audio/wav" });
      formData.append("file", blob, `${videoId}.wav`);
      formData.append("model", "openai/whisper-1");
      formData.append("language", "ru");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      const res = await fetch(`${OPENROUTER_URL}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[video_pipeline] Whisper attempt ${attempt + 1} failed: ${errText.substring(0, 200)}`);
        continue;
      }

      const data = (await res.json()) as { text: string; segments?: Array<{ start: number; end: number; text: string }> };
      return { text: data.text ?? "", segments: data.segments ?? [] };
    } catch (err) {
      console.warn(`[video_pipeline] Whisper attempt ${attempt + 1} error:`, err);
    }
  }

  // Fallback: try GPT-4o-mini transcription via chat with base64
  try {
    const result = await chatCompletion({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Это аудио из интервью, закодированное в base64. Транскрибируй речь на русском языке. Аудио: [размер ${Math.round(audioBuffer.length / 1024)} КБ, base64 не вставлен — Whisper недоступен]`,
        },
      ],
      maxTokens: 100,
      purpose: "whisper_fallback",
    });
    // This will fail gracefully, indicating Whisper is unavailable
    console.warn("[video_pipeline] OpenRouter Whisper недоступен. Попробуйте позже.");
    return null;
  } catch (_) {
    return null;
  }
}

// ── AI Analysis helpers ────────────────────────────────────────────────────────

interface ScorecardAnalysis {
  scores: Array<{ criterionId: string; score: number; quote: string; timestamp: string }>;
  overallRecommendation: string;
  summary: string;
}

async function analyzeScorecard(
  transcript: string,
  template: { criteriaJson: string; name: string } | null,
  candidateName: string
): Promise<ScorecardAnalysis | null> {
  if (!template) return null;

  const criteria = JSON.parse(template.criteriaJson) as Array<{
    id: string; name: string; description: string; anchor1: string; anchor3: string; anchor5: string;
  }>;

  const criteriaText = criteria.map(
    (c) => `- ${c.id}: "${c.name}" — 1: «${c.anchor1}», 3: «${c.anchor3}», 5: «${c.anchor5}»`
  ).join("\n");

  const result = await chatCompletion({
    model: MODEL_ANALYSIS,
    messages: [
      {
        role: "system",
        content: `Ты опытный HR-аналитик. Оцени кандидата по критериям от 1 до 5 на основе транскрипта интервью. Возвращай только валидный JSON.`,
      },
      {
        role: "user",
        content: `Кандидат: ${candidateName}\nШаблон: ${template.name}\n\nКритерии:\n${criteriaText}\n\nТранскрипт:\n${transcript.substring(0, 6000)}\n\nВерни JSON:\n{"scores":[{"criterionId":"...","score":1-5,"quote":"цитата из транскрипта","timestamp":"мм:сс или N/A"}],"overallRecommendation":"текстовый вердикт","summary":"краткое резюме"}`,
      },
    ],
    maxTokens: 2000,
    jsonMode: true,
    purpose: "scorecard_analysis",
  });

  if (!result) return null;
  try {
    return JSON.parse(result) as ScorecardAnalysis;
  } catch (_) {
    return null;
  }
}

async function extractFacts(transcript: string): Promise<unknown[]> {
  const result = await chatCompletion({
    model: MODEL_ANALYSIS,
    messages: [
      {
        role: "system",
        content: "Ты аналитик HR. Извлеки факты из транскрипта интервью. Возвращай только валидный JSON массив.",
      },
      {
        role: "user",
        content: `Транскрипт:\n${transcript.substring(0, 5000)}\n\nИзвлеки факты об опыте, сертификатах, ожиданиях по зарплате, готовности к переезду и любые другие важные факты.\nВерни JSON массив: [{"key":"название факта","value":"значение","source":"цитата из транскрипта"}]`,
      },
    ],
    maxTokens: 1500,
    jsonMode: true,
    purpose: "facts_extraction",
  });

  if (!result) return [];
  try {
    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : (parsed.facts ?? []);
  } catch (_) {
    return [];
  }
}

async function detectRedFlags(transcript: string): Promise<unknown[]> {
  const result = await chatCompletion({
    model: MODEL_ANALYSIS,
    messages: [
      {
        role: "system",
        content: "Ты HR-аналитик, специализирующийся на выявлении рисков при найме. Возвращай только валидный JSON.",
      },
      {
        role: "user",
        content: `Транскрипт интервью:\n${transcript.substring(0, 5000)}\n\nНайди красные флаги: уклончивые ответы, противоречия с резюме, негатив о прошлом работодателе, нереалистичные ожидания, тревожные сигналы.\n\nВерни JSON массив: [{"type":"тип флага","severity":"low|medium|high","quote":"дословная цитата","timestamp":"мм:сс или N/A","description":"пояснение риска"}]`,
      },
    ],
    maxTokens: 1500,
    jsonMode: true,
    purpose: "red_flags",
  });

  if (!result) return [];
  try {
    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : (parsed.redFlags ?? []);
  } catch (_) {
    return [];
  }
}

async function generateSummary(transcript: string, candidateName: string): Promise<string | null> {
  const result = await chatCompletion({
    model: MODEL_ANALYSIS,
    messages: [
      {
        role: "system",
        content: "Ты опытный HR-партнёр. Пиши кратко и по делу. Только русский язык.",
      },
      {
        role: "user",
        content: `Кандидат: ${candidateName}\n\nТранскрипт интервью:\n${transcript.substring(0, 5000)}\n\nНапиши AI-резюме интервью для HR-менеджера. Ровно 200 слов. Включи: общее впечатление, ключевые сильные стороны, слабые стороны, рекомендацию по дальнейшим шагам.`,
      },
    ],
    maxTokens: 800,
    purpose: "interview_summary",
  });

  return result ?? null;
}

async function analyzeSentiment(
  transcript: string,
  durationSec: number
): Promise<Array<{ timestamp: number; sentiment: number; label: string }>> {
  const result = await chatCompletion({
    model: MODEL_SENTIMENT,
    messages: [
      {
        role: "system",
        content: "Ты анализируешь эмоциональный тон интервью. Возвращай только валидный JSON.",
      },
      {
        role: "user",
        content: `Транскрипт интервью (длительность ~${Math.round(durationSec / 60)} мин):\n${transcript.substring(0, 4000)}\n\nПроанализируй эмоциональный тон каждые 30 секунд.\nВерни JSON массив: [{"timestamp":секунды,"sentiment":1-5,"label":"позитивный|нейтральный|напряжённый|негативный|уверенный"}]`,
      },
    ],
    maxTokens: 1000,
    jsonMode: true,
    purpose: "sentiment_timeline",
  });

  if (!result) return [];
  try {
    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : (parsed.timeline ?? []);
  } catch (_) {
    return [];
  }
}

function extractKeyTimestamps(analysis: ScorecardAnalysis | null): Array<{ timestamp: string; label: string }> {
  if (!analysis?.scores) return [];
  return analysis.scores
    .filter((s) => s.timestamp && s.timestamp !== "N/A")
    .map((s) => ({ timestamp: s.timestamp, label: `${s.criterionId}: ${s.score}/5` }));
}

function inferRoleFromVacancy(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("лазер") || t.includes("эпил")) return "master_laser";
  if (t.includes("космет")) return "cosmetologist";
  if (t.includes("админ")) return "administrator";
  if (t.includes("продаж") || t.includes("менеджер")) return "sales_manager";
  return "master_laser";
}
