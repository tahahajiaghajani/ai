// The notification service's shared vocabulary (docs/spec/services/notify.md): events a rule listens to, channels,
// recipient kinds, inbox kinds, preference helpers (opt-outs, quiet hours, digests), webhook/SMS channel kinds with
// the SMS gateway presets, and the template language — `{{field}}`, `{{field.display}}`, `{{link}}`,
// `{{record.number}}`, `{{#if …}}…{{else}}…{{/if}}` — parsed and rendered here so the server and the editors agree.
// Imported by the UI: keep it free of server imports.

// ----- events ---------------------------------------------------------------------------------------------------

export type NotifyEvent =
  | "created" | "updated" | "state_changed" | "assigned" | "commented" | "mentioned"
  | "sla_warning" | "sla_breach" | "approval_requested" | "approval_decided" | "custom";

/** Every event a rule may listen to, with the record events (engine kinds) that raise it. */
export const NOTIFY_EVENTS: Record<NotifyEvent, { label: string; kinds: string[]; hint?: string }> = {
  created: { label: "ثبت رکورد", kinds: ["record.created"] },
  updated: { label: "تغییر رکورد", kinds: ["record.updated"] },
  state_changed: { label: "تغییر وضعیت", kinds: ["record.state_changed"] },
  assigned: { label: "ارجاع", kinds: ["record.assigned"] },
  commented: { label: "پاسخ یا یادداشت تازه", kinds: ["record.commented"] },
  mentioned: { label: "نام بردن از کسی (@)", kinds: ["record.commented"] },
  sla_warning: { label: "هشدار توافق سطح خدمت", kinds: ["record.sla_warning", "record.sla_warned"] },
  sla_breach: { label: "نقض توافق سطح خدمت", kinds: ["record.sla_breach", "record.sla_breached"] },
  approval_requested: { label: "درخواست تأیید", kinds: ["record.approval_requested"] },
  approval_decided: { label: "تصمیم تأیید", kinds: ["record.approval_decided"] },
  custom: { label: "رویداد سفارشی", kinds: [] },
};

export const NOTIFY_EVENT_KEYS = Object.keys(NOTIFY_EVENTS) as NotifyEvent[];

/** The engine kind of a custom event name («major_declared» → «record.major_declared»). */
export const customKind = (name: string): string => (name.startsWith("record.") ? name : `record.${name}`);

/** The notification events a record event raises (`custom` rules are matched by name separately). */
export function eventsOf(kind: string): NotifyEvent[] {
  const out: NotifyEvent[] = [];
  for (const k of NOTIFY_EVENT_KEYS) if (NOTIFY_EVENTS[k].kinds.includes(kind)) out.push(k);
  return out;
}

// ----- channels and recipients ----------------------------------------------------------------------------------

export type NotifyChannel = "in_app" | "email" | "sms" | "webhook";
export const NOTIFY_CHANNELS: Record<NotifyChannel, { label: string; personal: boolean }> = {
  in_app: { label: "درون برنامه", personal: true },
  email: { label: "ایمیل", personal: true },
  sms: { label: "پیامک", personal: true },
  webhook: { label: "پیام‌رسان و وب‌هوک", personal: false },
};
/** Channels a person can switch off for themselves (webhooks post to shared channels). */
export const PERSONAL_CHANNELS: NotifyChannel[] = ["in_app", "email", "sms"];

/** What a rule's `recipients` JSON holds. */
export interface RecipientSpec {
  assignee?: boolean;
  assignment_group?: boolean;
  group_manager?: boolean;
  requester?: boolean;
  watchers?: boolean;
  assignee_manager?: boolean;
  requester_manager?: boolean;
  oncall?: boolean;
  mentioned?: boolean;
  /** people the event names (`data.users`, e.g. the approvers of an approval request) */
  event_users?: boolean;
  /** user, users and group fields of the record */
  fields?: string[];
  users?: string[];
  groups?: string[];
  roles?: string[];
}

export type RecipientFlag = Exclude<keyof RecipientSpec, "fields" | "users" | "groups" | "roles">;
export const RECIPIENT_FLAGS: Record<RecipientFlag, string> = {
  assignee: "کارشناس رکورد",
  assignment_group: "اعضای گروه پشتیبانی",
  group_manager: "مدیر گروه پشتیبانی",
  requester: "درخواست‌کننده",
  watchers: "پیگیری‌کنندگان",
  assignee_manager: "مدیر کارشناس",
  requester_manager: "مدیر درخواست‌کننده",
  oncall: "کشیک گروه پشتیبانی",
  mentioned: "کسانی که از آنها نام برده شده",
  event_users: "افراد نام‌برده در رویداد (مثلاً تأییدکنندگان)",
};

