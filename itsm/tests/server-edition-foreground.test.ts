// The server edition's job runner gives way to the requests people wait for, across the cluster (src/server-edition/
// foreground.ts): each worker counts its foreground API requests (the screens' polling aside) and tells the supervisor
// when it starts and stops having any; the supervisor tells every worker whether any worker has; the scheduler leader's
// runner waits for them before each round of jobs (TickOptions.busy) — at most YIELD_MS each time, so it never starves.
// Background: the administrator's demo incident record in bank-sim while the demo pack's backlog drained (PERFORMANCE_FA §18).
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { ForegroundBoard, ForegroundGate, FOREGROUND_LINGER_MS } from "../src/server-edition/foreground";
import { createFront } from "../src/server-edition/front";
import { createStaticSite } from "../src/server-edition/static";
import { WorkerMetrics } from "../src/server-edition/metrics";
import { defaultConfig } from "../src/server-edition/config";
import { enqueue, registerJobHandler, tick, YIELD_MS } from "@server/jobs";
import type { ServerConfig } from "@server/context";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";

const temps: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("ForegroundGate: one worker's requests a person waits for", () => {
  it("reports the first request at once, stays busy for the linger after the last, and reports once per change", () => {
    vi.useFakeTimers();
    const said: boolean[] = [];
    const g = new ForegroundGate((on) => said.push(on));
    expect(g.busy()).toBe(false);
    g.started();
    g.started();
    expect(said).toEqual([true]);
    expect(g.busy()).toBe(true);
    g.ended();
    expect(g.busy()).toBe(true);
    g.ended();
    // the gaps between a page's waves of requests: still busy, nothing told yet
    expect(g.inFlight).toBe(0);
    expect(g.busy()).toBe(true);
    vi.advanceTimersByTime(FOREGROUND_LINGER_MS - 10);
    expect(said).toEqual([true]);
    // a new request within the linger keeps the worker busy without a word to the supervisor
    g.started();
    vi.advanceTimersByTime(FOREGROUND_LINGER_MS * 2);
    expect(said).toEqual([true]);
    g.ended();
    vi.advanceTimersByTime(FOREGROUND_LINGER_MS + 1);
    expect(said).toEqual([true, false]);
    expect(g.busy()).toBe(false);
    // the supervisor says another worker has requests in flight
    g.setCluster(true);
    expect(g.busy()).toBe(true);
    g.setCluster(false);
    expect(g.busy()).toBe(false);
    // an extra end never goes below zero
    g.ended();
    expect(g.inFlight).toBe(0);
    g.close();
  });

  it("works without a supervisor (a standalone server)", () => {
    vi.useFakeTimers();
    const g = new ForegroundGate();
    g.started();
    expect(g.busy()).toBe(true);
    g.ended();
    vi.advanceTimersByTime(FOREGROUND_LINGER_MS + 1);
    expect(g.busy()).toBe(false);
  });
});

describe("ForegroundBoard: the supervisor's view of the workers", () => {
  it("tells the workers only when the cluster's state changes, and forgets a worker that exited", () => {
    const b = new ForegroundBoard();
    expect(b.any).toBe(false);
    expect(b.set(1, true)).toBe(true);
    expect(b.set(2, true)).toBeNull();
    expect(b.set(1, false)).toBeNull();
    expect(b.any).toBe(true);
    expect(b.set(2, false)).toBe(false);
    expect(b.set(2, false)).toBeNull();
    expect(b.set(3, true)).toBe(true);
    // a worker that crashed while busy no longer holds the jobs back
    expect(b.gone(3)).toBe(false);
    expect(b.any).toBe(false);
  });
});

