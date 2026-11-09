// «بینش‌ها» (catalogue AI-113, ANA-025/029): yesterday's and last week's cards the member may see (a card is shown only
// to someone who reads every record it was computed from), anomalies first, and for AI administrators computing a
// period or sending its digests now and the settings of insights.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented, Select, Switch } from "antd";
import { Play, Send } from "lucide-react";
import type { InsightPeriod } from "@shared/ai/insights";
import type { AiSettingsView } from "@shared/ai/api";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Skeleton } from "../../components/display";
import { Card, Field, ICON14, Note } from "../../components/blocks";
import { insightsApi, ML_KEYS } from "../ml/api";
import { InsightCard } from "./InsightCard";
import { orderInsights } from "./model";
import "./insights.css";

const ROLE_OPTIONS = [
  { value: "tenant_admin", label: "مدیر سامانه" },
  { value: "service_desk_manager", label: "مدیر میز خدمت" },
  { value: "team_lead", label: "سرپرست گروه" },
  { value: "agent", label: "کارشناس پشتیبانی" },
  { value: "auditor", label: "ممیز" },
  { value: "change_manager", label: "مدیر تغییر" },
  { value: "problem_manager", label: "مدیر مشکل" },
];

function Settings() {
  const { api } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai-settings-insights"], queryFn: () => api.get<AiSettingsView>("/ai/settings") });
  const s = q.data?.settings.insights;
  if (!s) return null;
  const save = async (patch: Partial<typeof s>) => {
    try {
      await api.put("/ai/settings", { insights: patch });
      await qc.invalidateQueries({ queryKey: ["ai-settings-insights"] });
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <Card title="تنظیمات بینش‌ها">
      <div className="in-settings">
        <Field label="محاسبهٔ روزانه و هفتگی">
          <Switch checked={s.enabled} onChange={(v) => void save({ enabled: v })} />
        </Field>
        <Field label="ساعت محاسبه">
          <Select size="small" value={s.hour} onChange={(v) => void save({ hour: v })} options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: faDigits(h) }))} style={{ minInlineSize: 80 }} />
        </Field>
        <Field label="خلاصهٔ اعلانی">
          <Segmented
            size="small"
            value={s.digest}
            onChange={(v) => void save({ digest: v as typeof s.digest })}
            options={[
              { value: "off", label: "خاموش" },
              { value: "daily", label: "روزانه" },
              { value: "weekly", label: "هفتگی" },
            ]}
          />
        </Field>
        <Field label="گیرندگان (نقش‌ها)">
          <Select size="small" mode="multiple" value={s.roles} onChange={(v) => void save({ roles: v })} options={ROLE_OPTIONS} style={{ minInlineSize: 260 }} />
        </Field>
        <Field label="اعلان فوری ناهنجاری بحرانی">
          <Switch checked={s.notify_anomalies} onChange={(v) => void save({ notify_anomalies: v })} />
        </Field>
      </div>
    </Card>
  );
}

export default function InsightsPage() {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<InsightPeriod>("daily");
  const q = useQuery({ queryKey: ML_KEYS.insights(orgId, period), queryFn: () => insightsApi.list(api, period) });
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (what: "run" | "digest") => {
    setBusy(what);
    try {
      if (what === "run") {
        const r = await insightsApi.run(api, period);
        n.ok(`${faDigits(r.insights)} بینش حساب شد`);
        await qc.invalidateQueries({ queryKey: ML_KEYS.insights(orgId, period) });
      } else {
        const r = await insightsApi.digest(api, period);
        n.ok(`${faDigits(r.sent)} خلاصه فرستاده شد`);
      }
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const list = orderInsights(q.data?.insights ?? []);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="بینش‌ها"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="small"
              value={period}
              onChange={(v) => setPeriod(v as InsightPeriod)}
              options={[
                { value: "daily", label: "روزانه" },
                { value: "weekly", label: "هفتگی" },
              ]}
            />
            {q.data?.can_run ? (
              <>
                <Button size="small" icon={<Play {...ICON14} />} loading={busy === "run"} onClick={() => void act("run")}>
                  محاسبه اکنون
                </Button>
                <Button size="small" icon={<Send {...ICON14} />} loading={busy === "digest"} onClick={() => void act("digest")}>
                  فرستادن خلاصه
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      {q.isLoading ? <Skeleton rows={6} /> : null}
      {q.data && !q.data.enabled ? <Note tone="warning">محاسبهٔ بینش‌ها خاموش است.</Note> : null}
      {q.data && !list.length ? <EmptyState title="بینشی برای نمایش نیست" description={q.data.hidden ? `${faDigits(q.data.hidden)} بینش این دوره از داده‌هایی ساخته شده که همه‌اش را نمی‌بینید.` : undefined} /> : null}
      {list.length ? (
        <div className="in-grid ds-stagger">
          {list.map((v) => (
            <InsightCard key={v.id} v={v} />
          ))}
        </div>
      ) : null}
      {q.data && list.length && q.data.hidden ? <p className="in-label">{faDigits(q.data.hidden)} بینش دیگر از داده‌هایی ساخته شده که همه‌اش را نمی‌بینید.</p> : null}
      {q.data?.can_run ? <Settings /> : null}
    </div>
  );
}
