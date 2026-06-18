/**
 * company_rating_cron.ts
 * Fetches Dream Job rating weekly (Monday 09:00 UTC).
 * Also runs on startup if last fetch > 7 days ago (or no data).
 */

import { storage } from "../storage";
import { fetchDreamjobRating } from "./company_rating_fetcher";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Schedule next Monday 09:00 UTC from now */
function msUntilNextMondayAt9(): number {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun,1=Mon,...
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilMonday);
  next.setUTCHours(9, 0, 0, 0);
  let ms = next.getTime() - now.getTime();
  if (ms <= 0) ms += 7 * 24 * 60 * 60 * 1000;
  return ms;
}

function scheduleWeekly() {
  const ms = msUntilNextMondayAt9();
  const hours = Math.round(ms / 3600000);
  console.log(`[company_rating_cron] Next fetch in ~${hours}h (Monday 09:00 UTC)`);
  setTimeout(async () => {
    try {
      await fetchDreamjobRating();
    } catch (e) {
      console.error("[company_rating_cron] Weekly fetch error:", e);
    }
    scheduleWeekly(); // reschedule for next week
  }, ms);
}

export async function startCompanyRatingCron() {
  console.log("[company_rating_cron] Starting...");

  // Check if we need an immediate fetch
  try {
    const latest = await storage.getLatestCompanyRating("dreamjob");
    if (!latest) {
      console.log("[company_rating_cron] No data yet, fetching now...");
      await fetchDreamjobRating();
    } else {
      const age = Date.now() - new Date(latest.fetchedAt).getTime();
      if (age > SEVEN_DAYS_MS) {
        console.log("[company_rating_cron] Data is stale (>7 days), fetching now...");
        await fetchDreamjobRating();
      } else {
        const ageDays = Math.floor(age / 86400000);
        console.log(`[company_rating_cron] Data is fresh (${ageDays} days old), skipping initial fetch`);
      }
    }
  } catch (e) {
    console.error("[company_rating_cron] Startup check failed:", e);
  }

  scheduleWeekly();
}
