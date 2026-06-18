// hh.ru API client.
//
// Wraps OAuth token exchange/refresh and authenticated REST calls against
// https://api.hh.ru. The client is constructed from a persisted `integration`
// row and transparently refreshes the access token when it is expired or the
// API replies with a "token_expired" 403. Refresh tokens on hh.ru are
// single-use: each refresh returns a brand new access/refresh pair, so we
// persist both back to the DB immediately.
//
// API reference: https://github.com/hhru/api / https://api.hh.ru/openapi/

import type { Integration } from "@shared/schema";
import { storage } from "../storage";
import { encrypt, tryDecrypt } from "../lib/crypto";

const API_BASE = "https://api.hh.ru";
const OAUTH_AUTHORIZE = "https://hh.ru/oauth/authorize";
const OAUTH_TOKEN = "https://hh.ru/oauth/token";

// hh.ru requires a descriptive HH-User-Agent with a contact email.
const HH_USER_AGENT = "SkinLineCRM/1.0 (premium.beauty.team@gmail.com)";

// hh.ru rejects any list endpoint with HTTP 400 ("per_page can't be more than
// 50") when per_page exceeds 50. Clamp every paginated request to this ceiling;
// pagination still walks page++ until the API reports no more pages.
const HH_MAX_PER_PAGE = 50;
function clampPerPage(perPage: number | undefined, fallback = HH_MAX_PER_PAGE): number {
  const n = Number.isFinite(perPage) ? Number(perPage) : fallback;
  return Math.min(Math.max(1, Math.trunc(n)), HH_MAX_PER_PAGE);
}

export interface HhTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type?: string;
}

export interface HhMe {
  id?: string;
  employer?: { id?: string; name?: string };
  manager?: { id?: string };
  // hh /me returns first_name/last_name for the manager account
  first_name?: string;
  last_name?: string;
  email?: string;
}

