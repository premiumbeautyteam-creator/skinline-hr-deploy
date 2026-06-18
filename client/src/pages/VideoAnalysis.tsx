// Iter6: Video Analysis Page
// Route: /candidates/:id/video/:videoId

import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import {
  ArrowLeft, Video, AlertTriangle, Brain, FileText, Clock, CheckCircle2,
  RefreshCw, Loader2, Save, ChevronRight,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface InterviewVideo {
  id: string;
  candidateId: string;
  source: string;
  sourceUrl: string;
  status: string;
  durationSec: number | null;
  aiSummary: string | null;
  errorMsg: string | null;
  transcriptJson: string | null;
  sentimentTimelineJson: string | null;
  redFlagsJson: string | null;
  keyTimestampsJson: string | null;
  extractedFactsJson: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ScorecardResponse {
  id: string;
  candidateId: string;
  templateId: string;
  stage: string;
  scoresJson: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  aiDrafted: number;
  aiVerdict: string | null;
  recommendation: string | null;
  sourceVideoId: string | null;
}

interface ScorecardTemplate {
  id: string;
  role: string;
  name: string;
  criteriaJson: string;
}

interface Candidate {
  id: string;
  fullName: string;
  stage: string;
}

interface RedFlag {
  type: string;
  severity: string;
  quote: string;
  timestamp: string;
  description: string;
}

interface Fact {
  key: string;
  value: string;
  source?: string;
}

interface SentimentPoint {
  timestamp: number;
  sentiment: number;
  label: string;
}

interface ScoreEntry {
  criterionId: string;
  score: number;
  quote: string;
  timestamp: string;
}

interface CriterionDef {
  id: string;
  name: string;
  description: string;
  anchor1: string;
  anchor3: string;
  anchor5: string;
  weight: number;
}

export default function VideoAnalysis() {
  const [, params] = useRoute("/candidates/:id/video/:videoId");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const candidateId = params?.id ?? "";
  const videoId = params?.videoId ?? "";

  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [editedScores, setEditedScores] = useState<Record<string, number>>({});
  const [savingScorecard, setSavingScorecard] = useState(false);

  const { data: video, isLoading: videoLoading } = useQuery<InterviewVideo>({
    queryKey: ["/api/interviews", videoId],
    queryFn: () => fetch(`/api/interviews/${videoId}`).then((r) => r.json()),
    refetchInterval: (data) => {
      if (!data || ["pending", "downloading", "transcribing", "analyzing"].includes((data as InterviewVideo).status)) {
        return 5000;
      }
      return false;
    },
  });

  const { data: candidate } = useQuery<Candidate>({
    queryKey: ["/api/candidates", candidateId],
    queryFn: () => fetch(`/api/candidates/${candidateId}`).then((r) => r.json()),
  });

  const { data: scorecardResponses } = useQuery<ScorecardResponse[]>({
    queryKey: ["/api/scorecards/responses", candidateId],
    queryFn: () => fetch(`/api/scorecards/responses?candidateId=${candidateId}`).then((r) => r.json()),
  });

  const videoResponse = scorecardResponses?.find((r) => r.sourceVideoId === videoId);

  const { data: templates } = useQuery<ScorecardTemplate[]>({
    queryKey: ["/api/scorecards/templates"],
    queryFn: () => fetch("/api/scorecards/templates").then((r) => r.json()),
  });

  const template = videoResponse
    ? templates?.find((t) => t.id === videoResponse.templateId)
    : null;

  const parsedScores: ScoreEntry[] = videoResponse
    ? (() => { try { return JSON.parse(videoResponse.scoresJson); } catch { return []; } })()
    : [];
  const criteriaList: CriterionDef[] = template
    ? (() => { try { return JSON.parse(template.criteriaJson); } catch { return []; } })()
    : [];

  const redFlags: RedFlag[] = video?.redFlagsJson
    ? (() => { try { return JSON.parse(video.redFlagsJson); } catch { return []; } })()
    : [];

  const facts: Fact[] = video?.extractedFactsJson
    ? (() => { try { return JSON.parse(video.extractedFactsJson); } catch { return []; } })()
    : [];

  const sentimentTimeline: SentimentPoint[] = video?.sentimentTimelineJson
    ? (() => { try { return JSON.parse(video.sentimentTimelineJson); } catch { return []; } })()
    : [];

  const transcript = video?.transcriptJson
    ? (() => { try { const p = JSON.parse(video.transcriptJson); return p.text ?? ""; } catch { return ""; } })()
    : "";

  const filteredTranscript = transcriptSearch
    ? transcript.split("\n").filter((line: string) => line.toLowerCase().includes(transcriptSearch.toLowerCase())).join("\n")
    : transcript;

  const saveScorecard = async () => {
    if (!videoResponse || criteriaList.length === 0) return;
    setSavingScorecard(true);
    try {
      const newScores = criteriaList.map((c) => ({
        criterionId: c.id,
        score: editedScores[c.id] ?? parsedScores.find((s) => s.criterionId === c.id)?.score ?? 3,
        quote: parsedScores.find((s) => s.criterionId === c.id)?.quote ?? "",
        timestamp: parsedScores.find((s) => s.criterionId === c.id)?.timestamp ?? "",
      }));
      const totalScore = newScores.reduce((a, s) => a + s.score, 0);
      const maxScore = criteriaList.length * 5;
      const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

      await apiRequest("PATCH", `/api/scorecards/responses/${videoResponse.id}`, {
        scoresJson: JSON.stringify(newScores),
        totalScore,
        maxScore,
        percentage,
        aiDrafted: 0,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/scorecards/responses", candidateId] });
      toast({ title: "Скоркарта сохранена" });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось сохранить скоркарту", variant: "destructive" });
    } finally {
      setSavingScorecard(false);
    }
  };

  const makeDecision = async (decision: string) => {
    if (!videoResponse) return;
    try {
      await apiRequest("PATCH", `/api/scorecards/responses/${videoResponse.id}`, { recommendation: decision });
      // Also update candidate stage based on decision
      const stageMap: Record<string, string> = {
        pass: "studio_demo",
        reject: "rejected",
        think: "video_interview",
      };
      if (stageMap[decision]) {
        await apiRequest("PATCH", `/api/candidates/${candidateId}`, { stage: stageMap[decision] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/scorecards/responses", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["/api/candidates", candidateId] });
      toast({ title: "Решение принято", description: decision === "pass" ? "Кандидат переведён на следующий этап" : decision === "reject" ? "Кандидат отклонён" : "Отложено" });
    } catch {
      toast({ title: "Ошибка", variant: "destructive" });
    }
  };

  const statusLabel: Record<string, string> = {
    pending: "В очереди",
    downloading: "Скачивается...",
    transcribing: "Транскрибируется...",
    analyzing: "Анализируется...",
    done: "Готово",
    error: "Ошибка",
  };

  const severityColor: Record<string, string> = {
    high: "bg-red-100 text-red-700 border-red-200",
    medium: "bg-orange-100 text-orange-700 border-orange-200",
    low: "bg-yellow-100 text-yellow-700 border-yellow-200",
  };

  const sentimentData = sentimentTimeline.map((p) => ({
    time: `${Math.floor(p.timestamp / 60)}:${String(p.timestamp % 60).padStart(2, "0")}`,
    sentiment: p.sentiment,
    label: p.label,
  }));

  if (videoLoading) {
    return (
      <Layout title="Анализ видео">
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </Layout>
    );
  }

  if (!video) {
    return (
      <Layout title="Анализ видео">
        <div className="p-6 text-muted-foreground">Видео не найдено</div>
      </Layout>
    );
  }

  const isProcessing = ["pending", "downloading", "transcribing", "analyzing"].includes(video.status);

  return (
    <Layout>
      <div className="flex flex-col gap-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/candidates/${candidateId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="text-sm font-medium">
              {candidate?.fullName ?? "Кандидат"} — Видеоинтервью
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(video.createdAt).toLocaleDateString("ru-RU")}
              {video.durationSec && ` · ${Math.round(video.durationSec / 60)} мин`}
            </div>
          </div>
          <Badge className={cn("ml-auto",
            video.status === "done" ? "bg-green-100 text-green-700" :
            video.status === "error" ? "bg-red-100 text-red-700" :
            "bg-blue-100 text-blue-700"
          )}>
            {statusLabel[video.status] ?? video.status}
          </Badge>
        </div>

        {/* Processing state */}
        {isProcessing && (
          <Card className="flex items-center gap-3 p-6">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <div>
              <div className="text-sm font-medium">{statusLabel[video.status]}</div>
              <div className="text-xs text-muted-foreground">Обновляется автоматически каждые 5 секунд</div>
            </div>
          </Card>
        )}

        {/* Error state */}
        {video.status === "error" && (
          <Card className="border-red-200 p-4">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">Ошибка анализа</span>
            </div>
            {video.errorMsg && <div className="mt-2 text-xs text-red-600">{video.errorMsg}</div>}
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={async () => {
                await apiRequest("POST", `/api/interviews/${videoId}/retry`, {});
                queryClient.invalidateQueries({ queryKey: ["/api/interviews", videoId] });
              }}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Повторить анализ
            </Button>
          </Card>
        )}

        {/* Done — full analysis */}
        {video.status === "done" && (
          <>
            {/* Video player */}
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium flex items-center gap-2">
                <Video className="h-4 w-4" /> Запись интервью
              </div>
              <a href={video.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline break-all">
                {video.sourceUrl}
              </a>
              <iframe
                src={video.sourceUrl}
                className="mt-3 w-full rounded-lg"
                style={{ height: "300px" }}
                allow="autoplay"
                title="Zoom Interview"
              />
            </Card>

            {/* Decision */}
            {videoResponse && (
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Решение по кандидату</div>
                    {videoResponse.aiVerdict && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Рекомендация AI: {videoResponse.aiVerdict}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => makeDecision("pass")}
                    >
                      ✅ Пройти
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => makeDecision("think")}
                    >
                      🤔 Думаю
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => makeDecision("reject")}
                    >
                      ❌ Отказ
                    </Button>
                  </div>
                </div>
                {videoResponse.recommendation && (
                  <Badge className="mt-2" variant="outline">
                    Текущее решение: {videoResponse.recommendation === "pass" ? "✅ Пройти" : videoResponse.recommendation === "reject" ? "❌ Отказ" : "🤔 Думаю"}
                  </Badge>
                )}
              </Card>
            )}

            <Tabs defaultValue="summary" className="space-y-3">
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="summary" className="text-xs">AI-резюме</TabsTrigger>
                <TabsTrigger value="scorecard" className="text-xs">Скоркарта</TabsTrigger>
                <TabsTrigger value="transcript" className="text-xs">Транскрипт</TabsTrigger>
                <TabsTrigger value="sentiment" className="text-xs">Сентимент</TabsTrigger>
                <TabsTrigger value="flags" className="text-xs">Флаги</TabsTrigger>
                <TabsTrigger value="facts" className="text-xs">Факты</TabsTrigger>
              </TabsList>

              {/* AI Summary */}
              <TabsContent value="summary">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="h-4 w-4 text-purple-500" />
                    <div className="text-sm font-medium">AI-резюме для менеджера</div>
                  </div>
                  {video.aiSummary ? (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">{video.aiSummary}</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Резюме недоступно</div>
                  )}
                </Card>
              </TabsContent>

              {/* Scorecard */}
              <TabsContent value="scorecard">
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium">Скоркарта</div>
                    {videoResponse && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {videoResponse.totalScore}/{videoResponse.maxScore} ({videoResponse.percentage.toFixed(0)}%)
                        </span>
                        {videoResponse.aiDrafted === 1 && (
                          <Badge variant="outline" className="text-[10px]">AI-черновик</Badge>
                        )}
                        <Button size="sm" onClick={saveScorecard} disabled={savingScorecard}>
                          {savingScorecard ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          <span className="ml-1.5">Сохранить</span>
                        </Button>
                      </div>
                    )}
                  </div>

                  {criteriaList.length === 0 && (
                    <div className="text-sm text-muted-foreground">Скоркарта не заполнена</div>
                  )}

                  <div className="space-y-4">
                    {criteriaList.map((criterion) => {
                      const scoreEntry = parsedScores.find((s) => s.criterionId === criterion.id);
                      const currentScore = editedScores[criterion.id] ?? scoreEntry?.score ?? 0;

                      return (
                        <div key={criterion.id} className="border-b border-border pb-3 last:border-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="text-xs font-medium">{criterion.name}</div>
                              <div className="text-[11px] text-muted-foreground">{criterion.description}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((score) => (
                                <button
                                  key={score}
                                  onClick={() => setEditedScores((prev) => ({ ...prev, [criterion.id]: score }))}
                                  className={cn(
                                    "h-7 w-7 rounded-full text-xs font-bold transition-colors",
                                    currentScore === score
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary text-secondary-foreground hover:bg-primary/20"
                                  )}
                                >
                                  {score}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Anchors */}
                          <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                            <div className={cn("rounded px-1.5 py-0.5", currentScore === 1 ? "bg-red-50 text-red-600" : "")}>1: {criterion.anchor1}</div>
                            <div className={cn("rounded px-1.5 py-0.5 text-center", currentScore === 3 ? "bg-yellow-50 text-yellow-700" : "")}>3: {criterion.anchor3}</div>
                            <div className={cn("rounded px-1.5 py-0.5 text-right", currentScore === 5 ? "bg-green-50 text-green-700" : "")}>5: {criterion.anchor5}</div>
                          </div>
                          {scoreEntry?.quote && (
                            <div className="mt-1.5 text-[11px] text-muted-foreground italic">
                              «{scoreEntry.quote}»
                              {scoreEntry.timestamp && scoreEntry.timestamp !== "N/A" && (
                                <span className="ml-1 text-blue-500">({scoreEntry.timestamp})</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </TabsContent>

              {/* Transcript */}
              <TabsContent value="transcript">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="h-4 w-4" />
                    <div className="text-sm font-medium">Транскрипт</div>
                  </div>
                  <Input
                    placeholder="Поиск в транскрипте..."
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                    className="mb-3 h-8 text-xs"
                  />
                  {transcript ? (
                    <div className="max-h-96 overflow-y-auto rounded bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                      {transcriptSearch ? (
                        filteredTranscript || <span className="text-muted-foreground">Ничего не найдено</span>
                      ) : transcript}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Транскрипт недоступен</div>
                  )}
                </Card>
              </TabsContent>

              {/* Sentiment */}
              <TabsContent value="sentiment">
                <Card className="p-4">
                  <div className="mb-3 text-sm font-medium">Сентимент-анализ</div>
                  {sentimentData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={sentimentData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                        <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 10 }} />
                        <ReTooltip
                          formatter={(value: number, _: string, p) => [
                            `${value}/5 — ${(p.payload as SentimentPoint & { time: string }).label}`,
                            "Сентимент"
                          ]}
                        />
                        <Line type="monotone" dataKey="sentiment" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-sm text-muted-foreground">Нет данных сентимента</div>
                  )}
                </Card>
              </TabsContent>

              {/* Red Flags */}
              <TabsContent value="flags">
                <Card className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    <div className="text-sm font-medium">Красные флаги</div>
                    {redFlags.length > 0 && (
                      <Badge variant="destructive" className="text-[10px]">{redFlags.length}</Badge>
                    )}
                  </div>
                  {redFlags.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Красных флагов не обнаружено
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {redFlags.map((flag, i) => (
                        <div key={i} className={cn("rounded-lg border p-3", severityColor[flag.severity] ?? "bg-gray-50 border-gray-200")}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{flag.type}</span>
                            <Badge variant="outline" className="text-[10px]">{flag.severity}</Badge>
                          </div>
                          <div className="mt-1 text-xs">{flag.description}</div>
                          {flag.quote && (
                            <div className="mt-1.5 text-xs italic">
                              «{flag.quote}»
                              {flag.timestamp && flag.timestamp !== "N/A" && (
                                <span className="ml-1 text-blue-600">({flag.timestamp})</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* Facts */}
              <TabsContent value="facts">
                <Card className="p-4">
                  <div className="mb-3 text-sm font-medium">Извлечённые факты</div>
                  {facts.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Факты не извлечены</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="pb-2 text-left font-medium text-muted-foreground">Факт</th>
                            <th className="pb-2 text-left font-medium text-muted-foreground">Значение</th>
                          </tr>
                        </thead>
                        <tbody>
                          {facts.map((fact, i) => (
                            <tr key={i} className="border-b border-border/50 last:border-0">
                              <td className="py-2 pr-4 font-medium">{fact.key}</td>
                              <td className="py-2 text-muted-foreground">{fact.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </Layout>
  );
}
