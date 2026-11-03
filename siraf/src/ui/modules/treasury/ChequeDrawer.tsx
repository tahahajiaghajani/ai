// A cheque's file in the side sheet: its amount and state, the operations available now, its details, and its route —
// the document that registered it and every operation with its voucher, joined as nuqtas on a line (§13.3 #4).
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Dropdown } from "antd";
import { CircleAlert, Ellipsis, Undo2 } from "lucide-react";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { Chip, EmptyState, JDate, JDateTime, Skeleton, StatusTag } from "../../components/display";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { ACTION_LABEL, KIND_TITLE, chequeStatusMap, type ChequeAction, type DocKind } from "./labels";
import { ChequeActionModal, chequeTitle, type ChequeLike } from "./ChequeAction";
import { Amt, ICON, ICON14, Ref, docNo } from "../reports/kit";

/** Due-date chip of an open cheque: overdue (danger), today or within a week (warning); otherwise nothing. */
export function DueBadge({ c }: { c: { open: boolean; overdue: boolean; days: number } }) {
  if (!c.open) return null;
  if (c.overdue) return <Chip tone="danger" fig>{faDigits(-c.days)} روز گذشته</Chip>;
  if (c.days === 0) return <Chip tone="warning">امروز</Chip>;
  if (c.days <= 7) return <Chip tone="warning" fig>{faDigits(c.days)} روز مانده</Chip>;
  return null;
}

