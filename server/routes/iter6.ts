// Iteration 6 API Routes
// Video analysis, scorecard templates, scorecard responses

import type { Express } from "express";
import { storage } from "../storage.js";
import { enqueueAnalysis } from "../lib/video_pipeline.js";
import { chatCompletion } from "../lib/ai.js";

export function registerIter6Routes(app: Express): void {

  // ══════════════════════════════════════════════════════════════════════════
  // INTERVIEW VIDEOS
  // ══════════════════════════════════════════════════════════════════════════

  /** POST /api/interviews/analyze — create interview video row and enqueue */
  app.post("/api/interviews/analyze", async (req, res) => {
    const { candidateId, sourceUrl, source = "zoom", uploadedBy } = req.body as {
      candidateId?: string;
      sourceUrl?: string;
      source?: string;
      uploadedBy?: string;
    };

    if (!candidateId) return res.status(400).json({ message: "candidateId обязателен" });
    if (!sourceUrl) return res.status(400).json({ message: "sourceUrl обязателен" });

    const candidate = await storage.getCandidate(candidateId);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });

    const video = await storage.createInterviewVideo({
      candidateId,
      source: source ?? "zoom",
      sourceUrl,
      status: "pending",
      uploadedBy: uploadedBy ?? null,
      localPath: null,
      durationSec: null,
      errorMsg: null,
      transcriptPath: null,
      transcriptJson: null,
      rawAnalysisJson: null,
      sentimentTimelineJson: null,
      redFlagsJson: null,
      aiSummary: null,
      keyTimestampsJson: null,
      extractedFactsJson: null,
      completedAt: null,
    });

    enqueueAnalysis(video.id);

    return res.json(video);
  });

  /** GET /api/interviews/:id — get video with results */
  app.get("/api/interviews/:id", async (req, res) => {
    const video = await storage.getInterviewVideo(req.params.id);
    if (!video) return res.status(404).json({ message: "Видео не найдено" });
    return res.json(video);
  });

  /** GET /api/interviews/by-candidate/:candidateId */
  app.get("/api/interviews/by-candidate/:candidateId", async (req, res) => {
    const videos = await storage.getInterviewVideos({ candidateId: req.params.candidateId });
    return res.json(videos);
  });

  /** POST /api/interviews/:id/retry — reset to pending */
  app.post("/api/interviews/:id/retry", async (req, res) => {
    const video = await storage.getInterviewVideo(req.params.id);
    if (!video) return res.status(404).json({ message: "Видео не найдено" });

    const updated = await storage.updateInterviewVideo(req.params.id, {
      status: "pending",
      errorMsg: null,
      completedAt: null,
    });

    if (updated) enqueueAnalysis(updated.id);
    return res.json(updated);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SCORECARD TEMPLATES
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/scorecards/templates?role= */
  app.get("/api/scorecards/templates", async (req, res) => {
    const { role, active } = req.query as { role?: string; active?: string };
    const filters: { role?: string; active?: boolean } = {};
    if (role) filters.role = role;
    if (active !== undefined) filters.active = active !== "0" && active !== "false";

    const templates = await storage.getScorecardTemplates(filters);
    return res.json(templates);
  });

  /** POST /api/scorecards/templates — create template */
  app.post("/api/scorecards/templates", async (req, res) => {
    const { role, name, description, criteriaJson, active } = req.body as {
      role?: string;
      name?: string;
      description?: string;
      criteriaJson?: string;
      active?: number;
    };
    if (!role) return res.status(400).json({ message: "role обязателен" });
    if (!name) return res.status(400).json({ message: "name обязателен" });

    const template = await storage.createScorecardTemplate({
      role,
      name,
      description: description ?? "",
      criteriaJson: criteriaJson ?? "[]",
      active: active ?? 1,
    });
    return res.json(template);
  });

  /** PATCH /api/scorecards/templates/:id — update template */
  app.patch("/api/scorecards/templates/:id", async (req, res) => {
    const existing = await storage.getScorecardTemplate(req.params.id);
    if (!existing) return res.status(404).json({ message: "Шаблон не найден" });

    const { role, name, description, criteriaJson, active } = req.body as {
      role?: string;
      name?: string;
      description?: string;
      criteriaJson?: string;
      active?: number;
    };

    const updated = await storage.updateScorecardTemplate(req.params.id, {
      ...(role !== undefined && { role }),
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(criteriaJson !== undefined && { criteriaJson }),
      ...(active !== undefined && { active }),
    });
    return res.json(updated);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SCORECARD RESPONSES
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/scorecards/responses?candidateId=&stage= */
  app.get("/api/scorecards/responses", async (req, res) => {
    const { candidateId, stage, templateId } = req.query as {
      candidateId?: string;
      stage?: string;
      templateId?: string;
    };
    const responses = await storage.getScorecardResponses({
      ...(candidateId && { candidateId }),
      ...(stage && { stage }),
      ...(templateId && { templateId }),
    });
    return res.json(responses);
  });

  /** POST /api/scorecards/responses — create response (manual or AI draft edit) */
  app.post("/api/scorecards/responses", async (req, res) => {
    const {
      candidateId, templateId, stage, scoresJson, totalScore, maxScore, percentage,
      aiDrafted, aiVerdict, recommendation, interviewerId, sourceVideoId,
    } = req.body as {
      candidateId?: string;
      templateId?: string;
      stage?: string;
      scoresJson?: string;
      totalScore?: number;
      maxScore?: number;
      percentage?: number;
      aiDrafted?: number;
      aiVerdict?: string;
      recommendation?: string;
      interviewerId?: string;
      sourceVideoId?: string;
    };

    if (!candidateId) return res.status(400).json({ message: "candidateId обязателен" });
    if (!templateId) return res.status(400).json({ message: "templateId обязателен" });
    if (!stage) return res.status(400).json({ message: "stage обязателен" });

    const response = await storage.createScorecardResponse({
      candidateId,
      templateId,
      stage,
      scoresJson: scoresJson ?? "[]",
      totalScore: totalScore ?? 0,
      maxScore: maxScore ?? 0,
      percentage: percentage ?? 0,
      aiDrafted: aiDrafted ?? 0,
      aiVerdict: aiVerdict ?? null,
      recommendation: recommendation ?? null,
      interviewerId: interviewerId ?? null,
      sourceVideoId: sourceVideoId ?? null,
    });
    return res.json(response);
  });

  /** PATCH /api/scorecards/responses/:id — update response */
  app.patch("/api/scorecards/responses/:id", async (req, res) => {
    const existing = await storage.getScorecardResponse(req.params.id);
    if (!existing) return res.status(404).json({ message: "Ответ не найден" });

    const {
      scoresJson, totalScore, maxScore, percentage,
      aiVerdict, recommendation, interviewerId,
    } = req.body as {
      scoresJson?: string;
      totalScore?: number;
      maxScore?: number;
      percentage?: number;
      aiVerdict?: string;
      recommendation?: string;
      interviewerId?: string;
    };

    const updated = await storage.updateScorecardResponse(req.params.id, {
      ...(scoresJson !== undefined && { scoresJson }),
      ...(totalScore !== undefined && { totalScore }),
      ...(maxScore !== undefined && { maxScore }),
      ...(percentage !== undefined && { percentage }),
      ...(aiVerdict !== undefined && { aiVerdict }),
      ...(recommendation !== undefined && { recommendation }),
      ...(interviewerId !== undefined && { interviewerId }),
    });
    return res.json(updated);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // COMPARE CANDIDATES
  // ══════════════════════════════════════════════════════════════════════════

  /** POST /api/scorecards/compare — AI comparison of multiple candidates */
  app.post("/api/scorecards/compare", async (req, res) => {
    const { candidateIds } = req.body as { candidateIds?: string[] };
    if (!candidateIds || candidateIds.length < 2) {
      return res.status(400).json({ message: "Нужно минимум 2 кандидата для сравнения" });
    }

    // Gather data for each candidate
    const profiles = await Promise.all(
      candidateIds.map(async (id) => {
        const candidate = await storage.getCandidate(id);
        const responses = await storage.getScorecardResponses({ candidateId: id });
        const videos = await storage.getInterviewVideos({ candidateId: id });
        const latestVideo = videos[0];
        return {
          id,
          name: candidate?.fullName ?? id,
          stage: candidate?.stage,
          predictiveScore: candidate?.predictiveScore,
          scorecardAvg:
            responses.length > 0
              ? responses.reduce((a, r) => a + r.percentage, 0) / responses.length
              : null,
          recommendation: responses[0]?.recommendation ?? null,
          aiSummary: latestVideo?.aiSummary ?? null,
          redFlagsCount: latestVideo?.redFlagsJson
            ? (JSON.parse(latestVideo.redFlagsJson) as unknown[]).length
            : 0,
        };
      })
    );

    const profileText = profiles
      .map(
        (p) =>
          `Кандидат: ${p.name}\n- Этап: ${p.stage}\n- Предиктивный скор: ${p.predictiveScore ?? "N/A"}\n- Средний % скоркарты: ${p.scorecardAvg ? p.scorecardAvg.toFixed(1) + "%" : "N/A"}\n- Рекомендация AI: ${p.recommendation ?? "N/A"}\n- Красных флагов: ${p.redFlagsCount}\n- AI-резюме: ${p.aiSummary?.substring(0, 300) ?? "N/A"}`
      )
      .join("\n\n");

    const comparison = await chatCompletion({
      model: "anthropic/claude-sonnet-4",
      messages: [
        {
          role: "system",
          content:
            "Ты опытный HR-аналитик. Проведи сравнительный анализ кандидатов и дай чёткую рекомендацию. Отвечай на русском.",
        },
        {
          role: "user",
          content: `Сравни следующих кандидатов и реши, кого рекомендовать к следующему этапу:\n\n${profileText}\n\nДай структурированный ответ: сильные стороны каждого, слабые стороны, итоговая рекомендация с обоснованием.`,
        },
      ],
      maxTokens: 1500,
      purpose: "candidate_compare",
    });

    return res.json({ comparison, profiles });
  });
}

export async function getIter6Health(): Promise<{ videos: number; templates: number; responses: number }> {
  const [videos, templates, responses] = await Promise.all([
    storage.getInterviewVideos().then((v) => v.length),
    storage.countScorecardTemplates(),
    storage.getScorecardResponses().then((r) => r.length),
  ]);
  return { videos, templates, responses };
}
