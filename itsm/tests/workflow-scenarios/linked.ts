// A Windows app linked to an authority (the web version or the server edition: the same API), after
// tests/process-replica-scenario.ts: the app records submissions only («در صف ارسال»), pushes them with the person's
// own token, and pulls the result. W1 — a real holder deciding offline, the demo person's pushed start applied by its
// event job and by the organisation's timer (RC3); W11 R2 — an offline delivery, two offline submissions of one pool
// (the second late), an attachment that never arrives. A Windows app remembers for a minute which organisation it is
// linked to (flows/scheduler.ts linkCache): each file runs one of these, with the apps of one organisation.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, quietLog } from "../helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { makeCtx, type AuthUser, type Ctx, type DesktopBridge, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { startCase, submitTask } from "@server/modules/process/engine";
import { uuidv7 } from "@shared/id";
import { PASS, PNG, world, type EditionRef, type Scn } from "./harness";
import { setupW1, W1, w1Draft } from "./w01-project";
import { ask, setupW11, W11, w11Draft } from "./w11-peripheral";

export interface Desk {
  db: Db;
  client: SyncClient;
  ctx: () => Promise<Ctx>;
}

/** Link a Windows app to the world's organisation as `who` (download: the app starts empty). */
export async function linkDesk(s: Scn, who: string, o: { dropAttachments?: () => boolean } = {}): Promise<Desk> {
  const bridge = { notifyLocalWrite() {}, fetchBlob: async () => null, info: async () => ({ cloud: { linked: true, org_id: s.org } }) } as unknown as DesktopBridge;
  const desk = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
  const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    let body = init?.body;
    // an attachment whose push never reached the authority (a failed upload): its aggregate is left out
    if (o.dropAttachments?.() && String(u).endsWith("/sync/push") && typeof body === "string") {
      const json = JSON.parse(body) as { aggregates?: { entity: string }[] };
      json.aggregates = (json.aggregates ?? []).filter((a) => a.entity !== "attachment");
      body = JSON.stringify(json);
    }
    return s.o.app.fetch(new Request(String(u), { ...init, body }));
  }) as typeof fetch;
  const client = new SyncClient({ db: desk.db, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
  await client.link({ url: "http://cloud.test", email: s.email[who], password: PASS, orgId: s.org, direction: "download" });
  const cfg: ServerConfig = { mode: "desktop", db: desk.db, secret: "desktop-secret", allowSignup: false, platformAdmins: [], origin: "desk", log: quietLog, fetch: cloudFetch, desktop: bridge };
  const ctx = async () => {
    const user = (await desk.db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where email = $1`, [s.email[who]]))!;
    const org = (await desk.db.one<OrgRow>(`select * from sm_orgs where id = $1`, [s.org]))!;
    const member = (await desk.db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2`, [s.org, user.id]))!;
    return makeCtx(cfg, user, org, member);
  };
  return { db: desk.db, client, ctx };
}

/** The open task of `who` at `step` on a Windows app's own copy. */
async function deskTask(d: Desk, s: Scn, caseId: string, step: string, who: string): Promise<string> {
  const t = await d.db.one<{ id: string }>(`select id from sm_process_tasks where case_id = $1 and step_key = $2 and assigned_to = $3 and status = 'open'`, [caseId, step, s.id(who)]);
  if (!t) throw new Error(`no open «${step}» task of ${who} on the Windows app`);
  return t.id;
}

export function linkedW1(ref: EditionRef): void {
  describe("W1 «گردش کار پروژه» with linked Windows apps", () => {
    let s: Scn;
    const desks: Record<string, Desk> = {};
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW1(s);
      await s.publish(W1.key, W1.name, w1Draft(s));
      desks.reza = await linkDesk(s, "reza");
      desks.negar = await linkDesk(s, "negar");
    }, 600_000);

    it("a real holder decides offline: the organisation's own case reaches his app, his submission is applied once, the finished case comes back", async () => {
      const r = await s.start("owner", W1.key, { u_aftab_prj_name: "پروژهٔ شعبه" });
      await s.settle();
      await s.reassign("owner", r.case, "form", ["reza"]);
      await desks.reza.client.syncNow();
      const task = await deskTask(desks.reza, s, r.case, "form", "reza");
      const sent = await submitTask(await desks.reza.ctx(), task, { values: { u_aftab_prj_delay: 4 } });
      expect(sent.result).toBe("pending");
      // nothing moves on the app itself
      expect(await desks.reza.db.one(`select status from sm_process_tasks where id = $1`, [task])).toEqual({ status: "open" });
      await desks.reza.client.syncNow();
      await s.settle();
      expect(await s.kase(r.case)).toMatchObject({ state: "completed", data: { u_aftab_prj_delay: 4 } });
      expect(await s.submission(sent.submission)).toMatchObject({ result: "applied" });
      await desks.reza.client.syncNow();
      expect(await desks.reza.db.one(`select state from sm_process_cases where id = $1`, [r.case])).toEqual({ state: "completed" });
    }, 300_000);

    it("the demo person's offline start, applied by its own event job: the pack's case, both holders", async () => {
      const caseId = uuidv7();
      const r = await startCase(await desks.negar.ctx(), { process: s.procs[W1.key].id, case_id: caseId, values: { u_aftab_prj_name: "از برنامهٔ ویندوز", u_aftab_prj_manager: "علی" } });
      expect(r).toMatchObject({ result: "pending", case: caseId });
      await desks.negar.client.syncNow();
      await s.settle();
      expect(await s.submission(r.submission)).toMatchObject({ result: "applied" });
      expect({ demo: await s.isDemo(caseId), people: await s.openAt(caseId, "form") }).toEqual({ demo: true, people: ["babak", "negar"] });
    }, 300_000);

    it("(RC3) the demo person's offline start, applied by the organisation's timer that was due first: still the pack's case, both holders", async () => {
      const caseId = uuidv7();
      const r = await startCase(await desks.negar.ctx(), { process: s.procs[W1.key].id, case_id: caseId, values: { u_aftab_prj_name: "پیش از رویداد", u_aftab_prj_manager: "علی" } });
      await desks.negar.client.syncNow();
      // the push woke the timer (within the hour); it had come due before the submission's event job ran
      await s.db.query(`update sm_jobs set run_at = now() - interval '1 minute' where org_id = $1 and kind = 'process.timer' and status = 'queued'`, [s.org]);
      await s.settle();
      expect(await s.submission(r.submission)).toMatchObject({ result: "applied" });
      expect({ demo: await s.isDemo(caseId), people: await s.openAt(caseId, "form") }).toEqual({ demo: true, people: ["babak", "negar"] });
    }, 300_000);
  });
}

