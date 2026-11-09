// Pure logic of event management (docs/modules/event_FA.md), shared by the server's pipeline and the screens:
//   normalise     every source format (generic JSON with a field mapping, Prometheus Alertmanager, Grafana, Zabbix,
//                 Nagios/Icinga, Azure Monitor's common schema, CloudWatch through SNS, e-mail with regular
//                 expressions) → one common event shape; secrets in payloads are redacted on the way in
//   severities    the source's words and numbers → critical / major / minor / warning / info; the severity matrix
//   fingerprints  source + node + resource + metric (or the tool's own alert key) → one alert while it is open
//   flapping      fire/clear flips within a window; noise labels with their reason
//   correlation   group keys per rule kind; the group's title and rule-based summary
//   causes        deterministic ranking of probable causes (temporal precedence, upstream position, recent changes)
// No server or UI imports.
import type { Severity } from "../tables/event";
import { SEVERITY_ORDER } from "../tables/event";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type EventStatus = "firing" | "resolved";

/** One event in the common shape (before CI binding and rules). */
export interface NormalizedEvent {
  message: string;
  description: string | null;
  node: string | null;
  resource: string | null;
  metric: string | null;
  severity: Severity;
  status: EventStatus;
  occurred_at: string | null;
  tags: string[];
  value: number | null;
  /** the tool's own key of the alert (Alertmanager fingerprint, Zabbix trigger, Azure alert id…) */
  fingerprint_hint: string | null;
  /** the tool's id of this delivery (idempotency): a repeat with the same key is stored once */
  dedupe_hint: string | null;
  /** a CI named by the payload (number, name or cloud resource id) */
  ci_hint: string | null;
  /** a service named by the payload */
  service_hint: string | null;
  /** the raw payload of this event, secrets redacted */
  payload: Json;
}

export interface SourceSpec {
  kind: string;
  mapping?: Record<string, unknown> | null;
  severity_map?: Record<string, unknown> | null;
  default_severity?: string | null;
}

/** What a delivery produced: events, or a request the endpoint answers itself (SNS subscription). */
export interface Normalized {
  events: NormalizedEvent[];
  /** SNS asks to confirm the subscription: the URL to visit (checked by the server) */
  confirm_url?: string | null;
  /** deliveries that carry nothing to record (acknowledgements, test pings) */
  skipped?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};
const cut = (s: string | null, n: number): string | null => (s === null ? null : s.length > n ? s.slice(0, n) : s);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.trim()))) return Number(v.trim());
  return null;
};
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const s = String(v).trim();
  // Zabbix-style «2026.11.09 10:15:00» and other dotted dates
  const dotted = /^(\d{4})[./](\d{2})[./](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  const t = dotted ? Date.parse(`${dotted[1]}-${dotted[2]}-${dotted[3]}T${dotted[4]}:${dotted[5]}:${dotted[6] ?? "00"}Z`) : Date.parse(s);
  // Go's zero time (Alertmanager's endsAt of a firing alert) means «none»
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1)) return null;
  return new Date(t).toISOString();
};

/** A short FNV-1a hash (hex) — stable across runtimes, no crypto needed. */
export function shortHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------------------------------------------
// Redaction

const SECRET_KEY = /pass(word|wd)?|secret|token|api[-_]?key|authori[sz]ation|^auth$|cookie|private[-_]?key|credential|signature/i;
const MAX_DEPTH = 8;
const MAX_STRING = 4000;
const MAX_ITEMS = 200;

/** A copy of a payload with secrets masked, long strings cut and deep or wide structures bounded. */
export function redact(v: unknown, depth = 0): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => redact(x, depth + 1));
  if (isObj(v)) {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v).slice(0, MAX_ITEMS)) out[k] = SECRET_KEY.test(k) && x !== null && x !== "" ? "***" : redact(x, depth + 1);
    return out;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Paths and patterns

/** Read `$.a.b[0].c` (or `a.b.0.c`) from a JSON value; `=text` is the literal text. */
export function readPath(root: unknown, path: unknown): unknown {
  if (typeof path !== "string" || !path.trim()) return undefined;
  const p = path.trim();
  if (p.startsWith("=")) return p.slice(1);
  const parts = p.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1").replace(/\[["']([^"']+)["']\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = root;
  for (const k of parts) {
    if (Array.isArray(cur) && /^\d+$/.test(k)) cur = cur[Number(k)];
    else if (isObj(cur)) cur = cur[k];
    else return undefined;
  }
  return cur;
}

/** Named groups of a regular expression on a text (null when it does not match or is not a valid expression). */
export function matchPattern(pattern: unknown, text: unknown): Record<string, string> | null {
  if (typeof pattern !== "string" || !pattern.trim() || pattern.length > 300) return null;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "iu");
  } catch {
    return null;
  }
  const m = re.exec(String(text ?? "").slice(0, 2000));
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.groups ?? {})) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  return out;
}

