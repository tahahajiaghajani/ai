// «صف آشتی» (design A §8.4, §15): what the tools reported that the configuration database could not settle by itself,
// across the connectors the person reads — tabs «بی‌همتا»، «تکراری»، «خطا» and «ناهمخوانی», a chip by connector and a
// search. On an item: «ساخت پیکربندی» (never for an ATM), «پیوند به…» (a CI picker) and «نادیده گرفتن» for CMDB
// administrators and the connector's owner; on a difference with the asset register, «به‌روزرسانی دارایی با مقدار
// ابزار» per field and «نادیده گرفتن» for the asset's managers. Several items at once from the bulk bar. Duplicates
// open their review in «بررسی تکراری‌ها». The server checks every action again.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Input, Modal, Tabs, Tooltip, type MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCheck, Ellipsis, EyeOff, Link2, ListChecks, PackagePlus, Radar, RotateCw, Search } from "lucide-react";
import { ITEM_KINDS } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { useDebounced, useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { DataTable } from "../../components/data";
import { FilterChip } from "../../components/inputs";
import { displayOf } from "../../records/model/schema";
import type { DisplayMap } from "../../records/model/types";
import { CiPicker } from "../cmdb/CiPicker";
import { dkeys, QUEUE_PAGE, useConnectorCards, useDiscoveryMeta, useNames, useQueue } from "./api";
import {
  applicable, bulkActions, bulkOutcome, createdText, isQueueTab, labelOf, QUEUE_TABS, queueActions, tabLabel, type ItemRow, type MismatchEntry, type QueueAction, type QueueRights, type QueueTab,
} from "./model";
import { Refused } from "./Console";
import { Ago, I16 } from "./parts";

const ACTION_WORDS: Record<QueueAction, { label: string; icon: typeof Link2 }> = {
  create: { label: "ساخت پیکربندی", icon: PackagePlus },
  link: { label: "پیوند به…", icon: Link2 },
  ignore: { label: "نادیده گرفتن", icon: EyeOff },
  dismiss: { label: "نادیده گرفتن", icon: EyeOff },
};

export default function Queue() {
  const { api, orgId, timezone } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const meta = useDiscoveryMeta();
  const cards = useConnectorCards();
  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get("tab");
  const tab: QueueTab = isQueueTab(rawTab) ? rawTab : "unmatched";
  const connector = sp.get("connector") ?? "";
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [linking, setLinking] = useState<ItemRow | null>(null);
  const [ci, setCi] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [tab, connector, q]);
  const res = useQueue({ tab, connector, q, page });
  const rows = useMemo(() => res.data?.rows ?? [], [res.data]);
  const display = res.data?.display ?? {};
  // the holders and places the differences name: one request each for the page
  const idsOf = (field: string) => rows.flatMap((r) => (r.mismatch?.entries ?? []).filter((e) => e.field === field).flatMap((e) => [e.held, e.resolved])).filter((x): x is string => typeof x === "string");
  const people = useNames("user", tab === "mismatch" ? idsOf("assigned_to") : []);
  const places = useNames("location", tab === "mismatch" ? idsOf("location_id") : []);
  const nameOf = (e: MismatchEntry, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "خالی";
    if (e.field === "assigned_to") return people.get(String(v)) ?? "—";
    if (e.field === "location_id") return places.get(String(v)) ?? "—";
    return String(v);
  };
  const rights: QueueRights = useMemo(
    () => ({ admin: !!meta.data?.can.admin, assetManager: !!meta.data?.can.assetManager, operates: new Set((cards.data ?? []).filter((c) => c.can.operate).map((c) => c.id)) }),
    [meta.data, cards.data],
  );
  const picked = rows.filter((r) => selected.includes(r.id));
  const bulk = bulkActions(tab, picked, rights);
  const selectable = rows.some((r) => queueActions(tab, r, rights).length > 0);

  const set = (k: string, v: string | null) => setSp((x) => (v ? x.set(k, v) : x.delete(k), x), { replace: true });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: dkeys.queue(orgId) }), qc.invalidateQueries({ queryKey: dkeys.cards(orgId) })]);

  /** One action on items, one request each (the server checks each); the toast says what happened. */
  const run = async (action: QueueAction, items: ItemRow[], ciId?: string) => {
    if (!items.length) return;
    if (action === "ignore" || action === "dismiss") {
      const what = action === "ignore" ? "تا ابزار آن را دیگرگونه گزارش نکند، دوباره در صف نمی‌آید." : "تا مقدارهای گزارش‌شده تغییر نکنند، دوباره در صف نمی‌آید.";
      if (!(await n.confirm(items.length > 1 ? `${fa(items.length)} مورد نادیده گرفته شود؟` : `«${items[0].name || items[0].external_id}» نادیده گرفته شود؟`, what, false, "نادیده گرفتن"))) return;
    }
    if (action === "create" && items.length > 1 && !(await n.confirm(`برای ${fa(items.length)} مورد پیکربندی ساخته شود؟`, "هر مورد یک بار دیگر به پایگاه پیکربندی فرستاده می‌شود و این بار ساخته می‌شود.", false, "ساخت پیکربندی"))) return;
    setBusy(action);
    let done = 0;
    const failed: string[] = [];
    let single: string | null = null;
    for (const it of items) {
      try {
        if (action === "create") {
          const out = createdText(await api.post<{ action: string; number?: string | null; message?: string | null }>(`/discovery/items/${it.id}/create`));
          if (out.ok) done++;
          else failed.push(out.text);
          single = out.text;
        } else if (action === "link") {
          await api.post(`/discovery/items/${it.id}/link`, { ci_id: ciId });
          done++;
          single = "پیوند ثبت شد؛ در گذر بعدی منبع آشتی می‌شود";
        } else {
          await api.post(action === "ignore" ? `/discovery/items/${it.id}/ignore` : `/discovery/items/${it.id}/mismatch/dismiss`);
          done++;
        }
      } catch (e) {
        failed.push(errorText(e));
      }
    }
    const o = items.length === 1 && single && (done || failed[0] === single) ? { ok: !!done, text: single } : bulkOutcome(done, failed);
    if (o.ok) n.ok(o.text);
    else if (done) n.warn(o.text);
    else n.error(new Error(o.text));
    setSelected([]);
    setBusy(null);
    await refresh();
  };

  const apply = async (it: ItemRow, e: MismatchEntry) => {
    setBusy(`apply:${it.id}:${e.field}`);
    try {
      await api.post(`/discovery/items/${it.id}/mismatch/apply`, { field: e.field });
      n.ok(`«${e.label}» دارایی با مقدار ابزار به‌روز شد`);
      await refresh();
    } catch (err) {
      n.error(err);
    } finally {
      setBusy(null);
    }
  };

  const onAction = (action: QueueAction, items: ItemRow[]) => {
    if (action === "link") {
      setCi(null);
      setLinking(items[0]);
    } else void run(action, items);
  };

  const error = meta.error ?? res.error;
  const counts = res.data?.counts ?? {};
  const toolbar = (
    <div className="dsc-bar" role="search">
      <Input
        allowClear
        prefix={<Search {...I16} aria-hidden />}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="جست‌وجوی نام یا شناسه"
        aria-label="جست‌وجوی نام یا شناسه"
        className="dsc-search"
      />
      <FilterChip
        label="منبع داده"
        icon={Radar}
        value={connector || null}
        onChange={(v) => set("connector", v)}
        options={(cards.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
      />
      <Tooltip title="بازخوانی">
        <Button type="text" icon={<RotateCw {...I16} className={res.isFetching && res.data ? "ds-spin" : undefined} />} onClick={() => void res.refetch()} aria-label="بازخوانی" />
      </Tooltip>
      {bulk.length ? (
        <div className="dsc-bulk" role="toolbar" aria-label="کار دسته‌جمعی">
          <span className="dsc-meta">
            <span className="ds-num">{fa(picked.length)}</span> مورد برگزیده
          </span>
          {bulk.map((a) => {
            const W = ACTION_WORDS[a];
            return (
              <Button key={a} icon={<W.icon {...I16} />} loading={busy === a} onClick={() => onAction(a, picked)}>
                {W.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="صف آشتی" />
      {error ? (
        <Refused error={error} retry={() => void Promise.all([meta.refetch(), res.refetch()])} />
      ) : (
        <>
          <Tabs
            className="rk-tabs"
            activeKey={tab}
            onChange={(k) => set("tab", k === "unmatched" ? null : k)}
            items={QUEUE_TABS.map((t) => ({ key: t.key, label: tabLabel(t.label, counts[t.key]) }))}
          />
          {toolbar}
          {!res.data ? (
            <Skeleton rows={6} />
          ) : (
            <DataTable<ItemRow>
              rowKey="id"
              dataSource={rows}
              columns={columns(tab, orgId, timezone, display, rights, busy, onAction, apply, nameOf)}
              rowSelection={
                selectable
                  ? {
                      selectedRowKeys: selected,
                      onChange: (keys) => setSelected(keys.map(String)),
                      getCheckboxProps: (r) => ({ disabled: !queueActions(tab, r, rights).length, "aria-label": `برگزیدن ${r.name || r.external_id}` }),
                    }
                  : undefined
              }
              pagination={{ current: page, pageSize: QUEUE_PAGE, total: res.data.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true, size: "small" }}
              locale={{
                emptyText: q || connector ? <EmptyState compact title="چیزی پیدا نشد" description="عبارت جست‌وجو یا منبع داده را تغییر دهید." /> : <EmptyState icon={CheckCheck} title="موردی برای بررسی نیست" />,
              }}
            />
          )}
        </>
      )}
      <Modal
        open={!!linking}
        title="پیوند به پیکربندی"
        okText="پیوند"
        cancelText="انصراف"
        okButtonProps={{ disabled: !ci, loading: busy === "link" }}
        onOk={() => {
          if (linking && ci) void run("link", [linking], ci).then(() => setLinking(null));
        }}
        onCancel={() => setLinking(null)}
        destroyOnHidden
      >
        {linking ? (
          <div className="flex flex-col gap-3">
            <p className="dsc-meta">
              {`«${linking.name || linking.external_id}» به پیکربندی‌ای که برمی‌گزینید پیوند می‌خورد و گذر بعدی منبع آن را آشتی می‌کند.`}
            </p>
            <CiPicker value={ci} onChange={(v) => setCi(typeof v === "string" ? v : null)} autoFocus aria-label="پیکربندی" placeholder="نام یا شمارهٔ پیکربندی" style={{ width: "100%" }} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function columns(
  tab: QueueTab,
  orgId: string,
  tz: string,
  display: DisplayMap,
  rights: QueueRights,
  busy: string | null,
  onAction: (a: QueueAction, items: ItemRow[]) => void,
  apply: (it: ItemRow, e: MismatchEntry) => void,
  nameOf: (e: MismatchEntry, v: unknown) => string,
): ColumnsType<ItemRow> {
  const cols: ColumnsType<ItemRow> = [
    {
      title: "مورد",
      key: "name",
      render: (_, r) => (
        <div className="dsc-cell">
          <span className="dsc-strong">{r.name || "—"}</span>
          <span className="dsc-sub">
            {r.kind ? `${labelOf(ITEM_KINDS, r.kind)} · ` : ""}
            <bdi dir="ltr" className="ds-mono">
              {r.external_id}
            </bdi>
          </span>
        </div>
      ),
    },
    {
      title: "منبع داده",
      key: "connector",
      render: (_, r) => (
        <Link className="ds-link" to={`/${orgId}/discovery/${r.connector_id}`}>
          {displayOf(display, r.connector_id) ?? "منبع داده"}
        </Link>
      ),
    },
  ];
  if (tab === "mismatch") {
    cols.push(
      {
        title: "دارایی",
        key: "asset",
        render: (_, r) =>
          r.asset_id ? (
            <Link className="ds-link" to={`/${orgId}/assets/${r.asset_id}`}>
              {displayOf(display, r.asset_id) ?? "دارایی"}
            </Link>
          ) : r.ci_id ? (
            <Link className="ds-link" to={`/${orgId}/cis/${r.ci_id}`}>
              {displayOf(display, r.ci_id) ?? "پیکربندی"}
            </Link>
          ) : (
            <span className="ds-zero">—</span>
          ),
      },
      {
        title: "ناهمخوانی‌ها",
        key: "mismatch",
        render: (_, r) => <Differences row={r} canApply={rights.admin || rights.assetManager} busy={busy} onApply={(e) => apply(r, e)} nameOf={nameOf} />,
      },
    );
  } else {
    cols.push({
      title: tab === "duplicate" ? "تکراری با" : "پیام",
      key: "message",
      render: (_, r) => (
        <div className="dsc-cell">
          {r.message ? <span className="dsc-sub dsc-clamp">{r.message}</span> : <span className="ds-zero">—</span>}
          {r.dedup_task_id ? (
            <Link className="ds-link" to={`/${orgId}/cmdb/duplicates/${r.dedup_task_id}`}>
              بررسی تکراری
            </Link>
          ) : null}
        </div>
      ),
    });
  }
  cols.push(
    { title: "آخرین آشتی", key: "reconciled_at", render: (_, r) => <Ago at={r.reconciled_at ?? r.updated_at} tz={tz} /> },
    {
      title: <span className="sr-only">کارها</span>,
      key: "actions",
      width: 56,
      render: (_, r) => {
        const acts = queueActions(tab, r, rights);
        if (!acts.length) return null;
        const items: MenuProps["items"] = acts.map((a) => {
          const W = ACTION_WORDS[a];
          return { key: a, label: W.label, icon: <W.icon {...I16} /> };
        });
        return (
          <Dropdown menu={{ items, onClick: ({ key }) => onAction(key as QueueAction, [r]) }} trigger={["click"]}>
            <Button type="text" icon={<Ellipsis {...I16} />} aria-label={`کارهای «${r.name || r.external_id}»`} disabled={!!busy} />
          </Dropdown>
        );
      },
    },
  );
  return cols;
}

/** An item's differences with the asset register: the field, the tool's value and what the asset holds. */
function Differences({ row, canApply, busy, onApply, nameOf }: { row: ItemRow; canApply: boolean; busy: string | null; onApply: (e: MismatchEntry) => void; nameOf: (e: MismatchEntry, v: unknown) => string }) {
  const entries = row.mismatch?.entries ?? [];
  if (!entries.length) return <span className="ds-zero">—</span>;
  return (
    <ul className="dsc-diffs">
      {entries.map((e) => (
        <li key={`${e.target}:${e.field}`}>
          <span className="dsc-strong">{e.label}</span>
          <span className="dsc-sub">
            {"ابزار: "}
            <bdi className="ds-mono">{String(e.reported ?? "—")}</bdi>
            {` · ${e.target === "asset" ? "دارایی" : "پیکربندی"}: `}
            <bdi>{nameOf(e, e.held)}</bdi>
          </span>
          {canApply && applicable(e) ? (
            <Button size="small" icon={<ListChecks {...I16} />} loading={busy === `apply:${row.id}:${e.field}`} onClick={() => onApply(e)}>
              به‌روزرسانی دارایی با مقدار ابزار
            </Button>
          ) : null}
        </li>
      ))}
      {row.mismatch_state === "dismissed" ? (
        <li>
          <Chip tone="neutral">نادیده گرفته شد</Chip>
        </li>
      ) : null}
    </ul>
  );
}
