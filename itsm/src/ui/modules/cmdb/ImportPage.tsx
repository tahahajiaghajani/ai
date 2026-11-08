// «ورود داده به پایگاه پیکربندی» (catalogue CMDB-022/023/026): an Excel, CSV or JSON file (an array, or one at a path
// such as `data.items`) is read in the browser, its columns are matched to CI fields, class attributes, the class or
// relationships («rel:runs_on:hostname» links each row to the CI with that host name), then the whole file is checked
// through the reconciliation engine without saving (what would be created, updated, left unchanged, flagged as a
// duplicate or refused), and imported in batches as one import run with the chosen source's authority — so a more
// trusted source's values and locked attributes are kept, and possible duplicates become review tasks.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Input, Progress, Select, Space, Table, Upload } from "antd";
import { Check, FileUp, ListChecks, RotateCcw } from "lucide-react";
import type { IreItemResult, IreResult } from "@shared/cmdb/api";
import { flatten, jsonArrayAt } from "@shared/cmdb/logic";
import { readSpreadsheet } from "@shared/sheet";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState } from "../../components/display";
import { recordsApi } from "../../records/data/api";
import { cmdbApi, CMDB_KEYS } from "./api";
import { batches, guessMapping, mappingProblems, type ImportTarget } from "./model";
import { useCmdbRefresh } from "./CiParts";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

const CI_FIELDS: [string, string][] = [
  ["name", "نام"], ["description", "شرح"], ["environment", "محیط"], ["criticality", "اهمیت"], ["operational_status", "وضعیت عملیاتی"],
  ["serial_number", "شمارهٔ سریال"], ["asset_tag", "برچسب دارایی"], ["manufacturer", "سازنده"], ["model_name", "مدل"],
  ["hostname", "نام میزبان"], ["fqdn", "نام کامل دامنه (FQDN)"], ["ip_address", "نشانی IP"], ["mac_address", "نشانی MAC"], ["bios_uuid", "شناسهٔ BIOS"],
  ["cloud_resource_id", "شناسهٔ منبع ابری"], ["os", "سیستم‌عامل"], ["os_version", "نسخهٔ سیستم‌عامل"], ["sw_version", "نسخهٔ نرم‌افزار"],
  ["cpu_count", "تعداد پردازنده"], ["ram_mb", "حافظه (مگابایت)"], ["disk_gb", "دیسک (گیگابایت)"], ["url", "نشانی وب"], ["expires_at", "تاریخ انقضا"], ["eol_date", "پایان پشتیبانی"], ["tags", "برچسب‌ها"],
];

const ACTION: Record<IreItemResult["action"], [string, "in" | "neutral" | "warning" | "danger"]> = {
  created: ["ساخته می‌شود", "in"],
  updated: ["به‌روز می‌شود", "neutral"],
  unchanged: ["بی‌تغییر", "neutral"],
  duplicate: ["تکراری محتمل", "warning"],
  skipped: ["رد شد", "warning"],
  error: ["خطا", "danger"],
};

interface FileData {
  name: string;
  header: string[];
  rows: Record<string, unknown>[];
}

