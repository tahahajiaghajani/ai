// Technology portfolio and lifecycle risk (catalogue SPF-028): technology standards say which products and versions
// are approved, retiring, prohibited or an exception, with their end of support. The nightly pass matches live CIs to
// the standards that carry risk (prohibited, retiring, or past / within 90 days of end of support) and opens a
// «فناوری خارج از استاندارد» finding for each CI's owner (once per CI and standard; closed when the CI no longer
// matches). `technologyRisk` rolls the matches up to the services that depend on those CIs, for the portfolio.
import { addDays, todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { servicesImpactedBy } from "../cmdb/impact";
import { isUuid, liveRows, sysOf, type Row } from "./common";

const LIVE_CI = { f: "state", op: "nin" as const, v: ["retired", "disposed", "canceled"] };

/** The condition a standard matches CIs with (its product name on the chosen field, its version as a prefix). */
export function standardCondition(std: Row): Row | null {
  const name = String(std.name ?? "").trim();
  if (name.length < 2) return null;
  const version = String(std.product_version ?? "").trim();
  const field = ["os", "sw_version", "name", "model_name"].includes(std.match_field) ? std.match_field : "os";
  const parts: Row[] = [];
  if (field === "os") {
    parts.push({ f: "os", op: "contains", v: name });
    if (version) parts.push({ f: "os_version", op: "starts", v: version });
  } else if (field === "sw_version") {
    parts.push({ f: "name", op: "contains", v: name });
    if (version) parts.push({ f: "sw_version", op: "starts", v: version });
  } else {
    parts.push({ f: field, op: "contains", v: name });
    if (version) parts.push({ f: "sw_version", op: "starts", v: version });
  }
  return { and: parts };
}

/** Why a standard is a risk today (null: it is not). */
export function standardRisk(std: Row, today: string): string | null {
  if (std.status === "prohibited") return "ممنوع";
  if (std.status === "exception") return null;
  if (std.valid_to && String(std.valid_to) < today) return "اعتبار استاندارد گذشته";
  if (std.eol_date && String(std.eol_date) < today) return "پشتیبانی سازنده تمام شده";
  if (std.eol_date && String(std.eol_date) <= addDays(today, 90)) return "پایان پشتیبانی در کمتر از ۹۰ روز";
  if (std.status === "retiring") return "رو به کنارگذاری";
  return null;
}

/** Open and close «فناوری خارج از استاندارد» findings (system, inside `tx`). */
export async function technologyFindings(tx: Tx, ctx: Ctx): Promise<{ opened: number; closed: number }> {
  const sys = sysOf(ctx);
  const today = todayISO(String(ctx.org.settings?.timezone ?? "Asia/Tehran"));
  const standards = await liveRows(tx, sys, "technology_standard", null, { limit: 500 });
  const wanted = new Map<string, { ci: Row; std: Row; why: string }>();
  for (const std of standards) {
    const why = standardRisk(std, today);
    const cond = standardCondition(std);
    if (!why || !cond) continue;
    for (const ci of await liveRows(tx, sys, "ci", { and: [LIVE_CI, cond] } as never, { limit: 2000 })) wanted.set(`tech:${std.id}:${ci.id}`, { ci, std, why });
  }
  const open = await liveRows(tx, sys, "cmdb_finding", { and: [{ f: "kind", op: "eq", v: "technology" }, { f: "active", op: "eq", v: true }] }, { limit: 10_000 });
  const openKeys = new Set(open.map((f) => String(f.dedupe_key)));
  let opened = 0;
  let closed = 0;
  for (const [key, { ci, std, why }] of wanted) {
    if (openKeys.has(key)) continue;
    await createIn(tx, sys, "cmdb_finding", {
      short_description: `«${ci.name}» روی «${std.name}${std.product_version ? ` ${std.product_version}` : ""}» (${why})`.slice(0, 200), ci_id: ci.id, kind: "technology",
      severity: std.status === "prohibited" || why.startsWith("پشتیبانی") ? "high" : "medium", detail: std.notes ?? `استاندارد فناوری: ${std.name}`, dedupe_key: key, auto: true,
      assigned_to: ci.owned_by ?? null, assignment_group_id: ci.support_group_id ?? null, workspace_id: ci.workspace_id ?? null,
    }, { trusted: true });
    opened++;
  }
  for (const f of open) {
    if (wanted.has(String(f.dedupe_key))) continue;
    await updateIn(tx, sys, "cmdb_finding", f.id, { active: false }, { trusted: true }).catch(() => undefined);
    closed++;
  }
  return { opened, closed };
}

export interface TechnologyRiskRow {
  id: string;
  name: string;
  product_version: string | null;
  status: string;
  eol_date: string | null;
  risk: string | null;
  cis: number;
  services: { id: string; name: string }[];
}

/** Standards with the CIs that match them and the services those CIs reach (the caller's reads). */
export async function technologyRisk(ctx: Ctx): Promise<TechnologyRiskRow[]> {
  const today = todayISO(String(ctx.org.settings?.timezone ?? "Asia/Tehran"));
  const standards = await liveRows(ctx.db, ctx, "technology_standard", null, { order: "t.name", limit: 500 });
  const out: TechnologyRiskRow[] = [];
  for (const std of standards) {
    const cond = standardCondition(std);
    const cis = cond ? await liveRows(ctx.db, ctx, "ci", { and: [LIVE_CI, cond] } as never, { limit: 500 }) : [];
    const reached = cis.length ? await servicesImpactedBy(ctx.db, ctx, cis.slice(0, 50).map((c) => String(c.id))) : [];
    const services = reached.length ? await liveRows(ctx.db, ctx, "service", { f: "id", op: "in", v: reached }, { order: "t.name", limit: 20 }) : [];
    out.push({
      id: String(std.id), name: String(std.name), product_version: std.product_version ?? null, status: String(std.status ?? "approved"), eol_date: std.eol_date ?? null,
      risk: standardRisk(std, today), cis: cis.length, services: services.filter((s) => isUuid(s.id)).map((s) => ({ id: String(s.id), name: String(s.name) })),
    });
  }
  return out.sort((a, b) => Number(!!b.risk) - Number(!!a.risk) || b.cis - a.cis);
}
