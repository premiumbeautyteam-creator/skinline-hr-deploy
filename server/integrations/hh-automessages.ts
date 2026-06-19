// HH auto-onboarding messages.
//
// When a BRAND-NEW hh.ru negotiation (отклик) is ingested for a vacancy whose
// title matches "косметолог" OR "лазерная эпиляция", we automatically send the
// candidate 3 short onboarding messages, in order, via the existing HH client.
//
// Hard rules (see hh_automessages_spec.md):
//   * Only ever SENDS messages — never deletes/modifies anything else on hh.ru.
//   * Never double-sends: an idempotency guard (auto_message_log) is checked
//     before sending and written after all 3 succeed (or on a permanent 403).
//   * Gated behind HH_AUTO_MESSAGES_ENABLED (default ENABLED if unset).
//
// The functions shouldAutoMessage() and normalizeFirstName() are pure and
// unit-testable; runnable example assertions live at the bottom of this file.

import { storage } from "../storage";
import { HhApiError, type HhClient } from "./hh";

// ---------------------------------------------------------------------------
// Editable constants — URLs are intentionally BARE (no markdown). HH renders
// plain text and auto-linkifies bare https:// URLs into clickable links, so we
// must NOT wrap them in markdown/anchor syntax.
// ---------------------------------------------------------------------------
const BITRIX_FORM_URL = "https://b24-v0wuu5.bitrix24site.ru/skinline/";
const TELEGRAM_CHANNEL_URL = "https://t.me/SkinLineHR";

// Delay between consecutive sends so HH preserves message ordering.
const SEND_DELAY_MS = 600;

// The 3 messages, in order. `(имя)` in message 1 is replaced with the
// candidate's normalized first name (or dropped cleanly if unknown).
export const AUTO_MESSAGE_TEMPLATES: readonly string[] = [
  `Здравствуйте, (имя)! Благодарим за интерес к нашей вакансии!
Для перехода к следующему этапу просим Вас заполнить анкету кандидата:
${BITRIX_FORM_URL}`,
  `Как только завершите, отправьте любое сообщение нашему HR-менеджеру в Telegram: @HR_SKIN_LINE, чтобы мы быстрее взяли Вашу анкету в работу.`,
  `А если хотите быть в курсе свежих вакансий и заглянуть «за кулисы» нашей компании, подписывайтесь на наш корпоративный канал — там много интересного!
${TELEGRAM_CHANNEL_URL}`,
];

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------
/**
 * HH_AUTO_MESSAGES_ENABLED gate. Default ENABLED when the var is unset/empty
 * (the user wants this on now). Only an explicit "0"/"false"/"no"/"off"
 * disables it, so it can be turned off without a redeploy (cron re-reads env).
 */
