// Merging duplicate CIs (catalogue CMDB-028): the survivor takes the absorbed CIs' values where it has none, their
// relationships (re-pointed; ones the survivor already has are ended instead) and every reference other records hold to
// them (incidents, problems, changes, services, findings, groups, maps… — closed records included); the absorbed CIs
// are retired with «ادغام‌شده در». Everything happens in one transaction through the engine (history, events), and a
// journal on the de-duplication task records each move so «بازگرداندن ادغام» can put it back.
import { tableDef, TABLES } from "@shared/tables";
import { FIELD_TYPES } from "@shared/model/types";
import type { MergePreview } from "@shared/cmdb/api";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { orgSchema, savepoint, transitionIn, updateIn } from "../../engine";
import { access } from "../../access/provider";
import { CI_COLUMNS, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { ensureDedupTask } from "./ire";

/** Tables whose references to CIs follow a merge (every ref/refs to `ci` but the CMDB's own history-like records). */
const KEEP_REFERENCES = new Set(["ci_rel", "cmdb_dedup_task", "ci_baseline", "ci_impact_sim", "ci_rel_suggestion"]);

export function ciReferences(): { table: string; field: string; label: string; many: boolean }[] {
  const out: { table: string; field: string; label: string; many: boolean }[] = [];
  for (const def of TABLES.values()) {
    if (def.virtual || KEEP_REFERENCES.has(def.key)) continue;
    for (const f of def.fields) {
      if (f.ref !== "ci" || (f.type !== "ref" && f.type !== "refs")) continue;
      if (def.key === "ci" && f.name === "merged_into") continue;
      out.push({ table: def.key, field: f.name, label: `${def.plural} — ${f.label}`, many: !!FIELD_TYPES[f.type].array });
    }
  }
  return out;
}

const MERGE_FIELDS = [...CI_COLUMNS].filter((f) => !["name", "class", "state"].includes(f));
const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

interface Journal {
  survivor: string;
  absorbed: { id: string; state: string; merged_into: string | null }[];
  fills: { field: string; value: unknown }[];
  attrs: Record<string, unknown>;
  rels: { id: string; field?: "parent_id" | "child_id"; from?: string; ended?: boolean }[];
  refs: { table: string; id: string; field: string; before: unknown; after: unknown }[];
  at: string;
  by: string | null;
}

async function loadMerge(tx: Tx, ctx: Ctx, survivorId: string, absorbedIds: string[]) {
  const ids = [...new Set(absorbedIds.filter(isUuid).map((x) => x.toLowerCase()))].filter((x) => x !== survivorId.toLowerCase());
  if (!ids.length) throw bad("دست‌کم یک پیکربندی برای ادغام لازم است");
  if (ids.length > 20) throw bad("در هر ادغام حداکثر ۲۰ پیکربندی");
  const survivor = await liveRow(tx, ctx, "ci", survivorId);
  if (!survivor) throw notFound("پیکربندی اصلی پیدا نشد");
  const absorbed = await liveRows(tx, ctx, "ci", { f: "id", op: "in", v: ids });
  if (absorbed.length !== ids.length) throw notFound("یکی از پیکربندی‌ها پیدا نشد");
  if (ctx.actor !== "system") {
    const def = (await orgSchema(ctx, tx)).def("ci") ?? tableDef("ci")!;
    for (const r of [survivor, ...absorbed]) if (!access().canWrite(ctx, def, r)) throw forbidden(`اجازهٔ تغییر «${r.name}» را ندارید`);
  }
  for (const r of absorbed) if (r.merged_into) throw conflict(`«${r.name}» پیش‌تر در پیکربندی دیگری ادغام شده است`);
  return { survivor, absorbed };
}

/** What a merge would do (nothing is written). */
export async function mergePreview(ctx: Ctx, survivorId: string, absorbedIds: string[]): Promise<MergePreview> {
  return ctx.write(async (tx) => {
    const { survivor, absorbed } = await loadMerge(tx, ctx, survivorId, absorbedIds);
    const labels = new Map((tableDef("ci")?.fields ?? []).map((f) => [f.name, f.label]));
    const fills: MergePreview["fills"] = [];
    for (const f of MERGE_FIELDS) {
      if (!empty(survivor[f])) continue;
      const from = [...absorbed].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).find((a) => !empty(a[f]));
      if (from) fills.push({ field: f, label: labels.get(f) ?? f, value: from[f], from: from.name });
    }
    const sys = sysOf(ctx);
    const ids = absorbed.map((a) => a.id);
    const rels = await liveRows(tx, sys, "ci_rel", { and: [{ or: [{ f: "parent_id", op: "in", v: ids }, { f: "child_id", op: "in", v: ids }] }, { f: "valid_to", op: "empty" }] }, { limit: 5000 });
    const own = await liveRows(tx, sys, "ci_rel", { and: [{ or: [{ f: "parent_id", op: "eq", v: survivor.id }, { f: "child_id", op: "eq", v: survivor.id }] }, { f: "valid_to", op: "empty" }] }, { limit: 5000 });
    const key = (p: string, c: string, t: string) => `${p}|${c}|${t}`;
    const existing = new Set(own.map((r) => key(r.parent_id, r.child_id, r.type)));
    let move = 0;
    let drop = 0;
    for (const r of rels) {
      const p = ids.includes(r.parent_id) ? survivor.id : r.parent_id;
      const c = ids.includes(r.child_id) ? survivor.id : r.child_id;
      if (p === c || existing.has(key(p, c, r.type))) drop++;
      else {
        existing.add(key(p, c, r.type));
        move++;
      }
    }
    const references: MergePreview["references"] = [];
    for (const ref of ciReferences()) {
      if (!tableDef(ref.table)) continue;
      const n = (await liveRows(tx, sys, ref.table, { f: ref.field, op: "in", v: ids }, { limit: 5000 })).length;
      if (n) references.push({ table: ref.table, label: ref.label, field: ref.field, count: n });
    }
    const problems: string[] = [];
    if (absorbed.some((a) => a.class !== survivor.class)) problems.push("کلاس پیکربندی‌ها یکی نیست؛ ویژگی‌های کلاسی که پیکربندی اصلی ندارد بایگانی می‌مانند");
    return {
      survivor: { id: survivor.id, number: survivor.number ?? null, name: survivor.name },
      absorbed: absorbed.map((a) => ({ id: a.id, number: a.number ?? null, name: a.name })),
      fills, relations: { move, drop }, references, problems,
    };
  });
}

