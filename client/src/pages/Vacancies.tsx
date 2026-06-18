import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Archive, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { insertVacancySchema } from "@shared/schema";
import type { Vacancy, Candidate } from "@shared/schema";
import { VACANCY_STATUS, CITIES } from "@/lib/crm";
import { cn } from "@/lib/utils";

export default function Vacancies() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Vacancy | null>(null);

  const { data: vacancies, isLoading } = useQuery<Vacancy[]>({ queryKey: ["/api/vacancies"] });
  const { data: candidates } = useQuery<Candidate[]>({ queryKey: ["/api/candidates"] });

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    (candidates ?? []).forEach((c) => (m[c.vacancyId] = (m[c.vacancyId] ?? 0) + 1));
    return m;
  }, [candidates]);

  const form = useForm({
    resolver: zodResolver(insertVacancySchema),
    defaultValues: { title: "", city: "Москва", salary: "", status: "active", description: "" },
  });

  function openNew() {
    setEditing(null);
    form.reset({ title: "", city: "Москва", salary: "", status: "active", description: "" });
    setDialogOpen(true);
  }
  function openEdit(v: Vacancy) {
    setEditing(v);
    form.reset({ title: v.title, city: v.city, salary: v.salary, status: v.status, description: v.description });
    setDialogOpen(true);
  }

  async function onSubmit(values: any) {
    try {
      if (editing) await apiRequest("PATCH", `/api/vacancies/${editing.id}`, values);
      else await apiRequest("POST", "/api/vacancies", values);
      queryClient.invalidateQueries({ queryKey: ["/api/vacancies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: editing ? "Вакансия обновлена" : "Вакансия добавлена" });
      setDialogOpen(false);
    } catch (e) {
      toast({ title: "Ошибка", description: String(e), variant: "destructive" });
    }
  }

  async function archive(v: Vacancy) {
    await apiRequest("PATCH", `/api/vacancies/${v.id}`, { status: v.status === "closed" ? "active" : "closed" });
    queryClient.invalidateQueries({ queryKey: ["/api/vacancies"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
  }
  async function remove(v: Vacancy) {
    await apiRequest("DELETE", `/api/vacancies/${v.id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/vacancies"] });
    toast({ title: "Вакансия удалена" });
  }

  const actions = (
    <Button size="sm" className="gap-1.5" onClick={openNew} data-testid="button-add-vacancy">
      <Plus className="h-4 w-4" /> Добавить вакансию
    </Button>
  );

  return (
    <Layout title="Вакансии" actions={actions}>
      <div className="p-5 md:p-8">
        <Card className="overflow-hidden p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="marshall-display text-[11px]">Должность</TableHead>
                  <TableHead className="marshall-display text-[11px]">Город</TableHead>
                  <TableHead className="marshall-display text-[11px]">Зарплата</TableHead>
                  <TableHead className="marshall-display text-[11px]">Статус</TableHead>
                  <TableHead className="marshall-display text-center text-[11px]">Кандидатов</TableHead>
                  <TableHead className="marshall-display text-right text-[11px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(vacancies ?? []).map((v) => {
                  const st = VACANCY_STATUS[v.status];
                  return (
                    <TableRow key={v.id} data-testid={`row-vacancy-${v.id}`}>
                      <TableCell className="font-medium">{v.title}</TableCell>
                      <TableCell className="text-muted-foreground">{v.city}</TableCell>
                      <TableCell>{v.salary}</TableCell>
                      <TableCell>
                        <span className={cn("marshall-display inline-flex rounded-full px-2 py-0.5 text-[10px]", st.className)}>{st.label}</span>
                      </TableCell>
                      <TableCell className="text-center">{counts[v.id] ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(v)} data-testid={`edit-vacancy-${v.id}`}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => archive(v)} data-testid={`archive-vacancy-${v.id}`}><Archive className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(v)} data-testid={`delete-vacancy-${v.id}`}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Редактировать вакансию" : "Новая вакансия"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Должность</FormLabel><FormControl><Input data-testid="input-vac-title" placeholder="Мастер маникюра" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem><FormLabel>Город</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-vac-city"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="salary" render={({ field }) => (
                  <FormItem><FormLabel>Зарплата</FormLabel><FormControl><Input data-testid="input-vac-salary" placeholder="от 90 000 ₽" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem><FormLabel>Статус</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-vac-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="active">Активна</SelectItem>
                      <SelectItem value="paused">На паузе</SelectItem>
                      <SelectItem value="closed">Закрыта</SelectItem>
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Описание</FormLabel><FormControl><Textarea data-testid="input-vac-desc" rows={4} placeholder="Условия, требования..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-vacancy">Отмена</Button>
                <Button type="submit" data-testid="button-save-vacancy">Сохранить</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