/** Why a pattern is not usable (Persian), or null. */
export function patternProblem(pattern: unknown): string | null {
  if (pattern === null || pattern === undefined || pattern === "") return null;
  if (typeof pattern !== "string" || pattern.length > 300) return "الگو حداکثر ۳۰۰ نویسه است";
  try {
    new RegExp(pattern, "iu");
    return null;
  } catch (e) {
    return `الگوی عبارت منظم معتبر نیست: ${String((e as Error).message ?? e).slice(0, 120)}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Severities

const WORDS: [RegExp, Severity][] = [
  [/^(critical|crit|disaster|fatal|emergency|emerg|alert|sev[-_ ]?0|p1|down|unreachable|بحرانی)$/, "critical"],
  [/^(major|error|err|high|sev[-_ ]?1|p2|شدید|زیاد)$/, "major"],
  [/^(minor|average|medium|moderate|sev[-_ ]?2|p3|unknown|متوسط)$/, "minor"],
  [/^(warning|warn|low|sev[-_ ]?3|p4|اخطار|کم)$/, "warning"],
  [/^(info|information|informational|notice|debug|ok|up|not classified|none|sev[-_ ]?4|p5|اطلاعی)$/, "info"],
];

/** The severity of a source's value: its map first, then the common words and numbers, else `fallback`. */
export function mapSeverity(raw: unknown, map: Record<string, unknown> | null | undefined, fallback: Severity = "minor"): Severity {
  const v = str(raw);
  if (v === null) return fallback;
  const key = v.toLowerCase();
  if (map) {
    for (const [k, s] of Object.entries(map)) if (k.toLowerCase() === key && SEVERITY_ORDER.includes(s as Severity)) return s as Severity;
  }
  if (SEVERITY_ORDER.includes(key as Severity)) return key as Severity;
  for (const [re, s] of WORDS) if (re.test(key)) return s;
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return SEVERITY_ORDER[n - 1];
  return fallback;
}

export const severityRank = (s: unknown): number => {
  const i = SEVERITY_ORDER.indexOf(s as Severity);
  return i < 0 ? SEVERITY_ORDER.length : i;
};

/** The worse of two severities. */
export const worse = (a: unknown, b: unknown): Severity => (severityRank(a) <= severityRank(b) ? (a as Severity) : (b as Severity));

/**
 * The default severity matrix: impact (1 high … 3 low, from the CI's criticality) × severity → priority. The seed
 * stores it as the `alert` table's priority matrix (impact × severity), which organisations edit.
 */
export const SEVERITY_MATRIX: Record<string, Record<Severity, string>> = {
  "1": { critical: "1", major: "1", minor: "2", warning: "3", info: "4" },
  "2": { critical: "1", major: "2", minor: "3", warning: "4", info: "5" },
  "3": { critical: "2", major: "3", minor: "4", warning: "5", info: "5" },
};

export function priorityOf(severity: unknown, impact: unknown = "2"): string {
  const row = SEVERITY_MATRIX[String(impact)] ?? SEVERITY_MATRIX["2"];
  return row[(SEVERITY_ORDER.includes(severity as Severity) ? severity : "minor") as Severity];
}

/** A CI's criticality (1 vital … 4 low) → the alert's impact (1 … 3). */
export function impactOfCriticality(c: unknown): string {
  const n = Number(c);
  if (n === 1) return "1";
  if (n === 2) return "2";
  return "3";
}

// ---------------------------------------------------------------------------------------------------------------
// Normalisation

const RESOLVED_WORDS = /^(resolved|resolve|ok|okay|clear|cleared|closed|recovered|recovery|up|normal|false|0|inactive|رفع|رفع‌شده)$/i;

function statusOf(raw: unknown): EventStatus {
  const v = str(raw);
  return v !== null && RESOLVED_WORDS.test(v) ? "resolved" : "firing";
}

/** «host:9100» → «host» (exporters' instance labels). */
const hostOf = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (/^\[?[0-9a-f:]+\]?:\d+$/i.test(s) && s.includes("]")) return s.replace(/^\[([^\]]+)\]:\d+$/, "$1");
  return s.replace(/:\d+$/, "");
};

const labelTags = (labels: unknown, skip: string[] = []): string[] =>
  isObj(labels)
    ? Object.entries(labels)
        .filter(([k, v]) => !skip.includes(k) && str(v) !== null)
        .slice(0, 20)
        .map(([k, v]) => cut(`${k}=${str(v)}`, 60)!)
    : [];

function base(over: Partial<NormalizedEvent> & { message: string }, spec: SourceSpec, raw: unknown): NormalizedEvent {
  const fallback = mapSeverity(spec.default_severity, null, "minor");
  return {
    description: null,
    node: null,
    resource: null,
    metric: null,
    severity: fallback,
    status: "firing",
    occurred_at: null,
    tags: [],
    value: null,
    fingerprint_hint: null,
    dedupe_hint: null,
    ci_hint: null,
    service_hint: null,
    ...over,
    message: cut(over.message.replace(/\s+/g, " ").trim(), 300) || "رویداد بی‌عنوان",
    payload: redact(raw),
  };
}

function alertmanagerLike(p: Record<string, any>, spec: SourceSpec, sevMap: Record<string, unknown> | null, kind: string): NormalizedEvent[] {
  const common = isObj(p.commonLabels) ? p.commonLabels : {};
  return (Array.isArray(p.alerts) ? p.alerts : []).slice(0, 500).map((a: any) => {
    const labels = { ...common, ...(isObj(a.labels) ? a.labels : {}) };
    const ann = { ...(isObj(p.commonAnnotations) ? p.commonAnnotations : {}), ...(isObj(a.annotations) ? a.annotations : {}) };
    const status = statusOf(a.status ?? p.status);
    const startsAt = iso(a.startsAt);
    const endsAt = iso(a.endsAt);
    const fp = str(a.fingerprint) ?? shortHash(JSON.stringify(labels));
    const value = num(a.valueString?.match?.(/value=([-0-9.eE+]+)/)?.[1]) ?? (isObj(a.values) ? num(Object.values(a.values)[0]) : null);
    return base({
      message: str(ann.summary) ?? str(ann.title) ?? str(labels.alertname) ?? str(p.title) ?? "هشدار",
      description: cut(str(ann.description) ?? str(ann.message) ?? str(a.valueString), 4000),
      node: hostOf(labels.instance) ?? str(labels.host) ?? str(labels.hostname) ?? str(labels.node) ?? str(labels.nodename),
      resource: str(labels.job) ?? str(labels.pod) ?? str(labels.container) ?? str(labels.device) ?? str(labels.mountpoint),
      metric: str(labels.alertname) ?? str(labels.__alert_rule_title__),
      severity: mapSeverity(labels.severity ?? labels.priority, sevMap, mapSeverity(spec.default_severity, null)),
      status,
      occurred_at: status === "resolved" ? endsAt ?? startsAt : startsAt,
      tags: labelTags(labels, ["alertname", "severity", "instance"]),
      value,
      fingerprint_hint: `${kind}:${fp}`,
      dedupe_hint: `${fp}:${startsAt ?? ""}:${status}`,
      ci_hint: str(labels.ci) ?? str(labels.cmdb_ci),
      service_hint: str(labels.service),
    }, spec, { ...a, receiver: p.receiver, groupKey: p.groupKey, externalURL: p.externalURL });
  });
}

function grafanaLegacy(p: Record<string, any>, spec: SourceSpec, sevMap: Record<string, unknown> | null): NormalizedEvent[] {
  const state = String(p.state ?? "").toLowerCase();
  if (state === "pending" || state === "paused") return [];
  const match = Array.isArray(p.evalMatches) ? p.evalMatches[0] : null;
  const tags = isObj(p.tags) ? p.tags : {};
  return [
    base({
      message: str(p.ruleName) ?? str(p.title) ?? "هشدار Grafana",
      description: cut(str(p.message), 4000),
      node: str(tags.host) ?? str(match?.tags?.host) ?? str(match?.tags?.instance),
      resource: str(p.ruleUrl),
      metric: str(match?.metric) ?? str(p.ruleName),
      severity: mapSeverity(tags.severity ?? (state === "no_data" ? "warning" : null), sevMap, mapSeverity(spec.default_severity, null)),
      status: state === "ok" ? "resolved" : "firing",
      tags: labelTags(tags),
      value: num(match?.value),
      fingerprint_hint: `grafana:${str(p.ruleId) ?? str(p.ruleName) ?? "rule"}`,
      dedupe_hint: null,
    }, spec, p),
  ];
}

function zabbix(p: Record<string, any>, spec: SourceSpec, sevMap: Record<string, unknown> | null): NormalizedEvent[] {
  const raw = p.event ?? p;
  const st = str(raw.status ?? raw.event_status ?? raw.trigger_status)?.toUpperCase() ?? null;
  const value = str(raw.event_value ?? raw.value);
  const status: EventStatus = st === "RESOLVED" || st === "OK" || value === "0" || !!str(raw.recovery_id ?? raw.event_recovery_id) && st !== "PROBLEM" ? "resolved" : "firing";
  const trigger = str(raw.trigger_id ?? raw.triggerid);
  const host = str(raw.host ?? raw.hostname ?? raw.host_name ?? raw.host_host);
  const eventId = str(raw.event_id ?? raw.eventid);
  const when = raw.event_date && raw.event_time ? iso(`${raw.event_date} ${raw.event_time}`) : iso(raw.timestamp ?? raw.clock);
  return [
    base({
      message: str(raw.trigger_name ?? raw.subject ?? raw.name ?? raw.event_name) ?? "رویداد Zabbix",
      description: cut(str(raw.message ?? raw.trigger_description ?? raw.operational_data), 4000),
      node: host,
      resource: str(raw.item_key ?? raw.item_name),
      metric: str(raw.item_name ?? raw.trigger_name),
      severity: mapSeverity(raw.severity ?? raw.trigger_severity ?? raw.event_severity, sevMap, mapSeverity(spec.default_severity, null)),
      status,
      occurred_at: when,
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 20).map((t: any) => cut(isObj(t) ? `${t.tag}=${t.value ?? ""}` : String(t), 60)!) : typeof raw.tags === "string" ? raw.tags.split(/[,،]/).map((t: string) => t.trim()).filter(Boolean).slice(0, 20) : [],
      value: num(raw.item_value ?? raw.item_lastvalue),
      fingerprint_hint: trigger ? `zabbix:${trigger}` : null,
      dedupe_hint: eventId ? `${eventId}:${status}` : null,
      ci_hint: str(raw.ci),
      service_hint: str(raw.service),
    }, spec, p),
  ];
}

const NAGIOS_STATE: Record<string, [EventStatus, Severity | null]> = {
  OK: ["resolved", null], UP: ["resolved", null], WARNING: ["firing", "warning"], CRITICAL: ["firing", "critical"],
  UNKNOWN: ["firing", "minor"], DOWN: ["firing", "critical"], UNREACHABLE: ["firing", "major"],
};

function nagios(p: Record<string, any>, spec: SourceSpec, sevMap: Record<string, unknown> | null, kind: string): Normalized {
  const raw = isObj(p.check_result) ? { ...p, ...p.check_result } : p;
  const type = str(raw.notification_type ?? raw.type)?.toUpperCase() ?? null;
  if (type && /ACKNOWLEDGEMENT|DOWNTIME|CUSTOM|FLAPPING(STOP|DISABLED)/.test(type)) return { events: [], skipped: "اعلان تأیید یا زمان خاموشی؛ رویدادی ثبت نشد" };
  const host = str(raw.host_name ?? raw.hostname ?? raw.host ?? raw.HOSTNAME);
  const service = str(raw.service_name ?? raw.service_desc ?? raw.service_description ?? raw.service ?? raw.SERVICEDESC);
  const stateRaw = str(raw.service_state ?? raw.state ?? raw.host_state ?? raw.SERVICESTATE ?? raw.HOSTSTATE);
  const state = stateRaw ? stateRaw.toUpperCase() : null;
  const known = state && NAGIOS_STATE[state] ? NAGIOS_STATE[state] : null;
  const status: EventStatus = type === "RECOVERY" ? "resolved" : known ? known[0] : statusOf(stateRaw);
  const severity = known?.[1] ? mapSeverity(state, sevMap, known[1]) : mapSeverity(state, sevMap, mapSeverity(spec.default_severity, null));
  const output = str(raw.output ?? raw.service_output ?? raw.plugin_output ?? raw.host_output ?? raw.SERVICEOUTPUT);
  return {
    events: [
      base({
        message: service ? `${service} روی ${host ?? "?"}: ${state ?? ""}`.trim() : `${host ?? "میزبان"}: ${state ?? ""}`.trim(),
        description: cut(output ?? str(raw.long_output), 4000),
        node: host,
        resource: service,
        metric: service ?? "host-check",
        severity,
        status,
        occurred_at: iso(raw.timestamp ?? raw.long_date_time ?? raw.LONGDATETIME),
        tags: [`${kind}`],
        fingerprint_hint: `${kind}:${(host ?? "").toLowerCase()}/${(service ?? "host").toLowerCase()}`,
        dedupe_hint: str(raw.notification_id ?? raw.id),
      }, spec, p),
    ],
  };
}

const AZURE_SEV: Record<string, Severity> = { sev0: "critical", sev1: "major", sev2: "minor", sev3: "warning", sev4: "info" };

function azure(p: Record<string, any>, spec: SourceSpec, sevMap: Record<string, unknown> | null): NormalizedEvent[] {
  const e = p.data?.essentials ?? p.essentials ?? {};
  const ctx = p.data?.alertContext ?? {};
  const condition = String(e.monitorCondition ?? "Fired");
  const status: EventStatus = /resolved/i.test(condition) ? "resolved" : "firing";
  const target = Array.isArray(e.alertTargetIDs) ? str(e.alertTargetIDs[0]) : null;
  const ci = Array.isArray(e.configurationItems) ? str(e.configurationItems[0]) : null;
  const metric = str(ctx?.condition?.allOf?.[0]?.metricName) ?? str(e.signalType);
  const sevKey = String(e.severity ?? "").toLowerCase();
  const id = str(e.originAlertId) ?? str(e.alertId);
  return [
    base({
      message: str(e.alertRule) ?? "هشدار Azure Monitor",
      description: cut(str(e.description) ?? str(ctx?.condition?.allOf?.[0]?.metricValue !== undefined ? `${metric}: ${ctx.condition.allOf[0].metricValue}` : null), 4000),
      node: ci ?? (target ? target.split("/").filter(Boolean).pop() ?? null : null),
      resource: target,
      metric,
      severity: mapSeverity(e.severity, sevMap, AZURE_SEV[sevKey] ?? mapSeverity(spec.default_severity, null)),
      status,
      occurred_at: iso(status === "resolved" ? e.resolvedDateTime ?? e.firedDateTime : e.firedDateTime),
      tags: [str(e.monitoringService), str(e.signalType)].filter((x): x is string => !!x).map((x) => cut(x, 60)!),
      value: num(ctx?.condition?.allOf?.[0]?.metricValue),
      fingerprint_hint: id ? `azure:${id}` : null,
      dedupe_hint: str(e.alertId) ? `${e.alertId}:${condition}` : null,
      ci_hint: target,
    }, spec, p),
  ];
}

function cloudwatch(p: Record<string, any>, spec: SourceSpec, sevMap: Record<string, unknown> | null): Normalized {
  const type = str(p.Type);
  if (type === "SubscriptionConfirmation" || type === "UnsubscribeConfirmation") return { events: [], confirm_url: type === "SubscriptionConfirmation" ? str(p.SubscribeURL) : null, skipped: "تأیید اشتراک SNS" };
  let m: any = p;
  if (type === "Notification") {
    try {
      m = typeof p.Message === "string" ? JSON.parse(p.Message) : p.Message;
    } catch {
      m = { AlarmName: str(p.Subject) ?? "پیام SNS", NewStateReason: str(p.Message) };
    }
  }
  if (!isObj(m)) return { events: [] };
  const state = String(m.NewStateValue ?? "ALARM").toUpperCase();
  const dims = Array.isArray(m.Trigger?.Dimensions) ? m.Trigger.Dimensions : [];
  const dim = dims[0] ? str(dims[0].value ?? dims[0].Value) : null;
  return {
    events: [
      base({
        message: str(m.AlarmName) ?? "هشدار CloudWatch",
        description: cut(str(m.NewStateReason) ?? str(m.AlarmDescription), 4000),
        node: dim,
        resource: str(m.Trigger?.Namespace) ? `${m.Trigger.Namespace}${dim ? `/${dim}` : ""}` : null,
        metric: str(m.Trigger?.MetricName),
        severity: mapSeverity(m.AlarmName && sevMap ? Object.keys(sevMap).find((k) => String(m.AlarmName).toLowerCase().includes(k.toLowerCase())) : null, sevMap, state === "INSUFFICIENT_DATA" ? "warning" : mapSeverity(spec.default_severity, null)),
        status: state === "OK" ? "resolved" : "firing",
        occurred_at: iso(m.StateChangeTime ?? p.Timestamp),
        tags: [str(m.Region), state === "INSUFFICIENT_DATA" ? "insufficient_data" : null].filter((x): x is string => !!x),
        fingerprint_hint: `cloudwatch:${str(m.AlarmArn) ?? str(m.AlarmName) ?? "alarm"}`,
        dedupe_hint: str(p.MessageId),
        ci_hint: dim,
      }, spec, p),
    ],
  };
}

function email(p: Record<string, any>, spec: SourceSpec, sevMap: Record<string, unknown> | null): NormalizedEvent[] {
  const mapping = spec.mapping ?? {};
  const subject = str(p.subject ?? p.Subject) ?? "";
  const text = str(p.text ?? p.body ?? p.plain ?? p["body-plain"]) ?? "";
  const found = { ...(matchPattern(mapping.body_regex, text) ?? {}), ...(matchPattern(mapping.subject_regex, subject) ?? {}) };
  const statusWord = found.status ?? (/(resolved|recovery|recovered|\bok\b|رفع شد)/i.test(subject) ? "resolved" : null);
  return [
    base({
      message: found.message ?? (subject || "ایمیل پایش"),
      description: cut(text, 4000),
      node: found.node ?? null,
      resource: found.resource ?? null,
      metric: found.metric ?? null,
      severity: mapSeverity(found.severity, sevMap, mapSeverity(spec.default_severity, null)),
      status: statusOf(statusWord),
      occurred_at: iso(p.date ?? p.Date),
      fingerprint_hint: found.key ? `email:${found.key}` : null,
      dedupe_hint: str(p.message_id ?? p["Message-Id"] ?? p.messageId),
      ci_hint: found.ci ?? null,
    }, spec, { from: p.from ?? null, subject, text: cut(text, MAX_STRING) }),
  ];
}

const GENERIC_DEFAULTS: Record<string, string[]> = {
  message: ["message", "title", "summary", "name", "subject", "msg"],
  description: ["description", "details", "detail", "body", "text"],
  node: ["node", "host", "hostname", "host_name", "server", "device"],
  resource: ["resource", "component", "object", "instance"],
  metric: ["metric", "check", "check_name", "type", "event_type"],
  severity: ["severity", "level", "priority", "sev"],
  status: ["status", "state"],
  occurred_at: ["occurred_at", "timestamp", "time", "date", "created_at"],
  tags: ["tags", "labels"],
  value: ["value", "metric_value"],
  fingerprint: ["fingerprint", "alias", "alert_key", "dedup_key"],
  dedupe_key: ["dedupe_key", "event_id", "id"],
  ci: ["ci", "ci_id", "cmdb_ci"],
  service: ["service", "service_name"],
};

function pick(item: unknown, mapping: Record<string, unknown>, key: string): unknown {
  if (mapping[key] !== undefined && mapping[key] !== null && mapping[key] !== "") return readPath(item, mapping[key]);
  if (!isObj(item)) return undefined;
  for (const k of GENERIC_DEFAULTS[key] ?? []) if (item[k] !== undefined && item[k] !== null && item[k] !== "") return item[k];
  return undefined;
}

function generic(p: unknown, spec: SourceSpec, sevMap: Record<string, unknown> | null): NormalizedEvent[] {
  const mapping = isObj(spec.mapping) ? spec.mapping : {};
  const listAt = mapping.events !== undefined ? readPath(p, mapping.events) : Array.isArray(p) ? p : isObj(p) && Array.isArray(p.events) ? p.events : isObj(p) && Array.isArray(p.alerts) ? p.alerts : [p];
  const items = (Array.isArray(listAt) ? listAt : [listAt]).filter((x) => x !== undefined && x !== null).slice(0, 500);
  return items.map((item) => {
    const tagsRaw = pick(item, mapping, "tags");
    const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => cut(str(t), 60)).filter((t): t is string => !!t).slice(0, 20) : isObj(tagsRaw) ? labelTags(tagsRaw) : typeof tagsRaw === "string" ? tagsRaw.split(/[,،]/).map((t) => t.trim()).filter(Boolean).slice(0, 20) : [];
    const fp = str(pick(item, mapping, "fingerprint"));
    return base({
      message: str(pick(item, mapping, "message")) ?? "رویداد",
      description: cut(str(pick(item, mapping, "description")), 4000),
      node: cut(str(pick(item, mapping, "node")), 255),
      resource: cut(str(pick(item, mapping, "resource")), 255),
      metric: cut(str(pick(item, mapping, "metric")), 255),
      severity: mapSeverity(pick(item, mapping, "severity"), sevMap, mapSeverity(spec.default_severity, null)),
      status: statusOf(pick(item, mapping, "status")),
      occurred_at: iso(pick(item, mapping, "occurred_at")),
      tags,
      value: num(pick(item, mapping, "value")),
      fingerprint_hint: fp ? `generic:${fp}` : null,
      dedupe_hint: cut(str(pick(item, mapping, "dedupe_key")), 200),
      ci_hint: cut(str(pick(item, mapping, "ci")), 255),
      service_hint: cut(str(pick(item, mapping, "service")), 255),
    }, spec, item);
  });
}

/** Turn one delivery of a source into events in the common shape. */
export function normalize(spec: SourceSpec, payload: unknown): Normalized {
  const sevMap = isObj(spec.severity_map) ? (spec.severity_map as Record<string, unknown>) : null;
  const p = payload;
  switch (spec.kind) {
    case "alertmanager":
      return { events: isObj(p) ? alertmanagerLike(p, spec, sevMap, "alertmanager") : [] };
    case "grafana":
      if (isObj(p) && Array.isArray(p.alerts)) return { events: alertmanagerLike(p, spec, sevMap, "grafana") };
      return { events: isObj(p) ? grafanaLegacy(p, spec, sevMap) : [] };
    case "zabbix":
      return { events: isObj(p) ? zabbix(p, spec, sevMap) : [] };
    case "nagios":
    case "icinga":
      return isObj(p) ? nagios(p, spec, sevMap, spec.kind) : { events: [] };
    case "azure_monitor":
      return { events: isObj(p) ? azure(p, spec, sevMap) : [] };
    case "cloudwatch":
      return isObj(p) ? cloudwatch(p, spec, sevMap) : { events: [] };
    case "email":
      return { events: isObj(p) ? email(p, spec, sevMap) : [] };
    default:
      return { events: generic(p, spec, sevMap) };
  }
}

/** Is an SNS confirmation URL one of Amazon's (the only host the server visits for it)? */
export const isSnsUrl = (u: unknown): boolean => typeof u === "string" && /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/\?/.test(u) && u.length < 2000;

/** The fingerprint of an event of a source: the tool's own key, else node + resource + metric. */
export function fingerprintOf(sourceId: string, e: Pick<NormalizedEvent, "fingerprint_hint" | "node" | "resource" | "metric" | "message">): string {
  if (e.fingerprint_hint) return `fp_${shortHash(`${sourceId}|${e.fingerprint_hint}`)}`;
  const parts = [e.node, e.resource, e.metric].map((x) => String(x ?? "").trim().toLowerCase());
  // nothing to tell events apart: the message is the key
  if (parts.every((x) => !x)) parts.push(e.message.trim().toLowerCase());
  return `fp_${shortHash(`${sourceId}|${parts.join("|")}`)}`;
}

/** The candidate names of a node for CI binding: as given, lower case, short host name, without the port. */
export function nodeCandidates(node: unknown): string[] {
  const s = str(node);
  if (!s) return [];
  const bare = s.replace(/:\d+$/, "");
  const out = new Set([s, bare, bare.toLowerCase(), bare.split(".")[0], bare.split(".")[0].toLowerCase()]);
  return [...out].filter((x) => x.length > 0 && x.length <= 255).slice(0, 6);
}

// ---------------------------------------------------------------------------------------------------------------
// Flapping and noise

/** Record a fire/clear flip at `now` and tell whether the alert flaps (≥ threshold flips inside the window). */
export function flapState(flips: unknown, now: number, windowMs: number, threshold: number): { flips: number[]; flapping: boolean } {
  const kept = (Array.isArray(flips) ? flips : []).map(Number).filter((t) => Number.isFinite(t) && now - t <= windowMs);
  kept.push(now);
  const recent = kept.slice(-50);
  return { flips: recent, flapping: recent.length >= Math.max(2, threshold) };
}

export interface NoiseInput {
  acknowledged: boolean;
  incident: boolean;
  flapCount: number;
  reopenCount: number;
  openedMs: number | null;
  clearedMs: number | null;
  transientSeconds: number;
  closeCode?: string | null;
}

/** The noise label of an alert and its reason (rule-based, catalogue EVT-013). */
export function noiseLabel(a: NoiseInput): { label: "signal" | "likely_noise" | "noise"; reason: string } {
  if (a.incident) return { label: "signal", reason: "به رخداد انجامید" };
  if (a.closeCode === "no_action") return { label: "noise", reason: "با «بی‌نیاز به اقدام» بسته شد" };
  if (a.flapCount >= 2) return { label: "noise", reason: `نوسان (${a.flapCount} بار)` };
  if (a.acknowledged) return { label: "signal", reason: "کسی آن را تأیید کرد" };
  if (a.openedMs !== null && a.clearedMs !== null && a.transientSeconds > 0 && a.clearedMs - a.openedMs <= a.transientSeconds * 1000) {
    return { label: "likely_noise", reason: "گذرا: بی‌تأیید و زود رفع شد" };
  }
  if (a.reopenCount >= 3) return { label: "likely_noise", reason: `بارها بازگشایی شد (${a.reopenCount})` };
  if (a.clearedMs !== null) return { label: "likely_noise", reason: "بی‌تأیید رفع شد" };
  return { label: "signal", reason: "باز و بی‌پاسخ" };
}

// ---------------------------------------------------------------------------------------------------------------
// Thresholds

/** A threshold rule holds back events until `count` events of one fingerprint arrived within `minutes`. */
export function thresholdReached(times: number[], now: number, count: number, minutes: number): boolean {
  const from = now - minutes * 60_000;
  return times.filter((t) => t >= from && t <= now).length >= Math.max(1, count);
}

// ---------------------------------------------------------------------------------------------------------------
// Correlation

export interface CorrAlert {
  id: string;
  number?: string | null;
  short_description?: string | null;
  severity?: string | null;
  state?: string | null;
  source_id?: string | null;
  node?: string | null;
  resource?: string | null;
  metric?: string | null;
  ci_id?: string | null;
  service_id?: string | null;
  assignment_group_id?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
}

/** The correlation key of an alert under a rule kind (null: the rule cannot group it). */
export function corrKey(kind: string, a: CorrAlert, fields: string[] = []): string | null {
  switch (kind) {
    case "ci":
      return a.ci_id ? `ci:${a.ci_id}` : a.node ? `node:${a.node.toLowerCase()}` : null;
    case "service":
      return a.service_id ? `svc:${a.service_id}` : null;
    case "fields": {
      const names = fields.length ? fields : ["node"];
      const vals = names.map((f) => String((a as Record<string, unknown>)[f] ?? "").trim().toLowerCase());
      if (vals.every((v) => !v)) return null;
      return `f:${names.join(",")}:${shortHash(vals.join("|"))}`;
    }
    default:
      return null;
  }
}

/** The group's title: «۳ هشدار روی db01» / «… در خدمت پرداخت». */
export function groupTitle(reason: string, count: number, about: { ci?: string | null; service?: string | null; node?: string | null; first?: string | null }): string {
  const n = count.toLocaleString("fa-IR");
  if (reason === "topology" && about.ci) return `${n} هشدار در پیکربندی‌های وابسته به «${about.ci}»`;
  if ((reason === "ci" || reason === "topology") && (about.ci || about.node)) return `${n} هشدار روی «${about.ci ?? about.node}»`;
  if (reason === "service" && about.service) return `${n} هشدار در خدمت «${about.service}»`;
  return `${n} هشدار هم‌زمان${about.first ? `: ${about.first}` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Probable causes (catalogue EVT-015: deterministic ranking; a model only narrates)

export interface CauseAlert {
  id: string;
  number: string | null;
  title: string;
  ci_id: string | null;
  ci_name: string | null;
  severity: string;
  first_seen_ms: number;
  /** how many other alerts of the group sit on CIs that depend on this alert's CI */
  dependents: number;
}

export interface CauseChange {
  id: string;
  number: string | null;
  title: string;
  /** when it was implemented (or its planned start when it is running) */
  at_ms: number;
  /** it touches a CI of the group (true) or one they depend on */
  on_group_ci: boolean;
}

export interface Cause {
  kind: "alert" | "change";
  id: string;
  number: string | null;
  title: string;
  score: number;
  evidence: string[];
}

const fmtMin = (ms: number) => `${Math.max(0, Math.round(ms / 60_000)).toLocaleString("fa-IR")} دقیقه`;

/**
 * Rank the probable causes of a group: alerts by temporal precedence, upstream position (other alerts depend on
 * their CI) and severity; changes by proximity (implemented shortly before the first alert on a CI of the group).
 * Returns at most `limit` candidates, best first, each with its evidence in Persian.
 */
export function rankCauses(alerts: CauseAlert[], changes: CauseChange[], limit = 3): Cause[] {
  if (!alerts.length) return [];
  const first = Math.min(...alerts.map((a) => a.first_seen_ms));
  const last = Math.max(...alerts.map((a) => a.first_seen_ms));
  const span = Math.max(1, last - first);
  const others = Math.max(1, alerts.length - 1);
  const out: Cause[] = alerts.map((a) => {
    const evidence: string[] = [];
    const early = 1 - (a.first_seen_ms - first) / span;
    let score = 0.35 * (alerts.length > 1 ? early : 1);
    if (a.first_seen_ms === first && alerts.length > 1) evidence.push("نخستین هشدار گروه");
    else if (alerts.length > 1) evidence.push(`${fmtMin(a.first_seen_ms - first)} پس از نخستین هشدار`);
    if (a.dependents > 0) {
      score += 0.4 * Math.min(1, a.dependents / others);
      evidence.push(`${a.dependents.toLocaleString("fa-IR")} هشدار دیگر روی پیکربندی‌های وابسته به آن`);
    }
    score += 0.25 * (1 - severityRank(a.severity) / 4);
    if (a.ci_name) evidence.push(`پیکربندی «${a.ci_name}»`);
    return { kind: "alert" as const, id: a.id, number: a.number, title: a.title, score: Math.round(score * 1000) / 1000, evidence };
  });
  for (const c of changes) {
    const before = first - c.at_ms;
    if (before < -15 * 60_000 || before > 24 * 3600_000) continue;
    const proximity = before <= 0 ? 1 : 1 - Math.min(1, before / (24 * 3600_000));
    const score = 0.45 * proximity + (c.on_group_ci ? 0.35 : 0.15);
    const evidence = [before >= 0 ? `${fmtMin(before)} پیش از نخستین هشدار اجرا شد` : "هم‌زمان با هشدارها در اجرا بود", c.on_group_ci ? "روی پیکربندی‌های همین گروه" : "روی پیکربندی‌ای که گروه به آن وابسته است"];
    out.push({ kind: "change", id: c.id, number: c.number, title: c.title, score: Math.round(score * 1000) / 1000, evidence });
  }
  return out.sort((a, b) => b.score - a.score || (a.number ?? "").localeCompare(b.number ?? "")).slice(0, limit);
}

/** A rule-based summary of a correlated group (Markdown, Persian) — the AI skill's fallback and the group's text. */
export function groupSummary(g: { title: string; alerts: { number: string | null; title: string; severity: string; state: string; ci_name: string | null }[]; services: string[]; causes: Cause[] }): string {
  const bySev = new Map<string, number>();
  for (const a of g.alerts) bySev.set(a.severity, (bySev.get(a.severity) ?? 0) + 1);
  const sevLabel: Record<string, string> = { critical: "بحرانی", major: "شدید", minor: "متوسط", warning: "اخطار", info: "اطلاعی" };
  const sev = SEVERITY_ORDER.filter((s) => bySev.has(s)).map((s) => `${bySev.get(s)!.toLocaleString("fa-IR")} ${sevLabel[s]}`).join("، ");
  const open = g.alerts.filter((a) => ["open", "acknowledged", "flapping", "snoozed", "maintenance"].includes(a.state)).length;
  const cis = [...new Set(g.alerts.map((a) => a.ci_name).filter((x): x is string => !!x))];
  const lines = [
    `**${g.title}** — ${g.alerts.length.toLocaleString("fa-IR")} هشدار (${sev})، ${open.toLocaleString("fa-IR")} باز.`,
    cis.length ? `پیکربندی‌ها: ${cis.slice(0, 6).join("، ")}${cis.length > 6 ? " و …" : ""}.` : "",
    g.services.length ? `خدمت‌های متأثر: ${g.services.slice(0, 6).join("، ")}.` : "",
  ].filter(Boolean);
  if (g.causes.length) {
    lines.push("", "علت‌های محتمل (از قاعده‌ها، نه قطعی):");
    for (const [i, c] of g.causes.entries()) lines.push(`${(i + 1).toLocaleString("fa-IR")}. ${c.kind === "change" ? "تغییر" : "هشدار"} ${c.number ?? ""} «${c.title}» — ${c.evidence.join("؛ ")}`);
  } else lines.push("", "شواهد کافی برای علت محتمل نیست.");
  return lines.join("\n");
}

/** Mean and percentile helpers of the reports (milliseconds; null for no data). */
export function stats(values: number[]): { avg: number | null; median: number | null; p90: number | null; count: number } {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return { avg: null, median: null, p90: null, count: 0 };
  const at = (q: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
  return { avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), median: at(0.5), p90: at(0.9), count: v.length };
}
