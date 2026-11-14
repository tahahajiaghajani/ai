// Pure rules of the data-source screens (design A §15, DA4): the kinds the wizard offers (the owner's 1.1 list), the
// fields a kind's connection, options and settings take, which of them a person may change (the connector guard's
// rules, mirrored so the screens hide what the server would refuse — the server stays the authority), what a save
// sends (only what changed; a secret only when one was typed, never a stored one), and the words of the console's
// cards, the passes and the preview. Free of React and of server imports (tests/discovery-ui.test.ts).
import type { ColorKey, FieldDef, Option } from "@shared/model/types";
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

/** The fields among `fields` a person may change (the connector guard's rules, §14.5). */
export function editableFields(fields: readonly string[], r: Rights): Set<string> {
  const may = new Set<string>();
  for (const f of fields) {
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

/** The kind's options from the form: its option fields over what is stored (other keys are kept), empty ones left out. */
export function optionsOf(d: KindDescriptor, v: Values, stored: unknown = {}): Values {
  const out: Values = stored && typeof stored === "object" && !Array.isArray(stored) ? { ...(stored as Values) } : {};
  for (const o of d.options) {
    const x = v[optName(o.key)];
    if (isEmpty(x)) delete out[o.key];
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

/** «هر ۶۰ دقیقه» / «فقط دستی». */
export function scheduleText(every: number): string {
  if (!every || every <= 0) return "فقط دستی";
  if (every % 1440 === 0) return `هر ${faNum(every / 1440)} روز`;
  if (every % 60 === 0) return `هر ${faNum(every / 60)} ساعت`;
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
  const total = Number(c.items.total ?? 0);
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
