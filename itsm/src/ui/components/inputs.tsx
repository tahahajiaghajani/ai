// Inputs tuned for fast Persian data entry: amounts with live separators (and «+» = three
// zeros), Jalali dates typed or picked, and searchable selects backed by the API.
// Look (components.md §5): numbers and dates are typed LTR but sit start-aligned (right) with tabular figures, units
// quiet in text-3 at the end, the amount in words underneath, the whole value selected on keyboard focus.
import "./kit.css";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Input, Popover, Select, Button, Dropdown, type InputRef } from "antd";
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, X, Check, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { D, normalizeDigits } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { numberToWords } from "@shared/words";
import {
  JALALI_MONTHS, WEEKDAYS_SHORT, addDays, formatJalali, fromJalali, monthLength, parseJalaliInput, presetRange, toJalali, todayISO, weekday,
} from "@shared/jalali";
import { useOrg } from "../lib/org";
import { Loader } from "./display";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/**
 * Select-all when a field is reached from the keyboard (Tab, Enter-to-next), not when it is clicked: a clerk tabbing
 * into a prefilled amount overwrites it, a click still places the caret (components.md §5).
 */
function useKeyboardSelectAll() {
  const pointer = useRef(false);
  return {
    onPointerDown: () => {
      pointer.current = true;
    },
    select: (el: HTMLInputElement | null | undefined) => {
      if (!pointer.current && el) requestAnimationFrame(() => el.select());
      pointer.current = false;
    },
  };
}

// ---------------------------------------------------------------- numbers

export interface NumberInputProps {
  value?: string | number | null;
  onChange?: (v: string | null) => void;
  decimals?: number;
  allowNegative?: boolean;
  placeholder?: string;
  suffix?: ReactNode;
  prefix?: ReactNode;
  words?: boolean | string;
  disabled?: boolean;
  readOnly?: boolean;
  size?: "small" | "middle" | "large";
  status?: "error" | "warning";
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onPressEnter?: () => void;
  onBlur?: () => void;
  variant?: "outlined" | "borderless" | "filled";
  id?: string;
}

function groupForDisplay(raw: string): string {
  if (!raw) return "";
  const neg = raw.startsWith("-");
  const body = neg ? raw.slice(1) : raw;
  const [i, f] = body.split(".");
  const gi = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return faDigits(`${neg ? "-" : ""}${gi}${f !== undefined ? `.${f}` : ""}`).replace(/,/g, "٬").replace(/\./g, "٫");
}

function cleanTyped(s: string, decimals: number, allowNegative: boolean): string {
  let t = normalizeDigits(s).replace(/[٬,،\s_]/g, "").replace(/٫/g, ".").replace(/[−–]/g, "-");
  const neg = allowNegative && t.startsWith("-");
  t = t.replace(/[^\d.]/g, "");
  const dot = t.indexOf(".");
  if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");
  if (decimals === 0) t = t.replace(/\..*$/, "");
  else if (dot >= 0) t = t.slice(0, dot + 1 + decimals);
  t = t.replace(/^0+(?=\d)/, "");
  return (neg ? "-" : "") + t;
}

