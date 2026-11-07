// Editors of record values, one per field type: text (LTR where the value is Latin by nature), Markdown with
// preview, numbers with live Persian grouping, Jalali dates and date-times (in the organisation's time zone),
// durations in hours and minutes, choices (a segmented control for up to four options, else a searchable select,
// dependent lists waiting for their parent), multi-choices, free tags, references and members (searchable pickers,
// «من» first), JSON, conditions (the FilterBuilder of the target table), colours, ratings and write-only secrets.
// The value given and returned is the engine's stored form (docs/spec/ENGINE.md §2).
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Input, Rate, Segmented, Select, Switch } from "antd";
import { Lock } from "lucide-react";
import type { Cond } from "@shared/model/conditions";
import type { FieldDef } from "@shared/model/types";
import { COLOR_KEYS } from "@shared/model/types";
import { normalizeDigits } from "@shared/money";
import { toFa } from "@shared/jalali";
import { localDate, zonedMidnight } from "@shared/model/jalali-buckets";
import { DateInput, NumberInput, PctInput } from "../../components/inputs";
import { cx } from "../../components/blocks";
import { COLOR_LABELS } from "../model/colors";
import { offeredOptions, targetOf, valuesOf, type Schema } from "../model/schema";
import { splitDuration } from "../model/values";
import type { DisplayMap, TableMeta } from "../model/types";
import { MarkdownEditor } from "./MarkdownEditor";
import { RecordSelect } from "./RecordSelect";
import { ChoiceTag } from "./display";
import { FilterBuilder } from "../filter/FilterBuilder";

export interface FieldInputProps {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  /** the table the field belongs to */
  def: TableMeta;
  schema: Schema;
  /** the form's current values (dependent choices, conditions on another field's table) */
  row?: Record<string, unknown>;
  display?: DisplayMap;
  disabled?: boolean;
  /** «اول «دسته» را انتخاب کنید»: a dependent list whose parent is empty */
  waitingFor?: string;
  status?: "error" | "warning";
  autoFocus?: boolean;
  id?: string;
  /** a list cell or a card: one line, small controls, no segmented choices */
  compact?: boolean;
  /** Enter in a one-line editor */
  onCommit?: () => void;
  /** Escape */
  onCancel?: () => void;
  tz: string;
  "aria-label"?: string;
}

const LTR_TYPES = new Set(["email", "url", "phone", "ip"]);

