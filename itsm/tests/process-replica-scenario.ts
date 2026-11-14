// The §3.7 example with linked Windows apps (design F §3.6.3, §6.5, §7.1–7.2; F4b acceptance), shared by the PGlite
// suite (tests/process-sync-replica.test.ts) and the PostgreSQL one (tests/process-pg.test.ts): the authority is the web
// version, the requester and the payer work on Windows apps linked to it —
//   · the requester's app renders and validates the start step from the published version's snapshot alone — it
//     holds no `field_def` row (the requester persona does not read «طراحی فرم و گردش‌کار»);
//   · an offline start is recorded «در صف ارسال», pushed, and the authority creates the case once and runs it;
//   · the branch head and the finance deputy decide online; the payer pays offline (an incomplete submission is
//     refused by the authority with its message, the task staying open), and both apps pull the finished case;
//   · a standalone app with an open case is refused the upload link.
// Each suite file runs it once: a Windows app remembers for a minute which organisation it is linked to.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog, signupWithOrg } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { makeCtx, type AuthUser, type Ctx, type DesktopBridge, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { createIn, systemCtx } from "@server/engine";
import { checkFormValues } from "@server/modules/forms";
import { startCase, submitTask } from "@server/modules/process/engine";
import { effectiveRights, fieldItems } from "@shared/forms/layout";
import { readSnapshot, snapshotFields } from "@shared/forms/snapshot";
import { formStepOf, startOf } from "@shared/process/graph";
import { uuidv7 } from "@shared/id";
import { act, edge, kase, node, openTask, publish, world, type Published, type World } from "./process-engine-helpers";

interface Desk {
  db: Db;
  client: SyncClient;
  ctx: () => Promise<Ctx>;
}

const PASS = "replica-pass-1405";

