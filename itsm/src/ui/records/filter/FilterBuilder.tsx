// The condition builder: nested AND/OR groups of «field · operator · value» rows over a table, the field picker
// with one dot-walk into references («درخواست‌دهنده ← سمت»), operators per type with their Persian labels, value
// editors per type (options, records and members with «من» and «گروه‌های من», numbers, Jalali dates, relative
// windows «۷ روز گذشته / این هفته / این ماه»), and the condition read back as one Persian sentence. It edits the
// engine's condition JSON (`Cond`); incomplete rows are kept on screen but left out of the value.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Input, Select, Segmented, Tooltip } from "antd";
import { Plus, X, Brackets, User, Users } from "lucide-react";
import type { Cond, Op, RelativeValue } from "@shared/model/conditions";
import { OPS, relativeWindow, resolvePath } from "@shared/model/conditions";
import type { FieldDef, Option, TableDef } from "@shared/model/types";
import { COLOR_KEYS, FIELD_TYPES, refTarget } from "@shared/model/types";
import { DATE_UNITS, type DateUnit } from "@shared/model/jalali-buckets";
import { DateInput, NumberInput } from "../../components/inputs";
import { cx } from "../../components/blocks";
import {
  addChild, describeFilter, emptyGroup, filterPaths, fromCond, newLeaf, opsForPath, presetOf, RELATIVE_PRESETS, removeNode, toCond, updateNode, withField, withOp,
  type FGroup, type FLeaf, type FNode,
} from "../model/filter";
import { offeredOptions, type Schema } from "../model/schema";
import { COLOR_LABELS } from "../model/colors";
import { sameValue } from "../model/values";
import type { DisplayMap } from "../model/types";
import { ChoiceTag } from "../fields/display";
import { RecordSelect } from "../fields/RecordSelect";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const MAX_DEPTH = 3;

export interface FilterBuilderProps {
  def: TableDef;
  schema: Schema;
  value: Cond | null;
  onChange: (c: Cond | null) => void;
  disabled?: boolean;
  display?: DisplayMap;
  /** offer fields of referenced tables (default true) */
  walk?: boolean;
  /** hide the Persian sentence under the builder */
  noSummary?: boolean;
  tz?: string;
}

export function FilterBuilder({ def, schema, value, onChange, disabled, display, walk = true, noSummary, tz }: FilterBuilderProps) {
  const [tree, setTree] = useState<FGroup>(() => fromCond(value));
  const last = useRef<Cond | null>(value);
  // a new value from outside (a saved view, «پاک کردن») replaces the tree; our own echo does not
  useEffect(() => {
    if (!sameValue(value, last.current)) {
      last.current = value;
      setTree(fromCond(value));
    }
  }, [value]);
  const paths = useMemo(() => filterPaths(def, schema.lookup, { walk }), [def, schema, walk]);
  const fieldOptions = useMemo(() => {
    const own = paths.filter((p) => !p.via);
    const groups = new Map<string, { label: string; options: { value: string; label: string }[] }>();
    for (const p of paths) {
      if (!p.via) continue;
      const g = groups.get(p.via.name) ?? { label: `${p.via.label} ←`, options: [] };
      g.options.push({ value: p.path, label: p.label });
      groups.set(p.via.name, g);
    }
    return [{ label: def.label, options: own.map((p) => ({ value: p.path, label: p.label })) }, ...groups.values()];
  }, [paths, def]);

  const commit = (next: FGroup) => {
    setTree(next);
    const c = toCond(next);
    last.current = c;
    onChange(c);
  };
  const ctx: Ctx = { def, schema, display, disabled: !!disabled, fieldOptions, commit, root: tree, tz };
  const cond = toCond(tree);
  return (
    <div className="rk-fb">
      <GroupView group={tree} depth={0} ctx={ctx} />
      {!noSummary ? (
        <p className="rk-fb-sum" aria-live="polite">
          {describeFilter(cond, def, { lookup: schema.lookup, choices: schema.choices, display, tz })}
        </p>
      ) : null}
    </div>
  );
}

interface Ctx {
  def: TableDef;
  schema: Schema;
  display?: DisplayMap;
  disabled: boolean;
  fieldOptions: { label: string; options: { value: string; label: string }[] }[];
  commit: (g: FGroup) => void;
  root: FGroup;
  tz?: string;
}

