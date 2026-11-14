// One data source (design A §15): its name, kind and state; «اجرای اکنون» and «لغو گذر» for its operators;
// «آزمودن اتصال»، «پیش‌نمایش»، «اعمال دوباره روی همه»، «خاموش کردن» and «حذف» under «کارهای دیگر», each shown only to
// whom the server allows it. Tabs: «خلاصه» (figures, a held drop with «پذیرش اندازهٔ تازه», the pass in progress as
// steps, the last pass), «اجراها» (every pass) and «تنظیمات» (the connection by kind; keys write-only, a change of
// key or address asks for the password again when the server says so).
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Steps, Tabs, Tooltip, type MenuProps } from "antd";
import { CircleStop, Ellipsis, Eye, Play, PlugZap, Power, RefreshCcw, RotateCw, SearchX, Trash2 } from "lucide-react";
import { kindDescriptor } from "@shared/discovery/kinds";
import type { KindDescriptor } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { ApiError, errorText } from "../../lib/api";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton, StatCard } from "../../components/display";
import { Note } from "../../components/blocks";
import { useMe, useSchema } from "../../records/data/hooks";
import { dkeys, useConnectorPage, useDiscoveryMeta, type ConnectorPage, type DiscoveryMeta, type PreviewResult, type TestResult } from "./api";
import { PHASES, changes, durationText, editableFields, errorField, formValues, labelOf, missingFields, requiredFields, settingsFields, type Rights, type RunInfo, type Values } from "./model";
import { Refused } from "./Console";
import { Ago, ConnectorForm, ConnectorStateChip, I16, KindIcon, KindName, PreviewTable, RunsTable, TestResultNote } from "./parts";

const TABS = ["summary", "runs", "settings"] as const;

