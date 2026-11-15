// The local server's one thread held (docs/PERFORMANCE_FA.md §17): a timer that should fire every `everyMs` and fires late
// by `thresholdMs` or more means nothing ran on the thread in between — not a request, not a file of the window, not a
// job. PGlite does its file work synchronously on that thread, so a disk or an antivirus that holds a file shows up
// here, with the requests that waited it out, in app.log (desktop-e2e reads app.log from the job's artifact). One line is
// one hold of `thresholdMs` or more: shorter holds one after the other are not reported, so no line does not rule out
// synchronous work.
//
// A gap of `ceilingMs` or more is not a hold: on Windows the clock keeps counting while the computer sleeps or
// hibernates, so the first tick after a wake-up comes hours late. Such a gap is told apart (`onGap`).

export interface StallWatchOptions {
  /** how often the timer fires */
  everyMs?: number;
  /** a lateness from this long on is reported */
  thresholdMs?: number;
  /** a lateness from this long on is a sleep or a paused process, not a hold */
  ceilingMs?: number;
  /** the clock (tests drive a fake one) */
  now?: () => number;
  /** told how long the thread was held */
  onStall: (heldMs: number) => void;
  /** told how long no timer ran when that was `ceilingMs` or more (the computer slept, the process was paused) */
  onGap?: (gapMs: number) => void;
}

/** Starts the watch; returns its stop. The timer does not keep the process alive. */
export function startStallWatch(o: StallWatchOptions): () => void {
  const every = Math.max(10, o.everyMs ?? 100);
  const threshold = o.thresholdMs ?? 1000;
  const ceiling = Math.max(threshold, o.ceilingMs ?? 60_000);
  const now = o.now ?? (() => performance.now());
  let last = now();
  const timer = setInterval(() => {
    const at = now();
    const late = at - last - every;
    last = at;
    if (late >= ceiling) o.onGap?.(Math.round(late));
    else if (late >= threshold) o.onStall(Math.round(late));
  }, every);
  timer.unref?.();
  return () => clearInterval(timer);
}
