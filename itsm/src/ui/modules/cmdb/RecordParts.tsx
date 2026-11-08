// Record-page extensions of configuration management's other tables:
//   cmdb_dedup_task      «ادغام»: choose the survivor among the candidates, preview what moves (relationships,
//                        references, fields the survivor gets) and merge; «بازگرداندن ادغام» while it can be undone
//   ci_baseline          «عکس تازه» and «مقایسه با وضعیت کنونی» (field and relationship differences), «ثبت انحراف»
//   ci_rel_suggestion    accept (with another type if needed) or reject a suggested relationship
//   ci_impact_sim        the saved result of a what-if, and «اجرای دوباره»
//   cmdb_map             «باز کردن نقشه»
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Collapse, Popconfirm, Radio, Select, Space, Table } from "antd";
import { Camera, GitCompareArrows, GitFork, GitMerge, Undo2, Zap } from "lucide-react";
import type { CompareResult, ImpactedService } from "@shared/cmdb/api";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Card, Note } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import type { RecordContext } from "../../records/extensions";
import { cmdbApi, CMDB_KEYS } from "./api";
import { SeverityMeter } from "./ImpactPage";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const val = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : faDigits(Array.isArray(v) ? v.join("، ") : typeof v === "object" ? JSON.stringify(v) : String(v)));

