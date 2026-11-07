// Pieces shared by the approval screens: the decision dialog (a reason is required to reject), the state tag of an
// approval row and a record link built from the approval's snapshot.
import { useEffect, useState } from "react";
import { Input, Modal } from "antd";
import { Link } from "react-router";
import { APPROVAL_ROW_STATES } from "@shared/tables/approvals";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { recordPath } from "../../records/extensions";
import { ChoiceTag } from "../../records";
import type { ApprovalView, Decision } from "./api";

export function ApprovalState({ state }: { state: string }) {
  return <ChoiceTag option={APPROVAL_ROW_STATES.find((o) => o.value === state)} value={state} />;
}

/** «INC0001 — عنوان», opening the record. */
export function RecordRef({ a }: { a: Pick<ApprovalView, "table_key" | "record_id" | "record_number" | "record_title"> }) {
  const { orgId } = useOrg();
  return (
    <Link to={`/${orgId}/${recordPath(a.table_key, a.record_id)}`} className="ds-link inline-flex min-w-0 items-baseline gap-2">
      {a.record_number ? <bdi dir="ltr" className="ds-num shrink-0 text-ink-3">{a.record_number}</bdi> : null}
      <span className="truncate">{a.record_title || "بدون عنوان"}</span>
    </Link>
  );
}

/** Approve or reject `count` approvals; rejecting asks for the reason. */
export function DecisionDialog({
  decision,
  count,
  loading,
  onCancel,
  onConfirm,
}: {
  decision: Decision | null;
  count: number;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setComment("");
    setTouched(false);
  }, [decision]);
  const reject = decision === "rejected";
  const missing = reject && !comment.trim();
  const many = count > 1 ? ` ${faDigits(count)} مورد` : "";
  return (
    <Modal
      open={!!decision}
      title={reject ? `رد${many}` : `تأیید${many}`}
      okText={reject ? "رد کن" : "تأیید کن"}
      cancelText="انصراف"
      okButtonProps={{ danger: reject, loading }}
      onCancel={onCancel}
      onOk={() => {
        setTouched(true);
        if (!missing) onConfirm(comment.trim());
      }}
      destroyOnHidden
    >
      <label className="ds-t-label mb-1 block text-ink-2" htmlFor="sla-decision-comment">
        {reject ? "علت رد" : "توضیح (اختیاری)"}
      </label>
      <Input.TextArea
        id="sla-decision-comment"
        autoFocus
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 8 }}
        maxLength={4000}
        status={touched && missing ? "error" : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            setTouched(true);
            if (!missing) onConfirm(comment.trim());
          }
        }}
      />
      {touched && missing ? <div className="mt-1 text-[13px] text-danger">علت رد را بنویسید؛ درخواست‌کننده آن را می‌بیند.</div> : null}
    </Modal>
  );
}
