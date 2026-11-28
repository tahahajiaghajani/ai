// The purge's preview names only what its viewer may read (Kariz 1.1.5 review, engine-access-1). The preview of
// «حذف داده‌های نمایشی» (GET /demo/report) gives a few samples per bucket in words a person reads — but it read those
// words as the system, so an organisation's owner (settings full) who is neither the requester, a participant nor a
// manager of a confidential case found its title and the values its title shows («PRC0000001 — وام محرمانه ۹۸۷٬۶۵۴
// ریال») there, although the case page and the record API answer them 404. Now every sample is a reference
// ({table, id, number}) and its words are read when the report is shown, through the engine's read predicate of the
// viewer: a row they may read reads as before, one they may not as its number alone (none without a number). The
// purge job's stored report — what the same route serves while the purge runs and its tombstones remain — keeps the
// references, never the words. The pack is simulated as tests/demo-purge-waiting.test.ts does.
import { describe, it, expect, beforeAll } from "vitest";
import { createIn } from "@server/engine";
import { purgeStep } from "@server/modules/demo";
import { seedNoticesIn } from "@server/modules/process/api/notices";
import { edge, kase, node, person, publish, start, world, type World } from "./process-engine-helpers";

let w: World;
let requester: string;
let other: string;
let manager: string;
let packHolder: string;
let packFor: string;

const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });

async function packPerson(name: string): Promise<string> {
  const id = await person(w, name);
  await w.o.db.query(`update sm_users set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('demo_org', $2::text) where id = $1`, [id, w.o.org]);
  await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [w.o.org, id]);
  return id;
}

/** start → «بررسی کارشناس وام» (a position only the pack's person holds) → end. */
const graph = () => ({
  nodes: [
    node("t", "trigger"),
    node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }),
    node("loan", "form_step", { action: "approve", form: w.forms.review, rights: rights({}), assignees: [{ kind: "position", position: "loan_expert", where: "anywhere" }] }, "بررسی کارشناس وام"),
    node("ok", "end", { outcome: "completed" }),
    node("no", "end", { outcome: "rejected" }),
  ],
  edges: [edge("t", "s"), edge("s", "loan"), edge("loan", "ok", "approved"), edge("loan", "no", "rejected")],
});

const SECRET = /وام محرمانه|۹۸۷|۱۲۳٬۴۵۶|987654|123456/;

beforeAll(async () => {
  w = await world();
  requester = await person(w, "کارمند متقاضی");
  other = await person(w, "کارمند دیگر");
  manager = await person(w, "مدیر منابع انسانی");
  await w.sys.write((tx) => seedNoticesIn(tx, w.sys));
  await w.o.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [w.o.org, w.o.ownerId],
  );
  packHolder = await packPerson("نگار کارشناس‌پور");
  packFor = await packPerson("بهرام نمایشی");
  await w.sys.write(async (tx) => {
    const p = await createIn(tx, w.sys, "position", { key: "loan_expert", name: "کارشناس وام" }, { trusted: true });
    await createIn(tx, w.sys, "position_holder", { position_id: p.id, user_id: packHolder, kind: "primary" }, { trusted: true });
  });
}, 300_000);

describe("the purge's preview and an owner who may not read a confidential case", () => {
  it("names the case by its number only — live and in the stored report — while what the owner reads keeps its words", async () => {
    const org = w.o.org;
    const P = await publish(w, graph(), { managers: [manager], confidential: true, title: "وام محرمانه {{case.u_amount}}" });
    // a real employee's case waits for the pack's person (it is routed again by the purge) …
    const a = (await start(w, requester, P, { values: { u_amount: "987654" } })).case!;
    // … and one filed for one of the pack's people goes with the pack
    const b = (await start(w, other, P, { values: { u_amount: "123456" }, requested_for: packFor })).case!;
    await w.k.drain();
    const A = await kase(w, a);
    const B = await kase(w, b);
    expect(A).toMatchObject({ state: "waiting" });
    expect(A.title).toMatch(SECRET);
    // the owner may not read either case (the confidential row rule)
    await w.o.owner.get(`/o/${org}/process/cases/${a}`, 404);
    await w.o.owner.get(`/o/${org}/r/process_case/${b}`, 404);

    const report = await w.o.owner.get(`/o/${org}/demo/report`);
    const byTable = (xs: { table: string; samples: string[] }[]) => new Map(xs.map((x) => [x.table, x.samples]));
    expect(JSON.stringify(report)).not.toMatch(SECRET);
    expect(byTable(report.rerouted).get("process_case")).toEqual([A.number]);
    expect(byTable(report.deleted).get("process_case")).toEqual([B.number]);
    // what the owner may read still reads in words
    expect(byTable(report.deleted).get("position_holder")).toEqual(["نگار کارشناس‌پور در «کارشناس وام»"]);

    // the purge's own plan, stored as the system: references only; served to the owner under their access
    await w.o.db.query(`update sm_demo_packs set state = 'purging', purge_started_at = now(), progress = progress || '{"purge":"expand"}'::jsonb where org_id = $1`, [org]);
    await purgeStep(w.o.cfg, org);
    const stored = await w.o.db.one<{ progress: { purge: string; report: unknown } }>(`select progress from sm_demo_packs where org_id = $1`, [org]);
    expect(stored!.progress.purge).toBe("clear");
    expect(JSON.stringify(stored!.progress.report)).not.toMatch(SECRET);
    expect(JSON.stringify(stored!.progress.report)).not.toContain("نگار کارشناس‌پور");
    const during = await w.o.owner.get(`/o/${org}/demo/report`);
    expect(JSON.stringify(during)).not.toMatch(SECRET);
    expect(byTable(during.rerouted).get("process_case") ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(SECRET)]));
    expect(byTable(during.deleted).get("process_case")).toEqual([B.number]);
    expect(byTable(during.deleted).get("position_holder")).toEqual(["نگار کارشناس‌پور در «کارشناس وام»"]);
  }, 300_000);
});
