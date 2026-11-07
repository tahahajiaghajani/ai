// «اعلان‌ها»: the notification center the bell opens. The caller's own inbox (the server renders every item under
// the recipient's access, so nothing here can show more than they may read): tabs per kind (direct, watching,
// approvals, SLA, system), all / unread / snoozed, mark read (one or all), «بعداً یادآوری کن», and a click opens the
// record on its module's page. Older items are in the full list (`r/notification`).
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Drawer, Dropdown, Segmented, Tooltip } from "antd";
import { BellOff, Check, CheckCheck, Clock, Settings2, Undo2 } from "lucide-react";
import { INBOX_KINDS, type InboxKind } from "@shared/notify";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { useIsPhone } from "../../lib/hooks";
import { ICON14, cx } from "../../components/blocks";
import { EmptyState, Skeleton } from "../../components/display";
import { plainExcerpt } from "../../records/fields/display";
import { relTime } from "../../records/model/activity";
import { recordPath } from "../../records/extensions";
import { useInbox, useInboxRefresh, type InboxFilter, type InboxItem } from "./api";
import { groupByDay, snoozeOptions } from "./model";

type Show = "all" | "unread" | "snoozed";
const SHOWS: { value: Show; label: string }[] = [
  { value: "all", label: "همه" },
  { value: "unread", label: "خوانده‌نشده" },
  { value: "snoozed", label: "به تعویق‌افتاده" },
];
const PAGE = 30;

