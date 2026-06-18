// Normalizers that translate hh.ru API payloads into our internal insert shapes.
//
// The hh.ru resume / negotiation / message schemas are large and partly
// optional; everything here is defensive (optional chaining + fallbacks) so a
// missing field never throws during ingestion.

import type { InsertCandidate, InsertMessage, Vacancy } from "@shared/schema";

/** Normalize a Russian phone number to +7XXXXXXXXXX where possible. */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return "+7" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "+7" + digits;
  }
  // Unknown format: keep digits with a leading + so it stays comparable.
  return digits ? "+" + digits : raw.trim();
}

/** Extract a usable phone from hh resume.contact[]. Prefers mobile/cell. */
function pickPhone(resume: any): string {
  const contacts: any[] = resume?.contact ?? [];
  // hh contact item: { type: { id: "cell"|"home"|"work" }, value: { formatted, country, city, number } | string }
  const byType = (typeId: string) =>
    contacts.find((c) => c?.type?.id === typeId);
  const phoneContact =
    byType("cell") ?? contacts.find((c) => c?.value?.formatted || c?.value?.number);
  if (phoneContact) {
    const v = phoneContact.value;
    const formatted = typeof v === "string" ? v : v?.formatted ?? v?.number;
    if (formatted) return normalizePhone(formatted);
  }
  return "";
}

/** Extract an email from hh resume.contact[]. */
function pickEmail(resume: any): string | null {
  const contacts: any[] = resume?.contact ?? [];
  const emailContact = contacts.find(
    (c) => c?.type?.id === "email" || (typeof c?.value === "string" && c.value.includes("@")),
  );
  if (emailContact) {
    const v = emailContact.value;
    return typeof v === "string" ? v : v?.email ?? v?.formatted ?? null;
  }
  return null;
}

/** Convert total experience months into a Russian "X лет Y мес" string. */
export function formatExperience(resume: any): string {
  const months: number | undefined = resume?.total_experience?.months;
  if (typeof months !== "number" || months <= 0) return "Без опыта";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${pluralYears(years)}`);
  if (rem > 0) parts.push(`${rem} мес`);
  return parts.join(" ") || "Без опыта";
}

function pluralYears(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "год";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "года";
  return "лет";
}

/** Format expected salary from resume.salary { amount, currency }. */
function formatSalary(resume: any): string | null {
  const salary = resume?.salary;
  if (!salary || typeof salary.amount !== "number") return null;
  const currency = (salary.currency ?? "RUR").toUpperCase();
  const sign = currency === "RUR" || currency === "RUB" ? "₽" : currency;
  const amount = salary.amount.toLocaleString("ru-RU");
  return `${amount} ${sign}`;
}

/** Pick the best avatar url from resume.photo. */
function pickAvatar(resume: any): string | null {
  const photo = resume?.photo;
  if (!photo) return null;
  return photo.medium ?? photo.small ?? photo.id ?? null;
}

/** Build the notes string from key skills, last position and education. */
function buildNotes(resume: any): string {
  const lines: string[] = [];

  const middle = resume?.middle_name;
  if (middle) lines.push(`Отчество: ${middle}`);

  const keySkills: string[] = (resume?.skill_set ?? []).filter(Boolean);
  if (keySkills.length) lines.push(`Ключевые навыки: ${keySkills.slice(0, 15).join(", ")}`);

  const exp: any[] = resume?.experience ?? [];
  if (exp.length) {
    const last = exp[0];
    const pos = last?.position ?? "";
    const company = last?.company ?? "";
    const period = [last?.start, last?.end ?? "наст. время"].filter(Boolean).join(" — ");
    lines.push(`Последнее место: ${[pos, company].filter(Boolean).join(" @ ")} (${period})`.trim());
  }

  const edu = resume?.education;
  const primary: any[] = edu?.primary ?? [];
  if (primary.length) {
    const e = primary[0];
    lines.push(`Образование: ${[e?.name, e?.organization, e?.result].filter(Boolean).join(", ")}`);
  } else if (edu?.level?.name) {
    lines.push(`Образование: ${edu.level.name}`);
  }

  const about = resume?.about;
  if (about) lines.push(`О себе: ${String(about).slice(0, 500)}`);

  return lines.join("\n");
}

/** Build candidate tags from top resume skills + the source marker. */
function buildTags(resume: any): string[] {
  const skills: string[] = (resume?.skill_set ?? []).filter(Boolean);
  const top = skills.slice(0, 5);
  return [...top, "hh.ru"];
}

/**
 * Map an hh.ru resume (+ negotiation context) to our InsertCandidate.
 * `vacancyId` is our internal vacancy id resolved by the ingest pipeline.
 */
export function mapResumeToCandidate(
  resume: any,
  negotiation: any,
  vacancyId: string,
): InsertCandidate {
  const first = resume?.first_name ?? "";
  const last = resume?.last_name ?? "";
  const fullName = [first, last].filter(Boolean).join(" ").trim() || "Кандидат с hh.ru";

  const phone = pickPhone(resume);
  const city = resume?.area?.name ?? negotiation?.vacancy?.area?.name ?? "—";
  const avatar = pickAvatar(resume);
  const resumeId = resume?.id ?? negotiation?.resume?.id ?? "";

  return {
    fullName,
    phone: phone || "Не указан",
    email: pickEmail(resume),
    city,
    vacancyId,
    source: "hh",
    sourceUrl: resumeId ? `https://hh.ru/resume/${resumeId}` : null,
    stage: "response",
    experience: formatExperience(resume),
    expectedSalary: formatSalary(resume),
    rating: null,
    notes: buildNotes(resume) || null,
    tags: JSON.stringify(buildTags(resume)),
    rejectReason: null,
    avatarUrl: avatar,
    resumeUrl: resumeId ? `https://hh.ru/resume/${resumeId}` : null,
    externalAvatarUrl: avatar,
  };
}

