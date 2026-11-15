// «پروندهٔ تازه» (design F §5 page 3, §8.6; package F7) at `workflows/start/:key`: the start step's form with my rights
// in it. The primary action names the step the case goes to («ارسال برای "تأیید رئیس شعبه"»), the secondary keeps a
// draft («ذخیرهٔ پیش‌نویس», on this runtime only). The case's id is chosen here, so the case opens at once, and every
// retry of the same start sends the same id: a start applied whose answer was lost comes back «late» with its case
// instead of opening a second one. On a linked Windows app the start waits to be sent («در صف ارسال») and «پرونده‌ها»
// shows it. A refusal names the fields. Another process's start begins afresh (its values, files and case id). Like the
// step form it sends only what the form shows now: a field «نمایش وقتی…» hides sends neither its value nor its files.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "antd";
import { Save, Send } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cleanFormLayout } from "@shared/forms/layout";
import { ApiError } from "../../../lib/api";
import { useOrg } from "../../../lib/org";
import { useNotify } from "../../../lib/hooks";
import { Note } from "../../../components/blocks";
import { EmptyState, Loader } from "../../../components/display";
import { useMe, useSchema } from "../../../records/data/hooks";
import { useLeaveGuard } from "../admin/forms/parts";
import { USER_KEYS, userApi } from "./api";
import { caseIdHolder, draftValues, fieldProblems, missingRequired, packShown, sendLabel, startMessage, startValues } from "./model";
import { Head, ProcessForm, useLocalFiles, useMoneyUnit, useWf } from "./parts";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function StartPage() {
  const { key = "" } = useParams();
  return <StartForm key={key} processKey={key} />;
}

function StartForm({ processKey: key }: { processKey: string }) {
  const { api, orgId } = useOrg();
  const wf = useWf();
  const nav = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const { schema } = useSchema();
  const { userId, tz } = useMe();
  const unit = useMoneyUnit();
  const local = useLocalFiles();
  const [caseIds] = useState(() => caseIdHolder());
  const view = useQuery({ queryKey: USER_KEYS.view(orgId, key), queryFn: () => userApi.view(api, key), staleTime: 30_000 });
  const start = view.data?.start;
  const layout = useMemo(() => cleanFormLayout(start?.form?.layout ?? { tabs: [] }), [start]);
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  useEffect(() => {
    if (start && values === null) setValues(startValues(start.fields, start.rights, userId, tz, start.draft));
  }, [start, values, userId, tz]);
  useLeaveGuard(dirty && busy !== "send");

  if (view.isLoading || (start && values === null)) return <Loader />;
  if (view.isError || !view.data || !start) return <EmptyState title="گردش‌کار پیدا نشد" description={view.error instanceof Error ? view.error.message : undefined} />;
  const data = view.data;
  const back = { to: wf.to(wf.paths.process(data.process.key)), label: data.process.name };
  if (!start.can_start)
    return (
      <div className="wfu-page">
        <Head title="پروندهٔ تازه" sub={data.process.name} back={back} />
        <EmptyState title="این گردش‌کار را شما آغاز نمی‌کنید" description={data.process.status === "retired" ? "این گردش‌کار بازنشسته شده است." : "آغاز این گردش‌کار با کسانی است که طراح آن تعیین کرده است."} />
      </div>
    );
  const v = values ?? {};
  const change = (name: string, value: unknown) => {
    setValues((x) => ({ ...(x ?? {}), [name]: value }));
    setDirty(true);
    if (problems[name]) setProblems(({ [name]: _gone, ...rest }) => rest);
  };
  const saveDraft = async () => {
    setBusy("draft");
    try {
      await userApi.saveDraft(api, { process_id: data.process.id }, draftValues(v, start.rights, start.fields));
      setDirty(false);
      n.ok(local.files.size ? "پیش‌نویس ذخیره شد؛ پیوست‌ها را هنگام ارسال دوباره بیفزایید." : "پیش‌نویس ذخیره شد.");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    const missing = missingRequired(layout, start.rights, v, start.fields);
    if (Object.keys(missing).length) {
      setProblems(missing);
      n.warn("چند فیلد الزامی پر نشده است.");
      return;
    }
    setBusy("send");
    try {
      // what the form shows now: a field «نمایش وقتی…» hides sends neither its value nor its picked files
      const packed = packShown(layout, start.rights, v, start.fields, local.files);
      // a retry after an error sends the same id: the server applies a start of one id once
      const caseId = caseIds.take();
      const r = await userApi.start(api, orgId, { process: data.process.key, values: packed.values, case_id: caseId }, packed.files);
      caseIds.answered();
      await userApi.dropDraft(api, { process_id: data.process.id });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: USER_KEYS.all(orgId) });
      const msg = startMessage(r, start.next);
      if (msg.tone === "ok") n.ok(msg.text);
      else if (msg.tone === "info") n.info(msg.text);
      else n.warn(msg.text);
      // applied, or late because an earlier send of this start was applied: the case is there
      nav(wf.to(r.result === "applied" || (r.result === "late" && r.case) ? wf.paths.kase(r.case ?? caseId) : wf.paths.tab("cases")), { replace: true });
    } catch (e) {
      const fp = e instanceof ApiError && e.status === 400 ? fieldProblems(e.details) : {};
      if (Object.keys(fp).length) {
        setProblems(fp);
        n.warn("چند مقدار پذیرفته نشد؛ پیام هر فیلد را ببینید.");
      } else n.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="wfu-page wfu-start">
      <Head title="پروندهٔ تازه" sub={data.process.name} back={back} />
      {start.draft ? <Note>پیش‌نویس ذخیره‌شدهٔ شما در فرم آمده است.</Note> : null}
      <section className="wfu-sheet" aria-label={start.label ?? "ثبت درخواست"}>
        <h2 className="wfu-h2">{start.label ?? "ثبت درخواست"}</h2>
        {schema ? (
          start.form ? (
            <ProcessForm layout={layout} fields={start.fields} rights={start.rights} values={v} onChange={change} problems={problems} schema={schema} tz={tz} unit={unit} local={local} idPrefix="wfu-start" label={start.form.name} display={data.display} />
          ) : (
            <p className="rk-hint">این مرحله فرمی ندارد؛ با «ارسال» پرونده آغاز می‌شود.</p>
          )
        ) : (
          <Loader />
        )}
      </section>
      <div className="wfu-actionbar" role="group" aria-label="کارهای فرم">
        <Button type="primary" icon={<Send {...I16} />} loading={busy === "send"} disabled={!!busy} onClick={send}>
          {sendLabel(start.next)}
        </Button>
        <Button icon={<Save {...I16} />} loading={busy === "draft"} disabled={!!busy} onClick={saveDraft}>
          ذخیرهٔ پیش‌نویس
        </Button>
      </div>
    </div>
  );
}
