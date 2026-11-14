// The process designer's part of the module (design F §8.4; package F6): the route settings/workflows/p/:id that the
// hub's process rows, «گردش‌کار تازه» and the lists-changed notice open (F4c's `editor`). No menu row: the hub leads
// here. The page pulls in the canvas (@xyflow/react): it loads lazily.
import { lazy } from "react";
import type { WorkflowsPart } from "../../parts";
import { DESIGNER_PATH } from "./model";

const DesignerPage = lazy(() => import("./DesignerPage"));

export const processPart: WorkflowsPart = {
  routes: [{ path: DESIGNER_PATH, element: <DesignerPage /> }],
};
