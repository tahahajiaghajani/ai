// «سازمان و دسترسی»: the organisation structure (units, locations, groups, workspaces) and the access model (roles
// and the permission matrix, member access, the access checker) — a group of the settings space. The pages read
// the caller's effective access from /access/me and offer only what the server allows (docs/ACCESS_FA.md).
import { lazy } from "react";
import { Network, MapPin, Users, LayoutGrid, ShieldCheck, UserCog, SearchCheck } from "lucide-react";
import type { ModuleUi } from "../registry";

const OrgStructure = lazy(() => import("./OrgStructure"));
const Locations = lazy(() => import("./Locations"));
const Groups = lazy(() => import("./Groups"));
const Workspaces = lazy(() => import("./Workspaces"));
const Roles = lazy(() => import("./Roles"));
const MemberAccess = lazy(() => import("./MemberAccess"));
const AccessChecker = lazy(() => import("./AccessChecker"));

export const accessUi: ModuleUi = {
  nav: [
    {
      key: "access",
      label: "سازمان و دسترسی",
      space: "settings",
      items: [
        { key: "org-structure", label: "ساختار سازمانی", path: "access/org", area: "users", icon: Network, section: "سازمان و دسترسی", keywords: "واحد اداره معاونت شرکت مدیر واحد درخت سازمان دامنه" },
        { key: "locations", label: "مکان‌ها", path: "access/locations", area: "users", icon: MapPin, section: "سازمان و دسترسی", keywords: "شهر سایت ساختمان طبقه اتاق نشانی" },
        { key: "groups", label: "گروه‌ها", path: "access/groups", area: "users", icon: Users, section: "سازمان و دسترسی", keywords: "گروه پشتیبانی ارجاع تأیید سرپرست عضو" },
        { key: "workspaces", label: "فضاهای کاری", path: "access/workspaces", area: "users", icon: LayoutGrid, section: "سازمان و دسترسی", keywords: "میز خدمت منابع انسانی پشتیبانی فضای امن" },
        { key: "roles", label: "نقش‌ها و مجوزها", path: "access/roles", area: "users", icon: ShieldCheck, section: "سازمان و دسترسی", keywords: "نقش مجوز ماتریس دسترسی کارشناس درخواست‌دهنده ممیز" },
        { key: "member-access", label: "دسترسی اعضا", path: "access/members", area: "users", icon: UserCog, section: "سازمان و دسترسی", keywords: "نقش عضو جانشین غیبت پرسونا واحد مدیر مستقیم" },
        { key: "access-check", label: "بررسی دسترسی", path: "access/check", area: "users", icon: SearchCheck, section: "سازمان و دسترسی", keywords: "چرا نمی‌بیند توضیح دسترسی بررسی" },
      ],
    },
  ],
  routes: [
    { path: "access/org", element: <OrgStructure /> },
    { path: "access/locations", element: <Locations /> },
    { path: "access/groups", element: <Groups /> },
    { path: "access/workspaces", element: <Workspaces /> },
    { path: "access/roles", element: <Roles /> },
    { path: "access/members", element: <MemberAccess /> },
    { path: "access/check", element: <AccessChecker /> },
  ],
  segments: { access: "settings" },
};