export function linkedW11(ref: EditionRef): void {
  describe("W11 «درخواست تجهیزات جانبی» with linked Windows apps (R2)", () => {
    let s: Scn;
    const desks: Record<string, Desk> = {};
    let dropping = false;
    beforeAll(async () => {
      s = await world(await ref.get());
      // the organisation's own people (a linked app's local sign-in is closed to the pack's people)
      await setupW11(s, { demo: false });
      await s.publish(W11.key, W11.name, w11Draft(s));
      desks.as1 = await linkDesk(s, "as1", { dropAttachments: () => dropping });
      desks.as2 = await linkDesk(s, "as2");
    }, 600_000);

    it("an offline delivery «در صف ارسال» is pushed, applied once, and the done task comes back with the next pull", async () => {
      const r = await s.start("negar", W11.key, ask(s));
      await s.settle();
      await desks.as1.client.syncNow();
      const task = await deskTask(desks.as1, s, r.case, "deliver", "as1");
      const sent = await submitTask(await desks.as1.ctx(), task, { values: { u_aftab_eq_serial: "AM-OFF-1" } });
      expect(sent.result).toBe("pending");
      await desks.as1.client.syncNow();
      await s.settle();
      expect(await s.at(r.case, "deliver")).toEqual(["as1:done", "as2:not_needed"]);
      expect(await s.openAt(r.case, "confirm")).toEqual(["negar"]);
      await desks.as1.client.syncNow();
      expect(await desks.as1.db.one(`select status from sm_process_tasks where id = $1`, [task])).toEqual({ status: "done" });
      expect(await desks.as1.db.one(`select result from sm_process_submissions where id = $1`, [sent.submission])).toEqual({ result: "applied" });
    }, 300_000);

    it("two of the pool submit offline: the first is applied, the second comes late with its values kept, and its sender is told", async () => {
      const r = await s.start("yaser", W11.key, ask(s, { u_aftab_eq_item: "keyboard" }));
      await s.settle();
      await desks.as1.client.syncNow();
      await desks.as2.client.syncNow();
      const a = await submitTask(await desks.as1.ctx(), await deskTask(desks.as1, s, r.case, "deliver", "as1"), { values: { u_aftab_eq_serial: "AM-A" } });
      const b = await submitTask(await desks.as2.ctx(), await deskTask(desks.as2, s, r.case, "deliver", "as2"), { values: { u_aftab_eq_serial: "AM-B" } });
      await desks.as1.client.syncNow();
      await s.settle();
      await desks.as2.client.syncNow();
      await s.settle();
      expect(await s.submission(a.submission)).toMatchObject({ result: "applied" });
      expect(await s.submission(b.submission)).toMatchObject({ result: "late", values: { u_aftab_eq_serial: "AM-B" } });
      expect((await s.kase(r.case)).data.u_aftab_eq_serial).toBe("AM-A");
      expect(await s.bells("as2")).toContain("ثبت شما در «تحویل تجهیز» دیرهنگام رسید");
    }, 300_000);

    it("a photo whose upload never arrives: the submission waits, then after 10 minutes is refused with the file's name; the task stays open", async () => {
      const r = await s.start("somayeh", W11.key, ask(s, { u_aftab_eq_item: "headset" }));
      await s.settle();
      await desks.as1.client.syncNow();
      const task = await deskTask(desks.as1, s, r.case, "deliver", "as1");
      const sent = await submitTask(await desks.as1.ctx(), task, { values: { u_aftab_eq_serial: "AM-PH", u_aftab_eq_photo: [{ upload: 0 }] }, files: [{ name: "photo.png", type: "image/png", data: PNG }] });
      expect(sent.result).toBe("pending");
      dropping = true;
      try {
        await desks.as1.client.syncNow();
      } finally {
        dropping = false;
      }
      await s.settle();
      expect(await s.submission(sent.submission)).toMatchObject({ result: "pending" });
      expect(await s.openAt(r.case, "deliver")).toEqual(["as1", "as2"]);
      // ten minutes later
      await s.db.query(
        `update sm_jobs set run_at = now(), payload = jsonb_set(payload, '{since}', to_jsonb((extract(epoch from now()) * 1000 - 11 * 60000)::bigint)) where org_id = $1 and kind = 'process.apply' and status = 'queued'`,
        [s.org],
      );
      await s.settle();
      expect(await s.submission(sent.submission)).toMatchObject({ result: "refused", result_note: "پیوست «عکس تحویل» نرسید؛ مرحله را دوباره بفرستید" });
      expect(await s.openAt(r.case, "deliver")).toEqual(["as1", "as2"]);
      expect(await s.bells("as1")).toContain("ثبت شما در «تحویل تجهیز» پذیرفته نشد");
    }, 300_000);
  });
}
