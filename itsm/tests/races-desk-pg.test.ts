// Writes side by side in the service desk and delivery modules (audit D4, slice A2), on a real PostgreSQL: change,
// request, knowledge, DevOps and the modules around them decide many writes from rows other than the one they hold
// locked (a lockdown from the changes in flight, a template's counters, an item's work from its tasks, a category's
// audience from its parent, a gate's predecessor in the evidence chain…). Each test forces the interleaving that broke
// before the fix — a transaction held open while a racer reads — and checks the state a serial order gives. Skipped
// unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/races-desk-pg.test.ts
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import type { Ctx } from "@server/context";
import type { Tx } from "@server/db";
import { createIn, systemCtx, transitionIn, updateIn } from "@server/engine";
import { openConnection, openGateIn, verifyChain } from "@server/modules/devops";
import { sweep } from "@server/modules/request";
import { createFromAlert, draftReview } from "@server/modules/incident";
import { resetRateLimits } from "@server/http/ratelimit";
import { resetRateBuckets } from "@server/http/hono";
import { realPgAvailable } from "./pg-real";
import { call, hold, message, queued, raceDatabases, sleep, whileHeld } from "./race-helpers";
import { world as changeWorld, at, type World as ChangeWorld } from "./change-helpers";
import { requestKit, type RequestKit, type Who } from "./request-helpers";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { world as releaseWorld, type World as ReleaseWorld } from "./release-helpers";
import { world as incidentWorld, type World as IncidentWorld } from "./incident-helpers";

const pid = process.pid;

