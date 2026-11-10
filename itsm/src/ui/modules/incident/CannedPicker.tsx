// The composer's «پاسخ‌های آماده»: the organisation's canned responses for the tab in use (reply or internal note),
// the incident's category first; choosing one inserts it with its placeholders filled ({{caller}} {{number}} …).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dropdown, type MenuProps } from "antd";
import { MessageSquareText } from "lucide-react";
import { useOrg } from "../../lib/org";
import { ICON14 } from "../../components/blocks";
import { recordsApi, useMe, type ComposerContext } from "../../records";
import { cannedFor, cannedText } from "./model";

export default function CannedPicker({ c }: { c: ComposerContext }) {
  const { api, orgId } = useOrg();
  const { name } = useMe();
  const q = useQuery({
    queryKey: ["incident", orgId, "responses"],
    queryFn: () => recordsApi.list(api, "incident_response", { filter: { f: "active", op: "eq", v: true }, size: 200, fields: ["name", "body", "kind", "category", "sort_order", "active"], total: false }),
    staleTime: 5 * 60_000,
  });
  const rows = useMemo(() => cannedFor(q.data?.rows ?? [], c.kind, c.record.row.category), [q.data, c.kind, c.record.row.category]);
  if (!rows.length) return null;
  const items: MenuProps["items"] = rows.slice(0, 30).map((r) => ({ key: r.id, label: String(r.name) }));
  const onClick: MenuProps["onClick"] = ({ key }) => {
    const r = rows.find((x) => x.id === key);
    if (r) c.insert(cannedText(String(r.body ?? ""), c.record.row, c.record.display, name));
  };
  return (
    <Dropdown menu={{ items, onClick }} trigger={["click"]}>
      <Button size="small" type="text" icon={<MessageSquareText {...ICON14} />}>
        پاسخ آماده
      </Button>
    </Dropdown>
  );
}