/** A recipient spec from untrusted JSON: known keys only, uuids lower-cased, lists bounded. */
export function cleanRecipients(raw: unknown): RecipientSpec {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: RecipientSpec = {};
  for (const k of Object.keys(RECIPIENT_FLAGS) as RecipientFlag[]) if (o[k] === true) out[k] = true;
  const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase()).filter((x) => UUID.test(x)))].slice(0, 200);
  const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => /^[a-z][a-z0-9_]{0,62}$/.test(x)))].slice(0, 50);
  if (Array.isArray(o.fields) && o.fields.length) out.fields = names(o.fields);
  if (Array.isArray(o.users) && o.users.length) out.users = ids(o.users);
  if (Array.isArray(o.groups) && o.groups.length) out.groups = ids(o.groups);
  if (Array.isArray(o.roles) && o.roles.length) out.roles = names(o.roles);
  return out;
}

export const hasRecipients = (r: RecipientSpec): boolean =>
  (Object.keys(RECIPIENT_FLAGS) as RecipientFlag[]).some((k) => r[k]) || !!(r.fields?.length || r.users?.length || r.groups?.length || r.roles?.length);

/** Why a person got an inbox item — the notification center's tabs. */
export type InboxKind = "direct" | "watching" | "approval" | "sla" | "system";
export const INBOX_KINDS: Record<InboxKind, string> = {
  direct: "مستقیم",
  watching: "دنبال‌شده",
  approval: "تأییدها",
  sla: "توافق سطح خدمت",
  system: "سامانه",
};

/** The reasons that make an item «direct» (the person is on the record, or was named). */
const DIRECT_REASONS = new Set(["assignee", "requester", "mentioned", "users", "fields", "event_users", "assignee_manager", "requester_manager", "group_manager"]);

export function inboxKind(event: NotifyEvent, reasons: Iterable<string>): InboxKind {
  if (event === "approval_requested" || event === "approval_decided") return "approval";
  if (event === "sla_warning" || event === "sla_breach") return "sla";
  for (const r of reasons) if (DIRECT_REASONS.has(r)) return "direct";
  return "watching";
}

// ----- preferences ----------------------------------------------------------------------------------------------

export type DigestMode = "none" | "hourly" | "daily";
export const DIGEST_MODES: Record<DigestMode, string> = { none: "بی‌درنگ", hourly: "خلاصهٔ ساعتی", daily: "خلاصهٔ روزانه" };

export interface NotifyPrefs {
  /** `${event}:${channel}` keys switched off; `*` stands for every event */
  optouts: string[];
  digest: DigestMode;
  /** local hour (0–23) of the daily digest */
  digest_hour: number;
  /** "HH:MM" in the organisation's time zone; e-mail and SMS wait until the quiet time ends */
  quiet_from: string | null;
  quiet_to: string | null;
}

export const DEFAULT_PREFS: NotifyPrefs = { optouts: [], digest: "none", digest_hour: 8, quiet_from: null, quiet_to: null };

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export const isHhmm = (s: unknown): s is string => typeof s === "string" && HHMM.test(s.trim());

/** Preferences from a stored row (or nothing): unknown keys dropped, bad values back to their defaults. */
export function cleanPrefs(raw: Record<string, unknown> | null | undefined): NotifyPrefs {
  const r = raw ?? {};
  const optouts = Array.isArray(r.optouts)
    ? [...new Set(r.optouts.map(String).filter((k) => /^(\*|[a-z_]{2,40}):(in_app|email|sms)$/.test(k)))].slice(0, 100)
    : [];
  const digest = r.digest === "hourly" || r.digest === "daily" ? r.digest : "none";
  const hour = Number(r.digest_hour);
  return {
    optouts,
    digest,
    digest_hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8,
    quiet_from: isHhmm(r.quiet_from) ? r.quiet_from.trim().padStart(5, "0") : null,
    quiet_to: isHhmm(r.quiet_to) ? r.quiet_to.trim().padStart(5, "0") : null,
  };
}

