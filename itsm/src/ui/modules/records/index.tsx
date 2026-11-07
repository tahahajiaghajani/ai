// The record engine's generic screens: every table at `r/:table`, `r/:table/new` and `r/:table/:id` (so a table works
// the moment it is registered), «کارها» (the engine's demo table `todo`) built with `recordModule` the way ITSM
// modules build theirs, and the designers of Settings › «سفارشی‌سازی»: custom fields, choice lists, form layouts
// and saved views. See docs/spec/UI_RECORDS.md.
import { lazy } from "react";
import { useNavigate } from "react-router";
import { Button } from "antd";
import { Bookmark, LayoutTemplate, List, ListChecks, ListPlus, ExternalLink } from "lucide-react";
import { useOrg } from "../../lib/org";
import { recordModule, RecordListRoute, RecordPageRoute } from "../../records/module";
import { registerRecordExtensions, tablePath, type RecordContext } from "../../records/extensions";
import type { ModuleUi } from "../registry";

const CustomFields = lazy(() => import("../../records/admin/CustomFields"));
const ChoiceLists = lazy(() => import("../../records/admin/ChoiceLists"));
const FormLayoutEditor = lazy(() => import("../../records/admin/FormLayoutEditor"));
const ViewsManager = lazy(() => import("../../records/admin/ViewsManager"));

/** «نمایش فهرست» on a saved view's page: its table's list with the view applied. */
function OpenView({ ctx }: { ctx: RecordContext }) {
  const nav = useNavigate();
  const { orgId } = useOrg();
  const table = String(ctx.row.table_key ?? "");
  if (!table) return null;
  return (
    <Button icon={<ExternalLink size={16} strokeWidth={1.4} absoluteStrokeWidth />} onClick={() => nav(`/${orgId}/${tablePath(table)}?view=${ctx.row.id}`)}>
      نمایش فهرست
    </Button>
  );
}
registerRecordExtensions("view", { headerActions: (ctx) => <OpenView key="open-view" ctx={ctx} /> });

const work = recordModule({
  key: "records",
  spaceKey: "home",
  group: { key: "work", label: "کارها" },
  tables: [
    {
      table: "todo",
      path: "todo",
      label: "کارها",
      noun: "کار",
      icon: ListChecks,
      area: "work",
      workspace: true,
      keywords: "کار وظیفه پیگیری تابلو تقویم todo",
      search: { group: "کارها" },
      // the timeline of «کارها»: from when a task was opened to its due date
      list: { preset: { timeline: { start: "opened_at", end: "due_at" } } },
    },
  ],
});

export const recordsUi: ModuleUi = {
  ...work,
  nav: [
    ...work.nav,
    {
      key: "records-admin",
      label: "سفارشی‌سازی",
      space: "settings",
      items: [
        { key: "custom-fields", label: "فیلدهای سفارشی", path: "settings/fields", area: "settings", icon: ListPlus, section: "سفارشی‌سازی", keywords: "فیلد سفارشی برچسب الزامی ستون" },
        { key: "choice-lists", label: "فهرست‌های گزینه", path: "settings/choices", area: "settings", icon: List, section: "سفارشی‌سازی", keywords: "گزینه دسته رنگ ترتیب فهرست" },
        { key: "form-layouts", label: "چیدمان فرم‌ها", path: "settings/forms", area: "settings", icon: LayoutTemplate, section: "سفارشی‌سازی", keywords: "فرم بخش زبانه چیدمان" },
        { key: "saved-views", label: "نماهای ذخیره‌شده", path: "settings/views", icon: Bookmark, section: "سفارشی‌سازی", keywords: "نما فیلتر صف پیش‌فرض اشتراکی" },
      ],
    },
  ],
  routes: [
    ...work.routes,
    { path: "r/:table", element: <RecordListRoute /> },
    { path: "r/:table/new", element: <RecordPageRoute id="new" /> },
    { path: "r/:table/:id", element: <RecordPageRoute /> },
    { path: "settings/fields", element: <CustomFields /> },
    { path: "settings/choices", element: <ChoiceLists /> },
    { path: "settings/forms", element: <FormLayoutEditor /> },
    { path: "settings/views", element: <ViewsManager /> },
  ],
  segments: { r: "home" },
};
