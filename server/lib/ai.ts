// AI service for Iter2: OpenRouter-based LLM calls.
// Reads knowledge base once at module load.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../storage.js";
import { aiCalls } from "@shared/schema";
import {
  SYSTEM_ALINA,
  SYSTEM_SCREEN,
  SYSTEM_SCORE,
  SYSTEM_SENTIMENT,
} from "./ai_prompts.js";
import type { Candidate } from "@shared/schema";

// ── Config ────────────────────────────────────────────────────────────────────

const OPENROUTER_KEY =
  process.env.CUSTOM_CRED_OPENROUTER_AI_TOKEN ??
  process.env.OPENROUTER_API_KEY ??
  "";

const OPENROUTER_URL =
  process.env.CUSTOM_CRED_OPENROUTER_AI_URL ??
  "https://openrouter.ai/api/v1";

const MODEL_SCREEN = "anthropic/claude-sonnet-4";
const MODEL_CHAT = "openai/gpt-4o-mini";
const MODEL_SENTIMENT = "openai/gpt-4o-mini";

// ── Knowledge base (read once at startup) ────────────────────────────────────
// Works in both ESM dev (tsx) and CJS prod (esbuild bundle).
// Tries several candidate paths relative to cwd.

function findKnowledgeBase(): string {
  const candidates = [
    join(process.cwd(), "server", "lib", "ai_knowledge_base.md"),
    join(process.cwd(), "lib", "ai_knowledge_base.md"),
    // When running from dist/ directory
    join(process.cwd(), "..", "server", "lib", "ai_knowledge_base.md"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  // Fallback: try relative to __dirname if available (CJS context)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dir = (typeof __dirname !== "undefined") ? __dirname : process.cwd();
    const p = join(dir, "ai_knowledge_base.md");
    if (existsSync(p)) return readFileSync(p, "utf8");
  } catch { /* ignore */ }
  return "База знаний недоступна.";
}

let _knowledgeBase: string = "";
try {
  _knowledgeBase = findKnowledgeBase();
  if (_knowledgeBase === "База знаний недоступна.") {
    console.warn("[ai] ai_knowledge_base.md not found — using fallback");
  }
} catch (err) {
  console.error("[ai] Failed to read ai_knowledge_base.md:", err);
  _knowledgeBase = "База знаний недоступна.";
}

export function getKnowledgeBase(): string {
  return _knowledgeBase;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  purpose?: string;
  candidateId?: string;
}

export interface ScreenResult {
  verdict: "take" | "reserve" | "reject";
  reasoning: string;
  factors: string[];
}

export interface ScoreResult {
  score: number;
  factors: string[];
}

export interface SentimentResult {
  sentiment: "positive" | "neutral" | "negative";
  intent:
    | "question"
    | "change_mind"
    | "reschedule"
    | "when_shift"
    | "silent_period"
    | "general";
  escalate: boolean;
}

export interface AiReplyResult {
  reply: string;
  shouldEscalate: boolean;
  reason: string;
}

// ── OpenRouter client with retry ─────────────────────────────────────────────

async function callOpenRouter(
  opts: ChatCompletionOptions
): Promise<{ content: string; promptTokens: number; completionTokens: number } | null> {
  if (!OPENROUTER_KEY) {
    console.warn("[ai] OPENROUTER_KEY not set, skipping AI call");
    return null;
  }

  const startMs = Date.now();
  const maxRetries = 3;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.3,
      };
      if (opts.jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          "HTTP-Referer": "https://app.skinline-hr.ru",
          "X-Title": "Skin Line HR CRM",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 200)}`);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };

      if (json.error?.message) {
        throw new Error(`OpenRouter error: ${json.error.message}`);
      }

      const content = json.choices?.[0]?.message?.content ?? "";
      const promptTokens = json.usage?.prompt_tokens ?? 0;
      const completionTokens = json.usage?.completion_tokens ?? 0;
      const durationMs = Date.now() - startMs;

      // Log to ai_calls (best-effort)
      logAiCall({
        purpose: (opts.purpose ?? "chat") as AiPurpose,
        model: opts.model,
        candidateId: opts.candidateId ?? null,
        promptTokens,
        completionTokens,
        durationMs,
        success: true,
        error: null,
      });

      return { content, promptTokens, completionTokens };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.error(`[ai] attempt ${attempt + 1} failed:`, lastErr.message);
    }
  }

  const durationMs = Date.now() - startMs;
  logAiCall({
    purpose: (opts.purpose ?? "chat") as AiPurpose,
    model: opts.model,
    candidateId: opts.candidateId ?? null,
    promptTokens: 0,
    completionTokens: 0,
    durationMs,
    success: false,
    error: lastErr?.message ?? "Unknown error",
  });

  return null;
}

// ── AI Call logging ───────────────────────────────────────────────────────────

type AiPurpose = "screen" | "score" | "chat" | "sentiment" | "whisper";

function logAiCall(opts: {
  purpose: AiPurpose;
  model: string;
  candidateId: string | null;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  success: boolean;
  error: string | null;
}): void {
  try {
    // Cost estimate: rough OpenRouter pricing
    const totalTokens = opts.promptTokens + opts.completionTokens;
    const costUsd = totalTokens * 0.000003; // ~$3/1M tokens rough estimate

    db.insert(aiCalls)
      .values({
        id: randomUUID(),
        purpose: opts.purpose,
        model: opts.model,
        candidateId: opts.candidateId,
        promptTokens: opts.promptTokens,
        completionTokens: opts.completionTokens,
        costUsd,
        durationMs: opts.durationMs,
        success: opts.success ? 1 : 0,
        error: opts.error,
        createdAt: new Date().toISOString(),
      })
      .run();
  } catch (err) {
    // Never crash on logging failure
    console.warn("[ai] Failed to log ai_call:", err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** General chat completion */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<string | null> {
  const result = await callOpenRouter(opts);
  return result?.content ?? null;
}

/** Analyse candidate resume against vacancy context */
export async function screenResume(
  candidate: Candidate,
  vacancy: { title: string; city: string; description: string }
): Promise<ScreenResult | null> {
  const userContent = `
