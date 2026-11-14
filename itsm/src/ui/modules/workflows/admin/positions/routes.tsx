// The «نقش‌های سازمانی» part of the module (design F §3.4, §8; package F5): the settings row in «فرم‌ها و گردش‌کارها»
// for the people who design workflows (`process_design`), and the route settings/positions. The keepers of the
// organisation structure reach the same page from «سازمان و دسترسی» (its own row, gated by `org` write).
import { lazy } from "@ui/lib/lazy";
import { BriefcaseBusiness } from "lucide-react";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import type { NavItem } from "../../../registry";
import { SETTINGS_GROUP, type WorkflowsPart } from "../../parts";

const PositionsPage = lazy(() => import("./PositionsPage"));

const KEYWORDS = "نقش سازمانی سمت پست رئیس شعبه معاون دارنده کفیل سرپرست موقت انجام‌دهنده گردش‌کار AD";

/** The row of «سازمان و دسترسی» (the access module lists it): keepers of the structure, `org` write in a unit or wider. */
export const POSITIONS_ACCESS_ROW: NavItem = {
  key: "access:positions",
  label: "نقش‌های سازمانی",
  path: "settings/positions",
  icon: BriefcaseBusiness,
  section: "سازمان و دسترسی",
  access: { area: "org", op: "write", scope: "unit" },
  keywords: KEYWORDS,
};

export const positionsPart: WorkflowsPart = {
  settings: [{ key: "workflows:positions", label: "نقش‌های سازمانی", path: "settings/positions", icon: BriefcaseBusiness, section: SETTINGS_GROUP.label, access: { area: PROCESS_DESIGN_AREA }, keywords: KEYWORDS }],
  routes: [{ path: "settings/positions", element: <PositionsPage /> }],
};
