"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { requestPro } from "@/app/actions/account";
import { myProRequest } from "@/app/actions/member";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { formatDate, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { CodeInput } from "@/components/pro/code-input";
import { openProSheet } from "@/components/pro/events";
import { sessionChanged, useMe } from "@/components/pro/session";
import { FormNote, SelectField, TextArea, TextField, btn } from "@/components/account/ui";

/** Pro state of the member as the server saw it (account pages pass it so nothing flashes while /api/me loads). */
export interface MembershipSnapshot {
  active: boolean;
  issued: boolean;
  expiresAt: string | null;
  since: string | null;
  request: "none" | "pending" | "approved" | "rejected";
  reply: string;
  requestedAt: string | null;
}

type Variant = "page" | "account" | "compact";
const KINDS = ["retail", "online", "wholesale", "personal", "other"] as const;

function Card({ title, children, tone = "bone" }: { title?: ReactNode; children: ReactNode; tone?: "bone" | "plain" | "gold" }) {
  const cls = tone === "gold" ? "border-gold/40 bg-gold-mist/60" : tone === "plain" ? "border-line" : "border-line bg-bone";
  return (
    <div className={`border px-5 py-7 sm:px-8 sm:py-8 ${cls}`}>
      {title && <p className="display text-2xl">{title}</p>}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </div>
  );
}

/**
 * The membership block: visitor → sign in / have a code; signed in → request form; pending → status with
 * the date; declined → the store's reply and «درخواست دوباره»; code issued → the code field; active → until when.
 */
export function Membership({ lang, variant, initial }: { lang: Lang; variant: Variant; initial?: MembershipSnapshot }) {
  const c = accountCopy(lang).membership;
  const me = useMe();
  const router = useRouter();
  const [again, setAgain] = useState(false);
  const [sent, setSent] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(initial?.requestedAt ?? null);

  const loading = me === undefined && !initial;
  const signedIn = me === undefined ? Boolean(initial) : Boolean(me);
  const pro = me ? { ...me.pro, since: initial?.since ?? null } : initial;
  const state = !signedIn || !pro ? "guest" : pro.active ? "active" : pro.issued ? "issued" : pro.request === "pending" ? "pending" : pro.request === "rejected" && !again ? "rejected" : "form";

  // the static /pro page does not know when the request was sent: ask once
  useEffect(() => {
    if (state !== "pending" || requestedAt) return;
    let live = true;
    myProRequest()
      .then((r) => live && r?.status === "pending" && setRequestedAt(r.created_at))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [state, requestedAt]);

  const refresh = () => {
    if (variant !== "page") router.refresh();
  };

  if (loading) return <div className="min-h-56 border border-line bg-bone/50" aria-busy />;

  const proHref = `${href(lang, "/pro")}#request`;

  if (state === "guest") {
    return (
      <Card title={c.guestTitle}>
        <p className="max-w-lg text-sm leading-7 text-ink-2">{c.guestText}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href={`${href(lang, "/account/login")}?tab=signup&next=${encodeURIComponent(proHref)}`} className={btn.primary}>
            {c.guestCta}
          </Link>
          <button type="button" onClick={() => openProSheet("code")} className={btn.outline}>
            {c.haveCode}
          </button>
        </div>
      </Card>
    );
  }

  if (state === "active" && pro) {
    const until = pro.expiresAt ? c.activeUntil(formatDate(pro.expiresAt, lang)) : c.activeNoEnd;
    if (variant === "compact") {
      return (
        <Card tone="gold">
          <p className="text-sm leading-7 text-ink">{until}</p>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            <Link href={href(lang, "/account/cart")} className={btn.quiet}>
              {c.newOrder}
            </Link>
            <Link href={href(lang, "/account/pro")} className={btn.text}>
              {c.details}
            </Link>
          </p>
        </Card>
      );
    }
    return (
      <Card title={c.activeTitle} tone="gold">
        <p className="text-sm leading-7 text-ink-2">{until}</p>
        {variant === "account" && (
          <dl className="mt-6 grid max-w-md grid-cols-2 gap-px border border-line bg-line text-sm">
            <div className="bg-ground px-4 py-3">
              <dt className="text-xs text-muted">{c.since}</dt>
              <dd className="mt-1 text-ink">{pro.since ? formatDate(pro.since, lang) : "—"}</dd>
            </div>
            <div className="bg-ground px-4 py-3">
              <dt className="text-xs text-muted">{c.validUntil}</dt>
              <dd className="mt-1 text-ink">{pro.expiresAt ? formatDate(pro.expiresAt, lang) : c.noEnd}</dd>
            </div>
          </dl>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href={href(lang, "/shop")} className={btn.primary}>
            {c.toShop}
          </Link>
          <Link href={href(lang, "/account/cart")} className={btn.outline}>
            {c.newOrder}
          </Link>
        </div>
      </Card>
    );
  }

  if (state === "issued") {
    return (
      <Card title={c.issuedTitle} tone="plain">
        <p className="mb-6 max-w-lg text-sm leading-7 text-ink-2">{c.issuedText}</p>
        <div className="max-w-md">
          <CodeInput lang={lang} onDone={refresh} />
        </div>
      </Card>
    );
  }

  if (state === "pending") {
    return (
      <Card title={sent ? c.sentTitle : c.pendingTitle}>
        <p className="max-w-lg text-sm leading-7 text-ink-2">{c.pendingText}</p>
        {requestedAt && <p className="mt-3 text-xs text-muted">{c.pendingDate(formatDate(requestedAt, lang))}</p>}
      </Card>
    );
  }

  if (variant === "compact") {
    return (
      <Card>
        <p className="max-w-lg text-sm leading-7 text-ink-2">{accountCopy(lang).dashboard.noProText}</p>
        <Link href={proHref} className={`${btn.outline} mt-5`}>
          {accountCopy(lang).dashboard.noProCta}
        </Link>
      </Card>
    );
  }

  if (state === "rejected" && pro) {
    return (
      <Card title={c.rejectedTitle}>
        {pro.reply && <p className="mb-4 whitespace-pre-line border-s border-gold/60 ps-4 text-sm leading-7 text-ink">{pro.reply}</p>}
        <p className="max-w-lg text-sm leading-7 text-ink-2">{c.rejectedText}</p>
        <button type="button" onClick={() => setAgain(true)} className={`${btn.outline} mt-6`}>
          {c.again}
        </button>
      </Card>
    );
  }

  return (
    <RequestForm
      lang={lang}
      defaults={{ business: me?.business ?? "", city: me?.city ?? "" }}
      onSent={async () => {
        setSent(true);
        setAgain(false);
        setRequestedAt(new Date().toISOString());
        await sessionChanged();
        refresh();
      }}
    />
  );
}

function RequestForm({ lang, defaults, onSent }: { lang: Lang; defaults: { business: string; city: string }; onSent: () => Promise<void> }) {
  const c = accountCopy(lang);
  const m = c.membership;
  const [f, setF] = useState({ business: defaults.business, city: defaults.city, instagram: "", kind: "retail" as (typeof KINDS)[number], note: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((s) => ({ ...s, [k]: e.target.value }));
    if (fieldError?.field === k) setFieldError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setFieldError(null);
    try {
      const r = await requestPro({ ...f, lang });
      if (r.ok) {
        await onSent();
        return;
      }
      if (r.field) {
        setFieldError({ field: r.field, text: r.error });
        document.getElementById(`pro-${r.field}`)?.focus();
      } else setError(r.error);
    } catch {
      setError(commonCopy(lang).errors.network);
    }
    setPending(false);
  }
  const err = (k: string) => (fieldError?.field === k ? fieldError.text : undefined);

  return (
    <form onSubmit={submit} noValidate className="border border-line px-5 py-7 sm:px-8 sm:py-8">
      <p className="display text-2xl">{m.formTitle}</p>
      <p className="mt-3 max-w-lg text-sm leading-7 text-muted">{m.formLead}</p>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <TextField id="pro-business" label={c.fields.business} value={f.business} onChange={set("business")} autoComplete="organization" maxLength={120} required error={err("business")} />
        <TextField id="pro-city" label={c.fields.city} value={f.city} onChange={set("city")} autoComplete="address-level2" maxLength={80} />
        <TextField id="pro-instagram" label={m.instagram} optional={c.fields.optional} value={f.instagram} onChange={set("instagram")} dir="ltr" spellCheck={false} autoCapitalize="none" maxLength={120} placeholder="@celin" />
        <SelectField id="pro-kind" label={m.kind} value={f.kind} onChange={set("kind")}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {m.kinds[k]}
            </option>
          ))}
        </SelectField>
        <TextArea id="pro-note" label={m.note} optional={c.fields.optional} value={f.note} onChange={set("note")} maxLength={1000} placeholder={m.notePlaceholder} wrapClassName="sm:col-span-2" />
      </div>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        {error && <FormNote tone="error">{error}</FormNote>}
      </div>
      <button type="submit" disabled={pending} className={`${btn.primary} mt-6 w-full sm:w-auto`}>
        {pending ? "…" : m.submit}
      </button>
    </form>
  );
}