Кандидат:
- ФИО: ${candidate.fullName}
- Город: ${candidate.city}
- Опыт: ${candidate.experience}
- Ожидаемая зарплата: ${candidate.expectedSalary ?? "не указано"}
- Теги: ${candidate.tags}
- Источник: ${candidate.source}
- Заметки HR: ${candidate.notes ?? "нет"}

Вакансия:
- Должность: ${vacancy.title}
- Город: ${vacancy.city}
- Описание: ${vacancy.description}

Оцени кандидата и верни JSON.
`.trim();

  const raw = await callOpenRouter({
    model: MODEL_SCREEN,
    messages: [
      { role: "system", content: SYSTEM_SCREEN(_knowledgeBase) },
      { role: "user", content: userContent },
    ],
    maxTokens: 512,
    temperature: 0.1,
    jsonMode: true,
    purpose: "screen",
    candidateId: candidate.id,
  });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw.content) as ScreenResult;
    if (!["take", "reserve", "reject"].includes(parsed.verdict)) {
      throw new Error(`Invalid verdict: ${parsed.verdict}`);
    }
    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning ?? "",
      factors: Array.isArray(parsed.factors) ? parsed.factors : [],
    };
  } catch (err) {
    console.error("[ai] screenResume parse error:", err, raw.content.slice(0, 200));
    return null;
  }
}

/** Predict probability (0-100) of reaching 'scheduled' stage */
export async function predictiveScore(
  candidate: Candidate,
  history: Array<{ fromStage: string | null; toStage: string; changedAt: string }>
): Promise<ScoreResult | null> {
  const stageHistory = history
    .map((h) => `${h.fromStage ?? "—"} → ${h.toStage} (${h.changedAt.slice(0, 10)})`)
    .join("\n");

  const userContent = `
Кандидат:
- ФИО: ${candidate.fullName}
- Город: ${candidate.city}
- Источник: ${candidate.source}
- Опыт: ${candidate.experience}
- Текущий этап: ${candidate.stage}
- Создан: ${candidate.createdAt.slice(0, 10)}
- Теги: ${candidate.tags}

История стадий:
${stageHistory || "нет данных"}

