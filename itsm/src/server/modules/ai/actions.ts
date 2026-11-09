// Proposals: writes the assistant prepared (sm_ai_actions). Nothing changes until a permitted
// person confirms one: confirming re-checks the proposal's own area/level, runs the executor of
// stream D (the normal service, inside its own ctx.write), and writes an «ai_action» audit row
// with the confirming person as the actor. Confirming twice returns the first result; proposals
// expire after 24 hours.
import { createHash } from "node:crypto";
import type { Ctx } from "../../context";
import type { AiProposal, AiProposalOutcome, AiProposalStatus, AiRef } from "@shared/ai/types";
import type { AiActionView } from "@shared/ai/api";
import type { Area, Level } from "@shared/permissions";
import { uuidv7 } from "@shared/id";
import { pgArray } from "../../db";
import { AppError, conflict, forbidden, notFound } from "../../http/errors";
import { audit } from "../data/crud";
import { tableDef } from "@shared/tables";
import type { FieldGroup } from "@shared/model/types";
import { access } from "../../access/provider";
import { readableIds } from "../../access/service";
import type { AiProposalInput } from "./tools/registry";
import { executeProposalFull, isOutcome } from "./tools/proposals";
import { liveRow, liveRows, sysOf } from "../incident/common";
import { condEnv, orgSchema } from "../../engine";

export const PROPOSAL_TTL_MS = 24 * 3600 * 1000;

interface ActionRow {
  id: string;
  org_id: string;
  thread_id: string | null;
  message_id: string | null;
  user_id: string;
  kind: string;
  tool: string | null;
  area: Area;
  level: Level;
  payload: unknown;
  payload_hash: string;
  preview: Omit<AiProposal, "id" | "kind" | "status" | "expires_at" | "result" | "error">;
  status: AiProposalStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  result: AiRef | null;
  error: string | null;
  expires_at: string;
  created_at: string;
  /** a skill's proposal: the record it would change and the fields it touches (null for the assistant's) */
  record_table: string | null;
  record_id: string | null;
  fields: string[] | null;
  skill_run_id: string | null;
  principal: string | null;
  /** an agent's proposal: the agent and its run (docs/spec/AI.md §11.8) */
  agent_id: string | null;
  agent_run_id: string | null;
  /** whom it is routed to (the «پیشنهادهای هوش مصنوعی» inbox) */
  route_users: string[] | null;
  route_groups: string[] | null;
  /** only the people it is routed to may apply it (an agent's «اقدام پس از تأیید») */
  route_only: boolean | null;
  /** what applying it did, row by row */
  outcome: AiProposalOutcome | null;
}

type Preview = ActionRow["preview"] & { count?: number; agent?: { key: string; name: string } | null };

const COLS = `id, org_id, thread_id, message_id, user_id, kind, tool, area, level, payload, payload_hash, preview, status, confirmed_by, confirmed_at, result, error, expires_at, created_at, record_table, record_id, fields, skill_run_id, principal, agent_id, agent_run_id, route_users, route_groups, route_only, outcome`;

/** JSON with object keys sorted at every level: the same text before and after a jsonb round trip (which reorders keys). */
function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
    }
    return v;
  };
  // the JSON round trip first drops undefined fields and turns dates into strings, as storing does
  return JSON.stringify(norm(JSON.parse(JSON.stringify(value ?? null))));
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function effectiveStatus(r: ActionRow): AiProposalStatus {
  return r.status === "proposed" && Date.parse(r.expires_at) <= Date.now() ? "expired" : r.status;
}

export function toProposal(r: ActionRow): AiProposal {
  const p = r.preview as Preview;
  return {
    id: r.id,
    kind: r.kind,
    title_fa: p.title_fa,
    summary_fa: p.summary_fa,
    preview: p.preview ?? [],
    ...(p.lines ? { lines: p.lines } : {}),
    ...(p.line_headers ? { line_headers: p.line_headers } : {}),
    ...(p.warnings?.length ? { warnings: p.warnings } : {}),
    status: effectiveStatus(r),
    ...(p.edit_path ? { edit_path: p.edit_path } : {}),
    result: r.result ?? null,
    error: r.error ?? null,
    expires_at: r.expires_at,
    ...(typeof p.count === "number" ? { count: p.count } : {}),
    ...(r.outcome ? { outcome: r.outcome } : {}),
    ...(p.agent ? { agent: p.agent } : {}),
    ...(r.record_table ? { record: { table: r.record_table, id: r.record_id } } : {}),
  };
}

