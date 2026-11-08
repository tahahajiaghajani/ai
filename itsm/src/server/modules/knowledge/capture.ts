// Knowledge captured in the flow of work (KB-013, KB-023, KB-046, KCS Solve Loop):
//   · «ساخت مقاله» from a record — incident, problem, known error, or any task table — opens a KCS draft: the issue in the
//     requester's words, the environment (service, CI, category), the resolution and the cause, with people's names,
//     contacts and identifiers scrubbed; the article links back to the record («ساخته‌شده از») and the capture task of
//     the record (if any) is done
//   · «مقالهٔ در حال کار» (WIP) when a search from a record finds nothing: the search text becomes an internal WIP
//     article linked to the record; at resolution it is completed (a task for its author) or, when another article
//     solved the record, removed
//   · a resolved record with «ساخت مقالهٔ دانش» ticked and no article gets a capture task for whoever resolved it
//   · known errors publish as internal known-error articles; a changed known error asks the article's owner to update
//     it, a fixed or retired one proposes retiring the article
import { captureDraft, scrubPeople, type CaptureSource } from "@shared/knowledge/logic";
import { stateCategory } from "@shared/model/task";
import type { Ctx } from "../../context";
import { addLink, createIn, defFor, get, onRecordEvent, orgSchema, systemCtx, transitionIn, type RecordEvent } from "../../engine";
import type { JobContext } from "../../jobs";
import { bad, forbidden } from "../../http/errors";
import { actsHere } from "../notify";
import { canAuthor, contributesTo, isUuid, kbConfig, liveRow, liveRows, memberNames, sysOf, type Row } from "./common";
import { createArticleIn } from "./versions";
import { logEvent } from "./events";
import { KB_LINK_KINDS, linkedArticles } from "./links";

/** How a record of a table reads as a KCS draft. */
type Mapper = (row: Row, display: Record<string, string>, label: (field: string) => string | null) => CaptureSource;

const env = (row: Row, display: Record<string, string>, label: (f: string) => string | null): string[] =>
  [
    row.service_id ? `خدمت: ${display[row.service_id] ?? ""}` : null,
    row.ci_id ? `پیکربندی: ${display[row.ci_id] ?? ""}` : null,
    row.category ? `دسته: ${label("category") ?? row.category}${row.subcategory ? ` / ${label("subcategory") ?? row.subcategory}` : ""}` : null,
  ].filter((x): x is string => !!x && !x.endsWith(": "));

const MAPPERS: Record<string, Mapper> = {
  incident: (r, d, l) => ({ table: "incident", number: r.number, title: r.short_description, description: r.description, resolution: r.close_notes, cause: l("cause_code"), workaround: r.workaround ?? null, environment: env(r, d, l) }),
  problem: (r, d, l) => ({ table: "problem", number: r.number, title: r.short_description, description: r.description, symptoms: r.symptoms, cause: r.cause_notes ?? l("cause_code"), workaround: r.workaround, resolution: r.fix_notes, environment: env(r, d, l) }),
  known_error: (r, d, l) => ({ table: "known_error", number: r.number, title: r.short_description, symptoms: r.symptoms, cause: r.root_cause, workaround: r.workaround, resolution: r.workaround, environment: env(r, d, l) }),
};
const generic: Mapper = (r, d, l) => ({ table: "", number: r.number, title: r.short_description ?? r.title ?? r.name, description: r.description, resolution: r.close_notes ?? r.resolution ?? null, environment: env(r, d, l) });

/** The KCS draft of a record the caller may read, people scrubbed. */
export async function draftOfRecord(ctx: Ctx, table: string, id: string): Promise<{ draft: ReturnType<typeof captureDraft>; record: Row }> {
  const r = await get(ctx, table, id);
  const row = r.row as Row;
  const schema = await orgSchema(ctx);
  const def = schema.def(table)!;
  const label = (field: string) => {
    const f = def.fields.find((x) => x.name === field);
    const v = row[field];
    if (!f || v === null || v === undefined || v === "") return null;
    const opts = typeof f.choices === "string" ? schema.choices(f.choices) : Array.isArray(f.choices) ? f.choices : [];
    return opts.find((o) => o.value === v)?.label ?? String(v);
  };
  const src = (MAPPERS[table] ?? generic)(row, r.display, label);
  const people = ["caller_id", "requested_for", "opened_by", "assigned_to", "resolved_by", "owner_id"].map((f) => row[f]).filter(isUuid);
  const names = [...(await memberNames(ctx.db, ctx.org.id, people)), ...people.map((p) => r.display[p]).filter(Boolean)];
  const scrub = (s: string | null | undefined) => (s ? scrubPeople(s, names) : s);
  const clean: CaptureSource = { ...src, title: scrub(src.title), description: scrub(src.description), resolution: scrub(src.resolution), cause: scrub(src.cause), workaround: scrub(src.workaround), symptoms: scrub(src.symptoms), environment: src.environment };
  return { draft: captureDraft(clean), record: row };
}