export function FieldInput(p: FieldInputProps) {
  const { field: f, value, onChange, def, schema, row, display, disabled, status, autoFocus, id, compact, onCommit, onCancel, tz } = p;
  const size = compact ? "small" : "middle";
  const label = p["aria-label"] ?? f.label;
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && onCommit) {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  const common = { id, disabled, status, autoFocus, "aria-label": label, size } as const;

  switch (f.type) {
    case "string":
    case "email":
    case "url":
    case "phone":
    case "ip": {
      const ltr = f.ltr || LTR_TYPES.has(f.type);
      return (
        <Input
          {...common}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          onKeyDown={keys}
          maxLength={f.maxLength ?? 500}
          placeholder={f.placeholder ?? (f.type === "url" ? "https://" : undefined)}
          dir={ltr ? "ltr" : undefined}
          className={ltr ? "ds-latin" : undefined}
          inputMode={f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "phone" ? "tel" : undefined}
          autoComplete="off"
        />
      );
    }
    case "text":
      return (
        <Input.TextArea
          {...common}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel?.()}
          autoSize={{ minRows: compact ? 1 : 3, maxRows: 12 }}
          maxLength={f.maxLength ?? 20000}
          placeholder={f.placeholder}
        />
      );
    case "markdown":
      return compact ? (
        <Input.TextArea {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} autoSize={{ minRows: 1, maxRows: 6 }} />
      ) : (
        <MarkdownEditor id={id} value={String(value ?? "")} onChange={(v) => onChange(v === "" ? null : v)} disabled={disabled} status={status} autoFocus={autoFocus} aria-label={label} placeholder={f.placeholder} display={display} />
      );
    case "int":
      return <NumberInput {...common} value={value as string | number | null} decimals={0} allowNegative={(f.min ?? 0) < 0} onChange={(v) => onChange(v === null ? null : Number(v))} onPressEnter={onCommit} />;
    case "decimal":
      return <NumberInput {...common} value={value as string | null} decimals={6} allowNegative={(f.min ?? 0) < 0} onChange={(v) => onChange(v)} onPressEnter={onCommit} />;
    case "money":
      return <NumberInput {...common} value={value as string | null} decimals={2} allowNegative={(f.min ?? 0) < 0} onChange={(v) => onChange(v)} onPressEnter={onCommit} />;
    case "percent":
      return <PctInput {...common} value={value as string | null} onChange={(v) => onChange(v)} onPressEnter={onCommit} />;
    case "rating":
      return <Rate count={f.max ?? 5} value={Number(value) || 0} onChange={(v) => onChange(v || null)} disabled={disabled} allowClear aria-label={label} className="rk-rate" />;
    case "duration":
      return <DurationInput {...common} value={value} onChange={onChange} onCommit={onCommit} />;
    case "bool":
      return (
        <span className="rk-switch">
          <Switch id={id} checked={value === true} onChange={(v) => onChange(v)} disabled={disabled} aria-label={label} size={compact ? "small" : "default"} autoFocus={autoFocus} />
          {compact ? null : <span className="text-ink-2">{value === true ? "بله" : "خیر"}</span>}
        </span>
      );
    case "date":
      return <DateInput {...common} value={(value as string | null) ?? null} onChange={(v) => onChange(v)} allowClear={!f.required} onPressEnter={onCommit} />;
    case "datetime":
      return <DateTimeInput {...common} value={(value as string | null) ?? null} onChange={onChange} tz={tz} allowClear={!f.required} onCommit={onCommit} />;
    case "choice":
      return <ChoiceInput {...p} size={size} />;
    case "multichoice": {
      const opts = offeredOptions(f, schema.choices, row ?? { [f.name]: value });
      return (
        <Select
          {...common}
          mode="multiple"
          value={valuesOf(value)}
          onChange={(v) => onChange(v)}
          options={opts.map((o) => ({ value: o.value, label: o.label, o }))}
          optionRender={(o) => <ChoiceTag option={(o.data as { o: (typeof opts)[number] }).o} />}
          showSearch={{ optionFilterProp: "label" }}
          maxTagCount="responsive"
          placeholder={f.placeholder ?? "انتخاب…"}
          onKeyDown={(e) => e.key === "Escape" && onCancel?.()}
        />
      );
    }
    case "tags":
      return (
        <Select
          {...common}
          mode="tags"
          value={valuesOf(value)}
          onChange={(v) => onChange((v as string[]).map((x) => x.trim()).filter(Boolean).slice(0, 50))}
          tokenSeparators={[",", "،"]}
          open={false}
          suffixIcon={null}
          placeholder={f.placeholder ?? "برچسب بنویسید و Enter بزنید"}
          maxTagCount={compact ? "responsive" : undefined}
        />
      );
    case "color":
      return (
        <Select
          {...common}
          value={(value as string) ?? undefined}
          allowClear={!f.required}
          onChange={(v) => onChange(v ?? null)}
          options={COLOR_KEYS.map((k) => ({ value: k, label: COLOR_LABELS[k] }))}
          optionRender={(o) => (
            <span className="rk-tag" data-c={String(o.value)}>
              <i aria-hidden />
              <span>{String(o.label)}</span>
            </span>
          )}
          placeholder="رنگ"
        />
      );
    case "user":
    case "users":
    case "ref":
    case "refs":
    case "group": {
      const target = targetOf(f, def) ?? (f.type === "group" ? "group" : "");
      return (
        <RecordSelect
          {...common}
          table={target}
          value={value as string | string[] | null}
          onChange={(v) => onChange(v)}
          multiple={f.type === "users" || f.type === "refs"}
          filter={f.refFilter ?? null}
          display={display}
          meFirst={target === "user"}
          openLink={!compact && (f.type === "ref" || f.type === "group")}
          placeholder={f.placeholder}
          allowClear={!f.required}
        />
      );
    }
    case "json":
      return <JsonInput {...common} value={value} onChange={onChange} />;
    case "conditions": {
      const key = f.condTable ?? (f.condTableField ? String(row?.[f.condTableField] ?? "") : "");
      const target = key ? schema.def(key) : undefined;
      if (!target) return <span className="text-ink-3">{key ? `جدول «${key}» در دسترس نیست` : "اول جدول را انتخاب کنید"}</span>;
      return <FilterBuilder def={target} schema={schema} value={(value as Cond | null) ?? null} onChange={(c) => onChange(c)} disabled={disabled} display={display} />;
    }
    case "secret":
      return <SecretInput {...common} value={value} onChange={onChange} />;
  }
}