/** Whom a proposal is routed to and which agent made it (agents, docs/spec/AI.md §11.8). */
export interface ProposalRouting {
  agent?: { id: string; key: string; name: string; run_id: string | null } | null;
  users?: string[];
  groups?: string[];
  /** only the people routed to may apply it (they still need to read the record and every field involved) */
  only?: boolean;
}

const uuidList = (xs: readonly string[] | undefined) => [...new Set((xs ?? []).filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).map((x) => x.toLowerCase()))];

function previewOf(p: AiProposalInput & { count?: number }, agent: ProposalRouting["agent"]): Preview {
  return {
    title_fa: p.title_fa,
    summary_fa: p.summary_fa,
    preview: p.preview,
    lines: p.lines,
    line_headers: p.line_headers,
    warnings: p.warnings,
    edit_path: p.edit_path,
    ...(typeof p.count === "number" ? { count: p.count } : {}),
    ...(agent ? { agent: { key: agent.key, name: agent.name } } : {}),
  };
}

/**
 * Store a proposal returned by a tool (one per tool call: a retried step never doubles it). A proposal about records
 * (`proposal.record`: the generated record tools) is visible only to people who may read that record — or, for a batch,
 * every record it names — and every field involved; it is still applied by a person with their own access.
 */
export async function storeProposal(
  ctx: Ctx,
  c: { threadId: string | null; messageId: string | null; callId: string; tool: string; proposal: AiProposalInput; key?: string; routing?: ProposalRouting; ttlHours?: number },
): Promise<AiProposal> {
  const p = c.proposal;
  const id = uuidv7();
  // the step's message id is part of the key: providers that omit tool-call ids get made-up ones
  // (call_0_…) that repeat in later turns of the same conversation
  const key = createHash("sha256").update(c.key ?? `${ctx.org.id}:${c.threadId}:${c.messageId}:${c.callId}`).digest("hex");
  const agent = c.routing?.agent ?? null;
  const preview = previewOf(p, agent);
  const rec = p.record ?? null;
  const hours = Math.max(1, Math.min(24 * 30, Math.round(c.ttlHours ?? 24)));
  const row = await ctx.write(
    async (tx) => {
      await tx.query(
        `insert into sm_ai_actions (id, org_id, thread_id, message_id, user_id, kind, tool, area, level, payload, payload_hash, preview, idempotency_key, expires_at,
                                    record_table, record_id, fields, principal, agent_id, agent_run_id, route_users, route_groups, route_only)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, now() + ($14 || ' hours')::interval,
                 $15, $16, $17::text[], $18, $19, $20, $21::uuid[], $22::uuid[], $23)
         on conflict (idempotency_key) do nothing`,
        [
          id, ctx.org.id, c.threadId, c.messageId, ctx.user.id, p.kind, c.tool, p.area, p.level, JSON.stringify(p.payload ?? null), hashPayload(p.payload), JSON.stringify(preview), key, String(hours),
          rec?.table ?? null, rec?.id ?? null, rec ? pgArray([...new Set(rec.fields ?? [])]) : null, agent ? "service" : rec ? "person" : null,
          agent?.id ?? null, agent?.run_id ?? null, pgArray(uuidList(c.routing?.users)), pgArray(uuidList(c.routing?.groups)), !!c.routing?.only,
        ],
      );
      return tx.one<ActionRow>(`select ${COLS} from sm_ai_actions where idempotency_key = $1`, [key]);
    },
    { internal: true },
  );
  // a proposal on records says whether its author may decide it (the same rule as a skill's: they work the record)
  return row!.record_table ? { ...toProposal(row!), can_decide: await canDecide(ctx, row!) } : toProposal(row!);
}