/** The base a captured article goes to: the one asked for, else the first active base the caller writes in (KCS first). */
async function captureBase(ctx: Ctx, baseId: string | null | undefined, preferInternal = false): Promise<Row> {
  const sys = sysOf(ctx);
  if (baseId) {
    const b = await liveRow(ctx.db, sys, "kb_base", baseId);
    if (!b) throw bad("پایگاه دانش پیدا نشد");
    return b;
  }
  const bases = await liveRows(ctx.db, ctx, "kb_base", { f: "state", op: "eq", v: "active" }, { order: "t.sort_order, t.name", limit: 100 });
  const mine = bases.filter((b) => contributesTo(ctx, b));
  const pick = mine.find((b) => (preferInternal ? b.kind === "internal" : b.kcs_enabled)) ?? mine.find((b) => b.kind === "internal") ?? mine[0];
  if (!pick) throw forbidden("پایگاه دانشی که در آن بنویسید ندارید");
  return pick;
}

/** «ساخت مقاله» from a record: a KCS (or known-error) draft linked to the record. */
export async function captureFromRecord(ctx: Ctx, input: { table: string; id: string; base_id?: string | null; category_id?: string | null; template_id?: string | null; wip?: boolean; title?: string | null }) {
  if (!canAuthor(ctx)) throw forbidden("اجازهٔ نوشتن مقالهٔ دانش را ندارید");
  if (!isUuid(input.id)) throw bad("شناسه معتبر نیست");
  const { draft, record } = await draftOfRecord(ctx, input.table, input.id);
  const ke = input.table === "known_error";
  const base = await captureBase(ctx, input.base_id, ke);
  const sys = sysOf(ctx);
  const templates = await liveRows(ctx.db, sys, "kb_template", { f: "builtin", op: "eq", v: ke ? "known_error" : "kcs" }, { limit: 1 });
  const title = String(input.title ?? "").trim() || draft.title;
  const created = await ctx.write((tx) =>
    createArticleIn(tx, ctx, {
      base_id: base.id,
      category_id: input.category_id ?? null,
      template_id: input.template_id ?? templates[0]?.id ?? null,
      article_type: ke ? "known_error" : "kcs",
      title,
      summary: draft.summary || null,
      body: input.wip ? `## مسئله\n\n${title}\n` : draft.body,
      internal_body: draft.internal_body,
      keywords: draft.keywords,
      visibility: ke || input.wip ? "internal" : "inherit",
      kcs_confidence: input.wip ? "wip" : null,
      known_error_id: ke ? input.id : null,
      problem_id: ke ? record.problem_id ?? null : input.table === "problem" ? input.id : null,
      source: { table: input.table, id: input.id, number: record.number ?? null },
      change_note: `ساخته‌شده از ${record.number ?? input.table}`,
    }),
  );
  await addLink(ctx, "kb_article", created.article.id, { kind: "kb_created_from", table: input.table, id: input.id });
  // the capture task of the record is done
  const tasks = await liveRows(ctx.db, sys, "kb_task", { and: [{ f: "kind", op: "eq", v: "capture" }, { f: "source_id", op: "eq", v: input.id }, { f: "active", op: "eq", v: true }] }, { limit: 5 });
  if (tasks.length) {
    await sys.write(async (tx) => {
      for (const t of tasks) await transitionIn(tx, sys, "kb_task", t.id, "done", { close_code: "created", close_notes: `مقالهٔ ${created.article.number} نوشته شد` }, { trusted: true });
    });
  }
  await logEvent(ctx.db, ctx, { kind: "create", article_id: created.article.id, record_table: input.table, record_id: input.id, channel: "record", data: { wip: !!input.wip } });
  return created;
}

