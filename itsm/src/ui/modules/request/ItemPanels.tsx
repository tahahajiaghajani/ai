// Record-page widgets of the request module (registered in index.tsx):
//   «پاسخ‌ها» (tab of requested items and fulfilment tasks): the answers as the caller may see them — a fulfiller of
//      another group sees the answers of the item their task belongs to —, «ویرایش پاسخ‌ها» for the requester before
//      approval or a fulfiller while the item is open, secret answers revealed one by one (journalled)
//   «پیشرفت» (side panel of requested items): the stage bar, the promised date, tasks and approvals in brief
//   header actions of requested items: «درخواست اطلاعات», «بازخورد», «سفارش دوباره», «تغییر قلم», «تبدیل به رخداد»
//   «فهرست وارسی» (side panel of tasks): the template's checklist, ticked off one by one
//   header actions of catalogue items: «سازندهٔ کاتالوگ» and «سفارش»
import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Rate, Space, Tooltip } from "antd";
import { Eye, HelpCircle, MessageSquareHeart, Pencil, RotateCcw, Replace, Siren, Wrench, ShoppingBag } from "lucide-react";
import { useNavigate } from "react-router";
import { checkAnswers, type Answers } from "@shared/request/form";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { ApiError, errorText } from "../../lib/api";
import { Loader, EmptyState, JDate } from "../../components/display";
import { Field, ICON, ICON14 } from "../../components/blocks";
import { RecordSelect, recordPath, useSchema, type RecordContext } from "../../records";
import { OrderForm } from "./OrderForm";
import { requestApi, useAnswers, useProgress, useRequestRefresh } from "./api";
import { answerErrors, stageSteps } from "./model";

