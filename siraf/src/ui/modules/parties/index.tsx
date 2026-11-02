import { lazy } from "react";
import { Users, UsersRound } from "lucide-react";
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

export const partiesNav: Omit<NavGroup, "icon" | "space"> = {
  key: "parties",
  label: "اشخاص",
  items: [
    { key: "parties", label: "اشخاص", path: "parties", area: "parties", icon: Users, common: true, keywords: "مشتری تأمین‌کننده طرف حساب" },
    { key: "party-groups", label: "گروه‌های اشخاص", path: "parties/groups", area: "parties", icon: UsersRound, section: "تعریف‌ها" },
  ],
};

export const partiesRoutes: AppRoute[] = [
  { path: "parties", element: <PartiesPage /> },
  { path: "parties/groups", element: <EntityPage entity="party_group" /> },
  { path: "parties/:id", element: <PartyProfile /> },
];
