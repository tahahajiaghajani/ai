// The server edition's job runner gives way to the requests people wait for, across the cluster (src/server-edition/
// foreground.ts): the API counts a signed-in browser session's requests (the screens' polling aside) in each worker's
// gate once their session is known — never machine traffic: the Windows apps' sync, token clients, monitoring probes or
// anyone not signed in —; each worker tells the supervisor when it starts and stops having any; the supervisor tells
// every worker whether any worker has; the scheduler leader's runner waits for them before each round of jobs
// (TickOptions.busy) — at most YIELD_MS each time, so it never starves. The Windows app's local server counts its own
// window's requests from the first byte and the office network's once signed in (src/desktop/server.ts).
// Background: the administrator's demo incident record in bank-sim while the demo pack's backlog drained (PERFORMANCE_FA §18).
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ForegroundBoard, ForegroundGate, FOREGROUND_LINGER_MS } from "../src/server-edition/foreground";
import { windowRequest } from "../src/desktop/server";
import { enqueue, registerJobHandler, tick, YIELD_MS } from "@server/jobs";
import { router, requireUser } from "@server/http/hono";
import type { ServerConfig } from "@server/context";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
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

describe("the API counts the requests a person waits for: signed-in browser sessions, never machine traffic", () => {
  /** cfg.foreground for a test: how many started and ended, and the most at once. */
  const counting = () => {
    const n = { started: 0, ended: 0, now: 0, most: 0 };
    const fg = {
      started: () => {
        n.started++;
        n.most = Math.max(n.most, ++n.now);
      },
      ended: () => {
        n.ended++;
        n.now--;
      },
    };
    return { n, fg };
  };
  /** A request as any client may send it; the status is returned, never asserted. */
  const send = async (app: { fetch(r: Request): Response | Promise<Response> }, path: string, headers: Record<string, string> = {}) => {
    const res = await app.fetch(new Request(`http://local.test/api${path}`, { headers }));
    await res.text();
    return res.status;
  };

  it("counts a person's pages, not a Windows app's sync, a token client, a probe, the screen's polling or anyone not signed in", async () => {
    const { n, fg } = counting();
    const s = await makeServer({ config: { foreground: fg } });
    try {
      const person = new Client(s.app);
      const org = await signupWithOrg(person);
      // a Windows app linked to the organisation signs in the way SyncClient does: a device session, a bearer token
      const login = await new Client(s.app).post<{ token: string }>("/auth/login", { email: "owner@example.com", password: "s3cret-pass", device: { name: "رایانهٔ شعبه", platform: "windows" } });
      expect(login.token).toBeTruthy();
      const bearer = { authorization: `Bearer ${login.token}` };

      // the person's requests count, each from its start to its answer
      let before = n.started;
      expect(await send(s.app, `/o/${org}`, { cookie: person.cookie })).toBe(200);
      expect(await send(s.app, "/meta", { cookie: person.cookie })).toBe(200);
      expect(await send(s.app, "/auth/me", { cookie: person.cookie })).toBe(200);
      expect(n.started - before).toBe(3);
      expect(n.ended).toBe(n.started);
      expect(n.now).toBe(0);

      before = n.started;
      // the Windows app's sync, every 30 s and after each local change (src/desktop/sync-client.ts)
      expect(await send(s.app, `/sync/status?org_id=${org}`, bearer)).toBe(200);
      await send(s.app, `/sync/pull?org_id=${org}&cursor=0&user_cursor=0&device_id=${randomUUID()}`, bearer);
      // the same token on the organisation's own routes
      await send(s.app, `/o/${org}`, bearer);
      // a token that also carries a browser's cookie is the token's session
      await send(s.app, `/o/${org}`, { ...bearer, cookie: person.cookie });
      // the screen's own polling: the live pulse and a refresh timer
      await send(s.app, `/o/${org}/pulse`, { cookie: person.cookie });
      await send(s.app, `/o/${org}`, { cookie: person.cookie, "x-itsm-background": "1" });
      // a monitoring probe, and anyone not signed in, with or without a made-up session
      expect(await send(s.app, "/health")).toBe(200);
      expect(await send(s.app, "/meta")).toBe(200);
      expect(await send(s.app, `/o/${org}`)).toBe(401);
      expect(await send(s.app, `/o/${org}`, { cookie: `itsm_session=${randomUUID()}.forged` })).toBe(401);
      expect(await send(s.app, `/o/${org}`, { authorization: `Bearer ${randomUUID()}.forged` })).toBe(401);
      expect(n.started).toBe(before);
    } finally {
      await s.db.close();
    }
  });

  it("holds the gate while the person's request runs and releases it when the answer is out; a token's never holds it", async () => {
    const s = await makeServer();
    const person = new Client(s.app);
    await signupWithOrg(person);
    const login = await new Client(s.app).post<{ token: string }>("/auth/login", { email: "owner@example.com", password: "s3cret-pass", device: { name: "رایانهٔ شعبه", platform: "windows" } });
    const gate = new ForegroundGate(() => {}, 30);
    const cfg: ServerConfig = { mode: "cloud", db: s.db, secret: "t", allowSignup: false, platformAdmins: [], origin: "cloud", log: quietLog, fetch, foreground: gate };
    let release = () => {};
    let held = new Promise<void>((r) => (release = r));
    let entered = 0;
    const api = router();
    api.use("*", async (c, next) => {
      c.set("cfg", cfg);
      await next();
    });
    api.get("/slow", requireUser, async (c) => {
      entered++;
      await held;
      return c.json({ ok: true });
    });
    try {
      const pending = api.request("/slow", { headers: { cookie: person.cookie } });
      await vi.waitFor(() => expect(gate.inFlight).toBe(1));
      expect(gate.busy()).toBe(true);
      release();
      expect((await pending).status).toBe(200);
      expect(gate.inFlight).toBe(0);
      await vi.waitFor(() => expect(gate.busy()).toBe(false));

      // the Windows app's token: the request runs, the gate stays open
      held = new Promise<void>((r) => (release = r));
      const sync = api.request("/slow", { headers: { authorization: `Bearer ${login.token}` } });
      await vi.waitFor(() => expect(entered).toBe(2));
      expect(gate.inFlight).toBe(0);
      expect(gate.busy()).toBe(false);
      release();
      expect((await sync).status).toBe(200);
    } finally {
      release();
      gate.close();
      await s.db.close();
    }
  });
});

