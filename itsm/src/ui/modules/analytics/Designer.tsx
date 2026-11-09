// «طراح گزارش» (catalogue ANA-006/007/009/011/052): a report over any table the person may read — measures (count,
// distinct, sum, average, median, p90/p95, min/max, the time between two dates, the share of matching records),
// up to three dimensions (Jalali day/week/month/quarter/year, hour, weekday, hour of day, ranges and ages), filters
// with the condition builder, a time window relative to today with the previous period, and the chart gallery
// (rules-first suggestion; shapes that do not fit are greyed out with the reason). The preview runs live, with the
// person's own access, as they change the definition; a click on an element drills to the next step (breadcrumb) or
// opens its records. Saving keeps the definition private until it is shared; sharing never shares data.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Switch, Tooltip } from "antd";
import { ChevronLeft, Copy, Download, FileJson, Filter, MoreHorizontal, Plus, Save, Sparkles, CalendarClock, BadgeCheck, Printer, X } from "lucide-react";
import type { Cond } from "@shared/model/conditions";
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { DATE_UNITS } from "@shared/model/jalali-buckets";
import { BUCKETS, MEASURES, MEASURE_FNS, VIZ, VIZ_TYPES, drillDown, groupable, normalizeSpec, specProblem, starterSpec, suggestViz, TIME_PRESETS, windowLabel } from "@shared/analytics/model";
import { ANALYTICS_STATUS } from "@shared/tables/analytics";
import type { Dimension, DimBucket, KeyValue, Measure, MeasureFn, ReportSpec, Share, VizType } from "@shared/analytics/types";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useDebounced, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { Card, ICON14, Note, cx } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { FilterBuilder, newRecordPath, recordsApi, useMe, useSchema } from "../../records";
import type { Schema } from "../../records/model/schema";
import { analyticsApi, ANALYTICS_KEYS, downloadXlsx, saveJson } from "./api";
import { ResultCard, ShareEditor, useAnalyticsMeta, VIZ_ICONS } from "./parts";
import { elementCond, nextDrill, vizFits } from "./model";
import "./analytics.css";

const isDate = (f: FieldDef) => f.type === "date" || f.type === "datetime";
const isNumeric = (f: FieldDef) => !!FIELD_TYPES[f.type]?.numeric;
const usable = (f: FieldDef) => !f.hidden && f.type !== "secret" && f.type !== "json" && f.type !== "conditions";

/** Fields a measure may take for `fn`. */
function measureFields(def: TableDef, fn: MeasureFn): FieldDef[] {
  const fs = def.fields.filter(usable);
  if (fn === "count") return fs.filter(groupable);
  if (fn === "count_distinct") return fs.filter(groupable);
  if (fn === "ratio") return [];
  if (fn === "min" || fn === "max") return fs.filter((f) => isNumeric(f) || isDate(f));
  return fs.filter((f) => isNumeric(f) || isDate(f));
}