export default function NotificationCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const phone = useIsPhone();
  const refresh = useInboxRefresh();
  const [kind, setKind] = useState<InboxKind | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [limit, setLimit] = useState(PAGE);
  const filter: InboxFilter = { kind, unread: show === "unread", snoozed: show === "snoozed" };
  const q = useInbox(filter, limit, open);
  const items = q.data?.items ?? [];
  const unread = q.data?.unread ?? 0;
  const now = new Date();
  const groups = useMemo(() => groupByDay(items, new Date(), timezone), [items, timezone]);

  const run = async (fn: () => Promise<{ unread?: number } | unknown>) => {
    try {
      const r = (await fn()) as { unread?: number } | undefined;
      refresh(typeof r?.unread === "number" ? r.unread : undefined);
    } catch (e) {
      n.error(e);
    }
  };
  const markRead = (ids: string[]) => run(() => api.post<{ unread: number }>("/notify/inbox/read", { ids }));
  const markAll = () => run(() => api.post<{ unread: number }>("/notify/inbox/read", { all: true }));
  const snooze = (ids: string[], minutes: number | null) =>
    run(async () => {
      const r = await api.post<{ unread: number; until: string | null }>("/notify/inbox/snooze", minutes ? { ids, minutes } : { ids, until: null });
      if (r.until) n.ok(`تا ${formatJalaliDateTime(r.until, timezone)} کنار گذاشته شد.`);
      return r;
    });

  const target = (it: InboxItem): string | null => {
    if (it.table_key && it.record_id) return `/${orgId}/${recordPath(it.table_key, it.record_id)}`;
    if (it.link && !/^[a-z]+:/i.test(it.link)) return `/${orgId}/${it.link.replace(/^\/+/, "")}`;
    return null;
  };
  const openItem = (it: InboxItem) => {
    if (!it.read) void markRead([it.id]);
    const to = target(it);
    if (to) {
      onClose();
      nav(to);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLLIElement>, it: InboxItem) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openItem(it);
    }
  };

  const kinds: { key: InboxKind | null; label: string }[] = [{ key: null, label: "همه" }, ...(Object.entries(INBOX_KINDS) as [InboxKind, string][]).map(([key, label]) => ({ key, label }))];
  const emptyTitle = show === "unread" ? "همهٔ اعلان‌ها را خوانده‌اید" : show === "snoozed" ? "اعلانی کنار گذاشته نشده است" : "اعلانی نیست";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="left"
      size={phone ? "100%" : 440}
      title={unread ? `اعلان‌ها (${faDigits(String(unread))} خوانده‌نشده)` : "اعلان‌ها"}
      extra={
        <div className="flex items-center gap-1">
          <Tooltip title="همه را خواندم">
            <Button type="text" size="small" icon={<CheckCheck {...ICON14} />} disabled={!unread} onClick={markAll} aria-label="همه را خواندم" />
          </Tooltip>
          <Tooltip title="تنظیم اعلان‌های من">
            <Link to={`/${orgId}/notify/prefs`} onClick={onClose} aria-label="تنظیم اعلان‌های من" className="sh-icon-btn sh-icon-sm">
              <Settings2 {...ICON14} aria-hidden />
            </Link>
          </Tooltip>
        </div>
      }
    >
      <div className="nf-center">
        <div className="nf-kinds" role="group" aria-label="دسته">
          {kinds.map((k) => (
            <button
              key={k.key ?? "all"}
              type="button"
              className="nf-kind"
              aria-pressed={kind === k.key}
              onClick={() => {
                setKind(k.key);
                setLimit(PAGE);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="nf-bar">
          <Segmented
            size="small"
            value={show}
            options={SHOWS}
            onChange={(v) => {
              setShow(v as Show);
              setLimit(PAGE);
            }}
          />
        </div>

        {q.isLoading ? (
          <Skeleton rows={5} />
        ) : !items.length ? (
          <EmptyState compact icon={BellOff} title={emptyTitle} />
        ) : (
          <div aria-live="polite">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="nf-day">{g.label}</h3>
                <ul className="nf-list">
                  {g.items.map((it) => (
                    <li
                      key={it.id}
                      className={cx("nf-item", !it.read && "is-unread")}
                      tabIndex={0}
                      onClick={() => openItem(it)}
                      onKeyDown={(e) => onKey(e, it)}
                      aria-label={`${it.read ? "" : "خوانده‌نشده: "}${it.title}`}
                    >
                      <i className="nf-dot" aria-hidden />
                      <div className="min-w-0">
                        <div className="nf-item-t">{it.title}</div>
                        {it.body ? <div className="nf-item-b">{plainExcerpt(it.body, 220)}</div> : null}
                        <div className="nf-item-m">
                          {it.record_number ? <span className="ds-ltr ds-num">{it.record_number}</span> : null}
                          {it.actor_id && q.data?.display[it.actor_id] ? <span>{q.data.display[it.actor_id]}</span> : null}
                          <span title={formatJalaliDateTime(it.shown_at, timezone)}>{relTime(it.shown_at, now.getTime(), timezone)}</span>
                          {it.snoozed_until && show === "snoozed" ? <span>تا {formatJalaliDateTime(it.snoozed_until, timezone)}</span> : null}
                        </div>
                      </div>
                      <div className="nf-item-x" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        {show === "snoozed" ? (
                          <Tooltip title="بازگرداندن اکنون">
                            <Button type="text" size="small" icon={<Undo2 {...ICON14} />} aria-label="بازگرداندن اکنون" onClick={() => snooze([it.id], null)} />
                          </Tooltip>
                        ) : (
                          <Dropdown
                            trigger={["click"]}
                            menu={{
                              items: snoozeOptions(new Date(), timezone).map((o) => ({ key: o.key, label: o.label })),
                              onClick: ({ key }) => {
                                const o = snoozeOptions(new Date(), timezone).find((x) => x.key === key);
                                if (o) void snooze([it.id], o.minutes);
                              },
                            }}
                          >
                            <Tooltip title="بعداً یادآوری کن">
                              <Button type="text" size="small" icon={<Clock {...ICON14} />} aria-label="بعداً یادآوری کن" />
                            </Tooltip>
                          </Dropdown>
                        )}
                        {!it.read ? (
                          <Tooltip title="خواندم">
                            <Button type="text" size="small" icon={<Check {...ICON14} />} aria-label="خواندم" onClick={() => markRead([it.id])} />
                          </Tooltip>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className="nf-more">
              {q.data?.more && limit < 100 ? (
                <Button size="small" loading={q.isFetching} onClick={() => setLimit(Math.min(100, limit + PAGE))}>
                  اعلان‌های بیشتر
                </Button>
              ) : null}
              <Link to={`/${orgId}/r/notification`} onClick={onClose} className="ds-link text-[13px]">
                همهٔ اعلان‌ها
              </Link>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