/** Has the person switched this event off on this channel? */
export function optedOut(prefs: NotifyPrefs, event: NotifyEvent, channel: NotifyChannel): boolean {
  return prefs.optouts.includes(`${event}:${channel}`) || prefs.optouts.includes(`*:${channel}`);
}

/** Minutes since local midnight of an instant in a time zone. */
export function localMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + m;
}

const toMin = (s: string) => {
  const m = HHMM.exec(s)!;
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * When the person's quiet time that contains `at` ends (null when `at` is not inside one). Quiet times may cross
 * midnight («۲۲:۰۰ تا ۰۷:۰۰»). Time-zone offsets are taken at `at` (Asia/Tehran has no daylight saving).
 */
export function quietUntil(prefs: Pick<NotifyPrefs, "quiet_from" | "quiet_to">, at: Date, tz: string): Date | null {
  if (!prefs.quiet_from || !prefs.quiet_to) return null;
  const from = toMin(prefs.quiet_from);
  const to = toMin(prefs.quiet_to);
  if (from === to) return null;
  const now = localMinutes(at, tz);
  const inside = from < to ? now >= from && now < to : now >= from || now < to;
  if (!inside) return null;
  const wait = (to - now + 1440) % 1440 || 1440;
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000 + wait * 60_000);
}

/** The next digest time after `at`: the next full hour, or the next `hour`:00 local time. */
export function nextDigestAt(mode: DigestMode, at: Date, tz: string, hour = 8): Date {
  const minute = Math.floor(at.getTime() / 60_000) * 60_000;
  const now = localMinutes(at, tz);
  if (mode === "hourly") return new Date(minute + (60 - (now % 60)) * 60_000);
  const wait = (hour * 60 - now + 1440) % 1440 || 1440;
  return new Date(minute + wait * 60_000);
}

// ----- outside channels -----------------------------------------------------------------------------------------

export type ChannelKind = "slack" | "teams" | "mattermost" | "telegram" | "bale" | "webhook" | "sms";
export const CHANNEL_KINDS: Record<ChannelKind, { label: string; needs: ("endpoint" | "token" | "chat_id" | "sms_url")[] }> = {
  slack: { label: "اسلک (Slack)", needs: ["endpoint"] },
  teams: { label: "مایکروسافت تیمز (Teams)", needs: ["endpoint"] },
  mattermost: { label: "مترموست (Mattermost)", needs: ["endpoint"] },
  telegram: { label: "تلگرام", needs: ["token", "chat_id"] },
  bale: { label: "بله", needs: ["token", "chat_id"] },
  webhook: { label: "وب‌هوک JSON", needs: ["endpoint"] },
  sms: { label: "درگاه پیامک (HTTP)", needs: ["sms_url"] },
};

/**
 * Starting points for the generic SMS gateway (the admin form fills these in; every field stays editable).
 * Placeholders: {{to}} the mobile number, {{text}} the message, {{sender}} the sender line, {{token}} the API key.
 */
export const SMS_PRESETS: Record<string, { label: string; sms_url: string; sms_method: "GET" | "POST"; sms_content_type: "form" | "json"; sms_body: string; sms_headers?: Record<string, string> }> = {
  kavenegar: {
    label: "کاوه‌نگار",
    sms_url: "https://api.kavenegar.com/v1/{{token}}/sms/send.json",
    sms_method: "POST",
    sms_content_type: "form",
    sms_body: "receptor={{to}}&message={{text}}&sender={{sender}}",
  },
  ghasedak: {
    label: "قاصدک",
    sms_url: "https://api.ghasedak.me/v2/sms/send/simple",
    sms_method: "POST",
    sms_content_type: "form",
    sms_body: "message={{text}}&receptor={{to}}&linenumber={{sender}}",
    sms_headers: { apikey: "{{token}}" },
  },
  generic_json: {
    label: "JSON عمومی",
    sms_url: "https://sms.example.com/api/send",
    sms_method: "POST",
    sms_content_type: "json",
    sms_body: '{"to":"{{to}}","text":"{{text}}","from":"{{sender}}"}',
    sms_headers: { Authorization: "Bearer {{token}}" },
  },
};