// ---------------------------------------------------------------- choices

function ChoiceInput({ field: f, value, onChange, schema, row, disabled, status, autoFocus, id, compact, waitingFor, onCancel, ...rest }: FieldInputProps & { size: "small" | "middle" }) {
  const opts = offeredOptions(f, schema.choices, row ?? { [f.name]: value });
  const current = value === null || value === undefined ? null : String(value);
  if (waitingFor) return <Select id={id} disabled placeholder={`اول «${waitingFor}» را انتخاب کنید`} size={rest.size} aria-label={f.label} />;
  if (!compact && opts.length > 0 && opts.length <= 4 && !disabled) {
    const items = [...(f.required ? [] : [{ value: "", label: <span className="text-ink-3">—</span> }]), ...opts.map((o) => ({ value: o.value, label: <ChoiceTag option={o} /> }))];
    return (
      <Segmented
        id={id}
        className="rk-seg"
        value={current ?? ""}
        onChange={(v) => onChange(v === "" ? null : String(v))}
        options={items}
        aria-label={f.label}
      />
    );
  }
  return (
    <Select
      id={id}
      size={rest.size}
      status={status}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={f.label}
      value={current ?? undefined}
      allowClear={!f.required}
      onChange={(v) => onChange(v ?? null)}
      onKeyDown={(e) => e.key === "Escape" && onCancel?.()}
      showSearch={opts.length > 8 ? { optionFilterProp: "label" } : undefined}
      options={opts.map((o) => ({ value: o.value, label: o.label, o }))}
      optionRender={(o) => <ChoiceTag option={(o.data as { o: (typeof opts)[number] }).o} />}
      labelRender={(l) => {
        const o = opts.find((x) => x.value === l.value);
        return o ? <ChoiceTag option={o} /> : <span>{String(l.label ?? l.value)}</span>;
      }}
      placeholder={f.placeholder ?? "انتخاب…"}
      popupMatchSelectWidth={false}
    />
  );
}

// ---------------------------------------------------------------- date-time, duration, JSON, secret

