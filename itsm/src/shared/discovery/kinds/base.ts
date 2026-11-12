// The defaults every kind descriptor starts from (design A §6.1). Each kind's file (`kinds/<kind>.ts`) belongs to the
// package that builds the kind; the files of kinds not built yet are stubs (`ready: false`), which the wizard hides
// and whose server kind refuses with «هنوز ساخته نشده». Imported by the UI: keep it free of server imports.
import type { KindDescriptor } from "../types";

type Required = Pick<KindDescriptor, "kind" | "label" | "icon" | "category" | "editions" | "auth" | "collects" | "contact" | "availability" | "priority">;

export function describeKind(d: Required & Partial<KindDescriptor>): KindDescriptor {
  return { wave: 1, ready: false, version: 1, create_policy: "create", options: [], ...d };
}
