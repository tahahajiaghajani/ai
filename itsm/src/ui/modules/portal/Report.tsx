// «گزارش مشکل» (PTL-009): what does not work, in the person's own words, how much it stops them, screenshots — with
// the outages already announced on top (no need to report them again) and knowledge's deflection under the text
// (articles for what they type; «مشکلم حل شد» ends without a ticket). The incident is created with the person's own
// access (the engine checks every field); files are attached to it right after. When the administrator chose a record
// producer for reporting (`report_item_id`), its order form is used instead.
import { useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Input, Radio } from "antd";
import { Paperclip, Send, X } from "lucide-react";
import { useOrg } from "../../lib/org";
import { errorText, ApiError } from "../../lib/api";
import { Field, Note } from "../../components/blocks";
import { RecordMarkdown, recordsApi, uploadAttachment, useMe } from "../../records";
import { orderAssist } from "../request/slots";
import { portalApi, usePortalHome, usePortalRefresh, type PortalConfig } from "./api";
import { fileSize, portalPath, ticketPath } from "./model";
import { I16, PageHead } from "./parts";

const URGENCY: { value: string; label: string; hint: string }[] = [
  { value: "1", label: "کارم کاملاً متوقف است", hint: "هیچ راه دیگری برای ادامهٔ کار ندارم" },
  { value: "2", label: "کارم کند شده است", hint: "با دردسر می‌توانم ادامه دهم" },
  { value: "3", label: "مشکل جزئی است", hint: "عجله‌ای نیست" },
];
const MAX_FILES = 5;

