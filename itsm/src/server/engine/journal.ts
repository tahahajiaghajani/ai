// The journal of a record (sm_journal): comments, work notes, e-mails, approvals, system and AI notes — the activity
// stream next to the field history. Visibility is "public" (the requester sees it) or "internal" (work notes:
// only callers whose roles carry the `internal` field group, asked of the access provider — for reading and for
// writing). Through the API callers add comments and work notes; the other kinds come from server code
// (`trusted`). Adding an entry emits `record.commented`; a public comment by someone other than the requester
// stamps a task's first_response_at.
import type { TableDef } from "@shared/model/types";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../context";
import type { Queryable, Tx } from "../db";
import { pgArray } from "../db";
import { bad, forbidden } from "../http/errors";
import { access } from "../access/provider";
import { actorId, condEnv } from "./env";
import { defFor } from "./schema";
import { RefSet, resolveDisplay } from "./display";
import { requireReadable, type Row } from "./read";
import { emitEvent } from "./events";
import { writeHistory } from "./history";

export const JOURNAL_KINDS = {
  comment: "پاسخ",
  work_note: "یادداشت داخلی",
  system: "سامانه",
  email_in: "ایمیل دریافتی",
  email_out: "ایمیل ارسالی",
  approval: "تأیید",
  ai: "دستیار هوشمند",
} as const;
export type JournalKind = keyof typeof JOURNAL_KINDS;
export type Visibility = "public" | "internal";

/** Default visibility per kind (comment is always public, work_note always internal). */
const DEFAULT_VISIBILITY: Record<JournalKind, Visibility> = {
  comment: "public",
  work_note: "internal",
  system: "public",
  email_in: "public",
  email_out: "public",
  approval: "internal",
  ai: "internal",
};

export const JOURNAL_BODY_MAX = 100_000;

export interface JournalInput {
  kind?: JournalKind;
  body: string;
  visibility?: Visibility;
  /** structured extras (an e-mail's headers, an approval's decision…) */
  data?: Record<string, unknown> | null;
  /** ids of attachments of the same record shown with the entry */
  attachments?: string[];
}

export interface JournalEntry {
  id: string;
  kind: JournalKind;
  visibility: Visibility;
  body: string;
  author: string | null;
  created_at: string;
  data: Record<string, unknown> | null;
  attachments: { id: string; name: string; mime: string; size: number }[];
}

function needJournal(def: TableDef) {
  if (!def.features?.journal) throw bad(`«${def.plural}» یادداشت و پاسخ ندارد`);
}

/**
 * Add an entry inside `tx` to a record the caller may read (`row` = the loaded record). Server code passes
 * `trusted` for kinds other than comment/work_note.
 */
export async function addJournalIn(tx: Tx, ctx: Ctx, def: TableDef, row: Row, input: JournalInput, opts: { trusted?: boolean; author?: string | null } = {}): Promise<JournalEntry> {
  needJournal(def);
  const kind: JournalKind = input.kind ?? "comment";
  if (!(kind in JOURNAL_KINDS)) throw bad("نوع یادداشت معتبر نیست");
  if (!opts.trusted && kind !== "comment" && kind !== "work_note") throw forbidden("این نوع یادداشت را فقط سامانه ثبت می‌کند");
  const visibility: Visibility = kind === "comment" ? "public" : kind === "work_note" ? "internal" : input.visibility ?? DEFAULT_VISIBILITY[kind];
  if (visibility === "internal" && !opts.trusted && !access().hasFieldGroup(ctx, "internal")) throw forbidden("اجازهٔ ثبت یادداشت داخلی را ندارید");
  const body = String(input.body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) throw bad("متن یادداشت خالی است");
  if (body.length > JOURNAL_BODY_MAX) throw bad(`متن یادداشت حداکثر ${JOURNAL_BODY_MAX.toLocaleString("fa-IR")} نویسه است`);
  const attachments = [...new Set(input.attachments ?? [])].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  if (attachments.length) {
    const found = await tx.query<{ id: string }>(
      `select id from sm_attachments where org_id = $1 and table_key = $2 and record_id = $3 and id = any($4::uuid[]) and deleted_at is null`,
      [ctx.org.id, def.key, row.id, pgArray(attachments)],
    );
    if (found.length !== attachments.length) throw bad("پیوست انتخاب‌شده متعلق به این رکورد نیست");
  }
  const author = opts.author !== undefined ? opts.author : actorId(ctx);
  const entry = await tx.one<Row>(
    `insert into sm_journal (id, org_id, table_key, record_id, kind, visibility, body, author, data, attachments, origin)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11) returning *`,
    [uuidv7(), ctx.org.id, def.key, row.id, kind, visibility, body, author, input.data ? JSON.stringify(input.data) : null, JSON.stringify(attachments), ctx.cfg.origin ?? null],
  );
  // a task's first response: the first public comment of someone other than the requester
  if (kind === "comment" && author && def.fields.some((f) => f.name === "first_response_at") && !row.first_response_at) {
    const own = [row.caller_id, row.requested_for].filter(Boolean);
    if (!own.includes(author)) {
      const stamped = await tx.one<Row>(`update ${def.table} set first_response_at = now() where id = $1 and org_id = $2 and first_response_at is null returning first_response_at`, [row.id, ctx.org.id]);
      if (stamped) await writeHistory(tx, ctx, def, row.id, { first_response_at: null }, stamped, ["first_response_at"]);
    }
  }
  await emitEvent(tx, ctx, {
    kind: "record.commented",
    table: def.key,
    id: String(row.id),
    number: def.numbered ? row.number ?? null : null,
    entry: { id: entry!.id, kind, visibility },
    actor: author,
  });
  return (await shape(tx, ctx, [entry!]))[0];
}

