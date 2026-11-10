// Executors of the generated record tools' proposals (docs/spec/AI.md §11.8). They run with the CONFIRMING person's
// context through the record service: their access, the table's rules, locks and transitions are checked again exactly
// as from the form. A proposal fails closed — when the person may not read or change the record any more, when a field
// it changes moved since the draft (snapshot) or, in a batch, when the record changed since (its version), nothing of
// that record is written. A batch writes each record in its own transaction, reports every row and never stops at a
// failed one.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { AiProposalOutcome, AiRef } from "@shared/ai/types";
import { formatNumber } from "@shared/format";
import { addLink, create, get, orgSchema, transitionIn, updateIn } from "../../../engine";
import { AppError, bad, conflict, notFound } from "../../../http/errors";
import { parsePayload, registerProposalExecutor, type ProposalOutcome } from "./proposals";
import { journalIn, problemText, recordPath } from "./records";

const UUID = z.string().regex(/^[0-9a-f-]{36}$/i);
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const NOTE_KIND = z.enum(["work_note", "comment"]);

const createP = z.object({ table: TABLE, data: z.record(z.string(), z.unknown()) });
const updateP = z.object({ table: TABLE, id: UUID, data: z.record(z.string(), z.unknown()), snapshot: z.record(z.string(), z.unknown()) });
const transitionP = z.object({
  table: TABLE, id: UUID, to: z.string().max(60), data: z.record(z.string(), z.unknown()), note: z.string().max(20_000).nullable(), note_kind: NOTE_KIND,
  snapshot: z.record(z.string(), z.unknown()),
});
const journalP = z.object({ table: TABLE, id: UUID, kind: NOTE_KIND, body: z.string().min(1).max(20_000) });
const linkP = z.object({ table: TABLE, id: UUID, kind: z.string().max(40), to_table: TABLE, to_id: UUID, note: z.string().max(500).nullable() });
const batchP = z.object({
  table: TABLE, action: z.enum(["update", "transition", "note"]), ids: z.array(UUID).min(1).max(500), snapshots: z.record(z.string(), z.record(z.string(), z.unknown())),
  data: z.record(z.string(), z.unknown()), to: z.string().max(60).nullable(), note: z.string().max(20_000).nullable(), note_kind: NOTE_KIND,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function defOf(ctx: Ctx, table: string) {
  const def = (await orgSchema(ctx)).def(table);
  if (!def || def.virtual) throw bad("جدول این پیشنهاد شناخته نیست");
  return def;
}

function refOf(table: string, id: string, label: string): AiRef {
  return { type: table, id, label, path: recordPath(table, id) };
}

/** The record as the person reads it now, with the fields of the snapshot unchanged since the draft. */
async function current(ctx: Ctx, table: string, id: string, snapshot: Record<string, unknown>) {
  const cur = await get(ctx, table, id); // 404 unless the person may read it now
  const def = await defOf(ctx, table);
  for (const [k, before] of Object.entries(snapshot)) {
    if (!same(cur.row[k], before)) throw conflict(`«${def.fields.find((f) => f.name === k)?.label ?? k}» پس از این پیشنهاد تغییر کرده است؛ دوباره بخواهید`);
  }
  return { cur, def };
}

async function applyCreate(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(createP, payload);
  const r = await create(ctx, p.table, p.data);
  const id = String(r.row.id);
  return refOf(p.table, id, [r.row.number, r.display[id]].filter(Boolean).join(" — ") || String(r.row.number ?? ""));
}

async function applyUpdate(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(updateP, payload);
  const { cur } = await current(ctx, p.table, p.id, p.snapshot);
  await ctx.write((tx) => updateIn(tx, ctx, p.table, p.id, p.data, { version: cur.row.version as number }));
  return refOf(p.table, p.id, [cur.row.number, cur.display[p.id]].filter(Boolean).join(" — "));
}

async function applyTransition(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(transitionP, payload);
  const { cur, def } = await current(ctx, p.table, p.id, p.snapshot);
  await ctx.write(async (tx) => {
    await transitionIn(tx, ctx, p.table, p.id, p.to, p.data, { version: cur.row.version as number });
    if (p.note && def.features?.journal) await journalIn(tx, ctx, def, p.id, { kind: p.note_kind, body: p.note });
  });
  return refOf(p.table, p.id, [cur.row.number, cur.display[p.id]].filter(Boolean).join(" — "));
}

async function applyJournal(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(journalP, payload);
  const def = await defOf(ctx, p.table);
  const cur = await get(ctx, p.table, p.id);
  await ctx.write((tx) => journalIn(tx, ctx, def, p.id, { kind: p.kind, body: p.body }));
  return refOf(p.table, p.id, [cur.row.number, cur.display[p.id]].filter(Boolean).join(" — "));
}

async function applyLink(ctx: Ctx, payload: unknown): Promise<AiRef> {
  const p = parsePayload(linkP, payload);
  const cur = await get(ctx, p.table, p.id);
  await addLink(ctx, p.table, p.id, { kind: p.kind, table: p.to_table, id: p.to_id, note: p.note });
  return refOf(p.table, p.id, [cur.row.number, cur.display[p.id]].filter(Boolean).join(" — "));
}

/** Every record of a batch on its own: the person's access, the fields it changes unchanged since the draft, then the write. */
async function applyBatch(ctx: Ctx, payload: unknown): Promise<ProposalOutcome> {
  const p = parsePayload(batchP, payload);
  const def = await defOf(ctx, p.table);
  const outcome: AiProposalOutcome = { ok: 0, failed: 0, rows: [] };
  for (const id of p.ids) {
    let label = id.slice(0, 8);
    try {
      const cur = await get(ctx, p.table, id); // fails closed when the person may not read it now
      label = String(cur.row.number ?? cur.display[id] ?? label);
      for (const [k, before] of Object.entries(p.snapshots[id] ?? {})) {
        if (!same(cur.row[k], before)) throw conflict(`«${def.fields.find((f) => f.name === k)?.label ?? k}» پس از این پیشنهاد تغییر کرده است`);
      }
      await ctx.write(async (tx) => {
        if (p.action === "transition" && p.to) await transitionIn(tx, ctx, p.table, id, p.to, p.data, { version: cur.row.version as number });
        else if (Object.keys(p.data).length) await updateIn(tx, ctx, p.table, id, p.data, { version: cur.row.version as number });
        if (p.note && def.features?.journal) await journalIn(tx, ctx, def, id, { kind: p.note_kind, body: p.note });
      });
      outcome.ok++;
      outcome.rows.push({ label, ok: true, path: recordPath(p.table, id) });
    } catch (e) {
      outcome.failed++;
      const message = e instanceof AppError && e.status === 404 ? "در دسترس شما نیست" : problemText(e);
      outcome.rows.push({ label, ok: false, message });
    }
  }
  if (!outcome.ok && !outcome.failed) throw notFound("رکوردی برای این پیشنهاد نماند");
  const ref: AiRef = { type: p.table, id: "batch", label: `${formatNumber(outcome.ok)} از ${formatNumber(p.ids.length)} ${def.label} ثبت شد`, path: `r/${p.table}` };
  return { ref, outcome };
}

let installed = false;
/** The executors of the generated record tools' proposals (installed with the assistant's tools). */
export function installRecordExecutors(): void {
  if (installed) return;
  installed = true;
  registerProposalExecutor("record.create", applyCreate);
  registerProposalExecutor("record.update", applyUpdate);
  registerProposalExecutor("record.transition", applyTransition);
  registerProposalExecutor("record.journal", applyJournal);
  registerProposalExecutor("record.link", applyLink);
  registerProposalExecutor("record.batch", applyBatch);
}
