// The CI page's extensions (catalogue CMDB-017 CI 360, CMDB-001 class attributes, CMDB-024 provenance, CMDB-030
// health): header actions (map, impact, health now), the health side panel, and tabs — the class's own attributes as
// a form (inherited from every ancestor class, typed, required ones marked), the dependency map around the CI, its
// impact if it went down, and which source set each attribute. The server sends the class's attributes with the
// record (`meta.cmdb`), so the form always matches the class the CI has now.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, Input, Segmented, Select, Space, Table, Tooltip } from "antd";
import { Activity, GitFork, Lock, RefreshCw, Zap } from "lucide-react";
import { HEALTH_ISSUES, type AttrDef } from "@shared/cmdb/classes";
import type { ClassFamily } from "@shared/cmdb/classes";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Chip, EmptyState, JDate, JDateTime, Loader } from "../../components/display";
import { DateInput, NumberInput } from "../../components/inputs";
import { Note } from "../../components/blocks";
import type { RecordContext } from "../../records/extensions";
import { cmdbApi, CMDB_KEYS } from "./api";
import { ServiceMap } from "./ServiceMap";
import { attrsToSave, missingAttrs } from "./model";
import { SeverityMeter } from "./ImpactPage";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export interface CiMeta {
  class_label: string;
  family: ClassFamily;
  attrs: AttrDef[];
  ancestry: { key: string; label: string }[];
  can_write: boolean;
  ai: string[];
}

export const ciMeta = (ctx: RecordContext): CiMeta | null => (ctx.meta.cmdb as CiMeta | undefined) ?? null;

