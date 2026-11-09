// Record-page widgets of the event module (loaded with their page):
//   AlertActions    an alert's header: acknowledge, take, snooze, close (with the reason), raise an incident,
//                   re-open, take out of its group — offered by the record meta's `event.can_respond`
//   GroupActions    a correlated group's header: acknowledge all, take, raise the group's incident, close
//   Timeline        the escalation timeline of an alert: what happened (first event, opened, every page and its
//                   answer, acknowledged, cleared) and the levels still ahead, with the policy
//   GroupInsight    a group's probable causes and its summary (rule-based; AI on demand)
//   SourceKey       a source's «ساخت کلید» (the key is shown once, with the ingestion URL) and «آزمون نگاشت»
//   RuleSimulate    «شبیه‌سازی روی رویدادهای ۷ روز» of a processing rule
//   IncidentAlerts  the monitoring alerts of an incident and who is on call for its group (the incident page)
//   CiAlerts        the open alerts of a CI (the CI page)
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Input, Modal, Select, Space, Typography, type MenuProps } from "antd";
import { Check, ChevronDown, Hand, KeyRound, FlaskConical, Siren } from "lucide-react";
import { ALERT_CLOSE_CODES } from "@shared/tables/event";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { fa } from "../../lib/fa";
import { ICON14 } from "../../components/blocks";
import { Chip, Loader } from "../../components/display";
import { recordsApi } from "../../records/data/api";
import { recordPath, type RecordContext } from "../../records/extensions";
import { EVENT_KEYS, eventApi, type ActionName, type AiAnswer, type SourceKey, type SimulationResult } from "./api";
import { canAck, durationText, isOpenState, severityLabel, severityTone, stateLabel, targetLabel } from "./model";
import "./event.css";

const metaOf = (ctx: RecordContext) => ((ctx.meta as { event?: { can_respond?: boolean; can_configure?: boolean } }).event ?? {}) as { can_respond?: boolean; can_configure?: boolean };

function useRun(ctx: RecordContext) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      n.ok(ok);
      ctx.refresh();
      await qc.invalidateQueries({ queryKey: EVENT_KEYS.all(orgId) });
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function AlertActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const row = ctx.row as Record<string, any>;
  const { busy, run } = useRun(ctx);
  const [closing, setClosing] = useState(false);
  const [code, setCode] = useState("fixed");
  const [notes, setNotes] = useState("");
  if (!metaOf(ctx).can_respond) return null;
  const act = (a: ActionName, ok: string, body: Record<string, unknown> = {}) => run(() => eventApi.action(api, row.id, a, body), ok);
  const state = String(row.state);
  const more: MenuProps["items"] = [
    isOpenState(state) ? { key: "snooze1", label: "تعویق یک ساعته", onClick: () => act("snooze", "هشدار به تعویق افتاد", { minutes: 60 }) } : null,
    isOpenState(state) ? { key: "snooze4", label: "تعویق چهار ساعته", onClick: () => act("snooze", "هشدار به تعویق افتاد", { minutes: 240 }) } : null,
    state === "acknowledged" ? { key: "unack", label: "لغو تأیید", onClick: () => act("unack", "هشدار دوباره باز شد") } : null,
    isOpenState(state) ? { key: "suppress", label: "سرکوب", onClick: () => act("suppress", "هشدار سرکوب شد") } : null,
    ["cleared", "closed", "suppressed"].includes(state) ? { key: "reopen", label: "بازگشایی", onClick: () => act("reopen", "هشدار بازگشایی شد") } : null,
    row.group_id ? { key: "ungroup", label: "بیرون آوردن از گروه هم‌بسته", onClick: () => act("ungroup", "هشدار از گروه بیرون آمد") } : null,
    state !== "closed" ? { key: "close", label: "بستن…", onClick: () => setClosing(true) } : null,
  ].filter(Boolean) as MenuProps["items"];
  return (
    <Space size={6} wrap>
      {canAck(state) ? (
        <Button type="primary" icon={<Check {...ICON14} />} loading={busy} onClick={() => act("ack", "هشدار تأیید شد")}>
          تأیید
        </Button>
      ) : null}
      {isOpenState(state) && !row.assigned_to ? (
        <Button icon={<Hand {...ICON14} />} disabled={busy} onClick={() => act("take", "هشدار به شما سپرده شد")}>
          برعهده می‌گیرم
        </Button>
      ) : null}
      {!row.incident_id && isOpenState(state) ? (
        <Button icon={<Siren {...ICON14} />} disabled={busy} onClick={() => act("incident", "رخداد ساخته شد")}>
          ساخت رخداد
        </Button>
      ) : null}
      {more?.length ? (
        <Dropdown menu={{ items: more }}>
          <Button disabled={busy}>
            اقدام‌ها <ChevronDown {...ICON14} />
          </Button>
        </Dropdown>
      ) : null}
      <Modal open={closing} title="بستن هشدار" okText="بستن" cancelText="انصراف" onCancel={() => setClosing(false)} onOk={() => act("close", "هشدار بسته شد", { close_code: code, close_notes: notes || null }).then(() => setClosing(false))} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Select value={code} onChange={setCode} options={ALERT_CLOSE_CODES.map((o) => ({ value: o.value, label: o.label }))} aria-label="نتیجهٔ بستن" />
          <Input.TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="یادداشت بستن (اختیاری)" autoSize={{ minRows: 2 }} aria-label="یادداشت بستن" />
        </div>
      </Modal>
    </Space>
  );
}

