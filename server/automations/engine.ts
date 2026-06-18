// Automation engine — Iter1/2/3/4
// Handles onStageChange, fake score, AI screening, predictive score

import { storage } from "../storage.js";
import { getTelegram } from "../integrations/telegram.js";
import { chatCompletion, getKnowledgeBase } from "../lib/ai.js";
import { generateRejectionMessage, generateOnboardingMessage } from "../lib/rejection.js";
import {
  renderTemplate,
  TPL_FORM_FILLED_CANDIDATE,
  TPL_IN_WORK_CANDIDATE,
  TPL_VIDEO_INTERVIEW_REMINDER,
  TPL_STUDIO_DEMO_CANDIDATE,
  TPL_STUDIO_DEMO_UK,
  TPL_THEORY_CANDIDATE,
  TPL_THEORY_FOLLOWUP_CANDIDATE,
  TPL_THEORY_ESCALATION_UK,
  TPL_EXAM_SCHEDULED_CANDIDATE,
  TPL_EXAM_SCHEDULED_TRAINER1,
  TPL_EXAM_REMINDER,
  TPL_REEXAM_CANDIDATE,
  TPL_REEXAM_FOLLOWUP_CANDIDATE,
  TPL_REEXAM_ESCALATION_UK,
  TPL_TRAINER_ONBOARDING_CANDIDATE,
  TPL_TRAINER_ONBOARDING_TRAINER2,
  TPL_STUDIO_PRACTICE_CANDIDATE,
  TPL_STUDIO_PRACTICE_UK,
  TPL_SCHEDULED_CANDIDATE,
  TPL_RESERVE_CANDIDATE,
  TPL_REJECTED_CANDIDATE,
  TPL_OFFICIAL_CANDIDATE,
} from "./templates.js";
import type { Candidate } from "@shared/schema";

// ============================================================================
// Fake score heuristics (Iter2)
// ============================================================================
export function computeFakeScore(
  data: { fullName: string; phone: string; formFilledInSeconds?: number | null },
  duplicatesByPhone: Candidate[],
): number {
  let score = 0;
  // Quick fill (<10s is suspicious)
  if (data.formFilledInSeconds !== null && data.formFilledInSeconds !== undefined) {
    if (data.formFilledInSeconds < 10) score += 40;
    else if (data.formFilledInSeconds < 30) score += 20;
  }
  // Phone duplicate
  if (duplicatesByPhone.length > 0) score += 30;
  // Name too short (bots often use "Test", "Тест" etc.)
  const nameParts = data.fullName.trim().split(/\s+/);
  if (nameParts.length < 2) score += 15;
  if (data.fullName.length < 5) score += 20;
  return Math.min(score, 100);
}

// ============================================================================
// Helpers
// ============================================================================
const APP_URL = process.env.APP_URL ?? "https://hr.skinline.ru";
const LEARNING_PLATFORM_URL = process.env.LEARNING_PLATFORM_URL ?? "https://learn.skinline.ru";

function candidateVars(c: Candidate): Record<string, string> {
  const firstName = c.fullName.split(" ")[0] ?? c.fullName;
  return {
    name: firstName,
    candidate_full_name: c.fullName,
    candidate_card_url: `${APP_URL}/candidates/${c.id}`,
    city: c.city,
    zoom_slot_url: process.env.ZOOM_SLOT_URL ?? "https://calendly.com/skinline-hr",
    learning_platform_url: LEARNING_PLATFORM_URL,
    requisites_form_url: process.env.REQUISITES_FORM_URL ?? "https://forms.skinline.ru/requisites",
    trainer_name: process.env.TRAINER_NAME ?? "Виктория",
    trainer_phone: process.env.TRAINER_PHONE ?? "",
    trainer_telegram: process.env.TRAINER_TELEGRAM ?? "@skinline_trainer",
    datetime: "",
  };
}

async function scheduleTgMessageToCandidate(
  candidateId: string,
  text: string,
  stage: string,
  delayMs = 0,
): Promise<void> {
  const runAt = new Date(Date.now() + delayMs).toISOString();
  await storage.createScheduledAction({
    candidateId,
    kind: "tg_message",
    runAt,
    payload: JSON.stringify({ text }),
    status: "pending",
    triggerStage: stage,
  });
}

