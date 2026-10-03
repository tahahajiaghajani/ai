"use client";
import * as React from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Pop } from "@/components/ui/overlays";
import { cn, faNum } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string;
  /** shown under the label (e.g. a file summary) */
  hint?: string;
  /** extra words the search matches (e.g. symbols in a file) */
  keywords?: string;
  icon?: React.ReactNode;
  /** left-to-right text (paths, code) */
  ltr?: boolean;
}

function matches(o: ComboOption, words: string[]) {
  const hay = `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Searchable picker (single or multiple). Works with touch: the list opens in a popover with a
 * search box on top; long lists are cut to the first matches.
 */
export function Combobox({
  options,
  value,
  onChange,
  multiple,
  placeholder = "انتخاب کنید…",
  searchPlaceholder = "جستجو…",
  empty = "موردی پیدا نشد",
  create,
  disabled,
  className,
  max = 200,
}: {
  options: ComboOption[];
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  empty?: string;
  /** offer "create «query»" when nothing matches exactly */
  create?: { label: (q: string) => string; onCreate: (q: string) => void };
  disabled?: boolean;
  className?: string;
  max?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = words.length ? options.filter((o) => matches(o, words)) : options;
  const shown = filtered.slice(0, max);
  const selected = options.filter((o) => value.includes(o.value));
  const exact = options.some((o) => o.label.trim().toLowerCase() === q.trim().toLowerCase());

  const toggle = (v: string) => {
    if (multiple) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    else {
      onChange(value[0] === v ? [] : [v]);
      setOpen(false);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Pop
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQ("");
        }}
        className="w-[min(92vw,460px)] p-0"
        trigger={
          <button
            type="button"
            disabled={disabled}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface-strong px-3 py-2 text-start text-sm transition hover:border-line-strong focus:border-primary focus:outline-none disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate">
              {selected.length === 0 ? (
                <span className="text-faint">{placeholder}</span>
              ) : multiple ? (
                `${faNum(selected.length)} مورد انتخاب شده`
              ) : (
                <span className={cn(selected[0].ltr && "ltr")}>{selected[0].label}</span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted" />
          </button>
        }
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="size-4 text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          {filtered.length > shown.length ? <span className="shrink-0 text-[11px] text-faint">{faNum(shown.length)} از {faNum(filtered.length)}</span> : null}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {create && q.trim() && !exact ? (
            <button
              type="button"
              onClick={() => {
                create.onCreate(q.trim());
                setOpen(false);
                setQ("");
              }}
              className="mb-1 block w-full rounded-xl bg-primary-soft px-3 py-2 text-start text-sm font-semibold text-primary"
            >
              {create.label(q.trim())}
            </button>
          ) : null}
          {shown.length === 0 && !(create && q.trim()) ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : null}
          {shown.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={cn("flex w-full items-start gap-2 rounded-xl px-3 py-2 text-start text-sm hover:bg-surface-muted", on && "bg-primary-soft")}
              >
                <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded border", on ? "border-primary bg-primary text-white" : "border-line-strong")}>{on ? <Check className="size-3" /> : null}</span>
                {o.icon ? <span className="mt-0.5 shrink-0 text-muted">{o.icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-medium", o.ltr && "ltr text-start")}>{o.label}</span>
                  {o.hint ? <span className="mt-0.5 block line-clamp-2 text-xs text-muted">{o.hint}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Pop>
      {multiple && selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((o) => (
            <span key={o.value} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-surface-muted px-2 py-1 text-xs">
              <span className={cn("truncate", o.ltr && "ltr")}>{o.label}</span>
              <button type="button" onClick={() => toggle(o.value)} className="text-muted hover:text-danger" aria-label="حذف">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
