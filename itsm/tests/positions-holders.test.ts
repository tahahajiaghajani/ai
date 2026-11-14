// F3 — organisational roles as records (design F §3.4, D3, D12): `position` and `position_holder` in area `org`.
//   · access: every built-in role but the contractor reads them (requesters included); placing a holder takes `org`
//     write that reaches the holder's unit — agents and requesters cannot, nor team leads (their «group» scope reaches
//     no holder, though the area lets them create), a unit-scoped keeper only in their unit, an administrator anywhere;
//   · holder changes bump no scope epoch and leave the access version alone (positions decide who receives work, not
//     what anyone may read);
//   · integrity: a key that never changes, a name of its own, «reports to» without loops, nothing held deleted; a live,
//     active position, a unit of its kind, dates in order, one row per position, person and unit;
//   · provenance is the server's: a person's holder is «دستی», a pushed one too; rows a directory or a file keeps keep
//     their position, person and unit;
//   · a Windows app's push meets the same rules;
//   · holders from a spreadsheet: rows or an import set's file, a dry run first, merge (manual and directory holders
//     left alone) and replace (only the set's own holders removed), each row's problem in Persian.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, upload, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { createIn, systemCtx } from "@server/engine";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "@server/context";

type Err = { error: { message: string } };

let e: EngineOrg;
let P: string;
let R: string;
let sys: Ctx;
const U: Record<string, string> = {};
const POS: Record<string, string> = {};
let requester: { client: Client; userId: string };
let agent: { client: Client; userId: string };
let lead: { client: Client; userId: string };
let keeper: { client: Client; userId: string };
let staff: { client: Client; userId: string };

const holderRow = async (id: string) => (await e.db.one<Record<string, unknown>>(`select position_id, user_id, org_unit_id, kind, source, source_ref, valid_to::text as valid_to, deleted_at from sm_position_holders where id = $1`, [id]))!;

async function pushHolder(c: Client, row: Record<string, unknown>): Promise<{ status: string; message?: string }> {
  const id = String(row.id ?? uuidv7());
  const now = new Date().toISOString();
  const out = await c.post(`/sync/push`, { org_id: e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: "position_holder", id, base_rev: 0, row: { id, org_id: e.org, created_at: now, updated_at: now, ...row } }] });
  return out.results[0];
}

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  R = `${P}/r`;
  sys = await systemCtx(e.cfg, e.org);
  U.vanak = (await e.owner.post(`${R}/org_unit`, { name: "شعبهٔ ونک", code: "1001", kind: "branch" })).row.id;
  U.tajrish = (await e.owner.post(`${R}/org_unit`, { name: "شعبهٔ تجریش", code: "1002", kind: "branch" })).row.id;
  U.finance = (await e.owner.post(`${R}/org_unit`, { name: "ادارهٔ مالی", code: "FIN", kind: "department" })).row.id;
  POS.head = (await e.owner.post(`${R}/position`, { key: "branch_head", name: "رئیس شعبه", unit_kind: "branch" })).row.id;
  POS.officer = (await e.owner.post(`${R}/position`, { key: "credit_officer", name: "کارشناس اعتبارات" })).row.id;
  const as = async (roles: string[], persona: "requester" | "agent", extra: Record<string, unknown> = {}) => {
    const m = await e.member("member");
    await e.owner.put(`${P}/access/members/${m.userId}`, { roles, persona, ...extra });
    return m;
  };
  // a keeper of the structure of one branch: `org` write in their unit only
  await e.owner.put(`${P}/access/roles/branch_keeper`, {
    name: "نگه‌دارندهٔ ساختار شعبه", description: "", persona: "agent", grants: { org: { read: "all", create: true, write: "unit", delete: "unit", approve: false, admin: false } },
    field_groups: [], contains: [], workspaces: "member", domains: "own", active: true,
  });
  requester = await as(["requester"], "requester");
  agent = await as(["agent"], "agent");
  lead = await as(["team_lead"], "agent");
  keeper = await as(["branch_keeper"], "agent", { org_unit_id: U.vanak });
  staff = await as(["requester"], "requester", { org_unit_id: U.vanak });
}, 600_000);

