// The person's «گردش‌کارها» beyond its own pages (design F §5, package F7): the home page's card «موارد منتظر شما»
// (`registerHomeWidget`), and «زنده» for the pages' reads — «کارتابل», a case, its diagram — which refresh when cases,
// steps or approvals change (another person's decision, the run moving a case on after mine); the step form keeps
// what is being typed. Imported once by the module (../index.tsx); the card loads with its first use.
import { lazy, Suspense } from "react";
import { registerLiveQueries, registerLiveTables } from "../../../lib/live";
import { registerHomeWidget } from "../../home/widgets";

registerLiveQueries("wf-user");
registerLiveTables("wf-user", ["process_case", "process_task", "approval"]);

const HomeWidget = lazy(() => import("./HomeWidget"));

registerHomeWidget({
  key: "workflows:waiting",
  order: 5,
  render: () => (
    <Suspense fallback={null}>
      <HomeWidget />
    </Suspense>
  ),
});
