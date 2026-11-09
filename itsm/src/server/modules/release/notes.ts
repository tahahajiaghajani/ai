// Release notes (REL-033/037): the facts of a release's scope read with the caller's access — the changes it includes,
// the problems and known errors it fixes, the defects fixed in it, the known errors it accepts, the services and CIs
// it touches — and a rule-based draft per audience built from them (the AI skill `release.notes` writes from the same
// facts and falls back to this draft). A draft becomes a `release_note` row of the release (state draft) with the
// sources it was built from; publishing it is a person's act.
import { NOTE_AUDIENCES } from "@shared/tables/release";
import { formatJalali } from "@shared/jalali";
import { localParts } from "@shared/change/logic";
import type { Ctx } from "../../context";
import { createIn, get, list, listLinks, orgTz, updateIn } from "../../engine";
import { faList, sysOf, type Row } from "./common";

export type Audience = "end_users" | "operations" | "management";

export interface NoteFacts {
  release: { number: string | null; title: string; version: string | null; type: string | null; planned_end: string | null; deployed_at: string | null; service: string | null; risk: string | null };
  changes: { number: string | null; title: string; state: string | null }[];
  fixes: { number: string | null; title: string; table: string }[];
  defects: { number: string | null; title: string; severity: string | null }[];
  accepted: { number: string | null; title: string }[];
  services: string[];
  cis: string[];
  plans: { deployment: string | null; rollback: string | null };
}

/** A date-time as a Jalali date in the organisation's time zone. */
export const jDate = (ts: unknown, tz: string): string | null => {
  const ms = Date.parse(String(ts ?? ""));
  return Number.isFinite(ms) ? formatJalali(localParts(ms, tz).date) : null;
};

