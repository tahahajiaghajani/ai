// «بستهٔ بازبینی خدمت» (SLM-046/047/048): the pack of a service review — every target's compliance and trend, breaches
// by definition, team and priority, volume against the ceiling, incidents, problems and changes of the service, the
// survey experience, the watermelon gap, credits and the improvement register — with the narrative (AI over the
// computed numbers, else written by rules) and the improvement suggestions that become CSI items once a person picks
// them. Printable for the meeting.
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Space } from "antd";
import { ClipboardList, Lightbulb, PenLine, Printer, RefreshCw } from "lucide-react";
import { toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";
import { recordPath, RecordMarkdown } from "../../records";
import { recordsApi } from "../../records/data/api";
import { Sparkline } from "../analytics/Chart";
import { SLM_KEYS, slmApi } from "./api";
import { barPct, STATUS_LABEL, STATUS_TONE, targetKindLabel, valueText } from "./model";
import "./slm.css";

type Suggestion = { title: string; description: string; value: number; effort: number };

export default function ReviewPack() {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const review = useQuery({ queryKey: ["slm", orgId, "review", id], queryFn: () => recordsApi.get(api, "slm_review", id) });
  const pack = useQuery({ queryKey: SLM_KEYS.pack(orgId, id), queryFn: () => slmApi.pack(api, id) });
  const [narrative, setNarrative] = useState<{ text: string; ai: boolean } | null>(null);
  const [ideas, setIdeas] = useState<{ items: Suggestion[]; ai: boolean } | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: SLM_KEYS.pack(orgId, id) });
    qc.invalidateQueries({ queryKey: ["slm", orgId, "review", id] });
  };
  const build = useAction(() => slmApi.buildPack(api, id), { success: "بستهٔ بازبینی ساخته شد", onSuccess: refresh });
  const write = useAction(() => slmApi.narrative(api, id, true), { success: (d) => (d.ai ? "روایت با هوش مصنوعی نوشته و ذخیره شد" : "روایت از عددها نوشته و ذخیره شد"), onSuccess: (d) => { setNarrative(d); refresh(); } });
  const suggest = useAction(() => slmApi.suggest(api, id), { onSuccess: (d) => { setIdeas(d); setPicked(d.items.map((_, i) => i)); } });
  const create = useAction(() => slmApi.actions(api, id, (ideas?.items ?? []).filter((_, i) => picked.includes(i)).map((s) => ({ ...s, ai: ideas?.ai }))), {
    success: (d) => `${toFa(d.created.length)} اقدام بهبود ثبت شد`,
    onSuccess: () => { setIdeas(null); refresh(); },
  });
  if (review.isLoading || pack.isLoading) return <Loader />;
  const r = review.data?.row as Record<string, any> | undefined;
  const p = pack.data?.pack;
  if (!r || !p) return <EmptyState title="بازبینی پیدا نشد" />;
  const canWrite = !!review.data?.meta?.canWrite;
  const text = narrative?.text ?? (String(r.narrative ?? "").trim() || null);
  return (
    <div className="flex flex-col gap-4 slm-pack">
      <PageHeader
        title={`بستهٔ بازبینی: ${r.title}`}
        subtitle={<span>{p.period.label}{p.agreement ? <> · <Link className="ds-link" to={`/${orgId}/slm/agreements/${p.agreement.id}/360`}>{p.agreement.name}</Link></> : null}</span>}
        back
        actions={
          <Space wrap className="no-print">
            {canWrite && ["scheduled", "prepared", "held", "actions_open"].includes(String(r.state)) ? <Button icon={<RefreshCw {...ICON} />} loading={build.isPending} onClick={() => build.mutate(undefined)}>{pack.data?.stored ? "ساختن دوبارهٔ بسته" : "ساختن بسته"}</Button> : null}
            {canWrite ? <Button icon={<PenLine {...ICON} />} loading={write.isPending} onClick={() => write.mutate(undefined)}>نوشتن روایت</Button> : null}
            <Button icon={<Lightbulb {...ICON} />} loading={suggest.isPending} onClick={() => suggest.mutate(undefined)}>پیشنهاد بهبود</Button>
            <Button icon={<Printer {...ICON} />} onClick={() => window.print()}>چاپ</Button>
            <Button type="primary" icon={<ClipboardList {...ICON} />} href={`/${orgId}/${recordPath("slm_review", id)}`}>رکورد بازبینی</Button>
          </Space>
        }
      />
      {!pack.data?.stored ? <Note>این پیش‌نمایش زندهٔ عددهاست؛ با «ساختن بسته» عکس آن برای نشست ذخیره می‌شود.</Note> : null}
      {p.watermelon.flagged ? <Note tone="danger">توافق سبز است اما تجربهٔ کاربران {toFa(p.watermelon.gap ?? 0)} امتیاز پایین‌تر است.</Note> : null}
      <div className="slm-kpis">
        <Card title="انطباق کل">
          <div className="flex items-center gap-3">
            <span className="ds-t-figure ds-num">{p.overall.value === null ? "—" : `${toFa(Math.round(p.overall.value * 10) / 10)}٪`}</span>
            <Chip tone={STATUS_TONE[p.overall.status]}>{STATUS_LABEL[p.overall.status]}</Chip>
          </div>
          {p.overall.goal !== null ? <span className="text-[12px] text-ink-3">هدف <span className="ds-num">{toFa(p.overall.goal)}٪</span></span> : null}
        </Card>
        <Card title="حجم کار">
          <div className="grid grid-cols-2 gap-1 text-[13px]">
            <span>ثبت‌شده</span><span className="ds-num">{toFa(p.volume.created)}</span>
            <span>پایان‌یافته</span><span className="ds-num">{toFa(p.volume.resolved)}</span>
            {p.volume.limit !== null ? <><span>سقف ماهانه</span><span className="ds-num">{toFa(p.volume.limit)}{p.volume.over_limit ? " (گذشت)" : ""}</span></> : null}
          </div>
        </Card>
        <Card title="رخدادها، مشکل‌ها، تغییرها">
          <div className="grid grid-cols-2 gap-1 text-[13px]">
            <span>رخداد</span><span className="ds-num">{toFa(p.incidents.total)}{p.incidents.major ? ` (${toFa(p.incidents.major)} عمده)` : ""}</span>
            <span>مشکل باز</span><span className="ds-num">{toFa(p.problems.open)}</span>
            <span>تغییر</span><span className="ds-num">{toFa(p.changes.total)}{p.changes.failed ? ` (${toFa(p.changes.failed)} ناموفق)` : ""}</span>
          </div>
        </Card>
        <Card title="تجربه">
          {!p.experience || p.experience.suppressed || p.experience.experience_pct === null ? (
            <p className="text-[13px] text-ink-3">{p.experience?.responses ? `پاسخ‌ها برای گزارش کافی نیست (${toFa(p.experience.responses)})` : "پاسخ نظرسنجی نیست"}</p>
          ) : (
            <div className="grid grid-cols-2 gap-1 text-[13px]">
              <span>امتیاز تجربه</span><span className="ds-num">{toFa(p.experience.experience_pct)}</span>
              <span>رضایت</span><span className="ds-num">{p.experience.csat === null ? "—" : `${toFa(p.experience.csat)}٪`}</span>
              <span>پاسخ‌ها</span><span className="ds-num">{toFa(p.experience.responses)}</span>
            </div>
          )}
        </Card>
      </div>
      <Card title="اهداف">
        {!p.targets.length ? <p className="text-ink-3">این بازبینی توافقی با هدف ندارد.</p> : (
          <table className="slm-table">
            <thead><tr><th scope="col">هدف</th><th scope="col">نوع</th><th scope="col">مقدار</th><th scope="col">هدف</th><th scope="col">وضعیت</th><th scope="col">روند</th></tr></thead>
            <tbody>
              {p.targets.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className="text-start font-normal">{t.name}</th>
                  <td>{targetKindLabel(t.kind)}</td>
                  <td className="ds-num">{valueText(t.kind, t.value)}{t.kind === "timer" ? <span className="text-ink-3 text-[12px]"> ({toFa(t.breached)} نقض از {toFa(t.total)})</span> : null}</td>
                  <td className="ds-num">{valueText(t.kind, t.goal)}</td>
                  <td><Chip tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Chip></td>
                  <td style={{ inlineSize: 120 }}><Sparkline points={[...t.trend.map((x) => ({ key: x.label, label: x.label, value: x.value })), { key: "now", label: "این دوره", value: t.value }]} target={t.goal} height={28} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="slm-cols">
        <Card title="نقض‌ها">
          {!p.breaches.length ? <p className="text-[13px] text-ink-3">نقضی در دوره نبود.</p> : p.breaches.slice(0, 10).map((b) => (
            <div key={`${b.by}:${b.label}`} className="slm-mini">
              <span className="truncate">{b.label}</span>
              <span className="slm-mini-bar"><i style={{ inlineSize: `${barPct((b.count / Math.max(...p.breaches.map((x) => x.count))) * 100)}%` }} /></span>
              <span className="ds-num">{toFa(b.count)}</span>
            </div>
          ))}
        </Card>
        <Card title="بهبود و جریمه">
          <div className="grid grid-cols-2 gap-1 text-[13px]">
            <span>اقدام باز</span><span className="ds-num">{toFa(p.improvements.open)}</span>
            <span>عقب‌افتاده</span><span className="ds-num">{toFa(p.improvements.overdue)}</span>
            <span>انجام‌شده در دوره</span><span className="ds-num">{toFa(p.improvements.done)}</span>
            <span>جریمهٔ محاسبه‌شده</span><span className="ds-num">{toFa(p.credits.count)}</span>
          </div>
        </Card>
      </div>
      <Card title="روایت بازبینی" meta={r.narrative_ai || narrative?.ai ? "نوشتهٔ هوش مصنوعی از عددهای بسته" : "از عددهای بسته"}>
        {text ? <RecordMarkdown text={text} /> : <p className="text-ink-3">هنوز روایتی نوشته نشده است.</p>}
      </Card>
      {ideas ? (
        <Card title="پیشنهادهای بهبود" meta={ideas.ai ? "پیشنهاد هوش مصنوعی" : "پیشنهاد قاعده‌محور"} className="no-print">
          {!ideas.items.length ? <p className="text-ink-3">پیشنهادی نیست؛ اهداف برآورده شده‌اند.</p> : (
            <div className="flex flex-col gap-2">
              {ideas.items.map((s, i) => (
                <label key={i} className="flex items-start gap-2">
                  <Checkbox checked={picked.includes(i)} onChange={(e) => setPicked(e.target.checked ? [...picked, i] : picked.filter((x) => x !== i))} />
                  <span><span className="font-medium">{s.title}</span> <span className="text-[12px] text-ink-3">ارزش {toFa(s.value)}، تلاش {toFa(s.effort)}</span><br /><span className="text-[13px] text-ink-2">{s.description}</span></span>
                </label>
              ))}
              <Button type="primary" className="self-start" disabled={!picked.length} loading={create.isPending} onClick={() => create.mutate(undefined)}>ثبت در ثبت بهبود مستمر</Button>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
