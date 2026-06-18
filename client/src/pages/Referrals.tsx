// Referrals page — Iter5
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, TrendingUp, Award, Link2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ReferralEnriched {
  id: string;
  codeId: string;
  candidateId: string;
  status: string;
  bonusAmount?: number | null;
  paidAt?: string | null;
  createdAt: string;
  code?: { code: string; bonusAmount: number } | null;
  candidate?: { fullName: string; city: string; stage: string } | null;
}

interface ReferralStats {
  codeId: string;
  code: string;
  total: number;
  hired: number;
  passed: number;
}

const STATUS_LABELS: Record<string, string> = {
  registered: "Зарегистрирован",
  hired: "Нанят",
  passed_probation: "Прошёл испытательный",
  paid: "Бонус выплачен",
};

const STATUS_COLORS: Record<string, string> = {
  registered: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  hired: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  passed_probation: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  paid: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

export default function Referrals() {
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: referrals = [], isLoading } = useQuery<ReferralEnriched[]>({
    queryKey: ["/api/referrals"],
  });

  const { data: stats = [] } = useQuery<ReferralStats[]>({
    queryKey: ["/api/referrals/stats"],
  });

  const filtered = statusFilter === "all"
    ? referrals
    : referrals.filter((r) => r.status === statusFilter);

  const total = referrals.length;
  const hired = referrals.filter((r) => ["hired", "passed_probation", "paid"].includes(r.status)).length;
  const passed = referrals.filter((r) => ["passed_probation", "paid"].includes(r.status)).length;
  const convRate = total > 0 ? Math.round((hired / total) * 100) : 0;

  return (
    <Layout title="Реферальная программа">
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-5 w-5 text-blue-500" />
              <span className="text-2xl font-bold">{total}</span>
            </div>
            <div className="text-sm text-muted-foreground">Всего рефералов</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-5 w-5 text-yellow-500" />
              <span className="text-2xl font-bold">{hired}</span>
            </div>
            <div className="text-sm text-muted-foreground">Нанято</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Award className="h-5 w-5 text-green-500" />
              <span className="text-2xl font-bold">{passed}</span>
            </div>
            <div className="text-sm text-muted-foreground">Прошли испытательный</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-5 w-5 text-purple-500" />
              <span className="text-2xl font-bold">{convRate}%</span>
            </div>
            <div className="text-sm text-muted-foreground">Конверсия</div>
          </div>
        </div>

        {/* Top referrers */}
        {stats.length > 0 && (
          <div>
            <h2 className="text-base font-semibold mb-3">Топ реферрёров</h2>
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Код</TableHead>
                    <TableHead className="text-right">Всего</TableHead>
                    <TableHead className="text-right">Нанято</TableHead>
                    <TableHead className="text-right">Испытат. прошли</TableHead>
                    <TableHead className="text-right">Конверсия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.slice(0, 10).map((s) => (
                    <TableRow key={s.codeId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{s.code}</code>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{s.total}</TableCell>
                      <TableCell className="text-right">{s.hired}</TableCell>
                      <TableCell className="text-right">{s.passed}</TableCell>
                      <TableCell className="text-right">
                        {s.total > 0 ? Math.round((s.hired / s.total) * 100) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* All referrals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Все рефералы</h2>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
              <Users className="h-10 w-10" />
              <p>Нет рефералов</p>
            </div>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Кандидат</TableHead>
                    <TableHead>Код</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Бонус</TableHead>
                    <TableHead>Дата</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((ref) => (
                    <TableRow key={ref.id}>
                      <TableCell className="font-medium text-sm">
                        {ref.candidate?.fullName ?? ref.candidateId}
                        {ref.candidate?.city && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            · {ref.candidate.city}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                          {ref.code?.code ?? ref.codeId}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("text-xs", STATUS_COLORS[ref.status] ?? "")}>
                          {STATUS_LABELS[ref.status] ?? ref.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {ref.bonusAmount != null
                          ? `${ref.bonusAmount.toLocaleString("ru-RU")} ₽`
                          : ref.code?.bonusAmount
                          ? `${ref.code.bonusAmount.toLocaleString("ru-RU")} ₽`
                          : "—"}
                        {ref.paidAt && (
                          <span className="text-xs text-muted-foreground ml-1">
                            (выплачено {formatDate(ref.paidAt)})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(ref.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
