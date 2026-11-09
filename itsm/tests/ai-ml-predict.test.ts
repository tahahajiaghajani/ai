// Predictive AI on a real organisation (docs/spec/AI.md §13): classifiers trained by jobs on the organisation's own
// incidents (deterministic for a seed, never on confidential records), predictions shown only to readers of their
// record and only through what they see, draft suggestions, «گروه با پیش‌بینی هوش مصنوعی» in assignment rules,
// clusters with late binding, forecasts counted with the viewer's access, and the registry for AI administrators only.
import { beforeAll, describe, expect, it } from "vitest";
import { createIn } from "@server/engine";
import { modelRow, runModel } from "@server/modules/ai/ml";
import { mulberry32 } from "@server/modules/ai/ml/core/rng";
import { world, type World } from "./incident-helpers";

const TEXTS: Record<string, string[]> = {
  network: ["اینترنت قطع است", "وای‌فای طبقه دوم وصل نمی‌شود", "شبکه خیلی کند است", "وی‌پی‌ان وصل نمی‌شود", "سوییچ شبکه خاموش شد"],
  email: ["ایمیل ارسال نمی‌شود", "صندوق ایمیل پر شده است", "اوت‌لوک باز نمی‌شود", "ایمیل‌ها به دستم نمی‌رسد"],
  hardware: ["لپ‌تاپ روشن نمی‌شود", "چاپگر کاغذ گیر کرده", "صفحه نمایش سیاه است", "کیبورد کار نمی‌کند"],
  access: ["گذرواژه را فراموش کرده‌ام", "حساب کاربری قفل شده است", "دسترسی به پوشه مالی ندارم", "ورود دومرحله‌ای کار نمی‌کند"],
};
const NOISE = ["لطفا", "فوری", "بررسی", "امروز", "صبح", "همکار", "دوباره", "واحد"];

let w: World;
const ids: Record<string, string[]> = {};
let canaryId = "";

beforeAll(async () => {
  w = await world({ preset: "need_to_know" });
  const r = mulberry32(3);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  await w.sys.write(async (tx) => {
    for (const [category, texts] of Object.entries(TEXTS)) {
      ids[category] = [];
      for (let i = 0; i < 22; i++) {
        const row = await createIn(
          tx,
          w.sys,
          "incident",
          { short_description: `${pick(texts)} ${pick(NOISE)}`, description: `${pick(NOISE)} ${pick(texts)}`, category, assignment_group_id: category === "network" ? w.g.network : w.g.desk },
          { trusted: true },
        );
        ids[category].push(String(row.id));
      }
    }
    // a confidential record: its words must never become a model's vocabulary
    const c = await createIn(tx, w.sys, "incident", { short_description: "زرافه‌قناری نشت داده محرمانه", description: "زرافه‌قناری", category: "access", security_incident: true, assignment_group_id: w.g.security }, { trusted: true });
    canaryId = String(c.id);
    for (let i = 0; i < 6; i++) await createIn(tx, w.sys, "incident", { short_description: `زرافه‌قناری ${i}`, category: "access", security_incident: true, assignment_group_id: w.g.security }, { trusted: true });
  });
  await w.drain();
}, 240_000);

const params = async (key: string) => (await w.e.db.one<{ params: any; version: number; metrics: any }>(`select params, version, metrics from sm_ai_models where org_id = $1 and key = $2`, [w.e.org, key]))!;

describe("training", () => {
  it("registers models from the metadata and trains a classifier that beats its baseline, deterministically", async () => {
    await w.o.get(`${w.P}/ai/ml/models`);
    await w.drain();
    const key = "classify:incident:category";
    expect(await modelRow(w.e.db, w.e.org, key)).toBeTruthy();
    await runModel(w.e.cfg, w.e.org, key, { force: true });
    const m = await modelRow(w.e.db, w.e.org, key);
    expect(m!.status).toBe("ready");
    expect(m!.beats_baseline).toBe(true);
    expect(Number((m!.metrics as any).accuracy)).toBeGreaterThan(0.8);
    expect((m!.metrics as any).per_class.length).toBe(4);
    const first = await params(key);
    const runs = (await modelRow(w.e.db, w.e.org, key))!.history.length;
    await runModel(w.e.cfg, w.e.org, key, { force: true });
    const second = await params(key);
    expect(second.version).toBe(first.version + 1);
    expect(second.params).toEqual(first.params);
    expect(second.metrics).toEqual(first.metrics);
    expect((await modelRow(w.e.db, w.e.org, key))!.history.length).toBe(runs + 1);
  });

  it("never learns from confidential records", async () => {
    const p = await params("classify:incident:category");
    expect(p.params.vocab.terms.some((t: string) => t.includes("زرافه"))).toBe(false);
  });

  it("skips a scheduled run when nothing changed", async () => {
    const key = "classify:incident:category";
    const before = (await modelRow(w.e.db, w.e.org, key))!.version;
    await runModel(w.e.cfg, w.e.org, key);
    expect((await modelRow(w.e.db, w.e.org, key))!.version).toBe(before);
  });
});