describe("who reads and who keeps organisational roles", () => {
  it("requesters and agents read positions and holders; neither places a holder", async () => {
    const h = (await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: staff.userId, org_unit_id: U.vanak })).row;
    for (const c of [requester.client, agent.client]) {
      expect((await c.get(`${R}/position`)).rows.map((r: { key: string }) => r.key).sort()).toEqual(["branch_head", "credit_officer"]);
      expect((await c.get(`${R}/position_holder`)).rows.map((r: { id: string }) => r.id)).toContain(h.id);
      await c.post(`${R}/position`, { key: "teller", name: "تحویلدار" }, 403);
      await c.post(`${R}/position_holder`, { position_id: POS.officer, user_id: requester.userId }, 403);
      await c.patch(`${R}/position_holder/${h.id}`, { kind: "acting" }, 403);
    }
    await e.owner.del(`${R}/position_holder/${h.id}`);
  });

  it("team leads, whose «group» scope reaches no holder, place none — though the area lets them create", async () => {
    const r = (await lead.client.post(`${R}/position_holder`, { position_id: POS.head, user_id: lead.userId, org_unit_id: U.vanak }, 403)) as Err;
    expect(r.error.message).toBe("اجازهٔ تعیین دارندهٔ نقش سازمانی در «شعبهٔ ونک» را ندارید؛ تغییر ساختار سازمانی در این واحد لازم است");
    const loose = (await lead.client.post(`${R}/position_holder`, { position_id: POS.officer, user_id: lead.userId }, 403)) as Err;
    expect(loose.error.message).toBe("اجازهٔ تعیین دارندهٔ نقش سازمانی را ندارید؛ تغییر ساختار سازمانی سازمان لازم است");
    expect(await e.db.one(`select 1 from sm_position_holders where org_id = $1 and user_id = $2`, [e.org, lead.userId])).toBeNull();
  });

  it("a unit-scoped keeper places holders in their unit only, and cannot move one out of it", async () => {
    const mine = (await keeper.client.post(`${R}/position_holder`, { position_id: POS.head, user_id: staff.userId, org_unit_id: U.vanak })).row;
    expect(await holderRow(mine.id)).toMatchObject({ source: "manual", org_unit_id: U.vanak });
    await keeper.client.post(`${R}/position_holder`, { position_id: POS.head, user_id: keeper.userId, org_unit_id: U.tajrish }, 403);
    await keeper.client.patch(`${R}/position_holder/${mine.id}`, { org_unit_id: U.tajrish }, 403);
    await keeper.client.patch(`${R}/position_holder/${mine.id}`, { kind: "acting" });
    // the administrator places holders anywhere
    const there = (await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: keeper.userId, org_unit_id: U.tajrish })).row;
    await keeper.client.del(`${R}/position_holder/${there.id}`, 403);
    await e.owner.del(`${R}/position_holder/${there.id}`);
    await keeper.client.del(`${R}/position_holder/${mine.id}`);
  });
});

describe("holder changes bump no scope epoch", () => {
  it("create, change and remove a holder: every member's epoch and the access version stay as they were", async () => {
    const snapshot = async () => ({
      epochs: await e.db.query(`select user_id, epoch from sm_scope_epochs where org_id = $1 order by user_id`, [e.org]),
      version: (await e.db.one<{ version: string }>(`select version::text as version from sm_access_state where org_id = $1`, [e.org]))?.version ?? null,
    });
    const before = await snapshot();
    const h = (await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: agent.userId, org_unit_id: U.tajrish })).row;
    await e.owner.patch(`${R}/position_holder/${h.id}`, { kind: "temporary", valid_to: "2027-03-20" });
    await e.owner.patch(`${R}/position_holder/${h.id}`, { org_unit_id: U.vanak });
    await e.owner.del(`${R}/position_holder/${h.id}`);
    const p = (await e.owner.post(`${R}/position`, { key: "deputy", name: "معاون شعبه", unit_kind: "branch" })).row;
    await e.owner.patch(`${R}/position/${p.id}`, { name: "معاون شعبه (اعتبارات)" });
    await e.owner.del(`${R}/position/${p.id}`);
    expect(await snapshot()).toEqual(before);
    // what does move them: a group membership (the measurement is live)
    const g = (await e.owner.post(`${R}/group`, { name: "گروه سنجش", types: ["assignment"] })).row.id;
    await e.owner.post(`${R}/group_member`, { group_id: g, user_id: agent.userId });
    expect(await snapshot()).not.toEqual(before);
  });
});

