// HTTP API of event management and on-call under /api/o/:org/event (docs/modules/event_FA.md «API»). Records
// themselves (sources, rules, alerts, groups, schedules, policies, pages…) are served by the generic engine API
// (/r/alert…); these routes are what it cannot express: the alert console, actions with the module's authority,
// keys of sources, the rule simulation, the escalation timeline, who is on call and the schedules' shifts, «take
// on-call», «my shifts» (also as iCalendar), reports, the AI answers (with rule-based fallbacks) and the defaults.
// Sign-in-free: POST /api/public/events/:key (or /api/public/events with «Authorization: Bearer <key>») to ingest,
// GET|POST /api/public/ack/:token to see and acknowledge a page.
import { z } from "zod";
import { router, body, query, type C } from "../http/hono";
import { AppError, bad, forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { defFor, get, list, systemCtx, updateIn } from "../engine";
import { tick } from "../jobs";
import { PUBLIC_LIMIT, exemptFromPublicLimit, publicRoutes } from "./public";
import { formatJalaliDateTime } from "@shared/jalali";
import { ALERT_OPEN_STATES } from "@shared/tables/event";
import { normalize } from "@shared/event/logic";
import type { ConsoleView, OnCallNow, ShiftsView, TimelineView } from "@shared/event/api";
import {
  ackByToken, ackView, alertAction, ALERT_ACTIONS, bulkAction, canConfigure, canManageOncall, canRespond, eventConfig, forgetSources, groupAction, groupFacts,
  ingest, MAX_EVENT_BYTES, myShifts, newSourceKey, noiseReport, noiseText, oncallLoadReport, onCallOfSchedule, opsReport, parseBody, ruleCauses, ruleSummary,
  scheduleShifts, seedEventDefaults, simulateRule, sourceOfKey, takeOnCall, withAi, type AlertAction,
} from "../modules/event";
import { policyLevels } from "../modules/event/escalation";
import { inGroup, isUuid, liveRow, liveRows, msOf, orgTz, sysOf, type Row } from "../modules/event/common";
import { clientIp, hit, rateLimit } from "../http/ratelimit";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const DAY = 86_400_000;

async function needRead(ctx: C["var"]["ctx"], table: string) {
  const { def } = await defFor(ctx, table);
  if (!access().canReadTable(ctx, def)) throw forbidden(table.startsWith("oncall") || table === "escalation_policy" || table === "page" ? "به کشیک دسترسی ندارید" : "به هشدارها و رویدادها دسترسی ندارید");
  return def;
}

export const eventRoutes = router();

// ---------------------------------------------------------------------------------------------------------------
// Meta and defaults

eventRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const cfg = await eventConfig(ctx.db, ctx);
  return c.json({
    can: { configure: await canConfigure(ctx), oncall: await canManageOncall(ctx), ai: ctx.can("ai", "view") },
    config: { auto_close_minutes: cfg.auto_close_minutes, flap_threshold: cfg.flap_threshold, flap_window_minutes: cfg.flap_window_minutes, retention_days: cfg.retention_days },
    ingest_path: "/api/public/events/",
  });
});

eventRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  if (!(await canConfigure(ctx))) throw forbidden("افزودن پیش‌فرض‌ها با مدیر عملیات است");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  return c.json(await seedEventDefaults(ctx.cfg, ctx.org.id, { force: input.force ?? true }));
});

// ---------------------------------------------------------------------------------------------------------------
// The alert console

const CONSOLE_FIELDS = ["number", "short_description", "severity", "priority", "state", "node", "resource", "metric", "ci_id", "service_id", "assignment_group_id", "assigned_to", "event_count", "first_seen_at", "last_seen_at", "group_id", "incident_id", "noise_label", "escalation_state", "escalation_level", "symptom", "source_id", "acknowledged_at", "snoozed_until", "responders"];

