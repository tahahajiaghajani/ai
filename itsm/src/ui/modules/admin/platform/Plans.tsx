// «طرح‌ها و قابلیت‌ها» of the platform owner's console: plans and their limits, every organisation's plan and what it
// uses against its limits (a plan and per-organisation overrides are set here), and the feature flags — stage,
// roll-out share, plans, organisations switched on or off by name, and whether tenant administrators may switch it.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Slider, Switch, Table } from "antd";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { FLAG_STAGES, LIMITS, type FlagRow, type FlagStage, type LimitKey, type PlanRow } from "@shared/admin/plans";
import { api } from "../../../lib/api";
import { useAction } from "../../../lib/hooks";
import { fa } from "../../../lib/fa";
import { PageHeader } from "../../../components/layout";
import { Chip, Skeleton } from "../../../components/display";
import { Card } from "../../../components/blocks";
import { ICON, useAdminQuery } from "../../../pages/admin/ui";

type Tab = "plans" | "orgs" | "flags";
type Limits = Partial<Record<LimitKey, number>>;
type FlagView = FlagRow & { orgs_enabled: number; orgs_total: number };

interface OrgUsage {
  org_id: string;
  name: string;
  plan: string;
  plan_name: string | null;
  overrides: Limits;
  limits: Limits;
  usage: Record<LimitKey, number>;
  tones: Partial<Record<LimitKey, "ok" | "warning" | "danger">>;
}

const TONE = { ok: "in", warning: "warning", danger: "danger" } as const;
const STAGE_TONE: Record<FlagStage, "neutral" | "warning" | "in"> = { off: "neutral", beta: "warning", on: "in" };

function LimitsFields({ prefix }: { prefix: string }) {
  return (
    <div className="grid gap-x-3 sm:grid-cols-2">
      {LIMITS.map((l) => (
        <Form.Item key={l.key} name={[prefix, l.key]} label={`${l.label} (${l.unit})`} tooltip={`در سقف: ${l.blocks}`}>
          <InputNumber min={0} className="w-full" placeholder="بدون سقف" />
        </Form.Item>
      ))}
    </div>
  );
}

const cleanLimits = (v: Record<string, unknown> | undefined): Record<string, number | null> =>
  Object.fromEntries(LIMITS.map((l) => [l.key, v?.[l.key] === undefined || v?.[l.key] === null || v?.[l.key] === "" ? null : Number(v[l.key])]));

// ---------------------------------------------------------------- plans

function PlanEditor({ plan, flags, onClose }: { plan: (PlanRow & { orgs?: number }) | "new" | null; flags: FlagRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const isNew = plan === "new";
  const save = useAction((v: Record<string, any>) => api.put(`/admin/plans/${isNew ? v.key : (plan as PlanRow).key}`, { name: v.name, description: v.description || null, limits: cleanLimits(v.limits), features: v.features ?? [], sort_order: v.sort_order ?? 0, is_default: !!v.is_default, active: v.active !== false }), {
    success: "طرح ذخیره شد",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "console"] });
      onClose();
    },
  });
  return (
    <Modal open={!!plan} title={isNew ? "طرح تازه" : `طرح «${(plan as PlanRow | null)?.name ?? ""}»`} okText="ذخیره" cancelText="انصراف" width={640} confirmLoading={save.isPending} onCancel={onClose} onOk={() => form.validateFields().then((v) => save.mutate(v))} destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={plan && plan !== "new" ? { ...plan } : { active: true, limits: {}, features: [] }}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Form.Item name="key" label="کلید" rules={[{ required: isNew, pattern: /^[a-z][a-z0-9_]{0,30}$/, message: "حرف کوچک لاتین، رقم و _" }]}>
            <Input dir="ltr" className="ltr" disabled={!isNew} />
          </Form.Item>
          <Form.Item name="name" label="نام" rules={[{ required: true, min: 2, message: "نام طرح را وارد کنید" }]}>
            <Input />
          </Form.Item>
        </div>
        <Form.Item name="description" label="شرح">
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} />
        </Form.Item>
        <LimitsFields prefix="limits" />
        <Form.Item name="features" label="قابلیت‌های طرح" tooltip="قابلیت‌هایی که فهرست طرح دارند فقط برای همین طرح‌ها روشن می‌شوند">
          <Select mode="multiple" options={flags.map((f) => ({ value: f.key, label: f.label }))} />
        </Form.Item>
        <div className="flex flex-wrap gap-6">
          <Form.Item name="sort_order" label="ترتیب">
            <InputNumber min={0} />
          </Form.Item>
          <Form.Item name="is_default" label="طرح پیش‌فرض" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="active" label="فعال" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

