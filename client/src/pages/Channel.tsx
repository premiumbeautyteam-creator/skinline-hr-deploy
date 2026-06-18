import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Radio, CalendarDays, Sparkles, Users, RefreshCw, Send,
  Pencil, Trash2, Clock, CheckCircle2,
  XCircle, Loader2, ChevronDown, ChevronUp, Zap,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ChannelSettings, ContentRubric, ChannelPost, ChannelSubscriber, ReserveReactivation } from "@shared/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const RUBRIC_COLORS: Record<string, string> = {
  studio_life: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  review:      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  tips:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  poll:        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  vacancy:     "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
};

const STATUS_LABELS: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  draft:     { label: "Черновик", icon: <Pencil className="h-3 w-3" />, cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  scheduled: { label: "Запланирован", icon: <Clock className="h-3 w-3" />, cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  published: { label: "Опубликован", icon: <CheckCircle2 className="h-3 w-3" />, cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  failed:    { label: "Ошибка", icon: <XCircle className="h-3 w-3" />, cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  rejected:  { label: "Отклонён", icon: <XCircle className="h-3 w-3" />, cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
};

// ── Connect Modal ─────────────────────────────────────────────────────────────

function ConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const { toast } = useToast();
  const [value, setValue] = useState("@SkinLineHR");

  const connectMutation = useMutation({
    mutationFn: async (channelUsername: string) => {
      const res = await apiRequest("POST", "/api/channel/connect", { channelUsername });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? "Ошибка подключения");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Канал подключён" });
      queryClient.invalidateQueries({ queryKey: ["/api/channel/settings"] });
      onConnected();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подключить канал</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Убедитесь, что бот <strong>@Assistant_skin_line_bot</strong> добавлен как администратор канала с правом постить сообщения.
          </p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="@SkinLineHR или -100..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => connectMutation.mutate(value)}
            disabled={connectMutation.isPending}
          >
            {connectMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Подключить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Post Card ─────────────────────────────────────────────────────────────────

function PostCard({
  post, rubrics, onDelete, onPublishNow, onEdit,
}: {
  post: ChannelPost;
  rubrics: ContentRubric[];
  onDelete: (id: string) => void;
  onPublishNow: (id: string) => void;
  onEdit: (post: ChannelPost) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rubric = rubrics.find((r) => r.key === post.rubricKey);
  const statusInfo = STATUS_LABELS[post.status] ?? STATUS_LABELS.draft;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className={cn("marshall-display inline-flex rounded-full px-2 py-0.5 text-[10px] shrink-0", RUBRIC_COLORS[post.rubricKey] ?? "bg-gray-100 text-gray-600")}>
          {rubric?.name ?? post.rubricKey}
        </span>
        <span className={cn("marshall-display inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] shrink-0", statusInfo.cls)}>
          {statusInfo.icon}
          {statusInfo.label}
        </span>
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {post.scheduledAt ? fmt(post.scheduledAt) : fmt(post.createdAt)}
        </span>
      </div>

      <div className="text-sm font-medium leading-snug">{post.title}</div>

      {expanded && (
        <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-muted rounded p-2 max-h-48 overflow-auto">{post.body}</pre>
      )}

      <div className="flex items-center gap-1 pt-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Свернуть" : "Посмотреть"}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onEdit(post)}>
          <Pencil className="h-3 w-3" />
        </Button>
        {post.status !== "published" && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-green-600" onClick={() => onPublishNow(post.id)}>
            <Send className="h-3 w-3" /> Опубликовать
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive ml-auto" onClick={() => onDelete(post.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </Card>
  );
}

// ── Generate Post Modal ────────────────────────────────────────────────────────

function GeneratePostModal({
  rubrics, onClose, onSave,
}: {
  rubrics: ContentRubric[];
  onClose: () => void;
  onSave: (draft: { title: string; body: string; rubricKey: string; pollOptions?: string[] | null }) => void;
}) {
  const { toast } = useToast();
  const [rubricKey, setRubricKey] = useState(rubrics[0]?.key ?? "studio_life");
  const [contextHint, setContextHint] = useState("");
  const [generated, setGenerated] = useState<{ title: string; body: string; pollOptions?: string[] | null } | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/channel/posts/generate", { rubricKey, contextHint });
      if (!res.ok) throw new Error("AI генерация не удалась");
      return res.json() as Promise<{ title: string; body: string; pollOptions?: string[] | null }>;
    },
    onSuccess: (data) => setGenerated(data),
    onError: (err: Error) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Сгенерировать пост
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Рубрика</label>
              <Select value={rubricKey} onValueChange={setRubricKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {rubrics.filter((r) => r.active === 1).map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Дополнительный контекст (необязательно)</label>
              <Input value={contextHint} onChange={(e) => setContextHint(e.target.value)} placeholder="Пример: акция к 8 марта" />
            </div>
          </div>

          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="w-full"
          >
            {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Сгенерировать
          </Button>

          {generated && (
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Заголовок: {generated.title}</div>
              <pre className="whitespace-pre-wrap text-sm max-h-60 overflow-auto">{generated.body}</pre>
              {generated.pollOptions && (
                <div className="text-xs text-muted-foreground">
                  Варианты опроса: {generated.pollOptions.join(" / ")}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          {generated && (
            <>
              <Button variant="outline" onClick={() => onSave({ ...generated, rubricKey })}>
                Сохранить как черновик
              </Button>
              <Button onClick={() => onSave({ ...generated, rubricKey })}>
                Сохранить и запланировать
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Post Modal ───────────────────────────────────────────────────────────

function EditPostModal({ post, rubrics, onClose, onSaved }: {
  post: ChannelPost;
  rubrics: ContentRubric[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [scheduledAt, setScheduledAt] = useState(post.scheduledAt ?? "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/channel/posts/${post.id}`, {
        title, body,
        scheduledAt: scheduledAt || null,
        status: scheduledAt ? "scheduled" : "draft",
      });
      if (!res.ok) throw new Error("Ошибка сохранения");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Сохранено" });
      queryClient.invalidateQueries({ queryKey: ["/api/channel/posts"] });
      onSaved();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Редактировать пост</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Заголовок (для админки)</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Текст поста</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="font-mono text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Запланировать на (необязательно)</label>
            <Input
              type="datetime-local"
              value={scheduledAt ? new Date(scheduledAt).toISOString().slice(0, 16) : ""}
              onChange={(e) => setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Channel() {
  const { toast } = useToast();
  const [showConnect, setShowConnect] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [editPost, setEditPost] = useState<ChannelPost | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: settings, isLoading: settingsLoading } = useQuery<ChannelSettings | null>({
    queryKey: ["/api/channel/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/channel/settings");
      if (!res.ok) return null;
      return res.json() as Promise<ChannelSettings | null>;
    },
  });

  const { data: rubrics = [] } = useQuery<ContentRubric[]>({
    queryKey: ["/api/channel/rubrics"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/channel/rubrics");
      return res.json() as Promise<ContentRubric[]>;
    },
  });

  const { data: posts = [], isLoading: postsLoading } = useQuery<ChannelPost[]>({
    queryKey: ["/api/channel/posts", filterStatus],
    queryFn: async () => {
      const url = filterStatus !== "all"
        ? `/api/channel/posts?status=${filterStatus}`
        : "/api/channel/posts";
      const res = await apiRequest("GET", url);
      return res.json() as Promise<ChannelPost[]>;
    },
  });

  const { data: subscribers = [] } = useQuery<ChannelSubscriber[]>({
    queryKey: ["/api/channel/subscribers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/channel/subscribers");
      return res.json() as Promise<ChannelSubscriber[]>;
    },
  });

  const { data: reactivations = [] } = useQuery<ReserveReactivation[]>({
    queryKey: ["/api/reserve/reactivations"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reserve/reactivations");
      return res.json() as Promise<ReserveReactivation[]>;
    },
  });

  const { data: reserveCount } = useQuery<{ total: number; eligibleForReactivation: number }>({
    queryKey: ["/api/reserve/count"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reserve/count");
      return res.json();
    },
  });

  // Prefer hours/days from settings
  const preferredHours: number[] = parseJsonSafe(settings?.preferredHours, [10, 14, 18]);
  const preferredDays: number[] = parseJsonSafe(settings?.preferredDays, [1, 3, 5]);

  const autopilotMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PUT", "/api/channel/settings", { autopilotEnabled: enabled ? 1 : 0 });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/channel/settings"] }),
    onError: () => toast({ title: "Ошибка переключения автопилота", variant: "destructive" }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: Partial<ChannelSettings>) => {
      const res = await apiRequest("PUT", "/api/channel/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channel/settings"] });
      toast({ title: "Настройки сохранены" });
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/channel/posts/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/channel/posts"] }),
    onError: () => toast({ title: "Ошибка удаления", variant: "destructive" }),
  });

  const publishNowMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/channel/posts/${id}/publish-now`);
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? "Ошибка публикации");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Пост опубликован" });
      queryClient.invalidateQueries({ queryKey: ["/api/channel/posts"] });
    },
    onError: (err: Error) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const refillCalendarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/channel/calendar/refill");
      return res.json() as Promise<{ ok: boolean; created: number }>;
    },
    onSuccess: (data) => {
      toast({ title: `Создано ${data.created} новых постов` });
      queryClient.invalidateQueries({ queryKey: ["/api/channel/posts"] });
    },
    onError: () => toast({ title: "Ошибка обновления календаря", variant: "destructive" }),
  });

  const reactivateNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reserve/reactivate-now");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Реактивация запущена" });
      queryClient.invalidateQueries({ queryKey: ["/api/reserve/reactivations"] });
    },
    onError: () => toast({ title: "Ошибка реактивации", variant: "destructive" }),
  });

  const rubricToggleMutation = useMutation({
    mutationFn: async ({ key, active }: { key: string; active: number }) => {
      const res = await apiRequest("PUT", `/api/channel/rubrics/${key}`, { active });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/channel/rubrics"] }),
  });

  const rubricWeightMutation = useMutation({
    mutationFn: async ({ key, weight }: { key: string; weight: number }) => {
      const res = await apiRequest("PUT", `/api/channel/rubrics/${key}`, { weight });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/channel/rubrics"] }),
  });

  const saveGeneratedPost = async (draft: { title: string; body: string; rubricKey: string; pollOptions?: string[] | null }) => {
    try {
      const res = await apiRequest("POST", "/api/channel/posts", {
        ...draft,
        status: "draft",
        pollOptions: draft.pollOptions ? JSON.stringify(draft.pollOptions) : null,
      });
      if (res.ok) {
        toast({ title: "Черновик сохранён" });
        queryClient.invalidateQueries({ queryKey: ["/api/channel/posts"] });
        setShowGenerate(false);
      }
    } catch {
      toast({ title: "Ошибка сохранения черновика", variant: "destructive" });
    }
  };

  const toggleHour = (h: number) => {
    const next = preferredHours.includes(h)
      ? preferredHours.filter((x) => x !== h)
      : [...preferredHours, h].sort((a, b) => a - b);
    if (next.length > 0) {
      saveSettingsMutation.mutate({ preferredHours: JSON.stringify(next) });
    }
  };

  const toggleDay = (d: number) => {
    const next = preferredDays.includes(d)
      ? preferredDays.filter((x) => x !== d)
      : [...preferredDays, d].sort((a, b) => a - b);
    if (next.length > 0) {
      saveSettingsMutation.mutate({ preferredDays: JSON.stringify(next) });
    }
  };

  const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const connected = Boolean(settings?.channelUsername);

  return (
    <Layout title="HR-канал" actions={
      <Button size="sm" className="gap-2" onClick={() => setShowGenerate(true)}>
        <Sparkles className="h-4 w-4" />
        Сгенерировать пост
      </Button>
    }>
      <div className="mx-auto max-w-5xl space-y-6 p-5 md:p-8">

        {/* Header card */}
        <Card className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-full", connected ? "bg-primary/10" : "bg-muted")}>
                <Radio className={cn("h-5 w-5", connected ? "text-primary" : "text-muted-foreground")} />
              </div>
              <div>
                <div className="font-semibold">{settings?.channelTitle ?? "@SkinLineHR"}</div>
                <div className="text-xs text-muted-foreground">
                  {connected ? settings?.channelUsername : "Канал не подключён"}
                </div>
              </div>
            </div>

            <div className="sm:ml-auto flex flex-wrap items-center gap-3">
              {!connected && (
                <Button size="sm" onClick={() => setShowConnect(true)}>Подключить канал</Button>
              )}
              {connected && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">{settings?.autopilotEnabled ? "Автопилот включён" : "Автопилот выключен"}</span>
                  <Switch
                    checked={Boolean(settings?.autopilotEnabled)}
                    onCheckedChange={(v) => autopilotMutation.mutate(v)}
                    disabled={autopilotMutation.isPending}
                  />
                </div>
              )}
            </div>
          </div>

          {settings?.lastPostAt && (
            <div className="mt-2 text-xs text-muted-foreground">
              Последний пост: {fmt(settings.lastPostAt)}
            </div>
          )}
        </Card>

        <Tabs defaultValue="calendar">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="calendar" className="gap-1"><CalendarDays className="h-4 w-4" />Календарь</TabsTrigger>
            <TabsTrigger value="rubrics">Рубрики</TabsTrigger>
            <TabsTrigger value="autopilot">Настройки</TabsTrigger>
            <TabsTrigger value="subscribers" className="gap-1"><Users className="h-4 w-4" />Подписчики</TabsTrigger>
            <TabsTrigger value="reactivation" className="gap-1"><Zap className="h-4 w-4" />Реактивация</TabsTrigger>
          </TabsList>

          {/* ── Calendar tab ── */}
          <TabsContent value="calendar" className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex flex-wrap gap-1">
                {["all", "draft", "scheduled", "published", "failed"].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={filterStatus === s ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setFilterStatus(s)}
                  >
                    {s === "all" ? "Все" : STATUS_LABELS[s]?.label ?? s}
                  </Button>
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => refillCalendarMutation.mutate()}
                  disabled={refillCalendarMutation.isPending}
                >
                  {refillCalendarMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Дозаполнить
                </Button>
              </div>
            </div>

            {postsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : posts.length === 0 ? (
              <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <CalendarDays className="h-10 w-10 text-muted-foreground/40" />
                <div className="text-sm text-muted-foreground">Нет постов</div>
                <Button size="sm" onClick={() => refillCalendarMutation.mutate()} disabled={refillCalendarMutation.isPending}>
                  {refillCalendarMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Сгенерировать план
                </Button>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    rubrics={rubrics}
                    onDelete={(id) => deletePostMutation.mutate(id)}
                    onPublishNow={(id) => publishNowMutation.mutate(id)}
                    onEdit={setEditPost}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Rubrics tab ── */}
          <TabsContent value="rubrics" className="space-y-3">
            {rubrics.map((r) => (
              <Card key={r.key} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("marshall-display inline-flex rounded-full px-2 py-0.5 text-[10px]", RUBRIC_COLORS[r.key] ?? "bg-gray-100 text-gray-600")}>
                        {r.name}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-xs text-muted-foreground">Вес: {r.weight}</span>
                      <div className="w-32">
                        <Slider
                          min={1} max={5} step={1}
                          value={[r.weight]}
                          onValueChange={([v]) => rubricWeightMutation.mutate({ key: r.key, weight: v })}
                          disabled={rubricWeightMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={r.active === 1}
                    onCheckedChange={(v) => rubricToggleMutation.mutate({ key: r.key, active: v ? 1 : 0 })}
                    disabled={rubricToggleMutation.isPending}
                  />
                </div>
              </Card>
            ))}
          </TabsContent>

          {/* ── Autopilot settings tab ── */}
          <TabsContent value="autopilot" className="space-y-4">
            <Card className="p-4 space-y-4">
              <h3 className="font-semibold">Настройки автопостинга</h3>

              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Постов в неделю: {settings?.postsPerWeek ?? 2}</label>
                <div className="w-48">
                  <Slider
                    min={1} max={7} step={1}
                    value={[settings?.postsPerWeek ?? 2]}
                    onValueChange={([v]) => saveSettingsMutation.mutate({ postsPerWeek: v })}
                    disabled={saveSettingsMutation.isPending}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Время публикации (Мск)</label>
                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: 15 }, (_, i) => i + 8).map((h) => (
                    <button
                      key={h}
                      onClick={() => toggleHour(h)}
                      className={cn(
                        "marshall-display rounded px-2 py-1 text-xs border transition-colors",
                        preferredHours.includes(h)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary",
                      )}
                    >
                      {String(h).padStart(2, "0")}:00
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Дни публикации</label>
                <div className="flex flex-wrap gap-1">
                  {DAY_LABELS.map((label, i) => {
                    const dow = i + 1;
                    return (
                      <button
                        key={dow}
                        onClick={() => toggleDay(dow)}
                        className={cn(
                          "marshall-display rounded px-3 py-1 text-xs border transition-colors",
                          preferredDays.includes(dow)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:border-primary",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* ── Subscribers tab ── */}
          <TabsContent value="subscribers" className="space-y-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">Подписчики канала</span>
                <Badge variant="secondary">{subscribers.length}</Badge>
              </div>
              {subscribers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных о подписчиках (доступно только при событиях chat_member)</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-auto">
                  {subscribers.map((s) => (
                    <div key={s.chatId} className="flex items-center gap-2 text-sm">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                        {s.firstName?.[0] ?? s.username?.[0] ?? "?"}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate">{[s.firstName, s.lastName].filter(Boolean).join(" ") || s.username || "Аноним"}</div>
                        <div className="text-xs text-muted-foreground">{s.username ? `@${s.username}` : s.chatId} · {fmt(s.joinedAt)}</div>
                      </div>
                      {s.welcomeSentAt && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500 shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── Reactivation tab ── */}
          <TabsContent value="reactivation" className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="font-semibold">Реактивация резерва</span>
                </div>
                {reserveCount && (
                  <div className="flex gap-2 text-sm text-muted-foreground">
                    <span>В резерве: <strong>{reserveCount.total}</strong></span>
                    <span>Для реактивации (&gt;30 дней): <strong>{reserveCount.eligibleForReactivation}</strong></span>
                  </div>
                )}
                <Button
                  size="sm"
                  className="ml-auto gap-1"
                  onClick={() => reactivateNowMutation.mutate()}
                  disabled={reactivateNowMutation.isPending}
                >
                  {reactivateNowMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Запустить сейчас
                </Button>
              </div>

              <p className="text-xs text-muted-foreground mb-3">
                Ежедневно в 11:00 МСК система отправляет до 3 сообщений кандидатам в резерве,
                которые не выходили на связь более 30 дней.
              </p>

              {reactivations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет попыток реактивации</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-auto">
                  {reactivations.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-sm border rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground">{fmt(r.attemptAt)} · {r.channel}</div>
                        <div className="truncate">{r.template}</div>
                      </div>
                      <span className={cn(
                        "marshall-display inline-flex rounded-full px-2 py-0.5 text-[10px] shrink-0",
                        r.status === "replied" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
                        r.status === "sent" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                        "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
                      )}>
                        {r.status === "sent" ? "Отправлено" : r.status === "replied" ? "Ответил" : "Нет ответа"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {showConnect && (
        <ConnectModal onClose={() => setShowConnect(false)} onConnected={() => setShowConnect(false)} />
      )}
      {showGenerate && (
        <GeneratePostModal
          rubrics={rubrics}
          onClose={() => setShowGenerate(false)}
          onSave={saveGeneratedPost}
        />
      )}
      {editPost && (
        <EditPostModal
          post={editPost}
          rubrics={rubrics}
          onClose={() => setEditPost(null)}
          onSaved={() => setEditPost(null)}
        />
      )}
    </Layout>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────
function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
