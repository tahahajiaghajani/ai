// A demo person's pushed submission on the authority (docs/DEMO_FA.md «برنامهٔ ویندوزِ پیوسته»): her Windows app's push
// is demo work, so the submission is a row of the pack; it is applied as demo work wherever it is applied. Its event
// applies it inside the demo scope (a job about a demo row); the organisation's own `process.timer`, which looks again
// at pending submissions whose event failed or was missed, runs outside it. Older builds applied it there as the
// organisation's own work: the case it started was not the pack's (the purge left it behind), and its steps dropped the
// pack's people as on a real case («کسی پیدا نشد»).
import { describe, it, expect, beforeAll } from "vitest";
import { createIn } from "@server/engine";
import { inDemoScope, isDemoRow } from "@server/db/scope";
import { applyPending } from "@server/modules/process/sync";
import { timerPass } from "@server/modules/process/timers";
import type { ServerConfig } from "@server/context";
import { uuidv7 } from "@shared/id";
import { edge, node, person, publish, tasks, users, world, type World } from "./process-engine-helpers";

let w: World;

/** One of the pack's people, as the loader adds them: an account marked with the organisation's pack. */
async function packPerson(name: string): Promise<string> {
  const id = await person(w, name);
  await w.o.db.query(`update sm_users set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('demo_org', $2::text) where id = $1`, [id, w.o.org]);
  await w.o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [w.o.org, id]);
  return id;
}

beforeAll(async () => {
  w = await world();
}, 300_000);

describe("a demo person's pushed start applied by the organisation's timer", () => {
  it("is demo work: the case is the pack's and its step reaches the pack's people", async () => {
    const org = w.o.org;
    const analyst = await packPerson("تحلیل‌گر نمایشی");
    const requester = await packPerson("درخواست‌دهندهٔ نمایشی");
    const proc = await publish(w, {
      nodes: [
        node("t", "trigger"),
        node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }),
        node("sec", "form_step", { action: "approve", form: w.forms.review, rights: { default: "read", fields: {} }, ...users(analyst) }, "تأیید تحلیل‌گر"),
        node("ok", "end", { outcome: "completed" }),
        node("no", "end", { outcome: "rejected" }),
      ],
      edges: [edge("t", "s"), edge("s", "sec"), edge("sec", "ok", "approved"), edge("sec", "no", "rejected")],
    });
    // her Windows app pushed the start: written as her sync writes it, inside the demo scope
    const caseId = uuidv7();
    const sub = await inDemoScope(org, () =>
      w.sys.write((tx) =>
        createIn(tx, w.sys, "process_submission", { kind: "start", process_id: proc.process, case_id: caseId, values: { u_amount: "5" }, submitted_by: requester, submitted_at: new Date().toISOString() }, { trusted: true }),
      ),
    );
    const subId = String(sub.id);
    expect(await isDemoRow(w.o.db, org, subId)).toBe(true);
    // its event never ran (it failed for good, or was missed): the organisation's timer finds it pending
    await w.o.db.query(`delete from sm_jobs where org_id = $1 and kind = 'record.created' and payload ->> 'id' = $2`, [org, subId]);
    const cfg = w.sys.cfg as ServerConfig;
    // as the timer's job runs: outside any demo scope (jobs/index.ts)
    await inDemoScope(null, () => timerPass(cfg, org, (id) => applyPending(cfg, org, id, null)));
    expect(await w.o.db.one(`select result from sm_process_submissions where id = $1`, [subId])).toEqual({ result: "applied" });
    await inDemoScope(null, () => w.k.drain());
    // the pack's case: recorded with the pack's rows (the purge takes it), its approval with the pack's analyst
    expect(await isDemoRow(w.o.db, org, caseId)).toBe(true);
    expect((await tasks(w, caseId)).filter((t) => t.step_key === "sec" && t.status === "open").map((t) => t.assigned_to)).toEqual([analyst]);
  }, 300_000);
});
