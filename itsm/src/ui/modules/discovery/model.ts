// Pure rules of the data-source screens (design A §15, DA4): the kinds the wizard offers (the owner's 1.1 list), the
// fields a kind's connection, options and settings take, which of them a person may change (the connector guard's
// rules, mirrored so the screens hide what the server would refuse — the server stays the authority), what a save
// sends (only what changed; a secret only when one was typed, never a stored one), and the words of the console's
// cards, the passes and the preview. Free of React and of server imports (tests/discovery-ui.test.ts).
import type { ColorKey, FieldDef, Option } from "@shared/model/types";
import { checkMapping } from "@shared/discovery/mapping";
import { COLLECT_OPTIONS, KIND_CATEGORIES, type Edition, type KindCategory, type KindDescriptor, type OptionField, type TestResult } from "@shared/discovery/types";
import type { ChipTone } from "../../components/display";
import { fa, pct } from "../../lib/fa";

export type Values = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------
// Kinds

/** The kinds kept for 1.1 (the owner's decision of 14 Nov): the others stay stubs and are never offered here. */
export const KEPT_KINDS: readonly string[] = ["rest", "push", "feed", "zabbix", "prtg", "vcenter", "demo"];

/** A kind as GET /discovery/meta offers it: built, offered, and whether it runs in this edition. */
export type OfferedKind = KindDescriptor & { runs: boolean };

