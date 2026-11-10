// What the employee and customer portal renders from the service modules without knowing them (the registration hook
// of docs/modules/esm_FA.md): each module registers a source on the server (`registerPortalSectionSource` in
// src/server/modules/esm/portal.ts) and `GET /api/o/:org/esm/portal/sections` answers the sections the caller may
// see — departments with their services (audience-filtered), the customer's account view, the technician's visits.
// Links are paths of the signed-in app (relative to /:org/) or API paths the portal calls; no record a caller may not
// read is ever named. Imported by the UI: keep it free of server imports.

export type PortalSectionKind = "department" | "customer" | "field";

export interface PortalLink {
  key: string;
  label: string;
  /** an app path relative to /:org/ («esm/my-cases», «catalog?catalog=…») */
  path: string;
  /** a live count shown with the link (the caller's own records) */
  count?: number | null;
}

export interface PortalService {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  icon: string | null;
  /** the catalogue item whose order form files it (the portal embeds the request module's OrderForm) */
  catalog_item_id: string | null;
  case_table: string;
}

export interface PortalFact {
  key: string;
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger";
}

export interface PortalSection {
  key: string;
  kind: PortalSectionKind;
  title: string;
  icon: string | null;
  color: string | null;
  /** Markdown */
  intro: string | null;
  order: number;
  links: PortalLink[];
  services: PortalService[];
  facts: PortalFact[];
  /** the knowledge base the section's articles come from (the portal's knowledge search can narrow to it) */
  kb_base_id: string | null;
  catalog_id: string | null;
}

export interface PortalSectionsResponse {
  sections: PortalSection[];
}
