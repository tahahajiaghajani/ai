// /treasury/cheque-ops/:opId — the voucher of a cheque operation points here; open the cheque.
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { CircleAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { EmptyState, Loader } from "../../components/display";
import { Card } from "../reports/kit";

export default function ChequeOpRedirect() {
  const { opId } = useParams();
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["treasury-cheque-op", opId], queryFn: () => api.get(`/treasury/cheques/by-op/${opId}`).then((r) => r.cheque) });
  useEffect(() => {
    if (q.data) nav(`/${orgId}/treasury/cheques${q.data.direction === "issued" ? "/issued" : ""}?open=${q.data.id}`, { replace: true });
  }, [q.data, nav, orgId]);
  if (q.error)
    return (
      <Card>
        <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={errorText(q.error)} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
      </Card>
    );
  return (
    <div className="grid h-64 place-content-center">
      <Loader label="در حال باز کردن چک" />
    </div>
  );
}
