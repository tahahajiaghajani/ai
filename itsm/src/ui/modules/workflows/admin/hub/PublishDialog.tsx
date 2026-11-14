// «انتشار» and «بازنشسته‌کردن» of a process (design F §3.5, §8.3, §8.4; package F6): the hub's process rows open them,
// and the designer's toolbar opens the same dialogs. «انتشار» reads what it would publish (GET /process/defs/:id/diff):
// the changes, the access settings apart («دسترسی به پرونده‌ها»), the draft's errors and warnings; a short note goes
// with the version. The server asks for a recent sign-in (the API client's ReauthGate asks for it and retries), then
// says «نسخهٔ ۳ منتشر شد؛ …». Publishing is offered to `process_design` approve on the authority only; a designer reads
// the diff with «انتشار با مسئول انتشار است». «بازنشسته‌کردن» says what happens to the open cases.
import { useState } from "react";
import { Alert, Input, Modal } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { ApiError } from "../../../../lib/api";
import { Loader } from "../../../../components/display";
import { Note } from "../../../../components/blocks";
import { F } from "../fields/parts";
import { HUB_KEYS, hubApi } from "./api";
import { publishTitle, publishVerdict, publishedText, retireText } from "./model";

export interface PublishTarget {
  id: string;
  name: string;
  /** a retired process may be published again unchanged */
  retired?: boolean;
}

export interface PublishDialogProps {
  process: PublishTarget;
  /** `process_design` approve (the hub's and the designer's `can.publish`) */
  canPublish: boolean;
  /** this runtime publishes (not a Windows app linked to the web version) */
  authority: boolean;
  onClose: () => void;
  /** after a publish (the caller refreshes its own view; the hub's is refreshed here) */
  onDone?: () => void;
}

const problemsOf = (e: unknown): { level: string; message: string }[] => {
  const d = e instanceof ApiError ? (e.details as { problems?: unknown } | undefined) : undefined;
  return Array.isArray(d?.problems) ? (d.problems as { level: string; message: string }[]) : [];
};

export function PublishDialog({ process, canPublish, authority, onClose, onDone }: PublishDialogProps) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ level: string; message: string }[]>([]);
  const preview = useQuery({ queryKey: HUB_KEYS.diff(orgId, process.id), queryFn: () => hubApi.diff(api, process.id), staleTime: 0, gcTime: 0 });
  const verdict = preview.data ? publishVerdict(preview.data, { canPublish, authority, retired: !!process.retired }) : null;

  const publish = async () => {
    if (!verdict?.ok) return;
    setBusy(true);
    try {
      const r = await hubApi.publish(api, process.id, note.trim() || null);
      const t = publishedText(r);
      n.ok(t.title, t.detail ? { description: t.detail } : undefined);
      await qc.invalidateQueries({ queryKey: HUB_KEYS.all(orgId) });
      onDone?.();
      onClose();
    } catch (e) {
      const p = problemsOf(e);
      if (p.length) setRefused(p);
      else n.error(e);
      setBusy(false);
      // what changed meanwhile (another publish, a concurrent save)
      void preview.refetch();
    }
  };

  const d = preview.data;
  return (
    <Modal
      open
      title={d ? publishTitle(process.name, d.next_version) : `انتشار «${process.name}»؟`}
      onCancel={onClose}
      okText="انتشار"
      cancelText={verdict?.ok ? "انصراف" : "بستن"}
      onOk={publish}
      okButtonProps={{ disabled: !verdict?.ok, loading: busy }}
      width={600}
      destroyOnHidden
    >
      {preview.isLoading ? (
        <Loader />
      ) : preview.isError || !d || !verdict ? (
        <Alert type="error" showIcon title="آنچه منتشر می‌شود خوانده نشد" description={preview.error instanceof Error ? preview.error.message : undefined} />
      ) : (
        <div className="wfh-stack">
          {verdict.unchanged ? (
            process.retired ? <p className="wfh-p">پیش‌نویس همان نسخهٔ پیشین است؛ با انتشار، گردش‌کار دوباره پروندهٔ تازه می‌پذیرد.</p> : null
          ) : (
            <section aria-label="تغییرها">
              {d.diff.first ? null : <h3 className="wfh-sub">تغییرها نسبت به نسخهٔ منتشرشده</h3>}
              <ul className="wfh-diff">
                {d.diff.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          {d.diff.access.length ? (
            <section aria-label="دسترسی به پرونده‌ها">
              <h3 className="wfh-sub">دسترسی به پرونده‌ها</h3>
              <ul className="wfh-diff">
                {d.diff.access.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {d.diff.first ? null : <p className="rk-hint">به همهٔ پرونده‌های این گردش‌کار، باز و بسته، می‌رسد.</p>}
            </section>
          ) : null}
          {[...verdict.errors, ...refused.filter((p) => p.level === "error")].length ? (
            <Alert
              type="error"
              showIcon
              title="ایرادهای پیش‌نویس"
              description={
                <ul className="wfh-diff">
                  {[...new Set([...verdict.errors, ...refused.filter((p) => p.level === "error")].map((p) => p.message))].map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          {verdict.warnings.length ? (
            <Note tone="warning">
              <ul className="wfh-diff">
                {verdict.warnings.map((p) => (
                  <li key={p.message}>{p.message}</li>
                ))}
              </ul>
            </Note>
          ) : null}
          {verdict.reason && !verdict.errors.length ? <Note>{verdict.reason}</Note> : null}
          {verdict.ok ? (
            <F label="یادداشت این نسخه" htmlFor="wfh-pub-note" hint="در «نسخه‌ها» و گزارش رویدادها می‌ماند.">
              <Input.TextArea id="wfh-pub-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} />
            </F>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

export interface RetireDialogProps {
  process: PublishTarget & { open_cases?: number };
  onClose: () => void;
  onDone?: () => void;
}

/** «بازنشسته‌کردن»: no new case starts with it; the open ones finish on their version. */
export function RetireDialog({ process, onClose, onDone }: RetireDialogProps) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const retire = async () => {
    setBusy(true);
    try {
      const r = await hubApi.retire(api, process.id, note.trim() || null);
      n.ok(r.message);
      await qc.invalidateQueries({ queryKey: HUB_KEYS.all(orgId) });
      onDone?.();
      onClose();
    } catch (e) {
      n.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`بازنشسته‌کردن «${process.name}»؟`}
      onCancel={onClose}
      okText="بازنشسته‌کردن"
      cancelText="انصراف"
      onOk={retire}
      okButtonProps={{ danger: true, loading: busy }}
      width={480}
      destroyOnHidden
    >
      <div className="wfh-stack">
        <p className="wfh-p">{retireText(process.open_cases ?? 0)}</p>
        <F label="یادداشت" htmlFor="wfh-retire-note" hint="در گزارش رویدادها می‌ماند.">
          <Input.TextArea id="wfh-retire-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} />
        </F>
      </div>
    </Modal>
  );
}
