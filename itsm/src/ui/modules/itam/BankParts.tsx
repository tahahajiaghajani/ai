// Record-page extensions of the bank layer of IT asset management:
//   asset_transfer       «ثبت رسید» for the receiving branch (per item: received, damaged or missing, condition, note)
//   inventory_audit      «مغایرت‌ها» (settle every discrepancy of a completed count) and «شمارش با گوشی»
//   branch_attestation   «تأیید فهرست اموال» (the branch's list, exceptions, the signature)
//   asset                «ویژگی‌های رده» (the device class's attributes) and the verified chain of custody
//   disposal_item        «گواهی پاک‌سازی» (a printable data-wipe certificate with its SHA-256 fingerprint)
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, Drawer, Input, InputNumber, Modal, Select, Switch, Table } from "antd";
import { BadgeCheck, FileBadge, PackageCheck, Printer, ShieldCheck, Smartphone, Stamp } from "lucide-react";
import { deviceClass, RESOLUTIONS_FOR, type AuditResult } from "@shared/itam/bank";
import { AUDIT_RESOLUTIONS, CONDITIONS, CUSTODY_EVENTS, TRANSFER_ITEM_RESULTS, TRANSFER_REASONS } from "@shared/tables/itam";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Card, Field, Note, PrintFoot, PrintHead } from "../../components/blocks";
import { Chip, Loader } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { recordsApi, RecordSelect } from "../../records";
import type { RecordContext } from "../../records/extensions";
import { bankApi, BANK_KEYS, type TransferItemView } from "./api";
import { ICON } from "./parts";

const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v ?? "—");

// ---------------------------------------------------------------------------------------------------------------
// Transfers: the receipt

type Receipt = { result: "received" | "damaged" | "missing"; condition_in: string | null; note: string };

