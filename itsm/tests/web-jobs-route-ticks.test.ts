// The ticks single routes ask for after their answer on the web version (Kariz 1.1.4): a flow's webhook, the
// sign-in-free event ingest and its acknowledgement link, and the demo page's polling (cfg.waitUntil), and the platform
// console's «اجرای اکنون» (POST /api/admin/jobs/tick). Like the app's
// own request ticks (src/server/app.ts) they leave the deletion of finished jobs to GET /api/cron/tick: before, the
// first of them on an instance each hour spent up to 2 s of its 4 s budget deleting old jobs ahead of the alert or the
// flow run it was asked for.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { flowsKit, line, N } from "./flows-helpers";

describe("the ticks single routes ask for leave the cleanup to the cron", () => {
  let o: EngineOrg;
  const pending: Promise<unknown>[] = [];
  /** wait for the work handed to waitUntil (and the work that work handed on) */
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  const oldDone = async () => (await o.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where kind = 'test.old_done'`))!.n;

  beforeAll(async () => {
    o = await engineOrg({ config: { waitUntil: (work) => void pending.push(work()) } });
    await settle();
    // finished jobs past their retention: the cleanup of a tick that runs it deletes them
    await o.db.query(
      `insert into sm_jobs (id, kind, status, attempts, done_at) select gen_random_uuid(), 'test.old_done', 'done', 1, now() - interval '4 days' from generate_series(1, 50)`,
    );
  });

  it("the public event ingest", async () => {
    const row = (await o.owner.post(`/o/${o.org}/r/event_source`, { name: "پایش شبکه", kind: "generic" })).row;
    const { key } = await o.owner.post(`/o/${o.org}/event/sources/${row.id}/key`, {});
    await settle();
    const res = await o.app.fetch(
      new Request(`http://local.test/api/public/events/${key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "پورت ۲۴ قطع شد", host: "sw-edge1", severity: "major", check: "if24", event_id: "r1" }),
      }),
    );
    expect(res.status).toBe(202);
    expect(pending.length).toBeGreaterThan(0);
    await settle();
    expect(await oldDone()).toBe(50);
  });

  it("a flow's webhook", async () => {
    const k = flowsKit(o);
    const id = await k.live({ trigger: "webhook" }, line(N("v", "set_vars", { vars: [{ name: "x", value: 1 }] })));
    const { token, path } = await o.owner.post(`/o/${o.org}/flows/${id}/webhook-token`, {});
    await settle();
    const res = await o.app.fetch(new Request(`http://local.test${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" }));
    expect(res.status).toBe(202);
    expect(pending.length).toBeGreaterThan(0);
    await settle();
    expect(await oldDone()).toBe(50);
  });

  it("the demo page's polling while a pack loads", async () => {
    await o.db.query(`insert into sm_demo_packs (org_id, state) values ($1, 'loading')`, [o.org]);
    try {
      expect((await o.owner.get(`/o/${o.org}/demo`)).state).toBe("loading");
      expect(pending.length).toBeGreaterThan(0);
      await settle();
    } finally {
      await o.db.query(`delete from sm_demo_packs where org_id = $1`, [o.org]);
    }
    expect(await oldDone()).toBe(50);
  });

  it("the platform console's «اجرای اکنون» (its 5 s go to the jobs asked for)", async () => {
    // src/server/modules/admin/platform.ts tickNow: before, it cleaned up like the cron, so «only /api/cron/tick deletes
    // finished jobs on the web» (CLAUDE.md, RELEASE_FA, ARCHITECTURE_FA) did not hold for it
    expect(await o.owner.post("/admin/jobs/tick", {})).toMatchObject({ ran: expect.any(Number), failed: expect.any(Number) });
    expect(await oldDone()).toBe(50);
  });

  it("GET /api/cron/tick still deletes them (the hourly gate was open all along)", async () => {
    expect(await o.owner.get("/cron/tick")).toMatchObject({ ok: true });
    expect(await oldDone()).toBe(0);
  });
});

describe("every tick a route asks for passes cleanup: false", () => {
  it("src/server/routes", () => {
    const dir = join(__dirname, "..", "src", "server", "routes");
    const calls: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/\btick\(cfg,\s*\{([^}]*)\}/g)) calls.push(`${f}: ${m[1].trim()}`);
    }
    // the flow webhook, the event ingest, the acknowledgement link and the demo page's polling
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.filter((c) => !/\bcleanup:\s*false\b/.test(c))).toEqual([]);
  });
});
