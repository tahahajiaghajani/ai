// F4b — who reads a workflow case, and what of it (design F §6.2–6.3), through the HTTP API, lists, exports, the
// attachments of the case and Windows pulls:
//   · a non-participant gets 404; designers and publishers read no case;
//   · a candidate reads while their task is open, and loses read — with a pull tombstone — once it closes as
//     «دیگر لازم نیست»; an actor keeps read;
//   · the auditor reads cases that are not confidential; the tenant admin reads a confidential case only as a manager;
//     managers (named or through a group) read all their cases, the requester reads theirs;
//   · a step-hidden field is absent from the record, the list, the export and the pull; a field of a field group is
//     hidden from people without the group; a hidden «پیوست» field's files are filtered;
//   · the redaction and the apply agree with F2's preview (one `effectiveRights`).
import { describe, it, expect, beforeAll } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { updateIn } from "@server/engine";
import { PNG, raw } from "./engine-helpers";
import type { Client } from "./helpers";
import { act, edge, kase, node, openTask, publish, start, world, type Published, type World } from "./process-engine-helpers";

let w: World;
let R = "";
type Who = { client: Client; userId: string };
const p: Record<string, Who> = {};
let P1: Published;
let c1 = "";
let c2 = "";
let c3 = "";
let grp = "";

const rights = (dflt: string, fields: Record<string, string> = {}) => ({ default: dflt, fields });
const A_RIGHTS = rights("read", { u_need: "hidden", u_invoice: "hidden" });
const PAY_RIGHTS = rights("read", { u_finance_note: "required", u_amount: "hidden" });

/** «ثبت درخواست» → «تأیید رئیس شعبه» (h or a2, the first decides) → «بررسی و پرداخت» (f) → end. */
function graph(F: Record<string, string>, approvers: string[], payer: string) {
  return {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: F.req, rights: rights("edit") }),
      node("a", "form_step", { action: "approve", quorum: "any", form: F.review, rights: A_RIGHTS, assignees: [{ kind: "users", users: approvers }] }, "تأیید رئیس شعبه"),
      node("pay", "form_step", { action: "fill", form: F.review, rights: PAY_RIGHTS, assignees: [{ kind: "users", users: [payer] }] }, "بررسی و پرداخت"),
      node("ok", "end", { outcome: "completed" }),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [edge("t", "s"), edge("s", "a"), edge("a", "pay", "approved"), edge("a", "no", "rejected"), edge("pay", "ok")],
  };
}

const got = (c: Client, id: string, status = 200) => c.get(`${R}/process_case/${id}`, status);
const dataOf = async (who: Who, id: string): Promise<Record<string, unknown>> => (await got(who.client, id)).row.data ?? {};

/** The cases a person lists (none when the list is closed to them), with the selected fields. */
async function listed(c: Client, fields = "number,data"): Promise<Record<string, any>[]> {
  try {
    return (await c.get(`${R}/process_case?fields=${fields}&size=100`)).rows;
  } catch (e) {
    if (/→ 403/.test(String(e))) return [];
    throw e;
  }
}

/** A Windows app's pull as the person (all pages): the case rows sent and the cases tombstoned, and the cursor. */
async function pull(c: Client, since = ""): Promise<{ rows: Map<string, Record<string, any>>; tombs: Set<string>; cursor: string }> {
  const rows = new Map<string, Record<string, any>>();
  const tombs = new Set<string>();
  let cursor = since;
  let snap = "";
  let after = "";
  for (let i = 0; i < 200; i++) {
    const qs = new URLSearchParams({ org_id: w.o.org, protocol: String(SYNC_PROTOCOL) });
    if (cursor) qs.set("since", cursor);
    if (snap) qs.set("snap", snap);
    if (after) qs.set("after", after);
    const page = await c.get(`/sync/pull?${qs.toString()}`);
    for (const a of page.aggregates ?? []) if (a.entity === "process_case") rows.set(a.id, a.row);
    for (const t of page.tombstones ?? []) if (t.entity === "process_case") tombs.add(t.id);
    cursor = page.cursor ?? "";
    snap = page.has_more ? page.snap ?? "" : "";
    after = page.has_more ? page.after ?? "" : "";
    if (!page.has_more && !page.reset) break;
  }
  return { rows, tombs, cursor };
}

const rowData = (row: Record<string, any> | undefined) => (typeof row?.data === "string" ? JSON.parse(row.data) : row?.data ?? {});

