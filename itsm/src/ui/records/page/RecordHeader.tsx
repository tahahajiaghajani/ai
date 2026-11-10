// The record header: back, the display value as the title, the number, the state, priority, assignee and group,
// SLA timers (meta.sla: time left, coloured by the share used; announced only when a threshold is crossed), who
// else has the record open (meta.viewers), the allowed transitions as buttons, «ویرایش» and a «بیشتر» menu (copy
// link, watch, print, delete, the module's own actions).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { Pencil, Ellipsis, Link2, Eye, EyeOff, Printer, Trash2, Timer, Users, Save, X } from "lucide-react";
import { formatJalaliDateTime } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { PageHeader } from "../../components/layout";
import { Chip } from "../../components/display";
import { cx } from "../../components/blocks";
import { useMe } from "../data/hooks";
import { fieldOf, optionOf, stateOf, valuesOf, type Schema } from "../model/schema";
import { slaText, slaTimers, otherViewers, viewersText, type SlaTimer } from "../model/sla";
import { slaTone } from "../model/colors";
import { relTime } from "../model/activity";
import type { DisplayMap, RecordMeta, RecordRow, RecordTransition, TableMeta } from "../model/types";
import type { MoreAction, RecordContext } from "../extensions";
import { ChoiceTag, RecordNo, UserChip, FieldValue } from "../fields/display";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const VISIBLE_TRANSITIONS = 3;

export interface RecordHeaderProps {
  def: TableMeta;
  schema: Schema;
  row: RecordRow | null;
  display: DisplayMap;
  meta: RecordMeta | null;
  mode: "view" | "edit" | "create";
  title: string;
  saving: boolean;
  dirty: boolean;
  backTo: string;
  ctx: RecordContext | null;
  moreActions: MoreAction[];
  extraActions?: ReactNode;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onTransition: (t: RecordTransition) => void;
  onCopyLink: () => void;
  onWatch: (on: boolean) => void;
  onPrint: () => void;
  onDelete: () => void;
}

