// «منبع داده تازه» (design A §15): ابزار → اتصال → چه بیاید → پیش‌نمایش → خلاصه. Only the kinds kept for 1.1 are
// offered; a kind this edition cannot run shows disabled with one line why. «اتصال» saves the source switched off
// (a test and a preview send the stored key, so the server needs it saved) and tests it; «ذخیره و اجرای نخست»
// switches it on and queues its first pass. «پیش‌نمایش» opens «نگاشت» in a side sheet for the map's overrides (the
// REST kind is all map); its «ذخیره» runs the preview again. Moving between steps never loses another step's unsaved
// edits. Keys are typed into write-only boxes and never shown again. Desktop-first: a phone gets one line. CMDB
// administrators only (the server refuses others).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Steps } from "antd";
import { Lock, Monitor, PlugZap, RotateCw, Waypoints } from "lucide-react";
import { AUTH_OPTIONS, COLLECT_OPTIONS, type KindDescriptor } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { ApiError, errorText } from "../../lib/api";
import { useIsPhone, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Skeleton } from "../../components/display";
import { Note } from "../../components/blocks";
import { useSchema } from "../../records/data/hooks";
import { dkeys, useConnectorPage, useDiscoveryMeta, type PreviewResult, type TestResult } from "./api";
import {
  ASSET_FIELDS, afterSave, authOf, changes, collectFields, connectionFields, createBody, errorField, formValues, isStoredSecret, labelOf, missingFields, newValues, requiredFields,
  scheduleFields, scheduleText, wizardGroups, type OfferedKind, type Values,
} from "./model";
import { Refused } from "./Console";
import { MappingTab } from "./Mapping";
import { ConnectorForm, I16, KindIcon, KindName, PreviewTable, TestResultNote, cx } from "./parts";

const STEPS = ["ابزار", "اتصال", "چه بیاید", "پیش‌نمایش", "خلاصه"];

