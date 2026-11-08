// The assistant's generic tools (who am I, my organisation, today; its members; an exact calculator; charts), the
// way a module adds tools and proposal executors, Jalali periods resolved on the server, and the context block the
// model receives. A module's tools are stood in for by the fixture module's records.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import "./fixtures/module";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import type { Db } from "@server/db";
import { makeCtx, type Ctx, type ServerConfig, type AuthUser, type OrgRow, type MemberRow } from "@server/context";
import type { Role } from "@shared/permissions";
import { ALL_TOOLS, registerTool, toolsFor } from "@server/modules/ai/tools/index";
import { EXECUTORS, executeProposal, parsePayload, registerProposalExecutor } from "@server/modules/ai/tools/proposals";
import { defineTool, type AiToolDef, type ToolRuntime, type ToolResult } from "@server/modules/ai/tools/registry";
import { comparePeriod, parseDateInput, presetPeriod, previousMonthToDate, resolvePeriod } from "@server/modules/ai/analytics/period";
import { contextBlock } from "@server/modules/ai/prompts";
import { evaluate } from "@server/modules/ai/analytics/calc";
import { create as crudCreate } from "@server/modules/data/crud";

const TODAY = "2026-11-02"; // 1405/08/11

let db: Db;
let c: Client;
let org: string;
let cfg: ServerConfig;

async function ctxAs(role: Role, opts: { overrides?: MemberRow["overrides"]; timezone?: string } = {}): Promise<Ctx> {
  const user = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where email = 'owner@example.com'`))!;
  const o = (await db.one<OrgRow>(`select * from sm_orgs where id = $1`, [org]))!;
  if (opts.timezone) o.settings = { ...(o.settings ?? {}), timezone: opts.timezone } as OrgRow["settings"];
  const m = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2`, [org, user.id]))!;
  return makeCtx(cfg, user, o, { ...m, role, overrides: opts.overrides ?? {} });
}

function runtime(policy: ToolRuntime["dataPolicy"] = "full"): ToolRuntime & { stored: Record<string, unknown>[][] } {
  const stored: Record<string, unknown>[][] = [];
  return {
    today: TODAY,
    dataPolicy: policy,
    stored,
    async putData(rows) {
      stored.push(rows);
      return `ref${stored.length}xxxxxx`;
    },
  };
}

