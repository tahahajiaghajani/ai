// The person's «گردش‌کارها» in the module (design F §5, §8.6; package F7): the home space's row «گردش‌کارها» with its
// count (my open steps plus my pending record approvals, GET /process/inbox/count; «زنده» refreshes it when tasks or
// approvals change), and the routes —
//   workflows                  the four tabs                 workflows/p/:key        a process's diagram
//   workflows/start/:key       «پروندهٔ تازه»                 workflows/c/:id         a case
//   workflows/c/:id/s/:task    the case with my step's form  workflows/c/:id/print   its printable view
//   r/process_case/:id         the seeded notifications' record link: the case, with my step open
// Every member has the row: what waits for them is theirs (the server answers per person). The pages load lazily.
import { lazy } from "react";
import { Navigate, useParams } from "react-router";
import { Waypoints } from "lucide-react";
import { useOrg } from "../../../lib/org";
import type { WorkflowsPart } from "../parts";
import { userApi } from "./api";
import { CASE_PATH, PRINT_PATH, PROCESS_PATH, RECORD_CASE_PATH, START_PATH, STEP_PATH, WF_PATH, wfPaths } from "./model";

const WorkflowsPage = lazy(() => import("./WorkflowsPage"));
const ProcessPage = lazy(() => import("./ProcessPage"));
const StartPage = lazy(() => import("./StartPage"));
const CasePage = lazy(() => import("./CasePage"));
const PrintPage = lazy(() => import("./PrintPage"));

/** The record page of a case (a notification's link) opens the case here, with my open step. */
function CaseRedirect() {
  const { id = "" } = useParams();
  const { orgId } = useOrg();
  return <Navigate to={`/${orgId}/${wfPaths(WF_PATH).kase(id)}?open=step`} replace />;
}

export const userPart: WorkflowsPart = {
  home: [
    {
      key: "workflows:mine",
      label: "گردش‌کارها",
      path: WF_PATH,
      icon: Waypoints,
      workspace: true,
      keywords: "گردش‌کار کارتابل مرحله پرونده تأیید فرایند فرآیند درخواست شروع",
      count: { key: "workflows:waiting", hint: "مورد منتظر شما", load: userApi.count, tables: ["process_task", "approval"] },
    },
  ],
  routes: [
    { path: WF_PATH, element: <WorkflowsPage /> },
    { path: PROCESS_PATH, element: <ProcessPage /> },
    { path: START_PATH, element: <StartPage /> },
    { path: CASE_PATH, element: <CasePage /> },
    { path: STEP_PATH, element: <CasePage /> },
    { path: PRINT_PATH, element: <PrintPage /> },
    { path: RECORD_CASE_PATH, element: <CaseRedirect /> },
  ],
  segments: { workflows: "home" },
};
