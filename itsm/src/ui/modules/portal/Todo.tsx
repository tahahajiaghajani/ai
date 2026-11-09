// «کارهای من» (PTL-018, PTL-019): what waits for the person — approvals they are asked for (a manager approving their
// people's requests reads the request through the approver's grant), surveys, policies to read and acknowledge, and
// their requests where the desk waits for their answer. Each opens its own page in the portal.
import { Link } from "react-router";
import { Skeleton } from "antd";
import { BookOpenCheck, CheckSquare, MessageSquareHeart } from "lucide-react";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { Chip } from "../../components/display";
import { usePortalTodo, type PortalConfig } from "./api";
import { ago, portalPath } from "./model";
import { Empty, I16, PageHead, Section, TicketRow } from "./parts";

const dueText = (due: string | null) => {
  if (!due) return null;
  const late = Date.parse(due) < Date.now();
  return { late, text: `${late ? "مهلت گذشته" : "تا"} ${formatJalali(due.slice(0, 10))}` };
};

export default function Todo(_: { cfg: PortalConfig }) {
  const { orgId } = useOrg();
  const q = usePortalTodo();
  const d = q.data;
  if (q.isLoading)
    return (
      <>
        <PageHead title="کارهای من" />
        <div className="pt-card">
          <Skeleton active />
        </div>
      </>
    );
  const none = d && !d.approvals.length && !d.surveys.length && !d.acknowledgements.length && !d.waiting_you.length;
  return (
    <>
      <PageHead title="کارهای من" sub="تأییدها، پاسخ‌ها، نظرسنجی‌ها و خواندنی‌هایی که منتظر شماست" />
      {none || !d ? <Empty title="کاری منتظر شما نیست" text="هر وقت تأییدی، پرسشی یا نظرسنجی‌ای برسد، این‌جا می‌آید." /> : null}
      {d?.waiting_you.length ? (
        <Section title="منتظر پاسخ شما">
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {d.waiting_you.map((c) => (
                <li key={`${c.table}:${c.id}`}>
                  <TicketRow card={c} />
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null}
      {d?.approvals.length ? (
        <Section title="تأییدهای منتظر شما">
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {d.approvals.map((a) => {
                const due = dueText(a.due_at);
                return (
                  <li key={a.id}>
                    <Link to={portalPath(orgId, `approvals/${a.id}`)} className="pt-row">
                      <CheckSquare {...I16} aria-hidden className="text-ink-3" />
                      <span className="pt-row-b">
                        <span className="pt-row-t">{a.record_title || a.record_number || a.table_label}</span>
                        <span className="pt-row-m">
                          <span>{a.table_label}</span>
                          {a.record_number ? <bdi className="ltr">{a.record_number}</bdi> : null}
                          {a.on_behalf_of ? <span>به جای {a.on_behalf_of}</span> : null}
                          {a.level_name ? <span>{a.level_name}</span> : null}
                          {a.requested_at ? <span>{ago(a.requested_at)}</span> : null}
                        </span>
                      </span>
                      {due ? <Chip tone={due.late ? "danger" : "neutral"}>{due.text}</Chip> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </Section>
      ) : null}
      {d?.surveys.length ? (
        <Section title="نظرسنجی‌ها">
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {d.surveys.map((s) => (
                <li key={s.id}>
                  <Link to={portalPath(orgId, `surveys/${s.id}`)} className="pt-row">
                    <MessageSquareHeart {...I16} aria-hidden className="text-ink-3" />
                    <span className="pt-row-b">
                      <span className="pt-row-t">{s.title}</span>
                      <span className="pt-row-m">
                        {s.sent_at ? <span>{ago(s.sent_at)}</span> : null}
                        {s.expires_at ? <span>تا {formatJalali(s.expires_at.slice(0, 10))}</span> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null}
      {d?.acknowledgements.length ? (
        <Section title="خواندن و تأیید">
          <div className="pt-card is-flush">
            <ul className="pt-list">
              {d.acknowledgements.map((a) => {
                const due = dueText(a.due_at);
                return (
                  <li key={a.id}>
                    <Link to={a.article_id ? portalPath(orgId, `kb/${a.article_id}`) : portalPath(orgId, "kb")} className="pt-row">
                      <BookOpenCheck {...I16} aria-hidden className="text-ink-3" />
                      <span className="pt-row-b">
                        <span className="pt-row-t">{a.title}</span>
                        <span className="pt-row-m">بخوانید و «خواندم و می‌پذیرم» را بزنید</span>
                      </span>
                      {due ? <Chip tone={due.late ? "danger" : "neutral"}>{due.text}</Chip> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </Section>
      ) : null}
    </>
  );
}