function tool(name: string): AiToolDef {
  const t = ALL_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

async function run(name: string, input: unknown, ctx?: Ctx, rt = runtime()): Promise<ToolResult & { data: any }> {
  const t = tool(name);
  const parsed = t.input.parse(input);
  return (await t.run(ctx ?? (await ctxAs("owner")), parsed, rt)) as ToolResult & { data: any };
}

// a module's read tool and its proposal (a draft record confirmed by a person), as a later module registers them
const findItems = defineTool({
  name: "find_test_items",
  title_fa: "جست‌وجوی قلم‌ها",
  description: "Finds items of the fixture module by part of their name and returns at most ten of them with their codes. Test-only tool standing in for a module's read tool.",
  input: z.object({ query: z.string().max(80) }),
  kind: "read",
  area: "settings",
  level: "view",
  async run(ctx, input) {
    ctx.need("settings", "view");
    const rows = await ctx.db.query<{ code: string; name: string }>(`select code, name from sm_test_items where org_id = $1 and name ilike $2 and deleted_at is null order by code limit 10`, [ctx.org.id, `%${input.query}%`]);
    return { data: { items: rows, total_rows: rows.length }, summary_fa: `${rows.length} قلم` };
  },
});
const proposeItem = defineTool({
  name: "propose_test_item",
  title_fa: "پیش‌نویس قلم",
  description: "Prepares a new item of the fixture module as a proposal; nothing is saved until a permitted person confirms it. Test-only tool standing in for a module's proposal tool.",
  input: z.object({ name: z.string().min(2).max(120) }),
  kind: "propose",
  area: "settings",
  level: "edit",
  async run(_ctx, input) {
    return {
      data: { proposed: true },
      proposal: { kind: "test_item", title_fa: "قلم تازه", summary_fa: input.name, payload: { name: input.name }, preview: [{ label: "نام", value: input.name }], area: "settings", level: "edit" },
    };
  },
});
const removers: (() => void)[] = [];

describe("ai tools", () => {
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c, { timezone: "Asia/Tehran" });
    cfg = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) } as ServerConfig;
    await c.post(`/o/${org}/members`, { email: "ali@example.com", full_name: "علی رضایی", role: "member", password: "ali-pass-1405" });
    await c.post(`/o/${org}/members`, { email: "sara@example.com", full_name: "سارا محمدی", role: "admin", password: "sara-pass-1405", title: "سرپرست پشتیبانی" });
    await c.post(`/o/${org}/members`, { email: "reza@example.com", full_name: "رضا کریمی", role: "viewer", password: "reza-pass-1405" });
    await c.post(`/o/${org}/data/test_item`, { name: "سوئیچ هسته" });
    removers.push(registerTool(findItems as AiToolDef), registerTool(proposeItem as AiToolDef));
    removers.push(
      registerProposalExecutor("test_item", async (ctx, payload) => {
        const p = parsePayload(z.object({ name: z.string().min(2) }), payload);
        const row = await crudCreate(ctx, "test_item", { name: p.name });
        return { type: "test_item", id: String(row.id), label: String(row.name) };
      }),
    );
  });
  afterAll(() => removers.forEach((r) => r()));

  it("has the platform's generic tools with unique snake_case names, English descriptions and zod inputs", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names.slice(0, 4)).toEqual(["get_org_context", "list_members", "calculate", "render_chart"]);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ALL_TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(t.description.length).toBeGreaterThan(60);
      const persian = (t.description.match(/[؀-ۿ]/g) ?? []).length;
      expect(persian / t.description.length).toBeLessThan(0.05);
      expect(typeof t.input.parse).toBe("function");
    }
    // a module's tool of the same name replaces the earlier one
    const again = registerTool(findItems as AiToolDef);
    expect(ALL_TOOLS.filter((t) => t.name === "find_test_items")).toHaveLength(1);
    again();
    registerTool(findItems as AiToolDef);
  });

  it("filters tools by permission and the proposals switch", async () => {
    const owner = toolsFor(await ctxAs("owner"), { proposals: true }).map((t) => t.name);
    expect(owner).toEqual(expect.arrayContaining(["get_org_context", "list_members", "calculate", "render_chart", "find_test_items", "propose_test_item"]));
    const ownerNoProposals = toolsFor(await ctxAs("owner"), { proposals: false }).map((t) => t.name);
    expect(ownerNoProposals.some((n) => n.startsWith("propose_"))).toBe(false);
    // a viewer asks and reads, but neither sees members (users: none) nor prepares drafts (modules' read tools,
    // such as the CMDB's graph tools, are offered to viewers too)
    const viewerTools = toolsFor(await ctxAs("viewer"), { proposals: true });
    const viewer = viewerTools.map((t) => t.name);
    expect(viewer).toEqual(expect.arrayContaining(["get_org_context", "calculate", "render_chart", "find_test_items"]));
    expect(viewer).not.toContain("list_members");
    expect(viewerTools.every((t) => t.kind !== "propose" && (t.level === "view" || t.kind === "meta"))).toBe(true);
    // a member sees members; drafts need the record's own area too
    const member = toolsFor(await ctxAs("member"), { proposals: true }).map((t) => t.name);
    expect(member).toContain("list_members");
    expect(member).not.toContain("propose_test_item");
    // proposals also need ai:edit (the assistant's own routes need ai:view first)
    const askOnly = toolsFor(await ctxAs("owner", { overrides: { ai: "view" } }), { proposals: true });
    expect(askOnly.some((t) => t.kind === "propose")).toBe(false);
  });

  it("tells who asks, about which organisation and when (today in the organisation's time zone, Jalali)", async () => {
    const r = await run("get_org_context", {}, await ctxAs("member"));
    expect(r.data.organisation).toMatchObject({ name: "سازمان آزمایشی", modules: [], active_members: 4 });
    expect(r.data.you).toMatchObject({ name: "مالک آزمایشی", role: "member", role_fa: "عضو" });
    expect(r.data.you.access.users).toMatchObject({ level: "view", title_fa: "کاربران و دسترسی‌ها" });
    expect(r.data.you.access.integrations.level).toBe("none");
    expect(r.data.today.time_zone).toBe("Asia/Tehran");
    expect(r.data.today.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.data.today.jalali).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);
    expect(r.data.today.jalali_year).toBeGreaterThanOrEqual(1405);
    expect(r.summary_fa).toContain("سازمان آزمایشی");
    // another time zone's «today» is the organisation's own
    const far = await run("get_org_context", {}, await ctxAs("owner", { timezone: "Pacific/Kiritimati" }));
    expect(far.data.today.time_zone).toBe("Pacific/Kiritimati");
  });

  it("lists members with masking by the data policy, filters by role and checks users:view", async () => {
    const all = await run("list_members", {}, await ctxAs("owner"));
    expect(all.data.total_rows).toBe(4);
    expect(all.data.members[0]).toMatchObject({ role: "owner", role_fa: "مالک", active: true });
    expect(all.data.members.map((m: { name: string }) => m.name)).toEqual(["مالک آزمایشی", "سارا محمدی", "علی رضایی", "رضا کریمی"]);
    expect(all.data.members.find((m: { name: string }) => m.name === "سارا محمدی").title).toBe("سرپرست پشتیبانی");
    expect(all.table?.columns.map((x) => x.key)).toEqual(expect.arrayContaining(["label", "role"]));
    expect(all.data_ref).toBeTruthy();
    const admins = await run("list_members", { role: "admin" }, await ctxAs("owner"));
    expect(admins.data.members.map((m: { name: string }) => m.name)).toEqual(["سارا محمدی"]);
    const byName = await run("list_members", { query: "رضا" }, await ctxAs("owner"));
    expect(byName.data.members.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining(["علی رضایی", "رضا کریمی"]));
    // masked: e-mail addresses are not shown in full
    const masked = await run("list_members", {}, await ctxAs("owner"), runtime("masked"));
    expect(JSON.stringify(masked.data)).not.toContain("ali@example.com");
    // aggregates: counts by role only
    const agg = await run("list_members", {}, await ctxAs("owner"), runtime("aggregates"));
    expect(agg.data.members).toBeUndefined();
    expect(agg.data.by_role.map((r: { role: string; members: number }) => [r.role, r.members])).toEqual(expect.arrayContaining([["owner", 1], ["admin", 1], ["member", 1], ["viewer", 1]]));
    expect(JSON.stringify(agg.data)).not.toContain("سارا");
    await expect(run("list_members", {}, await ctxAs("viewer"))).rejects.toThrow();
  });

  it("calculates exactly without eval", async () => {
    expect(evaluate("(1200 + 300) × 9%").toString()).toBe("135");
    expect(evaluate("۳٫۵ میلیارد / ۷").toString()).toBe("500000000");
    expect(evaluate("0.1 + 0.2").toString()).toBe("0.3");
    expect(evaluate("-(2 - 5) * 1,000").toString()).toBe("3000");
    const r = await run("calculate", { expression: "10 / 3", decimals: 4 });
    expect(r.data.rounded).toBe("3.3333");
    await expect(run("calculate", { expression: "1 / 0" })).rejects.toThrow(/صفر/);
    await expect(run("calculate", { expression: "process.exit()" })).rejects.toThrow();
  });

  it("draws a chart only of rows another tool stored", async () => {
    const r = await run("render_chart", { data_ref: "ref1xxxxxx", kind: "bar", series: [{ field: "value", label: "تعداد" }], unit: "مورد" });
    expect(r.chart).toMatchObject({ kind: "bar", x: "label", unit: "مورد" });
    expect(r.data_ref).toBe("ref1xxxxxx");
    await expect(run("render_chart", { data_ref: "ref1'; drop--", kind: "bar", series: [{ field: "value", label: "x" }] })).rejects.toThrow();
  });

  it("resolves Jalali periods on the server", () => {
    const m = presetPeriod("this_month", TODAY);
    expect([m.from, m.to]).toEqual(["2026-10-23", "2026-11-21"]);
    expect(m.label_fa).toBe("آبان ۱۴۰۵");
    const lm = presetPeriod("last_month", TODAY);
    expect([lm.from, lm.to]).toEqual(["2026-09-23", "2026-10-22"]);
    const q = presetPeriod("this_quarter", TODAY);
    expect([q.from, q.to]).toEqual(["2026-09-23", "2026-12-21"]);
    expect(q.label_fa).toBe("پاییز ۱۴۰۵");
    const w = presetPeriod("this_week", TODAY); // Monday → week starts Saturday 2026-10-31
    expect(w.from).toBe("2026-10-31");
    expect(comparePeriod(lm, "same_period_last_year").from).toBe("2025-09-23");
    expect(comparePeriod(lm, "previous_period").label_fa).toBe("شهریور ۱۴۰۵");
    expect(parseDateInput("۱۴۰۵/۰۸/۰۱", TODAY)).toBe("2026-10-23");
    expect(resolvePeriod({ from: "1405/07/01", to: "2026-10-22" }, TODAY).days).toBe(30);
    expect(() => resolvePeriod({ from: "1405/13/40" }, TODAY)).toThrow();
  });

  it("compares month to date with the first days of the previous month", () => {
    // 1405/08/21: 1–21 Aban against 1–21 Mehr (not 10–30 Mehr)
    const cur = presetPeriod("month_to_date", "2026-11-12");
    expect(cur.days).toBe(21);
    const prev = previousMonthToDate(cur);
    expect([prev.from, prev.to]).toEqual(["2026-09-23", "2026-10-13"]);
    expect(prev.days).toBe(21);
    // the 31st of a 31-day month against a 30-day month: cut at that month's end
    const long = presetPeriod("month_to_date", "2026-08-22"); // 1405/05/31
    expect(previousMonthToDate(long).to).toBe("2026-07-22"); // 1405/04/31
    const esf = previousMonthToDate(presetPeriod("month_to_date", "2027-04-20")); // 1406/01/31 against Esfand 1405
    expect([esf.from, esf.to]).toEqual(["2027-02-20", "2027-03-20"]);
  });

  it("gives the model a context block with the organisation, today and the member, following the data policy", async () => {
    const ctx = await ctxAs("member");
    const parse = (b: string) => JSON.parse(b.replace(/<\/?context>/g, ""));
    const full = parse(await contextBlock(ctx, { path: "settings/users", title: "کاربران", record: null, report: null }, "full"));
    expect(full).toMatchObject({ organisation: "سازمان آزمایشی", modules: [], member: { name: "مالک آزمایشی", role: "member", role_fa: "عضو" }, current_page: { path: "settings/users", title: "کاربران" } });
    expect(full.today.time_zone).toBe("Asia/Tehran");
    const agg = parse(await contextBlock(ctx, null, "aggregates"));
    expect(agg.member).toEqual({ role: "member", role_fa: "عضو" });
    expect(agg.current_page).toBeUndefined();
  });

  it("a module's proposal tool prepares a draft; its executor writes only for a permitted person", async () => {
    const owner = await ctxAs("owner");
    const p = await run("propose_test_item", { name: "روتر شعبه" }, owner);
    expect(p.proposal).toMatchObject({ kind: "test_item", area: "settings", level: "edit" });
    // nothing is written by the tool itself
    expect(await db.one(`select 1 from sm_test_items where org_id = $1 and name = 'روتر شعبه'`, [org])).toBeNull();
    await expect(executeProposal(await ctxAs("viewer"), "test_item", p.proposal!.payload)).rejects.toThrow();
    await expect(executeProposal(owner, "test_item", { name: "" })).rejects.toThrow(/پیشنهاد معتبر نیست/);
    await expect(executeProposal(owner, "no_such_kind", {})).rejects.toThrow(/پشتیبانی نمی‌شود/);
    const ref = await executeProposal(owner, "test_item", p.proposal!.payload);
    expect(ref).toMatchObject({ type: "test_item", label: "روتر شعبه" });
    expect(await db.one(`select code from sm_test_items where id = $1`, [ref.id])).toEqual({ code: "1002" });
    // the platform proposes nothing itself: modules' executors, besides the AI skills framework's own (skill.*)
    expect(Object.keys(EXECUTORS).filter((k) => !k.startsWith("skill."))).toEqual(["test_item"]);
    // a module's read tool repeats its route's permission check
    const found = await run("find_test_items", { query: "سوئیچ" }, await ctxAs("viewer"));
    expect(found.data.items.map((i: { name: string }) => i.name)).toEqual(["سوئیچ هسته"]);
    await expect(run("find_test_items", { query: "x" }, await ctxAs("viewer", { overrides: { settings: "none" } }))).rejects.toThrow();
  });
});
