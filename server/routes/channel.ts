// Channel autopilot API routes (Iter3)
// Registers: /api/channel/* and /api/reserve/*

import type { Express } from "express";
import { storage } from "../storage.js";
import { getTelegram } from "../integrations/telegram.js";
import { generatePost } from "../lib/content.js";
import { publishChannelPost, refillContentCalendar, reactivationTick } from "../jobs/scheduler.js";
import type { ChannelPost } from "@shared/schema";
import { randomUUID } from "node:crypto";

export function registerChannelRoutes(app: Express): void {

  // ---------- Channel settings ----------

  /** GET /api/channel/settings */
  app.get("/api/channel/settings", async (_req, res) => {
    try {
      const settings = await storage.getChannelSettings();
      res.json(settings ?? null);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения настроек канала", detail: String(err) });
    }
  });

  /** PUT /api/channel/settings */
  app.put("/api/channel/settings", async (req, res) => {
    try {
      const body = req.body as Partial<{
        channelUsername: string;
        channelTitle: string;
        autopilotEnabled: number;
        postsPerWeek: number;
        preferredHours: string;
        preferredDays: string;
      }>;
      const updated = await storage.upsertChannelSettings(body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка обновления настроек канала", detail: String(err) });
    }
  });

  /** POST /api/channel/connect — verify bot admin access and save settings */
  app.post("/api/channel/connect", async (req, res) => {
    const { channelUsername } = req.body as { channelUsername?: string };
    if (!channelUsername) {
      return res.status(400).json({ message: "channelUsername обязателен" });
    }
    const tg = getTelegram();
    if (!tg) {
      // Allow connection without live Telegram check (dev mode)
      const settings = await storage.upsertChannelSettings({ channelUsername });
      return res.json({ ok: true, settings, warning: "Telegram не настроен — проверка пропущена" });
    }
    try {
      const chat = await tg.getChat(channelUsername);
      if (!chat) {
        return res.status(400).json({ message: "Канал не найден или бот не имеет доступа. Добавьте бота как администратора." });
      }
      const settings = await storage.upsertChannelSettings({
        channelUsername,
        channelTitle: chat.title ?? channelUsername,
      });
      res.json({ ok: true, chat, settings });
    } catch (err) {
      res.status(500).json({ message: "Ошибка подключения канала", detail: String(err) });
    }
  });

  /** POST /api/channel/test-message — send a test message to the channel */
  app.post("/api/channel/test-message", async (_req, res) => {
    const tg = getTelegram();
    const settings = await storage.getChannelSettings();
    const chatId = settings?.channelUsername ?? "@SkinLineHR";
    if (!tg) return res.json({ ok: false, message: "Telegram не настроен" });
    try {
      const result = await tg.sendChannelMessage(chatId, "🤍 Тестовое сообщение от HR CRM Skin Line. Если видите это — бот настроен правильно.");
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ---------- Channel posts ----------

  /** GET /api/channel/posts?status=draft|scheduled|published&from=ISO&to=ISO */
  app.get("/api/channel/posts", async (req, res) => {
    try {
      const { status, from, to } = req.query as Record<string, string>;
      const posts = await storage.getChannelPosts({ status, from, to });
      res.json(posts);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения постов", detail: String(err) });
    }
  });

  /** GET /api/channel/posts/:id */
  app.get("/api/channel/posts/:id", async (req, res) => {
    try {
      const post = await storage.getChannelPost(req.params.id);
      if (!post) return res.status(404).json({ message: "Пост не найден" });
      res.json(post);
    } catch (err) {
      res.status(500).json({ message: "Ошибка", detail: String(err) });
    }
  });

  /** POST /api/channel/posts — manual post creation */
  app.post("/api/channel/posts", async (req, res) => {
    try {
      const body = req.body as Partial<ChannelPost>;
      if (!body.rubricKey || !body.body) {
        return res.status(400).json({ message: "rubricKey и body обязательны" });
      }
      const post = await storage.createChannelPost({
        rubricKey: body.rubricKey,
        status: body.status ?? "draft",
        title: body.title ?? "Новый пост",
        body: body.body,
        imageUrl: body.imageUrl ?? null,
        pollOptions: body.pollOptions ?? null,
        scheduledAt: body.scheduledAt ?? null,
        publishedAt: null,
        tgMessageId: null,
        createdBy: "user",
        reviewedBy: null,
        generatedFromPrompt: null,
        meta: null,
      });
      res.status(201).json(post);
    } catch (err) {
      res.status(500).json({ message: "Ошибка создания поста", detail: String(err) });
    }
  });

  /** PUT /api/channel/posts/:id */
  app.put("/api/channel/posts/:id", async (req, res) => {
    try {
      const post = await storage.getChannelPost(req.params.id);
      if (!post) return res.status(404).json({ message: "Пост не найден" });
      if (post.status === "published") {
        return res.status(400).json({ message: "Нельзя редактировать опубликованный пост" });
      }
      const updated = await storage.updateChannelPost(req.params.id, req.body as Partial<ChannelPost>);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка обновления поста", detail: String(err) });
    }
  });

  /** DELETE /api/channel/posts/:id */
  app.delete("/api/channel/posts/:id", async (req, res) => {
    try {
      await storage.deleteChannelPost(req.params.id);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления поста", detail: String(err) });
    }
  });

  /** POST /api/channel/posts/:id/publish-now */
  app.post("/api/channel/posts/:id/publish-now", async (req, res) => {
    try {
      const post = await storage.getChannelPost(req.params.id);
      if (!post) return res.status(404).json({ message: "Пост не найден" });
      // Set status to scheduled so publishChannelPost will pick it up
      await storage.updateChannelPost(req.params.id, { status: "scheduled", scheduledAt: new Date().toISOString() });
      await publishChannelPost(req.params.id);
      const updated = await storage.getChannelPost(req.params.id);
      res.json({ ok: true, post: updated });
    } catch (err) {
      res.status(500).json({ message: "Ошибка публикации", detail: String(err) });
    }
  });

  /** POST /api/channel/posts/generate — AI-generate a draft post (not saved) */
  app.post("/api/channel/posts/generate", async (req, res) => {
    const { rubricKey, contextHint } = req.body as { rubricKey?: string; contextHint?: string };
    if (!rubricKey) return res.status(400).json({ message: "rubricKey обязателен" });
    try {
      const result = await generatePost({ rubricKey, contextHint });
      if (!result) return res.status(500).json({ message: "AI не вернул результат" });
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: "Ошибка генерации поста", detail: String(err) });
    }
  });

  // ---------- Content calendar ----------

  /** GET /api/channel/calendar?from=ISO&to=ISO */
  app.get("/api/channel/calendar", async (req, res) => {
    try {
      const { from, to } = req.query as Record<string, string>;
      const posts = await storage.getChannelPosts({
        from: from ?? new Date().toISOString(),
        to: to ?? new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      res.json(posts);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения календаря", detail: String(err) });
    }
  });

  /** POST /api/channel/calendar/refill — manual trigger */
  app.post("/api/channel/calendar/refill", async (_req, res) => {
    try {
      const created = await refillContentCalendar();
      res.json({ ok: true, created });
    } catch (err) {
      res.status(500).json({ message: "Ошибка обновления календаря", detail: String(err) });
    }
  });

  // ---------- Rubrics ----------

  /** GET /api/channel/rubrics */
  app.get("/api/channel/rubrics", async (_req, res) => {
    try {
      const rubrics = await storage.getContentRubrics();
      res.json(rubrics);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения рубрик", detail: String(err) });
    }
  });

  /** PUT /api/channel/rubrics/:key */
  app.put("/api/channel/rubrics/:key", async (req, res) => {
    try {
      const rubric = await storage.getContentRubric(req.params.key);
      if (!rubric) return res.status(404).json({ message: "Рубрика не найдена" });
      const updated = await storage.updateContentRubric(req.params.key, req.body as Partial<typeof rubric>);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка обновления рубрики", detail: String(err) });
    }
  });

  // ---------- Subscribers ----------

  /** GET /api/channel/subscribers */
  app.get("/api/channel/subscribers", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
      const subscribers = await storage.getChannelSubscribers(limit);
      res.json(subscribers);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения подписчиков", detail: String(err) });
    }
  });

  // ---------- Metrics ----------

  /** GET /api/channel/metrics?postId=... */
  app.get("/api/channel/metrics", async (req, res) => {
    const { postId } = req.query as { postId?: string };
    if (!postId) return res.status(400).json({ message: "postId обязателен" });
    try {
      const metrics = await storage.getChannelMetrics(postId);
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения метрик", detail: String(err) });
    }
  });

  // ---------- Reserve reactivation ----------

  /** GET /api/reserve/reactivations */
  app.get("/api/reserve/reactivations", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
      const reactivations = await storage.getReserveReactivations(limit);
      res.json(reactivations);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения реактиваций", detail: String(err) });
    }
  });

  /** POST /api/reserve/reactivate-now — manual trigger */
  app.post("/api/reserve/reactivate-now", async (_req, res) => {
    try {
      await reactivationTick();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Ошибка запуска реактивации", detail: String(err) });
    }
  });

  /** GET /api/reserve/count — count of reserve candidates */
  app.get("/api/reserve/count", async (_req, res) => {
    try {
      const reserveCandidates = await storage.getCandidatesByStageOlderThan("reserve", 30);
      const all = await storage.getCandidates({ stage: "reserve" });
      res.json({ total: all.length, eligibleForReactivation: reserveCandidates.length });
    } catch (err) {
      res.status(500).json({ message: "Ошибка", detail: String(err) });
    }
  });
}