export function autoMessagesEnabled(): boolean {
  const raw = process.env.HH_AUTO_MESSAGES_ENABLED;
  if (raw == null || raw.trim() === "") return true;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Vacancy-title matcher (pure)
// ---------------------------------------------------------------------------
/**
 * True when the vacancy title should trigger the onboarding auto-reply:
 *   * contains "косметолог" (covers косметолога, косметолог-эстетист, …), OR
 *   * contains "лазерн" AND "эпиляц" (covers "лазерная эпиляция",
 *     "мастер лазерной эпиляции", "специалист лазерной эпиляции", …).
 * Case-insensitive. Tolerant of word forms via stem substrings.
 */
export function shouldAutoMessage(vacancyTitle: string | null | undefined): boolean {
  if (!vacancyTitle) return false;
  const t = vacancyTitle.toLowerCase();
  if (t.includes("косметолог")) return true;
  if (t.includes("лазерн") && t.includes("эпиляц")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// First-name normalization (pure)
// ---------------------------------------------------------------------------
// Latin->Cyrillic transliteration map. Digraphs MUST be tried before single
// letters (longest-match first), so the order of the keys here matters.
const TRANSLIT_DIGRAPHS: Array<[string, string]> = [
  ["sch", "щ"],
  ["shch", "щ"],
  ["sh", "ш"],
  ["ch", "ч"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["yo", "ё"],
  ["yu", "ю"],
  // "lya"/"lyu" carry a soft sign in common Russian names
  // (Natalya->Наталья, Ulyana->Ульяна), so handle them before bare "ya"/"yu".
  ["lya", "лья"],
  ["lyu", "лью"],
  ["ya", "я"],
  ["ye", "е"],
  ["ie", "е"],
];

const TRANSLIT_SINGLES: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х",
  i: "и", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "ы", z: "з",
};

function hasLatin(s: string): boolean {
  return /[a-z]/i.test(s);
}

function transliterateLatinToCyrillic(input: string): string {
  const lower = input.toLowerCase();
  let out = "";
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (const [latin, cyr] of TRANSLIT_DIGRAPHS) {
      if (lower.startsWith(latin, i)) {
        out += cyr;
        i += latin.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = lower[i];
    out += TRANSLIT_SINGLES[ch] ?? ch;
    i += 1;
  }
  return out;
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Normalize a raw first name for use in the greeting:
 *   * trim + collapse inner whitespace,
 *   * if it contains Latin letters, transliterate Latin->Cyrillic,
 *   * capitalize the first letter.
 * Already-Cyrillic names are left as-is (only re-capitalized).
 * Returns "" when there is no usable name.
 *
 * Examples: "Elena"->"Елена", "  Mariya "->"Мария", "Анна"->"Анна",
 * "Natalya"->"Наталья".
 */
export function normalizeFirstName(raw: string | null | undefined): string {
  if (!raw) return "";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const base = hasLatin(collapsed)
    ? transliterateLatinToCyrillic(collapsed)
    : collapsed;
  return capitalizeFirst(base);
}

/**
 * Build the 3 outgoing messages for a given first name. When no name is
 * available, message 1 drops the "(имя)" placeholder cleanly (no stray comma
 * or double space, no literal "(имя)").
 */
export function buildMessages(firstName: string): string[] {
  const name = normalizeFirstName(firstName);
  return AUTO_MESSAGE_TEMPLATES.map((tpl) => {
    if (!name) {
      // "Здравствуйте, (имя)!" -> "Здравствуйте!"  (drop ", (имя)")
      return tpl
        .replace(/,\s*\(имя\)/g, "")
        .replace(/\(имя\)/g, "")
        .replace(/ {2,}/g, " ");
    }
    return tpl.replace(/\(имя\)/g, name);
  });
}

/** Pull the candidate's first name from the already-fetched negotiation. */
function extractFirstName(negotiation: any, fallbackFullName?: string | null): string {
  const fromResume = negotiation?.resume?.first_name;
  if (typeof fromResume === "string" && fromResume.trim()) return fromResume;
  if (fallbackFullName && fallbackFullName.trim()) {
    return fallbackFullName.trim().split(/\s+/)[0];
  }
  return "";
}

/** Resolve the vacancy title to match against (negotiation first, local fallback). */
export function resolveVacancyTitle(
  negotiation: any,
  localVacancyTitle?: string | null,
): string {
  const fromNeg = negotiation?.vacancy?.name;
  if (typeof fromNeg === "string" && fromNeg.trim()) return fromNeg;
  return localVacancyTitle ?? "";
}

/** A 403 whose body indicates messaging is not allowed is treated as permanent. */
function isPermanentMessagingFailure(err: unknown): boolean {
  if (err instanceof HhApiError) {
    if (err.status === 403 && !/token_expired|oauth/i.test(err.body)) return true;
    // Negotiation in a state that forbids messages (discard/blacklist) is permanent.
    if (err.status === 404) return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AutoMessageOutcome {
  attempted: boolean; // did we try to send (passed flag + matcher + guard)?
  sent: boolean; // all 3 delivered this run
  reason: string;
}

/**
 * Evaluate and (if applicable) send the 3 onboarding messages for a freshly
 * created negotiation. Safe to call on every newly-created negotiation; all
 * gating (flag, matcher, idempotency) is internal.
 *
 * @param client       authenticated HH client (already used for ingest)
 * @param nid          hh.ru negotiation id
 * @param negotiation  the already-fetched negotiation object (avoids re-GET)
 * @param candidateId  internal candidate id (for the activity timeline entry)
 * @param localVacancyTitle  resolved local vacancy title (matcher fallback)
 */
export async function maybeSendAutoMessages(
  client: HhClient,
  nid: string,
  negotiation: any,
  candidateId: string | null,
  localVacancyTitle?: string | null,
): Promise<AutoMessageOutcome> {
  if (!autoMessagesEnabled()) {
    return { attempted: false, sent: false, reason: "disabled (HH_AUTO_MESSAGES_ENABLED)" };
  }

  const vacancyTitle = resolveVacancyTitle(negotiation, localVacancyTitle);
  const match = shouldAutoMessage(vacancyTitle);
  console.log(
    `[hh-automsg] nid=${nid} vacancy="${vacancyTitle}" match=${match}`,
  );
  if (!match) {
    return { attempted: false, sent: false, reason: "vacancy title did not match" };
  }

  // Idempotency: skip if we already handled this negotiation (sent OR permanent fail).
  const existing = await storage.getAutoMessageLog(nid).catch(() => undefined);
  if (existing) {
    console.log(`[hh-automsg] nid=${nid} already handled (status=${existing.status}) — skipping`);
    return { attempted: false, sent: false, reason: `already ${existing.status}` };
  }

  const firstName = extractFirstName(negotiation);
  const messages = buildMessages(firstName);

  let count = 0;
  try {
    for (let i = 0; i < messages.length; i++) {
      await client.sendMessage(nid, messages[i]);
      count++;
      if (i < messages.length - 1) await sleep(SEND_DELAY_MS);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const permanent = isPermanentMessagingFailure(err);
    console.warn(
      `[hh-automsg] send failed nid=${nid} vacancy="${vacancyTitle}" sent=${count}/3 permanent=${permanent}: ${msg}`,
    );
    if (permanent) {
      // Record a permanent marker so we don't hammer HH every poll.
      await storage
        .recordAutoMessageLog({
          nid,
          status: "failed_permanent",
          messageCount: count,
          vacancyTitle,
          error: msg,
          sentAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
    // Transient: do NOT write a success guard — it will retry on the next poll.
    return { attempted: true, sent: false, reason: permanent ? "permanent failure" : "transient failure" };
  }

  // All 3 delivered — write the success guard, then log the candidate activity.
  await storage
    .recordAutoMessageLog({
      nid,
      status: "sent",
      messageCount: count,
      vacancyTitle,
      error: null,
      sentAt: new Date().toISOString(),
    })
    .catch(() => undefined);

  if (candidateId) {
    await storage
      .createActivity({
        candidateId,
        type: "message",
        description: "Отправлены приветственные сообщения (HH автоответ)",
        meta: JSON.stringify({ negotiationId: nid, messageCount: count, vacancyTitle }),
      })
      .catch(() => undefined);
  }

  console.log(`[hh-automsg] nid=${nid} sent 3/3 onboarding messages (vacancy="${vacancyTitle}")`);
  return { attempted: true, sent: true, reason: "sent 3/3" };
}

// ---------------------------------------------------------------------------
// Runnable example assertions (no test framework is configured). Execute with:
//   npx tsx server/integrations/hh-automessages.ts
// ---------------------------------------------------------------------------
function runSelfTests(): void {
  const assert = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`SELFTEST FAIL: ${label}`);
    console.log(`ok - ${label}`);
  };

  // shouldAutoMessage
  assert(shouldAutoMessage("Косметолог") === true, "matcher: Косметолог");
  assert(shouldAutoMessage("косметолога-эстетиста") === true, "matcher: косметолога form");
  assert(shouldAutoMessage("Мастер лазерной эпиляции") === true, "matcher: лазерн+эпиляц");
  assert(shouldAutoMessage("Специалист лазерной эпиляции") === true, "matcher: специалист");
  assert(shouldAutoMessage("Лазерный шлифовщик") === false, "matcher: лазерн without эпиляц");
  assert(shouldAutoMessage("Администратор") === false, "matcher: unrelated");
  assert(shouldAutoMessage("") === false, "matcher: empty");

  // normalizeFirstName
  assert(normalizeFirstName("Elena") === "Елена", "translit: Elena->Елена");
  assert(normalizeFirstName("  Mariya ") === "Мария", "translit+trim: Mariya->Мария");
  assert(normalizeFirstName("Анна") === "Анна", "cyrillic passthrough: Анна");
  assert(normalizeFirstName("Natalya") === "Наталья", "translit: Natalya->Наталья");
  assert(normalizeFirstName("") === "", "empty name");
  assert(normalizeFirstName("  ") === "", "whitespace-only name");

  // buildMessages name substitution + clean drop
  const withName = buildMessages("Elena");
  assert(withName[0].includes("Здравствуйте, Елена!"), "message1 has name");
  assert(!withName[0].includes("(имя)"), "message1 no placeholder left");
  const noName = buildMessages("");
  assert(noName[0].startsWith("Здравствуйте! Благодарим"), "message1 clean drop");
  assert(!noName[0].includes("(имя)") && !noName[0].includes(", !"), "message1 no stray comma");
  assert(withName[0].includes(BITRIX_FORM_URL) && !withName[0].includes("]("), "bare bitrix url");
  assert(withName[2].includes(TELEGRAM_CHANNEL_URL) && !withName[2].includes("]("), "bare telegram url");

  console.log("All hh-automessages self-tests passed.");
}

// Only run when invoked directly (tsx/node), never on import.
const isMain = (() => {
  try {
    return typeof process !== "undefined" && Array.isArray(process.argv) &&
      /hh-automessages\.(ts|cjs|js)$/.test(process.argv[1] ?? "");
  } catch {
    return false;
  }
})();
if (isMain) runSelfTests();