export function replicaScenario(label: string): void {
  describe(label, () => {
    let w: World;
    let proc: Published;
    const U: Record<string, string> = {};
    const desks: Record<string, Desk> = {};
    let caseId = "";

    async function link(email: string): Promise<Desk> {
      const bridge = { notifyLocalWrite() {}, fetchBlob: async () => null, info: async () => ({ cloud: { linked: true, org_id: w.o.org } }) } as unknown as DesktopBridge;
      const desk = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
      const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => w.o.app.fetch(new Request(String(u), init))) as typeof fetch;
      const client = new SyncClient({ db: desk.db, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
      await client.link({ url: "http://cloud.test", email, password: PASS, orgId: w.o.org, direction: "download" });
      const cfg: ServerConfig = { mode: "desktop", db: desk.db, secret: "desktop-secret", allowSignup: false, platformAdmins: [], origin: "desk", log: quietLog, fetch: cloudFetch, desktop: bridge };
      const ctx = async () => {
        const user = (await desk.db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where email = $1`, [email]))!;
        const org = (await desk.db.one<OrgRow>(`select * from sm_orgs where id = $1`, [w.o.org]))!;
        const member = (await desk.db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2`, [w.o.org, user.id]))!;
        return makeCtx(cfg, user, org, member);
      };
      return { db: desk.db, client, ctx };
    }

    beforeAll(async () => {
      w = await world();
      for (const [k, name, roles] of [["r", "کارمند شعبه", ["requester"]], ["h", "رئیس شعبه", ["requester"]], ["fd", "معاون مالی", ["requester"]], ["pay", "امور مالی", ["requester"]]] as const) {
        const email = `rep-${k}-${uuidv7().slice(-6)}@bank.test`;
        U[k] = (await w.o.owner.post(`${w.P}/members`, { email, password: PASS, full_name: name, role: "member" })).user_id ?? "";
        if (!U[k]) U[k] = (await w.o.db.one<{ id: string }>(`select id from sm_users where email = $1`, [email]))!.id;
        await w.o.owner.put(`${w.P}/access/members/${U[k]}`, { roles });
        U[`${k}:email`] = email;
      }
      const F = w.forms;
      proc = await publish(
        w,
        {
          nodes: [
            node("t", "trigger"),
            node("s", "form_step", { action: "fill", start: true, form: F.req, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
            node("h", "form_step", { action: "approve", form: F.review, rights: { default: "read", fields: {} }, assignees: [{ kind: "users", users: [U.h] }] }, "تأیید رئیس شعبه"),
            node("b", "branch", { mode: "data", rules: [{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }] }, "شرط مبلغ"),
            node("fd", "form_step", { action: "approve", form: F.review, rights: { default: "read", fields: {} }, assignees: [{ kind: "users", users: [U.fd] }] }, "تأیید معاونت مالی"),
            node("pay", "form_step", { action: "fill", form: F.review, rights: { default: "read", fields: { u_finance_note: "required" } }, assignees: [{ kind: "users", users: [U.pay] }] }, "بررسی و پرداخت"),
            node("ok", "end", { outcome: "completed" }),
            node("no", "end", { outcome: "rejected" }),
          ],
          edges: [
            edge("t", "s"), edge("s", "h"), edge("h", "b", "approved"), edge("h", "no", "rejected"), edge("b", "fd", "yes"), edge("b", "pay", "no"),
            edge("fd", "pay", "approved"), edge("fd", "no", "rejected"), edge("pay", "ok"),
          ],
        },
        { name: "درخواست تنخواهِ شعبه", title: "تنخواه {{case.u_amount}}" },
      );
      desks.r = await link(U["r:email"]);
      desks.pay = await link(U["pay:email"]);
    }, 600_000);

    it("the requester's app renders and validates the start step offline, with no field_def row", async () => {
      const d = desks.r.db;
      expect((await d.one<{ n: number }>(`select count(*)::int as n from sm_field_defs where org_id = $1`, [w.o.org]))!.n).toBe(0);
      const v = (await d.one<{ graph: any; forms: unknown }>(`select graph, forms from sm_process_versions where id = $1`, [proc.version]))!;
      const snapshot = readSnapshot(v.forms)!;
      const step = formStepOf(startOf(v.graph).start!.config);
      const form = snapshot.forms[step.form!];
      const defs = snapshotFields(snapshot);
      const rights = effectiveRights(form.layout, step.rights, defs, { groups: [] });
      // the form as the requester sees it: its fields, labels and rights from the snapshot alone
      expect(fieldItems(form.layout).map((i) => [i.field, defs.get(i.field)?.label, rights[i.field]])).toEqual([
        ["u_amount", "مبلغ درخواستی", "required"], ["u_need", "شرح نیاز", "edit"], ["u_date", "تاریخ نیاز", "edit"], ["u_invoice", "فاکتور پیش", "edit"], ["u_branch", "شعبه", "edit"],
      ]);
      const bad = checkFormValues(snapshot, step.form!, { u_amount: "3000000000", u_date: "1300-01-01" }, { rights, tz: "Asia/Tehran", requireAll: true });
      expect(Object.keys(bad.problems).sort()).toEqual(["u_amount", "u_date"]);
      expect(checkFormValues(snapshot, step.form!, { u_amount: "750000000", u_need: "خرید چاپگر" }, { rights, tz: "Asia/Tehran", requireAll: true }).problems).toEqual({});
    }, 120_000);

    it("an offline start waits «در صف ارسال», is pushed, and the authority creates the case once and runs it", async () => {
      caseId = uuidv7();
      const r = await startCase(await desks.r.ctx(), { process: proc.process, case_id: caseId, values: { u_amount: "750000000", u_need: "خرید چاپگر" } });
      expect(r).toMatchObject({ result: "pending", case: caseId });
      // nothing advances on the app itself
      expect(await desks.r.db.one(`select 1 as x from sm_process_cases where id = $1`, [caseId])).toBeNull();
      await desks.r.client.syncNow();
      await w.k.drain();
      expect(await kase(w, caseId)).toMatchObject({ state: "active", title: "تنخواه ۷۵۰٬۰۰۰٬۰۰۰ ریال", current_steps: [{ key: "h", label: "تأیید رئیس شعبه" }] });
      await desks.r.client.syncNow();
      expect(await desks.r.db.one(`select state from sm_process_cases where id = $1`, [caseId])).toEqual({ state: "active" });
      expect(await desks.r.db.one(`select result from sm_process_submissions where id = $1`, [r.submission])).toEqual({ result: "applied" });
    }, 120_000);

    it("decided online, paid offline on the payer's app, and the finished case reaches both apps", async () => {
      await act(w, U.h, await openTask(w, caseId, "h", U.h), { outcome: "approved" });
      await w.k.drain();
      await act(w, U.fd, await openTask(w, caseId, "fd", U.fd), { outcome: "approved" });
      await w.k.drain();
      await desks.pay.client.syncNow();
      const task = (await desks.pay.db.one<{ id: string }>(`select id from sm_process_tasks where case_id = $1 and step_key = 'pay' and status = 'open'`, [caseId]))!;
      expect(task).toBeTruthy();
      // an incomplete one is recorded too (the app shows it «در صف ارسال»); the authority refuses it with the message
      await expect(submitTask(await desks.pay.ctx(), task.id, { values: {} })).resolves.toMatchObject({ result: "pending" });
      const paid = await submitTask(await desks.pay.ctx(), task.id, { values: { u_finance_note: "پرداخت شد" } });
      expect(paid.result).toBe("pending");
      await desks.pay.client.syncNow();
      await w.k.drain();
      const subs = await w.o.db.query<{ id: string; result: string }>(`select id, result from sm_process_submissions where task_id = $1 order by created_at`, [task.id]);
      // the empty one was refused (required field), the second applied
      expect(subs.map((s) => s.result)).toEqual(["refused", "applied"]);
      expect(await kase(w, caseId)).toMatchObject({ state: "completed", data: { u_finance_note: "پرداخت شد" } });
      await desks.pay.client.syncNow();
      await desks.r.client.syncNow();
      expect(await desks.r.db.one(`select state from sm_process_cases where id = $1`, [caseId])).toEqual({ state: "completed" });
      expect(await desks.pay.db.one(`select result from sm_process_submissions where id = $1`, [paid.submission])).toEqual({ result: "applied" });
    }, 120_000);

    it("a standalone app with an open case is refused the upload link", async () => {
      const desk = await makeServer({ mode: "desktop", config: { secret: "desktop-secret" } });
      const local = new Client(desk.app, "http://desk.test");
      const org = await signupWithOrg(local, { name: "شعبهٔ مستقل" });
      const cfg: ServerConfig = { mode: "desktop", db: desk.db, secret: "desktop-secret", allowSignup: true, platformAdmins: [], origin: "desk", log: quietLog, fetch: globalThis.fetch.bind(globalThis) };
      const sys = await systemCtx(cfg, org);
      await sys.write((tx) => createIn(tx, sys, "process_case", { title: "پروندهٔ باز", state: "active" }, { trusted: true }));
      const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => w.o.app.fetch(new Request(String(u), init))) as typeof fetch;
      const client = new SyncClient({ db: desk.db, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
      await expect(client.link({ url: "http://cloud.test", email: "owner@example.com", password: "s3cret-pass", direction: "upload" })).rejects.toThrow("پیش از پیوستن، ۱ پروندهٔ باز گردش‌کار را به پایان برسانید یا لغو کنید");
      expect(await w.o.db.one(`select 1 as x from sm_orgs where id = $1`, [org])).toBeNull();
      await desk.db.close?.();
    }, 120_000);
  });
}
