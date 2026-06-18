import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Users, UserPlus, CheckCircle2, Briefcase, MessageSquare, PhoneCall, StickyNote, History, CalendarPlus, FileText, TrendingUp, Star, RefreshCw, ExternalLink } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { STAGES, SOURCES } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { Activity } from "@shared/schema";
import { BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, Cell } from "recharts";
import { apiRequest } from "@/lib/queryClient";

interface Stats {
  totalCandidates: number;
  byStage: Record<string, number>;
  bySource: Record<string, number>;
  hiredThisMonth: number;
  officialThisMonth: number;
  newThisWeek: number;
  inWork: number;
  activeVacancies: number;
}

interface UtmFunnelEntry {
  source: string;
  total: number;
  in_work: number;
  official: number;
  probation_passed: number;
}

interface CompanyRating {
  source: string;
  url: string;
  companyName: string;
  overallRating: number | null;
  totalReviews: number | null;
  recommendPercent: number | null;
  subcategoryRatings: {
    salary?: number;
    management?: number;
    development?: number;
    conditions?: number;
    team?: number;
  };
  fetchedAt: string | null;
}

const ACT_ICONS: Record<string, React.ElementType> = {
  stage_change: History, note: StickyNote, call: PhoneCall,
  message: MessageSquare, document_uploaded: FileText, interview_scheduled: CalendarPlus,
};

const UTM_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#e0e7ff"];

const SUBCATEGORY_LABELS: Record<string, string> = {
  salary: "Зарплата",
  management: "Руководство",
  development: "Развитие",
  conditions: "Условия",
  team: "Команда",
};

