// The demo pack's connector (design A §14.4): fixed records for the pack's servers, branches and ATMs, with status
// flips on a timer and no network call. Its items, runs and states are demo rows. Not offered in the wizard: only the
// demo pack (DA5) creates one. Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const demo = describeKind({
  kind: "demo",
  label: "منبع نمایشی",
  icon: "flask-conical",
  category: "generic",
  ready: true,
  hidden: true,
  editions: ["cloud", "server"],
  auth: ["none"],
  collects: ["inventory", "status", "problems"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 90,
  options: [{ key: "flip_minutes", label: "تغییر وضعیت هر چند دقیقه", type: "int", default: 10 }],
});