/** What a skill hands over to be stored as a proposal on a record (see ./skills/proposals.ts). */
export interface RecordProposalInput extends AiProposalInput {
  record: { table: string; id: string };
  /** fields the proposal reads or changes: only people who see all of them see the proposal */
  fields: string[];
  run_id: string | null;
  principal: "person" | "service";
  /** hours until it expires (default 24; proposals of triggered skills wait longer) */
  ttl_hours?: number;
  /** an agent's proposal and whom it is routed to */
  routing?: ProposalRouting;
}

/**
 * Store a skill's proposal on a record (one per run and kind: a retried job never doubles it). A proposer keeps one
 * open proposal per skill, kind and record: when the same proposal is still open nothing new is stored (a scheduled or
 * event re-run on an unchanged record), and a different one replaces the open one (it expires as superseded).
 */
export async function storeRecordProposal(ctx: Ctx, p: RecordProposalInput): Promise<AiProposal> {
  const id = uuidv7();
  const key = createHash("sha256").update(`${ctx.org.id}:skill:${p.run_id ?? id}:${p.kind}`).digest("hex");
  const agent = p.routing?.agent ?? null;
  const preview = previewOf(p, agent);
  const hours = Math.max(1, Math.min(24 * 30, Math.round(p.ttl_hours ?? 24)));
  const skill = p.payload && typeof p.payload === "object" ? String((p.payload as Record<string, unknown>).skill ?? "") : "";
  const hash = hashPayload(p.payload);
  const row = await ctx.write(
    async (tx) => {
      const open = await tx.query<ActionRow>(
        `select ${COLS} from sm_ai_actions
         where org_id = $1 and record_table = $2 and record_id = $3 and kind = $4 and user_id = $5 and coalesce(payload->>'skill', '') = $6
           and status = 'proposed' and expires_at > now() and idempotency_key <> $7`,
        [ctx.org.id, p.record.table, p.record.id, p.kind, ctx.user.id, skill, key],
      );
      const same = open.find((o) => o.payload_hash === hash);
      if (same) return same;
      if (open.length) {
        await tx.query(`update sm_ai_actions set status = 'expired', error = $2, updated_at = now() where id = any($1::uuid[]) and status = 'proposed'`, [
          pgArray(open.map((o) => o.id)),
          "پیشنهاد تازه‌تری جای آن را گرفت",
        ]);
      }
      await tx.query(
        `insert into sm_ai_actions (id, org_id, thread_id, message_id, user_id, kind, tool, area, level, payload, payload_hash, preview, idempotency_key, expires_at,
                                    record_table, record_id, fields, skill_run_id, principal, agent_id, agent_run_id, route_users, route_groups, route_only)
         values ($1, $2, null, null, $3, $4, 'skill', $5, $6, $7::jsonb, $8, $9::jsonb, $10, now() + ($11 || ' hours')::interval, $12, $13, $14::text[], $15, $16,
                 $17, $18, $19::uuid[], $20::uuid[], $21)
         on conflict (idempotency_key) do nothing`,
        [
          id, ctx.org.id, ctx.user.id, p.kind, p.area, p.level, JSON.stringify(p.payload ?? null), hashPayload(p.payload), JSON.stringify(preview), key, String(hours),
          p.record.table, p.record.id, pgArray([...new Set(p.fields)]), p.run_id, p.principal,
          agent?.id ?? null, agent?.run_id ?? null, pgArray(uuidList(p.routing?.users)), pgArray(uuidList(p.routing?.groups)), !!p.routing?.only,
        ],
      );
      return tx.one<ActionRow>(`select ${COLS} from sm_ai_actions where idempotency_key = $1`, [key]);
    },
    { internal: true },
  );
  return { ...toProposal(row!), can_decide: await canDecide(ctx, row!) };
}

/** Something AI produced from a record and other sources: a skill's proposal or a stored run. */
export interface ClearedItem {
  key: string;
  /** the record it was made from (null: a run on a text) */
  table: string | null;
  id: string | null;
  /** what it read (see `clearanceOf`); null: unknown (a run stored before runs kept it) */
  tokens: string[] | null;
  /** a batch proposal: it names no single record (`id` null); every record it changes is an `@r:` token */
  batch?: boolean;
}

