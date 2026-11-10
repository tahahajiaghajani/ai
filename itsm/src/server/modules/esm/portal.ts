// The portal's registration hook (the portal module renders what the service modules publish here): a source per
// module answers the sections its caller may see, read with the caller's context or — for configuration the caller
// cannot read through the API (departments, services) — as the system with the audience applied. The departments'
// own source lives here; CSM and field service register theirs (src/server/modules/{csm,field_service}/portal.ts).
import type { PortalSection } from "@shared/esm/portal";
import type { Ctx } from "../../context";
import { list } from "../../engine";
import { servicesFor } from "./cases";
import { DEPT_TABLES } from "./hooks";

export type PortalSectionSource = (ctx: Ctx) => Promise<PortalSection[]>;

const sources = new Map<string, PortalSectionSource>();

/** Add (or replace) a module's portal sections. Returns an unregister function. */
export function registerPortalSectionSource(name: string, fn: PortalSectionSource): () => void {
  sources.set(name, fn);
  return () => {
    if (sources.get(name) === fn) sources.delete(name);
  };
}

/** Every registered source's sections for the caller (a failing source is left out), in order. */
export async function portalSections(ctx: Ctx): Promise<PortalSection[]> {
  const out: PortalSection[] = [];
  for (const fn of sources.values()) {
    try {
      out.push(...(await fn(ctx)));
    } catch {
      // one module's trouble never hides the others' sections
    }
  }
  return out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "fa"));
}

/** The departments' sections: live departments shown in the portal, their services the caller may use, my open cases. */
export async function departmentSections(ctx: Ctx): Promise<PortalSection[]> {
  const { services, departments } = await servicesFor(ctx.db, ctx, ctx.user.id);
  const mine = new Map<string, number>();
  // the case tables at once (each an indexed read of the caller's own open cases)
  const lists = await Promise.all(
    DEPT_TABLES.map((table) =>
      list(ctx, table, { filter: { and: [{ or: [{ f: "requested_for", op: "is_me" }, { f: "caller_id", op: "is_me" }] }, { f: "active", op: "eq", v: true }] }, size: 500, fields: ["department_id"], total: false })
        // a table the caller cannot read has no cases of theirs to count
        .catch(() => null),
    ),
  );
  for (const r of lists) for (const row of r?.rows ?? []) mine.set(String(row.department_id), (mine.get(String(row.department_id)) ?? 0) + 1);
  return departments.map((d) => ({
    key: `department:${d.key}`,
    kind: "department" as const,
    title: String(d.name),
    icon: (d.icon as string) ?? null,
    color: (d.color as string) ?? null,
    intro: (d.intro as string) ?? null,
    order: Number(d.portal_order ?? 100),
    links: [
      { key: "my-cases", label: "درخواست‌های من در این واحد", path: `esm/my-cases?department=${d.key}`, count: mine.get(String(d.id)) ?? 0 },
      ...(d.catalog_id ? [{ key: "catalog", label: "کاتالوگ خدمات واحد", path: `catalog?catalog=${d.catalog_id}` }] : []),
      ...(d.kb_base_id ? [{ key: "kb", label: "راهنماها و پرسش‌های پرتکرار", path: `kb?base=${d.kb_base_id}` }] : []),
    ],
    services: services
      .filter((s) => s.department_id === d.id)
      .map((s) => ({ id: String(s.id), name: String(s.name), category: (s.category as string) ?? null, description: (s.description as string) ?? null, icon: (s.icon as string) ?? null, catalog_item_id: (s.catalog_item_id as string) ?? null, case_table: String(s.case_table) })),
    facts: [],
    kb_base_id: (d.kb_base_id as string) ?? null,
    catalog_id: (d.catalog_id as string) ?? null,
  }));
}
