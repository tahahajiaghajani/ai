// «از الگو» on the incident lists: the organisation's active templates (incident models) the person may use — those
// for every agent and those of their groups — each opening a new incident pre-filled from it; its tasks are created
// when the incident is saved.
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Dropdown, type MenuProps } from "antd";
import { LayoutTemplate } from "lucide-react";
import { templateParams } from "@shared/incident/logic";
import { useOrg } from "../../lib/org";
import { ICON14 } from "../../components/blocks";
import { newRecordPath, recordsApi } from "../../records";
import { useMyAccess } from "../access/api";

export default function TemplatePicker() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const me = useMyAccess();
  const q = useQuery({
    queryKey: ["incident", orgId, "templates"],
    queryFn: () => recordsApi.list(api, "incident_template", { filter: { f: "active", op: "eq", v: true }, size: 100, sort: "sort_order,name", total: false, fields: ["name", "groups", "short_description", "description", "category", "subcategory", "channel", "impact", "urgency", "assignment_group_id", "service_id", "ci_id"] }),
    staleTime: 5 * 60_000,
  });
  const mine = useMemo(() => new Set(me.data?.groups ?? []), [me.data]);
  const rows = (q.data?.rows ?? []).filter((t) => !Array.isArray(t.groups) || !t.groups.length || (t.groups as string[]).some((g) => mine.has(g)));
  if (!rows.length) return null;
  const items: MenuProps["items"] = rows.map((t) => ({ key: t.id, label: String(t.name) }));
  const onClick: MenuProps["onClick"] = ({ key }) => {
    const t = rows.find((x) => x.id === key);
    if (t) nav(`/${orgId}/${newRecordPath("incident")}?${new URLSearchParams(templateParams(t)).toString()}`);
  };
  return (
    <Dropdown menu={{ items, onClick }} trigger={["click"]}>
      <Button icon={<LayoutTemplate {...ICON14} />}>از الگو</Button>
    </Dropdown>
  );
}
