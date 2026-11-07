// «هوش مصنوعی» of the platform: the platform policy (kill switch, allowed services, default monthly cap per
// organisation) and every organisation's AI status and usage this month — never keys or conversations. The
// per-organisation switch is the organisation's platform state (PATCH /admin/orgs/:id ai_disabled).
import { useEffect, useState } from "react";
import { Button, Form, Input, Select, Switch, Table } from "antd";
import { Power } from "lucide-react";
import { AiIcon } from "../../components/shell/icons";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton, StatCard } from "../../components/display";
import { Card, Note } from "../../components/blocks";
import { api, ApiError } from "../../lib/api";
import { useIsPhone, useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { AI_PRESETS } from "@shared/ai/presets";
import type { AiAdminOrg, AiAdminOverview, AiPolicy } from "@shared/ai/api";
import { ICON, ago, usd, useAdminQuery } from "./ui";

const notReady = (e: unknown) => e instanceof ApiError && e.status === 404;

function PolicyCard({ policy }: { policy: AiPolicy }) {
  const [form] = Form.useForm();
  const n = useNotify();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    form.setFieldsValue({ allowed_presets: policy.allowed_presets ?? [], default_monthly_cap_usd: policy.default_monthly_cap_usd ?? "" });
  }, [policy, form]);
  const put = async (key: string, patch: Partial<AiPolicy>, done: string) => {
    setBusy(key);
    try {
      await api.put("/admin/ai/policy", patch);
      n.ok(done);
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="سیاست سامانه">
      <div className="flex items-start gap-3">
        <Switch
          checked={!policy.kill_switch}
          loading={busy === "kill"}
          aria-label="هوش مصنوعی در کل سامانه"
          onChange={async (on) => {
            if (!on && !(await n.confirm("خاموش کردن هوش مصنوعی در همهٔ سازمان‌ها؟", "دستیار و همهٔ قابلیت‌های هوش مصنوعی تا روشن کردن دوباره کار نمی‌کنند.", true, "خاموش کن"))) return;
            await put("kill", { kill_switch: !on }, on ? "هوش مصنوعی در سامانه روشن شد." : "هوش مصنوعی در سامانه خاموش شد.");
          }}
        />
        <span>
          <span className="block font-medium">هوش مصنوعی در کل سامانه</span>
          <span className="ad-sub">کلید توقف اضطراری: با خاموش کردن، هیچ سازمانی درخواستی به مدل‌ها نمی‌فرستد.</span>
        </span>
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        className="mt-5 border-t border-line pt-4"
        onFinish={(v: { allowed_presets: string[]; default_monthly_cap_usd: string }) =>
          put(
            "policy",
            { allowed_presets: v.allowed_presets.length ? v.allowed_presets : null, default_monthly_cap_usd: v.default_monthly_cap_usd?.trim() ? v.default_monthly_cap_usd.trim() : null },
            "سیاست ذخیره شد.",
          )
        }
      >
        <Form.Item name="allowed_presets" label="سرویس‌های مجاز" extra="خالی یعنی همهٔ سرویس‌ها.">
          <Select mode="multiple" allowClear placeholder="همهٔ سرویس‌ها" options={AI_PRESETS.filter((p) => !p.test_only).map((p) => ({ value: p.id, label: p.label }))} optionFilterProp="label" />
        </Form.Item>
        <Form.Item
          name="default_monthly_cap_usd"
          label="سقف ماهانهٔ هر سازمان (دلار)"
          extra="بودجهٔ هر سازمان فقط می‌تواند کمتر از این باشد؛ خالی یعنی بدون سقف."
          rules={[{ pattern: /^\d+(\.\d{1,2})?$/, message: "عدد درست بنویسید، مثلاً 20 یا 12.5" }]}
        >
          <Input dir="ltr" className="ds-latin" inputMode="decimal" placeholder="20" style={{ maxInlineSize: 160 }} />
        </Form.Item>
        <Button htmlType="submit" loading={busy === "policy"}>
          ذخیرهٔ سیاست
        </Button>
      </Form>
    </Card>
  );
}

