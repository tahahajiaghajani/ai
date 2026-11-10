// «نقشهٔ قابلیت‌ها» (catalogue SPF-029): the business capability tree as cards, coloured by coverage (full, partial,
// none), each with the services and business applications that cover it — gaps and overlaps at a glance. Capabilities
// are edited as records (parent, coverage, services, applications).
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented } from "antd";
import { Plus } from "lucide-react";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { recordsApi } from "../../records/data/api";
import "./spf.css";

const COVERAGE: Record<string, { label: string; color: string }> = {
  full: { label: "پوشش کامل", color: "var(--ds-in)" },
  partial: { label: "پوشش ناقص", color: "var(--ds-warning-fill)" },
  none: { label: "بدون پوشش", color: "var(--ds-danger)" },
};

interface Cap {
  id: string;
  name: string;
  parent_id: string | null;
  coverage: string | null;
  services: string[];
  applications: string[];
}

export default function Capabilities() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [filter, setFilter] = useState<string>("all");
  const q = useQuery({
    queryKey: ["service_portfolio", orgId, "capabilities"],
    queryFn: () => recordsApi.list(api, "business_capability", { size: 500, fields: ["name", "parent_id", "coverage", "services", "applications", "sort_order", "level"], sort: "sort_order,name", total: false }),
    staleTime: 60_000,
  });
  const display = q.data?.display ?? {};
  const caps = useMemo<Cap[]>(() => (q.data?.rows ?? []).map((r) => ({ id: String(r.id), name: String(r.name ?? ""), parent_id: (r.parent_id as string) ?? null, coverage: (r.coverage as string) ?? null, services: (r.services as string[]) ?? [], applications: (r.applications as string[]) ?? [] })), [q.data]);
  const roots = caps.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => caps.filter((c) => c.parent_id === id);
  const shown = (c: Cap) => filter === "all" || (c.coverage ?? "none") === filter || childrenOf(c.id).some(shown);
  return (
    <div>
      <PageHeader
        title="نقشهٔ قابلیت‌ها"
        actions={<Button icon={<Plus size={16} strokeWidth={1.4} absoluteStrokeWidth />} onClick={() => nav(`/${orgId}/portfolio/capabilities/new`)}>قابلیت تازه</Button>}
      />
      {q.isLoading ? (
        <Loader />
      ) : !caps.length ? (
        <EmptyState title="قابلیتی تعریف نشده" description="قابلیت‌های کسب‌وکار را در سه سطح تعریف کنید و خدمت‌ها و سامانه‌هایی را که پوشش می‌دهند به آن‌ها پیوند دهید." />
      ) : (
        <div className="flex flex-col gap-4">
          <Segmented value={filter} onChange={(v) => setFilter(String(v))} options={[{ value: "all", label: "همه" }, ...Object.entries(COVERAGE).map(([value, c]) => ({ value, label: c.label }))]} />
          {roots.filter(shown).map((root) => (
            <section key={root.id} className="flex flex-col gap-2">
              <h2 className="ds-t-section">
                <Link className="ds-link" to={`/${orgId}/portfolio/capabilities/${root.id}`}>{root.name}</Link>
              </h2>
              <div className="spf-cap">
                {[root, ...childrenOf(root.id)].filter((c) => filter === "all" || (c.coverage ?? "none") === filter).map((c) => (
                  <div key={c.id} className="spf-cap-card" style={{ ["--spf-c" as string]: COVERAGE[c.coverage ?? "none"]?.color ?? "var(--ds-line-3)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <Link className="ds-link font-medium" to={`/${orgId}/portfolio/capabilities/${c.id}`}>{c.name}</Link>
                      <span className="text-[12px] text-ink-3">{COVERAGE[c.coverage ?? ""]?.label ?? "نامشخص"}</span>
                    </div>
                    {c.services.length || c.applications.length ? (
                      <ul>
                        {c.services.map((s) => <li key={s}>{display[s] ?? "خدمت"}</li>)}
                        {c.applications.map((a) => <li key={a}>{display[a] ?? "سامانه"}</li>)}
                      </ul>
                    ) : (
                      <span className="text-[12px] text-ink-3">خدمت یا سامانه‌ای پیوند نشده</span>
                    )}
                    {childrenOf(c.id).length && c !== root ? <span className="text-[12px] text-ink-3">{fa(childrenOf(c.id).length)} زیرقابلیت</span> : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
