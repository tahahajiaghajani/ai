// The SLA service's screens (docs/spec/services/sla.md §7). Two nav groups:
//   «تأییدها» (home space): «تأییدهای من» — approve or reject, one by one or many at once — and «جانشینی‌ها»;
//   «توافق‌ها و قواعد» (settings space): working calendars, holidays (by Jalali month, official calendar seeding),
//   SLA definitions and timers, approval rules, business and assignment rules, priority matrices, categories and UI
//   policies — generic record lists and forms, with special editors as record-page tabs (the calendar's week, the SLA
//   definition's targets and timeline preview, the approval rule's levels, the matrix grid) and two pages of their
//   own (holidays, the category tree).
// On every record: an «تأییدها» side panel (tables with an approval field) and a «توافق‌ها» tab (records with SLA
// timers). The record UI gets the organisation's holidays and stored UI policies through its pluggable sources.
// Only light modules are imported here; every component loads with its page.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  CalendarClock, CalendarX, Timer, Hourglass, Stamp, UserRoundCheck, Workflow, Route, Grid3x3, FolderTree, SlidersHorizontal,
} from "lucide-react";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { registerRecordExtensions, setHolidaySource, setPolicySource, type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";
import { approvalsApi, holidaySource, policySource } from "./api";

const Approvals = lazy(() => import("./Approvals"));
const Holidays = lazy(() => import("./Holidays"));
const Categories = lazy(() => import("./Categories"));
const ApprovalsPanel = lazy(() => import("./ApprovalsPanel"));
const SlaTimeline = lazy(() => import("./SlaTimeline"));
const WeekEditor = lazy(() => import("./WeekEditor"));
const SlaPreview = lazy(() => import("./SlaPreview"));
const LevelsBuilder = lazy(() => import("./LevelsBuilder"));
const MatrixEditor = lazy(() => import("./MatrixEditor"));

/** A record-page widget that loads with first use. */
const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);

/** The service's own tables: no approvals panel, no SLA tab. */
const OWN = new Set(["calendar", "holiday", "sla_definition", "task_sla", "approval_rule", "approval", "delegation", "business_rule", "assignment_rule", "priority_matrix", "category", "ui_policy"]);

const RULES = "قواعد رکوردها";
const SLAS = "توافق‌ها و تقویم‌ها";

const settingsUi = recordModule({
  key: "sla",
  spaceKey: "settings",
  group: { key: "sla", label: "توافق‌ها و قواعد" },
  tables: [
    {
      table: "calendar", path: "sla/calendars", label: "تقویم‌های کاری", noun: "تقویم کاری", icon: CalendarClock, section: SLAS, area: "settings",
      keywords: "ساعات کاری شیفت هفته منطقه زمانی تعطیل",
      extensions: {
        tabs: [{ key: "week", label: "ساعات کاری", order: 1, render: widget(WeekEditor) }],
        policies: [{ key: "sla:hours", actions: [{ field: "hours", visible: false, mandatory: false }] }],
      },
    },
    { table: "holiday", path: "sla/holiday-records", label: "تعطیلات", noun: "تعطیلی", icon: CalendarX, hidden: true, search: false, newAction: false, area: "settings" },
    {
      table: "sla_definition", path: "sla/definitions", label: "تعریف‌های توافق", noun: "تعریف توافق", icon: Timer, section: SLAS, area: "settings",
      keywords: "SLA OLA UC توافق سطح خدمت پاسخ حل هدف موعد هشدار نقض",
      extensions: {
        tabs: [{ key: "targets", label: "اهداف و پیش‌نمایش", order: 1, render: widget(SlaPreview) }],
        policies: [{ key: "sla:targets", on: "update", actions: [{ field: "durations", visible: false }, { field: "warn_percents", visible: false }] }],
      },
    },
    {
      table: "task_sla", path: "sla/timers", label: "زمان‌سنج‌ها", noun: "زمان‌سنج", icon: Hourglass, section: SLAS, area: "settings", newAction: false, search: false,
      keywords: "نقض موعد زمان‌سنج توافق در جریان",
      list: { preset: { quick: [], rowTone: (r) => (r.breached ? "danger" : null) } },
    },
    {
      table: "approval_rule", path: "sla/approval-rules", label: "قاعده‌های تأیید", noun: "قاعدهٔ تأیید", icon: Stamp, section: RULES, area: "settings",
      keywords: "تأیید سطح مدیر گروه تفکیک وظایف مهلت یادآوری",
      extensions: {
        tabs: [{ key: "levels", label: "سطح‌های تأیید", order: 1, render: widget(LevelsBuilder) }],
        policies: [{ key: "sla:levels", actions: [{ field: "levels", visible: false, mandatory: false }] }],
      },
    },
    { table: "business_rule", path: "sla/business-rules", label: "قاعده‌های کسب‌وکار", noun: "قاعدهٔ کسب‌وکار", icon: Workflow, section: RULES, area: "settings", keywords: "قاعده پیش از ذخیره پس از ذخیره مقدار یادداشت توقف" },
    { table: "assignment_rule", path: "sla/assignment-rules", label: "قاعده‌های ارجاع", noun: "قاعدهٔ ارجاع", icon: Route, section: RULES, area: "settings", keywords: "ارجاع نوبتی کم‌کار مهارت آماده‌به‌کار گروه کارشناس" },
    {
      table: "priority_matrix", path: "sla/priority-matrices", label: "ماتریس اولویت", noun: "ماتریس اولویت", icon: Grid3x3, section: RULES, area: "settings",
      keywords: "اثر فوریت اولویت ITIL",
      extensions: {
        tabs: [{ key: "grid", label: "جدول اولویت", order: 1, render: widget(MatrixEditor) }],
        policies: [{ key: "sla:cells", actions: [{ field: "cells", visible: false, mandatory: false }] }],
      },
    },
    { table: "category", path: "sla/category-records", label: "دسته‌بندی‌ها", noun: "دسته", icon: FolderTree, hidden: true, search: false, newAction: false, area: "settings" },
    { table: "ui_policy", path: "sla/ui-policies", label: "سیاست‌های فرم", noun: "سیاست فرم", icon: SlidersHorizontal, section: RULES, area: "settings", keywords: "فرم الزامی فقط‌خواندنی پنهان شرط" },
  ],
  nav: [
    { key: "sla:holidays", label: "تعطیلات", path: "sla/holidays", icon: CalendarX, section: SLAS, area: "settings", keywords: "تعطیل رسمی نوروز قمری نیمه‌تعطیل تقویم" },
    { key: "sla:categories", label: "دسته‌بندی‌ها", path: "sla/categories", icon: FolderTree, section: RULES, area: "settings", keywords: "دسته زیردسته درخت گروه پیش‌فرض" },
  ],
  routes: [
    { path: "sla/holidays", element: <Holidays /> },
    { path: "sla/categories", element: <Categories /> },
  ],
  segments: { sla: "settings" },
});