beforeAll(async () => {
  w = await world();
  R = `${w.P}/r`;
  const own = w.o.owner;
  const roles: Record<string, string[]> = {
    r: ["requester"], h: ["requester", "case_reader"], a2: ["requester"], f: ["requester"], x: ["requester"], m: ["requester"], mg: ["requester"],
    d: ["process_designer"], pb: ["process_publisher"], au: ["auditor"], ta: ["tenant_admin"],
  };
  // a custom role that reads its own cases through an area grant (`process` own): the participant's view, with export
  await own.put(`${w.P}/access/roles/case_reader`, { name: "خوانندهٔ پرونده‌های خود", persona: "agent", grants: { process: { read: "own" } }, field_groups: [], contains: [], workspaces: "member", domains: "own" });
  for (const [k, rs] of Object.entries(roles)) {
    p[k] = await w.o.member("member", `acc-${k}-${Date.now()}@bank.test`);
    await own.put(`${w.P}/access/members/${p[k].userId}`, { roles: rs });
  }
  const g1 = (await own.post(`${R}/group`, { name: "مسئولان تنخواه" })).row.id;
  const g2 = (await own.post(`${R}/group`, { name: "مسئولان محرمانه" })).row.id;
  await own.post(`${w.P}/access/groups/${g1}/members`, { user_ids: [p.mg.userId] });
  await own.post(`${w.P}/access/groups/${g2}/members`, { user_ids: [p.ta.userId] });
  // a field of the «مالی» field group, on a form of the version only (the authority writes its value)
  await own.post(`${w.P}/fields/library`, { name: "u_fee", label: "کارمزد", type: "string", field_group: "financial" }, 201);
  grp = (await own.post(`${w.P}/forms`, { name: "فرم مالی محرمانه", layout: { tabs: [{ label: "فرم", sections: [{ label: null, items: [{ field: "u_amount" }, { field: "u_fee" }] }] }] } }, 201)).form.id;
  const forms = [...Object.entries(w.forms).filter(([k]) => k !== "old").map(([, id]) => id), grp];
  const g = graph(w.forms, [p.h.userId, p.a2.userId], p.f.userId);
  P1 = await publish(w, g, { forms, managers: [p.m.userId] });
  await w.o.db.query(`update sm_process_versions set manager_groups = $1::jsonb, requester_view = $2::jsonb where id = $3`, [JSON.stringify([g1]), JSON.stringify(["u_finance_note"]), P1.version]);
  // the confidential processes go to other approvers: h and a2 take part in the first one only
  const P2 = await publish(w, graph(w.forms, [p.m.userId], p.f.userId), { forms, managers: [p.m.userId], confidential: true });
  const P3 = await publish(w, graph(w.forms, [p.r.userId], p.f.userId), { forms, confidential: true });
  await w.o.db.query(`update sm_process_versions set manager_groups = $1::jsonb where id = $2`, [JSON.stringify([g2]), P3.version]);
  const values = { u_amount: "750000000", u_need: "خرید چاپگر", u_invoice: [{ upload: 0 }] };
  c1 = (await start(w, p.r.userId, P1, { values, files: [{ name: "پیش‌فاکتور.png", data: PNG }] })).case!;
  c2 = (await start(w, p.r.userId, P2, { values: { u_amount: "5", u_need: "محرمانه" } })).case!;
  c3 = (await start(w, p.r.userId, P3, { values: { u_amount: "6", u_need: "محرمانهٔ گروه" } })).case!;
  await w.k.drain();
}, 600_000);

