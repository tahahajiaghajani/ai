// «اجرای قاعده‌ها» on the candidates list: runs the candidate rules over recent incidents now (they also run nightly).
import { Button } from "antd";
import { Radar } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { useRecordActions } from "../../records";
import { problemApi } from "./api";

export default function RunCandidates() {
  const { api } = useOrg();
  const { refreshLists } = useRecordActions("problem_candidate");
  const run = useAction(() => problemApi.runCandidates(api), {
    success: (d) => (d.created || d.updated ? `${(d.created + d.updated).toLocaleString("fa-IR")} نامزد تازه یا به‌روز شد.` : "نامزد تازه‌ای پیدا نشد."),
    onSuccess: () => refreshLists(),
  });
  return (
    <Button icon={<Radar {...ICON14} />} onClick={() => run.mutate(undefined)} loading={run.isPending}>
      اجرای قاعده‌ها
    </Button>
  );
}
