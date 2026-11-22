// The demo pack's rows told apart in the screens (release 1.1.5, docs/DEMO_FA.md; the screens: docs/modules/workflows_FA.md):
//   · positions — the generic record API's list (`demo: true` on the pack's rows: the role pickers, kit/PositionPicker)
//     and a position's own record (`meta.demo`: «نقش‌های سازمانی»'s sheet; its list is GET /positions/overview);
//   · people — the member search every people picker uses (POST /r/user/query, the virtual user table: `demo: true`
//     on the pack's people), for whoever may know who they are: those who open the workflow designer or the positions
//     page (GET /positions/demo-people's rule) and the managers of a case, who hand its steps on («ارجاع مرحله» «از همهٔ
//     اعضا»: a real case's step never goes to the pack's people, FINAL-1). Anyone else — a plain member — gets the rows
//     as before, without the mark.
// Only rows the caller already reads are marked: a mark adds one bit to a row, never a row. The pack's rows are those
// sm_demo_rows records, its people the accounts marked with the organisation's pack (`prefs.demo_org`).
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { demoPeople, demoRowsAmong, isDemoRow } from "../../db/scope";
import { defFor, registerRecordMeta, registerRowMarks } from "../../engine";
import { access } from "../../access/provider";
import { managesAnyCase } from "../process/access/sources";

/** May the caller open the workflow designer (`process_design` read) or the positions page (`org` read of positions)? */
export async function readsDesignOrPositions(ctx: Ctx): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const design = (await defFor(ctx, "process")).def;
  if (access().canReadTable(ctx, design)) return true;
  return access().canReadTable(ctx, (await defFor(ctx, "position")).def);
}

const knows = new WeakMap<Ctx, Promise<boolean>>();

/**
 * May the caller see which people are the demo pack's: a designer or a reader of the positions, or a manager of any
 * case (once per request).
 */
export function mayKnowDemoPeople(ctx: Ctx, q: Queryable): Promise<boolean> {
  let p = knows.get(ctx);
  if (!p) {
    p = (async () => (await readsDesignOrPositions(ctx)) || (ctx.actor === "user" && (await managesAnyCase(q, ctx.org.id, ctx.user.id))))();
    knows.set(ctx, p);
    p.catch(() => knows.delete(ctx));
  }
  return p;
}

let installed = false;

/** The marks (once per process; from installPositionsModule). */
export function installDemoMarks(): void {
  if (installed) return;
  installed = true;
  registerRowMarks("position", async ({ q, ctx, rows }) => {
    const pack = await demoRowsAmong(q, ctx.org.id, rows.map((r) => String(r.id)));
    for (const r of rows) if (pack.has(String(r.id).toLowerCase())) r.demo = true;
  });
  registerRecordMeta("position", async ({ q, ctx, row }) => ({ demo: await isDemoRow(q, ctx.org.id, String(row.id)) }));
  registerRowMarks("user", async ({ q, ctx, rows }) => {
    if (!(await mayKnowDemoPeople(ctx, q))) return;
    const pack = await demoPeople(q, ctx.org.id, rows.map((r) => String(r.id)));
    for (const r of rows) if (pack.has(String(r.id).toLowerCase())) r.demo = true;
  });
}
