// The question box: multiline (Enter sends, Shift+Enter starts a new line), files (attach, paste or drop), the page
// the question is about as a removable chip, the «/» menu of quick prompts, and stop while an answer is written.
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Tooltip } from "antd";
import { ArrowUp, FileText, MapPin, Paperclip, Square, X } from "lucide-react";
import type { ModuleKey } from "@shared/constants";
import { matchesFa } from "../../lib/fa";
import { useNotify } from "../../lib/hooks";
import { Ic, Keys } from "../../components/shell/icons";
import { ACCEPT, overTotal, readFile, refuseFile, release, type PendingFile } from "./attach";
import { fileSize } from "./format";
import { QUICK_PROMPTS, readOwnPrompts, writeOwnPrompts, type QuickPrompt } from "./prompts";

export interface ComposerHandle {
  focus(): void;
  /** puts text in the box (a suggestion with a blank to fill in), the caret at its end */
  setText(text: string): void;
  /** adds files (dropped on the panel) */
  addFiles(files: File[]): void;
}

export interface ComposerProps {
  handle: Ref<ComposerHandle>;
  orgId: string;
  has: (m: ModuleKey) => boolean;
  /** the panel waits for something (loading, not configured): nothing can be sent */
  disabled?: boolean;
  /** an answer is being written: the send button turns into stop */
  busy: boolean;
  onSend: (text: string, files: PendingFile[]) => boolean | void;
  onStop: () => void;
  /** the page chip (null: no chip) */
  context: { title: string } | null;
  onDropContext: () => void;
  /** the model that answers, shown quietly under the box */
  model: string | null;
  /** bumps when a prompt was saved elsewhere (a question's «ذخیره») so the «/» menu re-reads the list */
  promptsVersion: number;
}

const MAX_TEXT = 8000;

