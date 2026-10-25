"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { replyToRequest } from "@/app/actions/request";

export function ReplyForm({ lang, code, k }: { lang: Lang; code: string; k: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  const fa = lang === "fa";
  return (
    <form
      className="mt-12"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const failed = fa ? "ارسال نشد؛ دوباره امتحان کنید." : "Not sent — please try again.";
        start(async () => {
          try {
            const r = await replyToRequest(fd);
            if (r.ok) {
              form.reset();
              setError("");
              router.refresh();
            } else setError(r.error === "rate" ? ui.request.rate[lang] : r.error === "denied" ? ui.track.denied[lang] : failed);
          } catch {
            setError(failed);
          }
        });
      }}
    >
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="k" value={k} />
      <label className="block">
        <span className="mb-2 block text-[0.8rem] text-muted">{ui.track.reply[lang]}</span>
        <textarea name="body" rows={4} required className="w-full rounded-[8px] border border-line-strong bg-transparent p-4 text-[16px] leading-relaxed outline-none focus:border-fg md:text-base" />
      </label>
      {error ? <p className="mt-3 text-sm" role="alert">{error}</p> : null}
      <button type="submit" disabled={pending} className="mt-4 rounded-full bg-fg px-6 py-3 text-sm font-semibold text-bg disabled:opacity-60">
        {pending ? "…" : ui.track.replySend[lang]}
      </button>
    </form>
  );
}
