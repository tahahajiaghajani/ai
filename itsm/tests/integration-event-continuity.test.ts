// Event management, continuity and incidents together, with every other module installed in the same organisation
// (the supplier seed's underpinning-contract SLA and custom fields on incidents, ITAM's assets of CIs, analytics):
// correlated alerts raise one incident through the incident module's createFromAlert, with the incident module's
// SLAs (the UC one waits for its condition); declaring that incident major proposes an outage of its service, its
// resolution proposes the end; the on-call resolver serves the assignment rules («کشیک») and the notification
// service's `oncall` recipients; a Windows push of an alert takes its access anchors from the CI, never the push.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";
import { seedItamDefaults } from "@server/modules/itam";
import { seedSupplierDefaults } from "@server/modules/supplier";
import { seedFinancialDefaults } from "@server/modules/financial";
import { checkEnginePush } from "@server/engine/sync";
import { BY_ENTITY } from "@server/sync/registry";
import { memberCtx } from "@server/access";

let w: EventWorld;
let service = "";
let oncall = "";
type Row = Record<string, any>;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 200 })).rows as Row[];
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;
const clientOf = (userId: string) => Object.values(w.p).find((p) => p.userId === userId)!.client;

beforeAll(async () => {
  w = await eventWorld();
  await w.o.post(`${w.P}/incident/seed`, {});
  await w.o.post(`${w.P}/continuity/seed`, {});
  await seedItamDefaults(w.e.cfg, w.e.org);
  await seedSupplierDefaults(w.e.cfg, w.e.org);
  await seedFinancialDefaults(w.e.cfg, w.e.org);
  service = (await w.o.post(`${w.P}/r/service`, { name: "درگاه پرداخت", service_type: "business", state: "live", availability_target: "99.9", ci_id: w.ci.app })).row.id;
  await w.drain();
  const now = await w.o.get(`${w.P}/event/oncall/now`);
  oncall = (now.items as Row[]).find((i) => i.group_id === w.g.network)!.user_id;
}, 180_000);

describe("alerts → incidents with every module installed", () => {
  let incident = "";
  it("raises one incident for a correlated group through createFromAlert, with the incident module's SLAs", async () => {
    const s = await w.source({ name: "پایش پرداخت" });
    await w.send(s.key, [
      { title: "پایگاه دادهٔ db01 پاسخ نمی‌دهد", host: "db01", severity: "critical", check: "db", event_id: "x1" },
      { title: "سامانهٔ پرداخت خطای ۵۰۰ می‌دهد", ci: "سامانهٔ پرداخت", host: "pay-app", severity: "major", check: "http", event_id: "x2" },
    ]);
    await w.drain();
    const alerts = await q("alert", { f: "source_id", op: "eq", v: s.id });
    expect(alerts).toHaveLength(2);
    const fresh = await Promise.all(alerts.map((a) => one("alert", a.id)));
    incident = fresh[0].incident_id;
    expect(incident).toBeTruthy();
    expect(fresh[1].incident_id).toBe(incident);
    const inc = await one("incident", incident);
    expect(inc.channel).toBe("monitoring");
    // the supplier's custom fields are on the incident (in «داخلی»), empty
    const meta = await w.o.get(`${w.P}/meta/tables/incident`);
    const f = (meta.table.fields as Row[]).find((x) => x.name === "u_supplier_id");
    expect(f).toMatchObject({ group: "internal" });
    expect(inc.u_supplier_id ?? null).toBeNull();
    // SLAs: the incident module's attach; the underpinning contract's waits for «منتظر تأمین‌کننده»
    const timers = await w.e.db.query<Row>(`select t.*, d.name as def_name, d.type as def_type from sm_task_slas t join sm_sla_definitions d on d.id = t.definition_id where t.org_id = $1 and t.record_id = $2 and t.deleted_at is null`, [w.e.org, incident]);
    expect(timers.length).toBeGreaterThan(0);
    expect(timers.some((t) => t.def_type === "uc")).toBe(false);
    const links = (await w.o.get(`${w.P}/r/incident/${incident}/links`)).links as Row[];
    expect(links.filter((l) => l.kind === "raised")).toHaveLength(2);
  });

  it("starts the underpinning contract's clock only while the incident waits on a named supplier", async () => {
    const [supplier] = await q("supplier", { f: "name", op: "eq", v: "شرکت پشتیبانی شبکهٔ پارس (نمونه)" });
    await w.o.patch(`${w.P}/r/incident/${incident}`, { u_supplier_id: supplier.id, u_supplier_ticket: "PS-1001" });
    await w.o.post(`${w.P}/r/incident/${incident}/transition`, { to: "in_progress" }).catch(() => undefined);
    await w.o.post(`${w.P}/r/incident/${incident}/transition`, { to: "on_hold", data: { hold_reason: "awaiting_supplier" } });
    await w.drain();
    const held = await one("incident", incident);
    expect(held).toMatchObject({ state: "on_hold", u_supplier_id: supplier.id, u_supplier_ticket: "PS-1001" });
    const uc = await w.e.db.query<Row>(`select t.stage from sm_task_slas t join sm_sla_definitions d on d.id = t.definition_id where t.org_id = $1 and t.record_id = $2 and d.type = 'uc' and t.deleted_at is null`, [w.e.org, incident]);
    expect(uc).toHaveLength(1);
    expect(["in_progress", "warning"]).toContain(uc[0].stage);
    // a requester never sees the supplier fields of a ticket (field group «داخلی»)
    const req = await w.e.member("member", "caller@example.com");
    await w.o.put(`${w.P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
    const mine = (await req.client.post(`${w.P}/r/incident`, { short_description: "چاپگر کار نمی‌کند" })).row;
    await w.o.patch(`${w.P}/r/incident/${mine.id}`, { u_supplier_ticket: "PS-2002" });
    const seen = await req.client.get(`${w.P}/r/incident/${mine.id}`);
    expect(JSON.stringify(seen.row)).not.toContain("PS-2002");
    expect(((await req.client.get(`${w.P}/meta/tables/incident`)).table.fields as Row[]).some((x) => x.name === "u_supplier_ticket")).toBe(false);
  });

  it("declaring the incident major proposes an outage of its service; resolving it proposes the end", async () => {
    await w.o.patch(`${w.P}/r/incident/${incident}`, { service_id: service });
    await w.o.post(`${w.P}/incident/${incident}/major`, { action: "declare", reason: "پرداخت‌ها انجام نمی‌شود" });
    await w.drain();
    const [o] = await q("outage", { f: "incident_id", op: "eq", v: incident });
    expect(o).toMatchObject({ state: "proposed", service_id: service, proposed_by: "رخداد عمده" });
    await w.o.post(`${w.P}/r/incident/${incident}/transition`, { to: "in_progress" }).catch(() => undefined);
    await w.o.post(`${w.P}/r/incident/${incident}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "پایگاه داده بازگشت" } });
    await w.drain();
    expect((await one("outage", o.id)).end_at).toBeTruthy();
  });
});