interface SmallProps {
  id?: string;
  disabled?: boolean;
  status?: "error" | "warning";
  autoFocus?: boolean;
  size?: "small" | "middle";
  "aria-label"?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** «۹:۳۰» → minutes after midnight; null when it is not a time. */
export function parseTime(s: string): number | null {
  const t = normalizeDigits(s).replace(/[٫.]/g, ":").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** A date-time: a Jalali date and a 24-hour time, both in the organisation's zone; the value is an ISO instant. */
export function DateTimeInput({ value, onChange, tz, allowClear, onCommit, ...rest }: SmallProps & { value: string | null; onChange: (v: string | null) => void; tz: string; allowClear?: boolean; onCommit?: () => void }) {
  const ms = value ? Date.parse(value) : NaN;
  const day = Number.isNaN(ms) ? null : localDate(ms, tz);
  const minutes = day ? Math.round((ms - zonedMidnight(day, tz)) / 60000) : null;
  const shown = minutes === null ? "" : toFa(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  const [time, setTime] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setTime(shown);
    setBad(false);
  }, [shown]);
  const emit = (d: string | null, mins: number | null) => {
    if (!d) return onChange(null);
    onChange(new Date(zonedMidnight(d, tz) + (mins ?? 9 * 60) * 60000).toISOString());
  };
  return (
    <span className="rk-dt">
      <DateInput {...rest} value={day} onChange={(d) => emit(d, minutes)} allowClear={allowClear} onPressEnter={onCommit} />
      <Input
        size={rest.size}
        disabled={rest.disabled || !day}
        status={bad ? "error" : rest.status}
        className="rk-time ds-numin"
        dir="ltr"
        inputMode="numeric"
        aria-label="ساعت"
        placeholder="۰۹:۰۰"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        onBlur={() => {
          const m = parseTime(time);
          if (m === null && time.trim()) return setBad(true);
          setBad(false);
          if (day) emit(day, m ?? 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
            onCommit?.();
          }
        }}
      />
    </span>
  );
}

/** A duration in hours and minutes; the value is seconds. */
export function DurationInput({ value, onChange, onCommit, ...rest }: SmallProps & { value: unknown; onChange: (v: unknown) => void; onCommit?: () => void }) {
  const parts = splitDuration(value);
  const set = (h: number | null, m: number | null) => {
    if (h === null && m === null) return onChange(null);
    onChange(((h ?? 0) * 3600 + (m ?? 0) * 60) | 0);
  };
  return (
    <span className="rk-dur">
      <NumberInput {...rest} aria-label="ساعت" value={parts ? parts.h : null} decimals={0} suffix={<span>ساعت</span>} onChange={(v) => set(v === null ? null : Number(v), parts?.m ?? null)} onPressEnter={onCommit} />
      <NumberInput {...rest} autoFocus={false} aria-label="دقیقه" value={parts ? parts.m : null} decimals={0} suffix={<span>دقیقه</span>} onChange={(v) => set(parts?.h ?? null, v === null ? null : Math.min(59, Number(v)))} onPressEnter={onCommit} />
    </span>
  );
}

/** JSON as text: parsed on blur (an error keeps the text and marks the box). */
function JsonInput({ value, onChange, ...rest }: SmallProps & { value: unknown; onChange: (v: unknown) => void }) {
  const initial = useMemo(() => (value === null || value === undefined ? "" : JSON.stringify(value, null, 2)), [value]);
  const [text, setText] = useState(initial);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(initial), [initial]);
  return (
    <Input.TextArea
      {...rest}
      status={bad ? "error" : rest.status}
      dir="ltr"
      className="ds-mono"
      autoSize={{ minRows: 3, maxRows: 16 }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!text.trim()) {
          setBad(false);
          return onChange(null);
        }
        try {
          onChange(JSON.parse(text));
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

/** A secret is never shown: its hint, and a box to type a new value (empty keeps the old one). */
function SecretInput({ value, onChange, ...rest }: SmallProps & { value: unknown; onChange: (v: unknown) => void }) {
  const stored = value && typeof value === "object" ? (value as { hint?: string }) : null;
  const [text, setText] = useState(typeof value === "string" ? value : "");
  return (
    <span className="rk-secret-in">
      <Input.Password
        {...rest}
        dir="ltr"
        autoComplete="new-password"
        value={text}
        placeholder={stored ? "برای تغییر، مقدار تازه را بنویسید" : "مقدار را بنویسید"}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value ? e.target.value : stored ? { secret: true } : null);
        }}
      />
      {stored ? (
        <span className={cx("rk-secret-hint")}>
          <Lock size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
          <bdi dir="ltr" className="ds-mono">{`••••${stored.hint ? ` ${stored.hint.replace(/^…/, "")}` : ""}`}</bdi>
        </span>
      ) : null}
    </span>
  );
}
