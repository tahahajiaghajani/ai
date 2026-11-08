// «کارگاه تحلیل علت» — the RCA canvas of a problem (catalogue PRB-017): five whys, the fishbone (people, process,
// technology, supplier, environment, measurement), the timeline of what happened, hypotheses with their evidence and
// status, «هست / نیست» (Kepner-Tregoe) and the conclusion. Stored as the problem's `rca` JSON with the record's version
// (a colleague's newer save opens the conflict dialog); «انتقال به علت ریشه‌ای» writes the analysis into the problem's
// cause. With the AI layer on, «پیشنهاد هوش مصنوعی» adds suggested whys and hypotheses for a person to keep or drop.
// A problem shows the sections it names in «بخش‌های کارگاه تحلیل» (from its template), else all of them.
import { useEffect, useMemo, useState } from "react";
import { Button, Input, Popconfirm, Select, Tag } from "antd";
import { Plus, Save, Trash2, ArrowDownToLine, Sparkles } from "lucide-react";
import { canvasSections, CONFIDENCE, FISHBONE, HYPOTHESIS_STATES, IS_ISNOT_ROWS, rcaMarkdown, type RcaCanvas } from "@shared/problem/logic";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { DateTimeInput, type RecordContext } from "../../records";
import { problemApi } from "./api";
import {
  addCause, addEvent, addHypothesis, addWhy, rcaDirty, rcaOf, removeAt, removeCause, setHypothesis, setIsIsNot, setWhy,
} from "./model";

function Section({ title, children, tools }: { title: string; children: React.ReactNode; tools?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-line pb-4 last:border-b-0" aria-label={title}>
      <div className="flex items-center gap-2">
        <h3 className="ds-t-label text-ink">{title}</h3>
        {tools ? <div className="ms-auto">{tools}</div> : null}
      </div>
      {children}
    </section>
  );
}

