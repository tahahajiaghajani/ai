export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="tf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--primary-2)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#tf-g)" />
      <path d="M14 16h20M24 16v18" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <circle cx="14" cy="32" r="3.2" fill="white" opacity="0.85" />
      <circle cx="34" cy="32" r="3.2" fill="white" opacity="0.85" />
      <path d="M17 32h4M27 32h4" stroke="white" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <div className="leading-tight">
        <p className="text-[15px] font-black tracking-tight">
          TaskFlow <span className="text-gradient">AI</span>
        </p>
        <p className="text-[10.5px] text-muted">ارکستراسیون هوشمند کارها</p>
      </div>
    </div>
  );
}