/** The wizard's tool cards: the kept kinds the server offers here, in the design's groups («پایش» first). */
export function wizardGroups(kinds: readonly OfferedKind[]): { key: KindCategory; label: string; kinds: OfferedKind[] }[] {
  const kept = kinds.filter((k) => KEPT_KINDS.includes(k.kind) && k.ready && !k.hidden);
  return (Object.keys(KIND_CATEGORIES) as KindCategory[])
    .map((key) => ({ key, label: KIND_CATEGORIES[key], kinds: kept.filter((k) => k.category === key) }))
    .filter((g) => g.kinds.length > 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Fields of a kind

/** Options live in the form as `opt.<key>`; a save folds them into the connector's `options`. */
export const OPT = "opt.";
export const optName = (key: string) => `${OPT}${key}`;

/** Ways in that carry a key (runner.ts KEYED_AUTH). */
const KEYED = new Set(["token", "basic", "session", "oauth_client", "ntlm"]);
/** Ways in with a user name. */
const NAMED = new Set(["basic", "session", "ntlm"]);
/** Kinds whose key goes in one header of the fixed list (the REST and file kinds send it with `restAuth`). */
const HEADER_KINDS = new Set(["rest", "feed"]);

/** The way in a connector uses: the stored or chosen one, else the kind's first. */
export function authOf(d: Pick<KindDescriptor, "auth">, v: Values): string {
  const a = typeof v.auth === "string" && v.auth ? v.auth : null;
  return a && d.auth.includes(a as never) ? a : d.auth[0] ?? "none";
}

/** Does the kind read files from the server edition's drop folder (no address, no key)? */
const fromFolder = (d: Pick<KindDescriptor, "kind">, v: Values) => d.kind === "feed" && v[optName("source")] === "folder";

/** A kind's option as a form field. */
export function optionField(o: OptionField): FieldDef {
  return {
    name: optName(o.key),
    label: o.label,
    type: o.type,
    ...(o.required ? { required: true } : {}),
    ...(o.help ? { help: o.help } : {}),
    ...(o.ltr ? { ltr: true } : {}),
    ...(o.choices ? { choices: o.choices } : {}),
    span: o.type === "json" ? 24 : 12,
  };
}

/**
 * Options without which the tool cannot be read, asked with the connection so «آزمودن اتصال» can read a page: REST's
 * listing and the array in its answer, a file's path at its address (not in the drop folder).
 */
const CONNECTION_OPTIONS: Record<string, string[]> = { rest: ["path", "items_path"], feed: ["source", "path"] };
export function connectionOption(d: Pick<KindDescriptor, "kind">, key: string, v: Values): boolean {
  if (!(CONNECTION_OPTIONS[d.kind] ?? []).includes(key)) return false;
  return !(d.kind === "feed" && key === "path" && fromFolder(d, v));
}

/**
 * «اتصال»: what reaching the tool takes — the address and the way in by kind (a push connector has neither: the
 * tool sends, as an integration user), the key, the kind's required options (REST: the listing's path), the root
 * certificate and other hosts; the unencrypted tick only in the server edition (§14.1, §14.2).
 */
export function connectionFields(d: KindDescriptor, v: Values, edition: Edition): string[] {
  if (d.kind === "push") return ["name", "push_user_id"];
  if (d.kind === "demo") return ["name"];
  const out = ["name"];
  if (d.kind === "feed") out.push(optName("source"));
  const folder = fromFolder(d, v);
  if (!folder) {
    out.push("base_url");
    if (d.auth.length > 1) out.push("auth");
    const auth = authOf(d, v);
    if (NAMED.has(auth)) out.push("username");
    if (KEYED.has(auth)) out.push("secret");
    if (auth === "token" && HEADER_KINDS.has(d.kind)) out.push("api_key_header");
  }
  for (const o of d.options) if ((o.required || connectionOption(d, o.key, v)) && !out.includes(optName(o.key))) out.push(optName(o.key));
  if (!folder) {
    out.push("ca_cert", "hosts");
    if (edition === "server") out.push("plain_http");
  }
  return out;
}

/** The REST kind's paging parameters each paging style reads (connectors/rest.ts); `total_path` serves every style. */
const REST_PAGING: Record<string, string[]> = {
  none: [],
  offset: ["page_size", "offset_param", "limit_param"],
  page: ["page_size", "page_param", "size_param", "first_page"],
  cursor: ["page_size", "limit_param", "cursor_param", "cursor_path"],
  next_link: ["page_size", "limit_param", "next_path"],
};
const REST_PAGING_KEYS = new Set(Object.values(REST_PAGING).flat());

/** Whether an option applies with the other choices made (REST: only the chosen paging style's parameters). */
export function optionShown(d: Pick<KindDescriptor, "kind">, key: string, v: Values): boolean {
  if (d.kind !== "rest" || !REST_PAGING_KEYS.has(key)) return true;
  const paging = String(v[optName("paging")] ?? "offset");
  return (REST_PAGING[paging] ?? [...REST_PAGING_KEYS]).includes(key);
}

/** «چه بیاید»: what to bring in, the kind's other options (those that apply), the create policy and the default class. */
export function collectFields(d: KindDescriptor, v: Values = {}): string[] {
  const out: string[] = [];
  if (d.collects.length > 1) out.push("collect");
  for (const o of d.options) if (!o.required && !(CONNECTION_OPTIONS[d.kind] ?? []).includes(o.key) && optionShown(d, o.key, v)) out.push(optName(o.key));
  out.push("create_policy", "default_class");
  return out;
}

/** The pass schedule: the listing, and the status pass when the kind reports status and it is collected. */
export function scheduleFields(d: KindDescriptor, v: Values): string[] {
  const collect = Array.isArray(v.collect) ? (v.collect as string[]) : d.collects;
  return d.collects.includes("status") && collect.includes("status") ? ["every_minutes", "status_every_minutes"] : ["every_minutes"];
}

/** Fields a connector's owner changes without being a CMDB administrator (guard.ts OWNER_FIELDS). */
export const OWNER_FIELDS: readonly string[] = ["active", "every_minutes", "status_every_minutes", "description"];
/** «ساخت دارایی برای دستگاه‌های تازه»: asset managers only (guard.ts ASSET_FIELDS). */
export const ASSET_FIELDS: readonly string[] = ["make_assets", "make_assets_daily"];

/** What a person may do with a connector (GET /discovery/meta `can`, and the page's own `can`). */
export interface Rights {
  /** CMDB administrator */
  admin: boolean;
  /** the connector's owner */
  owner: boolean;
  assetManager: boolean;
  softwareManager: boolean;
}

/**
 * The connector page's «تنظیمات»: the table's sections with the fields this kind uses. ATM settings show for the
 * ATM sources of 1.1 (files and push); asset creation only to asset managers (§11.1, §15).
 */
export function settingsFields(d: KindDescriptor, v: Values, edition: Edition, r: Pick<Rights, "assetManager">): string[] {
  const conn = connectionFields(d, v, edition);
  const out = [conn[0], "active", "owner_id", ...conn.slice(1), "description", ...collectFields(d, v), ...scheduleFields(d, v)];
  if (d.kind !== "push" && d.kind !== "demo") out.push("rate_per_second");
  out.push("refresh_days", "retry_hours", "over_manual", "stale_days", "missing_days", "missing_action", "retire_days");
  if (d.kind === "feed" || d.kind === "push") out.push("device_status_map", "device_hold_minutes", "manual_hold_hours");
  if (r.assetManager) out.push(...ASSET_FIELDS);
  return out;
}

/**
 * The fields among `fields` a person may change: the connector guard's rules (§14.5) within what the engine lets them
 * write on the record (`meta`: an owner without write rights in the CMDB changes nothing).
 */
export function editableFields(fields: readonly string[], r: Rights, meta?: { canWrite?: boolean; readonly?: readonly string[] }): Set<string> {
  const may = new Set<string>();
  if (meta?.canWrite === false) return may;
  const fixed = new Set(meta?.readonly ?? []);
  for (const f of fields) {
    if (fixed.has(f)) continue;
    if ((ASSET_FIELDS as string[]).includes(f)) {
      if (r.assetManager) may.add(f);
    } else if (r.admin || (r.owner && OWNER_FIELDS.includes(f))) may.add(f);
  }
  return may;
}

/** The host an address names (lower case), or "" when it names none. */
export function hostOf(url: unknown): string {
  try {
    return url ? new URL(String(url)).hostname.toLowerCase().replace(/\.+$/, "") : "";
  } catch {
    return "";
  }
}

/**
 * Fields that must be filled before a save (the tool cannot be reached without them). A key is required while none
 * is stored — and again when the address moves to another host, since the server then clears the stored one (§14.1).
 */
export function requiredFields(d: KindDescriptor, v: Values, fields: readonly string[], before: Values = {}): Set<string> {
  const out = new Set<string>(["name"]);
  for (const f of ["base_url", "push_user_id", "username"]) if (fields.includes(f)) out.add(f);
  const moved = isStoredSecret(before.secret) && (hostOf(before.base_url) !== hostOf(v.base_url) || !same(before.hosts, v.hosts));
  if (fields.includes("secret") && KEYED.has(authOf(d, v)) && (!isStoredSecret(before.secret) || moved)) out.add("secret");
  for (const o of d.options) if (o.required && fields.includes(optName(o.key))) out.add(optName(o.key));
  return out;
}

/** The required fields still empty (the screens' check before a save; the server checks again). */
export function missingFields(required: ReadonlySet<string>, v: Values): string[] {
  return [...required].filter((f) => (f === "secret" ? !(typeof v.secret === "string" && v.secret !== "") : isEmpty(v[f])));
}

/** `collect` offered for the kind: what it can bring in (software only to software managers, §11.2). */
export function collectChoices(d: KindDescriptor, r: Pick<Rights, "softwareManager">): Option[] {
  return COLLECT_OPTIONS.filter((o) => d.collects.includes(o.value as never) && (o.value !== "software" || r.softwareManager));
}

// ---------------------------------------------------------------------------------------------------------------
// Values and saves

export const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
/** A stored secret as the API shows it (`{ secret: true, hint }`): never its value. */
export const isStoredSecret = (v: unknown) => !!v && typeof v === "object" && (v as { secret?: unknown }).secret === true;

const SECRET_FIELDS = new Set(["secret", "secret2"]);

/** The form's values of a connector: its fields, and its options flattened as `opt.<key>` with the kind's defaults. */
export function formValues(row: Values, d: KindDescriptor | undefined): Values {
  const out: Values = { ...row };
  const options = row.options && typeof row.options === "object" && !Array.isArray(row.options) ? (row.options as Values) : {};
  for (const o of d?.options ?? []) out[optName(o.key)] = options[o.key] ?? o.default ?? null;
  return out;
}

/** A new connector's first values: the kind, its first way in and option defaults, switched off until the wizard's end. */
export function newValues(d: KindDescriptor): Values {
  return formValues({ kind: d.kind, auth: d.auth[0] ?? "none", active: false, collect: d.collects.filter((c) => c !== "software") }, d);
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const same = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || stable(a ?? null) === stable(b ?? null);

/**
 * The kind's options from the form: its option fields over what is stored (other keys are kept), empty ones left out,
 * and a default nobody set left to the kind (the form shows it; the stored options stay what people chose).
 */
export function optionsOf(d: KindDescriptor, v: Values, stored: unknown = {}): Values {
  const base: Values = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Values) : {};
  const out: Values = { ...base };
  for (const o of d.options) {
    const x = v[optName(o.key)];
    if (isEmpty(x) || (!(o.key in base) && o.default !== undefined && same(x, o.default))) delete out[o.key];
    else out[o.key] = x;
  }
  return out;
}

/**
 * What a save sends: the fields among `fields` that changed — a secret only when a new one was typed (the stored one
 * never leaves the server and an empty box keeps it) — and the options as one object when any of them changed.
 */
export function changes(d: KindDescriptor, before: Values, after: Values, fields: readonly string[]): Values {
  const out: Values = {};
  let options = false;
  for (const f of fields) {
    if (f.startsWith(OPT)) {
      if (!same(before[f], after[f])) options = true;
      continue;
    }
    const v = after[f];
    if (SECRET_FIELDS.has(f)) {
      if (typeof v === "string" && v !== "") out[f] = v;
      continue;
    }
    if (!same(before[f], v)) out[f] = v === undefined ? null : v;
  }
  if (options) out.options = optionsOf(d, after, before.options);
  return out;
}

/** The body that creates a connector from the wizard's «اتصال» (switched off until «ذخیره و اجرای نخست»). */
export function createBody(d: KindDescriptor, v: Values, fields: readonly string[]): Values {
  const out: Values = { kind: d.kind, active: false, auth: authOf(d, v) };
  for (const f of fields) {
    if (f.startsWith(OPT)) continue;
    const x = v[f];
    if (SECRET_FIELDS.has(f) ? typeof x === "string" && x !== "" : !isEmpty(x)) out[f] = x;
  }
  const options = optionsOf(d, v);
  if (Object.keys(options).length) out.options = options;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Words

/** An option colour as a chip tone. */
export function toneOf(color: ColorKey | undefined): ChipTone {
  switch (color) {
    case "green":
      return "in";
    case "red":
    case "magenta":
      return "danger";
    case "orange":
    case "gold":
      return "warning";
    case "teal":
    case "blue":
    case "indigo":
      return "info";
    case "purple":
      return "ai";
    default:
      return "neutral";
  }
}

export const labelOf = (opts: readonly Option[] | undefined, v: unknown): string => opts?.find((o) => o.value === v)?.label ?? String(v ?? "");

/** The steps of a pull pass (runner.ts Phase), in order. */
export const PHASES: { key: string; label: string }[] = [
  { key: "fetch", label: "خواندن فهرست" },
  { key: "parents", label: "میزبان‌ها" },
  { key: "refresh", label: "بازآشتی" },
  { key: "retry", label: "تلاش دوباره" },
  { key: "reapply", label: "اعمال دوباره" },
  { key: "finalise", label: "پایان کار" },
];
export const phaseLabel = (p: unknown) => PHASES.find((x) => x.key === p)?.label ?? "در حال اجرا";

/** What the engine would do with a previewed row (§7.5): «ساخته می‌شود / به‌روز می‌شود / تکراری / بی‌همتا». */
export const PREVIEW_ACTIONS: Record<string, { label: string; tone: ChipTone }> = {
  created: { label: "ساخته می‌شود", tone: "in" },
  updated: { label: "به‌روز می‌شود", tone: "info" },
  unchanged: { label: "بی‌تغییر", tone: "neutral" },
  duplicate: { label: "تکراری", tone: "warning" },
  unmatched: { label: "بی‌همتا", tone: "warning" },
  skipped: { label: "کنار گذاشته می‌شود", tone: "neutral" },
  error: { label: "خطا", tone: "danger" },
  rejected: { label: "خوانده نشد", tone: "danger" },
};

/** A pass as the console and the connector page see it (sm_discovery_runs). */
export interface RunInfo {
  id: string;
  state?: string;
  lane?: string;
  trigger?: string;
  started_at?: string | null;
  finished_at?: string | null;
  fetched?: number;
  created?: number;
  updated?: number;
  unmatched?: number;
  duplicates?: number;
  failed?: number;
  items_total?: number | null;
  warnings?: { code?: string; message: string; accepted?: boolean; external_id?: string }[] | null;
  error?: string | null;
  phase?: string | null;
}

/** The console's card of a connector (GET /discovery/connectors). */
export interface ConnectorCard {
  id: string;
  name: string;
  kind: string;
  label: string;
  icon: string;
  category: string;
  active: boolean;
  owner_id: string | null;
  plain_http: boolean;
  every_minutes: number;
  needs_key: boolean;
  items: Record<string, number>;
  last_run: RunInfo | null;
  running: RunInfo | null;
  held: { run_id: string; listed: number; message: string } | null;
  failures: number;
  can: { edit: boolean; operate: boolean };
}

/** The state chip of a connector: the normal state («فعال») is plain text; only what needs attention is a chip. */
export function connectorState(c: Pick<ConnectorCard, "active" | "running" | "needs_key" | "held" | "last_run">): { label: string; tone: ChipTone | null } {
  if (!c.active) return { label: "خاموش", tone: "neutral" };
  if (c.running) return { label: "در حال اجرا", tone: "info" };
  if (c.needs_key) return { label: "کلید لازم است", tone: "danger" };
  if (c.held) return { label: "در انتظار پذیرش", tone: "warning" };
  if (c.last_run?.state === "failed") return { label: "ناموفق", tone: "danger" };
  return { label: "فعال", tone: null };
}

export const faNum = (n: number) => fa(n);

/** How long a pass took: «۴۵ ثانیه»، «۳ دقیقه»، «۱ ساعت و ۵ دقیقه». */
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return "کمتر از یک ثانیه";
  if (s < 60) return `${faNum(s)} ثانیه`;
  const m = Math.round(s / 60);
  if (m < 60) return `${faNum(m)} دقیقه`;
  return m % 60 ? `${faNum(Math.floor(m / 60))} ساعت و ${faNum(m % 60)} دقیقه` : `${faNum(m / 60)} ساعت`;
}

/** The items a tool still reports: every item but those no longer reported («دیگر گزارش نمی‌شود»). */
export const currentItems = (items: Record<string, number>) => Math.max(0, Number(items.total ?? 0) - Number(items.gone ?? 0));

/** «هر ۶۰ دقیقه» / «فقط دستی». */
export function scheduleText(every: number): string {
  if (!every || every <= 0) return "فقط دستی";
  if (every % 1440 === 0) return every === 1440 ? "هر روز" : `هر ${faNum(every / 1440)} روز`;
  if (every % 60 === 0) return every === 60 ? "هر ساعت" : `هر ${faNum(every / 60)} ساعت`;
  return `هر ${faNum(every)} دقیقه`;
}

/**
 * The one status line of a card (§15): the running pass, a held drop, a missing key, the last failure, or
 * «۱۲٬۴۰۸ مورد · ۹۷٪ پیوسته · آخرین اجرا ۱۰ دقیقه پیش». `ago` words a time.
 */
export function statusLine(c: Pick<ConnectorCard, "running" | "held" | "needs_key" | "last_run" | "items">, ago: (iso: string) => string): { text: string; tone: ChipTone | null } {
  if (c.running) return { text: `در حال اجرا · ${phaseLabel(c.running.phase)} · ${faNum(Number(c.running.fetched ?? 0))} خوانده‌شده`, tone: "info" };
  if (c.held) return { text: `کاهش ناگهانی: ${faNum(c.held.listed)} مورد در گذر آخر · در انتظار «پذیرش اندازهٔ تازه»`, tone: "warning" };
  if (c.needs_key) return { text: "کلید منبع را دوباره وارد کنید", tone: "danger" };
  const last = c.last_run;
  if (!last) return { text: "هنوز اجرا نشده است", tone: null };
  if (last.state === "failed") return { text: `اجرای آخر ناموفق: ${last.error || "علت ثبت نشده است"}`, tone: "danger" };
  const total = currentItems(c.items);
  const linked = Number(c.items.linked ?? 0);
  const parts = [`${faNum(total)} مورد`];
  if (total > 0) parts.push(`${pct(linked / total, 0)} پیوسته`);
  const at = last.finished_at ?? last.started_at;
  if (at) parts.push(`آخرین اجرا ${ago(at)}`);
  return { text: parts.join(" · "), tone: null };
}

/** «آزمودن اتصال»'s result in words: the tool's version and identity, or the Persian cause. */
export function testSummary(r: TestResult): { ok: boolean; tone: "neutral" | "warning" | "danger"; title: string; version: string | null; identity: string | null; warnings: string[] } {
  if (!r.ok) return { ok: false, tone: "danger", title: r.message || "اتصال برقرار نشد", version: null, identity: null, warnings: r.warnings ?? [] };
  return { ok: true, tone: r.warnings?.length ? "warning" : "neutral", title: "اتصال برقرار است", version: r.version ?? null, identity: r.identity ?? null, warnings: r.warnings ?? [] };
}

/** An API error's field (the server's `bad(message, { field })`), for showing it under that field. */
export function errorField(details: unknown): string | null {
  const f = details && typeof details === "object" ? (details as { field?: unknown }).field : null;
  return typeof f === "string" ? f : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Items and the reconciliation queue «صف آشتی» (§8.4, §8.3)

/** One difference between what a tool reports and what the asset register (or the CI) holds (mismatch.ts). */
export interface MismatchEntry {
  /** the asset field (assigned_to, location_id, asset_tag, serial_number) or the CI field the engine skipped */
  field: string;
  target: "asset" | "ci";
  label: string;
  /** what the tool reported, as it reported it */
  reported: string | number | boolean | null;
  /** the member or place the reported holder or place resolves to */
  resolved?: string | null;
  /** what the asset (or the CI) holds: an id for the holder and the place */
  held: string | number | boolean | null;
}

/** A reported thing as the queue and the items tab list it (sm_discovery_items; `data` only for field group internal). */
export interface ItemRow {
  id: string;
  connector_id: string;
  external_id: string;
  kind?: string | null;
  name?: string | null;
  ci_id?: string | null;
  asset_id?: string | null;
  state?: string | null;
  matched_by?: string | null;
  message?: string | null;
  reconciled_at?: string | null;
  last_contact_at?: string | null;
  status?: string | null;
  status_since?: string | null;
  status_message?: string | null;
  link_url?: string | null;
  data?: Record<string, unknown> | null;
  mismatch?: { entries?: MismatchEntry[]; at?: string } | null;
  mismatch_state?: string | null;
  dedup_task_id?: string | null;
  updated_at?: string | null;
}

export type QueueTab = "unmatched" | "duplicate" | "error" | "mismatch";

/** The queue's tabs (§8.4; «بی‌دارایی» comes with the asset feed, «نرم‌افزار یکسان‌نشده» with 1.2). */
export const QUEUE_TABS: { key: QueueTab; label: string }[] = [
  { key: "unmatched", label: "بی‌همتا" },
  { key: "duplicate", label: "تکراری" },
  { key: "error", label: "خطا" },
  { key: "mismatch", label: "ناهمخوانی" },
];
export const isQueueTab = (v: unknown): v is QueueTab => QUEUE_TABS.some((t) => t.key === v);

/** A tab's label with its count: «بی‌همتا ۱۲». */
export const tabLabel = (label: string, n: number | undefined) => (n ? `${label} ${faNum(n)}` : label);

/** Asset fields a person may set from the tool's value (mismatch.ts APPLICABLE_FIELDS). */
export const APPLICABLE_FIELDS: readonly string[] = ["assigned_to", "location_id", "asset_tag", "serial_number"];
/** The holder and the place apply only once the tool's value resolves to a member or a place. */
const RESOLVED_FIELDS = new Set(["assigned_to", "location_id"]);

/** Can «به‌روزرسانی دارایی با مقدار ابزار» apply this difference? (the server's rule, mismatch.ts applyMismatch) */
export function applicable(e: MismatchEntry): boolean {
  if (e.target !== "asset" || !APPLICABLE_FIELDS.includes(e.field)) return false;
  const v = RESOLVED_FIELDS.has(e.field) ? e.resolved : e.reported;
  return v !== null && v !== undefined && v !== "";
}

export type QueueAction = "create" | "link" | "ignore" | "dismiss";

/** Who acts in the queue (§14.5); the server decides per item, the screen offers. */
export interface QueueRights {
  /** CMDB administrator */
  admin: boolean;
  /** asset manager: settles differences with the assets they may change */
  assetManager: boolean;
  /** connectors whose owner the person is */
  operates: ReadonlySet<string>;
}

const QUEUE_STATES = new Set(["unmatched", "duplicate", "error"]);

/**
 * The actions an item offers on its tab: «ساخت پیکربندی», «پیوند به…» and «نادیده گرفتن» for CMDB administrators and
 * the connector's owner — never «ساخت پیکربندی» for an ATM, whose asset comes from the register (§9.5); on
 * «ناهمخوانی», «نادیده گرفتن» for CMDB administrators and asset managers (the per-field apply is offered per entry).
 */
export function queueActions(tab: QueueTab, row: Pick<ItemRow, "connector_id" | "kind" | "state" | "mismatch_state">, r: QueueRights): QueueAction[] {
  if (tab === "mismatch") return row.mismatch_state === "open" && (r.admin || r.assetManager) ? ["dismiss"] : [];
  if (!QUEUE_STATES.has(String(row.state)) || !(r.admin || r.operates.has(row.connector_id))) return [];
  return [...(row.kind === "atm" ? [] : (["create"] as const)), "link", "ignore"];
}

/** The actions every selected item offers (the bulk bar); «پیوند به…» links one item at a time. */
export function bulkActions(tab: QueueTab, rows: Pick<ItemRow, "connector_id" | "kind" | "state" | "mismatch_state">[], r: QueueRights): QueueAction[] {
  if (!rows.length) return [];
  const each = rows.map((x) => new Set(queueActions(tab, x, r)));
  return (["create", "link", "ignore", "dismiss"] as const).filter((a) => each.every((s) => s.has(a)) && (a !== "link" || rows.length === 1));
}

/** A bulk action's toast: «۱۲ مورد انجام شد», with the first refusal when some were refused. */
export function bulkOutcome(done: number, failed: string[]): { ok: boolean; text: string } {
  if (!failed.length) return { ok: true, text: `${faNum(done)} مورد انجام شد` };
  const first = failed[0];
  return { ok: false, text: done ? `${faNum(done)} مورد انجام شد؛ ${faNum(failed.length)} مورد نه: ${first}` : failed.length > 1 ? `${faNum(failed.length)} مورد انجام نشد: ${first}` : first };
}

/** What «ساخت پیکربندی» did, in words (the engine's action on the item). */
export function createdText(r: { action: string; number?: string | null; message?: string | null }): { ok: boolean; text: string } {
  if (r.action === "created") return { ok: true, text: r.number ? `پیکربندی ${r.number} ساخته شد` : "پیکربندی ساخته شد" };
  if (r.action === "updated" || r.action === "unchanged") return { ok: true, text: "مورد به پیکربندی موجود پیوست" };
  if (r.action === "duplicate") return { ok: false, text: r.message || "چند پیکربندی با این مورد جور است؛ در «بررسی تکراری‌ها» یکی را برگزینید" };
  return { ok: false, text: r.message || "پیکربندی ساخته نشد" };
}

/** Items in the connector page's «موارد»: every reconciliation state, and «در انتظار آشتی» for those not yet through. */
export const ITEM_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "همه" },
  { value: "linked", label: "پیوسته" },
  { value: "unmatched", label: "بی‌همتا" },
  { value: "duplicate", label: "تکراری" },
  { value: "error", label: "خطا" },
  { value: "pending", label: "در انتظار آشتی" },
  { value: "ignored", label: "نادیده" },
  { value: "gone", label: "دیگر گزارش نمی‌شود" },
];

// ---------------------------------------------------------------------------------------------------------------
// The board «وضعیت پایش» and the side panel «منبع‌ها و وضعیت پایش» (§15, §9)

export type BoardChip = "down" | "unreachable" | "warning" | "maintenance" | "off" | "silent" | "atm";

/** The board's chips, in the design's order (status.ts BOARD_CHIPS). */
export const BOARD_CHIPS: { key: BoardChip; label: string }[] = [
  { key: "down", label: "قطع" },
  { key: "unreachable", label: "بی‌پاسخ" },
  { key: "warning", label: "هشدار" },
  { key: "maintenance", label: "در نگهداری" },
  { key: "off", label: "خاموش" },
  { key: "silent", label: "بی‌تماس بیش از ۱۴ روز" },
  { key: "atm", label: "خودپردازها" },
];
export const isBoardChip = (v: unknown): v is BoardChip => BOARD_CHIPS.some((c) => c.key === v);

/** A row of the board (GET /discovery/status). `message` only for CMDB readers. */
export interface BoardRow {
  target_table: "ci" | "asset";
  target_id: string;
  ci_id: string | null;
  asset_id: string | null;
  name: string | null;
  class: string | null;
  category: string | null;
  branch_id: string | null;
  location_id: string | null;
  status: string;
  status_label: string;
  status_color: string;
  since: string | null;
  last_contact_at: string | null;
  sources: number;
  device_status: string | null;
  message?: string | null;
}

/**
 * Where a board row opens (org-relative): its target for CMDB readers — the CI, or the asset of an ATM without one;
 * the asset for everyone else (a branch officer reads no CI), or nothing when there is none.
 */
export function boardPath(row: Pick<BoardRow, "target_table" | "ci_id" | "asset_id">, cmdb: boolean): string | null {
  if (cmdb && row.target_table === "ci" && row.ci_id) return `cis/${row.ci_id}`;
  return row.asset_id ? `assets/${row.asset_id}` : cmdb && row.ci_id ? `cis/${row.ci_id}` : null;
}

/** «۳ منبع» — how many fresh sources report the target. */
export const sourcesText = (n: number) => (n > 0 ? `${faNum(n)} منبع` : "بی‌منبع تازه");

/** The panel of a CI or an asset (GET /discovery/panel/:table/:id): sources and signals only for CMDB readers. */
export interface PanelData {
  empty: boolean;
  status: { state: string; label: string; color: string; since: string | null; sources: number; last_contact_at: string | null; stale_since: string | null; message?: string | null } | null;
  sources: { connector_id: string; name: string; kind: string; state: string | null; status: string | null; status_label: string | null; status_since: string | null; message: string | null; last_contact_at: string | null; reported_at: string | null; link_url: string | null }[];
  signals: { key: string; name: string | null; state: string | null; since: string | null; alert_id: string | null }[];
}

/** Does a record's page show the panel? Its meta says so (panel.ts: a status reader, and something reports it). */
export const showsPanel = (meta: Record<string, unknown> | undefined | null): boolean => !!(meta?.discovery as { panel?: unknown } | undefined)?.panel;

/** Kinds whose deep link opens a named product («باز کردن در Zabbix»); others open «ابزار». */
const PRODUCT_NAMES: Record<string, string> = { zabbix: "Zabbix", prtg: "PRTG", vcenter: "vCenter" };
export const toolName = (kind: string): string | null => PRODUCT_NAMES[kind] ?? null;

/** A tool's deep link, when it is one a browser may open (never `javascript:` or another scheme). */
export const safeLink = (url: unknown): string | null => (typeof url === "string" && /^https?:\/\/[^\s]+$/i.test(url) ? url : null);

// ---------------------------------------------------------------------------------------------------------------
// The mapping editor «نگاشت» (§6.3)

/** The record fields a mapping sets, in Persian (@shared/discovery/mapping RECORD_TARGETS); `attrs.<key>` besides. */
export const TARGET_LABELS: Record<string, string> = {
  external_id: "شناسه در ابزار",
  kind: "گونه",
  class: "کلاس",
  name: "نام",
  hostname: "نام میزبان",
  fqdn: "نام کامل دامنه",
  domain: "دامنه",
  ips: "نشانی‌های IP",
  macs: "نشانی‌های MAC",
  serial_number: "شمارهٔ سریال",
  bios_uuid: "شناسهٔ BIOS",
  terminal_id: "شناسهٔ پایانه",
  manufacturer: "سازنده",
  model: "مدل",
  os: "سیستم‌عامل",
  os_version: "نسخهٔ سیستم‌عامل",
  sw_version: "نسخهٔ نرم‌افزار",
  cpu_count: "شمار پردازنده",
  ram_mb: "حافظه (مگابایت)",
  disk_gb: "دیسک (گیگابایت)",
  cloud_resource_id: "شناسهٔ منبع ابری",
  url: "نشانی",
  parent_external_id: "شناسهٔ میزبان در ابزار",
  last_contact_at: "آخرین تماس",
  "status.state": "وضعیت",
  "status.availability": "قطع یعنی خود دستگاه",
  "status.since": "وضعیت از",
  "status.message": "پیام وضعیت",
  "status.device_status": "وضعیت خودپرداز",
  "reported.user": "کاربر گزارش‌شده",
  "reported.site": "سایت گزارش‌شده",
  "reported.location": "مکان گزارش‌شده",
  "reported.asset_tag": "برچسب اموال گزارش‌شده",
};

/** One line of the editor: a record field ← a path in the tool's element (REST) or in the kind's record (a rename). */
export interface MapRow {
  key: string;
  target: string;
  source: string;
}

/** The editor's lines of a stored mapping, in the record's field order (class attributes last). */
export function mappingRows(mapping: unknown): MapRow[] {
  const m = mapping && typeof mapping === "object" && !Array.isArray(mapping) ? (mapping as Record<string, unknown>) : {};
  const order = Object.keys(TARGET_LABELS);
  const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : order.length);
  return Object.entries(m)
    .filter(([, v]) => typeof v === "string")
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([target, source], i) => ({ key: `m${i}`, target, source: String(source) }));
}

