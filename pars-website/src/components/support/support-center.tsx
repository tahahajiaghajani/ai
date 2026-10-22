"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Copy } from "@/content/fa";
import type { Lang } from "@/lib/i18n";
import { CATEGORIES, CATEGORY_LABEL, PRODUCTS, PRODUCT_LABEL, isCategory, type TicketCategory, type TicketProduct } from "@/lib/ticket-meta";
import { findTicket, submitTicket, suggestAnswer } from "@/app/actions/support";
import { Markdown } from "@/components/chat/markdown";
import { Button, Input, Label, Select, Spinner, Textarea } from "@/components/ui/field";
import { Icon } from "@/components/site/icons";

interface Saved {
  code: string;
  url: string;
  subject: string;
  at: string;
}

const STORE = "pars-tickets";

/** A Server Action that rejects (dropped connection, new deployment, server error) — shown inline, the form keeps its values. */
const NET_ERROR = { fa: "ارتباط برقرار نشد؛ اتصال اینترنت را بررسی کنید و دوباره امتحان کنید.", en: "Couldn't connect — check your connection and try again." };

/** Step-2 fields, kept while the visitor goes back to step 1 (step 2 unmounts). */
const CONTACT = ["name", "email", "phone", "organization", "source"] as const;
type Contact = Partial<Record<(typeof CONTACT)[number], string>>;

function loadSaved(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "[]") as Saved[];
  } catch {
    return [];
  }
}

