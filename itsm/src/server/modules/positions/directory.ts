// Organisational roles an Active Directory source keeps (design F D11, docs/AD_FA.md §4): a directory group's mapping
// with `position_id` makes its members holders of that position — rows with source «directory» and `source_ref` = the
// source. The directory files (src/server/modules/integration/directory*.ts) plan who should hold what; this file reads
// what they need and writes the rows:
//   · given only under the approved mappings, like a role (the caller decides: a sign-in while its mappings are the
//     approved ones with automatic roles on, an «اعمال» with roles confirmed, a scheduled run with approved mappings);
//   · a holding the person already has — kept by hand, by an import or by another source — is left as it is, never
//     doubled;
//   · taken back when the directory no longer gives it — only the rows this very source keeps, never a manual or an
//     imported holder.
// Writes go through the engine as the member whose access the source acts with (its approver, or the administrator who
// applies a preview): their `org` write must reach the holder's unit, as for anyone who keeps holders.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { createIn, removeIn, savepoint } from "../../engine";
import type { DirPosition } from "@shared/integration/directory";

/** A holding: who holds which position in which unit. */
export interface DirectoryHolding {
  user_id: string;
  position_id: string;
  unit_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (list: (string | null | undefined)[]) => [...new Set(list.filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))];

/**
 * What a source's plan and sign-in need about organisational roles: the positions its mappings name, and the live
 * holders of those positions together with every holder the source keeps (`ours`), of `users` when given.
 */
export async function directoryFacts(
  q: Queryable,
  orgId: string,
  sourceId: string,
  positionIds: (string | null | undefined)[],
  users?: string[],
): Promise<{ positions: DirPosition[]; holders: (DirectoryHolding & { ours: boolean })[] }> {
  const wanted = ids(positionIds);
  const positions = wanted.length
    ? await q.query<{ id: string; name: string; unit_kind: string | null; active: boolean | null }>(
        `select id, name, unit_kind, active from sm_positions where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
        [orgId, pgArray(wanted)],
      )
    : [];
  const params: unknown[] = [orgId, pgArray(wanted), sourceId];
  let who = "";
  if (users) {
    params.push(pgArray(ids(users)));
    who = ` and user_id = any($4::uuid[])`;
  }
  const holders = await q.query<{ user_id: string; position_id: string; unit_id: string | null; ours: boolean }>(
    `select user_id, position_id, org_unit_id as unit_id, (source = 'directory' and source_ref = $3) as ours from sm_position_holders
     where org_id = $1 and deleted_at is null and (position_id = any($2::uuid[]) or (source = 'directory' and source_ref = $3))${who}`,
    params,
  );
  return {
    positions: positions.map((p) => ({ id: p.id.toLowerCase(), name: p.name, unit_kind: p.unit_kind, active: p.active !== false })),
    holders: holders.map((h) => ({ user_id: h.user_id.toLowerCase(), position_id: h.position_id.toLowerCase(), unit_id: h.unit_id ? h.unit_id.toLowerCase() : null, ours: !!h.ours })),
  };
}

export interface HoldingsResult {
  added: number;
  removed: number;
  /** why a holding could not be given or taken back (Persian, with the person) */
  problems: string[];
}

const failure = (e: unknown): string | null => {
  const status = (e as { status?: unknown })?.status;
  return typeof status === "number" && status >= 400 && status < 500 ? String((e as Error).message ?? e) : null;
};

/**
 * Give and take back a source's holdings as `ctx`, each on its own (one refused holding never stops the rest): a
 * holding the person already has is left as it is; only rows this source keeps are removed.
 */
export async function applyDirectoryHoldings(ctx: Ctx, sourceId: string, change: { adds: DirectoryHolding[]; removes: DirectoryHolding[] }): Promise<HoldingsResult> {
  const out: HoldingsResult = { added: 0, removed: 0, problems: [] };
  const adds = change.adds.filter((h) => UUID.test(h.user_id) && UUID.test(h.position_id));
  const removes = change.removes.filter((h) => UUID.test(h.user_id) && UUID.test(h.position_id));
  if (!adds.length && !removes.length) return out;
  const org = ctx.org.id;
  const unitOf = (h: DirectoryHolding) => (h.unit_id && UUID.test(h.unit_id) ? h.unit_id.toLowerCase() : null);
  await ctx.write(async (tx) => {
    for (const h of removes) {
      const row = await tx.one<{ id: string }>(
        `select id from sm_position_holders where org_id = $1 and position_id = $2 and user_id = $3 and org_unit_id is not distinct from $4::uuid
           and source = 'directory' and source_ref = $5 and deleted_at is null limit 1`,
        [org, h.position_id.toLowerCase(), h.user_id.toLowerCase(), unitOf(h), sourceId],
      );
      if (!row) continue;
      try {
        await savepoint(tx, () => removeIn(tx, ctx, "position_holder", row.id, { trusted: true }));
        out.removed++;
      } catch (e) {
        const message = failure(e);
        if (!message) throw e;
        out.problems.push(message.slice(0, 200));
      }
    }
    for (const h of adds) {
      const exists = await tx.one(
        `select 1 from sm_position_holders where org_id = $1 and position_id = $2 and user_id = $3 and org_unit_id is not distinct from $4::uuid and deleted_at is null limit 1`,
        [org, h.position_id.toLowerCase(), h.user_id.toLowerCase(), unitOf(h)],
      );
      if (exists) continue;
      try {
        await savepoint(tx, () =>
          createIn(tx, ctx, "position_holder", { position_id: h.position_id.toLowerCase(), user_id: h.user_id.toLowerCase(), org_unit_id: unitOf(h), kind: "primary", source: "directory", source_ref: sourceId }, { trusted: true }),
        );
        out.added++;
      } catch (e) {
        const message = failure(e);
        if (!message) throw e;
        out.problems.push(message.slice(0, 200));
      }
    }
  });
  return out;
}