eventRoutes.get("/console", async (c) => {
  const ctx = c.get("ctx");
  await needRead(ctx, "alert");
  const qp = query(c, z.object({ scope: z.enum(["open", "mine", "team", "all"]).optional(), q: z.string().max(200).optional(), severity: z.string().max(60).optional() }));
  const scope = qp.scope ?? "open";
  const and: unknown[] = [];
  if (scope !== "all") and.push({ f: "state", op: "in", v: ALERT_OPEN_STATES });
  else and.push({ f: "last_seen_at", op: "relative", v: { unit: "day", n: 1, dir: "past" } });
  if (scope === "mine") and.push({ or: [{ f: "assigned_to", op: "is_me" }, { f: "responders", op: "is_me" }] });
  if (scope === "team") and.push({ f: "assignment_group_id", op: "is_my_group" });
  if (qp.severity) and.push({ f: "severity", op: "in", v: qp.severity.split(",").filter(Boolean) });
  const res = await list(ctx, "alert", { filter: { and } as never, q: qp.q || undefined, sort: "severity,-last_seen_at", size: 500, fields: CONSOLE_FIELDS, total: true });
  const def = (await defFor(ctx, "alert")).def;
  const groupIds = [...new Set(res.rows.map((r) => r.group_id).filter(isUuid))];
  const groups = groupIds.length ? await list(ctx, "alert_group", { ids: groupIds, size: groupIds.length, fields: ["number", "title", "severity", "priority", "state", "reason", "alert_count", "open_count", "assignment_group_id", "assigned_to", "incident_id", "first_seen_at", "last_seen_at", "ci_id"], total: false }) : { rows: [] as Row[], display: {} };
  const out: ConsoleView = {
    groups: groups.rows.map((g) => ({ ...g, alerts: res.rows.filter((r) => r.group_id === g.id).map((r) => ({ ...r, can_respond: canRespond(ctx, def, r) })) })) as never,
    alerts: res.rows.filter((r) => !isUuid(r.group_id) || !groups.rows.some((g) => g.id === r.group_id)).map((r) => ({ ...r, can_respond: canRespond(ctx, def, r) })) as never,
    counts: {
      total: res.total ?? res.rows.length,
      open: res.rows.filter((r) => r.state === "open").length,
      acknowledged: res.rows.filter((r) => r.state === "acknowledged").length,
      critical: res.rows.filter((r) => r.severity === "critical" && r.state !== "cleared").length,
      unassigned: res.rows.filter((r) => !r.assigned_to && r.state === "open").length,
    },
    display: { ...res.display, ...groups.display },
    truncated: (res.total ?? 0) > res.rows.length,
  };
  return c.json(out);
});

const actionBody = z.object({
  user_id: UUID.nullable().optional(),
  minutes: z.number().int().min(5).max(10080).optional(),
  close_code: z.string().max(40).optional(),
  close_notes: z.string().max(4000).nullable().optional(),
  body: z.string().max(20_000).optional(),
});

eventRoutes.post("/alerts/:id/:action", async (c) => {
  const ctx = c.get("ctx");
  const action = c.req.param("action") as AlertAction;
  if (!ALERT_ACTIONS.includes(action)) throw notFound("اقدام ناشناخته است");
  const input = await body(c, actionBody);
  const row = await alertAction(ctx, id(c.req.param("id")), action, input);
  return c.json(await get(ctx, "alert", String(row.id)));
});

eventRoutes.post("/alerts-bulk", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, actionBody.extend({ ids: z.array(UUID).min(1).max(200), action: z.enum(["ack", "take", "close", "snooze", "suppress"]) }));
  return c.json(await bulkAction(ctx, input.ids.map((x) => x.toLowerCase()), input.action, input));
});

eventRoutes.post("/groups/:id/:action", async (c) => {
  const ctx = c.get("ctx");
  const action = c.req.param("action");
  if (!["ack", "take", "close", "incident"].includes(action)) throw notFound("اقدام ناشناخته است");
  const input = await body(c, actionBody);
  const r = await groupAction(ctx, id(c.req.param("id")), action as "ack" | "take" | "close" | "incident", input);
  return c.json({ done: r.done, skipped: r.skipped, failed: r.failed, group: (await get(ctx, "alert_group", String(r.group.id))).row });
});

// ---------------------------------------------------------------------------------------------------------------
// Escalation timeline of an alert