/**
 * Which items the caller may read now, with their own access: the record (readable), and every token — a field of the
 * record (visible), `@g:<group>` (carried), `@f:<table>:<field>` (visible), `@r:<table>:<id>` (readable). Unknown
 * tokens (null) pass only when `unknownOk` says so. One readable-ids query per table, whatever the number of items.
 */
export async function clearedItems(ctx: Ctx, items: ClearedItem[], unknownOk: (item: ClearedItem) => boolean = () => false): Promise<Set<string>> {
  // the organisation's definitions: the engine's columns (number, created_at…) and custom fields are fields there, as
  // when the run listed what it read
  const schema = await orgSchema(ctx);
  const tableDef = (t: string) => schema.def(t) ?? null;
  const wanted = new Map<string, Set<string>>();
  const want = (t: string, id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !tableDef(t)) return;
    if (!wanted.has(t)) wanted.set(t, new Set());
    wanted.get(t)!.add(id.toLowerCase());
  };
  for (const it of items) {
    if (it.table && it.id) want(it.table, it.id);
    for (const f of it.tokens ?? []) {
      if (!f.startsWith("@r:")) continue;
      const [, t, sid] = f.split(":");
      if (t && sid) want(t, sid);
    }
  }
  const readable = new Map<string, Set<string>>();
  for (const [t, ids] of wanted) readable.set(t, await readableIds(ctx, t, [...ids]).catch(() => new Set<string>()));
  const reads = (t: string, id: string) => !!readable.get(t)?.has(id.toLowerCase());
  const out = new Set<string>();
  for (const it of items) {
    const def = it.table ? tableDef(it.table) : null;
    if (it.table && (!def || def.virtual)) continue;
    if (it.table && (it.id ? !reads(it.table, it.id) : !(it.batch && (it.tokens ?? []).some((f) => f.startsWith("@r:"))))) continue;
    if (!it.tokens) {
      if (unknownOk(it)) out.add(it.key);
      continue;
    }
    const visible = def ? access().visibleFields(ctx, def) : null;
    let ok = true;
    for (const f of it.tokens) {
      if (f.startsWith("@g:")) ok = access().hasFieldGroup(ctx, f.slice(3) as FieldGroup);
      else if (f.startsWith("@f:")) {
        const [, t, name] = f.split(":");
        const other = t ? tableDef(t) : null;
        const seen = other ? access().visibleFields(ctx, other) : null;
        ok = !!other && !!name && !(seen && other.fields.some((x) => x.name === name) && !seen.has(name));
      } else if (f.startsWith("@r:")) {
        const [, t, sid] = f.split(":");
        ok = !!t && !!sid && reads(t, sid);
      } else ok = !def || !visible || visible.has(f);
      if (!ok) break;
    }
    if (ok) out.add(it.key);
  }
  return out;
}

/**
 * May the caller read the record of a proposal and every field it involves (their own access, now)? A batch proposal
 * names no single record: every record it changes is a `@r:` token and must be readable.
 */
async function seesRecord(ctx: Ctx, r: Pick<ActionRow, "id" | "record_table" | "record_id" | "fields">): Promise<boolean> {
  if (!r.record_table) return false;
  const seen = await clearedItems(ctx, [{ key: r.id, table: r.record_table, id: r.record_id, tokens: r.fields ?? [], batch: !r.record_id }]);
  return seen.has(r.id);
}

/** The fields a proposal changes on its record(s), and the note it posts (kind), by proposal kind. */
function changeOf(kind: string, p: Record<string, unknown>): { fields: string[]; note: string | null } {
  const keys = (x: unknown) => (x && typeof x === "object" ? Object.keys(x as object) : []);
  switch (kind) {
    case "skill.fields":
    case "record.update":
      return { fields: keys(p.data), note: null };
    case "record.transition":
      return { fields: keys(p.data), note: p.note ? String(p.note_kind ?? "work_note") : null };
    case "record.batch":
      return { fields: p.action === "note" ? [] : keys(p.data), note: p.note || p.action === "note" ? String(p.note_kind ?? "work_note") : null };
    case "skill.journal":
    case "record.journal":
      return { fields: [], note: String(p.kind ?? "work_note") };
    default:
      return { fields: [], note: null };
  }
}

