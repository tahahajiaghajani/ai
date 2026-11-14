// Pieces the data-source screens share (design A §15): a kind's icon and name, a connector's state chip, the
// connector form by kind (the records kit's form with the fields this kind uses — secrets through the kit's
// write-only secret box, never shown), «آزمودن اتصال»'s result line, the preview table and the passes table.
import "../../records/records.css";
import "./discovery.css";
import { useMemo, useState, type ReactNode } from "react";
import { Segmented, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Activity, Braces, CloudUpload, FileSpreadsheet, FlaskConical, Gauge, Radar, ServerCog, type LucideIcon } from "lucide-react";
import type { FieldDef, Option } from "@shared/model/types";
import { AUTH_OPTIONS, RUN_TRIGGERS, type KindDescriptor } from "@shared/discovery/types";
import { Chip, EmptyState, JDateTime, Skeleton } from "../../components/display";
import { Note, cx } from "../../components/blocks";
import { DataTable, ServerTable } from "../../components/data";
import { RecordForm } from "../../records/page/RecordForm";
import type { LayoutSection } from "../../records/model/layout";
import { relTime } from "../../records/model/activity";
import { useMe, useTableDef } from "../../records/data/hooks";
import type { DisplayMap } from "../../records/model/types";
import { fa } from "../../lib/fa";
import type { DiscoveryMeta, PreviewResult, PreviewRow, TestResult } from "./api";
import {
  OPT, PREVIEW_ACTIONS, collectChoices, connectorState, durationText, labelOf, optionField, requiredFields, testSummary, toneOf, type ConnectorCard, type Rights, type RunInfo, type Values,
} from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** The kit's icons for the kept kinds' icon names (never a tool's logo, §15). */
const KIND_ICONS: Record<string, LucideIcon> = { activity: Activity, gauge: Gauge, "server-cog": ServerCog, "file-spreadsheet": FileSpreadsheet, braces: Braces, "cloud-upload": CloudUpload, "flask-conical": FlaskConical };

export function KindIcon({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  const Icon = (icon && KIND_ICONS[icon]) || Radar;
  return <Icon size={size} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />;
}

/** A kind's name: product names stay Latin, isolated from the Persian around them. */
export const KindName = ({ label }: { label: string }) => <bdi className="dsc-kind">{label}</bdi>;

/** The connector's state: a chip when it needs attention, plain text when all is well. */
export function ConnectorStateChip({ card, active }: { card: ConnectorCard | null; active?: boolean }) {
  const s = card ? connectorState(card) : { label: active === false ? "خاموش" : "فعال", tone: active === false ? ("neutral" as const) : null };
  return s.tone ? <Chip tone={s.tone}>{s.label}</Chip> : <span className="ds-status">{s.label}</span>;
}

/** «۱۰ دقیقه پیش», the Jalali date and time in the tooltip. */
export function Ago({ at, tz }: { at: string | null | undefined; tz: string }) {
  if (!at) return <span className="ds-zero">—</span>;
  return (
    <Tooltip title={<JDateTime v={at} />}>
      <span>{relTime(at, Date.now(), tz)}</span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- the connector form

export interface ConnectorFormProps {
  d: KindDescriptor;
  /** field names in order: the table's fields and the kind's options as `opt.<key>` */
  fields: string[];
  values: Values;
  /** the stored values (the settings tab), for what a save keeps (a stored key) */
  before?: Values;
  editable: ReadonlySet<string>;
  errors: Record<string, string>;
  display?: DisplayMap;
  rights: Pick<Rights, "softwareManager">;
  onChange: (field: string, value: unknown) => void;
  /** the table's sections (settings) or one section (a wizard step) */
  sectioned?: boolean;
  /** read-only view (a reader of the module) */
  view?: boolean;
  idPrefix: string;
}

/** A connector's fields by kind, in the records kit's form (labels, help, the kit's inputs and its secret box). */
export function ConnectorForm(p: ConnectorFormProps) {
  const { def, schema } = useTableDef("discovery_connector");
  const { userId, tz } = useMe();
  const sections = useMemo<LayoutSection[]>(() => {
    if (!def) return [];
    const byName = new Map(def.fields.map((f) => [f.name, f]));
    const fieldOf = (name: string): FieldDef | undefined => {
      if (name.startsWith(OPT)) {
        const o = p.d.options.find((x) => `${OPT}${x.key}` === name);
        return o ? { ...optionField(o), section: "چه بیاید" } : undefined;
      }
      const f = byName.get(name);
      if (!f) return undefined;
      // the choices this kind offers: its ways in, what it can bring in
      if (name === "auth") return { ...f, choices: AUTH_OPTIONS.filter((o) => p.d.auth.includes(o.value as never)) };
      if (name === "collect") return { ...f, choices: collectChoices(p.d, p.rights) };
      return f;
    };
    const defs = p.fields.map(fieldOf).filter((f): f is FieldDef => !!f);
    if (!p.sectioned) return [{ key: "main", label: null, fields: defs }];
    const order = def.form?.sections ?? [];
    const groups = new Map<string, FieldDef[]>();
    for (const f of defs) {
      const s = f.section ?? "";
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(f);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
      .map(([label, fields]) => ({ key: label || "main", label: label || null, fields }));
  }, [def, p.d, p.fields, p.sectioned, p.rights]);
  if (!def || !schema) return <Skeleton rows={6} />;
  const required = requiredFields(p.d, p.values, p.fields, p.before);
  const state = {
    hidden: new Set<string>(),
    required: new Set([...required].filter((f) => p.editable.has(f))),
    readonly: new Set(p.fields.filter((f) => !p.editable.has(f))),
    waiting: new Map<string, string>(),
    messages: [],
  };
  return (
    <RecordForm
      def={def}
      schema={schema}
      sections={sections}
      values={p.values}
      state={state}
      mode={p.view ? "view" : "edit"}
      errors={p.errors}
      display={p.display ?? {}}
      me={userId}
      tz={tz}
      onChange={p.onChange}
      idPrefix={p.idPrefix}
    />
  );
}

// ---------------------------------------------------------------- «آزمودن اتصال»

/** The result line: the tool's version and who the connector is there, or the Persian cause; warnings below. */
export function TestResultNote({ result }: { result: TestResult }) {
  const s = testSummary(result);
  return (
    <Note tone={s.tone} className="dsc-test">
      <div className="dsc-test-b" role="status">
        <span className="dsc-test-t">{s.title}</span>
        {s.version ? (
          <span>
            {" · نسخهٔ "}
            <bdi dir="ltr" className="ds-latin">
              {s.version}
            </bdi>
          </span>
        ) : null}
        {s.identity ? (
          <span>
            {" · "}
            <bdi>{s.identity}</bdi>
          </span>
        ) : null}
        {s.warnings.length ? (
          <ul className="dsc-list">
            {s.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Note>
  );
}

// ---------------------------------------------------------------- «پیش‌نمایش»

/** The mapped values worth a glance in a previewed row (the rest are in the tool's JSON for tenant administrators). */
const KEY_VALUES = ["hostname", "fqdn", "ip_address", "serial_number", "manufacturer", "model_name", "os", "os_version"];

/** Twenty rows of mapped fields with what the engine would do with each (a dry run: nothing is saved, §7.5). */
export function PreviewTable({ result, label, classLabel }: { result: PreviewResult; label: (field: string) => string; classLabel: (key: string) => string }) {
  const [shown, setShown] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const r of result.rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
  const raw = result.rows.some((r) => r.raw !== undefined);
  const columns: ColumnsType<PreviewRow & { key: string }> = [
    {
      title: "مورد",
      key: "name",
      render: (_, r) => (
        <div className="dsc-cell">
          <span className="dsc-strong">{r.name || "—"}</span>
          {r.external_id ? (
            <bdi dir="ltr" className="ds-mono dsc-sub">
              {r.external_id}
            </bdi>
          ) : null}
        </div>
      ),
    },
    { title: "کلاس", key: "class", render: (_, r) => (r.class ? classLabel(r.class) : <span className="ds-zero">—</span>) },
    {
      title: "نتیجه",
      key: "action",
      render: (_, r) => {
        const a = PREVIEW_ACTIONS[r.action] ?? { label: r.action, tone: "neutral" as const };
        return (
          <div className="dsc-cell">
            <Chip tone={a.tone}>{a.label}</Chip>
            {r.message ? <span className="dsc-sub">{r.message}</span> : null}
          </div>
        );
      },
    },
    {
      title: "مقدارها",
      key: "values",
      render: (_, r) => {
        const pairs = KEY_VALUES.filter((k) => r.values[k] !== undefined && r.values[k] !== null && r.values[k] !== "").slice(0, 4);
        if (!pairs.length) return <span className="ds-zero">—</span>;
        return (
          <dl className="dsc-pairs">
            {pairs.map((k) => (
              <div key={k}>
                <dt>{label(k)}</dt>
                <dd>
                  <bdi dir="ltr" className="ds-mono">
                    {Array.isArray(r.values[k]) ? (r.values[k] as unknown[]).join("، ") : String(r.values[k])}
                  </bdi>
                </dd>
              </div>
            ))}
          </dl>
        );
      },
    },
  ];
  const rows = result.rows.map((r, i) => ({ ...r, key: `${i}:${r.external_id}` }));
  return (
    <div className="dsc-preview">
      <p className="dsc-meta">
        {result.total !== undefined ? `${fa(rows.length)} ردیف نخست از ${fa(result.total)}` : `${fa(rows.length)} ردیف نخست`}
        {[...counts.entries()].map(([k, n]) => ` · ${fa(n)} ${PREVIEW_ACTIONS[k]?.label ?? k}`).join("")}
      </p>
      <DataTable
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={columns}
        expandable={
          raw
            ? {
                expandedRowKeys: shown ? [shown] : [],
                onExpand: (open, r) => setShown(open ? r.key : null),
                rowExpandable: (r) => r.raw !== undefined,
                expandedRowRender: (r) => (
                  <pre dir="ltr" className="dsc-raw" aria-label="دادهٔ خام ابزار">
                    {JSON.stringify(r.raw, null, 2)}
                  </pre>
                ),
              }
            : undefined
        }
        locale={{ emptyText: <EmptyState compact title="ابزار در صفحهٔ نخست موردی نفرستاد" /> }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- the passes

/** A pass's notes: its error, else its warnings (a held drop first). */
function runNote(r: RunInfo): ReactNode {
  if (r.error) return <span className="dsc-sub dsc-clamp">{r.error}</span>;
  const w = r.warnings ?? [];
  const drop = w.find((x) => x.code === "mass_drop");
  if (drop) return <Chip tone={drop.accepted ? "neutral" : "warning"}>{drop.accepted ? "کاهش پذیرفته شد" : "کاهش نگه داشته شد"}</Chip>;
  return w.length ? <span className="dsc-sub dsc-clamp">{w[0].message}</span> : null;
}

const count = (v: unknown) => <span className="ds-num">{fa(Number(v ?? 0))}</span>;

/** A connector's passes, newest first, by lane («فهرست»، «وضعیت»، «ارسال»، «پیش‌نمایش»). */
export function RunsTable({ connectorId, meta, tz }: { connectorId: string; meta: DiscoveryMeta | undefined; tz: string }) {
  const [lane, setLane] = useState<string>("");
  const lanes: Option[] = meta?.words.run_lanes ?? [];
  const states = meta?.words.run_states ?? [];
  const columns: ColumnsType<RunInfo & { duration_ms?: number | null }> = [
    { title: "آغاز", key: "started_at", render: (_, r) => <Ago at={r.started_at} tz={tz} /> },
    { title: "گذر", key: "lane", render: (_, r) => labelOf(lanes, r.lane) },
    { title: "سبب", key: "trigger", render: (_, r) => (r.trigger ? labelOf(RUN_TRIGGERS, r.trigger) : <span className="ds-zero">—</span>) },
    {
      title: "وضعیت",
      key: "state",
      render: (_, r) => {
        const o = states.find((s) => s.value === r.state);
        return r.state === "completed" ? <span className="ds-status">{o?.label ?? "انجام شد"}</span> : <Chip tone={toneOf(o?.color)}>{o?.label ?? r.state ?? "—"}</Chip>;
      },
    },
    { title: "مدت", key: "duration", render: (_, r) => (r.duration_ms ? durationText(r.duration_ms) : <span className="ds-zero">—</span>) },
    { title: "خوانده‌شده", key: "fetched", className: "ds-num", render: (_, r) => count(r.fetched) },
    { title: "ساخته‌شده", key: "created", className: "ds-num", render: (_, r) => count(r.created) },
    { title: "به‌روزشده", key: "updated", className: "ds-num", render: (_, r) => count(r.updated) },
    { title: "بی‌همتا", key: "unmatched", className: "ds-num", render: (_, r) => count(r.unmatched) },
    { title: "ناموفق", key: "failed", className: "ds-num", render: (_, r) => count(r.failed) },
    { title: "یادداشت", key: "note", render: (_, r) => runNote(r) ?? <span className="ds-zero">—</span> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        className="dsc-lanes"
        aria-label="گذر"
        value={lane}
        onChange={(v) => setLane(String(v))}
        options={[{ value: "", label: "همه" }, ...lanes.map((o) => ({ value: o.value, label: o.label }))]}
      />
      <ServerTable<RunInfo & { duration_ms?: number | null }>
        path={`/discovery/connectors/${connectorId}/runs`}
        params={{ lane: lane || undefined }}
        queryKey={["discovery-runs", connectorId]}
        columns={columns}
        pageSize={25}
        empty={<EmptyState compact title="هنوز گذری اجرا نشده است" />}
      />
    </div>
  );
}

/** Small helper: a «— یا مقدار» cell. */
export const orDash = (v: ReactNode) => (v === null || v === undefined || v === "" ? <span className="ds-zero">—</span> : v);

export { cx, I16 };
