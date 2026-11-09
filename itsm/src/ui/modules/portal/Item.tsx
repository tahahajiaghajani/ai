// Ordering a service in the portal (PTL-008, PTL-009): the item's description and promise, the request module's own
// order form (`OrderForm`: questions, form policies, prices) with knowledge's deflection under it (the order form's
// assist slot: articles for what the person is typing, «مشکلم حل شد» ends without a request), «برای چه کسی» when
// they order for someone else, the privacy notice, then «ثبت درخواست». The server checks everything again; its problems
// land on the questions. After ordering, the new request's page opens in the portal.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert, Button, Checkbox, InputNumber } from "antd";
import { Send } from "lucide-react";
import { checkAnswers, type Answers } from "@shared/request/form";
import { todayISO } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { ApiError, errorText } from "../../lib/api";
import { Field, Note } from "../../components/blocks";
import { Loader } from "../../components/display";
import { RecordMarkdown, UserSelect, useMe } from "../../records";
import { OrderForm, initialAnswers } from "../request/OrderForm";
import { requestApi, useItemForm } from "../request/api";
import { answerErrors, lineErrors } from "../request/model";
import { orderAssist, typedText } from "../request/slots";
import { portalItemTableKeys } from "./tables";
import { portalApi, usePortalRefresh, type PortalConfig } from "./api";
import { portalPath, ticketPath } from "./model";
import { I16, PageHead } from "./parts";

export default function Item({ cfg }: { cfg: PortalConfig }) {
  const { id = "" } = useParams();
  const { api, orgId, timezone } = useOrg();
  const navigate = useNavigate();
  const refresh = usePortalRefresh();
  const { userId } = useMe();
  const [forOther, setForOther] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const forUser = forOther && person ? person : null;
  const q = useItemForm(id, forUser);
  const form = q.data;
  const [answers, setAnswers] = useState<Answers>({});
  const [quantity, setQuantity] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const assist = orderAssist();

  useEffect(() => {
    if (!form) return;
    setAnswers(initialAnswers(form.schema, forUser ?? userId, todayISO(timezone)));
    setQuantity(1);
    setErrors({});
    setProblem(null);
  }, [form, forUser, userId, timezone]);

  const item = form?.item;
  const summary = useMemo(() => ({ quantity, promise: form?.promise?.text ?? item?.promise ?? null, sle: item?.sle ?? null }), [quantity, form, item]);

  const submit = async () => {
    if (!form) return;
    const r = checkAnswers(form.schema, answers, { mode: "order" });
    setErrors(r.errors);
    if (Object.keys(r.errors).length) {
      setProblem("چند پرسش پاسخ درستی ندارد؛ آن‌ها را بازبینی کنید");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await requestApi.order(api, { lines: [{ item_id: id, answers, quantity, requested_for: forUser ?? userId }], requested_for: forUser ?? userId, channel: "portal" });
      void portalApi.event(api, { kind: res.produced?.table === "incident" ? "report" : "order", ref_table: "catalog_item", ref_id: id });
      void refresh.all();
      const target = res.produced && portalItemTableKeys.includes(res.produced.table) ? ticketPath(orgId, res.produced.table, res.produced.id) : res.items[0] ? ticketPath(orgId, "request_item", res.items[0].id) : portalPath(orgId, "requests");
      navigate(target, { state: { created: true } });
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "fields" in (e.details as object)) {
        const fields = (e.details as { fields: Record<string, string> }).fields;
        setErrors(answerErrors(fields));
        setProblem([...lineErrors(fields), e.message].filter(Boolean)[0] ?? e.message);
      } else setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Loader />;
  if (q.error || !form || !item) return <Alert type="error" title={q.error ? errorText(q.error) : "این خدمت پیدا نشد"} />;
  return (
    <>
      <PageHead title={item.name} sub={item.short_description ?? undefined} back={{ to: portalPath(orgId, "catalog"), label: "خدمت‌ها" }} />
      <div className="pt-two">
        <div className="pt-card flex flex-col gap-4">
          {item.why ? <Alert type="warning" title={item.why} /> : null}
          {form.schema.item.description ? <RecordMarkdown text={form.schema.item.description} /> : null}
          {form.schema.item.on_behalf !== "self" ? (
            <div className="flex flex-col gap-2">
              <Checkbox checked={forOther} onChange={(e) => setForOther(e.target.checked)}>
                برای شخص دیگری درخواست می‌دهم
              </Checkbox>
              {forOther ? (
                <Field label="برای چه کسی">
                  <UserSelect value={person ?? undefined} onChange={(v) => setPerson(typeof v === "string" ? v : null)} />
                </Field>
              ) : null}
            </div>
          ) : null}
          {form.schema.item.quantity_allowed ? (
            <Field label="تعداد">
              <InputNumber min={1} max={form.schema.item.max_quantity ?? 1000} value={quantity} onChange={(v) => setQuantity(Math.max(1, Number(v) || 1))} />
            </Field>
          ) : null}
          <OrderForm schema={form.schema} answers={answers} onChange={setAnswers} errors={errors} display={form.display} summary={summary} />
          {assist ? assist({ itemId: id, itemType: String(form.schema.item.type), text: typedText(answers), onSolved: () => { void portalApi.event(api, { kind: "deflect", ref_table: "catalog_item", ref_id: id }); navigate(portalPath(orgId)); } }) : null}
          {problem ? <Alert type="error" title={problem} /> : null}
          {cfg.portal.privacy_notice ? (
            <Note>
              <RecordMarkdown text={cfg.portal.privacy_notice} />
            </Note>
          ) : null}
          <div>
            <Button type="primary" size="large" icon={<Send {...I16} />} loading={busy} disabled={!item.orderable} onClick={submit}>
              {item.button_label || "ثبت درخواست"}
            </Button>
          </div>
        </div>
        <aside className="pt-card flex flex-col gap-2 text-[13px]">
          <span className="font-medium">چه زمانی انجام می‌شود؟</span>
          <span className="text-ink-2">{form.promise?.text || item.promise || "پس از ثبت، زمان انجام را در صفحهٔ درخواست می‌بینید."}</span>
          {item.sle ? <span className="text-ink-3">{item.sle}</span> : null}
          <span className="mt-2 font-medium">پس از ثبت</span>
          <span className="text-ink-2">درخواست در «درخواست‌های من» می‌آید؛ هر پیام کارشناس و هر تغییر وضعیت را آن‌جا و در اعلان‌ها می‌بینید.</span>
        </aside>
      </div>
    </>
  );
}
