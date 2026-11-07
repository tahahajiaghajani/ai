// «فهرست‌های گزینه»: the options of a choice list as the organisation sees them (the defaults with its own rows of the
// `choice` table on top): labels, colours, order, the parent value of dependent lists, and «فعال» (an inactive option
// stays valid on records that carry it but is not offered for new values). New values are added here too. One
// «ذخیره» writes only what changed; the definitions refresh everywhere.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Input, Select, Switch, Table, Tooltip } from "antd";
import { Plus, ArrowUp, ArrowDown, Save, RotateCcw } from "lucide-react";
import type { Option } from "@shared/model/types";
import { COLOR_KEYS } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState } from "../../components/display";
import { Card } from "../../components/blocks";
import { useRecordActions, useRecordList, useRefreshSchema, useSchema } from "../data/hooks";
import { COLOR_LABELS } from "../model/colors";
import { sameValue } from "../model/values";
import { ChoiceTag } from "../fields/display";
import "../records.css";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

interface Item extends Option {
  /** new in this session (not saved yet) */
  added?: boolean;
}

/** Which table fields use a list («todo.category» → «کارها › دسته»). */
function usedBy(schema: ReturnType<typeof useSchema>["schema"], list: string): string {
  if (!schema) return "";
  const out: string[] = [];
  for (const t of schema.tables.values()) for (const f of t.fields) if (f.choices === list) out.push(`${t.plural} › ${f.label}`);
  return out.join("، ");
}