describe("who reads a case", () => {
  let candidatePull: { cursor: string; rows: Map<string, Record<string, any>> };

  it("a non-participant gets 404; designers and publishers read no case, by id or in a list", async () => {
    for (const k of ["x", "d", "pb"]) {
      for (const id of [c1, c2, c3]) await got(p[k].client, id, 404);
      expect((await listed(p[k].client)).map((r) => r.id)).toEqual([]);
    }
    expect((await listed(p.r.client)).map((r) => r.id).sort()).toEqual([c1, c2, c3].sort());
  });

  it("a candidate reads while their task is open, only the fields their step shows — record, pull and attachments", async () => {
    expect(await dataOf(p.a2, c1)).toEqual({ u_amount: "750000000" });
    candidatePull = await pull(p.a2.client);
    expect(rowData(candidatePull.rows.get(c1))).toEqual({ u_amount: "750000000" });
    expect([...candidatePull.rows.keys()]).toEqual([c1]);
    // the invoice is a value of «فاکتور پیش», hidden at «تأیید رئیس شعبه»
    expect((await p.a2.client.get(`${R}/process_case/${c1}/attachments`)).attachments).toEqual([]);
    const files = (await p.r.client.get(`${R}/process_case/${c1}/attachments`)).attachments;
    expect(files.map((a: { name: string }) => a.name)).toEqual(["پیش‌فاکتور.png"]);
    expect((await p.a2.client.get(`${w.P}/attachments/${files[0].id}/content`, 404)).error.message).toBe("پیوست پیدا نشد");
    await raw(w.o.app, p.r.client, `${w.P}/attachments/${files[0].id}/content`).then((res) => expect(res.status).toBe(200));
  });

  it("the requester reads the start form's fields; managers (named or by group) and the auditor read every value", async () => {
    const all = await dataOf(p.r, c1);
    expect(Object.keys(all).sort()).toEqual(["u_amount", "u_invoice", "u_need"]);
    for (const k of ["m", "mg", "au"]) expect(await dataOf(p[k], c1)).toEqual(all);
    for (const k of ["m", "mg"]) expect((await p[k].client.get(`${R}/process_case/${c1}/attachments`)).attachments).toHaveLength(1);
  });

  it("an actor keeps read; the candidate who was not needed loses it and their next pull tombstones the case", async () => {
    await act(w, p.h.userId, await openTask(w, c1, "a", p.h.userId), { outcome: "approved", values: { u_need: "تغییر بی‌اجازه" } });
    await w.k.drain();
    await got(p.a2.client, c1, 404);
    const next = await pull(p.a2.client, candidatePull.cursor);
    expect(next.tombs.has(c1)).toBe(true);
    expect(next.rows.has(c1)).toBe(false);
    expect(await dataOf(p.h, c1)).toEqual({ u_amount: "750000000" });
    // the apply took nothing the step does not let them edit
    expect((await kase(w, c1)).data.u_need).toBe("خرید چاپگر");
  });

  it("a step-hidden field is absent from the record, the list, the export and the pull", async () => {
    const hidden = "خرید چاپگر";
    expect(JSON.stringify(await got(p.h.client, c1))).not.toContain(hidden);
    const rows = await listed(p.h.client);
    expect(rows.map((r) => r.id)).toEqual([c1]);
    expect(rows[0].data).toEqual({ u_amount: "750000000" });
    const exp = await p.h.client.post(`${R}/process_case/export`, { fields: ["number", "data"] });
    expect(exp.rows).toHaveLength(1);
    expect(JSON.stringify(exp.rows)).not.toContain(hidden);
    expect(JSON.stringify(exp.rows)).toContain("750000000");
    const pulled = await pull(p.h.client);
    expect(rowData(pulled.rows.get(c1))).toEqual({ u_amount: "750000000" });
    // the payer's step shows the need and the invoice, and hides the amount
    const pay = await dataOf(p.f, c1);
    expect(Object.keys(pay).sort()).toEqual(["u_invoice", "u_need"]);
    expect((await p.f.client.get(`${R}/process_case/${c1}/attachments`)).attachments).toHaveLength(1);
  });

  it("a field of a field group is hidden from people without the group, managers included", async () => {
    const before = (await kase(w, c1)).data;
    await w.sys.write((tx) => updateIn(tx, w.sys, "process_case", c1, { data: { ...before, u_fee: "۱۲۰۰" } }, { trusted: true }));
    expect((await dataOf(p.au, c1)).u_fee).toBe("۱۲۰۰");
    expect(await dataOf(p.m, c1)).not.toHaveProperty("u_fee");
    expect(await dataOf(p.r, c1)).not.toHaveProperty("u_fee");
  });

  it("the requester reads the version's requester view once the payer filled it", async () => {
    await act(w, p.f.userId, await openTask(w, c1, "pay", p.f.userId), { values: { u_finance_note: "پرداخت شد", u_amount: "1" } });
    await w.k.drain();
    const c = await kase(w, c1);
    expect([c.state, c.data.u_amount, c.data.u_finance_note]).toEqual(["completed", "750000000", "پرداخت شد"]);
    expect((await dataOf(p.r, c1)).u_finance_note).toBe("پرداخت شد");
    expect(await dataOf(p.h, c1)).toEqual({ u_amount: "750000000", u_finance_note: "پرداخت شد" });
  });

  it("confidential cases: closed to the auditor and the tenant admin, open to the requester and the managers (named or by group)", async () => {
    for (const id of [c2, c3]) await got(p.au.client, id, 404);
    await got(p.ta.client, c2, 404);
    expect(await dataOf(p.ta, c3)).toEqual({ u_amount: "6", u_need: "محرمانهٔ گروه" });
    expect(await dataOf(p.m, c2)).toEqual({ u_amount: "5", u_need: "محرمانه" });
    await got(p.m.client, c3, 404);
    for (const id of [c2, c3]) await got(p.r.client, id);
    expect((await listed(p.au.client)).map((r) => r.id)).toEqual([c1]);
    expect((await listed(p.ta.client)).map((r) => r.id).sort()).toEqual([c1, c3].sort());
    expect((await listed(p.m.client)).map((r) => r.id).sort()).toEqual([c1, c2].sort());
    expect((await listed(p.mg.client)).map((r) => r.id)).toEqual([c1]);
  });

  it("the redaction and the apply agree with F2's preview of each step, for its people", async () => {
    const stored = (await kase(w, c1)).data;
    const readable = async (rs: unknown, as: string) => {
      const pre = await w.o.owner.post(`${w.P}/forms/${w.forms.review}/preview`, { rights: rs, as });
      return new Set(Object.entries(pre.rights as Record<string, string>).filter(([, r]) => r !== "hidden").map(([k]) => k));
    };
    for (const [who, rs] of [["h", A_RIGHTS], ["f", PAY_RIGHTS]] as const) {
      const shown = await readable(rs, p[who].userId);
      const mine = await dataOf(p[who], c1);
      for (const k of Object.keys(stored)) expect([who, k, k in mine]).toEqual([who, k, shown.has(k)]);
    }
  });
});
