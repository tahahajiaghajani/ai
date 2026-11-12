// The item hash (design A §7.4): SHA-256 of the canonical normalised record without its volatile fields (status, the
// tool's last contact) and without what never reaches a CI through the item (software, staged apart and hashed on its
// own, §11.2), plus the connector's `config_version` and the kind's version — so a change of mapping, options, create
// policy, default class or kind code re-reconciles every item, and a status flip or a contact stamp never does.
// This file builds the canonical material (pure); the server and the relay digest it with node:crypto.
// Imported by the UI: keep it free of server imports.
import { RECORD_SCHEMA, type DiscoveredRecord, type DiscoveredSoftware } from "./types";

/** Fields of a record that change without the machine changing: never part of its hash. */
export const VOLATILE_FIELDS = ["status", "last_contact_at"] as const;

/** JSON with sorted keys and without undefined values (arrays keep their order: the first address is the CI's). */
export function canonical(v: unknown): string {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** What an item's hash is taken over. */
export function hashMaterial(record: DiscoveredRecord, configVersion: number, kindVersion: number): string {
  const { status: _status, last_contact_at: _contact, software: _software, ...stable } = record;
  void _status;
  void _contact;
  void _software;
  return `${RECORD_SCHEMA}\nkind:${kindVersion}\nconfig:${configVersion}\n${canonical(stable)}`;
}

/** What a device's software list is hashed over (DA7: re-staged only when it changes): sorted, case-folded. */
export function softwareMaterial(software: DiscoveredSoftware[] | undefined): string {
  const rows = (software ?? []).map((s) => [s.name.trim().toLowerCase(), (s.version ?? "").trim(), (s.vendor ?? "").trim().toLowerCase()]);
  rows.sort((a, b) => (a.join("\u0001") < b.join("\u0001") ? -1 : a.join("\u0001") > b.join("\u0001") ? 1 : 0));
  return canonical(rows);
}
