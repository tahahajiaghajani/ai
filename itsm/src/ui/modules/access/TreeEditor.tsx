// A tree of the organisation structure (units or locations): search, drag a node onto another to move it (the server
// refuses cycles and keeps every path), select a node to edit it beside the tree, add a child, delete a leaf. Only
// those whose roles change the `org` area edit; everyone else reads.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Form, Input, Select, Switch, Tree, Popconfirm, Empty } from "antd";
import type { TreeProps } from "antd";
import { Plus, Search, Trash2, CornerDownLeft, type LucideIcon } from "lucide-react";
import type { Option } from "@shared/model/types";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { normalizeFa } from "../../lib/fa";
import { faDigits } from "@shared/format";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, ICON14, cx } from "../../components/blocks";
import { KEYS, useAccessAdmin, useTable, type Rec, type UnitRow } from "./api";
import { forest, MemberSelect, NoAccess, subtreeIds, TreeRefSelect, type TreeNode } from "./parts";

export interface TreeEditorProps {
  table: "org_unit" | "location";
  title: string;
  /** the noun of one node: «واحد», «مکان» */
  noun: string;
  kinds: Option[];
  icons: Record<string, LucideIcon>;
  defaultKind: string;
  /** extra form fields of this tree */
  extra?: ReactNode;
  /** a small figure after a node's name (members of a unit…) */
  badge?: (row: UnitRow) => ReactNode;
}

type Draft = Partial<UnitRow> & { id?: string };

