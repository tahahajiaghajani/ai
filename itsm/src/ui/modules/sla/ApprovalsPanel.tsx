// The «تأییدها» card of a record page: the record's approval state, each step (rule, level, round) with its people and
// their decisions, the caller's own pending approvals with approve / reject, and — for those who may change the
// record — an ad-hoc «درخواست تأیید» (people and groups, a rule, a deadline) and withdrawing what is still open.
import { useState } from "react";
import { Button, Form, Input, Modal, Popconfirm, Select } from "antd";
import { Check, X, Plus, Undo2 } from "lucide-react";
import { APPROVAL_RULES } from "@shared/tables/approvals";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Loader } from "../../components/display";
import { NumberInput } from "../../components/inputs";
import { ICON14 } from "../../components/blocks";
import { ChoiceTag, RecordSelect, UserChip, UserSelect, type RecordContext } from "../../records";
import { optionsOf } from "../../records/model/schema";
import { approvalsApi, useRecordApprovals, useSlaRefresh, type Decision } from "./api";
import { approvalSteps, dueState } from "./model";
import { ApprovalState, DecisionDialog } from "./parts";

const OPEN = new Set(["requested", "waiting"]);

export default function ApprovalsPanel({ ctx }: { ctx: RecordContext }) {
  const { api, timezone } = useOrg();
  const q = useRecordApprovals(ctx.table, ctx.row.id);
  const refresh = useSlaRefresh();
  const [dialog, setDialog] = useState<{ id: string; decision: Decision } | null>(null);
  const [asking, setAsking] = useState(false);
  const after = () => {
    void refresh.approvals();
    ctx.refresh();
  };
  const decide = useAction(({ id, decision, comment }: { id: string; decision: Decision; comment: string }) => approvalsApi.decide(api, id, decision, comment), {
    success: "تصمیم شما ثبت شد.",
    onSuccess: () => {
      setDialog(null);
      after();
    },
  });
  const cancel = useAction(() => approvalsApi.cancel(api, ctx.table, ctx.row.id), { success: "درخواست تأیید پس گرفته شد.", onSuccess: after });

  if (q.isLoading) return <Loader />;
  if (!q.data) return <p className="text-[13px] text-ink-3">تأییدهای این رکورد در دسترس نیست.</p>;
  const { approvals, display, aggregate, can_request } = q.data;
  const steps = approvalSteps(approvals);
  const field = ctx.def.fields.find((f) => f.name === "approval");
  const aggOption = field ? optionsOf(field, ctx.schema.choices).find((o) => o.value === aggregate) : undefined;
  const anyOpen = approvals.some((a) => OPEN.has(a.state));
  const adhocOpen = approvals.some((a) => !a.rule_id && OPEN.has(a.state));

  return (
    <div className="flex flex-col gap-3">
      {steps.length ? (
        <div className="flex items-center gap-2">
          <ChoiceTag option={aggOption} value={aggregate} strong />
        </div>
      ) : null}
      {!steps.length ? (
        <p className="text-[13px] text-ink-3">برای این رکورد تأییدی خواسته نشده است.</p>
      ) : (
        steps.map((step) => (
          <section key={step.key} className="flex flex-col gap-1.5" aria-label={step.title}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="ds-t-label text-ink-2">{step.title}</span>
              <span className="text-[12px] text-ink-3">{step.rule}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {step.rows.map((a) => {
                const due = a.state === "requested" ? dueState(a.due_at) : { tone: null, text: "" };
                return (
                  <li key={a.id} className="flex flex-col gap-1 rounded-md bg-sunken px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {a.approver_id ? <UserChip id={a.approver_id} display={display} /> : <span className="text-[13px] text-ink-3">{a.state === "skipped" ? "بدون تأییدکننده" : "خودکار"}</span>}
                      <span className="ms-auto shrink-0">
                        <ApprovalState state={a.state} />
                      </span>
                    </div>
                    {a.delegated_from ? (
                      <span className="text-[12px] text-ink-3">
                        به جانشینی از <UserChip id={a.delegated_from} display={display} />
                      </span>
                    ) : null}
                    {a.decided_at ? (
                      <span className="ds-num text-[12px] text-ink-3">{formatJalaliDateTime(a.decided_at, timezone)}</span>
                    ) : a.state === "requested" && a.due_at ? (
                      <span className={due.tone === "danger" ? "text-[12px] text-danger" : "text-[12px] text-ink-3"}>
                        مهلت <span className="ds-num">{formatJalaliDateTime(a.due_at, timezone)}</span>
                        {due.text ? ` — ${due.text}` : ""}
                      </span>
                    ) : null}
                    {a.comments ? <p className="whitespace-pre-wrap text-[13px] text-ink-2">{a.comments}</p> : null}
                    {a.can_decide ? (
                      <div className="flex gap-1.5 pt-0.5">
                        <Button size="small" icon={<Check {...ICON14} />} onClick={() => setDialog({ id: a.id, decision: "approved" })}>
                          تأیید
                        </Button>
                        <Button size="small" danger icon={<X {...ICON14} />} onClick={() => setDialog({ id: a.id, decision: "rejected" })}>
                          رد
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {can_request ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="small" icon={<Plus {...ICON14} />} disabled={adhocOpen} onClick={() => setAsking(true)} title={adhocOpen ? "درخواست تأیید پیشین هنوز باز است" : undefined}>
            درخواست تأیید
          </Button>
          {anyOpen ? (
            <Popconfirm title="تأییدهای باز این رکورد پس گرفته شود؟" okText="پس بگیر" cancelText="انصراف" onConfirm={() => cancel.mutate()}>
              <Button size="small" type="text" icon={<Undo2 {...ICON14} />} loading={cancel.isPending}>
                پس گرفتن
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      ) : null}
      <DecisionDialog
        decision={dialog?.decision ?? null}
        count={1}
        loading={decide.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={(comment) => dialog && decide.mutate({ id: dialog.id, decision: dialog.decision, comment })}
      />
      {asking ? <RequestDialog ctx={ctx} onClose={() => setAsking(false)} onDone={after} /> : null}
    </div>
  );
}

interface RequestValues {
  users?: string[];
  groups?: string[];
  rule: string;
  threshold?: string | null;
  expire_hours?: string | null;
  comment?: string;
}

/** «درخواست تأیید»: people and the members of groups, the rule over them, an optional deadline and a note. */
function RequestDialog({ ctx, onClose, onDone }: { ctx: RecordContext; onClose: () => void; onDone: () => void }) {
  const { api } = useOrg();
  const [form] = Form.useForm<RequestValues>();
  const rule = Form.useWatch("rule", form);
  const send = useAction(
    (v: RequestValues) =>
      approvalsApi.request(api, ctx.table, ctx.row.id, {
        users: v.users?.length ? v.users : undefined,
        groups: v.groups?.length ? v.groups : undefined,
        rule: v.rule,
        threshold: v.rule === "count" || v.rule === "percent" ? Number(v.threshold) || 1 : null,
        expire_hours: v.expire_hours ? Number(v.expire_hours) : null,
        comment: v.comment?.trim() || null,
      }),
    {
      success: "تأیید درخواست شد.",
      onSuccess: () => {
        onDone();
        onClose();
      },
    },
  );
  return (
    <Modal open title="درخواست تأیید" okText="درخواست" cancelText="انصراف" onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: send.isPending }} destroyOnHidden>
      <Form<RequestValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ rule: "any" }}
        onFinish={(v) => send.mutate(v)}
      >
        <Form.Item name="users" label="افراد">
          <UserSelect multiple value={undefined} onChange={() => undefined} />
        </Form.Item>
        <Form.Item
          name="groups"
          label="اعضای گروه‌ها"
          dependencies={["users"]}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, v: string[] | undefined) => ((getFieldValue("users") as string[] | undefined)?.length || v?.length ? Promise.resolve() : Promise.reject(new Error("کسی را برای تأیید برگزینید."))),
            }),
          ]}
        >
          <RecordSelect table="group" multiple value={undefined} onChange={() => undefined} />
        </Form.Item>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Form.Item name="rule" label="قاعده">
            <Select options={APPROVAL_RULES.map((o) => ({ value: o.value, label: o.label }))} />
          </Form.Item>
          {rule === "count" || rule === "percent" ? (
            <Form.Item name="threshold" label={rule === "count" ? "چند نفر" : "چند درصد"} rules={[{ required: true, message: "حد نصاب را بنویسید." }]}>
              <NumberInput suffix={rule === "percent" ? "٪" : "نفر"} />
            </Form.Item>
          ) : null}
        </div>
        <Form.Item name="expire_hours" label="مهلت (ساعت)" extra="خالی: بدون مهلت؛ پس از مهلت، درخواست رد می‌شود.">
          <NumberInput suffix="ساعت" />
        </Form.Item>
        <Form.Item name="comment" label="توضیح برای تأییدکنندگان">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={4000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
