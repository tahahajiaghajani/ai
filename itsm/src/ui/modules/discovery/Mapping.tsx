// «نگاشت» (design A §6.3, §15): which field of the record each path of the tool fills. On the left a sample — the
// tool's own element for the REST kind (from a preview; tenant administrators only, as the server sends it), the
// kind's record of the latest item for the others; on the right the map, one line per field. What the sample gives
// with this map shows as it is typed, and «پیش‌نمایش با این نگاشت» asks the engine what it would do with the tool's
// first page (a dry run, nothing saved). Fields people or ITAM own are refused with the reason. The map is a draft
// until «ذخیره»; leaving the tab or the page with it unsaved asks first. CMDB administrators edit; others read.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AutoComplete, Button, Input, Tooltip } from "antd";
import { Eye, Plus, Trash2 } from "lucide-react";
import { applyRenames, ciValues, recordFromElement } from "@shared/discovery/mapping";
import { normaliseRecord } from "@shared/discovery/normalise";
import type { DiscoveredRecord, KindDescriptor } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { ApiError, errorText } from "../../lib/api";
import { useNotify } from "../../lib/hooks";
import { EmptyState, Skeleton } from "../../components/display";
import { Note } from "../../components/blocks";
import { useSchema } from "../../records/data/hooks";
import type { ConnectorPage, PreviewResult } from "./api";
import { labelOf, mappingChanged, mappingProblems, mappingRows, rowsMapping, TARGET_LABELS, type ItemRow, type MapRow } from "./model";
import { I16, PreviewTable } from "./parts";

let seq = 0;
const blank = (): MapRow => ({ key: `n${++seq}`, target: "", source: "" });
const TARGETS = Object.entries(TARGET_LABELS).map(([value, label]) => ({ value, label: `${label} · ${value}` }));

/** What the sample gives with a map: the record the kind would make, its CI fields and attributes, and why not. */
export function liveRecord(kind: string, sample: unknown, mapping: Record<string, string>) {
  try {
    const raw = kind === "rest" ? recordFromElement(sample, mapping) : applyRenames(sample as DiscoveredRecord, mapping);
    const n = normaliseRecord(raw, { now: new Date() });
    return n.record ? { ...ciValues(n.record), external_id: n.record.external_id, error: null, warnings: n.warnings } : { values: {}, attrs: {}, external_id: null, error: n.error ?? null, warnings: n.warnings };
  } catch {
    return { values: {}, attrs: {}, external_id: null, error: "این نمونه با این نگاشت خوانده نشد", warnings: [] };
  }
}

