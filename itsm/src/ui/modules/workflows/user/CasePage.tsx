// A case (design F §5 page 4, §8.6; package F7) at `workflows/c/:id`, and its step form at `workflows/c/:id/s/:task`:
//   · header: the title, the number, when it began, the state channel («ثبت درخواست ●──● تأیید رئیس شعبه ──○ … ──○
//     پایان»), the due pill; my open step's primary action «انجام مرحلهٔ "…"»; «اقدام‌ها» (print; the managers' reassign,
//     pause, resume, cancel; a requester's cancel before any step after the start);
//   · tabs «نمودار» (my steps marked, a step of mine opens its form), «داده‌ها» (the values I may read, by form
//     sections; a «پیوست» value by its files' names, each opening its file — the case's attachments I may open),
//     «تاریخچه» (steps, submissions, the case's notes), «گفت‌وگو» (comments; a failed read says so, with «تلاش دوباره»);
//   · side rail: process and version, requester, started, current steps and their people, my part; it gives way to the
//     step form when one is open (a phone shows the form as a page of its own);
//   · in «نیاز به بررسی» the managers see «ادامه از مرحلهٔ …» and «لغو پرونده».
// `?open=step` (the record link of a notification lands here) opens my step at once. A linked Windows app does not
// offer what needs the connection (the managers' actions, «برداشتن کار»): F4c refuses them there.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button, Dropdown, Input, Tabs, type MenuProps } from "antd";
import { ChevronDown, MoreHorizontal, PenLine, Printer } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../../lib/org";
import { useSession } from "../../../lib/session";
import { useMediaQuery, useNotify } from "../../../lib/hooks";
import { cx, Note } from "../../../components/blocks";
import { Chip, EmptyState, Loader } from "../../../components/display";
import { relTime } from "../../../records/model/activity";
import { RecordNo } from "../../../records/fields/display";
import { RecordMarkdown } from "../../../records";
import { useMe, useSchema } from "../../../records/data/hooks";
import { authorityHere } from "../admin/hub/model";
import { ProcessCanvas, StepLegend, StepList, stepCounter, usedStatuses } from "../kit";
import { USER_KEYS, userApi, type CaseDetail } from "./api";
import { ManagerDialogs, type ManagerAction } from "./ManagerActions";
import { headerStep, isOpenCase, myPart, nameOf, openSteps, outcomeWord, stateChannel, stepOfText, takenFromStatuses, actionLabel } from "./model";
import { CaseState, CaseValues, DuePill, Head, LoadError, useMoneyUnit, useWf } from "./parts";
import { StepPanel } from "./StepPanel";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
type CaseTab = "diagram" | "data" | "history" | "talk";

function Channel({ detail }: { detail: CaseDetail }) {
  const finished = !isOpenCase(detail.case.state);
  const items = stateChannel(detail.graph, detail.statuses, finished);
  return (
    <ol className="wfu-channel" aria-label="مسیر پرونده">
      {items.map((s) => (
        <li key={s.key} className={cx("wfu-ch", `is-${s.state}`)} aria-current={s.state === "current" || s.state === "mine" ? "step" : undefined}>
          <span className="wfu-ch-dot" aria-hidden />
          <span className="wfu-ch-t">{s.label}</span>
          {s.state === "mine" ? <span className="wfu-ch-me">نوبت شما</span> : <span className="sr-only">{s.state === "done" ? "انجام‌شده" : s.state === "current" ? "در جریان" : "بعدی"}</span>}
        </li>
      ))}
    </ol>
  );
}

