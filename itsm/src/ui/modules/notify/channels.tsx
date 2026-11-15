// Record extensions of the channel tables, kept light for the module's index: the widgets themselves load with the
// record page (ChannelWidgets.tsx). New SMS gateways can start from a preset: `…/new?kind=sms&preset=kavenegar`.
import { lazy, Suspense } from "@ui/lib/lazy";
import { SMS_PRESETS } from "@shared/notify";
import type { RecordExtensions } from "../../records/extensions";
import type { UiPolicy } from "../../records/model/policies";

const EmailChannelActions = lazy(() => import("./ChannelWidgets").then((m) => ({ default: m.EmailChannelActions })));
const InboxStatusPanel = lazy(() => import("./ChannelWidgets").then((m) => ({ default: m.InboxStatusPanel })));
const ChannelActions = lazy(() => import("./ChannelWidgets").then((m) => ({ default: m.ChannelActions })));

const hide = (...fields: string[]) => fields.map((field) => ({ field, visible: false }));
const SMS_FIELDS = ["sms_url", "sms_method", "sms_content_type", "sms_sender", "sms_body", "sms_headers"];
const IMAP_FIELDS = ["imap_host", "imap_port", "imap_security", "imap_user", "imap_password", "imap_folder", "target_table", "allow_list", "deny_list"];

/**
 * Only the fields a kind uses (what the server requires is marked; secrets never are — a stored one is not sent back
 * to the form). Messengers and webhooks need the member whose access their messages carry; SMS goes to people.
 */
export const CHANNEL_POLICIES: UiPolicy[] = [
  { key: "notify-hooks", when: { f: "kind", op: "in", v: ["slack", "teams", "mattermost", "webhook"] }, actions: [...hide("chat_id", ...SMS_FIELDS), { field: "principal_id", mandatory: true }] },
  { key: "notify-hooks-token", when: { f: "kind", op: "in", v: ["slack", "teams", "mattermost"] }, actions: hide("token") },
  { key: "notify-bots", when: { f: "kind", op: "in", v: ["telegram", "bale"] }, actions: [...hide("endpoint", ...SMS_FIELDS), { field: "principal_id", mandatory: true }, { field: "chat_id", mandatory: true }] },
  { key: "notify-sms", when: { f: "kind", op: "eq", v: "sms" }, actions: [...hide("endpoint", "chat_id", "principal_id"), { field: "sms_url", mandatory: true }] },
];

/** IMAP settings only while «دریافت ایمیل» is on (then server and user are required). */
export const EMAIL_POLICIES: UiPolicy[] = [
  { key: "notify-imap-off", when: { not: { f: "inbound", op: "eq", v: true } }, actions: hide(...IMAP_FIELDS) },
  { key: "notify-imap-on", when: { f: "inbound", op: "eq", v: true }, actions: [{ field: "imap_host", mandatory: true }, { field: "imap_user", mandatory: true }] },
];

export const emailChannelExtensions: RecordExtensions = {
  policies: EMAIL_POLICIES,
  headerActions: (ctx) => (
    <Suspense fallback={null}>
      <EmailChannelActions ctx={ctx} />
    </Suspense>
  ),
  sidePanels: [
    {
      key: "notify-inbox",
      title: "دریافت ایمیل",
      order: 5,
      when: (ctx) => !!ctx.row.id && !!ctx.row.inbound,
      render: (ctx) => (
        <Suspense fallback={null}>
          <InboxStatusPanel id={ctx.row.id} />
        </Suspense>
      ),
    },
  ],
};

/** Defaults of a new channel from the address: `kind`, and an SMS `preset`. */
export function channelDefaults(search: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const kind = search.get("kind");
  if (kind && /^[a-z]+$/.test(kind)) out.kind = kind;
  const preset = SMS_PRESETS[search.get("preset") ?? ""];
  if (preset) {
    const { label, ...fields } = preset;
    Object.assign(out, { kind: "sms", name: label, ...fields });
  }
  return out;
}

export const channelExtensions: RecordExtensions = {
  policies: CHANNEL_POLICIES,
  headerActions: (ctx) => (
    <Suspense fallback={null}>
      <ChannelActions ctx={ctx} />
    </Suspense>
  ),
  defaults: channelDefaults,
};
