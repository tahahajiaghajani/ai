// Chart of accounts as a tree with roles (system keys) and dimension settings.
import { useMemo, useState } from "react";
import { Button, Tree, Drawer, Form, Input, Select, Switch, Tag, Empty, Tooltip, Space } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, DownloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { faDigits } from "@shared/format";
import { exportExcel } from "../../lib/excel";
import { KIND_LABEL, NATURE_LABEL, DETAIL_KINDS } from "./labels";

interface Acc {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  level: number;
  kind: string;
  nature: string;
  is_postable: boolean;
  detail_mode: string;
  detail_kinds: string[];
  fx_mode: string;
  weight_mode: string;
  system_key: string | null;
  is_active: boolean;
  line_count: number;
  description: string | null;
}

export default function Accounts() {
  const { api, can } = useOrg();
  const q = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<{ accounts: Acc[] }>("/accounting/accounts").then((r) => r.accounts) });
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Acc> | null>(null);
  const n = useNotify();
  const del = useAction((id: string) => api.del(`/accounting/accounts/${id}`), { success: "حساب حذف شد", invalidate: [["accounts"]] });
  const accounts = q.data ?? [];

  const tree = useMemo(() => {
    const kids = new Map<string | null, Acc[]>();
    for (const a of accounts) kids.set(a.parent_id, [...(kids.get(a.parent_id) ?? []), a]);
    const s = search.trim();
    const match = (a: Acc): boolean => !s || a.name.includes(s) || a.code.startsWith(s) || (kids.get(a.id) ?? []).some(match);
    const build = (pid: string | null): any[] =>
      (kids.get(pid) ?? []).filter(match).map((a) => ({
        key: a.id,
        title: (
          <div className={`flex items-center gap-2 py-0.5 ${a.is_active ? "" : "opacity-50"}`}>
            <span className="num w-12 text-muted">{faDigits(a.code)}</span>
            <span className={a.level === 1 ? "font-bold" : a.level === 2 ? "font-semibold" : ""}>{a.name}</span>
            {a.system_key ? <Tooltip title={`نقش در ثبت خودکار: ${a.system_key}`}><Tag variant="filled" color="cyan" className="!text-[10px]">خودکار</Tag></Tooltip> : null}
            {a.detail_mode !== "none" ? <Tag variant="filled" className="!text-[10px]">تفصیلی {a.detail_mode === "required" ? "الزامی" : "اختیاری"}</Tag> : null}
            {a.fx_mode !== "none" ? <Tag variant="filled" color="gold" className="!text-[10px]">ارزی</Tag> : null}
            {a.weight_mode !== "none" ? <Tag variant="filled" color="orange" className="!text-[10px]">وزنی</Tag> : null}
            {a.line_count ? <span className="num text-[11px] text-muted">({faDigits(a.line_count)} گردش)</span> : null}
            {can("accounting", "full") ? (
              <span className="ms-auto flex gap-1 opacity-0 transition group-hover:opacity-100 [.ant-tree-treenode:hover_&]:opacity-100" onClick={(e) => e.stopPropagation()}>
                {a.level < 3 ? <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => setEdit({ parent_id: a.id, kind: a.kind, nature: a.nature, level: a.level + 1 })} aria-label="زیرحساب" /> : null}
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEdit(a)} aria-label="ویرایش" />
                {!a.line_count ? (
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={async () => { if (await n.confirm(`حذف حساب «${a.name}»؟`, undefined, true)) del.mutate(a.id); }} aria-label="حذف" />
                ) : null}
              </span>
            ) : null}
          </div>
        ),
        children: build(a.id),
      }));
    return build(null);
  }, [accounts, search, can, n, del]);

  const save = useAction(
    (v: any) => (edit?.id ? api.patch(`/accounting/accounts/${edit.id}`, v) : api.post("/accounting/accounts", { ...v, parent_id: edit?.parent_id ?? null })),
    { success: "ذخیره شد", invalidate: [["accounts"], ["options", "account"]], onSuccess: () => setEdit(null) },
  );

  return (
    <div>
      <PageHeader
        title="کدینگ حساب‌ها"
        subtitle="گروه ← کل ← معین؛ اشخاص، بانک‌ها و صندوق‌ها حساب تفصیلی دارند"
        actions={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => exportExcel("کدینگ حساب‌ها", [
              { title: "کد", value: (a: Acc) => a.code }, { title: "نام", value: (a: Acc) => a.name }, { title: "سطح", value: (a: Acc) => ["", "گروه", "کل", "معین"][a.level] },
              { title: "ماهیت", value: (a: Acc) => NATURE_LABEL[a.nature] }, { title: "نوع", value: (a: Acc) => KIND_LABEL[a.kind] },
            ], accounts)}>خروجی</Button>
            {can("accounting", "full") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setEdit({ parent_id: null, level: 1, kind: "asset", nature: "debit" })}>گروه جدید</Button> : null}
          </Space>
        }
      />
      <div className="tz-card p-4">
        <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="جستجوی کد یا نام حساب" className="!mb-3 !w-72" value={search} onChange={(e) => setSearch(e.target.value)} />
        {accounts.length ? (
          <Tree blockNode showLine defaultExpandedKeys={accounts.filter((a) => a.level === 1).map((a) => a.id)} expandedKeys={search ? accounts.map((a) => a.id) : undefined} treeData={tree} selectable={false} className="[&_.ant-tree-node-content-wrapper]:!w-full" />
        ) : (
          <Empty />
        )}
      </div>
      <Drawer open={!!edit} onClose={() => setEdit(null)} size={480} title={edit?.id ? "ویرایش حساب" : "حساب جدید"} destroyOnHidden>
        {edit ? (
          <Form
            layout="vertical"
            initialValues={{ ...edit, detail_kinds: edit.detail_kinds ?? [], is_active: edit.is_active ?? true, detail_mode: edit.detail_mode ?? "none", fx_mode: edit.fx_mode ?? "none", weight_mode: edit.weight_mode ?? "none" }}
            onFinish={(v) => save.mutate(v)}
          >
            <div className="grid grid-cols-3 gap-3">
              <Form.Item name="code" label="کد" tooltip="خالی بگذارید تا خودکار پر شود">
                <Input dir="ltr" />
              </Form.Item>
              <Form.Item name="name" label="نام حساب" rules={[{ required: true, message: "نام را وارد کنید" }]} className="col-span-2">
                <Input />
              </Form.Item>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Form.Item name="kind" label="نوع">
                <Select options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="nature" label="ماهیت">
                <Select options={Object.entries(NATURE_LABEL).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
            </div>
            {(edit.level ?? 3) >= 3 || edit.is_postable ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Form.Item name="detail_mode" label="حساب تفصیلی">
                    <Select options={[{ value: "none", label: "ندارد" }, { value: "optional", label: "اختیاری" }, { value: "required", label: "الزامی" }]} />
                  </Form.Item>
                  <Form.Item name="detail_kinds" label="نوع تفصیلی‌های مجاز">
                    <Select mode="multiple" options={DETAIL_KINDS} placeholder="همه" />
                  </Form.Item>
                  <Form.Item name="fx_mode" label="مبلغ ارزی">
                    <Select options={[{ value: "none", label: "ندارد" }, { value: "optional", label: "اختیاری" }, { value: "required", label: "الزامی" }]} />
                  </Form.Item>
                  <Form.Item name="weight_mode" label="وزن طلا">
                    <Select options={[{ value: "none", label: "ندارد" }, { value: "optional", label: "اختیاری" }, { value: "required", label: "الزامی" }]} />
                  </Form.Item>
                </div>
                <Form.Item name="system_key" label="نقش در ثبت‌های خودکار" tooltip="برای مثال cash، ar، sales؛ فقط اگر می‌خواهید ثبت‌های خودکار از این حساب استفاده کنند">
                  <Input dir="ltr" />
                </Form.Item>
              </>
            ) : null}
            <Form.Item name="is_active" label="فعال" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="description" label="توضیحات">
              <Input.TextArea autoSize={{ minRows: 2 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              ذخیره
            </Button>
          </Form>
        ) : null}
      </Drawer>
    </div>
  );
}
