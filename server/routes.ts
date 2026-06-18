import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from 'node:http';
import fs from "node:fs";
import path from "node:path";
import { storage, seedDatabase, seedIter6Templates } from "./storage.js";
import { registerChannelRoutes } from "./routes/channel.js";
import { registerQuizRoutes, sendQuizQuestionViaTelegram } from "./routes/quizzes.js";
import { registerDocumentRoutes, processTelegramDocument } from "./routes/documents.js";
import { registerIter5Routes, getIter5Health, registerCompanyRatingRoutes } from "./routes/iter5.js";
import { registerIter6Routes, getIter6Health } from "./routes/iter6.js";
import {
  insertVacancySchema, insertCandidateSchema, insertDocumentSchema, insertMessageSchema,
} from "@shared/schema";
import type { Integration, IntegrationPublic } from "@shared/schema";
import { randomUUID, randomBytes } from "node:crypto";
import { HhClient, hhEnvConfigured, integrationHasTokens } from "./integrations/hh.js";
import { pollAll, ingestNegotiation, processWebhookEvent } from "./integrations/hh-ingest.js";
import { importHhVacancies, publishVacancyToHh } from "./integrations/hh-vacancies.js";
import { AvitoClient, avitoEnvConfigured } from "./integrations/avito.js";
import {
  processAvitoWebhook,
  sendAvitoReply,
  pollAvitoUnread,
  type AvitoWebhookEvent,
} from "./integrations/avito-ingest.js";
import { importAvitoVacancies } from "./integrations/avito-vacancies.js";
import { encrypt } from "./lib/crypto.js";
import { onStageChange, computeFakeScore, runAiScreening, runPredictiveScore } from "./automations/engine.js";
import { getTelegram, getBotUsername } from "./integrations/telegram.js";
import { startScheduler } from "./jobs/scheduler.js";
import { aiReply, detectSentimentAndIntent, testOpenRouter, transcribeVoice } from "./lib/ai.js";
import { generateRejectionMessage } from "./lib/rejection.js";

// Strip tokens from an integration record before returning it over the API.
function maskIntegration(i: Integration): IntegrationPublic {
  const { accessToken, refreshToken, ...rest } = i;
  return { ...rest, hasTokens: Boolean(accessToken && refreshToken) };
}

// Placeholder/default integration shape for sources that have no row yet.
function placeholderIntegration(source: string): IntegrationPublic {
  const now = new Date().toISOString();
  return {
    id: "", source, status: "disconnected",
    accountId: null, accountName: null, tokenExpiresAt: null,
    lastSyncAt: null, lastError: null, meta: null,
    createdAt: now, updatedAt: now, hasTokens: false,
  };
}

const FRONTEND_SETTINGS_URL = "/#/settings";

// All 15 valid stage keys
const VALID_STAGES = new Set([
  "response", "form_filled", "in_work", "video_interview", "studio_demo", "theory",
  "exam_scheduled", "reexam", "trainer_onboarding", "studio_practice",
  "scheduled", "reserve", "rejected", "official", "dismissed",
]);

