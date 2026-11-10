// Building blocks shared by the settings, administration and AI screens (and by later modules): cards, quiet
// notes, people, record numbers, phone numbers and references, keyboard keys, form fields, and the printed
// header and footer. The look lives in blocks.css.
import "./blocks.css";
import type { CSSProperties, ReactNode } from "react";
import { CalendarRange } from "lucide-react";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { APP_NAME, APP_VERSION } from "@shared/constants";
import { useOrg } from "../lib/org";
import { BrandMark } from "./brand";
import { docNo as faDocNo, toLatinDigits } from "../lib/fa";

export const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
export const ICON14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- cards

/** A card: an optional header (title, meta, tools at the end) over a padded or flush body. */
export function Card({
  title,
  meta,
  tools,
  children,
  flush,
  className,
  bodyClass,
  style,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  tools?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  className?: string;
  bodyClass?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cx("blk-card", className)} style={style}>
      {title || meta || tools ? (
        <header className="blk-card-h">
          {title ? <h2>{title}</h2> : null}
          {meta}
          {tools ? <div className="blk-card-x">{tools}</div> : null}
        </header>
      ) : null}
      {children !== undefined ? <div className={cx("blk-card-b", flush && "is-flush", bodyClass)}>{children}</div> : null}
    </section>
  );
}

/** A quiet note: surface + ring with a nuqta and lead words in the tone's colour (never an amber surface). */
export function Note({ tone = "neutral", children, action, className }: { tone?: "neutral" | "warning" | "danger"; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("blk-note", className)} data-tone={tone} role={tone === "neutral" ? "note" : "status"}>
      <i className="ds-nuqta" aria-hidden />
      <div>{children}</div>
      {action}
    </div>
  );
}

