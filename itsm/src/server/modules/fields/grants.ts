// Who holds what in the field library and the table overlays (design F §6.1): `settings` at a level — the membership's
// level or the access model's grant in the area, whichever the person holds — and the grant in «طراحی فرم و گردش‌کار»
// (`process_design`). Shared by the API (service.ts) and by the hooks that hold the same rules on the generic record
// API (combinations.ts, hooks.ts). Inside a write, pass its transaction.
import { grantIn } from "@shared/access";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject } from "../../access/subject";

export type SettingsLevel = "view" | "edit" | "full";

/** Why a person may not change a lifecycle overlay: it needs `settings` full, on F1's route and the generic API alike. */
export const LIFECYCLE_REFUSAL = "چرخهٔ عمر رکوردها را مدیر سازمان تغییر می‌دهد";

/** The person holds `settings` at `level`: their membership level, or the access model's grant in the area. */
export async function holdsSettings(ctx: Ctx, level: SettingsLevel, q: Queryable = ctx.db): Promise<boolean> {
  if (ctx.can("settings", level)) return true;
  if (ctx.actor !== "user") return false;
  const g = grantIn((await prepareSubject(ctx, q)).subject.eff, "settings");
  if (level === "view") return g.read !== "none";
  if (level === "edit") return g.write !== "none" || g.create;
  return g.admin;
}

/** The person's grant in «طراحی فرم و گردش‌کار» (null for the system and support sessions). */
export async function designGrant(ctx: Ctx, q: Queryable = ctx.db) {
  if (ctx.actor !== "user") return null;
  return grantIn((await prepareSubject(ctx, q)).subject.eff, PROCESS_DESIGN_AREA);
}
