// «نقش‌های سازمانی» (design F §3.4, §8, package F5): posts such as «رئیس شعبه» and who holds them in which unit. The list
// shows each position with its current holders, the units they cover, vacant units of its kind, holders ending within
// 30 days and where holders come from (by hand, Active Directory, a file); a row opens the position's side sheet with
// its holders. «نقش تازه» and «ورود دارندگان» are for keepers of the organisation structure (`org` write in a unit or
// wider), «پیش‌نمایش انجام‌دهنده» for them and workflow designers. The sheet and the dialogs are kept in the address
// (`?position=`, `?dialog=import|preview`).
import { useCallback, useState } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import { useSearchParams } from "react-router";
import { Button, Input, Table } from "antd";
import { FileUp, Plus, Search, UserSearch } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { PageHeader } from "../../../../components/layout";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { ToggleChip } from "../../../../components/inputs";
import { POSITION_KEYS, positionsApi, type PositionOverview } from "./api";
import { POSITION_CHIPS, filterPositions, holdersText, positionsAccess, sourcesText, unitKindLabel, type PositionChip } from "./model";
import { PositionSheet } from "./PositionSheet";
import { DemoTag } from "../../kit/demo";
import "../../../../records/records.css";
import "../fields/fields.css";
import "./positions.css";

const HolderImport = lazy(() => import("./HolderImport"));
const ResolvePreview = lazy(() => import("./ResolvePreview"));

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function PositionsPage() {
  const org = useOrg();
  const { api, orgId } = org;
  const access = positionsAccess(org);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [chips, setChips] = useState<PositionChip[]>([]);
  const overview = useQuery({ queryKey: POSITION_KEYS.overview(orgId), queryFn: () => positionsApi.overview(api), enabled: access.read, staleTime: 30_000 });
  const rows = overview.data?.positions;
  const shown = filterPositions(rows ?? [], q, chips);
  const patch = useCallback(
    (set: Record<string, string | null>) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [k, v] of Object.entries(set)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const open = params.get("position");
  const dialog = params.get("dialog");
  const status = (overview.error as { status?: number } | null)?.status;

  if (!access.read || status === 403) return <EmptyState title="به نقش‌های سازمانی دسترسی ندارید" description="دیدن و نگه‌داری آن‌ها با ساختار سازمانی است." />;
  return (
    <div className="rk-admin wfp-page">
      <PageHeader
        title="نقش‌های سازمانی"
        subtitle={rows ? `${faDigits(rows.length)} نقش` : undefined}
        actions={
          <>
            {access.preview ? (
              <Button icon={<UserSearch {...I16} />} onClick={() => patch({ dialog: "preview" })}>
                پیش‌نمایش انجام‌دهنده
              </Button>
            ) : null}
            {access.manage ? (
              <Button icon={<FileUp {...I16} />} onClick={() => patch({ dialog: "import" })}>
                ورود دارندگان
              </Button>
            ) : null}
            {access.manage ? (
              <Button type="primary" icon={<Plus {...I16} />} onClick={() => patch({ position: "new" })}>
                نقش تازه
              </Button>
            ) : null}
          </>
        }
      />
      {overview.isLoading ? (
        <Loader />
      ) : overview.isError ? (
        <EmptyState title="نقش‌های سازمانی بار نشد" description="دوباره تلاش کنید." action={<Button onClick={() => overview.refetch()}>تلاش دوباره</Button>} />
      ) : !rows?.length ? (
        <EmptyState
          title="هنوز نقش سازمانی‌ای تعریف نشده است"
          description="نقشی مانند «رئیس شعبه» بسازید و دارندگانش را در هر واحد تعیین کنید؛ مرحله‌های گردش‌کار با آن به افراد می‌رسند."
          action={access.manage ? <Button type="primary" icon={<Plus {...I16} />} onClick={() => patch({ position: "new" })}>نقش تازه</Button> : undefined}
        />
      ) : (
        <div className="wff-tab">
          <div className="wff-bar" role="search">
            <Input allowClear prefix={<Search {...I14} aria-hidden />} placeholder="جست‌وجوی نام یا کلید…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی نقش‌ها" className="wff-search" />
            <span className="wff-chips">
              {POSITION_CHIPS.map((c) => (
                <ToggleChip key={c.key} on={chips.includes(c.key)} onChange={(on) => setChips((x) => (on ? [...x, c.key] : x.filter((k) => k !== c.key)))}>
                  {c.label}
                </ToggleChip>
              ))}
            </span>
          </div>
          <Table<PositionOverview>
            size="small"
            className="ds-table"
            rowKey="id"
            dataSource={shown}
            pagination={shown.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
            scroll={{ x: 760 }}
            locale={{ emptyText: <EmptyState compact title="نقشی با این پالایه نیست" /> }}
            onRow={(r) => ({ onClick: () => patch({ position: r.id }), onKeyDown: (e) => e.key === "Enter" && patch({ position: r.id }), tabIndex: 0, className: "cursor-pointer" })}
            columns={[
              {
                key: "name",
                title: "نقش",
                render: (_: unknown, r) => (
                  <span className="wff-cell-2">
                    <span className="text-ink">
                      {r.name}
                      {r.demo ? <DemoTag title="نقش سازمانی دادهٔ نمایشی" /> : null}
                    </span>
                    <bdi dir="ltr" className="ds-mono rk-hint">
                      {r.key}
                    </bdi>
                  </span>
                ),
              },
              { key: "kind", title: "در واحدهای", render: (_: unknown, r) => unitKindLabel(r.unit_kind) || <span className="text-ink-3">همه‌جا</span> },
              { key: "holders", title: "دارندگان", render: (_: unknown, r) => <span className={r.holders ? "" : "text-ink-3"}>{holdersText(r)}</span> },
              {
                key: "vacant",
                title: "جای خالی",
                align: "end",
                render: (_: unknown, r) => (r.vacancies === null ? <span className="text-ink-3">—</span> : r.vacancies ? <Chip tone="warning" fig>{faDigits(r.vacancies)}</Chip> : <span className="ds-num">{faDigits(0)}</span>),
              },
              { key: "source", title: "منبع", render: (_: unknown, r) => sourcesText(r.sources) || <span className="text-ink-3">—</span> },
              { key: "ending", title: "پایان نزدیک", align: "end", render: (_: unknown, r) => (r.ending ? <Chip tone="warning" fig>{faDigits(r.ending)}</Chip> : <span className="text-ink-3">—</span>) },
              { key: "active", title: "وضعیت", render: (_: unknown, r) => (r.active ? <Chip tone="in">فعال</Chip> : <Chip dot={false}>غیرفعال</Chip>) },
            ]}
          />
        </div>
      )}
      {open ? <PositionSheet key={open} id={open === "new" ? null : open} overview={rows?.find((r) => r.id === open) ?? null} access={access} today={overview.data?.today ?? null} onClose={() => patch({ position: null })} onSaved={(id) => patch({ position: id })} onPreview={(id) => patch({ dialog: "preview", for: id })} /> : null}
      <Suspense fallback={null}>
        {dialog === "import" && access.manage ? <HolderImport onClose={() => patch({ dialog: null })} /> : null}
        {dialog === "preview" && access.preview ? <ResolvePreview positions={rows ?? []} initial={params.get("for")} onClose={() => patch({ dialog: null, for: null })} /> : null}
      </Suspense>
    </div>
  );
}