/** «۱۴۰۵/۰۱/۰۱ تا ۱۴۰۵/۱۲/۲۹» — the neutral period chip of a report card. */
export function Period({ from, to }: { from: string | null | undefined; to: string | null | undefined }) {
  if (!from && !to) return null;
  return (
    <span className="blk-period">
      <CalendarRange {...ICON14} aria-hidden />
      <span className="ds-num">
        {from ? formatJalali(from) : "…"} تا {to ? formatJalali(to) : "…"}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- people, numbers, references

/** Two Persian initials separated by a ZWNJ so they do not join. */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? "")
    .replace(/[()«»"']/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(شرکت|آقای|خانم|دکتر|مهندس)$/.test(w));
  if (!words.length) return "؟";
  const a = words[0][0] ?? "";
  const b = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return b ? `${a}‌${b}` : a;
}

export function Avatar({ name, lg }: { name: string | null | undefined; lg?: boolean }) {
  return (
    <span className={cx("blk-av", lg && "is-lg")} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** A person cell: avatar, then the name in text-2. */
export function Who({ name, sub }: { name: string | null | undefined; sub?: ReactNode }) {
  if (!name) return <span className="ds-zero">—</span>;
  return (
    <span className="blk-who">
      <Avatar name={name} />
      <span>
        {name}
        {sub ? <span className="blk-3"> {sub}</span> : null}
      </span>
    </span>
  );
}

/** A record number: Persian digits, never grouped, tabular text-2. */
export function DocNo({ n, prefix }: { n: number | string | null | undefined; prefix?: string }) {
  if (n === null || n === undefined || n === "") return <span className="ds-zero">—</span>;
  const num = Number(n);
  return (
    <span className="blk-docno">
      {prefix ? `${prefix} ` : ""}
      {Number.isFinite(num) ? faDocNo(num) : faDigits(n)}
    </span>
  );
}
export const docNo = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "" : Number.isFinite(Number(n)) ? faDocNo(Number(n)) : faDigits(n));

/** «۰۹۱۲ ۱۲۳ ۴۵۶۷»: a phone number in Persian digits, grouped the Iranian way (mobile 4-3-4, landline 3-4-4). */
export function phoneFa(s: string | number | null | undefined): string {
  const raw = String(s ?? "");
  const d = toLatinDigits(raw).replace(/\D/g, "");
  if (/^09\d{9}$/.test(d)) return faDigits(`${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`);
  if (/^0\d{10}$/.test(d)) return faDigits(`${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`);
  return faDigits(raw);
}

/** A phone number: an LTR isolate in tabular Persian digits. */
export function Phone({ v }: { v: string | number | null | undefined }) {
  if (v === null || v === undefined || v === "") return <span className="ds-zero">—</span>;
  return (
    <bdi dir="ltr" className="ds-num">
      {phoneFa(v)}
    </bdi>
  );
}

/**
 * A reference that is Latin by nature (a tracking code, a serial number, an IBAN): Geist Mono in an LTR isolate
 * with Latin digits; long bare numbers and IBANs are grouped in 4 («1234 5678 9012 3456», «IR06 2960 …»).
 */
export function refText(s: string | number | null | undefined): string {
  const t = toLatinDigits(String(s ?? "")).trim();
  const bare = t.replace(/\s+/g, "");
  if (/^(IR)?\d{8,}$/i.test(bare)) return bare.toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
  return t;
}
export function Ref({ v, className }: { v: string | number | null | undefined; className?: string }) {
  if (v === null || v === undefined || v === "") return <span className="ds-zero">—</span>;
  return (
    <bdi dir="ltr" className={cx("ds-mono", className)}>
      {refText(v)}
    </bdi>
  );
}

/** A version string: Latin by nature, «1.0.0» in Geist inside an LTR isolate (never Persian digits with Latin dots). */
export function Version({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="ds-zero">—</span>;
  return (
    <bdi dir="ltr" className="ds-latin">
      {toLatinDigits(String(v))}
    </bdi>
  );
}

// ---------------------------------------------------------------- keys

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="blk-kbd">{children}</kbd>;
}

/** A kbd group: a bare LTR isolate; put spacing on the RTL wrapper around it. */
export function Keys({ k }: { k: string[] }) {
  return (
    <bdi dir="ltr" className="blk-keys-g">
      {k.map((x) => (
        <Kbd key={x}>{x}</Kbd>
      ))}
    </bdi>
  );
}

/** The shortcut inside a primary button: «ذخیره  F2». */
export function BtnKeys({ k }: { k: string[] }) {
  return (
    <span className="blk-kbd-w" aria-hidden>
      <Keys k={k} />
    </span>
  );
}

// ---------------------------------------------------------------- forms

/** A form field for hand-built editors: the label above (13/20 500 text-2), the control, an optional hint. */
export function Field({ label, extra, hint, children, className, style, htmlFor }: { label: ReactNode; extra?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties; htmlFor?: string }) {
  return (
    <div className={cx("blk-f", className)} style={style}>
      <label className="blk-f-l" htmlFor={htmlFor}>
        {label}
        {extra ? <span className="blk-f-x">{extra}</span> : null}
      </label>
      {children}
      {hint ? <div className="blk-f-h">{hint}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- print

/** The printed header (components.md §12.3): the organisation at the start, the document at the end. Print only. */
export function PrintHead({ title, no, date, lines }: { title: ReactNode; no?: number | string | null; date?: string | null; lines?: ReactNode[] }) {
  const { org } = useOrg();
  const contact = [org.address, org.phone ? `تلفن ${faDigits(String(org.phone))}` : null].filter(Boolean);
  return (
    <div className="blk-po blk-ph" aria-hidden>
      <div className="blk-ph-org">
        {org.logo ? <img src={org.logo} alt="" /> : null}
        <div>
          <b>{org.legal_name || org.name}</b>
          {contact.length ? <span>{contact.join("، ")}</span> : null}
        </div>
      </div>
      <div className="blk-ph-doc">
        <b>{title}</b>
        {no !== undefined && no !== null && no !== "" ? <span>شماره {docNo(no)}</span> : null}
        {date ? <span>تاریخ {formatJalali(date)}</span> : null}
        {(lines ?? []).map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/** The printed footer: signature lines, then the app's name and the print time in 7.5 pt. Print only. */
export function PrintFoot({ sign }: { sign?: string[] }) {
  const now = new Date();
  return (
    <div className="blk-po blk-pf" aria-hidden>
      {sign?.length ? (
        <div className="blk-pf-sig" style={{ ["--n" as string]: sign.length }}>
          {sign.map((s) => (
            <div key={s}>{s}</div>
          ))}
        </div>
      ) : null}
      <div className="blk-pf-meta">
        <span className="blk-pf-brand">
          <BrandMark size={12} variant="mono" title="" /> {APP_NAME} <Version v={APP_VERSION} />
        </span>
        <span className="ds-num">
          چاپ {formatJalali(now.toISOString().slice(0, 10))}، {faDigits(now.toTimeString().slice(0, 5))}
        </span>
      </div>
    </div>
  );
}
