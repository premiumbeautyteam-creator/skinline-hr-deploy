import { useEffect, useState } from "react";
import { SiTelegram } from "react-icons/si";
import { ShoppingBag, Link2, CheckCircle2, AlertTriangle, RefreshCw, Loader2, Brain, CheckCheck, XCircle } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { IntegrationPublic, AppSetting } from "@shared/schema";

// Format an ISO timestamp into a short Russian date-time. Returns "—" when null.
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    connected: { label: "Подключено", className: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
    disconnected: { label: "Не подключено", className: "bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300" },
    refreshing: { label: "Обновление токена", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
    error: { label: "Ошибка", className: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  };
  const s = map[status] ?? map.disconnected;
  return (
    <span className={cn("marshall-display inline-flex rounded-full px-2 py-0.5 text-[10px]", s.className)} data-testid="status-hh">
      {s.label}
    </span>
  );
}

// --- Static stub cards for sources not yet implemented (Avito, Telegram) ---
const STUBS = [
  {
    key: "avito",
    name: "Avito API",
    icon: ShoppingBag,
    iconColor: "text-[#FF6B35]",
    badge: "Скоро",
    description: "Автоматически подтягивает новые отклики на ваши вакансии с Avito и создаёт карточки кандидатов в воронке.",
  },
  {
    key: "telegram",
    name: "Telegram Bot",
    icon: SiTelegram,
    iconColor: "text-[#0088CC]",
    badge: "В разработке",
    description: "Позволяет отправлять кандидатам сообщения и приглашения на собеседование прямо из CRM через Telegram-бота.",
  },
];

export default function Settings() {
  const { toast } = useToast();
  const [envError, setEnvError] = useState<string | null>(null);

  const { data: hh, isLoading } = useQuery<IntegrationPublic>({
    queryKey: ["/api/integrations", "hh"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/integrations/hh");
      return res.json();
    },
  });

  // On mount, read the OAuth redirect result from the URL hash query.
  useEffect(() => {
    const hash = window.location.hash; // e.g. "#/settings?connected=hh"
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return;
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    if (params.get("connected") === "hh") {
      toast({ title: "hh.ru подключён", description: "Отклики с активных вакансий теперь синхронизируются автоматически." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", "hh"] });
    } else if (params.get("error") === "hh") {
      toast({ title: "Не удалось подключить hh.ru", description: "Попробуйте переподключить аккаунт.", variant: "destructive" });
    }
    // Clean the query string from the hash so the toast does not repeat on refresh.
    if (params.has("connected") || params.has("error")) {
      window.location.hash = hash.slice(0, qIndex);
    }
  }, [toast]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/hh/sync");
      return res.json();
    },
    onSuccess: (data: { ingestedCount?: number; createdCount?: number }) => {
      toast({
        title: "Синхронизация завершена",
        description: `Получено откликов: ${data.ingestedCount ?? 0}, новых кандидатов: ${data.createdCount ?? 0}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", "hh"] });
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
    },
    onError: () => {
      toast({ title: "Ошибка синхронизации", description: "Проверьте подключение к hh.ru.", variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/hh/disconnect");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "hh.ru отключён" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", "hh"] });
    },
  });

  // Initiate the OAuth flow. Checks env first so we can show a Russian error
  // instead of a confusing redirect when the server is not configured.
  async function connectHh() {
    setEnvError(null);
    try {
      const res = await fetch("/api/integrations/hh/connect", { redirect: "manual" });
      // A 400 means the server is missing env vars — show the Russian message.
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        setEnvError(body?.message ?? "Не настроены переменные окружения для hh.ru. Проверьте .env.");
        return;
      }
      // Otherwise navigate to the connect endpoint which 302-redirects to hh.ru.
      window.location.href = "/api/integrations/hh/connect";
    } catch {
      // Network/opaque-redirect — just navigate and let the server redirect.
      window.location.href = "/api/integrations/hh/connect";
    }
  }

  const status = hh?.status ?? "disconnected";
  const actions = (
    <span className="marshall-display inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[10px] text-muted-foreground">
      Интеграции
    </span>
  );

  return (
    <Layout title="Настройки" actions={actions}>
      <div className="mx-auto max-w-3xl space-y-5 p-5 md:p-8">
        <div>
          <h2 className="text-sm">Интеграции</h2>
          <p className="text-sm text-muted-foreground">Подключите источники кандидатов и каналы связи.</p>
        </div>

        {/* ---- hh.ru: real OAuth integration ---- */}
        <Card className="p-5" data-testid="integration-hh">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
              <Link2 className="h-6 w-6 text-[#D6001C]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">hh.ru API</h3>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <StatusBadge status={status} />
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                После подключения отклики с активных вакансий будут автоматически попадать в воронку.
                Переписку с кандидатом можно вести прямо из карточки.
              </p>

              {/* Error banner from the integration itself */}
              {status === "error" && hh?.lastError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" data-testid="text-hh-error">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{hh.lastError}</span>
                </div>
              )}

              {/* Env-misconfiguration error from /connect */}
              {envError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" data-testid="text-hh-env-error">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{envError}</span>
                </div>
              )}

              {/* Connected: account info + sync/disconnect controls */}
              {status === "connected" && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="font-medium" data-testid="text-hh-account">{hh?.accountName ?? "Аккаунт hh.ru"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground" data-testid="text-hh-lastsync">
                    Последняя синхронизация: {formatDateTime(hh?.lastSyncAt ?? null)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => syncMutation.mutate()}
                      disabled={syncMutation.isPending}
                      data-testid="button-hh-sync"
                    >
                      {syncMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Синхронизировать сейчас
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => disconnectMutation.mutate()}
                      disabled={disconnectMutation.isPending}
                      data-testid="button-hh-disconnect"
                    >
                      Отключить
                    </Button>
                  </div>
                </div>
              )}

              {/* Disconnected / refreshing: connect (or reconnect) button */}
              {(status === "disconnected" || status === "refreshing" || status === "error") && (
                <div className="mt-4">
                  <Button onClick={connectHh} data-testid="button-hh-connect">
                    {status === "error" ? "Переподключить" : "Подключить hh.ru"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* ---- Stub integrations (Avito, Telegram) ---- */}
        {STUBS.map((int) => {
          const Icon = int.icon;
          return (
            <Card key={int.key} className="p-5 opacity-80" data-testid={`integration-${int.key}`}>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Icon className={cn("h-6 w-6", int.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{int.name}</h3>
                    <span className="marshall-display inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-500/20 dark:text-gray-300">
                      {int.badge}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{int.description}</p>
                  <div className="mt-4">
                    <Button variant="outline" disabled data-testid={`button-connect-${int.key}`}>
                      Подключить
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}

        {/* ---- AI Settings (Iter2) ---- */}
        <AiSettingsSection />

        <p className="pt-2 text-center text-xs text-muted-foreground" data-testid="text-prototype-note">
          Интеграция hh.ru работает через официальный OAuth API. Webhook'и и фоновая синхронизация настраиваются на VPS Timeweb (см. INTEGRATIONS.md).
        </p>
      </div>
    </Layout>
  );


function AiSettingsSection() {
  const { toast } = useToast();

  const { data: settings, refetch: refetchSettings } = useQuery<AppSetting[]>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings");
      return res.json();
    },
  });

  function getSettingValue(key: string): string {
    return settings?.find((s) => s.key === key)?.value ?? "false";
  }

  const toggleMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await apiRequest("PUT", `/api/settings/${key}`, { value });
      return res.json();
    },
    onSuccess: () => {
      refetchSettings();
      toast({ title: "Настройка сохранена" });
    },
    onError: () => toast({ title: "Ошибка сохранения", variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/test");
      return res.json() as Promise<{ ok: boolean; error?: string }>;
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast({ title: "OpenRouter работает", description: "Подключение к AI успешно." });
      } else {
        toast({ title: "OpenRouter недоступен", description: data.error ?? "Неизвестная ошибка", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Ошибка проверки AI", variant: "destructive" }),
  });

  const aiChatEnabled = getSettingValue("ai_chat_enabled") === "true";
  const aiScreeningEnabled = getSettingValue("ai_screening_enabled") === "true";

  return (
    <div>
      <h2 className="text-sm">AI-настройки</h2>
      <p className="text-sm text-muted-foreground">Управление AI-функциями (Iter2).</p>
      <Card className="mt-3 p-5" data-testid="card-ai-settings">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Brain className="h-6 w-6 text-purple-500" />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <h3 className="font-semibold">OpenRouter AI</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Все AI-функции работают через OpenRouter. Убедитесь, что переменная окружения{" "}
                <code className="rounded bg-muted px-1 text-xs">CUSTOM_CRED_OPENROUTER_AI_TOKEN</code> задана на сервере.
              </p>
            </div>

            {/* Toggle: AI Chat */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium">AI-ответы в Telegram-боте</div>
                <div className="text-xs text-muted-foreground">Алина (AI) автоматически отвечает кандидатам</div>
              </div>
              <Switch
                checked={aiChatEnabled}
                onCheckedChange={(checked) => toggleMutation.mutate({ key: "ai_chat_enabled", value: String(checked) })}
                disabled={toggleMutation.isPending}
                data-testid="toggle-ai-chat"
              />
            </div>

            {/* Toggle: AI Screening */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium">AI-скрининг при поступлении анкеты</div>
                <div className="text-xs text-muted-foreground">Автоматически анализировать кандидата через 30 сек после заполнения анкеты</div>
              </div>
              <Switch
                checked={aiScreeningEnabled}
                onCheckedChange={(checked) => toggleMutation.mutate({ key: "ai_screening_enabled", value: String(checked) })}
                disabled={toggleMutation.isPending}
                data-testid="toggle-ai-screening"
              />
            </div>

            {/* Test connection */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                data-testid="button-test-openrouter"
              >
                {testMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Brain className="mr-2 h-4 w-4" />
                )}
                Проверить OpenRouter
              </Button>
              {testMutation.isSuccess && (
                testMutation.data?.ok ? (
                  <span className="flex items-center gap-1 text-sm text-green-600" data-testid="ai-test-ok">
                    <CheckCheck className="h-4 w-4" /> Подключено
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-red-600" data-testid="ai-test-fail">
                    <XCircle className="h-4 w-4" /> Ошибка
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
}