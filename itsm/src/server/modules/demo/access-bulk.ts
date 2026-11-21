// The access bumps of the demo purge, in bulk (migration 0105_demo_purge_sync, docs/DEMO_FA.md «برنامهٔ ویندوزِ پیوسته»).
// Every group, unit, workspace or role row a transaction removes or tombstones bumps the access version and every
// member's scope epoch (0007_access): a purge that removes the pack's hundred groups and units wrote units × members
// epoch rows, and every linked Windows app read everything again once per phase that touched them, and once more when
// the tombstones went for good. Inside a purge transaction those per-row bumps only mark the transaction; one bump of
// the version and of everyone's epoch follows just before it commits (`onBeforeCommit`) — a Windows app reads
// everything again once. The tombstones' own removal (`finalizeDemo`) moves no epoch at all: every app it waited for
// pulled them already, and one it did not wait for reads everything again through the purge watermark.
import type { Db, Tx } from "../../db";
import { onBeforeCommit } from "../../db";

export interface BulkOptions {
  /** bump everyone's scope epoch when the transaction changed what members may read (default true) */
  epochs?: boolean;
}

/** Hold the organisation's access bumps of transaction `tx` until its commit: one bump then, if any was due. */
export async function bulkAccess(tx: Tx, orgId: string, opts: BulkOptions = {}): Promise<void> {
  await tx.query(`select set_config('itsm.access_bulk', $1, true)`, [orgId]);
  onBeforeCommit(tx, `demo.access_bulk:${orgId}`, async () => {
    const due = await tx.one<{ v: string | null; e: string | null }>(`select current_setting('itsm.access_version', true) as v, current_setting('itsm.access_everyone', true) as e`);
    // the bumps below are the real ones (and so is any access write later work of this commit makes)
    await tx.query(`select set_config('itsm.access_bulk', '', true), set_config('itsm.access_version', '', true), set_config('itsm.access_everyone', '', true)`);
    const everyone = due?.e === orgId && opts.epochs !== false;
    if (due?.v === orgId || due?.e === orgId) await tx.query(`select sm_access_bump($1)`, [orgId]);
    if (everyone) await tx.query(`select sm_access_bump_everyone($1)`, [orgId]);
  });
}

const wrapped = new WeakMap<Db, Map<string, Db>>();

/**
 * `db` whose transactions hold the organisation's access bumps until they commit (`bulkAccess`): every phase of the
 * purge — and a phase added later — runs through it. One object per database, organisation and options, so caches keyed
 * by the database object (the purge's table catalogue) keep working.
 */
export function purgeDb(db: Db, orgId: string, opts: BulkOptions = {}): Db {
  const key = `${orgId}:${opts.epochs === false ? "noepochs" : "epochs"}`;
  let m = wrapped.get(db);
  if (!m) wrapped.set(db, (m = new Map()));
  let out = m.get(key);
  if (!out) {
    out = { ...db, tx: <T>(fn: (tx: Tx) => Promise<T>) => db.tx(async (tx) => {
      await bulkAccess(tx, orgId, opts);
      return fn(tx);
    }) };
    m.set(key, out);
  }
  return out;
}
