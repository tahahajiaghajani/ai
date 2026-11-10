// Ordering one item (REQ-002, REQ-015, REQ-016, REQ-018…REQ-020): the item's description, the order form, for whom
// (one person, or several for items ordered for many people at once), the quantity, the price of the answers and the
// delivery promise; «ثبت سفارش» places the order at once, «افزودن به سبد» keeps it in the cart, and a cart line opens
// here to be edited. The browser checks the answers first; the server checks them again and its problems land on the
// questions. With the AI layer installed, «پر کردن از متن» suggests answers from a description.
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Input, InputNumber, Modal, Space } from "antd";
import { ShoppingCart, Send, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { checkAnswers, type Answers } from "@shared/request/form";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ApiError, errorText } from "../../lib/api";
import { Field, ICON } from "../../components/blocks";
import { Loader } from "../../components/display";
import { RecordMarkdown, UserSelect, recordPath, useMe, useSchema } from "../../records";
import { OrderForm, initialAnswers } from "./OrderForm";
import { requestApi, useItemForm, useRequestConfig, useRequestRefresh, type CartLine, type OrderResult } from "./api";
import { answerErrors, lineErrors, orderDoneLabel } from "./model";
import { orderAssist, typedText } from "./slots";

export interface OrderDrawerProps {
  itemId: string | null;
  /** the person the order is for (default: the caller) */
  forUser?: string | null;
  open: boolean;
  onClose: () => void;
  /** answers to start from («سفارش دوباره», a guide's cascade) */
  initial?: { answers?: Answers; quantity?: number } | null;
  /** a cart line being edited */
  line?: CartLine | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** «REQ0000012 ثبت شد» with a link to the order (or the record a form produced). */
export function useOrderDone() {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  const { schema } = useSchema();
  return (r: OrderResult) => {
    const target = r.produced ? { table: r.produced.table, id: r.produced.id, number: r.produced.number } : r.request ? { table: "request", id: r.request.id, number: r.request.number } : null;
    Modal.success({
      title: r.produced ? "ثبت شد" : "سفارش ثبت شد",
      content: (
        <div>
          {target?.number ? <p>شمارهٔ پیگیری: <bdi className="ltr">{target.number}</bdi></p> : null}
          {r.items.length ? <p>{r.items.length.toLocaleString("fa-IR")} قلم ثبت شد؛ پیشرفت هر قلم را در صفحهٔ سفارش ببینید.</p> : null}
        </div>
      ),
      okText: orderDoneLabel(target, target ? schema?.def(target.table)?.label : null),
      onOk: () => {
        if (target) navigate(`/${orgId}/${recordPath(target.table, target.id)}`);
      },
    });
  };
}

export default function OrderDrawer({ itemId, forUser, open, onClose, initial, line }: OrderDrawerProps) {
  const { api } = useOrg();
  const { userId } = useMe();
  const notify = useNotify();
  const refresh = useRequestRefresh();
  const done = useOrderDone();
  const person = forUser || userId;
  const q = useItemForm(open ? itemId : null, person !== userId ? person : null);
  const ai = useRequestConfig().data?.ai ?? [];
  const form = q.data;
  const [answers, setAnswers] = useState<Answers>({});
  const [quantity, setQuantity] = useState(1);
  const [people, setPeople] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"order" | "cart" | "save" | "ai" | null>(null);
  const [text, setText] = useState("");
  const assist = orderAssist();

  useEffect(() => {
    if (!form) return;
    const start = line?.answers ?? initial?.answers ?? null;
    setAnswers({ ...initialAnswers(form.schema, person, today()), ...(start ?? {}) });
    setQuantity(line?.quantity ?? initial?.quantity ?? 1);
    setPeople(line?.requested_for_list ?? []);
    setErrors({});
    setProblem(null);
  }, [form, line, initial, person]);

  const item = form?.item;
  const multi = !!form?.schema.item.multi_user;
  const canCart = !!item?.cart_allowed && form?.schema.item.type !== "record_producer";
  const summary = useMemo(() => ({ quantity, promise: form?.promise?.text ?? item?.promise ?? null, sle: item?.sle ?? null }), [quantity, form, item]);

  const check = (): boolean => {
    if (!form) return false;
    const r = checkAnswers(form.schema, answers, { mode: "order" });
    setErrors(r.errors);
    if (Object.keys(r.errors).length) {
      setProblem("چند پرسش پاسخ درستی ندارد؛ آن‌ها را بازبینی کنید");
      return false;
    }
    setProblem(null);
    return true;
  };
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.details && typeof e.details === "object" && "fields" in (e.details as object)) {
      const fields = (e.details as { fields: Record<string, string> }).fields;
      setErrors(answerErrors(fields));
      setProblem([...lineErrors(fields), e.message].filter(Boolean)[0] ?? e.message);
    } else setProblem(errorText(e));
  };
  const lineInput = () => ({
    item_id: itemId!,
    answers,
    quantity,
    requested_for: multi && people.length ? null : person,
    requested_for_list: multi ? people : [],
  });

  const orderNow = async () => {
    if (!check()) return;
    setBusy("order");
    try {
      const r = await requestApi.order(api, { lines: [lineInput()], requested_for: person, channel: "portal" });
      void refresh.all();
      onClose();
      done(r);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const toCart = async () => {
    if (!check()) return;
    setBusy(line ? "save" : "cart");
    try {
      if (line) await requestApi.updateLine(api, line.id, lineInput());
      else await requestApi.addLine(api, lineInput());
      void refresh.cart();
      notify.ok(line ? "قلم سبد به‌روز شد." : "به سبد افزوده شد.");
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const prefill = async () => {
    if (!itemId || text.trim().length < 3) return;
    setBusy("ai");
    try {
      const r = await requestApi.prefill(api, itemId, text);
      setAnswers((a) => ({ ...a, ...r.answers }));
      notify.ok(r.complete ? "پاسخ‌ها پیشنهاد شد؛ پیش از ثبت بازبینی کنید." : "بخشی از پاسخ‌ها پیشنهاد شد؛ بقیه را کامل کنید.");
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="large"
      destroyOnHidden
      title={item?.name ?? "سفارش"}
      footer={
        form ? (
          <Space wrap>
            {line ? (
              <Button type="primary" loading={busy === "save"} onClick={toCart}>
                ذخیره
              </Button>
            ) : (
              <>
                <Button type="primary" icon={<Send {...ICON} />} loading={busy === "order"} onClick={orderNow} disabled={!item?.orderable}>
                  {item?.button_label || "ثبت سفارش"}
                </Button>
                {canCart ? (
                  <Button icon={<ShoppingCart {...ICON} />} loading={busy === "cart"} onClick={toCart} disabled={!item?.orderable}>
                    افزودن به سبد
                  </Button>
                ) : null}
              </>
            )}
            <Button onClick={onClose}>انصراف</Button>
          </Space>
        ) : null
      }
    >
      {q.isLoading ? <Loader /> : null}
      {q.error ? <Alert type="error" title={errorText(q.error)} /> : null}
      {form ? (
        <div className="rq-form">
          {item?.why ? <Alert type="warning" title={item.why} /> : null}
          {form.schema.item.description ? <RecordMarkdown text={form.schema.item.description} /> : item?.short_description ? <p>{item.short_description}</p> : null}
          {ai.includes("request.prefill") && !line ? (
            <Field label="شرح آزاد نیاز" hint="هوش مصنوعی پاسخ‌ها را پیشنهاد می‌کند؛ پیش از ثبت آن‌ها را ببینید">
              <Space.Compact block>
                <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={4000} />
                <Button icon={<Sparkles {...ICON} />} loading={busy === "ai"} onClick={prefill}>
                  پر کردن
                </Button>
              </Space.Compact>
            </Field>
          ) : null}
          {multi ? (
            <Field label="برای این افراد" hint="برای هر نفر یک قلم جداگانه ثبت و پیگیری می‌شود؛ خالی یعنی فقط برای همان شخص">
              <UserSelect multiple value={people} onChange={(v) => setPeople(Array.isArray(v) ? v : v ? [v] : [])} />
            </Field>
          ) : null}
          {form.schema.item.quantity_allowed ? (
            <Field label="تعداد">
              <InputNumber min={1} max={form.schema.item.max_quantity ?? 1000} value={quantity} onChange={(v) => setQuantity(Math.max(1, Number(v) || 1))} />
            </Field>
          ) : null}
          <OrderForm schema={form.schema} answers={answers} onChange={setAnswers} errors={errors} display={form.display} summary={summary} />
          {assist && itemId && !line ? assist({ itemId, itemType: String(form.schema.item.type), text: typedText(answers), onSolved: onClose }) : null}
          {problem ? <Alert type="error" title={problem} /> : null}
        </div>
      ) : null}
    </Drawer>
  );
}