export default function Ai() {
  const phone = useIsPhone();
  const n = useNotify();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["admin", "ai", "overview"], queryFn: () => api.get<AiAdminOverview>("/admin/ai/overview"), retry: (c, e) => !notReady(e) && c < 2 });
  const policy = useQuery({ queryKey: ["admin", "ai", "policy"], queryFn: () => api.get<{ policy: AiPolicy }>("/admin/ai/policy"), retry: (c, e) => !notReady(e) && c < 2 });
  // the platform's own per-organisation switch (sm_org_admin.ai_disabled)
  const orgs = useAdminQuery<{ orgs: { id: string; ai_disabled: boolean }[] }>(["orgs", "", "", "", ""], "/admin/orgs");
  const off = new Set((orgs.data?.orgs ?? []).filter((o) => o.ai_disabled).map((o) => o.id));

  if (overview.isLoading || policy.isLoading)
    return (
      <div>
        <PageHeader title="هوش مصنوعی" />
        <Skeleton rows={6} />
      </div>
    );
  if (notReady(overview.error) || notReady(policy.error) || !overview.data)
    return (
      <div>
        <PageHeader title="هوش مصنوعی" />
        <EmptyState icon={AiIcon} title="گزارش هوش مصنوعی پس از به‌روزرسانی سرور در دسترس است" action={<Button onClick={() => (overview.refetch(), policy.refetch())}>دوباره</Button>} />
      </div>
    );

  const o = overview.data;
  const pol = policy.data?.policy ?? o.policy;
  const toggle = async (b: AiAdminOrg, on: boolean) => {
    try {
      await api.patch(`/admin/orgs/${b.org_id}`, { ai_disabled: !on });
      n.ok(on ? `هوش مصنوعی «${b.name}» روشن شد.` : `هوش مصنوعی «${b.name}» خاموش شد.`);
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      n.error(e);
    }
  };
  const rows = [...o.orgs].sort((a, b) => Number(b.month.cost_usd) - Number(a.month.cost_usd) || b.connections - a.connections);
  return (
    <div>
      <PageHeader title="هوش مصنوعی" />
      {pol.kill_switch ? (
        <Note tone="danger" className="mb-4">
          <b>هوش مصنوعی در کل سامانه خاموش است.</b> هیچ سازمانی به مدل‌ها درخواست نمی‌فرستد.
        </Note>
      ) : null}
      <section className="ad-kpis" aria-label="آمار هوش مصنوعی">
        <StatCard icon={<AiIcon {...ICON} />} title="سازمان‌های فعال" value={<span className="ds-num">{fa(o.totals.orgs_enabled)}</span>} hint={`از ${fa(o.orgs.length)} سازمان`} />
        <StatCard icon={<Power {...ICON} />} title="اتصال‌ها" value={<span className="ds-num">{fa(o.totals.connections)}</span>} />
        <StatCard icon={<AiIcon {...ICON} />} title="درخواست‌های این ماه" value={<span className="ds-num">{fa(o.totals.month_calls)}</span>} />
        <StatCard icon={<AiIcon {...ICON} />} title="هزینهٔ این ماه" value={<span className="ds-num ds-latin">{usd(o.totals.month_cost_usd)}</span>} />
      </section>
      <div className="ad-grid">
        <Card title="سازمان‌ها" flush>
          <Table<AiAdminOrg>
            className="blk-tbl"
            size="middle"
            rowKey="org_id"
            dataSource={rows}
            pagination={{ pageSize: 30, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
            scroll={phone ? undefined : { x: 720 }}
            locale={{ emptyText: <EmptyState icon={AiIcon} title="هنوز سازمانی ساخته نشده است" /> }}
            columns={[
              {
                key: "n",
                title: "سازمان",
                render: (_, b) => (
                  <span className="block min-w-0">
                    <Link to={`/admin/orgs/${b.org_id}`} className="ds-link block truncate">
                      {b.name}
                    </Link>
                    <span className="ad-sub">{b.connections ? <span className="ds-latin">{b.presets.join("، ")}</span> : "بدون کلید"}</span>
                  </span>
                ),
              },
              ...(phone
                ? []
                : [
                    {
                      key: "s",
                      title: "وضعیت",
                      width: 120,
                      render: (_: unknown, b: AiAdminOrg) =>
                        !b.connections ? <span className="text-ink-3">—</span> : b.status === "error" ? <Chip tone="danger">خطا</Chip> : b.enabled ? <Chip tone="in">روشن</Chip> : <Chip tone="neutral">خاموش</Chip>,
                    },
                    { key: "c", title: "این ماه", width: 110, render: (_: unknown, b: AiAdminOrg) => <span className="ds-num ds-latin">{usd(b.month.cost_usd)}</span> },
                    { key: "u", title: "آخرین استفاده", width: 120, render: (_: unknown, b: AiAdminOrg) => <span className="text-ink-2">{ago(b.last_used_at)}</span> },
                  ]),
              {
                key: "on",
                title: "مجاز",
                width: 72,
                render: (_, b) => <Switch size="small" checked={!(off.has(b.org_id) || b.disabled_by_platform)} onChange={(on) => toggle(b, on)} aria-label={`هوش مصنوعی ${b.name}`} />,
              },
            ]}
          />
        </Card>
        <PolicyCard policy={pol} />
      </div>
    </div>
  );
}
