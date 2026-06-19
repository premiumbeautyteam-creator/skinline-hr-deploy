import {
  vacancies, candidates, documents, messages, activities,
  integrations, externalRefs, oauthStates, webhookEvents,
  crmUsers, tasks, scheduledActions, stageEvents, telegramLinks,
  appSettings, aiCalls,
  channelSettings, contentRubrics, channelPosts, channelSubscribers, channelMetrics, reserveReactivation,
  quizzes, quizQuestions, quizAttempts,
  // Iter5
  probationTracks, probationCheckpoints,
  pulseSurveys, pulseResponses,
  reservePool,
  referralCodes, referrals,
  alerts,
  companyRatings,
  // Iter6
  scorecardTemplates, scorecardResponses, interviewVideos,
} from '@shared/schema';
import type {
  Vacancy, InsertVacancy,
  Candidate, InsertCandidate,
  Document, InsertDocument,
  Message, InsertMessage,
  Activity, InsertActivity,
  Integration, InsertIntegration,
  ExternalRef, InsertExternalRef,
  OauthState,
  WebhookEvent, InsertWebhookEvent,
  CrmUser, InsertCrmUser,
  Task, InsertTask,
  ScheduledAction, InsertScheduledAction,
  StageEvent, InsertStageEvent,
  TelegramLink,
  AppSetting,
  AiCall,
  ChannelSettings,
  ContentRubric,
  ChannelPost,
  ChannelSubscriber,
  ChannelMetric,
  ReserveReactivation,
  Quiz, InsertQuiz,
  QuizQuestion, InsertQuizQuestion,
  QuizAttempt, InsertQuizAttempt,
  // Iter5
  ProbationTrack, InsertProbationTrack,
  ProbationCheckpoint, InsertProbationCheckpoint,
  PulseSurvey, InsertPulseSurvey,
  PulseResponse, InsertPulseResponse,
  ReservePool, InsertReservePool,
  ReferralCode, InsertReferralCode,
  Referral, InsertReferral,
  Alert, InsertAlert,
  CompanyRating, InsertCompanyRating,
  // Iter6
  ScorecardTemplate, InsertScorecardTemplate,
  ScorecardResponse, InsertScorecardResponse,
  InterviewVideo, InsertInterviewVideo,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, lt, lte, gte, sql, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Create tables if not present (template ships without migrations for our schema)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, city TEXT NOT NULL,
  salary TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
  city TEXT NOT NULL, vacancy_id TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT,
  stage TEXT NOT NULL, experience TEXT NOT NULL, expected_salary TEXT, rating INTEGER,
  notes TEXT, tags TEXT NOT NULL DEFAULT '[]', reject_reason TEXT, avatar_url TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, type TEXT NOT NULL,
  file_name TEXT NOT NULL, file_url TEXT NOT NULL, uploaded_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, channel TEXT NOT NULL,
  direction TEXT NOT NULL, text TEXT NOT NULL, sent_at TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, type TEXT NOT NULL,
  description TEXT NOT NULL, created_at TEXT NOT NULL, meta TEXT
);
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL,
  account_id TEXT, account_name TEXT, access_token TEXT, refresh_token TEXT,
  token_expires_at TEXT, last_sync_at TEXT, last_error TEXT, meta TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_refs (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  source TEXT NOT NULL, external_id TEXT NOT NULL, external_type TEXT NOT NULL,
  meta TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_refs_unique
  ON external_refs (source, external_type, external_id);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, event_type TEXT NOT NULL,
  external_id TEXT, payload TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  received_at TEXT NOT NULL, processed_at TEXT
);
CREATE TABLE IF NOT EXISTS crm_users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role_key TEXT NOT NULL,
  telegram_username TEXT, telegram_chat_id TEXT, email TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, assignee_id TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL,
  completed_at TEXT, source TEXT NOT NULL DEFAULT 'manual', trigger_stage TEXT
);
CREATE TABLE IF NOT EXISTS scheduled_actions (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL,
  kind TEXT NOT NULL, run_at TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', trigger_stage TEXT NOT NULL,
  created_at TEXT NOT NULL, executed_at TEXT, last_error TEXT
);
CREATE TABLE IF NOT EXISTS stage_events (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL,
  from_stage TEXT, to_stage TEXT NOT NULL,
  changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, meta TEXT
);
CREATE TABLE IF NOT EXISTS telegram_links (
  candidate_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
  username TEXT, linked_at TEXT NOT NULL, bot_username TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY, purpose TEXT NOT NULL, model TEXT NOT NULL,
  candidate_id TEXT, prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL,
  duration_ms INTEGER NOT NULL DEFAULT 0, success INTEGER NOT NULL DEFAULT 1,
  error TEXT, created_at TEXT NOT NULL
);
`);

// Lightweight migrations for columns added to pre-existing tables.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("candidates", "resume_url", "resume_url TEXT");
ensureColumn("candidates", "external_avatar_url", "external_avatar_url TEXT");
ensureColumn("candidates", "telegram_chat_id", "telegram_chat_id TEXT");
ensureColumn("candidates", "link_token", "link_token TEXT");
ensureColumn("candidates", "last_stage_at", "last_stage_at TEXT");
ensureColumn("vacancies", "external_url", "external_url TEXT");
ensureColumn("vacancies", "source", "source TEXT");
ensureColumn("messages", "source", "source TEXT");
ensureColumn("messages", "external_id", "external_id TEXT");
ensureColumn("messages", "delivery_status", "delivery_status TEXT");
ensureColumn("messages", "meta", "meta TEXT");
// Iteration 2 columns
ensureColumn("candidates", "ai_verdict", "ai_verdict TEXT");
ensureColumn("candidates", "ai_reasoning", "ai_reasoning TEXT");
ensureColumn("candidates", "ai_score", "ai_score INTEGER");
ensureColumn("candidates", "predictive_score", "predictive_score INTEGER");
ensureColumn("candidates", "predictive_factors", "predictive_factors TEXT");
ensureColumn("candidates", "date_of_birth", "date_of_birth TEXT");
ensureColumn("candidates", "form_filled_in_seconds", "form_filled_in_seconds INTEGER");
ensureColumn("candidates", "fake_score", "fake_score INTEGER");
// Iteration 4 columns
ensureColumn("documents", "upload_source", "upload_source TEXT NOT NULL DEFAULT 'internal'");
ensureColumn("documents", "ocr_status", "ocr_status TEXT NOT NULL DEFAULT 'pending'");
ensureColumn("documents", "ocr_data", "ocr_data TEXT");
ensureColumn("documents", "ocr_error", "ocr_error TEXT");
ensureColumn("documents", "ocr_at", "ocr_at TEXT");
ensureColumn("documents", "rejected_reason", "rejected_reason TEXT");
ensureColumn("documents", "file_path", "file_path TEXT");
ensureColumn("documents", "file_hash", "file_hash TEXT");

// Iteration 4 tables
sqlite.exec(`
CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  trigger_stage TEXT,
  passing_score INTEGER NOT NULL DEFAULT 70,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  correct_index INTEGER NOT NULL DEFAULT 0,
  explanation TEXT
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  score_percent INTEGER,
  current_question_idx INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '[]'
);
`);

// Iteration 3 tables
sqlite.exec(`
CREATE TABLE IF NOT EXISTS channel_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_username TEXT NOT NULL DEFAULT '@SkinLineHR',
  channel_title TEXT NOT NULL DEFAULT 'Skin Line | HR',
  autopilot_enabled INTEGER NOT NULL DEFAULT 0,
  posts_per_week INTEGER NOT NULL DEFAULT 2,
  preferred_hours TEXT NOT NULL DEFAULT '[10,14,18]',
  preferred_days TEXT NOT NULL DEFAULT '[1,3,5]',
  last_post_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_rubrics (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS channel_posts (
  id TEXT PRIMARY KEY,
  rubric_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  poll_options TEXT,
  scheduled_at TEXT,
  published_at TEXT,
  tg_message_id INTEGER,
  created_by TEXT NOT NULL DEFAULT 'ai',
  reviewed_by TEXT,
  generated_from_prompt TEXT,
  meta TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_subscribers (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  joined_at TEXT NOT NULL,
  welcome_sent_at TEXT,
  candidate_id TEXT,
  source TEXT NOT NULL DEFAULT 'channel_join',
  meta TEXT
);
CREATE TABLE IF NOT EXISTS channel_metrics (
  post_id TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  reactions INTEGER NOT NULL DEFAULT 0,
  forwards INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  measured_at TEXT NOT NULL,
  PRIMARY KEY (post_id, measured_at)
);
CREATE TABLE IF NOT EXISTS reserve_reactivation (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  attempt_at TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  reply TEXT,
  created_at TEXT NOT NULL
);
`);

// Iteration 5 columns on candidates
ensureColumn("candidates", "utm_source", "utm_source TEXT");
ensureColumn("candidates", "utm_medium", "utm_medium TEXT");
ensureColumn("candidates", "utm_campaign", "utm_campaign TEXT");
ensureColumn("candidates", "utm_content", "utm_content TEXT");
ensureColumn("candidates", "utm_term", "utm_term TEXT");

// Iteration 5 tables
sqlite.exec(`
CREATE TABLE IF NOT EXISTS probation_tracks (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  manager_id TEXT,
  final_decision_at TEXT,
  final_decision_by TEXT,
  final_decision_notes TEXT,
  score INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS probation_checkpoints (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  day_number INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  check_type TEXT NOT NULL DEFAULT 'pulse_survey',
  result TEXT
);
CREATE TABLE IF NOT EXISTS pulse_surveys (
  id TEXT PRIMARY KEY,
  day_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  questions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pulse_responses (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  responses TEXT NOT NULL DEFAULT '[]',
  avg_rating TEXT,
  sentiment TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reserve_pool (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  reason TEXT,
  city TEXT,
  role TEXT,
  last_contacted_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  candidate_id TEXT,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  bonus_amount INTEGER NOT NULL DEFAULT 5000
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes (code);
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  bonus_amount INTEGER,
  paid_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'med',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  candidate_id TEXT,
  user_id TEXT,
  related_entity TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE TABLE IF NOT EXISTS company_ratings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'dreamjob',
  url TEXT NOT NULL,
  company_name TEXT NOT NULL,
  overall_rating REAL,
  total_reviews INTEGER,
  recommend_percent REAL,
  subcategory_ratings TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  raw TEXT
);
`);

// Iteration 6 tables
sqlite.exec(`
CREATE TABLE IF NOT EXISTS scorecard_templates (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  criteria_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scorecard_responses (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  scores_json TEXT NOT NULL DEFAULT '[]',
  total_score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  percentage REAL NOT NULL DEFAULT 0,
  ai_drafted INTEGER NOT NULL DEFAULT 0,
  ai_verdict TEXT,
  recommendation TEXT,
  interviewer_id TEXT,
  source_video_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interview_videos (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'zoom',
  source_url TEXT NOT NULL,
  local_path TEXT,
  duration_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error_msg TEXT,
  transcript_path TEXT,
  transcript_json TEXT,
  raw_analysis_json TEXT,
  sentiment_timeline_json TEXT,
  red_flags_json TEXT,
  ai_summary TEXT,
  key_timestamps_json TEXT,
  extracted_facts_json TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
-- HH auto-message idempotency log: one row per negotiation we have processed
-- for the onboarding auto-reply. Additive (CREATE IF NOT EXISTS) so it never
-- disrupts an existing production data.db. status: 'sent' = all 3 delivered;
-- 'failed_permanent' = HH refused permanently (e.g. messaging disabled) and we
-- must not retry. message_count records how many of the 3 went through.
CREATE TABLE IF NOT EXISTS auto_message_log (
  nid TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'sent',
  message_count INTEGER NOT NULL DEFAULT 0,
  vacancy_title TEXT,
  error TEXT,
  sent_at TEXT NOT NULL
);
`);

export const db = drizzle(sqlite);

// Idempotency record for the HH onboarding auto-reply, keyed by negotiation id.
export interface AutoMessageLog {
  nid: string;
  status: "sent" | "failed_permanent";
  messageCount: number;
  vacancyTitle?: string | null;
  error?: string | null;
  sentAt: string;
}

export interface IStorage {
  // vacancies
  getVacancies(): Promise<Vacancy[]>;
  getVacancy(id: string): Promise<Vacancy | undefined>;
  createVacancy(v: InsertVacancy): Promise<Vacancy>;
  updateVacancy(id: string, v: Partial<InsertVacancy>): Promise<Vacancy | undefined>;
  deleteVacancy(id: string): Promise<void>;
  // candidates
  getCandidates(filters?: { stage?: string; vacancyId?: string; source?: string }): Promise<Candidate[]>;
  getCandidate(id: string): Promise<Candidate | undefined>;
  getCandidateByPhone(phone: string): Promise<Candidate | undefined>;
  getCandidateByLinkToken(token: string): Promise<Candidate | undefined>;
  getCandidateByTelegramChatId(chatId: string): Promise<Candidate | undefined>;
  createCandidate(c: InsertCandidate): Promise<Candidate>;
  updateCandidate(id: string, c: Partial<InsertCandidate>): Promise<Candidate | undefined>;
  setCandidateUtm(id: string, utm: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null }): Promise<void>;
  deleteCandidate(id: string): Promise<void>;
  // documents
  getDocuments(candidateId: string): Promise<Document[]>;
  createDocument(d: InsertDocument): Promise<Document>;
  updateDocument(id: string, d: Partial<InsertDocument>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;
  // messages
  getMessages(candidateId: string): Promise<Message[]>;
  createMessage(m: InsertMessage): Promise<Message>;
  createMessageAt(m: InsertMessage, sentAt: string): Promise<Message>;
  getMessage(id: string): Promise<Message | undefined>;
  getMessageByExternal(source: string, externalId: string): Promise<Message | undefined>;
  updateMessage(id: string, m: Partial<Message>): Promise<Message | undefined>;
  // activities
  getActivities(candidateId: string): Promise<Activity[]>;
  createActivity(a: InsertActivity): Promise<Activity>;
  getRecentActivities(limit: number): Promise<Activity[]>;
  // integrations
  getIntegrations(): Promise<Integration[]>;
  getIntegration(source: string): Promise<Integration | undefined>;
  getIntegrationsByStatus(status: string): Promise<Integration[]>;
  upsertIntegration(source: string, data: Partial<InsertIntegration>): Promise<Integration>;
  updateIntegration(id: string, data: Partial<Integration>): Promise<Integration | undefined>;
  // external refs
  getExternalRef(source: string, externalType: string, externalId: string): Promise<ExternalRef | undefined>;
  getExternalRefsForEntity(entityType: string, entityId: string): Promise<ExternalRef[]>;
  getExternalRefByEntity(entityType: string, entityId: string, source: string, externalType: string): Promise<ExternalRef | undefined>;
  getExternalRefsByProvider(source: string, externalType?: string): Promise<ExternalRef[]>;
  createExternalRef(r: InsertExternalRef): Promise<ExternalRef>;
  // hh auto-message log
  getAutoMessageLog(nid: string): Promise<AutoMessageLog | undefined>;
  recordAutoMessageLog(entry: AutoMessageLog): Promise<void>;
  // oauth states
  createOauthState(state: string, source: string): Promise<OauthState>;
  getOauthState(state: string): Promise<OauthState | undefined>;
  deleteOauthState(state: string): Promise<void>;
  deleteExpiredOauthStates(beforeIso: string): Promise<number>;
  // webhook events
  createWebhookEvent(e: InsertWebhookEvent): Promise<WebhookEvent>;
  getWebhookEvent(id: string): Promise<WebhookEvent | undefined>;
  getPendingWebhookEvents(limit: number): Promise<WebhookEvent[]>;
  getWebhookEventsToProcess(source: string, limit: number, maxAttempts?: number): Promise<WebhookEvent[]>;
  updateWebhookEvent(id: string, data: Partial<WebhookEvent>): Promise<WebhookEvent | undefined>;
  // crm_users
  getCrmUsers(): Promise<CrmUser[]>;
  getCrmUser(id: string): Promise<CrmUser | undefined>;
  getCrmUserByRole(roleKey: string): Promise<CrmUser | undefined>;
  upsertCrmUser(user: InsertCrmUser): Promise<CrmUser>;
  updateCrmUser(id: string, data: Partial<CrmUser>): Promise<CrmUser | undefined>;
  // tasks
  getTasks(candidateId: string): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(t: InsertTask): Promise<Task>;
  updateTask(id: string, data: Partial<Task>): Promise<Task | undefined>;
  // scheduled_actions
  getScheduledActions(candidateId: string): Promise<ScheduledAction[]>;
  getPendingScheduledActions(beforeOrAt: string): Promise<ScheduledAction[]>;
  createScheduledAction(a: InsertScheduledAction): Promise<ScheduledAction>;
  updateScheduledAction(id: string, data: Partial<ScheduledAction>): Promise<ScheduledAction | undefined>;
  cancelPendingActionsForStage(candidateId: string, triggerStage: string): Promise<void>;
  // stage_events
  getStageEvents(candidateId: string): Promise<StageEvent[]>;
  createStageEvent(e: InsertStageEvent): Promise<StageEvent>;
  // telegram_links
  getTelegramLink(candidateId: string): Promise<TelegramLink | undefined>;
  upsertTelegramLink(link: TelegramLink): Promise<TelegramLink>;
  // app_settings (Iter2)
  getSetting(key: string): Promise<AppSetting | undefined>;
  getSettings(): Promise<AppSetting[]>;
  upsertSetting(key: string, value: string): Promise<AppSetting>;
  // getCandidatesByStage helper
  getCandidatesByPhone(phone: string): Promise<Candidate[]>;
  getCandidatesByFullName(fullName: string, city?: string): Promise<Candidate[]>;
  // ---- Iter3: channel ----
  getChannelSettings(): Promise<ChannelSettings | undefined>;
  upsertChannelSettings(data: Partial<ChannelSettings>): Promise<ChannelSettings>;
  // content_rubrics
  getContentRubrics(): Promise<ContentRubric[]>;
  getContentRubric(key: string): Promise<ContentRubric | undefined>;
  upsertContentRubric(rubric: ContentRubric): Promise<ContentRubric>;
  updateContentRubric(key: string, data: Partial<ContentRubric>): Promise<ContentRubric | undefined>;
  // channel_posts
  getChannelPosts(filters?: { status?: string; from?: string; to?: string }): Promise<ChannelPost[]>;
  getChannelPost(id: string): Promise<ChannelPost | undefined>;
  createChannelPost(post: Omit<ChannelPost, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChannelPost>;
  updateChannelPost(id: string, data: Partial<ChannelPost>): Promise<ChannelPost | undefined>;
  deleteChannelPost(id: string): Promise<void>;
  getScheduledChannelPosts(beforeOrAt: string): Promise<ChannelPost[]>;
  // channel_subscribers
  getChannelSubscribers(limit?: number): Promise<ChannelSubscriber[]>;
  upsertChannelSubscriber(sub: ChannelSubscriber): Promise<ChannelSubscriber>;
  getChannelSubscriber(chatId: string): Promise<ChannelSubscriber | undefined>;
  updateChannelSubscriber(chatId: string, data: Partial<ChannelSubscriber>): Promise<ChannelSubscriber | undefined>;
  // channel_metrics
  getChannelMetrics(postId: string): Promise<ChannelMetric[]>;
  insertChannelMetric(metric: ChannelMetric): Promise<void>;
  // reserve_reactivation
  getReserveReactivations(limit?: number): Promise<ReserveReactivation[]>;
  createReserveReactivation(r: Omit<ReserveReactivation, 'id' | 'createdAt'>): Promise<ReserveReactivation>;
  updateReserveReactivation(id: string, data: Partial<ReserveReactivation>): Promise<ReserveReactivation | undefined>;
  // candidates in reserve
  getCandidatesByStageOlderThan(stage: string, olderThanDays: number): Promise<Candidate[]>;
  // ---- Iter4: quizzes ----
  getQuizzes(): Promise<Quiz[]>;
  getQuiz(id: string): Promise<Quiz | undefined>;
  getQuizByTriggerStage(triggerStage: string): Promise<Quiz | undefined>;
  createQuiz(data: InsertQuiz): Promise<Quiz>;
  updateQuiz(id: string, data: Partial<InsertQuiz>): Promise<Quiz | undefined>;
  getQuizQuestions(quizId: string): Promise<QuizQuestion[]>;
  getQuizQuestion(id: string): Promise<QuizQuestion | undefined>;
  createQuizQuestion(data: InsertQuizQuestion): Promise<QuizQuestion>;
  updateQuizQuestion(id: string, data: Partial<InsertQuizQuestion>): Promise<QuizQuestion | undefined>;
  deleteQuizQuestion(id: string): Promise<void>;
  getQuizAttempts(candidateId: string): Promise<QuizAttempt[]>;
  getQuizAttempt(id: string): Promise<QuizAttempt | undefined>;
  getActiveQuizAttempt(candidateId: string, quizId: string): Promise<QuizAttempt | undefined>;
  createQuizAttempt(data: InsertQuizAttempt): Promise<QuizAttempt>;
  updateQuizAttempt(id: string, data: Partial<QuizAttempt>): Promise<QuizAttempt | undefined>;
  getDocumentByFileHash(fileHash: string): Promise<Document | undefined>;
  // ---- Iter5: probation ----
  getProbationTracks(filters?: { status?: string }): Promise<ProbationTrack[]>;
  getProbationTrack(id: string): Promise<ProbationTrack | undefined>;
  getProbationTrackByCandidate(candidateId: string): Promise<ProbationTrack | undefined>;
  createProbationTrack(data: InsertProbationTrack): Promise<ProbationTrack>;
  updateProbationTrack(id: string, data: Partial<ProbationTrack>): Promise<ProbationTrack | undefined>;
  getCheckpoints(trackId: string): Promise<ProbationCheckpoint[]>;
  createCheckpoint(data: InsertProbationCheckpoint): Promise<ProbationCheckpoint>;
  updateCheckpoint(id: string, data: Partial<ProbationCheckpoint>): Promise<ProbationCheckpoint | undefined>;
  // ---- Iter5: pulse surveys ----
  getPulseSurveys(): Promise<PulseSurvey[]>;
  getPulseSurveyByDay(dayNumber: number): Promise<PulseSurvey | undefined>;
  createPulseSurvey(data: InsertPulseSurvey): Promise<PulseSurvey>;
  getPulseResponses(candidateId: string): Promise<PulseResponse[]>;
  createPulseResponse(data: InsertPulseResponse): Promise<PulseResponse>;
  updatePulseResponse(id: string, data: Partial<PulseResponse>): Promise<PulseResponse | undefined>;
  getRecentPulseResponsesWithLowRating(avgRatingThreshold: number, hoursBack: number): Promise<PulseResponse[]>;
  // ---- Iter5: reserve pool ----
  getReservePool(filters?: { status?: string }): Promise<ReservePool[]>;
  getReservePoolEntry(id: string): Promise<ReservePool | undefined>;
  getReservePoolByCandidate(candidateId: string): Promise<ReservePool | undefined>;
  createReservePoolEntry(data: InsertReservePool): Promise<ReservePool>;
  updateReservePoolEntry(id: string, data: Partial<ReservePool>): Promise<ReservePool | undefined>;
  getStaleReserveEntries(daysThreshold: number): Promise<ReservePool[]>;
  // ---- Iter5: referrals ----
  getReferralCodes(filters?: { userId?: string; candidateId?: string }): Promise<ReferralCode[]>;
  getReferralCodeByCode(code: string): Promise<ReferralCode | undefined>;
  getReferralCode(id: string): Promise<ReferralCode | undefined>;
  createReferralCode(data: InsertReferralCode): Promise<ReferralCode>;
  getReferrals(filters?: { codeId?: string; status?: string }): Promise<Referral[]>;
  getReferralByCandidate(candidateId: string): Promise<Referral | undefined>;
  createReferral(data: InsertReferral): Promise<Referral>;
  updateReferral(id: string, data: Partial<Referral>): Promise<Referral | undefined>;
  // ---- Iter5: alerts ----
  getAlerts(filters?: { severity?: string; type?: string; resolved?: boolean }): Promise<Alert[]>;
  getAlert(id: string): Promise<Alert | undefined>;
  createAlert(data: InsertAlert): Promise<Alert>;
  resolveAlert(id: string, resolvedBy: string): Promise<Alert | undefined>;
  countUnresolvedAlerts(): Promise<number>;
  getPulseSurveysCount(): Promise<number>;
  // ---- Dream Job: company_ratings ----
  getLatestCompanyRating(source?: string): Promise<CompanyRating | undefined>;
  getCompanyRatingHistory(source?: string, limit?: number): Promise<CompanyRating[]>;
  createCompanyRating(data: InsertCompanyRating): Promise<CompanyRating>;
  // ---- Iter6: scorecard_templates ----
  getScorecardTemplates(filters?: { role?: string; active?: boolean }): Promise<ScorecardTemplate[]>;
  getScorecardTemplate(id: string): Promise<ScorecardTemplate | undefined>;
  createScorecardTemplate(data: InsertScorecardTemplate): Promise<ScorecardTemplate>;
  updateScorecardTemplate(id: string, data: Partial<InsertScorecardTemplate>): Promise<ScorecardTemplate | undefined>;
  countScorecardTemplates(): Promise<number>;
  // ---- Iter6: scorecard_responses ----
  getScorecardResponses(filters?: { candidateId?: string; stage?: string; templateId?: string }): Promise<ScorecardResponse[]>;
  getScorecardResponse(id: string): Promise<ScorecardResponse | undefined>;
  createScorecardResponse(data: InsertScorecardResponse): Promise<ScorecardResponse>;
  updateScorecardResponse(id: string, data: Partial<InsertScorecardResponse>): Promise<ScorecardResponse | undefined>;
  // ---- Iter6: interview_videos ----
  getInterviewVideos(filters?: { candidateId?: string; status?: string }): Promise<InterviewVideo[]>;
  getInterviewVideo(id: string): Promise<InterviewVideo | undefined>;
  createInterviewVideo(data: InsertInterviewVideo): Promise<InterviewVideo>;
  updateInterviewVideo(id: string, data: Partial<InsertInterviewVideo>): Promise<InterviewVideo | undefined>;
  getPendingInterviewVideos(limit?: number): Promise<InterviewVideo[]>;
}

export class DatabaseStorage implements IStorage {
  // ---- vacancies ----
  async getVacancies(): Promise<Vacancy[]> {
    return db.select().from(vacancies).all();
  }
  async getVacancy(id: string): Promise<Vacancy | undefined> {
    return db.select().from(vacancies).where(eq(vacancies.id, id)).get();
  }
  async createVacancy(v: InsertVacancy): Promise<Vacancy> {
    return db.insert(vacancies).values({ ...v, id: randomUUID() }).returning().get();
  }
  async updateVacancy(id: string, v: Partial<InsertVacancy>): Promise<Vacancy | undefined> {
    return db.update(vacancies).set(v).where(eq(vacancies.id, id)).returning().get();
  }
  async deleteVacancy(id: string): Promise<void> {
    db.delete(vacancies).where(eq(vacancies.id, id)).run();
  }

  // ---- candidates ----
  async getCandidates(filters?: { stage?: string; vacancyId?: string; source?: string }): Promise<Candidate[]> {
    let rows = db.select().from(candidates).orderBy(desc(candidates.createdAt)).all();
    if (filters?.stage) rows = rows.filter((r) => r.stage === filters.stage);
    if (filters?.vacancyId) rows = rows.filter((r) => r.vacancyId === filters.vacancyId);
    if (filters?.source) rows = rows.filter((r) => r.source === filters.source);
    return rows;
  }
  async getCandidate(id: string): Promise<Candidate | undefined> {
    return db.select().from(candidates).where(eq(candidates.id, id)).get();
  }
  async getCandidateByPhone(phone: string): Promise<Candidate | undefined> {
    return db.select().from(candidates).where(eq(candidates.phone, phone)).get();
  }
  async getCandidateByLinkToken(token: string): Promise<Candidate | undefined> {
    return db.select().from(candidates).where(eq(candidates.linkToken, token)).get();
  }
  async getCandidateByTelegramChatId(chatId: string): Promise<Candidate | undefined> {
    return db.select().from(candidates).where(eq(candidates.telegramChatId, chatId)).get();
  }
  async createCandidate(c: InsertCandidate): Promise<Candidate> {
    return db.insert(candidates).values({
      ...c, id: randomUUID(), createdAt: new Date().toISOString(),
    }).returning().get();
  }
  async updateCandidate(id: string, c: Partial<InsertCandidate>): Promise<Candidate | undefined> {
    return db.update(candidates).set(c).where(eq(candidates.id, id)).returning().get();
  }
  // UTM columns are added via ensureColumn and are not part of the Drizzle
  // `candidates` table object, so a Drizzle .set() would drop them (producing an
  // empty SET clause). Write them with raw SQL against the underlying connection.
  async setCandidateUtm(
    id: string,
    utm: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null },
  ): Promise<void> {
    sqlite
      .prepare(
        "UPDATE candidates SET utm_source = ?, utm_medium = ?, utm_campaign = ? WHERE id = ?",
      )
      .run(utm.utmSource ?? null, utm.utmMedium ?? null, utm.utmCampaign ?? null, id);
  }
  async deleteCandidate(id: string): Promise<void> {
    db.delete(candidates).where(eq(candidates.id, id)).run();
    db.delete(messages).where(eq(messages.candidateId, id)).run();
    db.delete(documents).where(eq(documents.candidateId, id)).run();
    db.delete(activities).where(eq(activities.candidateId, id)).run();
  }

  // ---- documents ----
  async getDocuments(candidateId: string): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.candidateId, candidateId)).all();
  }
  async createDocument(d: InsertDocument): Promise<Document> {
    return db.insert(documents).values({
      ...d, id: randomUUID(), uploadedAt: new Date().toISOString(),
    }).returning().get();
  }
  async updateDocument(id: string, d: Partial<InsertDocument>): Promise<Document | undefined> {
    return db.update(documents).set(d).where(eq(documents.id, id)).returning().get();
  }
  async deleteDocument(id: string): Promise<void> {
    db.delete(documents).where(eq(documents.id, id)).run();
  }

  // ---- messages ----
  async getMessages(candidateId: string): Promise<Message[]> {
    return db.select().from(messages).where(eq(messages.candidateId, candidateId)).all();
  }
  async createMessage(m: InsertMessage): Promise<Message> {
    return db.insert(messages).values({
      ...m, id: randomUUID(), sentAt: new Date().toISOString(),
    }).returning().get();
  }
  async createMessageAt(m: InsertMessage, sentAt: string): Promise<Message> {
    return db.insert(messages).values({
      ...m, id: randomUUID(), sentAt,
    }).returning().get();
  }
  async getMessage(id: string): Promise<Message | undefined> {
    return db.select().from(messages).where(eq(messages.id, id)).get();
  }
  async getMessageByExternal(source: string, externalId: string): Promise<Message | undefined> {
    return db.select().from(messages)
      .where(and(eq(messages.source, source), eq(messages.externalId, externalId))).get();
  }
  async updateMessage(id: string, m: Partial<Message>): Promise<Message | undefined> {
    return db.update(messages).set(m).where(eq(messages.id, id)).returning().get();
  }

  // ---- activities ----
  async getActivities(candidateId: string): Promise<Activity[]> {
    return db.select().from(activities).where(eq(activities.candidateId, candidateId))
      .orderBy(desc(activities.createdAt)).all();
  }
  async createActivity(a: InsertActivity): Promise<Activity> {
    return db.insert(activities).values({
      ...a, id: randomUUID(), createdAt: new Date().toISOString(),
    }).returning().get();
  }
  async getRecentActivities(limit: number): Promise<Activity[]> {
    return db.select().from(activities).orderBy(desc(activities.createdAt)).limit(limit).all();
  }

  // ---- integrations ----
  async getIntegrations(): Promise<Integration[]> {
    return db.select().from(integrations).all();
  }
  async getIntegration(source: string): Promise<Integration | undefined> {
    return db.select().from(integrations).where(eq(integrations.source, source)).get();
  }
  async getIntegrationsByStatus(status: string): Promise<Integration[]> {
    return db.select().from(integrations).where(eq(integrations.status, status)).all();
  }
  async upsertIntegration(source: string, data: Partial<InsertIntegration>): Promise<Integration> {
    const now = new Date().toISOString();
    const existing = await this.getIntegration(source);
    if (existing) {
      return db.update(integrations)
        .set({ ...data, updatedAt: now })
        .where(eq(integrations.id, existing.id)).returning().get();
    }
    return db.insert(integrations).values({
      id: randomUUID(), source,
      status: data.status ?? "disconnected",
      accountId: data.accountId ?? null,
      accountName: data.accountName ?? null,
      accessToken: data.accessToken ?? null,
      refreshToken: data.refreshToken ?? null,
      tokenExpiresAt: data.tokenExpiresAt ?? null,
      lastSyncAt: data.lastSyncAt ?? null,
      lastError: data.lastError ?? null,
      meta: data.meta ?? null,
      createdAt: now, updatedAt: now,
    }).returning().get();
  }
  async updateIntegration(id: string, data: Partial<Integration>): Promise<Integration | undefined> {
    return db.update(integrations)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(integrations.id, id)).returning().get();
  }

  // ---- external refs ----
  async getExternalRef(source: string, externalType: string, externalId: string): Promise<ExternalRef | undefined> {
    return db.select().from(externalRefs).where(and(
      eq(externalRefs.source, source),
      eq(externalRefs.externalType, externalType),
      eq(externalRefs.externalId, externalId),
    )).get();
  }
  async getExternalRefsForEntity(entityType: string, entityId: string): Promise<ExternalRef[]> {
    return db.select().from(externalRefs).where(and(
      eq(externalRefs.entityType, entityType),
      eq(externalRefs.entityId, entityId),
    )).all();
  }
  async getExternalRefByEntity(entityType: string, entityId: string, source: string, externalType: string): Promise<ExternalRef | undefined> {
    return db.select().from(externalRefs).where(and(
      eq(externalRefs.entityType, entityType),
      eq(externalRefs.entityId, entityId),
      eq(externalRefs.source, source),
      eq(externalRefs.externalType, externalType),
    )).get();
  }
  async getExternalRefsByProvider(source: string, externalType?: string): Promise<ExternalRef[]> {
    if (externalType) {
      return db.select().from(externalRefs).where(and(
        eq(externalRefs.source, source),
        eq(externalRefs.externalType, externalType),
      )).all();
    }
    return db.select().from(externalRefs).where(eq(externalRefs.source, source)).all();
  }
  async createExternalRef(r: InsertExternalRef): Promise<ExternalRef> {
    return db.insert(externalRefs).values({
      ...r, id: randomUUID(), createdAt: new Date().toISOString(),
    }).returning().get();
  }

  // ---- hh auto-message log (idempotency guard) ----
  async getAutoMessageLog(nid: string): Promise<AutoMessageLog | undefined> {
    return sqlite
      .prepare("SELECT nid, status, message_count as messageCount, vacancy_title as vacancyTitle, error, sent_at as sentAt FROM auto_message_log WHERE nid = ?")
      .get(nid) as AutoMessageLog | undefined;
  }
  async recordAutoMessageLog(entry: AutoMessageLog): Promise<void> {
    sqlite
      .prepare(`INSERT INTO auto_message_log (nid, status, message_count, vacancy_title, error, sent_at)
                VALUES (@nid, @status, @messageCount, @vacancyTitle, @error, @sentAt)
                ON CONFLICT(nid) DO UPDATE SET
                  status = excluded.status,
                  message_count = excluded.message_count,
                  vacancy_title = excluded.vacancy_title,
                  error = excluded.error,
                  sent_at = excluded.sent_at`)
      .run({
        nid: entry.nid,
        status: entry.status,
        messageCount: entry.messageCount,
        vacancyTitle: entry.vacancyTitle ?? null,
        error: entry.error ?? null,
        sentAt: entry.sentAt,
      });
  }

  // ---- oauth states ----
  async createOauthState(state: string, source: string): Promise<OauthState> {
    return db.insert(oauthStates).values({
      state, source, createdAt: new Date().toISOString(),
    }).returning().get();
  }
  async getOauthState(state: string): Promise<OauthState | undefined> {
    return db.select().from(oauthStates).where(eq(oauthStates.state, state)).get();
  }
  async deleteOauthState(state: string): Promise<void> {
    db.delete(oauthStates).where(eq(oauthStates.state, state)).run();
  }
  async deleteExpiredOauthStates(beforeIso: string): Promise<number> {
    const res = db.delete(oauthStates).where(lt(oauthStates.createdAt, beforeIso)).run();
    return res.changes;
  }

  // ---- webhook events ----
  async createWebhookEvent(e: InsertWebhookEvent): Promise<WebhookEvent> {
    return db.insert(webhookEvents).values({
      ...e, id: randomUUID(), receivedAt: new Date().toISOString(),
    }).returning().get();
  }
  async getWebhookEvent(id: string): Promise<WebhookEvent | undefined> {
    return db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get();
  }
  async getPendingWebhookEvents(limit: number): Promise<WebhookEvent[]> {
    return db.select().from(webhookEvents)
      .where(eq(webhookEvents.status, "pending"))
      .orderBy(webhookEvents.receivedAt).limit(limit).all();
  }
  // Events still worth (re)processing: source match, status pending|failed,
  // attempts under the retry cap. Used by the maintenance cron.
  async getWebhookEventsToProcess(source: string, limit: number, maxAttempts = 5): Promise<WebhookEvent[]> {
    return db.select().from(webhookEvents)
      .where(and(
        eq(webhookEvents.source, source),
        inArray(webhookEvents.status, ["pending", "failed"]),
        lt(webhookEvents.attempts, maxAttempts),
      ))
      .orderBy(webhookEvents.receivedAt).limit(limit).all();
  }
  async updateWebhookEvent(id: string, data: Partial<WebhookEvent>): Promise<WebhookEvent | undefined> {
    return db.update(webhookEvents).set(data).where(eq(webhookEvents.id, id)).returning().get();
  }

  // ---- crm_users ----
  async getCrmUsers(): Promise<CrmUser[]> {
    return db.select().from(crmUsers).all();
  }
  async getCrmUser(id: string): Promise<CrmUser | undefined> {
    return db.select().from(crmUsers).where(eq(crmUsers.id, id)).get();
  }
  async getCrmUserByRole(roleKey: string): Promise<CrmUser | undefined> {
    return db.select().from(crmUsers).where(eq(crmUsers.roleKey, roleKey)).get();
  }
  async upsertCrmUser(user: InsertCrmUser): Promise<CrmUser> {
    const existing = await this.getCrmUser(user.id);
    if (existing) {
      return db.update(crmUsers).set(user).where(eq(crmUsers.id, user.id)).returning().get();
    }
    return db.insert(crmUsers).values({
      ...user, createdAt: new Date().toISOString(),
    }).returning().get();
  }
  async updateCrmUser(id: string, data: Partial<CrmUser>): Promise<CrmUser | undefined> {
    return db.update(crmUsers).set(data).where(eq(crmUsers.id, id)).returning().get();
  }

  // ---- tasks ----
  async getTasks(candidateId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.candidateId, candidateId))
      .orderBy(desc(tasks.createdAt)).all();
  }
  async getTask(id: string): Promise<Task | undefined> {
    return db.select().from(tasks).where(eq(tasks.id, id)).get();
  }
  async createTask(t: InsertTask): Promise<Task> {
    return db.insert(tasks).values({
      ...t, id: randomUUID(), createdAt: new Date().toISOString(),
    }).returning().get();
  }
  async updateTask(id: string, data: Partial<Task>): Promise<Task | undefined> {
    return db.update(tasks).set(data).where(eq(tasks.id, id)).returning().get();
  }

  // ---- scheduled_actions ----
  async getScheduledActions(candidateId: string): Promise<ScheduledAction[]> {
    return db.select().from(scheduledActions).where(eq(scheduledActions.candidateId, candidateId))
      .orderBy(scheduledActions.runAt).all();
  }
  async getPendingScheduledActions(beforeOrAt: string): Promise<ScheduledAction[]> {
    return db.select().from(scheduledActions).where(
      and(
        eq(scheduledActions.status, "pending"),
        lte(scheduledActions.runAt, beforeOrAt),
      )
    ).all();
  }
  async createScheduledAction(a: InsertScheduledAction): Promise<ScheduledAction> {
    return db.insert(scheduledActions).values({
      ...a, id: randomUUID(), createdAt: new Date().toISOString(),
    }).returning().get();
  }
  async updateScheduledAction(id: string, data: Partial<ScheduledAction>): Promise<ScheduledAction | undefined> {
    return db.update(scheduledActions).set(data).where(eq(scheduledActions.id, id)).returning().get();
  }
  async cancelPendingActionsForStage(candidateId: string, triggerStage: string): Promise<void> {
    db.update(scheduledActions)
      .set({ status: "cancelled" })
      .where(and(
        eq(scheduledActions.candidateId, candidateId),
        eq(scheduledActions.triggerStage, triggerStage),
        eq(scheduledActions.status, "pending"),
      )).run();
  }

  // ---- stage_events ----
  async getStageEvents(candidateId: string): Promise<StageEvent[]> {
    return db.select().from(stageEvents).where(eq(stageEvents.candidateId, candidateId))
      .orderBy(desc(stageEvents.changedAt)).all();
  }
  async createStageEvent(e: InsertStageEvent): Promise<StageEvent> {
    return db.insert(stageEvents).values({
      ...e, id: randomUUID(),
    }).returning().get();
  }

  // ---- telegram_links ----
  async getTelegramLink(candidateId: string): Promise<TelegramLink | undefined> {
    return db.select().from(telegramLinks).where(eq(telegramLinks.candidateId, candidateId)).get();
  }
  async upsertTelegramLink(link: TelegramLink): Promise<TelegramLink> {
    const existing = await this.getTelegramLink(link.candidateId);
    if (existing) {
      return db.update(telegramLinks).set(link).where(eq(telegramLinks.candidateId, link.candidateId)).returning().get();
    }
    return db.insert(telegramLinks).values(link).returning().get();
  }

  // ---- app_settings (Iter2) ----
  async getSetting(key: string): Promise<AppSetting | undefined> {
    return db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  }
  async getSettings(): Promise<AppSetting[]> {
    return db.select().from(appSettings).all();
  }
  async upsertSetting(key: string, value: string): Promise<AppSetting> {
    const existing = await this.getSetting(key);
    if (existing) {
      return db.update(appSettings).set({ value }).where(eq(appSettings.key, key)).returning().get();
    }
    return db.insert(appSettings).values({ key, value }).returning().get();
  }

  // ---- candidate helpers (Iter2) ----
  async getCandidatesByPhone(phone: string): Promise<Candidate[]> {
    return db.select().from(candidates).where(eq(candidates.phone, phone)).all();
  }
  async getCandidatesByFullName(fullName: string, city?: string): Promise<Candidate[]> {
    let rows = db.select().from(candidates).where(eq(candidates.fullName, fullName)).all();
    if (city) rows = rows.filter((r) => r.city === city);
    return rows;
  }

  // ---- Iter3: channel_settings ----
  async getChannelSettings(): Promise<ChannelSettings | undefined> {
    return db.select().from(channelSettings).limit(1).get();
  }
  async upsertChannelSettings(data: Partial<ChannelSettings>): Promise<ChannelSettings> {
    const now = new Date().toISOString();
    const existing = await this.getChannelSettings();
    if (existing) {
      return db.update(channelSettings)
        .set({ ...data, updatedAt: now })
        .where(eq(channelSettings.id, existing.id))
        .returning().get();
    }
    return db.insert(channelSettings).values({
      channelUsername: data.channelUsername ?? "@SkinLineHR",
      channelTitle: data.channelTitle ?? "Skin Line | HR",
      autopilotEnabled: data.autopilotEnabled ?? 0,
      postsPerWeek: data.postsPerWeek ?? 2,
      preferredHours: data.preferredHours ?? "[10,14,18]",
      preferredDays: data.preferredDays ?? "[1,3,5]",
      lastPostAt: data.lastPostAt ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning().get();
  }

  // ---- Iter3: content_rubrics ----
  async getContentRubrics(): Promise<ContentRubric[]> {
    return db.select().from(contentRubrics).all();
  }
  async getContentRubric(key: string): Promise<ContentRubric | undefined> {
    return db.select().from(contentRubrics).where(eq(contentRubrics.key, key)).get();
  }
  async upsertContentRubric(rubric: ContentRubric): Promise<ContentRubric> {
    const existing = await this.getContentRubric(rubric.key);
    if (existing) {
      return db.update(contentRubrics).set(rubric).where(eq(contentRubrics.key, rubric.key)).returning().get();
    }
    return db.insert(contentRubrics).values(rubric).returning().get();
  }
  async updateContentRubric(key: string, data: Partial<ContentRubric>): Promise<ContentRubric | undefined> {
    return db.update(contentRubrics).set(data).where(eq(contentRubrics.key, key)).returning().get();
  }

  // ---- Iter3: channel_posts ----
  async getChannelPosts(filters?: { status?: string; from?: string; to?: string }): Promise<ChannelPost[]> {
    let rows = db.select().from(channelPosts).orderBy(desc(channelPosts.createdAt)).all();
    if (filters?.status) rows = rows.filter((r) => r.status === filters.status);
    if (filters?.from) rows = rows.filter((r) => r.scheduledAt != null && r.scheduledAt >= filters.from!);
    if (filters?.to) rows = rows.filter((r) => r.scheduledAt != null && r.scheduledAt <= filters.to!);
    return rows;
  }
  async getChannelPost(id: string): Promise<ChannelPost | undefined> {
    return db.select().from(channelPosts).where(eq(channelPosts.id, id)).get();
  }
  async createChannelPost(post: Omit<ChannelPost, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChannelPost> {
    const now = new Date().toISOString();
    return db.insert(channelPosts).values({
      ...post,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }).returning().get();
  }
  async updateChannelPost(id: string, data: Partial<ChannelPost>): Promise<ChannelPost | undefined> {
    return db.update(channelPosts)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(channelPosts.id, id))
      .returning().get();
  }
  async deleteChannelPost(id: string): Promise<void> {
    db.delete(channelPosts).where(eq(channelPosts.id, id)).run();
  }
  async getScheduledChannelPosts(beforeOrAt: string): Promise<ChannelPost[]> {
    return db.select().from(channelPosts).where(
      and(
        eq(channelPosts.status, "scheduled"),
        lte(channelPosts.scheduledAt, beforeOrAt),
      )
    ).all();
  }

  // ---- Iter3: channel_subscribers ----
  async getChannelSubscribers(limit = 50): Promise<ChannelSubscriber[]> {
    return db.select().from(channelSubscribers)
      .orderBy(desc(channelSubscribers.joinedAt))
      .limit(limit).all();
  }
  async upsertChannelSubscriber(sub: ChannelSubscriber): Promise<ChannelSubscriber> {
    const existing = await this.getChannelSubscriber(sub.chatId);
    if (existing) {
      return db.update(channelSubscribers).set(sub).where(eq(channelSubscribers.chatId, sub.chatId)).returning().get();
    }
    return db.insert(channelSubscribers).values(sub).returning().get();
  }
  async getChannelSubscriber(chatId: string): Promise<ChannelSubscriber | undefined> {
    return db.select().from(channelSubscribers).where(eq(channelSubscribers.chatId, chatId)).get();
  }
  async updateChannelSubscriber(chatId: string, data: Partial<ChannelSubscriber>): Promise<ChannelSubscriber | undefined> {
    return db.update(channelSubscribers).set(data).where(eq(channelSubscribers.chatId, chatId)).returning().get();
  }

  // ---- Iter3: channel_metrics ----
  async getChannelMetrics(postId: string): Promise<ChannelMetric[]> {
    return db.select().from(channelMetrics).where(eq(channelMetrics.postId, postId)).all();
  }
  async insertChannelMetric(metric: ChannelMetric): Promise<void> {
    try {
      db.insert(channelMetrics).values(metric).run();
    } catch {
      // ignore duplicate PK
    }
  }

  // ---- Iter3: reserve_reactivation ----
  async getReserveReactivations(limit = 50): Promise<ReserveReactivation[]> {
    return db.select().from(reserveReactivation)
      .orderBy(desc(reserveReactivation.createdAt))
      .limit(limit).all();
  }
  async createReserveReactivation(r: Omit<ReserveReactivation, 'id' | 'createdAt'>): Promise<ReserveReactivation> {
    return db.insert(reserveReactivation).values({
      ...r,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }).returning().get();
  }
  async updateReserveReactivation(id: string, data: Partial<ReserveReactivation>): Promise<ReserveReactivation | undefined> {
    return db.update(reserveReactivation).set(data).where(eq(reserveReactivation.id, id)).returning().get();
  }

  // ---- Iter3: candidates in reserve older than N days ----
  async getCandidatesByStageOlderThan(stage: string, olderThanDays: number): Promise<Candidate[]> {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    return db.select().from(candidates).where(
      and(
        eq(candidates.stage, stage),
        lt(candidates.lastStageAt, cutoff),
      )
    ).all();
  }

  // ---- Iter4: quizzes ----
  async getQuizzes(): Promise<Quiz[]> {
    return db.select().from(quizzes).all();
  }
  async getQuiz(id: string): Promise<Quiz | undefined> {
    return db.select().from(quizzes).where(eq(quizzes.id, id)).get();
  }
  async getQuizByTriggerStage(triggerStage: string): Promise<Quiz | undefined> {
    return db.select().from(quizzes).where(
      and(eq(quizzes.triggerStage, triggerStage), eq(quizzes.active, 1))
    ).get();
  }
  async createQuiz(data: InsertQuiz): Promise<Quiz> {
    const now = new Date().toISOString();
    return db.insert(quizzes).values({
      ...data, id: randomUUID(), createdAt: now, updatedAt: now,
    }).returning().get();
  }
  async updateQuiz(id: string, data: Partial<InsertQuiz>): Promise<Quiz | undefined> {
    return db.update(quizzes).set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(quizzes.id, id)).returning().get();
  }

  // ---- Iter4: quiz_questions ----
  async getQuizQuestions(quizId: string): Promise<QuizQuestion[]> {
    return db.select().from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position).all();
  }
  async getQuizQuestion(id: string): Promise<QuizQuestion | undefined> {
    return db.select().from(quizQuestions).where(eq(quizQuestions.id, id)).get();
  }
  async createQuizQuestion(data: InsertQuizQuestion): Promise<QuizQuestion> {
    return db.insert(quizQuestions).values({ ...data, id: randomUUID() }).returning().get();
  }
  async updateQuizQuestion(id: string, data: Partial<InsertQuizQuestion>): Promise<QuizQuestion | undefined> {
    return db.update(quizQuestions).set(data).where(eq(quizQuestions.id, id)).returning().get();
  }
  async deleteQuizQuestion(id: string): Promise<void> {
    db.delete(quizQuestions).where(eq(quizQuestions.id, id)).run();
  }

  // ---- Iter4: quiz_attempts ----
  async getQuizAttempts(candidateId: string): Promise<QuizAttempt[]> {
    return db.select().from(quizAttempts)
      .where(eq(quizAttempts.candidateId, candidateId))
      .orderBy(desc(quizAttempts.startedAt)).all();
  }
  async getQuizAttempt(id: string): Promise<QuizAttempt | undefined> {
    return db.select().from(quizAttempts).where(eq(quizAttempts.id, id)).get();
  }
  async getActiveQuizAttempt(candidateId: string, quizId: string): Promise<QuizAttempt | undefined> {
    return db.select().from(quizAttempts).where(
      and(
        eq(quizAttempts.candidateId, candidateId),
        eq(quizAttempts.quizId, quizId),
        eq(quizAttempts.status, "in_progress"),
      )
    ).get();
  }
  async createQuizAttempt(data: InsertQuizAttempt): Promise<QuizAttempt> {
    return db.insert(quizAttempts).values({ ...data, id: randomUUID() }).returning().get();
  }
  async updateQuizAttempt(id: string, data: Partial<QuizAttempt>): Promise<QuizAttempt | undefined> {
    return db.update(quizAttempts).set(data).where(eq(quizAttempts.id, id)).returning().get();
  }

  // ---- Iter4: document by file hash (anti-fake) ----
  async getDocumentByFileHash(fileHash: string): Promise<Document | undefined> {
    return db.select().from(documents).where(eq(documents.fileHash, fileHash)).get();
  }

  // ---- Iter5: probation_tracks ----
  async getProbationTracks(filters?: { status?: string }): Promise<ProbationTrack[]> {
    let rows = db.select().from(probationTracks).orderBy(desc(probationTracks.createdAt)).all();
    if (filters?.status) rows = rows.filter((r) => r.status === filters.status);
    return rows;
  }
  async getProbationTrack(id: string): Promise<ProbationTrack | undefined> {
    return db.select().from(probationTracks).where(eq(probationTracks.id, id)).get();
  }
  async getProbationTrackByCandidate(candidateId: string): Promise<ProbationTrack | undefined> {
    return db.select().from(probationTracks)
      .where(and(eq(probationTracks.candidateId, candidateId), eq(probationTracks.status, "active")))
      .get();
  }
  async createProbationTrack(data: InsertProbationTrack): Promise<ProbationTrack> {
    const now = new Date().toISOString();
    return db.insert(probationTracks).values({ ...data, id: randomUUID(), createdAt: now, updatedAt: now }).returning().get();
  }
  async updateProbationTrack(id: string, data: Partial<ProbationTrack>): Promise<ProbationTrack | undefined> {
    return db.update(probationTracks).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(probationTracks.id, id)).returning().get();
  }
  async getCheckpoints(trackId: string): Promise<ProbationCheckpoint[]> {
    return db.select().from(probationCheckpoints)
      .where(eq(probationCheckpoints.trackId, trackId))
      .orderBy(probationCheckpoints.dayNumber).all();
  }
  async createCheckpoint(data: InsertProbationCheckpoint): Promise<ProbationCheckpoint> {
    return db.insert(probationCheckpoints).values({ ...data, id: randomUUID() }).returning().get();
  }
  async updateCheckpoint(id: string, data: Partial<ProbationCheckpoint>): Promise<ProbationCheckpoint | undefined> {
    return db.update(probationCheckpoints).set(data).where(eq(probationCheckpoints.id, id)).returning().get();
  }

  // ---- Iter5: pulse_surveys ----
  async getPulseSurveys(): Promise<PulseSurvey[]> {
    return db.select().from(pulseSurveys).all();
  }
  async getPulseSurveyByDay(dayNumber: number): Promise<PulseSurvey | undefined> {
    return db.select().from(pulseSurveys)
      .where(and(eq(pulseSurveys.dayNumber, dayNumber), eq(pulseSurveys.active, 1)))
      .get();
  }
  async createPulseSurvey(data: InsertPulseSurvey): Promise<PulseSurvey> {
    return db.insert(pulseSurveys).values({ ...data, id: randomUUID() }).returning().get();
  }
  async getPulseResponses(candidateId: string): Promise<PulseResponse[]> {
    return db.select().from(pulseResponses)
      .where(eq(pulseResponses.candidateId, candidateId))
      .orderBy(desc(pulseResponses.createdAt)).all();
  }
  async createPulseResponse(data: InsertPulseResponse): Promise<PulseResponse> {
    return db.insert(pulseResponses).values({ ...data, id: randomUUID(), createdAt: new Date().toISOString() }).returning().get();
  }
  async updatePulseResponse(id: string, data: Partial<PulseResponse>): Promise<PulseResponse | undefined> {
    return db.update(pulseResponses).set(data).where(eq(pulseResponses.id, id)).returning().get();
  }
  async getRecentPulseResponsesWithLowRating(avgRatingThreshold: number, hoursBack: number): Promise<PulseResponse[]> {
    const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();
    const all = db.select().from(pulseResponses).where(gte(pulseResponses.createdAt, since)).all();
    return all.filter((r) => r.avgRating !== null && parseFloat(r.avgRating ?? "99") < avgRatingThreshold);
  }

  // ---- Iter5: reserve_pool ----
  async getReservePool(filters?: { status?: string }): Promise<ReservePool[]> {
    let rows = db.select().from(reservePool).orderBy(desc(reservePool.addedAt)).all();
    if (filters?.status) rows = rows.filter((r) => r.status === filters.status);
    return rows;
  }
  async getReservePoolEntry(id: string): Promise<ReservePool | undefined> {
    return db.select().from(reservePool).where(eq(reservePool.id, id)).get();
  }
  async getReservePoolByCandidate(candidateId: string): Promise<ReservePool | undefined> {
    return db.select().from(reservePool).where(eq(reservePool.candidateId, candidateId)).get();
  }
  async createReservePoolEntry(data: InsertReservePool): Promise<ReservePool> {
    return db.insert(reservePool).values({ ...data, id: randomUUID(), addedAt: new Date().toISOString() }).returning().get();
  }
  async updateReservePoolEntry(id: string, data: Partial<ReservePool>): Promise<ReservePool | undefined> {
    return db.update(reservePool).set(data).where(eq(reservePool.id, id)).returning().get();
  }
  async getStaleReserveEntries(daysThreshold: number): Promise<ReservePool[]> {
    const cutoff = new Date(Date.now() - daysThreshold * 24 * 3600 * 1000).toISOString();
    const all = db.select().from(reservePool).where(eq(reservePool.status, "active")).all();
    return all.filter((r) => {
      const lastContact = r.lastContactedAt ?? r.addedAt;
      return lastContact < cutoff;
    });
  }

  // ---- Iter5: referral_codes ----
  async getReferralCodes(filters?: { userId?: string; candidateId?: string }): Promise<ReferralCode[]> {
    let rows = db.select().from(referralCodes).all();
    if (filters?.userId) rows = rows.filter((r) => r.userId === filters.userId);
    if (filters?.candidateId) rows = rows.filter((r) => r.candidateId === filters.candidateId);
    return rows;
  }
  async getReferralCodeByCode(code: string): Promise<ReferralCode | undefined> {
    return db.select().from(referralCodes).where(eq(referralCodes.code, code)).get();
  }
  async getReferralCode(id: string): Promise<ReferralCode | undefined> {
    return db.select().from(referralCodes).where(eq(referralCodes.id, id)).get();
  }
  async createReferralCode(data: InsertReferralCode): Promise<ReferralCode> {
    return db.insert(referralCodes).values({ ...data, id: randomUUID(), createdAt: new Date().toISOString() }).returning().get();
  }
  async getReferrals(filters?: { codeId?: string; status?: string }): Promise<Referral[]> {
    let rows = db.select().from(referrals).orderBy(desc(referrals.createdAt)).all();
    if (filters?.codeId) rows = rows.filter((r) => r.codeId === filters.codeId);
    if (filters?.status) rows = rows.filter((r) => r.status === filters.status);
    return rows;
  }
  async getReferralByCandidate(candidateId: string): Promise<Referral | undefined> {
    return db.select().from(referrals).where(eq(referrals.candidateId, candidateId)).get();
  }
  async createReferral(data: InsertReferral): Promise<Referral> {
    return db.insert(referrals).values({ ...data, id: randomUUID(), createdAt: new Date().toISOString() }).returning().get();
  }
  async updateReferral(id: string, data: Partial<Referral>): Promise<Referral | undefined> {
    return db.update(referrals).set(data).where(eq(referrals.id, id)).returning().get();
  }

  // ---- Iter5: alerts ----
  async getAlerts(filters?: { severity?: string; type?: string; resolved?: boolean }): Promise<Alert[]> {
    let rows = db.select().from(alerts).orderBy(desc(alerts.createdAt)).all();
    if (filters?.severity) rows = rows.filter((r) => r.severity === filters.severity);
    if (filters?.type) rows = rows.filter((r) => r.type === filters.type);
    if (filters?.resolved === true) rows = rows.filter((r) => r.resolvedAt !== null);
    if (filters?.resolved === false) rows = rows.filter((r) => r.resolvedAt === null);
    return rows;
  }
  async getAlert(id: string): Promise<Alert | undefined> {
    return db.select().from(alerts).where(eq(alerts.id, id)).get();
  }
  async createAlert(data: InsertAlert): Promise<Alert> {
    return db.insert(alerts).values({ ...data, id: randomUUID(), createdAt: new Date().toISOString() }).returning().get();
  }
  async resolveAlert(id: string, resolvedBy: string): Promise<Alert | undefined> {
    return db.update(alerts).set({ resolvedAt: new Date().toISOString(), resolvedBy }).where(eq(alerts.id, id)).returning().get();
  }
  async countUnresolvedAlerts(): Promise<number> {
    return db.select().from(alerts).all().filter((r) => r.resolvedAt === null).length;
  }
  async getPulseSurveysCount(): Promise<number> {
    return db.select().from(pulseSurveys).all().length;
  }

  // ---- Dream Job: company_ratings ----
  async getLatestCompanyRating(source = "dreamjob"): Promise<CompanyRating | undefined> {
    return db.select().from(companyRatings)
      .where(eq(companyRatings.source, source))
      .orderBy(desc(companyRatings.fetchedAt))
      .limit(1).get();
  }
  async getCompanyRatingHistory(source = "dreamjob", limit = 12): Promise<CompanyRating[]> {
    return db.select().from(companyRatings)
      .where(eq(companyRatings.source, source))
      .orderBy(desc(companyRatings.fetchedAt))
      .limit(limit).all();
  }
  async createCompanyRating(data: InsertCompanyRating): Promise<CompanyRating> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = { ...data, id: randomUUID() } as any;
    return db.insert(companyRatings).values(row).returning().get();
  }

  // ---- Iter6: scorecard_templates ----
  async getScorecardTemplates(filters?: { role?: string; active?: boolean }): Promise<ScorecardTemplate[]> {
    let rows = db.select().from(scorecardTemplates).orderBy(desc(scorecardTemplates.createdAt)).all();
    if (filters?.role) rows = rows.filter((r) => r.role === filters.role);
    if (filters?.active !== undefined) rows = rows.filter((r) => r.active === (filters.active ? 1 : 0));
    return rows;
  }
  async getScorecardTemplate(id: string): Promise<ScorecardTemplate | undefined> {
    return db.select().from(scorecardTemplates).where(eq(scorecardTemplates.id, id)).get();
  }
  async createScorecardTemplate(data: InsertScorecardTemplate): Promise<ScorecardTemplate> {
    const now = new Date().toISOString();
    return db.insert(scorecardTemplates).values({ ...data, id: randomUUID(), createdAt: now, updatedAt: now }).returning().get();
  }
  async updateScorecardTemplate(id: string, data: Partial<InsertScorecardTemplate>): Promise<ScorecardTemplate | undefined> {
    return db.update(scorecardTemplates).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(scorecardTemplates.id, id)).returning().get();
  }
  async countScorecardTemplates(): Promise<number> {
    return db.select().from(scorecardTemplates).all().length;
  }

  // ---- Iter6: scorecard_responses ----
  async getScorecardResponses(filters?: { candidateId?: string; stage?: string; templateId?: string }): Promise<ScorecardResponse[]> {
    let rows = db.select().from(scorecardResponses).orderBy(desc(scorecardResponses.createdAt)).all();
    if (filters?.candidateId) rows = rows.filter((r) => r.candidateId === filters.candidateId);
    if (filters?.stage) rows = rows.filter((r) => r.stage === filters.stage);
    if (filters?.templateId) rows = rows.filter((r) => r.templateId === filters.templateId);
    return rows;
  }
  async getScorecardResponse(id: string): Promise<ScorecardResponse | undefined> {
    return db.select().from(scorecardResponses).where(eq(scorecardResponses.id, id)).get();
  }
  async createScorecardResponse(data: InsertScorecardResponse): Promise<ScorecardResponse> {
    const now = new Date().toISOString();
    return db.insert(scorecardResponses).values({ ...data, id: randomUUID(), createdAt: now, updatedAt: now }).returning().get();
  }
  async updateScorecardResponse(id: string, data: Partial<InsertScorecardResponse>): Promise<ScorecardResponse | undefined> {
    return db.update(scorecardResponses).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(scorecardResponses.id, id)).returning().get();
  }

  // ---- Iter6: interview_videos ----
  async getInterviewVideos(filters?: { candidateId?: string; status?: string }): Promise<InterviewVideo[]> {
    let rows = db.select().from(interviewVideos).orderBy(desc(interviewVideos.createdAt)).all();
    if (filters?.candidateId) rows = rows.filter((r) => r.candidateId === filters.candidateId);
    if (filters?.status) rows = rows.filter((r) => r.status === filters.status);
    return rows;
  }
  async getInterviewVideo(id: string): Promise<InterviewVideo | undefined> {
    return db.select().from(interviewVideos).where(eq(interviewVideos.id, id)).get();
  }
  async createInterviewVideo(data: InsertInterviewVideo): Promise<InterviewVideo> {
    const now = new Date().toISOString();
    return db.insert(interviewVideos).values({ ...data, id: randomUUID(), createdAt: now, updatedAt: now }).returning().get();
  }
  async updateInterviewVideo(id: string, data: Partial<InsertInterviewVideo>): Promise<InterviewVideo | undefined> {
    return db.update(interviewVideos).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(interviewVideos.id, id)).returning().get();
  }
  async getPendingInterviewVideos(limit = 2): Promise<InterviewVideo[]> {
    return db.select().from(interviewVideos)
      .where(eq(interviewVideos.status, "pending"))
      .orderBy(interviewVideos.createdAt)
      .limit(limit).all();
  }
}

export const storage = new DatabaseStorage();

// ============ SEED ============
const CRM_USER_DEFS: Array<{ id: string; name: string; roleKey: string; telegramUsername: string | null; telegramChatId: string | null; email: string | null }> = [
  { id: "u_hr", name: "HR-менеджер", roleKey: "hr_manager", telegramUsername: "HR_SKIN_LINE", telegramChatId: null, email: null },
  { id: "u_uk", name: "Дарья (Сотрудник УК)", roleKey: "uk", telegramUsername: "daryaalexandrovna98", telegramChatId: null, email: null },
  { id: "u_t1", name: "Махпура (Тренер 1)", roleKey: "trainer_1", telegramUsername: "dr_Abdullaeva_Mahpura", telegramChatId: null, email: null },
  { id: "u_t2", name: "Виктория (Тренер 2)", roleKey: "trainer_2", telegramUsername: "Viktoriya_vi_a", telegramChatId: null, email: null },
  { id: "u_mgr", name: "Управляющая", roleKey: "manager", telegramUsername: "VictoriaShkeneva", telegramChatId: null, email: null },
  { id: "u_dina", name: "Дина", roleKey: "ops", telegramUsername: null, telegramChatId: null, email: null },
  { id: "u_tamara", name: "Тамара", roleKey: "ops", telegramUsername: null, telegramChatId: null, email: null },
];

function iso(daysAgo: number, hour = 10, min = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

export function seedDatabase() {
  const existing = db.select().from(vacancies).all();

  // Seed crm_users idempotently. onConflictDoNothing keeps this safe on an
  // existing DB where the rows are already (partially) present — a duplicate
  // primary key must never throw and crash startup.
  const now = new Date().toISOString();
  for (const u of CRM_USER_DEFS) {
    db.insert(crmUsers).values({ ...u, createdAt: now }).onConflictDoNothing().run();
  }

  // Init app_settings defaults (idempotent)
  const settingRows = db.select().from(appSettings).all();
  const settingKeys = new Set(settingRows.map((s) => s.key));
  if (!settingKeys.has("ai_chat_enabled")) {
    db.insert(appSettings).values({ key: "ai_chat_enabled", value: "false" }).run();
  }
  if (!settingKeys.has("ai_screening_enabled")) {
    db.insert(appSettings).values({ key: "ai_screening_enabled", value: "true" }).run();
  }

  if (existing.length > 0) return;

  // ---- Vacancies (5) ----
  const vacancyDefs = [
    { id: randomUUID(), title: "Мастер лазерной эпиляции", city: "Чебоксары", salary: "от 80 000 ₽", status: "active", description: "Мастер лазерной эпиляции в сеть студий Skin Line. График 2/2, обучение от компании.", externalUrl: null },
    { id: randomUUID(), title: "Мастер лазерной эпиляции", city: "Йошкар-Ола", salary: "от 75 000 ₽", status: "active", description: "Мастер лазерной эпиляции в Skin Line. Стабильный доход, клиентская база.", externalUrl: null },
    { id: randomUUID(), title: "Мастер лазерной эпиляции", city: "Казань", salary: "от 90 000 ₽", status: "active", description: "Мастер лазерной эпиляции в студию Skin Line в Казани. Опыт приветствуется.", externalUrl: null },
    { id: randomUUID(), title: "Мастер лазерной эпиляции", city: "Воронеж", salary: "от 70 000 ₽", status: "active", description: "Приглашаем мастера лазерной эпиляции в Skin Line Воронеж.", externalUrl: null },
    { id: randomUUID(), title: "Мастер лазерной эпиляции", city: "Киров", salary: "от 72 000 ₽", status: "paused", description: "Мастер лазерной эпиляции в студию Skin Line. Обучение за счёт компании.", externalUrl: null },
  ];
  db.insert(vacancies).values(vacancyDefs).run();
  const [vCheb, vYosh, vKaz, vVor, vKir] = vacancyDefs;

  const CITIES_SKIN_LINE = [
    "Чебоксары", "Йошкар-Ола", "Казань", "Воронеж", "Липецк",
    "Киров", "Курск", "Набережные Челны", "Новочебоксарск", "Сургут",
  ];

  type SeedC = {
    name: string; phone: string; email: string | null; city: string; vacancy: typeof vacancyDefs[0];
    source: string; stage: string; exp: string; expected: string | null; tags: string[];
  };

  // 15 candidates distributed across 14 stages per spec
  const seeds: SeedC[] = [
    // form_filled: 3
    { name: "Анна Иванова", phone: "+7 916 123-45-67", email: "anna@mail.ru", city: "Чебоксары", vacancy: vCheb, source: "avito", stage: "form_filled", exp: "1 год", expected: null, tags: ["Чебоксары"] },
    { name: "Екатерина Петрова", phone: "+7 921 234-56-78", email: null, city: "Йошкар-Ола", vacancy: vYosh, source: "hh", stage: "form_filled", exp: "без опыта", expected: null, tags: ["Йошкар-Ола"] },
    { name: "Мария Соколова", phone: "+7 917 345-67-89", email: "m.s@gmail.com", city: "Казань", vacancy: vKaz, source: "manual", stage: "form_filled", exp: "2 года", expected: null, tags: ["Казань"] },
    // in_work: 2
    { name: "Ольга Кузнецова", phone: "+7 905 456-78-90", email: null, city: "Воронеж", vacancy: vVor, source: "avito", stage: "in_work", exp: "3 года", expected: "75 000 ₽", tags: ["Воронеж"] },
    { name: "Наталья Морозова", phone: "+7 926 567-89-01", email: "nat@ya.ru", city: "Липецк", vacancy: vCheb, source: "hh", stage: "in_work", exp: "1 год", expected: null, tags: ["Липецк"] },
    // video_interview: 2
    { name: "Юлия Васильева", phone: "+7 903 678-90-12", email: null, city: "Киров", vacancy: vKir, source: "avito", stage: "video_interview", exp: "2 года", expected: "70 000 ₽", tags: ["Киров"] },
    { name: "Светлана Орлова", phone: "+7 911 789-01-23", email: "sv@mail.ru", city: "Курск", vacancy: vVor, source: "hh", stage: "video_interview", exp: "4 года", expected: "80 000 ₽", tags: ["Курск"] },
    // studio_demo: 1
    { name: "Дарья Никитина", phone: "+7 918 890-12-34", email: null, city: "Набережные Челны", vacancy: vKaz, source: "manual", stage: "studio_demo", exp: "3 года", expected: "85 000 ₽", tags: ["Набережные Челны"] },
    // theory: 2
    { name: "Алина Смирнова", phone: "+7 902 901-23-45", email: "alina@gmail.com", city: "Новочебоксарск", vacancy: vCheb, source: "avito", stage: "theory", exp: "1 год", expected: null, tags: ["Новочебоксарск"] },
    { name: "Виктория Лебедева", phone: "+7 925 012-34-56", email: null, city: "Сургут", vacancy: vYosh, source: "hh", stage: "theory", exp: "2 года", expected: "90 000 ₽", tags: ["Сургут"] },
    // exam_scheduled: 1
    { name: "Татьяна Зайцева", phone: "+7 909 123-45-67", email: "t.z@mail.ru", city: "Чебоксары", vacancy: vCheb, source: "avito", stage: "exam_scheduled", exp: "3 года", expected: "80 000 ₽", tags: ["Чебоксары"] },
    // reexam: 1
    { name: "Елена Попова", phone: "+7 916 234-56-78", email: null, city: "Йошкар-Ола", vacancy: vYosh, source: "hh", stage: "reexam", exp: "2 года", expected: null, tags: ["Йошкар-Ола"] },
    // trainer_onboarding: 1
    { name: "Кристина Волкова", phone: "+7 921 345-67-89", email: "k.v@ya.ru", city: "Казань", vacancy: vKaz, source: "manual", stage: "trainer_onboarding", exp: "5 лет", expected: "95 000 ₽", tags: ["Казань"] },
    // scheduled: 1
    { name: "Полина Соловьёва", phone: "+7 917 456-78-90", email: null, city: "Воронеж", vacancy: vVor, source: "avito", stage: "scheduled", exp: "4 года", expected: "85 000 ₽", tags: ["Воронеж"] },
    // rejected: 1
    { name: "Алёна Козлова", phone: "+7 905 567-89-01", email: null, city: "Чебоксары", vacancy: vCheb, source: "avito", stage: "rejected", exp: "без опыта", expected: null, tags: ["Чебоксары"] },
  ];

  const msgInbound = [
    "Здравствуйте! Видела вашу вакансию, очень заинтересована.",
    "Подскажите, какой график работы и условия?",
    "Да, у меня есть сертификаты.",
    "Удобно созвониться завтра после 15:00?",
    "Спасибо за информацию, жду приглашение на собеседование.",
    "Готова приехать на демо-погружение в любой день.",
  ];
  const msgOutbound = [
    "Добрый день! Спасибо за отклик. Расскажите о вашем опыте?",
    "Обучение проводится за счёт компании, график 2/2.",
    "Отлично! Приглашаем вас на онлайн-собеседование.",
    "Можете заполнить анкету по ссылке?",
    "Записали вас на демо-погружение, ждём!",
    "Хорошего дня! Будем на связи.",
  ];

  let dayCounter = 0;
  for (const s of seeds) {
    dayCounter += 1;
    const created = iso(20 - dayCounter % 18, 9 + (dayCounter % 6));
    const cand = db.insert(candidates).values({
      id: randomUUID(),
      fullName: s.name,
      phone: s.phone,
      email: s.email,
      city: s.city,
      vacancyId: s.vacancy.id,
      source: s.source,
      sourceUrl: s.source === "avito" ? "https://www.avito.ru/moskva/rezume/master" :
                 s.source === "hh" ? "https://hh.ru/resume/example" : null,
      stage: s.stage,
      experience: s.exp,
      expectedSalary: s.expected,
      rating: null,
      notes: null,
      tags: JSON.stringify(s.tags),
      rejectReason: null,
      avatarUrl: null,
      createdAt: created,
      telegramChatId: null,
      linkToken: null,
      lastStageAt: created,
    }).returning().get();

    // messages: 2-5
    const nMsgs = 2 + (dayCounter % 4);
    for (let i = 0; i < nMsgs; i++) {
      const outbound = i % 2 === 1;
      db.insert(messages).values({
        id: randomUUID(),
        candidateId: cand.id,
        channel: "telegram",
        direction: outbound ? "out" : "in",
        text: outbound ? msgOutbound[i % msgOutbound.length] : msgInbound[i % msgInbound.length],
        sentAt: iso(15 - dayCounter % 12, 10 + i, i * 7 % 60),
        isRead: 1,
      }).run();
    }

    // activities: 1-3
    db.insert(activities).values({
      id: randomUUID(), candidateId: cand.id, type: "stage_change",
      description: `Кандидат добавлен из источника ${s.source === "avito" ? "Avito" : s.source === "hh" ? "hh.ru" : "вручную"}`,
      createdAt: created, meta: null,
    }).run();
  }

  console.log("[seed] Database seeded: 5 vacancies, 15 candidates, 7 crm_users.");

  // ---- Iter3: Seed channel_settings (idempotent) ----
  const chSettings = db.select().from(channelSettings).limit(1).get();
  if (!chSettings) {
    const nowSeed = new Date().toISOString();
    db.insert(channelSettings).values({
      channelUsername: "@SkinLineHR",
      channelTitle: "Skin Line | HR",
      autopilotEnabled: 0,
      postsPerWeek: 2,
      preferredHours: "[10,14,18]",
      preferredDays: "[1,3,5]",
      lastPostAt: null,
      createdAt: nowSeed,
      updatedAt: nowSeed,
    }).run();
    console.log("[seed] channel_settings seeded.");
  }

  // ---- Iter3: Seed content_rubrics (idempotent) ----
  const existingRubrics = db.select().from(contentRubrics).all();
  if (existingRubrics.length === 0) {
    const rubricDefs: Array<{ key: string; name: string; description: string; weight: number; active: number }> = [
      { key: "studio_life", name: "Жизнь студии", description: "Закулисье, день мастера, оборудование, эстетика студии. Покажи, как красиво и уютно работать в Skin Line.", weight: 3, active: 1 },
      { key: "review", name: "Отзывы", description: "Реальные истории сотрудников от первого лица: как пришли, чему научились, что нравится.", weight: 2, active: 1 },
      { key: "tips", name: "Советы", description: "Навыки косметолога, тонкости лазерной эпиляции, профессиональное развитие, обучение.", weight: 3, active: 1 },
      { key: "poll", name: "Опросы", description: "Вовлечение аудитории через опросы: о карьере, о предпочтениях в работе, о мечтах.", weight: 1, active: 1 },
      { key: "vacancy", name: "Вакансии", description: "Приглашение присоединиться к команде Skin Line: условия, преимущества, ссылка на бота.", weight: 1, active: 1 },
    ];
    for (const r of rubricDefs) {
      db.insert(contentRubrics).values(r).run();
    }
    console.log("[seed] content_rubrics seeded (5 rows).");
  }
  // ---- Iter4: Seed quiz (idempotent) ----
  const existingQuizzes = db.select().from(quizzes).all();
  if (existingQuizzes.length === 0) {
    const nowSeed = new Date().toISOString();
    const quizId = randomUUID();
    db.insert(quizzes).values({
      id: quizId,
      title: "Базовая теория лазерной эпиляции",
      description: "Проверь своё понимание базовых концепций лазерной эпиляции перед экзаменом.",
      active: 1,
      triggerStage: "theory",
      passingScore: 75,
      createdAt: nowSeed,
      updatedAt: nowSeed,
    }).run();

    const questionDefs = [
      {
        position: 0,
        text: "Какой тип лазера наиболее эффективен для фототипов кожи I-III (светлая кожа, тёмные волосы)?",
        options: JSON.stringify(["Nd:YAG 1064 нм", "Александритовый 755 нм", "Диодный 810 нм", "Рубиновый 694 нм"]),
        correctIndex: 1,
        explanation: "Александритовый лазер (755 нм) идеален для светлой кожи с тёмными волосами: хорошо поглощается меланином волоса при минимальном воздействии на кожу.",
      },
      {
        position: 1,
        text: "Для какого фототипа кожи (по Фицпатрику) наиболее безопасен Nd:YAG 1064 нм?",
        options: JSON.stringify(["I–II (очень светлая, светлая)", "III–IV (смуглая, оливковая)", "V–VI (тёмно-коричневая, чёрная)", "Для всех одинаково"]),
        correctIndex: 2,
        explanation: "Nd:YAG 1064 нм имеет минимальное поглощение меланином кожи и глубокое проникновение — оптимален для V–VI фототипов.",
      },
      {
        position: 2,
        text: "Какое из следующих состояний является АБСОЛЮТНЫМ противопоказанием к лазерной эпиляции?",
        options: JSON.stringify(["Беременность", "Незначительный загар 2-недельной давности", "Небольшой порез в зоне обработки", "Сухость кожи"]),
        correctIndex: 0,
        explanation: "Беременность — абсолютное противопоказание: влияние лазерного излучения на плод не изучено, процедура недопустима на весь срок.",
      },
      {
        position: 3,
        text: "Чем диодный лазер (810 нм) отличается от александритового (755 нм) в клинической практике?",
        options: JSON.stringify(["Диодный работает только на светлой коже", "Диодный безопаснее для смуглой кожи и глубже проникает в фолликул", "Александритовый быстрее нагревает фолликул", "Они абсолютно идентичны по принципу действия"]),
        correctIndex: 1,
        explanation: "Диодный лазер 810 нм глубже проникает и менее интенсивно поглощается эпидермисом, что делает его подходящим для III–IV фототипов.",
      },
      {
        position: 4,
        text: "Как правильно подготовить клиента к первичной консультации по лазерной эпиляции?",
        options: JSON.stringify(["Попросить сбрить волосы в день консультации", "Рекомендовать загореть для лучшего контраста", "Уточнить фototip, противопоказания, анамнез и провести фотопротокол зон", "Начать процедуру без предварительной подготовки"]),
        correctIndex: 2,
        explanation: "На первичной консультации обязательно определить фототип, собрать анамнез, исключить противопоказания и выполнить фотопротокол зон.",
      },
      {
        position: 5,
        text: "Каков минимальный интервал между сеансами лазерной эпиляции зоны бикини?",
        options: JSON.stringify(["1–2 недели", "3–4 недели", "4–8 недель", "12 недель"]),
        correctIndex: 2,
        explanation: "Для зоны бикини рекомендуется 4–8 недель: этого времени достаточно, чтобы волосы в следующей фазе роста (anaген) стали заметны.",
      },
      {
        position: 6,
        text: "Каково главное правило гигиены при работе с лазерным аппаратом между клиентами?",
        options: JSON.stringify(["Протирать наконечник водой", "Использовать одноразовые гигиенические насадки и/или дезинфицировать контактную часть", "Менять перчатки только при видимых загрязнениях", "Промывать наконечник физраствором"]),
        correctIndex: 1,
        explanation: "Обязательно использовать одноразовые насадки или проводить антисептическую обработку контактной части между каждым клиентом для предотвращения перекрёстного заражения.",
      },
      {
        position: 7,
        text: "Какие рекомендации необходимо дать клиенту после сеанса лазерной эпиляции?",
        options: JSON.stringify(["Принять горячую ванну и позагорать", "Нанести успокаивающий крем, избегать солнца 2–4 недели, не посещать баню/сауну 48 ч", "Сразу нанести автозагар для маскировки покраснения", "Немедленно сбрить оставшиеся волосы"]),
        correctIndex: 1,
        explanation: "После процедуры кожу охлаждают, наносят успокаивающее средство. Нельзя: солнце (2–4 нед.), баня/сауна (48 ч), агрессивные средства ухода — риск ожогов и пигментации.",
      },
    ];

    for (const q of questionDefs) {
      db.insert(quizQuestions).values({
        id: randomUUID(),
        quizId: quizId,
        ...q,
      }).run();
    }
    console.log("[seed] quiz seeded (1 quiz, 8 questions).");
  }

  // ---- Iter5: Seed pulse_surveys (idempotent) ----
  const existingPulseSurveys = db.select().from(pulseSurveys).all();
  if (existingPulseSurveys.length === 0) {
    const pulseSurveyDefs = [
      {
        id: randomUUID(),
        dayNumber: 7,
        title: "Первая неделя — как тебе?",
        questions: JSON.stringify([
          { q: "Как твоё настроение на работе?", type: "rating" },
          { q: "Насколько ясны твои задачи и обязанности?", type: "rating" },
          { q: "Как складываются отношения с командой?", type: "rating" },
          { q: "Что тебе особенно нравится в первые дни?", type: "text" },
          { q: "Что мешает или вызывает вопросы?", type: "text" },
        ]),
        active: 1,
      },
      {
        id: randomUUID(),
        dayNumber: 30,
        title: "Первый месяц",
        questions: JSON.stringify([
          { q: "Оцени своё ощущение адаптации в компании", type: "rating" },
          { q: "Насколько хорошо ты понимаешь рабочие процессы?", type: "rating" },
          { q: "Как ты оцениваешь баланс нагрузки?", type: "rating" },
          { q: "Что ты хотел бы улучшить или изменить в своей работе?", type: "text" },
        ]),
        active: 1,
      },
      {
        id: randomUUID(),
        dayNumber: 60,
        title: "Готовность к самостоятельной работе",
        questions: JSON.stringify([
          { q: "Насколько уверенно ты себя чувствуешь в работе самостоятельно?", type: "rating" },
          { q: "Что ты хотел бы ещё доработать или изучить?", type: "text" },
        ]),
        active: 1,
      },
      {
        id: randomUUID(),
        dayNumber: 90,
        title: "Итоги испытательного срока",
        questions: JSON.stringify([
          { q: "Общая удовлетворённость работой в Skin Line", type: "rating" },
          { q: "Планируешь ли продолжать работу в компании?", type: "choice", options: ["Да, однозначно", "Скорее да", "Ещё думаю", "Скорее нет"] },
          { q: "Порекомендовал бы ты Skin Line как работодателя друзьям?", type: "choice", options: ["Да, уже рекомендую", "Скорее да", "Не уверен", "Нет"] },
          { q: "Есть ли у тебя знакомые, которые хотели бы работать мастером?", type: "text" },
        ]),
        active: 1,
      },
    ];
    for (const s of pulseSurveyDefs) {
      db.insert(pulseSurveys).values(s).run();
    }
    console.log("[seed] pulse_surveys seeded (4 surveys).");
  }
}

// Iter6: seed scorecard templates
export function seedIter6Templates(): void {
  const existingTemplates = db.select().from(scorecardTemplates).all();
  if (existingTemplates.length > 0) return;
  const nowT = new Date().toISOString();
  const templateDefs = [
    {
      id: randomUUID(),
      role: "master_laser",
      name: "Мастер лазерной эпиляции",
      description: "Скоркарта для оценки мастеров лазерной эпиляции",
      criteriaJson: JSON.stringify([
        { id: "theory_knowledge", name: "Знание теории лазера", description: "Фототипы, длины волн, противопоказания", weight: 1, anchor1: "Не различает типы лазеров и фототипы", anchor3: "Знает базовые типы, путается в нюансах", anchor5: "Уверенно объясняет фототипы, длины волн и противопоказания" },
        { id: "client_service", name: "Клиентский сервис и эмпатия", description: "Качество общения с клиентом", weight: 1, anchor1: "Сухо, формально", anchor3: "Вежливо", anchor5: "Тёплый контакт, чувствует клиента" },
        { id: "neatness", name: "Опрятность и подача", description: "Внешний вид и презентация себя", weight: 1, anchor1: "Неаккуратно", anchor3: "Аккуратно", anchor5: "Идеальный внешний вид" },
        { id: "stress_resilience", name: "Стрессоустойчивость", description: "Поведение в конфликтных ситуациях", weight: 1, anchor1: "Защищается, спорит", anchor3: "Сглаживает", anchor5: "Решает конфликт спокойно" },
        { id: "schedule_flexibility", name: "Готовность к графику и переезду", description: "Готовность к гибкому графику и смене города", weight: 1, anchor1: "Категорически нет", anchor3: "С оговорками", anchor5: "Полностью готов" },
        { id: "experience", name: "Опыт и сертификаты", description: "Рабочий опыт и наличие актуальных сертификатов", weight: 1, anchor1: "Нет опыта и сертификатов", anchor3: "Есть опыт без сертификатов или наоборот", anchor5: "2+ года + актуальные сертификаты" },
        { id: "motivation", name: "Мотивация и готовность учиться", description: "Желание развиваться в профессии", weight: 1, anchor1: "Безразличие", anchor3: "Готов, но без энтузиазма", anchor5: "Высокая мотивация и инициатива" },
      ]),
      active: 1,
      createdAt: nowT,
      updatedAt: nowT,
    },
    {
      id: randomUUID(),
      role: "cosmetologist",
      name: "Косметолог",
      description: "Скоркарта для оценки косметологов",
      criteriaJson: JSON.stringify([
        { id: "medical_education", name: "Профильное медобразование", description: "Наличие медицинского образования и сертификации", weight: 1, anchor1: "Без профильного", anchor3: "Базовое медицинское", anchor5: "Высшее медицинское + сертификация" },
        { id: "procedures_knowledge", name: "Знание процедур и протоколов", description: "Владение уходом, аппаратными и инъекционными методиками", weight: 1, anchor1: "Базовый уход", anchor3: "Уход + аппаратные", anchor5: "Уход + аппаратные + инъекционные с протоколами" },
        { id: "client_orientation", name: "Клиентоориентированность", description: "Глубина эмпатии и работы с клиентом", weight: 1, anchor1: "Формально", anchor3: "Вежливо", anchor5: "Глубокая эмпатия" },
        { id: "upselling", name: "Работа с возражениями и допродажами", description: "Навык убеждения и продажи услуг", weight: 1, anchor1: "Не продаёт", anchor3: "Базовые скрипты", anchor5: "Сильные техники, конкретные кейсы" },
        { id: "presentability", name: "Опрятность и презентабельность", description: "Внешний вид, соответствующий индустрии", weight: 1, anchor1: "Не соответствует", anchor3: "Соответствует", anchor5: "Эталонный вид для индустрии" },
        { id: "portfolio", name: "Опыт и портфолио", description: "Опыт работы и наличие портфолио до/после", weight: 1, anchor1: "Нет опыта", anchor3: "1-2 года", anchor5: "3+ лет + портфолио до/после" },
        { id: "sanitary", name: "Соблюдение санитарных норм", description: "Знание и соблюдение СанПиН", weight: 1, anchor1: "Не знает требований", anchor3: "Знает базу", anchor5: "Глубокое знание СанПиН" },
      ]),
      active: 1,
      createdAt: nowT,
      updatedAt: nowT,
    },
    {
      id: randomUUID(),
      role: "administrator",
      name: "Администратор студии",
      description: "Скоркарта для оценки администраторов студии",
      criteriaJson: JSON.stringify([
        { id: "communication", name: "Коммуникативные навыки", description: "Тон, улыбка в голосе, знание скриптов", weight: 1, anchor1: "Сухо/закрыто", anchor3: "Вежливо", anchor5: "Тепло + улыбка в голосе + скрипты" },
        { id: "conflict_resolution", name: "Стрессоустойчивость и конфликты", description: "Умение работать со сложными клиентами", weight: 1, anchor1: "Конфликтная", anchor3: "Сглаживает", anchor5: "Решает любой конфликт" },
        { id: "attention_to_detail", name: "Внимательность к деталям", description: "Точность в работе с кассой, записью, документами", weight: 1, anchor1: "Невнимательная", anchor3: "Базовая внимательность", anchor5: "Перфекционизм в деталях" },
        { id: "crm_skills", name: "Работа с CRM/YCLIENTS", description: "Навыки работы с CRM-системой", weight: 1, anchor1: "Не работала никогда", anchor3: "Работала, не помнит детали", anchor5: "Свободно владеет" },
        { id: "presentability", name: "Презентабельность", description: "Соответствие стандартам внешнего вида администратора", weight: 1, anchor1: "Не соответствует", anchor3: "Соответствует", anchor5: "Эталонная внешность администратора" },
        { id: "long_term_motivation", name: "Мотивация на долгосрочную работу", description: "Готовность работать в компании долго", weight: 1, anchor1: "Ищет временную работу", anchor3: "Планирует 1+ год", anchor5: "Готова на 3+ года + карьерный рост" },
      ]),
      active: 1,
      createdAt: nowT,
      updatedAt: nowT,
    },
    {
      id: randomUUID(),
      role: "sales_manager",
      name: "Менеджер отдела продаж",
      description: "Скоркарта для оценки менеджеров по продажам",
      criteriaJson: JSON.stringify([
        { id: "b2c_sales_experience", name: "Опыт продаж B2C услуг", description: "Опыт в продажах клиентам физическим лицам", weight: 1, anchor1: "Нет опыта", anchor3: "1-2 года", anchor5: "3+ лет в beauty или похожей B2C" },
        { id: "sales_techniques", name: "Владение техниками продаж", description: "Знание СПИН, СВ, отработки возражений", weight: 1, anchor1: "Только базовые скрипты", anchor3: "Знает основные техники", anchor5: "СПИН, СВ, отработка возражений уровня эксперт" },
        { id: "metrics_knowledge", name: "Знание метрик", description: "Понимание конверсии, LTV, среднего чека", weight: 1, anchor1: "Не знает", anchor3: "Знает конверсию", anchor5: "Свободно оперирует LTV, ROI, средним чеком" },
        { id: "energy", name: "Энергетика и драйв", description: "Уровень энергии и мотивации", weight: 1, anchor1: "Низкая", anchor3: "Средняя", anchor5: "Высокая, заряжает" },
        { id: "analytics", name: "Аналитические навыки", description: "Умение строить отчёты и анализировать воронку", weight: 1, anchor1: "Не умеет строить отчёты", anchor3: "Базовые отчёты в Excel", anchor5: "Глубокая аналитика воронки и предложения по оптимизации" },
        { id: "crm_automation", name: "CRM и автоматизация", description: "Работа с CRM, настройка воронок", weight: 1, anchor1: "Не работала", anchor3: "Базовый пользователь", anchor5: "Настраивает воронки сама" },
        { id: "achievements", name: "Достижения и кейсы с цифрами", description: "Конкретные измеримые результаты", weight: 1, anchor1: "Без цифр", anchor3: "Есть пара кейсов", anchor5: "Конкретные кейсы с измеримыми результатами" },
      ]),
      active: 1,
      createdAt: nowT,
      updatedAt: nowT,
    },
  ];
  for (const t of templateDefs) {
    db.insert(scorecardTemplates).values(t).run();
  }
  console.log("[seed] scorecard_templates seeded (4 templates).");
}
