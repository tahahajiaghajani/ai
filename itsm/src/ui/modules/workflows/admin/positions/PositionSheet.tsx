// A position's side sheet (design F §3.4, §8): the position — name, key (never changed once made: published workflows
// name it), the kind of unit it is held in, whom it reports to, active — and its holders: person, unit, kind
// («اصلی»، «سرپرست (کفیل)»، «موقت»), the period and the source chip («دستی»، «فهرست کاربران (AD)»، «ورود از فایل»). A
// holder the directory or a file keeps keeps its person and unit (it is ended or removed instead); ended holders are
// shown on request. The demo pack's people are marked «نمایشی»; making one of them a holder asks first (the
// organisation's own cases never reach them, FINAL-1). A half-filled holder is never dropped without a question: the
// Escape key leaves the sheet open while the holder form is, and closing asks (B8). Writes go through the generic
// record API, where `org` write decides, unit by unit.
import { useEffect, useId, useMemo, useState } from "react";
import { Button, Drawer, Input, Popconfirm, Select, Switch, Table, Tooltip } from "antd";
import { CalendarX, Pencil, Plus, Trash2, UserSearch } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HOLDER_KINDS } from "@shared/tables/positions";
import { UNIT_KINDS } from "@shared/tables/access";
import { localDate } from "@shared/model/jalali-buckets";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { errorText } from "../../../../lib/api";
import { Chip, EmptyState, JDate, Loader } from "../../../../components/display";
import { DateInput } from "../../../../components/inputs";
import { RecordSelect } from "../../../../records/fields/RecordSelect";
import { displayOf } from "../../../../records/model/schema";
import { fieldErrorsOf } from "../../../../records/model/types";
import { DemoTag, MemberSelect, PositionPicker, isDemo, useDemoPeople } from "../../kit";
import { F, useCloseGuard, useSheetSize } from "../fields/parts";
import { POSITION_KEYS, positionsApi, type HolderRow, type PositionOverview } from "./api";
import {
  HOLDER_STATE_LABELS, addsDemoHolder, demoHolderQuestion, endingSoon, fixedPlace, holderFormDirty, holderKindLabel, holderProblems, holderSourceLabel, holderStart, holderState,
  keyInput, sheetClose, sortHolders, validKey, type HolderDraft, type PositionsAccess,
} from "./model";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

interface PositionDraft {
  name: string;
  key: string;
  unit_kind: string | null;
  reports_to: string | null;
  active: boolean;
  description: string;
}

export interface PositionSheetProps {
  id: string | null;
  overview: PositionOverview | null;
  access: PositionsAccess;
  /** today in the organisation's zone (the overview's), else the browser's */
  today: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** «پیش‌نمایش» of who this position finds for a sample requester */
  onPreview: (id: string) => void;
}

