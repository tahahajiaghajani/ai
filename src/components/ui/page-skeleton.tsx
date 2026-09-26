/** Shown instantly while the next page renders on the server (route `loading.tsx`). */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div data-loading-skeleton className="animate-pulse space-y-5" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-xl bg-surface-muted" />
        <div className="h-4 w-72 max-w-full rounded-lg bg-surface-muted/70" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-line bg-surface-muted/50" />
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-line p-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-9 shrink-0 rounded-full bg-surface-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 rounded bg-surface-muted" />
              <div className="h-3 w-1/3 rounded bg-surface-muted/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
