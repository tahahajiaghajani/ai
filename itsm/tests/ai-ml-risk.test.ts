// The SLA breach model end to end (docs/spec/AI.md §13.3): examples from the finished SLAs of a table, a logistic
// regression that must beat the base rate, the open records scored with their drivers — and a score shown only to
// people who read the record.
import { beforeAll, describe, expect, it } from "vitest";
import { createIn } from "@server/engine";
import { runModel } from "@server/modules/ai/ml/jobs";
import { modelRow } from "@server/modules/ai/ml/store";
import { world, type World } from "./incident-helpers";

const KEY = "risk:sla:incident";
let w: World;
let urgent = "";
let calm = "";

beforeAll(async () => {
  w = await world({ preset: "need_to_know" });
  // 96 finished incidents: most of the network group's urgent ones breached their SLAs, the desk's routine ones met them
  const done: { id: string; late: boolean }[] = [];
  await w.sys.write(async (tx) => {
    for (let i = 0; i < 96; i++) {
      const net = i % 2 === 0;
      const row = await createIn(tx, w.sys, "incident", { short_description: `کندی سامانه ${i}`, priority: net ? "1" : "4", assignment_group_id: net ? w.g.network : w.g.desk }, { trusted: true });
      done.push({ id: String(row.id), late: net ? i % 10 !== 0 : i % 13 === 1 });
    }
  });
  await w.drain();
  for (const x of done) {
    await w.e.db.query(
      `update sm_task_slas set start_at = now() - interval '3 days', planned_end_at = now() - interval '3 days' + interval '4 hours',
         stop_at = now() - interval '3 days' + ${x.late ? "interval '6 hours'" : "interval '3 hours 50 minutes'"},
         stage = $2, breached = $3, active = false
       where org_id = $1 and record_id = $4`,
      [w.e.org, x.late ? "breached" : "achieved", x.late, x.id],
    );
  }
  // two open ones of the same kinds, with their timers running
  urgent = String((await w.incident({ short_description: "قطعی سوییچ هسته", priority: "1", assignment_group_id: w.g.network })).id);
  calm = String((await w.incident({ short_description: "درخواست راهنمایی چاپگر", priority: "4", assignment_group_id: w.g.desk })).id);
  await w.o.get(`${w.P}/ai/ml/models`); // queues the organisation's ML tick, which keeps the registry
  await w.drain();
}, 240_000);

describe("the SLA breach model", () => {
  it("learns from finished SLAs, beats the base rate and scores the open records", async () => {
    const out = (await runModel(w.e.cfg, w.e.org, KEY, { force: true })) as { status: string } | null;
    expect(out?.status).toBe("ready");
    const m = (await modelRow(w.e.db, w.e.org, KEY))!;
    expect(m.beats_baseline).toBe(true);
    expect(Number((m.metrics as { auc: number }).auc)).toBeGreaterThan(0.7);
    const scores = await w.e.db.query<{ record_id: string; score: number }>(`select record_id, score::float8 as score from sm_ai_predictions where org_id = $1 and model_key = $2`, [w.e.org, KEY]);
    const of = (id: string) => scores.find((s) => s.record_id === id)?.score ?? null;
    expect(of(urgent)).not.toBeNull();
    expect(of(calm)).not.toBeNull();
    expect(of(urgent)!).toBeGreaterThan(of(calm)!);
  });

  it("shows the risk with its drivers to readers of the record only", async () => {
    const view = await w.o.get(`${w.P}/ai/ml/records/incident/${urgent}`);
    const risk = view.predictions.find((p: { model: string }) => p.model === KEY);
    expect(risk).toMatchObject({ kind: "risk" });
    expect(risk.why.length).toBeGreaterThan(0);
    // a requester who did not report it reads nothing of it
    await w.p.req.client.get(`${w.P}/ai/ml/records/incident/${urgent}`, 404);
  });
});
