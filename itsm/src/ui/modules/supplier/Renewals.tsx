// «تقویم تمدید» (catalogue SUP-009): twelve Jalali months of what comes due — the last day to give notice and the end of
// every contract (automatic renewals marked), SaaS renewals, ends of licences, warranties and leases, contract
// obligations — with what is already overdue on top and the value renewing in the next ninety days (money only with
// the financial field group). Each entry opens its record.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "antd";
import { CalendarRange } from "lucide-react";
import { ENTRY_LABELS, type CalendarEntry } from "@shared/supplier/logic";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { recordPath } from "../../records/extensions";
import { Money } from "../itam/parts";
import { supplierApi, SUPPLIER_KEYS } from "./api";

const TONE: Record<CalendarEntry["kind"], "warning" | "danger" | "neutral" | "in" | "accent"> = {
  notice: "danger", end: "warning", renewal: "accent", warranty: "neutral", lease: "neutral", entitlement: "warning", obligation: "neutral",
};

function Entry({ e }: { e: CalendarEntry }) {
  const { orgId } = useOrg();
  return (
    <div className="itam-entry">
      <span className="ds-num text-ink-3">{formatJalali(e.date).slice(5)}</span>
      <Link className="ds-link" to={`/${orgId}/${recordPath(e.table, e.id)}`} title={e.title}>
        {e.number ? <span className="ltr ds-num">{e.number}</span> : null} {e.title}
      </Link>
      <span className="flex items-center gap-2">
        <Chip tone={TONE[e.kind]}>{ENTRY_LABELS[e.kind]}</Chip>
        {e.amount ? <Money v={e.amount} /> : null}
      </span>
    </div>
  );
}

export default function Renewals() {
  const { api, orgId } = useOrg();
  const [months, setMonths] = useState(12);
  const q = useQuery({ queryKey: SUPPLIER_KEYS.renewals(orgId, months), queryFn: () => supplierApi.renewals(api, months) });
  const d = q.data;
  const total = d ? d.months.reduce((n, m) => n + m.entries.length, 0) : 0;
  return (
    <div>
      <PageHeader title="تقویم تمدید" actions={<Segmented value={months} onChange={(v) => setMonths(Number(v))} options={[{ value: 3, label: "۳ ماه" }, { value: 6, label: "۶ ماه" }, { value: 12, label: "۱۲ ماه" }]} />} />
      {q.isLoading ? (
        <Loader />
      ) : !d || (!total && !d.overdue.length) ? (
        <EmptyState title="موعدی در این بازه نیست" description="پایان قراردادها، مهلت‌های اعلام، تمدید اشتراک‌ها و پایان مجوزها و ضمانت‌ها این‌جا می‌آیند." icon={CalendarRange} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles">
            <StatCard title="مهلت اعلام تا ۳۰ روز" value={fa(d.counts.notice_30)} />
            <StatCard title="پایان یا تمدید تا ۹۰ روز" value={fa(d.counts.end_90)} />
            <StatCard title="تمدید خودکار" value={fa(d.counts.auto)} />
            {d.counts.value_90 !== null ? <StatCard title="ارزش رو به تمدید (۹۰ روز)" value={<Money v={d.counts.value_90} />} /> : null}
          </div>
          {d.overdue.length ? (
            <Card title="گذشته از موعد">
              <div className="itam-month">{d.overdue.map((e) => <Entry key={`${e.table}-${e.id}-${e.kind}`} e={e} />)}</div>
            </Card>
          ) : null}
          <div className="itam-two">
            {d.months.map((m) => (
              <Card key={m.key} title={m.label} meta={m.entries.length ? <span className="ds-num">{fa(m.entries.length)}</span> : undefined}>
                {m.entries.length ? <div className="itam-month">{m.entries.map((e) => <Entry key={`${e.table}-${e.id}-${e.kind}`} e={e} />)}</div> : <div className="text-ink-3 text-[13px]">موعدی نیست</div>}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
