// A survey by its signed link, without signing in (/p/survey/:token, PTL-039): what e-mails and messengers carry. The
// page shows only the survey and its questions — never the record, its number or any person — and answers once.
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../lib/api";
import { EmptyState, Loader } from "../../components/display";
import { portalPublicApi } from "./api";
import { SurveyForm } from "./SurveyForm";
import "./portal.css";

export default function PublicSurvey() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["public-survey", token], queryFn: () => portalPublicApi.survey(token), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  if (q.isLoading) return <Loader />;
  const v = q.data;
  if (!v) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 410);
    return <EmptyState title={gone ? "این نظرسنجی پیدا نشد" : "بارگذاری نشد"} description={gone ? "پیوند نادرست است یا مهلت آن گذشته است." : "کمی بعد دوباره امتحان کنید."} />;
  }
  return (
    <div className="pt-public mx-auto w-full max-w-[720px]" data-accent="indigo">
      <h1>{v.survey.name}</h1>
      <SurveyForm view={v} onSubmit={(answers) => portalPublicApi.answerSurvey(token, answers)} />
    </div>
  );
}
