import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { Search, Plus, Phone, MapPin } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw } from "lucide-react";
import { CandidateAvatar, SourceBadge } from "@/components/shared";
import { CandidateFormDialog } from "@/components/CandidateFormDialog";
import { STAGES, SOURCES, parseTags } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ShoppingBag } from "lucide-react";
import type { Candidate, Vacancy } from "@shared/schema";

function CandidateCard({ candidate, vacancyTitle, onClick, dragging }: {
  candidate: Candidate; vacancyTitle?: string; onClick?: () => void; dragging?: boolean;
}) {
  const tags = parseTags(candidate.tags);
  return (
    <div
      onClick={onClick}
      data-testid={`card-candidate-${candidate.id}`}
      className={cn(
        "cursor-pointer rounded-xl border border-card-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        dragging && "rotate-2 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2.5">
        <CandidateAvatar name={candidate.fullName} url={candidate.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate">
            <span className="truncate text-sm font-semibold leading-tight">{candidate.fullName}</span>
            {(candidate as Candidate & { aiVerdict?: string }).aiVerdict && (
              <span
                title={(candidate as Candidate & { aiVerdict?: string }).aiVerdict ?? ""}
                className={`shrink-0 h-2 w-2 rounded-full ${
                  (candidate as Candidate & { aiVerdict?: string }).aiVerdict === "take" ? "bg-green-500" :
                  (candidate as Candidate & { aiVerdict?: string }).aiVerdict === "reserve" ? "bg-amber-400" :
                  (candidate as Candidate & { aiVerdict?: string }).aiVerdict === "reject" ? "bg-red-500" :
                  "bg-blue-400"
                }`}
                data-testid={`ai-verdict-dot-${candidate.id}`}
              />
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{vacancyTitle ?? "—"}</div>
        </div>
        <SourceBadge source={candidate.source} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{candidate.city}</span>
        {candidate.experience && <span>{candidate.experience}</span>}
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableCard({ candidate, vacancyTitle, onClick }: { candidate: Candidate; vacancyTitle?: string; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: candidate.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-40")}>
      <CandidateCard candidate={candidate} vacancyTitle={vacancyTitle} onClick={onClick} />
    </div>
  );
}

function Column({ stageKey, label, color, candidates, vacancyMap, onCardClick }: {
  stageKey: string; label: string; color: string; candidates: Candidate[];
  vacancyMap: Record<string, string>; onCardClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey });
  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("h-2 w-2 rounded-full", color)} />
        <span className="marshall-display text-xs">{label}</span>
        <span className="marshall-display rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" data-testid={`count-${stageKey}`}>
          {candidates.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-2 rounded-xl p-2 transition-colors min-h-32",
          isOver ? "bg-primary/10 ring-2 ring-primary/30" : "bg-muted/40",
        )}
        data-testid={`column-${stageKey}`}
      >
        {candidates.map((c) => (
          <DraggableCard key={c.id} candidate={c} vacancyTitle={vacancyMap[c.vacancyId]} onClick={() => onCardClick(c.id)} />
        ))}
        {candidates.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">Пусто</div>
        )}
      </div>
    </div>
  );
}

export default function Candidates() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [vacancyFilter, setVacancyFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: candidates, isLoading } = useQuery<Candidate[]>({ queryKey: ["/api/candidates"] });
  const { data: vacancies } = useQuery<Vacancy[]>({ queryKey: ["/api/vacancies"] });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const vacancyMap = useMemo(
    () => Object.fromEntries((vacancies ?? []).map((v) => [v.id, v.title])),
    [vacancies],
  );

  const filtered = useMemo(() => {
    return (candidates ?? []).filter((c) => {
      const q = search.toLowerCase();
      const matchSearch = !q || c.fullName.toLowerCase().includes(q) || c.phone.includes(q);
      const matchVac = vacancyFilter === "all" || c.vacancyId === vacancyFilter;
      const matchSrc = sourceFilter === "all" || c.source === sourceFilter;
      return matchSearch && matchVac && matchSrc;
    });
  }, [candidates, search, vacancyFilter, sourceFilter]);

  const byStage = useMemo(() => {
    const m: Record<string, Candidate[]> = {};
    STAGES.forEach((s) => (m[s.key] = []));
    filtered.forEach((c) => m[c.stage]?.push(c));
    return m;
  }, [filtered]);

  const activeCandidate = candidates?.find((c) => c.id === activeId);

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = e.active.id as string;
    const newStage = e.over?.id as string | undefined;
    if (!newStage) return;
    const cand = candidates?.find((c) => c.id === id);
    if (!cand || cand.stage === newStage) return;

    // optimistic update
    queryClient.setQueryData<Candidate[]>(["/api/candidates"], (old) =>
      (old ?? []).map((c) => (c.id === id ? { ...c, stage: newStage } : c)));
    try {
      await apiRequest("PATCH", `/api/candidates/${id}/stage`, { stage: newStage });
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      toast({ title: "Ошибка перемещения", variant: "destructive" });
    }
  }

  const [syncing, setSyncing] = useState(false);

  // Trigger a manual hh.ru pull of active negotiations.
  async function syncHh() {
    setSyncing(true);
    try {
      const res = await apiRequest("POST", "/api/integrations/hh/sync", {});
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Синхронизация с hh.ru",
        description: `Получено откликов: ${data.ingestedCount ?? 0}, новых кандидатов: ${data.createdCount ?? 0}.`,
      });
    } catch (err: any) {
      // Surface the server's Russian message (e.g. "hh.ru не подключён").
      const msg = typeof err?.message === "string" ? err.message.replace(/^\d+:\s*/, "") : "";
      toast({
        title: "Ошибка синхронизации",
        description: msg || "Проверьте подключение hh.ru в настройках.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  const actions = (
    <TooltipProvider>
      <Button variant="outline" size="sm" onClick={syncHh} disabled={syncing} data-testid="button-sync-hh" className="gap-1.5">
        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-[#D6001C]" />}
        Синхронизировать hh.ru
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button variant="outline" size="sm" disabled data-testid="button-sync-avito" className="gap-1.5">
              <ShoppingBag className="h-3.5 w-3.5 text-[#FF6B35]" /> Синхронизировать Avito
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>В разработке</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <Layout title="Кандидаты" actions={actions}>
      <div className="flex h-full flex-col">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 md:px-8">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="input-search"
              placeholder="Поиск по имени или телефону"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={vacancyFilter} onValueChange={setVacancyFilter}>
            <SelectTrigger className="w-48" data-testid="filter-vacancy"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все вакансии</SelectItem>
              {(vacancies ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40" data-testid="filter-source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все источники</SelectItem>
              {Object.entries(SOURCES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button className="ml-auto gap-1.5" onClick={() => setDialogOpen(true)} data-testid="button-add-candidate">
            <Plus className="h-4 w-4" /> Добавить кандидата
          </Button>
        </div>

        {/* Board — horizontal scroll for 14 columns */}
        <div className="flex-1 overflow-x-auto p-5 md:p-8">
          {isLoading ? (
            <div className="flex gap-4">
              {STAGES.map((s) => <Skeleton key={s.key} className="h-96 w-[280px] rounded-xl" />)}
            </div>
          ) : (
            <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)} onDragEnd={handleDragEnd}>
              <div className="flex gap-4 pb-4" style={{ minWidth: `${STAGES.length * 296}px` }}>
                {STAGES.map((s) => (
                  <Column
                    key={s.key}
                    stageKey={s.key}
                    label={s.label}
                    color={s.color}
                    candidates={byStage[s.key] ?? []}
                    vacancyMap={vacancyMap}
                    onCardClick={(id) => navigate(`/candidates/${id}`)}
                  />
                ))}
              </div>
              <DragOverlay>
                {activeCandidate ? (
                  <div className="w-[280px]">
                    <CandidateCard candidate={activeCandidate} vacancyTitle={vacancyMap[activeCandidate.vacancyId]} dragging />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
      <CandidateFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Layout>
  );
}
