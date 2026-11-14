// The lifecycle editor's part of the module (design F §4.2, §8.5; package F6): the route settings/workflows/states/:table,
// opened from the hub's «چرخهٔ عمر رکوردها» rows (no menu row of its own). `settings` view reads a lifecycle; `settings`
// full changes it (F1's GET|PUT /lifecycles/:table).
import { lazy } from "react";
import type { WorkflowsPart } from "../../parts";

const LifecycleEditor = lazy(() => import("./LifecycleEditor"));

export const lifecyclePart: WorkflowsPart = {
  routes: [{ path: "settings/workflows/states/:table", element: <LifecycleEditor /> }],
};