describe("integrity of positions", () => {
  it("a Latin key that never changes, a name of its own, «reports to» without loops", async () => {
    expect(((await e.owner.post(`${R}/position`, { key: "Branch Head", name: "رئیس" }, 400)) as Err).error.message).toBe(
      "کلید نقش سازمانی با حرف لاتین کوچک شروع می‌شود و فقط حرف لاتین کوچک، رقم و _ دارد (مانند branch_head)",
    );
    expect(((await e.owner.post(`${R}/position`, { key: "branch_head", name: "رئیس دیگر" }, 409)) as Err).error.message).toBe("ترکیب «کلید» تکراری است");
    expect(((await e.owner.post(`${R}/position`, { key: "head2", name: "  رئیس   شعبه " }, 400)) as Err).error.message).toBe("نقش سازمانی «رئیس   شعبه» هست؛ نام دیگری برگزینید");
    expect(((await e.owner.patch(`${R}/position/${POS.officer}`, { key: "credit" }, 400)) as Err).error.message).toBe("کلید نقش سازمانی پس از ساخت تغییر نمی‌کند؛ گردش‌کارها با آن به این نقش اشاره می‌کنند");
    const area = (await e.owner.post(`${R}/position`, { key: "area_head", name: "رئیس منطقه", reports_to: null })).row;
    await e.owner.patch(`${R}/position/${POS.head}`, { reports_to: area.id });
    expect(((await e.owner.patch(`${R}/position/${area.id}`, { reports_to: POS.head }, 400)) as Err).error.message).toBe("«گزارش به» دور می‌سازد: این نقش در زنجیرهٔ بالادست خودش است");
    // nothing that others report to, or that people hold, is deleted
    expect(((await e.owner.del(`${R}/position/${area.id}`, 400)) as Err).error.message).toBe("«رئیس شعبه» به این نقش گزارش می‌دهند؛ نخست «گزارش به» آن‌ها را تغییر دهید");
    const h = (await e.owner.post(`${R}/position_holder`, { position_id: POS.officer, user_id: agent.userId })).row;
    expect(((await e.owner.del(`${R}/position/${POS.officer}`, 400)) as Err).error.message).toBe("«کارشناس اعتبارات» ۱ دارنده دارد؛ نخست دارندگان آن را بردارید یا نقش را غیرفعال کنید");
    // its unit kind does not change under a holder of another kind
    expect(((await e.owner.patch(`${R}/position/${POS.officer}`, { unit_kind: "branch" }, 400)) as Err).error.message).toBe("۱ دارندهٔ این نقش در واحدی از نوع «شعبه» نیستند؛ نخست واحد آن‌ها را درست کنید");
    await e.owner.del(`${R}/position_holder/${h.id}`);
    await e.owner.patch(`${R}/position/${POS.head}`, { reports_to: null });
    await e.owner.del(`${R}/position/${area.id}`);
  });
});

