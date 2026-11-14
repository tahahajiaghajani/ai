// The server side of a connector kind (design A §6.1): what a kind's code implements and what it is given. A kind
// reads its tool through `ConnCtx` only — options, secrets read once per job, a host-pinned and rate-limited fetch, the
// slice's deadline — and never touches the database; the relay (§13) implements the same `ConnCtx`, so connector files
// run in both places. Keep this file free of database and engine imports.
import type { ZodType } from "zod";
import type { AuthKind, Cursor, DiscoveredRecord, Edition, KindDescriptor, Page, ProblemPage, StatusPage, TestResult } from "@shared/discovery/types";

/** The connector's settings a kind may read. */
export interface ConnectorView {
  id: string;
  name: string;
  kind: string;
  base_url: string | null;
  hosts: string[];
  auth: AuthKind | null;
  username: string | null;
  api_key_header: string | null;
  plain_http: boolean;
  collect: string[];
  options: Record<string, unknown>;
  mapping: Record<string, string>;
  default_class: string | null;
  rate_per_second: number;
  ca_cert: string | null;
}

export interface FetchInit {
  method?: "GET" | "POST";
  /** query parameters (credentials never: they belong in a header) */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** only the kind's declared headers (§14.1) besides Accept and Content-Type */
  headers?: Record<string, string>;
  /** a JSON body */
  body?: unknown;
}

export interface FetchResult<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
  /** the URL that answered (after same-host redirects) */
  url: string;
}

/** What a kind is given for one job (§6.1). */
export interface ConnCtx {
  connector: ConnectorView;
  /** `options`, validated by the kind's schema */
  options: Record<string, unknown>;
  /** the connector's credentials, read once per job and kept in memory only */
  secret: string | null;
  secret2: string | null;
  edition: Edition | "desktop";
  /** a preview (§7.5): the kind changes nothing at its source (the feed leaves its drop folder as it is) */
  preview?: boolean;
  /** when the slice ends (ms since the epoch): a kind stops before it */
  deadline: number;
  now(): Date;
  /** a URL of the pinned host (`path` joined to `base_url`, or an absolute URL of an allowed host) */
  fetchJson<T = unknown>(path: string, init?: FetchInit): Promise<FetchResult<T>>;
  fetchText(path: string, init?: FetchInit): Promise<FetchResult<string>>;
  log(message: string, data?: unknown): void;
  /**
   * What the connector keeps of these tool ids: the normalised record and when a pass last listed it. A kind that reads
   * details only when needed (vCenter, §7.6) asks it; absent where nothing is kept (the relay), and the kind reads all.
   */
  known?(externalIds: string[]): Promise<Map<string, KnownItem>>;
}

/** An item the connector keeps (ConnCtx.known). */
export interface KnownItem {
  record: DiscoveredRecord;
  /** when a pass last listed it (ISO) */
  listed_at: string | null;
}

/** A kind's code: its descriptor's facts, the headers it may send, its options' schema and what it reads (§6.1). */
export interface ConnectorKind extends KindDescriptor {
  /** the only request headers it may send besides Accept and Content-Type (the auth header it builds among them) */
  headers: string[];
  optionsSchema: ZodType<Record<string, unknown>>;
  /** version, identity and permission warnings */
  test(c: ConnCtx): Promise<TestResult>;
  pages(c: ConnCtx, cursor: Cursor | null): Promise<Page>;
  status?(c: ConnCtx, cursor: Cursor | null): Promise<StatusPage>;
  /** the complete open set, paged */
  problems?(c: ConnCtx, cursor: Cursor | null): Promise<ProblemPage>;
  /** a deep link into the tool for a record */
  link?(record: DiscoveredRecord, c: ConnCtx): string | null;
  /** these options read no network (the feed's drop folder): «آزمودن اتصال» skips the address checks */
  local?(options: Record<string, unknown>): boolean;
}

export type ConnectorErrorCode = "auth" | "network" | "rate_limited" | "refused" | "bad_response" | "not_built" | "config";

/** Persian messages of the documented failures (§7.5, §14.1; the docs' troubleshooting table lists each). */
export const CONNECTOR_MESSAGES = {
  auth: "نام کاربری یا کلید پذیرفته نشد",
  noAnswer: (name: string) => `«${name}» پاسخ نداد`,
  redirect: "پاسخ به نشانی دیگری هدایت شد؛ نشانی منبع را اصلاح کنید",
  credentialsInUrl: "کلید را در بخش «کلید» وارد کنید، نه در نشانی",
  self: "این نشانی به خود سرور کاریز یا پایگاه داده‌اش می‌رسد و پذیرفته نمی‌شود",
  plainHttp: "اتصال بدون رمزنگاری فقط در نسخهٔ سرور و با تیک «اتصال بدون رمزنگاری (فقط شبکهٔ داخلی)» پذیرفته است",
  otherHost: "این نشانی بیرون از میزبان منبع است و پذیرفته نمی‌شود؛ میزبان را در «میزبان‌های مجاز دیگر» بیفزایید",
  noBaseUrl: "نشانی ابزار وارد نشده است",
  badJson: "پاسخ ابزار JSON معتبر نیست",
  tooLarge: "پاسخ ابزار بزرگ‌تر از ۲۰ مگابایت است؛ اندازهٔ صفحه را کوچک‌تر کنید",
  status: (status: number) => `ابزار پاسخ ${status} داد`,
  notBuilt: (label: string) => `منبع «${label}» هنوز ساخته نشده است`,
  header: (name: string) => `سرآیند «${name}» برای این نوع منبع مجاز نیست`,
  notAllowed: (host: string) => `میزبان ${host} در فهرست مجاز سرور نیست؛ مدیر سرور باید آن را در پیکربندی سرور (network.allow) بیفزاید`,
  exactName: "برای فرستادن کلید، نام دقیق این میزبان باید در فهرست مجاز سرور باشد",
  webPrivate: "نسخهٔ وب فقط به ابزارهایی با نشانی عمومی وصل می‌شود؛ برای ابزار درون شبکهٔ سازمان رلهٔ کاریز یا ارسال از ابزار را به کار ببرید",
  notFound: (host: string) => `نام میزبان ${host} پیدا نشد؛ نشانی ابزار را بررسی کنید`,
  desktop: "منبع‌های داده و وضعیت پایش روی سرور اجرا و دیده می‌شوند",
  demo: "منبع نمایشی به شبکه وصل نمی‌شود",
  reenterKey: "کلید منبع را دوباره وارد کنید",
} as const;

/** A failure of a connector call: `network` and `rate_limited` are retried, the others end the pass at once. */
export class ConnectorError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(public readonly code: ConnectorErrorCode, message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
  get retryable(): boolean {
    return this.code === "network" || this.code === "rate_limited";
  }
}

/** The server kind of a stub descriptor: listed, never run (its package replaces the connector file). */
export function notBuilt(d: KindDescriptor, optionsSchema: ZodType<Record<string, unknown>>): ConnectorKind {
  const refuse = async (): Promise<never> => {
    throw new ConnectorError("not_built", CONNECTOR_MESSAGES.notBuilt(d.label));
  };
  return { ...d, headers: [], optionsSchema, test: refuse, pages: refuse };
}