function PlansTab({ plans, flags }: { plans: (PlanRow & { orgs: number })[]; flags: FlagRow[] }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<(PlanRow & { orgs: number }) | "new" | null>(null);
  const remove = useAction((key: string) => api.del(`/admin/plans/${key}`), { success: "طرح حذف شد", onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "console"] }) });
  return (
    <Card
      title="طرح‌ها"
      tools={
        <Button size="small" icon={<Plus {...ICON} />} onClick={() => setEdit("new")}>
          طرح تازه
        </Button>
      }
      flush
    >
      <Table
        size="small"
        rowKey="key"
        dataSource={plans}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: "طرح", dataIndex: "name", render: (v: string, p) => <span className="flex items-center gap-2">{v}{p.is_default ? <Chip tone="in">پیش‌فرض</Chip> : null}{!p.active ? <Chip tone="neutral">غیرفعال</Chip> : null}</span> },
          { title: "سازمان‌ها", dataIndex: "orgs", width: 90, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
          ...LIMITS.filter((l) => l.key !== "api_rate").map((l) => ({ key: l.key, title: l.label, render: (_: unknown, p: PlanRow) => <span className="ds-num">{p.limits[l.key] === undefined ? "—" : fa(p.limits[l.key]!)}</span> })),
          {
            key: "act",
            width: 90,
            render: (_: unknown, p: PlanRow & { orgs: number }) => (
              <span className="flex gap-1">
                <Button size="small" type="text" aria-label="ویرایش" icon={<Pencil {...ICON} />} onClick={() => setEdit(p)} />
                <Popconfirm title="این طرح حذف شود؟" okText="حذف" cancelText="انصراف" disabled={p.orgs > 0 || p.is_default} onConfirm={() => remove.mutateAsync(p.key)}>
                  <Button size="small" type="text" aria-label="حذف" disabled={p.orgs > 0 || p.is_default} icon={<Trash2 {...ICON} />} />
                </Popconfirm>
              </span>
            ),
          },
        ]}
      />
      <PlanEditor plan={edit} flags={flags} onClose={() => setEdit(null)} />
    </Card>
  );
}

// ---------------------------------------------------------------- organisations

