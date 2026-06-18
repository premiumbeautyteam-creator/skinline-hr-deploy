// Shared CRM constants, helpers and small presentational components.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

// A pipeline stage as returned by GET /api/stages.
export type Stage = {
  key: string;
  label: string;
  color: string; // palette color name (e.g. "blue")
  roleOwner?: string | null;
  position: number;
  isSystem: boolean;
};

// A stage enriched with the Tailwind classes used to render it identically to
// the previous hardcoded design.
export type StageView = Stage & { dot: string; soft: string };

// The fixed 15-color palette. Maps a color name to the dot (solid) class and the
// soft badge classes — these are the exact strings used before stages went
// dynamic, so kanban columns and badges render identically.
export const STAGE_COLOR_NAMES = [
  "sky", "blue", "cyan", "indigo", "violet", "purple", "pink",
  "amber", "orange", "teal", "emerald", "green", "gray", "red", "slate",
] as const;

export type StageColorName = (typeof STAGE_COLOR_NAMES)[number];

export const STAGE_PALETTE: Record<string, { dot: string; soft: string }> = {
  sky: { dot: "bg-sky-500", soft: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300" },
  blue: { dot: "bg-blue-500", soft: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  cyan: { dot: "bg-cyan-500", soft: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  indigo: { dot: "bg-indigo-500", soft: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  violet: { dot: "bg-violet-500", soft: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  purple: { dot: "bg-purple-500", soft: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300" },
  pink: { dot: "bg-pink-500", soft: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300" },
  amber: { dot: "bg-amber-500", soft: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  orange: { dot: "bg-orange-500", soft: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  teal: { dot: "bg-teal-500", soft: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300" },
  emerald: { dot: "bg-emerald-500", soft: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  green: { dot: "bg-green-500", soft: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
  gray: { dot: "bg-gray-400", soft: "bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300" },
  red: { dot: "bg-red-500", soft: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  slate: { dot: "bg-slate-500", soft: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
};

export function stageColorClasses(color: string): { dot: string; soft: string } {
  return STAGE_PALETTE[color] ?? STAGE_PALETTE.gray;
}

function toView(s: Stage): StageView {
  const { dot, soft } = stageColorClasses(s.color);
  return { ...s, dot, soft };
}

// Fetch the dynamic funnel stages, enriched with Tailwind classes.
export function useStages() {
  const query = useQuery<Stage[]>({ queryKey: ["/api/stages"] });
  const stages = useMemo<StageView[]>(() => (query.data ?? []).map(toView), [query.data]);
  const stageMap = useMemo<Record<string, StageView>>(
    () => Object.fromEntries(stages.map((s) => [s.key, s])),
    [stages],
  );
  return { stages, stageMap, isLoading: query.isLoading };
}

export const SOURCES: Record<string, { label: string; className: string }> = {
  avito: { label: "Avito", className: "bg-[#FF6B35] text-white" },
  hh: { label: "hh.ru", className: "bg-[#D6001C] text-white" },
  telegram: { label: "Telegram", className: "bg-[#0088CC] text-white" },
  manual: { label: "Вручную", className: "bg-gray-400 text-white" },
};

export const DOC_TYPES = [
  { key: "passport", label: "Паспорт" },
  { key: "medical_book", label: "Медкнижка" },
  { key: "snils", label: "СНИЛС" },
  { key: "inn", label: "ИНН" },
  { key: "diploma", label: "Диплом" },
  { key: "certificate", label: "Сертификат" },
] as const;

export const VACANCY_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "Активна", className: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
  paused: { label: "На паузе", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  closed: { label: "Закрыта", className: "bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300" },
};

export const CHANNELS: Record<string, string> = {
  hh: "hh.ru", avito: "Avito", telegram: "Telegram", telegram_bot: "Бот Telegram",
  whatsapp: "WhatsApp", internal: "Внутренний",
};

// Avatar palette cycles through brand colors based on name hash
const AVATAR_COLORS = [
  "bg-[#326070] text-white",
  "bg-[#AABFD1] text-[#1f3b46]",
  "bg-[#E2C1A8] text-[#5b3d29]",
];

export function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarColor(name: string): string {
  return AVATAR_COLORS[nameHash(name) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const v = JSON.parse(tags);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const CITIES = [
  "Чебоксары", "Йошкар-Ола", "Казань", "Воронеж", "Липецк",
  "Киров", "Курск", "Набережные Челны", "Новочебоксарск", "Сургут",
];