/**
 * May the caller make the change a proposal on a record describes, themselves: they work the record (full write — not
 * a requester's own fields, not only reading it; a batch: every record it names), may set every field it changes, may
 * post its note (an internal one needs «internal»), may create the record it drafts. Reading the record is not enough
 * to apply — or to reject — it. The same rule holds for skills, the assistant's record tools and AI agents.
 */
async function mayApply(ctx: Ctx, r: ActionRow): Promise<boolean> {
  const schema = await orgSchema(ctx);
  const def = r.record_table ? schema.def(r.record_table) : null;
  if (!def || def.virtual) return false;
  const p = (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>;
  const ids = r.record_id ? [r.record_id] : r.kind === "record.batch" && Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === "string") : [];
  if (!ids.length) return false;
  const prov = access();
  await prov.prepare?.(ctx, ctx.db);
  const rows = r.record_id
    ? [await liveRow(ctx.db, sysOf(ctx), def.key, r.record_id)].filter((x): x is NonNullable<typeof x> => !!x)
    : await liveRows(ctx.db, sysOf(ctx), def.key, { f: "id", op: "in", v: ids });
  if (rows.length !== new Set(ids.map((x) => x.toLowerCase())).size) return false;
  const change = changeOf(r.kind, p);
  if (change.note === "work_note" && !prov.hasFieldGroup(ctx, "internal")) return false;
  for (const row of rows) {
    const mode = prov.writeMode ? prov.writeMode(ctx, def, row) : prov.canWrite(ctx, def, row) ? "full" : null;
    if (mode !== "full") return false;
    if (change.fields.length) {
      const writable = prov.writableFields(ctx, def, row);
      if (writable && change.fields.some((f) => !writable.has(f))) return false;
    }
  }
  if (r.kind === "skill.record") {
    const t = typeof p.table === "string" ? schema.def(p.table) : null;
    return !!t && !t.virtual && prov.canCreate(ctx, t);
  }
  return true;
}

/** Open proposals of skills on one record that the caller may see (the record's «هوش مصنوعی» panel). */
export async function recordProposals(ctx: Ctx, table: string, id: string): Promise<AiProposal[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  const rows = await ctx.db.query<ActionRow>(
    `select ${COLS} from sm_ai_actions where org_id = $1 and record_table = $2 and record_id = $3 and status = 'proposed' and expires_at > now() order by created_at desc limit 30`,
    [ctx.org.id, table, id.toLowerCase()],
  );
  const out: AiProposal[] = [];
  for (const r of rows) if (await canSee(ctx, r)) out.push({ ...toProposal(r), can_decide: await canDecide(ctx, r) });
  return out;
}

