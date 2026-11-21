// The web edition's own cadence (Vercel + Supabase): no timer runs between requests and nothing here drains the
// queue — a write that queued jobs runs a 4 s tick after its answer (cfg.waitUntil, Next's after()), any other
// request at most once a minute an 8 s traffic tick, and GET /api/cron/tick (the pg_cron heartbeat) 20 s. W1's R1 and
// W11's deadlines run on those ticks alone; a backlog of older due jobs shows what waits for traffic or the heartbeat.
import { describe, it, expect, beforeAll } from "vitest";
import { enqueue, registerJobHandler } from "@server/jobs";
import { DAY, world, type EditionRef, type Scn } from "./harness";
import { setupW1, W1, w1Draft } from "./w01-project";
import { ask, setupW11, W11, w11Draft } from "./w11-peripheral";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let slow = false;

export function webCadence(ref: EditionRef): void {
  describe("the web's own ticks only (after-write, traffic, heartbeat)", () => {
    beforeAll(() => {
      if (slow) return;
      slow = true;
      registerJobHandler("test.wfscen.slow", async () => {
        await sleep(400);
      });
    });

    describe("W1 «گردش کار پروژه»", () => {
      let s: Scn;
      beforeAll(async () => {
        s = await world(await ref.get(), { cadence: "web" });
        await setupW1(s);
        await s.publish(W1.key, W1.name, w1Draft(s));
      }, 600_000);

      it("R1 the start's after-write tick opens «مرحلهٔ فرم» for both holders; the submit's tick completes the case", async () => {
        s.minuteLater();
        const r = await s.start("negar", W1.key, { u_aftab_prj_name: "سامانهٔ وب", u_aftab_prj_manager: "علی" });
        // nothing drained: only the start request's own tick ran
        expect(await s.openAt(r.case, "form")).toEqual(["babak", "negar"]);
        await s.submit("babak", r.case, "form", { values: { u_aftab_prj_delay: 7 } });
        expect(await s.kase(r.case)).toMatchObject({ state: "completed", outcome: "completed", data: { u_aftab_prj_delay: 7 } });
        expect((await s.bells("negar")).some((t) => t.endsWith("به پایان رسید"))).toBe(true);
      }, 300_000);

      it("a backlog of older due jobs: the after-write tick does not reach the step; reads within the minute run no tick; a minute later traffic ticks; the heartbeat finishes it", async () => {
        for (let i = 0; i < 30; i++) await enqueue(s.db, { kind: "test.wfscen.slow", orgId: s.org, payload: { i } });
        s.minuteLater();
        const r = await s.start("negar", W1.key, { u_aftab_prj_name: "پشت صف" });
        expect(await s.openAt(r.case, "form")).toEqual([]);
        for (let i = 0; i < 3; i++) await s.detail("negar", r.case);
        await s.settle();
        expect(await s.openAt(r.case, "form")).toEqual([]);
        // a minute later: the next request runs a traffic tick (8 s)
        s.minuteLater();
        await s.detail("negar", r.case);
        await s.settle();
        const left = (await s.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where org_id = $1 and kind = 'test.wfscen.slow' and status = 'queued'`, [s.org]))!.n;
        expect(left).toBeLessThan(30);
        // the heartbeat (pg_cron calling /api/cron/tick): 20 s
        const beat = await s.owner.get(`/cron/tick`);
        expect(beat.ok).toBe(true);
        for (let i = 0; i < 3 && !(await s.openAt(r.case, "form")).length; i++) {
          await sleep(10_500);
          await s.owner.get(`/cron/tick`);
        }
        expect(await s.openAt(r.case, "form")).toEqual(["babak", "negar"]);
      }, 300_000);
    });

    describe("W11 «درخواست تجهیزات جانبی»", () => {
      let s: Scn;
      beforeAll(async () => {
        s = await world(await ref.get(), { cadence: "web" });
        await setupW11(s);
        await s.publish(W11.key, W11.name, w11Draft(s));
      }, 600_000);

      it("a deadline passes with nobody using the site: nothing happens until a request ticks; then the managers are told and the automatic «ثبت» runs", async () => {
        s.minuteLater();
        const r = await s.start("negar", W11.key, ask(s));
        expect(await s.openAt(r.case, "deliver")).toEqual(["as1", "as2"]);
        // a day and more passes: the organisation's timer is due, but no request came
        await s.elapse(r.case, "deliver", 3 * DAY + 60_000);
        await s.db.query(`update sm_jobs set run_at = now() - interval '1 second' where org_id = $1 and kind = 'process.timer' and status = 'queued'`, [s.org]);
        expect(await s.openAt(r.case, "confirm")).toEqual([]);
        // the next request a minute after the last tick: its traffic tick runs the timer and the step after it
        s.minuteLater();
        await s.as("ramin").get(`${s.P}/process/inbox`);
        await s.settle();
        expect((await s.bells("ramin")).some((t) => t.startsWith("مهلت گذشت: «تحویل تجهیز»"))).toBe(true);
        expect(await s.journal(r.case)).toContain("مهلت گذشت؛ «تحویل تجهیز» خودکار «ثبت» شد");
        expect(await s.openAt(r.case, "confirm")).toEqual(["negar"]);
        await s.submit("negar", r.case, "confirm", { outcome: "submitted" });
        expect(await s.kase(r.case)).toMatchObject({ state: "completed" });
      }, 300_000);
    });
  });
}