eventRoutes.get("/alerts/:id/timeline", async (c) => {
  const ctx = c.get("ctx");
  const alertId = id(c.req.param("id"));
  const { row, display } = await get(ctx, "alert", alertId);
  const items: TimelineView["items"] = [];
  const push = (at: unknown, kind: TimelineView["items"][number]["kind"], label: string, extra: Partial<TimelineView["items"][number]> = {}) => {
    if (at) items.push({ at: String(at), kind, label, ...extra });
  };
  push(row.first_seen_at, "seen", "نخستین رویداد");
  push(row.opened_at ?? row.created_at, "opened", "هشدار باز شد");
  const pageDef = (await defFor(ctx, "page")).def;
  const pages = access().canReadTable(ctx, pageDef) || canRespond(ctx, (await defFor(ctx, "alert")).def, row)
    ? await liveRows(ctx.db, sysOf(ctx), "page", { f: "alert_id", op: "eq", v: alertId }, { order: "t.sent_at", limit: 200 })
    : [];
  const names: Record<string, string> = {};
  if (pages.length) {
    const people = await liveRows(ctx.db, sysOf(ctx), "member_profile", { f: "user_id", op: "in", v: [...new Set(pages.map((p) => String(p.user_id)))] }, { limit: 200 }).catch(() => [] as Row[]);
    for (const p of people) names[String(p.user_id)] = String(p.name ?? "");
  }
  for (const p of pages) {
    push(p.sent_at, "paged", `فراخوان سطح ${Number(p.level).toLocaleString("fa-IR")}: ${names[String(p.user_id)] ?? "عضو"}`, { level: Number(p.level), user_id: String(p.user_id), state: String(p.state) });
    if (p.acknowledged_at) push(p.acknowledged_at, "page_ack", `${names[String(p.user_id)] ?? "عضو"} تأیید کرد${p.ack_via === "link" ? " (پیوند)" : ""}`, { level: Number(p.level), user_id: String(p.user_id) });
    else if (p.state === "expired") push(p.updated_at, "page_expired", `فراخوان ${names[String(p.user_id)] ?? "عضو"} بی‌پاسخ ماند`, { level: Number(p.level) });
  }
  push(row.acknowledged_at, "acknowledged", "هشدار تأیید شد");
  push(row.resolved_at, "cleared", "هشدار رفع شد");
  push(row.closed_at, "closed", "هشدار بسته شد");
  // the levels still ahead of a running escalation
  const planned: TimelineView["planned"] = [];
  let policy: TimelineView["policy"] = null;
  if (isUuid(row.escalation_policy_id)) {
    const p = await liveRow(ctx.db, sysOf(ctx), "escalation_policy", row.escalation_policy_id);
    const levels = p ? await policyLevels(ctx.db, sysOf(ctx), String(p.id)) : [];
    policy = p ? { id: String(p.id), name: String(p.name), repeat_times: Number(p.repeat_times ?? 0), levels: levels.map((l) => ({ level: Number(l.level), delay_minutes: Number(l.delay_minutes ?? 0), target: String(l.target), channels: Array.isArray(l.channels) ? l.channels : [] })) } : null;
    if (row.escalation_state === "running" && row.next_escalation_at) {
      let at = msOf(row.next_escalation_at)!;
      for (const l of levels.filter((x) => Number(x.level) > Number(row.escalation_level ?? 0))) {
        planned.push({ at: new Date(at).toISOString(), level: Number(l.level), target: String(l.target) });
        const next = levels.find((x) => Number(x.level) > Number(l.level));
        if (next) at += Math.max(1, Number(next.delay_minutes) || 0) * 60_000;
      }
    }
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  const view: TimelineView = { items, planned, policy, state: String(row.escalation_state ?? "none"), display };
  return c.json(view);
});

// ---------------------------------------------------------------------------------------------------------------
// Correlated groups: causes and AI (each with its rule-based answer)

eventRoutes.get("/groups/:id/causes", async (c) => {
  const ctx = c.get("ctx");
  const f = await groupFacts(ctx, id(c.req.param("id")));
  return c.json({ causes: f.causes, summary: ruleSummary(f), hints: ruleCauses(f.causes) });
});

eventRoutes.post("/groups/:id/ai/summary", async (c) => {
  const ctx = c.get("ctx");
  const groupId = id(c.req.param("id"));
  await get(ctx, "alert_group", groupId);
  return c.json(await withAi(ctx, "event.cluster_summary", { table: "alert_group", id: groupId }, async () => ruleSummary(await groupFacts(ctx, groupId))));
});

eventRoutes.post("/groups/:id/ai/causes", async (c) => {
  const ctx = c.get("ctx");
  const groupId = id(c.req.param("id"));
  await get(ctx, "alert_group", groupId);
  return c.json(await withAi(ctx, "event.root_cause", { table: "alert_group", id: groupId }, async () => ruleCauses((await groupFacts(ctx, groupId)).causes)));
});

eventRoutes.post("/ai/noise", async (c) => {
  const ctx = c.get("ctx");
  await needRead(ctx, "alert");
  const input = await body(c, z.object({ days: z.number().int().min(1).max(90).optional() }));
  const days = input.days ?? 30;
  return c.json(await withAi(ctx, "event.noise_report", { params: { days: String(days) } }, async () => noiseText(await noiseReport(ctx, days))));
});

// ---------------------------------------------------------------------------------------------------------------
// Sources: keys and the rule simulation

eventRoutes.post("/sources/:id/key", async (c) => {
  const ctx = c.get("ctx");
  const sourceId = id(c.req.param("id"));
  const { def } = await defFor(ctx, "event_source");
  const { row } = await get(ctx, "event_source", sourceId);
  if (!access().canWrite(ctx, def, row)) throw forbidden("ساخت کلید این منبع با مدیر عملیات است");
  const key = newSourceKey();
  await ctx.write((tx) => updateIn(tx, sysOf(ctx, ctx.user.id), "event_source", sourceId, { token_hash: key.hash, token_hint: key.hint, token_rotated_at: new Date().toISOString() }, { trusted: true }));
  forgetSources();
  const base = (ctx.cfg.publicUrl ?? "").replace(/\/+$/, "");
  return c.json({ key: key.token, hint: key.hint, url: `${base}/api/public/events/${key.token}`, header_url: `${base}/api/public/events` });
});

eventRoutes.post("/sources/:id/test", async (c) => {
  const ctx = c.get("ctx");
  const sourceId = id(c.req.param("id"));
  const { row } = await get(ctx, "event_source", sourceId);
  const input = await body(c, z.object({ payload: z.unknown() }));
  const n = normalize({ kind: String(row.kind), mapping: row.mapping, severity_map: row.severity_map, default_severity: row.default_severity }, input.payload);
  return c.json({ events: n.events.map((e) => ({ ...e, payload: undefined })), skipped: n.skipped ?? null, confirm: !!n.confirm_url });
});

eventRoutes.post("/rules/simulate", async (c) => {
  const ctx = c.get("ctx");
  if (!(await canConfigure(ctx))) throw forbidden("شبیه‌سازی قاعده با مدیر عملیات است");
  const input = await body(c, z.object({ rule: z.record(z.string(), z.unknown()).optional(), rule_id: UUID.optional(), days: z.number().int().min(1).max(30).optional() }));
  let rule: Row | null = input.rule ?? null;
  if (input.rule_id) rule = (await get(ctx, "event_rule", input.rule_id.toLowerCase())).row;
  if (!rule) throw bad("قاعده را بفرستید");
  return c.json(await simulateRule(ctx.db, sysOf(ctx), rule, { days: input.days ?? 7 }));
});

// ---------------------------------------------------------------------------------------------------------------
// On-call

eventRoutes.get("/oncall/now", async (c) => {
  const ctx = c.get("ctx");
  await needRead(ctx, "oncall_schedule");
  const qp = query(c, z.object({ group_id: UUID.optional() }));
  const filter = qp.group_id ? { and: [{ f: "active", op: "eq", v: true }, { f: "group_id", op: "eq", v: qp.group_id.toLowerCase() }] } : { f: "active", op: "eq", v: true };
  const res = await list(ctx, "oncall_schedule", { filter: filter as never, size: 100, sort: "name", fields: ["name", "group_id"], total: false });
  const out: OnCallNow[] = [];
  for (const s of res.rows) {
    const who = await onCallOfSchedule(ctx.db, ctx, s);
    out.push({ schedule_id: String(s.id), schedule: String(s.name), group_id: s.group_id ?? null, user_id: who.user, override: !!who.override_id, until: who.until ? new Date(who.until).toISOString() : null });
  }
  const users = [...new Set(out.map((o) => o.user_id).filter(isUuid))];
  const people = users.length ? await liveRows(ctx.db, sysOf(ctx), "member_profile", { f: "user_id", op: "in", v: users }, { limit: 200 }) : [];
  const display: Record<string, string> = { ...res.display };
  for (const p of people) display[String(p.user_id)] = String(p.name ?? "");
  return c.json({ items: out, display });
});

eventRoutes.get("/oncall/schedules/:id/shifts", async (c) => {
  const ctx = c.get("ctx");
  const scheduleId = id(c.req.param("id"));
  const { row } = await get(ctx, "oncall_schedule", scheduleId);
  const qp = query(c, z.object({ from: z.string().optional(), to: z.string().optional() }));
  const from = qp.from ? Date.parse(qp.from) : Date.now() - 7 * DAY;
  const to = qp.to ? Date.parse(qp.to) : from + 28 * DAY;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw bad("بازهٔ زمانی معتبر نیست");
  const r = await scheduleShifts(ctx.db, ctx, row, from, Math.min(to, from + 92 * DAY));
  const users = new Set<string>();
  for (const s of r.final) if (s.user) users.add(s.user);
  for (const l of r.layers) for (const s of l.shifts) if (s.user) users.add(s.user);
  for (const o of r.overrides) {
    users.add(o.user_id);
    if (o.replaces_id) users.add(o.replaces_id);
  }
  const people = users.size ? await liveRows(ctx.db, sysOf(ctx), "member_profile", { f: "user_id", op: "in", v: [...users] }, { limit: 500 }) : [];
  const display: Record<string, string> = {};
  for (const p of people) display[String(p.user_id)] = String(p.name ?? "");
  const iso = (n: number) => new Date(n).toISOString();
  const view: ShiftsView = {
    schedule: { id: scheduleId, name: String(row.name), group_id: row.group_id ?? null, timezone: r.tz, calendar_id: row.calendar_id ?? null },
    from: iso(from),
    to: iso(to),
    final: r.final.map((s) => ({ start: iso(s.start), end: iso(s.end), user_id: s.user, layer: s.layer, rotation_id: s.rotation_id, override_id: s.override_id })),
    layers: r.layers.map((l) => ({ rotation_id: String(l.rotation.id), name: String(l.rotation.name ?? ""), layer: Number(l.rotation.layer ?? 1), restriction: String(l.rotation.restriction ?? "none"), shifts: l.shifts.map((s) => ({ start: iso(s.start), end: iso(s.end), user_id: s.user, layer: s.layer, rotation_id: s.rotation_id, override_id: null })) })),
    overrides: r.overrides.map((o) => ({ id: o.id, user_id: o.user_id, replaces_id: o.replaces_id ?? null, start_at: o.start_at, end_at: o.end_at, reason: o.reason ?? null })),
    gaps: r.gaps.map((g) => ({ start: iso(g.start), end: iso(g.end) })),
    now: iso(Date.now()),
    can_take: (await canManageOncall(ctx)) || inGroup(ctx, row.group_id),
    display,
  };
  return c.json(view);
});

eventRoutes.post("/oncall/schedules/:id/take", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ minutes: z.number().int().min(15).max(10080).optional(), start_at: z.string().optional(), end_at: z.string().optional(), replaces_id: UUID.nullable().optional(), user_id: UUID.nullable().optional(), reason: z.string().max(200).optional() }));
  const row = await ctx.write((tx) => takeOnCall(tx, ctx, id(c.req.param("id")), input));
  return c.json({ override: row });
});

