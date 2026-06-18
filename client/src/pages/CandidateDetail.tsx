import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ArrowLeft, Phone, Mail, MapPin, Star, Copy, Send, Upload, Trash2, Check,
  MessageSquare, FileText, StickyNote, History, CalendarPlus, PhoneCall, Archive, X, Plus,
  AlertTriangle, Clock, CheckSquare, Bot, Link2, QrCode, Zap, Brain, RefreshCw, Loader2,
  ClipboardList, Sparkles, BarChart2, Video, ExternalLink,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CandidateAvatar, SourceBadge, StageBadge } from "@/components/shared";
import { useStages, DOC_TYPES, CHANNELS, parseTags } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { Candidate, Vacancy, Message, Activity, Document } from "@shared/schema";

// Extra types for new features
interface QuizAttempt {
  id: string;
  candidateId: string;
  quizId: string;
  status: "in_progress" | "passed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  scorePercent: number | null;
  currentQuestionIdx: number;
  answers: string;
}

interface QuizSummary {
  id: string;
  title: string;
  passingScore: number;
}

interface Task {
  id: string;
  candidateId: string;
  assigneeId: string;
  title: string;
  description: string;
  dueAt: string;
  status: "open" | "done" | "cancelled";
  createdAt: string;
  completedAt: string | null;
  source: "auto" | "manual";
  triggerStage: string | null;
}

interface ScheduledAction {
  id: string;
  candidateId: string;
  kind: string;
  runAt: string;
  payload: string;
  status: "pending" | "done" | "cancelled" | "failed";
  triggerStage: string;
  createdAt: string;
  executedAt: string | null;
  lastError: string | null;
}

interface StageEvent {
  id: string;
  candidateId: string;
  fromStage: string | null;
  toStage: string;
  changedBy: string;
  changedAt: string;
  meta: string | null;
}

interface CrmUser {
  id: string;
  name: string;
  roleKey: string;
  telegramUsername: string | null;
}

interface LinkTokenResponse {
  token: string;
  deepLink: string;
  botUsername: string;
}

function fmtDate(iso: string, withTime = false) {
  try {
    return format(new Date(iso), withTime ? "d MMM yyyy, HH:mm" : "d MMMM yyyy", { locale: ru });
  } catch { return iso; }
}

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  stage_change: History, note: StickyNote, call: PhoneCall,
  message: MessageSquare, document_uploaded: FileText, interview_scheduled: CalendarPlus,
};

