// The hook the event module (monitoring, AIOps) uses to raise incidents from alerts (catalogue EVT-0xx «alert →
// incident»; INC-004 «monitoring» intake). Until that module exists, integrations may call it too (through a flow or an
// inbound webhook handler). The alert's key is kept in `external_ref`: while an incident with that key is open, a
// repeated alert adds a note to it instead of opening another one.
import type { Ctx } from "../../context";
import { createIn, defFor } from "../../engine";
import { bad } from "../../http/errors";
import { eqAll, liveRows, sysOf, type Row } from "./common";
import { lockKey } from "../../db";
import { workNote } from "./major";

export interface AlertInput {
  /** the alert's stable key (source + id or a correlation key) */
  key: string;
  /** where it came from («Zabbix», «Prometheus» …) */
  source: string;
  title: string;
  description?: string | null;
  severity?: "critical" | "major" | "minor" | "warning" | "info";
  occurred_at?: string | null;
  ci_id?: string | null;
  service_id?: string | null;
  assignment_group_id?: string | null;
  category?: string | null;
  subcategory?: string | null;
}

const SEVERITY: Record<NonNullable<AlertInput["severity"]>, [string, string]> = {
  critical: ["1", "1"],
  major: ["2", "1"],
  minor: ["2", "2"],
  warning: ["3", "2"],
  info: ["3", "3"],
};

/** Open an incident for an alert, or add the repeat to the open one with the same key. Runs in the caller's transaction. */
export async function createFromAlert(tx: Parameters<typeof createIn>[0], ctx: Ctx, a: AlertInput): Promise<{ incident: Row; created: boolean }> {
  const key = String(a.key ?? "").trim().slice(0, 200);
  if (!key || !String(a.title ?? "").trim()) throw bad("کلید و عنوان هشدار لازم است");
  const sys = sysOf(ctx);
  // one incident per key: callers raising the same situation at the same moment (the event pipeline, a delayed rule,
  // an escalation, the console, an integration) take turns on the key, and the second finds the first one's incident
  await lockKey(tx, `incident.alert:${ctx.org.id}:${key}`);
  const [open] = await liveRows(tx, sys, "incident", { and: [eqAll({ external_ref: key }), { f: "active", op: "eq", v: true }] }, { order: "t.created_at desc", limit: 1 });
  const { def } = await defFor(sys, "incident", tx);
  if (open) {
    await workNote(tx, sys, def, open, `هشدار «${a.title}» از ${a.source} دوباره رسید${a.occurred_at ? ` (${a.occurred_at})` : ""}.`, { alert: key });
    return { incident: open, created: false };
  }
  const [impact, urgency] = SEVERITY[a.severity ?? "minor"] ?? SEVERITY.minor;
  const incident = await createIn(tx, sys, "incident", {
    short_description: String(a.title).trim().slice(0, 200),
    description: [a.description?.trim(), `منبع: ${a.source}`].filter(Boolean).join("\n\n"),
    channel: "monitoring",
    impact,
    urgency,
    external_ref: key,
    detected_at: a.occurred_at ?? null,
    ci_id: a.ci_id ?? null,
    service_id: a.service_id ?? null,
    assignment_group_id: a.assignment_group_id ?? null,
    category: a.category ?? null,
    subcategory: a.subcategory ?? null,
    caller_id: null,
  }, { trusted: true });
  await workNote(tx, sys, def, incident, `از هشدار پایش ${a.source} ساخته شد (کلید ${key}).`, { alert: key });
  return { incident, created: true };
}
