// Request analytics (REQ-054, KPIs of docs/catalog/g4_requests.md «Module: request»): volumes by item, stage and
// channel; fulfilment time as percentiles (p50/p85/p95 — never only the mean) overall and per item; delivery within
// the promised date; approval cycle time and rejection rate; first-time-right and the share of time spent waiting for
// the requester; zero-touch and self-service rates; catalogue completeness (ad-hoc share); backlog by age; CSAT.
// Every number is computed from the records the caller may read (their access decides), in code — never by a model.
import { percentile } from "@shared/request/due";
import { ITEM_OPEN } from "@shared/request/logic";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { forbidden } from "../../http/errors";
import { access } from "../../access/provider";
import { liveRows, secondsBetween, type Row } from "./common";
import { displayOf } from "./fulfil";

export interface RequestDashboard {
  days: number;
  totals: { ordered: number; open: number; closed: number; overdue: number };
  by_state: { key: string; count: number }[];
  by_stage: { key: string; count: number }[];
  by_channel: { key: string; count: number }[];
  top_items: { id: string; name: string; count: number; p85: number | null }[];
  fulfilment: { p50: number | null; p85: number | null; p95: number | null; samples: number };
  within_promise: number | null;
  approval: { avg_hours: number | null; rejection_rate: number | null };
  first_time_right: number | null;
  waiting_share: number | null;
  zero_touch: number | null;
  self_service: number | null;
  ad_hoc: number | null;
  csat: { avg: number | null; count: number };
  backlog: { key: string; label: string; count: number }[];
  display: Record<string, string>;
}

const DAY = 86_400_000;
const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const SELF = new Set(["portal", "assistant", "chat", "email"]);

const count = (rows: Row[], key: (r: Row) => string): { key: string; count: number }[] => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].map(([k, c]) => ({ key: k, count: c })).sort((a, b) => b.count - a.count);
};

/** The request dashboard over the last `days` days, through the caller's access. */
export async function requestDashboard(ctx: Ctx, opts: { days?: number } = {}): Promise<RequestDashboard> {
  const def = tableDef("request_item")!;
  if (!access().canReadTable(ctx, def)) throw forbidden("به درخواست‌های خدمت دسترسی ندارید");
  const days = Math.max(1, Math.min(365, Math.floor(Number(opts.days) || 30)));
  const now = Date.now();
  const since = new Date(now - days * DAY).toISOString();
  const q = ctx.db;
  const recent = await liveRows(q, ctx, "request_item", { f: "opened_at", op: "gte", v: since }, { limit: 10_000 });
  const open = await liveRows(q, ctx, "request_item", { f: "state", op: "in", v: [...ITEM_OPEN] }, { limit: 10_000 });
  const closed = await liveRows(q, ctx, "request_item", { and: [{ f: "closed_at", op: "gte", v: since }, { f: "state", op: "in", v: ["closed_complete", "closed_incomplete", "rejected", "cancelled"] }] }, { limit: 10_000 });
  const completed = closed.filter((r) => r.state === "closed_complete");
  const durations = completed.map((r) => secondsBetween(r.opened_at, r.closed_at)).filter((x): x is number => x !== null);
  const promised = completed.filter((r) => r.due_at);
  const kept = promised.filter((r) => Date.parse(String(r.resolved_at ?? r.closed_at)) <= Date.parse(String(r.due_at)));
  const approved = recent.filter((r) => r.approval_requested_at && r.approved_at);
  const approvalHours = approved.map((r) => (secondsBetween(r.approval_requested_at, r.approved_at) ?? 0) / 3600);
  const asked = recent.filter((r) => r.approval_requested_at);
  const rejected = asked.filter((r) => r.state === "rejected");
  const waits = completed.reduce((s, r) => s + Number(r.info_wait ?? 0), 0);
  const spans = completed.reduce((s, r) => s + (secondsBetween(r.opened_at, r.closed_at) ?? 0), 0);
  const rated = closed.filter((r) => Number(r.rating) > 0);
  const byItem = new Map<string, number[]>();
  for (const r of completed) {
    const d = secondsBetween(r.opened_at, r.closed_at);
    if (d !== null) byItem.set(String(r.cat_item_id), [...(byItem.get(String(r.cat_item_id)) ?? []), d]);
  }
  const top = count(recent, (r) => String(r.cat_item_id)).slice(0, 10);
  const ages: [string, string, number][] = [["d1", "کمتر از یک روز", 1], ["d3", "۱ تا ۳ روز", 3], ["d7", "۳ تا ۷ روز", 7], ["d30", "۷ تا ۳۰ روز", 30], ["older", "بیش از ۳۰ روز", Infinity]];
  const backlog = ages.map(([key, label]) => ({ key, label, count: 0 }));
  for (const r of open) {
    const age = (now - Date.parse(String(r.opened_at ?? r.created_at))) / DAY;
    const i = ages.findIndex(([, , max]) => age < max);
    backlog[i < 0 ? ages.length - 1 : i].count++;
  }
  return {
    days,
    totals: { ordered: recent.length, open: open.length, closed: closed.length, overdue: open.filter((r) => r.due_at && Date.parse(String(r.due_at)) < now).length },
    by_state: count(open, (r) => String(r.state)),
    by_stage: count(open, (r) => String(r.stage ?? "")),
    by_channel: count(recent, (r) => String(r.channel ?? "")),
    top_items: top.map((t) => ({ id: t.key, name: "", count: t.count, p85: percentile(byItem.get(t.key) ?? [], 85) })),
    fulfilment: { p50: percentile(durations, 50), p85: percentile(durations, 85), p95: percentile(durations, 95), samples: durations.length },
    within_promise: ratio(kept.length, promised.length),
    approval: { avg_hours: approvalHours.length ? Math.round((approvalHours.reduce((a, b) => a + b, 0) / approvalHours.length) * 10) / 10 : null, rejection_rate: ratio(rejected.length, asked.length) },
    first_time_right: ratio(completed.filter((r) => !r.info_requested).length, completed.length),
    waiting_share: ratio(waits, spans),
    zero_touch: ratio(completed.filter((r) => r.zero_touch).length, completed.length),
    self_service: ratio(recent.filter((r) => SELF.has(String(r.channel ?? ""))).length, recent.length),
    ad_hoc: ratio(recent.filter((r) => r.ad_hoc).length, recent.length),
    csat: { avg: rated.length ? Math.round((rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length) * 10) / 10 : null, count: rated.length },
    backlog,
    display: await displayOf(q, ctx, top.map((t) => ["catalog_item", t.key] as [string, unknown])),
  };
}