export function Composer({ handle, orgId, has, disabled, busy, onSend, onStop, context, onDropContext, model, promptsVersion }: ComposerProps) {
  const n = useNotify();
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [reading, setReading] = useState(0);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const [own, setOwn] = useState<QuickPrompt[]>(() => readOwnPrompts(orgId));
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => setOwn(readOwnPrompts(orgId)), [orgId, promptsVersion]);
  useEffect(() => () => release(filesRef.current), []);

  // the box grows with its text up to eight lines
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.blockSize = "auto";
    el.style.blockSize = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const add = async (list: File[]) => {
    let have = filesRef.current.map((f) => ({ size: f.size }));
    for (const f of list) {
      const why = refuseFile({ name: f.name, type: f.type, size: f.size }, have);
      if (why) {
        n.warn(why);
        continue;
      }
      have = [...have, { size: f.size }];
      setReading((r) => r + 1);
      try {
        const p = await readFile(f);
        if (overTotal([...filesRef.current, p])) {
          release([p]);
          n.warn("فایل‌های این پرسش روی هم بزرگ‌اند؛ یکی را بردارید یا عکس کوچک‌تری بفرستید.");
        } else setFiles((x) => [...x, p]);
      } catch {
        n.warn(`«${f.name}» خوانده نشد.`);
      } finally {
        setReading((r) => r - 1);
      }
    }
  };

  useImperativeHandle(handle, () => ({
    focus: () => box.current?.focus({ preventScroll: true }),
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = box.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(t.length, t.length);
      });
    },
    addFiles: (list) => void add(list),
  }));

  // ---------------------------------------------------------------- the «/» menu
  const slashQuery = /^\/[^\n]*$/.test(text) && !slashClosed ? text.slice(1).trim() : null;
  const slashItems = useMemo(() => {
    if (slashQuery === null) return [];
    const all = [...own, ...QUICK_PROMPTS.filter((p) => !p.module || has(p.module))];
    return slashQuery ? all.filter((p) => matchesFa(p.name, slashQuery) || matchesFa(p.text, slashQuery)) : all;
  }, [slashQuery, own, has]);
  const slashOpen = slashQuery !== null && slashItems.length > 0;
  const slashSel = Math.min(slashIdx, Math.max(0, slashItems.length - 1));
  useEffect(() => setSlashIdx(0), [slashQuery]);
  useEffect(() => {
    if (!text.startsWith("/")) setSlashClosed(false);
  }, [text]);

  const pick = (p: QuickPrompt) => {
    setText(p.text);
    requestAnimationFrame(() => box.current?.setSelectionRange(p.text.length, p.text.length));
  };
  const removeOwn = (key: string) => {
    const next = own.filter((p) => p.key !== key);
    setOwn(next);
    writeOwnPrompts(orgId, next);
  };

  // ---------------------------------------------------------------- sending
  const canSend = !disabled && !busy && !reading && (text.trim().length > 0 || files.length > 0) && !slashOpen;
  const send = () => {
    if (!canSend) return;
    const ok = onSend(text.trim(), files);
    if (ok === false) return;
    setText("");
    setFiles([]); // the previews stay valid for the sent message's chips until the panel unmounts
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSlashIdx((slashSel + d + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(slashItems[slashSel]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSlashClosed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const list = Array.from(e.clipboardData.files ?? []);
    if (!list.length) return;
    e.preventDefault();
    void add(list);
  };

  return (
    <div className={`sa-comp ${disabled ? "is-disabled" : ""}`}>
      {slashOpen ? (
        <div className="sa-slash sf-pop" role="listbox" id="sa-slash" aria-label="دستورهای آماده">
          <div className="sa-slash-h">دستورهای آماده</div>
          {slashItems.map((p, i) => (
            <div
              key={p.key}
              id={`sa-slash-${i}`}
              role="option"
              aria-selected={i === slashSel}
              className={`sa-slash-r ${i === slashSel ? "is-on" : ""}`}
              onMouseMove={() => i !== slashSel && setSlashIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span className="sa-slash-n">{p.name}</span>
              <span className="sa-slash-t">{p.text}</span>
              {p.own ? (
                <button
                  type="button"
                  className="sa-slash-x"
                  aria-label={`حذف «${p.name}»`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeOwn(p.key);
                  }}
                >
                  <Ic icon={X} size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="sa-comp-box" onClick={() => box.current?.focus()}>
        {context || files.length || reading ? (
          <div className="sa-comp-chips">
            {context ? (
              <span className="sa-ctx" title="پرسش دربارهٔ همین صفحه است">
                <Ic icon={MapPin} size={13} />
                <span className="sa-ctx-t">{context.title}</span>
                <button
                  type="button"
                  className="sa-ctx-x"
                  aria-label="پرسش به این صفحه ربطی ندارد"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDropContext();
                  }}
                >
                  <Ic icon={X} size={12} />
                </button>
              </span>
            ) : null}
            {files.map((f) => (
              <span key={f.key} className="sa-file">
                {f.preview ? <img src={f.preview} alt="" className="sa-file-img" /> : <Ic icon={FileText} size={14} />}
                <span className="sa-file-n">{f.name}</span>
                <span className="sa-file-s sf-num">{fileSize(f.size)}</span>
                <button
                  type="button"
                  className="sa-ctx-x"
                  aria-label={`برداشتن «${f.name}»`}
                  onClick={(e) => {
                    e.stopPropagation();
                    release([f]);
                    setFiles((x) => x.filter((y) => y.key !== f.key));
                  }}
                >
                  <Ic icon={X} size={12} />
                </button>
              </span>
            ))}
            {reading ? <span className="sa-file is-reading">در حال خواندن فایل…</span> : null}
          </div>
        ) : null}
        <textarea
          ref={box}
          className="sa-comp-in"
          rows={1}
          dir="auto"
          value={text}
          maxLength={MAX_TEXT}
          disabled={disabled}
          placeholder={disabled ? "" : "بپرسید یا «/» را برای دستورهای آماده بزنید"}
          aria-label="پرسش از دستیار"
          aria-controls={slashOpen ? "sa-slash" : undefined}
          aria-activedescendant={slashOpen ? `sa-slash-${slashSel}` : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="sa-comp-bar">
          <Tooltip title="پیوست عکس یا PDF" mouseEnterDelay={0.4}>
            <button
              type="button"
              className="sh-icon-btn sh-icon-sm"
              aria-label="پیوست عکس یا PDF"
              disabled={disabled || files.length >= 4}
              onClick={(e) => {
                e.stopPropagation();
                picker.current?.click();
              }}
            >
              <Ic icon={Paperclip} />
            </button>
          </Tooltip>
          <input
            ref={picker}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              void add(list);
            }}
          />
          {model ? (
            <bdi dir="ltr" className="sa-comp-model" title="مدلی که پاسخ می‌دهد">
              {model}
            </bdi>
          ) : null}
          <span className="sf-end">
            {busy ? (
              <Tooltip title="توقف" mouseEnterDelay={0.3}>
                <button
                  type="button"
                  className="sa-send is-stop"
                  aria-label="توقف پاسخ"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStop();
                  }}
                >
                  <Ic icon={Square} size={12} fill="currentColor" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip
                title={
                  <span className="sa-tip-keys">
                    فرستادن <Keys keys={["Enter"]} className="sh-keys-tip" />
                  </span>
                }
                mouseEnterDelay={0.5}
              >
                <button
                  type="button"
                  className="sa-send"
                  aria-label="فرستادن"
                  disabled={!canSend}
                  onClick={(e) => {
                    e.stopPropagation();
                    send();
                  }}
                >
                  <Ic icon={ArrowUp} size={16} />
                </button>
              </Tooltip>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
