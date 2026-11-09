// A survey in the portal (PTL-038): the invitation the person opened from «کارهای من», a ticket page or a notification
// — the record it is about, then the questions (SurveyForm). Only the person invited may open it.
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import { useOrg } from "../../lib/org";
import { ApiError, errorText } from "../../lib/api";
import { PORTAL_KEYS, portalApi, usePortalRefresh, type PortalConfig } from "./api";
import { portalPath, ticketPath } from "./model";
import { Empty, PageHead } from "./parts";
import { SurveyForm } from "./SurveyForm";

export default function Survey(_: { cfg: PortalConfig }) {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const refresh = usePortalRefresh();
  const q = useQuery({ queryKey: PORTAL_KEYS.survey(orgId, id), queryFn: () => portalApi.survey(api, id), retry: false });
  const v = q.data;
  if (q.isLoading)
    return (
      <div className="pt-card">
        <Skeleton active />
      </div>
    );
  if (!v) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return <Empty title={gone ? "این نظرسنجی پیدا نشد" : "بارگذاری نشد"} text={gone ? undefined : errorText(q.error)} action={<Button onClick={() => navigate(portalPath(orgId, "todo"))}>کارهای من</Button>} />;
  }
  return (
    <>
      <PageHead title={v.survey.name} back={{ to: portalPath(orgId, "todo"), label: "کارهای من" }} />
      <div className="max-w-[720px]">
        <SurveyForm
          view={v}
          record={
            v.record ? (
              <p className="mt-0 text-[13px] text-ink-3">
                دربارهٔ{" "}
                <Link className="ds-link" to={ticketPath(orgId, v.record.table, v.record.id)}>
                  {v.record.number ? <bdi className="ltr">{v.record.number}</bdi> : null} {v.record.title}
                </Link>
              </p>
            ) : null
          }
          onSubmit={async (answers) => {
            const r = await portalApi.answerSurvey(api, id, answers);
            void refresh.all();
            return r;
          }}
        />
      </div>
    </>
  );
}
