// A cheque's file: its details, the document that registered it, every operation with its
// voucher (timeline) and the operations available now.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Spin, Tag, Timeline } from "antd";
import { RollbackOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { Money, JDate, JDateTime, StatusTag } from "../../components/display";
import { faDigits, groupDigits } from "@shared/format";
import { amountToWords } from "@shared/words";
import { ACTION_LABEL, KIND_TITLE, chequeStatusMap, type ChequeAction, type DocKind } from "./labels";
import { ChequeActionModal, chequeTitle, type ChequeLike } from "./ChequeAction";

export function DueBadge({ c }: { c: { open: boolean; overdue: boolean; days: number } }) {
  if (!c.open) return null;
  if (c.overdue) return <Tag color="error" variant="filled" className="!m-0">{faDigits(-c.days)} روز گذشته</Tag>;
  if (c.days === 0) return <Tag color="warning" variant="filled" className="!m-0">امروز</Tag>;
  if (c.days <= 7) return <Tag color="warning" variant="filled" className="!m-0">{faDigits(c.days)} روز مانده</Tag>;
  return null;
}

export function ChequeDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { api, orgId, can, unit } = useOrg();
  const [act, setAct] = useState<ChequeAction | null>(null);
  const q = useQuery({
    queryKey: ["treasury-cheque", id],
    queryFn: () => api.get(`/treasury/cheques/${id}`).then((r) => r.cheque),
    enabled: !!id,
  });
  const c = q.data;
  const dir = c?.direction ?? "received";
  const canEdit = can("treasury", "edit");
  return (
    <Drawer open={!!id} onClose={onClose} size={600} destroyOnHidden title={c ? `${chequeTitle(c)} — ${dir === "received" ? "دریافتی" : "پرداختی"}` : "چک"}>
      {q.isLoading ? (
        <div className="grid h-40 place-content-center"><Spin /></div>
      ) : q.error || !c ? (
        <Alert type="error" showIcon title={q.error ? errorText(q.error) : "چک پیدا نشد"} />
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusTag s={c.status} map={chequeStatusMap(dir)} />
            <DueBadge c={c} />
            <span className="ms-auto text-lg font-bold"><Money v={c.amount} unit /></span>
          </div>
          <div className="mb-3 text-xs text-muted">{amountToWords(c.amount, unit)}</div>
          {canEdit && c.actions?.length ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {(c.actions as ChequeAction[]).map((a) => (
                <Button key={a} size="small" danger={a === "bounce"} icon={a === "undo" ? <RollbackOutlined /> : undefined} onClick={() => setAct(a)}>
                  {ACTION_LABEL[dir as "received"][a] ?? a}
                </Button>
              ))}
            </div>
          ) : null}
          <Descriptions
            size="small"
            column={2}
            bordered
            items={[
              { key: "party", label: dir === "received" ? "طرف حساب" : "در وجه", children: c.party_id ? <Link to={`/${orgId}/parties/${c.party_id}`}>{c.party_name}</Link> : "—" },
              { key: "due", label: "سررسید", children: <JDate v={c.due_date} /> },
              { key: "serial", label: "سریال", children: <span className="num ltr">{faDigits(c.serial_no ?? "—")}</span> },
              { key: "sayad", label: "شناسه صیادی", children: <span className="num ltr">{c.sayad_no ? faDigits(groupDigits(c.sayad_no)) : "—"}</span> },
              { key: "bank", label: "بانک و شعبه", children: [c.bank_name, c.branch_name].filter(Boolean).join(" — ") || "—" },
              { key: "acct", label: "شماره حساب", children: <span className="num ltr">{faDigits(c.account_no ?? "—")}</span> },
              { key: "owner", label: "صاحب حساب", children: c.account_owner ?? "—" },
              { key: "issue", label: dir === "received" ? "تاریخ دریافت" : "تاریخ صدور", children: <JDate v={c.issue_date} /> },
              ...(c.bank_account_name ? [{ key: "ba", label: dir === "received" ? "بانک وصول" : "حساب بانکی ما", children: c.bank_account_name }] : []),
              ...(c.cheque_book_title ? [{ key: "book", label: "دسته‌چک", children: c.cheque_book_title }] : []),
              ...(c.holder_name ? [{ key: "holder", label: "خرج‌شده به", children: c.holder_name }] : []),
              ...(c.description ? [{ key: "desc", label: "توضیحات", children: c.description, span: 2 }] : []),
            ]}
          />
          <div className="mb-2 mt-5 text-sm font-bold">گردش چک</div>
          <Timeline
            items={[
              {
                key: "doc",
                color: "blue",
                title: <JDate v={c.doc_date ?? c.issue_date} />,
                content: (
                  <div className="text-sm">
                    {c.doc_no ? (
                      <>
                        ثبت در{" "}
                        <Link to={`/${orgId}/treasury/docs/${c.source_id}`}>
                          {KIND_TITLE[c.doc_kind as DocKind] ?? "سند"} شماره‌ی {faDigits(c.doc_no)}
                        </Link>
                      </>
                    ) : (
                      "ثبت چک"
                    )}
                  </div>
                ),
              },
              ...(c.history as any[]).map((h) => ({
                key: h.id,
                color: h.action === "bounce" ? "red" : h.to === "cleared" ? "green" : "gray",
                title: <JDate v={h.date} />,
                content: (
                  <div className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{h.title}</b>
                      <StatusTag s={h.to} map={chequeStatusMap(dir)} />
                      {h.voucher_id && h.voucher_no && can("accounting", "view") ? (
                        <Link className="text-xs" to={`/${orgId}/accounting/vouchers/${h.voucher_id}`}>سند {faDigits(h.voucher_no)}</Link>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted">
                      {[h.bank_account_name, h.cash_box_name, h.party_name ? `به ${h.party_name}` : null, h.to_account === "ar" ? "به حساب دریافتنی شخص" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {h.note ? <div className="text-xs">{h.note}</div> : null}
                    <div className="text-[11px] text-muted">
                      {h.by_name} · <JDateTime v={h.at} />
                    </div>
                  </div>
                ),
              })),
            ]}
          />
        </div>
      )}
      {act && c ? <ChequeActionModal cheque={c as ChequeLike} action={act} onClose={() => setAct(null)} /> : null}
    </Drawer>
  );
}