export function GroupActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const row = ctx.row as Record<string, any>;
  const { busy, run } = useRun(ctx);
  if (!metaOf(ctx).can_respond || ["closed"].includes(String(row.state))) return null;
  const g = (a: "ack" | "take" | "close" | "incident", ok: string, body: Record<string, unknown> = {}) => run(() => eventApi.group(api, row.id, a, body), ok);
  return (
    <Space size={6} wrap>
      {Number(row.open_count) > 0 ? (
        <Button type="primary" icon={<Check {...ICON14} />} loading={busy} onClick={() => g("ack", "هشدارهای گروه تأیید شد")}>
          تأیید همه
        </Button>
      ) : null}
      <Button icon={<Hand {...ICON14} />} disabled={busy} onClick={() => g("take", "گروه به شما سپرده شد")}>
        برعهده می‌گیرم
      </Button>
      {!row.incident_id && Number(row.open_count) > 0 ? (
        <Button icon={<Siren {...ICON14} />} disabled={busy} onClick={() => g("incident", "رخداد گروه ساخته شد")}>
          ساخت رخداد
        </Button>
      ) : null}
      <Button disabled={busy} onClick={() => g("close", "گروه بسته شد", { close_code: "fixed" })}>
        بستن گروه
      </Button>
    </Space>
  );
}