/** Amount/decimal input. Value is a plain decimal string (or null). «+» or «*» appends 000. */
export function NumberInput({ value, onChange, decimals = 0, allowNegative, words, suffix, prefix, onPressEnter, ...rest }: NumberInputProps) {
  const ref = useRef<InputRef>(null);
  const kbd = useKeyboardSelectAll();
  const toRaw = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : D(v).toDecimalPlaces(Math.max(decimals, 0)).toFixed());
  const [raw, setRaw] = useState(toRaw(value));
  const focused = useRef(false);
  // last value we sent out or accepted from outside
  const known = useRef<string>(toRaw(value));
  useEffect(() => {
    const incoming = toRaw(value);
    // follow outside changes (e.g. «=» fills the balancing amount) even while focused,
    // but don't fight the user's own typing (trailing dot, leading minus…)
    if (!focused.current || incoming !== toRaw(known.current)) {
      setRaw(incoming);
      known.current = incoming;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  const emit = (r: string) => {
    setRaw(r);
    const out = r === "" || r === "-" ? null : r;
    known.current = out ?? "";
    onChange?.(out);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "+" || e.key === "*") && !e.ctrlKey) {
      e.preventDefault();
      const base = raw === "" || raw === "-" ? "1" : raw.split(".")[0];
      emit(cleanTyped(`${base}000`, decimals, !!allowNegative));
    } else if (e.key === "Enter") onPressEnter?.();
  };

  const wordsText = useMemo(() => {
    if (!words || !raw || raw === "-") return "";
    try {
      return `${numberToWords(raw)}${typeof words === "string" ? ` ${words}` : ""}`;
    } catch {
      return "";
    }
  }, [raw, words]);

  return (
    <div className="w-full">
      <Input
        {...rest}
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        dir="ltr"
        className={`ds-numin ${rest.className ?? ""}`}
        style={rest.style}
        value={groupForDisplay(raw)}
        prefix={prefix}
        suffix={suffix}
        onPointerDown={kbd.onPointerDown}
        onFocus={(e) => {
          focused.current = true;
          kbd.select(e.target);
        }}
        onBlur={() => {
          focused.current = false;
          rest.onBlur?.();
        }}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const el = e.target;
          const caret = el.selectionStart ?? el.value.length;
          const digitsBefore = normalizeDigits(el.value.slice(0, caret)).replace(/[^\d.\-]/g, "").length;
          const next = cleanTyped(el.value, decimals, !!allowNegative);
          emit(next);
          requestAnimationFrame(() => {
            const input = ref.current?.input;
            if (!input) return;
            const shown = input.value;
            let count = 0;
            let pos = shown.length;
            for (let i = 0; i < shown.length; i++) {
              if (/[\d۰-۹٫.\-]/.test(shown[i])) count++;
              if (count >= digitsBefore) {
                pos = i + 1;
                break;
              }
            }
            if (digitsBefore === 0) pos = 0;
            input.setSelectionRange(pos, pos);
          });
        }}
      />
      {wordsText ? <div className="ds-words">{wordsText}</div> : null}
    </div>
  );
}

/** An amount of money with `currencyDecimals` decimals (default 0) and, with `unit`, its currency after it. */
export function MoneyInput(props: NumberInputProps & { currencyDecimals?: number; unit?: ReactNode }) {
  const { currencyDecimals, unit, ...rest } = props;
  return <NumberInput decimals={currencyDecimals ?? 0} suffix={unit ? <span>{unit}</span> : rest.suffix} {...rest} />;
}

export function PctInput(props: NumberInputProps) {
  return <NumberInput decimals={3} suffix={<span>٪</span>} {...props} />;
}

// ---------------------------------------------------------------- dates

/**
 * The Jalali month grid (antd-theme.md §7): 7 × 6 cells, today a neutral ring at 600, the selected day the calendar's
 * one accent element, Fridays in the holiday red. Keyboard: ←/→ a day (mirrored: ← is the next day), ↑/↓ a week,
 * PageUp/PageDown a month, Home/End the row, Enter picks, Esc closes.
 */
