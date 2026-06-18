/**
 * hh_cron.ts
 * Background jobs for the hh.ru integration:
 *   - startHhSyncCron(): poll negotiations (отклики) every ~3 min.
 *   - startHhTokenRefreshCron(): proactively refresh tokens expiring within 24h, hourly.
 *   - startHhMaintenanceCron(): clean expired oauth_states (~10 min) and
 *     reprocess pending/failed webhook_events (~30 s).
 *   - startHhVacanciesCron(): import active hh.ru vacancies hourly.
 *
 * All jobs guard on hhEnvConfigured() and the presence of a connected hh
 * integration, and isolate their own errors so one failing tick never kills
 * the loop. Modeled on avito_vacancies_cron.ts.
 */

import { storage } from "../storage.js";
import { HhClient, hhEnvConfigured, integrationHasTokens } from "../integrations/hh.js";
import { pollAll, processWebhookEvent } from "../integrations/hh-ingest.js";
import { importHhVacancies } from "../integrations/hh-vacancies.js";

const SOURCE = "hh";
const SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 min
const TOKEN_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 60 min
const OAUTH_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const WEBHOOK_RETRY_INTERVAL_MS = 30 * 1000; // 30 s
const VACANCIES_INTERVAL_MS = 60 * 60 * 1000; // 60 min

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // states older than 10 min are dead
const TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh if expiring < 24h
const WEBHOOK_BATCH = 20;

// Connection is decided by token presence, not the `status` column: a row
// stuck at status='error' from an earlier transient failure must still be
// polled so the successful pass can clear that error.
async function hasConnectedHh(): Promise<boolean> {
  const integ = await storage.getIntegration(SOURCE);
  return integrationHasTokens(integ);
}

/** Poll negotiations every ~3 minutes. */
export function startHhSyncCron(): void {
  if (!hhEnvConfigured()) {
    console.log("[hh_cron] hh.ru not configured, sync cron disabled");
    return;
  }
  console.log(`[hh_cron] sync cron started (every ${SYNC_INTERVAL_MS / 60000}m)`);
  const tick = async () => {
    try {
      if (!(await hasConnectedHh())) return;
      const r = await pollAll();
      if (r.ingestedCount || r.createdCount) {
        console.log(`[hh_cron] sync: ingested=${r.ingestedCount} created=${r.createdCount}`);
      }
    } catch (e) {
      console.error("[hh_cron] sync error:", e);
    }
  };
  // Stagger the first run slightly so startup isn't hammered.
  setTimeout(tick, 20 * 1000);
  setInterval(tick, SYNC_INTERVAL_MS);
}

/** Refresh tokens expiring within 24h, hourly. */
export function startHhTokenRefreshCron(): void {
  if (!hhEnvConfigured()) return;
  console.log(`[hh_cron] token refresh cron started (every ${TOKEN_REFRESH_INTERVAL_MS / 60000}m)`);
  const tick = async () => {
    try {
      const integ = await storage.getIntegration(SOURCE);
      const connected = integ && integrationHasTokens(integ) ? [integ] : [];
      for (const integration of connected) {
        if (!integration.tokenExpiresAt) continue;
        const expiresInMs = new Date(integration.tokenExpiresAt).getTime() - Date.now();
        if (expiresInMs < TOKEN_REFRESH_THRESHOLD_MS) {
          try {
            console.log(`[hh_cron] refreshing token for integration ${integration.id}`);
            await new HhClient(integration).refresh();
          } catch (e) {
            console.error(`[hh_cron] token refresh failed for ${integration.id}:`, e);
          }
        }
      }
    } catch (e) {
      console.error("[hh_cron] token refresh tick error:", e);
    }
  };
  setInterval(tick, TOKEN_REFRESH_INTERVAL_MS);
}

/** Maintenance: prune oauth_states (~10 min) and reprocess webhook_events (~30 s). */
export function startHhMaintenanceCron(): void {
  if (!hhEnvConfigured()) return;
  console.log("[hh_cron] maintenance cron started");

  const cleanupStates = async () => {
    try {
      const beforeIso = new Date(Date.now() - OAUTH_STATE_TTL_MS).toISOString();
      const removed = await storage.deleteExpiredOauthStates(beforeIso);
      if (removed > 0) console.log(`[hh_cron] pruned ${removed} expired oauth_states`);
    } catch (e) {
      console.error("[hh_cron] oauth_states cleanup error:", e);
    }
  };

  const retryWebhooks = async () => {
    try {
      const events = await storage.getWebhookEventsToProcess(SOURCE, WEBHOOK_BATCH, 5);
      for (const ev of events) {
        try {
          await processWebhookEvent(ev.id);
        } catch (e) {
          console.error(`[hh_cron] webhook reprocess failed for ${ev.id}:`, e);
        }
      }
      if (events.length) console.log(`[hh_cron] reprocessed ${events.length} webhook_events`);
    } catch (e) {
      console.error("[hh_cron] webhook retry tick error:", e);
    }
  };

  setTimeout(cleanupStates, 60 * 1000);
  setInterval(cleanupStates, OAUTH_CLEANUP_INTERVAL_MS);
  setInterval(retryWebhooks, WEBHOOK_RETRY_INTERVAL_MS);
}

/** Import active hh.ru employer vacancies hourly (plus once on startup). */
export function startHhVacanciesCron(): void {
  if (!hhEnvConfigured()) return;
  console.log(`[hh_cron] vacancies import cron started (every ${VACANCIES_INTERVAL_MS / 60000}m)`);
  const tick = async () => {
    try {
      if (!(await hasConnectedHh())) return;
      const r = await importHhVacancies();
      console.log("[hh_cron] vacancies import:", r);
    } catch (e) {
      console.error("[hh_cron] vacancies import error:", e);
    }
  };
  setTimeout(tick, 45 * 1000);
  setInterval(tick, VACANCIES_INTERVAL_MS);
}

/** Start all hh.ru background jobs. Safe to call once at boot. */
export function startHhCron(): void {
  startHhSyncCron();
  startHhTokenRefreshCron();
  startHhMaintenanceCron();
  startHhVacanciesCron();
}
