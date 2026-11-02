// Tag labels (اتیکت) with a CODE128 barcode of the tag number, weight, fineness and wage — for
// a label printer (one label per page) or an A4 sheet of labels.
import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Button, Modal, Segmented, Select, Switch } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { D } from "@shared/money";
import { faDigits, formatWeight } from "@shared/format";
import { printWithPage, wageText } from "./shared";

export interface LabelItem {
  id: string;
  tag_no: string;
  title?: string | null;
  category_name?: string | null;
  fineness: string;
  gross_weight: string;
  net_weight: string;
  stone_weight?: string | null;
  wage_type?: string | null;
  wage_value?: string | null;
  stone_desc?: string | null;
}

const SIZES: Record<string, { w: number; h: number; label: string }> = {
  "50x25": { w: 50, h: 25, label: "۵۰ × ۲۵ میلی‌متر" },
  "40x20": { w: 40, h: 20, label: "۴۰ × ۲۰ میلی‌متر" },
  "60x30": { w: 60, h: 30, label: "۶۰ × ۳۰ میلی‌متر" },
  "70x15": { w: 70, h: 15, label: "۷۰ × ۱۵ (دمبلی جواهر)" },
};

export function Barcode({ value, height = 26, width = 1.1 }: { value: string; height?: number; width?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", height, width, displayValue: false, margin: 0, background: "#ffffff", lineColor: "#000000" });
    } catch {
      /* a value CODE128 cannot encode: leave it blank */
    }
  }, [value, height, width]);
  return <svg ref={ref} className="max-w-full" />;
}

interface LabelOptions {
  size: string;
  mode: "roll" | "a4";
  showOrg: boolean;
  showWage: boolean;
}

function Label({ it, o, orgName, last }: { it: LabelItem; o: LabelOptions; orgName: string; last?: boolean }) {
  const s = SIZES[o.size] ?? SIZES["50x25"];
  const small = s.h <= 20;
  return (
    <div
      className="gold-label flex flex-col items-center justify-center overflow-hidden bg-white text-black"
      style={{ width: `${s.w}mm`, height: `${s.h}mm`, padding: "1mm", boxSizing: "border-box", fontSize: small ? "6.5pt" : "7.5pt", lineHeight: 1.15, pageBreakAfter: o.mode === "roll" && !last ? "always" : undefined, breakInside: "avoid" }}
    >
      {o.showOrg && !small ? <div className="w-full truncate text-center font-bold">{orgName}</div> : null}
      <Barcode value={it.tag_no} height={small ? 16 : 22} width={s.w >= 60 ? 1.3 : 1.05} />
      <div className="ltr font-mono font-bold tracking-wider" style={{ fontSize: small ? "7pt" : "8pt" }}>{it.tag_no}</div>
      <div className="flex w-full justify-between gap-1">
        <span>وزن <b className="num">{formatWeight(it.gross_weight)}</b></span>
        <span>عیار <b className="num">{faDigits(D(it.fineness).toString())}</b></span>
      </div>
      {!small ? (
        <div className="flex w-full justify-between gap-1">
          {!D(it.stone_weight ?? 0).isZero() ? <span>خالص <span className="num">{formatWeight(it.net_weight)}</span></span> : <span className="truncate">{it.title || it.category_name || ""}</span>}
          {o.showWage && !D(it.wage_value ?? 0).isZero() ? <span>اجرت {wageText(it.wage_type, it.wage_value)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The labels to print (hidden on screen). */
export function LabelSheet({ items, options }: { items: LabelItem[]; options: LabelOptions }) {
  const { org } = useOrg();
  return (
    <div className="print-sheet hidden print:block">
      <div className={options.mode === "a4" ? "flex flex-wrap gap-[2mm]" : ""}>
        {items.map((it, i) => (
          <Label key={it.id} it={it} o={options} orgName={org.name} last={i === items.length - 1} />
        ))}
      </div>
    </div>
  );
}

/** Choose a label size and print. */
export function PrintLabelsModal({ open, onClose, items }: { open: boolean; onClose: () => void; items: LabelItem[] }) {
  const { org } = useOrg();
  const [o, setO] = useState<LabelOptions>(() => {
    try {
      return { size: "50x25", mode: "roll", showOrg: true, showWage: true, ...JSON.parse(localStorage.getItem("taraz.gold.labels") ?? "{}") };
    } catch {
      return { size: "50x25", mode: "roll", showOrg: true, showWage: true };
    }
  });
  const update = (patch: Partial<LabelOptions>) => {
    const next = { ...o, ...patch };
    setO(next);
    try {
      localStorage.setItem("taraz.gold.labels", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const s = SIZES[o.size] ?? SIZES["50x25"];
  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        title={`چاپ ${faDigits(items.length)} اتیکت`}
        footer={
          <Button type="primary" icon={<PrinterOutlined />} disabled={!items.length} onClick={() => printWithPage(o.mode === "roll" ? `${s.w}mm ${s.h}mm` : "A4 portrait", o.mode === "roll" ? "0" : "8mm")}>
            چاپ
          </Button>
        }
        destroyOnHidden
        rootClassName="no-print"
      >
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-xs text-muted">اندازه‌ی اتیکت</div>
              <Select className="w-full" value={o.size} onChange={(size) => update({ size })} options={Object.entries(SIZES).map(([value, x]) => ({ value, label: x.label }))} />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted">چاپگر</div>
              <Segmented block value={o.mode} onChange={(mode) => update({ mode: mode as LabelOptions["mode"] })} options={[{ value: "roll", label: "اتیکت‌زن (رول)" }, { value: "a4", label: "برگه‌ی A4" }]} />
            </div>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><Switch size="small" checked={o.showOrg} onChange={(showOrg) => update({ showOrg })} /> نام فروشگاه</label>
            <label className="flex items-center gap-2"><Switch size="small" checked={o.showWage} onChange={(showWage) => update({ showWage })} /> اجرت</label>
          </div>
          <div className="text-xs text-muted">پیش‌نمایش</div>
          <div className="flex max-h-64 flex-wrap gap-2 overflow-auto rounded-lg bg-surface-2 p-3">
            {items.slice(0, 6).map((it) => (
              <div key={it.id} className="border border-dashed border-line-strong">
                <Label it={it} o={{ ...o, mode: "a4" }} orgName={org.name} />
              </div>
            ))}
          </div>
        </div>
      </Modal>
      {open ? <LabelSheet items={items} options={o} /> : null}
    </>
  );
}
