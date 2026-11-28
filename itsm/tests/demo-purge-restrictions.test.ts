// «حذف داده‌های نمایشی» never widens what an audience or a catalogue reaches, and never removes what can be switched off
// (docs/DEMO_FA.md «آنچه پاک‌سازی می‌شود», the review of 1.1.5):
//   · a catalogue audience whose criteria combine with «همه» loses a criterion that named only the pack's data — the
//     pack's branch — and stops: dropping the criterion would make «agents of the pack's branch» every agent of the
//     organisation. With «هر یک» that criterion only stops counting (the others still match whom they matched; a
//     condition that can no longer hold does not switch the audience off), and an audience left with no criterion that
//     can hold stops; a list that keeps a live id only narrows. Each has its review line (a definition, not a record).
//   · a catalogue category for an audience of the pack's is switched off (an empty «در دسترس برای» means everyone);
//   · a catalogue item for an audience of the pack's is never deleted: a published one is retired («بازنشسته»), a draft
//     stays a draft (it cannot be ordered) and its review line asks for an audience before it is published; a change
//     lockdown that only held the pack's CIs ends through its lifecycle («پایان‌یافته»); a saved view, which has neither
//     a «فعال» flag nor a lifecycle, is removed — and the preview, the review line and the report say «حذف», never
//     «غیرفعال».
// The pack is simulated as tests/demo-purge-conflicts.test.ts does (a loaded pack row, demo rows written inside the demo
// scope); the catalogue is the starter IT catalogue (tests/request-helpers.ts).
import { describe, it, expect, beforeAll } from "vitest";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { danglingRefs, runToEnd } from "@server/modules/demo";
import { audienceMatches, audienceOf, type MemberFacts } from "@shared/request/audience";
import type { Ctx } from "@server/context";
import { requestKit, type RequestKit } from "./request-helpers";
import type { EngineOrg } from "./engine-helpers";

async function packOf(e: EngineOrg) {
  await e.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [e.org, e.ownerId],
  );
}

/** The ids of every row of the organisation, to tell what the purge removed. */
async function allIds(e: EngineOrg): Promise<Set<string>> {
  const out = new Set<string>();
  const tables = await e.db.query<{ t: string }>(
    `select c.table_name as t from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%' and c.column_name = 'org_id' and c.table_name not like 'sm\\_demo\\_%'
        and exists (select 1 from information_schema.columns i where i.table_schema = c.table_schema and i.table_name = c.table_name and i.column_name = 'id' and i.data_type = 'uuid')`,
  );
  for (const { t } of tables) for (const r of await e.db.query<{ id: string }>(`select id::text as id from ${t} where org_id = $1`, [e.org])) out.add(r.id);
  return out;
}

