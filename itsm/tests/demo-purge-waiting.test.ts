// A real workflow case that already waited for the demo pack's people when the pack is purged (the owner's click-through
// of 1.1.5, case C: its step on «کارشناس ارشد», a position only pack accounts held, kept the reason it opened with —
// «۲ نفر از دارندگان «کارشناس ارشد» حساب نمایشی‌اند …؛ برای آزمودن، پرونده را با یک حساب نمایشی آغاز کنید» — long after
// those accounts were gone). The purge (src/server/modules/demo/clean.ts `waitingStep`) looks again, as the system and
// outside the demo scope, for every waiting round of a kept case whose reasons name the pack's people or whose rules
// reach removed rows: whoever is found gets the step, journaled; otherwise the round keeps the reasons as they are now,
// and its opening's line unless that line names the pack's people (a pack manager the managers' notice could not reach,
// «… حساب نمایشی است؛ اعلان به او نرسید»). The pack is simulated as tests/process-demo-boundary.test.ts does (a loaded
// pack row, the pack's people marked); no write of the purge here raises an event that would queue the organisation's
// own re-resolution (asserted), so what changes is the purge's doing. The same story on the small bank:
// tests/demo-purge-built-on.test.ts (case C6).
import { describe, it, expect, beforeAll } from "vitest";
import { createIn } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { runToEnd } from "@server/modules/demo";
import { seedNoticesIn } from "@server/modules/process/api/notices";
import { edge, journal, kase, node, person, publish, start, tasks, world, type World } from "./process-engine-helpers";

let w: World;
let requester: string;
let manager: string;
let later: string;
let away: string;
let packHolder: string;
let packGroup: string;

const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });
const values = { u_amount: "5" };

/** One of the pack's people, as the loader adds them: an account marked with the organisation's pack, a member. */
async function packPerson(name: string): Promise<string> {
  const id = await person(w, name);
  await w.o.db.query(`update sm_users set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('demo_org', $2::text) where id = $1`, [id, w.o.org]);
  await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [w.o.org, id]);
  return id;
}

/** start → «تأیید کارشناس ارشد» (the rules given) → end. */
const graph = (step: Record<string, unknown>) => ({
  nodes: [
    node("t", "trigger"),
    node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }),
    node("sec", "form_step", { action: "approve", form: w.forms.review, rights: rights({}), ...step }, "تأیید کارشناس ارشد"),
    node("ok", "end", { outcome: "completed" }),
    node("no", "end", { outcome: "rejected" }),
  ],
  edges: [edge("t", "s"), edge("s", "sec"), edge("sec", "ok", "approved"), edge("sec", "no", "rejected")],
});
const SENIOR = { kind: "position", position: "senior_expert", where: "anywhere" };
const REAL = { kind: "position", position: "real_expert", where: "anywhere" };

/** What the waiting round of «تأیید کارشناس ارشد» keeps (its reason, the journal's line and the resolver's reasons). */
async function waiting(caseId: string): Promise<{ reason: string; message: string; notes: string[] } | null> {
  const r = await w.o.db.one<{ data: { reason: string; message: string; notes: string[] } }>(
    `select data from sm_flow_waits where org_id = $1 and key like $2 and result is null order by key desc limit 1`,
    [w.o.org, `pstep:${caseId}:sec:%`],
  );
  return r?.data ?? null;
}
const openAt = async (caseId: string) => (await tasks(w, caseId)).filter((t) => t.step_key === "sec" && t.status === "open");

beforeAll(async () => {
  w = await world();
  requester = await person(w, "درخواست‌دهندهٔ واقعی");
  manager = await person(w, "مسئول گردش‌کار");
  later = await person(w, "کارشناس ارشد واقعی");
  away = await person(w, "کارشناس واقعی در مرخصی");
  // the workflow notices as an organisation has them: a step without people tells its managers, its line says whom
  await w.sys.write((tx) => seedNoticesIn(tx, w.sys));
  // the pack is loaded (as the loader leaves it, without the bank), and its person holds a real position the owner made
  await w.o.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [w.o.org, w.o.ownerId],
  );
  packHolder = await packPerson("نگار کارشناس‌پور");
  await w.sys.write(async (tx) => {
    const p = await createIn(tx, w.sys, "position", { key: "senior_expert", name: "کارشناس ارشد" }, { trusted: true });
    await createIn(tx, w.sys, "position_holder", { position_id: p.id, user_id: packHolder, kind: "primary" }, { trusted: true });
    // a real position whose only holder is a real member, away (not an active member) until after the purge
    const r = await createIn(tx, w.sys, "position", { key: "real_expert", name: "کارشناس واقعی" }, { trusted: true });
    await createIn(tx, w.sys, "position_holder", { position_id: r.id, user_id: away, kind: "primary" }, { trusted: true });
  });
  // a group of the pack's, switched off
  packGroup = String((await inDemoScope(w.o.org, () => w.sys.write((tx) => createIn(tx, w.sys, "group", { name: "میز خدمت (نمایشی)", active: false }, { trusted: true })))).id);
}, 300_000);

