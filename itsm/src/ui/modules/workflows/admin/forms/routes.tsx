// The «فرم‌ها» part of the module (design F §8.2, D13; package F5): the settings row in «فرم‌ها و گردش‌کارها» and the
// routes settings/forms (every form of the system), settings/forms/t/:table (a table's default form) and
// settings/forms/:id (a process form) — taking over the records module's «چیدمان فرم‌ها». Its old address
// settings/forms?table=… (the studio's link) opens that table's form. The row is for the people of «طراحی فرم و
// گردش‌کار» (process_design); GET /forms also lets `settings` editors in, who reach it from the studio and old links.
import { lazy } from "react";
import { Navigate, useLocation } from "react-router";
import { FileText } from "lucide-react";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import { useOrg } from "../../../../lib/org";
import { SETTINGS_GROUP, type WorkflowsPart } from "../../parts";
import { oldLayoutTarget } from "./model";

const FormsPage = lazy(() => import("./FormsPage"));
const SystemDesigner = lazy(() => import("./SystemDesigner"));
const ProcessDesigner = lazy(() => import("./ProcessDesigner"));

/** settings/forms, or the old layout editor's address (?table=) → that table's form. */
function Forms() {
  const { search } = useLocation();
  const { orgId } = useOrg();
  const target = oldLayoutTarget(search);
  return target ? <Navigate to={`/${orgId}/${target}`} replace /> : <FormsPage />;
}

export const formsPart: WorkflowsPart = {
  settings: [
    {
      key: "workflows:forms",
      label: "فرم‌ها",
      path: "settings/forms",
      icon: FileText,
      section: SETTINGS_GROUP.label,
      access: { area: PROCESS_DESIGN_AREA },
      keywords: "فرم چیدمان زبانه بخش فرم سامانه فرم گردش‌کار فرم کاتالوگ گزارش مشکل نظرسنجی پرسش‌نامه ریسک پنهان در فرم الزامی",
    },
  ],
  routes: [
    { path: "settings/forms", element: <Forms /> },
    { path: "settings/forms/t/:table", element: <SystemDesigner /> },
    { path: "settings/forms/:id", element: <ProcessDesigner /> },
  ],
};
