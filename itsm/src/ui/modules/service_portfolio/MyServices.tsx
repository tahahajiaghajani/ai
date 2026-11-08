// «خدمت‌های من» (catalogue SPF-013/014): the services a person has — subscribed directly, through a group, their unit
// or location, an agreement of their unit, or an offering open to them — with the live status and the owner's
// message, the offerings they may use, and «لغو اشتراک» for their own subscriptions.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { BellOff, ConciergeBell } from "lucide-react";
import type { MyService } from "@shared/service_portfolio/api";
import { statusLabel } from "@shared/service_portfolio/logic";
import { OFFERING_LEVELS } from "@shared/tables/service_portfolio";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { spfApi, SPF_KEYS } from "./api";
import { statusColor, statusTone } from "./model";
import "./spf.css";

const VIA: Record<MyService["via"][number], string> = {
  subscription: "اشتراک شما",
  group: "اشتراک گروه شما",
  unit: "اشتراک واحد شما",
  location: "اشتراک مکان شما",
  agreement: "توافق واحد شما",
  entitlement: "گزینهٔ ویژهٔ شما",
};

export default function MyServices() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: SPF_KEYS.mine(orgId), queryFn: () => spfApi.mine(api), staleTime: 60_000 });
  const unsubscribe = async (s: MyService) => {
    try {
      await spfApi.unsubscribe(api, s.id);
      message.success("اشتراک لغو شد");
      await qc.invalidateQueries({ queryKey: SPF_KEYS.all(orgId) });
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  return (
    <div>
      <PageHeader title="خدمت‌های من" />
      {q.isLoading ? (
        <Loader />
      ) : !q.data?.services.length ? (
        <EmptyState title="خدمتی برای شما ثبت نشده" description="در «وضعیت خدمات» می‌توانید مشترک خدمت‌هایی شوید که به کارتان می‌آیند." icon={ConciergeBell} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {q.data.services.map((s) => (
            <Card
              key={s.id}
              title={
                <span className="flex items-center gap-2">
                  <i className="spf-dot" style={{ background: statusColor(s.status) }} aria-hidden />
                  {s.name}
                </span>
              }
              tools={s.status === "operational" ? <span className="text-[12.5px] text-ink-3">{statusLabel(s.status)}</span> : <Chip tone={statusTone(s.status)}>{statusLabel(s.status)}</Chip>}
            >
              {s.note ? <p className="mb-2 text-[13px] text-ink-2">{s.note}</p> : null}
              {s.offerings.length ? (
                <p className="mb-2 text-[13px] text-ink-2">
                  گزینه‌ها: {s.offerings.map((o) => `${o.name}${o.level ? ` (${OFFERING_LEVELS.find((l) => l.value === o.level)?.label ?? o.level})` : ""}`).join("، ")}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] text-ink-3">{s.via.map((v) => VIA[v]).join(" · ")}</span>
                {s.subscription_id ? (
                  <Button size="small" type="text" icon={<BellOff size={14} strokeWidth={1.4} absoluteStrokeWidth />} onClick={() => unsubscribe(s)}>لغو اشتراک</Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
