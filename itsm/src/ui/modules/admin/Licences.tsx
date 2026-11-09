// «مجوزها و صندلی‌ها»: the seats the organisation bought (licence pools) against the seats its members use —
// administrators, agents, occasional users (auditors, viewers) and service accounts of the integration hub — with
// the members who have not signed in for thirty days (seats to reclaim).
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Table } from "antd";
import { Plus } from "lucide-react";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, JDateTime, Skeleton, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";

type Seat = "admin" | "agent" | "occasional" | "integration";

interface Data {
  pools: Record<string, any>[];
  summary: { kind: Seat; quantity: number; used: number; idle: number; over: boolean; warning: boolean }[];
  people: { user_id: string; name: string; email: string; seat: Seat; roles: string[]; last_login_at: string | null; idle: boolean }[];
}

const SEAT: Record<Seat, string> = { admin: "مدیر", agent: "کارشناس", occasional: "کاربر گاه‌به‌گاه", integration: "یکپارچه‌سازی" };

export default function Licences() {
  const { api, orgId, can } = useOrg();
  const q = useQuery({ queryKey: ["admin", "licences"], queryFn: () => api.get<Data>("/admin/licences") });
  const [filter, setFilter] = useState<"all" | "idle" | Seat>("all");
  const d = q.data;
  const people = (d?.people ?? []).filter((p) => filter === "all" || (filter === "idle" ? p.idle : p.seat === filter));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="مجوزها و صندلی‌ها"
        actions={
          can("settings", "edit") ? (
            <Link to={`/${orgId}/settings/licence-pools/new`}>
              <Button icon={<Plus {...ICON} />}>مجوز تازه</Button>
            </Link>
          ) : undefined
        }
        extra={<Link to={`/${orgId}/settings/licence-pools`}>همهٔ مجوزها</Link>}
      />
      {!d ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="صندلی‌ها">
            {d.summary.map((s) => (
              <StatCard
                key={s.kind}
                title={SEAT[s.kind]}
                value={
                  <span className="ds-num">
                    {fa(s.used)}
                    {s.quantity ? ` از ${fa(s.quantity)}` : ""}
                  </span>
                }
                tone={s.over ? "bad" : s.warning ? "brand" : "muted"}
                hint={s.over ? "بیش از مجوز" : s.idle ? `${fa(s.idle)} نفر ۳۰ روز وارد نشده‌اند` : s.quantity ? undefined : "مجوزی ثبت نشده"}
              />
            ))}
          </section>
          <Card
            title="اعضا و صندلی‌ها"
            tools={
              <Segmented
                size="small"
                value={filter}
                onChange={(v) => setFilter(v as typeof filter)}
                options={[{ value: "all", label: "همه" }, { value: "idle", label: "بیکار" }, ...(Object.keys(SEAT) as Seat[]).map((k) => ({ value: k, label: SEAT[k] }))]}
              />
            }
            flush
          >
            <Table
              size="small"
              rowKey="user_id"
              dataSource={people}
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
              scroll={{ x: true }}
              columns={[
                { title: "عضو", dataIndex: "name", render: (v: string, r) => <span className="flex flex-col"><span>{v}</span><span className="ltr text-[12px] text-ink-3">{r.email}</span></span> },
                { title: "صندلی", dataIndex: "seat", render: (v: Seat) => SEAT[v] },
                { title: "نقش‌ها", dataIndex: "roles", render: (v: string[]) => (v.length ? <span className="text-[12px] text-ink-2">{v.join("، ")}</span> : <span className="text-ink-3">—</span>) },
                { title: "آخرین ورود", dataIndex: "last_login_at", render: (v: string | null, r) => (r.seat === "integration" ? <span className="text-ink-3">—</span> : <span className="flex items-center gap-2"><JDateTime v={v} />{r.idle ? <Chip tone="warning">بیکار</Chip> : null}</span>) },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