export function CiHeaderActions({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const id = String(ctx.row.id);
  return (
    <Space size={6} wrap>
      <Link to={`/${orgId}/cmdb/map?root=${id}`}>
        <Button size="small" icon={<GitFork {...ICON} />}>نقشه</Button>
      </Link>
      <Link to={`/${orgId}/cmdb/impact?ci=${id}`}>
        <Button size="small" icon={<Zap {...ICON} />}>تحلیل اثر</Button>
      </Link>
    </Space>
  );
}

/** «سلامت داده» side panel: the score, what is missing or wrong, staleness. */
export function CiHealthPanel({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const row = ctx.row as Record<string, unknown>;
  const health = (row.health ?? {}) as { issues?: string[]; missing?: string[]; violations?: string[] };
  const issues = [...new Set([...(Array.isArray(row.health_issues) ? (row.health_issues as string[]) : []), ...(health.issues ?? [])])].map((k) => HEALTH_ISSUES.find((o) => o.value === k)?.label ?? k);
  // missing fields and class attributes by their Persian labels
  const attrs = ciMeta(ctx)?.attrs ?? [];
  const fieldLabel = (p: string) => (p.startsWith("attrs.") ? attrs.find((a) => a.name === p.slice(6))?.label : ctx.def.fields.find((f) => f.name === p)?.label) ?? p;
  const missing = (health.missing ?? []).map(fieldLabel);
  const run = useMutation({
    mutationFn: () => cmdbApi.ciHealth(api, String(ctx.row.id)),
    onSuccess: () => {
      message.success("سلامت این پیکربندی دوباره محاسبه شد");
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const score = row.health_score as number | null | undefined;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-3">امتیاز</span>
        <span className="ds-num text-[18px] text-ink">{score === null || score === undefined ? "—" : fa(score)}</span>
      </div>
      {row.is_stale ? <Chip tone="warning">کهنه — مدتی است دیده یا به‌روز نشده</Chip> : null}
      {issues.length ? (
        <ul className="flex list-disc flex-col gap-1 ps-4 text-ink-2">
          {issues.slice(0, 8).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : score !== null && score !== undefined ? (
        <p className="text-ink-3">ایرادی پیدا نشد.</p>
      ) : null}
      {missing.length ? <p className="text-ink-3">خالی: {missing.join("، ")}</p> : null}
      <div className="flex items-center justify-between gap-2 text-ink-3">
        <span>آخرین کشف</span>
        <JDateTime v={row.last_discovered_at as string | null} />
      </div>
      <Button size="small" icon={<RefreshCw {...ICON} />} loading={run.isPending} onClick={() => run.mutate()}>
        محاسبهٔ دوباره
      </Button>
    </div>
  );
}

function AttrInput({ a, value, onChange, disabled }: { a: AttrDef; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const common = { disabled, "aria-label": a.label } as const;
  switch (a.type) {
    case "int":
    case "decimal":
      return <NumberInput disabled={disabled} value={value === null || value === undefined ? null : String(value)} onChange={(v) => onChange(v)} decimals={a.type === "decimal" ? 4 : 0} suffix={a.unit ? <span className="text-ink-3">{a.unit}</span> : undefined} />;
    case "bool":
      return <Checkbox checked={value === true} onChange={(e) => onChange(e.target.checked)} disabled={disabled}>{a.label}</Checkbox>;
    case "date":
      return <DateInput {...common} value={(value as string) ?? null} onChange={onChange} allowClear />;
    case "choice":
      return <Select {...common} allowClear value={(value as string) ?? undefined} onChange={(v) => onChange(v ?? null)} options={(a.choices ?? []).map((o) => ({ value: o.value, label: o.label }))} style={{ width: "100%" }} />;
    case "multichoice":
      return <Select {...common} mode="multiple" allowClear value={(Array.isArray(value) ? value : []) as string[]} onChange={onChange} options={(a.choices ?? []).map((o) => ({ value: o.value, label: o.label }))} style={{ width: "100%" }} />;
    case "tags":
      return <Select {...common} mode="tags" value={(Array.isArray(value) ? value : []) as string[]} onChange={onChange} style={{ width: "100%" }} tokenSeparators={[",", "،"]} />;
    case "text":
      return <Input.TextArea {...common} autoSize={{ minRows: 2, maxRows: 8 }} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input {...common} dir={a.ltr || ["url", "ip", "email"].includes(a.type) ? "ltr" : undefined} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={a.maxLength} suffix={a.unit ? <span className="text-ink-3">{a.unit}</span> : undefined} />;
  }
}

/** «ویژگی‌های کلاس»: the class's attributes (inherited ones too) as a typed form. */
export function CiAttrsTab({ ctx }: { ctx: RecordContext }) {
  const meta = ciMeta(ctx);
  const current = (ctx.row.attrs ?? {}) as Record<string, unknown>;
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const attrs = (meta?.attrs ?? []).filter((a) => !a.archived);
  const values = { ...current, ...edits };
  const missing = missingAttrs(attrs, values);
  const writable = !!meta?.can_write && ctx.meta.canWrite && !ctx.meta.locked && !ctx.meta.readonly.includes("attrs");
  if (!attrs.length) return <EmptyState compact title="این کلاس ویژگی ویژه‌ای ندارد" description="ویژگی‌های هر کلاس در «مدیریت کلاس‌ها» تعریف می‌شود." />;
  const dirty = Object.keys(edits).length > 0;
  const save = async () => {
    setSaving(true);
    const ok = await ctx.save({ attrs: attrsToSave(attrs, current, edits) });
    setSaving(false);
    if (ok) setEdits({});
  };
  return (
    <div className="flex flex-col gap-3">
      {meta?.ancestry?.length ? (
        <p className="text-[12px] text-ink-3">
          {meta.ancestry.map((a) => a.label).join(" ← ")}
        </p>
      ) : null}
      {missing.length ? <Note tone="warning">{`ویژگی‌های الزامی خالی: ${missing.join("، ")}`}</Note> : null}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {attrs.map((a) => (
          <label key={a.name} className="flex flex-col gap-1">
            {a.type === "bool" ? null : (
              <span className="text-[12.5px] text-ink-2">
                {a.label}
                {a.required ? <span className="text-danger"> *</span> : null}
                {a.identifier ? <Tooltip title="شناسه‌ای که موتور آشتی داده با آن پیکربندی را می‌شناسد"><span className="ms-1 text-ink-3">(شناسه)</span></Tooltip> : null}
              </span>
            )}
            <AttrInput a={a} value={values[a.name]} disabled={!writable} onChange={(v) => setEdits((e) => ({ ...e, [a.name]: v }))} />
            {a.help ? <span className="text-[12px] text-ink-3">{a.help}</span> : null}
          </label>
        ))}
      </div>
      {writable ? (
        <div className="flex gap-2">
          <Button type="primary" disabled={!dirty} loading={saving} onClick={save}>ذخیرهٔ ویژگی‌ها</Button>
          {dirty ? <Button onClick={() => setEdits({})}>انصراف</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

/** «نقشهٔ وابستگی» tab: the map around the CI (two steps, both directions by default). */
export function CiMapTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, allows } = useOrg();
  const [direction, setDirection] = useState<"both" | "dependents" | "dependencies">("both");
  const [selected, setSelected] = useState<string | null>(null);
  const root = String(ctx.row.ci_id ?? ctx.row.id);
  const q = { roots: [root], depth: 2, direction, overlays: true };
  // a service's «مدل خدمت» is open to whoever reads the service; the map is the CMDB's (a requester: 404, «نقشه بارگذاری نشد»)
  const canMap = allows({ area: "cmdb" });
  const map = useQuery({ queryKey: CMDB_KEYS.map(orgId, q), queryFn: () => cmdbApi.map(api, q), staleTime: 30_000, enabled: canMap });
  if (!canMap) return <p className="text-[13px] text-ink-3">نقشهٔ پیکربندی را نمی‌توانید ببینید.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="small"
          value={direction}
          onChange={(v) => setDirection(v as typeof direction)}
          options={[
            { value: "both", label: "هر دو سو" },
            { value: "dependents", label: "وابسته‌ها" },
            { value: "dependencies", label: "وابستگی‌ها" },
          ]}
        />
        <Link className="ds-link text-[13px]" to={`/${orgId}/cmdb/map?root=${root}${direction === "both" ? "" : `&dir=${direction}`}`}>
          نقشهٔ کامل
        </Link>
      </div>
      {map.isLoading ? <Loader /> : map.data ? (
        map.data.nodes.length <= 1 ? (
          <EmptyState compact title="رابطه‌ای ثبت نشده" description="رابطه‌های این پیکربندی را از فهرست «رابطه‌ها» یا با ورود داده اضافه کنید." icon={GitFork} />
        ) : (
          <ServiceMap map={map.data} selected={selected} onSelect={setSelected} height={460} minimap={false} />
        )
      ) : (
        <EmptyState compact title="نقشه بارگذاری نشد" />
      )}
    </div>
  );
}

/** «اثر» tab: what goes down with this CI. */
export function CiImpactTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const id = String(ctx.row.ci_id ?? ctx.row.id);
  const q = { ci_ids: [id], state: "down" as const };
  const r = useQuery({ queryKey: CMDB_KEYS.impact(orgId, q), queryFn: () => cmdbApi.impact(api, q), staleTime: 60_000 });
  if (r.isLoading) return <Loader />;
  if (!r.data) return <EmptyState compact title="تحلیل اثر انجام نشد" />;
  const d = r.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-ink-2">
        اگر این پیکربندی از کار بیفتد: <b className="ds-num">{fa(d.counts.services)}</b> خدمت، <b className="ds-num">{fa(d.counts.offerings)}</b> گزینهٔ خدمت و{" "}
        <b className="ds-num">{fa(d.counts.cis)}</b> پیکربندی دیگر متأثر می‌شوند{d.counts.restricted ? ` (${fa(d.counts.restricted)} مورد محدود)` : ""}.
      </p>
      {d.services.length ? (
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={d.services.slice(0, 30)}
          columns={[
            { title: "خدمت", dataIndex: "name", key: "n", render: (v: string, s: (typeof d.services)[number]) => <Link className="ds-link" to={`/${orgId}/${s.kind === "service" ? "services" : "service-offerings"}/${s.id}`}>{v}</Link> },
            { title: "شدت", dataIndex: "severity", key: "s", width: 170, render: (v: number) => <SeverityMeter value={v} /> },
          ]}
        />
      ) : null}
      <Link className="ds-link text-[13px]" to={`/${orgId}/cmdb/impact?ci=${id}`}>تحلیل کامل اثر</Link>
    </div>
  );
}

/** «منشأ داده» tab: which source set every attribute, what each one reported, and the locks. */
export function CiProvenanceTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const id = String(ctx.row.id);
  const r = useQuery({ queryKey: CMDB_KEYS.provenance(orgId, id), queryFn: () => cmdbApi.provenance(api, id), staleTime: 30_000 });
  const rows = useMemo(() => (r.data?.rows ?? []).filter((x) => x.set_by || x.observations.length || x.locked), [r.data]);
  if (r.isLoading) return <Loader />;
  if (!rows.length) return <EmptyState compact title="منشأ داده‌ای ثبت نشده" description="ویژگی‌هایی که کشف یا ورود داده می‌نویسند، این‌جا با منبع و زمانشان دیده می‌شوند." icon={Activity} />;
  return (
    <Table
      rowKey="field"
      size="small"
      pagination={false}
      dataSource={rows}
      scroll={{ x: 640 }}
      columns={[
        { title: "ویژگی", dataIndex: "label", key: "l", width: 160, render: (v: string, x: (typeof rows)[number]) => <span className="flex items-center gap-1">{x.locked ? <Tooltip title="قفل: منبع‌ها آن را بازنویسی نمی‌کنند"><Lock size={12} strokeWidth={1.6} absoluteStrokeWidth /></Tooltip> : null}{v}</span> },
        { title: "مقدار", dataIndex: "value", key: "v", render: (v: unknown) => <span className="break-all">{v === null || v === undefined || v === "" ? "—" : faDigits(Array.isArray(v) ? v.join("، ") : String(v))}</span> },
        { title: "نوشتهٔ", dataIndex: "set_by", key: "s", width: 200, render: (v: (typeof rows)[number]["set_by"]) => (v ? <span className="flex flex-col"><span>{v.name}</span>{v.at ? <span className="text-[12px] text-ink-3"><JDate v={v.at} /></span> : null}</span> : "—") },
        {
          title: "گزارش منبع‌ها", dataIndex: "observations", key: "o",
          render: (v: (typeof rows)[number]["observations"]) => (
            <span className="flex flex-col gap-0.5 text-[12px]">
              {v.slice(0, 4).map((o, i) => (
                <span key={i}>
                  <span className="text-ink-3">{o.name}:</span> {o.value === null || o.value === undefined ? "—" : faDigits(String(o.value))}
                </span>
              ))}
            </span>
          ),
        },
      ]}
    />
  );
}

/** Invalidate everything of the CMDB after a write elsewhere (merge, import). */
export function useCmdbRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return () => qc.invalidateQueries({ queryKey: CMDB_KEYS.all(orgId) });
}
