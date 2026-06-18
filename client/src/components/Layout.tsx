import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Users, Briefcase, Settings, Moon, Sun, Radio, ClipboardList, Bell, UserCheck, Share2, HelpCircle } from "lucide-react";
import { Logo } from "./Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/ThemeProvider";
import type { Candidate } from "@shared/schema";

const NAV: Array<{
  href: string;
  label: string;
  icon: React.ElementType;
  testid: string;
  hint?: string;
}> = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard, testid: "nav-dashboard" },
  { href: "/candidates", label: "Кандидаты", icon: Users, testid: "nav-candidates" },
  { href: "/vacancies", label: "Вакансии", icon: Briefcase, testid: "nav-vacancies" },
  {
    href: "/channel",
    label: "HR-канал",
    icon: Radio,
    testid: "nav-channel",
    hint: "Управление каналом @SkinLineHR в Telegram: контент-календарь, автопилот публикаций, аналитика подписчиков, реактивация.",
  },
  {
    href: "/quizzes",
    label: "Тесты",
    icon: ClipboardList,
    testid: "nav-quizzes",
    hint: "Квизы для самотестирования кандидатов в Telegram-боте на этапе «Выдаём теорию». Проходной балл 75%.",
  },
  {
    href: "/probation",
    label: "Испытательный",
    icon: UserCheck,
    testid: "nav-probation",
    hint: "90-дневный трек оформленных сотрудников: pulse-опросы на днях 7/30/60/90 и финальное решение.",
  },
  {
    href: "/referrals",
    label: "Рефералы",
    icon: Share2,
    testid: "nav-referrals",
    hint: "Реферальная программа: сотрудники получают персональные ссылки для приглашения друзей с бонусом за прошедших испытательный.",
  },
  {
    href: "/alerts",
    label: "Алёрты",
    icon: Bell,
    testid: "nav-alerts",
    hint: "Единая лента красных флагов: просроченные таймеры, низкий sentiment кандидатов, аномалии воронки, паузы в канале.",
  },
  { href: "/settings", label: "Настройки", icon: Settings, testid: "nav-settings" },
];

export function Layout({ children, title, actions }: { children: React.ReactNode; title: string; actions?: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const { data: candidates } = useQuery<Candidate[]>({ queryKey: ["/api/candidates"] });
  const newCount = (candidates ?? []).filter((c) => c.stage === "new").length;

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testid}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover-elevate",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="marshall-display flex-1 text-xs">{item.label}</span>
                {item.href === "/candidates" && newCount > 0 && (
                  <Badge
                    data-testid="badge-new-count"
                    className={cn(
                      "h-5 min-w-5 justify-center rounded-full px-1.5 text-[11px]",
                      active ? "bg-white/25 text-white" : "bg-primary text-primary-foreground",
                    )}
                  >
                    {newCount}
                  </Badge>
                )}
                {item.hint && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="ml-auto flex-shrink-0"
                          onClick={(e) => e.preventDefault()}
                        >
                          <HelpCircle
                            className={cn(
                              "h-3.5 w-3.5 transition-opacity",
                              active ? "opacity-60 hover:opacity-100" : "opacity-40 hover:opacity-80"
                            )}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                        {item.hint}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="rounded-xl bg-sidebar-accent px-3 py-2.5 text-xs text-sidebar-accent-foreground">
            <div className="marshall-display text-[11px]">Skin Line</div>
            <div className="text-muted-foreground">Сеть салонов красоты</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background/80 px-5 backdrop-blur md:px-8">
          {/* Mobile logo */}
          <div className="md:hidden">
            <Logo collapsed />
          </div>
          <h1 className="marshall-display truncate text-base leading-tight" data-testid="text-page-title">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              data-testid="button-theme-toggle"
              aria-label="Сменить тему"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-background px-3 py-2 md:hidden">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "marshall-display flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