async function scheduleTgMessageToUser(
  candidateId: string,
  roleKey: string,
  text: string,
  stage: string,
  delayMs = 0,
): Promise<void> {
  const runAt = new Date(Date.now() + delayMs).toISOString();
  await storage.createScheduledAction({
    candidateId,
    kind: "tg_message_to_user",
    runAt,
    payload: JSON.stringify({ roleKey, text }),
    status: "pending",
    triggerStage: stage,
  });
}

async function scheduleTask(
  candidateId: string,
  assigneeId: string,
  title: string,
  description: string,
  stage: string,
  delayMs = 0,
): Promise<void> {
  const runAt = new Date(Date.now() + delayMs).toISOString();
  await storage.createScheduledAction({
    candidateId,
    kind: "create_task",
    runAt,
    payload: JSON.stringify({
      assigneeId,
      title,
      description,
      dueOffsetMs: 0,
    }),
    status: "pending",
    triggerStage: stage,
  });
}

// Send a quiz invite via Telegram inline keyboard — non-blocking
async function sendQuizInviteViaTelegram(
  candidate: Candidate,
  quizId: string,
  quizTitle: string,
  quizDescription: string,
): Promise<void> {
  const tg = getTelegram();
  if (!tg || !candidate.telegramChatId) return;
  try {
    const text = `Для перехода к следующему этапу вам необходимо пройти тест: *${quizTitle}*\n\n${quizDescription}\n\nНажмите кнопку ниже, чтобы начать:`;
    await tg.sendMessage(candidate.telegramChatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "Пройти тест", callback_data: `quiz_start:${quizId}` }]],
      },
    });
  } catch (err) {
    console.error("[engine] sendQuizInviteViaTelegram error:", err);
  }
}