describe("integrity of holders", () => {
  it("a live, active position; a unit of its kind; dates in order; one row per position, person and unit", async () => {
    const off = (await e.owner.post(`${R}/position`, { key: "archived", name: "سمت بایگانی", active: false })).row;
    expect(((await e.owner.post(`${R}/position_holder`, { position_id: off.id, user_id: agent.userId }, 400)) as Err).error.message).toBe("نقش سازمانی «سمت بایگانی» غیرفعال است؛ نخست آن را فعال کنید");
    expect(((await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: agent.userId }, 400)) as Err).error.message).toBe("«رئیس شعبه» در واحدهای نوع «شعبه» است؛ واحد را انتخاب کنید");
    expect(((await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: agent.userId, org_unit_id: U.finance }, 400)) as Err).error.message).toBe(
      "«ادارهٔ مالی» از نوع «اداره» است؛ «رئیس شعبه» در واحدهای نوع «شعبه» است",
    );
    expect(((await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: agent.userId, org_unit_id: U.vanak, valid_from: "2026-12-01", valid_to: "2026-11-01" }, 400)) as Err).error.message).toBe(
      "«تا تاریخ» نباید پیش از «از تاریخ» باشد",
    );
    const a = (await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: agent.userId, org_unit_id: U.vanak })).row;
    expect(((await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: agent.userId, org_unit_id: U.vanak, kind: "acting" }, 400)) as Err).error.message).toMatch(/همین حالا «رئیس شعبه» در «شعبهٔ ونک» است$/);
    // a position held without a unit: still one row per person (the database index cannot see an empty unit)
    const b = (await e.owner.post(`${R}/position_holder`, { position_id: POS.officer, user_id: agent.userId })).row;
    expect(((await e.owner.post(`${R}/position_holder`, { position_id: POS.officer, user_id: agent.userId }, 400)) as Err).error.message).toMatch(/همین حالا «کارشناس اعتبارات» است$/);
    // removed, it can be held again
    await e.owner.del(`${R}/position_holder/${a.id}`);
    const again = (await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: agent.userId, org_unit_id: U.vanak })).row;
    await e.owner.del(`${R}/position_holder/${again.id}`);
    await e.owner.del(`${R}/position_holder/${b.id}`);
  });

  it("provenance is the server's: a person's holder is «دستی»; a directory's or a file's keeps its position, person and unit", async () => {
    const mine = (await e.owner.post(`${R}/position_holder`, { position_id: POS.officer, user_id: requester.userId, source: "directory", source_ref: "forged" })).row;
    expect(await holderRow(mine.id)).toMatchObject({ source: "manual", source_ref: null });
    const ad = await sys.write((tx) => createIn(tx, sys, "position_holder", { position_id: POS.head, user_id: requester.userId, org_unit_id: U.vanak, source: "directory", source_ref: uuidv7() }, { trusted: true }));
    expect(((await e.owner.patch(`${R}/position_holder/${ad.id}`, { org_unit_id: U.tajrish }, 400)) as Err).error.message).toBe(
      "این دارنده را فهرست کاربران (AD) نگه می‌دارد؛ نقش، شخص یا واحد آن را در AD تغییر دهید، یا آن را پایان دهید یا بردارید",
    );
    await e.owner.patch(`${R}/position_holder/${ad.id}`, { valid_to: "2027-01-01" });
    expect(await holderRow(String(ad.id))).toMatchObject({ source: "directory", valid_to: "2027-01-01" });
    const file = await sys.write((tx) => createIn(tx, sys, "position_holder", { position_id: POS.head, user_id: requester.userId, org_unit_id: U.tajrish, source: "import", source_ref: uuidv7() }, { trusted: true }));
    expect(((await e.owner.patch(`${R}/position_holder/${file.id}`, { user_id: agent.userId }, 400)) as Err).error.message).toBe(
      "این دارنده از ورود فایل آمده است؛ نقش، شخص یا واحد آن را در فایل تغییر دهید و دوباره وارد کنید، یا آن را پایان دهید یا بردارید",
    );
    for (const id of [mine.id, ad.id, file.id]) await e.owner.del(`${R}/position_holder/${id}`);
  });

  it("a Windows app's push meets the same rules: access, the unit's kind; provenance is the cloud's", async () => {
    const refused = await pushHolder(lead.client, { position_id: POS.head, user_id: lead.userId, org_unit_id: U.vanak, kind: "primary" });
    expect(refused).toMatchObject({ status: "error", message: expect.stringContaining("اجازهٔ تعیین دارندهٔ نقش سازمانی") });
    const wrongKind = await pushHolder(e.owner, { position_id: POS.head, user_id: agent.userId, org_unit_id: U.finance, kind: "primary" });
    expect(wrongKind).toMatchObject({ status: "error", message: "«ادارهٔ مالی» از نوع «اداره» است؛ «رئیس شعبه» در واحدهای نوع «شعبه» است" });
    const id = uuidv7();
    expect(await pushHolder(e.owner, { id, position_id: POS.head, user_id: agent.userId, org_unit_id: U.vanak, kind: "primary", source: "directory", source_ref: "forged" })).toMatchObject({ status: "ok" });
    expect(await holderRow(id)).toMatchObject({ source: "manual", source_ref: null, org_unit_id: U.vanak });
    await e.owner.del(`${R}/position_holder/${id}`);
  });
});