export function JalaliCalendar({
  value, onPick, autoFocus, onEscape, range,
}: {
  value: string | null;
  onPick: (iso: string) => void;
  autoFocus?: boolean;
  onEscape?: () => void;
  /** a range being picked: both ends are selected days, the days between a quiet tint */
  range?: { from: string | null; to: string | null };
}) {
  const today = todayISO();
  const start = value ? toJalali(value) : range?.from ? toJalali(range.from) : toJalali(today);
  const [view, setView] = useState({ jy: start.jy, jm: start.jm });
  const [cursor, setCursor] = useState<string>(value ?? today);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) grid.current?.focus();
  }, [autoFocus]);
  const len = monthLength(view.jy, view.jm);
  const first = fromJalali(view.jy, view.jm, 1);
  const offset = weekday(first);
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: len }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const move = (d: number) => {
    let { jy, jm } = view;
    jm += d;
    if (jm < 1) {
      jm = 12;
      jy -= 1;
    } else if (jm > 12) {
      jm = 1;
      jy += 1;
    }
    setView({ jy, jm });
  };
  const goTo = (iso: string) => {
    setCursor(iso);
    const j = toJalali(iso);
    if (j.jy !== view.jy || j.jm !== view.jm) setView({ jy: j.jy, jm: j.jm });
  };
  const shiftMonth = (iso: string, d: number) => {
    const j = toJalali(iso);
    let jm = j.jm + d;
    let jy = j.jy;
    if (jm < 1) {
      jm += 12;
      jy -= 1;
    } else if (jm > 12) {
      jm -= 12;
      jy += 1;
    }
    return fromJalali(jy, jm, Math.min(j.jd, monthLength(jy, jm)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const wd = weekday(cursor);
    const k: Record<string, () => void> = {
      ArrowLeft: () => goTo(addDays(cursor, 1)),
      ArrowRight: () => goTo(addDays(cursor, -1)),
      ArrowDown: () => goTo(addDays(cursor, 7)),
      ArrowUp: () => goTo(addDays(cursor, -7)),
      PageDown: () => goTo(shiftMonth(cursor, 1)),
      PageUp: () => goTo(shiftMonth(cursor, -1)),
      Home: () => goTo(addDays(cursor, -wd)),
      End: () => goTo(addDays(cursor, 6 - wd)),
      Enter: () => onPick(cursor),
      " ": () => onPick(cursor),
      Escape: () => onEscape?.(),
    };
    const f = k[e.key];
    if (f) {
      e.preventDefault();
      e.stopPropagation();
      f();
    }
  };
  return (
    <div className="ds-cal">
      <div className="ds-cal-h">
        <Button size="small" type="text" icon={<ChevronRight {...ICON} />} onClick={() => move(-1)} aria-label="ماه قبل" />
        <div className="ds-cal-title">
          <Select
            size="small"
            variant="borderless"
            value={view.jm}
            popupMatchSelectWidth={false}
            onChange={(jm) => setView({ ...view, jm })}
            options={JALALI_MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
            aria-label="ماه"
          />
          <Select
            size="small"
            variant="borderless"
            value={view.jy}
            popupMatchSelectWidth={false}
            onChange={(jy) => setView({ ...view, jy })}
            options={Array.from({ length: 31 }, (_, i) => start.jy - 15 + i).map((y) => ({ value: y, label: faDigits(y) }))}
            aria-label="سال"
          />
        </div>
        <Button size="small" type="text" icon={<ChevronLeft {...ICON} />} onClick={() => move(1)} aria-label="ماه بعد" />
      </div>
      <div className="ds-cal-wd" aria-hidden>
        {WEEKDAYS_SHORT.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="ds-cal-days" ref={grid} tabIndex={0} role="grid" aria-label={`${JALALI_MONTHS[view.jm - 1]} ${faDigits(view.jy)}`} onKeyDown={onKey}>
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const iso = fromJalali(view.jy, view.jm, d);
          const end = !!range && (iso === range.from || iso === range.to);
          const inside = !!range?.from && !!range.to && iso > range.from && iso < range.to;
          const cls = ["ds-cal-d", (iso === value || end) && "is-sel", inside && "is-in", iso === today && "is-today", i % 7 === 6 && "is-fri", iso === cursor && "is-cursor"].filter(Boolean).join(" ");
          return (
            <button key={i} type="button" tabIndex={-1} role="gridcell" aria-selected={iso === value || end} onClick={() => onPick(iso)} className={cls}>
              {faDigits(d)}
            </button>
          );
        })}
      </div>
      <div className="ds-cal-f">
        <button type="button" className="ds-link" onClick={() => onPick(today)}>
          امروز
        </button>
        <span className="ds-cal-f-date">{formatJalali(today, { style: "full" })}</span>
      </div>
    </div>
  );
}

export interface DateInputProps {
  value?: string | null;
  onChange?: (iso: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: "small" | "middle" | "large";
  allowClear?: boolean;
  className?: string;
  style?: React.CSSProperties;
  variant?: "outlined" | "borderless" | "filled";
  onPressEnter?: () => void;
  autoFocus?: boolean;
  id?: string;
  "aria-label"?: string;
}

/** Jalali date: type `1405/1/15`, `15` or `امروز`, or pick from the calendar (↓ moves into it). Value is ISO. */
export function DateInput({ value, onChange, placeholder = "۱۴۰۵/۰۱/۱۵", allowClear, onPressEnter, ...rest }: DateInputProps) {
  const [text, setText] = useState(value ? formatJalali(value) : "");
  const [open, setOpen] = useState(false);
  const [gridFocus, setGridFocus] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const input = useRef<InputRef>(null);
  const kbd = useKeyboardSelectAll();
  useEffect(() => {
    if (!focused.current) setText(value ? formatJalali(value) : "");
    setInvalid(false);
  }, [value]);

  const commit = () => {
    if (!text.trim()) {
      setInvalid(false);
      if (value) onChange?.(null);
      return;
    }
    const iso = parseJalaliInput(text);
    if (!iso) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatJalali(iso));
    if (iso !== value) onChange?.(iso);
  };

