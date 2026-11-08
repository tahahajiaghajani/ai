// Pure logic of the service portfolio screens (tests/service_portfolio-ui.test.ts): status tones and colours, the
// status page's headline, the day bars' tooltip text, scatter positions of the rationalization quadrant, and the
// grouping of the status page by portfolio node.
import type { ServiceStatus, DayBar } from "@shared/service_portfolio/logic";
import { STATUS_RANK, statusLabel } from "@shared/service_portfolio/logic";
import type { RationalizationRow, StatusPageService } from "@shared/service_portfolio/api";
import { formatJalali } from "@shared/jalali";
import { faDigits } from "@shared/format";

/** The design-system colour of a status (bars, dots). */
export function statusColor(s: string | null | undefined): string {
  switch (s) {
    case "major_outage":
      return "var(--ds-danger)";
    case "partial_outage":
      return "var(--ds-warning)";
    case "degraded":
      return "var(--ds-chart-2)";
    case "maintenance":
      return "var(--ds-chart-8)";
    default:
      return "var(--ds-in)";
  }
}

/** The chip tone of a status: calm when operational, the exception otherwise. */
export function statusTone(s: string | null | undefined): "in" | "warning" | "danger" | "neutral" {
  if (s === "major_outage") return "danger";
  if (s === "partial_outage" || s === "degraded") return "warning";
  if (s === "maintenance") return "neutral";
  return "in";
}

/** The page's headline from its overall status and how many services are affected. */
export function headline(overall: ServiceStatus, services: Pick<StatusPageService, "status">[]): string {
  const affected = services.filter((s) => s.status !== "operational").length;
  if (overall === "operational") return "همهٔ خدمت‌ها عادی کار می‌کنند";
  if (overall === "maintenance") return `${faDigits(affected)} خدمت در حال نگهداری برنامه‌ریزی‌شده است`;
  if (overall === "major_outage") return `قطعی کامل در ${faDigits(affected)} خدمت`;
  return `${faDigits(affected)} خدمت با اختلال روبه‌روست`;
}

/** «۱۴۰۵/۰۸/۱۷ — قطعی بخشی — دسترس‌پذیری ۹۸٫۵٪» for a day bar. */
export function barTitle(b: DayBar): string {
  const pct = `${faDigits(b.availability.toFixed(b.availability % 1 ? 2 : 0).replace(".", "٫"))}٪`;
  return `${formatJalali(b.day)} — ${statusLabel(b.status)} — دسترس‌پذیری ${pct}`;
}

/** Services grouped by their portfolio node (the page's sections), worst first within each. */
export function groupServices(services: StatusPageService[]): { group: string; services: StatusPageService[] }[] {
  const m = new Map<string, StatusPageService[]>();
  for (const s of services) {
    const g = s.group ?? "سایر خدمت‌ها";
    m.set(g, [...(m.get(g) ?? []), s]);
  }
  return [...m]
    .map(([group, xs]) => ({ group, services: xs.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.name.localeCompare(b.name, "fa")) }))
    .sort((a, b) => Math.max(...b.services.map((s) => STATUS_RANK[s.status])) - Math.max(...a.services.map((s) => STATUS_RANK[s.status])) || a.group.localeCompare(b.group, "fa"));
}

/** Scatter positions (0–1) of rationalization rows: x = value, y = cost or support load (normalised to the max). */
export function scatter(rows: RationalizationRow[], axis: "cost" | "load"): { id: string; x: number; y: number }[] {
  const ys = rows.map((r) => (axis === "cost" ? Number(r.annual_cost ?? 0) || 0 : r.incidents_90d));
  const maxY = Math.max(1, ...ys);
  return rows.map((r, i) => ({ id: r.id, x: Math.max(0, Math.min(1, r.value / 100)), y: Math.max(0, Math.min(1, ys[i] / maxY)) }));
}
