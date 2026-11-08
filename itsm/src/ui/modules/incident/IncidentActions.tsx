// Quick actions of an incident's page header: «به من بسپار», the war room of a major incident, what still blocks a
// resolution, and «اقدام‌ها» — escalation, the major-incident overlay (propose, declare, reject, downgrade), child /
// copy / follow-up incidents, merging duplicates, a problem from this incident or a link to one, and the
// post-incident review. What is offered follows the record's meta (may the caller work it, manage major incidents).
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Dropdown, Form, Input, InputNumber, Modal, Radio, type MenuProps } from "antd";
import { ChevronDown, Hand, Radio as RadioIcon, ListTodo } from "lucide-react";
import { MAJOR_DECLARED } from "@shared/tables/incident";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { Chip } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { RecordSelect, UserSelect, recordPath, type RecordContext } from "../../records";
import { useMe } from "../../records/data/hooks";
import { INCIDENT_KEYS, incidentApi, useIncidentMeta, useIncidentRefresh, type MajorAction } from "./api";
import { majorMenu, persian, type MajorMenuItem } from "./model";

type Dialog = { kind: "escalate" } | { kind: "major"; item: MajorMenuItem } | { kind: "merge" } | { kind: "link-problem" } | null;

interface IncidentMeta {
  can_work?: boolean;
  can_manage_major?: boolean;
}

