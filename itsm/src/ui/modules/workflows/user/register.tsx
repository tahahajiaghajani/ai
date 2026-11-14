// The person's «گردش‌کارها» beyond its own pages (design F §5, package F7): the home page's card «موارد منتظر شما»
// (`registerHomeWidget`). Imported once by the module (../index.tsx); the card loads with its first use.
import { lazy, Suspense } from "react";
import { registerHomeWidget } from "../../home/widgets";

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