export default function Designer() {
  const { id = "new" } = useParams();
  const [params] = useSearchParams();
  const { api, orgId, timezone } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meta = useAnalyticsMeta();
  const { schema } = useSchema();
  const { userId } = useMe();
  const isNew = id === "new";
  const rec = useQuery({ queryKey: ["records", orgId, "analytics_report", id], queryFn: () => recordsApi.get(api, "analytics_report", id), enabled: !isNew });
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [trail, setTrail] = useState<{ spec: ReportSpec; label: string }[]>([]);
  const [info, setInfo] = useState<{ name: string; description: string; folder: string; status: string; shares: Share[] }>({ name: "", description: "", folder: "", status: "draft", shares: [] });
  const [saving, setSaving] = useState<null | "save" | "copy">(null);
  const [narrative, setNarrative] = useState<{ text: string; ai: boolean } | null>(null);

  // the starting definition: the stored one, a question's (?spec=), a table's starter (?table=), or the first table's
  useEffect(() => {
    if (spec || !schema) return;
    if (!isNew) {
      if (!rec.data) return;
      const row = rec.data.row as Record<string, unknown>;
      setSpec(row.spec as ReportSpec);
      setInfo({ name: String(row.name ?? ""), description: String(row.description ?? ""), folder: String(row.folder ?? ""), status: String(row.status ?? "draft"), shares: (row.shares as Share[]) ?? [] });
      return;
    }
    const fromQ = params.get("spec");
    if (fromQ) {
      try {
        setSpec(JSON.parse(fromQ) as ReportSpec);
        setInfo((i) => ({ ...i, name: params.get("name") ?? "" }));
        return;
      } catch {
        /* fall through */
      }
    }
    const table = params.get("table") ?? meta.data?.tables[0]?.key;
    const def = table ? schema.def(table) : undefined;
    if (def) setSpec(starterSpec(def));
  }, [spec, schema, isNew, rec.data, params, meta.data]);

  const def = spec && schema ? schema.def(spec.table) : undefined;
  const problem = spec && schema ? specProblem(spec, def, schema.lookup) : null;
  const live = useDebounced(spec, 450);
  const liveProblem = live && schema ? specProblem(live, schema.def(live.table), schema.lookup) : "…";
  const preview = useQuery({
    queryKey: ANALYTICS_KEYS.run(orgId, live),
    queryFn: () => analyticsApi.run(api, live!),
    enabled: !!live && !liveProblem,
    retry: false,
    staleTime: 30_000,
  });
  const canWrite = isNew ? !!meta.data?.can_author : !!rec.data?.meta?.canWrite;

  if (meta.isLoading || !schema || (!isNew && rec.isLoading)) return <Loader />;
  if (!isNew && rec.error) return <EmptyState title="گزارش پیدا نشد" description={errorText(rec.error)} />;
  if (!meta.data?.tables.length) return <EmptyState title="جدولی برای گزارش‌گیری در دسترس شما نیست" />;
  if (!spec) return <Loader />;

  const set = (patch: Partial<ReportSpec>) => {
    setNarrative(null);
    setSpec((s) => (s ? { ...s, ...patch } : s));
  };
  const setViz = (viz: VizType) => set({ viz, measures: VIZ[viz].kind === "records" ? [] : spec.measures.length ? spec.measures : [{ fn: "count" }], dims: VIZ[viz].kind === "records" && viz === "list" ? [] : spec.dims });
  const suggested = suggestViz(
    spec.dims.map((d) => {
      const f = def?.fields.find((x) => x.name === d.field);
      return { type: f?.type ?? "string", bucket: d.bucket ?? null, options: f?.type === "choice" && schema ? (schema.choices[String(f.choices)]?.length ?? (Array.isArray(f.choices) ? f.choices.length : 99)) : undefined };
    }),
    spec.measures.length,
  );

  const onDrill = (keys: KeyValue[]): boolean => {
    const next = nextDrill(spec);
    if (!next || !def || !preview.data) return false;
    const cond = elementCond(spec, preview.data, keys.slice(0, 1), def, { tz: timezone, now: Date.now(), lookup: schema.lookup });
    if (!cond) return false;
    const label = preview.data.rows.find((r) => r.keys[0] === keys[0])?.labels[0] ?? "";
    setTrail((t) => [...t, { spec, label }]);
    setSpec(drillDown(spec, cond, next));
    return true;
  };

  const save = async (copy: boolean) => {
    if (!info.name.trim()) return n.error(new Error("نام گزارش را بنویسید"));
    setSaving(copy ? "copy" : "save");
    try {
      const base = trail.length ? trail[0].spec : spec;
      const data = { name: info.name.trim(), description: info.description || null, folder: info.folder || null, status: info.status, shares: info.shares, spec: normalizeSpec(base) };
      if (isNew || copy) {
        const r = await recordsApi.create(api, "analytics_report", copy ? { ...data, name: `${data.name} (رونوشت)`, shares: [] } : data);
        n.ok("گزارش ذخیره شد");
        navigate(`/${orgId}/analytics/reports/${r.row.id}`, { replace: !copy });
      } else {
        await recordsApi.update(api, "analytics_report", id, data, rec.data?.row.version);
        n.ok("گزارش ذخیره شد");
        await rec.refetch();
      }
      qc.invalidateQueries({ queryKey: ["records", orgId, "list", "analytics_report"] });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(null);
    }
  };

  const more = [
    { key: "xlsx", icon: <Download {...ICON14} />, label: "پروندهٔ اکسل", onClick: () => downloadXlsx(orgId, { spec, title: info.name || "گزارش" }).catch((e) => n.error(e)) },
    { key: "print", icon: <Printer {...ICON14} />, label: "نسخهٔ چاپی", disabled: isNew, onClick: () => navigate(`/${orgId}/analytics/print/report/${id}`) },
    { key: "schedule", icon: <CalendarClock {...ICON14} />, label: "ارسال زمان‌بندی‌شده", disabled: isNew, onClick: () => navigate(`/${orgId}/${newRecordPath("analytics_schedule")}?report_id=${id}&name=${encodeURIComponent(info.name)}`) },
    { key: "json", icon: <FileJson {...ICON14} />, label: "خروجی JSON", disabled: isNew, onClick: () => analyticsApi.exportBundle(api, { reports: [id] }).then((b) => saveJson(info.name || "report", b)).catch((e) => n.error(e)) },
    { key: "copy", icon: <Copy {...ICON14} />, label: "ذخیره به‌عنوان رونوشت", disabled: !meta.data.can_author, onClick: () => save(true) },
    ...(meta.data.can_admin && !isNew
      ? [{ key: "certify", icon: <BadgeCheck {...ICON14} />, label: rec.data?.row.certified ? "برداشتن تأیید" : "تأیید عددها", onClick: () => analyticsApi.certify(api, "analytics_report", id, !rec.data?.row.certified).then(() => rec.refetch()).catch((e) => n.error(e)) }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isNew ? "گزارش تازه" : info.name || "گزارش"}
        back="analytics/reports"
        actions={
          <Space size={8} wrap>
            <Dropdown menu={{ items: more.map(({ onClick, ...m }) => ({ ...m, onClick: () => onClick() })) }} trigger={["click"]}>
              <Button icon={<MoreHorizontal {...ICON14} />} aria-label="کارهای بیشتر" />
            </Dropdown>
            {canWrite ? (
              <Button type="primary" icon={<Save {...ICON14} />} loading={saving === "save"} disabled={!!problem} onClick={() => save(false)}>
                ذخیره
              </Button>
            ) : null}
          </Space>
        }
      />
      <div className="an-designer">
        <aside className="an-panel" aria-label="تعریف گزارش">
          <Section title="نام و اشتراک">
            <Input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} placeholder="نام گزارش" maxLength={150} aria-label="نام گزارش" disabled={!canWrite} />
            <div className="an-row">
              <Input value={info.folder} onChange={(e) => setInfo({ ...info, folder: e.target.value })} placeholder="پوشه" maxLength={80} aria-label="پوشه" disabled={!canWrite} />
              <Select value={info.status} onChange={(v) => setInfo({ ...info, status: v })} options={ANALYTICS_STATUS.map((o) => ({ value: o.value, label: o.label }))} aria-label="وضعیت" disabled={!canWrite} style={{ minWidth: 120 }} />
            </div>
            <Input.TextArea value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} placeholder="شرح (برای چه کسی و چه تصمیمی)" autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} aria-label="شرح" disabled={!canWrite} />
            <ShareEditor value={info.shares} onChange={(shares) => setInfo({ ...info, shares })} disabled={!canWrite || (!isNew && rec.data?.row.owner_id !== userId && !meta.data.can_admin)} />
          </Section>
          <SourceSection spec={spec} tables={meta.data.tables} schema={schema} onChange={(table) => {
            const d = schema.def(table);
            if (d) {
              setTrail([]);
              setSpec({ ...starterSpec(d), viz: spec.viz === "list" ? "list" : starterSpec(d).viz });
            }
          }} onSearch={(q) => set({ q: q || null })} />
          {def ? (
            <>
              {VIZ[spec.viz].kind === "records" ? null : <MeasuresSection spec={spec} def={def} schema={schema} onChange={(measures) => set({ measures })} />}
              {spec.viz === "list" ? null : <DimsSection spec={spec} def={def} onChange={(dims) => set({ dims })} onDrill={(drill) => set({ options: { ...(spec.options ?? {}), drill } })} />}
              <Section title="شرط‌ها">
                <FilterBuilder def={def} schema={schema} value={spec.filter ?? null} onChange={(filter: Cond | null) => set({ filter })} tz={timezone} />
              </Section>
              <TimeSection spec={spec} def={def} onChange={(time, compare) => set({ time, compare })} />
              <DisplaySection spec={spec} def={def} onChange={set} />
            </>
          ) : null}
        </aside>
        <main className="flex min-w-0 flex-col gap-3">
          <Gallery spec={spec} suggested={suggested} onPick={setViz} />
          <Card
            title={
              trail.length ? (
                <nav className="an-crumbs" aria-label="مسیر ریزکاوی">
                  <button type="button" className="ds-link" onClick={() => { setSpec(trail[0].spec); setTrail([]); }}>همه</button>
                  {trail.map((t, i) => (
                    <span key={i} className="an-crumb">
                      <ChevronLeft {...ICON14} aria-hidden />
                      {i < trail.length - 1 ? <button type="button" className="ds-link" onClick={() => { setSpec(trail[i + 1].spec); setTrail(trail.slice(0, i + 1)); }}>{t.label}</button> : <span>{t.label}</span>}
                    </span>
                  ))}
                </nav>
              ) : (
                "پیش‌نمایش زنده"
              )
            }
            tools={
              <Tooltip title="شرح این گزارش از روی عددهای آن">
                <Button size="small" icon={<Sparkles {...ICON14} />} disabled={!preview.data || preview.data.kind === "list"} onClick={() => analyticsApi.narrate(api, { spec, title: info.name || undefined }).then(setNarrative).catch((e) => n.error(e))}>
                  شرح
                </Button>
              </Tooltip>
            }
          >
            {problem ? (
              <Note tone="warning">{problem}</Note>
            ) : preview.isLoading || (preview.isFetching && !preview.data) ? (
              <Loader />
            ) : preview.error ? (
              <Note tone="danger">{errorText(preview.error)}</Note>
            ) : preview.data && live ? (
              <ResultCard spec={live} result={preview.data} height={360} onDrill={onDrill} title={info.name || undefined} />
            ) : null}
            {narrative ? (
              <div className="an-narrative" role="status">
                <p>{narrative.text}</p>
                <span className="an-muted">{narrative.ai ? "ساخته‌شده با هوش مصنوعی — پیش از استفاده بازبینی کنید" : "از روی عددهای همین گزارش، بدون مدل هوش مصنوعی"}</span>
              </div>
            ) : null}
          </Card>
        </main>
      </div>
    </div>
  );
}

