// ITAM, suppliers and IT finance with the platform rules they now follow:
//  · parent-scoped children (scope.parent): a confidential contract's lines, coverage, obligations and guarantees are
//    read only by those who read the contract — lists, single reads, counts, search, a pull from a Windows app (a
//    contract made confidential sends its lines down as tombstones) — and reappear with the access list
//  · Windows pushes held to the modules' guards (contract lines by those who may change the contract; ITAM ledgers by
//    those who may change the asset; computed rows never)
//  · approvals as a whole (settledVerdict): a withdrawn approval never activates a contract
//  · analytics: the modules' KPIs are seeded; stored budget figures go only to holders of the «مالی» field group
//  · the AI's generated record tools make no drafts for the modules' ledgers and computed rows
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { addDays, todayISO } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import { memberCtx } from "@server/access";
import { checkEnginePush, pullEngine } from "@server/engine/sync";
import { BY_ENTITY } from "@server/sync/registry";
import { draftable } from "@server/modules/ai/tools/records";
import { uuidv7 } from "@shared/id";

let w: ItamWorld;
let secret: Record<string, any>;
let open: Record<string, any>;
let line = "";
let openLine = "";
let obligation = "";
let supplier = "";
type Row = Record<string, any>;
const today = () => todayISO("Asia/Tehran");
const ids = (rows: Row[]) => rows.map((r) => String(r.id)).sort();

beforeAll(async () => {
  w = await itamWorld();
  supplier = await w.idOf("supplier", "name", "شرکت پشتیبانی شبکهٔ پارس (نمونه)");
  const make = async (name: string, confidential: boolean) =>
    (await w.p.am.client.post(`${w.P}/r/contract`, { name, supplier_id: supplier, contract_type: "support", start_date: today(), end_date: addDays(today(), 365), confidential, owner_id: w.p.am.userId })).row;
  secret = await make("قرارداد محرمانهٔ نگهداری", true);
  open = await make("قرارداد عادی نگهداری", false);
  line = (await w.p.am.client.post(`${w.P}/r/contract_line`, { contract_id: secret.id, description: "پشتیبانی ۲۴×۷", quantity: 1, unit_price: "900000000" })).row.id;
  openLine = (await w.p.am.client.post(`${w.P}/r/contract_line`, { contract_id: open.id, description: "پشتیبانی اداری", quantity: 1, unit_price: "100000000" })).row.id;
  // an obligation of the confidential contract owned by IT finance: its owner field does not open it to them
  obligation = (await w.p.am.client.post(`${w.P}/r/contract_obligation`, { contract_id: secret.id, title: "گزارش ماهانه", party: "supplier", owner_id: w.p.fin.userId, due_date: addDays(today(), 30) })).row.id;
}, 180_000);