  const step = (days: number) => {
    const base = value ?? todayISO();
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const iso = d.toISOString().slice(0, 10);
    onChange?.(iso);
    setText(formatJalali(iso));
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    setGridFocus(false);
    if (refocus) input.current?.focus();
  };

  return (
    <Popover
      open={open && !rest.disabled}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setGridFocus(false);
      }}
      trigger={["click"]}
      placement="bottomRight"
      destroyOnHidden
      content={
        <JalaliCalendar
          value={value ?? null}
          autoFocus={gridFocus}
          onEscape={() => close(true)}
          onPick={(iso) => {
            onChange?.(iso);
            setText(formatJalali(iso));
            setInvalid(false);
            close(gridFocus);
          }}
        />
      }
    >
      <Input
        {...rest}
        ref={input}
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        className={`ds-numin ${rest.className ?? ""}`}
        style={rest.style}
        status={invalid ? "error" : undefined}
        aria-invalid={invalid || undefined}
        value={text}
        placeholder={placeholder}
        allowClear={allowClear}
        // with a value, the clear × takes the calendar's place (a 144 px filter field has no room for both)
        suffix={allowClear && text ? <span /> : <Calendar {...ICON} className="text-ink-3" aria-hidden />}
        onPointerDown={kbd.onPointerDown}
        onFocus={(e) => {
          focused.current = true;
          kbd.select(e.target);
        }}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (!v && allowClear) onChange?.(null);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            setOpen(false);
            onPressEnter?.();
          } else if (e.key === "ArrowUp" && e.altKey) {
            e.preventDefault();
            step(1);
          } else if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            step(-1);
          } else if (e.key === "ArrowDown" && !e.ctrlKey && !e.shiftKey) {
            // ↓ opens the calendar and moves into its grid
            e.preventDefault();
            setOpen(true);
            setGridFocus(true);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
    </Popover>
  );
}

// ---------------------------------------------------------------- remote selects

export interface Opt {
  id: string;
  label: string;
  sub?: string | null;
  [k: string]: any;
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export interface RefSelectProps {
  entity: string;
  value?: string | null;
  onChange?: (id: string | null, option?: Opt) => void;
  filters?: Record<string, string | undefined>;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  size?: "small" | "middle" | "large";
  className?: string;
  style?: React.CSSProperties;
  variant?: "outlined" | "borderless" | "filled";
  showCode?: boolean;
  status?: "error" | "warning";
  autoFocus?: boolean;
  /** extra rendering of an option row */
  render?: (o: Opt) => ReactNode;
  id?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  popupWidth?: number;
}

/** Searchable select over /data/:entity/options (type a name, code, mobile …). */
export function RefSelect({ entity, value, onChange, filters, placeholder, showCode = true, render, popupWidth, ...rest }: RefSelectProps) {
  const { api } = useOrg();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters ?? {})) if (v) f[`f.${k}`] = v;
  const list = useQuery({
    queryKey: ["options", entity, q, f],
    queryFn: () => api.get<{ options: Opt[] }>(`/data/${entity}/options`, { q, ...f }).then((r) => r.options),
    staleTime: 30_000,
  });
  const selected = useQuery({
    queryKey: ["option", entity, value],
    queryFn: () => api.get<{ options: Opt[] }>(`/data/${entity}/options`, { ids: value ?? "" }).then((r) => r.options[0] ?? null),
    enabled: !!value && !(list.data ?? []).some((o) => o.id === value),
    staleTime: 300_000,
  });
  const options = useMemo(() => {
    const all = [...(list.data ?? [])];
    if (selected.data && !all.some((o) => o.id === selected.data!.id)) all.unshift(selected.data);
    return all;
  }, [list.data, selected.data]);
  return (
    <Select
      {...rest}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      value={value ?? undefined}
      placeholder={placeholder ?? "جستجو و انتخاب…"}
      notFoundContent={list.isFetching ? <div className="grid place-items-center py-3"><Loader /></div> : <div className="py-2 text-center text-ink-3">موردی پیدا نشد</div>}
      onChange={(id) => onChange?.((id as string) ?? null, options.find((o) => o.id === id))}
      onOpenChange={(o) => !o && setSearch("")}
      popupMatchSelectWidth={popupWidth ?? true}
      options={options.map((o) => ({
        value: o.id,
        label: showCode && o.sub ? `${faDigits(o.sub)} — ${o.label}` : o.label,
        option: o,
      }))}
      optionRender={(o) => {
        const opt = (o.data as { option: Opt }).option;
        if (render) return render(opt);
        return showCode && opt.sub ? (
          <span className="ds-opt">
            <span className="ds-opt-code">{faDigits(opt.sub)}</span>
            <span className="ds-opt-main">{opt.label}</span>
          </span>
        ) : (
          <span className="ds-opt-main">{opt.label}</span>
        );
      }}
    />
  );
}

