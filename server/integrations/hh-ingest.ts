// hh.ru ingestion pipeline.
//
// Turns hh.ru negotiations (отклики) into internal candidates, messages and
// activities. Designed to be idempotent: re-ingesting the same negotiation or
// message never creates duplicates. Used by both the polling job and the
// webhook processor.

import { storage } from "../storage";
import { HhClient, integrationHasTokens } from "./hh";
import { importHhVacancies } from "./hh-vacancies";
import {
  mapResumeToCandidate,
  mapNegotiationMessages,
  normalizePhone,
} from "./hh-mapper";
import type { Candidate, Vacancy } from "@shared/schema";

const SOURCE = "hh";

export interface IngestResult {
  candidateId: string | null;
  created: boolean; // true if a new candidate was created
  newMessages: number;
  skipped: boolean; // true if negotiation already fully ingested and no new messages
}

/**
 * Resolve (or create) the internal vacancy that a negotiation belongs to.
 * Strategy: external_ref match -> externalUrl match -> create placeholder.
 */
async function resolveVacancy(negotiation: any): Promise<string> {
  const hhVacancy = negotiation?.vacancy;
  const hhVacancyId = hhVacancy?.id != null ? String(hhVacancy.id) : null;

  if (hhVacancyId) {
    const ref = await storage.getExternalRef(SOURCE, "vacancy", hhVacancyId);
    if (ref) return ref.entityId;
  }

  const vacancyUrl =
    hhVacancy?.alternate_url ?? (hhVacancyId ? `https://hh.ru/vacancy/${hhVacancyId}` : null);

  // Try to match an existing vacancy by externalUrl.
  if (vacancyUrl) {
    const all: Vacancy[] = await storage.getVacancies();
    const match = all.find((v) => v.externalUrl && v.externalUrl === vacancyUrl);
    if (match) {
      if (hhVacancyId) {
        await storage.createExternalRef({
          entityType: "vacancy", entityId: match.id,
          source: SOURCE, externalId: hhVacancyId, externalType: "vacancy",
          meta: JSON.stringify({ url: vacancyUrl }),
        }).catch(() => undefined);
      }
      return match.id;
    }
  }

  // Create a placeholder vacancy.
  const title = hhVacancy?.name ?? "Вакансия с hh.ru";
  const city = hhVacancy?.area?.name ?? "—";
  const created = await storage.createVacancy({
    title,
    city,
    salary: formatVacancySalary(hhVacancy?.salary),
    status: "active",
    description: `Импортировано с hh.ru.${vacancyUrl ? ` Источник: ${vacancyUrl}` : ""}`,
    externalUrl: vacancyUrl,
  });
  if (hhVacancyId) {
    await storage.createExternalRef({
      entityType: "vacancy", entityId: created.id,
      source: SOURCE, externalId: hhVacancyId, externalType: "vacancy",
      meta: JSON.stringify({ url: vacancyUrl }),
    }).catch(() => undefined);
  }
  return created.id;
}

function formatVacancySalary(salary: any): string {
  if (!salary) return "—";
  const from = salary.from;
  const to = salary.to;
  const cur = (salary.currency ?? "RUR").toUpperCase();
  const sign = cur === "RUR" || cur === "RUB" ? "₽" : cur;
  if (from && to) return `${from.toLocaleString("ru-RU")}–${to.toLocaleString("ru-RU")} ${sign}`;
  if (from) return `от ${from.toLocaleString("ru-RU")} ${sign}`;
  if (to) return `до ${to.toLocaleString("ru-RU")} ${sign}`;
  return "—";
}

/** Insert negotiation messages, deduping by stored (source, external_id). */
async function syncMessages(
  client: HhClient,
  nid: string,
  candidateId: string,
): Promise<number> {
  let inserted = 0;
  let page = 0;
  const maxPages = 20;
  for (let i = 0; i < maxPages; i++) {
    let data: any;
    try {
      data = await client.listMessages(nid, { page });
    } catch (err) {
      console.error(`[hh-ingest] failed to fetch messages for negotiation ${nid}:`, err);
      break;
    }
    const items: any[] = data?.items ?? [];
    const mapped = mapNegotiationMessages(items, candidateId);
    for (const m of mapped) {
      if (m.externalId) {
        const existing = await storage.getMessageByExternal(SOURCE, m.externalId);
        if (existing) continue;
      }
      const { sentAt, ...rest } = m;
      await storage.createMessageAt(rest, sentAt);
      inserted++;
    }
    const pages = data?.pages ?? 1;
    page += 1;
    if (page >= pages || items.length === 0) break;
  }
  return inserted;
}