function Kpi({ icon: Icon, label, value, tint }: { icon: React.ElementType; label: string; value: number; tint: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="marshall-display text-[11px] text-muted-foreground">{label}</div>
          <div className="font-display mt-1.5 text-2xl leading-none" data-testid={`kpi-${label}`}>{value}</div>
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", tint)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function StarRating({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => {
        const fill = Math.min(Math.max(value - i, 0), 1);
        return (
          <div key={i} className="relative h-4 w-4">
            <Star className="absolute h-4 w-4 text-muted-foreground/30" strokeWidth={1.5} />
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="h-4 w-4 text-amber-400 fill-amber-400" strokeWidth={1.5} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DreamJobWidget() {
  const qc = useQueryClient();
  const { data: rating, isLoading } = useQuery<CompanyRating>({
    queryKey: ["/api/company-rating"],
    refetchOnWindowFocus: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/company-rating/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/company-rating"] }),
  });

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;

  const r = rating!;
  const overall = r?.overallRating ?? 4.80;
  const reviews = r?.totalReviews ?? 29;
  const recommend = r?.recommendPercent ?? 96.6;
  const sub = r?.subcategoryRatings ?? { salary: 4.86, management: 4.86, development: 4.69 };
  const fetchedAt = r?.fetchedAt ? new Date(r.fetchedAt) : null;
  const daysAgo = fetchedAt
    ? Math.floor((Date.now() - fetchedAt.getTime()) / 86400000)
    : null;

  const subEntries = Object.entries(sub).filter(([, v]) => v != null) as [string, number][];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Рейтинг на Dream Job</h2>
          <div className="mt-3 flex items-end gap-3">
            <span className="font-display text-4xl leading-none">{overall.toFixed(2)}</span>
            <div className="mb-1 space-y-1">
              <StarRating value={overall} />
              <div className="text-xs text-muted-foreground">
                {reviews} отзыв{reviews === 1 ? "" : reviews < 5 ? "а" : "ов"} · {recommend}% рекомендуют
              </div>
            </div>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          title="Обновить рейтинг"
        >
          <RefreshCw className={cn("h-4 w-4", refreshMutation.isPending && "animate-spin")} />
        </Button>
      </div>

      {subEntries.length > 0 && (
        <div className="mt-4 space-y-2">
          {subEntries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-xs text-muted-foreground">
                {SUBCATEGORY_LABELS[key] ?? key}
              </div>
              <div className="flex-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all"
                    style={{ width: `${(val / 5) * 100}%` }}
                  />
                </div>
              </div>
              <span className="w-8 text-right text-xs font-medium">{val.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {daysAgo !== null
            ? daysAgo === 0 ? "Обновлено сегодня" : `Обновлено ${daysAgo} дн. назад`
            : "Данные ещё не загружены"}
        </span>
        <a
          href="https://dreamjob.ru/employers/307567"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Открыть на Dream Job <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </Card>
  );
}

function UtmFunnelWidget() {
  const { data, isLoading } = useQuery<UtmFunnelEntry[]>({
    queryKey: ["/api/utm/funnel"],
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (!data || data.length === 0) return null;

  const chartData = data
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((d) => ({
      ...d,
      name: d.source,
      conversion: d.total > 0 ? Math.round((d.official / d.total) * 100) : 0,
    }));

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm">UTM-аналитика: источники → оформление</h2>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 20, left: 0 }} barSize={18}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            angle={-30}
            textAnchor="end"
            interval={0}
          />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <ReTooltip
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                total: "Всего",
                in_work: "В работе",
                official: "Оформлено",
                probation_passed: "Прош. испыт.",
              };
              return [value, labels[name] ?? name];
            }}
            contentStyle={{ fontSize: 12 }}
          />
          <Bar dataKey="total" name="total" radius={[3, 3, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={UTM_COLORS[i % UTM_COLORS.length]} fillOpacity={0.5} />
            ))}
          </Bar>
          <Bar dataKey="official" name="official" radius={[3, 3, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={UTM_COLORS[i % UTM_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-indigo-400 opacity-50" />
          Всего кандидатов
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-indigo-400" />
          Оформлено
        </span>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<Stats>({ queryKey: ["/api/dashboard/stats"] });

  if (isLoading || !stats) {
    return <Layout title="Дашборд"><div className="grid grid-cols-2 gap-4 p-8 lg:grid-cols-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></Layout>;
  }

  const maxStage = Math.max(...STAGES.map((s) => stats.byStage[s.key] ?? 0), 1);
  const totalSource = Object.values(stats.bySource).reduce((a, b) => a + b, 0) || 1;

  return (
    <Layout title="Дашборд">
      <div className="space-y-5 p-5 md:p-8">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi icon={Users} label="Всего кандидатов" value={stats.totalCandidates} tint="bg-secondary/40 text-primary" />
          <Kpi icon={UserPlus} label="Новых за неделю" value={stats.newThisWeek} tint="bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300" />
          <Kpi icon={TrendingUp} label="В работе" value={stats.inWork ?? 0} tint="bg-cyan-100 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300" />
          <Kpi icon={CheckCircle2} label="Трудоустроено за 30 дн." value={stats.officialThisMonth ?? stats.hiredThisMonth} tint="bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300" />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Funnel — 14 bars */}
          <Card className="p-5 lg:col-span-2">
            <h2 className="mb-4 text-sm">Воронка (14 этапов)</h2>
            <div className="space-y-2">
              {STAGES.map((s) => {
                const count = stats.byStage[s.key] ?? 0;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="w-36 shrink-0 truncate text-xs text-muted-foreground">{s.label}</div>
                    <div className="flex-1">
                      <div className="h-6 overflow-hidden rounded-lg bg-muted">
                        <div className={cn("flex h-full items-center rounded-lg px-2 text-xs font-medium text-white transition-all", s.color)}
                          style={{ width: `${Math.max((count / maxStage) * 100, count > 0 ? 8 : 0)}%` }}>
                          {count > 0 && count}
                        </div>
                      </div>
                    </div>
                    <div className="w-8 text-right text-sm font-medium" data-testid={`funnel-${s.key}`}>{count}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Sources + Dream Job rating stacked */}
          <div className="flex flex-col gap-5">
            <Card className="p-5">
              <h2 className="mb-4 text-sm">Источники</h2>
              <div className="space-y-3">
                {Object.entries(SOURCES).map(([key, src]) => {
                  const count = stats.bySource[key] ?? 0;
                  const pct = Math.round((count / totalSource) * 100);
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-2">
                          <span className={cn("h-3 w-3 rounded-full", src.className.split(" ")[0])} />
                          {src.label}
                        </span>
                        <span className="font-medium" data-testid={`source-${key}`}>{count} · {pct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", src.className.split(" ")[0])} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Dream Job rating widget */}
            <DreamJobWidget />
          </div>
        </div>

        {/* UTM funnel */}
        <UtmFunnelWidget />

        {/* Recent activity */}
        <RecentActivity />
      </div>
    </Layout>
  );
}

function RecentActivity() {
  const { data: recent } = useQuery<Activity[]>({ queryKey: ["/api/dashboard/recent"] });
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm">Последние действия</h2>
      <div className="space-y-3" data-testid="recent-activities">
        {(recent ?? []).length === 0 && <div className="text-sm text-muted-foreground">Нет недавних действий</div>}
        {(recent ?? []).map((a) => {
          const Icon = ACT_ICONS[a.type] ?? History;
          return (
            <Link key={a.id} href={`/candidates/${a.candidateId}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover-elevate" data-testid={`activity-${a.id}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/40 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{a.description}</div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">{fmtRel(a.createdAt)}</div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function fmtRel(iso: string) {
  try { return format(new Date(iso), "d MMM, HH:mm", { locale: ru }); } catch { return ""; }
}
