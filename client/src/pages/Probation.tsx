// Probation tracking page — Iter5
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UserCheck, Calendar, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Checkpoint {
  id: string;
  dayNumber: number;
  status: string;
  checkType: string;
  dueAt: string;
  completedAt?: string | null;
}

interface ProbationTrackEnriched {
  id: string;
  candidateId: string;
  startedAt: string;
  endsAt: string;
  status: string;
  managerId?: string | null;
  score?: number | null;
  daysSince: number;
  avgRating?: number | null;
  checkpoints: Checkpoint[];
  candidate?: {
    fullName: string;
    city: string;
    stage: string;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  passed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  terminated_early: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  passed: "Пройден",
  failed: "Не пройден",
  terminated_early: "Прерван",
};

const CP_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  done: "bg-green-100 text-green-800",
  skipped: "bg-gray-100 text-gray-500",
  overdue: "bg-red-100 text-red-800",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

function TrackRow({ track }: { track: ProbationTrackEnriched }) {
  const [expanded, setExpanded] = useState(false);
  const progressPct = Math.min(100, Math.round((track.daysSince / 90) * 100));

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm truncate">
              {track.candidate?.fullName ?? track.candidateId}
            </span>
            <Badge className={cn("text-xs shrink-0", STATUS_COLORS[track.status])}>
              {STATUS_LABELS[track.status] ?? track.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {track.candidate?.city} · Начало: {formatDate(track.startedAt)}
          </div>
        </div>

        <div className="w-32 hidden sm:block">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>День {track.daysSince}</span>
            <span>90</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        {track.avgRating != null && (
          <div className="text-center hidden md:block">
            <div className={cn(
              "text-xl font-bold",
              track.avgRating >= 4 ? "text-green-500" :
              track.avgRating >= 3 ? "text-yellow-500" : "text-red-500"
            )}>
              {track.avgRating.toFixed(1)}
            </div>
            <div className="text-xs text-muted-foreground">Ср. рейтинг</div>
          </div>
        )}

        <Button variant="ghost" size="icon" className="shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {expanded && (
        <div className="border-t p-4 bg-muted/20">
          <h4 className="text-sm font-medium mb-3">Чек-поинты</h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[7, 14, 30, 60, 90].map((day) => {
              const cp = track.checkpoints.find((c) => c.dayNumber === day);
              return (
                <div key={day} className="rounded-lg border p-2 text-center">
                  <div className="text-lg font-bold text-muted-foreground">+{day}</div>
                  {cp ? (
                    <Badge className={cn("text-xs mt-1", CP_STATUS_COLORS[cp.status] ?? "")}>
                      {cp.status}
                    </Badge>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-1">Ожидается</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Завершится:</span>{" "}
              <span>{formatDate(track.endsAt)}</span>
            </div>
            {track.score != null && (
              <div>
                <span className="text-muted-foreground">Итоговый балл:</span>{" "}
                <span className="font-medium">{track.score}/100</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Probation() {
  const { data: tracks = [], isLoading } = useQuery<ProbationTrackEnriched[]>({
    queryKey: ["/api/probation/active"],
  });

  return (
    <Layout title="Испытательный срок">
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="h-5 w-5 text-blue-500" />
              <span className="text-2xl font-bold">{tracks.length}</span>
            </div>
            <div className="text-sm text-muted-foreground">Активных треков</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="h-5 w-5 text-yellow-500" />
              <span className="text-2xl font-bold">
                {tracks.filter((t) => t.daysSince >= 60).length}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">Более 60 дней</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <span className="text-2xl font-bold">
                {tracks.filter((t) => t.avgRating != null && t.avgRating >= 4).length}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">Отличный рейтинг (≥4)</div>
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : tracks.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground gap-2">
            <UserCheck className="h-12 w-12" />
            <p className="text-lg font-medium">Нет активных испытательных сроков</p>
            <p className="text-sm">Они появятся автоматически при переводе кандидата в статус «Официально трудоустроен»</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tracks
              .slice()
              .sort((a, b) => b.daysSince - a.daysSince)
              .map((t) => <TrackRow key={t.id} track={t} />)}
          </div>
        )}
      </div>
    </Layout>
  );
}
