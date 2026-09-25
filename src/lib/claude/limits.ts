/**
 * Detects Claude subscription / API usage limits in runner output and estimates when they reset.
 * Claude Code prints messages such as:
 *   "You've hit your session limit · resets 5pm (Asia/Tehran)"
 *   "Claude AI usage limit reached|1759852800"
 *   "You've hit your weekly limit · resets Mon 9am"
 *   "Request rejected (429)"
 */
export interface LimitInfo {
  limited: boolean;
  resetAt: Date | null;
  kind: "session" | "weekly" | "model" | "rate" | "spend" | "unknown";
  message: string;
}

const LIMIT_RE =
  /(hit your (session|weekly|opus|sonnet|fable|usage|individual usage)? ?limit|usage limit reached|rate[_ ]limit|request rejected \(429\)|temporarily limiting requests|spend limit|overloaded_error|\b429\b)/i;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function zonedFormatter(tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
}

function zonedParts(date: Date, fmt: Intl.DateTimeFormat) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAYS.indexOf(String(p.weekday).toLowerCase().slice(0, 3)) };
}

/** Next wall-clock occurrence of hh:mm (optionally on a weekday) in a time zone. */
export function nextOccurrence(now: Date, hour: number, minute: number, tz: string, weekday?: number): Date {
  let tzOk = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tzOk = false;
  }
  const fmt = zonedFormatter(tzOk ? tz : "UTC");
  // Walk forward minute by minute for up to 8 days (DST-safe; only runs when a limit is hit).
  const start = new Date(Math.ceil(now.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 8 * 24 * 60; i += 1) {
    const t = new Date(start.getTime() + i * 60_000);
    const p = zonedParts(t, fmt);
    if (p.hour === hour && p.minute === minute && (weekday === undefined || p.weekday === weekday)) return t;
  }
  return new Date(now.getTime() + 3600_000);
}

export function detectClaudeLimit(text: string, now = new Date()): LimitInfo {
  const message = (text ?? "").slice(0, 2000);
  if (!LIMIT_RE.test(message)) return { limited: false, resetAt: null, kind: "unknown", message };

  const lower = message.toLowerCase();
  const kind: LimitInfo["kind"] = /weekly/.test(lower)
    ? "weekly"
    : /opus|sonnet|fable/.test(lower)
      ? "model"
      : /session|usage limit/.test(lower)
        ? "session"
        : /spend/.test(lower)
          ? "spend"
          : "rate";

  // 1) epoch seconds after a pipe: "...limit reached|1759852800"
  const epoch = message.match(/\|(\d{10})\b/);
  if (epoch) return { limited: true, resetAt: new Date(Number(epoch[1]) * 1000 + 60_000), kind, message };

  // 2) ISO timestamp
  const iso = message.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/);
  if (iso) return { limited: true, resetAt: new Date(new Date(iso[1]).getTime() + 60_000), kind, message };

  // 3) "resets [Mon] 5pm|5:30pm|17:00 (Area/City)"
  const m = message.match(/resets?\s+(?:at\s+)?(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i);
  if (m) {
    let hour = Number(m[2]);
    const minute = m[3] ? Number(m[3]) : 0;
    const ampm = m[4]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const tz = m[5]?.trim() || "UTC";
    const weekday = m[1] ? WEEKDAYS.indexOf(m[1].toLowerCase().slice(0, 3)) : undefined;
    const at = nextOccurrence(now, hour % 24, minute, tz, weekday);
    return { limited: true, resetAt: new Date(at.getTime() + 60_000), kind, message };
  }

  // 4) "retry after N seconds/minutes"
  const after = message.match(/(?:retry|try again)\s+(?:after|in)\s+(\d+)\s*(second|sec|s|minute|min|m|hour|h)/i);
  if (after) {
    const n = Number(after[1]);
    const unit = after[2].toLowerCase();
    const ms = unit.startsWith("h") ? n * 3600_000 : unit.startsWith("m") ? n * 60_000 : n * 1000;
    return { limited: true, resetAt: new Date(now.getTime() + ms + 30_000), kind, message };
  }

  const fallback = kind === "rate" ? 5 * 60_000 : kind === "weekly" ? 6 * 3600_000 : 60 * 60_000;
  return { limited: true, resetAt: new Date(now.getTime() + fallback), kind, message };
}
