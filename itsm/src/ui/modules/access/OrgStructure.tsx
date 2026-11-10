// «ساختار سازمانی»: the tree of companies, divisions, departments, teams, cost centres and branches — managers, codes,
// separate domains — with the number of members of each unit.
import { useMemo } from "react";
import { Form, Input, Switch } from "antd";
import { UNIT_KINDS } from "@shared/tables/access";
import { faDigits } from "@shared/format";
import { TreeEditor } from "./TreeEditor";
import { TreeRefSelect, UNIT_ICON } from "./parts";
import { useTable, type Rec } from "./api";

export default function OrgStructure() {
  const profiles = useTable<Rec & { org_unit_id: string | null }>("member_profile");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of profiles.data ?? []) if (p.org_unit_id) m.set(p.org_unit_id, (m.get(p.org_unit_id) ?? 0) + 1);
    return m;
  }, [profiles.data]);
  return (
    <TreeEditor
      table="org_unit"
      title="ساختار سازمانی"
      noun="واحد"
      kinds={UNIT_KINDS}
      icons={UNIT_ICON}
      defaultKind="department"
      badge={(r) => (counts.get(r.id) ? <span className="ms-auto text-[12px] text-ink-3 ds-num">{faDigits(counts.get(r.id)!)} نفر</span> : null)}
      extra={
        <>
          <Form.Item name="location_id" label="مکان">
            <TreeRefSelect table="location" />
          </Form.Item>
          <Form.Item name="is_domain" label="دامنهٔ جداگانه" valuePropName="checked" extra="در جداسازی دامنه‌ها، افراد و رکوردهای این شرکت و زیرمجموعه‌هایش جدا دیده می‌شوند.">
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="شرح">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
        </>
      }
    />
  );
}
