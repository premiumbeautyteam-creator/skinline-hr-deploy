import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Vacancies
export const vacancies = sqliteTable("vacancies", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  city: text("city").notNull(),
  salary: text("salary").notNull(),
  status: text("status").notNull(), // active | paused | closed
  description: text("description").notNull(),
  externalUrl: text("external_url"), // link to vacancy on source (hh/avito)
  source: text("source"), // origin of the vacancy: hh | avito | manual (nullable for legacy rows)
});

export const insertVacancySchema = createInsertSchema(vacancies).omit({ id: true });
export type InsertVacancy = z.infer<typeof insertVacancySchema>;
export type Vacancy = typeof vacancies.$inferSelect;

// Candidates
export const candidates = sqliteTable("candidates", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  city: text("city").notNull(),
  vacancyId: text("vacancy_id").notNull(),
  source: text("source").notNull(), // avito | hh | manual | telegram
  sourceUrl: text("source_url"),
  stage: text("stage").notNull(), // 14 stages
  experience: text("experience").notNull(),
  expectedSalary: text("expected_salary"),
  rating: integer("rating"), // 1-5
  notes: text("notes"),
  tags: text("tags").notNull().default("[]"), // JSON array stored as text
  rejectReason: text("reject_reason"),
  avatarUrl: text("avatar_url"),
  resumeUrl: text("resume_url"), // link back to hh resume / avito profile
  externalAvatarUrl: text("external_avatar_url"), // avatar copied from source
  createdAt: text("created_at").notNull(),
  // New columns for Iteration 1
  telegramChatId: text("telegram_chat_id"), // denormalized for fast lookups
  linkToken: text("link_token"), // random token for deep-link
  lastStageAt: text("last_stage_at"), // when entered current stage
  // New columns for Iteration 2
  aiVerdict: text("ai_verdict"), // take | reserve | reject | pending | null
  aiReasoning: text("ai_reasoning"),
  aiScore: integer("ai_score"), // 0-100
  predictiveScore: integer("predictive_score"), // 0-100
  predictiveFactors: text("predictive_factors"), // JSON array
  dateOfBirth: text("date_of_birth"), // nullable
  formFilledInSeconds: integer("form_filled_in_seconds"), // nullable
  fakeScore: integer("fake_score"), // 0-100
});

export const insertCandidateSchema = createInsertSchema(candidates).omit({ id: true, createdAt: true });
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidates.$inferSelect;

// Documents
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  type: text("type").notNull(), // passport | medical_book | snils | inn | diploma | certificate | other | pending_classification
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  verified: integer("verified").notNull().default(0),
  // Iteration 4 columns
  uploadSource: text("upload_source").notNull().default("internal"), // 'internal' | 'telegram'
  ocrStatus: text("ocr_status").notNull().default("pending"),         // 'pending' | 'processing' | 'done' | 'failed' | 'not_supported'
  ocrData: text("ocr_data"),                                           // JSON extracted fields
  ocrError: text("ocr_error"),
  ocrAt: text("ocr_at"),
  rejectedReason: text("rejected_reason"),
  filePath: text("file_path"),                                         // absolute path on disk
  fileHash: text("file_hash"),                                         // SHA-256 for anti-fake
});

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, uploadedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// Messages
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  channel: text("channel").notNull(), // hh | avito | telegram | telegram_bot | whatsapp | internal
  direction: text("direction").notNull(), // in | out
  text: text("text").notNull(),
  sentAt: text("sent_at").notNull(),
  isRead: integer("is_read").notNull().default(0),
  source: text("source"), // hh | avito | null (internal). Used together with externalId for dedupe.
  externalId: text("external_id"), // source-side message id (unique with source) for idempotent ingest
  deliveryStatus: text("delivery_status"), // pending | delivered | failed | local | null
  meta: text("meta"), // JSON nullable — for tg_message_id etc.
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, sentAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// Activities
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  type: text("type").notNull(), // stage_change | note | call | message | document_uploaded | interview_scheduled
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
  meta: text("meta"), // JSON nullable
});