eventRoutes.get("/oncall/mine", async (c) => {
  const ctx = c.get("ctx");
  const qp = query(c, z.object({ days: z.coerce.number().int().min(1).max(92).optional() }));
  const from = Date.now() - DAY;
  const items = await myShifts(ctx.db, ctx, from, from + (qp.days ?? 30) * DAY);
  return c.json({ items: items.map((s) => ({ ...s, start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })) });
});

/** «شیفت‌های من» as iCalendar (RFC 5545), for calendar apps. */
eventRoutes.get("/oncall/mine.ics", async (c) => {
  const ctx = c.get("ctx");
  const from = Date.now() - DAY;
  const items = await myShifts(ctx.db, ctx, from, from + 60 * DAY);
  const stamp = (n: number) => new Date(n).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ITSM//On-call//FA", "CALSCALE:GREGORIAN", "X-WR-CALNAME:کشیک‌های من"];
  for (const s of items) {
    lines.push("BEGIN:VEVENT", `UID:${s.schedule_id}-${s.start}@oncall`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(s.start)}`, `DTEND:${stamp(s.end)}`, `SUMMARY:${esc(`کشیک: ${s.schedule}`)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  c.header("Content-Type", "text/calendar; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="oncall.ics"');
  return c.body(lines.join("\r\n"));
});

// ---------------------------------------------------------------------------------------------------------------
// Reports

eventRoutes.get("/reports", async (c) => {
  const ctx = c.get("ctx");
  const qp = query(c, z.object({ days: z.coerce.number().int().min(1).max(90).optional() }));
  return c.json(await opsReport(ctx, qp.days ?? 30));
});

eventRoutes.get("/noise", async (c) => {
  const ctx = c.get("ctx");
  const qp = query(c, z.object({ days: z.coerce.number().int().min(1).max(90).optional() }));
  return c.json(await noiseReport(ctx, qp.days ?? 30));
});

eventRoutes.get("/oncall/load", async (c) => {
  const ctx = c.get("ctx");
  const qp = query(c, z.object({ days: z.coerce.number().int().min(1).max(92).optional() }));
  return c.json(await oncallLoadReport(ctx, qp.days ?? 30));
});

// ---------------------------------------------------------------------------------------------------------------
// Sign-in-free: ingestion and acknowledgement. Acknowledgement is rate limited by the public router; ingestion is not
// (a monitoring tool sends many events from one address, and all tools behind one NAT share it): each source has its
// own limit (`rate_limit`, up to 100000 a minute), and deliveries with a wrong key are limited per client.

/** Deliveries with a wrong key from one client in a minute (the public router's budget, for the wrong keys only). */
export const BAD_KEY_LIMIT = { name: "event-bad-key", limit: PUBLIC_LIMIT.limit, windowMs: PUBLIC_LIMIT.windowMs };

async function ingestHandler(c: C, key: string) {
  const cfg = c.get("cfg");
  const src = await sourceOfKey(cfg.db, key);
  if (!src) {
    // only the wrong keys count (a tool with a good key behind the same address is never held back)
    const wait = hit(BAD_KEY_LIMIT, clientIp(c));
    if (wait) {
      c.header("Retry-After", String(wait));
      throw new AppError(429, "rate_limited", "درخواست‌ها بیش از اندازه است؛ کمی بعد دوباره امتحان کنید");
    }
    throw new AppError(401, "unauthorized", "کلید منبع رویداد معتبر نیست");
  }
  if (Number(c.req.header("content-length") ?? 0) > MAX_EVENT_BYTES) throw new AppError(413, "too_large", "حجم رویداد بیش از اندازهٔ مجاز است");
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_EVENT_BYTES) throw new AppError(413, "too_large", "حجم رویداد بیش از اندازهٔ مجاز است");
  const payload = parseBody(raw, c.req.header("content-type") ?? "", src.kind);
  try {
    const r = await ingest(cfg, src, payload, { idempotencyKey: c.req.header("idempotency-key") ?? null });
    // the web version runs the processing right after the answer
    if (r.accepted && cfg.waitUntil) cfg.waitUntil(() => tick(cfg, { budgetMs: 4000 }).then(() => undefined).catch(() => undefined));
    return c.json({ ok: true, accepted: r.accepted, duplicates: r.duplicates, skipped: r.skipped ?? null, confirm: r.confirm ?? false }, r.accepted ? 202 : 200);
  } catch (e) {
    const wait = (e as { retryAfter?: number }).retryAfter;
    if (wait) c.header("Retry-After", String(wait));
    throw e;
  }
}

exemptFromPublicLimit("POST", /\/public\/events(?:\/[^/]+)?\/?$/);
publicRoutes.post("/events/:key", (c) => ingestHandler(c, c.req.param("key") ?? ""));
publicRoutes.post("/events", (c) => {
  const auth = c.req.header("authorization") ?? "";
  const key = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : c.req.header("x-api-key") ?? "";
  return ingestHandler(c, key);
});

publicRoutes.get("/ack/:token", async (c) => {
  const cfg = c.get("cfg");
  c.header("Cache-Control", "no-store");
  return c.json(await ackView(cfg as never, c.req.param("token") ?? ""));
});

publicRoutes.post("/ack/:token", rateLimit({ name: "event-ack", limit: 30, windowMs: 60_000, key: (c) => c.req.param("token") ?? "" }), async (c) => {
  const cfg = c.get("cfg");
  c.header("Cache-Control", "no-store");
  const r = await ackByToken(cfg as never, c.req.param("token") ?? "");
  if (r.changed && cfg.waitUntil) cfg.waitUntil(() => tick(cfg, { budgetMs: 4000 }).then(() => undefined).catch(() => undefined));
  return c.json(r);
});

export { PUBLIC_LIMIT, formatJalaliDateTime, orgTz, systemCtx };
