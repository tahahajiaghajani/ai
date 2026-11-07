// Rendering a notification for ONE recipient under THAT recipient's access: the record is read through the engine
// with the recipient's context (`memberCtx`), so a recipient who cannot read it gets nothing (null), fields they may
// not see are absent and render as «(محدود)», references they may not read stay unnamed, dot-walks into records
// they may not read yield nothing, the change list leaves out hidden fields and an internal journal entry is only
// quoted to holders of the «internal» field group. Templates (`@shared/notify`) are filled from that view.
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import { APP_NAME } from "@shared/constants";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import {
  DEFAULT_TEMPLATES, NOTIFY_EVENTS, escapeMarkdown, plainLine, relayMarkdown, renderTemplate, templatePaths,
  type NotifyEvent, type TplScope,
} from "@shared/notify";
import type { Ctx, ServerConfig } from "../../context";
import { access } from "../../access/provider";
import { RefSet, condEnv, defFor, labelOf, list, pathVisible, resolveDisplay, type OrgSchema } from "../../engine";
import { recordAppPath, recordUrl, tzOf } from "./common";

/** What a queued delivery keeps of its event. */
export interface EventSnap {
  /** the notification event */
  event: NotifyEvent;
  /** the engine's kind (record.updated…) */
  kind: string;
  table: string;
  id: string;
  number: string | null;
  actor: string | null;
  at: string;
  from?: string | null;
  to?: string | null;
  from_category?: string | null;
  to_category?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  changed?: string[];
  entry?: { id: string; kind: string; visibility: string } | null;
  data?: Record<string, unknown>;
  custom?: string | null;
}

export interface TemplateText {
  subject: string;
  body: string;
  short_text?: string | null;
}

export interface Rendered {
  /** one line: in-app title, e-mail subject (without the number token) */
  title: string;
  /** Markdown (safe: record values escaped) */
  body: string;
  /** one line for SMS and messengers */
  short: string;
  /** absolute link (or the app path when the web address is unknown) */
  url: string;
  /** org-relative app path of the record */
  path: string;
  number: string | null;
  recordTitle: string;
  tableLabel: string;
}

export const RESTRICTED = "(محدود)";

/** Special placeholders (not fields of the record). */
const SPECIAL = /^(record|event|actor|recipient|org|app)\.|^(link|changes|comment|number)$/;

/** The record as the recipient sees it, or null when they may not read it. */
export async function recipientView(rctx: Ctx, table: string, id: string, paths: string[]) {
  const { def, schema } = await defFor(rctx, table);
  if (def.virtual || !access().canReadTable(rctx, def)) return null;
  const has = (n: string) => def.fields.some((f) => f.name === n);
  const plain = new Set<string>([def.display]);
  if (def.states) plain.add(def.states.field);
  const dots: string[] = [];
  for (const p of paths) {
    if (SPECIAL.test(p)) continue;
    const base = p.endsWith(".display") ? p.slice(0, -".display".length) : p;
    if (!base.includes(".")) {
      if (has(base)) plain.add(base);
    } else if (pathVisible(rctx, def, base, schema)) dots.push(base);
  }
  const r = await list(rctx, table, { ids: [id], fields: [...plain, ...dots], total: false, size: 1 });
  const row = r.rows[0];
  if (!row) return null;
  return { def, schema, row: row as Record<string, unknown>, display: { ...r.display } as Record<string, string> };
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [d ? `${d} روز` : "", h ? `${h} ساعت` : "", m ? `${m} دقیقه` : ""].filter(Boolean);
  return faDigits(parts.join(" و ") || "۰ دقیقه");
}

