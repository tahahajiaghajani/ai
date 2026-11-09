// «کارهای من» (PTL-012): what waits for the person — approvals (their own and an absent colleague's as delegate),
// surveys, read-and-acknowledge campaigns and their own records waiting on them — and the approval page a requester
// approves from: the record behind an approval as the approver may read it (the approvals service's participant grant:
// whoever has an approval on a record reads that record, a manager approving their staff's order included), with the
// open answers of an order (sensitive and secret answers stay with the requester and the fulfillers).
import type { PortalApproval, PortalTodo } from "@shared/portal/api";
import type { Ctx } from "../../context";
import { get } from "../../engine";
import { notFound } from "../../http/errors";
import { myApprovals } from "../sla";
import { myAttestations } from "../knowledge";
import { answersView } from "../request";
import { isUuid } from "./common";
import { myItems } from "./items";
import { pendingInvitations } from "./surveys";

export async function portalTodo(ctx: Ctx): Promise<PortalTodo> {
  const [a, invites, acks, open] = await Promise.all([
    myApprovals(ctx, { scope: "pending", limit: 200 }).catch(() => ({ approvals: [], display: {} as Record<string, string>, delegators: [] as string[] })),
    pendingInvitations(ctx).catch(() => []),
    myAttestations(ctx).catch(() => []),
    myItems(ctx, { tab: "mine", state: "open", page: 1, size: 50 }).catch(() => null),
  ]);
  return {
    approvals: a.approvals.map((x) => ({
      id: x.id,
      table: x.table_key,
      table_label: x.table_label,
      record_id: x.record_id,
      record_number: x.record_number,
      record_title: x.record_title,
      requested_at: x.requested_at,
      due_at: x.due_at,
      on_behalf_of: x.on_behalf_of,
      level_name: x.level_name,
    })),
    surveys: invites.map((r) => ({ id: String(r.id), title: String(r.title ?? ""), sent_at: (r.sent_at as string) ?? null, expires_at: (r.expires_at as string) ?? null })),
    acknowledgements: acks.filter((x) => !x.acked_at).map((x) => ({ id: x.id, title: x.title || x.article_title, due_at: x.due_at, article_id: x.article_id })),
    waiting_you: (open?.items ?? []).filter((i) => i.stage === "waiting_you"),
    display: a.display,
  };
}

const factValue = (row: Record<string, unknown>, display: Record<string, string>, f: string): string | null => {
  const v = row[f];
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && display[v]) return display[v];
  return typeof v === "number" ? v.toLocaleString("fa-IR") : String(v);
};

/** The approval page (pending or decided by the caller). */
export async function approvalDetail(ctx: Ctx, approvalId: string): Promise<PortalApproval> {
  if (!isUuid(approvalId)) throw notFound("تأیید پیدا نشد");
  const pending = await myApprovals(ctx, { scope: "pending", limit: 500 });
  let a = pending.approvals.find((x) => x.id === approvalId);
  if (!a) a = (await myApprovals(ctx, { scope: "decided", limit: 500 })).approvals.find((x) => x.id === approvalId);
  if (!a) throw notFound("تأیید پیدا نشد");
  const { row, display } = await get(ctx, a.table_key, a.record_id);
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, f: string) => {
    const v = factValue(row, display, f);
    if (v) facts.push({ label, value: v });
  };
  add("خدمت سفارش‌داده‌شده", "cat_item_id");
  add("تعداد", "quantity");
  add("مبلغ", "total");
  add("برای", "requested_for");
  add("ثبت‌کننده", "opened_by");
  add("زمان ثبت", "opened_at");
  let answers: { label: string; value: string }[] = [];
  if (a.table_key === "request_item") {
    const v = await answersView(ctx, "request_item", a.record_id).catch(() => null);
    if (v) {
      for (const q of v.schema.variables) {
        if (q.type === "secret" || q.field_class === "sensitive" || q.field_class === "secret" || !(q.name in v.answers)) continue;
        const value = v.answers[q.name];
        if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
        const text = Array.isArray(value) ? value.map((x) => v.display[String(x)] ?? String(x)).join("، ") : typeof value === "boolean" ? (value ? "بله" : "خیر") : v.display[String(value)] ?? q.choices?.find((c) => c.value === String(value))?.label ?? String(value);
        answers.push({ label: q.label, value: text });
      }
    }
  }
  const forId = typeof row.requested_for === "string" ? row.requested_for : typeof row.caller_id === "string" ? row.caller_id : null;
  return {
    approval: { id: a.id, state: a.state, can_decide: a.can_decide, due_at: a.due_at, comments: a.comments, level_name: a.level_name },
    record: {
      table: a.table_key,
      table_label: a.table_label,
      id: a.record_id,
      number: a.record_number,
      title: a.record_title ?? String(row.short_description ?? ""),
      description: typeof row.description === "string" ? row.description : null,
      for_name: forId ? (display[forId] ?? null) : null,
      opened_by_name: typeof row.opened_by === "string" ? (display[row.opened_by] ?? null) : null,
    },
    facts,
    answers,
  };
}
