// Settings → «هوش مصنوعی» → «عامل‌ها» (ai:full; docs/spec/AI.md §11.8): the organisation's switch for every agent, the
// agents by module (on/off, autonomy, principal, today's runs, open proposals) and, per agent: its goal and triggers,
// autonomy with the whitelist and the approvers, budgets and guardrails; the tool picker (what its principal may use is
// marked); its principal (an owner chooses the roles); the test console — a dry run on a chosen record with the record
// as the administrator and as the principal read it, side by side — and its runs, step by step.
import "./agents.css";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Drawer, Input, InputNumber, Popconfirm, Segmented, Select, Switch, Tabs, Tag } from "antd";
import { FlaskConical, Pencil, Plus, Square } from "lucide-react";
import type { AgentAdminItem, AgentAdminView, AgentRunView, AgentTestResult } from "@shared/ai/agents";
import { AGENT_AUTONOMY, AGENT_RUN_STATUS, AGENT_RUN_TRIGGERS, AGENT_TRIGGERS, AUTO_ACTION_HINT, agentConfigProblems } from "@shared/ai/agents";
import { SKILL_EVENTS, SKILL_TIERS } from "@shared/ai/skills";
import { SKILL_GROUP_OPTIONS } from "@shared/tables/ai";
import { physicalTables } from "@shared/tables";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { EmptyState, JDateTime, Skeleton } from "../../components/display";
import { ICON14, Note } from "../../components/blocks";
import { AGENT_KEYS, agentsApi } from "./api";
import { groupAgents, principalText, stepLine, togglePattern as toggleTool, toolGroups } from "./model";

const opts = (m: Record<string, string | { label: string }>) => Object.entries(m).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));
const TAG_COLOR: Record<string, string> = { gray: "default", blue: "processing", green: "success", red: "error", orange: "warning", gold: "gold" };

const TABLE_OPTIONS = physicalTables()
  .filter((t) => !t.virtual)
  .map((t) => ({ value: t.key, label: `${t.plural} (${t.key})` }));

function json(text: string): { ok: true; value: Record<string, unknown> | null } | { ok: false } {
  if (!text.trim()) return { ok: true, value: null };
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v as Record<string, unknown> } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function useAdmin() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: AGENT_KEYS.admin(orgId), queryFn: () => agentsApi.admin(api) });
}

