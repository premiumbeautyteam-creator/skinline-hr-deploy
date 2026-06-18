// Reserve cron — runs daily, reactivates stale reserve_pool candidates
// Uses Claude Sonnet 4 to generate personalized messages
// Sends via Telegram bot if candidate has telegram_link

import { storage } from "../storage.js";
import { getTelegram } from "../integrations/telegram.js";
import { chatCompletion } from "./ai.js";

const STALE_DAYS = 30;

export async function runReserveCron(): Promise<void> {
  try {
    // Get stale active entries (not contacted in 30+ days)
    const staleEntries = await storage.getStaleReserveEntries(STALE_DAYS);
    if (staleEntries.length === 0) {
      console.log("[reserve_cron] No stale reserve entries to process.");
      return;
    }

    // Get active vacancies for matching
    const allVacancies = await storage.getVacancies();
    const activeVacancies = allVacancies.filter((v) => v.status === "active");

    const tg = getTelegram();

    for (const entry of staleEntries) {
      // Find matching open vacancy by city+role
      const matchingVacancy = activeVacancies.find(
        (v) =>
          (!entry.city || v.city.toLowerCase().includes(entry.city.toLowerCase())) &&
          (!entry.role || v.title.toLowerCase().includes(entry.role.toLowerCase()))
      );

      if (!matchingVacancy) continue;

      const candidate = await storage.getCandidate(entry.candidateId);
      if (!candidate) continue;

      // Generate AI reactivation message
      const systemPrompt = `Ты HR-рекрутер Skin Line, сети спа-салонов лазерной эпиляции. Напиши тёплое персональное сообщение на 4-6 предложений кандидату ${candidate.fullName} из города ${entry.city ?? candidate.city}, который ранее проходил собеседование на роль ${entry.role ?? "мастера лазерной эпиляции"}, но не подошёл по причине ${entry.reason ?? "обстоятельств"}. Сейчас открылась вакансия. Не упоминай прошлый отказ напрямую. Призыв к действию: написать в бот.`;

      let messageText: string;
      try {
        const aiResult = await chatCompletion({
          model: "anthropic/claude-sonnet-4",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: "Напиши реактивационное сообщение." },
          ],
          maxTokens: 300,
          temperature: 0.7,
          purpose: "reserve_reactivation",
          candidateId: candidate.id,
        });
        messageText = aiResult ?? `Привет, ${candidate.fullName}! В Skin Line снова открылась вакансия мастера в вашем городе. Мы помним о вас и будем рады рассмотреть вашу кандидатуру снова. Напишите нам в бот, чтобы узнать подробности!`;
      } catch (err) {
        console.error(`[reserve_cron] AI error for ${candidate.id}:`, err);
        messageText = `Привет, ${candidate.fullName}! В Skin Line открылась новая вакансия в вашем городе. Будем рады снова рассмотреть вашу кандидатуру!`;
      }

      // Send via Telegram if possible
      let sent = false;
      if (candidate.telegramChatId && tg) {
        const result = await tg.sendMessage(candidate.telegramChatId, messageText);
        if (result.ok) {
          sent = true;
          console.log(`[reserve_cron] Sent reactivation message to ${candidate.fullName} via Telegram`);
        }
      }

      // Update lastContactedAt
      await storage.updateReservePoolEntry(entry.id, {
        lastContactedAt: new Date().toISOString(),
        status: "reactivated",
      });

      // Save to messages for outbox
      await storage.createMessage({
        candidateId: candidate.id,
        channel: "telegram_bot",
        direction: "out",
        text: messageText,
        isRead: 1,
        deliveryStatus: sent ? "delivered" : "pending",
        meta: JSON.stringify({ ai: true, purpose: "reserve_reactivation", reservePoolId: entry.id }),
      });
    }

    console.log(`[reserve_cron] Processed ${staleEntries.length} stale reserve entries.`);
  } catch (err) {
    console.error("[reserve_cron] Error:", err);
  }
}

export function startReserveCron(): NodeJS.Timeout {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function msUntilNext10UTC(): number {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(10, 0, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - now.getTime();
  }

  let timer: NodeJS.Timeout;

  function schedule() {
    const delay = msUntilNext10UTC();
    timer = setTimeout(() => {
      runReserveCron().catch((e) => console.error("[reserve_cron] Error:", e));
      setInterval(() => {
        runReserveCron().catch((e) => console.error("[reserve_cron] Error:", e));
      }, MS_PER_DAY);
    }, delay);
  }

  schedule();
  return timer!;
}