/** Parse a stored salary string ("от 50 000 ₽", "50000–70000 ₽") into hh salary. */
export function parseSalaryToHh(salary: string | null | undefined): {
  from: number | null;
  to: number | null;
  currency: string;
  gross: boolean;
} | null {
  if (!salary || !salary.trim()) return null;
  const nums = salary.replace(/ /g, " ").match(/\d[\d\s]*/g);
  if (!nums || nums.length === 0) return null;
  const cleaned = nums.map((n) => parseInt(n.replace(/\s/g, ""), 10)).filter((n) => !Number.isNaN(n) && n > 0);
  if (cleaned.length === 0) return null;
  const lower = salary.toLowerCase();
  let from: number | null = null;
  let to: number | null = null;
  if (lower.includes("от") && !lower.includes("до")) {
    from = cleaned[0];
  } else if (lower.includes("до") && !lower.includes("от")) {
    to = cleaned[0];
  } else if (cleaned.length >= 2) {
    from = cleaned[0];
    to = cleaned[1];
  } else {
    from = cleaned[0];
  }
  const currency = /\$|usd/i.test(salary) ? "USD" : /€|eur/i.test(salary) ? "EUR" : "RUR";
  return { from, to, currency, gross: false };
}

/**
 * Map a local vacancy to an hh.ru POST /vacancies payload.
 *
 * hh.ru requires `area`, `professional_roles`, `name`, `description` and
 * `billing_type`. `areaId` and `professionalRoleId` are resolved by the caller
 * from the hh dictionaries (with sensible defaults). Description must be HTML.
 */
export function mapVacancyToHh(
  vacancy: Vacancy,
  opts: { areaId: string; professionalRoleId: string; employerId?: string | null },
): Record<string, unknown> {
  const descriptionHtml = toHtml(vacancy.description || vacancy.title);
  const payload: Record<string, unknown> = {
    name: vacancy.title,
    description: descriptionHtml,
    area: { id: String(opts.areaId) },
    professional_roles: [{ id: String(opts.professionalRoleId) }],
    // "free" requires a free quota; employers without quota must use a paid type.
    // We default to the standard paid type; hh validates against the employer plan.
    billing_type: { id: "standard" },
    schedule: { id: "fullDay" },
    experience: { id: "noExperience" },
    employment: { id: "full" },
  };
  const salary = parseSalaryToHh(vacancy.salary);
  if (salary && (salary.from || salary.to)) {
    payload.salary = {
      from: salary.from,
      to: salary.to,
      currency: salary.currency,
      gross: salary.gross,
    };
  }
  return payload;
}

/**
 * Inspect a local vacancy and return the list of fields that hh.ru requires
 * for POST /vacancies but are missing/empty locally. The caller adds
 * area/employer checks (those need API lookups). Returns [] when complete.
 *
 * hh.ru hard-requires: name, description (>= ~40 chars of real text),
 * area, professional_roles. We treat placeholder values ("—", "") as missing.
 */
export function collectMissingHhFields(vacancy: Vacancy): string[] {
  const missing: string[] = [];
  const isBlank = (v: string | null | undefined) =>
    !v || !v.trim() || v.trim() === "—";

  if (isBlank(vacancy.title)) missing.push("название вакансии");

  // hh.ru rejects vacancies with a too-short description. Strip tags before
  // measuring so an empty "<p></p>" doesn't pass.
  const descText = (vacancy.description ?? "").replace(/<[^>]*>/g, "").trim();
  if (isBlank(vacancy.description) || descText.length < 40) {
    missing.push("описание (не менее 40 символов)");
  }

  return missing;
}

/** Minimal text->HTML: if the text already contains tags, keep it; else wrap paragraphs. */
function toHtml(text: string): string {
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`);
  return paras.join("") || `<p>${escapeHtml(text)}</p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Map hh.ru negotiation messages to our InsertMessage[] for a given candidate.
 * `messages` is the array from GET /negotiations/{nid}/messages -> items.
 */
export function mapNegotiationMessages(
  messages: any[],
  candidateId: string,
): Array<InsertMessage & { externalId: string | null; sentAt: string }> {
  return (messages ?? []).map((m) => {
    const isApplicant = m?.author?.participant_type === "applicant";
    const read = m?.read; // hh may expose a `read` boolean on the message
    return {
      candidateId,
      channel: "hh",
      direction: isApplicant ? "in" : "out",
      text: m?.text ?? "",
      isRead: isApplicant ? (read === true ? 1 : 0) : 1,
      source: "hh",
      externalId: m?.id != null ? String(m.id) : null,
      deliveryStatus: isApplicant ? null : "delivered",
      // sentAt is normally auto-set by storage, but we preserve the source time.
      sentAt: m?.created_at ?? new Date().toISOString(),
    };
  });
}