export async function proposalViews(ctx: Ctx, ids: string[]): Promise<AiProposal[]> {
  if (!ids.length) return [];
  const rows = await ctx.db.query<ActionRow>(`select ${COLS} from sm_ai_actions where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, pgArray(ids)]);
  return rows.map(toProposal);
}

async function actionRow(ctx: Ctx, id: string): Promise<ActionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("پیشنهاد پیدا نشد");
  const r = await ctx.db.one<ActionRow>(`select ${COLS} from sm_ai_actions where org_id = $1 and id = $2`, [ctx.org.id, id]);
  if (!r) throw notFound("پیشنهاد پیدا نشد");
  return r;
}

/**
 * Who sees a proposal. A skill's proposal on a record: whoever may read that record and every field it involves, now —
 * its author included, and an AI manager without that access does not. The assistant's: its author or an AI manager.
 */
async function canSee(ctx: Ctx, r: ActionRow): Promise<boolean> {
  if (r.record_table) return seesRecord(ctx, r);
  return r.user_id === ctx.user.id || ctx.can("ai", "full");
}

/**
 * May the caller decide about this proposal: the assistant's — its author or an AI manager, with the document's own
 * level; a skill's — whoever sees it, may use AI and may make its change themselves (`mayApply`: they work the record;
 * the write is applied with that person's own access, checked again).
 */
async function canDecide(ctx: Ctx, r: ActionRow): Promise<boolean> {
  if (r.route_only && !(await routedTo(ctx, r))) return false;
  if (r.record_table) return ctx.can("ai", "view") && ctx.can(r.area, r.level) && (await seesRecord(ctx, r)) && (await mayApply(ctx, r));
  return (r.user_id === ctx.user.id || ctx.can("ai", "full")) && ctx.can(r.area, r.level);
}

/** Is the caller one of the people a proposal is routed to (named, or a member of a named group)? */
async function routedTo(ctx: Ctx, r: Pick<ActionRow, "route_users" | "route_groups">): Promise<boolean> {
  if ((r.route_users ?? []).includes(ctx.user.id)) return true;
  if (!(r.route_groups ?? []).length) return false;
  const env = await condEnv(ctx);
  return (env.groups ?? []).some((g) => (r.route_groups ?? []).includes(g));
}

async function assertVisible(ctx: Ctx, r: ActionRow): Promise<void> {
  if (!(await canSee(ctx, r))) throw notFound("پیشنهاد پیدا نشد");
}

const STATUS_FA: Record<AiProposalStatus, string> = {
  proposed: "در انتظار تأیید",
  executing: "در حال اجرا",
  executed: "انجام شده",
  rejected: "رد شده",
  expired: "منقضی شده",
  failed: "ناموفق",
};

export async function confirmAction(ctx: Ctx, id: string): Promise<AiProposal> {
  ctx.need("ai", "view");
  let r = await actionRow(ctx, id);
  await assertVisible(ctx, r);
  if (!(await canDecide(ctx, r))) throw forbidden(r.record_table ? "برای اعمال این پیشنهاد باید رکورد و همهٔ فیلدهای آن را ببینید" : "برای تأیید این پیشنهاد، دسترسی همان بخش را لازم دارید");
  const status = effectiveStatus(r);
  if (status === "executed") return toProposal(r);
  if (status === "expired") {
    await ctx.write((tx) => tx.query(`update sm_ai_actions set status = 'expired', updated_at = now() where id = $1 and status = 'proposed'`, [id]), { internal: true });
    throw conflict("این پیشنهاد منقضی شده است؛ از دستیار بخواهید دوباره آماده‌اش کند");
  }
  if (status !== "proposed") throw conflict(`این پیشنهاد ${STATUS_FA[status]} است`);
  const claimed = await ctx.write(
    (tx) =>
      tx.one(
        `update sm_ai_actions set status = 'executing', confirmed_by = $2, confirmed_at = now(), updated_at = now() where id = $1 and status = 'proposed' and expires_at > now() returning id`,
        [id, ctx.user.id],
      ),
    { internal: true },
  );
  if (!claimed) {
    r = await actionRow(ctx, id);
    if (r.status === "executed") return toProposal(r);
    throw conflict(`این پیشنهاد ${STATUS_FA[effectiveStatus(r)]} است`);
  }
  if (hashPayload(r.payload) !== r.payload_hash) {
    await ctx.write((tx) => tx.query(`update sm_ai_actions set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, "داده‌های پیشنهاد دست خورده است"]), { internal: true });
    throw conflict("داده‌های پیشنهاد دست خورده است و اجرا نشد");
  }
  let ref: AiRef;
  let outcome: AiProposalOutcome | null = null;
  try {
    const done = await executeProposalFull(ctx, r.kind, r.payload);
    if (isOutcome(done)) {
      ref = done.ref;
      outcome = done.outcome;
    } else ref = done;
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "اجرای پیشنهاد ناموفق بود";
    if (!(e instanceof AppError)) ctx.cfg.log.error("ai proposal failed", String((e as Error)?.message ?? e));
    if (e instanceof AppError && e.status === 403 && r.record_table) {
      // the person may not make this change: the proposal stays open for those who may (it never fails for them)
      await ctx.write(
        (tx) => tx.query(`update sm_ai_actions set status = 'proposed', confirmed_by = null, confirmed_at = null, updated_at = now() where id = $1 and status = 'executing'`, [id]),
        { internal: true },
      );
      throw e;
    }
    await ctx.write((tx) => tx.query(`update sm_ai_actions set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, msg.slice(0, 500)]), { internal: true });
    return toProposal(await actionRow(ctx, id));
  }
  // a batch whose every row failed applied nothing: it is failed, with the rows' reasons
  const none = !!outcome && outcome.ok === 0 && outcome.failed > 0;
  await ctx.write(async (tx) => {
    await tx.query(`update sm_ai_actions set status = $3, result = $2::jsonb, outcome = $4::jsonb, error = $5, updated_at = now() where id = $1`, [
      id, JSON.stringify(ref), none ? "failed" : "executed", outcome ? JSON.stringify(outcome) : null, none ? "هیچ‌یک از ردیف‌ها ثبت نشد" : null,
    ]);
    await audit(tx, ctx, "ai_action", r.kind, /^[0-9a-f-]{36}$/i.test(ref.id) ? ref.id : null, `${r.preview.title_fa} (${r.agent_id ? "پیشنهاد عامل هوش مصنوعی" : "پیشنهاد دستیار"}، تأیید شد)`, {
      source: "ai",
      proposal_id: id,
      thread_id: r.thread_id,
      proposed_by: r.user_id,
      ...(r.agent_id ? { agent_id: r.agent_id, agent_run_id: r.agent_run_id } : {}),
      result: ref,
      ...(outcome ? { ok: outcome.ok, failed: outcome.failed } : {}),
    });
  }, { internal: true });
  return toProposal(await actionRow(ctx, id));
}

export async function rejectAction(ctx: Ctx, id: string, reason?: string): Promise<AiProposal> {
  ctx.need("ai", "view");
  const r = await actionRow(ctx, id);
  await assertVisible(ctx, r);
  if (r.user_id !== ctx.user.id && !(await canDecide(ctx, r))) throw forbidden();
  const status = effectiveStatus(r);
  if (status !== "proposed") throw conflict(`این پیشنهاد ${STATUS_FA[status]} است`);
  await ctx.write(
    (tx) => tx.query(`update sm_ai_actions set status = 'rejected', confirmed_by = $2, confirmed_at = now(), error = $3, updated_at = now() where id = $1 and status = 'proposed'`, [id, ctx.user.id, reason?.trim().slice(0, 300) || null]),
    { internal: true },
  );
  return toProposal(await actionRow(ctx, id));
}

/**
 * An agent applies its own proposal (autonomy «اقدام خودکار», an action on its whitelist): with its principal's member
 * context — the record service checks that access exactly as for a person — audited as «ai_action» with the agent and
 * its run. The proposal must be the principal's own, still open and unchanged.
 */
export async function applyByAgent(pctx: Ctx, id: string): Promise<AiProposal> {
  const r = await actionRow(pctx, id);
  if (r.user_id !== pctx.user.id || !r.agent_id) throw forbidden("این پیشنهاد از این عامل نیست");
  if (r.record_table && !(await seesRecord(pctx, r))) throw forbidden("عامل این رکورد را نمی‌بیند");
  // the same rule as a person's decision (and a skill's auto-apply): the agent's member must work the record and may
  // make every change itself; otherwise the proposal stays open for a person
  if (r.record_table && !(await mayApply(pctx, r))) return toProposal(r);
  const claimed = await pctx.write(
    (tx) => tx.one(`update sm_ai_actions set status = 'executing', confirmed_by = $2, confirmed_at = now(), updated_at = now() where id = $1 and status = 'proposed' and expires_at > now() returning id`, [id, pctx.user.id]),
    { internal: true },
  );
  if (!claimed) return toProposal(await actionRow(pctx, id));
  if (hashPayload(r.payload) !== r.payload_hash) {
    await pctx.write((tx) => tx.query(`update sm_ai_actions set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, "داده‌های پیشنهاد دست خورده است"]), { internal: true });
    return toProposal(await actionRow(pctx, id));
  }
  let ref: AiRef;
  let outcome: AiProposalOutcome | null = null;
  try {
    const done = await executeProposalFull(pctx, r.kind, r.payload);
    if (isOutcome(done)) {
      ref = done.ref;
      outcome = done.outcome;
    } else ref = done;
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "اجرای اقدام ناموفق بود";
    if (e instanceof AppError && (e.status === 403 || e.status === 409)) {
      // refused or changed meanwhile: a person decides instead (as with a skill's auto-apply)
      pctx.cfg.log.warn("ai agent auto-apply skipped", `${r.kind} ${r.record_table ?? ""}/${r.record_id ?? ""}: ${msg}`);
      await pctx.write(
        (tx) => tx.query(`update sm_ai_actions set status = 'proposed', confirmed_by = null, confirmed_at = null, updated_at = now() where id = $1 and status = 'executing'`, [id]),
        { internal: true },
      );
      return toProposal(await actionRow(pctx, id));
    }
    await pctx.write((tx) => tx.query(`update sm_ai_actions set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, msg.slice(0, 500)]), { internal: true });
    return toProposal(await actionRow(pctx, id));
  }
  await pctx.write(async (tx) => {
    await tx.query(`update sm_ai_actions set status = 'executed', result = $2::jsonb, outcome = $3::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify(ref), outcome ? JSON.stringify(outcome) : null]);
    await audit(tx, pctx, "ai_action", r.kind, /^[0-9a-f-]{36}$/i.test(ref.id) ? ref.id : null, `${r.preview.title_fa} (اقدام خودکار عامل هوش مصنوعی)`, {
      source: "ai_agent",
      proposal_id: id,
      agent_id: r.agent_id,
      agent_run_id: r.agent_run_id,
      result: ref,
    });
  }, { internal: true });
  return toProposal(await actionRow(pctx, id));
}

