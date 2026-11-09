// «حاکمیت هوش مصنوعی» (catalogue AI-153/165/166/168/169/172/175/179; docs/spec/AI.md §14), for AI administrators: what AI
// does in the organisation and how well, what it costs, what people thought of it, what it refused, where each table's
// data may go, who stays in the loop, model cards and the audit export. Counts and configuration only — no record
// content, no one's private output.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, InputNumber, Segmented, Select, Switch, Table, Tag } from "antd";
import { Download, RefreshCw } from "lucide-react";
import type { DataPolicyRow, ModelCard } from "@shared/ai/governance";
import { ML_KIND_LABELS, ML_SCHEDULE_LABELS, ML_STATUS_LABELS, type MlModelView } from "@shared/ai/ml";
import { faDigits } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { Card, ICON14 } from "../../components/blocks";
import { EmptyState, Skeleton, StatCard } from "../../components/display";
import { govApi, ML_KEYS, mlApi } from "../ml/api";
import { pctFa } from "../ml/model";
import "./governance.css";

const SECTIONS = [
  { value: "overview", label: "نمای کلی" },
  { value: "models", label: "مدل‌های پیش‌بین" },
  { value: "usage", label: "مصرف و هزینه" },
  { value: "quality", label: "کیفیت و ارزیابی" },
  { value: "feedback", label: "بازخورد" },
  { value: "policy", label: "سیاست داده" },
  { value: "oversight", label: "نظارت انسانی" },
  { value: "guard", label: "امتناع‌ها" },
  { value: "cards", label: "شناسنامه‌ها" },
] as const;

type Section = (typeof SECTIONS)[number]["value"];

const num = (v: number | null | undefined) => <span className="ds-num">{v === null || v === undefined ? "—" : faDigits(v)}</span>;
const usd = (v: string) => <span className="ds-num ds-ltr">${faDigits(v)}</span>;

