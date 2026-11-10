// «ورود از اکسل»: read an .xlsx/.csv file in the browser, map its columns to fields, check everything on the server
// without saving, then import in batches. `ImportSheet` works on any target (an `ImportTarget`: its fields and how a
// batch is sent); `ImportDrawer` is the master-data entities' target (@shared/entities, /data/:entity/import) and the
// record engine's tables use `ImportSheet` with POST /r/:table/import (src/ui/records/list/ImportRecords.tsx).
import "./kit.css";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Drawer, Progress, Select, Table, Upload } from "antd";
import { Check, Download, FileSpreadsheet, FileUp, RotateCcw, ListChecks } from "lucide-react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { importFields, type EntityDef } from "@shared/entities";
import { readSpreadsheet } from "@shared/sheet";
import { faDigits } from "@shared/format";
import { normalizeDigits } from "@shared/money";
import { useOrg } from "../lib/org";
import { useNotify } from "../lib/hooks";
import { exportExcel } from "../lib/excel";

const BATCH = 200;
const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const SHEET_W = 880;

/** The three steps, the current one in ink (a quiet progress line, not a wizard). */
function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ["انتخاب فایل", "جور کردن ستون‌ها", "بررسی و ورود"];
  return (
    <div className="ds-steps" aria-label={`مرحله‌ی ${faDigits(step)} از ۳`}>
      {items.map((t, i) => (
        <span key={t} className="contents">
          {i ? <hr aria-hidden /> : null}
          <b className={i + 1 <= step ? "is-on" : undefined}>{i + 1 < step ? <Check size={12} strokeWidth={2} absoluteStrokeWidth /> : faDigits(i + 1)}</b>
          <span className={i + 1 === step ? "is-on" : undefined}>{t}</span>
        </span>
      ))}
    </div>
  );
}

export interface ImportResultRow {
  row: number;
  ok: boolean;
  action?: "create" | "update";
  label?: string;
  error?: string;
}

interface Summary {
  created: number;
  updated: number;
  failed: number;
  dry: boolean;
  errors: ImportResultRow[];
}

/** A field a file column can be mapped to. */
export interface ImportField {
  name: string;
  label: string;
  /** must be mapped (no default fills it) */
  required?: boolean;
}

/** What an import sheet imports into. */
export interface ImportTarget {
  /** «کارها»: the sheet's title and the names of the sample and error files */
  plural: string;
  fields: ImportField[];
  /** the label of «update rows that already exist» (null: the target only creates) */
  updateLabel?: string | null;
  /** sends one batch (rows keyed by field name; `offset` = index of its first row in the file) */
  run: (rows: Record<string, string>[], o: { dry: boolean; update: boolean; offset: number }) => Promise<{ results: ImportResultRow[]; created: number; updated: number; failed: number }>;
  /** queries to refresh after an import */
  invalidate?: QueryKey[];
  /** rows per request (default 200) */
  batch?: number;
}

const norm = (s: string) =>
  normalizeDigits(s)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌\s_\-–—/\\.:()*]+/g, "")
    .toLowerCase();

/** Guess which field each column is for: exact label or name first, then a label that contains it. */
export function guessMapping(header: string[], fields: ImportField[]): (string | null)[] {
  const used = new Set<string>();
  const pick = (h: string, test: (f: ImportField, nh: string) => boolean) => {
    const nh = norm(h);
    if (!nh) return null;
    const f = fields.find((x) => !used.has(x.name) && test(x, nh));
    if (f) used.add(f.name);
    return f?.name ?? null;
  };
  const out: (string | null)[] = header.map((h) => pick(h, (f, nh) => norm(f.label) === nh || norm(f.name) === nh));
  return out.map((v, i) => v ?? pick(header[i], (f, nh) => nh.length >= 2 && (norm(f.label).startsWith(nh) || nh.startsWith(norm(f.label.replace(/\(.*\)/, ""))))));
}

function requiredMissing(fields: ImportField[], mapping: (string | null)[]) {
  return fields.filter((f) => f.required && !mapping.includes(f.name));
}

