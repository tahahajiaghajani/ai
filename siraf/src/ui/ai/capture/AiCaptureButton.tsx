// «خواندن از تصویر» — CONTRACT (stream E2): a form adds
//   <AiCaptureButton kind="purchase_invoice" onResult={(r) => prefill(r)} />
// and receives the reviewed result after the person presses «استفاده». The modal takes a photo (the camera on phones),
// an image or a PDF, shrinks large photos, sends it to POST /ai/capture (the business's vision model; nothing is stored
// but the file's hash and the result), and shows what was read with a confidence colour per value, the lines, and the
// server's checks (national id checksum, line totals, Sayad id, amount in words) before anything reaches the form.
// Shown to members with ai:view while the business's «خواندن از تصویر» switch is on.
import "../kit/ai.css";
import "./capture.css";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Modal, Tooltip } from "antd";
import { Camera, CircleAlert, FileText, ImageUp, RotateCcw, ScanText } from "lucide-react";
import type { AiCaptureResult } from "@shared/ai/types";
import { aiErrorText, AI_SETUP_KINDS } from "@shared/ai/errors";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { ConfidenceChip } from "../kit/AiMark";
import { LINE_FIELDS, captureRows, confidenceLevel, errorKindOf, failText, lineConfidence } from "../kit/model";
import { useAiStatus } from "../kit/hooks";
import { CAPTURE_MAX_BYTES, CAPTURE_WEB_MAX_BYTES, captureOf, prepareFile, type PreparedFile } from "./file";
import { useSession } from "../../lib/session";

export interface AiCaptureButtonProps {
  /** what is being read: a purchase invoice, a national ID card, a cheque or a receipt */
  kind: AiCaptureResult["kind"];
  /** called with the result once the person presses «استفاده»; fill the form and mark the values (see kit/AiMark) */
  onResult: (result: AiCaptureResult) => void;
  disabled?: boolean;
  /** the button's words (default «خواندن از تصویر») */
  label?: string;
  size?: "small" | "middle";
  /** icon only under 640 px (crowded headers) */
  compact?: boolean;
}

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

const KIND_TITLE: Record<AiCaptureResult["kind"], string> = {
  purchase_invoice: "خواندن فاکتور خرید از تصویر",
  id_card: "خواندن کارت ملی از تصویر",
  cheque: "خواندن چک از تصویر",
  receipt: "خواندن رسید از تصویر",
};

const KIND_HINT: Record<AiCaptureResult["kind"], string> = {
  purchase_invoice: "عکس واضح از کل فاکتور یا فایل PDF آن",
  id_card: "عکس روی کارت ملی، صاف و بدون بازتاب نور",
  cheque: "عکس روی چک صیادی، با شناسهٔ ۱۶ رقمی خوانا",
  receipt: "عکس رسید یا فیش پرداخت",
};

export function AiCaptureButton({ kind, onResult, disabled, label = "خواندن از تصویر", size, compact }: AiCaptureButtonProps) {
  const { can } = useOrg();
  const allowed = can("ai", "view");
  const status = useAiStatus(allowed);
  const [open, setOpen] = useState(false);
  const s = status.data;
  if (!allowed || (s && (!s.enabled || s.features?.capture === false))) return null;
  return (
    <>
      <Tooltip title={compact ? label : undefined}>
        <Button size={size} icon={<ScanText {...ICON} />} onClick={() => setOpen(true)} disabled={disabled} aria-label={label} className={compact ? "ai-xb is-compact" : undefined} aria-haspopup="dialog">
          <span className="ai-xb-t">{label}</span>
        </Button>
      </Tooltip>
      {open ? (
        <CaptureModal
          kind={kind}
          onClose={() => setOpen(false)}
          onUse={(r) => {
            setOpen(false);
            onResult(r);
          }}
        />
      ) : null}
    </>
  );
}

type Phase = { k: "pick" } | { k: "ready"; file: PreparedFile } | { k: "reading"; file: PreparedFile } | { k: "done"; file: PreparedFile; result: AiCaptureResult } | { k: "error"; file: PreparedFile; error: unknown };