/** Merge `absorbedIds` into `survivorId` (as the caller, who must be able to change all of them). */
export async function mergeCis(ctx: Ctx, survivorId: string, absorbedIds: string[], opts: { taskId?: string | null } = {}): Promise<{ task_id: string; survivor: string; absorbed: string[]; moved: { relations: number; references: number } }> {
  return ctx.write(async (tx) => {
    const { survivor, absorbed } = await loadMerge(tx, ctx, survivorId, absorbedIds);
    const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
    const ids = absorbed.map((a) => a.id);
    const at = new Date().toISOString();
    const journal: Journal = { survivor: survivor.id, absorbed: absorbed.map((a) => ({ id: a.id, state: a.state, merged_into: a.merged_into ?? null })), fills: [], attrs: {}, rels: [], refs: [], at, by: ctx.actor === "system" ? null : ctx.user.id };
    // values the survivor lacks, from the most recently updated absorbed CI that has one
    const patch: Record<string, unknown> = {};
    const newest = [...absorbed].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    for (const f of MERGE_FIELDS) {
      if (!empty(survivor[f])) continue;
      const from = newest.find((a) => !empty(a[f]));
      if (from) {
        patch[f] = from[f];
        journal.fills.push({ field: f, value: from[f] });
      }
    }
    const attrs = { ...((survivor.attrs ?? {}) as Record<string, unknown>) };
    for (const a of newest) for (const [k, v] of Object.entries((a.attrs ?? {}) as Record<string, unknown>)) if (empty(attrs[k]) && !empty(v)) {
      attrs[k] = v;
      journal.attrs[k] = v;
    }
    if (Object.keys(journal.attrs).length) patch.attrs = attrs;
    if (Object.keys(patch).length) await updateIn(tx, sys, "ci", survivor.id, patch, { trusted: true, allowLocked: true });
    // relationships
    const rels = await liveRows(tx, sysOf(ctx), "ci_rel", { and: [{ or: [{ f: "parent_id", op: "in", v: ids }, { f: "child_id", op: "in", v: ids }] }, { f: "valid_to", op: "empty" }] }, { limit: 5000 });
    let movedRels = 0;
    for (const r of rels) {
      const p = ids.includes(r.parent_id) ? survivor.id : r.parent_id;
      const c = ids.includes(r.child_id) ? survivor.id : r.child_id;
      const moved = await savepoint(tx, async () => {
        if (p === c) throw new Error("self");
        const data: Record<string, unknown> = {};
        if (p !== r.parent_id) data.parent_id = p;
        if (c !== r.child_id) data.child_id = c;
        await updateIn(tx, sysOf(ctx), "ci_rel", r.id, data, { trusted: true });
        return true;
      }).catch(() => false);
      if (moved) {
        movedRels++;
        if (p !== r.parent_id) journal.rels.push({ id: r.id, field: "parent_id", from: r.parent_id });
        if (c !== r.child_id) journal.rels.push({ id: r.id, field: "child_id", from: r.child_id });
      } else {
        await updateIn(tx, sysOf(ctx), "ci_rel", r.id, { valid_to: at, note: [r.note, "پایان با ادغام پیکربندی"].filter(Boolean).join("\n") }, { trusted: true });
        journal.rels.push({ id: r.id, ended: true });
      }
    }
    // references of other records
    let movedRefs = 0;
    for (const ref of ciReferences()) {
      if (!tableDef(ref.table)) continue;
      for (const row of await liveRows(tx, sysOf(ctx), ref.table, { f: ref.field, op: "in", v: ids }, { limit: 5000 })) {
        const before = row[ref.field] ?? null;
        const value = ref.many ? [...new Set(((before as string[] | null) ?? []).map((x: string) => (ids.includes(x) ? survivor.id : x)))] : survivor.id;
        const ok = await savepoint(tx, () => updateIn(tx, sys, ref.table, row.id, { [ref.field]: value }, { trusted: true, allowLocked: true, keepVersion: true })).then(() => true).catch(() => false);
        if (ok) {
          movedRefs++;
          journal.refs.push({ table: ref.table, id: row.id, field: ref.field, before, after: value });
        }
      }
    }
    // the absorbed CIs are retired into the survivor
    for (const a of absorbed) {
      await updateIn(tx, sys, "ci", a.id, { merged_into: survivor.id }, { trusted: true, allowLocked: true });
      if (!["retired", "disposed", "canceled"].includes(a.state)) await transitionIn(tx, sys, "ci", a.id, "retired", {}, { trusted: true });
    }
    // the journal lives on the de-duplication task (one is made when the merge did not start from one)
    let task = opts.taskId ? await liveRow(tx, sysOf(ctx), "cmdb_dedup_task", opts.taskId) : null;
    if (!task) task = await ensureDedupTask(tx, ctx, [survivor.id, ...ids], "ادغام دستی");
    await updateIn(tx, sysOf(ctx), "cmdb_dedup_task", task.id, { main_ci_id: survivor.id, merge_journal: journal, merged_at: at, merged_by: journal.by, undone_at: null }, { trusted: true, allowLocked: true });
    if (task.state !== "resolved" && task.state !== "closed") {
      await transitionIn(tx, sys, "cmdb_dedup_task", task.id, "resolved", { close_notes: `${absorbed.length} پیکربندی در «${survivor.name}» ادغام شد` }, { trusted: true }).catch(() => undefined);
    }
    return { task_id: task.id, survivor: survivor.id, absorbed: ids, moved: { relations: movedRels, references: movedRefs } };
  });
}