describe("predictions follow the record's access", () => {
  it("shows a reader the suggestion computed from what they see, with its reasons", async () => {
    const id = ids.network[0];
    // the network agent reads network incidents; a desk agent does not (need to know)
    const mine = await w.p.other.client.get(`${w.P}/ai/ml/records/incident/${id}`);
    const cat = mine.predictions.find((p: any) => p.field === "category");
    expect(cat.value).toBe("network");
    expect(cat.value_label).toBe("شبکه و اینترنت");
    expect(cat.why.length).toBeGreaterThan(0);
    expect(cat.score).toBeGreaterThan(0.5);
    await w.p.agent.client.get(`${w.P}/ai/ml/records/incident/${id}`, 404);
    await w.p.agent.client.get(`${w.P}/ai/ml/records/incident/${canaryId}`, 404);
  });

  it("suggests for a draft from the person's own text", async () => {
    const r = await w.p.agent.client.post(`${w.P}/ai/ml/predict`, { table: "incident", values: { short_description: "ایمیل من ارسال نمی‌شود و صندوق پر است" } });
    const cat = r.predictions.find((p: any) => p.field === "category");
    expect(cat.value).toBe("email");
    expect(cat.id).toBeNull();
  });

  it("applies a suggestion with the reader's own access", async () => {
    await w.sys.write((tx) => createIn(tx, w.sys, "incident", { short_description: "اینترنت ساختمان قطع است فوری", assignment_group_id: w.g.network }, { trusted: true }));
    await w.drain();
    const row = (await w.e.db.one<{ id: string }>(`select id from sm_incidents where org_id = $1 and short_description = $2`, [w.e.org, "اینترنت ساختمان قطع است فوری"]))!;
    const view = await w.p.other.client.get(`${w.P}/ai/ml/records/incident/${row.id}`);
    const cat = view.predictions.find((p: any) => p.field === "category");
    expect(cat.id).toBeTruthy();
    expect(cat.can_apply).toBe(true);
    await w.p.agent.client.post(`${w.P}/ai/ml/predictions/${cat.id}/apply`, {}, 404);
    await w.p.other.client.post(`${w.P}/ai/ml/predictions/${cat.id}/apply`, {});
    const after = await w.o.get(`${w.P}/r/incident/${row.id}`);
    expect(after.row.category).toBe("network");
  });

  it("keeps the registry for AI administrators", async () => {
    await w.p.agent.client.get(`${w.P}/ai/ml/models`, 403);
    const list = await w.o.get(`${w.P}/ai/ml/models`);
    expect(list.models.some((m: any) => m.key === "classify:incident:category" && m.status === "ready")).toBe(true);
  });
});

describe("assignment rules with the group classifier", () => {
  it("routes an unassigned record to the predicted group above the auto-apply threshold", async () => {
    const key = "classify:incident:assignment_group_id";
    await runModel(w.e.cfg, w.e.org, key, { force: true });
    expect((await modelRow(w.e.db, w.e.org, key))!.status).toBe("ready");
    await w.o.patch(`${w.P}/ai/ml/models/${encodeURIComponent(key)}`, { threshold_apply: 0.5 });
    await w.o.post(`${w.P}/r/assignment_rule`, { name: "مسیریابی هوشمند", table_key: "incident", ai_group: true, sort_order: 1 });
    const inc = await w.incident({ short_description: "وی‌پی‌ان و اینترنت شبکه قطع است" });
    expect(inc.assignment_group_id).toBe(w.g.network);
    const p = await w.e.db.one<{ status: string; value: string }>(`select status, value from sm_ai_predictions where org_id = $1 and model_key = $2 and record_id = $3`, [w.e.org, key, inc.id]);
    expect(p).toEqual({ status: "auto_applied", value: w.g.network });
  });

  it("never applies below the threshold", async () => {
    const key = "classify:incident:assignment_group_id";
    await w.o.patch(`${w.P}/ai/ml/models/${encodeURIComponent(key)}`, { threshold_apply: 0.999 });
    const inc = await w.incident({ short_description: "مشکلی پیش آمده" });
    expect(inc.assignment_group_id ?? null).not.toBe(w.g.network);
  });
});

describe("clusters and forecasts", () => {
  it("shows each viewer only the clusters of records they read", async () => {
    await w.sys.write(async (tx) => {
      for (let i = 0; i < 5; i++) {
        await createIn(tx, w.sys, "incident", { short_description: `خطای اتصال وی‌پی‌ان شرکت از خانه ${["امروز", "صبح", "دوباره", "باز", "هم"][i]}`, assignment_group_id: w.g.network }, { trusted: true });
        await createIn(tx, w.sys, "incident", { short_description: `حقوق ماه گذشته واریز نشده ${["امروز", "صبح", "دوباره", "باز", "هم"][i]}`, assignment_group_id: w.g.desk }, { trusted: true });
      }
    });
    await w.drain();
    await runModel(w.e.cfg, w.e.org, "cluster:incident", { force: true });
    const other = (await w.p.other.client.get(`${w.P}/ai/ml/clusters?table=incident`)).clusters;
    const agent = (await w.p.agent.client.get(`${w.P}/ai/ml/clusters?table=incident`)).clusters;
    const titles = (cs: any[]) => cs.flatMap((c) => c.members.map((m: any) => m.title)).join(" ");
    expect(titles(other)).toMatch(/وی‌پی‌ان/);
    expect(titles(other)).not.toMatch(/حقوق/);
    expect(titles(agent)).not.toMatch(/وی‌پی‌ان شرکت از خانه/);
  });

  it("counts a forecast's history with the viewer's access", async () => {
    // spread the incidents over the last two months (a forecast reads full days before today)
    await w.e.db.query(`update sm_incidents set created_at = now() - ((abs(hashtext(id::text)) % 60) + 1 || ' days')::interval where org_id = $1`, [w.e.org]);
    const all = await w.o.get(`${w.P}/ai/ml/forecast?table=incident`);
    const desk = await w.p.agent.client.get(`${w.P}/ai/ml/forecast?table=incident`);
    const sum = (f: any) => f.history.reduce((a: number, h: any) => a + h.count, 0);
    expect(sum(all)).toBeGreaterThan(sum(desk));
    expect(sum(desk)).toBeGreaterThan(0);
  });
});