/** An Iranian mobile number in international form (`989121234567`), or null. */
export function normalizeMobile(raw: string | null | undefined): string | null {
  const d = String(raw ?? "")
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[^\d+]/g, "");
  if (/^(\+98|0098|98)9\d{9}$/.test(d)) return `98${d.slice(-10)}`;
  if (/^09\d{9}$/.test(d)) return `98${d.slice(1)}`;
  if (/^9\d{9}$/.test(d)) return `98${d}`;
  if (/^\+?\d{8,15}$/.test(d)) return d.replace(/^\+/, "");
  return null;
}

/** SMS segments of a text: 70 characters (UCS-2) for Persian, 160 for plain GSM text; 67/153 when concatenated. */
export function smsSegments(text: string): number {
  const unicode = /[^\u0000-\u007f]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const n = [...text].length;
  return n <= single ? 1 : Math.ceil(n / multi);
}

// ----- addresses ------------------------------------------------------------------------------------------------

/**
 * Does an e-mail address match a list of addresses and domains? Entries: `ali@example.com`, `@example.com` or
 * `example.com` (the domain and its sub-domains).
 */
export function addressMatches(address: string, list: string[]): boolean {
  const a = address.trim().toLowerCase();
  const domain = a.split("@")[1] ?? "";
  for (const raw of list) {
    const e = String(raw).trim().toLowerCase();
    if (!e) continue;
    if (e.includes("@") && !e.startsWith("@")) {
      if (a === e) return true;
      continue;
    }
    const d = e.replace(/^@/, "");
    if (domain === d || domain.endsWith(`.${d}`)) return true;
  }
  return false;
}

/** The record number token in a subject: «[TODO0000012]» → "TODO0000012". */
export function subjectNumbers(subject: string): string[] {
  const out: string[] = [];
  for (const m of subject.matchAll(/\[([A-Z][A-Z0-9_-]{0,11}\d{1,12})\]/g)) out.push(m[1]);
  return out;
}

// ----- the template language ------------------------------------------------------------------------------------

export type TplNode =
  | { t: "text"; v: string }
  | { t: "var"; path: string }
  | { t: "if"; path: string; op: "truthy" | "eq" | "ne"; value: string; neg: boolean; then: TplNode[]; else: TplNode[] };

export interface ParsedTemplate {
  nodes: TplNode[];
  /** Persian description of the first problem (the nodes then hold what could be read) */
  error: string | null;
}

const PATH = /^[a-z_][a-z0-9_]*(\.[a-z0-9_]+){0,3}$/;
const TAG = /\{\{\s*([^{}]*?)\s*\}\}/g;

function parseExpr(expr: string): { path: string; op: "truthy" | "eq" | "ne"; value: string } | null {
  const m = /^([a-z0-9_.]+)\s*(?:(==|!=)\s*(?:"([^"]*)"|'([^']*)'|«([^»]*)»|([^\s"'«»]+)))?$/.exec(expr.trim());
  if (!m || !PATH.test(m[1])) return null;
  if (!m[2]) return { path: m[1], op: "truthy", value: "" };
  return { path: m[1], op: m[2] === "==" ? "eq" : "ne", value: m[3] ?? m[4] ?? m[5] ?? m[6] ?? "" };
}

/** Parse a template; a problem is reported in Persian (unknown tags, unclosed or unmatched blocks). */
export function parseTemplate(src: string | null | undefined): ParsedTemplate {
  const text = String(src ?? "");
  const root: TplNode[] = [];
  type Frame = { node: Extract<TplNode, { t: "if" }>; kind: "if" | "unless"; inElse: boolean; parent: TplNode[] };
  const stack: Frame[] = [];
  let out = root;
  let error: string | null = null;
  let last = 0;
  const push = (n: TplNode) => {
    const prev = out[out.length - 1];
    if (n.t === "text" && prev?.t === "text") prev.v += n.v;
    else out.push(n);
  };
  for (const m of text.matchAll(TAG)) {
    if (m.index! > last) push({ t: "text", v: text.slice(last, m.index) });
    last = m.index! + m[0].length;
    const tag = m[1];
    const block = /^#(if|unless)\s+(.+)$/.exec(tag);
    if (block) {
      const e = parseExpr(block[2]);
      if (!e) {
        error ??= `شرط «${block[2]}» معتبر نیست`;
        continue;
      }
      const node: Extract<TplNode, { t: "if" }> = { t: "if", path: e.path, op: e.op, value: e.value, neg: block[1] === "unless", then: [], else: [] };
      out.push(node);
      stack.push({ node, kind: block[1] as "if" | "unless", inElse: false, parent: out });
      out = node.then;
      continue;
    }
    if (tag === "else") {
      const f = stack[stack.length - 1];
      if (!f || f.inElse) {
        error ??= "«{{else}}» بیرون از یک بلوک شرطی آمده است";
        continue;
      }
      f.inElse = true;
      out = f.node.else;
      continue;
    }
    const close = /^\/(if|unless)$/.exec(tag);
    if (close) {
      const f = stack.pop();
      if (!f || f.kind !== close[1]) {
        error ??= `«{{/${close[1]}}}» بی‌جفت است`;
        if (f) stack.push(f);
        continue;
      }
      out = f.parent;
      continue;
    }
    if (PATH.test(tag)) {
      push({ t: "var", path: tag });
      continue;
    }
    error ??= `جای‌نگهدار «{{${tag}}}» معتبر نیست`;
    push({ t: "text", v: m[0] });
  }
  if (last < text.length) push({ t: "text", v: text.slice(last) });
  if (stack.length) error ??= `بلوک «{{#${stack[stack.length - 1].kind}}}» بسته نشده است`;
  return { nodes: root, error };
}

