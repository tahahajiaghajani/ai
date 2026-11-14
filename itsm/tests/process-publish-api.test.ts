// F4c — publishing workflows and the hub (design F §3.5 «Publish», §4, §6.1, §6.7, §8.3–8.4):
//   · a designer drafts but cannot publish; publishing needs `process_design` approve and a recent sign-in, writes the
//     version with its form snapshot, and is recorded in «گزارش رویدادها»;
//   · the diff names the access settings, and the publish's propagation reaches every case of the process;
//   · «نسخه‌ها», «بازگرداندن به پیش‌نویس» and «بازنشسته‌کردن» (no new cases);
//   · the hub lists the nine kinds for an administrator, with the processes' open cases and the roles notice;
//   · the workflows' notification rules are seeded once to an organisation that existed before (by the first
//     publish's job): a rule the administrator deletes stays deleted.
import { describe, it, expect, beforeAll } from "vitest";
import { removeIn } from "@server/engine";
import { seedNotices, NOTICE_SEEDS } from "@server/modules/process/api";
import { act, openTask } from "./process-engine-helpers";
import { ageSession, bank, pettyDraft, type Bank } from "./process-api-helpers";

let b: Bank;
let P = "";
let procId = "";
const cases: string[] = [];
const db = () => b.w.o.db;

beforeAll(async () => {
  b = await bank();
  P = b.w.P;
  // an organisation that existed before F4c: no seeding job waits for it
  await db().query(`delete from sm_jobs where org_id = $1 and kind = 'process.seed'`, [b.w.o.org]);
}, 600_000);

