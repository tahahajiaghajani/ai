// «اتصال‌ها»: one card per connection — provider, status (سالم / نیاز به توجه / بررسی نشده / متوقف), the key's hint and
// who added it, the models of each tier, the last error with its Persian remedy, and «آزمایش اتصال» with its report.
import { useState } from "react";
import { Button, Dropdown, Tooltip } from "antd";
import { CircleAlert, Ellipsis, FlaskConical, Globe, KeyRound, ListRestart, Monitor, Pencil, Play, Plug, Plus, Power, Route, Trash2 } from "lucide-react";
import type { AiConnectionPublic, AiTestReport } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { fa, jDate, jTime } from "../../lib/fa";
import { Note } from "../../modules/reports/kit";
import { ERROR_HELP, TIER_LABEL, TONE_LABEL, connectionTone } from "../kit/model";
import { objectOf, useAiInvalidate } from "../kit/hooks";
import type { AiPresetView } from "../kit/types";
import { TestReport } from "./TestReport";
import { ConnectionDrawer, RegionNote } from "./ConnectionDrawer";

const REGION_ICON = { foreign: Globe, iran: Route, local: Monitor, any: Plug } as const;
const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

const when = (iso: string) => {
  const d = new Date(iso);
  return `${jDate(d)}، ${jTime(d)}`;
};

export function StatusMark({ c }: { c: AiConnectionPublic }) {
  const tone = connectionTone(c);
  if (tone === "ok")
    return (
      <span className="ai-st" data-tone="ok">
        <i className="ds-nuqta" aria-hidden />
        {TONE_LABEL.ok}
      </span>
    );
  if (tone === "attention") return <Chip tone="danger">{TONE_LABEL.attention}</Chip>;
  if (tone === "paused") return <Chip tone="warning">{c.paused_until ? `متوقف تا ${jTime(new Date(c.paused_until))}` : TONE_LABEL.paused}</Chip>;
  return <Chip tone="neutral">{TONE_LABEL[tone]}</Chip>;
}

