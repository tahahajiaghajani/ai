// Parts of the list toolbar: the saved-views menu (personal and shared views, the default one, «ذخیره» and
// «ذخیره به‌عنوان نمای جدید») and the column chooser (show, hide and order columns; back to the defaults).
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Checkbox, Dropdown, Input, Modal, Popover, Tooltip, type MenuProps } from "antd";
import { Bookmark, ChevronDown, Columns3, Star, Users, ArrowUp, ArrowDown, RotateCcw, Search } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { normalizeFa } from "../../lib/fa";
import { cx } from "../../components/blocks";
import { defaultColumns, fieldOf, isListable } from "../model/schema";
import { MAX_COLUMNS, moveColumn, toggleColumn } from "../model/columns";
import { groupViews } from "../model/views";
import type { TableMeta, ViewRow } from "../model/types";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export interface ViewsMenuProps {
  def: TableMeta;
  views: ViewRow[];
  current: ViewRow | null;
  dirty: boolean;
  me: string | null;
  onSelect: (v: ViewRow | null) => void;
  /** saves the page into the current (own) view */
  onSave: () => Promise<void>;
  /** creates a view from the page */
  onSaveAs: (o: { name: string; shared: boolean; is_default: boolean }) => Promise<void>;
}

export function ViewsMenu({ def, views, current, dirty, me, onSelect, onSave, onSaveAs }: ViewsMenuProps) {
  const nav = useNavigate();
  const { orgId } = useOrg();
  const [saving, setSaving] = useState(false);
  const { mine, shared } = useMemo(() => groupViews(views, me), [views, me]);
  const own = !!current && current.owner_id === me;
  const item = (v: ViewRow) => ({
    key: v.id,
    label: (
      <span className="rk-vm-i">
        <span className="rk-vm-n">{v.name}</span>
        {v.is_default ? <Star {...I14} className="rk-vm-star" aria-label="پیش‌فرض" /> : null}
        {v.shared && v.owner_id === me ? <Users {...I14} className="text-ink-3" aria-label="اشتراکی" /> : null}
      </span>
    ),
  });
  const items: MenuProps["items"] = [
    { key: "__all", label: `همهٔ ${def.plural}` },
    ...(mine.length ? [{ type: "group" as const, key: "g-mine", label: "نماهای من", children: mine.map(item) }] : []),
    ...(shared.length ? [{ type: "group" as const, key: "g-shared", label: "نماهای اشتراکی", children: shared.map(item) }] : []),
    { type: "divider" as const },
    { key: "__save", label: "ذخیرهٔ تغییرات این نما", disabled: !own || !dirty },
    { key: "__saveas", label: "ذخیره به‌عنوان نمای جدید…" },
    { key: "__manage", label: "مدیریت نماها" },
  ];
  return (
    <>
      <Dropdown
        trigger={["click"]}
        rootClassName="ds-glass"
        menu={{
          items,
          selectable: true,
          selectedKeys: [current?.id ?? "__all"],
          onClick: async ({ key }) => {
            if (key === "__all") onSelect(null);
            else if (key === "__save") await onSave();
            else if (key === "__saveas") setSaving(true);
            else if (key === "__manage") nav(`/${orgId}/settings/views?table=${encodeURIComponent(def.key)}`);
            else onSelect(views.find((v) => v.id === key) ?? null);
          },
        }}
      >
        <Button className="rk-vm" icon={<Bookmark {...I16} />}>
          <span className="rk-vm-cur">{current?.name ?? `همهٔ ${def.plural}`}</span>
          {dirty ? <i className="rk-dirty" title="تغییرات ذخیره‌نشده" aria-label="تغییرات ذخیره‌نشده" /> : null}
          <ChevronDown {...I14} aria-hidden />
        </Button>
      </Dropdown>
      <SaveViewModal open={saving} onClose={() => setSaving(false)} onSave={onSaveAs} defaultName={current ? `${current.name} (رونوشت)` : ""} />
    </>
  );
}

function SaveViewModal({ open, onClose, onSave, defaultName }: { open: boolean; onClose: () => void; onSave: ViewsMenuProps["onSaveAs"]; defaultName: string }) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [isDefault, setDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = useNotify();
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({ name: name.trim(), shared, is_default: isDefault });
      onClose();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title="ذخیره به‌عنوان نمای جدید"
      onCancel={onClose}
      onOk={submit}
      okText="ذخیره"
      cancelText="انصراف"
      okButtonProps={{ disabled: !name.trim(), loading: busy }}
      destroyOnHidden
      width={420}
      afterOpenChange={(o) => o && setName(defaultName)}
    >
      <div className="rk-stack">
        <label className="rk-lbl" htmlFor="rk-view-name">
          نام نما
        </label>
        <Input id="rk-view-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onPressEnter={submit} placeholder="مثلاً «کارهای فوری من»" />
        <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)}>
          همهٔ اعضا این نما را ببینند
        </Checkbox>
        <Checkbox checked={isDefault} onChange={(e) => setDefault(e.target.checked)}>
          {shared ? "نمای پیش‌فرض همه" : "نمای پیش‌فرض من"}
        </Checkbox>
      </div>
    </Modal>
  );
}

export function ColumnChooser({ def, columns, onChange }: { def: TableMeta; columns: string[]; onChange: (cols: string[]) => void }) {
  const [q, setQ] = useState("");
  const fields = useMemo(() => def.fields.filter(isListable), [def]);
  const shown = fields.filter((f) => !q || normalizeFa(f.label).includes(normalizeFa(q)));
  const content = (
    <div className="rk-cc" role="dialog" aria-label="ستون‌ها">
      <Input size="small" prefix={<Search {...I14} className="text-ink-3" />} placeholder="جست‌وجوی ستون" value={q} onChange={(e) => setQ(e.target.value)} allowClear />
      <ol className="rk-cc-on" aria-label="ستون‌های نمایش داده‌شده">
        {columns.map((c, i) => (
          <li key={c}>
            <span className="rk-cc-n">{fieldOf(def, c)?.label ?? c}</span>
            <Button type="text" size="small" icon={<ArrowUp {...I14} />} disabled={i === 0} aria-label="بالاتر" onClick={() => onChange(moveColumn(columns, i, i - 1))} />
            <Button type="text" size="small" icon={<ArrowDown {...I14} />} disabled={i === columns.length - 1} aria-label="پایین‌تر" onClick={() => onChange(moveColumn(columns, i, i + 1))} />
          </li>
        ))}
      </ol>
      <div className="rk-cc-all">
        {shown.map((f) => {
          const on = columns.includes(f.name);
          return (
            <Checkbox key={f.name} checked={on} disabled={(on && columns.length === 1) || (!on && columns.length >= MAX_COLUMNS)} onChange={() => onChange(toggleColumn(columns, f.name))}>
              {f.label}
            </Checkbox>
          );
        })}
      </div>
      <Button size="small" type="text" icon={<RotateCcw {...I14} />} onClick={() => onChange(defaultColumns(def))}>
        ستون‌های پیش‌فرض
      </Button>
    </div>
  );
  return (
    <Popover trigger="click" placement="bottomLeft" content={content} rootClassName="ds-glass" destroyOnHidden>
      <Tooltip title="ستون‌ها">
        <Button type="text" icon={<Columns3 {...I16} />} aria-label="ستون‌ها" className={cx("rk-tool")} />
      </Tooltip>
    </Popover>
  );
}
