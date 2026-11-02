// The shared head and foot of every printed sheet of the goods, gold and fx modules (components.md §12): the mark
// (or the business logo) at the start, the business and its legal facts, the document title, number and date at the
// end; the colophon with the print time and «سیراف، siraf.app» (the domain an LTR isolate, never a typed pipe).
import type { ReactNode } from "react";
import { useOrg } from "../../lib/org";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { APP_NAME } from "@shared/constants";
import { SirafMark } from "../../components/brand";

export function PrintHead({ title, rows, badge, legal = true }: { title: ReactNode; rows?: ReactNode[]; badge?: ReactNode; legal?: boolean }) {
  const { org } = useOrg();
  const showLogo = org.settings?.print?.show_logo !== false && !!org.logo;
  const facts = legal
    ? [
        org.economic_code ? `کد اقتصادی ${faDigits(org.economic_code)}` : null,
        org.national_id ? `شناسه‌ی ملی ${faDigits(org.national_id)}` : null,
        org.registration_no ? `شماره‌ی ثبت ${faDigits(org.registration_no)}` : null,
      ].filter(Boolean).join("، ")
    : "";
  const addr = [[org.province, org.city, org.address].filter(Boolean).join("، "), org.postal_code ? `کد پستی ${faDigits(org.postal_code)}` : null, org.phone ? `تلفن ${faDigits(org.phone)}` : null]
    .filter(Boolean)
    .join("، ");
  return (
    <header className="sf-pr-head">
      <div className="sf-pr-brand">{showLogo ? <img src={org.logo!} alt="" /> : <SirafMark size={32} variant="mono" />}</div>
      <div className="sf-pr-biz">
        <b>{org.legal_name || org.name}</b>
        {facts ? <span>{facts}</span> : null}
        {addr ? <span>{addr}</span> : null}
      </div>
      <div className="sf-pr-doc">
        <b className="t">{title}</b>
        {(rows ?? []).map((r, i) => (
          <div key={i}>{r}</div>
        ))}
        {badge ? <span className="sf-pr-badge">{badge}</span> : null}
      </div>
    </header>
  );
}

export function PrintColophon({ note }: { note?: ReactNode }) {
  return (
    <div className="sf-pr-colophon">
      <span>{note ?? <>چاپ: {formatJalaliDateTime(new Date().toISOString())}</>}</span>
      <span>
        {APP_NAME}،{" "}
        <bdi dir="ltr" className="latn">siraf.app</bdi>
      </span>
    </div>
  );
}