/** Put a merge back from its journal (values that changed since are left as they are). */
export async function undoMerge(ctx: Ctx, taskId: string): Promise<{ restored: number; skipped: number }> {
  return ctx.write(async (tx) => {
    const task = await liveRow(tx, ctx, "cmdb_dedup_task", taskId);
    if (!task) throw notFound("بررسی تکراری پیدا نشد");
    const j = task.merge_journal as Journal | null;
    if (!j?.survivor || task.undone_at) throw conflict("این بررسی ادغامی برای بازگرداندن ندارد");
    await loadMerge(tx, ctx, j.survivor, j.absorbed.map((a) => a.id)).catch(async (e) => {
      // the absorbed CIs are merged now: check access on them directly
      if (!(e instanceof Error) || !/ادغام شده/.test(e.message)) throw e;
    });
    const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
    let restored = 0;
    let skipped = 0;
    for (const r of j.refs) {
      const row = await liveRow(tx, sysOf(ctx), r.table, r.id);
      if (!row) {
        skipped++;
        continue;
      }
      if (JSON.stringify(row[r.field] ?? null) !== JSON.stringify(r.after ?? null)) {
        skipped++;
        continue;
      }
      const ok = await savepoint(tx, () => updateIn(tx, sys, r.table, r.id, { [r.field]: r.before }, { trusted: true, allowLocked: true, keepVersion: true })).then(() => true).catch(() => false);
      if (ok) restored++;
      else skipped++;
    }
    for (const r of j.rels) {
      const row = await liveRow(tx, sysOf(ctx), "ci_rel", r.id);
      if (!row) continue;
      const data: Record<string, unknown> = r.ended ? { valid_to: null } : r.field && r.from ? { [r.field]: r.from } : {};
      if (!Object.keys(data).length) continue;
      const ok = await savepoint(tx, () => updateIn(tx, sysOf(ctx), "ci_rel", r.id, data, { trusted: true })).then(() => true).catch(() => false);
      if (ok) restored++;
      else skipped++;
    }
    const survivor = await liveRow(tx, sysOf(ctx), "ci", j.survivor);
    if (survivor) {
      const patch: Record<string, unknown> = {};
      for (const f of j.fills) if (JSON.stringify(survivor[f.field] ?? null) === JSON.stringify(f.value ?? null)) patch[f.field] = null;
      const attrs = { ...((survivor.attrs ?? {}) as Record<string, unknown>) };
      let attrsChanged = false;
      for (const [k, v] of Object.entries(j.attrs ?? {})) if (JSON.stringify(attrs[k] ?? null) === JSON.stringify(v ?? null)) {
        delete attrs[k];
        attrsChanged = true;
      }
      if (attrsChanged) patch.attrs = attrs;
      if (Object.keys(patch).length) await updateIn(tx, sys, "ci", j.survivor, patch, { trusted: true, allowLocked: true });
    }
    for (const a of j.absorbed) {
      const row = await liveRow(tx, sysOf(ctx), "ci", a.id);
      if (!row) continue;
      await updateIn(tx, sys, "ci", a.id, { merged_into: a.merged_into ?? null }, { trusted: true, allowLocked: true });
      if (row.state === "retired" && !["retired", "disposed", "canceled"].includes(a.state)) await transitionIn(tx, sys, "ci", a.id, "operational", {}, { trusted: true }).catch(() => undefined);
      restored++;
    }
    await updateIn(tx, sysOf(ctx), "cmdb_dedup_task", taskId, { undone_at: new Date().toISOString() }, { trusted: true, allowLocked: true });
    return { restored, skipped };
  });
}

export type { Row };
