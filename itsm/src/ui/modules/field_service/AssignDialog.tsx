// «واگذاری وظیفه»: the keyboard way to the board's drop. A time of the board's day, the technicians ranked for that
// time (feasible first, with the reasons and what blocks the others), «واگذاری» per technician and «بهترین تکنسین»
// (auto-assignment). An infeasible choice comes back with its warnings; a dispatcher may assign anyway.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Modal } from "antd";
import { Sparkles, UserCheck } from "lucide-react";
import { toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { Chip, Loader } from "../../components/display";
import { ICON } from "../../components/blocks";
import { FIELD_KEYS, fieldApi, type Candidate } from "./api";
import { hhmm, instantOf, type Row } from "./model";

export interface AssignTarget {
  task: Row;
  /** the board's day (YYYY-MM-DD) and a preset time (HH:MM) */
  day: string;
  time?: string | null;
  /** a technician chosen by the drop (the dialog then only confirms warnings) */
  technician?: string | null;
}

export function AssignDialog({ target, dispatcher, onClose, onDone }: { target: AssignTarget | null; dispatcher: boolean; onClose: () => void; onDone: () => void }) {
  return target ? <AssignBody key={`${target.task.id}:${target.time ?? ""}`} target={target} dispatcher={dispatcher} onClose={onClose} onDone={onDone} /> : null;
}

function AssignBody({ target, dispatcher, onClose, onDone }: { target: AssignTarget; dispatcher: boolean; onClose: () => void; onDone: () => void }) {
  const { api, orgId, timezone } = useOrg();
  const n = useNotify();
  const [time, setTime] = useState(target.time ?? hhmm(target.task.scheduled_start ?? target.task.window_start, timezone) ?? "09:00");
  const [warn, setWarn] = useState<{ technician: string; warnings: string[] } | null>(null);
  const start = instantOf(target.day, time, timezone);
  const cands = useQuery({ queryKey: FIELD_KEYS.candidates(orgId, target.task.id, start), queryFn: () => fieldApi.candidates(api, target.task.id, start), enabled: !!start });
  const assign = useAction((v: { technician: string; force?: boolean }) => fieldApi.assign(api, target.task.id, { technician_id: v.technician, start, force: v.force }), {
    onSuccess: (d, v) => {
      if (d.assigned) {
        n.ok(d.warnings.length ? "با وجود هشدارها واگذار شد" : "وظیفه واگذار شد");
        onDone();
      } else setWarn({ technician: v.technician, warnings: d.warnings });
    },
  });
  const auto = useAction(() => fieldApi.autoAssign(api, target.task.id), {
    onSuccess: (d) => {
      if (d.assigned) {
        n.ok("به بهترین تکنسین در دسترس واگذار شد");
        onDone();
      } else n.error(new Error(d.warnings.join("؛ ") || "تکنسین شایسته‌ای در دسترس نیست"));
    },
  });
  const list = (cands.data?.candidates ?? []) as Candidate[];
  return (
    <Modal open title={`واگذاری ${target.task.number ?? ""}`} onCancel={onClose} footer={null} width={640} destroyOnHidden>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2">{target.task.short_description}</p>
        <label className="flex items-center gap-2 text-[13px]">
          <span>ساعت شروع</span>
          <Input value={time} onChange={(e) => setTime(e.target.value)} className="ltr" style={{ inlineSize: 90 }} status={start ? undefined : "error"} aria-label="ساعت شروع (۲۴ ساعته)" placeholder="09:30" />
          <Button icon={<Sparkles {...ICON} />} onClick={() => auto.mutate(undefined)} loading={auto.isPending}>بهترین تکنسین اکنون</Button>
        </label>
        {warn ? (
          <div className="rounded-lg border border-line p-3 text-[13px]" role="alert">
            <p className="mb-1">این واگذاری با این هشدارها همراه است:</p>
            <ul className="list-disc ps-4 text-ink-2">{warn.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            <div className="mt-2 flex gap-2">
              {dispatcher ? <Button type="primary" onClick={() => assign.mutate({ technician: warn.technician, force: true })} loading={assign.isPending}>با این حال واگذار شود</Button> : null}
              <Button onClick={() => setWarn(null)}>انتخاب دیگر</Button>
            </div>
          </div>
        ) : null}
        {cands.isLoading ? (
          <Loader />
        ) : !list.length ? (
          <p className="text-ink-3">تکنسینی ثبت نشده است.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="تکنسین‌ها به ترتیب شایستگی">
            {list.map((c) => (
              <li key={c.user_id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 ${target.technician === c.user_id ? "bg-sunken" : ""}`}>
                <span className="min-w-[8rem] font-medium">{c.name ?? "—"}</span>
                <Chip tone={c.feasible ? "in" : "warning"}>{c.feasible ? "شایسته" : "با هشدار"}</Chip>
                {c.travel_minutes !== null ? <span className="text-[12px] text-ink-3">{toFa(c.distance_km ?? 0)} کیلومتر، {toFa(c.travel_minutes)} دقیقه</span> : null}
                <span className="flex-1 text-[12px] text-ink-3">{[...c.blockers, ...c.reasons].join("؛ ")}</span>
                <Button size="small" icon={<UserCheck {...ICON} />} onClick={() => assign.mutate({ technician: c.user_id })} loading={assign.isPending && assign.variables?.technician === c.user_id} disabled={!start}>
                  واگذاری
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
