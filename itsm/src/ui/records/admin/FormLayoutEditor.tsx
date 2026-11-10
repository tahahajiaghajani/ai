// «چیدمان فرم‌ها»: the organisation's arrangement of a table's form — tabs, their sections and the order of the
// fields — saved as one row of `custom_field` («_form», see @shared/model/arrangement). Fields are dragged between
// sections; every drag has a menu alternative («انتقال به…», up, down) for the keyboard and touch. Fields the
// arrangement leaves out keep their default place. «پیش‌فرض» removes the arrangement.
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Button, Dropdown, Input, Tooltip } from "antd";
import { Plus, Save, RotateCcw, Trash2, ArrowUp, ArrowDown, MoveHorizontal, FolderPlus } from "lucide-react";
import type { FormArrangement } from "@shared/model/types";
import { FORM_ROW } from "@shared/model/arrangement";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Note, cx } from "../../components/blocks";
import { useRecordActions, useRecordList, useRefreshSchema, useSchema } from "../data/hooks";
import { arrangementOf, formFields } from "../model/layout";
import { fieldOf } from "../model/schema";
import { sameValue } from "../model/values";
import { TablePicker, useTableParam } from "./shared";
import "../records.css";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

type Pos = { t: number; s: number };

export default function FormLayoutEditor() {
  const { can } = useOrg();
  const n = useNotify();
  const { schema } = useSchema();
  const [def, setTable] = useTableParam(schema);
  const refresh = useRefreshSchema();
  const actions = useRecordActions("custom_field");
  const editable = can("settings", "edit");
  const stored = useRecordList("custom_field", { filter: def ? { and: [{ f: "table_key", op: "eq", v: def.key }, { f: "name", op: "eq", v: FORM_ROW }] } : null, size: 1, total: false }, { enabled: !!def });
  const row = stored.data?.rows[0];
  const initial = useMemo(() => (def ? arrangementOf(def) : { tabs: [] }), [def]);
  const [arr, setArr] = useState<FormArrangement>(initial);
  useEffect(() => setArr(initial), [initial]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dirty = !sameValue(arr, initial);

  const placed = new Set(arr.tabs.flatMap((t) => t.sections.flatMap((s) => s.fields)));
  const pool = def ? formFields(def, { mode: "create" }).filter((f) => !placed.has(f.name)) : [];
  const sections: (Pos & { label: string })[] = arr.tabs.flatMap((t, ti) => t.sections.map((s, si) => ({ t: ti, s: si, label: `${t.label} › ${s.label ?? "بخش بی‌نام"}` })));

  const edit = (fn: (a: FormArrangement) => void) =>
    setArr((a) => {
      const next: FormArrangement = JSON.parse(JSON.stringify(a));
      fn(next);
      return next;
    });
  const removeField = (a: FormArrangement, name: string) => {
    for (const t of a.tabs) for (const s of t.sections) s.fields = s.fields.filter((f) => f !== name);
  };
  const moveTo = (name: string, to: Pos, index?: number) =>
    edit((a) => {
      removeField(a, name);
      const list = a.tabs[to.t].sections[to.s].fields;
      list.splice(index ?? list.length, 0, name);
    });
  const shift = (p: Pos, i: number, d: number) =>
    edit((a) => {
      const list = a.tabs[p.t].sections[p.s].fields;
      const [x] = list.splice(i, 1);
      list.splice(Math.max(0, Math.min(list.length, i + d)), 0, x);
    });

  const save = async () => {
    if (!def) return;
    setBusy(true);
    try {
      const data = { label: "چیدمان فرم", options: arr, active: true };
      if (row) await actions.update(row.id, data, row.version);
      else await actions.create({ table_key: def.key, name: FORM_ROW, ...data });
      await refresh();
      n.ok(`چیدمان فرم «${def.plural}» ذخیره شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!def) return;
    if (!row) return setArr(arrangementOf(def, { ignoreArrangement: true }));
    if (!(await n.confirm(`بازگشت فرم «${def.plural}» به چیدمان پیش‌فرض؟`, "چیدمان سازمان برداشته می‌شود؛ فیلدها سر جای پیش‌فرض خود برمی‌گردند."))) return;
    setBusy(true);
    try {
      await actions.remove(row.id, row.version);
      await refresh();
      n.ok("چیدمان پیش‌فرض برگشت");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const drop = (to: Pos) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const name = e.dataTransfer.getData("text/x-field") || drag;
    setDrag(null);
    if (name) moveTo(name, to);
  };

  const chip = (name: string, p: Pos | null, i: number, count: number) => {
    const f = def ? fieldOf(def, name) : undefined;
    if (!f) return null;
    return (
      <li
        key={name}
        className={cx("rk-lay-f", drag === name && "is-drag")}
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-field", name);
          setDrag(name);
        }}
        onDragEnd={() => setDrag(null)}
      >
        <span>{f.label}</span>
        {editable ? (
          <>
            {p ? (
              <>
                <Button type="text" size="small" icon={<ArrowUp {...I14} />} disabled={i === 0} onClick={() => shift(p, i, -1)} aria-label={`${f.label} بالاتر`} />
                <Button type="text" size="small" icon={<ArrowDown {...I14} />} disabled={i === count - 1} onClick={() => shift(p, i, 1)} aria-label={`${f.label} پایین‌تر`} />
              </>
            ) : null}
            <Dropdown trigger={["click"]} rootClassName="ds-glass" menu={{ items: sections.filter((x) => !p || x.t !== p.t || x.s !== p.s).map((x) => ({ key: `${x.t}:${x.s}`, label: x.label })), onClick: ({ key }) => {
              const [t, s] = key.split(":").map(Number);
              moveTo(name, { t, s });
            } }}>
              <Button type="text" size="small" icon={<MoveHorizontal {...I14} />} aria-label={`انتقال ${f.label}`} />
            </Dropdown>
          </>
        ) : null}
      </li>
    );
  };

  return (
    <div className="rk-admin">
      <PageHeader
        title="چیدمان فرم‌ها"
        actions={
          editable ? (
            <>
              <Button icon={<RotateCcw {...I16} />} onClick={reset} disabled={busy || (!row && !dirty)}>
                پیش‌فرض
              </Button>
              <Button type="primary" icon={<Save {...I16} />} onClick={save} loading={busy} disabled={!dirty}>
                ذخیره
              </Button>
            </>
          ) : null
        }
      />
      <div className="rk-admin-bar">
        <TablePicker schema={schema} value={def?.key} onChange={setTable} />
        {row ? <span className="rk-hint">این فرم چیدمان سازمان را دارد.</span> : <span className="rk-hint">چیدمان پیش‌فرض.</span>}
      </div>
      {!editable ? <Note>برای تغییر چیدمان، دسترسی ویرایش «تنظیمات» لازم است.</Note> : null}
      {def ? (
        <div className="rk-lay">
          <div className="rk-stack">
            {arr.tabs.map((t, ti) => (
              <section key={ti} className="rk-lay-tab" aria-label={`زبانهٔ ${t.label}`}>
                <div className="rk-lay-tab-h">
                  <Input value={t.label} disabled={!editable} onChange={(e) => edit((a) => void (a.tabs[ti].label = e.target.value))} aria-label="نام زبانه" maxLength={80} />
                  {editable ? (
                    <>
                      <Tooltip title="بخش تازه">
                        <Button type="text" size="small" icon={<FolderPlus {...I16} />} onClick={() => edit((a) => void a.tabs[ti].sections.push({ label: "بخش تازه", fields: [] }))} aria-label="بخش تازه" />
                      </Tooltip>
                      <Tooltip title="زبانهٔ قبل">
                        <Button type="text" size="small" icon={<ArrowUp {...I14} />} disabled={ti === 0} onClick={() => edit((a) => void a.tabs.splice(ti - 1, 0, a.tabs.splice(ti, 1)[0]))} aria-label="زبانهٔ قبل" />
                      </Tooltip>
                      <Tooltip title="حذف زبانه (فیلدهایش بی‌جا می‌شوند)">
                        <Button type="text" size="small" danger icon={<Trash2 {...I14} />} disabled={arr.tabs.length === 1} onClick={() => edit((a) => void a.tabs.splice(ti, 1))} aria-label="حذف زبانه" />
                      </Tooltip>
                    </>
                  ) : null}
                </div>
                {t.sections.map((s, si) => {
                  const key = `${ti}:${si}`;
                  return (
                    <div
                      key={si}
                      className={cx("rk-lay-sec", over === key && "is-over")}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setOver(key);
                      }}
                      onDragLeave={() => setOver(null)}
                      onDrop={drop({ t: ti, s: si })}
                    >
                      <div className="rk-lay-sec-h">
                        <Input size="small" value={s.label ?? ""} placeholder="بخش بی‌نام" disabled={!editable} onChange={(e) => edit((a) => void (a.tabs[ti].sections[si].label = e.target.value || null))} aria-label="نام بخش" maxLength={80} />
                        {editable ? (
                          <>
                            <Button type="text" size="small" icon={<ArrowUp {...I14} />} disabled={si === 0} onClick={() => edit((a) => void a.tabs[ti].sections.splice(si - 1, 0, a.tabs[ti].sections.splice(si, 1)[0]))} aria-label="بخش بالاتر" />
                            <Button type="text" size="small" danger icon={<Trash2 {...I14} />} onClick={() => edit((a) => void a.tabs[ti].sections.splice(si, 1))} aria-label="حذف بخش" />
                          </>
                        ) : null}
                      </div>
                      <ul className="rk-lay-fields">{s.fields.map((f, i) => chip(f, { t: ti, s: si }, i, s.fields.length))}</ul>
                    </div>
                  );
                })}
              </section>
            ))}
            {editable ? (
              <Button icon={<Plus {...I16} />} className="self-start" onClick={() => edit((a) => void a.tabs.push({ label: "زبانهٔ تازه", sections: [{ label: null, fields: [] }] }))}>
                زبانه
              </Button>
            ) : null}
          </div>
          <aside className="rk-lay-pool" aria-label="فیلدهای بی‌جا">
            <span className="rk-lbl">فیلدهای بی‌جا</span>
            <p className="rk-hint">این‌ها در بخش نخست می‌آیند؛ هر کدام را به بخشی ببرید.</p>
            <ul className="rk-lay-fields">{pool.map((f) => chip(f.name, null, 0, 0))}</ul>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
