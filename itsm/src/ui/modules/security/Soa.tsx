// «بیانیهٔ کاربست‌پذیری» (SEC-029): every requirement of a framework (ISO/IEC 27001:2022 Annex A by default) with its
// applicability and justification, implementation and compliance from the mapped controls, its controls and its state
// in the SoA. The ISMS owner (the compliance area's approve right) approves selected entries; an entry whose
// applicability or justification changes returns to draft. Editing happens on the requirement's own page.
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Select, Table } from "antd";
import { Stamp } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { recordPath, recordsApi } from "../../records";
import { SEC_KEYS, securityApi, type SoaRow } from "./api";

const COMPLIANCE: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = {
  compliant: ["منطبق", "in"], partial: ["بخشی", "warning"], non_compliant: ["نامنطبق", "danger"], not_assessed: ["ارزیابی‌نشده", "neutral"], not_applicable: ["کاربست‌ناپذیر", "neutral"],
};
const IMPL: Record<string, string> = { implemented: "پیاده‌شده", partial: "بخشی", not_implemented: "پیاده‌نشده", not_assessed: "ارزیابی‌نشده", not_applicable: "—" };

export default function Soa() {
  const { api, orgId } = useOrg();
  const [sp, setSp] = useSearchParams();
  const framework = sp.get("framework");
  const [selected, setSelected] = useState<string[]>([]);
  const fws = useQuery({ queryKey: ["security", orgId, "frameworks"], queryFn: () => recordsApi.list(api, "grc_framework", { size: 50, fields: ["name", "key", "placeholder"] }), staleTime: 300_000 });
  const meta = useQuery({ queryKey: SEC_KEYS.meta(orgId), queryFn: () => securityApi.meta(api), staleTime: 300_000 });
  const q = useQuery({ queryKey: SEC_KEYS.soa(orgId, framework), queryFn: () => securityApi.soa(api, framework) });
  const approve = useAction(() => securityApi.approveSoa(api, selected), {
    success: (d) => `${d.approved.toLocaleString("fa-IR")} بند تأیید شد.`,
    onSuccess: () => {
      setSelected([]);
      void q.refetch();
    },
  });
  const rows = q.data?.rows ?? [];
  const approved = rows.filter((r) => r.soa_state === "approved").length;
  return (
    <div>
      <PageHeader
        title="بیانیهٔ کاربست‌پذیری"
        actions={
          <>
            <Select
              className="min-w-64"
              value={framework ?? q.data?.framework?.id}
              onChange={(v) => setSp({ framework: String(v) })}
              loading={fws.isLoading}
              options={(fws.data?.rows ?? []).map((f) => ({ value: String(f.id), label: String(f.name) }))}
              aria-label="چارچوب"
            />
            {meta.data?.can.manage_compliance ? (
              <Button type="primary" icon={<Stamp {...ICON14} />} disabled={!selected.length} onClick={() => approve.mutate(undefined)} loading={approve.isPending}>
                تأیید بندهای انتخاب‌شده
              </Button>
            ) : null}
          </>
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !q.data?.framework ? (
        <EmptyState title="چارچوبی نیست" description="پیش‌فرض‌های امنیت و انطباق را از «تنظیمات امنیت» بیفزایید." />
      ) : (
        <Card
          flush
          title={q.data.framework.name}
          tools={<span className="text-[13px] text-ink-2">{`${approved.toLocaleString("fa-IR")} از ${rows.length.toLocaleString("fa-IR")} بند تأییدشده`}</span>}
        >
          <Table<SoaRow>
            size="small"
            rowKey="id"
            dataSource={rows}
            pagination={{ pageSize: 50, showSizeChanger: false }}
            rowSelection={meta.data?.can.manage_compliance ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]), getCheckboxProps: (r) => ({ disabled: r.soa_state === "approved" }) } : undefined}
            columns={[
              { title: "کد", dataIndex: "code", width: 90, render: (v: string, r) => <Link className="ds-link" to={`/${orgId}/${recordPath("grc_requirement", r.id)}`}><bdi dir="ltr">{v}</bdi></Link> },
              { title: "عنوان", dataIndex: "title", ellipsis: true },
              { title: "کاربست", dataIndex: "applicable", width: 90, render: (v: boolean, r) => (v ? "بله" : <span title={r.justification ?? ""}>خیر</span>) },
              { title: "پیاده‌سازی", dataIndex: "implementation", width: 110, render: (v: string) => IMPL[v] ?? v },
              { title: "انطباق", dataIndex: "compliance", width: 120, render: (v: string) => <Chip tone={COMPLIANCE[v]?.[1] ?? "neutral"}>{COMPLIANCE[v]?.[0] ?? v}</Chip> },
              { title: "کنترل‌ها", dataIndex: "controls", render: (cs: SoaRow["controls"]) => (cs.length ? cs.map((c) => <Link key={c.id} className="ds-link me-2" to={`/${orgId}/${recordPath("grc_control", c.id)}`}><bdi className="ds-num">{c.number}</bdi></Link>) : <span className="text-ink-3">—</span>) },
              { title: "SoA", dataIndex: "soa_state", width: 100, render: (v: string) => (v === "approved" ? <Chip tone="in">تأییدشده</Chip> : <Chip tone="warning">پیش‌نویس</Chip>) },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