/** Add a comment or a work note to a record (the caller must be able to read it). */
export async function addJournal(ctx: Ctx, table: string, id: string, input: JournalInput, opts: { trusted?: boolean } = {}): Promise<{ entry: JournalEntry; display: Record<string, string> }> {
  const { def, schema } = await defFor(ctx, table);
  needJournal(def);
  const env = await condEnv(ctx);
  const entry = await ctx.write(async (tx) => {
    const row = await requireReadable(ctx, def, id, env, tx);
    return addJournalIn(tx, ctx, def, row, input, opts);
  });
  const refs = new RefSet();
  refs.add("user", entry.author);
  return { entry, display: await resolveDisplay(ctx.db, ctx, env, schema, refs) };
}

async function shape(q: Queryable, ctx: Ctx, rows: Row[]): Promise<JournalEntry[]> {
  const ids = [...new Set(rows.flatMap((r) => (Array.isArray(r.attachments) ? r.attachments : [])))];
  const files = ids.length
    ? await q.query<{ id: string; name: string; mime: string; size: number }>(
      `select id, name, mime, size from sm_attachments where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
      [ctx.org.id, pgArray(ids)],
    )
    : [];
  const byId = new Map(files.map((f) => [f.id, f]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    visibility: r.visibility,
    body: r.body,
    author: r.author ?? null,
    created_at: r.created_at,
    data: r.data ?? null,
    attachments: (Array.isArray(r.attachments) ? r.attachments : []).map((x: string) => byId.get(x)).filter(Boolean) as JournalEntry["attachments"],
  }));
}

/** The journal of a record, oldest first; internal entries only for callers with the `internal` field group. */
export async function listJournal(ctx: Ctx, table: string, id: string, opts: { kinds?: JournalKind[]; limit?: number; before?: string } = {}): Promise<{ entries: JournalEntry[]; display: Record<string, string> }> {
  const { def, schema } = await defFor(ctx, table);
  needJournal(def);
  const env = await condEnv(ctx);
  await requireReadable(ctx, def, id, env);
  const params: unknown[] = [ctx.org.id, def.key, id];
  const where = ["org_id = $1", "table_key = $2", "record_id = $3", "deleted_at is null"];
  if (!access().hasFieldGroup(ctx, "internal")) where.push(`visibility = 'public'`);
  if (opts.kinds?.length) {
    params.push(pgArray(opts.kinds.filter((k) => k in JOURNAL_KINDS)));
    where.push(`kind = any($${params.length}::text[])`);
  }
  if (opts.before) {
    params.push(opts.before);
    where.push(`created_at < $${params.length}::timestamptz`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const rows = await ctx.db.query<Row>(`select * from sm_journal where ${where.join(" and ")} order by created_at desc, id desc limit ${limit}`, params);
  const entries = await shape(ctx.db, ctx, rows.reverse());
  const refs = new RefSet();
  for (const e of entries) refs.add("user", e.author);
  return { entries, display: await resolveDisplay(ctx.db, ctx, env, schema, refs) };
}