function GroupView({ group, depth, ctx }: { group: FGroup; depth: number; ctx: Ctx }) {
  const { root, commit, disabled } = ctx;
  const set = (fn: (n: FNode) => FNode | null) => commit(updateNode(root, group.id, fn));
  const joinWord = group.join === "and" ? "و" : "یا";
  return (
    <div className={cx("rk-fb-g", depth > 0 && "is-nested", group.not && "is-not")} role="group" aria-label={depth ? "گروه شرط" : "شرط‌ها"}>
      {depth > 0 ? (
        <div className="rk-fb-gh">
          <Segmented
            size="small"
            value={group.join}
            disabled={disabled}
            onChange={(v) => set((n) => ({ ...(n as FGroup), join: v as "and" | "or" }))}
            options={[
              { value: "and", label: "همهٔ شرط‌ها" },
              { value: "or", label: "یکی از شرط‌ها" },
            ]}
          />
          <Checkbox checked={!!group.not} disabled={disabled} onChange={(e) => set((n) => ({ ...(n as FGroup), not: e.target.checked }))}>
            برعکس
          </Checkbox>
          <Tooltip title="حذف گروه">
            <Button type="text" size="small" icon={<X {...I14} />} disabled={disabled} aria-label="حذف گروه" onClick={() => commit(removeNode(root, group.id))} />
          </Tooltip>
        </div>
      ) : null}
      {group.items.map((n, i) => (
        <div key={n.id} className="rk-fb-item">
          {i > 0 ? (
            <button
              type="button"
              className="rk-fb-join"
              disabled={disabled}
              title="عوض کردن «و» / «یا»"
              onClick={() => set((g) => ({ ...(g as FGroup), join: (g as FGroup).join === "and" ? "or" : "and" }))}
            >
              {joinWord}
            </button>
          ) : null}
          {n.kind === "group" ? <GroupView group={n} depth={depth + 1} ctx={ctx} /> : <LeafView leaf={n} ctx={ctx} />}
        </div>
      ))}
      <div className="rk-fb-add">
        <Button size="small" type="text" icon={<Plus {...I14} />} disabled={disabled} onClick={() => commit(addChild(root, group.id, newLeaf()))}>
          شرط
        </Button>
        {depth < MAX_DEPTH - 1 ? (
          <Button size="small" type="text" icon={<Brackets {...I14} />} disabled={disabled} onClick={() => commit(addChild(root, group.id, { ...emptyGroup(group.join === "and" ? "or" : "and"), items: [newLeaf()] }))}>
            گروه
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function LeafView({ leaf, ctx }: { leaf: FLeaf; ctx: Ctx }) {
  const { def, schema, root, commit, disabled, fieldOptions } = ctx;
  const set = (next: FLeaf) => commit(updateNode(root, leaf.id, () => next));
  const r = leaf.f ? resolvePath(def, leaf.f, schema.lookup) : null;
  const ops = leaf.f ? opsForPath(def, leaf.f, schema.lookup) : [];
  return (
    <div className="rk-fb-row">
      <Select
        className="rk-fb-f"
        size="small"
        value={leaf.f || undefined}
        placeholder="فیلد"
        disabled={disabled}
        showSearch={{ optionFilterProp: "label" }}
        options={fieldOptions}
        popupMatchSelectWidth={false}
        aria-label="فیلد"
        onChange={(p) => set(withField(leaf, p, def, schema.lookup))}
      />
      {leaf.f ? (
        <Select
          className="rk-fb-op"
          size="small"
          value={leaf.op || undefined}
          placeholder="عملگر"
          disabled={disabled}
          popupMatchSelectWidth={false}
          aria-label="عملگر"
          options={ops.map((op) => ({ value: op, label: opLabel(op, r?.field) }))}
          onChange={(op) => set(withOp(leaf, op as Op, def, schema.lookup))}
        />
      ) : null}
      {r && leaf.op ? <ValueEditor leaf={leaf} field={r.field} fieldTable={r.def} ctx={ctx} onChange={(v) => set({ ...leaf, v })} onOp={(op) => set(withOp(leaf, op, def, schema.lookup))} /> : null}
      <Tooltip title="حذف شرط">
        <Button className="rk-fb-x" type="text" size="small" icon={<X {...I14} />} disabled={disabled} aria-label="حذف شرط" onClick={() => commit(removeNode(root, leaf.id))} />
      </Tooltip>
    </div>
  );
}

/** «من هستم» reads oddly for a users field: «شامل من است». */
function opLabel(op: Op, f?: FieldDef): string {
  if (op === "is_me" && f?.type === "users") return "شامل من است";
  if (op === "contains" && f && FIELD_TYPES[f.type].array) return "شامل";
  return OPS[op].label;
}

function ValueEditor({ leaf, field: f, fieldTable, ctx, onChange, onOp }: { leaf: FLeaf; field: FieldDef; fieldTable: TableDef; ctx: Ctx; onChange: (v: unknown) => void; onOp: (op: Op) => void }) {
  const { schema, disabled, display } = ctx;
  const op = leaf.op as Op;
  const shape = OPS[op].value;
  if (shape === "none") return null;
  if (shape === "relative") return <RelativeEditor value={leaf.v} onChange={onChange} disabled={disabled} />;
  const t = f.type;
  const target = refTarget(f, fieldTable.key);
  const isRef = FIELD_TYPES[t].family === "ref";
  const list = shape === "list";

  if (shape === "pair") {
    const [a, b] = Array.isArray(leaf.v) ? (leaf.v as unknown[]) : [null, null];
    const one = (v: unknown, k: 0 | 1) => {
      const next: unknown[] = [a ?? null, b ?? null];
      next[k] = v;
      onChange(next);
    };
    return (
      <span className="rk-fb-pair">
        <ScalarEditor f={f} value={a} onChange={(v) => one(v, 0)} disabled={disabled} label="از" />
        <span className="text-ink-3">تا</span>
        <ScalarEditor f={f} value={b} onChange={(v) => one(v, 1)} disabled={disabled} label="تا" />
      </span>
    );
  }
  if (isRef && target) {
    const people = target === "user";
    const groups = target === "group";
    return (
      <span className="rk-fb-v">
        <RecordSelect
          table={target}
          size="small"
          multiple={list}
          value={leaf.v as string | string[] | null}
          onChange={(v) => onChange(v)}
          display={display}
          disabled={disabled}
          meFirst={people}
          className="rk-fb-pick"
          aria-label="مقدار"
        />
        {people && (t === "user" || t === "users") ? (
          <Button size="small" type="text" icon={<User {...I14} />} disabled={disabled} onClick={() => onOp("is_me")}>
            من
          </Button>
        ) : null}
        {groups ? (
          <Button size="small" type="text" icon={<Users {...I14} />} disabled={disabled} onClick={() => onOp("is_my_group")}>
            گروه‌های من
          </Button>
        ) : null}
      </span>
    );
  }
  if (t === "choice" || t === "multichoice" || t === "color" || (t === "tags" && list)) {
    if (t === "tags")
      return <Select size="small" mode="tags" className="rk-fb-pick" value={(leaf.v as string[]) ?? []} onChange={(v) => onChange(v)} open={false} suffixIcon={null} disabled={disabled} placeholder="مقدارها" aria-label="مقدار" />;
    const opts: Option[] = t === "color" ? COLOR_KEYS.map((k) => ({ value: k, label: COLOR_LABELS[k], color: k })) : offeredOptions({ ...f, dependsOn: undefined }, schema.choices, null);
    const items: { value: string; label: string; o: Option }[] = opts.map((o) => ({ value: o.value, label: o.label, o }));
    return (
      <Select
        size="small"
        className="rk-fb-pick"
        mode={list ? "multiple" : undefined}
        value={(leaf.v as string | string[] | undefined) ?? (list ? [] : undefined)}
        onChange={(v) => onChange(v)}
        options={items}
        optionRender={(o) => <ChoiceTag option={(o.data as { o: Option }).o} />}
        showSearch={{ optionFilterProp: "label" }}
        maxTagCount="responsive"
        disabled={disabled}
        placeholder="مقدار"
        aria-label="مقدار"
        popupMatchSelectWidth={false}
      />
    );
  }
  if (list) return <Select size="small" mode="tags" className="rk-fb-pick" value={(leaf.v as string[]) ?? []} onChange={(v) => onChange(v)} open={false} suffixIcon={null} disabled={disabled} placeholder="مقدارها؛ Enter پس از هر کدام" aria-label="مقدار" />;
  return <ScalarEditor f={f} value={leaf.v} onChange={onChange} disabled={disabled} label="مقدار" />;
}


function ScalarEditor({ f, value, onChange, disabled, label }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; disabled: boolean; label: string }) {
  if (f.type === "bool")
    return (
      <Segmented
        size="small"
        value={value === false ? "false" : "true"}
        onChange={(v) => onChange(v === "true")}
        options={[
          { value: "true", label: "بله" },
          { value: "false", label: "خیر" },
        ]}
        disabled={disabled}
      />
    );
  if (f.type === "date" || f.type === "datetime") return <DateInput size="small" value={(value as string) ?? null} onChange={(v) => onChange(v)} disabled={disabled} aria-label={label} className="rk-fb-date" />;
  if (FIELD_TYPES[f.type].numeric)
    return <NumberInput size="small" value={value as string | null} onChange={(v) => onChange(v)} decimals={f.type === "int" || f.type === "rating" || f.type === "duration" ? 0 : 6} allowNegative disabled={disabled} className="rk-fb-num" aria-label={label} />;
  return <Input size="small" className="rk-fb-text" value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label} placeholder="مقدار" dir={f.ltr ? "ltr" : undefined} />;
}

const UNITS = Object.entries(DATE_UNITS).map(([value, label]) => ({ value, label }));

function RelativeEditor({ value, onChange, disabled }: { value: unknown; onChange: (v: RelativeValue) => void; disabled: boolean }) {
  const preset = presetOf(value);
  const [custom, setCustom] = useState(!preset && !!relativeWindow(value));
  const v = (value ?? {}) as RelativeValue;
  const w = relativeWindow(value);
  const n = w ? (w.to === 0 ? 1 - w.from : w.from === 0 ? w.to + 1 : 1) : 7;
  const dir: "past" | "next" = w && w.from === 0 && w.to > 0 ? "next" : "past";
  return (
    <span className="rk-fb-rel">
      <Select
        size="small"
        className="rk-fb-pick"
        disabled={disabled}
        aria-label="بازه"
        value={custom ? "__custom" : (preset?.key ?? undefined)}
        placeholder="بازه"
        popupMatchSelectWidth={false}
        onChange={(k) => {
          if (k === "__custom") {
            setCustom(true);
            onChange({ unit: (w?.unit as DateUnit) ?? "day", n, dir });
            return;
          }
          setCustom(false);
          const p = RELATIVE_PRESETS.find((x) => x.key === k);
          if (p) onChange(p.v);
        }}
        options={[
          { label: "گذشته", options: RELATIVE_PRESETS.filter((p) => p.dir === "past").map((p) => ({ value: p.key, label: p.label })) },
          { label: "اکنون", options: RELATIVE_PRESETS.filter((p) => p.dir === "now").map((p) => ({ value: p.key, label: p.label })) },
          { label: "آینده", options: RELATIVE_PRESETS.filter((p) => p.dir === "next").map((p) => ({ value: p.key, label: p.label })) },
          { label: "سفارشی", options: [{ value: "__custom", label: "بازهٔ دیگر…" }] },
        ]}
      />
      {custom ? (
        <>
          <NumberInput size="small" className="rk-fb-n" value={n} decimals={0} onChange={(x) => onChange({ unit: v.unit ?? w?.unit ?? "day", n: Math.max(1, Number(x) || 1), dir })} aria-label="تعداد" disabled={disabled} />
          <Select size="small" value={w?.unit ?? "day"} options={UNITS} onChange={(u) => onChange({ unit: u as DateUnit, n, dir })} aria-label="واحد" disabled={disabled} popupMatchSelectWidth={false} />
          <Select
            size="small"
            value={dir}
            options={[
              { value: "past", label: "گذشته" },
              { value: "next", label: "آینده" },
            ]}
            onChange={(d) => onChange({ unit: w?.unit ?? "day", n, dir: d as "past" | "next" })}
            aria-label="جهت"
            disabled={disabled}
          />
        </>
      ) : null}
    </span>
  );
}
