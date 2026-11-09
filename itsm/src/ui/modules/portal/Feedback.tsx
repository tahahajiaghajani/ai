// «شکایت، قدردانی یا پیشنهاد» (PTL-034…036): feedback apart from incidents — a complaint, a compliment, a suggestion,
// or a request about one's personal data (a copy, a correction, erasure, an objection) — with a formal answer the
// person reads on its page. Complaints and privacy requests are confidential from the start (only the feedback group
// and the person see them); the list below shows the person's own.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Radio, Select } from "antd";
import { Send } from "lucide-react";
import { FEEDBACK_KINDS, PRIVACY_RIGHTS } from "@shared/tables/portal";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { Field, Note } from "../../components/blocks";
import { RecordMarkdown, recordsApi, useMe } from "../../records";
import { portalApi, usePortalRefresh, type PortalConfig } from "./api";
import { portalPath, ticketPath } from "./model";
import { Empty, I16, PageHead, Section, TicketRow } from "./parts";

const HINT: Record<string, string> = {
  complaint: "چه شد و چه انتظاری داشتید؟ اگر به درخواست مشخصی مربوط است، شماره‌اش را بنویسید.",
  compliment: "از چه کسی یا چه کاری راضی بودید؟ قدردانی شما به خود او می‌رسد.",
  suggestion: "چه چیزی را بهتر کنیم؟",
  privacy: "بنویسید دربارهٔ کدام داده‌ها و چه می‌خواهید؛ تا پاسخ رسمی، این درخواست محرمانه می‌ماند.",
};

export default function Feedback({ cfg }: { cfg: PortalConfig }) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const refresh = usePortalRefresh();
  const { userId } = useMe();
  const [kind, setKind] = useState("complaint");
  const [right, setRight] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mine = useQuery({ queryKey: ["portal", orgId, "items", "feedback"], queryFn: () => portalApi.items(api, { tab: "mine", state: "all", size: 50 }) });
  const list = (mine.data?.items ?? []).filter((c) => c.table === "portal_feedback");

  if (!cfg.can.feedback) return <Empty title="ثبت بازخورد برای شما باز نیست" />;
  const submit = async () => {
    if (subject.trim().length < 3) return setProblem("موضوع را در چند واژه بنویسید");
    if (details.trim().length < 5) return setProblem("کمی بیشتر توضیح دهید");
    if (kind === "privacy" && !right) return setProblem("بگویید دربارهٔ داده‌هایتان چه می‌خواهید");
    setBusy(true);
    setProblem(null);
    try {
      const r = await recordsApi.create(api, "portal_feedback", { kind, privacy_right: kind === "privacy" ? right : null, short_description: subject.trim().slice(0, 150), description: details.trim().slice(0, 4000), caller_id: userId, requested_for: userId, channel: "portal" });
      void portalApi.event(api, { kind: "feedback", ref_table: "portal_feedback", ref_id: String(r.row.id) });
      void refresh.all();
      navigate(ticketPath(orgId, "portal_feedback", String(r.row.id)), { state: { created: true } });
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead title="شکایت، قدردانی یا پیشنهاد" sub="صدای شما مستقیم به مسئول کیفیت خدمات می‌رسد و پاسخ رسمی می‌گیرد." back={{ to: portalPath(orgId), label: "خانه" }} />
      <div className="pt-two">
        <div className="pt-card flex flex-col gap-4">
          <Field label="چه می‌خواهید بگویید؟">
            <Radio.Group value={kind} onChange={(e) => setKind(e.target.value)} optionType="button" buttonStyle="solid" options={FEEDBACK_KINDS.map((k) => ({ value: k.value, label: k.label.replace("درخواست دربارهٔ داده‌های شخصی", "داده‌های شخصی من") }))} />
          </Field>
          {kind === "privacy" ? (
            <Field label="دربارهٔ داده‌هایم">
              <Select value={right ?? undefined} onChange={setRight} placeholder="برگزینید" options={PRIVACY_RIGHTS.map((o) => ({ value: o.value, label: o.label }))} aria-label="دربارهٔ داده‌هایم" />
            </Field>
          ) : null}
          <Field label="موضوع" htmlFor="pt-fb-subject">
            <Input id="pt-fb-subject" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="شرح" hint={HINT[kind]} htmlFor="pt-fb-details">
            <Input.TextArea id="pt-fb-details" autoSize={{ minRows: 4, maxRows: 12 }} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </Field>
          {kind === "complaint" || kind === "privacy" ? <Alert type="info" showIcon title="این مورد محرمانه است: فقط شما و گروه رسیدگی به بازخورد آن را می‌بینید." /> : null}
          {problem ? <Alert type="error" title={problem} /> : null}
          {cfg.portal.privacy_notice ? (
            <Note>
              <RecordMarkdown text={cfg.portal.privacy_notice} />
            </Note>
          ) : null}
          <div>
            <Button type="primary" size="large" icon={<Send {...I16} />} loading={busy} onClick={submit}>
              ثبت
            </Button>
          </div>
        </div>
        <aside className="flex flex-col gap-3">
          <Section title="بازخوردهای من">
            {list.length ? (
              <div className="pt-card is-flush">
                <ul className="pt-list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <TicketRow card={c} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="pt-muted m-0 text-[13px]">هنوز بازخوردی ثبت نکرده‌اید.</p>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