/** Article of a known error (internal, the known-error template): reuses an existing live one. */
export async function articleFromKnownError(ctx: Ctx, keId: string, baseId?: string | null) {
  const [existing] = await liveRows(ctx.db, ctx, "kb_article", { and: [{ f: "known_error_id", op: "eq", v: keId }, { f: "state", op: "nin", v: ["trashed", "retired"] }] }, { limit: 1 });
  if (existing) return { article: existing, version: null, existing: true };
  return { ...(await captureFromRecord(ctx, { table: "known_error", id: keId, base_id: baseId })), existing: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Subscribers

const hasKnowledgeField = async (ctx: Ctx, table: string) => {
  const schema = await orgSchema(ctx);
  const def = schema.def(table);
  return !!def?.fields.some((f) => f.name === "knowledge" && f.type === "bool") && !table.startsWith("kb_");
};

/** A record entered a resolved category: the capture task and the WIP articles written from it. */
async function onResolved(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id) || e.to_category !== "resolved" || e.table.startsWith("kb_")) return;
  const sys = await systemCtx(jctx.cfg, e.org_id);
  if (!(await hasKnowledgeField(sys, e.table))) return;
  const row = await liveRow(jctx.db, sys, e.table, e.id);
  if (!row) return;
  const cfg = await kbConfig(jctx.db, sys);
  const links = await linkedArticles(sys, e.table, e.id).catch(() => []);
  const solvedBy = links.filter((l) => l.kind === "kb_solved_by" || l.kind === "kb_workaround").map((l) => l.article.id);
  const created = await liveRows(jctx.db, sys, "kb_article", { and: [{ f: "source_id", op: "eq", v: e.id }, { f: "state", op: "nin", v: ["trashed"] }] }, { limit: 10 });
  await sys.write(async (tx) => {
    // WIP articles: another article solved it → the WIP goes; otherwise its author completes it
    for (const w of created.filter((a) => a.kcs_confidence === "wip" && a.state === "draft")) {
      if (solvedBy.some((id) => id !== w.id)) {
        await transitionIn(tx, sys, "kb_article", w.id, "trashed", {}, { trusted: true });
      } else {
        await createIn(tx, sys, "kb_task", { kind: "capture", article_id: w.id, priority: "3", assigned_to: w.author_id ?? null, short_description: `تکمیل مقالهٔ در حال کار ${w.number}: ${String(w.title).slice(0, 150)}`, description: `رکورد ${row.number ?? ""} حل شد؛ راه‌حل را در مقاله بنویسید و آن را برای انتشار بفرستید.`, source_table: e.table, source_id: e.id, source_number: row.number ?? null }, { trusted: true });
      }
    }
    if (!cfg.capture_on_resolve || row.knowledge !== true || created.length || solvedBy.length) return;
    const [open] = await liveRows(tx, sys, "kb_task", { and: [{ f: "kind", op: "eq", v: "capture" }, { f: "source_id", op: "eq", v: e.id }] }, { limit: 1 });
    if (open) return;
    await createIn(tx, sys, "kb_task", {
      kind: "capture", priority: "4", assigned_to: (isUuid(e.actor) ? e.actor : null) ?? row.resolved_by ?? row.assigned_to ?? null, assignment_group_id: row.assignment_group_id ?? cfg.default_group_id ?? null,
      short_description: `نوشتن مقالهٔ دانش از ${row.number ?? ""}: ${String(row.short_description ?? "").slice(0, 150)}`,
      description: "این رکورد با «ساخت مقالهٔ دانش» حل شد. از صفحهٔ رکورد «ساخت مقاله» را بزنید تا پیش‌نویس با شرح، محیط و راه‌حل ساخته شود.",
      source_table: e.table, source_id: e.id, source_number: row.number ?? null,
    }, { trusted: true });
  });
}

/** A known error changed: its articles' owners update them; fixed or retired → retire the article. */
async function onKnownError(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  const important = e.kind === "record.state_changed" || (e.changed ?? []).some((f) => ["symptoms", "workaround", "root_cause", "short_description"].includes(f));
  if (!important) return;
  const sys = await systemCtx(jctx.cfg, e.org_id);
  const ke = await liveRow(jctx.db, sys, "known_error", e.id);
  if (!ke) return;
  const arts = await liveRows(jctx.db, sys, "kb_article", { and: [{ f: "known_error_id", op: "eq", v: e.id }, { f: "state", op: "in", v: ["draft", "in_review", "scheduled", "published"] }] }, { limit: 20 });
  if (!arts.length) return;
  const { def } = await defFor(sys, "known_error");
  const doneCat = e.kind === "record.state_changed" ? stateCategory(def.states, ke.state) : null;
  const kind = doneCat === "resolved" || doneCat === "closed" ? "retire" : "update";
  await sys.write(async (tx) => {
    for (const a of arts) {
      const [open] = await liveRows(tx, sys, "kb_task", { and: [{ f: "article_id", op: "eq", v: a.id }, { f: "kind", op: "eq", v: kind }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
      if (open) continue;
      await createIn(tx, sys, "kb_task", {
        kind, article_id: a.id, priority: "3", source_table: "known_error", source_id: e.id, source_number: ke.number ?? null,
        short_description: kind === "retire" ? `خطای شناخته‌شده ${ke.number} رفع یا بازنشسته شد؛ مقاله را بازنشسته یا به‌روز کنید` : `خطای شناخته‌شده ${ke.number} تغییر کرد؛ مقاله را به‌روز کنید`,
        description: kind === "retire" ? "راه‌حل دائمی آمده است: مقاله را با راه‌حل تازه به‌روز کنید یا بازنشسته کنید." : "نشانه‌ها، علت یا راه‌حل موقت خطای شناخته‌شده تغییر کرده است؛ مقاله را با آن همگام کنید.",
      }, { trusted: true });
    }
  });
}

export function installCaptureSubscribers(): (() => void)[] {
  return [
    onRecordEvent("kb.capture", onResolved, { kinds: ["record.state_changed"] }),
    onRecordEvent("kb.known_error", onKnownError, { tables: ["known_error"], kinds: ["record.updated", "record.state_changed"] }),
  ];
}

export { KB_LINK_KINDS };
