// «رزرو فضا» (ESM-031…034): the bookable spaces of a day with their busy hours (one's own bookings marked), filtered
// by kind and size; a free half-hour opens the booking form (title, length, attendees). The server holds a space only
// for confirmed bookings, refuses overlaps and booking windows, and sends spaces that need approval for approval.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, InputNumber, Input, Modal, Segmented, Select } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, formatJalali, todayISO, toFa } from "@shared/jalali";
import { SPACE_KINDS } from "@shared/tables/esm";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { ICON, cx } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { recordsApi } from "../../records";
import { clock, instantOf } from "../field_service/model";
import { ESM_KEYS, esmApi } from "./api";
import { freeSlots } from "./model";
import "./esm.css";

const OPEN_HOUR = "08:00";
const CLOSE_HOUR = "18:00";

export default function Booking() {
  const { api, orgId, timezone } = useOrg();
  const qc = useQueryClient();
  const [day, setDay] = useState<string>(todayISO(timezone));
  const [kind, setKind] = useState<string | null>("meeting_room");
  const [size, setSize] = useState<number | null>(null);
  const [pick, setPick] = useState<{ space: Record<string, any>; start: number } | null>(null);
  const [title, setTitle] = useState("");
  const [length, setLength] = useState(60);
  const [people, setPeople] = useState<number | null>(null);
  const from = instantOf(day, OPEN_HOUR, timezone) ?? `${day}T04:30:00.000Z`;
  const to = instantOf(day, CLOSE_HOUR, timezone) ?? `${day}T14:30:00.000Z`;
  const q = useQuery({ queryKey: [...ESM_KEYS.availability(orgId, from, kind), size], queryFn: () => esmApi.availability(api, { from, to, kind, capacity: size }) });
  const book = useAction(
    () => {
      const s = pick!;
      return recordsApi.create(api, "reservation", { space_id: s.space.id, start_at: new Date(s.start).toISOString(), end_at: new Date(s.start + length * 60_000).toISOString(), title: title.trim() || "جلسه", attendees: people ?? undefined });
    },
    {
      success: (r) => (r.row.state === "requested" ? "درخواست رزرو ثبت شد و منتظر تأیید است" : "رزرو ثبت شد"),
      onSuccess: () => {
        setPick(null);
        setTitle("");
        qc.invalidateQueries({ queryKey: ["esm", orgId, "availability"] });
      },
    },
  );
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const hours: number[] = [];
  for (let t = fromMs; t < toMs; t += 30 * 60_000) hours.push(t);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="رزرو فضا"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button aria-label="روز پیش" icon={<ChevronRight {...ICON} />} onClick={() => setDay(addDays(day, -1))} />
            <DateInput value={day} onChange={(v: string | null) => v && setDay(v)} aria-label="روز" />
            <Button aria-label="روز بعد" icon={<ChevronLeft {...ICON} />} onClick={() => setDay(addDays(day, 1))} />
            <Select value={kind ?? ""} onChange={(v) => setKind(v || null)} options={[{ value: "", label: "همهٔ فضاها" }, ...SPACE_KINDS.map((k) => ({ value: k.value, label: k.label }))]} className="min-w-[9rem]" aria-label="نوع فضا" />
            <InputNumber min={1} max={500} value={size} onChange={(v) => setSize(v ? Number(v) : null)} placeholder="ظرفیت" aria-label="کمترین ظرفیت" />
          </div>
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !q.data?.spaces.length ? (
        <EmptyState title="فضای رزروپذیری با این ویژگی‌ها نیست" />
      ) : (
        <div className="esm-book" style={{ ["--esm-cols" as string]: hours.length }}>
          <div className="esm-book-row esm-book-head">
            <span />
            {hours.map((h, i) => <span key={h} className="text-[11px] text-ink-3">{i % 2 === 0 ? clock(h, timezone) : ""}</span>)}
          </div>
          {q.data.spaces.map((s) => {
            const free = new Set(freeSlots(s.busy, fromMs, toMs).map((x) => x.start));
            return (
              <div key={s.id} className="esm-book-row">
                <span className="truncate text-[13px]" title={s.name}>{s.name} <span className="text-[11px] text-ink-3">({toFa(s.capacity ?? 0)} نفر)</span></span>
                {hours.map((h) => {
                  const mine = s.busy.some((b) => b.mine && Date.parse(b.start) < h + 30 * 60_000 && h < Date.parse(b.end));
                  const isFree = free.has(h) && h > Date.now();
                  return (
                    <button
                      key={h}
                      type="button"
                      className={cx("esm-slot", isFree ? "is-free" : mine ? "is-mine" : "is-busy")}
                      disabled={!isFree}
                      onClick={() => setPick({ space: s, start: h })}
                      aria-label={`${s.name} ${clock(h, timezone)} ${isFree ? "آزاد" : mine ? "رزرو شما" : "رزروشده"}`}
                    />
                  );
                })}
              </div>
            );
          })}
          <p className="mt-2 text-[12px] text-ink-3">خانه‌های روشن آزادند؛ خانه‌های پررنگ رزرو شما و خانه‌های خاکستری رزرو دیگران است. {formatJalali(day, { style: "long" })}</p>
        </div>
      )}
      <Modal open={!!pick} title={pick ? `رزرو ${pick.space.name} از ${clock(pick.start, timezone)}` : ""} okText="رزرو" cancelText="انصراف" onCancel={() => setPick(null)} onOk={() => book.mutate(undefined)} okButtonProps={{ loading: book.isPending }} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان جلسه" maxLength={160} aria-label="عنوان" />
          <Segmented value={length} onChange={(v) => setLength(Number(v))} options={[30, 60, 90, 120].map((m) => ({ value: m, label: `${toFa(m)} دقیقه` }))} aria-label="مدت" />
          <InputNumber min={1} max={500} value={people} onChange={(v) => setPeople(v ? Number(v) : null)} placeholder="شمار شرکت‌کنندگان" aria-label="شمار شرکت‌کنندگان" />
          {pick?.space.requires_approval ? <p className="text-[12px] text-ink-3">این فضا پس از تأیید مسئول آن رزرو می‌شود.</p> : null}
        </div>
      </Modal>
    </div>
  );
}
