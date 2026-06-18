// AI-персонализация отказов — Iter4
// Generates a warm, personalized rejection message for a candidate.

import { chatCompletion } from "./ai.js";
import { getKnowledgeBase } from "./ai.js";
import type { Candidate } from "@shared/schema";

const MODEL_REJECTION = "openai/gpt-4o-mini";

const CITIES_SKIN_LINE = [
  "Чебоксары", "Йошкар-Ола", "Казань", "Воронеж", "Липецк",
  "Киров", "Курск", "Набережные Челны", "Новочебоксарск", "Сургут",
];

function buildSystemPrompt(): string {
  return `Ты HR-специалист сети студий лазерной эпиляции Skin Line. 
Пишешь персонализированное сообщение отказа кандидату в мессенджер (Telegram).
Тон: тёплый, человечный, без шаблонщины. Максимум 200 слов.
Правила:
- Поблагодари за интерес и время
- Если причина — город не в списке наших городов (${CITIES_SKIN_LINE.join(", ")}): скажи что работаем только в этих городах, если рассмотрит переезд — пусть напишет
- Если причина — не сдал самотест/экзамен: скажи что теоретическая база требует укрепления, можно вернуться через 3 месяца
- Если причина — после демо/собеседования: мягко скажи что "пришли к выводу что нам не по пути, это не умаляет твоих качеств"
- Всегда: предложи оставаться в резерве, упомяни что можем связаться через 3–6 месяцев при открытии новых вакансий
- Не используй шаблонные фразы типа "К сожалению..." в начале
- Обращайся по имени (первое имя из ФИО)
- Ссылка на канал: t.me/SkinLineHR`;
}

export interface RejectionContext {
  reason?: string;
  fromStage?: string;
  recentMessages?: string[];
}

/**
 * Generate a personalized rejection message for a candidate.
 * Returns the message text, or null if AI unavailable.
 */
export async function generateRejectionMessage(
  candidate: Candidate,
  context: RejectionContext
): Promise<string | null> {
  const firstName = candidate.fullName.split(" ")[0] ?? candidate.fullName;
  const reason = context.reason ?? candidate.rejectReason ?? "не указана";
  const fromStage = context.fromStage ?? candidate.stage;
  const history = (context.recentMessages ?? []).slice(-10).join("\n");

  const userContent = `Кандидат: ${candidate.fullName} (обращение: ${firstName})
Город: ${candidate.city}
Этап, с которого отказываем: ${fromStage}
Причина отказа: ${reason}
Последние сообщения кандидата (если есть):
${history || "(нет)"}

Напиши тёплое персонализированное сообщение отказа для отправки в Telegram.`;

  const text = await chatCompletion({
    model: MODEL_REJECTION,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: userContent },
    ],
    maxTokens: 512,
    temperature: 0.7,
    purpose: "rejection",
    candidateId: candidate.id,
  });

  return text?.trim() ?? null;
}

/** Generate onboarding message for candidate who reached 'scheduled' stage */
export async function generateOnboardingMessage(
  candidate: Candidate,
  studioAddress: string,
  managerContact: string,
  firstDay?: string
): Promise<string> {
  const firstName = candidate.fullName.split(" ")[0] ?? candidate.fullName;
  const dayStr = firstDay ?? "уточните у HR-менеджера";

  return `🎉 ${firstName}, поздравляем! Вы успешно прошли все этапы и выходите в график!

📅 Ваш первый рабочий день: ${dayStr}

📋 Что взять с собой:
• Паспорт
• СНИЛС
• ИНН
• Медицинская книжка
• Удобная одежда (дресс-код уточнит управляющая)

📍 Адрес студии: ${studioAddress}

👤 Контакт управляющей: ${managerContact}

📢 Наш HR-канал: t.me/SkinLineHR — там вы найдёте полезную информацию о работе и жизни команды.

Будем рады видеть вас в команде Skin Line! Если есть вопросы — пишите 🌸`;
}
