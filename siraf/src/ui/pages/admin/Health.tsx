// «سلامت سامانه»: database, schema, encryption key, platform admins and database size, each with what to do
// when it is not right; the version and the runtime.
import { Button } from "antd";
import { CheckCircle2, CircleAlert, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Skeleton, StatCard } from "../../components/display";
import { Card } from "../../modules/reports/kit";
import { fa } from "../../lib/fa";
import { ICON, LoadFailed, When, bytes, useAdminQuery } from "./ui";

interface Health {
  ok: boolean;
  mode: "cloud" | "desktop";
  version: string;
  checked_at: string;
  db: { reachable: boolean; latency_ms: number | null; kind: string; bytes: number | null; limit: number | null };
  migrations: { applied: number; expected: number; missing: string[]; latest: string | null };
  secret: "env" | "derived" | "installation";
  checks: { key: string; title: string; tone: "ok" | "warning" | "danger" | "neutral"; value: string; detail?: string }[];
}

const TONE_ICON = { ok: CheckCircle2, warning: TriangleAlert, danger: CircleAlert, neutral: Info } as const;

export default function HealthPage() {
  const q = useAdminQuery<Health>(["health"], "/admin/health");
  const h = q.data;
  return (
    <div>
      <PageHeader
        title="سلامت سامانه"
        subtitle={h ? <When v={h.checked_at} /> : undefined}
        actions={
          <Button icon={<RefreshCw {...ICON} />} loading={q.isFetching} onClick={() => q.refetch()}>
            بررسی دوباره
          </Button>
        }
      />
      {!h ? (
        q.error ? <LoadFailed error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /> : <Skeleton rows={6} />
      ) : (
        <>
          <section className="ad-kpis" aria-label="خلاصه">
            <StatCard title="وضعیت" value={h.ok ? "رو به راه" : "نیازمند توجه"} hint={h.ok ? "همهٔ بررسی‌ها درست است" : `${fa(h.checks.filter((c) => c.tone === "warning" || c.tone === "danger").length)} مورد نیازمند توجه`} />
            <StatCard title="نسخه" value={<span className="sf-num sf-latin">{h.version}</span>} hint={h.mode === "cloud" ? "نسخهٔ وب" : "نسخهٔ ویندوز"} />
            <StatCard title="ساختار پایگاه داده" value={<span className="sf-num">{fa(h.migrations.applied)} از {fa(h.migrations.expected)}</span>} hint={h.migrations.latest ? <span className="sf-latin">{h.migrations.latest}</span> : undefined} />
            <StatCard title="حجم پایگاه داده" value={<span className="sf-num">{bytes(h.db.bytes)}</span>} hint={h.db.limit ? `از ${bytes(h.db.limit)}` : h.db.kind === "pglite" ? "پایگاه دادهٔ همین رایانه" : undefined} />
          </section>
          <Card title="بررسی‌ها" className="ad-section-gap" flush>
            {h.checks.map((c) => {
              const Icon = TONE_ICON[c.tone];
              return (
                <div key={c.key} className="ad-check">
                  <span className="ad-tone" data-tone={c.tone} aria-hidden>
                    <Icon {...ICON} />
                  </span>
                  <span className="ad-li-main">
                    <span className="block font-medium text-ink">{c.title}</span>
                    <span className="block text-[13px] text-ink-2">{c.value}</span>
                    {c.detail ? <span className="mt-1 block text-[13px] leading-5 text-ink-3">{c.detail}</span> : null}
                  </span>
                </div>
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}