function usePeople() {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: ["ai-agents", orgId, "people"],
    queryFn: async () => {
      const [m, g] = await Promise.all([
        api.get<{ members: { user_id: string; full_name: string | null; email: string; is_active: boolean }[] }>("/members").catch(() => ({ members: [] })),
        api.get<{ rows: { id: string; name: string }[] }>("/r/group", { size: 300 }).catch(() => ({ rows: [] })),
      ]);
      return {
        users: m.members.filter((x) => x.is_active).map((x) => ({ value: x.user_id, label: x.full_name || x.email })),
        groups: g.rows.map((x) => ({ value: x.id, label: x.name })),
      };
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------- settings

function Settings({ a, onSaved }: { a: AgentAdminItem; onSaved: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const people = usePeople();
  const [v, setV] = useState(a);
  const [cond, setCond] = useState(a.condition ? JSON.stringify(a.condition, null, 2) : "");
  const [filter, setFilter] = useState(a.schedule_filter ? JSON.stringify(a.schedule_filter, null, 2) : "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(a), [a]);
  const problems = agentConfigProblems(v);
  const save = async () => {
    const c = json(cond);
    const f = json(filter);
    if (!c.ok || !f.ok) return n.error(new Error("شرط یا پالایهٔ زمان‌بندی JSON معتبر نیست"));
    setSaving(true);
    try {
      await agentsApi.patch(api, a.key, {
        name: v.name, description: v.description, goal: v.goal, tables: v.tables, triggers: v.triggers, events: v.events, condition: c.value, schedule_minutes: v.schedule_minutes,
        schedule_filter: f.value, autonomy: v.autonomy, auto_actions: v.autonomy === "auto" ? v.auto_actions : [], approvers: v.approvers, approver_group_id: v.approver_group_id, tier: v.tier,
        max_steps: v.max_steps, max_tokens: v.max_tokens, max_actions: v.max_actions, daily_runs: v.daily_runs, forbidden_tables: v.forbidden_tables, forbidden_fields: v.forbidden_fields,
        forbidden_states: v.forbidden_states, roles: v.roles, field_groups: v.field_groups,
      });
      n.ok("تنظیمات عامل ذخیره شد");
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const num = (k: "max_steps" | "max_tokens" | "max_actions" | "daily_runs", label: string, min: number, max: number) => (
    <label className="grid gap-1">
      <span className="blk-f-l">{label}</span>
      <InputNumber className="w-full" min={min} max={max} value={v[k]} onChange={(x) => setV({ ...v, [k]: Number(x ?? min) })} />
    </label>
  );
  return (
    <div className="grid gap-4">
      <label className="grid gap-1">
        <span className="blk-f-l">نام</span>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={120} />
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">شرح</span>
        <Input.TextArea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} autoSize={{ minRows: 2, maxRows: 4 }} maxLength={2000} />
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">هدف و دستورالعمل</span>
        <Input.TextArea value={v.goal} onChange={(e) => setV({ ...v, goal: e.target.value })} autoSize={{ minRows: 5, maxRows: 16 }} maxLength={20_000} />
      </label>
      <div className="grid gap-1">
        <span className="blk-f-l">جدول‌ها</span>
        <Select mode="multiple" value={v.tables} onChange={(x) => setV({ ...v, tables: x })} options={TABLE_OPTIONS} optionFilterProp="label" aria-label="جدول‌ها" />
      </div>
      <div className="grid gap-1">
        <span className="blk-f-l">آغاز با</span>
        <Checkbox.Group value={v.triggers} onChange={(x) => setV({ ...v, triggers: x as AgentAdminItem["triggers"] })} options={opts(AGENT_TRIGGERS)} />
      </div>
      {v.triggers.includes("event") ? (
        <div className="grid gap-1">
          <span className="blk-f-l">رویدادها</span>
          <Select mode="multiple" value={v.events} onChange={(x) => setV({ ...v, events: x })} options={opts(SKILL_EVENTS)} aria-label="رویدادها" />
        </div>
      ) : null}
      {v.triggers.includes("schedule") ? (
        <div className="ag-row2">
          <label className="grid gap-1">
            <span className="blk-f-l">هر چند دقیقه</span>
            <InputNumber className="w-full" min={15} max={10_080} value={v.schedule_minutes ?? undefined} onChange={(x) => setV({ ...v, schedule_minutes: x === null ? null : Number(x) })} />
          </label>
          <label className="grid gap-1">
            <span className="blk-f-l">رکوردهای زمان‌بندی (شرط، JSON)</span>
            <Input.TextArea className="ag-code" value={filter} onChange={(e) => setFilter(e.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} />
          </label>
        </div>
      ) : null}
      {v.triggers.includes("event") || v.triggers.includes("schedule") ? (
        <label className="grid gap-1">
          <span className="blk-f-l">شرط اجرا (JSON)</span>
          <Input.TextArea className="ag-code" value={cond} onChange={(e) => setCond(e.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} />
        </label>
      ) : null}
      <div className="grid gap-1">
        <span className="blk-f-l">اختیار عمل</span>
        <Segmented value={v.autonomy} onChange={(x) => setV({ ...v, autonomy: x as AgentAdminItem["autonomy"] })} options={opts(AGENT_AUTONOMY)} />
        <span className="blk-f-h">{AGENT_AUTONOMY[v.autonomy].about}</span>
      </div>
      {v.autonomy === "auto" ? (
        <div className="grid gap-1">
          <span className="blk-f-l">کارهای کم‌خطر مجاز</span>
          <Select mode="tags" value={v.auto_actions} onChange={(x) => setV({ ...v, auto_actions: x })} tokenSeparators={[","]} aria-label="کارهای کم‌خطر مجاز" />
          <span className="blk-f-h ltr">{AUTO_ACTION_HINT}</span>
        </div>
      ) : null}
      {v.autonomy === "approve" ? (
        <div className="ag-row2">
          <div className="grid gap-1">
            <span className="blk-f-l">تأییدکنندگان</span>
            <Select mode="multiple" value={v.approvers} onChange={(x) => setV({ ...v, approvers: x })} options={people.data?.users ?? []} optionFilterProp="label" aria-label="تأییدکنندگان" />
          </div>
          <div className="grid gap-1">
            <span className="blk-f-l">گروه تأییدکننده</span>
            <Select allowClear value={v.approver_group_id ?? undefined} onChange={(x) => setV({ ...v, approver_group_id: x ?? null })} options={people.data?.groups ?? []} optionFilterProp="label" aria-label="گروه تأییدکننده" />
          </div>
        </div>
      ) : null}
      <div className="ag-row4">
        <div className="grid gap-1">
          <span className="blk-f-l">ردهٔ مدل</span>
          <Select value={v.tier} onChange={(x) => setV({ ...v, tier: x })} options={Object.entries(SKILL_TIERS).map(([value, t]) => ({ value, label: t.label }))} />
        </div>
        {num("max_steps", "سقف گام در هر اجرا", 1, 40)}
        {num("max_actions", "سقف اقدام در هر اجرا", 0, 200)}
        {num("daily_runs", "سقف اجرای روزانه", 1, 100_000)}
      </div>
      {num("max_tokens", "سقف واژه در هر اجرا", 1000, 2_000_000)}
      <div className="ag-row2">
        <div className="grid gap-1">
          <span className="blk-f-l">جدول‌های ممنوع</span>
          <Select mode="multiple" value={v.forbidden_tables} onChange={(x) => setV({ ...v, forbidden_tables: x })} options={TABLE_OPTIONS} optionFilterProp="label" aria-label="جدول‌های ممنوع" />
        </div>
        <div className="grid gap-1">
          <span className="blk-f-l">فیلدهای ممنوع</span>
          <Select mode="tags" value={v.forbidden_fields} onChange={(x) => setV({ ...v, forbidden_fields: x })} tokenSeparators={[","]} aria-label="فیلدهای ممنوع" />
        </div>
        <div className="grid gap-1">
          <span className="blk-f-l">وضعیت‌های ممنوع</span>
          <Select mode="tags" value={v.forbidden_states} onChange={(x) => setV({ ...v, forbidden_states: x })} tokenSeparators={[","]} aria-label="وضعیت‌های ممنوع" />
        </div>
        <div className="grid gap-1">
          <span className="blk-f-l">نقش‌هایی که آغازش می‌کنند</span>
          <Select mode="tags" value={v.roles} onChange={(x) => setV({ ...v, roles: x })} aria-label="نقش‌هایی که آغازش می‌کنند" />
        </div>
      </div>
      <div className="grid gap-1">
        <span className="blk-f-l">گروه‌های فیلد که به مدل می‌رسد</span>
        <Checkbox.Group value={v.field_groups} onChange={(x) => setV({ ...v, field_groups: x as string[] })} options={SKILL_GROUP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      </div>
      {problems.length ? (
        <Note tone="warning">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Note>
      ) : null}
      <div>
        <Button type="primary" loading={saving} disabled={problems.length > 0} onClick={() => void save()}>
          ذخیره
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tools

function Tools({ a, onSaved }: { a: AgentAdminItem; onSaved: () => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const q = useQuery({ queryKey: AGENT_KEYS.tools(orgId, a.key), queryFn: () => agentsApi.tools(api, a.key) });
  const [patterns, setPatterns] = useState(a.tools);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPatterns(a.tools), [a.tools]);
  const groups = useMemo(() => toolGroups(q.data?.tools ?? [], patterns), [q.data, patterns]);
  const save = async () => {
    setSaving(true);
    try {
      await agentsApi.patch(api, a.key, { tools: patterns });
      n.ok("ابزارهای عامل ذخیره شد");
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  if (q.isLoading) return <Skeleton rows={6} />;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="blk-f-l">الگوها</span>
        <Select mode="tags" value={patterns} onChange={setPatterns} tokenSeparators={[","]} aria-label="الگوهای ابزار" />
        <span className="blk-f-h">عامل فقط ابزاری را دارد که هم اینجا آمده و هم هویتش اجازه دارد.</span>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="ag-tools">
          <div className="sk-grp-t">{g.label}</div>
          <div className="ag-tools-l">
            {g.tools.map((t) => (
              <Checkbox key={t.name} checked={t.checked} disabled={t.viaPattern} onChange={(e) => setPatterns(toggleTool(patterns, t.name, e.target.checked))}>
                <span className={t.available ? "" : "ag-off"}>{t.title_fa}</span> <bdi dir="ltr" className="ag-mono">{t.name}</bdi>
                {!t.available ? <Tag className="ms-1">هویت عامل اجازه ندارد</Tag> : null}
              </Checkbox>
            ))}
          </div>
        </section>
      ))}
      <div>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          ذخیرهٔ ابزارها
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- principal

function Principal({ a, view, onSaved }: { a: AgentAdminItem; view: AgentAdminView; onSaved: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [roles, setRoles] = useState(a.principal.roles);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRoles(a.principal.roles), [a.principal.roles]);
  const save = async (active: boolean) => {
    setBusy(true);
    try {
      await agentsApi.principal(api, a.key, roles, active);
      n.ok(active ? "نقش‌های هویت عامل ذخیره شد" : "هویت عامل خاموش شد");
      onSaved();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <div className="sk-item-t">{a.principal.name ?? `عامل: ${a.name}`}</div>
      <div className="sk-item-d">{a.principal.user_id ? (a.principal.active ? "فعال است." : "خاموش است.") : "هنوز ساخته نشده است."}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Select className="min-w-[260px] flex-1" mode="multiple" value={roles} onChange={setRoles} options={view.roles.map((r) => ({ value: r.key, label: r.name }))} optionFilterProp="label" placeholder="نقش‌ها" aria-label="نقش‌های هویت عامل" />
        <Button type="primary" loading={busy} disabled={!roles.length} onClick={() => void save(true)}>
          {a.principal.user_id ? "ذخیرهٔ نقش‌ها" : "ساخت هویت"}
        </Button>
        {a.principal.active ? (
          <Button loading={busy} onClick={() => void save(false)}>
            خاموش کردن
          </Button>
        ) : null}
      </div>
      <span className="blk-f-h">نقش‌ها را مالک سازمان تعیین می‌کند؛ هیچ‌کس نقشی بیش از دسترسی خودش نمی‌دهد.</span>
    </div>
  );
}

// ---------------------------------------------------------------- runs and the test console

export function RunSteps({ run }: { run: AgentRunView }) {
  return (
    <div className="grid gap-2">
      <div className="ag-run-m">
        <Tag color={TAG_COLOR[AGENT_RUN_STATUS[run.status].color]}>{AGENT_RUN_STATUS[run.status].label}</Tag>
        <span>{AGENT_RUN_TRIGGERS[run.trigger]}</span>
        {run.record_number ? <bdi dir="ltr">{run.record_number}</bdi> : null}
        <span className="ds-num">
          {fa(run.step_count)} گام · {fa(run.tool_calls)} ابزار · {fa(run.actions)} اقدام · {fa(run.tokens_in + run.tokens_out)} واژه
        </span>
        {run.principal?.name ? <span>با هویت {run.principal.name}</span> : null}
      </div>
      {run.error ? <Note tone="warning">{run.error}</Note> : null}
      <ol className="ag-steps">
        {run.steps.map((s, i) => {
          const l = stepLine(s);
          return (
            <li key={i} className={`is-${l.tone}`}>
              <div className="ag-step-t">
                <span className="ds-num">{fa(s.n)}</span> {l.title}
              </div>
              {l.detail ? <div className="ag-step-d">{l.detail}</div> : null}
            </li>
          );
        })}
      </ol>
      {run.outcome ? (
        <div className="blk-card">
          <div className="blk-card-b ag-outcome">{run.outcome}</div>
        </div>
      ) : null}
    </div>
  );
}

function AccessColumn({ title, view }: { title: string; view: AgentTestResult["admin"] | null }) {
  return (
    <div className="ag-side">
      <div className="ag-side-h">{title}</div>
      {!view ? (
        <div className="sk-item-d">هویت ندارد.</div>
      ) : (
        <>
          <div className="sk-item-d ds-num">
            {view.name} · {fa(view.tools)} ابزار · {fa(view.writes)} ابزار پیش‌نویس
          </div>
          {view.record ? (
            <dl className="ag-kv">
              {Object.entries(view.record)
                .slice(0, 30)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <div className="sk-item-d">این رکورد را نمی‌بیند.</div>
          )}
        </>
      )}
    </div>
  );
}

function TestConsole({ a }: { a: AgentAdminItem }) {
  const { api } = useOrg();
  const n = useNotify();
  const [table, setTable] = useState<string | null>(a.tables[0] ?? null);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AgentTestResult | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      let id: string | null = null;
      if (table && ref.trim()) {
        if (/^[0-9a-f-]{36}$/i.test(ref.trim())) id = ref.trim();
        else {
          const r = await api.get<{ rows: { id: string; number?: string }[] }>(`/r/${table}`, { q: ref.trim(), size: 5 });
          id = (r.rows.find((x) => String(x.number ?? "").toUpperCase() === ref.trim().toUpperCase()) ?? r.rows[0])?.id ?? null;
          if (!id) throw new Error("رکورد پیدا نشد");
        }
      }
      setRes(await agentsApi.test(api, a.key, { table: id ? table : null, id }));
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="blk-f-l">جدول</span>
          <Select className="min-w-[200px]" allowClear value={table ?? undefined} onChange={(x) => setTable(x ?? null)} options={TABLE_OPTIONS} optionFilterProp="label" />
        </label>
        <label className="grid flex-1 gap-1">
          <span className="blk-f-l">شماره یا شناسهٔ رکورد</span>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="INC0000123" dir="ltr" />
        </label>
        <Button type="primary" icon={<FlaskConical {...ICON14} />} loading={busy} onClick={() => void run()}>
          اجرای آزمایشی
        </Button>
      </div>
      <span className="blk-f-h">اجرای آزمایشی با هویت عامل انجام می‌شود ولی هیچ پیشنهادی ثبت و هیچ کاری اعمال نمی‌شود.</span>
      {res ? (
        <>
          <div className="ag-sides">
            <AccessColumn title="شما می‌بینید" view={res.admin} />
            <AccessColumn title="هویت عامل می‌بیند" view={res.principal} />
          </div>
          {res.problem ? <Note tone="warning">{res.problem}</Note> : null}
          {res.run ? <RunSteps run={res.run} /> : null}
        </>
      ) : null}
    </div>
  );
}

function Runs({ a }: { a: AgentAdminItem }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: AGENT_KEYS.runs(orgId, a.key), queryFn: () => agentsApi.runs(api, { agent: a.key, limit: 50 }) });
  const [open, setOpen] = useState<string | null>(null);
  const one = useQuery({ queryKey: AGENT_KEYS.run(orgId, open ?? "-"), queryFn: () => agentsApi.run(api, open!), enabled: !!open });
  const stop = async (id: string) => {
    try {
      await agentsApi.stop(api, id);
      void qc.invalidateQueries({ queryKey: ["ai-agents", orgId] });
    } catch (e) {
      n.error(e);
    }
  };
  if (q.isLoading) return <Skeleton rows={6} />;
  const runs = q.data?.runs ?? [];
  if (!runs.length) return <EmptyState title="هنوز اجرایی نیست." />;
  return (
    <div className="grid gap-2">
      {runs.map((r) => (
        <div key={r.id} className="ag-runrow">
          <button type="button" className="ag-runrow-b" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <Tag color={TAG_COLOR[AGENT_RUN_STATUS[r.status].color]}>{AGENT_RUN_STATUS[r.status].label}</Tag>
            <span>{AGENT_RUN_TRIGGERS[r.trigger]}</span>
            {r.record_number ? <bdi dir="ltr">{r.record_number}</bdi> : null}
            <span className="ds-num">{fa(r.step_count)} گام</span>
            {r.started_at ? <JDateTime v={r.started_at} /> : null}
          </button>
          {r.status === "queued" || r.status === "running" ? (
            <Button size="small" icon={<Square {...ICON14} />} onClick={() => void stop(r.id)}>
              توقف
            </Button>
          ) : null}
          {open === r.id && one.data ? (
            <div className="ag-runrow-d">
              <RunSteps run={one.data.run} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the tab

function NewAgent({ view, onDone }: { view: AgentAdminView; onDone: (key: string) => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await agentsApi.create(api, { key: key.trim(), name: name.trim(), from });
      n.ok("عامل ساخته شد؛ خاموش است تا روشنش کنید");
      onDone(key.trim());
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="blk-f-l">کلید (لاتین)</span>
        <Input value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" placeholder="org.weekly_report" />
      </label>
      <label className="grid gap-1">
        <span className="blk-f-l">نام</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </label>
      <div className="grid gap-1">
        <span className="blk-f-l">رونوشت از</span>
        <Select allowClear value={from ?? undefined} onChange={(x) => setFrom(x ?? null)} options={view.agents.map((a) => ({ value: a.key, label: a.name }))} placeholder="عامل تازه از صفر" />
      </div>
      <div>
        <Button type="primary" loading={busy} disabled={!/^[a-z][a-z0-9_.]{1,79}$/.test(key.trim()) || name.trim().length < 2} onClick={() => void create()}>
          ساخت عامل
        </Button>
      </div>
    </div>
  );
}

export function AgentsTab() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const q = useAdmin();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["ai-agents", orgId] });
  if (q.isLoading)
    return (
      <div className="blk-card">
        <div className="blk-card-b">
          <Skeleton rows={8} />
        </div>
      </div>
    );
  if (!q.data) return <div className="blk-card"><EmptyState title="عامل‌ها بارگذاری نشد." description={(q.error as Error | null)?.message ?? ""} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} /></div>;
  const view = q.data;
  const roleNames = new Map(view.roles.map((r) => [r.key, r.name]));
  const groups = groupAgents(view.agents, search);
  const current = view.agents.find((a) => a.key === open) ?? null;
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) n.ok(ok);
      refresh();
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <div className="sk-admin">
      {!view.ai.ok ? <Note tone="warning">{view.ai.message_fa ?? "مدل هوش مصنوعی در دسترس نیست."} عامل‌ها تا اتصال مدل اجرا نمی‌شوند.</Note> : null}
      <div className="blk-card">
        <div className="blk-card-b ag-top">
          <Switch checked={view.agents_on} onChange={(on) => void act(() => agentsApi.setSwitch(api, on), on ? "عامل‌ها روشن شدند" : "همهٔ عامل‌ها متوقف شدند")} aria-label="عامل‌های هوش مصنوعی روشن‌اند" />
          <span className="sk-item-t">{view.agents_on ? "عامل‌ها روشن‌اند" : "همهٔ عامل‌ها خاموش‌اند"}</span>
          <span className="flex-1" />
          <Link to={`/${orgId}/ai/virtual-agent`} className="ds-link">
            دستیار مجازی
          </Link>
          <Button icon={<Plus {...ICON14} />} onClick={() => setAdding(true)}>
            عامل تازه
          </Button>
        </div>
      </div>
      <Input.Search allowClear value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجو در عامل‌ها" aria-label="جست‌وجو در عامل‌ها" />
      {groups.map((g) => (
        <section key={g.module}>
          <div className="sk-grp-t">{g.label}</div>
          <div className="blk-card">
            {g.items.map((a) => (
              <div key={a.key} className="sk-item">
                <div>
                  <div className="sk-item-t">
                    {a.name} {!a.builtin ? <Tag>عامل سازمان</Tag> : null}
                  </div>
                  <div className="sk-item-d">{a.description}</div>
                  <div className="sk-item-m">
                    <bdi dir="ltr" className="ds-mono">{a.key}</bdi>
                    <span>{AGENT_AUTONOMY[a.autonomy].label}</span>
                    {a.triggers.map((t) => (
                      <span key={t}>{AGENT_TRIGGERS[t]}</span>
                    ))}
                    <span>هویت: {principalText(a.principal, roleNames)}</span>
                    <span className="ds-num">
                      امروز {fa(a.runs_today)} از {fa(a.daily_runs)} اجرا
                    </span>
                    {a.open_proposals ? <span className="ds-num">{fa(a.open_proposals)} پیشنهاد باز</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={a.enabled} onChange={(v) => void act(() => agentsApi.patch(api, a.key, { enabled: v }))} aria-label={`${a.name} فعال است`} />
                  <Button size="small" icon={<Pencil {...ICON14} />} onClick={() => setOpen(a.key)}>
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
          <>
            <Tabs
              items={[
                { key: "settings", label: "تنظیمات", children: <Settings a={current} onSaved={refresh} /> },
                { key: "tools", label: "ابزارها", children: <Tools a={current} onSaved={refresh} /> },
                { key: "principal", label: "هویت", children: <Principal a={current} view={view} onSaved={refresh} /> },
                { key: "test", label: "آزمون", children: <TestConsole a={current} /> },
                { key: "runs", label: "اجراها", children: <Runs a={current} /> },
              ]}
            />
            <div className="ag-foot">
              {current.builtin ? (
                <Popconfirm title="هدف، ابزارها و تنظیمات به پیش‌فرض برگردد؟" onConfirm={() => void act(() => agentsApi.reset(api, current.key), "به پیش‌فرض برگشت")}>
                  <Button size="small">بازگشت به پیش‌فرض</Button>
                </Popconfirm>
              ) : (
                <Popconfirm title="این عامل حذف شود؟" onConfirm={() => void act(async () => { await agentsApi.remove(api, current.key); setOpen(null); }, "عامل حذف شد")}>
                  <Button size="small" danger>
                    حذف عامل
                  </Button>
                </Popconfirm>
              )}
            </div>
          </>
        ) : null}
      </Drawer>
      <Drawer open={adding} onClose={() => setAdding(false)} destroyOnHidden title="عامل تازه">
        <NewAgent
          view={view}
          onDone={(key) => {
            setAdding(false);
            refresh();
            setOpen(key);
          }}
        />
      </Drawer>
    </div>
  );
}
