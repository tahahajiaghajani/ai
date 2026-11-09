// The customer's section of the portal (the registration hook of src/server/modules/esm/portal.ts): for a member who
// is a customer contact, their account — open cases (theirs, or the account's for its administrators, as the access
// model reads them), entitlements with what is left of them, the installed base — and the customer experience
// (brand) that applies. Entitlements and the installed base are read as the system and projected without money.
import type { PortalSection } from "@shared/esm/portal";
import { unitsLeft, type EntitlementLike } from "@shared/csm/logic";
import { formatJalali } from "@shared/jalali";
import type { Ctx } from "../../context";
import { list } from "../../engine";
import { contactsOfUser, liveRow, liveRows, sysOf, todayUtc, type Row } from "./common";

export async function customerSections(ctx: Ctx): Promise<PortalSection[]> {
  const contacts = await contactsOfUser(ctx.db, ctx, ctx.user.id);
  if (!contacts.length) return [];
  const sys = sysOf(ctx);
  const out: PortalSection[] = [];
  const experiences = await liveRows(ctx.db, sys, "customer_experience", { f: "active", op: "eq", v: true }, { limit: 50 });
  for (const c of contacts) {
    const acc = await liveRow(ctx.db, sys, "customer_account", c.account_id);
    if (!acc || acc.active === false) continue;
    const exp: Row | undefined = experiences.find((x) => ((x.accounts as string[]) ?? []).includes(String(acc.id))) ?? experiences.find((x) => !((x.accounts as string[]) ?? []).length);
    const open = await list(ctx, "customer_case", { filter: { and: [{ f: "account_id", op: "eq", v: acc.id }, { f: "active", op: "eq", v: true }] }, size: 1, fields: ["number"] }).then((r) => r.total ?? 0).catch(() => 0);
    const today = todayUtc();
    const ents = (await liveRows(ctx.db, sys, "entitlement", { and: [{ f: "account_id", op: "eq", v: acc.id }, { f: "state", op: "eq", v: "active" }] }, { limit: 20 })).filter((e) => (!e.ends_on || e.ends_on >= today) && (!e.contact_id || e.contact_id === c.id));
    const ibis = await liveRows(ctx.db, sys, "install_base_item", { and: [{ f: "account_id", op: "eq", v: acc.id }, { f: "status", op: "eq", v: "active" }] }, { limit: 1000 });
    const isAdmin = ((c.roles as string[]) ?? []).includes("admin");
    out.push({
      key: `customer:${acc.id}`,
      kind: "customer",
      title: String(exp?.brand_name || acc.name),
      icon: "building",
      color: (exp?.color as string) ?? null,
      intro: (exp?.greeting as string) ?? null,
      order: 5,
      links: [
        { key: "cases", label: isAdmin ? "پرونده‌های حساب" : "پرونده‌های من", path: "customer-cases", count: open },
        { key: "new-case", label: "ثبت پروندهٔ تازه", path: "customer-cases/new" },
      ],
      services: [],
      facts: [
        ...ents.map((e) => {
          const left = unitsLeft(e as unknown as EntitlementLike);
          return { key: `ent:${e.id}`, label: String(e.name), value: `${e.support_level ? `سطح ${e.support_level} · ` : ""}تا ${formatJalali(String(e.ends_on))}${left === null ? "" : ` · مانده ${left}`}`, tone: left !== null && Number(left) <= 0 ? ("warning" as const) : ("default" as const) };
        }),
        { key: "ibi", label: "اقلام پایگاه نصب", value: String(ibis.length) },
      ],
      kb_base_id: (exp?.kb_base_id as string) ?? null,
      catalog_id: null,
    });
  }
  return out;
}
