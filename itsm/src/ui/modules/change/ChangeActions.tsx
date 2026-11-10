// Header actions of a change: put on hold / resume (with a reason), start the backout of an implementation, check
// conflicts again, and under «بیشتر»: copy (optionally for several dates — a recurring scheduled change), child changes
// of a scaled change, the post-implementation review and the evidence pack. Each action is the person's own (the
// server checks their access, the field locks and the lifecycle guard).
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Checkbox, Dropdown, Form, Input, Modal, Select, Space } from "antd";
import { Pause, Play, Undo2, Radar, MoreHorizontal, Copy, GitFork, ClipboardCheck, FileText, Plus, Trash2 } from "lucide-react";
import { HOLD_REASONS } from "@shared/tables/change";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { RecordMarkdown, recordPath, type RecordContext } from "../../records";
import { FormDateTime, FormRecords } from "./parts";
import { changeApi, useChangeRefresh } from "./api";

const LIVE = ["new", "assess", "authorize", "scheduled", "implement"];

export default function ChangeActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const refresh = useChangeRefresh();
  const r = ctx.row;
  const can = !!ctx.meta.canWrite;
  const [dialog, setDialog] = useState<null | "hold" | "backout" | "copy" | "children" | "evidence">(null);
  const [evidence, setEvidence] = useState("");
  const done = () => {
    setDialog(null);
    refresh();
    ctx.refresh();
  };
  const hold = useAction((v: { reason: string; note?: string }) => changeApi.hold(api, r.id, v.reason, v.note || null), { success: "تغییر متوقف شد.", onSuccess: done });
  const resume = useAction(() => changeApi.resume(api, r.id, null), { success: "توقف برداشته شد.", onSuccess: done });
  const backout = useAction((v: { note: string }) => changeApi.backout(api, r.id, v.note), { success: "بازگشت آغاز شد و کار بازگشت ساخته شد.", onSuccess: done });
  const check = useAction(() => changeApi.checkConflicts(api, r.id), {
    success: (d) => (d.open ? `${d.open} تداخل باز دارد.` : "تداخل بازی ندارد."),
    onSuccess: () => ctx.refresh(),
  });
  const copy = useAction((v: { sections: string[]; tasks: boolean; dates: { start?: string; end?: string }[] }) => {
    const dates = (v.dates ?? []).filter((d): d is { start: string; end: string } => !!d?.start && !!d?.end);
    return changeApi.copy(api, r.id, { sections: v.sections, tasks: v.tasks, dates });
  }, {
    success: (d) => (d.changes.length === 1 ? `کپی ${d.changes[0].number} ساخته شد.` : `${d.changes.length} کپی ساخته شد.`),
    onSuccess: (d) => {
      setDialog(null);
      refresh();
      if (d.changes.length === 1) nav(`/${orgId}/${recordPath("change_request", d.changes[0].id)}`);
    },
  });
  const children = useAction((v: { cis?: string[]; titles?: string }) => changeApi.children(api, r.id, { cis: v.cis, titles: (v.titles ?? "").split("\n").map((t) => t.trim()).filter(Boolean) }), {
    success: (d) => `${d.changes.length} تغییر فرزند ساخته شد.`,
    onSuccess: done,
  });
  const pir = useAction(() => changeApi.createPir(api, r.id), {
    success: (d) => (d.pir ? `بازبینی ${d.pir.number} ساخته شد.` : "این تغییر بازبینی دارد."),
    onSuccess: (d) => {
      refresh();
      const id = d.pir?.id ?? d.existing;
      if (id) nav(`/${orgId}/${recordPath("change_pir", id)}`);
    },
  });
  const loadEvidence = useAction(() => changeApi.evidence(api, r.id), { onSuccess: (d) => { setEvidence(d.markdown); setDialog("evidence"); } });

  const live = LIVE.includes(String(r.state));
  const more = [
    { key: "copy", label: "کپی تغییر", icon: <Copy {...ICON14} />, onClick: () => setDialog("copy") },
    ...(can && live && r.state !== "implement" ? [{ key: "children", label: "تغییرهای فرزند", icon: <GitFork {...ICON14} />, onClick: () => setDialog("children") }] : []),
    ...(can && (r.state === "review" || r.state === "closed") && !r.pir_id ? [{ key: "pir", label: "ساخت بازبینی پس از اجرا", icon: <ClipboardCheck {...ICON14} />, onClick: () => pir.mutate(undefined) }] : []),
    { key: "evidence", label: "پروندهٔ شواهد", icon: <FileText {...ICON14} />, onClick: () => loadEvidence.mutate(undefined) },
  ];

  return (
    <Space size={6} wrap>
      {can && live && !r.on_hold && r.state !== "implement" ? (
        <Button size="small" icon={<Pause {...ICON14} />} onClick={() => setDialog("hold")}>
          توقف
        </Button>
      ) : null}
      {can && r.on_hold ? (
        <Button size="small" icon={<Play {...ICON14} />} loading={resume.isPending} onClick={() => resume.mutate(undefined)}>
          ادامه
        </Button>
      ) : null}
      {can && r.state === "implement" ? (
        <Button size="small" danger icon={<Undo2 {...ICON14} />} onClick={() => setDialog("backout")}>
          بازگشت تغییر
        </Button>
      ) : null}
      {can && live ? (
        <Button size="small" icon={<Radar {...ICON14} />} loading={check.isPending} onClick={() => check.mutate(undefined)}>
          بررسی تداخل
        </Button>
      ) : null}
      <Dropdown menu={{ items: more }} trigger={["click"]}>
        <Button size="small" icon={<MoreHorizontal {...ICON14} />} aria-label="کارهای بیشتر تغییر" loading={pir.isPending || loadEvidence.isPending} />
      </Dropdown>

      <Modal open={dialog === "hold"} title="توقف تغییر" okText="توقف" cancelText="انصراف" destroyOnHidden onCancel={() => setDialog(null)} okButtonProps={{ form: "chg-hold", htmlType: "submit", loading: hold.isPending }}>
        <Form id="chg-hold" layout="vertical" onFinish={(v) => hold.mutate(v)}>
          <Form.Item name="reason" label="دلیل" rules={[{ required: true, message: "دلیل توقف را انتخاب کنید" }]}>
            <Select options={HOLD_REASONS.filter((o) => o.value !== "lockdown").map((o) => ({ value: o.value, label: o.label }))} />
          </Form.Item>
          <Form.Item name="note" label="توضیح">
            <Input.TextArea rows={3} maxLength={4000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={dialog === "backout"} title="بازگشت تغییر" okText="آغاز بازگشت" okButtonProps={{ danger: true, form: "chg-backout", htmlType: "submit", loading: backout.isPending }} cancelText="انصراف" destroyOnHidden onCancel={() => setDialog(null)}>
        <Form id="chg-backout" layout="vertical" onFinish={(v) => backout.mutate(v)}>
          <Form.Item name="note" label="چرا تغییر برگشت داده می‌شود؟" rules={[{ required: true, message: "دلیل بازگشت را بنویسید" }]}>
            <Input.TextArea rows={3} maxLength={4000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={dialog === "copy"} title="کپی تغییر" okText="ساخت" cancelText="انصراف" destroyOnHidden width={560} onCancel={() => setDialog(null)} okButtonProps={{ form: "chg-copy", htmlType: "submit", loading: copy.isPending }}>
        <Form id="chg-copy" layout="vertical" initialValues={{ sections: ["main", "scope", "plans"], tasks: true, dates: [] }} onFinish={(v) => copy.mutate(v)}>
          <Form.Item name="sections" label="بخش‌هایی که کپی شوند">
            <Checkbox.Group options={[{ value: "main", label: "اصلی" }, { value: "scope", label: "خدمت و پیکربندی" }, { value: "plans", label: "برنامه‌ها" }, { value: "schedule", label: "زمان‌بندی" }]} />
          </Form.Item>
          <Form.Item name="tasks" valuePropName="checked">
            <Checkbox>کارها هم کپی شوند</Checkbox>
          </Form.Item>
          <Form.List name="dates">
            {(fields, { add, remove }) => (
              <div className="flex flex-col gap-2">
                <span className="ds-t-label text-ink-2">یک کپی برای هر زمان (تغییر تکرارشونده)؛ خالی: یک کپی بدون زمان</span>
                {fields.map((f) => (
                  <div key={f.key} className="flex flex-wrap items-center gap-2">
                    <Form.Item name={[f.name, "start"]} noStyle rules={[{ required: true, message: "شروع" }]}>
                      <FormDateTime />
                    </Form.Item>
                    <span className="text-ink-3">تا</span>
                    <Form.Item name={[f.name, "end"]} noStyle rules={[{ required: true, message: "پایان" }]}>
                      <FormDateTime />
                    </Form.Item>
                    <Button size="small" type="text" icon={<Trash2 {...ICON14} />} aria-label="حذف این زمان" onClick={() => remove(f.name)} />
                  </div>
                ))}
                {fields.length < 20 ? (
                  <Button size="small" icon={<Plus {...ICON14} />} onClick={() => add({})} className="self-start">
                    افزودن زمان
                  </Button>
                ) : null}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal open={dialog === "children"} title="تغییرهای فرزند" okText="ساخت" cancelText="انصراف" destroyOnHidden onCancel={() => setDialog(null)} okButtonProps={{ form: "chg-children", htmlType: "submit", loading: children.isPending }}>
        <Form id="chg-children" layout="vertical" onFinish={(v) => children.mutate(v)}>
          <Form.Item name="cis" label="یک تغییر برای هر پیکربندی">
            <FormRecords table="ci" multiple />
          </Form.Item>
          <Form.Item name="titles" label="یا یک تغییر برای هر سطر">
            <Input.TextArea rows={4} placeholder="شعبهٔ مرکزی&#10;شعبهٔ شمال" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={dialog === "evidence"} title="پروندهٔ شواهد تغییر" footer={null} width={720} destroyOnHidden onCancel={() => setDialog(null)}>
        <div className="max-h-[65vh] overflow-auto">
          <RecordMarkdown text={evidence} />
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="small" onClick={() => void navigator.clipboard?.writeText(evidence)}>
            رونوشت متن
          </Button>
        </div>
      </Modal>
    </Space>
  );
}
