// Quiz management page — Iter4
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp,
  Loader2, Sparkles, ClipboardList, ToggleLeft, ToggleRight,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Quiz {
  id: string;
  title: string;
  description: string | null;
  active: number;
  triggerStage: string | null;
  passingScore: number;
  createdAt: string;
  updatedAt: string;
}

interface QuizQuestion {
  id: string;
  quizId: string;
  position: number;
  text: string;
  options: string; // JSON array
  correctIndex: number;
  explanation: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  form_filled: "Анкета заполнена",
  in_work: "Взяли в работу",
  video_interview: "Видеоинтервью",
  studio_demo: "Демо-погружение",
  theory: "Выдаём теорию",
  exam_scheduled: "Назначен экзамен",
  reexam: "Переэкзаменовка",
  trainer_onboarding: "Обучение тренером",
  studio_practice: "Практика в студии",
  scheduled: "Выход в график",
  reserve: "Резерв",
  rejected: "Отказ",
  official: "Офиц. трудоустройство",
  dismissed: "Увольнение",
};

export default function Quizzes() {
  const { toast } = useToast();
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newQuiz, setNewQuiz] = useState({ title: "", description: "", triggerStage: "", passingScore: 75 });
  const [editQuestion, setEditQuestion] = useState<QuizQuestion | null>(null);
  const [newQuestion, setNewQuestion] = useState({ text: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" });
  const [addQuestionOpen, setAddQuestionOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  const { data: quizzes = [], isLoading } = useQuery<Quiz[]>({
    queryKey: ["/api/quizzes"],
  });

  const selectedQuiz = quizzes.find((q) => q.id === selectedQuizId) ?? null;

  const { data: questions = [] } = useQuery<QuizQuestion[]>({
    queryKey: ["/api/quizzes", selectedQuizId, "questions"],
    enabled: Boolean(selectedQuizId),
  });

  // Create quiz
  const createQuizMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quizzes", {
        title: newQuiz.title,
        description: newQuiz.description,
        triggerStage: newQuiz.triggerStage || null,
        passingScore: newQuiz.passingScore,
        active: 1,
      });
      return res.json() as Promise<Quiz>;
    },
    onSuccess: (quiz) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes"] });
      setSelectedQuizId(quiz.id);
      setCreateOpen(false);
      setNewQuiz({ title: "", description: "", triggerStage: "", passingScore: 75 });
      toast({ title: "Тест создан" });
    },
    onError: () => toast({ title: "Ошибка создания теста", variant: "destructive" }),
  });

  // Toggle active
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: number }) => {
      const res = await apiRequest("PUT", `/api/quizzes/${id}`, { active });
      return res.json() as Promise<Quiz>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes"] });
      toast({ title: "Статус обновлён" });
    },
  });

  // Add question
  const addQuestionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedQuizId) return;
      const res = await apiRequest("POST", `/api/quizzes/${selectedQuizId}/questions`, {
        text: newQuestion.text,
        options: newQuestion.options,
        correctIndex: newQuestion.correctIndex,
        explanation: newQuestion.explanation || null,
        position: questions.length,
      });
      return res.json() as Promise<QuizQuestion>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes", selectedQuizId, "questions"] });
      setAddQuestionOpen(false);
      setNewQuestion({ text: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" });
      toast({ title: "Вопрос добавлен" });
    },
    onError: () => toast({ title: "Ошибка добавления вопроса", variant: "destructive" }),
  });

  // Delete question
  const deleteQuestionMutation = useMutation({
    mutationFn: async (questionId: string) => {
      await apiRequest("DELETE", `/api/quiz-questions/${questionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes", selectedQuizId, "questions"] });
      toast({ title: "Вопрос удалён" });
    },
  });

  // Update question
  const updateQuestionMutation = useMutation({
    mutationFn: async (q: QuizQuestion) => {
      const opts = typeof q.options === "string" ? JSON.parse(q.options) : q.options;
      const res = await apiRequest("PUT", `/api/quiz-questions/${q.id}`, {
        text: q.text,
        options: opts,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      });
      return res.json() as Promise<QuizQuestion>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes", selectedQuizId, "questions"] });
      setEditQuestion(null);
      toast({ title: "Вопрос обновлён" });
    },
  });

  // AI generate questions
  async function generateAiQuestions() {
    if (!selectedQuiz || !selectedQuizId) return;
    setAiGenerating(true);
    try {
      const res = await apiRequest("POST", `/api/quizzes/${selectedQuizId}/generate-ai-questions`, {
        topic: selectedQuiz.title,
        count: 5,
      });
      const data = await res.json() as { questions?: Array<{ text: string; options: string[]; correctIndex: number; explanation: string }> };
      if (!data.questions?.length) {
        toast({ title: "AI не вернул вопросы", variant: "destructive" });
        return;
      }
      for (let i = 0; i < data.questions.length; i++) {
        const q = data.questions[i]!;
        await apiRequest("POST", `/api/quizzes/${selectedQuizId}/questions`, {
          text: q.text,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          position: questions.length + i,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes", selectedQuizId, "questions"] });
      toast({ title: `Добавлено ${data.questions.length} вопросов от AI` });
    } catch {
      toast({ title: "Ошибка AI-генерации", variant: "destructive" });
    } finally {
      setAiGenerating(false);
    }
  }

  function parseOptions(opts: string | string[]): string[] {
    if (Array.isArray(opts)) return opts;
    try { return JSON.parse(opts) as string[]; } catch { return []; }
  }

  const OPTION_LABELS = ["A", "B", "C", "D"];

  return (
    <Layout title="Тесты">
      <div className="p-5 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Управление тестами</h2>
            <p className="text-sm text-muted-foreground">Тесты для кандидатов по этапам найма</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-quiz">
            <Plus className="mr-1 h-4 w-4" /> Создать тест
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Quiz list */}
          <div className="lg:col-span-1">
            <div className="space-y-2">
              {isLoading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!isLoading && quizzes.length === 0 && (
                <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                  <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Нет тестов
                </div>
              )}
              {quizzes.map((quiz) => (
                <Card
                  key={quiz.id}
                  className={cn(
                    "cursor-pointer p-4 transition-colors hover:border-primary/50",
                    selectedQuizId === quiz.id && "border-primary",
                  )}
                  onClick={() => setSelectedQuizId(quiz.id)}
                  data-testid={`quiz-item-${quiz.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{quiz.title}</div>
                      {quiz.triggerStage && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Этап: {STAGE_LABELS[quiz.triggerStage] ?? quiz.triggerStage}
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Порог: {quiz.passingScore}%
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Badge
                        className={cn(
                          "text-[10px]",
                          quiz.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500",
                        )}
                      >
                        {quiz.active ? "Активен" : "Отключён"}
                      </Badge>
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleActiveMutation.mutate({ id: quiz.id, active: quiz.active ? 0 : 1 });
                        }}
                        data-testid={`toggle-quiz-${quiz.id}`}
                      >
                        {quiz.active ? (
                          <ToggleRight className="h-4 w-4 text-green-600" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Questions editor */}
          <div className="lg:col-span-2">
            {!selectedQuiz ? (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Выберите тест слева
              </div>
            ) : (
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{selectedQuiz.title}</h3>
                    {selectedQuiz.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{selectedQuiz.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={generateAiQuestions}
                      disabled={aiGenerating}
                      data-testid="button-ai-generate"
                    >
                      {aiGenerating ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                      )}
                      Создать с AI
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setAddQuestionOpen(true)}
                      data-testid="button-add-question"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Вопрос
                    </Button>
                  </div>
                </div>

                {questions.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Нет вопросов. Добавьте вручную или с помощью AI.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {questions.map((q, idx) => {
                      const opts = parseOptions(q.options);
                      const isEditing = editQuestion?.id === q.id;
                      return (
                        <div
                          key={q.id}
                          className="rounded-xl border border-card-border p-4"
                          data-testid={`question-item-${q.id}`}
                        >
                          {isEditing && editQuestion ? (
                            <div className="space-y-3">
                              <Textarea
                                value={editQuestion.text}
                                onChange={(e) => setEditQuestion({ ...editQuestion, text: e.target.value })}
                                className="text-sm"
                                rows={2}
                              />
                              {parseOptions(editQuestion.options).map((opt, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <button
                                    className={cn(
                                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                                      editQuestion.correctIndex === i
                                        ? "border-green-500 bg-green-100 text-green-700"
                                        : "border-border text-muted-foreground",
                                    )}
                                    onClick={() => setEditQuestion({ ...editQuestion, correctIndex: i })}
                                  >
                                    {OPTION_LABELS[i]}
                                  </button>
                                  <Input
                                    value={opt}
                                    onChange={(e) => {
                                      const newOpts = parseOptions(editQuestion.options).map((o, j) => j === i ? e.target.value : o);
                                      setEditQuestion({ ...editQuestion, options: JSON.stringify(newOpts) });
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              ))}
                              <Input
                                value={editQuestion.explanation ?? ""}
                                onChange={(e) => setEditQuestion({ ...editQuestion, explanation: e.target.value })}
                                placeholder="Объяснение правильного ответа"
                                className="h-8 text-xs"
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => updateQuestionMutation.mutate(editQuestion)} data-testid="button-save-question">
                                  <Check className="mr-1 h-3.5 w-3.5" /> Сохранить
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditQuestion(null)}>Отмена</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <div className="text-sm font-medium">
                                    {idx + 1}. {q.text}
                                  </div>
                                  <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                                    {opts.map((opt, i) => (
                                      <div
                                        key={i}
                                        className={cn(
                                          "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs",
                                          q.correctIndex === i
                                            ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300"
                                            : "bg-muted/50 text-muted-foreground",
                                        )}
                                      >
                                        <span className="font-bold">{OPTION_LABELS[i]}.</span>
                                        {opt}
                                        {q.correctIndex === i && <Check className="ml-auto h-3 w-3 text-green-600" />}
                                      </div>
                                    ))}
                                  </div>
                                  {q.explanation && (
                                    <div className="mt-2 text-[11px] italic text-muted-foreground">
                                      Объяснение: {q.explanation}
                                    </div>
                                  )}
                                </div>
                                <div className="flex shrink-0 gap-1">
                                  <button
                                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                                    onClick={() => setEditQuestion(q)}
                                    data-testid={`edit-question-${q.id}`}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                                    onClick={() => deleteQuestionMutation.mutate(q.id)}
                                    data-testid={`delete-question-${q.id}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Create quiz dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Создать тест</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Название *</label>
              <Input
                value={newQuiz.title}
                onChange={(e) => setNewQuiz((p) => ({ ...p, title: e.target.value }))}
                placeholder="Например: Базовая теория лазерной эпиляции"
                data-testid="input-quiz-title"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Описание</label>
              <Textarea
                value={newQuiz.description}
                onChange={(e) => setNewQuiz((p) => ({ ...p, description: e.target.value }))}
                placeholder="Краткое описание теста..."
                className="min-h-[80px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Этап-триггер</label>
              <Select
                value={newQuiz.triggerStage || "none"}
                onValueChange={(v) => setNewQuiz((p) => ({ ...p, triggerStage: v === "none" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-trigger-stage"><SelectValue placeholder="Не привязан к этапу" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не привязан</SelectItem>
                  {Object.entries(STAGE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Проходной балл (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={newQuiz.passingScore}
                onChange={(e) => setNewQuiz((p) => ({ ...p, passingScore: parseInt(e.target.value, 10) || 70 }))}
                data-testid="input-passing-score"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button
              onClick={() => createQuizMutation.mutate()}
              disabled={!newQuiz.title || createQuizMutation.isPending}
              data-testid="button-confirm-create-quiz"
            >
              {createQuizMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add question dialog */}
      <Dialog open={addQuestionOpen} onOpenChange={setAddQuestionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Добавить вопрос</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Текст вопроса *</label>
              <Textarea
                value={newQuestion.text}
                onChange={(e) => setNewQuestion((p) => ({ ...p, text: e.target.value }))}
                rows={3}
                placeholder="Введите вопрос..."
                data-testid="input-question-text"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Варианты ответа (выберите правильный)</label>
              <div className="space-y-2">
                {newQuestion.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                        newQuestion.correctIndex === i
                          ? "border-green-500 bg-green-100 text-green-700"
                          : "border-border text-muted-foreground",
                      )}
                      onClick={() => setNewQuestion((p) => ({ ...p, correctIndex: i }))}
                      data-testid={`option-correct-${i}`}
                    >
                      {OPTION_LABELS[i]}
                    </button>
                    <Input
                      value={opt}
                      onChange={(e) => {
                        const opts = [...newQuestion.options];
                        opts[i] = e.target.value;
                        setNewQuestion((p) => ({ ...p, options: opts }));
                      }}
                      placeholder={`Вариант ${OPTION_LABELS[i]}`}
                      className="h-8 text-xs"
                      data-testid={`input-option-${i}`}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Объяснение правильного ответа</label>
              <Input
                value={newQuestion.explanation}
                onChange={(e) => setNewQuestion((p) => ({ ...p, explanation: e.target.value }))}
                placeholder="Необязательно..."
                className="h-8 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddQuestionOpen(false)}>Отмена</Button>
            <Button
              onClick={() => addQuestionMutation.mutate()}
              disabled={!newQuestion.text || addQuestionMutation.isPending}
              data-testid="button-confirm-add-question"
            >
              {addQuestionMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