// ============================================================================
// Main stage change handler
// ============================================================================
export async function onStageChange(
  candidate: Candidate,
  fromStage: string | null,
  toStage: string,
  changedBy: string,
): Promise<void> {
  // Record stage event
  await storage.createStageEvent({
    candidateId: candidate.id,
    fromStage: fromStage ?? null,
    toStage,
    changedBy,
    changedAt: new Date().toISOString(),
    meta: null,
  });

  const vars = candidateVars(candidate);

  switch (toStage) {
    // ───────────────────────────────────────────────────────────────────────
    case "form_filled": {
      const text = TPL_FORM_FILLED_CANDIDATE;
      await scheduleTgMessageToCandidate(candidate.id, text, toStage);
      // Immediate AI screening
      await storage.createScheduledAction({
        candidateId: candidate.id,
        kind: "ai_screen",
        runAt: new Date(Date.now() + 5000).toISOString(),
        payload: "{}",
        status: "pending",
        triggerStage: toStage,
      });
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "in_work": {
      const text = renderTemplate(TPL_IN_WORK_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, text, toStage);
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "video_interview": {
      // 2h reminder uses a placeholder datetime — real scheduling handled externally
      const reminderText = renderTemplate(TPL_VIDEO_INTERVIEW_REMINDER, {
        ...vars,
        datetime: "согласованное время",
      });
      await scheduleTgMessageToCandidate(candidate.id, reminderText, toStage, 30 * 60 * 1000);
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "studio_demo": {
      const candidateText = renderTemplate(TPL_STUDIO_DEMO_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);
      const ukText = renderTemplate(TPL_STUDIO_DEMO_UK, vars);
      await scheduleTgMessageToUser(candidate.id, "uk", ukText, toStage, 2 * 60 * 1000);
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "theory": {
      const candidateText = renderTemplate(TPL_THEORY_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);

      // 72h follow-up
      const followupText = renderTemplate(TPL_THEORY_FOLLOWUP_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, followupText, toStage, 72 * 3600 * 1000);

      // 72h+24h escalation to UK
      const escalationText = renderTemplate(TPL_THEORY_ESCALATION_UK, vars);
      await scheduleTgMessageToUser(candidate.id, "uk", escalationText, toStage, 96 * 3600 * 1000);

      // Iter4: Quiz invite — send quiz for 'theory' stage if one exists
      setImmediate(async () => {
        try {
          const quiz = await storage.getQuizByTriggerStage("theory");
          if (quiz && quiz.active) {
            await sendQuizInviteViaTelegram(candidate, quiz.id, quiz.title, quiz.description ?? "");
          }
        } catch (err) {
          console.error("[engine] theory quiz invite error:", err);
        }
      });
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "exam_scheduled": {
      const candidateText = renderTemplate(TPL_EXAM_SCHEDULED_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);

      const trainer1Text = renderTemplate(TPL_EXAM_SCHEDULED_TRAINER1, vars);
      await scheduleTgMessageToUser(candidate.id, "trainer_1", trainer1Text, toStage, 5 * 60 * 1000);

      // 2h exam reminder
      const reminderText = renderTemplate(TPL_EXAM_REMINDER, {
        ...vars,
        datetime: "согласованное время",
      });
      await scheduleTgMessageToCandidate(candidate.id, reminderText, toStage, 2 * 60 * 60 * 1000);
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "reexam": {
      const candidateText = renderTemplate(TPL_REEXAM_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);

      const followupText = renderTemplate(TPL_REEXAM_FOLLOWUP_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, followupText, toStage, 72 * 3600 * 1000);

      const escalationText = renderTemplate(TPL_REEXAM_ESCALATION_UK, vars);
      await scheduleTgMessageToUser(candidate.id, "uk", escalationText, toStage, 96 * 3600 * 1000);
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "trainer_onboarding": {
      const candidateText = renderTemplate(TPL_TRAINER_ONBOARDING_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);

      const trainer2Text = renderTemplate(TPL_TRAINER_ONBOARDING_TRAINER2, vars);
      await scheduleTgMessageToUser(candidate.id, "trainer_2", trainer2Text, toStage, 24 * 3600 * 1000);
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "studio_practice": {
      const candidateText = renderTemplate(TPL_STUDIO_PRACTICE_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);

      const ukText = renderTemplate(TPL_STUDIO_PRACTICE_UK, vars);
      await scheduleTgMessageToUser(candidate.id, "uk", ukText, toStage, 5 * 60 * 1000);

      // Iter4: Request 5 documents from candidate
      setImmediate(async () => {
        try {
          const tg = getTelegram();
          if (tg && candidate.telegramChatId) {
            const docRequestText = `Для допуска к официальному трудоустройству необходимо загрузить следующие документы:\n\n` +
              `1. Паспорт (разворот с фото и страница с пропиской)\n` +
              `2. СНИЛС\n` +
              `3. ИНН\n` +
              `4. Медицинская книжка\n` +
              `5. Диплом или сертификат об образовании\n\n` +
              `Пожалуйста, сфотографируйте каждый документ и отправьте сюда по одному. Мы проверим их и уведомим вас.`;
            await tg.sendMessage(candidate.telegramChatId, docRequestText);
            await storage.createMessage({
              candidateId: candidate.id,
              channel: "telegram_bot",
              direction: "out",
              text: docRequestText,
              isRead: 1,
              deliveryStatus: "delivered",
              meta: JSON.stringify({ purpose: "doc_request", stage: "studio_practice" }),
            });
          }
        } catch (err) {
          console.error("[engine] studio_practice doc request error:", err);
        }
      });
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "scheduled": {
      const candidateText = TPL_SCHEDULED_CANDIDATE;
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);

      // Iter4: Send onboarding message
      setImmediate(async () => {
        try {
          const tg = getTelegram();
          if (!tg || !candidate.telegramChatId) return;

          // Fetch manager contact from CRM users
          const users = await storage.getCrmUsers();
          const manager = users.find((u) => u.roleKey === "manager");
          const managerContact = manager?.telegramUsername
            ? `@${manager.telegramUsername}`
            : (manager?.name ?? "управляющей студии");

          const studioAddress = process.env.STUDIO_ADDRESS ?? "уточните у HR-менеджера";

          const onboardingText = await generateOnboardingMessage(
            candidate,
            studioAddress,
            managerContact,
          );

          await tg.sendMessage(candidate.telegramChatId, onboardingText);
          await storage.createMessage({
            candidateId: candidate.id,
            channel: "telegram_bot",
            direction: "out",
            text: onboardingText,
            isRead: 1,
            deliveryStatus: "delivered",
            meta: JSON.stringify({ purpose: "onboarding", stage: "scheduled" }),
          });
        } catch (err) {
          console.error("[engine] onboarding message error:", err);
        }
      });
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "reserve": {
      const candidateText = renderTemplate(TPL_RESERVE_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "rejected": {
      // Iter4: AI-personalised rejection, fallback to template
      setImmediate(async () => {
        try {
          const tg = getTelegram();
          if (!candidate.telegramChatId) return;

          // Try AI rejection first
          let rejectionText: string | null = null;
          try {
            const msgs = await storage.getMessages(candidate.id);
            const recentMessages = msgs
              .filter((m) => m.direction === "in")
              .slice(-10)
              .map((m) => m.text);
            rejectionText = await generateRejectionMessage(candidate, {
              reason: candidate.rejectReason ?? undefined,
              fromStage: fromStage ?? candidate.stage,
              recentMessages,
            });
          } catch (aiErr) {
            console.warn("[engine] AI rejection failed, using template:", aiErr);
          }

          // Fallback to template
          if (!rejectionText) {
            rejectionText = renderTemplate(TPL_REJECTED_CANDIDATE, vars);
          }

          if (tg) {
            await tg.sendMessage(candidate.telegramChatId, rejectionText);
          }
          await storage.createMessage({
            candidateId: candidate.id,
            channel: "telegram_bot",
            direction: "out",
            text: rejectionText,
            isRead: 1,
            deliveryStatus: tg ? "delivered" : "pending",
            meta: JSON.stringify({ purpose: "rejection", ai: !rejectionText.startsWith("Добрый день") }),
          });
        } catch (err) {
          console.error("[engine] rejection message error:", err);
        }
      });
      break;
    }

    // ───────────────────────────────────────────────────────────────────────
    case "official": {
      const candidateText = renderTemplate(TPL_OFFICIAL_CANDIDATE, vars);
      await scheduleTgMessageToCandidate(candidate.id, candidateText, toStage);
      // ── Iter5: Auto-start probation track ──────────────────────────────────
      setImmediate(async () => {
        try {
          const existingTrack = await storage.getProbationTrackByCandidate(candidate.id);
          if (!existingTrack) {
            const now = new Date();
            const endsAt = new Date(now);
            endsAt.setDate(endsAt.getDate() + 90);
            const track = await storage.createProbationTrack({
              candidateId: candidate.id,
              startedAt: now.toISOString(),
              endsAt: endsAt.toISOString(),
              status: "active",
              managerId: null,
              finalDecisionAt: null,
              finalDecisionBy: null,
              finalDecisionNotes: null,
              score: null,
            });
            // Create first checkpoint day 7
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
            // Issue referral code
            const existingCode = await storage.getReferralCodes({ candidateId: candidate.id });
            if (existingCode.length === 0) {
              const { randomBytes } = await import("node:crypto");
              let code = randomBytes(4).toString("hex").toUpperCase();
              while (await storage.getReferralCodeByCode(code)) {
                code = randomBytes(4).toString("hex").toUpperCase();
              }
              await storage.createReferralCode({
                userId: null,
                candidateId: candidate.id,
                code,
                active: 1,
                bonusAmount: 5000,
              });
            }
            console.log(`[engine] Probation track created for candidate ${candidate.id}`);
          }
        } catch (err) {
          console.error("[engine] Probation auto-start error:", err);
        }
      });
      break;
    }

    case "dismissed": {
      // ── Iter5: Auto-add to reserve_pool if came from video_interview or studio_demo ──
      if (fromStage === "video_interview" || fromStage === "studio_demo") {
        setImmediate(async () => {
          try {
            const existingEntry = await storage.getReservePoolByCandidate(candidate.id);
            if (!existingEntry) {
              const vacancy = await storage.getVacancy(candidate.vacancyId);
              await storage.createReservePoolEntry({
                candidateId: candidate.id,
                reason: candidate.rejectReason ?? "Не прошёл видеоинтервью/студийное демо",
                city: candidate.city,
                role: vacancy?.title ?? null,
                lastContactedAt: null,
                status: "active",
                tags: JSON.stringify([fromStage]),
              });
              console.log(`[engine] Added ${candidate.id} to reserve_pool (from ${fromStage})`);
            }
          } catch (err) {
            console.error("[engine] Reserve pool auto-add error:", err);
          }
        });
      }
      break;
    }

    default:
      console.log(`[engine] No automation for stage: ${toStage}`);
  }

  // Record activity
  await storage.createActivity({
    candidateId: candidate.id,
    type: "stage_change",
    description: `Этап изменён: ${fromStage ?? "—"} → ${toStage} (${changedBy})`,
    meta: JSON.stringify({ fromStage, toStage, changedBy }),
  });
}

// ============================================================================
// AI Screening (Iter2)
// ============================================================================
export async function runAiScreening(candidateId: string): Promise<void> {
  const candidate = await storage.getCandidate(candidateId);
  if (!candidate) return;

  const kb = getKnowledgeBase();

  const systemPrompt = `Ты опытный HR-специалист сети студий лазерной эпиляции Skin Line.
Твоя задача: оценить кандидата и вынести вердикт: take (брать), reserve (в резерв), reject (отказать).
${kb ? `\n\nБаза знаний:\n${kb}` : ""}`;

  const userContent = `Кандидат: ${candidate.fullName}
Город: ${candidate.city}
Телефон: ${candidate.phone}
Опыт: ${candidate.experience ?? "не указан"}
Ожидаемая ЗП: ${candidate.expectedSalary ?? "не указана"}
Источник: ${candidate.source}
Этап: ${candidate.stage}
Заметки: ${candidate.notes ?? "нет"}
Теги: ${candidate.tags ?? "нет"}

Вынеси вердикт в формате JSON:
{
  "verdict": "take|reserve|reject",
  "score": 0-100,
  "reasoning": "обоснование на русском"
}`;

  const raw = await chatCompletion({
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    maxTokens: 512,
    temperature: 0.3,
    jsonMode: true,
    purpose: "screening",
    candidateId,
  });

  if (!raw) {
    console.warn("[engine] AI screening returned null for candidate", candidateId);
    return;
  }

  try {
    const parsed = JSON.parse(raw) as { verdict?: string; score?: number; reasoning?: string };
    const verdict = parsed.verdict ?? "pending";
    const score = typeof parsed.score === "number" ? parsed.score : null;
    const reasoning = parsed.reasoning ?? null;

    await storage.updateCandidate(candidateId, {
      aiVerdict: verdict as "take" | "reserve" | "reject" | "pending",
      aiScore: score,
      aiReasoning: reasoning,
    });

    await storage.createActivity({
      candidateId,
      type: "stage_change",
      description: `AI-скрининг: вердикт "${verdict}", балл ${score ?? "—"}`,
      meta: JSON.stringify({ verdict, score, reasoning }),
    });
  } catch (err) {
    console.error("[engine] Failed to parse AI screening result:", err);
  }
}

// ============================================================================
// Predictive Score (Iter2)
// ============================================================================
export async function runPredictiveScore(candidateId: string): Promise<void> {
  const candidate = await storage.getCandidate(candidateId);
  if (!candidate) return;

  // Simple heuristic: combine ai score + fake score signals
  const aiScore = candidate.aiScore ?? 50;
  const fakeScore = candidate.fakeScore ?? 0;
  const hasEmail = candidate.email ? 5 : 0;
  const hasExperience = candidate.experience && candidate.experience !== "нет" ? 10 : 0;
  const salaryReasonable =
    candidate.expectedSalary && parseInt(candidate.expectedSalary, 10) < 100000 ? 5 : 0;

  const raw = (aiScore * 0.7) + (fakeScore * -0.3) + hasEmail + hasExperience + salaryReasonable;
  const predictiveScore = Math.max(0, Math.min(100, Math.round(raw)));

  const factors: string[] = [];
  if (aiScore >= 70) factors.push("Высокий AI-балл");
  if (fakeScore > 50) factors.push("Риск фейка");
  if (hasEmail) factors.push("Указан email");
  if (hasExperience) factors.push("Есть опыт");

  await storage.updateCandidate(candidateId, {
    predictiveScore,
    predictiveFactors: JSON.stringify(factors),
  });
}


