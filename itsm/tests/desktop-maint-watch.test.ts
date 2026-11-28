// The splash while the database is compacted before ready (src/shared/desktop/ready-watch.ts): the server reports a
// second "migrations" phase marked `maintenance`, the watch stays in that stage (no fixed limit, the stall question only
// after its long silence) and tells the person at once what is going on; every compaction step counts as progress.
import { describe, it, expect } from "vitest";
import { createReadyWatch, parseStartPhase, countProgress, noticeTexts, NOTICE_TEXT, MIGRATIONS_CEILING_MS } from "@shared/desktop/ready-watch";

describe("the start's watch during the database's compaction", () => {
  it("parses the phase with its mark, and only a true one", () => {
    expect(parseStartPhase({ type: "phase", phase: "migrations", maintenance: true })).toEqual({ phase: "migrations", maintenance: true });
    expect(parseStartPhase({ type: "phase", phase: "migrations", maintenance: "yes" })).toEqual({ phase: "migrations" });
    expect(parseStartPhase({ type: "phase", phase: "migrations" })).toEqual({ phase: "migrations" });
  });

  it("tells the person at once, with the time since the compaction began, and asks only after the long silence", () => {
    const w = createReadyWatch(0);
    w.phase({ phase: "database", walMb: 0, recovery: false }, 1_000);
    w.phase({ phase: "migrations" }, 2_000);
    // the migrations: nothing to tell yet
    expect(w.check(3_000)).toEqual({ kind: "wait", notice: null });
    w.phase({ phase: "migrations", maintenance: true }, 4_000);
    expect(w.stage).toBe("migrations");
    expect(w.check(4_000)).toEqual({ kind: "wait", notice: { kind: "maintenance", elapsedMs: 0 } });
    expect(w.check(64_000)).toEqual({ kind: "wait", notice: { kind: "maintenance", elapsedMs: 60_000 } });
    // a step applied keeps it going; only the migrations' long silence brings up the question
    w.progress(100_000);
    expect(w.check(100_000 + MIGRATIONS_CEILING_MS - 1).kind).toBe("wait");
    expect(w.check(100_000 + MIGRATIONS_CEILING_MS)).toMatchObject({ kind: "timeout", stage: "migrations" });
  });

  it("counts every compaction step the server logs as progress", () => {
    const text = [
      "[itsm] database maintenance: compacting 2 tables (3.1 GB to free; 12.4 GB free on the disk)",
      "[itsm] maintenance step jobs:sm_jobs:12 applied (32 MB, 302000 finished jobs deleted so far, 93 ms)",
      "[itsm] maintenance step compact:sm_jobs applied (605 MB → 35 MB in 1211 ms)",
      "[itsm] maintenance step analyze:sm_jobs applied (99 ms)",
      "[itsm] migration 0104_ci_identity_indexes applied (12 ms)",
      "[itsm] schema step engine:12 applied",
    ].join("\n");
    expect(countProgress(text)).toBe(5);
    expect(countProgress("[itsm] database maintenance: nothing to do (2 ms; 41 MB of log since the last look)")).toBe(0);
  });

  it("says it in Persian, in the note and the status line", () => {
    const t = noticeTexts({ kind: "maintenance", elapsedMs: 75_000 }, "باز کردن داده‌ها…");
    expect(t.note).toBe(NOTICE_TEXT.maintenance);
    expect(t.note).toMatch(/فشرده‌سازی/);
    expect(t.status).toBe("فشرده‌سازی پایگاه داده… ۱:۱۵");
  });
});