const approvalsUi = recordModule({
  key: "approvals",
  spaceKey: "home",
  group: { key: "approvals", label: "تأییدها" },
  tables: [
    { table: "delegation", path: "approvals/delegations", label: "جانشینی‌ها", noun: "جانشینی", icon: UserRoundCheck, search: false, keywords: "جانشین مرخصی غیبت تفویض تأیید ارجاع" },
    { table: "approval", path: "approvals/records", label: "تأییدها", noun: "تأیید", icon: Stamp, hidden: true, search: false, newAction: false },
  ],
  routes: [{ path: "approvals", element: <Approvals /> }],
  segments: { approvals: "home" },
});

const mine = {
  key: "approvals:mine",
  label: "تأییدهای من",
  path: "approvals",
  icon: Stamp,
  workspace: true,
  keywords: "تأیید رد درخواست تأیید کارتابل",
  count: { key: "approvals:mine", hint: "تأیید در انتظار شما", load: approvalsApi.count },
};

/** Sidebar order of the settings group (tables and pages interleaved). */
const ORDER = ["calendar", "holidays", "sla_definition", "task_sla", "approval_rule", "business_rule", "assignment_rule", "priority_matrix", "categories", "ui_policy"];
const rank = (key: string) => {
  const i = ORDER.indexOf(key.split(":")[1] ?? "");
  return i < 0 ? ORDER.length : i;
};

export const slaUi: ModuleUi = {
  nav: [
    ...approvalsUi.nav.map((g) => ({ ...g, items: [mine, ...g.items] })),
    ...settingsUi.nav.map((g) => ({ ...g, items: [...g.items].sort((a, b) => rank(a.key) - rank(b.key)) })),
  ],
  routes: [...approvalsUi.routes, ...settingsUi.routes],
  searches: [...(approvalsUi.searches ?? []), ...(settingsUi.searches ?? [])],
  segments: { ...approvalsUi.segments, ...settingsUi.segments },
};

// every record: its approvals (tables with an approval field) and its SLA timers
registerRecordExtensions("*", {
  sidePanels: [
    {
      key: "sla:approvals",
      title: "تأییدها",
      order: 5,
      when: (ctx) => !OWN.has(ctx.table) && ctx.def.fields.some((f) => f.name === "approval"),
      render: widget(ApprovalsPanel),
      // an approver without a role in the record's area decides here
      participants: true,
    },
  ],
  tabs: [
    {
      key: "sla:timers",
      label: "توافق‌ها",
      order: 50,
      when: (ctx) => !OWN.has(ctx.table) && Array.isArray((ctx.meta as { sla?: unknown }).sla) && ((ctx.meta as { sla?: unknown[] }).sla ?? []).length > 0,
      render: widget(SlaTimeline),
    },
  ],
});

setHolidaySource(holidaySource);
setPolicySource(policySource);