export default function Report({ cfg }: { cfg: PortalConfig }) {
  const { api, orgId } = useOrg();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const refresh = usePortalRefresh();
  const { userId } = useMe();
  const home = usePortalHome(cfg.portal.id, false);
  const [subject, setSubject] = useState(sp.get("q") ?? "");
  const [details, setDetails] = useState("");
  const [urgency, setUrgency] = useState("3");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const assist = orderAssist();

  if (cfg.portal.report_item_id) return <Navigate to={portalPath(orgId, `items/${cfg.portal.report_item_id}`)} replace />;
  if (!cfg.can.report)
    return (
      <>
        <PageHead title="گزارش مشکل" />
        <Alert type="info" title="ثبت گزارش مشکل برای شما باز نیست" description={cfg.portal.chat_enabled ? `می‌توانید با ${cfg.portal.chat_name} گفتگو کنید.` : undefined} />
      </>
    );

  const outages = (home.data?.announcements ?? []).filter((a) => a.kind === "outage" || a.kind === "degradation");
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_FILES));
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (subject.trim().length < 3) e.subject = "در چند واژه بنویسید چه چیزی کار نمی‌کند";
    if (details.trim().length < 5) e.details = "کمی بیشتر توضیح دهید: چه شد، از کی، چه پیامی دیدید";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await recordsApi.create(api, "incident", {
        short_description: subject.trim().slice(0, 150),
        description: details.trim().slice(0, 4000),
        urgency,
        caller_id: userId,
        requested_for: userId,
        channel: "portal",
      });
      const id = String(res.row.id);
      const failed: string[] = [];
      for (const f of files) {
        try {
          await uploadAttachment(orgId, "incident", id, f);
        } catch {
          failed.push(f.name);
        }
      }
      void portalApi.event(api, { kind: "report", ref_table: "incident", ref_id: id });
      void refresh.all();
      navigate(ticketPath(orgId, "incident", id), { state: { created: true, failed } });
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object" && "fields" in (err.details as object)) {
        const fields = (err.details as { fields: Record<string, string> }).fields;
        setErrors({ subject: fields.short_description ?? "", details: fields.description ?? "" });
      }
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="گزارش مشکل" sub="بنویسید چه چیزی کار نمی‌کند؛ کارشناسان میز خدمت رسیدگی می‌کنند و هر پیامشان را در «درخواست‌های من» می‌بینید." back={{ to: portalPath(orgId), label: "خانه" }} />
      {outages.length ? (
        <div className="mb-4 flex flex-col gap-2">
          {outages.map((a) => (
            <Alert key={a.id} type={a.kind === "outage" ? "error" : "warning"} showIcon title={a.title} description={`این اختلال شناخته شده است و کارشناسان روی آن کار می‌کنند؛ اگر مشکل شما همین است، نیازی به گزارش دوباره نیست.`} />
          ))}
        </div>
      ) : null}
      <div className="pt-two">
        <div className="pt-card flex flex-col gap-4">
          <Field label="چه چیزی کار نمی‌کند؟" hint={errors.subject ? <span className="text-danger">{errors.subject}</span> : undefined} htmlFor="pt-report-subject">
            <Input id="pt-report-subject" size="large" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="مثلاً: چاپگر طبقهٔ دوم چاپ نمی‌کند" status={errors.subject ? "error" : undefined} />
          </Field>
          <Field label="شرح" hint={errors.details ? <span className="text-danger">{errors.details}</span> : "از کی؟ چه پیامی دیدید؟ چه کاری را امتحان کردید؟"} htmlFor="pt-report-details">
            <Input.TextArea id="pt-report-details" autoSize={{ minRows: 4, maxRows: 12 }} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} status={errors.details ? "error" : undefined} />
          </Field>
          {assist ? assist({ itemId: "report", itemType: "record_producer", text: `${subject} ${details}`.trim().slice(0, 300), onSolved: () => { void portalApi.event(api, { kind: "deflect", query: subject }); navigate(portalPath(orgId)); } }) : null}
          <Field label="چقدر کار شما را متوقف کرده است؟">
            <Radio.Group value={urgency} onChange={(e) => setUrgency(e.target.value)} className="flex flex-col gap-2">
              {URGENCY.map((u) => (
                <Radio key={u.value} value={u.value}>
                  {u.label} <span className="text-[12.5px] text-ink-3">— {u.hint}</span>
                </Radio>
              ))}
            </Radio.Group>
          </Field>
          <Field label="پیوست" hint="تصویر صفحه یا پیام خطا کمک بزرگی است (تا ۵ پرونده).">
            <div className="flex flex-col gap-2">
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              <div>
                <Button icon={<Paperclip {...I16} />} onClick={() => fileInput.current?.click()} disabled={files.length >= MAX_FILES}>
                  افزودن پرونده
                </Button>
              </div>
              {files.length ? (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {files.map((f, i) => (
                    <li key={`${f.name}${i}`} className="flex items-center gap-2">
                      <Paperclip {...I16} aria-hidden className="text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-ink-3">{fileSize(f.size)}</span>
                      <Button size="small" type="text" aria-label={`برداشتن ${f.name}`} icon={<X {...I16} />} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Field>
          {problem ? <Alert type="error" title={problem} /> : null}
          {cfg.portal.privacy_notice ? (
            <Note>
              <RecordMarkdown text={cfg.portal.privacy_notice} />
            </Note>
          ) : null}
          <div>
            <Button type="primary" size="large" icon={<Send {...I16} />} loading={busy} onClick={submit}>
              ثبت گزارش
            </Button>
          </div>
        </div>
        <aside className="pt-card flex flex-col gap-2 text-[13px]">
          <span className="font-medium">پس از ثبت</span>
          <span className="text-ink-2">گزارش شما شماره‌ای می‌گیرد و به گروه مناسب می‌رسد. هر پیام کارشناس و هر تغییر وضعیت را در «درخواست‌های من» و در اعلان‌ها می‌بینید.</span>
          <span className="mt-2 font-medium">زودتر حل شود</span>
          <span className="text-ink-2">نام برنامه، پیام خطا و زمان رخ دادن مشکل را بنویسید؛ اگر چند نفر گرفتارند، بگویید.</span>
          {cfg.portal.chat_enabled ? (
            <Button className="mt-2 self-start" onClick={() => navigate(portalPath(orgId, "chat"))}>
              گفتگو با {cfg.portal.chat_name}
            </Button>
          ) : null}
        </aside>
      </div>
    </>
  );
}
