// Who may, and who looks (design F §6.1, §8.2, §8.4, package F2):
//   · reading forms and their previews — `process_design` read or `settings` edit; writing process forms —
//     `process_design` write or `settings` edit (F1's rule for the field library, with the forms' own wording);
//     a table's default form is F1's overrides (`settings` edit);
//   · the viewpoint of a preview: whose field groups apply and whom the organisation's requirements bind — the caller
//     (default), a persona of the organisation's built-in roles («درخواست‌دهنده» / «کارشناس», as the system form
//     designer's selector offers), or a member (the process designer's sample person). A member's viewpoint tells
//     their field groups, so it needs what seeing members' access needs (`users` read all, `needAccessView`).
import type { FieldGroup } from "@shared/model/types";
import { FIELD_GROUPS } from "@shared/model/types";
import { roleClosure } from "@shared/access";
import type { RequiredFor } from "@shared/forms/paths";
import type { Ctx } from "../../context";
import { bad, forbidden } from "../../http/errors";
import { access } from "../../access/provider";
import { accessSettings, catalogOf, snapshotFor } from "../../access/subject";
import { memberCtx, needAccessView } from "../../access/service";
import { requirementScope } from "../../engine/schema";
import { designGrant, holdsSettings } from "../fields/grants";

/** Reads forms, their usage and previews: `process_design` read or `settings` edit (as the field library). */
export async function needFormsRead(ctx: Ctx): Promise<void> {
  const g = await designGrant(ctx);
  if ((g && g.read !== "none") || (await holdsSettings(ctx, "edit"))) return;
  throw forbidden("به «فرم‌ها» دسترسی ندارید");
}

/** May the caller design process forms (the list's «editable»)? `process_design` write or `settings` edit. */
export async function canDesignForms(ctx: Ctx): Promise<boolean> {
  const g = await designGrant(ctx);
  return !!(g && (g.write !== "none" || g.create)) || (await holdsSettings(ctx, "edit"));
}

/** Creates, changes and deletes process forms. */
export async function needFormsWrite(ctx: Ctx): Promise<void> {
  if (await canDesignForms(ctx)) return;
  throw forbidden("ساخت و ویرایش فرم‌ها دسترسی «طراحی فرم و گردش‌کار» یا «تنظیمات سازمان» می‌خواهد");
}

/** May the caller change the tables' default forms (F1's overrides)? */
export const canChangeSystemForms = (ctx: Ctx): Promise<boolean> => holdsSettings(ctx, "edit");

export interface Viewpoint {
  kind: "me" | "persona" | "member";
  /** the member's id, or the persona's key */
  id: string;
  label: string;
  /** the field groups that apply */
  groups: FieldGroup[];
  /** whom of them the organisation's requirements bind («همه», and «فقط کارشناسان» for agents) */
  scope: RequiredFor[];
}

/** The personas a preview offers: the organisation's built-in roles of each. */
export const PERSONAS: Record<"requester" | "agent", { label: string; role: string; scope: RequiredFor[] }> = {
  requester: { label: "درخواست‌دهنده", role: "requester", scope: ["all"] },
  agent: { label: "کارشناس", role: "agent", scope: ["all", "agents"] },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_GROUPS = Object.keys(FIELD_GROUPS) as FieldGroup[];

const groupsOf = (ctx: Ctx): FieldGroup[] => ALL_GROUPS.filter((g) => access().hasFieldGroup(ctx, g));

/** Whose view a preview takes: «me» (default), «requester» / «agent», or a member's id. */
export async function viewpointOf(ctx: Ctx, as: string | null | undefined): Promise<Viewpoint> {
  const who = (as ?? "").trim();
  if (!who || who === "me") {
    return { kind: "me", id: ctx.user.id, label: ctx.user.full_name || ctx.user.email, groups: groupsOf(ctx), scope: await requirementScope(ctx) };
  }
  if (who === "requester" || who === "agent") {
    const p = PERSONAS[who];
    const catalog = catalogOf(await snapshotFor(ctx, ctx.db), accessSettings(ctx.org));
    const groups = new Set<FieldGroup>();
    for (const k of roleClosure([p.role], catalog)) for (const g of catalog.get(k)?.field_groups ?? []) groups.add(g);
    return { kind: "persona", id: who, label: p.label, groups: ALL_GROUPS.filter((g) => groups.has(g)), scope: p.scope };
  }
  if (!UUID.test(who)) throw bad("دیدگاه پیش‌نمایش باید «درخواست‌دهنده»، «کارشناس» یا یکی از اعضای سازمان باشد");
  // a member's field groups are part of their access: shown to those who see members' access
  if (who.toLowerCase() !== ctx.user.id) await needAccessView(ctx);
  const target = await memberCtx(ctx.cfg, ctx.org.id, who.toLowerCase());
  return { kind: "member", id: target.user.id, label: target.user.full_name || target.user.email, groups: groupsOf(target), scope: await requirementScope(target) };
}
