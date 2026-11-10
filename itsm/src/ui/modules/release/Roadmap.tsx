// «نقشهٔ راه انتشار» (REL-008): the releases the person may read as bars on the record kit's timeline — the release
// windows of the train and the release freezes behind them as bands, the change module's freezes and blackouts too,
// Fridays and holidays shaded — with a range of one, three or six months, navigation, and filters by type. Releases
// that need attention (overdue, high risk, rolled back) are outlined. Clicking a release opens it.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Select, Space } from "antd";
import { ChevronRight, ChevronLeft, Plus, RotateCw } from "lucide-react";
import { RELEASE_TYPES } from "@shared/tables/release";
import { addDays, todayISO } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { UNSCHEDULED_RELEASES } from "@shared/release/logic";
import type { Cond } from "@shared/model/conditions";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { ICON } from "../../components/blocks";
import { recordPath, newRecordPath } from "../../records";
import { TimelineGrid } from "../../records/board/TimelineGrid";
import { getHolidaySource, type Holiday } from "../../records/extensions";
import { windowRange } from "../../records/model/calendar";
import { encodeFilter } from "../../records/model/filter";
import { RELEASE_KEYS, releaseApi } from "./api";
import { roadmapItems } from "./model";
import "../../records/records.css";

const SPANS = [
  { value: 30, label: "یک ماه" },
  { value: 90, label: "سه ماه" },
  { value: 180, label: "شش ماه" },
];

export default function Roadmap() {
  const { api, orgId, timezone, allows } = useOrg();
  const nav = useNavigate();
  const today = todayISO(timezone);
  const [days, setDays] = useState(90);
  const [from, setFrom] = useState(() => addDays(today, -14));
  const [type, setType] = useState<string | undefined>();
  const range = windowRange(from, days, timezone);
  const q = { from: new Date(range.start).toISOString(), to: new Date(range.end).toISOString(), ...(type ? { type } : {}) };
  const data = useQuery({ queryKey: RELEASE_KEYS.roadmap(orgId, q), queryFn: () => releaseApi.roadmap(api, q) });
  const holidays = useQuery({
    queryKey: ["release", orgId, "holidays", from, days],
    queryFn: async (): Promise<Holiday[]> => {
      const src = getHolidaySource();
      return src ? src(api, from, addDays(from, days)) : [];
    },
  });
  const items = useMemo(() => roadmapItems(data.data?.releases ?? []), [data.data]);
  const canCreate = allows({ area: "release", op: "create" });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="نقشهٔ راه انتشار"
        actions={
          <Space wrap>
            <Select allowClear placeholder="همهٔ نوع‌ها" value={type} onChange={setType} style={{ minWidth: 140 }} options={RELEASE_TYPES.map((t) => ({ value: t.value, label: t.label }))} aria-label="نوع انتشار" />
            <Segmented value={days} onChange={(v) => setDays(Number(v))} options={SPANS} aria-label="بازه" />
            <Button icon={<ChevronRight {...ICON} />} onClick={() => setFrom(addDays(from, -Math.round(days / 2)))} aria-label="پیش‌تر" />
            <Button onClick={() => setFrom(addDays(today, -14))}>امروز</Button>
            <Button icon={<ChevronLeft {...ICON} />} onClick={() => setFrom(addDays(from, Math.round(days / 2)))} aria-label="پس‌تر" />
            {canCreate ? (
              <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav(`/${orgId}/${newRecordPath("release")}`)}>
                انتشار تازه
              </Button>
            ) : null}
          </Space>
        }
      />
      {data.isLoading ? (
        <Loader />
      ) : !data.data ? (
        <EmptyState
          title="نقشهٔ راه بارگذاری نشد"
          description={data.error ? errorText(data.error) : undefined}
          action={<Button icon={<RotateCw {...ICON} />} onClick={() => data.refetch()}>تلاش دوباره</Button>}
        />
      ) : (
        <>
          <TimelineGrid
            from={from}
            days={days}
            tz={timezone}
            today={today}
            holidays={holidays.data ?? []}
            bands={data.data.bands}
            items={items}
            onOpen={(id) => nav(`/${orgId}/${recordPath("release", id)}`)}
            busy={data.isFetching}
            empty={<EmptyState title="در این بازه انتشاری برنامه‌ریزی نشده است" />}
          />
          {data.data.unscheduled ? (
            // a release without a planned release date has no bar: say so, or the roadmap looks broken
            <p className="text-[13px] text-ink-2">
              <Link className="ds-link" to={`/${orgId}/releases?filter=${encodeURIComponent(encodeFilter(UNSCHEDULED_RELEASES as unknown as Cond))}`}>
                {faDigits(data.data.unscheduled)} انتشار باز
              </Link>{" "}
              تاریخ عرضهٔ برنامه‌ریزی‌شده ندارد و در نقشهٔ راه دیده نمی‌شود.
            </p>
          ) : null}
          <ul className="flex flex-wrap gap-4 text-[12px] text-ink-3" aria-label="راهنمای نوارها">
            <li className="flex items-center gap-1.5"><i className="rk-sw" data-k="maintenance" aria-hidden />پنجرهٔ انتشار</li>
            <li className="flex items-center gap-1.5"><i className="rk-sw" data-k="freeze" aria-hidden />توقف انتشار یا انجماد تغییرات</li>
            <li className="flex items-center gap-1.5"><i className="rk-sw" data-k="blackout" aria-hidden />ممنوعیت تغییر</li>
          </ul>
        </>
      )}
    </div>
  );
}
