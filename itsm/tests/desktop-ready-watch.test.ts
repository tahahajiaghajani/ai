// The Windows app waits for its local server by what the server says it is doing (src/shared/desktop/ready-watch.ts,
// desktop/src/main.ts): only before the server opens its database do 90 s without a sign of progress bring up a question
// (wait on, run again, quit) — never a stop decided for the person —; while it opens it there is no limit — a database that
// was not closed cleanly replays its write-ahead log there, minutes for gigabytes, on the server's only thread —; and from
// the migrations to ready only 30 minutes without a migration or schema step applied bring up the question. The app used
// to give the whole start a fixed 90 s and then killed the server, so a recovery longer than that started over at every
// start and the app never opened again (an owner's app.log, 1.1.0 and 1.1.2). The main process's tests below drive
// desktop/src/main.ts with a fake Electron and a fake clock (timers, Date and performance); on the fixed timer, and on
// 1.1.3's wall-clock watch that ended the start at its first timeout, they fail.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  createReadyWatch,
  closeQuestion,
  countProgress,
  elapsedFa,
  noticeTexts,
  parseStartPhase,
  CLOSE_BUTTONS,
  CLOSE_TEXT,
  NOTICE_TEXT,
  NOTICE_AFTER_MS,
  SLOW_NOTICE_AFTER_MS,
  READY_BUDGET_MS,
  LARGE_WAL_MB,
  MIGRATIONS_CEILING_MS,
  STALL_BUTTONS,
  STALL_TEXT,
} from "@shared/desktop/ready-watch";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("the start's watch", () => {
  it("never gives up while the server opens its database, however long the open takes", () => {
    const w = createReadyWatch(0);
    w.phase({ phase: "database", walMb: 6144, recovery: true }, 1_500);
    expect(w.stage).toBe("database");
    for (const at of [1_500, READY_BUDGET_MS, READY_BUDGET_MS + 1, 30 * MIN, 6 * HOUR]) expect(w.check(at).kind).toBe("wait");
  });

  it("asks after 90 s without a word before the server opens its database, and «wait» gives another 90 s", () => {
    const w = createReadyWatch(1_000);
    expect(w.check(1_000 + READY_BUDGET_MS - 1)).toEqual({ kind: "wait", notice: null });
    expect(w.check(1_000 + READY_BUDGET_MS)).toEqual({ kind: "timeout", stage: "starting", silentMs: READY_BUDGET_MS });
    // the person waits on (main.ts calls progress): the budget starts again from the answer
    w.progress(1_000 + 4 * MIN);
    expect(w.check(1_000 + 4 * MIN + READY_BUDGET_MS - 1).kind).toBe("wait");
    expect(w.check(1_000 + 4 * MIN + READY_BUDGET_MS)).toEqual({ kind: "timeout", stage: "starting", silentMs: READY_BUDGET_MS });
  });

  it("does not cut the migrations short at 90 s either: a note after 30 s without one applied, a question only after 30 minutes", () => {
    const w = createReadyWatch(0);
    w.phase({ phase: "database", walMb: 900, recovery: true }, 2_000);
    w.phase({ phase: "migrations" }, 20 * MIN);
    expect(w.stage).toBe("migrations");
    expect(w.check(20 * MIN + SLOW_NOTICE_AFTER_MS - 1)).toEqual({ kind: "wait", notice: null });
    // a migration over a large table: past the old 90 s, the person is told, nothing is killed
    expect(w.check(20 * MIN + READY_BUDGET_MS)).toEqual({ kind: "wait", notice: { kind: "update", elapsedMs: READY_BUDGET_MS } });
    // a migration applied is a sign of progress: the note waits for the next long one
    w.progress(30 * MIN);
    expect(w.check(30 * MIN + 1_000)).toEqual({ kind: "wait", notice: null });
    expect(w.check(30 * MIN + MIGRATIONS_CEILING_MS - 1).kind).toBe("wait");
    expect(w.check(30 * MIN + MIGRATIONS_CEILING_MS)).toEqual({ kind: "timeout", stage: "migrations", silentMs: MIGRATIONS_CEILING_MS });
  });

  it("tells the person at once when a large log is replayed, after 8 s for a smaller one, after 30 s for any other open", () => {
    const at = (walMb: number, recovery: boolean | null, elapsed: number) => {
      const w = createReadyWatch(0);
      w.phase({ phase: "database", walMb, recovery }, 1_000);
      const v = w.check(1_000 + elapsed);
      return v.kind === "wait" ? v.notice : v;
    };
    // a large log of a database that was not closed cleanly (or that cannot be told): the recovery note, at once
    expect(at(LARGE_WAL_MB, true, 0)).toEqual({ kind: "recovery", elapsedMs: 0 });
    expect(at(4096, null, 0)).toEqual({ kind: "recovery", elapsedMs: 0 });
    // a small one: nothing for a usual open, the recovery note when it takes long
    expect(at(40, true, NOTICE_AFTER_MS - 1)).toBeNull();
    expect(at(40, true, NOTICE_AFTER_MS)).toEqual({ kind: "recovery", elapsedMs: NOTICE_AFTER_MS });
    // closed cleanly: the spare segments an older version kept are not replayed — no recovery note, only a slow open's
    expect(at(1024, false, 0)).toBeNull();
    expect(at(1024, false, SLOW_NOTICE_AFTER_MS - 1)).toBeNull();
    expect(at(1024, false, 12 * MIN)).toEqual({ kind: "slow", elapsedMs: 12 * MIN });
    // a first start or a restore (nothing known about the folder): nothing while a slow machine unpacks the template,
    // a slow open's note when it takes really long
    expect(at(0, null, 11_000)).toBeNull();
    expect(at(0, null, SLOW_NOTICE_AFTER_MS)).toEqual({ kind: "slow", elapsedMs: SLOW_NOTICE_AFTER_MS });
    // after the open: nothing to tell
    const w = createReadyWatch(0);
    w.phase({ phase: "database", walMb: 6144, recovery: true }, 0);
    w.phase({ phase: "migrations" }, 5 * MIN);
    expect(w.check(5 * MIN + 1_000)).toEqual({ kind: "wait", notice: null });
  });

  it("says whether the open replays a log, as the splash's note does (the close question's text follows it)", () => {
    const recovering = (walMb: number, recovery: boolean | null) => {
      const w = createReadyWatch(0);
      w.phase({ phase: "database", walMb, recovery }, 0);
      return w.recovering;
    };
    expect(createReadyWatch(0).recovering).toBe(false);
    expect(recovering(40, true)).toBe(true);
    expect(recovering(LARGE_WAL_MB, null)).toBe(true);
    expect(recovering(40, null)).toBe(false);
    expect(recovering(6144, false)).toBe(false);
    const w = createReadyWatch(0);
    w.phase({ phase: "database", walMb: 6144, recovery: true }, 0);
    w.phase({ phase: "migrations" }, 1_000);
    expect(w.recovering).toBe(false);
    expect(closeQuestion("database", true)).toEqual({ message: CLOSE_TEXT.database.message, detail: CLOSE_TEXT.database.recovery });
    expect(closeQuestion("database", false)).toEqual({ message: CLOSE_TEXT.database.message, detail: CLOSE_TEXT.database.otherwise });
    expect(closeQuestion("migrations", true)).toEqual(CLOSE_TEXT.migrations);
  });

  it("knows a restore's open from the phase, and never says a restore cut short is done again", () => {
    const w = createReadyWatch(0);
    expect(w.restoring).toBe(false);
    w.phase({ phase: "database", walMb: 0, recovery: null, restore: true }, 0);
    expect(w.restoring).toBe(true);
    expect(w.recovering).toBe(false);
    w.phase({ phase: "migrations" }, 1_000);
    expect(w.restoring).toBe(false);
    const open = createReadyWatch(0);
    open.phase({ phase: "database", walMb: 40, recovery: true }, 0);
    expect(open.restoring).toBe(false);
    // the takePendingRestore of src/desktop/backup.ts has dropped the marker and set the folder aside: nothing is redone,
    // and the next start puts that folder back (restore.running): the database from before the restore, never none
    expect(closeQuestion("database", false, true)).toEqual(CLOSE_TEXT.restore);
    expect(CLOSE_TEXT.restore.detail).not.toContain("از نو انجام می‌شود");
    expect(CLOSE_TEXT.restore.detail).toContain("با پایگاه دادهٔ پیشین باز می‌شود");
    expect(CLOSE_TEXT.restore.detail).not.toContain("بی‌داده");
    expect(closeQuestion("migrations", false, true)).toEqual(CLOSE_TEXT.migrations);
  });

  it("counts every migration and schema step the server's output reports as progress", () => {
    expect(countProgress("[itsm] migration 0100_xid_revisions applied (249 ms)\n")).toBe(1);
    // the engine's chunks and every reconcile chunk are logged as schema steps (src/server/db/migrate.ts)
    expect(countProgress("[itsm] schema step reconcile:3 applied (12 ms)\n[itsm] schema step engine:2 applied (40 ms)\n[itsm] migration 0104_ci_identity_indexes applied (11 ms)\n")).toBe(3);
    expect(countProgress("[itsm] schema step init applied (900 ms)")).toBe(1);
    expect(countProgress("[itsm] engine schema reconciled\n[itsm] database opened in 300 ms\n[itsm] opening the database: write-ahead log 12 MB; closed cleanly (state 1)\n")).toBe(0);
  });

  it("reads the server's phase messages and nothing else", () => {
    expect(parseStartPhase({ type: "phase", phase: "database", walMb: 3204.4, recovery: true })).toEqual({ phase: "database", walMb: 3204, recovery: true });
    expect(parseStartPhase({ type: "phase", phase: "database", walMb: 12 })).toEqual({ phase: "database", walMb: 12, recovery: null });
    expect(parseStartPhase({ type: "phase", phase: "database", walMb: "a lot", recovery: "yes" })).toEqual({ phase: "database", walMb: 0, recovery: null });
    expect(parseStartPhase({ type: "phase", phase: "database", walMb: 0, recovery: null, restore: true })).toStrictEqual({ phase: "database", walMb: 0, recovery: null, restore: true });
    expect(parseStartPhase({ type: "phase", phase: "database", walMb: 0, recovery: null, restore: "yes" })).toStrictEqual({ phase: "database", walMb: 0, recovery: null });
    expect(parseStartPhase({ type: "phase", phase: "migrations" })).toEqual({ phase: "migrations" });
    for (const m of [null, "phase", { type: "ready", url: "http://127.0.0.1:3939" }, { type: "phase", phase: "elsewhere" }]) expect(parseStartPhase(m)).toBeNull();
  });

  it("says it in Persian, with the time gone by in Persian digits", () => {
    expect(elapsedFa(0)).toBe("۰:۰۰");
    expect(elapsedFa(8_400)).toBe("۰:۰۸");
    expect(elapsedFa(12 * MIN + 34_000)).toBe("۱۲:۳۴");
    expect(elapsedFa(HOUR + 2 * MIN + 5_000)).toBe("۱:۰۲:۰۵");
    expect(noticeTexts({ kind: "recovery", elapsedMs: 125_000 }, "باز کردن داده‌ها…")).toEqual({ note: NOTICE_TEXT.recovery, status: "بازیابی پایگاه داده… ۲:۰۵" });
    expect(noticeTexts({ kind: "slow", elapsedMs: 9_000 }, "بازگردانی نسخهٔ پشتیبان…")).toEqual({ note: NOTICE_TEXT.slow, status: "بازگردانی نسخهٔ پشتیبان… ۰:۰۹" });
    expect(NOTICE_TEXT.recovery).toContain("لطفاً برنامه را نبندید");
    // the questions name their own budgets
    expect(STALL_TEXT.starting.detail.startsWith("۹۰ ثانیه")).toBe(true);
    expect(STALL_TEXT.migrations.detail.startsWith("۳۰ دقیقه")).toBe(true);
    expect(STALL_BUTTONS).toEqual(["صبر می‌کنم", "اجرای دوباره", "خروج"]);
    expect(CLOSE_BUTTONS).toEqual(["صبر می‌کنم", "بستن برنامه"]);
  });
});

