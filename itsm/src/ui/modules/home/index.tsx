// «خانه»: the page every member lands on in an organisation. It sits at the top of every space of the sidebar.
import { lazy } from "@ui/lib/lazy";
import { House } from "lucide-react";
import type { ModuleUi } from "../registry";

const Home = lazy(() => import("./Home"));

export const homeUi: ModuleUi = {
  nav: [{ key: "home", label: "خانه", space: "home", items: [{ key: "home", label: "خانه", path: "", icon: House, common: true, keywords: "شروع پیشخوان داشبورد" }] }],
  routes: [{ path: "", element: <Home /> }],
};
