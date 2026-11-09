// «چاپ برچسب» (catalogue ITAM-028): QR labels on A4 sheets — the assets chosen on a list (`?ids=`), of a stockroom or a
// model — laid out by a label template (columns, rows, label size and margins in millimetres, what each label shows),
// with cells of a partly used sheet skipped. The QR code holds the asset page's address (settings «نشانی سامانه برای
// QR») or its tag; scanners in audits read either. Printing uses the browser at 100 % scale with no margins.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, InputNumber, Select, Space } from "antd";
import { Printer, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { labelSheet, paginate, A4 } from "@shared/itam/logic";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Field, Note } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { RecordSelect } from "../../records";
import { itamApi, ITAM_KEYS, type LabelData } from "./api";
import { ICON } from "./parts";

type LabelAsset = LabelData["assets"][number];

function LabelCell({ a, svg, fields, title, w, h }: { a: LabelAsset; svg: string | undefined; fields: string[]; title: string | null; w: number; h: number }) {
  const qr = Math.max(10, Math.min(h - 4, w * 0.45));
  const lines: [string, string | null, boolean?][] = [
    ["tag", a.asset_tag ?? a.number, true],
    ["name", a.name],
    ["model", a.model],
    ["serial", a.serial_number ? `S/N ${a.serial_number}` : null, true],
    ["number", a.number, true],
    ["location", a.location],
  ];
  return (
    <div className="itam-label-in" style={{ width: `${w}mm`, height: `${h}mm` }}>
      <div className="itam-label-qr" style={{ width: `${qr}mm`, height: `${qr}mm` }} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} aria-label={`QR ${a.asset_tag ?? a.number ?? ""}`} />
      <div className="itam-label-text">
        {title ? <div className="itam-label-title">{title}</div> : null}
        {lines.filter(([k, v]) => fields.includes(k) && v).map(([k, v, ltr]) => (
          <div key={k} className={k === "tag" ? "itam-label-tag" : "itam-label-line"} dir={ltr ? "ltr" : undefined}>{k === "tag" ? faDigits(String(v)) : v}</div>
        ))}
      </div>
    </div>
  );
}

export default function Labels() {
  const { api, orgId } = useOrg();
  const [sp, setSp] = useSearchParams();
  const ids = sp.get("ids") ?? "";
  const stockroom = sp.get("stockroom");
  const model = sp.get("model");
  const query = useMemo(() => Object.fromEntries(Object.entries({ ids, stockroom: stockroom ?? "", model: model ?? "" }).filter(([, v]) => v)), [ids, stockroom, model]);
  const enabled = Object.keys(query).length > 0;
  const q = useQuery({ queryKey: ITAM_KEYS.labels(orgId, JSON.stringify(query)), queryFn: () => itamApi.labels(api, query), enabled });
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [skip, setSkip] = useState(0);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const d = q.data;
  const template = d?.templates.find((t) => t.id === templateId) ?? d?.templates.find((t) => t.is_default) ?? d?.templates[0] ?? null;
  const sheet = template ? labelSheet(template) : null;
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const a of d?.assets ?? []) out[a.id] = await QRCode.toString(a.payload, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      if (alive) setSvgs(out);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [d]);
  const pages = sheet && d ? paginate(d.assets, sheet.perPage, skip) : [];
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    next.delete("ids");
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  return (
    <div>
      <PageHeader title="چاپ برچسب دارایی" actions={<Button type="primary" icon={<Printer {...ICON} />} disabled={!d?.assets.length || !sheet} onClick={() => window.print()}>چاپ</Button>} />
      <Card className="no-print">
        <div className="itam-controls">
          <Field label="انبار"><RecordSelect table="stockroom" value={stockroom} onChange={(v) => setParam("stockroom", (v as string) ?? null)} placeholder="همهٔ انبارها" /></Field>
          <Field label="مدل"><RecordSelect table="asset_model" value={model} onChange={(v) => setParam("model", (v as string) ?? null)} placeholder="همهٔ مدل‌ها" /></Field>
          <Field label="الگو"><Select value={template?.id} onChange={setTemplateId} options={(d?.templates ?? []).map((t) => ({ value: t.id, label: t.name }))} aria-label="الگوی برچسب" /></Field>
          <Field label="خانه‌های استفاده‌شدهٔ برگهٔ نخست"><InputNumber min={0} max={(sheet?.perPage ?? 1) - 1} value={skip} onChange={(v) => setSkip(Number(v ?? 0))} /></Field>
        </div>
        {ids ? <div className="text-[13px] text-ink-3 mt-2">{fa(ids.split(",").length)} دارایی انتخاب‌شده از فهرست</div> : null}
        {sheet && !sheet.fits ? <Note tone="warning">این چیدمان از برگهٔ A4 بیرون می‌زند؛ اندازه‌ها یا حاشیه‌های الگو را بررسی کنید.</Note> : null}
      </Card>
      {!enabled ? (
        <EmptyState title="دارایی‌ها را انتخاب کنید" description="از فهرست دارایی‌ها چند مورد را انتخاب و «چاپ برچسب» را بزنید، یا یک انبار یا مدل را برگزینید." icon={QrCode} />
      ) : q.isLoading ? (
        <Loader />
      ) : !d?.assets.length ? (
        <EmptyState compact title="دارایی‌ای برای چاپ پیدا نشد" />
      ) : sheet && template ? (
        <div className="itam-preview">
          <div className="text-[13px] text-ink-3 mb-2 no-print">{fa(d.assets.length)} برچسب در {fa(pages.length)} برگه</div>
          <div className="itam-print">
            {pages.map((cells, p) => (
              <div key={p} className="itam-sheet" style={{ width: `${A4.width}mm`, height: `${A4.height}mm` }}>
                {cells.map((a, i) =>
                  a ? (
                    <div key={a.id} className="itam-label" style={{ left: `${sheet.cells[i].x}mm`, top: `${sheet.cells[i].y}mm` }}>
                      <LabelCell a={a} svg={svgs[a.id]} fields={template.fields} title={template.title} w={sheet.width} h={sheet.height} />
                    </div>
                  ) : null,
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState compact title="الگوی برچسبی تعریف نشده است" />
      )}
      <Space />
    </div>
  );
}