function Overview() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "overview"), queryFn: () => govApi.overview(api) });
  const o = q.data;
  if (!o) return <Skeleton rows={6} />;
  const local = o.connections.filter((c) => c.local).length;
  return (
    <div className="gv-stack">
      <div className="gv-stats">
        <StatCard title="هوش مصنوعی" value={o.disabled_by_platform ? "خاموش از سوی سامانه" : o.enabled ? "روشن" : "خاموش"} />
        <StatCard title="پوشاندن داده" value={{ masked: "شناسه‌ها", aggregates: "شناسه‌ها و نام‌ها", full: "بدون پوشاندن" }[o.data_policy]} />
        <StatCard title="اتصال‌ها" value={`${faDigits(o.connections.length)} (${faDigits(local)} محلی)`} />
        <StatCard title="دستیار سرویس" value={o.principal.set ? `${faDigits(o.principal.roles.length)} نقش` : "تنظیم نشده"} />
      </div>
      <Card title="قابلیت‌ها">
        <ul className="gv-list">
          {o.features.map((f) => (
            <li key={f.key}>
              <Tag color={f.on ? "green" : "default"}>{f.on ? "روشن" : "خاموش"}</Tag> {f.label}
              {f.labels.length ? <span className="gv-muted ds-ltr"> {f.labels.slice(0, 6).join(" · ")}</span> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="مهارت‌ها (۳۰ روز)" flush>
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          dataSource={o.skills}
          columns={[
            { title: "مهارت", dataIndex: "name" },
            { title: "فعال", dataIndex: "enabled", render: (v: boolean) => (v ? "بله" : "خیر") },
            { title: "اجرا", dataIndex: "runs_30d", align: "end", render: num },
            { title: "خطا", dataIndex: "errors_30d", align: "end", render: num },
            { title: "👍", dataIndex: "up", align: "end", render: num },
            { title: "👎", dataIndex: "down", align: "end", render: num },
            { title: "اعمال خودکار", dataIndex: "auto_apply", render: (v: string[]) => (v.length ? v.join("، ") : "—") },
          ]}
        />
      </Card>
      <Card title="عامل‌ها" flush>
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={o.agents}
          locale={{ emptyText: "عاملی تعریف نشده است" }}
          columns={[
            { title: "عامل", dataIndex: "name" },
            { title: "فعال", dataIndex: "enabled", render: (v: boolean) => (v ? "بله" : "خیر") },
            { title: "اختیار عمل", dataIndex: "autonomy" },
            { title: "هویت", dataIndex: "principal", render: (v: boolean) => (v ? "دارد" : "ندارد") },
            { title: "اجرا", dataIndex: "runs_30d", align: "end", render: num },
            { title: "ناموفق", dataIndex: "failed_30d", align: "end", render: num },
          ]}
        />
      </Card>
      {o.capabilities.length ? <p className="gv-muted ds-ltr">{o.capabilities.join(" · ")}</p> : null}
    </div>
  );
}

function metricsOf(m: MlModelView): string {
  const x = (m.metrics ?? {}) as Record<string, number | null>;
  if (m.kind === "classifier") return x.accuracy === undefined ? "—" : `دقت ${pctFa(x.accuracy)} · F1 ${pctFa(x.macro_f1)}`;
  if (m.kind === "risk") return x.auc === undefined ? "—" : `AUC ${faDigits(Math.round((x.auc ?? 0) * 100) / 100)} · مهارت ${pctFa(x.skill)}`;
  if (m.kind === "cluster") return x.clusters === undefined ? "—" : `${faDigits(x.clusters ?? 0)} خوشه از ${faDigits(x.points ?? 0)}`;
  return "—";
}

function Models() {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ML_KEYS.models(orgId), queryFn: () => mlApi.models(api) });
  const patch = async (key: string, p: Parameters<typeof mlApi.patchModel>[2]) => {
    try {
      await mlApi.patchModel(api, key, p);
      await qc.invalidateQueries({ queryKey: ML_KEYS.models(orgId) });
    } catch (e) {
      n.error(e);
    }
  };
  const train = async (key: string) => {
    try {
      await mlApi.trainModel(api, key);
      n.ok("آموزش در صف قرار گرفت");
    } catch (e) {
      n.error(e);
    }
  };
  if (!q.data) return <Skeleton rows={6} />;
  return (
    <Card flush>
      <Table
        size="small"
        rowKey="key"
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        dataSource={q.data.models}
        scroll={{ x: 1100 }}
        expandable={{
          rowExpandable: (m) => m.history.length > 0 || !!m.last_error,
          expandedRowRender: (m) => (
            <div className="gv-expand">
              {m.last_error ? <p className="gv-warn">{m.last_error}</p> : null}
              {m.history.length ? (
                <table className="gv-history">
                  <thead>
                    <tr>
                      <th>نسخه</th>
                      <th>زمان</th>
                      <th>نمونه</th>
                      <th>شاخص‌ها</th>
                      <th>بهتر از خط پایه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...m.history].reverse().map((h) => (
                      <tr key={h.version}>
                        <td className="ds-num">{faDigits(h.version)}</td>
                        <td>{formatJalaliDateTime(h.trained_at)}</td>
                        <td className="ds-num">{faDigits(h.rows)}</td>
                        <td className="ds-ltr">
                          {Object.entries(h.summary)
                            .map(([k, v]) => `${k}: ${v === null ? "—" : faDigits(Math.round(v * 1000) / 1000)}`)
                            .join(" · ")}
                        </td>
                        <td>{h.beats ? "بله" : "خیر"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ),
        }}
        columns={[
          { title: "مدل", dataIndex: "name", render: (v: string, m) => <span title={m.key}>{v}</span> },
          { title: "نوع", dataIndex: "kind", render: (v: MlModelView["kind"]) => ML_KIND_LABELS[v] },
          { title: "وضعیت", dataIndex: "status", render: (v: MlModelView["status"], m) => <Tag color={v === "ready" ? "green" : v === "failed" ? "red" : v === "below_baseline" ? "orange" : "default"}>{ML_STATUS_LABELS[v]}{m.version ? ` · ن${faDigits(m.version)}` : ""}</Tag> },
          { title: "کیفیت", key: "metrics", render: (_: unknown, m) => metricsOf(m) },
          { title: "آموزش", dataIndex: "trained_at", render: (v: string | null, m) => (v ? `${formatJalali(v.slice(0, 10))} (${faDigits(m.training_rows)} نمونه)` : "—") },
          { title: "نمایش از", dataIndex: "threshold_show", render: (v: number, m) => <InputNumber size="small" min={5} max={99} value={Math.round(v * 100)} suffix="٪" onChange={(x) => x !== null && void patch(m.key, { threshold_show: Number(x) / 100 })} style={{ inlineSize: 88 }} aria-label="آستانهٔ نمایش" /> },
          {
            title: "اعمال خودکار از",
            dataIndex: "threshold_apply",
            render: (v: number | null, m) =>
              m.kind === "classifier" ? (
                <InputNumber size="small" min={50} max={99} value={v === null ? null : Math.round(v * 100)} placeholder="هرگز" suffix="٪" onChange={(x) => void patch(m.key, { threshold_apply: x === null ? null : Number(x) / 100 })} style={{ inlineSize: 96 }} aria-label="آستانهٔ اعمال خودکار" />
              ) : (
                "—"
              ),
          },
          { title: "زمان‌بندی", dataIndex: "schedule", render: (v: MlModelView["schedule"], m) => <Select size="small" value={v} onChange={(x) => void patch(m.key, { schedule: x })} options={Object.entries(ML_SCHEDULE_LABELS).map(([value, label]) => ({ value, label }))} style={{ minInlineSize: 90 }} /> },
          { title: "پذیرش", key: "acc", render: (_: unknown, m) => (m.predictions.outcome ? `${pctFa(m.predictions.agreed / Math.max(1, m.predictions.outcome))} درست` : `${faDigits(m.predictions.applied + m.predictions.auto_applied)} اعمال`) },
          { title: "فعال", dataIndex: "enabled", render: (v: boolean, m) => <Switch size="small" checked={v} onChange={(x) => void patch(m.key, { enabled: x })} /> },
          { title: "", key: "train", render: (_: unknown, m) => <Button size="small" icon={<RefreshCw {...ICON14} />} onClick={() => void train(m.key)} aria-label="آموزش دوباره" /> },
        ]}
      />
    </Card>
  );
}

function Usage() {
  const { api, orgId } = useOrg();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "usage", days), queryFn: () => govApi.usage(api, days) });
  const u = q.data;
  return (
    <div className="gv-stack">
      <Segmented size="small" value={days} onChange={(v) => setDays(Number(v))} options={[7, 30, 90].map((d) => ({ value: d, label: `${faDigits(d)} روز` }))} />
      {!u ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <div className="gv-stats">
            <StatCard title="هزینهٔ دوره" value={`$${faDigits(u.total_cost_usd)}`} />
            <StatCard title="فراخوانی‌ها" value={faDigits(u.by_feature.reduce((a, f) => a + f.calls, 0))} />
            <StatCard title="خطاها" value={faDigits(u.by_feature.reduce((a, f) => a + f.errors, 0))} />
          </div>
          <Card title="بر پایهٔ قابلیت" flush>
            <Table
              size="small"
              rowKey="feature"
              pagination={{ pageSize: 12, hideOnSinglePage: true }}
              dataSource={u.by_feature}
              columns={[
                { title: "قابلیت", dataIndex: "feature", render: (v: string) => <span className="ds-ltr">{v}</span> },
                { title: "فراخوانی", dataIndex: "calls", align: "end", render: num },
                { title: "خطا", dataIndex: "errors", align: "end", render: num },
                { title: "ورودی", dataIndex: "input", align: "end", render: num },
                { title: "خروجی", dataIndex: "output", align: "end", render: num },
                { title: "میانگین زمان (ms)", dataIndex: "avg_ms", align: "end", render: num },
                { title: "هزینه", dataIndex: "cost_usd", align: "end", render: usd },
              ]}
            />
          </Card>
          <Card title="بر پایهٔ مدل" flush>
            <Table size="small" rowKey={(r) => `${r.preset}:${r.model}`} pagination={false} dataSource={u.by_model} columns={[{ title: "مدل", dataIndex: "model", render: (v: string) => <span className="ds-ltr">{v}</span> }, { title: "فراخوانی", dataIndex: "calls", align: "end", render: num }, { title: "هزینه", dataIndex: "cost_usd", align: "end", render: usd }]} />
          </Card>
        </>
      )}
    </div>
  );
}

function Quality() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "quality"), queryFn: () => govApi.quality(api) });
  if (!q.data) return <Skeleton rows={5} />;
  return (
    <div className="gv-stack">
      <Card title="مجموعه‌های ارزیابی مهارت‌ها" flush>
        <Table
          size="small"
          rowKey={(r) => `${r.skill_key}:${r.name}`}
          pagination={false}
          dataSource={q.data.evals}
          locale={{ emptyText: "مجموعهٔ ارزیابی ثبت نشده است" }}
          columns={[
            { title: "مهارت", dataIndex: "skill_key", render: (v: string) => <span className="ds-ltr">{v}</span> },
            { title: "مجموعه", dataIndex: "name" },
            { title: "نمره", dataIndex: "score", align: "end", render: (v: number | null) => (v === null ? "—" : pctFa(v)) },
            { title: "مدل", dataIndex: "model", render: (v: string | null) => <span className="ds-ltr">{v ?? "—"}</span> },
            { title: "آخرین اجرا", dataIndex: "run_at", render: (v: string | null) => (v ? formatJalaliDateTime(v) : "—") },
          ]}
        />
      </Card>
      <Card title="شاخص‌های مدل‌های پیش‌بین در طول زمان" flush>
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={q.data.models.filter((m) => m.history.length)}
          locale={{ emptyText: "هنوز مدلی آموزش ندیده است" }}
          columns={[
            { title: "مدل", dataIndex: "name" },
            {
              title: "نسخه‌ها",
              key: "h",
              render: (_: unknown, m) => (
                <span className="ds-ltr gv-trend">
                  {m.history
                    .slice(-6)
                    .map((h) => faDigits(Math.round(((h.summary.accuracy ?? h.summary.auc ?? h.summary.clusters ?? 0) as number) * 100) / 100))
                    .join(" → ")}
                </span>
              ),
            },
            { title: "بهتر از خط پایه", dataIndex: "beats_baseline", render: (v: boolean) => (v ? "بله" : "خیر") },
          ]}
        />
      </Card>
    </div>
  );
}