describe("publish (design F §3.5)", () => {
  it("a designer drafts but cannot publish; publishing needs approve and a recent sign-in, and is audited", async () => {
    const d = b.M.designer.client;
    const made = await d.post(`${P}/process/defs`, { name: "درخواست تنخواهِ شعبه", key: "petty_cash" }, 201);
    procId = made.process.id;
    expect(made.can).toMatchObject({ read: true, write: true, publish: false });
    expect(made.unpublished).toBe(true);
    const saved = await d.put(`${P}/process/defs/${procId}/draft`, { draft: pettyDraft(b) });
    expect(saved.problems.filter((p: { level: string }) => p.level === "error")).toEqual([]);
    expect((await d.post(`${P}/process/defs/${procId}/publish`, {}, 403)).error.message).toBe("انتشار با مسئول انتشار است");

    const pb = b.M.publisher;
    await ageSession(b, pb.userId);
    expect((await pb.client.post(`${P}/process/defs/${procId}/publish`, {}, 401)).error.code).toBe("reauth_required");
    await db().query(`update sm_sessions set reauth_at = now() where user_id = $1`, [pb.userId]);
    const pub = await pb.client.post(`${P}/process/defs/${procId}/publish`, { note: "نخستین انتشار" });
    expect(pub).toMatchObject({ version: { version_no: 1 }, diff: { first: true }, propagated: 0, message: "نسخهٔ ۱ منتشر شد؛ پرونده‌های تازه با آن آغاز می‌شوند" });
    expect(await db().one(`select status, version_no, current_version_id, published_by from sm_processes where id = $1`, [procId])).toMatchObject({
      status: "published", version_no: 1, current_version_id: pub.version.id, published_by: pb.userId,
    });
    const v = await db().one<{ forms: any; steps: any; starters: any[]; note: string }>(`select forms, steps, starters, note from sm_process_versions where id = $1`, [pub.version.id]);
    expect(Object.keys(v!.forms.forms).sort()).toEqual([b.w.forms.req, b.w.forms.review].sort());
    expect(Object.keys(v!.steps).sort()).toEqual(["a1", "a2", "pay", "s"]);
    expect(v!.starters).toHaveLength(2);
    expect(v!.note).toBe("نخستین انتشار");
    // the forms it took are published with it
    expect((await db().query<{ status: string }>(`select status from sm_forms where id = any($1::uuid[])`, [`{${b.w.forms.req},${b.w.forms.review}}`])).map((f) => f.status)).toEqual(["published", "published"]);
    expect(await db().query(`select action, user_id from sm_audit where org_id = $1 and entity_id = $2`, [b.w.o.org, procId])).toContainEqual({ action: "process.publish", user_id: pb.userId });
  });

  it("a draft with errors is refused, with its problems", async () => {
    const d = b.M.designer.client;
    const bad = await d.post(`${P}/process/defs`, { name: "گردش‌کار ناقص", key: "broken_one" }, 201);
    const draft = pettyDraft(b);
    draft.graph.nodes = draft.graph.nodes.filter((n) => n.id !== "pay");
    await d.put(`${P}/process/defs/${bad.process.id}/draft`, { draft });
    const r = await b.M.publisher.client.post(`${P}/process/defs/${bad.process.id}/publish`, {}, 400);
    expect(r.error.code).toBe("invalid_process");
    expect(r.error.details.problems.some((p: { level: string }) => p.level === "error")).toBe(true);
    expect((await db().one<{ status: string }>(`select status from sm_processes where id = $1`, [bad.process.id]))!.status).toBe("draft");
  });

  it("the diff names the access settings, and the publish reaches every case of the process", async () => {
    // two cases on version 1: one still open, one rejected
    for (const amount of ["300000000", "900000000"]) {
      const r = await b.M.clerk.client.post(`${P}/process/start`, { process: "petty_cash", values: { u_amount: amount, u_branch: b.U.vanak } }, 201);
      expect(r.result).toBe("applied");
      cases.push(r.case);
    }
    await b.w.k.drain();
    await act(b.w, b.M.head.userId, await openTask(b.w, cases[1], "a1", b.M.head.userId), { outcome: "rejected", comment: "بیش از سقف" });
    await b.w.k.drain();
    expect((await db().one<{ state: string }>(`select state from sm_process_cases where id = $1`, [cases[1]]))!.state).toBe("rejected");

    await b.M.designer.client.put(`${P}/process/defs/${procId}/draft`, { draft: pettyDraft(b, { managers: [b.M.mgr.userId], confidential: true, headRights: { u_need: "edit" } }) });
    const preview = await b.M.publisher.client.get(`${P}/process/defs/${procId}/diff`);
    expect(preview.diff.access).toEqual(["مسئولان: + مینا مسئول تنخواه", "محرمانه: روشن"]);
    expect(preview.diff.changes).toEqual(["حقوق فیلد «شرح نیاز» در «تأیید رئیس شعبه» تغییر کرد"]);
    expect(preview).toMatchObject({ can_publish: true, next_version: 2 });

    const pub = await b.M.publisher.client.post(`${P}/process/defs/${procId}/publish`, {});
    expect(pub).toMatchObject({ version: { version_no: 2 }, propagated: 2 });
    for (const id of cases) {
      expect(await db().one(`select managers, confidential from sm_process_cases where id = $1`, [id])).toEqual({ managers: [b.M.mgr.userId], confidential: true });
    }
    // the new manager reads both cases (the open one and the closed one)
    for (const id of cases) await b.M.mgr.client.get(`${P}/process/cases/${id}`);
    expect((await db().one<{ diff: any }>(`select diff from sm_process_versions where id = $1`, [pub.version.id]))!.diff.access).toContain("محرمانه: روشن");
  });

  it("«نسخه‌ها» lists the versions with their diffs; «بازگرداندن به پیش‌نویس» restores one; retiring stops new cases", async () => {
    const d = b.M.designer.client;
    const list = await d.get(`${P}/process/defs/${procId}/versions`);
    expect(list.versions.map((v: { version_no: number; current: boolean }) => [v.version_no, v.current])).toEqual([[2, true], [1, false]]);
    expect(list.display[b.M.publisher.userId]).toBe("پرویز مسئول انتشار");
    const v1 = list.versions[1].id;
    const restored = await d.post(`${P}/process/defs/${procId}/versions/${v1}/restore`, {});
    expect(restored.draft).toMatchObject({ managers: [], confidential: false });
    expect(restored.unpublished).toBe(true);

    expect((await d.post(`${P}/process/defs/${procId}/retire`, {}, 403)).error.message).toBe("انتشار با مسئول انتشار است");
    const retired = await b.M.publisher.client.post(`${P}/process/defs/${procId}/retire`, {});
    expect(retired).toMatchObject({ status: "retired", open_cases: 1, message: "گردش‌کار بازنشسته شد؛ ۱ پروندهٔ باز با نسخهٔ خود به پایان می‌رسد" });
    const refused = await b.M.clerk.client.post(`${P}/process/start`, { process: "petty_cash", values: { u_amount: "1000" } }, 409);
    expect(refused.error.message).toBe("این گردش‌کار بازنشسته شده است و درخواست تازه نمی‌پذیرد");
    expect(await db().query(`select action from sm_audit where org_id = $1 and entity_id = $2 order by at`, [b.w.o.org, procId])).toContainEqual({ action: "process.retire" });
    // the open case still finishes on its version
    await act(b.w, b.M.head.userId, await openTask(b.w, cases[0], "a1", b.M.head.userId), { outcome: "approved" });
    await b.w.k.drain();
    expect((await db().query<{ step_key: string }>(`select step_key from sm_process_tasks where case_id = $1 and status = 'open'`, [cases[0]])).map((t) => t.step_key)).toEqual(["pay", "pay"]);
  });
});