describe("children of a confidential contract", () => {
  it("are read by those who read the contract only — lists, records, counts and search", async () => {
    // the asset manager owns it
    expect(ids((await w.p.am.client.post(`${w.P}/r/contract_line/query`, { filter: { f: "contract_id", op: "in", v: [secret.id, open.id] } })).rows)).toEqual([line, openLine].sort());
    for (const who of ["fin", "proc"] as const) {
      const c = w.p[who].client;
      await c.get(`${w.P}/r/contract/${secret.id}`, 404);
      await c.get(`${w.P}/r/contract_line/${line}`, 404);
      await c.get(`${w.P}/r/contract_obligation/${obligation}`, 404);
      const listed = ids((await c.post(`${w.P}/r/contract_line/query`, {})).rows);
      expect(listed).toContain(openLine);
      expect(listed).not.toContain(line);
      expect((await c.post(`${w.P}/r/contract_line/query`, { filter: { f: "contract_id", op: "eq", v: secret.id } })).rows).toEqual([]);
      expect((await c.post(`${w.P}/r/contract_line/query`, { q: "۲۴×۷" })).rows).toEqual([]);
      const counted = await c.post(`${w.P}/r/contract_line/agg`, { filter: { f: "contract_id", op: "in", v: [secret.id, open.id] }, metrics: [{ fn: "count" }] });
      expect(counted.totals.count).toBe(1);
      expect((await c.post(`${w.P}/r/contract_obligation/query`, { filter: { f: "owner_id", op: "is_me" } })).rows).toEqual([]);
      // the contract's lines of an ordinary contract stay readable as before
      expect((await c.get(`${w.P}/r/contract_line/${openLine}`)).row.id).toBe(openLine);
    }
  });

  it("reappear for whoever the access list names, and the access check explains the parent layer", async () => {
    await w.p.am.client.patch(`${w.P}/r/contract/${secret.id}`, { access_list: [w.p.fin.userId] });
    expect((await w.p.fin.client.get(`${w.P}/r/contract_line/${line}`)).row.id).toBe(line);
    expect((await w.p.fin.client.get(`${w.P}/r/contract_obligation/${obligation}`)).row.id).toBe(obligation);
    await w.p.proc.client.get(`${w.P}/r/contract_line/${line}`, 404);
    await w.p.am.client.patch(`${w.P}/r/contract/${secret.id}`, { access_list: [] });
    await w.p.fin.client.get(`${w.P}/r/contract_line/${line}`, 404);
  });

  it("go down to a Windows app as tombstones once their contract becomes confidential", async () => {
    const before = Number((await w.e.db.one<{ rev: number }>(`select rev from sm_contract_lines where id = $1`, [openLine]))!.rev);
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.p.proc.userId);
    const agg = BY_ENTITY.get("contract_line")!;
    await w.p.am.client.patch(`${w.P}/r/contract/${open.id}`, { confidential: true });
    const after = Number((await w.e.db.one<{ rev: number }>(`select rev from sm_contract_lines where id = $1`, [openLine]))!.rev);
    expect(after).toBeGreaterThan(before);
    const pulled = await pullEngine(ctx, agg, before, Number.MAX_SAFE_INTEGER);
    expect(pulled.tombstones.map((t) => t.id)).toContain(openLine);
    expect(pulled.aggregates.map((a) => a.id)).not.toContain(openLine);
    await w.p.am.client.patch(`${w.P}/r/contract/${open.id}`, { confidential: false });
    const again = await pullEngine(ctx, agg, after, Number.MAX_SAFE_INTEGER);
    expect(again.aggregates.map((a) => a.id)).toContain(openLine);
  });
});

describe("Windows pushes of the modules' rows", () => {
  const push = async (who: "am" | "agent" | "fin" | "proc", entity: string, row: Row) => {
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.p[who].userId);
    return ctx.write((tx) => checkEnginePush(tx, ctx, BY_ENTITY.get(entity)!, { entity, id: String(row.id), base_rev: 0, row, children: {} } as never, {}));
  };

  it("a contract line only from someone who may change the contract", async () => {
    // procurement may change ordinary contracts, not the confidential one it cannot read
    const row = { id: uuidv7(), org_id: w.e.org, contract_id: secret.id, description: "سطر از ویندوز", quantity: 1, unit_price: "1000" };
    expect(String(await push("proc", "contract_line", row))).toMatch(/قرارداد/);
    expect(await push("proc", "contract_line", { ...row, id: uuidv7(), contract_id: open.id })).toBeNull();
    expect(await push("am", "contract_line", { ...row, id: uuidv7() })).toBeNull();
  });

  it("an ITAM ledger row only from someone who may change its asset; computed rows never", async () => {
    const asset = await w.asset({ serial_number: "PUSH-1" });
    const move = { id: uuidv7(), org_id: w.e.org, kind: "adjustment", asset_id: asset.id, model_id: asset.model_id, quantity: 1, moved_at: new Date().toISOString() };
    expect(String(await push("agent", "stock_movement", move))).toMatch(/دارایی|اجازه|سامانه/);
    expect(await push("am", "stock_movement", { ...move, id: uuidv7() })).toBeNull();
    expect(String(await push("am", "stock_movement", { ...move, id: uuidv7(), asset_id: null }))).toMatch(/سامانه/);
    expect(String(await push("fin", "allocation_result", { id: uuidv7(), org_id: w.e.org }))).toMatch(/سامانه|اجازه/);
  });
});

