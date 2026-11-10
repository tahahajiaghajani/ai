// Record-page parts of enterprise service: on every department case, «انتقال به واحد دیگر» (ESM-009: the case moves,
// or is handed over as a new case of the other department's kind, with the reason in its history) and «کار از واحد
// دیگر» (ESM-010: a linked case of another department working for this one; the parent waits for it). Both need the
// right to work the case (the server checks again).
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Select } from "antd";
import { ArrowLeftRight, GitBranchPlus } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { ICON } from "../../components/blocks";
import { RecordSelect, recordPath, type RecordContext } from "../../records";
import { ESM_KEYS, esmApi } from "./api";
import type { Row } from "./model";

type Mode = "transfer" | "child";

export function CaseActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const meta = ((ctx.meta as Row).esm ?? {}) as { can_work?: boolean; department?: { id: string } | null };
  const [mode, setMode] = useState<Mode | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [service, setService] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const depts = useQuery({ queryKey: ESM_KEYS.departments(orgId), queryFn: () => esmApi.departments(api), enabled: mode !== null });
  const close = () => {
    setMode(null);
    setDept(null);
    setService(null);
    setText("");
    setTitle("");
  };
  const run = useAction(
    async () =>
      mode === "transfer"
        ? esmApi.transfer(api, ctx.table, ctx.row.id, { department_id: dept!, service_id: service, note: text.trim() })
        : esmApi.child(api, ctx.table, ctx.row.id, { department_id: dept!, service_id: service, short_description: title.trim(), description: text.trim() || null }),
    {
      success: (d) => (mode === "transfer" ? ("moved" in d && d.moved ? "پرونده به واحد دیگر رفت" : `پروندهٔ ${d.number ?? ""} در واحد مقصد ساخته شد`) : `کار ${d.number ?? ""} در واحد دیگر ساخته شد`),
      onSuccess: (d) => {
        close();
        if (mode === "transfer" && "moved" in d && d.moved) ctx.refresh();
        else if (mode === "transfer") nav(`/${orgId}/${recordPath(d.table, d.id)}`);
        else ctx.refresh();
      },
    },
  );
  if (!meta.can_work || !ctx.row.active) return null;
  const options = (depts.data?.departments ?? []).filter((d) => mode === "child" ? d.id !== meta.department?.id : true).map((d) => ({ value: d.id, label: d.name }));
  const ok = !!dept && (mode === "transfer" ? text.trim().length > 2 : title.trim().length > 2);
  return (
    <>
      <Button icon={<ArrowLeftRight {...ICON} />} onClick={() => setMode("transfer")}>انتقال به واحد دیگر</Button>
      <Button icon={<GitBranchPlus {...ICON} />} onClick={() => setMode("child")}>کار از واحد دیگر</Button>
      <Modal open={mode !== null} title={mode === "transfer" ? "انتقال پرونده به واحد دیگر" : "درخواست کار از واحد دیگر"} okText={mode === "transfer" ? "انتقال" : "ثبت"} cancelText="انصراف" onCancel={close} onOk={() => run.mutate(undefined)} okButtonProps={{ disabled: !ok, loading: run.isPending }} destroyOnHidden>
        <Form layout="vertical">
          <Form.Item label="واحد مقصد" required>
            <Select value={dept ?? undefined} onChange={(v) => { setDept(v); setService(null); }} options={options} loading={depts.isLoading} showSearch optionFilterProp="label" aria-label="واحد مقصد" />
          </Form.Item>
          <Form.Item label="خدمت (اختیاری)">
            <RecordSelect table="esm_service" value={service} onChange={(v) => setService((v as string | null) ?? null)} filter={dept ? { and: [{ f: "department_id", op: "eq", v: dept }, { f: "active", op: "eq", v: true }] } : null} disabled={!dept} allowClear aria-label="خدمت" />
          </Form.Item>
          {mode === "child" ? (
            <Form.Item label="عنوان کار" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Form.Item>
          ) : null}
          <Form.Item label={mode === "transfer" ? "دلیل انتقال" : "شرح"} required={mode === "transfer"}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={text} onChange={(e) => setText(e.target.value)} maxLength={mode === "transfer" ? 2000 : 20_000} />
          </Form.Item>
          {mode === "transfer" ? <p className="text-[12px] text-ink-3">اگر نوع پروندهٔ واحد مقصد فرق کند، پروندهٔ تازه‌ای با پیوند به این پرونده ساخته و این پرونده بسته می‌شود.</p> : null}
        </Form>
      </Modal>
    </>
  );
}
