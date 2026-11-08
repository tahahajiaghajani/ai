// An order guide (REQ-021): first its own questions («ورود کارمند جدید»: start date, needs…), then the items its rules
// include for those answers — mandatory ones locked in, optional ones chosen by the person — each with its form
// already filled with the guide's answers (cascade); one order places them all, each item approved and fulfilled on
// its own. The server checks again that the guide's mandatory items are in the order.
import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Collapse, Drawer, Space, Steps } from "antd";
import { checkAnswers, type Answers } from "@shared/request/form";
import { useOrg } from "../../lib/org";
import { ApiError, errorText } from "../../lib/api";
import { Loader } from "../../components/display";
import { Note } from "../../components/blocks";
import { useMe } from "../../records";
import { OrderForm, initialAnswers } from "./OrderForm";
import { requestApi, useItemForm, useRequestRefresh, type GuideLine } from "./api";
import { useOrderDone } from "./OrderDrawer";
import { answerErrors } from "./model";

const today = () => new Date().toISOString().slice(0, 10);

export default function GuideDrawer({ guideId, forUser, open, onClose }: { guideId: string | null; forUser?: string | null; open: boolean; onClose: () => void }) {
  const { api } = useOrg();
  const { userId } = useMe();
  const person = forUser || userId;
  const refresh = useRequestRefresh();
  const done = useOrderDone();
  const q = useItemForm(open ? guideId : null, person !== userId ? person : null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<(GuideLine & { chosen: boolean; errors: Record<string, string> })[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setAnswers(initialAnswers(q.data.schema, person, today()));
    setStep(0);
    setLines([]);
    setErrors({});
    setProblem(null);
  }, [q.data, person]);

  const next = async () => {
    if (!q.data || !guideId) return;
    const r = checkAnswers(q.data.schema, answers, { mode: "order" });
    setErrors(r.errors);
    if (Object.keys(r.errors).length) return;
    setBusy(true);
    try {
      const g = await requestApi.expand(api, guideId, { answers, for: person !== userId ? person : null });
      setLines(g.lines.map((l) => ({ ...l, chosen: l.selected, answers: { ...initialAnswers(l.schema, person, today()), ...l.answers }, errors: {} })));
      setStep(1);
      setProblem(g.lines.length ? null : "با این پاسخ‌ها قلمی در این راهنما گنجانده نمی‌شود");
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const order = async () => {
    if (!guideId) return;
    const chosen = lines.filter((l) => l.chosen);
    let bad = false;
    setLines((ls) =>
      ls.map((l) => {
        if (!l.chosen) return l;
        const r = checkAnswers(l.schema, l.answers, { mode: "order" });
        if (Object.keys(r.errors).length) bad = true;
        return { ...l, errors: r.errors };
      }),
    );
    if (bad) {
      setProblem("پرسش‌های چند قلم پاسخ درستی ندارند؛ آن‌ها را بازبینی کنید");
      return;
    }
    setBusy(true);
    try {
      const r = await requestApi.order(api, {
        guides: [{ id: guideId, answers }],
        requested_for: person,
        channel: "portal",
        lines: chosen.map((l) => ({ item_id: l.item.id, answers: l.answers, quantity: l.quantity, requested_for: person, guide_id: guideId })),
      });
      void refresh.all();
      onClose();
      done(r);
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "fields" in (e.details as object)) {
        const fields = (e.details as { fields: Record<string, string> }).fields;
        setLines((ls) => {
          let i = -1;
          return ls.map((l) => (l.chosen ? ((i += 1), { ...l, errors: answerErrors(fields, i) }) : l));
        });
      }
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="large"
      destroyOnHidden
      title={q.data?.item.name ?? "راهنمای سفارش"}
      footer={
        <Space wrap>
          {step === 0 ? (
            <Button type="primary" loading={busy} onClick={next} disabled={!q.data}>
              ادامه
            </Button>
          ) : (
            <>
              <Button type="primary" loading={busy} onClick={order} disabled={!lines.some((l) => l.chosen)}>
                ثبت سفارش ({lines.filter((l) => l.chosen).length.toLocaleString("fa-IR")} قلم)
              </Button>
              <Button onClick={() => setStep(0)}>بازگشت</Button>
            </>
          )}
          <Button onClick={onClose}>انصراف</Button>
        </Space>
      }
    >
      {q.isLoading ? <Loader /> : null}
      {q.error ? <Alert type="error" title={errorText(q.error)} /> : null}
      {q.data ? (
        <div className="rq-form">
          <Steps size="small" current={step} items={[{ title: "پرسش‌های راهنما" }, { title: "اقلام سفارش" }]} />
          {step === 0 ? (
            <>
              {q.data.item.short_description ? <p>{q.data.item.short_description}</p> : null}
              <OrderForm schema={q.data.schema} answers={answers} onChange={setAnswers} errors={errors} display={q.data.display} />
            </>
          ) : (
            <>
              <Note>اقلام اجباری این راهنما همیشه سفارش داده می‌شوند؛ بقیه را می‌توانید کنار بگذارید. پاسخ‌های راهنما در فرم هر قلم آمده است.</Note>
              <Collapse
                items={lines.map((l, i) => ({
                  key: l.rule_id,
                  label: (
                    <Space onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={l.chosen} disabled={l.mandatory} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, chosen: e.target.checked } : x)))}>
                        {l.item.name}
                      </Checkbox>
                      {l.mandatory ? <span className="rq-card-f">اجباری</span> : null}
                      {Object.keys(l.errors).length ? <span className="rq-err">پاسخ‌ها کامل نیست</span> : null}
                    </Space>
                  ),
                  children: (
                    <OrderForm
                      schema={l.schema}
                      answers={l.answers}
                      onChange={(a) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, answers: a } : x)))}
                      errors={l.errors}
                      summary={{ quantity: l.quantity, promise: l.item.promise }}
                    />
                  ),
                }))}
              />
            </>
          )}
          {problem ? <Alert type="error" title={problem} /> : null}
        </div>
      ) : null}
    </Drawer>
  );
}