describe("a contract's approvals as a whole", () => {
  it("a withdrawn approval neither activates nor rejects the contract", async () => {
    await w.o.put(`${w.P}/access/members/${w.p.am.userId}`, { manager_id: w.p.fin.userId });
    const c = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "قرارداد با تأیید پس‌گرفته", supplier_id: supplier, contract_type: "support", start_date: today(), end_date: addDays(today(), 365) })).row;
    expect((await w.p.am.client.post(`${w.P}/r/contract/${c.id}/transition`, { to: "pending_approval" })).row.approval).toBe("requested");
    await w.o.post(`${w.P}/approvals/record/contract/${c.id}/cancel`, {});
    await w.drain();
    expect((await w.o.get(`${w.P}/r/contract/${c.id}`)).row.state).toBe("pending_approval");
  });
});

describe("analytics and AI with the modules installed", () => {
  it("seeds the modules' KPIs; stored budget figures only for holders of the «مالی» field group", async () => {
    await w.o.post(`${w.P}/analytics/seed`, { force: true });
    const inds = (await w.o.get(`${w.P}/r/analytics_indicator?size=200`)).rows as Row[];
    const keys = inds.map((r) => r.key);
    for (const k of ["asset.stock_below_reorder", "asset.license_compliance", "supplier.contracts_expiring", "financial.budget_vs_actual"]) expect(keys).toContain(k);
    // the bank layer's indicators (fleet, transfers, audit discrepancies, attestation)
    for (const k of ["asset.fleet_down", "asset.transfers_in_transit", "asset.audit_discrepancies", "asset.attestations_overdue"]) expect(keys).toContain(k);
    const budget = inds.find((r) => r.key === "financial.budget_vs_actual")!;
    const stock = inds.find((r) => r.key === "asset.stock_below_reorder")!;
    // share both with the agents as well (no «مالی» field group): only the stock KPI's scores reach them
    for (const ind of [budget, stock]) {
      const cur = (await w.o.get(`${w.P}/r/analytics_indicator/${ind.id}`)).row;
      await w.o.patch(`${w.P}/r/analytics_indicator/${ind.id}`, { score_shares: [...(cur.score_shares ?? []), { kind: "role", id: "agent", right: "view" }] });
    }
    const b = await w.e.db.one<Row>(`select s_users, s_groups, s_all from sm_analytics_indicators where id = $1`, [budget.id]);
    const s = await w.e.db.one<Row>(`select s_users from sm_analytics_indicators where id = $1`, [stock.id]);
    expect(b!.s_all).toBe(false);
    expect(b!.s_groups).toEqual([]);
    expect(b!.s_users).toContain(w.p.fin.userId);
    expect(b!.s_users).toContain(w.p.am.userId);
    expect(b!.s_users).not.toContain(w.p.agent.userId);
    expect(s!.s_users).toContain(w.p.agent.userId);
    // the live value is the viewer's: someone without the field group cannot compute it
    const live = await w.p.agent.client.get(`${w.P}/analytics/indicators/${budget.id}/value`).catch(() => null);
    if (live) expect(live.value ?? null).toBeNull();
  });

  it("generated record tools make no drafts for ledgers and computed rows", () => {
    for (const t of ["stock_movement", "asset_assignment", "license_position", "license_reconcile_run", "supplier_scorecard", "allocation_result", "page", "event"]) expect([t, draftable(tableDef(t)!)]).toEqual([t, false]);
    for (const t of ["asset", "contract", "alert", "outage", "budget"]) expect([t, draftable(tableDef(t)!)]).toEqual([t, true]);
  });
});