export async function listActions(
  ctx: Ctx,
  opts: { status?: AiProposalStatus; mine?: boolean; limit?: number; inbox?: boolean; agents?: boolean; agent?: string | null },
): Promise<AiActionView[]> {
  const params: unknown[] = [ctx.org.id];
  let where = `a.org_id = $1`;
  if (opts.inbox) {
    // «پیشنهادهای هوش مصنوعی»: routed to me (or to one of my groups) or made for me; visibility is checked below
    const env = await condEnv(ctx);
    params.push(ctx.user.id, pgArray(env.groups ?? []));
    where += ` and (a.user_id = $${params.length - 1} or $${params.length - 1}::uuid = any(coalesce(a.route_users, '{}')) or coalesce(a.route_groups, '{}') && $${params.length}::uuid[])`;
  } else if (opts.agents) {
    // every agent proposal the caller may see (AI managers' overview; each one is still checked below)
    where += ` and a.agent_id is not null`;
  } else if (opts.mine || !ctx.can("ai", "full")) {
    params.push(ctx.user.id);
    where += ` and a.user_id = $${params.length}`;
  }
  if (opts.agent && /^[0-9a-f-]{36}$/i.test(opts.agent)) {
    params.push(opts.agent);
    where += ` and a.agent_id = $${params.length}`;
  }
  if (opts.status === "expired") where += ` and (a.status = 'expired' or (a.status = 'proposed' and a.expires_at <= now()))`;
  else if (opts.status === "proposed") where += ` and a.status = 'proposed' and a.expires_at > now()`;
  else if (opts.status) {
    params.push(opts.status);
    where += ` and a.status = $${params.length}`;
  }
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const rows = await ctx.db.query<ActionRow & { user_name: string | null; confirmer_name: string | null }>(
    `select ${COLS.split(", ").map((c) => `a.${c}`).join(", ")}, u.full_name as user_name, cu.full_name as confirmer_name
     from sm_ai_actions a left join sm_users u on u.id = a.user_id left join sm_users cu on cu.id = a.confirmed_by
     where ${where} order by a.created_at desc limit $${params.length}`,
    params,
  );
  // a skill's proposals on records: only those whose record and fields the caller sees now (an AI manager too)
  const seen: typeof rows = [];
  for (const r of rows) if (!r.record_table || (await canSee(ctx, r))) seen.push(r);
  const decide = new Map<string, boolean>();
  for (const r of seen) decide.set(r.id, effectiveStatus(r) === "proposed" && (await canDecide(ctx, r)));
  return seen.map((r) => ({
    ...toProposal(r),
    thread_id: r.user_id === ctx.user.id ? r.thread_id : null,
    area: r.area,
    level: r.level,
    user: { id: r.user_id, name: r.user_name },
    confirmed_by: r.confirmed_by ? { id: r.confirmed_by, name: r.confirmer_name } : null,
    confirmed_at: r.confirmed_at,
    created_at: r.created_at,
    can_decide: decide.get(r.id) ?? false,
  }));
}
