// «مدیریت کلاس‌ها» (catalogue CMDB-001/002/006): the class tree of the organisation (the CSDM-aligned pack plus its own
// classes) and, for the chosen class, what it inherits along its ancestry — attributes, required and recommended
// fields, staleness, relationship rules, controlled attributes — next to its own attributes, which a configuration
// manager edits here. Classes change additively: an attribute is archived, never removed (CIs keep their values), and
// keys never change (the server's hooks enforce both). New classes and the class's other settings open on its record.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, Empty, Input, Modal, Select, Space, Table, Tag } from "antd";
import { Archive, ChevronLeft, Plus, Search } from "lucide-react";
import { ATTR_TYPES, CLASS_FAMILIES, type AttrDef, type AttrType } from "@shared/cmdb/classes";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { recordsApi } from "../../records/data/api";
import { cmdbApi, CMDB_KEYS, type ClassRow } from "./api";
import { familyColor } from "./model";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

interface TreeNode {
  c: ClassRow;
  children: TreeNode[];
}

function buildTree(classes: ClassRow[]): TreeNode[] {
  const by = new Map(classes.map((c) => [c.key, { c, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const n of by.values()) {
    const p = n.c.parent ? by.get(n.c.parent) : null;
    if (p) p.children.push(n);
    else roots.push(n);
  }
  const sort = (xs: TreeNode[]) => {
    xs.sort((a, b) => a.c.label.localeCompare(b.c.label, "fa"));
    for (const x of xs) sort(x.children);
  };
  sort(roots);
  return roots;
}

function TreeList({ nodes, depth, selected, onSelect, filter }: { nodes: TreeNode[]; depth: number; selected: string | null; onSelect: (k: string) => void; filter: string }) {
  const match = (n: TreeNode): boolean => !filter || n.c.label.includes(filter) || n.c.key.includes(filter.toLowerCase()) || n.children.some(match);
  return (
    <>
      {nodes.filter(match).map((n) => (
        <div key={n.c.key}>
          <button type="button" onClick={() => onSelect(n.c.key)} aria-current={selected === n.c.key} style={{ paddingInlineStart: 8 + depth * 14 }} className={n.c.abstract ? "is-abstract" : undefined}>
            <span className="inline-block h-2 w-2 shrink-0 rounded-xs" style={{ background: familyColor(n.c.family) }} aria-hidden />
            <span className="truncate">{n.c.label}</span>
            {!n.c.active ? <span className="text-[11px] text-ink-3">(غیرفعال)</span> : null}
          </button>
          {n.children.length ? <TreeList nodes={n.children} depth={depth + 1} selected={selected} onSelect={onSelect} filter={filter} /> : null}
        </div>
      ))}
    </>
  );
}

function AttrEditor({ open, value, onSave, onClose, taken }: { open: boolean; value: AttrDef | null; onSave: (a: AttrDef) => void; onClose: () => void; taken: Set<string> }) {
  const [a, setA] = useState<AttrDef>(value ?? { name: "", label: "", type: "string" });
  const isNew = !value;
  const keyOk = KEY_RE.test(a.name) && (!isNew || !taken.has(a.name));
  const choicesText = (a.choices ?? []).map((c) => `${c.value}=${c.label}`).join("\n");
  return (
    <Modal
      open={open}
      title={isNew ? "ویژگی تازه" : `ویرایش «${value?.label}»`}
      onCancel={onClose}
      onOk={() => onSave({ ...a, label: a.label.trim(), name: a.name.trim() })}
      okText="ثبت"
      cancelText="انصراف"
      okButtonProps={{ disabled: !keyOk || !a.label.trim() || ((a.type === "choice" || a.type === "multichoice") && !(a.choices ?? []).length) }}
      destroyOnHidden
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-ink-2">عنوان</span>
          <Input value={a.label} onChange={(e) => setA({ ...a, label: e.target.value })} maxLength={80} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-2">کلید (انگلیسی، تغییرناپذیر)</span>
          <Input dir="ltr" value={a.name} disabled={!isNew} onChange={(e) => setA({ ...a, name: e.target.value.toLowerCase() })} status={a.name && !keyOk ? "error" : undefined} placeholder="rack_units" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-2">نوع</span>
          <Select value={a.type} disabled={!isNew} onChange={(t: AttrType) => setA({ ...a, type: t })} options={Object.entries(ATTR_TYPES).map(([value, label]) => ({ value, label }))} />
        </label>
        {a.type === "choice" || a.type === "multichoice" ? (
          <label className="flex flex-col gap-1">
            <span className="text-ink-2">گزینه‌ها (هر خط: کلید=عنوان)</span>
            <Input.TextArea
              dir="auto"
              autoSize={{ minRows: 3, maxRows: 10 }}
              defaultValue={choicesText}
              onChange={(e) =>
                setA({
                  ...a,
                  choices: e.target.value.split("\n").map((l, i) => {
                    const [v, ...rest] = l.split("=");
                    return { value: v.trim(), label: (rest.join("=") || v).trim(), order: i + 1 };
                  }).filter((c) => c.value),
                })
              }
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-ink-2">واحد (اختیاری)</span>
          <Input value={a.unit ?? ""} onChange={(e) => setA({ ...a, unit: e.target.value || undefined })} maxLength={20} placeholder="گیگابایت" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-2">راهنما (اختیاری)</span>
          <Input value={a.help ?? ""} onChange={(e) => setA({ ...a, help: e.target.value || undefined })} maxLength={200} />
        </label>
        <Space wrap>
          <Checkbox checked={!!a.required} onChange={(e) => setA({ ...a, required: e.target.checked })}>الزامی</Checkbox>
          <Checkbox checked={!!a.recommended} onChange={(e) => setA({ ...a, recommended: e.target.checked })}>توصیه‌شده</Checkbox>
          <Checkbox checked={!!a.identifier} onChange={(e) => setA({ ...a, identifier: e.target.checked })}>شناسهٔ آشتی داده</Checkbox>
          <Checkbox checked={!!a.ltr} onChange={(e) => setA({ ...a, ltr: e.target.checked })}>چپ‌به‌راست</Checkbox>
        </Space>
      </div>
    </Modal>
  );
}

export default function ClassManager() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<{ attr: AttrDef | null } | null>(null);
  const meta = useQuery({ queryKey: CMDB_KEYS.meta(orgId), queryFn: () => cmdbApi.meta(api), staleTime: 300_000 });
  const q = useQuery({ queryKey: CMDB_KEYS.classes(orgId), queryFn: () => cmdbApi.classes(api), staleTime: 60_000 });
  const tree = useMemo(() => buildTree(q.data?.classes ?? []), [q.data]);
  const cls = q.data?.classes.find((c) => c.key === (selected ?? tree[0]?.c.key)) ?? null;
  const record = useQuery({
    queryKey: ["cmdb", orgId, "class-record", cls?.key],
    enabled: !!cls,
    queryFn: async () => (await recordsApi.list(api, "ci_class", { filter: { f: "key", op: "eq", v: cls!.key }, fields: ["key", "attrs", "label"], size: 1, total: false })).rows[0] ?? null,
  });
  const admin = !!meta.data?.can_admin;
  const own = cls?.attrs ?? [];
  const inherited = (cls?.all_attrs ?? []).filter((a) => (a as AttrDef & { from?: string }).from !== cls?.key);
  const labelOf = (k: string) => q.data?.classes.find((c) => c.key === k)?.label ?? k;
  const saveAttrs = async (attrs: AttrDef[]) => {
    const row = record.data;
    if (!row) {
      message.error("ردیف این کلاس هنوز ساخته نشده است؛ پیش‌فرض‌های پیکربندی را بیفزایید");
      return;
    }
    try {
      await recordsApi.update(api, "ci_class", String(row.id), { attrs });
      message.success("ویژگی‌های کلاس ذخیره شد");
      await qc.invalidateQueries({ queryKey: CMDB_KEYS.all(orgId) });
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  return (
    <div>
      <PageHeader
        title="مدیریت کلاس‌ها"
        actions={admin ? <Button icon={<Plus {...ICON} />} onClick={() => nav(`/${orgId}/cmdb/classes/new${cls ? `?parent_key=${cls.key}&family=${cls.family}` : ""}`)}>زیرکلاس تازه</Button> : undefined}
      />
      {q.isLoading ? (
        <Loader />
      ) : !q.data ? (
        <EmptyState title="کلاس‌ها بارگذاری نشد" />
      ) : (
        <div className="cm-split">
          <Card>
            <Input allowClear prefix={<Search size={14} strokeWidth={1.4} absoluteStrokeWidth />} placeholder="جست‌وجوی کلاس" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-2" aria-label="جست‌وجوی کلاس" />
            <nav className="cm-tree" aria-label="درخت کلاس‌ها">
              <TreeList nodes={tree} depth={0} selected={cls?.key ?? null} onSelect={setSelected} filter={filter} />
            </nav>
          </Card>
          {cls ? (
            <div className="flex flex-col gap-3">
              <Card
                title={cls.label}
                meta={<span className="ds-latin text-ink-3">{cls.key}</span>}
                tools={record.data ? <Link className="ds-link text-[13px]" to={`/${orgId}/cmdb/classes/${record.data.id}`}>تنظیمات کلاس</Link> : null}
              >
                <p className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-3">
                  {cls.ancestry.map((k, i) => (
                    <span key={k} className="inline-flex items-center gap-1">
                      {i ? <ChevronLeft size={12} strokeWidth={1.4} absoluteStrokeWidth aria-hidden /> : null}
                      <button type="button" className="ds-link" onClick={() => setSelected(k)}>{labelOf(k)}</button>
                    </span>
                  ))}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip tone="neutral" dot={false}>{CLASS_FAMILIES[cls.family]?.label ?? cls.family}</Chip>
                  {cls.abstract ? <Chip tone="neutral" dot={false}>انتزاعی (پیکربندی مستقیم نمی‌گیرد)</Chip> : null}
                  {cls.principal ? <Chip tone="accent" dot={false}>کلاس اصلی سلامت</Chip> : null}
                  {cls.create_disabled ? <Chip tone="warning">ساخت دستی بسته</Chip> : null}
                  {cls.stale_days_effective ? <Chip tone="neutral" dot={false}>{`کهنه پس از ${fa(cls.stale_days_effective)} روز`}</Chip> : null}
                </div>
                {cls.description ? <p className="mt-2 text-[13px] text-ink-2">{cls.description}</p> : null}
              </Card>
              <Card
                title="ویژگی‌های خود کلاس"
                tools={admin ? <Button size="small" icon={<Plus {...ICON} />} onClick={() => setEditing({ attr: null })}>ویژگی تازه</Button> : null}
                flush
              >
                {own.length ? (
                  <Table
                    rowKey="name"
                    size="small"
                    pagination={false}
                    dataSource={own}
                    scroll={{ x: 560 }}
                    columns={[
                      { title: "عنوان", dataIndex: "label", key: "l", render: (v: string, a: AttrDef) => <span className={a.archived ? "text-ink-3 line-through" : undefined}>{v}</span> },
                      { title: "کلید", dataIndex: "name", key: "n", render: (v: string) => <span className="ds-latin text-ink-3">{v}</span> },
                      { title: "نوع", dataIndex: "type", key: "t", render: (v: AttrType) => ATTR_TYPES[v] ?? v },
                      { title: "", key: "f", render: (_: unknown, a: AttrDef) => <Space size={4}>{a.required ? <Tag>الزامی</Tag> : null}{a.identifier ? <Tag>شناسه</Tag> : null}{a.archived ? <Tag>بایگانی</Tag> : null}</Space> },
                      ...(admin
                        ? [{
                            title: "", key: "x", width: 150,
                            render: (_: unknown, a: AttrDef) => (
                              <Space size={4}>
                                <Button size="small" type="text" onClick={() => setEditing({ attr: a })}>ویرایش</Button>
                                <Button size="small" type="text" icon={<Archive size={14} strokeWidth={1.4} absoluteStrokeWidth />} onClick={() => saveAttrs(own.map((x) => (x.name === a.name ? { ...x, archived: !x.archived } : x)))}>
                                  {a.archived ? "بازگرداندن" : "بایگانی"}
                                </Button>
                              </Space>
                            ),
                          }]
                        : []),
                    ]}
                  />
                ) : (
                  <Empty className="py-4" image={Empty.PRESENTED_IMAGE_SIMPLE} description="این کلاس ویژگی خودش را ندارد" />
                )}
              </Card>
              {inherited.length ? (
                <Card title="به ارث رسیده" flush>
                  <Table
                    rowKey="name"
                    size="small"
                    pagination={false}
                    dataSource={inherited}
                    columns={[
                      { title: "عنوان", dataIndex: "label", key: "l" },
                      { title: "نوع", dataIndex: "type", key: "t", render: (v: AttrType) => ATTR_TYPES[v] ?? v },
                      { title: "از کلاس", dataIndex: "from", key: "f", render: (v: string) => <button type="button" className="ds-link" onClick={() => setSelected(v)}>{labelOf(v)}</button> },
                    ]}
                  />
                </Card>
              ) : null}
              {cls.all_required.length || cls.all_recommended.length || cls.all_rel_rules.length || cls.all_controlled.length ? (
                <Card title="قواعد کلاس (با ارث)">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13px]">
                    {cls.all_required.length ? (<><dt className="text-ink-3">الزامی</dt><dd>{cls.all_required.join("، ")}</dd></>) : null}
                    {cls.all_recommended.length ? (<><dt className="text-ink-3">توصیه‌شده</dt><dd>{cls.all_recommended.join("، ")}</dd></>) : null}
                    {cls.all_controlled.length ? (<><dt className="text-ink-3">زیر کنترل تغییر</dt><dd>{cls.all_controlled.join("، ")}</dd></>) : null}
                    {cls.all_rel_rules.length ? (
                      <>
                        <dt className="text-ink-3">رابطه‌های لازم</dt>
                        <dd>
                          <ul className="flex flex-col gap-0.5">
                            {cls.all_rel_rules.map((r, i) => <li key={i}>{r.label ?? `${q.data!.types.find((t) => t.key === r.type)?.label ?? r.type}${r.target ? ` ${labelOf(r.target)}` : ""}${r.min ? ` (دست‌کم ${fa(r.min)})` : ""}`}</li>)}
                          </ul>
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </Card>
              ) : null}
              {!admin ? <Note>تغییر کلاس‌ها با مدیر پیکربندی است.</Note> : null}
            </div>
          ) : null}
        </div>
      )}
      {editing ? (
        <AttrEditor
          open
          value={editing.attr}
          taken={new Set((cls?.all_attrs ?? []).map((a) => a.name))}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            const next = editing.attr ? own.map((x) => (x.name === editing.attr!.name ? a : x)) : [...own, a];
            setEditing(null);
            void saveAttrs(next);
          }}
        />
      ) : null}
    </div>
  );
}