export function RecordHeader(p: RecordHeaderProps) {
  const { def, schema, row, display, meta, mode } = p;
  const { userId, tz } = useMe();
  const transitions = meta?.transitions ?? [];
  const shown = transitions.slice(0, VISIBLE_TRANSITIONS);
  const rest = transitions.slice(VISIBLE_TRANSITIONS);
  const items: MenuProps["items"] = [
    ...rest.map((t) => ({ key: `t:${t.to}`, label: t.label })),
    ...(rest.length ? [{ type: "divider" as const }] : []),
    { key: "copy", icon: <Link2 {...I16} />, label: "رونوشت پیوند" },
    ...(def.features?.watchers && meta ? [{ key: "watch", icon: meta.watching ? <EyeOff {...I16} /> : <Eye {...I16} />, label: meta.watching ? "دیگر پیگیری نمی‌کنم" : "پیگیری می‌کنم" }] : []),
    { key: "print", icon: <Printer {...I16} />, label: "چاپ" },
    ...p.moreActions.filter((a) => !p.ctx || !a.when || a.when(p.ctx)).map((a) => ({ key: `x:${a.key}`, label: a.label, danger: a.danger })),
    ...(meta?.canDelete ? [{ type: "divider" as const }, { key: "delete", icon: <Trash2 {...I16} />, label: "حذف", danger: true }] : []),
  ];
  const onMenu = ({ key }: { key: string }) => {
    if (key.startsWith("t:")) {
      const t = transitions.find((x) => `t:${x.to}` === key);
      if (t) p.onTransition(t);
    } else if (key === "copy") p.onCopyLink();
    else if (key === "watch") p.onWatch(!meta?.watching);
    else if (key === "print") p.onPrint();
    else if (key === "delete") p.onDelete();
    else if (key.startsWith("x:") && p.ctx) void p.moreActions.find((a) => `x:${a.key}` === key)?.run(p.ctx);
  };

  const actions =
    mode === "view" ? (
      <>
        {p.extraActions}
        {shown.map((t) => (
          <Button key={t.to} onClick={() => p.onTransition(t)} disabled={p.saving}>
            {t.label}
          </Button>
        ))}
        {meta?.canWrite && !meta.locked ? (
          <Tooltip title="ویرایش همهٔ فیلدها">
            <Button icon={<Pencil {...I16} />} onClick={p.onEdit} aria-label="ویرایش">
              ویرایش
            </Button>
          </Tooltip>
        ) : null}
        <Dropdown trigger={["click"]} rootClassName="ds-glass" menu={{ items, onClick: onMenu }}>
          <Button icon={<Ellipsis {...I16} />} aria-label="بیشتر" />
        </Dropdown>
      </>
    ) : (
      <>
        <Button icon={<X {...I16} />} onClick={p.onCancel} disabled={p.saving}>
          انصراف
        </Button>
        <Tooltip title="Alt+S">
          <Button type="primary" icon={<Save {...I16} />} onClick={p.onSave} loading={p.saving} disabled={mode === "edit" && !p.dirty}>
            {mode === "create" ? "ثبت" : "ذخیره"}
          </Button>
        </Tooltip>
      </>
    );

  const stateF = def.states ? fieldOf(def, def.states.field) : undefined;
  const st = row && def.states ? stateOf(def, row[def.states.field]) : undefined;
  const priorityF = fieldOf(def, "priority");
  const assignee = fieldOf(def, "assigned_to");
  const groupF = def.scope?.group ? fieldOf(def, def.scope.group) : fieldOf(def, "assignment_group_id");
  const watchers = valuesOf(row?.[def.scope?.watchers ?? "watch_list"]);
  const viewers = otherViewers(meta?.viewers, userId, display);

  return (
    <div className="rk-rh">
      <PageHeader
        back={p.backTo}
        title={p.title}
        subtitle={
          row ? (
            <span className="rk-rh-sub">
              <RecordNo no={row.number ? String(row.number) : null} />
              {row.updated_at ? (
                <span title={formatJalaliDateTime(String(row.updated_at), tz)}>آخرین تغییر {relTime(String(row.updated_at), Date.now(), tz)}</span>
              ) : null}
            </span>
          ) : undefined
        }
        actions={actions}
      />
      {row && mode !== "create" ? (
        <div className="rk-rh-meta" aria-label="خلاصهٔ رکورد">
          {stateF && st ? <ChoiceTag option={optionOf(stateF, schema.choices, st.value) ?? { value: st.value, label: st.label, color: st.color }} strong /> : null}
          {meta?.locked ? <Chip tone="neutral">بسته؛ فقط تغییر وضعیت</Chip> : null}
          {priorityF && row.priority ? (
            <span className="rk-rh-f" title={priorityF.label}>
              <span className="rk-rh-k">{priorityF.label}</span>
              <FieldValue field={priorityF} value={row.priority} table={def.key} schema={schema} />
            </span>
          ) : null}
          {assignee ? (
            <span className="rk-rh-f" title={assignee.label}>
              <span className="rk-rh-k">{assignee.label}</span>
              {row.assigned_to ? <UserChip id={String(row.assigned_to)} display={display} me={userId} /> : <span className="text-ink-3">واگذار نشده</span>}
            </span>
          ) : null}
          {groupF && row[groupF.name] ? (
            <span className="rk-rh-f" title={groupF.label}>
              <span className="rk-rh-k">{groupF.label}</span>
              <FieldValue field={groupF} value={row[groupF.name]} table={def.key} schema={schema} display={display} />
            </span>
          ) : null}
          {watchers.length ? (
            <span className="rk-rh-f" title="پیگیری‌کنندگان">
              <Users {...I14} className="text-ink-3" aria-hidden />
              <span className="ds-num">{faDigits(watchers.length)}</span>
            </span>
          ) : null}
          <SlaChips raw={meta?.sla} />
        </div>
      ) : null}
      {viewers.length ? (
        <p className={cx("rk-viewers", viewers.some((v) => v.typing) && "is-typing")} role="status">
          <span className="rk-viewers-av" aria-hidden>
            {viewers.slice(0, 3).map((v) => (
              <UserChip key={v.id} name={v.name} compact />
            ))}
          </span>
          {viewersText(viewers)}
        </p>
      ) : null}
    </div>
  );
}

/** SLA timers: time left (or past), the tone from the share used; screen readers hear a change of tone only. */
export function SlaChips({ raw }: { raw: unknown }) {
  const [now, setNow] = useState(Date.now());
  const timers = useMemo(() => slaTimers(raw, now), [raw, now]);
  useEffect(() => {
    if (!timers.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [timers.length]);
  const tones = timers.map((t) => toneOf(t)).join(",");
  const last = useRef(tones);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (last.current !== tones) {
      last.current = tones;
      const hot = timers.find((t) => toneOf(t) === "danger" || toneOf(t) === "warning");
      if (hot) setSaid(`${hot.label}: ${slaText(hot)}`);
    }
  }, [tones, timers]);
  if (!timers.length) return null;
  return (
    <span className="rk-sla">
      {timers.map((t) => (
        <Tooltip key={t.key} title={t.dueAt ? `موعد: ${formatJalaliDateTime(new Date(t.dueAt).toISOString())}` : undefined}>
          <span role="timer" aria-label={`${t.label}: ${slaText(t)}`}>
            <Chip tone={toneOf(t)} fig>
              <Timer {...I14} aria-hidden /> {t.label}: {slaText(t)}
            </Chip>
          </span>
        </Tooltip>
      ))}
      <span className="ds-sr" aria-live="polite">
        {said}
      </span>
    </span>
  );
}

const toneOf = (t: SlaTimer) => (t.met ? "in" : t.paused ? "neutral" : slaTone(Number.isNaN(t.used) ? (t.breached ? 1 : 0) : t.used, t.breached));