export function MappingTab({ page, d, onDirty, onSaved }: { page: ConnectorPage; d: KindDescriptor; onDirty: (dirty: boolean) => void; onSaved: () => Promise<unknown> }) {
  const { api } = useOrg();
  const n = useNotify();
  const { schema } = useSchema();
  const stored = (page.row as { mapping?: unknown }).mapping;
  const id = page.row.id;
  const rest = d.kind === "rest";
  const [rows, setRows] = useState<MapRow[]>(() => [...mappingRows(stored), blank()]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const editable = page.can.edit && page.meta?.canWrite !== false && !(page.meta?.readonly ?? []).includes("mapping");
  const dirty = mappingChanged(stored, rows);
  const problems = mappingProblems(rows, rest);
  const blocked = Object.keys(problems.byRow).length > 0 || problems.general.length > 0;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  // «تغییرات ذخیره نشده‌اند» when the page is left with a draft
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // the sample: the latest item's record (built-in kinds; field group internal) or the tool's element from a preview
  const item = useQuery({
    queryKey: ["discovery-items", id, "sample"],
    queryFn: () => api.get<{ rows: ItemRow[] }>(`/discovery/connectors/${id}/items`, { size: 1 }),
    enabled: !rest,
    staleTime: 60_000,
  });
  const [element, setElement] = useState<unknown>(undefined);
  const sample = rest ? element : item.data?.rows[0]?.data ?? undefined;
  const mapping = useMemo(() => rowsMapping(rows), [rows]);
  const live = useMemo(() => (sample === undefined ? null : liveRecord(d.kind, sample, mapping)), [sample, mapping, d.kind]);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const runPreview = async (limit: number) => {
    setPreviewing(true);
    setProblem(null);
    try {
      const r = await api.post<PreviewResult>(`/discovery/connectors/${id}/preview`, { draft: { mapping }, limit });
      if (limit === 1) {
        if (r.rows[0]?.raw !== undefined) setElement(r.rows[0].raw);
        else n.warn("ابزار در صفحهٔ نخست موردی نفرستاد");
      } else setPreview(r);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await api.patch(`/discovery/connectors/${id}`, { mapping, version: page.row.version });
      n.ok("نگاشت ذخیره شد؛ گذر بعدی موارد را با آن دوباره می‌سنجد");
      // the page reads the stored map again: the draft equals it, so nothing is left unsaved
      await onSaved();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const edit = (key: string, patch: Partial<MapRow>) =>
    setRows((xs) => {
      const next = xs.map((r) => (r.key === key ? { ...r, ...patch } : r));
      // a line always waits at the end
      return next[next.length - 1].target || next[next.length - 1].source ? [...next, blank()] : next;
    });
  const remove = (key: string) => setRows((xs) => (xs.length > 1 ? xs.filter((r) => r.key !== key) : [blank()]));
  const targetLabel = (t: string) => TARGET_LABELS[t] ?? (t.startsWith("attrs.") ? `ویژگی کلاس «${t.slice(6)}»` : t);
  const ciLabel = (f: string) => schema?.def("ci")?.fields.find((x) => x.name === f)?.label ?? f;
  const classLabel = (k: string) => labelOf(schema?.choices["ci.class"], k);

  return (
    <div className="flex flex-col gap-4">
      {problem ? <Note tone="danger">{problem}</Note> : null}
      {problems.general.map((m) => (
        <Note key={m} tone="warning">
          {m}
        </Note>
      ))}
      <div className="dsc-map">
        <section className="ds-card dsc-pane" aria-label="نمونه">
          <h3 className="dsc-pane-t">{rest ? "نمونه از ابزار" : "نمونهٔ آخرین مورد"}</h3>
          {sample !== undefined ? (
            <pre dir="ltr" className="dsc-raw" aria-label="دادهٔ نمونه">
              {JSON.stringify(sample, null, 2)}
            </pre>
          ) : rest && page.can.raw ? (
            <EmptyState
              compact
              title="نمونه‌ای خوانده نشده است"
              action={
                <Button loading={previewing} onClick={() => void runPreview(1)}>
                  خواندن یک نمونه از ابزار
                </Button>
              }
            />
          ) : !rest && item.isLoading ? (
            <Skeleton rows={4} />
          ) : (
            <EmptyState compact title={rest ? "دادهٔ خام ابزار را مدیر سازمان می‌بیند" : "هنوز موردی گزارش نشده است"} description={rest ? "«پیش‌نمایش با این نگاشت» نتیجه را نشان می‌دهد." : undefined} />
          )}
        </section>
        <section className="ds-card dsc-pane" aria-label="نگاشت">
          <h3 className="dsc-pane-t">نگاشت</h3>
          <div className="dsc-map-rows" role="table" aria-label="نگاشت">
            <div role="row" className="dsc-map-row dsc-map-head">
              <span role="columnheader">فیلد</span>
              <span role="columnheader">{rest ? "مسیر در پاسخ ابزار" : "مسیر در مورد"}</span>
              <span role="columnheader" className="sr-only">
                حذف
              </span>
            </div>
            {rows.map((r, i) => (
              <div role="row" key={r.key} className="dsc-map-row">
                <span role="cell">
                  <AutoComplete
                    value={r.target}
                    options={TARGETS}
                    disabled={!editable}
                    onChange={(v) => edit(r.key, { target: String(v ?? "") })}
                    filterOption={(text, o) => !text || String(o?.label ?? "").includes(text) || String(o?.value ?? "").includes(text)}
                    placeholder="فیلد یا attrs.…"
                    aria-label={`فیلد ردیف ${i + 1}`}
                    status={problems.byRow[r.key] ? "error" : undefined}
                    className="dsc-ltr-input"
                  />
                </span>
                <span role="cell">
                  <Input
                    value={r.source}
                    disabled={!editable}
                    onChange={(e) => edit(r.key, { source: e.target.value })}
                    placeholder={rest ? "$.serial" : "attrs.location"}
                    aria-label={`مسیر ردیف ${i + 1}`}
                    status={problems.byRow[r.key] ? "error" : undefined}
                    dir="ltr"
                    className="ds-mono"
                  />
                </span>
                <span role="cell">
                  {editable && (r.target || r.source) ? (
                    <Tooltip title="حذف ردیف">
                      <Button type="text" icon={<Trash2 {...I16} />} onClick={() => remove(r.key)} aria-label={`حذف ردیف ${i + 1}`} />
                    </Tooltip>
                  ) : null}
                </span>
                {problems.byRow[r.key] ? (
                  <span className="dsc-map-err" role="alert">
                    {problems.byRow[r.key]}
                  </span>
                ) : r.target && !problems.byRow[r.key] ? (
                  <span className="dsc-sub dsc-map-err">{targetLabel(r.target)}</span>
                ) : null}
              </div>
            ))}
          </div>
          {live ? (
            <div className="dsc-live" aria-live="polite">
              <h4 className="dsc-pane-t">با این نگاشت</h4>
              {live.error ? (
                <Note tone="warning">{live.error}</Note>
              ) : (
                <dl className="dsc-pairs">
                  {Object.entries(live.values).map(([k, v]) => (
                    <div key={k}>
                      <dt>{ciLabel(k)}</dt>
                      <dd>
                        <bdi dir="ltr" className="ds-mono">
                          {String(v)}
                        </bdi>
                      </dd>
                    </div>
                  ))}
                  {Object.entries(live.attrs).map(([k, v]) => (
                    <div key={`a:${k}`}>
                      <dt>{`ویژگی «${k}»`}</dt>
                      <dd>
                        <bdi dir="ltr" className="ds-mono">
                          {String(v)}
                        </bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {live.warnings.length ? (
                <ul className="dsc-list">
                  {live.warnings.slice(0, 5).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
      <div className="dsc-step-f">
        {page.can.preview && d.kind !== "push" ? (
          <Button icon={<Eye {...I16} />} loading={previewing} disabled={blocked} onClick={() => void runPreview(20)}>
            پیش‌نمایش با این نگاشت
          </Button>
        ) : null}
        {editable ? (
          <>
            <Button icon={<Plus {...I16} />} onClick={() => setRows((xs) => [...xs, blank()])}>
              ردیف تازه
            </Button>
            <Button onClick={() => setRows([...mappingRows(stored), blank()])} disabled={!dirty || saving}>
              انصراف
            </Button>
            <Button type="primary" loading={saving} disabled={!dirty || blocked} onClick={() => void save()}>
              ذخیره
            </Button>
          </>
        ) : null}
      </div>
      {preview ? <PreviewTable result={preview} label={ciLabel} classLabel={classLabel} /> : null}
    </div>
  );
}
