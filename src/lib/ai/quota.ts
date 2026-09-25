/**
 * Parsing of Gemini API errors (429 RESOURCE_EXHAUSTED etc.) into actionable decisions.
 * The Gemini API reports per-minute and per-day quota violations with a RetryInfo delay.
 */
export interface GeminiErrorInfo {
  httpStatus: number;
  status: string;
  message: string;
  isQuota: boolean;
  isDaily: boolean;
  limitZero: boolean;
  retryDelayMs: number | null;
  quotaIds: string[];
  isOverloaded: boolean;
  isInvalid: boolean;
}

function findJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseDelay(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^([\d.]+)s$/);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

export function parseGeminiError(err: unknown): GeminiErrorInfo {
  const anyErr = err as { status?: number; message?: string; code?: number } | undefined;
  const raw = anyErr?.message ?? String(err);
  // The SDK sometimes wraps the API error JSON as a string inside another error object.
  let errorObj: Record<string, unknown> = {};
  let json = findJson(raw);
  for (let depth = 0; json && depth < 3; depth++) {
    errorObj = ((json.error as Record<string, unknown>) ?? json) as Record<string, unknown>;
    const inner = typeof errorObj.message === "string" ? errorObj.message.trim() : "";
    json = inner.startsWith("{") ? findJson(inner) : null;
  }
  const httpStatus = Number(anyErr?.status ?? errorObj.code ?? (raw.match(/\b(4\d\d|5\d\d)\b/)?.[1] ?? 0));
  const status = String(errorObj.status ?? "");
  const message = String(errorObj.message ?? raw);
  const details = (errorObj.details as Array<Record<string, unknown>>) ?? [];

  let retryDelayMs: number | null = null;
  const quotaIds: string[] = [];
  for (const d of details) {
    const type = String(d["@type"] ?? "");
    if (type.endsWith("RetryInfo")) retryDelayMs = parseDelay(d.retryDelay);
    if (type.endsWith("QuotaFailure")) {
      for (const v of (d.violations as Array<Record<string, unknown>>) ?? []) {
        if (v.quotaId) quotaIds.push(String(v.quotaId));
      }
    }
  }
  if (retryDelayMs === null) {
    const m = message.match(/retry in ([\d.]+)s/i);
    if (m) retryDelayMs = Math.ceil(Number(m[1]) * 1000);
  }

  const isQuota = httpStatus === 429 || status === "RESOURCE_EXHAUSTED";
  const isDaily = quotaIds.some((q) => /PerDay/i.test(q));
  const limitZero = /limit:\s*0\b/.test(message);
  const isOverloaded = httpStatus === 503 || httpStatus === 500 || status === "UNAVAILABLE" || status === "INTERNAL" || /overloaded/i.test(message);
  const isInvalid = httpStatus === 400 || status === "INVALID_ARGUMENT";

  return { httpStatus, status, message, isQuota, isDaily, limitZero, retryDelayMs, quotaIds, isOverloaded, isInvalid };
}

/** Daily Gemini quotas reset at midnight Pacific time. */
export function nextPacificMidnight(now = new Date()): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const elapsed = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  const remaining = 86400 - elapsed;
  return new Date(now.getTime() + remaining * 1000 + 2 * 60 * 1000);
}
