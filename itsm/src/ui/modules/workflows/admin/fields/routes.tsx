// The «فیلدها» part of the module (design F §8, D13; package F5): the settings row in «فرم‌ها و گردش‌کارها» and the
// route settings/fields, which takes over the records module's custom-field manager; settings/choices — the old
// choice-list page — now opens the «فهرست‌های گزینه» tab with its `?list=`. The row is for the people of
// «طراحی فرم و گردش‌کار» (process_design: designers, publishers, auditors, the organisation's administrators); each
// tab asks for what its API asks.
import { lazy } from "react";
import { Navigate, useLocation } from "react-router";
import { TextCursorInput } from "lucide-react";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import { useOrg } from "../../../../lib/org";
import type { WorkflowsPart } from "../../parts";

const FieldsPage = lazy(() => import("./FieldsPage"));

/** settings/choices?list=… → settings/fields?tab=choices&list=… (the query part) */
export function choicesSearch(search: string): string {
  const p = new URLSearchParams(search);
  p.set("tab", "choices");
  return `?${p.toString()}`;
}

function OldChoices() {
  const { search } = useLocation();
  const { orgId } = useOrg();
  return <Navigate to={`/${orgId}/settings/fields${choicesSearch(search)}`} replace />;
}

export const fieldsPart: WorkflowsPart = {
  settings: [
    {
      key: "workflows:fields",
      label: "فیلدها",
      path: "settings/fields",
      icon: TextCursorInput,
      access: { area: PROCESS_DESIGN_AREA },
      keywords: "فیلد کتابخانه نوع فیلد کد ملی شبا مبلغ پیوست فهرست گزینه فیلد سفارشی الزامی پنهان در فرم برچسب",
    },
  ],
  routes: [
    { path: "settings/fields", element: <FieldsPage /> },
    { path: "settings/choices", element: <OldChoices /> },
  ],
};