const clip = (s: unknown, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The facts of a release's notes (as the caller: unreadable linked records never appear). */
export async function noteFacts(ctx: Ctx, id: string): Promise<{ facts: NoteFacts; sources: Row[] }> {
  const { row: r, display } = await get(ctx, "release", id);
  const tz = orgTz(ctx);
  const links = (await listLinks(ctx, "release", id).catch(() => ({ links: [] }))).links;
  const sources: Row[] = [];
  const changes: NoteFacts["changes"] = [];
  const fixes: NoteFacts["fixes"] = [];
  for (const l of links) {
    const o = l.other;
    if (l.kind === "release_includes" && o.table === "change_request") {
      changes.push({ number: o.number, title: clip(o.display, 200), state: o.state_label ?? o.state });
      sources.push({ table: o.table, id: o.id, number: o.number });
    } else if (l.kind === "fixes" && (o.table === "problem" || o.table === "known_error")) {
      fixes.push({ number: o.number, title: clip(o.display, 200), table: o.table });
      sources.push({ table: o.table, id: o.id, number: o.number });
    } else if (l.kind === "release_includes") {
      fixes.push({ number: o.number, title: clip(o.display, 200), table: o.table });
      sources.push({ table: o.table, id: o.id, number: o.number });
    }
  }
  const defects = (await list(ctx, "defect", { filter: { and: [{ f: "release_id", op: "eq", v: id }, { f: "state", op: "in", v: ["fixed", "verified"] }] }, fields: ["number", "short_description", "severity"], size: 100, total: false }).catch(() => ({ rows: [] as Row[] }))).rows;
  for (const d of defects) sources.push({ table: "defect", id: d.id, number: d.number });
  const accepted: NoteFacts["accepted"] = [];
  const keIds = Array.isArray(r.known_errors_accepted) ? (r.known_errors_accepted as string[]) : [];
  if (keIds.length) {
    const kes = await list(ctx, "known_error", { ids: keIds, size: 50, total: false }).catch(() => ({ rows: [] as Row[] }));
    for (const k of kes.rows) {
      accepted.push({ number: k.number ?? null, title: clip(k.short_description ?? k.title ?? display[String(k.id)], 200) });
      sources.push({ table: "known_error", id: k.id, number: k.number ?? null });
    }
  }
  const names = (xs: unknown) => (Array.isArray(xs) ? xs : []).map((x) => display[String(x)]).filter(Boolean) as string[];
  return {
    facts: {
      release: {
        number: r.number ?? null, title: clip(r.short_description, 200), version: r.version_name ?? null, type: r.type ?? null,
        planned_end: jDate(r.planned_end, tz),
        deployed_at: jDate(r.deployed_at, tz),
        service: r.service_id ? (display[String(r.service_id)] ?? null) : null, risk: r.risk_band ?? null,
      },
      changes,
      fixes,
      defects: defects.map((d) => ({ number: d.number ?? null, title: clip(d.short_description, 200), severity: d.severity ?? null })),
      accepted,
      services: [...new Set([...names(r.affected_services), ...names(r.impacted_services), ...(r.service_id && display[String(r.service_id)] ? [display[String(r.service_id)]] : [])])],
      cis: names(r.affected_cis),
      plans: { deployment: r.deployment_plan ? clip(r.deployment_plan, 1500) : null, rollback: r.rollback_plan ? clip(r.rollback_plan, 800) : null },
    },
    sources,
  };
}

const line = (n: string | null, t: string) => `- ${n ? `${n} — ` : ""}${t}`;

/** The rule-based draft of a release note for an audience. */
export function ruleNotes(f: NoteFacts, audience: Audience): { title: string; body: string } {
  const head = `${f.release.title}${f.release.version ? ` (نسخهٔ ${f.release.version})` : ""}`;
  const parts: string[] = [];
  const when = f.release.deployed_at ?? f.release.planned_end;
  if (audience === "management") {
    parts.push(`انتشار ${f.release.number ?? ""} ${when ? `در ${when}` : ""} ${f.changes.length.toLocaleString("fa-IR")} تغییر و ${f.fixes.length.toLocaleString("fa-IR")} رفع مشکل را عرضه می‌کند${f.services.length ? ` و بر ${faList(f.services.slice(0, 5))} اثر دارد` : ""}.`.replace(/\s+/g, " "));
    if (f.release.risk) parts.push(`ریسک انتشار: ${({ low: "کم", medium: "متوسط", high: "زیاد", very_high: "بسیار زیاد" } as Record<string, string>)[f.release.risk] ?? f.release.risk}.`);
    if (f.accepted.length) parts.push(`${f.accepted.length.toLocaleString("fa-IR")} خطای شناخته‌شده با این انتشار پذیرفته شده است.`);
    return { title: `گزارش انتشار برای مدیران: ${head}`, body: parts.join("\n\n") };
  }
  parts.push(audience === "operations" ? `## خلاصه\n${head}${when ? ` — ${when}` : ""}` : `## تازه‌های ${head}`);
  if (f.changes.length) parts.push(`## ${audience === "end_users" ? "ویژگی‌ها و بهبودها" : "تغییرهای انتشار"}\n${f.changes.map((c) => line(audience === "end_users" ? null : c.number, c.title)).join("\n")}`);
  const fixed = [...f.fixes.map((x) => ({ number: x.number, title: x.title })), ...f.defects.map((d) => ({ number: d.number, title: d.title }))];
  if (fixed.length) parts.push(`## رفع اشکال‌ها\n${fixed.map((x) => line(audience === "end_users" ? null : x.number, x.title)).join("\n")}`);
  if (f.accepted.length) parts.push(`## مشکلات شناخته‌شده\n${f.accepted.map((k) => line(audience === "end_users" ? null : k.number, k.title)).join("\n")}`);
  if (audience === "operations") {
    if (f.services.length || f.cis.length) parts.push(`## خدمت‌ها و پیکربندی‌های متأثر\n${[...f.services.map((s) => `- خدمت: ${s}`), ...f.cis.slice(0, 20).map((c) => `- پیکربندی: ${c}`)].join("\n")}`);
    if (f.plans.deployment) parts.push(`## برنامهٔ استقرار\n${f.plans.deployment}`);
    if (f.plans.rollback) parts.push(`## برنامهٔ بازگشت\n${f.plans.rollback}`);
  }
  if (parts.length === 1) parts.push("هنوز تغییر یا رفع مشکلی به این انتشار پیوند نخورده است.");
  return { title: `${audience === "operations" ? "یادداشت عملیات" : "یادداشت انتشار"}: ${head}`, body: parts.join("\n\n") };
}

export const audienceLabel = (a: string) => NOTE_AUDIENCES.find((o) => o.value === a)?.label ?? a;

/** Store a drafted note on the release (created as the caller; the provenance stamped by the module). */
export async function saveDraftNote(ctx: Ctx, releaseId: string, input: { title: string; body: string; audience: Audience; language: string; sources: Row[]; ai: boolean }): Promise<Row> {
  return ctx.write(async (tx) => {
    const row = await createIn(tx, ctx, "release_note", { release_id: releaseId, title: input.title.slice(0, 200), body: input.body, audience: input.audience, language: input.language, state: "draft" });
    return updateIn(tx, sysOf(ctx), "release_note", String(row.id), { sources: input.sources.slice(0, 200), ai_generated: input.ai }, { trusted: true, keepVersion: true });
  });
}