export default function IncidentActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const { userId } = useMe();
  const refresh = useIncidentRefresh();
  const meta = ((ctx.meta as { incident?: IncidentMeta }).incident ?? {}) as IncidentMeta;
  const row = ctx.row;
  const open = !!row.active;
  const work = !!meta.can_work;
  const declared = MAJOR_DECLARED.includes(String(row.major_state ?? ""));
  const [dialog, setDialog] = useState<Dialog>(null);
  const after = () => {
    ctx.refresh();
    void refresh();
  };
  const go = (table: string, id: string) => nav(`/${orgId}/${recordPath(table, id)}`);

  const ready = useQuery({
    queryKey: INCIDENT_KEYS.readiness(orgId, row.id),
    queryFn: () => incidentApi.readiness(api, row.id),
    enabled: open && work,
    staleTime: 15_000,
  });
  const openTasks = ready.data?.open_tasks ?? 0;

  const related = useAction(({ mode }: { mode: "child" | "copy" | "follow_up" }) => incidentApi.related(api, row.id, mode), {
    success: (d) => `${d.row.number} ساخته شد.`,
    onSuccess: (d) => go("incident", d.row.id),
  });
  const problem = useAction(() => incidentApi.problemFrom(api, [row.id]), {
    success: (d) => `مشکل ${d.problem.number} ساخته شد.`,
    onSuccess: (d) => go("problem", d.problem.id),
  });
  const review = useAction(() => incidentApi.review(api, row.id), {
    success: (d) => (d.created ? `پیش‌نویس ${d.row.number} آماده شد.` : `بازبینی ${d.row.number} باز شد.`),
    onSuccess: (d) => go("incident_review", d.row.id),
  });

  const items: MenuProps["items"] = [];
  if (open && work) items.push({ key: "escalate", label: "تشدید یا ارجاع وظیفه‌ای…" });
  for (const m of majorMenu(row.major_state as string | null, open, { work, manage: !!meta.can_manage_major })) items.push({ key: `major:${m.action}`, label: `${m.label}…`, danger: m.danger });
  if (items.length) items.push({ type: "divider" });
  if (work) {
    items.push({ key: "child", label: "رخداد فرزند" }, { key: "copy", label: "رونوشت رخداد" });
    if (open) items.push({ key: "merge", label: "ادغام رخدادهای تکراری…" });
    if (!row.problem_id) items.push({ key: "problem", label: "ساخت مشکل از این رخداد" });
    items.push({ key: "link-problem", label: row.problem_id ? "تغییر مشکل مرتبط…" : "پیوند به مشکل موجود…" });
  }
  if (!open) items.push({ key: "follow_up", label: "ثبت رخداد پیگیری" });
  if (declared || (!open && work)) items.push({ key: "review", label: "بازبینی پس از رخداد" });

  const onMenu: MenuProps["onClick"] = ({ key }) => {
    if (key === "escalate" || key === "merge" || key === "link-problem") setDialog({ kind: key });
    else if (key.startsWith("major:")) {
      const item = majorMenu(row.major_state as string | null, open, { work, manage: !!meta.can_manage_major }).find((m) => `major:${m.action}` === key);
      if (item) setDialog({ kind: "major", item });
    } else if (key === "child" || key === "copy" || key === "follow_up") related.mutate({ mode: key });
    else if (key === "problem") problem.mutate(undefined);
    else if (key === "review") review.mutate(undefined);
  };

  return (
    <>
      {open && openTasks > 0 ? (
        <Chip tone="warning" title={ready.data?.tasks.map((t) => t.number).join("، ")}>
          <ListTodo {...ICON14} aria-hidden /> {persian(String(openTasks))} کار الزامی باز
        </Chip>
      ) : null}
      {open && work && row.assigned_to !== userId ? (
        <Button icon={<Hand {...ICON14} />} onClick={() => void ctx.save({ assigned_to: userId })}>
          به من بسپار
        </Button>
      ) : null}
      {declared ? (
        <Button icon={<RadioIcon {...ICON14} />} onClick={() => nav(`/${orgId}/incidents/${row.id}/war-room`)}>
          اتاق عملیات
        </Button>
      ) : null}
      {items.length ? (
        <Dropdown menu={{ items, onClick: onMenu }} trigger={["click"]}>
          <Button loading={related.isPending || problem.isPending || review.isPending}>
            اقدام‌ها <ChevronDown {...ICON14} aria-hidden />
          </Button>
        </Dropdown>
      ) : null}
      {dialog?.kind === "escalate" ? <EscalateDialog ctx={ctx} onClose={() => setDialog(null)} onDone={after} /> : null}
      {dialog?.kind === "major" ? <MajorDialog ctx={ctx} item={dialog.item} onClose={() => setDialog(null)} onDone={after} /> : null}
      {dialog?.kind === "merge" ? (
        <MergeDialog
          ctx={ctx}
          onClose={() => setDialog(null)}
          onDone={(merged, failed) => {
            if (merged.length) n.ok(`${persian(String(merged.length))} رخداد ادغام شد.`);
            if (failed.length) n.warn(`${persian(String(failed.length))} رخداد ادغام نشد: ${failed[0].message}`);
            after();
          }}
        />
      ) : null}
      {dialog?.kind === "link-problem" ? <LinkProblemDialog ctx={ctx} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function EscalateDialog({ ctx, onClose, onDone }: { ctx: RecordContext; onClose: () => void; onDone: () => void }) {
  const { api } = useOrg();
  const [kind, setKind] = useState<"functional" | "hierarchical">("hierarchical");
  const [group, setGroup] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const run = useAction(() => incidentApi.escalate(api, ctx.row.id, { kind, group_id: group, reason }), {
    success: kind === "functional" ? "رخداد به گروه تازه ارجاع شد." : "رخداد تشدید شد و مدیران خبر شدند.",
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  const level = Number(ctx.row.escalation ?? 0) + 1;
  return (
    <Modal open title="تشدید رخداد" okText="تشدید" cancelText="انصراف" onCancel={onClose} onOk={() => run.mutate(undefined)} confirmLoading={run.isPending} okButtonProps={{ disabled: !reason.trim() || (kind === "functional" && !group) }} destroyOnHidden>
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="نوع تشدید">
          <Radio.Group value={kind} onChange={(e) => setKind(e.target.value)} optionType="button" options={[{ value: "hierarchical", label: "سلسله‌مراتبی (اطلاع به مدیران)" }, { value: "functional", label: "وظیفه‌ای (ارجاع به گروه دیگر)" }]} />
        </Form.Item>
        {kind === "functional" ? (
          <Form.Item label="گروه مقصد" required>
            <RecordSelect table="group" value={group} onChange={(v) => setGroup((v as string) ?? null)} aria-label="گروه مقصد" />
          </Form.Item>
        ) : null}
        <Form.Item label="دلیل" required extra={<span>سطح تشدید به <span className="ds-num">{persian(String(Math.min(10, level)))}</span> می‌رسد.</span>}>
          <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function MajorDialog({ ctx, item, onClose, onDone }: { ctx: RecordContext; item: MajorMenuItem; onClose: () => void; onDone: () => void }) {
  const { api } = useOrg();
  const { userId } = useMe();
  const meta = useIncidentMeta();
  const row = ctx.row;
  const [reason, setReason] = useState("");
  const [manager, setManager] = useState<string | null>((row.mi_manager_id as string) ?? userId);
  const [comms, setComms] = useState<string | null>((row.mi_comms_id as string) ?? null);
  const [cadence, setCadence] = useState<number | null>((row.comm_cadence as number) ?? null);
  const [bridge, setBridge] = useState<string>((row.bridge_url as string) ?? "");
  const declare = item.action === "declare";
  const run = useAction(
    () =>
      incidentApi.major(api, row.id, {
        action: item.action as MajorAction,
        reason: reason.trim() || undefined,
        ...(declare ? { mi_manager_id: manager, mi_comms_id: comms, comm_cadence: cadence ?? meta.data?.settings.mi_default_cadence ?? null, bridge_url: bridge.trim() || null } : {}),
      }),
    {
      success: declare ? "رخداد عمده اعلام شد." : "انجام شد.",
      onSuccess: () => {
        onClose();
        onDone();
      },
    },
  );
  return (
    <Modal open title={item.label} okText={item.label} okButtonProps={{ danger: item.danger, disabled: item.reason && !reason.trim() }} cancelText="انصراف" onCancel={onClose} onOk={() => run.mutate(undefined)} confirmLoading={run.isPending} destroyOnHidden>
      <Form layout="vertical" requiredMark={false}>
        {declare ? (
          <>
            <Form.Item label="مدیر رخداد عمده">
              <UserSelect value={manager} onChange={(v) => setManager((v as string) ?? null)} aria-label="مدیر رخداد عمده" />
            </Form.Item>
            <Form.Item label="مسئول اطلاع‌رسانی">
              <UserSelect value={comms} onChange={(v) => setComms((v as string) ?? null)} allowClear aria-label="مسئول اطلاع‌رسانی" />
            </Form.Item>
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Form.Item label="فاصلهٔ اطلاع‌رسانی (دقیقه)">
                <InputNumber value={cadence ?? meta.data?.settings.mi_default_cadence} onChange={(v) => setCadence(v === null ? null : Number(v))} min={0} max={1440} className="w-full" />
              </Form.Item>
              <Form.Item label="پیوند جلسهٔ هماهنگی">
                <Input value={bridge} onChange={(e) => setBridge(e.target.value)} dir="ltr" placeholder="https://" />
              </Form.Item>
            </div>
          </>
        ) : null}
        <Form.Item label={declare ? "دلیل اعلام (اختیاری)" : "دلیل"} required={item.reason}>
          <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={4000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function MergeDialog({ ctx, onClose, onDone }: { ctx: RecordContext; onClose: () => void; onDone: (merged: string[], failed: { message: string }[]) => void }) {
  const { api } = useOrg();
  const [ids, setIds] = useState<string[]>([]);
  const run = useAction(() => incidentApi.merge(api, ctx.row.id, ids), {
    onSuccess: (d) => {
      onClose();
      onDone(d.merged, d.failed);
    },
  });
  return (
    <Modal open title={`ادغام در ${ctx.row.number ?? "این رخداد"}`} okText="ادغام" cancelText="انصراف" onCancel={onClose} onOk={() => run.mutate(undefined)} confirmLoading={run.isPending} okButtonProps={{ disabled: !ids.length }} destroyOnHidden>
      <p className="mb-3 text-[13px] text-ink-2">رخدادهای تکراری لغو می‌شوند و درخواست‌دهندگان و پیگیری‌کنندگانشان این رخداد را دنبال می‌کنند.</p>
      <RecordSelect
        table="incident"
        multiple
        value={ids}
        onChange={(v) => setIds(((v as string[]) ?? []).filter((x) => x !== ctx.row.id))}
        filter={{ and: [{ f: "active", op: "eq", v: true }, { f: "merged_into", op: "empty" }] }}
        aria-label="رخدادهای تکراری"
        className="w-full"
      />
    </Modal>
  );
}

function LinkProblemDialog({ ctx, onClose }: { ctx: RecordContext; onClose: () => void }) {
  const [problem, setProblem] = useState<string | null>((ctx.row.problem_id as string) ?? null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const ok = await ctx.save({ problem_id: problem });
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <Modal open title="مشکل مرتبط" okText="ذخیره" cancelText="انصراف" onCancel={onClose} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
      <RecordSelect table="problem" value={problem} onChange={(v) => setProblem((v as string) ?? null)} filter={{ f: "active", op: "eq", v: true }} allowClear openLink aria-label="مشکل" className="w-full" />
    </Modal>
  );
}
