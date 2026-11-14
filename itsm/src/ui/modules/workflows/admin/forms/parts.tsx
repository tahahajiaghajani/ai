// Shared parts of the two form designers (design F §8.2, package F5): undo and redo, the guard against leaving with
// unsaved changes, the canvas of tabs › sections › items (click or Enter selects; drag, or Alt+↑/↓, moves an item;
// Delete takes it off), the save state, the lock chips, and the preview — the record page's own form classes with
// the kit's inputs, money typed in the organisation's unit.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button, Tabs, Tooltip } from "antd";
import { CircleAlert, Info, Lock, LoaderCircle, Check, FolderPlus, PanelTop } from "lucide-react";
import type { FieldDef } from "@shared/model/types";
import type { FormItem, FormLayoutV2, Right } from "@shared/forms/layout";
import type { MoneyUnit } from "@shared/financial/logic";
import { moneyUnitOf, rialFromInput } from "@shared/forms/fieldtypes";
import type { FieldLock } from "@shared/forms/locked";
import { faDigits } from "@shared/format";
import { cx, Note } from "../../../../components/blocks";
import { useNotify } from "../../../../lib/hooks";
import { MoneyInput } from "../../../../components/inputs";
import { FieldInput } from "../../../../records/fields/FieldInput";
import type { Schema } from "../../../../records/model/schema";
import type { TableMeta } from "../../../../records/model/types";
import { I14, I16 } from "../fields/parts";
import { historyOf, historyPush, historyRedo, historyReplace, historyUndo, saveStateText, type At, type History, type SaveState, type Sel } from "./model";

export { I14, I16 };

// ---------------------------------------------------------------------------------------------------------------
// Undo and redo; leaving with unsaved changes

/** Typing on in the same box within this long is the same step of undo. */
const TYPING_MS = 1500;

/**
 * A value with undo and redo. `set(v, key)`: an edit with the same `key` as the one just before it (a label being
 * typed) replaces it instead of adding a step.
 */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<History<T>>(() => historyOf(initial));
  const last = useRef<{ key: string; at: number } | null>(null);
  const set = useCallback((v: T | ((p: T) => T), key?: string) => {
    const now = Date.now();
    const merge = !!key && last.current?.key === key && now - last.current.at < TYPING_MS;
    last.current = key ? { key, at: now } : null;
    setH((x) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(x.present) : v;
      return merge ? historyReplace(x, next) : historyPush(x, next);
    });
  }, []);
  const reset = useCallback((v: T) => {
    last.current = null;
    setH(historyOf(v));
  }, []);
  const undo = useCallback(() => {
    last.current = null;
    setH(historyUndo);
  }, []);
  const redo = useCallback(() => {
    last.current = null;
    setH(historyRedo);
  }, []);
  return { value: h.present, set, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

/**
 * Leaving a page with unsaved changes asks first: the browser before it closes or reloads, the page before an in-app
 * link or the header's «بازگشت» (`back`) takes the person elsewhere.
 */
export function useLeaveGuard(dirty: boolean, back?: string) {
  const nav = useNavigate();
  const n = useNotify();
  const notify = useRef(n);
  notify.current = n;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const a = el?.closest<HTMLAnchorElement>("a[href]");
      const href = a && !a.target && !a.hasAttribute("download") ? a.getAttribute("href") : null;
      const to = href?.startsWith("/") ? href : back && el?.closest(".ds-ph > .sh-icon-btn") ? back : null;
      if (!to) return;
      e.preventDefault();
      e.stopPropagation();
      void notify.current.confirm("تغییرها ذخیره نشده‌اند؛ از این صفحه برویم؟", "آنچه تغییر داده‌اید از دست می‌رود.", true, "رفتن بدون ذخیره").then((ok) => ok && nav(to));
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, back, nav]);
}

/** Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y while the focus is not in a text box (a text box keeps its own undo). */
export function useUndoKeys(on: boolean, undo: () => void, redo: () => void) {
  useEffect(() => {
    if (!on) return;
    const h = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [on, undo, redo]);
}

/** «ذخیره شد، ۲ دقیقه پیش» and its kin, refreshed every half minute. */
export function SaveStatus({ state, at, problems = 0, onRetry }: { state: SaveState; at: string | null; problems?: number; onRetry?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const icon = state === "saving" ? <LoaderCircle {...I14} className="ds-spin" aria-hidden /> : state === "saved" ? <Check {...I14} aria-hidden /> : state === "pending" ? null : <CircleAlert {...I14} aria-hidden />;
  return (
    <span className={cx("wfm-save", `is-${state}`)} role="status" aria-live="polite">
      {icon}
      {saveStateText(state, at, now, problems)}
      {state === "error" && onRetry ? (
        <Button size="small" type="link" onClick={onRetry}>
          تلاش دوباره
        </Button>
      ) : null}
    </span>
  );
}

/** A lock chip with its reason. */
export function LockChips({ locks }: { locks: readonly FieldLock[] }) {
  if (!locks.length) return null;
  return (
    <span className="wfm-locks">
      {locks.map((l) => (
        <Tooltip key={l.reason} title="ماژول به این فیلد وابسته است؛ پنهان یا الزامی نمی‌شود، ولی برچسب و راهنمایش تغییر می‌کند">
          <span className="wff-lock">
            <Lock {...I14} aria-hidden />
            {l.label}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The canvas

/** How the canvas draws an item. */
export interface ItemView {
  label: string;
  /** a short line under the label: the type and the item's state */
  meta?: string;
  span: number;
  required?: boolean;
  locked?: boolean;
  /** form-hidden and hidden items stay on the canvas, dimmed */
  dim?: boolean;
  note?: "info" | "warning";
}

const ITEM = "application/x-wfm-item";
const FIELD = "application/x-wfm-field";

/** What a palette entry puts on the drag (a field name). */
export const dragField = (e: DragEvent, name: string) => {
  e.dataTransfer.setData(FIELD, name);
  e.dataTransfer.effectAllowed = "copyMove";
};

export interface DesignCanvasProps {
  layout: FormLayoutV2;
  describe: (item: FormItem) => ItemView;
  /** a section's line beside its name («۲ ستون») */
  sectionMeta?: (t: number, s: number) => string | undefined;
  selected: Sel | null;
  onSelect: (sel: Sel) => void;
  editable: boolean;
  onMove?: (from: { t: number; s: number; i: number }, to: At) => void;
  onDropField?: (name: string, to: At) => void;
  onShift?: (at: { t: number; s: number; i: number }, d: -1 | 1) => void;
  onRemove?: (at: { t: number; s: number; i: number }) => void;
  onAddSection?: (t: number) => void;
  onAddTab?: () => void;
  emptySection?: string;
}

const atKey = (t: number, s: number, i: number) => `${t}:${s}:${i}`;

export function DesignCanvas(p: DesignCanvasProps) {
  const { layout, describe, selected, onSelect, editable } = p;
  const [over, setOver] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  // after a keyboard move the moved item keeps the focus
  useEffect(() => {
    if (!moved.current || selected?.kind !== "item") return;
    moved.current = false;
    root.current?.querySelector<HTMLElement>(`[data-at="${atKey(selected.t, selected.s, selected.i)}"]`)?.focus();
  }, [selected]);

  const drop = (to: At) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    setDrag(null);
    if (!editable) return;
    const field = e.dataTransfer.getData(FIELD);
    if (field) return p.onDropField?.(field, to);
    const raw = e.dataTransfer.getData(ITEM);
    if (!raw) return;
    const [t, s, i] = raw.split(":").map(Number);
    p.onMove?.({ t, s, i }, to);
  };
  const dragOver = (key: string) => (e: DragEvent) => {
    if (!editable) return;
    e.preventDefault();
    if (over !== key) setOver(key);
  };
  const keys = (at: { t: number; s: number; i: number }) => (e: KeyboardEvent) => {
    if (!editable) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moved.current = true;
      p.onShift?.(at, e.key === "ArrowUp" ? -1 : 1);
    } else if ((e.key === "Delete" || e.key === "Backspace") && p.onRemove) {
      e.preventDefault();
      p.onRemove(at);
    }
  };
  const isSel = (s: Sel) => !!selected && selected.kind === s.kind && selected.t === s.t && ("s" in s ? (selected as { s: number }).s === s.s : true) && ("i" in s ? (selected as { i: number }).i === s.i : true);

  return (
    <div className="wfm-canvas" ref={root} role="region" aria-label="بوم فرم">
      {layout.tabs.map((tab, t) => (
        <section key={t} className="wfm-tab" aria-label={`زبانهٔ ${tab.label}`}>
          <button type="button" className={cx("wfm-tab-h", isSel({ kind: "tab", t }) && "is-sel")} aria-pressed={isSel({ kind: "tab", t })} onClick={() => onSelect({ kind: "tab", t })}>
            <PanelTop {...I14} aria-hidden />
            {tab.label}
            <small>زبانه</small>
          </button>
          {tab.sections.map((sec, s) => {
            const key = `${t}:${s}`;
            const meta = p.sectionMeta?.(t, s);
            return (
              <div key={s} className={cx("wfm-sec", over === key && "is-over")} onDragOver={dragOver(key)} onDragLeave={() => setOver(null)} onDrop={drop({ t, s })}>
                <button type="button" className={cx("wfm-sec-h", isSel({ kind: "section", t, s }) && "is-sel")} aria-pressed={isSel({ kind: "section", t, s })} onClick={() => onSelect({ kind: "section", t, s })}>
                  {sec.label ?? `بخش ${faDigits(s + 1)}`}
                  {meta ? <small>{meta}</small> : null}
                </button>
                <div className="wfm-grid">
                  {sec.items.map((item, i) => {
                    const v = describe(item);
                    const k = atKey(t, s, i);
                    const sel = isSel({ kind: "item", t, s, i });
                    return (
                      <button
                        key={k}
                        type="button"
                        data-at={k}
                        className={cx("wfm-item", sel && "is-sel", v.dim && "is-dim", drag === k && "is-drag", v.note && "is-note", v.note === "warning" && "is-warning")}
                        style={{ ["--wfm-span" as string]: String(v.span) }}
                        aria-pressed={sel}
                        aria-label={`${v.label}${v.meta ? `، ${v.meta}` : ""}`}
                        draggable={editable}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(ITEM, k);
                          e.dataTransfer.effectAllowed = "move";
                          setDrag(k);
                        }}
                        onDragEnd={() => setDrag(null)}
                        onDragOver={dragOver(key)}
                        onDrop={drop({ t, s, i })}
                        onClick={() => onSelect({ kind: "item", t, s, i })}
                        onKeyDown={keys({ t, s, i })}
                      >
                        <span className="wfm-item-l">
                          <span>{v.label}</span>
                          {v.required ? (
                            <span className="rk-req" aria-hidden>
                              *
                            </span>
                          ) : null}
                          {v.locked ? <Lock size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden /> : null}
                        </span>
                        {v.meta ? <span className="wfm-item-m">{v.meta}</span> : null}
                      </button>
                    );
                  })}
                  {!sec.items.length ? <div className="wfm-empty-sec">{p.emptySection ?? "فیلدی را این‌جا بکشید"}</div> : null}
                </div>
              </div>
            );
          })}
          {editable && p.onAddSection ? (
            <span className="wfm-add">
              <Button size="small" icon={<FolderPlus {...I14} />} onClick={() => p.onAddSection!(t)}>
                بخش
              </Button>
            </span>
          ) : null}
        </section>
      ))}
      {editable && p.onAddTab ? (
        <span className="wfm-add">
          <Button icon={<PanelTop {...I16} />} onClick={p.onAddTab}>
            زبانه
          </Button>
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The preview

export interface PreviewField {
  kind: "field";
  name: string;
  field: FieldDef;
  right: Right;
  span: number;
  label: string;
  help?: string;
}
export interface PreviewNote {
  kind: "note";
  text: string;
  tone: "info" | "warning";
}
export interface PreviewTab {
  label: string;
  sections: { key: string; label: string | null; items: (PreviewField | PreviewNote)[] }[];
}

export interface PreviewFormProps {
  tabs: PreviewTab[];
  /** the table the fields belong to (a process form's values: a virtual table of its fields) */
  def: TableMeta;
  schema: Schema;
  tz: string;
  unit: MoneyUnit;
  values: Record<string, unknown>;
  onChange?: (name: string, value: unknown) => void;
  problems?: Record<string, string>;
  idPrefix: string;
}

/** The form as a person sees it: hidden fields left out, read-only ones disabled, required ones marked. */
export function PreviewForm({ tabs, def, schema, tz, unit, values, onChange, problems = {}, idPrefix }: PreviewFormProps) {
  const [typed, setTyped] = useState<Record<string, string | null>>({});
  const [active, setActive] = useState("0");
  const shown = useMemo(() => tabs.filter((t) => t.sections.some((s) => s.items.length)), [tabs]);
  if (!shown.length) return <p className="rk-hint">از این دیدگاه هیچ فیلدی دیده نمی‌شود.</p>;
  const body = (tab: PreviewTab) => (
    <div className="rk-form">
      {tab.sections.map((sec) =>
        sec.items.length ? (
          <section key={sec.key} className="rk-sec" aria-label={sec.label ?? undefined}>
            {sec.label ? <h3 className="rk-sec-t">{sec.label}</h3> : null}
            <div className="rk-grid">
              {sec.items.map((item, n) => {
                if (item.kind === "note")
                  return (
                    <div key={`note-${n}`} className="wfm-note-line">
                      <Note tone={item.tone === "warning" ? "warning" : "neutral"}>{item.text}</Note>
                    </div>
                  );
                const f = { ...item.field, label: item.label, help: item.help };
                const id = `${idPrefix}-${item.name}`;
                const readonly = item.right === "read";
                const required = item.right === "required";
                const problem = problems[item.name];
                const money = f.type === "money" ? moneyUnitOf(f, unit) : null;
                return (
                  <div key={item.name} className={cx("rk-f", problem && "has-error")} style={{ ["--rk-span" as string]: String(item.span) }}>
                    <span className="rk-f-l">
                      <label htmlFor={id}>{item.label}</label>
                      {required ? (
                        <span className="rk-req" aria-label="الزامی">
                          *
                        </span>
                      ) : null}
                      {item.help ? (
                        <Tooltip title={item.help}>
                          <Info {...I14} className="rk-f-help" aria-label={item.help} />
                        </Tooltip>
                      ) : null}
                    </span>
                    {money ? (
                      <MoneyInput
                        id={id}
                        value={typed[item.name] ?? null}
                        onChange={(v) => {
                          const text = v === null ? null : String(v);
                          setTyped((x) => ({ ...x, [item.name]: text }));
                          onChange?.(item.name, rialFromInput(text, money));
                        }}
                        unit={money === "toman" ? "تومان" : "ریال"}
                        disabled={readonly || !onChange}
                        aria-label={item.label}
                      />
                    ) : (
                      <FieldInput
                        id={id}
                        field={f}
                        value={values[item.name] ?? null}
                        onChange={(v) => onChange?.(item.name, v)}
                        def={def}
                        schema={schema}
                        row={values}
                        tz={tz}
                        disabled={readonly || !onChange}
                        status={problem ? "error" : undefined}
                        aria-label={item.label}
                      />
                    )}
                    {readonly ? <span className="rk-hint">فقط‌خواندنی</span> : null}
                    {problem ? (
                      <span className="rk-err" role="alert">
                        {problem}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
  if (shown.length === 1) return body(shown[0]);
  return <Tabs activeKey={shown[Number(active)] ? active : "0"} onChange={setActive} items={shown.map((t, i) => ({ key: String(i), label: t.label, children: body(t) }))} />;
}

/** A labelled block of the inspector. */
export function Block({ title, children, extra }: { title: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="wfm-stack">
      <div className="wfm-moves">
        <h3 className="wfm-panel-t">{title}</h3>
        {extra}
      </div>
      {children}
    </div>
  );
}
