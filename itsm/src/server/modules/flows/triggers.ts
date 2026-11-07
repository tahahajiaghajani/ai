// What starts runs (docs/spec/services/flows.md §4): record events (subscribed with `onRecordEvent`), schedules
// (scheduler.ts), inbound webhooks and manual / test runs (service.ts), catalog orders (`startCatalogFlows`, called by
// the catalog module later). Every trigger matches against the flow's PUBLISHED version — its trigger snapshot —
// never against the draft being edited. A record event starts flows only on the runtime that made the write (events
// applied from a sync push are skipped: the Windows app ran them already), and an event caused by a run carries that
// run's depth (`$flow`, executor.ts): past FLOW_LIMITS.depth nothing more starts.
import type { ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { onRecordEvent, systemCtx, condEnv, orgSchema, fromDb, type RecordEvent } from "../../engine";
import { memberCtx } from "../../access";
import { tableDef } from "@shared/tables";
import { evaluate, type Cond } from "@shared/model/conditions";
import { FLOW_LIMITS, FLOW_TABLE_KEYS, type TriggerConfig, type TriggerEvent } from "@shared/flows";
import { enqueue } from "../../jobs";
import { startRun, type TriggerData } from "./executor";
import { matchesRecord } from "./records";

/** An active flow with its published version, as triggers match it. */
export interface PublishedFlow {
  id: string;
  name: string;
  version_id: string;
  version_no: number;
  trigger: TriggerConfig;
  /** who published the version (the fallback identity of runs without a triggering member) */
  publisher: string | null;
}

/** The active, published flows of an organisation (their published trigger). */
export async function activeFlows(q: Queryable, orgId: string, kind?: TriggerConfig["kind"]): Promise<PublishedFlow[]> {
  const rows = await q.query<PublishedFlow>(
    `select f.id, f.name, f.version_id, v.version_no, v.trigger, v.created_by as publisher
     from sm_flows f join sm_flow_versions v on v.id = f.version_id and v.org_id = f.org_id and v.deleted_at is null
     where f.org_id = $1 and f.active and f.deleted_at is null ${kind ? "and v.trigger->>'kind' = $2" : ""}
     order by f.name, f.id`,
    kind ? [orgId, kind] : [orgId],
  );
  return rows.filter((r) => r.trigger && typeof r.trigger === "object");
}

/** Who a run acts as: the configured member, the system, or the member who triggered it (else the publisher). */
export function resolveRunAs(t: Pick<TriggerConfig, "run_as" | "run_as_user">, actorId: string | null, publisher: string | null): { kind: "user" | "system"; userId: string | null } {
  if (t.run_as === "system") return { kind: "system", userId: null };
  if (t.run_as === "user" && t.run_as_user) return { kind: "user", userId: t.run_as_user };
  const id = actorId ?? t.run_as_user ?? publisher;
  return id ? { kind: "user", userId: id } : { kind: "system", userId: null };
}

const EVENTS = new Set<TriggerEvent>(["created", "updated", "state_changed", "assigned", "commented", "deleted"]);

const emptyCond = (c: unknown) => !c || (typeof c === "object" && !Object.keys(c as object).length);

/** Does a record event match a flow's published record trigger (event kind, changed fields)? */
export function eventMatches(t: TriggerConfig, e: Pick<RecordEvent, "kind" | "table" | "changed">): boolean {
  if (t.kind !== "record" || t.table !== e.table) return false;
  const kind = e.kind.replace(/^record\./, "") as TriggerEvent;
  if (!EVENTS.has(kind) || !(t.events ?? []).includes(kind)) return false;
  if (kind === "updated" && t.fields?.length) return (e.changed ?? []).some((f) => t.fields!.includes(f));
  return true;
}

async function deletedRowMatches(cfg: ServerConfig, e: RecordEvent, cond: unknown): Promise<boolean> {
  const def = tableDef(e.table);
  if (!def || def.virtual) return false;
  const raw = await cfg.db.one<Record<string, unknown>>(`select * from ${def.table} where id = $1 and org_id = $2`, [e.id, e.org_id]);
  if (!raw) return false;
  const ctx = await systemCtx(cfg, e.org_id);
  const schema = await orgSchema(ctx);
  return evaluate(cond as Cond, fromDb(schema.def(e.table) ?? def, raw), await condEnv(ctx), schema.def(e.table) ?? def, schema.lookup);
}

/** Start the flows a record event triggers (the trigger condition is checked as the member who acted). */
export async function startRecordFlows(cfg: ServerConfig, e: RecordEvent): Promise<string[]> {
  if (e.via === "sync" || FLOW_TABLE_KEYS.includes(e.table)) return [];
  const flows = (await activeFlows(cfg.db, e.org_id, "record")).filter((f) => eventMatches(f.trigger, e));
  if (!flows.length) return [];
  const tag = (e as RecordEvent & { $flow?: { run?: string; depth?: number } }).$flow;
  const depth = tag ? Number(tag.depth ?? 0) + 1 : 0;
  if (depth > FLOW_LIMITS.depth) {
    cfg.log.warn("flows: chain of flows too deep, not starting more", { org: e.org_id, table: e.table, id: e.id, run: tag?.run, depth });
    return [];
  }
  const kind = e.kind.replace(/^record\./, "");
  let evalCtx: Awaited<ReturnType<typeof systemCtx>> | null = null;
  const starts: PublishedFlow[] = [];
  for (const f of flows) {
    const cond = f.trigger.condition;
    if (!emptyCond(cond)) {
      let ok = false;
      try {
        if (kind === "deleted") ok = await deletedRowMatches(cfg, e, cond);
        else {
          evalCtx ??= e.actor ? await memberCtx(cfg, e.org_id, e.actor).catch(() => systemCtx(cfg, e.org_id)) : await systemCtx(cfg, e.org_id);
          ok = await matchesRecord(evalCtx, e.table, e.id, cond);
        }
      } catch (err) {
        cfg.log.warn("flows: trigger condition failed", { flow: f.id, error: String((err as Error)?.message ?? err) });
      }
      if (!ok) continue;
    }
    starts.push(f);
  }
  if (!starts.length) return [];
  const trigger: TriggerData = {
    kind: "record",
    table: e.table,
    id: e.id,
    number: e.number ?? null,
    event: kind,
    actor: e.actor,
    at: e.at,
    changed: e.changed ?? [],
    changes: e.changes ?? {},
    ...(e.from !== undefined ? { from: e.from, to: e.to } : {}),
    ...(e.assigned_to ? { assigned_to: e.assigned_to } : {}),
    ...(e.entry ? { entry: e.entry } : {}),
  };
  return cfg.db.tx(async (tx) => {
    const ids: string[] = [];
    for (const f of starts) {
      ids.push(
        await startRun(tx, {
          orgId: e.org_id,
          flow: { id: f.id, name: f.name },
          version: { id: f.version_id, no: f.version_no },
          trigger,
          actorId: e.actor,
          runAs: resolveRunAs(f.trigger, e.actor, f.publisher),
          depth,
        }),
      );
    }
    return ids;
  });
}

/**
 * Start the flows of a catalog item (trigger «سفارش از کاتالوگ»): the catalog module calls it inside the write
 * that places the order, with the order's record and the requester's answers. Returns the run ids.
 */
export async function startCatalogFlows(
  q: Queryable,
  orgId: string,
  order: { item: string; table?: string | null; id?: string | null; actorId?: string | null; inputs?: Record<string, unknown> },
): Promise<string[]> {
  const flows = (await activeFlows(q, orgId, "catalog")).filter((f) => f.trigger.catalog_item === order.item);
  const ids: string[] = [];
  for (const f of flows) {
    ids.push(
      await startRun(q, {
        orgId,
        flow: { id: f.id, name: f.name },
        version: { id: f.version_id, no: f.version_no },
        trigger: { kind: "catalog", table: order.table ?? null, id: order.id ?? null, actor: order.actorId ?? null, inputs: order.inputs ?? {}, item: order.item },
        actorId: order.actorId ?? null,
        runAs: resolveRunAs(f.trigger, order.actorId ?? null, f.publisher),
        depth: 0,
      }),
    );
  }
  return ids;
}

let installed = false;

/** Subscribe the record-event triggers and the condition re-checks of waiting runs (idempotent). */
export function installTriggers(): void {
  if (installed) return;
  installed = true;
  onRecordEvent(
    "flows.triggers",
    async (e, jctx) => {
      await startRecordFlows(jctx.cfg as ServerConfig, e);
    },
    { kinds: ["record.created", "record.updated", "record.state_changed", "record.assigned", "record.commented", "record.deleted"] },
  );
  // a waiting «انتظار برای شرط» re-checks when its record changes — also for changes another runtime synchronised
  onRecordEvent("flows.waits", async (e, jctx) => {
    const db = (jctx.cfg as ServerConfig).db;
    const rows = await db.query<{ id: string; run_id: string }>(`select id, run_id from sm_flow_waits where org_id = $1 and key = $2`, [e.org_id, `record:${e.table}:${e.id}`]);
    for (const r of rows) {
      await enqueue(db, { kind: "flows.recheck", orgId: e.org_id, payload: { run: r.run_id, wait: r.id, reason: "event" }, dedupeKey: `flows.recheck:${r.id}`, maxAttempts: 20 });
    }
  });
}
