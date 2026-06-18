import { cn } from "@/lib/utils";
import { SOURCES, STAGE_MAP, avatarColor, initials } from "@/lib/crm";

export function SourceBadge({ source, className }: { source: string; className?: string }) {
  const s = SOURCES[source] ?? SOURCES.manual;
  return (
    <span
      data-testid={`badge-source-${source}`}
      className={cn("marshall-display inline-flex items-center rounded-full px-2 py-0.5 text-[10px]", s.className, className)}
    >
      {s.label}
    </span>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const s = STAGE_MAP[stage];
  if (!s) return null;
  return (
    <span className={cn("marshall-display inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px]", s.soft)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.color)} />
      {s.label}
    </span>
  );
}

export function CandidateAvatar({
  name,
  url,
  size = "md",
}: {
  name: string;
  url?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const dim = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
    xl: "h-20 w-20 text-2xl",
  }[size];
  if (url) {
    return <img src={url} alt={name} className={cn("rounded-full object-cover", dim)} />;
  }
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold", dim, avatarColor(name))}
    >
      {initials(name)}
    </div>
  );
}
