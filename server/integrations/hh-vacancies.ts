// hh.ru vacancy synchronization: import active employer vacancies into the
// local `vacancies` table and publish a local vacancy to hh.ru.
//
// Linkage between a local vacancy and its hh.ru vacancy id is tracked via
// external_refs (source='hh', externalType='vacancy'), mirroring the Avito
// pattern. Import is idempotent: re-running updates existing rows by ref.

import { storage } from "../storage.js";
import { HhClient, HhApiError, integrationHasTokens } from "./hh.js";
import { mapVacancyToHh, collectMissingHhFields } from "./hh-mapper.js";

const SOURCE = "hh";

function formatSalary(salary: any): string {
  if (!salary) return "";
  const from = salary.from;
  const to = salary.to;
  const cur = (salary.currency ?? "RUR").toUpperCase();
  const sign = cur === "RUR" || cur === "RUB" ? "₽" : cur;
  if (from && to) return `${Number(from).toLocaleString("ru-RU")}–${Number(to).toLocaleString("ru-RU")} ${sign}`;
  if (from) return `от ${Number(from).toLocaleString("ru-RU")} ${sign}`;
  if (to) return `до ${Number(to).toLocaleString("ru-RU")} ${sign}`;
  return "";
}

/**
 * Import all active hh.ru employer vacancies into the local vacancies table.
 * Idempotent via external_refs(hh, vacancy). Returns counters.
 */
export async function importHhVacancies(): Promise<{
  total: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  const integ = await storage.getIntegration(SOURCE);
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let total = 0;

  if (!integ || !integrationHasTokens(integ)) {
    return { total, created, updated, errors: ["hh.ru не подключён"] };
  }

  const client = new HhClient(integ);
  const employerId = client.resolveEmployerId();
  if (!employerId) {
    return { total, created, updated, errors: ["employer_id не определён"] };
  }

  for (let page = 0; page < 20; page++) {
    let data: any;
    try {
      data = await client.listVacancies(employerId, { page, perPage: 50 });
    } catch (e: any) {
      errors.push(`page ${page}: ${e?.message ?? String(e)}`);
      break;
    }
    const items: any[] = data?.items ?? [];
    if (items.length === 0) break;
    total += items.length;

    for (const item of items) {
      const hhId = item?.id != null ? String(item.id) : null;
      if (!hhId) continue;
      try {
        const url = item?.alternate_url ?? `https://hh.ru/vacancy/${hhId}`;
        const city = item?.area?.name ?? "—";
        const salary = formatSalary(item?.salary);
        const existingRef = await storage.getExternalRef(SOURCE, "vacancy", hhId);

        if (existingRef) {
          await storage.updateVacancy(existingRef.entityId, {
            title: item?.name ?? "Вакансия с hh.ru",
            city,
            salary: salary || "—",
            externalUrl: url,
            status: item?.archived ? "closed" : "active",
            source: SOURCE,
          });
          updated++;
        } else {
          const v = await storage.createVacancy({
            title: item?.name ?? "Вакансия с hh.ru",
            city,
            salary: salary || "—",
            status: item?.archived ? "closed" : "active",
            description: `Импортировано с hh.ru. Источник: ${url}`,
            externalUrl: url,
            source: SOURCE,
          });
          await storage.createExternalRef({
            entityType: "vacancy",
            entityId: v.id,
            source: SOURCE,
            externalId: hhId,
            externalType: "vacancy",
            meta: JSON.stringify({ url }),
          });
          created++;
        }
      } catch (e: any) {
        errors.push(`vacancy ${hhId}: ${e?.message ?? String(e)}`);
      }
    }

    const pages = data?.pages ?? 1;
    // Stop when hh.ru reports we've reached the last page. (A short page is no
    // longer a reliable "last page" signal now that per_page is capped at 50.)
    if (page + 1 >= pages) break;
  }

  console.log(`[hh_vacancies] import: total=${total} created=${created} updated=${updated} errors=${errors.length}`);
  return { total, created, updated, errors };
}

/** Default area (Москва=1) and professional role (Администратор=121) if not resolvable. */
const DEFAULT_AREA_ID = "1";
/**
 * Fallback professional_role for the beauty sphere. 121 = "Администратор"
 * (a broadly-accepted salon role) — used only when no keyword match is found.
 */
const DEFAULT_ROLE_ID = "121";

/** Flatten the nested hh /areas tree into a name->id map. */
function flattenAreas(nodes: any[], acc: Map<string, string>): void {
  for (const n of nodes ?? []) {
    if (n?.name && n?.id != null) acc.set(String(n.name).toLowerCase(), String(n.id));
    if (Array.isArray(n?.areas) && n.areas.length) flattenAreas(n.areas, acc);
  }
}

/**
 * Resolve a city name to an hh.ru area id. Returns null when the city is
 * missing or cannot be matched, so the caller can report it as a missing
 * required field rather than silently publishing to Moscow.
 */
async function resolveAreaId(client: HhClient, city: string | null | undefined): Promise<string | null> {
  if (!city || !city.trim()) return null;
  const needle = city.trim().toLowerCase();
  try {
    const tree = await client.getAreas();
    const map = new Map<string, string>();
    flattenAreas(Array.isArray(tree) ? tree : [tree], map);
    const exact = map.get(needle);
    if (exact) return exact;
    // Loose match: "Москва, ..." / "г. Москва" etc.
    for (const [name, id] of map) {
      if (needle.includes(name) || name.includes(needle)) return id;
    }
  } catch (e) {
    console.warn("[hh_vacancies] getAreas failed:", e);
  }
  return null;
}