function OrgsTab({ plans }: { plans: PlanRow[] }) {
  const qc = useQueryClient();
  const q = useAdminQuery<{ orgs: OrgUsage[] }>(["console", "usage"], "/admin/usage");
  const [edit, setEdit] = useState<OrgUsage | null>(null);
  const [form] = Form.useForm();
  const save = useAction((v: { plan: string; overrides?: Record<string, unknown> }) => api.put(`/admin/orgs/${edit!.org_id}/plan`, { plan: v.plan, overrides: Object.fromEntries(Object.entries(cleanLimits(v.overrides)).filter(([, n]) => n !== null)) }), {
    success: "طرح سازمان به‌روز شد",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "console"] });
      setEdit(null);
    },
  });
  if (!q.data) return <Skeleton rows={6} />;
  return (
    <Card title="سازمان‌ها و مصرف" flush>
      <Table
        size="small"
        rowKey="org_id"
        dataSource={q.data.orgs}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: true }}
        columns={[
          { title: "سازمان", dataIndex: "name" },
          { title: "طرح", dataIndex: "plan_name", render: (v: string | null, o) => <span className="flex items-center gap-2">{v ?? o.plan}{Object.keys(o.overrides ?? {}).length ? <Chip tone="warning">سقف ویژه</Chip> : null}</span> },
          ...LIMITS.filter((l) => l.key !== "api_rate").map((l) => ({
            key: l.key,
            title: l.label,
            render: (_: unknown, o: OrgUsage) => (
              <Chip tone={o.limits[l.key] === undefined ? "neutral" : TONE[o.tones[l.key] ?? "ok"]} dot={o.limits[l.key] !== undefined}>
                <span className="ds-num">{fa(o.usage[l.key] ?? 0)}</span>
                {o.limits[l.key] === undefined ? "" : ` / ${fa(o.limits[l.key]!)}`}
              </Chip>
            ),
          })),
          { key: "act", width: 60, render: (_: unknown, o: OrgUsage) => <Button size="small" type="text" aria-label={`طرح ${o.name}`} icon={<Pencil {...ICON} />} onClick={() => setEdit(o)} /> },
        ]}
      />
      <Modal open={!!edit} title={`طرح «${edit?.name ?? ""}»`} okText="ذخیره" cancelText="انصراف" width={640} confirmLoading={save.isPending} onCancel={() => setEdit(null)} onOk={() => form.validateFields().then((v) => save.mutate(v))} destroyOnHidden>
        {edit ? (
          <Form form={form} layout="vertical" requiredMark={false} initialValues={{ plan: edit.plan, overrides: edit.overrides }}>
            <Form.Item name="plan" label="طرح" rules={[{ required: true }]}>
              <Select options={plans.filter((p) => p.active).map((p) => ({ value: p.key, label: p.name }))} />
            </Form.Item>
            <p className="m-0 mb-2 text-[13px] text-ink-3">سقف‌های ویژهٔ این سازمان (خالی: سقف طرح)</p>
            <LimitsFields prefix="overrides" />
          </Form>
        ) : null}
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------- feature flags

