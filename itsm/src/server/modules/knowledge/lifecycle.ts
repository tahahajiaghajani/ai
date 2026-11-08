// Lifecycle operations of articles that are more than one transition (KB-016, KB-018, KB-020, KB-021, KB-027):
// retirement — now, on a date, or through approval — with a reason and an optional replacement; restoring from the
// trash (back to a draft, or to «بازنشسته» when it had been published); the one-click periodic review (still correct:
// the next review date moves on and the review is recorded; update: a new draft; retire); and re-owning the articles of
// a person who left. Each runs with the caller's access (the engine decides) unless stated.
import type { Ctx } from "../../context";
import { addJournalIn, defFor, get, transitionIn, updateIn } from "../../engine";
import { bad, conflict, forbidden } from "../../http/errors";
import { addDaysISO, articleOf, baseOf, isKbAdmin, isKbApprover, isUuid, liveRows, sysOf, todayIn, writesAll, type Row } from "./common";
import { newDraftIn } from "./versions";

/** Retire now (or ask for approval when the base wants it), or schedule the retirement for a date. */
export async function retireArticle(ctx: Ctx, id: string, input: { reason: string; replaced_by?: string | null; at?: string | null }) {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw bad("دلیل بازنشستگی را بنویسید");
  await get(ctx, "kb_article", id);
  if (input.replaced_by && !isUuid(input.replaced_by)) throw bad("مقالهٔ جایگزین معتبر نیست");
  await ctx.write(async (tx) => {
    const a = await articleOf(tx, ctx, id);
    if (!a) throw bad("مقاله پیدا نشد");
    const base = await baseOf(tx, ctx, a.base_id);
    const data: Row = { retire_reason: reason.slice(0, 2000), replaced_by: input.replaced_by ?? null };
    if (input.at && input.at > todayIn(ctx)) {
      await updateIn(tx, ctx, "kb_article", id, { ...data, retire_at: input.at.slice(0, 10) }, {});
      return;
    }
    const needsApproval = !!base?.retire_approval && !isKbApprover(ctx);
    if (needsApproval && a.state === "pending_retirement") throw conflict("درخواست بازنشستگی این مقاله منتظر تأیید است");
    await transitionIn(tx, ctx, "kb_article", id, needsApproval ? "pending_retirement" : "retired", data, {});
  });
  return get(ctx, "kb_article", id);
}

/** Restore from the trash: a draft that was never published, a retired article otherwise. */
export async function restoreArticle(ctx: Ctx, id: string) {
  const a = (await get(ctx, "kb_article", id)).row as Row;
  if (a.state === "trashed") {
    await ctx.write((tx) => transitionIn(tx, ctx, "kb_article", id, a.published_version_id ? "retired" : "draft", {}, {}));
  } else if (a.state === "retired") {
    await ctx.write((tx) => transitionIn(tx, ctx, "kb_article", id, "published", { retire_reason: null }, {}));
  } else throw conflict("این مقاله در سطل بازیافت یا بازنشسته نیست");
  return get(ctx, "kb_article", id);
}

/** The periodic review in one click. */
export async function reviewArticle(ctx: Ctx, id: string, input: { outcome: "confirm" | "update" | "retire"; note?: string | null; reason?: string | null }) {
  const a = (await get(ctx, "kb_article", id)).row as Row;
  if (input.outcome === "retire") return retireArticle(ctx, id, { reason: input.reason ?? input.note ?? "بازبینی دوره‌ای: دیگر لازم نیست" });
  if (input.outcome === "update") {
    const v = await ctx.write((tx) => newDraftIn(tx, ctx, id, { kind: "minor", note: input.note ?? "بازبینی دوره‌ای" }));
    return { draft: v.id };
  }
  const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
  await ctx.write(async (tx) => {
    const base = await baseOf(tx, sys, a.base_id);
    const days = Number(base?.review_days ?? 0);
    const today = todayIn(ctx);
    const patch: Row = { last_reviewed_at: new Date().toISOString(), last_reviewed_by: ctx.actor === "system" ? null : ctx.user.id, review_due: false, review_at: days > 0 ? addDaysISO(today, days) : null };
    // the caller must be able to change the article (the engine checks), then the stamps are the module's
    await updateIn(tx, ctx, "kb_article", id, { review_at: patch.review_at }, {});
    await updateIn(tx, sys, "kb_article", id, patch, { trusted: true, keepVersion: true });
    const { def } = await defFor(sys, "kb_article", tx);
    const row = (await articleOf(tx, sys, id))!;
    await addJournalIn(tx, sys, def, row, { kind: "system", visibility: "internal", body: `بازبینی شد: مقاله درست است${input.note ? ` — ${String(input.note).slice(0, 300)}` : ""}.` }, { trusted: true, author: ctx.actor === "system" ? null : ctx.user.id });
    const tasks = await liveRows(tx, sys, "kb_task", { and: [{ f: "article_id", op: "eq", v: id }, { f: "kind", op: "in", v: ["review", "expiry"] }, { f: "active", op: "eq", v: true }] }, { limit: 10 });
    for (const t of tasks) await transitionIn(tx, sys, "kb_task", t.id, "done", { close_code: "confirmed", close_notes: "بازبینی شد" }, { trusted: true });
  });
  return get(ctx, "kb_article", id);
}

/** Move every article a person owns (optionally in one base) to another owner — knowledge managers. */
export async function reownArticles(ctx: Ctx, input: { from: string; to: string; base_id?: string | null }) {
  if (!(writesAll(ctx) || isKbAdmin(ctx))) throw forbidden("انتقال گروهی مالکیت با مدیران دانش است");
  if (!isUuid(input.from) || !isUuid(input.to) || input.from === input.to) throw bad("مالک فعلی و مالک تازه را انتخاب کنید");
  const where = { and: [{ f: "owner_id", op: "eq" as const, v: input.from }, { f: "state", op: "ne" as const, v: "trashed" }, ...(input.base_id ? [{ f: "base_id", op: "eq" as const, v: input.base_id }] : [])] };
  const rows = await liveRows(ctx.db, ctx, "kb_article", where, { limit: 5000 });
  let moved = 0;
  const failed: { id: string; message: string }[] = [];
  for (const r of rows) {
    try {
      await ctx.write((tx) => updateIn(tx, ctx, "kb_article", r.id, { owner_id: input.to }, { allowLocked: true }));
      moved++;
    } catch (e) {
      failed.push({ id: r.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const sys = sysOf(ctx);
  const tasks = await liveRows(ctx.db, sys, "kb_task", { and: [{ f: "kind", op: "eq", v: "re_own" }, { f: "active", op: "eq", v: true }, { f: "source_id", op: "eq", v: input.from }] }, { limit: 20 });
  if (tasks.length && !failed.length) await sys.write(async (tx) => { for (const t of tasks) await transitionIn(tx, sys, "kb_task", t.id, "done", { close_code: "fixed", close_notes: `${moved} مقاله منتقل شد` }, { trusted: true }); });
  return { moved, failed };
}
