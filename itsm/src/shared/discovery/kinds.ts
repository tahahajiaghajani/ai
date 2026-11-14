// The client-safe registry of connector kinds (design A §6.1): what the wizard renders — label, icon, group, editions,
// auth and option fields, default mapping, the permission note — and what the tables and the server need to know of a
// kind without its code (version, contact lag, availability, default priority and create policy). One explicit import
// per kind (TypeScript and esbuild need one per file): every wave-1 kind is listed; a kind's package replaces its stub
// file and never edits this registry. The server's twin is src/server/modules/discovery/registry.ts.
// Imported by the UI: keep it free of server imports.
import type { Option } from "../model/types";
import type { Edition, KindDescriptor } from "./types";
import { zabbix } from "./kinds/zabbix";
import { prtg } from "./kinds/prtg";
import { vcenter } from "./kinds/vcenter";
import { glpi } from "./kinds/glpi";
import { mecm } from "./kinds/mecm";
import { ad_computers } from "./kinds/ad_computers";
import { ksc } from "./kinds/ksc";
import { endpoint_central } from "./kinds/endpoint_central";
import { rest } from "./kinds/rest";
import { feed } from "./kinds/feed";
import { sql_view } from "./kinds/sql_view";
import { push } from "./kinds/push";
import { demo } from "./kinds/demo";

/** Every kind in the wizard's order. */
export const KIND_DESCRIPTORS: readonly KindDescriptor[] = [zabbix, prtg, vcenter, mecm, endpoint_central, glpi, ad_computers, ksc, feed, sql_view, rest, push, demo];

const BY_KIND = new Map(KIND_DESCRIPTORS.map((d) => [d.kind, d]));

export function kindDescriptor(kind: string | null | undefined): KindDescriptor | undefined {
  return kind ? BY_KIND.get(kind) : undefined;
}

/** Options of the connector's `kind` field: every kind (a stub's rows stay valid once its package lands). */
export const KIND_OPTIONS: Option[] = KIND_DESCRIPTORS.map((d, i) => ({ value: d.kind, label: d.label, order: i + 1 }));

/** Kinds a relay can run for a `push` connector (`relay_kind`, §13): every pulled kind. */
export const RELAY_KIND_OPTIONS: Option[] = KIND_OPTIONS.filter((o) => o.value !== "push" && o.value !== "demo");

/** Kinds the wizard offers in an edition: built, not hidden, and able to run there (others show disabled). */
export function offeredKinds(edition: Edition): { kind: KindDescriptor; runs: boolean }[] {
  return KIND_DESCRIPTORS.filter((d) => d.ready && !d.hidden && d.wave === 1).map((kind) => ({ kind, runs: kind.editions.includes(edition) }));
}

/** The CI class a record of an item kind gets when neither the record, the kind nor the connector names one. */
export const ITEM_KIND_CLASS: Record<string, string | null> = {
  device: "hardware",
  vm: "virtual_machine",
  host: "server",
  endpoint: "computer",
  network: "network_device",
  // ATMs match assets and are never created as CIs (§9.5)
  atm: null,
  other: "ci",
};