describe.skipIf(!realPgAvailable())("service desk and delivery: writes side by side (real PostgreSQL)", () => {
  raceDatabases("desk");

  // ------------------------------------------------------------------------------------------------------ change

  describe("change", () => {
    let w: ChangeWorld;
    beforeAll(async () => {
      resetRateLimits();
      resetRateBuckets();
      w = await changeWorld();
      // failed changes close without a review in these tests (the template counters are the subject)
      await w.e.db.query(`update sm_change_configs set pir_required_for = '[]'::jsonb where org_id = $1`, [w.e.org]);
    }, 180_000);

    const change = async (id: string) => (await w.e.db.one<Record<string, any>>(`select * from sm_change_requests where id = $1`, [id]))!;
    const lockdown = (ci: string, title: string) => w.o.post(`${w.P}/r/change_lockdown`, { title, cis: [ci], hold_in_flight: true, reason: "اختلال سراسری" }).then((r) => r.row as Record<string, any>);
    /** Move a change through states as the system (the questionnaire and the approvals are not the subject). */
    const move = async (id: string, states: string[]) => {
      for (const to of states) await w.sys.write((tx) => transitionIn(tx, w.sys, "change_request", id, to, {}, { trusted: true }));
    };
    const scheduled = async (ci: string) => {
      const c = await w.change({ ci_id: ci });
      await move(c.id, ["assess", "authorize", "scheduled"]);
      return c.id as string;
    };

    it("A2-1: a change authorized while a lockdown starts is put on hold by the lockdown", async () => {
      const ci = await w.ci(`سرور قرنطینه ${pid}-1`);
      const c = await w.change({ ci_id: ci });
      await move(c.id, ["assess", "authorize"]);
      // the change manager's authorization passed the lifecycle guard (no lockdown yet) and has not committed
      const authorizing = hold(w.e.db, (tx) => transitionIn(tx, w.sys, "change_request", c.id, "scheduled", {}, { trusted: true }));
      const made = await whileHeld(authorizing, () => lockdown(ci, "قرنطینهٔ هم‌زمان با تأیید"));
      expect(made.status, message(made)).toBe("fulfilled");
      const l = (made as PromiseFulfilledResult<Record<string, any>>).value;
      const after = await change(c.id);
      expect(after.state).toBe("scheduled");
      expect(after.on_hold).toBe(true);
      expect(after.lockdown_id).toBe(l.id);
    });

    it("A2-1: a change released by one lockdown while another starts stays held by the new one", async () => {
      const ci = await w.ci(`سرور قرنطینه ${pid}-2`);
      const id = await scheduled(ci);
      const first = await lockdown(ci, "قرنطینهٔ نخست");
      expect((await change(id)).lockdown_id).toBe(first.id);
      // the first lockdown ends (its release resumed the change, not committed) while a second one starts
      const releasing = hold(w.e.db, (tx) => transitionIn(tx, w.sys, "change_lockdown", first.id, "released", {}, { trusted: true }));
      const made = await whileHeld(releasing, () => lockdown(ci, "قرنطینهٔ دوم"));
      expect(made.status, message(made)).toBe("fulfilled");
      const second = (made as PromiseFulfilledResult<Record<string, any>>).value;
      const after = await change(id);
      expect(after.on_hold).toBe(true);
      expect(after.lockdown_id).toBe(second.id);
    });

    it("A2-1: a change resumed by hand while a lockdown starts is held by the lockdown", async () => {
      const ci = await w.ci(`سرور قرنطینه ${pid}-3`);
      const id = await scheduled(ci);
      await w.p.agent.client.post(`${w.P}/change/records/${id}/hold`, { reason: "vendor" });
      // the change is held by a write of its own: the resume waits for it, then the lockdown starts
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_change_requests where id = $1 for update`, [id]));
      await holder.ready;
      const resume = call(w.p.agent.client, "POST", `${w.P}/change/records/${id}/resume`, {});
      await queued(w.e.db, 1, resume);
      const made = lockdown(ci, "قرنطینهٔ هم‌زمان با ادامه");
      made.catch(() => undefined);
      await queued(w.e.db, 2, made);
      holder.release();
      await holder.done;
      const [r, l] = await Promise.all([resume, made]);
      expect(r.status).toBe(200);
      const after = await change(id);
      expect(after.on_hold).toBe(true);
      expect(after.lockdown_id).toBe(l.id);
    });

    it("A2-2: two failed changes of a standard template closing at once count twice and suspend it", async () => {
      const item = (await w.p.agent.client.get(`${w.P}/change/catalog`)).items.find((x: any) => x.name.includes("گواهی"));
      const order = async (day: number) => (await w.p.agent.client.post(`${w.P}/change/catalog/${item.id}/order`, { planned_start: at(day, 9), planned_end: at(day, 10), assignment_group_id: w.g.network, submit: true })).change as Record<string, any>;
      const [c1, c2] = [await order(20), await order(21)];
      expect(c1.state).toBe("scheduled");
      const tpl = String(c1.template_id);
      const template = async () => (await w.e.db.one<Record<string, any>>(`select state, failure_count, usage_count from sm_change_templates where id = $1`, [tpl]))!;
      expect(Number((await template()).failure_count ?? 0)).toBe(0);
      for (const c of [c1, c2]) {
        await w.sys.write((tx) => transitionIn(tx, w.sys, "change_request", c.id, "implement", {}, { trusted: true }));
        // the template's tasks are not the subject: they do not hold the review
        await w.e.db.query(`update sm_change_tasks set mandatory = false where change_id = $1`, [c.id]);
        await w.sys.write((tx) => transitionIn(tx, w.sys, "change_request", c.id, "review", { close_code: "unsuccessful" }, { trusted: true }));
      }
      const close = (tx: Tx, id: string) => transitionIn(tx, w.sys, "change_request", id, "closed", { close_code: "unsuccessful", close_notes: "اجرا ناموفق بود" }, { trusted: true });
      const first = hold(w.e.db, (tx) => close(tx, c1.id));
      const second = await whileHeld(first, () => w.sys.write((tx) => close(tx, c2.id)));
      expect(second.status, message(second)).toBe("fulfilled");
      expect((await change(c1.id)).state).toBe("closed");
      expect((await change(c2.id)).state).toBe("closed");
      const t = await template();
      expect(Number(t.failure_count)).toBe(2);
      expect(t.state).toBe("suspended");
    });

    it("A2-2: a standard change is not made from a template that a failure is suspending", async () => {
      // (two creates of one table already take turns on the record counter; a create meeting the suspension does not)
      const items = (await w.p.agent.client.get(`${w.P}/change/catalog`)).items as Record<string, any>[];
      const item = items.find((x) => !String(x.name).includes("گواهی"))!;
      const c = (await w.p.agent.client.post(`${w.P}/change/catalog/${item.id}/order`, { planned_start: at(24, 9), planned_end: at(24, 10), assignment_group_id: w.g.network, submit: true })).change as Record<string, any>;
      const tpl = String(c.template_id);
      await w.e.db.query(`update sm_change_templates set failure_count = 1 where id = $1`, [tpl]);
      await w.sys.write((tx) => transitionIn(tx, w.sys, "change_request", c.id, "implement", {}, { trusted: true }));
      await w.e.db.query(`update sm_change_tasks set mandatory = false where change_id = $1`, [c.id]);
      await w.sys.write((tx) => transitionIn(tx, w.sys, "change_request", c.id, "review", { close_code: "unsuccessful" }, { trusted: true }));
      // the second failure is closing (the template suspended, not committed) when a change is made from it
      const closing = hold(w.e.db, (tx) => transitionIn(tx, w.sys, "change_request", c.id, "closed", { close_code: "unsuccessful", close_notes: "اجرا ناموفق بود" }, { trusted: true }));
      const made = await whileHeld(closing, () =>
        w.sys.write((tx) => createIn(tx, w.sys, "change_request", { template_id: tpl, short_description: "استاندارد پس از تعلیق", assignment_group_id: w.g.network, planned_start: at(25, 9), planned_end: at(25, 10) }, { trusted: true })),
      );
      expect((await w.e.db.one<{ state: string }>(`select state from sm_change_templates where id = $1`, [tpl]))!.state).toBe("suspended");
      expect(made.status).toBe("rejected");
      expect(message(made)).toContain("منتشر نشده");
    });

    it("A2-10: two changes created at once on one CI and window both record their conflict", async () => {
      const ci = await w.ci(`سرور تداخل ${pid}`);
      // made straight into assessment (an import, a pipeline): drafts do not conflict, assessed changes do
      const make = (tx: Tx, title: string) =>
        createIn(tx, w.sys, "change_request", { short_description: title, type: "normal", state: "assess", assignment_group_id: w.g.network, ci_id: ci, planned_start: at(40, 9), planned_end: at(40, 11) }, { trusted: true });
      // the first creation planned its conflicts (none) and holds the change counter: the second plans before it commits
      const first = hold(w.e.db, (tx) => make(tx, "تغییر نخست روی سرور"));
      const second = await whileHeld(first, () => w.sys.write((tx) => make(tx, "تغییر دوم روی سرور")));
      expect(second.status, message(second)).toBe("fulfilled");
      await w.drain();
      const ids = (await w.e.db.query<{ id: string }>(`select id from sm_change_requests where org_id = $1 and ci_id = $2 and deleted_at is null`, [w.e.org, ci])).map((r) => r.id);
      expect(ids.length).toBe(2);
      for (const [mine, other] of [ids, [...ids].reverse()]) {
        const rows = await w.e.db.query(`select id from sm_change_conflicts where change_id = $1 and other_change_id = $2 and active and deleted_at is null`, [mine, other]);
        expect(rows.length, `conflict of ${mine} with ${other}`).toBeGreaterThanOrEqual(1);
      }
    });

    it("A2-11: a task waiting for two tasks finished at once becomes ready", async () => {
      const c = await w.change({ short_description: "تغییر با کارهای وابسته" });
      await move(c.id, ["assess", "authorize", "scheduled", "implement"]);
      const task = (data: Record<string, unknown>) => w.sys.write((tx) => createIn(tx, w.sys, "change_task", { change_id: c.id, short_description: "کار آزمون", task_type: "implementation", ...data }, { trusted: true }));
      const a = await task({ short_description: "کار الف" });
      const b = await task({ short_description: "کار ب" });
      const after = await task({ short_description: "کار پس از هر دو", depends_on: [a.id, b.id] });
      const state = async (id: string) => (await w.e.db.one<{ state: string }>(`select state from sm_change_tasks where id = $1`, [id]))!.state;
      expect(await state(after.id)).toBe("pending");
      const done = (id: string) => (tx: Tx) => transitionIn(tx, w.sys, "change_task", id, "closed_complete", {}, { trusted: true });
      const first = hold(w.e.db, done(a.id));
      const second = await whileHeld(first, () => w.sys.write(done(b.id)));
      expect(second.status, message(second)).toBe("fulfilled");
      expect(await state(after.id)).toBe("open");
    });
  });

  // ----------------------------------------------------------------------------------------------------- request

  describe("request", () => {
    let k: RequestKit;
    let sys: Ctx;
    let requester: Who;
    const agents: Who[] = [];
    beforeAll(async () => {
      resetRateLimits();
      resetRateBuckets();
      k = await requestKit();
      sys = await systemCtx(k.o.cfg, k.o.org);
      requester = await k.person(`race-req-${pid}@example.com`, { roles: ["requester"] });
      for (const n of [1, 2, 3, 4]) agents.push(await k.person(`race-agent${n}-${pid}@example.com`));
      await k.addToGroup(await k.group("پشتیبانی کاربران"), agents.map((a) => a.userId));
    }, 180_000);

    /** An item of «درخواست دیگر» in fulfilment by tasks. */
    const itemInWork = async (): Promise<string> => {
      const other = await k.item("other_request");
      const r = await requester.client.post(`${k.P}/request/order`, { lines: [{ item_id: other.id, answers: { subject: "موضوع آزمون هم‌زمانی", details: "شرح آزمون هم‌زمانی" } }] });
      const id = String(r.items[0].id);
      expect((await k.ritm(id)).state).toBe("in_fulfilment");
      await k.o.db.query(`update sm_request_items set fulfilment = 'tasks' where id = $1`, [id]);
      return id;
    };
    const task = (ritm: string, data: Record<string, unknown> = {}) =>
      sys.write((tx) => createIn(tx, sys, "request_task", { request_item_id: ritm, short_description: "وظیفهٔ آزمون", ...data }, { trusted: true }));

    it("A2-3: two tasks reassigned at once leave the item's fulfillers as both assignments made them", async () => {
      const [W, X, Y, Z] = agents.map((a) => a.userId);
      const id = await itemInWork();
      const a = await task(id, { assigned_to: W });
      const b = await task(id, { assigned_to: Y });
      expect([...(await k.ritm(id)).fulfillers].sort()).toEqual([W, Y].sort());
      const first = hold(k.o.db, (tx) => updateIn(tx, sys, "request_task", a.id, { assigned_to: X }, { trusted: true }));
      const second = await whileHeld(first, () => sys.write((tx) => updateIn(tx, sys, "request_task", b.id, { assigned_to: Z }, { trusted: true })));
      expect(second.status, message(second)).toBe("fulfilled");
      const item = await k.ritm(id);
      expect([...item.fulfillers].sort()).toEqual([X, Z].sort());
      const [order] = await k.rows("request", "id = $2", [item.request_id]);
      expect(order.fulfillers).not.toContain(W);
    });

    it("A2-3: the last two tasks closed at once deliver the item", async () => {
      const id = await itemInWork();
      const a = await task(id);
      const b = await task(id);
      const done = (taskId: string) => (tx: Tx) => transitionIn(tx, sys, "request_task", taskId, "closed_complete", {}, { trusted: true });
      const first = hold(k.o.db, done(a.id));
      const second = await whileHeld(first, () => sys.write(done(b.id)));
      expect(second.status, message(second)).toBe("fulfilled");
      expect(["delivered", "closed_complete"]).toContain((await k.ritm(id)).state);
    });

    it("A2-3: a task added after a task being closed opens once its predecessor is done", async () => {
      const id = await itemInWork();
      const a = await task(id);
      const first = hold(k.o.db, (tx) => transitionIn(tx, sys, "request_task", a.id, "closed_complete", {}, { trusted: true }));
      const added = await whileHeld(first, () => task(id, { depends_on: a.id, short_description: "وظیفهٔ بعدی" }));
      expect(added.status, message(added)).toBe("fulfilled");
      const c = (added as PromiseFulfilledResult<Record<string, any>>).value;
      const [row] = await k.rows("request_task", "id = $2", [c.id]);
      expect(row.state).toBe("open");
    });

    it("A2-4: the requester's answers are not edited once the approval moved the item into fulfilment", async () => {
      const other = await k.item("other_request");
      const r = await requester.client.post(`${k.P}/request/order`, { lines: [{ item_id: other.id, answers: { subject: "موضوع تأییدشده", details: "شرح تأییدشده" } }] });
      const id = String(r.items[0].id);
      await k.o.db.query(`update sm_request_items set state = 'awaiting_approval' where id = $1`, [id]);
      // the approval settled: the item moves into fulfilment (locked, not committed) when the requester saves new answers
      const approving = hold(k.o.db, (tx) => transitionIn(tx, sys, "request_item", id, "in_fulfilment", {}, { trusted: true }));
      const edited = await whileHeld(approving, () => call(requester.client, "PUT", `${k.P}/request/items/${id}/answers`, { answers: { subject: "موضوعی که تأییدکننده ندید", details: "شرح دیگر" } }));
      expect(edited.status).toBe("fulfilled");
      expect([403, 409]).toContain((edited as PromiseFulfilledResult<{ status: number }>).value.status);
      const item = await k.ritm(id);
      expect(item.state).toBe("in_fulfilment");
      expect(item.answers.subject).toBe("موضوع تأییدشده");
    });

    it("A2-19: the sweep does not cancel an item whose requester answered while it ran", async () => {
      const id = await itemInWork();
      await k.o.db.query(`update sm_request_items set state = 'awaiting_info', info_since = now() - interval '90 days' where id = $1`, [id]);
      // the requester's answer moves the item back to work (locked, not committed) while the sweep runs
      const answering = hold(k.o.db, (tx) => transitionIn(tx, sys, "request_item", id, "in_fulfilment", {}, { trusted: true }));
      const swept = await whileHeld(answering, () => sweep(sys, Date.now()));
      expect(swept.status, message(swept)).toBe("fulfilled");
      expect((await k.ritm(id)).state).toBe("in_fulfilment");
    });
  });

  // --------------------------------------------------------------------------------------------------- knowledge

  describe("knowledge", () => {
    let w: KbWorld;
    beforeAll(async () => {
      resetRateLimits();
      resetRateBuckets();
      w = await kbWorld();
    }, 180_000);

    it("A2-5: a sub-category made while its parent is restricted inherits the restriction", async () => {
      const parent = (await w.o.post(`${w.P}/r/kb_category`, { name: `دستهٔ مادر ${pid}`, base_id: w.bases.guide })).row as Record<string, any>;
      expect(parent.c_all).toBe(true);
      const restricting = hold(w.e.db, (tx) => updateIn(tx, w.sys, "kb_category", parent.id, { read_mode: "audience", read_groups: [w.g.network] }, { trusted: true }));
      const made = await whileHeld(restricting, () => w.sys.write((tx) => createIn(tx, w.sys, "kb_category", { name: `زیردسته ${pid}`, base_id: w.bases.guide, parent_id: parent.id }, { trusted: true })));
      expect(made.status, message(made)).toBe("fulfilled");
      const kid = (made as PromiseFulfilledResult<Record<string, any>>).value;
      const row = (await w.e.db.one<Record<string, any>>(`select c_all, c_groups from sm_kb_categories where id = $1`, [kid.id]))!;
      expect(row.c_all).toBe(false);
      expect(row.c_groups).toEqual([w.g.network]);
    });

    it("A2-6: an approval of an earlier text never publishes a text resubmitted after it", async () => {
      const C1 = "## گام‌ها\n\n1. متن نخست که تأیید شد\n2. گام دوم\n";
      const C2 = "## گام‌ها\n\n1. متن تازه‌ای که کسی تأیید نکرد\n2. گام دوم\n";
      const r = await w.article({ title: `مقالهٔ تأیید ${pid}`, body: C1 });
      const v = await w.submit(r.version.id);
      expect(v.state).toBe("in_review");
      const mine = (await w.o.get(`${w.P}/approvals/mine`)).approvals as { id: string; table_key: string; record_id: string }[];
      const a = mine.find((x) => x.table_key === "kb_version" && x.record_id === r.version.id)!;
      // approved; the event's job has not run when the author withdraws, edits and resubmits the version
      await w.o.post(`${w.P}/approvals/${a.id}/decide`, { decision: "approved" });
      await call(w.p.km.client, "POST", `${w.P}/knowledge/versions/${r.version.id}/withdraw`, {});
      await call(w.p.km.client, "PATCH", `${w.P}/r/kb_version/${r.version.id}`, { body: C2 });
      await call(w.p.km.client, "POST", `${w.P}/knowledge/versions/${r.version.id}/submit`, {});
      await w.drain();
      const article = (await w.e.db.one<Record<string, any>>(`select body, state from sm_kb_articles where id = $1`, [r.article.id]))!;
      // (stored texts are trimmed)
      expect(String(article.body).trim()).not.toBe(C2.trim());
      expect(article.state).toBe("published");
      expect(String(article.body).trim()).toBe(C1.trim());
    });

    /** Hold the record counter of `table` (every create of the table waits there, after its checks decided). */
    const holdNumbers = async (table: string) => {
      await w.e.db.query(`insert into sm_numbers (org_id, table_key, last) values ($1, $2, 0) on conflict do nothing`, [w.e.org, table]);
      return hold(w.e.db, (tx) => tx.query(`select 1 from sm_numbers where org_id = $1 and table_key = $2 for update`, [w.e.org, table]));
    };
    const published = async (title: string) => w.published({ base_id: w.bases.guide, title: `${title} ${pid}`, body: "## گام‌ها\n\n1. یک کار\n2. کار دیگر\n" });

    it("A2-20: two editors starting a draft of one article at once make one draft", async () => {
      const a = await published("مقالهٔ دو پیش‌نویس");
      const numbers = await holdNumbers("kb_version");
      const both = await whileHeld(numbers, () => Promise.all([0, 1].map(() => call(w.p.km.client, "POST", `${w.P}/knowledge/articles/${a.id}/draft`, {}))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const statuses = (both as PromiseFulfilledResult<{ status: number }[]>).value.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      const open = await w.e.db.query(`select id from sm_kb_versions where article_id = $1 and state in ('draft', 'in_review', 'scheduled') and deleted_at is null`, [a.id]);
      expect(open.length).toBe(1);
    });

    it("A2-21/A2-22: votes at once are all counted, and one member's double vote is one vote", async () => {
      const a = await published("مقالهٔ رأی هم‌زمان");
      const vote = (c: typeof w.p.req.client) => call(c, "POST", `${w.P}/knowledge/articles/${a.id}/vote`, { helpful: true });
      // the article is held by a write of its own while two readers vote, then while one reader votes twice
      let holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_kb_articles where id = $1 for update`, [a.id]));
      let both = await whileHeld(holder, () => Promise.all([vote(w.p.req.client), vote(w.p.agent.client)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      expect(Number((await w.e.db.one<{ n: number }>(`select helpful_yes as n from sm_kb_articles where id = $1`, [a.id]))!.n)).toBe(2);
      holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_kb_articles where id = $1 for update`, [a.id]));
      both = await whileHeld(holder, () => Promise.all([vote(w.p.req2.client), vote(w.p.req2.client)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const mine = await w.e.db.query(`select id from sm_kb_feedback where article_id = $1 and user_id = $2 and deleted_at is null`, [a.id, w.p.req2.userId]);
      expect(mine.length).toBe(1);
      expect(Number((await w.e.db.one<{ n: number }>(`select helpful_yes as n from sm_kb_articles where id = $1`, [a.id]))!.n)).toBe(3);
    });

    it("A2-23: two readers flagging one article at once make one flag task", async () => {
      const a = await published("مقالهٔ گزارش هم‌زمان");
      const numbers = await holdNumbers("kb_task");
      const flag = (c: typeof w.p.req.client) => call(c, "POST", `${w.P}/knowledge/articles/${a.id}/flag`, { reason: "outdated" });
      const both = await whileHeld(numbers, () => Promise.all([flag(w.p.req.client), flag(w.p.agent.client)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const tasks = await w.e.db.query<{ feedback_count: number }>(`select feedback_count from sm_kb_tasks where article_id = $1 and kind = 'flag' and active and deleted_at is null`, [a.id]);
      expect(tasks.length).toBe(1);
      expect(Number(tasks[0].feedback_count)).toBe(2);
    });
  });

  // ------------------------------------------------------------------------------------------------------ devops

  describe("devops", () => {
    let w: ReleaseWorld;
    let generic: { id: string; key: string; secret: string };
    beforeAll(async () => {
      resetRateLimits();
      resetRateBuckets();
      w = await releaseWorld();
      await w.p.rm.client.post(`${w.P}/devops/seed`, {});
      const made = (await w.p.rm.client.post(`${w.P}/r/devops_connection`, { name: "خط لولهٔ هم‌زمان", kind: "generic", auto_change: true, assignment_group_id: w.g.team })).row;
      const s = (await w.p.rm.client.post(`${w.P}/devops/connections/${made.id}/secret`, {})).secret as string;
      generic = { id: made.id, key: made.hook_key, secret: s };
    }, 180_000);

    const sign = (s: string, raw: string) => `sha256=${createHmac("sha256", s).update(raw).digest("hex")}`;
    const send = async (body: unknown, delivery: string) => {
      const raw = JSON.stringify(body);
      const res = await w.e.app.fetch(new Request(`http://local.test/api/public/devops/hooks/${generic.key}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.30", "x-delivery-id": delivery, "x-hub-signature-256": sign(generic.secret, raw) }, body: raw }));
      return { status: res.status, body: await res.json() };
    };
    const deploy = (id: string, environment: string, status: string) => ({ type: "deployment", id, environment, status, version: "5.0.0", repository: "acme/race", pipeline: "race" });

    it("A2-7: two gates opened at once keep one unbroken evidence chain, and a retried run gets one gate", async () => {
      const { sys, conn } = await openConnection(w.e.cfg, generic.key);
      const open = (run: string) => (tx: Tx) => openGateIn(tx, sys, conn, { environment: "prod", version: "5.1.0", run });
      const first = hold(w.e.db, open(`r1-${pid}`));
      const second = await whileHeld(first, () => sys.write(open(`r2-${pid}`)));
      expect(second.status, message(second)).toBe("fulfilled");
      const v = await verifyChain(sys);
      expect(v).toMatchObject({ ok: true, broken: null });
      // the same run asked twice at once: one gate, one automatic change
      const again = hold(w.e.db, open(`r3-${pid}`));
      const twin = await whileHeld(again, () => sys.write(open(`r3-${pid}`)));
      expect(twin.status, message(twin)).toBe("fulfilled");
      const gates = await w.e.db.query<{ change_id: string | null }>(`select change_id from sm_change_gates where org_id = $1 and run_ref = $2 and deleted_at is null`, [w.e.org, `r3-${pid}`]);
      expect(gates.length).toBe(1);
      const changes = await w.e.db.query(`select id from sm_change_requests where org_id = $1 and external_ref = $2 and deleted_at is null`, [w.e.org, `deploy:gate:r3-${pid}`]);
      expect(changes.length).toBeLessThanOrEqual(1);
      expect((await verifyChain(sys)).ok).toBe(true);
    });

    it("A2-8: the deployment and deployment_status deliveries of one deployment at once make one deployment and one change", async () => {
      // the repository and pipeline exist (an earlier delivery), so only the deployment is new
      expect((await send(deploy(`warm-${pid}`, "qa", "succeeded"), `warm-${pid}`)).body.status).toBe("processed");
      const id = `race${pid}`;
      // the generic connection's deployment ids are stored as `dep:<id>`
      const ext = `dep:${id}`;
      const numbers = hold(w.e.db, (tx) => tx.query(`select 1 from sm_numbers where org_id = $1 and table_key = 'deployment' for update`, [w.e.org]));
      const both = await whileHeld(numbers, () => Promise.all([send(deploy(id, "production", "queued"), `${id}-a`), send(deploy(id, "production", "succeeded"), `${id}-b`)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const answers = (both as PromiseFulfilledResult<{ body: { status: string } }[]>).value;
      expect(answers.map((a) => a.body.status)).toEqual(["processed", "processed"]);
      const deps = await w.e.db.query<{ state: string; change_id: string | null }>(`select state, change_id from sm_deployments where org_id = $1 and external_id = $2 and deleted_at is null`, [w.e.org, ext]);
      expect(deps.length).toBe(1);
      expect(deps[0].state).toBe("succeeded");
      const changes = await w.e.db.query(`select id from sm_change_requests where org_id = $1 and external_ref = $2 and deleted_at is null`, [w.e.org, `deploy:${ext}`]);
      expect(changes.length).toBe(1);
      await sleep(10);
    });

    it("A2-25: two overlapping bookings of one environment approved at once: the second is refused", async () => {
      const env = w.env.staging ?? w.env.test;
      expect(env).toBeTruthy();
      const book = async (from: number, to: number) =>
        w.sys.write((tx) => createIn(tx, w.sys, "environment_booking", { environment_id: env, purpose: "آزمون هم‌زمانی", start_at: at(50, from), end_at: at(50, to) }, { trusted: true }));
      const [b1, b2] = [await book(10, 12), await book(11, 13)];
      const approve = (id: string) => (tx: Tx) => transitionIn(tx, w.sys, "environment_booking", id, "approved", {}, { trusted: true });
      const first = hold(w.e.db, approve(b1.id));
      const second = await whileHeld(first, () => w.sys.write(approve(b2.id)));
      expect(second.status).toBe("rejected");
      expect(message(second)).toContain("رزرو شده است");
      const approved = await w.e.db.query(`select id from sm_environment_bookings where environment_id = $1 and state = 'approved' and deleted_at is null and id = any($2::uuid[])`, [env, `{${b1.id},${b2.id}}`]);
      expect(approved.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------- incident, problem

  describe("incident and problem", () => {
    let w: IncidentWorld;
    beforeAll(async () => {
      resetRateLimits();
      resetRateBuckets();
      w = await incidentWorld();
    }, 180_000);

    it("A2-14: two incidents linked to one problem at once are both counted", async () => {
      const problem = (await w.o.post(`${w.P}/r/problem`, { short_description: `مشکل شمارش ${pid}` })).row as Record<string, any>;
      const [i1, i2] = [await w.incident({ short_description: "رخداد نخست" }), await w.incident({ short_description: "رخداد دوم" })];
      const link = (id: string) => (tx: Tx) => updateIn(tx, w.sys, "incident", id, { problem_id: problem.id }, { trusted: true });
      // the problem is held by a write of its own while both links are counted
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_problems where id = $1 for update`, [problem.id]));
      const both = await whileHeld(holder, () => Promise.all([w.sys.write(link(i1.id)), w.sys.write(link(i2.id))]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      expect(Number((await w.e.db.one<{ n: number }>(`select incident_count as n from sm_problems where id = $1`, [problem.id]))!.n)).toBe(2);
    });

    it("A2-17: the automatic review draft and a manager's request at once make one review", async () => {
      const inc = await w.incident({ short_description: `رخداد عمدهٔ بازبینی ${pid}` });
      await w.e.db.query(`insert into sm_numbers (org_id, table_key, last) values ($1, 'incident_review', 0) on conflict do nothing`, [w.e.org]);
      const numbers = hold(w.e.db, (tx) => tx.query(`select 1 from sm_numbers where org_id = $1 and table_key = 'incident_review' for update`, [w.e.org]));
      const both = await whileHeld(numbers, () => Promise.all([draftReview(w.sys, inc.id), call(w.o, "POST", `${w.P}/incident/${inc.id}/review`, {})]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const reviews = await w.e.db.query(`select id from sm_incident_reviews where incident_id = $1 and state <> 'canceled' and deleted_at is null`, [inc.id]);
      expect(reviews.length).toBe(1);
    });

    it("A2-26: one situation raised twice at once becomes one incident", async () => {
      const key = `SIT:race-${pid}`;
      await w.e.db.query(`insert into sm_numbers (org_id, table_key, last) values ($1, 'incident', 0) on conflict do nothing`, [w.e.org]);
      const numbers = hold(w.e.db, (tx) => tx.query(`select 1 from sm_numbers where org_id = $1 and table_key = 'incident' for update`, [w.e.org]));
      const raise = (source: string) => w.sys.write((tx) => createFromAlert(tx, w.sys, { key, title: "سرویس پرداخت در دسترس نیست", source, severity: "major" }));
      const both = await whileHeld(numbers, () => Promise.all([raise("پایش نخست"), raise("پایش دوم")]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const made = (both as PromiseFulfilledResult<{ created: boolean }[]>).value.map((r) => r.created).sort();
      expect(made).toEqual([false, true]);
      const rows = await w.e.db.query(`select id from sm_incidents where org_id = $1 and external_ref = $2 and deleted_at is null`, [w.e.org, key]);
      expect(rows.length).toBe(1);
    });
  });
});