export function SupportCenter({ lang, t }: { lang: Lang; t: Copy["support"] }) {
  const params = useSearchParams();
  const [tab, setTab] = useState<"new" | "track">(params.get("tab") === "track" ? "track" : "new");
  const [saved, setSaved] = useState<Saved[]>([]);
  useEffect(() => setSaved(loadSaved()), []);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="card overflow-hidden">
        <div role="tablist" className="flex border-b border-line p-2">
          {(["new", "track"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`flex-1 rounded-2xl py-3 text-[15px] font-semibold transition ${tab === k ? "bg-white/[0.07] text-fg" : "text-muted hover:text-fg"}`}
            >
              {k === "new" ? t.tabNew : t.tabTrack}
            </button>
          ))}
        </div>
        <div className="p-6 sm:p-9">
          {tab === "new" ? (
            <NewTicket
              lang={lang}
              t={t}
              initialCategory={isCategory(params.get("category")) ? (params.get("category") as TicketCategory) : "support"}
              onCreated={(s) => {
                const next = [s, ...loadSaved().filter((x) => x.code !== s.code)].slice(0, 10);
                try {
                  localStorage.setItem(STORE, JSON.stringify(next));
                } catch {}
                setSaved(next);
              }}
            />
          ) : (
            <Track lang={lang} t={t} />
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-reverse text-white">
              <Icon name="ai" className="size-5" />
            </span>
            <p className="text-sm leading-7 text-muted">{t.aiNote}</p>
          </div>
        </div>
        {saved.length > 0 && (
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-faint">{t.mine}</h2>
            <ul className="mt-3 space-y-2">
              {saved.map((s) => (
                <li key={s.code}>
                  <a href={s.url} className="block rounded-xl border border-line px-3.5 py-2.5 transition hover:border-pink/40">
                    <span className="ltr block font-brand text-xs text-pink rtl:text-right">{s.code}</span>
                    <span className="mt-0.5 block truncate text-sm">{s.subject}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function NewTicket({ lang, t, initialCategory, onCreated }: { lang: Lang; t: Copy["support"]; initialCategory: TicketCategory; onCreated: (s: Saved) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [category, setCategory] = useState<TicketCategory>(initialCategory);
  const [product, setProduct] = useState<TicketProduct>("other");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState<Contact>({});
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [checking, startCheck] = useTransition();
  const [sending, startSend] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ code: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const L = (x: { fa: string; en: string }) => x[lang];

  const next = () => {
    setError("");
    if (subject.trim().length < 3 || body.trim().length < 10) {
      setError(lang === "fa" ? "عنوان و شرح درخواست را کامل‌تر بنویسید." : "Please add a little more detail to the subject and description.");
      return;
    }
    startCheck(async () => {
      try {
        const r = await suggestAnswer({ subject, body, lang });
        if (r.ok && r.answer) setSuggestion(r.answer);
        else setStep(2);
      } catch {
        setStep(2); // the suggestion is optional
      }
    });
  };

  if (solved) {
    return (
      <div className="py-10 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-success/15 text-success">
          <Icon name="check" className="size-7" />
        </span>
        <p className="mx-auto mt-5 max-w-md text-lg leading-8">{t.solvedThanks}</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="py-4 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-reverse text-white shadow-[0_20px_50px_-15px_rgb(223_17_115/0.8)]">
          <Icon name="check" className="size-8" />
        </span>
        <h2 className="mt-6 text-2xl font-extrabold">{t.doneTitle}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted">{t.doneLead}</p>
        <div className="mx-auto mt-7 max-w-sm rounded-2xl border border-line-strong bg-ink-2 p-5">
          <div className="text-xs text-faint">{t.code}</div>
          <div className="ltr mt-1 font-brand text-3xl font-bold tracking-wider text-gradient">{done.code}</div>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href={done.url} className="inline-flex h-12 items-center gap-2 rounded-full bg-magenta px-6 font-semibold text-white hover:bg-magenta-deep">
            {t.view}
            <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
          </a>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(new URL(done.url, window.location.href).href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? t.copied : t.copyLink}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 1) return next();
        const fd = new FormData(e.currentTarget);
        setError("");
        startSend(async () => {
          try {
            const r = await submitTicket({
              lang,
              category,
              product,
              subject,
              body,
              name: fd.get("name"),
              email: fd.get("email"),
              phone: fd.get("phone"),
              organization: fd.get("organization"),
              source: fd.get("source"),
              website: fd.get("website"),
            });
            if (!r.ok) return setError(r.error);
            setDone({ code: r.code, url: r.url });
            onCreated({ code: r.code, url: r.url, subject, at: new Date().toISOString() });
          } catch {
            setError(NET_ERROR[lang]);
          }
        });
      }}
      className="space-y-6"
    >
      {/* steps */}
      <ol className="flex items-center gap-3 text-sm">
        {[t.step1, t.step2].map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span className={`grid size-7 place-items-center rounded-full text-xs font-bold ${step >= i + 1 ? "bg-magenta text-white" : "bg-white/10 text-muted"}`}>{lang === "fa" ? ["۱", "۲"][i] : i + 1}</span>
            <span className={step >= i + 1 ? "text-fg" : "text-faint"}>{label}</span>
            {i === 0 && <span className="mx-1 h-px w-8 bg-line-strong" />}
          </li>
        ))}
      </ol>

      {step === 1 && !suggestion && (
        <div className="space-y-5 animate-[fade-in_.4s_both]">
          <div>
            <Label>{t.category}</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={`rounded-full border px-3.5 py-2 text-sm transition ${category === c ? "border-pink/60 bg-pink/10 text-fg" : "border-line text-muted hover:text-fg"}`}
                >
                  {L(CATEGORY_LABEL[c])}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="product">{t.product}</Label>
            <Select id="product" value={product} onChange={(e) => setProduct(e.target.value as TicketProduct)}>
              {PRODUCTS.map((p) => (
                <option key={p} value={p}>
                  {L(PRODUCT_LABEL[p])}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="subject" hint={t.required}>
              {t.subject}
            </Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} placeholder={t.subjectPh} dir="auto" required />
          </div>
          <div>
            <Label htmlFor="body" hint={t.required}>
              {t.body}
            </Label>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={6000} rows={6} placeholder={t.bodyPh} dir="auto" required />
          </div>
          <div className="flex items-center justify-end gap-3">
            {checking && (
              <span className="flex items-center gap-2 text-sm text-muted">
                <Spinner />
                {t.checking}
              </span>
            )}
            <Button type="submit" disabled={checking}>
              {t.next}
              <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
            </Button>
          </div>
        </div>
      )}

      {step === 1 && suggestion && (
        <div className="animate-[fade-in_.5s_both] rounded-3xl border border-violet/30 bg-violet/[0.06] p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet">
            <Icon name="ai" className="size-4.5" />
            {t.suggestTitle}
          </div>
          <div className="mt-3 text-[15px] text-fg/95">
            <Markdown text={suggestion} />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button type="button" variant="soft" onClick={() => setSolved(true)}>
              <Icon name="check" className="size-4 text-success" />
              {t.suggestSolved}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSuggestion(null);
                setStep(2);
              }}
            >
              {t.suggestContinue}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5 animate-[fade-in_.4s_both]">
          <div className="rounded-2xl border border-line bg-ink-2/60 px-4 py-3 text-sm">
            <span className="text-faint">{L(CATEGORY_LABEL[category])} · </span>
            <span className="font-semibold">{subject}</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="name" hint={t.required}>
                {t.name}
              </Label>
              <Input id="name" name="name" defaultValue={contact.name} autoComplete="name" maxLength={80} required />
            </div>
            <div>
              <Label htmlFor="email" hint={t.required}>
                {t.email}
              </Label>
              <Input id="email" name="email" defaultValue={contact.email} type="email" autoComplete="email" maxLength={120} dir="ltr" required />
            </div>
            <div>
              <Label htmlFor="phone">{t.phone}</Label>
              <Input id="phone" name="phone" defaultValue={contact.phone} type="tel" autoComplete="tel" maxLength={30} dir="ltr" />
            </div>
            <div>
              <Label htmlFor="organization">{t.organization}</Label>
              <Input id="organization" name="organization" defaultValue={contact.organization} autoComplete="organization" maxLength={120} />
            </div>
          </div>
          <div>
            <Label htmlFor="source">{t.source}</Label>
            <Input id="source" name="source" defaultValue={contact.source} maxLength={160} />
          </div>
          {/* honeypot */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -start-[9999px] h-0 w-0 opacity-0" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="soft"
              onClick={(e) => {
                const fd = new FormData(e.currentTarget.form ?? undefined);
                setContact(Object.fromEntries(CONTACT.map((k) => [k, String(fd.get(k) ?? "")])));
                setStep(1);
              }}
            >
              {t.back}
            </Button>
            <Button type="submit" disabled={sending}>
              {sending ? (
                <>
                  <Spinner />
                  {t.submitting}
                </>
              ) : (
                t.submit
              )}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">{error}</p>}
    </form>
  );
}

function Track({ lang, t }: { lang: Lang; t: Copy["support"] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError("");
        start(async () => {
          try {
            const r = await findTicket({ code: String(fd.get("code") ?? ""), email: String(fd.get("email") ?? ""), lang });
            if (!r.ok) return setError(r.error);
            window.location.assign(r.url);
          } catch {
            setError(NET_ERROR[lang]);
          }
        });
      }}
      className="space-y-5"
    >
      <div>
        <h2 className="text-xl font-extrabold">{t.trackTitle}</h2>
        <p className="mt-1 text-sm text-muted">{t.trackLead}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="code">{t.trackCode}</Label>
          <Input id="code" name="code" placeholder="PP-XXXXXX" dir="ltr" className="font-brand uppercase" required />
        </div>
        <div>
          <Label htmlFor="temail">{t.email}</Label>
          <Input id="temail" name="email" type="email" dir="ltr" autoComplete="email" required />
        </div>
      </div>
      {error && <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t.trackBtn}
        </Button>
      </div>
    </form>
  );
}
