// The review line of a definition built on the demo pack (docs/DEMO_FA.md «آنچه پاک‌سازی می‌شود»): one audit line
// «پس از حذف داده‌های نمایشی نیاز به بازبینی دارد: …» naming only the real row — what was taken out of it, and how it
// ended: cleaned, switched off, retired, moved to a closed state of its lifecycle, or removed (refs.ts `deadEnd`; the
// preview's chip and the purge's report say the same). The clear phase writes one for every definition it cleans
// (clean.ts); the push filter for a definition a Windows app pushed after the purge that named only purged data where
// that would have widened it (pushed.ts, routes/sync.ts).
import { uuidv7 } from "@shared/id";
import type { Queryable } from "../../db";
import type { CleanedDefinition } from "./purge";

/** How a cleaned definition ended, in the review line's words. */
export function endedWords(c: Pick<CleanedDefinition, "deactivated" | "retired" | "ended" | "removed">): string {
  if (c.retired) return "بازنشسته شد";
  if (c.removed) return "حذف شد";
  if (c.ended) return `به وضعیت «${c.ended}» رفت`;
  if (c.deactivated) return "غیرفعال شد";
  return "پاک‌سازی شد";
}

/**
 * Write the review line of `c` (`verb`: what happened to it, when the purge did not end it itself). `name`: the row's
 * words, read as the line is written — the purge's report keeps none (purge.ts `CleanedDefinition`).
 */
export async function reviewLine(q: Queryable, orgId: string, c: CleanedDefinition & { name: string }, verb = endedWords(c)): Promise<void> {
  const summary = `پس از حذف داده‌های نمایشی نیاز به بازبینی دارد: ${c.label} «${c.name}» ${verb}${c.what ? ` — ${c.what}` : ""}`.slice(0, 500);
  await q.query(
    `insert into sm_audit (id, org_id, user_id, action, entity, entity_id, summary, data, origin, actor_kind) values ($1, $2, null, 'demo_purge_review', $3, $4, $5, $6::jsonb, null, 'system')`,
    [uuidv7(), orgId, c.table, c.id, summary, JSON.stringify({ deactivated: c.deactivated, retired: !!c.retired, removed: !!c.removed, ...(c.ended ? { ended: c.ended } : {}) })],
  );
}
