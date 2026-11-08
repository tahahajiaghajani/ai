// Settings → «هوش مصنوعی» → «مهارت‌ها» (ai:full; catalogue AI-006/007/155/167/168/169/170/174): every skill grouped by
// module — on or off, roles, field groups it may read, triggers and their condition, limits, auto-apply — the prompt
// editor with versions (a draft is saved, tested, published; any earlier version or the built-in default can be put
// back; versions are compared line by line), a test run against a record with the administrator's OWN access,
// evaluation sets with their scores, usage per skill, copies of a built-in, and the «دستیار هوش مصنوعی» service member
// whose roles triggered skills run with.
import "./skills.css";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Drawer, Input, InputNumber, Segmented, Select, Switch, Tabs, Tag, Tooltip } from "antd";
import { Copy, FlaskConical, Pencil, RotateCcw, Upload } from "lucide-react";
import {
  PLACEHOLDER_LABELS, SKILL_EVENTS, SKILL_GROUNDINGS, SKILL_OUTPUTS, SKILL_TIERS, SKILL_TRIGGERS, type SkillAdminItem, type SkillAdminView, type SkillEvalCase, type SkillRunResult, type SkillVersionView,
} from "@shared/ai/skills";
import { SKILL_GROUP_OPTIONS } from "@shared/tables/ai";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa, pct } from "../../lib/fa";
import { EmptyState, JDateTime, Skeleton } from "../../components/display";
import { ICON14, Note } from "../../components/blocks";
import { SKILL_KEYS, skillsApi } from "./api";
import { groupAdmin, promptDiff } from "./model";
import { SkillResult } from "./RecordAiPanel";

const opts = (m: Record<string, string | { label: string }>) => Object.entries(m).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  if (!text.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: "JSON معتبر نیست" };
  }
}

function useAdmin() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SKILL_KEYS.admin(orgId), queryFn: () => skillsApi.admin(api) });
}