export default function ChoiceLists() {
  const { can } = useOrg();
  const n = useNotify();
  const { schema } = useSchema();
  const refresh = useRefreshSchema();
  const actions = useRecordActions("choice");
  const editable = can("settings", "edit");
  const [params, setParams] = useSearchParams();
  const lists = useMemo(() => Object.keys(schema?.choices ?? {}).sort(), [schema]);
  const list = params.get("list") ?? lists[0];
  const rows = useRecordList("choice", { filter: list ? { f: "list", op: "eq", v: list } : null, size: 500, total: false }, { enabled: !!list });
  const byValue = useMemo(() => new Map((rows.data?.rows ?? []).map((r) => [String(r.value), r])), [rows.data]);
  const effective = useMemo<Item[]>(() => (list ? [...(schema?.choices[list] ?? [])].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9)) : []), [schema, list]);
  const [items, setItems] = useState<Item[]>(effective);
  useEffect(() => setItems(effective), [effective]);
  const [busy, setBusy] = useState(false);
  const dependent = items.some((o) => o.parent);
  const dirty = !sameValue(items.map(strip), effective.map(strip));

  const set = (i: number, p: Partial<Item>) => setItems((x) => x.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const move = (i: number, d: number) =>
    setItems((x) => {
      const next = [...x];
      const [o] = next.splice(i, 1);
      next.splice(i + d, 0, o);
      return next;
    });

  const save = async () => {
    if (!list) return;
    const bad = items.find((o) => !o.value.trim() || !o.label.trim());
    if (bad) return n.warn("هر گزینه مقدار و برچسب لازم دارد");
    const reordered = items.map((o) => o.value).join("|") !== effective.map((o) => o.value).join("|");
    setBusy(true);
    let changed = 0;
    try {
      for (const [i, o] of items.entries()) {
        const before = effective.find((x) => x.value === o.value);
        const order = i + 1;
        const same = before && before.label === o.label && (before.color ?? null) === (o.color ?? null) && (before.parent ?? null) === (o.parent ?? null) && (before.active !== false) === (o.active !== false);
        if (same && !reordered) continue;
        const data = { label: o.label.trim(), color: o.color ?? null, parent: o.parent?.trim() || null, active: o.active !== false, sort_order: order };
        const row = byValue.get(o.value);
        if (row) await actions.update(row.id, data, row.version);
        else await actions.create({ list, value: o.value.trim(), ...data });
        changed++;
      }
      await refresh();
      n.ok(changed ? `${faDigits(changed)} گزینه ذخیره شد` : "تغییری نبود");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rk-admin">
      <PageHeader
        title="فهرست‌های گزینه"
        actions={
          editable ? (
            <>
              <Button icon={<RotateCcw {...I16} />} onClick={() => setItems(effective)} disabled={!dirty || busy}>
                برگرداندن
              </Button>
              <Button type="primary" icon={<Save {...I16} />} onClick={save} loading={busy} disabled={!dirty}>
                ذخیره
              </Button>
            </>
          ) : null
        }
      />
      <div className="rk-admin-bar">
        <Select
          value={list}
          onChange={(v) => setParams({ list: v }, { replace: true })}
          options={lists.map((l) => ({ value: l, label: l }))}
          showSearch
          aria-label="فهرست"
          popupMatchSelectWidth={false}
        />
        {list ? <span className="rk-hint">{usedBy(schema, list)}</span> : null}
      </div>
      {!lists.length ? (
        <EmptyState title="فهرست گزینه‌ای نیست" description="فیلدهای انتخابی جدول‌ها فهرست‌های خود را اینجا نشان می‌دهند." />
      ) : (
        <Card flush>
          <Table<Item>
            size="small"
            className="ds-table"
            rowKey={(o) => o.value || `new-${items.indexOf(o)}`}
            loading={rows.isLoading}
            dataSource={items}
            pagination={false}
            columns={[
              {
                key: "order",
                title: "",
                width: 72,
                render: (_: unknown, _o, i) =>
                  editable ? (
                    <span className="flex">
                      <Button type="text" size="small" icon={<ArrowUp {...I14} />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="بالاتر" />
                      <Button type="text" size="small" icon={<ArrowDown {...I14} />} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="پایین‌تر" />
                    </span>
                  ) : null,
              },
              {
                key: "value",
                title: "مقدار",
                render: (_: unknown, o, i) =>
                  o.added ? (
                    <Input size="small" dir="ltr" className="ds-mono" value={o.value} onChange={(e) => set(i, { value: e.target.value.replace(/\s+/g, "_") })} aria-label="مقدار" style={{ inlineSize: 140 }} />
                  ) : (
                    <bdi dir="ltr" className="ds-mono">{o.value}</bdi>
                  ),
              },
              { key: "label", title: "برچسب", render: (_: unknown, o, i) => (editable ? <Input size="small" value={o.label} onChange={(e) => set(i, { label: e.target.value })} aria-label={`برچسب ${o.value}`} style={{ inlineSize: 200 }} /> : o.label) },
              {
                key: "color",
                title: "رنگ",
                render: (_: unknown, o, i) =>
                  editable ? (
                    <Select
                      size="small"
                      style={{ inlineSize: 130 }}
                      value={o.color}
                      allowClear
                      onChange={(c) => set(i, { color: c })}
                      placeholder="بی‌رنگ"
                      options={COLOR_KEYS.map((k) => ({ value: k, label: COLOR_LABELS[k] }))}
                      optionRender={(x) => <ChoiceTag option={{ value: String(x.value), label: String(x.label), color: x.value as Option["color"] }} />}
                      aria-label={`رنگ ${o.value}`}
                    />
                  ) : (
                    <ChoiceTag option={o} />
                  ),
              },
              ...(dependent
                ? [{ key: "parent", title: "والد", render: (_: unknown, o: Item, i: number) => (editable ? <Input size="small" dir="ltr" className="ds-mono" value={o.parent ?? ""} onChange={(e) => set(i, { parent: e.target.value })} style={{ inlineSize: 120 }} aria-label="والد" /> : <bdi dir="ltr">{o.parent}</bdi>) }]
                : []),
              { key: "active", title: "فعال", width: 72, render: (_: unknown, o, i) => <Switch size="small" checked={o.active !== false} disabled={!editable} onChange={(v) => set(i, { active: v })} aria-label={`فعال بودن ${o.label}`} /> },
              { key: "preview", title: "نمایش", render: (_: unknown, o) => <ChoiceTag option={o} /> },
            ]}
          />
          {editable && list ? (
            <div className="p-3">
              <Tooltip title="گزینهٔ تازه">
                <Button size="small" icon={<Plus {...I14} />} onClick={() => setItems((x) => [...x, { value: "", label: "", added: true }])}>
                  گزینه
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}

const strip = (o: Item) => ({ value: o.value, label: o.label, color: o.color ?? null, parent: o.parent ?? null, active: o.active !== false });