describe("the on-call resolver serves assignment rules and notifications", () => {
  it("an assignment rule «کشیک» gives a new incident to whoever is on call for the group", async () => {
    await w.o.post(`${w.P}/r/assignment_rule`, { name: "شبکه به کشیک", table_key: "incident", condition: { f: "short_description", op: "contains", v: "سوییچ هسته" }, group_id: w.g.network, method: "oncall", sort_order: 1 });
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "سوییچ هسته قطع است" })).row;
    expect(inc.assignment_group_id).toBe(w.g.network);
    expect(inc.assigned_to).toBe(oncall);
  });

  it("a notification rule for those on call reaches the on-call person of the record's group, not the rest of the team", async () => {
    await w.o.post(`${w.P}/r/notification_rule`, { name: "به کشیک شبکه", table_key: "incident", event: "created", condition: { f: "short_description", op: "contains", v: "فیبر" }, recipients: { oncall: true }, channels: ["in_app"] });
    const inc = (await w.o.post(`${w.P}/r/incident`, { short_description: "فیبر ساختمان ۲ قطع شد", assignment_group_id: w.g.network })).row;
    await w.drain();
    const got = (await clientOf(oncall).get(`${w.P}/notify/inbox?limit=50`)).items as Row[];
    expect(got.some((i) => i.record_id === inc.id)).toBe(true);
    // the rule's recipients were resolved by the on-call source: its log names the on-call person only
    const log = await w.e.db.query<Row>(`select recipient_id from sm_notification_log where org_id = $1 and record_id = $2 and rule_name = $3`, [w.e.org, inc.id, "به کشیک شبکه"]);
    expect([...new Set(log.map((l) => String(l.recipient_id)))]).toEqual([oncall]);
  });
});

describe("a Windows push of an alert", () => {
  it("takes the alert's access anchors from its CI, never from the push", async () => {
    // the CI has anchors of its own (a company's or a domain's devices): the alert follows them
    const unit = (await w.o.post(`${w.P}/r/org_unit`, { name: "شرکت تابعه", kind: "company" })).row.id as string;
    await w.o.patch(`${w.P}/r/ci/${w.ci.db}`, { unit_id: unit }).catch(() => undefined);
    const [alert] = await q("alert", { f: "ci_id", op: "eq", v: w.ci.db });
    const stored = (await w.e.db.one<Row>(`select * from sm_alerts where id = $1`, [alert.id]))!;
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.e.ownerId);
    const agg = BY_ENTITY.get("alert")!;
    const foreign = "00000000-0000-7000-8000-00000000abcd";
    const row: Row = { ...stored, unit_id: foreign, domain_id: foreign, short_description: "تغییر از ویندوز" };
    const refusal = await ctx.write((tx) => checkEnginePush(tx, ctx, agg, { entity: "alert", id: alert.id, rev: 0, row } as never, {}));
    expect(refusal).toBeNull();
    expect(row.unit_id ?? null).toBe(stored.unit_id ?? null);
    expect(row.domain_id ?? null).toBe(stored.domain_id ?? null);
  });

  it("holds pushed rules to the module's checks (an ignore rule needs a condition)", async () => {
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.p.mgr.userId);
    const agg = BY_ENTITY.get("event_rule")!;
    const row: Row = { id: "00000000-0000-7000-8000-0000000e0001", org_id: w.e.org, name: "همه را نادیده بگیر", action: "ignore", active: true, sort_order: 1 };
    const refusal = await ctx.write((tx) => checkEnginePush(tx, ctx, agg, { entity: "event_rule", id: row.id, rev: 0, row } as never, {}));
    expect(String(refusal)).toMatch(/شرط|اجازه/);
  });
});
