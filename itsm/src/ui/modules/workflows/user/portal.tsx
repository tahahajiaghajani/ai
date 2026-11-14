// The person's «گردش‌کارها» in the portal's light shell (design F §5 «Navigation», §12.1; package F7): the same pages
// under `portal/workflows` — the four tabs, a process's diagram, «پروندهٔ تازه», a case and its step form, the printable
// view — so a requester does their steps without the full app. The portal mounts this at `portal/workflows/*`
// (src/ui/modules/portal/Shell.tsx); every page loads with its route.
import { lazy } from "react";
import { Route, Routes } from "react-router";
import { PortalWhere } from "./parts";

const WorkflowsPage = lazy(() => import("./WorkflowsPage"));
const ProcessPage = lazy(() => import("./ProcessPage"));
const StartPage = lazy(() => import("./StartPage"));
const CasePage = lazy(() => import("./CasePage"));
const PrintPage = lazy(() => import("./PrintPage"));

export default function PortalWorkflows() {
  return (
    <PortalWhere>
      <div className="wfu-portal">
        <Routes>
          <Route path="" element={<WorkflowsPage />} />
          <Route path="p/:key" element={<ProcessPage />} />
          <Route path="start/:key" element={<StartPage />} />
          <Route path="c/:id" element={<CasePage />} />
          <Route path="c/:id/s/:task" element={<CasePage />} />
          <Route path="c/:id/print" element={<PrintPage />} />
          <Route path="*" element={<WorkflowsPage />} />
        </Routes>
      </div>
    </PortalWhere>
  );
}
