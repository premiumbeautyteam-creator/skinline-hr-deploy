// Probation cron — runs daily at 09:00 UTC
// Creates checkpoints for active probation_tracks at days 7/14/30/60/90
// Fires alert when day >= 90 and no finalDecision

import { storage } from "../storage.js";

const CHECKPOINT_DAYS = [7, 14, 30, 60, 90];

export async function runProbationCron(): Promise<void> {
  try {
    const activeTracks = await storage.getProbationTracks({ status: "active" });
    const now = new Date();

    for (const track of activeTracks) {
      const started = new Date(track.startedAt);
      const daysSinceStart = Math.floor(
        (now.getTime() - started.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check existing checkpoints
      const existingCheckpoints = await storage.getCheckpoints(track.id);
      const existingDays = new Set(existingCheckpoints.map((c) => c.dayNumber));

      for (const dayNum of CHECKPOINT_DAYS) {
        if (daysSinceStart >= dayNum && !existingDays.has(dayNum)) {
          // Create checkpoint
          const dueDate = new Date(started);
          dueDate.setDate(dueDate.getDate() + dayNum);

          await storage.createCheckpoint({
            trackId: track.id,
            dayNumber: dayNum,
            dueAt: dueDate.toISOString(),
            completedAt: null,
            status: daysSinceStart > dayNum ? "overdue" : "pending",
            checkType: "pulse_survey",
            result: null,
          });

          console.log(
            `[probation_cron] Created checkpoint day ${dayNum} for track ${track.id}`
          );
        }
      }

      // Mark overdue existing checkpoints
      for (const cp of existingCheckpoints) {
        if (cp.status === "pending" && new Date(cp.dueAt) < now) {
          await storage.updateCheckpoint(cp.id, { status: "overdue" });
        }
      }

      // Alert if day >= 90 and no final decision
      if (daysSinceStart >= 90 && !track.finalDecisionAt) {
        // Check if alert already exists
        const existingAlerts = await storage.getAlerts({ type: "probation_no_final_decision" });
        const alreadyAlerted = existingAlerts.some(
          (a) => a.relatedEntity && JSON.parse(a.relatedEntity).trackId === track.id && !a.resolvedAt
        );
        if (!alreadyAlerted) {
          const candidate = await storage.getCandidate(track.candidateId);
          await storage.createAlert({
            type: "probation_no_final_decision",
            severity: "high",
            title: "Испытательный срок завершён — нет решения",
            description: `Кандидат ${candidate?.fullName ?? track.candidateId} прошёл 90 дней, итоговое решение не принято.`,
            candidateId: track.candidateId,
            userId: track.managerId ?? undefined,
            relatedEntity: JSON.stringify({ trackId: track.id }),
            resolvedAt: null,
            resolvedBy: null,
          });
          console.log(`[probation_cron] Alert created for track ${track.id} (no final decision at day 90+)`);
        }
      }
    }
  } catch (err) {
    console.error("[probation_cron] Error:", err);
  }
}

// Schedule: once per day at 09:00 UTC
export function startProbationCron(): NodeJS.Timeout {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function msUntilNext9UTC(): number {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(9, 0, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - now.getTime();
  }

  // Run immediately once (for dev/initial deploy), then schedule
  runProbationCron().catch((e) => console.error("[probation_cron] Initial run error:", e));

  let timer: NodeJS.Timeout;

  function schedule() {
    const delay = msUntilNext9UTC();
    timer = setTimeout(() => {
      runProbationCron().catch((e) => console.error("[probation_cron] Error:", e));
      // Schedule next run
      const interval = setInterval(() => {
        runProbationCron().catch((e) => console.error("[probation_cron] Error:", e));
      }, MS_PER_DAY);
      // Return interval ref — store in outer scope for cleanup
      // (for simplicity we keep the setInterval going)
      void interval;
    }, delay);
  }

  schedule();
  return timer!;
}
