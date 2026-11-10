// Writes of skills are proposals (catalogue AI-159): a run's field suggestions, drafted note or drafted record becomes
// one row of sm_ai_actions tied to the record. Nothing changes until a person applies it (POST /ai/actions/:id/confirm),
// and then through the normal record service with THAT person's context — field access, locks, transitions and the
// table's rules are checked again exactly as from its form.
//
// Who sees a proposal on a record: whoever may read the record and every field involved — the fields it changes AND
// what the run read: the record's fields that reached the model, the field groups it was allowed, internal notes if
// any were read, and every source a grounded run used. A proposal is never a way to see something one could not read.
// (Tokens in `fields`: a field name, `@g:<group>` a field group, `@r:<table>:<id>` a record that must be readable,
// `@f:<table>:<field>` a field of another table that must be visible.)
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { AiProposal, AiRef } from "@shared/ai/types";
import { SKILL_AI_LABEL, placeholdersOf, type SkillRunResult } from "@shared/ai/skills";
import { tableDef } from "@shared/tables";
import { addJournal, create, get, update } from "../../../engine";
import { conflict } from "../../../http/errors";
import { storeRecordProposal } from "../actions";
import { parsePayload, registerProposalExecutor } from "../tools/proposals";
import { pathOf } from "../tools/common";
import type { ResolvedSkill } from "./config";
import type { SkillRuntimeInput } from "./types";

