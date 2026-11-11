// F1 package acceptance (design F §12, F1) on incident, through F1's API: an administrator adds the library field
// «کد ملی» to incident, hides «اثر» from the incident form, makes «شعبه» required for agents and relabels «حل‌شده» —
// with no DDL change (the registry's definition and the table's columns stay as they were, so `check:schema` does not
// move). E-mail-created and event-created incidents still succeed (the system is never bound by an organisation's
// requirement), and so do trusted writes; an agent's API write and Windows push are held to it, a requester is not.
// The hidden «اثر» still lists, filters, groups on boards and exports.
import { describe, it, expect, beforeAll } from "vitest";
import { world, type World } from "./incident-helpers";
import { tableDef } from "@shared/tables";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { ddlFor, createIn } from "@server/engine";
import { createFromAlert } from "@server/modules/incident";
import { ingestMessage } from "@server/modules/notify";
import { emailChannels } from "@server/modules/notify/mail";
import { isListable } from "../src/ui/records/model/schema";
import { filterPaths } from "../src/ui/records/model/filter";
import { isBoardable } from "../src/ui/records/model/kanban";
import type { FieldDef, TableDef } from "@shared/model/types";

type Msg = { error: { message: string; details?: { fields?: Record<string, string> } } };

let w: World;
let P: string;
let branchA: string;
let office: string;
const NATIONAL = "0499370899";

const columns = async (table: string) =>
  (await w.e.db.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns where table_name = $1 order by column_name`,
    [table],
  )).map((c) => `${c.column_name}:${c.data_type}`);

const mail = (from: string, subject: string) =>
  [
    `From: ${from}`,
    "To: support@itsm.example",
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `Message-ID: <${uuidv7()}@mail.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "سامانهٔ حقوق از صبح در دسترس نیست.",
    "",
  ].join("\r\n");

