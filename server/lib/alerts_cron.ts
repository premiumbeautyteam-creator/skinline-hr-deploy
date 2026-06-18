// Alerts cron — runs every hour
// Scans DB and creates alerts for various conditions

import { storage } from "../storage.js";

export async function runAlertsCron(): Promise<void> {
  try {
    const now = new Date();
    const nowIso = now.toISOString();

    // ── 1. Overdue scheduled_actions ──────────────────────────────────────────
    const pendingActions = await storage.getPendingScheduledActions(nowIso);
    for (const action of pendingActions) {
      const existingAlerts = await storage.getAlerts({ type: "overdue_timer" });
      const already = existingAlerts.some(
        (a) =>
          a.relatedEntity &&
          JSON.parse(a.relatedEntity).actionId === action.id &&
          !a.resolvedAt
      );
      if (!already) {
        await storage.createAlert({
          type: "overdue_timer",
          severity: "high",
          title: "Просрочен таймер автодействия",
          description: `Действие ${action.kind} для кандидата просрочено (dueAt: ${action.runAt}).`,
          candidateId: action.candidateId,
          userId: undefined,
          relatedEntity: JSON.stringify({ actionId: action.id, kind: action.kind }),
          resolvedAt: null,
          resolvedBy: null,
        });
      }
    }

    // ── 2. Low sentiment pulse responses (last 24h, avgRating < 3.0) ─────────
    const lowSentimentResponses = await storage.getRecentPulseResponsesWithLowRating(3.0, 24);
    for (const resp of lowSentimentResponses) {
      const existingAlerts = await storage.getAlerts({ type: "low_sentiment" });
      const already = existingAlerts.some(
        (a) =>
          a.relatedEntity &&
          JSON.parse(a.relatedEntity).pulseResponseId === resp.id &&
          !a.resolvedAt
      );
      if (!already) {
        await storage.createAlert({
          type: "low_sentiment",
          severity: "high",
          title: "Низкий sentiment в pulse-опросе",
          description: `Кандидат ответил с низким рейтингом (${resp.avgRating}) на опрос.`,
          candidateId: resp.candidateId,
          userId: undefined,
          relatedEntity: JSON.stringify({ pulseResponseId: resp.id, avgRating: resp.avgRating }),
          resolvedAt: null,
          resolvedBy: null,
        });
      }
    }

    // ── 3. Candidates not responding > 48h in active stage ───────────────────
    const activeCandidates = await storage.getCandidates();
    const terminalStages = new Set(["official", "dismissed", "rejected"]);
    const HOURS_48 = 48 * 60 * 60 * 1000;

    for (const candidate of activeCandidates) {
      if (terminalStages.has(candidate.stage)) continue;

      const messages = await storage.getMessages(candidate.id);
      if (messages.length === 0) continue;

      // Find last inbound message
      const inboundMessages = messages.filter((m) => m.direction === "in");
      const lastOutbound = messages.filter((m) => m.direction === "out").pop();

      if (!lastOutbound || inboundMessages.length === 0) continue;

      const lastInbound = inboundMessages[inboundMessages.length - 1];
      // If last outbound is after last inbound, and it's been > 48h since outbound
      if (
        lastOutbound.sentAt > lastInbound.sentAt &&
        now.getTime() - new Date(lastOutbound.sentAt).getTime() > HOURS_48
      ) {
        const existingAlerts = await storage.getAlerts({ type: "no_response" });
        const already = existingAlerts.some(
          (a) => a.candidateId === candidate.id && !a.resolvedAt
        );
        if (!already) {
          await storage.createAlert({
            type: "no_response",
            severity: "med",
            title: "Кандидат не отвечает > 48ч",
            description: `${candidate.fullName} (этап: ${candidate.stage}) не отвечает более 48 часов.`,
            candidateId: candidate.id,
            userId: undefined,
            relatedEntity: JSON.stringify({ lastOutboundAt: lastOutbound.sentAt }),
            resolvedAt: null,
            resolvedBy: null,
          });
        }
      }
    }

    // ── 4. Probation alert: day >= 60 with avgRating < 3.5 ───────────────────
    const activeTracks = await storage.getProbationTracks({ status: "active" });
    for (const track of activeTracks) {
      const started = new Date(track.startedAt);
      const daysSince = Math.floor(
        (now.getTime() - started.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSince < 60) continue;

      const responses = await storage.getPulseResponses(track.candidateId);
      if (responses.length === 0) continue;

      const ratings = responses
        .map((r) => (r.avgRating ? parseFloat(r.avgRating) : null))
        .filter((r): r is number => r !== null);
      if (ratings.length === 0) continue;

      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      if (avg < 3.5) {
        const existingAlerts = await storage.getAlerts({ type: "probation_alert" });
        const already = existingAlerts.some(
          (a) =>
            a.relatedEntity &&
            JSON.parse(a.relatedEntity).trackId === track.id &&
            !a.resolvedAt
        );
        if (!already) {
          const candidate = await storage.getCandidate(track.candidateId);
          await storage.createAlert({
            type: "probation_alert",
            severity: "high",
            title: "Низкие оценки на испытательном сроке",
            description: `${candidate?.fullName ?? track.candidateId}: день ${daysSince}, средний рейтинг ${avg.toFixed(1)} < 3.5.`,
            candidateId: track.candidateId,
            userId: track.managerId ?? undefined,
            relatedEntity: JSON.stringify({ trackId: track.id, avgRating: avg, day: daysSince }),
            resolvedAt: null,
            resolvedBy: null,
          });
        }
      }
    }

    // ── 5. Channel not posting > 3 days ──────────────────────────────────────
    const recentPosts = await storage.getChannelPosts({ status: "published" });
    if (recentPosts.length > 0) {
      const lastPost = recentPosts.sort((a, b) =>
        (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt)
      )[0];
      const lastPostAt = new Date(lastPost.publishedAt ?? lastPost.createdAt);
      const daysSincePost =
        (now.getTime() - lastPostAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSincePost > 3) {
        const existingAlerts = await storage.getAlerts({ type: "channel_silent" });
        const already = existingAlerts.some((a) => !a.resolvedAt);
        if (!already) {
          await storage.createAlert({
            type: "channel_silent",
            severity: "med",
            title: "Канал @SkinLineHR не публиковал > 3 дней",
            description: `Последняя публикация была ${Math.floor(daysSincePost)} дней назад.`,
            candidateId: undefined,
            userId: undefined,
            relatedEntity: JSON.stringify({ lastPostAt: lastPost.publishedAt ?? lastPost.createdAt }),
            resolvedAt: null,
            resolvedBy: null,
          });
        }
      }
    }

    // ── 6. Referrals ready for payout ────────────────────────────────────────
    const passedReferrals = await storage.getReferrals({ status: "passed_probation" });
    for (const ref of passedReferrals) {
      const existingAlerts = await storage.getAlerts({ type: "referral_payout" });
      const already = existingAlerts.some(
        (a) =>
          a.relatedEntity &&
          JSON.parse(a.relatedEntity).referralId === ref.id &&
          !a.resolvedAt
      );
      if (!already) {
        const code = await storage.getReferralCode(ref.codeId);
        await storage.createAlert({
          type: "referral_payout",
          severity: "low",
          title: "Реферральный бонус готов к выплате",
          description: `Реферрал прошёл испытательный срок. Бонус: ${ref.bonusAmount ?? (code?.bonusAmount ?? 5000)} ₽.`,
          candidateId: ref.candidateId,
          userId: code?.userId ?? undefined,
          relatedEntity: JSON.stringify({ referralId: ref.id, codeId: ref.codeId }),
          resolvedAt: null,
          resolvedBy: null,
        });
      }
    }

    console.log(
      `[alerts_cron] Scan complete. Processed ${pendingActions.length} overdue actions, ` +
        `${lowSentimentResponses.length} low sentiment responses.`
    );
  } catch (err) {
    console.error("[alerts_cron] Error:", err);
  }
}

export function startAlertsCron(): NodeJS.Timeout {
  const MS_PER_HOUR = 60 * 60 * 1000;

  // Run immediately
  runAlertsCron().catch((e) => console.error("[alerts_cron] Initial run error:", e));

  return setInterval(() => {
    runAlertsCron().catch((e) => console.error("[alerts_cron] Error:", e));
  }, MS_PER_HOUR);
}