export default function Wizard() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const phone = useIsPhone();
  const meta = useDiscoveryMeta();
  const { schema } = useSchema();
  const [sp, setSp] = useSearchParams();
  // the source saved at «اتصال»: a reload continues it instead of making another
  const savedId = sp.get("c");
  const saved = useConnectorPage(savedId ?? undefined);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<OfferedKind | null>(null);
  const [values, setValues] = useState<Values>({});
  const [stored, setStored] = useState<Values | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // the side sheet «نگاشت» at «پیش‌نمایش», and whether it holds an unsaved map
  const [mapping, setMapping] = useState(false);
  const [mapDirty, setMapDirty] = useState(false);
  const n = useNotify();
  const heading = useRef<HTMLHeadingElement>(null);

  // continue a saved source after a reload
  useEffect(() => {
    if (!saved.data || stored || !meta.data) return;
    const row = saved.data.row as Values;
    const d = meta.data.kinds.find((k) => k.kind === row.kind) ?? null;
    if (!d) return;
    setKind(d);
    setStored(formValues(row, d));
    setValues(formValues(row, d));
    setStep(1);
  }, [saved.data, stored, meta.data]);

  // a new step's heading takes the focus (keyboard and screen readers start at the step)
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) heading.current?.focus();
    shown.current = true;
  }, [step]);

  if (phone)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="منبع داده تازه" back={`/${orgId}/discovery`} />
        <EmptyState icon={Monitor} title="افزودن منبع روی رایانه ممکن است" action={<Link to={`/${orgId}/discovery`}>منبع‌های داده</Link>} />
      </div>
    );
  if (meta.error) return <Refused error={meta.error} />;
  // a reload waits for the saved source; the source this wizard just saved is already here
  if (!meta.data || (savedId && !stored && !saved.data && !saved.error)) return <Skeleton rows={8} />;
  if (!meta.data.can.admin)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="منبع داده تازه" back={`/${orgId}/discovery`} />
        <EmptyState icon={Lock} title="منبع داده را مدیر پیکربندی می‌سازد و تنظیم می‌کند" />
      </div>
    );

  const m = meta.data;
  const d: KindDescriptor | null = kind ?? null;
  const rights = { admin: true, owner: false, assetManager: m.can.assetManager, softwareManager: m.can.softwareManager };
  const conn = d ? connectionFields(d, values, m.edition) : [];
  const what = d ? [...collectFields(d, values), ...scheduleFields(d, values), ...(m.can.assetManager ? ASSET_FIELDS : [])] : [];
  const id = (stored?.id as string | undefined) ?? null;
  const set = (field: string, v: unknown) => {
    setValues((x) => ({ ...x, [field]: v }));
    if (errors[field]) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== field)));
  };

  const fail = (e: unknown) => {
    const field = e instanceof ApiError ? errorField(e.details) : null;
    if (field && (conn.includes(field) || what.includes(field))) setErrors({ [field]: errorText(e) });
    else setProblem(errorText(e));
  };

  /**
   * A saved row: what is stored now, and the form's values — the whole row after a create, only `fields` (with the id,
   * the version and the key boxes) after a change, so another step's unsaved edits stay for that step's save.
   */
  const take = (row: Values, fields: readonly string[] | null): Values => {
    const next = formValues(row, d ?? undefined);
    setStored(next);
    setValues((v) => afterSave(v, next, fields));
    void qc.invalidateQueries({ queryKey: dkeys.cards(orgId) });
    // the side sheet «نگاشت» reads the source as it is now
    void qc.invalidateQueries({ queryKey: dkeys.page(orgId, String(row.id)) });
    return next;
  };

  /** Saves the step's fields: makes the source (switched off) the first time, then changes it. The saved row, or null. */
  const save = async (fields: string[]): Promise<Values | null> => {
    if (!d) return null;
    setProblem(null);
    const missing = missingFields(requiredFields(d, values, fields, stored ?? {}), values);
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((f) => [f, "این مورد لازم است"])));
      return null;
    }
    try {
      let row: Values;
      if (!id) {
        row = (await api.post<{ row: Values }>("/discovery/connectors", createBody(d, values, fields))).row;
        setSp({ c: String(row.id) }, { replace: true });
      } else {
        const body = changes(d, stored ?? {}, values, fields);
        if (!Object.keys(body).length) return stored;
        row = (await api.patch<{ row: Values }>(`/discovery/connectors/${id}`, { ...body, version: stored?.version })).row;
      }
      const next = take(row, id ? fields : null);
      // the key boxes start empty again over the stored key
      setFormKey((k) => k + 1);
      setErrors({});
      return next;
    } catch (e) {
      fail(e);
      return null;
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      const row = await save(conn);
      if (row) setTest(await api.post<TestResult>(`/discovery/connectors/${String(row.id)}/test`));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async (connectorId: string) => {
    setBusy("preview");
    setPreview(null);
    setPreviewError(null);
    try {
      setPreview(await api.post<PreviewResult>(`/discovery/connectors/${connectorId}/preview`, { limit: 20 }));
    } catch (e) {
      setPreviewError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  /** «ذخیره» in the side sheet «نگاشت»: the wizard takes the new version, and the preview runs again with the map. */
  const mapSaved = (row: Values) => {
    take(row, ["mapping"]);
    setMapping(false);
    if (id) void runPreview(id);
  };
  /** Closing the side sheet with an unsaved map asks first. */
  const closeMapping = async () => {
    if (mapDirty && !(await n.confirm("نگاشت ذخیره نشده است؛ کنار گذاشته شود؟", "تغییرهای نگاشت از دست می‌روند.", true, "کنار گذاشتن"))) return;
    setMapping(false);
  };

  const go = async (to: number) => {
    let row = stored;
    if (to > step && (step === 1 || step === 2)) {
      setBusy("next");
      row = await save(step === 1 ? conn : what);
      setBusy(null);
      if (!row) return;
    }
    setProblem(null);
    setStep(to);
    if (to === 3 && d?.kind !== "push" && row?.id) void runPreview(String(row.id));
  };

  const finish = async () => {
    if (!id) return;
    setBusy("finish");
    setProblem(null);
    try {
      await api.patch(`/discovery/connectors/${id}`, { active: true, version: stored?.version });
      await api.post(`/discovery/connectors/${id}/run`);
      await qc.invalidateQueries({ queryKey: dkeys.all(orgId) });
      nav(`/${orgId}/discovery/${id}`, { state: { queued: Date.now() } });
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const groups = wizardGroups(m.kinds);
  const classLabel = (key: string) => labelOf(schema?.choices["ci.class"], key);
  const ciLabel = (f: string) => schema?.def("ci")?.fields.find((x) => x.name === f)?.label ?? f;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="منبع داده تازه" back={`/${orgId}/discovery`} />
      <Steps className="dsc-steps" size="small" current={step} items={STEPS.map((title) => ({ title }))} />
      {/* the steps' buttons move it on; the browser never submits it */}
      <form className="ds-card dsc-step" aria-labelledby="dsc-step-t" onSubmit={(e) => e.preventDefault()}>
        <h2 id="dsc-step-t" ref={heading} tabIndex={-1} className="dsc-step-t">
          {STEPS[step]}
        </h2>
        {problem ? <Note tone="danger">{problem}</Note> : null}

        {step === 0 ? (
          <div className="flex flex-col gap-4" role="group" aria-label="ابزار">
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col gap-2">
                <h3 className="dsc-group-t">{g.label}</h3>
                <div className="dsc-tools">
                  {g.kinds.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      aria-pressed={kind?.kind === k.kind}
                      disabled={!k.runs || (!!id && kind?.kind !== k.kind)}
                      className={cx("dsc-tool", kind?.kind === k.kind && "is-on")}
                      onClick={() => {
                        if (kind?.kind === k.kind) return;
                        setKind(k);
                        setValues(newValues(k));
                        setErrors({});
                      }}
                    >
                      <span className="dsc-card-ic">
                        <KindIcon icon={k.icon} />
                      </span>
                      <span className="dsc-tool-b">
                        <KindName label={k.label} />
                        {!k.runs ? <span className="dsc-sub">در این نسخهٔ کاریز اجرا نمی‌شود</span> : k.permission_note ? <span className="dsc-sub">{k.permission_note}</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length ? <EmptyState compact icon={PlugZap} title="در این نسخه ابزاری برای افزودن نیست" /> : null}
          </div>
        ) : null}

        {step === 1 && d ? (
          <>
            <ConnectorForm key={`c${formKey}`} d={d} fields={conn} values={values} before={stored ?? {}} editable={new Set(conn)} errors={errors} rights={rights} onChange={set} idPrefix="dsc-w" />
            {d.kind !== "push" ? (
              <div className="flex flex-col gap-3">
                <div>
                  <Button icon={<PlugZap {...I16} />} loading={busy === "test"} onClick={() => void runTest()}>
                    آزمودن اتصال
                  </Button>
                </div>
                {test ? <TestResultNote result={test} /> : null}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 2 && d ? (
          <ConnectorForm key={`w${formKey}`} d={d} fields={what} values={values} before={stored ?? {}} editable={new Set(what)} errors={errors} rights={rights} onChange={set} idPrefix="dsc-w" />
        ) : null}

        {step === 3 && d ? (
          d.kind === "push" ? (
            <Note>این منبع داده را خودِ ابزار می‌فرستد؛ پیش از نخستین ارسال پیش‌نمایشی ندارد.</Note>
          ) : (
            <>
              {busy === "preview" ? (
                <Skeleton rows={6} />
              ) : previewError ? (
                <Note tone="danger" action={<Button icon={<RotateCw {...I16} />} onClick={() => id && void runPreview(id)}>دوباره</Button>}>
                  {previewError}
                </Note>
              ) : preview ? (
                <PreviewTable result={preview} label={ciLabel} classLabel={classLabel} />
              ) : null}
              {(preview && busy !== "preview") || saved.data ? (
                <div className="flex flex-wrap gap-2">
                  {preview && busy !== "preview" ? (
                    <Button icon={<RotateCw {...I16} />} onClick={() => id && void runPreview(id)}>
                      پیش‌نمایش دوباره
                    </Button>
                  ) : null}
                  {/* the map's overrides in a side sheet (REST is all map): «ذخیره» there runs the preview again */}
                  {saved.data ? (
                    <Button icon={<Waypoints {...I16} />} disabled={!!busy} onClick={() => setMapping(true)}>
                      نگاشت
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )
        ) : null}

        {step === 4 && d && stored ? <Summary d={d} v={stored} /> : null}

        <div className="dsc-step-f">
          {step > 0 ? (
            <Button onClick={() => void go(step - 1)} disabled={!!busy}>
              قبلی
            </Button>
          ) : null}
          {step < 4 ? (
            <Button type="primary" loading={busy === "next"} disabled={!d || (!!busy && busy !== "next")} onClick={() => void go(step + 1)}>
              بعدی
            </Button>
          ) : (
            <Button type="primary" loading={busy === "finish"} onClick={() => void finish()}>
              ذخیره و اجرای نخست
            </Button>
          )}
        </div>
      </form>
      {d && saved.data ? (
        <Drawer open={mapping} onClose={() => void closeMapping()} title="نگاشت" size="large" destroyOnHidden>
          {mapping ? <MappingTab page={saved.data} d={d} onDirty={setMapDirty} onSaved={mapSaved} /> : null}
        </Drawer>
      ) : null}
    </div>
  );
}

/** «خلاصه»: what the source will do (a stored key is only said to be stored). */
function Summary({ d, v }: { d: KindDescriptor; v: Values }) {
  const rows: [string, ReactNode][] = [
    ["ابزار", <KindName key="k" label={d.label} />],
    ["نام", String(v.name ?? "")],
  ];
  if (v.base_url)
    rows.push([
      "نشانی",
      <bdi key="u" dir="ltr" className="ds-mono">
        {String(v.base_url)}
      </bdi>,
    ]);
  if (d.kind !== "push" && d.kind !== "demo") rows.push(["روش ورود", labelOf(AUTH_OPTIONS, authOf(d, v))]);
  if (isStoredSecret(v.secret)) rows.push(["کلید", "ذخیره شده"]);
  rows.push(["چه بیاید", (Array.isArray(v.collect) ? (v.collect as string[]) : []).map((c) => labelOf(COLLECT_OPTIONS, c)).join("، ") || "—"]);
  rows.push(["زمان‌بندی", scheduleText(Number(v.every_minutes ?? 0))]);
  return (
    <dl className="dsc-summary">
      {rows.map(([k, x]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{x}</dd>
        </div>
      ))}
    </dl>
  );
}
