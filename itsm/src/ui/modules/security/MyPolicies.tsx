// «خط‌مشی‌های من» (SEC-032, every member): the running campaigns that address the member, each with the published
// policy's text and «خواندم و می‌پذیرم» for the version in force; accepted ones stay listed with their date.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Collapse } from "antd";
import { CheckCheck } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ICON14 } from "../../components/blocks";
import { Chip, EmptyState, JDate, JDateTime, Loader } from "../../components/display";
import { RecordMarkdown } from "../../records";
import { SEC_KEYS, securityApi } from "./api";

export default function MyPolicies() {
  const { api, orgId } = useOrg();
  const [open, setOpen] = useState<string[]>([]);
  const q = useQuery({ queryKey: SEC_KEYS.myPolicies(orgId), queryFn: () => securityApi.myPolicies(api) });
  const ack = useAction((id: string) => securityApi.acknowledge(api, id), { success: "پذیرش شما ثبت شد.", onSuccess: () => void q.refetch() });
  const list = q.data?.policies ?? [];
  return (
    <div>
      <PageHeader title="خط‌مشی‌های من" />
      {q.isLoading ? (
        <Loader />
      ) : !list.length ? (
        <EmptyState title="خط‌مشی‌ای برای پذیرش ندارید" description="وقتی خط‌مشی تازه‌ای برای شما فرستاده شود، اینجا می‌آید." />
      ) : (
        <Collapse
          activeKey={open}
          onChange={(k) => setOpen(k as string[])}
          items={list.map((p) => ({
            key: p.campaign_id,
            label: (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-ink">{p.policy_title}</span>
                {p.version_label ? <span className="text-ink-3">نسخهٔ <bdi className="ds-num">{p.version_label}</bdi></span> : null}
                {p.acked_at ? <Chip tone="in">پذیرفته شد</Chip> : p.overdue ? <Chip tone="danger">موعد گذشته</Chip> : <Chip tone="warning">در انتظار پذیرش</Chip>}
                {p.due_at && !p.acked_at ? (
                  <span className="text-[12px] text-ink-3">
                    موعد: <JDate v={p.due_at} />
                  </span>
                ) : null}
              </span>
            ),
            children: (
              <div className="flex flex-col gap-3">
                {p.summary ? <p className="text-[13px] text-ink-2">{p.summary}</p> : null}
                {p.body ? <RecordMarkdown text={p.body} /> : <p className="text-[13px] text-ink-3">متن این خط‌مشی در پیوست‌های آن است.</p>}
                {p.acked_at ? (
                  <p className="text-[13px] text-ink-2">
                    پذیرفته‌شده در <JDateTime v={p.acked_at} />
                  </p>
                ) : (
                  <Button type="primary" icon={<CheckCheck {...ICON14} />} onClick={() => ack.mutate(p.campaign_id)} loading={ack.isPending && ack.variables === p.campaign_id} className="self-start">
                    خواندم و می‌پذیرم
                  </Button>
                )}
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}
