// Avito API client (Messenger + Job).
//
// Uses client_credentials OAuth2 flow — no per-user authorization needed.
// Tokens last 24h and are refreshed automatically on 401 or expiration.
//
// API reference: https://developers.avito.ru/api-catalog/messenger/documentation

import type { Integration } from "@shared/schema";
import { storage } from "../storage";
import { encrypt, tryDecrypt } from "../lib/crypto";

const API_BASE = "https://api.avito.ru";
const OAUTH_TOKEN = `${API_BASE}/token`;

const REQUIRED_SCOPES = [
  "messenger:read",
  "messenger:write",
  "job:applications",
  "job:cv",
  "user:read",
  "user_balance:read",
];

export interface AvitoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface AvitoSelf {
  id: number;
  name: string;
  email: string;
  phone: string;
  phones: string[];
  profile_url: string;
}

export interface AvitoChat {
  id: string;
  created: number;
  updated: number;
  context: {
    type: string;
    value?: any;
  };
  last_message?: {
    id: string;
    author_id: number;
    created: number;
    direction: "in" | "out";
    type: string;
    content?: { text?: string };
    is_read?: boolean;
  };
  users: Array<{ id: number; name: string; public_user_profile?: any }>;
}

export interface AvitoMessage {
  id: string;
  author_id: number;
  created: number;
  direction: "in" | "out";
  type: "text" | "image" | "system" | "deleted" | string;
  content?: {
    text?: string;
    image?: { sizes?: Record<string, string> };
  };
  is_read?: boolean;
}

export class AvitoApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Avito API error ${status}: ${body}`);
    this.name = "AvitoApiError";
    this.status = status;
    this.body = body;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var ${name}`);
  return v.trim();
}

export function avitoEnvConfigured(): boolean {
  return Boolean(process.env.AVITO_CLIENT_ID && process.env.AVITO_CLIENT_SECRET);
}

export class AvitoClient {
  private integration: Integration | null;
  private accessToken: string | null;
  private tokenExpiresAt: Date | null;

  constructor(integration?: Integration | null) {
    this.integration = integration ?? null;
    this.accessToken = integration ? tryDecrypt(integration.accessToken) : null;
    this.tokenExpiresAt = integration?.tokenExpiresAt
      ? new Date(integration.tokenExpiresAt)
      : null;
  }

