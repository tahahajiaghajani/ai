# Notification service — notifications, e-mail and the inbox

Code: `src/shared/notify.ts` (vocabulary, preferences, template language — shared with the UI),
`src/shared/tables/notify.ts` (TableDefs), `src/server/modules/notify/*` (engine), `src/server/routes/notify.ts`
(HTTP), `src/ui/modules/notify/*` (bell, notification center, settings pages), migration `0010_notify`.
Catalog: PLT-058 (notification engine), PLT-059 (in-app notification center), PLT-060 (e-mail to record), the SMS
gateway template of INT-016 and the messenger channels of INT-017.

The one rule that shapes everything: **a message is rendered per recipient, under that recipient's access.** Rules
and recipients are resolved as the system; then every delivery reads the record through the engine with the
recipient's own context (`memberCtx`). Whoever cannot read the record (or the journal entry the event is about)
gets nothing; fields they may not see render as «(محدود)»; references they may not read stay unnamed; the change
list leaves out hidden fields. The same holds for messenger/webhook channels (rendered as the channel's principal),
for e-mail held for quiet hours or a digest (re-rendered when it finally goes out) and for the admin log (subjects of
records the viewer may not read are withheld).

## 1. Tables

Configuration (engine tables, area `notifications`, module `notify`; generic list/form/API, audit, sync):

| table | what | key fields |
| --- | --- | --- |
| `notification_rule` | when, to whom, how | `name`, `active`, `mandatory`, `table_key` (`*` for a built-in's copy), `event`, `custom_event`, `entry_kinds` (`comment`/`work_note`/`email_in`), `condition` (Cond JSON), `recipients` (RecipientSpec JSON), `notify_actor`, `channels` (`in_app`/`email`/`sms`/`webhook`), `targets` (refs `notification_channel`), `template_id`, `digest`, `builtin`, `description` |
| `notification_template` | subject/body/short text | `name`, `event`, `table_key` (sample table), `subject`, `body` (Markdown), `short_text` (SMS, messengers; empty → subject), `active` |
| `notification_channel` | messengers, webhooks, SMS gateways | `kind` (`slack`/`teams`/`mattermost`/`telegram`/`bale`/`webhook`/`sms`), `principal_id` (whose access messages carry), `endpoint` (secret), `token` (secret), `chat_id`, `sms_url`, `sms_method`, `sms_content_type` (`form`/`json`), `sms_sender`, `sms_body`, `sms_headers` |
| `email_channel` | the organisation's mailbox | `from_name`, `from_address`, `reply_to`, `is_default`, `smtp_host/port/security/user/password` (secret), `inbound`, `imap_host/port/security/user/password` (secret), `imap_folder`, `target_table` (default `todo`), `allow_list`, `deny_list`, `signature` (Markdown) |

Personal rows (area `work`, `rowAccess` read/write = `user_id is_me`: only the owner, whatever their roles; they
travel to the person's Windows app):

| table | what |
| --- | --- |
| `notification_pref` | one row per person: `optouts` (`event:channel` keys, `*:channel` = the whole channel), `digest` (`none`/`hourly`/`daily`), `digest_hour`, `quiet_from`/`quiet_to` (`HH:MM`, may cross midnight), `read_before` (the «همه را خواندم» watermark) |
| `notification` | an inbox item: `user_id`, `title`, `body` (Markdown), `link`, `table_key`, `record_id`, `record_number`, `event`, `kind` (`direct`/`watching`/`approval`/`sla`/`system`), `actor_id`, `rule_key`, `read_at`, `snoozed_until` |

Local tables of each runtime (migration `0010_notify`, not synced): `sm_notification_log` (one row per channel and
recipient: `status` `sent`/`failed`/`skipped`/`held`, `reason`, `error`, `subject`, body hash, `due_at`, the held
payload), `sm_email_messages` (every e-mail in and out: Message-ID, From/To, subject, record, status, reason) and
`sm_notify_state` (IMAP poll state per channel). Retention (job `notify.cleanup`, daily): log 180 days (held rows
kept), e-mail log 365 days, inbox items read and older than 90 days or any older than 180 days.

## 2. Events

| event | raised by engine kind | notes |
| --- | --- | --- |
| `created` | `record.created` | |
| `updated` | `record.updated` | |
| `state_changed` | `record.state_changed` | `event.from` / `event.to` |
| `assigned` | `record.assigned` | |
| `commented` | `record.commented` | a journal entry; `entry_kinds` narrows it (`comment`, `work_note`, `email_in`) |
| `mentioned` | `record.commented` | only when the entry @mentions someone (`mentionedIds` of the UI kit's mention format) |
| `sla_warning` / `sla_breach` | `record.sla_warning`/`sla_warned`, `record.sla_breach`/`sla_breached` | `data.users` (escalation people) → `event_users` |
| `approval_requested` / `approval_decided` | `record.approval_requested`, `record.approval_decided` | `data.approvers` / `data.users` → `event_users`; `data.decision` |
| `custom` | `record.<custom_event>` | any service or flow emits it with `emitEvent`; the rule names it (`major_declared`) |

People an event names are read from `data.users`, `data.approvers`, `data.recipients`, `data.user_id` and
`data.approver_id`.

## 3. Rules

A rule matches an event when it is active, the event is its event (custom: its name), the table is its table
(built-ins: every table that has the fields they need) and its `condition` holds on the record **as the event left
it** — `changed`, `changes_to` and `changes_from` compare with the values before the change, rebuilt from the event's
change list (the same Cond language as lists; `validateCond(…, { rules: true })`).

Built-in rules live in code (like built-in roles). A row whose `builtin` names one **replaces** it (its
`table_key` is forced to `*` and it takes no condition); to switch a built-in off, store a copy with
`active: false`; deleting the copy brings the built-in back.

| builtin | event | recipients | channels |
| --- | --- | --- | --- |
| `assigned_to_me` | assigned (assignee changed and set) | assignee | in_app, email |
| `assigned_to_group` | assigned (group changed, nobody assigned) | assignment group | in_app |
| `comment_to_people` | commented (`comment`, `email_in`) | requester, assignee, watchers | in_app, email |
| `work_note_to_team` | commented (`work_note`) | assignee, watchers | in_app |
| `done_to_requester` | state_changed into a done category (resolved, closed, cancelled) | requester | in_app, email |
| `mentioned` | mentioned | mentioned | in_app, email |
| `sla_warning` | sla_warning | assignee, event people | in_app, email |
| `sla_breach` | sla_breach | assignee, group manager, event people | in_app, email |
| `approval_requested` | approval_requested | event people (approvers) | in_app, email |
| `approval_decided` | approval_decided | requester, event people | in_app, email |

Validation (hook `beforeWrite`): the table exists, is not virtual and is not one of the service's own tables; a
custom event name is `[a-z][a-z0-9_.]*`; the condition validates against the table; at least one recipient and one
channel; `fields` recipients are `user`, `users` or `group` fields.

## 4. Recipients

`recipients` JSON (`RecipientSpec`, cleaned by `cleanRecipients`):

```json
{
  "assignee": true, "assignment_group": true, "group_manager": true, "requester": true, "watchers": true,
  "assignee_manager": true, "requester_manager": true, "oncall": true, "mentioned": true, "event_users": true,
  "fields": ["approver_id", "cab_group"],
  "users": ["<uuid>"], "groups": ["<uuid>"], "roles": ["service_desk_manager"]
}
```

- `assignee`, `requester`, `watchers`, `assignment_group` use the table's scope columns (`TableDef.scope`); the
  requester side is `requested_for`/`caller_id` (who opened the record only when nobody else is named).
- `assignment_group`/`groups`/group `fields`: members, leads and observers within their validity; `group_manager`:
  the group's managers; `*_manager`: the managers of those people; `roles`: holders on their profile or through a
  group's roles (`tenant_admin` also owners and «مدیر» members).
- `oncall`: whoever an on-call source returns for the record's group (`registerOnCallSource`, §9).
- Deduplicated per rule and event, at most 500 people (`MAX_RECIPIENTS`); each keeps its reasons, which decide the
  inbox kind (`direct` when named on the record or by name; `watching` otherwise; approvals and SLA have their own).
- **The actor is left out** unless `notify_actor` is set.
- **Mentions**: an @mention of someone who cannot read the record (or the internal note) does not reach them; the
  author gets one in-app notice naming who was not told (checked with `readersOf`).
- Internal notes (`work_note`) are only quoted to holders of the `internal` field group; others get nothing for them.

## 5. Templates

Subject, Markdown body and short text with placeholders — parsed and rendered by `@shared/notify`
(`parseTemplate`, `renderTemplate`), so the editor shows the same problems the server reports:

```text
{{record.display}}  {{record.number}}  {{record.title}}  {{record.table}}  {{link}}
{{event.label}}  {{event.from}}  {{event.to}}  {{changes}}  {{comment}}
{{actor.name}}  {{recipient.name}}  {{org.name}}  {{app.name}}
{{priority}}  {{assigned_to.display}}  {{assigned_to.email}}      ← fields and dot-walks (≤ 3 levels)
{{block.kb_suggestions}}                                            ← a module's content block
{{#if priority == "1"}}فوری{{else}}عادی{{/if}}   {{#unless description}}…{{/unless}}   (== != and truthiness)
```

Values inserted into Markdown are escaped (a record's title cannot add links or formatting); `changes`, `comment`,
Markdown fields and `link` are inserted as safe Markdown. A rule without a template uses `DEFAULT_TEMPLATES[event]`.

**Content blocks of modules** (`src/server/modules/notify/blocks.ts`): a module registers content of its own that a
template names as `{{block.<key>}}` — knowledge's `kb_suggestions` puts up to three live articles that best match the
record and that **the recipient** may read, linked to their reading view, into «درخواست شما ثبت شد» (KB-051). A block
renders for each recipient under that recipient's context, after the record view (it gets the row as they see it,
plus the `fields` it declares, absent when they may not see them), returns safe Markdown (the module escapes values)
and plain text for subjects and SMS, or nothing — `{{#if block.kb_suggestions}}مقاله‌های پیشنهادی:…{{/if}}` then
hides the heading. A failing block renders nothing and is logged (`notification block failed`); the message still
goes out. `tables` (keys or a test of the table) limits where the editor offers it; unknown blocks render empty.

```ts
import { registerTemplateBlock } from "@server/modules/notify";

registerTemplateBlock("kb_suggestions", {
  label: "مقاله‌های پیشنهادی دانش",
  tables: (def) => def.module !== "knowledge" && !!def.features?.links,
  fields: ["short_description", "description"],
  async render({ ctx, def, id, row, event, link }) {   // ctx: the recipient's; link("kb/a/<id>") → absolute URL
    return { markdown: "- [عنوان](https://…)", text: "عنوان https://…" };   // or null
  },
});
```
E-mail: a Persian RTL HTML layout (`emailLayout`: product name from `APP_NAME`, the organisation's name, an action
button to the record, the channel's signature) with a plain-text alternative; Markdown is rendered by a small strict
renderer (everything escaped, links only `http(s)`/`mailto`).

## 6. Delivery

1. The record-event subscriber (`onRecordEvent("notify", …)`) matches rules and resolves recipients, then queues in
   **one transaction** one `notify.send` job per person and one `notify.hook` job per outside channel (6 attempts,
   the queue's back-off). A retried event never queues half.
2. `notify.send` renders under the recipient's access (no access → `skipped/no_access`), then per channel:
   - preferences: `optouts` (`skipped/opted_out`) — **mandatory** rules ignore opt-outs, quiet hours and digests;
   - `in_app`: a `notification` row (the bell's count moves with «زنده»);
   - `email`: to the member's address through the default e-mail channel; inside quiet hours → `held/quiet` until
     they end; with a digest preference (and `rule.digest`) → `held/digest` until the next hour or the daily hour;
   - `sms`: to the member's mobile (`normalizeMobile`, Iranian numbers to `98…`) through the rule's SMS target or
     the first active SMS gateway; quiet hours hold it too.
   Progress is saved per channel, so a retry never repeats a channel that already went out.
3. `notify.flush` sends what is held when it is due: one e-mail (or a digest listing every item) re-rendered under
   the recipient's access **at that moment**; items whose record is gone or now unreadable are skipped.
4. `notify.hook` renders as the channel's `principal_id` (no principal or no access → skipped) and posts it.

Skip reasons (`SKIP_REASONS`): `no_access`, `inactive`, `opted_out`, `no_address`, `no_channel`,
`channel_inactive`, `quiet`, `digest`, `record_gone`. Every outcome is a row of `sm_notification_log` (subject and a
hash of the body — never the body).

## 7. Channels

**E-mail out** (nodemailer): `security` `tls` (implicit, 465), `starttls` (required), `none`; timeouts connection
15 s, greeting 10 s, socket 30 s, DNS 10 s; UTF-8 base64 bodies and RFC 2047 subjects (Persian subjects survive);
headers `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`, `X-ITSM-Notification: 1`; our
Message-IDs are remembered so replies thread back and our own mail coming back is dropped.

**Messengers and webhooks** (15 s timeout; on the web version through the SSRF guard — public hosts, no redirects):

| kind | request |
| --- | --- |
| `slack` | `POST endpoint` `{ "text": "<link\|title>\nshort" }` |
| `mattermost` | `POST endpoint` `{ "text": "**title**\n\nbody\n\nlink" }` |
| `teams` | `POST endpoint` an Adaptive Card 1.4 (`rtl: true`, title, short text, «مشاهده» button) |
| `telegram` / `bale` | `POST https://api.telegram.org/bot<token>/sendMessage` / `https://tapi.bale.ai/bot<token>/sendMessage` `{ chat_id, text (HTML), parse_mode: "HTML" }` |
| `webhook` | `POST endpoint` `{ source, title, text, body, url, event, table, id, number, rule, at }`; with a `token`, header `x-signature-256: sha256=<HMAC-SHA256 of the body>` |

**SMS** (generic HTTP template): `sms_url`, `sms_method` (`GET`/`POST`), `sms_content_type` (`form`/`json`),
`sms_body` and `sms_headers` with `{{to}}`, `{{text}}`, `{{sender}}`, `{{token}}` (URL-encoded in URLs and forms,
JSON-escaped in JSON). Presets (`SMS_PRESETS`): Kavenegar, Ghasedak, generic JSON — e.g. Kavenegar:

```text
POST https://api.kavenegar.com/v1/{{token}}/sms/send.json
receptor={{to}}&message={{text}}&sender={{sender}}
```

Secrets (`endpoint`, `token`, SMTP/IMAP passwords) are engine `secret` fields: encrypted, never returned, opened with
this runtime's key only when sending.

## 8. E-mail to record (IMAP)

Every active e-mail channel with `inbound` is polled by a `notify.imap` job (one per channel, dedupe key
`notify.imap:<channel>`, every minute; started when the channel is saved). The first look takes the unseen messages
of the last three days; later ones the UIDs above the last seen (UIDVALIDITY changes start over); at most 50 messages
of up to 25 MB per poll. Each message is processed exactly once (its log row is written in the same transaction as
the record, entry and attachments):

- **Loop protection** (`loopReason`, `REJECT_REASONS`): our own messages (`X-ITSM-Notification`, remembered
  Message-IDs) and addresses, bounces (`multipart/report`, mailer-daemon, empty Return-Path), auto-replies
  (`Auto-Submitted`, `X-Autoreply`, `Precedence: auto_reply`, «Out of office» subjects), bulk and list mail
  (`Precedence: bulk/list/junk`, `List-*`), more than 20 messages in 10 minutes from one sender.
- **Allow/deny lists** per channel: addresses or domains (`@example.com`).
- **Threading**: `In-Reply-To`/`References` against messages we sent or received, else the `[TODO0000012]` number
  in the subject → a public `email_in` journal entry on that record, quoted text and signatures stripped — only from
  a member who may read the record (`unknown_sender`, `no_access` otherwise).
- **New mail** → a record of `target_table` (default `todo`): display field from the subject, `description` from the
  text (non-members are named in it), `channel = email` when the table has it, `caller_id`/`requested_for` = the
  member matched by address, the channel's workspace; attachments (≤ 20) through the engine.

«بررسی صندوق اکنون» runs the same poll at once; the channel's state (last check, last result, last error) is shown on
its page.

## 9. Server API for other services

```ts
import { notifyPeople, registerOnCallSource, setTransportFactory, setMailboxOpener, ingestMessage } from "@server/modules/notify";

// tell named people about a record (flows' «اعلان» node, services that pick recipients); inside the caller's tx
await notifyPeople(tx, orgId, { table: "incident", id, users: [a, b], event: "custom", label: "اعلام رخداد عمده",
  subject: "رخداد عمده: {{record.display}}", body: "…", channels: ["in_app", "email"], mandatory: false, actor: ctx.user.id, source: "گردش‌کار" });

// on-call people for `oncall` recipients (the on-call module)
const off = registerOnCallSource(async (q, orgId, groupId, at) => ["<user uuid>"]);
```

Flows: the service registers the flow step «ارسال اعلان» (`src/server/modules/notify/flows.ts`, installed by
`installNotify()`): it resolves the step's recipients with the flow's helpers and calls `notifyPeople` inside the step's
transaction (docs/spec/services/flows.md §8, docs/spec/SERVICES.md).

Raising events: SLA and approvals emit `record.sla_warning`/`record.sla_breached`/`record.approval_requested`/
`record.approval_decided` with `data.users`/`data.approvers`; anything else emits `record.<name>` and a `custom` rule
names it. Do not call channels yourself — queue through the service so access, preferences and the log apply.

Test seams: `setTransportFactory((smtp) => transport)` (nodemailer stream/JSON transport), `setMailboxOpener((imap)
=> session)` (fixture mailboxes), `ctx.cfg.fetch` for messengers/SMS, `ingestMessage(…)` for one raw message.

## 10. HTTP API

`/api/o/:org/notify` (the caller's own inbox and preferences; settings routes need read access to area
`notifications`, tests need write access to the channel). Rules, templates and channels themselves are engine
tables: `/api/o/:org/r/notification_rule` … (generic list, get, create, update with `version`, delete).

| method and path | body / query | answer |
| --- | --- | --- |
| `GET /inbox` | `kind`, `unread=1`, `snoozed=1`, `limit` (≤ 100), `before` (a `shown_at`) | `{ items: InboxItem[], unread, display, more }` |
| `GET /inbox/count` | | `{ unread }` |
| `POST /inbox/read` | `{ ids: [...] }` or `{ all: true }` | `{ unread }` |
| `POST /inbox/snooze` | `{ ids, minutes }` (≤ 30 days) or `{ ids, until: ISO }`; `until: null` brings them back now | `{ changed, until, unread }` |
| `GET /prefs` · `PUT /prefs` | `{ optouts?, digest?, digest_hour?, quiet_from?, quiet_to? }` | `{ prefs }` |
| `GET /rules` | | `{ rules: RuleView[] }` built-ins (`is_builtin`, or replaced: `replaces`) and the organisation's |
| `POST /preview` | `{ table, event, record_id?, template_id? \| subject, body, short_text }` | `{ record, problems, subject, body, short, html }` |
| `GET /blocks` | `table` (a table key; absent or `*`: every block) | `{ blocks: { key, path, label, description }[] }` the modules' content blocks a template of the table may name |
| `GET /log` | `status`, `channel`, `limit` (≤ 200), `before` | `{ entries, display, more }` |
| `GET /email-log` | `direction` (`in`/`out`), `status`, `limit`, `before` | `{ messages, more }` |
| `POST /email-channels/:id/test` | `{ to? }` (default: the caller) | `{ ok, to, message_id, response }` |
| `POST /email-channels/:id/check` | | `{ ok, result: { fetched, created, replied, rejected, duplicate, failed } }` |
| `GET /email-channels/:id/status` | | `{ last_checked_at, last_error, last_result, inbound }` |
| `POST /channels/:id/test` | `{ to? }` (SMS: a mobile; default the caller's) | `{ ok, response }` |

`InboxItem`: `{ id, title, body, link, table_key, record_id, record_number, event, kind, actor_id, created_at,
shown_at, snoozed_until, read }`. A snoozed item is left out of the list and the count until `snoozed_until`; it
then comes back unread at the top (`shown_at` = the end of the snooze, also when «همه را خواندم» happened meanwhile).

```http
POST /api/o/<org>/notify/inbox/snooze
{"ids": ["0190…"], "minutes": 180}
→ {"changed": 1, "until": "2026-11-07T11:30:00.000Z", "unread": 4}

POST /api/o/<org>/r/notification_rule
{"name": "اولویت ۱ به مدیر میز", "table_key": "incident", "event": "updated",
 "condition": {"and": [{"f": "priority", "op": "changes_to", "v": "1"}]},
 "recipients": {"roles": ["service_desk_manager"], "assignee": true},
 "channels": ["in_app", "email", "webhook"], "targets": ["<telegram channel id>"]}
```

## 11. UI

- **Bell** (`Bell.tsx`, in the top bar): unread count from `GET /inbox/count` (query `notify-count`, refreshed by
  «زنده»), announced to screen readers when it grows; opens the **notification center** (`NotificationCenter.tsx`,
  a drawer loaded on first use): kind chips (همه، مستقیم، دنبال‌شده، تأییدها، توافق سطح خدمت، سامانه), همه /
  خوانده‌نشده / به تعویق‌افتاده, items grouped by day (Jalali, the organisation's zone), mark one or all read,
  «بعداً یادآوری کن» (an hour, three hours, tomorrow 8:00, Saturday 8:00), a click opens the record on its module's
  page (`recordPath`), «همهٔ اعلان‌ها» opens the generic list `r/notification`.
- **اعلان‌های من** (`notify/prefs`, section «شما»): the events × channels matrix with «همهٔ اعلان‌ها» per channel,
  e-mail at once / hourly / daily digest (and its hour), quiet hours.
- Settings space, section «اعلان‌ها»: **قانون‌های اعلان** (`notify/rules`: built-ins and the organisation's, a switch
  per rule; editor `notify/rules/new`, `notify/rules/:id`, `notify/rules/builtin/:key` with FilterBuilder plus a
  «و فقط وقتی … تغییر کرد (به/از …)» trigger for the rule-only operators, the recipients picker, channels and outside
  channels, template, digest, mandatory, and a live preview), **الگوهای اعلان** (generic list; editor
  `notify/templates/:id` with Markdown, click-to-insert placeholders of the sample table, template problems as you
  type, the event's default text, and the preview in-app / e-mail (sandboxed frame) / short text), **کانال‌های
  ایمیل** and **پیام‌رسان‌ها و پیامک** (generic record pages with «ایمیل آزمایشی», «بررسی صندوق اکنون», the inbox
  state panel, «پیام آزمایشی», SMS gateway presets; `…/new?kind=sms&preset=kavenegar` starts from a preset),
  **گزارش ارسال** (`notify/log`: deliveries and e-mails with statuses and reasons).
- Live query keys: `notify-count`, `notify-inbox`, `notify-rules`, `notify-log`, `notify-email-log`,
  `notify-inbox-status`.

## 12. Tests

`tests/notify-template.test.ts` (template language, preferences helpers, adapters' requests),
`tests/notify-rules.test.ts` (rules end to end: built-ins, conditions with `changes_to`, recipients, actor, access
filtering, field masks, internal notes, content blocks rendered as the recipient, mentions, opt-outs, mandatory,
inbox, snooze, log; knowledge's `kb_suggestions` block in `tests/knowledge-flow.test.ts`),
`tests/notify-email.test.ts` (SMTP through a fake transport with Persian subjects and RTL HTML, threading, quiet
hours and digests, e-mail to record with fixture messages — threading, loop protection, allow/deny lists — the IMAP
poll, Slack/Telegram/SMS through a stub fetch), `tests/notify-ui.test.ts` (the screens' pure logic). No network.

## 13. Not yet

Web push (VAPID) and the PWA; Microsoft Graph mailboxes; reply classification (acknowledgement vs update, reopen
intent) and parsing rules for structured mail; inbound SMS replies and delivery reports; external stakeholders
(non-members) as recipients; per-locale templates; messenger identities for personal messenger delivery.