export default function RcaCanvasTab({ ctx }: { ctx: RecordContext }) {
  const { api, timezone } = useOrg();
  const stored = ctx.row.rca;
  const [c, setC] = useState<RcaCanvas>(() => rcaOf(stored));
  const [cause, setCause] = useState<Record<string, string>>({});
  const [hyp, setHyp] = useState("");
  const [evAt, setEvAt] = useState<string | null>(new Date().toISOString());
  const [evText, setEvText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setC(rcaOf(stored)), [stored]);
  const dirty = useMemo(() => rcaDirty(c, stored), [c, stored]);
  const ro = !ctx.meta.canWrite || ctx.meta.locked || (ctx.meta.readonly ?? []).includes("rca");
  const aiOn = ((ctx.meta as { problem?: { ai?: string[] } }).problem?.ai ?? []).includes("problem.draftRca");
  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    await ctx.save({ rca: c, ...extra });
    setSaving(false);
  };
  const ai = useAction(() => problemApi.ai(api, ctx.row.id, "draftRca") as Promise<Partial<RcaCanvas>>, {
    success: "پیشنهادها افزوده شد؛ آن‌ها را بازبینی کنید.",
    onSuccess: (d) =>
      setC((cur) => {
        let next = cur;
        for (const w of d.whys ?? []) next = { ...next, whys: [...next.whys, w] };
        for (const h of d.hypotheses ?? []) next = addHypothesis(next, h.text);
        return next;
      }),
  });

  const show = canvasSections(ctx.row.rca_sections);
  return (
    <div className="flex flex-col gap-4">
      {show.has("whys") ? (
        <Section
          title="پنج چرا"
          tools={!ro ? (
            <Button size="small" icon={<Plus {...ICON14} />} onClick={() => setC(addWhy(c))} disabled={c.whys.length >= 10}>
              چرای بعدی
            </Button>
          ) : undefined}
        >
          {!c.whys.length ? <p className="text-[13px] text-ink-3">با پرسیدن «چرا؟» از نشانهٔ مشکل شروع کنید و تا رسیدن به علتی که می‌شود برطرفش کرد ادامه دهید.</p> : null}
          <ol className="flex flex-col gap-2">
            {c.whys.map((w, i) => (
              <li key={i} className="grid gap-1.5 sm:grid-cols-[2rem_1fr_1fr_auto] sm:items-start">
                <span className="ds-num pt-1 text-[13px] text-ink-3">{(i + 1).toLocaleString("fa-IR")}</span>
                <Input value={w.question} onChange={(e) => setC(setWhy(c, i, { question: e.target.value }))} readOnly={ro} aria-label={`پرسش ${i + 1}`} maxLength={500} />
                <Input.TextArea value={w.answer} onChange={(e) => setC(setWhy(c, i, { answer: e.target.value }))} readOnly={ro} autoSize={{ minRows: 1, maxRows: 4 }} aria-label={`پاسخ ${i + 1}`} placeholder="زیرا…" />
                {!ro ? <Button type="text" size="small" aria-label="حذف" icon={<Trash2 {...ICON14} />} onClick={() => setC(removeAt(c, "whys", i))} /> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {show.has("fishbone") ? (
        <Section title="استخوان ماهی (عوامل)">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FISHBONE.map((b) => (
              <div key={b.key} className="flex flex-col gap-1.5 rounded-md bg-sunken p-2.5">
                <span className="text-[13px] text-ink-2">{b.label}</span>
                <div className="flex flex-wrap gap-1">
                  {(c.fishbone[b.key] ?? []).map((x, i) => (
                    <Tag key={`${x}-${i}`} closable={!ro} onClose={(e) => { e.preventDefault(); setC(removeCause(c, b.key, i)); }}>
                      {x}
                    </Tag>
                  ))}
                </div>
                {!ro ? (
                  <Input
                    size="small"
                    value={cause[b.key] ?? ""}
                    onChange={(e) => setCause({ ...cause, [b.key]: e.target.value })}
                    onPressEnter={() => {
                      setC(addCause(c, b.key, cause[b.key] ?? ""));
                      setCause({ ...cause, [b.key]: "" });
                    }}
                    placeholder="عامل تازه و Enter"
                    maxLength={300}
                    aria-label={`عامل تازهٔ ${b.label}`}
                  />
      ) : null}
            </div>
          ))}
        </div>
      </Section>
      ) : null}

      {show.has("timeline") ? (
        <Section title="خط زمانی">
          <ul className="flex flex-col gap-1">
            {c.timeline.map((t, i) => (
              <li key={`${t.at}-${i}`} className="flex flex-col gap-0.5 text-[13px] sm:flex-row sm:items-start sm:gap-2">
                <span className="ds-num shrink-0 text-ink-3 sm:w-[132px]">{t.at && !Number.isNaN(Date.parse(t.at)) ? formatJalaliDateTime(t.at, timezone) : t.at}</span>
                <span className="min-w-0 flex-1 text-ink">{t.text}</span>
                {!ro ? <Button type="text" size="small" aria-label="حذف" icon={<Trash2 {...ICON14} />} onClick={() => setC(removeAt(c, "timeline", i))} /> : null}
              </li>
            ))}
          </ul>
          {!ro ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,15rem)_1fr_auto]">
              <DateTimeInput value={evAt} onChange={setEvAt} tz={timezone} />
              <Input value={evText} onChange={(e) => setEvText(e.target.value)} placeholder="چه رخ داد" maxLength={500} onPressEnter={() => { setC(addEvent(c, evAt ?? "", evText)); setEvText(""); }} />
              <Button icon={<Plus {...ICON14} />} onClick={() => { setC(addEvent(c, evAt ?? "", evText)); setEvText(""); }} disabled={!evText.trim()}>
                افزودن
              </Button>
            </div>
      ) : null}
      </Section>
      ) : null}

      {show.has("hypotheses") ? (
        <Section
          title="فرضیه‌ها و شواهد"
          tools={aiOn && !ro ? (
            <Button size="small" icon={<Sparkles {...ICON14} />} onClick={() => ai.mutate(undefined)} loading={ai.isPending}>
              پیشنهاد هوش مصنوعی
            </Button>
          ) : undefined}
        >
          <ul className="flex flex-col gap-2">
            {c.hypotheses.map((h) => (
              <li key={h.id} className="grid gap-1.5 rounded-md bg-sunken p-2.5 lg:grid-cols-[1.4fr_1.4fr_8rem_9rem_auto] lg:items-start">
                <Input.TextArea value={h.text} onChange={(e) => setC(setHypothesis(c, h.id, { text: e.target.value }))} readOnly={ro} autoSize={{ minRows: 1, maxRows: 4 }} aria-label="فرضیه" />
                <Input.TextArea value={h.evidence} onChange={(e) => setC(setHypothesis(c, h.id, { evidence: e.target.value }))} readOnly={ro} autoSize={{ minRows: 1, maxRows: 4 }} placeholder="شواهد (رخداد، تغییر، گزارش…)" aria-label="شواهد" />
                <Select value={h.status} onChange={(v) => setC(setHypothesis(c, h.id, { status: v }))} disabled={ro} options={HYPOTHESIS_STATES.map((s) => ({ value: s.value, label: s.label }))} aria-label="وضعیت فرضیه" />
                <Select value={h.confidence} onChange={(v) => setC(setHypothesis(c, h.id, { confidence: v }))} disabled={ro} options={CONFIDENCE.map((s) => ({ value: s.value, label: `اطمینان ${s.label}` }))} aria-label="اطمینان" />
                {!ro ? <Button type="text" size="small" aria-label="حذف" icon={<Trash2 {...ICON14} />} onClick={() => setC(removeAt(c, "hypotheses", c.hypotheses.indexOf(h)))} /> : null}
              </li>
            ))}
          </ul>
          {!ro ? (
            <Input value={hyp} onChange={(e) => setHyp(e.target.value)} onPressEnter={() => { setC(addHypothesis(c, hyp)); setHyp(""); }} placeholder="فرضیهٔ تازه و Enter" maxLength={500} aria-label="فرضیهٔ تازه" />
      ) : null}
      </Section>
      ) : null}

      {show.has("is_not") ? (
        <Section title="هست / نیست">
          <div className="grid gap-1.5">
            {IS_ISNOT_ROWS.map((r) => (
              <div key={r.key} className="grid gap-1.5 sm:grid-cols-[7rem_1fr_1fr] sm:items-center">
                <span className="text-[13px] text-ink-2">{r.label}</span>
                <Input value={c.is_isnot[r.key]?.is ?? ""} onChange={(e) => setC(setIsIsNot(c, r.key, "is", e.target.value))} readOnly={ro} placeholder="هست" aria-label={`${r.label} — هست`} maxLength={500} />
                <Input value={c.is_isnot[r.key]?.isnot ?? ""} onChange={(e) => setC(setIsIsNot(c, r.key, "isnot", e.target.value))} readOnly={ro} placeholder="نیست (ولی می‌توانست باشد)" aria-label={`${r.label} — نیست`} maxLength={500} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="نتیجه">
        <Input.TextArea value={c.conclusion} onChange={(e) => setC({ ...c, conclusion: e.target.value })} readOnly={ro} autoSize={{ minRows: 2, maxRows: 10 }} maxLength={4000} aria-label="نتیجهٔ تحلیل" />
      </Section>

      {!ro ? (
        <div className="flex flex-wrap gap-2">
          <Button type="primary" icon={<Save {...ICON14} />} disabled={!dirty} loading={saving} onClick={() => void save()}>
            ذخیرهٔ تحلیل
          </Button>
          <Popconfirm
            title="تحلیل در «علت ریشه‌ای» نوشته شود؟"
            description={ctx.row.cause_notes ? "متن کنونی «علت ریشه‌ای» جایگزین می‌شود." : undefined}
            okText="انتقال"
            cancelText="انصراف"
            onConfirm={() => void save({ cause_notes: rcaMarkdown(c) })}
          >
            <Button icon={<ArrowDownToLine {...ICON14} />} disabled={!rcaMarkdown(c)}>
              انتقال به علت ریشه‌ای
            </Button>
          </Popconfirm>
        </div>
      ) : null}
    </div>
  );
}
