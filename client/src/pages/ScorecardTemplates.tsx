// Iter6: Scorecard Templates Admin Page
// Route: /scorecards/templates

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Edit, ClipboardList, Loader2, Save, X } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ScorecardTemplate {
  id: string;
  role: string;
  name: string;
  description: string;
  criteriaJson: string;
  active: number;
  createdAt: string;
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

const ROLE_LABELS: Record<string, string> = {
  master_laser: "Мастер лазерной эпиляции",
  cosmetologist: "Косметолог",
  administrator: "Администратор студии",
  sales_manager: "Менеджер отдела продаж",
};

export default function ScorecardTemplates() {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ScorecardTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formRole, setFormRole] = useState("master_laser");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formActive, setFormActive] = useState(1);
  const [formCriteria, setFormCriteria] = useState<CriterionDef[]>([]);

  const { data: templates, isLoading } = useQuery<ScorecardTemplate[]>({
    queryKey: ["/api/scorecards/templates"],
    queryFn: () => fetch("/api/scorecards/templates").then((r) => r.json()),
  });

  const openCreate = () => {
    setEditingTemplate(null);
    setFormRole("master_laser");
    setFormName("");
    setFormDescription("");
    setFormActive(1);
    setFormCriteria([]);
    setEditOpen(true);
  };

  const openEdit = (template: ScorecardTemplate) => {
    setEditingTemplate(template);
    setFormRole(template.role);
    setFormName(template.name);
    setFormDescription(template.description);
    setFormActive(template.active);
    try {
      setFormCriteria(JSON.parse(template.criteriaJson));
    } catch {
      setFormCriteria([]);
    }
    setEditOpen(true);
  };

  const addCriterion = () => {
    setFormCriteria((prev) => [
      ...prev,
      { id: `criterion_${Date.now()}`, name: "", description: "", anchor1: "", anchor3: "", anchor5: "", weight: 1 },
    ]);
  };

  const removeCriterion = (index: number) => {
    setFormCriteria((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCriterion = (index: number, field: keyof CriterionDef, value: string | number) => {
    setFormCriteria((prev) => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const saveTemplate = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        role: formRole,
        name: formName,
        description: formDescription,
        criteriaJson: JSON.stringify(formCriteria),
        active: formActive,
      };
      if (editingTemplate) {
        await apiRequest("PATCH", `/api/scorecards/templates/${editingTemplate.id}`, payload);
        toast({ title: "Шаблон обновлён" });
      } else {
        await apiRequest("POST", "/api/scorecards/templates", payload);
        toast({ title: "Шаблон создан" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/scorecards/templates"] });
      setEditOpen(false);
    } catch {
      toast({ title: "Ошибка", description: "Не удалось сохранить шаблон", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Шаблоны скоркарт</div>
            <div className="text-xs text-muted-foreground">Критерии оценки кандидатов по ролям</div>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> Создать шаблон
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {(templates ?? []).map((t) => {
            let criteriaCount = 0;
            try {
              criteriaCount = JSON.parse(t.criteriaJson).length;
            } catch { /* ignore */ }

            return (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">{t.name}</span>
                      {t.active ? (
                        <Badge variant="outline" className="text-[10px] text-green-700 border-green-200">Активный</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Архив</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {ROLE_LABELS[t.role] ?? t.role} · {criteriaCount} критериев
                    </div>
                    {t.description && (
                      <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Edit/Create Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTemplate ? "Редактировать шаблон" : "Создать шаблон"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Роль</label>
                  <Select value={formRole} onValueChange={setFormRole}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Статус</label>
                  <Select value={String(formActive)} onValueChange={(v) => setFormActive(parseInt(v))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Активный</SelectItem>
                      <SelectItem value="0">Архив</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">Название шаблона</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Название"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-medium">Описание</label>
                <Input
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Краткое описание"
                  className="mt-1"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium">Критерии ({formCriteria.length})</label>
                  <Button variant="outline" size="sm" onClick={addCriterion}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Добавить
                  </Button>
                </div>
                <div className="space-y-3">
                  {formCriteria.map((c, i) => (
                    <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={c.id}
                          onChange={(e) => updateCriterion(i, "id", e.target.value)}
                          placeholder="ID (snake_case)"
                          className="h-7 text-xs w-40"
                        />
                        <Input
                          value={c.name}
                          onChange={(e) => updateCriterion(i, "name", e.target.value)}
                          placeholder="Название критерия"
                          className="h-7 text-xs flex-1"
                        />
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeCriterion(i)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground">1 балл</label>
                          <Input value={c.anchor1} onChange={(e) => updateCriterion(i, "anchor1", e.target.value)} placeholder="Что значит 1" className="mt-0.5 h-7 text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">3 балла</label>
                          <Input value={c.anchor3} onChange={(e) => updateCriterion(i, "anchor3", e.target.value)} placeholder="Что значит 3" className="mt-0.5 h-7 text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">5 баллов</label>
                          <Input value={c.anchor5} onChange={(e) => updateCriterion(i, "anchor5", e.target.value)} placeholder="Что значит 5" className="mt-0.5 h-7 text-xs" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button>
              <Button onClick={saveTemplate} disabled={!formName.trim() || saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
