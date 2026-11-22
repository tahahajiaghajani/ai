// A Windows app linked to an authority (the web version or the server edition: the same API), after
// tests/process-replica-scenario.ts: the app records submissions only («در صف ارسال»), pushes them with the person's
// own token, and pulls the result. W1 — a real holder deciding offline, the demo person's pushed start applied by its
// event job and by the organisation's timer (RC3); W11 R2 — an offline delivery, two offline submissions of one pool
// (the second late), an attachment that never arrives; W4 R5 — the parallel reviews' values merged when legal and
// finance decide on their apps, offline or online, in either order; W6 R7 — a publish without the managers' group: the
// group member's app pulls the tombstones and the cases leave its case list. A Windows app remembers for a minute which
// organisation it is linked to (flows/scheduler.ts linkCache): each file runs one of these, with the apps of one
// organisation.
import { describe, it, expect, beforeAll } from "vitest";
import { Client, makeServer, quietLog } from "../helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { makeCtx, type AuthUser, type Ctx, type DesktopBridge, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { startCase, submitTask } from "@server/modules/process/engine";
import { uuidv7 } from "@shared/id";
import { PASS, PNG, world, type EditionRef, type Scn } from "./harness";
import { setupW1, W1, w1Draft } from "./w01-project";
import { ask, setupW11, W11, w11Draft } from "./w11-peripheral";
import { order, setupW4, W4, w4Draft } from "./w04-procurement";
import { request, setupW6, W6, w6Draft } from "./w06-core-access";

