// Alerts dashboard — Iter5
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Clock, Loader2, RefreshCw } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Alert {
  id: string;
  type: string;
  severity: "low" | "med" | "high" | "critical";
  title: string;
  description: string;
  candidateId?: string | null;
  userId?: string | null;
  relatedEntity?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  med: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "Низкий",
  med: "Средний",
  high: "Высокий",
  critical: "Критический",
};

const TYPE_LABELS: Record<string, string> = {
  overdue_timer: "Просроченный таймер",
  low_sentiment: "Низкий sentiment",
  funnel_anomaly: "Аномалия воронки",
  no_response: "Нет ответа",
  probation_alert: "Испытательный срок",
  probation_no_final_decision: "Нет решения по испытательному",
  referral_payout: "Выплата реферрала",
  channel_silent: "Канал не публикует",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function Alerts() {
  const { toast } = useToast();
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterResolved, setFilterResolved] = useState("false");

  const params = new URLSearchParams();
  if (filterSeverity !== "all") params.set("severity", filterSeverity);
  if (filterType !== "all") params.set("type", filterType);
  if (filterResolved !== "all") params.set("resolved", filterResolved);

  const { data: alertsList = [], isLoading, refetch } = useQuery<Alert[]>({
    queryKey: [`/api/alerts?${params.toString()}`],
  });

  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/alerts/${id}/resolve`, { resolvedBy: "hr_user" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Алёрт отмечен как решённый" });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const unresolved = alertsList.filter((a) => !a.resolvedAt).length;
  const critical = alertsList.filter((a) => a.severity === "critical" && !a.resolvedAt).length;

  return (
    <Layout
      title="Алёрты"
      actions={
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Обновить
        </Button>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-2xl font-bold">{alertsList.length}</div>
            <div className="text-sm text-muted-foreground">Всего алётов</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-2xl font-bold text-orange-500">{unresolved}</div>
            <div className="text-sm text-muted-foreground">Нерешённых</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-2xl font-bold text-red-500">{critical}</div>
            <div className="text-sm text-muted-foreground">Критических</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-2xl font-bold text-green-500">
              {alertsList.filter((a) => a.resolvedAt).length}
            </div>
            <div className="text-sm text-muted-foreground">Решённых</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Серьёзность" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="low">Низкий</SelectItem>
              <SelectItem value="med">Средний</SelectItem>
              <SelectItem value="high">Высокий</SelectItem>
              <SelectItem value="critical">Критический</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Тип" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterResolved} onValueChange={setFilterResolved}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="false">Нерешённые</SelectItem>
              <SelectItem value="true">Решённые</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : alertsList.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground gap-2">
            <CheckCircle className="h-12 w-12" />
            <p className="text-lg font-medium">Нет алётов</p>
          </div>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Серьёзность</TableHead>
                  <TableHead className="w-36">Тип</TableHead>
                  <TableHead>Заголовок</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead className="w-36">Создан</TableHead>
                  <TableHead className="w-24">Статус</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertsList.map((alert) => (
                  <TableRow key={alert.id} className={alert.resolvedAt ? "opacity-50" : ""}>
                    <TableCell>
                      <Badge className={cn("text-xs", SEVERITY_COLORS[alert.severity])}>
                        {SEVERITY_LABELS[alert.severity] ?? alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {TYPE_LABELS[alert.type] ?? alert.type}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{alert.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {alert.description}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(alert.createdAt)}
                    </TableCell>
                    <TableCell>
                      {alert.resolvedAt ? (
                        <Badge variant="secondary" className="text-xs">Решён</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                          <Clock className="mr-1 h-3 w-3" />
                          Открыт
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!alert.resolvedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resolveMutation.mutate(alert.id)}
                          disabled={resolveMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Layout>
  );
}