const UUID = z.string().regex(/^[0-9a-f-]{36}$/i);
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100).toLocaleString("fa-IR")}٪`);

/**
 * What a viewer must be able to read to see a proposal made from this run: the record's fields that reached the model,
 * the field groups the skill was allowed, internal notes if any were read, every source of a grounded run — the record,
 * the field groups of its passage (an article's internal text is in group «internal») and its fields —, and the rows
 * the template showed through `{{related}}` and `{{links}}`.
 */
export function clearanceOf(rs: ResolvedSkill, input: SkillRuntimeInput, extraFields: string[]): string[] {
  const out = new Set<string>(extraFields);
  for (const f of input.record?.fields ?? []) out.add(f.name);
  for (const g of rs.cfg.field_groups) out.add(`@g:${g}`);
  if (input.journal.some((j) => j.visibility === "internal")) out.add("@g:internal");
  for (const p of input.passages) {
    out.add(`@r:${p.citation.table}:${p.citation.id}`);
    for (const g of p.groups ?? []) out.add(`@g:${g}`);
    for (const f of p.fields ?? []) out.add(`@f:${p.citation.table}:${f}`);
  }
  const shown = new Set(placeholdersOf(rs.version.template).map((n) => n.split(".")[0]));
  if (shown.has("related")) for (const t of input.reads?.related ?? []) out.add(t);
  if (shown.has("links")) for (const t of input.reads?.links ?? []) out.add(t);
  return [...out];
}

function recordRef(table: string, id: string, label: string): AiRef {
  return { type: table, id, label, path: pathOf(table, id) ?? `r/${table}/${id}` };
}

/** Store the writes of a run as a proposal on its record (none when the run proposes nothing). */
export async function proposeFromRun(
  ctx: Ctx,
  rs: ResolvedSkill,
  input: SkillRuntimeInput,
  result: SkillRunResult,
  opts: { principal: "person" | "service"; ttlHours?: number },
): Promise<AiProposal | null> {
  const rec = input.record;
  if (!rec) return null;
  const base = {
    area: "ai" as const,
    level: "view" as const,
    record: { table: rec.table, id: rec.id },
    run_id: result.run_id,
    principal: opts.principal,
    ttl_hours: opts.ttlHours ?? (opts.principal === "service" ? 24 * 7 : 24),
    warnings: [SKILL_AI_LABEL],
    edit_path: pathOf(rec.table, rec.id) ?? `r/${rec.table}/${rec.id}`,
  };
  const who = rec.number ? `${rec.table_label} ${rec.number}` : rec.table_label;
  if (rs.def.output === "fields" && result.suggestions.length) {
    const data = Object.fromEntries(result.suggestions.map((s) => [s.field, s.value]));
    const snapshot = Object.fromEntries(result.suggestions.map((s) => [s.field, s.current ?? null]));
    return storeRecordProposal(ctx, {
      ...base,
      kind: "skill.fields",
      title_fa: `${rs.cfg.name}: پیشنهاد برای ${who}`,
      summary_fa: result.suggestions.map((s) => `«${s.label}» ← ${s.display}`).join("؛ ").slice(0, 500),
      payload: { table: rec.table, id: rec.id, data, snapshot, skill: rs.cfg.key },
      preview: result.suggestions.map((s) => ({ label: s.label, value: s.display })),
      lines: result.suggestions.map((s) => ({ cells: [s.label, s.current_display, s.display, pct(s.confidence), s.reason ?? ""] })),
      line_headers: ["فیلد", "مقدار کنونی", "پیشنهاد", "اطمینان", "دلیل"],
      fields: clearanceOf(rs, input, Object.keys(data)),
    });
  }
  if (rs.def.output === "journal" && result.journal?.body.trim()) {
    const internal = result.journal.kind === "work_note";
    return storeRecordProposal(ctx, {
      ...base,
      kind: "skill.journal",
      title_fa: `${rs.cfg.name}: ${internal ? "یادداشت داخلی" : "پاسخ به درخواست‌کننده"} برای ${who}`,
      summary_fa: result.journal.body.slice(0, 500),
      payload: { table: rec.table, id: rec.id, kind: result.journal.kind, body: result.journal.body, skill: rs.cfg.key },
      preview: [{ label: internal ? "یادداشت داخلی" : "پاسخ عمومی", value: result.journal.body.slice(0, 1500) }],
      fields: clearanceOf(rs, input, internal ? ["@g:internal"] : []),
    });
  }
  if (rs.def.output === "record" && result.record && Object.keys(result.record.data).length) {
    const t = tableDef(result.record.table);
    if (!t) return null;
    const preview = Object.entries(result.record.data)
      .filter(([, v]) => v !== null && v !== "" && v !== undefined)
      .slice(0, 12)
      .map(([k, v]) => ({ label: t.fields.find((f) => f.name === k)?.label ?? k, value: typeof v === "string" ? v.slice(0, 400) : JSON.stringify(v).slice(0, 400) }));
    return storeRecordProposal(ctx, {
      ...base,
      kind: "skill.record",
      title_fa: `${rs.cfg.name}: ${t.label} تازه از ${who}`,
      summary_fa: preview.map((p) => `${p.label}: ${p.value}`).join("؛ ").slice(0, 500),
      payload: { table: result.record.table, data: result.record.data, from: { table: rec.table, id: rec.id }, skill: rs.cfg.key },
      preview,
      fields: clearanceOf(rs, input, []),
    });
  }
  return null;
}

// ---------------------------------------------------------------- executors (run with the confirming person's ctx)

const fieldsPayload = z.object({ table: z.string().max(60), id: UUID, data: z.record(z.string(), z.unknown()), snapshot: z.record(z.string(), z.unknown()), skill: z.string().max(80).optional() });
const journalPayload = z.object({ table: z.string().max(60), id: UUID, kind: z.enum(["comment", "work_note"]), body: z.string().min(1).max(100_000), skill: z.string().max(80).optional() });
const recordPayload = z.object({ table: z.string().max(60), data: z.record(z.string(), z.unknown()), from: z.object({ table: z.string().max(60), id: UUID }).optional(), skill: z.string().max(80).optional() });

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The suggested values, applied with the person's own access — unless one of those fields changed since. */
async function applyFields(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(fieldsPayload, payload);
  const cur = await get(ctx, p.table, p.id); // 404 unless the person reads it
  const def = tableDef(p.table);
  for (const [k, before] of Object.entries(p.snapshot)) {
    if (!same(cur.row[k], before)) throw conflict(`«${def?.fields.find((f) => f.name === k)?.label ?? k}» پس از این پیشنهاد تغییر کرده است؛ مهارت را دوباره اجرا کنید`);
  }
  const r = await update(ctx, p.table, p.id, p.data, { version: cur.row.version as number });
  return recordRef(p.table, p.id, r.display[p.id] ?? String(r.row.number ?? def?.label ?? ""));
}

/** The drafted note or reply, posted by the person (a public reply is sent only because a person applied it). */
async function applyJournal(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(journalPayload, payload);
  const cur = await get(ctx, p.table, p.id);
  await addJournal(ctx, p.table, p.id, { kind: p.kind, body: p.body });
  return recordRef(p.table, p.id, cur.display[p.id] ?? String(cur.row.number ?? ""));
}

/** The drafted record, created by the person with their own access. */
async function applyRecord(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(recordPayload, payload);
  if (p.from) await get(ctx, p.from.table, p.from.id);
  const r = await create(ctx, p.table, p.data);
  const id = String(r.row.id);
  return recordRef(p.table, id, r.display[id] ?? String(r.row.number ?? ""));
}

let installed = false;
export function installSkillExecutors(): void {
  if (installed) return;
  installed = true;
  registerProposalExecutor("skill.fields", applyFields);
  registerProposalExecutor("skill.journal", applyJournal);
  registerProposalExecutor("skill.record", applyRecord);
}