/**
 * Ingest a single negotiation by its hh.ru id. Idempotent.
 * `vacancyId` optionally overrides vacancy resolution (rarely needed).
 */
export async function ingestNegotiation(
  client: HhClient,
  nid: string,
  vacancyId?: string,
): Promise<IngestResult> {
  // 1. Already linked? Reuse the candidate and just sync messages.
  const existingRef = await storage.getExternalRef(SOURCE, "negotiation", String(nid));
  if (existingRef) {
    const candidateId = existingRef.entityId;
    const newMessages = await syncMessages(client, String(nid), candidateId);
    return { candidateId, created: false, newMessages, skipped: newMessages === 0 };
  }

  // 2. Fetch negotiation + resume.
  const negotiation = await client.getNegotiation(String(nid));
  const resumeId =
    negotiation?.resume?.id != null ? String(negotiation.resume.id) : null;

  let resume: any = negotiation?.resume ?? {};
  if (resumeId) {
    try {
      resume = await client.getResume(resumeId);
    } catch (err) {
      // Resume may be hidden/anonymous; fall back to whatever the negotiation carries.
      console.warn(`[hh-ingest] could not fetch resume ${resumeId}, using negotiation data:`, err);
    }
  }

  // 3. Resolve vacancy.
  const resolvedVacancyId = vacancyId ?? (await resolveVacancy(negotiation));

  // 4. Dedupe candidate by normalized phone.
  const insert = mapResumeToCandidate(resume, negotiation, resolvedVacancyId);
  const normalizedPhone = normalizePhone(insert.phone);

  let candidate: Candidate | undefined;
  let created = false;
  if (normalizedPhone && normalizedPhone !== "+" && insert.phone !== "Не указан") {
    candidate = await storage.getCandidateByPhone(normalizedPhone);
    if (!candidate) {
      // Also try the exact stored phone as a fallback.
      candidate = await storage.getCandidateByPhone(insert.phone);
    }
  }

  if (candidate) {
    // Reuse existing candidate. Record the new application as an activity.
    const vacancyTitle = (await storage.getVacancy(resolvedVacancyId))?.title ?? "вакансию";
    await storage.createActivity({
      candidateId: candidate.id,
      type: "message",
      description: `Новый отклик с hh.ru на «${vacancyTitle}»`,
      meta: JSON.stringify({ negotiationId: String(nid) }),
    });
  } else {
    candidate = await storage.createCandidate({ ...insert, phone: normalizedPhone || insert.phone });
    created = true;
  }

  // 5. External refs: candidate <- negotiation, candidate <- resume.
  await storage.createExternalRef({
    entityType: "candidate", entityId: candidate.id,
    source: SOURCE, externalId: String(nid), externalType: "negotiation",
    meta: JSON.stringify({ messagesUrl: negotiation?.messages_url ?? null }),
  }).catch(() => undefined);
  if (resumeId) {
    await storage.createExternalRef({
      entityType: "candidate", entityId: candidate.id,
      source: SOURCE, externalId: resumeId, externalType: "resume",
      meta: JSON.stringify({ resumeUrl: `https://hh.ru/resume/${resumeId}` }),
    }).catch(() => undefined);
  }

  // 6. Sync messages.
  const newMessages = await syncMessages(client, String(nid), candidate.id);

  // 7. Activity entry.
  if (created) {
    await storage.createActivity({
      candidateId: candidate.id,
      type: "stage_change",
      description: "Получен отклик с hh.ru",
      meta: JSON.stringify({ negotiationId: String(nid) }),
    });
  }

  return { candidateId: candidate.id, created, newMessages, skipped: false };
}

/**
 * Poll all connected hh.ru integrations: list negotiations updated since the
 * last sync and ingest each. Errors are isolated per-integration and recorded
 * on integration.lastError. Returns total ingested (created + updated) count.
 */
