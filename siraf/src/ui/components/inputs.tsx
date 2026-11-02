// Inputs tuned for fast Persian data entry: amounts with live separators (and «+» = three
// zeros), Jalali dates typed or picked, and searchable selects backed by the API.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Input, Popover, Select, Button, Spin, type InputRef } from "antd";
import { CalendarOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { D, normalizeDigits } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { numberToWords } from "@shared/words";
import {
  JALALI_MONTHS, WEEKDAYS_SHORT, formatJalali, fromJalali, monthLength, parseJalaliInput, toJalali, todayISO, weekday,
} from "@shared/jalali";
import { useOrg } from "../lib/org";

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
  let t = normalizeDigits(s).replace(/[٬,\s_]/g, "").replace(/٫/g, ".");
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
        dir="ltr"
        className={`num ${rest.className ?? ""}`}
        style={{ textAlign: "left", ...rest.style }}
        value={groupForDisplay(raw)}
        prefix={prefix}
        suffix={suffix}
        onFocus={() => (focused.current = true)}
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
      {wordsText ? <div className="mt-1 text-[11px] leading-4 text-muted">{wordsText}</div> : null}
    </div>
  );
}

/** Money in the organisation's base currency. */
export function MoneyInput(props: NumberInputProps & { currencyDecimals?: number; showUnit?: boolean }) {
  const { org, unit } = useOrg();
  const { currencyDecimals, showUnit, ...rest } = props;
  return <NumberInput decimals={currencyDecimals ?? org.money_decimals ?? 0} suffix={showUnit ? <span className="text-xs text-muted">{unit}</span> : rest.suffix} {...rest} />;
}

export function WeightInput(props: NumberInputProps) {
  return <NumberInput decimals={3} suffix={<span className="text-xs text-muted">گرم</span>} {...props} />;
}

export function PctInput(props: NumberInputProps) {
  return <NumberInput decimals={3} suffix={<span className="text-xs text-muted">٪</span>} {...props} />;
}

// ---------------------------------------------------------------- dates

export function JalaliCalendar({ value, onPick }: { value: string | null; onPick: (iso: string) => void }) {
  const today = todayISO();
  const start = value ? toJalali(value) : toJalali(today);
  const [view, setView] = useState({ jy: start.jy, jm: start.jm });
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
  return (
    <div className="w-[260px] select-none">
      <div className="mb-2 flex items-center justify-between">
        <Button size="small" type="text" icon={<RightOutlined />} onClick={() => move(-1)} aria-label="ماه قبل" />
        <div className="flex items-center gap-1 text-sm font-semibold">
          <Select
            size="small"
            variant="borderless"
            value={view.jm}
            popupMatchSelectWidth={false}
            onChange={(jm) => setView({ ...view, jm })}
            options={JALALI_MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
          />
          <Select
            size="small"
            variant="borderless"
            value={view.jy}
            popupMatchSelectWidth={false}
            onChange={(jy) => setView({ ...view, jy })}
            options={Array.from({ length: 31 }, (_, i) => start.jy - 15 + i).map((y) => ({ value: y, label: faDigits(y) }))}
          />
        </div>
        <Button size="small" type="text" icon={<LeftOutlined />} onClick={() => move(1)} aria-label="ماه بعد" />
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-muted">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = fromJalali(view.jy, view.jm, d);
          const selected = iso === value;
          const isToday = iso === today;
          const friday = i % 7 === 6;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(iso)}
              className={`num h-8 rounded-md text-[13px] transition-colors ${
                selected ? "bg-brand text-white" : isToday ? "border border-brand text-brand" : "hover:bg-brand-soft"
              } ${friday && !selected ? "text-bad" : ""}`}
            >
              {faDigits(d)}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-line pt-2">
        <Button size="small" type="link" onClick={() => onPick(today)}>
          امروز
        </Button>
        <span className="text-[11px] text-muted">{formatJalali(today, { style: "full" })}</span>
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
}

/** Jalali date: type `1405/1/15`, `15` or `امروز`, or pick from the calendar. Value is ISO. */
export function DateInput({ value, onChange, placeholder = "۱۴۰۵/۰۱/۱۵", allowClear, onPressEnter, ...rest }: DateInputProps) {
  const [text, setText] = useState(value ? formatJalali(value) : "");
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
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

  return (
    <Popover
      open={open && !rest.disabled}
      onOpenChange={(o) => setOpen(o)}
      trigger={["click"]}
      placement="bottomRight"
      content={
        <JalaliCalendar
          value={value ?? null}
          onPick={(iso) => {
            onChange?.(iso);
            setText(formatJalali(iso));
            setOpen(false);
          }}
        />
      }
    >
      <Input
        {...rest}
        dir="ltr"
        className={`num ${rest.className ?? ""}`}
        style={{ textAlign: "left", ...rest.style }}
        status={invalid ? "error" : undefined}
        value={text}
        placeholder={placeholder}
        allowClear={allowClear}
        suffix={<CalendarOutlined className="text-muted" />}
        onFocus={() => (focused.current = true)}
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
      notFoundContent={list.isFetching ? <Spin size="small" /> : "موردی پیدا نشد"}
      onChange={(id) => onChange?.((id as string) ?? null, options.find((o) => o.id === id))}
      onOpenChange={(o) => !o && setSearch("")}
      popupMatchSelectWidth={popupWidth ?? true}
      options={options.map((o) => ({
        value: o.id,
        label: showCode && o.sub ? `${faDigits(o.sub)} — ${o.label}` : o.label,
        option: o,
      }))}
      optionRender={render ? (o) => render((o.data as { option: Opt }).option) : undefined}
    />
  );
}

export function AccountSelect(props: Omit<RefSelectProps, "entity">) {
  return <RefSelect entity="account" placeholder="کد یا نام حساب…" popupWidth={360} {...props} />;
}

export function DetailSelect({ kinds, ...props }: Omit<RefSelectProps, "entity"> & { kinds?: string[] }) {
  return <RefSelect entity="detail" placeholder="حساب تفصیلی…" filters={kinds && kinds.length ? { kind: kinds.join(",") } : undefined} popupWidth={320} {...props} />;
}

export function PartySelect({ role, ...props }: Omit<RefSelectProps, "entity"> & { role?: string }) {
  return (
    <RefSelect
      entity="party"
      placeholder="نام، کد یا موبایل شخص…"
      filters={role ? { role } : undefined}
      render={(o) => (
        <div className="flex items-center justify-between gap-2">
          <span>{o.label}</span>
          <span className="num text-xs text-muted">{faDigits(o.mobile ?? o.sub ?? "")}</span>
        </div>
      )}
      {...props}
    />
  );
}

export function CurrencySelect(props: Omit<RefSelectProps, "entity"> & { kind?: "fiat" | "crypto" }) {
  const { kind, ...rest } = props;
  return <RefSelect entity="currency" showCode={false} filters={kind ? { kind } : undefined} placeholder="ارز…" render={(o) => <span><b className="ltr">{o.code}</b> <span className="text-muted">{o.label}</span></span>} {...rest} />;
}

export { formatNumber };
