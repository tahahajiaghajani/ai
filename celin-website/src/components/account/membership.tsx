"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { requestPro } from "@/app/actions/account";
import { myProRequest } from "@/app/actions/member";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { formatDate, type Lang } from "@/lib/format";
import { proEndedText } from "@/lib/pro-copy";
import { href } from "@/lib/i18n";
import { LuxFrame } from "@/components/ui/lux-frame";
import { Grain } from "@/components/fx/grain";
import { ProCodeCeremony } from "@/components/pro/ceremony";
import { CodeInput } from "@/components/pro/code-input";
import { ProCodeLink } from "@/components/pro/pro-code-link";
import { ProHallmark, ProSeal } from "@/components/pro/seal";
import { sessionChanged, useMe } from "@/components/pro/session";
import { ProSteps } from "@/components/pro/steps";
import type { StoreContactInfo } from "@/components/account/contact";
import { BusyLabel, FormNote, SelectField, TextArea, TextField, btn } from "@/components/account/ui";

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

/** A light jewel-box panel: the seal and a title on top, then the content. */
function Panel({ title, seal = true, children, compact = false }: { title?: ReactNode; seal?: boolean; children: ReactNode; compact?: boolean }) {
  return (
    <LuxFrame className={`bg-porcelain/85 ${compact ? "px-5 py-6 sm:px-7 sm:py-7" : "px-6 py-8 sm:px-10 sm:py-10"}`}>
      <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(70%_90%_at_100%_0%,var(--color-gold-mist),transparent_70%)] rtl:bg-[radial-gradient(70%_90%_at_0%_0%,var(--color-gold-mist),transparent_70%)]" />
      {title ? (
        <>
          <div className="flex items-center gap-4">
            {seal && <ProSeal size={compact ? "sm" : "md"} />}
            <p className={compact ? "title-card" : "title-section"}>{title}</p>
          </div>
          <div className="mt-4">{children}</div>
        </>
      ) : (
        <div className="flex items-start gap-4 sm:gap-5">
          {seal && <ProSeal size={compact ? "sm" : "md"} className="mt-1" />}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      )}
    </LuxFrame>
  );
}

/** The member's card: espresso, champagne rules, the hallmark — Pro is active. */
function MemberCard({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <LuxFrame tone="dark" keystone={!compact} data-tone="light" className={`bg-night-2 text-on-night ${compact ? "px-5 py-6 sm:px-7" : "px-6 py-9 sm:px-10 sm:py-11"}`}>
      <span aria-hidden className="absolute inset-0 -z-10 bg-mesh-cocoa" />
      <Grain />
      <div className={`relative grid items-center ${compact ? "gap-5 sm:grid-cols-[auto_minmax(0,1fr)]" : "gap-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-10"}`}>
        <ProHallmark className={compact ? "size-16" : "mx-auto size-28 sm:size-36"} />
        <div className="min-w-0">{children}</div>
      </div>
    </LuxFrame>
  );
}

/**
 * The membership block: visitor → sign in / have a code; signed in → request form; pending → the steps and the
 * date; declined → the store's reply and «درخواست دوباره»; code issued → the code ceremony; active → the
 * member's card with its dates.
 */