export function Timeline({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, timezone } = useOrg();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: EVENT_KEYS.timeline(orgId, id), queryFn: () => eventApi.timeline(api, id), staleTime: 15_000 });
  if (q.isLoading) return <Loader />;
  const t = q.data;
  if (!t) return <p className="text-[13px] text-ink-3">زمان‌بندی ارتقا در دسترس نیست.</p>;
  return (
    <div className="flex flex-col gap-2">
      {t.policy ? (
        <div className="text-[12.5px] text-ink-2">
          سیاست «{t.policy.name}»: {t.policy.levels.map((l) => `سطح ${fa(l.level)} (${targetLabel(l.target)}، پس از ${fa(l.delay_minutes)} دقیقه)`).join(" ← ")}
          {t.policy.repeat_times ? ` · ${fa(t.policy.repeat_times)} بار تکرار` : ""}
        </div>
      ) : (
        <div className="text-[12.5px] text-ink-3">این هشدار سیاست ارتقا ندارد.</div>
      )}
      <ol className="ev-tl" aria-label="زمان‌بندی ارتقا">
        {t.items.map((i, k) => (
          <li key={k} data-k={i.kind}>
            <i className="dot" aria-hidden />
            <div>
              <div className="what">{i.label}</div>
              <div className="when">{formatJalaliDateTime(i.at, timezone)}</div>
            </div>
          </li>
        ))}
        {t.planned.map((p, k) => (
          <li key={`p${k}`} data-k="planned">
            <i className="dot" aria-hidden />
            <div>
              <div className="what">
                سطح {fa(p.level)} ({targetLabel(p.target)}) — اگر تا آن زمان تأیید نشود
              </div>
              <div className="when">{formatJalaliDateTime(p.at, timezone)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GroupInsightPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: EVENT_KEYS.causes(orgId, id), queryFn: () => eventApi.causes(api, id), staleTime: 30_000 });
  const [ai, setAi] = useState<AiAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try {
      setAi(await eventApi.aiCauses(api, id));
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Loader />;
  return (
    <div className="flex flex-col gap-2">
      {ai ? (
        <>
          <div className="ev-md">{ai.text}</div>
          <div className="text-[11.5px] text-ink-3">{ai.ai ? "ساخته‌شده با هوش مصنوعی — پیش از استفاده بازبینی کنید" : ai.label}</div>
        </>
      ) : (
        <div className="ev-md">{q.data?.hints ?? ""}</div>
      )}
      <Button size="small" onClick={ask} loading={busy}>
        روایت علت‌ها
      </Button>
    </div>
  );
}

export function SourceKeyAction({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const n = useNotify();
  const [key, setKey] = useState<SourceKey | null>(null);
  const [testing, setTesting] = useState(false);
  const [payload, setPayload] = useState("{\n  \"title\": \"آزمون\",\n  \"host\": \"srv01\",\n  \"severity\": \"warning\"\n}");
  const [result, setResult] = useState<{ events: Record<string, unknown>[]; skipped: string | null } | null>(null);
  if (!ctx.meta.canWrite) return null;
  const make = async () => {
    try {
      setKey(await eventApi.sourceKey(api, String(ctx.row.id)));
      ctx.refresh();
    } catch (e) {
      n.error(errorText(e));
    }
  };
  const test = async () => {
    try {
      setResult(await eventApi.sourceTest(api, String(ctx.row.id), JSON.parse(payload)));
    } catch (e) {
      n.error(e instanceof SyntaxError ? "متن نمونه JSON معتبر نیست" : errorText(e));
    }
  };
  return (
    <Space size={6}>
      <Button icon={<KeyRound {...ICON14} />} onClick={() => (ctx.row.token_hint ? Modal.confirm({ title: "ساخت کلید تازه", content: "کلید پیشین بی‌درنگ از کار می‌افتد و ابزار پایش باید نشانی تازه را بگیرد.", okText: "ساخت کلید تازه", cancelText: "انصراف", onOk: make }) : make())}>
        {ctx.row.token_hint ? "کلید تازه" : "ساخت کلید"}
      </Button>
      <Button icon={<FlaskConical {...ICON14} />} onClick={() => setTesting(true)}>
        آزمون نگاشت
      </Button>
      <Modal open={!!key} title="کلید منبع رویداد" footer={<Button onClick={() => setKey(null)}>بستن</Button>} onCancel={() => setKey(null)} destroyOnHidden>
        {key ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13px]">این کلید فقط همین یک بار نشان داده می‌شود؛ آن را در ابزار پایش بگذارید.</p>
            <div>
              <div className="text-[12px] text-ink-3">نشانی دریافت (کلید در نشانی)</div>
              <Typography.Text copyable className="ltr" dir="ltr">
                {key.url}
              </Typography.Text>
            </div>
            <div>
              <div className="text-[12px] text-ink-3">یا: نشانی و سرآیند Authorization: Bearer</div>
              <Typography.Text copyable className="ltr" dir="ltr">
                {key.key}
              </Typography.Text>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal open={testing} title="آزمون نگاشت" onCancel={() => setTesting(false)} onOk={test} okText="یکسان‌سازی" cancelText="بستن" width={640} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Input.TextArea value={payload} onChange={(e) => setPayload(e.target.value)} autoSize={{ minRows: 6, maxRows: 16 }} className="ltr font-mono" dir="ltr" aria-label="نمونهٔ پیام ابزار پایش" />
          {result ? (
            result.events.length ? (
              <ul className="flex flex-col gap-2 text-[13px]">
                {result.events.map((e, i) => (
                  <li key={i} className="flex flex-wrap gap-2">
                    <Chip tone={severityTone(e.severity)}>{severityLabel(e.severity)}</Chip>
                    <b>{String(e.message ?? "")}</b>
                    <span className="ltr">{String(e.node ?? "")}</span>
                    <span>{e.status === "resolved" ? "رفع" : "فعال"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">{result.skipped ?? "رویدادی از این پیام به دست نیامد"}</p>
            )
          ) : null}
        </div>
      </Modal>
    </Space>
  );
}

export function RuleSimulate({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const n = useNotify();
  const [r, setR] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  if (!metaOf(ctx) || !ctx.meta.canWrite) return null;
  const go = async () => {
    setBusy(true);
    try {
      setR(await eventApi.simulate(api, { rule_id: String(ctx.row.id), days: 7 }));
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button icon={<FlaskConical {...ICON14} />} loading={busy} onClick={go}>
        شبیه‌سازی روی ۷ روز
      </Button>
      <Modal open={!!r} title="نتیجهٔ شبیه‌سازی" footer={<Button onClick={() => setR(null)}>بستن</Button>} onCancel={() => setR(null)} destroyOnHidden>
        {r ? (
          <div className="flex flex-col gap-2 text-[13px]">
            <p className="m-0">
              از {fa(r.checked)} رویداد، این قاعده بر {fa(r.matched)} رویداد اعمال می‌شد؛ هیچ چیزی تغییر نکرد.
            </p>
            {Object.entries(r.outcomes).map(([k, v]) => (
              <div key={k}>
                {k === "ignored" ? "نادیده" : k === "suppressed" ? "سرکوب" : k === "held" ? "زیر آستانه" : "تغییر"}: <span className="ds-num">{fa(v)}</span>
              </div>
            ))}
            <ul className="flex flex-col gap-1">
              {r.samples.map((s) => (
                <li key={s.id} className="text-ink-2">
                  {s.message}
                  {s.before.severity !== s.after.severity ? ` — شدت ${severityLabel(s.before.severity)} ← ${severityLabel(s.after.severity)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function AlertList({ filter, empty }: { filter: unknown; empty: string }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["records", orgId, "alert", "panel", filter],
    queryFn: () => recordsApi.list(api, "alert", { filter: filter as never, size: 8, sort: "-last_seen_at", fields: ["number", "short_description", "severity", "state", "last_seen_at"], total: true }),
    staleTime: 30_000,
  });
  if (q.isLoading) return <Loader />;
  const rows = q.data?.rows ?? [];
  if (!rows.length) return <p className="m-0 text-[13px] text-ink-3">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((a) => (
        <li key={String(a.id)} className="flex items-center gap-2 text-[13px]">
          <Chip tone={severityTone(a.severity)}>{severityLabel(a.severity)}</Chip>
          <button type="button" className="ds-link min-w-0 truncate text-start" onClick={() => nav(`/${orgId}/${recordPath("alert", String(a.id))}`)}>
            {String(a.short_description ?? "")}
          </button>
          <span className="ms-auto text-[12px] text-ink-3">{stateLabel(a.state)}</span>
        </li>
      ))}
      {(q.data?.total ?? 0) > rows.length ? <li className="text-[12px] text-ink-3">و {fa((q.data?.total ?? 0) - rows.length)} هشدار دیگر</li> : null}
    </ul>
  );
}

export function IncidentAlerts({ ctx }: { ctx: RecordContext }) {
  return <AlertList filter={{ f: "incident_id", op: "eq", v: ctx.row.id }} empty="این رخداد از هشدار پایش نیامده است." />;
}

export function CiAlerts({ ctx }: { ctx: RecordContext }) {
  return <AlertList filter={{ and: [{ f: "ci_id", op: "eq", v: ctx.row.id }, { f: "state", op: "in", v: ["open", "acknowledged", "flapping", "snoozed", "maintenance"] }] }} empty="هشدار بازی روی این پیکربندی نیست." />;
}

/** Who is on call now for the record's group (the incident page). */
export function OnCallPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId, timezone } = useOrg();
  const group = (ctx.row.assignment_group_id as string | null) ?? null;
  const q = useQuery({ queryKey: EVENT_KEYS.oncallNow(orgId, group ?? ""), queryFn: () => eventApi.oncallNow(api, group!), enabled: !!group, staleTime: 60_000 });
  if (!group) return <p className="m-0 text-[13px] text-ink-3">گروه پشتیبانی تعیین نشده است.</p>;
  if (q.isLoading) return <Loader />;
  const items = q.data?.items ?? [];
  if (!items.length) return <p className="m-0 text-[13px] text-ink-3">این گروه برنامهٔ کشیک ندارد.</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {items.map((s) => (
        <li key={s.schedule_id}>
          <b>{s.user_id ? q.data!.display[s.user_id] ?? "عضو" : "کسی کشیک نیست"}</b>
          <span className="text-ink-3"> · {s.schedule}{s.until ? ` · تا ${formatJalaliDateTime(s.until, timezone)}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export const fmtDuration = durationText;