describe("the splash's note (desktop/src/splash.html)", () => {
  it("takes the tagline's place while there is something to tell, and gives it back", () => {
    const html = readFileSync(join(__dirname, "..", "desktop", "src", "splash.html"), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const el = () => ({ textContent: "", style: { setProperty() {} } });
    const ids: Record<string, ReturnType<typeof el>> = { name: el(), tagline: el(), status: el(), ver: el(), note: el() };
    const classes = new Set<string>();
    const body = { classList: { add: (c: string) => classes.add(c), toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } };
    const document = { documentElement: el(), body, title: "", getElementById: (id: string) => ids[id], querySelectorAll: () => [] };
    const window: Record<string, any> = {};
    runInNewContext(script, { window, document, location: { search: "?name=x", hash: "" }, URLSearchParams, performance, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, Math });
    expect(html).toContain('<p class="note" id="note"');
    window.itsm.note(NOTICE_TEXT.recovery);
    expect(ids.note.textContent).toBe(NOTICE_TEXT.recovery);
    expect(classes.has("noted")).toBe(true);
    window.itsm.status("بازیابی پایگاه داده… ۲:۰۵");
    expect(ids.status.textContent).toBe("بازیابی پایگاه داده… ۲:۰۵");
    window.itsm.note("");
    expect(ids.note.textContent).toBe("");
    expect(classes.has("noted")).toBe(false);
  });
});

// ------------------------------------------------------------------ the Electron main process, faked

const h = vi.hoisted(() => ({
  children: [] as any[],
  windows: [] as any[],
  /** every message box: its options, its parent window (null for none), whether its signal closed it, and the answer */
  dialogs: [] as { opts: any; parent: unknown; aborted: boolean; answer: (response: number) => void }[],
  exits: [] as number[],
  relaunched: 0,
  appHandlers: new Map<string, ((...a: unknown[]) => unknown)[]>(),
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  /** The local server's utility process: messages and output are emitted by the test; a kill exits with 0, as on Windows. */
  class Child extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    posted: unknown[] = [];
    killed = false;
    postMessage(m: unknown) {
      this.posted.push(m);
    }
    kill() {
      if (this.killed) return false;
      this.killed = true;
      queueMicrotask(() => this.emit("exit", 0));
      return true;
    }
  }
  class WebContents extends EventEmitter {
    scripts: string[] = [];
    async executeJavaScript(js: string) {
      this.scripts.push(js);
      return true;
    }
    setWindowOpenHandler() {}
    reload() {}
  }
  class BrowserWindow extends EventEmitter {
    webContents = new WebContents();
    destroyed = false;
    url: string | null = null;
    constructor(public opts: unknown) {
      super();
      h.windows.push(this);
    }
    static fromWebContents() {
      return null;
    }
    loadURL(u: string) {
      this.url = u;
      queueMicrotask(() => this.webContents.emit("did-finish-load"));
    }
    loadFile() {
      queueMicrotask(() => this.webContents.emit("did-finish-load"));
    }
    setMenu() {}
    show() {}
    hide() {}
    focus() {}
    maximize() {}
    setBackgroundColor() {}
    isDestroyed() {
      return this.destroyed;
    }
    /** The close button, Alt+F4 or the taskbar's close: 'close' first, which may prevent it, then the window goes. */
    close() {
      if (this.destroyed) return;
      let prevented = false;
      this.emit("close", { preventDefault: () => (prevented = true) });
      if (!prevented) this.destroy();
    }
    /** Electron's destroy(): no 'close', only 'closed'. */
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit("closed");
      // the last window gone: Electron's app emits window-all-closed
      if (h.windows.every((w) => w.destroyed)) for (const fn of h.appHandlers.get("window-all-closed") ?? []) fn();
    }
  }
  const app = {
    getPath: (name: string) => (name === "appData" ? join(tmpdir(), "AppData", "Roaming") : tmpdir()),
    setPath() {},
    getVersion: () => "1.1.2",
    requestSingleInstanceLock: () => true,
    setAppUserModelId() {},
    on(ev: string, fn: (...a: unknown[]) => unknown) {
      if (!h.appHandlers.has(ev)) h.appHandlers.set(ev, []);
      h.appHandlers.get(ev)!.push(fn);
      return app;
    },
    whenReady: () => Promise.resolve(),
    relaunch() {
      h.relaunched++;
    },
    exit(code: number) {
      h.exits.push(code);
    },
    quit() {},
  };
  const electron = {
    app,
    BrowserWindow,
    utilityProcess: {
      fork() {
        const c = new Child();
        h.children.push(c);
        return c;
      },
    },
    ipcMain: { handle() {}, on() {} },
    shell: { openExternal: async () => {}, openPath: async () => "" },
    dialog: {
      // (window, options) or (options), as Electron takes them; an aborted signal closes the box as Esc would (cancelId)
      showMessageBox: (a: unknown, b?: unknown) =>
        new Promise((resolve) => {
          const opts = (b ?? a) as { signal?: AbortSignal; cancelId?: number };
          let answered = false;
          const d = {
            opts,
            parent: b === undefined ? null : a,
            aborted: false,
            answer: (response: number) => {
              if (answered) return;
              answered = true;
              resolve({ response, checkboxChecked: false });
            },
          };
          h.dialogs.push(d);
          const abort = () => {
            if (answered) return;
            d.aborted = true;
            d.answer(opts.cancelId ?? 0);
          };
          if (opts.signal?.aborted) abort();
          else opts.signal?.addEventListener("abort", abort, { once: true });
        }),
      showSaveDialog: async () => ({ canceled: true }),
    },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
    Tray: class {},
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    nativeTheme: { shouldUseDarkColors: false, themeSource: "system" },
  };
  return { ...electron, default: electron };
});