export const insertActivitySchema = createInsertSchema(activities).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;

// ============================================================================
// Integration tables (hh.ru / avito / telegram)
// ============================================================================

// integrations: one row per connected source account
export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  source: text("source").notNull(), // hh | avito | telegram
  status: text("status").notNull(), // disconnected | connected | error | refreshing
  accountId: text("account_id"), // hh employer_id, avito user_id
  accountName: text("account_name"), // display name from API
  accessToken: text("access_token"), // encrypted (iv:tag:data base64)
  refreshToken: text("refresh_token"), // encrypted
  tokenExpiresAt: text("token_expires_at"), // ISO date
  lastSyncAt: text("last_sync_at"), // ISO date
  lastError: text("last_error"),
  meta: text("meta"), // JSON — source-specific extra data (e.g. manager_id for hh)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertIntegrationSchema = createInsertSchema(integrations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type Integration = typeof integrations.$inferSelect;

// Public-facing integration shape with tokens masked. Used in API responses.
export type IntegrationPublic = Omit<Integration, "accessToken" | "refreshToken"> & {
  hasTokens: boolean;
};

// external_refs: link our internal entities to source-side IDs
export const externalRefs = sqliteTable("external_refs", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(), // candidate | vacancy | message
  entityId: text("entity_id").notNull(), // our internal id
  source: text("source").notNull(), // hh | avito
  externalId: text("external_id").notNull(), // hh negotiation_id / resume_id / vacancy_id ...
  externalType: text("external_type").notNull(), // negotiation | resume | vacancy | chat | item
  meta: text("meta"), // JSON nullable — extra fields like resume_url, last_message_id
  createdAt: text("created_at").notNull(),
});

export const insertExternalRefSchema = createInsertSchema(externalRefs).omit({ id: true, createdAt: true });
export type InsertExternalRef = z.infer<typeof insertExternalRefSchema>;
export type ExternalRef = typeof externalRefs.$inferSelect;

// oauth_states: CSRF protection for the OAuth flow (auto-expire after 10 min)
export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  source: text("source").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertOauthStateSchema = createInsertSchema(oauthStates).omit({ createdAt: true });
export type InsertOauthState = z.infer<typeof insertOauthStateSchema>;
export type OauthState = typeof oauthStates.$inferSelect;

// webhook_events: idempotency + replay for inbound webhooks
export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  externalId: text("external_id"),
  payload: text("payload").notNull(), // JSON
  status: text("status").notNull(), // pending | processed | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  receivedAt: text("received_at").notNull(),
  processedAt: text("processed_at"),
});

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).omit({ id: true, receivedAt: true });
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

// ============================================================================
// NEW: Iteration 1 tables
// ============================================================================

// crm_users: internal HR team members
export const crmUsers = sqliteTable("crm_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  roleKey: text("role_key").notNull(), // hr_manager | uk | trainer_1 | trainer_2 | manager | ops
  telegramUsername: text("telegram_username"),
  telegramChatId: text("telegram_chat_id"),
  email: text("email"),
  createdAt: text("created_at").notNull(),
});

export const insertCrmUserSchema = createInsertSchema(crmUsers).omit({ createdAt: true });
export type InsertCrmUser = z.infer<typeof insertCrmUserSchema>;
export type CrmUser = typeof crmUsers.$inferSelect;

// tasks: assigned tasks (auto or manual)
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  assigneeId: text("assignee_id").notNull(), // fk crm_users.id
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  dueAt: text("due_at").notNull(), // ISO
  status: text("status").notNull().default("open"), // open | done | cancelled
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  source: text("source").notNull().default("manual"), // auto | manual
  triggerStage: text("trigger_stage"), // stage that triggered this task
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// scheduled_actions: timers for automated messages/tasks
export const scheduledActions = sqliteTable("scheduled_actions", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  kind: text("kind").notNull(), // tg_message | tg_message_to_user | create_task | stage_check
  runAt: text("run_at").notNull(), // ISO
  payload: text("payload").notNull(), // JSON
  status: text("status").notNull().default("pending"), // pending | done | cancelled | failed
  triggerStage: text("trigger_stage").notNull(), // stage that scheduled this
  createdAt: text("created_at").notNull(),
  executedAt: text("executed_at"),
  lastError: text("last_error"),
});

