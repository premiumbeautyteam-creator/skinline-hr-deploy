// Quiz routes — Iter4
import type { Express } from "express";
import { storage } from "../storage.js";
import { chatCompletion } from "../lib/ai.js";
import { getTelegram } from "../integrations/telegram.js";

export function registerQuizRoutes(app: Express): void {

  // GET /api/quizzes — list all quizzes
  app.get("/api/quizzes", async (_req, res) => {
    res.json(await storage.getQuizzes());
  });

  // POST /api/quizzes — create quiz
  app.post("/api/quizzes", async (req, res) => {
    const { title, description, active, triggerStage, passingScore } = req.body as {
      title?: string; description?: string; active?: number;
      triggerStage?: string; passingScore?: number;
    };
    if (!title) return res.status(400).json({ message: "title обязателен" });
    const quiz = await storage.createQuiz({
      title,
      description: description ?? "",
      active: active ?? 1,
      triggerStage: triggerStage ?? null,
      passingScore: passingScore ?? 70,
    });
    res.status(201).json(quiz);
  });

  // PUT /api/quizzes/:id — update quiz
  app.put("/api/quizzes/:id", async (req, res) => {
    const quiz = await storage.getQuiz(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Квиз не найден" });
    const updated = await storage.updateQuiz(req.params.id, req.body);
    res.json(updated);
  });

  // GET /api/quizzes/:id/questions — questions for a quiz
  app.get("/api/quizzes/:id/questions", async (req, res) => {
    const quiz = await storage.getQuiz(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Квиз не найден" });
    res.json(await storage.getQuizQuestions(req.params.id));
  });

  // POST /api/quizzes/:id/questions — add question
  app.post("/api/quizzes/:id/questions", async (req, res) => {
    const quiz = await storage.getQuiz(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Квиз не найден" });
    const { text, options, correctIndex, explanation, position } = req.body as {
      text?: string; options?: string[]; correctIndex?: number;
      explanation?: string; position?: number;
    };
    if (!text) return res.status(400).json({ message: "text обязателен" });
    const question = await storage.createQuizQuestion({
      quizId: req.params.id,
      text,
      options: JSON.stringify(Array.isArray(options) ? options : []),
      correctIndex: correctIndex ?? 0,
      explanation: explanation ?? null,
      position: position ?? 0,
    });
    res.status(201).json(question);
  });

  // PUT /api/quiz-questions/:id — update question
  app.put("/api/quiz-questions/:id", async (req, res) => {
    const q = await storage.getQuizQuestion(req.params.id);
    if (!q) return res.status(404).json({ message: "Вопрос не найден" });
    const update = { ...req.body };
    if (Array.isArray(update.options)) {
      update.options = JSON.stringify(update.options);
    }
    const updated = await storage.updateQuizQuestion(req.params.id, update);
    res.json(updated);
  });

  // DELETE /api/quiz-questions/:id
  app.delete("/api/quiz-questions/:id", async (req, res) => {
    await storage.deleteQuizQuestion(req.params.id);
    res.status(204).end();
  });

  // GET /api/candidates/:id/quiz-attempts
  app.get("/api/candidates/:id/quiz-attempts", async (req, res) => {
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    res.json(await storage.getQuizAttempts(req.params.id));
  });

  // POST /api/candidates/:id/quiz-attempts/start — start attempt for a quiz
  app.post("/api/candidates/:id/quiz-attempts/start", async (req, res) => {
    const { quizId } = req.body as { quizId?: string };
    if (!quizId) return res.status(400).json({ message: "quizId обязателен" });
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    const quiz = await storage.getQuiz(quizId);
    if (!quiz) return res.status(404).json({ message: "Квиз не найден" });

    // Cancel any in_progress attempts
    const existing = await storage.getActiveQuizAttempt(req.params.id, quizId);
    if (existing) {
      await storage.updateQuizAttempt(existing.id, { status: "failed", finishedAt: new Date().toISOString() });
    }

    const attempt = await storage.createQuizAttempt({
      candidateId: req.params.id,
      quizId,
      status: "in_progress",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      scorePercent: null,
      currentQuestionIdx: 0,
      answers: "[]",
    });
    res.status(201).json(attempt);

    // Optionally send first question via Telegram
    if (candidate.telegramChatId) {
      sendQuizQuestionViaTelegram(candidate.telegramChatId, attempt.id, quizId, 0).catch((err) =>
        console.error("[quiz] sendQuizQuestion error:", err)
      );
    }
  });

  // POST /api/quiz-attempts/:id/answer — answer a question (API/UI, not bot)
  app.post("/api/quiz-attempts/:id/answer", async (req, res) => {
    const { questionId, selectedIdx } = req.body as { questionId?: string; selectedIdx?: number };
    if (!questionId || selectedIdx === undefined) {
      return res.status(400).json({ message: "questionId and selectedIdx обязательны" });
    }

    const attempt = await storage.getQuizAttempt(req.params.id);
    if (!attempt) return res.status(404).json({ message: "Попытка не найдена" });
    if (attempt.status !== "in_progress") {
      return res.status(400).json({ message: "Попытка уже завершена" });
    }

    const question = await storage.getQuizQuestion(questionId);
    if (!question) return res.status(404).json({ message: "Вопрос не найден" });

    const isCorrect = question.correctIndex === selectedIdx;

    let answers: Array<{ questionId: string; selectedIdx: number; isCorrect: boolean }> = [];
    try { answers = JSON.parse(attempt.answers); } catch { answers = []; }
    answers.push({ questionId, selectedIdx, isCorrect });

    const questions = await storage.getQuizQuestions(attempt.quizId);
    const nextIdx = attempt.currentQuestionIdx + 1;
    const isLast = nextIdx >= questions.length;

    if (isLast) {
      // Finish quiz
      const correct = answers.filter((a) => a.isCorrect).length;
      const scorePercent = Math.round((correct / questions.length) * 100);
      const quiz = await storage.getQuiz(attempt.quizId);
      const passed = scorePercent >= (quiz?.passingScore ?? 70);

      const updated = await storage.updateQuizAttempt(req.params.id, {
        answers: JSON.stringify(answers),
        currentQuestionIdx: nextIdx,
        status: passed ? "passed" : "failed",
        finishedAt: new Date().toISOString(),
        scorePercent,
      });
      return res.json({ attempt: updated, isLast: true, isCorrect, passed, scorePercent });
    }

    const updated = await storage.updateQuizAttempt(req.params.id, {
      answers: JSON.stringify(answers),
      currentQuestionIdx: nextIdx,
    });
    res.json({ attempt: updated, isLast: false, isCorrect, nextQuestion: questions[nextIdx] });
  });

  // POST /api/quizzes/:id/generate-ai-questions — AI-generated questions
  app.post("/api/quizzes/:id/generate-ai-questions", async (req, res) => {
    const { topic, count } = req.body as { topic?: string; count?: number };
    const n = Math.min(count ?? 5, 10);
    const topicText = topic ?? "лазерная эпиляция";

    const raw = await chatCompletion({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Ты эксперт по лазерной эпиляции. Генерируешь тестовые вопросы с 4 вариантами ответа.",
        },
        {
          role: "user",
          content: `Создай ${n} вопросов по теме: "${topicText}".
Каждый вопрос: 4 варианта ответа, один правильный, объяснение.
Ответ строго JSON: {"questions": [{"text": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..."}]}`,
        },
      ],
      maxTokens: 2000,
      temperature: 0.7,
      jsonMode: true,
      purpose: "chat",
    });

    if (!raw) return res.status(500).json({ message: "AI недоступен" });

    try {
      const parsed = JSON.parse(raw) as { questions: Array<{ text: string; options: string[]; correctIndex: number; explanation: string }> };
      res.json({ questions: parsed.questions ?? [] });
    } catch {
      res.status(500).json({ message: "Ошибка парсинга ответа AI" });
    }
  });

  // POST /api/candidates/:id/send-quiz — send quiz invite via Telegram
  app.post("/api/candidates/:id/send-quiz", async (req, res) => {
    const { quizId } = req.body as { quizId?: string };
    const candidate = await storage.getCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Кандидат не найден" });
    if (!candidate.telegramChatId) return res.status(400).json({ message: "Кандидат не привязан к Telegram" });

    const quiz = quizId ? await storage.getQuiz(quizId) : await storage.getQuizByTriggerStage(candidate.stage);
    if (!quiz) return res.status(404).json({ message: "Квиз не найден" });

    const tg = getTelegram();
    if (!tg) return res.status(400).json({ message: "Telegram не настроен" });

    await tg.sendMessage(candidate.telegramChatId, `📝 Для вас подготовлен тест: *${quiz.title}*\n\n${quiz.description}\n\nНажмите кнопку ниже чтобы начать:`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🎯 Пройти тест", callback_data: `quiz_start:${quiz.id}` }]],
      },
    });

    res.json({ ok: true, quizId: quiz.id });
  });
}

/** Send a quiz question to candidate via Telegram inline keyboard */
export async function sendQuizQuestionViaTelegram(
  chatId: string,
  attemptId: string,
  quizId: string,
  questionIdx: number
): Promise<void> {
  const tg = getTelegram();
  if (!tg) return;

  const questions = await storage.getQuizQuestions(quizId);
  if (questionIdx >= questions.length) return;

  const q = questions[questionIdx];
  let options: string[] = [];
  try { options = JSON.parse(q.options); } catch { options = []; }

  const labels = ["A", "B", "C", "D"];
  const keyboard = options.map((opt, idx) => [{
    text: `${labels[idx] ?? idx}: ${opt}`,
    callback_data: `quiz_answer:${attemptId}:${q.id}:${idx}`,
  }]);

  const totalQuestions = questions.length;
  const questionText = `❓ Вопрос ${questionIdx + 1} из ${totalQuestions}:\n\n*${q.text}*`;

  await tg.sendMessage(chatId, questionText, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });
}