export function Membership({ lang, variant, initial, contact }: { lang: Lang; variant: Variant; initial?: MembershipSnapshot; contact?: StoreContactInfo }) {
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

  if (loading) return <div className="min-h-64 border border-gold/20 bg-porcelain/60" aria-busy />;

  const proHref = `${href(lang, "/pro")}#request`;

  if (state === "guest") {
    return (
      <Panel title={c.guestTitle}>
        <p className="max-w-lg font-ui text-sm leading-7 text-ink-2">{c.guestText}</p>
        <ProSteps lang={lang} current={0} className="mt-7 max-w-md" />
        <div className="mt-8 flex flex-col gap-x-6 gap-y-3 sm:flex-row sm:items-center">
          <Link href={`${href(lang, "/account/login")}?tab=signup&next=${encodeURIComponent(proHref)}`} className={`${btn.metal} btn-lg`}>
            {c.guestCta}
          </Link>
          <ProCodeLink lang={lang} className={`${btn.text} max-sm:mx-auto`}>
            {c.haveCode}
          </ProCodeLink>
        </div>
      </Panel>
    );
  }

  if (state === "active" && pro) {
    const until = pro.expiresAt ? c.activeUntil(formatDate(pro.expiresAt, lang)) : c.activeNoEnd;
    if (variant === "compact") {
      return (
        <MemberCard compact>
          <p className="title-card text-metal-light">{c.activeTitle}</p>
          <p className="mt-1 font-ui text-sm leading-7 text-on-night-muted">{until}</p>
          <p className="mt-3 flex flex-wrap gap-x-7 gap-y-1">
            <Link href={href(lang, "/account/cart")} className="btn-link btn-link-light">
              {c.newOrder}
            </Link>
            <Link href={href(lang, "/account/pro")} className="btn-link btn-link-light">
              {c.details}
            </Link>
          </p>
        </MemberCard>
      );
    }
    return (
      <MemberCard>
        <p className="font-label text-[11px] tracking-[0.32em] text-gold-on-dark">
          <span className="ltr">CELIN PRO</span>
        </p>
        <p className="title-section mt-2 text-metal-light">{c.activeTitle}</p>
        <p className="mt-1 font-ui text-sm leading-7 text-on-night-muted">{until}</p>
        {variant === "account" && (
          <dl className="mt-6 grid max-w-md grid-cols-2 border-y border-night-line font-ui text-sm">
            <div className="py-3 pe-4">
              <dt className="text-xs text-on-night-muted">{c.since}</dt>
              <dd className="mt-1 text-on-night">{pro.since ? formatDate(pro.since, lang) : "—"}</dd>
            </div>
            <div className="border-s border-night-line py-3 ps-4">
              <dt className="text-xs text-on-night-muted">{c.validUntil}</dt>
              <dd className="mt-1 text-on-night">{pro.expiresAt ? formatDate(pro.expiresAt, lang) : c.noEnd}</dd>
            </div>
          </dl>
        )}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link href={href(lang, "/shop")} className={`${btn.metal} btn-lg`}>
            {c.toShop}
          </Link>
          <Link href={href(lang, "/account/cart")} className="btn btn-line-light btn-lg">
            {c.newOrder}
          </Link>
        </div>
      </MemberCard>
    );
  }

  if (state === "issued") {
    if (variant === "compact") {
      return (
        <Panel title={c.issuedTitle} compact>
          <p className="mb-5 max-w-lg font-ui text-sm leading-7 text-ink-2">{c.issuedText}</p>
          <div className="max-w-md">
            <CodeInput lang={lang} onDone={refresh} />
          </div>
        </Panel>
      );
    }
    return <ProCodeCeremony lang={lang} title={c.issuedTitle} lead={c.issuedText} contact={contact} onDone={refresh} className="mx-auto w-full max-w-[27rem] pt-3" />;
  }

  if (state === "pending") {
    return (
      <Panel title={sent ? c.sentTitle : c.pendingTitle} compact={variant === "compact"}>
        <p className="max-w-lg font-ui text-sm leading-7 text-ink-2">{c.pendingText}</p>
        <ProSteps lang={lang} current={1} className="mt-7 max-w-md" />
        {requestedAt && <p className="mt-6 font-ui text-xs text-muted">{c.pendingDate(formatDate(requestedAt, lang))}</p>}
      </Panel>
    );
  }

  // a former Pro member is told when and why the membership ended (expired / revoked)
  const ended = proEndedText(lang, me?.pro.ended);

  if (variant === "compact") {
    return (
      <Panel compact>
        {ended && <p className="mb-3 max-w-lg font-ui text-sm leading-7 text-ink">{ended}</p>}
        <p className="max-w-lg font-ui text-sm leading-7 text-ink-2">{accountCopy(lang).dashboard.noProText}</p>
        <Link href={proHref} className={`${btn.outline} mt-5`}>
          {accountCopy(lang).dashboard.noProCta}
        </Link>
      </Panel>
    );
  }

  if (state === "rejected" && pro) {
    return (
      <Panel title={c.rejectedTitle}>
        {pro.reply && <p className="mb-4 whitespace-pre-line border-s-2 border-gold/60 bg-gold-mist/50 px-4 py-3 font-ui text-sm leading-7 text-ink">{pro.reply}</p>}
        <p className="max-w-lg font-ui text-sm leading-7 text-ink-2">{c.rejectedText}</p>
        <button type="button" onClick={() => setAgain(true)} className={`${btn.outline} mt-6`}>
          {c.again}
        </button>
      </Panel>
    );
  }

  return (
    <>
      {ended && <p className="mb-6 max-w-lg border-s-2 border-gold/60 ps-4 font-ui text-sm leading-7 text-ink">{ended}</p>}
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
    </>
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
    <LuxFrame className="bg-porcelain/85 px-6 py-8 sm:px-10 sm:py-10">
      <form onSubmit={submit} noValidate>
        <div className="flex items-center gap-4">
          <ProSeal size="md" />
          <div>
            <p className="title-section">{m.formTitle}</p>
          </div>
        </div>
        <p className="mt-3 max-w-lg font-ui text-sm leading-7 text-muted">{m.formLead}</p>
        <ProSteps lang={lang} current={0} className="mt-7 max-w-md" />
        <div className="mt-9 grid gap-6 border-t border-gold/20 pt-8 sm:grid-cols-2">
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
        <div className="mt-6 empty:mt-0">{error && <FormNote tone="error">{error}</FormNote>}</div>
        {/* aria-disabled (not disabled) while sending: the focus stays on the button */}
        <button type="submit" aria-disabled={pending || undefined} aria-busy={pending || undefined} className={`${btn.metal} btn-lg mt-7 w-full sm:w-auto sm:min-w-64`}>
          <BusyLabel busy={pending}>{m.submit}</BusyLabel>
        </button>
      </form>
    </LuxFrame>
  );
}