describe("holders from a spreadsheet", () => {
  const H = { position: "نقش سازمانی", email: "ایمیل", unit: "کد شعبه", kind: "نوع", from: "از تاریخ", to: "تا تاریخ" };
  const emailOf = async (userId: string) => (await e.db.one<{ email: string }>(`select email from sm_users where id = $1`, [userId]))!.email;

  it("is for those who keep the structure", async () => {
    for (const c of [agent.client, lead.client]) {
      const r = (await c.post(`${P}/positions/holders/import`, { rows: [], dry_run: true }, 403)) as Err;
      expect(r.error.message).toBe("نگه‌داری دارندگان نقش‌های سازمانی با کسانی است که ساختار سازمانی را تغییر می‌دهند");
    }
  });

  it("checks every row in a dry run, then merges: the file's holders are created or updated, manual and directory ones left alone", async () => {
    const staffMail = await emailOf(staff.userId);
    const agentMail = await emailOf(agent.userId);
    const keeperMail = await emailOf(keeper.userId);
    const manual = (await e.owner.post(`${R}/position_holder`, { position_id: POS.head, user_id: keeper.userId, org_unit_id: U.vanak })).row;
    const ad = await sys.write((tx) => createIn(tx, sys, "position_holder", { position_id: POS.officer, user_id: agent.userId, source: "directory", source_ref: uuidv7() }, { trusted: true }));
    const rows = [
      { [H.position]: "رئیس شعبه", [H.email]: staffMail, [H.unit]: "1002", [H.kind]: "سرپرست (کفیل)", [H.from]: "۱۴۰۵/۰۸/۰۱", [H.to]: "" },
      { [H.position]: "branch_head", [H.email]: keeperMail.toUpperCase(), [H.unit]: "1001", [H.kind]: "", [H.from]: "", [H.to]: "" },
      { [H.position]: "credit_officer", [H.email]: agentMail, [H.unit]: "", [H.kind]: "اصلی", [H.from]: "", [H.to]: "" },
      { [H.position]: "مدیر کل", [H.email]: staffMail, [H.unit]: "", [H.kind]: "", [H.from]: "", [H.to]: "" },
      { [H.position]: "رئیس شعبه", [H.email]: "nobody@example.com", [H.unit]: "1001", [H.kind]: "", [H.from]: "", [H.to]: "" },
      { [H.position]: "رئیس شعبه", [H.email]: staffMail, [H.unit]: "9999", [H.kind]: "", [H.from]: "", [H.to]: "" },
      { [H.position]: "رئیس شعبه", [H.email]: staffMail, [H.unit]: "1001", [H.kind]: "دائمی", [H.from]: "", [H.to]: "" },
      { [H.position]: "رئیس شعبه", [H.email]: staffMail, [H.unit]: "1001", [H.kind]: "", [H.from]: "دیروز", [H.to]: "" },
      { [H.position]: "رئیس شعبه", [H.email]: staffMail, [H.unit]: "1002", [H.kind]: "", [H.from]: "", [H.to]: "" },
    ];
    const count = async () => Number((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_position_holders where org_id = $1 and deleted_at is null`, [e.org]))!.n);
    const before = await count();
    const dry = await e.owner.post(`${P}/positions/holders/import`, { rows, dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, total: 9, created: 1, updated: 0, unchanged: 0, removed: 0 });
    expect(dry.skipped).toEqual([
      { row: 2, message: "این دارنده دستی ثبت شده است؛ دست نخورد" },
      { row: 3, message: "این دارنده را فهرست کاربران (AD) نگه می‌دارد؛ دست نخورد" },
    ]);
    expect(dry.errors).toEqual([
      { row: 4, message: "نقش سازمانی «مدیر کل» پیدا نشد" },
      { row: 5, message: "«nobody@example.com» عضو این سازمان نیست (یا نامش یکتا نیست؛ ایمیل را بنویسید)" },
      { row: 6, message: "واحد «9999» پیدا نشد" },
      { row: 7, message: "نوع «دائمی» شناخته نیست (اصلی، سرپرست (کفیل) یا موقت)" },
      { row: 8, message: "تاریخ «دیروز» خوانده نشد" },
      { row: 9, message: "همین نقش، شخص و واحد پیش‌تر در فایل آمده است" },
    ]);
    expect(await count()).toBe(before);
    const done = await e.owner.post(`${P}/positions/holders/import`, { rows, dry_run: false });
    expect(done).toMatchObject({ dry_run: false, created: 1, updated: 0 });
    const made = await e.db.one<Record<string, unknown>>(`select kind, source, source_ref, valid_from::text as valid_from from sm_position_holders where org_id = $1 and user_id = $2 and org_unit_id = $3 and deleted_at is null`, [e.org, staff.userId, U.tajrish]);
    // «۱۴۰۵/۰۸/۰۱» is 23 October 2026
    expect(made).toEqual({ kind: "acting", source: "import", source_ref: null, valid_from: "2026-10-23" });
    // the same file again changes nothing; a changed kind updates the import's own holder only
    expect(await e.owner.post(`${P}/positions/holders/import`, { rows: rows.slice(0, 3), dry_run: false })).toMatchObject({ created: 0, updated: 0, unchanged: 1, skipped: [{ row: 2 }, { row: 3 }] });
    expect(await e.owner.post(`${P}/positions/holders/import`, { rows: [{ ...rows[0], [H.kind]: "موقت" }], dry_run: false })).toMatchObject({ updated: 1 });
    expect(await holderRow(String(manual.id))).toMatchObject({ source: "manual", kind: "primary" });
    expect(await holderRow(String(ad.id))).toMatchObject({ source: "directory", deleted_at: null });
    const audit = await e.db.query<{ action: string }>(`select action from sm_audit where org_id = $1 and action = 'position_import'`, [e.org]);
    expect(audit.length).toBe(3);
  });

  it("replaces from an import set's file: the set's own holders no longer in the file are removed, never a manual one", async () => {
    const set = (await e.owner.post(`${R}/import_set`, { name: "پست‌های شعب", target_table: "position_holder" })).row;
    const staffMail = await emailOf(staff.userId);
    const agentMail = await emailOf(agent.userId);
    const csv = (lines: string[]) => new TextEncoder().encode(["نقش سازمانی,ایمیل,کد شعبه,نوع", ...lines].join("\n"));
    const attach = async (lines: string[]) => {
      const res = await upload(e.app, e.owner, `${R}/import_set/${set.id}/attachments`, "holders.csv", csv(lines), "text/csv");
      expect(res.status).toBeLessThan(300);
      // the newest file wins
      await new Promise((r) => setTimeout(r, 15));
    };
    await attach([`branch_head,${staffMail},1001,اصلی`, `credit_officer,${agentMail},FIN,موقت`]);
    expect(await e.owner.post(`${P}/positions/holders/import`, { import_set_id: set.id, mode: "replace", dry_run: false })).toMatchObject({ created: 2, removed: 0, errors: [] });
    const ofSet = async () => (await e.db.query<{ user_id: string; org_unit_id: string | null }>(`select user_id, org_unit_id from sm_position_holders where org_id = $1 and source = 'import' and source_ref = $2 and deleted_at is null order by user_id`, [e.org, set.id])).length;
    expect(await ofSet()).toBe(2);
    await attach([`branch_head,${staffMail},1001,اصلی`]);
    expect(await e.owner.post(`${P}/positions/holders/import`, { import_set_id: set.id, mode: "replace", dry_run: false })).toMatchObject({ created: 0, unchanged: 1, removed: 1 });
    expect(await ofSet()).toBe(1);
    // the manual holder of the earlier test and the rows-import's holder are still there
    expect(Number((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_position_holders where org_id = $1 and deleted_at is null and source = 'manual' and user_id = $2`, [e.org, keeper.userId]))!.n)).toBe(1);
    expect(Number((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_position_holders where org_id = $1 and deleted_at is null and source = 'import' and source_ref is null`, [e.org]))!.n)).toBe(1);
    // replace needs an import set
    expect(((await e.owner.post(`${P}/positions/holders/import`, { rows: [], mode: "replace" }, 400)) as Err).error.message).toBe(
      "جایگزینی فقط با یک مجموعهٔ ورود ممکن است: دارندگانی که همان مجموعه وارد کرده بود و در فایل نیستند برداشته می‌شوند",
    );
  });
});

describe("the «نقش سازمانی» field type (design F §3.1)", () => {
  it("is offered once positions exist; a field of it names a position", async () => {
    const types = await e.owner.get(`${P}/fields/types`);
    expect(types.builtin.find((t: { key: string }) => t.key === "position")).toMatchObject({ available: true, storage: "ref", widget: "position" });
    const lib = (await e.owner.post(`${P}/fields/library`, { name: "u_approver_post", label: "سمت تأییدکننده", type: "position" }, 201)).row;
    await e.owner.post(`${P}/fields/attach`, { table: "todo", field: lib.id }, 201);
    const t = (await e.owner.post(`${R}/todo`, { short_description: "ارجاع به سمت", u_approver_post: POS.head })).row;
    expect(t.u_approver_post).toBe(POS.head);
    await e.owner.post(`${R}/todo`, { short_description: "واحد به جای سمت", u_approver_post: U.vanak }, 400);
  });
});