/** «ورود از اکسل» of a master-data entity (/data/:entity/import). */
export function ImportDrawer({ def, open, onClose }: { def: EntityDef; open: boolean; onClose: () => void }) {
  const { org, api } = useOrg();
  const target = useMemo<ImportTarget>(() => {
    const fields = importFields(def, org.modules);
    const hasCode = fields.some((f) => f.name === (def.code?.field ?? "code"));
    return {
      plural: def.plural,
      fields: fields.map((f) => ({ name: f.name, label: f.label, required: !!f.required && f.default === undefined && f.type !== "code" })),
      updateLabel: hasCode ? "اگر کد از قبل وجود داشت، به‌روزرسانی شود" : null,
      run: (rows, o) => api.post(`/data/${def.key}/import`, { rows, update_existing: o.update, dry_run: o.dry, offset: o.offset }),
      invalidate: [["table"], ["options"]],
    };
  }, [def, org.modules, api]);
  return <ImportSheet target={target} open={open} onClose={onClose} />;
}

/** The import sheet of any target. */
export function ImportSheet({ target, open, onClose }: { target: ImportTarget; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const n = useNotify();
  const fields = target.fields;
  const BATCH_SIZE = target.batch ?? BATCH;
  const [file, setFile] = useState<{ name: string; sheet: string; header: string[]; rows: string[][]; headerRow: number } | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const reset = () => {
    setFile(null);
    setMapping([]);
    setSummary(null);
    setProgress(null);
  };

  const load = async (f: File) => {
    try {
      const { sheet, rows } = await readSpreadsheet(f.name, await f.arrayBuffer());
      const headerRow = rows.findIndex((r) => r.some(Boolean));
      if (headerRow < 0 || rows.length <= headerRow + 1) throw new Error("فایل ردیفی برای ورود ندارد؛ ردیف اول عنوان ستون‌ها و بقیه داده‌ها باشند");
      const width = Math.max(...rows.map((r) => r.length));
      const header = Array.from({ length: width }, (_, i) => rows[headerRow][i] || `ستون ${faDigits(i + 1)}`);
      const data = rows.slice(headerRow + 1).filter((r) => r.some(Boolean));
      setFile({ name: f.name, sheet, header, rows: data, headerRow });
      setMapping(guessMapping(header, fields));
      setSummary(null);
    } catch (e) {
      n.error(e);
    }
    return false;
  };

  const payload = (rows: string[][]) =>
    rows.map((r) => {
      const o: Record<string, string> = {};
      mapping.forEach((field, i) => {
        if (field && r[i] !== undefined && r[i] !== "") o[field] = r[i];
      });
      return o;
    });

  const run = async (dry: boolean) => {
    if (!file) return;
    const total = file.rows.length;
    const acc: Summary = { created: 0, updated: 0, failed: 0, dry, errors: [] };
    setSummary(null);
    setProgress({ done: 0, total });
    try {
      for (let start = 0; start < total; start += BATCH_SIZE) {
        const r = await target.run(payload(file.rows.slice(start, start + BATCH_SIZE)), { dry, update: updateExisting, offset: start });
        acc.created += r.created;
        acc.updated += r.updated;
        acc.failed += r.failed;
        acc.errors.push(...r.results.filter((x) => !x.ok));
        setProgress({ done: Math.min(start + BATCH_SIZE, total), total });
      }
      setSummary(acc);
      if (!dry) {
        for (const k of target.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
        if (!acc.failed) n.ok(`${faDigits(acc.created + acc.updated)} ردیف وارد شد`);
      }
    } catch (e) {
      n.error(e);
      setSummary(acc.created || acc.updated || acc.failed ? acc : null);
    } finally {
      setProgress(null);
    }
  };

  const sheetRow = (dataIndex: number) => (file ? file.headerRow + dataIndex + 2 : dataIndex + 2);

  const template = () =>
    exportExcel(`نمونه‌ی ورود ${target.plural}`, fields.map((f) => ({ title: f.label, value: () => "", width: Math.max(14, f.label.length + 4) })), [], target.plural);

  const errorsFile = () => {
    if (!file || !summary) return;
    const cols = file.header.map((h, i) => ({ title: h, value: (r: { cells: string[] }) => r.cells[i] ?? "" }));
    const rows = summary.errors.map((e) => ({ cells: file.rows[e.row] ?? [], error: e.error ?? "" }));
    exportExcel(`خطاهای ورود ${target.plural}`, [{ title: "خطا", value: (r: { error: string }) => r.error, width: 40 }, ...cols] as never, rows, "خطاها");
  };

  const missing = file ? requiredMissing(fields, mapping) : [];
  const mapped = mapping.filter(Boolean).length;
  const busy = !!progress;
  const fieldOptions = fields.map((f) => ({ value: f.name, label: `${f.label}${f.required ? " *" : ""}` }));
  const imported = !!summary && !summary.dry && summary.created + summary.updated > 0;
  const step: 1 | 2 | 3 = !file ? 1 : summary || progress ? 3 : 2;

  // toasts move beside an open sheet (ds-antd.css reads --ds-sheet-w)
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.getPropertyValue("--ds-sheet-w");
    root.style.setProperty("--ds-sheet-w", `${SHEET_W}px`);
    return () => {
      if (prev) root.style.setProperty("--ds-sheet-w", prev);
      else root.style.removeProperty("--ds-sheet-w");
    };
  }, [open]);

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      size={SHEET_W}
      placement="left"
      closable={{ placement: "end" }}
      title={`ورود ${target.plural} از اکسل`}
      destroyOnHidden
      extra={
        <Button type="text" icon={<Download {...ICON} />} onClick={template}>
          فایل نمونه
        </Button>
      }
      footer={
        file ? (
          <div className="flex flex-wrap items-center gap-3 py-1">
            {target.updateLabel ? (
              <Checkbox checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} disabled={busy || imported}>
                {target.updateLabel}
              </Checkbox>
            ) : null}
            <div className="ms-auto flex gap-2">
              <Button icon={<ListChecks {...ICON} />} onClick={() => run(true)} disabled={busy || !mapped || missing.length > 0 || (!!summary && !summary.dry)}>
                بررسی بدون ثبت
              </Button>
              {imported ? (
                // imported: a second click would create the rows again
                <Button
                  type="primary"
                  onClick={() => {
                    reset();
                    onClose();
                  }}
                >
                  بستن
                </Button>
              ) : (
                <Button type="primary" icon={<FileUp {...ICON} />} onClick={() => run(false)} loading={busy} disabled={!mapped || missing.length > 0}>
                  {busy ? "در حال ورود…" : `ورود ${faDigits(file.rows.length)} ردیف`}
                </Button>
              )}
            </div>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <Steps step={step} />
        {!file ? (
          <>
            <Upload.Dragger className="ds-drop" accept=".xlsx,.csv,.txt" showUploadList={false} beforeUpload={load} multiple={false}>
              <div className="flex flex-col items-center gap-3">
                <span className="ds-file-ic" aria-hidden>
                  <FileSpreadsheet size={20} strokeWidth={1.4} absoluteStrokeWidth />
                </span>
                <div className="text-[14px] font-medium text-ink">فایل اکسل یا CSV را اینجا رها کنید یا برای انتخاب کلیک کنید</div>
                <div className="ds-note max-w-sm">
                  پسوند <bdi className="ds-latin">.xlsx</bdi> یا <bdi className="ds-latin">.csv</bdi>؛ ردیف اول عنوان ستون‌ها باشد. ستون‌ها را در مرحله‌ی بعد با فیلدها جور می‌کنید.
                </div>
              </div>
            </Upload.Dragger>
            <p className="ds-note">
              ستون‌ها را نمی‌دانید؟ «فایل نمونه» را بگیرید؛ عنوان ستون‌هایش همان فیلدهای {target.plural} است.
            </p>
          </>
        ) : (
          <>
            <div className="ds-file">
              <span className="ds-file-ic" aria-hidden>
                <FileSpreadsheet size={18} strokeWidth={1.4} absoluteStrokeWidth />
              </span>
              <div className="min-w-0 flex-1">
                <div className="ds-file-name">{file.name}</div>
                <div className="ds-file-meta">
                  برگه‌ی «{file.sheet}»، {faDigits(file.rows.length)} ردیف، {faDigits(mapped)} از {faDigits(file.header.length)} ستون جور شده
                </div>
              </div>
              <Button type="text" size="small" icon={<RotateCcw {...ICON} />} onClick={reset} disabled={busy}>
                فایل دیگر
              </Button>
            </div>

            {missing.length ? (
              <Alert
                type="warning"
                showIcon
                title={
                  <>
                    <b>ستونی برای فیلدهای الزامی انتخاب نشده:</b> {missing.map((f) => `«${f.label}»`).join("، ")}
                  </>
                }
              />
            ) : null}

            {progress ? (
              <Progress
                percent={Math.round((progress.done / Math.max(progress.total, 1)) * 100)}
                format={() => <span className="ds-num text-[13px] text-ink-2">{faDigits(progress.done)} از {faDigits(progress.total)}</span>}
              />
            ) : null}

            {summary ? (
              <Alert
                type={summary.failed ? "warning" : "success"}
                showIcon
                title={
                  summary.dry
                    ? summary.failed
                      ? <><b>بررسی:</b> {faDigits(summary.created + summary.updated)} ردیف آماده است و {faDigits(summary.failed)} ردیف خطا دارد.</>
                      : `بررسی: همه‌ی ${faDigits(summary.created + summary.updated)} ردیف درست است (${faDigits(summary.created)} جدید، ${faDigits(summary.updated)} به‌روزرسانی).`
                    : `${faDigits(summary.created)} ردیف ساخته شد${summary.updated ? `، ${faDigits(summary.updated)} به‌روزرسانی شد` : ""}${summary.failed ? `، ${faDigits(summary.failed)} ردیف خطا داشت و وارد نشد` : ""}.`
                }
                action={
                  summary.failed ? (
                    <Button size="small" icon={<Download {...ICON} />} onClick={errorsFile}>
                      فایل خطاها
                    </Button>
                  ) : undefined
                }
              />
            ) : null}

            {summary?.errors.length ? (
              <Table
                size="small"
                rowKey="row"
                dataSource={summary.errors}
                pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false, size: "small" }}
                columns={[
                  { key: "row", title: "ردیف فایل", width: 96, className: "ds-num", render: (_: unknown, r: ImportResultRow) => faDigits(sheetRow(r.row)) },
                  { key: "error", title: "خطا", dataIndex: "error", render: (v: string) => <span className="text-danger">{v}</span> },
                ]}
              />
            ) : null}

            <Table
              size="small"
              rowKey="i"
              pagination={false}
              scroll={{ y: 420 }}
              dataSource={file.header.map((h, i) => ({ i, h, sample: file.rows.slice(0, 3).map((r) => r[i]).filter(Boolean).join("، ") }))}
              columns={[
                {
                  key: "h",
                  title: "ستون فایل",
                  dataIndex: "h",
                  width: 210,
                  render: (v: string, r: { i: number }) => (
                    <span className={`flex items-center gap-2 ${mapping[r.i] ? "font-medium text-ink" : "text-ink-3"}`}>
                      <span className={`inline-grid w-4 place-items-center ${mapping[r.i] ? "text-in" : "text-transparent"}`} aria-hidden>
                        <Check size={14} strokeWidth={1.6} absoluteStrokeWidth />
                      </span>
                      <span className="min-w-0 truncate">{v}</span>
                    </span>
                  ),
                },
                {
                  key: "f",
                  title: "فیلد در برنامه",
                  width: 260,
                  render: (_: unknown, r: { i: number }) => (
                    <Select
                      className="w-full"
                      size="small"
                      allowClear
                      showSearch={{ optionFilterProp: "label" }}
                      placeholder="وارد نشود"
                      aria-label="فیلد"
                      value={mapping[r.i] ?? undefined}
                      options={fieldOptions.map((o) => ({ ...o, disabled: mapping.includes(o.value) && mapping[r.i] !== o.value }))}
                      onChange={(v) => setMapping(mapping.map((m, j) => (j === r.i ? (v ?? null) : m)))}
                      disabled={busy}
                    />
                  ),
                },
                { key: "s", title: "نمونه", dataIndex: "sample", ellipsis: true, render: (v: string) => <span className="text-ink-3">{v || "—"}</span> },
              ]}
            />
            <p className="ds-note">
              مبالغ با ارقام فارسی یا جداکننده، تاریخ شمسی (۱۴۰۳/۰۵/۱۲)، گزینه‌ها با همان عنوانی که در برنامه می‌بینید و موارد مرتبط (گروه، واحد، حساب…) با نام یا کد پذیرفته می‌شوند. خانه‌های خالی نادیده
              گرفته می‌شوند.
            </p>
          </>
        )}
      </div>
    </Drawer>
  );
}
