"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ownerReply, type ReplyState } from "@/app/actions/admin";
import { ui } from "@/content/ui";

const STATUS = (["answered", "scheduled", "closed"] as const).map((value) => ({ value, label: ui.track.status[value].fa }));

/** Unsent text, kept in the tab so it survives a reload or the page being replaced by an error. */
const saved = (n: number) => `reply:${n}`;
function remember(n: number, value: { body: string; status: string } | null) {
  try {
    if (value) sessionStorage.setItem(saved(n), JSON.stringify(value));
    else sessionStorage.removeItem(saved(n));
  } catch {
    // storage blocked: the text still stays in the box
  }
}

/**
 * The owner's reply: a failed send keeps the text and the chosen status and says why; a sent one clears the box.
 * Submitted by hand (not `<form action>`), because React resets a form's fields after every form action.
 */
export function ReplyBox({ n, draft }: { n: number; draft: string }) {
  const [state, setState] = useState<ReplyState>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(saved(n)) ?? "null") as { body?: string; status?: string } | null;
      if (v?.body && box.current) box.current.value = v.body;
      if (v?.status && STATUS.some((s) => s.value === v.status) && select.current) select.current.value = v.status;
    } catch {
      // nothing kept
    }
  }, [n]);
  return (
    <form
      className="mt-8 grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        remember(n, { body: String(fd.get("body") ?? ""), status: String(fd.get("status") ?? "") });
        start(async () => {
          let r: ReplyState;
          try {
            r = await ownerReply(null, fd);
          } catch {
            r = { ok: false, error: "ارسال نشد (ارتباط با سرور)؛ متن پاسخ سر جایش است." };
          }
          if (r?.ok) {
            remember(n, null);
            if (box.current) box.current.value = "";
            // the next reply starts from «answered» again, so an earlier «closed» is never applied by accident
            if (select.current) select.current.value = "answered";
          }
          setState(r);
        });
      }}
    >
      <input type="hidden" name="n" value={n} />
      <label className="grid gap-2">
        <span className="text-sm text-muted">پاسخ (در صفحه‌ی پیگیری بازدیدکننده نمایش داده می‌شود)</span>
        <textarea ref={box} name="body" rows={8} defaultValue={draft} className="rounded-[8px] border border-line-strong bg-transparent p-4 leading-relaxed outline-none focus:border-fg" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <select ref={select} name="status" defaultValue="answered" className="rounded-full border border-line bg-bg px-4 py-2 text-sm">
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button disabled={pending} className="rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">
          {pending ? "…" : "ارسال پاسخ"}
        </button>
      </div>
      {state && !state.ok ? (
        <p role="alert" className="rounded-[6px] border border-fg px-3 py-2 text-sm font-semibold">
          ✕ {state.error}
        </p>
      ) : state?.warning ? (
        <p role="status" className="rounded-[6px] border border-line px-3 py-2 text-sm">
          ! {state.warning}
        </p>
      ) : null}
    </form>
  );
}