export function PositionSheet({ id, overview, access, today: serverToday, onClose, onSaved, onPreview }: PositionSheetProps) {
  const { api, orgId, timezone } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const idp = useId().replace(/:/g, "");
  const size = useSheetSize(720);
  const today = serverToday ?? localDate(Date.now(), timezone);
  const row = useQuery({ queryKey: POSITION_KEYS.position(orgId, id ?? "new"), queryFn: () => positionsApi.position(api, id!), enabled: !!id });
  const initial = useMemo<PositionDraft | null>(() => {
    if (!id) return { name: "", key: "", unit_kind: null, reports_to: null, active: true, description: "" };
    const r = row.data;
    if (!r) return null;
    return { name: String(r.name ?? ""), key: String(r.key ?? ""), unit_kind: (r.unit_kind as string) ?? null, reports_to: (r.reports_to as string) ?? null, active: r.active !== false, description: String(r.description ?? "") };
  }, [id, row.data]);
  const [d, setD] = useState<PositionDraft | null>(initial);
  useEffect(() => setD(initial), [initial]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // the holder form inside the sheet: open, and changed since it opened (B8)
  const [holderForm, setHolderForm] = useState<{ open: boolean; dirty: boolean }>({ open: false, dirty: false });
  const dirty = !!d && !!initial && JSON.stringify(d) !== JSON.stringify(initial);
  const closing = sheetClose({ manage: access.manage, positionDirty: dirty, holderOpen: holderForm.open, holderDirty: holderForm.dirty });
  const close = useCloseGuard(closing.guard, onClose);
  const set = (p: Partial<PositionDraft>) => setD((x) => (x ? { ...x, ...p } : x));
  const readOnly = !access.manage;
  // a position that cannot be read (removed, an old link) says why instead of waiting forever
  const failed = !!id && row.isError;

  const save = async () => {
    if (!d) return;
    const errs: Record<string, string> = {};
    if (!d.name.trim()) errs.name = "نام نقش را بنویسید";
    if (!id && !validKey(d.key)) errs.key = "کلید با حرف لاتین کوچک شروع می‌شود و فقط حرف کوچک، رقم و _ دارد (مانند branch_head)";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const data: Record<string, unknown> = { name: d.name.trim(), unit_kind: d.unit_kind, reports_to: d.reports_to, active: d.active, description: d.description.trim() || null };
      if (!id) data.key = d.key;
      const r = await positionsApi.savePosition(api, id, data, row.data ? Number(row.data.version) : undefined);
      await qc.invalidateQueries({ queryKey: POSITION_KEYS.all(orgId) });
      n.ok(`نقش «${d.name.trim()}» ذخیره شد`);
      onSaved(r.row.id);
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (Object.keys(fe).length) setErrors(fe);
      else n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const title = id ? (overview?.name ?? String(row.data?.name ?? "نقش سازمانی")) : "نقش سازمانی تازه";
  // one of the demo pack's positions: marked, and making a pack person its holder asks nothing (FINAL-1 is for the organisation's own)
  const packPosition = !!id && (overview?.demo ?? row.data?.demo) === true;
  return (
    <Drawer
      open
      size={size}
      placement="left"
      onClose={close}
      keyboard={closing.keyboard}
      destroyOnHidden
      title={
        <span className="wff-title">
          {title}
          {d && !d.active ? <Chip dot={false}>غیرفعال</Chip> : null}
          {packPosition ? <DemoTag title="نقش سازمانی دادهٔ نمایشی" /> : null}
        </span>
      }
      footer={
        readOnly || failed ? null : (
          <div className="wff-foot">
            <span className="wff-foot-gap" />
            <Button onClick={close}>{id ? "بستن" : "انصراف"}</Button>
            <Button type="primary" onClick={save} loading={busy} disabled={!d || (!!id && !dirty)}>
              {id ? "ذخیرهٔ نقش" : "ساخت نقش"}
            </Button>
          </div>
        )
      }
    >
      {failed ? (
        <EmptyState title="این نقش باز نشد" description={errorText(row.error)} action={<Button onClick={onClose}>بستن</Button>} />
      ) : !d ? (
        <div className="grid place-items-center py-10">
          <Loader />
        </div>
      ) : (
        <div className="wff-sheet">
          <section className="wff-sec" aria-labelledby={`${idp}-p`}>
            <h3 id={`${idp}-p`}>نقش</h3>
            <div className="wff-grid">
              <F label="نام" htmlFor={`${idp}-name`} error={errors.name}>
                <Input id={`${idp}-name`} value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} disabled={readOnly} autoFocus={!id} placeholder="رئیس شعبه" />
              </F>
              <F label="کلید" htmlFor={`${idp}-key`} error={errors.key} hint={id ? "پس از ساخت تغییر نمی‌کند؛ گردش‌کارها با آن به این نقش اشاره می‌کنند" : "مانند branch_head"}>
                <Input id={`${idp}-key`} dir="ltr" className="ds-mono" value={d.key} onChange={(e) => set({ key: keyInput(e.target.value) })} maxLength={40} disabled={readOnly || !!id} />
              </F>
              <F label="در واحدهای نوع" htmlFor={`${idp}-kind`} hint="دارندگان در واحدهای همین نوع هستند؛ خالی: همه‌جا">
                <Select id={`${idp}-kind`} value={d.unit_kind ?? undefined} allowClear onChange={(v) => set({ unit_kind: v ?? null })} options={UNIT_KINDS.map((o) => ({ value: o.value, label: o.label }))} disabled={readOnly} placeholder="همه‌جا" />
              </F>
              <F label="گزارش به" htmlFor={`${idp}-up`} hint="نقشی که تشدید مهلت به دارندهٔ آن می‌رسد">
                <PositionPicker id={`${idp}-up`} value={d.reports_to} onChange={(v) => set({ reports_to: (v as string | null) ?? null })} filter={id ? { f: "id", op: "ne", v: id } : null} disabled={readOnly} placeholder="هیچ" />
              </F>
              <F label="شرح" htmlFor={`${idp}-desc`} className="wff-wide">
                <Input.TextArea id={`${idp}-desc`} value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} autoSize={{ minRows: 1, maxRows: 4 }} disabled={readOnly} />
              </F>
              <F label="فعال">
                <span className="rk-switch">
                  <Switch checked={d.active} onChange={(v) => set({ active: v })} disabled={readOnly} aria-label="فعال" size="small" />
                  <span className="text-ink-2">{d.active ? "در گردش‌کارها پیشنهاد می‌شود" : "برای گردش‌کار تازه پیشنهاد نمی‌شود"}</span>
                </span>
              </F>
            </div>
          </section>
          {id && initial ? <Holders positionId={id} unitKind={initial.unit_kind} active={initial.active} packPosition={packPosition} access={access} today={today} onPreview={onPreview} onForm={setHolderForm} /> : null}
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Holders

function Holders({
  positionId, unitKind, active, packPosition, access, today, onPreview, onForm,
}: { positionId: string; unitKind: string | null; active: boolean; packPosition: boolean; access: PositionsAccess; today: string; onPreview: (id: string) => void; onForm: (f: { open: boolean; dirty: boolean }) => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const demo = useDemoPeople();
  const idp = useId().replace(/:/g, "");
  const [withEnded, setWithEnded] = useState(false);
  const [editing, setEditing] = useState<HolderRow | "new" | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  useEffect(() => onForm({ open: !!editing, dirty: !!editing && formDirty }), [editing, formDirty, onForm]);
  const holders = useQuery({ queryKey: POSITION_KEYS.holders(orgId, positionId), queryFn: () => positionsApi.holders(api, positionId) });
  const display = holders.data?.display;
  const name = (uid: string) => displayOf(display, uid) ?? "";
  const rows = sortHolders(holders.data?.rows ?? [], today, withEnded, name);
  const ended = (holders.data?.rows ?? []).filter((h) => holderState(h, today) === "ended").length;
  const refresh = () => qc.invalidateQueries({ queryKey: POSITION_KEYS.all(orgId) });

  const endToday = async (h: HolderRow) => {
    try {
      await positionsApi.saveHolder(api, h.id, { valid_to: today }, h.version);
      await refresh();
      n.ok(`دورهٔ «${name(h.user_id)}» امروز پایان یافت`);
    } catch (e) {
      n.error(e);
    }
  };
  const remove = async (h: HolderRow) => {
    try {
      await positionsApi.removeHolder(api, h.id, h.version);
      await refresh();
      n.ok(`«${name(h.user_id)}» از دارندگان برداشته شد`);
    } catch (e) {
      n.error(e);
    }
  };

  return (
    <section className="wff-sec" aria-labelledby={`${idp}-h`}>
      <div className="wfp-sec-h">
        <h3 id={`${idp}-h`}>دارندگان</h3>
        <span className="wfp-sec-x">
          {ended ? (
            <Button size="small" type="text" onClick={() => setWithEnded((x) => !x)}>
              {withEnded ? "پنهان کردن پایان‌یافته‌ها" : `نمایش پایان‌یافته‌ها (${faDigits(ended)})`}
            </Button>
          ) : null}
          {access.preview ? (
            <Button size="small" icon={<UserSearch {...I14} />} onClick={() => onPreview(positionId)}>
              پیش‌نمایش
            </Button>
          ) : null}
          {access.manage && active ? (
            <Button size="small" type="primary" icon={<Plus {...I14} />} onClick={() => setEditing("new")}>
              دارندهٔ تازه
            </Button>
          ) : null}
        </span>
      </div>
      {editing ? (
        <HolderForm
          positionId={positionId}
          unitKind={unitKind}
          holder={editing === "new" ? null : editing}
          display={display}
          demo={demo}
          packPosition={packPosition}
          onDirty={setFormDirty}
          onDone={async (text) => {
            setFormDirty(false);
            setEditing(null);
            if (text) {
              await refresh();
              n.ok(text);
            }
          }}
        />
      ) : null}
      {holders.isLoading ? (
        <Loader />
      ) : !rows.length ? (
        <p className="rk-hint">{ended ? "دارندهٔ جاری ندارد." : "هنوز دارنده‌ای ندارد."}</p>
      ) : (
        <Table<HolderRow>
          size="small"
          className="ds-table"
          rowKey="id"
          dataSource={rows}
          pagination={rows.length > 20 ? { pageSize: 20, showSizeChanger: false, size: "small" } : false}
          scroll={{ x: 640 }}
          rowClassName={(h) => (holderState(h, today) === "ended" ? "wff-dim" : "")}
          columns={[
            {
              key: "who",
              title: "دارنده",
              render: (_: unknown, h) => (
                <span className="wfp-who-cell">
                  <span className="text-ink">{name(h.user_id) || "—"}</span>
                  {isDemo(demo, h.user_id) ? <DemoTag /> : null}
                </span>
              ),
            },
            { key: "unit", title: "واحد", render: (_: unknown, h) => (h.org_unit_id ? displayOf(display, h.org_unit_id) ?? "—" : <span className="text-ink-3">—</span>) },
            { key: "kind", title: "نوع", render: (_: unknown, h) => holderKindLabel(h.kind) },
            {
              key: "period",
              title: "دوره",
              render: (_: unknown, h) => {
                const s = holderState(h, today);
                return (
                  <span className="wff-cell-2">
                    <span>
                      {h.valid_from ? <JDate v={h.valid_from} /> : "…"} تا {h.valid_to ? <JDate v={h.valid_to} /> : "اطلاع بعدی"}
                    </span>
                    {s !== "current" ? <span className="rk-hint">{HOLDER_STATE_LABELS[s]}</span> : endingSoon(h, today) ? <span className="rk-hint">پایان نزدیک</span> : null}
                  </span>
                );
              },
            },
            { key: "source", title: "منبع", render: (_: unknown, h) => <Chip tone={h.source === "directory" ? "info" : "neutral"} dot={h.source !== "manual"}>{holderSourceLabel(h.source)}</Chip> },
            {
              key: "a",
              title: <span className="sr-only">کارها</span>,
              width: 112,
              fixed: "end" as const,
              render: (_: unknown, h) =>
                access.manage || access.remove ? (
                  <span className="inline-flex">
                    {access.manage ? (
                      <Tooltip title="ویرایش">
                        <Button type="text" size="small" icon={<Pencil {...I14} />} onClick={() => setEditing(h)} aria-label={`ویرایش دارندگی ${name(h.user_id)}`} />
                      </Tooltip>
                    ) : null}
                    {access.manage && holderState(h, today) !== "ended" ? (
                      <Popconfirm title={`دورهٔ «${name(h.user_id)}» امروز پایان یابد؟`} okText="پایان امروز" cancelText="انصراف" onConfirm={() => endToday(h)}>
                        <Tooltip title="پایان امروز">
                          <Button type="text" size="small" icon={<CalendarX {...I14} />} aria-label={`پایان دورهٔ ${name(h.user_id)}`} />
                        </Tooltip>
                      </Popconfirm>
                    ) : null}
                    {access.remove ? (
                      <Popconfirm title={`«${name(h.user_id)}» از دارندگان برداشته شود؟`} description={h.source === "directory" ? "اگر هنوز در گروه AD باشد، همگام‌سازی بعدی دوباره آن را می‌افزاید." : undefined} okText="برداشتن" okButtonProps={{ danger: true }} cancelText="انصراف" onConfirm={() => remove(h)}>
                        <Tooltip title="برداشتن">
                          <Button type="text" size="small" danger icon={<Trash2 {...I14} />} aria-label={`برداشتن ${name(h.user_id)}`} />
                        </Tooltip>
                      </Popconfirm>
                    ) : null}
                  </span>
                ) : null,
            },
          ]}
        />
      )}
    </section>
  );
}

function HolderForm({
  positionId, unitKind, holder, display, demo, packPosition, onDirty, onDone,
}: {
  positionId: string;
  unitKind: string | null;
  holder: HolderRow | null;
  display: Record<string, string> | undefined;
  demo: ReadonlySet<string>;
  /** one of the demo pack's positions: a pack person as its holder asks nothing */
  packPosition: boolean;
  onDirty: (dirty: boolean) => void;
  onDone: (text: string | null) => void;
}) {
  const { api } = useOrg();
  const n = useNotify();
  const idp = useId().replace(/:/g, "");
  const [d, setD] = useState<HolderDraft>(() => holderStart(holder));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const fixed = !!holder && fixedPlace(holder);
  const set = (p: Partial<HolderDraft>) => setD((x) => ({ ...x, ...p }));
  const dirty = holderFormDirty(d, holder);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const save = async () => {
    const errs = holderProblems(d, { unit_kind: unitKind });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // one of the demo pack's people on one of the organisation's own positions: its own cases never reach them (FINAL-1)
    if (addsDemoHolder(d, holder, demo, packPosition)) {
      const q = demoHolderQuestion(person ?? (d.user_id ? displayOf(display, d.user_id) : null));
      if (!(await n.confirm(q.title, q.content, false, "افزودن"))) return;
    }
    setBusy(true);
    try {
      const data: Record<string, unknown> = { kind: d.kind, valid_from: d.valid_from, valid_to: d.valid_to };
      if (!fixed) Object.assign(data, { user_id: d.user_id, org_unit_id: d.org_unit_id });
      if (!holder) data.position_id = positionId;
      await positionsApi.saveHolder(api, holder?.id ?? null, data, holder?.version);
      onDone(holder ? "دارندگی به‌روز شد" : "دارندهٔ تازه افزوده شد");
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (Object.keys(fe).length) setErrors(fe);
      else n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wfp-form" role="group" aria-label={holder ? "ویرایش دارندگی" : "دارندهٔ تازه"}>
      <div className="wff-grid">
        <F label="دارنده" htmlFor={`${idp}-u`} error={errors.user_id} hint={fixed ? "این دارنده را AD یا فایل نگه می‌دارد؛ شخص و واحدش آن‌جا تغییر می‌کند" : undefined}>
          <MemberSelect
            id={`${idp}-u`}
            value={d.user_id}
            onChange={(v, picked) => {
              set({ user_id: (v as string | null) ?? null });
              setPerson(picked?.[0]?.label ?? null);
            }}
            display={display}
            disabled={fixed}
            aria-label="دارنده"
          />
        </F>
        <F label="واحد" htmlFor={`${idp}-o`} error={errors.org_unit_id}>
          <RecordSelect id={`${idp}-o`} table="org_unit" value={d.org_unit_id} onChange={(v) => set({ org_unit_id: (v as string | null) ?? null })} filter={unitKind ? { f: "kind", op: "eq", v: unitKind } : null} display={display} disabled={fixed} allowClear={!unitKind} aria-label="واحد" />
        </F>
        <F label="نوع" htmlFor={`${idp}-k`}>
          <Select id={`${idp}-k`} value={d.kind} onChange={(v) => set({ kind: v })} options={HOLDER_KINDS.map((o) => ({ value: o.value, label: o.label }))} />
        </F>
        <span />
        <F label="از تاریخ" htmlFor={`${idp}-f`}>
          <DateInput id={`${idp}-f`} value={d.valid_from} onChange={(v) => set({ valid_from: v })} allowClear aria-label="از تاریخ" />
        </F>
        <F label="تا تاریخ" htmlFor={`${idp}-t`} error={errors.valid_to} hint="خالی: تا اطلاع بعدی؛ روز پایان هم جزو دوره است">
          <DateInput id={`${idp}-t`} value={d.valid_to} onChange={(v) => set({ valid_to: v })} allowClear aria-label="تا تاریخ" />
        </F>
      </div>
      <div className="wff-foot">
        <span className="wff-foot-gap" />
        <Button size="small" onClick={() => onDone(null)}>
          انصراف
        </Button>
        <Button size="small" type="primary" onClick={save} loading={busy}>
          {holder ? "ذخیره" : "افزودن"}
        </Button>
      </div>
    </div>
  );
}
