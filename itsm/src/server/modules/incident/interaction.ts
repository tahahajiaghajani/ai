// Interactions (catalogue INC-044; the table `interaction`): a call, chat or walk-in becomes an incident in one step —
// its subject, transcript, caller and channel carried over, the interaction linked with the wrap-up «رخداد ثبت شد» —
// and an interaction still open when its incident is resolved, closed or canceled is closed with it (the subscriber in
// jobs.ts). Everything runs with the caller's context; only agents (not requesters) work interactions.
import type { Ctx } from "../../context";
import { access } from "../../access/provider";
import { condEnv, createIn, defFor, get, requireReadable, transitionIn, updateIn } from "../../engine";
import { conflict, forbidden, notFound } from "../../http/errors";
import { isUuid, liveRows, requesterOnly, type Row } from "./common";

/** The interaction's incident: created from it and linked (409 when it already has one or is no longer open). */
export async function incidentFromInteraction(ctx: Ctx, id: string): Promise<{ row: Row; display: Record<string, string> }> {
  if (!isUuid(id)) throw notFound("تعامل پیدا نشد");
  const incidentId = await ctx.write(async (tx) => {
    const { def } = await defFor(ctx, "interaction", tx);
    const it = await requireReadable(ctx, def, id, await condEnv(ctx), tx, { lock: true });
    if (requesterOnly(ctx, def.area) || !access().canWrite(ctx, def, it)) throw forbidden("ثبت رخداد از تعامل با کارشناس آن است");
    if (it.incident_id) throw conflict("این تعامل پیش‌تر به رخدادی پیوند خورده است");
    if (it.state !== "open") throw conflict("این تعامل بسته شده است؛ آن را بازگشایی کنید یا رخداد تازه ثبت کنید");
    const inc = await createIn(tx, ctx, "incident", {
      short_description: it.short_description,
      description: it.transcript ?? null,
      caller_id: it.caller_id ?? null,
      channel: it.channel ?? "phone",
    });
    await updateIn(tx, ctx, "interaction", id, { incident_id: inc.id, ...(it.wrap_up ? {} : { wrap_up: "incident" }) }, { version: it.version as number });
    return inc.id as string;
  });
  const r = await get(ctx, "incident", incidentId);
  return { row: r.row, display: r.display };
}

/** Close the interactions still open about an incident that was resolved, closed or canceled (as the system). */
export async function closeInteractions(sys: Ctx, incidentId: string): Promise<number> {
  const open = await liveRows(sys.db, sys, "interaction", { and: [{ f: "incident_id", op: "eq", v: incidentId }, { f: "state", op: "eq", v: "open" }] }, { limit: 100 });
  let closed = 0;
  for (const it of open) {
    await sys.write((tx) => transitionIn(tx, sys, "interaction", it.id, "closed", it.wrap_up ? {} : { wrap_up: "incident" })).then(
      () => closed++,
      (e) => sys.cfg.log?.warn?.("interaction close", { id: it.id, error: (e as Error).message }),
    );
  }
  return closed;
}
