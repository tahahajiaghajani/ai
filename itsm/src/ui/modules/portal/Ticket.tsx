// A request's page for the person who asked (PTL-014…017): where it stands (four steps, never internal states), the
// next promise of the desk, an outage it belongs to, the answers of the order, the conversation with the desk — public
// replies only, never internal notes — with a composer (text, files, suggested replies), the files of the record that
// are not behind an internal note, and what the person may do: confirm the resolution with a rating, reopen with a
// reason, cancel or withdraw, or nudge the desk once a day. A survey about it waits here too.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Rate, Skeleton, Tooltip } from "antd";
import { AlertTriangle, CheckCircle2, Clock, Download, MessageSquareHeart, Paperclip, Send, Sparkles, X } from "lucide-react";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ApiError, errorText } from "../../lib/api";
import { RecordMarkdown, attachmentUrl, uploadAttachment } from "../../records";
import { PORTAL_KEYS, portalApi, usePortalRefresh, usePortalTicket, type PortalAction, type PortalConfig, type PortalTicket, type TimelineEntry } from "./api";
import { ago, fileSize, portalPath } from "./model";
import { Empty, I16, PageHead, Section, StageChip } from "./parts";

const MAX_FILES = 5;

function Steps({ t }: { t: PortalTicket }) {
  if (!t.steps.length) return null;
  return (
    <div className="pt-steps" role="list" aria-label="مراحل رسیدگی">
      {t.steps.map((s) => (
        <div key={s.key} className="pt-step" data-s={s.status} role="listitem" aria-current={s.status === "current" ? "step" : undefined}>
          <i aria-hidden />
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function Entry({ e }: { e: TimelineEntry }) {
  const { orgId } = useOrg();
  if (e.kind === "state" || e.kind === "created")
    return (
      <div className="pt-event" title={formatJalaliDateTime(e.at)}>
        {e.label ?? (e.kind === "created" ? "ثبت شد" : "وضعیت تغییر کرد")} · {ago(e.at)}
      </div>
    );
  const files = e.attachments ?? [];
  return (
    <div className={`pt-msg${e.mine ? " is-mine" : ""}`}>
      <span className="pt-msg-m">
        {e.mine ? "شما" : (e.author_name ?? "میز خدمت")}
        {e.staff && !e.mine ? " · کارشناس" : ""} · <span title={formatJalaliDateTime(e.at)}>{ago(e.at)}</span>
      </span>
      {e.body ? (
        <div className="pt-msg-b">
          <RecordMarkdown text={e.body} />
        </div>
      ) : null}
      {files.length ? (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <a key={f.id} className="pt-chip-btn" href={attachmentUrl(orgId, f.id)} target="_blank" rel="noopener noreferrer">
              <Paperclip {...I16} aria-hidden /> {f.name}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Composer({ t, onSent }: { t: PortalTicket; onSent: (t: PortalTicket) => void }) {
  const { api, orgId } = useOrg();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const suggest = async () => {
    setThinking(true);
    try {
      const r = await portalApi.suggest(api, t.table, t.id);
      setIdeas(r.suggestions);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setThinking(false);
    }
  };
  const send = async () => {
    const body = text.trim() || (files.length ? "پیوست را ببینید." : "");
    if (!body) return;
    setBusy(true);
    setProblem(null);
    try {
      const ids: string[] = [];
      for (const f of files) ids.push(String((await uploadAttachment(orgId, t.table, t.id, f)).id));
      const next = await portalApi.reply(api, t.table, t.id, body, ids);
      setText("");
      setFiles([]);
      setIdeas(null);
      onSent(next);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pt-card pt-composer">
      <label htmlFor="pt-reply" className="font-medium">
        پاسخ یا توضیح تازه
      </label>
      <Input.TextArea
        id="pt-reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoSize={{ minRows: 2, maxRows: 10 }}
        maxLength={20_000}
        placeholder="پیامتان را بنویسید؛ کارشناس آن را می‌بیند"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
        }}
      />
      {ideas && ideas.length ? (
        <div className="pt-suggestions" aria-label="پاسخ‌های پیشنهادی">
          {ideas.map((s) => (
            <button key={s} type="button" className="pt-chip-btn" onClick={() => setText((v) => (v.trim() ? `${v.trim()}\n${s}` : s))}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
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
      {problem ? <Alert type="error" title={problem} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = e.target.files;
            if (list) setFiles((p) => [...p, ...Array.from(list)].slice(0, MAX_FILES));
            e.target.value = "";
          }}
        />
        <Button type="primary" icon={<Send {...I16} />} loading={busy} disabled={!text.trim() && !files.length} onClick={send}>
          فرستادن
        </Button>
        <Tooltip title="تا ۵ پرونده">
          <Button icon={<Paperclip {...I16} />} onClick={() => input.current?.click()} disabled={files.length >= MAX_FILES}>
            پیوست
          </Button>
        </Tooltip>
        <Button type="text" icon={<Sparkles {...I16} />} loading={thinking} onClick={suggest}>
          پیشنهاد پاسخ
        </Button>
      </div>
    </div>
  );
}

function ActionDialog({ t, action, onClose, onDone }: { t: PortalTicket; action: PortalAction | null; onClose: () => void; onDone: (t: PortalTicket) => void }) {
  const { api } = useOrg();
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setComment("");
    setRating(0);
    setProblem(null);
  }, [action]);
  if (!action) return null;
  const confirm = action.key === "confirm";
  const run = async () => {
    if (action.comment === "required" && !comment.trim()) {
      setProblem(action.key === "reopen" ? "بنویسید چه چیزی هنوز درست نشده است" : "علت را بنویسید");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onDone(await portalApi.action(api, t.table, t.id, action.key, comment.trim() || null, confirm && rating ? rating : null));
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const title = confirm ? "مشکل حل شد؟" : action.label;
  return (
    <Modal open title={title} onCancel={onClose} onOk={run} okText={action.label} cancelText="انصراف" confirmLoading={busy} okButtonProps={{ danger: action.tone === "danger" }} destroyOnHidden>
      <div className="flex flex-col gap-3">
        {confirm ? (
          <div className="flex flex-col gap-1">
            <span>از رسیدگی چقدر راضی بودید؟</span>
            <Rate value={rating} onChange={setRating} aria-label="امتیاز رضایت از یک تا پنج" />
          </div>
        ) : null}
        {action.comment !== "none" ? (
          <Input.TextArea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={4000}
            placeholder={action.key === "reopen" ? "چه چیزی هنوز درست نشده است؟" : action.key === "cancel" || action.key === "withdraw" ? "چرا دیگر لازم نیست؟" : confirm ? "اگر نکته‌ای دارید بنویسید (اختیاری)" : "توضیح (اختیاری)"}
            aria-label="توضیح"
          />
        ) : null}
        {problem ? <Alert type="error" title={problem} /> : null}
      </div>
    </Modal>
  );
}

export default function Ticket({ cfg }: { cfg: PortalConfig }) {
  const { table = "", id = "" } = useParams();
  const { api, orgId } = useOrg();
  const loc = useLocation();
  const navigate = useNavigate();
  const notify = useNotify();
  const qc = useQueryClient();
  const refresh = usePortalRefresh();
  const q = usePortalTicket(table, id);
  const [action, setAction] = useState<PortalAction | null>(null);
  const t = q.data;
  const state = (loc.state ?? {}) as { created?: boolean; failed?: string[] };
  const put = (next: PortalTicket) => {
    qc.setQueryData(PORTAL_KEYS.ticket(orgId, table, id), next);
    void refresh.todo();
  };

  if (q.isLoading)
    return (
      <div className="pt-card">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  if (!t) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return <Empty title={gone ? "این مورد پیدا نشد" : "بارگذاری نشد"} text={gone ? "شاید پیوند اشتباه است یا این مورد به شما مربوط نیست." : errorText(q.error)} action={<Button onClick={() => navigate(portalPath(orgId, "requests"))}>درخواست‌های من</Button>} />;
  }
  const chase = t.actions.find((a) => a.key === "chase");
  const others = t.actions.filter((a) => a.key !== "chase");

  return (
    <>
      <PageHead
        title={t.title || t.number || t.kind_label}
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{t.kind_label}</span>
            {t.number ? <bdi className="ltr">{t.number}</bdi> : null}
            {t.for_name ? <span>برای {t.for_name}</span> : null}
            {t.opened_at ? <span>ثبت: {formatJalaliDateTime(t.opened_at)}</span> : null}
          </span>
        }
        back={{ to: portalPath(orgId, "requests"), label: "درخواست‌های من" }}
        actions={<StageChip card={t} />}
      />
      {state.created ? (
        <Alert
          className="mb-4"
          type="success"
          showIcon
          title={`ثبت شد${t.number ? `؛ شمارهٔ پیگیری ${t.number}` : ""}`}
          description={state.failed?.length ? `این پرونده‌ها پیوست نشدند: ${state.failed.join("، ")} — دوباره از بخش گفتگو بفرستید.` : "هر پیام کارشناس و هر تغییر وضعیت را همین‌جا و در اعلان‌ها می‌بینید."}
        />
      ) : null}
      <div className="pt-two">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="pt-card flex flex-col gap-3">
            <Steps t={t} />
            {t.promise ? (
              <div className="flex items-center gap-2 text-[13px]" data-late={t.promise.late || undefined}>
                <Clock {...I16} aria-hidden className={t.promise.late ? "text-warning" : "text-ink-3"} />
                <span>
                  {t.promise.label}: <b className="font-medium">{formatJalaliDateTime(t.promise.due_at)}</b>
                  {t.promise.late ? <span className="text-warning"> — دیرتر از وعده شده؛ کارشناسان در جریان‌اند</span> : null}
                </span>
              </div>
            ) : null}
            {t.outage ? <Alert type={t.outage.kind === "outage" ? "error" : "warning"} showIcon icon={<AlertTriangle {...I16} />} title={`این مورد بخشی از یک اختلال گسترده است: ${t.outage.title}`} description="کارشناسان روی آن کار می‌کنند؛ با رفع اختلال، این مورد هم به‌روز می‌شود." /> : null}
            {t.stage === "waiting_you" ? <Alert type="warning" showIcon title="منتظر پاسخ شما" description="کارشناس پرسشی دارد؛ پاسخ را در گفتگوی پایین بنویسید." /> : null}
            {t.survey ? (
              <Alert
                type="info"
                showIcon
                icon={<MessageSquareHeart {...I16} />}
                title="نظر شما دربارهٔ این رسیدگی"
                description="یک دقیقه وقت می‌گیرد و به بهتر شدن خدمت کمک می‌کند."
                action={<Button size="small" type="primary" onClick={() => navigate(portalPath(orgId, `surveys/${t.survey!.invitation_id}`))}>پاسخ دادن</Button>}
              />
            ) : null}
            {t.rating ? (
              <div className="flex items-center gap-2 text-[13px] text-ink-3">
                <CheckCircle2 {...I16} aria-hidden /> امتیاز شما: <Rate disabled value={t.rating} className="text-[14px]" />
              </div>
            ) : null}
            {others.length || chase ? (
              <div className="flex flex-wrap gap-2">
                {others.map((a) => (
                  <Button key={a.key} type={a.tone === "primary" ? "primary" : "default"} danger={a.tone === "danger"} onClick={() => setAction(a)}>
                    {a.label}
                  </Button>
                ))}
                {chase ? (
                  <Button
                    type="text"
                    onClick={async () => {
                      try {
                        put(await portalApi.action(api, t.table, t.id, "chase"));
                        notify.ok("پیگیری شما به کارشناسان رسید");
                      } catch (e) {
                        notify.error(e);
                      }
                    }}
                  >
                    {chase.label}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {t.resolution ? (
            <div className="pt-card flex flex-col gap-2" data-tone="in">
              <span className="font-medium">{t.table === "portal_feedback" ? "پاسخ میز خدمت" : "راه‌حل"}</span>
              <RecordMarkdown text={t.resolution} />
            </div>
          ) : null}

          {t.description || t.answers.length ? (
            <div className="pt-card flex flex-col gap-3">
              {t.description ? <RecordMarkdown text={t.description} /> : null}
              {t.answers.length ? (
                <dl className="pt-facts">
                  {t.answers.map((a) => (
                    <div key={a.label} className="contents">
                      <dt>{a.label}</dt>
                      <dd>{a.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}

          <Section title="گفتگو">
            <div className="flex flex-col gap-4">
              {t.timeline.length ? (
                <div className="pt-thread" aria-live="polite">
                  {t.timeline.map((e) => (
                    <Entry key={e.id} e={e} />
                  ))}
                </div>
              ) : (
                <p className="pt-muted m-0 text-[13px]">هنوز پیامی نیست.</p>
              )}
              {t.can_comment ? <Composer t={t} onSent={put} /> : <p className="pt-muted m-0 text-[13px]">این مورد بسته است؛ اگر مشکل دوباره پیش آمد، {cfg.can.report ? "گزارش تازه‌ای ثبت کنید" : "با میز خدمت تماس بگیرید"}.</p>}
            </div>
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          {t.facts.length ? (
            <div className="pt-card">
              <dl className="pt-facts">
                {t.facts.map((f) => (
                  <div key={f.label} className="contents">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {t.approvals ? (
            <div className="pt-card flex flex-col gap-1 text-[13px]">
              <span className="font-medium">تأیید</span>
              <span className="text-ink-2">{t.approvals.label}</span>
              {t.approvals.pending ? <span className="text-ink-3">{t.approvals.pending.toLocaleString("fa-IR")} تأیید در انتظار</span> : null}
            </div>
          ) : null}
          <div className="pt-card flex flex-col gap-2">
            <span className="font-medium">پرونده‌ها</span>
            {t.attachments.length ? (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {t.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Paperclip {...I16} aria-hidden className="text-ink-3" />
                    <a className="ds-link min-w-0 flex-1 truncate" href={attachmentUrl(orgId, a.id, a.previewable)} target="_blank" rel="noopener noreferrer">
                      {a.name}
                    </a>
                    <span className="text-ink-3">{fileSize(a.size)}</span>
                    <a href={attachmentUrl(orgId, a.id)} aria-label={`بارگیری ${a.name}`} className="text-ink-3">
                      <Download {...I16} />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[13px] text-ink-3">پرونده‌ای پیوست نشده است.</span>
            )}
          </div>
        </aside>
      </div>
      <ActionDialog
        t={t}
        action={action}
        onClose={() => setAction(null)}
        onDone={(next) => {
          const done = action;
          setAction(null);
          put(next);
          notify.ok(done?.key === "confirm" ? "سپاس؛ این مورد بسته شد" : done?.key === "reopen" ? "دوباره باز شد؛ کارشناسان در جریان‌اند" : "انجام شد");
        }}
      />
    </>
  );
}