export default function Connector() {
  const { id = "" } = useParams();
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const meta = useDiscoveryMeta();
  const page = useConnectorPage(id);
  const [sp, setSp] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(sp.get("tab") ?? "") ? (sp.get("tab") as string) : "summary";
  const [test, setTest] = useState<TestResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (page.error) {
    const missing = page.error instanceof ApiError && page.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="منبع داده" back={`/${orgId}/discovery`} />
        {missing ? <EmptyState icon={SearchX} title="منبع داده پیدا نشد" /> : <Refused error={page.error} retry={() => void page.refetch()} />}
      </div>
    );
  }
  if (meta.error) return <Refused error={meta.error} />;
  if (!page.data || !meta.data) return <Skeleton rows={8} />;

  const { row, card, can } = page.data;
  const d = kindDescriptor(row.kind);
  const running = !!card?.running;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: dkeys.all(orgId) }), qc.invalidateQueries({ queryKey: ["discovery-runs", id] })]);
  const act = async <T,>(key: string, fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) n.ok(typeof ok === "function" ? ok(r) : ok);
      await refresh();
      return r;
    } catch (e) {
      n.error(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  const base = `/discovery/connectors/${id}`;

  const runNow = () => act("run", () => api.post(`${base}/run`), "گذر تازه در صف اجرا قرار گرفت");
  const cancel = async () => {
    if (await n.confirm("گذر در جریان لغو شود؟", "گذر در گام بعدی خود می‌ایستد؛ آنچه تا اکنون ثبت شده می‌ماند.", true, "لغو گذر")) await act("cancel", () => api.post(`${base}/cancel`), "گذر لغو شد");
  };
  const onMenu: MenuProps["onClick"] = async ({ key }) => {
    if (key === "test") {
      setTest(null);
      const r = await act("test", () => api.post<TestResult>(`${base}/test`));
      if (r) {
        setTest(r);
        setSp((x) => (x.delete("tab"), x), { replace: true });
      }
    } else if (key === "preview") setPreviewing(true);
    else if (key === "reapply") {
      if (await n.confirm("همهٔ موارد دوباره اعمال شوند؟", "در پایان گذر بعدی، همهٔ موارد این منبع یک بار دیگر به پایگاه پیکربندی فرستاده می‌شوند.", false, "اعمال دوباره"))
        await act("reapply", () => api.post(`${base}/reapply`), "اعمال دوباره در صف قرار گرفت");
    } else if (key === "active") {
      await act("active", () => api.patch(base, { active: row.active === false, version: row.version }), row.active === false ? "منبع روشن شد" : "منبع خاموش شد");
    } else if (key === "delete") {
      if (await n.confirm(`حذف «${row.name}»؟`, "منبع از کار می‌افتد و موارد آن «دیگر گزارش نمی‌شود» می‌شوند؛ هیچ پیکربندی‌ای بازنشسته نمی‌شود.", true, "حذف")) {
        if ((await act("delete", () => api.del(base), "منبع داده حذف شد")) !== undefined) nav(`/${orgId}/discovery`);
      }
    }
  };
  const accept = async (runId: string, listed: number) => {
    if (await n.confirm("اندازهٔ تازه پذیرفته شود؟", `موردهایی که در گذر آخر نیامدند (${fa(listed)} مورد آمد) «دیگر گزارش نمی‌شود» می‌شوند و نردبان تماس برایشان اجرا می‌شود.`, false, "پذیرش اندازهٔ تازه"))
      await act("accept", () => api.post<{ gone: number }>(`/discovery/runs/${runId}/accept`), (r) => `اندازهٔ تازه پذیرفته شد؛ ${fa(r.gone)} مورد دیگر گزارش نمی‌شود`);
  };
  const menu: MenuProps["items"] = [
    ...(can.operate && d?.kind !== "push" ? [{ key: "test", label: "آزمودن اتصال", icon: <PlugZap {...I16} /> }] : []),
    ...(can.preview && d?.kind !== "push" ? [{ key: "preview", label: "پیش‌نمایش", icon: <Eye {...I16} /> }] : []),
    ...(can.preview ? [{ key: "reapply", label: "اعمال دوباره روی همه", icon: <RefreshCcw {...I16} /> }] : []),
    ...(can.operate ? [{ key: "active", label: row.active === false ? "روشن کردن" : "خاموش کردن", icon: <Power {...I16} /> }] : []),
    ...(can.edit ? [{ type: "divider" as const }, { key: "delete", label: "حذف", danger: true, icon: <Trash2 {...I16} /> }] : []),
  ];
  const actions = (
    <>
      {running && can.operate ? (
        <Button icon={<CircleStop {...I16} />} loading={busy === "cancel"} onClick={() => void cancel()}>
          لغو گذر
        </Button>
      ) : null}
      {can.operate ? (
        <Button type="primary" icon={<Play {...I16} />} loading={busy === "run"} onClick={() => void runNow()}>
          اجرای اکنون
        </Button>
      ) : null}
      {menu.length ? (
        <Dropdown menu={{ items: menu, onClick: onMenu }} trigger={["click"]}>
          <Tooltip title="کارهای دیگر">
            <Button icon={<Ellipsis {...I16} />} aria-label="کارهای دیگر" loading={busy === "test" || busy === "active" || busy === "reapply" || busy === "delete"} />
          </Tooltip>
        </Dropdown>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={row.name}
        back={`/${orgId}/discovery`}
        subtitle={
          <span className="dsc-head">
            <KindIcon icon={d?.icon} />
            <KindName label={d?.label ?? row.kind} />
            <ConnectorStateChip card={card} active={row.active !== false} />
          </span>
        }
        actions={actions}
      />
      {test ? <TestResultNote result={test} /> : null}
      <Tabs
        className="rk-tabs"
        activeKey={tab}
        onChange={(k) => setSp((x) => (k === "summary" ? x.delete("tab") : x.set("tab", k), x), { replace: true })}
        items={[
          { key: "summary", label: "خلاصه", children: <SummaryTab page={page.data} tz={timezone} busy={busy} onAccept={(runId, listed) => void accept(runId, listed)} onSettings={() => setSp({ tab: "settings" }, { replace: true })} /> },
          { key: "runs", label: "اجراها", children: <RunsTable connectorId={id} meta={meta.data} tz={timezone} /> },
          { key: "settings", label: "تنظیمات", children: d ? <SettingsTab page={page.data} d={d} meta={meta.data} onSaved={refresh} /> : <EmptyState title="نوع این منبع شناخته نیست" /> },
        ]}
      />
      <Drawer open={previewing} onClose={() => setPreviewing(false)} title="پیش‌نمایش" size="large" destroyOnHidden>
        {previewing ? <PreviewPane id={id} /> : null}
      </Drawer>
    </div>
  );

}

// ---------------------------------------------------------------- «خلاصه»

function SummaryTab({ page, tz, busy, onAccept, onSettings }: { page: ConnectorPage; tz: string; busy: string | null; onAccept: (runId: string, listed: number) => void; onSettings: () => void }) {
  const card = page.card;
  if (!card) return <EmptyState compact title="خلاصهٔ این منبع هنوز آماده نیست" />;
  const items = card.items ?? {};
  return (
    <div className="flex flex-col gap-4">
      {card.needs_key ? (
        <Note tone="danger" action={page.can.edit ? <Button onClick={onSettings}>تنظیمات</Button> : undefined}>
          کلید این منبع ذخیره نیست؛ آن را در «تنظیمات» دوباره وارد کنید.
        </Note>
      ) : null}
      {card.held ? (
        <Note
          tone="warning"
          action={
            page.can.preview ? (
              <Button loading={busy === "accept"} onClick={() => onAccept(card.held!.run_id, card.held!.listed)}>
                پذیرش اندازهٔ تازه
              </Button>
            ) : undefined
          }
        >
          {card.held.message || `گذر آخر ${fa(card.held.listed)} مورد آورد؛ موردهای نیامده تا پذیرش اندازهٔ تازه نگه داشته شده‌اند.`}
        </Note>
      ) : null}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5" aria-label="شمار موارد">
        <StatCard title="موارد" value={<span className="ds-num">{fa(Number(items.total ?? 0))}</span>} />
        <StatCard title="پیوسته" value={<span className="ds-num">{fa(Number(items.linked ?? 0))}</span>} />
        <StatCard title="بی‌همتا" value={<span className="ds-num">{fa(Number(items.unmatched ?? 0))}</span>} />
        <StatCard title="بی‌تماس ≥ ۱۴ روز" value={<span className="ds-num">{fa(Number(items.silent ?? 0))}</span>} />
        <StatCard title="خطاهای اجرای آخر" value={<span className="ds-num">{fa(Number(card.last_run?.failed ?? 0))}</span>} />
      </section>
      {card.running ? <Progress run={card.running} tz={tz} /> : null}
      <LastRun run={card.last_run} failures={card.failures} tz={tz} />
    </div>
  );
}

/** The pass in progress as steps, not a spinner (§15). */
function Progress({ run, tz }: { run: RunInfo; tz: string }) {
  const phases = PHASES.filter((p) => p.key !== "reapply" || run.phase === "reapply");
  const at = Math.max(0, phases.findIndex((p) => p.key === run.phase));
  return (
    <section className="ds-card dsc-pane" aria-label="گذر در جریان">
      <h3 className="dsc-pane-t">گذر در جریان</h3>
      <Steps size="small" current={at} items={phases.map((p) => ({ title: p.label }))} />
      <p className="dsc-meta">
        {`${fa(Number(run.fetched ?? 0))} خوانده‌شده · ${fa(Number(run.created ?? 0))} ساخته‌شده · ${fa(Number(run.updated ?? 0))} به‌روزشده · آغاز `}
        <Ago at={run.started_at} tz={tz} />
      </p>
    </section>
  );
}

/** The last complete listing: when, how long, what it did, its error and warnings. */
function LastRun({ run, failures, tz }: { run: (RunInfo & { duration_ms?: number | null }) | null; failures: number; tz: string }) {
  if (!run) return <EmptyState compact title="هنوز گذری اجرا نشده است" />;
  const failed = run.state === "failed";
  const figures: [string, unknown][] = [
    ["خوانده‌شده", run.fetched],
    ["ساخته‌شده", run.created],
    ["به‌روزشده", run.updated],
    ["بی‌همتا", run.unmatched],
    ["تکراری", run.duplicates],
    ["ناموفق", run.failed],
  ];
  return (
    <section className="ds-card dsc-pane" aria-label="اجرای آخر">
      <h3 className="dsc-pane-t">
        اجرای آخر
        {failed ? <Chip tone="danger">ناموفق</Chip> : run.state === "canceled" ? <Chip tone="neutral">لغوشده</Chip> : null}
      </h3>
      <p className="dsc-meta">
        <Ago at={run.finished_at ?? run.started_at} tz={tz} />
        {run.duration_ms ? ` · ${durationText(run.duration_ms)}` : ""}
        {failures > 1 ? ` · ${fa(failures)} گذر پیاپی ناموفق` : ""}
      </p>
      {run.error ? <Note tone="danger">{run.error}</Note> : null}
      <dl className="dsc-figures">
        {figures.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="ds-num">{fa(Number(v ?? 0))}</dd>
          </div>
        ))}
      </dl>
      {run.warnings?.length ? (
        <ul className="dsc-list">
          {run.warnings.slice(0, 5).map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- «پیش‌نمایش»

function PreviewPane({ id }: { id: string }) {
  const { api } = useOrg();
  const { schema } = useSchema();
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    api
      .post<PreviewResult>(`/discovery/connectors/${id}/preview`, { limit: 20 })
      .then((r) => live && setResult(r))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [api, id, round]);
  if (error)
    return (
      <Note tone="danger" action={<Button icon={<RotateCw {...I16} />} onClick={() => setRound((x) => x + 1)}>دوباره</Button>}>
        {error}
      </Note>
    );
  if (!result) return <Skeleton rows={6} />;
  return (
    <PreviewTable
      result={result}
      label={(f) => schema?.def("ci")?.fields.find((x) => x.name === f)?.label ?? f}
      classLabel={(k) => labelOf(schema?.choices["ci.class"], k)}
    />
  );
}

// ---------------------------------------------------------------- «تنظیمات»

function SettingsTab({ page, d, meta, onSaved }: { page: ConnectorPage; d: KindDescriptor; meta: DiscoveryMeta; onSaved: () => Promise<unknown> }) {
  const { api } = useOrg();
  const { userId } = useMe();
  const n = useNotify();
  const row = page.row as Values;
  const rights: Rights = { admin: page.can.edit, owner: !!row.owner_id && row.owner_id === userId, assetManager: meta.can.assetManager, softwareManager: meta.can.softwareManager };
  const before = useMemo(() => formValues(row, d), [row, d]);
  const [values, setValues] = useState<Values>(before);
  const [formKey, setFormKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fields = settingsFields(d, values, meta.edition, rights);
  const editable = editableFields(fields, rights);
  const dirty = Object.keys(changes(d, before, values, [...editable])).length > 0;
  // what the server says now, unless the person is in the middle of a change
  useEffect(() => {
    if (!dirty) setValues(before);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before]);

  const save = async () => {
    setProblem(null);
    const missing = missingFields(requiredFields(d, values, fields, before), values).filter((f) => editable.has(f));
    if (missing.length) return setErrors(Object.fromEntries(missing.map((f) => [f, "این مورد لازم است"])));
    setSaving(true);
    try {
      await api.patch(`/discovery/connectors/${row.id}`, { ...changes(d, before, values, [...editable]), version: row.version });
      n.ok("تنظیمات ذخیره شد");
      setErrors({});
      await onSaved();
      setFormKey((k) => k + 1);
    } catch (e) {
      const field = e instanceof ApiError ? errorField(e.details) : null;
      if (field && fields.includes(field)) setErrors({ [field]: errorText(e) });
      else if (field === "options") setProblem(errorText(e));
      else n.error(e);
    } finally {
      setSaving(false);
    }
  };

  const view = editable.size === 0;
  return (
    <div className="flex flex-col gap-3">
      {problem ? <Note tone="danger">{problem}</Note> : null}
      <ConnectorForm
        key={formKey}
        d={d}
        fields={fields}
        values={values}
        before={before}
        editable={editable}
        errors={errors}
        display={page.display}
        rights={rights}
        sectioned
        view={view}
        onChange={(f, v) => {
          setValues((x) => ({ ...x, [f]: v }));
          if (errors[f]) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== f)));
        }}
        idPrefix="dsc-s"
      />
      {view ? null : (
        <div className="dsc-step-f">
          <Button
            onClick={() => {
              setValues(before);
              setErrors({});
              setFormKey((k) => k + 1);
            }}
            disabled={!dirty || saving}
          >
            انصراف
          </Button>
          <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            ذخیره
          </Button>
        </div>
      )}
    </div>
  );
}

