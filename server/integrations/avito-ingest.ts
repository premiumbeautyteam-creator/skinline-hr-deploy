// Avito ingestion pipeline.
//
// Turns Avito messenger webhook events and Job applications into internal
// candidates, messages and activities. Idempotent: re-ingesting the same
// message or chat never creates duplicates.

import { storage } from "../storage";
import { AvitoClient } from "./avito";
import { findVacancyByAvitoItemId } from "./avito-vacancies";
import type { Candidate, Message } from "@shared/schema";
import { randomUUID } from "crypto";

const SOURCE = "avito";

export interface AvitoWebhookEvent {
  id: string;
  payload: {
    type: string;
    value: {
      author_id: number;
      chat_id: string;
      chat_type: string;
      content: {
        id: string;
        item_id?: number;
        type: string;
        text?: string;
        published_at?: string;
        read?: number;
        user_id?: number;
        flow_id?: string;
      };
    };
  };
  timestamp: number;
  version: string;
}

/** Resolve (or create) the integration row for Avito. */
async function getOrCreateIntegration() {
  let integ = await storage.getIntegration(SOURCE);
  if (!integ) {
    integ = await storage.upsertIntegration(SOURCE, {
      source: SOURCE,
      status: "connected",
      accountId: process.env.AVITO_USER_ID || null,
      accountName: "Avito (client_credentials)",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      lastSyncAt: null,
      lastError: null,
      meta: null,
    } as any);
  }
  return integ;
}

/** Resolve (or create) candidate from Avito chat — keyed by chat_id. */
async function resolveCandidate(
  client: AvitoClient,
  ownerUserId: number,
  chatId: string,
  authorId: number,
  itemId?: number,
): Promise<Candidate> {
  // Look up by external_ref (source=avito, external_type=chat, external_id=chatId)
  const ref = await storage.getExternalRef(SOURCE, "chat", chatId);
  if (ref) {
    const existing = await storage.getCandidate(ref.entityId);
    if (existing) return existing;
  }

  // Try to get chat metadata for the candidate's display name.
  let candidateName = "Кандидат с Avito";
  let candidatePhone: string | null = null;
  try {
    const chats = await client.getChats({ userId: ownerUserId, limit: 100 });
    const chat = chats.chats.find((c) => c.id === chatId);
    if (chat) {
      const other = chat.users.find((u) => u.id !== ownerUserId);
      if (other?.name) candidateName = other.name;
    }
  } catch {
    /* ignore */
  }

  // Find vacancy: first try real imported Avito ad, then any active vacancy, then create stub
  let vacancyId: string | null = null;
  if (itemId) {
    vacancyId = await findVacancyByAvitoItemId(itemId);
  }
  if (!vacancyId) {
    // Fallback to any active vacancy
    const vacancies = await storage.getVacancies();
    vacancyId = vacancies.find((v) => v.status === 'active')?.id ?? vacancies[0]?.id ?? null;
  }
  if (!vacancyId) {
    // Last resort: create a stub vacancy
    const stub = await storage.createVacancy({
      title: itemId ? `Avito объявление #${itemId}` : 'Avito (без объявления)',
      description: 'Автосозданная заглушка',
      city: 'Не определён',
      salary: '',
      externalUrl: itemId ? `https://www.avito.ru/${itemId}` : null,
      status: 'active',
    });
    vacancyId = stub.id;
  }

  // Create the candidate
  const candidate = await storage.createCandidate({
    fullName: candidateName,
    phone: candidatePhone || "",
    email: "",
    city: "",
    stage: "response",
    source: SOURCE,
    vacancyId,
    notes: `Чат Avito: ${chatId}${itemId ? `\nОбъявление: ${itemId}` : ""}`,
    avatarUrl: null,
    rating: 0,
  } as any);

  await storage.createExternalRef({
    entityType: "candidate",
    entityId: candidate.id,
    source: SOURCE,
    externalId: chatId,
    externalType: "chat",
    meta: JSON.stringify({ item_id: itemId, author_id: authorId }),
  });

  return candidate;
}