/** «ادغام» on a de-duplication task. */
export function DedupMerge({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const candidates = useMemo(() => (Array.isArray(ctx.row.candidates) ? (ctx.row.candidates as string[]) : []), [ctx.row.candidates]);
  const [survivor, setSurvivor] = useState<string>(String(ctx.row.main_ci_id ?? candidates[0] ?? ""));
  const absorbed = candidates.filter((c) => c !== survivor);
  const merged = !!ctx.row.merged_at && !ctx.row.undone_at;
  const preview = useQuery({
    queryKey: ["cmdb", "merge-preview", String(ctx.row.id), survivor],
    queryFn: () => cmdbApi.mergePreview(api, survivor, absorbed, String(ctx.row.id)),
    enabled: !merged && !!survivor && absorbed.length > 0 && ctx.meta.canWrite,
    staleTime: 10_000,
  });
  const merge = useMutation({
    mutationFn: () => cmdbApi.merge(api, survivor, absorbed, String(ctx.row.id)),
    onSuccess: () => {
      message.success("پیکربندی‌ها ادغام شدند");
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const undo = useMutation({
    mutationFn: () => cmdbApi.undoMerge(api, String(ctx.row.id)),
    onSuccess: (r) => {
      message.success(`ادغام بازگردانده شد (${fa(r.restored)} مورد)`);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (merged) {
    return (
      <Card title="ادغام انجام شد">
        <p className="mb-2 text-[13px] text-ink-2">پیکربندی‌های تکراری در پیکربندی اصلی ادغام شده‌اند. تا وقتی داده‌های تازه روی آن‌ها نوشته نشده، می‌توانید ادغام را بازگردانید.</p>
        <Popconfirm title="ادغام بازگردانده شود؟" okText="بازگرداندن" cancelText="انصراف" onConfirm={() => undo.mutate()}>
          <Button icon={<Undo2 {...ICON} />} loading={undo.isPending} disabled={!ctx.meta.canWrite}>بازگرداندن ادغام</Button>
        </Popconfirm>
      </Card>
    );
  }
  if (candidates.length < 2) return <EmptyState compact title="نامزدی برای ادغام نیست" />;
  const display = ctx.display ?? {};
  const p = preview.data;
  return (
    <Card title="ادغام پیکربندی‌های تکراری">
      <p className="mb-2 text-[13px] text-ink-3">پیکربندی‌ای را که می‌ماند انتخاب کنید؛ بقیه در آن ادغام و بازنشسته می‌شوند.</p>
      <Radio.Group value={survivor} onChange={(e) => setSurvivor(e.target.value)} className="mb-3 flex flex-col gap-1">
        {candidates.map((c) => (
          <Radio key={c} value={c}>
            {display[c] ?? c}
          </Radio>
        ))}
      </Radio.Group>
      {preview.isLoading ? <Loader /> : p ? (
        <div className="flex flex-col gap-2 text-[13px]">
          {p.problems.length ? <Note tone="warning">{p.problems.join("؛ ")}</Note> : null}
          <p className="text-ink-2">
            <span className="ds-num">{fa(p.relations.move)}</span> رابطه منتقل و <span className="ds-num">{fa(p.relations.drop)}</span> رابطهٔ تکراری حذف می‌شود.
          </p>
          {p.references.length ? (
            <p className="text-ink-2">
              ارجاع‌ها: {p.references.map((r) => `${r.label} (${fa(r.count)})`).join("، ")}
            </p>
          ) : null}
          {p.fills.length ? (
            <Collapse
              size="small"
              items={[{ key: "f", label: `${fa(p.fills.length)} ویژگی خالی پیکربندی اصلی پر می‌شود`, children: <ul className="flex flex-col gap-1">{p.fills.map((f) => <li key={f.field}><span className="text-ink-3">{f.label}:</span> {val(f.value)}</li>)}</ul> }]}
            />
          ) : null}
        </div>
      ) : null}
      <div className="mt-3">
        <Popconfirm title="پیکربندی‌ها ادغام شوند؟" description="رابطه‌ها و ارجاع‌ها به پیکربندی اصلی منتقل می‌شوند." okText="ادغام" cancelText="انصراف" onConfirm={() => merge.mutate()} disabled={!!p?.problems.length}>
          <Button type="primary" icon={<GitMerge {...ICON} />} loading={merge.isPending} disabled={!ctx.meta.canWrite || !!p?.problems.length || !absorbed.length}>ادغام</Button>
        </Popconfirm>
      </div>
    </Card>
  );
}

function DiffView({ r }: { r: CompareResult }) {
  const d = r.diff;
  if (!d.added.length && !d.removed.length && !d.modified.length) return <EmptyState compact title="تفاوتی نیست" description={`${fa(d.unchanged)} پیکربندی همان است که در خط مبنا بود.`} />;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-ink-2">
        {r.before.label} ← {r.after.label}: <span className="ds-num">{fa(d.modified.length)}</span> تغییرکرده، <span className="ds-num">{fa(d.removed.length)}</span> حذف‌شده،{" "}
        <span className="ds-num">{fa(d.added.length)}</span> افزوده، <span className="ds-num">{fa(d.unchanged)}</span> بی‌تغییر
      </p>
      {d.modified.length ? (
        <Table
          rowKey="id"
          size="small"
          pagination={d.modified.length > 15 ? { pageSize: 15 } : false}
          dataSource={d.modified}
          columns={[
            { title: "پیکربندی", dataIndex: "name", key: "n", width: 200 },
            {
              title: "تغییرها", key: "f",
              render: (_: unknown, m: CompareResult["diff"]["modified"][number]) => (
                <ul className="flex flex-col gap-0.5">
                  {m.fields.map((f) => (
                    <li key={f.field}>
                      <span className="text-ink-3">{r.labels[f.field] ?? f.field}:</span> <s className="text-ink-3">{val(f.before)}</s> ← {val(f.after)}
                    </li>
                  ))}
                  {m.relsAdded.map((x, i) => <li key={`a${i}`} className="text-ink-2">+ {x.type} {x.other_label ?? ""}</li>)}
                  {m.relsRemoved.map((x, i) => <li key={`r${i}`} className="text-ink-3">− {x.type} {x.other_label ?? ""}</li>)}
                </ul>
              ),
            },
          ]}
        />
      ) : null}
      {d.removed.length ? <p className="text-ink-2">حذف‌شده از دامنه: {d.removed.map((x) => x.name).join("، ")}</p> : null}
      {d.added.length ? <p className="text-ink-2">تازه در دامنه: {d.added.map((x) => x.name).join("، ")}</p> : null}
    </div>
  );
}

/** «مقایسه» tab of a baseline. */
export function BaselineCompare({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const id = String(ctx.row.id);
  const taken = !!ctx.row.taken_at;
  const cmp = useQuery({ queryKey: CMDB_KEYS.compare(orgId, id, null), queryFn: () => cmdbApi.compare(api, id), enabled: taken, staleTime: 15_000 });
  const snap = useMutation({ mutationFn: () => cmdbApi.snapshot(api, id), onSuccess: (r) => { message.success(`عکس خط مبنا گرفته شد (${fa(r.item_count)} پیکربندی)`); ctx.refresh(); }, onError: (e: Error) => message.error(e.message) });
  const drift = useMutation({ mutationFn: () => cmdbApi.drift(api, id), onSuccess: (r) => message.success(`${fa(r.created)} انحراف تازه ثبت شد`), onError: (e: Error) => message.error(e.message) });
  return (
    <div className="flex flex-col gap-3">
      <Space wrap>
        <Popconfirm title={taken ? "عکس تازه جای عکس قبلی را می‌گیرد؛ ادامه می‌دهید؟" : "از وضعیت کنونی عکس گرفته شود؟"} okText="عکس" cancelText="انصراف" onConfirm={() => snap.mutate()}>
          <Button icon={<Camera {...ICON} />} loading={snap.isPending} disabled={!ctx.meta.canWrite}>{taken ? "عکس تازه" : "گرفتن عکس"}</Button>
        </Popconfirm>
        {taken ? <Button icon={<GitCompareArrows {...ICON} />} onClick={() => cmp.refetch()} loading={cmp.isFetching}>مقایسهٔ دوباره</Button> : null}
        {taken ? <Button onClick={() => drift.mutate()} loading={drift.isPending} disabled={!ctx.meta.canWrite}>ثبت انحراف‌ها</Button> : null}
      </Space>
      {!taken ? <EmptyState compact title="هنوز عکسی گرفته نشده" description="خط مبنا با گرفتن عکس از پیکربندی‌های دامنه‌اش ساخته می‌شود." /> : cmp.isLoading ? <Loader /> : cmp.data ? <DiffView r={cmp.data} /> : null}
    </div>
  );
}

/** Accept / reject on a relationship suggestion. */
export function SuggestionActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const [type, setType] = useState<string | null>(null);
  const classes = useQuery({ queryKey: CMDB_KEYS.classes(orgId), queryFn: () => cmdbApi.classes(api), staleTime: 300_000 });
  const accept = useMutation({ mutationFn: () => cmdbApi.acceptSuggestion(api, String(ctx.row.id), type), onSuccess: () => { message.success("رابطه ساخته شد"); ctx.refresh(); }, onError: (e: Error) => message.error(e.message) });
  const reject = useMutation({ mutationFn: () => cmdbApi.rejectSuggestion(api, String(ctx.row.id)), onSuccess: () => { message.success("پیشنهاد رد شد"); ctx.refresh(); }, onError: (e: Error) => message.error(e.message) });
  if (ctx.row.state !== "proposed") return null;
  return (
    <Space size={6} wrap>
      <Select size="small" allowClear placeholder="همان نوع پیشنهادی" value={type ?? undefined} onChange={(v) => setType(v ?? null)} options={(classes.data?.types ?? []).map((t) => ({ value: t.key, label: t.label }))} style={{ minWidth: 150 }} aria-label="نوع رابطه" />
      <Button size="small" type="primary" loading={accept.isPending} onClick={() => accept.mutate()}>پذیرش</Button>
      <Button size="small" loading={reject.isPending} onClick={() => reject.mutate()}>رد</Button>
    </Space>
  );
}

/** The saved result of a what-if (and a fresh run). */
export function SimulationResult({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  const result = (ctx.row.result ?? null) as { counts?: Record<string, number>; services?: ImpactedService[]; computed_at?: string } | null;
  const ids = Array.isArray(ctx.row.ci_ids) ? (ctx.row.ci_ids as string[]) : [];
  return (
    <div className="flex flex-col gap-3">
      <Space wrap>
        <Button icon={<Zap {...ICON} />} onClick={() => nav(`/${orgId}/cmdb/impact?ci=${ids.join(",")}${ctx.row.sim_state && ctx.row.sim_state !== "down" ? `&state=${ctx.row.sim_state}` : ""}`)}>اجرای دوباره</Button>
      </Space>
      {result?.services?.length ? (
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={result.services}
          columns={[
            { title: "خدمت", dataIndex: "name", key: "n", render: (v: string, s: ImpactedService) => <Link className="ds-link" to={`/${orgId}/${s.kind === "service" ? "services" : "service-offerings"}/${s.id}`}>{v}</Link> },
            { title: "شدت", dataIndex: "severity", key: "s", width: 170, render: (v: number) => <SeverityMeter value={v} /> },
          ]}
        />
      ) : (
        <EmptyState compact title="خدمتی متأثر نشده بود" />
      )}
    </div>
  );
}

/** «باز کردن نقشه» on a saved map. */
export function OpenSavedMap({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const roots = Array.isArray(ctx.row.root_ids) ? (ctx.row.root_ids as string[]) : [];
  const params = new URLSearchParams({ root: roots.join(",") });
  if (ctx.row.depth) params.set("depth", String(ctx.row.depth));
  if (ctx.row.direction && ctx.row.direction !== "both") params.set("dir", String(ctx.row.direction));
  if (ctx.row.layout === "RL") params.set("layout", "RL");
  if (Array.isArray(ctx.row.types) && ctx.row.types.length) params.set("types", (ctx.row.types as string[]).join(","));
  return (
    <Link to={`/${orgId}/cmdb/map?${params}`}>
      <Button size="small" icon={<GitFork {...ICON} />} disabled={!roots.length}>باز کردن نقشه</Button>
    </Link>
  );
}
