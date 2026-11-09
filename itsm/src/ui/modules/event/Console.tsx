// «کنسول هشدارها» — the live alert console (catalogue EVT-017), grouped by correlated alert: each group with its
// worst severity, counts, team and incident, and its alerts under it; lone alerts after the groups. Refreshed live
// («زنده») and every 15 seconds. Keyboard (physical keys, so the Persian layout works too): J/K or the arrows move,
// Enter opens, A acknowledges, S takes, W assigns to a colleague, I raises an incident, C closes, Z snoozes an hour,
// X selects, G folds a group, / searches; on a group the action applies to all its open alerts. A side card shows
// the focused group's rule-based summary and probable causes, with the AI narration on demand (rule-based without a
// model).
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Input, Modal, Popover, Segmented, Select, Space, Tooltip, type InputRef } from "antd";
import { Check, ChevronDown, ChevronLeft, Hand, Keyboard, Siren, Clock, X, Sparkles, Layers, UserPlus } from "lucide-react";
import { ALERT_SEVERITIES, GROUP_REASONS } from "@shared/tables/event";
import { useOrg } from "../../lib/org";
import { useNotify, useDebounced } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { recordPath } from "../../records/extensions";
import { RecordSelect } from "../../records/fields/RecordSelect";
import { EVENT_KEYS, eventApi, type ActionName, type AiAnswer } from "./api";
import { KEY_HELP, canAck, consoleRows, keyAction, seenLine, severityLabel, severityTone, stateLabel, escalationLabel, type ConsoleRow } from "./model";
import "./event.css";

type Scope = "open" | "mine" | "team" | "all";
const SCOPES: { value: Scope; label: string }[] = [
  { value: "open", label: "همهٔ باز" },
  { value: "team", label: "تیم‌های من" },
  { value: "mine", label: "من" },
  { value: "all", label: "۲۴ ساعت گذشته" },
];
const reasonLabel = (r: unknown) => GROUP_REASONS.find((o) => o.value === r)?.label ?? "";

function readScope(): Scope {
  try {
    const v = localStorage.getItem("itsm.event.scope");
    return SCOPES.some((s) => s.value === v) ? (v as Scope) : "open";
  } catch {
    return "open";
  }
}

