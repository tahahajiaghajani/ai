// «هوش مصنوعی» beside every record (catalogue AI-006/023/159/164/169): the skills that apply to its table, run as the
// member (the server reads only what they may read), the answer as it is written, labelled «ساخته‌شده با هوش مصنوعی»
// with its model (or as a rule-based answer when no model is configured), cited sources, field suggestions as a diff
// that is applied as a proposal with the member's own access, feedback (👍/👎 with a comment), the open proposals of
// the record (also those the «دستیار هوش مصنوعی» made on its own) and the member's own runs of this record.
import "./skills.css";
import "../assistant/assistant.css";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import { Copy, History, Play, Settings2, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { AiProposal } from "@shared/ai/types";
import { AI_SETTINGS_PATH, outputCaption, type SkillCard, type SkillRunResult } from "@shared/ai/skills";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa, pct } from "../../lib/fa";
import { Loader } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import type { RecordContext } from "../../records/extensions";
import { Narrative } from "../kit/Narrative";
import { ProposalCard } from "../assistant/ProposalCard";
import { RecordAgents } from "../agents/RecordAgents";
import { SKILL_KEYS, runStream, skillsApi, useOwnRuns, useRecordSkills } from "./api";
import { confidenceWord, defaultParams, missingParams, panelSkills, resultMarkdown } from "./model";

type Params = Record<string, string | number | boolean | null>;

function ParamsForm({ card, values, onChange }: { card: SkillCard; values: Params; onChange: (v: Params) => void }) {
  return (
    <div className="sk-params">
      {card.params.map((p) => (
        <label key={p.name} className="grid gap-1 text-[12.5px]">
          <span className="text-ink-2">
            {p.label}
            {p.required ? " *" : ""}
          </span>
          {p.type === "choice" ? (
            <Select size="small" value={(values[p.name] as string) ?? undefined} onChange={(v) => onChange({ ...values, [p.name]: v })} options={(p.choices ?? []).map((c) => ({ value: c.value, label: c.label }))} aria-label={p.label} />
          ) : p.type === "number" ? (
            <InputNumber size="small" value={(values[p.name] as number) ?? null} onChange={(v) => onChange({ ...values, [p.name]: v })} aria-label={p.label} />
          ) : p.type === "bool" ? (
            <Switch size="small" checked={!!values[p.name]} onChange={(v) => onChange({ ...values, [p.name]: v })} aria-label={p.label} />
          ) : p.type === "text" ? (
            <Input.TextArea size="small" value={(values[p.name] as string) ?? ""} onChange={(e) => onChange({ ...values, [p.name]: e.target.value })} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={p.max ?? 4000} aria-label={p.label} />
          ) : (
            <Input size="small" value={(values[p.name] as string) ?? ""} onChange={(e) => onChange({ ...values, [p.name]: e.target.value })} maxLength={p.max ?? 400} aria-label={p.label} />
          )}
        </label>
      ))}
    </div>
  );
}

