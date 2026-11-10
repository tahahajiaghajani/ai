// «گزارش‌ها» and «داشبوردها» (catalogue ANA-013/050): the definitions the person may read — their own, those shared
// with them, the certified ones — in folders, with search, the recycle bin (move there, restore), copies, JSON export
// and import. Opening a report opens the designer; a dashboard opens its page.
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Input, Modal, Segmented, Select, Space } from "antd";
import { BadgeCheck, ChartColumn, Copy, FileJson, FolderOpen, LayoutDashboard, MoreHorizontal, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import type { Cond } from "@shared/model/conditions";
import { VIZ } from "@shared/analytics/model";
import type { VizType } from "@shared/analytics/types";
import { formatJalaliDateTime } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useDebounced, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { ICON14, cx } from "../../components/blocks";
import { recordsApi, UserChip, useSchema } from "../../records";
import { DEFINITION_WRITE } from "@shared/tables/analytics";
import { analyticsApi, saveJson } from "./api";
import { definitionActions } from "./model";
import { useAnalyticsMeta, VIZ_ICONS } from "./parts";
import "./analytics.css";

type Kind = "reports" | "dashboards";
const TABLE: Record<Kind, "analytics_report" | "analytics_dashboard"> = { reports: "analytics_report", dashboards: "analytics_dashboard" };

export default function Library({ kind }: { kind: Kind }) {
  const { api, orgId, timezone } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meta = useAnalyticsMeta();
  const { schema } = useSchema();
  const [tab, setTab] = useState<"all" | "mine" | "certified" | "trash">("all");
  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const table = TABLE[kind];
  const filter: Cond = {
    and: [
      { f: "trashed", op: "eq", v: tab === "trash" },
      ...(tab === "mine" ? [{ f: "owner_id", op: "is_me" } as Cond] : []),
      ...(tab === "certified" ? [{ f: "certified", op: "eq", v: true } as Cond] : []),
      ...(folder ? [{ f: "folder", op: "eq", v: folder } as Cond] : []),
    ],
  };
  const key = ["records", orgId, "list", table, tab, folder, q];
  const list = useQuery({
    queryKey: key,
    queryFn: () => recordsApi.list(api, table, { filter, q: q || undefined, size: 200, sort: "name", fields: ["name", "folder", "owner_id", "updated_at", "certified", "status", "description", ...(kind === "reports" ? ["viz", "table_key"] : ["is_home"])], total: true }),
  });
  // the rows of this page the viewer may change (owner or editor): only those offer the recycle bin
  const editable = useQuery({
    queryKey: [...key, "editable"],
    queryFn: () => recordsApi.list(api, table, { filter: { and: [filter, DEFINITION_WRITE] }, q: q || undefined, size: 200, sort: "name", fields: ["name"], total: false }),
  });
  const canEdit = useMemo(() => new Set((editable.data?.rows ?? []).map((r) => String(r.id))), [editable.data]);
  const folders = useQuery({
    queryKey: ["records", orgId, "list", table, "folders"],
    queryFn: () => recordsApi.aggregate(api, table, { filter: { f: "trashed", op: "eq", v: false }, groupBy: ["folder"], limit: 100 }),
  });
  const folderNames = useMemo(() => (folders.data?.rows ?? []).map((g) => g.keys[0]).filter((x): x is string => typeof x === "string" && !!x).sort(), [folders.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["records", orgId, "list", table] });
  const file = useRef<HTMLInputElement>(null);

  const trash = async (row: Record<string, unknown>, to: boolean) => {
    try {
      await recordsApi.update(api, table, String(row.id), { trashed: to }, Number(row.version));
      n.ok(to ? "به سطل بازیافت رفت" : "بازگردانده شد");
      refresh();
    } catch (e) {
      n.error(e);
    }
  };
  const create = () => {
    if (kind === "reports") return navigate(`/${orgId}/analytics/reports/new`);
    let name = "";
    Modal.confirm({
      title: "داشبورد تازه",
      content: <Input autoFocus placeholder="نام داشبورد" maxLength={150} onChange={(e) => (name = e.target.value)} aria-label="نام داشبورد" />,
      okText: "ساختن",
      cancelText: "انصراف",
      onOk: async () => {
        if (!name.trim()) throw new Error("نام لازم است");
        const r = await recordsApi.create(api, "analytics_dashboard", { name: name.trim(), layout: { widgets: [] }, filters: [{ key: "time", kind: "time", label: "بازهٔ زمانی" }], shares: [] });
        navigate(`/${orgId}/analytics/dashboards/${r.row.id}`);
      },
    });
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const bundle = JSON.parse(await f.text());
      const r = await analyticsApi.importBundle(api, bundle, folder);
      n.ok(`${faDigits(r.reports)} گزارش، ${faDigits(r.dashboards)} داشبورد و ${faDigits(r.indicators)} شاخص افزوده شد`);
      if (r.skipped.length) Modal.warning({ title: "بخشی وارد نشد", content: <ul className="an-list">{r.skipped.map((s) => <li key={s}>{s}</li>)}</ul> });
      refresh();
    } catch (e) {
      n.error(e instanceof SyntaxError ? new Error("پرونده JSON معتبر نیست") : e);
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const rows = list.data?.rows ?? [];
  const title = kind === "reports" ? "گزارش‌ها" : "داشبوردها";
  const open = (id: string) => navigate(`/${orgId}/analytics/${kind}/${id}`);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={title}
        actions={
          <Space size={8}>
            {meta.data?.can_author ? (
              <>
                <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
                <Button icon={<Upload {...ICON14} />} onClick={() => file.current?.click()}>
                  ورود از JSON
                </Button>
                <Button type="primary" icon={<Plus {...ICON14} />} onClick={create}>
                  {kind === "reports" ? "گزارش تازه" : "داشبورد تازه"}
                </Button>
              </>
            ) : null}
          </Space>
        }
      />
      <div className="an-toolbar">
        <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "all", label: "همه" }, { value: "mine", label: "مال من" }, { value: "certified", label: "تأییدشده" }, { value: "trash", label: "سطل بازیافت" }]} aria-label="کدام‌ها" />
        <Select allowClear value={folder ?? undefined} onChange={(v) => setFolder(v ?? null)} placeholder="همهٔ پوشه‌ها" options={folderNames.map((f) => ({ value: f, label: f }))} style={{ minWidth: 160 }} suffixIcon={<FolderOpen {...ICON14} />} aria-label="پوشه" />
        <Input.Search allowClear value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجو" style={{ maxWidth: 260 }} aria-label="جست‌وجو" />
        <span className="an-muted ms-auto">{faDigits(list.data?.total ?? rows.length)} مورد</span>
      </div>
      {list.isLoading ? (
        <Loader />
      ) : !rows.length ? (
        <EmptyState
          icon={kind === "reports" ? ChartColumn : LayoutDashboard}
          title={tab === "trash" ? "سطل بازیافت خالی است" : kind === "reports" ? "گزارشی پیدا نشد" : "داشبوردی پیدا نشد"}
          description={tab === "all" && !q && !folder ? (kind === "reports" ? "گزارش‌ها خصوصی‌اند تا مالکشان آن‌ها را به اشتراک بگذارد." : "داشبوردهای آماده را مدیر گزارش‌ها از «تنظیمات گزارش‌ها» می‌افزاید.") : undefined}
          action={meta.data?.can_author && tab !== "trash" ? <Button onClick={create}>{kind === "reports" ? "ساختن گزارش" : "ساختن داشبورد"}</Button> : undefined}
        />
      ) : (
        <ul className="an-cards" aria-label={title}>
          {rows.map((r) => {
            const viz = r.viz as VizType | undefined;
            const Icon = kind === "reports" && viz ? VIZ_ICONS[viz] : LayoutDashboard;
            return (
              <li key={r.id} className={cx("an-def", !!r.trashed && "is-trashed")}>
                <Link to={tab === "trash" ? "#" : `/${orgId}/analytics/${kind}/${r.id}`} className="an-def-main" onClick={(e) => tab === "trash" && e.preventDefault()}>
                  <span className="an-def-ic" aria-hidden>
                    <Icon size={18} strokeWidth={1.4} />
                  </span>
                  <span className="min-w-0">
                    <span className="an-def-name">
                      {String(r.name)}
                      {r.certified ? <BadgeCheck size={14} strokeWidth={1.6} className="an-certified" aria-label="تأییدشده" /> : null}
                      {r.is_home ? <span className="an-tag">خانه</span> : null}
                    </span>
                    <span className="an-def-sub">
                      {kind === "reports" ? `${schema?.def(String(r.table_key))?.plural ?? r.table_key} · ${viz ? VIZ[viz]?.label : ""}` : String(r.description ?? "").slice(0, 80)}
                      {r.folder ? ` · ${r.folder}` : ""}
                    </span>
                  </span>
                </Link>
                <div className="an-def-meta">
                  <UserChip id={String(r.owner_id ?? "")} display={list.data?.display} compact />
                  <span className="an-muted">{formatJalaliDateTime(String(r.updated_at ?? ""), timezone)}</span>
                  {(() => {
                    const all = {
                      restore: { key: "restore", icon: <RotateCcw {...ICON14} />, label: "بازگرداندن", onClick: () => trash(r, false) },
                      open: { key: "open", label: "باز کردن", onClick: () => open(r.id) },
                      copy: { key: "copy", icon: <Copy {...ICON14} />, label: "رونوشت", onClick: () => analyticsApi.copy(api, table, r.id).then((x) => open(x.row.id)).catch((e) => n.error(e)) },
                      json: { key: "json", icon: <FileJson {...ICON14} />, label: "خروجی JSON", onClick: () => analyticsApi.exportBundle(api, kind === "reports" ? { reports: [r.id] } : { dashboards: [r.id] }).then((b) => saveJson(String(r.name), b)).catch((e) => n.error(e)) },
                      trash: { key: "trash", icon: <Trash2 {...ICON14} />, label: "انتقال به سطل بازیافت", danger: true, onClick: () => trash(r, true) },
                    };
                    const items = definitionActions(tab, { canEdit: canEdit.has(String(r.id)), canAuthor: !!meta.data?.can_author }).map((k) => all[k]);
                    return items.length ? (
                      <Dropdown trigger={["click"]} menu={{ items }}>
                        <Button size="small" type="text" icon={<MoreHorizontal {...ICON14} />} aria-label={`کارهای «${r.name}»`} />
                      </Dropdown>
                    ) : null;
                  })()}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