export default function Console() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const [scope, setScopeState] = useState<Scope>(readScope);
  const [text, setText] = useState("");
  const q = useDebounced(text, 300);
  const [sev, setSev] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // «واگذاری به همکار»: the alert being assigned and the chosen person
  const [assignFor, setAssignFor] = useState<{ id: string; number: string | null } | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const search = useRef<InputRef>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const setScope = (s: Scope) => {
    setScopeState(s);
    try {
      localStorage.setItem("itsm.event.scope", s);
    } catch {
      /* ignore */
    }
  };

  const key = EVENT_KEYS.console(orgId, scope, q, sev.join(","));
  const data = useQuery({ queryKey: key, queryFn: () => eventApi.console(api, { scope, q, severity: sev.join(",") }), refetchInterval: 15_000, placeholderData: (p) => p });
  const view = data.data;
  const expanded = useMemo(() => new Set((view?.groups ?? []).map((g) => g.id).filter((id) => !collapsed.has(id))), [view, collapsed]);
  const rows = useMemo(() => consoleRows(view, expanded), [view, expanded]);
  const current: ConsoleRow | undefined = rows[Math.min(cursor, Math.max(0, rows.length - 1))];
  const focusGroup = current?.kind === "group" ? current.group : current?.kind === "alert" && current.groupId ? view?.groups.find((g) => g.id === current.groupId) : undefined;

  const refresh = () => qc.invalidateQueries({ queryKey: EVENT_KEYS.all(orgId) });
  const display = (id: string | null | undefined) => (id ? view?.display[id] ?? "" : "");
  const open = (r: ConsoleRow) => nav(`/${orgId}/${recordPath(r.kind === "group" ? "alert_group" : "alert", r.id)}`);

  const run = async (r: ConsoleRow | undefined, action: ActionName | "ack-group") => {
    if (!r || busy) return;
    if (action === "assign") {
      if (r.kind === "alert" && r.alert.can_respond) {
        setAssignee(null);
        setAssignFor({ id: r.id, number: r.alert.number ?? null });
      }
      return;
    }
    setBusy(true);
    try {
      if (r.kind === "group") {
        const a = action === "take" ? "take" : action === "incident" ? "incident" : action === "close" ? "close" : "ack";
        const res = await eventApi.group(api, r.id, a, a === "close" ? { close_code: "fixed" } : {});
        n.ok(a === "incident" ? "رخداد گروه ساخته شد" : `${fa(res.done)} هشدار گروه به‌روز شد${res.failed.length ? `؛ ${fa(res.failed.length)} انجام نشد` : ""}`);
      } else {
        const body = action === "snooze" ? { minutes: 60 } : action === "close" ? { close_code: "fixed" } : {};
        await eventApi.action(api, r.id, action as ActionName, body);
        n.ok(action === "ack" ? "هشدار تأیید شد" : action === "take" ? "هشدار به شما سپرده شد" : action === "snooze" ? "هشدار یک ساعت به تعویق افتاد" : action === "close" ? "هشدار بسته شد" : action === "incident" ? "رخداد ساخته شد" : "انجام شد");
      }
      await refresh();
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    if (!assignFor || !assignee) return;
    setBusy(true);
    try {
      await eventApi.action(api, assignFor.id, "assign", { user_id: assignee });
      n.ok("هشدار واگذار شد");
      setAssignFor(null);
      await refresh();
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (action: "ack" | "take" | "close" | "snooze") => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await eventApi.bulk(api, ids, action, action === "snooze" ? { minutes: 60 } : action === "close" ? { close_code: "fixed" } : {});
      n.ok(`${fa(r.done)} هشدار به‌روز شد${r.failed.length ? `؛ ${fa(r.failed.length)} انجام نشد` : ""}`);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (assignFor) return;
      const k = keyAction(e);
      if (!k) return;
      if (k === "search") {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (!rows.length) return;
      e.preventDefault();
      const r = rows[Math.min(cursor, rows.length - 1)];
      switch (k) {
        case "next":
          setCursor((c) => Math.min(rows.length - 1, c + 1));
          break;
        case "prev":
          setCursor((c) => Math.max(0, c - 1));
          break;
        case "open":
          open(r);
          break;
        case "select":
          if (r.kind === "alert") setSelected((s) => {
            const x = new Set(s);
            if (x.has(r.id)) x.delete(r.id);
            else x.add(r.id);
            return x;
          });
          break;
        case "toggle":
          if (r.kind === "group" || r.groupId) {
            const gid = r.kind === "group" ? r.id : r.groupId!;
            setCollapsed((s) => {
              const x = new Set(s);
              if (x.has(gid)) x.delete(gid);
              else x.add(gid);
              return x;
            });
          }
          break;
        default:
          void run(r, k as ActionName);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const c = view?.counts;
  return (
    <div className="ev-page">
      <PageHeader
        title="کنسول هشدارها"
        actions={
          <Popover
            trigger="click"
            title="میانبرهای صفحه‌کلید"
            content={
              <dl className="ev-keys">
                {KEY_HELP.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            }
          >
            <Button icon={<Keyboard {...ICON14} />} aria-label="میانبرهای صفحه‌کلید" />
          </Popover>
        }
      />
      <div className="ev-tb" role="toolbar" aria-label="پالایش هشدارها">
        <Segmented value={scope} onChange={(v) => setScope(v as Scope)} options={SCOPES} />
        <Input ref={search} allowClear value={text} onChange={(e) => setText(e.target.value)} placeholder="جست‌وجو در پیام، میزبان یا شماره" style={{ maxWidth: 260 }} aria-label="جست‌وجو" />
        <Select mode="multiple" allowClear placeholder="همهٔ شدت‌ها" value={sev} onChange={setSev} style={{ minWidth: 170 }} options={ALERT_SEVERITIES.map((o) => ({ value: o.value, label: o.label }))} aria-label="شدت" />
        {selected.size ? (
          <Space wrap>
            <span className="text-[13px] text-ink-2">{fa(selected.size)} انتخاب‌شده</span>
            <Button size="small" onClick={() => bulk("ack")} disabled={busy}>
              تأیید
            </Button>
            <Button size="small" onClick={() => bulk("take")} disabled={busy}>
              برعهده گرفتن
            </Button>
            <Button size="small" onClick={() => bulk("snooze")} disabled={busy}>
              تعویق
            </Button>
            <Button size="small" onClick={() => bulk("close")} disabled={busy}>
              بستن
            </Button>
            <Button size="small" type="text" icon={<X {...ICON14} />} onClick={() => setSelected(new Set())} aria-label="لغو انتخاب" />
          </Space>
        ) : null}
      </div>
      {c ? (
        <div className="ev-kpis" aria-live="polite">
          <div className="ev-kpi" data-v={c.critical ? "bad" : undefined}>
            <b className="ds-num">{fa(c.critical)}</b>
            <span>بحرانی و شدید باز</span>
          </div>
          <div className="ev-kpi" data-v={c.open ? "bad" : "good"}>
            <b className="ds-num">{fa(c.open)}</b>
            <span>باز و تأییدنشده</span>
          </div>
          <div className="ev-kpi">
            <b className="ds-num">{fa(c.acknowledged)}</b>
            <span>تأییدشده</span>
          </div>
          <div className="ev-kpi">
            <b className="ds-num">{fa(c.unassigned)}</b>
            <span>بی‌مسئول</span>
          </div>
          <div className="ev-kpi">
            <b className="ds-num">{fa(view?.groups.length ?? 0)}</b>
            <span>گروه هم‌بسته</span>
          </div>
        </div>
      ) : null}
      {data.isLoading && !view ? (
        <Loader />
      ) : !view ? (
        <EmptyState title="کنسول بارگذاری نشد" description="به هشدارها دسترسی ندارید یا اتصال برقرار نیست." />
      ) : !rows.length ? (
        <EmptyState title="هشداری نیست" description={scope === "open" ? "همهٔ هشدارها تأیید یا رفع شده‌اند." : "با این پالایش هشداری پیدا نشد."} />
      ) : (
        <div className="ev-body">
          <div className="ev-list" ref={listRef} role="listbox" aria-label="هشدارها" aria-activedescendant={current ? `ev-r-${current.id}` : undefined}>
            {rows.map((r, i) => (
              <ConsoleLine
                key={`${r.kind}:${r.id}`}
                r={r}
                i={i}
                active={i === Math.min(cursor, rows.length - 1)}
                checked={selected.has(r.id)}
                expanded={r.kind === "group" && expanded.has(r.id)}
                display={display}
                busy={busy}
                onFocus={() => setCursor(i)}
                onOpen={() => open(r)}
                onToggle={() =>
                  setCollapsed((s) => {
                    const x = new Set(s);
                    if (x.has(r.id)) x.delete(r.id);
                    else x.add(r.id);
                    return x;
                  })
                }
                onCheck={(v) =>
                  setSelected((s) => {
                    const x = new Set(s);
                    if (v) x.add(r.id);
                    else x.delete(r.id);
                    return x;
                  })
                }
                onAction={(a) => run(r, a)}
              />
            ))}
            {view.truncated ? <div className="p-3 text-[12.5px] text-ink-3">فقط ۵۰۰ هشدار نخست نمایش داده شد؛ پالایش را تنگ‌تر کنید.</div> : null}
          </div>
          <aside className="ev-side">{focusGroup ? <GroupInsight id={focusGroup.id} title={focusGroup.title} /> : <Card title="بینش">برای دیدن خلاصه و علت‌های محتمل، یک گروه هم‌بسته را انتخاب کنید.</Card>}</aside>
        </div>
      )}
      <Modal
        open={!!assignFor}
        title={`واگذاری هشدار ${assignFor?.number ?? ""}`}
        okText="واگذاری"
        cancelText="انصراف"
        onOk={() => void assign()}
        onCancel={() => setAssignFor(null)}
        okButtonProps={{ disabled: !assignee, loading: busy }}
        destroyOnHidden
      >
        <RecordSelect table="user" value={assignee} onChange={(v) => setAssignee(typeof v === "string" ? v : null)} meFirst placeholder="جست‌وجوی همکار…" autoFocus />
      </Modal>
    </div>
  );
}

function ConsoleLine(p: {
  r: ConsoleRow;
  i: number;
  active: boolean;
  checked: boolean;
  expanded: boolean;
  busy: boolean;
  display: (id: string | null | undefined) => string;
  onFocus: () => void;
  onOpen: () => void;
  onToggle: () => void;
  onCheck: (v: boolean) => void;
  onAction: (a: ActionName) => void;
}) {
  const { r } = p;
  const act = (a: ActionName, label: string, icon: React.ReactNode, disabled = false) => (
    <Tooltip title={label}>
      <Button
        size="small"
        type="text"
        icon={icon}
        aria-label={label}
        disabled={p.busy || disabled}
        onClick={(e) => {
          e.stopPropagation();
          p.onAction(a);
        }}
      />
    </Tooltip>
  );
  if (r.kind === "group") {
    const g = r.group;
    return (
      <div id={`ev-r-${g.id}`} data-i={p.i} className="ev-row" data-kind="group" data-sev={g.severity} role="option" aria-selected={p.active} tabIndex={-1} onClick={p.onFocus} onDoubleClick={p.onOpen}>
        <button type="button" className="sh-icon-btn" aria-label={p.expanded ? "بستن گروه" : "باز کردن گروه"} aria-expanded={p.expanded} onClick={(e) => (e.stopPropagation(), p.onToggle())}>
          {p.expanded ? <ChevronDown {...ICON14} /> : <ChevronLeft {...ICON14} />}
        </button>
        <span className="ev-sev">
          <Chip tone={severityTone(g.severity)}>{severityLabel(g.severity)}</Chip>
        </span>
        <div className="ev-title">
          <span className="t">
            <Layers {...ICON14} className="me-1 inline" aria-hidden />
            {g.title}
          </span>
          <span className="m">
            <span className="ds-num ltr">{g.number}</span>
            <span>
              {fa(g.alert_count)} هشدار، {fa(g.open_count)} باز
            </span>
            {g.reason ? <span>{reasonLabel(g.reason)}</span> : null}
            {g.assignment_group_id ? <span>{p.display(g.assignment_group_id)}</span> : null}
            {g.incident_id ? <span className="text-accent">رخداد {p.display(g.incident_id).split(" — ")[0]}</span> : null}
          </span>
        </div>
        <span className="ev-acts">
          {act("ack", "تأیید همهٔ هشدارهای گروه", <Check {...ICON14} />)}
          {act("take", "برعهده گرفتن گروه", <Hand {...ICON14} />)}
          {act("incident", "ساخت رخداد برای گروه", <Siren {...ICON14} />, !!g.incident_id)}
          <Tooltip title="باز کردن">
            <Button size="small" type="text" onClick={(e) => (e.stopPropagation(), p.onOpen())} aria-label="باز کردن گروه">
              {g.number}
            </Button>
          </Tooltip>
        </span>
      </div>
    );
  }
  const a = r.alert;
  return (
    <div id={`ev-r-${a.id}`} data-i={p.i} className="ev-row" data-kind="alert" data-child={!!r.groupId} data-sev={a.severity} role="option" aria-selected={p.active} tabIndex={-1} onClick={p.onFocus} onDoubleClick={p.onOpen}>
      <span className="ev-check" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={p.checked} onChange={(e) => p.onCheck(e.target.checked)} aria-label={`انتخاب ${a.number ?? ""}`} />
      </span>
      <span className="ev-sev">
        <Chip tone={severityTone(a.severity)}>{severityLabel(a.severity)}</Chip>
      </span>
      <div className="ev-title">
        <span className="t" title={a.short_description}>
          {a.symptom ? <span className="me-1 text-ink-3">نشانه ←</span> : null}
          {a.short_description}
        </span>
        <span className="m">
          <span className="ds-num ltr">{a.number}</span>
          <span>{stateLabel(a.state)}</span>
          {a.node ? <span className="ltr">{a.node}</span> : null}
          {a.ci_id ? <span>{p.display(a.ci_id)}</span> : null}
          <span>{seenLine(a)}</span>
          {a.assigned_to ? <span>مسئول: {p.display(a.assigned_to)}</span> : null}
          {a.escalation_state === "running" ? <span className="text-warning">ارتقا: سطح {fa(Number(a.escalation_level) || 1)}</span> : a.escalation_state && a.escalation_state !== "none" ? <span>{escalationLabel(a.escalation_state)}</span> : null}
          {a.noise_label && a.noise_label !== "signal" ? <span className="text-ink-3">نویز</span> : null}
        </span>
      </div>
      <span className="ev-acts">
        {act("ack", "تأیید (A)", <Check {...ICON14} />, !a.can_respond || !canAck(a.state))}
        {act("take", "برعهده گرفتن (S)", <Hand {...ICON14} />, !a.can_respond)}
        {act("assign", "واگذاری به همکار (W)", <UserPlus {...ICON14} />, !a.can_respond || ["cleared", "closed", "suppressed"].includes(a.state))}
        {act("snooze", "تعویق یک ساعته (Z)", <Clock {...ICON14} />, !a.can_respond || !["open", "acknowledged", "flapping"].includes(a.state))}
        {act("incident", "ساخت رخداد (I)", <Siren {...ICON14} />, !a.can_respond || !!a.incident_id)}
        {act("close", "بستن (C)", <X {...ICON14} />, !a.can_respond)}
      </span>
    </div>
  );
}

function GroupInsight({ id, title }: { id: string; title: string }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const causes = useQuery({ queryKey: EVENT_KEYS.causes(orgId, id), queryFn: () => eventApi.causes(api, id), staleTime: 30_000 });
  const [ai, setAi] = useState<AiAnswer | null>(null);
  const [loading, setLoading] = useState<"summary" | "causes" | null>(null);
  useEffect(() => setAi(null), [id]);
  const ask = async (kind: "summary" | "causes") => {
    setLoading(kind);
    try {
      setAi(kind === "summary" ? await eventApi.aiSummary(api, id) : await eventApi.aiCauses(api, id));
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setLoading(null);
    }
  };
  return (
    <Card
      title="بینش گروه"
      tools={
        <Space size={4}>
          <Button size="small" icon={<Sparkles {...ICON14} />} loading={loading === "summary"} onClick={() => ask("summary")}>
            خلاصه
          </Button>
          <Button size="small" loading={loading === "causes"} onClick={() => ask("causes")}>
            علت‌ها
          </Button>
        </Space>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-medium">{title}</div>
        {ai ? (
          <>
            <div className="ev-md">{ai.text}</div>
            <div className="text-[11.5px] text-ink-3">{ai.ai ? `ساخته‌شده با هوش مصنوعی${ai.model ? ` (${ai.model})` : ""} — پیش از استفاده بازبینی کنید` : ai.label}</div>
          </>
        ) : causes.isLoading ? (
          <Loader />
        ) : causes.data ? (
          <div className="ev-md">{causes.data.hints}</div>
        ) : null}
      </div>
    </Card>
  );
}
