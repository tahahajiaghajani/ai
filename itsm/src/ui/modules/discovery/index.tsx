// The data sources' screens (design A §15, docs/modules/discovery_FA.md): a group of the «پیکربندی و دارایی‌ها» space
// with the section «منبع‌های داده». Routes under `discovery/…`:
//   discovery            the console: one card per connector the person reads (CMDB readers)
//   discovery/new        the wizard (CMDB administrators; the palette's «منبع داده تازه»)
//   discovery/reconcile  «صف آشتی»: unmatched, duplicate, failed items and differences with the asset register
//   discovery/status     «وضعیت پایش»: the CIs and assets the person reads with their tools' status (CMDB readers and
//                        asset readers beyond their own — a branch officer sees own-branch assets, no tool names)
//   discovery/:id        one connector: summary, passes, items, mapping, settings by kind, receiving alerts
// The side panel «منبع‌ها و وضعیت پایش» on CI and asset pages shows where the record's meta says so (the server's
// panel.ts). The Windows app neither runs nor shows connectors (§14.7): the items are `cloudOnly` (the web version and
// the server edition). Pages load with first use.
import type { ReactNode } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import { Activity, ListChecks, Plus, Radar } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi } from "../registry";
import { Loader } from "../../components/display";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { showsPanel, STATUS_READS } from "./model";

const Console = lazy(() => import("./Console"));
const Wizard = lazy(() => import("./Wizard"));
const Connector = lazy(() => import("./Connector"));
const Queue = lazy(() => import("./Queue"));
const Board = lazy(() => import("./Board"));
const Panel = lazy(() => import("./Panel"));

const page = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

/** Connectors are read by CMDB readers (service.ts needReader) and made by CMDB administrators (guard.ts). */
export const DISCOVERY_READS: AccessGate = { area: "cmdb" };
export const DISCOVERY_ADMIN: AccessGate = { area: "cmdb", op: "admin" };
/** The section of the space the module's pages sit in. */
export const DISCOVERY_SECTION = "منبع‌های داده";

// «منبع‌ها و وضعیت پایش» on the pages of CIs and assets
for (const table of ["ci", "asset"]) {
  registerRecordExtensions(table, {
    sidePanels: [
      {
        key: "discovery:panel",
        title: "منبع‌ها و وضعیت پایش",
        order: 30,
        when: (ctx: RecordContext) => showsPanel(ctx.meta),
        render: (ctx: RecordContext) => (
          <Suspense fallback={<Loader />}>
            <Panel ctx={ctx} />
          </Suspense>
        ),
      },
    ],
  });
}

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
          key: "discovery:reconcile",
          label: "صف آشتی",
          path: "discovery/reconcile",
          icon: ListChecks,
          section: DISCOVERY_SECTION,
          access: DISCOVERY_READS,
          cloudOnly: true,
          keywords: "صف آشتی بی‌همتا تکراری خطا ناهمخوانی منبع داده پیوند",
        },
        {
          key: "discovery:status",
          label: "وضعیت پایش",
          path: "discovery/status",
          icon: Activity,
          section: DISCOVERY_SECTION,
          access: STATUS_READS,
          cloudOnly: true,
          keywords: "وضعیت پایش قطع هشدار بی‌پاسخ خودپرداز تماس",
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
    { path: "discovery/reconcile", element: page(<Queue />) },
    { path: "discovery/status", element: page(<Board />) },
    { path: "discovery/:id", element: page(<Connector />) },
  ],
  segments: { discovery: "assets" },
};
