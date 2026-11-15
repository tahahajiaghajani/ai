// «گردش‌کارها» (design F §5 page 1, §8.6; package F7): the person's workflows in four tabs kept in the address —
//   · «کارتابل»: the chips «گردش‌کارهای شما» (one per process with my open steps, each opening its diagram) and the rows:
//     my open process steps and my pending record approvals («تأیید رکورد», which open the record with its approval
//     panel); number, title, process or table, the step with its action, from whom, since when, the due pill, and
//     «به جانشینی از …»، «در دست …»، «در صف ارسال». A row opens my step's form (two clicks from the nav). Phones get cards;
//   · «گردش‌کارهای من»: the processes I take part in, my parts in each, «منتظر شما: ۳» and «شروع» where I may start;
//   · «پرونده‌ها»: the cases I read, filtered by «در جریان»، «پایان‌یافته»، «آغازشده توسط من», process, step and dates;
//     my starts a linked Windows app has not sent yet first («در صف ارسال»);
//   · «انجام‌شده‌ها»: the steps I did.
// The page opens on «کارتابل» when something waits for me, else on «گردش‌کارهای من». «شروع گردش‌کار» lists the
// processes I may start; when that list cannot be read, the page says so (with «تلاش دوباره») instead of an empty
// «گردش‌کارهای من» and a start menu gone without a word. The portal shows the same page in its shell (./portal.tsx).
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, Dropdown, Input, Pagination, Table, Tabs } from "antd";
import { ChevronDown, Inbox as InboxIcon, Play, Search, Workflow } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { errorText } from "../../../lib/api";
import { useOrg } from "../../../lib/org";
import { useIsPhone } from "../../../lib/hooks";
import { Note } from "../../../components/blocks";
import { Chip, EmptyState, Loader } from "../../../components/display";
import { DateRangeChip, FilterChip, ToggleChip } from "../../../components/inputs";
import { relTime } from "../../../records/model/activity";
import { RecordNo } from "../../../records/fields/display";
import { USER_KEYS, userApi, type CaseListRow, type DoneRow, type Inbox, type MyProcess } from "./api";
import {
  TABS, actionLabel, caseFiltersOf, currentText, filtered, inboxRowView, nameOf, outcomeWord, startable, tabOf, waitingText, withCaseFilter, type InboxRowView, type Tab,
} from "./model";
import { CaseState, Head, LoadError, Notes, useWf } from "./parts";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const PAGE_SIZE = 50;