function Feedback() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "feedback"), queryFn: () => govApi.feedback(api) });
  if (!q.data) return <Skeleton rows={5} />;
  return (
    <div className="gv-stack">
      <Card title="بازخورد مهارت‌ها (۹۰ روز)" flush>
        <Table
          size="small"
          rowKey="skill_key"
          pagination={false}
          dataSource={q.data.skills}
          locale={{ emptyText: "بازخوردی ثبت نشده است" }}
          columns={[
            { title: "مهارت", dataIndex: "skill_key", render: (v: string) => <span className="ds-ltr">{v}</span> },
            { title: "اجرا", dataIndex: "runs", align: "end", render: num },
            { title: "👍", dataIndex: "up", align: "end", render: num },
            { title: "👎", dataIndex: "down", align: "end", render: num },
            { title: "رضایت", key: "r", align: "end", render: (_: unknown, s) => (s.up + s.down ? pctFa(s.up / (s.up + s.down)) : "—") },
            { title: "با توضیح", dataIndex: "with_comment", align: "end", render: num },
          ]}
        />
      </Card>
      <Card title="سرنوشت پیش‌بینی‌ها" flush>
        <Table
          size="small"
          rowKey="model_key"
          pagination={false}
          dataSource={q.data.predictions}
          locale={{ emptyText: "پیش‌بینی‌ای ثبت نشده است" }}
          columns={[
            { title: "مدل", dataIndex: "name" },
            { title: "به کار رفت", dataIndex: "applied", align: "end", render: num },
            { title: "خودکار", dataIndex: "auto_applied", align: "end", render: num },
            { title: "رد شد", dataIndex: "dismissed", align: "end", render: num },
            { title: "درستی در عمل", key: "a", align: "end", render: (_: unknown, p) => (p.outcomes ? pctFa(p.agreed / p.outcomes) : "—") },
          ]}
        />
      </Card>
      <Card title="پیشنهادهای نوشتن">
        <ul className="gv-list">
          {q.data.proposals.map((p) => (
            <li key={p.status}>
              {p.status}: {num(p.n)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const USE_OPTIONS = [
  { value: "cloud", label: "مدل‌های ابری و محلی" },
  { value: "local", label: "فقط مدل‌های محلی" },
  { value: "never", label: "هرگز" },
];
const PII_OPTIONS = [
  { value: "inherit", label: "مطابق سیاست سازمان" },
  { value: "masked", label: "پوشاندن شناسه‌ها" },
  { value: "aggregates", label: "شناسه‌ها و نام‌ها" },
];

function Policy() {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "set" | "rag">("all");
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "policy"), queryFn: () => govApi.policies(api) });
  const save = async (r: DataPolicyRow, p: { use?: string; pii?: string }) => {
    try {
      await govApi.savePolicy(api, r.table, { use: p.use ?? r.use, pii: p.pii ?? r.pii, note: r.note });
      await qc.invalidateQueries({ queryKey: ML_KEYS.gov(orgId, "policy") });
      n.ok(`سیاست «${r.label}» ثبت شد`);
    } catch (e) {
      n.error(e);
    }
  };
  if (!q.data) return <Skeleton rows={6} />;
  const rows = q.data.tables.filter((t) => filter === "all" || (filter === "set" ? t.explicit : t.rag));
  return (
    <div className="gv-stack">
      <Segmented
        size="small"
        value={filter}
        onChange={(v) => setFilter(v as typeof filter)}
        options={[
          { value: "all", label: "همه" },
          { value: "set", label: "تعیین‌شده" },
          { value: "rag", label: "نمایه‌شده برای بازیابی" },
        ]}
      />
      <Card flush>
        <Table
          size="small"
          rowKey="table"
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          dataSource={rows}
          columns={[
            { title: "جدول", dataIndex: "label", render: (v: string, r) => <span title={r.table}>{v}</span> },
            { title: "بخش", dataIndex: "module", render: (v: string) => <span className="ds-ltr">{v}</span> },
            { title: "استفاده در مدل‌ها", dataIndex: "use", render: (v: string, r) => <Select size="small" value={v} options={USE_OPTIONS} onChange={(x) => void save(r, { use: x })} style={{ minInlineSize: 170 }} /> },
            { title: "پوشاندن دادهٔ شخصی", dataIndex: "pii", render: (v: string, r) => <Select size="small" value={v} options={PII_OPTIONS} onChange={(x) => void save(r, { pii: x })} style={{ minInlineSize: 170 }} /> },
            { title: "بازیابی", dataIndex: "rag", render: (v: boolean) => (v ? "نمایه می‌شود" : "—") },
          ]}
        />
      </Card>
    </div>
  );
}

function Oversight() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "oversight"), queryFn: () => govApi.oversight(api) });
  const o = q.data;
  if (!o) return <Skeleton rows={4} />;
  return (
    <div className="gv-stack">
      <Card title="نوشتن با تأیید انسان">
        <p>{o.proposals_on ? "هر نوشتن هوش مصنوعی پیشنهادی است که یک نفر با دسترسی خودش اعمال می‌کند." : "پیشنهاد نوشتن خاموش است؛ هوش مصنوعی چیزی نمی‌نویسد."}</p>
      </Card>
      <Card title="عامل‌ها" flush>
        <Table size="small" rowKey="key" pagination={false} dataSource={o.agents} locale={{ emptyText: "عامل فعالی نیست" }} columns={[{ title: "عامل", dataIndex: "name" }, { title: "اختیار عمل", dataIndex: "autonomy" }, { title: "تأییدکنندگان", dataIndex: "approvers", render: (v: number, r) => `${faDigits(v)} نفر${r.approver_group ? " + گروه" : ""}` }, { title: "کارهای خودکار", dataIndex: "auto_actions", render: (v: string[]) => (v.length ? <span className="ds-ltr">{v.join(" · ")}</span> : "—") }]} />
      </Card>
      <Card title="اعمال خودکار">
        <ul className="gv-list">
          {o.skills_auto_apply.map((s) => (
            <li key={s.key}>
              مهارت «{s.name}»: <span className="ds-ltr">{s.fields.join("، ")}</span>
            </li>
          ))}
          {o.models_auto_apply.map((m) => (
            <li key={m.key}>
              مدل «{m.name}» از اطمینان {pctFa(m.threshold)}
            </li>
          ))}
          {!o.skills_auto_apply.length && !o.models_auto_apply.length ? <li>هیچ مهارت یا مدلی خودکار اعمال نمی‌کند.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

const GUARD_KINDS: Record<string, string> = { policy: "سیاست داده", guardrail: "محدودیت عامل", refusal: "امتناع مدل", injection: "تزریق دستور", budget: "بودجه" };

function Guard() {
  const { api, orgId } = useOrg();
  const [kind, setKind] = useState<string>("");
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "guard", kind), queryFn: () => govApi.guard(api, kind || undefined) });
  return (
    <div className="gv-stack">
      <Segmented size="small" value={kind} onChange={(v) => setKind(String(v))} options={[{ value: "", label: "همه" }, ...Object.entries(GUARD_KINDS).map(([value, label]) => ({ value, label }))]} />
      {!q.data ? (
        <Skeleton rows={5} />
      ) : (
        <Card flush>
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            dataSource={q.data.entries}
            locale={{ emptyText: "موردی ثبت نشده است" }}
            columns={[
              { title: "زمان", dataIndex: "at", render: (v: string) => formatJalaliDateTime(v) },
              { title: "نوع", dataIndex: "kind", render: (v: string) => GUARD_KINDS[v] ?? v },
              { title: "قابلیت", dataIndex: "feature", render: (v: string | null) => <span className="ds-ltr">{v ?? "—"}</span> },
              { title: "جدول‌ها", dataIndex: "tables", render: (v: string[]) => <span className="ds-ltr">{v.join(", ") || "—"}</span> },
              { title: "کاربر", dataIndex: "user", render: (v: string | null) => v ?? "سامانه" },
              { title: "شرح", dataIndex: "detail" },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

function Cards() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ML_KEYS.gov(orgId, "cards"), queryFn: () => govApi.cards(api) });
  const [kind, setKind] = useState<ModelCard["kind"]>("model");
  if (!q.data) return <Skeleton rows={5} />;
  const list = q.data.cards.filter((c) => c.kind === kind);
  return (
    <div className="gv-stack">
      <Segmented
        size="small"
        value={kind}
        onChange={(v) => setKind(v as ModelCard["kind"])}
        options={[
          { value: "model", label: "مدل‌های پیش‌بین" },
          { value: "skill", label: "مهارت‌ها" },
        ]}
      />
      {!list.length ? <EmptyState compact title="شناسنامه‌ای نیست" /> : null}
      <div className="gv-cards">
        {list.map((c) => (
          <Card key={c.key} title={c.name} meta={c.version ? <span className="gv-muted">نسخهٔ {faDigits(c.version)}</span> : null}>
            <dl className="gv-card">
              <dt>کاربرد</dt>
              <dd>{c.purpose}</dd>
              <dt>داده</dt>
              <dd>{c.data.join("، ") || "—"}</dd>
              <dt>خروجی</dt>
              <dd>{c.outputs}</dd>
              <dt>ارزیابی</dt>
              <dd>{c.evaluation}</dd>
              <dt>محدودیت‌ها</dt>
              <dd>
                <ul>
                  {c.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </dd>
              <dt>نظارت انسانی</dt>
              <dd>{c.oversight}</dd>
            </dl>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ExportButton() {
  const { api } = useOrg();
  const n = useNotify();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const data = await govApi.exportJson(api, 90);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ai-governance-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="small" icon={<Download {...ICON14} />} loading={busy} onClick={() => void download()}>
      خروجی ممیزی (۹۰ روز)
    </Button>
  );
}

/** The console (a tab of «تنظیمات ← هوش مصنوعی»). */
export default function Governance() {
  const [section, setSection] = useState<Section>("overview");
  return (
    <div className="gv">
      <div className="gv-bar">
        <Segmented size="small" value={section} onChange={(v) => setSection(v as Section)} options={SECTIONS.map((s) => ({ value: s.value, label: s.label }))} />
        <ExportButton />
      </div>
      {section === "overview" ? <Overview /> : null}
      {section === "models" ? <Models /> : null}
      {section === "usage" ? <Usage /> : null}
      {section === "quality" ? <Quality /> : null}
      {section === "feedback" ? <Feedback /> : null}
      {section === "policy" ? <Policy /> : null}
      {section === "oversight" ? <Oversight /> : null}
      {section === "guard" ? <Guard /> : null}
      {section === "cards" ? <Cards /> : null}
    </div>
  );
}