const toneOf = (action: string, to: string) => (action === "bounce" ? "danger" : to === "cleared" ? "in" : to === "deposited" ? "warning" : undefined);

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
  const history = (c?.history ?? []) as any[];
  const dash = <span className="sf-zero">—</span>;
  // the operations that move the cheque forward are buttons; undoing the last one is a quiet item in the ⋯ menu
  const actions = ((canEdit && c?.actions) || []) as ChequeAction[];
  const forward = actions.filter((a) => a !== "undo");
  const canUndo = actions.includes("undo");
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      size={520}
      destroyOnHidden
      extra={
        canUndo ? (
          <Dropdown
            trigger={["click"]}
            rootClassName="sf-glass"
            placement="bottomLeft"
            menu={{ items: [{ key: "undo", icon: <Undo2 {...ICON14} />, label: ACTION_LABEL[dir as "received"].undo ?? "برگشت آخرین عملیات", onClick: () => setAct("undo") }] }}
          >
            <Button type="text" size="small" icon={<Ellipsis {...ICON} />} aria-label="کارهای بیشتر" />
          </Dropdown>
        ) : null
      }
      title={
        c ? (
          <div>
            <div>{chequeTitle(c)}</div>
            <div className="bk-cap" style={{ fontWeight: "var(--sf-weight-regular)" }}>
              {dir === "received" ? "چک دریافتی" : "چک پرداختی"}
              {c.doc_no ? `، ${KIND_TITLE[c.doc_kind as DocKind] ?? "سند"} ${docNo(c.doc_no)}` : ""}
            </div>
          </div>
        ) : (
          "چک"
        )
      }
    >
      {q.isLoading ? (
        <Skeleton rows={8} />
      ) : q.error || !c ? (
        <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={q.error ? errorText(q.error) : "چک پیدا نشد."} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
      ) : (
        <div className="sf-fade">
          <div className="bk-sheet-fig">
            <b>
              <Amt v={c.amount} /> <span className="sf-unit">{unit}</span>
            </b>
            <StatusTag s={c.status} map={chequeStatusMap(dir)} chip />
            <DueBadge c={c} />
          </div>
          <div className="bk-cap mt-1" style={{ whiteSpace: "normal" }}>{amountToWords(c.amount, unit)}</div>

          {forward.length ? (
            <div className="bk-acts mt-4">
              {forward.map((a) => (
                <Button key={a} size="small" danger={a === "bounce"} onClick={() => setAct(a)}>
                  {ACTION_LABEL[dir as "received"][a] ?? a}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="bk-sheet-sec">مشخصات</div>
          <dl className="bk-dl">
            <div>
              <dt>{dir === "received" ? "طرف حساب" : "در وجه"}</dt>
              <dd>{c.party_id ? <Link className="sf-link" to={`/${orgId}/parties/${c.party_id}`}>{c.party_name}</Link> : dash}</dd>
            </div>
            <div>
              <dt>سررسید</dt>
              <dd><JDate v={c.due_date} style="long" /></dd>
            </div>
            <div>
              <dt>سریال</dt>
              <dd>{c.serial_no ? <span className="bk-docno">{docNo(c.serial_no)}</span> : dash}</dd>
            </div>
            <div>
              <dt>شناسهٔ صیادی</dt>
              <dd>{c.sayad_no ? <Ref v={c.sayad_no} /> : dash}</dd>
            </div>
            <div>
              <dt>بانک و شعبه</dt>
              <dd>{[c.bank_name, c.branch_name].filter(Boolean).join("، ") || dash}</dd>
            </div>
            <div>
              <dt>شمارهٔ حساب</dt>
              <dd>{c.account_no ? <span className="sf-num">{faDigits(c.account_no)}</span> : dash}</dd>
            </div>
            <div>
              <dt>صاحب حساب</dt>
              <dd>{c.account_owner ?? dash}</dd>
            </div>
            <div>
              <dt>{dir === "received" ? "تاریخ دریافت" : "تاریخ صدور"}</dt>
              <dd><JDate v={c.issue_date} /></dd>
            </div>
            {c.bank_account_name ? (
              <div>
                <dt>{dir === "received" ? "بانک وصول" : "حساب بانکی ما"}</dt>
                <dd>{c.bank_account_name}</dd>
              </div>
            ) : null}
            {c.cheque_book_title ? (
              <div>
                <dt>دسته‌چک</dt>
                <dd>{c.cheque_book_title}</dd>
              </div>
            ) : null}
            {c.holder_name ? (
              <div>
                <dt>خرج‌شده به</dt>
                <dd>{c.holder_name}</dd>
              </div>
            ) : null}
            {c.description ? (
              <div className="is-wide">
                <dt>توضیحات</dt>
                <dd>{c.description}</dd>
              </div>
            ) : null}
          </dl>

          <div className="bk-sheet-sec">گردش چک</div>
          <ol className="bk-route is-live">
            <li data-tone={history.length ? undefined : "hollow"}>
              <span className="bk-route-n"><i /></span>
              <div className="bk-route-b">
                <div className="bk-route-t">
                  {c.doc_no ? (
                    <span>
                      ثبت در{" "}
                      <Link className="sf-link" to={`/${orgId}/treasury/docs/${c.source_id}`}>
                        {KIND_TITLE[c.doc_kind as DocKind] ?? "سند"} {docNo(c.doc_no)}
                      </Link>
                    </span>
                  ) : (
                    "ثبت چک"
                  )}
                  <span className="bk-route-d">{formatJalali(c.doc_date ?? c.issue_date)}</span>
                </div>
              </div>
            </li>
            {history.map((h) => (
              <li key={h.id} data-tone={toneOf(h.action, h.to)}>
                <span className="bk-route-n"><i /></span>
                <div className="bk-route-b">
                  <div className="bk-route-t">
                    <span>{h.title}</span>
                    <StatusTag s={h.to} map={chequeStatusMap(dir)} />
                    {h.voucher_id && h.voucher_no && can("accounting", "view") ? (
                      <Link className="sf-link" style={{ fontWeight: "var(--sf-weight-regular)", fontSize: 12 }} to={`/${orgId}/accounting/vouchers/${h.voucher_id}`}>
                        سند {docNo(h.voucher_no)}
                      </Link>
                    ) : null}
                    <span className="bk-route-d">{formatJalali(h.date)}</span>
                  </div>
                  {[h.bank_account_name, h.cash_box_name, h.party_name ? `به ${h.party_name}` : null, h.to_account === "ar" ? "به حساب دریافتنی شخص" : null].filter(Boolean).length ? (
                    <div className="bk-route-m">
                      {[h.bank_account_name, h.cash_box_name, h.party_name ? `به ${h.party_name}` : null, h.to_account === "ar" ? "به حساب دریافتنی شخص" : null].filter(Boolean).join("، ")}
                    </div>
                  ) : null}
                  {h.note ? <div className="bk-route-m" style={{ color: "var(--sf-text-2)" }}>{h.note}</div> : null}
                  <div className="bk-route-m">
                    {h.by_name ? `${h.by_name}، ` : ""}
                    <JDateTime v={h.at} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {act && c ? <ChequeActionModal cheque={c as ChequeLike} action={act} onClose={() => setAct(null)} /> : null}
    </Drawer>
  );
}