/** Every path a template reads (placeholders and conditions). */
export function templatePaths(...srcs: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  const walk = (nodes: TplNode[]) => {
    for (const n of nodes) {
      if (n.t === "var") out.add(n.path);
      else if (n.t === "if") {
        out.add(n.path);
        walk(n.then);
        walk(n.else);
      }
    }
  };
  for (const s of srcs) walk(parseTemplate(s).nodes);
  return [...out];
}

/**
 * What a template is rendered against: the text of a placeholder, the raw value conditions compare, and — for
 * Markdown output — values that already are safe Markdown (the change list, a comment, Markdown fields, the link).
 */
export interface TplScope {
  text(path: string): string;
  raw(path: string): unknown;
  /** safe Markdown of a path, or null to insert its text escaped */
  markdown?(path: string): string | null;
}

const truthy = (v: unknown) => !(v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length));

/**
 * Render parsed nodes. "markdown": inserted values are escaped (a record's title cannot add links or formatting),
 * except what the scope hands over as safe Markdown; "plain": values as they are (subjects, SMS).
 */
export function renderNodes(nodes: TplNode[], scope: TplScope, mode: "markdown" | "plain" = "plain"): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var") out += mode === "markdown" ? scope.markdown?.(n.path) ?? escapeMarkdown(scope.text(n.path)) : scope.text(n.path);
    else {
      const raw = scope.raw(n.path);
      let hit: boolean;
      if (n.op === "truthy") hit = truthy(raw);
      else {
        const vals = Array.isArray(raw) ? raw.map(String) : raw === null || raw === undefined ? [] : [String(raw)];
        const eq = vals.includes(n.value) || scope.text(n.path) === n.value;
        hit = n.op === "eq" ? eq : !eq;
      }
      if (n.neg) hit = !hit;
      out += renderNodes(hit ? n.then : n.else, scope, mode);
    }
  }
  return out;
}

export function renderTemplate(src: string | null | undefined, scope: TplScope, mode: "markdown" | "plain" = "plain"): string {
  return renderNodes(parseTemplate(src).nodes, scope, mode);
}

/**
 * A person's Markdown made safe to relay (comments, descriptions): links become their text and address side by
 * side — no disguised links in a message sent in the organisation's name —, mentions become «@name» and images
 * their description (raw HTML is escaped by every renderer).
 */
export function relayMarkdown(md: string): string {
  return String(md ?? "")
    .replace(/@\[([^\]\n]{1,120})\]\(mention:[0-9a-fA-F-]{36}\)/g, "**@$1**")
    .replace(/!\[([^\]\n]*)\]\(([^)\s]*)[^)]*\)/g, (_m, alt: string) => (alt ? `[${alt}]` : ""))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text: string, url: string) => (text.trim() === url.trim() ? `<${url}>` : `${text} (${url})`));
}