export default function CandidateDetail() {
  const [, params] = useRoute("/candidates/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = params?.id ?? "";
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<string>("passport");
  const [msgText, setMsgText] = useState("");
  const [msgChannel, setMsgChannel] = useState("telegram");
  const [channelTouched, setChannelTouched] = useState(false);
  const [msgFilter, setMsgFilter] = useState("all");
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTask, setNewTask] = useState({ assigneeId: "", title: "", description: "", dueAt: "" });
  const [aiRejectionOpen, setAiRejectionOpen] = useState(false);
  const [aiRejectionText, setAiRejectionText] = useState("");
  const [aiRejectionLoading, setAiRejectionLoading] = useState(false);
  const [sendQuizOpen, setSendQuizOpen] = useState(false);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [sendingQuiz, setSendingQuiz] = useState(false);

  const { data: candidate, isLoading } = useQuery<Candidate>({ queryKey: ["/api/candidates", id] });
  const { stages } = useStages();

  useEffect(() => {
    if (candidate?.source === "hh" && !channelTouched) {
      setMsgChannel("hh");
    }
  }, [candidate?.source, channelTouched]);

  const { data: vacancies } = useQuery<Vacancy[]>({ queryKey: ["/api/vacancies"] });
  const { data: messages } = useQuery<Message[]>({ queryKey: ["/api/candidates", id, "messages"] });
  const { data: activities } = useQuery<Activity[]>({ queryKey: ["/api/candidates", id, "activities"] });
  const { data: documents } = useQuery<Document[]>({ queryKey: ["/api/candidates", id, "documents"] });
  const { data: tasks, refetch: refetchTasks } = useQuery<Task[]>({ queryKey: ["/api/candidates", id, "tasks"] });
  const { data: automations } = useQuery<ScheduledAction[]>({ queryKey: ["/api/candidates", id, "automations"] });
  const { data: stageEvents } = useQuery<StageEvent[]>({ queryKey: ["/api/candidates", id, "stage-events"] });
  const { data: crmUsers } = useQuery<CrmUser[]>({ queryKey: ["/api/users"] });
  const { data: quizAttempts = [] } = useQuery<QuizAttempt[]>({
    queryKey: ["/api/candidates", id, "quiz-attempts"],
  });

  if (isLoading || !candidate) {
    return <Layout title="Кандидат"><div className="p-8"><Skeleton className="h-96 w-full rounded-xl" /></div></Layout>;
  }

  const vacancy = vacancies?.find((v) => v.id === candidate.vacancyId);
  const tags = parseTags(candidate.tags);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
  }

  async function patchCandidate(patch: Partial<Candidate>) {
    await apiRequest("PATCH", `/api/candidates/${id}`, patch);
    invalidate();
  }

  async function copyPhone() {
    try {
      await navigator.clipboard.writeText(candidate!.phone);
      toast({ title: "Скопировано", description: candidate!.phone });
    } catch {
      toast({ title: candidate!.phone });
    }
  }

  async function setRating(r: number) {
    await patchCandidate({ rating: r });
    toast({ title: "Оценка обновлена" });
  }

  async function addTag() {
    if (!newTag.trim()) return;
    const next = [...tags, newTag.trim()];
    await patchCandidate({ tags: JSON.stringify(next) });
    setNewTag("");
  }
  async function removeTag(t: string) {
    await patchCandidate({ tags: JSON.stringify(tags.filter((x) => x !== t)) });
  }

  async function saveNotes() {
    if (notesDraft === null || notesDraft === (candidate!.notes ?? "")) return;
    await patchCandidate({ notes: notesDraft });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "activities"] });
    toast({ title: "Заметка сохранена" });
  }

  async function changeStage(stage: string, reason?: string) {
    await apiRequest("PATCH", `/api/candidates/${id}/stage`, { stage, ...(reason ? { rejectReason: reason } : {}) });
    invalidate();
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "activities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "stage-events"] });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "automations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
  }

  async function sendMessage() {
    if (!msgText.trim()) return;
    await apiRequest("POST", `/api/candidates/${id}/messages`, { channel: msgChannel, text: msgText, isRead: 1 });
    setMsgText("");
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "activities"] });
  }

  async function uploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Use multipart upload endpoint (Iter4)
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", uploadType);
    try {
      const res = await fetch(`/api/candidates/${id}/documents/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        // Fallback to old JSON approach
        await apiRequest("POST", `/api/candidates/${id}/documents`, {
          type: uploadType,
          fileName: file.name,
          fileUrl: URL.createObjectURL(file),
          verified: 0,
        });
      }
    } catch {
      // Fallback to old JSON approach
      await apiRequest("POST", `/api/candidates/${id}/documents`, {
        type: uploadType,
        fileName: file.name,
        fileUrl: URL.createObjectURL(file),
        verified: 0,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "documents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "activities"] });
    toast({ title: "Документ загружен", description: file.name });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function toggleVerify(doc: Document) {
    await apiRequest("PATCH", `/api/documents/${doc.id}`, { verified: doc.verified ? 0 : 1 });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "documents"] });
  }
  async function deleteDoc(docId: string) {
    await apiRequest("DELETE", `/api/documents/${docId}`);
    queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "documents"] });
  }

  async function toggleTask(task: Task) {
    const newStatus = task.status === "done" ? "open" : "done";
    await apiRequest("PATCH", `/api/tasks/${task.id}`, { status: newStatus });
    refetchTasks();
  }

  async function createTask() {
    if (!newTask.title || !newTask.assigneeId || !newTask.dueAt) {
      toast({ title: "Заполните все обязательные поля", variant: "destructive" });
      return;
    }
    await apiRequest("POST", `/api/candidates/${id}/tasks`, newTask);
    setNewTaskOpen(false);
    setNewTask({ assigneeId: "", title: "", description: "", dueAt: "" });
    refetchTasks();
    toast({ title: "Задача создана" });
  }

  async function generateLinkToken() {
    try {
      const res = await apiRequest("POST", `/api/candidates/${id}/link-token`, {});
      const data = (await res.json()) as LinkTokenResponse;
      return data;
    } catch {
      return null;
    }
  }

  async function openAiRejection() {
    setAiRejectionOpen(true);
    setAiRejectionText("");
    setAiRejectionLoading(true);
    try {
      const res = await apiRequest("POST", `/api/candidates/${id}/generate-rejection`, { reason: rejectReason || undefined });
      const data = await res.json() as { text?: string };
      setAiRejectionText(data.text ?? "");
    } catch {
      toast({ title: "Ошибка AI", variant: "destructive" });
    } finally {
      setAiRejectionLoading(false);
    }
  }

  async function sendAiRejection() {
    try {
      await apiRequest("POST", `/api/candidates/${id}/send-rejection`, {
        reason: rejectReason || undefined,
        customText: aiRejectionText || undefined,
      });
      // Also change stage to rejected
      await changeStage("rejected", rejectReason || undefined);
      setAiRejectionOpen(false);
      setRejectOpen(false);
      toast({ title: "Отказ отправлен" });
    } catch {
      toast({ title: "Ошибка отправки отказа", variant: "destructive" });
    }
  }

  async function openSendQuiz() {
    setSendQuizOpen(true);
    try {
      const res = await apiRequest("GET", "/api/quizzes");
      const data = await res.json() as QuizSummary[];
      setQuizzes(data.filter((q) => (q as QuizSummary & { active?: number }).active !== 0));
    } catch {
      setQuizzes([]);
    }
  }

  async function sendQuizToCandidate() {
    if (!selectedQuizId) return;
    setSendingQuiz(true);
    try {
      await apiRequest("POST", `/api/candidates/${id}/send-quiz`, { quizId: selectedQuizId });
      setSendQuizOpen(false);
      toast({ title: "Тест отправлен" });
    } catch {
      toast({ title: "Ошибка отправки теста", variant: "destructive" });
    } finally {
      setSendingQuiz(false);
    }
  }

  const filteredMsgs = (messages ?? []).filter((m) => msgFilter === "all" || m.channel === msgFilter);
  const notesValue = notesDraft ?? candidate.notes ?? "";
  const hasTelegramLink = Boolean(candidate.telegramChatId);

  return (
    <Layout title="Карточка кандидата">
      <div className="p-5 md:p-8">
        <Link href="/candidates" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
          <ArrowLeft className="h-4 w-4" /> К кандидатам
        </Link>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          {/* LEFT */}
          <Card className="p-5 lg:col-span-1">
            <div className="flex flex-col items-center text-center">
              <CandidateAvatar name={candidate.fullName} url={candidate.avatarUrl} size="xl" />
              <h2 className="mt-3 font-sans text-lg font-bold normal-case tracking-tight" style={{ letterSpacing: "-0.01em" }} data-testid="text-candidate-name">{candidate.fullName}</h2>
              <div className="mt-1 flex items-center gap-2">
                <SourceBadge source={candidate.source} />
                {vacancy && <span className="text-xs text-muted-foreground">{vacancy.title}</span>}
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm">
              <button onClick={copyPhone} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover-elevate" data-testid="button-copy-phone">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{candidate.phone}</span>
                <Copy className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {candidate.email && (
                <div className="flex items-center gap-2 px-2"><Mail className="h-4 w-4 text-muted-foreground" /><span className="truncate">{candidate.email}</span></div>
              )}
              <div className="flex items-center gap-2 px-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span>{candidate.city}</span></div>
            </div>

            {/* Telegram link status */}
            <div className="mt-4 rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Bot className="h-4 w-4 text-[#0088CC]" />
                <span className="marshall-display text-xs text-muted-foreground">Telegram-связка</span>
              </div>
              {hasTelegramLink ? (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1 text-green-600"><Check className="h-3.5 w-3.5" /> Привязан</div>
                  <div className="text-muted-foreground">chat_id: {candidate.telegramChatId}</div>
                </div>
              ) : (
                <TelegramLinkPanel candidateId={id} />
              )}
            </div>

            {/* Rating */}
            <div className="mt-5">
              <div className="marshall-display mb-1.5 text-xs text-muted-foreground">Оценка</div>
              <div className="flex gap-1" data-testid="rating-stars">
                {[1, 2, 3, 4, 5].map((r) => (
                  <button key={r} onClick={() => setRating(r)} data-testid={`star-${r}`}>
                    <Star className={cn("h-5 w-5", (candidate.rating ?? 0) >= r ? "fill-accent text-accent" : "text-muted-foreground/40")} />
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div className="mt-5">
              <div className="marshall-display mb-1.5 text-xs text-muted-foreground">Теги</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                    {t}
                    <button onClick={() => removeTag(t)} data-testid={`remove-tag-${t}`}><X className="h-3 w-3 text-muted-foreground hover:text-destructive" /></button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} placeholder="Добавить тег" className="h-8 text-xs" data-testid="input-new-tag" />
                <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={addTag} data-testid="button-add-tag"><Plus className="h-4 w-4" /></Button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
              <div><div className="marshall-display text-[11px] text-muted-foreground">Опыт</div><div className="font-medium">{candidate.experience}</div></div>
              <div><div className="marshall-display text-[11px] text-muted-foreground">Ожидания</div><div className="font-medium">{candidate.expectedSalary ?? "—"}</div></div>
            </div>
          </Card>

          {/* CENTER */}
          <Card className="p-0 lg:col-span-2">
            <Tabs defaultValue="messages" className="flex h-full flex-col">
              <TabsList className="m-3 grid w-auto grid-cols-9">
                <TabsTrigger value="messages" className="marshall-display text-[10px]" data-testid="tab-messages"><MessageSquare className="mr-1 h-3.5 w-3.5" />Переписка</TabsTrigger>
                <TabsTrigger value="documents" className="marshall-display text-[10px]" data-testid="tab-documents"><FileText className="mr-1 h-3.5 w-3.5" />Документы</TabsTrigger>
                <TabsTrigger value="quizzes" className="marshall-display text-[10px]" data-testid="tab-quizzes"><ClipboardList className="mr-1 h-3.5 w-3.5" />Тесты</TabsTrigger>
                <TabsTrigger value="tasks" className="marshall-display text-[10px]" data-testid="tab-tasks"><CheckSquare className="mr-1 h-3.5 w-3.5" />Задачи</TabsTrigger>
                <TabsTrigger value="automations" className="marshall-display text-[10px]" data-testid="tab-automations"><Zap className="mr-1 h-3.5 w-3.5" />Авто</TabsTrigger>
                <TabsTrigger value="notes" className="marshall-display text-[10px]" data-testid="tab-notes"><StickyNote className="mr-1 h-3.5 w-3.5" />Заметки</TabsTrigger>
                <TabsTrigger value="history" className="marshall-display text-[10px]" data-testid="tab-history"><History className="mr-1 h-3.5 w-3.5" />История</TabsTrigger>
                <TabsTrigger value="utm" className="marshall-display text-[10px]" data-testid="tab-utm"><BarChart2 className="mr-1 h-3.5 w-3.5" />UTM</TabsTrigger>
                <TabsTrigger value="video" className="marshall-display text-[10px]" data-testid="tab-video"><Video className="mr-1 h-3.5 w-3.5" />Видео</TabsTrigger>
              </TabsList>

              {/* Messages */}
              <TabsContent value="messages" className="m-0 flex flex-1 flex-col">
                <div className="flex items-center gap-2 border-y border-border px-4 py-2">
                  <Select value={msgFilter} onValueChange={setMsgFilter}>
                    <SelectTrigger className="h-8 w-40 text-xs" data-testid="filter-channel"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все каналы</SelectItem>
                      <SelectItem value="hh">hh.ru</SelectItem>
                      <SelectItem value="avito">Avito</SelectItem>
                      <SelectItem value="telegram">Telegram</SelectItem>
                      <SelectItem value="telegram_bot">Бот Telegram</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <TooltipProvider>
                <div className="flex-1 space-y-3 overflow-auto p-4" style={{ maxHeight: 420 }} data-testid="messages-list">
                  {filteredMsgs.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">Нет сообщений</div>}
                  {filteredMsgs.map((m) => (
                    <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[75%] rounded-xl px-3 py-2 text-sm",
                        m.direction === "out" ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}>
                        <div className="mb-0.5 flex items-center gap-1 text-[10px] opacity-70">
                          {m.channel === "hh" && (
                            <span className="inline-flex items-center rounded bg-[#D6001C] px-1 py-px text-[9px] font-semibold text-white opacity-100" data-testid={`badge-hh-${m.id}`}>hh.ru</span>
                          )}
                          {m.channel === "telegram_bot" && (
                            <span className="inline-flex items-center rounded bg-[#0088CC] px-1 py-px text-[9px] font-semibold text-white opacity-100">бот</span>
                          )}
                          <span>{CHANNELS[m.channel] ?? m.channel} · {fmtDate(m.sentAt, true)}</span>
                          {m.direction === "out" && m.deliveryStatus === "failed" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span data-testid={`status-failed-${m.id}`}><AlertTriangle className="h-3 w-3 text-red-300" /></span>
                              </TooltipTrigger>
                              <TooltipContent>Не доставлено</TooltipContent>
                            </Tooltip>
                          )}
                          {m.direction === "out" && m.deliveryStatus === "pending" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span data-testid={`status-pending-${m.id}`}><Clock className="h-3 w-3" /></span>
                              </TooltipTrigger>
                              <TooltipContent>Отправляется…</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div>{m.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                </TooltipProvider>
                <div className="flex items-center gap-2 border-t border-border p-3">
                  <Select value={msgChannel} onValueChange={(v) => { setChannelTouched(true); setMsgChannel(v); }}>
                    <SelectTrigger className="h-9 w-32 text-xs" data-testid="select-msg-channel"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hh">hh.ru</SelectItem>
                      <SelectItem value="telegram">Telegram</SelectItem>
                      <SelectItem value="telegram_bot">Бот</SelectItem>
                      <SelectItem value="avito">Avito</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input value={msgText} onChange={(e) => setMsgText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Введите сообщение..." data-testid="input-message" />
                  <Button size="icon" onClick={sendMessage} data-testid="button-send-message"><Send className="h-4 w-4" /></Button>
                </div>
              </TabsContent>

              {/* Documents */}
              <TabsContent value="documents" className="m-0 p-4">
                <input ref={fileRef} type="file" className="hidden" onChange={uploadDoc} data-testid="input-file" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {DOC_TYPES.map((dt) => {
                    const docs = (documents ?? []).filter((d) => d.type === dt.key);
                    return (
                      <div key={dt.key} className="rounded-xl border border-card-border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="marshall-display text-xs">{dt.label}</span>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { setUploadType(dt.key); fileRef.current?.click(); }} data-testid={`upload-${dt.key}`}>
                            <Upload className="h-3 w-3" /> Загрузить
                          </Button>
                        </div>
                        {docs.length === 0 ? (
                          <div className="text-xs text-muted-foreground">Не загружено</div>
                        ) : (
                          <div className="space-y-1.5">
                            {docs.map((d) => (
                              <div key={d.id} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5 text-xs">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="truncate flex-1">{d.fileName}</span>
                                <button onClick={() => toggleVerify(d)} title="Проверен" data-testid={`verify-${d.id}`} className={cn("rounded p-0.5", d.verified ? "text-green-600" : "text-muted-foreground")}>
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => deleteDoc(d.id)} data-testid={`delete-doc-${d.id}`} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              {/* Quiz Attempts (Iter4) */}
              <TabsContent value="quizzes" className="m-0 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">Попытки тестов</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={openSendQuiz}
                    disabled={!hasTelegramLink}
                    data-testid="button-send-quiz"
                  >
                    <ClipboardList className="h-3 w-3" /> Отправить тест
                  </Button>
                </div>
                {!hasTelegramLink && (
                  <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    Кандидат не привязан к Telegram
                  </div>
                )}
                <div className="space-y-2" data-testid="quiz-attempts-list">
                  {quizAttempts.length === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">Нет попыток</div>
                  )}
                  {quizAttempts.map((a) => (
                    <div key={a.id} className="rounded-xl border border-card-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium">Попытка теста</div>
                          <div className="text-[11px] text-muted-foreground">Начал: {fmtDate(a.startedAt, true)}</div>
                          {a.finishedAt && (
                            <div className="text-[11px] text-muted-foreground">Завершен: {fmtDate(a.finishedAt, true)}</div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            a.status === "passed" ? "bg-green-100 text-green-700" :
                            a.status === "failed" ? "bg-red-100 text-red-700" :
                            "bg-blue-100 text-blue-700",
                          )}>
                            {a.status === "passed" ? "Пройден" : a.status === "failed" ? "Не пройден" : "В процессе"}
                          </span>
                          {a.scorePercent !== null && (
                            <span className="text-[11px] text-muted-foreground">{a.scorePercent}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Tasks */}
              <TabsContent value="tasks" className="m-0 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">Задачи</span>
                  <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setNewTaskOpen(true)} data-testid="button-new-task">
                    <Plus className="h-3 w-3" /> Новая задача
                  </Button>
                </div>
                <div className="space-y-2" data-testid="tasks-list">
                  {(tasks ?? []).length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Нет задач</div>}
                  {(tasks ?? []).map((task) => (
                    <div key={task.id} className={cn("rounded-xl border border-card-border p-3", task.status === "done" && "opacity-60")}>
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => toggleTask(task)}
                          data-testid={`task-toggle-${task.id}`}
                          className={cn("mt-0.5 shrink-0 rounded p-0.5", task.status === "done" ? "text-green-600" : "text-muted-foreground")}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className={cn("text-sm font-medium", task.status === "done" && "line-through")}>{task.title}</div>
                          {task.description && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{task.description}</div>}
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>До {fmtDate(task.dueAt, true)}</span>
                            {task.source === "auto" && (
                              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">авто</span>
                            )}
                          </div>
                        </div>
                        <span className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                          task.status === "open" ? "bg-amber-100 text-amber-700" :
                          task.status === "done" ? "bg-green-100 text-green-700" :
                          "bg-gray-100 text-gray-500"
                        )}>
                          {task.status === "open" ? "Открыта" : task.status === "done" ? "Выполнена" : "Отменена"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Automations */}
              <TabsContent value="automations" className="m-0 p-4">
                <div className="mb-3 text-sm font-medium">Автоматизации</div>
                <div className="space-y-3">
                  {/* Pending scheduled actions */}
                  <div>
                    <div className="marshall-display mb-2 text-xs text-muted-foreground">Запланированные действия</div>
                    {(automations ?? []).length === 0 && (
                      <div className="text-xs text-muted-foreground">Нет активных таймеров</div>
                    )}
                    {(automations ?? []).map((a) => (
                      <div key={a.id} className={cn(
                        "mb-2 rounded-lg border border-card-border p-2.5 text-xs",
                        a.status === "pending" ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20" :
                        a.status === "done" ? "opacity-50" : "opacity-40"
                      )}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{a.kind}</span>
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px]",
                            a.status === "pending" ? "bg-blue-100 text-blue-600" :
                            a.status === "done" ? "bg-green-100 text-green-600" :
                            a.status === "cancelled" ? "bg-gray-100 text-gray-500" :
                            "bg-red-100 text-red-600"
                          )}>{a.status}</span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          <span>Запускается: {fmtDate(a.runAt, true)}</span>
                          <span className="ml-2">· Этап: {a.triggerStage}</span>
                        </div>
                        {a.lastError && <div className="mt-1 text-red-500">{a.lastError}</div>}
                      </div>
                    ))}
                  </div>

                  {/* Stage history */}
                  <div>
                    <div className="marshall-display mb-2 text-xs text-muted-foreground">История стадий</div>
                    {(stageEvents ?? []).length === 0 && (
                      <div className="text-xs text-muted-foreground">Нет событий</div>
                    )}
                    {(stageEvents ?? []).map((e) => (
                      <div key={e.id} className="mb-2 flex items-center gap-2 text-xs">
                        <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <span className="text-muted-foreground">{fmtDate(e.changedAt, true)}</span>
                        <span>{e.fromStage ?? "—"} → <strong>{e.toStage}</strong></span>
                        <span className="text-muted-foreground">({e.changedBy})</span>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              {/* Notes */}
              <TabsContent value="notes" className="m-0 p-4">
                <Textarea
                  value={notesValue}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={saveNotes}
                  placeholder="Заметки рекрутёра... (сохраняется автоматически)"
                  className="min-h-[300px] resize-none"
                  data-testid="textarea-notes"
                />
              </TabsContent>

              {/* History */}
              <TabsContent value="history" className="m-0 p-4">
                <div className="space-y-0" data-testid="timeline">
                  {(activities ?? []).map((a, i) => {
                    const Icon = ACTIVITY_ICONS[a.type] ?? History;
                    return (
                      <div key={a.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary/40 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          {i < (activities?.length ?? 0) - 1 && <div className="w-px flex-1 bg-border" />}
                        </div>
                        <div className="pb-5">
                          <div className="text-sm">{a.description}</div>
                          <div className="text-xs text-muted-foreground">{fmtDate(a.createdAt, true)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {(activities ?? []).length === 0 && <div className="text-sm text-muted-foreground">Нет событий</div>}
                </div>
              </TabsContent>
              <TabsContent value="utm" className="m-0 p-4">
                <UtmBlock candidate={candidate} />
              </TabsContent>

              {/* Video Interviews (Iter6) */}
              <TabsContent value="video" className="m-0 p-4">
                <VideoInterviewTab candidateId={id} />
              </TabsContent>
            </Tabs>
          </Card>

          {/* RIGHT */}
          <Card className="p-5 lg:col-span-1">
            <div className="marshall-display text-xs text-muted-foreground">Текущий этап</div>
            <div className="mt-2"><StageBadge stage={candidate.stage} /></div>
            <Select value={candidate.stage} onValueChange={(v) => changeStage(v)}>
              <SelectTrigger className="mt-3" data-testid="select-stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {candidate.stage === "rejected" && candidate.rejectReason && (
              <div className="mt-3 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{candidate.rejectReason}</div>
            )}

            <div className="marshall-display mt-5 text-xs text-muted-foreground">Действия</div>
            <div className="mt-2 space-y-2">
              <Button variant="outline" className="h-auto w-full justify-start gap-2 whitespace-normal py-2" data-testid="button-schedule-interview"
                onClick={async () => { await apiRequest("POST", `/api/candidates/${id}/messages`, { channel: "telegram", text: "Приглашаем вас на собеседование. Когда вам удобно?", isRead: 1 }); queryClient.invalidateQueries({ queryKey: ["/api/candidates", id, "messages"] }); toast({ title: "Приглашение на собеседование отправлено" }); }}>
                <CalendarPlus className="h-4 w-4 shrink-0" /> <span className="text-left leading-tight">Запланировать интервью</span>
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" data-testid="button-call" onClick={copyPhone}>
                <PhoneCall className="h-4 w-4" /> Позвонить
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" data-testid="button-archive"
                onClick={() => { changeStage("reserve"); toast({ title: "Кандидат перемещён в резерв" }); }}>
                <Archive className="h-4 w-4" /> В резерв
              </Button>
              <Button variant="destructive" className="w-full justify-start gap-2" data-testid="button-reject" onClick={() => setRejectOpen(true)}>
                <X className="h-4 w-4" /> Отказать
              </Button>
            </div>

            {/* AI Analysis Section (Iter2) */}
            <AiAnalysisSection candidateId={id} candidate={candidate} />
          </Card>
        </div>
      </div>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Причина отказа</DialogTitle></DialogHeader>
          <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Укажите причину отказа..." data-testid="textarea-reject" />
          <p className="text-xs text-muted-foreground">Используйте AI-персонализацию для превью и отправки тёплого отказа через Telegram.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} data-testid="button-cancel-reject">Отмена</Button>
            <Button variant="outline" onClick={openAiRejection} data-testid="button-ai-rejection">
              <Sparkles className="mr-1 h-4 w-4" /> AI-отказ
            </Button>
            <Button variant="destructive" data-testid="button-confirm-reject"
              onClick={async () => { await changeStage("rejected", rejectReason); setRejectOpen(false); setRejectReason(""); toast({ title: "Кандидат отклонён" }); }}>
              Отказать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Rejection preview dialog (Iter4) */}
      <Dialog open={aiRejectionOpen} onOpenChange={setAiRejectionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>AI-персонализированный отказ</DialogTitle></DialogHeader>
          {aiRejectionLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Генерирую...</span>
            </div>
          ) : (
            <Textarea
              value={aiRejectionText}
              onChange={(e) => setAiRejectionText(e.target.value)}
              className="min-h-[200px] text-sm"
              placeholder="Текст отказа..."
              data-testid="textarea-ai-rejection"
            />
          )}
          <p className="text-xs text-muted-foreground">Можно отредактировать перед отправкой.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiRejectionOpen(false)}>Отмена</Button>
            <Button
              variant="outline"
              onClick={openAiRejection}
              disabled={aiRejectionLoading}
              data-testid="button-regenerate-rejection"
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Перегенерировать
            </Button>
            <Button
              variant="destructive"
              onClick={sendAiRejection}
              disabled={!aiRejectionText || aiRejectionLoading}
              data-testid="button-send-ai-rejection"
            >
              <Send className="mr-1 h-3.5 w-3.5" /> Отправить отказ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send quiz dialog (Iter4) */}
      <Dialog open={sendQuizOpen} onOpenChange={setSendQuizOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Отправить тест</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="mb-1 block text-xs text-muted-foreground">Выберите тест</label>
            <Select value={selectedQuizId} onValueChange={setSelectedQuizId}>
              <SelectTrigger data-testid="select-quiz"><SelectValue placeholder="Выберите тест..." /></SelectTrigger>
              <SelectContent>
                {quizzes.map((q) => (
                  <SelectItem key={q.id} value={q.id}>{q.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendQuizOpen(false)}>Отмена</Button>
            <Button
              onClick={sendQuizToCandidate}
              disabled={!selectedQuizId || sendingQuiz}
              data-testid="button-confirm-send-quiz"
            >
              {sendingQuiz ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Отправить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New task dialog */}
      <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Новая задача</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Назначить</label>
              <Select value={newTask.assigneeId} onValueChange={(v) => setNewTask((p) => ({ ...p, assigneeId: v }))}>
                <SelectTrigger data-testid="select-task-assignee"><SelectValue placeholder="Выберите ответственного" /></SelectTrigger>
                <SelectContent>
                  {(crmUsers ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Название *</label>
              <Input value={newTask.title} onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))} placeholder="Название задачи" data-testid="input-task-title" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Описание</label>
              <Textarea value={newTask.description} onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))} placeholder="Описание..." className="min-h-[80px]" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Срок *</label>
              <Input type="datetime-local" value={newTask.dueAt} onChange={(e) => setNewTask((p) => ({ ...p, dueAt: e.target.value ? new Date(e.target.value).toISOString() : "" }))} data-testid="input-task-due" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTaskOpen(false)}>Отмена</Button>
            <Button onClick={createTask} data-testid="button-create-task">Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// AI Analysis panel (Iter2)
type AiVerdict = "take" | "reserve" | "reject" | "pending" | null;

function verdictLabel(v: AiVerdict): string {
  if (v === "take") return "Взять в работу";
  if (v === "reserve") return "В резерв";
  if (v === "reject") return "Отказать";
  if (v === "pending") return "Ожидание...";
  return "Не проверен";
}

function verdictColor(v: AiVerdict): string {
  if (v === "take") return "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300";
  if (v === "reserve") return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
  if (v === "reject") return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  if (v === "pending") return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300";
  return "bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-400";
}

function AiAnalysisSection({ candidateId, candidate }: { candidateId: string; candidate: Candidate }) {
  const { toast } = useToast();

  const screenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/candidates/${candidateId}/ai-screen`);
      return res.json() as Promise<{ ok: boolean; candidate?: Candidate }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/candidates", candidateId] });
      toast({ title: "AI-анализ обновлён" });
    },
    onError: () => toast({ title: "Ошибка AI-анализа", variant: "destructive" }),
  });

  const verdict = (candidate as Candidate & { aiVerdict?: AiVerdict }).aiVerdict ?? null;
  const reasoning = (candidate as Candidate & { aiReasoning?: string }).aiReasoning ?? null;
  const aiScore = (candidate as Candidate & { aiScore?: number }).aiScore ?? null;
  const predictiveScore = (candidate as Candidate & { predictiveScore?: number }).predictiveScore ?? null;
  const predictiveFactors: string[] = (() => {
    try {
      const raw = (candidate as Candidate & { predictiveFactors?: string }).predictiveFactors;
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  })();
  const fakeScore = (candidate as Candidate & { fakeScore?: number }).fakeScore ?? null;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <span className="marshall-display text-xs text-muted-foreground">AI-анализ</span>
        </div>
        <button
          onClick={() => screenMutation.mutate()}
          disabled={screenMutation.isPending}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          data-testid="button-ai-reanalyze"
        >
          {screenMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Пересчитать
        </button>
      </div>

      {/* Verdict badge */}
      <div className="mb-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${verdictColor(verdict)}`} data-testid="ai-verdict-badge">
          {verdictLabel(verdict)}
        </span>
        {aiScore !== null && (
          <span className="ml-2 text-[10px] text-muted-foreground">балл: {aiScore}/100</span>
        )}
      </div>

      {/* Reasoning */}
      {reasoning && (
        <p className="mb-3 text-xs text-muted-foreground leading-relaxed" data-testid="ai-reasoning">{reasoning}</p>
      )}

      {/* Predictive score */}
      {predictiveScore !== null && (
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
            <span>Вероятность трудоустройства</span>
            <span data-testid="predictive-score-value">{predictiveScore}%</span>
          </div>
          <Progress value={predictiveScore} className="h-2" data-testid="predictive-score-bar" />
          {predictiveFactors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {predictiveFactors.slice(0, 3).map((f, i) => (
                <li key={i} className="text-[10px] text-muted-foreground">• {f}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Fake score */}
      {fakeScore !== null && fakeScore > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 dark:bg-amber-500/10" data-testid="fake-score-section">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          <span className="text-[10px] text-amber-700 dark:text-amber-400">Риск фейка: {fakeScore}/100</span>
        </div>
      )}

      {!verdict && !screenMutation.isPending && (
        <p className="text-[10px] text-muted-foreground">AI-скрининг ещё не запускался</p>
      )}
    </div>
  );
}

// Panel for Telegram deep-link generation
function TelegramLinkPanel({ candidateId }: { candidateId: string }) {
  const [linkData, setLinkData] = useState<{ token: string; deepLink: string; botUsername: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function generate() {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/candidates/${candidateId}/link-token`, {});
      const data = await res.json() as { token: string; deepLink: string; botUsername: string };
      setLinkData(data);
    } catch {
      toast({ title: "Ошибка генерации ссылки", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (!linkData) {
    return (
      <Button size="sm" variant="outline" className="h-7 w-full gap-1 text-xs" onClick={generate} disabled={loading} data-testid="button-gen-link-token">
        <Link2 className="h-3 w-3" /> {loading ? "Генерирую..." : "Создать ссылку"}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="break-all rounded bg-muted px-2 py-1.5 text-[10px]">{linkData.deepLink}</div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full gap-1 text-xs"
        onClick={() => {
          navigator.clipboard.writeText(linkData.deepLink).catch(() => {});
          toast({ title: "Ссылка скопирована" });
        }}
        data-testid="button-copy-link"
      >
        <Copy className="h-3 w-3" /> Скопировать
      </Button>
    </div>
  );
}

// ── UTM block ─────────────────────────────────────────────────────────────
const UTM_LABEL: Record<string, string> = {
  utmSource: "Источник (utm_source)",
  utmMedium: "Канал (utm_medium)",
  utmCampaign: "Кампания (utm_campaign)",
  utmContent: "Содержание (utm_content)",
  utmTerm: "Ключевое слово (utm_term)",
};

function UtmBlock({ candidate }: { candidate: Candidate }) {
  const raw = candidate as unknown as Record<string, string | null>;
  const keys = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"] as const;
  const hasAny = keys.some((k) => raw[k]);

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
        <BarChart2 className="h-8 w-8 opacity-30" />
        <div>UTM-метки не найдены</div>
        <div className="text-xs">Кандидат пришёл без UTM-параметров в ссылке</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-muted-foreground">UTM-метки кандидата</div>
      <div className="space-y-2">
        {keys.map((k) => {
          const val = raw[k];
          if (!val) return null;
          return (
            <div key={k} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">{UTM_LABEL[k]}</span>
              <span className="rounded bg-muted px-2 py-1 text-xs font-mono">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Iter6: Video Interview Tab ────────────────────────────────────────────────

interface InterviewVideo {
  id: string;
  candidateId: string;
  source: string;
  sourceUrl: string;
  status: string;
  durationSec: number | null;
  aiSummary: string | null;
  errorMsg: string | null;
  createdAt: string;
  completedAt: string | null;
}

function VideoInterviewTab({ candidateId }: { candidateId: string }) {
  const { toast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: videos, isLoading } = useQuery<InterviewVideo[]>({
    queryKey: ["/api/interviews/by-candidate", candidateId],
    queryFn: () =>
      fetch(`/api/interviews/by-candidate/${candidateId}`).then((r) => r.json()),
  });

  const addVideo = async () => {
    if (!newUrl.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/interviews/analyze", {
        candidateId,
        sourceUrl: newUrl.trim(),
        source: "zoom",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/interviews/by-candidate", candidateId] });
      toast({ title: "Анализ запущен", description: "Готово через ~5 минут." });
      setNewUrl("");
      setShowAddModal(false);
    } catch {
      toast({ title: "Ошибка", description: "Не удалось запустить анализ", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const retryVideo = async (videoId: string) => {
    await apiRequest("POST", `/api/interviews/${videoId}/retry`, {});
    queryClient.invalidateQueries({ queryKey: ["/api/interviews/by-candidate", candidateId] });
    toast({ title: "Повторный запуск анализа" });
  };

  const statusLabel: Record<string, string> = {
    pending: "В очереди",
    downloading: "Скачивается",
    transcribing: "Транскрипция",
    analyzing: "Анализируется",
    done: "Готово",
    error: "Ошибка",
  };

  const statusColor: Record<string, string> = {
    pending: "bg-blue-100 text-blue-700",
    downloading: "bg-yellow-100 text-yellow-700",
    transcribing: "bg-orange-100 text-orange-700",
    analyzing: "bg-purple-100 text-purple-700",
    done: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Видеоинтервью</div>
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Video className="mr-1.5 h-3.5 w-3.5" /> Анализировать видео
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!isLoading && (!videos || videos.length === 0) && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Video className="h-8 w-8 opacity-30" />
          <div>Нет видеоинтервью</div>
          <div className="text-xs">Добавьте ссылку на Zoom-запись для AI-анализа</div>
        </div>
      )}

      {(videos ?? []).map((v) => (
        <div key={v.id} className="rounded-lg border border-border p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusColor[v.status] ?? "bg-gray-100 text-gray-600")}>
                {statusLabel[v.status] ?? v.status}
              </span>
              <span className="text-muted-foreground">
                {new Date(v.createdAt).toLocaleDateString("ru-RU")}
              </span>
              {v.durationSec && (
                <span className="text-muted-foreground">
                  {Math.round(v.durationSec / 60)} мин
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {v.status === "error" && (
                <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => retryVideo(v.id)}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Повторить
                </Button>
              )}
              {v.status === "done" && (
                <Link href={`/candidates/${candidateId}/video/${v.id}`}>
                  <Button variant="outline" size="sm" className="h-6 text-[10px]">
                    <ExternalLink className="mr-1 h-3 w-3" /> Открыть анализ
                  </Button>
                </Link>
              )}
            </div>
          </div>
          <div className="mt-1.5 truncate text-muted-foreground">{v.sourceUrl}</div>
          {v.errorMsg && (
            <div className="mt-1.5 text-red-500">{v.errorMsg}</div>
          )}
          {v.aiSummary && v.status === "done" && (
            <div className="mt-2 text-muted-foreground line-clamp-2">{v.aiSummary}</div>
          )}
        </div>
      ))}

      {/* Add video modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Анализировать видеоинтервью</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Вставьте ссылку на Zoom-запись (публичная, без пароля). AI транскрибирует и проанализирует интервью за 5-10 минут.
            </div>
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://zoom.us/rec/share/..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>Отмена</Button>
            <Button onClick={addVideo} disabled={!newUrl.trim() || submitting}>
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Video className="mr-1.5 h-4 w-4" />}
              Запустить анализ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
