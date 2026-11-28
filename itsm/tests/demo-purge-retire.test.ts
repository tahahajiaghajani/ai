// «حذف داده‌های نمایشی» never takes a real workflow out of use because its named managers were the pack's people (the
// review of 1.1.5). A published workflow whose step only the pack could take — a position only pack accounts held — waits
// at that step for its new cases (clean.ts `reviewStuck`): someone can always act on such a step after the purge. Its
// managers who are left manage it; when every manager it names went with the pack, its cases name none — new cases leave
// removed managers out (process/engine/apply.ts `liveManagers`), kept cases lose them (the reroute) — and the
// organisation's administrators manage them and are told, exactly as for a workflow that names no managers
// (process/api/common.ts `namedManager`, process/engine/waiting.ts `noticeRecipients`). So such a workflow stays
// published and is listed for review, whether its step waits («منتظر بماند») or goes to the managers («به مسئولان
// گردش‌کار برسد», which then has nobody to go to and waits); before, it was retired (a start answered «این گردش‌کار
// بازنشسته شده است…») while the identical workflow naming no managers stayed published.
// The pack is simulated as tests/demo-purge-waiting.test.ts does (a loaded pack row, the pack's people marked).
import { describe, it, expect, beforeAll } from "vitest";
import { createIn } from "@server/engine";
import { runToEnd } from "@server/modules/demo";
import { seedNoticesIn } from "@server/modules/process/api/notices";
import { namedManager } from "@server/modules/process/api/common";
import { edge, kase, node, person, publish, start, world, type Published, type World } from "./process-engine-helpers";

let w: World;
let requester: string;
let packManager: string;
let packHolder: string;
const flows: Record<string, Published> = {};

const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });
const values = { u_amount: "5" };
const SENIOR = { kind: "position", position: "senior_expert", where: "anywhere" };

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

/** One of the pack's people, as the loader adds them: an account marked with the organisation's pack, a member. */
async function packPerson(name: string): Promise<string> {
  const id = await person(w, name);
  await w.o.db.query(`update sm_users set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('demo_org', $2::text) where id = $1`, [id, w.o.org]);
  await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [w.o.org, id]);
  return id;
}

const status = async (p: Published) => (await w.o.db.one<{ status: string }>(`select status from sm_processes where id = $1`, [p.process]))!.status;
const reviews = async (p: Published) =>
  (await w.o.db.query<{ summary: string }>(`select summary from sm_audit where org_id = $1 and action = 'demo_purge_review' and entity = 'process' and entity_id = $2`, [w.o.org, p.process])).map((r) => r.summary);

beforeAll(async () => {
  w = await world();
  requester = await person(w, "درخواست‌دهندهٔ واقعی");
  await w.sys.write((tx) => seedNoticesIn(tx, w.sys));
  await w.o.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [w.o.org, w.o.ownerId],
  );
  packHolder = await packPerson("نگار کارشناس‌پور");
  packManager = await packPerson("مسئول نمایشی گردش‌کار");
  await w.sys.write(async (tx) => {
    const p = await createIn(tx, w.sys, "position", { key: "senior_expert", name: "کارشناس ارشد" }, { trusted: true });
    await createIn(tx, w.sys, "position_holder", { position_id: p.id, user_id: packHolder, kind: "primary" }, { trusted: true });
  });
  // the step only the pack could take; the workflow's named managers only the pack's (two «اگر کسی پیدا نشد»), or none
  flows.waitPack = await publish(w, graph({ assignees: [SENIOR] }), { name: "تأیید با مسئول نمایشی", managers: [packManager] });
  flows.managersPack = await publish(w, graph({ assignees: [SENIOR], ifNobody: "managers" }), { name: "ارجاع به مسئول نمایشی", managers: [packManager] });
  flows.waitNone = await publish(w, graph({ assignees: [SENIOR] }), { name: "تأیید بی مسئول", managers: [] });
  flows.managersNone = await publish(w, graph({ assignees: [SENIOR], ifNobody: "managers" }), { name: "ارجاع بی مسئول", managers: [] });

  await w.o.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.o.ownerId]);
  await w.o.owner.post(`/o/${w.o.org}/demo/purge`, { confirm: "حذف کامل" });
  await runToEnd(w.o.cfg, w.o.org, "purge", { budgetMs: 300_000 });
  expect(await w.o.db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [w.o.org])).toBeNull();
}, 600_000);

describe("a workflow whose named managers were all the pack's people stays in use after the purge", () => {
  it("stays published, like the same workflow naming no managers, and is listed for review — never retired", async () => {
    for (const k of ["waitPack", "managersPack", "waitNone", "managersNone"]) {
      expect(await status(flows[k]), k).toBe("published");
      const lines = await reviews(flows[k]);
      expect(lines.length, k).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes("بازنشسته")), k).toBe(false);
      expect(lines.some((l) => l.includes("تأیید کارشناس ارشد") && l.includes("منتظر می‌مانند")), k).toBe(true);
      // the review says who acts now: the organisation's administrators, none of its managers being left
      expect(lines.some((l) => l.includes("مدیران سازمان")), k).toBe(true);
    }
  });

  it("its new case starts and waits at the step, and the administrators manage it", async () => {
    const owner = await w.o.ctxOf(w.o.ownerId);
    for (const k of ["waitPack", "managersPack"]) {
      const r = await start(w, requester, flows[k], { values });
      expect(r.case, k).toBeTruthy();
      await w.k.drain();
      const c = await kase(w, r.case!);
      expect(c.state, k).toBe("waiting");
      // the removed manager is left out of the case: it names none, so the administrators manage it
      expect((c as unknown as { managers: string[] | null }).managers ?? [], k).toEqual([]);
      expect(await namedManager(w.o.db, owner, c as never), k).toBe(true);
    }
  });
});