function Section({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="an-section">
      <header>
        <h3>{title}</h3>
        {extra}
      </header>
      <div className="an-section-b">{children}</div>
    </section>
  );
}

function SourceSection({ spec, tables, onChange, onSearch }: { spec: ReportSpec; tables: { key: string; plural: string }[]; schema: Schema; onChange: (t: string) => void; onSearch: (q: string) => void }) {
  return (
    <Section title="منبع داده">
      <Select showSearch optionFilterProp="label" value={spec.table} onChange={onChange} options={tables.map((t) => ({ value: t.key, label: t.plural }))} aria-label="جدول" />
      <Input allowClear defaultValue={spec.q ?? ""} placeholder="جست‌وجو در متن رکوردها (اختیاری)" onChange={(e) => onSearch(e.target.value)} aria-label="جست‌وجو" maxLength={200} />
    </Section>
  );
}

function MeasuresSection({ spec, def, schema, onChange }: { spec: ReportSpec; def: TableDef; schema: Schema; onChange: (m: Measure[]) => void }) {
  const [filterOf, setFilterOf] = useState<number | null>(null);
  const update = (i: number, patch: Partial<Measure>) => onChange(spec.measures.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const dates = def.fields.filter((f) => usable(f) && isDate(f));
  return (
    <Section title="سنجه‌ها" extra={spec.measures.length < 6 ? <Button size="small" type="text" icon={<Plus {...ICON14} />} onClick={() => onChange([...spec.measures, { fn: "count" }])} aria-label="افزودن سنجه" /> : null}>
      {spec.measures.map((m, i) => {
        const fields = measureFields(def, m.fn);
        const field = def.fields.find((f) => f.name === m.field);
        return (
          <div key={i} className="an-item">
            <div className="an-row">
              <Select value={m.fn} onChange={(fn: MeasureFn) => update(i, { fn, field: MEASURES[fn].field === "none" ? null : fn === "count" ? null : measureFields(def, fn).some((f) => f.name === m.field) ? m.field : null, from: null })} options={MEASURE_FNS.map((f) => ({ value: f, label: MEASURES[f].label }))} aria-label="سنجه" style={{ minWidth: 110 }} />
              {MEASURES[m.fn].field === "none" ? null : (
                <Select allowClear={m.fn === "count"} showSearch optionFilterProp="label" value={m.field ?? undefined} placeholder={m.fn === "count" ? "همهٔ رکوردها" : "فیلد"} onChange={(v) => update(i, { field: v ?? null, from: null })} options={fields.map((f) => ({ value: f.name, label: f.label }))} aria-label="فیلد سنجه" className="flex-1" />
              )}
              <Button size="small" type="text" icon={<X {...ICON14} />} disabled={spec.measures.length <= 1 && VIZ[spec.viz].measures[0] > 0} onClick={() => onChange(spec.measures.filter((_, j) => j !== i))} aria-label="برداشتن سنجه" />
            </div>
            {field && isDate(field) && !["count", "count_distinct", "min", "max"].includes(m.fn) ? (
              <Select allowClear value={m.from ?? undefined} placeholder="زمان از …" onChange={(v) => update(i, { from: v ?? null })} options={dates.filter((f) => f.name !== field.name).map((f) => ({ value: f.name, label: `از ${f.label}` }))} aria-label="آغاز بازهٔ زمانی سنجه" />
            ) : null}
            <div className="an-row">
              <Input size="small" value={m.label ?? ""} onChange={(e) => update(i, { label: e.target.value || null })} placeholder="برچسب (اختیاری)" maxLength={80} aria-label="برچسب سنجه" />
              {m.fn === "count" || m.fn === "ratio" ? (
                <Button size="small" icon={<Filter {...ICON14} />} type={m.filter ? "primary" : "default"} ghost={!!m.filter} onClick={() => setFilterOf(i)}>
                  {m.fn === "ratio" ? "موردها" : "شرط"}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
      <Modal open={filterOf !== null} title={filterOf !== null && spec.measures[filterOf]?.fn === "ratio" ? "کدام رکوردها شمرده شوند؟" : "شرط این سنجه"} onCancel={() => setFilterOf(null)} footer={null} destroyOnHidden width={720}>
        {filterOf !== null ? <FilterBuilder def={def} schema={schema} value={spec.measures[filterOf]?.filter ?? null} onChange={(c) => update(filterOf, { filter: c })} /> : null}
      </Modal>
    </Section>
  );
}

function DimsSection({ spec, def, onChange, onDrill }: { spec: ReportSpec; def: TableDef; onChange: (d: Dimension[]) => void; onDrill: (drill: string[]) => void }) {
  const fields = def.fields.filter((f) => usable(f) && groupable(f));
  const update = (i: number, patch: Partial<Dimension>) => onChange(spec.dims.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const max = Math.min(3, VIZ[spec.viz].dims[1] || 3);
  return (
    <Section title="بُعدها" extra={spec.dims.length < 3 ? <Button size="small" type="text" icon={<Plus {...ICON14} />} onClick={() => onChange([...spec.dims, { field: fields[0]?.name ?? "" }])} aria-label="افزودن بُعد" /> : null}>
      {spec.dims.length > max ? <Note tone="warning">«{VIZ[spec.viz].label}» {faDigits(max)} بُعد می‌گیرد</Note> : null}
      {spec.dims.map((d, i) => {
        const f = def.fields.find((x) => x.name === d.field);
        return (
          <div key={i} className="an-item">
            <div className="an-row">
              <Select showSearch optionFilterProp="label" value={d.field} onChange={(field) => update(i, { field, bucket: null, ranges: null })} options={fields.map((x) => ({ value: x.name, label: x.label }))} aria-label="فیلد بُعد" className="flex-1" />
              <Button size="small" type="text" icon={<X {...ICON14} />} onClick={() => onChange(spec.dims.filter((_, j) => j !== i))} aria-label="برداشتن بُعد" />
            </div>
            {f && isDate(f) ? (
              <div className="an-row">
                <Select value={d.ranges?.length ? "_ranges" : (d.bucket ?? "day")} onChange={(v: string) => update(i, v === "_ranges" ? { bucket: null, ranges: [1, 3, 7, 30] } : { bucket: v as DimBucket, ranges: null })} options={[...Object.entries(BUCKETS).filter(([k]) => f.type === "datetime" || !["hour", "hour_of_day"].includes(k)).map(([v, l]) => ({ value: v, label: l })), { value: "_ranges", label: "سن (روز)" }]} aria-label="دسته‌بندی زمانی" className="flex-1" />
              </div>
            ) : null}
            {f && (isNumeric(f) || (isDate(f) && d.ranges?.length)) ? (
              <Input size="small" defaultValue={(d.ranges ?? []).join("، ")} placeholder={isDate(f) ? "مرزهای سن به روز: ۱، ۳، ۷، ۳۰" : "مرزهای بازه، مانند ۱۰، ۵۰، ۱۰۰"} aria-label="مرزهای بازه" onBlur={(e) => {
                const xs = e.target.value.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).split(/[,،\s]+/).map(Number).filter((x) => Number.isFinite(x));
                update(i, { ranges: xs.length ? [...new Set(xs)].sort((a, b) => a - b) : null, bucket: null });
              }} />
            ) : null}
          </div>
        );
      })}
      {spec.dims.length ? (
        <Select mode="multiple" allowClear value={spec.options?.drill ?? []} onChange={onDrill} options={fields.map((x) => ({ value: x.name, label: x.label }))} placeholder="مسیر ریزکاوی (با کلیک روی نمودار)" aria-label="مسیر ریزکاوی" maxCount={4} />
      ) : null}
    </Section>
  );
}

function TimeSection({ spec, def, onChange }: { spec: ReportSpec; def: TableDef; onChange: (t: ReportSpec["time"], compare: boolean) => void }) {
  const dates = def.fields.filter((f) => usable(f) && isDate(f));
  const t = spec.time;
  const preset = t?.window ? (TIME_PRESETS.find((p) => p.window.unit === t.window!.unit && p.window.from === t.window!.from && p.window.to === t.window!.to)?.key ?? "_custom_w") : t?.from ? "_fixed" : "";
  return (
    <Section title="بازهٔ زمانی">
      <Select allowClear value={t?.field ?? undefined} placeholder="همهٔ زمان‌ها" onChange={(field) => onChange(field ? { field, window: t?.window ?? TIME_PRESETS[2].window } : null, false)} options={dates.map((f) => ({ value: f.name, label: f.label }))} aria-label="فیلد زمان" />
      {t?.field ? (
        <>
          <Select value={preset} onChange={(k: string) => {
            if (k === "_fixed") onChange({ field: t.field, from: t.from ?? null, to: t.to ?? null, window: null }, !!spec.compare);
            else {
              const p = TIME_PRESETS.find((x) => x.key === k);
              if (p) onChange({ field: t.field, window: p.window }, !!spec.compare);
            }
          }} options={[...TIME_PRESETS.map((p) => ({ value: p.key, label: p.label })), ...(preset === "_custom_w" ? [{ value: "_custom_w", label: windowLabel(t.window) }] : []), { value: "_fixed", label: "بازهٔ دلخواه…" }]} aria-label="بازه" />
          {preset === "_fixed" ? (
            <div className="an-row">
              <DateInput value={t.from ?? null} onChange={(v) => onChange({ ...t, from: v ?? null, window: null }, !!spec.compare)} placeholder="از" />
              <DateInput value={t.to ?? null} onChange={(v) => onChange({ ...t, to: v ?? null, window: null }, !!spec.compare)} placeholder="تا" />
            </div>
          ) : null}
          <label className="an-switch">
            <Switch size="small" checked={!!spec.compare} onChange={(c) => onChange(t, c)} />
            مقایسه با دورهٔ پیش
          </label>
          <div className="an-muted">دوره‌ها در تقویم جلالی؛ هفته از شنبه. واحدها: {Object.values(DATE_UNITS).join("، ")}</div>
        </>
      ) : null}
    </Section>
  );
}

function DisplaySection({ spec, def, onChange }: { spec: ReportSpec; def: TableDef; onChange: (p: Partial<ReportSpec>) => void }) {
  const o = spec.options ?? {};
  const opt = (patch: Partial<NonNullable<ReportSpec["options"]>>) => onChange({ options: { ...o, ...patch } });
  const kind = VIZ[spec.viz].kind;
  const cartesian = ["column", "bar", "line", "area"].includes(spec.viz);
  return (
    <Section title="نمایش">
      {kind === "records" ? (
        <>
          <Select mode="multiple" value={spec.columns ?? def.list?.columns ?? []} onChange={(columns) => onChange({ columns })} options={def.fields.filter((f) => usable(f)).map((f) => ({ value: f.name, label: f.label }))} placeholder="ستون‌ها" aria-label="ستون‌ها" maxCount={12} />
          <div className="an-row">
            <Select value={(o.order ?? def.list?.order ?? "-updated_at").replace(/^-/, "")} onChange={(v) => opt({ order: `${(o.order ?? "").startsWith("-") ? "-" : ""}${v}` })} options={def.fields.filter((f) => usable(f) && groupable(f)).map((f) => ({ value: f.name, label: `مرتب‌سازی: ${f.label}` }))} aria-label="مرتب‌سازی" className="flex-1" />
            <Select value={(o.order ?? def.list?.order ?? "-").startsWith("-") ? "desc" : "asc"} onChange={(d) => opt({ order: `${d === "desc" ? "-" : ""}${(o.order ?? def.list?.order ?? "updated_at").replace(/^-/, "")}` })} options={[{ value: "desc", label: "نزولی" }, { value: "asc", label: "صعودی" }]} aria-label="جهت" />
          </div>
          <InputNumber min={1} max={200} value={o.size ?? 50} onChange={(v) => opt({ size: Number(v) || 50 })} addonBefore="تعداد" aria-label="تعداد رکوردها" />
        </>
      ) : (
        <>
          {spec.dims.length ? (
            <div className="an-row">
              <Select value={spec.sort?.by ?? "value"} onChange={(by) => onChange({ sort: { by, dir: spec.sort?.dir ?? "desc" } })} options={[{ value: "value", label: "بر پایهٔ مقدار" }, { value: "key", label: "بر پایهٔ گروه" }]} aria-label="مرتب‌سازی" className="flex-1" />
              <Select value={spec.sort?.dir ?? "desc"} onChange={(dir) => onChange({ sort: { by: spec.sort?.by ?? "value", dir } })} options={[{ value: "desc", label: "نزولی" }, { value: "asc", label: "صعودی" }]} aria-label="جهت" />
            </div>
          ) : null}
          {spec.dims.length === 1 ? (
            <div className="an-row">
              <InputNumber min={1} max={500} value={spec.limit ?? undefined} onChange={(v) => onChange({ limit: v ? Number(v) : null })} placeholder="همه" addonBefore="گروه‌های برتر" aria-label="تعداد گروه‌های برتر" />
              <label className="an-switch">
                <Switch size="small" checked={!!spec.other} disabled={!spec.limit} onChange={(c) => onChange({ other: c })} />
                بقیه در «سایر»
              </label>
            </div>
          ) : null}
          {cartesian ? (
            <div className="an-toggles">
              <label className="an-switch"><Switch size="small" checked={!!o.stacked} onChange={(c) => opt({ stacked: c })} />روی هم</label>
              <label className="an-switch"><Switch size="small" checked={!!o.percent} onChange={(c) => opt({ percent: c })} />۱۰۰٪</label>
              <label className="an-switch"><Switch size="small" checked={!!o.labels} onChange={(c) => opt({ labels: c })} />برچسب مقدار</label>
            </div>
          ) : null}
          {spec.viz === "gauge" || spec.viz === "score" ? (
            <div className="an-row">
              <InputNumber value={o.target ?? undefined} onChange={(v) => opt({ target: v === null ? null : Number(v) })} placeholder="هدف" aria-label="هدف" />
              {spec.viz === "gauge" ? <InputNumber value={o.max ?? undefined} onChange={(v) => opt({ max: v === null ? null : Number(v) })} placeholder="بیشینه" aria-label="بیشینهٔ مقیاس" /> : null}
            </div>
          ) : null}
          <InputNumber min={0} max={4} value={o.decimals ?? undefined} onChange={(v) => opt({ decimals: v === null ? null : Number(v) })} addonBefore="رقم اعشار" placeholder="خودکار" aria-label="رقم اعشار" />
        </>
      )}
    </Section>
  );
}

/** The chart gallery: every visualization, those that do not fit greyed out with the reason, the suggestion marked. */
function Gallery({ spec, suggested, onPick }: { spec: ReportSpec; suggested: VizType; onPick: (v: VizType) => void }) {
  return (
    <div className="an-gallery" role="radiogroup" aria-label="نوع نمایش">
      {VIZ_TYPES.map((v) => {
        const Icon = VIZ_ICONS[v];
        const why = VIZ[v].kind === "records" ? null : vizFits(v, spec.dims.length, spec.measures.length);
        return (
          <Tooltip key={v} title={why ? `${VIZ[v].hint} — ${why}` : VIZ[v].hint}>
            <button type="button" role="radio" aria-checked={spec.viz === v} className={cx("an-viz", spec.viz === v && "is-on", why && "is-off", suggested === v && "is-suggested")} onClick={() => onPick(v)}>
              <Icon size={18} strokeWidth={1.4} aria-hidden />
              <span>{VIZ[v].label}</span>
              {suggested === v && spec.viz !== v ? <i className="an-viz-hint">پیشنهاد</i> : null}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

