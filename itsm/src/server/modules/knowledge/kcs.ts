// KCS (KB-022, KB-024, KB-025): licences decide who publishes just in time (publishers, coaches and domain experts
// publish without approval in a KCS base; candidates always go through a coach), and the publishing models of a base
// move internal articles outward as they prove themselves: «پس از چند استفاده» publishes them for requesters once
// they were reused enough, «نوار نقاله» opens a knowledge task that publishes them after a few days unless someone
// closes it first. Run by the sweep (jobs.ts) as the system.
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addJournalIn, createIn, defFor, updateIn } from "../../engine";
import { addDaysISO, liveRows, rowsById, sysOf, todayIn, type Row } from "./common";

export type LicenceLevel = "candidate" | "contributor" | "publisher" | "coach" | "kde";
const ORDER: LicenceLevel[] = ["candidate", "contributor", "publisher", "coach", "kde"];

/** The highest valid licence of a member in a base (or a licence for every base), or null. */
export async function licenceLevel(q: Queryable, ctx: Ctx, userId: string, baseId: string | null): Promise<LicenceLevel | null> {
  const today = todayIn(ctx);
  const rows = await liveRows(q, sysOf(ctx), "kb_licence", { and: [{ f: "user_id", op: "eq", v: userId }, { f: "state", op: "eq", v: "active" }] }, { limit: 50 });
  let best = -1;
  for (const r of rows) {
    if (r.base_id && r.base_id !== baseId) continue;
    if (r.expires_at && String(r.expires_at) < today) continue;
    best = Math.max(best, ORDER.indexOf(r.level as LicenceLevel));
  }
  return best >= 0 ? ORDER[best] : null;
}

/** Coaches of a base (licence coach or above), for candidates' reviews. */
export async function coachesOf(q: Queryable, ctx: Ctx, baseId: string): Promise<string[]> {
  const today = todayIn(ctx);
  const rows = await liveRows(q, sysOf(ctx), "kb_licence", { and: [{ f: "state", op: "eq", v: "active" }, { f: "level", op: "in", v: ["coach", "kde"] }] }, { limit: 500 });
  return [...new Set(rows.filter((r) => (!r.base_id || r.base_id === baseId) && (!r.expires_at || String(r.expires_at) >= today)).map((r) => String(r.user_id)))];
}

/** Make an internal article external (validated, the base's audience) and say why in its journal. */
async function goExternal(tx: Tx, sys: Ctx, a: Row, why: string): Promise<void> {
  await updateIn(tx, sys, "kb_article", a.id, { visibility: "inherit", kcs_confidence: "validated" }, { trusted: true });
  const { def } = await defFor(sys, "kb_article", tx);
  const row = (await rowsById(tx, sys, "kb_article", [a.id]))[0];
  if (row) await addJournalIn(tx, sys, def, row, { kind: "system", visibility: "internal", body: why }, { trusted: true, author: null });
}

/** The publishing models of every base that has one (once per sweep). Returns how many articles moved. */
export async function runPublishingModels(sys: Ctx): Promise<{ external: number; queued: number }> {
  const out = { external: 0, queued: 0 };
  const bases = await liveRows(sys.db, sys, "kb_base", { and: [{ f: "publishing_model", op: "in", v: ["reuse", "conveyor"] }, { f: "state", op: "eq", v: "active" }, { f: "kind", op: "eq", v: "external" }] }, { limit: 200 });
  for (const b of bases) {
    const n = Math.max(1, Number(b.external_after_reuses ?? 3));
    const ready = await liveRows(sys.db, sys, "kb_article", {
      and: [{ f: "base_id", op: "eq", v: b.id }, { f: "state", op: "eq", v: "published" }, { f: "reuse_count", op: "gte", v: n }, { f: "confidential", op: "eq", v: true }, { f: "article_type", op: "ne", v: "procedure" }, { f: "visibility", op: "ne", v: "internal" }],
    }, { limit: 200 });
    for (const a of ready) {
      if (b.publishing_model === "reuse") {
        await sys.write((tx) => goExternal(tx, sys, a, `پس از ${n} بار استفادهٔ دوباره برای درخواست‌کنندگان منتشر شد (مدل انتشار پایگاه).`));
        out.external++;
        continue;
      }
      // conveyor belt: a task that publishes when it is still open after the window
      const tasks = await liveRows(sys.db, sys, "kb_task", { and: [{ f: "article_id", op: "eq", v: a.id }, { f: "kind", op: "eq", v: "external" }] }, { order: "t.created_at desc", limit: 1 });
      const t = tasks[0];
      if (!t) {
        const days = Math.max(1, Number(b.conveyor_days ?? 5));
        await sys.write((tx) =>
          createIn(tx, sys, "kb_task", {
            kind: "external", article_id: a.id, priority: "4", due_at: `${addDaysISO(todayIn(sys), days)}T12:00:00.000Z`,
            short_description: `انتشار بیرونی خودکار: ${String(a.title).slice(0, 150)}`,
            description: `این مقاله ${a.reuse_count} بار به کار رفته است و ${days} روز دیگر برای درخواست‌کنندگان منتشر می‌شود. برای جلوگیری، این کار را «کنار بگذارید».`,
          }, { trusted: true }),
        );
        out.queued++;
      } else if (t.active && t.due_at && Date.parse(t.due_at) <= Date.now()) {
        await sys.write(async (tx) => {
          await goExternal(tx, sys, a, "نوار نقالهٔ انتشار: کسی جلوی انتشار بیرونی را نگرفت؛ برای درخواست‌کنندگان منتشر شد.");
          const { transitionIn } = await import("../../engine");
          await transitionIn(tx, sys, "kb_task", t.id, "done", { close_code: "fixed", close_notes: "به‌طور خودکار منتشر شد" }, { trusted: true });
        });
        out.external++;
      }
    }
  }
  return out;
}
