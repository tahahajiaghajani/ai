// The connector framework's shared vocabulary (design A §5–§6): the normalised record a tool reports (schema
// `kariz.discovery/1` — the same shape the push API accepts and the relay produces), the status words, the states of
// items, runs and batches, what a connector collects and how it authenticates, and the client-safe descriptor of a
// connector kind that the wizard renders. Server-side behaviour (paging, status, problems) lives in
// src/server/modules/discovery; the pure rules on these shapes in the sibling files (normalise, hash, mapping, stale).
// Imported by the UI: keep it free of server imports.
import type { ColorKey, Option } from "../model/types";

/** The schema name of a normalised record (push API, relay, connector pages). */
export const RECORD_SCHEMA = "kariz.discovery/1";

const opt = (value: string, label: string, color?: ColorKey): Option => ({ value, label, ...(color ? { color } : {}) });
const ordered = (xs: Option[]): Option[] => xs.map((o, i) => ({ ...o, order: i + 1 }));

// ---------------------------------------------------------------------------------------------------------------
// Words of the module

/** What a reported thing is (decides the default class and the ATM rules, §9.5). */
export type ItemKind = "device" | "vm" | "host" | "endpoint" | "network" | "atm" | "other";
export const ITEM_KIND_VALUES: ItemKind[] = ["device", "vm", "host", "endpoint", "network", "atm", "other"];
export const ITEM_KINDS: Option[] = ordered([
  opt("device", "دستگاه"), opt("vm", "ماشین مجازی"), opt("host", "میزبان مجازی‌سازی"), opt("endpoint", "رایانهٔ کاربر"),
  opt("network", "تجهیز شبکه"), opt("atm", "خودپرداز"), opt("other", "سایر"),
]);

/** Monitor status of an item or a target (§5.9): every state has a word and a dot. */
export type StatusState = "up" | "warning" | "down" | "unreachable" | "maintenance" | "off" | "unknown";
export const STATUS_VALUES: StatusState[] = ["up", "warning", "down", "unreachable", "maintenance", "off", "unknown"];
export const STATUS_WORDS: Option[] = ordered([
  opt("up", "برقرار", "green"), opt("warning", "هشدار", "orange"), opt("down", "قطع", "red"), opt("unreachable", "بی‌پاسخ", "purple"),
  opt("maintenance", "در نگهداری", "gold"), opt("off", "خاموش", "blue"), opt("unknown", "نامعلوم", "gray"),
]);

/** Where an item stands in reconciliation (§5.2); empty while it waits for its first pass. */
export type ItemState = "linked" | "unmatched" | "duplicate" | "ignored" | "gone" | "error";
export const ITEM_STATES: Option[] = ordered([
  opt("linked", "پیوسته", "green"), opt("unmatched", "بی‌همتا", "orange"), opt("duplicate", "تکراری", "purple"), opt("ignored", "نادیده", "gray"),
  opt("gone", "دیگر گزارش نمی‌شود", "gray"), opt("error", "خطا", "red"),
]);

/** What a connector brings in (`software` is off by default and a software manager's decision, §11.2). */
export type Collect = "inventory" | "status" | "problems" | "software";
export const COLLECT_VALUES: Collect[] = ["inventory", "status", "problems", "software"];
export const COLLECT_OPTIONS: Option[] = ordered([opt("inventory", "فهرست و مشخصات"), opt("status", "وضعیت پایش"), opt("problems", "مشکل‌ها و هشدارها"), opt("software", "نرم‌افزارهای نصب‌شده")]);

/** How a connector authenticates to its tool (§5.1); `none` for tools reached without a key and for push. */
export type AuthKind = "none" | "token" | "basic" | "session" | "oauth_client" | "ntlm" | "windows_identity" | "directory";
export const AUTH_OPTIONS: Option[] = ordered([
  opt("none", "بدون کلید"), opt("token", "کلید API"), opt("basic", "نام کاربری و گذرواژه"), opt("session", "نشست با نام کاربری و گذرواژه"),
  opt("oauth_client", "OAuth (شناسه و رمز برنامه)"), opt("ntlm", "حساب ویندوز (NTLM)"), opt("windows_identity", "هویت سرویس کاریز (ویندوز)"),
  opt("directory", "منبع فهرست کاربران تأییدشده"),
]);

/** Editions a kind runs in (§3): the web version, the server edition, the Kariz relay. */
export type Edition = "cloud" | "server" | "relay";