export const insertScheduledActionSchema = createInsertSchema(scheduledActions).omit({ id: true, createdAt: true });
export type InsertScheduledAction = z.infer<typeof insertScheduledActionSchema>;
export type ScheduledAction = typeof scheduledActions.$inferSelect;

// stage_events: history of stage changes
export const stageEvents = sqliteTable("stage_events", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  changedBy: text("changed_by").notNull(), // user_id or 'system'
  changedAt: text("changed_at").notNull(),
  meta: text("meta"), // JSON nullable
});

export const insertStageEventSchema = createInsertSchema(stageEvents).omit({ id: true });
export type InsertStageEvent = z.infer<typeof insertStageEventSchema>;
export type StageEvent = typeof stageEvents.$inferSelect;

// telegram_links: links candidate to Telegram chat_id via deep-link
export const telegramLinks = sqliteTable("telegram_links", {
  candidateId: text("candidate_id").primaryKey(),
  chatId: text("chat_id").notNull(),
  username: text("username"),
  linkedAt: text("linked_at").notNull(),
  botUsername: text("bot_username").notNull(),
});

export type TelegramLink = typeof telegramLinks.$inferSelect;

// ============================================================================
// NEW: Iteration 2 tables
// ============================================================================

// app_settings: key-value store for feature flags
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;