function ModelList({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="ai-none">انتخاب نشده</span>;
  const [main, ...rest] = ids;
  return (
    <>
      <span className="ai-mid">{main}</span>
      {rest.length ? (
        <Tooltip title={<span className="ai-tip"><b>جایگزین‌ها به‌ترتیب</b>{rest.map((m) => <bdi key={m} dir="ltr">{m}</bdi>)}</span>}>
          <span className="ai-more" tabIndex={0}>+{fa(rest.length)}</span>
        </Tooltip>
      ) : null}
    </>
  );
}

function ConnectionCard({
  c,
  preset,
  report,
  testing,
  onTest,
  onEdit,
  onRefresh,
  onResume,
  onToggle,
  onDelete,
}: {
  c: AiConnectionPublic;
  preset?: AiPresetView;
  report?: AiTestReport | null;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onResume: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const tone = connectionTone(c);
  const Icon = REGION_ICON[preset?.region ?? "any"] ?? Plug;
  const err = c.last_error;
  return (
    <article className={`ai-conn ${c.enabled ? "" : "is-off"}`} aria-label={c.label}>
      <header className="ai-conn-h">
        <span className="ai-conn-ic" aria-hidden>
          <Icon {...ICON} />
        </span>
        <div className="ai-conn-t">
          <div className="ai-conn-name">
            <span>{c.label}</span>
            <StatusMark c={c} />
          </div>
          <div className="ai-conn-meta">
            <span>{preset?.label ?? c.preset}</span>
            {c.free_tier ? (
              <>
                <span className="bk-sep" aria-hidden />
                <span>طرح رایگان</span>
              </>
            ) : null}
            <span className="bk-sep" aria-hidden />
            {c.key_unreadable ? (
              <span className="text-danger">کلید خوانده نمی‌شود</span>
            ) : c.has_key ? (
              <span className="inline-flex items-center gap-1">
                <KeyRound size={12} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
                <span className="ai-key">{c.key_hint ?? "…"}</span>
              </span>
            ) : (
              <span>بدون کلید</span>
            )}
            {c.created_by_name ? (
              <>
                <span className="bk-sep" aria-hidden />
                <span>{c.created_by_name}</span>
              </>
            ) : null}
          </div>
        </div>
        <Dropdown
          trigger={["click"]}
          rootClassName="ds-glass"
          placement="bottomLeft"
          menu={{
            items: [
              { key: "edit", icon: <Pencil {...ICON} />, label: "ویرایش", onClick: onEdit },
              { key: "models", icon: <ListRestart {...ICON} />, label: "به‌روزرسانی فهرست مدل‌ها", onClick: onRefresh, disabled: !c.enabled },
              ...(tone === "paused" ? [{ key: "resume", icon: <Play {...ICON} />, label: "ادامه", onClick: onResume }] : []),
              { key: "toggle", icon: <Power {...ICON} />, label: c.enabled ? "غیرفعال کردن" : "فعال کردن", onClick: onToggle },
              { type: "divider" as const },
              { key: "del", icon: <Trash2 {...ICON} />, label: "حذف", danger: true, onClick: onDelete },
            ],
          }}
        >
          <Button type="text" size="small" icon={<Ellipsis {...ICON} />} aria-label={`عملیات «${c.label}»`} />
        </Dropdown>
      </header>

      <dl className="ai-models">
        {(["smart", "fast", "vision"] as const).map((t) => (
          <div key={t} style={{ display: "contents" }}>
            <dt>{TIER_LABEL[t]}</dt>
            <dd>
              <ModelList ids={c.models[t]} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="ai-conn-body">
        {err && tone !== "ok" ? (
          <div className="ai-err" role="status">
            <CircleAlert {...ICON} aria-hidden />
            <div className="min-w-0">
              <b>{ERROR_HELP[err.kind]?.title ?? "خطا"}</b>
              <div>{err.message || ERROR_HELP[err.kind]?.remedy}</div>
              {err.message && ERROR_HELP[err.kind] && err.message !== ERROR_HELP[err.kind].remedy ? <div className="text-ink-3">{ERROR_HELP[err.kind].remedy}</div> : null}
              {err.at ? <div className="ai-src mt-1">{when(err.at)}</div> : null}
            </div>
          </div>
        ) : null}
        {report ? <TestReport report={report} /> : null}
      </div>

      <footer className="ai-conn-f">
        <span className="ai-src">
          {c.checked_at ? `آخرین بررسی ${when(c.checked_at)}` : "هنوز آزمایش نشده"}
          {c.available_models?.length ? <> <span className="bk-sep" aria-hidden /> {fa(c.available_models.length)} مدل در دسترس</> : null}
          {c.priority ? <> <span className="bk-sep" aria-hidden /> اولویت {fa(c.priority)}</> : null}
        </span>
        <span className="ai-acts">
          <Button size="small" type="text" onClick={onEdit}>
            ویرایش
          </Button>
          <Button size="small" icon={<FlaskConical size={14} strokeWidth={1.4} absoluteStrokeWidth />} loading={testing} onClick={onTest} disabled={!c.enabled}>
            آزمایش اتصال
          </Button>
        </span>
      </footer>
    </article>
  );
}

export function ConnectionsTab({
  connections,
  loading,
  error,
  presets,
  secretOk,
  adding,
  onAdding,
}: {
  connections: AiConnectionPublic[] | undefined;
  loading: boolean;
  error: unknown;
  presets: AiPresetView[];
  secretOk: boolean;
  adding: boolean;
  onAdding: (v: boolean) => void;
}) {
  const { api } = useOrg();
  const n = useNotify();
  const refresh = useAiInvalidate();
  const [editing, setEditing] = useState<AiConnectionPublic | null>(null);
  const [reports, setReports] = useState<Record<string, AiTestReport | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const presetOf = (id: string) => presets.find((p) => p.id === id);

  const runTest = async (c: AiConnectionPublic) => {
    setBusy(c.id);
    try {
      const r = objectOf<AiTestReport>(await api.post(`/ai/connections/${c.id}/test`, {}), "report");
      setReports((m) => ({ ...m, [c.id]: r }));
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) n.ok(ok);
    } catch (e) {
      n.error(e);
    } finally {
      refresh();
    }
  };
  const remove = async (c: AiConnectionPublic) => {
    if (!(await n.confirm(`حذف اتصال «${c.label}»؟`, "کلید آن پاک می‌شود و کارهایی که از آن استفاده می‌کنند به اتصال بعدی می‌روند.", true))) return;
    setEditing(null);
    onAdding(false);
    await act(() => api.del(`/ai/connections/${c.id}`), `اتصال «${c.label}» حذف شد.`);
  };

  const list = (connections ?? []).slice().sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.priority - b.priority);
  const drawerOpen = adding || !!editing;

  return (
    <>
      {!secretOk ? (
        <Note tone="warning" className="mb-4">
          <b>کلید رمزنگاری سامانه تنظیم نشده است.</b> کلیدهای API فقط پس از تنظیم متغیر <bdi dir="ltr" className="ds-mono">APP_SECRET</bdi> در سرور ذخیره می‌شوند؛ از مدیر سامانه بخواهید آن را تنظیم کند.
        </Note>
      ) : null}
      {loading ? (
        <div className="bk-card">
          <div className="bk-card-b">
            <Skeleton rows={6} />
          </div>
        </div>
      ) : error ? (
        <div className="bk-card">
          <EmptyState icon={CircleAlert} title="فهرست اتصال‌ها بارگذاری نشد." description={(error as Error)?.message} action={<Button onClick={refresh}>تلاش دوباره</Button>} />
        </div>
      ) : !list.length ? (
        <div className="bk-card">
          <EmptyState
            icon={KeyRound}
            title="هنوز اتصالی ثبت نشده."
            description="کلید API یکی از سرویس‌ها را وارد کنید تا دستیار و تحلیل‌ها به کار بیفتند."
            action={
              <Button icon={<Plus {...ICON} />} onClick={() => onAdding(true)}>
                افزودن اتصال
              </Button>
            }
          />
          <div className="bk-card-b" style={{ paddingBlockStart: 0 }}>
            <RegionNote />
          </div>
        </div>
      ) : (
        <div className="ai-conns">
          {list.map((c) => (
            <ConnectionCard
              key={c.id}
              c={c}
              preset={presetOf(c.preset)}
              report={reports[c.id]}
              testing={busy === c.id}
              onTest={() => runTest(c)}
              onEdit={() => setEditing(c)}
              onRefresh={() => act(() => api.post(`/ai/connections/${c.id}/models`, {}), "فهرست مدل‌ها به‌روز شد.")}
              onResume={() => act(() => api.post(`/ai/connections/${c.id}/resume`, {}), "اتصال دوباره به کار افتاد.")}
              onToggle={() => act(() => api.patch(`/ai/connections/${c.id}`, { enabled: !c.enabled }), c.enabled ? "اتصال غیرفعال شد." : "اتصال فعال شد.")}
              onDelete={() => remove(c)}
            />
          ))}
        </div>
      )}
      <ConnectionDrawer
        open={drawerOpen}
        connection={editing}
        presets={presets}
        secretOk={secretOk}
        count={list.length}
        onClose={() => {
          setEditing(null);
          onAdding(false);
        }}
        onSaved={(saved, created) => {
          setEditing(null);
          onAdding(false);
          refresh();
          if (created && saved) void runTest(saved);
        }}
        onDelete={remove}
      />
    </>
  );
}
