// Read-only renderers of record values — list cells, the record view, kanban cards, the activity stream: one per
// field type, Persian digits and Jalali dates, numbers tabular and never cut, identifiers and Latin values as LTR
// isolates, choices as quiet coloured tags (a dot and the word: colour is never the only signal), people with their
// avatar, references as links to the record. Empty values are a quiet «—».
import { memo, type ReactNode } from "react";
import { Link } from "react-router";
import { Tooltip } from "antd";
import { Star, Lock, ExternalLink } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FieldDef, Option } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import type { Cond } from "@shared/model/conditions";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { Avatar, cx, phoneFa } from "../../components/blocks";
import { COLOR_LABELS } from "../model/colors";
import { displayOf, optionOf, valuesOf, type Schema } from "../model/schema";
import { formatDuration, numberText } from "../model/values";
import { describeFilter } from "../model/filter";
import { isMentionHref } from "../model/mentions";
import type { DisplayMap } from "../model/types";
import { recordPath } from "../extensions";
import "../../ai/markdown/markdown.css";
import "../records.css";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export const Empty = () => <span className="ds-zero">—</span>;

/** A choice value: a 6 px dot in its colour and the label, on a quiet tint. */
export function ChoiceTag({ option, value, strong }: { option?: Option; value?: string; strong?: boolean }) {
  const label = option?.label ?? value ?? "";
  if (!label) return <Empty />;
  return (
    <span className={cx("rk-tag", strong && "is-strong", option?.active === false && "is-off")} data-c={option?.color ?? "gray"} title={option?.active === false ? `${label} (غیرفعال)` : undefined}>
      <i aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/** A free tag (tags fields). */
export const PlainTag = ({ children }: { children: ReactNode }) => <span className="rk-ptag">{children}</span>;

/** A person: avatar and name; «(محدود)» when the caller may not see them. */
export function UserChip({ id, display, name, compact, me }: { id?: string | null; display?: DisplayMap; name?: string | null; compact?: boolean; me?: string | null }) {
  if (!id && !name) return <Empty />;
  const label = name ?? displayOf(display, id) ?? null;
  if (!label) return <span className="rk-restricted" title="به این مورد دسترسی ندارید"><Lock {...I14} aria-hidden />محدود</span>;
  return (
    <span className={cx("rk-user", compact && "is-compact")}>
      <Avatar name={label} />
      <span className="rk-user-n">{label}</span>
      {me && id === me ? <span className="rk-me">(من)</span> : null}
    </span>
  );
}

/** A record number («TODO0000012»): an LTR identifier in Geist Mono. */
export const RecordNo = ({ no, className }: { no: string | null | undefined; className?: string }) =>
  no ? (
    <bdi dir="ltr" className={cx("rk-no", className)}>
      {no}
    </bdi>
  ) : null;

/** A reference: its display text, a link to the record when the caller may read it. */
export function RefLink({ table, id, display, noLink, known = true }: { table: string | null; id: string; display?: DisplayMap; noLink?: boolean; known?: boolean }) {
  const { orgId } = useOrg();
  const label = displayOf(display, id);
  // a target table that does not exist yet (a module still to come): the id's start, not a false «restricted»
  if (!label && !known) return <bdi dir="ltr" className="ds-mono rk-idfrag" title={id}>{id.slice(0, 8)}</bdi>;
  if (!label) return <span className="rk-restricted" title="به این مورد دسترسی ندارید"><Lock {...I14} aria-hidden />محدود</span>;
  if (!table || noLink) return <span className="rk-ref">{label}</span>;
  return (
    <Link className="rk-ref ds-link" to={`/${orgId}/${recordPath(table, id)}`} onClick={(e) => e.stopPropagation()}>
      {label}
    </Link>
  );
}

/** «★★★☆☆» with the figure for screen readers. */
function Rating({ v, max = 5 }: { v: number; max?: number }) {
  return (
    <span className="rk-rating" role="img" aria-label={`${faDigits(v)} از ${faDigits(max)}`}>
      {Array.from({ length: max }, (_, i) => (
        <Star key={i} {...I14} className={i < v ? "is-on" : undefined} aria-hidden />
      ))}
    </span>
  );
}

export interface FieldValueProps {
  field: FieldDef;
  value: unknown;
  /** the table the field belongs to (references to "$self") */
  table: string;
  schema?: Schema;
  display?: DisplayMap;
  /** list cells and cards: one line, excerpts of long texts */
  compact?: boolean;
  /** the signed-in person (marks «(من)») */
  me?: string | null;
  tz?: string;
}

/** A stored value, read-only, for its field type. */
export const FieldValue = memo(function FieldValue({ field: f, value: v, table, schema, display, compact, me, tz }: FieldValueProps) {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return <Empty />;
  const t = f.type;
  const choices = schema?.choices ?? {};
  if (t === "bool") return <span className="rk-bool">{v === true || v === "true" ? "بله" : "خیر"}</span>;
  if (t === "rating") return <Rating v={Number(v) || 0} max={f.max ?? 5} />;
  if (t === "duration") return <span className="ds-num">{formatDuration(v)}</span>;
  if (FIELD_TYPES[t].numeric) return <span className="ds-num rk-fig">{numberText(f, v)}</span>;
  if (t === "date") return <span className="ds-num">{formatJalali(String(v))}</span>;
  if (t === "datetime") return <span className="ds-num">{formatJalaliDateTime(String(v), tz)}</span>;
  if (t === "choice") return <ChoiceTag option={optionOf(f, choices, v)} value={String(v)} />;
  if (t === "multichoice")
    return (
      <span className="rk-tags">
        {valuesOf(v).map((x) => (
          <ChoiceTag key={x} option={optionOf(f, choices, x)} value={x} />
        ))}
      </span>
    );
  if (t === "tags")
    return (
      <span className="rk-tags">
        {valuesOf(v).map((x) => (
          <PlainTag key={x}>{x}</PlainTag>
        ))}
      </span>
    );
  if (t === "color") {
    const k = String(v) as keyof typeof COLOR_LABELS;
    return (
      <span className="rk-tag" data-c={k}>
        <i aria-hidden />
        <span>{COLOR_LABELS[k] ?? String(v)}</span>
      </span>
    );
  }
  if (t === "user" || t === "users") {
    const ids = valuesOf(v);
    return (
      <span className={cx("rk-people", compact && "is-compact")}>
        {ids.map((id) => (
          <UserChip key={id} id={id} display={display} me={me} compact={compact && ids.length > 1} />
        ))}
      </span>
    );
  }
  if (t === "group" || t === "ref" || t === "refs") {
    const target = t === "group" ? (f.ref ?? "group") : f.ref === "$self" ? table : (f.ref ?? null);
    const known = !!target && !!schema?.def(target);
    const linkable = known && target !== "user";
    return (
      <span className="rk-refs">
        {valuesOf(v).map((id) => (
          <RefLink key={id} table={linkable ? target : null} id={id} display={display} known={known || !schema} />
        ))}
      </span>
    );
  }
  if (t === "email")
    return (
      <a className="ds-link ds-latin rk-ltr" dir="ltr" href={`mailto:${String(v)}`} onClick={(e) => e.stopPropagation()}>
        {String(v)}
      </a>
    );
  if (t === "url") {
    const s = String(v);
    const safe = /^https?:\/\//i.test(s);
    return safe ? (
      <a className="ds-link ds-latin rk-ltr" dir="ltr" href={s} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
        {compact ? s.replace(/^https?:\/\//i, "").slice(0, 48) : s}
        <ExternalLink {...I14} className="rk-ext" aria-hidden />
      </a>
    ) : (
      <bdi dir="ltr" className="ds-latin">{s}</bdi>
    );
  }
  if (t === "phone")
    return (
      <a className="ds-link ds-num rk-ltr" dir="ltr" href={`tel:${String(v).replace(/[^\d+]/g, "")}`} onClick={(e) => e.stopPropagation()}>
        {phoneFa(String(v))}
      </a>
    );
  if (t === "ip") return <bdi dir="ltr" className="ds-mono rk-ltr">{String(v)}</bdi>;
  if (t === "secret") {
    const hint = (v as { hint?: string } | null)?.hint;
    return (
      <span className="rk-secret">
        <Lock {...I14} aria-hidden />
        <bdi dir="ltr" className="ds-mono">{`••••${hint ? ` ${hint.replace(/^…/, "")}` : ""}`}</bdi>
      </span>
    );
  }
  if (t === "conditions") {
    const target = f.condTable ? schema?.def(f.condTable) : undefined;
    const text = target ? describeFilter(v as Cond, target, { lookup: schema?.lookup, choices, display, tz }) : "شرط";
    return <span className={cx("rk-cond", compact && "is-compact")}>{text}</span>;
  }
  if (t === "json") return <code dir="ltr" className={cx("rk-json", compact && "is-compact")}>{compact ? JSON.stringify(v).slice(0, 80) : JSON.stringify(v, null, 2)}</code>;
  if (t === "markdown") return compact ? <span className="rk-excerpt">{plainExcerpt(String(v))}</span> : <RecordMarkdown text={String(v)} display={display} />;
  if (t === "text") return <span className={cx("rk-text", compact && "is-compact")}>{String(v)}</span>;
  if (f.ltr) return <bdi dir="ltr" className="ds-latin rk-ltr">{String(v)}</bdi>;
  return <span className={compact ? "rk-cell-text" : undefined}>{String(v)}</span>;
});

/** The first ~140 characters of markdown as plain text (list cells, cards). */
export function plainExcerpt(md: string, max = 140): string {
  const s = md
    .replace(/@\[([^\]]+)\]\(mention:[^)]+\)/g, "@$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ---------------------------------------------------------------- markdown

const keepUrl = (url: string) => url;

/**
 * Safe Markdown of descriptions and journal entries: GitHub tables and lists, no raw HTML, no images (a remote image
 * leaks who reads it), links only to http(s), mail and the app's own pages, mentions as person chips.
 */
export function RecordMarkdown({ text, display, className }: { text: string; display?: DisplayMap; className?: string }) {
  const { orgId } = useOrg();
  const components: Components = {
    a: ({ href, children }) => {
      if (isMentionHref(href)) {
        const id = href!.slice("mention:".length);
        return (
          <span className="rk-mention" title={displayOf(display, id) ?? undefined}>
            {children}
          </span>
        );
      }
      const h = String(href ?? "");
      if (h.startsWith(`/${orgId}/`))
        return (
          <Link className="ds-link" to={h}>
            {children}
          </Link>
        );
      if (/^(https?:|mailto:)/i.test(h))
        return (
          <a className="ds-link" href={h} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      return <span>{children}</span>;
    },
    img: ({ alt }) => (alt ? <span className="sa-md-img">{alt}</span> : null),
    table: ({ children }) => (
      <div className="sa-md-table" tabIndex={0} role="region" aria-label="جدول">
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }) => (
      <pre dir="ltr" className="sa-md-pre">
        {children}
      </pre>
    ),
    code: ({ children, className: cls }) => (
      <code dir="ltr" className={cls}>
        {children}
      </code>
    ),
    h1: ({ children }) => <h3 className="sa-md-h">{children}</h3>,
    h2: ({ children }) => <h3 className="sa-md-h">{children}</h3>,
    h3: ({ children }) => <h4 className="sa-md-h sa-md-h4">{children}</h4>,
  };
  return (
    <div className={cx("sa-md rk-md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={keepUrl} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** A tooltip on a truncated cell (the full value on hover / focus). */
export const CellTip = ({ title, children }: { title: string; children: ReactNode }) => (
  <Tooltip title={title} mouseEnterDelay={0.6}>
    <span className="rk-cell-text">{children}</span>
  </Tooltip>
);