export function TreeEditor({ table, title, noun, kinds, icons, defaultKind, extra, badge }: TreeEditorProps) {
  const { api } = useOrg();
  const rows = useTable<UnitRow>(table);
  const { manageOrg } = useAccessAdmin();
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const [form] = Form.useForm();
  const byId = useMemo(() => new Map((rows.data ?? []).map((r) => [r.id, r])), [rows.data]);
  const roots = useMemo(() => forest(rows.data ?? []), [rows.data]);
  const kindLabel = (k: string) => kinds.find((o) => o.value === k)?.label ?? k;

  const save = useAction(
    async (v: Draft) => {
      const { id, version, ...data } = v;
      return id ? api.patch<{ row: Rec }>(`/r/${table}/${id}`, { ...data, version }) : api.post<{ row: Rec }>(`/r/${table}`, data);
    },
    {
      success: "ذخیره شد.",
      invalidate: [KEYS.table(table), KEYS.me],
      onSuccess: (r) => {
        setDraft(null);
        setSelected(r.row.id);
      },
    },
  );
  const move = useAction(({ id, parent }: { id: string; parent: string | null }) => api.patch(`/r/${table}/${id}`, { parent_id: parent, version: byId.get(id)?.version }), {
    success: `${noun} جابه‌جا شد.`,
    invalidate: [KEYS.table(table), KEYS.me],
  });
  const remove = useAction((id: string) => api.del(`/r/${table}/${id}?version=${byId.get(id)?.version ?? ""}`), {
    success: `${noun} حذف شد.`,
    invalidate: [KEYS.table(table), KEYS.me],
    onSuccess: () => setSelected(null),
  });

  const current: Draft | null = draft ?? (selected ? byId.get(selected) ?? null : null);
  useEffect(() => {
    form.resetFields();
    if (current) form.setFieldsValue({ ...current });
  }, [current?.id, current?.version, draft, form]); // eslint-disable-line react-hooks/exhaustive-deps

  // search: matching nodes with their ancestors stay
  const needle = normalizeFa(term.trim());
  const visible = useMemo(() => {
    if (!needle) return null;
    const keep = new Set<string>();
    const walk = (node: TreeNode<UnitRow>, trail: string[]): void => {
      const hit = normalizeFa(`${node.row.name} ${node.row.code ?? ""}`).includes(needle);
      if (hit) for (const id of [...trail, node.key]) keep.add(id);
      for (const c of node.children) walk(c, [...trail, node.key]);
    };
    for (const r of roots) walk(r, []);
    return keep;
  }, [needle, roots]);

  const treeData = useMemo(() => {
    const map = (node: TreeNode<UnitRow>): Record<string, unknown> | null => {
      if (visible && !visible.has(node.key)) return null;
      const r = node.row;
      const I = icons[r.kind];
      return {
        key: node.key,
        title: (
          <span className={cx("inline-flex min-w-0 items-center gap-2 py-0.5", !r.active && "text-ink-3")}>
            {I ? <I {...ICON14} aria-hidden className="shrink-0 text-ink-3" /> : null}
            <span className="truncate">{r.name}</span>
            {r.code ? <span className="ds-ltr text-[12px] text-ink-3">{r.code}</span> : null}
            {r.is_domain ? <Chip tone="accent" dot={false}>دامنه</Chip> : null}
            {!r.active ? <Chip dot={false}>غیرفعال</Chip> : null}
            {badge?.(r)}
          </span>
        ),
        children: node.children.map(map).filter(Boolean),
      };
    };
    return roots.map(map).filter(Boolean) as unknown as TreeProps["treeData"];
  }, [roots, visible, icons, badge]);

  const allKeys = useMemo(() => (rows.data ?? []).map((r) => r.id), [rows.data]);

  const onDrop: TreeProps["onDrop"] = (info) => {
    const id = String(info.dragNode.key);
    const target = byId.get(String(info.node.key));
    if (!target) return;
    const parent = info.dropToGap ? target.parent_id : target.id;
    if ((byId.get(id)?.parent_id ?? null) === (parent ?? null)) return;
    move.mutate({ id, parent: parent ?? null });
  };

  const excluded = useMemo(() => {
    if (!current?.id) return undefined;
    const find = (xs: TreeNode<UnitRow>[]): TreeNode<UnitRow> | undefined => {
      for (const x of xs) {
        if (x.key === current.id) return x;
        const hit = find(x.children);
        if (hit) return hit;
      }
      return undefined;
    };
    const node = find(roots);
    return new Set(node ? subtreeIds(node) : [current.id]);
  }, [current?.id, roots]);

  const startNew = (parent: string | null) => {
    setSelected(null);
    setDraft({ parent_id: parent, kind: defaultKind, active: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        subtitle={rows.data ? `${faDigits(rows.data.length)} ${noun}` : undefined}
        actions={
          manageOrg ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => startNew(null)}>
              {noun} تازه
            </Button>
          ) : null
        }
      />
      {rows.isLoading ? (
        <Loader />
      ) : rows.isError ? (
        <NoAccess error={rows.error} />
      ) : !rows.data?.length && !draft ? (
        <EmptyState
          title={`هنوز ${noun}ی تعریف نشده است`}
          action={manageOrg ? <Button type="primary" onClick={() => startNew(null)}>{noun} نخست</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <section className="ds-card flex min-w-0 flex-col gap-3 p-4" aria-label={title}>
            <Input
              allowClear
              prefix={<Search {...ICON14} aria-hidden />}
              placeholder="جست‌وجوی نام یا کد…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {treeData?.length ? (
              <Tree
                blockNode
                showLine
                draggable={manageOrg ? { icon: false } : false}
                treeData={treeData}
                expandedKeys={visible ? [...visible] : expanded ?? allKeys}
                onExpand={(keys) => setExpanded(keys.map(String))}
                selectedKeys={selected ? [selected] : []}
                onSelect={(keys) => {
                  setDraft(null);
                  setSelected(keys.length ? String(keys[0]) : null);
                }}
                onDrop={onDrop}
              />
            ) : (
              <Empty description="موردی پیدا نشد" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
            {manageOrg ? <p className="text-[12px] text-ink-3">برای جابه‌جایی، هر مورد را روی مورد دیگر بکشید.</p> : null}
          </section>
          <section className="ds-card min-w-0 p-4" aria-label={`جزئیات ${noun}`}>
            {!current ? (
              <EmptyState compact title={`${noun}ی را انتخاب کنید`} />
            ) : (
              <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                disabled={!manageOrg}
                onFinish={(v) => save.mutate({ ...v, id: current.id, version: current.version })}
              >
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="ds-t-title text-ink">{current.id ? current.name : `${noun} تازه`}</h2>
                  {current.id && current.kind ? <Chip dot={false}>{kindLabel(current.kind)}</Chip> : null}
                </div>
                <Form.Item name="name" label="نام" rules={[{ required: true, message: "نام را بنویسید." }]}>
                  <Input maxLength={150} />
                </Form.Item>
                <div className="grid gap-x-3 sm:grid-cols-2">
                  <Form.Item name="kind" label="نوع">
                    <Select options={kinds.map((k) => ({ value: k.value, label: k.label }))} />
                  </Form.Item>
                  <Form.Item name="code" label="کد">
                    <Input dir="ltr" maxLength={40} />
                  </Form.Item>
                </div>
                <Form.Item name="parent_id" label={`${noun} بالادستی`}>
                  <TreeRefSelect table={table} exclude={excluded} placeholder="ریشه (بدون بالادستی)" />
                </Form.Item>
                {table === "org_unit" ? (
                  <Form.Item name="manager_id" label="مدیر واحد" extra="مدیر واحد درخواست‌ها و رخدادهای افراد واحد و زیرمجموعه‌هایش را می‌بیند.">
                    <MemberSelect />
                  </Form.Item>
                ) : null}
                {extra}
                <Form.Item name="active" label="فعال" valuePropName="checked">
                  <Switch />
                </Form.Item>
                {manageOrg ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="primary" htmlType="submit" loading={save.isPending}>
                      ذخیره
                    </Button>
                    {current.id ? (
                      <Button icon={<CornerDownLeft {...ICON14} />} onClick={() => startNew(current.id!)}>
                        زیرمجموعهٔ تازه
                      </Button>
                    ) : (
                      <Button onClick={() => setDraft(null)}>انصراف</Button>
                    )}
                    {current.id ? (
                      <Popconfirm title={`این ${noun} حذف شود؟`} okText="حذف" cancelText="انصراف" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(current.id!)}>
                        <Button danger type="text" icon={<Trash2 {...ICON14} />} className="ms-auto">
                          حذف
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </div>
                ) : null}
              </Form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