export async function pollAll(): Promise<{
  ingestedCount: number;
  createdCount: number;
  vacanciesPolled: number;
  noVacancies: boolean;
}> {
  // Select hh integrations by TOKEN presence, not by the `status` column. The
  // status can get stuck at 'error' after a transient failure (e.g. the old
  // bare /negotiations 400), which would otherwise prevent the cron from ever
  // running again and clearing that error. As long as we hold tokens, the
  // account is connected.
  const integ = await storage.getIntegration(SOURCE);
  const hhIntegrations =
    integ && integrationHasTokens(integ) ? [integ] : [];

  let ingestedCount = 0;
  let createdCount = 0;
  let vacanciesPolled = 0;
  let noVacancies = false;

  for (const integration of hhIntegrations) {
    try {
      const client = new HhClient(integration);
      // Pass NO dateFrom: the first sync must backfill ALL historical responses,
      // and lastSyncAt was already stamped by earlier no-op syncs (which would
      // otherwise exclude old responses). The ingest pipeline is idempotent via
      // external_refs on the negotiation id, so re-collecting everything every
      // sync never creates duplicates.
      const dateFrom = undefined;

      // Make sure any active employer vacancies are imported/linked first so
      // resolveVacancyIds() (used by the negotiation collector) has integer ids
      // to poll, and so the cron starts pulling responses for them.
      try {
        const imp = await importHhVacancies();
        if (imp.created || imp.updated) {
          console.log(`[hh_ingest] vacancy sync: total=${imp.total} created=${imp.created} updated=${imp.updated}`);
        }
      } catch (impErr) {
        console.warn("[hh_ingest] vacancy import before poll failed:", impErr);
      }

      // Employer negotiations MUST be collected per vacancy with an integer
      // vacancy_id — hh.ru rejects the bare /negotiations list with HTTP 400
      // ("vacancy_id: not integer value"). collectEmployerNegotiations() handles
      // pagination and never issues a vacancy_id-less request.
      const vacancyIds = await client.resolveVacancyIds(50);
      vacanciesPolled = vacancyIds.length;
      const negotiations =
        vacancyIds.length === 0
          ? []
          : await client.collectEmployerNegotiations({ perPage: 50, dateFrom });

      if (vacancyIds.length === 0) {
        // Not an error: the employer simply has no HH vacancies to pull
        // responses from yet. Log as info and let the status clear below.
        noVacancies = true;
        console.log("[hh_ingest] no active/imported HH vacancies — nothing to poll (status stays connected)");
      } else {
        console.log(`[hh_ingest] collected ${negotiations.length} negotiations across ${vacancyIds.length} vacancies`);
      }

      for (const n of negotiations) {
        const nid = n?.id != null ? String(n.id) : null;
        if (!nid) continue;
        try {
          const res = await ingestNegotiation(client, nid);
          if (!res.skipped) ingestedCount++;
          if (res.created) createdCount++;
        } catch (err) {
          console.error(`[hh-ingest] failed to ingest negotiation ${nid}:`, err);
        }
      }

      // Successful pass (even with 0 vacancies / 0 responses): stamp sync time
      // and clear any stale error. This is what unsticks a status='error' row.
      const current = client.getIntegration() ?? integration;
      await storage.updateIntegration(current.id, {
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        status: "connected",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[hh-ingest] polling failed for integration ${integration.id}:`, err);
      await storage.updateIntegration(integration.id, {
        status: "error",
        lastError: `Ошибка синхронизации hh.ru: ${msg}`,
      });
    }
  }

  return { ingestedCount, createdCount, vacanciesPolled, noVacancies };
}

/**
 * Process a queued webhook event. Parses the hh.ru payload, ingests the
 * referenced negotiation, and marks the event processed/failed.
 *
 * hh.ru webhook payload format is not fully documented and is enabled per
 * employer on request. We defensively look for a negotiation id under several
 * likely keys. TODO: confirm the exact field names with hh.ru support
 * (api@hh.ru) once webhooks are enabled for the employer account.
 */
export async function processWebhookEvent(eventId: string): Promise<void> {
  const event = await storage.getWebhookEvent(eventId);
  if (!event || event.status === "processed") return;

  try {
    const payload = JSON.parse(event.payload || "{}");
    const nid =
      payload?.negotiation_id ??
      payload?.negotiationId ??
      payload?.payload?.negotiation_id ??
      payload?.data?.negotiation_id ??
      event.externalId ??
      null;

    if (!nid) {
      // Nothing actionable; mark processed to avoid infinite retries but note it.
      await storage.updateWebhookEvent(eventId, {
        status: "processed",
        processedAt: new Date().toISOString(),
        lastError: "Не найден negotiation_id в payload (см. TODO про формат hh.ru)",
      });
      return;
    }

    // Use the hh integration that holds tokens (status may be stale).
    const integ = await storage.getIntegration(SOURCE);
    if (!integ || !integrationHasTokens(integ)) {
      throw new Error("Нет подключённой интеграции hh.ru для обработки вебхука");
    }
    const client = new HhClient(integ);
    await ingestNegotiation(client, String(nid));

    await storage.updateWebhookEvent(eventId, {
      status: "processed",
      processedAt: new Date().toISOString(),
      lastError: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hh-webhook] failed to process event ${eventId}:`, err);
    await storage.updateWebhookEvent(eventId, {
      status: "failed",
      attempts: (event.attempts ?? 0) + 1,
      lastError: msg,
    });
  }
}
