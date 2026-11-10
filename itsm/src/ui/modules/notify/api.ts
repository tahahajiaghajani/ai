// Data of the notification screens: the caller's inbox (the bell and the notification center), their preferences,
// and for the settings pages the rule list with the built-ins, template previews, channel tests and the logs
// (/api/o/:org/notify — docs/spec/services/notify.md). Rules, templates and channels themselves are engine tables
// (generic API /r/<table>). The inbox, the count and the logs refresh with «زنده».
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxKind, NotifyEvent, NotifyPrefs, RecipientSpec, NotifyChannel, RuleGroupMode } from "@shared/notify";
import type { Cond } from "@shared/model/conditions";
import { useOrg } from "../../lib/org";
import { registerLiveQueries } from "../../lib/live";

export const KEYS = {
  count: (org: string) => ["notify-count", org],
  inbox: (org: string) => ["notify-inbox", org],
  prefs: (org: string) => ["notify-prefs", org],
  rules: (org: string) => ["notify-rules", org],
  log: (org: string) => ["notify-log", org],
  emailLog: (org: string) => ["notify-email-log", org],
  status: (org: string, id: string) => ["notify-inbox-status", org, id],
};

registerLiveQueries("notify-count", "notify-inbox", "notify-rules", "notify-log", "notify-email-log", "notify-inbox-status");

export interface InboxItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  table_key: string | null;
  record_id: string | null;
  record_number: string | null;
  event: NotifyEvent | null;
  kind: InboxKind;
  actor_id: string | null;
  created_at: string;
  shown_at: string;
  snoozed_until: string | null;
  read: boolean;
}

export interface InboxPage {
  items: InboxItem[];
  unread: number;
  display: Record<string, string>;
  more: boolean;
}

export interface InboxFilter {
  kind: InboxKind | null;
  unread: boolean;
  snoozed: boolean;
}

export interface RuleView {
  key: string;
  id: string | null;
  builtin: string | null;
  name: string;
  table: string;
  event: NotifyEvent;
  custom_event: string | null;
  entry_kinds: string[];
  condition: Cond | null;
  recipients: RecipientSpec;
  notify_actor: boolean;
  large_groups?: RuleGroupMode;
  channels: NotifyChannel[];
  targets: string[];
  template_id: string | null;
  digest: boolean;
  mandatory: boolean;
  active: boolean;
  description?: string | null;
  is_builtin: boolean;
  replaces: string | null;
  version: number | null;
}

export interface PreviewResult {
  record: { id: string; label: string } | null;
  problems: string[];
  subject: string | null;
  body: string | null;
  short: string | null;
  html: string | null;
}

export interface PreviewInput {
  table: string;
  event: NotifyEvent;
  record_id?: string | null;
  template_id?: string | null;
  subject?: string | null;
  body?: string | null;
  short_text?: string | null;
}

export interface LogEntry {
  id: string;
  created_at: string;
  rule_key: string | null;
  rule_name: string | null;
  event: string;
  event_label: string;
  table_key: string | null;
  table_label: string | null;
  record_id: string | null;
  record_number: string | null;
  channel: NotifyChannel;
  recipient_id: string | null;
  target: string | null;
  status: "sent" | "failed" | "skipped" | "held";
  reason: string | null;
  reason_label: string | null;
  error: string | null;
  subject: string | null;
  due_at: string | null;
}

export interface EmailLogEntry {
  id: string;
  channel_id: string | null;
  direction: "in" | "out";
  message_id: string | null;
  from_addr: string | null;
  to_addrs: string | null;
  subject: string | null;
  table_key: string | null;
  record_id: string | null;
  status: string;
  reason: string | null;
  reason_label: string | null;
  created_at: string;
}

export interface PollResult {
  fetched: number;
  created: number;
  replied: number;
  rejected: number;
  duplicate: number;
  failed: number;
}

export interface InboxStatus {
  last_checked_at: string | null;
  last_error: string | null;
  last_result: PollResult | null;
  inbound: boolean;
}

export function useUnreadCount(enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: KEYS.count(orgId),
    queryFn: () => api.get<{ unread: number }>("/notify/inbox/count"),
    staleTime: 20_000,
    enabled,
    retry: false,
  });
}

export function useInbox(f: InboxFilter, limit: number, enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: [...KEYS.inbox(orgId), f, limit],
    queryFn: () =>
      api.get<InboxPage>("/notify/inbox", {
        kind: f.kind ?? undefined,
        unread: f.unread ? "1" : undefined,
        snoozed: f.snoozed ? "1" : undefined,
        limit: String(limit),
      }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** After a change to the inbox: the count and every open list. */
export function useInboxRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return (unread?: number) => {
    if (typeof unread === "number") qc.setQueryData(KEYS.count(orgId), { unread });
    void qc.invalidateQueries({ queryKey: KEYS.inbox(orgId) });
    void qc.invalidateQueries({ queryKey: KEYS.count(orgId) });
  };
}

export function usePrefs() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: KEYS.prefs(orgId), queryFn: () => api.get<{ prefs: NotifyPrefs }>("/notify/prefs") });
}

export function useRules(enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: KEYS.rules(orgId), queryFn: () => api.get<{ rules: RuleView[] }>("/notify/rules"), enabled, retry: false });
}
