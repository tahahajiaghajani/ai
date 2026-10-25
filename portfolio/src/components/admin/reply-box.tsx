"use client";

import { useRef, useState, useTransition } from "react";
import { ownerReply, type ReplyState } from "@/app/actions/admin";
import { ui } from "@/content/ui";

const STATUS = (["answered", "scheduled", "closed"] as const).map((value) => ({ value, label: ui.track.status[value].fa }));

/**
 * The owner's reply: a failed send keeps the text and the chosen status and says why; a sent one clears the box.
 * Submitted by hand (not `<form action>`), because React resets a form's fields after every form action.
 */
export function ReplyBox({ n, draft }: { n: number; draft: string }) {
  const [state, setState] = useState<ReplyState>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      className="mt-8 grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          let r: ReplyState;
          try {
            r = await ownerReply(null, fd);
          } catch {
            r = { ok: false, error: "ارسال نشد (ارتباط با سرور)؛ متن پاسخ سر جایش است." };
          }
          if (r?.ok && box.current) box.current.value = "";
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
        <select name="status" defaultValue="answered" className="rounded-full border border-line bg-bg px-4 py-2 text-sm">
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
