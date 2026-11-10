// «آغاز سفر کارمند» (ESM-020/021): a template, the person (a member, or a name before their account exists), their
// manager and HR owner, and the anchor day (the start date, the last day…). Before starting, the template's activities
// are shown with their planned dates on the organisation's working calendar, and problems of the template (cycles,
// missing catalogue items) stop the start.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { Play } from "lucide-react";
import { formatJalali, toFa, todayISO } from "@shared/jalali";
import { ACTIVITY_KINDS, JOURNEY_PHASES } from "@shared/tables/esm";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, Loader } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { ChoiceTag, RecordSelect } from "../../records";
import { ESM_KEYS, esmApi } from "./api";

export default function StartJourney() {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const [tpl, setTpl] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(todayISO(timezone));
  const [subject, setSubject] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [manager, setManager] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [name, setName] = useState("");
  const preview = useQuery({ queryKey: ESM_KEYS.preview(orgId, tpl ?? "", anchor ?? ""), queryFn: () => esmApi.preview(api, tpl!, anchor!), enabled: !!tpl && !!anchor });
  const start = useAction(
    () => esmApi.startJourney(api, { template_id: tpl, anchor_date: anchor, subject_person_id: subject, subject_name: subject ? null : subjectName.trim() || null, manager_id: manager, hr_owner_id: owner, name: name.trim() || null }),
    { success: "سفر آغاز شد", onSuccess: (d) => nav(`/${orgId}/hr/journeys/${d.journey.id}/tracker`) },
  );
  const problems = preview.data?.problems ?? [];
  const ok = !!tpl && !!anchor && (!!subject || subjectName.trim().length > 1) && !problems.length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="آغاز سفر کارمند" back={`/${orgId}/hr/journeys`} actions={<Button type="primary" icon={<Play {...ICON} />} disabled={!ok} loading={start.isPending} onClick={() => start.mutate(undefined)}>آغاز سفر</Button>} />
      <Card>
        <Form layout="vertical" className="grid gap-x-4 md:grid-cols-2">
          <Form.Item label="الگوی سفر" required><RecordSelect table="journey_template" value={tpl} onChange={(v) => setTpl((v as string | null) ?? null)} filter={{ f: "active", op: "eq", v: true }} aria-label="الگوی سفر" /></Form.Item>
          <Form.Item label="روز مبنا (شروع کار، آخرین روز…)" required><DateInput value={anchor} onChange={(v: string | null) => setAnchor(v)} aria-label="روز مبنا" /></Form.Item>
          <Form.Item label="کارمند (عضو سامانه)"><RecordSelect table="user" value={subject} onChange={(v) => setSubject((v as string | null) ?? null)} allowClear aria-label="کارمند" /></Form.Item>
          <Form.Item label="یا نام کارمند تازه (پیش از ساخت حساب)"><Input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} disabled={!!subject} maxLength={160} /></Form.Item>
          <Form.Item label="مدیر"><RecordSelect table="user" value={manager} onChange={(v) => setManager((v as string | null) ?? null)} allowClear aria-label="مدیر" /></Form.Item>
          <Form.Item label="مسئول منابع انسانی"><RecordSelect table="user" value={owner} onChange={(v) => setOwner((v as string | null) ?? null)} allowClear meFirst aria-label="مسئول منابع انسانی" /></Form.Item>
          <Form.Item label="نام سفر (اختیاری)" className="md:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="خالی: نام الگو و نام کارمند" /></Form.Item>
        </Form>
      </Card>
      {tpl && anchor ? (
        <Card title="برنامهٔ پیش‌بینی‌شده">
          {preview.isLoading ? (
            <Loader />
          ) : (
            <>
              {problems.length ? (
                <Note tone="danger">
                  <ul className="list-disc ps-4">{problems.map((p) => <li key={`${p.code}:${p.message}`}>{p.message}</li>)}</ul>
                </Note>
              ) : null}
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-ink-3">
                    <th className="py-1 text-start font-normal">فعالیت</th>
                    <th className="py-1 text-start font-normal">مرحله</th>
                    <th className="py-1 text-start font-normal">نوع</th>
                    <th className="py-1 text-start font-normal">شروع</th>
                    <th className="py-1 text-start font-normal">موعد</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.data?.activities ?? []).map((a) => (
                    <tr key={a.code} className="border-t border-line">
                      <td className="py-1.5">{a.name}{a.day_one ? <Chip tone="accent" className="ms-2">روز نخست</Chip> : null}</td>
                      <td className="py-1.5">{JOURNEY_PHASES.find((p) => p.value === a.phase)?.label ?? a.phase}</td>
                      <td className="py-1.5"><ChoiceTag option={ACTIVITY_KINDS.find((k) => k.value === a.kind)} value={String(a.kind)} /></td>
                      <td className="py-1.5">{a.start_date ? formatJalali(a.start_date) : "—"}</td>
                      <td className="py-1.5">{a.due_date ? formatJalali(a.due_date) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-ink-3">{toFa(preview.data?.activities.length ?? 0)} فعالیت؛ تاریخ‌ها روزهای کاری تقویم الگو را می‌شمارند.</p>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
