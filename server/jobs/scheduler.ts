// Scheduler: tick every minute, execute pending scheduled_actions
// Iter3: also publishes channel posts, refills calendar, reactivates reserve

import { storage } from "../storage.js";
import { getTelegram } from "../integrations/telegram.js";
import { runAiScreening, runPredictiveScore } from "../automations/engine.js";
import { runOcrForDocument } from "../routes/documents.js";
import { generatePost, generateContentPlan, generateReactivationMessage, pickRubricWeighted } from "../lib/content.js";
import { detectSentimentAndIntent } from "../lib/ai.js";
import type { ScheduledAction, Candidate, CrmUser } from "@shared/schema";

async function executeAction(action: ScheduledAction): Promise<void> {
  const candidate = await storage.getCandidate(action.candidateId);
  if (!candidate) {
    await storage.updateScheduledAction(action.id, {
      status: "cancelled",
      executedAt: new Date().toISOString(),
      lastError: "Candidate not found",
    });
    return;
  }

  // Critical check: candidate must still be on the trigger_stage
  // Exception: ai_screen can run even if stage has moved (to still capture verdict)
  if (action.kind !== "ai_screen" && candidate.stage !== action.triggerStage) {
    await storage.updateScheduledAction(action.id, {
      status: "cancelled",
      executedAt: new Date().toISOString(),
      lastError: `Stage mismatch: expected ${action.triggerStage}, got ${candidate.stage}`,
    });
    return;
  }

  const now = new Date().toISOString();

  try {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(action.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    switch (action.kind) {
      case "tg_message": {
        const text = typeof payload.text === "string" ? payload.text : "";
        await sendToCandidateOrLog(candidate, text);
        break;
      }

      case "tg_message_to_user": {
        const roleKey = typeof payload.roleKey === "string" ? payload.roleKey : "";
        const text = typeof payload.text === "string" ? payload.text : "";
        const user = await storage.getCrmUserByRole(roleKey);
        if (user) {
          await sendToUser(user, text, candidate.id);
        } else {
          console.warn(`[scheduler] User with role ${roleKey} not found for action ${action.id}`);
        }
        break;
      }

      case "create_task": {
        const assigneeId = typeof payload.assigneeId === "string" ? payload.assigneeId : "";
        const title = typeof payload.title === "string" ? payload.title : "Задача";
        const description = typeof payload.description === "string" ? payload.description : "";
        const dueOffset = typeof payload.dueOffsetMs === "number" ? payload.dueOffsetMs : 24 * 3600000;
        if (assigneeId) {
          await storage.createTask({
            candidateId: candidate.id,
            assigneeId,
            title,
            description,
            dueAt: new Date(Date.now() + dueOffset).toISOString(),
            status: "open",
            source: "auto",
            triggerStage: action.triggerStage,
          });
        }
        break;
      }

      case "ai_screen": {
        // Run AI screening in background (long-running)
        await runAiScreening(candidate.id);
        break;
      }

      case "predictive_score": {
        await runPredictiveScore(candidate.id);
        break;
      }

      case "ocr": {
        // Iter4: Run OCR on a document
        const documentId = typeof payload.documentId === "string" ? payload.documentId : "";
        if (documentId) {
          await runOcrForDocument(documentId);
        } else {
          console.warn(`[scheduler] ocr action ${action.id} missing documentId in payload`);
        }
        break;
      }

      default:
        console.warn(`[scheduler] Unknown action kind: ${action.kind}`);
        break;
    }

    await storage.updateScheduledAction(action.id, {
      status: "done",
      executedAt: now,
    });
  } catch (err) {
    console.error(`[scheduler] Action ${action.id} failed:`, err);
    await storage.updateScheduledAction(action.id, {
      status: "failed",
      executedAt: now,
      lastError: String(err),
    });
  }
}

async function sendToCandidateOrLog(candidate: Candidate, text: string): Promise<void> {
  const sentAt = new Date().toISOString();
  try {
    const tg = getTelegram();
    if (tg && candidate.telegramChatId) {
      const result = await tg.sendMessage(candidate.telegramChatId, text);
      await storage.createMessageAt({
        candidateId: candidate.id,
        channel: "telegram_bot",
        direction: "out",
        text,
        isRead: 1,
        deliveryStatus: result.ok ? "delivered" : "failed",
        meta: result.message_id ? JSON.stringify({ tg_message_id: result.message_id }) : null,
      }, sentAt);
    } else {
      if (!getTelegram()) {
        console.log(`[scheduler:dry-run] → candidate ${candidate.id}: ${text.substring(0, 80)}...`);
      }
      await storage.createMessageAt({
        candidateId: candidate.id,
        channel: "telegram_bot",
        direction: "out",
        text,
        isRead: 1,
        deliveryStatus: "pending",
        meta: null,
      }, sentAt);
    }
  } catch (err) {
    console.error("[scheduler] sendToCandidateOrLog error:", err);
  }
}

async function sendToUser(user: CrmUser, text: string, candidateId: string): Promise<void> {
  try {
    const tg = getTelegram();
    if (tg && user.telegramChatId) {
      await tg.sendMessage(user.telegramChatId, text);
    } else if (!getTelegram()) {
      console.log(`[scheduler:dry-run] → user ${user.id} (${user.roleKey}): ${text.substring(0, 80)}...`);
    }
    await storage.createActivity({
      candidateId,
      type: "message",
      description: `Таймер: уведомление отправлено ${user.name} (${user.roleKey})`,
      meta: JSON.stringify({ userId: user.id, channel: "telegram" }),
    });
  } catch (err) {
    console.error("[scheduler] sendToUser error:", err);
  }
}

let tickRunning = false;

export async function schedulerTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const now = new Date().toISOString();
    const pending = await storage.getPendingScheduledActions(now);
    if (pending.length > 0) {
      console.log(`[scheduler] Executing ${pending.length} pending action(s)`);
    }
    for (const action of pending) {
      await executeAction(action);
    }

    // Iter3: Channel post publishing (every tick)
    await channelPublishTick().catch((err) => console.error("[scheduler] channelPublishTick error:", err));

    // Iter3: Hourly metrics
    const currentHour = utcHour();
    if (currentHour !== lastHourlyMetricsHour) {
      lastHourlyMetricsHour = currentHour;
      metricsTick().catch((err) => console.error("[scheduler] metricsTick error:", err));
    }

    // Iter3: Daily calendar refill (03:00 MSK = 00:00 UTC)
    const today = utcDateStr();
    if (currentHour === CALENDAR_REFILL_UTC_HOUR && lastDailyCalendarDate !== today) {
      lastDailyCalendarDate = today;
      refillContentCalendar().catch((err) => console.error("[scheduler] refillContentCalendar error:", err));
    }

    // Iter3: Daily reactivation (11:00 MSK = 08:00 UTC)
    if (currentHour === REACTIVATION_UTC_HOUR && lastDailyReactivationDate !== today) {
      lastDailyReactivationDate = today;
      reactivationTick().catch((err) => console.error("[scheduler] reactivationTick error:", err));
    }
  } catch (err) {
    console.error("[scheduler] Tick error:", err);
  } finally {
    tickRunning = false;
  }
}

