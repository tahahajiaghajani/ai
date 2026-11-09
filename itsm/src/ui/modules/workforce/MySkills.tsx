// «مهارت‌ها» (WFM-002/005/007/009/038): the person's skills with their proficiency, source and verification; their own
// assessment of a catalogue skill; skills suggested from the work they resolved (accepted or declined by them only);
// the expert finder; and the skill needs of their teams against the people who meet them (gaps and single points of
// knowledge).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Rate, Select, Space, Tabs } from "antd";
import { Search, Sparkles } from "lucide-react";
import { toFa } from "@shared/jalali";
import { PROFICIENCY, SKILL_SOURCES, proficiencyLabel } from "@shared/tables/workforce";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card, Field, ICON } from "../../components/blocks";
import { WFM_KEYS, wfmApi } from "./api";
import { PRESENCE_TONE, presenceLabel } from "./model";
import "./workforce.css";

const sourceLabel = (v: string) => SKILL_SOURCES.find((o) => o.value === v)?.label ?? v;

function Mine() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: WFM_KEYS.skills(orgId), queryFn: () => wfmApi.mySkills(api) });
  const cat = useQuery({ queryKey: WFM_KEYS.catalogue(orgId), queryFn: () => wfmApi.catalogue(api) });
  const [skill, setSkill] = useState<string | null>(null);
  const [level, setLevel] = useState(2);
  const [evidence, setEvidence] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: WFM_KEYS.skills(orgId) });
  const save = useAction(() => wfmApi.saveSkill(api, { skill_id: skill!, level, evidence: evidence || null }), { success: "مهارت ثبت شد؛ سرپرست تیم آن را تأیید می‌کند", onSuccess: () => { setSkill(null); setEvidence(""); refresh(); } });
  const infer = useAction(() => wfmApi.infer(api), { success: (d) => (d.suggested.length ? `${toFa(d.suggested.length)} مهارت از کارهای شما پیشنهاد شد` : "مهارت تازه‌ای از کارهای شما پیدا نشد"), onSuccess: refresh });
  const accept = useAction((id: string) => wfmApi.accept(api, id), { onSuccess: refresh });
  const decline = useAction((id: string) => wfmApi.decline(api, id), { onSuccess: refresh });
  if (mine.isLoading) return <Loader />;
  const rows = mine.data?.skills ?? [];
  const suggested = rows.filter((r) => r.status === "suggested");
  const active = rows.filter((r) => r.status === "active");
  return (
    <div className="flex flex-col gap-4">
      {suggested.length ? (
        <Card title="پیشنهاد از کارهای شما" meta="فقط شما آن‌ها را می‌بینید تا بپذیرید">
          {suggested.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 py-1">
              <span>{s.label} <span className="text-[12px] text-ink-3">{s.evidence}</span></span>
              <Space>
                <Button size="small" type="primary" onClick={() => accept.mutate(s.id)}>می‌پذیرم</Button>
                <Button size="small" onClick={() => decline.mutate(s.id)}>نه</Button>
              </Space>
            </div>
          ))}
        </Card>
      ) : null}
      <Card title="مهارت‌های من" tools={<Button icon={<Sparkles {...ICON} />} loading={infer.isPending} onClick={() => infer.mutate(undefined)}>پیشنهاد از کارهای من</Button>}>
        {!active.length ? <EmptyState compact title="هنوز مهارتی ثبت نکرده‌اید" /> : (
          <table className="wfm-people">
            <thead><tr><th scope="col" className="text-start">مهارت</th><th scope="col">سطح</th><th scope="col">منبع</th><th scope="col">تأیید</th></tr></thead>
            <tbody>
              {active.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="text-start font-normal">{s.label}</th>
                  <td><Rate disabled count={5} value={s.level} style={{ fontSize: 12 }} /> <span className="text-[12px] text-ink-3">{proficiencyLabel(s.level)}</span></td>
                  <td className="text-[12px]">{sourceLabel(s.source)}</td>
                  <td>{s.verified ? <Chip tone="in">تأییدشده</Chip> : <Chip tone="neutral">در انتظار تأیید</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="ثبت یا به‌روزرسانی مهارت">
        <div className="wfm-form">
          <Field label="مهارت">
            <Select showSearch optionFilterProp="label" value={skill} onChange={setSkill} placeholder="از فهرست مهارت‌ها" options={(cat.data?.skills ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label="سطح تسلط" hint={PROFICIENCY.find((p) => p.level === level)?.anchor}>
            <Rate count={5} value={level} onChange={(v) => setLevel(v || 1)} tooltips={PROFICIENCY.map((p) => p.label)} />
          </Field>
          <Field label="شواهد (دوره، پروژه، گواهی)"><Input.TextArea value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={4000} autoSize={{ minRows: 1, maxRows: 4 }} /></Field>
        </div>
        <Button type="primary" disabled={!skill} loading={save.isPending} onClick={() => save.mutate(undefined)}>ثبت</Button>
      </Card>
    </div>
  );
}

function Experts() {
  const { api, orgId } = useOrg();
  const cat = useQuery({ queryKey: WFM_KEYS.catalogue(orgId), queryFn: () => wfmApi.catalogue(api) });
  const [skill, setSkill] = useState<string | null>(null);
  const [level, setLevel] = useState(3);
  const q = useQuery({ queryKey: WFM_KEYS.experts(orgId, skill ?? "", level), queryFn: () => wfmApi.experts(api, skill!, level), enabled: !!skill });
  return (
    <Card title="یافتن خبره">
      <Space wrap className="mb-3">
        <Select showSearch optionFilterProp="label" style={{ minInlineSize: 240 }} value={skill} onChange={setSkill} placeholder="مهارت" suffixIcon={<Search size={14} />} options={(cat.data?.skills ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Select value={level} onChange={setLevel} style={{ minInlineSize: 150 }} options={PROFICIENCY.map((p) => ({ value: p.level, label: `دست‌کم ${p.label}` }))} />
      </Space>
      {!skill ? <p className="text-[13px] text-ink-3">مهارتی را برگزینید.</p> : q.isLoading ? <Loader /> : !q.data?.people.length ? <EmptyState compact title="کسی با این سطح پیدا نشد" /> : (
        <ul className="flex flex-col gap-1">
          {q.data.people.map((p) => (
            <li key={p.user_id} className="flex items-center justify-between gap-2 text-[13px]">
              <span>{p.name} <span className="text-ink-3">— {p.level_label}{p.verified ? "، تأییدشده" : ""}</span></span>
              <Chip tone={PRESENCE_TONE[p.presence ?? "offline"] ?? "neutral"}>{presenceLabel(p.presence)}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Coverage() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: WFM_KEYS.coverage(orgId, null), queryFn: () => wfmApi.coverage(api) });
  if (q.isLoading) return <Loader />;
  const rows = q.data?.rows ?? [];
  if (!rows.length) return <EmptyState title="نیاز مهارتی برای تیم‌های شما ثبت نشده است" />;
  return (
    <Card title="پوشش مهارت‌های تیم">
      <table className="wfm-people">
        <thead><tr><th scope="col" className="text-start">نیاز</th><th scope="col">افراد واجد</th><th scope="col">وضعیت</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="text-start font-normal">{r.label}{r.critical ? <Chip tone="accent" dot={false} className="ms-1">حیاتی</Chip> : null}</th>
              <td className="text-[12px]">{r.qualified.map((x) => x.name).join("، ") || "—"}</td>
              <td>{r.gap ? <Chip tone="danger">{toFa(r.gap)} نفر کم</Chip> : r.single_point ? <Chip tone="warning">فرد کلیدی تنها</Chip> : <Chip tone="in">پوشش کامل</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function MySkills() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="مهارت‌ها" />
      <Tabs items={[{ key: "mine", label: "مهارت‌های من", children: <Mine /> }, { key: "experts", label: "یافتن خبره", children: <Experts /> }, { key: "coverage", label: "پوشش تیم", children: <Coverage /> }]} />
    </div>
  );
}