// ---------------------------------------------------------------- filter chips (components.md §2)

const cxi = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const CHEV = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

function ChipIcon({ icon }: { icon?: LucideIcon | ReactNode }) {
  if (!icon) return null;
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in (icon as object))) {
    const I = icon as LucideIcon;
    return <I {...ICON} className="ds-fchip-ic" aria-hidden />;
  }
  return <span className="ds-fchip-ic">{icon as ReactNode}</span>;
}

/** The × that clears an applied chip: its own button, so the chip itself still opens the menu. */
function ChipClear({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      className="ds-fchip-x"
      aria-label={`پاک کردن ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
    >
      <X {...CHEV} aria-hidden />
    </button>
  );
}

export interface FilterChipProps {
  /** the dimension («وضعیت»، «نوع سند»): the chip's words at rest */
  label: string;
  value?: string | null;
  onChange?: (v: string | null) => void;
  options: { value: string; label: ReactNode }[];
  /** a 16 px lucide icon (text-3) before the words */
  icon?: LucideIcon | ReactNode;
  /** show the × when applied (default true) */
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * A dimension filter (components.md §2): a 30 px pill with no ring at rest (the ring and the hover tint appear on
 * hover), the chevron right after the words; applied, it is the row's one accent element (accent-tint-2 fill,
 * accent-text, accent-border ring) and shows the chosen value with an × to clear.
 */
export function FilterChip({ label, value, onChange, options, icon, allowClear = true, disabled, className }: FilterChipProps) {
  const on = value !== undefined && value !== null && value !== "";
  const current = on ? options.find((o) => o.value === value) : undefined;
  return (
    <span className={cxi("ds-fchip", on && "is-on", disabled && "is-disabled", className)}>
      <Dropdown
        trigger={["click"]}
        disabled={disabled}
        placement="bottomRight"
        rootClassName="ds-glass ds-fchip-menu"
        menu={{
          selectable: true,
          selectedKeys: on ? [String(value)] : [],
          items: options.map((o) => ({ key: String(o.value), label: o.label, extra: o.value === value ? <Check {...CHEV} aria-hidden /> : undefined })),
          onClick: ({ key }) => onChange?.(key === value && allowClear ? null : key),
        }}
      >
        <button type="button" className="ds-fchip-b" aria-haspopup="menu" aria-label={on ? `${label}: ${typeof current?.label === "string" ? current.label : value}` : label} disabled={disabled}>
          <ChipIcon icon={icon} />
          <span className="ds-fchip-t">{on ? current?.label ?? String(value) : label}</span>
          {on && allowClear ? null : <ChevronDown {...CHEV} className="ds-fchip-chev" aria-hidden />}
        </button>
      </Dropdown>
      {on && allowClear ? <ChipClear label={label} onClear={() => onChange?.(null)} /> : null}
    </span>
  );
}

/**
 * A boolean filter («با پیش‌نویس‌ها»، «سررسیدگذشته»): the same pill with a 14 px box at the start that reads as a
 * toggle at rest and fills with a check when on (then the chip wears the applied accent tint). `aria-pressed`.
 */
export function ToggleChip({ on, onChange, children, title, disabled, className }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; title?: string; disabled?: boolean; className?: string }) {
  return (
    <span className={cxi("ds-fchip ds-tchip", on && "is-on", disabled && "is-disabled", className)}>
      <button type="button" className="ds-fchip-b" aria-pressed={on} title={title} disabled={disabled} onClick={() => onChange(!on)}>
        <span className="ds-tchip-box" aria-hidden>
          {on ? <Check size={10} strokeWidth={2.5} absoluteStrokeWidth /> : null}
        </span>
        <span className="ds-fchip-t">{children}</span>
      </button>
    </span>
  );
}

export interface DateRange {
  from: string | null;
  to: string | null;
}

const RANGE_PRESETS: { key: "today" | "week" | "month" | "lastMonth" | "quarter" | "year"; label: string }[] = [
  { key: "today", label: "امروز" },
  { key: "week", label: "این هفته" },
  { key: "month", label: "این ماه" },
  { key: "lastMonth", label: "ماه قبل" },
  { key: "quarter", label: "این فصل" },
  { key: "year", label: "امسال" },
];

/** «۱۴۰۵/۰۸/۰۱ تا ۱۴۰۵/۰۸/۳۰», «از ۱۴۰۵/۰۸/۰۱», «تا ۱۴۰۵/۰۸/۳۰» or «امروز». */
function rangeText({ from, to }: DateRange): string {
  const today = todayISO();
  const preset = from && to ? RANGE_PRESETS.find((p) => { const r = presetRange(p.key, today); return r.from === from && r.to === to; }) : undefined;
  if (preset) return preset.label;
  if (from && to && from === to) return from === today ? "امروز" : formatJalali(from);
  if (from && to) return `${formatJalali(from)} تا ${formatJalali(to)}`;
  if (from) return `از ${formatJalali(from)}`;
  if (to) return `تا ${formatJalali(to)}`;
  return "";
}

/**
 * One chip for a date range (components.md §2: «A custom range is a filter chip that opens the Jalali range
 * picker»). The popover holds the presets, the two typed fields and a month grid: the first click sets the start,
 * the second the end. The × shows only when a range is set.
 */
export function DateRangeChip({ value, onChange, label = "تاریخ", className }: { value: DateRange; onChange: (r: DateRange) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const [picking, setPicking] = useState<"from" | "to">("from");
  useEffect(() => {
    if (open) {
      setDraft(value);
      setPicking("from");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const on = !!(value.from || value.to);
  const commit = (r: DateRange, close = true) => {
    onChange(r);
    setDraft(r);
    if (close) setOpen(false);
  };
  const pick = (iso: string) => {
    if (picking === "from" || !draft.from) {
      setDraft({ from: iso, to: null });
      setPicking("to");
      return;
    }
    const [a, b] = iso < draft.from ? [iso, draft.from] : [draft.from, iso];
    commit({ from: a, to: b });
  };
  const today = todayISO();
  const content = (
    <div className="ds-range">
      <div className="ds-range-p" role="group" aria-label="بازه‌های آماده">
        {RANGE_PRESETS.map((p) => {
          const r = presetRange(p.key, today);
          const active = draft.from === r.from && draft.to === r.to;
          return (
            <button key={p.key} type="button" className={cxi("ds-range-pb", active && "is-on")} aria-pressed={active} onClick={() => commit({ from: r.from, to: r.to })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="ds-range-m">
        <div className="ds-range-f">
          <DateInput value={draft.from} onChange={(from) => commit({ ...draft, from }, false)} placeholder="از تاریخ" allowClear aria-label="از تاریخ" />
          <span className="ds-range-sep">تا</span>
          <DateInput value={draft.to} onChange={(to) => commit({ ...draft, to }, false)} placeholder="تا تاریخ" allowClear aria-label="تا تاریخ" />
        </div>
        <JalaliCalendar value={null} range={draft} onPick={pick} onEscape={() => setOpen(false)} />
        <div className="ds-range-hint">{picking === "to" && draft.from && !draft.to ? "روز پایان بازه را انتخاب کنید." : "روز آغاز بازه را انتخاب کنید."}</div>
      </div>
    </div>
  );
  return (
    <span className={cxi("ds-fchip", on && "is-on", className)}>
      <Popover open={open} onOpenChange={setOpen} trigger={["click"]} placement="bottomRight" content={content} rootClassName="ds-range-pop" destroyOnHidden>
        <button type="button" className="ds-fchip-b" aria-haspopup="dialog" aria-expanded={open} aria-label={on ? `${label}: ${rangeText(value)}` : label}>
          <Calendar {...ICON} className="ds-fchip-ic" aria-hidden />
          <span className="ds-fchip-t ds-num">{on ? rangeText(value) : label}</span>
          {on ? null : <ChevronDown {...CHEV} className="ds-fchip-chev" aria-hidden />}
        </button>
      </Popover>
      {on ? <ChipClear label={label} onClear={() => commit({ from: null, to: null }, false)} /> : null}
    </span>
  );
}

export { formatNumber };
