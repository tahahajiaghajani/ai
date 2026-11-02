import { lazy } from "react";
import { useNavigate } from "react-router";
import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";
import { useOrg } from "../../lib/org";

const PartyProfile = lazy(() => import("./PartyProfile"));

function PartiesPage() {
  const nav = useNavigate();
  const { orgId } = useOrg();
  return <EntityPage entity="party" onOpen={(r) => nav(`/${orgId}/parties/${r.id}`)} rowActions={(r) => [{ key: "open", label: "پرونده و صورتحساب", onClick: () => nav(`/${orgId}/parties/${r.id}`) }]} drawerWidth={820} />;
}

export const partiesNav: Omit<NavGroup, "icon"> = {
  key: "parties",
  label: "اشخاص",
  items: [
    { key: "parties", label: "اشخاص (مشتری، تأمین‌کننده…)", path: "parties", area: "parties", keywords: "مشتری طرف حساب" },
    { key: "party-groups", label: "گروه‌های اشخاص", path: "parties/groups", area: "parties" },
  ],
};

export const partiesRoutes: AppRoute[] = [
  { path: "parties", element: <PartiesPage /> },
  { path: "parties/groups", element: <EntityPage entity="party_group" /> },
  { path: "parties/:id", element: <PartyProfile /> },
];