// ai_calls: logging of all AI LLM calls
export const aiCalls = sqliteTable("ai_calls", {
  id: text("id").primaryKey(),
  purpose: text("purpose").notNull(), // screen | score | chat | sentiment | whisper
  model: text("model").notNull(),
  candidateId: text("candidate_id"),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  costUsd: integer("cost_usd"), // stored as float (SQLite stores as REAL)
  durationMs: integer("duration_ms").notNull().default(0),
  success: integer("success").notNull().default(1), // 0/1
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export type AiCall = typeof aiCalls.$inferSelect;

// ============================================================================
// NEW: Iteration 4 tables — Quiz + Onboarding
// ============================================================================

// quizzes: configurable tests for candidates
export const quizzes = sqliteTable("quizzes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  active: integer("active").notNull().default(1),
  triggerStage: text("trigger_stage"),  // auto-show at this stage
  passingScore: integer("passing_score").notNull().default(70),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertQuizSchema = createInsertSchema(quizzes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type Quiz = typeof quizzes.$inferSelect;

// quizQuestions: questions belonging to a quiz
export const quizQuestions = sqliteTable("quiz_questions", {
  id: text("id").primaryKey(),
  quizId: text("quiz_id").notNull(),
  position: integer("position").notNull().default(0),
  text: text("text").notNull(),
  options: text("options").notNull().default("[]"), // JSON array ["A","B","C","D"]
  correctIndex: integer("correct_index").notNull().default(0),
  explanation: text("explanation"),
});

export const insertQuizQuestionSchema = createInsertSchema(quizQuestions).omit({ id: true });
export type InsertQuizQuestion = z.infer<typeof insertQuizQuestionSchema>;
export type QuizQuestion = typeof quizQuestions.$inferSelect;

// quizAttempts: candidate quiz attempt sessions
export const quizAttempts = sqliteTable("quiz_attempts", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  quizId: text("quiz_id").notNull(),
  status: text("status").notNull().default("in_progress"), // 'in_progress' | 'passed' | 'failed'
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  scorePercent: integer("score_percent"),
  currentQuestionIdx: integer("current_question_idx").notNull().default(0),
  answers: text("answers").notNull().default("[]"), // JSON [{questionId, selectedIdx, isCorrect}]
});

export const insertQuizAttemptSchema = createInsertSchema(quizAttempts).omit({ id: true });
export type InsertQuizAttempt = z.infer<typeof insertQuizAttemptSchema>;
export type QuizAttempt = typeof quizAttempts.$inferSelect;

// ============================================================================
// NEW: Iteration 3 tables — Channel Autopilot
// ============================================================================

// channel_settings: настройки автопостинга в канал
export const channelSettings = sqliteTable("channel_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelUsername: text("channel_username").notNull().default("@SkinLineHR"),
  channelTitle: text("channel_title").notNull().default("Skin Line | HR"),
  autopilotEnabled: integer("autopilot_enabled").notNull().default(0),
  postsPerWeek: integer("posts_per_week").notNull().default(2),
  preferredHours: text("preferred_hours").notNull().default("[10,14,18]"),
  preferredDays: text("preferred_days").notNull().default("[1,3,5]"),
  lastPostAt: text("last_post_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ChannelSettings = typeof channelSettings.$inferSelect;

// content_rubrics: рубрики контент-плана
export const contentRubrics = sqliteTable("content_rubrics", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  weight: integer("weight").notNull().default(1),
  active: integer("active").notNull().default(1),
});

export type ContentRubric = typeof contentRubrics.$inferSelect;

// channel_posts: посты (черновики + опубликованные)
export const channelPosts = sqliteTable("channel_posts", {
  id: text("id").primaryKey(),
  rubricKey: text("rubric_key").notNull(),
  status: text("status").notNull().default("draft"), // draft | scheduled | published | failed | rejected
  title: text("title").notNull(),
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  pollOptions: text("poll_options"),   // JSON array nullable
  scheduledAt: text("scheduled_at"),
  publishedAt: text("published_at"),
  tgMessageId: integer("tg_message_id"),
  createdBy: text("created_by").notNull().default("ai"),
  reviewedBy: text("reviewed_by"),
  generatedFromPrompt: text("generated_from_prompt"),
  meta: text("meta"),                 // JSON nullable
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ChannelPost = typeof channelPosts.$inferSelect;

// channel_subscribers: подписчики канала
export const channelSubscribers = sqliteTable("channel_subscribers", {
  chatId: text("chat_id").primaryKey(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  joinedAt: text("joined_at").notNull(),
  welcomeSentAt: text("welcome_sent_at"),
  candidateId: text("candidate_id"),
  source: text("source").notNull().default("channel_join"),
  meta: text("meta"),
});

export type ChannelSubscriber = typeof channelSubscribers.$inferSelect;

// channel_metrics: метрики постов
export const channelMetrics = sqliteTable("channel_metrics", {
  postId: text("post_id").notNull(),
  views: integer("views").notNull().default(0),
  reactions: integer("reactions").notNull().default(0),
  forwards: integer("forwards").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  measuredAt: text("measured_at").notNull(),
});

export type ChannelMetric = typeof channelMetrics.$inferSelect;

// reserve_reactivation: попытки реактивации кандидатов из резерва
export const reserveReactivation = sqliteTable("reserve_reactivation", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  attemptAt: text("attempt_at").notNull(),
  channel: text("channel").notNull().default("telegram"), // telegram | channel_post
  template: text("template").notNull(),
  status: text("status").notNull().default("sent"),       // sent | replied | no_response
  reply: text("reply"),
  createdAt: text("created_at").notNull(),
});

export type ReserveReactivation = typeof reserveReactivation.$inferSelect;

// ============================================================================
// NEW: Iteration 5 tables
// ============================================================================

// UTM columns added to candidates via ensureColumn in storage.ts

// probation_tracks: испытательный срок 90 дней
export const probationTracks = sqliteTable("probation_tracks", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  startedAt: text("started_at").notNull(),
  endsAt: text("ends_at").notNull(),
  status: text("status").notNull().default("active"), // active | passed | failed | terminated_early
  managerId: text("manager_id"),
  finalDecisionAt: text("final_decision_at"),
  finalDecisionBy: text("final_decision_by"),
  finalDecisionNotes: text("final_decision_notes"),
  score: integer("score"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertProbationTrackSchema = createInsertSchema(probationTracks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProbationTrack = z.infer<typeof insertProbationTrackSchema>;
export type ProbationTrack = typeof probationTracks.$inferSelect;

// probation_checkpoints
export const probationCheckpoints = sqliteTable("probation_checkpoints", {
  id: text("id").primaryKey(),
  trackId: text("track_id").notNull(),
  dayNumber: integer("day_number").notNull(),
  dueAt: text("due_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status").notNull().default("pending"), // pending | done | skipped | overdue
  checkType: text("check_type").notNull().default("pulse_survey"), // pulse_survey | manager_review | self_review | client_feedback
  result: text("result"), // JSON
});

export const insertProbationCheckpointSchema = createInsertSchema(probationCheckpoints).omit({ id: true });
export type InsertProbationCheckpoint = z.infer<typeof insertProbationCheckpointSchema>;
export type ProbationCheckpoint = typeof probationCheckpoints.$inferSelect;

// pulse_surveys
export const pulseSurveys = sqliteTable("pulse_surveys", {
  id: text("id").primaryKey(),
  dayNumber: integer("day_number").notNull(),
  title: text("title").notNull(),
  questions: text("questions").notNull().default("[]"), // JSON array {q, type, options?}
  active: integer("active").notNull().default(1),
});

export const insertPulseSurveySchema = createInsertSchema(pulseSurveys).omit({ id: true });
export type InsertPulseSurvey = z.infer<typeof insertPulseSurveySchema>;
export type PulseSurvey = typeof pulseSurveys.$inferSelect;

// pulse_responses
export const pulseResponses = sqliteTable("pulse_responses", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  surveyId: text("survey_id").notNull(),
  responses: text("responses").notNull().default("[]"), // JSON
  avgRating: text("avg_rating"), // stored as text to preserve float
  sentiment: text("sentiment"),
  createdAt: text("created_at").notNull(),
});

export const insertPulseResponseSchema = createInsertSchema(pulseResponses).omit({ id: true, createdAt: true });
export type InsertPulseResponse = z.infer<typeof insertPulseResponseSchema>;
export type PulseResponse = typeof pulseResponses.$inferSelect;

// reserve_pool
export const reservePool = sqliteTable("reserve_pool", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  addedAt: text("added_at").notNull(),
  reason: text("reason"),
  city: text("city"),
  role: text("role"),
  lastContactedAt: text("last_contacted_at"),
  status: text("status").notNull().default("active"), // active | reactivated | opted_out
  tags: text("tags").notNull().default("[]"),
});

export const insertReservePoolSchema = createInsertSchema(reservePool).omit({ id: true, addedAt: true });
export type InsertReservePool = z.infer<typeof insertReservePoolSchema>;
export type ReservePool = typeof reservePool.$inferSelect;

// referral_codes
export const referralCodes = sqliteTable("referral_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  candidateId: text("candidate_id"),
  code: text("code").notNull(),
  createdAt: text("created_at").notNull(),
  active: integer("active").notNull().default(1),
  bonusAmount: integer("bonus_amount").notNull().default(5000),
});

export const insertReferralCodeSchema = createInsertSchema(referralCodes).omit({ id: true, createdAt: true });
export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;
export type ReferralCode = typeof referralCodes.$inferSelect;

// referrals
export const referrals = sqliteTable("referrals", {
  id: text("id").primaryKey(),
  codeId: text("code_id").notNull(),
  candidateId: text("candidate_id").notNull(),
  status: text("status").notNull().default("registered"), // registered | hired | passed_probation | paid
  bonusAmount: integer("bonus_amount"),
  paidAt: text("paid_at"),
  createdAt: text("created_at").notNull(),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

// alerts
export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("med"), // low | med | high | critical
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  candidateId: text("candidate_id"),
  userId: text("user_id"),
  relatedEntity: text("related_entity"), // JSON
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
});

export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;

// company_ratings (Dream Job widget)
export const companyRatings = sqliteTable("company_ratings", {
  id: text("id").primaryKey(),
  source: text("source").notNull().default("dreamjob"),
  url: text("url").notNull(),
  companyName: text("company_name").notNull(),
  overallRating: real("overall_rating"),
  totalReviews: integer("total_reviews"),
  recommendPercent: real("recommend_percent"),
  subcategoryRatings: text("subcategory_ratings").notNull().default("{}"), // JSON
  fetchedAt: text("fetched_at").notNull(),
  raw: text("raw"),
});

export const insertCompanyRatingSchema = createInsertSchema(companyRatings).omit({ id: true });
export type InsertCompanyRating = z.infer<typeof insertCompanyRatingSchema>;
export type CompanyRating = typeof companyRatings.$inferSelect;

// ============================================================================
// NEW: Iteration 6 tables — Video Analysis + Scorecards
// ============================================================================

// scorecard_templates: шаблоны скоркарты по ролям
export const scorecardTemplates = sqliteTable("scorecard_templates", {
  id: text("id").primaryKey(),
  role: text("role").notNull(), // master_laser | cosmetologist | administrator | sales_manager
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  criteriaJson: text("criteria_json").notNull().default("[]"), // JSON array of criteria
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertScorecardTemplateSchema = createInsertSchema(scorecardTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScorecardTemplate = z.infer<typeof insertScorecardTemplateSchema>;
export type ScorecardTemplate = typeof scorecardTemplates.$inferSelect;

// scorecard_responses: заполненные скоркарты
export const scorecardResponses = sqliteTable("scorecard_responses", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  templateId: text("template_id").notNull(),
  stage: text("stage").notNull(), // video_interview | studio_demo | probation
  scoresJson: text("scores_json").notNull().default("[]"), // JSON [{criterionId, score, quote, timestamp}]
  totalScore: integer("total_score").notNull().default(0),
  maxScore: integer("max_score").notNull().default(0),
  percentage: real("percentage").notNull().default(0),
  aiDrafted: integer("ai_drafted").notNull().default(0), // 0/1
  aiVerdict: text("ai_verdict"), // text verdict from AI
  recommendation: text("recommendation"), // pass | reject | think
  interviewerId: text("interviewer_id"),
  sourceVideoId: text("source_video_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertScorecardResponseSchema = createInsertSchema(scorecardResponses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScorecardResponse = z.infer<typeof insertScorecardResponseSchema>;
export type ScorecardResponse = typeof scorecardResponses.$inferSelect;

// interview_videos: записи видеоинтервью и их анализ
export const interviewVideos = sqliteTable("interview_videos", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  source: text("source").notNull().default("zoom"), // zoom | upload
  sourceUrl: text("source_url").notNull(),
  localPath: text("local_path"),
  durationSec: integer("duration_sec"),
  status: text("status").notNull().default("pending"), // pending|downloading|transcribing|analyzing|done|error
  errorMsg: text("error_msg"),
  transcriptPath: text("transcript_path"),
  transcriptJson: text("transcript_json"), // JSON with timestamps
  rawAnalysisJson: text("raw_analysis_json"),
  sentimentTimelineJson: text("sentiment_timeline_json"), // [{timestamp, sentiment, label}]
  redFlagsJson: text("red_flags_json"), // [{type, severity, quote, timestamp, description}]
  aiSummary: text("ai_summary"),
  keyTimestampsJson: text("key_timestamps_json"), // [{timestamp, label}]
  extractedFactsJson: text("extracted_facts_json"), // [{key, value}]
  uploadedBy: text("uploaded_by"), // crm user id
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertInterviewVideoSchema = createInsertSchema(interviewVideos).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInterviewVideo = z.infer<typeof insertInterviewVideoSchema>;
export type InterviewVideo = typeof interviewVideos.$inferSelect;
