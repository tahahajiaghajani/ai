// The Windows app's heavy database work takes turns: a backup (./backup-stream.ts) and the idle upkeep's statements
// (./upkeep.ts). A backup holds the log's checkpoints off while it copies (src/server/db/wal.ts `hold`), so a long VACUUM
// running meanwhile would pile up log the copy then has to carry — or cut it short —, and a VACUUM of a table the copy
// reads makes it slower for nothing. So a backup waits for the upkeep's statement under way, and the upkeep runs none
// while a backup holds the lock or waits for it.

export interface HeavyLock {
  /** Runs `fn` once every earlier holder is done; holders take turns in the order they asked. */
  run<T>(what: string, fn: () => Promise<T>): Promise<T>;
  /** Runs `fn` now if nobody holds the lock or waits for it; otherwise runs nothing (`ran: false`). */
  tryRun<T>(what: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
  /** whether someone holds the lock or waits for it */
  busy(): boolean;
  /** what holds the lock now (null: nothing) */
  holder(): string | null;
}

export function createHeavyLock(): HeavyLock {
  let tail: Promise<void> = Promise.resolve();
  let queued = 0;
  let current: string | null = null;
  const run = <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    queued++;
    const turn = tail.then(async () => {
      current = what;
      try {
        return await fn();
      } finally {
        current = null;
        queued--;
      }
    });
    // the next holder waits for this one, whether it succeeded or not
    tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  };
  return {
    run,
    async tryRun(what, fn) {
      if (queued > 0) return { ran: false };
      return { ran: true, value: await run(what, fn) };
    },
    busy: () => queued > 0,
    holder: () => current,
  };
}