function FlagsTab({ flags, plans }: { flags: FlagView[]; plans: PlanRow[] }) {
  const qc = useQueryClient();
  const orgs = useAdminQuery<{ orgs: { id: string; name: string }[] }>(["console", "orgs"], "/admin/orgs");
  const [edit, setEdit] = useState<FlagRow | "new" | null>(null);
  const [form] = Form.useForm();
  const stage = Form.useWatch("stage", form) as FlagStage | undefined;
  const isNew = edit === "new";
  const save = useAction((v: Record<string, any>) => api.put(`/admin/flags/${isNew ? v.key : (edit as FlagRow).key}`, { label: v.label, description: v.description || null, stage: v.stage, percent: v.percent ?? 0, plans: v.plans ?? [], orgs_on: v.orgs_on ?? [], orgs_off: v.orgs_off ?? [], tenant_toggle: !!v.tenant_toggle }), {
    success: "قابلیت ذخیره شد",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "console"] });
      setEdit(null);
    },
  });
  const remove = useAction((key: string) => api.del(`/admin/flags/${key}`), { success: "قابلیت حذف شد", onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "console"] }) });
  const orgOptions = (orgs.data?.orgs ?? []).map((o) => ({ value: o.id, label: o.name }));
  return (
    <Card
      title="کلیدهای قابلیت"
      tools={
        <Button size="small" icon={<Plus {...ICON} />} onClick={() => setEdit("new")}>
          قابلیت تازه
        </Button>
      }
      flush
    >
      <Table<FlagView>
        size="small"
        rowKey="key"
        dataSource={flags}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: "قابلیت", dataIndex: "label", render: (v: string, f) => <span className="flex flex-col"><span>{v}</span><span className="ltr ds-mono text-[12px] text-ink-3">{f.key}</span></span> },
          { title: "مرحله", dataIndex: "stage", width: 110, render: (v: FlagStage, f) => <Chip tone={STAGE_TONE[v]}>{FLAG_STAGES[v]}{v === "beta" ? ` ${fa(f.percent)}٪` : ""}</Chip> },
          { title: "طرح‌ها", dataIndex: "plans", render: (v: string[]) => (v.length ? v.map((k) => plans.find((p) => p.key === k)?.name ?? k).join("، ") : <span className="text-ink-3">همه</span>) },
          { title: "روشن برای", width: 120, render: (_: unknown, f: FlagView) => <span className="ds-num">{fa(f.orgs_enabled)} از {fa(f.orgs_total)}</span> },
          { title: "کلید سازمان", dataIndex: "tenant_toggle", width: 100, render: (v: boolean) => (v ? <Chip tone="in">دارد</Chip> : <span className="text-ink-3">—</span>) },
          {
            key: "act",
            width: 90,
            render: (_: unknown, f: FlagView) => (
              <span className="flex gap-1">
                <Button size="small" type="text" aria-label="ویرایش" icon={<Pencil {...ICON} />} onClick={() => setEdit(f)} />
                <Popconfirm title="این قابلیت حذف شود؟ (برای همه روشن می‌شود)" okText="حذف" cancelText="انصراف" onConfirm={() => remove.mutateAsync(f.key)}>
                  <Button size="small" type="text" aria-label="حذف" icon={<Trash2 {...ICON} />} />
                </Popconfirm>
              </span>
            ),
          },
        ]}
      />
      <Modal open={!!edit} title={isNew ? "قابلیت تازه" : `«${(edit as FlagRow | null)?.label ?? ""}»`} okText="ذخیره" cancelText="انصراف" width={640} confirmLoading={save.isPending} onCancel={() => setEdit(null)} onOk={() => form.validateFields().then((v) => save.mutate(v))} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={edit && edit !== "new" ? edit : { stage: "off", percent: 0, plans: [], orgs_on: [], orgs_off: [], tenant_toggle: false }}>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Form.Item name="key" label="کلید" rules={[{ required: isNew, pattern: /^[a-z][a-z0-9_]{0,40}$/, message: "حرف کوچک لاتین، رقم و _" }]}>
              <Input dir="ltr" className="ltr" disabled={!isNew} />
            </Form.Item>
            <Form.Item name="label" label="نام" rules={[{ required: true, min: 2 }]}>
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="description" label="شرح">
            <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} />
          </Form.Item>
          <Form.Item name="stage" label="مرحله">
            <Segmented options={(Object.keys(FLAG_STAGES) as FlagStage[]).map((s) => ({ value: s, label: FLAG_STAGES[s] }))} />
          </Form.Item>
          {stage === "beta" ? (
            <Form.Item name="percent" label="سهم سازمان‌ها (٪)">
              <Slider min={0} max={100} />
            </Form.Item>
          ) : null}
          <Form.Item name="plans" label="فقط برای طرح‌ها" tooltip="خالی: همهٔ طرح‌ها">
            <Select mode="multiple" options={plans.map((p) => ({ value: p.key, label: p.name }))} />
          </Form.Item>
          <Form.Item name="orgs_on" label="همیشه روشن برای">
            <Select mode="multiple" showSearch optionFilterProp="label" options={orgOptions} />
          </Form.Item>
          <Form.Item name="orgs_off" label="همیشه خاموش برای">
            <Select mode="multiple" showSearch optionFilterProp="label" options={orgOptions} />
          </Form.Item>
          <Form.Item name="tenant_toggle" valuePropName="checked">
            <Checkbox>مدیر سازمان بتواند آن را برای سازمانش خاموش و روشن کند</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default function Plans() {
  const [tab, setTab] = useState<Tab>("plans");
  const plans = useAdminQuery<{ plans: (PlanRow & { orgs: number })[] }>(["console", "plans"], "/admin/plans");
  const flags = useAdminQuery<{ flags: FlagView[] }>(["console", "flags"], "/admin/flags");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="طرح‌ها و قابلیت‌ها" />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "plans", label: "طرح‌ها" },
          { value: "orgs", label: "سازمان‌ها و مصرف" },
          { value: "flags", label: "کلیدهای قابلیت" },
        ]}
        className="self-start"
      />
      {!plans.data || !flags.data ? (
        <Skeleton rows={6} />
      ) : tab === "plans" ? (
        <PlansTab plans={plans.data.plans} flags={flags.data.flags} />
      ) : tab === "orgs" ? (
        <OrgsTab plans={plans.data.plans} />
      ) : (
        <FlagsTab flags={flags.data.flags} plans={plans.data.plans} />
      )}
    </div>
  );
}
