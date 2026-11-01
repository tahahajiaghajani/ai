// «ورود از اکسل» for any master-data entity: read an .xlsx/.csv file in the browser, map its
// columns to fields, check everything on the server without saving, then import in batches.
import { useMemo, useState } from "react";
import { Alert, Button, Checkbox, Drawer, Progress, Select, Table, Tag, Upload } from "antd";
import { CheckCircleOutlined, DownloadOutlined, FileExcelOutlined, InboxOutlined, ReloadOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { importFields, type EntityDef, type FieldDef } from "@shared/entities";
import { readSpreadsheet } from "@shared/sheet";
import { faDigits } from "@shared/format";
import { normalizeDigits } from "@shared/money";
import { useOrg } from "../lib/org";
import { useNotify } from "../lib/hooks";
import { exportExcel } from "../lib/excel";

const BATCH = 200;

interface Result {
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
  errors: Result[];
}

const norm = (s: string) =>
  normalizeDigits(s)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌\s_\-–—/\\.:()*]+/g, "")
    .toLowerCase();

/** Guess which field each column is for: exact label or name first, then a label that contains it. */
function guessMapping(header: string[], fields: FieldDef[]): (string | null)[] {
  const used = new Set<string>();
  const pick = (h: string, test: (f: FieldDef, nh: string) => boolean) => {
    const nh = norm(h);
    if (!nh) return null;
    const f = fields.find((x) => !used.has(x.name) && test(x, nh));
    if (f) used.add(f.name);
    return f?.name ?? null;
  };
  const out: (string | null)[] = header.map((h) => pick(h, (f, nh) => norm(f.label) === nh || norm(f.name) === nh));
  return out.map((v, i) => v ?? pick(header[i], (f, nh) => nh.length >= 2 && (norm(f.label).startsWith(nh) || nh.startsWith(norm(f.label.replace(/\(.*\)/, ""))))));
}

function requiredMissing(fields: FieldDef[], mapping: (string | null)[]) {
  return fields.filter((f) => f.required && f.default === undefined && f.type !== "code" && !mapping.includes(f.name));
}

