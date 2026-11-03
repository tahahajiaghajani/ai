// The books' kit: small building blocks shared by the accounting, reports, treasury, parties and settings screens —
// cards, notes, avatars, account labels, figures at a report's scale («مبالغ به میلیون ریال»), the printed header and
// footer, keyboard keys and form fields. The look lives in books.css (components.md §2, §4, §5, §12).
import "./books.css";
import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { Segmented, Tooltip } from "antd";
import { CalendarRange } from "lucide-react";
import { D, type Num } from "@shared/money";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { APP_NAME, APP_VERSION } from "@shared/constants";
import { useOrg } from "../../lib/org";
import { Figure } from "../../components/display";
import { SirafMark } from "../../components/brand";
import { docNo as faDocNo, toLatinDigits } from "../../lib/fa";

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
    <section className={cx("bk-card", className)} style={style}>
      {title || meta || tools ? (
        <header className="bk-card-h">
          {title ? <h2>{title}</h2> : null}
          {meta}
          {tools ? <div className="bk-card-x">{tools}</div> : null}
        </header>
      ) : null}
      {children !== undefined ? <div className={cx("bk-card-b", flush && "is-flush", bodyClass)}>{children}</div> : null}
    </section>
  );
}

/** A quiet note: surface + ring with a nuqta and lead words in the tone's colour (never an amber surface). */
export function Note({ tone = "neutral", children, action, className }: { tone?: "neutral" | "warning" | "danger"; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("bk-note", className)} data-tone={tone} role={tone === "neutral" ? "note" : "status"}>
      <i className="sf-nuqta" aria-hidden />
      <div>{children}</div>
      {action}
    </div>
  );
}