function Rail({ detail }: { detail: CaseDetail }) {
  const { userId } = useMe();
  const names = detail.display;
  const c = detail.case;
  const steps = openSteps(detail);
  const part = myPart(detail, userId);
  return (
    <section className="wfu-panel wfu-rail" aria-label="مشخصات پرونده">
      <dl className="wfu-dl">
        <div>
          <dt>گردش‌کار</dt>
          <dd>{`${c.process_name ?? "—"}${c.version_no ? ` · نسخهٔ ${faDigits(c.version_no)}` : ""}`}</dd>
        </div>
        <div>
          <dt>درخواست‌دهنده</dt>
          <dd>{nameOf(names, c.requested_by)}{c.requested_for && c.requested_for !== c.requested_by ? ` (برای ${nameOf(names, c.requested_for)})` : ""}</dd>
        </div>
        <div>
          <dt>آغاز</dt>
          <dd>{c.started_at ? formatJalaliDateTime(c.started_at) : "—"}</dd>
        </div>
        {c.ended_at ? (
          <div>
            <dt>پایان</dt>
            <dd>{formatJalaliDateTime(c.ended_at)}</dd>
          </div>
        ) : null}
        {steps.length ? (
          <div>
            <dt>مرحلهٔ کنونی</dt>
            <dd>
              <ul className="wfu-plain">
                {steps.map((s) => (
                  <li key={s.key}>
                    <b>{s.label}</b>
                    {s.people.length ? `: ${s.people.map((p) => nameOf(names, p)).join("، ")}` : ": کسی پیدا نشد"}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>نقش شما</dt>
          <dd>{part.length ? part.join("، ") : "خواننده"}</dd>
        </div>
        {c.confidential ? (
          <div>
            <dt>دسترسی</dt>
            <dd>محرمانه</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function History({ detail }: { detail: CaseDetail }) {
  const names = detail.display;
  const tasks = detail.history.tasks.filter((t) => t.status !== "open");
  const subs = detail.history.submissions.filter((s) => s.result === "late" || s.result === "refused");
  const notes = detail.history.journal;
  if (!tasks.length && !subs.length && !notes.length) return <p className="rk-hint">هنوز چیزی ثبت نشده است.</p>;
  return (
    <div className="wfu-history">
      {tasks.length ? (
        <section aria-label="مرحله‌ها">
          <h3 className="rk-sec-t">مرحله‌ها</h3>
          <ol className="wfu-timeline">
            {tasks.map((t) => (
              <li key={t.id}>
                <span className="wfu-tl-h">
                  <b>{t.step_label ?? t.step_key}</b>
                  {t.status === "done" ? (
                    <Chip tone={t.outcome === "rejected" ? "danger" : t.outcome === "returned" ? "warning" : "in"}>{outcomeWord(t.outcome) || "انجام‌شده"}</Chip>
                  ) : (
                    <Chip tone="neutral">{t.status === "not_needed" ? "دیگر لازم نیست" : "لغو"}</Chip>
                  )}
                  {t.round > 1 ? <span className="rk-hint">{`دور ${faDigits(t.round)}`}</span> : null}
                </span>
                <span className="wfu-tl-m">
                  <span>{t.status === "done" ? nameOf(names, t.acted_by) : nameOf(names, t.assigned_to)}</span>
                  {t.acted_for ? <span>{`به جانشینی از ${nameOf(names, t.acted_for)}`}</span> : null}
                  {t.closed_at ? <span title={formatJalaliDateTime(t.closed_at)}>{relTime(t.closed_at)}</span> : null}
                  <span>{actionLabel(t.action)}</span>
                </span>
                {t.comment ? <p className="wfu-tl-c">{t.comment}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {subs.length ? (
        <section aria-label="ثبت‌هایی که اعمال نشد">
          <h3 className="rk-sec-t">ثبت‌هایی که اعمال نشد</h3>
          <ul className="wfu-timeline">
            {subs.map((s) => (
              <li key={s.id}>
                <span className="wfu-tl-h">
                  <b>{nameOf(names, s.submitted_by)}</b>
                  <Chip tone={s.result === "late" ? "warning" : "danger"}>{s.result === "late" ? "دیرهنگام" : "پذیرفته نشد"}</Chip>
                </span>
                <span className="wfu-tl-m">{s.submitted_at ? <span>{relTime(s.submitted_at)}</span> : null}</span>
                {s.result_note ? <p className="wfu-tl-c">{s.result_note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {notes.length ? (
        <section aria-label="یادداشت‌های پرونده">
          <h3 className="rk-sec-t">یادداشت‌های پرونده</h3>
          <ul className="wfu-timeline">
            {notes.map((e) => (
              <li key={e.id}>
                <span className="wfu-tl-m">
                  {e.author ? <span>{nameOf(names, e.author)}</span> : <span>سامانه</span>}
                  <span title={formatJalaliDateTime(e.created_at)}>{relTime(e.created_at)}</span>
                </span>
                <p className="wfu-tl-c">{e.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** «گفت‌وگو»: the case's comments and a box for mine; comments that could not be read are said so, never «none yet». */
export function Talk({ caseId }: { caseId: string }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const talk = useQuery({ queryKey: USER_KEYS.talk(orgId, caseId), queryFn: () => userApi.talk(api, caseId), staleTime: 15_000 });
  const say = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await userApi.say(api, caseId, text.trim());
      setText("");
      await qc.invalidateQueries({ queryKey: USER_KEYS.talk(orgId, caseId) });
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const entries = [...(talk.data?.entries ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const names = talk.data?.display ?? {};
  return (
    <div className="wfu-talk">
      {talk.isLoading ? (
        <Loader />
      ) : talk.isError && !talk.data ? (
        <LoadError compact title="گفت‌وگو خوانده نشد" error={talk.error} retry={() => void talk.refetch()} busy={talk.isFetching} />
      ) : entries.length ? (
        <ul className="wfu-timeline">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="wfu-tl-m">
                <b>{e.author ? (typeof names[e.author] === "string" ? String(names[e.author]) : "—") : "سامانه"}</b>
                <span title={formatJalaliDateTime(e.created_at)}>{relTime(e.created_at)}</span>
              </span>
              <div className="wfu-tl-c">
                <RecordMarkdown text={e.body} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rk-hint">هنوز گفت‌وگویی نیست.</p>
      )}
      <label className="wfu-comment">
        <span>پیام شما</span>
        <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={5000} />
      </label>
      <div>
        <Button type="primary" loading={busy} disabled={!text.trim()} onClick={say}>
          فرستادن پیام
        </Button>
      </div>
    </div>
  );
}

export default function CasePage() {
  const { id = "", task } = useParams();
  const { api, orgId } = useOrg();
  const wf = useWf();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { meta } = useSession();
  const { schema } = useSchema();
  const { tz, userId } = useMe();
  const unit = useMoneyUnit();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState<CaseTab>("diagram");
  const [dialog, setDialog] = useState<ManagerAction | null>(null);
  const q = useQuery({ queryKey: USER_KEYS.kase(orgId, id), queryFn: () => userApi.kase(api, id), staleTime: 10_000 });
  // the case's files I may open: a «پیوست» value names them by id (refreshed with the case after a step is sent)
  const filesQ = useQuery({ queryKey: USER_KEYS.files(orgId, id), queryFn: () => userApi.files(api, id), enabled: q.isSuccess, staleTime: 10_000, retry: false });
  const files = filesQ.data;
  const filesLoading = q.isSuccess && filesQ.isPending;
  const detail = q.data;
  const authority = authorityHere(meta, orgId);
  const taken = useMemo(() => (detail ? takenFromStatuses(detail.graph, detail.statuses) : new Set<string>()), [detail]);
  const step = detail && task ? detail.my_steps.find((s) => s.id === task) ?? null : null;
  const first = detail ? headerStep(detail.my_steps) : null;
  // a notification's record link: my open step at once
  useEffect(() => {
    if (params.get("open") !== "step" || !detail) return;
    const next = new URLSearchParams(params);
    next.delete("open");
    if (first) nav({ pathname: wf.to(wf.paths.step(id, first.id)), search: next.toString() }, { replace: true });
    else setParams(next, { replace: true });
  }, [params, detail, first, nav, wf, id, setParams]);

  if (q.isLoading) return <Loader />;
  if (q.isError || !detail) return <EmptyState title="پرونده پیدا نشد" description={q.error instanceof Error ? q.error.message : "شاید به این پرونده دسترسی نداشته باشید."} />;
  const c = detail.case;
  const open = isOpenCase(c.state);
  const back = { to: wf.to(wf.paths.home("cases")), label: "پرونده‌ها" };
  const caseHref = wf.to(wf.paths.kase(id));
  const closeStep = () => nav(caseHref);
  const counter = stepCounter(detail.graph, detail.statuses);
  const requesterCancel = detail.can.cancel && !detail.can.manage;
  const menu: MenuProps["items"] = [
    { key: "print", icon: <Printer {...I16} />, label: "نسخهٔ چاپی", onClick: () => nav(wf.to(wf.paths.print(id))) },
    ...(authority && detail.can.reassign ? [{ key: "reassign", label: "ارجاع مرحله", onClick: () => setDialog("reassign") }] : []),
    ...(authority && detail.can.pause ? [{ key: "pause", label: "توقف موقت", onClick: () => setDialog("pause") }] : []),
    ...(authority && detail.can.resume ? [{ key: "resume", label: "ادامهٔ پرونده", onClick: () => setDialog("resume") }] : []),
    ...(authority && detail.can.resume_from ? [{ key: "resume_from", label: "ادامه از مرحلهٔ …", onClick: () => setDialog("resume_from") }] : []),
    ...(detail.can.cancel && (authority || requesterCancel) ? [{ type: "divider" as const }, { key: "cancel", danger: true, label: "لغو پرونده", onClick: () => setDialog("cancel") }] : []),
  ];
  const stepOpen = !!task;
  // a phone (or a narrow window): the step form is a page of its own
  if (stepOpen && !wide) {
    return (
      <div className="wfu-page wfu-steppage">
        <Head
          title={c.title ?? c.number ?? "پرونده"}
          sub={
            <span className="wfu-sub">
              <RecordNo no={c.number} />
              {counter.of ? <span>{stepOfText(counter.at, counter.of)}</span> : null}
            </span>
          }
          back={{ to: caseHref, label: "پرونده" }}
        />
        {step ? <StepPanel detail={detail} step={step} files={files} filesLoading={filesLoading} authority={authority} onDone={closeStep} /> : <EmptyState title="این مرحله دیگر با شما نیست" description="شاید پیش‌تر انجام شده یا به کس دیگری سپرده شده باشد." />}
      </div>
    );
  }
  const sub = (
    <span className="wfu-sub">
      {c.number ? <RecordNo no={c.number} /> : null}
      {c.started_at ? <span>{`آغاز ${relTime(c.started_at)}`}</span> : null}
      {!wide && open && counter.of ? <span>{stepOfText(counter.at, counter.of)}</span> : null}
      <CaseState state={c.state} paused={c.paused_at} />
    </span>
  );
  return (
    <div className="wfu-page wfu-case">
      <Head
        title={c.title ?? c.number ?? "پرونده"}
        sub={sub}
        back={back}
        actions={
          <>
            {first && !stepOpen ? (
              <Button type="primary" icon={<PenLine {...I16} />} onClick={() => nav(wf.to(wf.paths.step(id, first.id)))}>
                {`انجام مرحلهٔ «${first.label}»`}
              </Button>
            ) : null}
            <Dropdown trigger={["click"]} menu={{ items: menu }}>
              <Button icon={<MoreHorizontal {...I16} />} aria-label="اقدام‌ها">
                اقدام‌ها
                <ChevronDown {...I16} aria-hidden />
              </Button>
            </Dropdown>
          </>
        }
      />
      <div className="wfu-casebar">
        <Channel detail={detail} />
        {open ? <DuePill due={detail.due_at} prefix="مهلت" /> : null}
      </div>
      {c.state === "attention" && detail.can.manage ? (
        <Note
          tone="warning"
          action={
            authority ? (
              <span className="wfu-inline">
                {detail.can.resume_from ? <Button size="small" onClick={() => setDialog("resume_from")}>ادامه از مرحلهٔ …</Button> : null}
                {detail.can.cancel ? (
                  <Button size="small" danger onClick={() => setDialog("cancel")}>
                    لغو پرونده
                  </Button>
                ) : null}
              </span>
            ) : undefined
          }
        >
          {`پروندهٔ ${c.number ?? ""} متوقف شد؛ آن را از مرحله‌ای ادامه دهید یا لغو کنید.`}
        </Note>
      ) : c.state === "attention" ? (
        <Note tone="warning">{`پروندهٔ ${c.number ?? ""} متوقف شد؛ مسئولان گردش‌کار آن را بررسی می‌کنند.`}</Note>
      ) : null}
      {c.paused_at && open ? <Note>{`پرونده از ${formatJalali(c.paused_at)} موقتاً متوقف است.`}</Note> : null}
      <div className={cx("wfu-split", stepOpen && "has-step")}>
        <div className="wfu-main">
          <Tabs
            activeKey={tab}
            onChange={(k) => setTab(k as CaseTab)}
            items={[
              {
                key: "diagram",
                label: "نمودار",
                children: (
                  <div className="wfu-diagram">
                    {wide ? (
                      <ProcessCanvas
                        graph={detail.graph}
                        readOnly
                        statuses={detail.statuses}
                        taken={taken}
                        selected={step?.step_key ?? null}
                        onSelect={(nid) => {
                          const mine = nid ? detail.my_steps.find((s) => s.step_key === nid) : null;
                          if (mine) nav(wf.to(wf.paths.step(id, mine.id)));
                        }}
                        label={`نمودار پروندهٔ ${c.number ?? ""}`}
                        className="wfu-canvas"
                      />
                    ) : (
                      <StepList
                        graph={detail.graph}
                        statuses={detail.statuses}
                        onOpen={(nid) => {
                          const mine = detail.my_steps.find((s) => s.step_key === nid);
                          if (mine) nav(wf.to(wf.paths.step(id, mine.id)));
                        }}
                        label={`مرحله‌های پروندهٔ ${c.number ?? ""}`}
                      />
                    )}
                    <StepLegend only={usedStatuses(detail.statuses)} />
                  </div>
                ),
              },
              {
                key: "data",
                label: "داده‌ها",
                children: schema ? <CaseValues forms={detail.forms} data={detail.data} schema={schema} tz={tz} unit={unit} display={detail.display} files={files} /> : <Loader />,
              },
              { key: "history", label: "تاریخچه", children: <History detail={detail} /> },
              { key: "talk", label: "گفت‌وگو", children: <Talk caseId={id} /> },
            ]}
          />
          {!wide && !stepOpen ? <Rail detail={detail} /> : null}
        </div>
        {wide ? (
          <aside className="wfu-aside" aria-label={stepOpen ? "فرم مرحله" : "مشخصات پرونده"}>
            {stepOpen ? (
              step ? (
                <>
                  <div className="wfu-aside-close">
                    <Link to={caseHref}>بستن فرم</Link>
                  </div>
                  <StepPanel detail={detail} step={step} files={files} filesLoading={filesLoading} authority={authority} onDone={closeStep} />
                </>
              ) : (
                <EmptyState compact title="این مرحله دیگر با شما نیست" description="شاید پیش‌تر انجام شده یا به کس دیگری سپرده شده باشد." />
              )
            ) : (
              <Rail detail={detail} />
            )}
          </aside>
        ) : null}
      </div>
      <ManagerDialogs action={dialog} detail={detail} onClose={() => setDialog(null)} me={userId} />
    </div>
  );
}
