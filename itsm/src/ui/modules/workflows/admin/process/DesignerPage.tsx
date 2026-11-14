// The process designer «طراحی گردش‌کار» (design F §3.5, §8.4, package F6): settings/workflows/p/:id.
//   · Toolbar: the process's name and state («پیش‌نویس»، «منتشرشده، نسخهٔ ۲»، «تغییرهای منتشرنشده»), the save state, the
//     problems, undo and redo, «تنظیمات گردش‌کار», «پیش‌نمایش», «نسخه‌ها», «انتشار» (approvers on the authority; a
//     designer reads «انتشار با مسئول انتشار است») and «بازنشسته‌کردن».
//   · Palette (مرحلهٔ فرم، بررسی، تأیید · شرط، انتخاب، موازی، پیوستن · انتظار، اعلان، جریان خودکار، تعیین مقدار، پایان):
//     a click adds the step after the chosen one — on its way on, or between it and the step it led to — and a drag
//     drops it on the canvas.
//   · Canvas: the kit's ProcessCanvas (top to bottom, zoom, fit, auto-layout, keyboard), problems as badges.
//   · Inspector: the chosen step (./Inspector.tsx); with none, the process at a glance.
//   · The draft saves itself (PUT …/draft with the version it was edited from) with undo, redo and the unsaved guard; a
//     save another designer made meanwhile is caught, and the person chooses whose changes stay.
//   · «پیش‌نمایش» (./Preview.tsx), «نسخه‌ها» and the problems drawer (./Versions.tsx), the settings (./Settings.tsx),
//     «انتشار» and «بازنشسته‌کردن» (the hub's dialogs: the diff with the access settings, re-authentication).
//   · Phones read the steps as a numbered list.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert, Button, Dropdown, Input, Modal, Tooltip } from "antd";
import { Archive, BadgeCheck, Eye, History, MoreHorizontal, PencilRuler, Redo2, SearchCheck, Send, Settings2, Undo2 } from "lucide-react";
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { FlowProblem } from "@shared/flows/types";
import { formStepOf, validateProcess, type ProcessGraph } from "@shared/process";
import type { FieldDef } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { ApiError, errorText } from "../../../../lib/api";
import { useOrg } from "../../../../lib/org";
import { useSession } from "../../../../lib/session";
import { useIsPhone, useNotify } from "../../../../lib/hooks";
import { PageHeader } from "../../../../components/layout";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { cx, Note } from "../../../../components/blocks";
import { matchItem, useShellItems } from "../../../../components/shell/model";
import { PROCESS_NODE_MIME, ProcessCanvas, ProcessNodeIcon, StepList, nodeTitle } from "../../kit";
import { FIELD_KEYS, fieldsApi } from "../fields/api";
import { fieldsAccess } from "../fields/model";
import { FORM_KEYS, formsApi, type FormDetail } from "../forms/api";
import { SaveStatus, useHistory, useLeaveGuard, useUndoKeys } from "../forms/parts";
import type { SaveState } from "../forms/model";
import { HUB_KEYS, hubApi } from "../hub/api";
import { CONNECTION_NEEDED, PUBLISH_REFUSAL, authorityHere, HUB_PATH } from "../hub/model";
import { PublishDialog, RetireDialog } from "../hub/PublishDialog";
import { DESIGNER_KEYS, designerApi, type ProcessDetail, type VersionRow } from "./api";
import {
  PALETTE_GROUPS, bridgeRemoved, caseFields, cleanDraft, countProblems, designerAccess, designerDraft, designerOffers, formInfoOf, formPatch, graphForms, insertAfter, liveProblems,
  moveKey, nameProblem, patchConfig, phoneNotes, problemTarget, problemsText, processForms, savePatch, startFields, startersText, statusChip, structureKey, titleFields,
  type DesignerDraft, type FormInfo, type InspectorTab, type PaletteItem,
} from "./model";
import { NodeInspector } from "./Inspector";
import { ProcessSettings } from "./Settings";
import { ProblemsDrawer, VersionsDrawer } from "./Versions";
import { PreviewPanel } from "./Preview";
import { I14, I16 } from "./parts";
import "../../../../records/records.css";
import "../fields/fields.css";
import "../forms/forms.css";
import "../hub/hub.css";
import "./process.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DesignerPage() {
  const { id = "" } = useParams<{ id: string }>();
  const org = useOrg();
  const access = designerAccess(org);
  const detail = useQuery({
    queryKey: DESIGNER_KEYS.detail(org.orgId, id),
    queryFn: () => designerApi.detail(org.api, id),
    enabled: access.read && !!id,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (!access.read) return <EmptyState art="locked" title="به «گردش‌کارها» دسترسی ندارید" description="طراحی گردش‌کارهای سازمان با طراحان فرم و گردش‌کار است." />;
  if (detail.isLoading) return <Loader />;
  if (!detail.data) return <EmptyState title="گردش‌کار پیدا نشد" description={detail.error ? errorText(detail.error) : "این گردش‌کار دیگر نیست یا نشانی آن درست نیست."} />;
  return <Designer key={detail.data.process.id} initial={detail.data} />;
}

/** The icons of the palette's three kinds of form step. */
const PALETTE_ICON: Partial<Record<string, typeof SearchCheck>> = { review: SearchCheck, approve: BadgeCheck };

function NewFormDialog({ name, onClose, onMade }: { name: string; onClose: () => void; onMade: (form: { id: string; name: string }) => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const r = await formsApi.create(api, { name: value.trim() });
      await qc.invalidateQueries({ queryKey: FORM_KEYS.list(orgId) });
      onMade({ id: r.form.id, name: r.form.name });
    } catch (e) {
      n.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal open title="فرم تازه برای این مرحله" okText="ساختن فرم" cancelText="انصراف" onOk={make} onCancel={onClose} okButtonProps={{ disabled: !value.trim(), loading: busy }} destroyOnHidden width={440}>
      <div className="wfm-stack">
        <label className="wfk-lbl" htmlFor="wfp-new-form">
          نام فرم
        </label>
        <Input id="wfp-new-form" value={value} maxLength={120} autoFocus onChange={(e) => setValue(e.target.value)} onPressEnter={make} />
        <p className="rk-hint">فرم خالی ساخته و در این مرحله گذاشته می‌شود؛ فیلدهایش را در «طراحی این فرم» بچینید.</p>
      </div>
    </Modal>
  );
}

function Designer({ initial }: { initial: ProcessDetail }) {
  const org = useOrg();
  const { api, orgId, writable } = org;
  const access = designerAccess(org);
  const fa = fieldsAccess(org);
  const { meta } = useSession();
  const phone = useIsPhone();
  const n = useNotify();
  const nav = useNavigate();
  const qc = useQueryClient();
  const items = useShellItems();
  const id = initial.process.id;
  const authority = authorityHere(meta, orgId);

  // ------------------------------------------------------------------ the draft, its history and what is saved
  const [saved, setSavedState] = useState<ProcessDetail>(initial);
  const savedRef = useRef(initial);
  const setSaved = useCallback((d: ProcessDetail) => {
    savedRef.current = d;
    setSavedState(d);
  }, []);
  const offers = designerOffers(saved, { writable, phone, authority, preview: access.preview });
  const hist = useHistory<DesignerDraft>(designerDraft(initial));
  const value = hist.value;
  const draftRef = useRef(value);
  draftRef.current = value;
  const graph = value.draft.graph;
  const [state, setState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(initial.process.updated_at);
  const [conflict, setConflict] = useState(false);

  // ------------------------------------------------------------------ what the page shows
  const [mode, setMode] = useState<"design" | "preview">("design");
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("people");
  const [fit, setFit] = useState(0);
  const [settings, setSettings] = useState<{ focus: string | null } | null>(null);
  const [versions, setVersions] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [newForm, setNewForm] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const dragItem = useRef<PaletteItem | null>(null);
  const editable = offers.edit && mode === "design";
  const selected = sel && graph.nodes.some((x) => x.id === sel) ? sel : null;
  const selNode = selected ? graph.nodes.find((x) => x.id === selected)! : null;

  // ------------------------------------------------------------------ the forms the steps use, the case's values
  const formsList = useQuery({ queryKey: FORM_KEYS.list(orgId), queryFn: () => formsApi.list(api), staleTime: 30_000, enabled: !phone });
  const formChoices = useMemo(() => processForms(formsList.data?.forms ?? []), [formsList.data]);
  const formIds = useMemo(() => graphForms(graph), [graph]);
  const combine = useCallback((rs: UseQueryResult<FormDetail>[]) => ({ data: rs.map((r) => r.data ?? null), loading: rs.map((r) => r.isLoading) }), []);
  const formsQ = useQueries({ queries: formIds.map((fid) => ({ queryKey: FORM_KEYS.detail(orgId, fid), queryFn: () => formsApi.get(api, fid), enabled: UUID.test(fid), retry: false, staleTime: 0 })), combine });
  const forms = useMemo(() => {
    const m = new Map<string, FormInfo>();
    formsQ.data.forEach((d, i) => d && m.set(formIds[i], formInfoOf(d)));
    return m;
  }, [formsQ.data, formIds]);
  const formsReady = !formsQ.loading.some(Boolean);
  const fields = useMemo(() => caseFields(formIds.map((fid) => forms.get(fid)).filter((f): f is FormInfo => !!f)), [formIds, forms]);
  const unit = useQuery({ queryKey: FIELD_KEYS.unit(orgId), queryFn: () => fieldsApi.moneyUnit(api), staleTime: 300_000 });
  const hasSubflow = graph.nodes.some((x) => x.type === "subflow");
  const flows = useQuery({ queryKey: DESIGNER_KEYS.flows(orgId), queryFn: () => designerApi.flows(api), enabled: hasSubflow, retry: false, staleTime: 60_000 });

  // ------------------------------------------------------------------ problems: the live check and the server's
  const sKey = useMemo(() => structureKey(graph), [graph]);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const localProblems = useMemo<FlowProblem[]>(() => {
    const defs: Record<string, FieldDef> = {};
    for (const f of forms.values()) Object.assign(defs, f.fields);
    return validateProcess(graphRef.current, formsReady ? { forms: (fid) => forms.get(fid), fields: defs, titleTemplate: value.draft.title_template } : {});
    // the graph's structure (not its positions) is what the check reads
  }, [sKey, forms, formsReady, value.draft.title_template]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = useMemo(() => liveProblems(localProblems, saved.problems, cleanDraft(saved.draft), cleanDraft(value.draft)), [localProblems, saved, value.draft]);
  const counts = countProblems(problems);

  // ------------------------------------------------------------------ autosave
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Save what is not saved yet, after the saves before it; true when the server then holds the draft. */
  const flush = useCallback((): Promise<boolean> => {
    const run = queue.current.then(async (): Promise<boolean> => {
      const p = savePatch(savedRef.current, draftRef.current);
      if (!p) {
        setState("saved");
        return true;
      }
      setState("saving");
      try {
        const r = await designerApi.save(api, id, p);
        setSaved(r);
        setSavedAt(r.process.updated_at ?? new Date().toISOString());
        setState(savePatch(r, draftRef.current) ? "pending" : "saved");
        void qc.invalidateQueries({ queryKey: HUB_KEYS.all(orgId) });
        return true;
      } catch (e) {
        setState("error");
        if (e instanceof ApiError && e.code === "version_conflict") setConflict(true);
        else n.error(e, { key: `wfp-save-${id}` });
        return false;
      }
    });
    queue.current = run.then(() => undefined);
    return run;
  }, [api, id, n, orgId, qc, setSaved]);
  const patch = useMemo(() => savePatch(saved, value), [saved, value]);
  useEffect(() => {
    if (!offers.edit || conflict) return;
    if (!patch) {
      setState((s) => (s === "saving" ? s : "saved"));
      return;
    }
    setState((s) => (s === "saving" ? s : "pending"));
    const t = window.setTimeout(() => void flush(), 800);
    return () => window.clearTimeout(t);
  }, [patch, offers.edit, conflict, flush]);
  const nameErr = nameProblem(value.name);
  useLeaveGuard(offers.edit && (state !== "saved" || !!nameErr || conflict), `/${orgId}/${HUB_PATH}`);
  useUndoKeys(editable, hist.undo, hist.redo);

  /**
   * The draft becomes what the server holds, history and all. The ref changes at once: a save queued behind this one
   * reads it before the page renders again, and must find nothing to send.
   */
  const resetTo = (d: ProcessDetail) => {
    const next = designerDraft(d);
    draftRef.current = next;
    hist.reset(next);
  };

  /** Another designer saved meanwhile: see theirs (dropping mine), or keep mine over it. */
  const settle = async (keepMine: boolean) => {
    try {
      const fresh = await designerApi.detail(api, id);
      setSaved(fresh);
      if (!keepMine) resetTo(fresh);
      setConflict(false);
      setState("saved");
      if (keepMine) void flush();
    } catch (e) {
      n.error(e);
    }
  };

  // ------------------------------------------------------------------ edits
  const setGraph = useCallback(
    (next: ProcessGraph, key?: string) => {
      const prev = draftRef.current.draft.graph;
      hist.set((d) => ({ ...d, draft: { ...d.draft, graph: next } }), key ?? moveKey(prev, next) ?? undefined);
    },
    [hist.set], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const onCanvasGraph = useCallback((next: ProcessGraph) => setGraph(bridgeRemoved(draftRef.current.draft.graph, next)), [setGraph]);
  const add = (item: PaletteItem, position?: { x: number; y: number }) => {
    if (!editable) return;
    const r = insertAfter(draftRef.current.draft.graph, position ? null : selected, item, { position });
    setGraph(r.graph);
    setSel(r.id);
    if (item.type === "form_step") setTab("people");
    if (!position) setFit((x) => x + 1);
  };
  const onDropType = (type: string, position: { x: number; y: number }) => {
    const item = dragItem.current?.type === type ? dragItem.current : PALETTE_GROUPS.flatMap((g) => g.items).find((i) => i.type === type);
    dragItem.current = null;
    if (item) add(item, position);
  };

  const openProblem = (p: FlowProblem) => {
    const t = problemTarget(p);
    setProblemsOpen(false);
    if (t.node) {
      setMode("design");
      setSel(t.node);
      if (t.tab) setTab(t.tab);
    } else if (t.settings) setSettings({ focus: p.field ?? null });
  };

  const refresh = async () => {
    try {
      setSaved(await designerApi.detail(api, id));
      await qc.invalidateQueries({ queryKey: DESIGNER_KEYS.versions(orgId, id) });
    } catch (e) {
      n.error(e);
    }
  };
  // what is published is the saved draft: a save refused (another designer's meanwhile) stops it, its message shown
  const openPublish = async () => {
    if (await flush()) setPublishing(true);
  };
  const restore = async (v: VersionRow) => {
    if (!(await n.confirm(`بازگرداندن نسخهٔ ${faDigits(v.version_no)} به پیش‌نویس؟`, "پیش‌نویس کنونی با این نسخه جایگزین می‌شود؛ نسخهٔ منتشرشده تا انتشار بعدی تغییر نمی‌کند.", false, "بازگرداندن"))) return;
    queue.current = queue.current.then(async () => {
      try {
        const fresh = await designerApi.restore(api, id, v.id);
        setSaved(fresh);
        resetTo(fresh);
        setState("saved");
        setVersions(false);
        setSel(null);
        setFit((x) => x + 1);
        n.ok(`پیش‌نویس به نسخهٔ ${faDigits(v.version_no)} بازگشت`);
      } catch (e) {
        n.error(e);
      }
    });
  };

  // ------------------------------------------------------------------ the access line of the settings: the next publish's
  const published = !!saved.process.current_version_id;
  const diff = useQuery({
    queryKey: [...HUB_KEYS.diff(orgId, id), "settings", saved.process.version],
    queryFn: () => hubApi.diff(api, id),
    enabled: !!settings && published,
    staleTime: 0,
  });

  // ------------------------------------------------------------------ header
  const chip = statusChip(saved.process);
  const name = value.name.trim() || saved.process.name;
  const problemsLine = problemsText(problems);
  const header = (
    <PageHeader
      back={`/${orgId}/${HUB_PATH}`}
      title={name}
      subtitle={
        <span className="wfm-toolbar">
          <Chip tone={chip.tone}>{chip.label}</Chip>
          {saved.unpublished && saved.process.status !== "draft" ? <Chip tone="warning">تغییرهای منتشرنشده</Chip> : null}
          {offers.edit ? <SaveStatus state={nameErr ? "invalid" : state} at={savedAt} problems={nameErr ? 1 : 0} onRetry={() => void flush()} /> : null}
          {problemsLine ? (
            <button type="button" className={cx("wfp-probs-btn", counts.errors ? "is-error" : "is-warning")} onClick={() => setProblemsOpen(true)}>
              {problemsLine}
            </button>
          ) : (
            <span className="wfp-ok">بی‌ایراد</span>
          )}
        </span>
      }
      actions={
        phone ? null : (
          <>
            {editable ? (
              <>
                <Tooltip title="واگرد (Ctrl+Z)">
                  <Button icon={<Undo2 {...I16} />} onClick={hist.undo} disabled={!hist.canUndo} aria-label="واگرد" />
                </Tooltip>
                <Tooltip title="ازنو (Ctrl+Shift+Z)">
                  <Button icon={<Redo2 {...I16} />} onClick={hist.redo} disabled={!hist.canRedo} aria-label="ازنو" />
                </Tooltip>
              </>
            ) : null}
            <Tooltip title="تنظیمات گردش‌کار">
              <Button icon={<Settings2 {...I16} />} onClick={() => setSettings({ focus: null })} aria-label="تنظیمات گردش‌کار" />
            </Tooltip>
            {offers.preview ? (
              <Button icon={mode === "preview" ? <PencilRuler {...I16} /> : <Eye {...I16} />} aria-pressed={mode === "preview"} onClick={() => setMode((m) => (m === "preview" ? "design" : "preview"))}>
                {mode === "preview" ? "طراحی" : "پیش‌نمایش"}
              </Button>
            ) : null}
            <Button icon={<History {...I16} />} onClick={() => setVersions(true)}>
              نسخه‌ها
            </Button>
            {offers.publish ? (
              <Tooltip title={conflict || state === "error" ? "پیش از انتشار، تغییرها باید ذخیره شوند" : undefined}>
                <Button type="primary" icon={<Send {...I16} />} onClick={() => void openPublish()} disabled={conflict || state === "error" || !!nameErr}>
                  انتشار
                </Button>
              </Tooltip>
            ) : (
              <span className="wfp-quiet">{saved.can.publish ? (writable ? CONNECTION_NEEDED : "") : PUBLISH_REFUSAL}</span>
            )}
            {offers.retire ? (
              <Dropdown
                trigger={["click"]}
                menu={{ items: [{ key: "retire", label: "بازنشسته‌کردن…", icon: <Archive {...I14} /> }], onClick: () => setRetiring(true) }}
              >
                <Button icon={<MoreHorizontal {...I16} />} aria-label="کارهای دیگر" />
              </Dropdown>
            ) : null}
          </>
        )
      }
    />
  );

  // ------------------------------------------------------------------ phones read the steps
  if (phone)
    return (
      <div className="rk-admin wfp-page">
        {header}
        <Note>ویرایش این گردش‌کار روی رایانه ممکن است.</Note>
        <StepList graph={graph} notes={phoneNotes(problems)} label={`مرحله‌های «${name}»`} />
      </div>
    );

  // ------------------------------------------------------------------ palette, canvas, inspector
  const selTitle = selNode ? nodeTitle(selNode) : "";
  const palette = (
    <aside className="wfm-panel wfp-palette" aria-label="گام‌ها">
      {PALETTE_GROUPS.map((g) => (
        <div key={g.group} className="wfp-pal-group" role="group" aria-label={g.group}>
          <h2 className="wfm-panel-t">{g.group}</h2>
          <ul className="wfp-pal-list">
            {g.items.map((item) => {
              const Icon = PALETTE_ICON[item.key];
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className="wfp-pal-item"
                    draggable={editable}
                    disabled={!editable}
                    title={item.hint}
                    aria-label={`افزودن «${item.label}»${selNode ? " پس از گام برگزیده" : ""}`}
                    onClick={() => add(item)}
                    onDragStart={(e: DragEvent) => {
                      e.dataTransfer.setData(PROCESS_NODE_MIME, item.type);
                      e.dataTransfer.effectAllowed = "move";
                      dragItem.current = item;
                    }}
                    onDragEnd={() => (dragItem.current = null)}
                  >
                    <span className="wfp-pal-ic" aria-hidden>
                      {Icon ? <Icon {...I14} /> : <ProcessNodeIcon type={item.type} size={14} />}
                    </span>
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="rk-hint">{selNode ? `گام تازه پس از «${selTitle}» می‌آید.` : "گامی را برگزینید تا گام تازه پس از آن بیاید، یا گام را روی نمودار بکشید."}</p>
    </aside>
  );

  const nodeProblems = selNode ? problems.filter((p) => p.node === selNode.id) : [];
  const summary = (
    <div className="wfp-insp">
      <div className="wfp-insp-h">
        <div className="wfp-insp-t">
          <h2>{name}</h2>
          <span className="rk-hint">گردش‌کار</span>
        </div>
      </div>
      <dl className="wfp-facts">
        <dt>مرحله‌ها</dt>
        <dd>{faDigits(graph.nodes.filter((x) => x.type === "form_step").length)}</dd>
        <dt>فرم‌ها</dt>
        <dd>{formIds.length ? formIds.map((fid) => forms.get(fid)?.name ?? "…").join("، ") : "هنوز فرمی در مرحله‌ها نیست"}</dd>
        <dt>پرونده‌های باز</dt>
        <dd>{faDigits(saved.open_cases)}</dd>
        <dt>مسئولان</dt>
        <dd>{value.draft.managers.length || value.draft.manager_groups.length ? [...value.draft.managers, ...value.draft.manager_groups].map((x) => saved.display[x] ?? "…").join("، ") : "تعیین نشده"}</dd>
        <dt>آغازکنندگان</dt>
        <dd>{startersText(value.draft.starters)}</dd>
        <dt>محرمانه</dt>
        <dd>{value.draft.confidential ? "بله" : "خیر"}</dd>
      </dl>
      <span className="wfp-acts">
        <Button onClick={() => setSettings({ focus: null })} icon={<Settings2 {...I14} />}>
          تنظیمات گردش‌کار
        </Button>
        {problems.length ? <Button onClick={() => setProblemsOpen(true)}>{problemsLine}</Button> : null}
      </span>
      <p className="rk-hint">گامی را روی نمودار برگزینید تا تنظیم‌هایش این‌جا بیاید.</p>
    </div>
  );

  const inspector = selNode ? (
    <NodeInspector
      key={selNode.id}
      node={selNode}
      graph={graph}
      editable={editable}
      problems={nodeProblems}
      tab={tab}
      onTab={setTab}
      onGraph={setGraph}
      onSelect={setSel}
      onNewForm={setNewForm}
      onSettings={(field) => setSettings({ focus: field ?? null })}
      forms={forms}
      formLoading={(fid) => formsQ.loading[formIds.indexOf(fid)] ?? false}
      formChoices={formChoices}
      fields={fields}
      unit={unit.data ?? "rial"}
      orgId={orgId}
      canNewForm={fa.designWrite}
      canNotify={!!matchItem(items, "notify/rules")}
      flows={flows.error ? "denied" : (flows.data ?? null)}
      starters={value.draft.starters}
    />
  ) : (
    summary
  );

  const newFormStep = newForm ? graph.nodes.find((x) => x.id === newForm) : undefined;
  return (
    <div className="rk-admin wfm-page wfp-page">
      {header}
      {conflict ? (
        <Alert
          type="warning"
          showIcon
          title="کس دیگری هم‌زمان این گردش‌کار را تغییر داد؛ تغییرهای شما ذخیره نشد."
          action={
            <span className="wfp-acts">
              <Button size="small" onClick={() => void settle(false)}>
                دیدن تغییرهای تازه
              </Button>
              <Button size="small" type="primary" onClick={() => void settle(true)}>
                نگه‌داشتن تغییرهای من
              </Button>
            </span>
          }
        />
      ) : null}
      {!offers.edit && saved.can.write === false ? <Note>این گردش‌کار را می‌بینید ولی ویرایش آن با طراحان گردش‌کار است.</Note> : null}
      <div className={cx("wfp-designer", mode === "preview" && "is-preview")}>
        {mode === "design" ? palette : null}
        <ProcessCanvas
          className="wfp-canvas"
          graph={graph}
          problems={mode === "design" ? problems : undefined}
          notes={mode === "preview" ? notes : undefined}
          selected={selected}
          onSelect={setSel}
          onGraph={editable ? onCanvasGraph : undefined}
          readOnly={!editable}
          onDropType={(type, position) => onDropType(type, position)}
          onProblem={(m) => n.warn(m)}
          fitKey={fit}
          label={`نمودار «${name}»`}
        />
        {mode === "preview" ? (
          <PreviewPanel graph={graph} draft={value.draft} fields={fields} forms={forms} unit={unit.data ?? "rial"} selected={selected} onSelect={setSel} onNotes={setNotes} />
        ) : (
          <aside className="wfm-panel wfp-inspector" aria-label="تنظیم‌های گام برگزیده">
            {inspector}
          </aside>
        )}
      </div>
      {settings ? (
        <ProcessSettings
          value={value}
          onChange={(next, key) => hist.set(next, key)}
          editable={offers.edit}
          process={saved.process}
          fields={fields}
          titleFields={titleFields(graph, forms)}
          startFields={startFields(graph, forms)}
          access={published ? (diff.data?.diff.access ?? null) : null}
          focus={settings.focus}
          onClose={() => setSettings(null)}
        />
      ) : null}
      {versions ? <VersionsDrawer id={id} canRestore={offers.restore} onRestore={(v) => void restore(v)} onClose={() => setVersions(false)} /> : null}
      {problemsOpen ? <ProblemsDrawer problems={problems} graph={graph} onOpen={openProblem} onClose={() => setProblemsOpen(false)} /> : null}
      {publishing ? (
        <PublishDialog
          process={{ id, name: saved.process.name, retired: saved.process.status === "retired" }}
          canPublish={saved.can.publish}
          authority={authority}
          onClose={() => setPublishing(false)}
          onDone={() => void refresh()}
        />
      ) : null}
      {retiring ? <RetireDialog process={{ id, name: saved.process.name, open_cases: saved.open_cases }} onClose={() => setRetiring(false)} onDone={() => void refresh()} /> : null}
      {newForm && newFormStep ? (
        <NewFormDialog
          name={`فرم ${newFormStep.label || (formStepOf(newFormStep.config).start ? "درخواست" : "مرحله")}`}
          onClose={() => setNewForm(null)}
          onMade={(f) => {
            setNewForm(null);
            setGraph(patchConfig(draftRef.current.draft.graph, newFormStep.id, formPatch(newFormStep.config, f.id)));
            setTab("form");
            n.ok(`فرم «${f.name}» ساخته شد`, {
              description: "فیلدهای آن را در «طراحی این فرم» بچینید.",
              action: {
                label: "طراحی این فرم",
                onClick: () => void flush().then((ok) => ok && nav(`/${orgId}/settings/forms/${f.id}`)),
              },
            });
          }}
        />
      ) : null}
    </div>
  );
}