/** «۱۴۰۵/۰۱/۰۱ تا ۱۴۰۵/۱۲/۲۹» — the neutral period chip of a report card. */
export function Period({ from, to }: { from: string | null | undefined; to: string | null | undefined }) {
  if (!from && !to) return null;
  return (
    <span className="bk-period">
      <CalendarRange {...ICON14} aria-hidden />
      <span className="sf-num">
        {from ? formatJalali(from) : "…"} تا {to ? formatJalali(to) : "…"}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- people, accounts, numbers

/** Two Persian initials separated by a ZWNJ so they do not join. */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? "")
    .replace(/[()«»"']/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(شرکت|فروشگاه|آقای|خانم|بانک)$/.test(w));
  if (!words.length) return "؟";
  const a = words[0][0] ?? "";
  const b = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return b ? `${a}‌${b}` : a;
}

export function Avatar({ name, lg }: { name: string | null | undefined; lg?: boolean }) {
  return (
    <span className={cx("bk-av", lg && "is-lg")} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** A counterparty cell: avatar, then the name in text-2. */
export function Who({ name, sub }: { name: string | null | undefined; sub?: ReactNode }) {
  if (!name) return <span className="sf-zero">—</span>;
  return (
    <span className="bk-who">
      <Avatar name={name} />
      <span>
        {name}
        {sub ? <span className="bk-3"> {sub}</span> : null}
      </span>
    </span>
  );
}

/** «۱۱۰۱ صندوق مرکزی»: the code in tabular text-3, then the name. */
export function Acc({ code, name, sub }: { code?: string | number | null; name: ReactNode; sub?: ReactNode }) {
  return (
    <span className="bk-acc">
      {code !== null && code !== undefined && code !== "" ? <i>{faDigits(code)}</i> : null}
      <span>{name}</span>
      {sub ? <small>{sub}</small> : null}
    </span>
  );
}

/** A business document number: Persian digits, never grouped, tabular text-2. */
export function DocNo({ n, prefix }: { n: number | string | null | undefined; prefix?: string }) {
  if (n === null || n === undefined || n === "") return <span className="sf-zero">—</span>;
  const num = Number(n);
  return (
    <span className="bk-docno">
      {prefix ? `${prefix} ` : ""}
      {Number.isFinite(num) ? faDocNo(num) : faDigits(n)}
    </span>
  );
}
export const docNo = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "" : Number.isFinite(Number(n)) ? faDocNo(Number(n)) : faDigits(n));

/** «۰۹۰۱ ۷۸۵ ۳۹۰۰»: a phone number in Persian digits, grouped the Iranian way (mobile 4-3-4, landline 3-4-4). */
export function phoneFa(s: string | number | null | undefined): string {
  const raw = String(s ?? "");
  const d = toLatinDigits(raw).replace(/\D/g, "");
  if (/^09\d{9}$/.test(d)) return faDigits(`${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`);
  if (/^0\d{10}$/.test(d)) return faDigits(`${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`);
  return faDigits(raw);
}

/** A phone number: an LTR isolate in tabular Persian digits. */
export function Phone({ v }: { v: string | number | null | undefined }) {
  if (v === null || v === undefined || v === "") return <span className="sf-zero">—</span>;
  return (
    <bdi dir="ltr" className="sf-num">
      {phoneFa(v)}
    </bdi>
  );
}

/**
 * A bank reference (tracking, Sayad, IBAN, card): Latin by nature, so Geist Mono in an LTR isolate with Latin digits;
 * long bare numbers and IBANs are grouped in 4 («PAYA-28892», «1234 5678 9012 3456», «IR06 2960 …»).
 */
export function refText(s: string | number | null | undefined): string {
  const t = toLatinDigits(String(s ?? "")).trim();
  const bare = t.replace(/\s+/g, "");
  if (/^(IR)?\d{8,}$/i.test(bare)) return bare.toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
  return t;
}
export function Ref({ v, className }: { v: string | number | null | undefined; className?: string }) {
  if (v === null || v === undefined || v === "") return <span className="sf-zero">—</span>;
  return (
    <bdi dir="ltr" className={cx("sf-mono", className)}>
      {refText(v)}
    </bdi>
  );
}

// ---------------------------------------------------------------- report scale («مبالغ به میلیون ریال»)

export type Scale = 1 | 1000 | 1000000;
const ScaleCtx = createContext<Scale>(1);
const SCALE_KEY = "siraf.reports.scale";

/** The scale of a report's money figures, remembered per viewer. */
export function useScale(): [Scale, (s: Scale) => void] {
  const [s, set] = useState<Scale>(() => {
    try {
      const v = Number(localStorage.getItem(SCALE_KEY));
      return v === 1000 || v === 1000000 ? v : 1;
    } catch {
      return 1;
    }
  });
  return [
    s,
    (v: Scale) => {
      set(v);
      try {
        localStorage.setItem(SCALE_KEY, String(v));
      } catch {
        /* per-viewer convenience only */
      }
    },
  ];
}

export function ScaleProvider({ scale, children }: { scale: Scale; children: ReactNode }) {
  return <ScaleCtx.Provider value={scale}>{children}</ScaleCtx.Provider>;
}

export function unitCaption(scale: Scale, unit: string) {
  return `مبالغ به ${scale === 1000000 ? "میلیون " : scale === 1000 ? "هزار " : ""}${unit}`;
}

/** «ریال · هزار · میلیون»: the report's money scale, stated again in the card header. */
export function ScalePicker({ scale, onChange }: { scale: Scale; onChange: (s: Scale) => void }) {
  const { unit } = useOrg();
  return (
    <Tooltip title="واحد نمایش مبالغ">
      <Segmented
        size="small"
        value={scale}
        onChange={(v) => onChange(v as Scale)}
        options={[
          { value: 1, label: unit },
          { value: 1000, label: "هزار" },
          { value: 1000000, label: "میلیون" },
        ]}
      />
    </Tooltip>
  );
}

/**
 * A money figure at the report's scale. Zero is «—» in text-3 (or nothing with `zero=""`); `parens` writes a negative
 * the accountant's way, «(۱٬۲۳۴)», for statements and printed reports; `colored` paints money in.
 */
export function Amt({ v, parens, zero = "—", colored, className, strong }: { v: Num | null | undefined; parens?: boolean; zero?: string; colored?: boolean; className?: string; strong?: boolean }) {
  const { org } = useOrg();
  const scale = useContext(ScaleCtx);
  const d = D(v ?? 0).div(scale);
  const dp = scale === 1 ? (org.money_decimals ?? 0) : scale === 1000 ? 0 : 1;
  const r = d.toDecimalPlaces(dp);
  if (r.isZero()) return zero ? <span className={cx("sf-num sf-zero", className)}>{zero}</span> : null;
  const minDp = scale === 1000000 ? 1 : undefined;
  return (
    <span className={cx("sf-num", colored && r.gt(0) && "sf-in-t", strong && "font-semibold", className)}>
      {parens && r.isNeg() ? (
        // the closing parenthesis hangs past the column's edge, so the units digits of every row line up
        <bdi dir="ltr" className="sf-ltr">
          (<Figure v={r.abs()} dp={dp} minDp={minDp} />
          <span className="bk-hang">)</span>
        </bdi>
      ) : (
        <Figure v={r} dp={dp} minDp={minDp} />
      )}
    </span>
  );
}

/** A version string: Latin by nature, «1.0.0» in Geist inside an LTR isolate (never Persian digits with Latin dots). */
export function Version({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="sf-zero">—</span>;
  return (
    <bdi dir="ltr" className="sf-latin">
      {toLatinDigits(String(v))}
    </bdi>
  );
}

// ---------------------------------------------------------------- keys

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="bk-kbd">{children}</kbd>;
}

/** A kbd group: a bare LTR isolate; put spacing on the RTL wrapper around it. */
export function Keys({ k }: { k: string[] }) {
  return (
    <bdi dir="ltr" className="bk-keys-g">
      {k.map((x) => (
        <Kbd key={x}>{x}</Kbd>
      ))}
    </bdi>
  );
}

/** The shortcut inside a primary button: «ثبت سند  F2». */
export function BtnKeys({ k }: { k: string[] }) {
  return (
    <span className="bk-kbd-w" aria-hidden>
      <Keys k={k} />
    </span>
  );
}

// ---------------------------------------------------------------- forms

/** A form field for hand-built editors: the label above (13/20 500 text-2), the control, an optional hint. */
export function Field({ label, extra, hint, children, className, style, htmlFor }: { label: ReactNode; extra?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties; htmlFor?: string }) {
  return (
    <div className={cx("bk-f", className)} style={style}>
      <label className="bk-f-l" htmlFor={htmlFor}>
        {label}
        {extra ? <span className="bk-f-x">{extra}</span> : null}
      </label>
      {children}
      {hint ? <div className="bk-f-h">{hint}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- print

/** The printed header (components.md §12.3): the business at the start, the document at the end. Print only. */
export function PrintHead({ title, no, date, lines }: { title: ReactNode; no?: number | string | null; date?: string | null; lines?: ReactNode[] }) {
  const { org } = useOrg();
  const contact = [org.address, org.phone ? `تلفن ${faDigits(String(org.phone))}` : null, org.economic_code ? `کد اقتصادی ${faDigits(String(org.economic_code))}` : null].filter(Boolean);
  return (
    <div className="bk-po bk-ph" aria-hidden>
      <div className="bk-ph-org">
        {org.logo ? <img src={org.logo} alt="" /> : null}
        <div>
          <b>{org.legal_name || org.name}</b>
          {contact.length ? <span>{contact.join("، ")}</span> : null}
        </div>
      </div>
      <div className="bk-ph-doc">
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

/** The printed footer: signature lines, then «سیراف» and the print time in 7.5 pt. Print only. */
export function PrintFoot({ sign }: { sign?: string[] }) {
  const now = new Date();
  return (
    <div className="bk-po bk-pf" aria-hidden>
      {sign?.length ? (
        <div className="bk-pf-sig" style={{ ["--n" as string]: sign.length }}>
          {sign.map((s) => (
            <div key={s}>{s}</div>
          ))}
        </div>
      ) : null}
      <div className="bk-pf-meta">
        <span className="bk-pf-brand">
          <SirafMark size={12} variant="mono" title="" /> {APP_NAME} <Version v={APP_VERSION} />
        </span>
        <span className="sf-num">
          چاپ {formatJalali(now.toISOString().slice(0, 10))}، {faDigits(now.toTimeString().slice(0, 5))}
        </span>
      </div>
    </div>
  );
}