/** The answers of the item behind a requested item or a task. */
export function AnswersTab({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const notify = useNotify();
  const refresh = useRequestRefresh();
  const q = useAnswers(ctx.table, ctx.row.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, unknown>>({});
  const v = q.data;
  useEffect(() => {
    if (v) setDraft(v.answers);
  }, [v]);
  const save = useAction(() => requestApi.editAnswers(api, v!.item_id, draft, ctx.table === "request_item" ? Number(ctx.row.version) : undefined), {
    success: "پاسخ‌ها ذخیره شد.",
    onSuccess: () => {
      setEditing(false);
      void refresh.record(String(ctx.row.id));
      ctx.refresh();
    },
  });
  if (q.isLoading) return <Loader />;
  if (q.error) return <Alert type="error" title={errorText(q.error)} />;
  if (!v) return null;
  const reveal = async (name: string) => {
    try {
      const r = await requestApi.reveal(api, v.item_id, name);
      setRevealed((x) => ({ ...x, [name]: r.value }));
    } catch (e) {
      notify.error(errorText(e));
    }
  };
  const submit = () => {
    const r = checkAnswers(v.schema, draft, { mode: "fulfil", secretsKept: new Set(v.secrets) });
    setErrors(r.errors);
    if (Object.keys(r.errors).length) return;
    save.mutate(undefined, {
      onError: (e) => {
        if (e instanceof ApiError && e.details && typeof e.details === "object" && "fields" in (e.details as object)) setErrors(answerErrors((e.details as { fields: Record<string, string> }).fields));
      },
    });
  };
  return (
    <div className="rq-form">
      {ctx.table === "request_task" && v.number ? <div className="rq-card-f">پاسخ‌های {v.number}</div> : null}
      <OrderForm schema={v.schema} answers={editing ? draft : v.answers} onChange={setDraft} readOnly={!editing} mode="fulfil" errors={errors} display={v.display} />
      {!v.sensitive ? <div className="rq-card-f">پاسخ‌های حساس فقط برای درخواست‌کننده و کارشناسان دارای دسترسی «اطلاعات شخصی» نمایش داده می‌شوند.</div> : null}
      {v.secrets.length ? (
        <Field label="پاسخ‌های محرمانه">
          <Space orientation="vertical">
            {v.secrets.map((s) => {
              const label = v.schema.variables.find((x) => x.name === s)?.label ?? s;
              return (
                <Space key={s}>
                  <span>{label}:</span>
                  {s in revealed ? <bdi className="ltr">{String(revealed[s] ?? "")}</bdi> : <span>••••</span>}
                  {v.can_reveal && !(s in revealed) ? (
                    <Button size="small" icon={<Eye {...ICON14} />} onClick={() => reveal(s)}>
                      نمایش (ثبت می‌شود)
                    </Button>
                  ) : null}
                </Space>
              );
            })}
          </Space>
        </Field>
      ) : null}
      {v.can_edit ? (
        <Space>
          {editing ? (
            <>
              <Button type="primary" loading={save.isPending} onClick={submit}>
                ذخیرهٔ پاسخ‌ها
              </Button>
              <Button
                onClick={() => {
                  setEditing(false);
                  setDraft(v.answers);
                  setErrors({});
                }}
              >
                انصراف
              </Button>
            </>
          ) : (
            <Button icon={<Pencil {...ICON14} />} onClick={() => setEditing(true)}>
              ویرایش پاسخ‌ها
            </Button>
          )}
        </Space>
      ) : null}
    </div>
  );
}

/** The stage bar of a requested item with its promise, tasks and approvals. */
export function ProgressPanel({ ctx }: { ctx: RecordContext }) {
  const q = useProgress(String(ctx.row.id));
  // the record's own state and stage move first; the panel follows with the page
  useEffect(() => {
    void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.row.state, ctx.row.stage]);
  const p = q.data;
  if (!p) return q.isLoading ? <Loader /> : null;
  const steps = stageSteps(p.state, p.stage, p.stages.filter((s) => s.key !== "rejected" && s.key !== "cancelled").map((s) => s.key));
  return (
    <div className="rq-form">
      <ol className="rq-stages" aria-label="مرحلهٔ درخواست">
        {steps.map((s) => (
          <li key={s.key} className={`rq-stage is-${s.status}${s.key === "rejected" || s.key === "cancelled" ? " is-end" : ""}`} aria-current={s.status === "current" ? "step" : undefined}>
            <i aria-hidden />
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      {p.due_at ? (
        <div className={p.overdue ? "rq-err" : "rq-card-f"}>
          موعد تحویل: <JDate v={p.due_at} />
          {p.overdue ? " (گذشته)" : ""}
        </div>
      ) : null}
      {p.approvals.pending || p.approvals.approved || p.approvals.rejected ? (
        <div className="rq-card-f">
          تأییدها: {p.approvals.approved.toLocaleString("fa-IR")} تأیید
          {p.approvals.pending ? `، ${p.approvals.pending.toLocaleString("fa-IR")} در انتظار` : ""}
          {p.approvals.rejected ? `، ${p.approvals.rejected.toLocaleString("fa-IR")} رد` : ""}
        </div>
      ) : null}
      {p.tasks.length ? (
        <ul className="rq-bars" aria-label="وظایف انجام">
          {p.tasks.map((t) => (
            <li key={t.id} className="rq-line-m">
              <span>{t.number}</span>
              <span>{t.title}</span>
              <span>{taskStateLabel(t.state)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const TASK_STATES: Record<string, string> = { pending: "در انتظار نوبت", open: "باز", work_in_progress: "در حال انجام", on_hold: "معلق", closed_complete: "انجام‌شده", closed_incomplete: "انجام نشد", cancelled: "لغوشده", skipped: "لازم نشد" };
const taskStateLabel = (s: string) => TASK_STATES[s] ?? s;

/** Header actions of a requested item (what the caller may do shows; the server decides again). */
export function ItemActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const notify = useNotify();
  const { schema } = useSchema();
  const refresh = useRequestRefresh();
  const [dialog, setDialog] = useState<"info" | "feedback" | "change" | "convert" | null>(null);
  const [text, setText] = useState("");
  const [rating, setRating] = useState(5);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const row = ctx.row;
  const state = String(row.state);
  const working = ["in_fulfilment", "backordered"].includes(state);
  const open = ["pending", "awaiting_approval", "in_fulfilment", "awaiting_info", "backordered"].includes(state);
  const finished = ["delivered", "closed_complete", "closed_incomplete"].includes(state);
  const canWrite = !!ctx.meta.canWrite;
  // incident management is installed and the person may file incidents
  const hasIncident = !!schema?.def("incident")?.can.create;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      notify.ok(ok);
      setDialog(null);
      setText("");
      ctx.refresh();
      void refresh.record(String(row.id));
    } catch (e) {
      notify.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const again = async () => {
    try {
      const r = await requestApi.reorder(api, String(row.id));
      if (!r.available) {
        notify.warn("این قلم دیگر برای سفارش در دسترس نیست");
        return;
      }
      try {
        sessionStorage.setItem(`itsm.request.reorder.${r.item_id}`, JSON.stringify({ answers: r.answers, quantity: r.quantity }));
      } catch {
        // no storage: the form opens with its defaults
      }
      navigate(`/${orgId}/catalog?item=${r.item_id}`);
    } catch (e) {
      notify.error(errorText(e));
    }
  };
  return (
    <>
      {canWrite && working ? (
        <Button icon={<HelpCircle {...ICON} />} onClick={() => setDialog("info")}>
          درخواست اطلاعات
        </Button>
      ) : null}
      {finished && !row.rating ? (
        <Button icon={<MessageSquareHeart {...ICON} />} onClick={() => setDialog("feedback")}>
          بازخورد
        </Button>
      ) : null}
      <Tooltip title="همین قلم را با همین پاسخ‌ها دوباره سفارش دهید">
        <Button icon={<RotateCcw {...ICON} />} onClick={again}>
          سفارش دوباره
        </Button>
      </Tooltip>
      {canWrite && open ? (
        <Button icon={<Replace {...ICON} />} onClick={() => setDialog("change")}>
          تغییر قلم
        </Button>
      ) : null}
      {canWrite && open && hasIncident ? (
        <Button icon={<Siren {...ICON} />} onClick={() => setDialog("convert")}>
          تبدیل به رخداد
        </Button>
      ) : null}
      <Modal open={dialog === "info"} title="درخواست اطلاعات از درخواست‌کننده" okText="فرستادن" cancelText="انصراف" confirmLoading={busy} onCancel={() => setDialog(null)} onOk={() => run(() => requestApi.info(api, String(row.id), text), "پرسش فرستاده شد؛ قلم منتظر پاسخ است.")} okButtonProps={{ disabled: !text.trim() }} destroyOnHidden>
        <Field label="پرسش شما" hint="درخواست‌کننده آن را می‌بیند؛ زمان انتظار از توافق کم می‌شود">
          <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} maxLength={4000} autoFocus />
        </Field>
      </Modal>
      <Modal open={dialog === "feedback"} title="بازخورد شما" okText="ثبت" cancelText="انصراف" confirmLoading={busy} onCancel={() => setDialog(null)} onOk={() => run(() => requestApi.feedback(api, String(row.id), rating, text), "سپاس از بازخورد شما.")} destroyOnHidden>
        <Field label="از انجام این قلم چقدر راضی هستید؟">
          <Rate value={rating} onChange={setRating} />
        </Field>
        <Field label="نظر (اختیاری)">
          <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} />
        </Field>
      </Modal>
      <Modal open={dialog === "change"} title="تغییر قلم کاتالوگ" okText="تغییر" cancelText="انصراف" confirmLoading={busy} onCancel={() => setDialog(null)} onOk={() => run(() => requestApi.changeItem(api, String(row.id), target!, true), "قلم عوض شد؛ پاسخ‌های هم‌نام منتقل شد.")} okButtonProps={{ disabled: !target }} destroyOnHidden>
        <Field label="قلم تازه" hint="پاسخ‌های هم‌نام منتقل می‌شوند؛ پرسش‌های بی‌پاسخ را پس از تغییر کامل کنید">
          <RecordSelect table="catalog_item" filter={{ f: "state", op: "eq", v: "published" }} value={target} onChange={(v) => setTarget(typeof v === "string" ? v : null)} />
        </Field>
      </Modal>
      <Modal
        open={dialog === "convert"}
        title="تبدیل به رخداد"
        okText="تبدیل"
        cancelText="انصراف"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onCancel={() => setDialog(null)}
        onOk={async () => {
          setBusy(true);
          try {
            const r = await requestApi.convert(api, String(row.id), text);
            setDialog(null);
            navigate(`/${orgId}/${recordPath(r.table, r.id)}`);
          } catch (e) {
            notify.error(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
        destroyOnHidden
      >
        <p>یک رخداد با درخواست‌کننده، عنوان و پاسخ‌های این قلم ساخته و به آن پیوند داده می‌شود؛ این قلم با نتیجهٔ «تبدیل شد» بسته می‌شود.</p>
        <Field label="یادداشت (اختیاری)">
          <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={4000} />
        </Field>
      </Modal>
    </>
  );
}

/** The checklist of a fulfilment task (from its template), ticked off by whoever works it. */
export function TaskChecklist({ ctx }: { ctx: RecordContext }) {
  const list = Array.isArray(ctx.row.checklist) ? (ctx.row.checklist as { text: string; done?: boolean }[]) : [];
  if (!list.length) return <EmptyState compact title="فهرست وارسی ندارد" />;
  const can = !!ctx.meta.canWrite && !ctx.meta.locked;
  return (
    <div className="rq-bars">
      {list.map((c, i) => (
        <Checkbox key={i} checked={!!c.done} disabled={!can} onChange={(e) => void ctx.save({ checklist: list.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })}>
          {c.text}
        </Checkbox>
      ))}
      <span className="rq-card-f">
        {list.filter((c) => c.done).length.toLocaleString("fa-IR")} از {list.length.toLocaleString("fa-IR")} انجام شد
      </span>
    </div>
  );
}

/** Header actions of a catalogue item: its builder, and ordering it. */
export function CatalogItemActions({ ctx }: { ctx: RecordContext }) {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  return (
    <>
      <Button icon={<Wrench {...ICON} />} onClick={() => navigate(`/${orgId}/catalog-items/${ctx.row.id}/builder`)}>
        سازندهٔ کاتالوگ
      </Button>
      {ctx.row.state === "published" ? (
        <Button icon={<ShoppingBag {...ICON} />} onClick={() => navigate(`/${orgId}/catalog?item=${ctx.row.id}`)}>
          سفارش
        </Button>
      ) : null}
    </>
  );
}
