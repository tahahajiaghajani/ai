// «گردش‌کارها» (design F §4, §8.3, D14; package F6): every workflow of the system in one place — the organisation's own
// processes, the lifecycles of the tables (the safe subset; labels only for change requests), and the kinds other
// modules keep (change models, approval rules, automation flows, catalogue fulfilment flows and task plans, employee
// journeys, security response playbooks) — each row opening its editor (the designer, the lifecycle editor, or the
// module's own page). Kind chips (kept in `?kind=`) with their counts and a search narrow it. On top, the notices that
// apply: customised roles without «ثبت در کارها» (with «افزودن حق») and processes whose shared lists changed since their
// publish. «گردش‌کار تازه» names a process and opens its designer; a process row's «⋯» publishes or retires it. The
// first use shows what the page is for; «قاعده‌ها» at the end links the rules that are not workflows. Phones read.
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AutoComplete, Button, Dropdown, Input, Modal, Table, Tooltip } from "antd";
import { Archive, MoreHorizontal, Plus, Search, Send, ShieldPlus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { useSession } from "../../../../lib/session";
import { useIsPhone, useNotify } from "../../../../lib/hooks";
import { ApiError } from "../../../../lib/api";
import { PageHeader } from "../../../../components/layout";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { Note } from "../../../../components/blocks";
import { ToggleChip } from "../../../../components/inputs";
import { matchItem, useShellItems } from "../../../../components/shell/model";
import { ROUTES } from "../../../registry";
import { useSchema } from "../../../../records/data/hooks";
import { changedAt } from "../forms/model";
import { F, I14, I16 } from "../fields/parts";
import { HUB_KEYS, hubApi, type Hub, type HubKind, type HubNotice, type HubRow } from "./api";
import {
  KIND_SHORT, authorityHere, designerPath, editableText, fieldErrors, hubAccess, kindOf, listRows, moreText, newProcessBody, newProcessProblems, ownerIds, processActions,
  processCategories, processTarget, roleLine, routeMatches, rowLink, statusView, suggestKey, visibleRules, whereText, type ListRow, type NewProcessForm,
} from "./model";
import { PublishDialog, RetireDialog, type PublishTarget } from "./PublishDialog";
import "../../../../records/records.css";
import "./hub.css";

const ROUTE_PATHS = ROUTES.map((r) => r.path);
const hasRoute = (path: string) => routeMatches(ROUTE_PATHS, path);

export default function HubPage() {
  const org = useOrg();
  const { api, orgId, writable } = org;
  const access = hubAccess(org);
  const { meta } = useSession();
  const phone = useIsPhone();
  const n = useNotify();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<PublishTarget | null>(null);
  const [retiring, setRetiring] = useState<(PublishTarget & { open_cases?: number }) | null>(null);
  const hub = useQuery({ queryKey: HUB_KEYS.hub(orgId), queryFn: () => hubApi.hub(api), enabled: access.read, staleTime: 30_000 });
  const owners = useMemo(() => ownerIds(hub.data?.rows ?? []), [hub.data]);
  const people = useQuery({ queryKey: HUB_KEYS.people(orgId, owners.join(",")), queryFn: () => hubApi.people(api, owners), enabled: owners.length > 0, staleTime: 300_000 });
  const { schema } = useSchema();
  const items = useShellItems();
  const kind = kindOf(params);
  const setKind = (k: HubKind | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (k) next.set("kind", k);
        else next.delete("kind");
        return next;
      },
      { replace: true },
    );

  if (!access.read) return <EmptyState title="به «گردش‌کارها» دسترسی ندارید" description="دیدن گردش‌کارهای سامانه با طراحان فرم و گردش‌کار و مدیران تنظیمات سازمان است." />;
  if (hub.isLoading) return <Loader />;
  if (hub.isError || !hub.data) return <EmptyState title="گردش‌کارها خوانده نشد" description={hub.error instanceof Error ? hub.error.message : undefined} />;

  const data: Hub = hub.data;
  const authority = authorityHere(meta, orgId);
  const canCreate = data.can.create && writable && !phone;
  const canPublish = data.can.publish && writable && !phone;
  const processes = data.rows.filter((r) => r.kind === "process").length;
  const rows = listRows(data.rows, { kind, q });
  const rules = visibleRules(data.rules, (path) => !!matchItem(items, path));
  const names = people.data ?? {};
  const choices = schema?.choices ?? {};
  const acting = canPublish && authority;
  const columns = acting ? 7 : 6;
  const more = (r: ListRow) => r.type === "more";
  // the folded lifecycles are one cell across the table
  const cell = (first: boolean) => (r: ListRow) => (more(r) ? { colSpan: first ? columns : 0 } : {});
  const firstUse = data.empty && (!kind || kind === "process");

  const grantWork = async (role: { key: string; name: string }) => {
    if (!(await n.confirm(`افزودن حق ثبت در «کارها» به «${role.name}»؟`, "اعضای این نقش مرحله‌های گردش‌کار را از نسخهٔ ویندوز هم انجام می‌دهند؛ این تغییر در گزارش رویدادها ثبت می‌شود.", false, "افزودن حق"))) return;
    try {
      await hubApi.grantWork(api, role.key);
      await Promise.all([qc.invalidateQueries({ queryKey: HUB_KEYS.all(orgId) }), qc.invalidateQueries({ queryKey: ["access"] })]);
      n.ok(`حق ثبت در «کارها» به «${role.name}» افزوده شد`);
    } catch (e) {
      n.error(e);
    }
  };

  return (
    <div className="rk-admin wfh-page">
      <PageHeader
        title="گردش‌کارها"
        subtitle={processes ? `${faDigits(processes)} گردش‌کار سازمانی` : undefined}
        actions={
          canCreate ? (
            <Button type="primary" icon={<Plus {...I16} />} onClick={() => setCreating(true)}>
              گردش‌کار تازه
            </Button>
          ) : null
        }
      />
      {data.notices.map((x) => (
        <HubNoticeView
          key={`${x.kind}:${x.process?.id ?? ""}`}
          notice={x}
          orgId={orgId}
          onGrant={access.grantWork && !phone ? grantWork : undefined}
          onPublish={canPublish && authority && x.process ? () => setPublishing({ id: x.process!.id, name: x.process!.name }) : undefined}
        />
      ))}
      {firstUse ? (
        <EmptyState
          art="welcome"
          title="نخستین گردش‌کار سازمان را بسازید"
          description="گردش‌کارهای سازمان را این‌جا بسازید و همهٔ گردش‌کارهای سامانه را یک‌جا ببینید."
          action={
            canCreate ? (
              <Button type="primary" icon={<Plus {...I16} />} onClick={() => setCreating(true)}>
                گردش‌کار تازه
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {kind === "process" && firstUse ? null : (
        <div className="wfh-list">
          <div className="wfh-bar" role="search">
            <Input allowClear prefix={<Search {...I14} aria-hidden />} placeholder="جست‌وجوی گردش‌کار، جدول یا دسته…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی گردش‌کارها" className="wfh-search" />
            <span className="wfh-chips" aria-label="نوع گردش‌کار">
              <ToggleChip on={!kind} onChange={() => setKind(null)}>
                همه {faDigits(data.rows.length)}
              </ToggleChip>
              {data.kinds.map((k) => (
                <Tooltip key={k.key} title={`${k.module}؛ ${k.editable}`}>
                  <span>
                    <ToggleChip on={kind === k.key} onChange={(on) => setKind(on ? k.key : null)}>
                      {k.label} {faDigits(k.count)}
                    </ToggleChip>
                  </span>
                </Tooltip>
              ))}
            </span>
          </div>
          <Table<ListRow>
            size="small"
            className="ds-table wfh-table"
            rowKey="key"
            dataSource={rows}
            pagination={false}
            scroll={{ x: 960 }}
            rowClassName={(r) => (more(r) ? "wfh-more-row" : "")}
            locale={{ emptyText: <EmptyState compact title={data.rows.length ? "گردش‌کاری با این پالایه نیست" : "گردش‌کاری نیست"} /> }}
            columns={[
              {
                key: "name",
                title: "نام",
                onCell: cell(true),
                render: (_: unknown, r) =>
                  r.type === "more" ? (
                    <button type="button" className="ds-link wfh-more" onClick={() => setKind("lifecycle")}>
                      {moreText(r.count)}
                    </button>
                  ) : (
                    <RowName row={r.row} orgId={orgId} />
                  ),
              },
              { key: "kind", title: "نوع", onCell: cell(false), render: (_: unknown, r) => (r.type === "row" ? <Chip dot={false}>{KIND_SHORT[r.row.kind]}</Chip> : null) },
              {
                key: "where",
                title: "جدول یا دسته",
                onCell: cell(false),
                render: (_: unknown, r) => {
                  if (r.type !== "row") return null;
                  if (r.row.kind === "lifecycle" && r.row.table)
                    return (
                      <bdi dir="ltr" className="ds-mono text-ink-2">
                        {r.row.table}
                      </bdi>
                    );
                  return whereText(r.row, choices) || <span className="text-ink-3">—</span>;
                },
              },
              { key: "status", title: "وضعیت", onCell: cell(false), render: (_: unknown, r) => (r.type === "row" ? <StatusCell row={r.row} /> : null) },
              {
                key: "open",
                title: "پرونده‌های باز",
                align: "end" as const,
                onCell: cell(false),
                render: (_: unknown, r) => (r.type === "row" && r.row.kind === "process" ? <span className="ds-num">{faDigits(r.row.open_cases ?? 0)}</span> : r.type === "row" ? <span className="text-ink-3">—</span> : null),
              },
              {
                key: "at",
                title: "آخرین تغییر",
                onCell: cell(false),
                render: (_: unknown, r) => {
                  if (r.type !== "row") return null;
                  const when = changedAt(r.row.updated_at);
                  const who = r.row.owner ? names[r.row.owner] : null;
                  if (!when && !who) return <span className="text-ink-3">—</span>;
                  return (
                    <span className="wfh-at">
                      {when ? <span>{when}</span> : null}
                      {who ? <span className="rk-hint">{who}</span> : null}
                    </span>
                  );
                },
              },
              ...(acting
                ? [
                    {
                      key: "act",
                      title: <span className="sr-only">کارها</span>,
                      width: 48,
                      onCell: cell(false),
                      render: (_: unknown, r: ListRow) => {
                        if (r.type !== "row") return null;
                        const acts = processActions(r.row, { canPublish, authority, writable });
                        if (!acts.length) return null;
                        const target = processTarget(r.row);
                        return (
                          <Dropdown
                            trigger={["click"]}
                            menu={{
                              items: [
                                ...(acts.includes("publish") ? [{ key: "publish", icon: <Send {...I14} />, label: "انتشار…" }] : []),
                                ...(acts.includes("retire") ? [{ key: "retire", icon: <Archive {...I14} />, label: "بازنشسته‌کردن…", danger: true }] : []),
                              ],
                              onClick: ({ key }) => (key === "publish" ? setPublishing(target) : setRetiring(target)),
                            }}
                          >
                            <Button type="text" size="small" icon={<MoreHorizontal {...I16} />} aria-label={`کارهای «${r.row.name}»`} />
                          </Dropdown>
                        );
                      },
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}
      {rules.length ? (
        <p className="wfh-rules">
          <span className="text-ink-3">قاعده‌ها، جدا از گردش‌کارها: </span>
          {rules.map((r, i) => (
            <span key={r.link}>
              {i ? "، " : null}
              <Link className="ds-link" to={`/${orgId}/${r.link}`}>
                {r.label}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      {creating ? <NewProcess rows={data.rows} onClose={() => setCreating(false)} /> : null}
      {publishing ? <PublishDialog process={publishing} canPublish={data.can.publish} authority={authority} onClose={() => setPublishing(null)} /> : null}
      {retiring ? <RetireDialog process={retiring} onClose={() => setRetiring(null)} /> : null}
    </div>
  );
}

function RowName({ row, orgId }: { row: HubRow; orgId: string }) {
  const editable = editableText(row);
  return (
    <span className="wfh-name">
      <Link className="ds-link" to={`/${orgId}/${rowLink(row, hasRoute)}`}>
        {row.name}
      </Link>
      {editable ? <span className="rk-hint">{editable}</span> : null}
    </span>
  );
}

function StatusCell({ row }: { row: HubRow }) {
  const s = statusView(row);
  if (s.chip) return <Chip tone={s.chip}>{s.text}</Chip>;
  return <span className={s.quiet ? "text-ink-3" : "ds-status"}>{s.text}</span>;
}

function HubNoticeView({ notice, orgId, onGrant, onPublish }: { notice: HubNotice; orgId: string; onGrant?: (r: { key: string; name: string }) => void; onPublish?: () => void }) {
  if (notice.kind === "roles_without_work")
    return (
      <Note tone="warning" className="wfh-notice">
        <p className="wfh-p">{notice.message}</p>
        <ul className="wfh-roles">
          {(notice.roles ?? []).map((r) => (
            <li key={r.key}>
              <span>{roleLine(r)}</span>
              {onGrant ? (
                <Button size="small" icon={<ShieldPlus {...I14} />} onClick={() => onGrant(r)}>
                  افزودن حق
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Note>
    );
  return (
    <Note tone="warning" className="wfh-notice">
      <p className="wfh-p">{notice.message}</p>
      {notice.process ? (
        <span className="wfh-notice-acts">
          <Link className="ds-link" to={`/${orgId}/${designerPath(notice.process.id)}`}>
            بازکردن «{notice.process.name}»
          </Link>
          {onPublish ? (
            <Button size="small" icon={<Send {...I14} />} onClick={onPublish}>
              انتشار دوباره
            </Button>
          ) : null}
        </span>
      ) : null}
    </Note>
  );
}

const EMPTY_FORM: NewProcessForm = { name: "", key: "", category: "", description: "" };

/** «گردش‌کار تازه»: a name and a key; the designer opens next with «آغاز» and «ثبت درخواست» by the requester. */
function NewProcess({ rows, onClose }: { rows: HubRow[]; onClose: () => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<NewProcessForm>(EMPTY_FORM);
  // the key follows the name until it is typed
  const [keyTyped, setKeyTyped] = useState(false);
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<Partial<Record<keyof NewProcessForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const problems = newProcessProblems(form);
  const err = (k: keyof NewProcessForm) => server[k] ?? (tried ? problems[k] : undefined);
  const categories = processCategories(rows);
  const set = (p: Partial<NewProcessForm>) => {
    setServer({});
    setForm((f) => ({ ...f, ...p }));
  };
  const create = async () => {
    setTried(true);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const r = await hubApi.create(api, newProcessBody(form));
      await qc.invalidateQueries({ queryKey: HUB_KEYS.all(orgId) });
      n.ok(`«${r.process.name}» ساخته شد`);
      nav(`/${orgId}/${designerPath(r.process.id)}`);
    } catch (e) {
      const fields = e instanceof ApiError ? fieldErrors(e.details) : {};
      if (Object.keys(fields).length) setServer(fields);
      else n.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal open title="گردش‌کار تازه" onCancel={onClose} okText="ساخت و طراحی" cancelText="انصراف" onOk={create} okButtonProps={{ loading: busy }} width={520} destroyOnHidden>
      <div className="wfh-stack">
        <F label="نام گردش‌کار" htmlFor="wfh-new-name" error={err("name")}>
          <Input
            id="wfh-new-name"
            value={form.name}
            onChange={(e) => set({ name: e.target.value, ...(keyTyped ? {} : { key: suggestKey(e.target.value) }) })}
            maxLength={120}
            autoFocus
            onPressEnter={create}
            placeholder="مثلاً درخواست تنخواه شعبه"
            status={err("name") ? "error" : undefined}
          />
        </F>
        <F label="کلید" htmlFor="wfh-new-key" error={err("key")} hint="با حرف لاتین کوچک؛ در پیوندها و گزارش‌ها به کار می‌رود و پس از ساخت تغییر نمی‌کند.">
          <span dir="ltr" className="wfh-ltr">
            <Input
              id="wfh-new-key"
              className="ds-mono"
              style={{ direction: "ltr" }}
              value={form.key}
              onChange={(e) => {
                setKeyTyped(true);
                set({ key: e.target.value.toLowerCase().replace(/\s+/g, "_") });
              }}
              maxLength={40}
              onPressEnter={create}
              placeholder="petty_cash"
              status={err("key") ? "error" : undefined}
            />
          </span>
        </F>
        <F label="دسته" htmlFor="wfh-new-cat" hint="گردش‌کارهای یک دسته در فهرست کاربران کنار هم می‌آیند.">
          <AutoComplete
            id="wfh-new-cat"
            value={form.category}
            onChange={(v) => set({ category: String(v ?? "") })}
            options={categories.map((c) => ({ value: c }))}
            filterOption={(input, o) => String(o?.value ?? "").includes(input)}
            maxLength={80}
            placeholder="مثلاً مالی"
          />
        </F>
        <F label="شرح" htmlFor="wfh-new-desc">
          <Input.TextArea id="wfh-new-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} />
        </F>
      </div>
    </Modal>
  );
}
