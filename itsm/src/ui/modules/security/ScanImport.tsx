// «ورود نتیجهٔ پویش» (SEC-014, SEC-019): a scanner's export (Nessus / Tenable, Qualys, OpenVAS / Greenbone; CSV, XML
// or JSON) is read in the browser, previewed by the server (hosts matched to CIs, items to create or update, what
// reopens) and imported. The server de-duplicates per asset and vulnerability, keeps first detection, reopens what
// reappears and marks fixed what a covering scan of the same scanner no longer sees.
import { useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Select, Space, Upload } from "antd";
import { FileUp, ScanSearch } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { StatCard } from "../../components/display";
import { decodeText } from "@shared/sheet";
import { securityApi, type ScanImportResult } from "./api";

const fa = (n: number) => n.toLocaleString("fa-IR");
const MAX = 20_000_000;

export default function ScanImport() {
  const { api, orgId } = useOrg();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [scanner, setScanner] = useState<string | null>(null);
  const [result, setResult] = useState<ScanImportResult | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const input = (dry: boolean) => ({ name: file!.name, content: file!.content, scanner, dry_run: dry });
  const preview = useAction(() => securityApi.importScan(api, input(true)), { onSuccess: setResult });
  const run = useAction(() => securityApi.importScan(api, input(false)), { success: (d) => `${fa(d.created)} مورد تازه، ${fa(d.updated)} به‌روز، ${fa(d.reopened)} بازگشایی و ${fa(d.closed)} رفع‌شده.`, onSuccess: setResult });
  const read = async (f: File) => {
    setResult(null);
    setTooBig(f.size > MAX);
    if (f.size > MAX) return false;
    const content = decodeText(new Uint8Array(await f.arrayBuffer()));
    setFile({ name: f.name, content });
    return false;
  };
  return (
    <div>
      <PageHeader title="ورود نتیجهٔ پویش" />
      <div className="flex max-w-3xl flex-col gap-4">
        <Card>
          <Space direction="vertical" className="w-full">
            <Upload.Dragger accept=".csv,.xml,.nessus,.json,.txt" maxCount={1} showUploadList={false} beforeUpload={(f) => read(f as File)}>
              <p className="flex items-center justify-center gap-2 text-[14px] text-ink">
                <FileUp {...ICON14} /> {file ? file.name : "پروندهٔ خروجی پویشگر را اینجا رها کنید یا برگزینید"}
              </p>
              <p className="text-[12px] text-ink-3">Nessus (CSV یا ‎.nessus)، Qualys (CSV یا XML)، OpenVAS (CSV یا XML)، JSON</p>
            </Upload.Dragger>
            {tooBig ? <Alert type="warning" showIcon title="پرونده بزرگ است؛ آن را چند بخش کنید (حداکثر ۲۰ مگابایت)." /> : null}
            <Select
              className="w-full"
              value={scanner}
              onChange={setScanner}
              options={[{ value: null, label: "تشخیص خودکار پویشگر" }, { value: "nessus", label: "Nessus / Tenable" }, { value: "qualys", label: "Qualys" }, { value: "openvas", label: "OpenVAS / Greenbone" }, { value: "generic", label: "قالب عمومی JSON" }]}
              aria-label="پویشگر"
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!file} onClick={() => preview.mutate(undefined)} loading={preview.isPending}>
                پیش‌نمایش
              </Button>
              <Button type="primary" icon={<ScanSearch {...ICON14} />} disabled={!file || !result?.dry_run} onClick={() => run.mutate(undefined)} loading={run.isPending}>
                ورود
              </Button>
            </div>
          </Space>
        </Card>
        {result ? (
          <Card title={result.dry_run ? "پیش‌نمایش" : "نتیجهٔ ورود"}>
            {result.errors.length ? <Alert type="warning" showIcon className="mb-3" title={result.errors.join(" · ")} /> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="یافته‌ها" value={fa(result.findings)} hint={`${fa(result.skipped)} یافتهٔ اطلاعاتی کنار رفت`} />
              <StatCard title="میزبان‌ها" value={fa(result.hosts)} hint={`${fa(result.matched_hosts)} منطبق با پیکربندی · ${fa(result.unmatched_hosts)} بی‌پیکربندی`} />
              <StatCard title={result.dry_run ? "مورد تازه" : "ساخته شد"} value={fa(result.created)} hint={`${fa(result.updated)} به‌روز`} />
              <StatCard title="بازگشایی" value={fa(result.reopened)} hint={result.dry_run ? undefined : `${fa(result.closed)} مورد دیده نشد و رفع شد`} />
            </div>
            {!result.dry_run ? (
              <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
                <Link className="ds-link" to={`/${orgId}/security/vuln/items`}>
                  موردهای آسیب‌پذیر
                </Link>
                <Link className="ds-link" to={`/${orgId}/security/vuln/scans`}>
                  ورودهای پویش
                </Link>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
