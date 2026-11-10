// «برنامهٔ تیم» (WFM-015/018/043): the team's people × days — each day's shift code and hours from the person's roster
// (the pattern's working calendar, holidays included), time off («غایب» for teammates; its type for the person and the
// team's overseers), the coverage of each day against the team's minimum staff, and labour-rule findings for those who
// plan the rosters. Also the team's presence now.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Select, Space } from "antd";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { addDays, formatJalali, toFa, todayISO } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";
import { newRecordPath } from "../../records";
import { recordsApi } from "../../records/data/api";
import { useNavigate } from "react-router";
import { WFM_KEYS, wfmApi } from "./api";
import { PRESENCE_TONE, presenceLabel } from "./model";
import "./workforce.css";

export function useMyTeams() {
  const { api, orgId } = useOrg();
  const meta = useQuery({ queryKey: WFM_KEYS.meta(orgId), queryFn: () => wfmApi.meta(api) });
  const ids = useMemo(() => [...new Set([...(meta.data?.my_groups ?? []), ...(meta.data?.oversees.groups ?? [])])], [meta.data]);
  const groups = useQuery({
    queryKey: WFM_KEYS.groups(orgId, ids),
    queryFn: () => recordsApi.list(api, "group", ids.length ? { ids, fields: ["name"], size: 100, total: false, sort: "name" } : { filter: { f: "types", op: "contains", v: "assignment" }, fields: ["name"], size: 100, total: false, sort: "name" }),
    enabled: !!meta.data && (ids.length > 0 || meta.data.oversees.all),
  });
  return { meta: meta.data, loading: meta.isLoading || groups.isLoading, groups: (groups.data?.rows ?? []).map((g) => ({ id: String(g.id), name: String(g.name ?? "") })) };
}

export default function TeamBoard() {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const { groups, loading, meta } = useMyTeams();
  const [group, setGroup] = useState<string | null>(null);
  const [from, setFrom] = useState(todayISO(timezone));
  const [days, setDays] = useState(14);
  useEffect(() => {
    if (!group && groups.length) setGroup(groups[0].id);
  }, [groups, group]);
  const q = useQuery({ queryKey: WFM_KEYS.board(orgId, group ?? "", from, days), queryFn: () => wfmApi.board(api, group!, from, days), enabled: !!group });
  const presence = useQuery({ queryKey: ["workforce", orgId, "presence", group], queryFn: () => api.get<{ people: { user_id: string; name: string; presence: string; note: string | null }[] }>(`/workforce/teams/${group}/presence`), enabled: !!group, refetchInterval: 60_000 });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="برنامهٔ تیم"
        actions={
          <Space wrap>
            <Select aria-label="تیم" value={group} onChange={setGroup} style={{ minInlineSize: 200 }} options={groups.map((g) => ({ value: g.id, label: g.name }))} placeholder="تیم" />
            <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 7, label: "هفته" }, { value: 14, label: "دو هفته" }, { value: 28, label: "چهار هفته" }]} />
            <Button aria-label="دورهٔ پیش" icon={<ChevronRight {...ICON} />} onClick={() => setFrom(addDays(from, -days))} />
            <Button onClick={() => setFrom(todayISO(timezone))}>امروز</Button>
            <Button aria-label="دورهٔ بعد" icon={<ChevronLeft {...ICON} />} onClick={() => setFrom(addDays(from, days))} />
            {d?.can_manage ? <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav(`/${orgId}/${newRecordPath("wfm_roster")}?group_id=${group}`)}>برنامهٔ شیفت</Button> : null}
          </Space>
        }
      />
      {loading ? <Loader /> : !groups.length ? <EmptyState title="عضو تیمی نیستید" description={meta?.manages ? undefined : "برنامهٔ تیم برای اعضای گروه‌ها نشان داده می‌شود."} /> : !d ? <Loader /> : (
        <>
          {d.issues.length ? <Note tone="warning">{toFa(d.issues.length)} یافتهٔ قواعد کار: {d.issues.slice(0, 3).map((i) => i.detail).join("؛ ")}{d.issues.length > 3 ? " …" : ""}</Note> : null}
          <div className="overflow-x-auto">
            <table className="wfm-board" aria-label={`برنامهٔ ${d.group.name}`}>
              <thead>
                <tr>
                  <th scope="col" className="text-start">فرد</th>
                  {d.days.map((x) => (
                    <th key={x.date} scope="col" className={x.holiday ? "is-holiday" : undefined} title={x.holiday ?? undefined}>
                      <span>{x.weekday}</span>
                      <span className="ds-num">{formatJalali(x.date, { style: "short" }).split("/").slice(1).join("/")}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.user_id} className={p.me ? "is-me" : undefined}>
                    <th scope="row" className="text-start">{p.name}</th>
                    {p.cells.map((c) => (
                      <td key={c.date} data-color={c.absent ? "off" : c.color ?? undefined} title={c.absence ?? (c.hours ? `${toFa(c.hours)} ساعت` : undefined)}>
                        {c.absent ? <span className="wfm-off">{c.absence === "غایب" ? "غ" : "م"}</span> : c.code && c.hours ? <span>{c.code}</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="wfm-coverage">
                  <th scope="row" className="text-start">نیرو در شیفت</th>
                  {d.coverage.map((c) => <td key={c.date} data-gap={c.gap ? "1" : undefined} title={c.gap ? `کمتر از کمینهٔ ${toFa(c.min)} نفر` : undefined}><span className="ds-num">{toFa(c.staff)}</span></td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-ink-3">«غ» غایب، «م» مرخصی؛ ستون‌های رنگی تعطیلات رسمی‌اند؛ خانهٔ قرمز ردیف آخر یعنی کمتر از کمینهٔ نیروی تیم.</p>
          <Card title="حضور اکنون">
            <div className="flex flex-wrap gap-2">
              {(presence.data?.people ?? []).map((p) => <Chip key={p.user_id} tone={PRESENCE_TONE[p.presence] ?? "neutral"} title={p.note ?? undefined}>{p.name}: {presenceLabel(p.presence)}</Chip>)}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