// ============================================================================
// Iter3: Channel autopilot
// ============================================================================

/** Publish a single scheduled channel post */
export async function publishChannelPost(postId: string): Promise<void> {
  const post = await storage.getChannelPost(postId);
  if (!post || post.status !== "scheduled") return;

  const settings = await storage.getChannelSettings();
  const chatId = settings?.channelUsername ?? "@SkinLineHR";
  const tg = getTelegram();

  if (!tg) {
    console.log("[channel] Telegram not configured — dry-run publish", post.id);
    await storage.updateChannelPost(post.id, {
      status: "published",
      publishedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    let messageId: number | undefined;

    if (post.pollOptions) {
      let pollOptions: string[] = [];
      try { pollOptions = JSON.parse(post.pollOptions) as string[]; } catch { /* ignore */ }
      if (pollOptions.length >= 2) {
        const result = await tg.sendChannelPoll(chatId, post.body.slice(0, 300), pollOptions);
        if (!result.ok) {
          console.error(`[channel] sendChannelPoll failed for ${post.id}:`, result.error);
          await storage.updateChannelPost(post.id, {
            status: "failed",
            meta: JSON.stringify({ lastError: result.error }),
          });
          return;
        }
        messageId = result.messageId;
      }
    }

    if (!messageId) {
      const result = await tg.sendChannelMessage(chatId, post.body);
      if (!result.ok) {
        console.error(`[channel] sendChannelMessage failed for ${post.id}:`, result.error);
        await storage.updateChannelPost(post.id, {
          status: "failed",
          meta: JSON.stringify({ lastError: result.error }),
        });
        return;
      }
      messageId = result.messageId;
    }

    const now = new Date().toISOString();
    await storage.updateChannelPost(post.id, {
      status: "published",
      publishedAt: now,
      tgMessageId: messageId,
    });
    if (settings) {
      await storage.upsertChannelSettings({ ...settings, lastPostAt: now });
    }
    console.log(`[channel] Published post ${post.id} (tg_msg_id=${messageId})`);
  } catch (err) {
    console.error(`[channel] Unexpected error publishing ${post.id}:`, err);
    await storage.updateChannelPost(post.id, {
      status: "failed",
      meta: JSON.stringify({ lastError: String(err) }),
    });
  }
}

/** Tick: publish all scheduled channel posts due now */
async function channelPublishTick(): Promise<void> {
  const settings = await storage.getChannelSettings();
  if (!settings?.autopilotEnabled) return;

  const now = new Date().toISOString();
  const due = await storage.getScheduledChannelPosts(now);
  for (const post of due) {
    await publishChannelPost(post.id);
  }
}

/** Refill content calendar if fewer than 2*postsPerWeek posts in next 14 days */
export async function refillContentCalendar(): Promise<number> {
  const settings = await storage.getChannelSettings();
  if (!settings) return 0;

  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 86400000).toISOString();
  const nowIso = now.toISOString();

  const scheduled = await storage.getChannelPosts({ status: "scheduled", from: nowIso, to: horizon });
  const needed = (settings.postsPerWeek * 2) - scheduled.length;
  if (needed <= 0) return 0;

  console.log(`[channel] Refilling calendar: need ${needed} more posts`);

  const slots = await generateContentPlan(2);
  const existingTimes = new Set(scheduled.map((p) => p.scheduledAt));
  const newSlots = slots.filter((s) => !existingTimes.has(s.scheduledAt)).slice(0, needed);

  let created = 0;
  for (const slot of newSlots) {
    const result = await generatePost({ rubricKey: slot.rubricKey });
    if (!result) continue;

    await storage.createChannelPost({
      rubricKey: slot.rubricKey,
      status: "scheduled",
      title: result.title,
      body: result.body,
      imageUrl: null,
      pollOptions: result.pollOptions ? JSON.stringify(result.pollOptions) : null,
      scheduledAt: slot.scheduledAt,
      publishedAt: null,
      tgMessageId: null,
      createdBy: "ai",
      reviewedBy: null,
      generatedFromPrompt: null,
      meta: null,
    });
    created++;
    console.log(`[channel] Created scheduled post for ${slot.scheduledAt} (rubric=${slot.rubricKey})`);
  }

  return created;
}

/** Daily reactivation: send messages to reserve candidates older than 30 days */
export async function reactivationTick(): Promise<void> {
  const reserveCandidates = await storage.getCandidatesByStageOlderThan("reserve", 30);
  if (reserveCandidates.length === 0) return;

  const toReactivate = reserveCandidates.slice(0, 3);
  const tg = getTelegram();

  for (const candidate of toReactivate) {
    const recentReactivations = await storage.getReserveReactivations(20);
    const recentForCandidate = recentReactivations.filter(
      (r) =>
        r.candidateId === candidate.id &&
        new Date(r.attemptAt).getTime() > Date.now() - 5 * 86400000,
    );
    if (recentForCandidate.length > 0) continue;

    try {
      const message = await generateReactivationMessage(candidate);
      const template = "reactivation_reserve_30d";

      if (tg && candidate.telegramChatId) {
        const result = await tg.sendMessage(candidate.telegramChatId, message);
        await storage.createReserveReactivation({
          candidateId: candidate.id,
          attemptAt: new Date().toISOString(),
          channel: "telegram",
          template,
          status: result.ok ? "sent" : "no_response",
          reply: null,
        });
        await storage.createActivity({
          candidateId: candidate.id,
          type: "message",
          description: "Реактивация: отправлено сообщение кандидату из резерва",
          meta: JSON.stringify({ channel: "telegram", reactivation: true }),
        });
        console.log(`[reactivation] Sent to candidate ${candidate.id} (${candidate.fullName})`);
      } else {
        await storage.createReserveReactivation({
          candidateId: candidate.id,
          attemptAt: new Date().toISOString(),
          channel: "telegram",
          template,
          status: "sent",
          reply: null,
        });
        console.log(`[reactivation:dry-run] candidate ${candidate.id}: ${message.slice(0, 80)}...`);
      }
    } catch (err) {
      console.error(`[reactivation] Error for candidate ${candidate.id}:`, err);
    }
  }

  // Mark no_response for reactivations sent >5 days ago without reply
  const allRecent = await storage.getReserveReactivations(100);
  const stale = allRecent.filter(
    (r) =>
      r.status === "sent" &&
      new Date(r.attemptAt).getTime() < Date.now() - 5 * 86400000,
  );
  for (const r of stale) {
    await storage.updateReserveReactivation(r.id, { status: "no_response" });
  }
}

/** Hourly best-effort metrics collection */
async function metricsTick(): Promise<void> {
  const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();
  const recentPosts = (await storage.getChannelPosts({ status: "published" })).filter(
    (p) => p.publishedAt && p.publishedAt >= cutoff,
  );
  if (recentPosts.length === 0) return;

  const tg = getTelegram();
  const settings = await storage.getChannelSettings();
  const chatId = settings?.channelUsername ?? "@SkinLineHR";

  for (const post of recentPosts) {
    let membersCount = 0;
    if (tg) {
      try {
        const chatInfo = await tg.getChat(chatId);
        membersCount = chatInfo?.membersCount ?? 0;
      } catch { /* ignore */ }
    }
    // TODO: integrate MTProto or @StatusBot for real view counts
    await storage.insertChannelMetric({
      postId: post.id,
      views: membersCount,
      reactions: 0,
      forwards: 0,
      comments: 0,
      measuredAt: new Date().toISOString(),
    });
  }
}

// Track last daily job timestamps
let lastDailyReactivationDate = "";
let lastDailyCalendarDate = "";
let lastHourlyMetricsHour = -1;

function utcDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function utcHour(): number {
  return new Date().getUTCHours();
}

// Moscow UTC+3: 03:00 MSK = 00:00 UTC
const CALENDAR_REFILL_UTC_HOUR = 0;
// 11:00 MSK = 08:00 UTC
const REACTIVATION_UTC_HOUR = 8;

export function startScheduler(): void {
  console.log("[scheduler] Started (60s interval)");
  // Run immediately on start, then every minute
  schedulerTick().catch((err) => console.error("[scheduler] Initial tick error:", err));
  setInterval(() => {
    schedulerTick().catch((err) => console.error("[scheduler] Interval tick error:", err));
  }, 60 * 1000);
}
