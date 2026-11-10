// «دسته‌بندی‌ها»: the category tree of a table — categories and their subcategories, each with its code (the value
// records store), default group (an unassigned record of that category goes to it), workspace, order and whether it
// is offered. Select a node to edit it beside the tree; «زیردسته» adds a child. The table's «دسته»/«زیردسته» choice
// lists follow the tree (the server keeps them in step; records keep the value they have).
import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Form, Input, Popconfirm, Select, Switch, Tree } from "antd";
import { FolderTree, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { NumberInput } from "../../components/inputs";
import { ICON, ICON14, cx } from "../../components/blocks";
import { RecordSelect, recordKeys, recordsApi, useSchema } from "../../records";
import { categoryTree, suggestCode, type CategoryRow } from "./model";

type Draft = Partial<CategoryRow> & { default_group_id?: string | null; workspace_id?: string | null; description?: string | null; version?: number };

export default function Categories() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const { schema } = useSchema();
  const tables = useMemo(
    () =>
      [...(schema?.tables.values() ?? [])]
        .filter((t) => t.key !== "category" && t.fields.some((f) => f.name === "category" && f.type === "choice"))
        .sort((a, b) => a.plural.localeCompare(b.plural, "fa")),
    [schema],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const table = picked ?? tables[0]?.key ?? null;
  const canEdit = !!schema?.def("category")?.can.create;
  const list = useQuery({
    queryKey: [...recordKeys.lists(orgId, "category"), "tree", table],
    queryFn: () => recordsApi.list(api, "category", { filter: { f: "table_key", op: "eq", v: table }, size: 500, sort: "sort_order,name" }),
    enabled: !!table,
  });
  const rows = (list.data?.rows ?? []) as unknown as (CategoryRow & Draft)[];
  const display = list.data?.display ?? {};
  const tree = useMemo(() => categoryTree(rows), [rows]);
  const [sel, setSel] = useState<Draft | null>(null);
  const [form] = Form.useForm<Draft>();
  const name = Form.useWatch("name", form);
  const editing = sel?.id ? rows.find((r) => r.id === sel.id) ?? null : null;
  const hasChildren = !!editing && rows.some((r) => r.parent_id === editing.id);

  useEffect(() => {
    form.resetFields();
    if (sel) form.setFieldsValue({ active: true, sort_order: 100, ...sel });
  }, [sel, form]);
  useEffect(() => setSel(null), [table]);

  const changed = () => {
    void qc.invalidateQueries({ queryKey: recordKeys.lists(orgId, "category") });
    // the «دسته» options of the tables come with the schema
    void qc.invalidateQueries({ queryKey: recordKeys.meta(orgId) });
  };
  const save = useAction(
    (v: Draft) => {
      const data = {
        name: v.name, value: v.value, parent_id: v.parent_id || null, default_group_id: v.default_group_id || null, sort_order: v.sort_order === undefined || v.sort_order === null ? 100 : Number(v.sort_order),
        active: v.active !== false, description: v.description ?? null,
      };
      return editing
        ? api.patch<{ row: CategoryRow }>(`/r/category/${editing.id}`, { ...data, version: editing.version })
        : api.post<{ row: CategoryRow }>(`/r/category`, { ...data, table_key: table, ...(v.workspace_id ? { workspace_id: v.workspace_id } : {}) });
    },
    {
      success: "دسته ذخیره شد.",
      onSuccess: (r) => {
        changed();
        setSel(r.row);
      },
    },
  );
  const remove = useAction(() => api.del(`/r/category/${editing!.id}?version=${editing!.version}`), {
    success: "دسته حذف شد.",
    onSuccess: () => {
      setSel(null);
      changed();
    },
  });

  const roots = rows.filter((r) => !r.parent_id && r.id !== editing?.id);
  const treeData = tree.map((n) => ({
    key: n.row.id,
    title: <NodeTitle row={n.row} groupName={n.row.default_group_id ? display[String(n.row.default_group_id)] : undefined} />,
    children: n.children.map((c) => ({ key: c.row.id, title: <NodeTitle row={c.row} groupName={c.row.default_group_id ? display[String(c.row.default_group_id)] : undefined} />, isLeaf: true })),
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="دسته‌بندی‌ها"
        actions={
          canEdit && table ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setSel({ parent_id: null })}>
              دستهٔ تازه
            </Button>
          ) : null
        }
      />
      {!schema ? (
        <Loader />
      ) : !tables.length ? (
        <EmptyState icon={FolderTree} title="هنوز جدولی فیلد «دسته» ندارد" />
      ) : (
        <>
          <Select
            className="w-full max-w-xs"
            value={table ?? undefined}
            onChange={setPicked}
            aria-label="جدول"
            options={tables.map((t) => ({ value: t.key, label: t.plural }))}
            showSearch={{ filterOption: (input, o) => String(o?.label ?? "").includes(input) }}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-h-[200px] rounded-lg border border-line bg-surface p-2">
              {list.isLoading ? (
                <Loader />
              ) : !rows.length ? (
                <EmptyState compact icon={FolderTree} title="این جدول هنوز دسته‌ای ندارد" action={canEdit ? <Button onClick={() => setSel({ parent_id: null })}>دستهٔ نخست</Button> : undefined} />
              ) : (
                <Tree
                  blockNode
                  defaultExpandAll
                  selectedKeys={sel?.id ? [sel.id] : []}
                  onSelect={(keys) => {
                    const id = String(keys[0] ?? "");
                    setSel(id ? rows.find((r) => r.id === id) ?? null : null);
                  }}
                  treeData={treeData}
                />
              )}
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              {!sel ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="دسته‌ای را برگزینید" />
              ) : (
                <Form<Draft> form={form} layout="vertical" requiredMark={false} disabled={!canEdit} onFinish={(v) => save.mutate(v)}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="ds-t-title text-ink">{editing ? editing.name : sel.parent_id ? "زیردستهٔ تازه" : "دستهٔ تازه"}</span>
                    {editing && !editing.parent_id && canEdit ? (
                      <Button size="small" className="ms-auto" icon={<Plus {...ICON14} />} onClick={() => setSel({ parent_id: editing.id, default_group_id: editing.default_group_id ?? null })}>
                        زیردسته
                      </Button>
                    ) : null}
                  </div>
                  <Form.Item name="name" label="نام" rules={[{ required: true, message: "نام را بنویسید." }]}>
                    <Input maxLength={120} />
                  </Form.Item>
                  <Form.Item
                    name="value"
                    label="کد"
                    extra={editing ? "تغییر کد، گزینهٔ پیشین را غیرفعال می‌کند؛ رکوردها مقدار خود را نگه می‌دارند." : undefined}
                    rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9_.-]{0,79}$/i, message: "حروف لاتین، رقم و _ . -" }]}
                  >
                    <Input
                      dir="ltr"
                      maxLength={80}
                      placeholder={!editing ? suggestCode(String(name ?? ""), new Set(rows.map((r) => r.value))) || "network" : undefined}
                    />
                  </Form.Item>
                  <Form.Item name="parent_id" label="دستهٔ بالادستی" extra={hasChildren ? "دسته‌ای که زیردسته دارد خودش زیردسته نمی‌شود." : undefined}>
                    <Select allowClear disabled={hasChildren} placeholder="— (دستهٔ اصلی)" options={roots.map((r) => ({ value: r.id, label: r.name }))} />
                  </Form.Item>
                  <Form.Item name="default_group_id" label="گروه پیش‌فرض">
                    <RecordSelect table="group" value={undefined} onChange={() => undefined} display={display} allowClear />
                  </Form.Item>
                  {!editing ? (
                    <Form.Item name="workspace_id" label="فضای کاری" extra="خالی: در همهٔ فضاهای کاری">
                      <RecordSelect table="workspace" value={undefined} onChange={() => undefined} allowClear />
                    </Form.Item>
                  ) : editing.workspace_id ? (
                    <p className="mb-4 text-[13px] text-ink-3">فقط در فضای کاری «{display[String(editing.workspace_id)] ?? "—"}»</p>
                  ) : null}
                  <div className="grid gap-x-3 sm:grid-cols-2">
                    <Form.Item name="sort_order" label="ترتیب">
                      <NumberInput />
                    </Form.Item>
                    <Form.Item name="active" label="فعال" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </div>
                  <Form.Item name="description" label="شرح">
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
                  </Form.Item>
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      <Button type="primary" htmlType="submit" loading={save.isPending}>
                        ذخیره
                      </Button>
                      <Button onClick={() => setSel(null)}>انصراف</Button>
                      {editing ? (
                        <Popconfirm
                          title="این دسته حذف شود؟"
                          description={hasChildren ? "نخست زیردسته‌های آن را حذف یا جابه‌جا کنید." : "رکوردهای این دسته مقدار خود را نگه می‌دارند."}
                          okText="حذف"
                          cancelText="انصراف"
                          okButtonProps={{ danger: true, disabled: hasChildren }}
                          onConfirm={() => remove.mutate()}
                        >
                          <Button danger type="text" icon={<Trash2 {...ICON14} />} className="ms-auto">
                            حذف
                          </Button>
                        </Popconfirm>
                      ) : null}
                    </div>
                  ) : null}
                </Form>
              )}
            </div>
          </div>
          <p className="text-[12px] text-ink-3">
            <span className="ds-num">{faDigits(rows.filter((r) => !r.parent_id).length)}</span> دسته و <span className="ds-num">{faDigits(rows.filter((r) => r.parent_id).length)}</span> زیردسته
          </p>
        </>
      )}
    </div>
  );
}

function NodeTitle({ row, groupName }: { row: CategoryRow; groupName?: string }) {
  return (
    <span className={cx("flex min-w-0 items-center gap-2 py-0.5", row.active === false && "opacity-60")}>
      <span className="truncate text-ink">{row.name}</span>
      <bdi dir="ltr" className="ds-mono text-[11px] text-ink-3">
        {row.value}
      </bdi>
      {groupName ? <span className="truncate text-[12px] text-ink-3">← {groupName}</span> : null}
      {row.workspace_id ? <Chip dot={false}>فضای کاری</Chip> : null}
      {row.active === false ? <Chip dot={false}>غیرفعال</Chip> : null}
    </span>
  );
}
