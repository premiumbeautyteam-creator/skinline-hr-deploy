import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CITIES } from "@/lib/crm";
import type { Vacancy } from "@shared/schema";

const formSchema = z.object({
  fullName: z.string().min(2, "Введите ФИО"),
  phone: z.string().min(5, "Введите телефон"),
  email: z.string().email("Неверный email").optional().or(z.literal("")),
  city: z.string().min(1, "Выберите город"),
  vacancyId: z.string().min(1, "Выберите вакансию"),
  source: z.string().min(1),
  experience: z.string().min(1, "Укажите опыт"),
  expectedSalary: z.string().optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

export function CandidateFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const { data: vacancies } = useQuery<Vacancy[]>({ queryKey: ["/api/vacancies"] });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "", phone: "", email: "", city: "Москва",
      vacancyId: "", source: "manual", experience: "", expectedSalary: "",
    },
  });

  async function onSubmit(values: FormValues) {
    try {
      await apiRequest("POST", "/api/candidates", {
        ...values,
        email: values.email || null,
        expectedSalary: values.expectedSalary || null,
        sourceUrl: null,
        stage: "new",
        rating: null,
        notes: null,
        tags: JSON.stringify([]),
        rejectReason: null,
        avatarUrl: null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Кандидат добавлен", description: values.fullName });
      form.reset();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Ошибка", description: String(e), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый кандидат</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="fullName" render={({ field }) => (
              <FormItem>
                <FormLabel>ФИО</FormLabel>
                <FormControl><Input data-testid="input-fullname" placeholder="Анна Иванова" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Телефон</FormLabel>
                  <FormControl><Input data-testid="input-phone" placeholder="+7 916 000-00-00" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input data-testid="input-email" placeholder="email@mail.ru" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>Город</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-city"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="vacancyId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Вакансия</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-vacancy"><SelectValue placeholder="Выберите" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(vacancies ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.title} — {v.city}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="experience" render={({ field }) => (
                <FormItem>
                  <FormLabel>Опыт</FormLabel>
                  <FormControl><Input data-testid="input-experience" placeholder="5 лет" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="expectedSalary" render={({ field }) => (
                <FormItem>
                  <FormLabel>Ожидания по ЗП</FormLabel>
                  <FormControl><Input data-testid="input-salary" placeholder="90 000 ₽" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="source" render={({ field }) => (
              <FormItem>
                <FormLabel>Источник</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-source"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="manual">Вручную</SelectItem>
                    <SelectItem value="avito">Avito</SelectItem>
                    <SelectItem value="hh">hh.ru</SelectItem>
                    <SelectItem value="telegram">Telegram</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-candidate">Отмена</Button>
              <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-save-candidate">Добавить</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