export class HhApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `hh.ru API error ${status}: ${body}`);
    this.name = "HhApiError";
    this.status = status;
    this.body = body;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var ${name}`);
  }
  return v.trim();
}

export function hhEnvConfigured(): boolean {
  return Boolean(
    process.env.HH_CLIENT_ID &&
      process.env.HH_CLIENT_SECRET &&
      process.env.HH_REDIRECT_URI,
  );
}

export class HhClient {
  private integration: Integration | null;
  // Decrypted in-memory access token (kept out of logs/responses).
  private accessToken: string | null;
  private refreshToken: string | null;

  constructor(integration?: Integration | null) {
    this.integration = integration ?? null;
    this.accessToken = integration ? tryDecrypt(integration.accessToken) : null;
    this.refreshToken = integration ? tryDecrypt(integration.refreshToken) : null;
  }

  /** Build the hh.ru OAuth authorize URL for the connect flow. */
  getAuthorizeUrl(state: string): string {
    const clientId = requireEnv("HH_CLIENT_ID");
    const redirectUri = requireEnv("HH_REDIRECT_URI");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
    return `${OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  /** Exchange an authorization code for tokens (grant_type=authorization_code). */
  async exchangeCode(code: string): Promise<HhTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: requireEnv("HH_CLIENT_ID"),
      client_secret: requireEnv("HH_CLIENT_SECRET"),
      redirect_uri: requireEnv("HH_REDIRECT_URI"),
      code,
    });
    return this.postToken(body);
  }

  private async postToken(body: URLSearchParams): Promise<HhTokenResponse> {
    const res = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "HH-User-Agent": HH_USER_AGENT,
        "User-Agent": HH_USER_AGENT,
      },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HhApiError(res.status, text, `Token endpoint failed: ${res.status}`);
    }
    return JSON.parse(text) as HhTokenResponse;
  }

  /**
   * Refresh the access token using the stored single-use refresh token and
   * persist the new pair back to the integration row. Updates in-memory state.
   */
  async refresh(): Promise<void> {
    if (!this.integration) throw new Error("Cannot refresh without an integration record");
    if (!this.refreshToken) throw new Error("No refresh token available");

    await storage.updateIntegration(this.integration.id, { status: "refreshing" });

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requireEnv("HH_CLIENT_ID"),
      client_secret: requireEnv("HH_CLIENT_SECRET"),
      refresh_token: this.refreshToken,
    });

    try {
      const tokens = await this.postToken(body);
      this.accessToken = tokens.access_token;
      this.refreshToken = tokens.refresh_token;
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      const updated = await storage.updateIntegration(this.integration.id, {
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAt,
        status: "connected",
        lastError: null,
      });
      if (updated) this.integration = updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await storage.updateIntegration(this.integration.id, {
        status: "error",
        lastError: `Не удалось обновить токен hh.ru: ${msg}`,
      });
      throw err;
    }
  }

  private isExpiredSoon(skewMs = 60_000): boolean {
    if (!this.integration?.tokenExpiresAt) return false;
    return new Date(this.integration.tokenExpiresAt).getTime() - skewMs <= Date.now();
  }

  /**
   * Authenticated request wrapper. Refreshes proactively if the token is
   * about to expire and reactively on a 403 token_expired response.
   */
  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.accessToken) throw new Error("hh.ru: no access token (integration not connected)");
    if (this.isExpiredSoon()) {
      await this.refresh();
    }
    let res = await this.rawRequest(method, path, body);

    if (res.status === 403) {
      const text = await res.clone().text();
      if (/token_expired|oauth/i.test(text)) {
        // Reactive refresh, then retry once.
        await this.refresh();
        res = await this.rawRequest(method, path, body);
      }
    }

    const text = await res.text();
    if (!res.ok) {
      throw new HhApiError(res.status, text, `hh.ru ${method} ${path} -> ${res.status}`);
    }
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private async rawRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "HH-User-Agent": HH_USER_AGENT,
      "User-Agent": HH_USER_AGENT,
      Accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(url, init);
  }

  /** GET /me — returns current account info including employer + manager IDs. */
  async me(): Promise<HhMe> {
    return this.request<HhMe>("GET", "/me");
  }

  /** GET /employers/{id} */
  async getEmployer(employerId: string): Promise<any> {
    return this.request("GET", `/employers/${employerId}`);
  }

  /**
   * Resolve the employer id for this integration. Prefers the persisted
   * account_id / meta.employerId, then falls back to the HH_EMPLOYER_ID env.
   */
  resolveEmployerId(): string | null {
    const fromAccount = this.integration?.accountId;
    if (fromAccount && String(fromAccount).trim()) return String(fromAccount).trim();
    if (this.integration?.meta) {
      try {
        const meta = JSON.parse(this.integration.meta);
        if (meta?.employerId) return String(meta.employerId);
      } catch {
        /* ignore malformed meta */
      }
    }
    const env = process.env.HH_EMPLOYER_ID;
    return env && env.trim() ? env.trim() : null;
  }

  /** Read a field out of integration.meta, tolerating malformed JSON. */
  private metaValue(key: string): string | null {
    if (!this.integration?.meta) return null;
    try {
      const meta = JSON.parse(this.integration.meta);
      const v = meta?.[key];
      return v != null && String(v).trim() ? String(v).trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the manager id required by the employer-scoped vacancy endpoints.
   * hh.ru's GET /employers/{id}/vacancies/active returns HTTP 400 (bad_argument)
   * unless a manager_id is supplied. Prefers the persisted meta.managerId; if
   * absent, queries GET /me (me.manager.id) and persists the result (along with
   * any newly-learned employer fields) back to integration.meta so subsequent
   * calls avoid the extra round-trip.
   */
  async resolveManagerId(): Promise<string | null> {
    const fromMeta = this.metaValue("managerId");
    if (fromMeta) return fromMeta;

    let me: HhMe;
    try {
      me = await this.me();
    } catch (err) {
      console.warn("[hh] resolveManagerId: /me lookup failed:", err);
      return null;
    }

    const managerId = me.manager?.id != null ? String(me.manager.id) : null;

    if (this.integration) {
      let existing: Record<string, unknown> = {};
      if (this.integration.meta) {
        try {
          existing = JSON.parse(this.integration.meta) ?? {};
        } catch {
          existing = {};
        }
      }
      const merged = {
        ...existing,
        employerId: me.employer?.id ?? existing.employerId ?? null,
        managerId: managerId ?? existing.managerId ?? null,
        employerName: me.employer?.name ?? existing.employerName ?? null,
        email: me.email ?? existing.email ?? null,
      };
      try {
        const updated = await storage.updateIntegration(this.integration.id, {
          meta: JSON.stringify(merged),
        });
        if (updated) this.integration = updated;
      } catch (err) {
        console.warn("[hh] resolveManagerId: failed to persist meta:", err);
      }
    }

    return managerId;
  }

  /** GET /employers/{id}/vacancies/active (paginated). Returns the raw page. */
  async listVacancies(employerId: string, opts: { page?: number; perPage?: number } = {}): Promise<any> {
    const params = new URLSearchParams({
      page: String(opts.page ?? 0),
      per_page: String(clampPerPage(opts.perPage)),
    });
    // hh.ru rejects this endpoint with HTTP 400 unless manager_id is present.
    const managerId = await this.resolveManagerId();
    if (managerId) params.set("manager_id", managerId);
    return this.request("GET", `/employers/${employerId}/vacancies/active?${params.toString()}`);
  }

  /**
   * Resolve the set of integer hh.ru vacancy ids whose negotiations we should
   * poll. Prefers the employer's live active vacancies; if that list is empty
   * (or the call fails) it falls back to vacancy ids previously imported into
   * the local DB (external_refs source='hh', type='vacancy'). Always returns
   * numeric ids — hh.ru rejects a non-integer vacancy_id with a 400.
   */
  async resolveVacancyIds(perPage: number): Promise<number[]> {
    perPage = clampPerPage(perPage);
    const ids = new Set<number>();

    const employerId = this.resolveEmployerId();
    if (employerId) {
      const maxVacPages = 20;
      for (let p = 0; p < maxVacPages; p++) {
        let data: any;
        try {
          data = await this.listVacancies(employerId, { page: p, perPage });
        } catch (err) {
          console.warn(`[hh_ingest] listVacancies failed on page ${p}, will fall back to local refs:`, err);
          break;
        }
        const items: any[] = data?.items ?? [];
        for (const v of items) {
          const n = Number(v?.id);
          if (Number.isInteger(n)) ids.add(n);
        }
        const pages = data?.pages ?? 1;
        if (p + 1 >= pages || items.length === 0) break;
      }
    }

    // Fallback: locally-imported hh vacancy ids.
    if (ids.size === 0) {
      try {
        const refs = await storage.getExternalRefsByProvider("hh", "vacancy");
        for (const r of refs) {
          const n = Number(r.externalId);
          if (Number.isInteger(n)) ids.add(n);
        }
      } catch (err) {
        console.warn("[hh_ingest] failed to load local hh vacancy refs:", err);
      }
    }

    return Array.from(ids);
  }

  // Well-known employer negotiation collection names, used only as a last-resort
  // fallback when the collections summary yields nothing. Querying a collection
  // that does not exist for an account simply returns empty, which is safe.
  private static readonly DEFAULT_NEGOTIATION_COLLECTIONS = [
    "response",
    "consider",
    "phone_interview",
    "discard_by_employer",
    "invitation",
  ];

  /**
   * Page through a single negotiations collection for one vacancy:
   * `GET /negotiations/{collection_name}?vacancy_id={id}&page&per_page`, which
   * returns `{ found, items[], page, pages, per_page }`. Accumulates items into
   * `all`, deduping by negotiation id via the shared `seen` set.
   */
  private async collectNegotiationCollection(
    collectionName: string,
    vacancyId: number,
    perPage: number,
    all: any[],
    seen: Set<string>,
  ): Promise<void> {
    const maxPages = 20;
    const encoded = encodeURIComponent(collectionName);
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        vacancy_id: String(vacancyId),
        page: String(page),
        per_page: String(perPage),
      });
      const data = await this.request<any>(
        "GET",
        `/negotiations/${encoded}?${params.toString()}`,
      );
      const items: any[] = data?.items ?? [];
      for (const n of items) {
        const nid = n?.id != null ? String(n.id) : null;
        if (nid && !seen.has(nid)) {
          seen.add(nid);
          all.push(n);
        }
      }
      const pages = data?.pages ?? 1;
      if (page + 1 >= pages || items.length === 0) break;
    }
  }

  /**
   * Targeted negotiation collection for employer tokens. For each active
   * employer vacancy we first read the collections summary
   * (`GET /negotiations?vacancy_id={id}`), which for employers returns
   * `{ collections[], employer_states[], generated_collections[] }` — NOT a flat
   * `items[]`. The actual responses live behind
   * `GET /negotiations/{collection_name}?vacancy_id={id}` (e.g.
   * collection_name="response"), so we iterate every collection id and page
   * through each.
   *
   * Fallbacks keep us from regressing on accounts/tokens that DO return a flat
   * list: if the summary has no collections but carries `items[]`, use those; if
   * neither, probe a hardcoded set of well-known collection names.
   *
   * Vacancy ids come from the live active-vacancies list, with a fallback to
   * locally-imported vacancy refs. An empty set is logged and yields an empty
   * result (never a 400). Negotiations are deduped by id across all
   * (vacancy, collection) pairs — a response can appear in several collections.
   */
  async collectEmployerNegotiations(opts: { dateFrom?: string | null; perPage?: number } = {}): Promise<any[]> {
    const perPage = clampPerPage(opts.perPage);

    const vacancyIds = await this.resolveVacancyIds(perPage);
    if (vacancyIds.length === 0) {
      console.log(
        "[hh_ingest] no employer vacancies resolved (none active and none imported locally); skipping negotiations poll",
      );
      return [];
    }

    const all: any[] = [];
    const seen = new Set<string>();

    for (const vacancyId of vacancyIds) {
      // 1. Read the collections summary for this vacancy.
      let summary: any;
      try {
        const params = new URLSearchParams({ vacancy_id: String(vacancyId) });
        summary = await this.request<any>("GET", `/negotiations?${params.toString()}`);
      } catch (err) {
        console.error(`[hh_ingest] negotiations summary fetch failed for vacancy ${vacancyId}:`, err);
        continue;
      }

      // 2. Build the de-duped list of collection names to page through.
      const collectionNames = new Set<string>();
      const summaryCollections: any[] = Array.isArray(summary?.collections) ? summary.collections : [];
      for (const c of summaryCollections) {
        const id = c?.id != null ? String(c.id) : null;
        if (id) collectionNames.add(id);
      }
      const generated: any[] = Array.isArray(summary?.generated_collections)
        ? summary.generated_collections
        : [];
      for (const c of generated) {
        const id = c?.id != null ? String(c.id) : null;
        if (id) collectionNames.add(id);
      }

      if (collectionNames.size > 0) {
        for (const name of collectionNames) {
          try {
            await this.collectNegotiationCollection(name, vacancyId, perPage, all, seen);
          } catch (err) {
            console.error(`[hh_ingest] negotiations collection ${name} failed for vacancy ${vacancyId}:`, err);
            continue;
          }
        }
        continue;
      }

      // FALLBACK 1: no collections, but the summary carried a flat items[]
      // (some manager tokens behave this way). Use it directly.
      const flatItems: any[] = Array.isArray(summary?.items) ? summary.items : [];
      if (flatItems.length > 0) {
        for (const n of flatItems) {
          const nid = n?.id != null ? String(n.id) : null;
          if (nid && !seen.has(nid)) {
            seen.add(nid);
            all.push(n);
          }
        }
        continue;
      }

      // FALLBACK 2: probe well-known collection names. Non-existent collections
      // just return empty, so this is safe.
      for (const name of HhClient.DEFAULT_NEGOTIATION_COLLECTIONS) {
        try {
          await this.collectNegotiationCollection(name, vacancyId, perPage, all, seen);
        } catch (err) {
          console.error(`[hh_ingest] negotiations collection ${name} failed for vacancy ${vacancyId}:`, err);
          continue;
        }
      }
    }

    if (opts.dateFrom) {
      const from = new Date(opts.dateFrom).getTime();
      return all.filter((n) => {
        const updated = n.updated_at ?? n.created_at;
        return !updated || new Date(updated).getTime() >= from;
      });
    }
    return all;
  }

  /** POST /vacancies — create (publish) a vacancy. Returns the created object. */
  async createVacancy(payload: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/vacancies", payload);
  }

  /** PUT /vacancies/{id} — update an existing vacancy. */
  async updateVacancy(id: string, payload: Record<string, unknown>): Promise<any> {
    return this.request("PUT", `/vacancies/${id}`, payload);
  }

  /** GET /vacancies/{id} */
  async getVacancy(id: string): Promise<any> {
    return this.request("GET", `/vacancies/${id}`);
  }

  /** GET /vacancies/{id}/stats */
  async getVacancyStats(id: string): Promise<any> {
    return this.request("GET", `/vacancies/${id}/stats`);
  }

  /** GET /areas — dictionary of regions/cities (cached per process). */
  async getAreas(): Promise<any> {
    return this.request("GET", "/areas");
  }

  /** GET /professional_roles — dictionary of professional roles. */
  async getProfessionalRoles(): Promise<any> {
    return this.request("GET", "/professional_roles");
  }

  /**
   * List negotiations (отклики) for a SINGLE vacancy. hh.ru rejects the
   * employer /negotiations endpoint with HTTP 400 ("vacancy_id: not integer
   * value") unless a numeric vacancy_id is supplied, so this method requires
   * one. Employer-wide collection must go through collectEmployerNegotiations()
   * which iterates per vacancy. hh.ru paginates via page/per_page; the response
   * shape is { items, found, pages, page, per_page }.
   */
  async listNegotiations(opts: { vacancyId: number | string; page?: number; perPage?: number; dateFrom?: string }): Promise<any[]> {
    const vacancyId = Number(opts.vacancyId);
    if (!Number.isInteger(vacancyId)) {
      throw new Error(
        `hh.ru: listNegotiations requires an integer vacancy_id (got ${JSON.stringify(opts.vacancyId)})`,
      );
    }
    const perPage = clampPerPage(opts.perPage);
    const items: any[] = [];
    // Pull a bounded number of pages to avoid runaway loops.
    let page = opts.page ?? 0;
    const maxPages = 20;
    for (let i = 0; i < maxPages; i++) {
      const params = new URLSearchParams({
        vacancy_id: String(vacancyId),
        page: String(page),
        per_page: String(perPage),
      });
      const data = await this.request<any>("GET", `/negotiations?${params.toString()}`);
      const pageItems: any[] = data?.items ?? [];
      items.push(...pageItems);
      const pages = data?.pages ?? 1;
      page += 1;
      if (page >= pages || pageItems.length === 0) break;
    }
    if (opts.dateFrom) {
      const from = new Date(opts.dateFrom).getTime();
      return items.filter((n) => {
        const updated = n.updated_at ?? n.created_at;
        return !updated || new Date(updated).getTime() >= from;
      });
    }
    return items;
  }

  /** GET /negotiations/{nid} */
  async getNegotiation(nid: string): Promise<any> {
    return this.request("GET", `/negotiations/${nid}`);
  }

  /** GET /resumes/{resume_id} */
  async getResume(resumeId: string): Promise<any> {
    return this.request("GET", `/resumes/${resumeId}`);
  }

  /** GET /negotiations/{nid}/messages */
  async listMessages(nid: string, opts: { page?: number } = {}): Promise<any> {
    const params = new URLSearchParams({
      page: String(opts.page ?? 0),
      per_page: String(HH_MAX_PER_PAGE),
      with_text_only: "false",
    });
    return this.request("GET", `/negotiations/${nid}/messages?${params.toString()}`);
  }

  /** POST /negotiations/{nid}/messages */
  async sendMessage(nid: string, text: string): Promise<any> {
    // hh.ru expects the message text as a form field on the negotiation.
    // The JSON body { message: text } is accepted by the API; if the employer
    // app requires form-encoding, swap to URLSearchParams here.
    return this.request("POST", `/negotiations/${nid}/messages`, { message: text });
  }

  /** Expose the current (possibly refreshed) integration record. */
  getIntegration(): Integration | null {
    return this.integration;
  }

  /**
   * True when the integration holds a usable OAuth token pair. This is the
   * authoritative "connected" signal — the `status` column can get stuck at
   * 'error' after a transient sync failure, but as long as tokens are present
   * (and refreshable) the account is in fact connected. A missing/expired
   * access token is still considered valid here when a refresh token exists,
   * because request()/refresh() will transparently mint a new pair.
   */
  hasValidTokens(): boolean {
    return Boolean(this.accessToken || this.refreshToken);
  }
}

/**
 * Token-based connection check, independent of the (sometimes stale)
 * integration.status column. Returns true when the persisted hh integration
 * has decryptable access/refresh tokens.
 */
export function integrationHasTokens(integration: Integration | null | undefined): boolean {
  if (!integration) return false;
  const access = tryDecrypt(integration.accessToken);
  const refresh = tryDecrypt(integration.refreshToken);
  return Boolean(access || refresh);
}
