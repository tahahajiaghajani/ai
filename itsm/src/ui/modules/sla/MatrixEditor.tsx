// «جدول اولویت» of a priority matrix: impact down the side, urgency across the top, the priority of each pair in its
// cell (coloured as the priority's option); «ITIL» refills the standard grid. An empty cell leaves a record's priority
// as it is. The options come from the table's own fields (the organisation's edits of the choice lists included).
import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "antd";
import { Save, RotateCcw, Sparkles } from "lucide-react";
import type { Option } from "@shared/model/types";
import { ITIL_MATRIX, matrixProblem } from "@shared/sla/rules";
import { ICON14, Note } from "../../components/blocks";
import { ChoiceTag, type RecordContext } from "../../records";
import { optionsOf } from "../../records/model/schema";
import { matrixDraft, matrixValue, setCell, type MatrixDraft } from "./model";

export default function MatrixEditor({ ctx }: { ctx: RecordContext }) {
  const canEdit = ctx.meta.canWrite && !ctx.meta.locked;
  const target = ctx.schema.def(String(ctx.row.table_key ?? ""));
  const opts = (name: unknown, fallback: string): Option[] => {
    const f = target?.fields.find((x) => x.name === (String(name || "") || fallback));
    return f ? optionsOf(f, ctx.schema.choices).filter((o) => o.active !== false) : [];
  };
  const impacts = opts(ctx.row.impact_field, "impact");
  const urgencies = opts(ctx.row.urgency_field, "urgency");
  const priorities = opts(ctx.row.priority_field, "priority");
  const iv = impacts.map((o) => o.value);
  const uv = urgencies.map((o) => o.value);
  const saved = useMemo(() => matrixDraft(ctx.row.cells, iv, uv), [ctx.row.cells, iv.join(), uv.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [m, setM] = useState<MatrixDraft>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setM(saved), [saved]);
  const dirty = JSON.stringify(m) !== JSON.stringify(saved);
  const value = matrixValue(m);
  const problem = matrixProblem(value, iv, uv, priorities.map((o) => o.value));

  if (!target) return <Note tone="warning">جدول «{String(ctx.row.table_key ?? "")}» پیدا نشد.</Note>;
  if (!impacts.length || !urgencies.length || !priorities.length) return <Note tone="warning">فیلدهای اثر، فوریت یا اولویت در این جدول گزینه‌ای ندارند.</Note>;

  const save = async () => {
    setSaving(true);
    await ctx.save({ cells: value });
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="small" icon={<Sparkles {...ICON14} />} onClick={() => setM(matrixDraft(ITIL_MATRIX, iv, uv))}>
            ITIL
          </Button>
          <div className="ms-auto flex gap-2">
            <Button size="small" icon={<RotateCcw {...ICON14} />} disabled={!dirty} onClick={() => setM(saved)}>
              بازگردانی
            </Button>
            <Button size="small" type="primary" icon={<Save {...ICON14} />} disabled={!dirty || !!problem} loading={saving} onClick={() => void save()}>
              ذخیرهٔ جدول
            </Button>
          </div>
        </div>
      ) : null}
      {problem ? <Note tone="warning">{problem}</Note> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-separate border-spacing-1 text-[13px]">
          <caption className="ds-sr">اولویت به ازای اثر (ردیف‌ها) و فوریت (ستون‌ها)</caption>
          <thead>
            <tr>
              <th scope="col" className="w-36 p-1 text-start font-normal text-ink-3">
                اثر \ فوریت
              </th>
              {urgencies.map((u) => (
                <th key={u.value} scope="col" className="p-1 text-start font-medium text-ink-2">
                  {u.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {impacts.map((i) => (
              <tr key={i.value}>
                <th scope="row" className="p-1 text-start font-medium text-ink-2">
                  {i.label}
                </th>
                {urgencies.map((u) => {
                  const v = m[i.value]?.[u.value] ?? null;
                  return (
                    <td key={u.value} className="rounded-md bg-sunken p-1.5">
                      {canEdit ? (
                        <Select
                          size="small"
                          variant="borderless"
                          className="w-full"
                          allowClear
                          placeholder="بدون تغییر"
                          value={v ?? undefined}
                          aria-label={`اولویت برای اثر ${i.label} و فوریت ${u.label}`}
                          onChange={(p) => setM((x) => setCell(x, i.value, u.value, p ?? null))}
                          options={priorities.map((o) => ({ value: o.value, label: <ChoiceTag option={o} value={o.value} /> }))}
                        />
                      ) : v ? (
                        <ChoiceTag option={priorities.find((o) => o.value === v)} value={v} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