Оцени вероятность (0-100) того, что кандидат дойдёт до этапа 'scheduled'.
Верни JSON.
`.trim();

  const raw = await callOpenRouter({
    model: MODEL_CHAT,
    messages: [
      { role: "system", content: SYSTEM_SCORE },
      { role: "user", content: userContent },
    ],
    maxTokens: 256,
    temperature: 0.1,
    jsonMode: true,
    purpose: "score",
    candidateId: candidate.id,
  });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw.content) as ScoreResult;
    const score = Math.min(100, Math.max(0, Math.round(Number(parsed.score) || 0)));
    return {
      score,
      factors: Array.isArray(parsed.factors) ? parsed.factors.slice(0, 5) : [],
    };
  } catch (err) {
    console.error("[ai] predictiveScore parse error:", err, raw.content.slice(0, 200));
    return null;
  }
}

/** Detect sentiment and intent from candidate text */
export async function detectSentimentAndIntent(text: string): Promise<SentimentResult | null> {
  const raw = await callOpenRouter({
    model: MODEL_SENTIMENT,
    messages: [
      { role: "system", content: SYSTEM_SENTIMENT },
      { role: "user", content: text.slice(0, 2000) },
    ],
    maxTokens: 128,
    temperature: 0.0,
    jsonMode: true,
    purpose: "sentiment",
  });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw.content) as SentimentResult;
    return {
      sentiment: (["positive", "neutral", "negative"].includes(parsed.sentiment)
        ? parsed.sentiment
        : "neutral") as SentimentResult["sentiment"],
      intent: (
        ["question", "change_mind", "reschedule", "when_shift", "silent_period", "general"].includes(
          parsed.intent
        )
          ? parsed.intent
          : "general"
      ) as SentimentResult["intent"],
      escalate: Boolean(parsed.escalate),
    };
  } catch (err) {
    console.error("[ai] detectSentimentAndIntent parse error:", err, raw.content.slice(0, 200));
    return null;
  }
}

/** Generate AI reply from Alina to a candidate */
export async function aiReply(
  candidate: Candidate,
  conversationHistory: Array<{ direction: string; text: string; sentAt: string }>,
  candidateMessage: string
): Promise<AiReplyResult | null> {
  const historyMessages: ChatMessage[] = conversationHistory
    .slice(-20)
    .map((m) => ({
      role: m.direction === "out" ? ("assistant" as const) : ("user" as const),
      content: m.text,
    }));

  // Add candidate context as a system note
  const contextNote = `[Контекст: кандидат ${candidate.fullName}, город ${candidate.city}, этап ${candidate.stage}]`;

  const raw = await callOpenRouter({
    model: MODEL_CHAT,
    messages: [
      { role: "system", content: SYSTEM_ALINA(_knowledgeBase) + "\n\n" + contextNote },
      ...historyMessages,
      { role: "user", content: candidateMessage },
    ],
    maxTokens: 512,
    temperature: 0.7,
    purpose: "chat",
    candidateId: candidate.id,
  });

  if (!raw) return null;

  // Check if we should escalate based on reply content
  const replyText = raw.content.trim();
  const ESCALATE_PHRASES = [
    "передам ваш вопрос",
    "свяжется с вами",
    "hr-менеджер",
    "не могу ответить",
    "уточню у",
  ];
  const shouldEscalate = ESCALATE_PHRASES.some((p) =>
    replyText.toLowerCase().includes(p)
  );

  return {
    reply: replyText,
    shouldEscalate,
    reason: shouldEscalate ? "AI not confident — escalating to HR" : "",
  };
}

/** Transcribe voice message via Whisper (stub if unavailable) */
export async function transcribeVoice(audioBuffer: Buffer): Promise<string | null> {
  // TODO: implement actual Whisper call via OpenRouter or OpenAI direct
  // OpenRouter Whisper: POST https://openrouter.ai/api/v1/audio/transcriptions
  // For now return null (handled by caller as stub)
  console.warn("[ai] Whisper transcription not yet implemented — returning null");
  return null;
}

/** Test OpenRouter connectivity */
export async function testOpenRouter(): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await callOpenRouter({
      model: MODEL_CHAT,
      messages: [{ role: "user", content: "Привет! Ответь одним словом." }],
      maxTokens: 10,
      temperature: 0,
      purpose: "chat",
    });
    if (result) return { ok: true };
    return { ok: false, error: "No response from OpenRouter" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
