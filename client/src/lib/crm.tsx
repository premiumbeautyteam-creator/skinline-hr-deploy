// Shared CRM constants, helpers and small presentational components.

export const STAGES = [
  { key: "form_filled", label: "Анкета заполнена", color: "bg-blue-500", soft: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  { key: "in_work", label: "Взяли в работу", color: "bg-cyan-500", soft: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  { key: "video_interview", label: "Видеоинтервью", color: "bg-indigo-500", soft: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  { key: "studio_demo", label: "Демо-погружение", color: "bg-violet-500", soft: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  { key: "theory", label: "Выдаём теорию", color: "bg-purple-500", soft: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300" },
  { key: "exam_scheduled", label: "Назначен экзамен", color: "bg-pink-500", soft: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300" },
  { key: "reexam", label: "Переэкзаменовка", color: "bg-amber-500", soft: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  { key: "trainer_onboarding", label: "Обучение тренером", color: "bg-orange-500", soft: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  { key: "studio_practice", label: "Практика в студии", color: "bg-teal-500", soft: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300" },
  { key: "scheduled", label: "Выход в график", color: "bg-emerald-500", soft: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  { key: "reserve", label: "Резерв", color: "bg-gray-400", soft: "bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300" },
  { key: "rejected", label: "Отказ", color: "bg-red-500", soft: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  { key: "official", label: "Трудоустройство", color: "bg-green-500", soft: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
  { key: "dismissed", label: "Увольнение", color: "bg-slate-500", soft: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
] as const;

export const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.key, s]));

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