/**
 * Keyword -> hh professional_role id map for the beauty sphere. Ids come from
 * GET /professional_roles ("Сфера: Красота, фитнес, спорт"). We match the
 * local vacancy title against these keywords; the first hit wins. Unmatched
 * titles fall back to DEFAULT_ROLE_ID.
 */
const BEAUTY_ROLE_KEYWORDS: Array<{ id: string; words: string[] }> = [
  { id: "125", words: ["маникюр", "ногт", "nail", "педикюр"] }, // Мастер маникюра/педикюра
  { id: "131", words: ["косметолог", "космет"] },               // Косметолог
  { id: "126", words: ["массаж", "массажист"] },                // Массажист
  { id: "130", words: ["парикмахер", "стилист", "колорист"] },  // Парикмахер
  { id: "129", words: ["визажист", "макияж", "бров", "ресниц", "lash", "brow"] }, // Визажист
  { id: "121", words: ["администратор", "ресепшн", "reception"] }, // Администратор
];

/** Resolve a beauty professional_role id from the vacancy title. */
function resolveProfessionalRoleId(title: string | null | undefined): string {
  const t = (title ?? "").toLowerCase();
  for (const { id, words } of BEAUTY_ROLE_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return id;
  }
  return DEFAULT_ROLE_ID;
}

/**
 * Publish a local vacancy to hh.ru (POST /vacancies). Stores the resulting
 * external_ref + external_url on success. hh.ru validation errors are surfaced
 * as a readable message. Publishing is paid — callers should confirm first.
 */
export async function publishVacancyToHh(localVacancyId: string): Promise<{
  ok: boolean;
  hhVacancyId?: string;
  externalUrl?: string;
  error?: string;
}> {
  const vacancy = await storage.getVacancy(localVacancyId);
  if (!vacancy) return { ok: false, error: "Вакансия не найдена" };

  // Already published? Don't create a duplicate.
  const existingRef = await storage.getExternalRefByEntity("vacancy", localVacancyId, SOURCE, "vacancy");
  if (existingRef) {
    return {
      ok: true,
      hhVacancyId: existingRef.externalId,
      externalUrl: vacancy.externalUrl ?? undefined,
      error: "Вакансия уже опубликована на hh.ru",
    };
  }

  const integ = await storage.getIntegration(SOURCE);
  if (!integ || !integrationHasTokens(integ)) {
    return { ok: false, error: "hh.ru не подключён. Подключите аккаунт в настройках." };
  }

  // Validate the local vacancy has everything hh.ru requires BEFORE calling the
  // API, so the user gets a clear list of missing fields instead of a 500/422.
  const missing = collectMissingHhFields(vacancy);
  const client = new HhClient(integ);
  const employerId = client.resolveEmployerId();
  if (!employerId) missing.push("employer_id (аккаунт hh.ru)");

  const areaId = await resolveAreaId(client, vacancy.city);
  if (!areaId) {
    missing.push(
      vacancy.city && vacancy.city.trim()
        ? `город «${vacancy.city}» не найден в справочнике hh.ru`
        : "город",
    );
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Не хватает обязательных полей для публикации на hh.ru: ${missing.join(", ")}. Заполните их в карточке вакансии и повторите.`,
    };
  }

  const professionalRoleId = resolveProfessionalRoleId(vacancy.title);
  const payload = mapVacancyToHh(vacancy, {
    areaId: areaId!,
    professionalRoleId,
    employerId,
  });

  try {
    const result = await client.createVacancy(payload);
    const hhVacancyId = result?.id != null ? String(result.id) : null;
    const externalUrl =
      result?.alternate_url ?? (hhVacancyId ? `https://hh.ru/vacancy/${hhVacancyId}` : null);

    if (hhVacancyId) {
      // external_ref(source='hh', externalType='vacancy') is what resolveVacancyIds()
      // reads, so the cron starts pulling negotiations for this vacancy.
      await storage.createExternalRef({
        entityType: "vacancy",
        entityId: localVacancyId,
        source: SOURCE,
        externalId: hhVacancyId,
        externalType: "vacancy",
        meta: JSON.stringify({ url: externalUrl, publishedAt: new Date().toISOString() }),
      }).catch(() => undefined);
    }
    await storage.updateVacancy(localVacancyId, {
      externalUrl: externalUrl ?? vacancy.externalUrl,
      source: SOURCE,
    });

    console.log(`[hh_vacancies] published vacancy ${localVacancyId} -> hh ${hhVacancyId}`);
    return { ok: true, hhVacancyId: hhVacancyId ?? undefined, externalUrl: externalUrl ?? undefined };
  } catch (err) {
    const message = describeHhPublishError(err);
    console.error(`[hh_vacancies] publish failed for ${localVacancyId}:`, message);
    return { ok: false, error: message };
  }
}

/** Turn an hh.ru validation error body into a human-readable Russian message. */
function describeHhPublishError(err: unknown): string {
  if (err instanceof HhApiError) {
    try {
      const body = JSON.parse(err.body);
      const errs: any[] = body?.errors ?? [];
      if (errs.length) {
        const parts = errs.map((e) => {
          const field = e?.location ?? e?.field ?? e?.type ?? "поле";
          const reason = e?.reason ?? e?.value ?? e?.type ?? "ошибка";
          return `${field}: ${reason}`;
        });
        return `hh.ru отклонил публикацию (${err.status}): ${parts.join("; ")}`;
      }
      if (body?.description) return `hh.ru: ${body.description} (${err.status})`;
    } catch {
      /* not JSON */
    }
    return `hh.ru вернул ошибку ${err.status}: ${err.body.slice(0, 300)}`;
  }
  return err instanceof Error ? err.message : String(err);
}
