/**
 * avito_vacancies_cron.ts
 * Imports active Avito ads into the vacancies table every hour (at :17).
 * Also runs once on startup.
 */

import { importAvitoVacancies } from "../integrations/avito-vacancies.js";
import { avitoEnvConfigured } from "../integrations/avito.js";

const HOUR_MS = 60 * 60 * 1000;

/** Milliseconds until the next :17 of any hour */
function msUntilNextHourAt17(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(17, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setHours(next.getHours() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleHourly() {
  const ms = msUntilNextHourAt17();
  const mins = Math.round(ms / 60000);
  console.log(`[avito_vacancies_cron] Next sync in ~${mins}m (hourly at :17)`);
  setTimeout(async () => {
    try {
      const r = await importAvitoVacancies();
      console.log('[avito_vacancies_cron] hourly sync:', r);
    } catch (e) {
      console.error('[avito_vacancies_cron] cron error:', e);
    }
    scheduleHourly();
  }, ms);
}

export async function startAvitoVacanciesCron() {
  if (!avitoEnvConfigured()) {
    console.log('[avito_vacancies_cron] Avito not configured, skipping');
    return;
  }
  console.log('[avito_vacancies_cron] Starting...');

  // Run once on startup
  try {
    const r = await importAvitoVacancies();
    console.log('[avito_vacancies_cron] startup sync:', r);
  } catch (e) {
    console.error('[avito_vacancies_cron] startup error:', e);
  }

  scheduleHourly();
}
