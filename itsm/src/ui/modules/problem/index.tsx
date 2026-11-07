// Problem management's screens (docs/modules/problem_FA.md), in the «عملیات» space next to incidents, group «مشکلات»:
//   queues        «مشکلات من», «در انتظار ارزیابی», «در پایش پس از رفع», and every problem (list, board, saved views)
//   record pages  problem: «اقدام‌ها» (link incidents, merge duplicates, share the workaround or fix, a known error) and
//                 the «کارگاه تحلیل علت» tab (RCA canvas); candidate: promote or merge; task: copy findings
//   lists         known errors (KEDB), candidates (with «اجرای قاعده‌ها»), corrective actions, problem tasks
//   pages         the dashboard; the settings row opens from «تنظیمات رخداد و مشکل»
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Bug, BookAlert, Radar, ShieldCheck, ListTodo, ChartColumn, User, Search, Activity } from "lucide-react";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";
import { PROBLEM_QUEUES, type ProblemQueue } from "./model";

const Actions = lazy(() => import("./ProblemActions").then((m) => ({ default: m.ProblemActions })));
const Candidate = lazy(() => import("./ProblemActions").then((m) => ({ default: m.CandidateActions })));
const Task = lazy(() => import("./ProblemActions").then((m) => ({ default: m.TaskActions })));
const RunCandidates = lazy(() => import("./RunCandidates"));
const Rca = lazy(() => import("./RcaCanvas"));
const Dashboard = lazy(() => import("./Dashboard"));

const widget = (C: ComponentType<{ ctx: RecordContext }>, key: string) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);

const ICONS: Record<string, typeof Bug> = { mine: User, triage: Search, monitoring: Activity };

const queueNav = (q: ProblemQueue): NavItem => ({ key: `problem:q:${q.key}`, label: q.label, path: q.path, icon: ICONS[q.key] ?? Bug, area: "work", keywords: "مشکل صف" });

const module = recordModule({
  key: "problem",
  spaceKey: "operations",
  group: { key: "problem", label: "مشکلات" },
  tables: [
    {
      table: "problem", path: "problems", label: "همهٔ مشکلات", noun: "مشکل", icon: Bug, area: "work",
      keywords: "مشکل علت ریشه‌ای تحلیل PRB", search: { group: "مشکلات" },
      list: { preset: { emptyText: "هنوز مشکلی ثبت نشده است" } },
      extensions: {
        headerActions: widget(Actions, "problem-actions"),
        tabs: [{ key: "problem:rca", label: "کارگاه تحلیل علت", order: 1, render: (ctx) => <Suspense fallback={<Loader />}><Rca ctx={ctx} /></Suspense> }],
        cardFields: ["priority", "assigned_to", "incident_count"],
        policies: [
          { key: "problem:pending", when: { f: "state", op: "ne", v: "pending" }, actions: [{ field: "pending_reason", visible: false }] },
          { key: "problem:duplicate", when: { f: "duplicate_of", op: "empty" }, actions: [{ field: "duplicate_of", visible: false }] },
        ],
      },
    },
    {
      table: "known_error", path: "known-errors", label: "خطاهای شناخته‌شده", noun: "خطای شناخته‌شده", icon: BookAlert, area: "work",
      keywords: "خطای شناخته‌شده راه‌حل موقت KEDB KE", search: { group: "خطاهای شناخته‌شده" },
    },
    {
      table: "problem_candidate", path: "problem-candidates", label: "نامزدهای مشکل", noun: "نامزد مشکل", icon: Radar, area: "work", newAction: false,
      keywords: "نامزد مشکل تکرار رخداد خوشه", search: false,
      list: { actions: <Suspense fallback={null}><RunCandidates /></Suspense>, preset: { quick: ["open"], emptyText: "نامزدی نیست؛ قاعده‌ها هر شب رخدادهای تکراری را بررسی می‌کنند" } },
      extensions: { headerActions: widget(Candidate, "candidate-actions") },
    },
    {
      table: "corrective_action", path: "corrective-actions", label: "اقدام‌های اصلاحی", noun: "اقدام اصلاحی", icon: ShieldCheck, area: "work",
      section: "کارها", keywords: "اقدام اصلاحی پیشگیرانه CAPA",
    },
    {
      table: "problem_task", path: "problem-tasks", label: "کارهای مشکل", noun: "کار مشکل", icon: ListTodo, area: "work", section: "کارها", newAction: false,
      keywords: "کار مشکل تحلیل PTASK",
      extensions: { headerActions: widget(Task, "task-actions") },
    },
    { table: "problem_config", path: "problems/settings/record", label: "تنظیمات مشکل", hidden: true, search: false, newAction: false },
  ],
  nav: [{ key: "problem:dashboard", label: "داشبورد مشکلات", path: "problems/dashboard", icon: ChartColumn, section: "گزارش‌ها", area: "work", keywords: "داشبورد مشکل بدهی فنی پارتو" }],
  routes: [
    ...PROBLEM_QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table={q.table} title={q.label} preset={{ filter: q.filter, sort: q.sort, columns: q.columns, emptyText: q.emptyText }} /> })),
    { path: "problems/dashboard", element: <Suspense fallback={<Loader />}><Dashboard /></Suspense> },
  ],
  segments: { problems: "operations", "known-errors": "operations", "problem-candidates": "operations", "corrective-actions": "operations", "problem-tasks": "operations" },
});

const [group] = module.nav;
export const problemUi: ModuleUi = { ...module, nav: [{ ...group, items: [...PROBLEM_QUEUES.map(queueNav), ...group.items] }] };