const MAIN = "../desktop/src/main.ts";
/** A turn of the event loop (setImmediate is not faked): promises and microtasks settle. */
const flush = () => new Promise<void>((r) => setImmediate(r));
let dataDir = "";
const appLog = () => readFileSync(join(dataDir, "logs", "app.log"), "utf8");
const READY = { type: "ready", url: "http://127.0.0.1:3939", port: 3939, host: "127.0.0.1" };

/**
 * Starts desktop/src/main.ts anew (local mode) on a fake clock — timers, Date and performance (the start's monotonic
 * clock) —; resolves with the server's fake process and the splash. `restore`: a restore of a backup scheduled in
 * Settings (restore.pending names the backup), which the server begins right after its first phase.
 */
async function launch(env: Record<string, string> = {}, opts: { restore?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  vi.resetModules();
  h.children.length = 0;
  h.windows.length = 0;
  h.dialogs.length = 0;
  h.exits.length = 0;
  h.relaunched = 0;
  h.appHandlers.clear();
  dataDir = mkdtempSync(join(tmpdir(), "itsm-ready-"));
  // a later start (a database folder exists): the splash begins with «باز کردن داده‌ها…»
  mkdirSync(join(dataDir, "db"));
  if (opts.restore) writeFileSync(join(dataDir, "restore.pending"), join(dataDir, "backups", "itsm-manual-20261121-101010.tar.gz"), "utf8");
  process.env.ITSM_DATA_DIR = dataDir;
  Object.assign(process.env, env);
  await import(/* @vite-ignore */ MAIN);
  for (let i = 0; i < 100 && !h.children.length; i++) await flush();
  expect(h.children).toHaveLength(1);
  await flush();
  return { child: h.children[0], splash: h.windows[0] };
}

/** The last argument the splash got through `itsm.<fn>(…)`. */
function lastCall(w: { webContents: { scripts: string[] } }, fn: string): unknown {
  const prefix = `itsm.${fn}(`;
  const js = w.webContents.scripts.filter((s) => s.startsWith(prefix)).at(-1);
  return js === undefined ? undefined : JSON.parse(js.slice(prefix.length, -1));
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.ITSM_DATA_DIR;
  delete process.env.ITSM_SMOKE;
  delete process.env.ITSM_SMOKE_OUT;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

describe("the Windows app's main process waits for its local server by phase (desktop/src/main.ts)", () => {
  it("waits out a recovery of the database far longer than 90 s and tells the person, then opens the app", async () => {
    const { child, splash } = await launch();
    child.stdout.emit("data", "[itsm] opening the database: write-ahead log 6144 MB; not closed cleanly (state 6), so its log is replayed first\n");
    child.emit("message", { type: "phase", phase: "database", walMb: 6144, recovery: true });
    await flush();
    // a large log to replay: the note is there at once
    expect(lastCall(splash, "note")).toBe(NOTICE_TEXT.recovery);
    // the fixed timer killed the server here, 90 s after it started
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(h.dialogs).toEqual([]);
    expect(h.exits).toEqual([]);
    expect(child.killed).toBe(false);
    expect(child.posted).toEqual([]);
    expect(lastCall(splash, "status")).toBe(`بازیابی پایگاه داده… ${elapsedFa(20 * MIN)}`);
    // the database is open: the note goes; the migrations are waited out too
    child.emit("message", { type: "phase", phase: "migrations" });
    await flush();
    expect(lastCall(splash, "note")).toBe("");
    await vi.advanceTimersByTimeAsync(60_000);
    child.stdout.emit("data", "[itsm] migration 0105_later applied\n");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.dialogs).toEqual([]);
    child.emit("message", READY);
    await flush();
    expect(h.windows.map((w) => w.url)).toContain("http://127.0.0.1:3939");
    expect(h.dialogs).toEqual([]);
    expect(h.exits).toEqual([]);
    const log = appLog();
    expect(log).toContain("[server] [itsm] opening the database: write-ahead log 6144 MB");
    expect(log).toMatch(/\[start\] the local server is still opening the database \(recovery, 0 s so far\)/);
  });

  it("asks after 90 s without a word, decides nothing behind the question, waits 90 s more on «صبر می‌کنم» and stops on «خروج»", async () => {
    const { child, splash } = await launch();
    await vi.advanceTimersByTimeAsync(READY_BUDGET_MS - 1_000);
    expect(h.dialogs).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.dialogs).toHaveLength(1);
    const q = h.dialogs[0];
    // owned by the splash: it stays above it, and the splash cannot be closed behind it
    expect(q.parent).toBe(splash);
    expect(q.opts.message).toBe(STALL_TEXT.starting.message);
    expect(q.opts.detail).toBe(`${STALL_TEXT.starting.detail}\n\nگزارش: ${join(dataDir, "logs", "app.log")}`);
    expect(q.opts.buttons).toEqual([...STALL_BUTTONS]);
    expect(q.opts.cancelId).toBe(0);
    // the old fixed limit stopped the server here; now nothing happens behind the question, however long it stays up
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(h.dialogs).toHaveLength(1);
    expect(child.posted).toEqual([]);
    expect(child.killed).toBe(false);
    expect(h.exits).toEqual([]);
    q.answer(0); // «صبر می‌کنم»
    await flush();
    expect(child.posted).toEqual([]);
    // another 90 s without a word from the answer on: asked again
    await vi.advanceTimersByTimeAsync(READY_BUDGET_MS - 1_000);
    expect(h.dialogs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.dialogs).toHaveLength(2);
    h.dialogs[1].answer(2); // «خروج»
    await flush();
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    // before its first phase the server cannot hear that and has opened nothing yet: it is killed at once
    expect(child.killed).toBe(true);
    await flush();
    expect(h.exits).toEqual([1]);
    expect(h.relaunched).toBe(0);
    // the answer was the person's last word: no second dialog after it
    expect(h.dialogs).toHaveLength(2);
    const log = appLog();
    expect(log).toMatch(/\[start\] no sign of the local server for 90 s \(starting\): asking whether to wait/);
    expect(log).toContain("[start] the person waits on");
  });

  it("runs the app again on «اجرای دوباره», with no second dialog", async () => {
    const { child } = await launch();
    await vi.advanceTimersByTimeAsync(READY_BUDGET_MS + 1_000);
    expect(h.dialogs).toHaveLength(1);
    h.dialogs[0].answer(1); // «اجرای دوباره»
    await flush();
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    expect(child.killed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(h.relaunched).toBe(1);
    expect(h.exits).toEqual([1]);
    expect(h.dialogs).toHaveLength(1);
  });

  it("withdraws the question when the server reports its database's open late, and never stops the replay that follows", async () => {
    const { child, splash } = await launch();
    // a slow load of the server's code (a cold disk, an antivirus scan): no word for 91 s
    await vi.advanceTimersByTimeAsync(READY_BUDGET_MS + 1_000);
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].opts.message).toBe(STALL_TEXT.starting.message);
    // then the open of a database with a large log begins: the question goes, and the start goes on
    child.emit("message", { type: "phase", phase: "database", walMb: 6144, recovery: true });
    await flush();
    expect(h.dialogs[0].aborted).toBe(true);
    expect(lastCall(splash, "note")).toBe(NOTICE_TEXT.recovery);
    // the replay takes its time: the server is never told to stop nor killed, and nothing more is asked
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(h.dialogs).toHaveLength(1);
    expect(child.posted).toEqual([]);
    expect(child.killed).toBe(false);
    expect(h.exits).toEqual([]);
    child.emit("message", { type: "phase", phase: "migrations" });
    child.emit("message", READY);
    await flush();
    expect(h.windows.map((w) => w.url)).toContain("http://127.0.0.1:3939");
    expect(h.dialogs).toHaveLength(1);
    expect(h.exits).toEqual([]);
    expect(appLog()).toContain("[start] the local server spoke again (database): the question is withdrawn");
  });

  it("keeps the start's time on a monotonic clock: a step of the system clock ahead neither asks nor stops anything", async () => {
    const { child } = await launch();
    await vi.advanceTimersByTimeAsync(2_000);
    // Windows Time corrects a drifted clock: Date jumps 100 s ahead while no timer runs
    vi.setSystemTime(Date.now() + 100_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.dialogs).toEqual([]);
    // the same during the migrations, by more than their 30 minutes
    child.emit("message", { type: "phase", phase: "database", walMb: 12, recovery: false });
    child.emit("message", { type: "phase", phase: "migrations" });
    await vi.advanceTimersByTimeAsync(5_000);
    vi.setSystemTime(Date.now() + 31 * MIN);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.dialogs).toEqual([]);
    expect(child.posted).toEqual([]);
    expect(child.killed).toBe(false);
    expect(h.exits).toEqual([]);
    child.emit("message", READY);
    await flush();
    expect(h.windows.map((w) => w.url)).toContain("http://127.0.0.1:3939");
  });

  it("does not stretch the 90 s when the system clock steps back", async () => {
    await launch();
    await vi.advanceTimersByTimeAsync(2_000);
    vi.setSystemTime(Date.now() - HOUR);
    await vi.advanceTimersByTimeAsync(READY_BUDGET_MS - 3_000);
    expect(h.dialogs).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].opts.message).toBe(STALL_TEXT.starting.message);
  });

  it("counts the engine's schema steps as progress: a long reconcile of many steps is never taken for a stall", async () => {
    const { child, splash } = await launch();
    child.emit("message", { type: "phase", phase: "database", walMb: 12, recovery: false });
    child.emit("message", { type: "phase", phase: "migrations" });
    for (let i = 0; i < 31; i++) {
      await vi.advanceTimersByTimeAsync(MIN);
      child.stdout.emit("data", `[itsm] schema step reconcile:${i} applied (12 ms)\n`);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.dialogs).toEqual([]);
    expect(child.killed).toBe(false);
    // the splash moves on with them, below the part kept for the window
    expect(splash.webContents.scripts).toContain(`itsm.step(0.6, 0.64, ${JSON.stringify("به‌روزرسانی داده‌ها…")}, 1.5)`);
    expect(splash.webContents.scripts.filter((s: string) => /^itsm\.step\(0\.(6[1-9]|[7-9])/.test(s))).toEqual([]);
  });

  it("waits out a long migration after the open with a note, and asks only after 30 minutes without a sign", async () => {
    const { child, splash } = await launch();
    child.emit("message", { type: "phase", phase: "database", walMb: 12, recovery: false });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    // a clean database that takes long to open (a slow disk): told as such, never as a recovery
    expect(lastCall(splash, "note")).toBe(NOTICE_TEXT.slow);
    expect(lastCall(splash, "status")).toBe(`باز کردن داده‌ها… ${elapsedFa(3 * MIN)}`);
    child.emit("message", { type: "phase", phase: "migrations" });
    // the fixed 90 s once killed a migration over a large table here, and it started over at every start
    await vi.advanceTimersByTimeAsync(READY_BUDGET_MS + 1_000);
    expect(h.dialogs).toEqual([]);
    expect(child.killed).toBe(false);
    expect(lastCall(splash, "note")).toBe(NOTICE_TEXT.update);
    await vi.advanceTimersByTimeAsync(MIGRATIONS_CEILING_MS);
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].parent).toBe(splash);
    expect(h.dialogs[0].opts.message).toBe(STALL_TEXT.migrations.message);
    expect(h.dialogs[0].opts.detail).toContain(STALL_TEXT.migrations.detail);
    expect(h.dialogs[0].opts.buttons).toEqual([...STALL_BUTTONS]);
    // the migration finishes after all: the server spoke again, the question goes and the start goes on
    child.stdout.emit("data", "[itsm] migration 0103_jobs_failed_idx applied (1890000 ms)\n");
    await flush();
    expect(h.dialogs[0].aborted).toBe(true);
    child.emit("message", READY);
    await flush();
    expect(h.windows.map((w) => w.url)).toContain("http://127.0.0.1:3939");
    expect(child.posted).toEqual([]);
    expect(h.exits).toEqual([]);
    expect(h.dialogs).toHaveLength(1);
    expect(appLog()).toContain("[start] the local server spoke again (migrations): the question is withdrawn");
  });

  it("asks before the splash closes while the database opens, and stops the server only when the person says so", async () => {
    const { child, splash } = await launch();
    child.emit("message", { type: "phase", phase: "database", walMb: 6144, recovery: true });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    // the taskbar's close or Alt+F4 in the middle of a recovery
    splash.close();
    await flush();
    expect(splash.destroyed).toBe(false);
    expect(h.dialogs).toHaveLength(1);
    const q = h.dialogs[0];
    expect(q.parent).toBe(splash);
    expect(q.opts.message).toBe(CLOSE_TEXT.database.message);
    expect(q.opts.detail).toBe(CLOSE_TEXT.database.recovery);
    expect(q.opts.buttons).toEqual([...CLOSE_BUTTONS]);
    expect(q.opts.cancelId).toBe(0);
    // another close while the question is up asks nothing more
    splash.close();
    await flush();
    expect(h.dialogs).toHaveLength(1);
    q.answer(0); // «صبر می‌کنم»
    await flush();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(splash.destroyed).toBe(false);
    expect(child.posted).toEqual([]);
    expect(child.killed).toBe(false);
    expect(h.exits).toEqual([]);
    // closed again, and this time «بستن برنامه»: the server is asked to stop and, unable to hear it yet, killed 10 s later
    splash.close();
    await flush();
    expect(h.dialogs).toHaveLength(2);
    h.dialogs[1].answer(1);
    await flush();
    expect(splash.destroyed).toBe(true);
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.killed).toBe(true);
    await flush();
    expect(h.exits).toEqual([0]);
    // the person's choice: no error dialog for the server's exit after it
    expect(h.dialogs).toHaveLength(2);
    expect(appLog()).toContain("[start] the person closed the splash during the database's open: the server is stopped");
  });

  it("asks before the splash closes during the migrations too, and a ready server withdraws the question", async () => {
    const { child, splash } = await launch();
    child.emit("message", { type: "phase", phase: "database", walMb: 12, recovery: false });
    child.emit("message", { type: "phase", phase: "migrations" });
    await vi.advanceTimersByTimeAsync(MIN);
    splash.close();
    await flush();
    expect(splash.destroyed).toBe(false);
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].opts).toMatchObject({ message: CLOSE_TEXT.migrations.message, detail: CLOSE_TEXT.migrations.detail });
    child.emit("message", READY);
    await flush();
    expect(h.dialogs[0].aborted).toBe(true);
    expect(h.windows.map((w) => w.url)).toContain("http://127.0.0.1:3939");
    expect(child.posted).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it("opens no window once the person has closed the app, when the server gets ready within the 10 s it is given", async () => {
    const { child, splash } = await launch();
    child.emit("message", { type: "phase", phase: "database", walMb: 12, recovery: false });
    child.emit("message", { type: "phase", phase: "migrations" });
    await vi.advanceTimersByTimeAsync(MIN);
    splash.close();
    await flush();
    h.dialogs[0].answer(1); // «بستن برنامه»
    await flush();
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    // the last migration finishes meanwhile: the server is ready (and then reads the shutdown it was sent)
    child.emit("message", READY);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(h.windows.filter((w) => w !== splash)).toEqual([]);
    expect(h.exits).toEqual([0]);
  });

  it("does not say a restore of a backup is done again when the splash closes during it", async () => {
    const { child, splash } = await launch();
    // the server's phase of a scheduled restore (src/desktop/server.ts): its backup is extracted and opened now
    child.emit("message", { type: "phase", phase: "database", walMb: 0, recovery: null, restore: true });
    await vi.advanceTimersByTimeAsync(40_000);
    splash.close();
    await flush();
    expect(splash.destroyed).toBe(false);
    expect(h.dialogs).toHaveLength(1);
    // takePendingRestore has dropped the marker and set the database folder aside: a restore cut short is not redone —
    // the next start puts that folder back (restore.running) —, so the open's «از نو انجام می‌شود» would be untrue
    expect(h.dialogs[0].opts).toMatchObject({ message: CLOSE_TEXT.restore.message, detail: CLOSE_TEXT.restore.detail, buttons: [...CLOSE_BUTTONS], cancelId: 0 });
    h.dialogs[0].answer(0);
    await flush();
    expect(child.posted).toEqual([]);
    expect(appLog()).toContain("[start] the person closes the splash during the database's restore: asking first");
  });

  it("asks nothing when the splash closes before the open: the app quits, and the server, which has opened nothing, at once", async () => {
    const { child, splash } = await launch();
    await vi.advanceTimersByTimeAsync(5_000);
    splash.close();
    await flush();
    expect(splash.destroyed).toBe(true);
    expect(h.dialogs).toEqual([]);
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    expect(child.killed).toBe(true);
    await flush();
    expect(h.exits).toEqual([0]);
    expect(h.dialogs).toEqual([]);
  });

  // Before its first phase the server cannot hear a request to stop (backend-entry.ts listens once it is ready) and has
  // written nothing but config.json; right after it, a scheduled restore drops its marker and sets the database folder
  // aside. Killed 10 s after the request, as 1.1.3 did, it had the time to begin the restore and was cut in its middle:
  // the next start opened an empty database or half of one, with no question asked (DESKTOP-1 of the 1.1.4 review).
  it("stops the server at once when the splash closes before its first phase, a scheduled restore never begun", async () => {
    const { child, splash } = await launch({}, { restore: true });
    await vi.advanceTimersByTimeAsync(800);
    splash.close();
    await flush();
    expect(h.dialogs).toEqual([]);
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    expect(child.killed).toBe(true);
    await flush();
    expect(h.exits).toEqual([0]);
  });

  it("stops the server at once on «خروج» to the 90 s question before its first phase, too", async () => {
    const { child } = await launch({}, { restore: true });
    await vi.advanceTimersByTimeAsync(READY_BUDGET_MS + 1_000);
    expect(h.dialogs).toHaveLength(1);
    h.dialogs[0].answer(2); // «خروج»
    await flush();
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    expect(child.killed).toBe(true);
    await flush();
    expect(h.exits).toEqual([1]);
  });

  it("still gives the server its 10 s on «بستن برنامه» once the restore's open has begun", async () => {
    const { child, splash } = await launch({}, { restore: true });
    child.emit("message", { type: "phase", phase: "database", walMb: 0, recovery: null, restore: true });
    await vi.advanceTimersByTimeAsync(5_000);
    splash.close();
    await flush();
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].opts.message).toBe(CLOSE_TEXT.restore.message);
    h.dialogs[0].answer(1); // «بستن برنامه»
    await flush();
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    expect(child.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(child.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.killed).toBe(true);
    await flush();
    expect(h.exits).toEqual([0]);
  });

  it("fails the smoke test (CI, nobody to answer) after 90 s without a word instead of asking", async () => {
    const out = join(tmpdir(), `itsm-smoke-${process.pid}-${Date.now()}.json`);
    try {
      await launch({ ITSM_SMOKE: "1", ITSM_SMOKE_OUT: out });
      await vi.advanceTimersByTimeAsync(READY_BUDGET_MS + 1_000);
      await flush();
      expect(h.dialogs).toEqual([]);
      expect(h.exits).toEqual([1]);
      expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({ ok: false, error: expect.stringContaining("سرور محلی در زمان مقرر آماده نشد") });
    } finally {
      if (existsSync(out)) rmSync(out);
    }
  });

  it("reports a server that stops while it opens the database once, at once, and can run the app again", async () => {
    const { child } = await launch();
    child.emit("message", { type: "phase", phase: "database", walMb: 3204, recovery: true });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(h.dialogs).toEqual([]);
    child.emit("exit", 3);
    await flush();
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].opts.message).toBe("اجرای برنامه ممکن نشد");
    expect(h.dialogs[0].opts.detail).toContain("سرور داخلی برنامه پیش از آماده شدن متوقف شد (کد خروج ۳)");
    expect(h.dialogs[0].opts.buttons).toEqual(["اجرای دوباره", "خروج"]);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(h.dialogs).toHaveLength(1);
    h.dialogs[0].answer(0); // «اجرای دوباره»
    await flush();
    expect(h.relaunched).toBe(1);
    expect(h.exits).toEqual([1]);
  });

  it("reports the server's own error as before, and its exit after it adds nothing", async () => {
    const { child } = await launch();
    child.emit("message", { type: "phase", phase: "database", walMb: 0, recovery: null });
    child.emit("message", { type: "error", message: "migration 0101_x failed: disk full" });
    await flush();
    child.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].opts.detail).toContain("migration 0101_x failed: disk full");
    h.dialogs[0].answer(1);
    await flush();
    expect(h.exits).toEqual([1]);
    expect(h.relaunched).toBe(0);
  });
});
