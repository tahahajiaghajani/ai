// «اطلاعیه‌ها» of the platform owner's console: notices to every organisation, to some, or to the organisations of
// some plans (maintenance windows, incidents, news). Publishing creates a system notice in each organisation and tells
// its members through the bell; a published notice is not sent twice.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Popconfirm, Radio, Select, Table } from "antd";
import { Megaphone, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { DEFAULT_TIMEZONE } from "@shared/constants";
import { api } from "../../../lib/api";
import { DateTimeInput } from "../../../records";
import { useAction } from "../../../lib/hooks";
import { fa } from "../../../lib/fa";
import { PageHeader } from "../../../components/layout";
import { Chip, Skeleton } from "../../../components/display";
import { Card } from "../../../components/blocks";
import { Empty, ICON, When, useAdminQuery } from "../../../pages/admin/ui";

type Severity = "info" | "warning" | "critical" | "maintenance";
type Audience = "all" | "orgs" | "plans";

interface Announcement {
  id: string;
  title: string;
  body: string | null;
  severity: Severity;
  audience: Audience;
  org_ids: string[] | null;
  plans: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  delivered: number | null;
  created_at: string;
}

const SEVERITY: Record<Severity, [string, "neutral" | "warning" | "danger" | "in"]> = {
  info: ["آگاهی", "neutral"],
  maintenance: ["نگهداری", "warning"],
  warning: ["هشدار", "warning"],
  critical: ["بحرانی", "danger"],
};
const AUDIENCE: Record<Audience, string> = { all: "همهٔ سازمان‌ها", orgs: "سازمان‌های انتخابی", plans: "طرح‌های انتخابی" };

interface FormValues {
  title: string;
  body?: string;
  severity: Severity;
  audience: Audience;
  org_ids?: string[];
  plans?: string[];
  starts_at?: string | null;
  ends_at?: string | null;
}

export default function Announcements() {
  const qc = useQueryClient();
  const list = useAdminQuery<{ announcements: Announcement[] }>(["console", "announcements"], "/admin/announcements");
  const orgs = useAdminQuery<{ orgs: { id: string; name: string }[] }>(["console", "orgs"], "/admin/orgs");
  const plans = useAdminQuery<{ plans: { key: string; name: string }[] }>(["console", "plans"], "/admin/plans");
  const [edit, setEdit] = useState<Announcement | "new" | null>(null);
  const [form] = Form.useForm<FormValues>();
  const audience = Form.useWatch("audience", form);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "console", "announcements"] });
  const payload = (v: FormValues) => ({
    title: v.title,
    body: v.body ?? "",
    severity: v.severity,
    audience: v.audience,
    org_ids: v.audience === "orgs" ? (v.org_ids ?? []) : [],
    plans: v.audience === "plans" ? (v.plans ?? []) : [],
    starts_at: v.starts_at || null,
    ends_at: v.ends_at || null,
  });
  const save = useAction((v: { values: FormValues; publish: boolean }) => (edit === "new" ? api.post("/admin/announcements", { ...payload(v.values), publish: v.publish }) : api.patch(`/admin/announcements/${(edit as Announcement).id}`, payload(v.values))), {
    success: (r: unknown) => ((r as { published?: { orgs: number } | null }).published ? `به ${fa((r as { published: { orgs: number } }).published.orgs)} سازمان فرستاده شد` : "اطلاعیه ذخیره شد"),
    onSuccess: () => {
      refresh();
      setEdit(null);
    },
  });
  const publish = useAction((id: string) => api.post<{ orgs: number }>(`/admin/announcements/${id}/publish`), { success: (r) => `به ${fa(r.orgs)} سازمان فرستاده شد`, onSuccess: refresh });
  const remove = useAction((id: string) => api.del(`/admin/announcements/${id}`), { success: "اطلاعیه حذف شد", onSuccess: refresh });
  const submit = (publishNow: boolean) => form.validateFields().then((values) => save.mutate({ values, publish: publishNow }));
  const initial = (a: Announcement | "new" | null): Partial<FormValues> =>
    a && a !== "new"
      ? { title: a.title, body: a.body ?? "", severity: a.severity, audience: a.audience, org_ids: a.org_ids ?? [], plans: a.plans ?? [], starts_at: a.starts_at, ends_at: a.ends_at }
      : { severity: "info", audience: "all" };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="اطلاعیه‌ها"
        actions={
          <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setEdit("new")}>
            اطلاعیهٔ تازه
          </Button>
        }
      />
      {!list.data ? (
        <Skeleton rows={6} />
      ) : !list.data.announcements.length ? (
        <Empty icon={<Megaphone {...ICON} />} title="هنوز اطلاعیه‌ای نوشته نشده است" />
      ) : (
        <Card flush>
          <Table
            size="small"
            rowKey="id"
            dataSource={list.data.announcements}
            pagination={{ pageSize: 30, hideOnSinglePage: true }}
            scroll={{ x: true }}
            columns={[
              { title: "عنوان", dataIndex: "title" },
              { title: "اهمیت", dataIndex: "severity", width: 100, render: (v: Severity) => <Chip tone={SEVERITY[v][1]}>{SEVERITY[v][0]}</Chip> },
              { title: "گیرندگان", dataIndex: "audience", render: (v: Audience, a) => `${AUDIENCE[v]}${v === "orgs" ? ` (${fa(a.org_ids?.length ?? 0)})` : v === "plans" ? ` (${(a.plans ?? []).join("، ")})` : ""}` },
              { title: "بازه", render: (_: unknown, a: Announcement) => (a.starts_at || a.ends_at ? <span className="flex flex-col"><When v={a.starts_at} /><When v={a.ends_at} /></span> : <span className="text-ink-3">—</span>) },
              { title: "اعلام", dataIndex: "published_at", render: (v: string | null, a) => (v ? <span className="flex flex-col"><When v={v} /><span className="text-[12px] text-ink-3">{fa(a.delivered ?? 0)} سازمان</span></span> : <Chip tone="neutral">پیش‌نویس</Chip>) },
              {
                key: "act",
                width: 130,
                render: (_: unknown, a: Announcement) => (
                  <span className="flex gap-1">
                    {!a.published_at ? (
                      <>
                        <Popconfirm title="این اطلاعیه به سازمان‌ها فرستاده شود؟" okText="فرستادن" cancelText="انصراف" onConfirm={() => publish.mutateAsync(a.id)}>
                          <Button size="small" type="text" aria-label="فرستادن" icon={<Send {...ICON} />} />
                        </Popconfirm>
                        <Button size="small" type="text" aria-label="ویرایش" icon={<Pencil {...ICON} />} onClick={() => setEdit(a)} />
                      </>
                    ) : null}
                    <Popconfirm title="این اطلاعیه حذف شود؟" okText="حذف" cancelText="انصراف" onConfirm={() => remove.mutateAsync(a.id)}>
                      <Button size="small" type="text" aria-label="حذف" icon={<Trash2 {...ICON} />} />
                    </Popconfirm>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
      <Modal
        open={!!edit}
        title={edit === "new" ? "اطلاعیهٔ تازه" : "ویرایش اطلاعیه"}
        width={640}
        onCancel={() => setEdit(null)}
        destroyOnHidden
        footer={[
          <Button key="save" loading={save.isPending && !save.variables?.publish} onClick={() => submit(false)}>
            ذخیره
          </Button>,
          edit === "new" ? (
            <Button key="pub" type="primary" icon={<Send {...ICON} />} loading={save.isPending && !!save.variables?.publish} onClick={() => submit(true)}>
              ذخیره و فرستادن
            </Button>
          ) : null,
        ]}
      >
        <Form form={form} layout="vertical" requiredMark={false} initialValues={initial(edit)}>
          <Form.Item name="title" label="عنوان" rules={[{ required: true, min: 3, message: "عنوان اطلاعیه را وارد کنید" }]}>
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="body" label="متن">
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} maxLength={10000} />
          </Form.Item>
          <Form.Item name="severity" label="اهمیت">
            <Radio.Group options={(Object.keys(SEVERITY) as Severity[]).map((s) => ({ value: s, label: SEVERITY[s][0] }))} />
          </Form.Item>
          <Form.Item name="audience" label="گیرندگان">
            <Radio.Group options={(Object.keys(AUDIENCE) as Audience[]).map((s) => ({ value: s, label: AUDIENCE[s] }))} />
          </Form.Item>
          {audience === "orgs" ? (
            <Form.Item name="org_ids" label="سازمان‌ها" rules={[{ required: true, type: "array", min: 1, message: "دست‌کم یک سازمان" }]}>
              <Select mode="multiple" showSearch optionFilterProp="label" options={(orgs.data?.orgs ?? []).map((o) => ({ value: o.id, label: o.name }))} />
            </Form.Item>
          ) : audience === "plans" ? (
            <Form.Item name="plans" label="طرح‌ها" rules={[{ required: true, type: "array", min: 1, message: "دست‌کم یک طرح" }]}>
              <Select mode="multiple" options={(plans.data?.plans ?? []).map((p) => ({ value: p.key, label: p.name }))} />
            </Form.Item>
          ) : null}
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Form.Item name="starts_at" label="نمایش از">
              <DateTimeInput value={null} onChange={() => undefined} tz={DEFAULT_TIMEZONE} allowClear />
            </Form.Item>
            <Form.Item name="ends_at" label="نمایش تا" rules={[({ getFieldValue }) => ({ validator: (_, v) => (!v || !getFieldValue("starts_at") || v > getFieldValue("starts_at") ? Promise.resolve() : Promise.reject(new Error("پایان باید پس از آغاز باشد"))) })]}>
              <DateTimeInput value={null} onChange={() => undefined} tz={DEFAULT_TIMEZONE} allowClear />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