/** What happens to a reported item that matches no CI (§5.1). */
export type CreatePolicy = "create" | "review" | "match_only";
export const CREATE_POLICIES: Option[] = ordered([opt("create", "ساخت و به‌روزرسانی"), opt("review", "ساخت پس از بررسی"), opt("match_only", "فقط به‌روزرسانی موجودها")]);

/** What an in-use asset that no tool has contacted for `missing_days` gets (§10). */
export const MISSING_ACTIONS: Option[] = ordered([opt("task", "کار برای مدیر دارایی"), opt("auto", "علامت «مفقود» خودکار")]);

/** The only API-key headers a REST connector may send (§14.1). */
export const API_KEY_HEADERS = ["X-API-Key", "X-Auth-Token", "Api-Key", "PRIVATE-TOKEN", "Authorization"] as const;
export const API_KEY_HEADER_OPTIONS: Option[] = ordered(API_KEY_HEADERS.map((h) => opt(h, h)));

/** A pass of a connector (§5.5). */
export type RunLane = "inventory" | "status" | "push" | "preview";
export const RUN_LANES: Option[] = ordered([opt("inventory", "فهرست"), opt("status", "وضعیت"), opt("push", "ارسال"), opt("preview", "پیش‌نمایش")]);
export type RunTrigger = "schedule" | "manual" | "push" | "preview";
export const RUN_TRIGGERS: Option[] = ordered([opt("schedule", "زمان‌بندی"), opt("manual", "دستی"), opt("push", "ارسال ابزار"), opt("preview", "پیش‌نمایش")]);
export type RunState = "running" | "completed" | "failed" | "canceled" | "abandoned";
export const RUN_STATES: Option[] = ordered([
  opt("running", "در حال اجرا", "teal"), opt("completed", "انجام شد", "green"), opt("failed", "ناموفق", "red"), opt("canceled", "لغوشده", "gray"),
  opt("abandoned", "رهاشده", "gray"),
]);

/** A pushed batch (§5.6, §12.1). */
export const BATCH_STATES: Option[] = ordered([
  opt("queued", "در صف", "blue"), opt("staging", "در حال ثبت", "teal"), opt("reconciling", "در حال آشتی", "teal"), opt("done", "انجام شد", "green"),
  opt("failed", "ناموفق", "red"),
]);

/** A reported value that differs from what people or ITAM hold (§8.3). */
export const MISMATCH_STATES: Option[] = ordered([opt("none", "ندارد", "gray"), opt("open", "باز", "orange"), opt("dismissed", "نادیده گرفته شد", "gray")]);

// ---------------------------------------------------------------------------------------------------------------
// The normalised record (§6.2)

/** A reported status of a machine (volatile: never part of an item's hash). */
export interface DiscoveredStatus {
  state: StatusState;
  /** the state means the machine itself is (un)available (§9.2) */
  availability?: boolean;
  /** when the tool saw the state begin (ISO) */
  since?: string;
  message?: string;
  /** ATM records identified strongly only (§9.5): the tool's value, mapped through `device_status_map` */
  device_status?: string;
}

export interface DiscoveredSoftware {
  name: string;
  version?: string;
  vendor?: string;
}

/** Hints of who holds the machine and where it is: never written to the CI's own fields (§6.3, §8.3). */
export interface ReportedHints {
  user?: string;
  site?: string;
  location?: string;
  asset_tag?: string;
}

/**
 * One thing a tool reports, normalised. `cloud_resource_id`, `sw_version` and `url` are additions to the design's
 * list: they are allow-listed CI fields (§6.3) a record needs to be able to carry.
 */
export interface DiscoveredRecord {
  /** the tool's stable id (Zabbix hostid, vCenter vm-123, MECM ResourceID, AD objectGUID, an ATM's terminal id) — ≤ 200 */
  external_id: string;
  kind: ItemKind;
  /** a CI class key; else from the kind, the connector's options or its default class */
  class?: string;
  name: string;
  hostname?: string;
  fqdn?: string;
  domain?: string;
  ips?: string[];
  macs?: string[];
  serial_number?: string;
  bios_uuid?: string;
  terminal_id?: string;
  manufacturer?: string;
  model?: string;
  os?: string;
  os_version?: string;
  sw_version?: string;
  cpu_count?: number;
  ram_mb?: number;
  disk_gb?: number;
  cloud_resource_id?: string;
  url?: string;
  reported?: ReportedHints;
  /** vm → its host */
  parent_external_id?: string;
  /** the tool's own last contact with the machine (ISO); omitted when unknown (§10) */
  last_contact_at?: string;
  status?: DiscoveredStatus;
  /** ≤ 300; used only when software collection is on (§11.2) */
  software?: DiscoveredSoftware[];
  /** class attributes (`attrs.<key>` of the CI), except the reserved `reported_*` */
  attrs?: Record<string, string | number | boolean>;
}

