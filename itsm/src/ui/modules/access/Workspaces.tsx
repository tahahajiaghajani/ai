// «فضاهای کاری»: the organisation's service desks (IT, HR, facilities…). A member belongs to a workspace through one
// of its groups or directly (their profile); agents see the records of their workspaces, secure ones only their
// members — not even tenant admins and auditors.
import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Form, Input, Select, Switch, Popconfirm } from "antd";
import { Plus, Lock, LayoutGrid, Trash2 } from "lucide-react";
import { COLOR_KEYS } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, ICON14, cx } from "../../components/blocks";
import { KEYS, useAccessAdmin, useTable, type GroupRow, type Rec, type WorkspaceRow } from "./api";
import { NoAccess } from "./parts";

const COLOR_LABEL: Record<string, string> = {
  gray: "خاکستری", red: "قرمز", orange: "نارنجی", gold: "طلایی", green: "سبز", teal: "فیروزه‌ای", blue: "آبی", indigo: "نیلی", purple: "بنفش", magenta: "سرخابی",
};

export default function Workspaces() {
  const { api } = useOrg();
  const rows = useTable<WorkspaceRow>("workspace");
  const groups = useTable<GroupRow>("group");
  const profiles = useTable<Rec & { workspaces: string[] }>("member_profile");
  const { manageOrg } = useAccessAdmin();
  const [open, setOpen] = useState<WorkspaceRow | "new" | null>(null);
  const [form] = Form.useForm();
  const editing = open && open !== "new" ? open : null;
  const stats = useMemo(() => {
    const g = new Map<string, number>();
    for (const x of groups.data ?? []) if (x.workspace_id) g.set(x.workspace_id, (g.get(x.workspace_id) ?? 0) + 1);
    const m = new Map<string, number>();
    for (const p of profiles.data ?? []) for (const w of p.workspaces ?? []) m.set(w, (m.get(w) ?? 0) + 1);
    return { g, m };
  }, [groups.data, profiles.data]);

  useEffect(() => {
    form.resetFields();
    if (editing) form.setFieldsValue(editing);
    else form.setFieldsValue({ active: true, secure: false, is_default: !(rows.data ?? []).length });
  }, [editing?.id, editing?.version, open, form]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(
    (v: Record<string, unknown>) => (editing ? api.patch(`/r/workspace/${editing.id}`, { ...v, version: editing.version }) : api.post(`/r/workspace`, v)),
    { success: "فضای کاری ذخیره شد.", invalidate: [KEYS.table("workspace"), KEYS.me], onSuccess: () => setOpen(null) },
  );
  const remove = useAction(() => api.del(`/r/workspace/${editing!.id}?version=${editing!.version}`), {
    success: "فضای کاری حذف شد.",
    invalidate: [KEYS.table("workspace"), KEYS.me],
    onSuccess: () => setOpen(null),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="فضاهای کاری"
        actions={
          manageOrg ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setOpen("new")}>
              فضای کاری تازه
            </Button>
          ) : null
        }
      />
      {rows.isLoading ? (
        <Loader />
      ) : rows.isError ? (
        <NoAccess error={rows.error} />
      ) : !rows.data?.length ? (
        <EmptyState
          icon={LayoutGrid}
          title="هنوز فضای کاری‌ای تعریف نشده است"
          action={manageOrg ? <Button type="primary" onClick={() => setOpen("new")}>فضای کاری نخست</Button> : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...rows.data].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name, "fa")).map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setOpen(w)}
              className={cx("flex min-w-0 flex-col items-start gap-2 rounded-lg border border-line bg-surface p-4 text-start transition-colors hover:bg-[var(--ds-hover)]", !w.active && "opacity-70")}
            >
              <span className="flex w-full items-center gap-2">
                <span className="inline-grid size-8 place-items-center rounded-md bg-sunken text-ink-2" aria-hidden>
                  {w.secure ? <Lock {...ICON} /> : <LayoutGrid {...ICON} />}
                </span>
                <span className="ds-t-title truncate text-ink">{w.name}</span>
                <span className="ds-ltr ms-auto text-[12px] text-ink-3">{w.key}</span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {w.is_default ? <Chip tone="accent" dot={false}>پیش‌فرض</Chip> : null}
                {w.secure ? <Chip tone="warning" dot={false}>امن</Chip> : null}
                {!w.active ? <Chip dot={false}>غیرفعال</Chip> : null}
              </span>
              <span className="text-[13px] text-ink-3">
                <span className="ds-num">{faDigits(stats.g.get(w.id) ?? 0)}</span> گروه · <span className="ds-num">{faDigits(stats.m.get(w.id) ?? 0)}</span> عضو مستقیم
              </span>
            </button>
          ))}
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} size={480} destroyOnHidden title={editing ? editing.name : "فضای کاری تازه"}>
        <Form form={form} layout="vertical" requiredMark={false} disabled={!manageOrg} onFinish={(v) => save.mutate(v)}>
          <div className="grid gap-x-3 sm:grid-cols-[2fr_1fr]">
            <Form.Item name="name" label="نام" rules={[{ required: true, message: "نام را بنویسید." }]}>
              <Input maxLength={120} placeholder="فناوری اطلاعات" />
            </Form.Item>
            <Form.Item name="key" label="کلید" rules={[{ required: true, pattern: /^[a-z][a-z0-9_-]*$/, message: "حروف لاتین کوچک، رقم، - و _" }]}>
              <Input dir="ltr" maxLength={40} placeholder="it" disabled={!!editing} />
            </Form.Item>
          </div>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Form.Item name="icon" label="نشانه (نام Lucide)">
              <Input dir="ltr" maxLength={40} placeholder="headset" />
            </Form.Item>
            <Form.Item name="color" label="رنگ">
              <Select allowClear options={COLOR_KEYS.map((c) => ({ value: c, label: COLOR_LABEL[c] ?? c }))} />
            </Form.Item>
          </div>
          <Form.Item name="description" label="شرح">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item name="secure" label="امن" valuePropName="checked" extra="رکوردهای فضای کاری امن را فقط اعضای آن می‌بینند؛ مدیر سامانه، ممیز و پشتیبانی هم نه.">
            <Switch />
          </Form.Item>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Form.Item name="is_default" label="پیش‌فرض" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="active" label="فعال" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          {manageOrg ? (
            <div className="flex items-center gap-2">
              <Button type="primary" htmlType="submit" loading={save.isPending}>
                ذخیره
              </Button>
              {editing ? (
                <Popconfirm title="این فضای کاری حذف شود؟" description="پیش از حذف، گروه‌ها و رکوردهای آن را به فضای دیگری ببرید." okText="حذف" cancelText="انصراف" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate()}>
                  <Button danger type="text" icon={<Trash2 {...ICON14} />} className="ms-auto">
                    حذف
                  </Button>
                </Popconfirm>
              ) : null}
            </div>
          ) : null}
        </Form>
      </Drawer>
    </div>
  );
}
