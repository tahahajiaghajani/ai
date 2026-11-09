// Settings → «هوش مصنوعی» (ai:full): the organisation's own AI engine. Seven tabs (with «مهارت‌ها», ../skills/Admin.tsx) — «اتصال‌ها» (keys and providers, with a
// per-model connection test), «کارها و مدل‌ها» (which model does which job, in what order, with what effort),
// «نمایه و بازیابی» (the embedding model, the index per table and collection, rebuilds, a retrieval test box),
// «قابلیت‌ها و حریم خصوصی», «مصرف و بودجه» and «فعالیت دستیار». Members without ai:full see a short no-access state.
import "../kit/ai.css";
import "./settings.css";
import { Button, Tabs } from "antd";
import { useSearchParams } from "react-router";
import { Plus, ShieldOff } from "lucide-react";
import type { AiSettings as Settings } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EmptyState, Skeleton } from "../../components/display";
import { fa } from "../../lib/fa";
import { Note } from "../../components/blocks";
import { connectionTone } from "../kit/model";
import { useAiConnections, useAiPresets, useAiSettings, useAiStatus } from "../kit/hooks";
import { ConnectionsTab } from "./Connections";
import { RoutingTab } from "./Routing";
import { FeaturesTab } from "./Features";
import { UsageTab } from "./Usage";
import { ActivityTab } from "./Activity";
import { RetrievalTab } from "./Retrieval";
import { SkillsTab } from "../skills/Admin";
import { AgentsTab } from "../agents/Studio";
import { lazy, Suspense } from "react";

const Governance = lazy(() => import("../governance/Governance"));

const TABS = [
  { key: "connections", label: "اتصال‌ها" },
  { key: "jobs", label: "کارها و مدل‌ها" },
  { key: "retrieval", label: "نمایه و بازیابی" },
  { key: "skills", label: "مهارت‌ها" },
  { key: "agents", label: "عامل‌ها" },
  { key: "features", label: "قابلیت‌ها و حریم خصوصی" },
  { key: "usage", label: "مصرف و بودجه" },
  { key: "activity", label: "فعالیت دستیار" },
  { key: "governance", label: "حاکمیت" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Settings as stored, with every field the screens need (an older or partial row reads as the defaults). */
export function withDefaults(s: Partial<Settings> | null | undefined): Settings {
  return {
    enabled: s?.enabled ?? true,
    routing: { assistant: [], analysis: [], fast: [], vision: [], ...(s?.routing ?? {}) },
    effort: { assistant: "medium", analysis: "high", fast: "low", vision: "low", ...(s?.effort ?? {}) },
    features: { assistant: true, proposals: true, files: true, agents: true, virtual_agent: true, ...(s?.features ?? {}) },
    data_policy: s?.data_policy ?? "masked",
    budgets: { monthly_usd: null, user_daily_usd: null, alert_pct: 80, ...(s?.budgets ?? {}) },
    instructions: s?.instructions ?? "",
    retention_days: s?.retention_days ?? 90,
    use_cloud: s?.use_cloud ?? false,
    cloud_first: s?.cloud_first ?? [],
    rag: { enabled: true, embed_connection_id: null, rerank: false, summaries: true, top_k: 8, ...(s?.rag ?? {}) },
    insights: { enabled: true, hour: 6, digest: "weekly", roles: ["service_desk_manager", "team_lead", "tenant_admin"], notify_anomalies: true, ...(s?.insights ?? {}) },
  };
}

export default function AiSettings() {
  const { can } = useOrg();
  const manage = can("ai", "full");
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.some((t) => t.key === sp.get("tab")) ? sp.get("tab") : "connections") as TabKey;
  const adding = sp.get("add") === "1";
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  const status = useAiStatus(manage);
  const presets = useAiPresets();
  const conns = useAiConnections(manage);
  const settings = useAiSettings(manage);

  if (!manage)
    return (
      <div>
        <PageHeader title="هوش مصنوعی" />
        <div className="blk-card">
          <EmptyState icon={ShieldOff} title="دسترسی به تنظیمات هوش مصنوعی ندارید." description="کلیدها و تنظیمات را مالک یا حسابدار سازمان مدیریت می‌کند." />
        </div>
      </div>
    );

  const list = conns.data ?? [];
  const healthy = list.filter((c) => connectionTone(c) === "ok").length;
  const st = status.data;
  const subtitle = !st
    ? null
    : !st.enabled
      ? "خاموش"
      : !list.length && !st.configured
        ? "راه‌اندازی نشده"
        : `${st.enabled ? "دستیار فعال است" : "خاموش"}${list.length ? `، ${fa(healthy)} از ${fa(list.length)} اتصال سالم` : ""}`;
  const s = settings.data ? withDefaults(settings.data.settings) : null;
  const view = settings.data;

  return (
    <div className="ai-page">
      <PageHeader
        title="هوش مصنوعی"
        subtitle={subtitle}
        actions={
          tab === "connections" && list.length ? (
            <Button type="primary" icon={<Plus size={16} strokeWidth={1.4} absoluteStrokeWidth />} onClick={() => setParam({ add: "1" })}>
              افزودن اتصال
            </Button>
          ) : null
        }
      />
      {view?.policy.disabled ? (
        <Note tone="warning" className="mb-4">
          <b>مدیر سامانه هوش مصنوعی را برای این سازمان خاموش کرده است.</b> تنظیمات می‌ماند و با روشن شدن دوباره به کار می‌افتد.
        </Note>
      ) : null}
      <Tabs className="ai-tabs" activeKey={tab} onChange={(k) => setParam({ tab: k === "connections" ? null : k, add: null })} items={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      {tab === "connections" ? (
        <ConnectionsTab
          connections={conns.data}
          loading={conns.isLoading}
          error={conns.error}
          presets={presets.data ?? []}
          secretOk={!st?.app_secret_missing}
          adding={adding}
          onAdding={(v) => setParam({ add: v ? "1" : null })}
        />
      ) : tab === "skills" ? (
        <SkillsTab />
      ) : tab === "agents" ? (
        <AgentsTab />
      ) : tab === "governance" ? (
        <Suspense fallback={<Skeleton rows={8} />}>
          <Governance />
        </Suspense>
      ) : !s ? (
        settings.error ? (
          <div className="blk-card">
            <EmptyState title="تنظیمات بارگذاری نشد." description={(settings.error as Error).message} action={<Button onClick={() => settings.refetch()}>تلاش دوباره</Button>} />
          </div>
        ) : (
          <div className="blk-card">
            <div className="blk-card-b">
              <Skeleton rows={8} />
            </div>
          </div>
        )
      ) : tab === "jobs" ? (
        <RoutingTab settings={s} connections={list} mode={view?.mode} linked={view?.linked} />
      ) : tab === "retrieval" ? (
        <RetrievalTab settings={s} connections={list} />
      ) : tab === "features" ? (
        <FeaturesTab settings={s} mode={view?.mode} linked={view?.linked} />
      ) : tab === "usage" ? (
        <UsageTab settings={s} />
      ) : (
        <ActivityTab />
      )}
    </div>
  );
}
