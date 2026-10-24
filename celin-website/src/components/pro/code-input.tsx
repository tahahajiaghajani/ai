"use client";

import { Fragment, useEffect, useId, useRef, useState, type ClipboardEvent, type CSSProperties, type SyntheticEvent } from "react";
import { enterCode } from "@/app/actions/account";
import { commonCopy } from "@/content/copy/common";
import { latinDigits, num, type Lang } from "@/lib/format";
import { Icon } from "@/components/ui/icons";
import { proUnlocked } from "@/components/pro/events";
import { sessionChanged } from "@/components/pro/session";

const LEN = 12;
/** Persian, Arabic-Indic or Latin digits, with spaces, dashes or a whole SMS around them → up to 12 digits. */
const digitsOf = (raw: string) => latinDigits(raw).replace(/\D/g, "").slice(0, LEN);

export type CodeState = "idle" | "pending" | "ok" | "error";

/**
 * The single most important field of the site: the 12-digit Pro code in three groups of four, one cell per
 * digit (Persian digits on Persian pages). Under the cells is ONE real input (numeric keyboard, one-time-code
 * autofill, paste of a whole SMS, native Backspace), so screen readers meet a single labelled field. It submits
 * by itself at 12 digits; an error shakes the cells, a success fills them with light and the prices appear.
 * `tone="night"` for espresso grounds (the sheet, the ceremony).
 */
export function CodeInput({
  lang,
  next,
  onDone,
  autoFocus,
  tone = "light",
  onState,
  hideLabel = false,
}: {
  lang: Lang;
  next?: string;
  onDone?: (r: { signedIn: boolean; next: string }) => void;
  autoFocus?: boolean;
  tone?: "light" | "night";
  /** follows the field (pending → ok / error), e.g. to light a seal beside it */
  onState?: (s: CodeState) => void;
  /** the label stays for screen readers only (a heading above already says it) */
  hideLabel?: boolean;
}) {
  const c = commonCopy(lang).proSheet;
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [state, setStateRaw] = useState<CodeState>("idle");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const [shake, setShake] = useState(0);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    onStateRef.current?.(state);
  }, [state]);

  // focus after a dialog has opened (showModal moves focus to its first control, after React's own autoFocus)
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 80);
    return () => clearTimeout(t);
  }, [autoFocus]);

  async function submit(code: string) {
    if (state === "pending" || state === "ok" || code.length < LEN) return;
    setStateRaw("pending");
    setError("");
    try {
      const r = await enterCode({ code, lang, next });
      if (r.ok) {
        setStateRaw("ok");
        ref.current?.blur();
        // the page re-renders with the new session at once (and the login page moves on): the moment is kept
        // by the sheet, which lives in the layout
        proUnlocked();
        // let the cells fill with light first; then the session (and the prices) change and the page moves on
        setTimeout(async () => {
          await sessionChanged();
          onDone?.({ signedIn: r.signedIn, next: r.next });
        }, 1400);
      } else {
        setStateRaw("error");
        setError(r.error);
        setShake((n) => n + 1);
      }
    } catch {
      setStateRaw("error");
      setError(commonCopy(lang).errors.network);
      setShake((n) => n + 1);
    }
  }

  function change(raw: string) {
    const d = digitsOf(raw);
    setValue(d);
    if (state === "error") setStateRaw("idle");
    if (d.length === LEN && d !== value) void submit(d);
  }

  // a pasted code (or an SMS holding one) replaces what is there instead of being appended to it
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const d = digitsOf(e.clipboardData.getData("text"));
    if (d.length < 4) return;
    e.preventDefault();
    change(d);
  }

  // the caret always sits after the last digit (the cells show where the next one goes); a full selection may stay
  function keepCaretAtEnd(e: SyntheticEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const n = el.value.length;
    if (el.selectionStart === 0 && el.selectionEnd === n && n > 0) return;
    if (el.selectionStart !== n || el.selectionEnd !== n) el.setSelectionRange(n, n);
  }

  const locked = state === "pending" || state === "ok";
  const at = Math.min(value.length, LEN - 1);
  return (
    <form
      noValidate
      data-tone={tone}
      data-state={state}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(value);
      }}
      className="code-form"
    >
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className={hideLabel ? "sr-only" : "code-label"}>
          {c.codeLabel}
        </label>
        {value.length > 0 && !locked && (
          <button
            type="button"
            onClick={() => {
              change("");
              ref.current?.focus();
            }}
            className={`code-clear ${hideLabel ? "ms-auto" : ""}`}
          >
            {c.clear}
          </button>
        )}
      </div>

      <div className="code-field" data-focused={focused ? "" : undefined}>
        <input
          ref={ref}
          id={id}
          name="code"
          value={value}
          onChange={(e) => change(e.target.value)}
          onPaste={paste}
          onSelect={keepCaretAtEnd}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          readOnly={locked}
          inputMode="numeric"
          autoComplete="one-time-code"
          enterKeyHint="done"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          aria-invalid={state === "error"}
          aria-describedby={`${id}-help ${id}-note`}
          className="code-input"
        />
        <div key={shake} aria-hidden className={`code-cells ltr ${shake ? "code-shake" : ""}`}>
          {[0, 1, 2].map((g) => (
            <Fragment key={g}>
              {g > 0 && <span className="code-sep" />}
              <span className="code-group">
                {[0, 1, 2, 3].map((k) => {
                  const i = g * 4 + k;
                  const ch = value[i];
                  const active = focused && !locked && i === at && value.length < LEN;
                  return (
                    <span key={i} className="code-cell" data-filled={ch ? "" : undefined} data-active={active ? "" : undefined} style={{ "--i": i } as CSSProperties}>
                      {ch ? num(ch, lang) : ""}
                    </span>
                  );
                })}
              </span>
            </Fragment>
          ))}
        </div>
      </div>

      <p id={`${id}-help`} className="code-help">
        {c.codeHelp}
      </p>
      <div id={`${id}-note`} aria-live="polite" className="code-note">
        {state === "error" && (
          <p className="code-error">
            <Icon name="warning" className="size-4 shrink-0" />
            {error}
          </p>
        )}
        {state === "pending" && <p className="sr-only">{c.checking}</p>}
        {state === "ok" && (
          <p className="code-ok">
            <Icon name="unlock" className="size-4 shrink-0" />
            {c.success}
          </p>
        )}
      </div>
      <button type="submit" disabled={locked || value.length < LEN} aria-busy={state === "pending" || undefined} data-done={state === "ok" ? "" : undefined} className="btn btn-metal btn-lg w-full">
        {state === "ok" ? <Icon name="check" className="size-5" /> : <Icon name="unlock" className="size-[18px]" />}
        <span>{c.submit}</span>
        {state === "pending" && <span aria-hidden className="btn-spinner" />}
      </button>
    </form>
  );
}
