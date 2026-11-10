// «ظرفیت تیم‌ها» (WFM-013/019/020/022): the heatmap of teams × days — the forecast of each team's incoming work (weekday
// seasonality, the recent level, official holidays) against the capacity of its people on shift (staff × daily
// throughput), coloured by utilisation (بیش از ظرفیت > ۸۴٪، زیاد ۶۰–۸۴٪، مناسب، کم‌کار), with the agents the forecast needs;
// next to it each team's open work against its people's limits now, and — for those who oversee the team — each
// person's load.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Space, Tooltip } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, formatJalali, toFa, todayISO, WEEKDAYS_SHORT } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card, ICON } from "../../components/blocks";
import { WFM_KEYS, wfmApi, type HeatRow } from "./api";
import { heatTone, UTIL_TONE, utilLabel } from "./model";
import "./workforce.css";

function cellTitle(c: HeatRow["cells"][number]): string {
  if (c.holiday) return "تعطیل رسمی";
  return [
    `پیش‌بینی ${toFa(c.forecast)} کار (${toFa(c.lower)} تا ${toFa(c.upper)})`,
    `${toFa(c.staff)} نفر در شیفت، ظرفیت ${toFa(c.capacity)} کار`,
    c.utilisation === null ? "" : `بهره‌وری ${toFa(c.utilisation)}٪`,
    `نیروی لازم ${toFa(c.required)} نفر`,
  ].filter(Boolean).join(" — ");
}

export default function Capacity() {
  const { api, orgId, timezone } = useOrg();
  const [from, setFrom] = useState(todayISO(timezone));
  const [days, setDays] = useState(14);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: WFM_KEYS.capacity(orgId, from, days), queryFn: () => wfmApi.capacity(api, from, days) });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ظرفیت تیم‌ها"
        actions={
          <Space wrap>
            <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 7, label: "هفته" }, { value: 14, label: "دو هفته" }, { value: 28, label: "چهار هفته" }]} />
            <Button aria-label="دورهٔ پیش" icon={<ChevronRight {...ICON} />} onClick={() => setFrom(addDays(from, -days))} />
            <Button onClick={() => setFrom(todayISO(timezone))}>امروز</Button>
            <Button aria-label="دورهٔ بعد" icon={<ChevronLeft {...ICON} />} onClick={() => setFrom(addDays(from, days))} />
          </Space>
        }
      />
      {q.isLoading ? <Loader /> : !d || !d.rows.length ? <EmptyState title="تیمی برای نمایش نیست" description="ظرفیت تیم‌هایی که عضو یا سرپرست آن‌ها هستید نشان داده می‌شود." /> : (
        <>
          <div className="overflow-x-auto">
            <table className="wfm-heat" aria-label="پیش‌بینی کار در برابر ظرفیت هر تیم در هر روز">
              <thead>
                <tr>
                  <th scope="col" className="text-start">تیم</th>
                  <th scope="col">بار اکنون</th>
                  {d.days.map((x) => (
                    <th key={x.date} scope="col" className={x.holiday ? "is-holiday" : undefined} title={x.holiday ?? undefined}>
                      <span>{WEEKDAYS_SHORT[x.weekday]}</span>
                      <span className="ds-num">{formatJalali(x.date, { style: "short" }).split("/").slice(1).join("/")}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.group_id}>
                    <th scope="row" className="text-start">
                      <button type="button" className="ds-link" onClick={() => setOpen(open === r.group_id ? null : r.group_id)} aria-expanded={open === r.group_id}>{r.name}</button>
                      <div className="text-[11px] text-ink-3">{toFa(r.members)} نفر · {toFa(r.throughput)} کار در روز برای هر نفر</div>
                    </th>
                    <td><Chip tone={UTIL_TONE[r.load_band]} fig title={`${toFa(r.open)} کار باز، ${toFa(r.unassigned)} بی‌کارشناس`}>{r.load_pct === null ? "—" : `${toFa(Math.round(r.load_pct))}٪`}</Chip></td>
                    {r.cells.map((c) => (
                      <td key={c.date} data-tone={heatTone(c)}>
                        <Tooltip title={cellTitle(c)}>
                          <span className="ds-num">{c.holiday ? "" : c.utilisation === null ? "" : `${toFa(Math.min(999, Math.round(c.utilisation)))}`}</span>
                        </Tooltip>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {(["idle", "optimal", "high", "overloaded"] as const).map((b) => <Chip key={b} tone={UTIL_TONE[b]}>{utilLabel(b)}</Chip>)}
            <span className="text-ink-3">عدد هر خانه: کار پیش‌بینی‌شده ÷ ظرفیت نیروی در شیفت (درصد).</span>
          </div>
          {open ? (() => {
            const r = d.rows.find((x) => x.group_id === open)!;
            return (
              <Card title={`افراد ${r.name}`} meta={r.mape !== null ? `خطای پیش‌بینی هفتهٔ گذشته: ${toFa(r.mape)}٪` : undefined}>
                {r.people === null ? <p className="text-[13px] text-ink-3">بار تک‌تک افراد فقط برای سرپرست تیم نشان داده می‌شود.</p> : (
                  <table className="wfm-people">
                    <thead><tr><th scope="col" className="text-start">فرد</th><th scope="col">کار باز</th><th scope="col">سقف</th><th scope="col">بار</th></tr></thead>
                    <tbody>
                      {r.people.map((p) => (
                        <tr key={p.user_id}>
                          <th scope="row" className="text-start font-normal">{p.name}</th>
                          <td className="ds-num">{toFa(p.open)}</td>
                          <td className="ds-num">{toFa(p.limit)}</td>
                          <td><Chip tone={UTIL_TONE[p.band]} fig>{p.pct === null ? "—" : `${toFa(Math.round(p.pct))}٪`}</Chip></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            );
          })() : null}
        </>
      )}
    </div>
  );
}