export interface Desk {
  db: Db;
  client: SyncClient;
  ctx: () => Promise<Ctx>;
  /** the app's local server (its screens' routes; a person signs in to it as on the app) */
  app: { fetch: (r: Request) => Response | Promise<Response> };
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
  return { db: desk.db, client, ctx, app: desk.app };
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

export function linkedW4(ref: EditionRef): void {
  describe("W4 «تأیید قرارداد خرید تجهیزات» with linked Windows apps (R5 offline)", () => {
    let s: Scn;
    const desks: Record<string, Desk> = {};
    beforeAll(async () => {
      s = await world(await ref.get());
      await setupW4(s);
      await s.publish(W4.key, W4.name, w4Draft(s));
      // legal and finance decide on their Windows apps; the technical review is online
      desks.lg1 = await linkDesk(s, "lg1");
      desks.mehrdad = await linkDesk(s, "mehrdad");
    }, 600_000);

    /** A case at its three reviews, both apps' copies pulled (neither holds the other's value), the technical one done online. */
    async function reviews(title: string): Promise<string> {
      const r = await s.start("ramin", W4.key, order({ u_aftab_pr_title: title }));
      await s.settle();
      expect([await s.openAt(r.case, "legal"), await s.openAt(r.case, "fin")]).toEqual([["lg1", "lg2"], ["mehrdad"]]);
      await desks.lg1.client.syncNow();
      await desks.mehrdad.client.syncNow();
      await s.submit("negar", r.case, "tech", { values: { u_aftab_pr_tech: `فنی ${title}` } });
      await s.settle();
      return r.case;
    }
    /** A decision on the app of `who`, offline («در صف ارسال»). */
    async function offline(who: "lg1" | "mehrdad", caseId: string, step: "legal" | "fin", values: Record<string, unknown>): Promise<string> {
      const sent = await submitTask(await desks[who].ctx(), await deskTask(desks[who], s, caseId, step, who), { values });
      expect(sent.result).toBe("pending");
      return sent.submission;
    }
    /** The app is back online: it pushes what waits, and the authority applies it. */
    async function push(who: "lg1" | "mehrdad"): Promise<void> {
      await desks[who].client.syncNow();
      await s.settle();
    }
    /** All three values kept, each pushed submission applied, the join passed (the quotes open), both apps see it done. */
    async function merged(caseId: string, title: string, pushed: string[]): Promise<void> {
      expect((await s.kase(caseId)).data).toMatchObject({ u_aftab_pr_legal: `حقوقی ${title}`, u_aftab_pr_fin: `مالی ${title}`, u_aftab_pr_tech: `فنی ${title}` });
      for (const id of pushed) expect(await s.submission(id)).toMatchObject({ result: "applied" });
      expect(await s.at(caseId, "legal")).toEqual(["lg1:done", "lg2:not_needed"]);
      expect(await s.at(caseId, "fin")).toEqual(["mehrdad:done"]);
      expect([await s.openAt(caseId, "qa"), await s.openAt(caseId, "qb")]).toEqual([["ramin"], ["arman"]]);
      for (const [who, step] of [["lg1", "legal"], ["mehrdad", "fin"]] as const) {
        await desks[who].client.syncNow();
        const t = await desks[who].db.one(`select status from sm_process_tasks where case_id = $1 and step_key = $2 and assigned_to = $3`, [caseId, step, s.id(who)]);
        expect(t).toEqual({ status: "done" });
      }
    }

    it("R5 both decide offline, legal's app pushes first: both values kept with the technical review's", async () => {
      const t = "یکم";
      const c = await reviews(t);
      const a = await offline("lg1", c, "legal", { u_aftab_pr_legal: `حقوقی ${t}` });
      const b = await offline("mehrdad", c, "fin", { u_aftab_pr_fin: `مالی ${t}` });
      await push("lg1");
      // legal's decision is in; the join still waits for finance's
      expect((await s.kase(c)).data).toMatchObject({ u_aftab_pr_legal: `حقوقی ${t}` });
      expect(await s.openAt(c, "qa")).toEqual([]);
      await push("mehrdad");
      await merged(c, t, [a, b]);
    }, 300_000);

    it("R5 both decide offline, finance's app pushes first: both values kept", async () => {
      const t = "دوم";
      const c = await reviews(t);
      const a = await offline("lg1", c, "legal", { u_aftab_pr_legal: `حقوقی ${t}` });
      const b = await offline("mehrdad", c, "fin", { u_aftab_pr_fin: `مالی ${t}` });
      await push("mehrdad");
      expect(await s.openAt(c, "qa")).toEqual([]);
      await push("lg1");
      await merged(c, t, [a, b]);
    }, 300_000);

    it("R5 legal decides offline first, finance online afterwards: legal's later push keeps both", async () => {
      const t = "سوم";
      const c = await reviews(t);
      const a = await offline("lg1", c, "legal", { u_aftab_pr_legal: `حقوقی ${t}` });
      await s.submit("mehrdad", c, "fin", { values: { u_aftab_pr_fin: `مالی ${t}` } });
      await s.settle();
      expect((await s.kase(c)).data).toMatchObject({ u_aftab_pr_fin: `مالی ${t}` });
      await push("lg1");
      await merged(c, t, [a]);
    }, 300_000);

    it("R5 finance decides offline first, its copy without legal's value (sent empty), legal online afterwards: finance's later push keeps both", async () => {
      const t = "چهارم";
      const c = await reviews(t);
      // the app's copy held no legal value: a stale empty one rides along, and a key the step may not change is dropped
      const b = await offline("mehrdad", c, "fin", { u_aftab_pr_fin: `مالی ${t}`, u_aftab_pr_legal: null });
      await s.submit("lg1", c, "legal", { values: { u_aftab_pr_legal: `حقوقی ${t}` } });
      await s.settle();
      await push("mehrdad");
      await merged(c, t, [b]);
    }, 300_000);
  });
}

export function linkedW6(ref: EditionRef): void {
  describe("W6 «درخواست دسترسی ویژه به کربنکینگ» with a linked Windows app (R7)", () => {
    let s: Scn;
    let desk: Desk;
    let local: Client;
    beforeAll(async () => {
      s = await world(await ref.get());
      // the organisation's own people: the member signs in on his linked app (closed to the pack's people)
      await setupW6(s, { demo: false });
      await s.publish(W6.key, W6.name, w6Draft(s));
      desk = await linkDesk(s, "cab1");
      local = new Client(desk.app, "http://desk.test");
      await local.post("/auth/login", { email: s.email.cab1, password: PASS });
    }, 600_000);

    it("R7 a new version without the managers' group: the group member's app pulls the tombstones, and the open and the closed case leave its case list", async () => {
      const P = `/o/${s.org}`;
      const open = (await s.start("somayeh", W6.key, request())).case;
      const closed = (await s.start("somayeh", W6.key, request({ u_aftab_ca_system: "cards" }))).case;
      await s.settle();
      await s.submit("ladan", closed, "soc", { outcome: "approved" });
      await s.settle();
      await s.submit("core1", closed, "grant", { values: { u_aftab_ca_ticket: "CHG-5512" } });
      await s.settle();
      expect([(await s.kase(open)).state, (await s.kase(closed)).state]).toEqual(["active", "completed"]);
      await desk.client.syncNow();
      // a manager through «کمیتهٔ تغییرات»: both cases are on his app, in its case list, and he manages them there
      const listed = async () => ((await local.get(`${P}/process/cases`)).rows as { id: string }[]).map((r) => r.id).filter((id) => id === open || id === closed).sort();
      expect(await listed()).toEqual([open, closed].sort());
      expect((await local.get(`${P}/process/cases/${open}`)).can.manage).toBe(true);
      const journal = (id: string) => desk.db.one<{ n: number }>(`select count(*)::int as n from sm_journal where table_key = 'process_case' and record_id = $1 and deleted_at is null`, [id]);
      expect((await journal(closed))!.n).toBeGreaterThan(0);
      // he holds no step of them: his «کارتابل» lists his own open steps only, before as after
      const inbox = async () => ((await local.get(`${P}/process/inbox`)).rows as { case_id: string | null }[]).filter((r) => r.case_id === open || r.case_id === closed);
      expect(await inbox()).toEqual([]);

      await s.publish(W6.key, W6.name, w6Draft(s, { cab: false }));
      await s.detail("cab1", open, 404);
      await s.detail("cab1", closed, 404);
      await desk.client.syncNow();
      // the tombstones: both cases gone from his app, with their journals
      for (const id of [open, closed]) {
        expect(await desk.db.one(`select count(*)::int as n from sm_process_cases where id = $1 and deleted_at is null`, [id])).toEqual({ n: 0 });
        expect(await journal(id)).toEqual({ n: 0 });
      }
      expect(await listed()).toEqual([]);
      await local.get(`${P}/process/cases/${open}`, 404);
      await local.get(`${P}/process/cases/${closed}`, 404);
      expect(await inbox()).toEqual([]);
      // the named manager's reading is untouched on the authority
      await s.detail("zhaleh", open);
    }, 300_000);
  });
}