describe("the purge and a real case that already waited for the pack's people", () => {
  it("each waiting round says why now; whoever is found gets the step, journaled", async () => {
    const org = w.o.org;
    const db = w.o.db;
    // A: only the pack's person holds the position (the owner's case C)
    const A = await publish(w, graph({ assignees: [SENIOR] }), { managers: [manager] });
    // B: a group of the pack's, switched off — the reason names no account, the rule names a removed row
    const B = await publish(w, graph({ assignees: [{ kind: "group", group: packGroup }] }), { managers: [manager] });
    // F: the same position, then a real member who is away when the case opens and back before the purge
    const F = await publish(w, graph({ assignees: [SENIOR], fallback: [{ kind: "users", users: [later] }] }), { managers: [manager] });
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, later]);
    // D: a real position whose holder is away, and a real manager group the owner added one of the pack's people to —
    // its reasons name no account; its line names the pack's person the managers' notice could not reach
    const desk = String((await w.sys.write((tx) => createIn(tx, w.sys, "group", { name: "میز تأیید واقعی" }, { trusted: true }))).id);
    await w.sys.write((tx) => createIn(tx, w.sys, "group_member", { group_id: desk, user_id: packHolder }, { trusted: true }));
    const D = await publish(w, graph({ assignees: [REAL] }), { managers: [manager], manager_groups: [desk] });
    await db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [org, away]);
    const a = (await start(w, requester, A, { values })).case!;
    const b = (await start(w, requester, B, { values })).case!;
    const f = (await start(w, requester, F, { values })).case!;
    const d = (await start(w, requester, D, { values })).case!;
    await w.k.drain();
    for (const id of [a, b, f, d]) {
      expect(await openAt(id)).toEqual([]);
      expect(await kase(w, id)).toMatchObject({ state: "waiting" });
    }
    expect((await waiting(a))?.notes.join(" ")).toContain("حساب نمایشی");
    expect((await waiting(f))?.notes.join(" ")).toContain("حساب نمایشی");
    expect((await waiting(b))?.notes).toContain("گروه «میز خدمت (نمایشی)» غیرفعال است");
    expect((await waiting(b))?.notes.join(" ")).not.toContain("حساب نمایشی");
    expect((await waiting(d))?.notes.join(" ")).not.toContain("حساب نمایشی");
    expect((await waiting(d))?.message).toContain("نگار کارشناس‌پور حساب نمایشی است؛ اعلان به او نرسید");
    // back at work, straight in the database: nothing queues a re-resolution
    await db.query(`update sm_org_members set is_active = true where org_id = $1 and user_id = $2`, [org, later]);
    const lines = { a: (await journal(w, a)).length, b: (await journal(w, b)).length, d: (await journal(w, d)).length };

    // ----- the purge
    const preview = await w.o.owner.get(`/o/${org}/demo/report`);
    await db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.o.ownerId]);
    await w.o.owner.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await runToEnd(w.o.cfg, org, "purge", { budgetMs: 300_000 });
    expect(await db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    // what changed is the purge's doing: the organisation's own re-resolution was never queued
    expect(await db.one(`select 1 as x from sm_jobs where org_id = $1 and kind = 'process.reresolve' limit 1`, [org])).toBeNull();

    // A: the position has no holder at all now, and its reasons say so (never «… حساب نمایشی‌اند … با یک حساب نمایشی آغاز کنید»)
    const wa = (await waiting(a))!;
    expect(wa.reason).toBe("nobody");
    expect(wa.notes).toContain("کسی «کارشناس ارشد» نیست");
    expect(wa.notes.join(" ")).not.toContain("حساب نمایشی");
    expect(wa.message).toContain("کسی پیدا نشد");
    expect(await kase(w, a)).toMatchObject({ state: "waiting" });
    // B: the group went with the pack
    expect((await waiting(b))?.notes).toContain("گروهی که قاعده نام برده پیدا نشد");
    expect((await waiting(b))?.notes.join(" ")).not.toContain("غیرفعال");
    // nobody found: the reasons are refreshed quietly, as the organisation's re-resolution does
    expect((await journal(w, a)).length).toBe(lines.a);
    expect((await journal(w, b)).length).toBe(lines.b);
    // F: the real member found now has the step, and the journal says why
    expect((await openAt(f)).map((t) => t.assigned_to)).toEqual([later]);
    expect(await kase(w, f)).toMatchObject({ state: "active" });
    expect((await journal(w, f)).some((l) => l.includes("دوباره جسته شد") && l.includes("سپرده شد"))).toBe(true);
    // D: nobody still (its holder is away); the line of its opening named the pack's person, who is gone — it says what
    // is true now and claims no notice, which nobody sent (no journal line)
    const wd = (await waiting(d))!;
    expect(wd.reason).toBe("nobody");
    expect(wd.message).toContain("کسی پیدا نشد");
    expect(wd.message).not.toContain("حساب نمایشی");
    expect(wd.message).not.toContain("باخبر شدند");
    expect((await journal(w, d)).length).toBe(lines.d);
    expect(await kase(w, d)).toMatchObject({ state: "waiting" });
    // the case pages show the reasons and lines as they are now
    for (const id of [a, d]) {
      const page = await w.o.owner.get(`/o/${org}/process/cases/${id}`);
      expect(JSON.stringify(page.waiting ?? {})).not.toContain("حساب نمایشی");
    }
    // and the preview said so beforehand: the four cases are among the records routed again
    expect((preview.rerouted as { table: string; rows: number }[]).find((r) => r.table === "process_case")?.rows).toBe(4);
  }, 600_000);
});
