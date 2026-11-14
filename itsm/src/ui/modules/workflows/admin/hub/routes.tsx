// The hub's part of the module (design F §4, §8.3; package F6): the settings row «گردش‌کارها» in «فرم‌ها و گردش‌کارها»
// and the route settings/workflows. The row is for the people of «طراحی فرم و گردش‌کار» (process_design: designers,
// publishers, auditors, the organisation's administrators); GET /process/hub also lets `settings` editors in, who
// reach it by link and see the lifecycles. Its rows open the process designer (settings/workflows/p/:id, F6's second
// part), the lifecycle editor (settings/workflows/states/:table) and the other modules' own pages.
import { lazy } from "@ui/lib/lazy";
import { Waypoints } from "lucide-react";
import { SETTINGS_GROUP, type WorkflowsPart } from "../../parts";
import { HUB_GATE, HUB_PATH } from "./model";

const HubPage = lazy(() => import("./HubPage"));

export const hubPart: WorkflowsPart = {
  settings: [
    {
      key: "workflows:hub",
      label: "گردش‌کارها",
      path: HUB_PATH,
      icon: Waypoints,
      section: SETTINGS_GROUP.label,
      access: HUB_GATE,
      keywords: "گردش‌کار فرایند فرآیند مرحله انتشار نسخه بازنشسته چرخهٔ عمر وضعیت انتقال مدل تغییر قاعدهٔ تأیید جریان خودکار تأمین کاتالوگ سفر کارکنان دستورالعمل پاسخ امنیتی",
    },
  ],
  routes: [{ path: HUB_PATH, element: <HubPage /> }],
};
