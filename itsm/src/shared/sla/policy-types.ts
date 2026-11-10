// The UI policy shape (identical to `UiPolicy` of the record UI kit, src/ui/records/model/policies.ts), kept here so
// the server can build and check policies without importing UI code.
import type { Cond } from "../model/conditions";

export interface UiPolicyActionLike {
  field: string;
  visible?: boolean;
  mandatory?: boolean;
  readonly?: boolean;
}

export interface UiPolicyLike {
  key?: string;
  when?: Cond | null;
  actions: UiPolicyActionLike[];
  message?: string;
  tone?: "info" | "warning";
  order?: number;
  on?: "create" | "update" | "both";
}

/**
 * Mandatory and read-only fields under `policies` for a row (mirrors the record UI's `formState`: policies by order,
 * a later one wins on the same field and property; `holds` decides a policy's condition).
 */
export function policyEffects(policies: readonly UiPolicyLike[], mode: "create" | "update", holds: (when: Cond | null | undefined) => boolean): { mandatory: Map<string, UiPolicyLike>; readonly: Map<string, UiPolicyLike> } {
  const mandatory = new Map<string, UiPolicyLike>();
  const readonly = new Map<string, UiPolicyLike>();
  const ordered = policies.map((p, i) => ({ p, i })).sort((a, b) => (a.p.order ?? 0) - (b.p.order ?? 0) || a.i - b.i);
  for (const { p } of ordered) {
    const on = p.on ?? "both";
    if (on !== "both" && on !== mode) continue;
    if (!holds(p.when)) continue;
    for (const a of p.actions) {
      if (a.mandatory === true) mandatory.set(a.field, p);
      if (a.mandatory === false) mandatory.delete(a.field);
      if (a.readonly === true) readonly.set(a.field, p);
      if (a.readonly === false) readonly.delete(a.field);
    }
  }
  return { mandatory, readonly };
}