describe("F1 acceptance: an administrator tailors incident with rows only", () => {
  let registryBefore: string;
  let ddlBefore: string;
  let columnsBefore: string[];

  beforeAll(async () => {
    w = await world();
    P = `/o/${w.e.org}`;
    branchA = (await w.o.post(`${P}/r/org_unit`, { name: "شعبهٔ ونک", kind: "branch" })).row.id;
    office = (await w.o.post(`${P}/r/org_unit`, { name: "ادارهٔ حقوق", kind: "department" })).row.id;
    registryBefore = JSON.stringify(tableDef("incident"));
    ddlBefore = JSON.stringify(ddlFor(tableDef("incident")!));
    columnsBefore = await columns("sm_incidents");
  }, 600_000);

  it("adds «کد ملی», hides «اثر», requires «شعبه» for agents and relabels «حل‌شده» — no DDL change", async () => {
    const o = w.o;
    const nid = (await o.post(`${P}/fields/library`, { name: "u_national_code", label: "کد ملی", type: "national_id" }, 201)).row;
    await o.post(`${P}/fields/types`, { key: "u_branch_unit", name: "شعبه", base: "unit", validation: { refFilter: { f: "kind", op: "eq", v: "branch" } } }, 201);
    await o.post(`${P}/fields/library`, { name: "u_branch", label: "شعبه", type: "u_branch_unit" }, 201);
    await o.post(`${P}/fields/attach`, { table: "incident", field: nid.id }, 201);
    // «همه» is refused while the portal reports through its built-in form, with the two ways out
    const all = (await o.post(`${P}/fields/attach`, { table: "incident", field: "u_branch", required: true, required_for: "all" }, 400)) as Msg;
    expect(all.error.message).toContain("فرم پیش‌فرض درگاه");
    expect(all.error.message).toContain("«فقط کارشناسان»");
    const attached = await o.post(`${P}/fields/attach`, { table: "incident", field: "u_branch", required: true, required_for: "agents" }, 201);
    expect(attached.field).toMatchObject({ name: "u_branch", type: "ref", ref: "org_unit", formRequired: "agents", library: "u_branch" });
    expect(attached.field.required).toBeUndefined();
    const hidden = await o.put(`${P}/forms/system/incident/overrides`, { fields: { impact: { form_hidden: true } } });
    expect(hidden.fields.find((f: { name: string }) => f.name === "impact")).toMatchObject({ form_hidden: true, locked: [] });
    const lc = await o.put(`${P}/lifecycles/incident`, { states: { resolved: { label: "رفع‌شده" } } });
    expect(lc.states.find((s: { value: string }) => s.value === "resolved")).toMatchObject({ label: "رفع‌شده", default_label: "حل‌شده", category: "resolved" });

    // the organisation's view
    const meta = (await o.get(`${P}/meta/tables/incident`)).table as TableDef;
    const f = (n: string) => meta.fields.find((x) => x.name === n)!;
    expect(f("u_national_code")).toMatchObject({ label: "کد ملی", type: "string", check: "national_id", custom: true, library: "u_national_code" });
    expect(f("impact")).toMatchObject({ label: "اثر", formHidden: true });
    expect(f("impact").hidden).toBeUndefined();
    expect(meta.states!.states.find((s) => s.value === "resolved")!.label).toBe("رفع‌شده");

    // rows only: the registry, the generated DDL and the table's columns are what they were
    expect(JSON.stringify(tableDef("incident"))).toBe(registryBefore);
    expect(JSON.stringify(ddlFor(tableDef("incident")!))).toBe(ddlBefore);
    expect(await columns("sm_incidents")).toEqual(columnsBefore);
  });

  it("holds an agent's API write and push to «شعبه», never a requester's, the system's or trusted code's", async () => {
    const agent = w.p.agent.client;
    // the form marks it for the agent, not for the requester
    expect((await agent.get(`${P}/meta/tables/incident`)).table.fields.find((x: FieldDef) => x.name === "u_branch")).toMatchObject({ required: true, formRequired: "agents" });
    expect((await w.p.req.client.get(`${P}/meta/tables/incident`)).table.fields.find((x: FieldDef) => x.name === "u_branch")?.required).toBeUndefined();
    const miss = (await agent.post(`${P}/r/incident`, { short_description: "چاپگر طبقهٔ دوم" }, 400)) as Msg;
    expect(miss.error.details?.fields).toEqual({ u_branch: "«شعبه» را وارد کنید" });
    // the field's own rule: a unit of kind branch
    await agent.post(`${P}/r/incident`, { short_description: "چاپگر طبقهٔ دوم", u_branch: office }, 400);
    const ok = (await agent.post(`${P}/r/incident`, { short_description: "چاپگر طبقهٔ دوم", u_branch: branchA })).row;
    expect(ok.u_branch).toBe(branchA);
    // an update that leaves it alone passes; one that empties it does not
    await agent.patch(`${P}/r/incident/${ok.id}`, { description: "کاغذ گیر می‌کند" });
    expect(((await agent.patch(`${P}/r/incident/${ok.id}`, { u_branch: null }, 400)) as Msg).error.details?.fields).toEqual({ u_branch: "«شعبه» را وارد کنید" });
    // the agent's Windows app emptying it: refused at the push
    const stored = (await w.e.db.one<Record<string, unknown>>(`select * from sm_incidents where id = $1`, [ok.id]))!;
    const push = await agent.post(`/sync/push`, {
      org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "incident", id: ok.id, base_rev: Number(stored.rev), row: { ...JSON.parse(JSON.stringify(stored)), custom: {}, updated_at: new Date(Date.now() + 5_000).toISOString() } }],
    });
    expect(push.results[0]).toMatchObject({ status: "error", message: "«شعبه» را وارد کنید" });
    expect((await agent.get(`${P}/r/incident/${ok.id}`)).row.u_branch).toBe(branchA);
    // a requester is not bound by «فقط کارشناسان»
    const mine = (await w.p.req.client.post(`${P}/r/incident`, { short_description: "رمز عبورم کار نمی‌کند" })).row;
    expect(mine.u_branch).toBeNull();
    // trusted server code acting for the agent
    const actx = await w.e.ctxOf(w.p.agent.userId);
    const trusted = await actx.write((tx) => createIn(tx, actx, "incident", { short_description: "ثبت سرویس" }, { trusted: true }));
    expect(trusted.u_branch).toBeNull();
  });

  it("still creates incidents from e-mail and from monitoring events", async () => {
    // e-mail: an inbound channel that files incidents
    await w.o.post(`${P}/r/email_channel`, {
      name: "میز خدمت", from_address: "support@itsm.example", is_default: true, smtp_host: "smtp.itsm.example", smtp_user: "support", smtp_password: "x",
      inbound: true, imap_host: "imap.itsm.example", imap_user: "support", imap_password: "y", target_table: "incident",
    });
    const ch = (await emailChannels(w.sys)).find((c) => c.target_table === "incident")!;
    const byMail = await ingestMessage(w.e.cfg, w.sys, ch, mail("Ali Karimi <ali@outside.example>", "سامانهٔ حقوق در دسترس نیست"));
    expect(byMail).toMatchObject({ status: "created", table: "incident" });
    // from a member's address the write is still the system's (on behalf of the member)
    const fromAgent = await ingestMessage(w.e.cfg, w.sys, ch, mail("agent@example.com", "کندی شبکه"));
    expect(fromAgent).toMatchObject({ status: "created", table: "incident" });
    // a monitoring alert through the event rules
    const alert = await w.sys.write((tx) => createFromAlert(tx, w.sys, { key: "zabbix:77", source: "Zabbix", title: "دیسک سرور پر شده است", severity: "critical" }));
    expect(alert).toBeTruthy();
    const made = await w.e.db.query<{ short_description: string; custom: Record<string, unknown> }>(
      `select short_description, custom from sm_incidents where org_id = $1 and short_description in ('سامانهٔ حقوق در دسترس نیست', 'کندی شبکه', 'دیسک سرور پر شده است')`,
      [w.e.org],
    );
    expect(made.map((r) => r.short_description).sort()).toEqual(["دیسک سرور پر شده است", "سامانهٔ حقوق در دسترس نیست", "کندی شبکه"]);
    for (const r of made) expect(r.custom.u_branch ?? null).toBeNull();
  });

  it("checks «کد ملی» on every write, with Persian digits accepted and stored in Latin", async () => {
    const agent = w.p.agent.client;
    const bad = (await agent.post(`${P}/r/incident`, { short_description: "احراز هویت", u_branch: branchA, u_national_code: "0499370898" }, 400)) as Msg;
    expect(bad.error.details?.fields?.u_national_code).toBe("«کد ملی» کد ملی معتبر نیست؛ ۱۰ رقم آن را بررسی کنید");
    const fa = "۰۴۹-۹۳۷۰۸۹-۹";
    const row = (await agent.post(`${P}/r/incident`, { short_description: "احراز هویت", u_branch: branchA, u_national_code: fa })).row;
    expect(row.u_national_code).toBe(NATIONAL);
    expect((await w.e.db.one<{ custom: Record<string, unknown> }>(`select custom from sm_incidents where id = $1`, [row.id]))!.custom.u_national_code).toBe(NATIONAL);
  });

  it("still lists, filters, groups and exports the hidden «اثر»", async () => {
    const agent = w.p.agent.client;
    const r = (await agent.post(`${P}/r/incident`, { short_description: "اثر گسترده", u_branch: branchA, impact: "1" })).row;
    expect(r.impact).toBe("1");
    // lists and filters
    const listed = await agent.post(`${P}/r/incident/query`, { filter: { f: "impact", op: "eq", v: "1" }, fields: ["short_description", "impact"] });
    expect(listed.rows.map((x: { short_description: string }) => x.short_description)).toContain("اثر گسترده");
    expect(listed.rows.every((x: { impact: string }) => x.impact === "1")).toBe(true);
    // export
    const ex = await agent.get(`${P}/r/incident/export?fields=short_description,impact`);
    expect(ex.columns.map((c: { name: string }) => c.name)).toContain("impact");
    // the record UI's pure functions: a list column, a filter path and a board column (only forms honour formHidden)
    const meta = (await agent.get(`${P}/meta/tables/incident`)).table as TableDef;
    const impact = meta.fields.find((x) => x.name === "impact")!;
    expect(impact.formHidden).toBe(true);
    expect(isListable(impact)).toBe(true);
    expect(isBoardable(impact)).toBe(true);
    expect(filterPaths(meta, () => undefined).map((p) => p.path)).toContain("impact");
  });
});
