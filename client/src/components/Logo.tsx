// Skin Line logo — minimal line-art titmouse (синица) bird in brand teal.
export function BirdMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-label="Skin Line"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* body */}
        <path d="M11 30c0-6.5 5-11.5 11.5-11.5 4 0 7 1.6 9 4.4l6-5.4-2.2 6.2c.8 1.5 1.2 3.2 1.2 5 0 5.6-4.7 9.3-10.8 9.3C18 38 11 35.5 11 30Z" />
        {/* wing */}
        <path d="M21 27c2.6 1.2 5.6 1.4 8.6.4" />
        {/* tail */}
        <path d="M11 30l-5 1.6 3.2 3.4" />
        {/* eye */}
        <circle cx="32.2" cy="24" r="1" fill="currentColor" stroke="none" />
        {/* head cap line */}
        <path d="M28 19c2-1.4 4.4-2 6.8-1.6" />
      </g>
    </svg>
  );
}

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" data-testid="logo-skinline">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <BirdMark className="h-6 w-6" />
      </div>
      {!collapsed && (
        <div className="leading-none">
          <div className="marshall-display text-base leading-none text-foreground">Skin Line</div>
          <div className="marshall-display mt-0.5 text-[10px] tracking-[0.18em] text-muted-foreground">HR CRM</div>
        </div>
      )}
    </div>
  );
}
