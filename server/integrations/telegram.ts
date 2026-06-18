// Telegram Bot HTTP API client (no external libraries, pure fetch)

const TG_API_BASE = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function getBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? "skinline_recruitment_bot";
}

export class TelegramClient {
  private base: string;

  constructor(private token: string) {
    this.base = `${TG_API_BASE}/bot${token}`;
  }

  async sendMessage(
    chatId: string,
    text: string,
    opts?: { parse_mode?: "HTML" | "Markdown"; reply_markup?: unknown },
  ): Promise<{ ok: boolean; message_id?: number }> {
    try {
      const body: Record<string, unknown> = { chat_id: chatId, text };
      if (opts?.parse_mode) body.parse_mode = opts.parse_mode;
      if (opts?.reply_markup) body.reply_markup = opts.reply_markup;

      const res = await fetch(`${this.base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; result?: { message_id: number } };
      if (!json.ok) {
        console.warn("[telegram] sendMessage failed:", JSON.stringify(json));
      }
      return { ok: json.ok, message_id: json.result?.message_id };
    } catch (err) {
      console.error("[telegram] sendMessage error:", err);
      return { ok: false };
    }
  }

  async getMe(): Promise<{ username: string; id: number }> {
    const res = await fetch(`${this.base}/getMe`);
    const json = (await res.json()) as { ok: boolean; result?: { username: string; id: number } };
    if (!json.ok || !json.result) throw new Error("Telegram getMe failed");
    return json.result;
  }

  async setWebhook(url: string): Promise<void> {
    const res = await fetch(`${this.base}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) throw new Error(`setWebhook failed: ${json.description ?? "unknown"}`);
  }

  async getFile(fileId: string): Promise<{ file_id: string; file_path?: string } | null> {
    try {
      const res = await fetch(`${this.base}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const json = (await res.json()) as { ok: boolean; result?: { file_id: string; file_path?: string } };
      if (!json.ok || !json.result) return null;
      return json.result;
    } catch (err) {
      console.error("[telegram] getFile error:", err);
      return null;
    }
  }

  // ── Iter3: Channel methods ────────────────────────────────────────────

  /** Send a text message to a channel. Returns messageId on success. */
  async sendChannelMessage(
    chatId: string,
    text: string,
    opts?: { parseMode?: "HTML" | "MarkdownV2" },
  ): Promise<{ ok: boolean; messageId?: number; error?: string }> {
    const maxRetries = 3;
    let lastErr = "";
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
      try {
        const body: Record<string, unknown> = { chat_id: chatId, text };
        if (opts?.parseMode) body.parse_mode = opts.parseMode;
        const res = await fetch(`${this.base}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
        if (json.ok) return { ok: true, messageId: json.result?.message_id };
        // If bot is not admin, don't retry
        if (json.description?.includes("not enough rights") || json.description?.includes("CHAT_WRITE_FORBIDDEN")) {
          return { ok: false, error: `Бот не является админом канала: ${json.description ?? "unknown"}` };
        }
        lastErr = json.description ?? "unknown";
      } catch (err) {
        lastErr = String(err);
        console.error(`[telegram] sendChannelMessage attempt ${attempt + 1} error:`, err);
      }
    }
    return { ok: false, error: lastErr };
  }

  /** Send a poll to a channel. Returns messageId on success. */
  async sendChannelPoll(
    chatId: string,
    question: string,
    options: string[],
    anonymous = true,
  ): Promise<{ ok: boolean; messageId?: number; error?: string }> {
    const maxRetries = 3;
    let lastErr = "";
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
      try {
        const body = { chat_id: chatId, question, options, is_anonymous: anonymous };
        const res = await fetch(`${this.base}/sendPoll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
        if (json.ok) return { ok: true, messageId: json.result?.message_id };
        lastErr = json.description ?? "unknown";
      } catch (err) {
        lastErr = String(err);
        console.error(`[telegram] sendChannelPoll attempt ${attempt + 1} error:`, err);
      }
    }
    return { ok: false, error: lastErr };
  }

  // ── Iter4: Callback query answer ───────────────────────────────────────

  /** Answer a callback query — MUST be called on every callback_query to clear loading state. */
  async answerCallbackQuery(
    callbackQueryId: string,
    opts?: { text?: string; show_alert?: boolean },
  ): Promise<void> {
    try {
      const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
      if (opts?.text) body.text = opts.text;
      if (opts?.show_alert !== undefined) body.show_alert = opts.show_alert;
      const res = await fetch(`${this.base}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean };
      if (!json.ok) {
        console.warn("[telegram] answerCallbackQuery failed:", JSON.stringify(json));
      }
    } catch (err) {
      console.error("[telegram] answerCallbackQuery error:", err);
    }
  }

  /** Get basic info about a chat (channel). */
  async getChat(chatId: string): Promise<{ id: number; title?: string; username?: string; membersCount?: number } | null> {
    try {
      const res = await fetch(`${this.base}/getChat?chat_id=${encodeURIComponent(chatId)}`);
      const json = (await res.json()) as {
        ok: boolean;
        result?: { id: number; title?: string; username?: string; members_count?: number };
      };
      if (!json.ok || !json.result) return null;
      return {
        id: json.result.id,
        title: json.result.title,
        username: json.result.username,
        membersCount: json.result.members_count,
      };
    } catch (err) {
      console.error("[telegram] getChat error:", err);
      return null;
    }
  }
}

let _instance: TelegramClient | null = null;

export function getTelegram(): TelegramClient | null {
  if (!telegramConfigured()) return null;
  if (!_instance) {
    _instance = new TelegramClient(process.env.TELEGRAM_BOT_TOKEN!);
  }
  return _instance;
}