/** A field's value as people read it (labels, names, Jalali dates, Persian digits). */
export function displayValue(f: FieldDef, v: unknown, schema: OrgSchema, display: Record<string, string>, tz: string): string {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "";
  const family = FIELD_TYPES[f.type].family;
  if (family === "ref") {
    const one = (x: unknown) => display[String(x).toLowerCase()] ?? RESTRICTED;
    return Array.isArray(v) ? v.map(one).join("، ") : one(v);
  }
  switch (f.type) {
    case "datetime":
      return formatJalaliDateTime(String(v), tz);
    case "date":
      return formatJalali(String(v));
    case "duration":
      return formatDuration(Number(v));
    case "int":
    case "decimal":
    case "money":
    case "percent":
    case "rating":
      return formatNumber(String(v));
    case "secret":
    case "json":
    case "conditions":
      return "";
    default:
      return labelOf(f, v, schema);
  }
}

/** A field's stored value as text (`{{field}}`): ids, option values, ISO dates. */
function rawText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(String).join("، ");
  if (typeof v === "object") return "";
  return String(v);
}

export interface RenderOptions {
  cfg: Partial<ServerConfig>;
  /** the journal entry of a commented / mentioned event, read by the caller */
  entry?: { body: string; kind: string; visibility: string } | null;
}

/**
 * Render `tpl` for the recipient of `rctx`. Null when the recipient may not read the record (or, for a comment
 * event, the entry). Every placeholder is resolved from what the recipient may see.
 */
