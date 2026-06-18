import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  DndContext, PointerSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  useStages, STAGE_COLOR_NAMES, stageColorClasses, type StageView,
} from "@/lib/crm";

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="color-picker">
      {STAGE_COLOR_NAMES.map((c) => {
        const { dot } = stageColorClasses(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            data-testid={`color-${c}`}
            className={cn(
              "h-7 w-7 rounded-full transition-transform",
              dot,
              value === c ? "ring-2 ring-offset-2 ring-primary scale-110" : "opacity-80 hover:opacity-100",
            )}
            aria-label={c}
          />
        );
      })}
    </div>
  );
}

function SortableRow({
  stage, onEdit, onDelete,
}: {
  stage: StageView;
  onEdit: (s: StageView) => void;
  onDelete: (s: StageView) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.key });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`stage-row-${stage.key}`}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card p-3",
        isDragging && "shadow-lg ring-2 ring-primary/30",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        data-testid={`drag-${stage.key}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className={cn("h-3 w-3 shrink-0 rounded-full", stage.dot)} />
      <span className="flex-1 truncate text-sm font-medium">{stage.label}</span>
      {stage.isSystem && (
        <span className="marshall-display inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" data-testid={`system-badge-${stage.key}`}>
          Системный
        </span>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(stage)} data-testid={`edit-${stage.key}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive disabled:opacity-30"
        disabled={stage.isSystem}
        onClick={() => onDelete(stage)}
        data-testid={`delete-${stage.key}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function StageManagement() {
  const { toast } = useToast();
  const { stages } = useStages();

  // Local ordering for snappy drag-and-drop, synced from server data.
  const [order, setOrder] = useState<StageView[]>([]);
  useEffect(() => { setOrder(stages); }, [stages]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StageView | null>(null);
  const [formLabel, setFormLabel] = useState("");
  const [formColor, setFormColor] = useState<string>("blue");
  const [deleteTarget, setDeleteTarget] = useState<StageView | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/stages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        const res = await apiRequest("PATCH", `/api/stages/${editing.key}`, { label: formLabel, color: formColor });
        return res.json();
      }
      const res = await apiRequest("POST", "/api/stages", { label: formLabel, color: formColor });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast({ title: editing ? "Этап обновлён" : "Этап добавлен" });
    },
    onError: (err: any) => {
      const msg = typeof err?.message === "string" ? err.message.replace(/^\d+:\s*/, "") : "";
      toast({ title: "Ошибка сохранения", description: msg || undefined, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("DELETE", `/api/stages/${key}`);
      return res.json() as Promise<{ removedCandidates: number }>;
    },
    onSuccess: (data) => {
      invalidate();
      setDeleteTarget(null);
      toast({
        title: "Этап удалён",
        description: data.removedCandidates > 0
          ? `Удалено карточек кандидатов: ${data.removedCandidates}.`
          : undefined,
      });
    },
    onError: (err: any) => {
      const msg = typeof err?.message === "string" ? err.message.replace(/^\d+:\s*/, "") : "";
      toast({ title: "Не удалось удалить этап", description: msg || undefined, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (keys: string[]) => {
      const res = await apiRequest("PUT", "/api/stages/reorder", { order: keys });
      return res.json();
    },
    onSuccess: () => invalidate(),
    onError: () => {
      invalidate();
      toast({ title: "Ошибка сортировки", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditing(null);
    setFormLabel("");
    setFormColor("blue");
    setDialogOpen(true);
  }
  function openEdit(s: StageView) {
    setEditing(s);
    setFormLabel(s.label);
    setFormColor(s.color);
    setDialogOpen(true);
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((s) => s.key === active.id);
    const newIndex = order.findIndex((s) => s.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next); // optimistic
    reorderMutation.mutate(next.map((s) => s.key));
  }

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-sm">Этапы воронки</h2>
          <p className="text-sm text-muted-foreground">
            Создавайте, редактируйте, удаляйте и перетаскивайте этапы воронки.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-add-stage" className="gap-1.5">
          <Plus className="h-4 w-4" /> Добавить этап
        </Button>
      </div>

      <Card className="mt-3 p-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order.map((s) => s.key)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2" data-testid="stage-list">
              {order.map((s) => (
                <SortableRow key={s.key} stage={s} onEdit={openEdit} onDelete={setDeleteTarget} />
              ))}
              {order.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">Этапов пока нет</div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-stage">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать этап" : "Новый этап"}</DialogTitle>
            <DialogDescription>
              {editing ? "Измените название и цвет этапа." : "Введите название и выберите цвет этапа."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="stage-label">Название</Label>
              <Input
                id="stage-label"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Например, Тестовое задание"
                data-testid="input-stage-label"
              />
            </div>
            <div className="space-y-2">
              <Label>Цвет</Label>
              <ColorPicker value={formColor} onChange={setFormColor} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !formLabel.trim()}
              data-testid="button-save-stage"
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="dialog-delete-stage">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить этап «{deleteTarget?.label}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Все карточки кандидатов на этом этапе будут удалены из CRM (вместе с их задачами,
              документами, сообщениями и историей). На hh.ru эти кандидаты НЕ удаляются — мы только
              читаем данные с hh.ru. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.key)}
              data-testid="button-confirm-delete-stage"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