/** Process a single Avito webhook payload. Idempotent. */
export async function processAvitoWebhook(
  event: AvitoWebhookEvent,
): Promise<{ candidateId?: string; messageId?: string; skipped?: boolean }> {
  const integ = await getOrCreateIntegration();
  const ownerUserId = parseInt(
    integ.accountId || process.env.AVITO_USER_ID || "0",
    10,
  );
  if (!ownerUserId) {
    throw new Error("Avito user_id not configured");
  }

  const value = event.payload?.value;
  if (!value) return { skipped: true };

  // Skip outbound (own) messages
  if (value.author_id === ownerUserId) return { skipped: true };

  // Skip system/deleted messages
  if (value.content.type === "deleted") return { skipped: true };

  // Dedupe by message external_id
  const existingMsg = await storage.getMessageByExternal(SOURCE, value.content.id);
  if (existingMsg) return { messageId: existingMsg.id, skipped: true };

  const client = new AvitoClient(integ);
  const candidate = await resolveCandidate(
    client,
    ownerUserId,
    value.chat_id,
    value.author_id,
    value.content.item_id,
  );

  const text = value.content.text || "[вложение]";
  const sentAt = value.content.published_at
    ? new Date(value.content.published_at).toISOString()
    : new Date(event.timestamp * 1000).toISOString();

  const message = await storage.createMessageAt(
    {
      candidateId: candidate.id,
      sender: "candidate",
      body: text,
      channel: SOURCE,
      meta: JSON.stringify({
        chat_id: value.chat_id,
        message_id: value.content.id,
        item_id: value.content.item_id,
      }),
    } as any,
    sentAt,
  );

  await storage.createExternalRef({
    entityType: "message",
    entityId: message.id,
    source: SOURCE,
    externalId: value.content.id,
    externalType: "message",
    meta: JSON.stringify({ chat_id: value.chat_id }),
  });

  // Mark chat as read in Avito
  client
    .markChatRead({ userId: ownerUserId, chatId: value.chat_id })
    .catch(() => undefined);

  // Touch integration lastSyncAt
  await storage.updateIntegration(integ.id, {
    lastSyncAt: new Date().toISOString(),
    status: "connected",
    updatedAt: new Date().toISOString(),
  });

  return { candidateId: candidate.id, messageId: message.id };
}

/** Send a message via Avito Messenger from our CRM. Used by /reply endpoint. */
export async function sendAvitoReply(opts: {
  chatId: string;
  text: string;
}): Promise<{ ok: boolean; messageId?: string }> {
  const integ = await getOrCreateIntegration();
  const client = new AvitoClient(integ);
  const userId = parseInt(integ.accountId || process.env.AVITO_USER_ID || "0", 10);
  if (!userId) throw new Error("Avito user_id not configured");

  const result = await client.sendMessage({
    userId,
    chatId: opts.chatId,
    text: opts.text,
  });

  // Save outgoing message locally
  const ref = await storage.getExternalRef(SOURCE, "chat", opts.chatId);
  if (ref) {
    await storage.createMessage({
      candidateId: ref.entityId,
      sender: "manager",
      body: opts.text,
      channel: SOURCE,
      meta: JSON.stringify({ chat_id: opts.chatId, message_id: result.id }),
    } as any);
  }

  return { ok: true, messageId: result.id };
}

/** Bulk-poll: fetch all unread chats and ingest their last messages. */
export async function pollAvitoUnread(limit = 50): Promise<{
  chatsProcessed: number;
  messagesIngested: number;
}> {
  const integ = await getOrCreateIntegration();
  const client = new AvitoClient(integ);
  const userId = parseInt(integ.accountId || process.env.AVITO_USER_ID || "0", 10);
  if (!userId) throw new Error("Avito user_id not configured");

  const { chats } = await client.getChats({
    userId,
    limit,
    unreadOnly: true,
  });

  let messagesIngested = 0;
  for (const chat of chats) {
    if (!chat.last_message || chat.last_message.direction !== "in") continue;
    try {
      await processAvitoWebhook({
        id: chat.last_message.id,
        payload: {
          type: "message",
          value: {
            author_id: chat.last_message.author_id,
            chat_id: chat.id,
            chat_type: chat.context?.type || "u2i",
            content: {
              id: chat.last_message.id,
              type: chat.last_message.type,
              text: chat.last_message.content?.text,
              user_id: chat.last_message.author_id,
              published_at: new Date(chat.last_message.created * 1000).toISOString(),
            },
          },
        },
        timestamp: chat.last_message.created,
        version: "poll",
      });
      messagesIngested++;
    } catch (err) {
      console.error("[avito-ingest] poll error for chat", chat.id, err);
    }
  }

  return { chatsProcessed: chats.length, messagesIngested };
}
