// The data sources' screens (design A §15, docs/modules/discovery_FA.md): a group of the «پیکربندی و دارایی‌ها» space
// with the section «منبع‌های داده». Routes under `discovery/…`:
//   discovery          the console: one card per connector the person reads (CMDB readers)
//   discovery/new      the wizard (CMDB administrators; the palette's «منبع داده تازه»)
//   discovery/:id      one connector: summary, passes, settings by kind; run, cancel, test, preview, accept a new size
// The Windows app neither runs nor shows connectors (§14.7): the items are `cloudOnly` (the web version and the
// server edition). Pages load with first use.
import { lazy, Suspense, type ReactNode } from "react";
import { Plus, Radar } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi } from "../registry";
import { Loader } from "../../components/display";

const Console = lazy(() => import("./Console"));
const Wizard = lazy(() => import("./Wizard"));
const Connector = lazy(() => import("./Connector"));

const page = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

/** Connectors are read by CMDB readers (service.ts needReader) and made by CMDB administrators (guard.ts). */
export const DISCOVERY_READS: AccessGate = { area: "cmdb" };
export const DISCOVERY_ADMIN: AccessGate = { area: "cmdb", op: "admin" };
/** The section of the space the module's pages sit in. */
export const DISCOVERY_SECTION = "منبع‌های داده";

export const discoveryUi: ModuleUi = {
  nav: [
    {
      key: "discovery",
      label: "منبع‌های داده",
      space: "assets",
      items: [
        {
          key: "discovery:console",
          label: "منبع‌های داده",
          path: "discovery",
          icon: Radar,
          section: DISCOVERY_SECTION,
          access: DISCOVERY_READS,
          cloudOnly: true,
          keywords: "منبع داده کشف پایش Zabbix PRTG vCenter REST CSV ابزار اتصال",
        },
        {
          key: "discovery:new",
          label: "منبع داده تازه",
          path: "discovery/new",
          icon: Plus,
          section: DISCOVERY_SECTION,
          access: DISCOVERY_ADMIN,
          cloudOnly: true,
          action: true,
          keywords: "افزودن منبع داده ابزار پایش کشف",
        },
      ],
    },
  ],
  routes: [
    { path: "discovery", element: page(<Console />) },
    { path: "discovery/new", element: page(<Wizard />) },
    { path: "discovery/:id", element: page(<Connector />) },
  ],
  segments: { discovery: "assets" },
};
