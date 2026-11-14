// The kit's part of the module: «کیت گردش‌کار», the living reference of the kit's components (settings: full, like
// «راهنمای طراحی»). It is no menu row: the designer and the user pages are the kit's real homes.
import { lazy } from "react";
import type { WorkflowsPart } from "../parts";

const Gallery = lazy(() => import("./Gallery"));

export const kitPart: WorkflowsPart = {
  routes: [{ path: "settings/workflows-kit", element: <Gallery /> }],
};
