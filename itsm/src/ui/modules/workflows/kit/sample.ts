// The kit's sample (design F §3.7): the bank's «درخواست تنخواه شعبه» — the start form, the branch head's approval, a
// condition on the amount, the finance deputy's approval, review and payment — with its form, its fields and a case
// waiting at the branch head. The gallery page draws every component with it and the kit's tests use it; it is
// sample data on the screen only, never written anywhere.
import type { FieldDef } from "@shared/model/types";
import type { FormLayoutV2 } from "@shared/forms/layout";
import { stepStatuses, type CaseProgress, type NodeStatusView, type ProcessGraph, type ProcessNode } from "@shared/process";
import { edgeId, layoutProcess } from "./model";

const node = (id: string, type: ProcessNode["type"], config: Record<string, unknown> = {}, label?: string): ProcessNode => ({ id, type, config, ...(label ? { label } : {}) });
const edge = (source: string, target: string, port?: string) => ({ id: edgeId(source, port ?? "out", target), source, target, ...(port ? { port } : {}) });

/** «درخواست تنخواه شعبه» (§3.7), laid out top to bottom. */
export function sampleProcess(): ProcessGraph {
  const head = { assignees: [{ kind: "position", position: "branch_head", where: "requester_unit_up", unitKind: "branch" }] };
  const deputy = { assignees: [{ kind: "position", position: "finance_deputy", where: "anywhere" }] };
  const pay = { assignees: [{ kind: "group", group: "00000000-0000-4000-8000-000000000001" }] };
  return layoutProcess({
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: "f_req", rights: { default: "edit", fields: {} }, assignees: [] }),
      node("a1", "form_step", { action: "approve", form: "f_req", rights: { default: "read", fields: { u_note: "edit" } }, quorum: "any", due: { amount: 1, unit: "day" }, ...head }, "تأیید رئیس شعبه"),
      node("b", "branch", { mode: "data", rules: [{ left: "{{case.u_amount}}", op: "gt", right: "500000000" }] }, "مبلغ بیش از ۵۰ میلیون تومان؟"),
      node("a2", "form_step", { action: "approve", form: "f_req", rights: { default: "read", fields: {} }, quorum: "any", ...deputy }, "تأیید معاونت مالی"),
      node("f", "form_step", { action: "fill", form: "f_req", rights: { default: "read", fields: { u_note: "required" } }, ...pay }, "بررسی و پرداخت"),
      node("ok", "end", { outcome: "completed" }, "پرداخت شد"),
      node("no", "end", { outcome: "rejected" }, "ردشده"),
    ],
    edges: [
      edge("t", "s"),
      edge("s", "a1"),
      edge("a1", "b", "approved"),
      edge("a1", "no", "rejected"),
      edge("a1", "s", "returned"),
      edge("b", "a2", "yes"),
      edge("b", "f", "no"),
      edge("a2", "f", "approved"),
      edge("a2", "no", "rejected"),
      edge("f", "ok"),
    ],
  });
}

/** The request form: amount, date needed, reason, account, documents; a note for the reviewers. */
export const SAMPLE_FORM: FormLayoutV2 = {
  tabs: [
    {
      label: "جزئیات",
      sections: [
        {
          label: "درخواست",
          columns: 2,
          items: [
            { field: "u_amount", required: true },
            { field: "u_need_date" },
            { field: "u_reason", span: 24 },
            { field: "u_iban" },
            { field: "u_docs", span: 24 },
          ],
        },
        { label: "بررسی", items: [{ field: "u_note", span: 24 }, { field: "u_ref_no", readonly: true }] },
      ],
    },
  ],
};

const f = (name: string, label: string, type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type, ...extra }) as FieldDef;

/** The form's fields as a version's snapshot would hold them. */
export const SAMPLE_FIELDS: Record<string, FieldDef> = {
  u_amount: f("u_amount", "مبلغ درخواستی", "money", { group: "financial", min: 0 }),
  u_need_date: f("u_need_date", "تاریخ نیاز", "date"),
  u_reason: f("u_reason", "شرح نیاز", "text"),
  u_iban: f("u_iban", "شمارهٔ شبا", "string", { check: "iban", ltr: true }),
  u_docs: f("u_docs", "پیوست‌ها", "json", { widget: "files", check: "attachments", max: 3, accept: ["pdf", "image"] }),
  u_note: f("u_note", "یادداشت بررسی", "text"),
  u_ref_no: f("u_ref_no", "شمارهٔ سند پرداخت", "string", { system: true }),
};

/** A case waiting at «تأیید رئیس شعبه» for one person. */
export const SAMPLE_PROGRESS: CaseProgress = {
  t: { status: "done", port: "out", round: 1 },
  s: { status: "done", outcome: "submitted", round: 1, actors: ["سمیرا رضایی"] },
  a1: { status: "active", round: 1, waiting: 1 },
};

/** The statuses of that case for the branch head (the step is theirs to do). */
export function sampleStatuses(graph: ProcessGraph = sampleProcess()): Record<string, NodeStatusView> {
  return stepStatuses(
    { graph },
    { state: "active", progress: SAMPLE_PROGRESS, requested_by: "requester" },
    [{ step_key: "a1", status: "open", round: 1 }],
    { user: "head", positions: [{ position: "branch_head", unit: "vanak" }], groups: [], roles: [] },
  );
}
