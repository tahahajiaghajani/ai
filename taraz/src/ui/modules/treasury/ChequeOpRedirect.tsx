// /treasury/cheque-ops/:opId — the voucher of a cheque operation points here; open the cheque.
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Spin } from "antd";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";

export default function ChequeOpRedirect() {
  const { opId } = useParams();
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["treasury-cheque-op", opId], queryFn: () => api.get(`/treasury/cheques/by-op/${opId}`).then((r) => r.cheque) });
  useEffect(() => {
    if (q.data) nav(`/${orgId}/treasury/cheques${q.data.direction === "issued" ? "/issued" : ""}?open=${q.data.id}`, { replace: true });
  }, [q.data, nav, orgId]);
  if (q.error) return <Alert type="error" showIcon title={errorText(q.error)} />;
  return <div className="grid h-64 place-content-center"><Spin /></div>;
}