export function ImportDrawer({ def, open, onClose }: { def: EntityDef; open: boolean; onClose: () => void }) {
  const { org, api } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const fields = useMemo(() => importFields(def, org.modules), [def, org.modules]);
  const hasCode = fields.some((f) => f.name === (def.code?.field ?? "code"));
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
      for (let start = 0; start < total; start += BATCH) {
        const r = await api.post<{ results: Result[]; created: number; updated: number; failed: number }>(`/data/${def.key}/import`, {
          rows: payload(file.rows.slice(start, start + BATCH)),
          update_existing: updateExisting,
          dry_run: dry,
          offset: start,
        });
        acc.created += r.created;
        acc.updated += r.updated;
        acc.failed += r.failed;
        acc.errors.push(...r.results.filter((x) => !x.ok));
        setProgress({ done: Math.min(start + BATCH, total), total });
      }
      setSummary(acc);
      if (!dry) {
        qc.invalidateQueries({ queryKey: ["table"] });
        qc.invalidateQueries({ queryKey: ["options"] });
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
    exportExcel(`نمونه‌ی ورود ${def.plural}`, fields.map((f) => ({ title: f.label, value: () => "", width: Math.max(14, f.label.length + 4) })), [], def.plural);

  const errorsFile = () => {
    if (!file || !summary) return;
    const cols = file.header.map((h, i) => ({ title: h, value: (r: { cells: string[] }) => r.cells[i] ?? "" }));
    const rows = summary.errors.map((e) => ({ cells: file.rows[e.row] ?? [], error: e.error ?? "" }));
    exportExcel(`خطاهای ورود ${def.plural}`, [{ title: "خطا", value: (r: { error: string }) => r.error, width: 40 }, ...cols] as never, rows, "خطاها");
  };

  const missing = file ? requiredMissing(fields, mapping) : [];
  const mapped = mapping.filter(Boolean).length;
  const busy = !!progress;
  const fieldOptions = fields.map((f) => ({ value: f.name, label: `${f.label}${f.required && f.default === undefined && f.type !== "code" ? " *" : ""}` }));

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      size={880}
      title={`ورود ${def.plural} از اکسل`}
      destroyOnHidden
      extra={
        <Button type="link" icon={<DownloadOutlined />} onClick={template}>
          فایل نمونه
        </Button>
      }
      footer={
        file ? (
          <div className="flex flex-wrap items-center gap-2">
            {hasCode ? (
              <Checkbox checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} disabled={busy}>
                اگر کد از قبل وجود داشت، به‌روزرسانی شود
              </Checkbox>
            ) : null}
            <div className="ms-auto flex gap-2">
              <Button icon={<CheckCircleOutlined />} onClick={() => run(true)} disabled={busy || !mapped || missing.length > 0}>
                بررسی بدون ثبت
              </Button>
              <Button type="primary" icon={<FileExcelOutlined />} onClick={() => run(false)} loading={busy} disabled={!mapped || missing.length > 0}>
                ورود {faDigits(file.rows.length)} ردیف
              </Button>
            </div>
          </div>
        ) : null
      }
    >
      {!file ? (
        <Upload.Dragger accept=".xlsx,.csv,.txt" showUploadList={false} beforeUpload={load} multiple={false}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">فایل اکسل (‎.xlsx‎) یا CSV را اینجا رها کنید یا کلیک کنید</p>
          <p className="ant-upload-hint">ردیف اول عنوان ستون‌ها باشد؛ ستون‌ها را در مرحله‌ی بعد با فیلدها جور می‌کنید.</p>
        </Upload.Dragger>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <FileExcelOutlined className="text-lg text-[var(--tz-success)]" />
            <span className="font-semibold">{file.name}</span>
            <Tag variant="filled">{file.sheet}</Tag>
            <span className="text-muted text-sm">{faDigits(file.rows.length)} ردیف · {faDigits(mapped)} ستون جور شده</span>
            <Button size="small" icon={<ReloadOutlined />} className="ms-auto" onClick={reset} disabled={busy}>
              فایل دیگر
            </Button>
          </div>

          {missing.length ? <Alert type="warning" showIcon title={`برای این فیلدهای الزامی ستونی انتخاب نشده: ${missing.map((f) => `«${f.label}»`).join("، ")}`} /> : null}

          {progress ? <Progress percent={Math.round((progress.done / Math.max(progress.total, 1)) * 100)} format={() => `${faDigits(progress.done)} از ${faDigits(progress.total)}`} /> : null}

          {summary ? (
            <Alert
              type={summary.failed ? "warning" : "success"}
              showIcon
              title={
                summary.dry
                  ? summary.failed
                    ? `بررسی: ${faDigits(summary.created + summary.updated)} ردیف آماده، ${faDigits(summary.failed)} ردیف خطا دارد`
                    : `بررسی: همه‌ی ${faDigits(summary.created + summary.updated)} ردیف درست است (${faDigits(summary.created)} جدید، ${faDigits(summary.updated)} به‌روزرسانی)`
                  : `${faDigits(summary.created)} ردیف ساخته شد${summary.updated ? `، ${faDigits(summary.updated)} به‌روزرسانی شد` : ""}${summary.failed ? `، ${faDigits(summary.failed)} ردیف خطا داشت و وارد نشد` : ""}`
              }
              action={
                summary.failed ? (
                  <Button size="small" icon={<DownloadOutlined />} onClick={errorsFile}>
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
              pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
              columns={[
                { key: "row", title: "ردیف فایل", width: 90, render: (_: unknown, r: Result) => faDigits(sheetRow(r.row)) },
                { key: "error", title: "خطا", dataIndex: "error", render: (v: string) => <span className="text-[var(--tz-danger)]">{v}</span> },
              ]}
            />
          ) : null}

          <Table
            size="small"
            rowKey="i"
            pagination={false}
            scroll={{ y: 420 }}
            dataSource={file.header.map((h, i) => ({ i, h, sample: file.rows.slice(0, 3).map((r) => r[i]).filter(Boolean).join(" · ") }))}
            columns={[
              { key: "h", title: "ستون فایل", dataIndex: "h", width: 200, render: (v: string) => <span className="font-medium">{v}</span> },
              {
                key: "f",
                title: "فیلد در تراز",
                width: 260,
                render: (_: unknown, r: { i: number }) => (
                  <Select
                    className="w-full"
                    size="small"
                    allowClear
                    showSearch={{ optionFilterProp: "label" }}
                    placeholder="وارد نشود"
                    value={mapping[r.i] ?? undefined}
                    options={fieldOptions.map((o) => ({ ...o, disabled: mapping.includes(o.value) && mapping[r.i] !== o.value }))}
                    onChange={(v) => setMapping(mapping.map((m, j) => (j === r.i ? (v ?? null) : m)))}
                    disabled={busy}
                  />
                ),
              },
              { key: "s", title: "نمونه", dataIndex: "sample", ellipsis: true, render: (v: string) => <span className="text-muted">{v || "—"}</span> },
            ]}
          />
          <p className="text-muted text-xs leading-6">
            مبالغ با ارقام فارسی یا جداکننده، تاریخ شمسی (۱۴۰۳/۰۵/۱۲)، گزینه‌ها با همان عنوانی که در برنامه می‌بینید و
            موارد مرتبط (گروه، واحد، حساب…) با نام یا کد پذیرفته می‌شوند. خانه‌های خالی نادیده گرفته می‌شوند.
          </p>
        </div>
      )}
    </Drawer>
  );
}