  /** Get (or refresh) the access token. */
  async getToken(): Promise<string> {
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      this.tokenExpiresAt.getTime() > Date.now() + 60_000 // 1-min buffer
    ) {
      return this.accessToken;
    }
    return this.refreshToken();
  }

  /** Force-refresh the token via client_credentials. */
  async refreshToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requireEnv("AVITO_CLIENT_ID"),
      client_secret: requireEnv("AVITO_CLIENT_SECRET"),
      scope: REQUIRED_SCOPES.join(","),
    });
    const res = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new AvitoApiError(res.status, text, `OAuth token failed: ${res.status}`);
    }
    const data = JSON.parse(text) as AvitoTokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);

    // persist to integration row if we have one
    if (this.integration) {
      await storage.updateIntegration(this.integration.id, {
        accessToken: encrypt(this.accessToken),
        tokenExpiresAt: this.tokenExpiresAt.toISOString(),
        status: "connected",
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
    }
    return this.accessToken;
  }

  /** Authenticated request to the Avito API with automatic token refresh on 401. */
  private async request<T>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: any;
      retried?: boolean;
    } = {},
  ): Promise<T> {
    const token = await this.getToken();
    const url = new URL(`${API_BASE}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    };
    const res = await fetch(url.toString(), init);
    const text = await res.text();

    if (res.status === 401 && !options.retried) {
      this.accessToken = null;
      return this.request<T>(method, path, { ...options, retried: true });
    }
    if (!res.ok) {
      throw new AvitoApiError(res.status, text);
    }
    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  }

  // ---------- Account ----------
  getSelf(): Promise<AvitoSelf> {
    return this.request<AvitoSelf>("GET", "/core/v1/accounts/self");
  }

  // ---------- Messenger ----------
  async getChats(opts: {
    userId: number;
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
    chatTypes?: string[];
  }): Promise<{ chats: AvitoChat[] }> {
    const query: Record<string, string> = {};
    if (opts.limit) query.limit = String(opts.limit);
    if (opts.offset) query.offset = String(opts.offset);
    if (opts.unreadOnly) query.unread_only = "true";
    if (opts.chatTypes) query.chat_types = opts.chatTypes.join(",");
    return this.request("GET", `/messenger/v2/accounts/${opts.userId}/chats`, {
      query,
    });
  }

  getMessages(opts: {
    userId: number;
    chatId: string;
    limit?: number;
    offset?: number;
  }): Promise<{ messages: AvitoMessage[] }> {
    return this.request(
      "GET",
      `/messenger/v3/accounts/${opts.userId}/chats/${opts.chatId}/messages/`,
      {
        query: {
          limit: opts.limit ?? 100,
          offset: opts.offset ?? 0,
        },
      },
    );
  }

  sendMessage(opts: {
    userId: number;
    chatId: string;
    text: string;
  }): Promise<AvitoMessage> {
    return this.request(
      "POST",
      `/messenger/v1/accounts/${opts.userId}/chats/${opts.chatId}/messages`,
      {
        body: { message: { text: opts.text }, type: "text" },
      },
    );
  }

  markChatRead(opts: { userId: number; chatId: string }): Promise<{ ok: boolean }> {
    return this.request(
      "POST",
      `/messenger/v1/accounts/${opts.userId}/chats/${opts.chatId}/read`,
      {},
    );
  }

  subscribeWebhook(url: string): Promise<{ ok: boolean }> {
    return this.request("POST", "/messenger/v3/webhook", {
      body: { url },
    });
  }

  unsubscribeWebhook(url: string): Promise<{ ok: boolean }> {
    return this.request("POST", "/messenger/v1/webhook/unsubscribe", {
      body: { url },
    });
  }

  listSubscriptions(): Promise<{ subscriptions: Array<{ url: string; version: string }> }> {
    return this.request("POST", "/messenger/v1/subscriptions", {});
  }

  // ---------- Job ----------
  getApplicationIds(opts: { offset?: number; limit?: number; updatedAtFrom?: string } = {}): Promise<{
    applies: Array<{ id: string; vacancy_id?: string; created?: string }>;
  }> {
    return this.request("GET", "/job/v1/applications/get_ids", {
      query: {
        offset: opts.offset,
        limit: opts.limit,
        updatedAtFrom: opts.updatedAtFrom,
      },
    });
  }

  getApplicationsByIds(ids: string[]): Promise<{ applies: any[] }> {
    return this.request("POST", "/job/v1/applications/get_by_ids", {
      body: { ids },
    });
  }

  // ---------- Items (ads) ----------
  // GET /core/v1/items?status=active&per_page=100 with pagination
  async getItems(opts: {
    status?: 'active' | 'old' | 'removed' | 'blocked';
    page?: number;
    perPage?: number;
  } = {}): Promise<{
    items: Array<{
      id: number;
      title: string;
      status: string;
      url: string;
      price?: number;
      address?: string;
      category?: { id: number; name: string };
    }>;
    meta?: { page: number; per_page: number };
  }> {
    return this.request("GET", `/core/v1/items`, {
      query: {
        status: opts.status ?? 'active',
        page: opts.page ?? 1,
        per_page: opts.perPage ?? 100,
      },
    });
  }

  // GET /core/v1/accounts/{user_id}/items/{item_id}/ - item details
  async getItem(itemId: number): Promise<any> {
    const userId = process.env.AVITO_USER_ID;
    if (!userId) throw new Error('AVITO_USER_ID not configured');
    return this.request("GET", `/core/v1/accounts/${userId}/items/${itemId}/`);
  }
}
