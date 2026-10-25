"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Lang } from "@/lib/i18n";
import { href, num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { KINDS, PRIORITY_LABEL, type RequestKind } from "@/lib/request-meta";
import { submitRequest, type SubmitResult } from "@/app/actions/request";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="group block">
      <span className="mb-2 block text-[0.78rem] text-muted transition-colors group-focus-within:text-fg">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[0.72rem] text-faint">{hint}</span> : null}
    </label>
  );
}

const input =
  "w-full border-b border-line-strong bg-transparent pb-3 pt-1 text-[16px] outline-none transition-colors placeholder:text-faint focus:border-fg md:text-[1.05rem]";

/**
 * The request desk. Sends to a Server Action that stores the request, has Gemini triage it (type, priority, a
 * restatement and clarifying questions) and alerts Taha on Telegram; the visitor gets a tracking code and link.
 */
export function RequestForm({ lang }: { lang: Lang }) {
  const [kind, setKind] = useState<RequestKind>("project");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [more, setMore] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const fa = lang === "fa";

  // a question from the assistant can seed the description
  useEffect(() => {
    const take = () => {
      try {
        const seed = sessionStorage.getItem("request:seed");
        if (seed && body.current && !body.current.value) {
          body.current.value = seed;
          sessionStorage.removeItem("request:seed");
        }
      } catch {}
    };
    take();
    window.addEventListener("request:seed", take);
    return () => window.removeEventListener("request:seed", take);
  }, []);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("kind", kind);
    fd.set("lang", lang);
    start(async () => {
      try {
        setResult(await submitRequest(fd));
      } catch {
        setResult({ ok: false, error: "failed" });
      }
    });
  };

  if (result?.ok) {
    const link = `${href(lang, `/request/${result.code}`)}?k=${encodeURIComponent(result.key)}`;
    const t = result.triage;
    return (
      <div className="rounded-[10px] border border-line-strong p-6 md:p-10" role="status">
        <p className="eyebrow eyebrow-fa">{ui.request.done[lang]}</p>
        <p className="mt-6 text-[0.8rem] text-muted">{ui.request.code[lang]}</p>
        <p className="latin mt-1 text-[clamp(2.6rem,6vw,4.5rem)] font-semibold leading-none tracking-[-0.04em]" dir="ltr">{result.code}</p>
        <Link href={link} className="mt-6 inline-flex items-center gap-2 rounded-full bg-fg px-5 py-3 text-sm font-semibold text-bg">
          {ui.request.track[lang]} {fa ? "←" : "→"}
        </Link>
        <p className="mt-3 text-[0.8rem] text-muted">{ui.request.keep[lang]}</p>
        {t ? (
          <div className="mt-10 border-t border-line pt-8">
            <p className="eyebrow eyebrow-fa mb-4">{ui.request.aiRead[lang]}</p>
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-line-strong px-3 py-1 text-[0.75rem]">{ui.request.kinds[t.kind][lang]}</span>
              <span className="rounded-full border border-line-strong px-3 py-1 text-[0.75rem]">{fa ? "اولویت" : "Priority"}: {PRIORITY_LABEL[t.priority][lang]}</span>
            </div>
            <p className="text-lg leading-relaxed">{t.summary}</p>
            {t.questions.length ? (
              <ol className="mt-6 grid gap-3">
                {t.questions.map((q, i) => (
                  <li key={i} className="flex gap-3 text-fg-2">
                    <span className="font-mono text-xs text-faint">{num(lang, `0${i + 1}`)}</span>
                    {q}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const error = result && !result.ok ? result : null;
  const message = error
    ? error.error === "contact"
      ? ui.request.contactNeeded[lang]
      : error.error === "rate"
        ? ui.request.rate[lang]
        : error.error === "offline"
          ? ui.request.offline[lang]
          : error.error === "invalid" && error.field === "email"
            ? fa
              ? "نشانی ایمیل را بررسی کنید."
              : "Please check your email address."
            : error.error === "invalid"
              ? fa
                ? "لطفاً نام و شرح نیاز را کامل کنید."
                : "Please add your name and describe what you need."
              : ui.request.failed[lang]
    : "";

  return (
    <form onSubmit={onSubmit} className="relative" noValidate aria-busy={pending}>
      <fieldset className="mb-10">
        <legend className="mb-4 text-[0.78rem] text-muted">{ui.request.kind[lang]}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full border px-4 py-2 text-[0.85rem] transition-all duration-300 ${kind === k ? "border-fg bg-fg text-bg" : "border-line-strong text-fg-2 hover:border-fg"}`}
            >
              {ui.request.kinds[k][lang]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-8 md:grid-cols-2">
        <Field label={ui.request.name[lang]}>
          <input name="name" required autoComplete="name" className={input} />
        </Field>
        <Field label={ui.request.organization[lang]}>
          <input name="organization" autoComplete="organization" className={input} />
        </Field>
        <Field label={ui.request.email[lang]}>
          <input name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" className={`${input} ${fa ? "text-end" : ""}`} />
        </Field>
        <Field label={ui.request.phone[lang]}>
          <input name="phone" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="+98… / @username" className={`${input} ${fa ? "text-end" : ""}`} />
        </Field>
        <div className="md:col-span-2">
          <Field label={ui.request.subject[lang]}>
            <input name="subject" className={input} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label={ui.request.body[lang]} hint={ui.request.bodyHint[lang]}>
            <textarea ref={body} name="body" required rows={5} className={`${input} resize-y leading-relaxed`} />
          </Field>
        </div>
        {more ? (
          <>
            <Field label={ui.request.budget[lang]}>
              <input name="budget" className={input} />
            </Field>
            <Field label={ui.request.timeline[lang]}>
              <input name="timeline" className={input} />
            </Field>
          </>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="w-fit text-[0.8rem] text-muted underline-offset-4 hover:text-fg hover:underline md:col-span-2">
            + {fa ? "بودجه و زمان‌بندی (اختیاری)" : "Budget and timeline (optional)"}
          </button>
        )}
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="sr-only" aria-hidden />

      {message ? (
        <p className="mt-8 border-s-2 border-fg ps-4 text-[0.9rem]" role="alert">
          {message}
        </p>
      ) : null}

      <div className="mt-10 flex flex-wrap items-center gap-6">
        <button
          type="submit"
          disabled={pending}
          className="group relative inline-flex h-16 items-center gap-4 overflow-hidden rounded-full bg-fg ps-8 pe-3 text-[1rem] font-semibold text-bg transition-transform hover:scale-[1.02] disabled:cursor-wait"
        >
          <span>{pending ? ui.request.sending[lang] : ui.request.submit[lang]}</span>
          <span className="grid size-10 place-items-center rounded-full bg-bg text-fg transition-transform duration-500 group-hover:rotate-[-45deg] rtl:group-hover:rotate-45">
            {fa ? "←" : "→"}
          </span>
          {pending ? <span aria-hidden className="absolute inset-y-0 start-0 w-1/3 animate-[shimmer_1.4s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" /> : null}
        </button>
        <p className="max-w-[46ch] text-[0.75rem] leading-relaxed text-faint">
          {fa
            ? "درخواست در مخزن خصوصی طاها نگه داشته می‌شود. متن آن (بدون نام شما) برای دسته‌بندی به Google Gemini فرستاده می‌شود و خبرش همراه راه تماس شما با ربات پیام‌رسان به طاها می‌رسد؛ اطلاعات محرمانه ننویسید."
            : "Your request is kept in Taha's private repository. Its text (without your name) goes to Google Gemini for triage, and a messenger bot sends Taha a notice with your contact details — please don't include anything confidential."}
        </p>
      </div>
    </form>
  );
}
