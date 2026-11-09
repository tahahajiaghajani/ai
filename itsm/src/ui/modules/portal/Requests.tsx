// «درخواست‌های من» (PTL-012, PTL-013): everything the person asked for or reported, in every department, in one list —
// theirs, those shared with them (they watch them) and, for managers, their people's («تیم من»); open, closed or all,
// with a filter box and pages. The records the server lists are only those the person may read.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Input, Pagination, Segmented, Skeleton } from "antd";
import { FolderOpen, PenLine } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { usePortalItems, type PortalConfig } from "./api";
import { portalPath } from "./model";
import { Empty, I16, PageHead, TicketRow } from "./parts";

type Tab = "mine" | "shared" | "team";
type State = "open" | "closed" | "all";

export default function Requests({ cfg }: { cfg: PortalConfig }) {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = (["mine", "shared", "team"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "mine") as Tab;
  const state = (["open", "closed", "all"].includes(sp.get("state") ?? "") ? sp.get("state") : "open") as State;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const [text, setText] = useState(sp.get("q") ?? "");
  const q = useDebounced(text.trim(), 300);
  const r = usePortalItems(tab, state, q, page);
  const data = r.data;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };
  const tabs = [
    { value: "mine", label: "مال من" },
    { value: "shared", label: "هم‌رسانی‌شده با من" },
    ...(data?.team ? [{ value: "team", label: "تیم من" }] : []),
  ];
  const emptyTitle = q ? "موردی با این واژه پیدا نشد" : tab === "team" ? "درخواست بازی از افراد تیم شما نیست" : tab === "shared" ? "درخواستی با شما هم‌رسانی نشده است" : state === "open" ? "درخواست بازی ندارید" : "موردی نیست";

  return (
    <>
      <PageHead
        title="درخواست‌های من"
        sub="درخواست‌ها، گزارش‌ها و بازخوردهای شما در همهٔ بخش‌ها"
        actions={
          <>
            {cfg.can.report ? (
              <Button icon={<PenLine {...I16} />} onClick={() => navigate(portalPath(orgId, "report"))}>
                گزارش مشکل
              </Button>
            ) : null}
            {cfg.can.order ? (
              <Button type="primary" icon={<FolderOpen {...I16} />} onClick={() => navigate(portalPath(orgId, "catalog"))}>
                درخواست خدمت
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented value={tab} onChange={(v) => set({ tab: v === "mine" ? null : String(v), page: null })} options={tabs} />
        <Segmented
          value={state}
          onChange={(v) => set({ state: v === "open" ? null : String(v), page: null })}
          options={[
            { value: "open", label: "باز" },
            { value: "closed", label: "بسته" },
            { value: "all", label: "همه" },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="جست‌وجو در شماره و عنوان"
          aria-label="جست‌وجو در درخواست‌ها"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (page !== 1) set({ page: null });
          }}
          style={{ maxInlineSize: 320 }}
        />
      </div>
      {r.isLoading ? (
        <div className="pt-card">
          <Skeleton active />
        </div>
      ) : data && data.items.length ? (
        <>
          <div className="pt-card is-flush" aria-busy={r.isFetching}>
            <ul className="pt-list">
              {data.items.map((c) => (
                <li key={`${c.table}:${c.id}`}>
                  <TicketRow card={c} showFor={tab !== "mine" || !!c.for_name} />
                </li>
              ))}
            </ul>
          </div>
          {data.total > data.size ? (
            <div className="mt-4 flex justify-center">
              <Pagination current={page} pageSize={data.size} total={data.total} showSizeChanger={false} onChange={(p) => set({ page: p > 1 ? String(p) : null })} />
            </div>
          ) : null}
        </>
      ) : (
        <Empty
          title={emptyTitle}
          text={tab === "mine" && state === "open" && !q ? "هر وقت چیزی لازم داشتید، از جست‌وجو یا «درخواست خدمت» شروع کنید." : undefined}
          action={tab === "mine" && state === "open" && !q && cfg.can.order ? <Button onClick={() => navigate(portalPath(orgId, "catalog"))}>دیدن خدمت‌ها</Button> : undefined}
        />
      )}
    </>
  );
}
