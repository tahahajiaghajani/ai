// «برنامهٔ ماه»: a plan for the coming month or quarter, built from the forecasts (cash weeks, sales, reorder,
// collections) with concrete steps written by the business's model (or the deterministic sections alone without one).
// Plans are kept: read, copy, ask the assistant about one, or delete it.
import { useState } from "react";
import { Button, Input, Segmented } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Copy, MessageCircleQuestion, Sparkles, Trash2 } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { EmptyState, JDateTime, Skeleton } from "../../components/display";
import { Card } from "../../modules/reports/kit";
import { openAssistant } from "../assistant/bus";
import { Narrative } from "../kit/Narrative";
import { useAiKey } from "../kit/hooks";
import type { AiPlanView } from "../kit/types";
import { planOf, plansOf } from "./data";
import { ICON, LoadError } from "./shared";

const HORIZON_LABEL = { month: "ماه آینده", quarter: "سه ماه آینده" } as const;

export function PlanTab() {
  const { api, can } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const key = useAiKey();
  const [horizon, setHorizon] = useState<"month" | "quarter">("month");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const list = useQuery({ queryKey: key("plans"), queryFn: () => api.get("/ai/plans").then(plansOf), retry: false });
  const plans = list.data ?? [];
  const current = sel ?? plans[0]?.id ?? null;
  const one = useQuery({
    queryKey: key("plan", current),
    queryFn: () => api.get(`/ai/plans/${current}`).then(planOf),
    enabled: !!current,
    retry: false,
  });
  const canWrite = can("ai", "view");

  const make = async () => {
    setBusy(true);
    try {
      const p = planOf(await api.post("/ai/plan", { horizon, focus: focus.trim() || null }));
      qc.setQueryData(key("plan", p.id), p);
      await qc.invalidateQueries({ queryKey: key("plans") });
      setSel(p.id);
      setFocus("");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: AiPlanView) => {
    if (!(await n.confirm(`حذف «${p.title}»؟`, "برنامه از فهرست برنامه‌های ذخیره‌شده پاک می‌شود.", true))) return;
    try {
      await api.del(`/ai/plans/${p.id}`);
      setSel(null);
      await qc.invalidateQueries({ queryKey: key("plans") });
    } catch (e) {
      n.error(e);
    }
  };
  const copy = async (p: AiPlanView) => {
    try {
      await navigator.clipboard.writeText(p.markdown);
      n.ok("متن برنامه رونوشت شد.");
    } catch {
      n.warn("رونوشت انجام نشد؛ متن را انتخاب و رونوشت کنید.");
    }
  };
  const p = one.data;

  return (
    <div className="ai-plan">
      <div className="bk-stack">
        {canWrite ? (
          <Card title="برنامهٔ تازه">
            <div className="ai-plan-new">
              <Segmented<"month" | "quarter">
                value={horizon}
                onChange={setHorizon}
                options={[
                  { value: "month", label: "ماه آینده" },
                  { value: "quarter", label: "سه ماه آینده" },
                ]}
                aria-label="افق برنامه"
              />
              <Input.TextArea value={focus} onChange={(e) => setFocus(e.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} maxLength={300} placeholder="تمرکز (اختیاری)، مثلاً «وصول مطالبات و کم کردن کالای راکد»" aria-label="تمرکز برنامه" />
              <Button type="primary" icon={<Sparkles {...ICON} />} loading={busy} onClick={make}>
                {busy ? "در حال نوشتن برنامه…" : "نوشتن برنامه"}
              </Button>
              {busy ? <p className="ai-fc-note">پیش‌بینی‌ها، چک‌ها و مطالبات خوانده می‌شود؛ ممکن است تا یک دقیقه طول بکشد.</p> : null}
            </div>
          </Card>
        ) : null}
        <Card title="برنامه‌های ذخیره‌شده" flush>
          {list.isLoading ? (
            <div className="bk-card-b">
              <Skeleton rows={4} />
            </div>
          ) : list.error ? (
            <div className="bk-card-b">
              <LoadError error={list.error} onRetry={() => list.refetch()} />
            </div>
          ) : !plans.length ? (
            <EmptyState compact icon={CalendarRange} title="هنوز برنامه‌ای نوشته نشده." />
          ) : (
            <ul className="ai-plan-l" role="listbox" aria-label="برنامه‌ها">
              {plans.map((x) => (
                <li key={x.id}>
                  <button type="button" role="option" aria-selected={x.id === current} className="ai-plan-i" onClick={() => setSel(x.id)}>
                    <b>{x.title || HORIZON_LABEL[x.horizon]}</b>
                    <span>
                      {HORIZON_LABEL[x.horizon]}
                      {x.created_at ? (
                        <>
                          {"، "}
                          <JDateTime v={x.created_at} />
                        </>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="ai-plan-doc">
        {!current ? (
          <div className="bk-card">
            <EmptyState icon={CalendarRange} title="برنامه‌ای انتخاب نشده." />
          </div>
        ) : one.isLoading && !p ? (
          <div className="bk-card">
            <div className="bk-card-b">
              <Skeleton rows={10} />
            </div>
          </div>
        ) : one.error ? (
          <LoadError error={one.error} onRetry={() => one.refetch()} />
        ) : p ? (
          <Card
            title={p.title || HORIZON_LABEL[p.horizon]}
            meta={
              <span className="bk-cap">
                {HORIZON_LABEL[p.horizon]}
                {p.focus ? `، تمرکز: ${p.focus}` : ""}
              </span>
            }
            tools={
              <span className="flex items-center gap-1">
                <Button size="small" type="text" icon={<MessageCircleQuestion {...ICON} />} onClick={() => openAssistant({ prompt: `دربارهٔ برنامهٔ «${p.title}» کمکم کن: از کدام قدم شروع کنم؟`, send: false, context: { path: "reports/forecast?tab=plan", title: "برنامهٔ ماه", record: { type: "ai_plan", id: p.id, label: p.title } } })}>
                  از دستیار بپرس
                </Button>
                <Button size="small" type="text" icon={<Copy {...ICON} />} onClick={() => copy(p)} aria-label="رونوشت متن" />
                <Button size="small" type="text" danger icon={<Trash2 {...ICON} />} onClick={() => remove(p)} aria-label="حذف برنامه" />
              </span>
            }
          >
            <Narrative text={p.markdown.replace(/^## .*\n+/, "")} className="ai-plan-md" />
            <p className="ai-fc-note">
              {p.source === "template" ? "بخش‌های این برنامه از داده‌ها ساخته شده؛ با راه‌اندازی هوش مصنوعی، قدم‌های پیشنهادی هم نوشته می‌شود." : "برنامه از پیش‌بینی‌ها و داده‌های همین کسب‌وکار نوشته شده؛ پیش از اجرا هر قدم را بسنجید."}
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