export default function ImportPage() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const refresh = useCmdbRefresh();
  const [file, setFile] = useState<FileData | null>(null);
  const [jsonPath, setJsonPath] = useState("");
  const [raw, setRaw] = useState<{ name: string; doc: unknown } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [cls, setCls] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [check, setCheck] = useState<IreResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; result: IreResult | null; runId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const classes = useQuery({ queryKey: CMDB_KEYS.classes(orgId), queryFn: () => cmdbApi.classes(api), staleTime: 300_000 });
  const sources = useQuery({ queryKey: ["cmdb", orgId, "sources"], queryFn: () => recordsApi.list(api, "cmdb_data_source", { size: 100, fields: ["name", "kind", "priority"], total: false }), staleTime: 300_000 });
  const clsInfo = classes.data?.classes.find((c) => c.key === cls);
  const targets = useMemo<ImportTarget[]>(() => {
    const out: ImportTarget[] = [{ value: "class", label: "کلاس", group: "special" }, ...CI_FIELDS.map(([value, label]) => ({ value, label, group: "field" as const }))];
    for (const a of clsInfo?.all_attrs ?? []) if (!a.archived) out.push({ value: `attrs.${a.name}`, label: `${a.label} (ویژگی کلاس)`, group: "attr" });
    for (const t of classes.data?.types ?? []) out.push({ value: `rel:${t.key}:hostname`, label: `رابطه: ${t.label} ← نام میزبان`, group: "special" }, { value: `rel:${t.key}:name`, label: `رابطه: ${t.label} ← نام`, group: "special" });
    return out;
  }, [clsInfo, classes.data]);

  const fromJson = (doc: unknown, name: string, path: string) => {
    const rows = jsonArrayAt(doc, path || null).map((r) => flatten(r));
    if (!rows.length) throw new Error(path ? `در مسیر «${path}» آرایه‌ای پیدا نشد` : "فایل آرایه‌ای از رکوردها نیست؛ مسیر آرایه را بنویسید");
    const header = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 80);
    return { name, header, rows };
  };
  const load = async (f: File) => {
    try {
      let data: FileData;
      if (f.name.toLowerCase().endsWith(".json")) {
        const doc = JSON.parse(await f.text());
        setRaw({ name: f.name, doc });
        data = fromJson(doc, f.name, jsonPath);
      } else {
        setRaw(null);
        const { rows } = await readSpreadsheet(f.name, await f.arrayBuffer());
        const headerRow = rows.findIndex((r) => r.some(Boolean));
        if (headerRow < 0 || rows.length <= headerRow + 1) throw new Error("فایل ردیفی برای ورود ندارد؛ ردیف اول عنوان ستون‌ها و بقیه داده‌ها باشند");
        const width = Math.max(...rows.map((r) => r.length));
        const header = Array.from({ length: width }, (_, i) => rows[headerRow][i] || `ستون ${faDigits(i + 1)}`);
        data = { name: f.name, header, rows: rows.slice(headerRow + 1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))) };
      }
      setFile(data);
      setMapping(guessMapping(data.header, targets));
      setCheck(null);
      setProgress(null);
    } catch (e) {
      message.error((e as Error).message);
    }
    return false;
  };
  const reparse = () => {
    if (!raw) return;
    try {
      const data = fromJson(raw.doc, raw.name, jsonPath);
      setFile(data);
      setMapping(guessMapping(data.header, targets));
      setCheck(null);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const problems = file ? mappingProblems(mapping, cls) : [];
  const runCheck = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const run = await cmdbApi.startRun(api, { name: `بررسی ${file.name}`, source_id: source, class: cls, file_name: file.name, dry_run: true });
      let total: IreResult | null = null;
      for (const b of batches(file.rows.slice(0, 2000), 500)) {
        const r = await cmdbApi.batch(api, run.run.id, { rows: b, mapping, default_class: cls, dry_run: true });
        total = total ? merge(total, r) : r;
      }
      await cmdbApi.finishRun(api, run.run.id).catch(() => undefined);
      setCheck(total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    const all = batches(file.rows, 200);
    let runId: string | null = null;
    try {
      const run = await cmdbApi.startRun(api, { name: `ورود ${file.name}`, source_id: source, class: cls, file_name: file.name });
      runId = run.run.id;
      let total: IreResult | null = null;
      setProgress({ done: 0, total: file.rows.length, result: null, runId });
      let done = 0;
      for (const b of all) {
        const r = await cmdbApi.batch(api, runId, { rows: b, mapping, default_class: cls });
        total = total ? merge(total, r) : r;
        done += b.length;
        setProgress({ done, total: file.rows.length, result: total, runId });
      }
      await cmdbApi.finishRun(api, runId);
      message.success("ورود داده انجام شد");
      refresh();
    } catch (e) {
      if (runId) await cmdbApi.finishRun(api, runId, (e as Error).message).catch(() => undefined);
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setFile(null);
    setRaw(null);
    setCheck(null);
    setProgress(null);
  };
  const result = progress?.result ?? check;
  return (
    <div>
      <PageHeader title="ورود داده به پایگاه پیکربندی" actions={file ? <Button icon={<RotateCcw {...ICON} />} onClick={reset}>فایل دیگر</Button> : undefined} />
      {!file ? (
        <Card>
          <Upload.Dragger accept=".xlsx,.csv,.txt,.json" showUploadList={false} beforeUpload={load} multiple={false}>
            <div className="flex flex-col items-center gap-2 py-6">
              <FileUp size={28} strokeWidth={1.2} absoluteStrokeWidth className="text-ink-3" />
              <span className="text-[14px] text-ink">فایل اکسل، CSV یا JSON را این‌جا رها کنید یا برای انتخاب بزنید</span>
              <span className="text-[12.5px] text-ink-3">ردیف اول عنوان ستون‌ها باشد؛ در JSON آرایه‌ای از رکوردها (مسیر آن را پس از بارگذاری می‌توانید بنویسید).</span>
            </div>
          </Upload.Dragger>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <Card title={`${file.name} — ${fa(file.rows.length)} ردیف`}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-ink-2">کلاس پیش‌فرض</span>
                <Select showSearch={{ optionFilterProp: "label" }} allowClear value={cls ?? undefined} onChange={(v) => setCls(v ?? null)} options={(classes.data?.classes ?? []).filter((c) => !c.abstract && !c.create_disabled).map((c) => ({ value: c.key, label: c.label }))} placeholder="مثلاً سرور" aria-label="کلاس پیش‌فرض" />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-ink-2">منبع داده (اعتبار و اولویت)</span>
                <Select allowClear value={source ?? undefined} onChange={(v) => setSource(v ?? null)} options={(sources.data?.rows ?? []).map((s) => ({ value: String(s.id), label: String(s.name) }))} placeholder="ورود از فایل" aria-label="منبع داده" />
              </label>
              {raw ? (
                <label className="flex flex-col gap-1 text-[13px]">
                  <span className="text-ink-2">مسیر آرایه در JSON</span>
                  <Space.Compact>
                    <Input dir="ltr" value={jsonPath} onChange={(e) => setJsonPath(e.target.value)} placeholder="data.items" onPressEnter={reparse} />
                    <Button onClick={reparse}>خواندن</Button>
                  </Space.Compact>
                </label>
              ) : null}
            </div>
          </Card>
          <Card title="جور کردن ستون‌ها" flush>
            <Table
              rowKey="col"
              size="small"
              pagination={false}
              scroll={{ x: 640 }}
              dataSource={file.header.map((col) => ({ col, sample: file.rows.slice(0, 3).map((r) => String(r[col] ?? "")).filter(Boolean).join("، ") }))}
              columns={[
                { title: "ستون فایل", dataIndex: "col", key: "col", width: 200 },
                { title: "نمونه", dataIndex: "sample", key: "s", render: (v: string) => <span className="text-ink-3">{faDigits(v).slice(0, 80)}</span> },
                {
                  title: "فیلد پیکربندی", key: "t", width: 280,
                  render: (_: unknown, r: { col: string }) => (
                    <Select
                      showSearch={{ optionFilterProp: "label" }}
                      allowClear
                      value={mapping[r.col] || undefined}
                      onChange={(v) => setMapping((m) => ({ ...m, [r.col]: v ?? "" }))}
                      placeholder="وارد نشود"
                      style={{ width: "100%" }}
                      aria-label={`فیلد ستون ${r.col}`}
                      options={[
                        { label: "فیلدها", options: targets.filter((t) => t.group === "field").map((t) => ({ value: t.value, label: t.label })) },
                        { label: "ویژگی‌های کلاس", options: targets.filter((t) => t.group === "attr").map((t) => ({ value: t.value, label: t.label })) },
                        { label: "کلاس و رابطه‌ها", options: targets.filter((t) => t.group === "special").map((t) => ({ value: t.value, label: t.label })) },
                      ].filter((g) => g.options.length)}
                    />
                  ),
                },
              ]}
            />
          </Card>
          {problems.length ? <Note tone="warning">{problems.join("؛ ")}</Note> : null}
          <Space wrap>
            <Button icon={<ListChecks {...ICON} />} onClick={runCheck} loading={busy && !progress} disabled={!!problems.length || busy}>بررسی بدون ذخیره</Button>
            <Button type="primary" icon={<Check {...ICON} />} onClick={runImport} loading={busy && !!progress} disabled={!!problems.length || busy || !check}>ورود {fa(file.rows.length)} ردیف</Button>
            {!check ? <span className="text-[12.5px] text-ink-3">پیش از ورود، فایل را بررسی کنید.</span> : null}
          </Space>
          {progress ? <Progress percent={Math.round((progress.done / Math.max(1, progress.total)) * 100)} status={busy ? "active" : "success"} format={(p) => `${faDigits(p ?? 0)}٪`} /> : null}
          {result ? <ResultView r={result} dry={!progress} runId={progress?.runId ?? null} orgId={orgId} /> : null}
        </div>
      )}
    </div>
  );
}

function merge(a: IreResult, b: IreResult): IreResult {
  const offset = a.results.length;
  return {
    results: [...a.results, ...b.results.map((r) => ({ ...r, index: r.index + offset }))],
    created: a.created + b.created, updated: a.updated + b.updated, unchanged: a.unchanged + b.unchanged, duplicates: a.duplicates + b.duplicates, failed: a.failed + b.failed,
    relations: { created: a.relations.created + b.relations.created, refreshed: a.relations.refreshed + b.relations.refreshed, failed: a.relations.failed + b.relations.failed },
    dry_run: a.dry_run && b.dry_run, run_id: a.run_id ?? b.run_id ?? null,
  };
}

function ResultView({ r, dry, runId, orgId }: { r: IreResult; dry: boolean; runId: string | null; orgId: string }) {
  const issues = r.results.filter((x) => x.action !== "unchanged" && x.action !== "updated" && x.action !== "created");
  return (
    <Card title={dry ? "نتیجهٔ بررسی (چیزی ذخیره نشد)" : "نتیجهٔ ورود"} meta={runId ? <Link className="ds-link" to={`/${orgId}/cmdb/import-runs/${runId}`}>اجرای ورود</Link> : undefined}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Chip tone="in" fig>{`${fa(r.created)} تازه`}</Chip>
        <Chip tone="neutral" fig>{`${fa(r.updated)} به‌روزرسانی`}</Chip>
        <Chip tone="neutral" fig>{`${fa(r.unchanged)} بی‌تغییر`}</Chip>
        {r.duplicates ? <Chip tone="warning" fig>{`${fa(r.duplicates)} تکراری محتمل`}</Chip> : null}
        {r.failed ? <Chip tone="danger" fig>{`${fa(r.failed)} ناموفق`}</Chip> : null}
        {r.relations.created || r.relations.refreshed ? <Chip tone="neutral" fig>{`${fa(r.relations.created + r.relations.refreshed)} رابطه`}</Chip> : null}
      </div>
      {issues.length ? (
        <Table
          rowKey="index"
          size="small"
          pagination={issues.length > 20 ? { pageSize: 20 } : false}
          dataSource={issues}
          columns={[
            { title: "ردیف", dataIndex: "index", key: "i", width: 70, render: (v: number) => <span className="ds-num">{fa(v + 1)}</span> },
            { title: "نام", dataIndex: "name", key: "n", render: (v: string | null) => v ?? "—" },
            { title: "نتیجه", dataIndex: "action", key: "a", width: 140, render: (v: IreItemResult["action"]) => <Chip tone={ACTION[v][1]}>{ACTION[v][0]}</Chip> },
            { title: "توضیح", dataIndex: "message", key: "m", render: (v: string | null, x: IreItemResult) => v ?? (x.skipped?.length ? `حفظ‌شده: ${x.skipped.join("، ")}` : x.matched_by ?? "—") },
          ]}
        />
      ) : (
        <EmptyState compact title="همهٔ ردیف‌ها بی‌مشکل‌اند" />
      )}
    </Card>
  );
}