describe("the Windows app's local server: its window counts from the first byte, the office network once signed in", () => {
  it("takes a request of this computer without a token for the window's", () => {
    expect(windowRequest("127.0.0.1", undefined)).toBe(true);
    expect(windowRequest("::1", undefined)).toBe(true);
    expect(windowRequest("::ffff:127.0.0.1", undefined)).toBe(true);
    // a token is never the window's: the Windows apps' sync and API clients send one
    expect(windowRequest("127.0.0.1", "Bearer 0193a0b2-0000-7000-8000-000000000000.x")).toBe(false);
    // the office network in LAN mode (counted once its browser session is known), and a request made inside the process
    expect(windowRequest("192.168.10.24", undefined)).toBe(false);
    expect(windowRequest("::ffff:10.0.0.5", undefined)).toBe(false);
    expect(windowRequest(undefined, undefined)).toBe(false);
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

  it("is wired: the API counts for the worker's gate, the worker reports and passes busy, the supervisor relays; the desktop counts its window", () => {
    const src = (f: string) => readFileSync(join(__dirname, "..", "src", f), "utf8");
    const worker = src("server-edition/worker.ts");
    expect(worker).toMatch(/new ForegroundGate\(o\.ipc \? \(on\) => send\(\{ t: "fg", on \}\)/);
    expect(worker).toMatch(/tick\(cfg, \{ budgetMs: 20_000, concurrency: JOB_CONCURRENCY, .*, busy: foreground\.busy \}\)/);
    expect(worker).toMatch(/m\?\.t === "fg"\) foreground\.setCluster\(m\.busy === true\)/);
    // the gate is the API's cfg.foreground (requireUser and optionalUser count once the session is known) …
    expect(worker).toMatch(/auth: authConfig\(current\),\n\s+foreground,\n/);
    expect(src("server/http/hono.ts")).toMatch(/if \(!fg \|\| session\.kind !== "web" \|\| isBackgroundRequest\(c\)\) return next\(\);/);
    // … not the front, where every probe, sync call and client not signed in would count
    expect(src("server-edition/front.ts")).not.toMatch(/foreground\.started|isBackgroundRequest|foreground\?:/);
    const cluster = src("server-edition/cluster.ts");
    expect(cluster).toMatch(/m\.t === "fg"\) foregroundChanged\(foreground\.set\(w\.id, m\.on === true\)\)/);
    expect(cluster).toMatch(/foregroundChanged\(foreground\.gone\(w\.id\)\)/);
    // the Windows app: its window's requests (windowRequest) and signed-in browsers of the office network (cfg.foreground)
    const desktop = src("desktop/server.ts");
    expect(desktop).toMatch(/foreground: \{ started: \(\) => void signedIn\+\+, ended: \(\) => void signedIn-- \}/);
    expect(desktop).toMatch(/busy: \(\) => fromWindow > 0 \|\| signedIn > 0/);
    expect(desktop).toMatch(/if \(isBackgroundRequest\(c\) \|\| !windowRequest\(peerOf\(c\), c\.req\.header\("authorization"\)\)\) return next\(\);\n\s+fromWindow\+\+;/);
  });
});