/** One answer: the text (or the structured answer as Markdown), sources, the diff of suggestions, the label, feedback. */
export function SkillResult({ result, onProposal, onInsert }: { result: SkillRunResult; onProposal?: (p: AiProposal) => void; onInsert?: (text: string) => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const nav = useNavigate();
  const [rated, setRated] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState("");
  const [asking, setAsking] = useState(false);
  const md = resultMarkdown(result);
  const rate = async (r: 1 | -1) => {
    if (!result.run_id) return;
    const next = rated === r ? null : r;
    setRated(next);
    if (next === -1) setAsking(true);
    try {
      await skillsApi.feedback(api, result.run_id, next, null);
    } catch (e) {
      n.error(e);
    }
  };
  const sendComment = async () => {
    if (!result.run_id) return;
    try {
      await skillsApi.feedback(api, result.run_id, rated, comment.trim() || null);
      setAsking(false);
      n.ok("بازخورد شما ثبت شد");
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <section className="sk-out" aria-label={result.name}>
      <header className="sk-out-h">
        <Sparkles {...ICON14} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{result.name}</span>
      </header>
      {result.suggestions.length ? (
        <div className="sk-out-b">
          <table className="sk-diff">
            <thead>
              <tr>
                <th scope="col">فیلد</th>
                <th scope="col">کنونی</th>
                <th scope="col">پیشنهاد</th>
                <th scope="col">اطمینان</th>
              </tr>
            </thead>
            <tbody>
              {result.suggestions.map((s) => (
                <tr key={s.field}>
                  <td>{s.label}</td>
                  <td className="is-old">{s.current_display}</td>
                  <td className="is-new">
                    {s.display}
                    {s.reason ? <div className="text-[11.5px] text-ink-3">{s.reason}</div> : null}
                  </td>
                  <td className="ds-num">{typeof s.confidence === "number" ? `${pct(s.confidence, 0)} (${confidenceWord(s.confidence)})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : md.trim() ? (
        <div className="sk-out-b">
          <Narrative text={md} />
        </div>
      ) : (
        <div className="sk-out-b text-ink-3">{result.output === "fields" ? "پیشنهاد تازه‌ای برای فیلدهای این رکورد نبود." : "پاسخی ساخته نشد."}</div>
      )}
      {result.citations.length ? (
        <div className="sk-cites" aria-label="منابع">
          {result.citations.map((c) => (
            <Link key={`${c.n}-${c.id}`} to={`/${orgId}/${c.path}`}>
              [{fa(c.n)}] {c.number ? `${c.number} ` : ""}
              {c.title}
            </Link>
          ))}
        </div>
      ) : null}
      {result.proposal && onProposal ? (
        <div className="p-2">
          <ProposalCard proposal={result.proposal} onChange={onProposal} onNavigate={(path) => nav(`/${orgId}/${path}`)} />
        </div>
      ) : null}
      <div className="sk-out-f">
        {onInsert && md.trim() && !result.suggestions.length ? (
          <Button size="small" onClick={() => onInsert(result.journal?.body ?? md)}>
            درج در متن
          </Button>
        ) : null}
        {md.trim() ? (
          <Tooltip title="رونوشت">
            <Button size="small" type="text" aria-label="رونوشت" icon={<Copy {...ICON14} />} onClick={() => void navigator.clipboard?.writeText(md).then(() => n.ok("رونوشت برداشته شد"))} />
          </Tooltip>
        ) : null}
        <span className="flex-1" />
        {result.run_id ? (
          <>
            <Tooltip title="خوب بود">
              <Button size="small" type={rated === 1 ? "primary" : "text"} aria-pressed={rated === 1} aria-label="خوب بود" icon={<ThumbsUp {...ICON14} />} onClick={() => void rate(1)} />
            </Tooltip>
            <Tooltip title="خوب نبود">
              <Button size="small" type={rated === -1 ? "primary" : "text"} aria-pressed={rated === -1} aria-label="خوب نبود" icon={<ThumbsDown {...ICON14} />} onClick={() => void rate(-1)} />
            </Tooltip>
          </>
        ) : null}
      </div>
      {asking ? (
        <div className="flex gap-2 px-2 pb-2">
          <Input size="small" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="چه چیزی درست نبود؟ (اختیاری)" maxLength={1000} onPressEnter={() => void sendComment()} />
          <Button size="small" onClick={() => void sendComment()}>
            ثبت
          </Button>
        </div>
      ) : null}
      <div className="sk-label">{outputCaption(result)}</div>
    </section>
  );
}

export default function RecordAiPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, can } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const nav = useNavigate();
  const table = ctx.table;
  const id = String(ctx.row.id);
  const q = useRecordSkills(table, id);
  const [open, setOpen] = useState<string | null>(null);
  const [params, setParams] = useState<Params>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [stream, setStream] = useState("");
  const [result, setResult] = useState<SkillRunResult | null>(null);
  const [history, setHistory] = useState(false);
  const runs = useOwnRuns(table, id, history);
  if (q.isLoading) return <Loader />;
  if (!q.data) return <p className="text-[13px] text-ink-3">{q.error ? "مهارت‌های هوش مصنوعی در دسترس نیست." : ""}</p>;
  const cards = panelSkills(q.data.skills);
  const proposals = q.data.proposals.filter((p) => p.id !== result?.proposal?.id);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: SKILL_KEYS.record(orgId, table, id) });
    void qc.invalidateQueries({ queryKey: SKILL_KEYS.runs(orgId, table, id) });
  };
  const choose = (c: SkillCard) => {
    if (open === c.key) return setOpen(null);
    setOpen(c.key);
    setParams(defaultParams(c.params));
  };
  const run = async (c: SkillCard) => {
    const missing = missingParams(c.params, params);
    if (missing.length) return n.error(new Error(`«${missing[0]}» را وارد کنید`));
    setBusy(c.key);
    setStream("");
    setResult(null);
    try {
      const req = { table, id, params };
      const r = c.output === "text" || c.output === "journal" ? await runStream(api, c.key, req, (d) => setStream((s) => s + d)) : await skillsApi.run(api, c.key, req);
      setResult(r);
      setOpen(null);
      refresh();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
      setStream("");
    }
  };
  const onProposal = (p: AiProposal) => {
    setResult((r) => (r ? { ...r, proposal: p } : r));
    if (p.status === "executed") ctx.refresh();
    refresh();
  };
  if (!cards.length && !proposals.length) return <p className="text-[13px] text-ink-3">برای این نوع رکورد مهارتی فعال نیست.</p>;
  return (
    <div className="flex flex-col gap-1">
      <div className="sk-list" role="list">
        {cards.map((c) => (
          <div key={c.key} role="listitem">
            <div className={`sk-row${c.available ? "" : " is-off"}`}>
              <span className="sk-row-t" title={c.description}>
                {c.name}
              </span>
              {c.fallback ? <span className="sk-row-tag">بی‌مدل</span> : null}
              {c.available ? (
                <Tooltip title={c.params.length && open !== c.key ? "تنظیم و اجرا" : "اجرا"}>
                  <Button
                    size="small"
                    type="text"
                    aria-label={`اجرای ${c.name}`}
                    loading={busy === c.key}
                    disabled={!!busy && busy !== c.key}
                    icon={<Play {...ICON14} />}
                    onClick={() => (c.params.length && open !== c.key ? choose(c) : void run(c))}
                  />
                </Tooltip>
              ) : (
                <Tooltip title={c.reason}>
                  {c.needs_settings && can("ai", "full") ? (
                    <Button size="small" type="text" aria-label="تنظیمات هوش مصنوعی" icon={<Settings2 {...ICON14} />} onClick={() => nav(`/${orgId}/${AI_SETTINGS_PATH}`)} />
                  ) : (
                    <span className="sk-row-tag">غیرفعال</span>
                  )}
                </Tooltip>
              )}
            </div>
            {open === c.key ? (
              <>
                <ParamsForm card={c} values={params} onChange={setParams} />
                <div className="flex justify-end pb-1">
                  <Button size="small" type="primary" loading={busy === c.key} onClick={() => void run(c)}>
                    اجرا
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
      {busy && stream ? (
        <div className="sk-out">
          <div className="sk-out-b sk-stream" aria-live="polite">
            {stream}
          </div>
        </div>
      ) : null}
      {result ? <SkillResult result={result} onProposal={onProposal} /> : null}
      <RecordAgents table={table} id={id} />
      {proposals.length ? (
        <>
          <div className="sk-sec">پیشنهادهای باز این رکورد</div>
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              onChange={(next) => {
                if (next.status === "executed") ctx.refresh();
                refresh();
              }}
              onNavigate={(path) => nav(`/${orgId}/${path}`)}
            />
          ))}
        </>
      ) : null}
      <Button size="small" type="link" className="self-start px-0" icon={<History {...ICON14} />} onClick={() => setHistory((h) => !h)} aria-expanded={history}>
        اجراهای من
      </Button>
      {history ? (
        runs.isLoading ? (
          <Loader />
        ) : (runs.data?.runs ?? []).length ? (
          <div className="sk-runs">
            {(runs.data?.runs ?? []).map((r) => (
              <div key={r.id} className="sk-run">
                <div className="sk-run-h">
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="text-[11px]">{r.status === "fallback" ? "بی‌مدل" : r.status === "error" ? "ناموفق" : (r.model ?? "")}</span>
                  {r.feedback === 1 ? <ThumbsUp {...ICON14} aria-label="خوب بود" /> : r.feedback === -1 ? <ThumbsDown {...ICON14} aria-label="خوب نبود" /> : null}
                </div>
                <div className="sk-run-b">{r.error ?? r.text ?? "—"}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-3">هنوز مهارتی روی این رکورد اجرا نکرده‌اید.</p>
        )
      ) : null}
    </div>
  );
}