/** «شروع گردش‌کار ▾»: the processes I may start. */
function StartMenu({ processes }: { processes: MyProcess[] }) {
  const wf = useWf();
  const nav = useNavigate();
  const list = startable(processes);
  if (!list.length) return null;
  if (list.length === 1)
    return (
      <Button type="primary" icon={<Play {...I16} />} onClick={() => nav(wf.to(wf.paths.start(list[0].key)))}>
        {`شروع «${list[0].name}»`}
      </Button>
    );
  return (
    <Dropdown trigger={["click"]} menu={{ items: list.map((p) => ({ key: p.key, label: p.name, onClick: () => nav(wf.to(wf.paths.start(p.key))) })) }}>
      <Button type="primary" icon={<Play {...I16} />}>
        شروع گردش‌کار
        <ChevronDown {...I16} aria-hidden />
      </Button>
    </Dropdown>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «کارتابل»

function InboxCard({ v }: { v: InboxRowView }) {
  const wf = useWf();
  return (
    <li>
      <Link to={wf.to(v.link)} className="wfu-card wfu-inbox-card">
        <span className="wfu-card-h">
          {v.number ? <RecordNo no={v.number} /> : null}
          {v.kind ? <Chip tone="info">{v.kind}</Chip> : null}
          {v.due ? <Chip tone={v.due.tone === "neutral" ? "neutral" : v.due.tone === "warning" ? "warning" : "danger"}>{v.due.text}</Chip> : null}
        </span>
        <span className="wfu-card-t">{v.title}</span>
        <span className="wfu-card-m">
          <span>{v.source}</span>
          <span>
            <Chip tone="accent" dot={false}>
              {v.action}
            </Chip>{" "}
            {v.step}
          </span>
          {v.from ? <span>از {v.from}</span> : null}
          {v.since ? <span>{relTime(v.since)}</span> : null}
        </span>
        <Notes notes={v.notes} />
      </Link>
    </li>
  );
}

function InboxTab({ inbox }: { inbox: Inbox }) {
  const wf = useWf();
  const phone = useIsPhone();
  const now = Date.now();
  const rows = useMemo(() => inbox.rows.map((r) => inboxRowView(r, inbox.display, wf.base, now)), [inbox, wf.base, now]);
  const chips = inbox.chips.length ? (
    <nav className="wfu-chips" aria-label="گردش‌کارهای شما">
      <span className="wfu-chips-t">گردش‌کارهای شما:</span>
      {inbox.chips.map((c) => (
        <Link key={c.process_id} to={wf.to(wf.paths.process(c.process_id))} className="wfu-pchip">
          <span>{c.name}</span>
          <span className="wfu-pchip-n ds-num">{faDigits(c.count)}</span>
        </Link>
      ))}
    </nav>
  ) : null;
  if (!rows.length)
    return (
      <>
        {chips}
        <EmptyState icon={InboxIcon} title="چیزی منتظر شما نیست" description="مرحله‌ها و تأییدهایی که به شما سپرده شود این‌جا می‌آید." />
      </>
    );
  return (
    <>
      {chips}
      {phone || wf.portal ? (
        <ul className="wfu-cards" aria-label="کارتابل">
          {rows.map((v) => (
            <InboxCard key={v.key} v={v} />
          ))}
        </ul>
      ) : (
        <Table<InboxRowView>
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={rows}
          className="wfu-table"
          columns={[
            { key: "no", title: "شماره", width: 130, render: (_, v) => (v.number ? <RecordNo no={v.number} /> : "—") },
            {
              key: "title",
              title: "عنوان",
              render: (_, v) => (
                <span className="wfu-title-cell">
                  <Link to={wf.to(v.link)} className="wfu-open">
                    {v.title}
                  </Link>
                  <Notes notes={v.notes} />
                </span>
              ),
            },
            { key: "source", title: "گردش‌کار یا جدول", render: (_, v) => v.source },
            {
              key: "step",
              title: "مرحله",
              render: (_, v) => (
                <span className="wfu-step-cell">
                  <Chip tone={v.kind ? "info" : "accent"} dot={false}>
                    {v.kind ?? v.action}
                  </Chip>
                  <span>{v.step}</span>
                </span>
              ),
            },
            { key: "from", title: "از", render: (_, v) => v.from || "—" },
            { key: "since", title: "منتظر از", width: 120, render: (_, v) => (v.since ? <span title={formatJalaliDateTime(v.since)}>{relTime(v.since)}</span> : "—") },
            { key: "due", title: "مهلت", width: 150, render: (_, v) => (v.due ? <Chip tone={v.due.tone === "neutral" ? "neutral" : v.due.tone === "warning" ? "warning" : "danger"}>{v.due.text}</Chip> : "—") },
          ]}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «گردش‌کارهای من»

/** A read of «گردش‌کارهای من» that failed (a server error, the network gone): said as such, with «تلاش دوباره». */
interface Failed {
  error: unknown;
  retry: () => void;
  busy: boolean;
}

function MineTab({ processes, failed }: { processes: MyProcess[]; failed: Failed | null }) {
  const wf = useWf();
  if (failed) return <LoadError title="گردش‌کارهای شما خوانده نشد" error={failed.error} retry={failed.retry} busy={failed.busy} />;
  if (!processes.length)
    return <EmptyState icon={Workflow} title="هنوز در گردش‌کاری نقش ندارید" description="گردش‌کارهایی که آغاز می‌کنید یا مرحله‌ای از آن‌ها با شماست این‌جا می‌آید." />;
  return (
    <ul className="wfu-grid" aria-label="گردش‌کارهای من">
      {processes.map((p) => (
        <li key={p.id} className="wfu-card wfu-proc">
          <div className="wfu-card-h">
            <Link to={wf.to(wf.paths.process(p.key))} className="wfu-card-t wfu-open">
              {p.name}
            </Link>
            {p.waiting ? (
              <Chip tone="warning">
                منتظر شما: <span className="ds-num">{faDigits(p.waiting)}</span>
              </Chip>
            ) : null}
          </div>
          {p.category ? <span className="wfu-card-m">{p.category}</span> : null}
          <ul className="wfu-parts" aria-label="نقش‌های شما">
            {p.parts.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="wfu-card-a">
            <Link to={wf.to(wf.paths.process(p.key))}>دیدن نمودار</Link>
            {p.can_start ? (
              <Link to={wf.to(wf.paths.start(p.key))} className="wfu-start-link">
                شروع
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «پرونده‌ها»

function CasesTab({ processes }: { processes: MyProcess[] }) {
  const { api, orgId, timezone } = useOrg();
  const wf = useWf();
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const f = caseFiltersOf(params);
  const [q, setQ] = useState(f.q ?? "");
  const query = { ...f, size: PAGE_SIZE };
  const cases = useQuery({ queryKey: USER_KEYS.cases(orgId, JSON.stringify(query)), queryFn: () => userApi.cases(api, query, timezone), staleTime: 15_000 });
  const chosen = f.process ? processes.find((p) => p.id === f.process || p.key === f.process) : undefined;
  const view = useQuery({ queryKey: USER_KEYS.view(orgId, chosen?.key ?? ""), queryFn: () => userApi.view(api, chosen!.key), enabled: !!chosen, staleTime: 60_000 });
  const set = (key: Parameters<typeof withCaseFilter>[1], value: string | boolean | number | null) => setParams((p) => withCaseFilter(p, key, value), { replace: true });
  const data = cases.data;
  const names = data?.display ?? {};
  const rows = data?.rows ?? [];
  return (
    <div className="wfu-cases">
      <div className="wfu-bar" role="search">
        <ToggleChip on={f.state === "open"} onChange={(on) => set("state", on ? "open" : null)}>
          در جریان
        </ToggleChip>
        <ToggleChip on={f.state === "closed"} onChange={(on) => set("state", on ? "closed" : null)}>
          پایان‌یافته
        </ToggleChip>
        <ToggleChip on={!!f.mine} onChange={(on) => set("mine", on)}>
          آغازشده توسط من
        </ToggleChip>
        {processes.length ? (
          <FilterChip label="گردش‌کار" value={chosen?.key ?? f.process ?? null} onChange={(v) => set("process", v)} options={processes.map((p) => ({ value: p.key, label: p.name }))} />
        ) : null}
        {view.data?.steps.length ? (
          <FilterChip label="مرحله" value={f.step ?? null} onChange={(v) => set("step", v)} options={view.data.steps.filter((s) => !s.start).map((s) => ({ value: s.key, label: s.label }))} />
        ) : null}
        <DateRangeChip label="تاریخ آغاز" value={{ from: f.from ?? null, to: f.to ?? null }} onChange={(r) => setParams((p) => withCaseFilter(withCaseFilter(p, "from", r.from), "to", r.to), { replace: true })} />
        <Input
          className="wfu-search"
          allowClear
          prefix={<Search {...I16} aria-hidden />}
          placeholder="جست‌وجو در عنوان و شماره"
          aria-label="جست‌وجو در پرونده‌ها"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) set("q", null);
          }}
          onPressEnter={() => set("q", q.trim() || null)}
        />
      </div>
      {data?.queued_starts.length ? (
        <section className="wfu-queued" aria-label="در صف ارسال">
          <h2 className="wfu-h2">در صف ارسال</h2>
          <ul className="wfu-cards">
            {data.queued_starts.map((s) => (
              <li key={s.id} className="wfu-card">
                <span className="wfu-card-t">{s.process_name ?? "پروندهٔ تازه"}</span>
                <span className="wfu-card-m">
                  <Chip tone="info">در صف ارسال</Chip>
                  {s.submitted_at ? <span>{relTime(s.submitted_at)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {cases.isLoading ? (
        <Loader />
      ) : cases.isError ? (
        <EmptyState title="پرونده‌ها خوانده نشد" description={cases.error instanceof Error ? cases.error.message : undefined} />
      ) : !rows.length ? (
        <EmptyState title={filtered(f) ? "پرونده‌ای با این شرط‌ها نیست" : "پرونده‌ای برای نمایش نیست"} description={filtered(f) ? "شرط‌ها را تغییر دهید." : "پرونده‌هایی که آغاز می‌کنید یا در آن‌ها نقشی دارید این‌جا می‌آید."} />
      ) : phone || wf.portal ? (
        <ul className="wfu-cards" aria-label="پرونده‌ها">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={wf.to(wf.paths.kase(r.id))} className="wfu-card">
                <span className="wfu-card-h">
                  {r.number ? <RecordNo no={r.number} /> : null}
                  <CaseState state={r.state} paused={r.paused_at} />
                </span>
                <span className="wfu-card-t">{r.title || r.number}</span>
                <span className="wfu-card-m">
                  <span>{r.process_name}</span>
                  {currentText(r) ? <span>{currentText(r)}</span> : null}
                  {r.started_at ? <span>{formatJalali(r.started_at)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Table<CaseListRow>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={rows}
          className="wfu-table"
          columns={[
            { key: "no", title: "شماره", width: 130, render: (_, r) => (r.number ? <RecordNo no={r.number} /> : "—") },
            {
              key: "title",
              title: "عنوان",
              render: (_, r) => (
                <Link to={wf.to(wf.paths.kase(r.id))} className="wfu-open">
                  {r.title || r.number || "—"}
                </Link>
              ),
            },
            { key: "process", title: "گردش‌کار", render: (_, r) => r.process_name ?? "—" },
            { key: "state", title: "وضعیت", width: 130, render: (_, r) => <CaseState state={r.state} paused={r.paused_at} /> },
            { key: "at", title: "مرحلهٔ کنونی", render: (_, r) => currentText(r) || "—" },
            { key: "by", title: "درخواست‌دهنده", render: (_, r) => nameOf(names, r.requested_for ?? r.requested_by) },
            { key: "started", title: "آغاز", width: 110, render: (_, r) => (r.started_at ? formatJalali(r.started_at) : "—") },
          ]}
        />
      )}
      {data && (data.total ?? 0) > PAGE_SIZE ? (
        <Pagination className="wfu-pager" current={f.page ?? 1} pageSize={PAGE_SIZE} total={data.total ?? 0} showSizeChanger={false} onChange={(page) => set("page", page > 1 ? page : null)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «انجام‌شده‌ها»

function DoneTab() {
  const { api, orgId } = useOrg();
  const wf = useWf();
  const phone = useIsPhone();
  const done = useQuery({ queryKey: USER_KEYS.done(orgId), queryFn: () => userApi.done(api, 200), staleTime: 30_000 });
  if (done.isLoading) return <Loader />;
  if (done.isError || !done.data) return <EmptyState title="انجام‌شده‌ها خوانده نشد" description={done.error instanceof Error ? done.error.message : undefined} />;
  const rows = done.data.rows;
  const names = done.data.display;
  if (!rows.length) return <EmptyState title="هنوز مرحله‌ای انجام نداده‌اید" description="مرحله‌هایی که انجام می‌دهید این‌جا می‌آید." />;
  const behalf = (r: DoneRow) => (r.acted_for ? `به جانشینی از ${nameOf(names, r.acted_for)}` : "");
  if (phone || wf.portal)
    return (
      <ul className="wfu-cards" aria-label="انجام‌شده‌ها">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={wf.to(wf.paths.kase(r.case_id))} className="wfu-card">
              <span className="wfu-card-h">
                {r.number ? <RecordNo no={r.number} /> : null}
                <Chip tone={r.outcome === "rejected" ? "danger" : r.outcome === "returned" ? "warning" : "in"}>{outcomeWord(r.outcome) || actionLabel(r.action)}</Chip>
              </span>
              <span className="wfu-card-t">{r.title || r.number}</span>
              <span className="wfu-card-m">
                <span>{r.process}</span>
                <span>{r.step}</span>
                {r.closed_at ? <span>{relTime(r.closed_at)}</span> : null}
                {behalf(r) ? <span>{behalf(r)}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  return (
    <Table<DoneRow>
      rowKey="id"
      size="small"
      pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
      dataSource={rows}
      className="wfu-table"
      columns={[
        { key: "no", title: "شماره", width: 130, render: (_, r) => (r.number ? <RecordNo no={r.number} /> : "—") },
        {
          key: "title",
          title: "عنوان",
          render: (_, r) => (
            <Link to={wf.to(wf.paths.kase(r.case_id))} className="wfu-open">
              {r.title || r.number || "—"}
            </Link>
          ),
        },
        { key: "process", title: "گردش‌کار", render: (_, r) => r.process ?? "—" },
        { key: "step", title: "مرحله", render: (_, r) => r.step ?? "—" },
        {
          key: "outcome",
          title: "تصمیم",
          render: (_, r) => (
            <span className="wfu-step-cell">
              <Chip tone={r.outcome === "rejected" ? "danger" : r.outcome === "returned" ? "warning" : "in"}>{outcomeWord(r.outcome) || "—"}</Chip>
              {behalf(r) ? <span className="rk-hint">{behalf(r)}</span> : null}
            </span>
          ),
        },
        { key: "at", title: "زمان", width: 120, render: (_, r) => (r.closed_at ? <span title={formatJalaliDateTime(r.closed_at)}>{relTime(r.closed_at)}</span> : "—") },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The page

export default function WorkflowsPage() {
  const { api, orgId } = useOrg();
  const [params, setParams] = useSearchParams();
  const inbox = useQuery({ queryKey: USER_KEYS.inbox(orgId), queryFn: () => userApi.inbox(api), staleTime: 15_000 });
  const mine = useQuery({ queryKey: USER_KEYS.mine(orgId), queryFn: () => userApi.mine(api), staleTime: 60_000 });
  if (inbox.isLoading || mine.isLoading) return <Loader />;
  if (inbox.isError || !inbox.data) return <EmptyState title="گردش‌کارها خوانده نشد" description={inbox.error instanceof Error ? inbox.error.message : undefined} />;
  const processes = mine.data?.processes ?? [];
  // a failed read is never «هنوز در گردش‌کاری نقش ندارید» nor a start menu gone without a word
  const mineFailed: Failed | null = mine.isError && !mine.data ? { error: mine.error, retry: () => void mine.refetch(), busy: mine.isFetching } : null;
  const tab = tabOf(params, inbox.data.default_tab);
  const waiting = inbox.data.counts.waiting;
  const setTab = (t: Tab) =>
    setParams(
      () => {
        const next = new URLSearchParams();
        next.set("tab", t);
        return next;
      },
      { replace: true },
    );
  const label = (t: Tab, text: string) => (t === "inbox" && waiting ? `${text} (${faDigits(waiting)})` : text);
  return (
    <div className="wfu-page">
      <Head title="گردش‌کارها" sub={waitingText(waiting) || undefined} actions={<StartMenu processes={processes} />} />
      {mineFailed && tab !== "mine" ? (
        <Note
          tone="danger"
          action={
            <Button size="small" loading={mineFailed.busy} onClick={mineFailed.retry}>
              تلاش دوباره
            </Button>
          }
        >
          {`فهرست گردش‌کارهای شما و «شروع گردش‌کار» خوانده نشد: ${errorText(mineFailed.error)}`}
        </Note>
      ) : null}
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as Tab)}
        className="wfu-tabs"
        items={TABS.map((t) => ({
          key: t.key,
          label: label(t.key, t.label),
          children:
            t.key !== tab ? null : t.key === "inbox" ? (
              <InboxTab inbox={inbox.data!} />
            ) : t.key === "mine" ? (
              <MineTab processes={processes} failed={mineFailed} />
            ) : t.key === "cases" ? (
              <CasesTab processes={processes} />
            ) : (
              <DoneTab />
            ),
        }))}
      />
    </div>
  );
}
