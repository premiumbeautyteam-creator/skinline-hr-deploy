// Content generation service for @SkinLineHR channel autopilot (Iter3)
// Uses existing chatCompletion from ai.ts — no new HTTP client.

import { chatCompletion, getKnowledgeBase } from "./ai.js";
import { SYSTEM_CHANNEL_POST } from "./ai_prompts.js";
import { storage } from "../storage.js";
import type { ContentRubric, ChannelSettings, Candidate } from "@shared/schema";

const MODEL_CONTENT = "anthropic/claude-sonnet-4";
const MODEL_REPLY   = "openai/gpt-4o-mini";

// ── Moscow timezone helpers (no external libs) ──────────────────────────────

/** Get current time in Europe/Moscow as a plain object */
function moscowNow(): { year: number; month: number; day: number; hour: number; dow: number } {
  const now = new Date();
  const msk = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  return {
    year:  msk.getFullYear(),
    month: msk.getMonth() + 1,  // 1-12
    day:   msk.getDate(),
    hour:  msk.getHours(),
    dow:   msk.getDay() === 0 ? 7 : msk.getDay(), // 1=Mon … 7=Sun
  };
}

/** Build UTC ISO string for a given Moscow date+hour */
function moscowToUtcIso(year: number, month: number, day: number, hour: number): string {
  // Create date string as Moscow local time, then convert to UTC
  const moscowStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00`;
  // Europe/Moscow is UTC+3 (no DST)
  const utcMs = new Date(moscowStr).getTime() - 3 * 3600 * 1000;
  return new Date(utcMs).toISOString();
}

/** Add N calendar days to a {year, month, day} */
function addDays(y: number, m: number, d: number, days: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

// ── Weighted random rubric selection ────────────────────────────────────────

export function pickRubricWeighted(
  rubrics: ContentRubric[],
  lastRubricKey?: string,
): ContentRubric | null {
  const active = rubrics.filter((r) => r.active === 1);
  if (active.length === 0) return null;

  // Avoid repeating the same rubric twice in a row
  const candidates = active.length > 1
    ? active.filter((r) => r.key !== lastRubricKey)
    : active;

  const totalWeight = candidates.reduce((s, r) => s + r.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const r of candidates) {
    rand -= r.weight;
    if (rand <= 0) return r;
  }
  return candidates[candidates.length - 1] ?? null;
}

// ── Post generation ─────────────────────────────────────────────────────────

export interface GeneratedPost {
  title: string;
  body: string;
  pollOptions?: string[] | null;
}

export async function generatePost(opts: {
  rubricKey: string;
  contextHint?: string;
}): Promise<GeneratedPost | null> {
  const rubric = await storage.getContentRubric(opts.rubricKey);
  if (!rubric) {
    console.warn(`[content] Rubric not found: ${opts.rubricKey}`);
    return null;
  }

  const kb = getKnowledgeBase();

  const prompt = SYSTEM_CHANNEL_POST(
    rubric.name,
    rubric.description,
    kb,
    opts.contextHint,
  );

  const raw = await chatCompletion({
    model: MODEL_CONTENT,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1024,
    temperature: 0.75,
    jsonMode: true,
    purpose: "channel_post",
  });

  if (!raw) {
    console.warn("[content] generatePost: no response from AI");
    return null;
  }

  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```json\s*|```\s*$/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      title?: string;
      body?: string;
      poll_options?: string[] | null;
    };
    return {
      title: parsed.title ?? "Новый пост",
      body:  parsed.body  ?? "",
      pollOptions: Array.isArray(parsed.poll_options) ? parsed.poll_options : null,
    };
  } catch (err) {
    console.error("[content] generatePost parse error:", err, raw.slice(0, 200));
    return null;
  }
}

// ── Welcome message (sync, template-based; AI optional) ─────────────────────

export function generateWelcomeMessage(subscriber: {
  firstName?: string | null;
  username?: string | null;
}): string {
  const name = subscriber.firstName ?? (subscriber.username ? `@${subscriber.username}` : "");
  const greeting = name ? `Привет, ${name}! 🤍` : "Привет! 🤍";
  return `${greeting}\n\nДобро пожаловать в канал @SkinLineHR — пространство команды Skin Line.\n\nЗдесь мы рассказываем о жизни студий, делимся советами и приглашаем стать частью нашей команды ✨\n\nЕсли хочешь узнать об открытых вакансиях — напиши нам через бота: t.me/Assistant_skin_line_bot?start=channel 💪`;
}

// ── Reactivation message ────────────────────────────────────────────────────

export async function generateReactivationMessage(candidate: Candidate): Promise<string> {
  const kb = getKnowledgeBase();

  const raw = await chatCompletion({
    model: MODEL_REPLY,
    messages: [
      {
        role: "system",
        content: `Ты — HR-специалист Skin Line. Напиши короткое (3-4 предложения) тёплое сообщение кандидату, который давно находится в резерве. Предложи рассмотреть актуальные вакансии снова.\nИнформация о компании:\n${kb.slice(0, 2000)}`,
      },
      {
        role: "user",
        content: `Кандидат: ${candidate.fullName}, город: ${candidate.city}, опыт: ${candidate.experience}. Последний этап: ${candidate.stage}. Напиши реактивационное сообщение.`,
      },
    ],
    maxTokens: 256,
    temperature: 0.6,
    purpose: "reactivation",
    candidateId: candidate.id,
  });

  if (raw) return raw.trim();

  // Fallback template
  return `Здравствуйте, ${candidate.fullName}! 🤍 Мы из Skin Line — и рады снова написать вам. У нас появились новые возможности для специалистов в ${candidate.city}, и мы вспомнили о вас. Будет здорово, если вы рассмотрите наши актуальные вакансии ✨ Напишите нам — расскажем подробнее!`;
}

// ── Content calendar generation ─────────────────────────────────────────────

export interface CalendarSlot {
  rubricKey: string;
  scheduledAt: string; // UTC ISO
  prompt?: string;
}

export async function generateContentPlan(weeks = 4): Promise<CalendarSlot[]> {
  const settings: ChannelSettings | undefined = await storage.getChannelSettings();
  const postsPerWeek = settings?.postsPerWeek ?? 2;
  const preferredHours: number[] = parseJsonSafe(settings?.preferredHours, [10, 14, 18]);
  const preferredDays: number[] = parseJsonSafe(settings?.preferredDays, [1, 3, 5]); // 1=Mon

  const rubrics = await storage.getContentRubrics();
  const slots: CalendarSlot[] = [];
  const msk = moscowNow();
  let { year, month, day } = msk;
  let lastRubricKey: string | undefined;

  // Build a list of candidate publish dates
  const totalPosts = weeks * postsPerWeek;

  // Start from tomorrow
  const startDate = addDays(year, month, day, 1);
  let cur = startDate;
  let postsGenerated = 0;
  let dayOffset = 0;

  while (postsGenerated < totalPosts && dayOffset < weeks * 7 * 2) {
    const weekday = new Date(Date.UTC(cur.year, cur.month - 1, cur.day)).getDay();
    const dow = weekday === 0 ? 7 : weekday; // 1=Mon … 7=Sun

    if (preferredDays.includes(dow)) {
      // Pick a random hour from preferredHours
      const hour = preferredHours[Math.floor(Math.random() * preferredHours.length)] ?? 10;
      const rubric = pickRubricWeighted(rubrics, lastRubricKey);
      if (rubric) {
        slots.push({
          rubricKey: rubric.key,
          scheduledAt: moscowToUtcIso(cur.year, cur.month, cur.day, hour),
        });
        lastRubricKey = rubric.key;
        postsGenerated++;
      }
    }

    cur = addDays(cur.year, cur.month, cur.day, 1);
    dayOffset++;
  }

  return slots;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
