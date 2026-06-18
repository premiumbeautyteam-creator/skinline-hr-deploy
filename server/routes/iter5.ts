// Iteration 5 API Routes
// Probation, Pulse Surveys, Reserve Pool, Referrals, Alerts, UTM

import type { Express } from "express";
import { storage } from "../storage.js";
import { randomBytes } from "node:crypto";
import { chatCompletion } from "../lib/ai.js";
import { getBotUsername } from "../integrations/telegram.js";
import { fetchDreamjobRating } from "../lib/company_rating_fetcher.js";

// ── Helper: generate 8-char referral code ─────────────────────────────────
function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function registerIter5Routes(app: Express): void {

  // ══════════════════════════════════════════════════════════════════════════
  // PROBATION
  // ══════════════════════════════════════════════════════════════════════════

  /** POST /api/probation/start — start probation track for a candidate */
  app.post("/api/probation/start", async (req, res) => {
    const { candidateId, managerId } = req.body as { candidateId?: string; managerId?: string };
    if (!candidateId) return res.status(400).json({ message: "candidateId обязателен" });

    const candidate = await storage.getCandidate(candidateId);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });

    // Idempotent: check if active track already exists
    const existing = await storage.getProbationTrackByCandidate(candidateId);
    if (existing) return res.json(existing);

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + 90);

    const track = await storage.createProbationTrack({
      candidateId,
      startedAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
      status: "active",
      managerId: managerId ?? null,
      finalDecisionAt: null,
      finalDecisionBy: null,
      finalDecisionNotes: null,
      score: null,
    });

    // Create first checkpoint at day 7
    const day7 = new Date(now);
    day7.setDate(day7.getDate() + 7);
    await storage.createCheckpoint({
      trackId: track.id,
      dayNumber: 7,
      dueAt: day7.toISOString(),
      completedAt: null,
      status: "pending",
      checkType: "pulse_survey",
      result: null,
    });

    res.status(201).json(track);
  });

  /** GET /api/probation/active — list active probation tracks */
  app.get("/api/probation/active", async (_req, res) => {
    const tracks = await storage.getProbationTracks({ status: "active" });
    // Enrich with candidate info
    const enriched = await Promise.all(
      tracks.map(async (t) => {
        const candidate = await storage.getCandidate(t.candidateId);
        const checkpoints = await storage.getCheckpoints(t.id);
        const started = new Date(t.startedAt);
        const daysSince = Math.floor(
          (Date.now() - started.getTime()) / (1000 * 60 * 60 * 24)
        );
        const responses = await storage.getPulseResponses(t.candidateId);
        const ratings = responses
          .map((r) => (r.avgRating ? parseFloat(r.avgRating) : null))
          .filter((r): r is number => r !== null);
        const avgRating = ratings.length > 0
          ? ratings.reduce((a, b) => a + b, 0) / ratings.length
          : null;
        return { ...t, candidate, checkpoints, daysSince, avgRating };
      })
    );
    res.json(enriched);
  });

  /** GET /api/probation/:id — get probation track details */
  app.get("/api/probation/:id", async (req, res) => {
    const track = await storage.getProbationTrack(req.params.id);
    if (!track) return res.status(404).json({ message: "Трек не найден" });
    const checkpoints = await storage.getCheckpoints(track.id);
    const candidate = await storage.getCandidate(track.candidateId);
    const responses = await storage.getPulseResponses(track.candidateId);
    res.json({ ...track, checkpoints, candidate, pulseResponses: responses });
  });

  /** POST /api/probation/:id/complete — finalize probation track */
  app.post("/api/probation/:id/complete", async (req, res) => {
    const { decision, notes, score } = req.body as {
      decision: "passed" | "failed" | "terminated_early";
      notes?: string;
      score?: number;
    };
    if (!decision) return res.status(400).json({ message: "decision обязателен" });

    const track = await storage.getProbationTrack(req.params.id);
    if (!track) return res.status(404).json({ message: "Трек не найден" });

    // Optionally generate AI summary
    let aiSummary: string | null = null;
    try {
      const candidate = await storage.getCandidate(track.candidateId);
      const responses = await storage.getPulseResponses(track.candidateId);
      const ratingsSummary = responses
        .map((r) => `День ${r.createdAt.slice(0, 10)}: рейтинг ${r.avgRating ?? "?"}, sentiment: ${r.sentiment ?? "?"}`)
        .join("\n");

      const checkpoints = await storage.getCheckpoints(track.id);
      const cpSummary = checkpoints
        .map((c) => `День ${c.dayNumber}: ${c.status}`)
        .join(", ");

      aiSummary = await chatCompletion({
        model: "anthropic/claude-sonnet-4",
        messages: [
          {
            role: "system",
            content:
              "Ты HR-аналитик Skin Line. Дай краткую сводку испытательного срока и рекомендацию: оставить / продлить / отказаться. Укажи 3 причины.",
          },
          {
            role: "user",
            content: `Сотрудник: ${candidate?.fullName ?? track.candidateId}\nДлительность: ${track.startedAt} → сейчас\nЧекпоинты: ${cpSummary}\nPulse-оценки:\n${ratingsSummary || "нет данных"}\nЗаметки менеджера: ${notes ?? "нет"}`,
          },
        ],
        maxTokens: 500,
        purpose: "probation_summary",
        candidateId: track.candidateId,
      });
    } catch (err) {
      console.error("[probation complete] AI summary error:", err);
    }

    const updated = await storage.updateProbationTrack(track.id, {
      status: decision,
      finalDecisionAt: new Date().toISOString(),
      finalDecisionNotes: `${notes ?? ""}${aiSummary ? `\n\n[AI Summary]\n${aiSummary}` : ""}`,
      score: score ?? null,
    });

    // If passed, update referral status
    if (decision === "passed") {
      const referral = await storage.getReferralByCandidate(track.candidateId);
      if (referral && referral.status === "hired") {
        await storage.updateReferral(referral.id, { status: "passed_probation" });
      }
    }

    res.json({ ...updated, aiSummary });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PULSE SURVEYS
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/pulse/surveys */
  app.get("/api/pulse/surveys", async (_req, res) => {
    res.json(await storage.getPulseSurveys());
  });

  /** GET /api/pulse/responses?candidateId= */
  app.get("/api/pulse/responses", async (req, res) => {
    const { candidateId } = req.query as { candidateId?: string };
    if (!candidateId) return res.status(400).json({ message: "candidateId обязателен" });
    res.json(await storage.getPulseResponses(candidateId));
  });

  /** POST /api/pulse/responses */
  app.post("/api/pulse/responses", async (req, res) => {
    const { candidateId, surveyId, responses } = req.body as {
      candidateId?: string;
      surveyId?: string;
      responses?: unknown[];
    };
    if (!candidateId || !surveyId || !responses) {
      return res.status(400).json({ message: "candidateId, surveyId, responses обязательны" });
    }

    // Calculate avgRating from numeric responses
    const ratings = (responses as Array<{ value?: number }>)
      .map((r) => (typeof r.value === "number" ? r.value : null))
      .filter((v): v is number => v !== null);
    const avgRating = ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
      : null;

    const response = await storage.createPulseResponse({
      candidateId,
      surveyId,
      responses: JSON.stringify(responses),
      avgRating,
      sentiment: null,
    });

    // Async: calculate sentiment via gpt-4o-mini
    setImmediate(async () => {
      try {
        const textResponses = (responses as Array<{ value?: string | number }>)
          .filter((r) => typeof r.value === "string")
          .map((r) => r.value as string)
          .join(". ");

        if (textResponses.length > 5) {
          const sentimentRaw = await chatCompletion({
            model: "openai/gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Оцени эмоциональный тон ответов сотрудника от 1 (очень негативно) до 5 (очень позитивно), верни только число",
              },
              { role: "user", content: textResponses },
            ],
            maxTokens: 10,
            temperature: 0,
            purpose: "pulse_sentiment",
            candidateId,
          });
          const sentimentNum = sentimentRaw ? sentimentRaw.trim() : null;
          await storage.updatePulseResponse(response.id, { sentiment: sentimentNum });
        }
      } catch (err) {
        console.error("[pulse] sentiment error:", err);
      }
    });

    res.status(201).json(response);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RESERVE POOL
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/reserve */
  app.get("/api/reserve", async (req, res) => {
    const { status } = req.query as { status?: string };
    const entries = await storage.getReservePool(status ? { status } : undefined);
    // Enrich with candidate info
    const enriched = await Promise.all(
      entries.map(async (e) => {
        const candidate = await storage.getCandidate(e.candidateId);
        return { ...e, candidate };
      })
    );
    res.json(enriched);
  });

  /** POST /api/reserve/:id/reactivate — manual trigger reactivation */
  app.post("/api/reserve/:id/reactivate", async (req, res) => {
    const entry = await storage.getReservePoolEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: "Запись резерва не найдена" });

    const updated = await storage.updateReservePoolEntry(entry.id, {
      status: "reactivated",
      lastContactedAt: new Date().toISOString(),
    });
    res.json(updated);
  });

  /** POST /api/reserve/:id/opt-out */
  app.post("/api/reserve/:id/opt-out", async (req, res) => {
    const entry = await storage.getReservePoolEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: "Запись резерва не найдена" });

    const updated = await storage.updateReservePoolEntry(entry.id, { status: "opted_out" });
    res.json(updated);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // REFERRALS
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/referrals */
  app.get("/api/referrals", async (req, res) => {
    const { status } = req.query as { status?: string };
    const refs = await storage.getReferrals(status ? { status } : undefined);
    // Enrich
    const enriched = await Promise.all(
      refs.map(async (r) => {
        const code = await storage.getReferralCode(r.codeId);
        const candidate = await storage.getCandidate(r.candidateId);
        return { ...r, code, candidate };
      })
    );
    res.json(enriched);
  });

  /** GET /api/referrals/by-code/:code */
  app.get("/api/referrals/by-code/:code", async (req, res) => {
    const code = await storage.getReferralCodeByCode(req.params.code);
    if (!code) return res.status(404).json({ message: "Код не найден" });
    const refs = await storage.getReferrals({ codeId: code.id });
    res.json({ code, referrals: refs });
  });

  /** POST /api/referrals/code — create referral code for user or candidate */
  app.post("/api/referrals/code", async (req, res) => {
    const { userId, candidateId } = req.body as { userId?: string; candidateId?: string };
    if (!userId && !candidateId) {
      return res.status(400).json({ message: "userId или candidateId обязателен" });
    }

    // Check existing active code
    const existingCodes = await storage.getReferralCodes(
      userId ? { userId } : { candidateId }
    );
    const activeCode = existingCodes.find((c) => c.active === 1);
    if (activeCode) return res.json(activeCode);

    // Generate unique code
    let code = generateCode();
    let attempts = 0;
    while (await storage.getReferralCodeByCode(code)) {
      code = generateCode();
      if (++attempts > 10) break;
    }

    const newCode = await storage.createReferralCode({
      userId: userId ?? null,
      candidateId: candidateId ?? null,
      code,
      active: 1,
      bonusAmount: 5000,
    });

    const botUsername = getBotUsername();
    const link = `https://t.me/${botUsername}?start=ref_${code}`;
    res.status(201).json({ ...newCode, link });
  });

  /** GET /api/referrals/stats — top referrers */
  app.get("/api/referrals/stats", async (_req, res) => {
    const allRefs = await storage.getReferrals();
    const allCodes = await storage.getReferralCodes();

    // Aggregate by codeId
    const statsByCode: Record<string, {
      codeId: string; code: string;
      total: number; hired: number; passed: number;
    }> = {};

    for (const ref of allRefs) {
      if (!statsByCode[ref.codeId]) {
        const code = allCodes.find((c) => c.id === ref.codeId);
        statsByCode[ref.codeId] = {
          codeId: ref.codeId,
          code: code?.code ?? "",
          total: 0, hired: 0, passed: 0,
        };
      }
      statsByCode[ref.codeId].total++;
      if (["hired", "passed_probation", "paid"].includes(ref.status)) {
        statsByCode[ref.codeId].hired++;
      }
      if (["passed_probation", "paid"].includes(ref.status)) {
        statsByCode[ref.codeId].passed++;
      }
    }

    const stats = Object.values(statsByCode).sort((a, b) => b.total - a.total);
    res.json(stats);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ALERTS
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/alerts?severity=&type=&resolved= */
  app.get("/api/alerts", async (req, res) => {
    const { severity, type, resolved } = req.query as Record<string, string>;
    const resolvedBool =
      resolved === "true" ? true : resolved === "false" ? false : undefined;
    const alertsList = await storage.getAlerts({
      ...(severity ? { severity } : {}),
      ...(type ? { type } : {}),
      ...(resolvedBool !== undefined ? { resolved: resolvedBool } : {}),
    });
    res.json(alertsList);
  });

  /** POST /api/alerts/:id/resolve */
  app.post("/api/alerts/:id/resolve", async (req, res) => {
    const { resolvedBy } = req.body as { resolvedBy?: string };
    const updated = await storage.resolveAlert(req.params.id, resolvedBy ?? "user");
    if (!updated) return res.status(404).json({ message: "Алёрт не найден" });
    res.json(updated);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // UTM
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/utm/track?source=&medium=&campaign=&content=&term= */
  app.get("/api/utm/track", async (req, res) => {
    // Just return OK — UTM params are stored on candidate creation via bot/form
    const { source, medium, campaign, content, term } = req.query as Record<string, string>;
    console.log("[utm/track]", { source, medium, campaign, content, term });
    // Return a 1x1 transparent GIF
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.set("Content-Type", "image/gif");
    res.set("Cache-Control", "no-cache, no-store");
    res.send(gif);
  });

  /** GET /api/utm/funnel — aggregate funnel by utmSource */
  app.get("/api/utm/funnel", async (_req, res) => {
    const allCandidates = await storage.getCandidates();

    const funnel: Record<string, {
      source: string; total: number;
      official: number; dismissed: number; probation_passed: number;
    }> = {};

    for (const c of allCandidates) {
      const src = (c as Record<string, unknown>).utmSource as string | null | undefined ?? c.source ?? "direct";
      if (!funnel[src]) {
        funnel[src] = { source: src, total: 0, official: 0, dismissed: 0, probation_passed: 0 };
      }
      funnel[src].total++;
      if (c.stage === "official") funnel[src].official++;
      if (c.stage === "dismissed") funnel[src].dismissed++;
    }

    // Add probation passed count
    const passedTracks = await storage.getProbationTracks({ status: "passed" });
    for (const track of passedTracks) {
      const candidate = await storage.getCandidate(track.candidateId);
      if (!candidate) continue;
      const src = (candidate as Record<string, unknown>).utmSource as string | null | undefined ?? candidate.source ?? "direct";
      if (funnel[src]) funnel[src].probation_passed++;
    }

    res.json(Object.values(funnel));
  });
}

// Export health check data function for use in /api/health
export async function getIter5Health(): Promise<{
  pulseSurveysCount: number;
  activeProbationTracks: number;
  unresolvedAlerts: number;
  activeReservePool: number;
}> {
  const [pulseSurveysCount, probationTracks, unresolvedAlerts, reservePool] = await Promise.all([
    storage.getPulseSurveysCount(),
    storage.getProbationTracks({ status: "active" }),
    storage.countUnresolvedAlerts(),
    storage.getReservePool({ status: "active" }),
  ]);
  return {
    pulseSurveysCount,
    activeProbationTracks: probationTracks.length,
    unresolvedAlerts,
    activeReservePool: reservePool.length,
  };
}

// ============================================================
// Dream Job company rating routes
// ============================================================
export function registerCompanyRatingRoutes(app: Express) {
  // GET /api/company-rating — latest record
  app.get("/api/company-rating", async (_req, res) => {
    try {
      const rating = await storage.getLatestCompanyRating("dreamjob");
      if (!rating) {
        return res.json({
          source: "dreamjob",
          url: "https://dreamjob.ru/employers/307567",
          companyName: "Skin Line",
          overallRating: 4.80,
          totalReviews: 29,
          recommendPercent: 96.6,
          subcategoryRatings: { salary: 4.86, management: 4.86, development: 4.69 },
          fetchedAt: null,
        });
      }
      const sub = JSON.parse(rating.subcategoryRatings ?? "{}");
      res.json({ ...rating, subcategoryRatings: sub });
    } catch (e) {
      console.error("[company-rating] GET error:", e);
      res.status(500).json({ error: "Ошибка загрузки рейтинга" });
    }
  });

  // GET /api/company-rating/history — last 12 records
  app.get("/api/company-rating/history", async (_req, res) => {
    try {
      const history = await storage.getCompanyRatingHistory("dreamjob", 12);
      res.json(history.map((r) => ({ ...r, subcategoryRatings: JSON.parse(r.subcategoryRatings ?? "{}") })));
    } catch (e) {
      console.error("[company-rating] history error:", e);
      res.status(500).json({ error: "Ошибка загрузки истории" });
    }
  });

  // POST /api/company-rating/refresh — manual refresh
  app.post("/api/company-rating/refresh", async (_req, res) => {
    try {
      const data = await fetchDreamjobRating();
      if (!data) return res.status(502).json({ error: "Не удалось получить данные" });
      const latest = await storage.getLatestCompanyRating("dreamjob");
      res.json({ ...latest, subcategoryRatings: data.subcategoryRatings, refreshed: true });
    } catch (e) {
      console.error("[company-rating] refresh error:", e);
      res.status(500).json({ error: "Ошибка обновления рейтинга" });
    }
  });
}