/** Backslash-escape Markdown so a record's values cannot add links, images or formatting to a message. */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/([\\`*_[\]()<>#|~!{}])/g, "\\$1")
    .replace(/^(\s*)([-+>=]|\d+[.)])/gm, "$1\\$2");
}

/** One line of plain text (titles, SMS): whitespace collapsed, Markdown marks of mentions kept readable. */
export function plainLine(s: string, max = 300): string {
  const t = s
    .replace(/@\[([^\]\n]{1,120})\]\(mention:[0-9a-fA-F-]{36}\)/g, "@$1")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Placeholders every template may use, whatever the table (the editor lists them with the table's fields). */
export const COMMON_PLACEHOLDERS: { path: string; label: string }[] = [
  { path: "record.display", label: "شماره و عنوان رکورد" },
  { path: "record.number", label: "شمارهٔ رکورد" },
  { path: "record.title", label: "عنوان رکورد" },
  { path: "record.table", label: "نوع رکورد (مثلاً «کار»)" },
  { path: "link", label: "پیوند رکورد" },
  { path: "event.label", label: "نام رویداد" },
  { path: "event.from", label: "وضعیت پیشین (تغییر وضعیت)" },
  { path: "event.to", label: "وضعیت تازه (تغییر وضعیت)" },
  { path: "changes", label: "فهرست تغییرها" },
  { path: "comment", label: "متن پاسخ یا یادداشت" },
  { path: "actor.name", label: "انجام‌دهنده" },
  { path: "recipient.name", label: "گیرنده" },
  { path: "org.name", label: "نام سازمان" },
  { path: "app.name", label: "نام سامانه" },
];

/** The default subject and body of each event (a rule without a template uses these). */
export const DEFAULT_TEMPLATES: Record<NotifyEvent, { subject: string; body: string; short: string }> = {
  created: {
    subject: "{{record.table}} تازه: {{record.display}}",
    body: "{{actor.name}} «{{record.title}}» را ثبت کرد.\n\n{{#if description}}{{description}}\n\n{{/if}}[مشاهدهٔ {{record.number}}]({{link}})",
    short: "{{record.table}} تازه {{record.number}}: {{record.title}}",
  },
  updated: {
    subject: "تغییر در {{record.display}}",
    body: "{{actor.name}} «{{record.title}}» را تغییر داد.\n\n{{changes}}\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "تغییر در {{record.number}}: {{record.title}}",
  },
  state_changed: {
    subject: "{{record.display}}: {{event.to}}",
    body: "وضعیت «{{record.title}}» از «{{event.from}}» به «{{event.to}}» تغییر کرد.\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "{{record.number}}: {{event.to}}",
  },
  assigned: {
    subject: "ارجاع {{record.display}}",
    body:
      "«{{record.title}}» ارجاع شد.\n\n{{#if assigned_to}}- کارشناس: {{assigned_to.display}}\n{{/if}}{{#if assignment_group_id}}- گروه: {{assignment_group_id.display}}\n{{/if}}\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "ارجاع {{record.number}}: {{record.title}}",
  },
  commented: {
    subject: "پاسخ تازه در {{record.display}}",
    body: "{{actor.name}} در «{{record.title}}» نوشت:\n\n{{comment}}\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "پاسخ تازه در {{record.number}}",
  },
  mentioned: {
    subject: "{{actor.name}} در {{record.display}} از شما نام برد",
    body: "{{actor.name}} در «{{record.title}}» از شما نام برد:\n\n{{comment}}\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "{{actor.name}} در {{record.number}} از شما نام برد",
  },
  sla_warning: {
    subject: "هشدار موعد: {{record.display}}",
    body: "موعد «{{record.title}}» نزدیک است.{{#if event.name}} ({{event.name}}){{/if}}\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "هشدار موعد {{record.number}}",
  },
  sla_breach: {
    subject: "موعد گذشت: {{record.display}}",
    body: "موعد «{{record.title}}» گذشت.{{#if event.name}} ({{event.name}}){{/if}}\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "موعد {{record.number}} گذشت",
  },
  approval_requested: {
    subject: "درخواست تأیید: {{record.display}}",
    body: "برای «{{record.title}}» تأیید شما لازم است.\n\n[مشاهده و تصمیم]({{link}})",
    short: "درخواست تأیید {{record.number}}",
  },
  approval_decided: {
    subject: "نتیجهٔ تأیید: {{record.display}}",
    body: "دربارهٔ «{{record.title}}» تصمیم گرفته شد{{#if event.decision}}: {{event.decision}}{{/if}}.\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "نتیجهٔ تأیید {{record.number}}",
  },
  custom: {
    subject: "{{event.label}}: {{record.display}}",
    body: "{{event.label}} — «{{record.title}}»\n\n[مشاهدهٔ {{record.number}}]({{link}})",
    short: "{{event.label}}: {{record.number}}",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
