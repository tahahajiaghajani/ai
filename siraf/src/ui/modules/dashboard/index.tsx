import { lazy } from "react";
import type { AppRoute } from "../registry";

const Dashboard = lazy(() => import("./Dashboard"));

export const dashboardRoutes: AppRoute[] = [{ path: "", element: <Dashboard /> }];
