// Iter6: Video Pipeline Cron
// Runs every minute, picks up to 2 pending interview_videos and processes them.

import { storage } from "../storage.js";
import { processVideo } from "./video_pipeline.js";

let cronHandle: ReturnType<typeof setInterval> | null = null;

export function startVideoPipelineCron(): void {
  if (cronHandle) return; // already started

  console.log("[video_pipeline_cron] Starting (interval: 60s)");

  cronHandle = setInterval(async () => {
    try {
      const pending = await storage.getPendingInterviewVideos(2);
      if (pending.length === 0) return;

      console.log(`[video_pipeline_cron] Processing ${pending.length} pending video(s)`);

      // Run in parallel
      await Promise.allSettled(
        pending.map((v) => processVideo(v.id))
      );
    } catch (err) {
      console.error("[video_pipeline_cron] Error:", err);
    }
  }, 60_000);

  // Also run a cleanup cron every day: remove video files for dismissed candidates older than 90 days
  setInterval(async () => {
    try {
      await cleanupOldVideos();
    } catch (err) {
      console.error("[video_pipeline_cron] Cleanup error:", err);
    }
  }, 24 * 60 * 60 * 1000);
}

async function cleanupOldVideos(): Promise<void> {
  const { existsSync, unlinkSync } = await import("node:fs");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const allVideos = await storage.getInterviewVideos({ status: "done" });
  for (const v of allVideos) {
    if (!v.completedAt) continue;
    const completedAt = new Date(v.completedAt);
    if (completedAt > cutoff) continue;

    // Check if candidate is dismissed
    const candidate = await storage.getCandidate(v.candidateId);
    if (candidate?.stage !== "dismissed") continue;

    // Remove local file
    if (v.localPath && existsSync(v.localPath)) {
      try {
        unlinkSync(v.localPath);
        await storage.updateInterviewVideo(v.id, { localPath: null });
        console.log(`[video_pipeline_cron] Cleaned up file for video ${v.id}`);
      } catch (err) {
        console.warn(`[video_pipeline_cron] Failed to cleanup ${v.localPath}:`, err);
      }
    }
  }
}