/** An open problem a tool reports (§5.4, §9.6, push `problems.items`). */
export interface DiscoveredProblem {
  key: string;
  external_id?: string;
  severity: string;
  availability?: boolean;
  message?: string;
  since?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// What a connector kind answers (§6.1). The kind's code is the server's (src/server/modules/discovery/connectors);
// these shapes are shared so that the relay and the screens speak the same language.

/** The kind's own position in its tool's listing (JSON; opaque to everything but the kind). */
export type Cursor = string | number | boolean | null | Cursor[] | { [k: string]: Cursor };

/** One page of a listing. `complete` is false when the listing cannot stand for the whole picture (a filtered view). */
export interface Page {
  records: DiscoveredRecord[];
  /** where to go on (null: the listing ended) */
  next: Cursor;
  complete?: boolean;
  /** the tool's own count, when it tells */
  total?: number;
  /** records the kind could not read (one bad record never stops a pass): their messages */
  rejected?: { external_id?: string; message: string }[];
  /** the tool's own elements behind `records`, index for index (the preview's raw JSON, tenant administrators only) */
  raw?: unknown[];
}

/** One status observation (a status pass, §9; DA2). */
export interface StatusItem {
  external_id: string;
  status: DiscoveredStatus;
  last_contact_at?: string;
}

export interface StatusPage {
  items: StatusItem[];
  next: Cursor;
}

/** One page of the tool's complete set of open problems (§9.6; DA2). */
export interface ProblemPage {
  problems: DiscoveredProblem[];
  next: Cursor;
  complete?: boolean;
}

/** «آزمودن اتصال»: what the tool told about itself, or the Persian cause. */
export interface TestResult {
  ok: boolean;
  /** the tool's version, when it tells */
  version?: string;
  /** who the connector is in the tool (the account) */
  identity?: string;
  /** permissions it lacks, limits it met (Persian) */
  warnings: string[];
  /** the cause when not ok (Persian: what happened + what to do) */
  message?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// The client-safe descriptor of a kind (the wizard's cards and forms; §6.1)

/** The wizard's groups of tools (§15). */
export const KIND_CATEGORIES = {
  monitoring: "پایش",
  endpoints: "مدیریت رایانه‌ها",
  virtualisation: "مجازی‌سازی",
  directory_security: "فهرست و امنیت",
  atm_files: "خودپردازها و فایل‌ها",
  generic: "ورود عمومی",
} as const;
export type KindCategory = keyof typeof KIND_CATEGORIES;

/** One field of a kind's `options` (rendered by the wizard, validated on the server by the kind's schema). */
export interface OptionField {
  key: string;
  label: string;
  type: "string" | "int" | "bool" | "tags" | "choice" | "json";
  required?: boolean;
  default?: unknown;
  choices?: Option[];
  help?: string;
  ltr?: boolean;
}

export interface KindDescriptor {
  kind: string;
  label: string;
  /** an icon of the kit's set (lucide name) — never a tool's logo */
  icon: string;
  category: KindCategory;
  wave: 1 | 2;
  /** false: a stub its package has not built yet (the wizard hides it; the server kind refuses) */
  ready: boolean;
  /** offered in the wizard (the demo pack's kind is not) */
  hidden?: boolean;
  /** a change invalidates every item hash of the kind (§7.4) */
  version: number;
  editions: Edition[];
  auth: AuthKind[];
  /** what it can collect; `collect` defaults to these without `software` */
  collects: Collect[];
  /** whether the tool reports its own last contact with a machine, and how late it may be (AD: 14 days) */
  contact: { lag_days: number } | null;
  /** whether the kind reports availability (§9.2) */
  availability: boolean;
  /** the data source's default priority (§8.1; lower = more authoritative) */
  priority: number;
  /** the default «سیاست ساخت» (AD computers and KSC review first) */
  create_policy: CreatePolicy;
  options: OptionField[];
  /** the kind's default mapping overrides (REST: the JSON paths of a minimal record) */
  default_mapping?: Record<string, string>;
  /** the read-only account the tool needs (shown in the wizard and the docs) */
  permission_note?: string;
}
