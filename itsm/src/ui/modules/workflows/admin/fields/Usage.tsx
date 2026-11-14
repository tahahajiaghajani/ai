// «به کار رفته در» (design F §8.1): where a library field is used — the tables it is attached to (each opens its fields
// in «فیلدهای جدول‌ها»), the forms and the published versions — as a list in the sheet and as a popover in the list.
import { Link } from "react-router";
import { Popover } from "antd";
import { tableDef } from "@shared/tables";
import { useOrg } from "../../../../lib/org";
import type { FieldUsage } from "./api";
import { usageText } from "./model";

export function UsageList({ usage }: { usage: FieldUsage }) {
  const { orgId } = useOrg();
  const groups: { title: string; items: { key: string; node: React.ReactNode }[] }[] = [
    {
      title: "جدول‌ها",
      items: usage.tables.map((t) => ({ key: t, node: <Link className="ds-link" to={`/${orgId}/settings/fields?tab=tables&table=${t}`}>{tableDef(t)?.plural ?? t}</Link> })),
    },
    { title: "فرم‌ها", items: usage.forms.map((f) => ({ key: f, node: f })) },
    { title: "نسخه‌های منتشرشده", items: usage.versions.map((v) => ({ key: v, node: v })) },
  ].filter((g) => g.items.length);
  if (!groups.length) return <p className="rk-hint">هنوز جایی به کار نرفته است.</p>;
  return (
    <dl className="wff-usage">
      {groups.map((g) => (
        <div key={g.title}>
          <dt>{g.title}</dt>
          <dd>
            <ul>
              {g.items.map((i) => (
                <li key={i.key}>{i.node}</li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The list cell: «۲ جدول، ۱ فرم»; a click shows where. */
export function UsageCell({ usage }: { usage: FieldUsage }) {
  const text = usageText(usage);
  if (!text) return <span className="text-ink-3">—</span>;
  return (
    <Popover content={<UsageList usage={usage} />} trigger="click" placement="bottom">
      <button type="button" className="wff-linkbtn" onClick={(e) => e.stopPropagation()} aria-label={`به کار رفته در ${text}`}>
        {text}
      </button>
    </Popover>
  );
}