/** The mapping a save sends: lines with both sides, trimmed (an empty line is dropped). */
export function rowsMapping(rows: readonly MapRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const t = r.target.trim();
    const s = r.source.trim();
    if (t && s) out[t] = s;
  }
  return out;
}

/** Has the editor moved from the stored mapping? */
export const mappingChanged = (stored: unknown, rows: readonly MapRow[]): boolean => !same(rowsMapping(mappingRows(stored)), rowsMapping(rows));

/**
 * What stops a save, per line and for the whole map: a line without its field or path, a field mapped twice, a field
 * people or ITAM own (@shared checkMapping's message: «… مقدار ابزار در «گزارش‌شده» نگه داشته می‌شود»), an unknown
 * field; for the REST kind the item's id must be mapped.
 */
export function mappingProblems(rows: readonly MapRow[], rest: boolean): { byRow: Record<string, string>; general: string[] } {
  const byRow: Record<string, string> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    const t = r.target.trim();
    const s = r.source.trim();
    if (!t && !s) continue;
    if (!t) byRow[r.key] = "فیلد را برگزینید";
    else if (!s) byRow[r.key] = "مسیر را بنویسید";
    else if (seen.has(t)) byRow[r.key] = `«${t}» یک بار بیشتر نگاشته نمی‌شود`;
    else {
      seen.add(t);
      const p = checkMapping({ [t]: s }).find((x) => x.key === t);
      if (p) byRow[r.key] = p.message;
    }
  }
  const general = checkMapping(rowsMapping(rows), { rest })
    .filter((p) => !p.key || (p.key === "external_id" && !seen.has("external_id")))
    .map((p) => p.message);
  return { byRow, general };
}