export async function renderFor(rctx: Ctx, ev: EventSnap, tpl: TemplateText, opts: RenderOptions): Promise<Rendered | null> {
  if (opts.entry && opts.entry.visibility === "internal" && !access().hasFieldGroup(rctx, "internal")) return null;
  const paths = templatePaths(tpl.subject, tpl.body, tpl.short_text ?? null);
  const view = await recipientView(rctx, ev.table, ev.id, paths);
  if (!view) return null;
  const { def, schema, row } = view;
  const env = await condEnv(rctx);
  const tz = tzOf(rctx.org);
  const visible = access().visibleFields(rctx, def);
  const seen = (f: FieldDef) => (!visible || visible.has(f.name)) && f.type !== "secret";
  const fieldOf = (name: string) => def.fields.find((f) => f.name === name);

  // labels of the people and records the change list and the actor name need, read as the recipient
  const refs = new RefSet();
  if (ev.actor) refs.add("user", ev.actor);
  const changeFields: FieldDef[] = [];
  for (const [name, c] of Object.entries(ev.changes ?? {})) {
    const f = fieldOf(name);
    if (!f || !seen(f) || f.audit === false || f.base) continue;
    changeFields.push(f);
    if (FIELD_TYPES[f.type].family === "ref") {
      const target = refTarget(f, def.key);
      for (const v of [c.from, c.to]) for (const x of Array.isArray(v) ? v : [v]) refs.add(target, x);
    }
  }
  const display = { ...view.display, ...(refs.size ? await resolveDisplay(rctx.db, rctx, env, schema, refs) : {}) };

  const title = (() => {
    const f = fieldOf(def.display);
    if (!f || !seen(f)) return RESTRICTED;
    return displayValue(f, row[def.display], schema, display, tz) || "—";
  })();
  const number = (row.number as string | null | undefined) ?? ev.number ?? null;
  const url = recordUrl(opts.cfg, rctx.org.id, def.key, ev.id);
  const stateLabel = (v: unknown) => {
    const sf = def.states ? fieldOf(def.states.field) : null;
    if (!sf || !seen(sf) || v === null || v === undefined) return "";
    return labelOf(sf, v, schema);
  };
  const changeLines = (md: boolean) =>
    changeFields.map((f) => {
      const c = ev.changes![f.name];
      const from = displayValue(f, c.from, schema, display, tz) || "خالی";
      const to = displayValue(f, c.to, schema, display, tz) || "خالی";
      return md ? `- **${escapeMarkdown(f.label)}**: ${escapeMarkdown(from)} ← ${escapeMarkdown(to)}` : `${f.label}: ${from} ← ${to}`;
    });
  const eventLabel = ev.event === "custom" && ev.custom ? String(ev.data?.label ?? ev.custom) : NOTIFY_EVENTS[ev.event].label;
  const comment = opts.entry?.body ?? "";

  const special = (path: string): { text: string; raw: unknown } | null => {
    switch (path) {
      case "link":
        return { text: url, raw: url };
      case "number":
      case "record.number":
        return { text: number ?? "", raw: number };
      case "record.title":
        return { text: title, raw: title };
      case "record.display":
        return { text: number ? `${number} — ${title}` : title, raw: title };
      case "record.table":
        return { text: def.label, raw: def.key };
      case "record.id":
        return { text: ev.id, raw: ev.id };
      case "event.label":
        return { text: eventLabel, raw: ev.event };
      case "event.from":
        return { text: stateLabel(ev.from), raw: ev.from ?? null };
      case "event.to":
        return { text: stateLabel(ev.to), raw: ev.to ?? null };
      case "changes": {
        const lines = changeLines(false);
        return { text: lines.join("؛ "), raw: lines.length ? lines : null };
      }
      case "comment":
        return { text: plainLine(comment, 2000), raw: comment || null };
      case "actor.name":
        return { text: ev.actor ? display[ev.actor] ?? "یک همکار" : "سامانه", raw: ev.actor };
      case "recipient.name":
        return { text: rctx.user.full_name || rctx.user.email, raw: rctx.user.id };
      case "org.name":
        return { text: rctx.org.name, raw: rctx.org.name };
      case "app.name":
        return { text: APP_NAME, raw: APP_NAME };
    }
    if (path.startsWith("event.")) {
      const v = ev.data?.[path.slice(6)];
      const scalar = v === null || v === undefined || typeof v === "object" ? "" : String(v);
      return { text: scalar, raw: v ?? null };
    }
    if (SPECIAL.test(path)) return { text: "", raw: null };
    return null;
  };

  const field = (path: string): { text: string; raw: unknown; f?: FieldDef } => {
    const displayWanted = path.endsWith(".display");
    const base = displayWanted ? path.slice(0, -".display".length) : path;
    if (base.includes(".")) {
      // a dot-walk the engine resolved under the recipient's access (absent when they may not see it)
      if (!(base in row)) return { text: RESTRICTED, raw: undefined };
      const v = row[base];
      return { text: rawText(v), raw: v };
    }
    const f = fieldOf(base);
    if (!f) return { text: "", raw: undefined };
    if (!seen(f)) return { text: RESTRICTED, raw: undefined };
    const v = row[base];
    return { text: displayWanted ? displayValue(f, v, schema, display, tz) : rawText(v), raw: v, f };
  };

  const scope: TplScope = {
    text: (p) => special(p)?.text ?? field(p).text,
    raw: (p) => {
      const s = special(p);
      return s ? s.raw : field(p).raw;
    },
    markdown: (p) => {
      if (p === "link") return url;
      if (p === "changes") return changeLines(true).join("\n");
      if (p === "comment") return comment ? relayMarkdown(comment) : "";
      if (SPECIAL.test(p) || p.endsWith(".display") || p.includes(".")) return null;
      const r = field(p);
      if (!r.f || typeof r.raw !== "string") return null;
      if (r.f.type === "markdown") return relayMarkdown(r.raw);
      if (r.f.type === "text") return escapeMarkdown(r.raw).replace(/\n/g, "  \n");
      return null;
    },
  };

  return {
    title: plainLine(renderTemplate(tpl.subject, scope, "plain"), 300) || `${eventLabel}: ${number ?? title}`,
    body: renderTemplate(tpl.body, scope, "markdown").replace(/\n{3,}/g, "\n\n").trim(),
    short: plainLine(renderTemplate(tpl.short_text || tpl.subject, scope, "plain"), 480),
    url,
    path: recordAppPath(def.key, ev.id),
    number,
    recordTitle: title,
    tableLabel: def.label,
  };
}

/** The default template of an event. */
export const defaultTemplate = (event: NotifyEvent): TemplateText => {
  const t = DEFAULT_TEMPLATES[event];
  return { subject: t.subject, body: t.body, short_text: t.short };
};
