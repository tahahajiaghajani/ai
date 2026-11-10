// Watchers: the users field `watch_list` of a table with features.watchers (tasks have it). Whoever may read a
// record may watch it; adding or removing someone else needs write access to the record. The change goes through
// the write pipeline as an engine stamp: history and a record.updated event (changed: ["watch_list"]) are written,
// but the record's `version` does not move (forms people have open stay valid) and closed records accept it.
import type { Ctx } from "../context";
import { bad, forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { condEnv, isSystemCtx } from "./env";
import { defFor } from "./schema";
import { requireReadable } from "./read";
import { updateIn } from "./write";

/** Add (`on`) or remove the caller — or, with write access, another member — from a record's watch list. */
export async function watch(ctx: Ctx, table: string, id: string, on: boolean, userId?: string | null): Promise<{ watching: boolean; watch_list: string[] }> {
  const { def } = await defFor(ctx, table);
  const field = def.scope.watchers ?? "watch_list";
  if (!def.features?.watchers || !def.fields.some((f) => f.name === field)) throw bad(`«${def.plural}» پیگیری‌کننده ندارد`);
  const env = await condEnv(ctx);
  const who = (userId ?? ctx.user.id).toLowerCase();
  const list = await ctx.write(async (tx) => {
    const row = await requireReadable(ctx, def, id, env, tx, { lock: true });
    if (who !== ctx.user.id && !isSystemCtx(ctx) && (!access().canWrite(ctx, def, row) || row.$writable === false)) {
      throw forbidden("برای افزودن یا برداشتن دیگران، اجازهٔ ویرایش این رکورد لازم است");
    }
    if (who !== ctx.user.id) {
      const member = await tx.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, who]);
      if (!member) throw notFound("کاربر پیدا نشد");
    }
    const current = Array.isArray(row[field]) ? (row[field] as string[]) : [];
    const next = on ? [...new Set([...current, who])] : current.filter((x) => x !== who);
    if (next.length === current.length && next.every((x, i) => x === current[i])) return current;
    const stored = await updateIn(tx, ctx, def.key, id, { [field]: next }, { trusted: true, keepVersion: true, allowLocked: true, skipAccess: true });
    return (stored[field] as string[] | null) ?? [];
  });
  return { watching: list.includes(ctx.user.id), watch_list: list };
}
