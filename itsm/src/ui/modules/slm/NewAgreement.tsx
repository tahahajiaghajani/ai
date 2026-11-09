// «توافق تازه از الگو» (SLM-003): pick a package (gold / silver / bronze SLA, a team's OLA, a supplier's UC), the
// service and the customer, and the agreement is created in «گردآوری نیازها» with the template's document and targets
// (timer targets generate the SLA service's definitions, off until the agreement is in force).
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Radio } from "antd";
import { toFa, todayISO } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { Card, Field } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { RecordSelect, UserSelect } from "../../records";
import { recordsApi } from "../../records/data/api";
import { slmApi } from "./api";
import { kindLabel, type Row } from "./model";
import "./slm.css";

export default function NewAgreement() {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const templates = useQuery({ queryKey: ["slm", orgId, "templates"], queryFn: () => recordsApi.list(api, "slm_template", { filter: { f: "active", op: "eq", v: true }, size: 50, total: false, sort: "kind,name" }) });
  const [tpl, setTpl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [service, setService] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [supplier, setSupplier] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(todayISO(timezone));
  const [to, setTo] = useState<string | null>(null);
  const rows = (templates.data?.rows ?? []) as Row[];
  const chosen = rows.find((r) => r.id === tpl);
  const create = useAction(
    () => slmApi.fromTemplate(api, { template_id: tpl, name, service_id: service, customer_unit_id: customer, provider_group_id: provider, supplier_name: supplier || null, manager_id: owner, valid_from: from, valid_to: to }),
    { success: (d) => `توافق ${d.number ?? ""} ساخته شد`, onSuccess: (d) => nav(`/${orgId}/slm/agreements/${d.id}/360`) },
  );
  const ready = !!tpl && name.trim().length >= 2 && !!service && !!customer && !!from && (chosen?.kind !== "ola" || !!provider) && (chosen?.kind !== "uc" || !!supplier.trim());
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="توافق تازه از الگو" back />
      {templates.isLoading ? <Loader /> : !rows.length ? <EmptyState title="الگوی توافقی ثبت نشده است" description="پیش‌فرض‌های سطح خدمت را از «نمای کلی سطح خدمت» بیفزایید." /> : (
        <>
          <Card title="الگو">
            <Radio.Group value={tpl} onChange={(e) => setTpl(e.target.value)} className="slm-templates">
              {rows.map((t) => (
                <Radio.Button key={t.id} value={t.id} className="slm-template">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-[12px] text-ink-3">{kindLabel(t.kind)} · هدف انطباق {toFa(Number(t.compliance_target ?? 95))}٪</span>
                </Radio.Button>
              ))}
            </Radio.Group>
            {chosen?.description ? <p className="text-[13px] text-ink-2 mt-2">{String(chosen.description)}</p> : null}
          </Card>
          <Card title="طرف‌ها و اعتبار">
            <div className="slm-form">
              <Field label="نام توافق"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="مثلاً توافق ایمیل سازمانی — واحد مالی" /></Field>
              <Field label="خدمت"><RecordSelect table="service" value={service} onChange={(v) => setService(v as string | null)} /></Field>
              <Field label="مشتری (واحد یا شرکت)"><RecordSelect table="org_unit" value={customer} onChange={(v) => setCustomer(v as string | null)} /></Field>
              <Field label="مالک توافق"><UserSelect value={owner} onChange={(v) => setOwner(v as string | null)} /></Field>
              {chosen?.kind === "ola" || chosen?.kind === "uc" ? <Field label="گروه ارائه‌دهنده"><RecordSelect table="group" value={provider} onChange={(v) => setProvider(v as string | null)} /></Field> : null}
              {chosen?.kind === "uc" ? <Field label="تأمین‌کننده"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={160} /></Field> : null}
              <Field label="اعتبار از"><DateInput value={from} onChange={setFrom} /></Field>
              <Field label="اعتبار تا"><DateInput value={to} onChange={setTo} allowClear /></Field>
            </div>
            <Button type="primary" className="mt-3" disabled={!ready} loading={create.isPending} onClick={() => create.mutate(undefined)}>ساختن توافق</Button>
          </Card>
        </>
      )}
    </div>
  );
}
