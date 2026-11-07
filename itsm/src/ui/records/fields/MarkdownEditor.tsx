// An RTL Markdown editor: a plain textarea (fast, accessible, paste-friendly) with a small toolbar for the common
// marks (bold, italic, lists, quote, code, link) and a «پیش‌نمایش» tab that renders the text the way the record
// shows it. Keyboard: Ctrl+B / Ctrl+I wrap the selection. Used by markdown fields and the activity composer.
import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Input, Segmented, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Bold, Italic, List, ListOrdered, Quote, Code, Link2 } from "lucide-react";
import { cx } from "../../components/blocks";
import { RecordMarkdown } from "./display";
import type { DisplayMap } from "../model/types";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export interface MarkdownEditorHandle {
  focus: () => void;
  /** inserts text at the caret (canned responses, mentions) */
  insert: (text: string) => void;
  textarea: () => HTMLTextAreaElement | null;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  status?: "error" | "warning";
  "aria-label"?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect?: (caret: number) => void;
  /** tools at the end of the toolbar (the composer's slots) */
  tools?: ReactNode;
  display?: DisplayMap;
  className?: string;
  /** no write/preview switch (the composer keeps its own) */
  bare?: boolean;
}

/** Wraps the selection in `before`/`after` (or inserts a placeholder); returns the new text and selection. */
export function wrapText(text: string, start: number, end: number, before: string, after: string, placeholder: string) {
  const sel = text.slice(start, end) || placeholder;
  const next = text.slice(0, start) + before + sel + after + text.slice(end);
  return { text: next, start: start + before.length, end: start + before.length + sel.length };
}

/** Prefixes every line of the selection («- », «1. », «> »). */
export function prefixLines(text: string, start: number, end: number, prefix: (i: number) => string) {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const toIdx = text.indexOf("\n", end);
  const to = toIdx < 0 ? text.length : toIdx;
  const lines = text.slice(from, to).split("\n");
  const block = lines.map((l, i) => prefix(i) + l).join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { value, onChange, placeholder, minRows = 4, maxRows = 18, disabled, autoFocus, id, status, onKeyDown, onSelect, tools, display, className, bare, ...rest },
  ref,
) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ta = useRef<TextAreaRef>(null);
  const el = () => ta.current?.resizableTextArea?.textArea ?? null;

  const apply = (r: { text: string; start: number; end: number }) => {
    onChange(r.text);
    requestAnimationFrame(() => {
      const t = el();
      if (!t) return;
      t.focus();
      t.setSelectionRange(r.start, r.end);
    });
  };
  const sel = () => {
    const t = el();
    return { s: t?.selectionStart ?? value.length, e: t?.selectionEnd ?? value.length };
  };
  const wrap = (b: string, a: string, ph: string) => {
    const { s, e } = sel();
    apply(wrapText(value, s, e, b, a, ph));
  };
  const lines = (p: (i: number) => string) => {
    const { s, e } = sel();
    apply(prefixLines(value, s, e, p));
  };

  useImperativeHandle(ref, () => ({
    focus: () => el()?.focus(),
    textarea: el,
    insert: (text: string) => {
      const { s, e } = sel();
      const next = value.slice(0, s) + text + value.slice(e);
      apply({ text: next, start: s + text.length, end: s + text.length });
    },
  }));

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyB" || e.code === "KeyI")) {
      e.preventDefault();
      if (e.code === "KeyB") wrap("**", "**", "متن پررنگ");
      else wrap("_", "_", "متن مورب");
      return;
    }
    onKeyDown?.(e);
  };

  const btn = (title: string, icon: ReactNode, onClick: () => void) => (
    <Tooltip title={title} mouseEnterDelay={0.4}>
      <Button type="text" size="small" icon={icon} onClick={onClick} disabled={disabled || tab === "preview"} aria-label={title} onMouseDown={(e) => e.preventDefault()} />
    </Tooltip>
  );

  return (
    <div className={cx("rk-md-ed", disabled && "is-disabled", status === "error" && "is-error", className)}>
      <div className="rk-md-bar" role="toolbar" aria-label="قالب‌بندی متن">
        {bare ? null : (
          <Segmented
            size="small"
            value={tab}
            onChange={(v) => setTab(v as "write" | "preview")}
            options={[
              { value: "write", label: "نوشتن" },
              { value: "preview", label: "پیش‌نمایش" },
            ]}
          />
        )}
        <span className="rk-md-tools">
          {btn("پررنگ (Ctrl+B)", <Bold {...I16} />, () => wrap("**", "**", "متن پررنگ"))}
          {btn("مورب (Ctrl+I)", <Italic {...I16} />, () => wrap("_", "_", "متن مورب"))}
          {btn("فهرست", <List {...I16} />, () => lines(() => "- "))}
          {btn("فهرست شماره‌دار", <ListOrdered {...I16} />, () => lines((i) => `${i + 1}. `))}
          {btn("نقل قول", <Quote {...I16} />, () => lines(() => "> "))}
          {btn("کد", <Code {...I16} />, () => wrap("`", "`", "code"))}
          {btn("پیوند", <Link2 {...I16} />, () => wrap("[", "](https://)", "متن پیوند"))}
        </span>
        {tools ? <span className="rk-md-extra">{tools}</span> : null}
      </div>
      {tab === "preview" && !bare ? (
        <div className="rk-md-preview">{value.trim() ? <RecordMarkdown text={value} display={display} /> : <span className="text-ink-3">چیزی برای پیش‌نمایش نیست.</span>}</div>
      ) : (
        <Input.TextArea
          {...rest}
          ref={ta}
          id={id}
          dir="rtl"
          value={value}
          placeholder={placeholder}
          autoSize={{ minRows, maxRows }}
          disabled={disabled}
          autoFocus={autoFocus}
          status={status}
          variant="borderless"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={keys}
          onSelect={(e) => onSelect?.((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyUp={(e) => onSelect?.((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => onSelect?.((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        />
      )}
    </div>
  );
});
