// DevOps screens (docs/modules/devops_FA.md), in the space «انتشار» with the group «دواپس»:
//   pages         «نمای خط لوله» (services × environments, latest deployment and promotions), «شاخص‌های DORA»
//   lists         connections (definitions: release managers), repositories, pipelines, deployment gates, received
//                 events, commits, pull requests, pipeline runs, the technical debt register
//   record page   connection: URLs, «ساخت راز» (shown once), new URL key, test delivery; gate: decisions; event:
//                 process again
//   elsewhere     the side panel «توسعه» on changes, releases, incidents, problems and known errors (DEV-004)
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Plug, GitBranch, Workflow, ShieldCheck, Inbox, GitCommitHorizontal, GitPullRequest, Hammer, Landmark, Route, Activity } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";

const Pipeline = lazy(() => import("./Pipeline"));
const Dora = lazy(() => import("./Dora"));
const ConnectionActions = lazy(() => import("./Panels").then((m) => ({ default: m.ConnectionActions })));
const ConnectionUrls = lazy(() => import("./Panels").then((m) => ({ default: m.ConnectionUrls })));
const GateActions = lazy(() => import("./Panels").then((m) => ({ default: m.GateActions })));
const EventRetry = lazy(() => import("./Panels").then((m) => ({ default: m.EventRetry })));
const DevelopmentPanel = lazy(() => import("./Panels").then((m) => ({ default: m.DevelopmentPanel })));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const action = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const READS: AccessGate = { area: "release" };
const MANAGES: AccessGate = { area: "release", op: "approve" };
const DATA = "داده‌های توسعه";

const module = recordModule({
  key: "devops",
  spaceKey: "release",
  group: { key: "devops", label: "دواپس" },
  tables: [
    {
      table: "devops_connection", path: "devops/connections", label: "اتصال‌ها", noun: "اتصال دواپس", icon: Plug, area: "work", access: MANAGES, keywords: "اتصال وب‌هوک گیت‌هاب گیت‌لب جنکینز Azure DevOps",
      extensions: {
        headerActions: action("devops-connection", ConnectionActions),
        sidePanels: [{ key: "devops:urls", title: "نشانی‌ها", order: 1, render: widget(ConnectionUrls) }],
      },
    },
    { table: "dev_repository", path: "devops/repositories", label: "مخزن‌ها", noun: "مخزن کد", icon: GitBranch, area: "work", access: READS, newAction: false, keywords: "مخزن کد repository" },
    { table: "dev_pipeline", path: "devops/pipelines", label: "خط لوله‌ها", noun: "خط لوله", icon: Workflow, area: "work", access: READS, newAction: false, keywords: "خط لوله pipeline CI CD" },
    {
      table: "change_gate", path: "devops/gates", label: "دروازه‌های استقرار", noun: "دروازهٔ استقرار", icon: ShieldCheck, area: "work", access: READS, newAction: false, keywords: "دروازه مجوز استقرار gate",
      extensions: { headerActions: action("devops-gate", GateActions) },
    },
    {
      table: "dev_event", path: "devops/events", label: "رویدادهای دریافتی", icon: Inbox, section: DATA, area: "work", access: READS, newAction: false, search: false, keywords: "رویداد وب‌هوک تحویل",
      extensions: { headerActions: action("devops-event", EventRetry) },
    },
    { table: "dev_commit", path: "devops/commits", label: "کامیت‌ها", icon: GitCommitHorizontal, section: DATA, area: "work", access: READS, newAction: false, keywords: "کامیت commit" },
    { table: "dev_pull_request", path: "devops/pull-requests", label: "درخواست‌های ادغام", icon: GitPullRequest, section: DATA, area: "work", access: READS, newAction: false, keywords: "درخواست ادغام pull request merge" },
    { table: "dev_build", path: "devops/builds", label: "اجراهای خط لوله", icon: Hammer, section: DATA, area: "work", access: READS, newAction: false, search: false, keywords: "اجرا بیلد build" },
    { table: "tech_debt", path: "devops/tech-debt", label: "بدهی فنی", noun: "بدهی فنی", icon: Landmark, area: "work", access: READS, keywords: "بدهی فنی technical debt" },
  ],
  nav: [
    { key: "devops:pipeline", label: "نمای خط لوله", path: "devops/pipeline", icon: Route, area: "work", access: READS, workspace: true, keywords: "خط لوله محیط نسخه ارتقا" },
    { key: "devops:dora", label: "شاخص‌های DORA", path: "devops/dora", icon: Activity, section: "گزارش‌ها", area: "work", access: READS, keywords: "DORA تناوب استقرار زمان تحویل نرخ شکست بازیابی" },
  ],
  routes: [
    { path: "devops/pipeline", element: lazyPage(<Pipeline />) },
    { path: "devops/dora", element: lazyPage(<Dora />) },
  ],
  segments: { devops: "release" },
});

// the development panel on the records work is done for
for (const table of ["change_request", "release", "incident", "problem", "known_error"]) {
  registerRecordExtensions(table, { sidePanels: [{ key: "devops:development", title: "توسعه", order: 30, when: (ctx) => !!ctx.schema.def("dev_commit"), render: widget(DevelopmentPanel) }] });
}

export const devopsUi: ModuleUi = module;
