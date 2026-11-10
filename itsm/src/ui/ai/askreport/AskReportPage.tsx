// «پرسش تحلیلی» as a page (the command palette's «پرسش تحلیلی: …» opens it with ?q=).
import { useSearchParams } from "react-router";
import { PageHeader } from "../../components/layout";
import AskReportBox from "./AskReportBox";

export default function AskReportPage() {
  const [sp] = useSearchParams();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="پرسش تحلیلی" />
      <AskReportBox initial={sp.get("q") ?? undefined} />
    </div>
  );
}