export function ReceiveDrawer({ transferId, title, onClose, onDone }: { transferId: string; title: string; onClose: () => void; onDone: () => void }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const q = useQuery({ queryKey: BANK_KEYS.transfer(orgId, transferId), queryFn: () => bankApi.transferItems(api, transferId) });
  const [rows, setRows] = useState<Record<string, Receipt>>({});
  const [note, setNote] = useState("");
  useEffect(() => {
    if (q.data) setRows(Object.fromEntries(q.data.items.map((i) => [i.id, { result: "received" as const, condition_in: i.condition_out ?? "good", note: "" }])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => bankApi.receive(api, transferId, { items: Object.entries(rows).map(([id, r]) => ({ id, result: r.result, condition_in: r.result === "missing" ? null : r.condition_in, note: r.note || null })), note: note || null }),
    onSuccess: (r) => {
      message.success(r.discrepancies ? `رسید با ${fa(r.discrepancies)} مغایرت ثبت شد` : "رسید کامل ثبت شد");
      onDone();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const set = (id: string, patch: Partial<Receipt>) => setRows((x) => ({ ...x, [id]: { ...x[id], ...patch } }));
  return (
    <Drawer open title={`رسید انتقال — ${title}`} size="large" onClose={onClose} destroyOnHidden
      extra={<Button type="primary" icon={<PackageCheck {...ICON} />} loading={save.isPending} disabled={!q.data?.transfer.can_receive} onClick={() => save.mutate()}>ثبت رسید</Button>}>
      {q.isLoading ? <Loader /> : !q.data ? null : (
        <div className="flex flex-col gap-3">
          {!q.data.transfer.can_receive ? <Note tone="warning">رسید این حواله با شعبه یا واحد گیرنده است و حواله باید در راه باشد.</Note> : null}
          <Table<TransferItemView> size="small" rowKey="id" pagination={false} dataSource={q.data.items} scroll={{ x: true }} columns={[
            { title: "دارایی", dataIndex: "label" },
            { title: "هنگام ارسال", key: "out", render: (_: unknown, r: TransferItemView) => label(CONDITIONS, r.condition_out) },
            { title: "نتیجه", key: "res", render: (_: unknown, r: TransferItemView) => (
              <Select size="small" value={rows[r.id]?.result} onChange={(v) => set(r.id, { result: v })} style={{ width: 130 }} options={[{ value: "received", label: "رسید" }, { value: "damaged", label: "رسید با آسیب" }, { value: "missing", label: "نرسید" }]} />
            ) },
            { title: "وضعیت ظاهری", key: "in", render: (_: unknown, r: TransferItemView) => (
              <Select size="small" disabled={rows[r.id]?.result === "missing"} value={rows[r.id]?.condition_in ?? undefined} onChange={(v) => set(r.id, { condition_in: v })} style={{ width: 120 }} options={CONDITIONS.map((c) => ({ value: c.value, label: c.label }))} />
            ) },
            { title: "یادداشت", key: "note", render: (_: unknown, r: TransferItemView) => <Input size="small" value={rows[r.id]?.note} onChange={(e) => set(r.id, { note: e.target.value })} maxLength={300} /> },
          ]} />
          <Field label="یادداشت رسید"><Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} /></Field>
        </div>
      )}
    </Drawer>
  );
}

export function TransferActions({ ctx }: { ctx: RecordContext }) {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  const [open, setOpen] = useState(false);
  if (ctx.row.state !== "in_transit") return null;
  return (
    <>
      <Button type="primary" icon={<PackageCheck {...ICON} />} onClick={() => setOpen(true)}>ثبت رسید</Button>
      {open ? <ReceiveDrawer transferId={String(ctx.row.id)} title={String(ctx.row.number ?? "")} onClose={() => setOpen(false)} onDone={() => { setOpen(false); ctx.refresh(); void qc.invalidateQueries({ queryKey: ["itam", orgId] }); }} /> : null}
    </>
  );
}

/** «حواله و رسید»: the note's items with their receipt, printable with the three signatures of the hand-over. */
export function TransferPrintTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: BANK_KEYS.transfer(orgId, id), queryFn: () => bankApi.transferItems(api, id) });
  const name = (field: string) => ctx.display[String(ctx.row[field] ?? "")] ?? "—";
  return (
    <div className="flex flex-col gap-3">
      <div className="no-print"><Button size="small" icon={<Printer {...ICON} />} onClick={() => window.print()}>چاپ حواله</Button></div>
      <PrintHead title={`حوالهٔ انتقال دارایی — ${String(ctx.row.title ?? "")}`} no={String(ctx.row.number ?? "")} date={ctx.row.dispatched_at ? String(ctx.row.dispatched_at).slice(0, 10) : null}
        lines={[`از ${name("from_branch_id")} به ${name("to_branch_id")}`, label(TRANSFER_REASONS, ctx.row.reason), ctx.row.waybill_no ? `بارنامه ${String(ctx.row.waybill_no)}` : ""]} />
      {q.isLoading ? <Loader /> : (
        <Card title="اقلام" flush>
          <Table<TransferItemView> size="small" rowKey="id" pagination={false} dataSource={q.data?.items ?? []} columns={[
            { title: "ردیف", key: "i", width: 60, render: (_: unknown, __: TransferItemView, i: number) => <span className="ds-num">{fa(i + 1)}</span> },
            { title: "دارایی", dataIndex: "label" },
            { title: "هنگام ارسال", key: "out", render: (_: unknown, r: TransferItemView) => label(CONDITIONS, r.condition_out) },
            { title: "رسید", key: "res", render: (_: unknown, r: TransferItemView) => label(TRANSFER_ITEM_RESULTS, r.result) },
            { title: "هنگام رسید", key: "in", render: (_: unknown, r: TransferItemView) => (r.condition_in ? label(CONDITIONS, r.condition_in) : "—") },
            { title: "یادداشت", dataIndex: "note" },
          ]} />
        </Card>
      )}
      <PrintFoot sign={["تحویل‌دهنده (شعبهٔ مبدأ)", "حمل‌کننده", "تحویل‌گیرنده (شعبهٔ مقصد)"]} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Audits: reconciliation and the phone scanner

const RESULT_LABEL: Record<string, [string, "in" | "warning" | "danger" | "neutral" | "accent"]> = {
  found: ["دیده شد", "in"], moved: ["جابه‌جا", "warning"], missing: ["دیده نشد", "danger"], unexpected: ["ناشناخته", "accent"], pending: ["شمرده نشده", "neutral"],
};

export function AuditReconcileTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const id = String(ctx.row.id);
  const q = useQuery({
    queryKey: BANK_KEYS.audit(orgId, id),
    queryFn: () => recordsApi.list(api, "inventory_audit_item", { filter: { and: [{ f: "audit_id", op: "eq", v: id }, { f: "result", op: "in", v: ["missing", "moved", "unexpected", "pending"] }] }, size: 500, sort: "label" } as never),
  });
  const [registering, setRegistering] = useState<{ id: string; model: string | null } | null>(null);
  const resolve = useMutation({
    mutationFn: (v: { id: string; resolution: string; model_id?: string | null }) => bankApi.resolve(api, v.id, { resolution: v.resolution, model_id: v.model_id ?? null }),
    onSuccess: (r) => {
      message.success(r.transfer_id ? "حوالهٔ انتقال برای شعبهٔ ثبت‌شده ساخته شد" : r.open ? `تعیین تکلیف شد؛ ${fa(r.open)} مغایرت مانده است` : "همهٔ مغایرت‌ها تعیین تکلیف شد");
      setRegistering(null);
      void q.refetch();
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const completed = ctx.row.state === "completed";
  const rows = (q.data?.rows ?? []) as Record<string, any>[];
  return (
    <div className="flex flex-col gap-3">
      {!completed ? <Note>{ctx.row.state === "closed" ? "این شمارش بسته شده است." : "تعیین تکلیف مغایرت‌ها پس از «پایان شمارش» است."}</Note> : null}
      {q.isLoading ? <Loader /> : !rows.length ? <Note>مغایرتی نیست.</Note> : (
        <Table size="small" rowKey="id" pagination={{ pageSize: 50, hideOnSinglePage: true }} dataSource={rows} scroll={{ x: true }} columns={[
          { title: "قلم", key: "l", render: (_: unknown, r: Record<string, any>) => <div className="flex flex-col"><span>{r.label ?? r.scanned_code ?? "—"}</span>{r.scanned_code ? <span className="text-[12px] text-ink-3" dir="ltr">{r.scanned_code}</span> : null}</div> },
          { title: "نتیجه", key: "r", render: (_: unknown, r: Record<string, any>) => <Chip tone={RESULT_LABEL[r.result]?.[1] ?? "neutral"}>{RESULT_LABEL[r.result]?.[0] ?? r.result}</Chip> },
          { title: "تعیین تکلیف", key: "s", render: (_: unknown, r: Record<string, any>) => r.resolution && r.resolution !== "none" ? <Chip tone="in">{label(AUDIT_RESOLUTIONS, r.resolution)}</Chip> : completed ? (
            <Select size="small" placeholder="انتخاب کنید" style={{ width: 190 }} loading={resolve.isPending && resolve.variables?.id === r.id}
              options={(RESOLUTIONS_FOR[(r.result === "pending" ? "missing" : r.result) as AuditResult] ?? []).map((v) => ({ value: v, label: label(AUDIT_RESOLUTIONS, v) }))}
              onChange={(v: string) => (v === "registered" ? setRegistering({ id: String(r.id), model: null }) : resolve.mutate({ id: String(r.id), resolution: v }))} />
          ) : <span className="text-ink-3">باز</span> },
        ]} />
      )}
      <Modal open={!!registering} title="افزودن به دفتر اموال" okText="ثبت دارایی" cancelText="انصراف" confirmLoading={resolve.isPending} okButtonProps={{ disabled: !registering?.model }}
        onOk={() => registering && resolve.mutate({ id: registering.id, resolution: "registered", model_id: registering.model })} onCancel={() => setRegistering(null)} destroyOnHidden>
        <Field label="مدل دارایی"><RecordSelect table="asset_model" value={registering?.model ?? null} onChange={(v) => registering && setRegistering({ ...registering, model: (v as string) ?? null })} /></Field>
      </Modal>
    </div>
  );
}

export function AuditMobileAction({ ctx }: { ctx: RecordContext }) {
  const nav = useNavigate();
  const { orgId } = useOrg();
  if (ctx.row.state !== "in_progress") return null;
  return <Button icon={<Smartphone {...ICON} />} onClick={() => nav(`/${orgId}/itam/audits/${ctx.row.id}/scan`)}>شمارش با گوشی</Button>;
}

// ---------------------------------------------------------------------------------------------------------------
// Attestation

const ISSUES = [{ value: "missing", label: "موجود نیست" }, { value: "damaged", label: "آسیب‌دیده" }, { value: "wrong_location", label: "جای نادرست" }, { value: "other", label: "سایر" }];

export function AttestAction({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [issues, setIssues] = useState<Record<string, { issue: string; note: string }>>({});
  const [name, setName] = useState("");
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: BANK_KEYS.attestation(orgId, id), queryFn: () => bankApi.attestationAssets(api, id), enabled: open });
  const save = useMutation({
    mutationFn: () => bankApi.attest(api, id, { signed_name: name.trim(), exceptions: Object.entries(issues).map(([asset_id, v]) => ({ asset_id, issue: v.issue, note: v.note || null })) }),
    onSuccess: (r) => {
      message.success(r.exceptions ? `تأیید با ${fa(r.exceptions)} استثنا ثبت شد` : "فهرست اموال شعبه تأیید شد");
      setOpen(false);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (ctx.row.state !== "open") return null;
  return (
    <>
      <Button type="primary" icon={<Stamp {...ICON} />} onClick={() => setOpen(true)}>تأیید فهرست اموال</Button>
      <Drawer open={open} title={String(ctx.row.title ?? "تأیید اموال شعبه")} size="large" onClose={() => setOpen(false)} destroyOnHidden
        extra={<Button type="primary" icon={<BadgeCheck {...ICON} />} loading={save.isPending} disabled={name.trim().length < 3} onClick={() => save.mutate()}>امضا و تأیید</Button>}>
        {q.isLoading ? <Loader /> : !q.data ? null : (
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-ink-2">{`${fa(q.data.assets.length)} دارایی به نام این شعبه ثبت است. دارایی‌ای را که نیست، آسیب دیده یا جای دیگری است علامت بزنید؛ بقیه با امضای شما تأیید می‌شوند.`}</div>
            <Table size="small" rowKey="id" pagination={{ pageSize: 50, hideOnSinglePage: true }} dataSource={q.data.assets} scroll={{ x: true }} columns={[
              { title: "", key: "x", width: 40, render: (_: unknown, r: Record<string, any>) => <Checkbox checked={!!issues[r.id]} aria-label="استثنا" onChange={(e) => setIssues((x) => { const n = { ...x }; if (e.target.checked) n[r.id] = { issue: "missing", note: "" }; else delete n[r.id]; return n; })} /> },
              { title: "دارایی", key: "a", render: (_: unknown, r: Record<string, any>) => <div className="flex flex-col"><span>{r.name}</span><span className="text-[12px] text-ink-3" dir="ltr">{[r.asset_tag, r.serial_number].filter(Boolean).join(" · ")}</span></div> },
              { title: "استثنا", key: "i", render: (_: unknown, r: Record<string, any>) => issues[r.id] ? (
                <div className="flex gap-1">
                  <Select size="small" value={issues[r.id].issue} options={ISSUES} style={{ width: 120 }} onChange={(v) => setIssues((x) => ({ ...x, [r.id]: { ...x[r.id], issue: v } }))} />
                  <Input size="small" placeholder="توضیح" value={issues[r.id].note} maxLength={300} onChange={(e) => setIssues((x) => ({ ...x, [r.id]: { ...x[r.id], note: e.target.value } }))} />
                </div>
              ) : null },
            ]} />
            <Field label="نام و نام خانوادگی امضاکننده"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          </div>
        )}
      </Drawer>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Asset: class attributes and the custody chain

export function AssetClassTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const cls = deviceClass(ctx.row.category);
  const initial = useMemo(() => ((ctx.row.attributes ?? {}) as Record<string, unknown>), [ctx.row.attributes]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  useEffect(() => setValues(initial), [initial]);
  const custody = useQuery({ queryKey: BANK_KEYS.custody(orgId, String(ctx.row.id)), queryFn: () => bankApi.custody(api, String(ctx.row.id)) });
  const save = useMutation({
    mutationFn: () => ctx.save({ attributes: values }),
    onSuccess: (ok) => ok && message.success("ویژگی‌ها ذخیره شد"),
  });
  const canEdit = ctx.meta.canWrite;
  return (
    <div className="flex flex-col gap-3">
      {cls ? (
        <Card title={`ویژگی‌های ${cls.label}`} tools={canEdit ? <Button size="small" type="primary" loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button> : null}>
          <div className="itam-cards">
            {cls.attributes.map((a) => (
              <Field key={a.key} label={a.unit ? `${a.label} (${a.unit})` : a.label}>
                {a.type === "bool" ? <Switch checked={values[a.key] === true} disabled={!canEdit} onChange={(v) => setValues({ ...values, [a.key]: v })} />
                  : a.type === "int" ? <InputNumber min={0} value={values[a.key] as number | null} disabled={!canEdit} onChange={(v) => setValues({ ...values, [a.key]: v })} style={{ width: "100%" }} />
                  : a.type === "choice" ? <Select allowClear value={values[a.key] as string | undefined} disabled={!canEdit} options={(a.options ?? []).map((o) => ({ value: o, label: o }))} onChange={(v) => setValues({ ...values, [a.key]: v ?? null })} />
                  : a.type === "date" ? <DateInput value={(values[a.key] as string) ?? null} disabled={!canEdit} onChange={(v: string | null) => setValues({ ...values, [a.key]: v })} />
                  : <Input value={(values[a.key] as string) ?? ""} dir={a.ltr ? "ltr" : undefined} disabled={!canEdit} maxLength={200} onChange={(e) => setValues({ ...values, [a.key]: e.target.value })} />}
              </Field>
            ))}
          </div>
        </Card>
      ) : <Note>این رده ویژگی ویژه‌ای ندارد.</Note>}
      <Card title="زنجیرهٔ نگهداری" tools={custody.data ? <Chip tone={custody.data.verified.ok ? "in" : "danger"}>{custody.data.verified.ok ? `${fa(custody.data.verified.rows)} رویداد — زنجیره سالم است` : `زنجیره از ردیف ${fa(custody.data.verified.broken_at ?? 0)} گسسته است`}</Chip> : null}>
        {custody.isLoading ? <Loader /> : (
          <ul className="itam-list">
            {(custody.data?.rows ?? []).map((r) => (
              <li key={String(r.id)}>
                <span><ShieldCheck size={14} strokeWidth={1.4} className="inline me-1" />{label(CUSTODY_EVENTS, r.event)}{r.reference ? ` — ${r.reference}` : ""}{r.note ? <span className="text-ink-3 text-[12px]">{` (${r.note})`}</span> : null}</span>
                <span className="text-[12px] text-ink-3 ds-num">{formatJalaliDateTime(String(r.at))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Disposal: the wipe certificate

export function WipeCertificateAction({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["itam", "certificate", String(ctx.row.id)], queryFn: () => bankApi.certificate(api, String(ctx.row.id)), enabled: open, retry: false });
  useEffect(() => {
    if (q.error) {
      message.error((q.error as Error).message);
      setOpen(false);
    }
  }, [q.error, message]);
  if (!ctx.row.certificate_hash) return null;
  const c = q.data;
  return (
    <>
      <Button icon={<FileBadge {...ICON} />} onClick={() => setOpen(true)}>گواهی پاک‌سازی</Button>
      <Modal open={open && !!c} title="گواهی پاک‌سازی امن داده" width={720} onCancel={() => setOpen(false)} footer={<Button type="primary" onClick={() => window.print()}>چاپ</Button>} destroyOnHidden>
        {c ? (
          <div className="itam-cert flex flex-col gap-2 text-[13px]">
            <div className="text-[15px] font-[var(--ds-weight-semibold)]">{c.org}</div>
            <div>{`گواهی شمارهٔ ${c.certificate_no} — صادره ${formatJalaliDateTime(c.issued_at)}`}</div>
            <div>{`بدین‌وسیله گواهی می‌شود دادهٔ دارایی «${c.asset?.name ?? ""}» با پلاک ${c.asset?.tag ?? c.asset?.number ?? "—"} و سریال ${c.asset?.serial ?? "—"} (${c.asset?.model ?? "—"})${c.asset?.branch ? `، شعبهٔ ${c.asset.branch}` : ""}، با روش «${c.method}»${c.tool ? ` و ابزار ${c.tool}` : ""} در ${c.sanitized_at ? formatJalaliDateTime(c.sanitized_at) : "—"} پاک‌سازی شد.`}</div>
            <div>{`انجام‌دهنده: ${c.sanitized_by ?? "—"} — شاهد: ${c.witness ?? "—"}${c.order ? ` — دستور اسقاط ${c.order.number ?? ""}` : ""}`}</div>
            <div>{c.verified ? "بازبینی شده است." : "هنوز بازبینی نشده است."}</div>
            <div className="text-[11px] text-ink-3" dir="ltr">SHA-256: {c.hash}</div>
            <div className="itam-sign"><span>امضای انجام‌دهنده</span><span>امضای شاهد</span><span>امضای مدیر دارایی</span></div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