describe("the hub (design F §4, §8.3)", () => {
  it("lists the nine kinds for an administrator, with the processes' open cases and the roles notice", async () => {
    const own = b.w.o.owner;
    await own.put(`${P}/access/roles/read_only_agent`, { name: "کارشناس فقط‌خواندنی", persona: "agent", grants: { incident: { read: "all" } }, field_groups: [], contains: [], workspaces: "member", domains: "own" });
    await b.w.k.flow({ name: "یادآوری روزانه" }, { nodes: [{ id: "trigger", type: "trigger", config: {} }], edges: [] });
    const hub = await own.get(`${P}/process/hub`);
    expect(hub.kinds.map((k: { key: string }) => k.key)).toEqual(["process", "lifecycle", "change_model", "approval_rule", "flow", "catalog_flow", "catalog_tasks", "journey", "playbook"]);
    expect(hub.kinds.map((k: { label: string }) => k.label)).toEqual([
      "گردش‌کارهای سازمانی", "چرخهٔ عمر رکوردها", "مدل‌های تغییر", "قواعد تأیید", "جریان‌های خودکار", "جریان‌های تأمین کاتالوگ", "برنامه‌های انجام کاتالوگ", "سفرهای کارکنان", "دستورالعمل‌های پاسخ امنیتی",
    ]);
    expect(hub.rows.find((r: { id: string }) => r.id === procId)).toMatchObject({ kind: "process", status: "بازنشسته", open_cases: 1, editable: "all", editor: `settings/workflows/p/${procId}` });
    expect(hub.rows.find((r: { kind: string; table: string }) => r.kind === "lifecycle" && r.table === "incident")).toMatchObject({ editable: "safe", status: "پیش‌فرض", editor: "settings/workflows/states/incident" });
    expect(hub.rows.find((r: { kind: string; table: string }) => r.kind === "lifecycle" && r.table === "change_request")).toMatchObject({ editable: "labels" });
    expect(hub.rows.find((r: { kind: string; name: string }) => r.kind === "flow" && r.name === "یادآوری روزانه")).toMatchObject({ status: "پیش‌نویس", module: "جریان‌های خودکار" });
    expect(hub.kinds.find((k: { key: string }) => k.key === "lifecycle").count).toBeGreaterThan(5);
    const roles = hub.notices.find((n: { kind: string }) => n.kind === "roles_without_work");
    expect(roles.roles.map((r: { key: string }) => r.key)).toContain("read_only_agent");
    expect(hub.rules.map((r: { link: string }) => r.link)).toContain("sla/business-rules");
    expect(hub).toMatchObject({ empty: false, can: { create: true, publish: true } });
    // «افزودن حق»: the role gains `work` create, and the notice goes
    await own.post(`${P}/process/hub/roles/read_only_agent/work`, {});
    expect((await own.get(`${P}/process/hub`)).notices.some((n: { kind: string; roles?: { key: string }[] }) => n.roles?.some((r) => r.key === "read_only_agent"))).toBe(false);
    // a designer sees the hub; a requester does not
    expect((await b.M.designer.client.get(`${P}/process/hub`)).kinds).toHaveLength(9);
    await b.M.clerk.client.get(`${P}/process/hub`, 403);
  });
});

describe("notification seeds (design F §3.5)", () => {
  it("are applied once to an organisation that existed before: by the first publish's job, and never again", async () => {
    const rules = () => db().query<{ name: string }>(`select name from sm_notification_rules where org_id = $1 and table_key = 'process_case' and deleted_at is null order by name`, [b.w.o.org]);
    // the publishes queued the seeding job; it has run with the drains above
    await db().query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'process.seed' and status = 'queued'`, [b.w.o.org]);
    await b.w.k.drain();
    expect((await rules()).map((r) => r.name).sort()).toEqual(NOTICE_SEEDS.map((s) => s.name).sort());
    expect((await db().one<{ n: number }>(`select count(*)::int as n from sm_notification_templates where org_id = $1 and table_key = 'process_case' and deleted_at is null`, [b.w.o.org]))!.n).toBe(NOTICE_SEEDS.length);
    // the administrator removes one: a later run (another publish, a restart) does not bring it back
    const one = await db().one<{ id: string }>(`select id from sm_notification_rules where org_id = $1 and name = $2`, [b.w.o.org, "گردش‌کار شما لغو شد"]);
    await b.w.sys.write((tx) => removeIn(tx, b.w.sys, "notification_rule", one!.id));
    expect(await seedNotices(b.w.o.cfg, b.w.o.org)).toMatchObject({ skipped: true });
    expect(await rules()).toHaveLength(NOTICE_SEEDS.length - 1);
  });
});
