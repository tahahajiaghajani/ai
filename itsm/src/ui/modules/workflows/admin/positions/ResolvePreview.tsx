// «پیش‌نمایش انجام‌دهنده» (design F §3.4, §8.4): whom a step's people settings find for a sample requester — the very
// resolver a step runs when it opens (POST /positions/resolve), with one line per person («علی احمدی — رئیس شعبه (شعبهٔ
// ونک)»; the demo pack's people marked «نمایشی»), delegations, what the step does when nobody is found (in a preview's
// words: nothing is sent to anyone), the resolver's notes (why nobody: no holder in the requester's unit, the pack's
// people left out of the organisation's own cases…) and the pool warnings. It starts as a «تکمیل فرم» step (an
// approval would keep the requester out) for the signed-in person; while a pack is loaded its people are offered first
// as sample requesters. The rules are the designer's own role-then-people picker (the kit's AssigneePicker), starting
// from the position the page was opened for.
import { useMemo, useState } from "react";
import { Button, Drawer, Segmented } from "antd";
import { UserSearch } from "lucide-react";
import { STEP_ACTIONS, STEP_ACTION_LABELS, type StepAction, type StepAssignees } from "@shared/process";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { Note } from "../../../../components/blocks";
import { Chip } from "../../../../components/display";
import { useMe } from "../../../../records/data/hooks";
import { AssigneePicker, DemoTag, MemberSelect, previewLines, previewVerdict } from "../../kit";
import { F, useSheetSize } from "../fields/parts";
import { positionsApi, type PositionOverview, type ResolveResult } from "./api";
import { PREVIEW_ACTION, RESOLVE_STATUS, previewStep } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function ResolvePreview({ positions, initial, onClose }: { positions: PositionOverview[]; initial: string | null; onClose: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const { userId } = useMe();
  const size = useSheetSize(640);
  const start = useMemo(() => previewStep(positions.find((p) => p.id === initial) ?? null), [positions, initial]);
  const [step, setStep] = useState<StepAssignees>(start);
  // «تکمیل فرم» first: on an approval the sample requester is kept out, so their own position's holder would not show (B7)
  const [action, setAction] = useState<StepAction>(PREVIEW_ACTION);
  const [requester, setRequester] = useState<string | null>(userId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);

  const run = async () => {
    if (!requester) return;
    setBusy(true);
    try {
      setResult(await positionsApi.resolve(api, { step, action, requester, label: "پیش‌نمایش" }));
    } catch (e) {
      setResult(null);
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const status = result ? RESOLVE_STATUS[result.status] : null;
  const verdict = result ? previewVerdict(result, { action, ifNobody: step.ifNobody ?? null }) : null;
  return (
    <Drawer
      open
      size={size}
      placement="left"
      title="پیش‌نمایش انجام‌دهنده"
      onClose={onClose}
      destroyOnHidden
      footer={
        <div className="wff-foot">
          <span className="wff-foot-gap" />
          <Button onClick={onClose}>بستن</Button>
          <Button type="primary" icon={<UserSearch {...I16} />} onClick={run} loading={busy} disabled={!requester}>
            پیش‌نمایش
          </Button>
        </div>
      }
    >
      <div className="wff-sheet">
        <section className="wff-sec">
          <h3>مرحله</h3>
          <div className="wff-grid">
            <F label="کار مرحله">
              <Segmented value={action} onChange={(v) => (setAction(v as StepAction), setResult(null))} options={STEP_ACTIONS.map((a) => ({ value: a, label: STEP_ACTION_LABELS[a] }))} aria-label="کار مرحله" />
            </F>
            <F label="درخواست‌دهندهٔ نمونه" htmlFor="wfp-req">
              <MemberSelect id="wfp-req" value={requester} onChange={(v) => (setRequester((v as string | null) ?? null), setResult(null))} allowClear={false} demo="first" meFirst aria-label="درخواست‌دهندهٔ نمونه" />
            </F>
          </div>
        </section>
        <section className="wff-sec">
          <h3>انجام‌دهنده</h3>
          <AssigneePicker value={step} onChange={(v) => (setStep(v), setResult(null))} action={action} />
        </section>
        {result && status ? (
          <section className="wff-sec" aria-live="polite">
            <h3>
              نتیجه <Chip tone={status.tone}>{status.label}</Chip>
            </h3>
            {verdict ? <Note tone={verdict.tone}>{verdict.text}</Note> : null}
            {result.lines.length ? (
              <ol className="wfp-lines">
                {previewLines(result).map((l, i) => (
                  <li key={i}>
                    {l.line}
                    {l.demo ? <DemoTag /> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {result.found > result.lines.length ? <p className="rk-hint">{faDigits(result.found)} نفر پیدا شد؛ مرحله حداکثر {faDigits(result.limit)} نفر می‌گیرد.</p> : null}
            {result.fallbackUsed ? <p className="rk-hint">قاعده‌های اصلی کسی را نیافتند؛ جایگزین به کار رفت.</p> : null}
            {[...result.notes, ...result.warnings].map((w) => (
              <p key={w} className="wfk-warn">
                {w}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