describe("the front counts the API requests a person waits for", () => {
  const makeFront = (foreground: { started(): void; ended(): void }) => {
    const site = mkdtempSync(join(tmpdir(), "itsm-srv-fg-"));
    temps.push(site);
    writeFileSync(join(site, "index.html"), "<!doctype html><title>Kariz</title>");
    const api = new Hono().basePath("/api");
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    api.get("/o/:org/r/incident", (c) => c.json({ rows: [] }));
    api.get("/o/:org/pulse", (c) => c.json({ rev: 1 }));
    api.get("/o/:org/slow", async (c) => {
      await held;
      return c.json({ ok: true });
    });
    const c = defaultConfig(mkdtempSync(join(tmpdir(), "itsm-srv-fg-data-")));
    temps.push(c.dirs.data);
    const metrics = new WorkerMetrics(1, 10, 1500);
    const front = createFront({
      api,
      config: () => c,
      site: createStaticSite(site, () => ""),
      metrics,
      log: quietLog,
      ready: async () => ({ ok: true, checks: { database: true } }),
      cluster: async () => ({ workers: [metrics.snapshot()], expected_workers: 1, restarts: 0, started_at: "" }),
      queue: async () => ({ due: 0, running: 0, failed_24h: 0 }),
      setup: new Hono().get("/state", (cc) => cc.json({ required: false })),
      setupRequired: async () => false,
      https: true,
      foreground,
    });
    return { front, release };
  };
  const org = "01a1d89c-0565-7025-ac20-8d3b6efa4b85";

  it("counts a record list, not the live pulse, a background timer, readiness or a static file", async () => {
    let started = 0;
    let ended = 0;
    const { front } = makeFront({ started: () => started++, ended: () => ended++ });
    await front.request(`https://k.local/api/o/${org}/r/incident`);
    expect([started, ended]).toEqual([1, 1]);
    await front.request(`https://k.local/api/o/${org}/pulse`);
    await front.request(`https://k.local/api/o/${org}/r/incident`, { headers: { "x-itsm-background": "1" } });
    await front.request("https://k.local/api/ready");
    await front.request("https://k.local/o/x/incidents");
    expect([started, ended]).toEqual([1, 1]);
  });

  it("holds the gate while a request is in flight and releases it when the answer is out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const gate = new ForegroundGate();
    const { front, release } = makeFront(gate);
    const pending = front.request(`https://k.local/api/o/${org}/slow`);
    await vi.waitFor(() => expect(gate.inFlight).toBe(1));
    expect(gate.busy()).toBe(true);
    release();
    expect((await pending).status).toBe(200);
    expect(gate.inFlight).toBe(0);
    vi.advanceTimersByTime(FOREGROUND_LINGER_MS + 1);
    expect(gate.busy()).toBe(false);
  });
});

describe("the scheduler leader's job runner gives way to a person's requests anywhere in the cluster", () => {
  it("starts no round of jobs while another worker answers a page, and runs them all once it is done", async () => {
    const s = await makeServer();
    const org = await signupWithOrg(new Client(s.app));
    const cfg: ServerConfig = { mode: "cloud", db: s.db, secret: "t", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    const starts: number[] = [];
    const off = registerJobHandler("test.fg", async () => void starts.push(Date.now()));
    // the leader's gate hears from the supervisor that another worker has a page's requests in flight
    const leader = new ForegroundGate(() => {}, 50);
    const board = new ForegroundBoard();
    const tellLeader = (busy: boolean | null) => busy !== null && leader.setCluster(busy);
    try {
      for (let n = 0; n < 6; n++) await enqueue(s.db, { kind: "test.fg", orgId: org, payload: { n } });
      tellLeader(board.set(2, true));
      const t0 = Date.now();
      setTimeout(() => tellLeader(board.set(2, false)), 150);
      const r = await tick(cfg, { budgetMs: 20_000, concurrency: 4, busy: leader.busy });
      expect(r.ran).toBe(6);
      expect(starts[0] - t0).toBeGreaterThanOrEqual(140);
      // a cluster that is never idle still gets every job done, a round after at most YIELD_MS of waiting each
      starts.length = 0;
      for (let n = 0; n < 6; n++) await enqueue(s.db, { kind: "test.fg", orgId: org, payload: { n: 10 + n } });
      tellLeader(board.set(3, true));
      const t1 = Date.now();
      const r2 = await tick(cfg, { budgetMs: 20_000, concurrency: 4, busy: leader.busy });
      expect(r2.ran).toBe(6);
      expect(starts[0] - t1).toBeGreaterThanOrEqual(YIELD_MS - 20);
      expect(starts[5] - t1).toBeLessThan(2 * YIELD_MS + 2_000);
      tellLeader(board.gone(3));
      expect(leader.busy()).toBe(false);
    } finally {
      off();
      leader.close();
      await s.db.close();
    }
  });

  it("is wired in the server edition: the front counts, the worker reports and passes busy, the supervisor relays", () => {
    const src = (f: string) => readFileSync(join(__dirname, "..", "src", "server-edition", f), "utf8");
    const worker = src("worker.ts");
    expect(worker).toMatch(/new ForegroundGate\(o\.ipc \? \(on\) => send\(\{ t: "fg", on \}\)/);
    expect(worker).toMatch(/tick\(cfg, \{ budgetMs: 20_000, concurrency: JOB_CONCURRENCY, .*, busy: foreground\.busy \}\)/);
    expect(worker).toMatch(/m\?\.t === "fg"\) foreground\.setCluster\(m\.busy === true\)/);
    expect(worker).toMatch(/foreground,\n\s+\}\);/);
    const front = src("front.ts");
    expect(front).toMatch(/if \(!d\.foreground \|\| isBackgroundRequest\(c\)\) return next\(\);/);
    const cluster = src("cluster.ts");
    expect(cluster).toMatch(/m\.t === "fg"\) foregroundChanged\(foreground\.set\(w\.id, m\.on === true\)\)/);
    expect(cluster).toMatch(/foregroundChanged\(foreground\.gone\(w\.id\)\)/);
  });
});
