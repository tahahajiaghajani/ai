// Detail accounts (تفصیلی): every party, cash box, bank account and wallet owns one, so the
// ledger can be read per person/box/bank under the shared معین accounts.
import type { Queryable } from "../../db";
import { insertRow, updateRow } from "../../db/sql";
import { uuidv7 } from "@shared/id";
import type { DetailKind } from "./coa";

const RANGES: Record<DetailKind, number> = {
  person: 10001,
  cash: 20001,
  bank: 30001,
  wallet: 40001,
  cost_center: 50001,
  project: 60001,
  other: 90001,
};

export async function nextDetailCode(q: Queryable, orgId: string, kind: DetailKind): Promise<string> {
  const start = RANGES[kind] ?? 90001;
  const r = await q.one<{ n: string | null }>(
    `select max(code::bigint) as n from tz_details
     where org_id = $1 and deleted_at is null and code ~ '^[0-9]{1,15}$' and code::bigint >= $2 and code::bigint < $3`,
    [orgId, start, start + 9999999],
  );
  return String(r?.n ? Number(r.n) + 1 : start);
}

/** Create or update the detail account owned by `refId`; returns its id. */
export async function ensureDetail(
  q: Queryable,
  orgId: string,
  kind: DetailKind,
  refId: string,
  name: string,
  existingId?: string | null,
): Promise<string> {
  if (existingId) {
    const row = await q.one<{ id: string; name: string }>(`select id, name from tz_details where id = $1 and org_id = $2`, [existingId, orgId]);
    if (row) {
      if (row.name !== name) await updateRow(q, "tz_details", { id: existingId, org_id: orgId }, { name });
      return existingId;
    }
  }
  const found = await q.one<{ id: string }>(`select id from tz_details where org_id = $1 and ref_id = $2 and deleted_at is null`, [orgId, refId]);
  if (found) {
    await updateRow(q, "tz_details", { id: found.id, org_id: orgId }, { name });
    return found.id;
  }
  const code = await nextDetailCode(q, orgId, kind);
  const row = await insertRow<{ id: string }>(q, "tz_details", { id: uuidv7(), org_id: orgId, code, name, kind, ref_id: refId }, "id");
  return row.id;
}

export async function archiveDetail(q: Queryable, orgId: string, detailId: string | null | undefined) {
  if (!detailId) return;
  await q.query(`update tz_details set is_active = false where id = $1 and org_id = $2`, [detailId, orgId]);
}