function CaptureModal({ kind, onClose, onUse }: { kind: AiCaptureResult["kind"]; onClose: () => void; onUse: (r: AiCaptureResult) => void }) {
  const { api, can, orgId } = useOrg();
  const { meta } = useSession();
  // the Windows app's own server takes larger files than Vercel does
  const maxBytes = meta?.mode === "desktop" ? CAPTURE_MAX_BYTES : CAPTURE_WEB_MAX_BYTES;
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>({ k: "pick" });
  const [drag, setDrag] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const shoot = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const file = phase.k === "pick" ? null : phase.file;
  // the preview's object URL lives as long as its file
  useEffect(() => () => (file?.url ? URL.revokeObjectURL(file.url) : undefined), [file]);

  const take = async (f: File | null | undefined) => {
    if (!f) return;
    setProblem(null);
    try {
      const p = await prepareFile(f, maxBytes);
      if (alive.current) setPhase({ k: "ready", file: p });
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  const read = async (p: PreparedFile) => {
    setPhase({ k: "reading", file: p });
    try {
      const r = captureOf(await api.post("/ai/capture", { kind, file: p.data, mime: p.mime, name: p.name }), kind);
      if (alive.current) setPhase({ k: "done", file: p, result: r });
    } catch (e) {
      if (alive.current) setPhase({ k: "error", file: p, error: e });
    }
  };

  const errKind = phase.k === "error" ? errorKindOf(phase.error) : null;
  const err = errKind ? aiErrorText(errKind, { canManage: can("ai", "full") }) : null;

  const footer =
    phase.k === "done" ? (
      <div className="ai-sheet-foot">
        <Button icon={<RotateCcw {...ICON} />} onClick={() => setPhase({ k: "pick" })}>
          تصویر دیگر
        </Button>
        <span className="sf-end">
          <Button onClick={onClose}>انصراف</Button>
          <Button type="primary" onClick={() => onUse(phase.result)} disabled={!Object.keys(phase.result.fields).length && !phase.result.lines?.length}>
            استفاده
          </Button>
        </span>
      </div>
    ) : (
      <div className="ai-sheet-foot">
        {phase.k === "ready" || phase.k === "error" ? (
          <Button icon={<RotateCcw {...ICON} />} onClick={() => setPhase({ k: "pick" })}>
            تصویر دیگر
          </Button>
        ) : null}
        <span className="sf-end">
          <Button onClick={onClose}>انصراف</Button>
          <Button type="primary" disabled={!file || phase.k === "reading"} loading={phase.k === "reading"} onClick={() => file && read(file)}>
            {phase.k === "reading" ? "در حال خواندن…" : phase.k === "error" ? "تلاش دوباره" : "خواندن"}
          </Button>
        </span>
      </div>
    );

  return (
    <Modal open onCancel={onClose} title={KIND_TITLE[kind]} footer={footer} width={phase.k === "done" ? 760 : 560} destroyOnHidden maskClosable={phase.k !== "reading"} className="ai-cap-m">
      <input ref={pick} type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ""))} />
      <input ref={shoot} type="file" hidden accept="image/*" capture="environment" onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ""))} />
      {phase.k === "pick" ? (
        <div className="ai-cap">
          <div
            className={`ai-drop ${drag ? "is-drag" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => pick.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void take(e.dataTransfer.files?.[0]);
            }}
            onPaste={(e) => void take(e.clipboardData.files?.[0])}
          >
            <ImageUp size={28} strokeWidth={1.2} absoluteStrokeWidth aria-hidden />
            <b>تصویر یا PDF را اینجا رها کنید یا انتخاب کنید</b>
            <span>{KIND_HINT[kind]}؛ JPG، PNG، WebP یا PDF تا ۱۰ مگابایت</span>
          </div>
          <div className="ai-cap-alt">
            <Button icon={<Camera {...ICON} />} onClick={() => shoot.current?.click()} className="ai-cam">
              عکس گرفتن با دوربین
            </Button>
          </div>
          {problem ? (
            <div className="ai-err" role="alert">
              <CircleAlert {...ICON} aria-hidden />
              <span>{problem}</span>
            </div>
          ) : null}
          <p className="ai-cap-note">تصویر برای خواندن به مدل تصویری کسب‌وکار فرستاده می‌شود و در سیراف نگه داشته نمی‌شود.</p>
        </div>
      ) : (
        <div className={`ai-cap ${phase.k === "done" ? "is-done" : ""}`}>
          <Preview file={phase.file} busy={phase.k === "reading"} />
          {phase.k === "ready" ? <p className="ai-cap-note">اگر تصویر خوانا است «خواندن» را بزنید.</p> : null}
          {phase.k === "reading" ? (
            <div className="ai-cap-wait" aria-live="polite">
              <span className="sf-nuqta sf-pulse" aria-hidden />
              در حال خواندن {phase.file.pdf ? "فایل" : "تصویر"} و سنجیدن عددها…
            </div>
          ) : null}
          {phase.k === "error" ? (
            <div className="ai-err" role="alert">
              <CircleAlert {...ICON} aria-hidden />
              <div>
                <b>{err?.title ?? "خواندن انجام نشد"}</b>
                <span>{err?.remedy ?? failText(phase.error)}</span>
                {errKind && AI_SETUP_KINDS.includes(errKind) && can("ai", "full") ? (
                  <div className="mt-2">
                    <Button size="small" onClick={() => nav(`/${orgId}/settings/ai`)}>
                      تنظیمات هوش مصنوعی
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {phase.k === "done" ? <ResultView result={phase.result} /> : null}
        </div>
      )}
    </Modal>
  );
}

function Preview({ file, busy }: { file: PreparedFile; busy: boolean }) {
  return (
    <figure className={`ai-prevw ${busy ? "is-busy" : ""}`}>
      {file.url ? (
        <img src={file.url} alt="پیش‌نمایش تصویر" />
      ) : (
        <span className="ai-prevw-pdf">
          <FileText size={28} strokeWidth={1.2} absoluteStrokeWidth aria-hidden />
        </span>
      )}
      <figcaption>
        <span className="ai-prevw-n" dir="auto">
          {file.name}
        </span>
        <span>{file.note}</span>
      </figcaption>
    </figure>
  );
}

/** What was read: fields with their confidence, the lines (invoice), and the server's checks. */
export function ResultView({ result }: { result: AiCaptureResult }) {
  const rows = captureRows(result.kind, result.fields);
  const lines = result.lines ?? [];
  const cols = LINE_FIELDS.filter((c) => lines.some((l) => l[c.key]?.value));
  const unsure = rows.filter((r) => confidenceLevel(r.confidence) !== "high").length + lines.filter((l) => confidenceLevel(lineConfidence(l)) !== "high").length;
  if (!rows.length && !lines.length)
    return (
      <div className="ai-err" role="alert">
        <CircleAlert {...ICON} aria-hidden />
        <span>چیزی از این تصویر خوانده نشد؛ عکس واضح‌تری امتحان کنید.</span>
      </div>
    );
  return (
    <div className="ai-res">
      <div className="ai-res-h">
        <b>
          {fa(rows.length)} مقدار{lines.length ? ` و ${fa(lines.length)} ردیف` : ""} خوانده شد
        </b>
        <span>{unsure ? `${fa(unsure)} مورد را با اصل سند مقایسه کنید.` : "همه با اطمینان بالا خوانده شد؛ باز هم پیش از ثبت نگاه کنید."}</span>
      </div>
      {result.warnings.length ? (
        <ul className="ai-review-w">
          {result.warnings.map((w) => (
            <li key={w}>
              <i className="sf-nuqta" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length ? (
        <dl className="ai-res-f">
          {rows.map((r) => (
            <div key={r.key} className="ai-res-r" data-level={confidenceLevel(r.confidence)}>
              <dt>{r.label}</dt>
              <dd>
                <span className="ai-res-v" dir="auto">
                  {r.value}
                </span>
                <ConfidenceChip value={r.confidence} />
                {r.note ? <small>{r.note}</small> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {lines.length ? (
        <div className="ai-md-wrap">
          <table className="ai-res-t">
            <thead>
              <tr>
                <th>ردیف</th>
                {cols.map((c) => (
                  <th key={c.key} className={c.numeric ? "is-num" : undefined}>
                    {c.label}
                  </th>
                ))}
                <th>اطمینان</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = lineConfidence(l);
                return (
                  <tr key={i} className="ai-row-mark" data-level={confidenceLevel(c)}>
                    <td className="is-num">{fa(i + 1)}</td>
                    {cols.map((col) => (
                      <td key={col.key} className={col.numeric ? "is-num" : undefined} data-level={l[col.key] ? confidenceLevel(l[col.key].confidence) : undefined}>
                        {l[col.key]?.value ?? "—"}
                      </td>
                    ))}
                    <td>
                      <ConfidenceChip value={c} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {result.model ? (
        <p className="ai-cap-note">
          خوانده‌شده با <span className="ai-model">{result.model}</span>
        </p>
      ) : null}
    </div>
  );
}

