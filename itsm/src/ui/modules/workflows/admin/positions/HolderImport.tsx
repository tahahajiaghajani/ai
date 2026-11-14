// «ورود دارندگان» (design F §3.4, §11 q2; F3's import): holders from an HR spreadsheet — a CSV or Excel file read in the
// browser, or an import set's attached file (`settings` read; its transform map applies and «جایگزینی» removes the
// holders that set brought in and the file no longer lists). The server matches the columns by their usual headers
// (کلید نقش، ایمیل، کد واحد، نوع، از تاریخ، تا تاریخ — Persian or English), checks every row in a dry run first, and
// leaves holders kept by hand or by AD alone (listed). Nothing is written until «ورود».
import { useState } from "react";
import { Alert, Button, Drawer, Radio, Segmented, Select, Table, Upload } from "antd";
import { Download, FileSpreadsheet, FileUp, ListChecks } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readSpreadsheet } from "@shared/sheet";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { exportExcel } from "../../../../lib/excel";
import { useSheetSize } from "../fields/parts";
import { POSITION_KEYS, positionsApi, type HolderImportResult } from "./api";
import { IMPORT_HEADERS, importSummary, sheetRows } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const MAX_ROWS = 5000;

type Source = "file" | "set";

export default function HolderImport({ onClose }: { onClose: () => void }) {
  const { api, orgId, allows } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const size = useSheetSize(640);
  const setsAllowed = allows({ area: "settings" });
  const [source, setSource] = useState<Source>("file");
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState<"dry" | "run" | null>(null);
  const [result, setResult] = useState<HolderImportResult | null>(null);
  const sets = useQuery({ queryKey: POSITION_KEYS.sets(orgId), queryFn: () => positionsApi.importSets(api), enabled: setsAllowed && source === "set" });
  const ready = source === "file" ? !!file?.rows.length : !!setId;
  const applied = !!result && !result.dry_run;

  const load = async (f: File) => {
    try {
      const { rows } = await readSpreadsheet(f.name, await f.arrayBuffer(), { maxRows: MAX_ROWS + 2 });
      const parsed = sheetRows(rows);
      if (!parsed.rows.length) throw new Error("فایل ردیفی برای ورود ندارد؛ ردیف اول عنوان ستون‌ها و بقیه داده‌ها باشند");
      if (parsed.rows.length > MAX_ROWS) throw new Error(`در هر بار حداکثر ${faDigits(MAX_ROWS)} ردیف؛ فایل را چند بخش کنید`);
      setFile({ name: f.name, ...parsed });
      setResult(null);
    } catch (e) {
      n.error(e);
    }
    return false;
  };
  const run = async (dry: boolean) => {
    setBusy(dry ? "dry" : "run");
    try {
      const r = await positionsApi.importHolders(api, {
        ...(source === "file" ? { rows: file?.rows ?? [] } : { import_set_id: setId }),
        mode: source === "set" ? mode : "merge",
        dry_run: dry,
      });
      setResult(r);
      if (!dry) {
        await qc.invalidateQueries({ queryKey: POSITION_KEYS.all(orgId) });
        n.ok(`ورود دارندگان: ${importSummary(r)}`);
      }
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const template = () => exportExcel("نمونهٔ ورود دارندگان نقش‌ها", IMPORT_HEADERS.map((h) => ({ title: h, value: () => "", width: 18 })), [], "دارندگان");

  return (
    <Drawer
      open
      size={size}
      placement="left"
      title="ورود دارندگان نقش‌ها"
      onClose={() => busy === null && onClose()}
      destroyOnHidden
      extra={
        <Button type="text" icon={<Download {...I16} />} onClick={template}>
          فایل نمونه
        </Button>
      }
      footer={
        <div className="wff-foot">
          <span className="wff-foot-gap" />
          {applied ? (
            <Button type="primary" onClick={onClose}>
              بستن
            </Button>
          ) : (
            <>
              <Button icon={<ListChecks {...I16} />} onClick={() => run(true)} disabled={!ready || busy !== null} loading={busy === "dry"}>
                بررسی بدون ثبت
              </Button>
              <Button type="primary" icon={<FileUp {...I16} />} onClick={() => run(false)} disabled={!ready || busy !== null} loading={busy === "run"}>
                ورود
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="wff-stack">
        {setsAllowed ? (
          <Segmented
            value={source}
            onChange={(v) => {
              setSource(v as Source);
              setResult(null);
            }}
            options={[
              { value: "file", label: "از فایل" },
              { value: "set", label: "از مجموعهٔ ورود" },
            ]}
            aria-label="منبع"
          />
        ) : null}
        {source === "file" ? (
          file ? (
            <div className="ds-file">
              <span className="ds-file-ic" aria-hidden>
                <FileSpreadsheet size={18} strokeWidth={1.4} absoluteStrokeWidth />
              </span>
              <div className="min-w-0 flex-1">
                <div className="ds-file-name">{file.name}</div>
                <div className="ds-file-meta">
                  {faDigits(file.rows.length)} ردیف؛ ستون‌ها: {file.headers.join("، ")}
                </div>
              </div>
              <Button type="text" size="small" onClick={() => (setFile(null), setResult(null))} disabled={busy !== null}>
                فایل دیگر
              </Button>
            </div>
          ) : (
            <Upload.Dragger className="ds-drop" accept=".xlsx,.csv,.txt" showUploadList={false} beforeUpload={load} multiple={false}>
              <div className="flex flex-col items-center gap-2 py-2">
                <FileSpreadsheet size={22} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
                <div className="text-[14px] text-ink">فایل اکسل یا CSV دارندگان را اینجا رها کنید یا برای انتخاب کلیک کنید</div>
                <div className="rk-hint">ستون‌ها: {IMPORT_HEADERS.join("، ")}؛ تاریخ‌ها شمسی یا میلادی</div>
              </div>
            </Upload.Dragger>
          )
        ) : (
          <>
            <Select
              value={setId ?? undefined}
              onChange={(v) => (setSetId(v), setResult(null))}
              options={(sets.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              loading={sets.isLoading}
              placeholder="مجموعهٔ ورودی که جدول مقصدش دارندگان نقش‌هاست"
              aria-label="مجموعهٔ ورود"
              notFoundContent={<span className="rk-hint">مجموعه‌ای با مقصد «دارندگان نقش‌های سازمانی» نیست؛ در «ورود داده از فایل» بسازید</span>}
            />
            <Radio.Group
              value={mode}
              onChange={(e) => (setMode(e.target.value), setResult(null))}
              options={[
                { value: "merge", label: "افزودن و به‌روزرسانی" },
                { value: "replace", label: "جایگزینی" },
              ]}
            />
            {mode === "replace" ? <p className="rk-hint">دارندگانی که همین مجموعه پیش‌تر وارد کرده و در فایل تازه نیستند برداشته می‌شوند؛ دارندگان دستی و AD دست نمی‌خورند.</p> : null}
          </>
        )}
        {result ? (
          <Alert
            type={result.errors.length ? "warning" : "success"}
            showIcon
            title={`${result.dry_run ? "بررسی" : "انجام شد"}: ${importSummary(result)}`}
            description={result.dry_run ? "هنوز چیزی ثبت نشده است." : undefined}
          />
        ) : null}
        {result?.errors.length ? <Lines title="خطاها" rows={result.errors} danger /> : null}
        {result?.skipped.length ? <Lines title="دست نخورد" rows={result.skipped} /> : null}
      </div>
    </Drawer>
  );
}

type Line = { row: number; message: string };

function Lines({ title, rows, danger }: { title: string; rows: Line[]; danger?: boolean }) {
  return (
    <Table<Line>
      size="small"
      rowKey={(r) => `${r.row}-${r.message}`}
      dataSource={rows}
      title={() => title}
      pagination={rows.length > 8 ? { pageSize: 8, showSizeChanger: false, size: "small" } : false}
      columns={[
        { key: "row", title: "ردیف", width: 72, className: "ds-num", render: (_: unknown, r) => (r.row ? faDigits(r.row) : "—") },
        { key: "m", title: "توضیح", render: (_: unknown, r) => <span className={danger ? "text-danger" : "text-ink-2"}>{r.message}</span> },
      ]}
    />
  );
}
