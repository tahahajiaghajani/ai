// Header actions of the problem tables:
//   problem            «اقدام‌ها»: link incidents, merge duplicate problems, share the workaround or the fix with the linked
//                      open incidents (as a note for agents or a reply to requesters), a known error from the problem
//   problem_candidate  turn it into a problem, or add its incidents to an existing problem
//   problem_task       copy its findings to the problem
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Dropdown, Modal, Radio, type MenuProps } from "antd";
import { ChevronDown, ArrowUpFromLine, GitMerge, Lightbulb } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import { RecordSelect, recordPath, type RecordContext } from "../../records";
import { problemApi } from "./api";

const fa = (n: number) => n.toLocaleString("fa-IR");

function outcomeText(o: { done: string[]; failed: { message: string }[] }, verb: string): string {
  if (!o.failed.length) return `${fa(o.done.length)} مورد ${verb}.`;
  return `${fa(o.done.length)} مورد ${verb}؛ ${fa(o.failed.length)} مورد انجام نشد (${o.failed[0].message}).`;
}

export function ProblemActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const may = !!(ctx.meta as { problem?: { can_work?: boolean } }).problem?.can_work;
  const open = !!ctx.row.active;
  const [dialog, setDialog] = useState<null | "link" | "merge" | "share">(null);
  const ke = useAction(() => problemApi.knownError(api, ctx.row.id), {
    success: (d) => `خطای شناخته‌شدهٔ ${d.row.number} ساخته شد.`,
    onSuccess: (d) => nav(`/${orgId}/${recordPath("known_error", d.row.id)}`),
  });
  if (!may) return null;
  const items: MenuProps["items"] = [];
  if (open) items.push({ key: "link", label: "پیوند رخدادها…" }, { key: "merge", label: "ادغام مشکلات تکراری…" });
  items.push({ key: "share", label: "اطلاع‌رسانی راه‌حل به رخدادها…" }, { key: "ke", label: "ساخت خطای شناخته‌شده" });
  const onClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "ke") ke.mutate(undefined);
    else setDialog(key as "link" | "merge" | "share");
  };
  return (
    <>
      <Dropdown menu={{ items, onClick }} trigger={["click"]}>
        <Button loading={ke.isPending}>
          اقدام‌ها <ChevronDown {...ICON14} aria-hidden />
        </Button>
      </Dropdown>
      {dialog === "link" ? <PickDialog ctx={ctx} kind="link" onClose={() => setDialog(null)} /> : null}
      {dialog === "merge" ? <PickDialog ctx={ctx} kind="merge" onClose={() => setDialog(null)} /> : null}
      {dialog === "share" ? <ShareDialog ctx={ctx} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function PickDialog({ ctx, kind, onClose }: { ctx: RecordContext; kind: "link" | "merge"; onClose: () => void }) {
  const { api } = useOrg();
  const [ids, setIds] = useState<string[]>([]);
  const run = useAction(() => (kind === "link" ? problemApi.link(api, ctx.row.id, ids) : problemApi.merge(api, ctx.row.id, ids)), {
    success: (d) => outcomeText(d, kind === "link" ? "پیوند شد" : "ادغام شد"),
    onSuccess: () => {
      onClose();
      ctx.refresh();
    },
  });
  return (
    <Modal open title={kind === "link" ? "پیوند رخدادها به این مشکل" : `ادغام در ${ctx.row.number ?? "این مشکل"}`} okText={kind === "link" ? "پیوند" : "ادغام"} cancelText="انصراف" onCancel={onClose} onOk={() => run.mutate(undefined)} confirmLoading={run.isPending} okButtonProps={{ disabled: !ids.length }} destroyOnHidden>
      {kind === "merge" ? <p className="mb-3 text-[13px] text-ink-2">رخدادها و خطاهای شناخته‌شدهٔ مشکلات تکراری به این مشکل منتقل و آن‌ها بسته می‌شوند.</p> : null}
      <RecordSelect
        table={kind === "link" ? "incident" : "problem"}
        multiple
        value={ids}
        onChange={(v) => setIds(((v as string[]) ?? []).filter((x) => x !== ctx.row.id))}
        filter={kind === "link" ? { f: "problem_id", op: "ne", v: ctx.row.id } : { f: "active", op: "eq", v: true }}
        aria-label={kind === "link" ? "رخدادها" : "مشکلات تکراری"}
        className="w-full"
      />
    </Modal>
  );
}

function ShareDialog({ ctx, onClose }: { ctx: RecordContext; onClose: () => void }) {
  const { api } = useOrg();
  const [kind, setKind] = useState<"workaround" | "fix">(ctx.row.fix_notes ? "fix" : "workaround");
  const [audience, setAudience] = useState<"agents" | "callers">("agents");
  const run = useAction(() => problemApi.share(api, ctx.row.id, kind, audience), {
    success: (d) => `برای ${fa(d.incidents)} رخداد باز فرستاده شد.`,
    onSuccess: () => {
      onClose();
      ctx.refresh();
    },
  });
  const text = kind === "fix" ? ctx.row.fix_notes : ctx.row.workaround;
  return (
    <Modal open title="اطلاع‌رسانی راه‌حل به رخدادهای مرتبط" okText="فرستادن" cancelText="انصراف" onCancel={onClose} onOk={() => run.mutate(undefined)} confirmLoading={run.isPending} okButtonProps={{ disabled: !text }} destroyOnHidden>
      <div className="flex flex-col gap-3">
        <Radio.Group value={kind} onChange={(e) => setKind(e.target.value)} optionType="button" options={[{ value: "workaround", label: "راه‌حل موقت" }, { value: "fix", label: "راه‌حل دائمی" }]} />
        <Radio.Group value={audience} onChange={(e) => setAudience(e.target.value)} options={[{ value: "agents", label: "یادداشت داخلی برای کارشناسان" }, { value: "callers", label: "پاسخ به درخواست‌دهندگان" }]} />
        {!text ? <p className="text-[13px] text-danger">این متن در مشکل نوشته نشده است.</p> : <p className="line-clamp-4 whitespace-pre-wrap text-[13px] text-ink-2">{String(text)}</p>}
      </div>
    </Modal>
  );
}

export function CandidateActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [merging, setMerging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const promote = useAction(() => problemApi.promote(api, ctx.row.id), {
    success: (d) => `مشکل ${d.problem.number} ساخته شد.`,
    onSuccess: (d) => nav(`/${orgId}/${recordPath("problem", d.problem.id)}`),
  });
  const merge = useAction(() => problemApi.mergeCandidate(api, ctx.row.id, problem!), {
    success: (d) => outcomeText(d, "پیوند شد"),
    onSuccess: () => {
      setMerging(false);
      ctx.refresh();
    },
  });
  if (!ctx.meta.canWrite || !["new", "reviewing"].includes(String(ctx.row.state))) return null;
  return (
    <>
      <Button icon={<ArrowUpFromLine {...ICON14} />} onClick={() => promote.mutate(undefined)} loading={promote.isPending}>
        تبدیل به مشکل
      </Button>
      <Button icon={<GitMerge {...ICON14} />} onClick={() => setMerging(true)}>
        پیوستن به مشکل موجود
      </Button>
      {merging ? (
        <Modal open title="پیوستن رخدادهای نامزد به مشکل موجود" okText="پیوستن" cancelText="انصراف" onCancel={() => setMerging(false)} onOk={() => merge.mutate(undefined)} confirmLoading={merge.isPending} okButtonProps={{ disabled: !problem }} destroyOnHidden>
          <RecordSelect table="problem" value={problem} onChange={(v) => setProblem((v as string) ?? null)} filter={{ f: "active", op: "eq", v: true }} aria-label="مشکل" className="w-full" />
        </Modal>
      ) : null}
    </>
  );
}

export function TaskActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const n = useNotify();
  const copy = useAction(() => problemApi.copyFindings(api, ctx.row.id), { onSuccess: () => n.ok("یافته‌ها به مشکل منتقل شد.") });
  if (!ctx.row.findings || !ctx.row.problem_id) return null;
  return (
    <Button icon={<Lightbulb {...ICON14} />} onClick={() => copy.mutate(undefined)} loading={copy.isPending}>
      انتقال یافته‌ها به مشکل
    </Button>
  );
}