function Settings({ s, view, onSaved }: { s: SkillAdminItem; view: SkillAdminView; onSaved: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [v, setV] = useState(s);
  const [cond, setCond] = useState(s.condition ? JSON.stringify(s.condition, null, 2) : "");
  const [filter, setFilter] = useState(s.schedule_filter ? JSON.stringify(s.schedule_filter, null, 2) : "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(s), [s]);
  const save = async () => {
    const c = parseJson(cond);
    const f = parseJson(filter);
    if (!c.ok || !f.ok) return n.error(new Error("شرط یا پالایهٔ زمان‌بندی JSON معتبر نیست"));
    setSaving(true);
    try {
      await skillsApi.patch(api, s.key, {
        name: v.name, description: v.description, tables: v.tables, tier: v.tier, grounding: v.grounding, grounding_k: v.grounding_k, triggers: v.triggers, events: v.events,
        condition: (c.value as Record<string, unknown>) ?? null, schedule_minutes: v.schedule_minutes, schedule_filter: (f.value as Record<string, unknown>) ?? null,
        roles: v.roles, field_groups: v.field_groups, auto_apply: v.auto_apply, daily_limit: v.daily_limit, user_daily_limit: v.user_daily_limit,
      });
      n.ok("تنظیمات مهارت ذخیره شد");
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const autoOptions = [...s.output_fields.map((f) => ({ value: f, label: f })), ...(s.output === "journal" ? [{ value: "work_note", label: "یادداشت داخلی" }] : [])];
  return (
    <div className="grid gap-4">
      <label className="grid gap-1">
        <span className="blk-f-l">نام</span>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={120} />
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">شرح</span>
        <Input.TextArea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} />
      </label>
      <div className="grid gap-1">
        <span className="blk-f-l">ردهٔ مدل</span>
        <Segmented value={v.tier} onChange={(x) => setV({ ...v, tier: x as typeof v.tier })} options={opts(SKILL_TIERS)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="blk-f-l">منبع پاسخ</span>
          <Select value={v.grounding} onChange={(x) => setV({ ...v, grounding: x })} options={opts(SKILL_GROUNDINGS)} />
        </label>
        <label className="grid gap-1">
          <span className="blk-f-l">تعداد منابع</span>
          <InputNumber min={1} max={12} value={v.grounding_k} onChange={(x) => setV({ ...v, grounding_k: Number(x ?? 5) })} />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="blk-f-l">جدول‌ها</span>
        <Select mode="tags" value={v.tables} onChange={(x) => setV({ ...v, tables: x })} tokenSeparators={[",", "،"]} />
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">نقش‌های مجاز (خالی: همه)</span>
        <Select mode="multiple" value={v.roles} onChange={(x) => setV({ ...v, roles: x })} options={view.roles.map((r) => ({ value: r.key, label: r.name }))} optionFilterProp="label" />
      </label>
      <div className="grid gap-1">
        <span className="blk-f-l">گروه‌های فیلد که مهارت می‌خواند</span>
        <Checkbox.Group value={v.field_groups} onChange={(x) => setV({ ...v, field_groups: x as string[] })} options={SKILL_GROUP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <span className="blk-f-h">فقط وقتی به مدل می‌رسند که کاربر هم آن‌ها را ببیند؛ «خصوصی هوش مصنوعی» هرگز.</span>
      </div>
      <div className="grid gap-1">
        <span className="blk-f-l">اجرا</span>
        <Checkbox.Group value={v.triggers} onChange={(x) => setV({ ...v, triggers: x as typeof v.triggers })} options={opts(SKILL_TRIGGERS)} />
      </div>
      {v.triggers.includes("event") ? (
        <div className="grid gap-1">
          <span className="blk-f-l">رویدادها</span>
          <Checkbox.Group value={v.events} onChange={(x) => setV({ ...v, events: x as typeof v.events })} options={opts(SKILL_EVENTS)} />
        </div>
      ) : null}
      {v.triggers.includes("schedule") ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="blk-f-l">هر چند دقیقه</span>
            <InputNumber min={15} max={10080} value={v.schedule_minutes} onChange={(x) => setV({ ...v, schedule_minutes: x === null ? null : Number(x) })} />
          </label>
          <label className="grid gap-1">
            <span className="blk-f-l">پالایهٔ رکوردها (JSON شرط)</span>
            <Input.TextArea className="sk-code" value={filter} onChange={(e) => setFilter(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} />
          </label>
        </div>
      ) : null}
      {v.triggers.includes("event") || v.triggers.includes("schedule") ? (
        <>
          <label className="grid gap-1">
            <span className="blk-f-l">شرط اجرای خودکار (JSON شرط، خالی: همه)</span>
            <Input.TextArea className="sk-code" value={cond} onChange={(e) => setCond(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} placeholder='{"f": "priority", "op": "in", "v": ["1", "2"]}' />
          </label>
          <label className="grid gap-1">
            <span className="blk-f-l">اعمال خودکار (بی‌تأیید)</span>
            <Select mode="multiple" value={v.auto_apply} onChange={(x) => setV({ ...v, auto_apply: x })} options={autoOptions} disabled={!autoOptions.length} />
            <span className="blk-f-h">اجرای خودکار با حساب «دستیار هوش مصنوعی» و نقش‌های آن انجام می‌شود؛ بقیهٔ خروجی پیشنهاد می‌ماند. پاسخ به درخواست‌کننده هرگز خودکار فرستاده نمی‌شود.</span>
          </label>
        </>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="blk-f-l">سقف اجرای روزانهٔ سازمان</span>
          <InputNumber min={1} value={v.daily_limit} onChange={(x) => setV({ ...v, daily_limit: x === null ? null : Number(x) })} />
        </label>
        <label className="grid gap-1">
          <span className="blk-f-l">سقف روزانهٔ هر عضو</span>
          <InputNumber min={1} value={v.user_daily_limit} onChange={(x) => setV({ ...v, user_daily_limit: x === null ? null : Number(x) })} />
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="primary" loading={saving} onClick={() => void save()}>
          ذخیره
        </Button>
      </div>
    </div>
  );
}

function DiffView({ a, b }: { a: SkillVersionView; b: SkillVersionView }) {
  const d = useMemo(() => promptDiff(a, b), [a, b]);
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-ink-3">
        {fa(d.added)} سطر افزوده، {fa(d.removed)} سطر برداشته
      </span>
      <div className="sk-dl" role="region" aria-label="تفاوت نسخه‌ها" tabIndex={0}>
        {d.lines.map((l, i) => (
          <div key={i} className={l.op === "add" ? "is-add" : l.op === "del" ? "is-del" : undefined}>
            {l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

const VSTATE: Record<SkillVersionView["state"], [string, string]> = { draft: ["پیش‌نویس", "default"], published: ["منتشرشده", "green"], retired: ["کنارگذاشته", "orange"], default: ["پیش‌فرض داخلی", "blue"] };

function Prompts({ s, onSaved }: { s: SkillAdminItem; onSaved: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const active = s.versions.find((v) => v.id === s.active_version_id) ?? s.versions.find((v) => v.state === "default")!;
  const [system, setSystem] = useState(active.system);
  const [template, setTemplate] = useState(active.template);
  const [schema, setSchema] = useState(active.output_schema ? JSON.stringify(active.output_schema, null, 2) : "");
  const [temperature, setTemperature] = useState<number | null>(active.temperature);
  const [maxTokens, setMaxTokens] = useState<number | null>(active.max_tokens);
  const [note, setNote] = useState("");
  const [compare, setCompare] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const structured = s.output !== "text" && s.output !== "journal";
  const save = async () => {
    const sc = parseJson(schema);
    if (!sc.ok) return n.error(new Error("طرح خروجی JSON معتبر نیست"));
    setBusy(true);
    try {
      await skillsApi.saveVersion(api, s.key, { system, template, output_schema: structured ? sc.value : null, temperature, max_tokens: maxTokens, note });
      n.ok("نسخهٔ تازه به‌صورت پیش‌نویس ذخیره شد؛ در «آزمون» امتحانش کنید و منتشرش کنید");
      setNote("");
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const publish = async (id: string | null) => {
    try {
      await skillsApi.publish(api, s.key, id);
      n.ok(id ? "نسخه منتشر شد" : "مهارت به درخواست پیش‌فرض داخلی برگشت");
      onSaved();
    } catch (e) {
      n.error(e);
    }
  };
  const other = compare ? s.versions.find((v) => (v.id ?? "default") === compare) : null;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <span className="blk-f-l">نسخه‌ها</span>
        {s.versions.map((v) => (
          <div key={v.id ?? "default"} className="sk-item">
            <div>
              <div className="sk-item-t">
                {v.state === "default" ? "پیش‌فرض داخلی" : `نسخهٔ ${fa(v.version)}`} <Tag color={VSTATE[v.state][1]}>{VSTATE[v.state][0]}</Tag>
                {v.id === s.active_version_id || (!s.active_version_id && v.state === "default") ? <Tag color="green">در حال استفاده</Tag> : null}
              </div>
              <div className="sk-item-d">
                {v.note ?? ""} {v.created_at ? <JDateTime v={v.created_at} /> : null}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="small" onClick={() => setCompare(compare === (v.id ?? "default") ? null : (v.id ?? "default"))}>
                تفاوت با نسخهٔ در حال استفاده
              </Button>
              {v.id !== s.active_version_id && v.state !== "default" ? (
                <Button size="small" icon={<Upload {...ICON14} />} onClick={() => void publish(v.id)}>
                  انتشار
                </Button>
              ) : null}
              {v.state === "default" && s.active_version_id ? (
                <Button size="small" icon={<RotateCcw {...ICON14} />} onClick={() => void publish(null)}>
                  بازگشت به پیش‌فرض
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {other ? <DiffView a={other} b={active} /> : null}
      <label className="grid gap-1">
        <span className="blk-f-l">دستور سامانه</span>
        <Input.TextArea value={system} onChange={(e) => setSystem(e.target.value)} autoSize={{ minRows: 4, maxRows: 14 }} maxLength={20000} />
        <span className="blk-f-h">قواعد پایه (داده دستور نیست، چیزی نساز، زبان پاسخ، ارجاع به منبع) همیشه پیش از این متن می‌آیند.</span>
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">الگوی پیام</span>
        <Input.TextArea value={template} onChange={(e) => setTemplate(e.target.value)} autoSize={{ minRows: 4, maxRows: 14 }} maxLength={20000} />
        <span className="blk-f-h">
          جای‌نگهدارها:{" "}
          {Object.entries(PLACEHOLDER_LABELS).map(([k, l]) => (
            <Tooltip key={k} title={l}>
              <bdi dir="ltr" className="ds-mono me-2">{`{{${k}}}`}</bdi>
            </Tooltip>
          ))}
          ؛ <bdi dir="ltr" className="ds-mono">{"{{record.<field>}}"}</bdi> برای یک فیلد. هر جای‌نگهدار به‌صورت بلوک داده فرستاده می‌شود.
        </span>
      </label>
      {structured ? (
        <label className="grid gap-1">
          <span className="blk-f-l">طرح خروجی (JSON Schema؛ خالی: طرح داخلی)</span>
          <Input.TextArea className="sk-code" value={schema} onChange={(e) => setSchema(e.target.value)} autoSize={{ minRows: 3, maxRows: 12 }} />
        </label>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="blk-f-l">دما (فقط سرویس‌های سازگار با OpenAI)</span>
          <InputNumber min={0} max={2} step={0.1} value={temperature} onChange={(x) => setTemperature(x === null ? null : Number(x))} />
        </label>
        <label className="grid gap-1">
          <span className="blk-f-l">سقف واژه‌های خروجی</span>
          <InputNumber min={64} max={32000} value={maxTokens} onChange={(x) => setMaxTokens(x === null ? null : Number(x))} />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="blk-f-l">یادداشت تغییر</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="چه چیزی و چرا تغییر کرد" />
      </label>
      <div className="flex justify-end">
        <Button type="primary" loading={busy} disabled={note.trim().length < 2} onClick={() => void save()}>
          ذخیرهٔ نسخهٔ تازه
        </Button>
      </div>
    </div>
  );
}

function TestRun({ s }: { s: SkillAdminItem }) {
  const { api } = useOrg();
  const n = useNotify();
  const [table, setTable] = useState(s.tables.find((t) => t !== "*") ?? "");
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [version, setVersion] = useState<string>("active");
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<SkillRunResult | null>(null);
  const run = async () => {
    setBusy(true);
    setR(null);
    try {
      const versionId = version === "active" ? null : version === "default" ? null : version;
      setR(await skillsApi.test(api, s.key, { table: s.target === "record" || id ? table || null : null, id: id.trim() || null, text: text || null, version_id: versionId }));
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <Note>آزمون با دسترسی خود شما اجرا می‌شود: مدل فقط آنچه شما می‌بینید را می‌خواند و پیشنهادی ثبت نمی‌شود.</Note>
      <label className="grid gap-1">
        <span className="blk-f-l">نسخه</span>
        <Select
          value={version}
          onChange={setVersion}
          options={[{ value: "active", label: "نسخهٔ در حال استفاده" }, ...s.versions.filter((v) => v.id).map((v) => ({ value: v.id!, label: `نسخهٔ ${fa(v.version)} (${VSTATE[v.state][0]})` }))]}
        />
      </label>
      {s.target !== "none" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="blk-f-l">جدول</span>
            <Input className="sk-code" value={table} onChange={(e) => setTable(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="blk-f-l">شناسهٔ رکورد</span>
            <Input className="sk-code" value={id} onChange={(e) => setId(e.target.value)} placeholder="شناسهٔ رکوردی که می‌بینید" />
          </label>
        </div>
      ) : null}
      {s.target === "text" ? (
        <label className="grid gap-1">
          <span className="blk-f-l">متن</span>
          <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} />
        </label>
      ) : null}
      <div className="flex justify-end">
        <Button type="primary" icon={<FlaskConical {...ICON14} />} loading={busy} onClick={() => void run()}>
          اجرای آزمون
        </Button>
      </div>
      {r ? <SkillResult result={r} /> : null}
    </div>
  );
}

function Evals({ s, onSaved }: { s: SkillAdminItem; onSaved: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const sample: SkillEvalCase[] = [{ name: "نمونهٔ نخست", ...(s.target === "text" ? { text: "متن نمونه" } : { table: s.tables.find((t) => t !== "*") ?? "", id: "" }), expect: { min_chars: 20, language: "fa" } }];
  const [name, setName] = useState("");
  const [cases, setCases] = useState(JSON.stringify(sample, null, 2));
  const [busy, setBusy] = useState<string | null>(null);
  const save = async () => {
    const c = parseJson(cases);
    if (!c.ok || !Array.isArray(c.value)) return n.error(new Error("نمونه‌ها باید فهرستی JSON باشد"));
    setBusy("save");
    try {
      await skillsApi.saveEval(api, s.key, { name, cases: c.value as SkillEvalCase[] });
      n.ok("مجموعهٔ ارزیابی ذخیره شد");
      setName("");
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const run = async (id: string) => {
    setBusy(id);
    try {
      await skillsApi.runEvals(api, s.key, id);
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-4">
      {s.evals.length ? (
        <div>
          {s.evals.map((e) => (
            <div key={e.id} className="sk-item">
              <div>
                <div className="sk-item-t">{e.name}</div>
                <div className="sk-item-m">
                  <span>{fa(e.cases.length)} نمونه</span>
                  {e.last_score !== null ? <span className="ds-num">نمره {pct(e.last_score, 0)}</span> : <span>هنوز اجرا نشده</span>}
                  {e.last_run_at ? <JDateTime v={e.last_run_at} /> : null}
                  {e.last_model ? <bdi dir="ltr">{e.last_model}</bdi> : null}
                </div>
                {e.last_results.map((x) => (
                  <div key={x.case} className="sk-item-d">
                    {x.case}: {x.error ? x.error : `${pct(x.score, 0)} — ${x.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("، ")}`}
                  </div>
                ))}
              </div>
              <Button size="small" loading={busy === e.id} onClick={() => void run(e.id)}>
                اجرا با مدل سازمان
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">هنوز مجموعهٔ ارزیابی‌ای برای این مهارت نیست.</p>
      )}
      <label className="grid gap-1">
        <span className="blk-f-l">مجموعهٔ تازه</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="نام مجموعه" />
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">نمونه‌ها (JSON): ورودی و ویژگی‌های مورد انتظار — contains، not_contains، min_chars، max_chars، json_keys، language، cites</span>
        <Input.TextArea className="sk-code" value={cases} onChange={(e) => setCases(e.target.value)} autoSize={{ minRows: 5, maxRows: 16 }} />
      </label>
      <div className="flex justify-end">
        <Button type="primary" loading={busy === "save"} disabled={name.trim().length < 2} onClick={() => void save()}>
          ذخیرهٔ مجموعه
        </Button>
      </div>
    </div>
  );
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Usage of one skill over the last 30 days (this runtime's runs; model calls are also in «مصرف و بودجه»). */
function SkillUsage({ s }: { s: SkillAdminItem }) {
  const { api, orgId } = useOrg();
  const to = isoDay(new Date());
  const from = isoDay(new Date(Date.now() - 30 * 86_400_000));
  const q = useQuery({ queryKey: SKILL_KEYS.usage(orgId, from, to), queryFn: () => skillsApi.usage(api, from, to) });
  if (q.isLoading) return <Skeleton rows={3} />;
  const u = (q.data?.rows ?? []).find((r) => r.skill === s.key);
  if (!u) return <p className="text-[13px] text-ink-3">در ۳۰ روز گذشته اجرا نشده است.</p>;
  const rows: [string, string][] = [
    ["اجرا", fa(u.runs)],
    ["ناموفق", fa(u.errors)],
    ["با قاعده (بی‌مدل)", fa(u.fallbacks)],
    ["خوب بود / خوب نبود", `${fa(u.up)} / ${fa(u.down)}`],
    ["واژه‌های ورودی و خروجی", `${fa(u.tokens_in)} / ${fa(u.tokens_out)}`],
    ["هزینهٔ برآوردی (دلار)", fa(Number(u.cost_usd), 4)],
    ["میانگین زمان (ثانیه)", fa(u.avg_ms / 1000, 1)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="ds-num m-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyForm({ s, onSaved }: { s: SkillAdminItem; onSaved: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [key, setKey] = useState(`org.${s.key.split(".").pop()}`);
  const [name, setName] = useState(`${s.name} (سازمان)`);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3">
      <Note>رونوشت با تنظیمات و درخواست کنونی این مهارت ساخته می‌شود و تا روشنش نکنید خاموش می‌ماند.</Note>
      <label className="grid gap-1">
        <span className="blk-f-l">کلید</span>
        <Input className="sk-code" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">نام</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex justify-end">
        <Button
          type="primary"
          icon={<Copy {...ICON14} />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await skillsApi.copy(api, s.key, { key, name });
              n.ok("رونوشت مهارت ساخته شد");
              onSaved();
            } catch (e) {
              n.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          ساخت رونوشت
        </Button>
      </div>
    </div>
  );
}

function Principal({ view, onSaved }: { view: SkillAdminView; onSaved: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [roles, setRoles] = useState(view.principal.roles);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRoles(view.principal.roles), [view.principal.roles]);
  const save = async (active: boolean) => {
    setBusy(true);
    try {
      await skillsApi.principal(api, roles, active);
      n.ok(active ? "نقش‌های دستیار هوش مصنوعی ذخیره شد" : "دستیار هوش مصنوعی خاموش شد");
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="blk-card">
      <div className="blk-card-b grid gap-2">
        <div className="sk-item-t">دستیار هوش مصنوعی (اجرای خودکار)</div>
        <div className="sk-item-d">
          مهارت‌هایی که با رویداد یا زمان‌بندی اجرا می‌شوند با این حساب و فقط با دسترسی نقش‌های آن اجرا می‌شوند، نه با دسترسی سامانه. {view.principal.user_id ? (view.principal.active ? "فعال است." : "خاموش است.") : "هنوز ساخته نشده است."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="min-w-[260px] flex-1" mode="multiple" value={roles} onChange={setRoles} options={view.roles.map((r) => ({ value: r.key, label: r.name }))} optionFilterProp="label" placeholder="نقش‌ها" aria-label="نقش‌های دستیار هوش مصنوعی" />
          <Button type="primary" loading={busy} disabled={!roles.length} onClick={() => void save(true)}>
            {view.principal.user_id ? "ذخیرهٔ نقش‌ها" : "ساخت حساب"}
          </Button>
          {view.principal.active ? (
            <Button loading={busy} onClick={() => void save(false)}>
              خاموش کردن
            </Button>
          ) : null}
        </div>
        <span className="blk-f-h">نقش‌ها را مالک سازمان تعیین می‌کند؛ هیچ‌کس نقشی بیش از دسترسی خودش نمی‌دهد.</span>
      </div>
    </div>
  );
}

export function SkillsTab() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const q = useAdmin();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["ai-skills", orgId] });
  if (q.isLoading)
    return (
      <div className="blk-card">
        <div className="blk-card-b">
          <Skeleton rows={8} />
        </div>
      </div>
    );
  if (!q.data) return <div className="blk-card"><EmptyState title="مهارت‌ها بارگذاری نشد." description={(q.error as Error | null)?.message ?? ""} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} /></div>;
  const view = q.data;
  const groups = groupAdmin(view.skills, search);
  const current = view.skills.find((s) => s.key === open) ?? null;
  const toggle = async (s: SkillAdminItem, enabled: boolean) => {
    try {
      await skillsApi.patch(api, s.key, { enabled });
      refresh();
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <div className="sk-admin">
      {!view.model.ok ? <Note tone="warning">{view.model.message_fa ?? "مدل هوش مصنوعی در دسترس نیست."} مهارت‌های دارای «پاسخ قاعده‌محور» بی‌مدل هم کار می‌کنند؛ بقیه تا اتصال مدل خاموش می‌مانند.</Note> : null}
      <Principal view={view} onSaved={refresh} />
      <Input.Search allowClear value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجو در مهارت‌ها" aria-label="جست‌وجو در مهارت‌ها" />
      {groups.map((g) => (
        <section key={g.module}>
          <div className="sk-grp-t">{g.label}</div>
          <div className="blk-card">
            {g.items.map((s) => (
              <div key={s.key} className="sk-item">
                <div>
                  <div className="sk-item-t">
                    {s.name} {!s.builtin ? <Tag>رونوشت سازمان</Tag> : null}
                  </div>
                  <div className="sk-item-d">{s.description}</div>
                  <div className="sk-item-m">
                    <bdi dir="ltr" className="ds-mono">{s.key}</bdi>
                    <span>{SKILL_OUTPUTS[s.output]}</span>
                    <span>{SKILL_TIERS[s.tier].label}</span>
                    {s.grounding !== "none" ? <span>{SKILL_GROUNDINGS[s.grounding]}</span> : null}
                    {s.triggers.filter((t) => t !== "manual").map((t) => (
                      <span key={t}>{SKILL_TRIGGERS[t]}</span>
                    ))}
                    {s.has_fallback ? <span>پاسخ قاعده‌محور بی‌مدل</span> : null}
                    {s.active_version_id ? <span>درخواست سازمان</span> : null}
                    {s.usage ? (
                      <span className="ds-num">
                        {fa(s.usage.runs)} اجرا در ۳۰ روز · 👍 {fa(s.usage.up)} · 👎 {fa(s.usage.down)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={s.enabled} onChange={(v) => void toggle(s, v)} aria-label={`${s.name} فعال است`} />
                  <Button size="small" icon={<Pencil {...ICON14} />} onClick={() => setOpen(s.key)}>
                    ویرایش
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <Drawer open={!!current} onClose={() => setOpen(null)} size="large" destroyOnHidden title={current?.name}>
        {current ? (
          <Tabs
            items={[
              { key: "settings", label: "تنظیمات", children: <Settings s={current} view={view} onSaved={refresh} /> },
              { key: "prompts", label: "درخواست و نسخه‌ها", children: <Prompts s={current} onSaved={refresh} /> },
              { key: "test", label: "آزمون", children: <TestRun s={current} /> },
              { key: "evals", label: "ارزیابی", children: <Evals s={current} onSaved={refresh} /> },
              { key: "usage", label: "مصرف", children: <SkillUsage s={current} /> },
              { key: "copy", label: "رونوشت", children: <CopyForm s={current} onSaved={refresh} /> },
            ]}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