describe("the purge never widens an audience or a catalogue, and ends what it can switch off without deleting it", () => {
  let k: RequestKit;
  let e: EngineOrg;
  let sys: Ctx;
  let P = "";
  const pack: Record<string, string> = {};
  const real: Record<string, string> = {};
  let removed = new Set<string>();
  let preview: { cleaned: { table: string; id: string; name: string; what: string; deactivated: boolean; retired?: boolean; removed?: boolean; ended?: string }[] } | null = null;
  /** An agent of a real unit, as the catalogue's entitlement sees them. */
  const agent = (): MemberFacts => ({ userId: real.agent, groups: [], unitPath: [real.unit], locationPath: [], roles: ["agent"], persona: "agent", vip: false });
  const row = (table: string, id: string) => e.db.one<Record<string, any>>(`select * from ${table} where id = $1`, [id]);
  const entry = (id: string) => preview!.cleaned.find((c) => c.id === id);
  const review = async (id: string) =>
    (await e.db.query<{ summary: string; data: Record<string, unknown> }>(`select summary, data from sm_audit where org_id = $1 and action = 'demo_purge_review' and entity_id = $2`, [e.org, id]))[0] ?? null;

  beforeAll(async () => {
    k = await requestKit();
    e = k.o;
    P = k.P;
    sys = await systemCtx(e.cfg, e.org);
    await packOf(e);
    // the pack: a branch, a group, a CI, and an audience of its people (a demo person made it, inside the scope)
    Object.assign(
      pack,
      await inDemoScope(e.org, () =>
        sys.write(async (tx) => {
          const branch = String((await createIn(tx, sys, "org_unit", { name: "شعبهٔ نمایشی میدان" }, { trusted: true })).id);
          const group = String((await createIn(tx, sys, "group", { name: "میز خدمت نمایشی", types: ["assignment"] }, { trusted: true })).id);
          const ci = String((await createIn(tx, sys, "ci", { name: "سوئیچ نمایشی", class: "server" }, { trusted: true })).id);
          const audience = String((await createIn(tx, sys, "catalog_audience", { name: "کارکنان شعبهٔ نمایشی", match: "any", units: [branch] }, { trusted: true })).id);
          return { branch, group, ci, audience };
        }),
      ),
    );
    const o = e.owner;
    real.unit = (await o.post(`${P}/r/org_unit`, { name: "ادارهٔ فناوری (واقعی)" })).row.id;
    real.agent = (await k.person("aud-agent@example.com", { roles: ["agent"] })).userId;
    // audiences the owner built on the pack's branch
    const audience = async (key: string, data: Record<string, unknown>) => (real[key] = (await o.post(`${P}/r/catalog_audience`, data)).row.id);
    await audience("all", { name: "کارشناسان شعبهٔ نمایشی", match: "all", units: [pack.branch], roles: ["agent"] });
    await audience("any", { name: "کارشناسان یا کارکنان شعبهٔ نمایشی", match: "any", units: [pack.branch], roles: ["agent"] });
    await audience("anyGone", { name: "میز خدمت یا شعبهٔ نمایشی", match: "any", units: [pack.branch], groups: [pack.group] });
    await audience("narrow", { name: "کارشناسان دو واحد", match: "all", units: [pack.branch, real.unit], roles: ["agent"] });
    await audience("anyCond", { name: "کارشناسان یا اعضای شعبهٔ نمایشی", match: "any", roles: ["agent"], condition: { f: "org_unit_id", op: "eq", v: pack.branch } });
    // a category and two items for the pack's audience
    const cat = (await k.rows("catalog", "name = $2", ["فناوری اطلاعات"]))[0];
    real.category = (await o.post(`${P}/r/catalog_category`, { name: "خدمات شعبهٔ نمایشی", catalog_id: cat.id, available_for: [pack.audience] })).row.id;
    real.published = (await o.post(`${P}/r/catalog_item`, { name: "کارت خوان شعبه (منتشرشده)", code: "branch_reader", type: "standard", catalog_id: cat.id, requires_confirmation: false, available_for: [pack.audience] })).row.id;
    await o.post(`${P}/request/builder/${real.published}/publish`, {});
    real.draft = (await o.post(`${P}/r/catalog_item`, { name: "چاپگر شعبه (پیش‌نویس)", code: "branch_printer", type: "standard", catalog_id: cat.id, available_for: [pack.audience] })).row.id;
    // a lockdown of the pack's switch (its condition), a saved view of the pack's group
    real.lockdown = (await o.post(`${P}/r/change_lockdown`, { title: "قرنطینهٔ سوئیچ نمایشی", starts_at: new Date(Date.now() + 86_400_000).toISOString(), scope_condition: { f: "ci_id", op: "eq", v: pack.ci } })).row.id;
    real.view = (await o.post(`${P}/r/view`, { table_key: "incident", name: "رخدادهای میز خدمت نمایشی", shared: true, filter: { f: "assignment_group_id", op: "eq", v: pack.group } })).row.id;
    expect((await row("sm_catalog_items", real.published))!.state).toBe("published");
    // before the purge: «agents of the pack's branch» is not every agent
    expect(audienceMatches(audienceOf((await row("sm_catalog_audiences", real.all))!), agent())).toBe(false);
    expect(audienceMatches(audienceOf((await row("sm_catalog_audiences", real.any))!), agent())).toBe(true);

    preview = await o.get(`${P}/demo/report`);
    const before = await allIds(e);
    await e.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [e.ownerId]);
    await o.post(`${P}/demo/purge`, { confirm: "حذف کامل" });
    await runToEnd(e.cfg, e.org, "purge", { budgetMs: 300_000 });
    expect(await e.db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [e.org])).toBeNull();
    const after = await allIds(e);
    removed = new Set([...before].filter((id) => !after.has(id)));
  }, 600_000);

  it("an audience of «همه» whose branch went with the pack stops, and matches nobody it did not match", async () => {
    const a = (await row("sm_catalog_audiences", real.all))!;
    expect(a.active).toBe(false);
    expect(a.units ?? []).toEqual([]);
    expect(a.roles).toEqual(["agent"]);
    expect(audienceMatches(audienceOf(a), agent())).toBe(false);
    expect(entry(real.all)).toMatchObject({ table: "catalog_audience", deactivated: true });
    expect((await review(real.all))?.summary).toContain("غیرفعال شد");
  });

  it("an audience of «هر یک» keeps its other criteria; one left with none that can hold stops; a list that keeps a live id narrows", async () => {
    const any = (await row("sm_catalog_audiences", real.any))!;
    expect(any).toMatchObject({ active: true, roles: ["agent"] });
    expect(any.units ?? []).toEqual([]);
    expect(audienceMatches(audienceOf(any), agent())).toBe(true);
    expect(entry(real.any)).toMatchObject({ deactivated: false });
    expect((await review(real.any))?.summary).toContain("پاک‌سازی شد");
    // a condition that can no longer hold only stops counting: the agents it matched still match
    const cond = (await row("sm_catalog_audiences", real.anyCond))!;
    expect(cond).toMatchObject({ active: true, roles: ["agent"], condition: { or: [] } });
    expect(entry(real.anyCond)).toMatchObject({ deactivated: false });
    expect((await row("sm_catalog_audiences", real.anyGone))!.active).toBe(false);
    const narrow = (await row("sm_catalog_audiences", real.narrow))!;
    expect(narrow).toMatchObject({ active: true, units: [real.unit] });
    expect(audienceMatches(audienceOf(narrow), agent())).toBe(true);
  });

  it("a catalogue category for the pack's audience is switched off, never opened to everyone", async () => {
    const c = (await row("sm_catalog_categories", real.category))!;
    expect(c.active).toBe(false);
    expect(c.available_for ?? []).toEqual([]);
    expect(entry(real.category)).toMatchObject({ deactivated: true });
  });

  it("a published catalogue item is retired, a draft stays a draft and asks for an audience; neither is deleted", async () => {
    const pub = (await row("sm_catalog_items", real.published))!;
    expect(pub.deleted_at).toBeNull();
    expect(pub.state).toBe("retired");
    expect(pub.available_for ?? []).toEqual([]);
    expect(entry(real.published)).toMatchObject({ retired: true, deactivated: false });
    expect((await review(real.published))?.summary).toContain("بازنشسته شد");
    const draft = (await row("sm_catalog_items", real.draft))!;
    expect(draft.deleted_at).toBeNull();
    expect(draft.state).toBe("draft");
    expect(draft.available_for ?? []).toEqual([]);
    const d = entry(real.draft)!;
    expect(d.deactivated || d.retired || d.removed || d.ended).toBeFalsy();
    expect(d.what).toContain("پیش از انتشار");
    expect((await review(real.draft))?.summary).toContain("پیش از انتشار");
  });

  it("a lockdown that only held the pack's CIs ends through its lifecycle; a saved view is removed and said to be", async () => {
    const lock = (await row("sm_change_lockdowns", real.lockdown))!;
    expect(lock.deleted_at).toBeNull();
    expect(lock.state).toBe("released");
    expect(entry(real.lockdown)).toMatchObject({ ended: "پایان‌یافته", deactivated: false });
    expect((await review(real.lockdown))?.summary).toContain("«پایان‌یافته»");
    const view = (await row("sm_views", real.view))!;
    expect(view.deleted_at).not.toBeNull();
    expect(entry(real.view)).toMatchObject({ removed: true, deactivated: false });
    const line = (await review(real.view))!;
    expect(line.summary).toContain("حذف شد");
    expect(line.summary).not.toContain("غیرفعال");
    expect(line.data).toMatchObject({ removed: true, deactivated: false });
    // the report counts what was removed apart from what was switched off
    const audit = await e.db.one<{ data: Record<string, number> }>(`select data from sm_audit where org_id = $1 and action = 'demo_purge' order by at desc limit 1`, [e.org]);
    expect(audit!.data.removed).toBeGreaterThanOrEqual(1);
  });

  it("nothing names a removed row", async () => {
    expect(await danglingRefs(e.db, e.org, removed)).toEqual([]);
  });
});