const STAGE_LABELS: Record<string, string> = {
  response: "Отклик",
  form_filled: "Анкета заполнена",
  in_work: "Взяли в работу",
  video_interview: "Видеоинтервью",
  studio_demo: "Демо-погружение в студии",
  theory: "Выдаём теорию",
  exam_scheduled: "Назначен экзамен",
  reexam: "Переэкзаменовка",
  trainer_onboarding: "Обучение тренером",
  studio_practice: "Практика в студии",
  scheduled: "Выход в график",
  reserve: "Резерв",
  rejected: "Отказ",
  official: "Офиц-ое трудоустройство",
  dismissed: "Увольнение",
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Seeding must never crash startup: an idempotent re-seed on an existing DB
  // could otherwise throw (e.g. a duplicate primary key) and take the whole
  // process down before the HTTP server starts listening.
  try {
    seedDatabase();
  } catch (err) {
    console.error("[seed] seedDatabase failed (continuing):", err);
  }
  try {
    seedIter6Templates();
  } catch (err) {
    console.error("[seed] seedIter6Templates failed (continuing):", err);
  }
  startScheduler();
  registerChannelRoutes(app);
  registerQuizRoutes(app);
  registerDocumentRoutes(app);
  registerIter5Routes(app);
  registerCompanyRatingRoutes(app);
  registerIter6Routes(app);

  // ---------- Vacancies ----------
  app.get("/api/vacancies", async (_req, res) => {
    res.json(await storage.getVacancies());
  });
  app.get("/api/vacancies/:id", async (req, res) => {
    const v = await storage.getVacancy(req.params.id);
    if (!v) return res.status(404).json({ message: "Вакансия не найдена" });
    res.json(v);
  });
  app.post("/api/vacancies", async (req, res) => {
    const parsed = insertVacancySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные данные", errors: parsed.error.errors });
    res.status(201).json(await storage.createVacancy(parsed.data));
  });
  app.patch("/api/vacancies/:id", async (req, res) => {
    const parsed = insertVacancySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные данные" });
    const v = await storage.updateVacancy(req.params.id, parsed.data);
    if (!v) return res.status(404).json({ message: "Вакансия не найдена" });
    res.json(v);
  });
  app.delete("/api/vacancies/:id", async (req, res) => {
    await storage.deleteVacancy(req.params.id);
    res.status(204).end();
  });

  // ---------- Candidates ----------
  app.get("/api/candidates", async (req, res) => {
    const { stage, vacancyId, source } = req.query as Record<string, string>;
    res.json(await storage.getCandidates({ stage, vacancyId, source }));
  });
  app.get("/api/candidates/:id", async (req, res) => {
    const c = await storage.getCandidate(req.params.id);
    if (!c) return res.status(404).json({ message: "Кандидат не найден" });
    res.json(c);
  });
  app.post("/api/candidates", async (req, res) => {
    const parsed = insertCandidateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные данные", errors: parsed.error.errors });

    // ── Duplicate check ──
    const existingByPhone = await storage.getCandidatesByPhone(parsed.data.phone);
    if (existingByPhone.length > 0) {
      return res.status(409).json({
        message: "Кандидат с таким телефоном уже существует",
        existingId: existingByPhone[0].id,
        existing: existingByPhone[0],
      });
    }
    // Name+city duplicate: warn but allow
    const existingByName = await storage.getCandidatesByFullName(parsed.data.fullName, parsed.data.city);
    let tags = parsed.data.tags ?? "[]";
    if (existingByName.length > 0) {
      try {
        const arr: string[] = JSON.parse(tags);
        if (!arr.includes("возможный дубль")) arr.push("возможный дубль");
        tags = JSON.stringify(arr);
      } catch { /* ignore */ }
    }

    // ── Fake score ──
    const formFilledInSeconds = typeof req.body.formFilledInSeconds === "number"
      ? req.body.formFilledInSeconds
      : null;
    const fakeScore = computeFakeScore(
      { fullName: parsed.data.fullName, phone: parsed.data.phone, formFilledInSeconds },
      existingByPhone,
    );

    let stage = parsed.data.stage;
    let rejectReason: string | null | undefined = undefined;
    const fakeTags: string[] = [];
    if (fakeScore >= 70) {
      stage = "rejected";
      rejectReason = "Автоотказ: высокая вероятность фейка";
      fakeTags.push("возможный_фейк");
    }
    if (fakeTags.length > 0) {
      try {
        const arr: string[] = JSON.parse(tags);
        for (const t of fakeTags) if (!arr.includes(t)) arr.push(t);
        tags = JSON.stringify(arr);
      } catch { /* ignore */ }
    }

    const c = await storage.createCandidate({
      ...parsed.data,
      stage,
      tags,
      ...(rejectReason !== undefined ? { rejectReason } : {}),
    });
    // Store fake score and formFilledInSeconds
    await storage.updateCandidate(c.id, { fakeScore, formFilledInSeconds });

    await storage.createActivity({
      candidateId: c.id, type: "stage_change",
      description: "Кандидат добавлен вручную", meta: null,
    });
    // Trigger automation for initial stage
    await onStageChange(c, null, c.stage, "system");
    res.status(201).json(c);
  });

  // ---------- Public landing intake (no auth) ----------
  // External candidate landing page (https://team.skinline-hr.ru) posts an
  // application here. Creates a candidate at stage form_filled identically to
  // the manual /api/candidates path so it appears in the funnel and fires the
  // form_filled automation. CORS is scoped to THIS endpoint only.
  const LANDING_URL = process.env.LANDING_URL ?? "https://team.skinline-hr.ru/";
  const LANDING_VACANCY_ID = "landing-generic";

  // Resolve a vacancy id for a landing application. Prefer the explicitly
  // submitted vacancy, then any active vacancy, otherwise ensure a single
  // generic fallback vacancy row exists and reuse it. Keeps candidates.vacancyId
  // (NOT NULL) pointing at a real row so UI joins/filters never break.
  async function resolveLandingVacancyId(submittedId: unknown, city: string): Promise<string> {
    if (typeof submittedId === "string" && submittedId.trim()) {
      const found = await storage.getVacancy(submittedId.trim());
      if (found) return found.id;
    }
    const all = await storage.getVacancies();
    const active = all.find((v) => v.status === "active");
    if (active) return active.id;
    const existingFallback = all.find((v) => v.id === LANDING_VACANCY_ID);
    if (existingFallback) return existingFallback.id;
    // createVacancy generates its own id, so insert the fallback row directly to
    // pin a stable, well-known id.
    const created = await storage.createVacancy({
      title: "Анкета с лендинга",
      city: city || "—",
      salary: "—",
      status: "active",
      description: "Заявки с публичного лендинга (team.skinline-hr.ru).",
      externalUrl: LANDING_URL,
      source: "manual",
    });
    return created.id;
  }

  // CORS for the public endpoint only — allow the landing origin + preflight.
  function applyCors(req: Request, res: Response) {
    const origin = req.headers.origin;
    // Reflect the team subdomain; fall back to * for other landing hosts.
    if (origin && /\.skinline-hr\.ru$/i.test(new URL(origin).hostname)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  app.options("/api/public/apply", (req, res) => {
    applyCors(req, res);
    res.status(204).end();
  });

  app.post("/api/public/apply", async (req, res) => {
    applyCors(req, res);
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

      const fullName = str(body.fullName);
      const phone = str(body.phone);
      const city = str(body.city);
      if (!fullName || !phone || !city) {
        return res.status(400).json({
          ok: false,
          error: "fullName, phone и city обязательны",
        });
      }

      const email = str(body.email) || null;
      const experience = str(body.experience); // NOT NULL column — "" is fine
      const expectedSalary = str(body.expectedSalary) || null;
      const dateOfBirth = str(body.dateOfBirth) || null;
      const formFilledInSeconds =
        typeof body.formFilledInSeconds === "number" ? body.formFilledInSeconds : null;
      const comment = str(body.comment) || str(body.about);
      const consent = body.consent === true || body.consent === "true";

      // UTM columns exist via ensureColumn — pass them through.
      const utmSource = str(body.utmSource) || null;
      const utmMedium = str(body.utmMedium) || null;
      const utmCampaign = str(body.utmCampaign) || null;

      const notesParts: string[] = [];
      if (comment) notesParts.push(comment);
      if (consent) notesParts.push("Согласие на обработку ПД: да");
      const notes = notesParts.length ? notesParts.join("\n") : null;

      const vacancyId = await resolveLandingVacancyId(body.vacancyId, city);

      // Source decision: the client source badge map and the source filter only
      // know avito|hh|manual|telegram, so an unknown value like "site" would be
      // invisible in the filter. Use source="manual" (renders + filters cleanly)
      // and distinguish landing applications with a "лендинг" tag + sourceUrl.
      const tags = JSON.stringify(["лендинг"]);

      const c = await storage.createCandidate({
        fullName,
        phone,
        email,
        city,
        vacancyId,
        source: "manual",
        sourceUrl: LANDING_URL,
        stage: "form_filled",
        experience,
        expectedSalary,
        rating: null,
        notes,
        tags,
        rejectReason: null,
        avatarUrl: null,
        resumeUrl: null,
        externalAvatarUrl: null,
        telegramChatId: null,
        linkToken: null,
        lastStageAt: new Date().toISOString(),
        aiVerdict: null,
        aiReasoning: null,
        aiScore: null,
        predictiveScore: null,
        predictiveFactors: null,
        dateOfBirth,
        formFilledInSeconds,
        fakeScore: null,
      });

      // UTM columns are added via ensureColumn (not in the Drizzle table object),
      // so they must be written with raw SQL via setCandidateUtm.
      if (utmSource || utmMedium || utmCampaign) {
        await storage.setCandidateUtm(c.id, { utmSource, utmMedium, utmCampaign });
      }

      await storage.createActivity({
        candidateId: c.id,
        type: "stage_change",
        description: "Заявка с лендинга",
        meta: JSON.stringify({ source: "landing", url: LANDING_URL }),
      });

      // Fire the form_filled automation the same way every other entry point
      // does. onStageChange records the stage_event and schedules the
      // form_filled messaging + AI screening. Run async so the response is fast.
      setImmediate(() => {
        onStageChange(c, null, "form_filled", "system").catch((err) =>
          console.error("[public/apply] onStageChange error:", err)
        );
      });

      return res.status(200).json({ ok: true, candidateId: c.id });
    } catch (err) {
      console.error("[public/apply] failed:", err);
      return res.status(500).json({ ok: false, error: "Внутренняя ошибка" });
    }
  });

  app.patch("/api/candidates/:id", async (req, res) => {
    const parsed = insertCandidateSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные данные" });
    const existing = await storage.getCandidate(req.params.id);
    if (!existing) return res.status(404).json({ message: "Кандидат не найден" });

    const c = await storage.updateCandidate(req.params.id, parsed.data);
    if (!c) return res.status(404).json({ message: "Кандидат не найден" });

    // If stage changed — trigger onStageChange
    if (parsed.data.stage && parsed.data.stage !== existing.stage) {
      setImmediate(() => {
        onStageChange(c, existing.stage, c.stage, "user").catch((err) =>
          console.error("[routes] onStageChange error:", err)
        );
      });
    }
    res.json(c);
  });
  app.delete("/api/candidates/:id", async (req, res) => {
    await storage.deleteCandidate(req.params.id);
    res.status(204).end();
  });

  // stage change (dedicated endpoint)
  app.patch("/api/candidates/:id/stage", async (req, res) => {
    const { stage, rejectReason } = req.body as { stage: string; rejectReason?: string };
    if (!stage || !VALID_STAGES.has(stage)) return res.status(400).json({ message: "Неверный этап" });
    const existing = await storage.getCandidate(req.params.id);
    if (!existing) return res.status(404).json({ message: "Кандидат не найден" });
    const c = await storage.updateCandidate(req.params.id, {
      stage, ...(rejectReason !== undefined ? { rejectReason } : {}),
    });
    if (!c) return res.status(404).json({ message: "Кандидат не найден" });
    // Run stage change automation async so response is not blocked
    setImmediate(() => {
      onStageChange(c, existing.stage, stage, "user").catch((err) =>
        console.error("[routes] onStageChange error:", err)
      );
    });
    res.json(c);
  });

  // ---------- Candidate Tasks ----------
  app.get("/api/candidates/:id/tasks", async (req, res) => {
    res.json(await storage.getTasks(req.params.id));
  });
  app.post("/api/candidates/:id/tasks", async (req, res) => {
    try {
      const candidateId = req.params.id;
      const { assigneeId, title, description, dueAt } = req.body as {
        assigneeId: string; title: string; description?: string; dueAt: string;
      };
      if (!assigneeId || !title || !dueAt) {
        return res.status(400).json({ message: "assigneeId, title, dueAt обязательны" });
      }
      const task = await storage.createTask({
        candidateId,
        assigneeId,
        title,
        description: description ?? "",
        dueAt,
        status: "open",
        source: "manual",
        triggerStage: null,
      });
      res.status(201).json(task);
    } catch (err) {
      res.status(500).json({ message: "Ошибка создания задачи" });
    }
  });

  // ---------- Tasks (by id) ----------
  app.patch("/api/tasks/:id", async (req, res) => {
    const task = await storage.getTask(req.params.id);
    if (!task) return res.status(404).json({ message: "Задача не найдена" });
    const update: Partial<typeof task> = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.title) update.title = req.body.title;
    if (req.body.description !== undefined) update.description = req.body.description;
    if (req.body.dueAt) update.dueAt = req.body.dueAt;
    if (req.body.status === "done") update.completedAt = new Date().toISOString();
    const updated = await storage.updateTask(req.params.id, update);
    res.json(updated);
  });

  // ---------- Stage Events ----------
  app.get("/api/candidates/:id/stage-events", async (req, res) => {
    res.json(await storage.getStageEvents(req.params.id));
  });

  // ---------- Automations (scheduled_actions) ----------
  app.get("/api/candidates/:id/automations", async (req, res) => {
    res.json(await storage.getScheduledActions(req.params.id));
  });

  // ---------- Telegram link-token ----------
  app.post("/api/candidates/:id/link-token", async (req, res) => {
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    const token = randomBytes(16).toString("hex");
    await storage.updateCandidate(req.params.id, { linkToken: token });
    const botUsername = getBotUsername();
    res.json({
      token,
      deepLink: `https://t.me/${botUsername}?start=${token}`,
      botUsername,
    });
  });

  // ---------- CRM Users ----------
  app.get("/api/users", async (_req, res) => {
    res.json(await storage.getCrmUsers());
  });
  app.patch("/api/users/:id", async (req, res) => {
    const user = await storage.getCrmUser(req.params.id);
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    const updated = await storage.updateCrmUser(req.params.id, req.body);
    res.json(updated);
  });

  // ---------- Stages ----------
  app.get("/api/stages", async (_req, res) => {
    res.json([
      { key: "response", label: "Отклик", color: "sky", roleOwner: "hr_manager" },
      { key: "form_filled", label: "Анкета заполнена", color: "blue", roleOwner: "hr_manager" },
      { key: "in_work", label: "Взяли в работу", color: "cyan", roleOwner: "hr_manager" },
      { key: "video_interview", label: "Видеоинтервью", color: "indigo", roleOwner: "hr_manager" },
      { key: "studio_demo", label: "Демо-погружение в студии", color: "violet", roleOwner: "uk" },
      { key: "theory", label: "Выдаём теорию", color: "purple", roleOwner: "uk" },
      { key: "exam_scheduled", label: "Назначен экзамен", color: "pink", roleOwner: "uk" },
      { key: "reexam", label: "Переэкзаменовка", color: "amber", roleOwner: "trainer_1" },
      { key: "trainer_onboarding", label: "Обучение тренером", color: "orange", roleOwner: "trainer_2" },
      { key: "studio_practice", label: "Практика в студии", color: "teal", roleOwner: "uk" },
      { key: "scheduled", label: "Выход в график", color: "emerald", roleOwner: "manager" },
      { key: "reserve", label: "Резерв", color: "gray", roleOwner: "uk" },
      { key: "rejected", label: "Отказ", color: "red", roleOwner: "uk" },
      { key: "official", label: "Офиц-ое трудоустройство", color: "green", roleOwner: "manager" },
      { key: "dismissed", label: "Увольнение", color: "slate", roleOwner: "manager" },
    ]);
  });

  // ---------- Documents ----------
  app.get("/api/candidates/:id/documents", async (req, res) => {
    res.json(await storage.getDocuments(req.params.id));
  });
  app.post("/api/candidates/:id/documents", async (req, res) => {
    const body = { ...req.body, candidateId: req.params.id };
    const parsed = insertDocumentSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные данные", errors: parsed.error.errors });
    const doc = await storage.createDocument(parsed.data);
    await storage.createActivity({
      candidateId: req.params.id, type: "document_uploaded",
      description: `Загружен документ: ${doc.fileName}`, meta: null,
    });
    res.status(201).json(doc);
  });
  app.patch("/api/documents/:id", async (req, res) => {
    const doc = await storage.updateDocument(req.params.id, req.body);
    if (!doc) return res.status(404).json({ message: "Документ не найден" });
    res.json(doc);
  });
  app.delete("/api/documents/:id", async (req, res) => {
    await storage.deleteDocument(req.params.id);
    res.status(204).end();
  });

  // ---------- Messages ----------
  app.get("/api/candidates/:id/messages", async (req, res) => {
    res.json(await storage.getMessages(req.params.id));
  });
  app.post("/api/candidates/:id/messages", async (req, res) => {
    const candidateId = req.params.id;
    const isHh = req.body?.channel === "hh";
    const body = {
      ...req.body,
      candidateId,
      direction: "out",
      source: isHh ? "hh" : (req.body?.source ?? null),
      deliveryStatus: isHh ? "pending" : (req.body?.deliveryStatus ?? "local"),
    };
    const parsed = insertMessageSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Неверные данные", errors: parsed.error.errors });
    let msg = await storage.createMessage(parsed.data);

    if (isHh) {
      try {
        const ref = await storage.getExternalRefByEntity("candidate", candidateId, "hh", "negotiation");
        const integration = await storage.getIntegration("hh");
        if (!ref) {
          msg = (await storage.updateMessage(msg.id, { deliveryStatus: "failed" })) ?? msg;
          console.warn(`[hh] no negotiation ref for candidate ${candidateId}`);
        } else if (!integration || integration.status !== "connected") {
          msg = (await storage.updateMessage(msg.id, { deliveryStatus: "failed" })) ?? msg;
          console.warn("[hh] integration not connected");
        } else {
          const client = new HhClient(integration);
          await client.sendMessage(ref.externalId, msg.text);
          msg = (await storage.updateMessage(msg.id, { deliveryStatus: "delivered" })) ?? msg;
        }
      } catch (err) {
        console.error(`[hh] failed to deliver message for candidate ${candidateId}:`, err);
        msg = (await storage.updateMessage(msg.id, { deliveryStatus: "failed" })) ?? msg;
      }
    }

    const channelLabel = msg.channel === "telegram" ? "Telegram"
      : msg.channel === "telegram_bot" ? "Telegram Bot"
      : msg.channel === "avito" ? "Avito"
      : msg.channel === "hh" ? "hh.ru" : msg.channel;
    await storage.createActivity({
      candidateId, type: "message",
      description: `Отправлено сообщение (${channelLabel})`,
      meta: null,
    });
    res.status(201).json(msg);
  });

  // ---------- Activities ----------
  app.get("/api/candidates/:id/activities", async (req, res) => {
    res.json(await storage.getActivities(req.params.id));
  });

  // ---------- Dashboard ----------
  app.get("/api/dashboard/stats", async (_req, res) => {
    const all = await storage.getCandidates();
    const vacs = await storage.getVacancies();
    const byStage: Record<string, number> = {};
    for (const key of Array.from(VALID_STAGES)) byStage[key] = 0;
    const bySource: Record<string, number> = { avito: 0, hh: 0, telegram: 0, manual: 0 };
    let officialThisMonth = 0;
    let newThisWeek = 0;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    for (const c of all) {
      byStage[c.stage] = (byStage[c.stage] || 0) + 1;
      bySource[c.source] = (bySource[c.source] || 0) + 1;
      const created = new Date(c.createdAt);
      if (c.stage === "official" && created >= monthAgo) officialThisMonth++;
      if (c.stage === "form_filled" && created >= weekAgo) newThisWeek++;
    }
    // fallback so dashboard is never empty for seeded data
    if (officialThisMonth === 0) officialThisMonth = byStage.official ?? 0;
    if (newThisWeek === 0) newThisWeek = byStage.form_filled ?? 0;

    const inWork = all.filter((c) => !["reserve", "rejected", "official", "dismissed"].includes(c.stage)).length;

    res.json({
      totalCandidates: all.length,
      byStage,
      bySource,
      hiredThisMonth: officialThisMonth,
      officialThisMonth,
      newThisWeek,
      inWork,
      activeVacancies: vacs.filter((v) => v.status === "active").length,
    });
  });

  app.get("/api/dashboard/recent", async (_req, res) => {
    res.json(await storage.getRecentActivities(10));
  });

  // ---------- Integration stubs ----------
  app.post("/api/integrations/telegram/send", async (req, res) => {
    const { chatId, text } = req.body as { chatId?: string; text?: string };
    const tg = getTelegram();
    if (tg && chatId && text) {
      try {
        const result = await tg.sendMessage(chatId, text);
        return res.json({ ok: result.ok, messageId: result.message_id });
      } catch (err) {
        return res.status(500).json({ ok: false, error: String(err) });
      }
    }
    res.json({ ok: true, messageId: randomUUID(), status: "queued (dry-run)" });
  });

  // Telegram webhook (inbound updates from Telegram)
  app.post("/api/webhooks/telegram", async (req, res) => {
    // Respond 200 immediately so Telegram doesn't retry
    res.status(200).json({ ok: true });
    setImmediate(async () => {
      try {
        const update = req.body as {
          message?: {
            chat?: { id?: number; username?: string };
            text?: string;
            from?: { id?: number; username?: string; first_name?: string };
            voice?: { file_id?: string; duration?: number };
            photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
            document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
          };
          // Iter4: inline keyboard callback
          callback_query?: {
            id: string;
            from?: { id?: number; username?: string; first_name?: string };
            message?: { chat?: { id?: number }; message_id?: number };
            data?: string;
          };
          // Iter3: channel member events
          chat_member?: {
            chat?: { id?: number; username?: string; type?: string };
            new_chat_member?: {
              user?: { id?: number; username?: string; first_name?: string; last_name?: string };
              status?: string;
            };
            old_chat_member?: { status?: string };
          };
          my_chat_member?: {
            chat?: { id?: number; username?: string; type?: string };
            new_chat_member?: {
              user?: { id?: number; username?: string; first_name?: string; last_name?: string };
              status?: string;
            };
          };
        };

        // Iter3: Handle new channel subscribers
        const memberEvent = update.chat_member ?? update.my_chat_member;
        if (memberEvent?.chat && (memberEvent.chat.type === "channel" || memberEvent.chat.type === "supergroup")) {
          const newMember = memberEvent.new_chat_member;
          const oldStatus = update.chat_member?.old_chat_member?.status ?? "";
          // joined = member/administrator, left = left/kicked
          if (newMember?.status === "member" && oldStatus !== "member") {
            const user = newMember.user;
            if (user?.id) {
              const chatId = String(user.id);
              await storage.upsertChannelSubscriber({
                chatId,
                username: user.username ?? null,
                firstName: user.first_name ?? null,
                lastName: user.last_name ?? null,
                joinedAt: new Date().toISOString(),
                welcomeSentAt: null,
                candidateId: null,
                source: "channel_join",
                meta: JSON.stringify({ chatType: memberEvent.chat.type }),
              });
              console.log(`[channel] New subscriber: ${chatId} (@${user.username ?? "unknown"})`);
            }
          }
          return;
        }

        // ── Iter4: callback_query handler ───────────────────────────────────────
        if (update.callback_query) {
          const cq = update.callback_query;
          const cqChatId = String(cq.message?.chat?.id ?? "");
          const cqData = cq.data ?? "";
          const tgCq = getTelegram();

          // Always answer callback query to clear loading state
          const answerAndDone = async (text?: string) => {
            if (tgCq) await tgCq.answerCallbackQuery(cq.id, text ? { text } : undefined);
          };

          const candidateCq = cqChatId ? await storage.getCandidateByTelegramChatId(cqChatId) : null;

          if (cqData.startsWith("quiz_start:")) {
            const quizId = cqData.slice("quiz_start:".length);
            if (!candidateCq) { await answerAndDone("Ошибка: кандидат не найден"); return; }

            try {
              const existing = await storage.getActiveQuizAttempt(candidateCq.id, quizId);
              if (existing) {
                await storage.updateQuizAttempt(existing.id, { status: "failed", finishedAt: new Date().toISOString() });
              }
              const attempt = await storage.createQuizAttempt({
                candidateId: candidateCq.id,
                quizId,
                status: "in_progress",
                startedAt: new Date().toISOString(),
                finishedAt: null,
                scorePercent: null,
                currentQuestionIdx: 0,
                answers: "[]",
              });
              await answerAndDone("Тест начат!");
              await sendQuizQuestionViaTelegram(cqChatId, attempt.id, quizId, 0);
            } catch (err) {
              console.error("[webhook] quiz_start error:", err);
              await answerAndDone("Ошибка начала теста");
            }
            return;
          }

          if (cqData.startsWith("quiz_answer:")) {
            const parts = cqData.split(":");
            const attemptId = parts[1] ?? "";
            const questionId = parts[2] ?? "";
            const selectedIdx = parseInt(parts[3] ?? "0", 10);

            if (!attemptId || !questionId) { await answerAndDone("Ошибка данных"); return; }
            if (!candidateCq) { await answerAndDone("Кандидат не найден"); return; }

            try {
              const attempt = await storage.getQuizAttempt(attemptId);
              if (!attempt || attempt.status !== "in_progress") {
                await answerAndDone("Тест уже завершён");
                return;
              }

              const question = await storage.getQuizQuestion(questionId);
              if (!question) { await answerAndDone("Вопрос не найден"); return; }

              const isCorrect = question.correctIndex === selectedIdx;

              let answers: Array<{ questionId: string; selectedIdx: number; isCorrect: boolean }> = [];
              try { answers = JSON.parse(attempt.answers); } catch { answers = []; }
              answers.push({ questionId, selectedIdx, isCorrect });

              const questions = await storage.getQuizQuestions(attempt.quizId);
              const nextIdx = attempt.currentQuestionIdx + 1;
              const isLast = nextIdx >= questions.length;

              if (isLast) {
                const correct = answers.filter((a) => a.isCorrect).length;
                const scorePercent = Math.round((correct / questions.length) * 100);
                const quiz = await storage.getQuiz(attempt.quizId);
                const passed = scorePercent >= (quiz?.passingScore ?? 70);

                await storage.updateQuizAttempt(attemptId, {
                  answers: JSON.stringify(answers),
                  currentQuestionIdx: nextIdx,
                  status: passed ? "passed" : "failed",
                  finishedAt: new Date().toISOString(),
                  scorePercent,
                });

                const resultText = passed
                  ? `Тест завершён! Результат: ${scorePercent}% (${correct}/${questions.length}). Вы прошли тест успешно!`
                  : `Тест завершён. Результат: ${scorePercent}% (${correct}/${questions.length}). Для прохождения нужно ${quiz?.passingScore ?? 70}%. Можно попробовать снова.`;

                await answerAndDone(passed ? "Тест пройден!" : "Тест не пройден");

                if (tgCq) {
                  await tgCq.sendMessage(cqChatId, resultText);
                }

                if (!passed) {
                  await storage.createTask({
                    candidateId: candidateCq.id,
                    assigneeId: "system",
                    title: "Кандидат не сдал тест",
                    description: `${candidateCq.fullName} не прошёл тест "${quiz?.title ?? attempt.quizId}": ${scorePercent}% (нужно ${quiz?.passingScore ?? 70}%).`,
                    dueAt: new Date(Date.now() + 2 * 3600000).toISOString(),
                    status: "open",
                    source: "auto",
                    triggerStage: candidateCq.stage,
                  });
                }

                await storage.createActivity({
                  candidateId: candidateCq.id,
                  type: "stage_change",
                  description: `Тест "${quiz?.title ?? attempt.quizId}": ${passed ? "пройден" : "не пройден"} (${scorePercent}%)`,
                  meta: JSON.stringify({ quizId: attempt.quizId, scorePercent, passed }),
                });
              } else {
                await storage.updateQuizAttempt(attemptId, {
                  answers: JSON.stringify(answers),
                  currentQuestionIdx: nextIdx,
                });

                const answerFeedback = isCorrect ? "Верно!" : `Неверно. Правильный ответ: ${question.explanation ?? "смотри материалы"}`;
                await answerAndDone(answerFeedback);
                await sendQuizQuestionViaTelegram(cqChatId, attemptId, attempt.quizId, nextIdx);
              }
            } catch (err) {
              console.error("[webhook] quiz_answer error:", err);
              await answerAndDone("Ошибка обработки ответа");
            }
            return;
          }

          // ── Iter6: analyze_pick callback ────────────────────────────────
          if (cqData.startsWith("analyze_pick:")) {
            const candidateId6 = cqData.slice("analyze_pick:".length);
            const pendingSetting6 = await storage.getSetting(`analyze_pending_${cqChatId}`);
            if (!pendingSetting6) { await answerAndDone("Ошибка: сессия анализа устарела"); return; }
            try {
              const { url: analyzeUrl, uploadedBy: analyzedBy } = JSON.parse(pendingSetting6.value) as { url: string; uploadedBy: string };
              // Import to avoid circular dependency
              const { storage: st } = await import("../storage.js");
              const video6 = await st.createInterviewVideo({
                candidateId: candidateId6,
                source: "zoom",
                sourceUrl: analyzeUrl,
                status: "pending",
                uploadedBy: analyzedBy,
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
              const { enqueueAnalysis: eq6 } = await import("../lib/video_pipeline.js");
              eq6(video6.id);
              const cand6 = await storage.getCandidate(candidateId6);
              const tg6 = getTelegram();
              if (tg6) await tg6.sendMessage(cqChatId, `✅ Запустил анализ интервью ${cand6?.fullName ?? candidateId6}. Готово через ~5 минут.`);
              await answerAndDone("Анализ запущен!");
            } catch (err6) {
              console.error("[webhook] analyze_pick error:", err6);
              await answerAndDone("Ошибка запуска анализа");
            }
            return;
          }

          // ── Iter6: video consent callbacks ─────────────────────────────────
          if (cqData.startsWith("video_consent_accept:")) {
            const consentChatId = cqData.slice("video_consent_accept:".length);
            await storage.upsertSetting(`video_consent_${consentChatId}`, "accepted");
            const tgConsent = getTelegram();
            if (tgConsent) await tgConsent.sendMessage(cqChatId, "✅ Спасибо! Ваше согласие зафиксировано.");
            await answerAndDone("Согласие получено");
            return;
          }
          if (cqData.startsWith("video_consent_decline:")) {
            const consentChatId = cqData.slice("video_consent_decline:".length);
            await storage.upsertSetting(`video_consent_${consentChatId}`, "declined");
            const tgConsent = getTelegram();
            if (tgConsent) await tgConsent.sendMessage(cqChatId, "Вы отказались от видеоанализа. Остальной процесс подбора продолжается.");
            await answerAndDone("Отказ зафиксирован");
            return;
          }

          // Unknown callback — still must answer
          await answerAndDone();
          return;
        }

        if (!update?.message) return;
        const msg = update.message;
        const chatId = String(msg.chat?.id ?? "");
        const username = msg.chat?.username ?? msg.from?.username ?? null;
        const botUsername = getBotUsername();
        const isVoice = Boolean(msg.voice?.file_id);
        const isPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
        const isDocument = Boolean(msg.document?.file_id);
        const rawText = msg.text ?? "";

        // /start <token> flow — link candidate
        if (rawText.startsWith("/start ")) {
          const token = rawText.slice(7).trim();
          const candidate = await storage.getCandidateByLinkToken(token);
          if (candidate) {
            // Link the candidate
            await storage.updateCandidate(candidate.id, { telegramChatId: chatId });
            await storage.upsertTelegramLink({
              candidateId: candidate.id,
              chatId,
              username,
              linkedAt: new Date().toISOString(),
              botUsername,
            });
            // ── Iter5: apply pending referral & UTM ─────────────────────────
            const pendingRef5 = await storage.getSetting(`ref_pending_${chatId}`);
            if (pendingRef5) {
              try {
                const { codeId } = JSON.parse(pendingRef5.value) as { codeId: string };
                const existingRef5 = await storage.getReferralByCandidate(candidate.id);
                if (!existingRef5) {
                  await storage.createReferral({ codeId, candidateId: candidate.id, status: "registered", bonusAmount: null, paidAt: null });
                  await storage.updateCandidate(candidate.id, { utmSource: "referral" } as Parameters<typeof storage.updateCandidate>[1]);
                }
              } catch (eRef) { console.error("[bot] referral apply error:", eRef); }
            }
            const pendingUtm5 = await storage.getSetting(`utm_pending_${chatId}`);
            if (pendingUtm5) {
              try {
                const utmData = JSON.parse(pendingUtm5.value) as { utmSource?: string; utmMedium?: string; utmCampaign?: string };
                await storage.updateCandidate(candidate.id, { utmSource: utmData.utmSource ?? null, utmMedium: utmData.utmMedium ?? null, utmCampaign: utmData.utmCampaign ?? null } as Parameters<typeof storage.updateCandidate>[1]);
              } catch (eUtm) { console.error("[bot] utm apply error:", eUtm); }
            }
            // Record activity
            await storage.createActivity({
              candidateId: candidate.id,
              type: "message",
              description: `Telegram привязан: chat_id ${chatId}${username ? " (@" + username + ")" : ""}`,
              meta: JSON.stringify({ channel: "telegram_bot", chatId, username }),
            });
            // Send welcome
            const tg = getTelegram();
            if (tg) {
              await tg.sendMessage(chatId, `Добро пожаловать, ${candidate.fullName}! Ваш аккаунт успешно привязан к системе Skin Line HR.`);
            }
          } else {
            // No match — just acknowledge
            const tg = getTelegram();
            if (tg) {
              await tg.sendMessage(chatId, "Ссылка недействительна или устарела. Запросите новую ссылку у HR-менеджера.");
            }
          }
          return;
        }

        // ── Iter5: /referral command ─────────────────────────────────────────
        if (rawText === "/referral" || rawText.startsWith("/referral ")) {
          const tgBot = getTelegram();
          if (tgBot) {
            const allUsers = await storage.getCrmUsers();
            const crmUser = allUsers.find((u) => u.telegramChatId === chatId);
            const linkedCandidateRef = await storage.getCandidateByTelegramChatId(chatId);
            const isOfficial = linkedCandidateRef?.stage === "official";
            if (!crmUser && !isOfficial) {
              await tgBot.sendMessage(chatId, "Реферальная программа доступна только для действующих сотрудников.");
            } else {
              const lookupFilter = crmUser ? { userId: crmUser.id } : { candidateId: linkedCandidateRef!.id };
              const existingCodes = await storage.getReferralCodes(lookupFilter);
              let refCode = existingCodes.find((c) => c.active === 1);
              if (!refCode) {
                const { randomBytes: rb } = await import("node:crypto");
                let newCodeStr = rb(4).toString("hex").toUpperCase();
                while (await storage.getReferralCodeByCode(newCodeStr)) {
                  newCodeStr = rb(4).toString("hex").toUpperCase();
                }
                refCode = await storage.createReferralCode({
                  userId: crmUser?.id ?? null,
                  candidateId: linkedCandidateRef?.id ?? null,
                  code: newCodeStr,
                  active: 1,
                  bonusAmount: 5000,
                });
              }
              const refs = await storage.getReferrals({ codeId: refCode.id });
              const registered = refs.length;
              const hired = refs.filter((r) => ["hired","passed_probation","paid"].includes(r.status)).length;
              const passed = refs.filter((r) => ["passed_probation","paid"].includes(r.status)).length;
              const link = `https://t.me/${botUsername}?start=ref_${refCode.code}`;
              await tgBot.sendMessage(chatId,
                `🎁 Реферальная программа Skin Line\n\nВаша ссылка:\n${link}\n\nСтатистика:\n— Зарегистрировалось: ${registered}\n— Наняли: ${hired}\n— Прошли испытательный: ${passed}\n\nБонус за каждого прошедшего испытательный срок: ${refCode.bonusAmount} ₽`
              );
            }
          }
          return;
        }

        // ── Iter5: ref_ start param ──────────────────────────────────────────
        if (rawText.startsWith("/start ref_")) {
          const refCodeStr = rawText.slice(11).trim();
          const tgBot = getTelegram();
          const codeRow = await storage.getReferralCodeByCode(refCodeStr);
          if (codeRow && tgBot) {
            await storage.upsertSetting(`ref_pending_${chatId}`, JSON.stringify({ codeId: codeRow.id, refCode: refCodeStr }));
            await tgBot.sendMessage(chatId, "Добро пожаловать! Вы перешли по реферальной ссылке Skin Line. Заполните анкету, чтобы подать заявку.");
          } else if (tgBot) {
            await tgBot.sendMessage(chatId, "Реферальный код не найден. Обратитесь к пригласившему вас сотруднику.");
          }
          return;
        }

        // ── Iter5: utm_ start param ───────────────────────────────────────────
        if (rawText.startsWith("/start utm_")) {
          const parts = rawText.slice(11).trim().split("_");
          const [utmSource, utmMedium, utmCampaign] = parts;
          await storage.upsertSetting(`utm_pending_${chatId}`, JSON.stringify({ utmSource: utmSource ?? null, utmMedium: utmMedium ?? null, utmCampaign: utmCampaign ?? null }));
          const tgBot = getTelegram();
          if (tgBot) await tgBot.sendMessage(chatId, "Добро пожаловать в Skin Line! Свяжитесь с HR-менеджером для подачи заявки.");
          return;
        }


        // ── Iter6: /analyze command (HR-only) ─────────────────────────────
        if (rawText.startsWith("/analyze ") || rawText === "/analyze") {
          const tgAnalyze = getTelegram();
          if (!tgAnalyze) return;

          const allCrmUsers6 = await storage.getCrmUsers();
          const crmUser6 = allCrmUsers6.find((u) => u.telegramChatId === chatId);
          if (!crmUser6) {
            await tgAnalyze.sendMessage(chatId, "Команда /analyze доступна только HR-менеджерам. Обратитесь к администратору системы.");
            return;
          }

          const url6 = rawText.slice("/analyze ".length).trim();
          if (!url6 || !url6.startsWith("http")) {
            await tgAnalyze.sendMessage(chatId, "Использование: /analyze <ссылка на Zoom-запись>\nПример: /analyze https://zoom.us/rec/share/...");
            return;
          }

          // Find top-3 candidates for matching
          const allCandidates6 = await storage.getCandidates();
          const activeCandidates6 = allCandidates6
            .filter((c) => !(["rejected", "dismissed"].includes(c.stage)))
            .slice(0, 20);

          const top3 = activeCandidates6.slice(0, 3);

          // Store pending analyze URL in settings
          await storage.upsertSetting(`analyze_pending_${chatId}`, JSON.stringify({ url: url6, uploadedBy: crmUser6.id }));

          const keyboard = [
            ...top3.map((c) => [{ text: `${c.fullName} (${c.stage})`, callback_data: `analyze_pick:${c.id}` }]),
            [{ text: "Выбрать другого кандидата вручную", callback_data: `analyze_manual:${chatId}` }],
          ];

          await tgAnalyze.sendMessage(
            chatId,
            `🎬 Анализ Zoom-интервью\n\nСсылка: ${url6}\n\nК какому кандидату привязать это видео?`,
            { reply_markup: { inline_keyboard: keyboard } }
          );
          return;
        }

        // ── Iter6: consent check for new candidate contacts ──────────────────
        // If this is the first time a candidate sends a message, check consent
        const consentKey6 = `video_consent_${chatId}`;
        const existingConsent6 = await storage.getSetting(consentKey6);
        const candidateForConsent = await storage.getCandidateByTelegramChatId(chatId);
        if (candidateForConsent && !existingConsent6 && !rawText.startsWith("/")) {
          // Only show consent once per chat
          const tgConsent = getTelegram();
          if (tgConsent) {
            await storage.upsertSetting(consentKey6, "shown");
            await tgConsent.sendMessage(
              chatId,
              "📋 Согласие на обработку данных (ФЗ-152)\n\nВ процессе подбора может проводиться видеоинтервью с AI-анализом. Данные обрабатываются в соответствии с ФЗ-152 «О персональных данных».\n\nПодтвердите согласие на запись видеоинтервью и AI-анализ для обработки вашей заявки.",
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "✅ Согласен(на)", callback_data: `video_consent_accept:${chatId}` },
                      { text: "❌ Отказываюсь", callback_data: `video_consent_decline:${chatId}` },
                    ],
                  ],
                },
              }
            );
          }
        }

        // Regular incoming message — find candidate by chat_id
        const candidate = await storage.getCandidateByTelegramChatId(chatId);
        if (!candidate) {
          console.log(`[telegram-webhook] Unmatched message from chatId=${chatId}: ${rawText.substring(0, 50)}`);
          return;
        }

        // ── Iter4: Photo/Document — process as candidate document ────────────
        if ((isPhoto || isDocument) && !rawText) {
          setImmediate(() => {
            const photoArr = isPhoto ? msg.photo : undefined;
            const largestPhoto = photoArr ? photoArr[photoArr.length - 1] : undefined;
            const fileId = largestPhoto?.file_id ?? msg.document?.file_id;
            if (fileId) {
              processTelegramDocument(candidate.id, fileId, msg.document?.file_name ?? "").catch((err) =>
                console.error("[webhook] processTelegramDocument error:", err)
              );
            }
          });
          // Still save a message record for the photo
          await storage.createMessage({
            candidateId: candidate.id,
            channel: "telegram_bot",
            direction: "in",
            text: isDocument ? `[документ: ${msg.document?.file_name ?? "файл"}]` : "[фото]",
            isRead: 0,
            deliveryStatus: "delivered",
            meta: JSON.stringify({ chatId, purpose: "document_upload" }),
          });
          return;
        }

        // ── Voice: try Whisper transcription, fall back to stub ──────────────
        let messageText = rawText;
        if (isVoice && msg.voice?.file_id) {
          const tg = getTelegram();
          let voiceBuffer: Buffer | null = null;
          try {
            if (tg) {
              const fileInfo = await tg.getFile(msg.voice.file_id);
              if (fileInfo?.file_path) {
                const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
                const audioUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
                const audioRes = await fetch(audioUrl);
                const arrayBuf = await audioRes.arrayBuffer();
                voiceBuffer = Buffer.from(arrayBuf);
              }
            }
          } catch (err) {
            console.error("[telegram-webhook] Voice download error:", err);
          }

          if (voiceBuffer) {
            const transcription = await transcribeVoice(voiceBuffer);
            if (transcription) {
              messageText = `[voice]: ${transcription}`;
            } else {
              // Whisper not available — stub + task for HR
              messageText = "[голосовое сообщение — нажмите для прослушивания]";
              await storage.createTask({
                candidateId: candidate.id,
                assigneeId: "system",
                title: "Голосовое сообщение от кандидата",
                description: `Кандидат ${candidate.fullName} прислал голосовое сообщение. Прослушайте в Telegram.`,
                dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                status: "open",
                source: "auto",
                triggerStage: candidate.stage,
              });
            }
          } else {
            messageText = "[голосовое сообщение — нажмите для прослушивания]";
          }
        }

        // ── Sentiment & intent detection ─────────────────────────────────────
        let sentimentMeta: Record<string, unknown> = { chatId, username };
        if (messageText && messageText !== "[голосовое сообщение — нажмите для прослушивания]") {
          const sentiment = await detectSentimentAndIntent(messageText);
          if (sentiment) {
            sentimentMeta = { ...sentimentMeta, sentiment: sentiment.sentiment, intent: sentiment.intent, escalate: sentiment.escalate };

            // Intent: change_mind → move to reserve
            if (sentiment.intent === "change_mind") {
              if (!["reserve", "rejected", "official", "dismissed"].includes(candidate.stage)) {
                await storage.updateCandidate(candidate.id, { stage: "reserve" });
                await storage.createActivity({
                  candidateId: candidate.id,
                  type: "stage_change",
                  description: "Кандидат передумал — авто-перевод в Резерв",
                  meta: JSON.stringify({ reason: "change_mind_intent", message: messageText.slice(0, 200) }),
                });
                const tgNotify = getTelegram();
                if (tgNotify) {
                  const hr = await storage.getCrmUsers().then((u) => u.find((x) => x.roleKey === "recruiter"));
                  if (hr?.telegramUsername) {
                    await tgNotify.sendMessage(`@${hr.telegramUsername}`, `❗ Кандидат ${candidate.fullName} написал, что передумал. Авто-переведён в Резерв.\n\nСообщение: "${messageText.slice(0, 300)}"`).catch(() => null);
                  }
                }
              }
            }

            // Intent: reschedule → create HR task
            if (sentiment.intent === "reschedule") {
              await storage.createTask({
                candidateId: candidate.id,
                assigneeId: "system",
                title: "Перенос интервью",
                description: `Кандидат ${candidate.fullName} хочет перенести встречу. Сообщение: "${messageText.slice(0, 200)}"`,
                dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                status: "open",
                source: "auto",
                triggerStage: candidate.stage,
              });
            }

            // Escalate immediately
            if (sentiment.escalate) {
              await storage.createTask({
                candidateId: candidate.id,
                assigneeId: "system",
                title: "Требует внимания HR",
                description: `Кандидат ${candidate.fullName}: ${messageText.slice(0, 300)}`,
                dueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                status: "open",
                source: "auto",
                triggerStage: candidate.stage,
              });
            }
          }
        }

        // ── Save inbound message with meta ────────────────────────────────────
        await storage.createMessage({
          candidateId: candidate.id,
          channel: "telegram_bot",
          direction: "in",
          text: messageText || "[медиафайл]",
          isRead: 0,
          deliveryStatus: "delivered",
          meta: JSON.stringify(sentimentMeta),
        });

        // ── Negative streak detection (2+ consecutive negative messages) ──────
        const recentMsgs = await storage.getMessages(candidate.id);
        const lastInbound = recentMsgs.filter((m) => m.direction === "in").slice(-3);
        const negativeStreak = lastInbound.length >= 2 && lastInbound.slice(-2).every((m) => {
          try { return (JSON.parse(m.meta ?? "{}") as { sentiment?: string }).sentiment === "negative"; } catch { return false; }
        });
        if (negativeStreak) {
          await storage.createTask({
            candidateId: candidate.id,
            assigneeId: "system",
            title: "Кандидат недоволен",
            description: `Кандидат ${candidate.fullName} отправляет негативные сообщения подряд. Последнее: "${messageText.slice(0, 200)}"`,
            dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            status: "open",
            source: "auto",
            triggerStage: candidate.stage,
          });
        }

        // ── AI auto-reply (only if ai_chat_enabled=true) ──────────────────────
        const aiChatSetting = await storage.getSetting("ai_chat_enabled");
        const aiChatEnabled = aiChatSetting?.value === "true";
        if (aiChatEnabled && messageText && messageText !== "[голосовое сообщение — нажмите для прослушивания]") {
          const history = recentMsgs.slice(-20).map((m) => ({
            direction: m.direction,
            text: m.text,
            sentAt: m.sentAt,
          }));

          const aiResult = await aiReply(candidate, history, messageText);
          if (aiResult) {
            if (!aiResult.shouldEscalate) {
              // Send reply to candidate
              const tg = getTelegram();
              if (tg) {
                try {
                  await tg.sendMessage(chatId, aiResult.reply);
                  // Save AI reply as outbound message
                  await storage.createMessage({
                    candidateId: candidate.id,
                    channel: "telegram_bot",
                    direction: "out",
                    text: aiResult.reply,
                    isRead: 1,
                    deliveryStatus: "delivered",
                    meta: JSON.stringify({ ai: true, chatId }),
                  });
                } catch (err) {
                  console.error("[telegram-webhook] Failed to send AI reply:", err);
                }
              }
            } else {
              // Escalate to HR
              await storage.createTask({
                candidateId: candidate.id,
                assigneeId: "system",
                title: "AI эскалация: требует ответа HR",
                description: `Кандидат ${candidate.fullName}: "${messageText.slice(0, 200)}"\n\nПричина: ${aiResult.reason}`,
                dueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                status: "open",
                source: "auto",
                triggerStage: candidate.stage,
              });
            }
          }
        }
      } catch (err) {
        console.error("[telegram-webhook] Processing error:", err);
      }
    });
  });

  // Telegram webhook setup
  app.post("/api/integrations/telegram/setup", async (req, res) => {
    const secret = req.headers["x-setup-secret"] ?? req.body?.secret;
    if (process.env.SETUP_SECRET && secret !== process.env.SETUP_SECRET) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const tg = getTelegram();
    if (!tg) return res.status(400).json({ message: "TELEGRAM_BOT_TOKEN не задан" });
    try {
      const webhookUrl = "https://api.skinline-hr.ru/api/webhooks/telegram";
      await tg.setWebhook(webhookUrl);
      const me = await tg.getMe();
      res.json({ ok: true, webhook: webhookUrl, bot: me });
    } catch (err) {
      res.status(500).json({ message: "Ошибка регистрации webhook", detail: String(err) });
    }
  });

  // ---------- Avito integration ----------
  app.post("/api/integrations/avito/sync", async (_req, res) => {
    if (!avitoEnvConfigured()) {
      return res.status(400).json({
        message: "Не настроены переменные окружения для Avito. Проверьте .env.",
      });
    }
    try {
      const result = await pollAvitoUnread(50);
      res.json({
        ok: true,
        chatsProcessed: result.chatsProcessed,
        imported: result.messagesIngested,
        ingestedCount: result.messagesIngested,
      });
    } catch (err) {
      console.error("[avito] manual sync failed:", err);
      res.status(502).json({
        message: "Ошибка синхронизации с Avito",
        detail: (err as Error).message,
      });
    }
  });

  app.get("/api/integrations/avito/chats", async (req, res) => {
    if (!avitoEnvConfigured()) {
      return res.status(400).json({ message: "Avito не настроен" });
    }
    try {
      const integ = await storage.getIntegration("avito");
      const client = new AvitoClient((integ ?? null) as any);
      const userId = parseInt(
        (integ?.accountId || process.env.AVITO_USER_ID || "0"),
        10,
      );
      if (!userId) return res.status(400).json({ message: "AVITO_USER_ID не задан" });
      const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 100);
      const unreadOnly = String(req.query.unread_only ?? "false") === "true";
      const data = await client.getChats({ userId, limit, unreadOnly });
      res.json(data);
    } catch (err) {
      console.error("[avito] list chats failed:", err);
      res.status(502).json({ message: "Не удалось получить чаты Avito" });
    }
  });

  app.post("/api/integrations/avito/chats/:chatId/reply", async (req, res) => {
    if (!avitoEnvConfigured()) {
      return res.status(400).json({ message: "Avito не настроен" });
    }
    const chatId = req.params.chatId;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ message: "Пустое сообщение" });
    try {
      const result = await sendAvitoReply({ chatId, text });
      res.json(result);
    } catch (err) {
      console.error("[avito] reply failed:", err);
      res.status(502).json({
        message: "Не удалось отправить сообщение в Avito",
        detail: (err as Error).message,
      });
    }
  });

  app.post("/api/webhooks/avito", async (req, res) => {
    const body: any = req.body ?? {};
    const value = body?.payload?.value;
    const externalId =
      (value?.content?.id && String(value.content.id)) ||
      (typeof body.id === "string" && body.id) ||
      null;

    let stored;
    try {
      stored = await storage.createWebhookEvent({
        source: "avito",
        eventType: String(body?.payload?.type || "unknown"),
        externalId,
        payload: JSON.stringify(body),
        status: "pending",
        attempts: 0,
        lastError: null,
      });
    } catch (err) {
      console.error("[avito] failed to record webhook event:", err);
      return res.status(200).json({ ok: true });
    }

    res.status(200).json({ ok: true });

    setImmediate(async () => {
      try {
        await processAvitoWebhook(body as AvitoWebhookEvent);
      } catch (err) {
        console.error(`[avito] async webhook processing failed for ${stored!.id}:`, err);
      }
    });
  });

  app.post("/api/integrations/avito/poll", async (_req, res) => {
    if (!avitoEnvConfigured()) {
      return res.status(400).json({ message: "Avito не настроен" });
    }
    try {
      const result = await pollAvitoUnread(50);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[avito] poll failed:", err);
      res.status(502).json({ message: "Ошибка опроса Avito" });
    }
  });

  app.get("/api/integrations/avito/self", async (_req, res) => {
    if (!avitoEnvConfigured()) {
      return res.status(400).json({ message: "Avito не настроен" });
    }
    try {
      const integ = await storage.getIntegration("avito");
      const client = new AvitoClient((integ ?? null) as any);
      const self = await client.getSelf();
      res.json({ ok: true, self });
    } catch (err) {
      res.status(502).json({
        message: "Avito недоступен",
        detail: (err as Error).message,
      });
    }
  });

  // Manual trigger: import Avito vacancies into the DB
  app.post("/api/integrations/avito/import-vacancies", async (_req, res) => {
    if (!avitoEnvConfigured()) {
      return res.status(400).json({ ok: false, error: "Avito not configured" });
    }
    try {
      const result = await importAvitoVacancies();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---------- hh.ru integration ----------
  app.get("/api/integrations", async (_req, res) => {
    const rows = await storage.getIntegrations();
    const bySource = new Map(rows.map((r) => [r.source, r]));
    const sources = ["hh", "avito", "telegram"];
    res.json(sources.map((s) => {
      const row = bySource.get(s);
      return row ? maskIntegration(row) : placeholderIntegration(s);
    }));
  });

  app.get("/api/integrations/:source", async (req, res) => {
    const row = await storage.getIntegration(req.params.source);
    if (!row) return res.json(placeholderIntegration(req.params.source));
    res.json(maskIntegration(row));
  });

  app.get("/api/integrations/hh/connect", async (_req, res) => {
    if (!hhEnvConfigured()) {
      return res.status(400).json({
        message: "Не настроены переменные окружения для hh.ru. Проверьте .env.",
      });
    }
    try {
      const state = randomUUID();
      await storage.createOauthState(state, "hh");
      const url = new HhClient().getAuthorizeUrl(state);
      res.redirect(302, url);
    } catch (err) {
      console.error("[hh] connect failed:", err);
      res.redirect(302, `${FRONTEND_SETTINGS_URL}?error=hh`);
    }
  });

  // Shared OAuth callback handler used by both the canonical callback route
  // (`/api/integrations/hh/callback`) and the alias route (`/api/hh/oauth`).
  // The alias exists because the hh.ru app cabinet has redirect_uri configured
  // as `https://skinline-hr.ru/api/hh/oauth`; both paths must behave identically.
  async function handleHhOauthCallback(req: Request, res: any): Promise<void> {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    try {
      if (!code || !state) throw new Error("missing code or state");
      const stored = await storage.getOauthState(state);
      if (!stored || stored.source !== "hh") throw new Error("invalid state");
      await storage.deleteOauthState(state);
      const STATE_TTL_MS = 10 * 60 * 1000;
      if (Date.now() - new Date(stored.createdAt).getTime() > STATE_TTL_MS) {
        throw new Error("state expired");
      }

      const tokens = await new HhClient().exchangeCode(code);
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      let integration = await storage.upsertIntegration("hh", {
        status: "connected",
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt,
        lastError: null,
      });

      try {
        const client = new HhClient(integration);
        const me = await client.me();
        const accountName =
          [me.first_name, me.last_name].filter(Boolean).join(" ").trim() ||
          me.email ||
          "Аккаунт hh.ru";
        const meta = JSON.stringify({
          employerId: me.employer?.id ?? null,
          employerName: me.employer?.name ?? null,
          managerId: me.manager?.id ?? null,
          email: me.email ?? null,
        });
        integration = (await storage.updateIntegration(integration.id, {
          accountId: me.employer?.id ?? me.id ?? null,
          accountName,
          meta,
        })) ?? integration;
      } catch (meErr) {
        console.warn("[hh] /me lookup failed during callback:", meErr);
      }

      res.redirect(302, `${FRONTEND_SETTINGS_URL}?connected=hh`);
    } catch (err) {
      console.error("[hh] callback failed:", err);
      res.redirect(302, `${FRONTEND_SETTINGS_URL}?error=hh`);
    }
  }

  app.get("/api/integrations/hh/callback", handleHhOauthCallback);
  // Alias matching the redirect_uri registered in the hh.ru app cabinet.
  app.get("/api/hh/oauth", handleHhOauthCallback);

  app.post("/api/integrations/hh/disconnect", async (_req, res) => {
    try {
      const existing = await storage.getIntegration("hh");
      if (!existing) return res.json(placeholderIntegration("hh"));
      const updated = await storage.updateIntegration(existing.id, {
        status: "disconnected",
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        lastError: null,
      });
      res.json(updated ? maskIntegration(updated) : placeholderIntegration("hh"));
    } catch (err) {
      console.error("[hh] disconnect failed:", err);
      res.status(500).json({ message: "Не удалось отключить hh.ru" });
    }
  });

  app.post("/api/integrations/hh/sync", async (_req, res) => {
    // Connection is determined by token presence, NOT the `status` column —
    // status can be stuck at 'error' from an earlier transient failure while
    // the account is in fact connected (hasTokens=true).
    const integration = await storage.getIntegration("hh");
    if (!integration || !integrationHasTokens(integration)) {
      return res.status(400).json({
        message: "hh.ru не подключён. Подключите аккаунт в настройках.",
      });
    }
    try {
      const result = await pollAll();
      const message = result.noVacancies
        ? "Нет активных вакансий на hh.ru — откликов для синхронизации нет. Опубликуйте вакансию на hh.ru, чтобы получать отклики."
        : `Синхронизация завершена: вакансий опрошено ${result.vacanciesPolled}, новых откликов ${result.createdCount}, обработано ${result.ingestedCount}.`;
      res.json({
        ok: true,
        message,
        vacanciesPolled: result.vacanciesPolled,
        ingestedCount: result.ingestedCount,
        createdCount: result.createdCount,
        imported: result.createdCount,
      });
    } catch (err) {
      console.error("[hh] manual sync failed:", err);
      res.status(502).json({ message: "Ошибка синхронизации с hh.ru" });
    }
  });

  app.post("/api/integrations/hh/webhook", async (req, res) => {
    const signature =
      req.header("X-Hh-Signature") || req.header("x-hh-signature") || null;
    if (!signature) {
      console.warn("[hh] webhook received without X-Hh-Signature header");
    }
    const body: any = req.body ?? {};
    const externalId =
      (typeof body.negotiation_id === "string" && body.negotiation_id) ||
      (typeof body.negotiationId === "string" && body.negotiationId) ||
      (body?.payload && typeof body.payload.negotiation_id === "string" && body.payload.negotiation_id) ||
      null;
    let event;
    try {
      event = await storage.createWebhookEvent({
        source: "hh",
        eventType: String(body.type || body.action || body.event || "unknown"),
        externalId,
        payload: JSON.stringify(body),
        status: "pending",
        attempts: 0,
        lastError: null,
      });
    } catch (err) {
      console.error("[hh] failed to record webhook event:", err);
      return res.status(200).json({ ok: true });
    }
    res.status(200).json({ ok: true });
    setImmediate(() => {
      processWebhookEvent(event!.id).catch((err) =>
        console.error(`[hh] async webhook processing failed for ${event!.id}:`, err),
      );
    });
  });

  app.get("/api/candidates/:id/sync", async (req, res) => {
    const candidateId = req.params.id;
    try {
      const ref = await storage.getExternalRefByEntity(
        "candidate", candidateId, "hh", "negotiation",
      );
      if (!ref) {
        return res.status(400).json({
          message: "У кандидата нет связанного отклика hh.ru",
        });
      }
      const integration = await storage.getIntegration("hh");
      if (!integration || !integrationHasTokens(integration)) {
        return res.status(400).json({
          message: "hh.ru не подключён. Подключите аккаунт в настройках.",
        });
      }
      const client = new HhClient(integration);
      const result = await ingestNegotiation(client, ref.externalId);
      res.json({ ok: true, newMessages: result.newMessages ?? 0 });
    } catch (err) {
      console.error(`[hh] candidate sync failed for ${candidateId}:`, err);
      res.status(502).json({ message: "Ошибка синхронизации с hh.ru" });
    }
  });

  // Import active hh.ru employer vacancies into the local vacancies table.
  app.post("/api/integrations/hh/vacancies/import", async (_req, res) => {
    const integration = await storage.getIntegration("hh");
    if (!integration || !integrationHasTokens(integration)) {
      return res.status(400).json({
        ok: false,
        message: "hh.ru не подключён. Подключите аккаунт в настройках.",
      });
    }
    try {
      const result = await importHhVacancies();
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[hh_vacancies] import route failed:", err);
      res.status(502).json({ ok: false, message: "Ошибка импорта вакансий с hh.ru" });
    }
  });

  // Publish a local vacancy to hh.ru (paid action — UI must confirm first).
  app.post("/api/vacancies/:id/publish-hh", async (req, res) => {
    const integration = await storage.getIntegration("hh");
    if (!integration || !integrationHasTokens(integration)) {
      return res.status(400).json({
        ok: false,
        message: "hh.ru не подключён. Подключите аккаунт в настройках.",
      });
    }
    try {
      const result = await publishVacancyToHh(req.params.id);
      if (!result.ok) {
        // 422 = vacancy data incomplete / hh validation; a readable message
        // (incl. the list of missing required fields) is in result.error.
        return res.status(422).json({ ok: false, message: result.error });
      }
      res.json(result);
    } catch (err) {
      console.error(`[hh_vacancies] publish route failed for ${req.params.id}:`, err);
      res.status(502).json({ ok: false, message: "Ошибка публикации вакансии на hh.ru" });
    }
  });


  // ---------- AI routes (Iter2) ----------

  /** POST /api/candidates/check-duplicate */
  app.post("/api/candidates/check-duplicate", async (req, res) => {
    const { phone, fullName, dateOfBirth } = req.body as { phone?: string; fullName?: string; dateOfBirth?: string };
    const matches: Array<{ field: string; candidate: unknown }> = [];
    if (phone) {
      const byPhone = await storage.getCandidatesByPhone(phone);
      for (const c of byPhone) {
        matches.push({ field: "phone", candidate: c });
      }
    }
    if (fullName) {
      const byName = await storage.getCandidatesByFullName(fullName);
      for (const c of byName) {
        // Avoid double-listing a candidate already found by phone
        if (!matches.find((m) => (m.candidate as { id: string }).id === c.id)) {
          matches.push({ field: "fullName", candidate: c });
        }
      }
    }
    res.json({ matches });
  });

  /** POST /api/candidates/:id/ai-screen — manual AI screening */
  app.post("/api/candidates/:id/ai-screen", async (req, res) => {
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    try {
      await runAiScreening(candidate.id);
      const updated = await storage.getCandidate(candidate.id);
      res.json({ ok: true, candidate: updated });
    } catch (err) {
      console.error("[ai-screen] manual screening failed:", err);
      res.status(500).json({ message: "Ошибка AI-скрининга", detail: String(err) });
    }
  });

  /** POST /api/candidates/:id/predictive-score — recalculate predictive score */
  app.post("/api/candidates/:id/predictive-score", async (req, res) => {
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    try {
      await runPredictiveScore(candidate.id);
      const updated = await storage.getCandidate(candidate.id);
      res.json({ ok: true, candidate: updated });
    } catch (err) {
      console.error("[predictive-score] failed:", err);
      res.status(500).json({ message: "Ошибка расчёта score", detail: String(err) });
    }
  });

  /** GET /api/settings — get all app settings */
  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения настроек", detail: String(err) });
    }
  });

  /** PUT /api/settings/:key — update a single setting */
  app.put("/api/settings/:key", async (req, res) => {
    const { key } = req.params;
    const { value } = req.body as { value?: string };
    if (value === undefined || value === null) {
      return res.status(400).json({ message: "Поле value обязательно" });
    }
    try {
      await storage.upsertSetting(key, String(value));
      res.json({ ok: true, key, value });
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения настройки", detail: String(err) });
    }
  });

  /** POST /api/ai/test — test OpenRouter connectivity */
  app.post("/api/ai/test", async (_req, res) => {
    try {
      const result = await testOpenRouter();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ---------- AI Rejection (Iter4) ----------

  /** POST /api/candidates/:id/generate-rejection — preview AI rejection text */
  app.post("/api/candidates/:id/generate-rejection", async (req, res) => {
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    const { reason } = req.body as { reason?: string };
    try {
      const msgs = await storage.getMessages(candidate.id);
      const recentMessages = msgs
        .filter((m) => m.direction === "in")
        .slice(-10)
        .map((m) => m.text);
      const text = await generateRejectionMessage(candidate, {
        reason,
        fromStage: candidate.stage,
        recentMessages,
      });
      if (!text) return res.status(500).json({ message: "AI недоступен" });
      res.json({ text });
    } catch (err) {
      res.status(500).json({ message: "Ошибка генерации", detail: String(err) });
    }
  });

  /** POST /api/candidates/:id/send-rejection — send rejection via Telegram */
  app.post("/api/candidates/:id/send-rejection", async (req, res) => {
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    const { reason, customText } = req.body as { reason?: string; customText?: string };
    try {
      let text = customText;
      if (!text) {
        const msgs = await storage.getMessages(candidate.id);
        const recentMessages = msgs
          .filter((m) => m.direction === "in")
          .slice(-10)
          .map((m) => m.text);
        text = await generateRejectionMessage(candidate, {
          reason,
          fromStage: candidate.stage,
          recentMessages,
        }) ?? undefined;
      }
      if (!text) return res.status(500).json({ message: "AI недоступен" });

      // Send via Telegram if linked
      if (candidate.telegramChatId) {
        const tg = getTelegram();
        if (tg) {
          await tg.sendMessage(candidate.telegramChatId, text);
        }
      }

      // Save to messages
      await storage.createMessage({
        candidateId: candidate.id,
        channel: "telegram_bot",
        direction: "out",
        text,
        isRead: 1,
        deliveryStatus: candidate.telegramChatId ? "delivered" : "pending",
        meta: JSON.stringify({ ai: true, purpose: "rejection", reason }),
      });

      res.json({ ok: true, text });
    } catch (err) {
      res.status(500).json({ message: "Ошибка отправки", detail: String(err) });
    }
  });


  // ---------- Health Check (Iter5 + Iter6) ----------
  app.get("/api/health", async (_req, res) => {
    try {
      const [iter5, iter6] = await Promise.all([getIter5Health(), getIter6Health()]);
      res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        iter5,
        iter6,
      });
    } catch (err) {
      res.status(500).json({ status: "error", error: String(err) });
    }
  });

  // ---------- Public landing static hosting ----------
  // Serve any files placed in `public_landing/` at the app root under /apply so
  // the candidate landing page can be hosted without a separate static server.
  // Registered here (inside registerRoutes, before the SPA catch-all in
  // index.ts) so it never clashes with the SPA fallback. If the directory is
  // absent (landing served via nginx instead), this is a no-op.
  try {
    const landingDir = path.resolve(process.cwd(), "public_landing");
    if (fs.existsSync(landingDir)) {
      app.use("/apply", express.static(landingDir));
      app.get("/apply", (_req: Request, res: Response, next: NextFunction) => {
        const indexFile = path.join(landingDir, "index.html");
        if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
        next();
      });
      console.log(`[routes] serving landing from ${landingDir} at /apply`);
    }
  } catch (err) {
    console.warn("[routes] landing static mount skipped:", err);
  }

  return httpServer;
}